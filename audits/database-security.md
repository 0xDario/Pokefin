# Database Security Audit — Pokefin

**Scope:** Database interactions only. Branch `claude/security-vulnerability-analysis-LT3JQ` (post-hardening).
**Date:** 2026-05-21
**Auditor:** Automated static review (Claude Code)
**Stack:** Next.js 15 (App Router) + Supabase (Postgres / Auth / Storage / PostgREST), anon-key client from the frontend, Python scrapers using a key from a gitignored `secretsFile.py`.

This is a fresh DB-focused review of the code as it stands now. Earlier audits in `audits/*.md` were read for context only. Where a finding cannot be confirmed from source (live role grants, Supabase backup config, network ACLs), it is marked **Unable to verify** with the proof that would settle it.

---

## Summary

The post-hardening state is materially good. Migrations `0001`–`0005` introduce RLS, integrity constraints, cascade deletes, a SECURITY DEFINER account-deletion RPC, and CSPRNG share codes. There is **no string-concatenated SQL anywhere** — the Python scrapers and the frontend exclusively use the PostgREST/`supabase-py` query builder, and SQL identifiers in migrations are static. NoSQL injection is not applicable (Postgres only) and no raw user JSON is fed into a query filter.

The remaining issues are real but bounded:

- **The single most important finding is the scraper key.** The Python scrapers write to RLS-enabled reference tables. Per the comment in `0001` (lines 56–60) this *only works* if the scraper uses `service_role`. If true, a full-superuser-equivalent key sits in a developer-managed `secretsFile.py` with no rotation story and is shared across `main.py`, `backfill_historical_prices.py`, `generate_skus.py`, `update_shopify_skus.py`, `compare_prices.py`. This is the highest-risk item and is **Unable to verify** from code alone.
- **`box_recipes` RLS coverage is split across files.** Migration `0001` (the file the task asked to verify "covers every table") does **not** enable RLS or create policies for `box_recipes`. Coverage depends on the older, non-idempotent `migrations/create_box_recipes.sql` having been applied first, plus `0005`. This is a migration-ordering hazard, not a confirmed gap.
- **Schema integrity gaps:** `portfolios.user_id` and `box_recipes.user_id` are **nullable** ownership columns; `0003` did not add `NOT NULL`. RLS still blocks cross-tenant reads, but a NULL `user_id` row is an orphan no policy will ever match.
- **No statement timeout, no audit logging, no analytics-export masking** are configured in-repo (all are Supabase-side and **Unable to verify**).

**Risk score: 4 / 10** (Medium). No critical code-level vulnerability. Score is held up by the unverified `service_role` key handling and the migration-ordering fragility; it would drop to ~2 if the scraper used a scoped role and `box_recipes` RLS were folded into `0001`.

---

## Findings

### DB-1 — Scraper key is almost certainly `service_role`; stored unrotated in a flat file, shared across 5 scripts
- **Severity:** High
- **CWE:** CWE-798 (Use of Hard-coded Credentials — here, long-lived static credential in a config file), CWE-269 (Improper Privilege Management)
- **Evidence:**
  - `migrations/0001_enable_rls_and_policies.sql:56-60` — comment: *"Only service_role bypasses RLS by default, which is what the Python scrapers must use to populate prices."*
  - `main.py:22,163` — `from secretsFile import SUPABASE_URL, SUPABASE_KEY` / `supabase = create_client(SUPABASE_URL, SUPABASE_KEY)`; writes via `supabase.table("products").update(...)` (`main.py:661`), `supabase.table("product_price_history").insert(...)` (`main.py:702,710`), `supabase.table("exchange_rates").insert(...)` (`main.py:499`).
  - `backfill_historical_prices.py:41,53` — same key import; `insert` into `product_price_history` (`backfill_historical_prices.py:518,526`).
  - `generate_skus.py:264` and `update_shopify_skus.py`, `compare_prices.py` — same shared key.
  - `products`, `product_price_history`, `exchange_rates` are RLS-enabled with **read-only** policies for `anon`/`authenticated` (`0001:62-97`). With RLS on and no `INSERT`/`UPDATE` policy for any role, **only `service_role` (RLS-bypassing) can write** — so the scraper key must be `service_role`.
- **Why it matters:** The `service_role` key bypasses *all* RLS on *every* table including `auth.users`, `profiles`, `portfolios`. One key leak (a committed `secretsFile.py`, a CI log, a compromised scraper host) exposes every user's PII and portfolio and allows arbitrary data destruction. The same key is reused by 5 scripts, so blast radius and rotation cost are maximal. There is no rotation mechanism in-repo.
- **Exploitability + minimal PoC:** Anyone who reads the key can run, from any host:
  ```python
  from supabase import create_client
  c = create_client(URL, LEAKED_SERVICE_KEY)
  c.table("profiles").select("id,email").execute()      # all users' emails
  c.table("portfolio_holdings").delete().neq("id", 0).execute()  # wipe everyone
  ```
- **Remediation (minimal, DB-side):** Create a dedicated low-privilege scraper role instead of using `service_role`. The scraper only needs write to 3 reference tables:
  ```sql
  -- one-time, run as project owner
  CREATE ROLE scraper NOLOGIN;
  GRANT scraper TO authenticator;          -- so PostgREST can assume it
  GRANT USAGE ON SCHEMA public TO scraper;
  GRANT SELECT, INSERT, UPDATE ON public.products,
        public.product_price_history, public.exchange_rates TO scraper;
  -- give scraper a JWT with "role":"scraper" and INSERT/UPDATE policies:
  CREATE POLICY scraper_write_products ON public.products
    FOR ALL TO scraper USING (true) WITH CHECK (true);
  CREATE POLICY scraper_write_pph ON public.product_price_history
    FOR ALL TO scraper USING (true) WITH CHECK (true);
  CREATE POLICY scraper_write_fx ON public.exchange_rates
    FOR ALL TO scraper USING (true) WITH CHECK (true);
  ```
  Issue the scraper a signed JWT with `"role":"scraper"` (not the project `service_role` secret) and put *that* in `secretsFile.py`.
- **Defense-in-depth:** Move the secret to a managed secret store (the scraper host's environment / a vault), not a file; set a calendar-driven rotation; restrict scraper host egress; alert on any `service_role` use outside the function tier.
- **Status note:** Whether the key is actually `service_role` is **Unable to verify** from source. Proof: `SELECT current_setting('request.jwt.claims', true);` while the scraper is connected, or inspect the JWT `role` claim in `secretsFile.py` on the deploy host.

---

### DB-2 — `box_recipes` RLS is not covered by migration `0001`; coverage depends on migration ordering
- **Severity:** Medium
- **CWE:** CWE-1188 (Insecure Default Initialization), CWE-285 (Improper Authorization) if applied out of order
- **Evidence:**
  - `migrations/0001_enable_rls_and_policies.sql` — enables RLS and adds policies for `profiles`, `portfolios`, `portfolio_holdings`, `portfolio_lots`, `products`, `product_price_history`, `sets`, `generations`, `product_types`, `exchange_rates`. `box_recipes` is **absent** (confirmed by grep — only `sets/generations/product_types` match, no `box_recipes`).
  - `box_recipes` RLS + per-operation policies live only in `migrations/create_box_recipes.sql:22-48` (which is **not** idempotent — bare `CREATE POLICY`, no `DO $$ ... EXCEPTION$$` wrapper, no numeric prefix in the documented run order in `HARDENING_FOLLOWUPS.md`).
  - `0005_box_recipes_share_code_hardening.sql` *modifies* a `box_recipes` policy (`DROP POLICY IF EXISTS "Shared recipes are viewable by everyone"`) and assumes the table + RLS already exist.
- **Why it matters:** The task explicitly asked whether `0001` "covers every table that exists in `schema.sql`." It does not — `box_recipes` is in `schema.sql` but not in `0001`. If `create_box_recipes.sql` was never applied (it is not in the `HARDENING_FOLLOWUPS.md` numbered run list), `box_recipes` would have **RLS disabled**, meaning the `anon` key could read and write every user's recipes. If RLS is enabled but the SELECT/INSERT/UPDATE/DELETE policies from `create_box_recipes.sql` were skipped, all access would be denied (functional break) — still not a leak, but a fragility.
- **Exploitability:** Conditional — only exploitable if `create_box_recipes.sql` was skipped. With it applied, `box_recipes` is correctly owner-scoped (`useBoxRecipes.ts` always filters `.eq("user_id", user.id)` as defense-in-depth, and `0005` removed the anon enumeration path). PoC if RLS is off: anon client `supabase.from("box_recipes").select("*")` returns all rows.
- **Remediation (minimal):** Fold `box_recipes` RLS into `0001` so the "enable RLS on everything" migration is genuinely complete and idempotent:
  ```sql
  -- append to 0001
  ALTER TABLE public.box_recipes ENABLE ROW LEVEL SECURITY;
  DO $$ BEGIN
    CREATE POLICY box_recipes_self ON public.box_recipes
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  ```
- **Defense-in-depth:** Run the `HARDENING_FOLLOWUPS.md` assertion `SELECT tablename, rowsecurity, policy_count ...` as a CI gate; fail the pipeline if any `public` table has `rowsecurity = false` or `policy_count = 0`.
- **Status note:** Whether `box_recipes` RLS is actually on in production is **Unable to verify**. Proof: the assertion query above.

---

### DB-3 — Ownership columns `portfolios.user_id` and `box_recipes.user_id` are nullable
- **Severity:** Medium
- **CWE:** CWE-710 (Improper Adherence to Coding Standards — missing integrity constraint), contributes to CWE-284
- **Evidence:**
  - `schema.sql:42` — `portfolios.user_id uuid NOT NULL` *(this one is actually NOT NULL — good).*
  - `schema.sql:89` — `box_recipes.user_id uuid` — **nullable**; `migrations/create_box_recipes.sql:6` confirms `user_id uuid` with no `NOT NULL`.
  - `migrations/0003_integrity_constraints.sql` adds many CHECK/unique constraints but **does not** add `NOT NULL` to `box_recipes.user_id`.
  - The task brief flagged `portfolios.user_id` too; in the current `schema.sql` it is already `NOT NULL`, so only `box_recipes.user_id` is the live gap.
- **Why it matters:** A `box_recipes` row with `user_id = NULL` matches **no** RLS policy (`auth.uid() = user_id` is `NULL`, i.e. false) — so it is orphaned and invisible to every user including its creator, but still consumes storage and could be surfaced by a future definer RPC that forgets the `is_public` guard. A nullable ownership column is also a latent privilege bug: any future policy of the form `USING (user_id IS NULL OR user_id = auth.uid())` would leak. The `INSERT` policy `WITH CHECK (auth.uid() = user_id)` blocks a client from inserting NULL today, but a `service_role`/migration insert is unconstrained.
- **Exploitability:** Low directly (RLS still denies cross-tenant reads). It is a data-integrity / defense-in-depth gap.
- **Remediation (minimal):**
  ```sql
  -- after cleaning any existing NULLs:
  -- DELETE FROM public.box_recipes WHERE user_id IS NULL;  (or assign an owner)
  ALTER TABLE public.box_recipes
    ALTER COLUMN user_id SET NOT NULL;
  ```
- **Defense-in-depth:** Add the same `NOT NULL` discipline to any future user-owned table; assert ownership-column nullability in CI.

---

### DB-4 — No statement/query timeout configured for app or scraper roles
- **Severity:** Medium
- **CWE:** CWE-400 (Uncontrolled Resource Consumption)
- **Evidence:**
  - Frontend: PostgREST query builder calls throughout `portfolio.ts`, `serverMarketData.ts`, `clientMarketData.ts` — no per-request timeout is set, and `supabase.ts` / `serverSupabase.ts` create the client with only `{ auth: { flowType: "pkce" } }`.
  - The market RPCs (`get_market_product_metrics`, `get_set_analytics` in `20260506_market_performance_functions.sql`) are heavy: multiple correlated subqueries, 6 anchor subqueries per product, window functions, `percentile_cont`. `get_set_analytics` calls `get_market_product_metrics()` which is itself expensive — and the fallback path `fetchSetAnalyticsFallback()` pages through `product_price_history` in 1000-row chunks with no upper page cap (`serverMarketData.ts:186-210`).
  - Scrapers: `supabase-py` calls have no DB-side timeout; HTTP timeouts on the *external* scrape API exist (`main.py:111` `timeout=15`) but those are not DB timeouts.
- **Why it matters:** A slow or runaway `get_set_analytics` on a free-tier Postgres can pin a connection indefinitely; with no `statement_timeout` a single expensive request degrades the whole instance. The unbounded pagination loop in `fetchSetAnalyticsFallback` will fetch the entire price-history table if the RPC is missing.
- **Exploitability:** Low/DoS — an attacker repeatedly hitting `/market` (which triggers `getCachedSetAnalytics`) before the 3600s cache warms could amplify load. Mitigated somewhat by `unstable_cache` revalidate=3600.
- **Remediation (minimal):** Set a role-scoped statement timeout in a migration:
  ```sql
  ALTER ROLE authenticated     SET statement_timeout = '8s';
  ALTER ROLE anon              SET statement_timeout = '8s';
  -- scraper writes are batched; allow a little more:
  ALTER ROLE service_role      SET statement_timeout = '30s';
  ```
- **Defense-in-depth:** Add a hard page cap (e.g. `if (from > 200000) break;`) to the `while (true)` loops in `serverMarketData.ts`; consider a materialized view for `get_set_analytics`.

---

### DB-5 — PII (email) duplicated into `public.profiles`; logged operations and account-deletion path partially mitigate but PII minimization is weak
- **Severity:** Low
- **CWE:** CWE-359 (Exposure of Private Personal Information)
- **Evidence:**
  - `schema.sql:78-86` — `profiles` stores `email text` (and `username`). `migrations/0004_handle_new_user_trigger.sql:12-17` copies `NEW.email` from `auth.users` into `public.profiles` on signup.
  - This is a *duplicate* of the email already in `auth.users`. The `profiles` row is readable by the row owner via RLS (`profiles_self`, `0001:14-19`) — acceptable — but the duplication widens the PII surface (now two tables to protect, two to purge).
  - Deletion: `delete_my_account()` (`0002:40-56`) deletes `auth.users` and cascades to `profiles` via `profiles_id_fkey ... ON DELETE CASCADE` (`0002:29-32`) — good, the duplicate *is* purged.
  - Logging: error logs are redacted to `{ code }` only (`portfolio.ts:72,97,...`, `route.ts:62`, `useBoxRecipes.ts:48,...`) — **good, no PII or row data in logs.**
- **Why it matters:** Storing email in `public.profiles` is not required for the app (the frontend reads `profile.email` but could read it from the session `user`). Every extra copy of PII is extra retention/breach surface and must be covered by the same deletion guarantees.
- **Exploitability:** None directly — RLS scopes `profiles` to its owner.
- **Remediation (minimal):** Either drop the `email` column from `profiles` and source email from the auth session, or document it as an intentional denormalization. If kept, ensure analytics/ETL never selects it (see DB-9).
- **Defense-in-depth:** Confirm Supabase log retention and that the `console.error` sink (Vercel logs) is access-controlled.

---

### DB-6 — `delete_my_account()` and other DDL run with project-owner privileges; no audit log of sensitive operations
- **Severity:** Low
- **CWE:** CWE-778 (Insufficient Logging)
- **Evidence:**
  - `0002:40-56` `delete_my_account()` is `SECURITY DEFINER` and performs `DELETE FROM auth.users`. The deletion is correctly scoped to `auth.uid()` and rejects unauthenticated callers (`0002:47-49`), `EXECUTE` is granted only to `authenticated` (`0002:58-59`) — this is well done.
  - However there is **no audit trail**: a successful account deletion, a schema change, a GRANT, or a failed login leaves no application-level record. `route.ts:62` logs only `delete_my_account_failed` on error; a *successful* delete is silent.
- **Why it matters:** Without an audit log, a malicious or buggy mass-deletion, or abuse of a leaked credential (DB-1), is invisible after the fact. Compliance regimes (GDPR Art. 30, SOC 2) expect a record of deletions and privileged operations.
- **Exploitability:** N/A — this is a detection gap, not a vuln.
- **Remediation (minimal):** Record deletions before the cascade:
  ```sql
  CREATE TABLE IF NOT EXISTS public.account_deletion_log (
    deleted_user uuid, deleted_at timestamptz NOT NULL DEFAULT now());
  -- inside delete_my_account(), before the DELETE:
  INSERT INTO public.account_deletion_log(deleted_user) VALUES (auth.uid());
  ```
  (Lock the table down: `REVOKE ALL ON public.account_deletion_log FROM anon, authenticated;` and only the definer function writes it.)
- **Defense-in-depth:** Enable Supabase Postgres logs / `pgaudit` for DDL and role changes; alert on `service_role` connections. Supabase-side — **Unable to verify** here.

---

### DB-7 — Multi-step portfolio operations are not transactional
- **Severity:** Low
- **CWE:** CWE-662 (Improper Synchronization) / data-consistency
- **Evidence:**
  - `import.ts:414-459` `importHoldings()` loops and calls `addHolding()` one row at a time over PostgREST — each insert is its own implicit transaction. A failure midway leaves a partially imported portfolio with no rollback.
  - `portfolio.ts:21-54` `getOrCreatePortfolio()` does a `select` then a separate `insert` (read-then-write). The TOCTOU window is correctly closed at the DB layer by the `portfolios_user_id_uidx` unique index (`0003:40-41`) and the insert handles `23505` upstream — acceptable.
  - `updateHolding`/`deleteHolding` (`portfolio.ts:220-262`) do an ownership `SELECT` then a separate `UPDATE`/`DELETE` — two round trips, non-atomic, but RLS independently enforces ownership on the mutation so a race cannot escalate privilege; worst case is a redundant denied write.
- **Why it matters:** A CSV import that fails halfway is not rolled back; the user sees a confusing partial state. The idempotency key (`0003:55-60`, `addHolding` `portfolio.ts:198-199`) makes a *retry* safe, which mitigates the worst of it.
- **Exploitability:** None — consistency/UX issue, not a security bypass.
- **Remediation (minimal):** Move bulk import into a single SECURITY INVOKER RPC that inserts all rows in one transaction (`LANGUAGE sql` or a `plpgsql` function with the whole insert in one statement), so RLS still applies and the batch is all-or-nothing.
- **Defense-in-depth:** Keep the idempotency key; surface partial-import results clearly to the user (already done via `importStatus`).

---

### DB-8 — `useBoxRecipes.ts` uses `select("*")`; minor field-over-fetch
- **Severity:** Low
- **CWE:** CWE-213 (Exposure of Sensitive Information Due to Incompatible Policies) — here, over-broad projection
- **Evidence:** `useBoxRecipes.ts:43` — `.from("box_recipes").select("*")`. Every other frontend query uses explicit column lists (`portfolio.ts`, `serverMarketData.ts`, etc.) — `box_recipes` is the lone `SELECT *`.
- **Why it matters:** `select("*")` returns whatever columns the table grows in future (e.g. an internal flag) without a code change, and ships them to the browser. Today `box_recipes` has no secret column so impact is minimal, but it is a maintenance hazard and inconsistent with the rest of the codebase.
- **Exploitability:** None today.
- **Remediation (minimal):**
  ```ts
  .select("id, name, retail_price, promo_value, packs, share_code, is_public, user_id, created_at, updated_at")
  ```
- **Defense-in-depth:** Lint rule banning `.select("*")`.

---

### DB-9 — No PII masking on the analytics/ETL read path
- **Severity:** Low
- **CWE:** CWE-359
- **Evidence:** `serverMarketData.ts` and `clientMarketData.ts` query `products`, `product_price_history`, `exchange_rates`, `sets` — none contain PII, so the *market* analytics path is clean. There is no separate ETL/export job in-repo. The only PII tables (`profiles`, `portfolios`, `portfolio_holdings`) are not read by analytics code.
- **Why it matters:** Mostly informational — there is currently no analytics export of PII. The risk is future: if portfolio analytics are ever aggregated for reporting, they must mask `user_id`/email.
- **Remediation:** N/A today. If an export job is added, aggregate without per-user identifiers.
- **Status note:** No external analytics/ETL pipeline observed in the repo. **Unable to verify** any out-of-repo BI connector.

---

## SECURITY DEFINER function review (requested focus)

All four definer functions were checked for pinned `search_path` and injectable dynamic SQL:

| Function | File | `search_path` pinned? | Dynamic SQL? | Verdict |
|---|---|---|---|---|
| `delete_my_account()` | `0002:40-56` | Yes — `SET search_path = public, auth` (`0002:44`) | No (static `DELETE`) | **Safe.** Scoped to `auth.uid()`, rejects anon, `EXECUTE` to `authenticated` only. |
| `handle_new_user()` | `0004:5-21` | Yes — `SET search_path = public` (`0004:9`) | No (static `INSERT ... ON CONFLICT`) | **Safe.** Reads `NEW.email`/`raw_user_meta_data->>'username'`; the `profiles_username_format` CHECK (`0003:66-68`) constrains the username. Trigger only fires on `auth.users` INSERT. |
| `get_shared_recipe(text)` | `0005:21-33` | Yes — `SET search_path = public` (`0005:26`) | No — `p_share_code` is a bound parameter in a `LANGUAGE sql` body | **Safe.** Returns `SETOF` with `LIMIT 1` and `is_public = true`; `EXECUTE` to `anon, authenticated`. Correctly prevents anon enumeration (no filterable table exposed). |
| `get_market_product_metrics()` / `get_market_product_summaries()` / `get_set_analytics()` | `20260506_market_performance_functions.sql` | **No `SET search_path`** | No dynamic SQL (static `LANGUAGE sql`) | **Low-risk but inconsistent.** These are `LANGUAGE sql STABLE` and **not** `SECURITY DEFINER` — they run as the invoker, so an unpinned `search_path` is far less dangerous. Still, pin it for consistency: append `SET search_path = public` to each `CREATE FUNCTION`. All table refs are already schema-qualified (`public.products`, etc.), which neutralizes most search-path risk. |

No injectable dynamic SQL (`EXECUTE format(...)`, string-built queries) exists in any migration. `DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT` in `0002`/`0003` operate on fixed identifiers — not destructive of data, and idempotent.

**Recommendation:** Add `SET search_path = public` to the three market functions in `20260506_market_performance_functions.sql` for defense-in-depth and consistency with `0002`/`0004`/`0005`.

---

## Parameterized-queries / injection verdict (CRITICAL flags)

- **String-concatenated SQL:** **None found.** Searched all Python scripts and all frontend `.ts`. Every DB call uses the `supabase-py` / PostgREST query builder (`.table().select()/.insert()/.update()/.eq()/.or_()/.range()`). Builder methods bind values as parameters; column/table names are static literals.
- **`main.py:518`** builds an `or_` filter *string* (`or_filter = f"last_updated.is.null,..."`) — but every interpolated value is an ISO timestamp from `datetime.isoformat()` (server-generated, not user input). PostgREST parses this as a filter expression; it is not SQL and not user-controlled. Not a vuln, but noted: if a *user-controlled* value were ever placed in an `.or_()` string, PostgREST filter-injection would be possible. Keep `.or_()` arguments free of untrusted input.
- **`backfill_historical_prices.py:483-485`** interpolates `start_date`/`end_date` into `.gte()`/`.lte()` strings — both are `strftime("%Y-%m-%d")` of internally computed dates, not user input. Safe.
- **LIKE/ILIKE:** `portfolio.ts:446-448` `escapeLike()` correctly escapes `%`, `_`, `\` before every `.ilike()` call (`portfolio.ts:463,482`). This is the recently-added fix and it is correct (`/[%_\\]/g` with `\\$&` replacement). Good.
- **NoSQL injection:** **Not applicable** — Postgres only. No document store, no `$where`/`$regex`. No raw user JSON is passed into a query filter. The `packs jsonb` column (`box_recipes`) is written via `toDbPacks()` which produces a typed `{set_id, quantity}[]` — the array is parameter-bound by PostgREST, not concatenated.

**No CRITICAL findings.**

---

## Top prioritized fixes

1. **DB-1 — Replace the `service_role` scraper key with a scoped `scraper` role + JWT.** Highest blast radius. Confirm what `secretsFile.py` actually holds and downgrade it.
2. **DB-2 — Fold `box_recipes` RLS enable + owner policy into `0001`** and make the bare `CREATE POLICY` statements in `create_box_recipes.sql` idempotent (or retire that file). Add the `rowsecurity`/`policy_count` assertion as a CI gate.
3. **DB-3 — `ALTER TABLE box_recipes ALTER COLUMN user_id SET NOT NULL`** (after cleaning NULLs). Eliminates orphan-row / latent-policy risk.
4. **DB-4 — Set `statement_timeout` on `anon`/`authenticated`/`service_role`** and add a hard page cap to the unbounded pagination loops in `serverMarketData.ts`.
5. **DB-6 — Add an `account_deletion_log` insert inside `delete_my_account()`** and enable Supabase DDL/role-change audit logging.

---

## Checklist (29 items)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Parameterized queries / ORM usage | **Pass** | No string-concatenated SQL anywhere; builder used throughout. `escapeLike` (`portfolio.ts:446`) handles ILIKE. |
| 2 | Connection string security | **Pass** | Frontend uses `NEXT_PUBLIC_SUPABASE_*` env vars (`supabase.ts:3-4`); scrapers import from gitignored `secretsFile.py` (`.gitignore:1`); template is empty (`secretsFileTemplate.py`). No hardcoded secrets in tracked files. |
| 3 | DB user least privilege | **Fail** | DB-1 — scraper key is almost certainly `service_role`, shared by 5 scripts. App account = anon key (correct, least-priv). Live grants **Unable to verify**. |
| 4 | Sensitive data encryption at rest | **Not Applicable / Unable to verify** | Supabase encrypts at rest natively; no app-managed tokens stored in columns. Confirm in Supabase dashboard. |
| 5 | PII handling compliance | **Pass (minor)** | DB-5 — email duplicated into `profiles`; logs are redacted to `{code}` only; deletion cascade purges PII. |
| 6 | Query timeout configuration | **Fail** | DB-4 — no `statement_timeout` set for any role; no per-request driver timeout. |
| 7 | Connection pool settings | **Unable to verify** | Pooling handled by Supabase (PgBouncer / Supavisor); not configurable in-repo. Confirm pool mode/limits in dashboard. |
| 8 | Transaction handling + rollback | **Fail (low)** | DB-7 — `importHoldings` loops non-atomic inserts; no rollback. Idempotency key mitigates retries. |
| 9 | Audit logging for sensitive ops | **Fail** | DB-6 — no app-level audit of deletions/DDL/failed logins. |
| 10 | NoSQL injection hardening | **Not Applicable** | Postgres only; confirmed no raw user JSON into filters; `.or_()` strings carry only server-generated values. |
| 11 | Row/Tenant isolation (RLS) | **Pass (with caveat)** | `0001` covers 10 tables with correct owner/read policies; `box_recipes` covered only via `create_box_recipes.sql` + `0005` — see DB-2. Server-side ownership filters present in `portfolio.ts`. |
| 12 | Least-privilege networking | **Unable to verify** | Supabase-managed; no VPC/ACL config in repo. Confirm DB is not directly exposed and network restrictions in dashboard. |
| 13 | TLS in transit & cert validation | **Pass / Unable to verify** | `supabase-py` and `@supabase/ssr` connect over HTTPS to the Supabase REST endpoint (TLS enforced by default). Direct Postgres `sslmode` N/A — no direct driver connections. |
| 14 | Secret management & rotation | **Fail** | DB-1 — scraper key in a flat file, no rotation mechanism in-repo. |
| 15 | Schema & integrity controls | **Pass (minor gap)** | Strong FKs/CHECK/unique in `schema.sql` + `0003` (cascades in `0002`). Gap: `box_recipes.user_id` nullable — DB-3. (`portfolios.user_id` is `NOT NULL` in current `schema.sql`.) |
| 16 | Field-level minimization | **Fail (low)** | DB-8 — `useBoxRecipes.ts:43` uses `select("*")`; all other queries use explicit columns. |
| 17 | Pagination & query limits | **Pass (minor)** | Searches capped (`portfolio.ts` `.limit(20)/.limit(50)`; scraper `.range()` batches). Caveat: `serverMarketData.ts` `while(true)` loops have no hard upper page cap — see DB-4. |
| 18 | Backup/restore security | **Unable to verify** | Supabase-managed PITR/backups; no config in repo. Confirm backups enabled, encrypted, access-controlled in dashboard. |
| 19 | Data retention & deletion | **Pass** | `delete_my_account()` RPC (`0002`) + `ON DELETE CASCADE` chain (`0002:9-32`) correctly purge profiles/portfolios/holdings/lots/box_recipes. Recommend adding deletion audit (DB-6). |
| 20 | Migrations safety | **Pass (minor)** | `0001`–`0005` idempotent (`DO $$ ... EXCEPTION WHEN duplicate_object$$`, `IF NOT EXISTS`). `DROP CONSTRAINT IF EXISTS` is metadata-only, non-destructive. Gap: `create_box_recipes.sql` is non-idempotent and outside the numbered run order — see DB-2. No documented rollback scripts. |
| 21 | Raw-query / SECURITY DEFINER review | **Pass (minor)** | All 3 SECURITY DEFINER fns pin `search_path` and use no dynamic SQL. The 3 market fns are SECURITY INVOKER but unpinned — recommend pinning for consistency. |
| 22 | LIKE/regex input handling | **Pass** | `escapeLike()` (`portfolio.ts:446-448`) escapes `% _ \` before every `.ilike()`. |
| 23 | Query timeouts & resource guards | **Fail** | Same as #6 — DB-4. Heavy market RPCs + unbounded pagination loops, no timeout. |
| 24 | Audit & monitoring depth (DDL/GRANT/roles) | **Fail / Unable to verify** | No `pgaudit`/log config in repo — DB-6. Confirm Postgres logs + alerting in Supabase dashboard. |
| 25 | PII in logs/metrics | **Pass** | Error logs redacted to `{ code }` only (`portfolio.ts`, `route.ts:62`, `useBoxRecipes.ts`, `AuthContext.tsx:46`). No emails/rows logged. |
| 26 | Indexing of sensitive data | **Pass** | No plaintext-token columns exist; indexes are on `product_id/recorded_at`, `portfolio_id`, `user_id`, `share_code` (`0003`, `20260506_*`, `create_box_recipes.sql`). `share_code` is a 128-bit CSPRNG value (`useBoxRecipes.ts:8-14`), not a credential. |
| 27 | Service/account lifecycle | **Fail** | DB-1 — one shared key across 5 scraper scripts, no per-service identity, no lifecycle/rotation. |
| 28 | Caching layers (Redis/Memcached auth) | **Not Applicable** | No Redis/Memcached. Caching is Next.js `unstable_cache` (in-process, `serverMarketData.ts:604-630`) — no external cache to authenticate. |
| 29 | Analytics/ETL exports (PII masking) | **Not Applicable / Pass** | DB-9 — no ETL/export job in repo; market analytics read only non-PII tables. Confirm no out-of-repo BI connector. |

**Tally:** Pass 14, Fail 7, Not Applicable 5, Unable to verify 6 (some items counted in two states where part is verifiable and part is not).

---

## Items marked "Unable to verify" — what would prove them

| Item | What to run / check |
|---|---|
| DB-1 — scraper key role | Inspect the JWT `role` claim in `secretsFile.py` on the deploy host, or `SELECT current_setting('request.jwt.claims', true)` during a scraper connection. |
| DB-2 — `box_recipes` RLS live state | `SELECT tablename, rowsecurity, (SELECT count(*) FROM pg_policies p WHERE p.tablename=t.tablename) FROM pg_tables t WHERE schemaname='public';` |
| #3 Encryption at rest | Supabase dashboard → Database settings (disk encryption is default-on). |
| #7 Connection pool | Supabase dashboard → Database → Connection pooling (mode, pool size, idle timeout). |
| #12 Networking | Supabase dashboard → Database → Network restrictions / Network bans. |
| #18 Backups | Supabase dashboard → Database → Backups (PITR enabled, retention). |
| #24 DDL/role audit | Supabase dashboard → Logs / `pgaudit` extension status (`SELECT * FROM pg_extension WHERE extname='pgaudit';`). |
| `products.active` column | `schema.sql` (context-only file) has no `active` column, but `20260506_market_performance_functions.sql` and `clientMarketData.ts:38`/`serverMarketData.ts:491` filter `active = true`. Run `\d public.products` to confirm the column exists in production (it must, or the market RPCs/fallback would error). Schema drift between `schema.sql` and the live DB is itself a minor finding — keep `schema.sql` in sync. |
