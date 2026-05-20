# Authorization Implementation — Security Audit

**Repository:** `/home/user/Pokefin`
**Stack:** Next.js (App Router, TS) + Supabase + Python CLI scripts
**Auth model:** Supabase Auth + Row Level Security (RLS). No middleware. No RBAC. Single‑user ownership via `user_id`.
**Date:** 2026‑05‑19

---

## TL;DR

The codebase relies **entirely** on Supabase RLS for authorization. There is exactly **one** Next.js route handler in `frontend/app/api/**` and it correctly verifies the cookie session (`supabase.auth.getUser()`) before acting on `user.id` (no client‑supplied IDs). All other privileged data access happens client‑side via `lib/supabase.ts` (the anon key + the user's JWT) so RLS is the only enforcement layer.

The repository contains RLS DDL for **only one table** (`box_recipes`). For every other user‑owned table (`profiles`, `portfolios`, `portfolio_holdings`, `portfolio_lots`) **no policy DDL is checked into the repo** — the application is silently depending on whatever policies were applied out‑of‑band in the live Supabase project. Supabase MCP confirms `rls_enabled = true` on every public table in the live `Pokéfin` project (`tyrhvavwvphazpmwluft`), but I was **denied permission to `execute_sql` / `get_advisors`**, so I cannot verify the *content* of those policies. Until the migrations are reconciled, the security posture is "unable to verify by code inspection alone" for everything except `box_recipes`.

Risk score: **6.5 / 10** — RLS appears enabled in prod, but missing policy DDL in the repo means a single migration replay or environment recreation would silently leave tables unprotected (anon key → world‑readable + writable). Several lower‑severity issues exist around IDOR via `getHoldingById`, `updatePortfolioName`, the shared‑recipe enumeration, and the absence of post‑fetch ownership checks. There is no privilege‑escalation surface (no `role`/`isAdmin` columns) and no admin/debug routes.

---

## Inventory

### Next.js route handlers (`frontend/app/**/route.ts`)

| File | Method | AuthN check | AuthZ check | Notes |
|---|---|---|---|---|
| `frontend/app/api/account/delete/route.ts` | `DELETE` | `supabase.auth.getUser()` (line 31) | Operates only on `user.id` (line 44, 72) | Uses service_role key (line 59‑68) **server‑side only**. OK. |
| `frontend/app/auth/callback/route.ts` | `GET` | n/a (OAuth callback) | Validates `next` is path‑relative (line 12) | OK. |

That is the **entire** API surface. There are no admin/debug/seed/bulk routes.

### Server‑side data access (`frontend/app/lib/server*.ts`, `page.tsx`)

| File | Tables | Notes |
|---|---|---|
| `frontend/app/lib/serverSupabase.ts` | n/a | Builds a client with the **anon key** (line 6, 18), `persistSession:false`. No user JWT is attached, so all queries run as the `anon` Postgres role. |
| `frontend/app/lib/serverMarketData.ts` | `products`, `product_price_history`, `exchange_rates` | Public market data, read‑only. Fine to be anon‑readable. |

### Client‑side Supabase queries (`frontend/app/lib/*.ts`, `components/**`, `context/AuthContext.tsx`, `account/page.tsx`)

All routed through `frontend/app/lib/supabase.ts` (anon key + user session JWT in cookies). RLS is the only gate.

| Table | Operation | Caller | Ownership filter in code |
|---|---|---|---|
| `profiles` | SELECT/INSERT | `context/AuthContext.tsx:38, 48` | `.eq("id", userId)` (own UID) |
| `profiles` | INSERT (signup) | `context/AuthContext.tsx:145` | client supplies `id: data.user.id` |
| `profiles` | UPDATE | `account/page.tsx:62` | `.eq("id", user!.id)` |
| `profiles` | DELETE | `api/account/delete/route.ts:42` | `.eq("id", user.id)` (server‑verified) |
| `portfolios` | SELECT | `lib/portfolio.ts:24, 61` | `.eq("user_id", userId)` in `getOrCreatePortfolio`; **none** in `getPortfolioById` |
| `portfolios` | INSERT | `lib/portfolio.ts:43` | sets `user_id: userId` from client arg |
| `portfolios` | UPDATE | `lib/portfolio.ts:82` (`updatePortfolioName`) | **only filters by `id`**, no ownership filter |
| `portfolio_holdings` | SELECT | `lib/portfolio.ts:105, 130` | `.eq("portfolio_id", portfolioId)` / `.eq("id", holdingId)` — **no ownership filter** |
| `portfolio_holdings` | INSERT | `lib/portfolio.ts:155` | accepts `portfolio_id` from caller |
| `portfolio_holdings` | UPDATE | `lib/portfolio.ts:183` | `.eq("id", holdingId)` only |
| `portfolio_holdings` | DELETE | `lib/portfolio.ts:202` | `.eq("id", holdingId)` only |
| `product_price_history` | SELECT | several | public reference data |
| `products`, `sets`, `exchange_rates`, etc. | SELECT | several | public reference data |
| `box_recipes` | SELECT | `components/BoxCalculator/hooks/useBoxRecipes.ts:43` | `.eq("user_id", user.id)` |
| `box_recipes` | INSERT/UPDATE/DELETE | same file lines 82/115/153 | client also pins `user_id`; RLS enforces |
| `box_recipes` | SELECT (shared) | line 171 | `.eq("share_code", shareCode)` — public read OK by RLS |

### Migrations / schema

- `schema.sql` — declarative dump, **no policy DDL, no `ENABLE ROW LEVEL SECURITY`** for any user‑owned table. Out of sync with reality (references a `products.active` column not defined in the file).
- `migrations/create_box_recipes.sql` — has `ENABLE ROW LEVEL SECURITY` + four ownership policies + one public‑read policy. Good.
- `migrations/20260506_market_performance_functions.sql` — defines `SECURITY INVOKER` (default) `LANGUAGE sql STABLE` functions over public data. OK.

### Python scripts (`main.py`, `backfill_historical_prices.py`, `compare_prices.py`, `generate_skus.py`, `update_shopify_skus.py`)

All are CLI scripts (`if __name__ == "__main__":` entrypoints; no Flask/FastAPI/HTTPServer imports). They load a key from `secretsFile.SUPABASE_KEY` (`main.py:22`) and call `supabase.table(...).update(...)` on `products` and `product_price_history` (`main.py:521, 661, 702, 710`) — those writes can only succeed if `SUPABASE_KEY` is actually the **service_role** key, in which case the bare anon‑key write would also be allowed if policies permit. Either way: these scripts are run by the operator, not exposed via HTTP, so they are out of scope for endpoint authorization — but see Finding A‑3.

---

## Findings

### A‑1 — Repo only ships RLS DDL for `box_recipes`; all other user‑owned tables have no checked‑in policies

- **Severity:** HIGH (Risk to long‑term posture; in production today MCP shows RLS is enabled on all tables, so live exploitability is **unable to verify**.)
- **CWE:** CWE‑732 Incorrect Permission Assignment / CWE‑1390 Weak Authentication Plus reliance on undocumented config
- **Evidence:**
  - `migrations/create_box_recipes.sql:23‑48` — RLS DDL present for one table.
  - `schema.sql` — `profiles` (78‑86), `portfolios` (40‑48), `portfolio_holdings` (15‑28), `portfolio_lots` (29‑39) all defined **without** `ENABLE ROW LEVEL SECURITY` and **without** any `CREATE POLICY`.
  - `frontend/app/lib/portfolio.ts:200‑212` deletes a holding by id alone — if RLS is ever lost, this is a one‑line BOLA.
  - Live project `tyrhvavwvphazpmwluft` reports `rls_enabled: true` on every public table (Supabase MCP `list_tables`), but the actual policy content cannot be inspected without `execute_sql` access — **unable to verify** that the policies are tight (e.g. that they restrict UPDATE to `user_id = auth.uid()` and not just `auth.role() = 'authenticated'`).
- **Why it matters:** The application is one `supabase db reset && supabase db push` away from running with no policies. Code reviewers cannot reason about authorization from the repo alone. If a new environment (staging, branch DB) is provisioned from the migrations folder, RLS will be **off** for `portfolios`, `portfolio_holdings`, `profiles`, etc., and the anon key will read/write every user's data.
- **PoC (in an environment provisioned only from this repo):**
  ```bash
  # With only the anon key:
  curl -X POST "$SUPABASE_URL/rest/v1/portfolio_holdings?select=*" \
       -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
       -H "Content-Type: application/json" -H "Prefer: return=representation" \
       --data '{"portfolio_id": 1, "product_id": 1, "quantity": 999, "purchase_price_usd": 0, "purchase_date": "2026-01-01"}'
  # Returns 201 because no RLS policy exists.
  ```
- **Remediation (drop‑in migration):**
  ```sql
  -- migrations/0001_enable_rls_user_owned.sql
  ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.portfolios          ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.portfolio_holdings  ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.portfolio_lots      ENABLE ROW LEVEL SECURITY;

  CREATE POLICY profiles_self    ON public.profiles
    FOR ALL TO authenticated
    USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

  CREATE POLICY portfolios_self  ON public.portfolios
    FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

  CREATE POLICY holdings_self    ON public.portfolio_holdings
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.portfolios p
                   WHERE p.id = portfolio_id AND p.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.portfolios p
                   WHERE p.id = portfolio_id AND p.user_id = auth.uid()));

  CREATE POLICY lots_self        ON public.portfolio_lots
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.portfolio_holdings h
                   JOIN public.portfolios p ON p.id = h.portfolio_id
                   WHERE h.id = holding_id AND p.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.portfolio_holdings h
                   JOIN public.portfolios p ON p.id = h.portfolio_id
                   WHERE h.id = holding_id AND p.user_id = auth.uid()));

  -- Public reference tables: explicit anon SELECT, no writes
  ALTER TABLE public.products              ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.product_price_history ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.sets                  ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.generations           ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.product_types         ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.exchange_rates        ENABLE ROW LEVEL SECURITY;

  CREATE POLICY products_read              ON public.products              FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY product_price_history_read ON public.product_price_history FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY sets_read                  ON public.sets                  FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY generations_read           ON public.generations           FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY product_types_read         ON public.product_types         FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY exchange_rates_read        ON public.exchange_rates        FOR SELECT TO anon, authenticated USING (true);
  ```
- **Defense in depth:** Add the policies into `schema.sql` as well so the declarative dump matches reality; add a CI check that fails if `pg_policies` shows zero rows for any `public.*` table referenced from the frontend.

---

### A‑2 — `updatePortfolioName` and `getHoldingById` / `updateHolding` / `deleteHolding` do not assert ownership in the query

- **Severity:** MEDIUM (mitigated only by RLS; defense‑in‑depth missing)
- **CWE:** CWE‑639 Authorization Bypass Through User‑Controlled Key (IDOR/BOLA)
- **Evidence:**
  - `frontend/app/lib/portfolio.ts:77‑94` (`updatePortfolioName`):
    ```ts
    await supabase.from("portfolios").update({ name }).eq("id", portfolioId)
    ```
    No `.eq("user_id", user.id)` and no checking that the calling user owns `portfolioId`. There is no UI calling this today, but the function is exported and will be one day.
  - `frontend/app/lib/portfolio.ts:59‑72` (`getPortfolioById`): same — id‑only.
  - `frontend/app/lib/portfolio.ts:128‑148` (`getHoldingById`), `:178‑195` (`updateHolding`), `:200‑212` (`deleteHolding`): all filter by primary key only.
  - `frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts:91, 156` correctly pair `.eq("id", ...).eq("user_id", user.id)` — proves the pattern is known to the codebase but not used consistently.
- **Why it matters:** Today RLS catches it; the moment RLS is misconfigured (see A‑1), a numeric‑id holding/portfolio is trivially enumerable. Also, queries that return `null` silently when RLS denies make these helpers indistinguishable from "record not found", which masks real bugs.
- **Exploitability:** Today: **none** assuming RLS holds. Without RLS: trivial — incrementing `id` against `/rest/v1/portfolio_holdings?id=eq.N`.
- **Remediation (drop‑in):**
  ```ts
  // frontend/app/lib/portfolio.ts — pattern to apply to update/delete helpers
  export async function deleteHolding(holdingId: number, userId: string): Promise<boolean> {
    // Resolve ownership in one query to avoid TOCTOU
    const { data: owned } = await supabase
      .from("portfolio_holdings")
      .select("id, portfolios!inner(user_id)")
      .eq("id", holdingId)
      .eq("portfolios.user_id", userId)
      .maybeSingle();
    if (!owned) return false;
    const { error } = await supabase
      .from("portfolio_holdings")
      .delete()
      .eq("id", holdingId);
    return !error;
  }
  ```
  Same pattern for `updateHolding`, `getHoldingById`, `updatePortfolioName`, `getPortfolioById`.
- **Defense in depth:** Keep RLS (A‑1) **and** the explicit `.eq("user_id", auth.uid())` so a future RLS regression doesn't immediately become an exploit.

---

### A‑3 — Client‑side `INSERT` into `profiles` lets a logged‑in user pin their own id/email — but `username` can be omitted/spoofed at signup

- **Severity:** LOW (depends on RLS WITH CHECK)
- **CWE:** CWE‑915 Improperly Controlled Modification of Dynamically‑Determined Object Attributes
- **Evidence:** `frontend/app/context/AuthContext.tsx:145‑150` does `supabase.from("profiles").insert({ id: data.user.id, username, email })` **from the browser**. The `id` value is whatever the client sends. RLS *should* enforce `id = auth.uid()` on insert, but no such policy is in the repo (A‑1). The `email` field is also client‑supplied and can diverge from `auth.users.email`.
- **Why it matters:** Without a `WITH CHECK (id = auth.uid())` policy, a logged‑in user could insert a row with someone else's UID (if it doesn't yet exist) and squat on a username, or set `email` to anything (the column is unique‑indexed only on `username`, but downstream UI displays `profile.email`).
- **Remediation:** Move profile creation server‑side (use a Postgres trigger on `auth.users` insert that creates a `profiles` row with `NEW.id, NEW.email`), or include `WITH CHECK (auth.uid() = id)` in the `profiles` INSERT policy and drop the client‑side `email` field (read from `auth.users` instead).
  ```sql
  CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  BEGIN
    INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
  END $$;
  CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  ```

---

### A‑4 — `box_recipes` share‑code policy + sequential PK = enumeration of all "shared" recipes

- **Severity:** LOW (recipes are pack‑configurations, not sensitive PII — informational)
- **CWE:** CWE‑200 Exposure of Sensitive Information through enumeration
- **Evidence:** `migrations/create_box_recipes.sql:26‑28`:
  ```sql
  CREATE POLICY "Shared recipes are viewable by everyone"
    ON public.box_recipes FOR SELECT
    USING (share_code IS NOT NULL);
  ```
  Combined with `id bigint GENERATED ALWAYS AS IDENTITY`, anyone can `GET /rest/v1/box_recipes?share_code=not.is.null&select=*` and pull *every* shared recipe — they don't need the 8‑character share code.
- **Why it matters:** Defeats the "unlisted link" privacy of a share code; user_ids of every sharer are exposed in `user_id` column.
- **Remediation (drop‑in policy):**
  ```sql
  DROP POLICY "Shared recipes are viewable by everyone" ON public.box_recipes;
  -- Require the client to actually present the share_code; PostgREST uses current_setting('request.jwt.claims'),
  -- but the cleanest fix is to expose a SECURITY DEFINER RPC:
  CREATE OR REPLACE FUNCTION public.get_shared_recipe(p_share_code text)
  RETURNS public.box_recipes LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT * FROM public.box_recipes WHERE share_code = p_share_code LIMIT 1;
  $$;
  REVOKE ALL ON FUNCTION public.get_shared_recipe(text) FROM public;
  GRANT  EXECUTE ON FUNCTION public.get_shared_recipe(text) TO anon, authenticated;
  ```
  Then change `useBoxRecipes.ts:170‑174` to `supabase.rpc("get_shared_recipe", { p_share_code })`.
- **Defense in depth:** Strip `user_id` from the returned columns when accessed anonymously; or expose a non‑sequential public id (`uuid`) and never return `user_id` to non‑owners.

---

### A‑5 — `SUPABASE_SERVICE_ROLE_KEY` is correctly used **only** server‑side, but the conditional flow leaves a half‑deleted account

- **Severity:** LOW (UX/data hygiene + minor info leakage)
- **CWE:** CWE‑459 Incomplete Cleanup
- **Evidence:** `frontend/app/api/account/delete/route.ts:55‑87` — when `SUPABASE_SERVICE_ROLE_KEY` is unset, the route deletes the `profiles` row, prints a `console.warn`, and signs the user out. The `auth.users` row plus any `portfolios`/`portfolio_holdings`/`box_recipes` (which depend on `portfolios` and on `user_id`) remain. Foreign keys `portfolios.user_id_fkey → auth.users(id)` and `box_recipes.user_id_fkey → auth.users(id)` are intact, so the orphan `auth.users` row lingers and the user can sign back in to find their portfolio/holdings still present. The route also returns `200 OK` despite the partial outcome.
- **Why it matters:** Misleading "delete account" response → user privacy expectations broken (account deletion did not occur). Combined with A‑1, if RLS is mis‑set, deleted‑profile but still‑authenticated session can still read its own portfolios.
- **Remediation:**
  - Make `SUPABASE_SERVICE_ROLE_KEY` **required** in this route (return `500` if missing) — there is no good reason to ship the account‑delete path without it.
  - Before deleting the `auth.users` row, explicitly delete dependent rows (`portfolio_holdings`, `portfolios`, `box_recipes`) using the admin client (RLS is bypassed) so foreign keys don't block deletion.
  - Wrap in a single SECURITY DEFINER RPC `delete_my_account()` that runs atomically server‑side, called from the route with the user JWT.

---

### A‑6 — `getHoldings` joins to `products` and returns `notes` field unconditionally

- **Severity:** INFORMATIONAL (field‑level)
- **CWE:** CWE‑213 Exposure of Sensitive Information Due to Incompatible Policies
- **Evidence:** `frontend/app/lib/portfolio.ts:103‑123` selects `notes` along with everything else. `notes` is user‑authored free text; today RLS scopes it to the owning portfolio. There is no field‑level redaction layer — every SELECT on `portfolio_holdings` returns full row. If any future RLS policy relaxes (e.g. "shared portfolio"), `notes` will leak.
- **Remediation:** Use `.select("id, portfolio_id, product_id, quantity, purchase_price_usd, purchase_date, ... ")` with `notes` only on owner views; or build a "shared view" via a `SECURITY DEFINER` function that omits `notes`.

---

### A‑7 — `auth/callback` open‑redirect protection is correct but slightly weak

- **Severity:** INFORMATIONAL
- **CWE:** CWE‑601
- **Evidence:** `frontend/app/auth/callback/route.ts:12`:
  ```ts
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  ```
  Good: blocks `//evil.com` and `https://evil.com`. Does **not** block `/\\evil.com` (backslash, some browsers treat as path), or `next=/%2Fevil.com` (URL‑decoded by `URL` constructor used inside `NextResponse.redirect`). `new URL(safeNext, request.url)` is called next, which will resolve relative to the request origin, so `/%2F` becomes `/<encoded slash>` and is safe. The bypass surface is minimal, but the check is fragile.
- **Remediation:** Allowlist explicit paths or `URL`-parse:
  ```ts
  let safeNext = "/";
  if (next) {
    try {
      const target = new URL(next, request.url);
      if (target.origin === new URL(request.url).origin) safeNext = target.pathname + target.search;
    } catch { /* keep default */ }
  }
  ```

---

### A‑8 — No CSRF defense for the `DELETE /api/account/delete` endpoint (cookie auth)

- **Severity:** LOW (browser preflight + Supabase cookie SameSite mitigate)
- **CWE:** CWE‑352
- **Evidence:** `frontend/app/api/account/delete/route.ts` reads the Supabase session from cookies. There is no `Origin`/`Referer` check, no CSRF token, no custom header requirement. The default Supabase SSR cookie is `SameSite=Lax`, and `DELETE` triggers a CORS preflight (browsers will refuse cross‑origin DELETE without explicit `Access-Control-Allow-Methods`, which the route does not emit). So the practical risk is very low, but the protection is implicit.
- **Remediation:** Require a custom header set by the SPA, e.g. `X-Pokefin-Request: 1`, and reject if absent (preflight will block any cross‑origin attempt). Optionally also assert `Origin` matches `request.nextUrl.origin`.
  ```ts
  if (request.headers.get("x-pokefin-request") !== "1") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  ```

---

### A‑9 — `schema.sql` is out of sync with the live database

- **Severity:** INFORMATIONAL (process risk)
- **Evidence:** `schema.sql:1` says "for context only and is not meant to be run". `serverMarketData.ts:491` and `clientMarketData.ts:38` filter on `products.active`, but `schema.sql:63‑77` does not contain an `active` column. The `20260506_market_performance_functions.sql:11‑12` adds an index on `products.active`. Migrations are not numbered consistently (`create_box_recipes.sql` vs `20260506_…sql`).
- **Why it matters:** New developers / new environments cannot reproduce the schema or its RLS posture from this repo. Reviewers cannot statically verify policies. Reconciliation is the root cause of A‑1.
- **Remediation:** Regenerate `schema.sql` from `pg_dump --schema-only` and check the **complete** definition (including `pg_policies`) into the repo, or replace it with a single `supabase db dump` artifact updated by CI.

---

### A‑10 — Python scripts use a single `SUPABASE_KEY` of unknown role

- **Severity:** INFORMATIONAL (out of HTTP scope; operational hygiene)
- **Evidence:** `main.py:22, 163` loads `SUPABASE_KEY` from `secretsFile`. `main.py:521, 661, 702, 710` performs writes on `products` and `product_price_history`. To succeed against RLS those writes need a service_role key (or a permissive policy). The variable name does not encode the role; `secretsFileTemplate.py:1‑2` leaves both fields blank.
- **Remediation:** Rename to `SUPABASE_SERVICE_ROLE_KEY`, document in `BACKFILL_README.md` that the data scripts require service_role, and ensure `secretsFile.py` is gitignored (it is — `.gitignore` covers it).

---

## Per‑checklist matrix

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | BOLA/IDOR — ownership checks on GET/PUT/DELETE /:id | **FAIL** (defense‑in‑depth) | See A‑2 — relies solely on RLS for `portfolios`/`portfolio_holdings` ops. |
| 2 | Broken Function Level AuthZ — role/permission checks on privileged routes | **N/A** | No roles, single route handler. |
| 3 | Missing AuthZ checks on sensitive endpoints | **PASS** | Only sensitive route `DELETE /api/account/delete` calls `getUser()` first. |
| 4 | RBAC — explicit role→permission mapping | **N/A** | No roles in the app. |
| 5 | Privilege escalation — `role`/`tenantId`/`isAdmin` columns | **PASS** | None exist. |
| 6 | JWT validation on every protected route | **PASS** | Done via Supabase SSR helpers (`getUser` re‑validates with the auth server). |
| 7 | API token scope enforcement | **PASS (limited)** | service_role key only used inside one route handler; anon key elsewhere. |
| 8 | Multi‑tenant isolation | **N/A** | Single‑tenant per user. |
| 9 | Bulk endpoint protections | **N/A** | No bulk endpoints. Closest is `importHoldings` (`frontend/app/lib/import.ts:414`) which loops `addHolding` client‑side; each insert is RLS‑gated. |
| 10 | Field‑level authorization | **WEAK** | See A‑6 — `notes` returned unconditionally. |
| 11 | Error handling & resource enumeration | **WEAK** | A‑4: shared recipes can be listed without share code. RLS returns "no rows" vs "exists but forbidden" uniformly — good. |
| 12 | Middleware ordering | **N/A** | No Next.js `middleware.ts` exists; auth is per‑page and per‑route handler. |
| 13 | CORS & CSRF | **WEAK** | No explicit CORS config (Next defaults to same‑origin). No CSRF token on DELETE route — see A‑8. |
| 14 | Open redirect protections | **PASS (fragile)** | A‑7 — present but could be tightened. |
| 15 | Fallback/debug routes | **PASS** | None exist. |
| Supabase: RLS enabled on every table | **PASS in live DB, FAIL in repo** | MCP `list_tables` shows `rls_enabled: true` for all 12 public tables, but only 1 has policies in migrations. |
| Supabase: SELECT/INSERT/UPDATE/DELETE policies per table | **Unable to verify** | `execute_sql` permission denied — cannot inspect `pg_policies`. Recommend running `select * from pg_policies where schemaname='public'`. |
| Supabase: service_role key not used client‑side | **PASS** | Only referenced at `frontend/app/api/account/delete/route.ts:55` (server). |
| Supabase: `serverSupabase.ts` uses anon key | **PASS** | `frontend/app/lib/serverSupabase.ts:6, 18`. |

---

## Top fixes, prioritized

1. **Check policy DDL into the repo for every user‑owned table (A‑1).** Highest leverage, blocks A‑2/A‑3 from becoming exploitable on a single mis‑deploy. Snippet provided.
2. **Add defense‑in‑depth `user_id` filters to `updatePortfolioName`, `updateHolding`, `deleteHolding`, `getHoldingById`, `getPortfolioById` (A‑2).** Cheap, eliminates a class of regressions.
3. **Fix `box_recipes` share‑code policy so it requires the share code rather than just `share_code IS NOT NULL` (A‑4).** Currently lets anyone list every "shared" recipe and its `user_id`.
4. **Make `SUPABASE_SERVICE_ROLE_KEY` mandatory in `DELETE /api/account/delete` and delete dependent rows transactionally (A‑5).** Closes the half‑deleted‑account loop.
5. **Move profile creation to an `auth.users` trigger and drop client‑side `email`/`id` (A‑3).** Eliminates the row‑spoofing mass‑assignment surface entirely.

---

## Verification gaps ("unable to verify")

- Live policy content per table (`pg_policies`) — denied `execute_sql`.
- Whether `SUPABASE_KEY` used by Python scripts is service_role or anon — file is gitignored.
- Whether `auth.users` has an existing `handle_new_user`‑style trigger that supersedes the client‑side INSERT into `profiles`.
- Whether Supabase Auth is configured with email confirmation enabled (impacts squatting risk on `profiles.email`).

If those can be answered (especially `pg_policies` dump), several "WEAK" rows above can move to PASS or FAIL deterministically.

---

## File map (absolute paths, for reviewers)

- Route handlers: `/home/user/Pokefin/frontend/app/api/account/delete/route.ts`, `/home/user/Pokefin/frontend/app/auth/callback/route.ts`
- Server data access: `/home/user/Pokefin/frontend/app/lib/serverSupabase.ts`, `/home/user/Pokefin/frontend/app/lib/serverMarketData.ts`
- Client data access (RLS‑gated): `/home/user/Pokefin/frontend/app/lib/supabase.ts`, `/home/user/Pokefin/frontend/app/lib/portfolio.ts`, `/home/user/Pokefin/frontend/app/lib/import.ts`, `/home/user/Pokefin/frontend/app/lib/exchangeRate.ts`, `/home/user/Pokefin/frontend/app/lib/clientMarketData.ts`, `/home/user/Pokefin/frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts`, `/home/user/Pokefin/frontend/app/context/AuthContext.tsx`, `/home/user/Pokefin/frontend/app/account/page.tsx`
- Migrations & schema: `/home/user/Pokefin/schema.sql`, `/home/user/Pokefin/migrations/create_box_recipes.sql`, `/home/user/Pokefin/migrations/20260506_market_performance_functions.sql`
- Out‑of‑scope (CLI scripts): `/home/user/Pokefin/main.py`, `/home/user/Pokefin/backfill_historical_prices.py`, `/home/user/Pokefin/compare_prices.py`, `/home/user/Pokefin/generate_skus.py`, `/home/user/Pokefin/update_shopify_skus.py`
