# WP26: Server-baked sparklines and public read routes

- **Goal**: on the home page, `/prices` and `/market`, every product's sparkline is in the first paint (drawn from the server HTML, no pop-in, no fake line), scrolling the whole catalog makes zero history requests, the "Period" control changes the sparkline window with at most one CDN-cached request, and none of these three routes can load the Supabase client library.
- **Why now / value**: after WP09 and WP12 the three most visited routes still load the 66 kB gz supabase-js chunk right after hydration and make 15 to 30 batched history requests per full `/prices` scroll, only to draw 96x40 px lines (research/performance-excellence.md §1 item 1, §7.1). WP30, WP32, WP33 and WP37 all render sparklines on new surfaces; if this lands first they inherit the cheap path instead of copying the client-fetch one.
- **Effort**: L, 14 to 16 hours (migration and DB tests 2.5 h, server cache and three routes 2 h, client data layer and components 4 h, `/market` and home wiring 1.5 h, perf gate, fixture and cache check 2.5 h, scraper warm 0.5 h, tests and verification 2 h). Plus about 1 hour of owner time.
- **Depends on**: WP09 (SVG `MiniSparkline`, `historyLoadingStore`, the history batcher this package deletes), WP10 (migrations 0027 to 0029 exist, so 0035 replays after them), WP11 (`cacheTags.ts`, `DAILY_BACKSTOP_SECONDS`, `getCachedProductDetailRows`, `getCachedExchangeRateSnapshot`, ISR pages, `revalidate_hook.py`), WP12 (`supabaseLoader.ts` and its ESLint guard, extended here), WP19 (`MarketView/columns.tsx`, `MarketTableRow.tsx`, `MarketCellContext`), WP21 (replay harness and CI job "Database replay and Python tests", `pokefin_scraper` role, schema baseline), WP22 (perf fixture, `perf-measure.mjs`, `perf-budget.mjs`, `perf-budgets.json`, `lighthouserc.json`, the CI perf steps), WP23 (`Skeleton`, the "No history" sparkline state, `SegmentedControl`, the `--pf-chart-line` token and its `stroke-chart-line` utility). Also reads WP08 (`PRICES_URL_DEFAULTS`, `cardList`), WP20 (`app/types/market.ts`, `CurrencyProvider`, `pnpm types:db`, `import "client-only"`).
- **Unblocks**: WP30 (list rows use `MiniSparkline size="row"` and `sparklineFor`), WP32 (home movers and header read `getCachedSparklines`), WP33 (screener rows), WP37 (set pages). WP27's planned `/api/public/catalog` follows the route pattern and the `proxy.ts` matcher exclusion added here.
- **Placement**: after WP22 (the budget gate proves the gain) and WP23 (Skeleton and the "No history" state). It can run in parallel with WP25. It reserves migration **0035** and keeps that number even if it merges before 0033 and 0034. It must land before WP30, WP32, WP33 and WP37.
- **Suggested branch name**: `remediation/wp26-server-baked-sparklines`
- **Risk level**: medium. It replaces the data path of every sparkline and every on-demand chart on the three busiest routes and changes the `proxy.ts` matcher; mistakes show as blank or wrong lines, so the encoding is pinned by the same anchor strings in SQL, TypeScript and Python tests, and the migration is additive and read-only.

## Why

Today a collector opening `/prices` on a phone sees grey placeholder lines that turn into real ones only after the page has hydrated, downloaded the Supabase client (66 kB gz, about 250 kB to parse) and fetched a year of daily rows for each visible card; a full scroll costs 15 to 30 more history requests, and the "CHART" control silently changes which returns cards show while the sparkline stays at 365 days (research/ui-audit.md `/prices`: "The CHART timeframe control (7D to 1Y) changes which return rows cards show ... but the sparkline is always 365 days", and improvement 3: "Rename CHART to Period and make it drive the sparkline window"). The research sizes the fix: one SQL function returns a 32-point, 6-bit series per product, about 10 kB br for the whole catalog, embedded in the page for the default period and served from the CDN for the others (research/performance-excellence.md §7.1), which removes every scroll-time request, lets the browser drop supabase-js on these routes (§7.2), and takes an estimated 50 to 150 ms off the worst early interaction on a mid phone. Full charts ("Show full chart", `/market` row expansion) move to a compact ISR route that shares the product page's cached rows, and the scraper hook warms the regenerated pages after each run so the first visitor after a scrape is not the one who pays the render (§7.5). Stale prices keep their promise: a product withheld by migration 0023 gets no line, only "No history", in the HTML, the payload and the route (01-PRODUCT-DIRECTION.md §2 principle 1, §3.4, §6.1).

## Design

### D1. What changes on screen

The card layout is unchanged; only the sparkline slot, the "Show full chart" area and one control label change. Nothing on the page moves when data arrives: the sparkline box stays 96x40 and the "Show full chart" button is always present.

`/prices` at 1440 px, grouped view (default), first paint from the server HTML:

```
+---------------------------------------------------------------------------------------------+
| GENERATION [All generations v]  PRODUCT TYPE [All types v]  [ (o) Search by name or variant ] |
| PERIOD [ 7D | 1M |#3M#| 6M | 1Y ]                    CURRENCY [ USD |#CAD#]  1 USD = 1.3612 CAD |
+---------------------------------------------------------------------------------------------+
SWSH07 Evolving Skies . Aug 2021
+----------------------------+ +----------------------------+ +----------------------------+
| [img] Booster Box          | | [img] Elite Trainer Box    | | [img] Booster Bundle       |
|       C$612.40   /\/\__/\  | |       C$81.30     ______/  | |       --      No history   |
|       1M +4.2%   96x40 line| |       1M -1.1%             | |       Last priced Sep 2    |
|       [Show full chart]    | |       [Show full chart]    | |       [Show full chart]    |
+----------------------------+ +----------------------------+ +----------------------------+
```

`/prices` at 390 px (one column, same card anatomy, same 96x40 slot):

```
+------------------------------------+
| Filters (0)                     v  |
+------------------------------------+
| [img] Booster Box                  |
|       Evolving Skies               |
|       C$612.40         /\/\__/\    |
|       1M +4.2%                     |
|       [ Show full chart ]          |
+------------------------------------+
| [img] Booster Bundle               |
|       --               No history  |
|       Last priced Sep 2            |
|       [ Show full chart ]          |
+------------------------------------+
```

The filter drawer shows `PERIOD` where it showed `CHART`; the segments, their 44 px touch height and their behaviour are WP23's `SegmentedControl`, unchanged.

Card sparkline slot, all states (96x40 on cards, 64x24 in the `size="row"` variant WP30 and WP33 use):

```
first paint, series present    period switched, loading     withheld or < 2 points
+------------------+           +------------------+         +------------------+
|        /\  /\/   |           |                  |         |                  |
|   /\/\/  \/      |           | ================ |         |    No history    |
| /                |           |    flat bar      |         |                  |
+------------------+           +------------------+         +------------------+
```

"Show full chart" area after a click (the button toggles to "Hide chart"):

```
loading                         loaded (>= 2 days)             failed                         loaded, < 2 days
+--------------------------+    +--------------------------+   +--------------------------+   +--------------------+
| [flat bar, 150 / 200 px] |    |  Recharts chart (lazy),  |   | Chart unavailable.       |   | No history         |
| sr-only "Loading chart"  |    |  range = selected Period |   | [Try again]              |   +--------------------+
+--------------------------+    +--------------------------+   +--------------------------+
```

`/market` at 1440 px with "all columns" on: the sparkline column is renamed "Trend" (it was "Last 7D", which was never true) and shows the Period's baked line for every row without expanding it:

```
#  PRODUCT                 SET              PRICE     1D     7D    ...  UNITS 30D  VOL TREND  TREND        CHART
1  Booster Box             Evolving Skies   C$612.40  +0.4%  +1.9% ...  212        +12.0%     /\/\__/\     [Show]
2  Elite Trainer Box       Silver Tempest   C$81.30   ...                                      No history   [Show]
```

`/market` at 390 px is unchanged by this package (the table scrolls horizontally until WP33 replaces it with `DataList` rows). The home page "Recently Released" strip renders the same card, with the 3M line in the first paint.

Interactions:

- **Period** (`/prices`, `/market`): selects the sparkline window (7D, 1M, 3M, 6M, 1Y) and the range any chart opened afterwards starts at. The page's default period (3M on `/prices`, 1Y on `/market`) is embedded in the HTML; choosing another one makes one request to `/api/public/sparklines/<period>` (CDN-cached, about 10 kB br), shows flat bars in every slot until it resolves, then draws. A period fetched once is kept for the tab (1 hour). On `/prices` the Period still also picks which return lines a card shows (existing behaviour); WP30 reduces that to the single return of the period.
- **Show full chart** / `/market` **Show**: one request to `/api/public/history/<id>` the first time, served from memory afterwards. Hiding and reopening makes no request. A failure shows "Chart unavailable." with a "Try again" button on cards; on `/market` closing and reopening the row retries.
- Scrolling makes no request of any kind for sparklines.

Copy (every new or changed user-facing string): "Period", "Trend", "Price over the selected period, scaled to its own low and high" (the `title` of the Trend header), "No history" (WP23's), "Loading chart" (screen-reader only), "Chart unavailable.", "Try again", "Show full chart", "Hide chart". No "live", "real-time" or "all-time".

Accessibility:

- The sparkline SVG stays `aria-hidden="true" focusable="false"`: the price and return text next to it carry the information. "No history" is visible text, read in order.
- The Period control keeps WP23's radio-group semantics; its accessible name becomes the visible label "Period" (the `ariaLabel="Chart timeframe"` override is removed so the name matches the label, WCAG 2.5.3).
- The chart loading placeholder is a `role="status"` region with the sr-only text "Loading chart"; the failure line is plain text with a real `<button>`.
- The line does not encode direction by colour: one `--pf-chart-line` stroke for every product (01-PRODUCT-DIRECTION.md §3.4: "The price line does not change colour with direction; the change chip carries gain or loss colour"). WP09's green/red stroke constants are deleted.

Design system use: `Skeleton` (flat bars in the slot and the chart area), WP23's "No history" state, `stroke-chart-line`, `text-ink-soft`, `text-action`, `text-small`. No new component in `app/components/ui/`.

### D2. The encoded series (data definition)

Computed by `public.get_catalog_sparklines(p_days, p_points)` (migration 0035). Dates are UTC calendar days, as everywhere else in the schema (`recorded_at` is `timestamp without time zone` holding UTC).

| Period | `p_days` | `p_points` | Point spacing |
|---|---:|---:|---|
| 7D | 7 | 7 | one per day |
| 1M | 30 | 30 | one per day |
| 3M | 90 | 32 | 2.8 days |
| 6M | 180 | 32 | 5.6 days |
| 1Y | 365 | 32 | 11.4 days |

For one active product, with `T = current_date` and `D0 = T - (p_days - 1)`:

1. **Gate (migration 0023, unchanged)**: the newest `product_price_history` row must have `recorded_at >= current_date - 14` and `products.usd_price IS NOT DISTINCT FROM` its `usd_price`. Otherwise `series`, `first_day` are NULL.
2. **Buckets**: a row recorded on day `d` in `[D0, T]` falls in bucket `b(d) = floor((d - D0) * p_points / p_days) + 1` (`width_bucket` on `numeric`, so exact). `v_b` is the price of the newest row in bucket `b`.
3. **Seed**: `v_0` is the price of the newest row before `D0`, when there is one.
4. **Carry forward**: `c_b = v_b` when bucket `b` has a row, else `c_(b-1)`. The series covers buckets `b0 .. p_points`, where `b0` is the first bucket `>= 1` whose `c_b` exists (1 when a seed exists).
5. **Scale**: `lo = min(c)`, `hi = max(c)` over the covered buckets. `level_b = 32` when `hi = lo`, else `round((c_b - lo) * 63 / (hi - lo))` in exact `numeric`, halves rounded up.
6. **Encode**: `series = ALPHABET[level_b0] ... ALPHABET[level_p_points]` with `ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"` (base64url order: "A" is the low, "_" the high).
7. **Minimum**: fewer than 2 covered buckets gives `series = NULL`.
8. `first_day = D0 + ceil((b0 - 1) * p_days / p_points)` (the first day of bucket `b0`); `last_day = newest recorded day` (kept for withheld products too, like `price_recorded_at` in 0023).

Edge cases and what they produce:

| Case | Result |
|---|---|
| Stale price (newest row older than 14 days) or `products.usd_price` disagrees with it | `series` NULL, `last_day` still set, card says "No history" |
| Product listed inside the window, no earlier price | shorter series starting at its first bucket, drawn across the full slot (x clamped to the data, 01-PRODUCT-DIRECTION.md §3.4) |
| Missing days inside the window (the scraper skips a day) | carried forward: flat segment, never a gap or a drop to zero |
| No row inside the window but a fresh seed (7D window, last price 10 days ago) | a flat line at the seed price, the price the card shows |
| Every covered price equal | every level 32, all "g": a flat mid line |
| Only one observation | NULL, "No history" |
| Rows dated in the future (clock skew) | excluded (`recorded_at < current_date + 1`) |
| Inactive product | no row at all |
| `p_days` outside 2..400, `p_points` outside 2..64, or `p_points > p_days` | no rows at all (the function is callable by anon) |

Scale invariance: the levels do not change when every price is multiplied by an exchange rate, so the series has no currency input and a USD/CAD switch does zero sparkline work (WP09's pitfall, research §16).

Drawing (`app/lib/sparkline.ts`): point `i` sits at `x = 2i`, `y = 63 - level_i`; the SVG `viewBox` is `0 -2 (2(n-1)) 67` (2 units of margin so the stroke is not clipped), `preserveAspectRatio="none"`, and the path is `M0 (63-level_0)` followed by relative steps `l2 dy` (`dy = level_(i-1) - level_i`). A relative path is the shortest text form: about 110 characters per product.

Anchor strings shared by the SQL, TypeScript and Python tests:

| Input | Series |
|---|---|
| 7 daily prices 1, 2, ..., 7 at `(7, 7)` | `ALVgq1_` (10.5, 31.5, 52.5 round up) |
| 90 daily prices 100 + k (k = 0..89 ending today) at `(90, 32)`; bucket values 102, 105, ..., 189 | `ACEHJKMORTUWZbdehjlnprtvxz1357-_` |
| Values 1..32 | `ACEGIKMOQSUWYacehjlnprtvxz13579_` |
| 10, 8, 6, 4, 2, 4, 6, 8, 10 | `_vgQAQgv_` |

### D3. Delivery

```text
scraper run -> POST /api/revalidate (tags stale) -> revalidate_hook.py GETs /, /prices, /market,
                                                    /api/public/sparklines/{7D,1M,3M,6M,1Y}  (warm, WP26)

get_catalog_sparklines(days, points)   <- once per period per scrape, never per visitor
        |
serverMarketData.getCachedSparklines(period)      unstable_cache, tag "market-products", 1 day backstop
        |                                  \
  /, /prices, /market (ISR HTML)            /api/public/sparklines/[period]  (ISR route, CDN)
  default period embedded as a prop               ^ other periods, one request each
        |                                         |
  ProductCard / MarketTableRow  --MiniSparkline(series)-->  SVG path in the server HTML

"Show full chart" / row expand  ->  /api/public/history/[id]  (ISR route, CDN, shares the
                                    product page's cached rows: getCachedProductDetailRows)
CurrencyProvider fallback rate  ->  /api/public/rate  (dynamic, s-maxage=3600)
```

Route contracts:

| Route | Caching | 200 body | Other answers |
|---|---|---|---|
| `GET /api/public/sparklines/[period]` | `dynamic = "force-static"`, `revalidate = 86400`, `generateStaticParams` returns `[]`, data under tag `market-products` | `{ period, days, points, asOf, series: { "<product id>": "<series>" } }`, products without a line absent | 404 for a period outside 7D, 1M, 3M, 6M, 1Y; 500 (never cached) when the RPC fails |
| `GET /api/public/history/[id]` | same segment config, data from `getCachedProductDetailRows` (tag `market-products`) | `{ d: ["YYYY-MM-DD", ...], p: [usd, ...] }`, oldest first, one entry per UTC day, 367 days | 404 for a malformed id or a product not in the catalog; 500 on a read failure |
| `GET /api/public/rate` | `dynamic = "force-dynamic"`, `Cache-Control: public, max-age=0, s-maxage=3600, stale-while-revalidate=86400` | `{ rate, date }` | 503 `no-store` when the rate cannot be read |

Every 200 from the two ISR routes carries `x-pokefin-generated-at: <ISO time of the render>`, so a check can prove two responses came from one cached render even where no cache header exists. `/api/public/*` is excluded from `proxy.ts`: no rate limiting, no Supabase auth call, no cookies, so a CDN hit never runs a function.

### D4. Expected effect on the budgets (to be measured, step 26)

| Budget | Expected change | Why |
|---|---|---|
| `/prices` document (br) | +13 to +18 kB | about 7 kB br of series in the inline flight plus about 8 to 10 kB br of SVG path data in the HTML, measured on a 306-product synthetic walk while writing this spec (random walks compress worst; real sealed prices, with many flat days, compress better) |
| `/prices` inline flight (br) | +6 to +7 kB | the series map |
| `/` document (br) | +1 kB | only the Recently Released products' series are embedded |
| `/market` document (br) | +6 to +7 kB | series map in the flight; the Trend column is hidden by default, so no SVG in the HTML |
| JS on `/`, `/prices`, `/market` (gz) | about 0 | the WP09 batcher and observers go, the decoder and hook arrive |
| Lighthouse `resource-summary:script:size` on those routes | about -66 kB gz | supabase-js no longer loads after hydration |
| History requests per full `/prices` scroll | 15 to 30 -> 0 | |

The `/prices` document target stays 70 kB br. The package's limit raises are declared in the PR body (WP22 rule D11.2); step 26 says what to do if a measurement lands above a target.

### D5. Browser Supabase reads after this package

Moved: sparkline history (baked), full-chart history (`/api/public/history`), the catalog client fallback in `useProductData` (deleted: the pages always pass server data), the volume client fallback in `useVolumeMetrics` (deleted, as research §7.2 recommends; a failed volume read shows no volume chip until the next ISR regeneration), the CurrencyProvider fallback rate (`/api/public/rate`).

Remaining, listed as follow-ups in the PR (out of scope, none on `/`, `/prices` or `/market`): `app/lib/portfolio.ts` (product search, `getAllProducts`, the browser price-history fallback), `app/components/BoxCalculator/sharedRecipe.ts` (`get_shared_recipe`), and `fetchMarketProductsClient` / `fetchNewestPricedAtClient` behind `/compare`, `/box-calculator` and `/portfolio`. Because reads remain, CSP `connect-src` keeps `https://*.supabase.co` (the task's rule: drop it only when no browser read remains anywhere). `img-src` keeps it too: product images are still served from Supabase Storage.

## Before you start

Read these files in full, in their current state (earlier packages moved lines; find every edit by the quoted code, never by a line number):

- `audits/remediation/01-PRODUCT-DIRECTION.md` §3.4, §6.1, §6.2; `audits/remediation/research/performance-excellence.md` §1, §7.1 to §7.5, §13.3, §16; `audits/remediation/research/ui-audit.md` sections `/` and `/prices`.
- `migrations/0023_price_freshness_guard.sql` (the `latest_price` CTE and the `current_date - 14` gate you mirror), `migrations/0003_integrity_constraints.sql` (one history row per product per UTC day), and WP21's `scripts/db/replay_migrations.sh` and `tests/test_db_roles_integration.py` (the fixture pattern the DB test copies).
- `frontend/app/lib/serverMarketData.ts` (WP11's cached exports block, `DAILY_BACKSTOP_SECONDS`, `getCachedProductDetailRows`, `getCachedExchangeRateSnapshot`, `createMarketDataSupabaseClient`), `frontend/app/lib/cacheTags.ts`, `frontend/app/lib/clientMarketData.ts`, `frontend/app/lib/exchangeRate.ts`, `frontend/app/lib/supabaseLoader.ts`, `frontend/app/lib/format.ts` (`recordedAtDateKey`), `frontend/app/types/market.ts`.
- `frontend/app/components/MarketView/MiniSparkline.tsx`, `frontend/app/components/ProductPrices/cards/ProductCard.tsx`, `frontend/app/components/ProductPrices/hooks/useProductData.ts`, `historyLoadingStore.ts`, `useVolumeMetrics.ts`, `frontend/app/components/ProductPrices/index.tsx`, `controls/ChartTimeframeButtons.tsx`, `utils/urlState.ts`, `frontend/app/components/dashboard/RecentlyReleased.tsx`, `frontend/app/components/MarketView/MarketView.tsx`, `columns.tsx`, `MarketTableRow.tsx`, `frontend/app/context/CurrencyContext.tsx`, `frontend/app/page.tsx`, `frontend/app/prices/page.tsx`, `frontend/app/market/page.tsx`, `frontend/proxy.ts`, `frontend/eslint.config.mjs`, `frontend/next.config.ts` (CSP).
- WP22's `frontend/scripts/fixtures/perf.mjs`, `perf-measure.mjs`, `perf-budget.mjs`, `perf-serve.mjs`, `perf-config.mjs`, `frontend/perf-budgets.json`, `frontend/lighthouserc.json`, and the frontend job in `.github/workflows/ci.yml`.
- `revalidate_hook.py` and `tests/test_revalidate_hook.py` (WP11).

Confirm the starting state (from `frontend/` unless noted). Every dependency is hard: if a check fails, stop and report which package is missing.

```bash
git checkout master && git pull && git checkout -b remediation/wp26-server-baked-sparklines
cd frontend

# WP09: SVG sparkline and the per-product loading store
grep -c "export function buildSparklinePath" app/components/MarketView/MiniSparkline.tsx     # 1
test -f app/components/ProductPrices/hooks/historyLoadingStore.ts && echo "WP09 ok"
# WP10: migrations 0027 to 0029
ls ../migrations/0027_*.sql ../migrations/0028_*.sql ../migrations/0029_*.sql                # 3 files
# WP11: tags, backstop, cached detail rows and rate snapshot, scraper hook
test -f app/lib/cacheTags.ts && test -f app/api/revalidate/route.ts && test -f ../revalidate_hook.py && echo "WP11 ok"
grep -c "DAILY_BACKSTOP_SECONDS\|getCachedProductDetailRows\|getCachedExchangeRateSnapshot" app/lib/serverMarketData.ts   # >= 6
# WP12: lazy loader and its ESLint guard
test -f app/lib/supabaseLoader.ts && grep -c "supabaseLoader" eslint.config.mjs                 # >= 1
# WP19: column descriptors and the memoised row
test -f app/components/MarketView/columns.tsx && test -f app/components/MarketView/MarketTableRow.tsx && echo "WP19 ok"
grep -n "interface MarketCellContext" app/components/MarketView/columns.tsx                     # 1 line
# WP20: domain types, currency context, generated DB types
test -f app/types/market.ts && test -f app/context/CurrencyContext.tsx && test -f app/types/database.ts && echo "WP20 ok"
grep -c '"types:db"' package.json                                                                # 1
# WP21: least-privilege migrations and the replay harness
ls ../migrations/0031_*.sql ../migrations/0032_*.sql && test -x ../scripts/db/replay_migrations.sh && echo "WP21 ok"
# WP22: perf gate
test -f perf-budgets.json && test -f scripts/fixtures/perf.mjs && test -f scripts/perf-measure.mjs && test -f lighthouserc.json && echo "WP22 ok"
# WP23: Skeleton, "No history", chart-line token
test -f app/components/ui/Skeleton.tsx && grep -c "No history" app/components/MarketView/MiniSparkline.tsx   # 1
grep -n "pf-chart-line" app/globals.css | head -3                                                # the token and its @theme colour
# Migration 0035 is free (0033 and 0034 may or may not exist: WP25 runs in parallel)
ls ../migrations | grep -c '^0035_'                                                              # 0
```

If `grep -n "pf-chart-line" app/globals.css` shows the token but no `@theme` colour that produces the `stroke-chart-line` utility (a line like `--color-chart-line: var(--pf-chart-line);`), use `stroke-[var(--pf-chart-line)]` wherever this spec writes `stroke-chart-line`.

List every call site you will touch; keep the output for the PR:

```bash
grep -rn "fetchProductHistoryClient\|fetchVolumeMetrics\|fetchLatestExchangeRateClient\|lib/exchangeRate\|ensureHistoryLoaded\|onLoadChart\|<MiniSparkline\|useVolumeMetrics\|useProductData" app --include=*.ts --include=*.tsx
grep -rln "supabaseLoader" app --include=*.ts --include=*.tsx | grep -v __tests__   # the browser reads that remain today
```

Baseline measurement (keep the files; the PR compares against them). WP22's gate needs the perf build:

```bash
SUPABASE_STUB_FIXTURE=perf pnpm build:stub
node scripts/perf-serve.mjs &            # wait for .perf/ready
pnpm perf:budget; cp .perf/budget-result.json .perf/wp26-before.json
pnpm dlx @lhci/cli@0.15.1 autorun; node scripts/perf-lhci-summary.mjs > .perf/wp26-lhci-before.md
kill %1
pnpm exec tsc --noEmit && pnpm run lint && pnpm test --ci   # all green before any edit
```

WP25 runs in parallel and also edits `serverMarketData.ts` (new cached reads), `CurrencyContext.tsx` (a new context member) and `scripts/fixtures/perf.mjs` (new routes), in different places from this package. If it merged first, rebase and keep both sides; nothing here depends on it.

Tools: PostgreSQL 16 or 17 locally (or Docker) for WP21's replay harness and the DB test; `SUPABASE_ACCESS_TOKEN` for `pnpm types:db` (if you have none, see step 2).

## Implementation steps

### Step 1. `migrations/0035_catalog_sparklines.sql` (new)

The body below was run on PostgreSQL 16 while writing this spec: applied twice in a row without error, every anchor in D2 and every case in the DB test reproduced exactly, and 1Y over 306 products with 116k history rows took about 210 ms (3M about 90 ms, 7D about 20 ms), well inside anon's 3 s statement timeout.

```sql
-- Migration 0035: server-baked catalog sparklines (WP26).
--
-- Every sparkline on /, /prices and /market used to be drawn in the browser
-- from a year of product_price_history rows fetched per card through
-- supabase-js (15 to 30 requests per full /prices scroll, plus the 66 kB gz
-- client). This function returns, for every active product, one fixed-length
-- series per period, scaled between the series' own low and high and written
-- one base64url character per point (6 bits: "A" is the low, "_" the high).
-- The site calls it once per period per scrape through a tagged cache
-- (frontend/app/lib/serverMarketData.ts, getCachedSparklines), never per
-- visitor. Definition and edge cases: audits/remediation/WP26-server-baked-sparklines.md, D2.
--
-- The migration 0023 gate is repeated here: a product whose newest history
-- row is older than 14 days (PRICE_STALENESS_TOLERANCE_DAYS in
-- frontend/app/lib/marketPulse.ts), or whose products.usd_price disagrees
-- with that row, gets series NULL, matching the withheld price on its card.
-- A product with fewer than two points also gets NULL. last_day is returned
-- for every product, like price_recorded_at in 0023.
--
-- Scale-invariant on purpose (no currency input): multiplying every price by
-- an exchange rate changes no level.
--
-- SECURITY INVOKER: callers read products and product_price_history through
-- their own SELECT policies (0001). EXECUTE goes to anon and authenticated
-- only; PUBLIC is revoked so pokefin_scraper (WP21) cannot call it.
-- Out-of-range arguments return no rows, which bounds what an anonymous
-- caller can ask for. Idempotent: CREATE OR REPLACE keeps the signature and
-- return type, and REVOKE/GRANT are repeatable (replay_twice, WP21).
--
-- Verification (Supabase SQL editor):
--   -- A withheld price never gets a line (expect 0 rows):
--   SELECT s.product_id
--     FROM public.get_catalog_sparklines(90, 32) s
--     JOIN public.get_market_product_summaries() m ON m.id = s.product_id
--    WHERE s.series IS NOT NULL AND m.usd_price IS NULL;
--
--   -- Every series is 2 to 32 base64url characters (expect 0 rows):
--   SELECT product_id, series
--     FROM public.get_catalog_sparklines(365, 32)
--    WHERE series IS NOT NULL
--      AND (length(series) NOT BETWEEN 2 AND 32 OR series !~ '^[A-Za-z0-9_-]+$');
--
--   -- Coverage (expect about 300 drawn, the rest withheld or new):
--   SELECT count(*) FILTER (WHERE series IS NOT NULL) AS drawn, count(*) AS products
--     FROM public.get_catalog_sparklines(90, 32);
--
--   -- Cost of the widest period (expect well under 1 s):
--   EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM public.get_catalog_sparklines(365, 32);

CREATE OR REPLACE FUNCTION public.get_catalog_sparklines(p_days integer, p_points integer)
RETURNS TABLE (product_id bigint, series text, first_day date, last_day date)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
WITH params AS (
  -- Out-of-range arguments return no rows at all (anon can call this).
  SELECT p_days AS days,
         p_points AS points,
         current_date - (p_days - 1) AS window_start
  WHERE p_days BETWEEN 2 AND 400
    AND p_points BETWEEN 2 AND 64
    AND p_points <= p_days
),
latest AS (
  -- Newest history row per active product: the migration 0023 gate inputs.
  SELECT p.id AS product_id,
         p.usd_price AS current_price,
         lp.recorded_at,
         lp.usd_price AS newest_price
  FROM public.products p
  LEFT JOIN LATERAL (
    SELECT h.recorded_at, h.usd_price
    FROM public.product_price_history h
    WHERE h.product_id = p.id
    ORDER BY h.recorded_at DESC
    LIMIT 1
  ) lp ON true
  WHERE p.active = true
),
fresh AS (
  -- 14 = PRICE_STALENESS_TOLERANCE_DAYS, the same test as migration 0023.
  SELECT l.product_id
  FROM latest l
  WHERE l.recorded_at >= current_date - 14
    AND l.current_price IS NOT DISTINCT FROM l.newest_price
),
bucket_last AS (
  -- Buckets 1..points: the last price recorded in each bucket of the window.
  -- width_bucket on numeric, so bucket edges are exact.
  SELECT DISTINCT ON (f.product_id, b.bucket) f.product_id, b.bucket, h.usd_price
  FROM fresh f
  CROSS JOIN params pr
  JOIN public.product_price_history h
    ON h.product_id = f.product_id
   AND h.recorded_at >= pr.window_start
   AND h.recorded_at < current_date + 1
  CROSS JOIN LATERAL (
    SELECT width_bucket((h.recorded_at::date - pr.window_start)::numeric, 0, pr.days, pr.points) AS bucket
  ) b
  ORDER BY f.product_id, b.bucket, h.recorded_at DESC
),
seed AS (
  -- Bucket 0: the newest price before the window, so the line starts at the
  -- price in force on the first day instead of at the first sale inside it.
  SELECT f.product_id, 0 AS bucket, s.usd_price
  FROM fresh f
  CROSS JOIN params pr
  JOIN LATERAL (
    SELECT h.usd_price
    FROM public.product_price_history h
    WHERE h.product_id = f.product_id
      AND h.recorded_at < pr.window_start
    ORDER BY h.recorded_at DESC
    LIMIT 1
  ) s ON true
),
observations AS (
  SELECT product_id, bucket, usd_price FROM seed
  UNION ALL
  SELECT product_id, bucket, usd_price FROM bucket_last
),
grid AS (
  SELECT f.product_id, g.bucket, o.usd_price
  FROM fresh f
  CROSS JOIN params pr
  CROSS JOIN LATERAL generate_series(0, pr.points) AS g(bucket)
  LEFT JOIN observations o ON o.product_id = f.product_id AND o.bucket = g.bucket
),
carried AS (
  -- Carry the last known price forward into empty buckets.
  SELECT product_id, bucket,
         first_value(usd_price) OVER (PARTITION BY product_id, run ORDER BY bucket) AS price
  FROM (
    SELECT product_id, bucket, usd_price,
           count(usd_price) OVER (PARTITION BY product_id ORDER BY bucket) AS run
    FROM grid
  ) g
),
points AS (
  SELECT product_id, bucket, price,
         min(price) OVER (PARTITION BY product_id) AS lo,
         max(price) OVER (PARTITION BY product_id) AS hi
  FROM carried
  WHERE bucket >= 1 AND price IS NOT NULL
),
encoded AS (
  -- Level 0..63 in exact numeric (halves round up, like Math.round on
  -- non-negative values), one base64url character per level.
  SELECT product_id,
         string_agg(
           substr(
             'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
             CASE WHEN hi = lo THEN 32
                  ELSE round((price::numeric - lo::numeric) * 63 / (hi::numeric - lo::numeric))::integer
             END + 1,
             1),
           '' ORDER BY bucket) AS series,
         min(bucket) AS first_bucket,
         count(*) AS n
  FROM points
  GROUP BY product_id
)
SELECT l.product_id,
       CASE WHEN e.n >= 2 THEN e.series END AS series,
       CASE WHEN e.n >= 2
            THEN pr.window_start + ceil((e.first_bucket - 1) * pr.days::numeric / pr.points)::integer
       END AS first_day,
       l.recorded_at::date AS last_day
FROM latest l
CROSS JOIN params pr
LEFT JOIN encoded e ON e.product_id = l.product_id
ORDER BY l.product_id
$$;

REVOKE ALL ON FUNCTION public.get_catalog_sparklines(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog_sparklines(integer, integer) TO anon, authenticated;
```

No new index: `latest` and `seed` walk `idx_price_history_product_recorded` (0023), and the window join is a per-product range on the same index. No grant to `pokefin_scraper`: the scraper never calls it.

Replay it locally (WP21 harness) before going further:

```bash
cd .. && PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh
# "OK: <N> files replayed once (replay_once) and twice (replay_twice)"
```

### Step 2. Database types

The site calls the function through the typed client (WP20), so `app/types/database.ts` must contain it. The owner applies 0035 to production first (Owner actions, item 1: it is additive and read-only), then:

```bash
cd frontend && SUPABASE_ACCESS_TOKEN=... pnpm types:db
grep -n "get_catalog_sparklines" app/types/database.ts   # the Functions entry with Args p_days, p_points
```

If you have no token and the owner has not pushed the regenerated file yet, do every other step, open the PR as a draft titled `[waiting for DB types] WP26: ...`, and finish this step when the file arrives. Never hand-edit `database.ts` (WP20).

### Step 3. `frontend/app/lib/sparkline.ts` (new)

Isomorphic: no React, no Supabase, no `server-only`, no `client-only`.

```ts
import type { ChartTimeframe } from "../types/market";

/**
 * Server-baked sparklines (WP26, research/performance-excellence.md §7.1).
 *
 * The database (migration 0035, get_catalog_sparklines) turns each product's
 * daily prices into a fixed number of points, scales them between the
 * series' own low and high, and writes each point as one base64url
 * character: level 0 (the low) is "A", level 63 (the high) is "_". The shape
 * is the same in USD and CAD, so nothing here takes a currency.
 *
 * A product with no series gets no line: its price is withheld by the 14-day
 * rule (migration 0023), or it has fewer than two points. encodeSparkline
 * mirrors the SQL for tests and the perf fixture; production series always
 * come from the database.
 */

export const SPARKLINE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export const SPARKLINE_MAX_LEVEL = 63;
/** Level of every point of a series whose low equals its high. */
export const SPARKLINE_FLAT_LEVEL = 32;
export const SPARKLINE_MAX_POINTS = 64;
/** Horizontal distance between two points, in viewBox units. */
export const SPARKLINE_X_STEP = 2;

const SERIES_RE = /^[A-Za-z0-9_-]{2,64}$/;

export interface SparklinePeriodSpec {
  days: number;
  points: number;
}

/**
 * Window and point count per period: the p_days and p_points the server
 * passes to get_catalog_sparklines. Changing a value changes what users see:
 * bump the unstable_cache key in serverMarketData.ts ("catalog-sparklines-v1").
 */
export const SPARKLINE_PERIODS: Readonly<Record<ChartTimeframe, SparklinePeriodSpec>> = {
  "7D": { days: 7, points: 7 },
  "1M": { days: 30, points: 30 },
  "3M": { days: 90, points: 32 },
  "6M": { days: 180, points: 32 },
  "1Y": { days: 365, points: 32 },
};

/** The home page strip has no Period control; it always shows this window. */
export const HOME_SPARKLINE_PERIOD: ChartTimeframe = "3M";
/** MarketView's initial period (its Period control starts here). */
export const MARKET_DEFAULT_PERIOD: ChartTimeframe = "1Y";

export function isSparklinePeriod(value: unknown): value is ChartTimeframe {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SPARKLINE_PERIODS, value)
  );
}

export interface SparklinePayload {
  period: ChartTimeframe;
  days: number;
  points: number;
  /** Newest price day (YYYY-MM-DD) behind any series; null when none. */
  asOf: string | null;
  /** Product id (as a string) to its series. Products without a line are absent. */
  series: Readonly<Record<string, string>>;
}

export function isValidSeries(value: unknown): value is string {
  return typeof value === "string" && SERIES_RE.test(value);
}

export function emptySparklinePayload(period: ChartTimeframe): SparklinePayload {
  const { days, points } = SPARKLINE_PERIODS[period];
  return { period, days, points, asOf: null, series: {} };
}

/** Shape check for payloads that crossed the network. */
export function isSparklinePayload(value: unknown): value is SparklinePayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isSparklinePeriod(candidate.period)) return false;
  const series = candidate.series;
  if (typeof series !== "object" || series === null || Array.isArray(series)) return false;
  return Object.values(series as Record<string, unknown>).every(isValidSeries);
}

/** Mirror of the SQL encoder (migration 0035, CTE "encoded"). */
export function encodeSparkline(values: readonly number[]): string | null {
  if (values.length < 2 || values.length > SPARKLINE_MAX_POINTS) return null;
  if (!values.every((value) => Number.isFinite(value))) return null;
  let lo = values[0];
  let hi = values[0];
  for (const value of values) {
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  let out = "";
  for (const value of values) {
    const level =
      hi === lo
        ? SPARKLINE_FLAT_LEVEL
        : Math.round(((value - lo) * SPARKLINE_MAX_LEVEL) / (hi - lo));
    out += SPARKLINE_ALPHABET[level];
  }
  return out;
}

/** Levels 0..63, or null for anything that is not a valid series. */
export function decodeSparkline(series: string): number[] | null {
  if (!isValidSeries(series)) return null;
  const levels: number[] = [];
  for (const char of series) levels.push(SPARKLINE_ALPHABET.indexOf(char));
  return levels;
}

/** viewBox for `pointCount` points: 2 units of margin above and below. */
export function sparklineViewBox(pointCount: number): string {
  return `0 -2 ${SPARKLINE_X_STEP * (pointCount - 1)} ${SPARKLINE_MAX_LEVEL + 4}`;
}

/**
 * SVG path data: absolute first point, then relative steps "2 dy". The
 * shortest text form (about 110 characters for 32 points), which matters
 * because /prices ships 306 of them in its HTML.
 */
export function sparklinePath(levels: readonly number[]): string {
  let d = `M0 ${SPARKLINE_MAX_LEVEL - levels[0]}l`;
  for (let i = 1; i < levels.length; i += 1) {
    const dy = levels[i - 1] - levels[i];
    d += `${i > 1 ? " " : ""}${SPARKLINE_X_STEP}${dy < 0 ? "" : " "}${dy}`;
  }
  return d;
}

/**
 * The series a card or row passes to MiniSparkline:
 * undefined while the period's payload is not available (flat bar),
 * null when the product has no line ("No history"), else the series.
 */
export function sparklineFor(
  payload: SparklinePayload | null | undefined,
  productId: number
): string | null | undefined {
  if (!payload) return undefined;
  return payload.series[String(productId)] ?? null;
}

/** The payload restricted to `productIds` (what a page embeds for a subset). */
export function pickSparklines(
  payload: SparklinePayload | null,
  productIds: Iterable<number>
): SparklinePayload | null {
  if (!payload) return null;
  const series: Record<string, string> = {};
  for (const id of productIds) {
    const value = payload.series[String(id)];
    if (value !== undefined) series[String(id)] = value;
  }
  return { ...payload, series };
}
```

### Step 4. `frontend/app/lib/compactHistory.ts` (new)

```ts
import type { PriceHistoryEntry } from "../types/market";
import { recordedAtDateKey } from "./format";

/**
 * Full price history in columns, for /api/public/history/[id] (WP26):
 * { d: ["YYYY-MM-DD", ...], p: [usd, ...] }, oldest first, one entry per UTC
 * day (migration 0003 allows one history row per product per day). About
 * 5 kB br for a year, against about 25 kB for row objects.
 */
export interface CompactHistory {
  d: string[];
  p: number[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toCompactHistory(entries: readonly PriceHistoryEntry[]): CompactHistory {
  const byDay = new Map<string, number>();
  for (const entry of entries) {
    const day = recordedAtDateKey(entry.recorded_at);
    if (day === null || byDay.has(day)) continue;
    if (!Number.isFinite(entry.usd_price) || entry.usd_price <= 0) continue;
    byDay.set(day, entry.usd_price);
  }
  const days = Array.from(byDay.keys()).sort();
  return { d: days, p: days.map((day) => byDay.get(day) as number) };
}

/**
 * Back to PriceHistoryEntry rows. recorded_at is the date only
 * ("2026-09-29"); parseRecordedAt reads it as UTC midnight, so every consumer
 * that keys by recordedAtDateKey sees the same day. Null when malformed.
 */
export function fromCompactHistory(value: unknown): PriceHistoryEntry[] | null {
  if (typeof value !== "object" || value === null) return null;
  const { d, p } = value as { d?: unknown; p?: unknown };
  if (!Array.isArray(d) || !Array.isArray(p) || d.length !== p.length) return null;
  const out: PriceHistoryEntry[] = [];
  for (let i = 0; i < d.length; i += 1) {
    const day = d[i];
    const price = p[i];
    if (typeof day !== "string" || !DAY_RE.test(day)) return null;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
    out.push({ recorded_at: day, usd_price: price });
  }
  return out;
}
```

### Step 5. `frontend/app/lib/serverMarketData.ts`: sparkline cache, history accessor, strict rate

5a. Imports. Merge `ChartTimeframe` and `PriceHistoryEntry` into the file's existing type import from `../types/market` (add only the names not already imported). Add below the other `./` imports:

```ts
import { isValidSeries, SPARKLINE_PERIODS, type SparklinePayload } from "./sparkline";
```

5b. In WP11's block, export the strict rate cache and document it. Replace

```ts
const getCachedExchangeRateSnapshot = unstable_cache(
```

with

```ts
/**
 * The latest rate, cached. Rejects on a failed read (nothing is cached then).
 * For /api/public/rate only; pages use getCachedExchangeRate, which degrades.
 */
export const getCachedExchangeRateSnapshot = unstable_cache(
```

5c. Append at the end of the file:

```ts
// ---- WP26: baked sparklines and on-demand history -------------------------

/**
 * One call of get_catalog_sparklines (migration 0035) for `period`. Rejects
 * on any error, so unstable_cache never stores a failure (see the comment
 * above DAILY_BACKSTOP_SECONDS). Products without a line are left out.
 */
async function fetchCatalogSparklines(period: ChartTimeframe): Promise<SparklinePayload> {
  const { days, points } = SPARKLINE_PERIODS[period];
  const supabase = createMarketDataSupabaseClient();
  const { data, error } = await supabase.rpc("get_catalog_sparklines", {
    p_days: days,
    p_points: points,
  });
  if (error) {
    throw error;
  }

  const series: Record<string, string> = {};
  let asOf: string | null = null;
  for (const row of data ?? []) {
    // The generator types RETURNS TABLE columns as non-null, but the SQL
    // returns NULL for withheld and short series: check at runtime.
    const value: unknown = row.series;
    if (!isValidSeries(value)) continue;
    series[String(row.product_id)] = value;
    const lastDay: unknown = row.last_day;
    if (typeof lastDay === "string" && (asOf === null || lastDay > asOf)) {
      asOf = lastDay;
    }
  }
  return { period, days, points, asOf, series };
}

// The key carries a version: bump it when SPARKLINE_PERIODS or the payload
// shape changes, so entries written by older code are never read.
const getCachedCatalogSparklines = unstable_cache(
  fetchCatalogSparklines,
  ["catalog-sparklines-v1"],
  {
    revalidate: DAILY_BACKSTOP_SECONDS,
    tags: [CACHE_TAGS.marketProducts],
  }
);

/** The period's series for the ISR route. Rejects on failure (never cached). */
export function getCachedSparklinesStrict(period: ChartTimeframe): Promise<SparklinePayload> {
  return getCachedCatalogSparklines(period);
}

/**
 * The period's series for a page. On failure: null, uncached, logged. A page
 * rendered with null shows flat bars and its client fetches the period from
 * /api/public/sparklines once; it never claims "No history" for a failure.
 */
export async function getCachedSparklines(
  period: ChartTimeframe
): Promise<SparklinePayload | null> {
  try {
    return await getCachedCatalogSparklines(period);
  } catch (error) {
    logCaughtError("server_sparklines_failed", error);
    return null;
  }
}

/**
 * One product's price history (367 days), from the same cached rows as
 * /product/[id], so /api/public/history adds no database load of its own.
 * Rejects when the history read fails.
 */
export async function getCachedProductHistory(productId: number): Promise<PriceHistoryEntry[]> {
  const rows = await getCachedProductDetailRows(productId);
  return rows.history;
}
```

If `tsc` reports that `row.series` or `row.last_day` does not exist, the types were not regenerated (step 2). Do not cast around it.

### Step 6. Public read routes

6a. `frontend/app/lib/publicRoute.ts` (new):

```ts
import "server-only";
import { NextResponse } from "next/server";

/**
 * Helpers for the anonymous read routes under app/api/public/ (WP26). Those
 * routes never read cookies or request headers: they are shared by every
 * visitor, cached by the CDN, and proxy.ts does not run for them.
 */
export const GENERATED_AT_HEADER = "x-pokefin-generated-at";

/**
 * 200 JSON stamped with its render time. Two responses with the same stamp
 * came from one cached render (scripts/check-public-cache.mjs relies on it).
 */
export function publicJson(body: unknown): NextResponse {
  return NextResponse.json(body, {
    headers: { [GENERATED_AT_HEADER]: new Date().toISOString() },
  });
}

export function publicNotFound(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
```

6b. `frontend/app/api/public/sparklines/[period]/route.ts` (new):

```ts
/**
 * GET /api/public/sparklines/[period]: the whole catalog's sparklines for one
 * period (7D, 1M, 3M, 6M, 1Y), about 10 kB br (WP26). Pages embed their
 * default period; the client asks here when the user picks another one.
 *
 * ISR: rendered on the first request per period, then served by the CDN until
 * the "market-products" tag is revalidated (scraper hook) or the daily
 * backstop. Segment config must stay literal: Next reads it statically.
 */
import { getCachedSparklinesStrict } from "../../../../lib/serverMarketData";
import { isSparklinePeriod } from "../../../../lib/sparkline";
import { logCaughtError } from "../../../../lib/logger";
import { publicJson, publicNotFound } from "../../../../lib/publicRoute";

export const dynamic = "force-static";
export const revalidate = 86400;

// Empty on purpose: no build-time Supabase call (WP11 rule). Each period is
// rendered on first request and then cached like a prerendered response.
export async function generateStaticParams(): Promise<Array<{ period: string }>> {
  return [];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ period: string }> }
) {
  const { period } = await params;
  if (!isSparklinePeriod(period)) {
    return publicNotFound();
  }
  try {
    return publicJson(await getCachedSparklinesStrict(period));
  } catch (error) {
    // Rethrown: Next answers 500 and keeps any earlier cached response;
    // a failure is never cached.
    logCaughtError("public_sparklines_failed", error);
    throw error;
  }
}
```

6c. `frontend/app/api/public/history/[id]/route.ts` (new):

```ts
/**
 * GET /api/public/history/[id]: one product's daily price history for the
 * full chart ("Show full chart" on cards, row expansion on /market), as
 * compact columns { d: [...], p: [...] } (WP26, lib/compactHistory.ts).
 *
 * ISR like /product/[id], from the same cached rows (getCachedProductDetailRows,
 * tag "market-products"), so it adds no database load of its own. History is
 * not withheld for stale products: it is dated past data, the same series the
 * product page charts.
 */
import {
  getCachedMarketProductSummaries,
  getCachedProductHistory,
} from "../../../../lib/serverMarketData";
import { toCompactHistory } from "../../../../lib/compactHistory";
import { logCaughtError } from "../../../../lib/logger";
import { publicJson, publicNotFound } from "../../../../lib/publicRoute";

export const dynamic = "force-static";
export const revalidate = 86400;

export async function generateStaticParams(): Promise<Array<{ id: string }>> {
  return [];
}

const PRODUCT_ID_RE = /^[1-9][0-9]{0,9}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!PRODUCT_ID_RE.test(id)) {
    return publicNotFound();
  }
  const productId = Number(id);
  try {
    const products = await getCachedMarketProductSummaries();
    if (!products.some((product) => product.id === productId)) {
      return publicNotFound();
    }
    return publicJson(toCompactHistory(await getCachedProductHistory(productId)));
  } catch (error) {
    logCaughtError("public_history_failed", error);
    throw error;
  }
}
```

6d. `frontend/app/api/public/rate/route.ts` (new). A static route without params would run at build time (a Supabase call during `next build`, which WP11 forbids), so this one is dynamic with a CDN header; the rate changes at most once per scrape and this route is only used when the server render had the fallback rate.

```ts
/**
 * GET /api/public/rate: the latest USD to CAD rate for CurrencyProvider's
 * fallback path (WP26), so the browser never needs supabase-js for it.
 * Dynamic with a one-hour CDN lifetime instead of ISR: a param-less static
 * route would query Supabase during `next build`.
 */
import { NextResponse } from "next/server";
import { getCachedExchangeRateSnapshot } from "../../../lib/serverMarketData";
import { logCaughtError } from "../../../lib/logger";

export const dynamic = "force-dynamic";

const CDN_CACHE = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";

export async function GET() {
  try {
    const snapshot = await getCachedExchangeRateSnapshot();
    return NextResponse.json(snapshot, { headers: { "Cache-Control": CDN_CACHE } });
  } catch (error) {
    logCaughtError("public_rate_failed", error);
    return NextResponse.json(
      { error: "Exchange rate unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
```

### Step 7. `frontend/proxy.ts`: do not run the proxy for `/api/public/*`

In `export const config`, replace the matcher entry `"/api/:path*",` with:

```ts
    // Every API route except the anonymous, CDN-cached /api/public/* reads
    // (WP26): they need no rate limit (bounded inputs, served from cache) and
    // no session refresh, and running the proxy would add an auth round trip
    // to every cache hit for signed-in visitors.
    "/api/((?!public/).*)",
```

Leave the other entries and the proxy body unchanged. `/api/revalidate`, `/api/account/*`, `/api/portfolio*` and `/api/box-recipes*` still match (tested in Tests, item 10).

### Step 8. `frontend/app/lib/publicMarketApi.ts` (new): the browser side of the public routes

```ts
import "client-only";

import type { ChartTimeframe, PriceHistoryEntry } from "../types/market";
import type { ExchangeRateSnapshot } from "./currency";
import { fromCompactHistory } from "./compactHistory";
import { isSparklinePayload, type SparklinePayload } from "./sparkline";

/**
 * Same-origin reads of the anonymous /api/public/* routes (WP26). Replaces
 * every supabase-js read on /, /prices and /market: nothing here loads the
 * Supabase client. Successful answers are kept for an hour per tab; failures
 * are never kept, so the next call retries.
 */
export const PUBLIC_CACHE_TTL_MS = 60 * 60 * 1000;

type Entry<T> = { promise: Promise<T>; at: number };

const sparklineCache = new Map<ChartTimeframe, Entry<SparklinePayload>>();
const historyCache = new Map<number, Entry<PriceHistoryEntry[]>>();

function remember<K, T>(cache: Map<K, Entry<T>>, key: K, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < PUBLIC_CACHE_TTL_MS) return hit.promise;
  const promise = load();
  cache.set(key, { promise, at: Date.now() });
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (res.status === 404) return { status: 404, body: null };
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return { status: res.status, body: await res.json() };
}

export function fetchPublicSparklines(period: ChartTimeframe): Promise<SparklinePayload> {
  return remember(sparklineCache, period, async () => {
    const { status, body } = await getJson(`/api/public/sparklines/${period}`);
    if (status === 404 || !isSparklinePayload(body) || body.period !== period) {
      throw new Error(`/api/public/sparklines/${period}: unexpected answer`);
    }
    return body;
  });
}

/** Daily history, oldest first. [] for a product the catalog does not have. */
export function fetchPublicHistory(productId: number): Promise<PriceHistoryEntry[]> {
  return remember(historyCache, productId, async () => {
    const { status, body } = await getJson(`/api/public/history/${productId}`);
    if (status === 404) return [];
    const history = fromCompactHistory(body);
    if (history === null) throw new Error(`/api/public/history/${productId}: malformed body`);
    return history;
  });
}

export async function fetchPublicRate(): Promise<ExchangeRateSnapshot> {
  const { status, body } = await getJson("/api/public/rate");
  const snapshot = body as { rate?: unknown; date?: unknown } | null;
  const rate = snapshot?.rate;
  if (status === 404 || typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("/api/public/rate: unexpected answer");
  }
  return { rate, date: typeof snapshot?.date === "string" ? snapshot.date : null };
}

/** Test-only: forget every remembered answer. */
export function _resetPublicMarketCachesForTests(): void {
  sparklineCache.clear();
  historyCache.clear();
}
```

If WP20 put `ExchangeRateSnapshot` somewhere other than `app/lib/currency.ts`, import it from where `CurrencyContext.tsx` imports it.

### Step 9. `frontend/app/context/CurrencyContext.tsx`: fallback rate from the public route

9a. Add `import { fetchPublicRate } from "../lib/publicMarketApi";` to the imports.

9b. In `CurrencyProvider`'s effect, replace

```ts
    // Loaded on demand so supabase-js stays off the initial bundle of every
    // page (review F011; exchangeRate.ts reaches it through supabaseLoader).
    import("../lib/exchangeRate")
      .then(({ fetchLatestExchangeRateClient }) => fetchLatestExchangeRateClient())
```

with

```ts
    // Same-origin and CDN-cached (WP26): no page loads supabase-js for the rate.
    fetchPublicRate()
```

Keep the `.then(...)` and `.catch(...)` that follow unchanged.

9c. Remove `app/lib/exchangeRate.ts` if nothing else imports it:

```bash
grep -rn "lib/exchangeRate\|from \"./exchangeRate\"\|fetchLatestExchangeRateClient" app --include=*.ts --include=*.tsx | grep -v __tests__
```

No output: `git rm app/lib/exchangeRate.ts` and its test (`git rm app/lib/__tests__/exchangeRate.test.ts`), and remove any `jest.mock` of it from other test files. Any output: leave the module and list the importers in the PR as follow-ups.

### Step 10. `frontend/app/components/MarketView/MiniSparkline.tsx`: draw the encoded series

Replace the whole file:

```tsx
"use client";

import { memo } from "react";
import Skeleton from "../ui/Skeleton";
import { decodeSparkline, sparklinePath, sparklineViewBox } from "../../lib/sparkline";

type SparklineSize = "card" | "row";

// card: the 96x40 slot of catalog cards and /market rows.
// row: the 64x24 slot of WP23's DataListRow (WP30, WP33).
const BOX: Record<SparklineSize, string> = {
  card: "h-10 w-24",
  row: "h-6 w-16",
};

interface MiniSparklineProps {
  /**
   * Encoded series (lib/sparkline.ts, baked by migration 0035).
   * undefined: not available yet (flat bar). null: no line ("No history").
   */
  series?: string | null;
  size?: SparklineSize;
  className?: string;
}

// Not available yet: a flat neutral bar. Never a fake chart shape
// (01-PRODUCT-DIRECTION.md §3.4).
function SparklineSkeleton({ box, className }: { box: string; className: string }) {
  return (
    <div data-testid="sparkline-skeleton" aria-hidden="true" className={`flex items-center ${box} ${className}`}>
      <Skeleton className="h-1 w-full" />
    </div>
  );
}

// Withheld price (migration 0023) or fewer than two points: say so.
function SparklineEmpty({ box, className }: { box: string; className: string }) {
  return (
    <div className={`flex items-center justify-center text-xs text-ink-soft ${box} ${className}`}>
      No history
    </div>
  );
}

function MiniSparkline({ series, size = "card", className = "" }: MiniSparklineProps) {
  const box = BOX[size];
  if (series === undefined) {
    return <SparklineSkeleton box={box} className={className} />;
  }
  const levels = series === null ? null : decodeSparkline(series);
  if (!levels) {
    return <SparklineEmpty box={box} className={className} />;
  }

  return (
    <div className={`${box} ${className}`}>
      <svg
        viewBox={sparklineViewBox(levels.length)}
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
        focusable="false"
      >
        {/* One colour for every product: the change text carries gain or
            loss (01-PRODUCT-DIRECTION.md §3.4). */}
        <path
          d={sparklinePath(levels)}
          fill="none"
          className="stroke-chart-line"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

// memo: a currency change re-renders cards, but the series string does not change.
export default memo(MiniSparkline);
```

`buildSparklinePath`, `SparklinePath` and the two stroke constants are gone. Check nothing else imports them: `grep -rn "buildSparklinePath\|SparklinePath\b" app --include=*.ts --include=*.tsx | grep -v __tests__` must print nothing. The file no longer holds hex colours, so WP23's conventions ratchet reports a lowered count: regenerate the baseline in step 25.

### Step 11. `frontend/app/components/ProductPrices/hooks/useSparklines.ts` (new)

```ts
"use client";

import { useEffect, useState } from "react";
import { fetchPublicSparklines } from "../../../lib/publicMarketApi";
import { logCaughtError } from "../../../lib/logger";
import type { SparklinePayload } from "../../../lib/sparkline";
import type { ChartTimeframe } from "../../../types/market";

/**
 * The sparkline series for `period` (WP26).
 *
 * The page embeds one period (`seed`, from getCachedSparklines). Any other
 * period, or the seeded one when the server had none (seed null), is fetched
 * once per tab from the CDN-cached /api/public/sparklines/[period].
 * undefined while that request is pending or after it failed: cards then show
 * the flat bar, never another period's line.
 */
export function useSparklines(
  seed: SparklinePayload | null,
  period: ChartTimeframe
): SparklinePayload | undefined {
  const seeded = seed !== null && seed.period === period;
  const [fetched, setFetched] = useState<SparklinePayload | null>(null);

  useEffect(() => {
    if (seeded) return;
    let cancelled = false;
    fetchPublicSparklines(period)
      .then((payload) => {
        if (!cancelled) setFetched(payload);
      })
      .catch((error: unknown) => {
        logCaughtError("sparklines_load_failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [seeded, period]);

  if (seeded) return seed;
  return fetched !== null && fetched.period === period ? fetched : undefined;
}
```

### Step 12. Data hooks and `clientMarketData.ts`

12a. Replace `frontend/app/components/ProductPrices/hooks/useProductData.ts` entirely:

```ts
"use client";

import { useCallback, useRef, useState } from "react";
import { fetchPublicHistory } from "../../../lib/publicMarketApi";
import { logCaughtError } from "../../../lib/logger";
import type { PriceHistoryEntry, Product } from "../../../types/market";
import { createHistoryLoadingStore } from "./historyLoadingStore";

type UseProductDataOptions = {
  initialProducts?: Product[];
};

// Module-level so an omitted `initialProducts` does not hand callers a brand
// new `[]` identity on every render.
const EMPTY_PRODUCTS: Product[] = [];

function sameProductList(a: Product[], b: Product[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * The page's products (server props only) and on-demand full price history.
 *
 * WP26: sparklines are baked on the server, so history is needed only when a
 * user opens a chart. It is fetched one product at a time from the CDN-cached
 * /api/public/history/[id]; there is no viewport loading, no batching and no
 * Supabase client here. The pages always pass their products: the old
 * browser catalog fallback is gone (the ISR page keeps its last good render
 * when a server read fails).
 */
export function useProductData(options: UseProductDataOptions = {}) {
  const initialProducts = options.initialProducts ?? EMPTY_PRODUCTS;

  // Callers often build `initialProducts` inline, which changes its identity
  // on every render. Latch it so it only advances when the contents change
  // (React's "adjust state during render" pattern, no commit).
  const [products, setProducts] = useState(initialProducts);
  if (!sameProductList(products, initialProducts)) {
    setProducts(initialProducts);
  }

  const [priceHistory, setPriceHistory] = useState<Record<number, PriceHistoryEntry[]>>({});
  // Stable for the hook's lifetime. Loading flags live outside React state so
  // one product's load re-renders only its own card (WP09, F070).
  const [historyLoadingStore] = useState(createHistoryLoadingStore);
  // Read by the stable callback below instead of state, so it can keep a
  // constant identity (consumers put it in effect dependencies).
  const priceHistoryRef = useRef<Record<number, PriceHistoryEntry[]>>({});
  const inFlightRef = useRef(new Map<number, Promise<PriceHistoryEntry[] | null>>());

  /**
   * The product's full history: from memory when loaded (an empty history
   * counts as loaded), else one request shared by concurrent callers.
   * Resolves null when the request failed; nothing is stored then, so the
   * next call retries. Never rejects.
   */
  const ensureHistoryLoaded = useCallback(
    (productId: number): Promise<PriceHistoryEntry[] | null> => {
      const loaded = priceHistoryRef.current[productId];
      if (loaded !== undefined) return Promise.resolve(loaded);
      const pending = inFlightRef.current.get(productId);
      if (pending) return pending;

      historyLoadingStore.start(productId);
      const request = fetchPublicHistory(productId)
        .then((history): PriceHistoryEntry[] => {
          const next = { ...priceHistoryRef.current, [productId]: history };
          priceHistoryRef.current = next;
          setPriceHistory(next);
          return history;
        })
        .catch((error: unknown): null => {
          logCaughtError("product_history_load_failed", error);
          return null;
        })
        .finally(() => {
          inFlightRef.current.delete(productId);
          historyLoadingStore.finish(productId);
        });
      inFlightRef.current.set(productId, request);
      return request;
    },
    [historyLoadingStore]
  );

  return { products, priceHistory, historyLoadingStore, ensureHistoryLoaded };
}
```

The hook no longer returns `loading`, and `ensureHistoryLoaded` takes no timeframe. `pnpm exec tsc --noEmit` now lists every consumer; each is handled in steps 13 to 17.

12b. `frontend/app/components/ProductPrices/hooks/useVolumeMetrics.ts`: the client fallback fetch goes (research §7.2: "delete the client refetch"). Replace the file with:

```ts
import type { VolumeMetricsSummary } from "../../../types/market";

const EMPTY_METRICS: Record<number, VolumeMetricsSummary> = {};

/**
 * Sales-volume metrics keyed by product_id, exactly as the page's server
 * render supplied them (getCachedVolumeMetrics).
 *
 * WP26 removed the browser fallback that re-read the volume RPC through
 * supabase-js when the server had {}: those routes must not load the
 * Supabase client. After a failed server read the page shows no volume chips
 * until its next ISR regeneration (the next scrape or the daily backstop).
 */
export function useVolumeMetrics(
  initialMetrics?: Record<number, VolumeMetricsSummary> | null
): Record<number, VolumeMetricsSummary> {
  return initialMetrics ?? EMPTY_METRICS;
}
```

If WP20 left `VolumeMetricsSummary` elsewhere, import it from where `app/types/market.ts` or `ProductPrices/index.tsx` gets it.

12c. `frontend/app/lib/clientMarketData.ts`: delete what no caller uses any more.

```bash
grep -rn "fetchProductHistoryClient\|fetchVolumeMetrics" app --include=*.ts --include=*.tsx | grep -v __tests__ | grep -v "app/lib/clientMarketData.ts"
# expect no output (serverMarketData.ts has its own private fetchVolumeMetrics: it is a different function; if it appears, ignore that line)
```

Then delete from `clientMarketData.ts`: `fetchProductHistoryClient` and the whole WP09 batcher that serves it (the doc comment block "Price history is read in batches (F070)", `HISTORY_BATCH_WINDOW_MS`, `HISTORY_PAGE_SIZE`, `HISTORY_MAX_PAGES`, `HISTORY_EXTRA_DAYS`, `type HistoryRow`, `type HistoryWaiter`, `pendingHistoryByTimeframe`, `historyFlushTimer`, `historyIdsPerRequest`, `readFreshHistory`, `storeHistory`, `queryHistoryChunk`, `flushHistoryQueue`), the `productHistoryCache` and `productHistoryPromiseCache` declarations, `fetchVolumeMetrics` with its doc comment and its caches, and every import that becomes unused (`pnpm exec eslint app/lib/clientMarketData.ts` names them). Keep `fetchNewestPricedAtClient`, `fetchProductsFallback`, `fetchMarketProductsClient` and their caches: `/compare`, `/box-calculator` and `/portfolio` still use them.

### Step 13. `frontend/app/components/ProductPrices/cards/ProductCard.tsx`

13a. Imports: add `import Skeleton from "../../ui/Skeleton";` and make sure `PriceHistoryEntry` is imported as a type (from `../../../types/market` after WP20). After 13d, remove `useRef` from the React import if nothing uses it.

13b. Props interface. Add, next to `history`:

```ts
  /**
   * Encoded sparkline for the selected period (lib/sparkline.ts), resolved by
   * the parent from the page's baked series. undefined: not available yet
   * (flat bar). null: no line (price withheld by the 14-day rule, or fewer
   * than two points).
   */
  sparkline?: string | null;
```

and replace the `onLoadChart` line (and its comment, if any) with:

```ts
  /**
   * Fetch this product's full history for the chart. Called only when the
   * user opens the chart (WP26). Resolves null when the request failed.
   */
  onLoadChart: (productId: number) => Promise<PriceHistoryEntry[] | null>;
```

Add `sparkline,` to the destructured props.

13c. Delete the viewport and timeframe loading (WP09 step 5d): the `cardRef` declaration and every `ref={cardRef}` attribute, `chartTimeframeRef`, `isNearViewportRef`, the effect that creates the `IntersectionObserver`, the effect that refetches on `chartTimeframe` change, the old `showFullChart` effect, and the `hasHistory` alias with its comment. After this, `grep -n "IntersectionObserver\|isNearViewportRef\|chartTimeframeRef\|hasTriggeredLoad" app/components/ProductPrices/cards/ProductCard.tsx` prints nothing. Keep `const historyLoading = useIsHistoryLoading(historyLoadingStore, product.id);`.

13d. In place of the deleted effects (directly after `const historyLoading = ...`), add:

```tsx
  const [chartFailed, setChartFailed] = useState(false);
  const [chartAttempt, setChartAttempt] = useState(0);

  // Full history is fetched only when the user opens the chart: one
  // CDN-cached request to /api/public/history/[id] (WP26). The sparkline
  // never needs it.
  useEffect(() => {
    if (!showFullChart || history !== undefined) return;
    let cancelled = false;
    void onLoadChart(product.id).then((loaded) => {
      if (!cancelled && loaded === null) setChartFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [showFullChart, history, product.id, onLoadChart, chartAttempt]);

  const retryChart = () => {
    setChartFailed(false);
    setChartAttempt((attempt) => attempt + 1);
  };
```

`showFullChart` is the existing `useState(false)`; keep it.

13e. Replace WP09's `FullChartToggle` component with the version below (the button no longer depends on history: it is always visible and enabled, so the card never grows or shifts) and add `FullChartPanel` after it:

```tsx
// Always rendered and enabled: history is fetched when it is clicked (WP26),
// so the card's height never depends on data arriving (F071).
function FullChartToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="rounded-control border border-line px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action pointer-coarse:min-h-11"
    >
      {open ? "Hide chart" : "Show full chart"}
    </button>
  );
}

// The area under the toggle while the chart is open.
function FullChartPanel({
  history,
  loading,
  failed,
  onRetry,
  renderChart,
}: {
  history: PriceHistoryEntry[] | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  renderChart: (history: PriceHistoryEntry[]) => ReactNode;
}) {
  if (failed && history === undefined) {
    return (
      <p className="mt-3 text-small text-ink-soft">
        Chart unavailable.{" "}
        <button
          type="button"
          onClick={onRetry}
          className="font-medium text-action hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
        >
          Try again
        </button>
      </p>
    );
  }
  if (history === undefined || loading) {
    return (
      <div role="status" className="mt-3">
        <Skeleton className="h-[150px] w-full md:h-[200px]" />
        <span className="sr-only">Loading chart</span>
      </div>
    );
  }
  if (history.length < 2) {
    return <p className="mt-3 text-small text-ink-soft">No history</p>;
  }
  return <>{renderChart(history)}</>;
}
```

Add `type ReactNode` to the React import. If the card's existing button classes differ (WP14, WP15 or WP23 restyled it), keep the existing class string on the toggle and only add `aria-expanded`.

13f. In BOTH view branches (flat and grouped):

- Replace the toggle element `<FullChartToggle hasHistory={hasHistory} loading={historyLoading} open={showFullChart} onToggle={() => setShowFullChart((prev) => !prev)} />` with `<FullChartToggle open={showFullChart} onToggle={() => setShowFullChart((prev) => !prev)} />`.
- Replace the block `{showFullChart && hasHistory && (<LazyPriceChart ... />)}` with the block below. Move the existing `<LazyPriceChart .../>` element into `renderChart` unchanged except that its `data` prop becomes the callback's argument:

```tsx
            {showFullChart && (
              <FullChartPanel
                history={history}
                loading={historyLoading}
                failed={chartFailed}
                onRetry={retryChart}
                renderChart={(data) => (
                  <LazyPriceChart
                    data={data}
                    range={chartTimeframe}
                    currency={selectedCurrency}
                    exchangeRate={exchangeRate}
                    releaseDate={product.sets?.release_date}
                    className="mt-3"
                  />
                )}
              />
            )}
```

(The props shown are WP09's; if the file passes different ones, keep the file's.)
- Replace `<MiniSparkline history={history} days={365} />` with `<MiniSparkline series={sparkline} />`.

### Step 14. `/prices`: page, container, Period control

14a. `frontend/app/prices/page.tsx`. Add `getCachedSparklines` to the `../lib/serverMarketData` import and `import { PRICES_URL_DEFAULTS } from "../components/ProductPrices/utils/urlState";` (a plain module, safe in a server component). Add `getCachedSparklines(PRICES_URL_DEFAULTS.chart)` as the last element of the page's `Promise.all` and `sparklines` as the last destructured name, then pass `initialSparklines={sparklines}` to `<ProductPrices ...>`. Example with WP11's and WP20's shape (keep whatever else the file has):

```tsx
  const [products, volumeMetrics, sparklines] = await Promise.all([
    getCachedMarketProductSummaries(),
    getCachedVolumeMetrics(),
    // The default Period's lines go into the HTML (WP26). The page is static,
    // so it always renders the default; a ?chart= URL fetches its period
    // from /api/public/sparklines after hydration.
    getCachedSparklines(PRICES_URL_DEFAULTS.chart),
  ]);
```

14b. `frontend/app/components/ProductPrices/index.tsx`:

- Imports: `import { useSparklines } from "./hooks/useSparklines";`, `import { sparklineFor, type SparklinePayload } from "../../lib/sparkline";`. Add `Suspense` to the React import if WP08's `<Suspense fallback={null}><LocationSearchSignal /></Suspense>` import is not already there.
- Props interface: add `initialSparklines: SparklinePayload | null;` and destructure it.
- The `useProductData` destructure becomes `const { products, priceHistory, historyLoadingStore, ensureHistoryLoaded } = useProductData({ initialProducts });`. Remove every use of `loading`: the `if (loading) return null;` line at the top of the `cardList` memo, the `{loading && (...)}` element, `loading` in the `cardList` dependency array, and a `!loading &&` guard (keep the element it guarded, without the guard).
- Below the line that declares `chartTimeframe` (WP08 state), add:

```tsx
  // Baked sparklines for the selected Period (WP26): the default period comes
  // with the HTML, others are one CDN-cached request.
  const sparklines = useSparklines(initialSparklines, chartTimeframe);
```

- In every `<ProductCard` inside `cardList` (flat, grouped, type_grouped) add `sparkline={sparklineFor(sparklines, product.id)}`. Keep `history={priceHistory[product.id]}`, `historyLoadingStore={historyLoadingStore}` and `onLoadChart={ensureHistoryLoaded}`. Add `sparklines` to the `cardList` dependency array.
- Suspense-chunked hydration (research §13.3). In the grouped branch, wrap each set group: replace the group's outer `<div key={setName}>` ... `</div>` with `<Suspense key={setName} fallback={null}><div>` ... `</div></Suspense>`. Do the same in the type_grouped branch (`key={productType}`). Leave the flat branch as it is. The boundaries never suspend (all data is in props); React hydrates each group as its own unit and yields between them, so the single 150 to 300 ms hydration task becomes slices. The DOM is unchanged (Suspense renders no element), so WP09's `.pf-card-grid > .pf-card-*` rules and the `space-y-*` spacing still apply.

```tsx
          {Array.from(groupedProducts.entries()).map(([setName, setProducts]) => (
            <Suspense key={setName} fallback={null}>
              <div>
                <GroupHeader ... />
                <ProductGrid>
                  {setProducts.map((product) => (
                    <ProductCard key={product.id} ... sparkline={sparklineFor(sparklines, product.id)} />
                  ))}
                </ProductGrid>
              </div>
            </Suspense>
          ))}
```

14c. `frontend/app/components/ProductPrices/controls/ChartTimeframeButtons.tsx`: the control is now "Period". Replace the `SegmentedControl` element WP23 wrote and its comment with:

```tsx
  // "Period" (WP26): selects the sparkline window and the range a chart opens
  // at, so the label says what the control changes (research/ui-audit.md
  // /prices, improvement 3). The accessible name is the visible label.
  return (
    <SegmentedControl
      label="Period"
      options={TIMEFRAME_OPTIONS}
      value={selected}
      onChange={onChange}
    />
  );
```

Keep the file name, the component name and the `chart` URL key (`?chart=3M` links keep working; WP30 may rename internals). WP30 must not repeat this rename.

### Step 15. Home page

15a. `frontend/app/components/dashboard/RecentlyReleased.tsx`:

- Imports: `useSparklines`, and `HOME_SPARKLINE_PERIOD`, `sparklineFor`, `type SparklinePayload` from `../../lib/sparkline`. Add `Suspense` to the React import.
- Props: add `initialSparklines: SparklinePayload | null;` and destructure it.
- `const { priceHistory, historyLoadingStore, ensureHistoryLoaded } = useProductData({ initialProducts });` and below it `const sparklines = useSparklines(initialSparklines, HOME_SPARKLINE_PERIOD);`.
- On the `<ProductCard`: `chartTimeframe={HOME_SPARKLINE_PERIOD}` (was `"3M"`), add `sparkline={sparklineFor(sparklines, product.id)}`.
- Wrap each set group's outer `<div key={setName}>` in `<Suspense key={setName} fallback={null}>` like step 14b.

15b. `frontend/app/page.tsx`: add `getCachedSparklines` to the `./lib/serverMarketData` import and `import { HOME_SPARKLINE_PERIOD, pickSparklines } from "./lib/sparkline";`. Add `getCachedSparklines(HOME_SPARKLINE_PERIOD)` to the page's `Promise.all` (destructure it as `sparklines`), and pass only the strip's products to the client component:

```tsx
          <RecentlyReleased
            initialProducts={recentProducts}
            initialVolumeMetrics={recentVolumeMetrics}
            // Only the strip's own series go into the RSC payload.
            initialSparklines={pickSparklines(sparklines, recentProducts.map((p) => p.id))}
          />
```

(Keep the props the file already passes; WP20 removed `initialExchangeRate`.)

### Step 16. `/market`

16a. `frontend/app/market/page.tsx`: add `getCachedSparklines(MARKET_DEFAULT_PERIOD)` to the `Promise.all` (import `MARKET_DEFAULT_PERIOD` from `../lib/sparkline`), destructure `sparklines`, pass `initialSparklines={sparklines}` to `<MarketView>`.

16b. `frontend/app/components/MarketView/MarketView.tsx`:

- Imports: `useSparklines` from `../ProductPrices/hooks/useSparklines`; `MARKET_DEFAULT_PERIOD`, `sparklineFor`, `type SparklinePayload` from `../../lib/sparkline`.
- Props: add `initialSparklines: SparklinePayload | null;` and destructure it.
- Replace the initial value of the Period state, `useState<ChartTimeframe>("1Y")`, with `useState<ChartTimeframe>(MARKET_DEFAULT_PERIOD)`, and add below it `const sparklines = useSparklines(initialSparklines, chartTimeframe);`.
- The `useProductData` destructure loses `loading`; delete the loading branch it guarded (the "Loading products..." element or skeleton) the same way as step 14b.
- `toggleExpanded`: replace `void ensureHistoryLoaded(next, chartTimeframe);` with `void ensureHistoryLoaded(next);` and drop `chartTimeframe` from that `useCallback`'s dependency array if nothing else in it reads it.
- Delete the effect that reloads the expanded row on a period change (its body is `if (expandedProductId !== null) { void ensureHistoryLoaded(expandedProductId, chartTimeframe); }`): the route returns the full year once.
- Where the rows are rendered (`<MarketTableRow ... />`), add `sparkline={sparklineFor(sparklines, row.product.id)}`. Do not add Suspense boundaries around row chunks: rows are keyed by product, and chunk boundaries keyed by position would remount every row that crosses a chunk on each sort (worse sort INP); `/market` is replaced by WP33.

16c. `frontend/app/components/MarketView/MarketTableRow.tsx`: add to `MarketTableRowProps`

```ts
  /** Baked series for the selected Period; see sparklineFor in lib/sparkline.ts. */
  sparkline: string | null | undefined;
```

destructure it, and add `sparkline,` to the `ctx` object literal.

16d. `frontend/app/components/MarketView/columns.tsx`:

- In `MarketCellContext` add `/** Baked series for the selected Period (WP26). */ sparkline: string | null | undefined;`.
- The column with `id: "sparkline"` becomes:

```tsx
  {
    id: "sparkline",
    label: "Trend",
    headerHint: "Price over the selected period, scaled to its own low and high",
    keyColumn: false,
    sortable: false,
    headerClassName: TH,
    cellClassName: "px-3 py-4",
    render: (_row, ctx) => (
      <div className="flex justify-end">
        <MiniSparkline series={ctx.sparkline} />
      </div>
    ),
  },
```

(keep the column's existing `headerClassName` and `cellClassName` if a later package changed them). The old "Loading..." and "Open chart" cell texts are gone: the line no longer depends on the row being opened.

### Step 17. ESLint: no Supabase on the three public routes

In `frontend/eslint.config.mjs`, above the exported array (next to `ANON_CLIENT_FORBIDDEN_FILES`), add:

```js
// WP26 (research/performance-excellence.md §7.2): /, /prices and /market read
// public data only through server props and same-origin /api/public/* routes,
// so supabase-js can never load on them. perf-budget.mjs proves it on the
// built chunks; this catches it at the import.
const PUBLIC_ROUTE_CLIENT_FILES = [
  "app/page.tsx",
  "app/prices/**/*.{ts,tsx}",
  "app/market/**/*.{ts,tsx}",
  "app/components/ProductPrices/**/*.{ts,tsx}",
  "app/components/MarketView/**/*.{ts,tsx}",
  "app/components/dashboard/**/*.{ts,tsx}",
  "app/context/CurrencyContext.tsx",
  "app/lib/publicMarketApi.ts",
  "app/lib/sparkline.ts",
  "app/lib/compactHistory.ts",
];
const PUBLIC_ROUTE_IMPORT_MESSAGE =
  "/, /prices and /market must not load supabase-js (WP26). Read public data from server props or app/lib/publicMarketApi (same-origin /api/public/*).";
```

and insert this object into the exported array immediately AFTER WP12's repo-wide object (the one whose `ignores` is `["app/lib/supabaseLoader.ts", "**/__tests__/**"]`):

```js
  // WP26: stricter than WP12's guard for the public routes' modules. It
  // repeats WP12's patterns because, for the same rule, a later flat-config
  // object replaces an earlier one's options for the files it matches.
  {
    files: PUBLIC_ROUTE_CLIENT_FILES,
    ignores: ["**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: "^@supabase/", message: PUBLIC_ROUTE_IMPORT_MESSAGE },
            {
              regex: "(^|/)lib/(supabase|supabaseLoader|clientMarketData|exchangeRate|portfolio)$",
              message: PUBLIC_ROUTE_IMPORT_MESSAGE,
            },
            {
              regex: "^\\.{1,2}/(supabase|supabaseLoader|clientMarketData|exchangeRate|portfolio)$",
              message: PUBLIC_ROUTE_IMPORT_MESSAGE,
            },
          ],
        },
      ],
    },
  },
```

None of these files is in `ANON_CLIENT_FORBIDDEN_FILES` (check: `grep -n "ANON_CLIENT_FORBIDDEN_FILES" -A30 eslint.config.mjs`); if one is, remove it from `PUBLIC_ROUTE_CLIENT_FILES` (the anon block is already stricter for it). The type-only `@supabase` imports this bans are not needed in these files: types come from `app/types/`. Then `pnpm run lint` must be clean; an error here means a module on these routes still reaches Supabase: fix the import, never the rule.

### Step 18. Perf fixture: `frontend/scripts/fixtures/perf.mjs`

18a. Add below `PRICE_STALENESS_DAYS`:

```js
// WP26: server-baked sparklines, mirroring migration 0035 and
// app/lib/sparkline.ts (the anchors in scripts/perf-fixture.test.mjs keep the
// three encoders equal).
export const SPARKLINE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function encodeSparkline(values) {
  if (values.length < 2 || values.length > 64) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return values
    .map((value) => SPARKLINE_ALPHABET[hi === lo ? 32 : Math.round(((value - lo) * 63) / (hi - lo))])
    .join("");
}

/**
 * Rows shaped like get_catalog_sparklines(p_days, p_points): one per product;
 * a series for every fresh product of a released set; NULL for the 6 stale
 * products (the 0023 gate) and for the unreleased set's products (no
 * history yet). Each product's walk has its own PRNG, so the shared sequence
 * in buildPerfData, and every other fixture byte, is unchanged.
 */
export function catalogSparklineRows(summaries, body, now = new Date()) {
  let args = {};
  try {
    args = JSON.parse(body || "{}");
  } catch {
    args = {};
  }
  const days = Number(args.p_days);
  const points = Number(args.p_points);
  const valid =
    Number.isInteger(days) && Number.isInteger(points) &&
    days >= 2 && days <= 400 && points >= 2 && points <= 64 && points <= days;
  if (!valid) return [];

  const today = now.toISOString().slice(0, 10);
  const windowStart = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  return summaries.map((s) => {
    const lastDay = s.price_recorded_at ? s.price_recorded_at.slice(0, 10) : null;
    if (s.usd_price === null || s.set_release_date > today) {
      return { product_id: s.id, series: null, first_day: null, last_day: lastDay };
    }
    const rand = mulberry32((PERF_SEED ^ s.id) >>> 0);
    const values = [];
    let price = s.usd_price;
    for (let i = 0; i < points; i++) {
      values.push(price);
      // Sealed prices are flat on many days; move on about 60% of them.
      if (rand() < 0.6) price = price / (1 + (rand() - 0.5) * 0.06);
    }
    values.reverse(); // oldest first; the last point is the current price
    return { product_id: s.id, series: encodeSparkline(values), first_day: windowStart, last_day: lastDay };
  });
}
```

18b. In `perfRoutes()`'s returned object add:

```js
    "/rest/v1/rpc/get_catalog_sparklines": (ctx) => catalogSparklineRows(data(ctx).summaries, ctx.body),
```

The default stub (no fixture) keeps answering `[]`, which the pages read as "no series" (every slot says "No history" in a `pnpm build:stub` without a fixture, which is correct for an empty catalog).

### Step 19. Perf gate: supabase-js must not be loadable on `/`, `/prices`, `/market`

The byte gate measures initial scripts; the supabase-js chunk is lazy (WP12), so it never appears there. This step walks the chunks a route can ever load. Turbopack writes each lazy import's chunk list into the importing chunk as string literals (checked on a Next 16.3.6 production build while writing this spec: `e.v(t=>Promise.all(["static/chunks/2w_e0zj-t3ijn.js","static/chunks/3ndtgz5kdpcst.js"].map(t=>e.l(t)))...)`), so following `static/chunks/<name>.js` references from the initial scripts finds every reachable chunk, and the supabase-js chunk contains the string `GoTrueClient`.

19a. `frontend/scripts/perf-measure.mjs`: append

```js
const CHUNK_REF_RE = /static\/chunks\/[A-Za-z0-9_\-./]+?\.js/g;
const chunkFile = (nextDir, assetPath) => path.join(nextDir, assetPath.replace(/^\/_next\//, ""));

/** Every built JS chunk, as /_next/ paths. */
export function allChunkPaths(nextDir) {
  const dir = path.join(nextDir, "static", "chunks");
  return fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".js"))
    .map((f) => `/_next/static/chunks/${f.split(path.sep).join("/")}`);
}

/**
 * Chunks a page can ever load: its initial scripts plus every chunk named in
 * them, transitively (WP26). Turbopack writes each lazy import's chunk list
 * as "static/chunks/<name>.js" literals in the importing chunk, so this
 * follows next/dynamic and import() edges. Returns Map<path, parent path or null>.
 */
export function reachableChunks(nextDir, initialPaths) {
  const parents = new Map();
  const queue = [];
  for (const p of initialPaths) {
    if (p.startsWith("/_next/static/chunks/") && !parents.has(p)) {
      parents.set(p, null);
      queue.push(p);
    }
  }
  while (queue.length) {
    const current = queue.shift();
    const file = chunkFile(nextDir, current);
    if (!fs.existsSync(file)) continue;
    for (const match of fs.readFileSync(file, "utf8").matchAll(CHUNK_REF_RE)) {
      const ref = `/_next/${match[0]}`;
      if (!parents.has(ref)) {
        parents.set(ref, current);
        queue.push(ref);
      }
    }
  }
  return parents;
}

/** The subset of `paths` whose file contains any of `markers`. */
export function chunksContaining(nextDir, paths, markers) {
  return [...paths].filter((p) => {
    const file = chunkFile(nextDir, p);
    if (!fs.existsSync(file)) return false;
    const text = fs.readFileSync(file, "utf8");
    return markers.some((marker) => text.includes(marker));
  });
}

/** "a.js -> b.js -> c.js": how a route reaches `leaf`, for error messages. */
export function chunkChain(parents, leaf) {
  const chain = [];
  for (let p = leaf; p; p = parents.get(p) ?? null) chain.unshift(p.split("/").pop());
  return chain.join(" -> ");
}

/**
 * Errors for perf-budgets.json "forbiddenChunks" (WP26). The control route
 * must reach a chunk with the control marker, or the walk is broken and a
 * clean result would mean nothing. Returns { errors, warnings, notes }.
 */
export function checkForbiddenChunks(nextDir, budgets, results) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const rules = budgets.forbiddenChunks ?? {};
  if (Object.keys(rules).length === 0) return { errors, warnings, notes };
  const byRoute = new Map(results.map((r) => [r.route, r]));
  const reach = (route) => reachableChunks(nextDir, byRoute.get(route).scripts.map((s) => s.path));

  const control = budgets.reachabilityControl;
  if (control) {
    if (!byRoute.has(control.route)) {
      errors.push(`reachabilityControl: route ${control.route} was not measured`);
    } else if (chunksContaining(nextDir, reach(control.route).keys(), [control.marker]).length === 0) {
      errors.push(
        `reachabilityControl: no chunk reachable from ${control.route} contains "${control.marker}". The chunk walk no longer follows lazy imports; fix reachableChunks before trusting forbiddenChunks.`
      );
    }
  }

  const everyChunk = allChunkPaths(nextDir);
  for (const [name, rule] of Object.entries(rules)) {
    if (chunksContaining(nextDir, everyChunk, rule.markers).length === 0) {
      warnings.push(
        `forbiddenChunks.${name}: no built chunk contains ${rule.markers.join(" or ")}, so the rule checks nothing. If ${name} left the browser bundle for good, delete the rule.`
      );
    }
    for (const route of rule.routes) {
      if (!byRoute.has(route)) {
        errors.push(`forbiddenChunks.${name}: route ${route} was not measured`);
        continue;
      }
      const parents = reach(route);
      const hits = chunksContaining(nextDir, parents.keys(), rule.markers);
      for (const hit of hits) {
        errors.push(`${route} can load ${name} (${chunkChain(parents, hit)}): ${rule.reason}`);
      }
      if (hits.length === 0) notes.push(`${route}: ${name} not reachable`);
    }
  }
  return { errors, warnings, notes };
}
```

19b. `frontend/scripts/perf-budget.mjs`: add `checkForbiddenChunks` to the import list from `./perf-measure.mjs`, and directly after the loop that checks font preloads and third-party scripts (`for (const r of results) { if (r.fontPreloads.length > ...`), add:

```js
  const forbidden = checkForbiddenChunks(NEXT_DIR, budgets, results);
  errors.push(...forbidden.errors);
  warnings.push(...forbidden.warnings);
  if (forbidden.notes.length) console.log(`[perf:budget] forbidden chunks: ${forbidden.notes.join("; ")}`);
```

19c. `frontend/perf-budgets.json`: add two top-level keys after `"fonts"` (they are not budget slots, so `budgetSlots` and the raise rule ignore them), and one line to `$comment`:

```json
  "forbiddenChunks": {
    "supabase-js": {
      "markers": ["GoTrueClient"],
      "routes": ["/", "/prices", "/market"],
      "reason": "WP26: these routes read public data through server props and /api/public/*; supabase-js (about 66 kB gz) must not be loadable from them."
    }
  },
  "reachabilityControl": { "route": "/product/900001", "marker": "recharts-wrapper" },
```

`$comment` line: `"forbiddenChunks: chunks (found by a marker string) that must not be reachable from the listed routes, initial or lazy. reachabilityControl proves the reachability walk still follows lazy imports."`

### Step 20. Cache check for the public routes

20a. `frontend/scripts/check-public-cache.mjs` (new):

```js
/* eslint-disable no-console -- terminal tool; console output is its UI. */
// Prove the /api/public/* routes are served from a cache (WP26).
//
//   node scripts/check-public-cache.mjs                                   perf server (CI)
//   node scripts/check-public-cache.mjs https://<preview host> --require-vercel-hit
//
// Each ISR route is requested twice. The second answer must come from a
// cache: x-vercel-cache (Vercel) or x-nextjs-cache (next start) says HIT,
// STALE or PRERENDER, or both answers carry the same x-pokefin-generated-at
// render stamp. /api/public/rate is dynamic with a CDN header: its
// Cache-Control is checked, and on Vercel its second answer must be a HIT.
// VERCEL_AUTOMATION_BYPASS_SECRET, when set, is sent as
// x-vercel-protection-bypass (protected preview deployments).
import { pathToFileURL } from "node:url";
import { PERF_ORIGIN } from "./perf-config.mjs";

export const CACHED_STATES = new Set(["HIT", "STALE", "PRERENDER"]);
const STAMP = "x-pokefin-generated-at";

const upper = (value) => (value ?? "").toUpperCase();

/** Problems with an ISR route's two answers; [] when the second was cached. Pure. */
export function isrProblems(path, first, second, { requireVercelHit = false } = {}) {
  const problems = [];
  if (first.status !== 200 || second.status !== 200) {
    problems.push(`${path}: HTTP ${first.status} then ${second.status}`);
    return problems;
  }
  const cacheControl = (second.headers.get("cache-control") ?? "").toLowerCase();
  if (/\bprivate\b|no-store/.test(cacheControl)) problems.push(`${path}: Cache-Control "${cacheControl}" forbids caching`);
  const vercel = upper(second.headers.get("x-vercel-cache"));
  if (requireVercelHit && !CACHED_STATES.has(vercel)) {
    problems.push(`${path}: x-vercel-cache is "${vercel || "absent"}" on the second request`);
  }
  const state = vercel || upper(second.headers.get("x-nextjs-cache"));
  const stampA = first.headers.get(STAMP);
  const stampB = second.headers.get(STAMP);
  const sameRender = stampA !== null && stampA === stampB;
  if (!CACHED_STATES.has(state) && !sameRender) {
    problems.push(`${path}: second request was not served from a cache (cache header "${state || "absent"}", ${STAMP} ${stampA} then ${stampB})`);
  }
  return problems;
}

/** Problems with /api/public/rate's second answer. Pure. */
export function rateProblems(second, { requireVercelHit = false } = {}) {
  if (second.status === 503) return []; // no rate here: correctly uncached
  if (second.status !== 200) return [`/api/public/rate: HTTP ${second.status}`];
  const problems = [];
  const cacheControl = (second.headers.get("cache-control") ?? "").toLowerCase();
  if (!/s-maxage=\d+/.test(cacheControl)) problems.push(`/api/public/rate: Cache-Control "${cacheControl}" has no s-maxage`);
  const vercel = upper(second.headers.get("x-vercel-cache"));
  if (requireVercelHit && !CACHED_STATES.has(vercel)) problems.push(`/api/public/rate: x-vercel-cache is "${vercel || "absent"}" on the second request`);
  return problems;
}

async function twice(origin, path, headers) {
  const get = async () => {
    const res = await fetch(origin + path, { headers, redirect: "manual" });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  };
  const first = await get();
  const second = await get();
  return { first, second };
}

async function main() {
  const args = process.argv.slice(2);
  const origin = (args.find((a) => !a.startsWith("--")) ?? PERF_ORIGIN).replace(/\/$/, "");
  const requireVercelHit = args.includes("--require-vercel-hit");
  const headers = { accept: "application/json" };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }

  const problems = [];
  const lines = [];
  const three = await twice(origin, "/api/public/sparklines/3M", headers);
  problems.push(...isrProblems("/api/public/sparklines/3M", three.first, three.second, { requireVercelHit }));
  let productId = "900001";
  try {
    const ids = Object.keys(JSON.parse(three.second.text).series ?? {});
    if (ids.length) productId = ids[0];
    lines.push(`3M series: ${ids.length} products`);
  } catch {
    problems.push("/api/public/sparklines/3M: body is not JSON");
  }
  for (const path of ["/api/public/sparklines/1Y", `/api/public/history/${productId}`]) {
    const { first, second } = await twice(origin, path, headers);
    problems.push(...isrProblems(path, first, second, { requireVercelHit }));
    lines.push(`${path}: ${second.status} ${second.headers.get("x-vercel-cache") ?? second.headers.get("x-nextjs-cache") ?? "-"}`);
  }
  const rate = await twice(origin, "/api/public/rate", headers);
  problems.push(...rateProblems(rate.second, { requireVercelHit }));
  lines.push(`/api/public/rate: ${rate.second.status} ${rate.second.headers.get("cache-control")}`);

  console.log(lines.map((l) => `- ${l}`).join("\n"));
  if (problems.length) {
    for (const p of problems) console.error(`::error::public cache: ${p}`);
    process.exitCode = 1;
  } else {
    console.log(`[check-public-cache] ok on ${origin}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error("[check-public-cache]", err);
    process.exitCode = 1;
  });
}
```

20b. `.github/workflows/ci.yml`, frontend job: directly after the step `- name: Performance budgets (bytes, blocking)` add

```yaml
      # WP26: the /api/public/* routes must be served from the ISR cache
      # (second request HIT, or the same render stamp twice).
      - name: Public API cache (blocking)
        run: node scripts/check-public-cache.mjs
```

Keep the job name and every other step unchanged.

### Step 21. Lighthouse: lock in the smaller script total

After the first CI run of this branch, `node scripts/perf-lhci-summary.mjs` prints a "Suggested script limit" per URL. In `frontend/lighthouserc.json`, set `resource-summary:script:size`'s `maxNumericValue` for `^http://127\.0\.0\.1:3100/$`, `/prices$` and `/market$` to those suggested values (they are lower than today's by about the supabase-js chunk, since it no longer loads after hydration). This is a tightening: no raise line is needed. Leave `/product/900001` and every other assertion unchanged.

### Step 22. Scraper hook: warm the public pages after revalidation (research §7.5)

22a. `revalidate_hook.py`. Add below `_LOCAL_HOSTS`:

```python
# Public URLs regenerated right after a successful revalidation (WP26), so the
# first visitor after a scrape gets a fresh page instead of triggering the
# render. WP33 must update "/market" when it moves the screener.
WARM_PATHS = (
    "/",
    "/prices",
    "/market",
    "/api/public/sparklines/7D",
    "/api/public/sparklines/1M",
    "/api/public/sparklines/3M",
    "/api/public/sparklines/6M",
    "/api/public/sparklines/1Y",
)
WARM_TIMEOUT_SECONDS = 30
WARM_USER_AGENT = "pokefin-cache-warm/1"


def _site_origin(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def warm_site_caches(origin: str, session=None) -> int:
    """
    GET each public page and sparkline period once. After /api/revalidate the
    tags are stale; this request serves the stale copy and starts the
    regeneration, so real visitors get the fresh one. Returns how many URLs
    answered 200. Never raises and never sends the revalidation secret.
    """
    http = session or requests
    ok = 0
    for path in WARM_PATHS:
        try:
            response = http.get(
                origin + path,
                headers={"user-agent": WARM_USER_AGENT},
                timeout=WARM_TIMEOUT_SECONDS,
                allow_redirects=False,
            )
            if response.status_code == 200:
                ok += 1
            else:
                logger.warning(f"Cache warm {path}: HTTP {response.status_code}")
        except Exception as e:  # noqa: BLE001 - warming is best effort
            logger.warning(f"Cache warm {path} failed: {type(e).__name__}")
    logger.info(f"Cache warm: {ok}/{len(WARM_PATHS)} public URLs answered 200.")
    return ok
```

22b. In `trigger_site_revalidation`, replace

```python
        logger.info("Site caches revalidated.")
        return True
```

with

```python
        logger.info("Site caches revalidated.")
        warm_site_caches(_site_origin(url), session=session)
        return True
```

Nothing in `main.py` changes (WP11's `run_jobs_once` and WP16/WP21 structure stay as they are). The warm adds 8 GETs per scrape run that wrote data (at most 48 a day).

### Step 23. CSP and the remaining browser reads

```bash
grep -rln "supabaseLoader\|getSupabase" app --include=*.ts --include=*.tsx | grep -v __tests__ | grep -v "app/lib/supabaseLoader.ts"
```

Expected: `app/lib/clientMarketData.ts`, `app/lib/portfolio.ts`, `app/components/BoxCalculator/sharedRecipe.ts` (and `app/lib/exchangeRate.ts` if step 9c kept it). Any output means browser reads remain, so leave `next.config.ts` unchanged and paste the list with each function name into the PR as a follow-up ("move to /api/public/* or server props; then drop https://*.supabase.co from connect-src"). Only if the command prints nothing, remove ` https://*.supabase.co` from the `connect-src` line (never from `img-src`) and say so in the PR.

### Step 24. Documentation

- `frontend/README.md`, in WP22's "Performance budgets (CI)" section, add: "`forbiddenChunks` in `perf-budgets.json` lists chunks (found by a marker string) that must not be reachable, initially or lazily, from the given routes; `/`, `/prices` and `/market` must never be able to load supabase-js (WP26). Public data on those routes comes from server props or `app/lib/publicMarketApi.ts` (`/api/public/sparklines/[period]`, `/api/public/history/[id]`, `/api/public/rate`). `node scripts/check-public-cache.mjs [origin] [--require-vercel-hit]` proves those routes are cached."
- `README.md` (repo root): where the database functions are listed (search for `get_set_analytics`), add "`get_catalog_sparklines(p_days, p_points)` (migration 0035): one 6-bit base64url series per active product for the sparklines, NULL when the 14-day price gate withholds the price." In the scraper section where WP11 documented `REVALIDATE_URL`, add one sentence: "After a successful revalidation the hook also GETs `/`, `/prices`, `/market` and the five `/api/public/sparklines/*` periods so they regenerate before visitors arrive."
- `audits/HARDENING_FOLLOWUPS.md` section 7: add, as the newest migration bullet, "**Migration 0035** (WP26, `get_catalog_sparklines`): applied to production on <date>." Leave the date for the owner.

### Step 25. Update the tests that the API change breaks

Run `pnpm test --ci` and fix each failure as follows. Never weaken an assertion about behaviour that did not change.

- Files that render `ProductPrices`, `MarketView` or `RecentlyReleased` (WP08's `ProductPrices.urlSync.test.tsx`, WP13's MarketView tests, WP19's `MarketView.table.test.tsx`, WP23's transition test, and any other): add the new required prop, `initialSparklines={emptySparklinePayload("3M")}` for `ProductPrices` and `RecentlyReleased`, `emptySparklinePayload("1Y")` for `MarketView` (import it from the `lib/sparkline` path relative to the test). A test that changes the Period additionally needs `jest.mock("<relative>/lib/publicMarketApi", () => ({ fetchPublicSparklines: jest.fn(() => new Promise(() => {})), fetchPublicHistory: jest.fn(() => Promise.resolve([])), fetchPublicRate: jest.fn() }))`.
- A test that asserted the product list's loading text from `useProductData`'s `loading`: delete that case (the state no longer exists).
- WP19's `columns.test.ts`: the sparkline column's label is now "Trend"; update the expected label, nothing else.
- WP19's `MarketTableRow.test.tsx`: pass `sparkline={undefined}` (or a series where the case is about the Trend cell).
- WP14/WP23 `controls.a11y.test.tsx` and any test that finds the control by the name "Chart timeframe" or the text "Chart": use `getByRole("radiogroup", { name: "Period" })`.
- WP20's CurrencyContext test: replace its mock of `../../lib/exchangeRate` (`fetchLatestExchangeRateClient`) with a mock of the `lib/publicMarketApi` module's `fetchPublicRate`, same resolved values.
- WP09's `app/lib/__tests__/clientMarketData.history.test.ts`: `git rm` it (the batcher is gone). In `clientMarketData.cache.test.ts` and WP12's `supabaseLazyLoad.test.ts`, delete only the cases or lines that call `fetchProductHistoryClient` or `fetchVolumeMetrics`; keep every other case.
- WP09's `MiniSparkline.test.tsx`, `MiniSparkline.ssr.test.tsx`, `useProductData.test.tsx` and `ProductCard.history.test.tsx`: replaced by the versions in Tests.
- A test of `useVolumeMetrics` that mocked `fetchVolumeMetrics`: replace its cases with "returns the server metrics as given" and "returns a stable empty record for null or undefined".
- WP23's conventions ratchet: `MiniSparkline.tsx` lost its two hex colours. Run `UPDATE_UI_BASELINE=1 pnpm exec jest app/__tests__/uiConventions.test.ts`, check that the only baseline change is that file's `hex` entry going away (or to 0), and commit the baseline.

### Step 26. Measure, set the limits, write the PR numbers

```bash
cd frontend
SUPABASE_STUB_FIXTURE=perf pnpm build:stub
node scripts/perf-serve.mjs &           # wait for .perf/ready
pnpm perf:budget                         # expect FAIL rows only on document/flight limits that grew
node scripts/check-public-cache.mjs      # expect "ok"
```

For each budget row that now fails its `limit` (expected: `routes./prices.documentBrKb`, `routes./prices.flightBrKb`, `routes./market.documentBrKb`, maybe `routes./.documentBrKb`), set that slot's `limit` to `null` in `perf-budgets.json`, run `pnpm perf:budget --write-limits`, and add one line per raised key to the PR body, for example `Perf budget raise: routes./prices.documentBrKb baked sparklines (+15.8 kB br: series in the flight, SVG paths in the HTML); replaces 15 to 30 history requests and the 66 kB gz supabase-js chunk after hydration`. Never raise a `target`. Limits that went down stay as they are (WP22 tightens after two weeks of RUM).

If `/prices` document (br) is above its 70 kB target after this, do not trim anything else to hide it: keep the raised limit, mark the "/prices document ≤ 70 kB br" acceptance line unchecked with the measured value, and request the owner's approval in the PR (Owner actions, item 4). WP30's list view is the planned recovery (it drops card chrome).

## Pitfalls: do not do this

- **Do not compute or normalise the series in currency space.** It is scale-invariant; a CAD series would be identical and a currency-aware one would re-render every slot on a toggle (research §16, WP09 pitfall).
- **Do not draw a line for a withheld price.** The SQL gate, the `null` series and the "No history" state together are the 0023 promise; do not "improve" a stale product by drawing its old history in the slot.
- **Do not return a fallback from inside `unstable_cache`.** `fetchCatalogSparklines` throws; `getCachedSparklines` degrades to `null` outside the cache. A cached `{}` would say "No history" for every product for a day.
- **Do not treat a failed or pending period fetch as "No history".** `undefined` (flat bar) is "not available"; `null` is a claim about the product.
- **Do not pass `history` to `MiniSparkline` or keep a per-card observer, batcher or timeframe effect "for the sparkline".** The line comes only from `series`. History is fetched only on a chart click.
- **Do not make the sparkline route dynamic or set `CDN-Cache-Control` by hand on it.** It must be ISR (`force-static`, `revalidate = 86400`, `generateStaticParams` returning `[]`) so `revalidateTag` from the scraper hook refreshes it. Only `/api/public/rate` uses a manual `s-maxage`, because a param-less static route would query Supabase at build time.
- **Do not read cookies, headers or `request.url` in `/api/public/*` handlers.** They are shared by every visitor and `force-static` would give them empty values anyway.
- **Do not put `/api/public/*` back under `proxy.ts`.** A signed-in visitor's cookie would make every cache hit wait for a Supabase auth call.
- **Do not add Suspense boundaries keyed by position** (runs of N cards in the flat view, row chunks on `/market`): re-sorting moves items across boundaries and remounts them. Group keys (set, type) are stable; the flat view is never in the static HTML (WP08 always prerenders the grouped default), so it gains nothing from boundaries.
- **Do not add `rand()` calls to `buildPerfData`.** Every other fixture byte depends on that sequence; the sparkline walk uses its own `mulberry32(PERF_SEED ^ id)`.
- **Do not raise a perf `target`, and do not trim other markup to fit a limit.** Raise the limit with a reason (WP22 D11).
- **Do not hand-edit `app/types/database.ts`** or cast the RPC result to get past `tsc` (WP20).
- **Do not change `PRICES_URL_DEFAULTS` or the `chart` URL key.** Shared `?chart=` links must keep working.
- **Do not grant EXECUTE to PUBLIC or `pokefin_scraper`,** and do not make the function `SECURITY DEFINER`.
- **Do not send the revalidation secret on the warm GETs,** and do not let a warm failure change `trigger_site_revalidation`'s return value.

## Tests

### 1. `frontend/app/lib/__tests__/sparkline.test.ts` (new, `@jest-environment node`)

```ts
/** @jest-environment node */
import {
  decodeSparkline,
  emptySparklinePayload,
  encodeSparkline,
  isSparklinePayload,
  pickSparklines,
  SPARKLINE_PERIODS,
  sparklineFor,
  sparklinePath,
  sparklineViewBox,
} from "../sparkline";

// The same anchors are asserted against the SQL (tests/test_wp26_catalog_sparklines.py)
// and the perf fixture (scripts/perf-fixture.test.mjs).
const RAMP_90_BUCKETS = [
  102, 105, 108, 111, 114, 116, 119, 122, 125, 128, 130, 133, 136, 139, 142, 144,
  147, 150, 153, 156, 159, 161, 164, 167, 170, 173, 175, 178, 181, 184, 187, 189,
];

describe("encodeSparkline mirrors migration 0035", () => {
  it("encodes the shared anchors", () => {
    expect(encodeSparkline([1, 2, 3, 4, 5, 6, 7])).toBe("ALVgq1_");
    expect(encodeSparkline(RAMP_90_BUCKETS)).toBe("ACEHJKMORTUWZbdehjlnprtvxz1357-_");
    expect(encodeSparkline(Array.from({ length: 32 }, (_, i) => i + 1))).toBe("ACEGIKMOQSUWYacehjlnprtvxz13579_");
    expect(encodeSparkline([10, 8, 6, 4, 2, 4, 6, 8, 10])).toBe("_vgQAQgv_");
  });

  it("encodes a flat series at the middle level", () => {
    expect(encodeSparkline([5, 5, 5])).toBe("ggg");
  });

  it("is scale-invariant (USD and CAD give the same series)", () => {
    const usd = [80, 82.5, 79.99, 91.2, 88];
    expect(encodeSparkline(usd.map((v) => v * 1.3714))).toBe(encodeSparkline(usd));
  });

  it("refuses fewer than 2 or more than 64 points and non-finite values", () => {
    expect(encodeSparkline([1])).toBeNull();
    expect(encodeSparkline(Array.from({ length: 65 }, (_, i) => i))).toBeNull();
    expect(encodeSparkline([1, Number.NaN])).toBeNull();
  });
});

describe("decodeSparkline", () => {
  it("round-trips the levels", () => {
    const series = encodeSparkline(RAMP_90_BUCKETS) as string;
    const levels = decodeSparkline(series) as number[];
    expect(levels).toHaveLength(32);
    expect(levels[0]).toBe(0);
    expect(levels[31]).toBe(63);
    expect(encodeSparkline(levels)).toBe(series);
  });

  it("rejects anything that is not a 2 to 64 character base64url string", () => {
    expect(decodeSparkline("A")).toBeNull();
    expect(decodeSparkline("AB*")).toBeNull();
    expect(decodeSparkline("A".repeat(65))).toBeNull();
    expect(decodeSparkline("")).toBeNull();
  });
});

describe("drawing", () => {
  it("builds the relative path and the viewBox", () => {
    expect(sparklinePath([0, 63])).toBe("M0 63l2-63");
    expect(sparklinePath([5, 5, 10])).toBe("M0 58l2 0 2-5");
    expect(sparklinePath(decodeSparkline("ALVgq1_") as number[])).toBe("M0 63l2-11 2-10 2-11 2-10 2-11 2-10");
    expect(sparklineViewBox(32)).toBe("0 -2 62 67");
    expect(sparklineViewBox(7)).toBe("0 -2 12 67");
  });
});

describe("payload helpers", () => {
  const payload = { ...emptySparklinePayload("3M"), series: { "1": "ACEG", "2": "gggg" } };

  it("sparklineFor: undefined without a payload, null for an absent product, else the series", () => {
    expect(sparklineFor(undefined, 1)).toBeUndefined();
    expect(sparklineFor(null, 1)).toBeUndefined();
    expect(sparklineFor(payload, 1)).toBe("ACEG");
    expect(sparklineFor(payload, 3)).toBeNull();
  });

  it("pickSparklines keeps only the requested products", () => {
    expect(pickSparklines(payload, [2, 9])?.series).toEqual({ "2": "gggg" });
    expect(pickSparklines(null, [1])).toBeNull();
  });

  it("isSparklinePayload validates what crossed the network", () => {
    expect(isSparklinePayload(payload)).toBe(true);
    expect(isSparklinePayload({ ...payload, period: "2Y" })).toBe(false);
    expect(isSparklinePayload({ ...payload, series: { "1": "A*" } })).toBe(false);
    expect(isSparklinePayload({ ...payload, series: [] })).toBe(false);
    expect(isSparklinePayload(null)).toBe(false);
  });

  it("every period is inside the SQL argument bounds", () => {
    for (const { days, points } of Object.values(SPARKLINE_PERIODS)) {
      expect(days).toBeGreaterThanOrEqual(2);
      expect(days).toBeLessThanOrEqual(400);
      expect(points).toBeGreaterThanOrEqual(2);
      expect(points).toBeLessThanOrEqual(Math.min(64, days));
    }
  });
});
```

### 2. `frontend/app/lib/__tests__/sparklineMigration.test.ts` (new, `@jest-environment node`)

```ts
/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";
import { PRICE_STALENESS_TOLERANCE_DAYS } from "../marketPulse";
import { SPARKLINE_ALPHABET, SPARKLINE_FLAT_LEVEL, SPARKLINE_MAX_LEVEL } from "../sparkline";

const SQL = fs.readFileSync(
  path.resolve(__dirname, "../../../../migrations/0035_catalog_sparklines.sql"),
  "utf8"
);

describe("migration 0035 and lib/sparkline.ts agree", () => {
  it("uses the same alphabet", () => {
    expect(SQL).toContain(`'${SPARKLINE_ALPHABET}'`);
  });
  it("uses the same flat level and scale", () => {
    expect(SQL).toContain(`WHEN hi = lo THEN ${SPARKLINE_FLAT_LEVEL}`);
    expect(SQL).toContain(`* ${SPARKLINE_MAX_LEVEL} /`);
  });
  it("applies the 14-day price gate of migration 0023", () => {
    expect(SQL).toContain(`current_date - ${PRICE_STALENESS_TOLERANCE_DAYS}`);
    expect(SQL).toContain("IS NOT DISTINCT FROM");
  });
  it("is invoker-rights, pinned, and granted to anon and authenticated only", () => {
    expect(SQL).toMatch(/SECURITY INVOKER/);
    expect(SQL).toMatch(/SET search_path = public, pg_temp/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.get_catalog_sparklines\(integer, integer\) FROM PUBLIC;/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_catalog_sparklines\(integer, integer\) TO anon, authenticated;/);
  });
});
```

If `PRICE_STALENESS_TOLERANCE_DAYS` is exported from a different module after WP24, import it from there.

### 3. `frontend/app/lib/__tests__/compactHistory.test.ts` (new, `@jest-environment node`)

Cases: `toCompactHistory` sorts by day, keeps one entry per UTC day (the first row of a day), drops non-finite and non-positive prices and unparseable dates, and turns `[{recorded_at: "2026-09-28T10:00:00", usd_price: 10}, {recorded_at: "2026-09-27 23:59:59", usd_price: 9}]` into `{ d: ["2026-09-27", "2026-09-28"], p: [9, 10] }`; `fromCompactHistory` round-trips that to `[{recorded_at: "2026-09-27", usd_price: 9}, {recorded_at: "2026-09-28", usd_price: 10}]`, and returns `null` for mismatched lengths, a non-date string, a zero price, a non-object, and `{ d: [], p: [] }` gives `[]`.

### 4. `frontend/app/lib/__tests__/publicMarketApi.test.ts` (new, jsdom)

```ts
jest.mock("client-only", () => ({}));
import {
  _resetPublicMarketCachesForTests,
  fetchPublicHistory,
  fetchPublicRate,
  fetchPublicSparklines,
} from "../publicMarketApi";
import { emptySparklinePayload } from "../sparkline";

const fetchMock = jest.fn();
const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

beforeEach(() => {
  _resetPublicMarketCachesForTests();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

it("fetches a period once per tab and reuses it", async () => {
  const payload = { ...emptySparklinePayload("1Y"), series: { "1": "ACEG" } };
  fetchMock.mockReturnValue(json(200, payload));
  await expect(fetchPublicSparklines("1Y")).resolves.toEqual(payload);
  await expect(fetchPublicSparklines("1Y")).resolves.toEqual(payload);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/public/sparklines/1Y");
});

it("does not remember a failure", async () => {
  fetchMock.mockReturnValueOnce(json(500, {})).mockReturnValueOnce(json(200, emptySparklinePayload("7D")));
  await expect(fetchPublicSparklines("7D")).rejects.toThrow("HTTP 500");
  await expect(fetchPublicSparklines("7D")).resolves.toEqual(emptySparklinePayload("7D"));
});

it("rejects a payload for another period or with a bad series", async () => {
  fetchMock.mockReturnValue(json(200, emptySparklinePayload("3M")));
  await expect(fetchPublicSparklines("6M")).rejects.toThrow("unexpected answer");
});

it("decodes compact history and treats 404 as no history", async () => {
  fetchMock
    .mockReturnValueOnce(json(200, { d: ["2026-09-28", "2026-09-29"], p: [10, 11] }))
    .mockReturnValueOnce(json(404, {}));
  await expect(fetchPublicHistory(1)).resolves.toEqual([
    { recorded_at: "2026-09-28", usd_price: 10 },
    { recorded_at: "2026-09-29", usd_price: 11 },
  ]);
  await expect(fetchPublicHistory(2)).resolves.toEqual([]);
  expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/public/history/1", "/api/public/history/2"]);
});

it("reads the rate and refuses an unusable one", async () => {
  fetchMock.mockReturnValueOnce(json(200, { rate: 1.3714, date: "2026-09-29" })).mockReturnValueOnce(json(200, { rate: 0 }));
  await expect(fetchPublicRate()).resolves.toEqual({ rate: 1.3714, date: "2026-09-29" });
  await expect(fetchPublicRate()).rejects.toThrow();
});
```

(WP20's jest config maps `client-only` to Next's empty mock; the explicit `jest.mock` is harmless if so.)

### 5. `frontend/app/lib/__tests__/serverMarketData.sparklines.test.ts` (new, `@jest-environment node`)

Use WP11's `serverMarketData.cache.test.ts` mocks verbatim (`server-only`, `@supabase/supabase-js` with `rpcMock`, `../logger`, and the fake `next/cache` with `__registry` and `__store`), then:

- The registry contains `{ keyParts: ["catalog-sparklines-v1"], options: { revalidate: 86400, tags: [CACHE_TAGS.marketProducts] } }`.
- `rpcMock.mockResolvedValue({ data: [{ product_id: 2, series: "ACEG", first_day: "2026-07-02", last_day: "2026-09-29" }, { product_id: 3, series: null, first_day: null, last_day: "2026-09-01" }, { product_id: 4, series: "A*", first_day: null, last_day: "2026-09-30" }], error: null })`; `await getCachedSparklines("3M")` equals `{ period: "3M", days: 90, points: 32, asOf: "2026-09-29", series: { "2": "ACEG" } }` and `rpcMock` was called with `("get_catalog_sparklines", { p_days: 90, p_points: 32 })`.
- On `{ data: null, error: { message: "boom" } }`: `getCachedSparklines("1Y")` resolves `null`, `logCaughtError` was called with `"server_sparklines_failed"`, a second call calls `rpcMock` again (nothing cached), and `getCachedSparklinesStrict("1Y")` rejects.

### 6. `frontend/app/api/public/__tests__/publicRoutes.test.ts` (new, `@jest-environment node`)

```ts
/** @jest-environment node */
jest.mock("server-only", () => ({}));
const mockStrict = jest.fn();
const mockSummaries = jest.fn();
const mockHistory = jest.fn();
const mockRate = jest.fn();
jest.mock("../../../lib/serverMarketData", () => ({
  getCachedSparklinesStrict: (...a: unknown[]) => mockStrict(...a),
  getCachedMarketProductSummaries: (...a: unknown[]) => mockSummaries(...a),
  getCachedProductHistory: (...a: unknown[]) => mockHistory(...a),
  getCachedExchangeRateSnapshot: (...a: unknown[]) => mockRate(...a),
}));
jest.mock("../../../lib/logger", () => ({ logCaughtError: jest.fn() }));

import * as sparklines from "../sparklines/[period]/route";
import * as history from "../history/[id]/route";
import * as rate from "../rate/route";
import { emptySparklinePayload } from "../../../lib/sparkline";

const ctx = <T,>(params: T) => ({ params: Promise.resolve(params) });
const req = (path: string) => new Request(`http://localhost${path}`);

beforeEach(() => jest.clearAllMocks());

it("the two ISR routes are static, daily and prerender nothing at build", async () => {
  for (const route of [sparklines, history]) {
    expect(route.dynamic).toBe("force-static");
    expect(route.revalidate).toBe(86400);
    await expect(route.generateStaticParams()).resolves.toEqual([]);
  }
  expect(rate.dynamic).toBe("force-dynamic");
});

it("sparklines: 404 for an unknown period, JSON with a render stamp otherwise", async () => {
  const missing = await sparklines.GET(req("/api/public/sparklines/2Y"), ctx({ period: "2Y" }));
  expect(missing.status).toBe(404);
  expect(mockStrict).not.toHaveBeenCalled();

  const payload = { ...emptySparklinePayload("3M"), series: { "1": "ACEG" } };
  mockStrict.mockResolvedValue(payload);
  const ok = await sparklines.GET(req("/api/public/sparklines/3M"), ctx({ period: "3M" }));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual(payload);
  expect(ok.headers.get("x-pokefin-generated-at")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

it("sparklines: a failed read is rethrown (never cached as a response)", async () => {
  mockStrict.mockRejectedValue(new Error("rpc down"));
  await expect(sparklines.GET(req("/api/public/sparklines/1Y"), ctx({ period: "1Y" }))).rejects.toThrow("rpc down");
});

it("history: 404 for malformed or unknown ids, compact JSON otherwise", async () => {
  mockSummaries.mockResolvedValue([{ id: 7 }]);
  for (const id of ["abc", "0", "07", "-1", "12345678901"]) {
    expect((await history.GET(req(`/api/public/history/${id}`), ctx({ id }))).status).toBe(404);
  }
  expect((await history.GET(req("/api/public/history/8"), ctx({ id: "8" }))).status).toBe(404);
  mockHistory.mockResolvedValue([
    { recorded_at: "2026-09-29T11:00:00", usd_price: 11 },
    { recorded_at: "2026-09-28T10:00:00", usd_price: 10 },
  ]);
  const ok = await history.GET(req("/api/public/history/7"), ctx({ id: "7" }));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ d: ["2026-09-28", "2026-09-29"], p: [10, 11] });
  expect(mockHistory).toHaveBeenCalledWith(7);
});

it("rate: CDN-cacheable on success, 503 no-store on failure", async () => {
  mockRate.mockResolvedValueOnce({ rate: 1.37, date: "2026-09-29" });
  const ok = await rate.GET();
  expect(ok.status).toBe(200);
  expect(ok.headers.get("cache-control")).toContain("s-maxage=3600");
  mockRate.mockRejectedValueOnce(new Error("down"));
  const down = await rate.GET();
  expect(down.status).toBe(503);
  expect(down.headers.get("cache-control")).toBe("no-store");
});
```

### 7. `frontend/app/components/MarketView/__tests__/MiniSparkline.test.tsx` (replace) and `MiniSparkline.ssr.test.tsx` (replace)

`MiniSparkline.test.tsx` (jsdom):

```tsx
import { render, screen } from "@testing-library/react";
import MiniSparkline from "../MiniSparkline";

describe("MiniSparkline", () => {
  it("draws the decoded series as one path in the chart-line colour", () => {
    const { container } = render(<MiniSparkline series="ALVgq1_" />);
    const path = container.querySelector("path");
    expect(path).toHaveAttribute("d", "M0 63l2-11 2-10 2-11 2-10 2-11 2-10");
    expect(path).toHaveClass("stroke-chart-line");
    expect(path?.getAttribute("stroke")).toBeNull();
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 -2 12 67");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows a flat skeleton bar while the series is not available", () => {
    const { container } = render(<MiniSparkline />);
    expect(screen.getByTestId("sparkline-skeleton")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("path")).toBeNull();
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("says No history for a withheld or short series and draws nothing", () => {
    const { container, rerender } = render(<MiniSparkline series={null} />);
    expect(screen.getByText("No history")).toBeInTheDocument();
    expect(container.querySelector("path")).toBeNull();
    rerender(<MiniSparkline series="A" />);
    expect(screen.getByText("No history")).toBeInTheDocument();
    rerender(<MiniSparkline series="AB*" />);
    expect(screen.getByText("No history")).toBeInTheDocument();
  });

  it("has a 64x24 row size", () => {
    const { container } = render(<MiniSparkline series="ACEG" size="row" />);
    expect(container.firstChild).toHaveClass("h-6", "w-16");
  });
});
```

`MiniSparkline.ssr.test.tsx` (`@jest-environment node`): `renderToString(<MiniSparkline series="ACEG" />)` contains `<path` and `d="M0 63l2-2 2-2 2-2"`; `renderToString(<MiniSparkline series={null} />)` contains `No history` and no `<path`. This is the "line in the first paint" guarantee: the SVG is in the server HTML.

### 8. `frontend/app/components/ProductPrices/__tests__/useSparklines.test.tsx` (new, jsdom)

Mock `../../../lib/publicMarketApi` (`fetchPublicSparklines: jest.fn()`) and `../../../lib/logger`. Use `renderHook(({ period }) => useSparklines(seed, period), { initialProps: { period: "3M" } })` with `seed = { ...emptySparklinePayload("3M"), series: { "1": "ACEG" } }`. Cases:

- the seeded period returns the seed on the first render and never fetches;
- `rerender({ period: "1Y" })` returns `undefined`, calls `fetchPublicSparklines("1Y")` once, and after the promise resolves (inside `act`) returns the 1Y payload;
- `rerender({ period: "3M" })` returns the seed again with no new fetch;
- a rejected fetch leaves the result `undefined` and calls `logCaughtError` with `"sparklines_load_failed"`;
- with `seed = null` and period "3M", it fetches "3M".

### 9. `frontend/app/components/MarketView/__tests__/useProductData.test.tsx` (replace)

Mock `../../../lib/publicMarketApi` (`fetchPublicHistory: jest.fn()`) and `../../../lib/logger`. Cases:

- `products` is `initialProducts`, keeps its identity across a rerender with a new array of the same objects, and advances when the contents change;
- `ensureHistoryLoaded` keeps its identity across renders;
- two concurrent `ensureHistoryLoaded(1)` calls make one `fetchPublicHistory(1)` call and resolve the same array; `priceHistory[1]` is set; `historyLoadingStore.isLoading(1)` is true while pending and false after;
- a later `ensureHistoryLoaded(1)` resolves from memory with no new fetch, and an empty history `[]` counts as loaded (no refetch);
- a rejected fetch resolves `null`, logs `"product_history_load_failed"`, stores nothing, clears the loading flag, and the next call fetches again.

### 10. `frontend/app/__tests__/proxyMatcher.test.ts` (new, `@jest-environment node`)

```ts
/** @jest-environment node */
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "../../proxy";

const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

it("skips the anonymous public read routes", () => {
  expect(matches("/api/public/sparklines/3M")).toBe(false);
  expect(matches("/api/public/history/900001")).toBe(false);
  expect(matches("/api/public/rate")).toBe(false);
});

it("still runs for every other API route and the protected pages", () => {
  for (const url of ["/api/revalidate", "/api/account/export", "/api/portfolio", "/api/box-recipes", "/api/publicity", "/portfolio", "/account", "/auth/login"]) {
    expect(matches(url)).toBe(true);
  }
});
```

If importing `proxy.ts` needs env or mocks under jest, copy the mocks WP17's proxy test uses.

### 11. `frontend/app/components/ProductPrices/__tests__/ProductCard.history.test.tsx` (replace)

Mock `../shared/LazyPriceChart` as `() => <div data-testid="full-chart" />`. Render `ProductCard` with a minimal product (`{ id: 1, usd_price: 50, url: "https://www.tcgplayer.com/product/1", last_updated: "2026-09-29T10:00:00", sets: { name: "Set", code: "ST", release_date: "2021-08-27" }, product_types: { id: 1, name: "booster_box", label: "Booster Box" }, returns: null }`), `viewMode="flat"`, `chartTimeframe="3M"`, `selectedCurrency="USD"`, `exchangeRate={1.37}`, `formatPrice={(v) => String(v)}`, `historyLoadingStore={createHistoryLoadingStore()}`. Before each case install `window.IntersectionObserver = jest.fn()` as a spy. Cases:

- on mount with `sparkline="ACEG"`: a `path` is rendered, `onLoadChart` is not called, and `IntersectionObserver` was never constructed;
- `sparkline={null}` renders "No history";
- clicking "Show full chart" calls `onLoadChart` once with `1`, shows the "Loading chart" status, and the button reads "Hide chart" with `aria-expanded="true"`; rerendering with `history` of 2 entries shows `full-chart`; rerendering with `history={[]}` shows "No history" inside the panel;
- when `onLoadChart` resolves `null`, "Chart unavailable." appears; clicking "Try again" calls `onLoadChart` a second time.

### 12. `frontend/scripts/perf-measure.test.mjs` (add 3 tests)

Build a temp `.next` in `os.tmpdir()` with `static/chunks/a.js` = `e.v(t=>Promise.all(["static/chunks/b.js"].map(t=>e.l(t))))`, `static/chunks/b.js` = `class X{name="GoTrueClient"}`, `static/chunks/c.js` = `recharts-wrapper`, `static/chunks/d.js` = `["static/chunks/c.js"]`:

- `reachableChunks(dir, ["/_next/static/chunks/a.js"])` has exactly the keys a.js and b.js; `chunksContaining(dir, those, ["GoTrueClient"])` is `["/_next/static/chunks/b.js"]`; `chunkChain(parents, ".../b.js")` is `"a.js -> b.js"`;
- `checkForbiddenChunks` with `{ forbiddenChunks: { s: { markers: ["GoTrueClient"], routes: ["/x"], reason: "r" } }, reachabilityControl: { route: "/y", marker: "recharts-wrapper" } }` and results `[{ route: "/x", scripts: [{ path: ".../a.js" }] }, { route: "/y", scripts: [{ path: ".../d.js" }] }]` returns one error naming `/x` and `a.js -> b.js`; with `/x` starting at `d.js` instead it returns no errors and a note;
- with the control route starting at `b.js` (no path to c.js) it returns the "reachabilityControl" error.

### 13. `frontend/scripts/perf-fixture.test.mjs` (add 2 tests)

```js
import { catalogSparklineRows, encodeSparkline, PERF_PRODUCT_COUNT } from "./fixtures/perf.mjs";

test("sparkline encoder matches the shared anchors", () => {
  assert.equal(encodeSparkline([1, 2, 3, 4, 5, 6, 7]), "ALVgq1_");
  assert.equal(encodeSparkline(Array.from({ length: 32 }, (_, i) => i + 1)), "ACEGIKMOQSUWYacehjlnprtvxz13579_");
  assert.equal(encodeSparkline([5, 5, 5]), "ggg");
});

test("get_catalog_sparklines rows: one per product, NULL for stale and unreleased, deterministic", () => {
  const body = JSON.stringify({ p_days: 90, p_points: 32 });
  const rows = catalogSparklineRows(data.summaries, body, NOW);
  assert.equal(rows.length, PERF_PRODUCT_COUNT);
  for (const id of PERF_STALE_IDS) assert.equal(rows.find((r) => r.product_id === id).series, null);
  const drawn = rows.filter((r) => r.series !== null);
  assert.ok(drawn.length >= 280, `${drawn.length} drawn`);
  for (const r of drawn) assert.match(r.series, /^[A-Za-z0-9_-]{32}$/);
  assert.deepEqual(catalogSparklineRows(data.summaries, body, NOW), rows);
  assert.deepEqual(catalogSparklineRows(data.summaries, JSON.stringify({ p_days: 7, p_points: 8 }), NOW), []);
  assert.deepEqual(catalogSparklineRows(data.summaries, "not json", NOW), []);
});
```

(`data`, `NOW` and `PERF_STALE_IDS` are the file's existing constants and imports; merge the import.)

### 14. `frontend/scripts/check-public-cache.test.mjs` (new)

With `new Headers({...})` and plain `{ status, headers }` objects: a second answer with `x-nextjs-cache: HIT` passes; `STALE` passes; `MISS` with different stamps fails; `MISS` with equal stamps passes; `cache-control: private, no-store` fails; a 500 fails; `requireVercelHit` fails when `x-vercel-cache` is absent even if the stamps match. `rateProblems`: 503 gives `[]`; 200 without `s-maxage` gives one problem; 200 with `s-maxage=3600` gives `[]`.

### 15. `frontend/scripts/public-route-imports.test.mjs` (new)

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { ESLint } from "eslint";

const eslint = new ESLint();
async function restricted(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === "no-restricted-imports").length;
}

test("the public routes' modules cannot import supabase-js or its loaders (WP26)", async () => {
  const cases = [
    ["app/components/ProductPrices/hooks/probe.ts", 'import { getSupabase } from "../../../lib/supabaseLoader";\nexport const x = getSupabase;\n'],
    ["app/components/MarketView/probe.tsx", 'import { createClient } from "@supabase/supabase-js";\nexport const x = createClient;\n'],
    ["app/components/dashboard/probe.tsx", 'import { fetchMarketProductsClient } from "../../lib/clientMarketData";\nexport const x = fetchMarketProductsClient;\n'],
    ["app/lib/publicMarketApi.ts", 'import { supabase } from "./supabase";\nexport const x = supabase;\n'],
  ];
  for (const [file, code] of cases) assert.equal(await restricted(file, code), 1, file);
});

test("other modules keep WP12's rule only", async () => {
  assert.equal(await restricted("app/components/BoxCalculator/probe.ts", 'import { getSupabase } from "../../lib/supabaseLoader";\nexport const x = getSupabase;\n'), 0);
  assert.equal(await restricted("app/components/BoxCalculator/probe.ts", 'import { supabase } from "../../lib/supabase";\nexport const x = supabase;\n'), 1);
});
```

Run from `frontend/` (`pnpm run test:scripts`), so ESLint finds `eslint.config.mjs`.

### 16. `tests/test_wp26_catalog_sparklines.py` (new, repo root; runs in WP21's "Database replay and Python tests" job)

```python
"""
Database checks for migration 0035 (WP26): public.get_catalog_sparklines.

Skipped unless POKEFIN_TEST_DATABASE_URL points at a database rebuilt by
scripts/db/replay_migrations.sh (CI job "Database replay and Python tests").
NEVER point it at production: each test writes rows inside a transaction
that is rolled back.

  POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/replay_once \
    python -m pytest tests/test_wp26_catalog_sparklines.py -v

The anchor strings are shared with frontend/app/lib/__tests__/sparkline.test.ts
and frontend/scripts/perf-fixture.test.mjs.
"""
import os
from urllib.parse import urlparse

import pytest

DSN = os.environ.get("POKEFIN_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="POKEFIN_TEST_DATABASE_URL not set")

psycopg = pytest.importorskip("psycopg")

FN = "public.get_catalog_sparklines(integer, integer)"


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
        "INSERT INTO public.sets (code, name) VALUES ('WP26', 'WP26 set') RETURNING id"
    ).fetchone()[0]


def product(db, set_id, usd_price, active=True):
    return db.execute(
        "INSERT INTO public.products (set_id, usd_price, url, last_updated, active) "
        "VALUES (%s, %s, 'https://www.tcgplayer.com/product/1', now(), %s) RETURNING id",
        (set_id, usd_price, active),
    ).fetchone()[0]


def price(db, product_id, day_offset, usd):
    """One history row `day_offset` days from today (0 = today), at noon UTC."""
    db.execute(
        "INSERT INTO public.product_price_history (product_id, usd_price, recorded_at) "
        "VALUES (%s, %s, current_date + %s::integer + time '12:00')",
        (product_id, usd, day_offset),
    )


def sparklines(db, days, points):
    """Call the function as anon (proves SECURITY INVOKER reads through RLS).
    Returns {product_id: (series, first_day offset, last_day offset)}."""
    db.execute("SET LOCAL ROLE anon")
    try:
        rows = db.execute(
            "SELECT product_id, series, first_day - current_date, last_day - current_date "
            "FROM public.get_catalog_sparklines(%s, %s)",
            (days, points),
        ).fetchall()
    finally:
        db.execute("RESET ROLE")
    return {r[0]: (r[1], r[2], r[3]) for r in rows}


def test_ramp_encodes_to_the_shared_anchor(db, set_id):
    pid = product(db, set_id, 189)
    for k in range(90):
        price(db, pid, k - 89, 100 + k)
    assert sparklines(db, 90, 32)[pid] == ("ACEHJKMORTUWZbdehjlnprtvxz1357-_", -89, 0)


def test_halves_round_up(db, set_id):
    pid = product(db, set_id, 7)
    for k in range(7):
        price(db, pid, k - 6, k + 1)
    assert sparklines(db, 7, 7)[pid][0] == "ALVgq1_"


def test_empty_buckets_carry_the_last_price_forward(db, set_id):
    pid = product(db, set_id, 20)
    price(db, pid, -89, 10)
    price(db, pid, 0, 20)
    assert sparklines(db, 90, 32)[pid][0] == "A" * 31 + "_"


def test_price_before_the_window_seeds_the_first_bucket(db, set_id):
    pid = product(db, set_id, 60)
    price(db, pid, -99, 50)
    price(db, pid, 0, 60)
    assert sparklines(db, 90, 32)[pid] == ("A" * 31 + "_", -89, 0)


def test_series_starts_at_the_first_bucket_with_data(db, set_id):
    pid = product(db, set_id, 20)
    price(db, pid, -44, 10)
    price(db, pid, 0, 20)
    assert sparklines(db, 90, 32)[pid] == ("A" * 15 + "_", -44, 0)


def test_flat_series_sits_on_the_middle_level(db, set_id):
    pid = product(db, set_id, 5)
    for k in range(90):
        price(db, pid, k - 89, 5)
    assert sparklines(db, 90, 32)[pid][0] == "g" * 32


def test_stale_price_is_withheld_but_dated(db, set_id):
    pid = product(db, set_id, 999)
    price(db, pid, -40, 900)
    price(db, pid, -20, 999)
    assert sparklines(db, 90, 32)[pid] == (None, None, -20)


def test_price_disagreeing_with_its_history_is_withheld(db, set_id):
    pid = product(db, set_id, 20)
    price(db, pid, -10, 15)
    price(db, pid, 0, 25)
    assert sparklines(db, 90, 32)[pid][0] is None


def test_one_observation_is_not_a_line(db, set_id):
    pid = product(db, set_id, 10)
    price(db, pid, 0, 10)
    assert sparklines(db, 90, 32)[pid] == (None, None, 0)


def test_inactive_products_are_left_out(db, set_id):
    pid = product(db, set_id, 10, active=False)
    price(db, pid, -1, 9)
    price(db, pid, 0, 10)
    assert pid not in sparklines(db, 90, 32)


@pytest.mark.parametrize("days,points", [(1, 2), (7, 8), (401, 32), (90, 65), (90, 1)])
def test_out_of_range_arguments_return_no_rows(db, set_id, days, points):
    product(db, set_id, 10)
    assert sparklines(db, days, points) == {}


def test_privileges_and_attributes(db):
    def can(role):
        return db.execute("SELECT has_function_privilege(%s, %s, 'EXECUTE')", (role, FN)).fetchone()[0]

    assert can("anon") is True
    assert can("authenticated") is True
    assert can("pokefin_scraper") is False
    secdef, volatility, config = db.execute(
        "SELECT prosecdef, provolatile, proconfig FROM pg_proc WHERE oid = %s::regprocedure", (FN,)
    ).fetchone()
    assert secdef is False
    assert volatility == "s"
    assert any(c.startswith("search_path=") for c in (config or []))
```

If a fixture INSERT fails with `NotNullViolation` because production's `sets` or `products` carry another required column, add that column with a valid value to the INSERT (WP21's rule). Never weaken an assertion.

### 17. `tests/test_revalidate_hook.py` (update, WP11's file)

Give `FakeSession` a `get` that records `(url, kwargs)` into `self.gets` and returns `self.get_response` (default `FakeResponse(200)`) or raises `self.get_exc`; initialise `self.gets = []`. Add:

- after a 200 revalidation, `session.gets` holds exactly `https://pokefin.example` + each path of `hook.WARM_PATHS`, in order, each with `allow_redirects=False`, `timeout == hook.WARM_TIMEOUT_SECONDS`, and a `headers` dict without `x-revalidate-secret`;
- a 401 revalidation makes no GET;
- a warm GET raising `requests.ConnectionError` still returns `True` from `trigger_site_revalidation`, and the secret is not in `caplog.text`;
- `warm_site_caches` returns the count of 200 answers (one 500 among them gives `len(WARM_PATHS) - 1`).

Every existing case must pass unchanged.

## Verification

From `frontend/` unless noted.

```bash
pnpm exec tsc --noEmit                                   # 0 errors
pnpm run lint                                            # 0 errors, 0 warnings
pnpm test --ci                                           # all suites pass, including:
pnpm test --ci app/lib/__tests__/sparkline.test.ts app/lib/__tests__/sparklineMigration.test.ts \
  app/lib/__tests__/compactHistory.test.ts app/lib/__tests__/publicMarketApi.test.ts \
  app/lib/__tests__/serverMarketData.sparklines.test.ts app/api/public app/__tests__/proxyMatcher.test.ts \
  app/components/MarketView app/components/ProductPrices app/context
pnpm run test:scripts                                    # node --test scripts/*.test.mjs: all pass

# No sparkline data path left on the client
grep -rn "IntersectionObserver" app/components/ProductPrices/cards/ProductCard.tsx     # no output
grep -rn "fetchProductHistoryClient\|queryHistoryChunk\|buildSparklinePath" app        # no output
grep -rn "<MiniSparkline" app --include=*.tsx | grep -v __tests__                      # 3 hits, all series={...}

# Default stub build (empty catalog): must build; the two ISR routes must not be dynamic
pnpm build:stub 2>&1 | tee /tmp/wp26-build.log
grep -E "api/public/(sparklines|history)" /tmp/wp26-build.log   # neither line marked ƒ (Dynamic)
grep -E "api/public/rate" /tmp/wp26-build.log                   # ƒ (Dynamic)

# Perf build: budgets, forbidden chunks, cache headers
SUPABASE_STUB_FIXTURE=perf pnpm build:stub
node scripts/perf-serve.mjs &                            # wait for .perf/ready
pnpm perf:budget
#   "[perf:budget] forbidden chunks: /: supabase-js not reachable; /prices: ...; /market: ..."
#   no error lines; the rows you raised in step 26 show ok or "over target"
node scripts/check-public-cache.mjs                      # "[check-public-cache] ok on http://127.0.0.1:3100"
curl -s http://127.0.0.1:3100/prices | grep -o '<path d="M0 ' | wc -l          # 294 (306 minus 12 without a line)
curl -s http://127.0.0.1:3100/prices | grep -o 'No history' | wc -l             # 12 (6 stale, 6 unreleased)
node -e 'import("./scripts/fixtures/perf.mjs").then((m)=>{const {summaries}=m.buildPerfData({baseUrl:"http://127.0.0.1:3100"});console.log(m.catalogSparklineRows(summaries,JSON.stringify({p_days:90,p_points:32})).filter((r)=>r.series===null).length)})'
#   prints the expected "No history" count if the fixture changed since this spec (use it instead of 12)
curl -s http://127.0.0.1:3100/api/public/history/900001 | head -c 200             # {"d":["...
pnpm dlx @lhci/cli@0.15.1 autorun && node scripts/perf-lhci-summary.mjs
#   /, /prices, /market: script KiB about 66 kB lower than .perf/wp26-lhci-before.md
kill %1

# Database (repo root): replay and the DB tests
cd .. && PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh
POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once python -m pytest tests/test_wp26_catalog_sparklines.py tests/test_revalidate_hook.py -q
python -m pytest tests/ -q                               # whole Python suite green
```

The perf build's `grep '<path d="M0 '` count assumes the grouped default renders every card once and no other `<path d="M0 ` exists on the page; if WP23 or WP24 icons produce matches, compare the count before and after this PR instead (the difference must be 294).

Performance checks against the budget:

- `pnpm perf:budget` passes; `.perf/budget-result.json` against `.perf/wp26-before.json`: `/`, `/prices`, `/market` JS within 1 kB of before; document and flight growth in the D4 ranges.
- `/prices` document (br) ≤ 70 kB (target). If not, step 26's rule applies.
- Lighthouse `resource-summary:script:size` on the three URLs is lower than before by about 60 kB or more; CLS on `/prices` is unchanged or lower (no skeleton-to-line swap any more).

Manual checks (`node scripts/perf-serve.mjs` and a browser at `http://127.0.0.1:3100`, or a Vercel preview):

- 1440 px, `/prices`: every card has its line in the page source (View Source shows `<path d=` inside each card); "PERIOD" label; select 1Y: slots turn to flat bars for a moment, then 1Y lines; Network shows exactly one request, `/api/public/sparklines/1Y`; select 1Y again after 3M: no request.
- 1440 px, DevTools Performance or Network, reload `/prices` and scroll to the bottom and back: zero requests to `/api/public/history`, zero to `/rest/v1/`, and no chunk containing `GoTrueClient` (search the Sources panel).
- 1440 px, click "Show full chart" on a card: one `/api/public/history/<id>` request, flat bar then chart; hide and reopen: no request. In DevTools set the request to fail (block the URL) on another card: "Chart unavailable." with a working "Try again".
- 1440 px, `/market` with all columns: "Trend" header with its tooltip; lines on every row without expanding; expand a row: one history request.
- 390 px (device toolbar, iPhone 12 Pro), `/prices`: lines present on first paint, "No history" on stale products (in the perf fixture, 900300 to 900305), "Show full chart" 44 px tall on touch emulation, no horizontal scroll; the filter drawer shows "PERIOD".
- 390 px, `/`: Recently Released cards show 3M lines on first paint.
- Screen reader (VoiceOver or NVDA) on `/prices`: the period control is announced as "Period, radio group"; sparklines are silent; "No history" is read.

## Owner actions

1. **Apply migration 0035 to production before merge** (Supabase SQL editor or MCP `apply_migration`, contents of `migrations/0035_catalog_sparklines.sql`). It is additive and read-only. Then run the four verification queries in the file's header: 0 rows, 0 rows, about 300 drawn, and an `EXPLAIN ANALYZE` well under 1 s. Record the date in `audits/HARDENING_FOLLOWUPS.md` (step 24) and refresh `schema.sql` as WP21 describes.
2. **Database types**: run `pnpm types:db` with your `SUPABASE_ACCESS_TOKEN` and push `frontend/app/types/database.ts` to the branch, or give the executor a token (step 2). WP20's "Database types" workflow fails on master until production and the file agree.
3. **Preview cache check** (acceptance): if the preview deployment is protected, create a "Protection Bypass for Automation" secret in Vercel (Project, Settings, Deployment Protection; free) and run from `frontend/`: `VERCEL_AUTOMATION_BYPASS_SECRET=<secret> node scripts/check-public-cache.mjs https://<preview host> --require-vercel-hit`. Expected: `ok`, with `x-vercel-cache: HIT` on each second request. Paste the output into the PR.
4. **Approve or reject any `Perf budget raise` lines** in the PR body; if the `/prices` document is above its 70 kB br target, decide between accepting the raised limit until WP30 or holding the PR.
5. **After deploy**: on production, one DevTools trace of a full `/prices` scroll on a phone profile (0 history requests), and after the next scraper run check the scraper log for `Cache warm: 8/8 public URLs answered 200.`. Pull the new `revalidate_hook.py` on the scraper machine (it runs from your checkout).

## Acceptance criteria

- [ ] `migrations/0035_catalog_sparklines.sql` exists, replays once and twice (WP21 harness), is `SECURITY INVOKER`, `STABLE`, pins `search_path`, and grants EXECUTE to `anon` and `authenticated` only; `tests/test_wp26_catalog_sparklines.py` passes in CI (all 16 cases).
- [ ] The anchor strings `ALVgq1_` and `ACEHJKMORTUWZbdehjlnprtvxz1357-_` are produced by the SQL, `encodeSparkline` and the perf fixture (tests 1, 13, 16).
- [ ] `/`, `/prices` and `/market` render sparklines from the server HTML: `renderToString` of `MiniSparkline` contains the path, and the perf build's `/prices` HTML contains one `<path d="M0 ` per drawn product.
- [ ] A product withheld by the 14-day rule renders "No history" and no line (perf fixture 900300 to 900305; unit and SSR tests).
- [ ] A DevTools trace of a full `/prices` scroll shows 0 history requests (owner or executor trace, screenshot in the PR), and `ProductCard.tsx` contains no `IntersectionObserver`.
- [ ] `perf-budgets.json` has the `forbiddenChunks` rule for `/`, `/prices`, `/market` and the reachability control, and `pnpm perf:budget` passes with "supabase-js not reachable" for all three.
- [ ] The `/prices` document is ≤ 70 kB br in `pnpm perf:budget` (or the owner approved the raise under Owner actions 4, recorded in the PR).
- [ ] `node scripts/check-public-cache.mjs` passes in CI, and the preview run with `--require-vercel-hit` shows `x-vercel-cache: HIT` (Owner actions 3).
- [ ] The Period control is labelled and named "Period" on `/prices` and `/market` and changes the sparkline window with at most one `/api/public/sparklines/<period>` request per period per tab.
- [ ] "Show full chart" and the `/market` row expansion fetch `/api/public/history/<id>` once and then serve from memory; failures show "Chart unavailable." and retry.
- [ ] ESLint forbids `@supabase/*`, `lib/supabase`, `lib/supabaseLoader`, `lib/clientMarketData`, `lib/exchangeRate` and `lib/portfolio` imports in the three routes' client modules (test 15), and `pnpm run lint` is clean.
- [ ] `/api/public/*` is excluded from `proxy.ts` and every other `/api/*` route still matches (test 10).
- [ ] `revalidate_hook.py` warms the 8 URLs after a successful revalidation, never with the secret (test 17).
- [ ] CSP is unchanged and the PR lists the remaining browser Supabase reads as follow-ups (or, if none remain, `connect-src` no longer lists `*.supabase.co`).
- [ ] `tsc`, lint, `pnpm test --ci`, `pnpm run test:scripts`, `pnpm build:stub`, the perf build and the Python suite are green.

## Rollback

- Frontend and hook: revert the PR (`git revert -m 1 <merge commit>`). The previous client path (WP09 batcher, WP12 lazy loader) comes back with it; `perf-budgets.json`, `lighthouserc.json` and `ci.yml` revert in the same commit, so the gate matches the code.
- Database: the function is read-only and unused after the revert, so it can stay. To remove it, after the revert is deployed: `DROP FUNCTION IF EXISTS public.get_catalog_sparklines(integer, integer);`, then `pnpm types:db` and a one-line migration `migrations/NNNN_drop_catalog_sparklines.sql` (next free number) with the same statement, so replay matches production.
- Scraper machine: `git pull` after the revert (the hook stops warming).

## Commit and PR

Commits (each builds and passes its tests; end each message with the attribution lines your session requires):

1. `feat(db): get_catalog_sparklines, server-baked sparkline series (WP26)`: migration 0035, `tests/test_wp26_catalog_sparklines.py`, `app/types/database.ts`.
2. `feat(api): public read routes for sparklines, history and rate (WP26)`: `sparkline.ts`, `compactHistory.ts`, `publicRoute.ts`, `serverMarketData.ts`, the three routes, `proxy.ts`, tests 1 to 6 and 10.
3. `feat(ui): baked sparklines, on-demand history, Period control (WP26)`: `publicMarketApi.ts`, `CurrencyContext.tsx`, `MiniSparkline.tsx`, hooks, `ProductCard.tsx`, `/prices`, home and `/market` wiring, `clientMarketData.ts` and `exchangeRate.ts` cleanup, ESLint guard, tests 7 to 9, 11, 15 and the step 25 updates.
4. `perf: forbidden-chunk gate, sparkline fixture, public cache check (WP26)`: `perf.mjs`, `perf-measure.mjs`, `perf-budget.mjs`, `perf-budgets.json`, `check-public-cache.mjs`, `ci.yml`, `lighthouserc.json`, tests 12 to 14.
5. `feat(scraper): warm public pages after revalidation (WP26)`: `revalidate_hook.py`, `tests/test_revalidate_hook.py`.
6. `docs: WP26 sparklines, public routes and cache warm`: `frontend/README.md`, `README.md`, `audits/HARDENING_FOLLOWUPS.md`.

PR title: `WP26: server-baked sparklines and public read routes`

PR body:

- What: sparklines baked by `get_catalog_sparklines` (migration 0035) and embedded in `/`, `/prices`, `/market`; other periods from `/api/public/sparklines/[period]` (ISR); full charts from `/api/public/history/[id]` (ISR); fallback rate from `/api/public/rate`; "CHART" renamed "Period"; WP09's per-card history loading and batcher removed; supabase-js unreachable from the three routes (ESLint and `perf-budgets.json` `forbiddenChunks`); scraper warms 8 URLs after each revalidation.
- Numbers: before and after table from `.perf/wp26-before.json` and `.perf/budget-result.json` (JS, document and flight per route), Lighthouse script KiB before and after, and the `check-public-cache` outputs (CI and preview).
- `Perf budget raise: <key> <reason>` lines, one per raised limit (step 26).
- Owner actions 1 to 5, with 1 and 2 marked done or pending.
- Follow-ups: the remaining browser Supabase reads from step 23 (file and function per line); WP30 reduces the Period to a single return per card and must not rename the control again; WP33 must update `WARM_PATHS` when `/market` moves; `/market`'s expanded row says "Price history not available yet." after a failed request (fixed when WP33 replaces the view).
- Migration: 0035 (reserved in 01-PRODUCT-DIRECTION.md §8; 0033 and 0034 belong to WP25).
