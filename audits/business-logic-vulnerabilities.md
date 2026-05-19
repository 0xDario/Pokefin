# Pokefin – Business Logic Vulnerabilities Audit

Date: 2026-05-19
Scope: Portfolio holdings, import flows, exchange rate / FX, price ingestion, box recipes, account deletion, market data RPCs.
Methodology: Manual source-code review against the supplied business-logic checklist (race conditions, price manipulation, workflow bypass, time-based vulnerabilities, integer over/underflow). Findings are cited to exact `file:line` ranges; nothing in this report has been demonstrated against a live deployment.

---

## 1. Threat Model

### Actors
- **Anonymous browser** – unauthenticated visitor. Can hit any page, can fetch Supabase via the public anon key (`NEXT_PUBLIC_SUPABASE_KEY`). Can hit `/box-calculator?recipe=<code>`.
- **Authenticated user** – signed-in Supabase user (Turnstile-gated signup, password auth, email verification). Owns one or more `portfolios` and `box_recipes`.
- **Admin / scraper job** – two Python processes (`main.py`, `backfill_historical_prices.py`) running on a server/cron, holding `SUPABASE_KEY` (likely service-role, per `secretsFile.py`). They write `products`, `product_price_history`, `exchange_rates`, and Storage.
- **Attacker** – any of the above, plus an attacker holding a leaked anon key.

### Assets
| Asset | Sensitivity | Trust boundary |
| --- | --- | --- |
| `portfolios` rows (`user_id`, `name`) | High (per-user financial truth) | Browser ↔ Supabase (RLS expected) |
| `portfolio_holdings` rows (`quantity`, `purchase_price_usd`, `purchase_date`) | High (cost basis, P&L) | Browser ↔ Supabase (RLS expected) |
| `exchange_rates` (USD→CAD) | Medium (drives CAD display & box-calc NAV) | Scraper → Supabase |
| `product_price_history` | Medium (drives returns/analytics) | Scraper → Supabase |
| `products.usd_price` | Medium (drives current value of every portfolio) | Scraper → Supabase |
| `box_recipes` (`packs`, `retail_price`, `promo_value`, `share_code`) | Low/Med (user-owned with optional public share) | Browser ↔ Supabase (RLS present in `migrations/create_box_recipes.sql:23`) |
| `auth.users` (auth identity, password hashes) | High | Browser ↔ Supabase Auth |

### Trust boundaries
1. **Browser → Supabase (direct anon key)** – Almost every CRUD path: `frontend/app/lib/portfolio.ts`, `frontend/app/lib/import.ts`, `frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts`. The Next.js server is bypassed; security relies entirely on Postgres RLS.
2. **Browser → Next.js `/api/account/delete`** – Only server endpoint with privileged work (`frontend/app/api/account/delete/route.ts:1-93`).
3. **Browser → Next.js server cache (`unstable_cache`)** – Market data is cached for 3600s with anon key (`frontend/app/lib/serverMarketData.ts:604-630`).
4. **Python scrapers → Supabase** – Use `SUPABASE_KEY` from `secretsFile.py` for unrestricted writes (`main.py:163`, `backfill_historical_prices.py:53`).

### Top abuse cases
1. Authenticated user inflates / deflates the cost-basis or quantity on **another user's** holding (if RLS is missing on `portfolio_holdings`).
2. Authenticated user injects fake `exchange_rates` rows to skew CAD pricing for every user (if RLS missing on `exchange_rates`).
3. Authenticated user inserts adversarial `product_price_history` rows to spoof "Returns / Trend / InvestScore" leaderboards (if RLS missing on `product_price_history`).
4. Concurrent double-clicks on `addHolding` / Import duplicate holdings (no idempotency).
5. Large `Number.MAX_VALUE`-style cost-basis/quantity overflows the float aggregation in `calculatePortfolioSummary`.
6. Share-code enumeration of private `box_recipes` (8-char custom alphabet, no rate limiting on Supabase REST).
7. Tampered Collectr CSV uploaded with negative prices or quantities (the DB CHECK constraints catch some, but not all paths).
8. Account-deletion endpoint deletes profile but leaves auth user (and therefore the user's portfolio/holdings) intact when `SUPABASE_SERVICE_ROLE_KEY` is unset (`route.ts:81-87`).

---

## 2. Findings

> Severity legend: Critical (immediate financial integrity loss), High (cross-user data tampering), Medium (single-user data integrity / DoS / leakage), Low (correctness drift, defense-in-depth).

---

### F-01 — Missing/unverified RLS on `portfolios`, `portfolio_holdings`, `exchange_rates`, `product_price_history`, `products`, `profiles` (cross-user write & read)

- **Severity:** Critical
- **CWE:** CWE-862 (Missing Authorization), CWE-285 (Improper Authorization)
- **Evidence:**
  - Schema for `portfolios`, `portfolio_holdings`, `exchange_rates`, `product_price_history`, `products`, `profiles` — `schema.sql:4-86` — no `ENABLE ROW LEVEL SECURITY` and no `CREATE POLICY`. Only `box_recipes` has explicit RLS (`migrations/create_box_recipes.sql:22-48`).
  - Direct anon-keyed client used for all CRUD: `frontend/app/lib/supabase.ts:1-12`, `frontend/app/lib/portfolio.ts:21-211`, `frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts:42-194`.
  - `getHoldings(portfolioId)` (`portfolio.ts:103-123`), `updateHolding(holdingId, …)` (`portfolio.ts:178-195`), `deleteHolding(holdingId)` (`portfolio.ts:200-211`) take an ID from the client and apply **no `user_id` filter or ownership check** anywhere in the JS layer.
  - `getOrCreatePortfolio(userId)` (`portfolio.ts:21-54`) trusts the `userId` argument passed by the client.
- **Why it matters:** Every portfolio table is reachable through the anon key. If RLS is not configured server-side (the schema doesn't include it), any authenticated (or even anonymous) user can:
  - `select * from portfolio_holdings` (read everyone's cost basis / quantities / notes — full P&L disclosure),
  - `update portfolio_holdings set quantity = 1, purchase_price_usd = 999999 where id = <victim_id>`,
  - `delete from portfolios where id = <victim_id>` (cascades nothing because there's no `ON DELETE CASCADE` declared, so it just orphans `portfolio_holdings`),
  - `insert into exchange_rates (usd_to_cad, recorded_at) values (0.000001, now())` — this is the **most recent** row and is what every client reads in `serverMarketData.ts:463-480` and `exchangeRate.ts:18-46`, so it silently changes the CAD display for everyone,
  - `insert into product_price_history` to spike a product's `return_30d` / `invest_score` (RPC `get_market_product_metrics` in `migrations/20260506_market_performance_functions.sql:14-197` reads any historical row >= 365 days),
  - `update products set usd_price = 99999 where id = <pop hit>` — changes the displayed current value of every user's holdings of that product.
- **Exploitability + PoC:**
  ```bash
  curl -sX POST "$SUPABASE_URL/rest/v1/portfolio_holdings?id=eq.42" \
    -H "apikey: $NEXT_PUBLIC_SUPABASE_KEY" \
    -H "Authorization: Bearer <any-jwt-or-anon-key>" \
    -H "Content-Type: application/json" \
    -d '{"purchase_price_usd": 0.01, "quantity": 1}'
  ```
  If RLS is off (or has no `WITH CHECK` policy), this returns 204 and rewrites another user's lot.
- **Remediation snippet (Postgres / SQL migration):**
  ```sql
  ALTER TABLE public.portfolios            ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.portfolio_holdings    ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.portfolio_lots        ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.exchange_rates        ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.product_price_history ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.products              ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.sets                  ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.product_types         ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.generations           ENABLE ROW LEVEL SECURITY;

  -- Owner-only access on portfolios and dependent rows
  CREATE POLICY portfolios_owner_all ON public.portfolios
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

  CREATE POLICY holdings_owner_all ON public.portfolio_holdings
    USING (EXISTS (SELECT 1 FROM public.portfolios p
                   WHERE p.id = portfolio_id AND p.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.portfolios p
                        WHERE p.id = portfolio_id AND p.user_id = auth.uid()));

  CREATE POLICY lots_owner_all ON public.portfolio_lots
    USING (EXISTS (SELECT 1 FROM public.portfolio_holdings h
                   JOIN public.portfolios p ON p.id = h.portfolio_id
                   WHERE h.id = holding_id AND p.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.portfolio_holdings h
                        JOIN public.portfolios p ON p.id = h.portfolio_id
                        WHERE h.id = holding_id AND p.user_id = auth.uid()));

  -- Public read, NO public write on reference data
  CREATE POLICY exchange_rates_read   ON public.exchange_rates        FOR SELECT USING (true);
  CREATE POLICY price_history_read    ON public.product_price_history FOR SELECT USING (true);
  CREATE POLICY products_read         ON public.products              FOR SELECT USING (true);
  -- (no INSERT/UPDATE/DELETE policy => only service_role can write)
  ```
- **Defense-in-depth:**
  - Re-issue the Python scraper credentials as a dedicated *service role* (separate from anon), and confirm `SUPABASE_KEY` in `secretsFile.py` is service-role — never reuse the anon key for writes.
  - Add a `portfolio_id`-by-`user_id` server-side check by routing mutations through a Next.js server action with the user's session JWT.
  - Consider an `auth.uid()`-bound `INSERT` trigger on `portfolios` that sets `user_id := auth.uid()` to defeat client-side `user_id` spoofing.
- **Unable to verify:** Whether RLS is enabled in the *deployed* Supabase project. The repo's `schema.sql:1-2` is documented as "for context only and is not meant to be run". What would prove the issue: `select tablename, rowsecurity from pg_tables where schemaname='public';` (via `mcp__…__execute_sql` or psql) — every row should show `rowsecurity = t` AND have at least one matching policy in `pg_policies`.

---

### F-02 — `exchange_rates` writable by anon key → currency manipulation

- **Severity:** High
- **CWE:** CWE-345 (Insufficient Verification of Data Authenticity), CWE-602 (Client-Side Enforcement of Server-Side Security)
- **Evidence:**
  - `frontend/app/lib/exchangeRate.ts:18-35` — clients read `select … order by recorded_at desc limit 1` and treat that row as ground truth.
  - `frontend/app/lib/serverMarketData.ts:463-480` — same logic on the server (Next.js cached for 1h).
  - `main.py:447-505` — only the scraper is meant to insert rows.
  - No RLS in `schema.sql` for `exchange_rates`.
- **Why it matters:** The CAD ↔ USD rate drives every "C$" price shown on the site, every CAD-mode box-calc NAV (`BoxCalculator.tsx:212-217`), and every CAD portfolio total. An attacker who inserts `(0.0001, now())` makes every CAD value appear ~1000× smaller; inserting `(1000, now())` does the opposite. There is also no plausibility bound (`schema.sql:4-9` only enforces `NOT NULL`, not a range), so the bad row is permanent until manual cleanup. Server cache (`unstable_cache(..., revalidate: 3600)`) means the bogus rate persists ~1h after deletion.
- **Exploitability + PoC:**
  ```bash
  curl -sX POST "$SUPABASE_URL/rest/v1/exchange_rates" \
    -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
    -H "Content-Type: application/json" \
    -d '{"usd_to_cad": 0.001, "recorded_at": "2099-01-01T00:00:00"}'
  ```
- **Remediation snippet:** see F-01 RLS policies; additionally enforce a sanity range on `exchange_rates`:
  ```sql
  ALTER TABLE public.exchange_rates
    ADD CONSTRAINT exchange_rates_usd_to_cad_sane
    CHECK (usd_to_cad > 0.5 AND usd_to_cad < 5.0);
  ```
- **Defense-in-depth:**
  - `serverMarketData.ts:471-479` already falls back to `DEFAULT_EXCHANGE_RATE = 1.36` (`marketData.ts:60`) on error — extend that with a sanity check: discard reads where the rate is outside `[0.5, 5.0]`.
  - Pin reads to `recorded_at <= now() AND recorded_at > now() - interval '7 days'` to ignore future-dated tampering.
- **Unable to verify:** Whether the deployed `exchange_rates` table has RLS or a write-blocking policy. Proof would be the same `pg_tables`/`pg_policies` query.

---

### F-03 — `product_price_history` writable by anon key → "Returns / InvestScore" manipulation

- **Severity:** High
- **CWE:** CWE-345, CWE-1284 (Improper Validation of Specified Quantity in Input)
- **Evidence:**
  - `schema.sql:49-56` — only constraint is `usd_price > 0` (and even that is bypassable because `usd_price IS NULL` is allowed). No RLS in committed schema.
  - The RPC `get_market_product_metrics` (`migrations/20260506_market_performance_functions.sql:14-197`) computes `return_30d`, `return_90d`, `volatility_90d`, `trend_90d` by joining against `product_price_history` without auth filtering. Set leaderboard (`get_set_analytics`, lines 261-424) aggregates those into a public `invest_score`/`rank`.
  - The client-side fallback (`serverMarketData.ts:482-555`) does the same with no source-trust check.
- **Why it matters:** A user who wants their favorite set to top the leaderboard can insert one row per historical day at favorable prices and either (a) inflate `return_*` (making the set look great) or (b) deflate `volatility_90d` (lowering the volatility penalty). Because `return_30d` lookups in the SQL "anchors" CTE pick `usd_price` where `day <= current_date - 30` ORDER BY `day DESC LIMIT 1`, a single row at `recorded_at = current_date - 30 days` for a low price is enough to spike `return_30d`. The set's `invest_score`/`rank` is then shown to every user on the Sets analytics page.
- **Exploitability + PoC:**
  ```bash
  for d in 365 180 90 30 7 1; do
    curl -sX POST "$SUPABASE_URL/rest/v1/product_price_history" \
      -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
      -H "Content-Type: application/json" \
      -d "{\"product_id\": 4242, \"usd_price\": 0.01, \"recorded_at\": \"$(date -u -d "-${d} days" +%F)T12:00:00\"}"
  done
  ```
  Now `(today_price - 0.01)/0.01 * 100` dominates `return_*` and the product/set jumps to rank 1.
- **Remediation snippet:** see F-01 — public `SELECT`-only policy, no INSERT/UPDATE/DELETE for anon/authenticated; only the scraper service-role writes.
- **Defense-in-depth:**
  - Add a unique index `(product_id, recorded_at::date)` to prevent duplicate-day inserts:
    ```sql
    CREATE UNIQUE INDEX product_price_history_product_day_uidx
      ON public.product_price_history (product_id, (recorded_at::date));
    ```
  - Add `CHECK (recorded_at <= now() + interval '1 day')` to disallow future dating.
- **Unable to verify:** RLS state on production. Same probe as F-01.

---

### F-04 — `addHolding` is not idempotent (double-submit / race → duplicate holdings)

- **Severity:** Medium
- **CWE:** CWE-367 (TOCTOU), CWE-362 (Concurrent Execution with Improper Synchronization)
- **Evidence:**
  - `frontend/app/lib/portfolio.ts:153-173` — `addHolding` just calls `insert` with no dedupe key.
  - `frontend/app/components/Portfolio/cards/AddHoldingModal.tsx:48-95` — the submit button is gated only by `disabled={loading}`. The button is `<button type="submit">`; a double-click before React's `setLoading(true)` reflects in the DOM, plus Enter key auto-submit, plus React 18 double-invocation in StrictMode, all enqueue two inserts back-to-back.
  - `frontend/app/lib/import.ts:414-459` — `importHoldings` iterates `for (const match of matches)` and `await addHolding(newHolding)` per row, with no transactional wrapper. If the user clicks Import twice, or the request is retried (e.g. on 5xx), all rows are reinserted; there is no `ON CONFLICT` clause and no app-side idempotency key.
- **Why it matters:** A user importing a 200-row Collectr CSV twice (an easy mistake) ends up with 400 holdings, doubling their reported cost basis and current value. Same with double-click on Add Holding. None of these are reversible without `deleteHolding` calls per row.
- **Exploitability + PoC:** Hold Enter on the Add Holding form, or click "Process CSV" twice in `ImportHoldingsModal.tsx:51-82`. Network throttling makes this easy to demonstrate.
- **Remediation snippet:**
  ```ts
  // ImportHoldingsModal.tsx
  const handleImport = async () => {
    if (loading || step !== "preview") return;          // hard guard
    setStep("importing"); setLoading(true);
    ...
  };
  ```
  Server-side: introduce a soft idempotency key column and a unique index:
  ```sql
  ALTER TABLE public.portfolio_holdings
    ADD COLUMN client_idempotency_key uuid;
  CREATE UNIQUE INDEX portfolio_holdings_idem_uidx
    ON public.portfolio_holdings (portfolio_id, client_idempotency_key)
    WHERE client_idempotency_key IS NOT NULL;
  ```
  And in `addHolding`:
  ```ts
  .insert({ ..., client_idempotency_key: crypto.randomUUID() })
  ```
  The UUID is generated once per submit and replayed on retry.
- **Defense-in-depth:** Disable the import button between `processCSV` and `handleImport`; use `useTransition` to guarantee single-flight; show a "Last imported: <timestamp>" banner so the user notices duplicates.

---

### F-05 — Numeric/cost-basis validation is client-only; integer / float boundary holes

- **Severity:** Medium
- **CWE:** CWE-602 (Client-Side Enforcement of Server-Side Security), CWE-190 (Integer Overflow or Wraparound), CWE-1339 (Insufficient Precision or Accuracy of a Real Number)
- **Evidence:**
  - `frontend/app/components/Portfolio/cards/AddHoldingModal.tsx:57-67` — `parseInt(quantity)` / `parseFloat(purchasePrice)` are validated only in the browser. There is no upper bound on either field; no `Number.isFinite`/`isNaN` check beyond `isNaN(qty)`/`isNaN(price)`; no max-cost-basis sanity. The DB constraints (`schema.sql:19-20`) allow `quantity` up to `2147483647` and any non-negative `double precision` for price.
  - Same in `EditHoldingModal.tsx:44-67`.
  - `frontend/app/lib/import.ts:137-140` — `averageCostPaid: parseFloat(values[9]) || 0`, `quantity: parseInt(values[10]) || 0`. There is **no rejection** of zero/negative/`NaN` quantities — `|| 0` silently coerces, then the DB check `quantity > 0` will reject only `0`, but `-1` will be filtered as well (CHECK forbids). However, a forged CSV with `quantity = 2147483647` (max int) passes; the DB stores it; subsequent reads in `calculatePortfolioSummary` (`portfolio.ts:221-249`) compute `2147483647 * 100` ≈ `2.15e11`, which still fits in `double precision`, but compounding several such rows produces `Infinity` for `total_current_value`. That `Infinity` is then sent to `calculatePortfolioSummary`, which produces `Infinity - Infinity = NaN` for gain/loss.
  - `parseFloat("1e308")` for `purchase_price_usd` is accepted by the form (no max attribute) and by the DB (`double precision`).
  - `parseInt` with a malicious string like `"99999999999999999999"` returns `1e20`-ish (loss of precision), then `quantity * purchase_price` overflows silently because JS uses IEEE-754 doubles.
- **Why it matters:**
  - A single bad row can poison the portfolio summary for the affected user (NaN/Infinity propagates).
  - Importing a tampered CSV (the user controls the file, but a shared/sample CSV from a forum is a credible threat) can quietly insert `quantity = 2_000_000_000` rows that pass the DB check.
  - Even legitimate large values inflate `total_gain_loss_percent` computations (`portfolio.ts:237-239`) into double-precision overflow.
- **Exploitability + PoC:** Craft a one-row Collectr CSV with `quantity = 2147483647` and `averageCostPaid = 1e200`; import it via `ImportHoldingsModal`. The row is accepted; `getPortfolioHistory` (`portfolio.ts:275-385`) returns daily values of `Infinity`; chart rendering breaks.
- **Remediation snippet:**
  ```ts
  // portfolio.ts addHolding
  export async function addHolding(holding: NewHolding): Promise<Holding | null> {
    const q = Number(holding.quantity);
    const p = Number(holding.purchase_price_usd);
    if (!Number.isInteger(q) || q < 1 || q > 100_000) return null;
    if (!Number.isFinite(p) || p < 0 || p > 1_000_000) return null;
    ...
  }
  ```
  And mirror with a DB constraint:
  ```sql
  ALTER TABLE public.portfolio_holdings
    ADD CONSTRAINT portfolio_holdings_quantity_sane CHECK (quantity BETWEEN 1 AND 100000),
    ADD CONSTRAINT portfolio_holdings_price_sane    CHECK (purchase_price_usd BETWEEN 0 AND 1000000);
  ```
- **Defense-in-depth:** Sanitize in `parseCollectrCSV` (`import.ts:115-150`) — reject rows where `quantity <= 0`, `quantity > 10_000`, or `averageCostPaid` is `NaN`/`<0`/`>1_000_000`; surface these as "skipped: invalid quantity/price" so the user knows.

---

### F-06 — `box_recipes.share_code` is 8 chars over a 54-char alphabet, not cryptographically random

- **Severity:** Medium
- **CWE:** CWE-330 (Use of Insufficiently Random Values), CWE-340 (Generation of Predictable Numbers or Identifiers)
- **Evidence:**
  - `frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts:8-15`:
    ```ts
    function generateShareCode(): string {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
      let code = "";
      for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
      return code;
    }
    ```
  - The RLS policy (`migrations/create_box_recipes.sql:26-29`) makes **any row with a `share_code` publicly readable**. A `share_code` is auto-generated on every save (`useBoxRecipes.ts:77`), so **every saved recipe is effectively public** to anyone who can guess/learn the code.
- **Why it matters:**
  - `Math.random()` is not a CSPRNG; in some browsers the seed is predictable enough to reduce search space.
  - Even ignoring PRNG quality, the keyspace is `54^8 ≈ 7.2e13`. Sounds large, but Supabase REST has no built-in rate-limit for unauthenticated `GET /rest/v1/box_recipes?share_code=eq.XXX` — a moderately funded attacker can scan a large fraction.
  - The recipe contains: name (user-chosen), retail price, promo value, pack composition. None is highly sensitive, but the policy claims "share_code => public" — yet the UI implies opt-in sharing. There's no `is_public` flag; users can't make a recipe private after first save.
- **Exploitability + PoC:** Enumerate `share_code` values; for each hit, infer the recipe owner is at least an active user. Even without owner identity, you obtain pricing intent / preferred set strategies.
- **Remediation snippet:**
  ```ts
  function generateShareCode(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""); // 32 hex chars
  }
  ```
  And split storage of "is the recipe sharable" from "what is its public ID":
  ```sql
  ALTER TABLE public.box_recipes ADD COLUMN is_public boolean NOT NULL DEFAULT false;
  DROP POLICY "Shared recipes are viewable by everyone" ON public.box_recipes;
  CREATE POLICY box_recipes_shared_read ON public.box_recipes FOR SELECT
    USING (is_public = true AND share_code IS NOT NULL);
  ```
- **Defense-in-depth:** Only generate a `share_code` when the user explicitly clicks "Make shareable". The current code path generates one on **every** save (`useBoxRecipes.ts:77`).

---

### F-07 — Account deletion is non-atomic; can leave dangling state

- **Severity:** Medium
- **CWE:** CWE-460 (Improper Cleanup on Thrown Exception), CWE-665 (Improper Initialization), CWE-672 (Operation on a Resource after Expiration or Release)
- **Evidence:** `frontend/app/api/account/delete/route.ts:40-92`.
  - Step 1: deletes `profiles` row (line 41-45).
  - Step 2: if `SUPABASE_SERVICE_ROLE_KEY` is unset → only logs a warning and signs out (lines 81-87). Auth user persists; orphaned `portfolios` / `portfolio_holdings` rows persist.
  - Step 3: even when the service key is set, deletion of `auth.users` does **not** cascade to `portfolios` or `box_recipes` in the schema (`schema.sql:46-48`, `migrations/create_box_recipes.sql:14-16` — both use `REFERENCES auth.users(id)` without `ON DELETE CASCADE`). Result depends on FK action default (`NO ACTION`/`RESTRICT`), which means `auth.admin.deleteUser` likely fails or leaves rows orphaned depending on Supabase auth schema.
  - No transaction; the profile delete is not rolled back if user delete fails (lines 70-80).
- **Why it matters:**
  - User can call delete twice in quick succession; first call deletes profile, second call returns 401 with stale state.
  - If `SUPABASE_SERVICE_ROLE_KEY` is missing in prod, every account "deletion" is silently a profile-only delete — login still works (auth user not deleted), but the UI shows a broken profile (no row).
  - Orphaned portfolios still appear under `getOrCreatePortfolio(userId)` lookups if the user re-signs-up under the same id (impossible normally, but the orphaned holdings sit in DB forever, retained on backups).
- **Exploitability + PoC:** A user with malicious intent can spam `DELETE /api/account/delete` to force the profile deletion path while keeping the auth identity; on next login `fetchProfile` (`AuthContext.tsx:36-67`) creates a new empty profile, effectively wiping their username record.
- **Remediation snippet:**
  ```ts
  // route.ts
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Account deletion temporarily unavailable" }, { status: 503 });
  }
  // Perform full deletion via service role inside a single RPC that does:
  //   DELETE FROM portfolio_holdings WHERE portfolio_id IN (...);
  //   DELETE FROM portfolios WHERE user_id = $1;
  //   DELETE FROM box_recipes WHERE user_id = $1;
  //   DELETE FROM profiles WHERE id = $1;
  //   then auth.admin.deleteUser($1)
  ```
  And in SQL:
  ```sql
  ALTER TABLE public.portfolios
    DROP CONSTRAINT portfolios_user_id_fkey,
    ADD  CONSTRAINT portfolios_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  ALTER TABLE public.box_recipes
    DROP CONSTRAINT box_recipes_user_id_fkey,
    ADD  CONSTRAINT box_recipes_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  ALTER TABLE public.portfolio_holdings
    DROP CONSTRAINT portfolio_holdings_portfolio_id_fkey,
    ADD  CONSTRAINT portfolio_holdings_portfolio_id_fkey
      FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;
  ```
- **Defense-in-depth:** Wrap the multi-table cleanup in a Postgres function and call it via `.rpc()` so it runs as a single transaction.

---

### F-08 — Import workflow can match wrong product (silent identity confusion)

- **Severity:** Medium
- **CWE:** CWE-863 (Incorrect Authorization), CWE-754 (Improper Check for Unusual or Exceptional Conditions)
- **Evidence:** `frontend/app/lib/import.ts:289-379`. The `matchProduct` function:
  - Returns `confidence: "low"` and silently picks `candidates[0]` when no exact set name / variant matches (line 378).
  - `ImportHoldingsModal.tsx:67-73` pre-selects only `exact`/`high`, but `low` matches stay in the import list — a user clicking "Select All" (line 94-102) will import them without seeing why confidence is low.
  - Set-name normalization (`normalizeSetName`, line 199-207) is greedy: it strips `:`, `-`, `–`, `—` and the prefix `sv `. As a result `"SV: Paldea Evolved"` matches both `"Paldea Evolved"` and `"Paldea Evolved Energy"` if such exist; `setMatches` includes both via substring containment (lines 308-312).
- **Why it matters:** A user importing CSV thinks they're tracking Set A; the system silently records them as owning Set B. P&L, leaderboard impact, and any downstream business logic are wrong, and the only signal is a small "low" badge in `ImportHoldingsModal.tsx:340-350` that becomes invisible after Select-All.
- **Exploitability + PoC:** Craft a CSV with `set = "SV: x"` where `x` is a substring of multiple set names; observe that the import lands on the first match.
- **Remediation snippet:**
  ```ts
  // import.ts matchProduct, replace fallback
  if (candidates.length > 1 && !exactMatch && !variantMatch) {
    return { product: null, confidence: "none",
             unmatchedReason: `Ambiguous match (${candidates.length} candidates)` };
  }
  ```
  And refuse to pre-select `"low"` matches in `ImportHoldingsModal.tsx:67-73` (already done) **plus** require explicit per-row confirmation before they can be checked.
- **Defense-in-depth:** Log/store the original CSV row id alongside the import so the user can audit/undo.

---

### F-09 — TOCTOU in `getOrCreatePortfolio`: concurrent calls create duplicate portfolios

- **Severity:** Low/Medium
- **CWE:** CWE-367 (TOCTOU)
- **Evidence:** `frontend/app/lib/portfolio.ts:21-54`. The function performs `select … limit 1`, then if not found, `insert`. There's no unique constraint on `portfolios(user_id)` in `schema.sql:40-48` (only PK on `id`). Two concurrent tabs (or React StrictMode double-effect) can both fall through to the insert and both succeed.
- **Why it matters:** Subsequent reads `order by created_at limit 1` will keep returning the older one, but the duplicate row exists forever and a future bug (e.g. iterating user portfolios) will surface it.
- **Exploitability + PoC:** Open two browser tabs of `/portfolio` simultaneously after deleting the user's only portfolio.
- **Remediation snippet:**
  ```sql
  CREATE UNIQUE INDEX portfolios_user_id_uidx
    ON public.portfolios (user_id);
  ```
  Pair with `.upsert({ user_id }, { onConflict: "user_id" })`.
- **Defense-in-depth:** Move the create-on-signup logic to a Postgres trigger on `auth.users` insert.

---

### F-10 — `purchase_date` only validated client-side; future dates and timezone drift

- **Severity:** Low
- **CWE:** CWE-20 (Improper Input Validation), CWE-754
- **Evidence:**
  - `AddHoldingModal.tsx:178` / `EditHoldingModal.tsx:178` apply `max={new Date().toISOString().split("T")[0]}` only as an HTML attribute. Skipped by an attacker who calls the Supabase REST API directly.
  - DB column is just `date` (`schema.sql:21`), no CHECK constraint.
  - `getPortfolioHistory` (`portfolio.ts:289-301`) sorts purchase entries by date string with `localeCompare`, then iterates daily UTC dates. A user setting `purchase_date = 2099-12-31` makes their `quantity` never become non-zero in the date loop (`portfolio.ts:358-364`), so the chart goes flat; but `calculatePortfolioSummary` (line 221-249) still counts the full cost basis. Result: a holdings record contributing to "total cost basis" but **not** to any historical chart — misleading P&L attribution.
  - `purchase_date` is parsed as a plain date but inserted as user-typed local date; in `getPortfolioHistory` it's compared to UTC `dateStr = d.toISOString().split("T")[0]` — a `purchase_date = "2025-05-01"` typed at midnight EST appears in DB as `2025-05-01` but the user's local-day was `2025-04-30`. Off-by-one boundary effects on day 1.
- **Why it matters:** Mostly a correctness issue; combined with F-05 it lets an attacker poison their own P&L display without triggering DB constraints. Forward-dated entries also break the daily-iteration logic.
- **Remediation snippet:**
  ```sql
  ALTER TABLE public.portfolio_holdings
    ADD CONSTRAINT portfolio_holdings_purchase_date_not_future
    CHECK (purchase_date <= current_date);
  ```
- **Defense-in-depth:** Document an explicit "purchase date is interpreted in UTC" UI hint, or store a `timestamptz` instead of `date`.

---

### F-11 — Scraper price ingestion ignores `recorded_at` collisions; can store duplicate per-day rows

- **Severity:** Low
- **CWE:** CWE-694 (Use of Multiple Resources with Duplicate Identifier)
- **Evidence:**
  - `main.py:670-678, 700-715` — batch insert into `product_price_history` with no `ON CONFLICT` clause.
  - `backfill_historical_prices.py:506-532` — same; relies on app-side dedupe (`fetch_existing_price_dates`, lines 471-503) but that check is a read-then-write TOCTOU with no DB-level unique key.
  - Concurrent runs (`--forward` and `--reverse` are explicitly documented as parallel in the script's own help text, lines 22-26 and 808-826) can both insert for the same `(product_id, day)` pair if they hit the same product (which happens around the midpoint).
- **Why it matters:** Duplicate rows skew the average / median / volatility calculations in `get_market_product_metrics` (`migrations/20260506_market_performance_functions.sql:38-46`); the `DISTINCT ON` does dedupe at read time, but only by `(product_id, recorded_at::date)`. That works for analytics but bloats the table and complicates anyone joining without DISTINCT (e.g. `serverMarketData.ts:482-555`).
- **Remediation snippet:**
  ```sql
  CREATE UNIQUE INDEX product_price_history_product_day_uidx
    ON public.product_price_history (product_id, (recorded_at::date));
  ```
  Then in scraper:
  ```python
  supabase.table("product_price_history").upsert(
      batch, on_conflict="product_id,(recorded_at::date)"
  ).execute()
  ```
- **Defense-in-depth:** Guard the parallel `--forward`/`--reverse` mode with a coordination check (e.g. a `processed_at` lock row or non-overlapping `product_id` ranges).

---

### F-12 — `searchProducts` allows wildcard injection via raw `ilike` interpolation (data-leak / DoS)

- **Severity:** Low
- **CWE:** CWE-117 (Improper Output Neutralization), CWE-89-adjacent (NoSQL-style query injection)
- **Evidence:** `frontend/app/lib/portfolio.ts:394-413`:
  ```ts
  .ilike("variant", `%${query}%`)
  ```
  `query` is the raw user input (`ProductSearchSelect.tsx`'s search box). Supabase escapes single quotes but `%` and `_` are valid SQL LIKE wildcards and are not stripped. A query of `_` matches every single character; `%%` matches everything.
- **Why it matters:**
  - Mostly DoS: an attacker repeatedly searches `%` and forces a full table scan on `products.variant`.
  - Marginal info-leak if `products` includes any private staging rows (depends on F-01 outcome).
- **Remediation snippet:**
  ```ts
  const safe = query.replace(/[%_\\]/g, "\\$&");
  ...
  .ilike("variant", `%${safe}%`)
  ```
- **Defense-in-depth:** Server-side rate-limit `searchProducts`; impose a max-length on `query` (currently only `< 2` is rejected, no upper bound).

---

## 3. Risk Score

**Overall: 8.5 / 10.**

Driven almost entirely by F-01/F-02/F-03 — if RLS isn't already configured on every user-data table, an attacker holding the publicly-shipped anon key (`NEXT_PUBLIC_SUPABASE_KEY`, by definition exposed in the browser bundle) can read, write, or delete every portfolio, every cost basis, every exchange rate, and every price history row. The scope is the entire app. If RLS is *actually* in place on the production project, the risk drops to ~5 (F-04..F-12 remain) — but the schema as committed does not encode that protection, and there is no migration in `migrations/` that does.

---

## 4. Top 5 Prioritized Fixes

1. **Enable RLS on every user-owned and reference table (F-01, F-02, F-03).** Ship the migration shown in F-01. Treat the deployed DB as untrusted until verified via `select tablename, rowsecurity from pg_tables where schemaname='public'`.
2. **Confine the Python scrapers to a separate `service_role` key (F-01, F-02, F-03 follow-on).** Audit `secretsFile.py`; confirm `main.py:163` and `backfill_historical_prices.py:53` are not using the anon key.
3. **Add server-side validation + DB CHECK constraints on holding `quantity`, `purchase_price_usd`, `purchase_date` (F-05, F-10).** Mirror the form-level limits in Postgres. Reject `quantity > 100_000`, `purchase_price_usd > 1_000_000`, `purchase_date > current_date`.
4. **Add an idempotency key + unique index on `(portfolio_id, client_idempotency_key)` and disable submit-during-flight (F-04).** Prevents double-import and double-click duplicates.
5. **Make account deletion atomic and force `ON DELETE CASCADE` from `auth.users` → `portfolios`/`box_recipes`/`profiles` (F-07).** Return 503 if `SUPABASE_SERVICE_ROLE_KEY` is missing instead of silently doing a partial delete.

---

## 5. Checklist diff (Pass / Fail / N/A)

| Check | Status | Notes |
| --- | --- | --- |
| 1. Race conditions – Concurrent request handling | **FAIL** | `addHolding`/`importHoldings` have no idempotency (F-04). `getOrCreatePortfolio` has TOCTOU (F-09). |
| 1. Race conditions – Double-spending prevention (double-counting holdings, dup imports, dup price rows) | **FAIL** | Import path replays cleanly; price-history dedupe is app-side TOCTOU (F-04, F-11). |
| 1. Race conditions – Inventory management (box recipes / SKU mapping) | **PASS (weak)** | Box recipes are owner-scoped (F-06 still affects sharing). |
| 2. Price manipulation – Client-side-only price validation | **FAIL** | `cost_basis`, `quantity`, `purchase_date` validated only in the React form; DB has weak constraints (F-05, F-10). |
| 2. Price manipulation – Discount/coupon abuse | **N/A** | No discount/coupon flow. (Box NAV "signal" thresholds are client-only displays, not authoritative.) |
| 2. Price manipulation – Currency manipulation (exchangeRate.ts) | **FAIL** | If RLS is off, any client can insert `exchange_rates` (F-02). No plausibility CHECK on the column. |
| 3. Workflow bypass – Skipping validation steps | **FAIL** | Direct Supabase REST calls bypass every JS-layer validator (F-01, F-05). Import "low confidence" rows can be selected via Select-All (F-08). |
| 3. Workflow bypass – Status manipulation | **PASS** | No multi-step status state to bypass. |
| 3. Workflow bypass – Approval process bypass | **N/A** | No approval flow. |
| 4. Time-based – TOCTOU (check-then-write) | **FAIL** | `getOrCreatePortfolio` (F-09), backfill dedupe (F-11). |
| 4. Time-based – Expiration bypass (token / cache TTLs) | **PASS (weak)** | `unstable_cache(..., 3600)` for exchange rate amplifies the impact of F-02 but isn't itself the vuln. |
| 4. Time-based – Timezone manipulation | **FAIL** | `purchase_date` UTC vs local-day mismatch in `getPortfolioHistory` (F-10). |
| 5. Integer over/underflow – Calculation errors | **FAIL** | No upper bounds on quantity/price; aggregate can reach `Infinity` (F-05). |
| 5. Integer over/underflow – Negative-value handling | **PASS (DB level)** | `quantity > 0`, `purchase_price_usd >= 0` enforced at DB (`schema.sql:19-20`). Client also rejects `<0`. Negative `usd_to_cad` is **not** rejected (`schema.sql:4-9`). |

---

## 6. "Unable to verify" items + how to prove them

| Item | Probe |
| --- | --- |
| Whether RLS is enabled on production tables | `select tablename, rowsecurity from pg_tables where schemaname='public'`; expect `t` for every user-data and reference table. |
| Whether RLS policies exist | `select schemaname, tablename, policyname, cmd, qual, with_check from pg_policies where schemaname='public'`. |
| Whether `SUPABASE_KEY` in `secretsFile.py` is service-role | Decode the JWT (`{role}` claim); should equal `"service_role"`, not `"anon"`. |
| Whether `NEXT_PUBLIC_SUPABASE_KEY` is truly an anon key | Same — decode in browser devtools; if it says `service_role`, that is **Critical** on its own. |
| Whether `SUPABASE_SERVICE_ROLE_KEY` is set in prod (F-07) | `echo $SUPABASE_SERVICE_ROLE_KEY` on the deploy host, or check Vercel/host env config. |
| Whether F-01 PoC actually rewrites rows | Execute the curl in a *non-prod* environment with a known holding id and observe the row mutation. |

---

## 7. Files referenced

- `/home/user/Pokefin/frontend/app/lib/portfolio.ts` (lines 21-413)
- `/home/user/Pokefin/frontend/app/lib/import.ts` (lines 115-459)
- `/home/user/Pokefin/frontend/app/lib/exchangeRate.ts` (lines 9-49)
- `/home/user/Pokefin/frontend/app/lib/marketData.ts` (lines 60, 105-139)
- `/home/user/Pokefin/frontend/app/lib/serverMarketData.ts` (lines 463-630)
- `/home/user/Pokefin/frontend/app/lib/clientMarketData.ts` (lines 48-127)
- `/home/user/Pokefin/frontend/app/lib/supabase.ts` (lines 1-12)
- `/home/user/Pokefin/frontend/app/lib/serverSupabase.ts` (lines 1-25)
- `/home/user/Pokefin/frontend/app/api/account/delete/route.ts` (lines 1-93)
- `/home/user/Pokefin/frontend/app/components/Portfolio/cards/AddHoldingModal.tsx` (lines 48-95, 178)
- `/home/user/Pokefin/frontend/app/components/Portfolio/cards/EditHoldingModal.tsx` (lines 38-80, 178)
- `/home/user/Pokefin/frontend/app/components/Portfolio/cards/ImportHoldingsModal.tsx` (lines 51-134, 286-360)
- `/home/user/Pokefin/frontend/app/components/BoxCalculator/BoxCalculator.tsx` (lines 17-217)
- `/home/user/Pokefin/frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts` (lines 1-204)
- `/home/user/Pokefin/frontend/app/components/BoxCalculator/hooks/useBoosterBoxPrices.ts` (lines 1-86)
- `/home/user/Pokefin/frontend/app/context/AuthContext.tsx` (lines 36-159)
- `/home/user/Pokefin/schema.sql` (lines 4-109)
- `/home/user/Pokefin/migrations/create_box_recipes.sql` (lines 22-48)
- `/home/user/Pokefin/migrations/20260506_market_performance_functions.sql` (lines 14-424)
- `/home/user/Pokefin/main.py` (lines 163, 447-715)
- `/home/user/Pokefin/backfill_historical_prices.py` (lines 53, 471-532, 808-826)
