# WP29: Pokéfin Sealed Index family and market breadth

- **Goal**: a collector-investor can answer "is sealed up?" in one glance: a daily, published, rules-based Pokéfin Sealed Index (level, 1D/7D/30D/1Y change, constituents, coverage, provisional flag) on `/indices/sealed`, with product-type, generation and set sub-indices and market breadth (advancers, decliners, new 52-week highs and lows) that shows whether a move is broad or three chase boxes. Every product, set and portfolio chart gets a benchmark to compare against (consumed by WP31, WP32, WP36, WP37).
- **Why now / value**: the index is signature feature 3 in `01-PRODUCT-DIRECTION.md` §5: the home header (WP32), the benchmark toggle on product and portfolio charts (WP31, WP36) and the set charts (WP37) all read it. No sealed competitor publishes one (`research/competitive-landscape.md` §4 item 4). WP25 already computes the only input it needs (`product_daily_stats`), so the whole index is one migration and a cheap nightly job.
- **Effort**: L, 14 to 16 hours (one migration validated twice on PostgreSQL 16 with a 23-case SQL fixture module, a backfill script, a scraper hook, two library modules, two cached reads, one server page with three components, two route handlers, methodology v-next, perf fixture and budgets, tests).
- **Depends on**: WP21 (`pokefin_scraper` role, `scraper_db.py`, `scripts/db/replay_migrations.sh`, CI job "Database replay and Python tests"), WP22 (`frontend/perf-budgets.json`, `scripts/fixtures/perf.mjs`, `pnpm perf:budget`), WP23 (`Stat`, `Delta`, `Badge`, `DataList`, `EmptyState`, `Skeleton`, `PageHeader`, `ProvenanceLine`, `buttonClasses`, `WarnIcon`, chart tokens, `test-utils/axe.ts`), WP24 (`/methodology` with the `#index` placeholder, `app/content/methodology.ts`, `app/lib/metricDefinitions.ts`, `MetricLabel`, `app/lib/jsonLd.ts`), WP25 (`product_daily_stats`, `refresh_market_analytics(p_day)`, the 00:30 UTC pg_cron finalisation, `market_analytics.py`, `fetchAllRows` in `serverMarketData.ts`, methodology `#range-52w`). Through them: WP07 (`app/lib/format.ts`), WP11 (`cacheTags.ts`, `DAILY_BACKSTOP_SECONDS`, the scrape revalidation hook), WP13 (`app/sitemap.ts`, `app/lib/site.ts`), WP20 (`pnpm types:db`). Soft: WP26 (`app/lib/publicRoute.ts`, `publicMarketApi.ts`, `forbiddenChunks`, the public-route ESLint list) and WP27 (`navConfig.ts`); each step that touches them says what to do when they are absent.
- **Unblocks**: WP31 (benchmark overlay via `/api/public/index/[code]`), WP32 (home header: `getCachedIndexSummary`, `currentSummaries`, breadth), WP36 (money-matched portfolio benchmark on the headline series), WP37 (set index charts: `set-<sets.id>` codes, `IndexChart`).
- **Placement**: after WP25 (reads `product_daily_stats`; its nightly job follows WP25's 00:30 UTC finalisation and finalises the day itself if that job has not run). Parallel with WP28. Reserves migration **0042** and keeps it if it merges out of order. Must precede WP31, WP32, WP36 and WP37.
- **Suggested branch name**: `remediation/wp29-sealed-index-and-breadth`
- **Risk level**: medium. It adds a SECURITY DEFINER function the scraper and pg_cron call daily; the schema is additive (no existing object changes), writes happen only inside that function, published days are never rewritten, and a 23-case database test proves the arithmetic, the gates and reproducibility.

## Why

Today nobody can tell whether sealed Pokémon is up or down as a market: the home page shows a handful of movers with no liquidity screen and no benchmark, and a product's or portfolio's return has nothing to be compared with (`research/ui-audit.md` top-10 item 2; `research/data-opportunities.md` §3.2, §3.7). Serious buyers ask "is the whole market rising, or three chase boxes?" before any single decision, and every finance dashboard leads with that context line; Card Ladder's index is its main draw for singles and nobody publishes one for sealed (`research/competitive-landscape.md` §4 item 4). This package publishes an equal-weighted, chain-linked daily index with monthly frozen constituents, a clip on outlier returns, a gap rule, a provisional flag and a weekly segment for backfilled history, exactly the design `research/data-opportunities.md` §3.7 specifies and `01-PRODUCT-DIRECTION.md` §5 item 3 ranks third. Breadth (advancers, decliners, new 52-week highs and lows) is stored with every level, so the index page, WP32's home header and later charts can show whether a move is broad. Every rule is published verbatim on `/methodology#index` and every number on the page is dated to the close of the UTC day it describes (`research/trust-seo-brand.md` §4, §5.1), and the levels are downloadable under CC BY 4.0 because they are Pokéfin's own derived data (`research/trust-seo-brand.md` §9).

## Design

### Data flow

```
 product_daily_stats (WP25, one row per product per UTC day, finalised 00:30 UTC)
            |
            v
 refresh_market_index(p_day [, p_start])   SECURITY DEFINER, advisory lock
   1. refuses today, returns not_initialised / already_published / behind without writing
   2. for each missing day up to p_day (at most 31, unless p_start: the backfill):
        a. finalises that day's stats if any row was written before the day ended
           (calls refresh_market_analytics(day)), so the order of the two nightly jobs cannot matter
        b. freeze_market_index_month(month)   first call of a month only: writes index_constituents
        c. refresh_market_index_day(day)      one row per index into market_index_daily
            ^                        ^                          ^
            |                        |                          |
 pg_cron 00:45 UTC (D-1)   scraper after each run (D-1)   scripts/backfill_market_index.py (history, p_start)
                                     |
                                     v
                     POST /api/revalidate (WP11: tag market-products)
                                     |
                                     v
 serverMarketData: getCachedIndexSummary() -> view market_index_summary (latest row + changes per index)
                   getCachedIndexSeries(code) -> market_index_daily (one index, oldest first)
            |                                  |                                   |
            v                                  v                                   v
 /indices/sealed (server SVG, dynamic)   /api/public/index/[code] (ISR)   /indices/sealed/levels.csv
                                         WP31, WP36, WP37 overlays        CC BY 4.0, derived levels only
```

The level for D-1 appears on the site within an hour of the 00:45 UTC job (the two index reads refresh hourly, `INDEX_REFRESH_SECONDS`), or sooner when a scraper run's revalidation lands first. Without pg_cron, the first scraper run after midnight UTC publishes it (at most 4 hours). The page's overdue note therefore waits until 06:00 UTC (`INDEX_PUBLISH_GRACE_HOURS`) before it calls a day late.

### Rules and formulas (the numbers are mirrored in `app/lib/marketIndex.ts` and drift-tested)

Notation: `s(p, t)` is product `p`'s `product_daily_stats` row for UTC day `t`. Months are calendar months (UTC). Percent columns of `product_daily_stats` are percent points.

| Item | Definition | Edge cases |
|---|---|---|
| Selection day `sel(M)` | Newest `product_daily_stats.day` in `[M - 7, M - 1]` for the month starting `M` | None found: the month gets no list and no index publishes that month. The first month of history is usually skipped this way (no look-ahead) |
| Headline universe `U(M)` | Products with `s(p, sel).is_price_fresh`, `usd_price >= 15` (USD), `distinct_prices_365d >= 3`, `sets.release_date <= M - 90`, and a product type whose text (name and label, lower case, `_` and `-` as spaces) contains neither `booster pack` nor `sleeved booster` | Fewer than 3: no list. A product without a set or with a NULL release date never qualifies. `products.active` is not consulted by the index: a product counts when it has a stats row that day. WP25 writes stats rows for the products active when a day is computed, so live days keep a product that is deactivated later, while months rebuilt by the one-off backfill miss products removed before it ran (disclosed on `/methodology#index-constituents`) |
| Sub-index list `C(I, M)` | `U(M)` filtered by the definition: `type` by `filter.type_patterns` (substring of the type text), `generation` by `sets.generation_id`, `set` by `products.set_id` | Fewer than 3 matches: no list, no level that month; the chain resumes from its last level when the index qualifies again |
| Freeze | The first refresh of a month writes every list for the month in one transaction; once the headline has a list for `M`, nothing for `M` changes | Generation and set definitions are created the first month they reach 3 constituents (`gen-<generations.id>`, `set-<sets.id>`); a renamed set or generation renames its index. Their `sort_order` is `2100-01-01 - release_date` in days (the generation's newest constituent set), so the newest set and generation list first |
| Carried price `q(p, t)` | `s(p, t).usd_price` when `is_price_fresh` and `price_day >= t - k`, else NULL. `k = 3` (daily), `6` (weekly) | A stale price (withheld under 0023, or the cached price disagrees with the newest row) is NULL: it never contributes |
| Return `r(p, t)` | `clip(q(p, t) / q(p, t - d) - 1, -0.5, 0.5)`, `d = 1` day (daily) or `7` days (weekly), only when both prices exist | A gap up to 3 days is carried (returns of 0, then the whole move on the repricing day). A longer gap drops the constituent out; on the day it is priced again `q(t - d)` is NULL, so there is no catch-up jump; it contributes from the next day |
| Mean return `R(I, t)` | Average of `r` over `C(I, month(t))` members with a return; `0` when none | Numeric arithmetic (exact sums), so a replay reproduces every digit |
| Level `L(I, t)` | `round(L(I, prev) * (1 + R(I, t)), 6)`, `prev` = the index's newest earlier row; `100` on its first row (its `base_day`) | Levels are `numeric(14,6)`; published rows are never recomputed |
| Coverage | `100 * n_contributing / n_constituents`, rounded to 0.1; `n_contributing` = members with a return (on the base row: members with a price) | |
| Provisional | `coverage_pct < 80` | Published as computed, never revised; the page and the CSV flag it |
| Resolution | `weekly` for days `<= daily_from` (Mondays only, Monday-to-Monday returns), `daily` after. The row on `daily_from` is the last weekly point; daily rows start the next day | `daily_from` is detected once (below) and stored in `market_index_settings`; the owner can override it |
| `daily_from` detection | A day is scraped when at least half its price rows are not stamped exactly `12:00:00` (the backfill stamps noon, `backfill_historical_prices.py:816`; the scraper stamps the scrape time). `daily_from` = the Monday on or after the first scraped day that follows the last run of 7 or more consecutive non-scraped days | No scraped day at all: every day is weekly for now and nothing is stored |
| Breadth | Over members with `s(p, t).is_price_fresh`: advancers `ret_7d > 0.5`, decliners `ret_7d < -0.5`, unchanged in between | `ret_7d` is WP25's bounded 7D return; NULL counts nowhere |
| New 52-week high / low | Fresh members tracked since `t - 364` or earlier (`first_tracked_day`) whose `high_52w(t) > high_52w(t - 7)` (low: `low_52w(t) < low_52w(t - 7)`) | Exact: a rolling maximum only rises when a new value enters, so a rise means a new (3-day robust, WP25) high inside the last 7 days |
| Changes (view) | 1D: previous row is exactly `t - 1`. 7D and 30D: newest level in `[t - N - 7, t - N]`. 1Y: newest in `[t - 379, t - 365]` | Missing anchor: NULL, shown as `--` with a reason, never 0 |
| Publication | Only finished UTC days (`p_day < today`), so the site always shows D-1 | |
| Catch-up | The nightly call fills at most 31 missing days; further behind, it writes nothing and returns `behind` (run the backfill). The backfill passes `p_start`, which may cross any gap, including a month that got no list and so wrote no level | A collection outage longer than 3 days shows as provisional days with flat levels: moves during the stop are not captured (documented). Re-running a published day returns `already_published` and writes nothing |

Index family and codes (seeded by 0042 unless noted):

| Code | Name | Kind | Filter |
|---|---|---|---|
| `sealed` | Pokéfin Sealed Index | headline | `{}` |
| `type-booster-box` | Booster Box Index | type | `{"type_patterns": ["booster box"]}` |
| `type-etb` | Elite Trainer Box Index | type | `{"type_patterns": ["elite trainer box"]}` |
| `type-booster-bundle` | Booster Bundle Index | type | `{"type_patterns": ["booster bundle"]}` |
| `type-collections` | Collections Index | type | `{"type_patterns": ["collection"]}` |
| `gen-<generations.id>` | `<generation name> Index` | generation | `{"generation_id": id}` (created on first qualifying month) |
| `set-<sets.id>` | `<set name> Index` | set | `{"set_id": id}` (created on first qualifying month) |

It is never called cap-weighted, market-cap or value-weighted anywhere (copy, comments, JSON-LD).

### Read paths and performance

- `market_index_summary` (security-invoker view): one latest-row lookup and four anchor lookups per index, all primary-key range scans. Measured on a production-size scratch database (306 products, 481 days of prices, 68 indices): 1.2 ms.
- `market_index_daily` for one index: primary-key range scan, about 365 rows a year.
- `refresh_market_index`: 9 ms per day on that database, 80 ms on the first day of a month (the freeze). The backfill of about 400 days takes seconds plus one round trip per day.
- Storage: about 70 indices x 365 rows = 26k rows a year, under 3 MB.
- Frontend: `/indices/sealed` has zero client components of its own and no charting library (the chart is SVG strings built on the server; labels are HTML). Its JS is the shared bundle. Reading `searchParams` (range and sort) makes the route dynamic, which is acceptable because both reads are `unstable_cache` entries (tag `market-products`, refreshed hourly by `INDEX_REFRESH_SECONDS` because pg_cron publishes after the scraper's last revalidation of the day): a request costs one render and no database query, and the database sees at most one 1.2 ms view read and one range read per hour. Budget: `/indices/sealed` joins `perf-budgets.json` with the targets of the current sets route (`/analytics`: JS 150 kB gz) and a 40 kB br document target; the recharts and supabase-js chunks are forbidden on it.

### UI: `/indices/sealed`

Built only from WP23 components and tokens: `PageHeader`, `ProvenanceLine`, `Stat` (hero for the level), `Delta` (glyph plus sr-only direction, `--` with a reason), `MetricLabel` (WP24, `?` link to the methodology anchor), `Badge` (warn), `DataList`/`DataListRow`, `EmptyState`, `Skeleton`, `buttonClasses`, `WarnIcon`; colours `stroke-chart-line` (index line), `stroke-chart-grid`, `bg-chart-volume` (unchanged share), `bg-gain-text`/`bg-loss-text` (breadth shares, changes only), `bg-warn-fill`/`text-warn-text` (provisional and overdue notices). Type: Display for the level, H1 title, H2/H3 sections, Caption for as-of and footnotes; every number tabular.

Desktop, 1440 px (content max-width 72 rem):

```
+----------------------------------------------------------------------------------------------------+
| Pokéfin Sealed Index                                                        [Download levels (CSV)] |
| Equal-weighted index of 212 sealed products, base 100 on Sep 8, 2025. Daily TCGplayer Market      |
| Prices, published for the previous UTC day. Methodology                                            |
+----------------------------------------------------------------------------------------------------+
| Index level (?)                  7D         30D        1Y         Constituents (?)   Coverage (?)   |
| 142.87  ▲ 0.4% 1D                ▼ 2.3%     ▲ 1.2%     ▲ 18.4%    212                97%            |
| as of the close of Oct 13, 2026 (UTC)                                                206 priced     |
+----------------------------------------------------------------------------------------------------+
| (!) Provisional: 136 of 212 constituents (64%) were priced on Oct 13, 2026, under the 80% a full    |
|     day needs. The level is published as computed and is not revised. How provisional days work    |  only when provisional
+----------------------------------------------------------------------------------------------------+
| Level history                                                                     [ 1Y |#All#]    |
|                                                                                                150 |
|  - - - - - - -.                                               __/\__    142.87 · Oct 13 *          |
|                '- - -._                      __/\____/\______/                                 125 |
|                        '--.___/\____/\__/\__/                                                     |
|                                                                                                100 |
|  Sep 2025     Nov 2025     Jan 2026     Mar 2026     May 2026     Jul 2026     Sep 2026            |
|  ── Daily level   - - Weekly points                                                                |
|  Weekly points before Mar 16, 2026: history from before daily collection was backfilled from       |
|  TCGplayer's weekly prices, so those points are a week apart.                                      |
+----------------------------------------------------------------------------------------------------+
| Breadth (7D) (?)                                                                                   |
| 94 of 212 constituents rose more than 0.5% over 7 days and 76 fell more than 0.5%.                 |
| [=========== gain ===========|====== neutral ======|========== loss ==========]                   |
| Advancers ▲ 94 44%   Unchanged 42 20%   Decliners ▼ 76 36%   New 52-week highs 11   New lows 0    |
+----------------------------------------------------------------------------------------------------+
| Sub-indices                                                                                        |
| By product type, generation and set, as of the close of Oct 13, 2026 (UTC). A set has an index ... |
| INDEX ↕                    GROUP          LEVEL ↕   1D ↕     7D ▼      30D ↕     1Y ↕    CONSTIT. ↕ |  40 px header
| Elite Trainer Box Index    Product type    131.20   ▲ 0.3%   ▲ 3.1%    ▲ 1.0%    ▲ 12.5%       58  |  44 px rows
| Crimson Tidal Index  (!) Provisional  Set  88.40   --       ▼ 4.2%    ▼ 0.8%    ▼ 8.1%         4   |
+----------------------------------------------------------------------------------------------------+
| Index levels are Pokéfin's derived data, free to reuse under CC BY 4.0 with credit to Pokéfin. ... |
```

Phone, 390 px:

```
+--------------------------------------+
| Pokéfin Sealed Index                 |
| Equal-weighted index of 212 sealed   |
| products, base 100 on Sep 8, 2025.   |
| ... previous UTC day. Methodology    |
| [Download levels (CSV)]              |
+--------------------------------------+
| Index level (?)                      |
| 142.87  ▲ 0.4% 1D                    |  32 px display
| as of the close of Oct 13, 2026 (UTC)|
| 7D              30D                  |
| ▼ 2.3%          ▲ 1.2%               |
| 1Y              Constituents (?)     |
| ▲ 18.4%         212                  |
| Coverage (?)                         |
| 97%  206 priced                      |
+--------------------------------------+
| (!) Provisional: ...                 |
+--------------------------------------+
| Level history          [ 1Y |#All#] |  44 px segments on touch
|  chart, 224 px tall             150  |
|                                 125  |
|  Nov 2025    Mar 2026    Jul 2026    |  every other month label
|  ── Daily level  - - Weekly points   |
+--------------------------------------+
| Breadth (7D) (?)                     |
| 94 of 212 constituents rose ...      |
| [===gain===|==neutral==|===loss===]  |
| Advancers ▲ 94 44%   Unchanged 42 20%|
| Decliners ▼ 76 36%   New 52-w highs 11|
| New 52-week lows 0                   |
+--------------------------------------+
| Sub-indices                          |
| [Grouped][7D][30D][1Y][Name]         |  44 px chips (links)
| Elite Trainer Box Index Product type |  56 px DataList rows
| 58 constituents       131.20 ▲ 3.1% 7D|
| Crimson Tidal Index  Set             |
| 4 constituents, provisional  88.40 ▼ 4.2% 7D|
+--------------------------------------+
```

States:

- **Loading** (`loading.tsx`, the route is dynamic): flat `Skeleton` bars for the header, the six stats, the chart box (same heights as the page, so nothing jumps) and the breadth card; `role="status"` sr-only "Loading the Sealed Index". No fake chart shape.
- **Not published** (no headline row yet, before the owner runs the backfill): `EmptyState` h2 "The Sealed Index is not published yet", description "Levels appear after the first nightly run. The rules are on the methodology page." with a link to `/methodology#index`.
- **Error** (a read failed; both readers return `null` uncached): `EmptyState` h2 "The index could not be loaded", description "This is usually temporary. Reload the page in a minute.", a secondary "Reload" link to the same URL.
- **Provisional day**: a `role="note"` block in the warn role under the stats: "Provisional: {n} of {N} constituents ({x}%) were priced on {date}, under the 80% a full day needs. The level is published as computed and is not revised. How provisional days work" (link to `/methodology#index-calculation`). Sub-index rows show a warn `Badge` "Provisional" (desktop) or ", provisional" in the meta line (phone).
- **Stale data** (the next day should be on the site and is not: from 06:00 UTC two days after the newest headline day, `isIndexOverdue(day)` with the request time; no false alarm in the hours after midnight while D-1 is being published): a second warn note "Not updated since {date}. The index is published each night for the previous day, and the latest run has not completed."
- **Short history**: a change without an anchor shows `--` with an sr-only reason ("Less than a year of levels"); a chart with fewer than 2 points shows the flat "No history" box.
- **Empty sub-index list**: `EmptyState` "No sub-index has a level for this day".

Interactions (all links, no client JavaScript):
- Range: `1Y` (default, the 365 days ending on the newest level) and `All`, as `?range=all`; the control is a `nav` "Chart range" of two links, the current one `aria-current="page"`, `scroll={false}` so the page does not jump. The x-domain is clamped to the data; the weekly segment is dashed and footnoted only when it is in range.
- Sort: desktop column headers are links (`?sort=level|1d|7d|30d|1y|constituents|name&dir=asc|desc`); clicking the sorted column flips it, another column starts descending (name ascending); `aria-sort` on the `th`, a visible ▲/▼ on the sorted column and a faint ↕ on the others, bold sorted header (WP23 table rules). Default order: product types in catalog order, then generations, then sets, each newest release first (`sort_order`), then name. Phones get chip links (Grouped, 7D, 30D, 1Y, Name) and the row's change follows the sorted window (7D by default). Missing values sort last in both directions.
- The canonical URL is `/indices/sealed` for every parameter combination.

Accessibility: one `h1`; sections labelled by their `h2` (Level and changes is sr-only); the SVG is `aria-hidden` and the `figcaption` carries an sr-only sentence with the range, first and last level, low and high; the CSV is the data alternative. Colour is never the only cue: `Delta` glyphs plus sr-only direction words, breadth counts in text beside the decorative bar. Touch targets 44 px on coarse pointers. No motion: the range and sort links change colour instantly (`01-PRODUCT-DIRECTION.md` §3.5 allows only opacity and transform transitions). The sub-index table scrolls inside its own box between 768 and 1024 px (the Group column is hidden below 1024 px), so the page never scrolls sideways.

Copy rules: "as of the close of {date} (UTC)", "Market Price", "TCGplayer", "Equal-weighted", never "live", "real-time", "all-time", "cap-weighted" or an em dash.

### Public contracts for later packages

- `getCachedIndexSummary(): Promise<IndexSummary[] | null>`, `getCachedIndexSeries(code): Promise<IndexPoint[] | null>` (`app/lib/serverMarketData.ts`); `currentSummaries`, `HEADLINE_INDEX_CODE`, `sliceIndexRange`, `INDEX_RULES`, `isIndexOverdue(day, now?)` (`app/lib/marketIndex.ts`; pass nothing or a `Date` for a request-time render, which waits for `INDEX_PUBLISH_GRACE_HOURS`; a `YYYY-MM-DD` key, as WP32 passes `utcTodayKey()`, keeps the day-granular rule: 2 or more days old); `buildIndexChart` (`app/lib/indexChart.ts`); `IndexChart` (`app/indices/sealed/IndexChart.tsx`, takes `points` and `title`).
- `GET /api/public/index/[code]`: ISR (`force-static`, `revalidate = 86400`, empty `generateStaticParams`), 200 `{ code, name, asOf, base: 100, weeklyUntil, d: ["YYYY-MM-DD"...], l: [level to 4 decimals...], p: [positions of provisional points] }` oldest first with `x-pokefin-generated-at`; 404 for a malformed or unknown code; 500 (never cached) when a read fails. Browser helper `fetchPublicIndexSeries(code)` in `app/lib/publicMarketApi.ts` (when WP26 has landed).
- `GET /indices/sealed/levels.csv`: headline levels and breadth, two leading `#` lines (licence, credit, as-of), header `date,level,resolution,provisional,constituents,contributing,coverage_pct,advancers_7d,decliners_7d,unchanged_7d,new_highs_52w,new_lows_52w`; `Content-Disposition: attachment; filename="pokefin-sealed-index.csv"`, `Link: <https://creativecommons.org/licenses/by/4.0/>; rel="license"`, CDN `s-maxage=3600`; 503 `no-store` when the read fails.

## Before you start

Read:
- `audits/remediation/01-PRODUCT-DIRECTION.md` §2, §3.4, §5 item 3, §6, §8 (migration registry); `research/data-opportunities.md` §2 (gates), §3.2, §3.7, §5; `research/trust-seo-brand.md` §4, §5.1, §9.
- WP25's `migrations/0038_product_daily_stats.sql` and `0039_fx_daily.sql` (the columns this package reads, the `refresh_market_analytics` entry point and the pg_cron block this package copies), `market_analytics.py`, `scripts/backfill_daily_stats.py`, `tests/test_wp25_market_analytics_db.py` (fixture style), `tests/test_wp25_scripts.py`, `tests/test_main.py` (WP25's `TestRunJobsOnceMarketAnalytics` and the `_no_market_analytics_refresh` fixture).
- WP21's `scraper_db.py` (`_execute`, dict rows), `scripts/db/replay_migrations.sh`, `verify_migration.py` (repo root).
- `frontend/app/lib/serverMarketData.ts` (WP11 cached exports, WP25's `fetchAllRows`, `getCachedProductStats` pattern), `frontend/app/lib/cacheTags.ts`, `frontend/app/lib/format.ts` (`splitDateKey`, `MONTHS_SHORT`, `formatPercent`), `frontend/app/lib/jsonLd.ts`, `frontend/app/lib/site.ts`, `frontend/app/content/methodology.ts`, `frontend/app/methodology/MethodologyArticle.tsx` and its test, `frontend/app/lib/metricDefinitions.ts` and its test, `frontend/app/components/ui/*` (WP23 props), `frontend/app/sitemap.ts` and `app/__tests__/sitemap.test.ts`, `frontend/perf-budgets.json`, `frontend/scripts/fixtures/perf.mjs`, `frontend/scripts/perf-fixture.test.mjs`. If present: `frontend/app/lib/publicRoute.ts`, `frontend/app/lib/publicMarketApi.ts`, `frontend/eslint.config.mjs` (`PUBLIC_ROUTE_CLIENT_FILES`), `frontend/app/components/nav/navConfig.ts` and `app/components/__tests__/Footer.test.tsx`.

Confirm the starting state (repo root):

```bash
# Migration number: 0042 is free (0041 may or may not exist: WP28 runs in parallel)
ls migrations | grep -E '^0042_'                                            # no output
ls migrations/0038_* migrations/0039_*                                      # WP25: 2 files

# WP21
ls migrations/0032_* migrations/0000_baseline.sql scripts/db/replay_migrations.sh scraper_db.py
# WP25
grep -n "def refresh_market_analytics" scraper_db.py                        # 1 line
grep -n "^def refresh_after_run\|^def open_admin_clients\|^def utc_today" market_analytics.py   # 3 lines
grep -n "^from market_analytics import refresh_after_run$" main.py          # 1 line
grep -n "refresh_after_run(pg_db=pg_db, supabase=supabase)" main.py        # 1 line
ls scripts/backfill_daily_stats.py tests/test_wp25_market_analytics_db.py tests/test_wp25_scripts.py
grep -n "_no_market_analytics_refresh" tests/test_main.py                  # 1 or more lines
grep -n "async function fetchAllRows" frontend/app/lib/serverMarketData.ts  # 1 line
grep -n 'anchor: "range-52w"' frontend/app/content/methodology.ts          # 1 line
# WP22
ls frontend/perf-budgets.json frontend/scripts/fixtures/perf.mjs frontend/scripts/perf-fixture.test.mjs
grep -n '"perf:budget"' frontend/package.json                               # 1 line
# WP23
ls frontend/app/components/ui/{Stat,Delta,Badge,DataList,EmptyState,Skeleton,PageHeader,ProvenanceLine,Button,icons}.tsx frontend/test-utils/axe.ts
grep -n "color-chart-line\|color-chart-grid\|color-chart-volume\|color-warn-fill" frontend/app/globals.css   # 4 lines
# WP24
grep -n 'anchor: "index", title: "Pokéfin Sealed Index"' frontend/app/content/methodology.ts            # 1 line
grep -n "The Pokéfin Sealed Index is not published yet" frontend/app/methodology/MethodologyArticle.tsx   # 1 line
grep -n "export function buildBreadcrumbJsonLd" frontend/app/lib/jsonLd.ts                              # 1 line
ls frontend/app/components/ui/MetricLabel.tsx
# WP07 and WP13
grep -n "^function splitDateKey\|^const MONTHS_SHORT" frontend/app/lib/format.ts                        # 2 lines
grep -n '{ path: "/analytics"' frontend/app/sitemap.ts                                                  # 1 line
grep -n "^export function absoluteUrl" frontend/app/lib/site.ts                                         # 1 line

# Soft dependencies (record the answers; the steps say what to do when missing)
ls frontend/app/lib/publicRoute.ts frontend/app/lib/publicMarketApi.ts 2>&1          # WP26
grep -n '"forbiddenChunks"' frontend/perf-budgets.json                              # WP26
grep -n "const PUBLIC_ROUTE_CLIENT_FILES" frontend/eslint.config.mjs                # WP26
ls frontend/app/components/nav/navConfig.ts 2>&1                                    # WP27
grep -n "METHODOLOGY_VERSION = " frontend/app/content/methodology.ts                # note the current version (1.1 after WP25, 1.2 if WP28 merged first)
```

If a hard-dependency check fails, stop and report which package is missing; this package extends those files and must not recreate them. Defaults for the soft ones:
- `app/lib/publicRoute.ts` missing (WP26 not merged): create it with exactly the content of WP26 step 6a, and apply WP26 step 7 (the `proxy.ts` matcher `"/api/((?!public/).*)"`) unless `grep -n '(?!public/)' frontend/proxy.ts` already prints a line. WP27 step 5 does the same; the files converge.
- `publicMarketApi.ts` missing: skip step 13 and say in the PR that WP31 adds `fetchPublicIndexSeries` with the code given there.
- `forbiddenChunks` or `PUBLIC_ROUTE_CLIENT_FILES` missing: skip steps 21c and 20; the page test's source guard (Tests, frontend item 6) is then the only zero-chart-JS gate, and the PR asks WP26 to add `/indices/sealed` to its rules.
- `navConfig.ts` missing (WP27 not merged): skip steps 23b and 23c and list the footer link (step 23b's code) in the PR's "Noticed, out of scope" line for the next package that edits `navConfig.ts` (WP32 or WP37).

Tooling: PostgreSQL 16 or 17 for the database tests (Docker `postgres:17` or `/usr/lib/postgresql/16/bin`), a Python venv with `requirements.txt` plus `pytest` and `psycopg[binary]` (WP21). The SQL in step 1 was applied twice in a row to a scratch database built from WP25's 0038 and 0039 on PostgreSQL 16.13, `verify_migration.py` reported 113 OK rows, and the 23 database tests in Tests item 1 passed twice in a row on the same database (re-validated by the review on a fresh PostgreSQL 16.13 cluster after the `already_published`, catch-up and sort-order changes; `verify_migration.py` hashes in step 2 are from that run).

Baseline (record the counts for the PR): from `frontend/`: `pnpm exec tsc --noEmit` (exit 0), `pnpm lint` (0 errors), `pnpm test --ci` (all pass), `pnpm run test:scripts`. From the repo root: `python -m pytest tests/ -q`.

The work has two phases, like WP25. **Phase A** (every step except step 24) needs nothing from the owner; at its end open a draft PR titled `[waiting for DB types] WP29: ...` and hand the owner Owner actions 1 to 4. **Phase B** (step 24) regenerates `frontend/app/types/database.ts` once 0042 is in production. In phase A `tsc` fails only on the two new `.from(...)` reads (`market_index_summary`, `market_index_daily`) in `serverMarketData.ts`; that is the only allowed failure.

## Implementation steps

### Step 1. `migrations/0042_market_index.sql` (new)

Create the file with exactly this content.

```sql
-- Migration: the Pokéfin Sealed Index family and market breadth (WP29;
-- research/data-opportunities.md sections 3.2 and 3.7).
--
-- Rules (published verbatim on /methodology#index; mirrored and drift-tested
-- by frontend/app/lib/marketIndex.ts):
--   * Equal-weighted, chain-linked daily, base 100, published for D-1 only.
--     L(t) = L(prev) * (1 + mean of the constituents' clipped returns on t).
--   * Constituents are frozen monthly from the product_daily_stats rows of
--     the newest day in the 7 days before the month: fresh price,
--     distinct_prices_365d >= 3, price >= 15 USD, the set released at least
--     90 days before the month, booster packs excluded. Every sub-index is a
--     subset of the headline's list. An index needs at least 3 constituents
--     in a month to publish that month.
--   * A return is clipped at +-50%. A price is carried for up to 3 days; a
--     constituent whose newest price is older than that drops out and
--     re-enters on the day after it is priced again, so a long gap never
--     produces a catch-up jump.
--   * A day is provisional when fewer than 80% of constituents contribute.
--   * Points before daily collection began (market_index_settings.daily_from)
--     are computed Monday to Monday (resolution 'weekly', Mondays only; a
--     price is carried up to 6 days).
--   * Survivorship: published days are never recomputed. A month's list
--     never changes once written. Products are not filtered by today's
--     products.active; a product counts on a day when it has a stats row.
--     product_daily_stats only holds products active when the day was
--     computed, so months rebuilt by the backfill miss products removed
--     before it ran (disclosed on /methodology#index-constituents).
--   * Breadth over the constituents with a fresh price on the day: 7-day
--     return above +0.5% (advancers), below -0.5% (decliners), within the
--     band (unchanged); 52-week highs and lows set in the last 7 days by
--     products tracked for at least 364 days.
--   * Equal weight is not market cap. It is never called cap-weighted.
--
-- Writes: refresh_market_index(p_day), SECURITY DEFINER, EXECUTE for
-- pokefin_scraper (0032) and service_role. It finalises the day's
-- product_daily_stats first when needed (refresh_market_analytics, 0038/0039),
-- so the order of the two nightly jobs cannot matter. pg_cron runs it at
-- 00:45 UTC for the previous UTC day, after WP25's 00:30 finalisation; the
-- scraper calls it after each run as a fallback (market_analytics.py).
--
-- Idempotent. Safe to re-run.
--
-- Verification:
--   SELECT public.market_index_backfill_range();
--   -- After the backfill, one headline row per day since daily_from and one
--   -- per Monday before it (expect 0):
--   SELECT count(*) FROM public.market_index_daily
--    WHERE index_code = 'sealed' AND resolution = 'weekly' AND extract(isodow FROM day) <> 1;
--   -- anon reads, cannot write or refresh (expect true, false):
--   SELECT has_table_privilege('anon', 'public.market_index_daily', 'SELECT'),
--          has_function_privilege('anon', 'public.refresh_market_index(date, boolean)', 'EXECUTE');

-- ============================================================
-- 1. Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.index_definitions (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  kind        text NOT NULL,
  filter      jsonb NOT NULL DEFAULT '{}'::jsonb,
  base_day    date,
  sort_order  integer NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT index_definitions_kind_check
    CHECK (kind IN ('headline', 'type', 'generation', 'set')),
  CONSTRAINT index_definitions_code_format
    CHECK (code ~ '^[a-z0-9][a-z0-9-]{0,39}$')
);

CREATE TABLE IF NOT EXISTS public.index_constituents (
  index_code  text NOT NULL REFERENCES public.index_definitions(code) ON DELETE CASCADE,
  month       date NOT NULL,
  product_id  bigint NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  CONSTRAINT index_constituents_pkey PRIMARY KEY (index_code, month, product_id),
  CONSTRAINT index_constituents_month_first
    CHECK (month = date_trunc('month', month)::date)
);

-- FK index (WP01 rule), and "which indices hold this product".
CREATE INDEX IF NOT EXISTS index_constituents_product_idx
  ON public.index_constituents (product_id);

CREATE TABLE IF NOT EXISTS public.market_index_daily (
  index_code      text NOT NULL REFERENCES public.index_definitions(code) ON DELETE CASCADE,
  day             date NOT NULL,
  level           numeric(14,6) NOT NULL,
  n_constituents  integer NOT NULL,
  n_contributing  integer NOT NULL,
  coverage_pct    numeric(4,1) NOT NULL,
  adv_7d          integer NOT NULL,
  dec_7d          integer NOT NULL,
  flat_7d         integer NOT NULL,
  new_high_52w    integer NOT NULL,
  new_low_52w     integer NOT NULL,
  provisional     boolean NOT NULL,
  resolution      text NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_index_daily_pkey PRIMARY KEY (index_code, day),
  CONSTRAINT market_index_daily_resolution_check CHECK (resolution IN ('daily', 'weekly')),
  CONSTRAINT market_index_daily_weekly_is_monday
    CHECK (resolution = 'daily' OR extract(isodow FROM day) = 1),
  CONSTRAINT market_index_daily_level_positive CHECK (level > 0),
  CONSTRAINT market_index_daily_coverage_range CHECK (coverage_pct BETWEEN 0 AND 100)
);

-- "Newest published day" (refresh_market_index) without a table scan.
CREATE INDEX IF NOT EXISTS market_index_daily_day_idx
  ON public.market_index_daily (day);

-- One row: the first day of daily resolution. Detected from price-row
-- timestamps on the first refresh (source 'detected'), or set by the owner
-- (source 'owner'), which the detection never overwrites.
CREATE TABLE IF NOT EXISTS public.market_index_settings (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  daily_from  date NOT NULL CHECK (extract(isodow FROM daily_from) = 1),
  source      text NOT NULL CHECK (source IN ('detected', 'owner')),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. Access: public read, no API writes
-- ============================================================

ALTER TABLE public.index_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.index_constituents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_index_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_index_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY index_definitions_read ON public.index_definitions
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY index_constituents_read ON public.index_constituents
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY market_index_daily_read ON public.market_index_daily
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY market_index_settings_read ON public.market_index_settings
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Supabase's default privileges give anon and authenticated ALL on new
-- tables, TRUNCATE included, which RLS does not stop. Keep SELECT only.
-- One table per statement: verify_migration.py parses them one at a time.
REVOKE ALL ON TABLE public.index_definitions FROM anon, authenticated;
REVOKE ALL ON TABLE public.index_constituents FROM anon, authenticated;
REVOKE ALL ON TABLE public.market_index_daily FROM anon, authenticated;
REVOKE ALL ON TABLE public.market_index_settings FROM anon, authenticated;
GRANT SELECT ON TABLE public.index_definitions TO anon, authenticated;
GRANT SELECT ON TABLE public.index_constituents TO anon, authenticated;
GRANT SELECT ON TABLE public.market_index_daily TO anon, authenticated;
GRANT SELECT ON TABLE public.market_index_settings TO anon, authenticated;

-- ============================================================
-- 3. The family: headline and product types (generations and sets are
--    added by freeze_market_index_month when they first qualify)
-- ============================================================

INSERT INTO public.index_definitions (code, name, kind, filter, sort_order) VALUES
  ('sealed',              'Pokéfin Sealed Index',     'headline', '{}'::jsonb, 0),
  ('type-booster-box',    'Booster Box Index',        'type', '{"type_patterns": ["booster box"]}'::jsonb, 10),
  ('type-etb',            'Elite Trainer Box Index',  'type', '{"type_patterns": ["elite trainer box"]}'::jsonb, 11),
  ('type-booster-bundle', 'Booster Bundle Index',     'type', '{"type_patterns": ["booster bundle"]}'::jsonb, 12),
  ('type-collections',    'Collections Index',        'type', '{"type_patterns": ["collection"]}'::jsonb, 13)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 4. Helpers (internal)
-- ============================================================

-- Product type text as the frontend matches it (ProductPrices sorting.ts):
-- name and label, lower case, "_" and "-" as spaces.
CREATE OR REPLACE FUNCTION public.market_index_type_text(p_name text, p_label text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT lower(regexp_replace(coalesce(p_name, '') || ' ' || coalesce(p_label, ''), '[_-]', ' ', 'g'))
$$;

-- First Monday of daily resolution. A backfilled price row is stamped at
-- exactly 12:00:00 (backfill_historical_prices.py); a scraped row carries the
-- scrape time. A day is "scraped" when at least half of its rows are not
-- stamped 12:00:00. Daily resolution starts on the Monday on or after the
-- first scraped day that follows the last run of 7 or more consecutive
-- non-scraped days (bucketed backfill). p_product_ids limits the scan (tests).
CREATE OR REPLACE FUNCTION public.market_index_detect_daily_from(p_product_ids bigint[] DEFAULT NULL)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_first date;
BEGIN
  WITH per_day AS (
    SELECT h.recorded_at::date AS day,
           count(*) FILTER (WHERE h.recorded_at::time <> time '12:00:00') AS scraped,
           count(*) AS total
      FROM public.product_price_history h
     WHERE p_product_ids IS NULL OR h.product_id = ANY (p_product_ids)
     GROUP BY 1
  ),
  bounds AS (
    SELECT min(day) AS first_day, max(day) AS last_day FROM per_day
  ),
  flagged AS (
    SELECT b.first_day + i AS day,
           COALESCE(pd.scraped * 2 >= pd.total, false) AS scraped
      FROM bounds b
     CROSS JOIN generate_series(0, b.last_day - b.first_day) AS i
      LEFT JOIN per_day pd ON pd.day = b.first_day + i
  ),
  runs AS (
    SELECT f.day, f.scraped,
           f.day - (row_number() OVER (PARTITION BY f.scraped ORDER BY f.day))::integer AS grp
      FROM flagged f
  ),
  last_backfill AS (
    SELECT max(r.run_end) AS day
      FROM (SELECT max(day) AS run_end, count(*) AS n
              FROM runs WHERE NOT scraped GROUP BY grp) r
     WHERE r.n >= 7
  )
  SELECT min(f.day) INTO v_first
    FROM flagged f
   CROSS JOIN last_backfill lb
   WHERE f.scraped
     AND (lb.day IS NULL OR f.day > lb.day);

  IF v_first IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_first + ((8 - extract(isodow FROM v_first)::integer) % 7);
END;
$$;

-- The stored first Monday of daily resolution; detects and stores it when
-- no row exists. Without any price history, every day is weekly for now
-- (returns the Monday on or after today, stores nothing).
CREATE OR REPLACE FUNCTION public.market_index_daily_from()
RETURNS date
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v date;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  SELECT s.daily_from INTO v FROM public.market_index_settings s WHERE s.id;
  IF v IS NOT NULL THEN
    RETURN v;
  END IF;
  v := public.market_index_detect_daily_from(NULL);
  IF v IS NULL THEN
    RETURN v_today + ((8 - extract(isodow FROM v_today)::integer) % 7);
  END IF;
  INSERT INTO public.market_index_settings (id, daily_from, source)
  VALUES (true, v, 'detected')
  ON CONFLICT (id) DO NOTHING;
  RETURN (SELECT s.daily_from FROM public.market_index_settings s WHERE s.id);
END;
$$;

-- Freeze one month's constituents for every index. No-op once the headline
-- has a list for the month, or when no stats row exists in the 7 days before
-- the month. Returns the number of constituent rows written.
CREATE OR REPLACE FUNCTION public.freeze_market_index_month(p_month date)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sel date;
  v_headline integer;
  v_rows integer;
BEGIN
  IF p_month IS NULL OR p_month <> date_trunc('month', p_month)::date THEN
    RAISE EXCEPTION 'freeze_market_index_month: p_month must be the first day of a month, got %', p_month
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.index_constituents c
              WHERE c.index_code = 'sealed' AND c.month = p_month) THEN
    RETURN 0;
  END IF;

  -- Selection day: the newest stats day in the 7 days before the month.
  SELECT max(s.day) INTO v_sel
    FROM public.product_daily_stats s
   WHERE s.day BETWEEN p_month - 7 AND p_month - 1;
  IF v_sel IS NULL THEN
    RETURN 0;
  END IF;

  -- Headline universe.
  INSERT INTO public.index_constituents (index_code, month, product_id)
  SELECT 'sealed', p_month, s.product_id
    FROM public.product_daily_stats s
    JOIN public.products p ON p.id = s.product_id
    JOIN public.sets st ON st.id = p.set_id
    LEFT JOIN public.product_types pt ON pt.id = p.product_type_id
   WHERE s.day = v_sel
     AND s.is_price_fresh
     AND s.usd_price >= 15
     AND s.distinct_prices_365d >= 3
     AND st.release_date IS NOT NULL
     AND st.release_date <= p_month - 90
     AND public.market_index_type_text(pt.name, pt.label) NOT LIKE '%booster pack%'
     AND public.market_index_type_text(pt.name, pt.label) NOT LIKE '%sleeved booster%'
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_headline = ROW_COUNT;

  IF v_headline < 3 THEN
    DELETE FROM public.index_constituents c
     WHERE c.index_code = 'sealed' AND c.month = p_month;
    RETURN 0;
  END IF;

  -- Generation and set indices, created the first month they qualify.
  -- sort_order puts the newest first within each kind: days from the
  -- (newest) set release to 2100-01-01, so a later release sorts earlier.
  INSERT INTO public.index_definitions (code, name, kind, filter, sort_order)
  SELECT 'gen-' || g.id, g.name || ' Index', 'generation',
         jsonb_build_object('generation_id', g.id), DATE '2100-01-01' - max(st.release_date)
    FROM public.index_constituents c
    JOIN public.products p ON p.id = c.product_id
    JOIN public.sets st ON st.id = p.set_id
    JOIN public.generations g ON g.id = st.generation_id
   WHERE c.index_code = 'sealed' AND c.month = p_month
     AND g.name IS NOT NULL
   GROUP BY g.id, g.name
  HAVING count(*) >= 3
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;

  INSERT INTO public.index_definitions (code, name, kind, filter, sort_order)
  SELECT 'set-' || st.id, st.name || ' Index', 'set',
         jsonb_build_object('set_id', st.id), DATE '2100-01-01' - st.release_date
    FROM public.index_constituents c
    JOIN public.products p ON p.id = c.product_id
    JOIN public.sets st ON st.id = p.set_id
   WHERE c.index_code = 'sealed' AND c.month = p_month
   GROUP BY st.id, st.name, st.release_date
  HAVING count(*) >= 3
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;

  -- Sub-index lists: the headline's constituents that match each filter,
  -- for indices with at least 3 matches.
  WITH members AS (
    SELECT d.code, c.product_id
      FROM public.index_definitions d
      JOIN public.index_constituents c ON c.index_code = 'sealed' AND c.month = p_month
      JOIN public.products p ON p.id = c.product_id
      LEFT JOIN public.sets st ON st.id = p.set_id
      LEFT JOIN public.product_types pt ON pt.id = p.product_type_id
     WHERE d.kind <> 'headline'
       AND CASE d.kind
             WHEN 'type' THEN EXISTS (
               SELECT 1
                 FROM jsonb_array_elements_text(COALESCE(d.filter -> 'type_patterns', '[]'::jsonb)) AS tp(pattern)
                WHERE public.market_index_type_text(pt.name, pt.label) LIKE '%' || tp.pattern || '%')
             WHEN 'generation' THEN st.generation_id = (d.filter ->> 'generation_id')::bigint
             WHEN 'set' THEN p.set_id = (d.filter ->> 'set_id')::bigint
             ELSE false
           END
  ),
  eligible AS (
    SELECT m.code FROM members m GROUP BY m.code HAVING count(*) >= 3
  )
  INSERT INTO public.index_constituents (index_code, month, product_id)
  SELECT m.code, p_month, m.product_id
    FROM members m
    JOIN eligible e ON e.code = m.code
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN v_headline + v_rows;
END;
$$;

-- One day for every index with constituents in the day's month. Weekly
-- segment: Mondays only, Monday-to-Monday returns. Returns rows written.
CREATE OR REPLACE FUNCTION public.refresh_market_index_day(p_day date, p_daily_from date)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month date := date_trunc('month', p_day)::date;
  v_weekly boolean := p_day <= p_daily_from;
  v_prev date;
  v_carry integer;
  v_rows integer;
BEGIN
  IF v_weekly AND extract(isodow FROM p_day) <> 1 THEN
    RETURN 0;
  END IF;
  -- 3 = daily carry, 6 = weekly carry (marketIndex.ts INDEX_RULES).
  v_prev := CASE WHEN v_weekly THEN p_day - 7 ELSE p_day - 1 END;
  v_carry := CASE WHEN v_weekly THEN 6 ELSE 3 END;

  PERFORM public.freeze_market_index_month(v_month);

  WITH members AS (
    SELECT c.index_code, c.product_id
      FROM public.index_constituents c
     WHERE c.month = v_month
  ),
  cur AS (
    SELECT s.product_id, s.is_price_fresh, s.ret_7d, s.high_52w, s.low_52w, s.first_tracked_day,
           CASE WHEN s.is_price_fresh AND s.usd_price > 0 AND s.price_day >= p_day - v_carry
                THEN s.usd_price::numeric END AS q
      FROM public.product_daily_stats s
     WHERE s.day = p_day
  ),
  prev AS (
    SELECT s.product_id,
           CASE WHEN s.is_price_fresh AND s.usd_price > 0 AND s.price_day >= v_prev - v_carry
                THEN s.usd_price::numeric END AS q
      FROM public.product_daily_stats s
     WHERE s.day = v_prev
  ),
  week_ago AS (
    SELECT s.product_id, s.high_52w, s.low_52w
      FROM public.product_daily_stats s
     WHERE s.day = p_day - 7
  ),
  per_member AS (
    SELECT m.index_code,
           c.q,
           CASE WHEN c.q IS NOT NULL AND pv.q IS NOT NULL
                -- +-50% clip (marketIndex.ts INDEX_RULES.returnClipPercent).
                THEN greatest(least(c.q / pv.q - 1, 0.5), -0.5) END AS r,
           CASE WHEN c.is_price_fresh THEN c.ret_7d END AS ret_7d,
           COALESCE(c.is_price_fresh AND c.first_tracked_day <= p_day - 364
                    AND c.high_52w > w.high_52w, false) AS new_high,
           COALESCE(c.is_price_fresh AND c.first_tracked_day <= p_day - 364
                    AND c.low_52w < w.low_52w, false) AS new_low
      FROM members m
      LEFT JOIN cur c ON c.product_id = m.product_id
      LEFT JOIN prev pv ON pv.product_id = m.product_id
      LEFT JOIN week_ago w ON w.product_id = m.product_id
  ),
  agg AS (
    SELECT pm.index_code,
           count(*)::integer AS n_constituents,
           count(pm.q)::integer AS n_priced,
           count(pm.r)::integer AS n_returns,
           COALESCE(avg(pm.r), 0) AS mean_r,
           -- 0.5 = breadth dead band in percent (INDEX_RULES.breadthFlatBandPct).
           count(*) FILTER (WHERE pm.ret_7d > 0.5)::integer AS adv_7d,
           count(*) FILTER (WHERE pm.ret_7d < -0.5)::integer AS dec_7d,
           count(*) FILTER (WHERE pm.ret_7d BETWEEN -0.5 AND 0.5)::integer AS flat_7d,
           count(*) FILTER (WHERE pm.new_high)::integer AS new_high_52w,
           count(*) FILTER (WHERE pm.new_low)::integer AS new_low_52w
      FROM per_member pm
     GROUP BY pm.index_code
  ),
  levels AS (
    SELECT a.*,
           pr.level AS prior_level,
           CASE WHEN pr.level IS NULL THEN a.n_priced ELSE a.n_returns END AS n_contributing
      FROM agg a
      LEFT JOIN LATERAL (
        SELECT d.level
          FROM public.market_index_daily d
         WHERE d.index_code = a.index_code
           AND d.day < p_day
         ORDER BY d.day DESC
         LIMIT 1
      ) pr ON true
  )
  INSERT INTO public.market_index_daily AS t (
    index_code, day, level, n_constituents, n_contributing, coverage_pct,
    adv_7d, dec_7d, flat_7d, new_high_52w, new_low_52w,
    provisional, resolution, computed_at
  )
  SELECT l.index_code, p_day,
         -- 100 = base level on an index's first day.
         CASE WHEN l.prior_level IS NULL THEN 100
              ELSE round(l.prior_level * (1 + l.mean_r), 6) END,
         l.n_constituents, l.n_contributing,
         round(100.0 * l.n_contributing / l.n_constituents, 1),
         l.adv_7d, l.dec_7d, l.flat_7d, l.new_high_52w, l.new_low_52w,
         -- 80 = provisional below this coverage (INDEX_RULES.provisionalBelowCoveragePct).
         100.0 * l.n_contributing / l.n_constituents < 80,
         CASE WHEN v_weekly THEN 'weekly' ELSE 'daily' END,
         now()
    FROM levels l
  ON CONFLICT (index_code, day) DO UPDATE SET
    level = EXCLUDED.level,
    n_constituents = EXCLUDED.n_constituents,
    n_contributing = EXCLUDED.n_contributing,
    coverage_pct = EXCLUDED.coverage_pct,
    adv_7d = EXCLUDED.adv_7d,
    dec_7d = EXCLUDED.dec_7d,
    flat_7d = EXCLUDED.flat_7d,
    new_high_52w = EXCLUDED.new_high_52w,
    new_low_52w = EXCLUDED.new_low_52w,
    provisional = EXCLUDED.provisional,
    resolution = EXCLUDED.resolution,
    computed_at = EXCLUDED.computed_at;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  UPDATE public.index_definitions d
     SET base_day = p_day
   WHERE d.base_day IS NULL
     AND EXISTS (SELECT 1 FROM public.market_index_daily x
                  WHERE x.index_code = d.code AND x.day = p_day);

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.market_index_type_text(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.market_index_detect_daily_from(bigint[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.market_index_daily_from() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.freeze_market_index_month(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_market_index_day(date, date) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 5. Entry points
-- ============================================================

-- Publish p_day (a finished UTC day) and any missing days before it, at most
-- 31 unless p_start. Status in the result:
--   ok                 the days from 'from' to 'day' were processed
--   not_initialised    no level exists yet and p_start is false: run
--                      scripts/backfill_market_index.py
--   behind             the newest level is more than 31 days before p_day
--                      and p_start is false: nothing written, run the backfill
--   already_published  p_day is on or before the newest level: nothing
--                      written (published days are never recomputed)
-- p_start is for scripts/backfill_market_index.py only: it may start the
-- chain, and it may cross a gap longer than 31 days (a month without a
-- constituent list writes no level, so a later month would otherwise stay
-- 'behind' for ever). pg_cron and the scraper never pass it.
CREATE OR REPLACE FUNCTION public.refresh_market_index(p_day date, p_start boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_last date;
  v_from date;
  v_daily_from date;
  v_day date;
  v_rows integer := 0;
BEGIN
  IF p_day IS NULL OR p_day >= v_today OR p_day < DATE '2020-01-01' THEN
    RAISE EXCEPTION 'refresh_market_index: p_day must be a finished UTC day between 2020-01-01 and %, got %',
      v_today - 1, p_day USING ERRCODE = '22023';
  END IF;

  -- One refresh at a time (the scraper, pg_cron and the backfill can overlap).
  PERFORM pg_advisory_xact_lock(hashtext('pokefin.refresh_market_index'));

  SELECT max(d.day) INTO v_last FROM public.market_index_daily d;

  IF v_last IS NULL AND NOT COALESCE(p_start, false) THEN
    RETURN jsonb_build_object('status', 'not_initialised', 'day', p_day);
  END IF;
  IF v_last IS NOT NULL AND p_day <= v_last THEN
    RETURN jsonb_build_object('status', 'already_published', 'day', p_day, 'last_day', v_last);
  END IF;
  -- 31 = INDEX_RULES.maxCatchUpDays.
  IF v_last IS NOT NULL AND NOT COALESCE(p_start, false) AND v_last < p_day - 31 THEN
    RETURN jsonb_build_object('status', 'behind', 'day', p_day, 'last_day', v_last);
  END IF;

  v_from := CASE WHEN v_last IS NULL THEN p_day ELSE v_last + 1 END;
  v_daily_from := public.market_index_daily_from();

  FOR v_day IN SELECT v_from + i FROM generate_series(0, p_day - v_from) AS i LOOP
    IF v_day <= v_daily_from AND extract(isodow FROM v_day) <> 1 THEN
      CONTINUE;
    END IF;
    -- The day's stats must be final (written after the day ended), so a
    -- live run and a clean backfill read the same rows.
    IF NOT EXISTS (SELECT 1 FROM public.product_daily_stats s WHERE s.day = v_day)
       OR EXISTS (SELECT 1 FROM public.product_daily_stats s
                   WHERE s.day = v_day
                     AND s.refreshed_at < ((v_day + 1)::timestamp AT TIME ZONE 'UTC')) THEN
      PERFORM public.refresh_market_analytics(v_day);
    END IF;
    v_rows := v_rows + public.refresh_market_index_day(v_day, v_daily_from);
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'ok',
    'from', v_from,
    'day', p_day,
    'rows', v_rows,
    'daily_from', v_daily_from,
    'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_market_index(date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_market_index(date, boolean) TO service_role, pokefin_scraper;

-- What the backfill script needs to plan, without table privileges.
CREATE OR REPLACE FUNCTION public.market_index_backfill_range()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'first_stats_day', (SELECT min(s.day) FROM public.product_daily_stats s),
    'last_stats_day',  (SELECT max(s.day) FROM public.product_daily_stats s),
    'first_index_day', (SELECT min(d.day) FROM public.market_index_daily d),
    'last_index_day',  (SELECT max(d.day) FROM public.market_index_daily d),
    'daily_from',      (SELECT st.daily_from FROM public.market_index_settings st WHERE st.id)
  )
$$;

REVOKE ALL ON FUNCTION public.market_index_backfill_range() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_index_backfill_range() TO service_role, pokefin_scraper;

-- Owner-only rebuild: removes every level and constituent list and a
-- detected daily_from (an owner-set one is kept), then the backfill script
-- rebuilds from the start of history. Not granted to the scraper.
CREATE OR REPLACE FUNCTION public.reset_market_index()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_levels integer;
  v_members integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('pokefin.refresh_market_index'));
  DELETE FROM public.market_index_daily;
  GET DIAGNOSTICS v_levels = ROW_COUNT;
  DELETE FROM public.index_constituents;
  GET DIAGNOSTICS v_members = ROW_COUNT;
  DELETE FROM public.index_definitions WHERE kind IN ('generation', 'set');
  UPDATE public.index_definitions SET base_day = NULL;
  DELETE FROM public.market_index_settings WHERE source = 'detected';
  RETURN jsonb_build_object('levels_deleted', v_levels, 'constituents_deleted', v_members);
END;
$$;

REVOKE ALL ON FUNCTION public.reset_market_index() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_market_index() TO service_role;

-- ============================================================
-- 6. Latest level and changes per index (server reads)
-- ============================================================

-- Changes use the newest level on or before (day - window) and no older than
-- (day - window - tolerance): 7D and 30D 7 days, 1Y 14 days
-- (marketIndex.ts INDEX_CHANGE_WINDOWS). 1D needs the previous calendar day.
-- Every lookup is a primary-key range scan: about 5 per index.
CREATE OR REPLACE VIEW public.market_index_summary
WITH (security_invoker = true)
AS
SELECT d.code, d.name, d.kind, d.sort_order, d.base_day,
       l.day, l.level, l.n_constituents, l.n_contributing, l.coverage_pct,
       l.adv_7d, l.dec_7d, l.flat_7d, l.new_high_52w, l.new_low_52w,
       l.provisional, l.resolution,
       CASE WHEN p1.day = l.day - 1
            THEN ((l.level / p1.level - 1) * 100)::double precision END AS chg_1d,
       ((l.level / a7.level - 1) * 100)::double precision AS chg_7d,
       ((l.level / a30.level - 1) * 100)::double precision AS chg_30d,
       ((l.level / a365.level - 1) * 100)::double precision AS chg_365d
  FROM public.index_definitions d
  JOIN LATERAL (
    SELECT x.* FROM public.market_index_daily x
     WHERE x.index_code = d.code ORDER BY x.day DESC LIMIT 1
  ) l ON true
  LEFT JOIN LATERAL (
    SELECT x.day, x.level FROM public.market_index_daily x
     WHERE x.index_code = d.code AND x.day < l.day ORDER BY x.day DESC LIMIT 1
  ) p1 ON true
  LEFT JOIN LATERAL (
    SELECT x.level FROM public.market_index_daily x
     WHERE x.index_code = d.code AND x.day <= l.day - 7 AND x.day >= l.day - 7 - 7
     ORDER BY x.day DESC LIMIT 1
  ) a7 ON true
  LEFT JOIN LATERAL (
    SELECT x.level FROM public.market_index_daily x
     WHERE x.index_code = d.code AND x.day <= l.day - 30 AND x.day >= l.day - 30 - 7
     ORDER BY x.day DESC LIMIT 1
  ) a30 ON true
  LEFT JOIN LATERAL (
    SELECT x.level FROM public.market_index_daily x
     WHERE x.index_code = d.code AND x.day <= l.day - 365 AND x.day >= l.day - 365 - 14
     ORDER BY x.day DESC LIMIT 1
  ) a365 ON true;

REVOKE ALL ON TABLE public.market_index_summary FROM anon, authenticated;
GRANT SELECT ON TABLE public.market_index_summary TO anon, authenticated;

-- ============================================================
-- 7. Nightly publication of D-1 (pg_cron, when the owner has enabled it)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- cron.schedule upserts by job name (pg_cron 1.4+): one job on re-run.
    PERFORM cron.schedule(
      'pokefin-publish-market-index',
      '45 0 * * *',
      $cmd$SELECT public.refresh_market_index((now() AT TIME ZONE 'UTC')::date - 1)$cmd$
    );
    RAISE NOTICE 'pg_cron job pokefin-publish-market-index scheduled at 00:45 UTC';
  ELSE
    RAISE NOTICE 'pg_cron is not enabled. After enabling it (Dashboard > Database > Extensions), run: SELECT cron.schedule(''pokefin-publish-market-index'', ''45 0 * * *'', $cmd$SELECT public.refresh_market_index((now() AT TIME ZONE ''UTC'')::date - 1)$cmd$);';
  END IF;
END $$;
```

### Step 2. Check the migration

```bash
python3 verify_migration.py migrations/0042_market_index.sql > /tmp/wp29_0042.sql; echo "exit=$?"
# expect exit=3 and on stderr:
#   8 "-- function" lines; with the file copied verbatim the bodies hash to
#     market_index_type_text 4c3d27288d08fbe1d6b9b0b6450e4c23 (sql, immutable, invoker)
#     market_index_detect_daily_from b3ab4c85766b77c846f523d3a03de7c5 (plpgsql, stable, invoker)
#     market_index_daily_from ee989e75349d536052da945ef331f378 (invoker)
#     freeze_market_index_month 1124df902cf7a8aaad72b19a54a390ca (invoker)
#     refresh_market_index_day 5dde64d32156a6d9c36243e67230b41a (invoker)
#     refresh_market_index 34c5c01d18fb769cbda054fd653c3201 (security definer)
#     market_index_backfill_range 5b8f2847cd07bc678bd696b745d5f5e0 (sql, stable, security definer)
#     reset_market_index e4cf650f2018745d16fae70ffd0f0eb5 (security definer)
#     every one with "config search_path=public,pg_temp"
#   2 "-- index" lines (index_constituents_product_idx, market_index_daily_day_idx)
#   99 "-- privilege" lines, 4 "-- rls ...: enabled" lines
#   -- NOT VERIFIED (out of scope, check by hand): 4 x CREATE (table/type/etc), 1 x CREATE VIEW, 5 x DO block, 1 x data statement
```

A `! REFUSED unparsed privilege statement` line means a GRANT or REVOKE names several tables: keep one table per statement as written.

Replay locally with WP21's harness (it picks the file up by name; no edit needed):

```bash
PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh
# expect "OK: <N> files replayed once (replay_once) and twice (replay_twice)", N one more than before,
# and the NOTICE "pg_cron is not enabled. ... pokefin-publish-market-index ..." three times.
psql postgresql://postgres:postgres@localhost:55432/replay_twice -At -f /tmp/wp29_0042.sql | cut -d'|' -f4 | sort | uniq -c
# expect: 113 OK (no MISSING or MISMATCH)
```

### Step 3. `scraper_db.py`: two methods for the scraper role

Add directly after WP25's `refresh_market_analytics` method in `class ScraperDB` (same indentation):

```python
    def refresh_market_index(self, day: date, start: bool = False) -> dict:
        """
        public.refresh_market_index(day, start) (migration 0042). EXECUTE is
        granted to pokefin_scraper; the function is SECURITY DEFINER, so the
        role needs no privilege on the index tables. Returns its summary:
        {"status", "day", ...}.
        """
        rows = self._execute(
            "SELECT public.refresh_market_index(%s::date, %s) AS result",
            (day.isoformat(), bool(start)),
            fetch=True,
        )
        return (rows[0]["result"] if rows else None) or {}

    def market_index_backfill_range(self) -> dict:
        """public.market_index_backfill_range(): first and last stats and index days, daily_from."""
        rows = self._execute(
            "SELECT public.market_index_backfill_range() AS result",
            fetch=True,
        )
        return (rows[0]["result"] if rows else None) or {}
```

`date` is already imported by WP25's step 3a. Both statements are idempotent, so `_execute`'s single retry is safe.

### Step 4. `market_analytics.py`: the index calls

4a. Change the import line `from datetime import date, datetime, timezone` to `from datetime import date, datetime, timedelta, timezone`.

4b. Append at the end of the file:

```python
# ---------------------------------------------------------------- WP29 index

INDEX_RPC_NAME = "refresh_market_index"
INDEX_RANGE_RPC_NAME = "market_index_backfill_range"


def utc_yesterday() -> date:
    return utc_today() - timedelta(days=1)


def call_index_refresh(day: date, *, start: bool = False, pg_db=None, supabase=None) -> dict:
    """
    Run public.refresh_market_index(day, start) once (migration 0042) and
    return its summary ({"status", "day", ...}). Raises on any failure.
    """
    if pg_db is not None:
        return pg_db.refresh_market_index(day, start=start) or {}
    if supabase is not None:
        response = supabase.rpc(INDEX_RPC_NAME, {"p_day": day.isoformat(), "p_start": start}).execute()
        return response.data or {}
    raise RuntimeError("no database client: pass pg_db or supabase")


def fetch_index_backfill_range(*, pg_db=None, supabase=None) -> dict:
    """public.market_index_backfill_range(): first and last stats and index days, daily_from."""
    if pg_db is not None:
        return pg_db.market_index_backfill_range() or {}
    if supabase is not None:
        return supabase.rpc(INDEX_RANGE_RPC_NAME, {}).execute().data or {}
    raise RuntimeError("no database client: pass pg_db or supabase")


def _is_missing_rpc(error: Exception, name: str) -> bool:
    text = str(error)
    return name in text and (
        "does not exist" in text or "PGRST202" in text or "Could not find the function" in text
    )


def refresh_index_after_run(day: date | None = None, *, pg_db=None, supabase=None) -> dict | None:
    """
    Publish the Sealed Index for the previous UTC day (and any missing days
    up to 31 back) after a scraper run. pg_cron does the same at 00:45 UTC;
    this is the fallback when pg_cron is off. Returns the summary, or None
    when it failed. Never raises.
    """
    day = day or utc_yesterday()
    try:
        result = call_index_refresh(day, pg_db=pg_db, supabase=supabase)
    except Exception as e:  # noqa: BLE001 - the index must never fail the run
        if _is_missing_rpc(e, INDEX_RPC_NAME):
            logger.warning(
                "Sealed Index refresh skipped: public.refresh_market_index does not exist yet "
                "(apply migration 0042)."
            )
        else:
            logger.error(f"Sealed Index refresh failed for {day}: {type(e).__name__}: {e}")
        return None
    status = result.get("status")
    if status in ("not_initialised", "behind"):
        logger.warning(
            f"Sealed Index not published for {day} ({status}): run scripts/backfill_market_index.py."
        )
    elif status == "already_published":
        # The normal case for every run after the first one of the UTC day.
        logger.info(f"Sealed Index already published through {result.get('last_day')}.")
    else:
        logger.info(f"Sealed Index refreshed for {day}: {result}")
    return result
```

Do not change WP25's `refresh_after_run`, `call_refresh` or `_is_missing_function`.

### Step 5. `main.py`: publish yesterday's index after the analytics refresh

5a. Replace the import line `from market_analytics import refresh_after_run` with:

```python
from market_analytics import refresh_after_run, refresh_index_after_run
```

5b. In `run_jobs_once()`, replace WP25's block

```python
    if prices_ok:
        refresh_after_run(pg_db=pg_db, supabase=supabase)
```

with

```python
    if prices_ok:
        refresh_after_run(pg_db=pg_db, supabase=supabase)
        # WP29: publish the previous UTC day's Sealed Index (and any missing
        # days up to 31 back). pg_cron does the same at 00:45 UTC; this covers
        # pg_cron being off and gets the level onto the site with this run's
        # revalidation. Never raises.
        refresh_index_after_run(pg_db=pg_db, supabase=supabase)
```

Keep WP25's comment above the block. If WP21's `pg_db` global does not exist, pass `pg_db=None` as WP25 does.

### Step 6. `scripts/backfill_market_index.py` (new)

`chmod +x` it.

```python
#!/usr/bin/env python3
"""
Build the Pokéfin Sealed Index family (market_index_daily) from the start of
product_daily_stats history by calling public.refresh_market_index(day) once
per day, oldest first (WP29, migration 0042).

Run it once after applying 0042, after WP25's scripts/backfill_daily_stats.py
has filled product_daily_stats. Every call passes p_start = true, which lets
the first day that has a constituent list start the chain (base 100) and lets
a call cross a gap longer than 31 days (a month that got no constituent list
writes no level, and the nightly call then reports 'behind' until this script
runs). pg_cron and the scraper never pass it, so they only extend a chain
this script started, at most 31 days at a time.

  python scripts/backfill_market_index.py                 # from the first stats day (or the day after the newest level) to yesterday (UTC)
  python scripts/backfill_market_index.py --end 2026-03-31
  python scripts/backfill_market_index.py --dry-run       # print the plan, call nothing

Published days are never recomputed. To rebuild after a rule change, first
run in the Supabase SQL editor:

  SELECT public.reset_market_index();

then run this script again.

Stops at the first failed day and prints the command to resume.
Connects as pokefin_scraper when POKEFIN_SCRAPER_DATABASE_URL is set,
otherwise with the service key.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

PROGRESS_EVERY = 25


def parse_args(argv=None, *, today: date | None = None):
    today = today or datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--end", type=date.fromisoformat, default=yesterday)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if args.end > yesterday:
        parser.error(f"--end must be a finished UTC day (at most {yesterday})")
    return args


def plan(range_info: dict, end: date) -> tuple[date | None, str]:
    """(first day to call, message). None means there is nothing to do."""
    first_stats = range_info.get("first_stats_day")
    last_index = range_info.get("last_index_day")
    if last_index:
        start = date.fromisoformat(str(last_index)) + timedelta(days=1)
        if start > end:
            return None, f"Nothing to do: levels already published through {last_index}."
        return start, f"Extending the published chain from {start} to {end}."
    if not first_stats:
        return None, "Nothing to do: product_daily_stats is empty. Run scripts/backfill_daily_stats.py first."
    start = date.fromisoformat(str(first_stats))
    if start > end:
        return None, f"Nothing to do: the first stats day {start} is after --end {end}."
    return start, f"Building the chain from the first stats day, {start}, through {end}."


def main(argv=None, *, clients=None, call=None, fetch_range=None, today: date | None = None) -> int:
    args = parse_args(argv, today=today)
    from market_analytics import call_index_refresh, fetch_index_backfill_range, open_admin_clients

    call = call or call_index_refresh
    fetch_range = fetch_range or fetch_index_backfill_range
    pg_db, supabase = clients if clients is not None else open_admin_clients()
    started = time.monotonic()
    try:
        range_info = fetch_range(pg_db=pg_db, supabase=supabase)
        first, message = plan(range_info, args.end)
        print(message)
        if first is None:
            return 0
        days = [first + timedelta(days=i) for i in range((args.end - first).days + 1)]
        print(f"{len(days)} calls, oldest first (weekly-segment days other than Mondays return 0 rows).")
        if args.dry_run:
            print("Dry run: nothing called.")
            return 0
        counts: dict[str, int] = {}
        for n, day in enumerate(days, start=1):
            try:
                result = call(day, start=True, pg_db=pg_db, supabase=supabase)
            except Exception as e:  # noqa: BLE001 - report and stop
                print(f"FAILED on {day}: {type(e).__name__}: {e}", file=sys.stderr)
                print(f"Resume with: python scripts/backfill_market_index.py --end {args.end.isoformat()}",
                      file=sys.stderr)
                return 1
            status = (result or {}).get("status", "unknown")
            counts[status] = counts.get(status, 0) + 1
            if status in ("not_initialised", "behind"):
                print(f"STOPPED on {day}: status {status}: {result}", file=sys.stderr)
                return 1
            if n % PROGRESS_EVERY == 0 or n == len(days):
                print(f"  {n}/{len(days)} {day}: {result}")
    finally:
        if pg_db is not None:
            pg_db.close()
    summary = ", ".join(f"{k} {v}" for k, v in sorted(counts.items()))
    print(f"Done in {time.monotonic() - started:.0f} s ({summary}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### Step 7. `frontend/app/lib/format.ts`: two formatters

Add below `formatMonthDay` (WP07):

```ts
/** "2026-09-26" -> "Sep 2026". Chart month ticks. Fallback for empty or malformed input. */
export function formatMonthYear(value: string | null | undefined, fallback = ""): string {
  if (!value) return fallback;
  const parts = splitDateKey(value);
  if (!parts) return fallback;
  const [year, month] = parts;
  return `${MONTHS_SHORT[month - 1]} ${year}`;
}
```

and below `formatInteger`:

```ts
const DECIMAL_FORMATS = new Map<number, Intl.NumberFormat>();

/**
 * 1234.5 -> "1,234.50" with a fixed number of decimals. Index levels and
 * other unitless figures; money goes through formatMoney.
 */
export function formatDecimal(value: number | null | undefined, decimals = 2, missing = "--"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return missing;
  let format = DECIMAL_FORMATS.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    DECIMAL_FORMATS.set(decimals, format);
  }
  return format.format(value);
}
```

If WP07 named the helpers differently (`grep -n "^function splitDateKey\|^const MONTHS_SHORT" app/lib/format.ts` prints nothing), reuse whatever `formatDateOnly` uses to split the key and name the month.

### Step 8. `frontend/app/lib/marketIndex.ts` (new)

```ts
/**
 * The Pokéfin Sealed Index family (migration 0042): the TypeScript side (WP29).
 *
 * INDEX_RULES, INDEX_EXCLUDED_TYPE_PATTERNS and INDEX_CHANGE_WINDOWS mirror
 * literals in freeze_market_index_month, refresh_market_index_day,
 * refresh_market_index and the market_index_summary view.
 * marketIndexConstants.test.ts drift-tests them against the SQL, so
 * /methodology#index prints what the database computes. Change both together
 * and bump METHODOLOGY_VERSION.
 *
 * Isomorphic: no React, no Supabase, no format.ts (the public route and the
 * CSV import it).
 */

export const HEADLINE_INDEX_CODE = "sealed";
export const HEADLINE_INDEX_NAME = "Pokéfin Sealed Index";
export const INDEX_BASE_LEVEL = 100;
export const INDEX_PAGE_PATH = "/indices/sealed";
export const INDEX_CSV_PATH = "/indices/sealed/levels.csv";
export const INDEX_CSV_FILENAME = "pokefin-sealed-index.csv";
export const INDEX_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
export const INDEX_LICENSE_NAME = "CC BY 4.0";

export const INDEX_RULES = {
  /** Constituent screen, on the selection day (the newest stats day in the 7 days before the month). */
  minPriceUsd: 15,
  minDistinctPrices365d: 3,
  minDaysSinceRelease: 90,
  selectionLookbackDays: 7,
  /** An index publishes a month only with at least this many constituents. */
  minConstituents: 3,
  /** A price is carried this many days before the constituent drops out. */
  dailyCarryMaxDays: 3,
  weeklyCarryMaxDays: 6,
  /** Each daily (or weekly) return is clipped to plus or minus this percent. */
  returnClipPercent: 50,
  /** A day is provisional when fewer than this percent of constituents contribute. */
  provisionalBelowCoveragePct: 80,
  /** Breadth: 7-day returns within plus or minus this percent count as unchanged. */
  breadthFlatBandPct: 0.5,
  /** New 52-week highs and lows count only products tracked this long. */
  newHighMinTrackedDays: 364,
  /** The nightly job fills at most this many missing days; beyond it, run the backfill. */
  maxCatchUpDays: 31,
} as const;

/**
 * The product-type indices seeded by 0042 (code, name and the pattern matched
 * against the product type's name and label, lower case, "_" and "-" as spaces).
 */
export const INDEX_TYPE_FAMILY = [
  { code: "type-booster-box", name: "Booster Box Index", label: "Booster Box", pattern: "booster box" },
  { code: "type-etb", name: "Elite Trainer Box Index", label: "Elite Trainer Box", pattern: "elite trainer box" },
  { code: "type-booster-bundle", name: "Booster Bundle Index", label: "Booster Bundle", pattern: "booster bundle" },
  { code: "type-collections", name: "Collections Index", label: "Collections", pattern: "collection" },
] as const;

/** Product types never in any index (matched on type name and label, lower case). */
export const INDEX_EXCLUDED_TYPE_PATTERNS = ["booster pack", "sleeved booster"] as const;

/**
 * Change windows of market_index_summary: the newest level on or before
 * (day - days) and no older than (day - days - toleranceDays). 1D needs the
 * previous calendar day.
 */
export const INDEX_CHANGE_WINDOWS = [
  { key: "chg1d", column: "chg_1d", label: "1D", days: 1, toleranceDays: 0 },
  { key: "chg7d", column: "chg_7d", label: "7D", days: 7, toleranceDays: 7 },
  { key: "chg30d", column: "chg_30d", label: "30D", days: 30, toleranceDays: 7 },
  { key: "chg365d", column: "chg_365d", label: "1Y", days: 365, toleranceDays: 14 },
] as const;
export type IndexChangeKey = (typeof INDEX_CHANGE_WINDOWS)[number]["key"];

export type IndexKind = "headline" | "type" | "generation" | "set";
export const INDEX_KIND_LABELS: Readonly<Record<IndexKind, string>> = {
  headline: "Headline",
  type: "Product type",
  generation: "Generation",
  set: "Set",
};
const KIND_ORDER: Readonly<Record<IndexKind, number>> = { headline: 0, type: 1, generation: 2, set: 3 };

export const INDEX_CODE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function isIndexCode(value: unknown): value is string {
  return typeof value === "string" && INDEX_CODE_RE.test(value);
}

// ------------------------------------------------------------------ rows

/** One market_index_summary row as the page uses it. Percent units (1.2 means +1.2%). */
export interface IndexSummary {
  code: string;
  name: string;
  kind: IndexKind;
  sortOrder: number;
  baseDay: string | null;
  /** The UTC day the level describes (the close of that day). */
  day: string;
  level: number;
  nConstituents: number;
  nContributing: number;
  coveragePct: number;
  adv7d: number;
  dec7d: number;
  flat7d: number;
  newHigh52w: number;
  newLow52w: number;
  provisional: boolean;
  weekly: boolean;
  chg1d: number | null;
  chg7d: number | null;
  chg30d: number | null;
  chg365d: number | null;
}

/** A market_index_summary row as PostgREST returns it (view columns are nullable). */
export interface IndexSummaryRow {
  code: string | null;
  name: string | null;
  kind: string | null;
  sort_order: number | null;
  base_day: string | null;
  day: string | null;
  level: number | string | null;
  n_constituents: number | null;
  n_contributing: number | null;
  coverage_pct: number | string | null;
  adv_7d: number | null;
  dec_7d: number | null;
  flat_7d: number | null;
  new_high_52w: number | null;
  new_low_52w: number | null;
  provisional: boolean | null;
  resolution: string | null;
  chg_1d: number | null;
  chg_7d: number | null;
  chg_30d: number | null;
  chg_365d: number | null;
}

/** One published level, oldest first in a series. */
export interface IndexPoint {
  day: string;
  level: number;
  provisional: boolean;
  weekly: boolean;
  nConstituents: number;
  nContributing: number;
  coveragePct: number;
  adv7d: number;
  dec7d: number;
  flat7d: number;
  newHigh52w: number;
  newLow52w: number;
}

/** A market_index_daily row as PostgREST returns it. */
export interface IndexDailyRow {
  day: string | null;
  level: number | string | null;
  provisional: boolean | null;
  resolution: string | null;
  n_constituents: number | null;
  n_contributing: number | null;
  coverage_pct: number | string | null;
  adv_7d: number | null;
  dec_7d: number | null;
  flat_7d: number | null;
  new_high_52w: number | null;
  new_low_52w: number | null;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: readonly IndexKind[] = ["headline", "type", "generation", "set"];

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function toIndexSummaries(rows: readonly IndexSummaryRow[]): IndexSummary[] {
  const out: IndexSummary[] = [];
  for (const row of rows) {
    const level = num(row?.level);
    if (
      !row ||
      !isIndexCode(row.code) ||
      typeof row.name !== "string" ||
      !KINDS.includes(row.kind as IndexKind) ||
      typeof row.day !== "string" ||
      !DATE_KEY_RE.test(row.day) ||
      level === null ||
      level <= 0
    ) {
      continue;
    }
    out.push({
      code: row.code,
      name: row.name,
      kind: row.kind as IndexKind,
      sortOrder: count(row.sort_order),
      baseDay: typeof row.base_day === "string" ? row.base_day : null,
      day: row.day,
      level,
      nConstituents: count(row.n_constituents),
      nContributing: count(row.n_contributing),
      coveragePct: num(row.coverage_pct) ?? 0,
      adv7d: count(row.adv_7d),
      dec7d: count(row.dec_7d),
      flat7d: count(row.flat_7d),
      newHigh52w: count(row.new_high_52w),
      newLow52w: count(row.new_low_52w),
      provisional: row.provisional === true,
      weekly: row.resolution === "weekly",
      chg1d: num(row.chg_1d),
      chg7d: num(row.chg_7d),
      chg30d: num(row.chg_30d),
      chg365d: num(row.chg_365d),
    });
  }
  return out;
}

export function toIndexPoints(rows: readonly IndexDailyRow[]): IndexPoint[] {
  const byDay = new Map<string, IndexPoint>();
  for (const row of rows) {
    const level = num(row?.level);
    if (!row || typeof row.day !== "string" || !DATE_KEY_RE.test(row.day) || level === null || level <= 0) {
      continue;
    }
    byDay.set(row.day, {
      day: row.day,
      level,
      provisional: row.provisional === true,
      weekly: row.resolution === "weekly",
      nConstituents: count(row.n_constituents),
      nContributing: count(row.n_contributing),
      coveragePct: num(row.coverage_pct) ?? 0,
      adv7d: count(row.adv_7d),
      dec7d: count(row.dec_7d),
      flat7d: count(row.flat_7d),
      newHigh52w: count(row.new_high_52w),
      newLow52w: count(row.new_low_52w),
    });
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

// ------------------------------------------------------------------ dates

const DAY_MS = 86_400_000;

export function dayKeyToMs(key: string): number {
  return Date.parse(`${key}T00:00:00Z`);
}

export function addDaysToKey(key: string, days: number): string {
  return new Date(dayKeyToMs(key) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetweenKeys(from: string, to: string): number {
  return Math.round((dayKeyToMs(to) - dayKeyToMs(from)) / DAY_MS);
}

/** Today (UTC) as YYYY-MM-DD. */
export function utcTodayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Hours after 00:00 UTC by which D-1 is normally on the site: pg_cron
 * publishes at 00:45 UTC and the index reads refresh hourly
 * (INDEX_REFRESH_SECONDS in serverMarketData.ts); without pg_cron, the first
 * scraper run after midnight publishes it, at most 4 hours later.
 */
export const INDEX_PUBLISH_GRACE_HOURS = 6;
const HOUR_MS = 3_600_000;

/**
 * The index publishes D-1 each night. With a Date (the default: request-time
 * renders such as /indices/sealed), a day is overdue from 06:00 UTC two days
 * after it, when the next day should already be on the site; so the hours
 * after midnight, while D-1 is being published, never raise a false alarm.
 * With a YYYY-MM-DD key (WP32's ISR header passes utcTodayKey()), the rule is
 * day-granular: overdue when the day is 2 or more days before the key.
 */
export function isIndexOverdue(day: string, now: string | Date = new Date()): boolean {
  if (typeof now === "string") return daysBetweenKeys(day, now) >= 2;
  return now.getTime() >= dayKeyToMs(day) + 2 * DAY_MS + INDEX_PUBLISH_GRACE_HOURS * HOUR_MS;
}

// ------------------------------------------------------------------ page state

export type IndexRange = "1y" | "all";
export const INDEX_RANGES: ReadonlyArray<{ value: IndexRange; label: string }> = [
  { value: "1y", label: "1Y" },
  { value: "all", label: "All" },
];
export const DEFAULT_INDEX_RANGE: IndexRange = "1y";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseIndexRange(value: string | string[] | undefined): IndexRange {
  return first(value) === "all" ? "all" : DEFAULT_INDEX_RANGE;
}

/** 1Y: the points in the 365 days ending on the newest point. All: every point. */
export function sliceIndexRange(points: readonly IndexPoint[], range: IndexRange): IndexPoint[] {
  if (range === "all" || points.length === 0) return [...points];
  const cutoff = addDaysToKey(points[points.length - 1].day, -365);
  return points.filter((p) => p.day >= cutoff);
}

/** The last weekly point: history up to it is Monday-to-Monday. */
export function lastWeeklyDay(points: readonly IndexPoint[]): string | null {
  let last: string | null = null;
  for (const p of points) if (p.weekly) last = p.day;
  return last;
}

/** The headline and the sub-indices published for the same day, the only ones the page shows. */
export function currentSummaries(summaries: readonly IndexSummary[]): {
  headline: IndexSummary | null;
  subIndices: IndexSummary[];
} {
  const headline = summaries.find((s) => s.code === HEADLINE_INDEX_CODE) ?? null;
  if (!headline) return { headline: null, subIndices: [] };
  return {
    headline,
    subIndices: summaries.filter((s) => s.kind !== "headline" && s.day === headline.day),
  };
}

export type IndexSortKey = "name" | "level" | "1d" | "7d" | "30d" | "1y" | "constituents";
export type SortDir = "asc" | "desc";
export interface IndexSort {
  /** null: grouped by kind (types, generations, sets), then catalog order and name. */
  key: IndexSortKey | null;
  dir: SortDir;
}
const SORT_KEYS: readonly IndexSortKey[] = ["name", "level", "1d", "7d", "30d", "1y", "constituents"];

export function parseIndexSort(sort: string | string[] | undefined, dir: string | string[] | undefined): IndexSort {
  const key = first(sort);
  if (!key || !SORT_KEYS.includes(key as IndexSortKey)) return { key: null, dir: "asc" };
  const d = first(dir);
  const defaultDir: SortDir = key === "name" ? "asc" : "desc";
  return { key: key as IndexSortKey, dir: d === "asc" || d === "desc" ? d : defaultDir };
}

function sortValue(s: IndexSummary, key: IndexSortKey): number | string | null {
  switch (key) {
    case "name":
      return s.name.toLowerCase();
    case "level":
      return s.level;
    case "1d":
      return s.chg1d;
    case "7d":
      return s.chg7d;
    case "30d":
      return s.chg30d;
    case "1y":
      return s.chg365d;
    case "constituents":
      return s.nConstituents;
  }
}

function defaultOrder(a: IndexSummary, b: IndexSummary): number {
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/** Sorted copy; missing values last in both directions. */
export function sortSummaries(rows: readonly IndexSummary[], sort: IndexSort): IndexSummary[] {
  const { key, dir } = sort;
  if (key === null) return [...rows].sort(defaultOrder);
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb === null) return defaultOrder(a, b);
    if (va === null) return 1;
    if (vb === null) return -1;
    const c = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return c !== 0 ? sign * c : defaultOrder(a, b);
  });
}

/** Query string for a page link that keeps the other parameter. */
export function indexPageHref(range: IndexRange, sort: IndexSort): string {
  const params = new URLSearchParams();
  if (range !== DEFAULT_INDEX_RANGE) params.set("range", range);
  if (sort.key !== null) {
    params.set("sort", sort.key);
    params.set("dir", sort.dir);
  }
  const query = params.toString();
  return query ? `${INDEX_PAGE_PATH}?${query}` : INDEX_PAGE_PATH;
}

// ------------------------------------------------------------------ exports

/** Levels to 4 decimals in public payloads and the CSV (stored to 6). */
export function roundLevel(level: number): number {
  return Math.round(level * 10_000) / 10_000;
}

/**
 * /api/public/index/[code]: columns, oldest first. p lists the positions of
 * provisional points; w is the last weekly day (null when none).
 */
export interface CompactIndexSeries {
  code: string;
  name: string;
  asOf: string | null;
  base: number;
  weeklyUntil: string | null;
  d: string[];
  l: number[];
  p: number[];
}

export function isCompactIndexSeries(value: unknown): value is CompactIndexSeries {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    isIndexCode(v.code) &&
    typeof v.name === "string" &&
    Array.isArray(v.d) &&
    Array.isArray(v.l) &&
    Array.isArray(v.p) &&
    v.d.length === v.l.length &&
    v.d.every((d) => typeof d === "string" && DATE_KEY_RE.test(d)) &&
    v.l.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0) &&
    v.p.every((i) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < (v.d as unknown[]).length)
  );
}

export function toCompactIndexSeries(
  summary: Pick<IndexSummary, "code" | "name">,
  points: readonly IndexPoint[]
): CompactIndexSeries {
  const p: number[] = [];
  points.forEach((point, i) => {
    if (point.provisional) p.push(i);
  });
  return {
    code: summary.code,
    name: summary.name,
    asOf: points.length ? points[points.length - 1].day : null,
    base: INDEX_BASE_LEVEL,
    weeklyUntil: lastWeeklyDay(points),
    d: points.map((point) => point.day),
    l: points.map((point) => roundLevel(point.level)),
    p,
  };
}

export const INDEX_CSV_HEADER = [
  "date",
  "level",
  "resolution",
  "provisional",
  "constituents",
  "contributing",
  "coverage_pct",
  "advancers_7d",
  "decliners_7d",
  "unchanged_7d",
  "new_highs_52w",
  "new_lows_52w",
] as const;

/**
 * Pokéfin's derived levels only: no product price is included. Two leading
 * "#" lines carry the licence and credit (pandas: read_csv(comment="#")).
 */
export function indexLevelsCsv(
  points: readonly IndexPoint[],
  { asOf, pageUrl }: { asOf: string | null; pageUrl: string }
): string {
  const lines = [
    `# ${HEADLINE_INDEX_NAME}, base ${INDEX_BASE_LEVEL}. Derived by Pokéfin from daily TCGplayer Market Prices; no product prices included.`,
    `# License: ${INDEX_LICENSE_NAME} (${INDEX_LICENSE_URL}). Credit: Pokéfin, ${pageUrl}. As of the close of ${asOf ?? "n/a"} (UTC).`,
    INDEX_CSV_HEADER.join(","),
  ];
  for (const p of points) {
    lines.push(
      [
        p.day,
        roundLevel(p.level).toFixed(4),
        p.weekly ? "weekly" : "daily",
        p.provisional ? "true" : "false",
        p.nConstituents,
        p.nContributing,
        p.coveragePct.toFixed(1),
        p.adv7d,
        p.dec7d,
        p.flat7d,
        p.newHigh52w,
        p.newLow52w,
      ].join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}
```

### Step 9. `frontend/app/lib/indexChart.ts` (new)

```ts
/**
 * Geometry for the server-rendered index chart (WP29). Pure: no React.
 *
 * The SVG uses a fixed 1000 x 300 viewBox stretched to its box
 * (preserveAspectRatio="none", non-scaling strokes), so labels are HTML
 * positioned by the percentages computed here and stay 12 px on a phone.
 * x is proportional to calendar days, clamped to the data (01-PRODUCT-DIRECTION.md §3.4).
 */
import { formatDecimal, formatMonthYear } from "./format";
import { dayKeyToMs, type IndexPoint } from "./marketIndex";

export const INDEX_CHART_WIDTH = 1000;
export const INDEX_CHART_HEIGHT = 300;
/** At most this many y gridlines with labels. */
const TARGET_Y_TICKS = 5;
/** At most this many month labels on desktop; phones show every other one. */
const MAX_X_TICKS = 8;
const MONTH_STEPS = [1, 2, 3, 6, 12, 24] as const;
const DAY_MS = 86_400_000;

export interface IndexChartTick {
  label: string;
  /** Percent from the top (y) or from the left (x) of the plot box. */
  pct: number;
}

export interface IndexChartModel {
  /** Solid daily segment; null when every point is weekly. */
  dailyPath: string | null;
  /** Dashed weekly segment; null when there is none. It ends where dailyPath starts. */
  weeklyPath: string | null;
  yTicks: Array<IndexChartTick & { value: number; y: number }>;
  xTicks: Array<IndexChartTick & { day: string; minor: boolean }>;
  last: { day: string; level: number; xPct: number; yPct: number };
  firstDay: string;
  /** The last weekly day, for the footnote; null when none is in range. */
  weeklyUntil: string | null;
  min: number;
  max: number;
}

/** 1, 2, 2.5 or 5 times a power of ten, at least `raw`. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * power >= raw - 1e-12) return m * power;
  }
  return 10 * power;
}

function decimalsFor(step: number): number {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  return 2;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function pathOf(coords: ReadonlyArray<[number, number]>): string | null {
  if (coords.length < 2) return null;
  return coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${r1(x)} ${r1(y)}`).join(" ");
}

function monthStarts(firstDay: string, lastDay: string): string[] {
  const out: string[] = [];
  const start = new Date(dayKeyToMs(firstDay));
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() + (start.getUTCDate() === 1 ? 0 : 1);
  for (;;) {
    const key = new Date(Date.UTC(y + Math.floor(m / 12), m % 12, 1)).toISOString().slice(0, 10);
    if (key > lastDay) return out;
    out.push(key);
    m += 1;
  }
}

/** Chart model for points ordered oldest first; null with fewer than 2 points. */
export function buildIndexChart(points: readonly IndexPoint[]): IndexChartModel | null {
  if (points.length < 2) return null;
  const firstDay = points[0].day;
  const lastPoint = points[points.length - 1];
  const t0 = dayKeyToMs(firstDay);
  const span = Math.max(1, (dayKeyToMs(lastPoint.day) - t0) / DAY_MS);

  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    min = Math.min(min, p.level);
    max = Math.max(max, p.level);
  }
  const step = niceStep((max - min) / (TARGET_Y_TICKS - 1) || Math.max(1, max * 0.01));
  let lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (hi - lo < step) {
    lo -= step;
    hi += step;
  }

  const x = (day: string) => (((dayKeyToMs(day) - t0) / DAY_MS) / span) * INDEX_CHART_WIDTH;
  const y = (level: number) => INDEX_CHART_HEIGHT - ((level - lo) / (hi - lo)) * INDEX_CHART_HEIGHT;

  const weekly: Array<[number, number]> = [];
  const daily: Array<[number, number]> = [];
  let weeklyUntil: string | null = null;
  for (const p of points) {
    const coord: [number, number] = [x(p.day), y(p.level)];
    if (p.weekly) {
      weekly.push(coord);
      weeklyUntil = p.day;
    } else {
      // The daily line starts at the last weekly point, so the two segments join.
      if (daily.length === 0 && weekly.length > 0) daily.push(weekly[weekly.length - 1]);
      daily.push(coord);
    }
  }

  const decimals = decimalsFor(step);
  const yTicks: IndexChartModel["yTicks"] = [];
  for (let v = lo; v <= hi + step / 2; v += step) {
    const value = Math.round(v / step) * step;
    const yy = y(value);
    yTicks.push({ value, y: r1(yy), label: formatDecimal(value, decimals), pct: r1((yy / INDEX_CHART_HEIGHT) * 100) });
  }

  const months = monthStarts(firstDay, lastPoint.day);
  const monthStep = MONTH_STEPS.find((s) => Math.ceil(months.length / s) <= MAX_X_TICKS) ?? 24;
  const xTicks: IndexChartModel["xTicks"] = [];
  months.forEach((day) => {
    const monthIndex = new Date(dayKeyToMs(day)).getUTCFullYear() * 12 + new Date(dayKeyToMs(day)).getUTCMonth();
    if (monthIndex % monthStep !== 0) return;
    xTicks.push({
      day,
      label: formatMonthYear(day),
      pct: r1((x(day) / INDEX_CHART_WIDTH) * 100),
      minor: xTicks.length % 2 === 1,
    });
  });

  return {
    dailyPath: pathOf(daily),
    weeklyPath: pathOf(weekly),
    yTicks,
    xTicks,
    last: {
      day: lastPoint.day,
      level: lastPoint.level,
      xPct: r1((x(lastPoint.day) / INDEX_CHART_WIDTH) * 100),
      yPct: r1((y(lastPoint.level) / INDEX_CHART_HEIGHT) * 100),
    },
    firstDay,
    weeklyUntil,
    min,
    max,
  };
}
```

### Step 10. `frontend/app/lib/serverMarketData.ts`: two cached reads

10a. Import, next to WP25's `./marketStats` import:

```ts
import {
  isIndexCode,
  toIndexPoints,
  toIndexSummaries,
  type IndexPoint,
  type IndexSummary,
} from "./marketIndex";
```

10b. Directly below WP25's `fetchFxDaily` (above the cached exports block), add:

```ts
// ---- WP29: the Sealed Index family (migration 0042) ----

/** Columns of market_index_summary. Listed, not "*", so a later column does not grow the cache. */
const INDEX_SUMMARY_SELECT = `code, name, kind, sort_order, base_day, day, level,
  n_constituents, n_contributing, coverage_pct, adv_7d, dec_7d, flat_7d,
  new_high_52w, new_low_52w, provisional, resolution,
  chg_1d, chg_7d, chg_30d, chg_365d`;

const INDEX_DAILY_SELECT = `day, level, provisional, resolution, n_constituents,
  n_contributing, coverage_pct, adv_7d, dec_7d, flat_7d, new_high_52w, new_low_52w`;

/** Latest level, changes and breadth of every index: one view read, about 70 rows. */
async function fetchIndexSummaries(): Promise<IndexSummary[]> {
  const supabase = createMarketDataSupabaseClient();
  const rows = await fetchAllRows("market_index_summary", (from, to) =>
    supabase
      .from("market_index_summary")
      .select(INDEX_SUMMARY_SELECT)
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true })
      .range(from, to)
  );
  return toIndexSummaries(rows);
}

/** One index's levels, oldest first: a primary-key range read. */
async function fetchIndexSeries(code: string): Promise<IndexPoint[]> {
  if (!isIndexCode(code)) return [];
  const supabase = createMarketDataSupabaseClient();
  const rows = await fetchAllRows("market_index_daily", (from, to) =>
    supabase
      .from("market_index_daily")
      .select(INDEX_DAILY_SELECT)
      .eq("index_code", code)
      .order("day", { ascending: true })
      .range(from, to)
  );
  return toIndexPoints(rows);
}
```

10c. At the end of the cached exports block (after WP25's `getCachedFxDaily`), add:

```ts
/**
 * The index reads also refresh hourly, not only on the scrape hook's tag:
 * pg_cron publishes D-1 at 00:45 UTC, after the scraper's last revalidation
 * of the day, and the scraper host may be off. Cost: at most one 1.2 ms view
 * read and one primary-key range read per entry per hour.
 */
const INDEX_REFRESH_SECONDS = 3600;

const getCachedIndexSummaryList = unstable_cache(
  fetchIndexSummaries,
  ["market-index-summary"],
  {
    revalidate: INDEX_REFRESH_SECONDS,
    tags: [CACHE_TAGS.marketProducts],
  }
);

/**
 * Latest level, changes and breadth of every index (WP29). [] means nothing
 * is published yet; null (uncached) means the read failed, so callers show an
 * error state, never "not published".
 */
export async function getCachedIndexSummary(): Promise<IndexSummary[] | null> {
  try {
    return await getCachedIndexSummaryList();
  } catch (error) {
    logCaughtError("server_index_summary_failed", error);
    return null;
  }
}

const getCachedIndexSeriesPoints = unstable_cache(
  fetchIndexSeries,
  ["market-index-series"],
  {
    revalidate: INDEX_REFRESH_SECONDS,
    tags: [CACHE_TAGS.marketProducts],
  }
);

/**
 * One index's levels, oldest first (WP29). The code is part of the cache key
 * (unstable_cache keys on its arguments). null (uncached) when the read failed.
 */
export async function getCachedIndexSeries(code: string): Promise<IndexPoint[] | null> {
  try {
    return await getCachedIndexSeriesPoints(code);
  } catch (error) {
    logCaughtError("server_index_series_failed", error);
    return null;
  }
}
```

Never call either function from inside another `unstable_cache` callback (WP11's nested-cache rule). Until phase B, `tsc` reports that `"market_index_summary"` and `"market_index_daily"` are not in `Database`; do not cast the client to `any`.

### Step 11. `frontend/app/lib/jsonLd.ts`: the Dataset node

Append:

```ts
/** schema.org Dataset for a downloadable Pokéfin series (WP29: the Sealed Index). */
export function buildDatasetJsonLd({
  name,
  description,
  path,
  csvPath,
  license,
  temporalCoverage,
  dateModified,
}: {
  name: string;
  description: string;
  path: string;
  csvPath: string;
  license: string;
  /** "YYYY-MM-DD/YYYY-MM-DD" */
  temporalCoverage: string;
  dateModified: string;
}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name,
    description,
    url: absoluteUrl(path),
    creator: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
    license,
    isAccessibleForFree: true,
    temporalCoverage,
    dateModified,
    distribution: [{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: absoluteUrl(csvPath) }],
  };
}
```

`absoluteUrl` and `SITE_NAME` are already imported there (WP24 step 7a).

### Step 12. `frontend/app/api/public/index/[code]/route.ts` (new)

```ts
/**
 * GET /api/public/index/[code]: one index's levels as compact columns
 * { code, name, asOf, base, weeklyUntil, d, l, p } (WP29, lib/marketIndex.ts
 * CompactIndexSeries). WP31 (product chart benchmark), WP36 (portfolio
 * benchmark) and WP37 (set charts) read it through publicMarketApi.
 *
 * ISR like WP26's routes: rendered on the first request per code, then served
 * by the CDN until the "market-products" tag is revalidated (scraper hook) or
 * the daily backstop. Segment config must stay literal.
 */
import { getCachedIndexSeries, getCachedIndexSummary } from "../../../../lib/serverMarketData";
import { isIndexCode, toCompactIndexSeries } from "../../../../lib/marketIndex";
import { publicJson, publicNotFound } from "../../../../lib/publicRoute";

export const dynamic = "force-static";
export const revalidate = 86400;

// Empty on purpose: no build-time Supabase call (WP11 rule).
export async function generateStaticParams(): Promise<Array<{ code: string }>> {
  return [];
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!isIndexCode(code)) {
    return publicNotFound();
  }
  // Both reads log and return null on failure; throwing makes Next answer 500
  // and keep any earlier cached response, so a failure is never cached.
  const summaries = await getCachedIndexSummary();
  if (summaries === null) throw new Error(`index summary unavailable (${code})`);
  const summary = summaries.find((s) => s.code === code);
  if (!summary) {
    return publicNotFound();
  }
  const points = await getCachedIndexSeries(code);
  if (points === null) throw new Error(`index series unavailable (${code})`);
  return publicJson(toCompactIndexSeries(summary, points));
}
```

`proxy.ts` must not run for it: WP26 step 7's matcher already excludes `/api/public/*` (Before you start covers the case where WP26 has not landed).

### Step 13. `frontend/app/lib/publicMarketApi.ts`: the browser helper (only if the file exists, WP26)

13a. Add to the imports: `import { isCompactIndexSeries, type CompactIndexSeries } from "./marketIndex";`

13b. Below `historyCache`, add `const indexCache = new Map<string, Entry<CompactIndexSeries | null>>();` and below `fetchPublicHistory`:

```ts
/**
 * One index's levels (WP29, /api/public/index/[code]); null for an unknown
 * code. WP31, WP36 and WP37 draw their benchmark lines from it.
 */
export function fetchPublicIndexSeries(code: string): Promise<CompactIndexSeries | null> {
  return remember(indexCache, code, async () => {
    const { status, body } = await getJson(`/api/public/index/${encodeURIComponent(code)}`);
    if (status === 404) return null;
    if (!isCompactIndexSeries(body) || body.code !== code) {
      throw new Error(`/api/public/index/${code}: unexpected answer`);
    }
    return body;
  });
}
```

13c. In `_resetPublicMarketCachesForTests`, add `indexCache.clear();`.

`marketIndex.ts` imports nothing, so this adds only the validator to any client bundle that calls the helper (none in this package).

### Step 14. `frontend/app/indices/sealed/IndexChart.tsx` (new)

```tsx
import { formatDateOnly, formatDecimal, formatMonthDay } from "../../lib/format";
import { buildIndexChart, INDEX_CHART_HEIGHT, INDEX_CHART_WIDTH } from "../../lib/indexChart";
import type { IndexPoint } from "../../lib/marketIndex";

/**
 * Server-rendered SVG line chart of index levels (WP29). No client
 * JavaScript: the SVG stretches to its box with non-scaling strokes, and the
 * labels are HTML positioned by percentages so they stay 12 px on a phone.
 * Weekly points (before daily collection) are dashed, with a footnote.
 */
export default function IndexChart({ points, title }: { points: readonly IndexPoint[]; title: string }) {
  const model = buildIndexChart(points);
  if (model === null) {
    return (
      <div className="flex h-56 items-center justify-center rounded-control border border-dashed border-line text-small text-ink-soft md:h-72">
        No history
      </div>
    );
  }

  const summary = `${title} from ${formatDateOnly(model.firstDay)} to ${formatDateOnly(model.last.day)}: ${formatDecimal(
    points[0].level
  )} to ${formatDecimal(model.last.level)}, low ${formatDecimal(model.min)}, high ${formatDecimal(model.max)}.`;
  const labelBelow = model.last.yPct < 15;

  return (
    <figure className="m-0">
      <div className="relative h-56 md:h-72">
        <div className="absolute bottom-6 left-0 right-12 top-0">
          <svg
            viewBox={`0 0 ${INDEX_CHART_WIDTH} ${INDEX_CHART_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
            className="absolute inset-0 h-full w-full overflow-visible"
          >
            {model.yTicks.map((tick) => (
              <line
                key={tick.value}
                x1={0}
                x2={INDEX_CHART_WIDTH}
                y1={tick.y}
                y2={tick.y}
                className="stroke-chart-grid"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {model.weeklyPath && (
              <path
                d={model.weeklyPath}
                data-segment="weekly"
                className="fill-none stroke-chart-line"
                strokeWidth={2}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {model.dailyPath && (
              <path
                d={model.dailyPath}
                data-segment="daily"
                className="fill-none stroke-chart-line"
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {model.yTicks.map((tick) => (
            <span
              key={tick.value}
              aria-hidden="true"
              className="absolute left-full ml-2 -translate-y-1/2 text-caption tabular-nums text-ink-soft"
              style={{ top: `${tick.pct}%` }}
            >
              {tick.label}
            </span>
          ))}
          {model.xTicks.map((tick) => (
            <span
              key={tick.day}
              aria-hidden="true"
              className={`absolute top-full mt-1 -translate-x-1/2 whitespace-nowrap text-caption text-ink-soft ${
                tick.minor ? "hidden md:block" : ""
              }`}
              style={{ left: `${tick.pct}%` }}
            >
              {tick.label}
            </span>
          ))}

          <span
            aria-hidden="true"
            className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chart-line ring-2 ring-surface"
            style={{ left: `${model.last.xPct}%`, top: `${model.last.yPct}%` }}
          />
          <span
            aria-hidden="true"
            data-testid="index-last-label"
            className={`absolute -translate-x-full whitespace-nowrap rounded-control bg-surface/90 px-1 text-caption font-medium tabular-nums text-ink ${
              labelBelow ? "translate-y-2" : "-translate-y-full -mt-1"
            }`}
            style={{ left: `${model.last.xPct}%`, top: `${model.last.yPct}%` }}
          >
            {formatDecimal(model.last.level)} · {formatMonthDay(model.last.day)}
          </span>
        </div>
      </div>

      <figcaption className="mt-3 space-y-1 text-caption text-ink-soft">
        <span className="sr-only">{summary}</span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-hidden="true">
          <span className="inline-flex items-center gap-1.5">
            <svg width="20" height="8" viewBox="0 0 20 8" focusable="false">
              <line x1="0" y1="4" x2="20" y2="4" className="stroke-chart-line" strokeWidth="2" />
            </svg>
            Daily level
          </span>
          {model.weeklyPath && (
            <span className="inline-flex items-center gap-1.5">
              <svg width="20" height="8" viewBox="0 0 20 8" focusable="false">
                <line x1="0" y1="4" x2="20" y2="4" className="stroke-chart-line" strokeWidth="2" strokeDasharray="4 3" />
              </svg>
              Weekly points
            </span>
          )}
        </span>
        {model.weeklyUntil && (
          <span className="block" data-testid="index-weekly-footnote">
            Weekly points before {formatDateOnly(model.weeklyUntil)}: history from before daily collection was
            backfilled from TCGplayer&apos;s weekly prices, so those points are a week apart.
          </span>
        )}
      </figcaption>
    </figure>
  );
}
```

### Step 15. `frontend/app/indices/sealed/BreadthBlock.tsx` (new)

```tsx
import type { ReactNode } from "react";
import MetricLabel from "../../components/ui/MetricLabel";
import { formatInteger, formatPercent } from "../../lib/format";
import { INDEX_RULES, type IndexSummary } from "../../lib/marketIndex";

function Figure({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-small text-ink-soft">{label}</dt>
      <dd className="mt-0.5 text-body font-semibold tabular-nums text-ink">
        {value}
        {sub && <span className="ml-1 font-normal text-ink-soft">{sub}</span>}
      </dd>
    </div>
  );
}

/**
 * Market breadth for one index day (WP29): advancers, unchanged and
 * decliners over 7 days (dead band INDEX_RULES.breadthFlatBandPct), and new
 * 52-week highs and lows. Server component; the bar is decorative, the
 * numbers carry the information.
 */
export default function BreadthBlock({ summary, className = "" }: { summary: IndexSummary; className?: string }) {
  const counted = summary.adv7d + summary.dec7d + summary.flat7d;
  const band = INDEX_RULES.breadthFlatBandPct;
  const share = (n: number) => (counted > 0 ? (n / counted) * 100 : 0);

  return (
    <section aria-labelledby="breadth-h" className={`rounded-card border border-line bg-surface p-4 md:p-5 ${className}`}>
      <h2 id="breadth-h" className="text-h3 font-semibold text-ink">
        <MetricLabel metric="breadth7d" />
      </h2>
      {counted === 0 ? (
        <p className="mt-2 text-small text-ink-soft">No constituent has a 7-day change for this day.</p>
      ) : (
        <>
          <p className="mt-1 text-small text-ink-soft">
            {formatInteger(summary.adv7d)} of {formatInteger(counted)} constituents rose more than {band}% over 7
            days and {formatInteger(summary.dec7d)} fell more than {band}%.
          </p>
          <div aria-hidden="true" data-testid="breadth-bar" className="mt-3 flex h-2.5 overflow-hidden rounded-control bg-chart-grid">
            <div className="bg-gain-text" style={{ width: `${share(summary.adv7d)}%` }} />
            <div className="bg-chart-volume" style={{ width: `${share(summary.flat7d)}%` }} />
            <div className="bg-loss-text" style={{ width: `${share(summary.dec7d)}%` }} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Figure
              label="Advancers"
              value={
                <span className="text-gain-text">
                  <span aria-hidden="true">▲ </span>
                  {formatInteger(summary.adv7d)}
                </span>
              }
              sub={formatPercent(share(summary.adv7d), { decimals: 0 })}
            />
            <Figure
              label="Unchanged"
              value={formatInteger(summary.flat7d)}
              sub={formatPercent(share(summary.flat7d), { decimals: 0 })}
            />
            <Figure
              label="Decliners"
              value={
                <span className="text-loss-text">
                  <span aria-hidden="true">▼ </span>
                  {formatInteger(summary.dec7d)}
                </span>
              }
              sub={formatPercent(share(summary.dec7d), { decimals: 0 })}
            />
            <Figure label={<MetricLabel metric="newHighs52w" />} value={formatInteger(summary.newHigh52w)} />
            <Figure label={<MetricLabel metric="newLows52w" />} value={formatInteger(summary.newLow52w)} />
          </dl>
        </>
      )}
    </section>
  );
}
```

### Step 16. `frontend/app/indices/sealed/SubIndexTable.tsx` (new)

```tsx
import Link from "next/link";
import Badge from "../../components/ui/Badge";
import { DataList, DataListRow } from "../../components/ui/DataList";
import Delta from "../../components/ui/Delta";
import { formatDecimal, formatInteger } from "../../lib/format";
import {
  INDEX_KIND_LABELS,
  indexPageHref,
  type IndexRange,
  type IndexSort,
  type IndexSortKey,
  type IndexSummary,
} from "../../lib/marketIndex";

const NUMERIC_COLUMNS: ReadonlyArray<{ key: IndexSortKey; label: string }> = [
  { key: "level", label: "Level" },
  { key: "1d", label: "1D" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "1y", label: "1Y" },
  { key: "constituents", label: "Constituents" },
];

const PHONE_SORTS: ReadonlyArray<{ sort: IndexSort; label: string }> = [
  { sort: { key: null, dir: "asc" }, label: "Grouped" },
  { sort: { key: "7d", dir: "desc" }, label: "7D" },
  { sort: { key: "30d", dir: "desc" }, label: "30D" },
  { sort: { key: "1y", dir: "desc" }, label: "1Y" },
  { sort: { key: "name", dir: "asc" }, label: "Name" },
];

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action";

/** Clicking the sorted column flips it; another column starts descending (name ascending). */
export function nextSort(current: IndexSort, key: IndexSortKey): IndexSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "name" ? "asc" : "desc" };
}

function ariaSort(sort: IndexSort, key: IndexSortKey): "ascending" | "descending" | "none" {
  if (sort.key !== key) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}

function SortLink({
  label,
  sortKey,
  sort,
  range,
  alignRight = false,
}: {
  label: string;
  sortKey: IndexSortKey;
  sort: IndexSort;
  range: IndexRange;
  alignRight?: boolean;
}) {
  const active = sort.key === sortKey;
  const arrow = active ? (sort.dir === "asc" ? "▲" : "▼") : "↕";
  return (
    <Link
      href={indexPageHref(range, nextSort(sort, sortKey))}
      scroll={false}
      prefetch={false}
      className={`inline-flex items-center gap-1 rounded-control pointer-coarse:min-h-11 ${FOCUS} ${
        alignRight ? "flex-row-reverse" : ""
      } ${active ? "font-bold text-ink" : "font-semibold text-ink-soft hover:text-ink"}`}
    >
      <span>{label}</span>
      <span aria-hidden="true" className={active ? "" : "opacity-50"}>
        {arrow}
      </span>
    </Link>
  );
}

/** The change a phone row shows: the sorted window, else 7D. */
function phoneChange(row: IndexSummary, sort: IndexSort): { value: number | null; period: string } {
  switch (sort.key) {
    case "1d":
      return { value: row.chg1d, period: "1D" };
    case "30d":
      return { value: row.chg30d, period: "30D" };
    case "1y":
      return { value: row.chg365d, period: "1Y" };
    default:
      return { value: row.chg7d, period: "7D" };
  }
}

/**
 * Sub-indices (WP29): a dense sortable table from 768 px (the Group column
 * from 1024 px), a DataList on phones (01-PRODUCT-DIRECTION.md §3.3). Sorting is a link (?sort=, ?dir=),
 * so the component ships no JavaScript.
 */
export default function SubIndexTable({
  rows,
  range,
  sort,
  className = "",
}: {
  rows: readonly IndexSummary[];
  range: IndexRange;
  sort: IndexSort;
  className?: string;
}) {
  return (
    <div className={className}>
      {/* Scrolls inside its own box if 768 to 1023 px is too narrow; the page never scrolls sideways. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[40rem] border-collapse bg-surface text-body">
          <caption className="sr-only">Sub-indices with level and changes. Column headers sort the table.</caption>
          <thead>
            <tr className="h-10 border-b border-line text-small">
              <th scope="col" aria-sort={ariaSort(sort, "name")} className="px-3 text-left">
                <SortLink label="Index" sortKey="name" sort={sort} range={range} />
              </th>
              <th scope="col" className="hidden px-3 text-left font-semibold text-ink-soft lg:table-cell">
                Group
              </th>
              {NUMERIC_COLUMNS.map((column) => (
                <th key={column.key} scope="col" aria-sort={ariaSort(sort, column.key)} className="px-3 text-right">
                  <SortLink label={column.label} sortKey={column.key} sort={sort} range={range} alignRight />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.code} data-code={row.code} className="h-11 border-b border-line">
                <th scope="row" className="px-3 text-left font-medium text-ink">
                  {row.name}
                  {row.provisional && (
                    <Badge variant="warn" className="ml-2">
                      Provisional
                    </Badge>
                  )}
                </th>
                <td className="hidden px-3 text-small text-ink-soft lg:table-cell">{INDEX_KIND_LABELS[row.kind]}</td>
                <td className="px-3 text-right font-semibold tabular-nums text-ink">{formatDecimal(row.level)}</td>
                <td className="px-3 text-right">
                  <Delta value={row.chg1d} missingReason="No level the day before" />
                </td>
                <td className="px-3 text-right">
                  <Delta value={row.chg7d} missingReason="No level 7 days earlier" />
                </td>
                <td className="px-3 text-right">
                  <Delta value={row.chg30d} missingReason="No level 30 days earlier" />
                </td>
                <td className="px-3 text-right">
                  <Delta value={row.chg365d} missingReason="Less than a year of levels" />
                </td>
                <td className="px-3 text-right tabular-nums text-ink-soft">{formatInteger(row.nConstituents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden">
        <nav aria-label="Sort sub-indices" className="mb-3 flex flex-wrap gap-2">
          {PHONE_SORTS.map((option) => {
            const selected = option.sort.key === sort.key;
            return (
              <Link
                key={option.label}
                href={indexPageHref(range, option.sort)}
                scroll={false}
                prefetch={false}
                aria-current={selected ? "true" : undefined}
                className={`inline-flex min-h-11 items-center rounded-control border px-3 text-small font-semibold ${FOCUS} ${
                  selected ? "border-action bg-action text-white" : "border-line bg-surface text-ink-soft"
                }`}
              >
                {option.label}
              </Link>
            );
          })}
        </nav>
        <DataList label="Sub-indices">
          {rows.map((row) => {
            const change = phoneChange(row, sort);
            return (
              <DataListRow
                key={row.code}
                title={row.name}
                subtitle={INDEX_KIND_LABELS[row.kind]}
                meta={`${formatInteger(row.nConstituents)} constituents${row.provisional ? ", provisional" : ""}`}
                value={formatDecimal(row.level)}
                delta={<Delta value={change.value} period={change.period} />}
              />
            );
          })}
        </DataList>
      </div>
    </div>
  );
}
```

### Step 17. `frontend/app/indices/sealed/page.tsx` (new)

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses } from "../../components/ui/Button";
import Delta from "../../components/ui/Delta";
import EmptyState from "../../components/ui/EmptyState";
import { WarnIcon } from "../../components/ui/icons";
import MetricLabel from "../../components/ui/MetricLabel";
import PageHeader from "../../components/ui/PageHeader";
import ProvenanceLine from "../../components/ui/ProvenanceLine";
import Stat from "../../components/ui/Stat";
import { formatDateOnly, formatDecimal, formatInteger, formatPercent } from "../../lib/format";
import { buildBreadcrumbJsonLd, buildDatasetJsonLd, serializeJsonLd } from "../../lib/jsonLd";
import {
  currentSummaries,
  HEADLINE_INDEX_CODE,
  HEADLINE_INDEX_NAME,
  INDEX_BASE_LEVEL,
  INDEX_CSV_PATH,
  INDEX_LICENSE_NAME,
  INDEX_LICENSE_URL,
  INDEX_PAGE_PATH,
  INDEX_RANGES,
  INDEX_RULES,
  indexPageHref,
  isIndexOverdue,
  parseIndexRange,
  parseIndexSort,
  sliceIndexRange,
  sortSummaries,
  type IndexRange,
  type IndexSort,
} from "../../lib/marketIndex";
import { getCachedIndexSeries, getCachedIndexSummary } from "../../lib/serverMarketData";
import BreadthBlock from "./BreadthBlock";
import IndexChart from "./IndexChart";
import SubIndexTable from "./SubIndexTable";

/*
 * /indices/sealed: the Pokéfin Sealed Index family (WP29).
 *
 * Server-rendered with no client JavaScript of its own: the chart is SVG
 * built here, and range and sort are links (?range=, ?sort=, ?dir=). Reading
 * searchParams makes the route dynamic; both reads are unstable_cache entries
 * tagged market-products (WP11), so a request renders from cache without a
 * database query. Never add "use client", a charting library or a client
 * fetch here: perf-budgets.json forbids recharts on this route.
 */

const DESCRIPTION =
  "The Pokéfin Sealed Index: an equal-weighted daily index of sealed Pokémon TCG product prices, with sub-indices by product type, generation and set, and market breadth.";

export const metadata: Metadata = {
  title: { absolute: HEADLINE_INDEX_NAME },
  description: DESCRIPTION,
  alternates: { canonical: INDEX_PAGE_PATH },
};

const LINK =
  "font-medium text-action underline underline-offset-2 hover:text-action-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function CloseOf({ day }: { day: string }) {
  return (
    <>
      as of the close of <time dateTime={day}>{formatDateOnly(day)}</time> (UTC)
    </>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p
      role="note"
      className="mt-4 flex items-start gap-2 rounded-card border border-line bg-warn-fill p-3 text-small text-warn-text"
    >
      <WarnIcon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function RangeControl({ range, sort }: { range: IndexRange; sort: IndexSort }) {
  return (
    <nav aria-label="Chart range" className="inline-flex rounded-control border border-line bg-surface p-0.5">
      {INDEX_RANGES.map((option) => {
        const selected = option.value === range;
        return (
          <Link
            key={option.value}
            href={indexPageHref(option.value, sort)}
            scroll={false}
            prefetch={false}
            aria-current={selected ? "page" : undefined}
            className={`inline-flex min-w-11 items-center justify-center rounded-control px-3 py-1 text-caption font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action pointer-coarse:min-h-11 ${
              selected ? "bg-action text-white" : "text-ink-soft hover:bg-surface-alt"
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-6xl px-4 py-8 md:py-12">{children}</main>;
}

export default async function SealedIndexPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const range = parseIndexRange(params.range);
  const sort = parseIndexSort(params.sort, params.dir);
  const [summaries, series] = await Promise.all([
    getCachedIndexSummary(),
    getCachedIndexSeries(HEADLINE_INDEX_CODE),
  ]);

  if (summaries === null || series === null) {
    return (
      <Shell>
        <PageHeader title={HEADLINE_INDEX_NAME} />
        <EmptyState
          className="mt-6"
          headingLevel={2}
          title="The index could not be loaded"
          description="This is usually temporary. Reload the page in a minute."
          action={
            <Link href={indexPageHref(range, sort)} prefetch={false} className={buttonClasses({ variant: "secondary", size: "sm" })}>
              Reload
            </Link>
          }
        />
      </Shell>
    );
  }

  const { headline, subIndices } = currentSummaries(summaries);
  if (headline === null || series.length === 0) {
    return (
      <Shell>
        <PageHeader title={HEADLINE_INDEX_NAME} />
        <EmptyState
          className="mt-6"
          headingLevel={2}
          title="The Sealed Index is not published yet"
          description={
            <>
              Levels appear after the first nightly run. The rules are on the{" "}
              <Link href="/methodology#index" prefetch={false} className={LINK}>
                methodology page
              </Link>
              .
            </>
          }
        />
      </Shell>
    );
  }

  const points = sliceIndexRange(series, range);
  const rows = sortSummaries(subIndices, sort);
  const baseDay = headline.baseDay ?? series[0].day;
  const dataset = buildDatasetJsonLd({
    name: HEADLINE_INDEX_NAME,
    description: DESCRIPTION,
    path: INDEX_PAGE_PATH,
    csvPath: INDEX_CSV_PATH,
    license: INDEX_LICENSE_URL,
    temporalCoverage: `${series[0].day}/${headline.day}`,
    dateModified: headline.day,
  });
  const breadcrumb = buildBreadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Sealed Index", path: INDEX_PAGE_PATH },
  ]);

  return (
    <Shell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(dataset) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />

      <PageHeader
        title={HEADLINE_INDEX_NAME}
        provenance={
          <ProvenanceLine methodologyHref="/methodology#index">
            Equal-weighted index of {formatInteger(headline.nConstituents)} sealed products, base {INDEX_BASE_LEVEL} on{" "}
            {formatDateOnly(baseDay)}. Daily TCGplayer Market Prices, published for the previous UTC day.
          </ProvenanceLine>
        }
        actions={
          <a href={INDEX_CSV_PATH} download className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Download levels (CSV)
          </a>
        }
      />

      <section aria-labelledby="level-h" className="mt-6 rounded-card border border-line bg-surface p-4 md:p-5">
        <h2 id="level-h" className="sr-only">
          Level and changes
        </h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-4 lg:grid-cols-7">
          <Stat
            size="hero"
            className="col-span-2"
            label={<MetricLabel metric="indexLevel" />}
            value={formatDecimal(headline.level)}
            delta={<Delta value={headline.chg1d} period="1D" missingReason="No level the day before" />}
            asOf={<CloseOf day={headline.day} />}
          />
          <Stat label="7D" value={<Delta value={headline.chg7d} missingReason="No level 7 days earlier" />} />
          <Stat label="30D" value={<Delta value={headline.chg30d} missingReason="No level 30 days earlier" />} />
          <Stat label="1Y" value={<Delta value={headline.chg365d} missingReason="Less than a year of levels" />} />
          <Stat label={<MetricLabel metric="indexConstituents" />} value={formatInteger(headline.nConstituents)} />
          <Stat
            label={<MetricLabel metric="indexCoverage" />}
            value={formatPercent(headline.coveragePct, { decimals: 0 })}
            sub={`${formatInteger(headline.nContributing)} priced`}
          />
        </div>
      </section>

      {headline.provisional && (
        <Notice>
          Provisional: {formatInteger(headline.nContributing)} of {formatInteger(headline.nConstituents)} constituents (
          {formatPercent(headline.coveragePct, { decimals: 0 })}) were priced on {formatDateOnly(headline.day)}, under
          the {INDEX_RULES.provisionalBelowCoveragePct}% a full day needs. The level is published as computed and is not
          revised.{" "}
          <Link href="/methodology#index-calculation" prefetch={false} className={LINK}>
            How provisional days work
          </Link>
        </Notice>
      )}
      {isIndexOverdue(headline.day) && (
        <Notice>
          Not updated since {formatDateOnly(headline.day)}. The index is published each night for the previous day,
          and the latest run has not completed.
        </Notice>
      )}

      <section aria-labelledby="chart-h" className="mt-6 rounded-card border border-line bg-surface p-4 md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="chart-h" className="text-h3 font-semibold text-ink">
            Level history
          </h2>
          <RangeControl range={range} sort={sort} />
        </div>
        <IndexChart points={points} title={HEADLINE_INDEX_NAME} />
      </section>

      <BreadthBlock summary={headline} className="mt-6" />

      <section aria-labelledby="sub-h" className="mt-6">
        <h2 id="sub-h" className="text-h2 font-semibold text-ink">
          Sub-indices
        </h2>
        <p className="mt-1 text-small text-ink-soft">
          By product type, generation and set, <CloseOf day={headline.day} />. A set has an index once it has{" "}
          {INDEX_RULES.minConstituents} constituents.
        </p>
        {rows.length > 0 ? (
          <SubIndexTable rows={rows} range={range} sort={sort} className="mt-4" />
        ) : (
          <EmptyState className="mt-4" title="No sub-index has a level for this day" />
        )}
      </section>

      <p className="mt-8 max-w-3xl text-caption text-ink-soft">
        Index levels are Pokéfin&apos;s derived data, free to reuse under{" "}
        <a href={INDEX_LICENSE_URL} rel="license" className={LINK}>
          {INDEX_LICENSE_NAME}
        </a>{" "}
        with credit to Pokéfin. The download holds levels and breadth only, no product prices. Equal weight is not
        market value: every constituent counts the same.
      </p>
    </Shell>
  );
}
```

Do not add `export const dynamic`, `revalidate` or `generateStaticParams`: reading `searchParams` already makes the route dynamic, and the two reads are cached. Do not add `"use client"` to any file in `app/indices/`.

### Step 18. `frontend/app/indices/sealed/loading.tsx` (new)

```tsx
import Skeleton from "../../components/ui/Skeleton";

/** Flat bars at the page's heights, so nothing jumps when it arrives (no chart shape, no pulse). */
export default function SealedIndexLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:py-12" aria-busy="true">
      <span role="status" className="sr-only">
        Loading the Sealed Index
      </span>
      <div aria-hidden="true">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
        <div className="mt-6 rounded-card border border-line bg-surface p-4 md:p-5">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
            <Skeleton className="col-span-2 h-16" />
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        </div>
        <div className="mt-6 rounded-card border border-line bg-surface p-4 md:p-5">
          <Skeleton className="mb-4 h-6 w-40" />
          <Skeleton className="h-56 md:h-72" />
        </div>
        <div className="mt-6 rounded-card border border-line bg-surface p-4 md:p-5">
          <Skeleton className="h-20" />
        </div>
      </div>
    </main>
  );
}
```

### Step 19. `frontend/app/indices/sealed/levels.csv/route.ts` (new)

The folder is literally named `levels.csv`; the URL is `/indices/sealed/levels.csv`.

```ts
/**
 * GET /indices/sealed/levels.csv: the headline index's levels and breadth,
 * oldest first (WP29). Pokéfin's derived data under CC BY 4.0; no product
 * price is included (research/trust-seo-brand.md §9).
 *
 * Dynamic with a CDN lifetime rather than ISR: a param-less static route
 * would query Supabase during `next build` (WP11 rule), the reason WP26's
 * /api/public/rate is dynamic too. The read itself is cached
 * (getCachedIndexSeries, tag market-products).
 */
import { getCachedIndexSeries } from "../../../lib/serverMarketData";
import {
  HEADLINE_INDEX_CODE,
  INDEX_CSV_FILENAME,
  INDEX_LICENSE_URL,
  INDEX_PAGE_PATH,
  indexLevelsCsv,
} from "../../../lib/marketIndex";
import { absoluteUrl } from "../../../lib/site";

export const dynamic = "force-dynamic";

const CDN_CACHE = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";

export async function GET() {
  const points = await getCachedIndexSeries(HEADLINE_INDEX_CODE);
  if (points === null) {
    return new Response("Index levels are unavailable. Try again in a minute.\n", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const asOf = points.length ? points[points.length - 1].day : null;
  const body = indexLevelsCsv(points, { asOf, pageUrl: absoluteUrl(INDEX_PAGE_PATH) });
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${INDEX_CSV_FILENAME}"`,
      "cache-control": CDN_CACHE,
      link: `<${INDEX_LICENSE_URL}>; rel="license"`,
    },
  });
}
```

### Step 20. ESLint: the page's modules join WP26's public-route list (only if `PUBLIC_ROUTE_CLIENT_FILES` exists)

In `frontend/eslint.config.mjs`, append to `PUBLIC_ROUTE_CLIENT_FILES`:

```js
  "app/indices/**/*.{ts,tsx}",
  "app/lib/marketIndex.ts",
  "app/lib/indexChart.ts",
```

`page.tsx` imports `serverMarketData`, which the rule allows (it bans only the browser Supabase modules). `pnpm lint` must stay at 0 errors.

### Step 21. Performance: fixture, budgets, forbidden chunks

21a. `frontend/scripts/fixtures/perf.mjs`. Add this function directly above `buildPerfData` (it uses the file's `mulberry32`, `PERF_SEED` and `DAY_MS`):

```js
/**
 * WP29: the Sealed Index family (index_definitions, market_index_daily,
 * market_index_summary). Its own PRNG stream, so buildPerfData's draws and
 * every recorded limit keep their values. About 400 days ending yesterday
 * (UTC): Mondays only for the first 190 days (weekly resolution), then daily.
 * The newest headline day is not provisional; one day in the last 30 is.
 */
export function buildIndexFixture({ nowMs, generations, sets }) {
  const rand = mulberry32(PERF_SEED + 29);
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
  const todayMs = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate());
  const lastMs = todayMs - DAY_MS;
  const firstMs = lastMs - 400 * DAY_MS;
  let dailyFromMs = firstMs + 190 * DAY_MS;
  while (new Date(dailyFromMs).getUTCDay() !== 1) dailyFromMs += DAY_MS;
  const provisionalMs = lastMs - 12 * DAY_MS;

  const definitions = [
    { code: "sealed", name: "Pokéfin Sealed Index", kind: "headline", sort_order: 0, n: 212 },
    { code: "type-booster-box", name: "Booster Box Index", kind: "type", sort_order: 10, n: 41 },
    { code: "type-etb", name: "Elite Trainer Box Index", kind: "type", sort_order: 11, n: 58 },
    { code: "type-booster-bundle", name: "Booster Bundle Index", kind: "type", sort_order: 12, n: 30 },
    { code: "type-collections", name: "Collections Index", kind: "type", sort_order: 13, n: 37 },
    ...generations.slice(0, 5).map((g, i) => ({
      code: `gen-${g.id}`, name: `${g.name} Index`, kind: "generation", sort_order: 20, n: 18 + i * 9,
    })),
    ...sets
      .filter((s) => (lastMs - s.releaseMs) / DAY_MS >= 120)
      .slice(0, 40)
      .map((s) => ({ code: `set-${s.id}`, name: `${s.name} Index`, kind: "set", sort_order: 30, n: 3 + (s.id % 3) })),
  ];

  const indexDefinitions = [];
  const marketIndexDaily = [];
  const marketIndexSummary = [];
  for (const def of definitions) {
    // Sets and generations start later than the headline, like real set indices.
    const startMs = def.kind === "set" ? firstMs + Math.floor(rand() * 200) * DAY_MS : firstMs;
    const series = [];
    let level = 100;
    for (let ms = startMs; ms <= lastMs; ms += DAY_MS) {
      const weekly = ms <= dailyFromMs;
      if (weekly && new Date(ms).getUTCDay() !== 1) continue;
      if (series.length) level *= 1 + normal() * (weekly ? 0.018 : 0.006);
      const provisional = ms === provisionalMs;
      const contributing = provisional ? Math.floor(def.n * 0.64) : def.n - (rand() < 0.2 ? 1 : 0);
      const adv = Math.floor(def.n * (0.25 + rand() * 0.3));
      const dec = Math.floor((def.n - adv) * (0.3 + rand() * 0.4));
      series.push({
        index_code: def.code,
        day: isoDate(ms),
        level: Math.round(level * 1e6) / 1e6,
        n_constituents: def.n,
        n_contributing: contributing,
        coverage_pct: Math.round((1000 * contributing) / def.n) / 10,
        adv_7d: adv,
        dec_7d: dec,
        flat_7d: def.n - adv - dec,
        new_high_52w: Math.floor(rand() * Math.max(1, def.n / 12)),
        new_low_52w: Math.floor(rand() * Math.max(1, def.n / 20)),
        provisional,
        resolution: weekly ? "weekly" : "daily",
      });
    }
    marketIndexDaily.push(...series);
    indexDefinitions.push({
      code: def.code, name: def.name, kind: def.kind, filter: {}, base_day: series[0].day, sort_order: def.sort_order,
    });
    const latest = series[series.length - 1];
    const anchor = (days, tolerance) => {
      const hi = isoDate(lastMs - days * DAY_MS);
      const lo = isoDate(lastMs - (days + tolerance) * DAY_MS);
      const hit = [...series].reverse().find((r) => r.day <= hi && r.day >= lo);
      return hit ? ((latest.level / hit.level - 1) * 100) : null;
    };
    const previous = series[series.length - 2];
    marketIndexSummary.push({
      code: def.code,
      name: def.name,
      kind: def.kind,
      sort_order: def.sort_order,
      base_day: series[0].day,
      ...latest,
      chg_1d: previous && previous.day === isoDate(lastMs - DAY_MS) ? (latest.level / previous.level - 1) * 100 : null,
      chg_7d: anchor(7, 7),
      chg_30d: anchor(30, 7),
      chg_365d: anchor(365, 14),
    });
  }
  for (const row of marketIndexSummary) delete row.index_code;
  return { indexDefinitions, marketIndexDaily, marketIndexSummary };
}
```

In `buildPerfData`, directly above the final `return { ... };` (after every other table, so no earlier draw changes), add:

```js
  // WP29: Sealed Index family (own PRNG stream; see buildIndexFixture).
  const { indexDefinitions, marketIndexDaily, marketIndexSummary } = buildIndexFixture({ nowMs, generations, sets });
```

and add `indexDefinitions, marketIndexDaily, marketIndexSummary` to the returned object. In `perfRoutes()`, below the last `"/rest/v1/..."` entry, add:

```js
    "/rest/v1/market_index_summary": rows("marketIndexSummary"),
    "/rest/v1/market_index_daily": rows("marketIndexDaily"),
    "/rest/v1/index_definitions": rows("indexDefinitions"),
```

`applyPostgrest` supports every operator the two reads use (`eq`, `order` with two keys, `offset`/`limit` from `.range()`).

21b. `frontend/perf-budgets.json`: under `routes`, add (a new route is not a raise):

```json
    "/indices/sealed": {
      "source": "html",
      "jsGzKb": { "target": 150, "limit": null, "recorded": null },
      "documentBrKb": { "target": 40, "limit": null, "recorded": null }
    },
```

and under `rum.targets`:

```json
      "/indices/sealed": { "lcpMs": 1800, "inpMs": 150, "cls": 0.05, "ttfbMs": 600 },
```

(`ttfbMs` 600, not 400, because the route renders per request; the render reads cache only.)

21c. Only if `"forbiddenChunks"` exists (WP26): add `"/indices/sealed"` to `forbiddenChunks["supabase-js"].routes`, and add a second rule inside `forbiddenChunks`:

```json
    "recharts": {
      "markers": ["recharts-wrapper"],
      "routes": ["/indices/sealed"],
      "reason": "WP29: the index chart is server-rendered SVG; no charting library may load on this route (01-PRODUCT-DIRECTION.md §3.4)."
    }
```

The marker is the one `reachabilityControl` already proves reachable from `/product/900001`, so the rule cannot pass vacuously.

21d. Fill the limits with the perf build (Verification step 7).

21e. `frontend/scripts/prod-smoke-lib.mjs` (WP22): append `{ path: "/indices/sealed", minPrices: 0 },` to `PUBLIC_CHECKS` (the page shows index levels, not money, so the check is the status, the absence of WP22's error markers and no redirect). In `frontend/scripts/prod-smoke-lib.test.mjs`, add `assert.ok(PUBLIC_CHECKS.some((check) => check.path === "/indices/sealed"));` to the test that already imports `PUBLIC_CHECKS`, or to a new `test("WP29: the index page is smoke-checked", ...)` importing it. If WP22's file is missing, skip this step and say so in the PR.

### Step 22. Methodology and metric definitions

22a. `frontend/app/content/methodology.ts`:
- Note the current values: `grep -n "METHODOLOGY_VERSION = \|METHODOLOGY_EFFECTIVE_DATE = " app/content/methodology.ts` (call them `V_OLD` and `D_OLD`; `V_OLD` is `1.1` after WP25, `1.2` if WP28 merged first).
- Set `METHODOLOGY_VERSION` to the next minor version (`1.1` becomes `"1.2"`, `1.2` becomes `"1.3"`) and `METHODOLOGY_EFFECTIVE_DATE` to today (`date -u +%F`).
- In `METHODOLOGY_CHANGES`, the first row uses `METHODOLOGY_VERSION` and `METHODOLOGY_EFFECTIVE_DATE`: replace those two identifiers in that row with the literals `"V_OLD"` and `"D_OLD"`, then insert above it:

```ts
  {
    version: METHODOLOGY_VERSION,
    date: METHODOLOGY_EFFECTIVE_DATE,
    summary:
      "Publishes the Pokéfin Sealed Index family: equal-weighted, chain-linked daily indices with monthly constituents, clipped returns, provisional days, a weekly segment for backfilled history, and market breadth.",
  },
```

- Append to `METHODOLOGY_SUBSECTIONS`:

```ts
  { anchor: "index-constituents", title: "Constituents", parent: "index" },
  { anchor: "index-calculation", title: "Calculation and provisional days", parent: "index" },
  { anchor: "index-breadth", title: "Breadth", parent: "index" },
```

22b. `frontend/app/methodology/MethodologyArticle.tsx`:
- Imports: add `import Link from "next/link";` if absent, and

```ts
import {
  HEADLINE_INDEX_NAME,
  INDEX_BASE_LEVEL,
  INDEX_CHANGE_WINDOWS,
  INDEX_EXCLUDED_TYPE_PATTERNS,
  INDEX_LICENSE_NAME,
  INDEX_PAGE_PATH,
  INDEX_RULES,
  INDEX_TYPE_FAMILY,
} from "../lib/marketIndex";
```

- Replace the whole `<Section id="index">...</Section>` (WP24's placeholder) with:

```tsx
          <Section id="index">
            <p>
              The{" "}
              <Link href={INDEX_PAGE_PATH} prefetch={false} className={LINK}>
                {HEADLINE_INDEX_NAME}
              </Link>{" "}
              answers one question: is sealed Pokémon product up or down as a whole? It is an equal-weighted,
              chain-linked index of TCGplayer Market Prices, set to {INDEX_BASE_LEVEL} on its first day and published
              once a day for the previous UTC day. Equal weight means every constituent counts the same whatever its
              price. It is not weighted by market value: nobody publishes how many units of a sealed product exist.
            </p>
            <p>
              The family: the headline index; one index per product type (
              {INDEX_TYPE_FAMILY.map((t) => t.label).join(", ")}); one per generation; and one per set with at least{" "}
              {INDEX_RULES.minConstituents} constituents. Every sub-index is drawn from the headline&apos;s
              constituents. The levels download as a CSV under {INDEX_LICENSE_NAME}.
            </p>
            <Sub id="index-constituents">
              <p>
                Constituents are chosen once a month from each product&apos;s daily statistics on the last day before
                the month (the newest day within {INDEX_RULES.selectionLookbackDays} days of it), and do not change
                during the month. A product qualifies when, on that day:
              </p>
              <ul className="ml-5 list-disc space-y-1">
                <li>its price is shown, not withheld under the {PRICE_STALENESS_TOLERANCE_DAYS}-day rule;</li>
                <li>its Market Price is at least ${INDEX_RULES.minPriceUsd} USD;</li>
                <li>
                  it had at least {INDEX_RULES.minDistinctPrices365d} different daily prices in the past year, which
                  screens out products that barely trade;
                </li>
                <li>its set was released at least {INDEX_RULES.minDaysSinceRelease} days before the month;</li>
                <li>
                  it is not a booster pack (product types containing{" "}
                  {INDEX_EXCLUDED_TYPE_PATTERNS.map((p) => `"${p}"`).join(" or ")}).
                </li>
              </ul>
              <p>
                A month&apos;s list is never rewritten and published levels are never recomputed, so a product that
                later leaves the catalog keeps its past contribution. The months before the index was first published
                were rebuilt in one run from the products still in the catalog on that day, so products removed
                earlier are missing from those months, which can flatter that history slightly.
              </p>
            </Sub>
            <Sub id="index-calculation">
              <p>
                Each day, a constituent&apos;s return is its Market Price that day divided by its price the day
                before, minus 1, capped at plus or minus {INDEX_RULES.returnClipPercent}% so one bad print cannot move
                the index. The level is the previous level × (1 + the average of those returns).
              </p>
              <p>
                A price that was not updated is carried for up to {INDEX_RULES.dailyCarryMaxDays} days, as a return
                of 0. A constituent whose price is older drops out, and rejoins the day after it is priced again
                without the move it made while out.
              </p>
              <p>
                Coverage is the share of constituents with a return that day. Below{" "}
                {INDEX_RULES.provisionalBelowCoveragePct}% the day is provisional: its level is published as computed
                and is not revised later.
              </p>
              <p>
                History from before daily collection began is weekly: returns run Monday to Monday, a price is carried
                for up to {INDEX_RULES.weeklyCarryMaxDays} days, and the chart draws those points dashed. Those prices
                were backfilled from TCGplayer&apos;s price history, which for most of that year gives one price per
                week spread over its seven days, so daily steps there would be artefacts.
              </p>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={TH}>Change</th>
                    <th className={TH}>Compared with</th>
                  </tr>
                </thead>
                <tbody>
                  {INDEX_CHANGE_WINDOWS.map((w) => (
                    <tr key={w.key} data-index-window={w.label}>
                      <td className={TD}>{w.label}</td>
                      <td className={TD}>
                        {w.toleranceDays === 0
                          ? "the level of the previous day"
                          : `the newest level ${w.days} to ${w.days + w.toleranceDays} days earlier`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                Without such a level the change shows <code>--</code>. Market Price is a smoothed average of completed
                sales, so the index is smoother than any portfolio you could hold. If collection stops for more than{" "}
                {INDEX_RULES.dailyCarryMaxDays} days, moves during the stop are not captured and those days are
                provisional. The nightly job fills at most {INDEX_RULES.maxCatchUpDays} missed days.
              </p>
            </Sub>
            <Sub id="index-breadth">
              <p>
                Breadth shows whether a move is broad or carried by a few products. Among the constituents whose price
                is shown that day, advancers rose more than {INDEX_RULES.breadthFlatBandPct}% over 7 days, decliners
                fell more than {INDEX_RULES.breadthFlatBandPct}%, and the rest are unchanged. The 7-day change is the
                one described under <a href="#returns" className={LINK}>Returns</a>.
              </p>
              <p>
                New 52-week highs and lows count constituents whose{" "}
                <a href="#range-52w" className={LINK}>
                  52-week high or low
                </a>{" "}
                was set in the last 7 days. Only products tracked for at least {INDEX_RULES.newHighMinTrackedDays} days
                count, so a young product is not a new high by default.
              </p>
            </Sub>
          </Section>
```

`LINK`, `TH`, `TD`, `Sub` and `PRICE_STALENESS_TOLERANCE_DAYS` already exist in the file (WP24). Check: `LC_ALL=C.UTF-8 grep -cP '\x{2014}' app/methodology/MethodologyArticle.tsx` prints 0.

22c. `frontend/app/lib/metricDefinitions.ts`:
- Add the import `import { INDEX_BASE_LEVEL, INDEX_RULES } from "./marketIndex";`
- Append these entries at the end of `DEFINITIONS` (after the last WP25 or WP28 entry):

```ts
  // Sealed Index (WP29, market_index_daily)
  def({ key: "indexLevel", label: "Index level", unitLabel: "points", window: "since the base day", short: `Equal-weighted, chain-linked level of the constituents' Market Prices; ${INDEX_BASE_LEVEL} on the first day.`, anchor: "index" }),
  def({ key: "indexConstituents", label: "Constituents", unitLabel: "products", window: "this month", short: "Products in the index this month, chosen before the month starts by fixed rules.", anchor: "index-constituents" }),
  def({ key: "indexCoverage", label: "Coverage", unitLabel: "%", window: "the day shown", short: `Share of constituents priced that day and the day before. Under ${INDEX_RULES.provisionalBelowCoveragePct}% the day is provisional.`, anchor: "index-calculation" }),
  def({ key: "breadth7d", label: "Breadth (7D)", unitLabel: "products", window: "7 days", short: `Constituents up or down more than ${INDEX_RULES.breadthFlatBandPct}% over 7 days, and those in between.`, anchor: "index-breadth" }),
  def({ key: "newHighs52w", label: "New 52-week highs", unitLabel: "products", window: "last 7 days", short: "Constituents that set a 52-week high in the last 7 days.", anchor: "index-breadth" }),
  def({ key: "newLows52w", label: "New 52-week lows", unitLabel: "products", window: "last 7 days", short: "Constituents that set a 52-week low in the last 7 days.", anchor: "index-breadth" }),
```

Each `short` is under 120 characters and free of WP24's banned words. Change no existing entry.

### Step 23. Sitemap and navigation

23a. `frontend/app/sitemap.ts`: in `STATIC_ROUTES`, directly after the `/analytics` entry, add `{ path: "/indices/sealed", changeFrequency: "daily", priority: 0.7 },`.

23b. `frontend/app/components/nav/navConfig.ts` (WP27; skip if absent): below `SETS`, add

```ts
export const SEALED_INDEX: NavLink = {
  key: "sealed-index",
  label: "Sealed Index",
  href: "/indices/sealed",
  description: "Is sealed up? The daily index and market breadth",
  match: ["/indices"],
};
```

change `FOOTER_BROWSE` to `[PRICES, SCREENER, SETS, SEALED_INDEX, METHODOLOGY]`, add `"sealed-index": ["index", "sealed index", "benchmark", "breadth", "market"],` to `PAGE_KEYWORDS`, and in `SEARCH_PAGES` insert `SEALED_INDEX,` directly after `...PRIMARY_NAV,`. The primary nav does not change (the index lives in the home header from WP32).

23c. Update the tests that list those links: `app/components/__tests__/Footer.test.tsx` (Browse links become Prices, Screener, Sets, Sealed Index `/indices/sealed`, Methodology) and, if a WP27 test asserts the `SEARCH_PAGES` keys or count, add `sealed-index` after the primary entries.

### Step 24. Phase B: generated types

After the owner has applied 0042 (Owner action 1):

```bash
cd frontend
SUPABASE_ACCESS_TOKEN=... pnpm types:db          # or use the file the owner pushed
grep -oE "market_index_daily|market_index_summary|index_definitions|index_constituents|refresh_market_index" app/types/database.ts | sort -u | wc -l   # 5
pnpm exec tsc --noEmit                            # exit 0
```

Do not edit the generated file. The view columns come out nullable, which `IndexSummaryRow` accepts; numeric columns come out as `number`, which `IndexDailyRow` accepts. If `tsc` still rejects a row type, adjust the row interface in `marketIndex.ts`, not the generated file, and say so in the PR.

### Step 25. Documentation

25a. `README.md`, section "One-time backfills": append to the code block

```bash
python scripts/backfill_market_index.py    # Sealed Index levels from the start of product_daily_stats (WP29; after backfill_daily_stats.py)
```

25b. `README.md`, WP25's "Market analytics tables" subsection: append

```markdown
- `index_definitions`, `index_constituents`, `market_index_daily`,
  `market_index_settings` and the view `market_index_summary` (WP29): the
  Pokéfin Sealed Index family. `refresh_market_index(p_day)` publishes the
  previous UTC day from `product_daily_stats`; the pg_cron job
  `pokefin-publish-market-index` runs it at 00:45 UTC and the scraper calls
  it after each run. Published days are never recomputed; to rebuild after a
  rule change run `SELECT public.reset_market_index();` then
  `scripts/backfill_market_index.py`. Rules: `migrations/0042_market_index.sql`
  and `/methodology#index`.
```

25c. `audits/HARDENING_FOLLOWUPS.md` section 7: add as the newest migration bullet:

```markdown
- **Migration 0042: pending apply** (WP29). Sealed Index tables, the view
  `market_index_summary`, `refresh_market_index(date, boolean)` and
  `market_index_backfill_range()` (SECURITY DEFINER, EXECUTE for
  pokefin_scraper and service_role), `reset_market_index()` (service_role
  only), and the pg_cron job `pokefin-publish-market-index` (scheduled only
  when pg_cron is enabled). Additive; no existing object changes.
```

## Pitfalls: do not do this

- **Do not recompute published days.** `refresh_market_index` returns `already_published` for the newest published day and any older one, and writes nothing; do not add a "force" parameter, a cascade, or a trigger that rewrites later levels. A rule change is a reset plus a backfill (Owner action 6), documented as a methodology version.
- **Do not select constituents with today's `products.active` or today's price.** The list comes from `product_daily_stats` on the selection day before the month, and a product counts on a day when it has a stats row. Filtering history by the current catalog is survivorship bias.
- **Do not read `product_price_history` in the index.** Every input is a `product_daily_stats` row, which already applies the 0023 freshness gate and the agreement check. Only `market_index_detect_daily_from` reads price timestamps, once.
- **Do not let a stale price contribute.** `q` needs `is_price_fresh` and a `price_day` inside the carry window on both days of a return; keep the `CASE` exactly as written.
- **Do not take a return across a gap longer than the carry.** The constituent drops out and re-enters the day after it is priced again. "Catching up" the missed move is what the rule forbids.
- **Do not use floating point for levels.** `usd_price::numeric`, `avg` over numeric and `round(..., 6)` make a replay reproduce every digit; `double precision` would drift with row order.
- **Do not publish today.** The function rejects `p_day >= today (UTC)`; the page, the CSV and the API only ever show D-1 or earlier.
- **Do not call anything cap-weighted, market-cap or value-weighted**, and never "live", "real-time" or "all-time" (copy, comments, JSON-LD, CSV header lines). Equal weight is stated as such.
- **Do not re-run an older migration that defines `refresh_market_analytics` to "fix" the index.** 0042 does not replace it; it only calls it.
- **Do not grant table privileges to `pokefin_scraper`.** It writes through `refresh_market_index` only; `reset_market_index` is `service_role` only.
- **Do not put GRANT or REVOKE on several tables in one statement**: `verify_migration.py` refuses to parse it.
- **Do not add `"use client"`, Recharts, `useEffect` or a client fetch under `app/indices/`.** The page test and (with WP26) the forbidden-chunk gate fail. Range and sort are links.
- **Do not add `export const dynamic = "force-static"` to the page**: Next then passes empty `searchParams` and the range and sort links stop working. Do not add `generateStaticParams` to the CSV route (a param-less static route queries Supabase at build).
- **Do not call `getCachedIndexSummary` or `getCachedIndexSeries` inside another `unstable_cache` callback** (WP11's nested-cache rule), and do not return an empty list from a failed read: `null` is the error signal. Keep `INDEX_REFRESH_SECONDS` at 3600: with the daily backstop, a night when the scraper host is off leaves D-2 on the page all day.
- **Do not pass `p_start` from the scraper or pg_cron.** It lets a call start a chain and cross more than 31 days; only `scripts/backfill_market_index.py` may use it.
- **Do not add `transition-colors` to the range or sort links.** `01-PRODUCT-DIRECTION.md` §3.5 allows opacity and transform transitions only.
- **Do not include product prices in the CSV or the API.** Levels and breadth counts only (`research/trust-seo-brand.md` §9).
- **Do not retype a number in `/methodology` copy.** Every threshold is interpolated from `INDEX_RULES`, `INDEX_CHANGE_WINDOWS` or `INDEX_TYPE_FAMILY`, and `marketIndexConstants.test.ts` ties them to the SQL.
- **Do not raise a perf `target`**, and do not raise a `limit` without a `Perf budget raise:` line (WP22 rule). This page should measure at the shared-bundle size.
- **Do not point `POKEFIN_TEST_DATABASE_URL` at production or run the backfill from CI.** The DB module resets the index tables and changes the `pokefin_scraper` password.
- **Do not edit `verify_migration.py`, `schema.sql`, `app/types/database.ts` or any existing migration**, and do not apply migrations to production yourself (Owner actions).

## Tests

### Database and Python

1. `tests/test_wp29_market_index_db.py` (new; needs the replayed database; skipped without `POKEFIN_TEST_DATABASE_URL`; CI's "Database replay and Python tests" job runs it). One fixed history (2024-01-01 to 2025-02-28), one set per scenario, the live path run day by day, then assertions. It passed 23 of 23, twice in a row on the same database (it cleans up after itself; the gap test runs inside a rolled-back transaction), against 0038 and 0039 from WP25 and this 0042.

```python
"""
Database checks for migration 0042 (the Pokéfin Sealed Index family), run
against a database rebuilt by scripts/db/replay_migrations.sh.

Skipped unless POKEFIN_TEST_DATABASE_URL points at that replayed database as a
superuser (CI sets it; job "database"). NEVER point it at production: the
fixtures write rows, reset the index tables and change the pokefin_scraper
password.

One module-scoped history (2024-01-01 to 2025-02-28, fixed dates) is built
once; every scenario lives in its own set, so each set index isolates one rule:

  A  chain-linking arithmetic and the weekly segment
  B  clipping at +-50%
  C  gap carry (3 days) and drop-out without catch-up (5 days), provisional
  D  a stale constituent (cached price disagrees) never contributes
  F  constituent rules and the monthly freeze
  G  a set younger than 90 days joins later, at base 100
  H  52-week highs and lows, breadth
  plus call semantics: already_published for the newest day, 'behind' for the
  nightly call after a month without a list, and the backfill crossing it

  POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/replay_once \
    python -m pytest tests/test_wp29_market_index_db.py -v
"""
import importlib.util
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import pytest

DSN = os.environ.get("POKEFIN_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="POKEFIN_TEST_DATABASE_URL not set")

psycopg = pytest.importorskip("psycopg")
from psycopg import errors  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
TAG = "wp29-" + uuid.uuid4().hex[:8]
SCRAPER_PASSWORD = "ci-only-" + uuid.uuid4().hex

D = date.fromisoformat
HISTORY_START = D("2024-10-01")
LONG_HISTORY_START = D("2024-01-01")
DAILY_FROM = D("2025-01-06")          # a Monday: first day of scraped rows
STATS_START = D("2024-11-20")
INDEX_START = D("2024-12-02")         # first Monday with a December list
LAST_DAY = D("2025-02-28")
SIX = Decimal("0.000001")


def days(start, end):
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def monday_of(day):
    return day - timedelta(days=day.weekday())


def base_price(day, base=30):
    """Weekly-constant prices; three distinct values in Oct-Nov 2024 (liquidity screen)."""
    if day < D("2024-12-01"):
        week = (monday_of(day) - monday_of(HISTORY_START)).days // 7
        return base + week % 3
    return base


def build(path_fn, start=HISTORY_START, end=LAST_DAY, skip=()):
    return {d: path_fn(d) for d in days(start, end) if d not in skip}


# --------------------------------------------------------------- price paths

def path_a1(d):
    if d < D("2024-12-09"):
        return base_price(d)
    if d < D("2025-02-01"):
        return 33
    return 40 if d < D("2025-02-03") else 44


def path_a2(d):
    if d < D("2024-12-09"):
        return base_price(d)
    if d < D("2025-02-01"):
        return 33
    return 50 if d < D("2025-02-03") else 55


def path_a3(d):
    if d < D("2025-02-01"):
        return base_price(d)
    return 60 if d < D("2025-02-03") else 57


def path_b1(d):
    if d < D("2025-02-10"):
        return base_price(d)
    if d < D("2025-02-12"):
        return 120
    return 48


def path_c3(d):
    return base_price(d) if d < D("2025-02-18") else 33


def path_c4(d):
    return base_price(d) if d < D("2025-02-26") else 45


def path_d3(d):
    return base_price(d) if d < LAST_DAY else 45


def path_f1(d):
    if d < D("2025-01-01"):
        return 10 + ((monday_of(d) - monday_of(HISTORY_START)).days // 7) % 3
    return 20


def path_f3(d):
    return 30 + ((monday_of(d) - monday_of(HISTORY_START)).days // 7) % 2


def path_h(kind):
    """A year of 28/29/30 weekly prices, flat 30 from Feb 3, then a new high or low from Feb 17."""
    def f(d):
        if d < D("2025-02-03"):
            return 28 + ((monday_of(d) - LONG_HISTORY_START).days // 7) % 3
        if d >= D("2025-02-17"):
            return {"up": 40, "down": 20, "flat": 30}[kind]
        return 30
    return f


# ------------------------------------------------------------------ fixtures


@pytest.fixture(scope="module")
def admin():
    host = (urlparse(DSN).hostname or "").lower()
    assert host in ("localhost", "127.0.0.1", "postgres"), "refusing a non-local database"
    with psycopg.connect(DSN, autocommit=True) as conn:
        yield conn


def scalar(admin, query, params=()):
    return admin.execute(query, params).fetchone()[0]


def refresh_index(admin, day, start=False):
    return scalar(admin, "SELECT public.refresh_market_index(%s, %s)", (day, start))


def level_rows(admin):
    """Every published row except computed_at, for exact comparison."""
    return admin.execute(
        "SELECT index_code, day, level, n_constituents, n_contributing, coverage_pct, adv_7d, dec_7d, "
        "flat_7d, new_high_52w, new_low_52w, provisional, resolution "
        "FROM public.market_index_daily ORDER BY index_code, day"
    ).fetchall()


@pytest.fixture(scope="module")
def world(admin):
    """Catalog, price history, stats and the live-path index run. Cleans up after."""
    admin.execute("SELECT public.reset_market_index()")
    admin.execute("DELETE FROM public.market_index_settings")
    admin.execute(
        "INSERT INTO public.market_index_settings (id, daily_from, source) VALUES (true, %s, 'owner')",
        (DAILY_FROM,),
    )
    gen = scalar(admin, "INSERT INTO public.generations (name) VALUES (%s) RETURNING id", (TAG + " gen",))
    main_type = scalar(admin, "INSERT INTO public.product_types (name, label) VALUES (%s, 'WP29') RETURNING id", (TAG,))
    pack_type = scalar(
        admin, "INSERT INTO public.product_types (name, label) VALUES (%s, 'Booster Pack') RETURNING id",
        (TAG + "-booster_pack",))

    sets = {}
    for key in "ABCDFGH":
        release = D("2024-10-15") if key == "G" else D("2023-06-01")
        sets[key] = scalar(
            admin,
            "INSERT INTO public.sets (code, name, release_date, generation_id) VALUES (%s, %s, %s, %s) RETURNING id",
            (f"{TAG}-{key}", f"{TAG} set {key}", release, gen),
        )

    products = {}

    def product(name, set_key, prices, *, type_id=main_type, cached=None):
        newest = prices[max(prices)]
        pid = scalar(
            admin,
            "INSERT INTO public.products (set_id, product_type_id, usd_price, url, last_updated) "
            "VALUES (%s, %s, %s, %s, now()) RETURNING id",
            (sets[set_key], type_id, newest if cached is None else cached,
             f"https://www.tcgplayer.com/product/{uuid.uuid4().int % 10**9}"),
        )
        rows = [
            # Backfilled rows are stamped at exactly 12:00; scraped rows carry a scrape time.
            (pid, float(usd), f"{day} 12:00:00" if day < DAILY_FROM else f"{day} 03:17:42.123456")
            for day, usd in sorted(prices.items())
        ]
        with admin.cursor() as cur:
            cur.executemany(
                "INSERT INTO public.product_price_history (product_id, usd_price, recorded_at) "
                "VALUES (%s, %s, %s::timestamp)", rows)
        products[name] = pid
        return pid

    product("a1", "A", build(path_a1))
    product("a2", "A", build(path_a2))
    product("a3", "A", build(path_a3))
    product("b1", "B", build(path_b1))
    product("b2", "B", build(base_price))
    product("b3", "B", build(base_price))
    product("c1", "C", build(base_price))
    product("c2", "C", build(base_price))
    product("c3", "C", build(path_c3, skip={D("2025-02-15"), D("2025-02-16"), D("2025-02-17")}))
    product("c4", "C", build(path_c4, skip=set(days(D("2025-02-21"), D("2025-02-25")))))
    product("d1", "D", build(base_price))
    product("d2", "D", build(base_price))
    product("d3", "D", build(path_d3), cached=999.0)
    product("f1", "F", build(path_f1))
    product("f2", "F", build(base_price), type_id=pack_type)
    product("f3", "F", build(path_f3))
    product("f4", "F", build(base_price))
    product("f5", "F", build(base_price))
    product("f6", "F", build(base_price))
    product("g1", "G", build(base_price))
    product("g2", "G", build(base_price))
    product("g3", "G", build(base_price))
    product("h1", "H", build(path_h("up"), start=LONG_HISTORY_START))
    product("h2", "H", build(path_h("down"), start=LONG_HISTORY_START))
    product("h3", "H", build(path_h("flat"), start=LONG_HISTORY_START))

    for day in days(STATS_START, LAST_DAY):
        admin.execute("SELECT public.refresh_market_analytics(%s)", (day,))

    # The live path: start the chain, then one call per day, as pg_cron would.
    results = [refresh_index(admin, INDEX_START, True)]
    for day in days(INDEX_START + timedelta(days=1), LAST_DAY):
        results.append(refresh_index(admin, day))

    yield {"sets": sets, "products": products, "gen": gen, "results": results,
           "types": (main_type, pack_type)}

    admin.execute("SELECT public.reset_market_index()")
    admin.execute("DELETE FROM public.market_index_settings")
    ids = list(products.values())
    admin.execute("DELETE FROM public.product_daily_stats WHERE product_id = ANY(%s) OR day BETWEEN %s AND %s",
                  (ids, STATS_START, LAST_DAY))
    admin.execute("DELETE FROM public.product_price_history WHERE product_id = ANY(%s)", (ids,))
    admin.execute("DELETE FROM public.products WHERE id = ANY(%s)", (ids,))
    admin.execute("DELETE FROM public.sets WHERE id = ANY(%s)", (list(sets.values()),))
    admin.execute("DELETE FROM public.product_types WHERE id IN (%s, %s)", (main_type, pack_type))
    admin.execute("DELETE FROM public.generations WHERE id = %s", (gen,))


def code(world, key):
    return f"set-{world['sets'][key]}"


def row(admin, index_code, day):
    cur = admin.execute(
        "SELECT * FROM public.market_index_daily WHERE index_code = %s AND day = %s", (index_code, day))
    names = [c.name for c in cur.description]
    found = cur.fetchone()
    return dict(zip(names, found)) if found else None


def chained(prev_level, mean_return):
    """prev x (1 + mean), as stored (6 decimals). Compare with close(): the last digit can differ."""
    return (prev_level * (1 + Decimal(mean_return))).quantize(SIX, rounding=ROUND_HALF_UP)


def close(actual, expected):
    return abs(actual - expected) <= SIX


def members(admin, index_code, month, world):
    ids = [r[0] for r in admin.execute(
        "SELECT product_id FROM public.index_constituents WHERE index_code = %s AND month = %s",
        (index_code, month)).fetchall()]
    by_id = {v: k for k, v in world["products"].items()}
    return sorted(by_id[i] for i in ids)


# ------------------------------------------------------------ the live path


def test_every_live_call_succeeded(world):
    assert all(r["status"] == "ok" for r in world["results"]), world["results"][:3]


def test_weekly_segment_is_mondays_only_then_daily(admin, world):
    rows = admin.execute(
        "SELECT day, resolution FROM public.market_index_daily WHERE index_code = %s ORDER BY day",
        (code(world, "A"),)).fetchall()
    weekly = [d for d, res in rows if res == "weekly"]
    daily = [d for d, res in rows if res == "daily"]
    assert weekly == [D("2024-12-02"), D("2024-12-09"), D("2024-12-16"), D("2024-12-23"),
                      D("2024-12-30"), D("2025-01-06")]
    assert daily == days(D("2025-01-07"), LAST_DAY)


def test_base_and_weekly_monday_to_monday_return(admin, world):
    a = code(world, "A")
    assert row(admin, a, D("2024-12-02"))["level"] == Decimal("100.000000")
    # Dec 9: a1 and a2 +10% on the week, a3 flat.
    assert close(row(admin, a, D("2024-12-09"))["level"], chained(Decimal(100), Decimal("0.2") / 3))
    assert scalar(admin, "SELECT base_day FROM public.index_definitions WHERE code = %s", (a,)) == INDEX_START


def test_daily_chain_linking_arithmetic(admin, world):
    a = code(world, "A")
    prev = row(admin, a, D("2025-02-02"))["level"]
    today = row(admin, a, D("2025-02-03"))
    # +10%, +10%, -5%: mean +5%.
    assert close(today["level"], chained(prev, Decimal("0.05")))
    assert today["n_contributing"] == 3 and today["coverage_pct"] == Decimal("100.0")
    assert today["provisional"] is False


def test_returns_are_clipped_at_50_percent(admin, world):
    b = code(world, "B")
    # b1 30 -> 120 (+300%) counts as +50%; b2, b3 flat.
    assert close(row(admin, b, D("2025-02-10"))["level"],
                 chained(row(admin, b, D("2025-02-09"))["level"], Decimal("0.5") / 3))
    # b1 120 -> 48 (-60%) counts as -50%.
    assert close(row(admin, b, D("2025-02-12"))["level"],
                 chained(row(admin, b, D("2025-02-11"))["level"], Decimal("-0.5") / 3))


def test_a_three_day_gap_is_carried(admin, world):
    c = code(world, "C")
    for day in days(D("2025-02-15"), D("2025-02-17")):
        r = row(admin, c, day)
        assert r["n_contributing"] == 4 and r["provisional"] is False, day
    # c3 reprices +10% after the gap: the whole move lands on Feb 18.
    assert close(row(admin, c, D("2025-02-18"))["level"],
                 chained(row(admin, c, D("2025-02-17"))["level"], Decimal("0.1") / 4))


def test_a_longer_gap_drops_out_and_reenters_without_a_catch_up_jump(admin, world):
    c = code(world, "C")
    for day in days(D("2025-02-21"), D("2025-02-23")):
        assert row(admin, c, day)["n_contributing"] == 4, day        # carried up to 3 days
    for day in days(D("2025-02-24"), D("2025-02-26")):
        r = row(admin, c, day)
        assert r["n_contributing"] == 3, day
        assert r["coverage_pct"] == Decimal("75.0") and r["provisional"] is True, day
    # c4 comes back at +50% on Feb 26: no return that day, so no jump.
    assert row(admin, c, D("2025-02-26"))["level"] == row(admin, c, D("2025-02-25"))["level"]
    feb27 = row(admin, c, D("2025-02-27"))
    assert feb27["n_contributing"] == 4 and feb27["provisional"] is False
    assert feb27["level"] == row(admin, c, D("2025-02-26"))["level"]


def test_a_stale_constituent_never_contributes(admin, world):
    d3 = world["products"]["d3"]
    assert scalar(admin, "SELECT is_price_fresh FROM public.product_daily_stats WHERE day = %s AND product_id = %s",
                  (LAST_DAY, d3)) is False
    d = code(world, "D")
    last = row(admin, d, LAST_DAY)
    # d3's +50% print is withheld (products.usd_price disagrees): level unchanged.
    assert last["level"] == row(admin, d, LAST_DAY - timedelta(days=1))["level"]
    assert last["n_contributing"] == 2 and last["coverage_pct"] == Decimal("66.7")
    assert last["provisional"] is True


def test_constituent_rules(admin, world):
    f = code(world, "F")
    dec, jan, feb = D("2024-12-01"), D("2025-01-01"), D("2025-02-01")
    # f1 under $15, f2 a booster pack, f3 only two distinct prices.
    assert members(admin, f, dec, world) == ["f4", "f5", "f6"]
    assert members(admin, f, jan, world) == ["f4", "f5", "f6"]
    # f1 is $20 on the January 31 selection day.
    assert members(admin, f, feb, world) == ["f1", "f4", "f5", "f6"]
    headline_dec = members(admin, "sealed", dec, world)
    assert not {"f1", "f2", "f3"} & set(headline_dec)


def test_sub_indices_are_subsets_of_the_headline(admin, world):
    assert scalar(admin, """
        SELECT count(*) FROM public.index_constituents c
         WHERE c.index_code <> 'sealed'
           AND NOT EXISTS (SELECT 1 FROM public.index_constituents h
                            WHERE h.index_code = 'sealed' AND h.month = c.month
                              AND h.product_id = c.product_id)""") == 0


def test_a_young_set_joins_after_90_days_at_base_100(admin, world):
    g = code(world, "G")
    assert members(admin, g, D("2024-12-01"), world) == []
    assert members(admin, g, D("2025-01-01"), world) == []
    assert members(admin, g, D("2025-02-01"), world) == ["g1", "g2", "g3"]
    first = admin.execute(
        "SELECT min(day) FROM public.market_index_daily WHERE index_code = %s", (g,)).fetchone()[0]
    assert first == D("2025-02-01")
    assert row(admin, g, first)["level"] == Decimal("100.000000")
    assert row(admin, g, first)["n_contributing"] == 3


def test_generation_index_exists_and_names_follow_the_catalog(admin, world):
    name = scalar(admin, "SELECT name FROM public.index_definitions WHERE code = %s", (f"gen-{world['gen']}",))
    assert name == f"{TAG} gen Index"
    # Newest first within a kind: sort_order counts days to 2100-01-01 from the release.
    order = dict(admin.execute(
        "SELECT code, sort_order FROM public.index_definitions WHERE code = ANY(%s)",
        ([code(world, "A"), code(world, "G"), f"gen-{world['gen']}"],)).fetchall())
    assert order[code(world, "G")] == (D("2100-01-01") - D("2024-10-15")).days
    assert order[code(world, "G")] < order[code(world, "A")]
    assert order[f"gen-{world['gen']}"] == order[code(world, "G")]


def test_new_52_week_highs_and_lows_and_breadth(admin, world):
    h = code(world, "H")
    assert row(admin, h, D("2025-02-18"))["new_high_52w"] == 0     # 2 of 3 days: not yet a high
    feb19 = row(admin, h, D("2025-02-19"))
    assert (feb19["new_high_52w"], feb19["new_low_52w"]) == (1, 1)
    assert row(admin, h, D("2025-02-25"))["new_high_52w"] == 1     # set within the last 7 days
    assert row(admin, h, D("2025-02-26"))["new_high_52w"] == 0
    assert (feb19["adv_7d"], feb19["dec_7d"], feb19["flat_7d"]) == (1, 1, 1)
    # Set A has under 364 days of history: never a 52-week high.
    assert scalar(admin, "SELECT max(new_high_52w) FROM public.market_index_daily WHERE index_code = %s",
                  (code(world, "A"),)) == 0


def test_summary_view_changes(admin, world):
    a = code(world, "A")
    cur = admin.execute("SELECT * FROM public.market_index_summary WHERE code = %s", (a,))
    names = [c.name for c in cur.description]
    s = dict(zip(names, cur.fetchone()))
    assert s["day"] == LAST_DAY and s["kind"] == "set"
    last = row(admin, a, LAST_DAY)["level"]
    week = row(admin, a, LAST_DAY - timedelta(days=7))["level"]
    month = row(admin, a, LAST_DAY - timedelta(days=30))["level"]
    assert s["chg_1d"] == pytest.approx(0.0)
    assert s["chg_7d"] == pytest.approx(float((last / week - 1) * 100))
    assert s["chg_30d"] == pytest.approx(float((last / month - 1) * 100))
    assert s["chg_365d"] is None                                   # no level a year earlier


# ------------------------------------------------------------ call semantics


def test_rerunning_the_newest_day_changes_nothing(admin, world):
    before = level_rows(admin)
    result = refresh_index(admin, LAST_DAY)
    assert result["status"] == "already_published" and result["last_day"] == str(LAST_DAY)
    assert level_rows(admin) == before


def test_published_days_are_never_recomputed(admin, world):
    before = level_rows(admin)
    result = refresh_index(admin, D("2025-02-10"))
    assert result["status"] == "already_published" and result["last_day"] == str(LAST_DAY)
    assert level_rows(admin) == before


def test_a_long_gap_is_reported_not_skipped(admin, world):
    result = refresh_index(admin, LAST_DAY + timedelta(days=40))
    assert result["status"] == "behind"


def test_the_backfill_crosses_a_month_without_a_list(admin, world):
    # No price after Feb 28: March keeps its list (selected on Feb 28), April
    # gets none (every price is older than 14 days on its selection day), so
    # the newest level stops at Mar 31. The nightly call stays 'behind'; the
    # backfill (p_start) crosses the gap. Rolled back: later tests see Feb 28.
    target = LAST_DAY + timedelta(days=40)
    with admin.transaction(force_rollback=True):
        assert refresh_index(admin, target)["status"] == "behind"
        result = refresh_index(admin, target, True)
        assert result["status"] == "ok" and result["from"] == str(LAST_DAY + timedelta(days=1))
        a = code(world, "A")
        assert scalar(admin, "SELECT max(day) FROM public.market_index_daily WHERE index_code = 'sealed'") == D("2025-03-31")
        assert row(admin, a, D("2025-03-04"))["provisional"] is True      # carried 3 days, then out
        assert row(admin, a, D("2025-03-31"))["level"] == row(admin, a, LAST_DAY)["level"]
    assert scalar(admin, "SELECT max(day) FROM public.market_index_daily") == LAST_DAY


def test_input_validation(admin, world):
    for bad in (None, datetime.now(timezone.utc).date(), D("2019-12-31")):
        with pytest.raises(errors.InvalidParameterValue):
            refresh_index(admin, bad)


def test_detection_of_daily_resolution(admin, world):
    ids = [world["products"][k] for k in ("a1", "a2", "a3")]
    assert scalar(admin, "SELECT public.market_index_detect_daily_from(%s)", (ids,)) == DAILY_FROM


def test_levels_are_reproducible_from_a_clean_backfill(admin, world):
    before = level_rows(admin)
    frozen = admin.execute(
        "SELECT index_code, month, product_id FROM public.index_constituents ORDER BY 1, 2, 3").fetchall()
    admin.execute("SELECT public.reset_market_index()")
    assert refresh_index(admin, LAST_DAY)["status"] == "not_initialised"

    spec = importlib.util.spec_from_file_location("backfill_market_index",
                                                  ROOT / "scripts" / "backfill_market_index.py")
    backfill = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backfill)

    def call(day, *, start=False, pg_db=None, supabase=None):
        return refresh_index(admin, day, start)

    def fetch_range(*, pg_db=None, supabase=None):
        info = scalar(admin, "SELECT public.market_index_backfill_range()")
        # This module's stats begin on a Wednesday in November, which has no
        # list: the chain must still start on the first Monday of December, as
        # the live path did. (Pinned: other modules may leave older stats rows.)
        return {**info, "first_stats_day": str(STATS_START)}

    code_ = backfill.main(["--end", str(LAST_DAY)], clients=(None, None), call=call,
                          fetch_range=fetch_range, today=LAST_DAY + timedelta(days=1))
    assert code_ == 0
    assert level_rows(admin) == before
    assert admin.execute(
        "SELECT index_code, month, product_id FROM public.index_constituents ORDER BY 1, 2, 3").fetchall() == frozen


# ------------------------------------------------------------------ access


@pytest.fixture(scope="module")
def scraper(admin):
    admin.execute(f"ALTER ROLE pokefin_scraper PASSWORD '{SCRAPER_PASSWORD}'")
    parts = urlparse(DSN)
    netloc = f"pokefin_scraper:{SCRAPER_PASSWORD}@{parts.hostname}:{parts.port or 5432}"
    with psycopg.connect(urlunparse(parts._replace(netloc=netloc)), autocommit=True) as conn:
        yield conn


def test_api_roles_read_only(admin, world):
    with admin.transaction():
        admin.execute("SET LOCAL ROLE anon")
        assert scalar(admin, "SELECT count(*) FROM public.market_index_summary") > 0
        assert scalar(admin, "SELECT count(*) FROM public.market_index_daily") > 0
        with pytest.raises(errors.InsufficientPrivilege):
            admin.execute("SELECT public.refresh_market_index(%s)", (LAST_DAY,))
    for statement in (
        "INSERT INTO public.market_index_daily (index_code, day, level, n_constituents, n_contributing, "
        "coverage_pct, adv_7d, dec_7d, flat_7d, new_high_52w, new_low_52w, provisional, resolution) "
        "VALUES ('sealed', '2020-01-06', 1, 1, 1, 100, 0, 0, 0, 0, 0, false, 'daily')",
        "TRUNCATE public.index_constituents",
        "SELECT public.reset_market_index()",
    ):
        with admin.transaction():
            admin.execute("SET LOCAL ROLE authenticated")
            with pytest.raises(errors.InsufficientPrivilege):
                admin.execute(statement)


def test_scraper_role_can_publish_but_not_reset(scraper, world):
    # EXECUTE works (the day is already published, so nothing is written).
    assert scraper.execute("SELECT public.refresh_market_index(%s)", (LAST_DAY,)).fetchone()[0]["status"] == "already_published"
    assert "last_index_day" in scraper.execute("SELECT public.market_index_backfill_range()").fetchone()[0]
    with pytest.raises(errors.InsufficientPrivilege):
        scraper.execute("SELECT public.reset_market_index()")
    with pytest.raises(errors.InsufficientPrivilege):
        scraper.execute("SELECT count(*) FROM public.market_index_daily")
```

2. `tests/test_wp29_scripts.py` (new; unit; no network, no database). 19 cases, all passing on the prototype.

```python
"""
Unit tests for WP29's Python: the index functions in market_analytics.py and
scripts/backfill_market_index.py. No network, no database.

  python -m pytest tests/test_wp29_scripts.py -v
"""
import importlib.util
from datetime import date
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


backfill = load_script("backfill_market_index")
TODAY = date(2026, 10, 1)


# ------------------------------------------------------------ market_analytics


class TestCallIndexRefresh:
    def test_uses_the_scraper_role_connection_first(self):
        pg_db, supabase = MagicMock(), MagicMock()
        pg_db.refresh_market_index.return_value = {"status": "ok"}
        assert market_analytics.call_index_refresh(date(2026, 9, 30), pg_db=pg_db, supabase=supabase) == {"status": "ok"}
        pg_db.refresh_market_index.assert_called_once_with(date(2026, 9, 30), start=False)
        supabase.rpc.assert_not_called()

    def test_falls_back_to_the_rpc(self):
        supabase = MagicMock()
        supabase.rpc.return_value.execute.return_value.data = {"status": "ok"}
        market_analytics.call_index_refresh(date(2026, 9, 30), start=True, supabase=supabase)
        supabase.rpc.assert_called_once_with("refresh_market_index", {"p_day": "2026-09-30", "p_start": True})

    def test_raises_without_a_client(self):
        with pytest.raises(RuntimeError):
            market_analytics.call_index_refresh(date(2026, 9, 30))


class TestRefreshIndexAfterRun:
    def test_defaults_to_yesterday_utc(self, monkeypatch):
        monkeypatch.setattr(market_analytics, "utc_today", lambda: date(2026, 10, 1))
        pg_db = MagicMock()
        pg_db.refresh_market_index.return_value = {"status": "ok", "day": "2026-09-30"}
        assert market_analytics.refresh_index_after_run(pg_db=pg_db) == {"status": "ok", "day": "2026-09-30"}
        pg_db.refresh_market_index.assert_called_once_with(date(2026, 9, 30), start=False)

    def test_never_raises_and_names_the_missing_migration(self, caplog):
        supabase = MagicMock()
        supabase.rpc.return_value.execute.side_effect = Exception(
            "PGRST202 Could not find the function public.refresh_market_index(p_day, p_start)")
        assert market_analytics.refresh_index_after_run(date(2026, 9, 30), supabase=supabase) is None
        assert "apply migration 0042" in caplog.text

    def test_other_errors_are_logged_not_raised(self, caplog):
        pg_db = MagicMock()
        pg_db.refresh_market_index.side_effect = TimeoutError("statement timeout")
        assert market_analytics.refresh_index_after_run(date(2026, 9, 30), pg_db=pg_db) is None
        assert "Sealed Index refresh failed" in caplog.text

    @pytest.mark.parametrize("status", ["not_initialised", "behind"])
    def test_statuses_that_need_the_backfill_are_warned(self, caplog, status):
        pg_db = MagicMock()
        pg_db.refresh_market_index.return_value = {"status": status}
        assert market_analytics.refresh_index_after_run(date(2026, 9, 30), pg_db=pg_db) == {"status": status}
        assert "backfill_market_index.py" in caplog.text


# ------------------------------------------------------------ backfill script


class TestPlan:
    def test_empty_stats_means_nothing_to_do(self):
        first, message = backfill.plan({"first_stats_day": None, "last_index_day": None}, date(2026, 9, 30))
        assert first is None and "backfill_daily_stats.py" in message

    def test_a_fresh_index_starts_the_chain_at_the_first_stats_day(self):
        first, _ = backfill.plan({"first_stats_day": "2025-08-27", "last_index_day": None}, date(2026, 9, 30))
        assert first == date(2025, 8, 27)

    def test_an_existing_chain_is_extended_from_the_next_day(self):
        first, _ = backfill.plan(
            {"first_stats_day": "2025-08-27", "last_index_day": "2026-09-20"}, date(2026, 9, 30))
        assert first == date(2026, 9, 21)

    def test_an_up_to_date_chain_needs_nothing(self):
        first, message = backfill.plan(
            {"first_stats_day": "2025-08-27", "last_index_day": "2026-09-30"}, date(2026, 9, 30))
        assert first is None and "already published" in message


def run(argv, range_info, results=None):
    calls = []

    def call(day, *, start=False, pg_db=None, supabase=None):
        calls.append((day, start))
        return (results or {}).get(day, {"status": "ok"})

    code = backfill.main(argv, clients=(None, None), call=call,
                         fetch_range=lambda **kw: range_info, today=TODAY)
    return code, calls


class TestMain:
    def test_calls_every_day_oldest_first_with_p_start(self):
        code, calls = run(["--end", "2026-09-03"], {"first_stats_day": "2026-09-01", "last_index_day": None})
        assert code == 0
        # p_start on every call: the first day with a constituent list starts the chain.
        assert calls == [(date(2026, 9, 1), True), (date(2026, 9, 2), True), (date(2026, 9, 3), True)]

    def test_defaults_to_yesterday(self):
        code, calls = run([], {"first_stats_day": None, "last_index_day": "2026-09-28"})
        assert code == 0 and [d for d, _ in calls] == [date(2026, 9, 29), date(2026, 9, 30)]

    def test_rejects_an_unfinished_day(self):
        with pytest.raises(SystemExit):
            run(["--end", "2026-10-01"], {})

    def test_dry_run_calls_nothing(self):
        code, calls = run(["--dry-run"], {"first_stats_day": "2026-09-01", "last_index_day": None})
        assert code == 0 and calls == []

    def test_stops_on_a_status_that_needs_attention(self):
        code, calls = run(["--end", "2026-09-03"], {"first_stats_day": "2026-09-01", "last_index_day": None},
                          results={date(2026, 9, 2): {"status": "behind"}})
        assert code == 1 and len(calls) == 2

    def test_stops_on_the_first_error(self, capsys):
        def call(day, **kw):
            raise RuntimeError("statement timeout")

        code = backfill.main(["--end", "2026-09-03"], clients=(None, None), call=call,
                             fetch_range=lambda **kw: {"first_stats_day": "2026-09-01"}, today=TODAY)
        assert code == 1
        assert "FAILED on 2026-09-01" in capsys.readouterr().err

    def test_closes_the_scraper_connection(self):
        pg_db = MagicMock()
        backfill.main(["--end", "2026-09-01"], clients=(pg_db, None), call=lambda day, **kw: {"status": "ok"},
                      fetch_range=lambda **kw: {"first_stats_day": "2026-09-01"}, today=TODAY)
        pg_db.close.assert_called_once_with()
```

3. `tests/test_main.py` (update). WP25's autouse fixture `_no_market_analytics_refresh` in `class TestRunJobsOnce` (and every other class that calls `main.run_jobs_once()`: `grep -rn "run_jobs_once()" tests/`) must also silence the new hook, or the unpatched call reaches the network through the test's supabase client. Replace its body with:

```python
    @pytest.fixture(autouse=True)
    def _no_market_analytics_refresh(self):
        """WP25 and WP29: keep run_jobs_once's analytics and index hooks off the network in unit tests."""
        with patch("main.refresh_after_run", return_value=None), \
             patch("main.refresh_index_after_run", return_value=None):
            yield
```

Add the same autouse fixture (under the name `_no_index_refresh`, patching only `main.refresh_index_after_run`) as the first member of WP25's `class TestRunJobsOnceMarketAnalytics`, and append:

```python
class TestRunJobsOnceMarketIndex:
    """WP29: the index is published after the analytics refresh, before revalidation."""

    def test_index_after_refresh_before_revalidate(self):
        import main
        calls = []
        with patch("main.fetch_and_store_exchange_rate", return_value=False), \
             patch("main.update_prices", return_value=3), \
             patch("main.refresh_after_run", side_effect=lambda **kw: calls.append("refresh")), \
             patch("main.refresh_index_after_run", side_effect=lambda **kw: calls.append("index")) as index, \
             patch("main.trigger_site_revalidation", side_effect=lambda: calls.append("revalidate")):
            main.run_jobs_once()
        assert calls == ["refresh", "index", "revalidate"]
        index.assert_called_once_with(pg_db=main.pg_db, supabase=main.supabase)

    def test_skipped_when_update_prices_fails(self):
        import main
        with patch("main.fetch_and_store_exchange_rate", return_value=True), \
             patch("main.update_prices", side_effect=RuntimeError("chrome died")), \
             patch("main.refresh_after_run") as refresh, \
             patch("main.refresh_index_after_run") as index:
            main.run_jobs_once()
        refresh.assert_not_called()
        index.assert_not_called()

    def test_a_failed_index_refresh_still_revalidates(self):
        import main
        with patch("main.fetch_and_store_exchange_rate", return_value=False), \
             patch("main.update_prices", return_value=2), \
             patch("main.refresh_after_run", return_value=None), \
             patch("main.refresh_index_after_run", return_value=None), \
             patch("main.trigger_site_revalidation") as trigger:
            main.run_jobs_once()
        trigger.assert_called_once_with()
```

4. WP21's `tests/test_db_roles_integration.py` and WP25's modules: no change; they must keep passing (0042 grants the scraper EXECUTE only).

5. Replay: WP21's `replay_twice` database applies 0042 twice (Verification step 2).

### Frontend (Jest)

1. `frontend/app/lib/__tests__/marketIndex.test.ts` (new, `@jest-environment node`):

```ts
/** @jest-environment node */
import {
  currentSummaries,
  indexLevelsCsv,
  indexPageHref,
  isCompactIndexSeries,
  isIndexCode,
  isIndexOverdue,
  lastWeeklyDay,
  parseIndexRange,
  parseIndexSort,
  sliceIndexRange,
  sortSummaries,
  toCompactIndexSeries,
  toIndexPoints,
  toIndexSummaries,
  type IndexDailyRow,
  type IndexSummaryRow,
} from "../marketIndex";

const daily = (day: string | null, level: number | string | null, extra: Partial<IndexDailyRow> = {}): IndexDailyRow => ({
  day, level, provisional: false, resolution: "daily", n_constituents: 10, n_contributing: 9, coverage_pct: 90,
  adv_7d: 4, dec_7d: 3, flat_7d: 2, new_high_52w: 1, new_low_52w: 0, ...extra,
});

const summaryRow = (over: Partial<IndexSummaryRow> = {}): IndexSummaryRow => ({
  code: "sealed", name: "Pokéfin Sealed Index", kind: "headline", sort_order: 0, base_day: "2025-09-08",
  day: "2026-10-13", level: 142.5, n_constituents: 212, n_contributing: 206, coverage_pct: "97.2",
  adv_7d: 94, dec_7d: 76, flat_7d: 42, new_high_52w: 11, new_low_52w: 0, provisional: false,
  resolution: "daily", chg_1d: 0.4, chg_7d: null, chg_30d: 1.2, chg_365d: null, ...over,
});

it("isIndexCode accepts the code format of index_definitions only", () => {
  expect(["sealed", "type-etb", "set-9101", "gen-801"].every(isIndexCode)).toBe(true);
  expect(["", "Sealed", "-x", "set_1", "a".repeat(41), null, 7].some(isIndexCode)).toBe(false);
});

it("toIndexPoints parses numeric strings, sorts, drops invalid rows, one row per day", () => {
  const points = toIndexPoints([
    daily("2026-10-02", "101.5"),
    daily("2026-10-01", 100, { resolution: "weekly", provisional: true }),
    daily("bad", 100),
    daily(null, 100),
    daily("2026-10-03", null),
    daily("2026-10-04", -1),
    daily("2026-10-02", 102),
  ]);
  expect(points.map((p) => [p.day, p.level, p.weekly, p.provisional])).toEqual([
    ["2026-10-01", 100, true, true],
    ["2026-10-02", 102, false, false],
  ]);
  expect(points[1]).toMatchObject({ nConstituents: 10, nContributing: 9, coveragePct: 90, adv7d: 4 });
});

it("toIndexSummaries validates code, kind, day and level", () => {
  const rows = toIndexSummaries([
    summaryRow(),
    summaryRow({ code: "BAD" }),
    summaryRow({ kind: "other" }),
    summaryRow({ day: null }),
    summaryRow({ level: 0 }),
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ code: "sealed", kind: "headline", coveragePct: 97.2, chg7d: null, chg30d: 1.2, weekly: false });
});

it("currentSummaries keeps sub-indices published for the headline's day", () => {
  const all = toIndexSummaries([
    summaryRow(),
    summaryRow({ code: "type-etb", name: "ETB", kind: "type", sort_order: 11 }),
    summaryRow({ code: "set-2", name: "Old", kind: "set", sort_order: 30, day: "2026-09-01" }),
  ]);
  const { headline, subIndices } = currentSummaries(all);
  expect(headline?.code).toBe("sealed");
  expect(subIndices.map((s) => s.code)).toEqual(["type-etb"]);
  expect(currentSummaries([])).toEqual({ headline: null, subIndices: [] });
});

it("sortSummaries: grouped by default, missing values last in both directions", () => {
  const rows = toIndexSummaries([
    summaryRow({ code: "set-1", name: "b set", kind: "set", sort_order: 30, chg_1d: null, chg_7d: 3 }),
    summaryRow({ code: "type-etb", name: "ETB", kind: "type", sort_order: 11, chg_1d: 0.2, chg_7d: -1 }),
  ]);
  expect(sortSummaries(rows, { key: null, dir: "asc" }).map((s) => s.code)).toEqual(["type-etb", "set-1"]);
  expect(sortSummaries(rows, { key: "7d", dir: "desc" }).map((s) => s.code)).toEqual(["set-1", "type-etb"]);
  expect(sortSummaries(rows, { key: "1d", dir: "asc" }).map((s) => s.code)).toEqual(["type-etb", "set-1"]);
  expect(sortSummaries(rows, { key: "1d", dir: "desc" }).map((s) => s.code)).toEqual(["type-etb", "set-1"]);
});

it("parses range and sort parameters with safe defaults", () => {
  expect(parseIndexRange("all")).toBe("all");
  expect(parseIndexRange(["all", "1y"])).toBe("all");
  expect(parseIndexRange("5y")).toBe("1y");
  expect(parseIndexRange(undefined)).toBe("1y");
  expect(parseIndexSort("7d", undefined)).toEqual({ key: "7d", dir: "desc" });
  expect(parseIndexSort("name", undefined)).toEqual({ key: "name", dir: "asc" });
  expect(parseIndexSort("level", "asc")).toEqual({ key: "level", dir: "asc" });
  expect(parseIndexSort("drop", "asc")).toEqual({ key: null, dir: "asc" });
});

it("indexPageHref omits defaults", () => {
  expect(indexPageHref("1y", { key: null, dir: "asc" })).toBe("/indices/sealed");
  expect(indexPageHref("all", { key: "1y", dir: "desc" })).toBe("/indices/sealed?range=all&sort=1y&dir=desc");
});

it("sliceIndexRange keeps the 365 days ending on the newest point; lastWeeklyDay finds the junction", () => {
  const points = toIndexPoints([
    daily("2025-10-12", 99, { resolution: "weekly" }),
    daily("2025-10-13", 100, { resolution: "weekly" }),
    daily("2026-10-13", 110),
  ]);
  expect(sliceIndexRange(points, "1y").map((p) => p.day)).toEqual(["2025-10-13", "2026-10-13"]);
  expect(sliceIndexRange(points, "all")).toHaveLength(3);
  expect(lastWeeklyDay(points)).toBe("2025-10-13");
  expect(lastWeeklyDay(points.slice(2))).toBeNull();
});

it("isIndexOverdue: day-granular for a date key, hour-aware for a Date", () => {
  // WP32's ISR header passes utcTodayKey().
  expect(isIndexOverdue("2026-10-13", "2026-10-14")).toBe(false);
  expect(isIndexOverdue("2026-10-12", "2026-10-14")).toBe(true);
  // Request time: D-1 normally lands by 06:00 UTC, so no false alarm after midnight.
  expect(isIndexOverdue("2026-10-12", new Date("2026-10-14T05:59:00Z"))).toBe(false);
  expect(isIndexOverdue("2026-10-12", new Date("2026-10-14T06:00:00Z"))).toBe(true);
  expect(isIndexOverdue("2026-10-13", new Date("2026-10-14T23:59:00Z"))).toBe(false);
  expect(isIndexOverdue("2026-10-10", new Date("2026-10-14T00:30:00Z"))).toBe(true);
});

it("compact series: columns, 4-decimal levels, provisional positions, validator", () => {
  const points = toIndexPoints([
    daily("2026-01-01", 100, { resolution: "weekly", provisional: true }),
    daily("2026-01-02", "101.23456789"),
  ]);
  const compact = toCompactIndexSeries({ code: "sealed", name: "X" }, points);
  expect(compact).toEqual({
    code: "sealed", name: "X", asOf: "2026-01-02", base: 100, weeklyUntil: "2026-01-01",
    d: ["2026-01-01", "2026-01-02"], l: [100, 101.2346], p: [0],
  });
  expect(isCompactIndexSeries(compact)).toBe(true);
  expect(isCompactIndexSeries({ ...compact, l: [100] })).toBe(false);
  expect(isCompactIndexSeries({ ...compact, p: [5] })).toBe(false);
  expect(isCompactIndexSeries(null)).toBe(false);
});

it("the CSV holds derived levels only, with licence and credit lines", () => {
  const csv = indexLevelsCsv(toIndexPoints([daily("2026-10-12", 100, { resolution: "weekly" }), daily("2026-10-13", 101.23456)]), {
    asOf: "2026-10-13",
    pageUrl: "https://pokefin.ca/indices/sealed",
  });
  const lines = csv.trimEnd().split("\n");
  expect(lines[0]).toMatch(/^# Pokéfin Sealed Index, base 100\. .*no product prices included\.$/);
  expect(lines[1]).toBe(
    "# License: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Credit: Pokéfin, https://pokefin.ca/indices/sealed. As of the close of 2026-10-13 (UTC)."
  );
  expect(lines[2]).toBe(
    "date,level,resolution,provisional,constituents,contributing,coverage_pct,advancers_7d,decliners_7d,unchanged_7d,new_highs_52w,new_lows_52w"
  );
  expect(lines[3]).toBe("2026-10-12,100.0000,weekly,false,10,9,90.0,4,3,2,1,0");
  expect(lines[4]).toBe("2026-10-13,101.2346,daily,false,10,9,90.0,4,3,2,1,0");
  expect(csv.endsWith("\n")).toBe(true);
});
```

2. `frontend/app/lib/__tests__/marketIndexConstants.test.ts` (new, node): every rule the methodology prints equals the SQL.

```ts
/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";
import {
  HEADLINE_INDEX_CODE,
  HEADLINE_INDEX_NAME,
  INDEX_BASE_LEVEL,
  INDEX_CHANGE_WINDOWS,
  INDEX_EXCLUDED_TYPE_PATTERNS,
  INDEX_RULES,
  INDEX_TYPE_FAMILY,
} from "../marketIndex";

const MIGRATIONS = path.resolve(__dirname, "../../../../migrations");

/** Text of the highest-numbered NNNN_*.sql file matching `pattern`. */
function newest(pattern: RegExp): string {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort().reverse();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    if (pattern.test(sql)) return sql;
  }
  throw new Error(`no numbered migration matches ${pattern}`);
}

const R = INDEX_RULES;
const clip = R.returnClipPercent / 100;

describe("freeze_market_index_month", () => {
  const sql = newest(/FUNCTION\s+public\.freeze_market_index_month\s*\(/i);
  it("constituent screen", () => {
    expect(sql).toContain(`s.usd_price >= ${R.minPriceUsd}`);
    expect(sql).toContain(`s.distinct_prices_365d >= ${R.minDistinctPrices365d}`);
    expect(sql).toContain(`st.release_date <= p_month - ${R.minDaysSinceRelease}`);
    expect(sql).toContain(`s.day BETWEEN p_month - ${R.selectionLookbackDays} AND p_month - 1`);
    expect(sql).toContain(`IF v_headline < ${R.minConstituents} THEN`);
    const havings = [...sql.matchAll(/HAVING count\(\*\) >= (\d+)/g)].map((m) => Number(m[1]));
    expect(havings).toEqual([R.minConstituents, R.minConstituents, R.minConstituents]);
    for (const pattern of INDEX_EXCLUDED_TYPE_PATTERNS) expect(sql).toContain(`NOT LIKE '%${pattern}%'`);
  });
});

describe("refresh_market_index_day", () => {
  const sql = newest(/FUNCTION\s+public\.refresh_market_index_day\s*\(/i);
  it("carry, clip, provisional, breadth, new highs and the base level", () => {
    expect(sql).toContain(`v_carry := CASE WHEN v_weekly THEN ${R.weeklyCarryMaxDays} ELSE ${R.dailyCarryMaxDays} END`);
    expect(sql).toContain(`greatest(least(c.q / pv.q - 1, ${clip}), -${clip})`);
    expect(sql).toContain(`100.0 * l.n_contributing / l.n_constituents < ${R.provisionalBelowCoveragePct}`);
    expect(sql).toContain(`pm.ret_7d > ${R.breadthFlatBandPct}`);
    expect(sql).toContain(`pm.ret_7d < -${R.breadthFlatBandPct}`);
    expect(sql).toContain(`pm.ret_7d BETWEEN -${R.breadthFlatBandPct} AND ${R.breadthFlatBandPct}`);
    expect(sql.split(`c.first_tracked_day <= p_day - ${R.newHighMinTrackedDays}`)).toHaveLength(3);
    expect(sql).toContain(`CASE WHEN l.prior_level IS NULL THEN ${INDEX_BASE_LEVEL}`);
  });
});

describe("refresh_market_index", () => {
  it("catch-up limit", () => {
    const sql = newest(/FUNCTION\s+public\.refresh_market_index\s*\(/i);
    expect(sql).toContain(`v_last < p_day - ${R.maxCatchUpDays}`);
  });
});

describe("market_index_summary", () => {
  it("change windows", () => {
    const sql = newest(/VIEW\s+public\.market_index_summary/i);
    for (const w of INDEX_CHANGE_WINDOWS) {
      if (w.toleranceDays === 0) expect(sql).toContain(`p1.day = l.day - ${w.days}`);
      else expect(sql).toContain(`x.day <= l.day - ${w.days} AND x.day >= l.day - ${w.days} - ${w.toleranceDays}`);
    }
  });
});

describe("the seeded family", () => {
  it("headline and type indices", () => {
    const sql = newest(/INSERT INTO public\.index_definitions \(code, name, kind, filter, sort_order\) VALUES/);
    expect(sql).toContain(`('${HEADLINE_INDEX_CODE}',`);
    expect(sql).toContain(`'${HEADLINE_INDEX_NAME}'`);
    for (const t of INDEX_TYPE_FAMILY) {
      expect(sql).toContain(`('${t.code}',`);
      expect(sql).toContain(`'${t.name}'`);
      expect(sql).toContain(`{"type_patterns": ["${t.pattern}"]}`);
    }
  });
});
```

3. `frontend/app/lib/__tests__/indexChart.test.ts` (new, node):

```ts
/** @jest-environment node */
import { buildIndexChart, INDEX_CHART_HEIGHT, niceStep } from "../indexChart";
import type { IndexPoint } from "../marketIndex";

const point = (day: string, level: number, weekly = false): IndexPoint => ({
  day, level, weekly, provisional: false, nConstituents: 1, nContributing: 1, coveragePct: 100,
  adv7d: 0, dec7d: 0, flat7d: 0, newHigh52w: 0, newLow52w: 0,
});

it("niceStep picks 1, 2, 2.5 or 5 times a power of ten", () => {
  expect([0.3, 0.7, 1.2, 2.2, 3, 7, 12, 26].map(niceStep)).toEqual([0.5, 1, 2, 2.5, 5, 10, 20, 50]);
  expect(niceStep(0)).toBe(1);
  expect(niceStep(Number.NaN)).toBe(1);
});

it("needs two points", () => {
  expect(buildIndexChart([])).toBeNull();
  expect(buildIndexChart([point("2026-01-01", 100)])).toBeNull();
});

it("joins the dashed weekly segment and the daily line at the last weekly point", () => {
  const m = buildIndexChart([
    point("2025-12-01", 100, true),
    point("2025-12-08", 102, true),
    point("2025-12-09", 103),
    point("2025-12-10", 101),
  ])!;
  const weeklyTail = m.weeklyPath!.split(" L").pop()!;
  expect(m.weeklyPath!.split(" L")).toHaveLength(2);
  expect(m.dailyPath!.startsWith(`M${weeklyTail} L`)).toBe(true);
  expect(m.weeklyUntil).toBe("2025-12-08");
  expect(m.last).toMatchObject({ day: "2025-12-10", level: 101, xPct: 100 });
});

it("round y ticks that cover the data, bottom tick at the bottom", () => {
  const m = buildIndexChart([point("2026-01-01", 96.3), point("2026-02-01", 142.8)])!;
  const values = m.yTicks.map((t) => t.value);
  expect(values[0]).toBeLessThanOrEqual(96.3);
  expect(values[values.length - 1]).toBeGreaterThanOrEqual(142.8);
  expect(values.every((v) => Number.isInteger(v))).toBe(true);
  expect(m.yTicks[0].y).toBe(INDEX_CHART_HEIGHT);
  expect(m.yTicks[0].pct).toBe(100);
});

it("a flat series still gets a range, with the line in the middle", () => {
  const m = buildIndexChart([point("2026-01-01", 100), point("2026-01-02", 100)])!;
  expect(m.yTicks.map((t) => t.value)).toEqual([99, 100, 101]);
  expect(m.last.yPct).toBe(50);
});

it("month ticks inside the domain, every other one minor", () => {
  const m = buildIndexChart([point("2025-09-15", 100), point("2026-03-10", 110)])!;
  expect(m.xTicks.map((t) => t.label)).toEqual(["Oct 2025", "Nov 2025", "Dec 2025", "Jan 2026", "Feb 2026", "Mar 2026"]);
  expect(m.xTicks.map((t) => t.minor)).toEqual([false, true, false, true, false, true]);
  expect(m.xTicks.every((t) => t.pct > 0 && t.pct <= 100)).toBe(true);
});
```

4. `frontend/app/lib/__tests__/serverMarketData.index.test.ts` (new, node). Same `server-only`, `@supabase/supabase-js`, `../logger` and `next/cache` mocks as WP25's serverMarketData test (`serverMarketData.stats.test.ts`; WP25 may have named it after `serverMarketData.freshness.test.ts`: `ls app/lib/__tests__/serverMarketData.*.test.ts`), except that the `unstable_cache` mock also records its arguments: `const mockCacheEntries: Array<{ keys: string[]; options: { revalidate?: number; tags?: string[] } }> = [];` above the mocks and `unstable_cache: (fn: unknown, keys: string[], options: { revalidate?: number; tags?: string[] }) => { mockCacheEntries.push({ keys, options }); return fn; }` (the `mock` prefix lets Jest's hoisted factory reference it). WP25's `tableMock` is extended by `eq(...args) { calls.eq.push(args); return chain; }`. Cases:
- The entries keyed `["market-index-summary"]` and `["market-index-series"]` both have `revalidate: 3600` and `tags: ["market-products"]` (the hourly refresh; a daily value fails this case).
- `getCachedIndexSummary()` reads `market_index_summary` (assert the `from` mock got that name), the select string contains `chg_365d` and `coverage_pct` and no `*`, `calls.order` equals `[["sort_order", { ascending: true }], ["code", { ascending: true }]]`, and two valid rows plus one with `code: "BAD"` return two `IndexSummary` objects.
- An error page (`{ data: null, error: { message: "down" } }`) returns `null` and calls `logCaughtError` with `"server_index_summary_failed"`.
- `getCachedIndexSeries("sealed")`: `calls.eq[0]` equals `["index_code", "sealed"]`, `calls.order[0]` equals `["day", { ascending: true }]`, and the result is oldest first with numeric levels.
- `getCachedIndexSeries("Robert'); DROP")` returns `[]` and never calls `from`.
- An error returns `null` and logs `"server_index_series_failed"`.

5. `frontend/app/api/public/__tests__/indexRoute.test.ts` (new, node):

```ts
/** @jest-environment node */
jest.mock("server-only", () => ({}));
const mockSummary = jest.fn();
const mockSeries = jest.fn();
jest.mock("../../../lib/serverMarketData", () => ({
  getCachedIndexSummary: () => mockSummary(),
  getCachedIndexSeries: (code: string) => mockSeries(code),
}));

import * as route from "../index/[code]/route";
import { toIndexPoints } from "../../../lib/marketIndex";

const ctx = (code: string) => ({ params: Promise.resolve({ code }) });
const req = (code: string) => new Request(`http://localhost/api/public/index/${code}`);
const SEALED = { code: "sealed", name: "Pokéfin Sealed Index" };

beforeEach(() => jest.clearAllMocks());

it("is static, daily and prerenders nothing at build", async () => {
  expect(route.dynamic).toBe("force-static");
  expect(route.revalidate).toBe(86400);
  await expect(route.generateStaticParams()).resolves.toEqual([]);
});

it("404 for malformed and unknown codes", async () => {
  mockSummary.mockResolvedValue([SEALED]);
  for (const code of ["Sealed", "set_1", "../x", "a".repeat(41)]) {
    expect((await route.GET(req(code), ctx(code))).status).toBe(404);
  }
  expect((await route.GET(req("set-9"), ctx("set-9"))).status).toBe(404);
  expect(mockSeries).not.toHaveBeenCalled();
});

it("200 with the compact series and a render stamp", async () => {
  mockSummary.mockResolvedValue([SEALED]);
  mockSeries.mockResolvedValue(
    toIndexPoints([
      { day: "2026-10-12", level: 100, provisional: false, resolution: "weekly", n_constituents: 3, n_contributing: 3,
        coverage_pct: 100, adv_7d: 0, dec_7d: 0, flat_7d: 3, new_high_52w: 0, new_low_52w: 0 },
      { day: "2026-10-13", level: 101.23456, provisional: true, resolution: "daily", n_constituents: 3, n_contributing: 2,
        coverage_pct: 66.7, adv_7d: 1, dec_7d: 0, flat_7d: 2, new_high_52w: 0, new_low_52w: 0 },
    ])
  );
  const res = await route.GET(req("sealed"), ctx("sealed"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    code: "sealed", name: "Pokéfin Sealed Index", asOf: "2026-10-13", base: 100, weeklyUntil: "2026-10-12",
    d: ["2026-10-12", "2026-10-13"], l: [100, 101.2346], p: [1],
  });
  expect(res.headers.get("x-pokefin-generated-at")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(mockSeries).toHaveBeenCalledWith("sealed");
});

it("a failed read throws, so Next answers 500 and caches nothing", async () => {
  mockSummary.mockResolvedValue(null);
  await expect(route.GET(req("sealed"), ctx("sealed"))).rejects.toThrow("index summary unavailable");
  mockSummary.mockResolvedValue([SEALED]);
  mockSeries.mockResolvedValue(null);
  await expect(route.GET(req("sealed"), ctx("sealed"))).rejects.toThrow("index series unavailable");
});
```

6. `frontend/app/indices/sealed/__tests__/page.test.tsx` (new, jsdom): the page render test with a provisional day, the other states, sorting links, JSON-LD, axe, and the source guard that keeps the route free of client code and charting libraries.

```tsx
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { axeViolations } from "@/test-utils/axe";

jest.mock("server-only", () => ({}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    prefetch,
    scroll,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    prefetch?: boolean;
    scroll?: boolean;
  } & Record<string, unknown>) => (
    <a href={href} data-prefetch={String(prefetch)} data-scroll={String(scroll)} {...rest}>
      {children}
    </a>
  ),
}));

const mockSummary = jest.fn();
const mockSeries = jest.fn();
jest.mock("../../../lib/serverMarketData", () => ({
  getCachedIndexSummary: () => mockSummary(),
  getCachedIndexSeries: (code: string) => mockSeries(code),
}));

import SealedIndexPage from "../page";
import type { IndexPoint, IndexSummary } from "../../../lib/marketIndex";

const DAY = 86_400_000;
const LAST = "2026-10-13";
const lastMs = Date.parse(`${LAST}T00:00:00Z`);
const key = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 420 days ending LAST: Mondays only (weekly) up to 2025-09-01, then daily. */
function series(): IndexPoint[] {
  const out: IndexPoint[] = [];
  let level = 100;
  for (let ms = lastMs - 420 * DAY; ms <= lastMs; ms += DAY) {
    const day = key(ms);
    const weekly = day <= "2025-09-01";
    if (weekly && new Date(ms).getUTCDay() !== 1) continue;
    level *= 1.001;
    out.push({
      day, level, weekly, provisional: day === LAST, nConstituents: 212, nContributing: day === LAST ? 136 : 212,
      coveragePct: day === LAST ? 64.2 : 100, adv7d: 90, dec7d: 70, flat7d: 52, newHigh52w: 11, newLow52w: 3,
    });
  }
  return out;
}

function summary(over: Partial<IndexSummary> = {}): IndexSummary {
  return {
    code: "sealed", name: "Pokéfin Sealed Index", kind: "headline", sortOrder: 0, baseDay: "2025-08-18",
    day: LAST, level: 142.87, nConstituents: 212, nContributing: 136, coveragePct: 64.2, adv7d: 90, dec7d: 70,
    flat7d: 52, newHigh52w: 11, newLow52w: 3, provisional: true, weekly: false,
    chg1d: 0.4, chg7d: -2.3, chg30d: 1.2, chg365d: null, ...over,
  };
}

const SUBS: IndexSummary[] = [
  summary({ code: "type-etb", name: "Elite Trainer Box Index", kind: "type", sortOrder: 11, level: 131.2, provisional: false, chg7d: 3.1, chg365d: 12.5 }),
  summary({ code: "set-9101", name: "Crimson Tidal Index", kind: "set", sortOrder: 30, level: 88.4, provisional: false, chg7d: -4.2, chg365d: -8.1 }),
  summary({ code: "set-9102", name: "Old Set Index", kind: "set", sortOrder: 30, day: "2026-09-01" }),
];

async function renderPage(params: Record<string, string> = {}) {
  return render(await SealedIndexPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date("2026-10-14T06:00:00Z"), doNotFake: ["nextTick", "setImmediate"] });
  mockSummary.mockResolvedValue([summary(), ...SUBS]);
  mockSeries.mockResolvedValue(series());
});
afterEach(() => jest.useRealTimers());

it("renders the level, changes, coverage and the provisional warning", async () => {
  const { container } = await renderPage();
  expect(screen.getByRole("heading", { level: 1, name: "Pokéfin Sealed Index" })).toBeInTheDocument();
  expect(screen.getByText("142.87")).toBeInTheDocument();
  const note = screen.getByRole("note");
  expect(note).toHaveTextContent("Provisional: 136 of 212 constituents (64%) were priced on Oct 13, 2026");
  expect(within(note).getByRole("link", { name: "How provisional days work" })).toHaveAttribute(
    "href",
    "/methodology#index-calculation"
  );
  expect(container.querySelector('time[datetime="2026-10-13"]')).not.toBeNull();
  expect(screen.getByRole("link", { name: "Methodology" })).toHaveAttribute("href", "/methodology#index");
  expect(screen.getByRole("link", { name: "Download levels (CSV)" })).toHaveAttribute("href", "/indices/sealed/levels.csv");
  // 1Y has no level a year back: "--" with a reason, never 0.
  expect(screen.getByText("Less than a year of levels")).toBeInTheDocument();
  expect(await axeViolations(container)).toEqual([]);
});

it("does not warn on a complete, current day", async () => {
  mockSummary.mockResolvedValue([summary({ provisional: false, coveragePct: 100, nContributing: 212 }), ...SUBS]);
  await renderPage();
  expect(screen.queryByRole("note")).toBeNull();
});

it("warns when the nightly run is overdue", async () => {
  mockSummary.mockResolvedValue([summary({ provisional: false, day: "2026-10-10" })]);
  await renderPage();
  expect(screen.getByRole("note")).toHaveTextContent("Not updated since Oct 10, 2026");
});

it("does not warn in the hours after midnight while D-1 is being published", async () => {
  jest.setSystemTime(new Date("2026-10-14T03:00:00Z"));
  mockSummary.mockResolvedValue([summary({ provisional: false, day: "2026-10-12" })]);
  await renderPage();
  expect(screen.queryByRole("note")).toBeNull();
});

it("draws the chart as server SVG: 1Y is all daily, All adds the dashed weekly segment and footnote", async () => {
  const oneYear = await renderPage();
  expect(oneYear.container.querySelector('path[data-segment="daily"]')).not.toBeNull();
  expect(oneYear.container.querySelector('path[data-segment="weekly"]')).toBeNull();
  expect(screen.queryByTestId("index-weekly-footnote")).toBeNull();
  const ranges = () => within(screen.getByRole("navigation", { name: "Chart range" }));
  expect(ranges().getByRole("link", { name: "1Y" })).toHaveAttribute("aria-current", "page");
  oneYear.unmount();

  const all = await renderPage({ range: "all" });
  expect(all.container.querySelector('path[data-segment="weekly"]')).toHaveAttribute("stroke-dasharray", "6 4");
  expect(screen.getByTestId("index-weekly-footnote")).toHaveTextContent("Weekly points before Sep 1, 2025");
  expect(ranges().getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByTestId("index-last-label")).toHaveTextContent("Oct 13");
});

it("lists only sub-indices published for the headline day, sortable by links", async () => {
  const { container } = await renderPage({ sort: "7d", dir: "desc" });
  const table = container.querySelector("table")!;
  const names = [...table.querySelectorAll("tbody th")].map((th) => th.textContent);
  expect(names).toEqual(["Elite Trainer Box Index", "Crimson Tidal Index"]);
  const header = within(table).getByRole("columnheader", { name: /7D/ });
  expect(header).toHaveAttribute("aria-sort", "descending");
  expect(within(header).getByRole("link")).toHaveAttribute("href", "/indices/sealed?sort=7d&dir=asc");
  expect(screen.getByRole("list", { name: "Sub-indices" })).toBeInTheDocument();
});

it("shows breadth counts", async () => {
  await renderPage();
  const breadth = screen.getByRole("region", { name: /Breadth/ });
  expect(breadth).toHaveTextContent("90 of 212 constituents rose more than 0.5% over 7 days and 70 fell more than 0.5%.");
});

it("emits Dataset and BreadcrumbList JSON-LD", async () => {
  const { container } = await renderPage();
  const blocks = [...container.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent!));
  const dataset = blocks.find((b) => b["@type"] === "Dataset");
  expect(dataset.license).toBe("https://creativecommons.org/licenses/by/4.0/");
  expect(dataset.distribution[0].contentUrl).toMatch(/\/indices\/sealed\/levels\.csv$/);
  expect(dataset.temporalCoverage).toMatch(/^\d{4}-\d{2}-\d{2}\/2026-10-13$/);
  expect(blocks.some((b) => b["@type"] === "BreadcrumbList")).toBe(true);
});

it("says so when nothing is published, and when the read failed", async () => {
  mockSummary.mockResolvedValue([]);
  const empty = await renderPage();
  expect(screen.getByRole("heading", { name: "The Sealed Index is not published yet" })).toBeInTheDocument();
  empty.unmount();

  mockSummary.mockResolvedValue(null);
  await renderPage();
  expect(screen.getByRole("heading", { name: "The index could not be loaded" })).toBeInTheDocument();
});

it("ships no client code and no charting library", () => {
  const root = path.resolve(__dirname, "..");
  const files = [
    ...fs.readdirSync(root).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(root, f)),
    path.resolve(__dirname, "../../../lib/indexChart.ts"),
    path.resolve(__dirname, "../../../lib/marketIndex.ts"),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    expect(text).not.toMatch(/^\s*["']use client["']/m);
    expect(text).not.toMatch(/from ["']recharts/);
  }
});
```

If WP23's axe helper lives elsewhere (`grep -rn "export async function axeViolations" test-utils app`), import it from there.

7. `frontend/app/indices/sealed/__tests__/levelsCsv.test.ts` (new, node):

```ts
/** @jest-environment node */
jest.mock("server-only", () => ({}));
const mockSeries = jest.fn();
jest.mock("../../../lib/serverMarketData", () => ({ getCachedIndexSeries: (code: string) => mockSeries(code) }));

import { GET, dynamic } from "../levels.csv/route";
import { toIndexPoints } from "../../../lib/marketIndex";

it("serves derived levels with licence headers", async () => {
  mockSeries.mockResolvedValue(
    toIndexPoints([
      { day: "2026-10-12", level: 100, provisional: false, resolution: "weekly", n_constituents: 10, n_contributing: 9,
        coverage_pct: 90, adv_7d: 4, dec_7d: 3, flat_7d: 2, new_high_52w: 1, new_low_52w: 0 },
    ])
  );
  const res = await GET();
  expect(dynamic).toBe("force-dynamic");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  expect(res.headers.get("content-disposition")).toBe('attachment; filename="pokefin-sealed-index.csv"');
  expect(res.headers.get("cache-control")).toContain("s-maxage=3600");
  expect(res.headers.get("link")).toBe('<https://creativecommons.org/licenses/by/4.0/>; rel="license"');
  const lines = (await res.text()).trimEnd().split("\n");
  expect(lines[1]).toContain("CC BY 4.0");
  expect(lines[1]).toContain("/indices/sealed. As of the close of 2026-10-12 (UTC).");
  expect(lines[3]).toBe("2026-10-12,100.0000,weekly,false,10,9,90.0,4,3,2,1,0");
  expect(lines.join("\n")).not.toMatch(/usd_price|market price,/i);
  expect(mockSeries).toHaveBeenCalledWith("sealed");
});

it("503 no-store when the read fails", async () => {
  mockSeries.mockResolvedValue(null);
  const res = await GET();
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("no-store");
});
```

8. Updates to existing tests:
- `app/lib/__tests__/format.test.ts` (WP07): `formatMonthYear("2026-09-26")` is `"Sep 2026"`, `formatMonthYear("")` is `""`, `formatMonthYear("bad", "x")` is `"x"`; `formatDecimal(1234.5)` is `"1,234.50"`, `formatDecimal(142.87456)` is `"142.87"`, `formatDecimal(100, 0)` is `"100"`, `formatDecimal(null)` is `"--"`, `formatDecimal(Number.NaN, 2, "n/a")` is `"n/a"`. Run it in the three time zones WP07 uses.
- `app/lib/__tests__/jsonLd.test.ts` (WP24; create the case in a new `describe` if the file has another layout): `buildDatasetJsonLd({ name: "N", description: "D", path: "/indices/sealed", csvPath: "/indices/sealed/levels.csv", license: "https://creativecommons.org/licenses/by/4.0/", temporalCoverage: "2025-09-08/2026-10-13", dateModified: "2026-10-13" })` has `@type` `Dataset`, `url` `https://pokefin.ca/indices/sealed`, `distribution[0].contentUrl` `https://pokefin.ca/indices/sealed/levels.csv`, `isAccessibleForFree` `true`, and no key containing `cap`.
- `app/methodology/__tests__/MethodologyArticle.test.tsx`: the `#index` section no longer contains "not published yet"; it contains `$${INDEX_RULES.minPriceUsd}`, `${INDEX_RULES.returnClipPercent}%`, `${INDEX_RULES.provisionalBelowCoveragePct}%`, every `INDEX_TYPE_FAMILY` label, and a link to `/indices/sealed`; its text does not match `/cap-weighted|market cap|value-weighted/i`; `#index-constituents`, `#index-calculation` and `#index-breadth` exist; `tr[data-index-window="1Y"]` contains `365 to 379 days earlier` (computed from `INDEX_CHANGE_WINDOWS`) and `tr[data-index-window="1D"]` contains `previous day`; `#changes` has one more row than before, the first with `METHODOLOGY_VERSION`, the second with the old version literal. The existing anchor, em dash and axe cases cover the rest.
- `app/lib/__tests__/metricDefinitions.test.ts`: `metricHref("indexLevel")` is `/methodology#index`, `metricHref("indexCoverage")` is `/methodology#index-calculation`, `metricHref("breadth7d")` and `metricHref("newHighs52w")` are `/methodology#index-breadth`. The existing uniqueness, length, anchor and banned-word cases cover the new entries.
- `app/__tests__/sitemap.test.ts` (WP13): the URL list also contains `https://pokefin.ca/indices/sealed`.
- `app/components/__tests__/Footer.test.tsx` (WP27): step 23c.
- `app/lib/__tests__/publicMarketApi.test.ts` (WP26, when step 13 ran): `fetchPublicIndexSeries("sealed")` resolves the body for a valid 200, `null` for a 404, rejects for a body failing `isCompactIndexSeries` or with another `code`, and a second call within the hour does not fetch again.

### Script tests (node --test)

`frontend/scripts/perf-fixture.test.mjs` (WP22): append

```js
test("WP29 index fixture: headline published for yesterday, weekly rows are Mondays", () => {
  const data = buildPerfData({ now: new Date("2026-10-14T15:00:00Z"), baseUrl: "http://127.0.0.1:3100" });
  const headline = data.marketIndexSummary.find((r) => r.code === "sealed");
  assert.equal(headline.day, "2026-10-13");
  assert.equal(headline.provisional, false);
  const weekly = data.marketIndexDaily.filter((r) => r.index_code === "sealed" && r.resolution === "weekly");
  assert.ok(weekly.length > 20);
  assert.ok(weekly.every((r) => new Date(`${r.day}T00:00:00Z`).getUTCDay() === 1));
  assert.ok(data.marketIndexSummary.every((r) => !("index_code" in r)));
  assert.ok(data.indexDefinitions.some((r) => r.kind === "set"));
});
```

(Import `buildPerfData` and `assert` the way the file's existing tests do.)

## Verification

Repo root:

```bash
# 1. Migration shape
python3 verify_migration.py migrations/0042_market_index.sql > /tmp/wp29_0042.sql; echo "exit=$?"   # exit=3, step 2's stderr

# 2. Replay twice and check every object
PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh   # "OK: ..."
psql postgresql://postgres:postgres@localhost:55432/replay_twice -At -f /tmp/wp29_0042.sql | cut -d'|' -f4 | sort | uniq -c   # 113 OK

# 3. Database tests (twice: the module cleans up after itself)
export POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once
python -m pytest tests/test_wp29_market_index_db.py -v      # 23 passed
python -m pytest tests/test_wp29_market_index_db.py -q      # 23 passed again
python -m pytest tests/ -q                                  # all pass (WP21, WP25, WP26, WP28 modules included)
unset POKEFIN_TEST_DATABASE_URL
python -m pytest tests/test_wp29_scripts.py tests/test_main.py -q   # all pass; the DB modules skip

# 4. Timing on production-size data (optional, recommended): on a scratch database with 306 products and
#    about 480 days of prices, after WP25's stats backfill (scripts/backfill_daily_stats.py):
#    SELECT refresh_market_index(<first day>, true); then one call per day. Expect under 50 ms per day
#    (9 ms measured) and about 80 ms on the first day of a month.
```

`frontend/`:

```bash
# 5. Types, lint, tests (tsc exits 0 only after phase B)
pnpm exec tsc --noEmit
pnpm lint                                                   # 0 errors
pnpm exec jest app/lib/__tests__/marketIndex.test.ts app/lib/__tests__/marketIndexConstants.test.ts \
  app/lib/__tests__/indexChart.test.ts app/lib/__tests__/serverMarketData.index.test.ts \
  app/api/public/__tests__/indexRoute.test.ts app/indices/sealed/__tests__ \
  app/lib/__tests__/format.test.ts app/lib/__tests__/jsonLd.test.ts app/methodology app/lib/__tests__/metricDefinitions.test.ts \
  app/__tests__/sitemap.test.ts                             # all pass
pnpm test --ci                                              # all pass
pnpm run test:scripts                                       # all pass (perf fixture and prod-smoke tests included)
grep -rn "use client\|recharts" app/indices app/lib/indexChart.ts app/lib/marketIndex.ts   # no output
LC_ALL=C.UTF-8 grep -rnP '\x{2014}' app/indices app/lib/marketIndex.ts app/lib/indexChart.ts app/methodology   # no output

# 6. Stub build
pnpm build:stub                                             # exit 0
# Route table: ƒ /indices/sealed, ƒ /indices/sealed/levels.csv (dynamic), /api/public/index/[code] as ISR (● or ƒ with revalidate 1d).
# The build log shows no Supabase request for market_index_* (nothing is prerendered).

# 7. Performance budgets (WP22)
SUPABASE_STUB_FIXTURE=perf pnpm build:stub
node scripts/perf-serve.mjs &                               # note the PID
curl -s localhost:3100/indices/sealed | grep -c 'data-segment="daily"'        # 1
curl -s "localhost:3100/indices/sealed?range=all" | grep -c 'data-segment="weekly"'   # 1
curl -sI localhost:3100/indices/sealed/levels.csv | grep -i "content-type"    # text/csv; charset=utf-8
curl -s localhost:3100/api/public/index/sealed | head -c 200                  # {"code":"sealed",...
pnpm perf:budget --write-limits                             # fills /indices/sealed's two limits
pnpm perf:budget | tee /tmp/wp29-budget-after.txt           # exit 0
kill <PID>
```

Expected: `/indices/sealed` `jsGzKb` within 0.5 kB of `/privacy` (no route-specific client JavaScript), `documentBrKb` under 40 kB (about 12 kB measured shape: a 365-point path is about 4.5 kB raw), every existing route within its limit, no "(no fixture route)" line in the perf log, and, with WP26's gate, the notes "`/indices/sealed`: supabase-js not reachable" and "`/indices/sealed`: recharts not reachable". Commit the updated `perf-budgets.json`.

Manual checks (`pnpm dev` against the perf stub, or the Vercel preview), at 390x844 and 1440x900:
1. `/indices/sealed`: the level in Display size with its 1D delta and "as of the close of {yesterday} (UTC)"; six stats in one row at 1440, two columns at 390; no horizontal page scroll at 390.
2. The chart: y labels on the right in 12 px on the phone (not squashed), month labels below (every other one on the phone), the last point's dot and "level · date" label, no Recharts request in the network panel, and `All` shows the dashed weekly segment with its footnote while `1Y` does not.
3. Range and sort: tapping `All`, `1Y`, a column header or a phone chip changes the URL and keeps the scroll position; the sorted header is bold with ▲ or ▼; `aria-sort` in the DOM.
4. The provisional note (the perf fixture has a provisional day 12 days back: point the stub's clock at that day, or check on production when it happens) in amber with the icon and a working link; the overdue note after stopping the fixture's newest day.
5. Keyboard: tab through the page; every link and "?" has a visible focus ring; the phone chips are 44 px tall.
6. `/indices/sealed/levels.csv` downloads with the two `#` lines and no product price; `/api/public/index/sealed` returns the compact JSON; `/methodology#index` shows the rules with the new version and change-log row.

## Owner actions

1. **Apply `migrations/0042_market_index.sql`** in the Supabase SQL editor (paste the file) or with `supabase db push`, after 0038 and 0039 (it does not need 0041). Expect a NOTICE about pg_cron when it is not enabled. Then run the verification query the executor attaches (`/tmp/wp29_0042.sql`): every row OK.
2. **Schedule the nightly job** if pg_cron was not enabled when you applied 0042 (decision D8). After enabling pg_cron (Dashboard > Database > Extensions), run once:
   `SELECT cron.schedule('pokefin-publish-market-index', '45 0 * * *', $cmd$SELECT public.refresh_market_index((now() AT TIME ZONE 'UTC')::date - 1)$cmd$);`
   Check: `SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'pokefin-%';` lists WP25's `pokefin-finalise-market-analytics` (`30 0 * * *`) and this job (`45 0 * * *`). Without pg_cron the scraper publishes the index after each run instead.
3. **Check the start of daily resolution**: `SELECT public.market_index_detect_daily_from();` should be the first Monday on or after the day live scraping began. To see the evidence: `SELECT recorded_at::date AS day, count(*) FILTER (WHERE recorded_at::time <> '12:00:00') AS scraped, count(*) AS total FROM product_price_history GROUP BY 1 ORDER BY 1;` around that date. If it is wrong, set it (a Monday) before the backfill: `INSERT INTO public.market_index_settings (id, daily_from, source) VALUES (true, 'YYYY-MM-DD', 'owner') ON CONFLICT (id) DO UPDATE SET daily_from = EXCLUDED.daily_from, source = 'owner', updated_at = now();`
4. **Run the backfill**, once, with the same environment as WP25's backfills (`POKEFIN_SCRAPER_DATABASE_URL`, or the service key for the one run): first confirm WP25's stats backfill ran (`SELECT public.market_index_backfill_range();` shows `first_stats_day` about 400 days back), then `python scripts/backfill_market_index.py`. Expect "Building the chain from the first stats day ..." and "Done in N s (ok M)". Then: `SELECT index_code, min(day), max(day), count(*) FROM public.market_index_daily GROUP BY 1 ORDER BY 1;` (the headline's `max` is yesterday) and `SELECT count(*) FILTER (WHERE provisional), count(*) FROM public.market_index_daily WHERE index_code = 'sealed';` (a few provisional days around the scrape-drift gaps are expected; more than 10% means collection gaps worth a look).
5. **Generate the database types** for phase B: `pnpm types:db` in `frontend/` with your `SUPABASE_ACCESS_TOKEN`, or give the executor a token for one run; push `app/types/database.ts` to the PR branch.
6. **Rebuilding later** (a rule change, a corrected `daily_from`): `SELECT public.reset_market_index();` in the SQL editor, then step 4 again. Published history is otherwise never recomputed.
   **When the scraper log says "Sealed Index not published ... (behind)"** (pg_cron and the scraper were both off for more than 31 days, or a month got no constituent list after a long collection stop): run `python scripts/backfill_market_index.py` with no arguments. It extends the chain from the day after the newest level and crosses the gap; no reset is needed.
7. After deploy, open `/indices/sealed` at phone and desktop width, download the CSV, and check `/methodology#index`.

## Acceptance criteria

- [ ] `migrations/0042_market_index.sql` exists, `verify_migration.py` exits 3 with no REFUSED line, and the verification query returns 113 OK rows on `replay_twice`.
- [ ] WP21's replay harness passes with 0042 applied twice; `tests/test_wp29_market_index_db.py` passes 23 of 23, twice in a row on the same database.
- [ ] Levels are reproducible from a clean backfill: after `reset_market_index()`, the backfill script reproduces every row of `market_index_daily` (all columns but `computed_at`) and every `index_constituents` row exactly (DB test `test_levels_are_reproducible_from_a_clean_backfill`).
- [ ] A stale constituent never contributes a return (DB test `test_a_stale_constituent_never_contributes`); returns are clipped at 50%; a 3-day gap is carried; a longer gap drops out and re-enters without a catch-up jump; a day under 80% coverage is provisional; points before `daily_from` are Mondays only with Monday-to-Monday returns.
- [ ] Published days, the newest included, are never recomputed (`already_published`); the live path never starts a chain (`not_initialised`); a nightly call more than 31 days behind writes nothing (`behind`), and the backfill (`p_start`) crosses such a gap, including a month without a list (DB test `test_the_backfill_crosses_a_month_without_a_list`).
- [ ] `anon` and `authenticated` can SELECT the four tables and the view and cannot write, truncate, refresh or reset; `pokefin_scraper` can EXECUTE `refresh_market_index` and `market_index_backfill_range` and nothing else new.
- [ ] The scraper calls `refresh_index_after_run` after the analytics refresh and before revalidation; the hook never raises (`tests/test_main.py`, `tests/test_wp29_scripts.py`).
- [ ] `/indices/sealed` renders the level, 1D/7D/30D/1Y changes, constituents, coverage, the "as of the close of" D-1 stamp, a methodology link, the server SVG chart with 1Y and All via `?range=`, the dashed weekly segment with its footnote, breadth, and the sortable sub-index table (table from 768 px, DataList below); the provisional and overdue notes use the warn role, and the overdue note never shows before 06:00 UTC on the day after D-1 was due (Jest `isIndexOverdue` and page cases); the index reads refresh hourly (`serverMarketData.index.test.ts`); at 768 px the page has no horizontal scroll.
- [ ] The page has zero client charting JS and no client component of its own: the page test's source guard passes, the built route loads no Recharts or supabase-js chunk (WP26 gate when present), and `perf-budgets.json` has `/indices/sealed` with filled limits; `pnpm perf:budget` exits 0 and its `jsGzKb` is within 0.5 kB of `/privacy`.
- [ ] `/indices/sealed/levels.csv` serves derived levels only with the CC BY 4.0 lines and `Link` header; `/api/public/index/[code]` serves the compact series under ISR and 404s unknown codes.
- [ ] Dataset and BreadcrumbList JSON-LD on the page; `/indices/sealed` in the sitemap; the footer Browse column links to it (with WP27).
- [ ] `/methodology#index` states every rule with numbers interpolated from `marketIndex.ts`, the version moved up one minor with a change-log row, and `marketIndexConstants.test.ts` passes.
- [ ] `tsc` exits 0 after phase B, `pnpm lint` has 0 errors, `pnpm test --ci` and `pnpm run test:scripts` pass, no file in this PR contains an em dash, and no file under `frontend/app/` contains the words cap-weighted, market cap, live price, real-time or all-time.

## Rollback

- **Code**: revert the PR (`git revert -m 1 <merge commit>`). The scraper stops calling the index; the page, the API route and the CSV disappear; `/methodology` returns to the previous version. The tables stay and are harmless.
- **Stop the nightly job only**: `SELECT cron.unschedule('pokefin-publish-market-index');`
- **Rebuild instead of rolling back** (wrong levels after a data fix): Owner action 6.
- **Database** (after the code revert and after reverting any package that reads the index: WP31, WP32, WP36, WP37), as a new numbered migration `NNNN_drop_market_index.sql` at the first free number above 0047 (numbers up to 0047 are reserved; see `audits/remediation/00-PLAN.md`, "Migration registry"), never by editing 0042:

```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pokefin-publish-market-index') THEN
    PERFORM cron.unschedule('pokefin-publish-market-index');
  END IF;
END $$;
DROP VIEW IF EXISTS public.market_index_summary;
DROP FUNCTION IF EXISTS public.refresh_market_index(date, boolean);
DROP FUNCTION IF EXISTS public.market_index_backfill_range();
DROP FUNCTION IF EXISTS public.reset_market_index();
DROP FUNCTION IF EXISTS public.refresh_market_index_day(date, date);
DROP FUNCTION IF EXISTS public.freeze_market_index_month(date);
DROP FUNCTION IF EXISTS public.market_index_daily_from();
DROP FUNCTION IF EXISTS public.market_index_detect_daily_from(bigint[]);
DROP FUNCTION IF EXISTS public.market_index_type_text(text, text);
DROP TABLE IF EXISTS public.market_index_daily;
DROP TABLE IF EXISTS public.index_constituents;
DROP TABLE IF EXISTS public.market_index_settings;
DROP TABLE IF EXISTS public.index_definitions;
```

  With the code reverted first, nothing calls these objects; with only the database dropped, the scraper logs "apply migration 0042" once per run and continues.

## Commit and PR

Branch: `remediation/wp29-sealed-index-and-breadth`.

Commits (each builds and passes its tests):
1. `feat(db): Pokéfin Sealed Index family and breadth (0042, WP29)`: the migration, `scraper_db.py`, `market_analytics.py`, `main.py`, `scripts/backfill_market_index.py`, `tests/test_wp29_*.py`, `tests/test_main.py`, README and HARDENING_FOLLOWUPS.
2. `feat(web): /indices/sealed, index API and levels CSV (WP29)`: `format.ts`, `marketIndex.ts`, `indexChart.ts`, `serverMarketData.ts`, `jsonLd.ts`, the route handlers, `app/indices/sealed/*`, `publicMarketApi.ts`, ESLint list, sitemap, navConfig, their tests.
3. `docs(methodology): publish the Sealed Index rules (WP29)`: `methodology.ts`, `MethodologyArticle.tsx`, `metricDefinitions.ts` and their tests.
4. `perf: index fixture and budgets (WP29)`: `perf.mjs`, `perf-fixture.test.mjs`, `perf-budgets.json`.
5. (phase B) `chore(types): regenerate database types for 0042 (WP29)`.

Commit 1 message body:

```text
A daily, rules-based benchmark for sealed Pokémon: equal-weighted,
chain-linked, base 100, published for D-1 only.

- Constituents frozen monthly from product_daily_stats: fresh price,
  >= 3 distinct prices in a year, >= 15 USD, set released >= 90 days,
  no booster packs; sub-indices by type, generation and set (>= 3).
- Returns clipped at +-50%; 3-day carry; longer gaps drop out without a
  catch-up; provisional under 80% coverage; weekly Monday-to-Monday
  points before daily collection; published days never recomputed.
- Breadth per level: advancers, decliners, unchanged over 7 days, new
  52-week highs and lows.
- refresh_market_index SECURITY DEFINER for pokefin_scraper and pg_cron
  (00:45 UTC); backfill script; scraper hook after each run.
```

PR title: `feat: Pokéfin Sealed Index family and market breadth (WP29)`

PR body:
- Goal in two sentences and a link to this spec.
- Phase status: "[waiting for DB types]" until step 24, then removed.
- Verification output: `verify_migration.py` stderr, the replay harness's last line, the 113-OK count, both runs of the DB module, the unit test summaries, the timing from Verification step 4 if run, `tsc`, lint, Jest summary, and the `perf:budget` table before and after (with the `/indices/sealed` rows).
- Screenshots of `/indices/sealed` at 390 and 1440 px (1Y and All, a provisional day if the fixture clock allows) and `/methodology#index`.
- Owner actions 1 to 7 copied from this spec.
- Soft dependencies found missing (Before you start) and what was done: WP26's `publicRoute.ts`, `publicMarketApi.ts`, `forbiddenChunks`, ESLint list; WP27's `navConfig.ts`.
- "Noticed, out of scope": the weekly PDF report still has no benchmark line (a WP16 follow-up can read `market_index_daily`); a traded-value-weighted secondary index (`research/data-opportunities.md` §3.7) and age-bucket sub-indices are deferred; the backfilled history of `product_daily_stats` only covers products active when WP25's backfill ran, so the index's pre-launch months inherit that survivorship (documented on `/methodology#index-constituents`); sub-index rows link nowhere yet (WP37 links set rows to their set pages; a per-index chart for type and generation indices is a follow-up); WP32's home header passes `utcTodayKey()` to `isIndexOverdue`, which keeps the day-granular rule and can show "Not updated" between 00:00 UTC and the next regeneration, so WP32 should pass `new Date()` at render time instead.
