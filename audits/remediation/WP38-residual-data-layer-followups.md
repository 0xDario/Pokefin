# WP38: Residual data-layer follow-ups

- **Findings covered**
  - F146 (medium; the remainder no package scheduled). WP11 step 5 fixed the verified defect (the server fallback now pages its year of history newest first). Left over: three "newest price per product" reads still page `product_price_history` through PostgREST 1000 rows at a time and fold the pages in JavaScript: `fetchNewestPricedAt` in `serverMarketData.ts` (behind the fallback catalog and WP05's `fetchNewestPricedAtForProducts`), `fetchNewestPricedAtClient` in `clientMarketData.ts` and, through it, `fetchRecordedAtForMissing` in `portfolio.ts`. This package adds the SQL function `get_latest_prices(p_product_ids bigint[])` (one index probe per product, migration 0023's gate applied in SQL) and rewrites all three on top of it (steps 1, 6, 7, 8). The other half of the F146 recommendation, a per-product anchor RPC to replace the about 50 serial year-of-history pages of the server fallback, is deliberately not built: see "Checked against WP22 to WP37 and not done here" below.
  - F143 (residual). WP05 moved the `/portfolio` page-load prices server-side and WP11 serves `/compare` and `/box-calculator` from the server, but the add-holding product search and the Collectr import matcher still download the whole `get_market_product_summaries` result (the heaviest RPC) from each browser to price a handful of results (`portfolio.ts` `getFreshProductsById`, at most once per tab per hour). Step 8 prices search and import results with `get_latest_prices` scoped to exactly the result ids.
  - Residual created by the plan (WP06 owner action 5, open bullet in `audits/HARDENING_FOLLOWUPS.md`): WP06's migration 0026 added `box_recipes.currency`, but `export_my_data()` (0011, made VOLATILE by WP01's 0024) lists its columns and never exports it. Step 2 adds the key by patching the function in place (see "Before you start", decision 2, for why not a full redefinition).
  - F064 recommendation part 2 (residual after WP11). WP11 made every cached server read throw on a failed query so `unstable_cache` keeps the last good value, and deliberately kept the summaries fallback (WP11 Pitfalls). Still open: a read that SUCCEEDS with zero rows (an RLS or grant mistake, an emptied table) is stored as an empty catalog for up to a day and every ISR page regenerates empty. Step 6c treats an empty catalog as a failure at runtime and keeps accepting it during `next build`, so `pnpm build:stub` and a deploy during an outage still build.
  - N01 (medium; full, with both verifiers' corrections): the Collectr import matcher labels the wrong variant "exact" (the set-name check runs before the variant check, and every candidate shares the set), imports a blank cost as a $0 basis, silently drops every Collectr portfolio not named "Sealed Product", never validates the date, and the preview hides the matched variant. Steps 10 and 11. Latent until F001 is fixed (WP04/WP05 landed before this package, so it is live now).
  - N02 (medium; full, magnitude as corrected by the verifiers): the Market Pulse 7-day and 30-day volume windows end on the partial current-day bucket, so flat demand reads as a falling trend (-2% to -5% on the 30-day trend) and "Units sold (7d)" runs 7 to 21% low. Step 3 (the RPC, a new migration after WP10's 0027) and step 9 (`marketPulse.ts`, which `/product/[id]` uses) move both together.
  - N03 (residual UX item only; WP17 closed the rest): "Try again" in `app/error.tsx` and `app/global-error.tsx` calls `reset()` alone, which re-renders without refetching, so a failed server fetch cannot recover. Step 12.
  - N05 (low; residual): `main.py` scrapes the Bank of Canada HTML table, inserts the same rate every 4 hours, and nothing alerts when the rate goes stale. Step 16 switches to the Valet `FXUSDCAD` JSON API, stores one row per observation date and logs `exchange_rate_stale` past 4 business days; step 6d adds the same age check to the site's server read (a Sentry event, through WP17's logger); step 13 adds the exported `isExchangeRateStale` helper and a once-per-tab check in the browser read; step 14 states on the price chart that CAD uses today's rate. Covered elsewhere: dated FX for history, returns and cost basis (WP25 `fx_daily`, WP31 product chart, WP36 portfolio); the rate date beside the currency toggle (WP27 `rateSentence`, which should use the helper: see "Handoffs"). `ReturnMetrics` needs nothing: WP18 step 7 removed its currency inputs, so its returns are USD returns by construction.
  - N08 (low; full, with the verifiers' narrowing): `compare_prices.py` compares Shopify prices against unguarded, possibly months-old `products.usd_price`, includes inactive products and never prints the price date; `update_shopify_skus.py` stamps the parent SKU on every variant row and lets a Japanese listing take an English SKU; SKU-keyed loaders drop duplicate SKUs silently. Steps 15, 17 and 18. (WP16 covered only the token on the command line, F138.)
- **Checked against WP22 to WP37 and not done here**
  - F045 item 4 (one settings object for the `ProductCard` props on `/prices`): not done. WP30 step 15 replaces `ProductCard.tsx` and its whole props interface, and steps 16 to 18 rewrite the containers that pass them, after this package. A `cardSettings` prop added here would be thrown away by WP30 and would break the anchors WP26 step 13 and WP30 step 15 look for. F045 stays partially open in the tracker; the owner decides whether WP30 should take a single settings prop (Owner actions, item 6).
  - F095 recommendation (a CI contrast check): not covered by Track 2 either. WP23 adds axe-core to component tests but disables `color-contrast` (jsdom has no layout), and WP22's Lighthouse CI runs the performance category only. Not done here: a contrast check needs a real browser, which arrives with WP22's Lighthouse job. Owner actions, item 7, records the recommendation (add Lighthouse's accessibility category with a `color-contrast` assertion to WP22's `lighthouserc.json`).
  - The per-product anchor RPC of F146: declined. The fallback it would speed up runs only while `get_market_product_summaries` is failing, and that RPC's slow part is `get_market_product_metrics` (WP10 0028), which already computes the anchors with index probes. A second SQL copy of the return anchors would have to be kept in step with 0028 and WP25 for a path that runs during outages, and would fail for the same reason the summaries did. The fallback keeps its about 50 serial pages; after this package it no longer adds the freshness pages on top.
  - F064 failure path: WP11 owns it (throw inside caches, degrade outside). This package adds only the empty-success case.
  - `export_my_data` and later migrations: WP34 (0038) and WP35 (0039) redefine the function in full from 0024's body, which lacks `currency`; WP36 (0040) patches it in place and keeps every key. See decision 2 and Owner actions, item 4.
- **Priority rationale**: N01 and N02 are medium and user-visible (wrong holdings recorded against the wrong product; a biased demand signal on three pages). The rest are cheap once the data-layer files are open, and the two migrations that F146 and N02 need would otherwise each cost a separate PR and owner apply.
- **Effort**: L, 18 to 20 hours (three migrations with a DB test 3 h; latest-price reads and the empty-catalog rule 3 h; volume anchor in TypeScript and its test updates 2 h; import matcher, cost, portfolio picker and preview 4 h; error retry, FX helper and chart label 1.5 h; Python FX, compare and SKU scripts with tests 3 h; docs and verification 1.5 h).
- **Depends on** (all merged, in plan order): WP01 (0024 `export_my_data`), WP05 (`priceFreshness.ts`, `fetchNewestPricedAtForProducts`, `portfolioRepo.ts`, the import keys and `importHoldings` rewrite, `maxPurchaseDateKey`), WP06 (0026 `box_recipes.currency`), WP07 (`formatMoney`), WP10 (0027 volume RPC, `tests/test_wp10_market_rpc_bounds.py`), WP11 (`DAILY_BACKSTOP_SECONDS`, `fetchSetAnalyticsFromRpc`, the `getCachedSetAnalytics` wrapper, `fetchLatestExchangeRate` that throws, newest-first fallback, `run_jobs_once()`), WP12 (`supabaseLoader.ts`), WP14 (`Dialog` in `ImportHoldingsModal.tsx`), WP15 (restyled error pages), WP16 (`compare_prices.py` token handling), WP17 (`matchProduct` exported, `PriceTooltip` at module scope, logger reaches Sentry), WP18 (`lib/csv.ts` parser in `import.ts`, `app/compare/shopifyCsv.ts`, `CompareDashboard.tsx`), WP20 (`app/lib/currency.ts`, typed clients, `pnpm types:db`), WP21 (`scraper_db.py`, `pg_db` in `main.py`, read-only key in `compare_prices.py`, replay harness and CI job "Database replay and Python tests").
- **Placement**: end of Track 1, after WP21 and before WP22. It changes no file a Track 2 package creates.
- **Migrations**: three new files, named here with the placeholder `NNNN`: `migrations/NNNN_get_latest_prices.sql`, `migrations/NNNN_export_includes_box_recipe_currency.sql`, `migrations/NNNN_volume_windows_complete_days.sql`. The plan's migration registry (`audits/remediation/00-PLAN.md`) assigns the three numbers. They must sort after every Track 2 reservation that touches the same functions: the export patch above 0039 (WP34 and WP35 redefine `export_my_data` in full), the volume file above 0027. In practice that means three consecutive numbers from 0043 upward, coordinated with WP21 phase B's "next free" files. Wherever this spec says `NNNN_<name>`, use the registry's number for that file, inside the SQL comments too.
- **Handoffs to later specs** (the plan maintainer applies them; this package cannot edit those packages' code because it runs first):
  - WP22 test 8 (`app/__tests__/errorBoundarySentry.test.tsx`) renders `app/error.tsx`, which calls `useRouter()` after this package: the test needs `jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }))`, or `useRouter` throws "invariant expected app router to be mounted".
  - WP25 `refresh_market_analytics`: its `sales` CTE sums `p_day - 29 .. p_day`, the same partial-day window N02 describes. To agree with the RPC after step 3, it should end each window on `LEAST(p_day - 1, newest_day)` while `newest_day >= p_day - 3` (else `p_day - 1`), exactly as step 3's `window_anchor` does with `current_date`.
  - WP27 `rateSentence`: append " (stale)" when `isExchangeRateStale(date)` (step 13) is true.
  - WP34 step 1 section 5 and WP35 step 1 section 9: add `'currency', currency,` after `'promo_value', promo_value,` in their full `export_my_data` bodies. Until they do, Owner actions, item 4 applies.
- **Suggested branch name**: `remediation/wp38-residual-data-layer-followups`
- **Risk level**: medium. It changes the volume RPC behind `/market`, `/prices` and `/product/[id]` (a deliberate output change: the windows move by one day), the price reads behind the fallback catalog and portfolio search, and the scraper's FX source. Each is bounded by a test that fails on the old code, and the three migrations are additive or `CREATE OR REPLACE` with an unchanged shape.

## Why

A handful of defects survived the 22-package plan because each sat between two packages. A Canadian collector importing a Collectr export that holds a Pokemon Center Elite Trainer Box gets it recorded as the standard box, labelled "exact" and preselected, with the variant nowhere on screen; rows without a cost become free holdings; a renamed Collectr portfolio imports nothing. Every product's 7-day and 30-day sales windows include today's half-collected bucket, so flat demand reads as cooling on `/market`, `/prices` and every product page. A failed product page cannot recover from "Try again". The exchange rate comes from parsing a Bank of Canada web page, is inserted again every four hours, and can go stale with no alarm. The seller tools price inventory against numbers the site itself refuses to show. On the data side, three code paths still page price history 1000 rows at a time to find one row per product, the portfolio search downloads the whole catalog's metrics to price twenty results, a data export leaves out which currency each saved recipe is in, and an empty catalog read would be cached for a day. After this PR each of those is fixed at its source, with a test that fails on the old behaviour.

## Before you start

Read these first (paths relative to the repo root; frontend paths after `frontend/`):

- `migrations/0023_price_freshness_guard.sql` (the price gate, `:180-200` and `:224-244`; the `(product_id, recorded_at DESC)` index at `:125-134`), `migrations/0011_export_my_data.sql` and `migrations/0024_export_my_data_volatile.sql` (WP01), `migrations/0026_*.sql` (WP06: `box_recipes.currency`), `migrations/0027_bounded_volume_metrics.sql` (WP10: the volume RPC this package replaces; read its header), `tests/test_wp10_market_rpc_bounds.py` (its volume checks must keep passing).
- `audits/remediation/WP36-portfolio-analytics.md` step 1d (the in-place `export_my_data` patch this package copies), WP34 step 1f and WP35's "Before you start" (their `grep -ln "FUNCTION public.export_my_data"` checks), WP11 step 5 and Pitfalls (fallback), WP10 step 1.
- `frontend/app/lib/serverMarketData.ts`: `fetchPriceHistoryPages`, `fetchNewestPricedAt` and WP05's `fetchNewestPricedAtForProducts` below it, `fetchProductsWithFallbackReturns`, `fetchMarketProductSummaries`, `fetchSetAnalyticsFromRpc`, `fetchLatestExchangeRate`, the cached exports at the bottom (WP11).
- `frontend/app/lib/clientMarketData.ts` (`fetchNewestPricedAtClient`, `fetchProductsFallback`; WP12's `getSupabase`/`getSupabaseOrNull` lines), `frontend/app/lib/portfolio.ts` (WP05's header comment, `getFreshProductsById`, `fetchRecordedAtForMissing`, `applyFreshPricesToSearchResults`, `searchProducts`, `searchProductsBySet`, `getAllProducts`), `frontend/app/lib/priceFreshness.ts` (WP05).
- `frontend/app/lib/marketPulse.ts` (`getUnitsSoldWindow`, `countDayCoverage`, `getPriorUnitsSold30d`, the constants above them) and `frontend/app/lib/__tests__/marketPulse.test.ts`.
- `frontend/app/lib/import.ts`, `frontend/app/lib/__tests__/import.test.ts` (WP17 and WP18 appended cases), `frontend/app/lib/__tests__/import.holdings.test.ts` (WP05), `frontend/app/components/Portfolio/cards/ImportHoldingsModal.tsx`, `frontend/app/components/Portfolio/__tests__/PortfolioModals.a11y.test.tsx` (WP14; it mocks `lib/import` with a fixed list of exports), `frontend/app/lib/validation.ts` (WP05's `isValidPastDate(s, maxDateKey?)`).
- `frontend/app/error.tsx`, `frontend/app/global-error.tsx`, `frontend/app/lib/currency.ts` (WP20), `frontend/app/lib/exchangeRate.ts`, `frontend/app/components/PriceChart.tsx` (`PriceTooltip`), `frontend/app/compare/shopifyCsv.ts`, `frontend/app/compare/CompareDashboard.tsx` (`handleCsvUpload`, the `errorMessage` block).
- `main.py` (`fetch_and_store_exchange_rate`, `normalize_hyphens`, `run_jobs_once`), `scraper_db.py` (WP21), `compare_prices.py`, `update_shopify_skus.py`, `requirements.txt`, `tests/test_main.py` (header: how `main` is imported).

Confirm the starting state (repo root):

```bash
git checkout master && git pull && git checkout -b remediation/wp38-residual-data-layer-followups

# 1. Migration numbers: the registry in audits/remediation/00-PLAN.md names three numbers for WP38.
grep -n "WP38" audits/remediation/00-PLAN.md          # read the three numbers
ls migrations | sort | tail -12                        # none of them may exist yet
grep -ln "FUNCTION public.export_my_data" migrations/*.sql
# expect 0011 and 0024, plus 0038/0039 only if WP34/WP35 merged early (fine either way: step 2 patches in place)
grep -ln "FUNCTION public.get_market_product_volume_metrics" migrations/*.sql | sort | tail -1
# expect migrations/0027_bounded_volume_metrics.sql (WP10). If a later file is listed, STOP: copy its body instead of 0027's in step 3 and say so in the PR.
grep -rn "get_latest_prices" migrations/ frontend/app       # expect no output

# 2. Track 1 landed (names this spec edits)
grep -n "export async function fetchNewestPricedAtForProducts" frontend/app/lib/serverMarketData.ts   # WP05
grep -n "async function fetchSetAnalyticsFromRpc\|const DAILY_BACKSTOP_SECONDS" frontend/app/lib/serverMarketData.ts   # WP11, 2 lines
grep -n "export async function fetchNewestPricedAtClient" frontend/app/lib/clientMarketData.ts
grep -n "getSupabase" frontend/app/lib/clientMarketData.ts | head -3                                 # WP12
grep -n "async function getFreshProductsById\|async function fetchRecordedAtForMissing" frontend/app/lib/portfolio.ts   # 2 lines
grep -n "export function matchProduct\|import { parseCsv }" frontend/app/lib/import.ts               # WP17, WP18
grep -n "export async function importHoldings(" -A2 frontend/app/lib/import.ts                       # WP05: (matches: ImportMatchResult[])
grep -n "export function isValidPastDate\|export function maxPurchaseDateKey" frontend/app/lib/validation.ts   # WP05
grep -n "<Dialog" frontend/app/components/Portfolio/cards/ImportHoldingsModal.tsx                     # WP14
grep -n "export function PriceTooltip" frontend/app/components/PriceChart.tsx                         # WP17
grep -n "export function parseShopifyCsv" frontend/app/compare/shopifyCsv.ts                          # WP18
grep -n "export const DEFAULT_EXCHANGE_RATE" frontend/app/lib/currency.ts                             # WP20
grep -n '"types:db"' frontend/package.json                                                            # WP20
grep -n "def insert_exchange_rate" scraper_db.py                                                      # WP21
grep -n "^pg_db = \|def run_jobs_once" main.py                                                        # WP21, WP11
grep -n "load_supabase_readonly_credentials" compare_prices.py                                        # WP21
ls scripts/db/replay_migrations.sh tests/test_wp10_market_rpc_bounds.py

# 3. The defects still exist
grep -n 'portfolioName !== "Sealed Product"' frontend/app/lib/import.ts       # 1 line (N01)
grep -n "safeFloat(values\[9\]" frontend/app/lib/import.ts                    # 1 line (N01: blank cost becomes 0)
grep -n "onClick={reset}" frontend/app/error.tsx frontend/app/global-error.tsx  # 2 lines (N03)
grep -n "table_daily_1" main.py                                               # 1 line (N05)
grep -n "new_row\[sku_idx\] = current_match\['sku'\]" update_shopify_skus.py  # 2 lines (N08)
grep -n "'market_price': row.get('usd_price')" compare_prices.py              # 1 line (N08)
```

If a Track 1 check prints nothing, stop and report which package has not landed; this spec edits their output and must not recreate it.

Decisions and assumptions:

1. **`get_latest_prices` returns the gated price and the raw row.** The three paging reads returned "newest row inside the 14-day window" maps that `guardedPrice`/`resolvePrice` then judged against a separately read `products.usd_price`. To keep those callers' behaviour identical, the wrappers keep returning the same maps (`newestPricedAtInWindow`, step 5): the RPC returns the newest row whatever its age, and the wrapper drops rows older than the window, which is exactly what the paged `recorded_at >= windowStart` read produced. The search and import path (step 8) instead uses the RPC's own gated `usd_price`: it is 0023's verdict computed from one statement, the same rule `get_market_product_summaries` applies. Ids are passed for every portfolio call, so deactivated products keep their price (WP11's constraint: filter on `active` only when no ids are passed).
2. **`export_my_data` is patched in place, not redefined.** The plan suggested a full `CREATE OR REPLACE` with 0024's body plus the column. That is wrong once Track 2 exists: the registry numbers this file after 0038 and 0039, so in a replayed database a full 0024-based body here would delete WP34's `watchlist` key and WP35's `price_alerts`/`alert_email` keys, and WP35's check would stop at "a file numbered 0040 or above replaces export_my_data". Step 2 uses WP36's proven pattern (`pg_get_functiondef` plus one anchored `replace()`), which keeps VOLATILE, SECURITY DEFINER, the search_path and the ACL, keeps every key, and never contains the text `FUNCTION public.export_my_data`.
3. **The volume windows end on the last complete day.** The review's fix anchors the current windows at `current_date - 1` and shifts the prior window by the same anchor. That alone still includes a partial bucket for every product not yet visited today: the scraper visits each product every 23 hours and stores the visit day's bucket while it is still filling (`main.py` `parse_daily_sales_buckets`), so a product's newest bucket is always partial, whatever its date. The anchor is therefore the day before the newest usable bucket, never later than `current_date - 1`: `LEAST(newest_day_bucket - 1, current_date - 1)`. It applies only while the newest bucket is inside the 3-day freshness tolerance; for a stale product the windows are withheld anyway and the anchor stays at yesterday, which keeps every read inside a 67-day bound. The freshness gate itself (`newest_day_bucket >= current_date - 3`) does not move. Measured on flat demand with a partial newest bucket: the yesterday-only anchor still gives a 7d figure of 64 instead of 70 for a product last visited 1 to 3 days ago; this anchor gives 70.
4. **An empty catalog is a failure at runtime only.** During `next build` (`process.env.NEXT_PHASE === "phase-production-build"`, which Next sets before it starts the prerender workers) an empty read is returned as before, so `pnpm build:stub` (an empty stub by design) and a deploy during an outage still build. At runtime it throws inside the cached function, so `unstable_cache` stores nothing and the page that is regenerating fails, which makes ISR keep serving the last good page.
5. **Two phases, like WP25.** `supabase.rpc("get_latest_prices", ...)` does not type-check until `app/types/database.ts` contains the function, and that file is generated from production (WP20). Phase A is steps 1 to 3 and 5 to 19 plus every test; at its end open a draft PR titled `[waiting for DB types] fix: residual data-layer follow-ups (WP38)` and hand the owner Owner actions 1 and 2. Phase B is step 4. Until then the only allowed `tsc` failures are the `get_latest_prices` calls in `serverMarketData.ts` and `clientMarketData.ts`; Jest runs without type-checking, so every test must already pass in phase A. Never hand-edit `database.ts` and never cast the client to get past it.
6. **No local database is required**, but if you have PostgreSQL 16 (`/usr/lib/postgresql/16/bin`), run WP21's replay harness and the DB test (Verification) before opening the PR.

## Implementation steps

Steps 1 to 3 are SQL and need nothing else. Step 4 is phase B. Steps 5 to 15 are the frontend (paths relative to `frontend/`), steps 16 to 18 the Python scripts, step 19 the docs. Write each test from the Tests section with the step it covers.

The three SQL files below were run on PostgreSQL 16 while this spec was written: each applied twice in a row without error, the DB test in Tests 1 passed against them (12 passed) and failed against the previous definitions (5 failed), and `verify_migration.py` printed the hashes given in Verification.

### Step 1. `migrations/NNNN_get_latest_prices.sql` (new; F146, F143)

Exact content (replace `NNNN` in the comments with the registry's numbers):

```sql
-- Migration: get_latest_prices(p_product_ids), the newest recorded price per
-- product in one index-ordered read (WP38; review F146 and F143 remainders).
--
-- Three places in the frontend asked "what is the newest price row of each
-- product?" by paging product_price_history through PostgREST 1000 rows at a
-- time and folding the pages in JavaScript:
--   * fetchNewestPricedAt (frontend/app/lib/serverMarketData.ts), behind the
--     server fallback catalog and WP05's fetchNewestPricedAtForProducts;
--   * fetchNewestPricedAtClient (frontend/app/lib/clientMarketData.ts), behind
--     the browser fallback catalog and the portfolio product search;
--   * the portfolio product search and the Collectr import matcher
--     (frontend/app/lib/portfolio.ts), which also downloaded the whole market
--     summaries (get_market_product_summaries, the heaviest RPC) from each
--     browser just to price a handful of search results.
-- This function answers it with one probe of
-- idx_price_history_product_recorded (product_id, recorded_at DESC, 0023) per
-- product.
--
-- Columns:
--   product_id          the product.
--   price_recorded_at   recorded_at of its newest product_price_history row.
--                       Not gated: a caller that gets no price can still say
--                       when the product was last priced (as 0023's
--                       get_market_product_summaries does).
--   recorded_usd_price  usd_price of that same row.
--   usd_price           products.usd_price, published only under migration
--                       0023's gate, verbatim: the newest row is at most 14
--                       days old (14 = PRICE_STALENESS_TOLERANCE_DAYS in
--                       frontend/app/lib/marketPulse.ts) AND products.usd_price
--                       IS NOT DISTINCT FROM that row's usd_price. Otherwise
--                       NULL. Value and date come from one statement, so the
--                       comparison is the same-moment check 0023 makes.
-- A product with no history row at all returns no row (callers treat a
-- missing product as "never priced").
--
-- p_product_ids NULL means every ACTIVE product. When ids are passed, the
-- active flag is NOT applied: the portfolio prices holdings of deactivated
-- products too, and filtering them would blank their price (WP11, F146 note).
-- Unknown ids return no row; a repeated id returns one row.
--
-- Ties: the unique index on (product_id, recorded_at::date) allows one row
-- per product per day, so "ORDER BY recorded_at DESC LIMIT 1" has one answer.
--
-- SECURITY INVOKER and STABLE: it reads two anon-readable tables
-- (0001 policies) through the caller's own grants and RLS.
--
-- Idempotent.
--
-- Verification (after apply):
--   -- Same answer as the 0023 gate for every active product (expect 0 rows):
--   SELECT s.id
--     FROM public.get_market_product_summaries() s
--     FULL JOIN public.get_latest_prices(NULL) l ON l.product_id = s.id
--    WHERE l.product_id IS NOT NULL
--      AND (s.id IS NULL
--           OR s.usd_price IS DISTINCT FROM l.usd_price
--           OR s.price_recorded_at IS DISTINCT FROM l.price_recorded_at);
--   -- One index probe per product, no Sort over the history (expect
--   -- "Index Scan using idx_price_history_product_recorded" or an equivalent
--   -- production index on (product_id, recorded_at DESC), and well under 100 ms):
--   EXPLAIN ANALYZE SELECT * FROM public.get_latest_prices(NULL);
--   -- anon may call it (expect true):
--   SELECT has_function_privilege('anon', 'public.get_latest_prices(bigint[])', 'EXECUTE');

CREATE OR REPLACE FUNCTION public.get_latest_prices(p_product_ids bigint[] DEFAULT NULL)
RETURNS TABLE (
  product_id bigint,
  price_recorded_at timestamp without time zone,
  recorded_usd_price double precision,
  usd_price double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
SELECT
  p.id AS product_id,
  lp.recorded_at AS price_recorded_at,
  lp.usd_price AS recorded_usd_price,
  -- 0023's gate, verbatim. IS NOT DISTINCT FROM, not =, or a NULL on either
  -- side would pass.
  CASE WHEN lp.recorded_at >= current_date - 14
        AND p.usd_price IS NOT DISTINCT FROM lp.usd_price
       THEN p.usd_price END AS usd_price
FROM public.products p
CROSS JOIN LATERAL (
  SELECT h.recorded_at, h.usd_price
  FROM public.product_price_history h
  WHERE h.product_id = p.id
  ORDER BY h.recorded_at DESC
  LIMIT 1
) lp
WHERE CASE
        WHEN p_product_ids IS NULL THEN p.active = true
        ELSE p.id = ANY (p_product_ids)
      END
ORDER BY p.id;
$$;

ALTER FUNCTION public.get_latest_prices(bigint[])
  SET search_path = public;

REVOKE ALL ON FUNCTION public.get_latest_prices(bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_latest_prices(bigint[])
  TO anon, authenticated, service_role;
```

Why each part is shaped this way:

- **LATERAL plus `LIMIT 1`, not `DISTINCT ON`.** One backward probe of `idx_price_history_product_recorded` per product, whatever the history length (measured on 400 products with 300 days each: 4.7 ms, plan `Nested Loop -> Index Scan using idx_price_history_product_recorded`). Production carries an equivalent index under another name (0023's comment); the planner uses either.
- **`CROSS JOIN LATERAL`**: a product with no history returns no row, which every caller already reads as "never priced".
- **The gate is 0023's text.** `tests/test_wp38_migrations_static.py` (Tests 2) pins it, so a later change to one copy is noticed.
- **`ORDER BY p.id`** makes the output deterministic for tests; it costs nothing at 306 rows.
- **ACL**: `REVOKE ALL ... FROM PUBLIC` then explicit grants, as WP26 did for its read function. anon needs it: the browser search and `compare_prices.py` (publishable key since WP21) call it.

### Step 2. `migrations/NNNN_export_includes_box_recipe_currency.sql` (new; WP06 residual)

Exact content:

```sql
-- Migration: export_my_data() includes box_recipes.currency (WP38).
--
-- WP06 (migration 0026) added box_recipes.currency ('USD' or 'CAD': the
-- currency the recipe's retail_price and promo_value were typed in). The data
-- export lists its columns one by one (0011, made VOLATILE by 0024) and never
-- learned the new column, so an exported recipe has prices without a unit.
-- WP06 recorded this as an open item in audits/HARDENING_FOLLOWUPS.md.
--
-- The function is patched in place from its live definition
-- (pg_get_functiondef) with one replace() anchored on the line every full
-- definition since 0011 contains: 'promo_value', promo_value,. A full
-- redefinition here would be wrong: later migrations (WP34's 0038, WP35's
-- 0039, WP36's 0040) add their own keys to the same function, and a full
-- body copied from 0024 would drop them whenever this file is applied after
-- them. The patch keeps every other key, raises if the anchor is missing,
-- and does nothing when the key is already there. CREATE OR REPLACE through
-- EXECUTE keeps the owner, the ACL (EXECUTE for authenticated and
-- service_role only, 0024) and VOLATILE (pg_get_functiondef omits it because
-- it is the default).
--
-- A migration that replaces export_my_data with a full body AFTER this file
-- was applied in production (0038 and 0039 do) drops the key again: re-run
-- this file afterwards. It is idempotent.
--
-- This file deliberately never spells out the function's CREATE header, so
-- the "which files define export_my_data" checks of WP34 and WP35 do not see
-- it as a definition.
--
-- Verification (after apply):
--   SELECT position('''currency'', currency' IN
--          pg_get_functiondef('public.export_my_data()'::regprocedure)) > 0;   -- true
--   SELECT p.provolatile, p.prosecdef FROM pg_proc p
--    WHERE p.oid = 'public.export_my_data()'::regprocedure;                    -- v | t
--   SELECT has_function_privilege('anon', 'public.export_my_data()', 'EXECUTE');  -- false

DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.export_my_data()'::regprocedure);
  v_new text;
BEGIN
  IF position($k$'currency', currency$k$ IN v_def) > 0 THEN
    RETURN; -- already patched: a re-run, or a later migration kept the key
  END IF;

  v_new := replace(v_def,
    $k$'promo_value', promo_value,$k$,
    $k$'promo_value', promo_value, 'currency', currency,$k$);

  -- The anchor must have matched exactly once.
  IF (length(v_new) - length(replace(v_new, $k$'currency', currency$k$, '')))
       / length($k$'currency', currency$k$) <> 1 THEN
    RAISE EXCEPTION 'export_my_data() does not contain the box_recipes object this patch expects; add ''currency'' by hand (WP38)';
  END IF;

  EXECUTE v_new;
END
$patch$;
```

Do not add `REVOKE`/`GRANT` lines or a `CREATE OR REPLACE FUNCTION public.export_my_data` statement to this file (decision 2). `verify_migration.py` cannot see inside a `DO` block and reports "Nothing here can be verified" (exit 2); the header's three queries are the check.

### Step 3. `migrations/NNNN_volume_windows_complete_days.sql` (new; N02)

Exact content. Everything from `CREATE OR REPLACE FUNCTION` to the end is 0027's text except the new `window_anchor` CTE (with its comment) and the `sales_agg` CTE that follows it:

```sql
-- Migration: sales-volume windows end on the last complete day (WP38,
-- review finding N02).
--
-- get_market_product_volume_metrics (last defined in 0027) summed the 7-day
-- and 30-day windows up to current_date. TCGplayer's bucket for the current
-- day is partial: main.py stores it on purpose and the next visit corrects it
-- (parse_daily_sales_buckets), and each product is visited about once a day
-- (every 23 hours). So a product's newest bucket is always the partial day of
-- its last visit, the "7d" window held at most six full days plus part of
-- one, and the prior 30-day window, which is complete, was compared against
-- a short current one. With flat demand of 10 units a day and a last visit
-- two days ago (newest bucket a partial 4) the old function returned
-- units_sold_7d = 44 (true 70), units_sold_30d = 274 against a prior 300 (a
-- -8.7% "trend"). The verifiers put the steady-state
-- bias at -2% to -5% on the 30-day trend and 7 to 21% low on the 7-day
-- figure, pushing products toward "Cooling off" and "Thin supply" on
-- /market, /prices and /product/[id].
--
-- Each product's windows now end on its anchor day: the day before its
-- newest usable daily bucket (the last complete day), never later than
-- yesterday. That holds while the newest bucket is inside the 3-day
-- freshness tolerance; a stale product keeps yesterday. The prior 30-day
-- window (anchor - 59 .. anchor - 30) and its weekly fallback (anchor - 63 ..
-- anchor - 36) move with the same anchor. Measured with the function itself
-- on flat demand of 10 a day whose newest bucket is a partial 4: 70 / 300 /
-- 300 for a last visit 0, 1, 2 and 3 days ago (0027: 7d 64, 54, 44, 34).
--
-- Unchanged: the freshness gate (newest usable daily bucket at least
-- current_date - 3), the unbroken-window checks, the prior-window source
-- rules (0017, 0021), the listings columns and day_freshness/latest_listings
-- exactly as 0027 wrote them. Mirrored by getVolumeWindowAnchorKey() and
-- getUnitsSoldWindow() in frontend/app/lib/marketPulse.ts, which the
-- /product/[id] page uses; keep both sides in sync.
--
-- Same RETURNS TABLE, so CREATE OR REPLACE keeps the ACL; the search_path pin
-- is re-applied below. Idempotent.
--
-- Verification:
--   python verify_migration.py migrations/NNNN_volume_windows_complete_days.sql
--   (run the printed SQL; expect one row, OK)
--
--   -- No product publishes a 7d figure larger than its 30d figure (expect 0):
--   SELECT count(*) FROM public.get_market_product_volume_metrics()
--    WHERE units_sold_7d > units_sold_30d;
--
--   -- Still fast (expect well under 100 ms):
--   EXPLAIN ANALYZE SELECT * FROM public.get_market_product_volume_metrics();

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
-- One backward probe per product of (product_id, bucket_date DESC)
-- (product_sales_history_product_id_bucket_date_idx, 0015), bounded to the 63
-- days sales_agg already reads (see the header). The only consumer is
-- "newest_day_bucket >= current_date - 3", so a bucket older than that can
-- never change the output, and NULL fails that test the same way.
day_freshness AS (
  SELECT
    ap.id AS product_id,
    (SELECT sh.bucket_date
       FROM public.product_sales_history sh
      WHERE sh.product_id = ap.id
        AND sh.granularity = 'day'
        AND sh.quantity_sold IS NOT NULL
        AND sh.bucket_date >= current_date - 63
      ORDER BY sh.bucket_date DESC
      LIMIT 1) AS newest_day_bucket
  FROM active_products ap
),
-- Where each product's current windows end (WP38, review N02). TCGplayer's
-- bucket for the day of a visit is partial: the scraper stores it on purpose
-- and fixes it on its next visit (main.py parse_daily_sales_buckets), and it
-- visits each product about once a day. A product's newest bucket is
-- therefore the partial day of its last visit, and the day before it is the
-- last complete one. Windows that ended at current_date summed at most 6 full
-- days plus a fraction of one: flat demand read as a falling volume trend and
-- the 7d figure ran 7 to 21% low. The windows now end on the day before the
-- newest usable bucket, and never later than yesterday (a bucket dated today
-- or later cannot move the end forward). The prior 30-day window and its
-- weekly fallback move with the same anchor, so the trend compares two equal
-- spans. A stale product (newest usable bucket older than 3 days, or none)
-- keeps the yesterday anchor; its 7d and 30d windows are withheld by the
-- final SELECT either way.
-- Mirrored by getVolumeWindowAnchorKey() in frontend/app/lib/marketPulse.ts.
-- Keep both sides in sync.
window_anchor AS (
  SELECT
    df.product_id,
    CASE WHEN df.newest_day_bucket >= current_date - 3
         THEN LEAST(df.newest_day_bucket - 1, current_date - 1)
         ELSE current_date - 1
    END AS anchor_day
  FROM day_freshness df
),
sales_agg AS (
  SELECT
    sh.product_id,

    SUM(sh.quantity_sold) FILTER (
      WHERE sh.granularity = 'day'
        AND sh.bucket_date BETWEEN wa.anchor_day - 6 AND wa.anchor_day
    ) AS units_sold_7d,
    COUNT(*) FILTER (
      WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
        AND sh.bucket_date BETWEEN wa.anchor_day - 6 AND wa.anchor_day
    ) AS days_7d,
    (MAX(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date BETWEEN wa.anchor_day - 6 AND wa.anchor_day
     ) - MIN(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date BETWEEN wa.anchor_day - 6 AND wa.anchor_day
     ) + 1) AS span_7d,

    SUM(sh.quantity_sold) FILTER (
      WHERE sh.granularity = 'day'
        AND sh.bucket_date BETWEEN wa.anchor_day - 29 AND wa.anchor_day
    ) AS units_sold_30d,
    COUNT(*) FILTER (
      WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
        AND sh.bucket_date BETWEEN wa.anchor_day - 29 AND wa.anchor_day
    ) AS days_30d,
    (MAX(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date BETWEEN wa.anchor_day - 29 AND wa.anchor_day
     ) - MIN(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date BETWEEN wa.anchor_day - 29 AND wa.anchor_day
     ) + 1) AS span_30d,

    SUM(sh.quantity_sold) FILTER (
      WHERE sh.granularity = 'day'
        AND sh.bucket_date BETWEEN wa.anchor_day - 59 AND wa.anchor_day - 30
    ) AS prior_30d_day,
    COUNT(*) FILTER (
      WHERE sh.granularity = 'day'
        AND sh.quantity_sold IS NOT NULL
        AND sh.bucket_date BETWEEN wa.anchor_day - 59 AND wa.anchor_day - 30
    ) AS prior_day_coverage,
    -- Span of the prior window's collected days, so a hole in the middle is
    -- caught the same way it is for the 7d/30d windows.
    (MAX(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date BETWEEN wa.anchor_day - 59 AND wa.anchor_day - 30
     ) - MIN(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date BETWEEN wa.anchor_day - 59 AND wa.anchor_day - 30
     ) + 1) AS prior_span,
    ROUND(SUM(sh.quantity_sold) FILTER (
      WHERE sh.granularity = 'week'
        AND sh.quantity_sold IS NOT NULL
        AND sh.bucket_date BETWEEN wa.anchor_day - 63 AND wa.anchor_day - 36
    ) * 30.0 / 28)::bigint AS prior_30d_week,
    -- The 28-day fallback range spans exactly four Monday buckets, and the
    -- sum above is scaled 30/28 on that basis. With one missing -- an
    -- interrupted annual backfill, a failed upsert, a null quantity --
    -- scaling anyway understates the trend denominator and inflates the
    -- trend, so the fallback is only usable when all four are present.
    COUNT(*) FILTER (
      WHERE sh.granularity = 'week'
        AND sh.quantity_sold IS NOT NULL
        AND sh.bucket_date BETWEEN wa.anchor_day - 63 AND wa.anchor_day - 36
    ) AS prior_week_buckets,

    SUM(sh.transaction_count) FILTER (
      WHERE sh.granularity = 'day'
        AND sh.bucket_date BETWEEN wa.anchor_day - 29 AND wa.anchor_day
    ) AS transaction_count_30d
  FROM public.product_sales_history sh
  JOIN window_anchor wa ON wa.product_id = sh.product_id
  -- The oldest bucket any window reads: the weekly fallback starts at
  -- anchor_day - 63, and anchor_day is at least current_date - 4.
  WHERE sh.bucket_date >= current_date - 67
  GROUP BY sh.product_id
)
-- Newest snapshot per product: one backward probe of (product_id,
-- snapshot_date DESC) (product_listings_history_product_id_snapshot_date_idx,
-- 0015; UNIQUE (product_id, snapshot_date) makes it deterministic). Not
-- bounded in time on purpose: listings_snapshot_date is returned for stale
-- products too (see the header).
, latest_listings AS (
  SELECT
    ap.id AS product_id,
    l.active_listings,
    l.total_quantity_available,
    l.lowest_listing_price,
    l.snapshot_date
  FROM active_products ap
  JOIN LATERAL (
    SELECT lh.active_listings, lh.total_quantity_available,
           lh.lowest_listing_price, lh.snapshot_date
    FROM public.product_listings_history lh
    WHERE lh.product_id = ap.id
    ORDER BY lh.snapshot_date DESC
    LIMIT 1
  ) l ON true
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

Check it:

```bash
diff <(sed -n '/^CREATE OR REPLACE FUNCTION/,$p' migrations/0027_bounded_volume_metrics.sql \
       | sed '/^sales_agg AS (/,/^  GROUP BY sh.product_id$/d') \
     <(sed -n '/^CREATE OR REPLACE FUNCTION/,$p' migrations/NNNN_volume_windows_complete_days.sql \
       | sed "/^-- Where each product's current windows end/,/^  GROUP BY sh.product_id$/d"); echo "exit=$?"
# expect no diff output and exit=0: outside the replaced region (0027's sales_agg CTE, and here the
# window_anchor comment and CTE plus the new sales_agg) the function is 0027's text line for line.
```

### Step 4. Database types (phase B)

After the owner has applied the three migrations (Owner actions, item 1):

```bash
cd frontend && SUPABASE_ACCESS_TOKEN=... pnpm types:db     # or use the file the owner pushed
grep -n "get_latest_prices" app/types/database.ts         # the Functions entry: Args p_product_ids?, Returns 4 columns
pnpm exec tsc --noEmit                                     # now clean
```

If you have no token and the owner has not pushed the file, finish every other step, open the PR as a draft titled `[waiting for DB types] fix: residual data-layer follow-ups (WP38)`, and do this step when the file arrives.

### Step 5. `app/lib/latestPrices.ts` (new)

```ts
/**
 * Shapes and pure helpers for get_latest_prices (migration
 * NNNN_get_latest_prices.sql, WP38): the newest recorded price of each
 * product in one index-ordered read, with migration 0023's gate applied in
 * SQL. Isomorphic and dependency-free: serverMarketData.ts (server) and
 * clientMarketData.ts (browser) both import it. No Supabase client here.
 */

/**
 * One row of get_latest_prices. Hand-written on purpose (WP20 rule): the
 * generated Database type cannot see which function columns are nullable.
 */
export type LatestPriceRow = {
  product_id: number;
  /** recorded_at of the product's newest product_price_history row. */
  price_recorded_at: string | null;
  /** usd_price of that same row. */
  recorded_usd_price: number | null;
  /** products.usd_price when migration 0023's gate passes, else null. */
  usd_price: number | null;
};

/**
 * Ids per get_latest_prices call. One row per id at most, so a call stays
 * under PostgREST's default 1000-row response cap with room to spare.
 */
export const LATEST_PRICES_CHUNK = 500;

/**
 * PostgREST's default max-rows. A whole-catalog call (no ids) that returns
 * this many rows may have been cut short; callers log it.
 */
export const POSTGREST_MAX_ROWS = 1000;

/** Distinct ids in chunks of `size`, in first-seen order. */
export function chunkIds(ids: number[], size = LATEST_PRICES_CHUNK): number[][] {
  const unique = [...new Set(ids)];
  const chunks: number[][] = [];
  for (let i = 0; i < unique.length; i += size) {
    chunks.push(unique.slice(i, i + size));
  }
  return chunks;
}

/**
 * product_id -> its newest price row, for products whose newest row was
 * recorded on or after `windowStartKey` (YYYY-MM-DD, a UTC calendar day).
 *
 * This is exactly what the paged "recorded_at >= windowStart" reads it
 * replaces produced: the newest row inside the window exists exactly when the
 * newest row overall is inside it. A product absent from the map has no
 * price recorded inside the window (or none at all).
 */
export function newestPricedAtInWindow(
  rows: LatestPriceRow[],
  windowStartKey: string
): Map<number, { recordedAt: string; usdPrice: number | null }> {
  const newest = new Map<number, { recordedAt: string; usdPrice: number | null }>();
  for (const row of rows) {
    if (!row.price_recorded_at) continue;
    if (row.price_recorded_at.slice(0, 10) < windowStartKey) continue;
    newest.set(row.product_id, {
      recordedAt: row.price_recorded_at,
      usdPrice: row.recorded_usd_price,
    });
  }
  return newest;
}
```

### Step 6. `app/lib/serverMarketData.ts`

6a. Imports. Add, next to the other `./` imports:

```ts
import {
  chunkIds,
  newestPricedAtInWindow,
  type LatestPriceRow,
} from "./latestPrices";
import { EXCHANGE_RATE_MAX_AGE_BUSINESS_DAYS, isExchangeRateStale } from "./currency";
```

If the file already imports from `./currency` (WP20 may have pointed `DEFAULT_EXCHANGE_RATE` there), add the two names to that import instead of a second line.

6b. Newest price per product (F146). Replace the whole `fetchNewestPricedAt` function together with the doc comment above it (WP11 step 5c rewrote one paragraph of that comment) with the two functions below. Leave `fetchNewestPricedAtForProducts` (WP05) directly below it exactly as it is: it calls `fetchNewestPricedAt(createMarketDataSupabaseClient(), productIds)`, keeps its fail-closed `catch` and its `server_price_freshness_failed` log, and is what WP05's `portfolioRepo.ts` (and later WP32 and WP36) call.

```ts
/**
 * Every product's newest product_price_history row, from get_latest_prices
 * (migration NNNN_get_latest_prices.sql): one index probe per product instead
 * of paging the table through PostgREST 1000 rows at a time (review F146).
 * Ids go in chunks of LATEST_PRICES_CHUNK, so no response reaches PostgREST's
 * row cap. Ids are always passed, so a deactivated product keeps its row.
 * Throws on any error, like the paged read it replaced.
 */
async function fetchLatestPriceRows(
  supabase: MarketDataSupabaseClient,
  productIds: number[]
): Promise<LatestPriceRow[]> {
  const chunks = await Promise.all(
    chunkIds(productIds).map(async (ids) => {
      const { data, error } = await supabase.rpc("get_latest_prices", {
        p_product_ids: ids,
      });
      if (error) {
        throw error;
      }
      const rows: LatestPriceRow[] = data ?? [];
      return rows;
    })
  );
  return chunks.flat();
}

/**
 * product_id -> newest recorded_at and that row's price, for products priced
 * inside the staleness tolerance. Products absent from the map have no recent
 * price row.
 *
 * Its own read rather than a max() over the paged year of history above,
 * because that fetch is page-capped: it can end before a product's newest
 * row, and reading its truncation as staleness would blank prices across the
 * site. Same answer as the paged 14-day window read it replaced (WP38).
 */
async function fetchNewestPricedAt(
  supabase: MarketDataSupabaseClient,
  productIds: number[]
): Promise<Map<number, { recordedAt: string; usdPrice: number | null }>> {
  const windowStart = new Date(
    utcMidnightMs() - PRICE_STALENESS_TOLERANCE_DAYS * DAY_MS
  )
    .toISOString()
    .split("T")[0];

  const rows = await fetchLatestPriceRows(supabase, productIds);
  return newestPricedAtInWindow(rows, windowStart);
}
```

`fetchPriceHistoryPages`, `HISTORY_PAGE_SIZE` and `HISTORY_MAX_PAGES` stay: the 367-day fallback reads still use them. In `fetchPriceHistoryPages`' doc comment, if it still says freshness "has its own narrow window", leave it; it is still true.

6c. Empty catalog at runtime (F064 part 2). Directly below `const DAILY_BACKSTOP_SECONDS = 24 * 60 * 60;` and its comment block (WP11 step 2b), add:

```ts
/**
 * True while `next build` prerenders pages: Next sets NEXT_PHASE before it
 * starts the prerender workers (node_modules/next/dist/build/index.js). Read
 * it at call time, never at module load.
 *
 * An empty market read is accepted during the build, so a build against the
 * WP00 stub (empty by design) or during a database outage still succeeds. At
 * runtime it is a failure: see fetchMarketProductSummaries.
 */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}
```

In `fetchMarketProductSummaries`, make two edits and nothing else:

- Change its success condition `if (!error && data) {` to `if (!error && data && data.length > 0) {`. Keep the body of that `if` exactly as it is (WP20 may have turned the cast into an annotation).
- Replace its last statement, `return fetchProductsWithFallbackReturns();`, with:

```ts
  if (!error) {
    // The RPC answered with no rows. The catalog is never empty in
    // production, so this is an RLS, grant or data accident, not a fact.
    logCaughtError(
      "server_market_summaries_empty",
      new Error("get_market_product_summaries returned no rows")
    );
  }

  const products = await fetchProductsWithFallbackReturns();
  if (products.length === 0 && !isBuildPhase()) {
    // Thrown, not returned (review F064). unstable_cache stores only resolved
    // values, so the previous catalog keeps being served, and the page that is
    // regenerating fails, which makes ISR keep the last good page instead of
    // caching an empty one for up to DAILY_BACKSTOP_SECONDS. Callers that
    // degrade (portfolioRepo, the /compare and /box-calculator pages) already
    // catch a rejection.
    throw new Error(
      "Market catalog is empty: neither get_market_product_summaries nor the products table returned an active product"
    );
  }
  return products;
```

In `fetchSetAnalyticsFromRpc` (WP11 step 3b), directly after its `if (error) { throw error; }` block, add:

```ts
  if ((data ?? []).length === 0 && !isBuildPhase()) {
    // Same rule as an empty catalog: never cache an empty board at runtime.
    // getCachedSetAnalytics then computes the fallback, uncached.
    throw new Error("get_set_analytics returned no rows");
  }
```

6d. Stale exchange rate (N05). In `fetchLatestExchangeRate` (WP11 step 2c), directly after the block that throws `"exchange_rates returned no usable usd_to_cad"` and before the `return {`, add:

```ts
  if (isExchangeRateStale(data.recorded_at)) {
    // Logged, not thrown: an old Bank of Canada rate still converts better
    // than the hard-coded fallback. One event per cache fill (at most daily,
    // or once per scraper revalidation), so it alerts without flooding. The
    // scraper logs the same condition as exchange_rate_stale (review N05).
    logCaughtError(
      "exchange_rate_stale",
      new Error(
        `Newest exchange_rates row is ${data.recorded_at}, more than ${EXCHANGE_RATE_MAX_AGE_BUSINESS_DAYS} business days old`
      )
    );
  }
```

If WP20's typed client makes `data.recorded_at` `string | null`, this compiles as written (`isExchangeRateStale` accepts null).

### Step 7. `app/lib/clientMarketData.ts`

7a. Imports. Add:

```ts
import {
  chunkIds,
  newestPricedAtInWindow,
  POSTGREST_MAX_ROWS,
  type LatestPriceRow,
} from "./latestPrices";
```

7b. Delete `const FRESHNESS_PAGE_SIZE = 1000;` and `const FRESHNESS_MAX_PAGES = 30;`. Keep the exported `NewestPricedAt` type exactly where it is (WP05's code imports it). Replace the whole `fetchNewestPricedAtClient` function and the doc comment above it (the one that starts "product_id -> newest recorded_at inside the staleness tolerance") with:

```ts
/**
 * Newest product_price_history row of each product, from get_latest_prices
 * (migration NNNN_get_latest_prices.sql): one request per 500 ids, or one
 * request for the whole active catalog when no ids are given. It replaced
 * paging the history table 1000 rows at a time (review F146, F143).
 *
 * Returns null after logging when any request fails or the client cannot
 * load. Callers fail closed: no verdict means no price, never a verdict built
 * on part of the data.
 */
export async function fetchLatestPricesClient(
  productIds?: number[]
): Promise<LatestPriceRow[] | null> {
  if (productIds && productIds.length === 0) return [];
  try {
    const supabase = await getSupabase();
    if (!productIds) {
      const { data, error } = await supabase.rpc("get_latest_prices");
      if (error) throw error;
      const rows: LatestPriceRow[] = data ?? [];
      if (rows.length >= POSTGREST_MAX_ROWS) {
        logCaughtError(
          "client_latest_prices_row_cap",
          new Error(`get_latest_prices returned ${rows.length} rows; the catalog may be cut short.`)
        );
      }
      return rows;
    }
    const chunks = await Promise.all(
      chunkIds(productIds).map(async (ids) => {
        const { data, error } = await supabase.rpc("get_latest_prices", {
          p_product_ids: ids,
        });
        if (error) throw error;
        const rows: LatestPriceRow[] = data ?? [];
        return rows;
      })
    );
    return chunks.flat();
  } catch (error) {
    logCaughtError("client_latest_prices_failed", error);
    return null;
  }
}

/**
 * product_id -> newest recorded_at inside the staleness tolerance, and that
 * row's price. Products absent from the map have no current price.
 *
 * Carries the row's PRICE as well as its date. products.usd_price and the
 * history row are two independent writes in main.py, so a failed update
 * leaves the cached value behind its own timestamp; approving it on the
 * timestamp alone publishes one event's value under another's date.
 * Migration 0023 compares both, and these compatibility paths make the same
 * check.
 *
 * Pass productIds to scope it; omit for the whole active catalog.
 */
export async function fetchNewestPricedAtClient(
  productIds?: number[]
): Promise<Map<number, NewestPricedAt>> {
  if (productIds && productIds.length === 0) return new Map();
  const rows = await fetchLatestPricesClient(productIds);
  // Fail closed, as the paged read did on an error.
  if (rows === null) return new Map();
  const windowStart = new Date(
    utcMidnightMs() - PRICE_STALENESS_TOLERANCE_DAYS * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .split("T")[0];
  return newestPricedAtInWindow(rows, windowStart);
}
```

After this, `getSupabaseOrNull` may be unused in the file; if `pnpm exec eslint app/lib/clientMarketData.ts` reports it, remove it from the `./supabaseLoader` import (keep `getSupabase`). `logSupabaseError` stays imported if other functions still use it.

### Step 8. `app/lib/portfolio.ts`: search and import priced by `get_latest_prices` (F143)

8a. Delete `getFreshProductsById`, `fetchRecordedAtForMissing` and `applyFreshPricesToSearchResults`, each with its doc comment. Insert in their place:

```ts
/**
 * Current prices for search and import results (review F143): one
 * get_latest_prices call scoped to exactly these product ids, returning
 * migration 0023's verdict computed in SQL, for active and deactivated
 * products alike. It replaced downloading the whole market summaries (the
 * heaviest RPC) from the browser plus a second paged lookup for products the
 * summaries did not cover. When the lookup fails every price is withheld:
 * no verdict, no price.
 */
async function applyLatestPrices(
  products: ProductSearchResult[]
): Promise<ProductSearchResult[]> {
  if (products.length === 0) return products;
  const rows = await fetchLatestPricesClient(products.map((product) => product.id));
  const byId = new Map((rows ?? []).map((row) => [row.product_id, row]));
  return products.map((product) => {
    const row = byId.get(product.id);
    return {
      ...product,
      usd_price: row?.usd_price ?? null,
      price_recorded_at: row?.price_recorded_at ?? null,
    };
  });
}
```

8b. In `searchProducts`, `searchProductsBySet` and `getAllProducts`, the products query and `getFreshProductsById()` run in one `Promise.all`. In each, make the query a plain await and price the result with `applyLatestPrices`. For `searchProducts` the result is:

```ts
  const { data, error } = await supabase
    .from("products")
    .select(`
        id, usd_price, image_url, variant,
        sets ( name, code ),
        product_types ( name, label )
      `)
    .ilike("variant", `%${escapeLike(query)}%`)
    .limit(20);
```

(that is: `const [{ data, error }, productsById] = await Promise.all([` becomes `const { data, error } = await`, the `getFreshProductsById(),` line and the closing `]);` go, and the query ends with `;`), and its last line `return await applyFreshPricesToSearchResults(products, productsById);` becomes `return await applyLatestPrices(products);`. Do the same in `searchProductsBySet` (its `.in("set_id", setIds).limit(50)` query) and `getAllProducts` (its `.order("id", { ascending: true })` query). Keep every other line of the three functions (WP12's `getSupabaseOrNull` lines, the error branches, the `products` line as WP20 left it).

8c. Imports: add `fetchLatestPricesClient` to the `./clientMarketData` import and remove `fetchMarketProductsClient` and `fetchNewestPricedAtClient` from it. Then run `pnpm exec eslint app/lib/portfolio.ts` and remove every import it reports as unused (expected: `applyGuardedPricesToSearchResults`, `missingProductIds`, `NewestPricedAt` and `ProductWithPrice` from `./priceFreshness`, possibly `logCaughtError`). Keep the imports the in-browser history fallback still uses (`PRICE_STALENESS_TOLERANCE_DAYS`, `utcMidnightMs`, `resolvePrice` if referenced).

8d. In WP05's module doc comment at the top, the list of reads "(products, sets, product_types, product_price_history, get_market_product_summaries)" becomes "(products, sets, product_types, product_price_history, get_latest_prices)".

After this, `grep -n "fetchMarketProductsClient\|get_market_product_summaries" app/lib/portfolio.ts` prints nothing.

### Step 9. `app/lib/marketPulse.ts`: windows end on the last complete day (N02)

The TypeScript twin of step 3, used by `/product/[id]` (and by WP31 later). Only the window END moves; the freshness test (b) is still measured from the reference day, so a window is published under exactly the same conditions as before.

9a. The comment above `const PRIOR_WINDOW_WEEK_BUCKETS = 4;` becomes:

```ts
// The prior window's weekly fallback range (anchor-63 .. anchor-36, see
// getVolumeWindowAnchorKey) is 28 days, i.e. exactly four Monday-anchored
// buckets. Mirrors the same requirement in
// migrations/0021_volume_freshness_and_weekly_coverage.sql.
```

9b. Directly above the doc comment of `getUnitsSoldWindow`, add:

```ts
/** referenceDate's local calendar day moved by `days`, as YYYY-MM-DD. */
function localDayKey(referenceDate: Date, days: number): string {
  return toLocalDateKey(
    new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      referenceDate.getDate() + days
    )
  );
}

/** Newest day bucket that carries a real quantity, or null. */
function newestUsableDayKey(sales: SalesHistoryEntry[]): string | null {
  let newest: string | null = null;
  for (const row of sales) {
    if (row.granularity !== "day" || row.quantity_sold === null) continue;
    if (newest === null || row.bucket_date > newest) newest = row.bucket_date;
  }
  return newest;
}

/**
 * The day the trailing sales windows end on (review N02).
 *
 * The bucket for the day of a visit is partial (main.py stores it and
 * corrects it on the next visit, about 23 hours later), so a product's newest
 * bucket is always partial and a window ending today held at most six full
 * days plus a fraction of one: flat demand read as a falling trend and
 * "Units sold (7d)" ran 7 to 21% low. Windows end on the day before the
 * newest usable bucket, never later than yesterday, while that bucket is
 * inside DAILY_DATA_STALENESS_TOLERANCE_DAYS; otherwise (stale or no data)
 * on yesterday. The prior window moves with the same anchor. Mirror of
 * window_anchor in migrations/NNNN_volume_windows_complete_days.sql
 * (LEAST(newest_day_bucket - 1, current_date - 1)). Keep both sides in sync.
 */
export function getVolumeWindowAnchorKey(
  sales: SalesHistoryEntry[],
  referenceDate: Date = new Date()
): string {
  const yesterdayKey = localDayKey(referenceDate, -1);
  const oldestFreshKey = localDayKey(referenceDate, -DAILY_DATA_STALENESS_TOLERANCE_DAYS);
  const newest = newestUsableDayKey(sales);
  if (newest === null || newest < oldestFreshKey) return yesterdayKey;
  const dayBeforeNewest = localDayKey(parseLocalDateKey(newest), -1);
  return dayBeforeNewest < yesterdayKey ? dayBeforeNewest : yesterdayKey;
}
```

9c. Replace `getUnitsSoldWindow` and its doc comment with:

```ts
/**
 * Sum quantity_sold over granularity='day' rows inside the local-date window
 * [anchor - offsetDays - days + 1, anchor - offsetDays], where anchor is
 * getVolumeWindowAnchorKey (the day before the newest usable bucket, never
 * later than yesterday).
 *
 * Returns null (meaning "unknown", not "zero") when the daily data does not
 * actually cover the window:
 *   (a) no day row with a real quantity falls inside the window, or
 *   (b) the newest day bucket anywhere in the array is more than
 *       DAILY_DATA_STALENESS_TOLERANCE_DAYS older than referenceDate -
 *       offsetDays, so collection has stopped, or
 *   (c) there is a hole inside the collected span (a skipped bucket or a
 *       partial upsert), which would otherwise pass as a complete window.
 * A product younger than the window still reports its lifetime total: there
 * is deliberately no "window start must be covered" condition.
 */
export function getUnitsSoldWindow(
  sales: SalesHistoryEntry[],
  days: number,
  offsetDays = 0,
  referenceDate: Date = new Date()
): number | null {
  const dayRows = sales.filter((entry) => entry.granularity === "day");
  if (dayRows.length === 0) return null;

  const anchor = parseLocalDateKey(getVolumeWindowAnchorKey(dayRows, referenceDate));
  const endDate = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate() - offsetDays
  );
  const startDate = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate() - days + 1
  );
  const startKey = toLocalDateKey(startDate);
  const endKey = toLocalDateKey(endDate);

  let total = 0;
  // Only buckets carrying an actual quantity count as collected. A NULL
  // quantity is what parse_daily_sales_buckets writes for a malformed or
  // negative value from TCGPlayer, i.e. "unknown": treating it as 0 would
  // understate the window while making it look fully covered. Mirrors SQL
  // SUM(), which skips NULLs.
  const coveredDays = new Set<string>();
  for (const row of dayRows) {
    if (row.quantity_sold === null) continue;
    if (row.bucket_date >= startKey && row.bucket_date <= endKey) {
      total += row.quantity_sold;
      coveredDays.add(row.bucket_date);
    }
  }

  // (a) nothing usable collected inside the window at all.
  if (coveredDays.size === 0) return null;

  // (b) daily collection stopped. Measured from the reference day, not the
  // anchor, so moving the window end (review N02) did not loosen this test.
  // Freshness comes from buckets that carry a real quantity, so a run of
  // unusable trailing buckets cannot look like fresh collection.
  const freshestAllowedKey = localDayKey(
    referenceDate,
    -offsetDays - DAILY_DATA_STALENESS_TOLERANCE_DAYS
  );
  const newestDayKey = newestUsableDayKey(dayRows);
  if (newestDayKey === null || newestDayKey < freshestAllowedKey) return null;

  // (c) a hole inside the collected span. The span is measured between the
  // window's own first and last collected day, not across the whole window,
  // so a product younger than the window still reports its lifetime total.
  const keys = [...coveredDays].sort();
  const spanDays =
    Math.round(
      (parseLocalDateKey(keys[keys.length - 1]).getTime() -
        parseLocalDateKey(keys[0]).getTime()) /
        86_400_000
    ) + 1;
  if (coveredDays.size !== spanDays) return null;

  return total;
}
```

9d. In `countDayCoverage`, replace the `const endDate = new Date(` statement (the one built from `referenceDate.getFullYear()`, `referenceDate.getMonth()`, `referenceDate.getDate() - offsetDays`) with:

```ts
  const anchor = parseLocalDateKey(getVolumeWindowAnchorKey(sales, referenceDate));
  const endDate = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate() - offsetDays
  );
```

Nothing else in that function changes.

9e. In `getPriorUnitsSold30d`, replace the doc comment's first paragraph with:

```ts
/**
 * Units sold in the prior 30-day window: the 30 days that end 30 days before
 * the anchor day (getVolumeWindowAnchorKey). Daily rows only reach ~30 days
 * back at launch, so when they don't cover that window this falls back to
 * the backfilled Monday-anchored week rows: the four buckets dated
 * anchor-63 .. anchor-36, scaled from 28 to 30 days.
```

(keep its second paragraph, "Source preference mirrors ..."), and replace the two statements that build `startKey` and `endKey` from `referenceDate` (`- 63` and `- 36`) with:

```ts
  const anchor = parseLocalDateKey(getVolumeWindowAnchorKey(sales, referenceDate));
  const startKey = localDayKey(anchor, -63);
  const endKey = localDayKey(anchor, -36);
```

Nothing else changes. The signatures of all exported functions stay the same, so `product/[id]/page.tsx` (and WP31 later) need no edit.

### Step 10. Collectr import: `app/lib/importRows.ts` (new) and `app/lib/import.ts` (N01)

10a. New file `app/lib/importRows.ts`. Pure helpers shared by `import.ts` and the modal. A separate module on purpose: WP14's `PortfolioModals.a11y.test.tsx` replaces `lib/import` with a mock that lists a fixed set of exports, so the modal must not take new helpers from there.

```ts
/**
 * Pure helpers for the Collectr import preview (review N01). No Supabase and
 * no React: lib/import.ts and ImportHoldingsModal both use them, and tests
 * need no mocks.
 */
import type { CollectrCSVRow, ImportMatchResult } from "../components/Portfolio/types";

/**
 * The portfolio Collectr creates for sealed product. The preview opens on it
 * when the file holds more than one portfolio.
 */
export const COLLECTR_SEALED_PORTFOLIO = "Sealed Product";

/**
 * Whether the row carries a cost the holding can be stored with. NaN means
 * the CSV had none (blank or unreadable "Average Cost Paid", see parseCost in
 * import.ts). A typed 0 is a real cost.
 */
export function hasImportableCost(row: Pick<CollectrCSVRow, "averageCostPaid">): boolean {
  return Number.isFinite(row.averageCostPaid);
}

/** Matched to a product and has a cost: the only rows the preview lets the user tick. */
export function isImportable(result: ImportMatchResult): boolean {
  return result.matchedProduct !== null && hasImportableCost(result.csvRow);
}

/** Distinct non-blank Collectr portfolio names, in file order. */
export function collectrPortfolioNames(results: ImportMatchResult[]): string[] {
  const names: string[] = [];
  for (const result of results) {
    const name = (result.csvRow.portfolioName || "").trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * The portfolio the preview opens on: Collectr's sealed portfolio when the
 * file has it among several, otherwise every portfolio (null).
 */
export function defaultCollectrPortfolio(names: string[]): string | null {
  return names.length > 1 && names.includes(COLLECTR_SEALED_PORTFOLIO)
    ? COLLECTR_SEALED_PORTFOLIO
    : null;
}

/** Whether a row belongs to the chosen Collectr portfolio (null: every portfolio). */
export function inCollectrPortfolio(
  result: ImportMatchResult,
  portfolio: string | null
): boolean {
  return portfolio === null || (result.csvRow.portfolioName || "").trim() === portfolio;
}

/**
 * Row indexes ticked by default: importable, matched with "exact" or "high"
 * confidence, and in the chosen portfolio. "low" rows are never preselected.
 */
export function preselectImportRows(
  results: ImportMatchResult[],
  portfolio: string | null
): Set<number> {
  const selected = new Set<number>();
  results.forEach((result, index) => {
    if (
      inCollectrPortfolio(result, portfolio) &&
      isImportable(result) &&
      (result.matchConfidence === "exact" || result.matchConfidence === "high")
    ) {
      selected.add(index);
    }
  });
  return selected;
}
```

10b. `app/lib/import.ts` imports: add `isValidPastDate` to the `./validation` import, and add `import { hasImportableCost } from "./importRows";`.

10c. Cost parsing. Directly below `safeFloat`, add:

```ts
/**
 * "Average Cost Paid", or NaN when the cell is blank, not a plain number, or
 * out of range (review N01). Never 0 for a missing cost: Collectr's cost
 * column is optional, and a 0 basis shows the whole market value as gain.
 * A typed "0" stays 0 (a gift is a real zero cost). Number(), not
 * parseFloat(): "1,234.56" must not read as 1.
 */
function parseCost(raw: string | undefined): number {
  const text = (raw ?? "").trim();
  if (text === "") return Number.NaN;
  const n = Number(text);
  return isFiniteInRange(n, PRICE_MIN, PRICE_MAX) ? n : Number.NaN;
}
```

In `parseCollectrCSV`'s row mapping, `averageCostPaid: safeFloat(values[9], PRICE_MIN, PRICE_MAX),` becomes `averageCostPaid: parseCost(values[9]),`. In the function's doc comment, the sentence starting "Numeric coercion uses safeFloat/safeInt" becomes: "Numeric coercion uses safeFloat/safeInt, which reject Infinity, NaN, negative and out-of-range values (matching DB CHECK constraints); the average cost uses parseCost, which keeps a missing cost as NaN instead of 0."

10d. Matcher. Directly above `export function matchProduct(`, add:

```ts
/**
 * Words that never tell two products of one set and type apart: the game's
 * name and the filler catalog variants carry ("Pokemon Center Exclusive" is
 * told apart by "center").
 */
const VARIANT_FILLER_WORDS = new Set([
  "pokemon",
  "tcg",
  "the",
  "and",
  "of",
  "a",
  "exclusive",
  "edition",
  "version",
  "english",
]);

/** Lower-case words with accents folded ("Pokémon" -> "pokemon"). */
function words(value: string | null | undefined): string[] {
  return normalizeTypeText((value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, ""))
    .split(" ")
    .filter(Boolean);
}

/** The words of a catalog variant that identify it: "Shadow Rider" -> ["shadow", "rider"]. */
function variantWords(variant: string | null | undefined): string[] {
  return words(variant).filter((word) => !VARIANT_FILLER_WORDS.has(word));
}

/**
 * Words of the Collectr product name that are neither the set name, the
 * product type nor filler: what is left names a variant ("Pokemon Center",
 * "Shadow Rider"). Empty for a standard product. keepFiller keeps the filler
 * words, for messages ("pokemon center" reads better than "center").
 */
function rowVariantWords(
  csvRow: CollectrCSVRow,
  type: SupportedProductType,
  setNames: string[],
  { keepFiller = false }: { keepFiller?: boolean } = {}
): string[] {
  const typeMatch = type.patterns
    .map((pattern) => csvRow.productName.match(pattern)?.[0])
    .find((match): match is string => match !== undefined);
  const known = new Set<string>([
    ...words(typeMatch),
    ...type.tokenGroups.flat(),
    ...words(csvRow.set),
    ...setNames.flatMap((name) => words(name)),
    "sv",
  ]);
  return words(csvRow.productName).filter(
    (word) => !known.has(word) && (keepFiller || !VARIANT_FILLER_WORDS.has(word))
  );
}
```

Then replace the whole `matchProduct` function (WP17 exported it; its doc comment "Match a Collectr CSV row to a product in the database" stays above it) with:

```ts
export function matchProduct(
  csvRow: CollectrCSVRow,
  products: ProductSearchResult[]
): {
  product: ProductSearchResult | null;
  confidence: "exact" | "high" | "low" | "none";
  unmatchedReason?: string;
} {
  if (!isProductTypeSupported(csvRow.productName)) {
    return { product: null, confidence: "none", unmatchedReason: "Unsupported product type" };
  }

  const detectedType = detectProductType(csvRow.productName);
  const normalizedSetName = normalizeSetName(csvRow.set);
  const detectedTokens = detectedType ? detectedType.tokenGroups : [];

  const setMatches = products.filter((p) => {
    const productSetName = normalizeSetName(p.sets?.name || "");
    return (
      productSetName === normalizedSetName ||
      productSetName.includes(normalizedSetName) ||
      normalizedSetName.includes(productSetName)
    );
  });

  if (setMatches.length === 0) {
    return { product: null, confidence: "none", unmatchedReason: "Set not found in database" };
  }

  const candidates = setMatches.filter((p) => {
    if (!detectedType) return false;
    const productTypeText = p.product_types?.label || p.product_types?.name || "";
    const typeTokens = tokenize(productTypeText);
    return matchesTokenGroups(typeTokens, detectedTokens, detectedType.excludeTokens);
  });

  if (candidates.length === 0 || !detectedType) {
    return {
      product: null,
      confidence: "none",
      unmatchedReason: detectedType
        ? `No matching ${detectedType.label.toLowerCase()} for this set`
        : "Product type not found for set",
    };
  }

  // Variant first (review N01). The old code returned the first candidate whose
  // set name matched exactly, which every candidate of one set does, so a
  // Pokemon Center ETB was matched to whichever ETB of the set had the lower id
  // and labelled "exact".
  const rowWords = new Set(words(csvRow.productName));
  const setNames = candidates.map((p) => p.sets?.name || "");
  const rowVariant = rowVariantWords(csvRow, detectedType, setNames);
  const scored = candidates.map((p) => ({ product: p, variant: variantWords(p.variant) }));
  const fits = scored.filter(({ variant }) =>
    variant.length === 0
      ? rowVariant.length === 0 // a row naming no variant fits only a product without one
      : variant.every((word) => rowWords.has(word))
  );
  const best = Math.max(0, ...fits.map(({ variant }) => variant.length));
  const pool = fits.filter(({ variant }) => variant.length === best).map(({ product }) => product);

  if (pool.length === 0) {
    if (rowVariant.length > 0) {
      // The row names a variant the catalog does not carry for this set.
      return {
        product: null,
        confidence: "none",
        unmatchedReason: `No matching ${detectedType.label.toLowerCase()} with "${rowVariantWords(
          csvRow,
          detectedType,
          setNames,
          { keepFiller: true }
        ).join(" ")}" for this set`,
      };
    }
    // The row names no variant and every candidate has one: ambiguous.
    return { product: candidates[0], confidence: "low" };
  }

  if (pool.length > 1) {
    // Set name breaks a tie between products of two similarly named sets.
    const exactSet = pool.filter(
      (p) => normalizeSetName(p.sets?.name || "") === normalizedSetName
    );
    if (exactSet.length === 1) return { product: exactSet[0], confidence: "exact" };
    // Still several: never guess (review N01). "low" is not preselected.
    return { product: (exactSet.length > 1 ? exactSet : pool)[0], confidence: "low" };
  }

  const [chosen] = pool;
  if (candidates.length === 1) return { product: chosen, confidence: "high" };
  return {
    product: chosen,
    confidence:
      normalizeSetName(chosen.sets?.name || "") === normalizedSetName ? "exact" : "high",
  };
}
```

The rules, in order: unsupported type, unknown set and missing type behave as before. Then variant decides: a candidate fits when it has no variant and the row names none, or when every word of its variant appears in the row; among fits the longest variant wins. Only then does an exact set name break a tie between similarly named sets. Several candidates left means "low" (never preselected). A row that names a variant the catalog does not carry for the set is unmatched with a reason; a row naming no variant when every candidate has one (the Chilling Reign Shadow Rider / Ice Rider pair) is "low". `getAllProducts` returns products in id order, so `candidates[0]` and `pool[0]` are the lowest id, as before.

10e. `processCollectrImport`: the filter line `if (csvRow.category !== "Pokemon" || csvRow.portfolioName !== "Sealed Product") {` becomes `if (csvRow.category !== "Pokemon") {`, and its comment `// Skip non-Pokemon or non-sealed products` becomes:

```ts
    // Pokemon rows only. Every Collectr portfolio is kept (review N01: the
    // old "Sealed Product" filter silently dropped a portfolio the user had
    // renamed). The preview offers a portfolio picker when the file has more
    // than one, and unsupported (non-sealed) rows are listed as unmatched.
```

10f. `importHoldings` (WP05 version). Replace its price guard

```ts
    if (!Number.isFinite(averageCostPaid) || averageCostPaid < PRICE_MIN || averageCostPaid > PRICE_MAX) {
      results[i] = { ...match, importStatus: "error", errorMessage: "Invalid price" };
      return;
    }
```

with

```ts
    if (!hasImportableCost(match.csvRow)) {
      // Blank or unreadable "Average Cost Paid" (review N01): never store a
      // missing cost as $0. The preview already disables these rows.
      results[i] = { ...match, importStatus: "error", errorMessage: "No average cost in the CSV" };
      return;
    }
    if (averageCostPaid < PRICE_MIN || averageCostPaid > PRICE_MAX) {
      results[i] = { ...match, importStatus: "error", errorMessage: "Invalid price" };
      return;
    }
    if (dateAdded && !isValidPastDate(dateAdded)) {
      // The same check Add and Edit run (UTC "today", as the DB CHECK).
      results[i] = { ...match, importStatus: "error", errorMessage: `Invalid purchase date (${dateAdded})` };
      return;
    }
```

Nothing else in `importHoldings` changes (an empty `dateAdded` still falls back to `maxPurchaseDateKey()`).

### Step 11. `app/components/Portfolio/cards/ImportHoldingsModal.tsx`: picker, variant, needs-cost (N01)

Locate each edit by the quoted code (WP05, WP07, WP14 and WP15 moved lines).

11a. Imports: add

```ts
import {
  collectrPortfolioNames,
  defaultCollectrPortfolio,
  hasImportableCost,
  inCollectrPortfolio,
  isImportable,
  preselectImportRows,
} from "../../../lib/importRows";
```

11b. State: below `const [selectedMatches, setSelectedMatches] = useState<Set<number>>(new Set());` add

```ts
  // The Collectr portfolio shown in the preview; null shows every portfolio.
  const [portfolioFilter, setPortfolioFilter] = useState<string | null>(null);
```

11c. In `processCSV`, replace the block from `setMatchResults(results);` through `setSelectedMatches(preselected);` (it contains the comment `// Pre-select all matched items with high or exact confidence` and the `results.forEach` loop) with:

```ts
      const portfolio = defaultCollectrPortfolio(collectrPortfolioNames(results));
      setMatchResults(results);
      setPortfolioFilter(portfolio);
      setSelectedMatches(preselectImportRows(results, portfolio));
```

11d. `toggleMatch`: make its first statement `if (!matchResults[index] || !isImportable(matchResults[index])) return;`.

11e. `selectAll`: the condition `if (r.matchedProduct) {` becomes `if (inCollectrPortfolio(r, portfolioFilter) && isImportable(r)) {`.

11f. `handleClose`: add `setPortfolioFilter(null);` next to `setSelectedMatches(new Set());`.

11g. Replace the three derived values

```ts
  const summary = calculateImportSummary(matchResults);
  const matchedResults = matchResults.filter((r) => r.matchedProduct);
  const unmatchedResults = matchResults.filter((r) => !r.matchedProduct);
```

with

```ts
  const portfolioNames = collectrPortfolioNames(matchResults);
  const visibleResults = matchResults.filter((r) => inCollectrPortfolio(r, portfolioFilter));
  const summary = calculateImportSummary(visibleResults);
  const matchedResults = visibleResults.filter((r) => r.matchedProduct);
  const unmatchedResults = visibleResults.filter((r) => !r.matchedProduct);
```

(The selection only ever holds visible rows, because every filter change below resets it, so the "complete" summary still counts every imported row.)

11h. Preview step: directly above the `{/* Select All / Deselect All */}` comment, add:

```tsx
                {portfolioNames.length > 1 && (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <span>Collectr portfolio</span>
                    <select
                      aria-label="Collectr portfolio"
                      value={portfolioFilter ?? ""}
                      onChange={(e) => {
                        const next = e.target.value === "" ? null : e.target.value;
                        setPortfolioFilter(next);
                        setSelectedMatches(preselectImportRows(matchResults, next));
                      }}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                    >
                      <option value="">All portfolios</option>
                      {portfolioNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
```

11i. In the matched list, `{matchResults.map((result, idx) => {` keeps iterating `matchResults` (the selection uses its indexes); its first line `if (!result.matchedProduct) return null;` becomes `if (!result.matchedProduct || !inCollectrPortfolio(result, portfolioFilter)) return null;`. In the same row:

- The checkbox gets `disabled={!isImportable(result)}`.
- The matched-product line (the `<p>` that prints `{result.matchedProduct.sets?.name} - {result.matchedProduct.product_types?.label || result.matchedProduct.product_types?.name}`; WP14 gave it an `id`) gets the variant appended, inside the same `<p>`, after the type: `{result.matchedProduct.variant ? ` · ${result.matchedProduct.variant}` : ""}`.
- The quantity line (WP07: `Qty: {result.csvRow.quantity} @ {formatMoney(result.csvRow.averageCostPaid, "USD")} each`) becomes:

```tsx
                              <p className="text-xs text-slate-500">
                                {hasImportableCost(result.csvRow) ? (
                                  <>
                                    Qty: {result.csvRow.quantity} @ {formatMoney(result.csvRow.averageCostPaid, "USD")} each
                                  </>
                                ) : (
                                  <>
                                    Qty: {result.csvRow.quantity} ·{" "}
                                    <span className="font-medium text-amber-800">
                                      Needs cost: Average Cost Paid is blank in the CSV, so this row is not imported
                                    </span>
                                  </>
                                )}
                              </p>
```

Keep the `<p>`'s class as the current file has it if WP14 or WP15 changed it.

The unmatched list already iterates `unmatchedResults`, which is now filtered by portfolio; nothing else changes there.

### Step 12. `app/error.tsx` and `app/global-error.tsx`: "Try again" refetches (N03)

In both files:

- The React import becomes `import { startTransition, useEffect } from "react";` and add `import { useRouter } from "next/navigation";`.
- First statement of the component body:

```tsx
  const router = useRouter();

  // reset() alone re-renders the segment from what the client already has,
  // so a page whose server fetch failed shows this error again. refresh()
  // re-requests the server components; doing both in one transition resets
  // the boundary once the new payload has arrived (review N03).
  const retry = () => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };
```

- The button's `onClick={reset}` becomes `onClick={retry}`.

Keep WP15's markup and WP17's Sentry comment exactly as they are.

### Step 13. `app/lib/currency.ts` and `app/lib/exchangeRate.ts`: rate age (N05)

13a. Append to `app/lib/currency.ts` (WP20's file; it stays free of React and Supabase):

```ts
/**
 * The Bank of Canada publishes one USD/CAD rate per business day, in the late
 * afternoon Eastern. Four business days covers a long weekend plus a late
 * publication; an older rate means collection is broken (review N05). Same
 * limit as FX_MAX_AGE_BUSINESS_DAYS in main.py.
 */
export const EXCHANGE_RATE_MAX_AGE_BUSINESS_DAYS = 4;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Weekdays after `fromKey` up to and including `toKey` (both YYYY-MM-DD,
 * UTC calendar days). 0 when `toKey` is not after `fromKey` or a key is
 * malformed.
 */
export function businessDaysBetween(fromKey: string, toKey: string): number {
  if (!DATE_KEY.test(fromKey) || !DATE_KEY.test(toKey)) return 0;
  const end = Date.parse(`${toKey}T00:00:00Z`);
  let count = 0;
  for (let ms = Date.parse(`${fromKey}T00:00:00Z`) + ONE_DAY_MS; ms <= end; ms += ONE_DAY_MS) {
    const weekday = new Date(ms).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

/**
 * Whether an exchange_rates.recorded_at is a real reading older than
 * EXCHANGE_RATE_MAX_AGE_BUSINESS_DAYS. null (the fallback rate, which callers
 * already label as such) and malformed values are not "stale".
 */
export function isExchangeRateStale(
  date: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!date) return false;
  const rateKey = date.slice(0, 10);
  if (!DATE_KEY.test(rateKey)) return false;
  return (
    businessDaysBetween(rateKey, now.toISOString().slice(0, 10)) >
    EXCHANGE_RATE_MAX_AGE_BUSINESS_DAYS
  );
}
```

13b. `app/lib/exchangeRate.ts`: add `isExchangeRateStale` to its `./currency` import (WP20 step 3.2b pointed it there). Below the module-level `let exchangeRatePromise ...` line add:

```ts
// Reported at most once per tab; the server reports the same condition once
// per cache fill (serverMarketData.ts, exchange_rate_stale).
let staleRateReported = false;
```

and inside the request's `try`, directly after `const snapshot: ExchangeRateSnapshot = { ... };`, add:

```ts
      if (!staleRateReported && isExchangeRateStale(snapshot.date)) {
        staleRateReported = true;
        logCaughtError(
          "client_exchange_rate_stale",
          new Error(`Newest exchange_rates row is ${snapshot.date}`)
        );
      }
```

### Step 14. `app/components/PriceChart.tsx`: say that CAD uses today's rate (N05)

In `PriceTooltip`, the unit span `<span className="text-xs text-slate-400 ml-1">{currency}</span>` (keep its class as the file has it) becomes `<span className="text-xs text-slate-400 ml-1">{currency === "CAD" ? "CAD at today's rate" : currency}</span>`. Every point of a CAD chart is converted at the current rate (`groupedDaily`); WP25's dated rates reach the product page chart in WP31. Change nothing else in the file.

### Step 15. `/compare`: warn about duplicate SKUs (N08)

15a. `app/compare/shopifyCsv.ts`. The return type of `parseShopifyCsv` becomes `{ products: Record<string, ShopifyProduct>; error?: string; duplicateSkus?: string[] }`. In the function: above the `for` loop add `const seen = new Set<string>();` and `const duplicates = new Set<string>();`; directly above `products[sku] = {` add

```ts
    if (seen.has(sku)) duplicates.add(sku);
    seen.add(sku);
```

and the final `return { products };` becomes `return { products, duplicateSkus: [...duplicates] };`. The two error returns stay exactly as they are (WP18's test compares them with `toEqual`). In the doc comment, "A repeated sku keeps the last row." becomes "A repeated sku keeps the last row and is listed in duplicateSkus, so the page can say that the other rows were not compared (review N08)."

15b. `app/compare/CompareDashboard.tsx`:

- Below `const [errorMessage, setErrorMessage] = useState<string | null>(null);` add `const [duplicateSkus, setDuplicateSkus] = useState<string[]>([]);`.
- In `handleCsvUpload`: `const { products, error } = parseShopifyCsv(text);` becomes `const { products, error, duplicateSkus: repeated } = parseShopifyCsv(text);`; in the `if (error) {` branch add `setDuplicateSkus([]);`; after `setErrorMessage(null);` add `setDuplicateSkus(repeated ?? []);`.
- Directly after the closing `)}` of the `{errorMessage && (` block, add:

```tsx
          {duplicateSkus.length > 0 && (
            <p
              role="status"
              className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              {duplicateSkus.length === 1 ? "1 SKU appears" : `${duplicateSkus.length} SKUs appear`} on
              more than one row of this file, so only the last row of each is compared:{" "}
              {duplicateSkus.slice(0, 5).join(", ")}
              {duplicateSkus.length > 5 ? ", …" : ""}. Give every variant its own SKU in Shopify.
            </p>
          )}
```

### Step 16. `main.py`, `scraper_db.py`, `requirements.txt`: Bank of Canada Valet API (N05)

16a. `main.py` imports: `from datetime import datetime, timedelta, timezone` becomes `from datetime import date, datetime, timedelta, timezone`.

16b. Replace the whole `fetch_and_store_exchange_rate` function (its post-WP11/WP21 form: the HTML scrape, the `pg_db` branch WP21 step 8e added around the insert, and WP11's `return True`/`return False` lines) with the block below, which also adds three constants and three helper functions above the new function. Keep its position (directly above `fetch_products_needing_update`). `run_jobs_once()` (WP11) keeps calling it and keeps its contract: it never raises and returns True only when a new row was stored, which is what decides the site revalidation.

```python
# Bank of Canada Valet API, series FXUSDCAD: the one daily USD/CAD rate the
# BoC publishes for each business day (review N05; the old code parsed the
# HTML table of the "daily exchange rates" page, which breaks on any markup
# change).
BOC_VALET_FXUSDCAD_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json"
# Same band as WP25's fx_daily_rate_sane; the exchange_rates CHECK (0003) is wider.
FX_RATE_MIN, FX_RATE_MAX = 0.5, 3.0
# The BoC publishes one rate per business day, in the late afternoon Eastern.
# Four business days covers a long weekend plus a late publication; anything
# older means collection is broken. Same limit as
# EXCHANGE_RATE_MAX_AGE_BUSINESS_DAYS in frontend/app/lib/currency.ts.
FX_MAX_AGE_BUSINESS_DAYS = 4


def business_days_between(earlier, later):
    """Weekdays after `earlier` up to and including `later` (0 when later <= earlier)."""
    days = 0
    current = earlier
    while current < later:
        current += timedelta(days=1)
        if current.weekday() < 5:
            days += 1
    return days


def fetch_latest_boc_usd_cad(session=None):
    """
    The newest (observation date, USD to CAD rate) from the Valet API.
    Raises on an HTTP error, an unexpected payload, or no usable observation.
    """
    http = session or requests
    response = http.get(BOC_VALET_FXUSDCAD_URL, params={"recent": 5}, timeout=10)
    response.raise_for_status()
    payload = response.json()
    observations = payload.get("observations") if isinstance(payload, dict) else None
    if not isinstance(observations, list):
        raise ValueError("Valet response has no 'observations' list")
    best = None
    for obs in observations:
        try:
            day = date.fromisoformat(obs["d"])
            rate = float(obs["FXUSDCAD"]["v"])
        except (KeyError, TypeError, ValueError):
            continue  # holidays and malformed entries carry no value
        if FX_RATE_MIN < rate < FX_RATE_MAX and (best is None or day > best[0]):
            best = (day, rate)
    if best is None:
        raise ValueError("Valet returned no usable FXUSDCAD observation")
    return best


def exchange_rate_stored_for(day):
    """Whether exchange_rates already has a row for this observation date."""
    if pg_db is not None:
        return pg_db.exchange_rate_exists_for(day.isoformat())
    else:
        result = (
            supabase.table("exchange_rates")
            .select("id")
            .gte("recorded_at", day.isoformat())
            .lt("recorded_at", (day + timedelta(days=1)).isoformat())
            .limit(1)
            .execute()
        )
        return bool(result.data)


def fetch_and_store_exchange_rate():
    """
    Store the newest Bank of Canada USD to CAD rate in exchange_rates, once
    per observation date (the run every 4 hours used to insert the same rate
    again each time). Logs "exchange_rate_stale" at ERROR when the newest
    observation is more than FX_MAX_AGE_BUSINESS_DAYS business days old.
    Never raises. Returns True when a new row was stored.
    """
    try:
        logger.info("Fetching USD→CAD exchange rate from the Bank of Canada Valet API...")
        rate_day, rate = fetch_latest_boc_usd_cad()
        logger.info(f"USD→CAD Rate: {rate} (as of {rate_day})")

        age = business_days_between(rate_day, datetime.now(timezone.utc).date())
        if age > FX_MAX_AGE_BUSINESS_DAYS:
            logger.error(
                f"exchange_rate_stale: the newest Bank of Canada rate is from {rate_day}, "
                f"{age} business days ago (limit {FX_MAX_AGE_BUSINESS_DAYS}). "
                "CAD prices on the site use it until a newer one arrives."
            )

        if exchange_rate_stored_for(rate_day):
            logger.info(f"Exchange rate for {rate_day} is already stored; nothing to write.")
            return False

        recorded_at = datetime(rate_day.year, rate_day.month, rate_day.day).isoformat()
        if pg_db is not None:
            pg_db.insert_exchange_rate(rate, recorded_at)
        else:
            supabase.table("exchange_rates").insert({
                "usd_to_cad": rate,
                "recorded_at": recorded_at,
            }).execute()
        logger.info("Exchange rate stored.")
        return True
    except Exception as e:
        logger.error(f"Failed to fetch or store exchange rate: {e}")
        return False
```

Why it is shaped this way:

- **One row per observation date, never an update.** The run every 4 hours inserted the same rate again each time (about six rows per BoC date). The scraper role has `SELECT, INSERT` on `exchange_rates` only (WP21, 0032), so a true upsert would need a new grant; "insert when the date has no row" gives one row per date without one. `fx_daily` (WP25) and `getCachedExchangeRate` read the newest row per date, so older duplicates are harmless.
- **The Supabase branch sits in the `else:` of `if pg_db is not None`**, the rule WP21 step 8k checks with `grep -n 'supabase\.table(' main.py`.
- **`exchange_rate_stale` at ERROR** is the scraper's alert: it is the line to search for in the scraper log. The website reports the same condition to Sentry (step 6d).

16c. `normalize_hyphens` (near the top of `main.py`) was only used by the HTML parser. If `grep -n "normalize_hyphens" main.py` now prints only its `def` line, delete the function. In `requirements.txt` delete the line `beautifulsoup4==4.15.0`, then confirm `grep -rn "bs4\|BeautifulSoup" --include=*.py .` prints nothing.

16d. `scraper_db.py` (WP21): add to `ScraperDB`, directly below `insert_exchange_rate`:

```python
    def exchange_rate_exists_for(self, day_iso: str) -> bool:
        """Whether exchange_rates has a row recorded on this calendar day (YYYY-MM-DD)."""
        rows = self._execute(
            "SELECT 1 FROM public.exchange_rates "
            " WHERE recorded_at >= %s::date AND recorded_at < %s::date + 1 "
            " LIMIT 1",
            (day_iso, day_iso),
            fetch=True,
        )
        return bool(rows)
```

No grant changes: `pokefin_scraper` already has `SELECT` on `exchange_rates` and the `exchange_rates_scraper` policy (WP21, 0032).

### Step 17. `compare_prices.py`: the price the site shows, active products only, with its date (N08)

17a. Replace the whole `fetch_pokefin_prices` function with:

```python
def fetch_pokefin_prices() -> dict:
    """
    Market prices from Pokéfin, keyed by SKU: active products only, and only a
    price the website itself would show (review N08). get_latest_prices
    (migration NNNN_get_latest_prices.sql) applies migration 0023's gate: the
    newest product_price_history row is at most 14 days old and agrees with
    products.usd_price. Otherwise market_price is None and the product is
    reported under "no market price" instead of being compared against a
    months-old number. price_date is the day the price was recorded.
    """
    logger.info("Fetching market prices from Pokéfin...")

    try:
        response = supabase.table("products").select(
            "id, sku, last_updated, "
            "sets(name, code), "
            "product_types(name, label)"
        ).not_.is_("sku", "null").eq("active", True).execute()
        latest = supabase.rpc("get_latest_prices", {}).execute()
        latest_by_id = {row["product_id"]: row for row in (latest.data or [])}

        products = {}
        for row in response.data:
            sku = row.get('sku')
            if sku:
                set_info = row.get('sets') or {}
                type_info = row.get('product_types') or {}
                price_row = latest_by_id.get(row.get('id')) or {}

                products[sku] = {
                    'sku': sku,
                    'market_price': price_row.get('usd_price'),
                    'price_date': (price_row.get('price_recorded_at') or '')[:10] or None,
                    'last_updated': row.get('last_updated'),
                    'set_name': set_info.get('name', 'Unknown'),
                    'product_type': type_info.get('label') or type_info.get('name', 'Unknown'),
                }

        return products

    except Exception as e:
        error_msg = str(e)
        if "402" in error_msg or "quota" in error_msg.lower():
            logger.error("Supabase storage quota exceeded. Please resolve at https://supabase.help")
            raise SystemExit("Database unavailable - storage quota exceeded")
        raise
```

`get_latest_prices` is callable with the publishable key WP21 gave this script (step 1 grants anon). Omitting the ids means "every active product".

17b. In `compare_prices()`, in the `comparison = {` dict, add `'price_date': pokefin.get('price_date'),` directly after `'last_updated': pokefin.get('last_updated'),`. (The `no_market_price` branch already copies every pokefin key with `**pokefin`.)

17c. `print_report`:

- After `print(f"Exchange Rate:            1 USD = {exchange_rate:.4f} CAD")` add:

```python
    print("Market prices:            the website's current price; a price older than 14 days")
    print("                          counts as no market price (same rule as pokefin.ca)")
```

- In the BELOW MARKET loop, append the price date to both row formats: the `show_usd` print's last f-string `f"{item['title'][:25]}"` becomes `f"{item['title'][:25]}  (priced {item.get('price_date') or '?'})"`, and the other print gets a third f-string line `f"  (priced {item.get('price_date') or '?'})"` after `f"{market_cad_str} {diff_str} {diff_pct_str}  {item['title'][:30]}"`.
- In the MATCHED BUT NO MARKET PRICE loop, replace the `print(...)` with:

```python
            last_priced = (
                f"last priced {item['price_date']}" if item.get('price_date') else "never priced"
            )
            print(
                f"  {item['sku']:<25} {shopify_price_str} {shopify_cost_str}  {item['title'][:40]}"
                f"  ({last_priced})"
            )
```

17d. `export_alerts`: append `'Price Date'` to the header list (after `'Exchange Rate'`) and `item.get('price_date') or '',` to the matched rows (after `f"{exchange_rate:.4f}",`). In the "Add unmatched" rows, put five `''` (not four) before `'NO MATCH'` and four after it, so `'NO MATCH'` lands in the Status column and the row has the header's 15 columns. (Today it sits under "Difference (%)".)

17e. Duplicate SKUs in the Shopify API loader, `fetch_shopify_products_api`: below `products: dict[str, dict] = {}` add

```python
    # sku -> titles of every variant that carried it (review N08).
    duplicate_titles: dict[str, list[str]] = {}
```

directly above `products[sku] = {` add

```python
                if sku in products:
                    duplicate_titles.setdefault(sku, [products[sku]["title"]]).append(title or sku)
```

and directly above `logger.info(f"Fetched {len(products)} Shopify products with SKUs via API")` add

```python
    if duplicate_titles:
        # Products are keyed by SKU, so all but the last variant with a given
        # SKU silently drop out of the comparison. Say so.
        logger.warning(
            f"{len(duplicate_titles)} SKU(s) are used by more than one Shopify variant; "
            "only the last variant of each is compared. Give every variant its own SKU: "
            + "; ".join(
                f"{sku} ({', '.join(titles)})" for sku, titles in sorted(duplicate_titles.items())
            )
        )
```

The CSV loader `load_shopify_products` already skips title-less variant rows and is not changed.

### Step 18. `update_shopify_skus.py`: language and variant matching, variant rows untouched (N08)

18a. `detect_variant`: before its final `return None`, add

```python
    if 'chinese' in combined or 'china' in combined:
        return "Chinese"
```

and directly below the function add:

```python
def language_of(variant: str | None) -> str:
    """The card language a detected or mapped variant implies: English unless it names another."""
    text = (variant or "").lower()
    for language in ("japanese", "korean", "chinese"):
        if language in text:
            return language.capitalize()
    return "English"
```

18b. `find_best_match`: make the first statements of the `for sku_entry in sku_mapping:` loop body

```python
        # A listing in one language never takes another language's SKU
        # (review N08): a Japanese box matched to the English row of its set
        # would be priced against the wrong market.
        if language_of(detected_variant) != language_of(sku_entry['variant']):
            continue

        score = 0
```

(replacing the existing `score = 0`), and replace the variant block (`# Match by variant` through `score += 10  # Bonus for both having no variant`) with:

```python
        # Match by variant. A mismatch now costs points (review N08): before,
        # it scored 0, so set (50) and type (30) similarity alone cleared the
        # threshold and a standard box could take a Pokemon Center SKU.
        if detected_variant and sku_entry['variant']:
            if normalize_text(detected_variant) in normalize_text(sku_entry['variant']):
                score += 15  # Weight: 15%
            else:
                score -= 15
        elif not detected_variant and not sku_entry['variant']:
            score += 10  # Bonus for both having no variant
        else:
            score -= 15  # One side names a variant, the other does not
```

18c. `process_shopify_export`: delete `current_handle = None` and `current_match = None` above the loop and `current_handle = handle` in the title branch, and replace the whole `else:` branch (`# Image/variant row - apply same SKU as parent product` and its five lines) with:

```python
        else:
            # Image or variant row of the product above: left exactly as
            # exported (review N08). Stamping the parent's SKU on every
            # variant gave a multi-variant product duplicate SKUs, and the
            # SKU-keyed comparisons (compare_prices.py, /compare) then kept
            # only one of those rows.
            updated_rows.append(row)
```

`current_match` is still assigned in the title branch and used there; keep it.

### Step 19. Documentation

- `README.md` (repo root), in the data-flow list: item 6 "**Bank of Canada API** provides daily USD→CAD exchange rates." becomes "**Bank of Canada Valet API** (series `FXUSDCAD`) provides the daily USD→CAD rate; the scraper stores one row per Bank of Canada date and logs `exchange_rate_stale` when the newest is more than 4 business days old." In item 5, after "`get_market_product_volume_metrics()` RPC behind Market Pulse", add: "(its 7-day and 30-day windows end on the last complete day, never on today's partial bucket)". In "The ordering constraints that matter", add a bullet: "`NNNN_export_includes_box_recipe_currency.sql` patches `export_my_data()` in place. Re-run it after applying any migration that redefines that function in full (WP34's 0038, WP35's 0039); it is idempotent."
- `audits/HARDENING_FOLLOWUPS.md` section 7:
  - Replace WP06's bullet "**Open:** `export_my_data` (0011, redefined by WP01's 0024) does not export `box_recipes.currency`; add it the next time that function is redefined." with "**Closed (WP38):** `export_my_data` exports `box_recipes.currency` (`migrations/NNNN_export_includes_box_recipe_currency.sql`, patched in place). Re-run that file after any migration that redefines `export_my_data` in full (0038, 0039)." If the bullet is not there, add the "Closed" bullet anyway.
  - Add, as the newest migration bullet: "**Migrations NNNN (`get_latest_prices`), NNNN (`export_my_data` currency) and NNNN (volume windows end on the last complete day)** (WP38): applied to production on <date>." Leave the date for the owner.
  - Add: "**Exchange rate** (WP38): the scraper reads the Bank of Canada Valet API and stores one row per observation date. `exchange_rate_stale` in the scraper log (ERROR) or in Sentry (`exchange_rate_stale`, `client_exchange_rate_stale`) means the newest rate is more than 4 business days old: check the scraper host and `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=5`."
- `frontend/README.md` (WP20 wrote a data-flow section naming `exchange_rates`): if it describes the portfolio search's prices, say they come from `get_latest_prices`. Skip if it does not mention them.

## Pitfalls: do not do this

- **Do not redefine `export_my_data` in full** (decision 2), and do not let the text `FUNCTION public.export_my_data` appear anywhere in step 2's file, comments included: WP34 and WP35 grep for it, and Tests 2 fails on it.
- **Do not filter `get_latest_prices` on `active` when ids are passed.** Portfolio holdings of deactivated products would lose their price (WP11's F146 note). Tests 1 pins it.
- **Do not move the freshness test of the volume windows.** Only the window end moves (to the anchor). The "newest usable bucket at least 3 days old" rule stays measured from `current_date` in SQL and from `referenceDate - offsetDays` in TypeScript; anchoring it at the window end would loosen it by a day.
- **Do not compare the new volume RPC with 0027 and expect equality.** The 7-day and 30-day figures change by design (they stop including today's partial bucket). The DB test and Tests 8 prove the intended values instead.
- **Do not throw on an empty catalog during `next build`.** `pnpm build:stub` serves an empty catalog by design (WP00) and must keep building. Do not read `NEXT_PHASE` at module scope either: Next sets it after modules may have loaded. A `next start` against the empty stub renders error pages when a page regenerates; that is expected (use WP22's fixture to serve real data locally).
- **Do not put the import helpers in `lib/import.ts`.** WP14's `PortfolioModals.a11y.test.tsx` mocks that module with a fixed export list; the modal must get `collectrPortfolioNames` and friends from `lib/importRows.ts`.
- **Do not import a missing cost as 0, and do not reject a typed 0.** `parseCost("")` is NaN, `parseCost("0")` is 0.
- **Do not "repair" variant SKUs in `update_shopify_skus.py`.** Variant rows are left exactly as exported. A shop that already ran the old script has duplicate variant SKUs in Shopify; the owner fixes those by hand (Owner actions, item 5).
- **Do not update `exchange_rates` rows** to "upsert": the scraper role has no `UPDATE` grant there, and a new grant is out of scope.
- **Do not convert history at a dated rate here.** That is WP25/WP31/WP36. This package only labels the chart.
- **Do not hand-edit `app/types/database.ts`** or cast the Supabase client to get past `tsc` in phase A (WP20).

## Tests

Frontend tests live under `frontend/`; Python tests under `tests/` at the repo root. Every new or changed test below fails on the code before this package, except where a case says it pins unchanged behaviour.

### 1. `tests/test_wp38_db.py` (new; runs in WP21's "Database replay and Python tests" job)

```python
"""
Database checks for WP38's migrations: get_latest_prices, the volume-window
anchor and the export_my_data currency key.

Skipped unless POKEFIN_TEST_DATABASE_URL points at a database rebuilt by
scripts/db/replay_migrations.sh (CI job "Database replay and Python tests").
NEVER point it at production: every test runs inside a transaction that is
rolled back.

  POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/replay_once \
    python -m pytest tests/test_wp38_db.py -v
"""
import json
import os
import uuid
from urllib.parse import urlparse

import pytest

DSN = os.environ.get("POKEFIN_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="POKEFIN_TEST_DATABASE_URL not set")

psycopg = pytest.importorskip("psycopg")


@pytest.fixture
def db():
    host = (urlparse(DSN).hostname or "").lower()
    assert host in ("localhost", "127.0.0.1", "postgres"), "refusing a non-local database"
    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute("BEGIN")
        try:
            yield conn
        finally:
            conn.execute("ROLLBACK")


@pytest.fixture
def set_id(db):
    return db.execute(
        "INSERT INTO public.sets (code, name) VALUES ('WP38', 'WP38 set') RETURNING id"
    ).fetchone()[0]


def product(db, set_id, usd_price, active=True):
    return db.execute(
        "INSERT INTO public.products (set_id, usd_price, url, last_updated, active) "
        "VALUES (%s, %s, 'https://www.tcgplayer.com/product/1', now(), %s) RETURNING id",
        (set_id, usd_price, active),
    ).fetchone()[0]


def price(db, product_id, day_offset, usd):
    """One history row `day_offset` days from today (0 = today), at 04:00."""
    db.execute(
        "INSERT INTO public.product_price_history (product_id, usd_price, recorded_at) "
        "VALUES (%s, %s, current_date + %s::integer + time '04:00')",
        (product_id, usd, day_offset),
    )


def latest(db, ids, role="anon"):
    """get_latest_prices as `role` (proves SECURITY INVOKER reads through RLS)."""
    db.execute(f"SET LOCAL ROLE {role}")
    try:
        if ids is None:
            rows = db.execute(
                "SELECT product_id, price_recorded_at::date - current_date, recorded_usd_price, usd_price "
                "FROM public.get_latest_prices()"
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT product_id, price_recorded_at::date - current_date, recorded_usd_price, usd_price "
                "FROM public.get_latest_prices(%s::bigint[])",
                (ids,),
            ).fetchall()
    finally:
        db.execute("RESET ROLE")
    return {r[0]: (r[1], r[2], r[3]) for r in rows}


# ------------------------------------------------------------ get_latest_prices


def test_fresh_price_is_published_with_its_date(db, set_id):
    pid = product(db, set_id, 110)
    price(db, pid, -3, 100)
    price(db, pid, -1, 110)
    assert latest(db, [pid]) == {pid: (-1, 110, 110)}


def test_gate_matches_0023_at_the_14_day_edge(db, set_id):
    fresh = product(db, set_id, 50)
    stale = product(db, set_id, 50)
    price(db, fresh, -14, 50)
    price(db, stale, -15, 50)
    rows = latest(db, [fresh, stale])
    assert rows[fresh] == (-14, 50, 50)
    assert rows[stale] == (-15, 50, None)  # withheld, date kept


def test_value_must_agree_with_the_row_that_dates_it(db, set_id):
    pid = product(db, set_id, 449.95)  # products.usd_price left behind
    price(db, pid, -1, 501.5)
    assert latest(db, [pid]) == {pid: (-1, 501.5, None)}


def test_null_list_means_active_products_and_ids_include_inactive(db, set_id):
    on = product(db, set_id, 10)
    off = product(db, set_id, 10, active=False)
    never = product(db, set_id, 10)
    price(db, on, 0, 10)
    price(db, off, 0, 10)
    everything = latest(db, None)
    assert on in everything and off not in everything and never not in everything
    by_id = latest(db, [off, never, 999999999, off])
    assert set(by_id) == {off}
    assert by_id[off] == (0, 10, 10)


def test_authenticated_may_call_it(db, set_id):
    pid = product(db, set_id, 10)
    price(db, pid, 0, 10)
    assert latest(db, [pid], role="authenticated") == {pid: (0, 10, 10)}


# ------------------------------------------------------- volume window anchor


def sales(db, product_id, first_offset, last_offset, qty, today_partial=None):
    db.execute(
        "INSERT INTO public.product_sales_history "
        "(product_id, bucket_date, granularity, quantity_sold, transaction_count) "
        "SELECT %s, current_date + d, 'day', %s::integer, 1 FROM generate_series(%s::integer, %s::integer) d",
        (product_id, qty, first_offset, last_offset),
    )
    if today_partial is not None:
        db.execute(
            "INSERT INTO public.product_sales_history "
            "(product_id, bucket_date, granularity, quantity_sold, transaction_count) "
            "VALUES (%s, current_date, 'day', %s, 1)",
            (product_id, today_partial),
        )


def volume(db, product_id):
    return db.execute(
        "SELECT units_sold_7d, units_sold_30d, units_sold_prior_30d "
        "FROM public.get_market_product_volume_metrics() WHERE product_id = %s",
        (product_id,),
    ).fetchone()


@pytest.mark.parametrize("lag", [0, 1, 2, 3])
def test_flat_demand_reads_flat_whatever_the_collection_lag(db, set_id, lag):
    pid = product(db, set_id, 10)
    # 10 units every day up to `lag` days ago; with lag 0 today's partial
    # bucket (4 so far) is present too, as the scraper stores it.
    sales(db, pid, -75, -max(lag, 1), 10, today_partial=4 if lag == 0 else None)
    assert volume(db, pid) == (70, 300, 300)


def test_stale_daily_data_still_withholds_the_windows(db, set_id):
    pid = product(db, set_id, 10)
    sales(db, pid, -75, -4, 10)
    units_7d, units_30d, _prior = volume(db, pid)
    assert units_7d is None and units_30d is None


# --------------------------------------------------- export_my_data currency


def test_export_includes_the_recipe_currency(db):
    uid = str(uuid.uuid4())
    db.execute(
        "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (%s, %s, %s::jsonb)",
        (uid, f"wp38-{uid[:8]}@example.com", json.dumps({"username": "wp38" + uid[:8]})),
    )
    db.execute(
        "INSERT INTO public.box_recipes (user_id, name, retail_price, promo_value, packs, currency) "
        "VALUES (%s, 'WP38 recipe', 150, 10, '[]'::jsonb, 'CAD')",
        (uid,),
    )
    db.execute("SET LOCAL ROLE authenticated")
    db.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", (uid,))
    exported = db.execute("SELECT public.export_my_data()").fetchone()[0]
    db.execute("RESET ROLE")
    assert [r["currency"] for r in exported["box_recipes"]] == ["CAD"]


def test_export_patch_kept_volatile_definer_and_acl(db):
    volatility, definer = db.execute(
        "SELECT provolatile, prosecdef FROM pg_proc "
        "WHERE oid = 'public.export_my_data()'::regprocedure"
    ).fetchone()
    assert (volatility, definer) == ("v", True)
    anon, authenticated = db.execute(
        "SELECT has_function_privilege('anon', 'public.export_my_data()', 'EXECUTE'), "
        "has_function_privilege('authenticated', 'public.export_my_data()', 'EXECUTE')"
    ).fetchone()
    assert (anon, authenticated) == (False, True)
```

Run against a database built by `scripts/db/replay_migrations.sh` (it applies the three new files in registry order): 12 passed. Against the previous definitions (0027 and 0024 instead of steps 3 and 2): the four flat-demand cases and the export case fail, which is the regression signal.

### 2. `tests/test_wp38_migrations_static.py` (new; no database)

```python
"""
Static guards for WP38's three migrations (no database needed).

Each check reads the migration file itself (found by its name suffix, so the
registry's final number does not matter) or the EFFECTIVE definition of a
function: the last CREATE [OR REPLACE] FUNCTION for that name in apply order
(the out-of-band files first, then the numbered files; README.md "The
ordering constraints that matter").

Run with: python -m pytest tests/test_wp38_migrations_static.py -v
"""
import os
import re
from pathlib import Path

MIGRATIONS = Path(os.environ.get("POKEFIN_MIGRATIONS_DIR",
                                 Path(__file__).resolve().parent.parent / "migrations"))
EARLY_FILES = ("0000_baseline.sql", "create_box_recipes.sql",
               "20260506_market_performance_functions.sql")
LINE_COMMENT = re.compile(r"--[^\n]*")


def apply_order():
    files = sorted(p.name for p in MIGRATIONS.glob("*.sql"))
    early = [f for f in EARLY_FILES if f in files]
    return early + [f for f in files if f not in early]


def one_file(suffix):
    found = [n for n in apply_order() if n.endswith(suffix) and n[:4].isdigit()]
    assert len(found) == 1, f"expected exactly one migrations/NNNN{suffix}, found {found}"
    return found[0], (MIGRATIONS / found[0]).read_text()


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


# ---------------------------------------------------------- get_latest_prices

def test_latest_prices_is_the_effective_definition_and_invoker():
    name, _ = one_file("_get_latest_prices.sql")
    eff_name, stmt = effective("get_latest_prices")
    assert eff_name == name
    s = squash(stmt)
    assert "security invoker" in s and "security definer" not in s
    assert " stable " in s


def test_latest_prices_repeats_the_0023_gate_verbatim():
    _, stmt = effective("get_latest_prices")
    s = squash(stmt)
    assert ("case when lp.recorded_at >= current_date - 14 "
            "and p.usd_price is not distinct from lp.usd_price then p.usd_price end") in s
    assert "order by h.recorded_at desc limit 1" in s, "one index probe per product"
    # active only when no ids are passed; never when ids are passed (F146 note)
    assert "when p_product_ids is null then p.active = true else p.id = any (p_product_ids)" in s


def test_latest_prices_acl_and_search_path():
    _, sql = one_file("_get_latest_prices.sql")
    s = squash(LINE_COMMENT.sub("", sql))
    assert "revoke all on function public.get_latest_prices(bigint[]) from public;" in s
    assert re.search(r"grant execute on function public\.get_latest_prices\(bigint\[\]\) "
                     r"to anon, authenticated, service_role;", s)
    assert "alter function public.get_latest_prices(bigint[]) set search_path = public;" in s


# ------------------------------------------------------- export_my_data patch

def test_export_currency_is_patched_in_place_not_redefined():
    _, sql = one_file("_export_includes_box_recipe_currency.sql")
    # A full CREATE here would drop the keys 0038, 0039 and 0040 add whenever
    # this file is applied after them, and WP34/WP35's "which files define
    # export_my_data" checks would find a third definition.
    assert "FUNCTION public.export_my_data" not in sql
    assert "pg_get_functiondef('public.export_my_data()'::regprocedure)" in sql
    assert "$k$'promo_value', promo_value,$k$" in sql
    assert "$k$'promo_value', promo_value, 'currency', currency,$k$" in sql


def test_export_patch_sorts_after_the_full_redefinitions():
    name, _ = one_file("_export_includes_box_recipe_currency.sql")
    # 0038 (WP34) and 0039 (WP35) redefine export_my_data in full; the patch
    # must replay after them or the replayed database loses the key.
    assert name[:4] > "0039", f"{name} must be numbered above 0039"


# ------------------------------------------------------------ volume windows

def test_volume_windows_end_on_the_anchor_day():
    name, _ = one_file("_volume_windows_complete_days.sql")
    eff_name, stmt = effective("get_market_product_volume_metrics")
    assert eff_name == name
    s = squash(stmt)
    assert ("case when df.newest_day_bucket >= current_date - 3 "
            "and df.newest_day_bucket < current_date - 1 "
            "then df.newest_day_bucket else current_date - 1 end as anchor_day") in s
    for window in ("between wa.anchor_day - 6 and wa.anchor_day",
                   "between wa.anchor_day - 29 and wa.anchor_day",
                   "between wa.anchor_day - 59 and wa.anchor_day - 30",
                   "between wa.anchor_day - 63 and wa.anchor_day - 36"):
        assert window in s, f"{name}: window {window!r} missing"
    assert ">= current_date - 6 " not in s and ">= current_date - 29 " not in s, (
        f"{name}: a window still ends at current_date (review N02)")
    assert "where sh.bucket_date >= current_date - 66" in s


def test_volume_freshness_gate_is_unchanged():
    _, stmt = effective("get_market_product_volume_metrics")
    s = squash(stmt)
    assert s.count("case when df.newest_day_bucket >= current_date - 3 and sa.days_") == 3
```

7 passed with this package; 6 of 7 fail without it. `tests/test_wp10_market_rpc_bounds.py` (WP10) must still pass unchanged: step 3 keeps `day_freshness` and `latest_listings` exactly as 0027 wrote them.

### 3. `tests/test_wp38_pipeline.py` (new; no database, no network)

```python
"""
Unit tests for WP38's Python changes (no database, no network):
  * main.py: the Bank of Canada Valet client, one exchange_rates row per
    observation date, the stale-rate alert (review N05);
  * compare_prices.py: gated market prices, active products only, the price
    date, duplicate-SKU warning (review N08);
  * update_shopify_skus.py: language and variant matching, variant rows left
    alone (review N08).

Run with: python -m pytest tests/test_wp38_pipeline.py -v
"""
import csv
import logging
import sys
from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

# Same stand-in as tests/test_main.py, so importing main needs no secrets.
sys.modules.setdefault("secretsFile", MagicMock())
sys.modules["secretsFile"].SUPABASE_URL = "https://test.supabase.co"
sys.modules["secretsFile"].SUPABASE_KEY = "test-key"

import main  # noqa: E402
import compare_prices  # noqa: E402
import update_shopify_skus  # noqa: E402


# --------------------------------------------------------------------- main.py


def valet_session(observations, status=200):
    response = MagicMock()
    response.status_code = status
    response.json.return_value = {"observations": observations}
    response.raise_for_status.side_effect = None if status == 200 else Exception(f"HTTP {status}")
    session = MagicMock()
    session.get.return_value = response
    return session


class TestValetClient:
    def test_takes_the_newest_usable_observation(self):
        session = valet_session([
            {"d": "2026-09-28", "FXUSDCAD": {"v": "1.3610"}},
            {"d": "2026-09-30", "FXUSDCAD": {"v": "1.3702"}},
            {"d": "2026-09-29", "FXUSDCAD": {"v": "1.3650"}},
            {"d": "2026-10-01", "FXUSDCAD": {}},             # not published yet
            {"d": "2026-10-02", "FXUSDCAD": {"v": "13.70"}},  # outside the sanity band
        ])
        assert main.fetch_latest_boc_usd_cad(session=session) == (date(2026, 9, 30), 1.3702)
        url = session.get.call_args.args[0]
        assert url == "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json"

    def test_raises_without_a_usable_observation(self):
        with pytest.raises(ValueError):
            main.fetch_latest_boc_usd_cad(session=valet_session([{"d": "2026-09-30", "FXUSDCAD": {}}]))

    def test_raises_on_an_unexpected_payload(self):
        session = valet_session([])
        session.get.return_value.json.return_value = {"error": "x"}
        with pytest.raises(ValueError):
            main.fetch_latest_boc_usd_cad(session=session)


class TestBusinessDays:
    @pytest.mark.parametrize("earlier, later, expected", [
        (date(2026, 9, 25), date(2026, 9, 29), 2),   # Fri -> Tue
        (date(2026, 9, 25), date(2026, 9, 27), 0),   # Fri -> Sun
        (date(2026, 9, 25), date(2026, 10, 1), 4),   # Fri -> Thu
        (date(2026, 9, 25), date(2026, 10, 2), 5),   # Fri -> next Fri
        (date(2026, 9, 30), date(2026, 9, 30), 0),
        (date(2026, 9, 30), date(2026, 9, 29), 0),
    ])
    def test_counts_weekdays_after_the_first_date(self, earlier, later, expected):
        assert main.business_days_between(earlier, later) == expected


class FakePgDb:
    def __init__(self, existing=()):
        self.existing = set(existing)
        self.inserted = []

    def exchange_rate_exists_for(self, day_iso):
        return day_iso in self.existing

    def insert_exchange_rate(self, usd_to_cad, recorded_at_iso):
        self.inserted.append((usd_to_cad, recorded_at_iso))


def frozen_now(day):
    """A stand-in for main.datetime whose now() is noon UTC on `day`."""
    fake = MagicMock(wraps=datetime)
    fake.now.return_value = datetime(day.year, day.month, day.day, 12, tzinfo=timezone.utc)
    return fake


class TestFetchAndStoreExchangeRate:
    def test_stores_a_new_observation_date_once(self):
        db = FakePgDb()
        with patch.object(main, "pg_db", db), \
             patch.object(main, "fetch_latest_boc_usd_cad", return_value=(date(2026, 9, 30), 1.3702)), \
             patch.object(main, "datetime", frozen_now(date(2026, 10, 1))):
            assert main.fetch_and_store_exchange_rate() is True
        assert db.inserted == [(1.3702, "2026-09-30T00:00:00")]

    def test_skips_a_date_already_stored(self):
        db = FakePgDb(existing={"2026-09-30"})
        with patch.object(main, "pg_db", db), \
             patch.object(main, "fetch_latest_boc_usd_cad", return_value=(date(2026, 9, 30), 1.3702)), \
             patch.object(main, "datetime", frozen_now(date(2026, 10, 1))):
            assert main.fetch_and_store_exchange_rate() is False
        assert db.inserted == []

    def test_logs_exchange_rate_stale_past_four_business_days(self, caplog):
        db = FakePgDb(existing={"2026-09-24"})
        with patch.object(main, "pg_db", db), \
             patch.object(main, "fetch_latest_boc_usd_cad", return_value=(date(2026, 9, 24), 1.36)), \
             patch.object(main, "datetime", frozen_now(date(2026, 10, 1))), \
             caplog.at_level(logging.ERROR):
            main.fetch_and_store_exchange_rate()
        assert any("exchange_rate_stale" in r.getMessage() for r in caplog.records)

    def test_a_fresh_rate_logs_no_alert(self, caplog):
        with patch.object(main, "pg_db", FakePgDb()), \
             patch.object(main, "fetch_latest_boc_usd_cad", return_value=(date(2026, 9, 30), 1.37)), \
             patch.object(main, "datetime", frozen_now(date(2026, 10, 1))), \
             caplog.at_level(logging.ERROR):
            main.fetch_and_store_exchange_rate()
        assert not any("exchange_rate_stale" in r.getMessage() for r in caplog.records)

    def test_never_raises(self):
        with patch.object(main, "fetch_latest_boc_usd_cad", side_effect=RuntimeError("down")):
            assert main.fetch_and_store_exchange_rate() is False

    def test_supabase_path_checks_the_date_window_then_inserts(self):
        sb = MagicMock()
        sb.table.return_value.select.return_value.gte.return_value.lt.return_value \
            .limit.return_value.execute.return_value.data = []
        with patch.object(main, "pg_db", None), patch.object(main, "supabase", sb), \
             patch.object(main, "fetch_latest_boc_usd_cad", return_value=(date(2026, 9, 30), 1.3702)), \
             patch.object(main, "datetime", frozen_now(date(2026, 10, 1))):
            assert main.fetch_and_store_exchange_rate() is True
        sb.table.return_value.select.return_value.gte.assert_called_once_with("recorded_at", "2026-09-30")
        sb.table.return_value.select.return_value.gte.return_value.lt.assert_called_once_with(
            "recorded_at", "2026-10-01")
        sb.table.return_value.insert.assert_called_once_with(
            {"usd_to_cad": 1.3702, "recorded_at": "2026-09-30T00:00:00"})


# ----------------------------------------------------------- compare_prices.py


def pokefin_supabase(product_rows, latest_rows):
    sb = MagicMock()
    sb.table.return_value.select.return_value.not_.is_.return_value.eq.return_value \
        .execute.return_value.data = product_rows
    sb.rpc.return_value.execute.return_value.data = latest_rows
    return sb


class TestComparePricesMarketPrices:
    def test_uses_the_gated_price_and_its_date_for_active_products(self):
        sb = pokefin_supabase(
            [
                {"id": 1, "sku": "A", "last_updated": "2026-09-30T04:00:00",
                 "sets": {"name": "S"}, "product_types": {"label": "Booster Box"}},
                {"id": 2, "sku": "B", "last_updated": "2026-06-17T04:00:00",
                 "sets": {"name": "S"}, "product_types": {"label": "ETB"}},
                {"id": 3, "sku": "C", "last_updated": None,
                 "sets": None, "product_types": None},
            ],
            [
                {"product_id": 1, "usd_price": 120.0, "price_recorded_at": "2026-09-30T04:00:00",
                 "recorded_usd_price": 120.0},
                # 105 days old: the RPC withholds it, the date survives
                {"product_id": 2, "usd_price": None, "price_recorded_at": "2026-06-17T04:00:00",
                 "recorded_usd_price": 1649.99},
            ],
        )
        with patch.object(compare_prices, "supabase", sb):
            products = compare_prices.fetch_pokefin_prices()
        assert products["A"]["market_price"] == 120.0 and products["A"]["price_date"] == "2026-09-30"
        assert products["B"]["market_price"] is None and products["B"]["price_date"] == "2026-06-17"
        assert products["C"]["market_price"] is None and products["C"]["price_date"] is None
        sb.table.return_value.select.return_value.not_.is_.return_value.eq.assert_called_once_with(
            "active", True)
        sb.rpc.assert_called_once_with("get_latest_prices", {})

    def test_a_withheld_price_is_reported_as_no_market_price(self):
        shopify = {"B": {"sku": "B", "title": "Old box", "shopify_price": 2000.0,
                         "shopify_cost": None, "handle": "b"}}
        pokefin = {"B": {"sku": "B", "market_price": None, "price_date": "2026-06-17",
                         "last_updated": None, "set_name": "S", "product_type": "ETB"}}
        results = compare_prices.compare_prices(shopify, pokefin, 1.37)
        assert results["matched"] == [] and len(results["no_market_price"]) == 1


class TestComparePricesDuplicateSkus:
    def test_api_loader_warns_about_a_sku_shared_by_two_variants(self, caplog):
        response = MagicMock(status_code=200, links={})
        response.json.return_value = {"products": [{
            "title": "Surging Sparks ETB", "handle": "ss-etb",
            "variants": [
                {"sku": "SV-SSP-ETB", "price": "79.99"},
                {"sku": "SV-SSP-ETB", "price": "149.99"},
            ],
        }]}
        with patch.object(compare_prices.requests, "get", return_value=response), \
             caplog.at_level(logging.WARNING):
            products = compare_prices.fetch_shopify_products_api("s.myshopify.com", "t", "2024-07")
        assert list(products) == ["SV-SSP-ETB"]
        assert any("SV-SSP-ETB" in r.getMessage() and "more than one" in r.getMessage()
                   for r in caplog.records)


# ------------------------------------------------------ update_shopify_skus.py

MAPPING = [
    {"product_id": "1", "sku": "SV-SSP-ETB", "generation": "SV", "set_code": "SSP",
     "set_name": "Surging Sparks", "product_type": "Elite Trainer Box", "variant": "",
     "shopify_handle": ""},
    {"product_id": "2", "sku": "SV-SSP-ETB-PC", "generation": "SV", "set_code": "SSP",
     "set_name": "Surging Sparks", "product_type": "Elite Trainer Box",
     "variant": "Pokemon Center", "shopify_handle": ""},
    {"product_id": "3", "sku": "SV-SSP-BB", "generation": "SV", "set_code": "SSP",
     "set_name": "Surging Sparks", "product_type": "Booster Box", "variant": "",
     "shopify_handle": ""},
]
JP_ROW = {"product_id": "4", "sku": "SV-SSP-BB-JP", "generation": "SV", "set_code": "SSP",
          "set_name": "Surging Sparks", "product_type": "Booster Box", "variant": "Japanese",
          "shopify_handle": ""}


def best(title, mapping=MAPPING):
    match = update_shopify_skus.find_best_match({"title": title, "tags": "", "handle": ""}, mapping)
    return match and match["sku"]


class TestFindBestMatch:
    def test_standard_box_takes_the_standard_sku(self):
        assert best("Scarlet & Violet - Surging Sparks Elite Trainer Box") == "SV-SSP-ETB"

    def test_pokemon_center_box_takes_the_pokemon_center_sku(self):
        assert best("Scarlet & Violet - Surging Sparks Pokemon Center Elite Trainer Box") == "SV-SSP-ETB-PC"

    def test_japanese_listing_never_takes_an_english_sku(self):
        assert best("Japanese - Scarlet & Violet - Surging Sparks Booster Box") is None

    def test_japanese_listing_takes_the_japanese_sku(self):
        assert best("Japanese - Scarlet & Violet - Surging Sparks Booster Box",
                    MAPPING + [JP_ROW]) == "SV-SSP-BB-JP"

    def test_english_listing_never_takes_the_japanese_sku(self):
        assert best("Scarlet & Violet - Surging Sparks Booster Box", [JP_ROW]) is None


class TestVariantRows:
    def test_variant_rows_keep_their_own_sku(self, tmp_path):
        mapping_path = tmp_path / "sku_mapping.csv"
        with open(mapping_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["Product ID", "SKU", "Generation", "Set Code", "Set Name",
                             "Product Type", "Variant", "Shopify Handle (suggested)"])
            writer.writerow(["1", "SV-SSP-ETB", "SV", "SSP", "Surging Sparks",
                             "Elite Trainer Box", "", ""])
        export_path = tmp_path / "products_export.csv"
        with open(export_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["Handle", "Title", "Tags", "Variant SKU"])
            writer.writerow(["ss-etb", "Scarlet & Violet - Surging Sparks Elite Trainer Box", "", "OLD-1"])
            writer.writerow(["ss-etb", "", "", "OLD-2"])   # second variant
            writer.writerow(["ss-etb", "", "", ""])        # image row
        matched, unmatched, rows = update_shopify_skus.process_shopify_export(
            str(export_path), str(mapping_path))
        assert len(matched) == 1 and unmatched == []
        assert [r[3] for r in rows[1:]] == ["SV-SSP-ETB", "OLD-2", ""]
```

24 passed against this package's `main.py`, `compare_prices.py` and `update_shopify_skus.py`; 20 fail against the previous ones. If importing `compare_prices` fails in your environment, import it the way `tests/test_pipeline_hardening.py` (WP16) does.

### 4. `frontend/app/lib/__tests__/latestPrices.test.ts` (new)

```ts
import { chunkIds, LATEST_PRICES_CHUNK, newestPricedAtInWindow } from "../latestPrices";

describe("chunkIds", () => {
  it("drops repeated ids and keeps first-seen order", () => {
    expect(chunkIds([3, 1, 3, 2, 5], 2)).toEqual([[3, 1], [2, 5]]);
  });
  it("splits at LATEST_PRICES_CHUNK", () => {
    const ids = Array.from({ length: 1201 }, (_, i) => i + 1);
    expect(chunkIds(ids).map((chunk) => chunk.length)).toEqual([500, 500, 201]);
    expect(LATEST_PRICES_CHUNK).toBe(500);
  });
  it("returns no chunk for no ids", () => {
    expect(chunkIds([])).toEqual([]);
  });
});

describe("newestPricedAtInWindow", () => {
  it("keeps rows recorded on or after the window start, with the row's own price", () => {
    const map = newestPricedAtInWindow(
      [
        { product_id: 1, price_recorded_at: "2026-09-17T04:00:00", recorded_usd_price: 10, usd_price: 10 },
        { product_id: 2, price_recorded_at: "2026-09-16T23:59:59", recorded_usd_price: 20, usd_price: null },
        { product_id: 3, price_recorded_at: null, recorded_usd_price: null, usd_price: null },
        { product_id: 4, price_recorded_at: "2026-09-30 04:00:00", recorded_usd_price: 40, usd_price: 41 },
      ],
      "2026-09-17"
    );
    expect([...map]).toEqual([
      [1, { recordedAt: "2026-09-17T04:00:00", usdPrice: 10 }],
      [4, { recordedAt: "2026-09-30 04:00:00", usdPrice: 40 }],
    ]);
  });
});
```

### 5. `frontend/app/lib/__tests__/clientMarketData.latestPrices.test.ts` (new)

```ts
export {};

const mockRpc = jest.fn();
const mockLogCaughtError = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: jest.fn(),
  },
}));
jest.mock("../logger", () => ({
  logSupabaseError: jest.fn(),
  logCaughtError: (...args: unknown[]) => mockLogCaughtError(...args),
}));

/** recorded_at `days` UTC days ago, at 04:00, as PostgREST returns it. */
function daysAgo(days: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
  return `${d.toISOString().slice(0, 10)}T04:00:00`;
}

beforeEach(() => {
  jest.resetModules();
  mockRpc.mockReset();
  mockLogCaughtError.mockReset();
});

it("asks for the given ids once each, in chunks of 500", async () => {
  const { fetchLatestPricesClient } = await import("../clientMarketData");
  mockRpc.mockResolvedValue({ data: [], error: null });
  await fetchLatestPricesClient([1, 2, 2, 3]);
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith("get_latest_prices", { p_product_ids: [1, 2, 3] });

  mockRpc.mockClear();
  await fetchLatestPricesClient(Array.from({ length: 1200 }, (_, i) => i + 1));
  expect(mockRpc.mock.calls.map(([, args]) => (args as { p_product_ids: number[] }).p_product_ids.length)).toEqual([500, 500, 200]);
});

it("asks for the whole active catalog without ids, and logs a possible row cap", async () => {
  const { fetchLatestPricesClient } = await import("../clientMarketData");
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    product_id: i + 1, price_recorded_at: daysAgo(1), recorded_usd_price: 1, usd_price: 1,
  }));
  mockRpc.mockResolvedValue({ data: rows, error: null });
  expect(await fetchLatestPricesClient()).toHaveLength(1000);
  expect(mockRpc).toHaveBeenCalledWith("get_latest_prices");
  expect(mockLogCaughtError).toHaveBeenCalledWith("client_latest_prices_row_cap", expect.any(Error));
});

it("returns null and logs when a request fails, and [] for no ids without a request", async () => {
  const { fetchLatestPricesClient } = await import("../clientMarketData");
  mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
  expect(await fetchLatestPricesClient([1])).toBeNull();
  expect(mockLogCaughtError).toHaveBeenCalledWith("client_latest_prices_failed", { message: "boom" });
  mockRpc.mockClear();
  expect(await fetchLatestPricesClient([])).toEqual([]);
  expect(mockRpc).not.toHaveBeenCalled();
});

it("fetchNewestPricedAtClient keeps only rows inside the 14-day window and fails closed", async () => {
  const { fetchNewestPricedAtClient } = await import("../clientMarketData");
  mockRpc.mockResolvedValue({
    data: [
      { product_id: 1, price_recorded_at: daysAgo(1), recorded_usd_price: 110, usd_price: 110 },
      { product_id: 2, price_recorded_at: daysAgo(20), recorded_usd_price: 90, usd_price: null },
    ],
    error: null,
  });
  const map = await fetchNewestPricedAtClient([1, 2]);
  expect([...map]).toEqual([[1, { recordedAt: daysAgo(1), usdPrice: 110 }]]);

  mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
  expect((await fetchNewestPricedAtClient([1])).size).toBe(0);
});
```

### 6. `frontend/app/lib/__tests__/portfolio.search.test.ts` (new)

```ts
const mockFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));
jest.mock("../logger", () => ({
  logSupabaseError: jest.fn(),
  logCaughtError: jest.fn(),
}));

import { getAllProducts, searchProducts } from "../portfolio";

/** A PostgREST-like chain that resolves to `rows` whichever filters are applied. */
function productsQuery(rows: unknown[]) {
  const result = Promise.resolve({ data: rows, error: null });
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "ilike", "in", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain.then = result.then.bind(result);
  return chain;
}

const PRODUCT = (id: number, usdPrice: number | null) => ({
  id,
  usd_price: usdPrice,
  image_url: null,
  variant: null,
  sets: { name: "Surging Sparks", code: "SSP" },
  product_types: { name: "booster_box", label: "Booster Box" },
});

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
});

it("prices search results with get_latest_prices for exactly those ids, never the summaries", async () => {
  mockFrom.mockReturnValue(productsQuery([PRODUCT(7, 999), PRODUCT(9, 999)]));
  mockRpc.mockResolvedValue({
    data: [
      { product_id: 7, price_recorded_at: "2026-09-30T04:00:00", recorded_usd_price: 120, usd_price: 120 },
      { product_id: 9, price_recorded_at: "2026-09-01T04:00:00", recorded_usd_price: 80, usd_price: null },
    ],
    error: null,
  });
  const results = await searchProducts("surging");
  expect(results.map((r) => [r.id, r.usd_price, r.price_recorded_at])).toEqual([
    [7, 120, "2026-09-30T04:00:00"],
    [9, null, "2026-09-01T04:00:00"],
  ]);
  expect(mockRpc.mock.calls).toEqual([["get_latest_prices", { p_product_ids: [7, 9] }]]);
});

it("withholds every price when the lookup fails", async () => {
  mockFrom.mockReturnValue(productsQuery([PRODUCT(7, 999)]));
  mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
  const [result] = await searchProducts("surging");
  expect(result.usd_price).toBeNull();
  expect(result.price_recorded_at).toBeNull();
});

it("getAllProducts (the import catalog) uses the same lookup", async () => {
  mockFrom.mockReturnValue(productsQuery([PRODUCT(1, 50), PRODUCT(2, 60)]));
  mockRpc.mockResolvedValue({ data: [], error: null });
  const results = await getAllProducts();
  expect(results.map((r) => r.usd_price)).toEqual([null, null]); // no history rows: never priced
  expect(mockRpc).toHaveBeenCalledWith("get_latest_prices", { p_product_ids: [1, 2] });
});
```

### 7. `frontend/app/lib/__tests__/serverMarketData.emptyCatalog.test.ts` (new)

```ts
/** @jest-environment node */
jest.mock("server-only", () => ({}));

const rpcMock = jest.fn();
const fromMock = jest.fn();
const mockLogCaughtError = jest.fn();

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: rpcMock, from: fromMock }),
}));
jest.mock("../logger", () => ({
  logSupabaseError: jest.fn(),
  logCaughtError: (...args: unknown[]) => mockLogCaughtError(...args),
}));
jest.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

import { getCachedMarketProductSummaries, getCachedSetAnalytics } from "../serverMarketData";

// Copy PRODUCT_ROW from serverMarketData.freshness.test.ts.

function recordedDaysAgo(days: number): string {
  const now = new Date();
  return `${new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days))
    .toISOString()
    .split("T")[0]}T09:00:00`;
}

function productsTable(rows: unknown[]) {
  fromMock.mockImplementation((table: string) => {
    if (table === "products") {
      return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }) };
    }
    if (table === "product_price_history") {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "in", "gte", "order"]) chain[m] = () => chain;
      chain.range = () => Promise.resolve({ data: [], error: null });
      return chain;
    }
    throw new Error(`unexpected table ${table}`);
  });
}

const ORIGINAL_PHASE = process.env.NEXT_PHASE;
afterEach(() => {
  if (ORIGINAL_PHASE === undefined) delete process.env.NEXT_PHASE;
  else process.env.NEXT_PHASE = ORIGINAL_PHASE;
  jest.clearAllMocks();
});

it("at runtime an empty catalog rejects (nothing is cached) and is logged", async () => {
  rpcMock.mockResolvedValue({ data: [], error: null });
  productsTable([]);
  await expect(getCachedMarketProductSummaries()).rejects.toThrow("Market catalog is empty");
  expect(mockLogCaughtError).toHaveBeenCalledWith("server_market_summaries_empty", expect.any(Error));
});

it("during next build an empty catalog is accepted", async () => {
  process.env.NEXT_PHASE = "phase-production-build";
  rpcMock.mockResolvedValue({ data: [], error: null });
  productsTable([]);
  await expect(getCachedMarketProductSummaries()).resolves.toEqual([]);
});

it("an empty RPC answer falls back to the products table", async () => {
  rpcMock.mockImplementation(async (name: string) =>
    name === "get_latest_prices"
      ? {
          data: [{ product_id: 42, price_recorded_at: recordedDaysAgo(1), recorded_usd_price: 449.95, usd_price: 449.95 }],
          error: null,
        }
      : { data: [], error: null }
  );
  productsTable([PRODUCT_ROW]);
  const products = await getCachedMarketProductSummaries();
  expect(products.map((p) => [p.id, p.usd_price])).toEqual([[42, 449.95]]);
});

it("an empty set board is never cached at runtime, and accepted during the build", async () => {
  rpcMock.mockResolvedValue({ data: [], error: null });
  productsTable([]);
  await expect(getCachedSetAnalytics()).rejects.toThrow();
  process.env.NEXT_PHASE = "phase-production-build";
  await expect(getCachedSetAnalytics()).resolves.toEqual([]);
});
```

### 8. `frontend/app/lib/__tests__/marketPulse.test.ts` (update; N02)

`REFERENCE_DATE` is 2026-07-06 local noon. With this package the trailing windows end on 2026-07-05 (yesterday) unless the newest usable bucket is 2026-07-03 or 2026-07-04. Change exactly these cases; every other case passes unchanged (verified by running the old and new functions on every case of this file):

- "sums day rows inside the trailing window": replace `sales` with

```ts
    const sales = [
      makeSale("2026-06-29", 4),
      makeSale("2026-06-30", 2),
      makeSale("2026-07-01", 0),
      makeSale("2026-07-02", 0),
      makeSale("2026-07-03", 0),
      makeSale("2026-07-04", 0),
      makeSale("2026-07-05", 3),
      // Today's partial bucket: outside the window, which ends yesterday.
      makeSale("2026-07-06", 50),
      // Outside a 7-day window ending 2026-07-05 (starts 2026-06-29).
      makeSale("2026-06-28", 100),
    ];
```

  and keep `toBe(9)`.
- "applies offsetDays to shift the window into the past": the comment becomes `// Prior 30d window: 2026-05-07 .. 2026-06-05 (anchor 2026-07-05).` and the loop bounds become `new Date(2026, 4, 7)` and `new Date(2026, 5, 5)`. Keep `toBe(30)`.
- "still reports a lifetime total for a product younger than the window": the three rows become `makeSale("2026-07-03", 2)`, `makeSale("2026-07-04", 3)`, `makeSale("2026-07-05", 4)`. Keep `toBe(9)`.
- In `describe("getPriorUnitsSold30d")`: the top comment becomes `// Prior-30d window for REFERENCE_DATE (2026-07-06, anchor 2026-07-05): 2026-05-07..2026-06-05.` and `// Weekly fallback window: bucket_date in 2026-05-03..2026-05-30.`; in `priorWindowDayRows` the doc becomes `/** Consecutive day rows ending 2026-06-05 (the prior-window end). */` and `new Date(2026, 5, 6 - back)` becomes `new Date(2026, 5, 5 - back)`. All its expectations stay.

Then add `getVolumeTrendPercent` and `getVolumeWindowAnchorKey` to the import from `"../marketPulse"` (if `getVolumeTrendPercent` is not imported yet) and append:

```ts
describe("volume windows end on the last complete day (review N02)", () => {
  /** 10 units a day through `lag` days ago; with lag 0, today's partial bucket (4 so far). */
  function flatSales(lag: number): SalesHistoryEntry[] {
    const rows: SalesHistoryEntry[] = [];
    for (let back = 75; back >= lag; back -= 1) {
      const d = new Date(2026, 6, 6 - back);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      rows.push(makeSale(key, back === 0 ? 4 : 10));
    }
    return rows;
  }

  it.each([0, 1, 2, 3])("flat demand with a %i-day lag gives a full 7d figure and a 0%% trend", (lag) => {
    const sales = flatSales(lag);
    const units30d = getUnitsSoldWindow(sales, 30, 0, REFERENCE_DATE);
    const prior = getPriorUnitsSold30d(sales, REFERENCE_DATE);
    expect(getUnitsSoldWindow(sales, 7, 0, REFERENCE_DATE)).toBe(70);
    expect(units30d).toBe(300);
    expect(prior).toBe(300);
    expect(getVolumeTrendPercent(units30d, prior)).toBe(0);
  });

  it("still withholds a window once collection is more than 3 days behind", () => {
    expect(getUnitsSoldWindow(flatSales(4), 7, 0, REFERENCE_DATE)).toBeNull();
  });

  it("anchors on yesterday, or on a newest bucket 2 or 3 days old", () => {
    expect(getVolumeWindowAnchorKey(flatSales(0), REFERENCE_DATE)).toBe("2026-07-05");
    expect(getVolumeWindowAnchorKey(flatSales(1), REFERENCE_DATE)).toBe("2026-07-05");
    expect(getVolumeWindowAnchorKey(flatSales(2), REFERENCE_DATE)).toBe("2026-07-04");
    expect(getVolumeWindowAnchorKey(flatSales(3), REFERENCE_DATE)).toBe("2026-07-03");
    expect(getVolumeWindowAnchorKey(flatSales(5), REFERENCE_DATE)).toBe("2026-07-05"); // stale
    expect(getVolumeWindowAnchorKey([], REFERENCE_DATE)).toBe("2026-07-05");
  });
});
```

Before this package the flat-demand cases fail (lag 1: 7d 60, trend -3.3%).

### 9. `frontend/app/lib/__tests__/import.test.ts` (update; N01)

In WP17's `describe("matchProduct")`:

- Rename "Exact set name wins among several candidates" to "an exact set name breaks a tie between two similarly named sets"; its expectation (product 1, `"exact"`) stays.
- In the variant-hint case, the row without "Pokemon Center" now gives `{ product: products[0], confidence: "high" }` (product 10). It was `"low"`; the row names no variant, product 10 is the only candidate without one, so the match is no longer a guess.
- Append:

```ts
  describe("variants (review N01)", () => {
    const surging = [
      product(101, "Surging Sparks", "Elite Trainer Box"),
      product(102, "Surging Sparks", "Elite Trainer Box", "Pokemon Center Exclusive"),
    ];
    const chilling = [
      product(201, "Chilling Reign", "Elite Trainer Box", "Shadow Rider"),
      product(202, "Chilling Reign", "Elite Trainer Box", "Ice Rider"),
    ];

    it("matches the variant the row names, before the set name", () => {
      expect(matchProduct(row("Surging Sparks", "Surging Sparks Pokemon Center Elite Trainer Box"), surging))
        .toEqual({ product: surging[1], confidence: "exact" });
      expect(matchProduct(row("Surging Sparks", "Surging Sparks Pokémon Center Elite Trainer Box"), surging).product?.id)
        .toBe(102);
    });

    it("matches a row naming no variant only to the product without one", () => {
      expect(matchProduct(row("Surging Sparks", "Surging Sparks Elite Trainer Box"), surging))
        .toEqual({ product: surging[0], confidence: "exact" });
      expect(matchProduct(row("SV: Surging Sparks", "Surging Sparks ETB"), surging).product?.id).toBe(101);
    });

    it("tells apart variants that are not Pokemon Center", () => {
      expect(matchProduct(row("Chilling Reign", "Chilling Reign Shadow Rider Elite Trainer Box"), chilling).product?.id).toBe(201);
      expect(matchProduct(row("Chilling Reign", "Chilling Reign Ice Rider Elite Trainer Box"), chilling).product?.id).toBe(202);
    });

    it("says low when the row cannot tell candidates apart", () => {
      expect(matchProduct(row("Chilling Reign", "Chilling Reign Elite Trainer Box"), chilling).confidence).toBe("low");
      expect(matchProduct(row("Surging Sparks", "Surging Sparks Elite Trainer Box"), [surging[1]]))
        .toEqual({ product: surging[1], confidence: "low" });
    });

    it("leaves a variant the catalog lacks unmatched", () => {
      expect(matchProduct(row("Surging Sparks", "Surging Sparks Pokemon Center Elite Trainer Box"), [surging[0]]))
        .toEqual({
          product: null,
          confidence: "none",
          unmatchedReason: 'No matching elite trainer boxes with "pokemon center" for this set',
        });
    });
  });
```

And append to WP18's `describe("parseCollectrCSV with RFC 4180 quoting (F003)")` (it has `HEADER`; the rows below are full 16-column lines):

```ts
  it("keeps a missing or unreadable cost as NaN, never 0 (review N01)", () => {
    const line = (cost: string) =>
      `Sealed Product,Pokemon,Surging Sparks,Surging Sparks Booster Box,,,Normal,Ungraded,Near Mint,${cost},2,250,0,false,2025-06-08,`;
    const rows = parseCollectrCSV([HEADER, line(""), line('"1,234.56"'), line("0"), line("199.5")].join("\n"));
    expect(rows.map((r) => r.averageCostPaid)).toEqual([NaN, NaN, 0, 199.5]);
  });
```

(`toEqual` treats `NaN` as equal to `NaN`.)

### 10. `frontend/app/lib/__tests__/import.holdings.test.ts` (WP05's; update; N01)

Append, reusing the file's fixture builders and its `importHoldingRows` mock:

- `processCollectrImport` keeps every portfolio: a CSV with one row in `Portfolio Name=Sealed Product` and one in `Portfolio Name=Main` (both `Category=Pokemon`, unsupported product names as in the file's first case) returns 2 results.
- `importHoldings` with `averageCostPaid: NaN` gives `importStatus: "error"`, `errorMessage: "No average cost in the CSV"`, and `importHoldingRows` is not called when it is the only row.
- `averageCostPaid: 0` is sent with `purchase_price_usd: 0`.
- `dateAdded: "2026-02-31"` gives `errorMessage: "Invalid purchase date (2026-02-31)"`; `dateAdded: "2999-01-01"` gives `"Invalid purchase date (2999-01-01)"`; neither is sent.

### 11. `frontend/app/lib/__tests__/importRows.test.ts` (new)

```ts
import {
  collectrPortfolioNames,
  defaultCollectrPortfolio,
  hasImportableCost,
  inCollectrPortfolio,
  isImportable,
  preselectImportRows,
} from "../importRows";
import type { ImportMatchResult } from "../../components/Portfolio/types";

function result(
  portfolioName: string,
  averageCostPaid: number,
  confidence: ImportMatchResult["matchConfidence"] = "exact",
  matched = true
): ImportMatchResult {
  return {
    csvRow: {
      portfolioName, category: "Pokemon", set: "S", productName: "S Booster Box", cardNumber: "",
      rarity: "", variance: "", grade: "", cardCondition: "", averageCostPaid, quantity: 1,
      marketPrice: 0, priceOverride: 0, watchlist: false, dateAdded: "", notes: "",
    },
    matchedProduct: matched
      ? { id: 1, usd_price: null, image_url: null, variant: null, sets: null, product_types: null }
      : null,
    matchConfidence: confidence,
    importStatus: "pending",
  } as ImportMatchResult;
}

it("a cost is importable when it is a number, including 0", () => {
  expect(hasImportableCost({ averageCostPaid: NaN })).toBe(false);
  expect(hasImportableCost({ averageCostPaid: 0 })).toBe(true);
  expect(isImportable(result("A", 10))).toBe(true);
  expect(isImportable(result("A", NaN))).toBe(false);
  expect(isImportable(result("A", 10, "none", false))).toBe(false);
});

it("lists portfolios in file order and opens on Sealed Product only among several", () => {
  const rows = [result("Main", 1), result("Sealed Product", 1), result("Main", 1), result(" ", 1)];
  expect(collectrPortfolioNames(rows)).toEqual(["Main", "Sealed Product"]);
  expect(defaultCollectrPortfolio(["Main", "Sealed Product"])).toBe("Sealed Product");
  expect(defaultCollectrPortfolio(["Sealed Product"])).toBeNull();
  expect(defaultCollectrPortfolio(["Main", "Cards"])).toBeNull();
  expect(inCollectrPortfolio(rows[0], null)).toBe(true);
  expect(inCollectrPortfolio(rows[0], "Sealed Product")).toBe(false);
});

it("preselects confident, importable rows of the chosen portfolio", () => {
  const rows = [
    result("Sealed Product", 10, "exact"),
    result("Sealed Product", NaN, "exact"),
    result("Sealed Product", 10, "low"),
    result("Main", 10, "high"),
  ];
  expect([...preselectImportRows(rows, "Sealed Product")]).toEqual([0]);
  expect([...preselectImportRows(rows, null)]).toEqual([0, 3]);
});
```

### 12. `frontend/app/components/Portfolio/__tests__/ImportHoldingsModal.preview.test.tsx` (new; N01)

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import ImportHoldingsModal from "../cards/ImportHoldingsModal";
import { processCollectrImport } from "../../../lib/import";
import type { ImportMatchResult } from "../types";

jest.mock("../../../lib/import", () => ({
  processCollectrImport: jest.fn(),
  importHoldings: jest.fn(),
  calculateImportSummary: jest.fn(() => ({ total: 0, matched: 0, unmatched: 0, imported: 0, skipped: 0, errors: 0 })),
  CSV_MAX_BYTES: 2 * 1024 * 1024,
  CSV_MAX_ROWS: 10_000,
}));
jest.mock("../../../lib/logger", () => ({ logCaughtError: jest.fn() }));

const etb = (id: number, variant: string | null) => ({
  id, usd_price: 100, image_url: null, variant,
  sets: { name: "Surging Sparks", code: "SSP" },
  product_types: { name: "elite_trainer_box", label: "Elite Trainer Box" },
});
const row = (portfolioName: string, productName: string, averageCostPaid: number) => ({
  portfolioName, category: "Pokemon", set: "Surging Sparks", productName, cardNumber: "", rarity: "",
  variance: "", grade: "", cardCondition: "", averageCostPaid, quantity: 1, marketPrice: 0,
  priceOverride: 0, watchlist: false, dateAdded: "2026-09-01", notes: "",
});
const RESULTS = [
  { csvRow: row("Sealed Product", "Surging Sparks Pokemon Center Elite Trainer Box", 120), matchedProduct: etb(102, "Pokemon Center"), matchConfidence: "exact", importStatus: "pending", idempotencyKey: "00000000-0000-4000-8000-000000000001" },
  { csvRow: row("Sealed Product", "Surging Sparks Elite Trainer Box", NaN), matchedProduct: etb(101, null), matchConfidence: "exact", importStatus: "pending", idempotencyKey: "00000000-0000-4000-8000-000000000002" },
  { csvRow: row("Main", "Surging Sparks Elite Trainer Box", 55), matchedProduct: etb(101, null), matchConfidence: "exact", importStatus: "pending", idempotencyKey: "00000000-0000-4000-8000-000000000003" },
] as ImportMatchResult[];

async function openPreview() {
  (processCollectrImport as jest.Mock).mockResolvedValue(RESULTS);
  render(<ImportHoldingsModal isOpen onClose={jest.fn()} onSuccess={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("Collectr CSV content"), { target: { value: "a,b" } });
  fireEvent.click(screen.getByRole("button", { name: "Process CSV" }));
  return screen.findByRole("combobox", { name: "Collectr portfolio" });
}

it("opens on the Sealed Product portfolio, shows the variant and blocks a row without a cost", async () => {
  const picker = await openPreview();
  expect(picker).toHaveValue("Sealed Product");
  const boxes = screen.getAllByRole("checkbox");
  expect(boxes).toHaveLength(2);
  expect(boxes[0]).toBeChecked();
  expect(boxes[1]).toBeDisabled();
  expect(boxes[1]).not.toBeChecked();
  expect(screen.getByText(/Elite Trainer Box · Pokemon Center/)).toBeInTheDocument();
  expect(screen.getByText(/Needs cost/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Import 1 Items" })).toBeEnabled();
});

it("All portfolios shows the renamed portfolio and preselects its importable rows", async () => {
  const picker = await openPreview();
  fireEvent.change(picker, { target: { value: "" } });
  const boxes = screen.getAllByRole("checkbox");
  expect(boxes).toHaveLength(3);
  expect(boxes.filter((box) => (box as HTMLInputElement).checked)).toHaveLength(2);
  expect(within(picker).getByRole("option", { name: "Main" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Import 2 Items" })).toBeEnabled();
});
```

If WP15 or a later edit changed the "Import N Items" button text, use the current text.

### 13. `frontend/app/__tests__/errorRetry.test.tsx` (new; N03)

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import ErrorPage from "../error";
import GlobalError from "../global-error";

const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));

beforeEach(() => mockRefresh.mockReset());

it("Try again refetches the server data, then resets the boundary", () => {
  const reset = jest.fn();
  render(<ErrorPage error={new Error("boom")} reset={reset} />);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(reset).toHaveBeenCalledTimes(1);
  expect(mockRefresh.mock.invocationCallOrder[0]).toBeLessThan(reset.mock.invocationCallOrder[0]);
});

it("the global boundary does the same", () => {
  // global-error renders its own <html> and <body>; inside the test container
  // React warns about the nesting. That warning is expected here.
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  const reset = jest.fn();
  render(<GlobalError error={new Error("boom")} reset={reset} />);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(reset).toHaveBeenCalledTimes(1);
  consoleError.mockRestore();
});
```

### 14. `frontend/app/lib/__tests__/currency.stale.test.ts` (new; N05)

```ts
import { businessDaysBetween, isExchangeRateStale } from "../currency";

it.each([
  ["2026-09-25", "2026-09-29", 2], // Fri -> Tue
  ["2026-09-25", "2026-09-27", 0], // Fri -> Sun
  ["2026-09-25", "2026-10-01", 4], // Fri -> Thu
  ["2026-09-25", "2026-10-02", 5], // Fri -> next Fri
  ["2026-09-30", "2026-09-30", 0],
  ["2026-09-30", "2026-09-29", 0],
])("businessDaysBetween(%s, %s) is %i", (from, to, expected) => {
  expect(businessDaysBetween(from, to)).toBe(expected);
});

it("a rate is stale past 4 business days; the fallback and junk are not", () => {
  const now = new Date("2026-10-01T12:00:00Z"); // Thursday
  expect(isExchangeRateStale("2026-09-25T00:00:00", now)).toBe(false); // 4 business days
  expect(isExchangeRateStale("2026-09-24T00:00:00", now)).toBe(true); // 5
  expect(isExchangeRateStale("2026-09-30 00:00:00", now)).toBe(false);
  expect(isExchangeRateStale(null, now)).toBe(false);
  expect(isExchangeRateStale("garbage", now)).toBe(false);
});
```

The same day pairs are pinned in `tests/test_wp38_pipeline.py` for `main.business_days_between`, so the scraper and the site agree.

### 15. Existing tests to update

- `frontend/app/lib/__tests__/serverMarketData.freshness.test.ts`: in `mockSupabase`, after its `fromMock.mockImplementation(...)` call, add:

```ts
  // WP38: the tolerance-window read is get_latest_prices now. It returns each
  // product's newest row whatever its age; serverMarketData drops rows older
  // than the window, exactly as the paged read's gte bound did.
  rpcMock.mockImplementation(async (name: string) => {
    if (name !== "get_latest_prices") return { data: null, error: { message: "boom" } };
    const newest = new Map<number, HistoryRow>();
    for (const row of [...recentWindow, ...longWindow]) {
      const current = newest.get(row.product_id);
      if (!current || row.recorded_at > current.recorded_at) newest.set(row.product_id, row);
    }
    return {
      data: [...newest.values()].map((row) => ({
        product_id: row.product_id,
        price_recorded_at: row.recorded_at,
        recorded_usd_price: row.usd_price,
        usd_price: null,
      })),
      error: null,
    };
  });
```

  The three existing expectations stay. In WP05's `fetchNewestPricedAtForProducts` error case, replace the `fromMock.mockImplementation(...)` that returns a `57014` error with `rpcMock.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "timeout" } });`; its assertions stay.
- `frontend/app/lib/__tests__/serverMarketData.fallbackOrder.test.ts` (WP11): in both cases replace `rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });` with an implementation that fails the summaries and answers `get_latest_prices`: in the first case `rpcMock.mockImplementation(async (name: string) => name === "get_latest_prices" ? { data: [], error: null } : { data: null, error: { message: "boom" } });`, in the second case the same with `data: [{ product_id: 42, price_recorded_at: recordedDaysAgo(1), recorded_usd_price: 110, usd_price: 110 }]`. In the first case, the bounds assertions become: `expect(bounds).toHaveLength(1);` (only the year read pages history now), `expect(orderCalls.every((c) => !c.ascending)).toBe(true);`, keep the `arrayContaining(["recorded_at", "id"])` line, delete the `toleranceBound` destructuring and assertion, and add `expect(rpcMock).toHaveBeenCalledWith("get_latest_prices", { p_product_ids: [42] });`. The second case's expectations stay.
- `frontend/app/lib/__tests__/serverMarketData.cache.test.ts` (WP11), case "set analytics falls back outside any cache callback": an empty catalog now rejects at runtime, so keep the file's default summaries. Before its `rpcMock.mockImplementation(...)` add `const defaultRpc = rpcMock.getMockImplementation();` and make the override `rpcMock.mockImplementation(async (name: string, ...rest: unknown[]) => name === "get_set_analytics" ? { data: null, error: { message: "timeout" } } : name === "get_latest_prices" ? { data: [], error: null } : defaultRpc!(name, ...rest));`. Its `toEqual([])` on the result becomes `expect(Array.isArray(result)).toBe(true)`; the `__nested` and "called with get_market_product_summaries" assertions stay.
- `frontend/app/lib/__tests__/portfolio.freshness.test.ts`: if its `jest.mock("../clientMarketData", ...)` factory lists `fetchMarketProductsClient` and `fetchNewestPricedAtClient`, add `fetchLatestPricesClient: jest.fn(),`. No assertion changes (its remaining cases do not search).
- `frontend/app/compare/__tests__/shopifyCsv.test.ts` (WP18): append

```ts
  it("lists skus that appear on more than one row (review N08)", () => {
    const csv = `${HEADER}\na,A,SKU-1,10,5\nb,B,SKU-1,12,5\nc,C,SKU-2,10,5`;
    const { products, duplicateSkus } = parseShopifyCsv(csv);
    expect(products["SKU-1"].shopifyPrice).toBe(12);
    expect(duplicateSkus).toEqual(["SKU-1"]);
  });
```

- `frontend/app/components/charts/__tests__/chartTooltips.test.tsx` (WP17): append a case rendering `PriceTooltip` with the file's price payload and `currency="CAD"`: the text "CAD at today's rate" is present; with `currency="USD"` it is absent.

## Verification

From `frontend/` unless stated. In phase A, `tsc` and `pnpm build:stub` (which type-checks) fail only on the `get_latest_prices` calls in `serverMarketData.ts` and `clientMarketData.ts`; run them again after step 4.

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit                 # phase B: clean. Phase A: only "get_latest_prices" errors, in those two files
pnpm run lint                          # 0 errors (lint is blocking since WP17)
pnpm test --ci                         # all suites pass, phase A included
pnpm test --ci app/lib/__tests__/latestPrices.test.ts app/lib/__tests__/clientMarketData.latestPrices.test.ts \
  app/lib/__tests__/portfolio.search.test.ts app/lib/__tests__/serverMarketData.emptyCatalog.test.ts \
  app/lib/__tests__/serverMarketData.freshness.test.ts app/lib/__tests__/serverMarketData.fallbackOrder.test.ts \
  app/lib/__tests__/serverMarketData.cache.test.ts app/lib/__tests__/marketPulse.test.ts \
  app/lib/__tests__/import.test.ts app/lib/__tests__/import.holdings.test.ts app/lib/__tests__/importRows.test.ts \
  app/components/Portfolio/__tests__/ImportHoldingsModal.preview.test.tsx \
  app/components/Portfolio/__tests__/PortfolioModals.a11y.test.tsx \
  app/__tests__/errorRetry.test.tsx app/lib/__tests__/currency.stale.test.ts \
  app/compare/__tests__/shopifyCsv.test.ts app/components/charts/__tests__/chartTooltips.test.tsx
TZ=America/Toronto pnpm test --ci app/lib/__tests__/marketPulse.test.ts   # the windows use local dates; must pass west of UTC too
pnpm build:stub                        # phase B: exits 0 against the EMPTY stub (decision 4)

grep -n "fetchMarketProductsClient\|get_market_product_summaries" app/lib/portfolio.ts   # no output
grep -n "FRESHNESS_PAGE_SIZE\|FRESHNESS_MAX_PAGES" app/lib/clientMarketData.ts             # no output
grep -n '"Sealed Product"' app/lib/import.ts                                               # no output
grep -n "router.refresh()" app/error.tsx app/global-error.tsx                              # 2 lines
```

Repo root, inside the virtualenv:

```bash
python -m pytest tests/ -q                                         # whole suite, including the three new files
python -m pytest tests/test_wp38_pipeline.py tests/test_wp38_migrations_static.py \
  tests/test_wp10_market_rpc_bounds.py -v                           # 24 + 7 passed, WP10's file unchanged and green
python -m pyflakes main.py compare_prices.py update_shopify_skus.py scraper_db.py   # no new warnings
grep -rn "bs4\|BeautifulSoup\|table_daily_1" --include=*.py .        # no output
grep -n "supabase\.table(" main.py                                  # every hit inside an else: under "if pg_db is not None" (WP21 rule)

python3 verify_migration.py migrations/NNNN_get_latest_prices.sql > /tmp/wp38_latest.sql; echo "exit=$?"
# expect exit=0 and on stderr:
# -- function get_latest_prices(p_product_ids bigint[]): body 9f9f8dc164380380fd1ef7998cdc5958, non-strict, parallel u, security invoker, sql, volatility s, config search_path=public
# -- privilege EXECUTE on public.get_latest_prices(bigint[]) for public: revoked
# -- privilege EXECUTE on public.get_latest_prices(bigint[]) for anon: granted
# -- privilege EXECUTE on public.get_latest_prices(bigint[]) for authenticated: granted
# -- privilege EXECUTE on public.get_latest_prices(bigint[]) for service_role: granted
python3 verify_migration.py migrations/NNNN_volume_windows_complete_days.sql > /tmp/wp38_volume.sql; echo "exit=$?"
# expect exit=0 and:
# -- function get_market_product_volume_metrics(): body af73805508b3afe8f24f788b151a07e0, non-strict, parallel u, security invoker, sql, volatility s, config search_path=public
python3 verify_migration.py migrations/NNNN_export_includes_box_recipe_currency.sql > /dev/null; echo "exit=$?"
# expect exit=2 ("Nothing here can be verified": the patch is a DO block; the header queries are its check)
```

A different body hash means the function text differs from this spec (a changed comment counts): diff the file against the block in step 1 or 3.

Database (if PostgreSQL 16 is available locally; CI runs the same in "Database replay and Python tests"):

```bash
scripts/db/replay_migrations.sh                                   # "OK: N files replayed once (replay_once) and twice (replay_twice)"
POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/replay_once \
  python -m pytest tests/test_wp38_db.py -v                        # 12 passed
```

Paste every command's output into the PR body.

## Owner actions

1. **Apply the three migrations to production before merge**, in registry order (Supabase SQL editor with everything selected, or MCP `apply_migration`): `NNNN_get_latest_prices.sql`, `NNNN_export_includes_box_recipe_currency.sql`, `NNNN_volume_windows_complete_days.sql`. All three are safe while the old frontend runs: the first adds a function, the second adds a key to the export, the third changes the volume windows by one day (intended). Then:
   - Run each file's header verification queries: `get_latest_prices` agrees with `get_market_product_summaries` (0 rows) and its `EXPLAIN ANALYZE` is well under 100 ms; the export check returns `true`, `v | t`, `false`; no product has `units_sold_7d > units_sold_30d` (0).
   - Prove the applied objects are the files' (the repo's rule since 2026-08-13): `python3 verify_migration.py migrations/NNNN_get_latest_prices.sql` and `... NNNN_volume_windows_complete_days.sql`, paste each printed statement into the SQL editor with nothing selected, Run: every row `OK`.
   - Record the dates in `audits/HARDENING_FOLLOWUPS.md` (step 19 bullet) and refresh `schema.sql` as WP21 describes.
2. **Database types (phase B)**: run `pnpm types:db` with your `SUPABASE_ACCESS_TOKEN` and push `frontend/app/types/database.ts` to the branch, or give the executor a token. WP20's "Database types" workflow fails on master until production and the file agree.
3. **After deploy**:
   - On `/portfolio`, open "Add holding" with DevTools (Network, filter `supabase.co`), type a search: one `rpc/get_latest_prices` request per search, no `rpc/get_market_product_summaries`.
   - After the next scraper run, the scraper log shows either "Exchange rate stored." or "Exchange rate for <date> is already stored; nothing to write.", and no `exchange_rate_stale`. Pull the new `main.py` and `scraper_db.py` on the scraper machine and `pip install -r requirements.txt` (beautifulsoup4 is no longer needed).
   - `SELECT recorded_at::date AS day, count(*) FROM public.exchange_rates WHERE recorded_at >= current_date - 7 GROUP BY 1 ORDER BY 1;` shows at most one new row per Bank of Canada date from the deploy on (older days keep their duplicates; WP25's `fx_daily` already handles them).
   - Re-import a Collectr export that has a Pokemon Center or other variant product: the preview shows the variant on the matched line, rows without a cost say "Needs cost" and cannot be ticked, and a portfolio picker appears when the file holds more than one Collectr portfolio.
4. **`export_my_data` after WP34 and WP35**: WP34's 0038 and WP35's 0039 replace the function in full from a body without `currency`. Unless the plan maintainer applied the handoff (their bodies gain `'currency', currency,`), re-run `migrations/NNNN_export_includes_box_recipe_currency.sql` in production right after applying 0038, and again after 0039 (it is idempotent), then check `SELECT position('''currency'', currency' IN pg_get_functiondef('public.export_my_data()'::regprocedure)) > 0;` returns `true`. A replayed database is always right, because this file sorts after both.
5. **Seller tools**: the next `compare_prices.py` report lists stale products under "no market price" with their last price date, and the export CSV has a "Price Date" column. If `update_shopify_skus.py --apply` was ever used before this package, the shop may hold variants that share their parent's SKU; the script no longer creates them but does not repair them. Fix those in Shopify (give each variant its own SKU), or `/compare` and `compare_prices.py` keep warning about duplicate SKUs.
6. **F045 item 4** (decision): WP30 replaces `ProductCard`'s props. Decide whether WP30 should take a single memoised `cardSettings` prop (the verifier's lower-risk option); until then F045 stays partially open in the tracker.
7. **F095 contrast check** (decision): no package adds one. Recommended: WP22 adds Lighthouse's accessibility category to `lighthouserc.json` with `"color-contrast": "error"` for its four URLs. Record the decision in the tracker.
8. **Plan maintenance** (before WP22, WP25, WP27, WP34 and WP35 run): apply the four "Handoffs to later specs" listed at the top of this spec to those specs.

## Acceptance criteria

- [ ] Three migrations exist under the registry's numbers, each idempotent; `verify_migration.py` prints the hashes above; `tests/test_wp38_migrations_static.py` and WP10's `tests/test_wp10_market_rpc_bounds.py` pass; the replay builds and `tests/test_wp38_db.py` passes (12).
- [ ] `get_latest_prices` returns 0023's verdict (gate text pinned), filters `active` only without ids, is SECURITY INVOKER, and anon may call it.
- [ ] `fetchNewestPricedAt` (server) and `fetchNewestPricedAtClient` no longer page `product_price_history`; `fetchNewestPricedAtForProducts` is unchanged and still fails closed.
- [ ] Portfolio search, set search and the import catalog are priced by one `get_latest_prices` call per 500 results; `portfolio.ts` no longer calls `get_market_product_summaries`.
- [ ] `export_my_data()` exports `box_recipes.currency`; VOLATILE, SECURITY DEFINER and the ACL are unchanged; the migration never contains `FUNCTION public.export_my_data`.
- [ ] An empty catalog or set board throws at runtime and is accepted during `next build`; `pnpm build:stub` exits 0.
- [ ] Flat demand reads flat: 7d 70 / 30d 300 / prior 300 / trend 0% for a 0 to 3 day collection lag, in SQL (DB test) and in `marketPulse.ts` (Tests 8); the 3-day freshness gate is unchanged.
- [ ] The Collectr matcher decides on variant before set name, returns "low" when candidates remain, never matches a variantless row to a variant product when a standard one exists; a blank cost is never imported as 0 (a typed 0 still is); every Collectr portfolio is kept and the preview offers a picker; invalid dates are rejected; the preview shows the matched variant.
- [ ] "Try again" calls `router.refresh()` and `reset()` in one transition in both error boundaries.
- [ ] The scraper reads the Valet API, stores one row per observation date, logs `exchange_rate_stale` past 4 business days and never raises; the site logs `exchange_rate_stale` once per cache fill; `isExchangeRateStale` is exported from `app/lib/currency.ts`; the CAD chart tooltip says "CAD at today's rate"; beautifulsoup4 is gone from `requirements.txt`.
- [ ] `compare_prices.py` compares only active products at the gated price and prints the price date; `update_shopify_skus.py` rejects a language mismatch, penalises a variant mismatch and leaves variant rows' SKUs as exported; duplicate SKUs are reported by `compare_prices.py`'s API loader and on `/compare`.
- [ ] `pnpm exec tsc --noEmit`, `pnpm run lint`, `pnpm test --ci`, `pnpm build:stub` and `python -m pytest tests/ -q` pass (phase B).

## Rollback

- Code: revert the PR. Every frontend change is self-contained; the reverted code pages history again and works whether or not the migrations stay.
- `get_latest_prices`: additive and unused after a revert. Leave it, or `DROP FUNCTION IF EXISTS public.get_latest_prices(bigint[]);` and add that statement as a migration (next free number) so the replay matches, then `pnpm types:db`.
- Volume windows: re-run `migrations/0027_bounded_volume_metrics.sql` in production (it is `CREATE OR REPLACE` with the same shape) and add a migration that does the same, so the replay matches.
- Export key: harmless to keep. To remove it, re-run `migrations/0024_export_my_data_volatile.sql` (it drops any key added after it, WP34's and WP35's included; re-run their files afterwards).
- Scraper: revert `main.py`, `scraper_db.py` and `requirements.txt` together (the old parser needs beautifulsoup4).

## Commit and PR

Branch `remediation/wp38-residual-data-layer-followups`. Suggested commits:

1. `feat(db): get_latest_prices, export currency, volume windows on complete days (WP38)`: the three migrations, `tests/test_wp38_db.py`, `tests/test_wp38_migrations_static.py`.
2. `perf(data): newest-price reads and portfolio search through get_latest_prices (WP38: F146, F143)`: `latestPrices.ts`, `serverMarketData.ts`, `clientMarketData.ts`, `portfolio.ts`, their tests.
3. `fix(market): volume windows end on the last complete day (WP38: N02)`: `marketPulse.ts` and its test.
4. `fix(import): Collectr variant matching, missing cost, portfolio picker (WP38: N01)`: `importRows.ts`, `import.ts`, `ImportHoldingsModal.tsx`, tests.
5. `fix: empty catalog never cached, error retry refetches, FX freshness (WP38: F064, N03, N05)`: `serverMarketData.ts` (6c, 6d), `error.tsx`, `global-error.tsx`, `currency.ts`, `exchangeRate.ts`, `PriceChart.tsx`, `main.py`, `scraper_db.py`, `requirements.txt`, tests.
6. `fix(tools): seller tools use the site's prices and keep variant SKUs (WP38: N08)`: `compare_prices.py`, `update_shopify_skus.py`, `shopifyCsv.ts`, `CompareDashboard.tsx`, tests, docs.
7. Phase B: `chore(types): regenerate database types for get_latest_prices (WP38)`.

PR title: `fix: residual data-layer follow-ups (WP38: F146, F143, F064, N01, N02, N03, N05, N08)`

PR body: link this spec; the finding list with "full" or "residual" as in the metadata; what was not done and why (F045 item 4 left to WP30, F095 contrast check recommended for WP22, the F146 anchor RPC declined); the two plan corrections (export patched in place instead of redefined; the empty catalog accepted during the build); the deliberate output change (volume windows move by one day, with the measured before and after for flat demand); the migration numbers used; Owner actions verbatim, with item 1 in bold as "apply before merge"; the four handoffs for WP22, WP25, WP27 and WP34/WP35; the Verification output.
