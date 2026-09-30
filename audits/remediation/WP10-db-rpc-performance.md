# WP10: Database: bounded market RPCs and portfolio history RPC

- **Findings covered**
  - F142 (full, cluster members F142, F080): `get_market_product_metrics()` materialises every `product_price_history` row ever written into an unindexed CTE and runs six correlated "latest row on or before day N" subqueries per active product against it; it runs twice per revalidation (once under `get_market_product_summaries`, once under `get_set_analytics`) and is callable by anon. Production: mean 734-903 ms per summaries call, about ten 3 s statement timeouts (HTTP 500s) per day. This package implements the verifier correction's first sentence (bound `daily_history` to 366 days, LATERAL index reads for the anchors). F080's anon-amplification concern is addressed by that bound: each anonymous call becomes a bounded, index-driven read instead of a whole-history scan. The correction's "longer term" metrics table and F080's anon revoke are not in any package of this plan; step 10c records them as an open follow-up in `audits/HARDENING_FOLLOWUPS.md`. The "hundreds of server calls per hour" part is F143 (WP11).
  - F148 (full): `get_market_product_volume_metrics()` computes `day_freshness` over the whole `product_sales_history` table with no date bound and no index matching its predicates.
  - F145 (full): `getPortfolioHistory` pages every daily price row for every held product to the browser (up to 300 serial 1000-row pages) to compute one value per day.
- **Priority rationale**: the metrics RPC is behind every catalog page and already times out in production; this is the cheapest change that removes the timeouts before WP11 changes caching.
- **Effort**: M (6 to 8 hours: 3 migrations and a check script, one route, repo/client additions, 4 new and 2 updated Jest files plus one pytest file, docs).
- **Depends on**: WP01 (migrations 0024/0025, including `portfolio_holdings_portfolio_id_idx`), WP05 (`/api/portfolio` routes, `lib/server/portfolioRepo.ts`, `lib/portfolioApi.ts`, `lib/portfolioInput.ts`, the rewritten `usePortfolioData.ts`). WP06 is not a dependency, but it claims migration number 0026 (see "Before you start" for numbering).
- **Unblocks**: WP11 (caching and revalidation build on the bounded RPCs), WP20 (its generated `Database` types must contain `get_portfolio_history` and the new `get_market_product_metrics`, so 0027-0029 must be applied before WP20 starts), WP21 (database hardening and least-privilege role).
- **Parallel execution**: this package does not depend on WP06 to WP09 and shares no source file with them except `app/lib/portfolioInput.ts` (WP07 edits `PRICE_MESSAGE`, this package adds the `days` parser; different lines) and the docs (`README.md`, `audits/HARDENING_FOLLOWUPS.md`). It may run in parallel with WP06 to WP09 once WP05 has merged; it must merge, with 0027-0029 applied, before WP11 starts. Keep the reserved numbers 0027-0029 whichever order the PRs merge in.
- **Suggested branch name**: `remediation/wp10-db-rpc-performance`
- **Risk level**: medium. It replaces the SQL behind every catalog page; the risk is contained by an exact old-versus-new equivalence proof (script provided) and by leaving the return shape, ACL and the 0023 freshness gates untouched.

## Why

Every catalog page (`/`, `/prices`, `/market`, `/stats`) and the `/compare`, `/box-calculator` and `/portfolio` tools depend on `get_market_product_metrics()`. Today it rebuilds a per-day history for every product from the whole price-history table and then scans that unindexed result about 1,800 times, so each call costs close to a second in production and sometimes exceeds the 3 s anonymous timeout, which users see as empty or failed market data. The same function runs twice per revalidation, and anyone with the public key can trigger it. After this PR the six lookback prices are single index probes and the history scan is bounded to one year: on a 306-product, 66k-row replica the metrics went from 17 s to 150 ms with byte-identical output for every product. Separately, the portfolio chart stops downloading thousands of price rows to the browser: one authenticated request returns the `days + 1` points, computed in the database under RLS. The volume RPC's freshness read gets a 63-day bound and a partial index so it stays cheap as history grows.

## Before you start

Read these first, fully:

- `migrations/20260506_market_performance_functions.sql` (the current `get_market_product_metrics`, lines 14-197; `daily_history` at :38-46, the six correlated anchors at :47-99)
- `migrations/0023_price_freshness_guard.sql` (why returns are gated at :39-48; the price-history index at :125-134; `get_market_product_summaries` gate at :199-243 and its call of the metrics at :248; `get_set_analytics` call at :354 and gate at :305-316, :332-334). You will NOT edit these functions; you must understand that they consume the metrics unchanged.
- `migrations/0022_listings_freshness_guard.sql` (the current `get_market_product_volume_metrics`; `day_freshness` at :57-64, `latest_listings` at :141-151, the "listings_snapshot_date is left populated" contract at :179-190)
- `migrations/0015_product_sales_and_listings_history.sql:32-95` (sales table, its only indexes)
- `migrations/0009_db_resource_guards.sql:22-39` (anon 3 s / authenticated 8 s timeouts, search_path pins)
- `migrations/0014_rls_perf_and_dedupe.sql:60-74` (`holdings_self` RLS policy that keeps the new portfolio RPC safe)
- `verify_migration.py:1-240` (module docstring: what it compares and what it refuses) and `README.md:278-460` (migration rules, apply order)
- Post-WP05 code: `frontend/app/lib/portfolio.ts` (the `fetchPortfolioPriceHistory` / `getPortfolioHistory` pair; pre-WP05 they are at :436-497 and :584-738), `frontend/app/lib/server/portfolioRepo.ts`, `frontend/app/lib/portfolioApi.ts`, `frontend/app/lib/portfolioInput.ts`, `frontend/app/api/portfolio/route.ts`, `frontend/app/components/Portfolio/hooks/usePortfolioData.ts`, `frontend/app/lib/csrf.ts`
- `frontend/app/lib/__tests__/portfolio.freshness.test.ts` (the history tests you will retarget)
- `audits/remediation/WP05-portfolio-api.md` steps 6-10 and 12 (the shapes this package extends)

Confirm the starting state (repo root):

```bash
# 1. The bugs still exist
grep -n "recorded_at >=" migrations/20260506_market_performance_functions.sql      # expect no output: daily_history is unbounded
grep -c "FROM daily_history dh" migrations/20260506_market_performance_functions.sql  # expect 10 (6 anchors + 4 window CTEs)
grep -rn "CREATE OR REPLACE FUNCTION public.get_market_product_metrics" migrations/  # expect only 20260506
grep -rln "get_market_product_volume_metrics()" migrations/ | sort                  # 0022 must be the highest-numbered file that defines it
grep -rn "get_portfolio_history" migrations/ frontend/app                          # expect no output
grep -n "PRICE_HISTORY_MAX_PAGES" frontend/app/lib/portfolio.ts                     # expect the paging constant

# 2. WP05 has landed (names this spec builds on)
ls frontend/app/api/portfolio                                  # route.ts holdings import (and __tests__)
grep -n "export async function findPortfolioId" frontend/app/lib/server/portfolioRepo.ts
grep -n "export class PortfolioApiError\|async function readErrorMessage" frontend/app/lib/portfolioApi.ts
grep -n "export type Parsed" frontend/app/lib/portfolioInput.ts
grep -n "getPortfolioHistory(portfolioId, TIMEFRAME_DAYS\[timeframe\], holdings, controller.signal)" \
  frontend/app/components/Portfolio/hooks/usePortfolioData.ts
grep -n "rejectIfNotAppRequest\|export function reject" frontend/app/lib/csrf.ts
grep -n "export async function requireRouteUser\|export function jsonNoStore" frontend/app/lib/routeAuth.ts   # expect 2 lines
grep -n "requireRouteUser\|jsonNoStore" frontend/app/api/portfolio/route.ts                                    # the pattern step 7 copies

# 3. Free migration numbers
ls migrations | sort
```

Assumptions to check, and what to do if one fails:

- **Migration numbers.** `0027`, `0028` and `0029` are reserved for this package in the plan-wide numbering (WP01 `0024`/`0025`, WP06 `0026`, WP10 `0027`-`0029`, WP16 `0030`, WP21 `0031`/`0032` plus `0000_baseline.sql`). Use them even if `0026` (WP06) or `0030` (WP16) is not in `migrations/` yet, or is already there: those packages can merge before or after this one. Do NOT derive the numbers from the highest file present. Only if a file named `0027_*`, `0028_*` or `0029_*` already exists and is not one of this package's files, stop and ask the owner which numbers to use; then substitute them everywhere this spec says 0027/0028/0029, including the comments inside the SQL files, the check script header, the README and HARDENING_FOLLOWUPS text, and tell WP16 and WP21 in the PR body.
- **WP05 missing.** If `findPortfolioId`, `PortfolioApiError`, `Parsed`, `requireRouteUser`/`jsonNoStore` (`app/lib/routeAuth.ts`) or the WP05 hook call are absent, stop: this package extends WP05's files and must not recreate them. The migrations (steps 1-4) and the Python test (step 11) do not depend on WP05 and may be done first.
- **The GET gate helper.** WP05 step 6 adds `rejectIfNotAppRequest` to `csrf.ts` unless WP04 already added an equivalent. Use whatever name `frontend/app/api/portfolio/route.ts` imports for its GET gate.
- **The price-history index.** The new anchors depend on an index on `product_price_history (product_id, recorded_at DESC)`. `0023:133-134` creates `idx_price_history_product_recorded`; production also carries an equivalent under another name. The owner confirms it in Owner actions step 2.
- **verify_migration.py needs no change.** The plan asked to "update verify_migration.py for changed functions". It is fully generic: it derives every expectation from the file passed on the command line and hard-codes no function name (`grep -n "market\|portfolio" verify_migration.py` finds only docstring mentions). Running it on the new files is the update. The one construct it refuses, a partial index whose predicate compares against a literal (`verify_migration.py:185`), is why the index lives in its own file (step 1) and is checked with a catalog query instead. Do not edit `verify_migration.py`.
- **Local Postgres.** `psql` and PostgreSQL 16 binaries exist on the dev container (`/usr/lib/postgresql/16/bin`). They are optional; the Verification section has a local equivalence proof if you want it.

## Implementation steps

Steps 1-4 (SQL) and step 11 (Python test) are independent of the TypeScript steps 5-10. Do step 1 before step 2 (0028's comments reference 0027). Do step 3 after step 2 (the script is generated from 0028).

### Step 1. `migrations/0027_sales_history_day_fresh_index.sql` (new, F148)

Why: `day_freshness` filters `granularity = 'day' AND quantity_sold IS NOT NULL`, which no index covers (`0015:94-95`). With this partial index and the 63-day bound from step 2, the read becomes an index-only scan per product (measured: 18 ms sequential scan to 8 ms index-only scan on 143k rows; the gap widens every day). It is a separate file because `verify_migration.py` refuses this index shape (it would drop the whole function file's exit code to 1).

Exact content:

```sql
-- Migration: Partial index for the volume RPC's freshness read (review
-- finding F148).
--
-- get_market_product_volume_metrics computes day_freshness as
-- max(bucket_date) over product_sales_history rows with granularity = 'day'
-- and a non-NULL quantity_sold. Neither column is in any index (0015 has only
-- UNIQUE (product_id, bucket_date, granularity) and
-- (product_id, bucket_date DESC)), so the read was a sequential scan plus hash
-- aggregate over every daily and weekly bucket ever written. 0028 bounds it to
-- the last 63 days; this index makes that an index-only scan per product.
--
-- Kept in its own file because verify_migration.py refuses a partial index
-- whose predicate compares against a literal (Postgres renders it back as
-- 'day'::text, which the file does not carry). The function file 0028 then
-- verifies cleanly with exit 0. Check this one with the query below instead.
--
-- Plain CREATE INDEX, not CONCURRENTLY: apply_migration runs inside a
-- transaction, where CONCURRENTLY is not allowed. It holds a SHARE lock on
-- product_sales_history (reads continue, scraper writes wait) for the build,
-- well under a second at the table's size in 2026. Do not apply it while the
-- scraper is writing.
--
-- Idempotent.
--
-- Verification (expect exactly one row, valid = true, and this definition):
--   SELECT c.relname, pg_get_indexdef(i.indexrelid) AS def,
--          i.indisvalid AS valid
--     FROM pg_index i
--     JOIN pg_class c ON c.oid = i.indexrelid
--    WHERE i.indrelid = 'public.product_sales_history'::regclass
--      AND c.relname = 'product_sales_history_day_fresh_idx';
--   -- def = CREATE INDEX product_sales_history_day_fresh_idx ON
--   --   public.product_sales_history USING btree (product_id, bucket_date DESC)
--   --   WHERE ((granularity = 'day'::text) AND (quantity_sold IS NOT NULL))

CREATE INDEX IF NOT EXISTS product_sales_history_day_fresh_idx
  ON public.product_sales_history (product_id, bucket_date DESC)
  WHERE granularity = 'day' AND quantity_sold IS NOT NULL;
```

### Step 2. `migrations/0028_bounded_market_metrics.sql` (new, F142 and F148)

What changes versus the live definitions, and nothing else:

- `get_market_product_metrics`: (a) `daily_history` gains `WHERE h.recorded_at >= current_date - 366`; (b) the six correlated `(SELECT dh.usd_price FROM daily_history dh WHERE dh.product_id = ap.id AND dh.day <= current_date - N ORDER BY dh.day DESC LIMIT 1)` subqueries (`20260506:51-98`) become six `LEFT JOIN LATERAL` probes on `product_price_history` with `recorded_at < current_date - (N - 1)`. Everything from `changes_90` to the final `SELECT` is `20260506:101-196` verbatim. Same `RETURNS TABLE`, so `CREATE OR REPLACE` keeps the ACL; it resets `proconfig`, so `ALTER FUNCTION ... SET search_path = public` follows (checked on PG16: `proconfig` is empty after a bare replace).
- `get_market_product_volume_metrics`: `0022:32-198` verbatim plus one predicate, `AND sh.bucket_date >= current_date - 63`, in `day_freshness`, and one comment block. `latest_listings` is NOT bounded (verifier correction on F148).

Why this is exactly equivalent (proved on PG16 with 306 products, 66k price rows including midnight and 23:59:59.999 boundary rows, NULL `recorded_at`, gaps, stale and never-priced products: 0 of 298 metric rows, 0 of 306 summary rows, 0 of 30 set-analytics rows and 0 of 306 volume rows differed, compared with `IS DISTINCT FROM`):

- `product_price_history_product_day_uidx` (`0003:48-49`) allows one row per product per `recorded_at::date`, and `daily_history` keeps the newest row per date anyway. So "newest daily row with `day <= current_date - N`" is "newest raw row with `recorded_at::date <= current_date - N`", which for `timestamp without time zone` is `recorded_at < current_date - N + 1`.
- The anchors stay unbounded in time, so a product whose last recording is 400 days old still anchors its 365d return on it, as before.
- Every other consumer of `daily_history` (`changes_90`, `drawdown_365_source`, `trend_90_source`, `trend_365_source`) filters `day >= current_date - 90` or `- 365` in its own `WHERE`, which runs before its window functions, so rows older than 366 days never reached them.
- `day_freshness.newest_day_bucket` is only compared as `>= current_date - 3`. A bucket older than 63 days fails that test, and a missing row (NULL) fails it the same way.

Measured on the replica: `get_market_product_metrics` 17.0 s to 0.15 s; `get_market_product_summaries` and `get_set_analytics` 17 s to 0.15 s each.

Exact content (the in-body comments are optional, but keep every SQL token identical: acceptance checks the body hash):

```sql
-- Migration: Bound the market metrics RPCs (review findings F142, F148).
--
-- get_market_product_metrics (last defined in
-- 20260506_market_performance_functions.sql) materialised every
-- product_price_history row ever written into the daily_history CTE, then ran
-- six correlated "latest row on or before day N" subqueries per active product
-- against that unindexed CTE. Cost grew with products x history rows. In
-- production get_market_product_summaries averaged 734-903 ms per call and hit
-- the 3 s anon statement_timeout (0009) about ten times a day, and it runs
-- twice per revalidation because get_set_analytics calls the same function.
--
-- Two changes, output unchanged:
--
--  1. The six anchors read product_price_history directly with LATERAL
--     "ORDER BY recorded_at DESC LIMIT 1" probes on the
--     (product_id, recorded_at DESC) index (idx_price_history_product_recorded,
--     0023). daily_history keeps one row per product per UTC date, so "the
--     newest daily row with day <= current_date - N" is exactly "the newest
--     raw row with recorded_at < current_date - N + 1": 1d uses
--     < current_date, 7d < current_date - 6, 30d < current_date - 29,
--     90d < current_date - 89, 180d < current_date - 179 and
--     365d < current_date - 364. The anchors are deliberately NOT bounded in
--     time: a product whose newest row is 400 days old still anchors its 365d
--     return on that row, as before.
--
--  2. daily_history now only feeds the 90/365-day window CTEs (volatility,
--     drawdown, trend), each of which already filters day >= current_date - 90
--     or - 365 BEFORE its window functions run. Bounding daily_history to
--     recorded_at >= current_date - 366 therefore removes only rows those CTEs
--     discarded anyway.
--
-- The RETURNS TABLE shape is identical, so CREATE OR REPLACE keeps the ACL
-- (Supabase bootstrap: PUBLIC, anon, authenticated, service_role). It does
-- reset proconfig, so the search_path pin from 0007/0009 is re-applied below.
-- The 0023 freshness gates live in get_market_product_summaries and
-- get_set_analytics, which are NOT touched: they keep gating these returns on
-- the newest recorded price exactly as before.
--
-- get_market_product_volume_metrics (last defined in 0022): day_freshness is
-- bounded to bucket_date >= current_date - 63. Its only use is
-- "newest_day_bucket >= current_date - 3", so a product whose newest usable
-- daily bucket is older than 63 days was already treated as stale, and a
-- missing day_freshness row (NULL) fails that test the same way. The partial
-- index added in 0027 makes it an index-only scan. latest_listings is left
-- unbounded on purpose: listings_snapshot_date is returned for stale products
-- too ("so a caller can still say when data was last seen", 0022), and a date
-- bound would turn it NULL for long-stale products. Every other line of the
-- function is 0022 verbatim.
--
-- Idempotent.
--
-- Verification:
--   python verify_migration.py migrations/0028_bounded_market_metrics.sql
--   (run the printed SQL; expect every row OK)
--
--   -- Old vs new output on the same snapshot (expect differing = 0,
--   -- missing = 0): audits/remediation/sql/WP10-market-metrics-equivalence.sql
--
--   -- Cost (expect Execution Time well under 300 ms; the old body took
--   -- seconds on a year of history):
--   EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM public.get_market_product_metrics();

CREATE OR REPLACE FUNCTION public.get_market_product_metrics()
RETURNS TABLE (
  product_id bigint,
  current_price double precision,
  return_1d double precision,
  return_7d double precision,
  return_30d double precision,
  return_90d double precision,
  return_180d double precision,
  return_365d double precision,
  volatility_90d double precision,
  max_drawdown_365d double precision,
  trend_90d double precision,
  trend_365d double precision
)
LANGUAGE sql
STABLE
AS $$
WITH active_products AS (
  SELECT p.id, p.usd_price
  FROM public.products p
  WHERE p.active = true
    AND p.usd_price IS NOT NULL
),
-- One row per product per UTC date (the newest of that date), last 366 days
-- only. Feeds the 90/365-day window CTEs below, which filter to
-- day >= current_date - 90 / - 365 before their window functions run.
daily_history AS (
  SELECT DISTINCT ON (h.product_id, (h.recorded_at::date))
    h.product_id,
    h.recorded_at::date AS day,
    h.usd_price
  FROM public.product_price_history h
  JOIN active_products ap ON ap.id = h.product_id
  WHERE h.recorded_at >= current_date - 366
  ORDER BY h.product_id, (h.recorded_at::date), h.recorded_at DESC
),
-- Price N days ago = newest row recorded on or before UTC date
-- current_date - N, i.e. recorded_at < current_date - N + 1. Each LATERAL is
-- one backward probe of (product_id, recorded_at DESC). Not bounded in time,
-- so an old last recording still anchors the long returns, as it always has.
anchors AS (
  SELECT
    ap.id AS product_id,
    ap.usd_price AS current_price,
    a1.usd_price AS price_1d,
    a7.usd_price AS price_7d,
    a30.usd_price AS price_30d,
    a90.usd_price AS price_90d,
    a180.usd_price AS price_180d,
    a365.usd_price AS price_365d
  FROM active_products ap
  LEFT JOIN LATERAL (
    SELECT h.usd_price FROM public.product_price_history h
    WHERE h.product_id = ap.id AND h.recorded_at < current_date
    ORDER BY h.recorded_at DESC LIMIT 1
  ) a1 ON true
  LEFT JOIN LATERAL (
    SELECT h.usd_price FROM public.product_price_history h
    WHERE h.product_id = ap.id AND h.recorded_at < current_date - 6
    ORDER BY h.recorded_at DESC LIMIT 1
  ) a7 ON true
  LEFT JOIN LATERAL (
    SELECT h.usd_price FROM public.product_price_history h
    WHERE h.product_id = ap.id AND h.recorded_at < current_date - 29
    ORDER BY h.recorded_at DESC LIMIT 1
  ) a30 ON true
  LEFT JOIN LATERAL (
    SELECT h.usd_price FROM public.product_price_history h
    WHERE h.product_id = ap.id AND h.recorded_at < current_date - 89
    ORDER BY h.recorded_at DESC LIMIT 1
  ) a90 ON true
  LEFT JOIN LATERAL (
    SELECT h.usd_price FROM public.product_price_history h
    WHERE h.product_id = ap.id AND h.recorded_at < current_date - 179
    ORDER BY h.recorded_at DESC LIMIT 1
  ) a180 ON true
  LEFT JOIN LATERAL (
    SELECT h.usd_price FROM public.product_price_history h
    WHERE h.product_id = ap.id AND h.recorded_at < current_date - 364
    ORDER BY h.recorded_at DESC LIMIT 1
  ) a365 ON true
),
changes_90 AS (
  SELECT
    dh.product_id,
    CASE
      WHEN lag(dh.usd_price) OVER w > 0 THEN
        ((dh.usd_price - lag(dh.usd_price) OVER w) / lag(dh.usd_price) OVER w) * 100
      ELSE NULL
    END AS pct_change
  FROM daily_history dh
  WHERE dh.day >= current_date - 90
  WINDOW w AS (PARTITION BY dh.product_id ORDER BY dh.day)
),
volatility_90 AS (
  SELECT product_id, stddev_pop(pct_change) AS volatility_90d
  FROM changes_90
  WHERE pct_change IS NOT NULL
  GROUP BY product_id
),
drawdown_365_source AS (
  SELECT
    dh.product_id,
    dh.usd_price,
    max(dh.usd_price) OVER (
      PARTITION BY dh.product_id
      ORDER BY dh.day
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_peak
  FROM daily_history dh
  WHERE dh.day >= current_date - 365
),
drawdown_365 AS (
  SELECT
    product_id,
    abs(min(
      CASE
        WHEN running_peak > 0 THEN ((usd_price - running_peak) / running_peak) * 100
        ELSE NULL
      END
    )) AS max_drawdown_365d
  FROM drawdown_365_source
  GROUP BY product_id
),
trend_90_source AS (
  SELECT
    dh.product_id,
    row_number() OVER (PARTITION BY dh.product_id ORDER BY dh.day) - 1 AS x,
    dh.usd_price AS y
  FROM daily_history dh
  WHERE dh.day >= current_date - 90
),
trend_90 AS (
  SELECT
    product_id,
    CASE
      WHEN avg(y) = 0 THEN NULL
      ELSE (regr_slope(y, x) / avg(y)) * 100
    END AS trend_90d
  FROM trend_90_source
  GROUP BY product_id
),
trend_365_source AS (
  SELECT
    dh.product_id,
    row_number() OVER (PARTITION BY dh.product_id ORDER BY dh.day) - 1 AS x,
    dh.usd_price AS y
  FROM daily_history dh
  WHERE dh.day >= current_date - 365
),
trend_365 AS (
  SELECT
    product_id,
    CASE
      WHEN avg(y) = 0 THEN NULL
      ELSE (regr_slope(y, x) / avg(y)) * 100
    END AS trend_365d
  FROM trend_365_source
  GROUP BY product_id
)
SELECT
  anchors.product_id,
  anchors.current_price,
  CASE WHEN anchors.price_1d > 0 THEN ((anchors.current_price - anchors.price_1d) / anchors.price_1d) * 100 END AS return_1d,
  CASE WHEN anchors.price_7d > 0 THEN ((anchors.current_price - anchors.price_7d) / anchors.price_7d) * 100 END AS return_7d,
  CASE WHEN anchors.price_30d > 0 THEN ((anchors.current_price - anchors.price_30d) / anchors.price_30d) * 100 END AS return_30d,
  CASE WHEN anchors.price_90d > 0 THEN ((anchors.current_price - anchors.price_90d) / anchors.price_90d) * 100 END AS return_90d,
  CASE WHEN anchors.price_180d > 0 THEN ((anchors.current_price - anchors.price_180d) / anchors.price_180d) * 100 END AS return_180d,
  CASE WHEN anchors.price_365d > 0 THEN ((anchors.current_price - anchors.price_365d) / anchors.price_365d) * 100 END AS return_365d,
  volatility_90.volatility_90d,
  drawdown_365.max_drawdown_365d,
  trend_90.trend_90d,
  trend_365.trend_365d
FROM anchors
LEFT JOIN volatility_90 ON volatility_90.product_id = anchors.product_id
LEFT JOIN drawdown_365 ON drawdown_365.product_id = anchors.product_id
LEFT JOIN trend_90 ON trend_90.product_id = anchors.product_id
LEFT JOIN trend_365 ON trend_365.product_id = anchors.product_id;
$$;

ALTER FUNCTION public.get_market_product_metrics()
  SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_market_product_volume_metrics()
RETURNS TABLE (
  product_id bigint,
  units_sold_7d bigint,
  units_sold_30d bigint,
  units_sold_prior_30d bigint,
  transaction_count_30d bigint,
  active_listings integer,
  total_quantity_available integer,
  lowest_listing_price double precision,
  listings_snapshot_date date
)
LANGUAGE sql
STABLE
AS $$
WITH active_products AS (
  SELECT p.id
  FROM public.products p
  WHERE p.active = true
),
-- Freshness must come from buckets that carry a real quantity. A row whose
-- quantity failed to parse means the day was visited but its value is
-- unknown; letting its date advance newest_day_bucket would make a run of
-- unusable trailing buckets look like fresh collection and let a stale
-- partial sum publish as complete.
--
-- Bounded to the 63 days sales_agg already reads (see the header). The only
-- consumer is "newest_day_bucket >= current_date - 3", so a bucket older than
-- that can never change the output. Served by
-- product_sales_history_day_fresh_idx (0027).
day_freshness AS (
  SELECT sh.product_id, max(sh.bucket_date) AS newest_day_bucket
  FROM public.product_sales_history sh
  JOIN active_products ap ON ap.id = sh.product_id
  WHERE sh.granularity = 'day'
    AND sh.quantity_sold IS NOT NULL
    AND sh.bucket_date >= current_date - 63
  GROUP BY sh.product_id
),
sales_agg AS (
  SELECT
    sh.product_id,

    SUM(sh.quantity_sold) FILTER (
      WHERE sh.granularity = 'day' AND sh.bucket_date >= current_date - 6
    ) AS units_sold_7d,
    COUNT(*) FILTER (
      WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
        AND sh.bucket_date >= current_date - 6
    ) AS days_7d,
    (MAX(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date >= current_date - 6
     ) - MIN(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date >= current_date - 6
     ) + 1) AS span_7d,

    SUM(sh.quantity_sold) FILTER (
      WHERE sh.granularity = 'day' AND sh.bucket_date >= current_date - 29
    ) AS units_sold_30d,
    COUNT(*) FILTER (
      WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
        AND sh.bucket_date >= current_date - 29
    ) AS days_30d,
    (MAX(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date >= current_date - 29
     ) - MIN(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date >= current_date - 29
     ) + 1) AS span_30d,

    SUM(sh.quantity_sold) FILTER (
      WHERE sh.granularity = 'day'
        AND sh.bucket_date BETWEEN current_date - 59 AND current_date - 30
    ) AS prior_30d_day,
    COUNT(*) FILTER (
      WHERE sh.granularity = 'day'
        AND sh.quantity_sold IS NOT NULL
        AND sh.bucket_date BETWEEN current_date - 59 AND current_date - 30
    ) AS prior_day_coverage,
    -- Span of the prior window's collected days, so a hole in the middle is
    -- caught the same way it is for the 7d/30d windows.
    (MAX(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date BETWEEN current_date - 59 AND current_date - 30
     ) - MIN(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date BETWEEN current_date - 59 AND current_date - 30
     ) + 1) AS prior_span,
    ROUND(SUM(sh.quantity_sold) FILTER (
      WHERE sh.granularity = 'week'
        AND sh.quantity_sold IS NOT NULL
        AND sh.bucket_date BETWEEN current_date - 63 AND current_date - 36
    ) * 30.0 / 28)::bigint AS prior_30d_week,
    -- The 28-day fallback range spans exactly four Monday buckets, and the
    -- sum above is scaled 30/28 on that basis. With one missing -- an
    -- interrupted annual backfill, a failed upsert, a null quantity --
    -- scaling anyway understates the trend denominator and inflates the
    -- trend, so the fallback is only usable when all four are present.
    COUNT(*) FILTER (
      WHERE sh.granularity = 'week'
        AND sh.quantity_sold IS NOT NULL
        AND sh.bucket_date BETWEEN current_date - 63 AND current_date - 36
    ) AS prior_week_buckets,

    SUM(sh.transaction_count) FILTER (
      WHERE sh.granularity = 'day' AND sh.bucket_date >= current_date - 29
    ) AS transaction_count_30d
  FROM public.product_sales_history sh
  JOIN active_products ap ON ap.id = sh.product_id
  WHERE sh.bucket_date >= current_date - 63
  GROUP BY sh.product_id
)
, latest_listings AS (
  SELECT DISTINCT ON (lh.product_id)
    lh.product_id,
    lh.active_listings,
    lh.total_quantity_available,
    lh.lowest_listing_price,
    lh.snapshot_date
  FROM public.product_listings_history lh
  JOIN active_products ap ON ap.id = lh.product_id
  ORDER BY lh.product_id, lh.snapshot_date DESC
)
SELECT
  ap.id AS product_id,
  -- 3 = DAILY_DATA_STALENESS_TOLERANCE_DAYS in frontend/app/lib/marketPulse.ts.
  -- A window reports only when it is fresh AND its collected days are unbroken.
  CASE WHEN df.newest_day_bucket >= current_date - 3
        AND sa.days_7d > 0 AND sa.days_7d = sa.span_7d
       THEN sa.units_sold_7d END AS units_sold_7d,
  CASE WHEN df.newest_day_bucket >= current_date - 3
        AND sa.days_30d > 0 AND sa.days_30d = sa.span_30d
       THEN sa.units_sold_30d END AS units_sold_30d,
  -- Exact beats larger, but only when the daily record is both complete
  -- enough and unbroken; otherwise the scaled weekly estimate is the better
  -- denominator. Mirrors getPriorUnitsSold30d() in marketPulse.ts, which gets
  -- its daily figure from getUnitsSoldWindow() and so already returns null on
  -- an interior hole.
  CASE
    WHEN sa.prior_day_coverage >= 28
     AND sa.prior_day_coverage = sa.prior_span
     AND sa.prior_30d_day IS NOT NULL
      THEN sa.prior_30d_day
    WHEN sa.prior_week_buckets = 4 THEN sa.prior_30d_week
    ELSE sa.prior_30d_day
  END AS units_sold_prior_30d,
  -- Transaction count shares the 30d window, so it shares the 30d guard.
  CASE WHEN df.newest_day_bucket >= current_date - 3
        AND sa.days_30d > 0 AND sa.days_30d = sa.span_30d
       THEN sa.transaction_count_30d END AS transaction_count_30d,
  -- 3 = LISTINGS_STALENESS_TOLERANCE_DAYS in frontend/app/lib/marketPulse.ts.
  -- Listings are snapshotted once per product per day; past that tolerance
  -- the depth describes a market that no longer exists, so report nothing
  -- rather than presenting it as current. listings_snapshot_date is left
  -- populated either way so a caller can still say when data was last seen.
  CASE WHEN ll.snapshot_date >= current_date - 3
       THEN ll.active_listings END AS active_listings,
  CASE WHEN ll.snapshot_date >= current_date - 3
       THEN ll.total_quantity_available END AS total_quantity_available,
  CASE WHEN ll.snapshot_date >= current_date - 3
       THEN ll.lowest_listing_price END AS lowest_listing_price,
  ll.snapshot_date AS listings_snapshot_date
FROM active_products ap
LEFT JOIN sales_agg sa ON sa.product_id = ap.id
LEFT JOIN day_freshness df ON df.product_id = ap.id
LEFT JOIN latest_listings ll ON ll.product_id = ap.id;
$$;

ALTER FUNCTION public.get_market_product_volume_metrics()
  SET search_path = public;
```

### Step 3. `audits/remediation/sql/WP10-market-metrics-equivalence.sql` (new, owner check for F142)

A script the owner runs in the Supabase SQL editor. It changes nothing in the `public` schema: it defines session-local copies of the OLD body (`20260506:32-196`) and the NEW body (from 0028) in `pg_temp` (they disappear when the connection closes) and compares old, new and the live `public.get_market_product_metrics()` on one snapshot, with a 1e-9 relative float tolerance. It deliberately has no `BEGIN ... ROLLBACK` wrapper: the Supabase SQL editor shows only the LAST statement's result, so a trailing `ROLLBACK` would hide the result row (WP01 records the same rule). It uses `CREATE OR REPLACE FUNCTION pg_temp....` so a second run on a pooled connection that still holds the temp functions does not fail with "already exists". Generate it (do not hand-copy the bodies) from the repo root:

```bash
mkdir -p audits/remediation/sql
OUT=audits/remediation/sql/WP10-market-metrics-equivalence.sql
RT='RETURNS TABLE (
  product_id bigint,
  current_price double precision,
  return_1d double precision,
  return_7d double precision,
  return_30d double precision,
  return_90d double precision,
  return_180d double precision,
  return_365d double precision,
  volatility_90d double precision,
  max_drawdown_365d double precision,
  trend_90d double precision,
  trend_365d double precision
)'
{
cat <<'EOF'
-- WP10 equivalence check for get_market_product_metrics (review finding F142).
--
-- Changes nothing in public. Creates three session-local functions in
-- pg_temp (dropped automatically when the connection closes) and compares,
-- on one snapshot:
--   old  = the body from migrations/20260506_market_performance_functions.sql
--   new  = the body from migrations/0028_bounded_market_metrics.sql
--   live = public.get_market_product_metrics() as deployed right now
-- Floats are compared with a relative tolerance of 1e-9, so a different
-- summation order in a parallel aggregate cannot report a false difference.
--
-- Run the WHOLE file in the Supabase SQL editor (select nothing first; the
-- editor runs only the selection when there is one) or with psql -f. The
-- editor shows only the last statement's result, which is why the final
-- SELECT is the last statement and there is no BEGIN/ROLLBACK. Do not run it
-- through a read-only connection (for example Supabase MCP in read-only
-- mode): CREATE FUNCTION pg_temp... fails there.
-- Expected result, one row:
--   old_vs_new_missing = 0, old_vs_new_differing = 0,
--   live_vs_new_differing = 0 after 0028 is applied
--   (before it is applied, live is the old body, so live_vs_new_differing
--   equals old_vs_new_differing, which must also be 0).
-- Every anchor is relative to current_date, so old, new and live are all
-- computed inside this one statement on the same day.

CREATE OR REPLACE FUNCTION pg_temp.near(a double precision, b double precision)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $n$
  SELECT (a IS NULL AND b IS NULL)
      OR (a IS NOT NULL AND b IS NOT NULL
          AND abs(a - b) <= 1e-9 * greatest(1, abs(a), abs(b)))
$n$;

CREATE OR REPLACE FUNCTION pg_temp.metrics_old()
EOF
echo "$RT"
echo 'LANGUAGE sql STABLE AS $old$'
sed -n 32,196p migrations/20260506_market_performance_functions.sql
echo '$old$;'
echo
echo 'CREATE OR REPLACE FUNCTION pg_temp.metrics_new()'
echo "$RT"
echo 'LANGUAGE sql STABLE AS $new$'
awk '/^CREATE OR REPLACE FUNCTION public.get_market_product_metrics/{f=1}
     f&&/^WITH active_products/{b=1} b{print} b&&/^\$\$;/{exit}' \
  migrations/0028_bounded_market_metrics.sql | sed '$d'
echo '$new$;'
cat <<'EOF'

WITH o AS (SELECT * FROM pg_temp.metrics_old()),
     n AS (SELECT * FROM pg_temp.metrics_new()),
     l AS (SELECT * FROM public.get_market_product_metrics()),
     diff AS (
       SELECT
         o.product_id AS o_id, n.product_id AS n_id, l.product_id AS l_id,
         NOT (pg_temp.near(o.current_price, n.current_price)
          AND pg_temp.near(o.return_1d, n.return_1d)
          AND pg_temp.near(o.return_7d, n.return_7d)
          AND pg_temp.near(o.return_30d, n.return_30d)
          AND pg_temp.near(o.return_90d, n.return_90d)
          AND pg_temp.near(o.return_180d, n.return_180d)
          AND pg_temp.near(o.return_365d, n.return_365d)
          AND pg_temp.near(o.volatility_90d, n.volatility_90d)
          AND pg_temp.near(o.max_drawdown_365d, n.max_drawdown_365d)
          AND pg_temp.near(o.trend_90d, n.trend_90d)
          AND pg_temp.near(o.trend_365d, n.trend_365d)) AS old_new_differs,
         NOT (pg_temp.near(l.current_price, n.current_price)
          AND pg_temp.near(l.return_1d, n.return_1d)
          AND pg_temp.near(l.return_7d, n.return_7d)
          AND pg_temp.near(l.return_30d, n.return_30d)
          AND pg_temp.near(l.return_90d, n.return_90d)
          AND pg_temp.near(l.return_180d, n.return_180d)
          AND pg_temp.near(l.return_365d, n.return_365d)
          AND pg_temp.near(l.volatility_90d, n.volatility_90d)
          AND pg_temp.near(l.max_drawdown_365d, n.max_drawdown_365d)
          AND pg_temp.near(l.trend_90d, n.trend_90d)
          AND pg_temp.near(l.trend_365d, n.trend_365d)) AS live_new_differs
       FROM o
       FULL JOIN n ON n.product_id = o.product_id
       FULL JOIN l ON l.product_id = coalesce(o.product_id, n.product_id)
     )
SELECT
  count(*) AS products,
  count(*) FILTER (WHERE o_id IS NULL OR n_id IS NULL) AS old_vs_new_missing,
  count(*) FILTER (WHERE o_id IS NOT NULL AND n_id IS NOT NULL
                     AND old_new_differs) AS old_vs_new_differing,
  count(*) FILTER (WHERE l_id IS NULL OR n_id IS NULL
                     OR live_new_differs) AS live_vs_new_differing,
  current_date AS compared_on
FROM diff;
EOF
} > "$OUT"
```

Sanity checks after generating: `sed -n 32p migrations/20260506_market_performance_functions.sql` prints `WITH active_products AS (` and `sed -n 196p` prints `LEFT JOIN trend_365 ON trend_365.product_id = anchors.product_id;` (that file is frozen, so these line numbers are stable). `grep -c "LEFT JOIN LATERAL" "$OUT"` prints 6. `grep -c '^\$old\$;$\|^\$new\$;$' "$OUT"` prints 2. `grep -c "^CREATE OR REPLACE FUNCTION pg_temp\." "$OUT"` prints 3. `grep -c "BEGIN;\|ROLLBACK;" "$OUT"` prints 0. `tail -1 "$OUT"` prints `FROM diff;`. On the local replica (Verification, optional) the script returns `products 298 | 0 | 0 | 0`, and a deliberate edit of one anchor bound in the new body makes it return 237 differing rows, so it does detect differences.

### Step 4. `migrations/0029_portfolio_history_rpc.sql` (new, F145)

Why this shape:

- One row per UTC day, `current_date - p_days` through `current_date` (`p_days + 1` rows), the same series WP05's client loop produces (`startMs = utcMidnightMs() - days * DAY_MS` through `endMs`). An integer `generate_series(0, n)` is used rather than a date/interval series, whose argument types resolve to `timestamptz` and would depend on the session time zone.
- The rules are the browser fold's rules exactly (`portfolio.ts:643-735` pre-WP05): quantity is the cumulative sum of `portfolio_holdings.quantity` with `purchase_date <= day` (lots are not read; the app never writes `portfolio_lots`, WP05 "Before you start" command 3); the price is the newest history row with `recorded_at::date <= day`; it counts only if `recorded_at::date >= day - 14` (`isPriceFresh` with `PRICE_STALENESS_TOLERANCE_DAYS = 14`, `marketPulse.ts:122-139, :284`); `value` is NULL when nothing held is priced. Validated on PG16 against a reference implementation of the browser fold: 0 differing points for 0, 7, 30 and 365 days on a 23-product portfolio with multiple lots, stale and never-priced products and same-day purchases, and on a 300-product portfolio.
- SECURITY INVOKER: `holdings_self` (`0014:65-74`) limits the holdings CTE to the caller's rows, so another user's portfolio id yields zero rows (verified). EXECUTE is revoked from PUBLIC and anon (a new function in `public` gets PUBLIC EXECUTE plus Supabase's default grants to anon, authenticated and service_role).
- Cost: 28 ms for 23 products x 366 days, 277 ms for 300 products x 366 days, against the 8 s authenticated timeout (`0009:23`). `p_days` is clamped to 0..3650.

Exact content:

```sql
-- Migration: Portfolio value history computed in the database (review
-- finding F145).
--
-- The portfolio chart used to download every daily price row for every held
-- product to the browser (up to 300 serial 1000-row pages ordered by
-- (recorded_at, id), which the (product_id, recorded_at DESC) index cannot
-- serve) and fold them into one number per day in
-- frontend/app/lib/portfolio.ts. A 1Y chart for 23 holdings moved about 8,200
-- rows in 9 round trips to draw 366 points.
--
-- get_portfolio_history returns those points directly, one row per UTC day
-- from current_date - p_days through current_date (p_days + 1 rows), with the
-- same rules the browser fold applied:
--   * held quantity on day d = sum(quantity) of the portfolio's holdings with
--     purchase_date <= d; a product is "held" when that sum is > 0.
--     portfolio_lots is not read: the app never writes it and the browser fold
--     never used it.
--   * price on day d = the newest product_price_history row recorded on or
--     before UTC date d (recorded_at < d + 1), one backward probe of
--     (product_id, recorded_at DESC).
--   * that price counts only if it was recorded on or after d - 14.
--     14 = PRICE_STALENESS_TOLERANCE_DAYS in frontend/app/lib/marketPulse.ts,
--     the same tolerance 0023 applies to the catalog price. Keep them in sync.
--   * value = sum(quantity * price) over the priced products, NULL when no held
--     product is priced that day (zero would read as a worthless portfolio).
--   * priced_products / held_products = how much of the portfolio the value
--     covers.
-- A portfolio with no holdings, or one the caller cannot see, returns no rows.
--
-- SECURITY INVOKER on purpose: the holdings_self RLS policy (0014) limits
-- portfolio_holdings to the caller's own rows, so passing someone else's
-- portfolio id yields zero rows. Do not make this SECURITY DEFINER.
-- anon has no business calling it (0013 revoked anon's table grants on
-- portfolio_holdings anyway), so EXECUTE is revoked from PUBLIC and anon.
-- p_days is clamped to 0..3650 so a caller cannot ask for an unbounded series.
--
-- Idempotent.
--
-- Verification:
--   python verify_migration.py migrations/0029_portfolio_history_rpc.sql
--   (run the printed SQL; expect every row OK)
--
--   -- As a signed-in user through the app: GET /api/portfolio/history?days=30
--   -- returns 31 points. In the SQL editor (runs as postgres, bypasses RLS):
--   SELECT * FROM public.get_portfolio_history(<portfolio id>, 30);
--   -- expect 31 rows, point_date ascending, ending on current_date.

CREATE OR REPLACE FUNCTION public.get_portfolio_history(
  p_portfolio_id bigint,
  p_days integer
)
RETURNS TABLE (
  point_date date,
  value double precision,
  priced_products integer,
  held_products integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
WITH held AS (
  -- RLS (holdings_self) filters this to the caller's own rows.
  SELECT h.product_id, h.purchase_date, h.quantity
  FROM public.portfolio_holdings h
  WHERE h.portfolio_id = p_portfolio_id
),
days AS (
  SELECT current_date - s.i AS day
  FROM generate_series(0, LEAST(GREATEST(coalesce(p_days, 0), 0), 3650)) AS s(i)
  WHERE EXISTS (SELECT 1 FROM held)
),
positions AS (
  -- Cumulative quantity per product per day, by purchase_date.
  SELECT d.day, held.product_id, sum(held.quantity) AS quantity
  FROM days d
  JOIN held ON held.purchase_date <= d.day
  GROUP BY d.day, held.product_id
),
valued AS (
  SELECT
    pos.day,
    pos.quantity,
    CASE WHEN lp.recorded_at >= pos.day - 14 THEN lp.usd_price END AS usd_price
  FROM positions pos
  LEFT JOIN LATERAL (
    SELECT h.usd_price, h.recorded_at
    FROM public.product_price_history h
    WHERE h.product_id = pos.product_id
      AND h.recorded_at < pos.day + 1
    ORDER BY h.recorded_at DESC
    LIMIT 1
  ) lp ON true
  WHERE pos.quantity > 0
)
SELECT
  d.day AS point_date,
  sum(v.quantity * v.usd_price) AS value,
  count(v.usd_price)::integer AS priced_products,
  count(v.quantity)::integer AS held_products
FROM days d
LEFT JOIN valued v ON v.day = d.day
GROUP BY d.day
ORDER BY d.day;
$$;

ALTER FUNCTION public.get_portfolio_history(bigint, integer)
  SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.get_portfolio_history(bigint, integer)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_portfolio_history(bigint, integer)
  TO authenticated, service_role;
```

### Step 5. `frontend/app/lib/portfolioInput.ts`: parse the `days` query parameter

Append at the end of the file (WP05 defines `Parsed<T>` in this file):

```ts
/**
 * Longest chart window GET /api/portfolio/history serves. The UI asks for at
 * most 365 (TIMEFRAME_DAYS in usePortfolioData.ts); one spare day. The RPC
 * clamps independently (0..3650, migration 0029).
 */
export const HISTORY_DAYS_MAX = 366;

/** The `days` query parameter: a whole number 1..HISTORY_DAYS_MAX, digits only. */
export function parseHistoryDays(raw: string | null): Parsed<number> {
  if (raw === null || !/^\d{1,4}$/.test(raw)) {
    return { ok: false, error: "Invalid days" };
  }
  const days = Number(raw);
  if (days < 1 || days > HISTORY_DAYS_MAX) {
    return { ok: false, error: "Invalid days" };
  }
  return { ok: true, value: days };
}
```

Why here and not in the route file: Next.js rejects unknown named exports from `route.ts` at build time, and this module is where WP05 keeps request parsing.

### Step 6. `frontend/app/lib/server/portfolioRepo.ts`: `loadPortfolioHistory`

6a. Add `PortfolioHistoryPoint` to the existing `import type { ... } from "../../components/Portfolio/types";` list (keep it alphabetical with the others).

6b. Append at the end of the file:

```ts
/** One row of public.get_portfolio_history (migration 0029). */
type PortfolioHistoryRow = {
  point_date: string;
  value: number | null;
  priced_products: number;
  held_products: number;
};

export type PortfolioHistoryResult =
  | { status: "ok"; points: PortfolioHistoryPoint[] }
  | { status: "rpc_missing" }
  | { status: "error" };

/**
 * PostgREST answers PGRST202 when the function is not in its schema cache
 * (migration 0029 not applied yet); Postgres itself says 42883. Either way
 * the browser falls back to computing the chart itself.
 */
const RPC_MISSING_CODES = new Set(["PGRST202", "42883"]);

/**
 * The caller's portfolio value history, one point per UTC day from
 * today - days through today (days + 1 points), computed in the database by
 * get_portfolio_history (F145). SECURITY INVOKER: the cookie-backed client
 * carries the user's JWT, so RLS on portfolio_holdings still applies, and the
 * portfolio id is looked up here rather than taken from the request.
 * Throws only when the portfolio lookup itself fails.
 */
export async function loadPortfolioHistory(
  supabase: RouteSupabase,
  userId: string,
  days: number
): Promise<PortfolioHistoryResult> {
  const portfolioId = await findPortfolioId(supabase, userId);
  if (portfolioId === null) return { status: "ok", points: [] };

  const { data, error } = await supabase.rpc("get_portfolio_history", {
    p_portfolio_id: portfolioId,
    p_days: days,
  });
  if (error) {
    if (error.code && RPC_MISSING_CODES.has(error.code)) {
      logSupabaseError("portfolio_history_rpc_missing", error);
      return { status: "rpc_missing" };
    }
    logSupabaseError("portfolio_history_rpc_failed", error);
    return { status: "error" };
  }

  const rows = (Array.isArray(data) ? data : []) as PortfolioHistoryRow[];
  return {
    status: "ok",
    points: rows.map((row) => ({
      date: row.point_date,
      value: row.value === null ? null : Number(row.value),
      priced_products: row.priced_products,
      held_products: row.held_products,
    })),
  };
}
```

The portfolio id comes from `findPortfolioId` (WP05), never from the request. `supabase.rpc` on the untyped client returns `any` data; the cast to `PortfolioHistoryRow[]` is the contract of migration 0029.

### Step 7. `frontend/app/api/portfolio/history/route.ts` (new)

It follows WP05 step 8a (`app/api/portfolio/route.ts`) exactly: header gate, then `createRouteSupabaseClient()`, then WP05's `requireRouteUser` (401 only when the session is authoritatively absent, 503 when the auth service could not answer; a bare `getUser()` null check would answer 401 during an auth outage and show "Your session has expired", the F063 behaviour WP04 removed), then the repo. Every response the handler builds goes through `jsonNoStore`. Do not define a local `NO_STORE` or call `supabase.auth.getUser()` directly.

```ts
import { NextRequest } from "next/server";
import { createRouteSupabaseClient } from "../../../lib/routeSupabase";
import { rejectIfNotAppRequest } from "../../../lib/csrf";
import { jsonNoStore, requireRouteUser } from "../../../lib/routeAuth";
import { parseHistoryDays } from "../../../lib/portfolioInput";
import { loadPortfolioHistory } from "../../../lib/server/portfolioRepo";
import { logCaughtError } from "../../../lib/logger";

const LOAD_FAILED = "Failed to load portfolio history";

/**
 * GET /api/portfolio/history?days=N: the caller's portfolio value history,
 * N + 1 daily points ending today (UTC), as { points: PortfolioHistoryPoint[] }.
 * Computed by the get_portfolio_history RPC (migration 0029, finding F145)
 * instead of paging every price row to the browser.
 *
 * 501 means the RPC is not deployed yet; lib/portfolio.ts then computes the
 * chart in the browser as before. Remove that branch once 0029 is confirmed
 * applied in production.
 */
export async function GET(req: NextRequest) {
  const forbidden = rejectIfNotAppRequest(req);
  if (forbidden) return forbidden;

  const days = parseHistoryDays(req.nextUrl.searchParams.get("days"));
  if (!days.ok) return jsonNoStore({ error: days.error }, 400);

  try {
    const supabase = await createRouteSupabaseClient();
    const auth = await requireRouteUser(supabase);
    if (auth.response) return auth.response;

    const result = await loadPortfolioHistory(supabase, auth.user.id, days.value);
    if (result.status === "rpc_missing") {
      return jsonNoStore({ error: "Portfolio history is not available yet" }, 501);
    }
    if (result.status === "error") return jsonNoStore({ error: LOAD_FAILED }, 500);
    return jsonNoStore({ points: result.points });
  } catch (error) {
    logCaughtError("portfolio_history_get_failed", error);
    return jsonNoStore({ error: LOAD_FAILED }, 500);
  }
}
```

Status codes: 403 without `x-pokefin-request: 1` (no Origin check: browsers omit Origin on same-origin GET, WP05 step 6a), 400 for a bad `days`, 401 when the session is authoritatively absent, 503 when the auth service could not answer, 501 when the RPC is not deployed, 500 on any other failure, 200 `{ points }`. Every response except the 403 (built inside `csrf.ts`) carries `Cache-Control: no-store`. If your `csrf.ts` GET helper or WP05's `routeAuth.ts` exports have different names (see Before you start), import what `app/api/portfolio/route.ts` imports instead. Export nothing from this file except `GET`. The route is covered by the proxy's existing `/api/:path*` rate limit (`frontend/proxy.ts:94-101`); nothing to add.

### Step 8. `frontend/app/lib/portfolioApi.ts`: `fetchPortfolioHistory`

8a. Add `PortfolioHistoryPoint` to the existing `import type { ... } from "../components/Portfolio/types";` list.

8b. Append after `fetchPortfolio`:

```ts
/**
 * The caller's portfolio value history from GET /api/portfolio/history.
 * Throws PortfolioApiError on any non-2xx (501 = RPC not deployed; the caller
 * in lib/portfolio.ts falls back on that one), and the fetch error on network
 * failure or abort.
 */
export async function fetchPortfolioHistory(
  days: number,
  signal?: AbortSignal
): Promise<PortfolioHistoryPoint[]> {
  const res = await fetch(`/api/portfolio/history?days=${encodeURIComponent(String(days))}`, {
    method: "GET",
    headers: { "x-pokefin-request": "1" },
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!res.ok) {
    throw new PortfolioApiError(
      await readErrorMessage(res, "Failed to load portfolio history"),
      res.status
    );
  }
  const body = (await res.json()) as { points?: PortfolioHistoryPoint[] };
  return Array.isArray(body.points) ? body.points : [];
}
```

`readErrorMessage` and `PortfolioApiError` are WP05's, already in this file.

### Step 9. `frontend/app/lib/portfolio.ts`: route first, browser fold only as fallback

9a. Rename the existing exported `getPortfolioHistory` (WP05 step 10d signature `(portfolioId, days, holdings, signal?)`) to `getPortfolioHistoryInBrowser`. Do not change its body. Replace its three-line doc comment (`/**`, ` * Get portfolio value history for charting`, ` */`) with:

```ts
/**
 * Fallback only: the portfolio value history computed in the browser from
 * every daily price row of every held product (paged through
 * fetchPortfolioPriceHistory on the anonymous client). getPortfolioHistory
 * uses it only when GET /api/portfolio/history answers 501, i.e. when
 * migration 0029 (get_portfolio_history) is not deployed. Delete it, and
 * fetchPortfolioPriceHistory with PRICE_HISTORY_PAGE_SIZE /
 * PRICE_HISTORY_MAX_PAGES, once 0029 is confirmed applied in production
 * (tracked in audits/HARDENING_FOLLOWUPS.md section 7).
 */
```

9b. Add to the imports at the top of the file:

```ts
import { fetchPortfolioHistory, PortfolioApiError } from "./portfolioApi";
```

9c. Insert directly after `getPortfolioHistoryInBrowser`:

```ts
/**
 * Portfolio value history for the chart: one point per UTC day from
 * today - days through today.
 *
 * Computed in the database by get_portfolio_history (migration 0029, F145)
 * and fetched through GET /api/portfolio/history, which uses the session
 * cookie so RLS on portfolio_holdings applies. One request of ~days+1 rows
 * replaces paging every daily price row of every held product.
 *
 * `holdings` is only used to skip the request for an empty portfolio (the
 * server reads the holdings itself), and to feed the fallback. `portfolioId`
 * is kept for the same reason; the route looks the portfolio up from the
 * session. Rejects on a route or network error; the hook logs it and shows an
 * empty chart.
 */
export async function getPortfolioHistory(
  portfolioId: number,
  days: number,
  holdings: HoldingWithProduct[],
  signal?: AbortSignal
): Promise<PortfolioHistoryPoint[]> {
  if (holdings.length === 0) return [];
  try {
    return await fetchPortfolioHistory(days, signal);
  } catch (error) {
    // 501: migration 0029 is not applied yet. Compute in the browser as before.
    if (error instanceof PortfolioApiError && error.status === 501) {
      return getPortfolioHistoryInBrowser(portfolioId, days, holdings, signal);
    }
    throw error;
  }
}
```

9d. In the module doc comment WP05 wrote at the top of the file ("Reference-data reads for the portfolio UI: product search, the catalog the Collectr import matcher uses, and the portfolio value history."), change "and the portfolio value history" to "and the in-browser fallback for the portfolio value history (the primary path is GET /api/portfolio/history)".

9e. Do not touch `usePortfolioData.ts` (not even WP05's comment "Until WP10, getPortfolioHistory reports a failed read as []": the in-browser fallback still does, so not caching an empty series stays correct): its call `getPortfolioHistory(portfolioId, TIMEFRAME_DAYS[timeframe], holdings, controller.signal)` keeps working, including abort (the fetch rejects with an AbortError, which the hook ignores because `controller.signal.aborted` is true) and error (the hook logs `portfolio_history_fetch_failed` and shows an empty chart, as it did when the old function returned `[]`).

### Step 10. Documentation

10a. `README.md`, in the list "The ordering constraints that matter when applying a *new* migration" (around line 451), extend the bullet that begins "`20260506_market_performance_functions.sql` must also precede `0022` and `0023`" by appending this sentence to it: "It must also precede `0028`, which re-defines `get_market_product_metrics` with bounded reads; replaying `20260506` after `0028` silently restores the unbounded body."

10b. `README.md`, at the end of the paragraph that ends "both correct." (around line 438, after any sentence WP01 appended there), append:

```markdown
After `0028`, `20260506` also reports a body `MISMATCH` for
`get_market_product_metrics` and `0022` one for
`get_market_product_volume_metrics`, both correct. `0027` is refused by the
verifier by design (a partial index whose predicate compares against a
literal); check it with the query in its header.
```

10c. `audits/HARDENING_FOLLOWUPS.md` section 7 ("## 7. Round-2 follow-ups"): insert these two bullets, the WP10 one first, as the first bullets of section 7 that describe migrations (above the WP06 or WP01 "pending apply" bullet if present, otherwise above "**Migration 0022 applied**"):

```markdown
- **Migrations 0027, 0028 and 0029: pending apply** (WP10, review findings
  F142, F148, F145). 0027 adds the partial index
  `product_sales_history_day_fresh_idx`. 0028 re-defines
  `get_market_product_metrics` (six LATERAL index probes instead of
  correlated CTE scans, history bounded to 366 days; output proved identical
  with `audits/remediation/sql/WP10-market-metrics-equivalence.sql`) and bounds
  `day_freshness` in `get_market_product_volume_metrics` to 63 days. 0029 adds
  `get_portfolio_history(bigint, integer)`, SECURITY INVOKER, not executable
  by anon. Owner: replace "pending apply" with "applied (YYYY-MM-DD, via
  Supabase MCP)" and paste the equivalence script's result row. Once 0029 is
  confirmed applied and the chart works, delete `getPortfolioHistoryInBrowser`,
  `fetchPortfolioPriceHistory`, the paging constants and the 501 fallback
  branch in `frontend/app/lib/portfolio.ts`.
- **Open (review F080, clustered into F142): market RPCs still compute on
  read and stay executable by anon.** 0028 bounds each call's cost, which
  removes the amplification that grew with history. Not scheduled in the
  remediation plan: having `main.py` write a per-product metrics table at the
  end of each run so `get_market_product_summaries` / `get_set_analytics`
  become indexed reads, then giving the server its own role and revoking
  anon EXECUTE on the market RPCs. Revisit if the Postgres logs show
  statement timeouts on these functions again after 0028.
```

Insert the "Open (review F080 ...)" bullet directly below the WP10 "pending apply" bullet.

10d. `audits/HARDENING_FOLLOWUPS.md`: in the section 7 bullet WP05 extended ("Signed-in data ran as anon ... parts 1 and 2 fixed ... history still reads product_price_history on the anonymous client until WP10."), replace that last sentence with: "Portfolio history now comes from GET /api/portfolio/history (RPC get_portfolio_history, migration 0029, WP10); the anonymous-client computation remains only as the fallback for a database without 0029." If the sentence is not there, skip 10d.

Do not write "applied" anywhere: you have no production access.

### Step 11. `tests/test_wp10_market_rpc_bounds.py` (new, static guard)

No database needed. It reads the effective (last-in-apply-order) definition of each function and fails if a later edit reintroduces the unbounded scan, the correlated anchors, a bounded `latest_listings`, a SECURITY DEFINER history RPC, anon EXECUTE, or a missing search_path pin. It honours `POKEFIN_MIGRATIONS_DIR` like WP01's `tests/test_migration_volatility.py`.

```python
"""
Static guards for the WP10 database changes (review findings F142, F145, F148).

Each check reads the EFFECTIVE definition of a function: the last CREATE
[OR REPLACE] FUNCTION for that name in apply order (the two out-of-band files
first, then the numbered files; README.md "The ordering constraints that
matter"). No database is needed.

Run with: python -m pytest tests/test_wp10_market_rpc_bounds.py -v
"""
import os
import re
from pathlib import Path

import pytest

MIGRATIONS = Path(os.environ.get("POKEFIN_MIGRATIONS_DIR",
                                 Path(__file__).resolve().parent.parent / "migrations"))
EARLY_FILES = ("create_box_recipes.sql", "20260506_market_performance_functions.sql")
LINE_COMMENT = re.compile(r"--[^\n]*")


def apply_order():
    files = sorted(p.name for p in MIGRATIONS.glob("*.sql"))
    early = [f for f in EARLY_FILES if f in files]
    return early + [f for f in files if f not in early]


def effective(fn):
    """(file, statement text without comments) of the last definition of fn."""
    head = re.compile(
        r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\." + fn + r"\s*\(", re.I)
    found = None
    for name in apply_order():
        sql = LINE_COMMENT.sub("", (MIGRATIONS / name).read_text())
        for m in head.finditer(sql):
            tag = re.compile(r"\bAS\s+(\$[A-Za-z_]*\$)", re.I).search(sql, m.end())
            assert tag, f"{name}: no dollar-quoted body for {fn}"
            end = sql.find(tag.group(1), tag.end())
            assert end != -1, f"{name}: unterminated body for {fn}"
            found = (name, sql[m.start():end + len(tag.group(1))])
    assert found, f"no definition of public.{fn} in {MIGRATIONS}"
    return found


def squash(text):
    return re.sub(r"\s+", " ", text).lower()


def test_metrics_history_cte_is_bounded():
    name, body = effective("get_market_product_metrics")
    assert "recorded_at >= current_date - 366" in squash(body), (
        f"{name}: daily_history must be bounded to the last 366 days (F142)")


def test_metrics_anchors_are_index_probes_not_cte_scans():
    name, body = effective("get_market_product_metrics")
    s = squash(body)
    assert s.count("left join lateral") == 6, f"{name}: expected six LATERAL anchors"
    assert "from daily_history dh where dh.product_id = ap.id" not in s, (
        f"{name}: correlated daily_history subqueries are back (F142)")
    for bound in ("< current_date ", "< current_date - 6 ", "< current_date - 29 ",
                  "< current_date - 89 ", "< current_date - 179 ",
                  "< current_date - 364 "):
        assert "h.recorded_at " + bound in s, f"{name}: anchor bound {bound!r} missing"


def test_volume_day_freshness_is_bounded_and_listings_is_not():
    name, body = effective("get_market_product_volume_metrics")
    s = squash(body)
    day_freshness = s[s.index("day_freshness as ("):s.index("sales_agg as (")]
    assert "sh.bucket_date >= current_date - 63" in day_freshness, (
        f"{name}: day_freshness must be bounded to 63 days (F148)")
    # The whole CTE, up to the function's final SELECT. (Cutting at the first
    # ")" would stop inside "distinct on (lh.product_id)" and check nothing.)
    latest_listings = s[s.index("latest_listings as ("):s.index("select ap.id as product_id")]
    assert "order by lh.product_id, lh.snapshot_date desc" in latest_listings, (
        f"{name}: could not find the latest_listings CTE body")
    assert " where " not in latest_listings and "snapshot_date >" not in latest_listings, (
        f"{name}: latest_listings must stay unbounded; listings_snapshot_date is "
        "returned for stale products on purpose (0022, F148 verifier correction)")


def test_portfolio_history_is_security_invoker():
    name, stmt = effective("get_portfolio_history")
    s = squash(stmt)
    assert "security definer" not in s, (
        f"{name}: get_portfolio_history must be SECURITY INVOKER so RLS applies (F145)")
    assert "security invoker" in s


def test_portfolio_history_is_not_executable_by_anon():
    text = squash(LINE_COMMENT.sub("", "\n".join(
        (MIGRATIONS / n).read_text() for n in apply_order())))
    assert re.search(
        r"revoke execute on function public\.get_portfolio_history\(bigint, integer\) "
        r"from public, anon", text), "EXECUTE must be revoked from PUBLIC and anon"


@pytest.mark.parametrize("fn", ["get_market_product_metrics",
                                "get_market_product_volume_metrics",
                                "get_portfolio_history"])
def test_search_path_is_pinned_after_the_last_definition(fn):
    name, _ = effective(fn)
    sql = squash(LINE_COMMENT.sub("", (MIGRATIONS / name).read_text()))
    last_create = max(m.start() for m in re.finditer(
        r"create (?:or replace )?function public\." + fn + r"\(", sql))
    assert re.search(r"alter function public\." + fn + r"\([^)]*\) set search_path = public",
                     sql[last_create:]), (
        f"{name}: CREATE OR REPLACE resets proconfig; re-pin search_path after it")
```

## Pitfalls: do not do this

- **Do not bound the anchors in time** (for example by computing them from the bounded `daily_history`, or adding `recorded_at >= current_date - 366` inside the LATERALs). For a product with a gap spanning the anchor date, the old function anchors on an older row; a bound turns that return NULL and changes summaries, set averages and the ranking. The owner's decision "bound daily_history to 366" is correct only because the anchors no longer read `daily_history`.
- **Do not add `usd_price IS NOT NULL` or `> 0` to the LATERALs.** The old anchor took the newest row whatever its value and the `CASE WHEN anchors.price_Nd > 0` in the final SELECT handles it. Filtering would pick an older row instead.
- **Do not remove `DISTINCT ON` from `daily_history`.** The unique index `(product_id, recorded_at::date)` makes it redundant in production, but a database rebuilt without that index would otherwise feed duplicate days into the window functions.
- **Do not DROP and re-create `get_market_product_metrics` or change its `RETURNS TABLE`.** A DROP discards the bootstrap ACL (`0023:50-60`) and the search_path pin; `CREATE OR REPLACE` with the identical shape keeps the ACL. Always re-apply `ALTER FUNCTION ... SET search_path = public` after a replace: it is reset (verified).
- **Do not touch `get_market_product_summaries` or `get_set_analytics`.** The 0023 freshness gates (returns withheld when the newest recorded price is stale or disagrees with `products.usd_price`) live there and depend on this function's output being unchanged, which the equivalence script proves.
- **Do not bound `latest_listings`** in `get_market_product_volume_metrics` (verifier correction on F148). `listings_snapshot_date` is deliberately returned for stale products (`0022:179-190`, "so a caller can still say when data was last seen"); a 30-day bound would turn it NULL for long-stale products. It is already index-ordered.
- **Do not bound `day_freshness` below 3 days or use a different column.** Its only consumer is `newest_day_bucket >= current_date - 3`; 63 matches `sales_agg`'s existing bound (`0022:138`).
- **Do not use `CREATE INDEX CONCURRENTLY`.** `apply_migration` wraps the file in a transaction, where CONCURRENTLY errors.
- **Do not put the partial index in 0028.** `verify_migration.py` refuses it and the function checks would then exit 1 instead of 0.
- **Do not edit `verify_migration.py`, `schema.sql` or any existing migration.** Existing migrations are already applied in production, so a change to one would never reach the database; a change always goes in a new numbered file. The verifier is generic and needs no change (see Before you start).
- **Do not revoke anon's EXECUTE on the market RPCs.** The server fetches them with the anon key (`serverMarketData.ts:42-49`), and `get_market_product_summaries` / `get_set_analytics` are SECURITY INVOKER, so they need anon EXECUTE on `get_market_product_metrics` too. Do not add a `market_product_metrics_cache` table, a PostgREST rate limit or a dedicated server role here either. F080 (clustered into F142) is handled in this package by bounding the per-call cost, which removes the amplification (cost no longer grows with history; about 100x cheaper on the replica). The remaining F080 ideas (compute-on-write cache table, a server-only role, revoking anon) are NOT scheduled by any work package in this plan: WP11 covers only the server's own call volume (F143) and WP21 covers F133/F081/F135, and neither spec touches the market RPC ACL. Step 10c records them as an open follow-up; do not describe them as covered by WP11 or WP21.
- **Do not make `get_portfolio_history` SECURITY DEFINER**, and do not take the portfolio id from the request. RLS is the authorisation; the route looks the id up from the session.
- **Do not call `get_portfolio_history` from the browser Supabase client.** That client is anonymous (the session cookie is HttpOnly); with EXECUTE revoked from anon it fails with `permission denied`, and even with EXECUTE RLS would return zero rows, a silently empty chart. Always go through `/api/portfolio/history`.
- **Do not read `portfolio_lots` in the RPC.** The browser fold never did, and nothing writes it; adding it would double-count if lots are ever mirrored from holdings.
- **Do not use `generate_series(date, date, interval)`** for the day series: it resolves to `timestamptz` and depends on the session time zone. Use the integer series as written.
- **Do not remove the in-browser fallback in this PR.** Vercel deploys on merge; if the owner merges before applying 0029, the fallback keeps charts working. Its removal is a tracked follow-up (step 10c).
- **Do not export `parseHistoryDays` or `HISTORY_DAYS_MAX` from `route.ts`.** Next.js fails the build on unknown route exports.
- **Do not change `usePortfolioData.ts`** (WP05 owns it; the call signature is kept on purpose).
- **Do not apply any migration to production.** List them under Owner actions in the PR.
- **Never re-run the whole `20260506_market_performance_functions.sql`** (for example as a "rollback"): it would also replace `get_set_analytics` with the pre-0023 unguarded body and fail on `get_market_product_summaries` (`README.md:451-460`).

## Tests

Route and repo tests need `/** @jest-environment node */` (`next/server` throws under jsdom) and `jest.mock("server-only", () => ({}))` where the module under test imports it. The skeletons below were run green by the spec writer against steps 5-9; review then changed the route (step 7) to WP05's `requireRouteUser` and added the 503 case to test 1, so run them and fix any mismatch against the code, not by weakening an assertion.

### 1. `frontend/app/api/portfolio/__tests__/history.route.test.ts` (new)

Cases: 403 without the header (and `getUser` not called); 400 for `""`, `?days=`, `0`, `367`, `abc`, `7.5`, `-1`, `1e2`, `99999` (repo not called, `no-store` set); 401 without a user (repo not called); 503 when the auth service could not answer (repo not called); 200 `{ points }` with `no-store`, no `origin` header needed, repo called as `(supabase, "user-1", 30)`; 200 for 365 and 366; 501 on `rpc_missing`; 500 on `error`; 500 when the repo throws. As in WP05's `routes.test.ts`, do not mock `lib/routeAuth` or `lib/authSession`: the real ones run, so the 401 versus 503 split is covered.

```ts
/** @jest-environment node */
import { NextRequest } from "next/server";
import { AuthRetryableFetchError } from "@supabase/supabase-js";

const getUser = jest.fn();
jest.mock("../../../lib/routeSupabase", () => ({
  createRouteSupabaseClient: async () => ({ auth: { getUser } }),
}));
jest.mock("../../../lib/server/portfolioRepo", () => ({
  loadPortfolioHistory: jest.fn(),
}));
jest.mock("../../../lib/logger", () => ({ logCaughtError: jest.fn(), logSupabaseError: jest.fn() }));

import { loadPortfolioHistory } from "../../../lib/server/portfolioRepo";
import { GET } from "../history/route";

const loadMock = loadPortfolioHistory as jest.Mock;
const POINTS = [
  { date: "2026-09-27", value: 120.5, priced_products: 2, held_products: 3 },
  { date: "2026-09-28", value: null, priced_products: 0, held_products: 3 },
];

function req(query: string, headers: Record<string, string> = { "x-pokefin-request": "1" }) {
  return new NextRequest(`https://pokefin.ca/api/portfolio/history${query}`, { method: "GET", headers });
}

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  loadMock.mockResolvedValue({ status: "ok", points: POINTS });
});

it("403 without the app header, before any auth work", async () => {
  const res = await GET(req("?days=30", {}));
  expect(res.status).toBe(403);
  expect(getUser).not.toHaveBeenCalled();
});

it.each(["", "?days=", "?days=0", "?days=367", "?days=abc", "?days=7.5", "?days=-1", "?days=1e2", "?days=99999"])(
  "400 for %p without calling the repo",
  async (query) => {
    const res = await GET(req(query));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(loadMock).not.toHaveBeenCalled();
  }
);

it("401 without a user; the repo is not called", async () => {
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  const res = await GET(req("?days=30"));
  expect(res.status).toBe(401);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(loadMock).not.toHaveBeenCalled();
});

it("503, not 401, when the auth service could not answer", async () => {
  getUser.mockResolvedValue({
    data: { user: null },
    error: new AuthRetryableFetchError("fetch failed", 0),
  });
  const res = await GET(req("?days=30"));
  expect(res.status).toBe(503);
  expect(loadMock).not.toHaveBeenCalled();
});

it("200 with the points, no origin header needed, and no-store", async () => {
  const res = await GET(req("?days=30"));
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ points: POINTS });
  expect(loadMock).toHaveBeenCalledWith(expect.anything(), "user-1", 30);
});

it("accepts the largest UI window (365) and the cap (366)", async () => {
  expect((await GET(req("?days=365"))).status).toBe(200);
  expect((await GET(req("?days=366"))).status).toBe(200);
});

it("501 when the RPC is not deployed", async () => {
  loadMock.mockResolvedValue({ status: "rpc_missing" });
  const res = await GET(req("?days=30"));
  expect(res.status).toBe(501);
  expect(res.headers.get("cache-control")).toBe("no-store");
});

it("500 when the RPC fails", async () => {
  loadMock.mockResolvedValue({ status: "error" });
  const res = await GET(req("?days=30"));
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "Failed to load portfolio history" });
});

it("500 when the repo throws", async () => {
  loadMock.mockRejectedValue(new Error("portfolio_lookup_failed"));
  const res = await GET(req("?days=30"));
  expect(res.status).toBe(500);
});
```

### 2. `frontend/app/lib/server/__tests__/portfolioRepo.history.test.ts` (new)

Cases: RPC called with `{ p_portfolio_id: 7, p_days: 30 }` and rows mapped (`point_date` to `date`, NULL value kept); no portfolio returns `{ status: "ok", points: [] }` without calling the RPC; `PGRST202` and `42883` return `rpc_missing` and log `portfolio_history_rpc_missing`; `57014` returns `error`; a portfolio lookup error throws `portfolio_lookup_failed` and skips the RPC.

```ts
/** @jest-environment node */
jest.mock("server-only", () => ({}));
// Same mock as WP05's portfolioRepo.test.ts: keeps the module-level Supabase
// client and next/cache out of this test.
jest.mock("../../serverMarketData", () => ({
  getCachedMarketProductSummaries: jest.fn(),
  fetchNewestPricedAtForProducts: jest.fn(),
}));
jest.mock("../../logger", () => ({ logCaughtError: jest.fn(), logSupabaseError: jest.fn() }));

import { logSupabaseError } from "../../logger";
import { loadPortfolioHistory } from "../portfolioRepo";

type Result = { data?: unknown; error?: { code?: string; message?: string } | null };

/** Every method returns the builder; awaiting it resolves to `result`. */
function q(result: Result) {
  const builder: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          const settled = Promise.resolve({ data: null, error: null, ...result });
          return settled.then.bind(settled);
        }
        return () => builder;
      },
    }
  );
  return builder;
}

const fromMock = jest.fn();
const rpcMock = jest.fn();
const supabase = { from: fromMock, rpc: rpcMock } as never;

beforeEach(() => {
  jest.clearAllMocks();
  fromMock.mockReturnValue(q({ data: { id: 7 } }));
});

it("calls the RPC with the caller's portfolio id and maps the rows", async () => {
  rpcMock.mockResolvedValue({
    data: [
      { point_date: "2026-09-27", value: 10.5, priced_products: 1, held_products: 2 },
      { point_date: "2026-09-28", value: null, priced_products: 0, held_products: 2 },
    ],
    error: null,
  });
  const result = await loadPortfolioHistory(supabase, "user-1", 30);
  expect(rpcMock).toHaveBeenCalledWith("get_portfolio_history", { p_portfolio_id: 7, p_days: 30 });
  expect(result).toEqual({
    status: "ok",
    points: [
      { date: "2026-09-27", value: 10.5, priced_products: 1, held_products: 2 },
      { date: "2026-09-28", value: null, priced_products: 0, held_products: 2 },
    ],
  });
});

it("returns no points and skips the RPC when the user has no portfolio", async () => {
  fromMock.mockReturnValue(q({ data: null }));
  expect(await loadPortfolioHistory(supabase, "user-1", 30)).toEqual({ status: "ok", points: [] });
  expect(rpcMock).not.toHaveBeenCalled();
});

it.each(["PGRST202", "42883"])("reports rpc_missing for %s", async (code) => {
  rpcMock.mockResolvedValue({ data: null, error: { code, message: "missing" } });
  expect(await loadPortfolioHistory(supabase, "user-1", 30)).toEqual({ status: "rpc_missing" });
  expect(logSupabaseError).toHaveBeenCalledWith("portfolio_history_rpc_missing", expect.anything());
});

it("reports error for any other RPC failure", async () => {
  rpcMock.mockResolvedValue({ data: null, error: { code: "57014", message: "statement timeout" } });
  expect(await loadPortfolioHistory(supabase, "user-1", 30)).toEqual({ status: "error" });
});

it("throws when the portfolio lookup fails", async () => {
  fromMock.mockReturnValue(q({ error: { code: "XX000", message: "boom" } }));
  await expect(loadPortfolioHistory(supabase, "user-1", 30)).rejects.toThrow("portfolio_lookup_failed");
  expect(rpcMock).not.toHaveBeenCalled();
});
```

### 3. `frontend/app/lib/__tests__/portfolio.history.test.ts` (new)

Cases: empty holdings returns `[]` without a request; points from the route are returned and `(days, signal)` passed through; a 501 falls back to the in-browser fold (proved by the fold's `supabase.from("product_price_history")` call being reached); 401 and 500 are rethrown without falling back.

```ts
jest.mock("../supabase", () => ({ supabase: { from: jest.fn() } }));
jest.mock("../clientMarketData", () => ({
  fetchMarketProductsClient: jest.fn(),
  fetchNewestPricedAtClient: jest.fn(),
}));
jest.mock("../logger", () => ({ logCaughtError: jest.fn(), logSupabaseError: jest.fn() }));
jest.mock("../portfolioApi", () => {
  const actual = jest.requireActual("../portfolioApi");
  return { ...actual, fetchPortfolioHistory: jest.fn() };
});

import { supabase } from "../supabase";
import { fetchPortfolioHistory, PortfolioApiError } from "../portfolioApi";
import { getPortfolioHistory } from "../portfolio";
import type { HoldingWithProduct } from "../../components/Portfolio/types";

const fetchHistoryMock = fetchPortfolioHistory as jest.Mock;
const fromMock = supabase.from as jest.Mock;
const HOLDING = { id: 1, portfolio_id: 1, product_id: 1, quantity: 2, purchase_date: "2020-01-01" } as HoldingWithProduct;
const POINTS = [{ date: "2026-09-28", value: 20, priced_products: 1, held_products: 1 }];

beforeEach(() => jest.clearAllMocks());

it("returns [] for an empty portfolio without a request", async () => {
  expect(await getPortfolioHistory(1, 30, [])).toEqual([]);
  expect(fetchHistoryMock).not.toHaveBeenCalled();
});

it("returns the route's points and passes days and the signal through", async () => {
  fetchHistoryMock.mockResolvedValue(POINTS);
  const controller = new AbortController();
  expect(await getPortfolioHistory(1, 30, [HOLDING], controller.signal)).toEqual(POINTS);
  expect(fetchHistoryMock).toHaveBeenCalledWith(30, controller.signal);
  expect(fromMock).not.toHaveBeenCalled();
});

it("falls back to the in-browser computation on 501 (RPC not deployed)", async () => {
  fetchHistoryMock.mockRejectedValue(new PortfolioApiError("not yet", 501));
  fromMock.mockImplementation(() => {
    throw new Error("fallback reached product_price_history");
  });
  await expect(getPortfolioHistory(1, 3, [HOLDING])).rejects.toThrow(
    "fallback reached product_price_history"
  );
});

it.each([401, 500])("rethrows a %i without falling back", async (status) => {
  fetchHistoryMock.mockRejectedValue(new PortfolioApiError("x", status));
  await expect(getPortfolioHistory(1, 30, [HOLDING])).rejects.toBeInstanceOf(PortfolioApiError);
  expect(fromMock).not.toHaveBeenCalled();
});
```

### 4. `frontend/app/lib/__tests__/portfolioApi.history.test.ts` (new)

Cases: URL `/api/portfolio/history?days=30`, `method: "GET"`, header `x-pokefin-request: 1`, `credentials: "same-origin"`, `cache: "no-store"`, the signal passed; non-2xx throws `PortfolioApiError` with the status (501 case); 401 carries the session message; a body without `points` yields `[]`.

```ts
import { fetchPortfolioHistory, PortfolioApiError } from "../portfolioApi";

const fetchMock = jest.fn();
const originalFetch = global.fetch;
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});

describe("fetchPortfolioHistory", () => {
  it("GETs /api/portfolio/history with the app header and returns points", async () => {
    const points = [{ date: "2026-09-28", value: 5, priced_products: 1, held_products: 1 }];
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ points }) });
    const controller = new AbortController();
    await expect(fetchPortfolioHistory(30, controller.signal)).resolves.toEqual(points);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/portfolio/history?days=30");
    expect(init).toMatchObject({
      method: "GET",
      headers: { "x-pokefin-request": "1" },
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
  });

  it("throws PortfolioApiError carrying the status (501 drives the fallback)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 501, json: async () => ({ error: "x" }) });
    await expect(fetchPortfolioHistory(30)).rejects.toMatchObject({ name: "PortfolioApiError", status: 501 });
  });

  it("throws the session message on 401", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const err = await fetchPortfolioHistory(30).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PortfolioApiError);
    expect((err as PortfolioApiError).message).toBe("Your session has expired. Please sign in again.");
  });

  it("returns [] when the body has no points array", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await expect(fetchPortfolioHistory(7)).resolves.toEqual([]);
  });
});
```

### 5. `frontend/app/lib/__tests__/portfolio.freshness.test.ts` (update)

Change the import of `getPortfolioHistory` to `getPortfolioHistoryInBrowser`, replace every call `getPortfolioHistory(` in this file with `getPortfolioHistoryInBrowser(` (the three "coverage" cases and WP05's F111 cases, including the aborted-signal case), and rename the describe titles `"getPortfolioHistory coverage"` to `"getPortfolioHistoryInBrowser coverage"` (and WP05's F111 describe likewise). Assertions stay unchanged. Reason: the renamed function is the old fold; `getPortfolioHistory` now calls `fetch`, which jsdom does not provide.

### 6. `frontend/app/lib/__tests__/portfolioInput.test.ts` (update)

Add a `describe("parseHistoryDays")`: `"1"`, `"30"`, `"365"`, `"366"` are ok with the numeric value; `null`, `""`, `"0"`, `"367"`, `"-1"`, `"7.5"`, `"1e2"`, `" 30"`, `"99999"` fail with `"Invalid days"`.

### 7. `tests/test_wp10_market_rpc_bounds.py` (new, step 11)

8 tests. They must pass with the new migrations present and fail when `0027`-`0029` are removed from a copy of `migrations/` (checked during review: 8 passed with them; 7 failed and 1 passed without them, the passing one being the volume function's search_path case, which `0022` already satisfies). Removing only the `ALTER FUNCTION public.get_portfolio_history ... SET search_path` fails exactly the search_path case, and adding `WHERE lh.snapshot_date >= current_date - 30` to `latest_listings` in a copy of 0028 fails exactly `test_volume_day_freshness_is_bounded_and_listings_is_not`. Prove the regression signal yourself:

```bash
rm -rf /tmp/wp10_guard && mkdir /tmp/wp10_guard && cp migrations/*.sql /tmp/wp10_guard/ \
  && rm /tmp/wp10_guard/0027_*.sql /tmp/wp10_guard/0028_*.sql /tmp/wp10_guard/0029_*.sql
POKEFIN_MIGRATIONS_DIR=/tmp/wp10_guard python3 -m pytest tests/test_wp10_market_rpc_bounds.py -q; echo "exit=$?"
# expect "7 failed, 1 passed" and exit=1
```

## Verification

From `frontend/`:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit                                   # expect exit 0
pnpm exec eslint app/api/portfolio app/lib/portfolio.ts app/lib/portfolioApi.ts \
  app/lib/portfolioInput.ts app/lib/server               # expect 0 errors in the files this PR touched
pnpm exec jest app/api/portfolio app/lib/server \
  app/lib/__tests__/portfolio.history.test.ts app/lib/__tests__/portfolioApi.history.test.ts \
  app/lib/__tests__/portfolio.freshness.test.ts app/lib/__tests__/portfolioInput.test.ts \
  app/lib/__tests__/portfolioApi.test.ts                 # expect all green
TZ=America/Toronto pnpm exec jest app/lib/__tests__/portfolio.freshness.test.ts   # WP05's DST case, still green
pnpm test --ci                                           # expect all green
pnpm build:stub                                          # WP00; expect success and "/api/portfolio/history" listed with the ƒ (Dynamic) marker
grep -nE "from \"(\./|\.\./)+supabase\"" app/lib/portfolioApi.ts app/lib/server/portfolioRepo.ts \
  app/api/portfolio/history/route.ts                     # expect no output (no anonymous browser client here)
```

From the repo root. `verify_migration.py` prints the SQL to stdout and its summary lines (`-- function ...`, `-- privilege ...`, `! REFUSED ...`) to stderr, so capture them separately:

```bash
python3 verify_migration.py migrations/0028_bounded_market_metrics.sql > /tmp/wp10_0028.sql 2> /tmp/wp10_0028.txt; echo "exit=$?"
cat /tmp/wp10_0028.txt
# expect exit=0 and exactly these lines (plus "-- run the statement below; every row must say OK"):
# -- function get_market_product_metrics(): body 8e8f39b53d71592dae0bd60dde9bebbf, non-strict, parallel u, security invoker, sql, volatility s, config search_path=public
# -- function get_market_product_volume_metrics(): body 9a9c8ac90c17a34636e1aee8be0c5f0b, non-strict, parallel u, security invoker, sql, volatility s, config search_path=public

python3 verify_migration.py migrations/0029_portfolio_history_rpc.sql > /tmp/wp10_0029.sql 2> /tmp/wp10_0029.txt; echo "exit=$?"
cat /tmp/wp10_0029.txt
# expect exit=0 and:
# -- function get_portfolio_history(p_portfolio_id bigint, p_days integer): body 2f9e67a2ae57801575c18009e257ddcf, non-strict, parallel u, security invoker, sql, volatility s, config search_path=public
# -- privilege EXECUTE on public.get_portfolio_history(bigint, integer) for public: revoked
# -- privilege EXECUTE on public.get_portfolio_history(bigint, integer) for anon: revoked
# -- privilege EXECUTE on public.get_portfolio_history(bigint, integer) for authenticated: granted
# -- privilege EXECUTE on public.get_portfolio_history(bigint, integer) for service_role: granted

python3 verify_migration.py migrations/0027_sales_history_day_fresh_index.sql; echo "exit=$?"
# expect exit=1 with "! REFUSED product_sales_history_day_fresh_idx: the predicate compares against a literal ..." (by design)

python3 -m pytest tests/test_wp10_market_rpc_bounds.py -v      # expect 8 passed
# plus the regression-signal check in Tests, item 7 (expect 7 failed, 1 passed without 0027-0029)
python3 -m pytest tests/ -q                                     # expect no new failures (WP01's volatility guard included)
grep -rn $'\xe2\x80\x94' migrations/0027_*.sql migrations/0028_*.sql migrations/0029_*.sql \
  audits/remediation/sql/WP10-market-metrics-equivalence.sql    # expect no output (no em dashes)
```

If a body hash differs, diff your file against the SQL in this spec: comments and whitespace do not affect the hash, SQL tokens do.

**Optional local database proof (recommended if you touched any SQL beyond copying it).** PostgreSQL 16 refuses to run as root, so run the cluster as the `postgres` user in its home directory:

```bash
su postgres -s /bin/bash -c 'mkdir -p ~/wp10 && /usr/lib/postgresql/16/bin/initdb -D ~/wp10/data -A trust -U postgres >/dev/null \
  && /usr/lib/postgresql/16/bin/pg_ctl -D ~/wp10/data -o "-p 54329 -k /var/lib/postgresql/wp10" -l ~/wp10/log start'
P="psql -h /var/lib/postgresql/wp10 -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "CREATE DATABASE wp10"
$P -d wp10 -f <scaffold.sql>      # the scaffold below
$P -d wp10 -f migrations/20260506_market_performance_functions.sql
$P -d wp10 -c "ALTER FUNCTION public.get_market_product_metrics() SET search_path = public; ALTER FUNCTION public.get_set_analytics() SET search_path = public"
$P -d wp10 -f migrations/0022_listings_freshness_guard.sql
$P -d wp10 -f migrations/0023_price_freshness_guard.sql
$P -d wp10 -f <seed.sql>          # the seed below
$P -d wp10 -f audits/remediation/sql/WP10-market-metrics-equivalence.sql   # expect: 298 | 0 | 0 | 0 (see note)
$P -d wp10 -f migrations/0027_sales_history_day_fresh_index.sql -f migrations/0028_bounded_market_metrics.sql -f migrations/0029_portfolio_history_rpc.sql
$P -d wp10 -f audits/remediation/sql/WP10-market-metrics-equivalence.sql   # expect: 298 | 0 | 0 | 0
# stop afterwards:
su postgres -s /bin/bash -c '/usr/lib/postgresql/16/bin/pg_ctl -D ~/wp10/data stop'
```

Note on the first equivalence run (before 0028): `live` is the old body, so `live_vs_new_differing` equals `old_vs_new_differing`, which must be 0. Both runs must print `old_vs_new_missing = 0` and `old_vs_new_differing = 0`. Also compare downstream functions: before 0028 run `CREATE SCHEMA wp10_check; CREATE TABLE wp10_check.summ AS SELECT * FROM public.get_market_product_summaries(); CREATE TABLE wp10_check.sets AS SELECT * FROM public.get_set_analytics(); CREATE TABLE wp10_check.vol AS SELECT * FROM public.get_market_product_volume_metrics();`, and after it `SELECT count(*) FILTER (WHERE row(o.*) IS DISTINCT FROM row(n.*)) FROM wp10_check.summ o FULL JOIN public.get_market_product_summaries() n ON n.id = o.id;` (and the same for `sets` joined on `key`, `vol` joined on `product_id`): expect 0 each. Portfolio RPC: insert a portfolio for user `11111111-1111-1111-1111-111111111111` with a few holdings, then `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false); SELECT count(*) FROM get_portfolio_history(1, 30);` returns 31; with another user's sub it returns 0; `SET ROLE anon` then the same call fails with `permission denied for function get_portfolio_history`.

Scaffold (Supabase-shaped roles, the tables these functions read, RLS as in 0001/0013/0014). Roles are cluster-wide: on a cluster where they already exist, drop the first line.

```sql
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.exchange_rates (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, recorded_at timestamp);
CREATE TABLE public.generations (id bigint PRIMARY KEY, name text);
CREATE TABLE public.sets (id bigint PRIMARY KEY, name text, code text, release_date date, expansion_type varchar, generation_id bigint);
CREATE TABLE public.product_types (id bigint PRIMARY KEY, name text, label text);
CREATE TABLE public.products (id bigint PRIMARY KEY, set_id bigint, product_type_id bigint, usd_price double precision, url text, last_updated timestamp DEFAULT now(), image_url text, variant text, sku text, active boolean NOT NULL DEFAULT true);
CREATE TABLE public.product_price_history (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, product_id bigint, usd_price double precision NOT NULL, recorded_at timestamp DEFAULT now());
CREATE UNIQUE INDEX product_price_history_product_day_uidx ON public.product_price_history (product_id, (recorded_at::date));
CREATE TABLE public.product_sales_history (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, product_id bigint NOT NULL, bucket_date date NOT NULL, granularity text NOT NULL DEFAULT 'day', quantity_sold integer, transaction_count integer, low_sale_price double precision, high_sale_price double precision, market_price double precision, recorded_at timestamp DEFAULT now(), CONSTRAINT product_sales_history_product_bucket_uidx UNIQUE (product_id, bucket_date, granularity));
CREATE INDEX product_sales_history_product_id_bucket_date_idx ON public.product_sales_history (product_id, bucket_date DESC);
CREATE TABLE public.product_listings_history (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, product_id bigint NOT NULL, snapshot_date date NOT NULL DEFAULT CURRENT_DATE, active_listings integer, total_quantity_available integer, lowest_listing_price double precision, recorded_at timestamp DEFAULT now(), CONSTRAINT product_listings_history_product_snapshot_uidx UNIQUE (product_id, snapshot_date));
CREATE INDEX product_listings_history_product_id_snapshot_date_idx ON public.product_listings_history (product_id, snapshot_date DESC);
CREATE TABLE public.portfolios (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL DEFAULT 'My Portfolio', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX portfolios_user_id_uidx ON public.portfolios (user_id);
CREATE TABLE public.portfolio_holdings (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, portfolio_id bigint NOT NULL REFERENCES public.portfolios(id), product_id bigint NOT NULL REFERENCES public.products(id), quantity integer NOT NULL CHECK (quantity > 0), purchase_price_usd double precision NOT NULL, purchase_date date NOT NULL, notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), client_idempotency_key uuid);
CREATE INDEX portfolio_holdings_portfolio_id_idx ON public.portfolio_holdings (portfolio_id);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_read ON public.products FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY product_price_history_read ON public.product_price_history FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY portfolios_self ON public.portfolios FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY holdings_self ON public.portfolio_holdings FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.portfolios p WHERE p.id = portfolio_id AND p.user_id = (SELECT auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.portfolios p WHERE p.id = portfolio_id AND p.user_id = (SELECT auth.uid())));
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.portfolios FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.portfolio_holdings FROM anon;
```

Seed (306 active and 24 inactive products, gaps, stale and never-priced products, NULL prices, sales and listings history):

```sql
SELECT setseed(0.42);
INSERT INTO generations VALUES (1,'Gen A'),(2,'Gen B');
INSERT INTO sets SELECT g, 'Set '||g, 'S'||g, current_date - (g*40), 'Expansion', 1 + g%2 FROM generate_series(1,30) g;
INSERT INTO product_types VALUES (1,'booster_box','Booster Box'),(2,'etb','ETB');
INSERT INTO products (id,set_id,product_type_id,usd_price,url,last_updated,active)
SELECT i, 1 + i%30, 1 + i%2, CASE WHEN i%37=0 THEN NULL ELSE 50 + (i%97)*3.5 END, 'u'||i, now() - (i%11)*interval '1 hour', i <= 306 FROM generate_series(1,330) i;
-- history: start between 5 and 450 days back, end between 0 and 120 days back for ~10% (stale), gaps ~8%
INSERT INTO product_price_history (product_id, usd_price, recorded_at)
SELECT p.i, round((40 + random()*200)::numeric,2)::float8, (current_date - d) + interval '4 hours' + (random()*300)::int * interval '1 minute'
FROM (SELECT i, 5 + (i*37 % 446) AS start_back, CASE WHEN i%10=3 THEN (i*7)%120 WHEN i%10=7 THEN 16 ELSE 0 END AS end_back FROM generate_series(1,330) i WHERE i%53 <> 0) p
CROSS JOIN LATERAL generate_series(p.end_back, p.start_back) d
WHERE random() > 0.08;
-- make products.usd_price agree with latest history for most products
UPDATE products p SET usd_price = l.usd_price FROM (SELECT DISTINCT ON (product_id) product_id, usd_price FROM product_price_history ORDER BY product_id, recorded_at DESC) l WHERE l.product_id = p.id AND p.id % 37 <> 0 AND p.id % 19 <> 0;
-- sales history daily for 400 days, some null quantity, some stale products
INSERT INTO product_sales_history (product_id, bucket_date, granularity, quantity_sold, transaction_count)
SELECT i, current_date - d, 'day', CASE WHEN random() < 0.05 THEN NULL ELSE (random()*20)::int END, (random()*10)::int
FROM generate_series(1,330) i CROSS JOIN generate_series(CASE WHEN i%9=0 THEN 70 WHEN i%9=1 THEN 5 ELSE 0 END, 400) d WHERE random() > 0.03;
INSERT INTO product_sales_history (product_id, bucket_date, granularity, quantity_sold, transaction_count)
SELECT i, date_trunc('week', current_date - w*7)::date, 'week', (random()*100)::int, (random()*40)::int
FROM generate_series(1,330) i CROSS JOIN generate_series(1,52) w ON CONFLICT DO NOTHING;
INSERT INTO product_listings_history (product_id, snapshot_date, active_listings, total_quantity_available, lowest_listing_price)
SELECT i, current_date - d, (random()*50)::int, (random()*200)::int, 10 + random()*300
FROM generate_series(1,330) i CROSS JOIN generate_series(CASE WHEN i%8=0 THEN 40 ELSE 0 END, 400) d WHERE random() > 0.05;
-- boundary rows: exactly midnight and 23:59:59.999 on anchor dates, and NULL recorded_at
UPDATE product_price_history SET recorded_at = recorded_at::date
 WHERE recorded_at::date IN (current_date, current_date-1, current_date-6, current_date-7, current_date-29, current_date-30,
   current_date-89, current_date-90, current_date-179, current_date-180, current_date-364, current_date-365, current_date-366)
   AND product_id % 3 = 0;
UPDATE product_price_history SET recorded_at = recorded_at::date + interval '23:59:59.999'
 WHERE recorded_at::date IN (current_date-1, current_date-7, current_date-30, current_date-90, current_date-180, current_date-365)
   AND product_id % 3 = 1;
INSERT INTO product_price_history (product_id, usd_price, recorded_at) VALUES (5, 99, NULL), (6, 98, NULL);
ANALYZE;
```

Manual checks the executor can do: none against real data (no production access, and the WP00 stub answers `[]` to everything). The end-to-end checks are Owner actions 6 and 7.

## Owner actions

Apply in this order, and apply 0027-0029 **before merging** this PR (Vercel deploys on merge; the code has a fallback, but the fast path needs 0029). All SQL runs in the Supabase SQL editor for the production project with nothing selected, or through Supabase MCP.

1. **Baseline (optional, 2 minutes).** Record today's cost so the improvement is measurable:

   ```sql
   SELECT left(query, 60) AS q, calls, round(mean_exec_time) AS mean_ms, round(max_exec_time) AS max_ms
     FROM pg_stat_statements
    WHERE query ILIKE '%get_market_product_summaries%' OR query ILIKE '%get_set_analytics%'
       OR query ILIKE '%get_market_product_volume_metrics%'
    ORDER BY calls DESC LIMIT 6;
   EXPLAIN (ANALYZE) SELECT * FROM public.get_market_product_metrics();   -- note "Execution Time"
   ```

2. **Prerequisites.** (a) WP01's 0024/0025 and WP05 are merged and applied. (b) The price-history index exists: `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'product_price_history';` must show a btree on `(product_id, recorded_at DESC)` (name `idx_price_history_product_recorded` or the older production name). If none exists, stop and apply `0023`'s `CREATE INDEX IF NOT EXISTS idx_price_history_product_recorded ...` statement first. (c) `SELECT current_setting('TimeZone');` returns `UTC` (the RPCs use `current_date`; so do the existing ones).

3. **Pre-apply equivalence (5 minutes).** Paste the whole of `audits/remediation/sql/WP10-market-metrics-equivalence.sql` and Run. Expect one row: `old_vs_new_missing = 0`, `old_vs_new_differing = 0`, `live_vs_new_differing = 0`. If either old_vs_new column is non-zero, stop and report the row: do not apply 0028. The script only creates three `pg_temp` functions, which vanish when the editor's connection closes; it changes nothing in `public`. If the editor shows "Success. No rows returned" instead of a result row, you ran a selection or an old copy of the script: select nothing and paste the file from the repo again.

4. **Apply 0027, then 0028.** Preferred: Supabase MCP `apply_migration` with names `0027_sales_history_day_fresh_index` and `0028_bounded_market_metrics` and the full file contents. Alternative: SQL editor, paste the whole file, nothing selected, Run. Do 0027 when the scraper is not writing (it briefly blocks writes to `product_sales_history`). Then:
   - 0027: run the verification query in its header. Expect one row, `valid = true`, definition ending `WHERE ((granularity = 'day'::text) AND (quantity_sold IS NOT NULL))`.
   - 0028: run `python3 verify_migration.py migrations/0028_bounded_market_metrics.sql` locally, paste the printed SQL, Run. Expect 2 rows, both `OK`.
   - Re-run the equivalence script. Expect `0 | 0 | 0` again (now `live` is the new body).
   - `EXPLAIN (ANALYZE) SELECT * FROM public.get_market_product_metrics();` Execution Time should be a small fraction of step 1's (expect well under 300 ms).

5. **Apply 0029** (MCP name `0029_portfolio_history_rpc`). Verify: `python3 verify_migration.py migrations/0029_portfolio_history_rpc.sql`, paste, Run: expect 5 rows, all `OK` (1 function, 4 privileges). Then prove RLS as a real user. Replace `YOUR_ACCOUNT_EMAIL`, select nothing, and run the whole snippet as one Run. It has no `BEGIN`/`ROLLBACK` on purpose: the editor shows only the last statement's result, and it sends the snippet as one batch, which Postgres runs as one implicit transaction, so the `true` (local) settings and `SET LOCAL ROLE` end with the batch. The two portfolio ids are read while still running as `postgres`, before the role switch; read after it, RLS would hide the other user's portfolio, the id would be NULL, and the "other user" check would pass without testing anything.

   ```sql
   SELECT set_config('wp10.me',
            (SELECT id::text FROM auth.users WHERE email = 'YOUR_ACCOUNT_EMAIL'), true),
          set_config('wp10.mine',
            (SELECT p.id::text FROM public.portfolios p JOIN auth.users u ON u.id = p.user_id
              WHERE u.email = 'YOUR_ACCOUNT_EMAIL' LIMIT 1), true),
          set_config('wp10.other',
            (SELECT h.portfolio_id::text FROM public.portfolio_holdings h
               JOIN public.portfolios p ON p.id = h.portfolio_id
               JOIN auth.users u ON u.id = p.user_id
              WHERE u.email <> 'YOUR_ACCOUNT_EMAIL' LIMIT 1), true);
   SELECT set_config('request.jwt.claims',
            json_build_object('sub', current_setting('wp10.me'), 'role', 'authenticated')::text,
            true);
   SET LOCAL ROLE authenticated;
   SELECT
     (SELECT count(*) FROM public.get_portfolio_history(
        nullif(current_setting('wp10.mine'), '')::bigint, 30)) AS points,
     (SELECT max(point_date) FROM public.get_portfolio_history(
        nullif(current_setting('wp10.mine'), '')::bigint, 30)) AS last_point,
     nullif(current_setting('wp10.other'), '') IS NOT NULL AS other_portfolio_found,
     (SELECT count(*) FROM public.get_portfolio_history(
        nullif(current_setting('wp10.other'), '')::bigint, 30)) AS other_users_points,
     current_user AS ran_as;
   ```

   Expect `ran_as = authenticated`, `points = 31` and `last_point` = today's UTC date when your portfolio has holdings (0 and NULL when it has none), `other_portfolio_found = true` and `other_users_points = 0`. If `other_portfolio_found` is false, no other user has holdings yet and the cross-user check proved nothing; say so in HARDENING_FOLLOWUPS. An error `invalid input syntax for type uuid: ""` means the email matched no row in `auth.users`; fix the email and run again. (This snippet was replayed on the local scaffold with a Supabase-style `auth.uid()`: 31 points, other user 0, `current_user` back to `postgres` afterwards.) Then run, as separate Runs: `SELECT current_user;` (must return `postgres`, proving the role switch ended with the batch) and `SELECT has_function_privilege('anon', 'public.get_portfolio_history(bigint, integer)', 'EXECUTE');` (must return `false`).

6. **Merge and check the site.** After the deploy: sign in, open `/portfolio`. In DevTools > Network: one `GET /api/portfolio/history?days=30` answering 200 with 31 points, and no requests to `/rest/v1/product_price_history`. Click 1Y: one request with `days=365` and 366 points; the chart matches what it showed before for the same range. A 501 in that request means PostgREST does not see `get_portfolio_history` (the chart still renders through the fallback). If step 5 was done, PostgREST's schema cache has not reloaded: run `NOTIFY pgrst, 'reload schema';` in the SQL editor, wait 10 seconds and reload the page. If step 5 was not done, do it.

7. **After 24 hours.** Re-run the step 1 `pg_stat_statements` query (optionally `SELECT pg_stat_statements_reset();` right after step 4 so the means cover only the new body). Expect `get_market_product_summaries` and `get_set_analytics` mean well under 300 ms and max under 1 s. In Dashboard > Logs > Postgres, search "canceling statement due to statement timeout": expect none for these functions.

8. **Record it.** In `audits/HARDENING_FOLLOWUPS.md` section 7, change "**Migrations 0027, 0028 and 0029: pending apply**" to "**Migrations 0027, 0028 and 0029 applied** (YYYY-MM-DD, via Supabase MCP)" and paste the equivalence result row and the before/after Execution Time. Commit that doc change directly to master as `docs: record migrations 0027-0029 as applied` (same convention as WP01's owner step 7), so later packages that anchor on these bullets (WP16, WP21) find the final text.

## Acceptance criteria

- [ ] `migrations/0027_sales_history_day_fresh_index.sql`, `0028_bounded_market_metrics.sql`, `0029_portfolio_history_rpc.sql` exist (or the next free numbers, consistently substituted); no existing migration, `verify_migration.py` or `schema.sql` changed (`git diff --stat master -- migrations/20260506_market_performance_functions.sql migrations/0022_listings_freshness_guard.sql migrations/0023_price_freshness_guard.sql verify_migration.py schema.sql` is empty).
- [ ] `verify_migration.py` on 0028 exits 0 with body hashes `8e8f39b53d71592dae0bd60dde9bebbf` (metrics) and `9a9c8ac90c17a34636e1aee8be0c5f0b` (volume), both `security invoker`, `volatility s`, `config search_path=public`.
- [ ] `verify_migration.py` on 0029 exits 0 with body hash `2f9e67a2ae57801575c18009e257ddcf`, `security invoker`, PUBLIC and anon revoked, authenticated and service_role granted.
- [ ] `get_market_product_metrics` has 6 `LEFT JOIN LATERAL` anchors, no `FROM daily_history dh WHERE dh.product_id = ap.id`, and `daily_history` bounded with `recorded_at >= current_date - 366`; `latest_listings` in the volume function has no date bound.
- [ ] `audits/remediation/sql/WP10-market-metrics-equivalence.sql` exists, has exactly 6 `LEFT JOIN LATERAL` and 3 `CREATE OR REPLACE FUNCTION pg_temp.` lines, contains no `BEGIN;` or `ROLLBACK;`, and its last line is `FROM diff;` (the Supabase editor shows only the last statement's result).
- [ ] `tests/test_wp10_market_rpc_bounds.py` passes (8 tests).
- [ ] `GET /api/portfolio/history` exists with the status codes in step 7 (403, 400, 401, 503, 501, 500, 200), uses WP05's `requireRouteUser` and `jsonNoStore` (`grep -c "requireRouteUser\|jsonNoStore" app/api/portfolio/history/route.ts` from `frontend/` prints at least 2, and `grep -c "auth.getUser" app/api/portfolio/history/route.ts` prints 0); its tests pass.
- [ ] `getPortfolioHistory` makes one `fetch` to `/api/portfolio/history` and no `product_price_history` query unless the route answered 501 (tests 3 and 4).
- [ ] `pnpm exec tsc --noEmit`, `pnpm test --ci` and `pnpm build:stub` pass; no new lint errors in touched files.
- [ ] `README.md` and `audits/HARDENING_FOLLOWUPS.md` carry the step 10 edits with 0027-0029 marked "pending apply", and section 7 has the "Open (review F080 ...)" bullet directly below the WP10 bullet.
- [ ] (Owner) Equivalence script returns `0 | 0 | 0` before and after applying 0028.
- [ ] (Owner) `verify_migration.py` queries return all `OK` for 0028 (2 rows) and 0029 (5 rows); the 0027 header query returns one valid index.
- [ ] (Owner) The portfolio chart loads with one `/api/portfolio/history` request per timeframe and no `product_price_history` requests.
- [ ] (Owner) After 24 hours, zero statement-timeout cancellations for the market RPCs.

## Rollback

- **Code**: revert the PR commit. The hook then uses the pre-WP10 browser computation again (WP05's `getPortfolioHistory`); leaving 0029 in the database is harmless.
- **0029**: `DROP FUNCTION IF EXISTS public.get_portfolio_history(bigint, integer);` as a new numbered migration. While this PR's code is deployed, the route then answers 501 and the chart falls back to the browser fold.
- **0028**: do not re-run `20260506_market_performance_functions.sql` or `0022` whole files blindly. Write a new numbered migration containing (a) `20260506_market_performance_functions.sql` lines 14-197 (the old `get_market_product_metrics` only) followed by `ALTER FUNCTION public.get_market_product_metrics() SET search_path = public;`, and (b) the whole of `0022_listings_freshness_guard.sql` (it only defines the volume function and re-pins it). Same return shapes, so the ACL is kept. Verify with `verify_migration.py` on that new file.
- **0027**: `DROP INDEX IF EXISTS public.product_sales_history_day_fresh_idx;` in a new numbered migration. Keeping it is harmless (one small partial index).
- Never edit 0027-0029 after they are applied; add a new file instead.

## Commit and PR

Commit message:

```text
perf(db): bound market metrics RPCs; compute portfolio history in SQL

- 0027: partial index for get_market_product_volume_metrics day_freshness (F148)
- 0028: get_market_product_metrics anchors become LATERAL index probes and
  daily_history is bounded to 366 days; day_freshness bounded to 63 days.
  Output unchanged (equivalence script in audits/remediation/sql) (F142)
- 0029: get_portfolio_history(bigint, integer), SECURITY INVOKER, no anon
  EXECUTE; one row per UTC day with the 14-day freshness gate (F145)
- GET /api/portfolio/history + portfolioRepo.loadPortfolioHistory +
  portfolioApi.fetchPortfolioHistory; getPortfolioHistory uses the route and
  falls back to the browser fold only on 501
- Static pytest guard for the bounds; route/repo/client tests
```

PR title: `WP10: bounded market metrics RPCs and a portfolio history RPC (F142, F148, F145)`

PR body summary: what was slow (unbounded history scan plus about 1,800 correlated CTE scans per call, twice per revalidation; production mean 734-903 ms and daily 3 s timeouts; portfolio chart paging thousands of rows to the browser), what changed (three migrations, the route, the fallback), the equivalence evidence (replica: 0 differing rows across metrics, summaries, set analytics and volume; 17 s to 0.15 s), why `latest_listings` stays unbounded, why `verify_migration.py` needed no change and why 0027 is a separate file, the Verification output, the Owner actions checklist (apply 0027-0029 before merge, run the equivalence script before and after 0028), and out-of-scope notes: server revalidation frequency and the hundreds of summaries calls per hour (F143, WP11); anon EXECUTE on the market RPCs, direct PostgREST rate limiting and the compute-on-write metrics table (F080 residual, not scheduled in the plan, recorded as an open item in HARDENING_FOLLOWUPS); removal of the browser fallback after 0029 is confirmed (follow-up in HARDENING_FOLLOWUPS).
