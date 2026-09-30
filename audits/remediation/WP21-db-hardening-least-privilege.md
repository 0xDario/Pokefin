# WP21: Database hardening, least-privilege scraper role, schema baseline

- **Findings covered**
  - F133 (full): the `FOR ALL` RLS policies let a signed-in user rewrite `profiles.email`, `created_at` and `updated_at` (and insert or delete their own profile row), store multi-megabyte `box_recipes.packs`, write unbounded `portfolio_lots.notes` and `portfolios.name`, and create unlimited rows. One deliberate remainder: the owner of a portfolio, holding or recipe can still rewrite that row's own `created_at` (plan correction 6).
  - F081 (full, cluster members F081 and F085): the scraper (`main.py`), the read-only weekly report (`generate_weekly_report.py`), the read-only `compare_prices.py` and, through the shared env file, the SMTP emailer all run with the `sb_secret_` key, which bypasses every RLS policy and unlocks the auth admin API, for jobs that need a few reference-table writes or nothing but public reads.
  - F135 (full): `schema.sql` and `migrations/` cannot rebuild production. `products.active` is defined nowhere, two legacy functions and a backup table exist only in production, `0003` is not re-runnable, and nothing replays the chain.
- **Priority rationale**: all three are least-privilege and reproducibility gaps with no user-visible symptom today, so they come last, after the code that reads and writes these tables has settled (WP04 to WP06, WP10, WP16).
- **Effort**: L, about 16 to 22 hours of executor time (8 h for the scraper backends and tests, 4 h for the two migrations and their tests, 6 h for the replay harness, baseline and CI, 2 h docs), plus about 2 hours of owner time spread over three sittings.
- **Depends on**: WP06 (box_recipes route handlers, trigger and `currency` column in migration 0026), WP10 (migrations 0027 to 0029), WP16 (`product_price_pending`, migration 0030, and the rewritten `update_prices`). Also relies on WP04 (`PATCH /api/profile` updates only `username`), WP05 (portfolio route handlers) and WP11 (`run_jobs_once` in `main.py`), all of which precede those.
- **Unblocks**: nothing in this plan. It closes the plan.
- **Suggested branch name**: `remediation/wp21-db-hardening-least-privilege`
- **Risk level**: medium. Two production migrations change privileges on live tables and the scraper switches credentials; every change is additive, behind a default-off flag, or has a one-statement rollback, and every SQL file in this spec was replayed on PostgreSQL 16 against a simulated production while the spec was written (and again in review). The simulation is built from `schema.sql` and the repo, not from production, so phase B's replay against the real dump is the first true test of the baseline.

## Why

A signed-in user can call PostgREST directly with their own session token, and today RLS is the only thing in the way: it checks which rows they touch but not which columns or how much, so a user can overwrite the email that the GDPR export reports as authoritative, park megabytes of JSON in a recipe, and insert rows without limit. Separately, the scraper on the owner's laptop, the weekly report and the emailer all hold the project's most powerful credential; if that laptop or its env file leaks, every account can be read, deleted or taken over through the auth admin API. Finally, nobody can build a copy of the production database from the repository, so every security migration has been tested only by applying it to production. After this PR the database enforces column, size and row limits, the scraper runs as a login role that can touch only the six tables it writes (with a Storage S3 key for images), the report and `compare_prices.py` read with the public key, and CI rebuilds the whole schema from `migrations/` on every pull request and proves each file can be re-run.

## Before you start

Read these files in full first:

- `audits/2026-09-25-security-performance-ux-review.md` sections on F081/F085 (search "Scraper, weekly report and emailer"), F133 ("Whole-row writes") and F135 ("Migration chain").
- `migrations/0001_enable_rls_and_policies.sql`, `0003_integrity_constraints.sql`, `0004_handle_new_user_trigger.sql`, `0008_box_recipes_rls_hardening.sql`, `0012_advisor_followups.sql`, `0013_revoke_anon_on_user_tables.sql`, `0014_rls_perf_and_dedupe.sql` (the `profiles_self` policy at `:55-58`), `0015_product_sales_and_listings_history.sql`, and the WP01/WP06/WP10/WP16 files `0024` to `0030`.
- `README.md:278-297` (Database section) and `:442-457` (ordering constraints), `README.md:106-146` (scraper credentials), `README.md:210-235` (weekly report email config).
- `audits/HARDENING_FOLLOWUPS.md:19-23` (the "idempotent and safe to re-run" claim) and `:185-200` (key migration history: legacy JWT keys revoked, `sb_secret_` on the laptop).
- `secrets_loader.py` (all 50 lines), `main.py` (every `supabase.` call; list below), `generate_weekly_report.py:1-35` and `:160-212`, `run_scraper.sh`, `run_weekly_report.sh`, `verify_migration.py:1-60` (what it refuses), `.github/workflows/ci.yml` (after WP00 it has four jobs and a top-level `permissions:` block).
- `tests/test_main.py:14-22`, `tests/test_sales_volume.py:535-660` (how tests patch `main.supabase`), and WP16's `tests/test_pipeline_hardening.py`.

Commands to confirm the starting state (run from the repo root):

```bash
git checkout master && git pull && git checkout -b remediation/wp21-db-hardening-least-privilege

# 1. Earlier migrations are present. Expect 0024 ... 0030 (WP01, WP06, WP10, WP16).
ls migrations | sort
# The next two free numbers are the ones this package uses. The spec says
# 0031 and 0032; if either is taken, use the next free numbers and substitute
# them everywhere (file names, comments, README, tests).

# 2. F133 still open: profiles_self is FOR ALL and nothing limits columns.
grep -n "FOR ALL TO authenticated" migrations/0014_rls_perf_and_dedupe.sql   # 4 hits, first at :56
grep -rn "REVOKE .* ON public.profiles FROM authenticated" migrations/       # no output
grep -n "jsonb_array_length(packs) <= 50" migrations/0008_box_recipes_rls_hardening.sql   # :95

# 3. F081 still open: the scraper and the report build clients from the service key.
grep -n "load_supabase_credentials\|create_client" main.py generate_weekly_report.py
# expect in main.py: the secrets_loader import (:25), the SUPABASE_URL line (:27, or :28 after
# WP11's import), `from supabase import create_client` (:20) and `supabase = create_client(...)`
# (:620 before WP16; WP16 moved it). generate_weekly_report.py: :31, :34, :198, :199 on master,
# each about two lines lower after WP16's two new imports

# 4. F135 still open: 0003 is not re-runnable and nothing defines products.active.
grep -n "^ALTER TABLE" migrations/0003_integrity_constraints.sql            # 5 hits: :10, :18, :31, :55 (ADD COLUMN IF NOT EXISTS, fine), :66
grep -rn "active boolean\|ADD COLUMN.*active" migrations/ schema.sql         # no output

# 5. What earlier packages left behind (all must be present; stop if not).
grep -n "product_price_pending" main.py | head -3             # WP16: load_pending_prices etc.
grep -n "def _insert_price_history_row\|def load_pending_prices\|def save_pending_price\|def clear_pending_price" main.py   # 4 hits
grep -n "def run_jobs_once" main.py                          # WP11
grep -rn "\.update({ username })" frontend/app/api            # WP04: exactly one hit, the profile route
grep -rn 'from("profiles")' frontend/app --include=*.ts --include=*.tsx | grep -v __tests__   # only under app/api/
grep -n "BOX_RECIPES_LIST_LIMIT = 100" frontend/app/lib/boxRecipes.ts   # WP06
grep -n "IMPORT_MAX_ROWS_PER_REQUEST" frontend/app/lib/portfolioInput.ts # WP05

# 6. Every call site this package re-routes (post-WP16 main.py). Expect exactly
#    these table/storage names, 14 lines in total:
grep -n 'supabase\.table(\|supabase\.storage' main.py
#    exchange_rates insert (1), products select (1), products update (1),
#    product_price_pending select/upsert/delete (3), product_price_history insert (1),
#    product_sales_history upsert (2), product_listings_history upsert (2),
#    storage upload in upload_thumbnail (1), storage upload and get_public_url in
#    download_and_upload_image (2). No _flush_price_history_batch (WP16 deleted it).
#    If the count differs, stop and report the extra or missing call.
grep -n 'load_supabase_credentials' compare_prices.py   # 2 hits: the import-list entry and the SUPABASE_URL line (step 9d)

# 7. Tooling for the local replay. One of these must work:
docker --version            # preferred: docker run postgres:17
ls /usr/lib/postgresql/*/bin/initdb 2>/dev/null   # fallback: a local PostgreSQL 16 or 17

# 8. Python baseline (in a venv with requirements.txt installed):
python -m pytest tests/ -q      # all pass; note the count
```

Assumptions to check, and what to do if they are wrong:

- **WP16 landed** (check 5). If `product_price_pending` or the four helpers are missing, stop: migration 0032 grants on that table and step 8 edits those helpers.
- **WP04 landed**: the only `profiles` write in the app is `PATCH /api/profile` doing `update({ username })` with `.select("id, username, email")`. If anything else writes `profiles` (an `upsert`, an `insert`, or an update of any other column), stop and report it: migration 0031 revokes those privileges.
- **WP11 landed**: `run_jobs_once()` exists. If not, put the `pg_db.close()` from step 8j at the end of the `--run-now` branch and at the end of each scheduled iteration instead.
- **Owner availability**: phase B (steps 17 to 20) needs a schema dump of production that only the owner can take (Owner actions, A). Plan to stop after step 16 and wait.

## Implementation steps

The work runs in two phases. **Phase A** (steps 1 to 16) needs nothing from the owner. At its end you push the branch, open a draft PR, and hand the owner Owner action A (apply 0031 and 0032, then dump the schema). **Phase B** (steps 17 to 20) turns that dump into `migrations/0000_baseline.sql` and a regenerated `schema.sql`, proves the chain rebuilds production, and finishes the PR. Do not mark the PR ready before phase B: the new CI job fails without the baseline.

Plan corrections (the plan owner's decisions, adjusted where the code proves them wrong; the reason for each is in the step that implements it):

1. `REVOKE UPDATE (email, created_at, updated_at) ON profiles` does nothing while `authenticated` holds table-level UPDATE (Supabase grants it by default). The migration revokes table-level UPDATE and grants `UPDATE (username)` back (step 2).
2. `box_recipes.name` is already capped at 1 to 200 characters by `0008:72-76`. No new name check; `portfolios.name` gets one instead (it had none).
3. The scraper also uploads images through Supabase Storage (`main.py:164`, `:777`, `:803`), which a Postgres role cannot reach. Images move to a Storage S3 access key (step 7), behind its own flag.
4. The weekly report reads four tables that `anon` can already read, so it uses the publishable key through the existing supabase-py code (step 9) instead of a new read-only database role: a new role would add a secret without removing any privilege. The verifier's F081 correction asks for SELECT grants "for the weekly report" only on the assumption that the report moves to the scraper role; with the publishable key it needs none. `compare_prices.py` is read-only too (it selects `products` and `exchange_rates`), so it moves to the same loader (step 9d), as F085 recommends. `generate_skus.py` writes `products.sku` and the backfills write history, so they stay on the service key as one-off admin tools.
5. Use plain `pg_dump`, not `supabase db dump`: the CLI wraps pg_dump with `--quote-all-identifiers` and its own post-processing, and the prune script (step 11d) is written against pg_dump's standard TOC headers.
6. F133 recommended `REVOKE UPDATE (created_at, user_id)` on `portfolios`/`box_recipes` and `(created_at, portfolio_id)` on `portfolio_holdings`. Those are column REVOKEs under a table-level grant, so they would be no-ops (correction 1), and the table-level alternative means listing every updatable column forever. Reassignment is already impossible (every policy in `0014:60-100` has a `WITH CHECK` that requires the new `user_id`, or the new `portfolio_id`'s owner, to be the caller). What stays writable is the owner's own `created_at` on those three tables, which affects nobody else; it is recorded as a follow-up in the PR, not fixed here. `profiles.created_at`, the one that `export_my_data()` presents as account metadata, is fixed.
7. F135 also suggested running "the verification queries embedded in the migration headers" in CI. Not done: several headers verify a definition that a later file replaces (README: `delete_my_account` reports MISMATCH after `0010`), so those queries cannot all pass on a full replay. The replay itself, the re-run pass, the drift check and `tests/test_db_roles_integration.py` (which exercises 0031 and 0032) are the CI checks.

### Step 1. `migrations/0003_integrity_constraints.sql`: make it re-runnable (F135)

Wrap each of the eight bare `ADD CONSTRAINT`s in the `DO ... EXCEPTION WHEN duplicate_object` idiom that 0008 and 0015 use, one constraint per block. The constraint definitions do not change, production is unaffected (it is never re-applied there), and `verify_migration.py` reports the same verifiable set (the constraints were already "NOT VERIFIED"). The whole file after the change:

```sql
-- Migration: DB-level integrity constraints to back up client validation.
-- Closes audit findings M-6 (idempotency), M-7 (numeric bounds), L-7
-- (exchange rate sanity), L-8 (price history day uniqueness), L-9
-- (portfolios uniqueness), L-10 (no future purchase date).

-- ============================================================
-- 1. Numeric / date bounds on portfolio_holdings + lots.
-- ============================================================

DO $$ BEGIN
  ALTER TABLE public.portfolio_holdings
    ADD CONSTRAINT portfolio_holdings_quantity_sane
      CHECK (quantity BETWEEN 1 AND 100000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.portfolio_holdings
    ADD CONSTRAINT portfolio_holdings_price_sane
      CHECK (purchase_price_usd BETWEEN 0 AND 1000000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.portfolio_holdings
    ADD CONSTRAINT portfolio_holdings_date_not_future
      CHECK (purchase_date <= current_date);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.portfolio_lots
    ADD CONSTRAINT portfolio_lots_quantity_sane
      CHECK (quantity BETWEEN 1 AND 100000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.portfolio_lots
    ADD CONSTRAINT portfolio_lots_price_sane
      CHECK (purchase_price_usd BETWEEN 0 AND 1000000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.portfolio_lots
    ADD CONSTRAINT portfolio_lots_date_not_future
      CHECK (purchase_date <= current_date);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. Exchange-rate sanity range. USD/CAD has historically lived
--    in [1.0, 1.7]; clamp generously.
-- ============================================================

DO $$ BEGIN
  ALTER TABLE public.exchange_rates
    ADD CONSTRAINT exchange_rates_usd_to_cad_sane
      CHECK (usd_to_cad > 0.5 AND usd_to_cad < 5.0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 3. One portfolio per user (matches getOrCreatePortfolio
--    expectations; prevents TOCTOU duplicates).
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS portfolios_user_id_uidx
  ON public.portfolios (user_id);

-- ============================================================
-- 4. One price-history row per (product, calendar day).
--    Stops scraper double-writes.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS product_price_history_product_day_uidx
  ON public.product_price_history (product_id, (recorded_at::date));

-- ============================================================
-- 5. Idempotency key for holding inserts/imports.
-- ============================================================

ALTER TABLE public.portfolio_holdings
  ADD COLUMN IF NOT EXISTS client_idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS portfolio_holdings_idem_uidx
  ON public.portfolio_holdings (portfolio_id, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;

-- ============================================================
-- 6. Username format constraint on profiles.
-- ============================================================

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_username_format
      CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_]{3,32}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

Then fix the one code comment that cites the old line numbers of the username CHECK (added by WP02):

```bash
grep -rn "0003_integrity_constraints.sql:66-68" frontend/app README.md
```

Change each hit to `migrations/0003_integrity_constraints.sql:88-92` (the `profiles_username_format` block's new lines; confirm with `grep -n profiles_username_format migrations/0003_integrity_constraints.sql`).

### Step 2. `migrations/0031_user_table_write_limits.sql` (new, F133)

Decisions baked into this file:

- **profiles**: `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` from `authenticated`, then `GRANT UPDATE (username)`. A column-level REVOKE alone is a no-op while the table-level privilege exists. Supabase's default `GRANT ALL` also gives `authenticated` TRUNCATE (which ignores RLS), REFERENCES and TRIGGER; none is reachable through PostgREST, but revoking them makes "SELECT plus UPDATE (username)" the whole privilege set, which is what the header and the A2 check assert. WP04's `PATCH /api/profile` runs `UPDATE profiles SET username = ... WHERE id = ... RETURNING id, username, email` (PostgREST `update().eq().select()`), which needs exactly `UPDATE (username)` plus the table-level `SELECT` that stays. Profile rows are created by `handle_new_user()` (0004) and deleted by the `auth.users` cascade inside `delete_my_account()` (0002, 0010); both are `SECURITY DEFINER` and unaffected. Proven on the simulated database: username update succeeds; `SET email`, `SET created_at`, `SET username, updated_at`, `INSERT` and `DELETE` all fail with 42501; `delete_my_account()` still removes the profile.
- **Sizes**: `octet_length(packs::text) <= 8192` (50 packs of `{"set_id": n, "quantity": n}` is under 2 KB), `portfolio_lots.notes <= 1000` characters (matching holdings, 0008:105-109), `portfolios.name` 1 to 200 characters.
- **Row caps** through one generic `BEFORE INSERT` trigger function: 100 recipes per user (the list route returns at most `BOX_RECIPES_LIST_LIMIT = 100`, so a 101st recipe could never be shown), 1000 holdings per portfolio (PostgREST's default max rows is 1000, so the portfolio read would silently truncate above that), 1000 lots per holding (no app reader; abuse bound only). The count compares the owner column to `($1).<column>` of `NEW`, so it keeps the column's type and uses the owner index; `LIMIT cap` bounds the work. A row-level `BEFORE` trigger sees rows inserted earlier in the same statement, so a single 1001-row insert is refused too (tested). It raises `check_violation` (23514), which WP05's and WP06's route error mappers already turn into HTTP 400. Known wording gap, accepted: those mappers were written for CHECK constraints, so a user at the cap sees WP06's "Invalid recipe" or WP05's "One of the values is out of range..." rather than "limit reached". Do not change the WP05/WP06 route code in this package; list it as a follow-up in the PR body. The caps sit far above real use (the largest portfolio is checked in Owner action A1).
- Why a trigger and not column grants for `box_recipes`/`portfolios` `user_id`: RLS `WITH CHECK (user_id = auth.uid())` already makes reassignment impossible, and column grants would have to list every updatable column forever (WP06 already added `currency`).

Create the file with exactly this content:

```sql
-- Migration: limit what a signed-in user can write to their own rows
-- (review 2026-09-25, finding F133).
--
-- RLS decides WHICH rows a user may touch; it cannot decide which COLUMNS or
-- how MUCH. A signed-in user can call PostgREST directly with their own
-- session token (it is their cookie), so every limit below has to live in the
-- database, not only in the route handlers.
--
-- 1. profiles: authenticated may only SELECT their row and UPDATE username.
--    Rows are created by the on_auth_user_created trigger (0004, SECURITY
--    DEFINER) and removed by delete_my_account() (0002/0010, SECURITY DEFINER
--    via the auth.users cascade), so INSERT and DELETE were never needed.
--    TRUNCATE (which ignores RLS), REFERENCES and TRIGGER came with
--    Supabase's default GRANT ALL and are revoked too.
--    email, created_at and updated_at were writable and export_my_data()
--    reports them as authoritative.
--    A column-level REVOKE does nothing while the role still holds the
--    table-level privilege, so this revokes table-level UPDATE and grants
--    UPDATE (username) back. PATCH /api/profile (WP04) runs
--    UPDATE ... SET username = ... RETURNING id, username, email, which needs
--    exactly UPDATE (username) plus the table-level SELECT that stays.
-- 2. Size limits that were missing: box_recipes.packs (one 2 MB element
--    passed the 50-element check in 0008), portfolio_lots.notes (0008 capped
--    only holdings.notes) and portfolios.name.
--    box_recipes.name is already capped at 1-200 characters by 0008.
-- 3. Per-owner row caps, enforced by BEFORE INSERT triggers that raise
--    check_violation (SQLSTATE 23514), which the route handlers already map
--    to HTTP 400:
--      box_recipes         100 per user      (GET /api/box-recipes lists 100)
--      portfolio_holdings  1000 per portfolio (PostgREST returns at most
--                                              1000 rows per request)
--      portfolio_lots      1000 per holding
--    The count uses the owner index (box_recipes_user_id_idx from
--    create_box_recipes.sql; the portfolio indexes checked by 0025). Two
--    concurrent inserts can each see count = cap - 1 and both succeed, so a
--    cap can be exceeded by the number of concurrent requests. That is
--    acceptable for an abuse limit. Rows that already exceed a cap stay;
--    only new inserts are refused. service_role and SECURITY DEFINER
--    functions are subject to the same caps.
--
-- Pre-check (run before applying; every count must be 0):
--   SELECT
--     (SELECT count(*) FROM public.box_recipes
--       WHERE octet_length(packs::text) > 8192)                       AS big_packs,
--     (SELECT count(*) FROM public.portfolio_lots
--       WHERE notes IS NOT NULL AND char_length(notes) > 1000)       AS long_lot_notes,
--     (SELECT count(*) FROM public.portfolios
--       WHERE char_length(name) NOT BETWEEN 1 AND 200)               AS bad_portfolio_names;
--
-- verify_migration.py prints one REFUSED line (the column-level GRANT) and
-- exits 1; that is expected (it does not model column privileges). Check the
-- column privileges with has_column_privilege() (WP21 spec, Owner actions A2).
-- Idempotent.

-- ============================================================
-- 1. profiles: SELECT + UPDATE (username) only
-- ============================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.profiles FROM authenticated;
GRANT UPDATE (username) ON public.profiles TO authenticated;

-- ============================================================
-- 2. Size limits
-- ============================================================

DO $$ BEGIN
  ALTER TABLE public.box_recipes
    ADD CONSTRAINT box_recipes_packs_size
    CHECK (octet_length(packs::text) <= 8192);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.portfolio_lots
    ADD CONSTRAINT portfolio_lots_notes_len
    CHECK (notes IS NULL OR char_length(notes) <= 1000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.portfolios
    ADD CONSTRAINT portfolios_name_len
    CHECK (char_length(name) BETWEEN 1 AND 200);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 3. Per-owner row caps
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_owner_row_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  owner_column text := TG_ARGV[0];
  row_cap      integer := TG_ARGV[1]::integer;
  current_rows integer;
BEGIN
  IF to_jsonb(NEW) ->> owner_column IS NULL THEN
    RETURN NEW;
  END IF;
  -- ($1).<owner_column> keeps the column's own type, so the owner index is
  -- used. LIMIT stops the count at the cap.
  EXECUTE format(
    'SELECT count(*) FROM (SELECT 1 FROM %I.%I WHERE %I = ($1).%I LIMIT %s) capped',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, owner_column, owner_column, row_cap
  ) INTO current_rows USING NEW;
  IF current_rows >= row_cap THEN
    RAISE EXCEPTION '% row limit reached', TG_TABLE_NAME
      USING ERRCODE = 'check_violation',
            HINT = format('At most %s rows per %s.', row_cap, owner_column);
  END IF;
  RETURN NEW;
END
$$;

-- Trigger-only helper: not callable over PostgREST (same rule as 0006/0012).
REVOKE ALL ON FUNCTION public.enforce_owner_row_cap() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS box_recipes_row_cap_trg ON public.box_recipes;
CREATE TRIGGER box_recipes_row_cap_trg
  BEFORE INSERT ON public.box_recipes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_owner_row_cap('user_id', '100');

DROP TRIGGER IF EXISTS portfolio_holdings_row_cap_trg ON public.portfolio_holdings;
CREATE TRIGGER portfolio_holdings_row_cap_trg
  BEFORE INSERT ON public.portfolio_holdings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_owner_row_cap('portfolio_id', '1000');

DROP TRIGGER IF EXISTS portfolio_lots_row_cap_trg ON public.portfolio_lots;
CREATE TRIGGER portfolio_lots_row_cap_trg
  BEFORE INSERT ON public.portfolio_lots
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_owner_row_cap('holding_id', '1000');
```

Check it. Expect exactly one REFUSED line (the column grant) and exit 1; that is correct, because `verify_migration.py` does not model column privileges:

```bash
python3 verify_migration.py migrations/0031_user_table_write_limits.sql > /tmp/wp21_0031.sql; echo "exit=$?"
# expect on stderr:
#   ! REFUSED unsupported privilege 'UPDATE (USERNAME)' in: GRANT UPDATE (username) ON public.profiles TO authenticated;
#   -- function enforce_owner_row_cap(): ... security invoker, plpgsql, volatility v, config search_path=public
#   9 privilege lines (INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER revoked on profiles;
#   EXECUTE revoked on enforce_owner_row_cap for public, anon, authenticated)
#   NOT VERIFIED: 3 x CREATE TRIGGER, 3 x DO block, 3 x DROP object
# and exit=1
```

### Step 3. `migrations/0032_scraper_least_privilege_role.sql` (new, F081)

Decisions baked into this file:

- A dedicated role `pokefin_scraper`: `LOGIN`, `NOBYPASSRLS`, not a superuser, no `CREATEROLE`/`CREATEDB`/`REPLICATION`, `NOINHERIT`, no role memberships, `CONNECTION LIMIT 5`, `statement_timeout = 60s` and `idle_in_transaction_session_timeout = 60s`. It is created **without a password**; the owner sets one with `\password` so it never appears in the repo, the SQL editor history or the Postgres log. Roles are cluster-wide, so on a replay server the second database finds the role already there; the `duplicate_object` handler and the attribute check below cover that.
- Privileges are exactly what `main.py` does: `products` SELECT plus column-level UPDATE of `usd_price, last_updated, image_url, last_image_update` (so a compromised scraper cannot redirect `url` or rewrite the `sku` that the Shopify sync uses); `product_price_history` SELECT, INSERT; `product_sales_history` and `product_listings_history` SELECT, INSERT, UPDATE (upsert needs UPDATE and a SELECT policy); `exchange_rates` SELECT, INSERT; `product_price_pending` all four. No sequence grants are needed as long as the `id` columns are identity columns (`schema.sql` shows `GENERATED ALWAYS AS IDENTITY` on all four insert targets): an identity column's implicit `nextval` skips the sequence privilege check. A `serial`-style `DEFAULT nextval(...)` column would need `GRANT USAGE ON SEQUENCE`; Owner action A1 checks this on production before 0032 is applied, and says what to add if it finds one.
- One `FOR ALL TO pokefin_scraper USING (true) WITH CHECK (true)` policy per table. The GRANTs are the command gate; the policies only let the role through RLS on those six tables. `ON CONFLICT DO UPDATE` needs the SELECT side of the policy, which `FOR ALL` provides.
- Not granted to `authenticator`, so PostgREST can never switch to it. Minting a JWT with `role: pokefin_scraper` is impossible anyway: the legacy HS256 keys are revoked (`HARDENING_FOLLOWUPS.md:195`) and the `sb_` keys are not JWTs.

Create the file with exactly this content:

```sql
-- Migration: a least-privilege login role for the price scraper
-- (review 2026-09-25, finding F081).
--
-- main.py has run with the sb_secret_ key, which bypasses every RLS policy
-- and unlocks the auth admin API, for a job that only reads and writes
-- public reference data. This role can do exactly what main.py does and
-- nothing else. It has NOBYPASSRLS, so it goes through RLS like every other
-- API role, and the policies below are its only way in.
--
--   products                  SELECT; UPDATE of usd_price, last_updated,
--                             image_url, last_image_update only
--   product_price_history     SELECT, INSERT
--   product_sales_history     SELECT, INSERT, UPDATE (upsert)
--   product_listings_history  SELECT, INSERT, UPDATE (upsert)
--   exchange_rates            SELECT, INSERT
--   product_price_pending     SELECT, INSERT, UPDATE, DELETE (0030)
--
-- No access to profiles, portfolios, holdings, lots, box_recipes,
-- auth_events, the auth schema or storage. No DELETE anywhere except the
-- pending-price scratch table.
--
-- The role is created WITHOUT a password, so nobody can log in as it until
-- the owner sets one outside version control (WP21 spec, Owner actions):
--   psql "<session pooler URL as postgres>" -c '\password pokefin_scraper'
-- The scraper then connects through the Supavisor session pooler as
-- user "pokefin_scraper.<project-ref>".
--
-- verify_migration.py prints two REFUSED lines (the column-level UPDATE grant
-- on products and the schema USAGE grant) and exits 1; that is expected. The
-- table privilege and role lines it does print must all be OK. Policies and
-- column privileges are checked by the queries in the WP21 spec (Owner
-- actions A3).
-- Idempotent.

-- ============================================================
-- 1. The role
-- ============================================================

DO $$ BEGIN
  CREATE ROLE pokefin_scraper
    LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
    CONNECTION LIMIT 5;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Refuse to continue if a pre-existing role of this name is privileged.
DO $$
DECLARE
  r record;
BEGIN
  SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
    INTO r FROM pg_roles WHERE rolname = 'pokefin_scraper';
  IF r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication THEN
    RAISE EXCEPTION 'pokefin_scraper exists with elevated attributes; fix it by hand before applying this migration';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r2 ON r2.oid = m.member
              WHERE r2.rolname = 'pokefin_scraper') THEN
    RAISE EXCEPTION 'pokefin_scraper is a member of another role; revoke that membership first';
  END IF;
END $$;

ALTER ROLE pokefin_scraper SET statement_timeout = '60s';
ALTER ROLE pokefin_scraper SET idle_in_transaction_session_timeout = '60s';

-- ============================================================
-- 2. Privileges
-- ============================================================

GRANT USAGE ON SCHEMA public TO pokefin_scraper;

GRANT SELECT ON public.products TO pokefin_scraper;
GRANT UPDATE (usd_price, last_updated, image_url, last_image_update)
  ON public.products TO pokefin_scraper;

GRANT SELECT, INSERT         ON public.product_price_history    TO pokefin_scraper;
GRANT SELECT, INSERT, UPDATE ON public.product_sales_history    TO pokefin_scraper;
GRANT SELECT, INSERT, UPDATE ON public.product_listings_history TO pokefin_scraper;
GRANT SELECT, INSERT         ON public.exchange_rates           TO pokefin_scraper;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_price_pending TO pokefin_scraper;

-- ============================================================
-- 3. RLS policies. The GRANTs above decide which commands the role may run;
--    these policies only let its rows through RLS on the tables it may touch.
-- ============================================================

DO $$ BEGIN
  CREATE POLICY products_scraper ON public.products
    FOR ALL TO pokefin_scraper USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY product_price_history_scraper ON public.product_price_history
    FOR ALL TO pokefin_scraper USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY product_sales_history_scraper ON public.product_sales_history
    FOR ALL TO pokefin_scraper USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY product_listings_history_scraper ON public.product_listings_history
    FOR ALL TO pokefin_scraper USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY exchange_rates_scraper ON public.exchange_rates
    FOR ALL TO pokefin_scraper USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY product_price_pending_scraper ON public.product_price_pending
    FOR ALL TO pokefin_scraper USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

Check it:

```bash
python3 verify_migration.py migrations/0032_scraper_least_privilege_role.sql > /tmp/wp21_0032.sql; echo "exit=$?"
# expect on stderr:
#   ! REFUSED unsupported privilege 'UPDATE (USD_PRICE' ...     (column grant)
#   ! REFUSED unparsed privilege statement: GRANT USAGE ON SCHEMA public TO pokefin_scraper
#   15 privilege lines, all "granted", 2 role lines (statement_timeout=60s, idle_in_transaction_session_timeout=60s)
#   NOT VERIFIED: 8 x DO block
# and exit=1
```

### Step 4. `requirements.txt`

Append, keeping the file's comment style:

```text
# Direct Postgres access for the least-privilege scraper role
# (POKEFIN_DB_BACKEND=postgres, audit 2026-09-25 F081). The binary extra
# bundles libpq, so no system package is needed.
psycopg[binary]==3.3.6
# Supabase Storage S3 API for image uploads without the secret key
# (POKEFIN_STORAGE_BACKEND=s3, audit F081).
boto3==1.43.104
```

Use the newest release of each if these have been superseded (`pip index versions psycopg`, `pip index versions boto3`); `pip-audit --requirement requirements.txt --strict` must stay clean.

### Step 5. `secrets_loader.py`: backend flags and new loaders

5a. Add `import sys` directly below `import os` (`:11`).

5b. Append this block to the end of the file (after `load_shopify_credentials`, `:50`). `load_supabase_credentials` stays exactly as it is: the backfill scripts, `compare_prices.py` and `generate_skus.py` are one-off admin tools and keep using the service key, supplied by hand for each run (README, step 15).

```python
# === Scraper backends (audit 2026-09-25, finding F081) ===
# The defaults keep the pre-WP21 behaviour (PostgREST and Storage through the
# sb_secret_ key) until the owner switches each backend over.
_BACKEND_CHOICES = {
    "POKEFIN_DB_BACKEND": ("supabase", "postgres"),
    "POKEFIN_STORAGE_BACKEND": ("supabase", "s3"),
}


def _backend(env_name: str) -> str:
    choices = _BACKEND_CHOICES[env_name]
    value = (os.environ.get(env_name) or choices[0]).strip().lower()
    if value not in choices:
        raise RuntimeError(
            f"{env_name} must be one of: {', '.join(choices)} (got {value!r})"
        )
    return value


def scraper_db_backend() -> str:
    """'supabase' (PostgREST + secret key, default) or 'postgres' (pokefin_scraper role)."""
    return _backend("POKEFIN_DB_BACKEND")


def scraper_storage_backend() -> str:
    """'supabase' (Storage REST + secret key, default) or 's3' (Storage S3 access key)."""
    return _backend("POKEFIN_STORAGE_BACKEND")


def load_supabase_url() -> str:
    url = _from_env_or_file("SUPABASE_URL", "SUPABASE_URL")
    if not url:
        raise RuntimeError("Missing SUPABASE_URL in the environment.")
    return url


def load_scraper_database_url() -> str:
    """Session-pooler URL for the pokefin_scraper role (migration 0032)."""
    dsn = (os.environ.get("POKEFIN_SCRAPER_DATABASE_URL") or "").strip()
    if not dsn:
        raise RuntimeError(
            "POKEFIN_DB_BACKEND=postgres needs POKEFIN_SCRAPER_DATABASE_URL, e.g. "
            "postgresql://pokefin_scraper.<project-ref>:<password>@"
            "aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require"
        )
    return dsn


def load_storage_s3_credentials() -> dict:
    """Supabase Storage S3 access key (Dashboard > Storage > S3 Configuration)."""
    names = {
        "endpoint": "SUPABASE_S3_ENDPOINT",
        "region": "SUPABASE_S3_REGION",
        "access_key_id": "SUPABASE_S3_ACCESS_KEY_ID",
        "secret_access_key": "SUPABASE_S3_SECRET_ACCESS_KEY",
    }
    values = {key: (os.environ.get(env) or "").strip() for key, env in names.items()}
    missing = [names[key] for key, value in values.items() if not value]
    if missing:
        raise RuntimeError(
            "POKEFIN_STORAGE_BACKEND=s3 needs " + ", ".join(missing) + " in the environment."
        )
    if not values["endpoint"].startswith("https://"):
        raise RuntimeError("SUPABASE_S3_ENDPOINT must be an https:// URL.")
    return values


def load_supabase_readonly_credentials() -> tuple[str, str]:
    """
    URL and key for read-only jobs (generate_weekly_report.py). Every table
    the report reads is readable by anon, so the publishable key is enough
    (audit F081/F085). Falls back to the service key, with a warning, until
    SUPABASE_PUBLISHABLE_KEY is configured.
    """
    url = load_supabase_url()
    key = (os.environ.get("SUPABASE_PUBLISHABLE_KEY") or "").strip()
    if key:
        if key.startswith("sb_secret_"):
            raise RuntimeError(
                "SUPABASE_PUBLISHABLE_KEY holds a secret key (sb_secret_...). "
                "Use the sb_publishable_... key."
            )
        return url, key
    _, fallback = load_supabase_credentials()
    print(
        "WARNING: SUPABASE_PUBLISHABLE_KEY is not set; the weekly report is "
        "using the service key. Add the publishable key to its env file.",
        file=sys.stderr,
    )
    return url, fallback
```

### Step 6. `scraper_db.py` (new, repo root)

One method per PostgREST call it replaces. Every timestamp conversion is explicit because `products.last_updated` and `product_price_history.recorded_at` are `timestamp without time zone` holding UTC, and the upserts are single `INSERT ... SELECT FROM jsonb_to_recordset(...) ON CONFLICT` statements so a batch stays atomic, as the PostgREST bulk upsert was. It was run against the replayed database as `pokefin_scraper`: every statement succeeded, a same-day history insert raised `UniqueViolation` (whose text contains "duplicate key", which WP16's `_is_duplicate_key_error` matches), and a missing table raised with "does not exist" (matched by `_is_missing_table_error`).

```python
"""
Direct Postgres access for main.py when POKEFIN_DB_BACKEND=postgres.

Audit 2026-09-25, finding F081: the scraper used to write through PostgREST
with the sb_secret_ key, which bypasses every RLS policy and unlocks the auth
admin API. This module connects as the least-privilege role
pokefin_scraper (migrations/0032_scraper_least_privilege_role.sql) through
the Supavisor session pooler and runs only the statements main.py needs.

Every method mirrors one PostgREST call it replaces, including its error
behaviour: a failed statement raises (psycopg.Error), and the error text
carries the SQLSTATE words main.py already matches on ("duplicate key" for
23505, "does not exist" for 42P01). Each statement runs in its own
transaction (autocommit), exactly like one PostgREST request.
"""

from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

# Columns of public.products the role may UPDATE (column-level grant in 0032).
PRODUCT_UPDATE_COLUMNS = ("usd_price", "last_updated", "image_url", "last_image_update")
# products.last_updated is timestamp WITHOUT time zone holding UTC wall time;
# last_image_update is timestamptz. Values arrive as ISO strings with +00:00.
_NAIVE_UTC_COLUMNS = {"last_updated"}

_SALES_COLUMNS = (
    ("product_id", "bigint"),
    ("bucket_date", "date"),
    ("granularity", "text"),
    ("quantity_sold", "integer"),
    ("transaction_count", "integer"),
    ("low_sale_price", "double precision"),
    ("high_sale_price", "double precision"),
    ("market_price", "double precision"),
)
_SALES_KEY = ("product_id", "bucket_date", "granularity")

_LISTINGS_COLUMNS = (
    ("product_id", "bigint"),
    ("snapshot_date", "date"),
    ("active_listings", "integer"),
    ("total_quantity_available", "integer"),
    ("lowest_listing_price", "double precision"),
)
_LISTINGS_KEY = ("product_id", "snapshot_date")

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", ""}


def check_dsn(dsn: str) -> None:
    """
    Refuse a DSN that would send the password in clear text: a remote host
    must use sslmode=require, verify-ca or verify-full. Raises ValueError.
    Only URL-style DSNs (postgresql://...) are accepted.
    """
    parsed = urlparse(dsn)
    if parsed.scheme not in ("postgres", "postgresql"):
        raise ValueError("POKEFIN_SCRAPER_DATABASE_URL must be a postgresql:// URL")
    host = (parsed.hostname or "").lower()
    if host in _LOCAL_HOSTS:
        return
    sslmode = (parse_qs(parsed.query).get("sslmode") or [""])[0]
    if sslmode not in ("require", "verify-ca", "verify-full"):
        raise ValueError(
            "POKEFIN_SCRAPER_DATABASE_URL must set sslmode=require (or verify-ca/"
            "verify-full) for a remote host"
        )


def _upsert_statement(table: str, columns, key) -> sql.Composed:
    """
    INSERT ... SELECT FROM jsonb_to_recordset(%s) ON CONFLICT (key) DO UPDATE.
    One statement for the whole batch, so a batch is atomic, as the PostgREST
    bulk upsert it replaces was.
    """
    names = [c for c, _ in columns]
    record_def = sql.SQL(", ").join(
        sql.SQL("{} {}").format(sql.Identifier(c), sql.SQL(t)) for c, t in columns
    )
    updates = sql.SQL(", ").join(
        sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(c), sql.Identifier(c))
        for c in names
        if c not in key
    )
    return sql.SQL(
        "INSERT INTO public.{table} ({cols}) "
        "SELECT {cols} FROM jsonb_to_recordset(%s) AS r({record_def}) "
        "ON CONFLICT ({key}) DO UPDATE SET {updates}"
    ).format(
        table=sql.Identifier(table),
        cols=sql.SQL(", ").join(sql.Identifier(c) for c in names),
        record_def=record_def,
        key=sql.SQL(", ").join(sql.Identifier(c) for c in key),
        updates=updates,
    )


_SALES_UPSERT = _upsert_statement("product_sales_history", _SALES_COLUMNS, _SALES_KEY)
_LISTINGS_UPSERT = _upsert_statement("product_listings_history", _LISTINGS_COLUMNS, _LISTINGS_KEY)


class ScraperDB:
    """Lazily connected; reconnects once if the pooler dropped the session."""

    def __init__(self, dsn: str, connect=psycopg.connect):
        check_dsn(dsn)
        self._dsn = dsn
        self._connect = connect
        self._conn = None

    # -- connection -------------------------------------------------------

    def _connection(self):
        if self._conn is None or self._conn.closed:
            conn = self._connect(
                self._dsn,
                autocommit=True,
                # Safe behind Supavisor in either pool mode.
                prepare_threshold=None,
                row_factory=dict_row,
                connect_timeout=15,
                application_name="pokefin-scraper",
            )
            # timestamp-without-time-zone columns hold UTC wall time, and
            # now() defaults are converted with the session time zone.
            conn.execute("SET TIME ZONE 'UTC'")
            self._conn = conn
        return self._conn

    def _execute(self, query, params=None, fetch=False):
        for attempt in (1, 2):
            try:
                cur = self._connection().execute(query, params)
                return cur.fetchall() if fetch else None
            except psycopg.OperationalError:
                # Connection-level failure (pooler restart, network blip,
                # refused connect) or a statement timeout (57014, also an
                # OperationalError): drop the connection and retry once.
                # Every statement here is safe to repeat. Constraint and
                # permission errors are other classes and are not retried.
                self.close()
                if attempt == 2:
                    raise
        return None  # unreachable

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None

    # -- statements (one per PostgREST call replaced) ----------------------

    def insert_exchange_rate(self, usd_to_cad: float, recorded_at_iso: str) -> None:
        self._execute(
            "INSERT INTO public.exchange_rates (usd_to_cad, recorded_at) "
            "VALUES (%s, %s::timestamp)",
            (usd_to_cad, recorded_at_iso),
        )

    def fetch_products_needing_update(self, price_before: datetime, image_before: datetime):
        """
        Same predicate as main.py's PostgREST or_() filter, in one query.
        Both bounds are aware UTC datetimes.
        """
        rows = self._execute(
            "SELECT id, url, usd_price, image_url, last_updated, last_image_update, "
            "       variant, set_id, product_type_id "
            "  FROM public.products "
            " WHERE last_updated IS NULL "
            "    OR usd_price IS NULL "
            "    OR last_updated < (%(price_before)s::timestamptz AT TIME ZONE 'UTC') "
            "    OR image_url IS NULL "
            "    OR last_image_update IS NULL "
            "    OR last_image_update < %(image_before)s::timestamptz "
            " ORDER BY id",
            {
                "price_before": price_before.astimezone(timezone.utc),
                "image_before": image_before.astimezone(timezone.utc),
            },
            fetch=True,
        )
        return [_as_postgrest_row(r) for r in rows]

    def update_product(self, product_id: int, update_data: dict) -> None:
        unknown = set(update_data) - set(PRODUCT_UPDATE_COLUMNS)
        if unknown:
            raise ValueError(f"pokefin_scraper may not update products columns {sorted(unknown)}")
        if not update_data:
            return
        assignments = []
        params = {"id": product_id}
        for column in PRODUCT_UPDATE_COLUMNS:
            if column not in update_data:
                continue
            value = sql.Placeholder(column)
            if column in _NAIVE_UTC_COLUMNS:
                expr = sql.SQL("({}::timestamptz AT TIME ZONE 'UTC')").format(value)
            elif column == "last_image_update":
                expr = sql.SQL("{}::timestamptz").format(value)
            else:
                expr = value
            assignments.append(sql.SQL("{} = {}").format(sql.Identifier(column), expr))
            params[column] = update_data[column]
        query = sql.SQL("UPDATE public.products SET {} WHERE id = %(id)s").format(
            sql.SQL(", ").join(assignments)
        )
        self._execute(query, params)

    def insert_price_history(self, product_id: int, usd_price: float) -> None:
        """recorded_at takes its default (now(), UTC). Raises on a duplicate day."""
        self._execute(
            "INSERT INTO public.product_price_history (product_id, usd_price) VALUES (%s, %s)",
            (product_id, usd_price),
        )

    def upsert_sales_history(self, rows) -> None:
        rows = [rows] if isinstance(rows, dict) else list(rows)
        if rows:
            self._execute(_SALES_UPSERT, (Jsonb(rows),))

    def upsert_listings_history(self, rows) -> None:
        rows = [rows] if isinstance(rows, dict) else list(rows)
        if rows:
            self._execute(_LISTINGS_UPSERT, (Jsonb(rows),))

    def load_pending_prices(self):
        rows = self._execute(
            "SELECT product_id, usd_price, observed_at FROM public.product_price_pending",
            fetch=True,
        )
        return [_as_postgrest_row(r) for r in rows]

    def save_pending_price(self, product_id: int, usd_price: float, observed_at_iso: str) -> None:
        self._execute(
            "INSERT INTO public.product_price_pending (product_id, usd_price, observed_at) "
            "VALUES (%s, %s, %s::timestamptz) "
            "ON CONFLICT (product_id) DO UPDATE "
            "SET usd_price = EXCLUDED.usd_price, observed_at = EXCLUDED.observed_at",
            (product_id, usd_price, observed_at_iso),
        )

    def clear_pending_price(self, product_id: int) -> None:
        self._execute(
            "DELETE FROM public.product_price_pending WHERE product_id = %s",
            (product_id,),
        )


def _as_postgrest_row(row: dict) -> dict:
    """
    PostgREST returned timestamps as ISO strings; main.py's parse_timestamp
    and its callers expect strings. Convert datetimes back so the rest of
    main.py sees exactly what it saw before.
    """
    out = {}
    for key, value in row.items():
        if isinstance(value, datetime):
            out[key] = value.isoformat()
        else:
            out[key] = value
    return out
```

### Step 7. `scraper_storage.py` (new, repo root)

```python
"""
Supabase Storage uploads over its S3-compatible API, for main.py when
POKEFIN_STORAGE_BACKEND=s3.

Audit 2026-09-25, finding F081. Storage's REST API accepts only a JWT-bearing
key, and the only non-user key that can write the product-images bucket is
the sb_secret_ key, which also bypasses every RLS policy and unlocks the auth
admin API. A Storage S3 access key reaches Storage only: no database, no auth.
Created in Dashboard > Storage > S3 Configuration > Access keys.

The public URL format is the one supabase-py's get_public_url() returned, so
products.image_url values do not change.
"""

from __future__ import annotations

BUCKET = "product-images"


class S3ImageStore:
    def __init__(self, supabase_url, endpoint, region, access_key_id, secret_access_key, client=None):
        self._public_base = f"{supabase_url.rstrip('/')}/storage/v1/object/public/{BUCKET}/"
        if client is None:
            import boto3
            from botocore.config import Config

            client = boto3.client(
                "s3",
                endpoint_url=endpoint,
                region_name=region,
                aws_access_key_id=access_key_id,
                aws_secret_access_key=secret_access_key,
                config=Config(
                    s3={"addressing_style": "path"},
                    connect_timeout=10,
                    read_timeout=60,
                    retries={"max_attempts": 3, "mode": "standard"},
                ),
            )
        self._client = client

    def upload(self, path: str, data: bytes, content_type: str, cache_control_seconds) -> None:
        """Create or overwrite one object. Raises on failure (botocore errors)."""
        self._client.put_object(
            Bucket=BUCKET,
            Key=path,
            Body=data,
            ContentType=content_type,
            CacheControl=f"max-age={int(cache_control_seconds)}",
        )

    def public_url(self, path: str) -> str:
        return self._public_base + path
```

### Step 8. `main.py`: route every database and storage call through the selected backend

Every edit keeps the existing supabase-py call as the `else` branch, byte for byte, so the default configuration behaves exactly as before and every existing test that patches `main.supabase` keeps passing (verified while writing this spec: all 161 existing Python tests pass on a copy of `main.py` with steps 8a to 8i applied). Anchor on the quoted code, not on line numbers (WP11 and WP16 moved them).

8a. Top of file. After WP11 the import block ends like this (`:25-28`; WP11 inserted the `revalidate_hook` line directly below the `secrets_loader` import):

```python
from secrets_loader import load_supabase_credentials
from revalidate_hook import should_revalidate_site, trigger_site_revalidation

SUPABASE_URL, SUPABASE_KEY = load_supabase_credentials()
```

Make two replacements and leave the `revalidate_hook` line untouched. First, replace the single line `from secrets_loader import load_supabase_credentials` with the import block below (from `from secrets_loader import (` through `from scraper_storage import S3ImageStore`). Second, replace the single line `SUPABASE_URL, SUPABASE_KEY = load_supabase_credentials()` with the rest of the block (from `# === Backends` through the `else:` branch). The result, in full:

```python
from secrets_loader import (
    load_scraper_database_url,
    load_storage_s3_credentials,
    load_supabase_credentials,
    load_supabase_url,
    scraper_db_backend,
    scraper_storage_backend,
)
from scraper_db import ScraperDB
from scraper_storage import S3ImageStore
from revalidate_hook import should_revalidate_site, trigger_site_revalidation

# === Backends (audit 2026-09-25, F081) ===
# POKEFIN_DB_BACKEND=postgres writes through the least-privilege
# pokefin_scraper role (migrations/0032); POKEFIN_STORAGE_BACKEND=s3 uploads
# images with a Storage S3 access key. The defaults keep the old behaviour
# (PostgREST and Storage through the sb_secret_ key) until the owner cuts
# over; README.md "Scraper credentials" has the steps.
DB_BACKEND = scraper_db_backend()
STORAGE_BACKEND = scraper_storage_backend()
USES_SECRET_KEY = DB_BACKEND == "supabase" or STORAGE_BACKEND == "supabase"
if USES_SECRET_KEY:
    SUPABASE_URL, SUPABASE_KEY = load_supabase_credentials()
else:
    SUPABASE_URL, SUPABASE_KEY = load_supabase_url(), None
```

8b. Replace

```python
# === Supabase Setup ===
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
```

(`:619-620`, just below the logging setup) with

```python
# === Database and storage clients ===
# supabase is None once neither backend needs the secret key. pg_db and
# image_store are None unless their backend is selected; every call site
# below checks them first and otherwise runs the original supabase-py call.
supabase = create_client(SUPABASE_URL, SUPABASE_KEY) if USES_SECRET_KEY else None
pg_db = ScraperDB(load_scraper_database_url()) if DB_BACKEND == "postgres" else None
image_store = (
    S3ImageStore(SUPABASE_URL, **load_storage_s3_credentials())
    if STORAGE_BACKEND == "s3"
    else None
)
logger.info("Scraper backends: database=%s storage=%s", DB_BACKEND, STORAGE_BACKEND)
```

`ScraperDB` does not connect at import time, so importing `main` (tests, `backfill_thumbnails.py`) opens no connection.

8c. `upload_thumbnail` (`:147-179`). Replace the `supabase.storage.from_("product-images").upload(...)` call inside its `try:` with

```python
    try:
        if image_store is not None:
            image_store.upload(
                thumbnail_object_path(product_id), thumb, "image/webp", IMAGE_CACHE_CONTROL_SECONDS
            )
        else:
            supabase.storage.from_("product-images").upload(
                thumbnail_object_path(product_id),
                thumb,
                {
                    "content-type": "image/webp",
                    "cache-control": IMAGE_CACHE_CONTROL_SECONDS,
                    "upsert": "true",
                },
            )
```

The `logger.debug(...)` and `return True` that follow stay as they are, one indentation level under `try:`.

8d. `download_and_upload_image` (WP16's version). Directly after the line `filename = f"products/{product_id}.{file_extension}"` and before the inner `try:` that calls `supabase.storage.from_("product-images").upload(`, insert

```python
        if image_store is not None:
            # POKEFIN_STORAGE_BACKEND=s3 (audit F081): Storage S3 key, no sb_secret_.
            try:
                image_store.upload(filename, image_bytes, content_type, IMAGE_CACHE_CONTROL_SECONDS)
            except Exception as upload_error:
                logger.error("upload_error filename=%s err=%s", filename, type(upload_error).__name__)
                return None
            # Best-effort thumbnail; never let it fail the real upload.
            upload_thumbnail(product_id, image_bytes)
            logger.info("image_uploaded filename=%s", filename)
            return image_store.public_url(filename)
```

If the image bytes variable in your copy is named differently (pre-WP16 code used `bytes(buf)`), use that name.

8e. `fetch_and_store_exchange_rate`. Replace

```python
            result = supabase.table("exchange_rates").insert({
                "usd_to_cad": rate,
                "recorded_at": rate_date.isoformat()
            }).execute()
```

with

```python
            if pg_db is not None:
                pg_db.insert_exchange_rate(rate, rate_date.isoformat())
            else:
                supabase.table("exchange_rates").insert({
                    "usd_to_cad": rate,
                    "recorded_at": rate_date.isoformat()
                }).execute()
```

(`result` was never read.) WP11's `return True` / `return False` lines around it stay.

8f. `fetch_products_needing_update`: insert as the first statement of the body, after the docstring:

```python
    if pg_db is not None:
        return pg_db.fetch_products_needing_update(price_interval_ago, twenty_four_hours_ago)
```

8g. WP16's four helpers. In `load_pending_prices` replace the `try:` body and the loop header:

```python
    try:
        if pg_db is not None:
            rows = pg_db.load_pending_prices()
        else:
            response = supabase.table("product_price_pending")\
                .select("product_id, usd_price, observed_at")\
                .execute()
            rows = response.data or []
    except Exception as e:
```

(the `except` body is unchanged) and change `for row in response.data or []:` to `for row in rows:`.

In `save_pending_price`, `clear_pending_price` and `_insert_price_history_row`, wrap the single supabase call inside each `try:` the same way:

```python
        if pg_db is not None:
            pg_db.save_pending_price(product_id, price, now.isoformat())
        else:
            supabase.table("product_price_pending").upsert(
                {"product_id": product_id, "usd_price": price, "observed_at": now.isoformat()},
                on_conflict="product_id",
            ).execute()
```

```python
        if pg_db is not None:
            pg_db.clear_pending_price(product_id)
        else:
            supabase.table("product_price_pending").delete().eq("product_id", product_id).execute()
```

```python
        if pg_db is not None:
            pg_db.insert_price_history(product_id, price)
        else:
            supabase.table("product_price_history").insert(
                {"product_id": product_id, "usd_price": price}
            ).execute()
```

The `return True` and every `except` branch stay as they are; the duplicate-day handling works unchanged because psycopg's `UniqueViolation` text contains "duplicate key".

8h. `update_prices`, the products write. Replace

```python
                    supabase.table("products").update(update_data).eq("id", product_id).execute()
```

with

```python
                    if pg_db is not None:
                        pg_db.update_product(product_id, update_data)
                    else:
                        supabase.table("products").update(update_data).eq("id", product_id).execute()
```

`update_data` only ever holds `usd_price`, `last_updated`, `image_url`, `last_image_update`; `ScraperDB.update_product` raises `ValueError` for anything else, which the surrounding `except` logs as "Database update failed".

8i. Sales and listings upserts. Add these two helpers directly above `def _flush_sales_history_batch(batch):`

```python
def _upsert_sales_rows(rows):
    """Upsert one row (dict) or a batch (list) of sales-volume rows. Raises on failure."""
    if pg_db is not None:
        pg_db.upsert_sales_history(rows)
    else:
        supabase.table("product_sales_history").upsert(
            rows, on_conflict="product_id,bucket_date,granularity"
        ).execute()


def _upsert_listings_rows(rows):
    """Upsert one row (dict) or a batch (list) of listings snapshots. Raises on failure."""
    if pg_db is not None:
        pg_db.upsert_listings_history(rows)
    else:
        supabase.table("product_listings_history").upsert(
            rows, on_conflict="product_id,snapshot_date"
        ).execute()
```

then replace the four upsert calls: in `_flush_sales_history_batch` the batch call becomes `_upsert_sales_rows(batch)` and the per-row fallback becomes `_upsert_sales_rows(entry)`; in `_flush_listings_history_batch` the same with `_upsert_listings_rows`. The existing tests that assert `upsert(batch, on_conflict=...)` on the mocked client still pass because the helper makes that exact call.

8j. `run_jobs_once` (WP11). Add as its last statement:

```python
    if pg_db is not None:
        # Do not hold a pooler slot for the 4 hours until the next run.
        pg_db.close()
```

8k. Confirm nothing was missed:

```bash
grep -n 'supabase\.table(\|supabase\.storage' main.py
# every hit must sit in an else: branch under "if pg_db is not None" or
# "if image_store is not None", or inside _upsert_sales_rows/_upsert_listings_rows
```

WP16's `scrubbed_browser_env()` already strips every variable this package adds from Chrome's environment (prefixes `SUPABASE_` and `POKEFIN_`, marker `DATABASE_URL`); do not change it.

### Step 9. `generate_weekly_report.py` and `compare_prices.py`: publishable key

The line numbers below are master's. WP16 added `import signal` and `import tempfile` to `generate_weekly_report.py` (so `:34` is now about `:36` and `:197-199` about `:199-201`) and rewrote the usage line, `_get_shopify_credentials` and the argument parser of `compare_prices.py`. Anchor every edit on the quoted text, not the number.

9a. `:34`: `from secrets_loader import load_supabase_credentials  # noqa: E402` becomes `from secrets_loader import load_supabase_readonly_credentials  # noqa: E402`.

9b. `load_data()` (`:197-199`): `url, key = load_supabase_credentials()` becomes `url, key = load_supabase_readonly_credentials()`.

9c. Module docstring, `:5-6`: replace "Pulls the full price history from Supabase (reusing the scraper's credentials via secrets_loader)," with "Pulls the full price history from Supabase with the publishable key (every table it reads is readable by anon; audit F081/F085),".

9d. `compare_prices.py` (F085: read-only, so no secret). In the `from secrets_loader import (...)` block (master `:25-28`) replace `load_supabase_credentials,` with `load_supabase_readonly_credentials,`, and change the line `SUPABASE_URL, SUPABASE_KEY = load_supabase_credentials()` (master `:30`) to `SUPABASE_URL, SUPABASE_KEY = load_supabase_readonly_credentials()`. Nothing else changes: it only selects `exchange_rates` (`:143`) and `products` with embedded `sets` and `product_types` (`:207`), all anon-readable. Confirm: `grep -n "load_supabase" compare_prices.py` prints exactly the two `load_supabase_readonly_credentials` lines.

Why this works: `product_types`, `sets`, `products`, `product_price_history` and `exchange_rates` all have `FOR SELECT TO anon, authenticated USING (true)` policies (0001:69-97) and keep anon SELECT (0013 revokes anon only on the five user tables). Each request is one 1000-row page ordered by `id`, well inside anon's 3-second `statement_timeout` (0009:22), and `fetch_page` already retries SQLSTATE class 57 (timeouts) and PostgREST 5xx.

### Step 10. Shell wrappers

10a. `run_weekly_report.sh`: replace the env-file block (`:21-29`, from the comment "launchd hands a job no shell environment" through the closing `fi`) with

```bash
# launchd hands a job no shell environment, so source a credentials file.
# The report reads only public tables and needs no secret: it gets its own
# env file holding SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SMTP_* and
# REPORT_EMAIL_* (audit 2026-09-25, F081/F085), so neither the generator nor
# the emailer ever sees the scraper's credentials. The scraper's env file is
# only a fallback.
REPORT_ENV_FILE="${POKEFIN_REPORT_ENV_FILE:-$HOME/.config/pokefin/report.env}"
ENV_FILE="${POKEFIN_ENV_FILE:-$HOME/.config/pokefin/env}"
if [ -f "$REPORT_ENV_FILE" ]; then
  set -a
  . "$REPORT_ENV_FILE"
  set +a
elif [ -f "$ENV_FILE" ]; then
  echo "WARN: $REPORT_ENV_FILE not found; using $ENV_FILE, which holds the scraper's credentials" >> "$LOG"
  set -a
  . "$ENV_FILE"
  set +a
else
  echo "WARN: no env file found; secrets_loader.py will fall back to secretsFile.py" >> "$LOG"
fi
```

10b. `run_scraper.sh`: replace the env-file comment (`:25-28`, "Expected contents ... POKEFIN_ENV_FILE") with

```bash
# Load secrets from out-of-tree env file. Expected contents (KEY=VALUE,
# no 'export', chmod 600). After the least-privilege cut-over (README.md,
# "Scraper credentials"; audit 2026-09-25 F081):
#   SUPABASE_URL=https://<ref>.supabase.co
#   POKEFIN_DB_BACKEND=postgres
#   POKEFIN_SCRAPER_DATABASE_URL=postgresql://pokefin_scraper.<ref>:<password>@<pooler host>:5432/postgres?sslmode=require
#   POKEFIN_STORAGE_BACKEND=s3
#   SUPABASE_S3_ENDPOINT=https://<ref>.storage.supabase.co/storage/v1/s3
#   SUPABASE_S3_REGION=<region>
#   SUPABASE_S3_ACCESS_KEY_ID=...
#   SUPABASE_S3_SECRET_ACCESS_KEY=...
# Before the cut-over it holds SUPABASE_SERVICE_ROLE_KEY=sb_secret_... instead.
# Override the path via POKEFIN_ENV_FILE if your secrets live elsewhere.
```

Keep WP11's `REVALIDATE_URL` / `REVALIDATE_SECRET` comment lines and WP16's lock code as they are.

### Step 11. `scripts/db/` (new directory): replay harness (F135)

Create the directory with these five files and `chmod +x` the two shell scripts and the two Python scripts.

11a. `scripts/db/ci_bootstrap.sql`: the Supabase-shaped scaffold (roles, `auth.users`, `auth.uid()` and friends, `extensions`, default privileges).

```sql
-- Supabase-shaped scaffold for replaying migrations/ on a plain Postgres
-- (audit 2026-09-25, F135). Used by scripts/db/replay_migrations.sh only.
-- It stands in for what Supabase provisions before any migration runs:
-- the API roles, the auth schema with auth.users and the auth.*() helpers,
-- the extensions schema, and the default privileges Supabase applies to
-- objects created in public. Never run it against production.

DO $$ BEGIN CREATE ROLE anon NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticator LOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT anon, authenticated, service_role TO authenticator;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    auth.jwt() ->> 'sub'
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.jwt() ->> 'role'
  )
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    auth.jwt() ->> 'email'
  )
$$;

GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt(), auth.email()
  TO anon, authenticated, service_role;

-- Supabase grants these on every object the postgres role creates in public;
-- migrations 0012, 0013 and later revoke what they must.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
```

11b. `scripts/db/replay_migrations.sh`: builds `replay_once` (every file once, production order) and `replay_twice` (every file applied twice in a row) on a local throwaway server. The order is the one README.md:444-457 documents: `0000_baseline.sql`, `create_box_recipes.sql`, `20260506_market_performance_functions.sql`, then the numbered files. Any other `.sql` name in `migrations/` fails the run instead of being skipped.

```bash
#!/usr/bin/env bash
# Rebuild the database from migrations/ on a THROWAWAY Postgres server and
# prove every file is safe to re-run. Audit 2026-09-25, finding F135.
#
#   PGSERVER_URL=postgresql://postgres:postgres@localhost:5432/postgres \
#     scripts/db/replay_migrations.sh
#
# Creates (dropping first) two databases on that server:
#   replay_once   scaffold + every migration once, in production order. This
#                 is the database the drift check and the DB tests use.
#   replay_twice  the same, but each file is applied twice in a row.
# PGSERVER_URL must be a superuser on localhost. Never production.
set -euo pipefail

: "${PGSERVER_URL:?set PGSERVER_URL to a superuser URL on a throwaway local server}"
case "$PGSERVER_URL" in
  *@localhost:*|*@localhost/*|*@127.0.0.1:*|*@127.0.0.1/*) ;;
  *) echo "ERROR: PGSERVER_URL must point at localhost or 127.0.0.1" >&2; exit 1 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG="$ROOT/migrations"

db_url() {  # db_url <database name>: PGSERVER_URL with its database swapped
  python3 - "$PGSERVER_URL" "$1" <<'PY'
import sys
from urllib.parse import urlparse, urlunparse
p = urlparse(sys.argv[1])
print(urlunparse(p._replace(path="/" + sys.argv[2])))
PY
}

# Production order. The two unnumbered files predate the numbered series:
# create_box_recipes.sql must precede 0002 and 20260506_... must precede 0007
# (README.md, "The ordering constraints that matter"). Then numeric order.
ORDER=("0000_baseline.sql" "create_box_recipes.sql" "20260506_market_performance_functions.sql")
while IFS= read -r f; do
  [ "$f" = "0000_baseline.sql" ] || ORDER+=("$f")
done < <(cd "$MIG" && ls | grep -E '^[0-9]{4}_[A-Za-z0-9_]+\.sql$' | sort)

# Every .sql file in migrations/ must be in ORDER, so a new file with an
# out-of-band name fails here instead of being skipped silently.
while IFS= read -r f; do
  printf '%s\n' "${ORDER[@]}" | grep -qxF "$f" || {
    echo "ERROR: migrations/$f is not in the replay order; name it NNNN_description.sql" >&2
    exit 1
  }
done < <(cd "$MIG" && ls *.sql)
[ -f "$MIG/0000_baseline.sql" ] || { echo "ERROR: migrations/0000_baseline.sql is missing" >&2; exit 1; }

psql "$PGSERVER_URL" -X -q -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS replay_once" -c "CREATE DATABASE replay_once" \
  -c "DROP DATABASE IF EXISTS replay_twice" -c "CREATE DATABASE replay_twice"

apply() {  # apply <database url> <file>
  psql "$1" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$2" >/dev/null
}

ONCE="$(db_url replay_once)"
TWICE="$(db_url replay_twice)"
apply "$ONCE" "$ROOT/scripts/db/ci_bootstrap.sql"
apply "$TWICE" "$ROOT/scripts/db/ci_bootstrap.sql"

for f in "${ORDER[@]}"; do
  echo "== $f"
  apply "$ONCE" "$MIG/$f"
  apply "$TWICE" "$MIG/$f"
  # 0000 refuses a non-empty database by design; every other file must be a
  # no-op the second time.
  [ "$f" = "0000_baseline.sql" ] || apply "$TWICE" "$MIG/$f"
done

echo "OK: ${#ORDER[@]} files replayed once (replay_once) and twice (replay_twice)"
```

11c. `scripts/db/normalize_dump.py`: makes two dumps comparable.

```python
#!/usr/bin/env python3
"""
Normalise a schema-only pg_dump of the public schema so two dumps can be
diffed: production (schema.sql) against a replay of migrations/.
Audit 2026-09-25, finding F135.

Drops only lines that differ between hosts or pg_dump versions without
describing the schema: \\restrict/\\unrestrict, "Dumped from/by", session SET
lines, set_config, OWNER TO (and the Owner: part of TOC comments), ALTER DEFAULT PRIVILEGES (ci_bootstrap.sql
emulates Supabase's), and GRANT/REVOKE lines whose grantee is one of
Supabase's internal roles. Grants to anon, authenticated, service_role and
pokefin_scraper are kept: they are the security surface.

  python3 scripts/db/normalize_dump.py dump.sql > normalized.sql
  pg_dump ... | python3 scripts/db/normalize_dump.py - > normalized.sql
"""

import re
import sys

INTERNAL_ROLES = (
    "postgres|supabase_admin|supabase_auth_admin|supabase_storage_admin|"
    "supabase_realtime_admin|supabase_replication_admin|supabase_read_only_user|"
    "dashboard_user|pgbouncer|authenticator|supabase_etl_admin|pg_database_owner"
)
DROP = [
    re.compile(r"^\\(un)?restrict\b"),
    re.compile(r"^-- Dumped (from|by) "),
    re.compile(r"^SET \w+ = "),
    re.compile(r"^SELECT pg_catalog\.set_config\("),
    re.compile(r"^ALTER .* OWNER TO "),
    re.compile(r"^ALTER DEFAULT PRIVILEGES "),
    re.compile(rf"^(GRANT|REVOKE) .* (TO|FROM) \"?({INTERNAL_ROLES})\"?( WITH GRANT OPTION)?;$"),
]


def normalize(text: str) -> str:
    out = []
    for line in text.splitlines():
        if any(p.match(line) for p in DROP):
            continue
        if line.startswith("-- Name: "):
            line = re.sub(r"; Owner: .*$", "", line)
        if line == "" and out and out[-1] == "":
            continue
        out.append(line)
    return "\n".join(out).strip() + "\n"


if __name__ == "__main__":
    src = sys.stdin if len(sys.argv) < 2 or sys.argv[1] == "-" else open(sys.argv[1])
    sys.stdout.write(normalize(src.read()))
```

11d. `scripts/db/prune_baseline.py`: turns the production dump into `0000_baseline.sql`.

```python
#!/usr/bin/env python3
"""
Build migrations/0000_baseline.sql from a schema-only pg_dump of production.

Audit 2026-09-25, finding F135. The migration chain in migrations/ cannot
build a database on its own: the core tables (products, sets, ...), a few
legacy functions and a backup table predate it. The baseline supplies exactly
those objects, and nothing a migration creates, so that

    ci_bootstrap.sql -> 0000_baseline.sql -> the chain (replay_migrations.sh)

rebuilds the production schema from files in this repo.

Rules, applied per pg_dump TOC entry ("-- Name: ...; Type: ...;" headers):
  * TABLE, SEQUENCE, DEFAULT, ROW SECURITY, and CONSTRAINT/FK CONSTRAINT,
    INDEX, TRIGGER, POLICY, COMMENT entries on a table that a migration
    creates (CREATE TABLE ... public.<name>) are dropped: the migration
    builds them.
  * FUNCTION entries for a function a migration creates (CREATE [OR REPLACE]
    FUNCTION public.<name>) are dropped, whatever the argument list.
  * CONSTRAINT, FK CONSTRAINT, INDEX, TRIGGER and POLICY entries whose name
    appears anywhere in the migrations' SQL (comments stripped) are dropped,
    and so are inline "CONSTRAINT <name> CHECK" lines inside a kept CREATE
    TABLE: a migration adds, drops or re-creates them.
  * ACL, DEFAULT ACL, the public SCHEMA entry and its COMMENT/ACL are
    dropped: ci_bootstrap.sql recreates Supabase's default privileges and the
    migrations set every grant that matters.
  * "ALTER ... OWNER TO" lines and pg_dump's \\restrict / \\unrestrict lines
    are dropped.
  * Everything else is kept in dump order.

A kept TRIGGER that executes a function a migration creates cannot be
replayed (the function does not exist yet at 0000). The script stops with
exit code 2 and names it; move that trigger into a new migration by hand.

Usage:
  python3 scripts/db/prune_baseline.py prod_schema_public.sql \
      > migrations/0000_baseline.sql
"""

from __future__ import annotations

import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = REPO / "migrations"
BASELINE_NAME = "0000_baseline.sql"

TOC_RE = re.compile(r"^-- Name: (?P<name>.*?); Type: (?P<type>[A-Z ]+); Schema: (?P<schema>[^;]*);")
IDENT = r'"?([A-Za-z_][A-Za-z0-9_]*)"?'


def _strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    return re.sub(r"--[^\n]*", " ", text)


def migration_facts():
    tables, functions, words = set(), set(), set()
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path.name == BASELINE_NAME:
            continue
        sql = _strip_comments(path.read_text())
        for m in re.finditer(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\"?public\"?\.)" + IDENT, sql, re.I):
            tables.add(m.group(1).lower())
        for m in re.finditer(r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:\"?public\"?\.)" + IDENT, sql, re.I):
            functions.add(m.group(1).lower())
        words.update(w.lower() for w in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", sql))
        # Quoted policy names such as "Users can view own profile".
        words.update(q.lower() for q in re.findall(r'"([^"]+)"', sql))
    return tables, functions, words


def split_entries(dump: str):
    """Return (header_lines, [(type, name, lines)]) in dump order."""
    lines = dump.splitlines()
    header, entries, current = [], [], None
    i = 0
    while i < len(lines):
        line = lines[i]
        m = TOC_RE.match(line)
        if m and i > 0 and lines[i - 1] == "--":
            if current is not None:
                # drop the "--" line that opened this header from the previous entry
                if current[2] and current[2][-1] == "--":
                    current[2].pop()
                entries.append(current)
            elif header and header[-1] == "--":
                header.pop()
            current = (m.group("type").strip(), m.group("name").strip(), ["--", line])
        elif current is None:
            header.append(line)
        else:
            current[2].append(line)
        i += 1
    if current is not None:
        entries.append(current)
    return header, entries


def _table_of(entry_type: str, name: str, body: str):
    if entry_type in ("TABLE", "ROW SECURITY"):
        return name.split()[0].lower()
    if entry_type in ("CONSTRAINT", "FK CONSTRAINT", "TRIGGER", "POLICY"):
        return name.split()[0].lower()
    m = re.search(r"(?:ALTER TABLE(?: ONLY)?|\bON(?: ONLY)?)\s+\"?public\"?\." + IDENT, body)
    return m.group(1).lower() if m else None


def _prune_inline_checks(lines, words):
    out, inside = [], False
    elements = []
    for line in lines:
        if not inside:
            out.append(line)
            if re.match(r"^CREATE (UNLOGGED )?TABLE ", line) and line.rstrip().endswith("("):
                inside, elements = True, []
            continue
        if line.startswith(")"):
            kept = []
            for el in elements:
                m = re.match(r"^\s+CONSTRAINT " + IDENT + r" ", el)
                if m and m.group(1).lower() in words:
                    continue
                kept.append(el.rstrip().rstrip(","))
            out.extend(k + "," for k in kept[:-1])
            if kept:
                out.append(kept[-1])
            out.append(line)
            inside = False
        else:
            elements.append(line)
    return out


def prune(dump: str):
    tables, functions, words = migration_facts()
    header, entries = split_entries(dump)
    kept, dropped, problems = [], [], []

    for entry_type, name, lines in entries:
        body = "\n".join(lines)
        table = _table_of(entry_type, name, body)
        fname = re.sub(r"\(.*$", "", name).lower()
        drop = False

        if entry_type in ("ACL", "DEFAULT ACL", "SCHEMA"):
            drop = True
        elif entry_type == "COMMENT" and name.startswith("SCHEMA "):
            drop = True
        elif entry_type == "FUNCTION":
            drop = fname in functions
        elif table is not None and table in tables:
            drop = True
        elif entry_type in ("CONSTRAINT", "FK CONSTRAINT", "INDEX", "TRIGGER", "POLICY"):
            # TOC tag: "<index>" for INDEX, "<table> <name>" for the others.
            own = name if entry_type == "INDEX" else name.split(" ", 1)[-1]
            drop = own.strip('"').lower() in words
        elif entry_type == "COMMENT":
            target = name.split(" ", 1)[-1]
            target_name = re.sub(r"\(.*$", "", target.split(".")[0]).lower()
            drop = target_name in tables or target_name in functions

        if drop:
            dropped.append(f"{entry_type} {name}")
            continue

        if entry_type == "TRIGGER":
            m = re.search(r"EXECUTE (?:FUNCTION|PROCEDURE)\s+\"?public\"?\." + IDENT, body)
            if m and m.group(1).lower() in functions:
                problems.append(f"TRIGGER {name} executes public.{m.group(1)}(), which a migration creates")

        # pg_dump ends the file with "\unrestrict <key>", which lands in the
        # last entry; psql rejects it outside restricted mode (and psql before
        # 16.10/17.6 does not know it), so strip it wherever it appears.
        lines = [l for l in lines
                 if not re.match(r"^ALTER .* OWNER TO ", l)
                 and not re.match(r"^\\(un)?restrict\b", l)]
        if entry_type == "TABLE":
            lines = _prune_inline_checks(lines, words)
        kept.append(lines)

    header = [l for l in header if not re.match(r"^\\(un)?restrict\b", l)]
    return header, kept, dropped, problems


GUARD = """
-- Refuse to run anywhere but an empty database. This file is for CI and local
-- replays only; production already has every object below.
DO $$ BEGIN
  IF to_regclass('public.products') IS NOT NULL THEN
    RAISE EXCEPTION '0000_baseline.sql builds an empty database only: public.products already exists. Never apply it to production.';
  END IF;
END $$;
"""


def main(argv):
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 64
    dump = pathlib.Path(argv[1]).read_text()
    header, kept, dropped, problems = prune(dump)
    for p in problems:
        print(f"ERROR: {p}", file=sys.stderr)
    if problems:
        return 2
    out = [
        "-- Migration 0000: schema baseline (audit 2026-09-25, F135).",
        "--",
        "-- GENERATED by scripts/db/prune_baseline.py from a schema-only pg_dump of",
        "-- production. Do not edit by hand except where a comment below says so.",
        "-- It holds only the objects no later migration creates: the core tables,",
        "-- their columns (including products.active), legacy functions such as",
        "-- get_price_history_deduplicated and handle_new_profile_portfolio, and",
        "-- production-only indexes, triggers and policies. Replay order and",
        "-- scaffolding: scripts/db/replay_migrations.sh.",
        "-- NEVER apply this file to production (the guard below refuses).",
        GUARD,
    ]
    out.extend(header)
    for lines in kept:
        out.extend(lines)
    sys.stdout.write("\n".join(out).rstrip() + "\n")
    print(f"kept {len(kept)} entries, dropped {len(dropped)}", file=sys.stderr)
    for d in dropped:
        print(f"  dropped {d}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

11e. `scripts/db/schema_drift.sh`:

```bash
#!/usr/bin/env bash
# Compare a schema-only pg_dump of the replayed database (read from stdin)
# with schema.sql, the normalised production dump. Audit 2026-09-25, F135.
#
#   pg_dump --schema-only --schema=public "<replay_once url>" | scripts/db/schema_drift.sh
#
# Exit 0: the migration chain reproduces schema.sql. Exit 1: a unified diff
# follows; "-" lines are production only, "+" lines are replay only.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if diff -u --label "schema.sql (production)" --label "replay of migrations/" \
     <(sed '1,/^-- END OF HEADER$/d' "$ROOT/schema.sql") \
     <(python3 "$ROOT/scripts/db/normalize_dump.py" -); then
  echo "No drift: migrations/ reproduces schema.sql"
else
  echo "::warning::migrations/ does not reproduce schema.sql (see diff above)"
  exit 1
fi
```

### Step 12. `.gitignore`

Append:

```text
# Raw production schema dumps handed over for WP21 (never commit; the
# normalised copy is schema.sql).
db-dumps/
```

### Step 13. Tests

Add the three test files from the Tests section, and prepend `"0000_baseline.sql"` to `EARLY_FILES` in `tests/test_migration_volatility.py` (WP01) and `tests/test_wp10_market_rpc_bounds.py` (WP10), so their notion of apply order matches `replay_migrations.sh`:

```python
EARLY_FILES = ("0000_baseline.sql", "create_box_recipes.sql", "20260506_market_performance_functions.sql")
```

(Their `apply_order()` keeps `EARLY_FILES` order and skips names that do not exist, so this is safe before the baseline exists.)

### Step 14. `.github/workflows/ci.yml`: new job

Add this job after the `python:` job (same indentation as the other jobs; the top-level `permissions: contents: read` from WP00 covers it). Do not rename any existing job: branch protection requires them by name.

```yaml
  database:
    # New required check (Owner actions): the migration chain must rebuild
    # the schema from an empty Postgres, every file must be safe to re-run,
    # and the Python suite (including the DB role tests) must pass.
    name: Database replay and Python tests
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        # Keep the major version equal to production's (SHOW server_version).
        image: postgres:17
        env:
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20
    env:
      PGSERVER_URL: postgresql://postgres:postgres@localhost:5432/postgres
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-python@v7
        with:
          python-version: "3.12"
      - name: psql client
        run: command -v psql || (sudo apt-get update -q && sudo apt-get install -y -q postgresql-client)
      - name: Replay migrations (once, and every file twice)
        run: scripts/db/replay_migrations.sh
      # schema.sql is refreshed by the owner after each production apply, so
      # a PR that adds a migration legitimately differs until then. Reported,
      # not blocking.
      - name: Drift against schema.sql (informational)
        continue-on-error: true
        run: |
          docker run --rm --network host postgres:17 \
            pg_dump --schema-only --schema=public \
            "postgresql://postgres:postgres@localhost:5432/replay_once" \
            | scripts/db/schema_drift.sh
      - name: Python tests (DB role tests run against replay_once)
        env:
          POKEFIN_TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/replay_once
        run: |
          pip install -r requirements.txt pytest
          python -m pytest tests/ -q
```

`docker run --network host` works on GitHub-hosted Linux runners and gives a `pg_dump` whose major version matches the server (the runner's own `pg_dump` is 16 and refuses a 17 server). If Owner action A1 reports a production major other than 17, change both `postgres:17` strings to that major.

### Step 15. Documentation

15a. `README.md`, Database section (`:278-297`). Replace everything from "Schema reference lives in `schema.sql`" through the bullet that ends "The rest, including `create_box_recipes.sql`, is idempotent." with:

```markdown
`schema.sql` is a normalised, schema-only `pg_dump` of production's `public`
schema (reference only; never run it). It includes everything the old
hand-written file lacked, such as `products.active`, `box_recipes.is_public`,
`portfolio_holdings.client_idempotency_key` and `auth_events`.

Migrations are hand-written SQL in `migrations/`, applied to production via
Supabase MCP `apply_migration` (or the SQL editor), and tracked in
`audits/HARDENING_FOLLOWUPS.md`. Since WP21 they also rebuild the database
from nothing:

- `0000_baseline.sql` holds only what predates the numbered series: the core
  tables (`products`, `sets`, `product_types`, `generations`,
  `product_price_history`, the user tables), the legacy functions
  `get_price_history_deduplicated` and `handle_new_profile_portfolio`, the
  `product_price_history_backup_20260128` table, and production-only indexes,
  triggers and policies. It is generated by `scripts/db/prune_baseline.py`
  and refuses to run on a database that already has `public.products`.
  Never apply it to production.
- `scripts/db/replay_migrations.sh` replays the chain on a throwaway local
  Postgres (after `scripts/db/ci_bootstrap.sql`, a Supabase-shaped scaffold)
  and applies every file twice to prove it is safe to re-run. CI runs it on
  every pull request (job "Database replay and Python tests") and diffs the
  result against `schema.sql`.

After applying a migration to production, refresh `schema.sql`:

    pg_dump --schema-only --schema=public "<session pooler URL>" \
      | python3 scripts/db/normalize_dump.py - > /tmp/body.sql
    # keep schema.sql's header (everything down to "-- END OF HEADER"),
    # update its date, then append /tmp/body.sql

Run a replay locally:

    docker run -d --name pokefin-replay -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
    PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh
```

Keep the "Verify that a migration actually applied" subsection and the ordering-constraints list that follow; in the ordering list add a first bullet: "`0000_baseline.sql` comes first; it only ever runs on an empty database (replays, CI)."

15b. `README.md`, scraper credentials (`:106-121`). Replace the paragraph "The scraper writes to Supabase and therefore needs the **secret** key ..." and the env-file example with:

```markdown
The scraper writes reference data (prices, volume, listings, exchange rates,
image URLs). Two flags choose how it reaches Supabase; both default to the
old behaviour until the owner cuts over (audit 2026-09-25, F081):

| Variable | Values | Credential it needs |
|---|---|---|
| `POKEFIN_DB_BACKEND` | `supabase` (default), `postgres` | `SUPABASE_SERVICE_ROLE_KEY`, or `POKEFIN_SCRAPER_DATABASE_URL` for the `pokefin_scraper` role (migration 0032) through the Supavisor session pooler |
| `POKEFIN_STORAGE_BACKEND` | `supabase` (default), `s3` | `SUPABASE_SERVICE_ROLE_KEY`, or `SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_REGION`, `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY` (Dashboard > Storage > S3 Configuration) |

With both set to the least-privilege values the scraper needs no secret key
at all. `pokefin_scraper` can read `products` and update only its price and
image columns, insert price history and exchange rates, upsert volume and
listings history, and manage `product_price_pending`; it cannot see any user
table, the auth schema or Storage.

    mkdir -p ~/.config/pokefin && chmod 700 ~/.config/pokefin
    cat > ~/.config/pokefin/env <<'EOF'
    SUPABASE_URL=https://<ref>.supabase.co
    POKEFIN_DB_BACKEND=postgres
    POKEFIN_SCRAPER_DATABASE_URL=postgresql://pokefin_scraper.<ref>:<password>@<pooler host>:5432/postgres?sslmode=require
    POKEFIN_STORAGE_BACKEND=s3
    SUPABASE_S3_ENDPOINT=https://<ref>.storage.supabase.co/storage/v1/s3
    SUPABASE_S3_REGION=<region>
    SUPABASE_S3_ACCESS_KEY_ID=...
    SUPABASE_S3_SECRET_ACCESS_KEY=...
    EOF
    chmod 600 ~/.config/pokefin/env
```

Keep the `secretsFile.py` alternative and the "`secrets_loader` reads `os.environ`" paragraph.

15c. `README.md`, "One-time backfills" (`:143-146`): after "Same environment requirement as above", add: "The backfills and `generate_skus.py` write to the database, so they are admin tools and still need `SUPABASE_SERVICE_ROLE_KEY`, which no longer lives in the env file. (`compare_prices.py` only reads, and uses `SUPABASE_PUBLISHABLE_KEY` like the weekly report: `set -a && . ~/.config/pokefin/report.env && set +a` first.) Supply it for the one run only, from your password manager: `read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY`, run the tool, then `unset SUPABASE_SERVICE_ROLE_KEY`."

15d. `README.md`, weekly report email config (`:220-224`): replace "Add to `~/.config/pokefin/env` (the same file the scraper's credentials live in ...)" with "Add to `~/.config/pokefin/report.env` (chmod 600), next to `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (the `sb_publishable_...` key the website uses): the report reads only public tables, so its env file holds no database secret. `run_weekly_report.sh` falls back to `~/.config/pokefin/env` when `report.env` is missing."

15e. `audits/HARDENING_FOLLOWUPS.md:21-22`: the sentence "They are idempotent and safe to re-run." is split across two lines there ("...in numeric order. They are" / "idempotent and safe to re-run."). Replace the words "They are" at the end of line 21 and the whole of line 22 with "Every file except `0000_baseline.sql` (empty databases only) is safe to re-run; CI proves it on every PR with `scripts/db/replay_migrations.sh` (WP21). `0003` became re-runnable in WP21." Add to section 7, in the existing style, as the newest bullet of the newest-first run of migration bullets: directly above WP16's "**Migration 0030" bullet (or, if absent, above the topmost of the WP10 "**Migrations 0027, 0028 and 0029", WP06 "**Migration 0026" and WP01 "**Migrations 0024 and 0025" bullets); keep WP04's "Signed-in data ran as anon" bullet and the old 0008-0014 bullet above it (leave the dates for the owner to fill in; you have no production access, so do not write "applied"):

```markdown
- **WP21 (audit 2026-09-25, F081/F133/F135)**: migrations 0031
  (profiles column grants, size CHECKs, per-owner row caps) and 0032
  (`pokefin_scraper` login role) written; `0000_baseline.sql` and
  `schema.sql` generated from a production dump; CI replays the chain.
  Owner steps: apply 0031/0032, set the role password, cut the scraper
  over (`POKEFIN_DB_BACKEND=postgres`, `POKEFIN_STORAGE_BACKEND=s3`), move
  the report to `report.env` with the publishable key, then remove and
  rotate the `sb_secret_` key. Status: pending.
```

15f. `.github/copilot-instructions.md` (rewritten by WP20; its first line says "If they disagree with the code, the code wins: fix this file in the same PR"). Make exactly two edits and leave the rest of the file alone:

- In "Project overview", replace the bullet that starts "`migrations/`: numbered SQL migrations, applied by hand" with: "`migrations/`: numbered SQL migrations, applied to production by hand (Supabase MCP `apply_migration` or the SQL editor), in order, and recorded in `audits/HARDENING_FOLLOWUPS.md`. `0000_baseline.sql` only runs on an empty database; `scripts/db/replay_migrations.sh` rebuilds the chain locally and in CI (job "Database replay and Python tests"). `schema.sql` is a normalised `pg_dump` of production, refreshed after each apply; it is a reference, never run it."
- In "Environment variables", replace the "Scraper host:" line with: "Scraper host: `SUPABASE_URL`, `REVALIDATE_URL`, `REVALIDATE_SECRET`, plus the backend flags `POKEFIN_DB_BACKEND` (`supabase` default, or `postgres` with `POKEFIN_SCRAPER_DATABASE_URL` for the `pokefin_scraper` role) and `POKEFIN_STORAGE_BACKEND` (`supabase` default, or `s3` with the `SUPABASE_S3_*` variables). `SUPABASE_SERVICE_ROLE_KEY` is needed only while a flag is on its `supabase` default and by the admin backfills. `secrets_loader.py` reads the environment first and falls back to a gitignored `secretsFile.py` for local development only."

If WP20 has not merged (the file still describes the old architecture, with no "Environment variables" section), skip 15f and say so in the PR body.

### Step 16. End of phase A: push and hand over

```bash
python -m pytest tests/ -q          # all pass; the 26 DB tests are skipped without POKEFIN_TEST_DATABASE_URL
git add -A && git commit -m "wip(db): WP21 phase A"
git push -u origin remediation/wp21-db-hardening-least-privilege
```

Open a **draft** PR titled as in "Commit and PR". In the description, paste Owner actions A1 to A5 and ask the owner to review `migrations/0031_*.sql` and `migrations/0032_*.sql` before applying them. Stop until the owner reports that `db-dumps/prod_schema_public.sql` exists in your working tree (or hands you the file to put there). If the owner cannot supply it, leave the PR in draft and report that phase B is blocked.

### Step 17. Phase B: `migrations/0000_baseline.sql`

```bash
test -s db-dumps/prod_schema_public.sql && head -12 db-dumps/prod_schema_public.sql
# expect a pg_dump header ("-- Dumped from database version 17...")
grep -c "Type: TABLE;" db-dumps/prod_schema_public.sql     # expect 15 or more (16 if the backup table still exists)
grep -n "products_scraper\|enforce_owner_row_cap" db-dumps/prod_schema_public.sql | head -3
# expect hits: the owner applied 0031 and 0032 before dumping. If there are none,
# the dump predates them; that is fine for the baseline but step 19's diff will
# show exactly their objects.

python3 scripts/db/prune_baseline.py db-dumps/prod_schema_public.sql \
  > migrations/0000_baseline.sql 2> /tmp/wp21_prune.log; echo "exit=$?"
head -1 /tmp/wp21_prune.log      # "kept N entries, dropped M"
grep "^-- Name:" migrations/0000_baseline.sql
```

Expected: exit 0; the kept list contains the TABLE entries for `exchange_rates`, `generations`, `portfolio_holdings`, `portfolio_lots`, `portfolios`, `product_price_history`, `product_price_history_backup_20260128`, `product_types`, `products`, `profiles`, `sets` (plus any other production-only table), their identity SEQUENCE and PRIMARY KEY/UNIQUE entries, the FUNCTION entries for `get_price_history_deduplicated` and `handle_new_profile_portfolio` (and any other function no migration creates), production-only indexes (for example the legacy `portfolio_holdings(portfolio_id)` index that 0025 detects), production-only triggers and policies, and ROW SECURITY entries. It must not contain `box_recipes`, `auth_events`, `product_sales_history`, `product_listings_history`, `product_price_pending`, any `GRANT`, or any function a migration creates (`grep -n "delete_my_account\|export_my_data\|get_market_product" migrations/0000_baseline.sql` prints nothing).

If the script exits 2 ("TRIGGER ... executes public.X(), which a migration creates"): delete that TRIGGER entry from `0000_baseline.sql` by hand and recreate it in a new migration `NNNN_record_production_triggers.sql` (next free number, `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER`, a no-op on production), with a header comment saying so.

Search the baseline for anything that looks like a credential before committing: `grep -n -i "secret\|password\|apikey\|bearer" migrations/0000_baseline.sql` must print nothing but comments you can explain.

### Step 18. Phase B: regenerate `schema.sql`

```bash
{
cat <<'EOF'
-- schema.sql: production schema reference (public schema only).
--
-- GENERATED, do not edit. Source: schema-only pg_dump of production taken on
-- YYYY-MM-DD, after migrations up to 0032 were applied, normalised with
-- scripts/db/normalize_dump.py. Refresh it the same way after applying a
-- migration to production (README.md, "Database").
--
-- Reference only; never run it. To build a database, replay migrations/
-- with scripts/db/replay_migrations.sh. CI compares that replay with this
-- file (job "Database replay and Python tests", step "Drift against
-- schema.sql").
-- END OF HEADER
EOF
python3 scripts/db/normalize_dump.py db-dumps/prod_schema_public.sql
} > schema.sql
```

Replace `YYYY-MM-DD` with the dump date the owner gives you (or the date on the dump file). If the owner dumped before applying 0031/0032, write "up to 0030" instead.

### Step 19. Phase B: replay, compare, reconcile

Start a throwaway server whose major version matches production (Owner action A1 tells you which):

```bash
docker run -d --rm --name pokefin-replay -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
# wait until the server accepts connections (up to 30 s)
for i in $(seq 30); do docker exec pokefin-replay pg_isready -U postgres -q && break; sleep 1; done
export PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres
scripts/db/replay_migrations.sh
# expect: one "== <file>" line per migration, then
# "OK: <N> files replayed once (replay_once) and twice (replay_twice)"

docker exec pokefin-replay pg_dump -U postgres --schema-only --schema=public replay_once \
  | scripts/db/schema_drift.sh
# expect: "No drift: migrations/ reproduces schema.sql"
```

Without Docker, use a local PostgreSQL of production's major (for example 17; `initdb` and `pg_ctl` refuse to run as root, so run them as the `postgres` OS user):

```bash
PGBIN=/usr/lib/postgresql/17/bin
sudo -u postgres mkdir -p /tmp/wp21-pg
sudo -u postgres $PGBIN/initdb -D /tmp/wp21-pg/data -U postgres --auth=trust -E UTF8
sudo -u postgres $PGBIN/pg_ctl -D /tmp/wp21-pg/data -o "-p 55432 -c listen_addresses=127.0.0.1 -k /tmp/wp21-pg" -l /tmp/wp21-pg/log -w start
psql "postgresql://postgres@127.0.0.1:55432/postgres" -c "ALTER USER postgres PASSWORD 'postgres'"
export PGSERVER_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres
scripts/db/replay_migrations.sh
$PGBIN/pg_dump --schema-only --schema=public "postgresql://postgres:postgres@127.0.0.1:55432/replay_once" | scripts/db/schema_drift.sh
```

and use `127.0.0.1:55432` in the pytest command below; stop it afterwards with `sudo -u postgres $PGBIN/pg_ctl -D /tmp/wp21-pg/data stop`.

If the replay fails, read the failing file and statement:

- `relation "public.product_price_history_backup_20260128" does not exist` (in 0012), or `function public.handle_new_profile_portfolio() does not exist` (0006), or `function public.get_price_history_deduplicated(bigint[], text) does not exist` (0007/0012): production dropped that object after the migration ran. Add a minimal stand-in to the END of `0000_baseline.sql` under a comment `-- Dropped in production on <date>; stand-in so <file> replays. Removed again by NNNN.` (`CREATE TABLE public.product_price_history_backup_20260128 (id bigint);` or `CREATE FUNCTION public.handle_new_profile_portfolio() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;` or `CREATE FUNCTION public.get_price_history_deduplicated(bigint[], text) RETURNS void LANGUAGE sql AS $$ SELECT $$;`), and add `migrations/NNNN_record_out_of_band_drops.sql` (next free number) with the matching `DROP ... IF EXISTS`, which is a no-op on production. Owner action A1 tells you in advance which of these applies.
- Anything else: stop and report the file, statement and error; do not edit an applied migration beyond what step 1 did.

If the drift check prints a diff, classify every hunk:

- **Host noise** (grants to a Supabase internal role not yet in `INTERNAL_ROLES`, an extension comment): extend the filters in `normalize_dump.py`, regenerate `schema.sql` (step 18), rerun.
- **Production has something the chain does not produce, or differs from it** (a column default, a constraint, an index or a function body changed by hand in the dashboard): do not edit `schema.sql` or an applied migration. Add `migrations/NNNN_record_production_drift.sql` (next free number) that makes the chain produce production's state, written so it is a no-op on production (`CREATE OR REPLACE`, `IF NOT EXISTS`, DO blocks), with one header comment per hunk explaining it. List it under Owner actions for the owner to apply (it must change nothing there).
- **The replay has something production lacks**: a migration in the repo was never applied, or was applied differently. Stop and report it: that is exactly the drift `verify_migration.py` exists for, and the owner must decide.

Then run the full Python suite against the replayed database:

```bash
POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once \
  python -m pytest tests/ -q
# expect: everything passes, including the 26 tests in tests/test_db_roles_integration.py
# tests/test_migration_volatility.py (WP01) now also reads the legacy functions in
# 0000_baseline.sql. If it fails on one of them (a production function declared
# STABLE or IMMUTABLE whose body writes), do not edit the baseline or the test:
# stop and report the function; it is a real production defect for the owner.
docker stop pokefin-replay
```

### Step 20. Phase B: finish the PR

In `audits/HARDENING_FOLLOWUPS.md`, change the WP21 bullet's first sentence (step 15e) to "migrations 0031 (...) and 0032 (...) applied <apply date the owner gave you> by the owner via Supabase MCP", keeping "Status: pending" (the cut-over in Owner actions B is still open). Then squash your commits into one with the message in "Commit and PR" (`git reset --soft $(git merge-base HEAD origin/master) && git commit -F <message file>`), push with `git push --force-with-lease`, and mark the PR ready. Paste the outputs of step 19 (replay summary line, the drift line, the pytest summary) and the Verification section into the description. The `db-dumps/` file stays untracked (`git status` must not list it).

## Pitfalls: do not do this

- **Do not write `REVOKE UPDATE (email, created_at, updated_at) ON public.profiles FROM authenticated` on its own.** Supabase grants `authenticated` table-level UPDATE, and a column-level REVOKE does not reduce a table-level grant. Revoke table-level UPDATE and grant `UPDATE (username)` back.
- **Do not revoke SELECT on `profiles` from `authenticated`, or UPDATE on `username`.** WP04's `PATCH /api/profile` needs both (`RETURNING id, username, email`), and `GET /api/auth/me` reads the row.
- **Do not add column grants on `box_recipes`/`portfolios`/`portfolio_holdings` for `user_id`/`created_at`.** RLS `WITH CHECK` already blocks reassignment; column grants would need every updatable column listed and maintained (WP06 added `currency`).
- **Do not use `pg_column_size(packs)` for the size CHECK.** It can report the compressed size; `octet_length(packs::text)` measures what the client sent.
- **Do not mint a JWT with `role: pokefin_scraper` or grant `pokefin_scraper` to `authenticator`.** The legacy HS256 keys are revoked (HARDENING_FOLLOWUPS.md:195) and the new `sb_` keys are not JWTs (verifier correction on F081); the only viable path is a Postgres login through the pooler. Granting it to `authenticator` would also expose it to PostgREST.
- **Do not put a password in `0032` or run `ALTER ROLE ... PASSWORD '...'` in the SQL editor.** The file is public in the repo and the editor keeps query history; the owner uses psql `\password`, which sends only a SCRAM verifier.
- **Do not create the role with BYPASSRLS, and do not skip the RLS policies.** A `NOBYPASSRLS` non-owner role is filtered by RLS; without the `*_scraper` policies every write fails with "new row violates row-level security policy" (verifier correction on F081).
- **Do not grant INSERT or DELETE on `products`, or table-level UPDATE.** The scraper never creates or deletes products (admin tools do, with the service key), and column-level UPDATE keeps `url` and `sku` out of its reach.
- **Do not remove the supabase-py path or make `postgres`/`s3` the default.** The service key must keep working until the owner has cut over and confirmed a clean run; the flags are the rollback.
- **Do not route storage through the database role.** Storage's REST API accepts only JWT-bearing keys; a Postgres role cannot upload objects. Use the S3 access key.
- **Do not create a new read-only database role for the weekly report.** It reads only anon-readable tables; a new role would add a secret to protect without removing any privilege. The publishable key is already public.
- **Do not use `supabase db dump` for the baseline input.** It quotes every identifier and post-processes the output; `prune_baseline.py` expects plain `pg_dump` TOC headers. (It tolerates quoted names, but the plain dump is what was tested.)
- **Do not hand-write `0000_baseline.sql` from the old `schema.sql`.** The point is fidelity to production (legacy function bodies, `products.active`, production-only indexes); only the prune script's output, plus the documented stand-ins, goes in.
- **Do not apply `0000_baseline.sql` to production, and do not remove its guard.** It is for empty databases only.
- **Do not edit `schema.sql` by hand to make the drift check pass.** Either the normaliser is missing a noise filter, or production drifted and needs a reconciling migration (step 19).
- **Do not make the drift step blocking.** A PR that adds a migration legitimately differs from `schema.sql` until the owner applies it and refreshes the file.
- **Do not replay in plain filename order.** `20260506_...` sorts last but must run second; replaying it after 0023 hard-fails (README.md:449-455).
- **Do not run the Python suite with `POKEFIN_DB_BACKEND` or `POKEFIN_STORAGE_BACKEND` exported** (for example after sourcing a cut-over env file). `main` reads them at import, so `test_default_backend_still_uses_supabase` fails and other tests try to reach a real pooler or S3. Run tests in a clean shell.
- **Do not edit the WP05/WP06 route error mappers** to add a "limit reached" message. That is those packages' code; record it as a follow-up (step 2).
- **Do not commit `db-dumps/`**, and do not paste the pooler URL, the role password or the S3 keys into the PR, a test, or a log line. `ScraperDB` never logs its DSN; keep it that way.

## Tests

Three new files under `tests/` plus the `EARLY_FILES` edit in step 13. The existing suite must pass unchanged (161 tests before WP16 plus whatever WP11 and WP16 added).

**`tests/test_scraper_backends.py`** (unit, no database, no network). Cases: backend flags default to `supabase`, are case-insensitive, and refuse unknown values; `load_scraper_database_url` and `load_storage_s3_credentials` name what is missing; `load_supabase_readonly_credentials` prefers the publishable key, refuses an `sb_secret_` value in that slot, and falls back to the service key with a warning; `check_dsn` refuses remote URLs without `sslmode=require|verify-ca|verify-full` and accepts localhost; `ScraperDB` connects lazily with `autocommit=True`, `prepare_threshold=None` and `SET TIME ZONE 'UTC'`, refuses `update_product` columns outside the grant, returns PostgREST-shaped ISO strings, sends one upsert statement per batch with the right `ON CONFLICT` key, retries once after `OperationalError` and never retries a `UniqueViolation`; `S3ImageStore` calls `put_object` with bucket, key, content type and `max-age` and builds the same public URL supabase-py did; `main.py` routes `fetch_products_needing_update`, the sales/listings flushes (batch and per-row fallback), `upload_thumbnail`, `_insert_price_history_row` (duplicate counts as written), and the pending-price helpers through `pg_db`/`image_store` when set, and keeps `pg_db`/`image_store` `None` by default. Full file (run while writing this spec against a copy of `main.py` with steps 8a to 8i and WP16's helpers applied: 33 passed):

```python
#!/usr/bin/env python3
"""
Unit tests for the least-privilege scraper backends (audit 2026-09-25, F081):
secrets_loader backend selection, scraper_db.ScraperDB (with a fake
connection), scraper_storage.S3ImageStore (with a fake client), and main.py's
dispatch to them. No database, network or AWS access.

Run with: python -m pytest tests/test_scraper_backends.py -v
"""
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

sys.modules['secretsFile'] = MagicMock()
sys.modules['secretsFile'].SUPABASE_URL = 'https://test.supabase.co'
sys.modules['secretsFile'].SUPABASE_KEY = 'test-key'

import secrets_loader  # noqa: E402
from scraper_db import PRODUCT_UPDATE_COLUMNS, ScraperDB, check_dsn  # noqa: E402
from scraper_storage import S3ImageStore  # noqa: E402

LOCAL_DSN = "postgresql://pokefin_scraper:pw@localhost:5432/postgres"


class FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class FakeConnection:
    def __init__(self, rows=None, fail_first=None):
        self.closed = False
        self.statements = []
        self._rows = rows or []
        self._fail_first = fail_first

    def execute(self, query, params=None):
        text = query if isinstance(query, str) else query.as_string(None)
        if self._fail_first is not None and not text.startswith("SET TIME ZONE"):
            exc, self._fail_first = self._fail_first, None
            raise exc
        self.statements.append((text, params))
        return FakeCursor(self._rows)

    def close(self):
        self.closed = True


def make_db(conn):
    calls = []

    def connect(dsn, **kwargs):
        calls.append(kwargs)
        return conn

    return ScraperDB(LOCAL_DSN, connect=connect), calls


class TestBackendSelection:
    def test_defaults_are_supabase(self, monkeypatch):
        monkeypatch.delenv("POKEFIN_DB_BACKEND", raising=False)
        monkeypatch.delenv("POKEFIN_STORAGE_BACKEND", raising=False)
        assert secrets_loader.scraper_db_backend() == "supabase"
        assert secrets_loader.scraper_storage_backend() == "supabase"

    def test_values_are_case_insensitive(self, monkeypatch):
        monkeypatch.setenv("POKEFIN_DB_BACKEND", " Postgres ")
        monkeypatch.setenv("POKEFIN_STORAGE_BACKEND", "S3")
        assert secrets_loader.scraper_db_backend() == "postgres"
        assert secrets_loader.scraper_storage_backend() == "s3"

    @pytest.mark.parametrize("name", ["POKEFIN_DB_BACKEND", "POKEFIN_STORAGE_BACKEND"])
    def test_unknown_value_is_refused(self, monkeypatch, name):
        monkeypatch.setenv(name, "pg")
        with pytest.raises(RuntimeError, match=name):
            secrets_loader._backend(name)

    def test_database_url_is_required(self, monkeypatch):
        monkeypatch.delenv("POKEFIN_SCRAPER_DATABASE_URL", raising=False)
        with pytest.raises(RuntimeError, match="POKEFIN_SCRAPER_DATABASE_URL"):
            secrets_loader.load_scraper_database_url()

    def test_s3_credentials_name_what_is_missing(self, monkeypatch):
        for name in ("SUPABASE_S3_ENDPOINT", "SUPABASE_S3_REGION",
                     "SUPABASE_S3_ACCESS_KEY_ID", "SUPABASE_S3_SECRET_ACCESS_KEY"):
            monkeypatch.delenv(name, raising=False)
        monkeypatch.setenv("SUPABASE_S3_ENDPOINT", "https://ref.storage.supabase.co/storage/v1/s3")
        with pytest.raises(RuntimeError) as info:
            secrets_loader.load_storage_s3_credentials()
        assert "SUPABASE_S3_REGION" in str(info.value)
        assert "SUPABASE_S3_ENDPOINT" not in str(info.value)

    def test_readonly_prefers_publishable_key(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_abc")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_xyz")
        assert secrets_loader.load_supabase_readonly_credentials() == (
            "https://test.supabase.co", "sb_publishable_abc")

    def test_readonly_refuses_a_secret_in_the_publishable_slot(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_secret_oops")
        with pytest.raises(RuntimeError, match="sb_publishable_"):
            secrets_loader.load_supabase_readonly_credentials()

    def test_readonly_falls_back_to_service_key_with_warning(self, monkeypatch, capsys):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_xyz")
        assert secrets_loader.load_supabase_readonly_credentials()[1] == "sb_secret_xyz"
        assert "SUPABASE_PUBLISHABLE_KEY is not set" in capsys.readouterr().err


class TestCheckDsn:
    @pytest.mark.parametrize("dsn", [
        "postgresql://u:p@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
        "postgresql://u:p@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=prefer",
        "host=aws-0-eu-west-1.pooler.supabase.com user=u",
        "mysql://u:p@localhost/x",
    ])
    def test_refused(self, dsn):
        with pytest.raises(ValueError):
            check_dsn(dsn)

    @pytest.mark.parametrize("dsn", [
        "postgresql://u:p@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require",
        "postgresql://u:p@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full",
        LOCAL_DSN,
    ])
    def test_accepted(self, dsn):
        check_dsn(dsn)


class TestScraperDB:
    def test_connects_lazily_with_autocommit_and_utc(self):
        conn = FakeConnection()
        db, calls = make_db(conn)
        assert calls == []
        db.insert_price_history(1, 10.0)
        assert calls[0]["autocommit"] is True
        assert calls[0]["prepare_threshold"] is None
        assert conn.statements[0][0] == "SET TIME ZONE 'UTC'"
        assert "INSERT INTO public.product_price_history" in conn.statements[1][0]
        assert conn.statements[1][1] == (1, 10.0)

    def test_update_refuses_columns_outside_the_grant(self):
        db, _ = make_db(FakeConnection())
        with pytest.raises(ValueError, match="url"):
            db.update_product(1, {"usd_price": 1.0, "url": "https://evil.example"})

    def test_update_writes_only_given_columns(self):
        conn = FakeConnection()
        db, _ = make_db(conn)
        db.update_product(7, {"usd_price": 2.5, "last_updated": "2026-09-28T08:00:00+00:00"})
        text, params = conn.statements[-1]
        assert text.startswith("UPDATE public.products SET ")
        assert '"usd_price"' in text and '"last_updated"' in text and "image_url" not in text
        assert "AT TIME ZONE 'UTC'" in text
        assert params == {"id": 7, "usd_price": 2.5, "last_updated": "2026-09-28T08:00:00+00:00"}
        assert set(PRODUCT_UPDATE_COLUMNS) == {"usd_price", "last_updated", "image_url", "last_image_update"}

    def test_fetch_returns_postgrest_shaped_rows(self):
        naive = datetime(2026, 9, 27, 8, 0, 0)
        aware = datetime(2026, 9, 27, 8, 0, 0, tzinfo=timezone.utc)
        conn = FakeConnection(rows=[{"id": 1, "last_updated": naive, "last_image_update": aware, "url": "u"}])
        db, _ = make_db(conn)
        now = datetime.now(timezone.utc)
        rows = db.fetch_products_needing_update(now - timedelta(hours=23), now - timedelta(hours=24))
        assert rows == [{"id": 1, "last_updated": "2026-09-27T08:00:00",
                         "last_image_update": "2026-09-27T08:00:00+00:00", "url": "u"}]

    def test_upsert_accepts_one_row_or_a_batch(self):
        conn = FakeConnection()
        db, _ = make_db(conn)
        db.upsert_sales_history({"product_id": 1, "bucket_date": "2026-09-27", "granularity": "day"})
        db.upsert_listings_history([{"product_id": 1, "snapshot_date": "2026-09-27"}])
        db.upsert_sales_history([])
        sales, listings = conn.statements[1], conn.statements[2]
        assert "ON CONFLICT (\"product_id\", \"bucket_date\", \"granularity\")" in sales[0]
        assert "ON CONFLICT (\"product_id\", \"snapshot_date\")" in listings[0]
        assert len(conn.statements) == 3  # SET TIME ZONE + two upserts; the empty batch sent nothing

    def test_reconnects_once_after_a_dropped_connection(self):
        import psycopg
        first = FakeConnection(fail_first=psycopg.OperationalError("server closed the connection"))
        second = FakeConnection()
        conns = iter([first, second])
        db = ScraperDB(LOCAL_DSN, connect=lambda dsn, **kw: next(conns))
        db.clear_pending_price(3)
        assert first.closed
        assert "DELETE FROM public.product_price_pending" in second.statements[-1][0]

    def test_sql_errors_are_not_retried(self):
        import psycopg
        conn = FakeConnection(fail_first=psycopg.errors.UniqueViolation("duplicate key value"))
        db, calls = make_db(conn)
        with pytest.raises(psycopg.errors.UniqueViolation):
            db.insert_price_history(1, 1.0)
        assert len(calls) == 1


class TestS3ImageStore:
    def test_upload_and_public_url(self):
        client = MagicMock()
        store = S3ImageStore("https://ref.supabase.co/", "https://e", "r", "a", "b", client=client)
        store.upload("products/1.jpg", b"img", "image/jpeg", "604800")
        client.put_object.assert_called_once_with(
            Bucket="product-images", Key="products/1.jpg", Body=b"img",
            ContentType="image/jpeg", CacheControl="max-age=604800")
        assert store.public_url("products/1.jpg") == \
            "https://ref.supabase.co/storage/v1/object/public/product-images/products/1.jpg"


class TestMainDispatch:
    """main.py sends each call to pg_db / image_store when they are set."""

    def test_fetch_products_delegates(self):
        import main
        fake = MagicMock()
        fake.fetch_products_needing_update.return_value = [{"id": 1}]
        with patch.object(main, "pg_db", fake), patch.object(main, "supabase") as sb:
            a, b = datetime.now(timezone.utc), datetime.now(timezone.utc)
            assert main.fetch_products_needing_update(a, b) == [{"id": 1}]
            fake.fetch_products_needing_update.assert_called_once_with(a, b)
            sb.table.assert_not_called()

    def test_sales_flush_uses_pg_db_batch_then_per_row(self):
        import main
        fake = MagicMock()
        fake.upsert_sales_history.side_effect = [Exception("boom"), None, None]
        rows = [{"product_id": 1, "bucket_date": "2026-09-01", "granularity": "day"},
                {"product_id": 2, "bucket_date": "2026-09-01", "granularity": "day"}]
        with patch.object(main, "pg_db", fake), patch.object(main, "supabase") as sb, \
                patch.object(main, "_volume_tables_missing", False):
            assert main._flush_sales_history_batch(rows) == (2, 0)
            sb.table.assert_not_called()
        assert fake.upsert_sales_history.call_count == 3

    def test_listings_flush_uses_pg_db(self):
        import main
        fake = MagicMock()
        rows = [{"product_id": 1, "snapshot_date": "2026-09-01"}]
        with patch.object(main, "pg_db", fake), patch.object(main, "supabase") as sb, \
                patch.object(main, "_volume_tables_missing", False):
            assert main._flush_listings_history_batch(rows) == (1, 0)
            fake.upsert_listings_history.assert_called_once_with(rows)
            sb.table.assert_not_called()

    def test_thumbnail_goes_to_s3_store(self):
        import main
        store = MagicMock()
        with patch.object(main, "image_store", store), patch.object(main, "supabase") as sb:
            assert main.upload_thumbnail(5, thumb_bytes=b"webp") is True
            store.upload.assert_called_once_with(
                main.thumbnail_object_path(5), b"webp", "image/webp", main.IMAGE_CACHE_CONTROL_SECONDS)
            sb.storage.from_.assert_not_called()

    def test_default_backend_still_uses_supabase(self):
        import main
        assert main.DB_BACKEND == "supabase" and main.pg_db is None
        assert main.STORAGE_BACKEND == "supabase" and main.image_store is None


class TestMainDispatchPriceGuard:
    """WP16's price-guard helpers route through pg_db when it is set."""

    def test_price_history_duplicate_counts_as_written(self):
        import psycopg
        import main
        fake = MagicMock()
        fake.insert_price_history.side_effect = psycopg.errors.UniqueViolation(
            'duplicate key value violates unique constraint "product_price_history_product_day_uidx"')
        with patch.object(main, "pg_db", fake), patch.object(main, "supabase") as sb:
            assert main._insert_price_history_row(1, 10.0) is True
            sb.table.assert_not_called()

    def test_price_history_other_failure_is_false(self):
        import main
        fake = MagicMock()
        fake.insert_price_history.side_effect = Exception("permission denied for table product_price_history")
        with patch.object(main, "pg_db", fake):
            assert main._insert_price_history_row(1, 10.0) is False

    def test_pending_prices_round_trip(self):
        import main
        fake = MagicMock()
        fake.load_pending_prices.return_value = [
            {"product_id": 4, "usd_price": 40.0, "observed_at": "2026-09-28T08:00:00+00:00"}]
        now = datetime(2026, 9, 28, 12, 0, tzinfo=timezone.utc)
        with patch.object(main, "pg_db", fake), patch.object(main, "supabase") as sb:
            pending = main.load_pending_prices()
            assert pending[4]["usd_price"] == 40.0
            assert pending[4]["observed_at"] == datetime(2026, 9, 28, 8, 0, tzinfo=timezone.utc)
            assert main.save_pending_price(4, 41.0, now) is True
            fake.save_pending_price.assert_called_once_with(4, 41.0, now.isoformat())
            assert main.clear_pending_price(4) is True
            fake.clear_pending_price.assert_called_once_with(4)
            sb.table.assert_not_called()

    def test_unreadable_pending_table_returns_none(self):
        import main
        fake = MagicMock()
        fake.load_pending_prices.side_effect = Exception('relation "public.product_price_pending" does not exist')
        with patch.object(main, "pg_db", fake):
            assert main.load_pending_prices() is None
```

**`tests/test_db_roles_integration.py`** (needs the replayed database; skipped unless `POKEFIN_TEST_DATABASE_URL` is set; CI sets it). Cases: `pokefin_scraper` is unprivileged and can log in; a full scraper cycle through `ScraperDB` works as that role (exchange rate, due-products query before and after an update, history insert and same-day `UniqueViolation`, product update, sales upsert twice with the second value winning, listings upsert, pending save/load/clear); 13 statements outside its grant fail with `InsufficientPrivilege` (products `url`/`sku` update, products insert/delete, history delete, reading profiles, portfolios, holdings, box_recipes, auth_events, auth.users, calling `export_my_data` and `delete_my_account`); as `authenticated`: username update with `RETURNING` works, six other profile writes (including `TRUNCATE`) fail with `InsufficientPrivilege`, oversized `packs` and the 101st recipe and a 1001-row holdings insert fail with `CheckViolation`, and the lots notes CHECK exists. Full file (26 passed against the replayed simulated database, reviewed on PostgreSQL 16):

If a fixture INSERT fails in phase B with `NotNullViolation` or `CheckViolation` because production's `products`, `sets` or `generations` carry a column the old `schema.sql` did not show, add that column with a valid value to the fixture's INSERT. Never delete or weaken an assertion to make the file pass.

```python
"""
Database-level checks for migrations 0031 (F133) and 0032 (F081), run against
a database rebuilt by scripts/db/replay_migrations.sh.

Skipped unless POKEFIN_TEST_DATABASE_URL points at that replayed database as a
superuser (CI sets it; see .github/workflows/ci.yml, job "database").
NEVER point it at production: the fixtures write rows and change the
pokefin_scraper password.

Run with:
  POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/replay_once \
    python -m pytest tests/test_db_roles_integration.py -v
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse, urlunparse

import pytest

DSN = os.environ.get("POKEFIN_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="POKEFIN_TEST_DATABASE_URL not set")

psycopg = pytest.importorskip("psycopg")
from psycopg import errors  # noqa: E402

SCRAPER_PASSWORD = "ci-only-" + uuid.uuid4().hex


@pytest.fixture(scope="module")
def admin():
    host = (urlparse(DSN).hostname or "").lower()
    assert host in ("localhost", "127.0.0.1", "postgres"), "refusing a non-local database"
    with psycopg.connect(DSN, autocommit=True) as conn:
        yield conn


@pytest.fixture(scope="module")
def product_id(admin):
    admin.execute("INSERT INTO public.generations (name) VALUES (%s) ON CONFLICT DO NOTHING", ("wp21-gen",))
    set_id = admin.execute(
        "INSERT INTO public.sets (code, name) VALUES ('WP21', 'WP21 set') RETURNING id"
    ).fetchone()[0]
    return admin.execute(
        "INSERT INTO public.products (set_id, usd_price, url, last_updated) "
        "VALUES (%s, 10, 'https://www.tcgplayer.com/product/1', now() - interval '2 days') RETURNING id",
        (set_id,),
    ).fetchone()[0]


@pytest.fixture(scope="module")
def scraper_db(admin, product_id):
    from scraper_db import ScraperDB

    admin.execute(f"ALTER ROLE pokefin_scraper PASSWORD '{SCRAPER_PASSWORD}'")
    parts = urlparse(DSN)
    netloc = f"pokefin_scraper:{SCRAPER_PASSWORD}@{parts.hostname}:{parts.port or 5432}"
    db = ScraperDB(urlunparse(parts._replace(netloc=netloc)))
    yield db
    db.close()


@pytest.fixture
def user(admin):
    """A fresh auth user; the 0004 trigger creates the profile (and the legacy
    trigger, where present, the portfolio)."""
    uid = str(uuid.uuid4())
    name = "u" + uuid.uuid4().hex[:10]
    admin.execute(
        "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (%s, %s, %s)",
        (uid, f"{name}@example.com", psycopg.types.json.Jsonb({"username": name})),
    )
    yield uid
    admin.execute("DELETE FROM auth.users WHERE id = %s", (uid,))


def as_user(admin, uid):
    """Open a transaction as the authenticated role with uid's JWT claim."""
    admin.execute("BEGIN")
    admin.execute("SET LOCAL ROLE authenticated")
    admin.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", (uid,))


def rollback(admin):
    admin.execute("ROLLBACK")


# ---------------------------------------------------------------- 0032 (F081)

class TestScraperRole:
    def test_role_is_unprivileged(self, admin):
        row = admin.execute(
            "SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin "
            "FROM pg_roles WHERE rolname = 'pokefin_scraper'"
        ).fetchone()
        assert row == (False, False, False, False, True)

    def test_full_scraper_cycle(self, scraper_db, admin, product_id):
        now = datetime.now(timezone.utc)
        scraper_db.insert_exchange_rate(1.37, now.replace(tzinfo=None).isoformat())
        due = {r["id"] for r in scraper_db.fetch_products_needing_update(now - timedelta(hours=23), now - timedelta(hours=24))}
        assert product_id in due
        scraper_db.insert_price_history(product_id, 11.0)
        with pytest.raises(errors.UniqueViolation):
            scraper_db.insert_price_history(product_id, 11.5)  # same UTC day
        scraper_db.update_product(product_id, {
            "usd_price": 11.0,
            "last_updated": now.isoformat(),
            "image_url": "https://example.supabase.co/storage/v1/object/public/product-images/products/1.jpg",
            "last_image_update": now.isoformat(),
        })
        due = {r["id"] for r in scraper_db.fetch_products_needing_update(now - timedelta(hours=23), now - timedelta(hours=24))}
        assert product_id not in due
        row = {"product_id": product_id, "bucket_date": now.date().isoformat(), "granularity": "day",
               "quantity_sold": 3, "transaction_count": 1, "low_sale_price": 9.0,
               "high_sale_price": 12.0, "market_price": 10.0}
        scraper_db.upsert_sales_history([row])
        scraper_db.upsert_sales_history(dict(row, quantity_sold=5))
        assert admin.execute(
            "SELECT quantity_sold FROM public.product_sales_history WHERE product_id = %s AND bucket_date = %s",
            (product_id, now.date()),
        ).fetchone()[0] == 5
        scraper_db.upsert_listings_history([{"product_id": product_id, "snapshot_date": now.date().isoformat(),
                                             "active_listings": 4, "total_quantity_available": 9,
                                             "lowest_listing_price": 10.5}])
        scraper_db.save_pending_price(product_id, 40.0, now.isoformat())
        assert [r["product_id"] for r in scraper_db.load_pending_prices()] == [product_id]
        scraper_db.clear_pending_price(product_id)
        assert scraper_db.load_pending_prices() == []

    @pytest.mark.parametrize("statement", [
        "UPDATE public.products SET url = 'https://evil.example' WHERE id = {pid}",
        "UPDATE public.products SET sku = 'x' WHERE id = {pid}",
        "INSERT INTO public.products (usd_price) VALUES (1)",
        "DELETE FROM public.products WHERE id = {pid}",
        "DELETE FROM public.product_price_history WHERE product_id = {pid}",
        "SELECT * FROM public.profiles",
        "SELECT * FROM public.portfolios",
        "SELECT * FROM public.portfolio_holdings",
        "SELECT * FROM public.box_recipes",
        "SELECT * FROM public.auth_events",
        "SELECT * FROM auth.users",
        "SELECT public.export_my_data()",
        "SELECT public.delete_my_account()",
    ])
    def test_everything_else_is_denied(self, scraper_db, product_id, statement):
        with pytest.raises(errors.InsufficientPrivilege):
            scraper_db._execute(statement.format(pid=product_id))


# ---------------------------------------------------------------- 0031 (F133)

class TestUserWriteLimits:
    def test_username_update_still_works(self, admin, user):
        as_user(admin, user)
        try:
            row = admin.execute(
                "UPDATE public.profiles SET username = 'renamed_ok' WHERE id = %s RETURNING id, username, email",
                (user,),
            ).fetchone()
            assert row[1] == "renamed_ok"
        finally:
            rollback(admin)

    @pytest.mark.parametrize("statement", [
        "UPDATE public.profiles SET email = 'victim@example.com' WHERE id = %(uid)s",
        "UPDATE public.profiles SET created_at = now() - interval '9 years' WHERE id = %(uid)s",
        "UPDATE public.profiles SET username = 'x_y_z', updated_at = now() WHERE id = %(uid)s",
        "INSERT INTO public.profiles (id, username) VALUES (%(uid)s, 'dupe_row')",
        "DELETE FROM public.profiles WHERE id = %(uid)s",
        "TRUNCATE public.profiles",
    ])
    def test_other_profile_writes_are_denied(self, admin, user, statement):
        as_user(admin, user)
        try:
            with pytest.raises(errors.InsufficientPrivilege):
                admin.execute(statement, {"uid": user})
        finally:
            rollback(admin)

    def test_oversized_packs_are_rejected(self, admin, user):
        as_user(admin, user)
        try:
            with pytest.raises(errors.CheckViolation):
                admin.execute(
                    "INSERT INTO public.box_recipes (user_id, name, retail_price, packs, is_public) "
                    "VALUES (%s, 'big', 1, jsonb_build_array(jsonb_build_object("
                    "'set_id', 1, 'quantity', 1, 'pad', repeat('x', 9000))), false)",
                    (user,),
                )
        finally:
            rollback(admin)

    def test_recipe_cap(self, admin, user):
        as_user(admin, user)
        try:
            admin.execute(
                "INSERT INTO public.box_recipes (user_id, name, retail_price, packs, is_public) "
                "SELECT %s, 'r' || g, 1, '[]'::jsonb, false FROM generate_series(1, 100) g",
                (user,),
            )
            with pytest.raises(errors.CheckViolation):
                admin.execute(
                    "INSERT INTO public.box_recipes (user_id, name, retail_price, packs, is_public) "
                    "VALUES (%s, 'one too many', 1, '[]'::jsonb, false)",
                    (user,),
                )
        finally:
            rollback(admin)

    def test_holdings_cap(self, admin, user, product_id):
        portfolio = admin.execute(
            "INSERT INTO public.portfolios (user_id) VALUES (%s) ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id RETURNING id",
            (user,),
        ).fetchone()[0]
        as_user(admin, user)
        try:
            with pytest.raises(errors.CheckViolation):
                admin.execute(
                    "INSERT INTO public.portfolio_holdings (portfolio_id, product_id, quantity, purchase_price_usd, purchase_date) "
                    "SELECT %s, %s, 1, 1, current_date FROM generate_series(1, 1001)",
                    (portfolio, product_id),
                )
        finally:
            rollback(admin)

    def test_lot_notes_length(self, admin):
        row = admin.execute(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'portfolio_lots_notes_len'"
        ).fetchone()
        assert row and "1000" in row[0]
```

**`tests/test_prune_baseline.py`** (unit, uses the real `migrations/` for names). Cases: legacy function, `products.active`, production-only constraint, index and policies are kept; migration-built functions, tables, constraints (inline CHECKs included), indexes, policies (quoted names included), ACLs and OWNER lines are dropped; commas stay valid after removing an inline CHECK; a kept trigger that calls a migration-built function is reported; `\unrestrict` is stripped even from a kept last entry; `normalize_dump` drops host noise but keeps grants to API roles and `pokefin_scraper`. Full file (5 passed):

```python
#!/usr/bin/env python3
"""
Tests for scripts/db/prune_baseline.py and scripts/db/normalize_dump.py
(audit 2026-09-25, F135). A tiny hand-written dump in pg_dump's TOC format
stands in for production; the real migrations/ directory supplies the names.

Run with: python -m pytest tests/test_prune_baseline.py -v
"""
import importlib.util
import pathlib


ROOT = pathlib.Path(__file__).resolve().parent.parent


def _load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / "db" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prune_baseline = _load("prune_baseline")
normalize_dump = _load("normalize_dump")


def entry(name, kind, body, owner="postgres"):
    return f"--\n-- Name: {name}; Type: {kind}; Schema: public; Owner: {owner}\n--\n\n{body}\n\n"


HEADER = "--\n-- PostgreSQL database dump\n--\n\n\\restrict abc\n\nSET statement_timeout = 0;\nSET check_function_bodies = false;\n\n"

DUMP = HEADER + "".join([
    entry("get_price_history_deduplicated(bigint[], text)", "FUNCTION",
          "CREATE FUNCTION public.get_price_history_deduplicated(p bigint[], r text) RETURNS integer\n"
          "    LANGUAGE sql STABLE\n    AS $$ SELECT 1 $$;\n\nALTER FUNCTION public.get_price_history_deduplicated(p bigint[], r text) OWNER TO supabase_admin;"),
    entry("delete_my_account()", "FUNCTION",
          "CREATE FUNCTION public.delete_my_account() RETURNS void\n    LANGUAGE sql\n    AS $$ SELECT 1 $$;"),
    entry("products", "TABLE",
          "CREATE TABLE public.products (\n    id bigint NOT NULL,\n    active boolean DEFAULT true NOT NULL,\n"
          "    usd_price double precision,\n    CONSTRAINT products_usd_price_sane CHECK ((usd_price < 1000000)),\n"
          "    CONSTRAINT products_legacy_check CHECK ((id > 0))\n);"),
    entry("box_recipes", "TABLE", "CREATE TABLE public.box_recipes (\n    id bigint NOT NULL\n);"),
    entry("products products_pkey", "CONSTRAINT",
          "ALTER TABLE ONLY public.products\n    ADD CONSTRAINT products_pkey PRIMARY KEY (id);"),
    entry("idx_products_legacy", "INDEX", "CREATE INDEX idx_products_legacy ON public.products USING btree (usd_price);"),
    entry("products_product_type_id_idx", "INDEX",
          "CREATE INDEX products_product_type_id_idx ON public.products USING btree (id);"),
    entry("products products_read", "POLICY",
          "CREATE POLICY products_read ON public.products FOR SELECT TO anon USING (true);"),
    entry("products \"Legacy dashboard policy\"", "POLICY",
          "CREATE POLICY \"Legacy dashboard policy\" ON public.products FOR SELECT USING (true);"),
    entry("profiles Users can view own profile", "POLICY",
          "CREATE POLICY \"Users can view own profile\" ON public.profiles FOR SELECT USING (true);"),
    entry("TABLE products", "ACL", "GRANT ALL ON TABLE public.products TO anon;"),
])


def test_prune_keeps_legacy_and_drops_what_migrations_build():
    header, kept, dropped, problems = prune_baseline.prune(DUMP)
    text = "\n".join("\n".join(lines) for lines in kept)
    assert problems == []
    assert "get_price_history_deduplicated" in text           # legacy function kept
    assert "delete_my_account" not in text                     # 0002 creates it
    assert "active boolean DEFAULT true NOT NULL" in text      # products.active kept
    assert "products_usd_price_sane" not in text               # 0030 adds it
    assert "products_legacy_check CHECK ((id > 0))" in text    # unknown constraint kept
    assert "CREATE TABLE public.box_recipes" not in text       # create_box_recipes.sql builds it
    assert "products_pkey" in text
    assert "idx_products_legacy" in text                       # production-only index kept
    assert "products_product_type_id_idx" not in text          # 0014 creates it
    assert "CREATE POLICY products_read" not in text           # 0001 creates it
    assert "Legacy dashboard policy" in text                   # production-only policy kept
    assert "Users can view own profile" not in text            # 0014 drops it by name
    assert "GRANT ALL ON TABLE" not in text                    # ACLs come from the scaffold
    assert "OWNER TO" not in text
    assert all(not line.startswith("\\restrict") for line in header)


def test_inline_constraint_removal_keeps_valid_commas():
    _, kept, _, _ = prune_baseline.prune(DUMP)
    table = next("\n".join(lines) for lines in kept if "CREATE TABLE public.products" in "\n".join(lines))
    assert "usd_price double precision,\n    CONSTRAINT products_legacy_check CHECK ((id > 0))\n);" in table


def test_trigger_on_a_migration_function_is_a_problem():
    dump = DUMP + entry("products legacy_trg", "TRIGGER",
                        "CREATE TRIGGER legacy_trg AFTER INSERT ON public.products "
                        "FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();")
    _, _, _, problems = prune_baseline.prune(dump)
    assert problems and "legacy_trg" in problems[0]


def test_restrict_lines_are_dropped_from_kept_entries():
    # pg_dump's trailer ("dump complete" plus \unrestrict) belongs to the last
    # entry; when that entry is kept, the \unrestrict line must still go.
    dump = HEADER + entry("idx_products_legacy", "INDEX",
                          "CREATE INDEX idx_products_legacy ON public.products USING btree (usd_price);") + \
        "--\n-- PostgreSQL database dump complete\n--\n\n\\unrestrict abc\n"
    header, kept, _, _ = prune_baseline.prune(dump)
    text = "\n".join(header) + "\n".join("\n".join(lines) for lines in kept)
    assert "idx_products_legacy" in text
    assert "\\unrestrict" not in text and "\\restrict" not in text


def test_normalize_drops_host_specific_lines_only():
    text = (DUMP + "GRANT ALL ON TABLE public.products TO supabase_admin;\n"
            "GRANT SELECT ON TABLE public.products TO pokefin_scraper;\n"
            "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;\n")
    out = normalize_dump.normalize(text)
    assert "\\restrict" not in out and "SET statement_timeout" not in out
    assert "OWNER TO" not in out and "Owner:" not in out
    assert "TO supabase_admin" not in out
    assert "GRANT SELECT ON TABLE public.products TO pokefin_scraper;" in out
    assert "GRANT ALL ON TABLE public.products TO anon;" in out
    assert "ALTER DEFAULT PRIVILEGES" not in out
```

## Verification

Run from the repo root in a venv with `requirements.txt` installed (plus `pytest` and `pyflakes`).

```bash
# 1. Static checks on everything this PR touches.
python -m pyflakes scraper_db.py scraper_storage.py secrets_loader.py scripts/db/*.py \
  tests/test_scraper_backends.py tests/test_db_roles_integration.py tests/test_prune_baseline.py
# expect no output
python -m pyflakes main.py generate_weekly_report.py compare_prices.py
# expect no NEW warnings compared with master (compare against `git stash; pyflakes ...; git stash pop`)
bash -n run_scraper.sh run_weekly_report.sh scripts/db/replay_migrations.sh scripts/db/schema_drift.sh
grep -n "load_supabase" compare_prices.py generate_weekly_report.py
# expect only load_supabase_readonly_credentials: 2 lines in each file
python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/ci.yml')); print([j['name'] for j in d['jobs'].values()])"
# expect the four existing names plus 'Database replay and Python tests'
pip-audit --requirement requirements.txt --strict      # expect no findings

# 2. Unit tests (no database).
python -m pytest tests/ -q
# expect all pass; tests/test_db_roles_integration.py shows as 26 skipped

# 3. Migration verifier outputs (steps 2 and 3).
python3 verify_migration.py migrations/0031_user_table_write_limits.sql > /dev/null; echo "exit=$?"   # exit=1, one REFUSED line
python3 verify_migration.py migrations/0032_scraper_least_privilege_role.sql > /dev/null; echo "exit=$?"  # exit=1, two REFUSED lines
python3 verify_migration.py migrations/0003_integrity_constraints.sql > /dev/null; echo "exit=$?"
# same exit code and verified lines as on master; NOT VERIFIED now reads "1 x ALTER TABLE ..., 8 x DO block"

# 4. Replay, drift and DB tests (phase B). Step 19 stopped (and, with --rm,
#    removed) the server; start it again first with the same docker run and
#    pg_isready loop as step 19.
PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh
docker exec pokefin-replay pg_dump -U postgres --schema-only --schema=public replay_once | scripts/db/schema_drift.sh
POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once python -m pytest tests/ -q

# 5. The replay really catches a non-idempotent file: swap in master's 0003, rerun, restore.
cp migrations/0003_integrity_constraints.sql /tmp/0003_new.sql
git show master:migrations/0003_integrity_constraints.sql > migrations/0003_integrity_constraints.sql
PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh
# expect failure right after "== 0003_integrity_constraints.sql" with
# 'constraint "portfolio_holdings_quantity_sane" for relation "portfolio_holdings" already exists'
cp /tmp/0003_new.sql migrations/0003_integrity_constraints.sql
git diff --stat master -- migrations/0003_integrity_constraints.sql   # the WP21 change is back
docker stop pokefin-replay

# 6. No em dashes and no secrets in new files.
grep -rn $'\xe2\x80\x94' migrations/0031_*.sql migrations/0032_*.sql scripts/db scraper_db.py scraper_storage.py tests/test_scraper_backends.py tests/test_db_roles_integration.py tests/test_prune_baseline.py
# expect no output
git status --porcelain | grep db-dumps     # expect no output
```

The frontend is untouched, so no `pnpm` command is needed beyond confirming that: `git diff --stat master -- frontend/` lists at most the one comment line from step 1.

Manual checks after the owner applies 0031 (they are also in Owner actions):

1. On https://pokefin.ca, signed in: `/account`, change the username and change it back. Both show "Username updated successfully!".
2. Save a box recipe and delete it; add a holding and delete it. Both work.
3. On `/account`, the data export (WP01's fixed `export_my_data`) still downloads a JSON file whose profile block shows your email. It runs as SECURITY DEFINER, so the new grants do not affect it; this proves it.

## Owner actions

**A. Mid-PR, after the executor's phase A (about 45 minutes). Needs psql, and a pg_dump of the SAME major version as production** (A1 prints it). The simplest way is Docker: `docker run --rm -it postgres:17 psql ...` and `docker run --rm postgres:17 pg_dump ...` (replace 17 with production's major). A newer pg_dump (for example Homebrew's latest `libpq`) writes syntax the replay server may reject and adds drift noise; an older one refuses to dump. Get the **Session pooler** connection string from Dashboard > Connect (host like `aws-0-<region>.pooler.supabase.com`, port 5432, user `postgres.<project-ref>`); use it as `$PGURL` with `?sslmode=require` appended.

A1. **Pre-checks** (SQL editor or `psql "$PGURL"`):

```sql
SELECT current_setting('server_version') AS server_version,
       to_regclass('public.product_price_pending') AS pending_table_0030,
       to_regclass('public.product_price_history_backup_20260128') AS backup_table,
       to_regprocedure('public.handle_new_profile_portfolio()') AS legacy_trigger_fn,
       to_regprocedure('public.get_price_history_deduplicated(bigint[], text)') AS legacy_history_fn;

SELECT
  (SELECT count(*) FROM public.box_recipes WHERE octet_length(packs::text) > 8192) AS big_packs,
  (SELECT count(*) FROM public.portfolio_lots WHERE notes IS NOT NULL AND char_length(notes) > 1000) AS long_lot_notes,
  (SELECT count(*) FROM public.portfolios WHERE char_length(name) NOT BETWEEN 1 AND 200) AS bad_portfolio_names;

SELECT 'box_recipes' AS tbl, user_id::text AS owner, count(*) FROM public.box_recipes GROUP BY user_id HAVING count(*) > 100
UNION ALL
SELECT 'portfolio_holdings', portfolio_id::text, count(*) FROM public.portfolio_holdings GROUP BY portfolio_id HAVING count(*) > 1000
UNION ALL
SELECT 'portfolio_lots', holding_id::text, count(*) FROM public.portfolio_lots GROUP BY holding_id HAVING count(*) > 1000;

SELECT id, public FROM storage.buckets ORDER BY id;
SELECT rolname FROM pg_roles WHERE rolname = 'pokefin_scraper';

SELECT table_name, is_identity, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND column_name = 'id'
   AND table_name IN ('exchange_rates', 'product_price_history',
                      'product_sales_history', 'product_listings_history')
 ORDER BY 1;
```

Correct: the last query returns 4 rows, all `is_identity = YES`. If any row says `NO` with a `column_default` like `nextval('public.<name>_id_seq'::regclass)`, stop before A2 and send the rows to the executor, who adds one line per such table to 0032, directly below the table GRANTs: `GRANT USAGE ON SEQUENCE public.<name>_id_seq TO pokefin_scraper;` (the name inside `nextval(...)`), pushes, and tells you to continue. Without it every scraper INSERT on that table fails with `permission denied for sequence`. `pending_table_0030` is not NULL (else apply WP16's 0030 first); tell the executor the server major version and which of `backup_table`, `legacy_trigger_fn`, `legacy_history_fn` are NULL (NULL means step 19's stand-in applies). The three counts are 0 (if not, fix or delete those rows first, or 0031 fails and changes nothing). The cap query returns no rows (rows mean those owners simply cannot add more; not a blocker). Note every bucket: a Storage S3 key can read and write all of them, so if a private bucket with user files exists, tell the executor and decide whether to stay on `POKEFIN_STORAGE_BACKEND=supabase` (the database cut-over still removes most of the risk). `pokefin_scraper` must not exist yet.

A2. **Apply 0031.** Preferred: Supabase MCP `apply_migration`, name `0031_user_table_write_limits`, the full file. Alternative: SQL editor, paste the whole file, nothing selected, Run. Verify:

```sql
SELECT has_column_privilege('authenticated','public.profiles','username','UPDATE')   AS username_update,  -- true
       has_column_privilege('authenticated','public.profiles','email','UPDATE')      AS email_update,     -- false
       has_column_privilege('authenticated','public.profiles','created_at','UPDATE') AS created_update,   -- false
       has_column_privilege('authenticated','public.profiles','updated_at','UPDATE') AS updated_update,   -- false
       has_table_privilege('authenticated','public.profiles','INSERT')               AS profile_insert,   -- false
       has_table_privilege('authenticated','public.profiles','DELETE')               AS profile_delete,   -- false
       has_table_privilege('authenticated','public.profiles','TRUNCATE')             AS profile_truncate, -- false
       has_table_privilege('authenticated','public.profiles','SELECT')               AS profile_select;   -- true
SELECT conname FROM pg_constraint
 WHERE conname IN ('box_recipes_packs_size','portfolio_lots_notes_len','portfolios_name_len');  -- 3 rows
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname LIKE '%_row_cap_trg';                      -- 3 rows, 'O'
```

Then run `python3 verify_migration.py migrations/0031_user_table_write_limits.sql` locally (it exits 1 with one REFUSED line; expected), paste the printed SQL, Run: 10 rows, all `OK`. Then the manual checks from Verification (username change on `/account`, save/delete a recipe, add/delete a holding, data export). If the username change fails with "permission denied", roll back 0031 (Rollback section) and tell the executor.

A3. **Apply 0032** the same way (MCP name `0032_scraper_least_privilege_role`). Verify:

```sql
SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit, rolconnlimit, rolconfig
  FROM pg_roles WHERE rolname = 'pokefin_scraper';
-- t, f, f, f, f, f, 5, {statement_timeout=60s,idle_in_transaction_session_timeout=60s}

SELECT c.relname,
       has_table_privilege('pokefin_scraper', c.oid, 'SELECT') AS sel,
       has_table_privilege('pokefin_scraper', c.oid, 'INSERT') AS ins,
       has_table_privilege('pokefin_scraper', c.oid, 'UPDATE') AS upd,
       has_table_privilege('pokefin_scraper', c.oid, 'DELETE') AS del
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')
   AND (has_table_privilege('pokefin_scraper', c.oid, 'SELECT')
     OR has_table_privilege('pokefin_scraper', c.oid, 'INSERT')
     OR has_table_privilege('pokefin_scraper', c.oid, 'UPDATE')
     OR has_table_privilege('pokefin_scraper', c.oid, 'DELETE'))
 ORDER BY 1;
-- exactly 6 rows: exchange_rates (t,t,f,f), product_listings_history (t,t,t,f),
-- product_price_history (t,t,f,f), product_price_pending (t,t,t,t),
-- product_sales_history (t,t,t,f), products (t,f,f,f)

SELECT has_column_privilege('pokefin_scraper','public.products','usd_price','UPDATE') AS price_upd,  -- true
       has_column_privilege('pokefin_scraper','public.products','url','UPDATE')       AS url_upd,    -- false
       has_schema_privilege('pokefin_scraper','auth','USAGE')                        AS auth_schema, -- false
       has_schema_privilege('pokefin_scraper','storage','USAGE')                     AS storage_schema; -- false
SELECT tablename, policyname FROM pg_policies WHERE 'pokefin_scraper' = ANY (roles) ORDER BY 1;  -- 6 rows
SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND has_function_privilege('pokefin_scraper', p.oid, 'EXECUTE');
-- expect at most get_price_history_deduplicated(bigint[],text) (reads public price
-- history). Any other row is a SECURITY DEFINER function that PUBLIC (and so
-- anon) can execute: 0032 did not cause it and it does not block this package.
-- Send the list to the executor, who records it in the PR as a follow-up. Stop
-- only if one of them writes profiles, portfolios, portfolio_holdings,
-- portfolio_lots, box_recipes or auth.users.
```

If `auth_schema` or `storage_schema` prints `true`, PUBLIC holds USAGE on that schema in this project; the scraper still cannot read any table there without a table grant (A4 proves it for `public.profiles`). Note it for the executor; it is not a blocker.

The Security Advisor may now list the six `*_scraper` policies under "RLS policy always true" (or a similarly named permissive-policy lint). That is expected: those policies apply to `pokefin_scraper` only, and its GRANTs, not the policies, limit what it can do. Do not add conditions to them.

Then `python3 verify_migration.py migrations/0032_scraper_least_privilege_role.sql` (exits 1 with two REFUSED lines; expected), paste, Run: 17 rows, all `OK`. If the executor added sequence GRANTs after A1, the verifier prints one extra "REFUSED unparsed privilege statement" line per GRANT (it does not parse sequence grants); check each with `SELECT has_sequence_privilege('pokefin_scraper', 'public.<name>_id_seq', 'USAGE');` (expect `true`).

A4. **Set the role password** (never in the SQL editor). Generate one: `openssl rand -hex 24`. Store it in your password manager. Then:

```bash
psql "$PGURL" -c '\password pokefin_scraper'     # paste the password twice
# test the login through the pooler: user is pokefin_scraper.<project-ref>
psql "postgresql://pokefin_scraper.<project-ref>@<pooler host>:5432/postgres?sslmode=require" \
  -c "select current_user, count(*) from public.products" \
  -c "select count(*) from public.profiles"
```

Correct: the first query prints `pokefin_scraper` and the product count; the second fails with `permission denied for table profiles`. If the login itself is refused, check the user name format (`pokefin_scraper.<project-ref>`) and that you used the session pooler host, port 5432.

A5. **Dump the schema for the executor** (schema only, no data):

```bash
mkdir -p db-dumps
# Same major as production (A1). With Docker:
docker run --rm postgres:17 pg_dump --schema-only --schema=public "$PGURL" > db-dumps/prod_schema_public.sql
# or, if your local pg_dump --version shows the same major:
#   pg_dump --schema-only --schema=public "$PGURL" > db-dumps/prod_schema_public.sql
head -8 db-dumps/prod_schema_public.sql   # "Dumped from database version 17.x" and "Dumped by pg_dump version 17.x"
grep -c "Type: TABLE;" db-dumps/prod_schema_public.sql       # 15 or more
grep -n -i "password\|secret" db-dumps/prod_schema_public.sql # review every hit; expect none outside comments
```

Put the file at `db-dumps/prod_schema_public.sql` in the executor's working tree (it is gitignored), tell the executor the dump date, the server major version, the A1 NULL answers, and the date you applied 0031 and 0032. Do not edit `audits/HARDENING_FOLLOWUPS.md` yourself: the executor records the apply date in the WP21 bullet in step 20, so the PR carries it without a merge conflict.

**B. After the PR merges: cut the scraper over, one stage at a time.** On every host that runs the scraper or the report (the Linux scraper host and the macOS laptop): `git pull && venv/bin/pip install -r requirements.txt`.

B1. **Database.** Add to `~/.config/pokefin/env`:

```text
POKEFIN_DB_BACKEND=postgres
POKEFIN_SCRAPER_DATABASE_URL=postgresql://pokefin_scraper.<project-ref>:<password>@<pooler host>:5432/postgres?sslmode=require
```

Run `./run_scraper.sh` once by hand. Correct: `scraper.log` shows "Scraper backends: database=postgres storage=supabase", the usual per-product lines, "Done! N products updated", and no "permission denied" or "row-level security" errors. In SQL, `SELECT max(recorded_at) FROM public.product_price_history;` is from this run. Rollback: delete the two lines.

B2. **Storage.** Dashboard > Storage > S3 Configuration: make sure "S3 connection" is enabled, note the Endpoint and Region, and create a new access key named `pokefin-scraper` (the secret is shown once; store it). Add to the env file:

```text
POKEFIN_STORAGE_BACKEND=s3
SUPABASE_S3_ENDPOINT=<endpoint shown on that page>
SUPABASE_S3_REGION=<region shown on that page>
SUPABASE_S3_ACCESS_KEY_ID=<access key id>
SUPABASE_S3_SECRET_ACCESS_KEY=<secret access key>
```

Test one upload without waiting for an image refresh:

```bash
set -a; . ~/.config/pokefin/env; set +a
venv/bin/python - <<'PY'
import requests, main
row = requests.get(f"{main.SUPABASE_URL}/rest/v1/products?select=id,image_url&image_url=like.*product-images*&limit=1",
                   headers={"apikey": "<your sb_publishable_ key>"}, timeout=30).json()[0]
img = requests.get(row["image_url"], timeout=30).content
print("thumbnail stored:", main.upload_thumbnail(row["id"], image_bytes=img))
PY
```

Correct: "Scraper backends: database=postgres storage=s3" and "thumbnail stored: True"; the product's thumbnail still loads on the site. Rollback: set `POKEFIN_STORAGE_BACKEND=supabase`.

B3. **Weekly report.** On every host that runs `run_weekly_report.sh` (the macOS laptop, and the Linux scraper host if its cron runs the report), create `~/.config/pokefin/report.env` (chmod 600) with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY=sb_publishable_...` (Dashboard > Settings > API Keys, or the value of `NEXT_PUBLIC_SUPABASE_KEY` in Vercel), and every `SMTP_*` and `REPORT_EMAIL_*` line, then remove those `SMTP_*`/`REPORT_EMAIL_*` lines from `~/.config/pokefin/env`. Run `./run_weekly_report.sh`. Correct: `reports/weekly_report.log` shows "OK -> pokefin_weekly_<date>.pdf", and no "SUPABASE_PUBLISHABLE_KEY is not set" or "using ... which holds the scraper's credentials" warning.

B4. **Remove the secret key from every host.** Delete `SUPABASE_SERVICE_ROLE_KEY` from `~/.config/pokefin/env` on every machine, and blank `SUPABASE_KEY` in any `secretsFile.py`. Confirm: `grep -rn "sb_secret_" ~/.config/pokefin/ ~/pokefin/secretsFile.py ~/repos/Pokefin/secretsFile.py 2>/dev/null` prints nothing. Run `./run_scraper.sh` once more: it must complete exactly as in B1 (a `RuntimeError` about missing credentials means a flag is still `supabase`).

B5. **Rotate.** Dashboard > Settings > API Keys > Secret keys: create a new secret key named `admin-manual` and keep it only in your password manager (for backfills and one-off admin, README "One-time backfills"); then delete the key the scraper used. Confirm the old key is dead:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://<ref>.supabase.co/rest/v1/products?select=id&limit=1" \
  -H "apikey: <old sb_secret_ key>"
# expect 401
```

The website is unaffected (it uses only the publishable key; `HARDENING_FOLLOWUPS.md:88`). While there, confirm Settings > JWT Keys shows the old HS256 key as revoked (its 30-day standby window from 2026-05-27 has long passed); revoke it if not.

B6. **CI.** Settings > Branches > master > branch protection: add "Database replay and Python tests" to the required status checks. Confirm on the next PR that the check appears and is required.

B7. Update the WP21 bullet in `audits/HARDENING_FOLLOWUPS.md` section 7 with the dates of B1 to B5 and "Status: done".

**C. After every future migration** is applied to production: refresh `schema.sql` (README, "Database"), so the drift step in CI reads clean again.

## Acceptance criteria

- [ ] `migrations/0031_user_table_write_limits.sql` and `migrations/0032_scraper_least_privilege_role.sql` exist with the content in steps 2 and 3, apply twice in a row without error, and `verify_migration.py` exits 1 with only the documented REFUSED lines.
- [ ] `migrations/0003_integrity_constraints.sql` applies twice in a row without error; no other applied migration changed (`git diff --stat master -- migrations/` lists only 0003, 0000, 0031, 0032 and any documented `NNNN_record_*` file).
- [ ] `.github/copilot-instructions.md` (WP20's rewrite) describes the baseline/replay harness and the scraper backend flags (step 15f), or the PR body says why 15f was skipped.
- [ ] `migrations/0000_baseline.sql` is generated by `scripts/db/prune_baseline.py` from the owner's dump, starts with the empty-database guard, contains `products.active` and the two legacy functions, and contains no GRANT, no OWNER TO, and no object a migration creates.
- [ ] `schema.sql` is the normalised production dump with the generated header and contains `active boolean`, `is_public`, `client_idempotency_key` and `CREATE TABLE public.auth_events`.
- [ ] `scripts/db/replay_migrations.sh` prints "OK: N files replayed once ... and twice" on an empty local Postgres of production's major version, and `schema_drift.sh` prints "No drift" (or every remaining hunk is reconciled by a documented migration).
- [ ] `python -m pytest tests/ -q` passes with no database (26 skipped) and with `POKEFIN_TEST_DATABASE_URL` pointing at `replay_once` (0 skipped from the new files).
- [ ] With neither flag set, `main.py` behaves exactly as before: existing tests pass unchanged and the log line reads "database=supabase storage=supabase".
- [ ] `generate_weekly_report.py` and `run_weekly_report.sh` read `SUPABASE_PUBLISHABLE_KEY` from `report.env`, and `compare_prices.py` uses `load_supabase_readonly_credentials()`.
- [ ] After 0031, `authenticated` holds exactly SELECT plus UPDATE (username) on `profiles` (A2 query: every column as commented).
- [ ] CI has a fifth job "Database replay and Python tests" that is green on the PR; the four existing job names are unchanged.
- [ ] README and HARDENING_FOLLOWUPS describe the flags, the baseline, the replay and the owner cut-over; the "idempotent and safe to re-run" claim is corrected.
- [ ] (Owner) After B4, no host holds an `sb_secret_` value and the scraper and report complete; after B5 the old key answers 401.

## Rollback

- **Code**: revert the PR commit. With the flags unset nothing changes at runtime; if the owner already cut over (B1 to B4), first put `SUPABASE_SERVICE_ROLE_KEY` back in the env file (the `admin-manual` key from B5, or a new secret key) and remove the `POKEFIN_*_BACKEND` lines, then revert. `0000_baseline.sql`, `schema.sql`, the scripts and the CI job have no production effect.
- **Migration 0031** (run in the SQL editor):

```sql
DROP TRIGGER IF EXISTS box_recipes_row_cap_trg ON public.box_recipes;
DROP TRIGGER IF EXISTS portfolio_holdings_row_cap_trg ON public.portfolio_holdings;
DROP TRIGGER IF EXISTS portfolio_lots_row_cap_trg ON public.portfolio_lots;
DROP FUNCTION IF EXISTS public.enforce_owner_row_cap();
ALTER TABLE public.box_recipes    DROP CONSTRAINT IF EXISTS box_recipes_packs_size;
ALTER TABLE public.portfolio_lots DROP CONSTRAINT IF EXISTS portfolio_lots_notes_len;
ALTER TABLE public.portfolios     DROP CONSTRAINT IF EXISTS portfolios_name_len;
GRANT INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
-- TRUNCATE, REFERENCES and TRIGGER are deliberately not restored: nothing
-- in the app used them.
```

- **Migration 0032** (only after the scraper is back on the service key):

```sql
DROP POLICY IF EXISTS products_scraper                 ON public.products;
DROP POLICY IF EXISTS product_price_history_scraper    ON public.product_price_history;
DROP POLICY IF EXISTS product_sales_history_scraper    ON public.product_sales_history;
DROP POLICY IF EXISTS product_listings_history_scraper ON public.product_listings_history;
DROP POLICY IF EXISTS exchange_rates_scraper           ON public.exchange_rates;
DROP POLICY IF EXISTS product_price_pending_scraper    ON public.product_price_pending;
DROP OWNED BY pokefin_scraper;
DROP ROLE IF EXISTS pokefin_scraper;
```

- **Storage key**: Dashboard > Storage > S3 Configuration: delete the `pokefin-scraper` access key.
- **0003 change**: nothing to roll back in production (the constraint definitions are identical and the file is never re-applied there).
- Record any rollback in `audits/HARDENING_FOLLOWUPS.md` section 7.

## Commit and PR

Commit message:

```text
feat(db): least-privilege scraper role, user write limits, schema baseline (WP21)

- 0031: profiles writable only in username (no insert, delete or truncate);
  packs/notes/name size limits;
  per-owner row caps (100 recipes, 1000 holdings, 1000 lots) (F133)
- 0032: pokefin_scraper login role, NOBYPASSRLS, grants and RLS policies on
  the six tables the scraper writes (F081)
- main.py: POKEFIN_DB_BACKEND=postgres (psycopg via Supavisor) and
  POKEFIN_STORAGE_BACKEND=s3 (Storage S3 key); defaults unchanged
- weekly report and compare_prices.py read with the publishable key (F085)
- 0000_baseline.sql from a production dump, schema.sql regenerated,
  0003 made re-runnable, scripts/db replay harness, CI job replays the
  chain twice and diffs it against schema.sql (F135)
```

PR title: `WP21: least-privilege scraper role, user write limits, reproducible schema`

PR body summary: link this spec; list F081 (with F085), F133, F135; state in bold that **migrations 0031 and 0032 were applied by the owner during review (Owner action A)** and paste A2/A3 verification results; list the plan corrections (column REVOKE is a no-op without a table-level REVOKE; `box_recipes.name` was already capped; storage needs an S3 key; the report and `compare_prices.py` use the publishable key instead of a new role; plain `pg_dump` instead of `supabase db dump`; no column grants for `created_at` on the other user tables; header verification queries are not run in CI); paste the Verification outputs (pytest summaries with and without the database, replay summary line, drift line, verifier exit codes); list Owner actions B1 to B7 as a checklist; list follow-ups outside scope: `backfill_*.py` and `generate_skus.py` still use the service key by design (admin tools that write); a Storage S3 key reaches every bucket (see A1's bucket list); the WP05/WP06 route messages for SQLSTATE 23514 do not say "limit reached" when a row cap is hit; `created_at` on `portfolios`, `portfolio_holdings` and `box_recipes` stays writable by the row's owner (plan correction 6); `authenticated` still holds Supabase's default TRUNCATE on the other four user tables (not reachable through PostgREST); and any SECURITY DEFINER function the owner's A3 query listed as executable by PUBLIC.
