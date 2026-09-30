# WP25: Market analytics foundation: daily product stats and dated FX

- **Goal**: every new metric Track 2 shows (52-week range, tracked high, liquidity, supply trend, weekly volatility) and every CAD figure comes from an indexed, precomputed, freshness-gated table, and Canadian users can see historical CAD at the Bank of Canada rate of that day instead of today's rate.
- **Why now / value**: WP28 to WP37 all read these two tables. Without them each feature would add a per-request window function over the full price history (the class of RPC WP10 had to bound because it timed out), and every CAD chart, return and cost basis would keep leaving out the currency move.
- **Effort**: L, 14 to 16 hours (two migrations validated on scratch Postgres, one SQL-level test module, two backfill scripts, one scraper hook, three small frontend modules, two cached fetchers, methodology v1.1, tests).
- **Depends on**: WP10 (bounded market RPCs, migrations 0027 to 0029), WP11 (`cacheTags.ts`, `DAILY_BACKSTOP_SECONDS`, `run_jobs_once()`, `revalidate_hook.py`), WP16 (post-WP16 `main.py`, migration 0030), WP20 (`CurrencyProvider`, `app/types/market.ts`, `pnpm types:db`, generated `app/types/database.ts`), WP21 (`pokefin_scraper` role in 0032, `scraper_db.py`, `pg_db` in `main.py`, `scripts/db/replay_migrations.sh`, CI job "Database replay and Python tests"), WP22 (perf fixture and `pnpm perf:budget`), WP24 (`/methodology`, `app/content/methodology.ts`, `app/lib/metricDefinitions.ts`).
- **Unblocks**: WP28 (extends `refresh_market_analytics`), WP29 (index reads `product_daily_stats`, its cron follows the 00:30 UTC finalisation), WP31, WP32, WP33, WP34, WP35, WP36 (`fx_daily`, stats), WP37.
- **Placement**: after WP21 (scraper role, replay harness, baseline) and WP24 (methodology page to extend). Parallel with WP26 and WP27. Reserves migrations **0033** and **0034**; keeps them even if it merges out of order.
- **Suggested branch name**: `remediation/wp25-market-analytics-foundation`
- **Risk level**: medium. It adds a SECURITY DEFINER function the scraper calls every run; the risk is contained by an additive schema (no existing object changes), a hook that never raises, EXECUTE limited to `pokefin_scraper` and `service_role`, and a database test module that proves every gate.

## Why

Pokéfin collects listings depth, transaction counts and dated Bank of Canada rates that never reach the UI, and every CAD value, historical ones included, is converted at today's rate, so a Canadian user's CAD return equals the USD return and omits a currency move the same size as many 30-day sealed returns (`research/data-opportunities.md` §1 items 1 to 3, §3.14). The metrics the product direction ranks highest for a buy, hold or sell decision (tracked high, 52-week range, liquidity, supply trend: `01-PRODUCT-DIRECTION.md` §5 items 1, 4, 5) need window functions over the whole price history, which cannot run per request under anon's 3 s statement timeout (`research/data-opportunities.md` §3.1, §5). This package adds one table, `product_daily_stats`, written by `refresh_market_analytics(p_day)` after each scraper run and finalised nightly, plus `fx_daily`, one carried-forward BoC rate per day, and the cached server reads and TypeScript helpers later packages build on. Collector-investors benefit through WP28 to WP37; this package ships no UI beyond the methodology page, which moves to v1.1 so every new number is documented before it is shown (`research/trust-seo-brand.md` §4, §5).

## Design

### Data flow

```
 scraper run (every 4 h, owner's machine)            pg_cron (Supabase, 00:30 UTC)
 fetch_and_store_exchange_rate -> update_prices       |
            |                                         |
            v                                         v
 refresh_after_run(today) --- pokefin_scraper ---> refresh_market_analytics(p_day)   SECURITY DEFINER
            |                                         |  1. refresh_fx_daily(p_day)          -> fx_daily
            v                                         |  2. refresh_product_daily_stats(p_day) -> product_daily_stats
 trigger_site_revalidation (WP11)                     |     (one row per active product for p_day)
            |                                         v
            v                                  product_stats_latest (view: newest day, active products)
 Next caches (tag market-products, exchange-rate) <- getCachedProductStats(), getCachedFxDaily()
            |
            v
 WP28 to WP37 pages (server components), CurrencyProvider.convertDailySeries(points, fx)
```

- `p_day` is a UTC calendar day. Every input is read "as of" that day: price rows with `recorded_at < p_day + 1`, sales buckets with `bucket_date <= p_day`, listings with `snapshot_date <= p_day`. Re-running a past day reproduces it, which is what the backfill and the nightly D-1 finalisation rely on.
- The scraper refreshes `current_date` (UTC) after every successful run. pg_cron refreshes `current_date - 1` at 00:30 UTC so yesterday's row is complete even when the laptop is off.
- Row count: about 306 per day, 112k a year, about 30 MB a year (free tier is 500 MB). No retention job in this package.

### Metric definitions (product_daily_stats, one row per active product per UTC day `D`)

All percent columns are percent points (`12.5` means +12.5%). `NULL` always means withheld or not computable, never zero. "Gated" means `NULL` unless `is_price_fresh`.

| Column | Definition | Edge cases |
|---|---|---|
| `price_day` | Date of the newest `product_price_history` row with `recorded_at < D + 1` | Never nulled, so a reader can say "last priced" |
| `is_price_fresh` | `price_day >= D - 14` AND (a newer row exists after `D` OR `products.usd_price IS NOT DISTINCT FROM` that row's price) | Mirrors 0023. The agreement check only applies when the row is the product's newest overall: for past days `products.usd_price` says nothing |
| `usd_price` | That row's price. Gated | |
| `ret_1d` | `(price / prev - 1) * 100`, `prev` = newest row strictly before `price_day` and at most 3 days before it. Gated; also `NULL` unless `price_day >= D - 1` | A product last repriced 5 days ago has no 1D change, not a stale one |
| `ret_7d`, `ret_30d`, `ret_90d`, `ret_365d` | `(price / anchor - 1) * 100`, anchor = newest row on or before `D - N` and not older than `D - N - tol`; `tol` = 7 for 7D and 1M, 14 for 3M and 1Y. Gated | Anchor price `<= 0` gives `NULL`. This is the bounded anchor the WP10 plan change deferred to WP25; WP10's RPC is not changed |
| `first_tracked_day` | Oldest price row date | |
| `tracked_high_usd`, `tracked_high_day` | Per day, `min3` = min of that day's price and the 2 previous recorded prices (3 rows). Tracked high = max of `min3` over all rows up to `D`; its day = the latest day that reached it | Needs 3 rows. A one-day spike cannot set it. Labelled "tracked high since {first_tracked_day}", never all-time. Not gated (describes history) |
| `dd_from_high_pct` | `(price / tracked_high_usd - 1) * 100`. Gated | Can be above 0 when a move is under 3 days old; UI shows "at tracked high" for values `>= 0` |
| `high_52w`, `low_52w` | High: max of `min3` over days `D - 364 .. D`. Low: min of `max3` (the mirror) | Needs 3 rows. Not gated |
| `pos_in_52w` | `(price - low) / (high - low) * 100`, clamped to 0..100. Gated | `NULL` when `high = low` |
| `distinct_prices_365d` | Distinct daily prices in `D - 364 .. D` | The weekly report's liquidity screen (`>= 3`) |
| `obs_90d` | Price rows in `D - 89 .. D` | Coverage badge |
| `vol_weekly_52w` | Monday grid: for each of the 53 Mondays ending with the last Monday `<= D`, the newest daily price in the 7 days ending that Monday. Weekly log returns between consecutive grid Mondays. `stddev_samp * sqrt(52) * 100` | Needs 26 returns, else `NULL`. Not gated. Replaces the daily-gap volatility on new surfaces only |
| `units_sold_7d`, `units_sold_30d`, `tx_30d` | Sums of daily buckets in `D - 6 .. D` and `D - 29 .. D` | 0018 to 0021 rules: newest non-null bucket `>= D - 3` and no interior hole |
| `active_listings`, `qty_available`, `lowest_ask_usd` | Newest listings snapshot `<= D` | `NULL` when the snapshot is older than `D - 3` (0022) |
| `listings_snapshot_date` | Its date | Never nulled |
| `ask_premium_pct` | `(lowest_ask_usd / usd_price - 1) * 100` | Needs a fresh price and a fresh snapshot. Ask excludes shipping |
| `days_of_supply` | `qty_available / (units_sold_30d / 30)` | `NULL` when nothing sold (mirrors `getDaysOfSupply`) |
| `sell_through_30d` | `units_sold_30d / (units_sold_30d + qty_available) * 100` | `NULL` when both are 0 or either is missing |
| `qty_change_7d_pct`, `qty_change_30d_pct` | `(qty_available / qty_then - 1) * 100`, `qty_then` = newest snapshot in `[snap - 10, snap - 7]` or `[snap - 33, snap - 30]` | `NULL` when `qty_then` is missing or 0 |
| `liquidity_score` | `round(100 * mean(percent_rank))` of units sold 30D, transactions 30D, sell-through 30D and `-abs(ask_premium_pct)`, each ranked within the product type among products that have all four | Needs all four and at least 5 peers of the type, else `NULL` |
| `refreshed_at` | When the row was written | A row is final once `refreshed_at >= D + 1 day` |

### fx_daily

One row per UTC day from the first BoC date in `exchange_rates` through the refresh day: the newest BoC date on or before the day (among duplicate rows of one date, the newest `id`), carried forward at most 14 days. `source = 'boc'` when the day has its own rate, `'carry_forward'` otherwise; `source_date` is the BoC date used. A day more than 14 days after the newest rate gets no row, so CAD history is withheld rather than converted at a stale rate (the 0023 principle). Rates outside 0.5 to 3 are ignored.

### Read paths and performance

- `product_stats_latest` view: `WHERE day = (SELECT max(day) ...)` joined to active products. `max(day)` is a backward index-only scan of the primary key and the day's rows a primary-key range scan: one indexed query, about 306 rows. Measured on a production-size scratch dataset: 0.3 ms.
- Per-product history reads use `product_daily_stats_product_day_idx (product_id, day DESC)` (consumers add them).
- `getCachedProductStats()` and `getCachedFxDaily()` are `unstable_cache` reads with WP11's daily backstop, tagged `market-products` (and `exchange-rate` for FX), so the scrape hook refreshes them. Neither is called by a page in this package, so no route changes.
- `refresh_market_analytics(D)` took 0.4 to 0.6 s on 306 products x 600 days of prices, 90 days of sales, 85 days of listings (PostgreSQL 16, scratch). Budget: under 10 s (a CI test enforces it).
- Client bundle: `fx.ts` (about 0.6 kB gz) enters the shared bundle through `CurrencyProvider`. It imports nothing. No series data is added to the root layout: a page passes a sliced `FxDailySeries` to the client component that needs it.

### UI

None in this package. The only visible change is `/methodology` v1.1 (new sections `#tracked-high` with `#range-52w`, `#liquidity`, `#sell-through`, `#supply-trend`, `#ask-premium` under `#supply`, the updated `#returns`, `#volatility`, `#currency`, `#cadence`, `#limits`, and a change log row). It reuses WP24's `Section`, `Sub`, table classes and tokens, so layout at 390 px and 1440 px is WP24's.

## Before you start

Read:
- `01-PRODUCT-DIRECTION.md` §2, §5, §6.2, §8 (migration registry); `research/data-opportunities.md` §2, §3.1 to §3.5, §3.13, §3.14, §5, §7.
- `migrations/0018` to `0023` (gates this package mirrors), WP10's `migrations/0028_bounded_market_metrics.sql`, WP21's `migrations/0032_scraper_least_privilege_role.sql`, `scraper_db.py`, `scripts/db/replay_migrations.sh`, `scripts/db/ci_bootstrap.sql`, `tests/test_db_roles_integration.py`.
- `main.py` `run_jobs_once()` (WP11, as moved by WP16 and WP21), `revalidate_hook.py`.
- `frontend/app/lib/serverMarketData.ts` (WP11 block of cached exports), `frontend/app/lib/cacheTags.ts`, `frontend/app/context/CurrencyContext.tsx` and `frontend/app/lib/currency.ts` (WP20), `frontend/app/types/market.ts`, `frontend/app/content/methodology.ts`, `frontend/app/lib/metricDefinitions.ts`, `frontend/app/methodology/MethodologyArticle.tsx` and its test (WP24), `frontend/scripts/fixtures/perf.mjs` (WP22).

Confirm the starting state (repo root):

```bash
# Migration numbers: nothing may use 0033 to 0041 yet except this package's files
ls migrations | grep -E '^00(3[3-9]|4[01])_'          # expect no output

# WP10 landed and stayed behaviour-neutral on anchors
ls migrations/0027_* migrations/0028_* migrations/0029_*  # expect 3 files
grep -nE "recorded_at >= current_date - (14|37|104|379)" migrations/0028_bounded_market_metrics.sql
# expect no output (anchors unbounded). If this prints lines, WP10 adopted the tolerance: use the
# alternate #returns paragraph in step 14c.

# WP11
grep -n "exchangeRate\|marketProducts" frontend/app/lib/cacheTags.ts        # both tags
grep -n "DAILY_BACKSTOP_SECONDS = " frontend/app/lib/serverMarketData.ts    # 1 line
grep -n "^def run_jobs_once\|trigger_site_revalidation()" main.py           # 2 or more lines

# WP16
ls migrations/0030_*                                                        # 1 file

# WP20
ls frontend/app/context/CurrencyContext.tsx frontend/app/types/market.ts frontend/app/types/database.ts
grep -n '"types:db"' frontend/package.json                                 # 1 line
grep -n "createClient<Database>" frontend/app/lib/serverMarketData.ts      # 1 line

# WP21
ls migrations/0031_* migrations/0032_* migrations/0000_baseline.sql scripts/db/replay_migrations.sh scraper_db.py
grep -n "^pg_db = \|^supabase = " main.py                                  # 2 lines
grep -n "def clear_pending_price" scraper_db.py                            # 1 line

# WP22
ls frontend/perf-budgets.json frontend/scripts/fixtures/perf.mjs
grep -n '"/rest/v1/exchange_rates": rows("exchangeRates")' frontend/scripts/fixtures/perf.mjs  # 1 line

# WP24
grep -n 'METHODOLOGY_VERSION = "1.0"' frontend/app/content/methodology.ts   # 1 line
grep -n "export const METRIC_DEFINITIONS" frontend/app/lib/metricDefinitions.ts
ls frontend/app/methodology/MethodologyArticle.tsx frontend/app/methodology/__tests__/MethodologyArticle.test.tsx
```

If any dependency check fails, stop and report which package is missing; this package extends their files and must not recreate them. Two exceptions with a default:
- `grep -n "^pg_db = "` prints nothing (WP21's backend switch absent): pass `pg_db=None` in step 5 and keep the rest; the hook then uses the supabase-py RPC.
- `METHODOLOGY_VERSION` is already above `"1.0"` (another package bumped it): bump to the next minor version instead of `"1.1"` and keep every other instruction.

Tooling:
- Local Postgres for the database tests. Either Docker (`docker run -d --name pokefin-replay -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17`) or the PostgreSQL 16 binaries on the dev container (`/usr/lib/postgresql/16/bin`). The SQL in this spec was validated on PostgreSQL 16.13.
- A Python venv with `requirements.txt` plus `pytest` (WP21 added `psycopg[binary]`).

Baseline, from `frontend/`: `pnpm exec tsc --noEmit` (exit 0), `pnpm lint` (0 errors, WP17), `pnpm test --ci` (all pass). From the repo root: `python -m pytest tests/ -q` (all pass; the DB modules skip without `POKEFIN_TEST_DATABASE_URL`). Record the counts for the PR.

The work has two phases, like WP21. **Phase A** (steps 1 to 14 and 16) needs nothing from the owner; at its end open a draft PR titled `[waiting for DB types] ...` and hand the owner Owner actions 1 to 3. **Phase B** (step 15) regenerates `frontend/app/types/database.ts` once 0033 and 0034 are in production, then finishes the PR. `tsc` fails on the two new `.from(...)` reads until phase B; that is expected and the only allowed failure in phase A.

## Implementation steps

### Step 1. `migrations/0033_product_daily_stats.sql` (new)

Create the file with exactly this content. It was applied twice in a row to a Supabase-shaped scratch database without error, and every test in step "Tests" item 1 passed against it.

```sql
-- Migration: product_daily_stats, one precomputed analytics row per active
-- product per UTC day, and refresh_market_analytics(p_day), the function that
-- writes it (WP25; research/data-opportunities.md sections 3.1 and 5).
--
-- Why a table: 52-week ranges, the tracked high, weekly volatility, supply
-- trends and a liquidity percentile need window functions over the whole
-- price history. Computed per request they would run on every cache miss
-- under anon's 3 s statement_timeout (0009). Written once per scraper run and
-- once per night, every page read becomes one indexed read.
--
-- Gates (the same rules the RPCs apply; keep them in sync):
--   * Price-anchored columns (usd_price, ret_*, dd_from_high_pct,
--     pos_in_52w, ask_premium_pct and the liquidity score that reads it) are
--     NULL unless is_price_fresh: the newest price row on or before the day is
--     at most 14 days old, and, when that row is also the product's newest
--     row overall, products.usd_price agrees with it (0023).
--   * Series columns (tracked high, 52-week high and low, distinct prices,
--     observation count, weekly volatility) describe recorded history and are
--     not gated, as in 0023.
--   * Sales windows: the newest usable daily bucket is at most 3 days old and
--     the window has no interior hole (0018 to 0021).
--   * Listings: the newest snapshot is at most 3 days old (0022).
--     listings_snapshot_date and price_day are never nulled, so a reader can
--     say when data was last seen.
--
-- Return anchors have a maximum age, unlike get_market_product_metrics: the
-- newest price row on or before (day - window) and no older than
-- (day - window - tolerance). 7D and 1M: 7 days. 3M and 1Y: 14 days. 1D is the
-- change on the latest recorded day, when that day is the refresh day or the
-- day before and the previous recorded day is at most 3 days earlier.
--
-- Mirrored by frontend/app/lib/marketStats.ts (constants, drift-tested) and
-- documented on /methodology (version 1.1).
--
-- refresh_market_analytics is SECURITY DEFINER so its callers need no table
-- privileges: EXECUTE goes to pokefin_scraper (0032, the scraper) and
-- service_role only. It is idempotent: INSERT ... ON CONFLICT DO UPDATE.
-- 0034 replaces refresh_market_analytics to add the FX step; later packages
-- (WP28, WP29) replace it again to add theirs, keeping every earlier call.
--
-- Idempotent. Safe to re-run.
--
-- Verification:
--   SELECT public.refresh_market_analytics((now() AT TIME ZONE 'UTC')::date);
--   -- One row per active product for the newest day (expect equal counts):
--   SELECT (SELECT count(*) FROM public.product_stats_latest),
--          (SELECT count(*) FROM public.products WHERE active);
--   -- No price-anchored value without a fresh price (expect 0):
--   SELECT count(*) FROM public.product_daily_stats
--    WHERE NOT is_price_fresh
--      AND num_nonnulls(usd_price, ret_1d, ret_7d, ret_30d, ret_90d, ret_365d,
--                       dd_from_high_pct, pos_in_52w, ask_premium_pct,
--                       liquidity_score) > 0;
--   -- anon cannot run the refresh (expect false):
--   SELECT has_function_privilege('anon', 'public.refresh_market_analytics(date)', 'EXECUTE');

-- ============================================================
-- 1. Table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_daily_stats (
  day                    date NOT NULL,
  product_id             bigint NOT NULL
                         REFERENCES public.products(id) ON DELETE CASCADE,
  -- Price and freshness (0023)
  usd_price              double precision,
  price_day              date,
  is_price_fresh         boolean NOT NULL DEFAULT false,
  -- Returns in percent, gated
  ret_1d                 double precision,
  ret_7d                 double precision,
  ret_30d                double precision,
  ret_90d                double precision,
  ret_365d               double precision,
  -- Tracked high: max of the 3-row rolling minimum, whole history
  tracked_high_usd       double precision,
  tracked_high_day       date,
  first_tracked_day      date,
  dd_from_high_pct       double precision,
  -- 52-week range on the same robust series
  high_52w               double precision,
  low_52w                double precision,
  pos_in_52w             double precision,
  -- Coverage and weekly volatility
  distinct_prices_365d   integer,
  obs_90d                integer,
  vol_weekly_52w         double precision,
  -- Sales (0018 to 0021 rules)
  units_sold_7d          integer,
  units_sold_30d         integer,
  tx_30d                 integer,
  -- Listings (0022 gate)
  active_listings        integer,
  qty_available          integer,
  lowest_ask_usd         double precision,
  listings_snapshot_date date,
  -- Derived supply and liquidity
  ask_premium_pct        double precision,
  days_of_supply         double precision,
  sell_through_30d       double precision,
  qty_change_7d_pct      double precision,
  qty_change_30d_pct     double precision,
  liquidity_score        integer,
  refreshed_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_daily_stats_pkey PRIMARY KEY (day, product_id)
);

DO $$ BEGIN
  ALTER TABLE public.product_daily_stats
    ADD CONSTRAINT product_daily_stats_liquidity_score_range
      CHECK (liquidity_score IS NULL OR liquidity_score BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- Per-product history reads (and the FK), newest first.
CREATE INDEX IF NOT EXISTS product_daily_stats_product_day_idx
  ON public.product_daily_stats (product_id, day DESC);

-- ============================================================
-- 2. Access: public read, no API writes
-- ============================================================

ALTER TABLE public.product_daily_stats ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY product_daily_stats_read ON public.product_daily_stats
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Supabase's default privileges give anon and authenticated ALL on new
-- tables, TRUNCATE included, which RLS does not stop. Keep SELECT only.
REVOKE ALL ON TABLE public.product_daily_stats FROM anon, authenticated;
GRANT SELECT ON TABLE public.product_daily_stats TO anon, authenticated;

-- ============================================================
-- 3. The per-day computation (internal; called by the refresh below)
-- ============================================================

CREATE OR REPLACE FUNCTION public.refresh_product_daily_stats(p_day date)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  -- Rows of products that are no longer active leave the day.
  DELETE FROM public.product_daily_stats s
   WHERE s.day = p_day
     AND NOT EXISTS (SELECT 1 FROM public.products p
                      WHERE p.id = s.product_id AND p.active = true);

  WITH active AS (
    SELECT p.id, p.product_type_id, p.usd_price AS cached_usd
      FROM public.products p
     WHERE p.active = true
  ),
  -- Newest price row on or before the day, and whether a newer one exists.
  latest AS (
    SELECT a.id AS product_id, l.usd_price, l.day AS price_day,
           EXISTS (SELECT 1 FROM public.product_price_history n
                    WHERE n.product_id = a.id
                      AND n.recorded_at >= p_day + 1) AS has_newer
      FROM active a
      LEFT JOIN LATERAL (
        SELECT h.usd_price, h.recorded_at::date AS day
          FROM public.product_price_history h
         WHERE h.product_id = a.id
           AND h.recorded_at < p_day + 1
         ORDER BY h.recorded_at DESC
         LIMIT 1
      ) l ON true
  ),
  fresh AS (
    SELECT lt.product_id, lt.usd_price, lt.price_day,
           -- 14 = PRICE_STALENESS_TOLERANCE_DAYS (0023, marketPulse.ts).
           COALESCE(
             lt.price_day >= p_day - 14
             AND (lt.has_newer OR a.cached_usd IS NOT DISTINCT FROM lt.usd_price),
             false) AS is_price_fresh
      FROM latest lt
      JOIN active a ON a.id = lt.product_id
  ),
  -- 1D: previous recorded day, at most 3 days before the latest one.
  prev_day AS (
    SELECT f.product_id, pv.usd_price AS prev_usd
      FROM fresh f
      JOIN LATERAL (
        SELECT h.usd_price
          FROM public.product_price_history h
         WHERE h.product_id = f.product_id
           AND h.recorded_at <  f.price_day::timestamp
           AND h.recorded_at >= (f.price_day - 3)::timestamp
         ORDER BY h.recorded_at DESC
         LIMIT 1
      ) pv ON true
     WHERE f.price_day >= p_day - 1
  ),
  -- Return anchors: (label, window days, maximum anchor age in days).
  anchors AS (
    SELECT f.product_id, w.label, an.usd_price AS anchor_usd
      FROM fresh f
     CROSS JOIN (VALUES ('7d', 7, 7), ('30d', 30, 7), ('90d', 90, 14), ('365d', 365, 14))
           AS w(label, days, tolerance)
      JOIN LATERAL (
        SELECT h.usd_price
          FROM public.product_price_history h
         WHERE h.product_id = f.product_id
           AND h.recorded_at <  (p_day - w.days + 1)::timestamp
           AND h.recorded_at >= (p_day - w.days - w.tolerance)::timestamp
         ORDER BY h.recorded_at DESC
         LIMIT 1
      ) an ON true
  ),
  returns AS (
    SELECT product_id,
           max(anchor_usd) FILTER (WHERE label = '7d')   AS a7,
           max(anchor_usd) FILTER (WHERE label = '30d')  AS a30,
           max(anchor_usd) FILTER (WHERE label = '90d')  AS a90,
           max(anchor_usd) FILTER (WHERE label = '365d') AS a365
      FROM anchors
     GROUP BY product_id
  ),
  -- One price per product per day, whole history up to the day.
  px AS (
    SELECT DISTINCT ON (h.product_id, h.recorded_at::date)
           h.product_id, h.recorded_at::date AS day, h.usd_price
      FROM public.product_price_history h
      JOIN active a ON a.id = h.product_id
     WHERE h.recorded_at < p_day + 1
     ORDER BY h.product_id, h.recorded_at::date, h.recorded_at DESC
  ),
  -- 3-row rolling min and max: one print cannot set a high or a low.
  roll AS (
    SELECT px.product_id, px.day, px.usd_price,
           min(px.usd_price) OVER w3 AS min3,
           max(px.usd_price) OVER w3 AS max3,
           count(*)          OVER w3 AS n3
      FROM px
    WINDOW w3 AS (PARTITION BY px.product_id ORDER BY px.day
                  ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)
  ),
  series AS (
    SELECT r.product_id,
           min(r.day) AS first_tracked_day,
           max(r.min3) FILTER (WHERE r.n3 = 3) AS tracked_high_usd,
           (array_agg(r.day ORDER BY r.min3 DESC, r.day DESC)
              FILTER (WHERE r.n3 = 3))[1] AS tracked_high_day,
           max(r.min3) FILTER (WHERE r.n3 = 3 AND r.day >= p_day - 364) AS high_52w,
           min(r.max3) FILTER (WHERE r.n3 = 3 AND r.day >= p_day - 364) AS low_52w,
           count(DISTINCT r.usd_price) FILTER (WHERE r.day >= p_day - 364) AS distinct_prices_365d,
           count(*) FILTER (WHERE r.day >= p_day - 89) AS obs_90d
      FROM roll r
     GROUP BY r.product_id
  ),
  -- Weekly grid: the newest daily price in the 7 days ending each Monday,
  -- for the 53 Mondays ending with the last Monday on or before the day.
  weekly AS (
    SELECT DISTINCT ON (px.product_id, wk.monday)
           px.product_id, wk.monday, px.usd_price
      FROM px
     CROSS JOIN LATERAL (
       SELECT px.day + ((8 - extract(isodow FROM px.day)::int) % 7) AS monday
     ) wk
     WHERE wk.monday >  date_trunc('week', p_day)::date - 371
       AND wk.monday <= date_trunc('week', p_day)::date
     ORDER BY px.product_id, wk.monday, px.day DESC
  ),
  weekly_ret AS (
    SELECT w.product_id,
           CASE WHEN w.monday - lag(w.monday) OVER wp = 7
                THEN ln(w.usd_price / lag(w.usd_price) OVER wp) END AS r
      FROM weekly w
    WINDOW wp AS (PARTITION BY w.product_id ORDER BY w.monday)
  ),
  vol AS (
    SELECT product_id,
           -- 26 = VOL_WEEKLY_MIN_RETURNS, 52 = WEEKS_PER_YEAR (marketStats.ts).
           CASE WHEN count(r) >= 26 THEN stddev_samp(r) * sqrt(52) * 100 END AS vol_weekly_52w
      FROM weekly_ret
     GROUP BY product_id
  ),
  -- Daily sales buckets in the 30-day window ending on the day (0021 rules).
  sales AS (
    SELECT sh.product_id,
           max(sh.bucket_date) FILTER (WHERE sh.quantity_sold IS NOT NULL) AS newest_day,
           sum(sh.quantity_sold) FILTER (WHERE sh.bucket_date >= p_day - 6) AS u7,
           count(*) FILTER (WHERE sh.quantity_sold IS NOT NULL
                              AND sh.bucket_date >= p_day - 6) AS n7,
           (max(sh.bucket_date) FILTER (WHERE sh.quantity_sold IS NOT NULL
                                          AND sh.bucket_date >= p_day - 6)
            - min(sh.bucket_date) FILTER (WHERE sh.quantity_sold IS NOT NULL
                                            AND sh.bucket_date >= p_day - 6) + 1) AS span7,
           sum(sh.quantity_sold) AS u30,
           count(*) FILTER (WHERE sh.quantity_sold IS NOT NULL) AS n30,
           (max(sh.bucket_date) FILTER (WHERE sh.quantity_sold IS NOT NULL)
            - min(sh.bucket_date) FILTER (WHERE sh.quantity_sold IS NOT NULL) + 1) AS span30,
           sum(sh.transaction_count) AS tx30
      FROM public.product_sales_history sh
      JOIN active a ON a.id = sh.product_id
     WHERE sh.granularity = 'day'
       AND sh.bucket_date BETWEEN p_day - 29 AND p_day
     GROUP BY sh.product_id
  ),
  -- Newest listings snapshot on or before the day, and the snapshots 7 and
  -- 30 days before it (3 days of tolerance, the 0022 gate).
  listings AS (
    SELECT a.id AS product_id, cur.snapshot_date,
           CASE WHEN cur.snapshot_date >= p_day - 3 THEN cur.active_listings END AS active_listings,
           CASE WHEN cur.snapshot_date >= p_day - 3 THEN cur.total_quantity_available END AS qty,
           CASE WHEN cur.snapshot_date >= p_day - 3 THEN cur.lowest_listing_price END AS lowest_ask,
           q7.total_quantity_available AS qty_7d_ago,
           q30.total_quantity_available AS qty_30d_ago
      FROM active a
      LEFT JOIN LATERAL (
        SELECT l.snapshot_date, l.active_listings, l.total_quantity_available,
               l.lowest_listing_price
          FROM public.product_listings_history l
         WHERE l.product_id = a.id AND l.snapshot_date <= p_day
         ORDER BY l.snapshot_date DESC
         LIMIT 1
      ) cur ON true
      LEFT JOIN LATERAL (
        SELECT l.total_quantity_available
          FROM public.product_listings_history l
         WHERE l.product_id = a.id
           AND l.snapshot_date BETWEEN cur.snapshot_date - 10 AND cur.snapshot_date - 7
         ORDER BY l.snapshot_date DESC
         LIMIT 1
      ) q7 ON true
      LEFT JOIN LATERAL (
        SELECT l.total_quantity_available
          FROM public.product_listings_history l
         WHERE l.product_id = a.id
           AND l.snapshot_date BETWEEN cur.snapshot_date - 33 AND cur.snapshot_date - 30
         ORDER BY l.snapshot_date DESC
         LIMIT 1
      ) q30 ON true
  ),
  base AS (
    SELECT a.id AS product_id,
           a.product_type_id,
           f.is_price_fresh,
           f.price_day,
           CASE WHEN f.is_price_fresh THEN f.usd_price END AS usd_price,
           CASE WHEN f.is_price_fresh AND pd.prev_usd > 0
                THEN (f.usd_price / pd.prev_usd - 1) * 100 END AS ret_1d,
           CASE WHEN f.is_price_fresh AND r.a7 > 0   THEN (f.usd_price / r.a7   - 1) * 100 END AS ret_7d,
           CASE WHEN f.is_price_fresh AND r.a30 > 0  THEN (f.usd_price / r.a30  - 1) * 100 END AS ret_30d,
           CASE WHEN f.is_price_fresh AND r.a90 > 0  THEN (f.usd_price / r.a90  - 1) * 100 END AS ret_90d,
           CASE WHEN f.is_price_fresh AND r.a365 > 0 THEN (f.usd_price / r.a365 - 1) * 100 END AS ret_365d,
           s.tracked_high_usd,
           s.tracked_high_day,
           s.first_tracked_day,
           CASE WHEN f.is_price_fresh AND s.tracked_high_usd > 0
                THEN (f.usd_price / s.tracked_high_usd - 1) * 100 END AS dd_from_high_pct,
           s.high_52w,
           s.low_52w,
           CASE WHEN f.is_price_fresh AND s.high_52w > s.low_52w
                THEN greatest(0, least(100,
                       (f.usd_price - s.low_52w) / (s.high_52w - s.low_52w) * 100)) END AS pos_in_52w,
           s.distinct_prices_365d::integer AS distinct_prices_365d,
           COALESCE(s.obs_90d, 0)::integer AS obs_90d,
           v.vol_weekly_52w,
           -- 3 = DAILY_DATA_STALENESS_TOLERANCE_DAYS (0018, marketPulse.ts).
           CASE WHEN sa.newest_day >= p_day - 3 AND sa.n7 > 0 AND sa.n7 = sa.span7
                THEN sa.u7 END::integer AS units_sold_7d,
           CASE WHEN sa.newest_day >= p_day - 3 AND sa.n30 > 0 AND sa.n30 = sa.span30
                THEN sa.u30 END::integer AS units_sold_30d,
           CASE WHEN sa.newest_day >= p_day - 3 AND sa.n30 > 0 AND sa.n30 = sa.span30
                THEN sa.tx30 END::integer AS tx_30d,
           li.active_listings,
           li.qty AS qty_available,
           li.lowest_ask AS lowest_ask_usd,
           li.snapshot_date AS listings_snapshot_date,
           li.qty_7d_ago,
           li.qty_30d_ago
      FROM active a
      JOIN fresh f ON f.product_id = a.id
      LEFT JOIN prev_day pd ON pd.product_id = a.id
      LEFT JOIN returns r ON r.product_id = a.id
      LEFT JOIN series s ON s.product_id = a.id
      LEFT JOIN vol v ON v.product_id = a.id
      LEFT JOIN sales sa ON sa.product_id = a.id
      LEFT JOIN listings li ON li.product_id = a.id
  ),
  derived AS (
    SELECT b.*,
           CASE WHEN b.usd_price > 0 AND b.lowest_ask_usd > 0
                THEN (b.lowest_ask_usd / b.usd_price - 1) * 100 END AS ask_premium_pct,
           CASE WHEN b.qty_available IS NOT NULL AND b.units_sold_30d > 0
                THEN b.qty_available / (b.units_sold_30d / 30.0) END AS days_of_supply,
           CASE WHEN b.qty_available IS NOT NULL AND b.units_sold_30d IS NOT NULL
                 AND b.units_sold_30d + b.qty_available > 0
                THEN b.units_sold_30d::double precision
                     / (b.units_sold_30d + b.qty_available) * 100 END AS sell_through_30d,
           CASE WHEN b.qty_available IS NOT NULL AND b.qty_7d_ago > 0
                THEN (b.qty_available::double precision / b.qty_7d_ago - 1) * 100 END AS qty_change_7d_pct,
           CASE WHEN b.qty_available IS NOT NULL AND b.qty_30d_ago > 0
                THEN (b.qty_available::double precision / b.qty_30d_ago - 1) * 100 END AS qty_change_30d_pct
      FROM base b
  ),
  -- Liquidity: mean percentile, within the product type, of four components.
  -- Only products with all four and a product type take part.
  eligible AS (
    SELECT d.*,
           (d.product_type_id IS NOT NULL AND d.units_sold_30d IS NOT NULL
            AND d.tx_30d IS NOT NULL AND d.sell_through_30d IS NOT NULL
            AND d.ask_premium_pct IS NOT NULL) AS liquidity_ok
      FROM derived d
  ),
  scored AS (
    SELECT e.*,
           CASE WHEN e.liquidity_ok
                 -- 5 = LIQUIDITY_MIN_PEERS (marketStats.ts).
                 AND count(*) OVER peers >= 5
                THEN round(100 * (
                       percent_rank() OVER (PARTITION BY e.liquidity_ok, e.product_type_id ORDER BY e.units_sold_30d)
                     + percent_rank() OVER (PARTITION BY e.liquidity_ok, e.product_type_id ORDER BY e.tx_30d)
                     + percent_rank() OVER (PARTITION BY e.liquidity_ok, e.product_type_id ORDER BY e.sell_through_30d)
                     + percent_rank() OVER (PARTITION BY e.liquidity_ok, e.product_type_id ORDER BY -abs(e.ask_premium_pct))
                   ) / 4)::integer END AS liquidity_score
      FROM eligible e
    WINDOW peers AS (PARTITION BY e.liquidity_ok, e.product_type_id)
  )
  INSERT INTO public.product_daily_stats AS t (
    day, product_id, usd_price, price_day, is_price_fresh,
    ret_1d, ret_7d, ret_30d, ret_90d, ret_365d,
    tracked_high_usd, tracked_high_day, first_tracked_day, dd_from_high_pct,
    high_52w, low_52w, pos_in_52w,
    distinct_prices_365d, obs_90d, vol_weekly_52w,
    units_sold_7d, units_sold_30d, tx_30d,
    active_listings, qty_available, lowest_ask_usd, listings_snapshot_date,
    ask_premium_pct, days_of_supply, sell_through_30d,
    qty_change_7d_pct, qty_change_30d_pct, liquidity_score, refreshed_at
  )
  SELECT p_day, sc.product_id, sc.usd_price, sc.price_day, sc.is_price_fresh,
         sc.ret_1d, sc.ret_7d, sc.ret_30d, sc.ret_90d, sc.ret_365d,
         sc.tracked_high_usd, sc.tracked_high_day, sc.first_tracked_day, sc.dd_from_high_pct,
         sc.high_52w, sc.low_52w, sc.pos_in_52w,
         sc.distinct_prices_365d, sc.obs_90d, sc.vol_weekly_52w,
         sc.units_sold_7d, sc.units_sold_30d, sc.tx_30d,
         sc.active_listings, sc.qty_available, sc.lowest_ask_usd, sc.listings_snapshot_date,
         sc.ask_premium_pct, sc.days_of_supply, sc.sell_through_30d,
         sc.qty_change_7d_pct, sc.qty_change_30d_pct, sc.liquidity_score, now()
    FROM scored sc
  ON CONFLICT (day, product_id) DO UPDATE SET
    usd_price = EXCLUDED.usd_price,
    price_day = EXCLUDED.price_day,
    is_price_fresh = EXCLUDED.is_price_fresh,
    ret_1d = EXCLUDED.ret_1d,
    ret_7d = EXCLUDED.ret_7d,
    ret_30d = EXCLUDED.ret_30d,
    ret_90d = EXCLUDED.ret_90d,
    ret_365d = EXCLUDED.ret_365d,
    tracked_high_usd = EXCLUDED.tracked_high_usd,
    tracked_high_day = EXCLUDED.tracked_high_day,
    first_tracked_day = EXCLUDED.first_tracked_day,
    dd_from_high_pct = EXCLUDED.dd_from_high_pct,
    high_52w = EXCLUDED.high_52w,
    low_52w = EXCLUDED.low_52w,
    pos_in_52w = EXCLUDED.pos_in_52w,
    distinct_prices_365d = EXCLUDED.distinct_prices_365d,
    obs_90d = EXCLUDED.obs_90d,
    vol_weekly_52w = EXCLUDED.vol_weekly_52w,
    units_sold_7d = EXCLUDED.units_sold_7d,
    units_sold_30d = EXCLUDED.units_sold_30d,
    tx_30d = EXCLUDED.tx_30d,
    active_listings = EXCLUDED.active_listings,
    qty_available = EXCLUDED.qty_available,
    lowest_ask_usd = EXCLUDED.lowest_ask_usd,
    listings_snapshot_date = EXCLUDED.listings_snapshot_date,
    ask_premium_pct = EXCLUDED.ask_premium_pct,
    days_of_supply = EXCLUDED.days_of_supply,
    sell_through_30d = EXCLUDED.sell_through_30d,
    qty_change_7d_pct = EXCLUDED.qty_change_7d_pct,
    qty_change_30d_pct = EXCLUDED.qty_change_30d_pct,
    liquidity_score = EXCLUDED.liquidity_score,
    refreshed_at = EXCLUDED.refreshed_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_product_daily_stats(date) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 4. The entry point the scraper and pg_cron call
-- ============================================================

CREATE OR REPLACE FUNCTION public.refresh_market_analytics(p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_stats integer;
BEGIN
  IF p_day IS NULL OR p_day > v_today OR p_day < DATE '2020-01-01' THEN
    RAISE EXCEPTION 'refresh_market_analytics: p_day must be between 2020-01-01 and % (UTC), got %',
      v_today, p_day USING ERRCODE = '22023';
  END IF;

  -- One refresh at a time (the scraper and the nightly job can overlap).
  PERFORM pg_advisory_xact_lock(hashtext('pokefin.refresh_market_analytics'));

  v_stats := public.refresh_product_daily_stats(p_day);

  RETURN jsonb_build_object(
    'day', p_day,
    'product_rows', v_stats,
    'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_market_analytics(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_market_analytics(date) TO service_role, pokefin_scraper;

-- ============================================================
-- 5. Latest row per active product (server reads)
-- ============================================================

-- The refresh writes a row for every active product on each day it runs, so
-- the newest day holds the latest row of every active product. max(day) is
-- read from the primary key and the day's rows by a primary-key range scan:
-- one indexed query, about 306 rows.
CREATE OR REPLACE VIEW public.product_stats_latest
WITH (security_invoker = true)
AS
SELECT s.*
  FROM public.product_daily_stats s
  JOIN public.products p ON p.id = s.product_id AND p.active = true
 WHERE s.day = (SELECT max(d.day) FROM public.product_daily_stats d);

REVOKE ALL ON TABLE public.product_stats_latest FROM anon, authenticated;
GRANT SELECT ON TABLE public.product_stats_latest TO anon, authenticated;
```

Check it (repo root):

```bash
python3 verify_migration.py migrations/0033_product_daily_stats.sql > /tmp/wp25_0033.sql; echo "exit=$?"
# expect exit=3 and on stderr:
#   -- function refresh_product_daily_stats(p_day date): body <md5>, non-strict, parallel u, security invoker, plpgsql, volatility v, config search_path=public,pg_temp
#   -- function refresh_market_analytics(p_day date): body <md5>, non-strict, parallel u, security definer, plpgsql, volatility v, config search_path=public,pg_temp
#   -- index product_daily_stats_product_day_idx on product_daily_stats: using btree product_id,day desc
#   36 "-- privilege" lines: INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER revoked and SELECT granted
#     for anon and authenticated on product_daily_stats and on product_stats_latest; EXECUTE revoked
#     for public, anon, authenticated on both functions; EXECUTE granted to service_role and
#     pokefin_scraper on refresh_market_analytics(date)
#   -- rls public.product_daily_stats: enabled
#   -- NOT VERIFIED (out of scope, check by hand): 1 x CREATE (table/type/etc), 1 x CREATE VIEW, 2 x DO block
```

With the file copied verbatim the two body hashes are `b519a333d1786c3c25775e3eda136435` and `d3390e5adcfa952e1ccc639046e7c52f`. Any edit changes them, which is fine: what matters is that the generated query returns OK rows after apply.

### Step 2. `migrations/0034_fx_daily.sql` (new)

This file also replaces `refresh_market_analytics` so it runs the FX step before the stats step, and schedules the nightly job. Create it with exactly this content:

```sql
-- Migration: fx_daily, one Bank of Canada USD to CAD rate per UTC day, and
-- the FX step of refresh_market_analytics (WP25; research/
-- data-opportunities.md section 3.14).
--
-- exchange_rates gets one insert per scraper run (about six rows per rate
-- date) and none on weekends or Canadian bank holidays, so it cannot be
-- joined by day. fx_daily holds exactly one row per day: the rate of the
-- newest Bank of Canada date on or before that day (the newest inserted row
-- of that date), carried forward for at most 14 days. source says whether
-- the day had its own rate ('boc') or carries an earlier one
-- ('carry_forward'); source_date is the Bank of Canada date used. A day more
-- than 14 days after the newest rate gets no row: CAD history is withheld
-- rather than converted at a stale rate (the 0023 principle).
--
-- Written by refresh_fx_daily(p_through), which refresh_market_analytics
-- calls; this file replaces refresh_market_analytics (0033) to add that step.
-- Mirrored by frontend/app/lib/fx.ts (FX_CARRY_MAX_DAYS, drift-tested).
--
-- Also schedules the nightly job that finalises the previous UTC day at
-- 00:30 UTC, when pg_cron is enabled; otherwise it prints the statement to
-- run once the owner enables it. The job keeps D-1 complete even when the
-- scraper host is off.
--
-- Idempotent. Safe to re-run.
--
-- Verification:
--   SELECT public.refresh_market_analytics((now() AT TIME ZONE 'UTC')::date);
--   -- No gap between the first and the last day (expect true):
--   SELECT max(day) - min(day) + 1 = count(*) FROM public.fx_daily;
--   -- Weekends carry Friday's rate (expect 0):
--   SELECT count(*) FROM public.fx_daily
--    WHERE extract(isodow FROM day) IN (6, 7) AND source = 'boc';
--   -- Every row's rate is its source date's rate (expect 0):
--   SELECT count(*) FROM public.fx_daily f
--     JOIN public.fx_daily s ON s.day = f.source_date
--    WHERE f.usd_to_cad IS DISTINCT FROM s.usd_to_cad;
--   -- With pg_cron enabled, one job (expect 1 row, 30 0 * * *):
--   SELECT jobname, schedule, active FROM cron.job
--    WHERE jobname = 'pokefin-finalise-market-analytics';

-- ============================================================
-- 1. Table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.fx_daily (
  day          date PRIMARY KEY,
  usd_to_cad   double precision NOT NULL,
  source_date  date NOT NULL,
  source       text NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.fx_daily
    ADD CONSTRAINT fx_daily_source_valid
      CHECK (source IN ('boc', 'carry_forward'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.fx_daily
    ADD CONSTRAINT fx_daily_rate_sane
      CHECK (usd_to_cad > 0.5 AND usd_to_cad < 3);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.fx_daily
    ADD CONSTRAINT fx_daily_source_date_sane
      CHECK (source_date <= day AND day - source_date <= 14);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

ALTER TABLE public.fx_daily ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY fx_daily_read ON public.fx_daily
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

REVOKE ALL ON TABLE public.fx_daily FROM anon, authenticated;
GRANT SELECT ON TABLE public.fx_daily TO anon, authenticated;

-- ============================================================
-- 2. Fill (internal; called by refresh_market_analytics)
-- ============================================================

CREATE OR REPLACE FUNCTION public.refresh_fx_daily(p_through date)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  WITH obs AS (
    -- One rate per Bank of Canada date: the newest row inserted for it.
    SELECT DISTINCT ON (e.recorded_at::date)
           e.recorded_at::date AS obs_day, e.usd_to_cad
      FROM public.exchange_rates e
     WHERE e.recorded_at IS NOT NULL
       AND e.recorded_at < p_through + 1
       AND e.usd_to_cad > 0.5 AND e.usd_to_cad < 3
     ORDER BY e.recorded_at::date, e.id DESC
  ),
  bounds AS (
    SELECT min(obs_day) AS first_day FROM obs
  ),
  days AS (
    -- Integer series: generate_series(date, date, interval) yields
    -- timestamptz and depends on the session time zone.
    SELECT b.first_day + g.i AS day
      FROM bounds b
     CROSS JOIN LATERAL generate_series(0, p_through - b.first_day) AS g(i)
     WHERE b.first_day IS NOT NULL
  ),
  marked AS (
    SELECT d.day, max(o.obs_day) OVER (ORDER BY d.day) AS source_date
      FROM days d
      LEFT JOIN obs o ON o.obs_day = d.day
  )
  INSERT INTO public.fx_daily AS f (day, usd_to_cad, source_date, source, refreshed_at)
  SELECT m.day, o.usd_to_cad, m.source_date,
         CASE WHEN m.source_date = m.day THEN 'boc' ELSE 'carry_forward' END,
         now()
    FROM marked m
    JOIN obs o ON o.obs_day = m.source_date
   -- 14 = FX_CARRY_MAX_DAYS (fx.ts).
   WHERE m.day - m.source_date <= 14
  ON CONFLICT (day) DO UPDATE SET
    usd_to_cad = EXCLUDED.usd_to_cad,
    source_date = EXCLUDED.source_date,
    source = EXCLUDED.source,
    refreshed_at = EXCLUDED.refreshed_at
  WHERE (f.usd_to_cad, f.source_date, f.source)
        IS DISTINCT FROM (EXCLUDED.usd_to_cad, EXCLUDED.source_date, EXCLUDED.source);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_fx_daily(date) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3. refresh_market_analytics with the FX step (replaces 0033's body)
-- ============================================================

CREATE OR REPLACE FUNCTION public.refresh_market_analytics(p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_fx integer;
  v_stats integer;
BEGIN
  IF p_day IS NULL OR p_day > v_today OR p_day < DATE '2020-01-01' THEN
    RAISE EXCEPTION 'refresh_market_analytics: p_day must be between 2020-01-01 and % (UTC), got %',
      v_today, p_day USING ERRCODE = '22023';
  END IF;

  -- One refresh at a time (the scraper and the nightly job can overlap).
  PERFORM pg_advisory_xact_lock(hashtext('pokefin.refresh_market_analytics'));

  v_fx := public.refresh_fx_daily(p_day);
  v_stats := public.refresh_product_daily_stats(p_day);

  RETURN jsonb_build_object(
    'day', p_day,
    'fx_rows', v_fx,
    'product_rows', v_stats,
    'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_market_analytics(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_market_analytics(date) TO service_role, pokefin_scraper;

-- ============================================================
-- 4. Nightly finalisation of D-1 (pg_cron, when the owner has enabled it)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- cron.schedule upserts by job name (pg_cron 1.4+), so re-running this
    -- migration keeps one job. The job runs as the migration's role.
    PERFORM cron.schedule(
      'pokefin-finalise-market-analytics',
      '30 0 * * *',
      $cmd$SELECT public.refresh_market_analytics((now() AT TIME ZONE 'UTC')::date - 1)$cmd$
    );
    RAISE NOTICE 'pg_cron job pokefin-finalise-market-analytics scheduled at 00:30 UTC';
  ELSE
    RAISE NOTICE 'pg_cron is not enabled. After enabling it (Dashboard > Database > Extensions), run: SELECT cron.schedule(''pokefin-finalise-market-analytics'', ''30 0 * * *'', $cmd$SELECT public.refresh_market_analytics((now() AT TIME ZONE ''UTC'')::date - 1)$cmd$);';
  END IF;
END $$;
```

Check it:

```bash
python3 verify_migration.py migrations/0034_fx_daily.sql > /tmp/wp25_0034.sql; echo "exit=$?"
# expect exit=3 and on stderr: 2 function lines (refresh_fx_daily: security invoker; refresh_market_analytics:
# security definer, body f3b51f9acfca12f5ed2a97afe5f6d263 when copied verbatim), 22 privilege lines,
# "-- rls public.fx_daily: enabled", and
#   -- NOT VERIFIED (out of scope, check by hand): 1 x CREATE (table/type/etc), 5 x DO block
```

After both are applied, the 0033 query reports one `MISMATCH` (`refresh_market_analytics`, body): 0034 superseded it. That is the expected cross-file result (`verify_migration.py` docstring, "Across files the rule does not apply"). Every other row of both queries says OK (39 for 0033, 25 for 0034).

Replay locally (WP21 harness):

```bash
PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh
# expect "OK: <N> files replayed once (replay_once) and twice (replay_twice)", N two more than before,
# and the NOTICE "pg_cron is not enabled. ..." printed three times (once for replay_once, twice for replay_twice).
```

`scripts/db/replay_migrations.sh` needs no edit: it picks up `NNNN_*.sql` files by name.

### Step 3. `scraper_db.py`: two methods for the scraper role

3a. Change the import line `from datetime import datetime, timezone` to `from datetime import date, datetime, timezone`.

3b. Add these two methods to `class ScraperDB`, directly after `clear_pending_price` (same indentation as the other methods):

```python
    def refresh_market_analytics(self, day: date) -> dict:
        """
        public.refresh_market_analytics(day) (migrations 0033/0034). EXECUTE is
        granted to pokefin_scraper; the function is SECURITY DEFINER, so the
        role needs no privilege on the analytics tables. Returns the function's
        summary: {"day", "fx_rows", "product_rows", "ms"}.
        """
        rows = self._execute(
            "SELECT public.refresh_market_analytics(%s::date) AS result",
            (day.isoformat(),),
            fetch=True,
        )
        return (rows[0]["result"] if rows else None) or {}

    def insert_missing_exchange_rates(self, observations) -> int:
        """
        Insert (date, usd_to_cad) pairs whose date has no exchange_rates row yet,
        stored like the scraper's rows (recorded_at = the date at 00:00). One
        statement per call. Returns the number of rows inserted.
        """
        payload = [{"day": d.isoformat(), "rate": float(r)} for d, r in observations]
        if not payload:
            return 0
        rows = self._execute(
            "INSERT INTO public.exchange_rates (usd_to_cad, recorded_at) "
            "SELECT r.rate, r.day::timestamp "
            "  FROM jsonb_to_recordset(%s) AS r(day date, rate double precision) "
            " WHERE NOT EXISTS (SELECT 1 FROM public.exchange_rates e "
            "                    WHERE e.recorded_at >= r.day::timestamp "
            "                      AND e.recorded_at <  (r.day + 1)::timestamp) "
            "RETURNING 1 AS inserted",
            (Jsonb(payload),),
            fetch=True,
        )
        return len(rows or [])
```

`_execute` retries once on `OperationalError` (including a statement timeout); both statements are idempotent, so a retry is safe. `Jsonb` is already imported by WP21's file.

### Step 4. `market_analytics.py` (new, repo root)

Next to `revalidate_hook.py`. It imports neither `main` nor Selenium, so its tests need neither.

```python
"""
Refresh Pokéfin's precomputed market analytics (WP25).

public.refresh_market_analytics(p_day) (migrations 0033 and 0034) rewrites
fx_daily through p_day and every active product's product_daily_stats row for
p_day. main.run_jobs_once calls refresh_after_run() after each successful
scraper run, before the site revalidation hook, so the pages it refreshes
read the new rows. pg_cron finalises the previous UTC day at 00:30 UTC.

Two backends, matching main.py's (WP21):
  pg_db     scraper_db.ScraperDB connected as pokefin_scraper (EXECUTE granted
            by 0033/0034). Used when POKEFIN_DB_BACKEND=postgres.
  supabase  supabase-py with the service key: PostgREST RPC. The default
            until the owner cuts the scraper over.

This module imports neither main nor Selenium, so its tests need neither.
"""

from __future__ import annotations

import logging
import os
from datetime import date, datetime, timezone

logger = logging.getLogger(__name__)

RPC_NAME = "refresh_market_analytics"


def utc_today() -> date:
    return datetime.now(timezone.utc).date()


def call_refresh(day: date, *, pg_db=None, supabase=None) -> dict:
    """
    Run public.refresh_market_analytics(day) once and return its summary
    ({"day", "fx_rows", "product_rows", "ms"}). Raises on any failure.
    """
    if pg_db is not None:
        return pg_db.refresh_market_analytics(day) or {}
    if supabase is not None:
        response = supabase.rpc(RPC_NAME, {"p_day": day.isoformat()}).execute()
        return response.data or {}
    raise RuntimeError("no database client: pass pg_db or supabase")


def _is_missing_function(error: Exception) -> bool:
    text = str(error)
    return RPC_NAME in text and (
        "does not exist" in text or "PGRST202" in text or "Could not find the function" in text
    )


def refresh_after_run(day: date | None = None, *, pg_db=None, supabase=None) -> dict | None:
    """
    call_refresh for main.run_jobs_once. Returns the summary, or None when it
    failed. Never raises: the scrape already succeeded, and pg_cron or the
    next run catches up.
    """
    day = day or utc_today()
    try:
        result = call_refresh(day, pg_db=pg_db, supabase=supabase)
        logger.info(f"Market analytics refreshed for {day}: {result}")
        return result
    except Exception as e:  # noqa: BLE001 - analytics must never fail the run
        if _is_missing_function(e):
            logger.warning(
                "Market analytics refresh skipped: public.refresh_market_analytics does not "
                "exist yet (apply migrations 0033 and 0034)."
            )
        else:
            logger.error(f"Market analytics refresh failed for {day}: {type(e).__name__}: {e}")
        return None


def open_admin_clients():
    """
    (pg_db, supabase) for the one-off backfill scripts. Connects as
    pokefin_scraper when POKEFIN_SCRAPER_DATABASE_URL is set; otherwise uses
    supabase-py with the service key, like the other backfill scripts.
    """
    dsn = (os.environ.get("POKEFIN_SCRAPER_DATABASE_URL") or "").strip()
    if dsn:
        from scraper_db import ScraperDB

        return ScraperDB(dsn), None
    from secrets_loader import load_supabase_credentials
    from supabase import create_client

    url, key = load_supabase_credentials()
    return None, create_client(url, key)
```

### Step 5. `main.py`: refresh after a successful run, before the revalidation hook

5a. Imports: directly below the line `from revalidate_hook import should_revalidate_site, trigger_site_revalidation` add:

```python
from market_analytics import refresh_after_run
```

5b. In `run_jobs_once()`, between the `update_prices` `try`/`except` block and the `if should_revalidate_site(...)` line, insert:

```python
    # WP25: today's product_daily_stats and fx_daily rows, written before the
    # site is told to refresh so the pages it regenerates read them. Runs
    # after every successful update_prices, even one that updated nothing,
    # so the first run after midnight UTC creates the new day. Never raises.
    if prices_ok:
        refresh_after_run(pg_db=pg_db, supabase=supabase)
```

Leave everything else in `run_jobs_once()` as it is, including the revalidation condition: a failed refresh still revalidates (prices changed), and pg_cron or the next run catches the analytics up. If WP21's `pg_db` global does not exist (see Before you start), write `refresh_after_run(pg_db=None, supabase=supabase)`.

5c. No new environment variable: the hook uses whichever client `main.py` already built.

### Step 6. `scripts/backfill_fx_valet.py` (new)

`scripts/` exists after WP21 (it holds `scripts/db/`). The script puts the repo root on `sys.path` so it can import `market_analytics`, `scraper_db` and `secrets_loader` when run as `python scripts/backfill_fx_valet.py`. `chmod +x` it.

```python
#!/usr/bin/env python3
"""
Backfill exchange_rates with Bank of Canada USD to CAD rates from the Valet
API (series FXUSDCAD), for every business day in a range that has no row yet
(WP25).

exchange_rates starts at the scraper's first run, so without this backfill
fx_daily (migration 0034) has no rate for older price history or for older
portfolio purchase dates, and CAD history before that day is withheld. The
Valet API is free, needs no key, and returns the same daily rate the
scraper reads from the Bank of Canada's HTML table.

Idempotent: a date that already has any exchange_rates row is skipped, so a
re-run inserts nothing. Rows are stored like the scraper's
(recorded_at = the rate date at 00:00).

  python scripts/backfill_fx_valet.py                     # 2020-01-01 to today (UTC)
  python scripts/backfill_fx_valet.py --start 2024-06-01 --end 2025-01-31
  python scripts/backfill_fx_valet.py --dry-run           # fetch and count, write nothing

Connects as pokefin_scraper when POKEFIN_SCRAPER_DATABASE_URL is set (it has
SELECT and INSERT on exchange_rates, 0032), otherwise with the service key.
Run scripts/backfill_daily_stats.py afterwards so fx_daily picks the rates up.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

VALET_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json"
SERIES = "FXUSDCAD"
DEFAULT_START = date(2020, 1, 1)
REQUEST_TIMEOUT_SECONDS = 30
INSERT_CHUNK = 500
PAGE_SIZE = 1000
# Same sanity band as fx_daily_rate_sane (0034).
RATE_MIN, RATE_MAX = 0.5, 3.0


def fetch_observations(start: date, end: date, session=None) -> list[tuple[date, float]]:
    """(date, rate) pairs from the Valet API, oldest first. Raises on HTTP or shape errors."""
    http = session or requests
    response = http.get(
        VALET_URL,
        params={"start_date": start.isoformat(), "end_date": end.isoformat()},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or not isinstance(payload.get("observations"), list):
        raise ValueError("Valet response has no 'observations' list")
    out: dict[date, float] = {}
    for obs in payload["observations"]:
        try:
            day = date.fromisoformat(obs["d"])
            rate = float(obs[SERIES]["v"])
        except (KeyError, TypeError, ValueError):
            continue  # holiday rows and malformed entries carry no value
        if start <= day <= end and RATE_MIN < rate < RATE_MAX:
            out[day] = rate
    return sorted(out.items())


def existing_dates_supabase(supabase, start: date, end: date) -> set[date]:
    """Dates in [start, end] that already have an exchange_rates row (PostgREST, paged)."""
    seen: set[date] = set()
    offset = 0
    while True:
        response = (
            supabase.table("exchange_rates")
            .select("recorded_at")
            .gte("recorded_at", f"{start.isoformat()}T00:00:00")
            .lt("recorded_at", f"{(end + timedelta(days=1)).isoformat()}T00:00:00")
            .order("recorded_at")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        rows = response.data or []
        for row in rows:
            seen.add(date.fromisoformat(str(row["recorded_at"])[:10]))
        if len(rows) < PAGE_SIZE:
            return seen
        offset += PAGE_SIZE


def insert_missing(observations, *, pg_db=None, supabase=None) -> int:
    """Insert the observations whose date has no row. Returns rows inserted."""
    inserted = 0
    if pg_db is not None:
        for i in range(0, len(observations), INSERT_CHUNK):
            inserted += pg_db.insert_missing_exchange_rates(observations[i:i + INSERT_CHUNK])
        return inserted
    if not observations:
        return 0
    have = existing_dates_supabase(supabase, observations[0][0], observations[-1][0])
    missing = [(d, r) for d, r in observations if d not in have]
    for i in range(0, len(missing), INSERT_CHUNK):
        chunk = missing[i:i + INSERT_CHUNK]
        supabase.table("exchange_rates").insert(
            [{"usd_to_cad": r, "recorded_at": f"{d.isoformat()}T00:00:00"} for d, r in chunk]
        ).execute()
        inserted += len(chunk)
    return inserted


def parse_args(argv=None):
    today = datetime.now(timezone.utc).date()
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--start", type=date.fromisoformat, default=DEFAULT_START)
    parser.add_argument("--end", type=date.fromisoformat, default=today)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if args.start > args.end:
        parser.error("--start must not be after --end")
    if args.end > today:
        parser.error("--end must not be in the future")
    return args


def main(argv=None, *, clients=None, session=None) -> int:
    args = parse_args(argv)
    observations = fetch_observations(args.start, args.end, session=session)
    print(f"Valet: {len(observations)} daily rates from {args.start} to {args.end}")
    if args.dry_run:
        print("Dry run: nothing written.")
        return 0
    if clients is None:
        from market_analytics import open_admin_clients

        clients = open_admin_clients()
    pg_db, supabase = clients
    try:
        inserted = insert_missing(observations, pg_db=pg_db, supabase=supabase)
    finally:
        if pg_db is not None:
            pg_db.close()
    print(f"Inserted {inserted} rows; {len(observations) - inserted} dates already had a rate.")
    print("Next: python scripts/backfill_daily_stats.py (refreshes fx_daily and the daily stats).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

The Valet response shape (`{"observations": [{"d": "YYYY-MM-DD", "FXUSDCAD": {"v": "1.3316"}}, ...]}`) is Bank of Canada's documented format. If the first real run prints `Valet: 0 daily rates` for a range that contains business days, stop and paste the first 500 bytes of `curl -s "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=3"` into the PR instead of changing the parser blind.

### Step 7. `scripts/backfill_daily_stats.py` (new)

`chmod +x` it.

```python
#!/usr/bin/env python3
"""
Fill product_daily_stats (and fx_daily) for past days by calling
public.refresh_market_analytics(day) once per day, oldest first (WP25).

The scraper and pg_cron only write today and yesterday. This one-off run
gives the new tables their history, so charts of derived metrics (days of
supply, liquidity rank) and the Sealed Index (WP29) have a past. Every call
is idempotent, so a re-run or an overlap with the live scraper is harmless.

  python scripts/backfill_daily_stats.py                 # the 400 days ending today (UTC)
  python scripts/backfill_daily_stats.py --start 2026-01-15 --end 2026-03-01
  python scripts/backfill_daily_stats.py --dry-run       # list the days, call nothing

Stops at the first failed day and prints the --start to resume from.
Connects as pokefin_scraper when POKEFIN_SCRAPER_DATABASE_URL is set,
otherwise with the service key. Takes about one second per day.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DEFAULT_DAYS = 400
EARLIEST_DAY = date(2020, 1, 1)  # refresh_market_analytics rejects earlier days
PROGRESS_EVERY = 25


def parse_args(argv=None):
    today = datetime.now(timezone.utc).date()
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--start", type=date.fromisoformat, default=None)
    parser.add_argument("--end", type=date.fromisoformat, default=today)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if args.end > today:
        parser.error("--end must not be in the future")
    if args.start is None:
        args.start = args.end - timedelta(days=DEFAULT_DAYS - 1)
    args.start = max(args.start, EARLIEST_DAY)
    if args.start > args.end:
        parser.error("--start must not be after --end")
    return args


def days_between(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def main(argv=None, *, clients=None, call=None) -> int:
    args = parse_args(argv)
    days = days_between(args.start, args.end)
    print(f"Refreshing {len(days)} days, {args.start} to {args.end}, oldest first")
    if args.dry_run:
        print("Dry run: nothing called.")
        return 0
    from market_analytics import call_refresh, open_admin_clients

    call = call or call_refresh
    pg_db, supabase = clients if clients is not None else open_admin_clients()
    started = time.monotonic()
    try:
        for n, day in enumerate(days, start=1):
            try:
                result = call(day, pg_db=pg_db, supabase=supabase)
            except Exception as e:  # noqa: BLE001 - report and stop
                print(f"FAILED on {day}: {type(e).__name__}: {e}", file=sys.stderr)
                print(f"Resume with: --start {day.isoformat()} --end {args.end.isoformat()}", file=sys.stderr)
                return 1
            if n % PROGRESS_EVERY == 0 or n == len(days):
                print(f"  {n}/{len(days)} {day}: {result}")
    finally:
        if pg_db is not None:
            pg_db.close()
    print(f"Done in {time.monotonic() - started:.0f} s.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### Step 8. `frontend/app/types/market.ts`: the row type

Append at the end of the file (WP20 created it; domain types live here):

```ts
// ---- WP25: product_daily_stats (migration 0033) ----

/**
 * One product_daily_stats row (or product_stats_latest, the same columns).
 * Percent columns are percent points (12.5 means +12.5%). Dates are
 * "YYYY-MM-DD" UTC days. null means withheld or not computable, never zero:
 * see /methodology for each gate.
 */
export interface ProductDailyStats {
  day: string;
  product_id: number;
  usd_price: number | null;
  price_day: string | null;
  is_price_fresh: boolean;
  ret_1d: number | null;
  ret_7d: number | null;
  ret_30d: number | null;
  ret_90d: number | null;
  ret_365d: number | null;
  tracked_high_usd: number | null;
  tracked_high_day: string | null;
  first_tracked_day: string | null;
  dd_from_high_pct: number | null;
  high_52w: number | null;
  low_52w: number | null;
  pos_in_52w: number | null;
  distinct_prices_365d: number | null;
  obs_90d: number | null;
  vol_weekly_52w: number | null;
  units_sold_7d: number | null;
  units_sold_30d: number | null;
  tx_30d: number | null;
  active_listings: number | null;
  qty_available: number | null;
  lowest_ask_usd: number | null;
  listings_snapshot_date: string | null;
  ask_premium_pct: number | null;
  days_of_supply: number | null;
  sell_through_30d: number | null;
  qty_change_7d_pct: number | null;
  qty_change_30d_pct: number | null;
  liquidity_score: number | null;
  refreshed_at: string;
}
```

### Step 9. `frontend/app/lib/marketStats.ts` (new)

```ts
/**
 * product_daily_stats (migration 0033): the TypeScript side (WP25).
 *
 * The constants mirror the literals in refresh_product_daily_stats and are
 * drift-tested against the SQL (marketStatsConstants.test.ts), so
 * /methodology prints what the database computes. Change both together and
 * bump METHODOLOGY_VERSION. The freshness gates reuse marketPulse.ts's
 * PRICE_STALENESS_TOLERANCE_DAYS, DAILY_DATA_STALENESS_TOLERANCE_DAYS and
 * LISTINGS_STALENESS_TOLERANCE_DAYS (the same test checks them).
 *
 * Isomorphic: no React, no Supabase.
 */
import type { ProductDailyStats } from "../types/market";

/**
 * Maximum age of a return anchor beyond its window: the anchor is the newest
 * price on or before (day - window) and no older than (day - window - tolerance).
 */
export const RETURN_ANCHOR_WINDOWS = [
  { key: "ret_7d", label: "7D", days: 7, toleranceDays: 7 },
  { key: "ret_30d", label: "1M", days: 30, toleranceDays: 7 },
  { key: "ret_90d", label: "3M", days: 90, toleranceDays: 14 },
  { key: "ret_365d", label: "1Y", days: 365, toleranceDays: 14 },
] as const;

/** 1D: the previous recorded day may be at most this many days earlier. */
export const ONE_DAY_PREVIOUS_MAX_GAP_DAYS = 3;

/** Rows in the rolling minimum that sets the tracked high (and the 52-week range). */
export const TRACKED_HIGH_ROLLING_ROWS = 3;

/** Weekly volatility: Monday grid, 52 weeks, annualised by sqrt(52). */
export const WEEKS_PER_YEAR = 52;
export const VOL_WEEKLY_MIN_RETURNS = 26;

/** Supply change: the earlier snapshot may be up to this many days older than 7 or 30 days. */
export const SUPPLY_CHANGE_TOLERANCE_DAYS = 3;

/** Liquidity: products of the same type needed before a percentile is published. */
export const LIQUIDITY_MIN_PEERS = 5;

export const LIQUIDITY_COMPONENTS = [
  "Units sold, 30 days",
  "Transactions, 30 days",
  "Sell-through, 30 days",
  "Lowest ask closeness to Market Price",
] as const;

/** Latest stats keyed by product id. JSON-safe (unstable_cache stores JSON). */
export interface ProductStatsSnapshot {
  /** The UTC day the rows describe, or null when nothing could be read. */
  day: string | null;
  byProductId: Record<number, ProductDailyStats>;
}

export const EMPTY_PRODUCT_STATS: ProductStatsSnapshot = { day: null, byProductId: {} };

/**
 * A row as PostgREST returns it from the view. Generated view types mark
 * every column nullable, so the snapshot validates the keys it relies on.
 */
export type ProductDailyStatsRow = { [K in keyof ProductDailyStats]: ProductDailyStats[K] | null };

export function toProductStatsSnapshot(rows: readonly ProductDailyStatsRow[]): ProductStatsSnapshot {
  const byProductId: Record<number, ProductDailyStats> = {};
  let day: string | null = null;
  for (const row of rows) {
    if (typeof row?.product_id !== "number" || typeof row.day !== "string") continue;
    byProductId[row.product_id] = {
      ...row,
      day: row.day,
      product_id: row.product_id,
      is_price_fresh: row.is_price_fresh === true,
      refreshed_at: row.refreshed_at ?? row.day,
    };
    if (day === null || row.day > day) day = row.day;
  }
  return { day, byProductId };
}

export function statsFor(snapshot: ProductStatsSnapshot, productId: number): ProductDailyStats | null {
  return snapshot.byProductId[productId] ?? null;
}
```

### Step 10. `frontend/app/lib/fx.ts` (new)

```ts
/**
 * USD to CAD at the Bank of Canada rate of each day (WP25).
 *
 * fx_daily (migration 0034) holds one rate per UTC day: the newest Bank of
 * Canada rate on or before that day, carried over weekends and holidays for
 * at most FX_CARRY_MAX_DAYS. A CAD return is (P1 x FX1) / (P0 x FX0) - 1, so
 * converting history at today's rate leaves the currency move out.
 *
 * Isomorphic and tiny: CurrencyProvider (in every page's shared bundle)
 * imports it. No React, no Supabase, no import from marketMath or format.
 */

/** Mirrors the 14 in refresh_fx_daily (0034); drift-tested. */
export const FX_CARRY_MAX_DAYS = 14;

/** One fx_daily row as PostgREST returns it. */
export interface FxDailyRow {
  day: string;
  usd_to_cad: number;
  source_date: string;
  source: "boc" | "carry_forward";
}

/**
 * fx_daily as a dense daily array: rates[i] is the rate of start + i days,
 * or null for a day with no row (more than FX_CARRY_MAX_DAYS after the
 * newest rate). About 8 bytes a day as JSON, so a page can pass a slice of
 * it to a client component.
 */
export interface FxDailySeries {
  /** YYYY-MM-DD of rates[0], or null when the series is empty. */
  start: string | null;
  rates: readonly (number | null)[];
  /** The Bank of Canada date behind the last rate, for "as of" labels. */
  latestSourceDate: string | null;
}

export const EMPTY_FX_SERIES: FxDailySeries = { start: null, rates: [], latestSourceDate: null };

const DAY_MS = 86_400_000;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})/;

/** Days since 1970-01-01 for a "YYYY-MM-DD..." string, or null. Zone-free. */
function dayNumber(dateKey: string | null | undefined): number | null {
  if (!dateKey) return null;
  const m = DATE_KEY.exec(dateKey);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? Math.round(ms / DAY_MS) : null;
}

function dateKeyOf(dayNum: number): string {
  return new Date(dayNum * DAY_MS).toISOString().slice(0, 10);
}

function usableRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Rows in any order (duplicates: the last one wins) to a dense series. */
export function buildFxSeries(rows: readonly FxDailyRow[]): FxDailySeries {
  const byDay = new Map<number, FxDailyRow>();
  for (const row of rows) {
    const n = dayNumber(row?.day);
    if (n !== null && usableRate(row.usd_to_cad)) byDay.set(n, row);
  }
  if (byDay.size === 0) return EMPTY_FX_SERIES;
  const days = [...byDay.keys()];
  const first = Math.min(...days);
  const last = Math.max(...days);
  const rates: (number | null)[] = [];
  for (let n = first; n <= last; n++) rates.push(byDay.get(n)?.usd_to_cad ?? null);
  return {
    start: dateKeyOf(first),
    rates,
    latestSourceDate: byDay.get(last)?.source_date?.slice(0, 10) ?? null,
  };
}

/** The part of a series from `fromDay` on (for passing to a client component). */
export function sliceFxSeries(series: FxDailySeries, fromDay: string): FxDailySeries {
  const start = dayNumber(series.start);
  const from = dayNumber(fromDay);
  if (start === null || from === null || from <= start) return series;
  const offset = from - start;
  if (offset >= series.rates.length) return EMPTY_FX_SERIES;
  return { start: dateKeyOf(from), rates: series.rates.slice(offset), latestSourceDate: series.latestSourceDate };
}

/**
 * The rate for a day. After the series ends, the last rate is used for at
 * most FX_CARRY_MAX_DAYS (today's row may not exist before the next
 * refresh). Before the series starts, or in a gap: null.
 */
export function rateOn(series: FxDailySeries, day: string): number | null {
  const start = dayNumber(series.start);
  const n = dayNumber(day);
  if (start === null || n === null || n < start) return null;
  const i = n - start;
  if (i < series.rates.length) return series.rates[i] ?? null;
  const lastIndex = series.rates.length - 1;
  const last = series.rates[lastIndex];
  return last !== null && last !== undefined && i - lastIndex <= FX_CARRY_MAX_DAYS ? last : null;
}

/** A USD amount in CAD at the rate of `day`, or null when that day has no rate. */
export function usdToCadOn(series: FxDailySeries, day: string, usd: number | null | undefined): number | null {
  if (typeof usd !== "number" || !Number.isFinite(usd)) return null;
  const rate = rateOn(series, day);
  return rate === null ? null : usd * rate;
}

/** One point of a daily series (WP18's DailyPoint has this shape). */
export interface DatedPrice {
  dateKey: string;
  price: number;
}

/**
 * A USD daily series in CAD at each day's rate. A day without a rate gets
 * price null (a chart gap), never today's rate.
 */
export function toCadAtDatedRates(
  points: readonly DatedPrice[],
  series: FxDailySeries
): Array<{ dateKey: string; price: number | null }> {
  return points.map((p) => ({ dateKey: p.dateKey, price: usdToCadOn(series, p.dateKey, p.price) }));
}

/**
 * Percent return for a CAD holder: (P1 x FX1) / (P0 x FX0) - 1, x 100.
 * null when a price or a rate is missing.
 */
export function cadReturnPercent(
  series: FxDailySeries,
  from: { day: string; usd: number | null },
  to: { day: string; usd: number | null }
): number | null {
  const start = usdToCadOn(series, from.day, from.usd);
  const end = usdToCadOn(series, to.day, to.usd);
  if (start === null || end === null || start <= 0) return null;
  return (end / start - 1) * 100;
}

/** Bound helpers over one series: `fx.usdToCadOn(day, usd)`. */
export interface FxLookup {
  series: FxDailySeries;
  rateOn(day: string): number | null;
  usdToCadOn(day: string, usd: number | null | undefined): number | null;
  toCad(points: readonly DatedPrice[]): Array<{ dateKey: string; price: number | null }>;
}

export function createFxLookup(series: FxDailySeries): FxLookup {
  return {
    series,
    rateOn: (day) => rateOn(series, day),
    usdToCadOn: (day, usd) => usdToCadOn(series, day, usd),
    toCad: (points) => toCadAtDatedRates(points, series),
  };
}
```

Keep it free of imports. `CurrencyProvider` is in every page's shared bundle, and importing `format.ts`, `marketMath.ts` or `marketPulse.ts` here would pull them in too.

### Step 11. `frontend/app/lib/serverMarketData.ts`: two cached reads

11a. Imports, next to the existing type imports:

```ts
import { buildFxSeries, EMPTY_FX_SERIES, type FxDailyRow, type FxDailySeries } from "./fx";
import {
  EMPTY_PRODUCT_STATS,
  toProductStatsSnapshot,
  type ProductDailyStatsRow,
  type ProductStatsSnapshot,
} from "./marketStats";
```

11b. Directly above the comment block that starts the cached exports (WP11 step 2e, the line `const getCachedExchangeRateSnapshot = unstable_cache(`), add the fetchers:

```ts
/** PostgREST returns at most 1000 rows per request (Supabase max rows). */
const TABLE_PAGE_SIZE = 1000;
const TABLE_MAX_PAGES = 10;

/**
 * Every row of an ordered read, one PostgREST page at a time. Throws on an
 * error or past TABLE_MAX_PAGES, so a partial result is never cached.
 */
async function fetchAllRows<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let p = 0; p < TABLE_MAX_PAGES; p++) {
    const from = p * TABLE_PAGE_SIZE;
    const { data, error } = await page(from, from + TABLE_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < TABLE_PAGE_SIZE) return rows;
  }
  throw new Error(`${label}: more than ${TABLE_MAX_PAGES * TABLE_PAGE_SIZE} rows`);
}

/**
 * Columns of product_stats_latest (migration 0033). Listed, not "*", so a
 * column a later migration adds does not silently grow every cached payload.
 * A template literal with no substitutions keeps its literal type, which
 * supabase-js needs to type the rows.
 */
const PRODUCT_STATS_SELECT = `day, product_id, usd_price, price_day, is_price_fresh,
  ret_1d, ret_7d, ret_30d, ret_90d, ret_365d,
  tracked_high_usd, tracked_high_day, first_tracked_day, dd_from_high_pct,
  high_52w, low_52w, pos_in_52w, distinct_prices_365d, obs_90d, vol_weekly_52w,
  units_sold_7d, units_sold_30d, tx_30d,
  active_listings, qty_available, lowest_ask_usd, listings_snapshot_date,
  ask_premium_pct, days_of_supply, sell_through_30d,
  qty_change_7d_pct, qty_change_30d_pct, liquidity_score, refreshed_at`;

/** Latest product_daily_stats row of every active product: one indexed query. */
async function fetchProductStatsLatest(): Promise<ProductStatsSnapshot> {
  const supabase = createMarketDataSupabaseClient();
  const rows: ProductDailyStatsRow[] = await fetchAllRows("product_stats_latest", (from, to) =>
    supabase
      .from("product_stats_latest")
      .select(PRODUCT_STATS_SELECT)
      .order("product_id", { ascending: true })
      .range(from, to)
  );
  return rows.length ? toProductStatsSnapshot(rows) : EMPTY_PRODUCT_STATS;
}

/** fx_daily (migration 0034), oldest first, as a dense daily series. */
async function fetchFxDaily(): Promise<FxDailySeries> {
  const supabase = createMarketDataSupabaseClient();
  const rows = await fetchAllRows("fx_daily", (from, to) =>
    supabase
      .from("fx_daily")
      .select("day, usd_to_cad, source_date, source")
      .order("day", { ascending: true })
      .range(from, to)
  );
  const valid: FxDailyRow[] = [];
  for (const row of rows) {
    // source is text with a CHECK constraint; the generated type is string.
    if (row.source !== "boc" && row.source !== "carry_forward") continue;
    valid.push({ day: row.day, usd_to_cad: row.usd_to_cad, source_date: row.source_date, source: row.source });
  }
  return valid.length ? buildFxSeries(valid) : EMPTY_FX_SERIES;
}
```

11c. At the end of the cached-exports block (after `getCachedProductDetail`), add:

```ts
const getCachedProductStatsSnapshot = unstable_cache(
  fetchProductStatsLatest,
  ["product-stats-latest"],
  {
    revalidate: DAILY_BACKSTOP_SECONDS,
    tags: [CACHE_TAGS.marketProducts],
  }
);

/**
 * product_daily_stats for the newest day, keyed by product id (WP25). On a
 * failed read returns EMPTY_PRODUCT_STATS (day null), uncached, so the next
 * render retries. Callers show "--" for a product with no row.
 */
export async function getCachedProductStats(): Promise<ProductStatsSnapshot> {
  try {
    return await getCachedProductStatsSnapshot();
  } catch (error) {
    logCaughtError("server_product_stats_failed", error);
    return EMPTY_PRODUCT_STATS;
  }
}

const getCachedFxDailySeries = unstable_cache(
  fetchFxDaily,
  ["fx-daily"],
  {
    revalidate: DAILY_BACKSTOP_SECONDS,
    tags: [CACHE_TAGS.exchangeRate, CACHE_TAGS.marketProducts],
  }
);

/**
 * Bank of Canada USD to CAD per UTC day (WP25), for CAD history at dated
 * rates. On a failed read returns EMPTY_FX_SERIES, uncached: callers then
 * show USD history, or CAD at the latest rate labelled as such, never a
 * dated-rate claim they cannot back. Slice it with sliceFxSeries before
 * passing it to a client component.
 */
export async function getCachedFxDaily(): Promise<FxDailySeries> {
  try {
    return await getCachedFxDailySeries();
  } catch (error) {
    logCaughtError("server_fx_daily_failed", error);
    return EMPTY_FX_SERIES;
  }
}
```

Do not call either function from another cached function's callback (WP11's nested-cache rule). Do not add a call to any page in this package.

Until phase B (step 15), `tsc` reports that `"product_stats_latest"` and `"fx_daily"` are not in `Database`. Do not cast the client to `any` to get around it.

### Step 12. `frontend/app/context/CurrencyContext.tsx`: the dated series helper

12a. Import, below the `../lib/currency` import:

```ts
import { toCadAtDatedRates, type DatedPrice, type FxDailySeries } from "../lib/fx";
```

12b. Add a module-level helper directly above `const FALLBACK_VALUE`:

```ts
/**
 * A USD daily series in `currency`: CAD at each day's Bank of Canada rate
 * from `fx`, USD unchanged. A CAD day without a rate is null (a chart gap),
 * never today's rate.
 */
function convertSeries(
  points: readonly DatedPrice[],
  fx: FxDailySeries,
  currency: Currency
): Array<{ dateKey: string; price: number | null }> {
  return currency === "CAD"
    ? toCadAtDatedRates(points, fx)
    : points.map((p) => ({ dateKey: p.dateKey, price: p.price }));
}
```

12c. Add the member to `CurrencyContextValue`, after `formatPrice`:

```ts
  /**
   * WP25: a USD daily series (WP18 DailyPoint shape) in the selected
   * currency, CAD at each day's Bank of Canada rate. Pass the page's
   * getCachedFxDaily() result, sliced to the chart's range with
   * sliceFxSeries. With EMPTY_FX_SERIES (the read failed) every CAD point is
   * null: show the USD series with a note instead of an empty chart.
   */
  convertDailySeries: (
    points: readonly DatedPrice[],
    fx: FxDailySeries
  ) => Array<{ dateKey: string; price: number | null }>;
```

12d. In `FALLBACK_VALUE` add `convertDailySeries: (points, fx) => convertSeries(points, fx, DEFAULT_CURRENCY),`. In the provider's `useMemo` object add `convertDailySeries: (points, fx) => convertSeries(points, fx, currency),` (the dependency list already contains `currency`; leave it unchanged).

The root layout keeps passing only `initialRate`. Do not put the FX series in the provider's props or state: it would ship about 20 kB of JSON in every page's RSC payload.

### Step 13. `frontend/scripts/fixtures/perf.mjs`: fixture routes for the two new reads

WP22's rule: a new data endpoint gets a fixture route in the same PR. No page calls them yet, but WP28 to WP37 will, on public routes.

13a. In `buildPerfData`, directly above the final `return { summaries, volume, ... };` line (after `exchangeRates`, so every random draw above keeps its value and the recorded limits stay valid), add:

```js
  // WP25: product_stats_latest and fx_daily. Drawn last, so the PRNG
  // sequence above (and every recorded limit) is unchanged.
  const volumeById = new Map(volume.map((v) => [v.product_id, v]));
  const productStats = summaries.map((s) => {
    const v = volumeById.get(s.id);
    const fresh = s.usd_price !== null;
    const high = fresh ? round2(s.usd_price * (1 + rand() * 0.6)) : null;
    const low = fresh ? round2(s.usd_price * (0.6 + rand() * 0.4)) : null;
    const qty = v ? v.total_quantity_available : null;
    const units30 = v ? v.units_sold_30d : null;
    return {
      day: isoDate(nowMs),
      product_id: s.id,
      usd_price: s.usd_price,
      price_day: s.price_recorded_at.slice(0, 10),
      is_price_fresh: fresh,
      ret_1d: s.return_1d,
      ret_7d: s.return_7d,
      ret_30d: s.return_30d,
      ret_90d: s.return_90d,
      ret_365d: s.return_365d,
      tracked_high_usd: high,
      tracked_high_day: high === null ? null : isoDate(nowMs - int(10, 300) * DAY_MS),
      first_tracked_day: isoDate(nowMs - 400 * DAY_MS),
      dd_from_high_pct: fresh ? round2((s.usd_price / high - 1) * 100) : null,
      high_52w: high,
      low_52w: low,
      pos_in_52w: fresh && high > low ? round2(Math.min(100, Math.max(0, ((s.usd_price - low) / (high - low)) * 100))) : null,
      distinct_prices_365d: int(1, 300),
      obs_90d: int(60, 90),
      vol_weekly_52w: round2(5 + rand() * 40),
      units_sold_7d: v ? v.units_sold_7d : null,
      units_sold_30d: units30,
      tx_30d: v ? v.transaction_count_30d : null,
      active_listings: v ? v.active_listings : null,
      qty_available: qty,
      lowest_ask_usd: v ? v.lowest_listing_price : null,
      listings_snapshot_date: v ? v.listings_snapshot_date : null,
      ask_premium_pct: v && fresh ? round2((v.lowest_listing_price / s.usd_price - 1) * 100) : null,
      days_of_supply: v && units30 > 0 ? round2(qty / (units30 / 30)) : null,
      sell_through_30d: v && units30 + qty > 0 ? round2((units30 / (units30 + qty)) * 100) : null,
      qty_change_7d_pct: v ? round2(normal() * 10) : null,
      qty_change_30d_pct: v ? round2(normal() * 20) : null,
      liquidity_score: v && fresh ? int(0, 100) : null,
      refreshed_at: new Date(nowMs).toISOString(),
    };
  });

  // 800 days, weekends carried from Friday like refresh_fx_daily.
  const fxDaily = [];
  for (let d = 799; d >= 0; d--) {
    const ms = nowMs - d * DAY_MS;
    const weekday = new Date(ms).getUTCDay();
    const sourceMs = weekday === 0 ? ms - 2 * DAY_MS : weekday === 6 ? ms - DAY_MS : ms;
    const rate = Math.round((1.37 + 0.03 * Math.sin(Math.floor(sourceMs / DAY_MS) / 40)) * 10000) / 10000;
    fxDaily.push({
      day: isoDate(ms),
      usd_to_cad: rate,
      source_date: isoDate(sourceMs),
      source: sourceMs === ms ? "boc" : "carry_forward",
    });
  }
```

and add `productStats, fxDaily` to the returned object.

13b. In `perfRoutes()`, below the `"/rest/v1/exchange_rates"` entry, add:

```js
    "/rest/v1/product_stats_latest": rows("productStats"),
    "/rest/v1/fx_daily": rows("fxDaily"),
```

If `applyPostgrest` does not support `.range()` (check `frontend/scripts/fixtures/postgrest.mjs` for `Range` or `offset` handling), leave the routes as written: both reads fit in one page and the stub returns every row.

### Step 14. Methodology v1.1 and metric definitions

14a. `frontend/app/content/methodology.ts`:
- Before editing, note WP24's v1.0 effective date: `grep -n "METHODOLOGY_EFFECTIVE_DATE = " frontend/app/content/methodology.ts` (call it `V10_DATE`).
- `export const METHODOLOGY_VERSION = "1.1";` and `export const METHODOLOGY_EFFECTIVE_DATE = "<today, date -u +%F>";`.
- `export const METHODOLOGY_FIRST_PUBLISHED = "<V10_DATE>";` (a literal now; it was an alias of the effective date).
- In `METHODOLOGY_SECTIONS`, insert `{ anchor: "tracked-high", title: "Tracked high and 52-week range" },` directly after the `drawdown` entry, and `{ anchor: "liquidity", title: "Liquidity score" },` directly after the `supply` entry.
- Append to `METHODOLOGY_SUBSECTIONS`:

```ts
  { anchor: "range-52w", title: "52-week range", parent: "tracked-high" },
  { anchor: "sell-through", title: "Sell-through", parent: "supply" },
  { anchor: "supply-trend", title: "Supply trend", parent: "supply" },
  { anchor: "ask-premium", title: "Lowest ask vs Market Price", parent: "supply" },
```

- Replace `METHODOLOGY_CHANGES` with (newest first; the v1.0 row becomes literals):

```ts
export const METHODOLOGY_CHANGES: readonly MethodologyChange[] = [
  {
    version: METHODOLOGY_VERSION,
    date: METHODOLOGY_EFFECTIVE_DATE,
    summary:
      "Adds the daily statistics: tracked high, 52-week range, weekly volatility, liquidity score, sell-through, supply trend and lowest ask. Returns from the daily statistics have a maximum lookback age. CAD history uses the Bank of Canada rate of each day.",
  },
  {
    version: "1.0",
    date: "<V10_DATE>",
    summary: "First published version.",
  },
];
```

14b. `frontend/app/lib/metricDefinitions.ts`:
- Add the import: `import { LIQUIDITY_MIN_PEERS, TRACKED_HIGH_ROLLING_ROWS, WEEKS_PER_YEAR } from "./marketStats";`
- Append these entries to the product-level group of `DEFINITIONS`, directly after the `marketPulse` entry:

```ts
  // Daily statistics (WP25, product_daily_stats)
  def({ key: "trackedHigh", label: "Tracked high", unitLabel: "USD", window: "since first tracked day", short: `Highest price held for ${TRACKED_HIGH_ROLLING_ROWS} recorded days in a row since Pokéfin began tracking the product.`, anchor: "tracked-high" }),
  def({ key: "fromTrackedHigh", label: "From tracked high", unitLabel: "%", window: "since first tracked day", short: "Percent between the current Market Price and the tracked high. Hidden when the price is withheld.", anchor: "tracked-high" }),
  def({ key: "range52w", label: "52-week range", unitLabel: "USD", window: "52 weeks", short: `Lowest and highest prices held for ${TRACKED_HIGH_ROLLING_ROWS} recorded days in a row over the last 52 weeks.`, anchor: "range-52w" }),
  def({ key: "positionIn52w", label: "Position in 52-week range", unitLabel: "%", window: "52 weeks", short: "Where the current price sits between the 52-week low (0%) and the 52-week high (100%).", anchor: "range-52w" }),
  def({ key: "volatilityWeekly52w", label: "Volatility 1Y (weekly, annualised)", unitLabel: "% annualised", window: `${WEEKS_PER_YEAR} weeks`, short: `Std dev of weekly log changes over ${WEEKS_PER_YEAR} Monday prices, times the square root of ${WEEKS_PER_YEAR}.`, anchor: "volatility" }),
  def({ key: "liquidityScore", label: "Liquidity (percentile)", unitLabel: "percentile", window: "30 days", short: `Mean percentile within the product type (${LIQUIDITY_MIN_PEERS}+ peers) of units sold, orders, sell-through and ask closeness.`, anchor: "liquidity" }),
  def({ key: "transactions30d", label: "Orders (30d)", unitLabel: "orders", window: "30 days", short: "Completed TCGplayer orders in the last 30 days, from daily sales buckets.", anchor: "volume" }),
  def({ key: "sellThrough30d", label: "Sell-through (30d)", unitLabel: "%", window: "30 days", short: "Units sold in 30 days divided by units sold plus units on market.", anchor: "sell-through" }),
  def({ key: "supplyChange7d", label: "Supply change (7d)", unitLabel: "%", window: "7 days", short: "Change in units on market against the snapshot about 7 days earlier.", anchor: "supply-trend" }),
  def({ key: "supplyChange30d", label: "Supply change (30d)", unitLabel: "%", window: "30 days", short: "Change in units on market against the snapshot about 30 days earlier.", anchor: "supply-trend" }),
  def({ key: "askPremium", label: "Lowest ask vs Market Price", unitLabel: "%", window: "latest snapshot", short: "Cheapest listing, before shipping, against Market Price. Negative means listed below it.", anchor: "ask-premium" }),
  def({ key: "distinctPrices365d", label: "Distinct prices (1Y)", unitLabel: "count", window: "365 days", short: "Number of different daily prices recorded in the last year. Few means thin trading.", anchor: "coverage" }),
```

Every `short` is at most 120 characters (longest: `liquidityScore`, 105 once interpolated) and contains no banned word from WP24's test. Do not change existing entries: `volatility30dAnnualised` still describes the pages that show it.

14c. `frontend/app/methodology/MethodologyArticle.tsx`:

- Imports: add

```ts
import { FX_CARRY_MAX_DAYS } from "../lib/fx";
import {
  LIQUIDITY_COMPONENTS,
  LIQUIDITY_MIN_PEERS,
  ONE_DAY_PREVIOUS_MAX_GAP_DAYS,
  RETURN_ANCHOR_WINDOWS,
  SUPPLY_CHANGE_TOLERANCE_DAYS,
  TRACKED_HIGH_ROLLING_ROWS,
  VOL_WEEKLY_MIN_RETURNS,
  WEEKS_PER_YEAR,
} from "../lib/marketStats";
```

- Above `export default function MethodologyArticle`, add:

```tsx
/** Oldest lookback price the daily statistics accept, per return label. */
function maxLookbackAge(label: string, days: number): string {
  if (label === "1D") return `previous recorded day, at most ${ONE_DAY_PREVIOUS_MAX_GAP_DAYS} days earlier`;
  const window = RETURN_ANCHOR_WINDOWS.find((w) => w.label === label);
  return window ? `${days + window.toleranceDays} days` : "not used";
}
```

- `#cadence`: append one sentence to its paragraph: `Pokéfin's daily statistics are recomputed after each run and finalised for the previous UTC day shortly after midnight UTC.`

- Replace the whole `<Section id="currency">...</Section>` with:

```tsx
          <Section id="currency">
            <p>
              A current CAD price is the USD Market Price converted at the latest Bank of Canada daily USD to CAD
              rate Pokéfin has stored
              {current.fxRate !== null && current.fxDate !== null
                ? ` (${current.fxRate.toFixed(4)} on ${formatDateOnly(current.fxDate)})`
                : ""}
              . CAD history, CAD returns and CAD cost basis use the Bank of Canada rate of each day instead. On
              weekends and bank holidays the last published rate carries forward for at most {FX_CARRY_MAX_DAYS}{" "}
              days; a day further from a published rate shows no CAD value rather than a guessed one.
            </p>
            <p>
              A CAD return is therefore (price now × rate now) ÷ (price then × rate then) - 1, so it includes the
              currency move. A CAD figure is a converted US marketplace price, not a Canadian market price.
            </p>
          </Section>
```

- `#returns`: replace the table and the paragraph that begins "The lookback price has no maximum age" with:

```tsx
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH}>Label</th>
                  <th className={TH}>Lookback</th>
                  <th className={TH}>Oldest lookback price (daily statistics)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(RETURN_WINDOW_DAYS).map(([label, days]) => (
                  <tr key={label} data-window={label}>
                    <td className={TD}>{label}</td>
                    <td className={TD}>{days} {days === 1 ? "day" : "days"}</td>
                    <td className={TD}>{maxLookbackAge(label, days)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Returns computed from Pokéfin&apos;s daily statistics use the lookback price only if it is no older
              than the last column; otherwise the return shows <code>--</code>. Pages that still compute returns on
              request (the catalog and the Market table) accept an older lookback price, so a product with a gap
              in its history can report a return over a longer span than its label there. Returns are withheld
              with the price.
            </p>
```

If the WP10 check in Before you start printed lines (WP10 bounded its anchors too), use this paragraph instead: `Every return uses the lookback price only if it is no older than the last column; otherwise the return shows <code>--</code>. Returns are withheld with the price.`

- `#volatility`: add a third row to its table, after `tr[data-vol="set"]`:

```tsx
                <tr data-vol="weekly">
                  <td className={TD}>Daily statistics (from version 1.1)</td>
                  <td className={TD}>
                    Last {WEEKS_PER_YEAR} weekly changes on a Monday grid, at least {VOL_WEEKLY_MIN_RETURNS}
                  </td>
                  <td className={TD}>Annualised: weekly × √{WEEKS_PER_YEAR}</td>
                </tr>
```

and append this paragraph at the end of the section:

```tsx
            <p>
              The weekly figure is the sample standard deviation of the natural log of each week&apos;s price
              change, where a week&apos;s price is the newest daily price in the seven days ending on a Monday.
              Weekly changes are less affected by gaps and by the smoothing inside Market Price, so new pages use
              it; the daily figures stay where they already appear.
            </p>
```

- Directly after the `#drawdown` section, add:

```tsx
          <Section id="tracked-high">
            <p>
              The tracked high is the highest price a product held for {TRACKED_HIGH_ROLLING_ROWS} recorded days
              in a row: for each day, take the lowest of that day&apos;s price and the{" "}
              {TRACKED_HIGH_ROLLING_ROWS - 1} recorded prices before it, then the highest of those values since
              Pokéfin began tracking the product. A single day&apos;s spike cannot set it. It is shown as
              &quot;tracked high since&quot; the first tracked day, because history starts about a year before
              daily collection and an older product&apos;s real peak may be earlier.
            </p>
            <p>
              From tracked high = current price ÷ tracked high - 1. It is withheld with the price; the tracked high
              itself describes recorded history and stays visible.
            </p>
            <Sub id="range-52w">
              <p>
                The 52-week high applies the same rule to the last 52 weeks. The 52-week low is its mirror: the
                lowest price held for {TRACKED_HIGH_ROLLING_ROWS} recorded days in a row. Position in range = (price
                - low) ÷ (high - low), from 0% at the low to 100% at the high, and is withheld with the price.
              </p>
            </Sub>
          </Section>
```

- Inside `<Section id="supply">`, after its existing paragraph, add:

```tsx
            <Sub id="sell-through">
              <p>
                Sell-through (30d) = units sold in 30 days ÷ (units sold in 30 days + units on market). Higher
                means what is listed clears faster relative to recent sales. It is hidden when either input is
                missing.
              </p>
            </Sub>
            <Sub id="supply-trend">
              <p>
                Supply change (7d or 30d) = units on market now ÷ units on market in the snapshot 7 or 30 days
                earlier - 1. The earlier snapshot may be up to {SUPPLY_CHANGE_TOLERANCE_DAYS} days older; with none,
                or with zero units then, it shows <code>--</code>. One seller listing many units moves this figure.
              </p>
            </Sub>
            <Sub id="ask-premium">
              <p>
                Lowest ask vs Market Price = cheapest listing ÷ Market Price - 1. The listing price excludes
                shipping, so a small positive value can still cost more than Market Price once shipping is paid.
                A negative value means someone lists below Market Price.
              </p>
            </Sub>
```

- Directly after the `#supply` section, add:

```tsx
          <Section id="liquidity">
            <p>
              The liquidity score compares a product with the other products of its type (booster boxes with
              booster boxes) on four inputs. Each input becomes a percentile from 0 to 1 within the type; the
              score is their mean × 100, rounded.
            </p>
            <ul className="ml-5 list-disc space-y-1">
              {LIQUIDITY_COMPONENTS.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p>
              It is published only when all four inputs exist and at least {LIQUIDITY_MIN_PEERS} products of the
              type have them. It counts TCGplayer sales only, so it is relative, not a measure of how many buyers
              exist, and it says nothing about value.
            </p>
          </Section>
```

- `#limits`: replace the bullet `CAD history uses the latest rate (see Canadian dollars).` with `Product and portfolio charts still convert CAD history at the latest rate until they move to the daily rates described under Canadian dollars.` (WP31 and WP36 delete this bullet when they move; leave a `{/* WP31 and WP36 remove this bullet */}` comment above it.)

Check: `grep -cP '\x{2014}' frontend/app/methodology/MethodologyArticle.tsx` prints 0 (no em dashes).

### Step 15. Phase B: generated types

After the owner has applied 0033 and 0034 (Owner action 2):

```bash
cd frontend
SUPABASE_ACCESS_TOKEN=... pnpm types:db          # or use the file the owner pushed
grep -oE "product_daily_stats|product_stats_latest|fx_daily|refresh_market_analytics" app/types/database.ts | sort -u | wc -l   # 4
pnpm exec tsc --noEmit                            # exit 0
```

Do not edit the generated file. If a view column comes out non-nullable in the generated type, `ProductDailyStatsRow` still accepts it (a subtype); if `tsc` rejects the row assignment in `fetchProductStatsLatest` for another reason, adjust `ProductDailyStatsRow`, not the generated file, and say so in the PR.

### Step 16. Documentation

16a. `README.md`, section "One-time backfills": append to the code block

```bash
python scripts/backfill_fx_valet.py        # Bank of Canada USD/CAD history into exchange_rates (WP25)
python scripts/backfill_daily_stats.py     # 400 days of product_daily_stats and fx_daily (WP25)
```

and below the block: `Run the FX backfill first. Both connect as pokefin_scraper when POKEFIN_SCRAPER_DATABASE_URL is set, otherwise with the service key.`

16b. `README.md`, section "Database": add a subsection at its end:

```markdown
#### Market analytics tables (WP25)

- `product_daily_stats`: one row per active product per UTC day (returns with a
  maximum lookback age, tracked high, 52-week range, weekly volatility, sales,
  listings, sell-through, supply change, liquidity percentile). Written by
  `refresh_market_analytics(p_day)` after every scraper run and finalised for
  the previous day by the pg_cron job `pokefin-finalise-market-analytics`
  (00:30 UTC). Read through the view `product_stats_latest`.
- `fx_daily`: one Bank of Canada USD to CAD rate per UTC day, carried forward
  over weekends and holidays for at most 14 days.
- Gates and formulas: `migrations/0033_product_daily_stats.sql`,
  `migrations/0034_fx_daily.sql`, and `/methodology`.
```

16c. `audits/HARDENING_FOLLOWUPS.md` section 7: add as the newest bullet of the migration run (directly above the newest existing "**Migration" bullet):

```markdown
- **Migrations 0033 and 0034: pending apply** (WP25). `product_daily_stats`,
  `product_stats_latest`, `refresh_market_analytics(date)` (SECURITY DEFINER,
  EXECUTE for pokefin_scraper and service_role only), `fx_daily`, and the
  pg_cron job `pokefin-finalise-market-analytics` (scheduled only when pg_cron
  is enabled). Additive; no existing object changes.
```

## Pitfalls: do not do this

- **Do not re-run 0033 after 0034 is applied.** 0033's `CREATE OR REPLACE` would put back the version of `refresh_market_analytics` without the FX step. The same holds for every later package that replaces the function: only re-run the newest file that defines it. To schedule the cron job after enabling pg_cron, run the single `SELECT cron.schedule(...)` statement from Owner action 3, not a migration.
- **Do not gate series columns on freshness** (tracked high, 52-week high and low, distinct prices, observation count, volatility), and do not leave price-anchored columns ungated. That split is 0023's rule; the DB test checks both halves.
- **Do not compare `products.usd_price` against a past day's row.** It is today's value; the agreement check applies only when the row is also the product's newest.
- **Do not use a raw `max(usd_price)` for the tracked high or the 52-week range.** One thin-market print would set it (the Steam Siege ETB case in `generate_weekly_report.py`).
- **Do not call anything "all-time"**, in SQL comments, TypeScript, copy or metric labels. It is the tracked high since the first tracked day.
- **Do not use `generate_series(date, date, interval)`** in SQL: it yields `timestamptz` and depends on the session time zone. Use the integer series as written.
- **Do not grant the scraper role table privileges** on `product_daily_stats` or `fx_daily`. Writes go through the SECURITY DEFINER function only.
- **Do not leave Supabase's default table grants in place.** `REVOKE ALL ... FROM anon, authenticated` then `GRANT SELECT`: RLS does not stop `TRUNCATE`.
- **Do not make the view SECURITY DEFINER** (drop `security_invoker = true`). Supabase's advisor flags definer views, and anon must go through RLS.
- **Do not change WP10's `get_market_product_metrics`, `get_market_product_summaries` or `get_set_analytics`.** The bounded anchors live in `product_daily_stats` only; moving the catalog onto the table is a later package's job.
- **Do not fall back to today's rate inside `fx.ts`.** A day without a dated rate is `null`. The consumer decides what to show, and must label it.
- **Do not import `format.ts`, `marketMath.ts`, `marketPulse.ts` or React into `fx.ts`.** It ships in the shared bundle.
- **Do not put the FX series or the stats snapshot into `CurrencyProvider` props, the root layout or any client component whole.** Pages pass slices.
- **Do not call `getCachedProductStats()` or `getCachedFxDaily()` from a page in this package**, and never from inside another `unstable_cache` callback.
- **Do not hand-write `app/types/database.ts`** or cast the Supabase client to `any` to get past phase A.
- **Do not let the scraper hook raise.** `refresh_after_run` swallows and logs; `run_jobs_once` must finish and revalidate even when the refresh fails.
- **Do not run the backfills from CI or point `POKEFIN_TEST_DATABASE_URL` at production.** The DB tests write rows and change the `pokefin_scraper` password.
- **Do not retype a number on `/methodology`.** Every window, tolerance and threshold is interpolated from `marketStats.ts`, `fx.ts`, `marketMath.ts` or `marketPulse.ts`, and the drift test ties them to the SQL.
- **Do not edit `verify_migration.py`, `schema.sql` or any existing migration.**
- **Do not apply migrations to production yourself.** They are Owner actions.

## Tests

### 1. `tests/test_wp25_market_analytics_db.py` (new, needs the replayed database)

The SQL fixture test. Skipped unless `POKEFIN_TEST_DATABASE_URL` is set; CI's "Database replay and Python tests" job sets it to `replay_once`. It covers stale-product gating, the cached-price disagreement, the one-day spike, anchor tolerance at every boundary, weekly volatility's minimum, sales and listings gates, derived supply, liquidity percentiles and the peer minimum, weekend FX carry-forward and the 14-day cap, idempotency, input validation, the view's index path, API-role access, the scraper role's EXECUTE, and the 10 s budget on production-size data. It passed 22 of 22 against the scratch database (twice in a row on the same database, so it cleans up after itself).

```python
"""
Database checks for migrations 0033 (product_daily_stats,
refresh_market_analytics) and 0034 (fx_daily), run against a database rebuilt
by scripts/db/replay_migrations.sh.

Skipped unless POKEFIN_TEST_DATABASE_URL points at that replayed database as a
superuser (CI sets it; job "database"). NEVER point it at production: the
fixtures write rows and change the pokefin_scraper password.

  POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/replay_once \
    python -m pytest tests/test_wp25_market_analytics_db.py -v
"""
import os
import time
import uuid
from datetime import date, timedelta
from urllib.parse import urlparse, urlunparse

import pytest

DSN = os.environ.get("POKEFIN_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="POKEFIN_TEST_DATABASE_URL not set")

psycopg = pytest.importorskip("psycopg")
from psycopg import errors  # noqa: E402

TAG = "wp25-" + uuid.uuid4().hex[:8]
SCRAPER_PASSWORD = "ci-only-" + uuid.uuid4().hex
REFRESH_BUDGET_SECONDS = 10


@pytest.fixture(scope="module")
def admin():
    host = (urlparse(DSN).hostname or "").lower()
    assert host in ("localhost", "127.0.0.1", "postgres"), "refusing a non-local database"
    with psycopg.connect(DSN, autocommit=True) as conn:
        yield conn


@pytest.fixture(scope="module")
def today(admin):
    return admin.execute("SELECT (now() AT TIME ZONE 'UTC')::date").fetchone()[0]


@pytest.fixture(scope="module")
def catalog(admin):
    """A set and two product types of this run's own."""
    set_id = admin.execute(
        "INSERT INTO public.sets (code, name) VALUES (%s, %s) RETURNING id", (TAG, TAG + " set")
    ).fetchone()[0]
    main_type = admin.execute(
        "INSERT INTO public.product_types (name, label) VALUES (%s, 'WP25') RETURNING id", (TAG,)
    ).fetchone()[0]
    liq_type = admin.execute(
        "INSERT INTO public.product_types (name, label) VALUES (%s, 'WP25 liq') RETURNING id", (TAG + "-liq",)
    ).fetchone()[0]
    yield {"set_id": set_id, "type": main_type, "liq_type": liq_type}
    admin.execute(
        "DELETE FROM public.product_price_history WHERE product_id IN "
        "(SELECT id FROM public.products WHERE set_id = %s)", (set_id,))
    admin.execute(
        "DELETE FROM public.product_sales_history WHERE product_id IN "
        "(SELECT id FROM public.products WHERE set_id = %s)", (set_id,))
    admin.execute(
        "DELETE FROM public.product_listings_history WHERE product_id IN "
        "(SELECT id FROM public.products WHERE set_id = %s)", (set_id,))
    admin.execute("DELETE FROM public.products WHERE set_id = %s", (set_id,))  # stats rows cascade
    admin.execute("DELETE FROM public.product_types WHERE id IN (%s, %s)", (main_type, liq_type))
    admin.execute("DELETE FROM public.sets WHERE id = %s", (set_id,))


def make_product(admin, catalog, prices, *, cached=None, type_key="type"):
    """prices: {day: usd}. products.usd_price = the newest price unless cached is given."""
    newest = prices[max(prices)] if prices else None
    pid = admin.execute(
        "INSERT INTO public.products (set_id, product_type_id, usd_price, url, last_updated) "
        "VALUES (%s, %s, %s, %s, now()) RETURNING id",
        (catalog["set_id"], catalog[type_key], newest if cached is None else cached,
         f"https://www.tcgplayer.com/product/{uuid.uuid4().int % 10**9}"),
    ).fetchone()[0]
    for day, usd in sorted(prices.items()):
        admin.execute(
            "INSERT INTO public.product_price_history (product_id, usd_price, recorded_at) "
            "VALUES (%s, %s, %s::timestamp + interval '3 hours')",
            (pid, usd, day),
        )
    return pid


def daily(today, first_offset, last_offset, price):
    """{today - offset: price} for offsets first..last inclusive (first >= last)."""
    return {today - timedelta(days=o): price for o in range(last_offset, first_offset + 1)}


def refresh(admin, day):
    return admin.execute("SELECT public.refresh_market_analytics(%s)", (day,)).fetchone()[0]


def stats(admin, day, pid):
    cur = admin.execute(
        "SELECT * FROM public.product_daily_stats WHERE day = %s AND product_id = %s", (day, pid))
    names = [c.name for c in cur.description]
    row = cur.fetchone()
    return dict(zip(names, row)) if row else None


# ---------------------------------------------------------------- price gates


def test_stale_price_is_withheld_and_series_are_kept(admin, catalog, today):
    pid = make_product(admin, catalog, daily(today, 60, 20, 40.0))
    refresh(admin, today)
    s = stats(admin, today, pid)
    assert s["is_price_fresh"] is False
    assert s["price_day"] == today - timedelta(days=20)
    for col in ("usd_price", "ret_1d", "ret_7d", "ret_30d", "ret_90d", "ret_365d",
                "dd_from_high_pct", "pos_in_52w", "ask_premium_pct", "liquidity_score"):
        assert s[col] is None, col
    assert s["tracked_high_usd"] == 40.0
    assert s["first_tracked_day"] == today - timedelta(days=60)
    assert s["distinct_prices_365d"] == 1


def test_cached_price_disagreement_withholds_only_the_current_row(admin, catalog, today):
    prices = daily(today, 10, 0, 20.0)
    pid = make_product(admin, catalog, prices, cached=25.0)
    refresh(admin, today)
    assert stats(admin, today, pid)["is_price_fresh"] is False
    # Yesterday's newest row is not the product's newest, so products.usd_price
    # says nothing about it.
    yesterday = today - timedelta(days=1)
    refresh(admin, yesterday)
    s = stats(admin, yesterday, pid)
    assert s["is_price_fresh"] is True and s["usd_price"] == 20.0


# ---------------------------------------------------------------- tracked high


def test_one_day_spike_does_not_set_the_high_but_three_days_do(admin, catalog, today):
    prices = daily(today, 40, 0, 10.0)
    prices[today - timedelta(days=25)] = 100.0          # one-day spike
    for o in (12, 11, 10):                               # sustained move
        prices[today - timedelta(days=o)] = 30.0
    pid = make_product(admin, catalog, prices)
    refresh(admin, today)
    s = stats(admin, today, pid)
    assert s["tracked_high_usd"] == 30.0
    assert s["tracked_high_day"] == today - timedelta(days=10)
    assert s["high_52w"] == 30.0 and s["low_52w"] == 10.0
    assert s["dd_from_high_pct"] == pytest.approx(-66.6667, abs=1e-3)
    assert s["pos_in_52w"] == pytest.approx(0.0)


def test_fewer_than_three_prices_have_no_tracked_high(admin, catalog, today):
    pid = make_product(admin, catalog, {today - timedelta(days=1): 5.0, today: 6.0})
    refresh(admin, today)
    s = stats(admin, today, pid)
    assert s["tracked_high_usd"] is None and s["high_52w"] is None
    assert s["ret_1d"] == pytest.approx(20.0)


# ---------------------------------------------------------------- anchors


@pytest.mark.parametrize(
    "anchor_offset, column, expected",
    [
        (14, "ret_7d", 25.0),     # oldest accepted: D-7-7
        (15, "ret_7d", None),     # one day too old
        (37, "ret_30d", 25.0),    # oldest accepted: D-30-7
        (38, "ret_30d", None),
        (104, "ret_90d", 25.0),   # oldest accepted: D-90-14
        (105, "ret_90d", None),
        (379, "ret_365d", 25.0),  # oldest accepted: D-365-14
        (380, "ret_365d", None),
    ],
)
def test_return_anchor_tolerance(admin, catalog, today, anchor_offset, column, expected):
    pid = make_product(admin, catalog, {today - timedelta(days=anchor_offset): 80.0, today: 100.0})
    refresh(admin, today)
    s = stats(admin, today, pid)
    if expected is None:
        assert s[column] is None
    else:
        assert s[column] == pytest.approx(expected)
    assert s["ret_1d"] is None  # previous recorded day is more than 3 days back


# ---------------------------------------------------------------- volatility


def test_weekly_volatility_needs_26_weekly_returns(admin, catalog, today):
    flat = make_product(admin, catalog, daily(today, 400, 0, 50.0))
    short = make_product(admin, catalog, daily(today, 120, 0, 50.0))
    refresh(admin, today)
    assert stats(admin, today, flat)["vol_weekly_52w"] == pytest.approx(0.0)
    assert stats(admin, today, short)["vol_weekly_52w"] is None


# ---------------------------------------------------------------- sales, listings


def add_sales(admin, pid, today, days, qty, tx, skip=()):
    for o in range(days):
        if o in skip:
            continue
        admin.execute(
            "INSERT INTO public.product_sales_history (product_id, bucket_date, granularity, "
            "quantity_sold, transaction_count) VALUES (%s, %s, 'day', %s, %s)",
            (pid, today - timedelta(days=o), qty, tx),
        )


def add_listing(admin, pid, day, qty, ask, listings=10):
    admin.execute(
        "INSERT INTO public.product_listings_history (product_id, snapshot_date, active_listings, "
        "total_quantity_available, lowest_listing_price) VALUES (%s, %s, %s, %s, %s)",
        (pid, day, listings, qty, ask),
    )


def test_sales_listings_and_derived_supply(admin, catalog, today):
    pid = make_product(admin, catalog, daily(today, 5, 0, 50.0))
    add_sales(admin, pid, today, 30, qty=2, tx=1)
    add_listing(admin, pid, today, qty=30, ask=55.0)
    add_listing(admin, pid, today - timedelta(days=30), qty=60, ask=50.0)
    holed = make_product(admin, catalog, daily(today, 5, 0, 50.0))
    add_sales(admin, holed, today, 30, qty=2, tx=1, skip={15})
    old_listing = make_product(admin, catalog, daily(today, 5, 0, 50.0))
    add_listing(admin, old_listing, today - timedelta(days=5), qty=30, ask=55.0)
    refresh(admin, today)

    s = stats(admin, today, pid)
    assert (s["units_sold_7d"], s["units_sold_30d"], s["tx_30d"]) == (14, 60, 30)
    assert s["qty_available"] == 30 and s["lowest_ask_usd"] == 55.0
    assert s["ask_premium_pct"] == pytest.approx(10.0)
    assert s["days_of_supply"] == pytest.approx(15.0)
    assert s["sell_through_30d"] == pytest.approx(200 / 3)
    assert s["qty_change_30d_pct"] == pytest.approx(-50.0)
    assert s["qty_change_7d_pct"] is None

    h = stats(admin, today, holed)
    assert h["units_sold_30d"] is None and h["tx_30d"] is None
    assert h["units_sold_7d"] == 14

    o = stats(admin, today, old_listing)
    assert o["active_listings"] is None and o["qty_available"] is None
    assert o["listings_snapshot_date"] == today - timedelta(days=5)


# ---------------------------------------------------------------- liquidity


def test_liquidity_is_a_percentile_within_the_type(admin, catalog, today):
    pids = []
    for i in range(5):
        pid = make_product(admin, catalog, daily(today, 5, 0, 100.0), type_key="liq_type")
        add_sales(admin, pid, today, 30, qty=i + 1, tx=i + 1)
        # More demand, less supply, ask closer to Market Price as i grows.
        add_listing(admin, pid, today, qty=100 - 10 * i, ask=100.0 + 10 * (5 - i))
        pids.append(pid)
    refresh(admin, today)
    scores = [stats(admin, today, pid)["liquidity_score"] for pid in pids]
    assert scores == [0, 25, 50, 75, 100]

    admin.execute("UPDATE public.products SET active = false WHERE id = %s", (pids[0],))
    try:
        refresh(admin, today)
        assert stats(admin, today, pids[0]) is None  # inactive product leaves the day
        # Four peers are too few for a percentile.
        assert [stats(admin, today, p)["liquidity_score"] for p in pids[1:]] == [None] * 4
    finally:
        admin.execute("UPDATE public.products SET active = true WHERE id = %s", (pids[0],))


# ---------------------------------------------------------------- FX


def test_fx_daily_carries_weekends_and_stops_after_14_days(admin, today):
    fri, mon = date(2021, 6, 4), date(2021, 6, 7)
    ids = [r[0] for r in admin.execute(
        "INSERT INTO public.exchange_rates (usd_to_cad, recorded_at) VALUES "
        "(1.2100, %s), (1.2150, %s), (1.2200, %s) RETURNING id",
        (fri, mon, mon),
    ).fetchall()]
    try:
        refresh(admin, today)
        rows = {r[0]: r[1:] for r in admin.execute(
            "SELECT day, usd_to_cad, source_date, source FROM public.fx_daily "
            "WHERE day BETWEEN %s AND %s", (fri, mon + timedelta(days=20))).fetchall()}
        assert rows[fri] == (1.21, fri, "boc")
        assert rows[date(2021, 6, 5)] == (1.21, fri, "carry_forward")
        assert rows[date(2021, 6, 6)] == (1.21, fri, "carry_forward")
        assert rows[mon] == (1.22, mon, "boc")               # newest row of the date wins
        assert rows[mon + timedelta(days=14)][1] == mon      # carried 14 days
        assert mon + timedelta(days=15) not in rows          # and no further
    finally:
        admin.execute("DELETE FROM public.exchange_rates WHERE id = ANY(%s)", (ids,))
        admin.execute("DELETE FROM public.fx_daily WHERE day < DATE '2022-01-01'")


# ---------------------------------------------------------------- contract


def test_refresh_is_idempotent(admin, catalog, today):
    pid = make_product(admin, catalog, daily(today, 400, 0, 70.0))
    refresh(admin, today)
    first = stats(admin, today, pid)
    refresh(admin, today)
    second = stats(admin, today, pid)
    first.pop("refreshed_at"), second.pop("refreshed_at")
    assert first == second


def test_refresh_rejects_future_and_ancient_days(admin, today):
    for bad in (today + timedelta(days=1), date(2019, 12, 31)):
        with pytest.raises(errors.InvalidParameterValue):
            refresh(admin, bad)


def test_latest_view_is_one_indexed_read(admin, today):
    """The view's day filter is served by the primary key. A table this small
    may be seq-scanned by choice, so seq scans are disabled to prove the index
    path exists; production's plan is checked in Owner actions."""
    refresh(admin, today)
    admin.execute("BEGIN")
    try:
        admin.execute("SET LOCAL enable_seqscan = off")
        plan = admin.execute(
            "EXPLAIN (FORMAT JSON) SELECT * FROM public.product_stats_latest").fetchone()[0]
    finally:
        admin.execute("ROLLBACK")

    def nodes(node):
        yield node
        for child in node.get("Plans", []):
            yield from nodes(child)

    all_nodes = list(nodes(plan[0]["Plan"]))
    assert not [n for n in all_nodes
                if n["Node Type"] == "Seq Scan" and n.get("Relation Name") == "product_daily_stats"]
    assert "product_daily_stats_pkey" in {n.get("Index Name") for n in all_nodes}
    day = admin.execute("SELECT max(day) FROM public.product_stats_latest").fetchone()[0]
    assert day in (today, None)


def as_role(admin, role):
    admin.execute("BEGIN")
    admin.execute(f"SET LOCAL ROLE {role}")


def test_api_roles_read_but_cannot_write_or_refresh(admin, today):
    for role in ("anon", "authenticated"):
        as_role(admin, role)
        try:
            admin.execute("SELECT count(*) FROM public.product_stats_latest").fetchone()
            admin.execute("SELECT count(*) FROM public.product_daily_stats").fetchone()
            admin.execute("SELECT count(*) FROM public.fx_daily").fetchone()
        finally:
            admin.execute("ROLLBACK")
        for stmt in (
            "TRUNCATE public.product_daily_stats",
            "TRUNCATE public.fx_daily",
            "DELETE FROM public.fx_daily",
            f"SELECT public.refresh_market_analytics('{today}'::date)",
            f"SELECT public.refresh_product_daily_stats('{today}'::date)",
            f"SELECT public.refresh_fx_daily('{today}'::date)",
        ):
            as_role(admin, role)
            try:
                with pytest.raises(errors.InsufficientPrivilege):
                    admin.execute(stmt)
            finally:
                admin.execute("ROLLBACK")


@pytest.fixture(scope="module")
def scraper_db(admin):
    from scraper_db import ScraperDB

    admin.execute(f"ALTER ROLE pokefin_scraper PASSWORD '{SCRAPER_PASSWORD}'")
    parts = urlparse(DSN)
    netloc = f"pokefin_scraper:{SCRAPER_PASSWORD}@{parts.hostname}:{parts.port or 5432}"
    db = ScraperDB(urlunparse(parts._replace(netloc=netloc)))
    yield db
    db.close()


def test_scraper_role_runs_the_refresh_and_fx_backfill(admin, scraper_db, today):
    result = scraper_db.refresh_market_analytics(today)
    assert result["day"] == today.isoformat()
    assert isinstance(result["product_rows"], int) and "fx_rows" in result
    day = date(2021, 3, 1)
    try:
        assert scraper_db.insert_missing_exchange_rates([(day, 1.2601)]) == 1
        assert scraper_db.insert_missing_exchange_rates([(day, 1.2601)]) == 0   # idempotent
    finally:
        admin.execute("DELETE FROM public.exchange_rates WHERE recorded_at::date = %s", (day,))
    with pytest.raises(psycopg.Error):
        scraper_db._execute("DELETE FROM public.product_daily_stats")


# ---------------------------------------------------------------- budget


def test_refresh_runs_in_under_10_seconds_at_production_size(admin, catalog, today):
    """306 products, 600 days of prices, 90 days of sales, 85 of listings."""
    admin.execute(
        """
        WITH p AS (
          INSERT INTO public.products (set_id, product_type_id, usd_price, url, last_updated)
          SELECT %(set)s, %(type)s, NULL, 'https://www.tcgplayer.com/product/wp25-' || g, now()
            FROM generate_series(1, 306) g
          RETURNING id
        ), h AS (
          INSERT INTO public.product_price_history (product_id, usd_price, recorded_at)
          SELECT p.id, 40 + (p.id %% 50) + 5 * sin(g / 20.0), (%(today)s::date - g)::timestamp + interval '2 hours'
            FROM p CROSS JOIN generate_series(0, 599) g
           WHERE (p.id + g) %% 19 <> 0
          RETURNING product_id
        ), s AS (
          INSERT INTO public.product_sales_history (product_id, bucket_date, granularity, quantity_sold, transaction_count)
          SELECT p.id, %(today)s::date - g, 'day', (p.id + g) %% 7, (p.id + g) %% 5
            FROM p CROSS JOIN generate_series(0, 89) g
          RETURNING product_id
        )
        INSERT INTO public.product_listings_history (product_id, snapshot_date, active_listings,
                                                     total_quantity_available, lowest_listing_price)
        SELECT p.id, %(today)s::date - g, 20, 50 + g, 45 FROM p CROSS JOIN generate_series(0, 84) g
        """,
        {"set": catalog["set_id"], "type": catalog["type"], "today": today},
    )
    admin.execute(
        "UPDATE public.products p SET usd_price = h.usd_price FROM public.product_price_history h "
        "WHERE p.set_id = %s AND p.usd_price IS NULL AND h.product_id = p.id "
        "AND h.recorded_at::date = %s", (catalog["set_id"], today))
    admin.execute("ANALYZE")
    started = time.monotonic()
    refresh(admin, today)
    elapsed = time.monotonic() - started
    assert elapsed < REFRESH_BUDGET_SECONDS, f"refresh took {elapsed:.1f}s"
```

### 2. `tests/test_wp25_scripts.py` (new, unit, no network, no database)

`market_analytics.py` and both scripts. 20 cases, all passing on the prototype.

```python
"""
Unit tests for WP25's Python: market_analytics.py, scripts/backfill_fx_valet.py
and scripts/backfill_daily_stats.py. No network, no database.

  python -m pytest tests/test_wp25_scripts.py -v
"""
import importlib.util
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import MagicMock

import pytest

import market_analytics

ROOT = Path(__file__).resolve().parents[1]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fx = load_script("backfill_fx_valet")
stats = load_script("backfill_daily_stats")


# ------------------------------------------------------------ market_analytics


class TestCallRefresh:
    def test_uses_the_scraper_role_connection_first(self):
        pg_db, supabase = MagicMock(), MagicMock()
        pg_db.refresh_market_analytics.return_value = {"product_rows": 306}
        assert market_analytics.call_refresh(date(2026, 9, 30), pg_db=pg_db, supabase=supabase) == {"product_rows": 306}
        pg_db.refresh_market_analytics.assert_called_once_with(date(2026, 9, 30))
        supabase.rpc.assert_not_called()

    def test_falls_back_to_the_rpc(self):
        supabase = MagicMock()
        supabase.rpc.return_value.execute.return_value.data = {"product_rows": 5}
        assert market_analytics.call_refresh(date(2026, 9, 30), supabase=supabase) == {"product_rows": 5}
        supabase.rpc.assert_called_once_with("refresh_market_analytics", {"p_day": "2026-09-30"})

    def test_raises_without_a_client(self):
        with pytest.raises(RuntimeError):
            market_analytics.call_refresh(date(2026, 9, 30))


class TestRefreshAfterRun:
    def test_defaults_to_today_utc(self, monkeypatch):
        monkeypatch.setattr(market_analytics, "utc_today", lambda: date(2026, 9, 30))
        pg_db = MagicMock()
        pg_db.refresh_market_analytics.return_value = {"day": "2026-09-30"}
        assert market_analytics.refresh_after_run(pg_db=pg_db) == {"day": "2026-09-30"}
        pg_db.refresh_market_analytics.assert_called_once_with(date(2026, 9, 30))

    def test_never_raises_and_names_missing_migrations(self, caplog):
        supabase = MagicMock()
        supabase.rpc.return_value.execute.side_effect = Exception(
            "PGRST202 Could not find the function public.refresh_market_analytics(p_day)")
        assert market_analytics.refresh_after_run(date(2026, 9, 30), supabase=supabase) is None
        assert "apply migrations 0033 and 0034" in caplog.text

    def test_other_errors_are_logged_not_raised(self, caplog):
        pg_db = MagicMock()
        pg_db.refresh_market_analytics.side_effect = TimeoutError("statement timeout")
        assert market_analytics.refresh_after_run(date(2026, 9, 30), pg_db=pg_db) is None
        assert "Market analytics refresh failed" in caplog.text


# ------------------------------------------------------------ backfill_fx_valet

VALET = {
    "observations": [
        {"d": "2024-01-02", "FXUSDCAD": {"v": "1.3316"}},
        {"d": "2024-01-03", "FXUSDCAD": {"v": "1.3340"}},
        {"d": "2024-01-04", "FXUSDCAD": {}},              # no value
        {"d": "2024-01-05", "FXUSDCAD": {"v": "abc"}},    # malformed
        {"d": "2024-01-08", "FXUSDCAD": {"v": "13.35"}},  # outside the sanity band
        {"d": "2023-12-29", "FXUSDCAD": {"v": "1.3226"}}, # outside the requested range
    ]
}


def valet_session(payload=VALET, status=200):
    session = MagicMock()
    response = session.get.return_value
    response.json.return_value = payload
    response.raise_for_status.side_effect = None if status == 200 else Exception(f"HTTP {status}")
    return session


class TestFetchObservations:
    def test_parses_and_filters(self):
        session = valet_session()
        got = fx.fetch_observations(date(2024, 1, 1), date(2024, 1, 31), session=session)
        assert got == [(date(2024, 1, 2), 1.3316), (date(2024, 1, 3), 1.334)]
        _, kwargs = session.get.call_args
        assert kwargs["params"] == {"start_date": "2024-01-01", "end_date": "2024-01-31"}
        assert kwargs["timeout"] == fx.REQUEST_TIMEOUT_SECONDS

    def test_rejects_an_unexpected_shape(self):
        with pytest.raises(ValueError):
            fx.fetch_observations(date(2024, 1, 1), date(2024, 1, 31), session=valet_session({"error": "x"}))

    def test_http_errors_raise(self):
        with pytest.raises(Exception, match="HTTP 500"):
            fx.fetch_observations(date(2024, 1, 1), date(2024, 1, 31), session=valet_session(status=500))


class TestInsertMissing:
    OBS = [(date(2024, 1, 2), 1.3316), (date(2024, 1, 3), 1.334)]

    def test_scraper_role_path_is_one_statement_per_chunk(self):
        pg_db = MagicMock()
        pg_db.insert_missing_exchange_rates.return_value = 2
        assert fx.insert_missing(self.OBS, pg_db=pg_db) == 2
        pg_db.insert_missing_exchange_rates.assert_called_once_with(self.OBS)

    def test_service_key_path_skips_dates_that_have_a_row(self):
        supabase = MagicMock()
        select = supabase.table.return_value.select.return_value
        chain = select.gte.return_value.lt.return_value.order.return_value.range.return_value
        chain.execute.return_value.data = [{"recorded_at": "2024-01-02T00:00:00"}]
        assert fx.insert_missing(self.OBS, supabase=supabase) == 1
        supabase.table.return_value.insert.assert_called_once_with(
            [{"usd_to_cad": 1.334, "recorded_at": "2024-01-03T00:00:00"}])

    def test_rerun_inserts_nothing(self):
        supabase = MagicMock()
        select = supabase.table.return_value.select.return_value
        chain = select.gte.return_value.lt.return_value.order.return_value.range.return_value
        chain.execute.return_value.data = [
            {"recorded_at": "2024-01-02T00:00:00"}, {"recorded_at": "2024-01-03T00:00:00"}]
        assert fx.insert_missing(self.OBS, supabase=supabase) == 0
        supabase.table.return_value.insert.assert_not_called()


class TestFxMain:
    def test_dry_run_writes_nothing(self, capsys):
        pg_db = MagicMock()
        assert fx.main(["--start", "2024-01-01", "--end", "2024-01-31", "--dry-run"],
                       clients=(pg_db, None), session=valet_session()) == 0
        pg_db.insert_missing_exchange_rates.assert_not_called()
        assert "2 daily rates" in capsys.readouterr().out

    def test_writes_and_closes(self):
        pg_db = MagicMock()
        pg_db.insert_missing_exchange_rates.return_value = 2
        assert fx.main(["--start", "2024-01-01", "--end", "2024-01-31"],
                       clients=(pg_db, None), session=valet_session()) == 0
        pg_db.close.assert_called_once_with()

    def test_rejects_a_future_end(self):
        with pytest.raises(SystemExit):
            fx.parse_args(["--end", (date.today() + timedelta(days=2)).isoformat()])


# ------------------------------------------------------------ backfill_daily_stats


class TestDailyStatsBackfill:
    def test_default_range_is_400_days_ending_today(self):
        args = stats.parse_args([])
        assert (args.end - args.start).days == stats.DEFAULT_DAYS - 1

    def test_start_is_clamped_to_the_function_floor(self):
        args = stats.parse_args(["--start", "2019-06-01", "--end", "2020-01-10"])
        assert args.start == date(2020, 1, 1)

    def test_calls_every_day_oldest_first(self):
        call = MagicMock(return_value={"product_rows": 1})
        pg_db = MagicMock()
        assert stats.main(["--start", "2026-01-01", "--end", "2026-01-03"],
                          clients=(pg_db, None), call=call) == 0
        assert [c.args[0] for c in call.call_args_list] == [
            date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 3)]
        pg_db.close.assert_called_once_with()

    def test_stops_on_the_first_failure_and_prints_the_resume_point(self, capsys):
        call = MagicMock(side_effect=[{"ok": 1}, RuntimeError("timeout"), {"ok": 1}])
        assert stats.main(["--start", "2026-01-01", "--end", "2026-01-03"],
                          clients=(MagicMock(), None), call=call) == 1
        assert call.call_count == 2
        assert "--start 2026-01-02 --end 2026-01-03" in capsys.readouterr().err

    def test_dry_run_calls_nothing(self):
        call = MagicMock()
        assert stats.main(["--start", "2026-01-01", "--end", "2026-01-03", "--dry-run"],
                          clients=(MagicMock(), None), call=call) == 0
        call.assert_not_called()
```

### 3. `tests/test_main.py` (update): hook order

Append:

```python
class TestRunJobsOnceMarketAnalytics:
    """WP25: analytics refresh after a successful run, before revalidation."""

    def test_refreshes_before_revalidating(self):
        import main
        calls = []
        with patch("main.fetch_and_store_exchange_rate", return_value=False), \
             patch("main.update_prices", return_value=3), \
             patch("main.refresh_after_run", side_effect=lambda **kw: calls.append("refresh")) as refresh, \
             patch("main.trigger_site_revalidation", side_effect=lambda: calls.append("revalidate")):
            main.run_jobs_once()
        assert calls == ["refresh", "revalidate"]
        refresh.assert_called_once_with(pg_db=main.pg_db, supabase=main.supabase)

    def test_refreshes_even_when_nothing_was_updated(self):
        import main
        with patch("main.fetch_and_store_exchange_rate", return_value=False), \
             patch("main.update_prices", return_value=0), \
             patch("main.refresh_after_run") as refresh, \
             patch("main.trigger_site_revalidation") as trigger:
            main.run_jobs_once()
        refresh.assert_called_once()
        trigger.assert_not_called()

    def test_skips_when_update_prices_fails(self):
        import main
        with patch("main.fetch_and_store_exchange_rate", return_value=True), \
             patch("main.update_prices", side_effect=RuntimeError("chrome died")), \
             patch("main.refresh_after_run") as refresh:
            main.run_jobs_once()
        refresh.assert_not_called()

    def test_a_failed_refresh_still_revalidates(self):
        import main
        with patch("main.fetch_and_store_exchange_rate", return_value=False), \
             patch("main.update_prices", return_value=2), \
             patch("main.refresh_after_run", return_value=None), \
             patch("main.trigger_site_revalidation") as trigger:
            main.run_jobs_once()
        trigger.assert_called_once_with()
```

WP11's `TestRunJobsOnce` cases do not patch `refresh_after_run`, and `main.supabase` in `test_main.py` is a real supabase-py client for `https://test.supabase.co`, so the unpatched hook would attempt a network call. Add this fixture as the first member of WP11's `class TestRunJobsOnce:` (and of any other test class that calls `main.run_jobs_once()`: `grep -rn "run_jobs_once()" tests/`):

```python
    @pytest.fixture(autouse=True)
    def _no_market_analytics_refresh(self):
        """WP25: keep run_jobs_once's analytics hook off the network in unit tests."""
        with patch("main.refresh_after_run", return_value=None):
            yield
```

Their assertions do not change.

### 4. `tests/test_db_roles_integration.py` (WP21): no change

It must keep passing; the new migrations add no grant to `pokefin_scraper` beyond EXECUTE.

### 5. `frontend/app/lib/__tests__/fx.test.ts` (new, `@jest-environment node`)

```ts
/** @jest-environment node */
import {
  buildFxSeries,
  cadReturnPercent,
  createFxLookup,
  EMPTY_FX_SERIES,
  FX_CARRY_MAX_DAYS,
  rateOn,
  sliceFxSeries,
  toCadAtDatedRates,
  usdToCadOn,
  type FxDailyRow,
} from "../fx";

const ROWS: FxDailyRow[] = [
  { day: "2026-09-25", usd_to_cad: 1.36, source_date: "2026-09-25", source: "boc" },
  { day: "2026-09-26", usd_to_cad: 1.36, source_date: "2026-09-25", source: "carry_forward" },
  // 2026-09-27 missing on purpose (a gap)
  { day: "2026-09-28", usd_to_cad: 1.4, source_date: "2026-09-28", source: "boc" },
];

describe("fx", () => {
  const series = buildFxSeries([...ROWS].reverse()); // order does not matter

  it("builds a dense series with gaps as null", () => {
    expect(series).toEqual({ start: "2026-09-25", rates: [1.36, 1.36, null, 1.4], latestSourceDate: "2026-09-28" });
  });

  it("ignores unusable rows and returns the empty series for none", () => {
    expect(buildFxSeries([])).toBe(EMPTY_FX_SERIES);
    expect(buildFxSeries([{ ...ROWS[0], usd_to_cad: 0 }, { ...ROWS[1], day: "bad" }])).toBe(EMPTY_FX_SERIES);
  });

  it("returns the rate of the day, null before the start and in a gap", () => {
    expect(rateOn(series, "2026-09-26")).toBe(1.36);
    expect(rateOn(series, "2026-09-27")).toBeNull();
    expect(rateOn(series, "2026-09-24")).toBeNull();
    expect(rateOn(series, "2026-09-28T23:59:59")).toBe(1.4); // a recorded_at string works too
  });

  it(`carries the last rate at most ${FX_CARRY_MAX_DAYS} days past the end`, () => {
    expect(rateOn(series, "2026-10-12")).toBe(1.4); // 14 days after 09-28
    expect(rateOn(series, "2026-10-13")).toBeNull();
  });

  it("converts amounts and series at dated rates", () => {
    expect(usdToCadOn(series, "2026-09-25", 100)).toBe(136);
    expect(usdToCadOn(series, "2026-09-25", null)).toBeNull();
    expect(toCadAtDatedRates([{ dateKey: "2026-09-27", price: 5 }, { dateKey: "2026-09-28", price: 10 }], series)).toEqual([
      { dateKey: "2026-09-27", price: null },
      { dateKey: "2026-09-28", price: 14 },
    ]);
  });

  it("includes the currency move in a CAD return", () => {
    // Flat USD price, CAD up 1.36 -> 1.40: +2.94% for a CAD holder.
    expect(cadReturnPercent(series, { day: "2026-09-25", usd: 100 }, { day: "2026-09-28", usd: 100 })).toBeCloseTo(2.9412, 3);
    expect(cadReturnPercent(series, { day: "2026-09-27", usd: 100 }, { day: "2026-09-28", usd: 100 })).toBeNull();
  });

  it("slices from a day and keeps the latest source date", () => {
    expect(sliceFxSeries(series, "2026-09-26")).toEqual({ start: "2026-09-26", rates: [1.36, null, 1.4], latestSourceDate: "2026-09-28" });
    expect(sliceFxSeries(series, "2026-09-01")).toBe(series);
    expect(sliceFxSeries(series, "2026-10-30")).toBe(EMPTY_FX_SERIES);
  });

  it("binds helpers with createFxLookup", () => {
    const fx = createFxLookup(series);
    expect(fx.usdToCadOn("2026-09-28", 10)).toBe(14);
    expect(fx.rateOn("2026-09-25")).toBe(1.36);
  });
});
```

### 6. `frontend/app/lib/__tests__/marketStatsConstants.test.ts` (new, `@jest-environment node`)

Proves every constant `/methodology` prints equals the SQL (same technique as WP24's `methodologyConstants.test.ts`).

```ts
/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";
import { FX_CARRY_MAX_DAYS } from "../fx";
import {
  LIQUIDITY_MIN_PEERS,
  ONE_DAY_PREVIOUS_MAX_GAP_DAYS,
  RETURN_ANCHOR_WINDOWS,
  SUPPLY_CHANGE_TOLERANCE_DAYS,
  TRACKED_HIGH_ROLLING_ROWS,
  VOL_WEEKLY_MIN_RETURNS,
  WEEKS_PER_YEAR,
} from "../marketStats";
import {
  DAILY_DATA_STALENESS_TOLERANCE_DAYS,
  LISTINGS_STALENESS_TOLERANCE_DAYS,
  PRICE_STALENESS_TOLERANCE_DAYS,
} from "../marketPulse";

const MIGRATIONS = path.resolve(__dirname, "../../../../migrations");

/** Text of the highest-numbered NNNN_*.sql file that defines `fn`. */
function newestDefinition(fn: string): string {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort().reverse();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    if (new RegExp(`FUNCTION\\s+public\\.${fn}\\s*\\(`, "i").test(sql)) return sql;
  }
  throw new Error(`no numbered migration defines ${fn}`);
}

describe("refresh_product_daily_stats mirrors", () => {
  const sql = newestDefinition("refresh_product_daily_stats");

  it("return windows and anchor tolerances", () => {
    const values = sql.match(/VALUES\s*((?:\('\w+',\s*\d+,\s*\d+\),?\s*)+)\s*AS w\(label, days, tolerance\)/);
    expect(values).not.toBeNull();
    const parsed = [...values![1].matchAll(/\('(\w+)',\s*(\d+),\s*(\d+)\)/g)].map((m) => ({
      key: `ret_${m[1]}`,
      days: Number(m[2]),
      toleranceDays: Number(m[3]),
    }));
    expect(parsed).toEqual(RETURN_ANCHOR_WINDOWS.map(({ key, days, toleranceDays }) => ({ key, days, toleranceDays })));
  });

  it("freshness gates equal marketPulse", () => {
    expect(sql).toContain(`lt.price_day >= p_day - ${PRICE_STALENESS_TOLERANCE_DAYS}`);
    expect(sql).toContain(`sa.newest_day >= p_day - ${DAILY_DATA_STALENESS_TOLERANCE_DAYS}`);
    expect(sql).toContain(`cur.snapshot_date >= p_day - ${LISTINGS_STALENESS_TOLERANCE_DAYS}`);
  });

  it("1D gap, rolling rows, weekly volatility, supply tolerance and liquidity peers", () => {
    expect(sql).toContain(`(f.price_day - ${ONE_DAY_PREVIOUS_MAX_GAP_DAYS})::timestamp`);
    expect(sql).toContain(`ROWS BETWEEN ${TRACKED_HIGH_ROLLING_ROWS - 1} PRECEDING AND CURRENT ROW`);
    expect(sql).toContain(`r.n3 = ${TRACKED_HIGH_ROLLING_ROWS}`);
    expect(sql).toContain(`count(r) >= ${VOL_WEEKLY_MIN_RETURNS}`);
    expect(sql).toContain(`sqrt(${WEEKS_PER_YEAR})`);
    expect(sql).toContain(`cur.snapshot_date - ${7 + SUPPLY_CHANGE_TOLERANCE_DAYS} AND cur.snapshot_date - 7`);
    expect(sql).toContain(`cur.snapshot_date - ${30 + SUPPLY_CHANGE_TOLERANCE_DAYS} AND cur.snapshot_date - 30`);
    expect(sql).toContain(`count(*) OVER peers >= ${LIQUIDITY_MIN_PEERS}`);
  });
});

describe("refresh_fx_daily mirrors", () => {
  it("the carry-forward cap equals FX_CARRY_MAX_DAYS", () => {
    const sql = newestDefinition("refresh_fx_daily");
    expect(sql).toContain(`m.day - m.source_date <= ${FX_CARRY_MAX_DAYS}`);
  });
});
```

If WP24 left `DAILY_DATA_STALENESS_TOLERANCE_DAYS` or `LISTINGS_STALENESS_TOLERANCE_DAYS` unexported (`grep -n "export const DAILY_DATA_STALENESS_TOLERANCE_DAYS\|export const LISTINGS_STALENESS_TOLERANCE_DAYS" frontend/app/lib/marketPulse.ts`), add `export` to their declarations; change nothing else in `marketPulse.ts`.

### 7. `frontend/app/lib/__tests__/marketStats.test.ts` (new, node)

- `toProductStatsSnapshot` keys rows by `product_id`, takes the newest `day`, skips a row whose `product_id` or `day` is not the right type, turns `is_price_fresh: null` into `false`, and returns `{ day: null, byProductId: {} }` for `[]`.
- `statsFor(snapshot, 999)` returns `null` for an unknown id.
- `RETURN_ANCHOR_WINDOWS` labels are a subset of `Object.keys(RETURN_WINDOW_DAYS)` from `marketMath.ts` and each `days` equals `RETURN_WINDOW_DAYS[label]`.

### 8. `frontend/app/lib/__tests__/serverMarketData.stats.test.ts` (new, `@jest-environment node`)

Same `server-only`, `@supabase/supabase-js`, `../logger` and `next/cache` mocks as `serverMarketData.freshness.test.ts` (`unstable_cache: (fn) => fn`). A chain helper:

```ts
function tableMock(pages: Array<{ data: unknown[] | null; error: unknown }>) {
  const calls = { select: [] as string[], order: [] as unknown[][], range: [] as number[][] };
  let i = 0;
  const chain = {
    select(columns: string) { calls.select.push(columns); return chain; },
    order(...args: unknown[]) { calls.order.push(args); return chain; },
    range(from: number, to: number) {
      calls.range.push([from, to]);
      return Promise.resolve(pages[Math.min(i++, pages.length - 1)]);
    },
  };
  return { chain, calls };
}
```

Cases:
- `getCachedProductStats` reads `product_stats_latest` (assert `fromMock` was called with it), the select string contains `liquidity_score` and `refreshed_at` and no `*`, orders by `product_id` ascending, and returns `{ day: "2026-09-30", byProductId: { 1: ..., 2: ... } }` for two rows.
- A row with `product_id: null` is skipped.
- An error (`{ data: null, error: { message: "down" } }`) returns `{ day: null, byProductId: {} }` and calls `logCaughtError` with `"server_product_stats_failed"`.
- `getCachedFxDaily` pages: first page 1000 rows (`day` from `2024-01-01` on, `source: "boc"`), second page 3 rows; `calls.range` equals `[[0, 999], [1000, 1999]]`, `calls.order[0]` equals `["day", { ascending: true }]`, and the series has `rates.length === 1003` and `start === "2024-01-01"`.
- Rows with `source: "other"` are dropped; an all-invalid read returns `EMPTY_FX_SERIES`.
- An error returns `EMPTY_FX_SERIES` and logs `"server_fx_daily_failed"`.
- 10 full pages in a row make the read throw inside, so the wrapper returns `EMPTY_FX_SERIES` (no partial series).

Build the 1000 rows with a loop over `Date.UTC(2024, 0, 1 + i)`; do not hand-write them.

### 9. `frontend/app/context/__tests__/CurrencyContext.fx.test.tsx` (new, jsdom)

```tsx
import { act, render } from "@testing-library/react";
import {
  CurrencyProvider,
  _resetCurrencyPreferenceForTests,
  useCurrency,
  type CurrencyContextValue,
} from "../CurrencyContext";
import { buildFxSeries, EMPTY_FX_SERIES } from "../../lib/fx";

const FX = buildFxSeries([
  { day: "2026-09-28", usd_to_cad: 1.3, source_date: "2026-09-28", source: "boc" },
  { day: "2026-09-29", usd_to_cad: 1.4, source_date: "2026-09-29", source: "boc" },
]);
const POINTS = [
  { dateKey: "2026-09-27", price: 10 },
  { dateKey: "2026-09-28", price: 10 },
  { dateKey: "2026-09-29", price: 20 },
];

let ctx: CurrencyContextValue;
function Probe() {
  ctx = useCurrency();
  return null;
}

beforeEach(() => {
  _resetCurrencyPreferenceForTests();
  window.localStorage.clear();
});

it("converts a USD series at each day's rate when CAD is selected", () => {
  render(<CurrencyProvider initialRate={{ rate: 1.5, date: "2026-09-29" }}><Probe /></CurrencyProvider>);
  expect(ctx.currency).toBe("CAD");
  expect(ctx.convertDailySeries(POINTS, FX)).toEqual([
    { dateKey: "2026-09-27", price: null },
    { dateKey: "2026-09-28", price: 13 },
    { dateKey: "2026-09-29", price: 28 },
  ]);
});

it("returns USD points unchanged when USD is selected", () => {
  render(<CurrencyProvider initialRate={{ rate: 1.5, date: "2026-09-29" }}><Probe /></CurrencyProvider>);
  act(() => ctx.setCurrency("USD"));
  expect(ctx.convertDailySeries(POINTS, FX)).toEqual(POINTS);
});

it("never falls back to the current rate when the FX series is empty", () => {
  render(<CurrencyProvider initialRate={{ rate: 1.5, date: "2026-09-29" }}><Probe /></CurrencyProvider>);
  expect(ctx.convertDailySeries(POINTS, EMPTY_FX_SERIES).every((p) => p.price === null)).toBe(true);
});

it("works outside the provider (component tests)", () => {
  render(<Probe />);
  expect(ctx.convertDailySeries(POINTS, FX)[2].price).toBe(28);
});
```

If WP20 named the reset helper differently, use its name (`grep -n "export function _reset" frontend/app/context/CurrencyContext.tsx`).

### 10. Updates to WP24's tests

- `app/lib/__tests__/metricDefinitions.test.ts`: add a case: `metricHref("trackedHigh")` is `/methodology#tracked-high`, `metricHref("liquidityScore")` is `/methodology#liquidity`, `metricHref("sellThrough30d")` is `/methodology#sell-through`, `metricHref("supplyChange30d")` is `/methodology#supply-trend`, `metricHref("askPremium")` is `/methodology#ask-premium`, `metricHref("volatilityWeekly52w")` is `/methodology#volatility`. The existing cases (unique keys, 120-character limit, real anchors, banned words) cover the new entries unchanged.
- `app/methodology/__tests__/MethodologyArticle.test.tsx`: add cases:
  - the provenance line contains `Version 1.1` (it reads `METHODOLOGY_VERSION`, so the existing case already asserts this; keep it);
  - `#changes` has two rows, the first with `METHODOLOGY_VERSION` and the second with `1.0`;
  - `tr[data-window="7D"]` contains `${7 + 7} days` and `tr[data-window="1Y"]` contains `${365 + 14} days`, both computed from `RETURN_ANCHOR_WINDOWS`; `tr[data-window="1D"]` contains `String(ONE_DAY_PREVIOUS_MAX_GAP_DAYS)`; `tr[data-window="6M"]` contains `not used`;
  - `tr[data-vol="weekly"]` contains `√${WEEKS_PER_YEAR}` and `String(VOL_WEEKLY_MIN_RETURNS)`;
  - `#tracked-high` contains `String(TRACKED_HIGH_ROLLING_ROWS)` and the text `tracked high since`; `#range-52w` exists;
  - `#liquidity` contains `String(LIQUIDITY_MIN_PEERS)` and every entry of `LIQUIDITY_COMPONENTS`;
  - `#currency` contains `${FX_CARRY_MAX_DAYS}` and `rate of each day`;
  - `#supply-trend` contains `String(SUPPLY_CHANGE_TOLERANCE_DAYS)`.
  The existing anchor-existence, em dash and axe cases cover the new sections unchanged.

## Verification

Repo root:

```bash
python3 verify_migration.py migrations/0033_product_daily_stats.sql > /dev/null; echo "exit=$?"   # exit=3
python3 verify_migration.py migrations/0034_fx_daily.sql > /dev/null; echo "exit=$?"             # exit=3

PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh
# "OK: <N> files replayed once (replay_once) and twice (replay_twice)"

python -m pytest tests/ -q
# all pass; tests/test_wp25_market_analytics_db.py skips (22 more skipped than the baseline)

POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once python -m pytest tests/ -q
# all pass, 0 skipped from tests/test_wp25_market_analytics_db.py (22 passed) and
# tests/test_db_roles_integration.py; run it twice: the second run must pass too

python -m pytest tests/test_wp25_scripts.py tests/test_main.py -q      # all pass
python3 -m py_compile scripts/backfill_fx_valet.py scripts/backfill_daily_stats.py market_analytics.py
python scripts/backfill_daily_stats.py --dry-run                       # "Refreshing 400 days, ...", "Dry run: nothing called."
```

Timing on the replayed database (the DB test enforces it; this prints the number for the PR):

```bash
psql "postgresql://postgres:postgres@localhost:55432/replay_once" -c "\timing on" \
  -c "SELECT public.refresh_market_analytics((now() AT TIME ZONE 'UTC')::date)"
```

From `frontend/` (phase B, after step 15):

```bash
pnpm exec tsc --noEmit                                       # exit 0
pnpm lint                                                    # 0 errors (WP17 gate)
pnpm test --ci app/lib/__tests__/fx app/lib/__tests__/marketStats app/lib/__tests__/marketStatsConstants \
  app/lib/__tests__/serverMarketData app/context app/lib/__tests__/metricDefinitions app/methodology
# all pass
pnpm test --ci                                               # whole suite passes
pnpm build:stub                                              # exit 0; route table unchanged
grep -cP '\x{2014}' app/lib/fx.ts app/lib/marketStats.ts app/methodology/MethodologyArticle.tsx   # 0 each (no em dashes)
```

Performance (WP22):

```bash
SUPABASE_STUB_FIXTURE=perf pnpm build:stub     # no "(no fixture route)" lines
pnpm perf:serve &                              # wait for .perf/ready
pnpm perf:budget                               # exit 0, every row "ok" or "over target" as before
```

Expected: shared JS grows by at most 1 kB gz (the `fx.ts` import in `CurrencyProvider`); every route's document size is unchanged except `/methodology` (a few kB of new prose, within its limit). If any limit is breached, remove the cause (almost always a heavier import in `fx.ts`); do not raise a limit.

Manual checks (`pnpm dev` is not needed; `pnpm perf:serve` serves the stub build):
- `/methodology` at 390 px: no horizontal scroll; the returns table's third column wraps inside the article; the new sections appear in the "On this page" list in order (Max drawdown, Tracked high and 52-week range, Trend, ... Listings, Liquidity score, Market Pulse).
- `/methodology` at 1440 px: the sticky table of contents lists the two new sections; `#liquidity` and `#tracked-high` links scroll to their headings; the change log shows 1.1 above 1.0.
- `/prices` and `/` at both widths: visually unchanged.

## Owner actions

1. **Depth checks first.** Run the read-only queries in `research/data-opportunities.md` §7 in the Supabase SQL editor and paste the results into the PR. They set expectations: listings history length decides when `qty_change_30d_pct` fills in, and the FX range decides how far back the Valet backfill must go (the default is 2020-01-01).
2. **Apply the migrations** with Supabase MCP `apply_migration` (preferred) or the SQL editor, in order: `0033_product_daily_stats.sql`, then `0034_fx_daily.sql`. The 0034 output shows either "pg_cron job ... scheduled" or the NOTICE with the statement to run. Then run each file's `verify_migration.py` query: 0033 returns 39 OK and one `MISMATCH` for `refresh_market_analytics` body (superseded by 0034, expected); 0034 returns 25 OK. Then:

```sql
SELECT public.refresh_market_analytics((now() AT TIME ZONE 'UTC')::date);   -- note "ms"; expect well under 10000
SELECT (SELECT count(*) FROM public.product_stats_latest), (SELECT count(*) FROM public.products WHERE active);  -- equal
EXPLAIN ANALYZE SELECT * FROM public.product_stats_latest;  -- product_daily_stats read through product_daily_stats_pkey
```

   The refresh is SECURITY DEFINER, so it reads the source tables as the role that applied the migration. RLS does not filter that role if it owns the tables or has BYPASSRLS. If the refresh returns `"product_rows": 0` while active products exist, run `SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user;` and `SELECT relname, pg_get_userbyid(relowner) FROM pg_class WHERE relname IN ('products', 'product_price_history', 'product_sales_history', 'product_listings_history', 'exchange_rates');`, paste both into the PR and stop. Do not add policies to work around it.

3. **Enable pg_cron and schedule the job.** Dashboard > Database > Extensions > enable `pg_cron`. Then run exactly:

```sql
SELECT cron.schedule('pokefin-finalise-market-analytics', '30 0 * * *',
  $cmd$SELECT public.refresh_market_analytics((now() AT TIME ZONE 'UTC')::date - 1)$cmd$);
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'pokefin-finalise-market-analytics';  -- 1 row
```

The next day: `SELECT status, return_message, start_time FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'pokefin-finalise-market-analytics') ORDER BY start_time DESC LIMIT 3;` shows `succeeded`. Do not re-apply 0033 to schedule it.

4. **Types for phase B.** Run `pnpm types:db` with your access token and push `frontend/app/types/database.ts` to the branch, or give the executor a token.
5. **Backfills** (from the repo root, with the scraper env sourced: `set -a && source ~/.config/pokefin/env && set +a`):

```bash
python scripts/backfill_fx_valet.py --dry-run     # "Valet: <N> daily rates from 2020-01-01 to <today>"
python scripts/backfill_fx_valet.py               # "Inserted <M> rows; ..."; a second run inserts 0
python scripts/backfill_daily_stats.py            # about 400 x 1 s; on a failure it prints the --start to resume from
```

Then check:

```sql
SELECT min(day), max(day), count(*), max(day) - min(day) + 1 AS span FROM public.fx_daily;  -- count = span
SELECT count(DISTINCT day), min(day), max(day) FROM public.product_daily_stats;             -- about 400 days
SELECT count(*) FILTER (WHERE vol_weekly_52w IS NOT NULL) AS vol,
       count(*) FILTER (WHERE liquidity_score IS NOT NULL) AS liquidity,
       count(*) FILTER (WHERE tracked_high_usd IS NOT NULL) AS tracked_high
  FROM public.product_stats_latest;
```

Paste the outputs into the PR.

6. **After merge**, watch the next scraper run's log for `Market analytics refreshed for <date>: {...}` before `Site caches revalidated.`. A `Market analytics refresh skipped: ... apply migrations 0033 and 0034` line means step 2 was not done on this database.
7. **Record it.** In `audits/HARDENING_FOLLOWUPS.md` section 7, change "**Migrations 0033 and 0034: pending apply**" to "**Migrations 0033 and 0034 applied** (YYYY-MM-DD, via Supabase MCP)", add the refresh `ms`, the backfill counts and whether pg_cron is scheduled, and commit to master as `docs: record migrations 0033-0034 as applied`.

## Acceptance criteria

- [ ] `migrations/0033_product_daily_stats.sql` and `migrations/0034_fx_daily.sql` exist with the content of steps 1 and 2; no other migration file changed.
- [ ] `scripts/db/replay_migrations.sh` passes with both files (applied once and twice).
- [ ] `verify_migration.py` exits 3 for both; after apply, every row is OK except 0033's superseded `refresh_market_analytics` body.
- [ ] `tests/test_wp25_market_analytics_db.py`: 22 passed against `replay_once`, twice in a row; skipped without the env var.
- [ ] The DB tests prove: stale product has `usd_price`, returns, drawdown, position, ask premium and liquidity `NULL` with the tracked high kept; a one-day spike does not set the tracked high; each return anchor is accepted exactly at `window + tolerance` days and rejected one day later; a weekend carries Friday's rate as `carry_forward`; no FX row more than 14 days after the newest rate; refresh under 10 s at production size.
- [ ] anon and authenticated can SELECT `product_daily_stats`, `product_stats_latest` and `fx_daily`, and cannot TRUNCATE, DELETE or execute any of the three refresh functions; `pokefin_scraper` can execute `refresh_market_analytics` and cannot delete from `product_daily_stats`.
- [ ] `main.run_jobs_once` calls `refresh_after_run` after a successful `update_prices` and before `trigger_site_revalidation`; a failed refresh still revalidates; `tests/test_main.py` passes.
- [ ] `scripts/backfill_fx_valet.py` and `scripts/backfill_daily_stats.py` exist, are executable, support `--dry-run`, and `tests/test_wp25_scripts.py` passes (20 cases).
- [ ] `app/lib/fx.ts` has no import statement; `CurrencyProvider` exposes `convertDailySeries`; the root layout passes nothing new.
- [ ] `getCachedProductStats()` and `getCachedFxDaily()` exist, are tagged with WP11's tags, degrade uncached on error, and no page calls them.
- [ ] `perf.mjs` routes `/rest/v1/product_stats_latest` and `/rest/v1/fx_daily`; `pnpm perf:budget` exits 0 with no limit raised.
- [ ] `/methodology` shows version 1.1 with the new sections and a two-row change log; every number in the new text is an interpolated constant; the drift test passes.
- [ ] `app/types/database.ts` is regenerated (phase B) and contains the four new names; `tsc`, lint and the whole Jest suite pass.
- [ ] README and `audits/HARDENING_FOLLOWUPS.md` updated (step 16).

## Rollback

- **Code**: revert the PR commit. The scraper stops calling the refresh; the fetchers disappear (nothing calls them); `/methodology` returns to v1.0. The tables stay and are harmless.
- **Stop the nightly job only**: `SELECT cron.unschedule('pokefin-finalise-market-analytics');`
- **Database** (after the code revert, as a new numbered migration `NNNN_drop_market_analytics.sql` at the next free number, never by editing 0033 or 0034):

```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pokefin-finalise-market-analytics') THEN
    PERFORM cron.unschedule('pokefin-finalise-market-analytics');
  END IF;
END $$;
DROP VIEW IF EXISTS public.product_stats_latest;
DROP FUNCTION IF EXISTS public.refresh_market_analytics(date);
DROP FUNCTION IF EXISTS public.refresh_product_daily_stats(date);
DROP FUNCTION IF EXISTS public.refresh_fx_daily(date);
DROP TABLE IF EXISTS public.product_daily_stats;
DROP TABLE IF EXISTS public.fx_daily;
```

  Do this only if no later package (WP28 onward) depends on them; those packages must be reverted first.
- **Backfilled exchange rates**: keep them. They are real Bank of Canada rates stored the same way as the scraper's.

## Commit and PR

Branch: `remediation/wp25-market-analytics-foundation`.

Commit message:

```text
feat(data): daily product stats and dated FX (WP25)

Every Track 2 metric needs window functions over the whole price history,
and every CAD figure was converted at today's rate, so a Canadian's CAD
return left out the currency move.

- 0033: product_daily_stats (one row per active product per UTC day) with
  bounded return anchors, tracked high (max of a 3-row rolling min), 52-week
  range, weekly volatility, sales and listings under the 0018-0023 gates,
  sell-through, supply change and a liquidity percentile; written by
  refresh_market_analytics(p_day), SECURITY DEFINER, EXECUTE for
  pokefin_scraper and service_role only; view product_stats_latest.
- 0034: fx_daily (BoC rate per day, carried at most 14 days) and the
  00:30 UTC pg_cron job that finalises D-1 when pg_cron is enabled.
- Scraper refreshes after each successful run, before revalidation.
- Backfills: Bank of Canada Valet into exchange_rates; 400 days of stats.
- lib/fx.ts, lib/marketStats.ts, cached getCachedProductStats and
  getCachedFxDaily, CurrencyProvider.convertDailySeries, perf fixture routes.
- /methodology v1.1: tracked high, 52-week range, liquidity, sell-through,
  supply trend, lowest ask, weekly volatility, dated CAD, anchor ages.
```

PR title: `feat(data): market analytics foundation, daily stats and dated FX (WP25)`

PR body:
- Goal in two sentences and a link to this spec.
- Phase status: "[waiting for DB types]" until step 15, then removed.
- Verification output: `verify_migration.py` stderr for both files, `replay_migrations.sh` last line, pytest summaries with and without `POKEFIN_TEST_DATABASE_URL` (both runs of the DB module), the refresh timing on `replay_once`, tsc, lint, Jest summary, `perf:budget` table before and after.
- Screenshots of `/methodology` at 390 and 1440 px: the returns table, `#tracked-high`, `#liquidity`, the change log.
- Owner actions 1 to 7 copied from this spec, with the outputs of 1, 2 and 5 once the owner has run them.
- Any dependency artifact that was missing and what was done (Before you start).
- "Noticed, out of scope": the catalog RPC's returns still accept an unbounded anchor (the catalog moves to `product_daily_stats` in WP30 or WP33); `/product/[id]` and the portfolio still convert CAD history at the latest rate (WP31, WP36); `product_daily_stats` has no retention rollup (revisit after two years); the scraper still inserts about six duplicate `exchange_rates` rows per day (harmless now that `fx_daily` dedupes; a WP16-style upsert is a later cleanup).
