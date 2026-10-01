# WP37: Sets section, set pages and dynamic share cards

- **Goal**: a collector opens `/sets/<set-name>` and sees, for that set, every tracked sealed product with its dated Market Price, 30D and 1Y change, units sold and a baked 1Y sparkline, the set's index chart (or a median line when the set has no index), set-level units sold and listings, a plain-language summary built from the numbers, and links to the previous and next set. `/sets` compares every set on one server-rendered, sortable table with three column presets (Performance, Risk, Liquidity) and a risk/return chart. A product or set link pasted into Discord, X, iMessage or Reddit previews a card that states the TCGplayer day it describes, and a stale product's card says "No current price".
- **Why now / value**: set pages are signature feature 9 (`01-PRODUCT-DIRECTION.md` §5) and the main search entry point the site lacks: people search set names, and today `/stats` is a 1,680 px wide table with no set pages, no links from rows and an "Invest Score" label (`research/ui-audit.md` top-10 item 6; `research/trust-seo-brand.md` §11.1 to §11.4). Every input now exists: WP29's set indices, WP25's daily stats, WP26's baked sparklines, WP24's labels and JSON-LD helpers, WP31's quote model for the share card. It closes Track 2.
- **Effort**: L, about 16 hours (migration and DB tests 2 h, set data layer 2.5 h, `/sets` 3 h, set page 3 h, product page, nav, footer, sitemap and redirects 1.5 h, share cards 2 h, perf and smoke wiring 1 h, tests and verification 1 h). Plus about 30 minutes of owner time.
- **Depends on**: WP13 (`app/lib/site.ts`, `sitemap.ts`, the `redirects()` block in `next.config.ts`, `productMeta.ts` with `buildProductMetadata`, `getProductLabel`, `productPath`, `parseProductId`, `NotFoundPanel`), WP21 (`scripts/db/replay_migrations.sh`, `verify_migration.py`, CI job "Database replay and Python tests", `pokefin_scraper`), WP22 (`perf-budgets.json`, `scripts/fixtures/perf.mjs`, `perf-fixture.test.mjs`, `pnpm perf:budget`, `prod-smoke-lib.mjs`, `prod-smoke.mjs`, `prod-confirm.mjs`), WP23 (`PageHeader`, `ProvenanceLine`, `AsOf`, `Stat`, `Delta`, `Badge`, `DataList`/`DataListRow`, `EmptyState`, `Skeleton`, `buttonClasses`, tokens, `format.ts` percent helpers, the conventions ratchet), WP24 (`MetricLabel`, `DecisionNote`, `PROVENANCE_SENTENCE`, `metricDefinitions.ts`, `setAnalytics.ts` with `formatCompositePercentile`, `jsonLd.ts` with `serializeJsonLd` and `buildBreadcrumbJsonLd`, `methodology.ts`, `MethodologyArticle.tsx`, the `/stats` label work this package moves), WP26 (`getCachedSparklines`, `sparklineFor`, `pickSparklines`, `decodeSparkline`, `MiniSparkline`, `forbiddenChunks`, `PUBLIC_ROUTE_CLIENT_FILES`), WP29 (`getCachedIndexSummary`, `getCachedIndexSeries`, `currentSummaries`, `sliceIndexRange`, `addDaysToKey`, `utcTodayKey`, `INDEX_RULES`, `IndexChart`, `niceStep`, the `set-<sets.id>` index codes and their perf fixture), WP31 (`buildQuote`, `todayUtcKey` in `productModel.ts`, the new product page composition, `SiblingList.tsx`). Through them: WP07 (`format.ts`), WP11 (`cacheTags.ts`, `DAILY_BACKSTOP_SECONDS`, ISR with empty `generateStaticParams`), WP20 (`pnpm types:db`, `app/types/market.ts`, async root layout), WP25 (`getCachedProductStats`, `fetchAllRows`, `product_daily_stats`, `vol_weekly_52w`). Soft, each with a default in Before you start: WP27 (`navConfig.ts`, `FOOTER_BROWSE`, `setSearchHref`, `PokefinMark`), `IntentLink` (WP11 step 13a; WP30 step 1 recreates it when missing), WP32 (`app/components/Price.tsx`), WP33 (`REDIRECT_CHECKS` and `judgeRedirect` in `prod-smoke-lib.mjs`).
- **Unblocks**: nothing in Track 2 (last package). Deferred next-wave items build on it: type and era hubs (`/sealed/[slug]`, `/eras/[slug]`) reuse `product_types.slug` and `generations.slug` from 0041 and the hub components, editorial guides link set hubs.
- **Placement**: last package of Track 2, after WP31 (product header data and breadcrumb location) and WP29 (set indices). It reserves migration **0041** and keeps that number if it merges out of order. Its redirect change supersedes WP13's `/stats` target: `/stats` and `/analytics` each answer one 308 to `/sets`.
- **Suggested branch name**: `remediation/wp37-sets-section-and-share-cards`
- **Risk level**: medium. A migration adds NOT NULL unique columns to three reference tables (validated twice on PostgreSQL 16, idempotent, additive), and the package replaces a public route, the product breadcrumb and every product's share image; each change has a unit test, the redirects are checked by the daily smoke test, and rollback is a revert plus an optional column drop.

## Why

Today a collector who wants "Prismatic Evolutions sealed prices" has no page to land on: the set name is plain text on product pages, `/stats` and `/analytics` serve the same 20-column table under two URLs, its rows link nowhere, and it leads with an "Invest Score" (`research/ui-audit.md` "The 10 highest-leverage" item 6; `research/trust-seo-brand.md` §11.4). Set pages are how collectors think and how they search, so they are both the missing browse path and the site's best programmatic SEO surface, provided each page carries real data and a summary derived from it rather than thin boilerplate (`research/trust-seo-brand.md` §11.3, thin-content rules). Shared links are the other gap: a product link pasted into a chat shows a bare photo with no price, and caches of that card outlive the price, so the card must state its day and never show a withheld price (`research/trust-seo-brand.md` §11.8; `01-PRODUCT-DIRECTION.md` §2 principle 1). This package adds name slugs (migration 0041), `/sets` with presets and a server-rendered risk/return chart, `/sets/[slug]` with the WP29 set index or a median-of-constituents line, linked breadcrumbs and set links on product pages, set hubs in the sitemap and footer, and dynamic share images for products and sets, all server-rendered with zero client charting code (`research/performance-excellence.md` §7.1; `01-PRODUCT-DIRECTION.md` §3.4, §6.1).

## Design

### D1. Decisions (binding)

1. **URLs**: `/sets` and `/sets/<slug>`, where the slug comes from the set **name**, never the code (`sets.code` is not unique). Product URLs stay `/product/[id]`.
2. **Slugs are stored** (migration 0041): `pokefin_slugify(text)` (IMMUTABLE), a `slug` column on `sets`, `product_types` and `generations` (NOT NULL, unique, format CHECK), a deterministic fill (oldest row keeps the bare slug, the next gets `-<qualifier>`, then `-<id>`), and BEFORE INSERT triggers that set a missing slug by the same rule. Renaming a row never changes its slug. The owner runs the collision query before applying.
3. **A name-derived slug that is not stored redirects** (308, `permanentRedirect`) to the stored slug of the earliest-released set with that name. This makes `setSearchHref(name)` work without a slug in the search payload, and keeps old links working after a rename.
4. **Redirects**: `/analytics` and `/stats` each answer exactly one 308 to `/sets` (WP13's `/stats` to `/analytics` entry is replaced, not chained). `app/analytics/` and `app/stats/` are deleted.
5. **Indexing**: a set hub with fewer than 3 priced products (`MIN_PRICED_PRODUCTS_FOR_INDEXING`) renders but carries `robots: noindex, follow`, is left out of the sitemap, out of the `/sets` ItemList JSON-LD and out of the footer. No set-by-type pages; type and era hubs are deferred (the slug columns exist for them).
6. **Summaries** are template sentences built from the numbers on the page. A sentence whose input is null is dropped. No LLM, no hand-written copy per set.
7. **Charts are server-rendered**: the set chart reuses WP29's `IndexChart` (SVG, no client JS); when the set has no index it shows the **median line** (D3). The `/sets` risk/return chart is server SVG. `/sets` and every set page load no charting library (checked by `forbiddenChunks` and a source test).
8. **`/sets` is dynamic** (reads `searchParams` for `view`, `sort`, `dir`), exactly like WP29's `/indices/sealed`: every read is an `unstable_cache` entry tagged `market-products`, so a request renders from cache. Presets and sorting are links; there is no client component of its own. Canonical is `/sets` for every parameter combination. Set pages are ISR (`revalidate = 86400`, empty `generateStaticParams`, tag `market-products` through the cached reads).
9. **Share images**: `app/product/[id]/opengraph-image.tsx` and `app/sets/[slug]/opengraph-image.tsx`, 1200 x 630 PNG, Geist Regular and SemiBold `.ttf` committed under `frontend/assets/og/` (about 254 kB, under ImageResponse's 500 kB limit). The date is mandatory on every card. A withheld price renders "No current price" and "Last priced {date}". Photos are embedded only when their bytes are PNG or JPEG: the spike for this spec rendered PNG and JPEG and **WebP threw** (`u2 is not iterable`, Next 16.3.6, `@vercel/og` 0.11.1, satori 0.25.0), so a WebP original uses the no-photo layout. `buildProductMetadata` drops `openGraph.images` and sets `twitter.card = "summary_large_image"`.
10. **Product page**: the breadcrumb becomes `Home › Sets › {Set} › {Type}` with every crumb but the last linked, plus a matching `BreadcrumbList`. The set name in the header line and in "Other products in {Set}" links to the set page.
11. **Navigation**: the nav "Sets" item points to `/sets`; the global search's set results open set pages; the footer Browse column appends the 5 newest released, indexable sets.
12. **No new paid service, no new dependency.** The fonts come from the `geist` npm tarball (SIL OFL 1.1), copied once.

### D2. Data flow

```text
 public.sets (+slug, 0041) ----------------------- getCachedSetDirectory()        unstable_cache, tag market-products
 get_market_product_summaries (0023 gates) ------- getCachedMarketProductSummaries() (WP11)
        |                                                   |
        +--------- buildSetCatalog(directory, products) ----+--> footer links (root layout), sitemap rows, noindex rule
        |
 product_stats_latest (WP25) ---- getCachedProductStats()  --+
 get_set_analytics (SQL) -------- getCachedSetAnalytics()  --+--> buildSetHubs(catalog, ...) --> /sets table, risk/return chart
 market_index_summary (WP29) ---- getCachedIndexSummary()  --+                               --> /sets/[slug] header, summary
                                                                                             
 /sets/[slug] chart:  hub.index ? getCachedIndexSeries("set-<id>") (WP29)
                                : getCachedSetDailyPrices(productIds, D-365) -> buildSetMedianLine()   (product_daily_stats)
 /sets/[slug] rows:   summaries + stats + getCachedSparklines("1Y") (WP26) -> pickSparklines()
 share images:        product: getCachedProductDetail + stats + fx + rate + sparklines("3M") -> WP31 buildQuote -> model
                      set:     loadSetHub(slug) -> model; photos fetched, sniffed, PNG/JPEG only
```

All composition happens in plain async functions in `app/lib/setHubsData.ts` (React `cache()` per request), never inside another `unstable_cache` callback (WP11's nested-cache rule). The only new database reads are two cached reads: the ~60-row `sets` table and, for a set without an index, at most 27 x 366 `product_daily_stats` rows through the `(product_id, day DESC)` index.

### D3. Metric definitions (set level)

All percent figures are percent points. "Priced" means the product has a current price under migration 0023's 14-day rule (`hasCurrentPrice`). Nothing here re-derives a withheld number.

| Figure | Definition | Edge cases |
|---|---|---|
| Products | Active products whose `set_id` is the set (summaries rows) | A set with 0 active products has no hub (404) |
| Priced | Products with a current price | Withheld products count in Products, not here |
| As of (hub) | Newest UTC day of `price_recorded_at` among priced products | No priced product: no "as of" line |
| Indexable | Priced >= 3 | Below: `noindex, follow`, out of sitemap, ItemList and footer |
| Med 30D, Med 90D, Med 1Y, Consistency 90D/1Y, Volatility 90D (daily), Max Drawdown 1Y, Composite score | `get_set_analytics` row matched on its key `concat(coalesce(code,'unknown'), ':', coalesce(name,'Unknown Set'))` | No match (renamed set until the next scrape): every one of these is `--` |
| Composite score | Shown as WP24's percentile "Top N%" of the rank among ranked sets; the z-score is in `title`; sorts on the z-score | Unranked: `--` |
| Consistency | Integer percent (`formatPercent(v, { decimals: 0 })`) | |
| Volatility 1Y (weekly, median) | Median over the set's products of WP25 `vol_weekly_52w` (annualised, %) | Products without 26 weekly changes are skipped; none: `--` |
| Units sold (30d) | Sum of `units_sold_30d` over products whose stats row has it (WP25 gates) | None: `--`. The set page says "{k} of {n} products" when k < n |
| Active listings, Units on market | Sums of `active_listings`, `qty_available` over products with a fresh snapshot | Same |
| Days of supply (set) | `sum(qty) / (sum(units30) / 30)` over products that have **both** figures | Pair units 0 or no pair: `--` |
| Risk/return point | x = Volatility 1Y (weekly, median), y = Med 1Y, dot diameter `round(8 + 16 * sqrt(products / maxProducts))` px | Needs both values; fewer than 3 plottable sets: no chart, an empty state; omitted sets are counted under the chart |
| Set chart | The set's WP29 index (`set-<sets.id>`) when it is published for the headline's day: the 365 days ending on its newest level | Read failure: "The set chart could not be loaded" |
| Median line (no index) | Over the 365 days ending on the stats day: for each day with prices, the median of `clip(p(t)/p(t-1) - 1, -50%, +50%)` over products whose `product_daily_stats` row is `is_price_fresh` on both days; level chains from 100 on the first priced day; a day with no pair keeps the level | Fewer than 2 products ever priced: no points ("No history"). Reads at most the first 27 products by id. It is labelled as not an index |
| Previous / next set | Neighbours in release-date order (then id) among hubs with a release date | First or last: that side is omitted |

Summary templates (each sentence is dropped when its condition fails):

| # | Condition | Sentence |
|---|---|---|
| 1 | always | "{Set} has {n} tracked sealed product(s)[, released {Mon D, YYYY}]." |
| 2 | Med 1Y is a finite number | "The median 1-year change is {+x.x%}." |
| 3 | at least 2 products with a 1Y change | max > 0: "The {Type} rose the most over 1 year ({+x.x%})." else "The {Type} held up best over 1 year ({x.x%})." |
| 4 | at least 2 products with units sold, top > 0 | "The {Type} sold the most units in the last 30 days ({n})." |
| 5 | withheld products > 0 | "1 product has no current price." / "{n} products have no current price." |

### D4. `/sets`

Desktop, 1440 px (content `max-w-7xl`), Performance preset, sorted by composite score:

```text
+------------------------------------------------------------------------------------------------------------+
| Pokémon TCG sets                                                                              H1 24/32     |
| TCGplayer Market Price in USD, updated daily. Prices older than 14 days are hidden. Set figures are       |
| medians and totals across each set's tracked products. Methodology                                        |
| as of Sep 30                                                                                               |
|                                                                                                            |
| 55 sets, performance                                              [#Performance#| Risk | Liquidity ]      |
| +--------------------------------------------------------------------------------------------------------+ |
| | SET ↕                  RELEASE (?) ↕  PRODUCTS (?) ↕  MED 30D (?) ↕  MED 90D (?) ↕  MED 1Y (?) ↕  CONSISTENCY 1Y (?) ↕  COMPOSITE SCORE (?) ▼ |  40 px
| | Prismatic Evolutions SV8.5  Jan 17, 2025      9     ▲ 4.2%       ▲ 12.0%      ▲ 38.2%       67%         Top 2%  |  44 px
| | Crown Zenith SWSH12.5       Jan 20, 2023     11     ▼ 1.1%       ▲ 3.4%       ▲ 21.0%       73%         Top 4%  |
| | ...                                                                                                    | |
| +--------------------------------------------------------------------------------------------------------+ |
| > What do these columns mean?                                                                              |
| Screens describe past prices. They are not recommendations. How we calculate this                         |
|                                                                                                            |
| +--------------------------------------------------------------------------------------------------------+ |
| | Risk and return by set                                                                       H3        | |
| | Each dot is a set: further right moved more week to week, higher gained more over a year.             | |
| |  +60% |                                   o                                                            | |
| |  +40% |              O         o                                                                       | |
| |  +20% |     o    O        o            o                                                               | |
| |    0% |-----------------------------------------------------------------  (bench colour)              | |
| |  -20% |                 o                                                                              | |
| |        0%        10%        20%        30%        40%                                                  | |
| | Across: median weekly volatility over 52 weeks, annualised. Up: median 1-year change. Dot size: ...    | |
| | 6 sets have no 1-year change or weekly volatility yet and are not plotted.                             | |
| | > Chart data as a table                                                                                | |
| +--------------------------------------------------------------------------------------------------------+ |
| (CardRinkPromo, last child of <main>, WP15)                                                                |
+------------------------------------------------------------------------------------------------------------+
```

Presets (columns after "Set"):

| Preset | Columns | Default sort |
|---|---|---|
| Performance | Release, Products, Med 30D, Med 90D, Med 1Y, Consistency 1Y, Composite score | Composite score, best first |
| Risk | Products, Volatility 1Y (weekly, median), Volatility 90D (daily), Max Drawdown 1Y, Consistency 90D, Med 1Y | Volatility 1Y, lowest first |
| Liquidity | Products, Priced, Units sold (30d), Active listings, Units on market, Days of supply | Units sold (30d), highest first |

Phone, 390 px (16 px gutters): the same header, then the preset control full width, sort chips, and WP23 `DataList` rows (no table in a scroll box). The chart keeps its full width at 288 px tall with HTML tick labels at 12 px.

```text
+--------------------------------------+
| Pokémon TCG sets                     |
| TCGplayer Market Price in USD, ...   |
| Methodology                          |
| as of Sep 30                         |
| 55 sets, performance                 |
| [#Performance#| Risk | Liquidity ]   |  44 px segments (links)
| [Released][Med 30D][Med 90D][Med 1Y] |  chips, horizontal scroll, 44 px on touch
| [Cons. 1Y][#Composite ▼#][Name]      |
| Prismatic Evolutions  Scarlet & V... |  line 1: name + generation
| 9 products · Jan 2025  Composite Top 2%  ▲ 38.2% 1Y |  line 2: meta | sorted value + Med 1Y
| Crown Zenith          Sword & Shield |
| 11 products · Jan 2023 Composite Top 4%  ▲ 21.0% 1Y |
| > What do these columns mean?        |
| Screens describe past prices. ...    |
| Risk and return by set               |
| [chart 288 px]                       |
| > Chart data as a table              |
+--------------------------------------+
```

States:
- **Loading**: none of its own (dynamic page, cached reads; a `loading.tsx` would flash a skeleton on every sort click).
- **Error** (`getCachedSetDirectory` failed so `loadSetHubs` returns null, or the summaries read rejected): `EmptyState` h2 "Sets could not be loaded", "This is usually temporary. Reload the page in a minute.", a secondary "Reload" link to the same URL. Never an empty table.
- **Empty** (no set has an active product): `EmptyState` "No sets yet", "Sets appear once their products are priced."
- **Stale data**: `AsOf` turns warn with the clock icon at 2 or more days (WP23); withheld products drop out of every median upstream.
- **Missing values**: `--` with sr-only "Not available"; missing values sort last in both directions.
- **Chart with fewer than 3 plottable sets**: `EmptyState` "Not enough sets have a year of prices and weekly volatility yet."

Interactions: preset links (`?view=risk`), header sort links (`?sort=med365&dir=asc`; clicking the sorted column flips it, another column starts in its "better" direction: higher first for returns, counts and composite, lower first for volatility, drawdown and days of supply), phone sort chips. Every link has `scroll={false}` and `prefetch={false}`. The table rows link to set pages through `IntentLink` (prefetch on intent, WP30). Scatter dots are links with a `<title>` tooltip and `tabIndex={-1}`; the "Chart data as a table" disclosure is the keyboard and screen-reader path.

Accessibility: one `h1`; sections labelled by `h2`/`h3`; table `caption` (sr-only), `th scope="col"`, `aria-sort` on every sortable header, a visible ▲/▼ on the sorted column and a faint ↕ elsewhere, bold sorted header; each sort link's name is "Sort by {label}"; `MetricLabel` "?" links (24 px targets, WP24); the chart SVG is `aria-hidden` with an sr-only summary sentence in the `figcaption`; colour is never the only cue (`Delta` glyph plus sr-only word); 44 px touch targets via `pointer-coarse:`.

### D5. `/sets/[slug]`

Desktop, 1440 px (content `max-w-6xl`), a set with an index:

```text
+--------------------------------------------------------------------------------------------------+
| Home › Sets › Prismatic Evolutions                                                     breadcrumb |
| Prismatic Evolutions sealed product prices                                             H1 24/32   |
| Scarlet & Violet · SV8.5 · Released Jan 17, 2025                                                  |
| TCGplayer Market Price in USD, updated daily. Prices older than 14 days are hidden. Methodology   |
| as of Sep 30                                                                                      |
|                                                                                                   |
| Prismatic Evolutions has 9 tracked sealed products, released Jan 17, 2025. The median 1-year      |
| change is +38.2%. The Booster Bundle rose the most over 1 year (+61.0%). The Elite Trainer Box    |
| sold the most units in the last 30 days (412). 2 products have no current price.     prose 16/26  |
|                                                                                                   |
| +-----------------------------------------------------------------------------------------------+ |
| | Sales and supply                                                                         H3   | |
| | Units sold (30d) (?)   Active listings (?)   Units on market (?)   Days of supply (?)         | |
| | 1,204                  318                   2,906                 72.4                       | |
| | 7 of 9 products        8 of 9 products                                                        | |
| +-----------------------------------------------------------------------------------------------+ |
| 9 sealed products                                                                      H2         |
| +-----------------------------------------------------------------------------------------------+ |
| | PRODUCT              MARKET PRICE (?)   30D      1Y       UNITS SOLD (30D) (?)  DAYS OF SUPPLY (?)  1Y TREND | 40 px
| | Booster Box          C$298.40           ▲ 2.1%   ▲ 40.3%  212                   12.4          /\/\_/  | 44 px
| | Booster Bundle       C$61.10 (clock)    ▼ 0.4%   ▲ 61.0%  140                   8.1           _/\/\   |
| | Elite Trainer Box    --                 --       --       --                    --            No history |
| +-----------------------------------------------------------------------------------------------+ |
| +-----------------------------------------------------------------------------------------------+ |
| | Prismatic Evolutions Index                                                              H3    | |
| | Index level (?)        30D         1Y          Constituents                                    | |
| | 131.20                 ▲ 1.0%      ▲ 12.5%     6                                               | |
| | as of the close of Sep 30, 2026 (UTC)                                                           | |
| | [WP29 IndexChart, 1Y, h-56 md:h-72, weekly segment dashed and footnoted when in range]         | |
| | Equal-weighted, chain-linked, published for the previous UTC day. How set indices work          | |
| +-----------------------------------------------------------------------------------------------+ |
| [ Previous set: Surging Sparks · Nov 8, 2024 ]                 [ Next set: Journey Together ... ] |
| All sets                                                                                          |
| (CardRinkPromo, last child)                                                                       |
+--------------------------------------------------------------------------------------------------+
```

Without an index the chart card is titled "Median price change", shows the median line in the same `IndexChart`, and the caption reads: "{Set} has no index yet: a set index needs 3 products that pass the index screen. This line chains the median daily change of the set's products from 100, so it is not an index. How this line is built" (link to `/methodology#set-pages`).

Phone, 390 px: breadcrumb, H1 (wraps), meta line, provenance, as-of, summary, the four stats in a 2 x 2 grid, the products as `DataList` rows (line 1: type label and the 64 x 24 sparkline; line 2: "412 sold 30D" | price and `▲ 4.2% 30D`), the chart card (224 px chart), previous and next as two stacked cards, "All sets".

States:
- **Loading** (`app/sets/[slug]/loading.tsx`): flat `Skeleton` bars that reserve the breadcrumb, H1, summary lines, stats card, six rows and the chart box; `role="status"` sr-only "Loading the set". No fake chart shape.
- **Unknown slug**: `notFound()`; `app/sets/[slug]/not-found.tsx` shows `EmptyState` "We don't track that set", "The link may be old, or the set may have a new name.", button "All sets". Metadata: "Set not found", noindex, no canonical.
- **Renamed or duplicate-name slug**: 308 to the stored slug.
- **Directory read failure**: the page throws, so ISR keeps serving the last good page (never caches a 404 for a real set).
- **Withheld product**: price `--` with sr-only "No current price", changes `--` with "Price withheld", sparkline "No history" (WP26 never bakes a line for a withheld price); counted in summary sentence 5.
- **Aging price** (2 to 13 days): the price is still shown; desktop puts the `AsOf` table-variant clock icon beside it, phones add the inline `AsOf` ("Last priced Sep 25" with the clock) to the row's second line, because a `title` tooltip never shows on touch (WP23).
- **Sparkline read failure** (`getCachedSparklines` null): WP26's flat placeholder bars, never "No history"; the next regeneration (scrape or daily) fills them.
- **No priced product at all**: no "as of" line, summary sentences 1 and 5 only, chart "No history", noindex.
- **Chart read failure**: `EmptyState` "The set chart could not be loaded".

### D6. Product page (WP31 layout)

```text
Home › Sets › Evolving Skies › Booster Bundle                 (all but the last crumb linked, › separators)
[img]  Evolving Skies Booster Bundle                           H1 (WP31, unchanged)
       Evolving Skies · Sword & Shield · SWSH07 · Released Aug 27, 2021   ("Evolving Skies" links to /sets/evolving-skies)
...
Other products in Evolving Skies                               ("Evolving Skies" links to the set page)
```

The breadcrumb's last crumb is the product type label with the variant in parentheses ("Elite Trainer Box (Pokémon Center)"). When the set is missing from the directory the set crumb is left out (Home › Sets › {Type}) rather than linked to a 404. A second JSON-LD block, `BreadcrumbList`, carries the same items with absolute URLs (the last item is the product URL). The breadcrumb is a `nav` labelled "Breadcrumb" with an `ol`, the current item `aria-current="page"`, links 44 px tall on coarse pointers.

### D7. Share images

Product card, 1200 x 630, fresh price, PNG or JPEG photo (rendered while writing this spec):

```text
+----------------------------------------------------------------------------------------+
|  +------------------+   Prismatic Evolutions · Scarlet & Violet          26 px soft     |
|  |                  |   Prismatic Evolutions Elite Trainer Box           44 px semibold |
|  |   product photo  |   (Pokémon Center)                                 2 lines max    |
|  |    360 x 360     |   C$82.10   $59.99 USD                             72 px / 30 px  |
|  |                  |   ▼ 1.3% 30D    Last 90 days                       32 px loss     |
|  +------------------+   ~~~~~~~~~~~~~~~/~~~~~~~/~~~~                     600 x 96 line  |
|----------------------------------------------------------------------------------------|
|  TCGplayer Market Price for Sep 30, 2026 · pokefin.ca                  [mark] Pokéfin  |
+----------------------------------------------------------------------------------------+
```

Withheld (stale) product: the price block becomes "No current price" (56 px) over "Last priced Sep 12, 2026" (30 px); no change, no line; the footer reads "As of Oct 1, 2026 · pokefin.ca". Never priced: "Not priced yet". No photo (missing, WebP, wrong host, over 1.5 MB, fetch error or 3 s timeout): the text column takes the full width, title 54 px.

The change follows the headline currency (WP31 decision 3): a CAD headline shows the CAD 30D change (`quote.changes.cad["30D"]`); when that is missing it shows the USD change labelled "30D in USD"; without a rate the headline is "$59.99 USD" and the change "30D". The glyph is an SVG triangle (the fonts have no ▲▼ and a missing glyph would make Satori fetch a fallback font); colour is gain or loss text, flat inside ±0.05% has no glyph. The 90-day line is WP26's baked `3M` series (32 points), absolute pixel path, chart-line colour, 4 px.

Set card: context "{Generation} · Released {date}", the set name (64 px, 2 lines max), "{n} tracked sealed products[, {k} priced]", "▲ 38.2% median 1Y" (only with at least one priced product), up to 3 photos of priced products (PNG or JPEG only) in a column, footer "TCGplayer Market Prices as of {newest price day} · pokefin.ca" or "No current prices · As of {today} · pokefin.ca".

Rules: `size = { width: 1200, height: 630 }`, `contentType = "image/png"`, `revalidate = 86400`, `dynamic = "force-static"`, empty `generateStaticParams`, so each image renders once per regeneration and the CDN serves it. Every `div` sets `display` explicitly (Satori); colours come from `app/lib/ogTheme.ts`, which mirrors the `globals.css` tokens and is drift-tested. Cost: one render per product per scrape at most, zero effect on visitor page weight.

### D8. SEO and structured data

| Page | `<title>` (layout appends " · Pokéfin") | Robots | JSON-LD |
|---|---|---|---|
| `/sets` | "Pokémon TCG Sets" | index | `CollectionPage` + `ItemList` of indexable hubs (name, url, position), `BreadcrumbList` (Home, Sets) |
| `/sets/[slug]` | "{Set} Sealed Product Prices" | index when priced >= 3, else noindex, follow | `CollectionPage` + `ItemList` of its products (names and URLs, never prices), `BreadcrumbList` (Home, Sets, Set) |
| `/product/[id]` | unchanged (WP13) | unchanged | WP13 `Product` (unchanged) + new `BreadcrumbList` (Home, Sets, Set, Type) |

Descriptions: set page "Daily TCGplayer Market Price, 30-day and 1-year change and units sold for {n} tracked {Set} sealed products. Prices in USD and CAD." (no price in title or description). Sitemap: `/sets` (daily, 0.7) replaces `/analytics`; every indexable hub (daily, 0.6, `lastModified` = newest `price_recorded_at` among its products). Every JSON-LD body goes through `serializeJsonLd`.

### D9. Copy (every new user-facing string)

"Pokémon TCG sets", "{n} sets, {preset}", "Performance", "Risk", "Liquidity", "Sort by {label}", "What do these columns mean?", "Full definitions in the methodology", "Set figures are medians and totals across each set's tracked products.", "Risk and return by set", "Each dot is a set: further right moved more week to week, higher gained more over a year.", "Across: median weekly volatility over 52 weeks, annualised. Up: median 1-year change. Dot size: tracked products.", "{n} set(s) have/has no 1-year change or weekly volatility yet and are/is not plotted.", "Chart data as a table", "Sets could not be loaded", "No sets yet", "Not enough sets have a year of prices and weekly volatility yet.", "{Set} sealed product prices", "Sales and supply", "{k} of {n} products", "{n} sealed product(s)", "1Y trend", "Sales not available", "{n} sold 30D", "Median price change", "{Set} has no index yet: ...", "How this line is built", "How set indices work", "Equal-weighted, chain-linked, published for the previous UTC day.", "Previous set", "Next set", "All sets", "We don't track that set", "The link may be old, or the set may have a new name.", "Loading the set", share card strings in D7, summary templates in D3. Banned words (live, real-time, all-time, Invest Score, TCGPlayer) and em dashes do not appear (WP24 conventions test).

### D10. Performance

- `/sets`: shared JS plus `IntentLink` only; document target 40 kB br (about 60 rows in the table and again in the phone list, plus the chart). `/sets/<fixture slug>` (labelled `/sets/[slug]`): shared JS plus `MiniSparkline`, `Price`, `IntentLink`; document target 30 kB br. Both join `perf-budgets.json` (a new route is not a raise; `routes./analytics.*` is removed, which needs a `Perf budget raise:` line per key, D11 of WP22) and the `supabase-js` and `recharts` `forbiddenChunks` rules.
- RUM targets: `/sets` LCP 1800, INP 150, CLS 0.05, TTFB 600 (rendered per request from cache, like `/indices/sealed`); `/sets/[slug]` TTFB 900 (cold ISR renders count, like `/product/[id]`).
- The root layout reads the set directory and the cached summaries for the footer links: two cache hits, no new query; ISR pages pay it at regeneration only.
- Share images and the median-line read never run on a visitor's critical path.

### D11. Design system use (WP23, WP24)

`PageHeader`, `ProvenanceLine`, `AsOf` (inline and table variants), `Stat`, `Delta`, `Badge` (warn "Provisional"), `DataList`/`DataListRow`, `EmptyState`, `Skeleton`, `buttonClasses`, `MetricLabel`, `DecisionNote`, WP26 `MiniSparkline size="row"`, WP29 `IndexChart`, WP32 `Price`. Tokens only: `text-ink`, `text-ink-soft`, `bg-surface`, `bg-surface-alt`, `border-line`, `divide-line`, `text-action`, `ring-action`, `stroke-chart-line`, `stroke-chart-grid`, `stroke-chart-bench`, `stroke-action-strong`, `rounded-card`, `rounded-control`, `text-h1`/`h2`/`h3`/`body`/`small`/`caption`/`prose`. Table rows 44 px, header 40 px, one line per row; phone rows `DataList` (56 px minimum). The only raw hex colours added are in `app/lib/ogTheme.ts` (Satori cannot read CSS variables), recorded in the conventions baseline with a reason.

## Before you start

Read:
- `audits/remediation/01-PRODUCT-DIRECTION.md` §2, §3 (type, colour roles, density, charts), §4.1, §5 item 9, §6, §8 (migration registry); `research/trust-seo-brand.md` §11.1 to §11.8 and §13 (`0041_taxonomy_slugs.sql` sketch); `research/ui-audit.md` (top-10 item 6, `/stats`); `research/performance-excellence.md` §7.1.
- Specs, for the exact names you call: WP13 steps 2, 5, 7, 8 (`redirects.ts`, `redirects()`, `productMeta.ts`, `sitemap.ts`); WP24 steps 5, 6, 7, 10, 16, 22, 23 (`metricDefinitions.ts`, `MetricLabel`, `jsonLd.ts`, methodology, `/stats`, conventions test, sitemap); WP26 steps 3, 5, 10, 17, 19 (`sparkline.ts`, `getCachedSparklines`, `MiniSparkline`, ESLint list, `forbiddenChunks`); WP29 steps 8, 9, 10, 14, 21 to 23; WP31 decisions, steps 6, 12, 16; WP27 steps 4 and 24 (`navConfig.ts`, footer); WP33 step 25d (`REDIRECT_CHECKS`).
- Current code (paths from `frontend/` unless they start with `migrations/`, `tests/` or `scripts/db/`): `next.config.ts`, `app/layout.tsx`, `app/sitemap.ts`, `app/analytics/page.tsx`, `app/stats/page.tsx` and every test under `app/stats/`, `app/product/[id]/page.tsx`, `productMeta.ts`, `SiblingList.tsx`, `productModel.ts`, `app/lib/serverMarketData.ts` (find `fetchAllRows`, `createMarketDataSupabaseClient`, `getCachedProductStats`, `getCachedIndexSeries`, `getCachedSparklines`, `DAILY_BACKSTOP_SECONDS`, `logCaughtError`), `app/lib/jsonLd.ts`, `app/lib/metricDefinitions.ts`, `app/content/methodology.ts`, `app/methodology/MethodologyArticle.tsx`, `app/components/Footer.tsx`, `app/components/nav/navConfig.ts`, `app/components/ui/*`, `app/indices/sealed/IndexChart.tsx`, `app/components/brand/PokefinMark.tsx`, `app/__tests__/uiConventions.test.ts` and its baseline, `app/__tests__/sitemap.test.ts`, `app/product/[id]/__tests__/productMeta.test.ts`, `eslint.config.mjs`, `jest.config.js`, `perf-budgets.json`, `scripts/fixtures/perf.mjs`, `scripts/perf-fixture.test.mjs`, `scripts/prod-smoke-lib.mjs`, `scripts/prod-smoke.mjs`, `scripts/prod-smoke-lib.test.mjs`, `scripts/prod-confirm.mjs`. Repo root: `schema.sql` (the `sets`, `product_types`, `generations` tables), `migrations/0001_enable_rls_and_policies.sql` (read policies), `verify_migration.py`, `scripts/db/replay_migrations.sh`, `tests/test_wp29_market_index_db.py` (fixture style).

Confirm the starting state (repo root):

```bash
# Migration number: 0041 is free; WP21 ends at 0032 and 0033 to 0040 belong to WP25 to WP36.
ls migrations | grep -E '^0041_'                                     # no output
ls migrations | grep -cE '^00(3[3-9]|40)_'                            # 8 (0033 to 0040), or fewer if a parallel package is unmerged
# WP21
ls migrations/0032_* scripts/db/replay_migrations.sh verify_migration.py tests/test_db_roles_integration.py
# WP25 (through WP29) and WP29
grep -n "export async function getCachedProductStats" frontend/app/lib/serverMarketData.ts      # 1 line
grep -n "async function fetchAllRows" frontend/app/lib/serverMarketData.ts                      # 1 line
grep -n "export async function getCachedIndexSummary\|export async function getCachedIndexSeries" frontend/app/lib/serverMarketData.ts   # 2 lines
grep -n "export function sliceIndexRange\|export function currentSummaries\|export function addDaysToKey\|export function utcTodayKey" frontend/app/lib/marketIndex.ts   # 4 lines
grep -n "export function niceStep" frontend/app/lib/indexChart.ts                              # 1 line
ls frontend/app/indices/sealed/IndexChart.tsx
# WP26
grep -n "export function sparklineFor\|export function pickSparklines\|export function decodeSparkline\|export const SPARKLINE_MAX_LEVEL" frontend/app/lib/sparkline.ts   # 4 lines
grep -n "export async function getCachedSparklines" frontend/app/lib/serverMarketData.ts       # 1 line
grep -n 'row: "h-6 w-16"' frontend/app/components/MarketView/MiniSparkline.tsx                  # 1 line
# WP31
grep -n "export function buildQuote\|export function todayUtcKey" "frontend/app/product/[id]/productModel.ts"   # 2 lines
ls "frontend/app/product/[id]/SiblingList.tsx"
grep -n "Breadcrumb" "frontend/app/product/[id]/page.tsx"                                       # the breadcrumb block WP31 kept
# WP24
grep -n "export function buildBreadcrumbJsonLd\|export function serializeJsonLd" frontend/app/lib/jsonLd.ts   # 2 lines
grep -n "export function formatCompositePercentile" frontend/app/lib/setAnalytics.ts             # 1 line
grep -n "PROVENANCE_SENTENCE" frontend/app/content/disclosures.ts                               # 1 or more
ls frontend/app/components/ui/{MetricLabel,DecisionNote}.tsx
# WP23
ls frontend/app/components/ui/{PageHeader,ProvenanceLine,AsOf,Stat,Delta,Badge,DataList,EmptyState,Skeleton,Button}.tsx
grep -n "export function formatPercent\|export function formatSignedPercent\|export function changeDirection\|export function formatDecimal\|export function formatMonthYear" frontend/app/lib/format.ts   # 5 lines (formatDecimal and formatMonthYear come from WP29)
grep -n "export const STALE_AFTER_DAYS\|export function daysBetween" frontend/app/components/ui/AsOf.tsx   # 2 lines
# WP22
ls frontend/perf-budgets.json frontend/scripts/fixtures/perf.mjs frontend/scripts/prod-smoke-lib.mjs frontend/scripts/prod-confirm.mjs
grep -n '"/analytics"' frontend/perf-budgets.json frontend/scripts/prod-smoke-lib.mjs           # budget, rum target and smoke check
# WP13
grep -n 'source: "/stats"' frontend/next.config.ts                                             # 1 line
grep -n '"/analytics"' frontend/app/sitemap.ts                                                 # 1 line
grep -n "openGraph\|twitter" "frontend/app/product/[id]/productMeta.ts"                         # buildProductMetadata's blocks
```

If a hard-dependency check fails, stop and report which package is missing; this package extends those files and must not recreate them.

Soft dependencies (record the answers; each step says what to do):

```bash
ls frontend/app/components/nav/navConfig.ts 2>&1                       # (a) WP27 navigation module
grep -n "export const MARK_GLYPH_PATH\|export const MARK_TILE_RADIUS" frontend/app/components/brand/PokefinMark.tsx   # (b) WP27 mark: 2 lines
ls frontend/app/components/IntentLink.tsx 2>&1                          # (c) WP30/WP31 intent link
ls frontend/app/components/Price.tsx 2>&1                               # (d) WP32 currency leaf
grep -n "export const REDIRECT_CHECKS\|export function judgeRedirect" frontend/scripts/prod-smoke-lib.mjs   # (e) WP33: 2 lines
grep -n '"forbiddenChunks"\|"recharts"' frontend/perf-budgets.json      # (f) WP26/WP29 rules
grep -n "const PUBLIC_ROUTE_CLIENT_FILES" frontend/eslint.config.mjs    # (g) WP26 list
grep -n 'size = "page"' frontend/app/indices/sealed/IndexChart.tsx       # (h) WP32 compact size (not used here; information only)
```

Defaults when missing:
- (a) No `navConfig.ts`: in `app/components/Header.tsx` and `app/components/Footer.tsx` change the link whose `href` is `"/analytics"` to `{ href: "/sets", label: "Sets" }`; skip the `setSearchHref` change (step 14b) and append the footer set links to the first link column instead of "Browse".
- (b) No mark exports: in `ShareCards.tsx` (step 17f) delete the `<svg>` inside `Mark()` and its import; the wordmark text stays.
- (c) No `IntentLink`: create it verbatim from WP30 step 1.
- (d) No `Price`: create `app/components/Price.tsx` verbatim from WP32 step 6.
- (e) No `REDIRECT_CHECKS`: add WP33 step 25d's `REDIRECT_CHECKS` (with only the two WP37 entries) and `judgeRedirect`, and WP33 step 25e's loop in `prod-smoke.mjs`, verbatim.
- (f) No `forbiddenChunks`: skip step 18d; the source test in Tests item 9 is then the only zero-chart-JS gate, and the PR says so.
- (g) No list: skip step 18e.

Tooling: PostgreSQL 16 or 17 for the database tests (Docker `postgres:17` or `/usr/lib/postgresql/16/bin`), the Python venv from WP21 with `pytest` and `psycopg[binary]`; `npm` (only `npm pack`, for the fonts). The migration in step 1 was applied twice to a scratch PostgreSQL 16.13 database (UTF-8, `C.UTF-8` locale) seeded with duplicate names, accents, an em-dash name and a symbol-only name; `verify_migration.py` reported 12 OK rows, and the 27 database tests in step 3 passed.

Baseline (record for the PR): from `frontend/`: `pnpm exec tsc --noEmit` (exit 0), `pnpm lint` (0 errors), `pnpm test --ci` (all pass, note the count), `pnpm run test:scripts`. From the repo root: `python -m pytest tests/ -q`.

The work has two phases, like WP25 and WP29. **Phase A** is every step except step 21; at its end open a draft PR titled `[waiting for DB types] WP37: ...` and hand the owner Owner actions 1 to 3. In phase A `tsc` fails only on the new `.from("sets").select(...)` read in `serverMarketData.ts` (the generated `Database` type has no `slug` yet); that is the only allowed failure. **Phase B** (step 21) regenerates `app/types/database.ts` once 0041 is in production.

`next build` type-checks, so that one error also fails `pnpm build:stub`, which Verification steps 5 to 7 and step 18h need. Two ways, in this order of preference (WP33 uses the same rule): (1) if the owner can apply 0041 and push the types quickly, do step 21 first and then the builds; (2) otherwise measure on a temporary, uncommitted edit of the generated file: in `app/types/database.ts` add `slug: string` to the `Row` of `sets`, `product_types` and `generations`, and `slug?: string` to each table's `Insert` and `Update`, run the builds, then discard it with `git checkout app/types/database.ts` before any commit (`git status` must not list the file). Never commit a hand edit of `database.ts`. The draft PR's CI build fails until phase B; that is expected.

**Deploy order**: 0041 must be in production before this frontend deploys. Without `sets.slug` the directory read fails, so `/sets` shows its error state, set pages fail to render and `sitemap()` throws (Next then keeps the previous sitemap). Phase B enforces the order, because the types are generated from production.

## Implementation steps

Order: 1 to 3 (database), 4 to 9 (data layer, definitions), 10 to 12 (pages), 13 to 16 (routes, navigation, product page, sitemap), 17 (share images), 18 to 20 (performance, conventions, docs), 21 (phase B). Run `pnpm exec tsc --noEmit` from `frontend/` after each group; in phase A the only allowed error is the `sets` select in `serverMarketData.ts`.

Conventions for every file this package creates: token utilities only, no raw palette class, no hex colour outside `app/lib/ogTheme.ts`, no `"use client"` (no new client component), no em dash, none of WP24's banned words, `prefetch={false}` on every `next/link` except `IntentLink`, every number tabular.

### Step 1. `migrations/0041_taxonomy_slugs.sql` (new)

Create the file with exactly this content:

```sql
-- Migration 0041: URL slugs for sets, product types and generations (WP37).
--
-- /sets/[slug] pages use name slugs, never set codes: people search names,
-- and sets.code is not unique (research/trust-seo-brand.md section 11.2).
-- This file adds:
--
--   pokefin_slugify(text)     IMMUTABLE. The one slug rule. Mirrored by
--                             frontend/app/lib/taxonomySlug.ts and drift-tested
--                             with the same anchors (tests/test_wp37_taxonomy_slugs.py,
--                             app/lib/__tests__/taxonomySlug.test.ts).
--   pokefin_free_slug(...)    The deterministic disambiguation step: the base
--                             slug, else base-<qualifier>, else base-<id>.
--   slug columns              On sets (from name; qualifier = code),
--                             product_types (from label, else name;
--                             qualifier = name) and generations (from name).
--                             NOT NULL, unique, format CHECK. Filled once, in
--                             a fixed order (sets by release date, then id),
--                             so the oldest row keeps the bare slug.
--   pokefin_default_slug()    BEFORE INSERT trigger on the three tables:
--                             a row inserted without a slug gets one by the
--                             same rule. An explicit slug is kept.
--
-- Renaming a row never changes its slug (URL stability). To move a URL, the
-- owner updates slug by hand; the old URL then 404s unless the name-derived
-- slug still resolves (the set page redirects a name-derived slug to the
-- stored one).
--
-- No grants: anon and authenticated already have SELECT on the three tables
-- (0001, 0013), which covers the new column. The three functions are revoked
-- from PUBLIC, anon and authenticated; the trigger function is SECURITY
-- DEFINER so any role allowed to insert a set (service_role, the dashboard)
-- gets a slug without EXECUTE on the helpers. pokefin_scraper inserts no
-- taxonomy rows (0032) and gets nothing.
--
-- Before applying, the owner runs the collision query in the WP37 spec
-- (Owner actions, A1). Idempotent: safe to apply twice (replay_twice).

-- ============================================================
-- 1. Functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.pokefin_slugify(p_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  -- Lower case first (Unicode-aware in a UTF-8 database, so upper-case
  -- accented letters are covered); "&" becomes "and"; straight and curly
  -- apostrophes vanish; 33 accented Latin letters fold to a-z; every other
  -- run of characters becomes one hyphen; at most 80 characters, no
  -- leading or trailing hyphen.
  SELECT btrim(left(btrim(regexp_replace(
    translate(
      replace(replace(replace(lower(p_input), '&', ' and '), chr(39), ''), chr(8217), ''),
      'àáâäãåāèéêëēìíîïīòóôöõøōùúûüūçñýÿ',
      'aaaaaaaeeeeeiiiiiooooooouuuuucnyy'
    ),
    '[^a-z0-9]+', '-', 'g'), '-'), 80), '-');
$$;

CREATE OR REPLACE FUNCTION public.pokefin_free_slug(
  p_table text,
  p_id bigint,
  p_base text,
  p_qualifier text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prefix text;
  v_qualifier text := left(btrim(coalesce(p_qualifier, ''), '-'), 30);
  v_candidates text[];
  v_candidate text;
  v_taken boolean;
BEGIN
  v_prefix := CASE p_table
    WHEN 'sets' THEN 'set'
    WHEN 'product_types' THEN 'type'
    WHEN 'generations' THEN 'era'
  END;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'pokefin_free_slug: unsupported table %', p_table;
  END IF;

  IF coalesce(p_base, '') = '' THEN
    -- A name with no letters or digits: the id is the only stable key.
    v_candidates := ARRAY[v_prefix || '-' || p_id::text];
  ELSE
    v_candidates := ARRAY[
      p_base,
      CASE WHEN v_qualifier <> '' AND v_qualifier <> p_base THEN p_base || '-' || v_qualifier END,
      p_base || '-' || p_id::text
    ];
  END IF;

  FOREACH v_candidate IN ARRAY v_candidates LOOP
    CONTINUE WHEN v_candidate IS NULL;
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I WHERE slug = $1 AND id <> $2)', p_table
    ) INTO v_taken USING v_candidate, p_id;
    IF NOT v_taken THEN
      RETURN v_candidate;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'pokefin_free_slug: no free slug for %.id = % (tried %)', p_table, p_id, v_candidates
    USING HINT = 'Insert the row with an explicit slug.';
END;
$$;

CREATE OR REPLACE FUNCTION public.pokefin_default_slug()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.slug IS NULL THEN
    IF TG_TABLE_NAME = 'sets' THEN
      NEW.slug := public.pokefin_free_slug(
        'sets', NEW.id, public.pokefin_slugify(NEW.name), public.pokefin_slugify(NEW.code));
    ELSIF TG_TABLE_NAME = 'product_types' THEN
      NEW.slug := public.pokefin_free_slug(
        'product_types', NEW.id,
        public.pokefin_slugify(coalesce(nullif(btrim(NEW.label), ''), NEW.name)),
        public.pokefin_slugify(NEW.name));
    ELSIF TG_TABLE_NAME = 'generations' THEN
      NEW.slug := public.pokefin_free_slug(
        'generations', NEW.id, public.pokefin_slugify(NEW.name), NULL);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pokefin_slugify(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pokefin_free_slug(text, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pokefin_default_slug() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 2. Columns and the one-time fill
-- ============================================================

ALTER TABLE public.sets ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.product_types ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.generations ADD COLUMN IF NOT EXISTS slug text;

-- Fixed order, one row at a time, so a duplicate name always resolves the
-- same way: the earliest-released set keeps the bare slug, the next gets
-- -<code>, then -<id>. Rows that already have a slug are skipped (re-run).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id, name, code FROM public.sets
    WHERE slug IS NULL
    ORDER BY release_date ASC NULLS LAST, id ASC
  LOOP
    UPDATE public.sets
       SET slug = public.pokefin_free_slug('sets', r.id, public.pokefin_slugify(r.name), public.pokefin_slugify(r.code))
     WHERE id = r.id;
  END LOOP;

  FOR r IN
    SELECT id, name, label FROM public.product_types
    WHERE slug IS NULL
    ORDER BY id ASC
  LOOP
    UPDATE public.product_types
       SET slug = public.pokefin_free_slug(
             'product_types', r.id,
             public.pokefin_slugify(coalesce(nullif(btrim(r.label), ''), r.name)),
             public.pokefin_slugify(r.name))
     WHERE id = r.id;
  END LOOP;

  FOR r IN
    SELECT id, name FROM public.generations
    WHERE slug IS NULL
    ORDER BY id ASC
  LOOP
    UPDATE public.generations
       SET slug = public.pokefin_free_slug('generations', r.id, public.pokefin_slugify(r.name), NULL)
     WHERE id = r.id;
  END LOOP;
END $$;

-- ============================================================
-- 3. Constraints
-- ============================================================

ALTER TABLE public.sets ALTER COLUMN slug SET NOT NULL;
ALTER TABLE public.product_types ALTER COLUMN slug SET NOT NULL;
ALTER TABLE public.generations ALTER COLUMN slug SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.sets ADD CONSTRAINT sets_slug_key UNIQUE (slug);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.product_types ADD CONSTRAINT product_types_slug_key UNIQUE (slug);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.generations ADD CONSTRAINT generations_slug_key UNIQUE (slug);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.sets ADD CONSTRAINT sets_slug_format
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 120);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.product_types ADD CONSTRAINT product_types_slug_format
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 120);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.generations ADD CONSTRAINT generations_slug_format
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 120);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 4. Default-slug triggers
-- ============================================================

DROP TRIGGER IF EXISTS sets_default_slug ON public.sets;
CREATE TRIGGER sets_default_slug
  BEFORE INSERT ON public.sets
  FOR EACH ROW EXECUTE FUNCTION public.pokefin_default_slug();

DROP TRIGGER IF EXISTS product_types_default_slug ON public.product_types;
CREATE TRIGGER product_types_default_slug
  BEFORE INSERT ON public.product_types
  FOR EACH ROW EXECUTE FUNCTION public.pokefin_default_slug();

DROP TRIGGER IF EXISTS generations_default_slug ON public.generations;
CREATE TRIGGER generations_default_slug
  BEFORE INSERT ON public.generations
  FOR EACH ROW EXECUTE FUNCTION public.pokefin_default_slug();
```

Notes:
- `lower()` runs first so upper-case accented letters fold too (Unicode-aware in a UTF-8 database; Supabase uses one). The 33-letter `translate` list is mirrored in `app/lib/taxonomySlug.ts` and drift-tested by shared anchors.
- `pokefin_free_slug` builds its table name with `format('%I')` from a fixed list; any other table raises. It is `STABLE` and `SECURITY INVOKER`; the trigger function is `SECURITY DEFINER` so an insert by `service_role` or the dashboard needs no EXECUTE on the helpers.
- The fill runs one row at a time in a fixed order (sets by release date, unknown last, then id; the other tables by id), so the earliest set keeps `crown-zenith` and a later duplicate gets `crown-zenith-swsh12-5` and then `crown-zenith-<id>`.
- No grant changes: `anon` and `authenticated` already read the three tables (0001, 0013), which covers the new column; `pokefin_scraper` inserts no taxonomy rows (0032).

### Step 2. Check the migration

```bash
python3 verify_migration.py migrations/0041_taxonomy_slugs.sql > /tmp/wp37_0041.sql; echo "exit=$?"
# expect exit=3 and on stderr:
#   -- function pokefin_slugify(p_input text): body 0acd2b2288172fa5334e0bda517f5d80, strict, parallel s, security invoker, sql, volatility i, config search_path=pg_catalog
#   -- function pokefin_free_slug(p_table text, p_id bigint, p_base text, p_qualifier text): body 580af54a4d46654002eb178d905d4f49, non-strict, parallel u, security invoker, plpgsql, volatility s, config search_path=public,pg_temp
#   -- function pokefin_default_slug(): body 7059af48f10cb4809f126e247f308a69, non-strict, parallel u, security definer, plpgsql, volatility v, config search_path=public,pg_temp
#   9 "-- privilege EXECUTE ... : revoked" lines (3 functions x public, anon, authenticated)
#   -- NOT VERIFIED (out of scope, check by hand): 6 x ALTER TABLE (other than RLS enablement), 3 x CREATE TRIGGER, 7 x DO block, 3 x DROP object
```

The hashes hold when the file is copied verbatim; a different hash means the body differs from this spec: diff it. Then replay with WP21's harness (it picks the file up by name):

```bash
PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh
# expect "OK: <N> files replayed once (replay_once) and twice (replay_twice)", N one more than before
psql postgresql://postgres:postgres@localhost:55432/replay_twice -At -f /tmp/wp37_0041.sql | cut -d'|' -f4 | sort | uniq -c
# expect: 12 OK
```

Check the triggers and constraints by hand (the "NOT VERIFIED" part):

```bash
psql postgresql://postgres:postgres@localhost:55432/replay_twice -At -c "
  SELECT tgrelid::regclass, tgname FROM pg_trigger WHERE tgname LIKE '%default_slug' ORDER BY 1;
  SELECT conrelid::regclass, conname FROM pg_constraint WHERE conname LIKE '%slug%' ORDER BY 1, 2;
  SELECT attrelid::regclass, attnotnull FROM pg_attribute WHERE attname = 'slug' AND attrelid IN ('public.sets'::regclass, 'public.product_types'::regclass, 'public.generations'::regclass);"
# expect 3 triggers (generations_default_slug, product_types_default_slug, sets_default_slug),
# 6 constraints (<table>_slug_format and <table>_slug_key for each table), and attnotnull t three times
```

### Step 3. `tests/test_wp37_taxonomy_slugs.py` (new, repo root)

Runs in WP21's CI job "Database replay and Python tests" against the replayed database; every test runs in a transaction that is rolled back, so it can run twice.

```python
"""
Database checks for migration 0041 (WP37): taxonomy slugs.

Skipped unless POKEFIN_TEST_DATABASE_URL points at a database rebuilt by
scripts/db/replay_migrations.sh (CI job "Database replay and Python tests").
NEVER point it at production: every test runs inside a transaction that is
rolled back.

  POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/replay_once \
    python -m pytest tests/test_wp37_taxonomy_slugs.py -v

ANCHORS is shared, value for value, with
frontend/app/lib/__tests__/taxonomySlug.test.ts and
frontend/scripts/perf-fixture.test.mjs: the SQL rule and its two mirrors must agree.
"""
import os
from urllib.parse import urlparse

import pytest

DSN = os.environ.get("POKEFIN_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="POKEFIN_TEST_DATABASE_URL not set")

psycopg = pytest.importorskip("psycopg")
from psycopg import errors  # noqa: E402

SLUG_RE = r"^[a-z0-9]+(-[a-z0-9]+)*$"

ANCHORS = [
    ("Prismatic Evolutions", "prismatic-evolutions"),
    ("Scarlet & Violet", "scarlet-and-violet"),
    ("Sun & Moon: Cosmic Eclipse", "sun-and-moon-cosmic-eclipse"),
    ("Champion's Path", "champions-path"),
    ("Champion’s Path", "champions-path"),
    ("Pokémon GO", "pokemon-go"),
    ("ÉVOLUTION Céleste", "evolution-celeste"),
    ("  --Hello--World--  ", "hello-world"),
    ("SV8.5", "sv8-5"),
    ("Nidoran♀ & ♂", "nidoran-and"),
    ("???", ""),
    ("x" * 79 + " y", "x" * 79),
    ("a" * 90, "a" * 80),
]

FUNCTIONS = (
    "public.pokefin_slugify(text)",
    "public.pokefin_free_slug(text, bigint, text, text)",
    "public.pokefin_default_slug()",
)


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


def scalar(db, sql, params=()):
    return db.execute(sql, params).fetchone()[0]


def new_set(db, name, code="WP37", slug=None):
    if slug is None:
        return db.execute(
            "INSERT INTO public.sets (code, name) VALUES (%s, %s) RETURNING id, slug", (code, name)
        ).fetchone()
    return db.execute(
        "INSERT INTO public.sets (code, name, slug) VALUES (%s, %s, %s) RETURNING id, slug",
        (code, name, slug),
    ).fetchone()


@pytest.mark.parametrize("name,expected", ANCHORS)
def test_slugify_anchors(db, name, expected):
    assert scalar(db, "SELECT public.pokefin_slugify(%s)", (name,)) == expected


def test_slugify_is_null_for_null(db):
    assert scalar(db, "SELECT public.pokefin_slugify(NULL)") is None


def test_insert_fills_the_slug(db):
    assert new_set(db, "WP37 Fresh Set")[1] == "wp37-fresh-set"


def test_duplicate_names_get_the_code_then_the_id(db):
    _, first = new_set(db, "WP37 Twin", code="T.1")
    _, second = new_set(db, "WP37 Twin", code="T.1")
    third_id, third = new_set(db, "WP37 Twin", code="T.1")
    assert (first, second, third) == ("wp37-twin", "wp37-twin-t-1", f"wp37-twin-{third_id}")


def test_an_explicit_slug_is_kept(db):
    assert new_set(db, "Anything At All", slug="wp37-hand-picked")[1] == "wp37-hand-picked"


def test_a_malformed_slug_is_rejected(db):
    with pytest.raises(errors.CheckViolation):
        new_set(db, "WP37 Bad", slug="WP37 Bad Slug")


def test_a_taken_slug_is_rejected(db):
    new_set(db, "WP37 Owner", slug="wp37-owner")
    with pytest.raises(errors.UniqueViolation):
        new_set(db, "WP37 Squatter", slug="wp37-owner")


def test_renaming_keeps_the_slug(db):
    set_id, slug = new_set(db, "WP37 Before")
    db.execute("UPDATE public.sets SET name = 'WP37 After' WHERE id = %s", (set_id,))
    assert scalar(db, "SELECT slug FROM public.sets WHERE id = %s", (set_id,)) == slug == "wp37-before"


def test_a_name_without_letters_uses_the_id(db):
    set_id, slug = new_set(db, "???")
    assert slug == f"set-{set_id}"


def test_product_types_use_the_label_then_the_name(db):
    def insert(name, label):
        return scalar(
            db,
            "INSERT INTO public.product_types (name, label) VALUES (%s, %s) RETURNING slug",
            (name, label),
        )

    assert insert("wp37_box_a", "WP37 Box") == "wp37-box"
    assert insert("wp37_box_b", "WP37 Box") == "wp37-box-wp37-box-b"
    assert insert("wp37_plain", None) == "wp37-plain"
    assert insert("wp37_blank", "   ") == "wp37-blank"


def test_generations_disambiguate_with_the_id(db):
    first = scalar(db, "INSERT INTO public.generations (name) VALUES ('WP37 & Era') RETURNING slug")
    gen_id, second = db.execute(
        "INSERT INTO public.generations (name) VALUES ('WP37 and Era') RETURNING id, slug"
    ).fetchone()
    assert (first, second) == ("wp37-and-era", f"wp37-and-era-{gen_id}")


def test_free_slug_order_and_own_row(db):
    owner_id, _ = new_set(db, "WP37 Order", slug="wp37-order")
    other_id, _ = new_set(db, "WP37 Other", slug="wp37-other")

    def free(row_id, base, qualifier):
        return scalar(db, "SELECT public.pokefin_free_slug('sets', %s, %s, %s)", (row_id, base, qualifier))

    assert free(owner_id, "wp37-order", "abc") == "wp37-order"  # its own slug is not "taken"
    assert free(other_id, "wp37-order", "abc") == "wp37-order-abc"
    new_set(db, "WP37 Order Abc", slug="wp37-order-abc")
    assert free(other_id, "wp37-order", "abc") == f"wp37-order-{other_id}"
    assert free(other_id, "wp37-order", "wp37-order") == f"wp37-order-{other_id}"
    assert free(other_id, "", "abc") == f"set-{other_id}"
    with pytest.raises(errors.RaiseException):
        db.execute("SELECT public.pokefin_free_slug('products', 1, 'x', NULL)")


def test_every_row_has_a_valid_unique_slug(db):
    for table in ("sets", "product_types", "generations"):
        assert scalar(db, f"SELECT count(*) FROM public.{table} WHERE slug IS NULL OR slug !~ %s", (SLUG_RE,)) == 0
        assert scalar(db, f"SELECT count(*) - count(DISTINCT slug) FROM public.{table}") == 0
        assert scalar(
            db,
            "SELECT attnotnull FROM pg_attribute WHERE attrelid = %s::regclass AND attname = 'slug'",
            (f"public.{table}",),
        ) is True
        assert scalar(
            db,
            "SELECT count(*) FROM pg_trigger WHERE tgrelid = %s::regclass AND tgname = %s AND NOT tgisinternal",
            (f"public.{table}", f"{table}_default_slug"),
        ) == 1


def test_service_role_inserts_get_a_slug(db):
    if not scalar(db, "SELECT has_table_privilege('service_role', 'public.sets', 'INSERT')"):
        pytest.skip("service_role has no INSERT on sets in this database")
    db.execute("SET LOCAL ROLE service_role")
    try:
        assert new_set(db, "WP37 Service Set")[1] == "wp37-service-set"
    finally:
        db.execute("RESET ROLE")


def test_privileges_and_attributes(db):
    for fn in FUNCTIONS:
        for role in ("anon", "authenticated", "pokefin_scraper"):
            assert scalar(db, "SELECT has_function_privilege(%s, %s, 'EXECUTE')", (role, fn)) is False, (role, fn)
        config = scalar(db, "SELECT proconfig FROM pg_proc WHERE oid = %s::regprocedure", (fn,))
        assert any(c.startswith("search_path=") for c in (config or [])), fn
    secdef, volatility = db.execute(
        "SELECT prosecdef, provolatile FROM pg_proc WHERE oid = 'public.pokefin_default_slug()'::regprocedure"
    ).fetchone()
    assert (secdef, volatility) == (True, "v")
    assert scalar(db, "SELECT provolatile FROM pg_proc WHERE oid = 'public.pokefin_slugify(text)'::regprocedure") == "i"
```

Run it twice in a row:

```bash
POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once python -m pytest tests/test_wp37_taxonomy_slugs.py -q   # 27 passed
POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once python -m pytest tests/test_wp37_taxonomy_slugs.py -q   # 27 passed
python -m pytest tests/ -q        # every earlier DB test still passes: their INSERT INTO sets/product_types rows now get a slug from the trigger
```

### Step 4. `frontend/app/lib/taxonomySlug.ts` (new)

```ts
/**
 * URL slugs for sets (WP37, migration 0041). The database owns every stored
 * slug: pokefin_slugify, the disambiguation step and the default-slug
 * triggers. This mirror has one job: building a set link from a set NAME
 * where no slug is at hand (global search, the home page's "All products"
 * link). The set page redirects a name-derived slug to the stored one when
 * they differ (a duplicate name, or a set renamed after its slug was set).
 *
 * Keep slugifyTaxonomyName identical to pokefin_slugify: the anchors in
 * __tests__/taxonomySlug.test.ts are the ones tests/test_wp37_taxonomy_slugs.py
 * runs against the SQL. Isomorphic and tiny: the search bundle imports it.
 */

export const SETS_PATH = "/sets";
export const TAXONOMY_SLUG_MAX_LENGTH = 120;
export const TAXONOMY_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The 33 accented letters pokefin_slugify folds, after lower-casing. */
const ACCENTS_FROM =
  "àáâäãåāèéêëēìíîïī" +
  "òóôöõøōùúûüūçñýÿ";
const ACCENTS_TO = "aaaaaaaeeeeeiiiii" + "ooooooouuuuucnyy";
const NAME_SLUG_MAX_LENGTH = 80;

export function isTaxonomySlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= TAXONOMY_SLUG_MAX_LENGTH &&
    TAXONOMY_SLUG_RE.test(value)
  );
}

/** Mirror of public.pokefin_slugify (migration 0041). "" when nothing is left. */
export function slugifyTaxonomyName(input: string): string {
  const lowered = input.toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "");
  let folded = "";
  for (const ch of lowered) {
    const at = ACCENTS_FROM.indexOf(ch);
    folded += at === -1 ? ch : ACCENTS_TO[at];
  }
  const hyphenated = folded.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return hyphenated.slice(0, NAME_SLUG_MAX_LENGTH).replace(/^-+|-+$/g, "");
}

export function setPath(slug: string): string {
  return `${SETS_PATH}/${slug}`;
}
```

### Step 5. `frontend/app/lib/setHubs.ts` (new)

Pure: no React, no Supabase, no `server-only`. Every builder is unit-tested (Tests item 2).

```ts
/**
 * Set hubs (WP37): the pure builders behind /sets, /sets/[slug], the
 * sitemap, the footer's set links and the set share card. Server code passes
 * cached reads in (app/lib/setHubsData.ts); tests pass fixtures. Nothing here
 * fetches.
 *
 * Prices and returns come from get_market_product_summaries and
 * get_set_analytics, which withhold a price older than 14 days and every
 * return measured from it (migration 0023). product_daily_stats figures keep
 * WP25's gates: a price only when is_price_fresh, volume and listings null
 * when stale. Nothing here re-derives a withheld number.
 */
import type { Product } from "../types/market";
import { formatDateOnly, formatInteger, formatSignedPercent, recordedAtDateKey } from "./format";
import type { SetAnalyticsRow } from "./marketData";
import { addDaysToKey, currentSummaries, INDEX_RULES, type IndexPoint, type IndexSummary } from "./marketIndex";
import { statsFor, type ProductStatsSnapshot } from "./marketStats";
import { hasCurrentPrice } from "./priceGuard";
import { isTaxonomySlug, setPath, slugifyTaxonomyName } from "./taxonomySlug";

/** research/trust-seo-brand.md §11.3: thinner hubs render, but are noindex and left out of the sitemap. */
export const MIN_PRICED_PRODUCTS_FOR_INDEXING = 3;
/** Set links appended to the footer's Browse column. */
export const FOOTER_SET_LINK_COUNT = 5;
/** Window of the units-sold total behind days of supply (WP25's days_of_supply uses the same 30). */
export const SALES_WINDOW_DAYS = 30;
/** The median line needs prices from at least this many products. */
export const MEDIAN_LINE_MIN_PRODUCTS = 2;
/** It reads at most this many products: 27 x 366 rows fit fetchAllRows' 10 pages of 1,000. */
export const MEDIAN_LINE_MAX_PRODUCTS = 27;
export const MEDIAN_LINE_WINDOW_DAYS = 365;
/** Daily changes are clipped like the index's (INDEX_RULES.returnClipPercent). */
const MEDIAN_LINE_CLIP = INDEX_RULES.returnClipPercent / 100;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------ directory

export interface SetDirectoryEntry {
  id: number;
  slug: string;
  name: string;
  code: string;
  /** YYYY-MM-DD or null. */
  releaseDate: string | null;
  expansionType: string | null;
  generationId: number | null;
}

/** A public.sets row as PostgREST returns it (generated types mark columns nullable in views only). */
export interface SetDirectoryRow {
  id: number | null;
  slug: string | null;
  name: string | null;
  code: string | null;
  release_date: string | null;
  expansion_type: string | null;
  generation_id: number | null;
}

export function toSetDirectory(rows: readonly SetDirectoryRow[]): SetDirectoryEntry[] {
  const out: SetDirectoryEntry[] = [];
  for (const row of rows) {
    if (!row || typeof row.id !== "number" || !Number.isSafeInteger(row.id)) continue;
    if (!isTaxonomySlug(row.slug) || typeof row.name !== "string" || row.name.trim() === "") continue;
    const release = typeof row.release_date === "string" ? row.release_date.slice(0, 10) : null;
    out.push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      code: typeof row.code === "string" ? row.code : "",
      releaseDate: release !== null && DATE_KEY_RE.test(release) ? release : null,
      expansionType: typeof row.expansion_type === "string" ? row.expansion_type : null,
      generationId: typeof row.generation_id === "number" ? row.generation_id : null,
    });
  }
  return out;
}

/** The migration's fill order: release date (unknown last), then id. */
export function compareRelease(
  a: Pick<SetDirectoryEntry, "releaseDate" | "id">,
  b: Pick<SetDirectoryEntry, "releaseDate" | "id">
): number {
  if (a.releaseDate !== b.releaseDate) {
    if (a.releaseDate === null) return 1;
    if (b.releaseDate === null) return -1;
    return a.releaseDate < b.releaseDate ? -1 : 1;
  }
  return a.id - b.id;
}

export type SetSlugResolution =
  | { kind: "found"; entry: SetDirectoryEntry }
  | { kind: "redirect"; slug: string }
  | { kind: "missing" };

/**
 * The stored slug wins. Otherwise a slug derived from a set's current name
 * (taxonomySlug.ts) redirects to that set's stored slug; with a duplicate
 * name, to the earliest-released set, which holds the bare slug.
 */
export function resolveSetSlug(directory: readonly SetDirectoryEntry[], requested: string): SetSlugResolution {
  if (!isTaxonomySlug(requested)) return { kind: "missing" };
  const exact = directory.find((entry) => entry.slug === requested);
  if (exact) return { kind: "found", entry: exact };
  const byName = directory
    .filter((entry) => slugifyTaxonomyName(entry.name) === requested)
    .sort(compareRelease);
  return byName.length > 0 ? { kind: "redirect", slug: byName[0].slug } : { kind: "missing" };
}

/** The stored slug of a product's set, or null when the set is not in the directory. */
export function setSlugForProduct(
  directory: readonly SetDirectoryEntry[] | null,
  product: Pick<Product, "sets">
): string | null {
  const setId = product.sets?.id;
  if (directory === null || typeof setId !== "number") return null;
  return directory.find((entry) => entry.id === setId)?.slug ?? null;
}

// ------------------------------------------------------------ catalog

/**
 * The light per-set view (directory plus the cached summaries): enough for
 * the footer links, the sitemap and the noindex rule, without the stats,
 * analytics and index reads the hub pages add.
 */
export interface SetCatalogEntry {
  id: number;
  slug: string;
  path: string;
  name: string;
  code: string;
  releaseDate: string | null;
  expansionType: string | null;
  generation: string | null;
  productIds: number[];
  /** Active tracked products in the set. */
  productCount: number;
  /** Products with a current price (not withheld). */
  pricedCount: number;
  /** Newest price_recorded_at among priced products: the sitemap's lastModified. */
  newestPriceAt: string | null;
  /** Its UTC date key: the hub's "as of". */
  newestPriceDay: string | null;
  /** pricedCount >= MIN_PRICED_PRODUCTS_FOR_INDEXING. */
  indexable: boolean;
}

/** Newest release first (unknown last), then name. */
function newestFirst(a: Pick<SetCatalogEntry, "releaseDate" | "name">, b: Pick<SetCatalogEntry, "releaseDate" | "name">): number {
  if (a.releaseDate !== b.releaseDate) {
    if (a.releaseDate === null) return 1;
    if (b.releaseDate === null) return -1;
    return a.releaseDate > b.releaseDate ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

/** One entry per directory set with at least one active product, newest release first. */
export function buildSetCatalog(
  directory: readonly SetDirectoryEntry[],
  products: readonly Product[]
): SetCatalogEntry[] {
  const bySet = new Map<number, Product[]>();
  for (const product of products) {
    const setId = product.sets?.id;
    if (typeof setId !== "number") continue;
    const members = bySet.get(setId);
    if (members) members.push(product);
    else bySet.set(setId, [product]);
  }
  const out: SetCatalogEntry[] = [];
  for (const entry of directory) {
    const members = bySet.get(entry.id);
    if (!members || members.length === 0) continue;
    let pricedCount = 0;
    let newestPriceAt: string | null = null;
    let newestPriceDay: string | null = null;
    for (const product of members) {
      if (!hasCurrentPrice(product)) continue;
      pricedCount += 1;
      const day = recordedAtDateKey(product.price_recorded_at ?? null);
      if (day !== null && (newestPriceDay === null || day > newestPriceDay)) {
        newestPriceDay = day;
        newestPriceAt = product.price_recorded_at ?? null;
      }
    }
    out.push({
      id: entry.id,
      slug: entry.slug,
      path: setPath(entry.slug),
      name: entry.name,
      code: entry.code,
      releaseDate: entry.releaseDate,
      expansionType: entry.expansionType,
      generation: members[0].sets?.generations?.name ?? null,
      productIds: members.map((product) => product.id).sort((a, b) => a - b),
      productCount: members.length,
      pricedCount,
      newestPriceAt,
      newestPriceDay,
      indexable: pricedCount >= MIN_PRICED_PRODUCTS_FOR_INDEXING,
    });
  }
  return out.sort(newestFirst);
}

export interface SetLink {
  key: string;
  label: string;
  href: string;
}

/** Footer Browse links: the newest released sets that are indexed. */
export function footerSetLinks(
  catalog: readonly SetCatalogEntry[],
  today: string,
  limit: number = FOOTER_SET_LINK_COUNT
): SetLink[] {
  return catalog
    .filter((entry) => entry.indexable && entry.releaseDate !== null && entry.releaseDate <= today)
    .sort((a, b) => compareRelease(b, a))
    .slice(0, limit)
    .map((entry) => ({ key: `set-${entry.id}`, label: entry.name, href: entry.path }));
}

/** Sitemap rows for the indexable set hubs (noindex hubs are left out). */
export function setSitemapRows(
  catalog: readonly SetCatalogEntry[]
): Array<{ path: string; lastModified: string | null }> {
  return catalog
    .filter((entry) => entry.indexable)
    .map((entry) => ({ path: entry.path, lastModified: entry.newestPriceAt }));
}

// ------------------------------------------------------------ hubs

export interface SetLiquidity {
  /** Sum over products with a 30-day sales total (WP25 gates). */
  unitsSold30d: number | null;
  activeListings: number | null;
  unitsOnMarket: number | null;
  /** Units on market / (units sold 30D / 30), over products with both; null when none sold. */
  daysOfSupply: number | null;
  productsWithVolume: number;
  productsWithListings: number;
}

export interface SetHub extends SetCatalogEntry {
  /** get_set_analytics row, matched on its "code:name" key. */
  analytics: SetAnalyticsRow | null;
  /** Median of the products' vol_weekly_52w (WP25), percent annualised. */
  volWeeklyMedian: number | null;
  liquidity: SetLiquidity;
  /** The set's index summary when it is published for the headline's day (WP29). */
  index: IndexSummary | null;
}

export function setIndexCode(setId: number): string {
  return `set-${setId}`;
}

/** get_set_analytics key: concat(coalesce(code, 'unknown'), ':', coalesce(name, 'Unknown Set')). */
export function setAnalyticsKey(code: string | null, name: string | null): string {
  return `${code ?? "unknown"}:${name ?? "Unknown Set"}`;
}

export function median(values: readonly number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildSetLiquidity(productIds: readonly number[], stats: ProductStatsSnapshot): SetLiquidity {
  let units = 0;
  let unitsCount = 0;
  let listings = 0;
  let listingsCount = 0;
  let qty = 0;
  let qtyCount = 0;
  let pairUnits = 0;
  let pairQty = 0;
  let pairs = 0;
  for (const id of productIds) {
    const row = statsFor(stats, id);
    if (!row) continue;
    if (typeof row.units_sold_30d === "number") {
      units += row.units_sold_30d;
      unitsCount += 1;
    }
    if (typeof row.active_listings === "number") {
      listings += row.active_listings;
      listingsCount += 1;
    }
    if (typeof row.qty_available === "number") {
      qty += row.qty_available;
      qtyCount += 1;
    }
    if (typeof row.units_sold_30d === "number" && typeof row.qty_available === "number") {
      pairUnits += row.units_sold_30d;
      pairQty += row.qty_available;
      pairs += 1;
    }
  }
  return {
    unitsSold30d: unitsCount > 0 ? units : null,
    activeListings: listingsCount > 0 ? listings : null,
    unitsOnMarket: qtyCount > 0 ? qty : null,
    daysOfSupply: pairs > 0 && pairUnits > 0 ? pairQty / (pairUnits / SALES_WINDOW_DAYS) : null,
    productsWithVolume: unitsCount,
    productsWithListings: listingsCount,
  };
}

export interface SetHubInput {
  catalog: readonly SetCatalogEntry[];
  stats: ProductStatsSnapshot;
  analytics: readonly SetAnalyticsRow[];
  /** getCachedIndexSummary(); null when the read failed. */
  indexSummaries: readonly IndexSummary[] | null;
}

/** The catalog plus analytics, weekly volatility, liquidity and the set index. Same order. */
export function buildSetHubs({ catalog, stats, analytics, indexSummaries }: SetHubInput): SetHub[] {
  const analyticsByKey = new Map(analytics.map((row) => [row.key, row] as const));
  const setIndices = new Map<string, IndexSummary>();
  if (indexSummaries) {
    for (const summary of currentSummaries(indexSummaries).subIndices) {
      if (summary.kind === "set") setIndices.set(summary.code, summary);
    }
  }
  return catalog.map((entry): SetHub => {
    const vols: number[] = [];
    for (const id of entry.productIds) {
      const vol = statsFor(stats, id)?.vol_weekly_52w;
      if (typeof vol === "number" && Number.isFinite(vol)) vols.push(vol);
    }
    return {
      ...entry,
      analytics: analyticsByKey.get(setAnalyticsKey(entry.code, entry.name)) ?? null,
      volWeeklyMedian: median(vols),
      liquidity: buildSetLiquidity(entry.productIds, stats),
      index: setIndices.get(setIndexCode(entry.id)) ?? null,
    };
  });
}

/** Sets ranked by composite score, for the "Top N%" percentile (WP24). */
export function rankedSetCount(hubs: readonly SetHub[]): number {
  return hubs.filter((hub) => hub.analytics?.rank !== null && hub.analytics?.rank !== undefined).length;
}

/** The newest price day across hubs: the page's "as of". */
export function newestHubPriceDay(hubs: readonly SetHub[]): string | null {
  let newest: string | null = null;
  for (const hub of hubs) {
    if (hub.newestPriceDay !== null && (newest === null || hub.newestPriceDay > newest)) newest = hub.newestPriceDay;
  }
  return newest;
}

/** Previous (older) and next (newer) set by release date; none for a set without one. */
export function neighbourSets(
  hubs: readonly SetHub[],
  setId: number
): { previous: SetHub | null; next: SetHub | null } {
  const dated = hubs.filter((hub) => hub.releaseDate !== null).sort(compareRelease);
  const at = dated.findIndex((hub) => hub.id === setId);
  if (at === -1) return { previous: null, next: null };
  return { previous: dated[at - 1] ?? null, next: dated[at + 1] ?? null };
}

// ------------------------------------------------------------ set page rows

export interface SetProductRow {
  id: number;
  href: string;
  /** Type label plus variant: "Elite Trainer Box (Pokemon Center)". The set is the page. */
  name: string;
  imageUrl: string | null;
  /** USD, null when withheld (migration 0023). */
  usdPrice: number | null;
  priceRecordedAt: string | null;
  change30d: number | null;
  change1y: number | null;
  unitsSold30d: number | null;
  daysOfSupply: number | null;
}

function productRowName(product: Product): string {
  const label = product.product_types?.label || product.product_types?.name || "Unknown product";
  return product.variant ? `${label} (${product.variant})` : label;
}

/** Priced products by price, highest first, then withheld ones by name. */
export function buildSetProductRows(products: readonly Product[], stats: ProductStatsSnapshot): SetProductRow[] {
  const rows = products.map((product): SetProductRow => {
    const priced = hasCurrentPrice(product);
    const row = statsFor(stats, product.id);
    return {
      id: product.id,
      href: `/product/${product.id}`,
      name: productRowName(product),
      imageUrl: product.image_url ?? null,
      usdPrice: priced ? (product.usd_price as number) : null,
      priceRecordedAt: product.price_recorded_at ?? null,
      change30d: priced ? product.returns?.["1M"] ?? null : null,
      change1y: priced ? product.returns?.["1Y"] ?? null : null,
      unitsSold30d: row?.units_sold_30d ?? null,
      daysOfSupply: row?.days_of_supply ?? null,
    };
  });
  return rows.sort((a, b) => {
    if (a.usdPrice !== null && b.usdPrice !== null) return b.usdPrice - a.usdPrice || a.id - b.id;
    if (a.usdPrice !== null) return -1;
    if (b.usdPrice !== null) return 1;
    return a.name.localeCompare(b.name) || a.id - b.id;
  });
}

// ------------------------------------------------------------ summary

export interface SetSummaryInput {
  setName: string;
  productCount: number;
  releaseDate: string | null;
  /** get_set_analytics median365 (percent). */
  median1y: number | null;
  rows: readonly SetProductRow[];
}

function plural(count: number, one: string, many: string): string {
  return `${formatInteger(count)} ${count === 1 ? one : many}`;
}

/**
 * The data-derived summary (research/trust-seo-brand.md §11.3). Each sentence
 * is a template with a condition; a sentence whose input is missing is
 * dropped, never filled with a placeholder. No LLM, no adjectives beyond the
 * numbers.
 */
export function buildSetSummary({ setName, productCount, releaseDate, median1y, rows }: SetSummaryInput): string[] {
  const sentences: string[] = [];
  const released = releaseDate ? `, released ${formatDateOnly(releaseDate)}` : "";
  sentences.push(`${setName} has ${plural(productCount, "tracked sealed product", "tracked sealed products")}${released}.`);

  if (median1y !== null && Number.isFinite(median1y)) {
    sentences.push(`The median 1-year change is ${formatSignedPercent(median1y)}.`);
  }

  const withReturn = rows.filter((row) => row.change1y !== null && Number.isFinite(row.change1y));
  if (withReturn.length >= 2) {
    const top = withReturn.reduce((best, row) => ((row.change1y as number) > (best.change1y as number) ? row : best));
    const value = top.change1y as number;
    sentences.push(
      value > 0
        ? `The ${top.name} rose the most over 1 year (${formatSignedPercent(value)}).`
        : `The ${top.name} held up best over 1 year (${formatSignedPercent(value)}).`
    );
  }

  const withUnits = rows.filter((row) => row.unitsSold30d !== null && Number.isFinite(row.unitsSold30d));
  if (withUnits.length >= 2) {
    const top = withUnits.reduce((best, row) => ((row.unitsSold30d as number) > (best.unitsSold30d as number) ? row : best));
    if ((top.unitsSold30d as number) > 0) {
      sentences.push(
        `The ${top.name} sold the most units in the last 30 days (${formatInteger(top.unitsSold30d as number)}).`
      );
    }
  }

  const withheld = rows.filter((row) => row.usdPrice === null).length;
  if (withheld > 0) {
    sentences.push(withheld === 1 ? "1 product has no current price." : `${formatInteger(withheld)} products have no current price.`);
  }
  return sentences;
}

// ------------------------------------------------------------ median line

/** The product_daily_stats columns the median line reads. */
export interface SetDailyPriceRow {
  product_id: number | null;
  day: string | null;
  usd_price: number | null;
  is_price_fresh: boolean | null;
}

/**
 * The set chart when the set has no index (WP29 needs 3 qualifying
 * products): the median daily change of the set's products, chained from 100
 * on the first day any of them has a price. A product counts on a day when
 * its product_daily_stats price is fresh that day and the day before; the
 * change is clipped to the index's limit. A day with no pair keeps the level.
 * Returns [] with fewer than MEDIAN_LINE_MIN_PRODUCTS priced products, so the
 * chart says "No history". Points are daily (weekly false) and never
 * provisional: this is not an index.
 */
export function buildSetMedianLine(rows: readonly SetDailyPriceRow[], fromDay: string, toDay: string): IndexPoint[] {
  const pricesByDay = new Map<string, Map<number, number>>();
  const products = new Set<number>();
  for (const row of rows) {
    if (typeof row.product_id !== "number" || typeof row.day !== "string" || !DATE_KEY_RE.test(row.day)) continue;
    if (row.is_price_fresh !== true || typeof row.usd_price !== "number" || !(row.usd_price > 0)) continue;
    if (row.day < fromDay || row.day > toDay) continue;
    let day = pricesByDay.get(row.day);
    if (!day) {
      day = new Map();
      pricesByDay.set(row.day, day);
    }
    day.set(row.product_id, row.usd_price);
    products.add(row.product_id);
  }
  if (products.size < MEDIAN_LINE_MIN_PRODUCTS) return [];

  const points: IndexPoint[] = [];
  let level: number | null = null;
  let previous: Map<number, number> | undefined;
  for (let day = fromDay; day <= toDay; day = addDaysToKey(day, 1)) {
    const today = pricesByDay.get(day);
    if (!today || today.size === 0) {
      previous = undefined;
      continue;
    }
    const changes: number[] = [];
    if (previous) {
      for (const [productId, price] of today) {
        const before = previous.get(productId);
        if (before !== undefined) {
          changes.push(Math.max(-MEDIAN_LINE_CLIP, Math.min(MEDIAN_LINE_CLIP, price / before - 1)));
        }
      }
    }
    const change = median(changes);
    level = level === null ? 100 : level * (1 + (change ?? 0));
    points.push({
      day,
      level: Math.round(level * 1e6) / 1e6,
      provisional: false,
      weekly: false,
      nConstituents: today.size,
      nContributing: changes.length,
      coveragePct: today.size > 0 ? Math.round((1000 * changes.length) / today.size) / 10 : 0,
      adv7d: 0,
      dec7d: 0,
      flat7d: 0,
      newHigh52w: 0,
      newLow52w: 0,
    });
    previous = today;
  }
  return points;
}
```

If `SetAnalyticsRow` is not exported from `app/lib/marketData.ts` (WP20 may have moved domain types), import it from `app/types/market.ts`; the same for `Product`.

### Step 6. `frontend/app/lib/serverMarketData.ts`: two cached reads

6a. Imports, next to the other `./` imports:

```ts
import { toSetDirectory, type SetDailyPriceRow, type SetDirectoryEntry } from "./setHubs";
```

6b. Below WP29's `fetchIndexSeries` (above the cached exports block), add:

```ts
// ---- WP37: set directory and the median line's daily prices ----

/** Columns of public.sets the set hubs read (slug: migration 0041). Listed, not "*". */
const SET_DIRECTORY_SELECT = "id, slug, name, code, release_date, expansion_type, generation_id";

/** Every set with its URL slug: about 60 rows, one page. */
async function fetchSetDirectory(): Promise<SetDirectoryEntry[]> {
  const supabase = createMarketDataSupabaseClient();
  const rows = await fetchAllRows("sets", (from, to) =>
    supabase.from("sets").select(SET_DIRECTORY_SELECT).order("id", { ascending: true }).range(from, to)
  );
  return toSetDirectory(rows);
}

/**
 * Daily prices of a set's products since fromDay, for the median line of a
 * set without an index: a range read on product_daily_stats_product_day_idx
 * (WP25). Callers pass at most MEDIAN_LINE_MAX_PRODUCTS ids.
 */
async function fetchSetDailyPrices(productIds: readonly number[], fromDay: string): Promise<SetDailyPriceRow[]> {
  if (productIds.length === 0) return [];
  const supabase = createMarketDataSupabaseClient();
  return fetchAllRows("product_daily_stats", (from, to) =>
    supabase
      .from("product_daily_stats")
      .select("product_id, day, usd_price, is_price_fresh")
      .in("product_id", [...productIds])
      .gte("day", fromDay)
      .order("product_id", { ascending: true })
      .order("day", { ascending: true })
      .range(from, to)
  );
}
```

6c. At the end of the cached exports block (after WP29's `getCachedIndexSeries`), add:

```ts
const getCachedSetDirectoryList = unstable_cache(fetchSetDirectory, ["set-directory-v1"], {
  revalidate: DAILY_BACKSTOP_SECONDS,
  tags: [CACHE_TAGS.marketProducts],
});

/**
 * Every set with its slug (WP37). [] means no sets; null (uncached) means the
 * read failed, so pages show an error or keep their last good render.
 * A slug the owner edits by hand shows after the next scrape revalidation or
 * within a day.
 */
export async function getCachedSetDirectory(): Promise<SetDirectoryEntry[] | null> {
  try {
    return await getCachedSetDirectoryList();
  } catch (error) {
    logCaughtError("server_set_directory_failed", error);
    return null;
  }
}

const getCachedSetDailyPriceRows = unstable_cache(fetchSetDailyPrices, ["set-daily-prices-v1"], {
  revalidate: DAILY_BACKSTOP_SECONDS,
  tags: [CACHE_TAGS.marketProducts],
});

/**
 * product_daily_stats prices of the given products since fromDay (WP37). The
 * ids and the day are the cache key, so ids are de-duplicated and sorted.
 * null (uncached) when the read failed.
 */
export async function getCachedSetDailyPrices(
  productIds: readonly number[],
  fromDay: string
): Promise<SetDailyPriceRow[] | null> {
  const ids = [...new Set(productIds)].sort((a, b) => a - b);
  try {
    return await getCachedSetDailyPriceRows(ids, fromDay);
  } catch (error) {
    logCaughtError("server_set_daily_prices_failed", error);
    return null;
  }
}
```

Never call either from inside another `unstable_cache` callback. Until phase B, `tsc` reports that `slug` does not exist on `sets`; do not cast the client to `any`.

### Step 7. `frontend/app/lib/setHubsData.ts` (new)

```ts
import "server-only";
import { cache } from "react";
import type { Product } from "../types/market";
import { addDaysToKey, sliceIndexRange, utcTodayKey, type IndexPoint, type IndexSummary } from "./marketIndex";
import {
  getCachedIndexSeries,
  getCachedIndexSummary,
  getCachedMarketProductSummaries,
  getCachedProductStats,
  getCachedSetAnalytics,
  getCachedSetDailyPrices,
  getCachedSetDirectory,
  getCachedSparklines,
} from "./serverMarketData";
import {
  buildSetCatalog,
  buildSetHubs,
  buildSetMedianLine,
  buildSetProductRows,
  buildSetSummary,
  footerSetLinks,
  MEDIAN_LINE_MAX_PRODUCTS,
  MEDIAN_LINE_WINDOW_DAYS,
  neighbourSets,
  newestHubPriceDay,
  rankedSetCount,
  resolveSetSlug,
  setIndexCode,
  setSlugForProduct,
  type SetCatalogEntry,
  type SetDirectoryEntry,
  type SetHub,
  type SetLink,
  type SetProductRow,
} from "./setHubs";
import { pickSparklines, type SparklinePayload } from "./sparkline";

/**
 * Server reads for the set hubs (WP37). Every function composes cached reads
 * (unstable_cache, tag market-products, WP11) in a plain async function,
 * never inside another cache callback (WP11's nested-cache rule). React
 * cache() lets generateMetadata, the page and the share image of one request
 * share a result.
 */

/** The sparkline window of set page rows (WP26 baked series). */
export const SET_ROW_SPARKLINE_PERIOD = "1Y" as const;

export interface SetCatalogData {
  directory: SetDirectoryEntry[];
  products: Product[];
  catalog: SetCatalogEntry[];
}

/** Directory plus summaries. null when the set directory could not be read. */
export const loadSetCatalog = cache(async (): Promise<SetCatalogData | null> => {
  const [directory, products] = await Promise.all([getCachedSetDirectory(), getCachedMarketProductSummaries()]);
  if (directory === null) return null;
  return { directory, products, catalog: buildSetCatalog(directory, products) };
});

export interface SetHubsData extends SetCatalogData {
  hubs: SetHub[];
  /** Sets with a composite rank: the percentile denominator. */
  rankedCount: number;
  newestPriceDay: string | null;
}

/** Everything /sets shows. null when the set directory could not be read. */
export const loadSetHubs = cache(async (): Promise<SetHubsData | null> => {
  const [base, stats, analytics, indexSummaries] = await Promise.all([
    loadSetCatalog(),
    getCachedProductStats(),
    getCachedSetAnalytics(),
    getCachedIndexSummary(),
  ]);
  if (base === null) return null;
  const hubs = buildSetHubs({ catalog: base.catalog, stats, analytics, indexSummaries });
  return { ...base, hubs, rankedCount: rankedSetCount(hubs), newestPriceDay: newestHubPriceDay(hubs) };
});

export interface SetPageData {
  hub: SetHub;
  rows: SetProductRow[];
  summary: string[];
  previous: SetHub | null;
  next: SetHub | null;
  sparklines: SparklinePayload | null;
  /** product_daily_stats day of the snapshot, for the median line's end. */
  statsDay: string | null;
}

export type SetPageResult =
  | { kind: "found"; data: SetPageData }
  | { kind: "redirect"; slug: string }
  | { kind: "missing" };

/**
 * One set's hub, product rows and summary (no chart). Throws when the set
 * directory cannot be read, so ISR keeps serving the last good page instead
 * of caching a 404.
 */
export const loadSetHub = cache(async (slug: string): Promise<SetPageResult> => {
  const data = await loadSetHubs();
  if (data === null) throw new Error("set directory unavailable");
  const resolved = resolveSetSlug(data.directory, slug);
  if (resolved.kind !== "found") return resolved;
  const hub = data.hubs.find((candidate) => candidate.id === resolved.entry.id);
  if (!hub) return { kind: "missing" };

  const [stats, sparklines] = await Promise.all([getCachedProductStats(), getCachedSparklines(SET_ROW_SPARKLINE_PERIOD)]);
  const members = data.products.filter((product) => product.sets?.id === hub.id);
  const rows = buildSetProductRows(members, stats);
  const { previous, next } = neighbourSets(data.hubs, hub.id);
  return {
    kind: "found",
    data: {
      hub,
      rows,
      summary: buildSetSummary({
        setName: hub.name,
        productCount: hub.productCount,
        releaseDate: hub.releaseDate,
        median1y: hub.analytics?.median365 ?? null,
        rows,
      }),
      previous,
      next,
      sparklines: pickSparklines(sparklines, hub.productIds),
      statsDay: stats.day,
    },
  };
});

export type SetChart =
  | { kind: "index"; summary: IndexSummary; points: IndexPoint[] }
  | { kind: "median"; points: IndexPoint[] }
  | { kind: "unavailable" };

/** The set index (WP29) when published, else the median line from product_daily_stats. */
export async function loadSetChart(hub: SetHub, statsDay: string | null): Promise<SetChart> {
  if (hub.index) {
    const series = await getCachedIndexSeries(setIndexCode(hub.id));
    if (series === null) return { kind: "unavailable" };
    return { kind: "index", summary: hub.index, points: sliceIndexRange(series, "1y") };
  }
  const toDay = statsDay ?? addDaysToKey(utcTodayKey(), -1);
  const fromDay = addDaysToKey(toDay, -MEDIAN_LINE_WINDOW_DAYS);
  const rows = await getCachedSetDailyPrices(hub.productIds.slice(0, MEDIAN_LINE_MAX_PRODUCTS), fromDay);
  if (rows === null) return { kind: "unavailable" };
  return { kind: "median", points: buildSetMedianLine(rows, fromDay, toDay) };
}

/** Footer Browse links; [] on any failure (the footer never fails a page). */
export async function getFooterSetLinks(): Promise<SetLink[]> {
  try {
    const data = await loadSetCatalog();
    return data ? footerSetLinks(data.catalog, utcTodayKey()) : [];
  } catch {
    return [];
  }
}

/** The product's set slug for its breadcrumb and set link; null when unknown. */
export async function getSetSlugForProduct(product: Pick<Product, "sets">): Promise<string | null> {
  return setSlugForProduct(await getCachedSetDirectory(), product);
}
```

### Step 8. `frontend/app/lib/jsonLd.ts`: the CollectionPage builder

Append (WP24's file; `absoluteUrl` and `SITE_NAME` are already imported):

```ts
/**
 * schema.org CollectionPage with an ItemList of its entries (WP37 set hubs,
 * research/trust-seo-brand.md §11.5). Names and URLs only: no prices, so a
 * withheld price can never leak through it.
 */
export function buildCollectionPageJsonLd({
  name,
  description,
  path,
  items,
}: {
  name: string;
  description: string;
  path: string;
  items: ReadonlyArray<{ name: string; path: string }>;
}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description,
    url: absoluteUrl(path),
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absoluteUrl("/") },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: items.length,
      itemListElement: items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: absoluteUrl(item.path),
        name: item.name,
      })),
    },
  };
}
```

### Step 9. Metric definitions and methodology

9a. `frontend/app/lib/metricDefinitions.ts`: append to `DEFINITIONS`, after the last entry (WP29's, or a later package's):

```ts
  // Set hubs (WP37, /sets and /sets/[slug])
  def({ key: "setPricedProducts", label: "Priced", unitLabel: "count", window: "latest TCGplayer day", short: "Products in the set with a current price, not withheld as stale.", anchor: "set-pages" }),
  def({ key: "setVolatilityWeekly", label: "Volatility 1Y (weekly, median)", unitLabel: "% annualised", window: `${WEEKS_PER_YEAR} weeks`, short: "Median across the set's products of weekly volatility over 52 weeks, annualised.", anchor: "set-pages" }),
  def({ key: "setUnitsSold30d", label: "Units sold (30d)", unitLabel: "units", window: "30 days", short: "Units sold on TCGplayer in the last 30 days, summed over the set's products that report sales.", anchor: "set-pages" }),
  def({ key: "setActiveListings", label: "Active listings", unitLabel: "listings", window: "latest snapshot", short: "Seller listings in the latest snapshot, summed over the set's products with a fresh snapshot.", anchor: "set-pages" }),
  def({ key: "setUnitsOnMarket", label: "Units on market", unitLabel: "units", window: "latest snapshot", short: "Quantity offered across all listings, summed over the set's products with a fresh snapshot.", anchor: "set-pages" }),
  def({ key: "setDaysOfSupply", label: "Days of supply", unitLabel: "days", window: "30-day sales rate", short: "Units on market divided by units sold per day, over the set's products that report both.", anchor: "set-pages" }),
```

`WEEKS_PER_YEAR` is imported from `./marketStats` by WP25's entries; if the file has no such import, add `import { WEEKS_PER_YEAR } from "./marketStats";`. Change no existing entry.

9b. `frontend/app/content/methodology.ts`:
- Note the current values: `grep -n "METHODOLOGY_VERSION = \|METHODOLOGY_EFFECTIVE_DATE = " app/content/methodology.ts` (call them `V_OLD` and `D_OLD`).
- Set `METHODOLOGY_VERSION` to the next minor version (for example `"1.6"` becomes `"1.7"`) and `METHODOLOGY_EFFECTIVE_DATE` to today (`date -u +%F`).
- In `METHODOLOGY_CHANGES`, replace the identifiers `METHODOLOGY_VERSION` and `METHODOLOGY_EFFECTIVE_DATE` in the current first row with the literals `"V_OLD"` and `"D_OLD"`, then insert above it:

```ts
  {
    version: METHODOLOGY_VERSION,
    date: METHODOLOGY_EFFECTIVE_DATE,
    summary:
      "Adds set pages: set totals for sales and supply, the median line for sets without an index, the risk and return chart, and summaries built from the numbers.",
  },
```

- In `METHODOLOGY_SECTIONS`, directly after `{ anchor: "index", title: "Pokéfin Sealed Index" },` add `{ anchor: "set-pages", title: "Set pages" },`.

9c. `frontend/app/methodology/MethodologyArticle.tsx`: directly after the closing `</Section>` of `<Section id="index">` (WP29), add the section below. `LINK`, `Section`, `INDEX_RULES` (WP29) are already in the file; add `import { VOL_WEEKLY_MIN_RETURNS } from "../lib/marketStats";` if it is not imported, and `import Link from "next/link";` if absent.

```tsx
          <Section id="set-pages">
            <p>
              Every set has a page with its tracked sealed products, and{" "}
              <Link href="/sets" prefetch={false} className={LINK}>
                the sets table
              </Link>{" "}
              compares them. Set figures combine the set&apos;s products; a product whose price is withheld adds
              nothing to them.
            </p>
            <ul className="ml-5 list-disc space-y-1">
              <li>
                Median changes, consistency, daily volatility, max drawdown and the composite score are the set
                analytics described under <a href="#set-averages" className={LINK}>Set averages and medians</a> and{" "}
                <a href="#composite-score" className={LINK}>Composite score</a>.
              </li>
              <li>
                Volatility 1Y (weekly, median) is the median, across the set&apos;s products, of each product&apos;s
                weekly volatility (see <a href="#volatility" className={LINK}>Volatility</a>). A product needs{" "}
                {VOL_WEEKLY_MIN_RETURNS} weekly changes to have one.
              </li>
              <li>
                Units sold (30d), active listings and units on market are sums over the products that report them.
                The set page says how many of the set&apos;s products report sales and listings.
              </li>
              <li>
                A set&apos;s days of supply is the units on market of the products that report both figures, divided
                by those products&apos; units sold per day over the last 30 days.
              </li>
            </ul>
            <p>
              The set chart shows the set&apos;s own index when it has one (a set index needs{" "}
              {INDEX_RULES.minConstituents} constituents; see the index rules above). Otherwise it shows a median line:
              each day, the median daily change of the set&apos;s products that were priced that day and the day
              before, capped at plus or minus {INDEX_RULES.returnClipPercent}%, chained from 100 on the first day of
              the window. It is not an index: there is no constituent screen and no provisional day.
            </p>
            <p>
              The risk and return chart places each set by its weekly volatility (across) and its median 1-year change
              (up); the dot size is the number of tracked products. A set without both figures is counted under the
              chart and not plotted.
            </p>
            <p>
              The sentences at the top of a set page are built from the numbers on that page. A sentence whose number
              is missing is left out; none is written by hand or by a language model.
            </p>
          </Section>
```

Check: `LC_ALL=C grep -c $'\xe2\x80\x94' app/methodology/MethodologyArticle.tsx` prints 0 (no em dash). WP24's methodology tests (every section anchor rendered with an `id`, in `METHODOLOGY_SECTIONS` order) cover the new section.

### Step 10. `frontend/app/components/nav/Breadcrumbs.tsx` (new)

```tsx
import Link from "next/link";

export interface Crumb {
  name: string;
  /** Omit for the current page (the last crumb) or a crumb with no page. */
  href?: string;
}

/**
 * Breadcrumb trail (WP37): Home › Sets › {Set} › {Product type}. Server
 * component. The last crumb is the current page and is not a link. Pair it
 * with buildBreadcrumbJsonLd on the same items.
 */
export default function Breadcrumbs({ items, className = "" }: { items: readonly Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-small text-ink-soft">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${index}-${item.name}`} className="flex min-w-0 items-center gap-x-1.5">
              {item.href && !last ? (
                <Link
                  href={item.href}
                  prefetch={false}
                  className="rounded-control underline-offset-2 hover:text-action hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                >
                  {item.name}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "truncate text-ink" : undefined}>
                  {item.name}
                </span>
              )}
              {!last && (
                <span aria-hidden="true" className="text-ink-soft">
                  {"›"}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
```

### Step 11. `/sets`

All files in `frontend/app/sets/` are server components (no `"use client"`).

11a. `app/sets/setsState.ts` (presets, sort state, URLs). Do not name it `setsTable.ts`: next to `SetsTable.tsx` on a case-insensitive file system (macOS, Windows), `import SetsTable from "./SetsTable"` would resolve to the `.ts` file first and `forceConsistentCasingInFileNames` would fail the build.

```ts
/**
 * /sets table state (WP37): three column presets, sortable columns, and the
 * URLs that select them. Pure, so the server page and the tests share it.
 * Sorting and presets are links (?view=, ?sort=, ?dir=), so the page ships
 * no client JavaScript of its own.
 */
import type { MetricKey } from "../lib/metricDefinitions";
import type { SetHub } from "../lib/setHubs";

export type SetsView = "performance" | "risk" | "liquidity";
export type SetsSortKey =
  | "name"
  | "release"
  | "products"
  | "priced"
  | "med30"
  | "med90"
  | "med365"
  | "cons90"
  | "cons365"
  | "composite"
  | "volWeekly"
  | "vol90"
  | "dd365"
  | "units30"
  | "listings"
  | "onMarket"
  | "dos";
export type SetsSortDir = "asc" | "desc";

export interface SetsSort {
  key: SetsSortKey;
  dir: SetsSortDir;
}

export interface SetsState {
  view: SetsView;
  sort: SetsSort;
}

export type SetsColumnKind = "date" | "count" | "change" | "share" | "percent" | "drawdown" | "composite" | "days";

export interface SetsColumn {
  key: Exclude<SetsSortKey, "name">;
  metric: MetricKey;
  kind: SetsColumnKind;
  /** Direction a first click sorts in: the "better" end first where one exists. */
  firstDir: SetsSortDir;
  /** Phone value prefix, short. */
  shortLabel: string;
  value: (hub: SetHub) => number | string | null;
}

const num = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const SETS_COLUMNS: Readonly<Record<Exclude<SetsSortKey, "name">, SetsColumn>> = {
  release: { key: "release", metric: "setRelease", kind: "date", firstDir: "desc", shortLabel: "Released", value: (h) => h.releaseDate },
  products: { key: "products", metric: "setProducts", kind: "count", firstDir: "desc", shortLabel: "Products", value: (h) => h.productCount },
  priced: { key: "priced", metric: "setPricedProducts", kind: "count", firstDir: "desc", shortLabel: "Priced", value: (h) => h.pricedCount },
  med30: { key: "med30", metric: "setMedian30", kind: "change", firstDir: "desc", shortLabel: "Med 30D", value: (h) => num(h.analytics?.median30) },
  med90: { key: "med90", metric: "setMedian90", kind: "change", firstDir: "desc", shortLabel: "Med 90D", value: (h) => num(h.analytics?.median90) },
  med365: { key: "med365", metric: "setMedian365", kind: "change", firstDir: "desc", shortLabel: "Med 1Y", value: (h) => num(h.analytics?.median365) },
  cons90: { key: "cons90", metric: "setConsistency90", kind: "share", firstDir: "desc", shortLabel: "Cons. 90D", value: (h) => num(h.analytics?.consistency90) },
  cons365: { key: "cons365", metric: "setConsistency365", kind: "share", firstDir: "desc", shortLabel: "Cons. 1Y", value: (h) => num(h.analytics?.consistency365) },
  // Sorted on the raw z-blend, shown as the percentile of the rank (WP24).
  composite: { key: "composite", metric: "compositeScore", kind: "composite", firstDir: "desc", shortLabel: "Composite", value: (h) => (h.analytics === null || h.analytics.rank === null ? null : num(h.analytics.investScore)) },
  volWeekly: { key: "volWeekly", metric: "setVolatilityWeekly", kind: "percent", firstDir: "asc", shortLabel: "Vol 1Y", value: (h) => num(h.volWeeklyMedian) },
  vol90: { key: "vol90", metric: "setVolatility90Daily", kind: "percent", firstDir: "asc", shortLabel: "Vol 90D", value: (h) => num(h.analytics?.volatility90) },
  dd365: { key: "dd365", metric: "setMaxDrawdown365", kind: "drawdown", firstDir: "asc", shortLabel: "Drawdown", value: (h) => { const v = num(h.analytics?.maxDrawdown365); return v === null ? null : Math.abs(v); } },
  units30: { key: "units30", metric: "setUnitsSold30d", kind: "count", firstDir: "desc", shortLabel: "Sold 30D", value: (h) => h.liquidity.unitsSold30d },
  listings: { key: "listings", metric: "setActiveListings", kind: "count", firstDir: "desc", shortLabel: "Listings", value: (h) => h.liquidity.activeListings },
  onMarket: { key: "onMarket", metric: "setUnitsOnMarket", kind: "count", firstDir: "desc", shortLabel: "On market", value: (h) => h.liquidity.unitsOnMarket },
  dos: { key: "dos", metric: "setDaysOfSupply", kind: "days", firstDir: "asc", shortLabel: "Supply", value: (h) => num(h.liquidity.daysOfSupply) },
};

export const SETS_VIEWS: ReadonlyArray<{
  value: SetsView;
  label: string;
  columns: ReadonlyArray<Exclude<SetsSortKey, "name">>;
  defaultSort: SetsSort;
}> = [
  {
    value: "performance",
    label: "Performance",
    columns: ["release", "products", "med30", "med90", "med365", "cons365", "composite"],
    defaultSort: { key: "composite", dir: "desc" },
  },
  {
    value: "risk",
    label: "Risk",
    columns: ["products", "volWeekly", "vol90", "dd365", "cons90", "med365"],
    defaultSort: { key: "volWeekly", dir: "asc" },
  },
  {
    value: "liquidity",
    label: "Liquidity",
    columns: ["products", "priced", "units30", "listings", "onMarket", "dos"],
    defaultSort: { key: "units30", dir: "desc" },
  },
];

export const DEFAULT_SETS_VIEW: SetsView = "performance";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function viewSpec(view: SetsView) {
  return SETS_VIEWS.find((spec) => spec.value === view) ?? SETS_VIEWS[0];
}

/** Unknown values fall back to the view's default; a sort outside the view's columns too. */
export function parseSetsState(params: Record<string, string | string[] | undefined>): SetsState {
  const rawView = first(params.view);
  const view: SetsView = SETS_VIEWS.some((spec) => spec.value === rawView) ? (rawView as SetsView) : DEFAULT_SETS_VIEW;
  const spec = viewSpec(view);
  const rawSort = first(params.sort);
  const rawDir = first(params.dir);
  const key =
    rawSort === "name" || spec.columns.includes(rawSort as Exclude<SetsSortKey, "name">)
      ? (rawSort as SetsSortKey)
      : null;
  if (key === null) return { view, sort: spec.defaultSort };
  const dir: SetsSortDir =
    rawDir === "asc" || rawDir === "desc" ? rawDir : key === "name" ? "asc" : SETS_COLUMNS[key].firstDir;
  return { view, sort: { key, dir } };
}

export function sortValue(hub: SetHub, key: SetsSortKey): number | string | null {
  return key === "name" ? hub.name : SETS_COLUMNS[key].value(hub);
}

/** Missing values last in both directions; ties by name. */
export function sortHubs(hubs: readonly SetHub[], sort: SetsSort): SetHub[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...hubs].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) {
      if (typeof va === "number" && typeof vb === "number") return sign * (va - vb);
      return sign * String(va).localeCompare(String(vb));
    }
    return a.name.localeCompare(b.name) || a.id - b.id;
  });
}

/** Clicking the sorted column flips it; another column starts in its first direction. */
export function nextSort(current: SetsSort, key: SetsSortKey): SetsSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "name" ? "asc" : SETS_COLUMNS[key].firstDir };
}

/** "/sets", or "/sets?view=risk&sort=dd365&dir=asc" with defaults left out. */
export function setsHref(state: SetsState): string {
  const query = new URLSearchParams();
  if (state.view !== DEFAULT_SETS_VIEW) query.set("view", state.view);
  const def = viewSpec(state.view).defaultSort;
  if (state.sort.key !== def.key || state.sort.dir !== def.dir) {
    query.set("sort", state.sort.key);
    query.set("dir", state.sort.dir);
  }
  const text = query.toString();
  return text ? `/sets?${text}` : "/sets";
}
```

11b. `app/lib/riskReturnChart.ts` (pure geometry):

```ts
/**
 * Geometry for the /sets risk and return chart (WP37). Pure: no React.
 *
 * x: the set's median weekly volatility over 52 weeks (WP25 vol_weekly_52w,
 * percent annualised). y: the set's median 1-year change (get_set_analytics
 * median365, percent). Dot size: the number of tracked products. Rendered on
 * the server as SVG gridlines plus HTML dots positioned by percentages, so
 * dots stay round and labels stay 12 px at any width
 * (01-PRODUCT-DIRECTION.md §3.4: no charting library on browse pages).
 */
import { formatPercent, formatSignedPercent } from "./format";
import { niceStep } from "./indexChart";
import type { SetHub } from "./setHubs";

export const RISK_RETURN_MIN_POINTS = 3;
const TARGET_TICKS = 5;
const DOT_MIN_PX = 8;
const DOT_MAX_PX = 24;

export interface RiskReturnPoint {
  id: number;
  name: string;
  path: string;
  /** Percent annualised. */
  vol: number;
  /** Percent. */
  ret1y: number;
  products: number;
  /** Percent from the left and from the top of the plot box. */
  xPct: number;
  yPct: number;
  diameterPx: number;
  /** The dot's title: "Evolving Skies: volatility 18.2%, 1Y +12.4%, 9 products". */
  title: string;
}

export interface RiskReturnTick {
  value: number;
  label: string;
  pct: number;
}

export interface RiskReturnModel {
  points: RiskReturnPoint[];
  xTicks: RiskReturnTick[];
  yTicks: RiskReturnTick[];
  /** Percent from the top of the y = 0 line; null when 0 is outside the domain. */
  zeroPct: number | null;
  /** Sets left out for lack of a weekly volatility or a 1-year median. */
  omitted: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function ticks(lo: number, hi: number, step: number, label: (v: number) => string, toPct: (v: number) => number) {
  const out: RiskReturnTick[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) {
    const value = Math.round(v / step) * step;
    out.push({ value, label: label(value), pct: r1(toPct(value)) });
  }
  return out;
}

/** null with fewer than RISK_RETURN_MIN_POINTS plottable sets. */
export function buildRiskReturnChart(hubs: readonly SetHub[]): RiskReturnModel | null {
  const plottable = hubs.filter(
    (hub) =>
      typeof hub.volWeeklyMedian === "number" &&
      Number.isFinite(hub.volWeeklyMedian) &&
      typeof hub.analytics?.median365 === "number" &&
      Number.isFinite(hub.analytics.median365)
  );
  if (plottable.length < RISK_RETURN_MIN_POINTS) return null;

  const vols = plottable.map((hub) => hub.volWeeklyMedian as number);
  const rets = plottable.map((hub) => hub.analytics?.median365 as number);
  const xStep = niceStep(Math.max(...vols, 1) / (TARGET_TICKS - 1));
  const xMax = Math.max(xStep, Math.ceil(Math.max(...vols) / xStep) * xStep);
  const yLoRaw = Math.min(0, ...rets);
  const yHiRaw = Math.max(0, ...rets);
  const yStep = niceStep((yHiRaw - yLoRaw || 10) / (TARGET_TICKS - 1));
  const yMin = Math.floor(yLoRaw / yStep) * yStep;
  const yMax = Math.max(yMin + yStep, Math.ceil(yHiRaw / yStep) * yStep);

  const xPctOf = (v: number) => (v / xMax) * 100;
  const yPctOf = (v: number) => ((yMax - v) / (yMax - yMin)) * 100;
  const maxProducts = Math.max(...plottable.map((hub) => hub.productCount), 1);

  const points = plottable
    .map((hub): RiskReturnPoint => {
      const vol = hub.volWeeklyMedian as number;
      const ret1y = hub.analytics?.median365 as number;
      return {
        id: hub.id,
        name: hub.name,
        path: hub.path,
        vol,
        ret1y,
        products: hub.productCount,
        xPct: r1(xPctOf(vol)),
        yPct: r1(yPctOf(ret1y)),
        diameterPx: Math.round(DOT_MIN_PX + (DOT_MAX_PX - DOT_MIN_PX) * Math.sqrt(hub.productCount / maxProducts)),
        title: `${hub.name}: volatility ${formatPercent(vol)}, 1Y ${formatSignedPercent(ret1y)}, ${hub.productCount} ${
          hub.productCount === 1 ? "product" : "products"
        }`,
      };
    })
    // Big dots first, so small ones stay on top and visible.
    .sort((a, b) => b.diameterPx - a.diameterPx || a.id - b.id);

  return {
    points,
    xTicks: ticks(0, xMax, xStep, (v) => formatPercent(v, { decimals: 0 }), xPctOf),
    yTicks: ticks(yMin, yMax, yStep, (v) => formatSignedPercent(v, { decimals: 0 }), yPctOf),
    zeroPct: yMin <= 0 && yMax >= 0 ? r1(yPctOf(0)) : null,
    omitted: hubs.length - plottable.length,
    xMax,
    yMin,
    yMax,
  };
}
```

11c. `app/sets/SetCell.tsx`:

```tsx
import Delta from "../components/ui/Delta";
import { formatDateOnly, formatDecimal, formatInteger, formatPercent } from "../lib/format";
import { formatCompositePercentile } from "../lib/setAnalytics";
import type { SetHub } from "../lib/setHubs";
import { SETS_COLUMNS, type SetsColumn } from "./setsState";

function Missing() {
  return (
    <span className="text-ink-soft">
      --<span className="sr-only"> Not available</span>
    </span>
  );
}

/** One /sets value, formatted for its column kind (WP23 precision rules). */
export default function SetCell({ column, hub, rankedCount }: { column: SetsColumn; hub: SetHub; rankedCount: number }) {
  const value = column.value(hub);
  if (column.kind === "change") {
    return <Delta value={typeof value === "number" ? value : null} />;
  }
  if (value === null) return <Missing />;
  switch (column.kind) {
    case "date":
      return <>{formatDateOnly(String(value))}</>;
    case "count":
      return <>{formatInteger(value as number)}</>;
    case "share":
      return <>{formatPercent(value as number, { decimals: 0 })}</>;
    case "percent":
    case "drawdown":
      return <>{formatPercent(value as number)}</>;
    case "days":
      return <>{formatDecimal(value as number, 1)}</>;
    case "composite":
      return (
        <span
          title={`Composite z-score ${(value as number).toFixed(2)}, rank ${hub.analytics?.rank} of ${rankedCount}`}
        >
          {formatCompositePercentile(hub.analytics?.rank ?? null, rankedCount)}
        </span>
      );
  }
}

export { SETS_COLUMNS };
```

11d. `app/sets/SetsTable.tsx` (768 px and up):

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import IntentLink from "../components/IntentLink";
import MetricLabel from "../components/ui/MetricLabel";
import { METRIC_DEFINITIONS } from "../lib/metricDefinitions";
import type { SetHub } from "../lib/setHubs";
import SetCell from "./SetCell";
import { nextSort, SETS_COLUMNS, setsHref, viewSpec, type SetsSortKey, type SetsState } from "./setsState";

const TH = "h-10 px-3 text-left align-middle text-small font-semibold text-ink-soft";
const TD = "h-11 px-3 align-middle text-body tabular-nums text-ink";
// The header text is MetricLabel (its "?" is a link), so the sort control is
// its own link: at least 24 x 24 px (WCAG 2.5.8), 44 px on touch screens.
const SORT_LINK =
  "inline-flex min-h-6 min-w-6 items-center justify-center rounded-control hover:bg-surface hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action pointer-coarse:min-h-11 pointer-coarse:min-w-11";

function SortHeader({
  state,
  sortKey,
  align,
  srLabel,
  children,
}: {
  state: SetsState;
  sortKey: SetsSortKey;
  align: "left" | "right";
  /** Visible header text, for the sort link's name: "Sort by Med 1Y". */
  srLabel: string;
  children: ReactNode;
}) {
  const sorted = state.sort.key === sortKey;
  const ariaSort = sorted ? (state.sort.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th scope="col" aria-sort={ariaSort} className={`${TH} ${align === "right" ? "text-right" : ""} ${sorted ? "font-bold text-ink" : ""}`}>
      <span className={`inline-flex items-center gap-0.5 ${align === "right" ? "justify-end" : ""}`}>
        {children}
        <Link
          href={setsHref({ view: state.view, sort: nextSort(state.sort, sortKey) })}
          scroll={false}
          prefetch={false}
          className={SORT_LINK}
        >
          <span aria-hidden="true" className={sorted ? "text-ink" : "text-ink-soft opacity-60"}>
            {sorted ? (state.sort.dir === "asc" ? "▲" : "▼") : "↕"}
          </span>
          <span className="sr-only">Sort by {srLabel}</span>
        </Link>
      </span>
    </th>
  );
}

/** Desktop table (768 px and up). One row per set, 44 px, one line. */
export default function SetsTable({
  hubs,
  state,
  rankedCount,
}: {
  hubs: readonly SetHub[];
  state: SetsState;
  rankedCount: number;
}) {
  const columns = viewSpec(state.view).columns.map((key) => SETS_COLUMNS[key]);
  return (
    <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
      <table className="w-full border-collapse">
        <caption className="sr-only">
          Sets, {viewSpec(state.view).label.toLowerCase()} columns. Column headers sort the table.
        </caption>
        <thead className="border-b border-line bg-surface-alt">
          <tr>
            <SortHeader state={state} sortKey="name" align="left" srLabel="Set">
              Set
            </SortHeader>
            {columns.map((column) => (
              <SortHeader
                key={column.key}
                state={state}
                sortKey={column.key}
                align={column.kind === "date" ? "left" : "right"}
                srLabel={METRIC_DEFINITIONS[column.metric].label}
              >
                <MetricLabel metric={column.metric} />
              </SortHeader>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {hubs.map((hub) => (
            <tr key={hub.id} className="hover:bg-surface-alt">
              <td className={`${TD} max-w-80`}>
                {/* One line (44 px rows): name, then the set code in caption. */}
                <span className="flex min-w-0 items-baseline gap-2">
                  <IntentLink
                    href={hub.path}
                    className="truncate font-medium text-ink hover:text-action focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
                  >
                    {hub.name}
                  </IntentLink>
                  {hub.code && (
                    <span className="shrink-0 text-caption tabular-nums uppercase tracking-wide text-ink-soft">{hub.code}</span>
                  )}
                </span>
              </td>
              {columns.map((column) => (
                <td key={column.key} className={`${TD} ${column.kind === "date" ? "text-left" : "text-right"}`}>
                  <SetCell column={column} hub={hub} rankedCount={rankedCount} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

11e. `app/sets/SetsList.tsx` (below 768 px):

```tsx
import Link from "next/link";
import { DataList, DataListRow } from "../components/ui/DataList";
import Delta from "../components/ui/Delta";
import { formatInteger, formatMonthYear } from "../lib/format";
import type { SetHub } from "../lib/setHubs";
import SetCell from "./SetCell";
import { nextSort, SETS_COLUMNS, setsHref, viewSpec, type SetsSortKey, type SetsState } from "./setsState";

const CHIP =
  "inline-flex min-h-9 items-center rounded-control border border-line px-3 text-caption font-semibold focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action pointer-coarse:min-h-11";

/** Phones (below 768 px): sort chips, then one two-line row per set (WP23 DataList). */
export default function SetsList({
  hubs,
  state,
  rankedCount,
}: {
  hubs: readonly SetHub[];
  state: SetsState;
  rankedCount: number;
}) {
  const spec = viewSpec(state.view);
  const shownKey = state.sort.key === "name" || state.sort.key === "release" ? spec.defaultSort.key : state.sort.key;
  const shown = SETS_COLUMNS[shownKey as Exclude<SetsSortKey, "name">];
  const chipKeys: SetsSortKey[] = [...spec.columns.filter((key) => key !== "products"), "name"];
  return (
    <div className="md:hidden">
      <nav aria-label="Sort sets" className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {chipKeys.map((key) => {
          const selected = state.sort.key === key;
          const label = key === "name" ? "Name" : SETS_COLUMNS[key].shortLabel;
          return (
            <Link
              key={key}
              href={setsHref({ view: state.view, sort: nextSort(state.sort, key) })}
              scroll={false}
              prefetch={false}
              aria-current={selected ? "true" : undefined}
              className={`${CHIP} ${selected ? "border-action bg-action text-white" : "bg-surface text-ink-soft"}`}
            >
              {label}
              {selected && <span aria-hidden="true">{state.sort.dir === "asc" ? " ▲" : " ▼"}</span>}
            </Link>
          );
        })}
      </nav>
      <DataList label="Sets">
        {hubs.map((hub) => (
          <DataListRow
            key={hub.id}
            href={hub.path}
            title={hub.name}
            subtitle={hub.generation ?? undefined}
            meta={`${formatInteger(hub.productCount)} ${hub.productCount === 1 ? "product" : "products"}${
              hub.releaseDate ? ` · ${formatMonthYear(hub.releaseDate)}` : ""
            }`}
            value={
              <span>
                <span className="text-small font-normal text-ink-soft">{shown.shortLabel} </span>
                <SetCell column={shown} hub={hub} rankedCount={rankedCount} />
              </span>
            }
            delta={shown.key === "med365" ? undefined : <Delta value={hub.analytics?.median365 ?? null} period="1Y" />}
          />
        ))}
      </DataList>
    </div>
  );
}
```

11f. `app/sets/SetsViewNav.tsx`:

```tsx
import Link from "next/link";
import { SETS_VIEWS, setsHref, type SetsState } from "./setsState";

/** Column presets as links (no client JavaScript), styled as WP23 segments. */
export default function SetsViewNav({ state }: { state: SetsState }) {
  return (
    <nav aria-label="Columns" className="inline-flex w-full rounded-control border border-line bg-surface p-0.5 sm:w-auto">
      {SETS_VIEWS.map((spec) => {
        const selected = spec.value === state.view;
        return (
          <Link
            key={spec.value}
            href={setsHref({ view: spec.value, sort: spec.defaultSort })}
            scroll={false}
            prefetch={false}
            aria-current={selected ? "page" : undefined}
            className={`inline-flex flex-1 items-center justify-center rounded-control px-3 py-1.5 text-caption font-semibold focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action pointer-coarse:min-h-11 sm:flex-none ${
              selected ? "bg-action text-white" : "text-ink-soft hover:bg-surface-alt"
            }`}
          >
            {spec.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

11g. `app/sets/SetsDefinitions.tsx`:

```tsx
import Link from "next/link";
import { METRIC_DEFINITIONS } from "../lib/metricDefinitions";
import { SETS_COLUMNS, viewSpec, type SetsView } from "./setsState";

/**
 * The touch and screen-reader source of the column definitions (WP14's
 * disclosure on the old /stats page, now reading WP24's definitions). A
 * <details>, so it needs no JavaScript.
 */
export default function SetsDefinitions({ view }: { view: SetsView }) {
  const keys = viewSpec(view).columns.map((key) => SETS_COLUMNS[key].metric);
  return (
    <details className="mt-3 text-small">
      <summary className="cursor-pointer py-1 font-semibold text-ink-soft hover:text-ink pointer-coarse:min-h-11">
        What do these columns mean?
      </summary>
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {keys.map((key) => (
          <div key={key}>
            <dt className="font-semibold text-ink">{METRIC_DEFINITIONS[key].label}</dt>
            <dd className="text-ink-soft">{METRIC_DEFINITIONS[key].short}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3">
        <Link
          href="/methodology#set-pages"
          prefetch={false}
          className="font-medium text-action underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
        >
          Full definitions in the methodology
        </Link>
      </p>
    </details>
  );
}
```

11h. `app/sets/RiskReturnChart.tsx`:

```tsx
import Link from "next/link";
import Delta from "../components/ui/Delta";
import { formatInteger, formatPercent, formatSignedPercent } from "../lib/format";
import type { RiskReturnModel } from "../lib/riskReturnChart";

/**
 * Risk and return by set (WP37): server-rendered, no client JavaScript.
 * Gridlines and dots are SVG stretched to the box (dots stay round: see
 * below); tick labels are HTML placed by percentages so they stay 12 px.
 * Each dot links to its set and has a <title> with its numbers. The
 * table under the chart is the keyboard and screen-reader path to the same
 * data, with links.
 */
export default function RiskReturnChart({ model }: { model: RiskReturnModel }) {
  const vols = model.points.map((p) => p.vol);
  const rets = model.points.map((p) => p.ret1y);
  const summary = `${model.points.length} sets. Median weekly volatility from ${formatPercent(Math.min(...vols))} to ${formatPercent(
    Math.max(...vols)
  )}; median 1-year change from ${formatSignedPercent(Math.min(...rets))} to ${formatSignedPercent(Math.max(...rets))}.`;
  const byName = [...model.points].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <figure className="m-0">
      <div className="relative h-72 pb-6 pl-12 md:h-96">
        <div className="relative h-full w-full" aria-hidden="true">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false" className="absolute inset-0 h-full w-full overflow-visible">
            {model.yTicks.map((tick) => (
              <line key={`y${tick.value}`} x1={0} x2={100} y1={tick.pct} y2={tick.pct} className="stroke-chart-grid" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {model.xTicks.map((tick) => (
              <line key={`x${tick.value}`} x1={tick.pct} x2={tick.pct} y1={0} y2={100} className="stroke-chart-grid" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {model.zeroPct !== null && (
              <line x1={0} x2={100} y1={model.zeroPct} y2={model.zeroPct} className="stroke-chart-bench" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          {model.yTicks.map((tick) => (
            <span key={`yl${tick.value}`} className="absolute right-full mr-2 -translate-y-1/2 text-caption tabular-nums text-ink-soft" style={{ top: `${tick.pct}%` }}>
              {tick.label}
            </span>
          ))}
          {model.xTicks.map((tick) => (
            <span key={`xl${tick.value}`} className="absolute top-full mt-1 -translate-x-1/2 text-caption tabular-nums text-ink-soft" style={{ left: `${tick.pct}%` }}>
              {tick.label}
            </span>
          ))}
          {/* Dots: zero-length round-capped strokes with non-scaling width, so
              they stay round in the stretched viewBox. Each is a link with a
              <title> tooltip; tabIndex -1 keeps 60 dots out of the Tab order
              (the table below is the keyboard path). */}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false" className="absolute inset-0 h-full w-full overflow-visible">
            {model.points.map((point) => (
              <a key={point.id} href={point.path} tabIndex={-1} data-set-id={point.id}>
                <title>{point.title}</title>
                <path
                  d={`M${point.xPct} ${point.yPct}h0`}
                  className="stroke-chart-line hover:stroke-action-strong"
                  strokeOpacity={0.65}
                  strokeWidth={point.diameterPx}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </a>
            ))}
          </svg>
        </div>
      </div>
      <figcaption className="mt-6 space-y-1 text-caption text-ink-soft">
        <span className="sr-only">{summary}</span>
        <span className="block" aria-hidden="true">
          Across: median weekly volatility over 52 weeks, annualised. Up: median 1-year change. Dot size: tracked products.
        </span>
        {model.omitted > 0 && (
          <span className="block">
            {formatInteger(model.omitted)} {model.omitted === 1 ? "set has" : "sets have"} no 1-year change or weekly volatility yet and{" "}
            {model.omitted === 1 ? "is" : "are"} not plotted.
          </span>
        )}
      </figcaption>
      <details className="mt-3 text-small">
        <summary className="cursor-pointer py-1 font-semibold text-ink-soft hover:text-ink pointer-coarse:min-h-11">Chart data as a table</summary>
        <table className="mt-2 w-full border-collapse">
          <thead>
            <tr className="border-b border-line text-left text-ink-soft">
              <th scope="col" className="py-2 pr-3 font-semibold">Set</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Volatility 1Y (weekly)</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Median 1Y</th>
              <th scope="col" className="py-2 text-right font-semibold">Products</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {byName.map((point) => (
              <tr key={point.id}>
                <td className="py-2 pr-3">
                  <Link href={point.path} prefetch={false} className="text-action underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action">
                    {point.name}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatPercent(point.vol)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  <Delta value={point.ret1y} />
                </td>
                <td className="py-2 text-right tabular-nums">{formatInteger(point.products)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
```

The dots are zero-length paths with round caps and a non-scaling stroke: the SVG is stretched (`preserveAspectRatio="none"`), but a non-scaling stroke width is in screen pixels, so each dot stays a circle of `diameterPx`. Do not replace them with `<circle>` (it would become an ellipse) or with HTML dots (the chart must stay one SVG of marks).

11i. `app/sets/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import CardRinkPromo from "../components/CardRinkPromo";
import AsOf from "../components/ui/AsOf";
import { buttonClasses } from "../components/ui/Button";
import DecisionNote from "../components/ui/DecisionNote";
import EmptyState from "../components/ui/EmptyState";
import PageHeader from "../components/ui/PageHeader";
import ProvenanceLine from "../components/ui/ProvenanceLine";
import { PROVENANCE_SENTENCE } from "../content/disclosures";
import { buildBreadcrumbJsonLd, buildCollectionPageJsonLd, serializeJsonLd } from "../lib/jsonLd";
import { buildRiskReturnChart } from "../lib/riskReturnChart";
import { loadSetHubs } from "../lib/setHubsData";
import { SETS_PATH } from "../lib/taxonomySlug";
import RiskReturnChart from "./RiskReturnChart";
import SetsList from "./SetsList";
import SetsTable from "./SetsTable";
import SetsDefinitions from "./SetsDefinitions";
import SetsViewNav from "./SetsViewNav";
import { parseSetsState, setsHref, sortHubs, viewSpec } from "./setsState";

/*
 * /sets: every set on one table, with column presets and a risk and return
 * chart (WP37). Server-rendered with no client JavaScript of its own: presets
 * and sorting are links (?view=, ?sort=, ?dir=), the chart is SVG and HTML
 * built here. Reading searchParams makes the route dynamic; every read is an
 * unstable_cache entry tagged market-products (WP11), so a request renders
 * from cache. /analytics and /stats answer 308 to this page (next.config.ts).
 * Never add "use client", a charting library or a client fetch here:
 * perf-budgets.json forbids recharts and supabase-js on this route.
 */

const DESCRIPTION =
  "Every tracked Pokémon TCG set on one table: median returns, consistency, risk and liquidity of its sealed products, from daily TCGplayer Market Prices.";

export const metadata: Metadata = {
  // The root layout template appends " · Pokéfin".
  title: "Pokémon TCG Sets",
  description: DESCRIPTION,
  alternates: { canonical: SETS_PATH },
};

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function Shell({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">{children}</main>;
}

export default async function SetsPage({ searchParams }: PageProps) {
  const state = parseSetsState(await searchParams);
  // A failed summaries read rejects (WP11 throws when the RPC and its
  // fallback both fail): show the same error state, not the error boundary.
  const data = await loadSetHubs().catch(() => null);

  if (data === null) {
    return (
      <Shell>
        <PageHeader title="Pokémon TCG sets" />
        <EmptyState
          className="mt-6"
          headingLevel={2}
          title="Sets could not be loaded"
          description="This is usually temporary. Reload the page in a minute."
          action={
            <Link href={setsHref(state)} prefetch={false} className={buttonClasses({ variant: "secondary", size: "sm" })}>
              Reload
            </Link>
          }
        />
        <CardRinkPromo />
      </Shell>
    );
  }

  const hubs = sortHubs(data.hubs, state.sort);
  const chart = buildRiskReturnChart(data.hubs);
  const collection = buildCollectionPageJsonLd({
    name: "Pokémon TCG sets",
    description: DESCRIPTION,
    path: SETS_PATH,
    items: data.hubs.filter((hub) => hub.indexable).map((hub) => ({ name: hub.name, path: hub.path })),
  });
  const breadcrumb = buildBreadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Sets", path: SETS_PATH },
  ]);

  return (
    <Shell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(collection) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />

      <PageHeader
        title="Pokémon TCG sets"
        provenance={
          <>
            <ProvenanceLine methodologyHref="/methodology#set-pages">
              {PROVENANCE_SENTENCE} Set figures are medians and totals across each set&apos;s tracked products.
            </ProvenanceLine>
            <AsOf date={data.newestPriceDay} className="mt-1 block" />
          </>
        }
      />

      {hubs.length === 0 ? (
        <EmptyState className="mt-6" headingLevel={2} title="No sets yet" description="Sets appear once their products are priced." />
      ) : (
        <>
          <section aria-labelledby="sets-table-h" className="mt-6">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 id="sets-table-h" className="text-h2 font-semibold text-ink">
                {hubs.length} sets, {viewSpec(state.view).label.toLowerCase()}
              </h2>
              <SetsViewNav state={state} />
            </div>
            <SetsTable hubs={hubs} state={state} rankedCount={data.rankedCount} />
            <SetsList hubs={hubs} state={state} rankedCount={data.rankedCount} />
            <SetsDefinitions view={state.view} />
            <DecisionNote anchor="composite-score" className="mt-3" />
          </section>

          <section aria-labelledby="sets-chart-h" className="mt-8 rounded-card border border-line bg-surface p-4 md:p-5">
            <h2 id="sets-chart-h" className="text-h3 font-semibold text-ink">
              Risk and return by set
            </h2>
            <p className="mt-1 text-small text-ink-soft">
              Each dot is a set: further right moved more week to week, higher gained more over a year.
            </p>
            <div className="mt-4">
              {chart ? (
                <RiskReturnChart model={chart} />
              ) : (
                <EmptyState title="Not enough sets have a year of prices and weekly volatility yet." />
              )}
            </div>
          </section>
        </>
      )}

      <CardRinkPromo />
    </Shell>
  );
}
```

Do not add `export const dynamic`, `revalidate` or `generateStaticParams` here: reading `searchParams` makes the route dynamic, which is the design (D1 item 8). Do not add a `loading.tsx` under `app/sets/` (it would replace the table with a skeleton on every sort click).

### Step 12. `/sets/[slug]`

12a. `app/sets/[slug]/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import CardRinkPromo from "../../components/CardRinkPromo";
import IntentLink from "../../components/IntentLink";
import MiniSparkline from "../../components/MarketView/MiniSparkline";
import Breadcrumbs from "../../components/nav/Breadcrumbs";
import Price from "../../components/Price";
import AsOf, { daysBetween, STALE_AFTER_DAYS } from "../../components/ui/AsOf";
import Badge from "../../components/ui/Badge";
import { DataList, DataListRow } from "../../components/ui/DataList";
import Delta from "../../components/ui/Delta";
import EmptyState from "../../components/ui/EmptyState";
import MetricLabel from "../../components/ui/MetricLabel";
import PageHeader from "../../components/ui/PageHeader";
import ProvenanceLine from "../../components/ui/ProvenanceLine";
import Stat from "../../components/ui/Stat";
import { PROVENANCE_SENTENCE } from "../../content/disclosures";
import IndexChart from "../../indices/sealed/IndexChart";
import { formatDateOnly, formatDecimal, formatInteger, recordedAtDateKey } from "../../lib/format";
import { buildBreadcrumbJsonLd, buildCollectionPageJsonLd, serializeJsonLd } from "../../lib/jsonLd";
import { INDEX_RULES, utcTodayKey } from "../../lib/marketIndex";
import type { SetHub } from "../../lib/setHubs";
import { loadSetChart, loadSetHub, type SetChart } from "../../lib/setHubsData";
import { NO_INDEX, OG_LOCALE, SITE_NAME } from "../../lib/site";
import { sparklineFor } from "../../lib/sparkline";
import { SETS_PATH, setPath } from "../../lib/taxonomySlug";

/*
 * /sets/[slug] (WP37): one set's sealed products, its index or median line,
 * a data-derived summary and its neighbours. ISR like /product/[id] (WP11):
 * rendered on first request, regenerated when the scraper revalidates the
 * market-products tag, and daily at the latest. The chart is server SVG
 * (WP29 IndexChart); no charting library loads here.
 */
export const revalidate = 86400;

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return [];
}

type PageProps = { params: Promise<{ slug: string }> };

const LINK =
  "font-medium text-action underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action";

/**
 * A shown price 2 or more days old (WP23 STALE_AFTER_DAYS). Phone rows add
 * the inline AsOf only then, so a fresh row is not cluttered with a date the
 * page header already states. A module function keeps render lint-pure.
 */
function isAgingPrice(recordedAt: string | null): boolean {
  const key = recordedAtDateKey(recordedAt);
  return key !== null && daysBetween(key, utcTodayKey()) >= STALE_AFTER_DAYS;
}

function hubTitle(hub: SetHub): string {
  return `${hub.name} sealed product prices`;
}

function hubDescription(hub: SetHub): string {
  return `Daily TCGplayer Market Price, 30-day and 1-year change and units sold for ${hub.productCount} tracked ${hub.name} sealed ${
    hub.productCount === 1 ? "product" : "products"
  }. Prices in USD and CAD.`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadSetHub(slug);
  // A redirect target is resolved by the page; its metadata is never served.
  if (result.kind !== "found") return { title: "Set not found", robots: NO_INDEX, alternates: { canonical: null } };
  const { hub } = result.data;
  const path = setPath(hub.slug);
  return {
    // The root layout template appends " · Pokéfin".
    title: `${hub.name} Sealed Product Prices`,
    description: hubDescription(hub),
    alternates: { canonical: path },
    // No `images` key: the file-based opengraph-image in this segment supplies it,
    // and Next would drop it if this object named images.
    openGraph: { type: "website", siteName: SITE_NAME, locale: OG_LOCALE, url: path },
    twitter: { card: "summary_large_image" },
    ...(hub.indexable ? {} : { robots: NO_INDEX }),
  };
}

function ChartBlock({ chart, hub }: { chart: SetChart; hub: SetHub }) {
  if (chart.kind === "unavailable") {
    return <EmptyState title="The set chart could not be loaded" description="This is usually temporary. Reload the page in a minute." />;
  }
  if (chart.kind === "index") {
    return (
      <>
        <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          <Stat
            label={<MetricLabel metric="indexLevel" />}
            value={formatDecimal(chart.summary.level)}
            asOf={
              <>
                as of the close of <time dateTime={chart.summary.day}>{formatDateOnly(chart.summary.day)}</time> (UTC)
              </>
            }
          />
          <Stat label="30D" value={<Delta value={chart.summary.chg30d} missingReason="No level 30 days earlier" />} />
          <Stat label="1Y" value={<Delta value={chart.summary.chg365d} missingReason="Less than a year of levels" />} />
          <Stat label={<MetricLabel metric="indexConstituents" />} value={formatInteger(chart.summary.nConstituents)} sub={chart.summary.provisional ? <Badge variant="warn">Provisional</Badge> : undefined} />
        </div>
        <IndexChart points={chart.points} title={chart.summary.name} />
        <p className="mt-2 text-caption text-ink-soft">
          Equal-weighted, chain-linked, published for the previous UTC day.{" "}
          <Link href="/methodology#index" prefetch={false} className={LINK}>
            How set indices work
          </Link>
        </p>
      </>
    );
  }
  return (
    <>
      <IndexChart points={chart.points} title={`${hub.name} median price change`} />
      <p className="mt-2 text-caption text-ink-soft">
        {hub.name} has no index yet: a set index needs {INDEX_RULES.minConstituents} products that pass the index
        screen. This line chains the median daily change of the set&apos;s products from 100, so it is not an index.{" "}
        <Link href="/methodology#set-pages" prefetch={false} className={LINK}>
          How this line is built
        </Link>
      </p>
    </>
  );
}

export default async function SetPage({ params }: PageProps) {
  const { slug } = await params;
  const result = await loadSetHub(slug);
  if (result.kind === "redirect") permanentRedirect(setPath(result.slug));
  if (result.kind === "missing") notFound();
  const { hub, rows, summary, previous, next, sparklines, statsDay } = result.data;
  const chart = await loadSetChart(hub, statsDay);
  const path = setPath(hub.slug);

  const collection = buildCollectionPageJsonLd({
    name: hubTitle(hub),
    description: hubDescription(hub),
    path,
    items: rows.map((row) => ({ name: `${hub.name} ${row.name}`, path: row.href })),
  });
  const breadcrumb = buildBreadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Sets", path: SETS_PATH },
    { name: hub.name, path },
  ]);
  const { liquidity } = hub;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(collection) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />

      <Breadcrumbs className="mb-3" items={[{ name: "Home", href: "/" }, { name: "Sets", href: SETS_PATH }, { name: hub.name }]} />

      <PageHeader
        title={hubTitle(hub)}
        provenance={
          <>
            <p className="text-small text-ink-soft">
              {[hub.generation, hub.code ? hub.code.toUpperCase() : null, hub.releaseDate ? `Released ${formatDateOnly(hub.releaseDate)}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <ProvenanceLine methodologyHref="/methodology#set-pages" className="mt-1">
              {PROVENANCE_SENTENCE}
            </ProvenanceLine>
            <AsOf date={hub.newestPriceDay} className="mt-1 block" />
          </>
        }
      />

      <section aria-labelledby="set-summary-h" className="mt-5 max-w-3xl">
        <h2 id="set-summary-h" className="sr-only">
          Summary
        </h2>
        <p className="text-prose text-ink">{summary.join(" ")}</p>
      </section>

      <section aria-labelledby="set-liquidity-h" className="mt-6 rounded-card border border-line bg-surface p-4 md:p-5">
        <h2 id="set-liquidity-h" className="text-h3 font-semibold text-ink">
          Sales and supply
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4">
          <Stat
            label={<MetricLabel metric="setUnitsSold30d" />}
            value={liquidity.unitsSold30d === null ? "--" : formatInteger(liquidity.unitsSold30d)}
            sub={liquidity.productsWithVolume < hub.productCount ? `${liquidity.productsWithVolume} of ${hub.productCount} products` : undefined}
          />
          <Stat
            label={<MetricLabel metric="setActiveListings" />}
            value={liquidity.activeListings === null ? "--" : formatInteger(liquidity.activeListings)}
            sub={liquidity.productsWithListings < hub.productCount ? `${liquidity.productsWithListings} of ${hub.productCount} products` : undefined}
          />
          <Stat label={<MetricLabel metric="setUnitsOnMarket" />} value={liquidity.unitsOnMarket === null ? "--" : formatInteger(liquidity.unitsOnMarket)} />
          <Stat label={<MetricLabel metric="setDaysOfSupply" />} value={formatDecimal(liquidity.daysOfSupply, 1)} />
        </div>
      </section>

      <section aria-labelledby="set-products-h" className="mt-6">
        <h2 id="set-products-h" className="text-h2 font-semibold text-ink">
          {hub.productCount} sealed {hub.productCount === 1 ? "product" : "products"}
        </h2>
        <div className="mt-3 hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
          <table className="w-full border-collapse">
            <caption className="sr-only">{hub.name} sealed products, highest price first</caption>
            <thead className="border-b border-line bg-surface-alt">
              <tr className="h-10 text-small text-ink-soft">
                <th scope="col" className="px-3 text-left font-semibold">Product</th>
                <th scope="col" className="px-3 text-right font-semibold"><MetricLabel metric="marketPrice" /></th>
                <th scope="col" className="px-3 text-right font-semibold">30D</th>
                <th scope="col" className="px-3 text-right font-semibold">1Y</th>
                <th scope="col" className="px-3 text-right font-semibold"><MetricLabel metric="unitsSold30d" /></th>
                <th scope="col" className="px-3 text-right font-semibold"><MetricLabel metric="daysOfSupply" /></th>
                <th scope="col" className="px-3 text-right font-semibold">1Y trend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.id} className="h-11 hover:bg-surface-alt">
                  <td className="max-w-80 px-3">
                    <IntentLink href={row.href} className="block truncate font-medium text-ink hover:text-action focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action">
                      {row.name}
                    </IntentLink>
                  </td>
                  <td className="px-3 text-right tabular-nums">
                    {row.usdPrice === null ? (
                      <span className="text-ink-soft">
                        --<span className="sr-only"> No current price</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Price usd={row.usdPrice} className="font-semibold text-ink" />
                        <AsOf date={row.priceRecordedAt} variant="table" />
                      </span>
                    )}
                  </td>
                  <td className="px-3 text-right"><Delta value={row.change30d} missingReason={row.usdPrice === null ? "Price withheld" : "Not available"} /></td>
                  <td className="px-3 text-right"><Delta value={row.change1y} missingReason={row.usdPrice === null ? "Price withheld" : "Not available"} /></td>
                  <td className="px-3 text-right tabular-nums">{row.unitsSold30d === null ? "--" : formatInteger(row.unitsSold30d)}</td>
                  <td className="px-3 text-right tabular-nums">{formatDecimal(row.daysOfSupply, 1)}</td>
                  <td className="px-3">
                    <div className="flex justify-end">
                      <MiniSparkline series={sparklineFor(sparklines, row.id)} size="row" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DataList label={`${hub.name} products`} className="mt-3 md:hidden">
          {rows.map((row) => (
            <DataListRow
              key={row.id}
              href={row.href}
              title={row.name}
              meta={
                <>
                  {row.unitsSold30d === null ? "Sales not available" : `${formatInteger(row.unitsSold30d)} sold 30D`}
                  {row.usdPrice !== null && isAgingPrice(row.priceRecordedAt) && (
                    <>
                      {" · "}
                      <AsOf date={row.priceRecordedAt} />
                    </>
                  )}
                </>
              }
              value={row.usdPrice === null ? "--" : <Price usd={row.usdPrice} />}
              delta={<Delta value={row.change30d} period="30D" missingReason={row.usdPrice === null ? "Price withheld" : "Not available"} />}
              sparkline={<MiniSparkline series={sparklineFor(sparklines, row.id)} size="row" />}
            />
          ))}
        </DataList>
      </section>

      <section aria-labelledby="set-chart-h" className="mt-6 rounded-card border border-line bg-surface p-4 md:p-5">
        <h2 id="set-chart-h" className="mb-3 text-h3 font-semibold text-ink">
          {chart.kind === "index" ? chart.summary.name : "Median price change"}
        </h2>
        <ChartBlock chart={chart} hub={hub} />
      </section>

      {(previous || next) && (
        <nav aria-label="Neighbouring sets" className="mt-6 grid gap-3 sm:grid-cols-2">
          {previous ? (
            <Link href={previous.path} prefetch={false} className="rounded-card border border-line bg-surface p-4 hover:bg-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action">
              <span className="block text-caption text-ink-soft">Previous set</span>
              <span className="block font-medium text-ink">{previous.name}</span>
              {previous.releaseDate && <span className="block text-caption text-ink-soft">Released {formatDateOnly(previous.releaseDate)}</span>}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={next.path} prefetch={false} className="rounded-card border border-line bg-surface p-4 text-right hover:bg-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action">
              <span className="block text-caption text-ink-soft">Next set</span>
              <span className="block font-medium text-ink">{next.name}</span>
              {next.releaseDate && <span className="block text-caption text-ink-soft">Released {formatDateOnly(next.releaseDate)}</span>}
            </Link>
          )}
        </nav>
      )}

      <p className="mt-6 text-small">
        <Link href={SETS_PATH} prefetch={false} className={LINK}>
          All sets
        </Link>
      </p>

      <CardRinkPromo />
    </main>
  );
}
```

12b. `app/sets/[slug]/loading.tsx`:

```tsx
import Skeleton from "../../components/ui/Skeleton";

/**
 * Set page skeleton (WP37): flat bars that reserve the page's boxes, so the
 * streamed page does not shift. No fake chart shape (01-PRODUCT-DIRECTION.md §3.4).
 */
export default function SetPageLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8" aria-busy="true">
      <p role="status" className="sr-only">
        Loading the set
      </p>
      <Skeleton className="mb-3 h-4 w-48" />
      <Skeleton className="h-8 w-3/4 max-w-xl" />
      <Skeleton className="mt-2 h-4 w-64" />
      <div className="mt-5 max-w-3xl space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <Skeleton className="mt-6 h-36 w-full rounded-card md:h-28" />
      <div className="mt-6 space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full md:h-11" />
        ))}
      </div>
      <Skeleton className="mt-6 h-72 w-full rounded-card md:h-96" />
    </main>
  );
}
```

12c. `app/sets/[slug]/not-found.tsx`:

```tsx
import Link from "next/link";
import EmptyState from "../../components/ui/EmptyState";
import { buttonClasses } from "../../components/ui/Button";
import { SETS_PATH } from "../../lib/taxonomySlug";

/** Unknown set slug (WP37). generateMetadata already returns noindex and no canonical. */
export default function SetNotFound() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 md:px-6">
      <EmptyState
        headingLevel={2}
        title="We don't track that set"
        description="The link may be old, or the set may have a new name."
        action={
          <Link href={SETS_PATH} prefetch={false} className={buttonClasses({ variant: "secondary", size: "sm" })}>
            All sets
          </Link>
        }
      />
    </main>
  );
}
```

`generateStaticParams` returns `[]` (WP11's pattern): no Supabase read at build, every set page renders on its first request and is cached until the `market-products` tag is revalidated by the scraper hook or a day passes.

### Step 13. Redirects and the old routes

13a. `frontend/next.config.ts`: in the array WP13's `redirects()` returns, replace the entry `{ source: "/stats", destination: "/analytics", permanent: true }` with the two entries below and change nothing else (WP33's `/market` entry stays):

```ts
      // WP37: the set analytics page moved to /sets. Each old URL answers one
      // 308 straight to /sets (never /stats -> /analytics -> /sets); Next
      // passes the query string through.
      { source: "/stats", destination: "/sets", permanent: true },
      { source: "/analytics", destination: "/sets", permanent: true },
```

13b. Delete `frontend/app/analytics/` and `frontend/app/stats/` (the directories, including `app/stats/__tests__/page.test.tsx` from WP24: its assertions move to Tests item 7). Redirects in `next.config.ts` run before the file system, so the pages would be dead code.

13c. Every other link. From `frontend/`:

```bash
grep -rn '"/analytics"\|/analytics"\|/analytics?\|"/stats"\|stats/page' app scripts jest.config.js eslint.config.mjs --include=*.ts --include=*.tsx --include=*.mjs --include=*.js
```

Change each link target to `/sets` (for example WP13's `NotFoundPanel.tsx`, WP24's `MethodologyArticle.tsx` prose, WP27's search page list) and a visible label "Set Analytics" or "Sets" next to it to "Sets". Remove `app/analytics/page.tsx` and `app/stats/page.tsx` from any explicit list in `jest.config.js` (WP17's coverage list) or `eslint.config.mjs`. The only `/analytics` and `/stats` strings left afterwards are: the two redirects, the `match` array in `navConfig.ts` (step 14a), `REDIRECT_CHECKS` (step 18f) and test fixtures that exercise the redirects.

### Step 14. Navigation, footer and root layout

14a. `frontend/app/components/nav/navConfig.ts` (WP27; without it see Before you start, default (a)):
- Add `import { setPath, slugifyTaxonomyName } from "../../lib/taxonomySlug";` (tiny and isomorphic; the search chunk may import it).
- Replace `SETS` with:

```ts
export const SETS: NavLink = {
  key: "sets",
  label: "Sets",
  href: "/sets",
  description: "Prices, risk and liquidity by set",
  match: ["/sets", "/analytics", "/stats"],
};
```

- Replace `setSearchHref` with:

```ts
/**
 * Where a set result goes: its set page (WP37). The slug is derived from the
 * name; when it is not the stored one (a duplicate name, a renamed set) the
 * set page answers 308 to the stored slug. A name with no letters or digits
 * falls back to /prices filtered by it.
 */
export function setSearchHref(setName: string): string {
  const slug = slugifyTaxonomyName(setName);
  return slug ? setPath(slug) : pricesSearchHref(setName);
}
```

- In the module comment, change "WP37 sets SETS.href to "/sets" and makes setSearchHref() return the set page." to "WP37 moved Sets to /sets and set results to set pages (done)." In `PAGE_KEYWORDS.sets` add `"set pages"`, `"risk"`, `"liquidity"`.

14b. `frontend/app/components/Footer.tsx` (WP24, WP27): the footer takes the set links as a prop, so it stays a synchronous server component.
- Add `import type { SetLink } from "../lib/setHubs";`.
- Change the signature to `export default function Footer({ setLinks = [] }: { setLinks?: readonly SetLink[] }) {` and, as its first statement:

```tsx
  // WP37: the newest released, indexed sets join Browse (research/trust-seo-brand.md §11.4).
  const columns = COLUMNS.map((column) =>
    column.title === "Browse" ? { ...column, links: [...column.links, ...setLinks] } : column
  );
```

- In the JSX replace `COLUMNS.map((column) => (` with `columns.map((column) => (`. Every link keeps `prefetch={false}` through `LinkColumn`. Update the WP27 module comment "WP37 appends set links to Browse." to "WP37 appends set links to Browse (done)."

14c. `frontend/app/layout.tsx` (async since WP20): add `import { getFooterSetLinks } from "./lib/setHubsData";`, add `const footerSetLinks = await getFooterSetLinks();` as the first statement of the layout function, and change `<Footer />` to `<Footer setLinks={footerSetLinks} />`. `getFooterSetLinks` never throws (it returns `[]`), so a failed read never fails a page.

### Step 15. Product page

15a. `frontend/app/product/[id]/productBreadcrumbs.ts` (new):

```ts
import type { Product } from "../../types/market";
import { SETS_PATH, setPath } from "../../lib/taxonomySlug";
import { getProductLabel, productPath } from "./productMeta";

/** One breadcrumb: the visible trail and the BreadcrumbList JSON-LD read the same list. */
export interface ProductCrumb {
  name: string;
  path: string;
}

/**
 * Home › Sets › {Set} › {Type} (WP37, research/trust-seo-brand.md §11.4).
 * The last crumb is the product itself: its type label, with the variant in
 * parentheses. Without a set slug (the set is not in the directory) the set
 * crumb is left out rather than linked to a 404.
 */
export function buildProductCrumbs(product: Product, setSlug: string | null): ProductCrumb[] {
  const label = getProductLabel(product);
  const crumbs: ProductCrumb[] = [
    { name: "Home", path: "/" },
    { name: "Sets", path: SETS_PATH },
  ];
  if (setSlug && product.sets?.name) crumbs.push({ name: product.sets.name, path: setPath(setSlug) });
  crumbs.push({ name: product.variant ? `${label} (${product.variant})` : label, path: productPath(product.id) });
  return crumbs;
}
```

15b. `frontend/app/product/[id]/page.tsx` (WP31's composition):
- Imports: add `getCachedSetDirectory` to the `../../lib/serverMarketData` import, and

```ts
import Link from "next/link";                              // only if the file does not import it already
import Breadcrumbs from "../../components/nav/Breadcrumbs";
import { buildBreadcrumbJsonLd } from "../../lib/jsonLd";
import { setSlugForProduct } from "../../lib/setHubs";
import { setPath } from "../../lib/taxonomySlug";
import { buildProductCrumbs } from "./productBreadcrumbs";
```

  `serializeJsonLd` is already imported (WP13, re-exported from `productMeta.ts`).
- In the page's `Promise.all`, append `getCachedSetDirectory()` and name it `setDirectory` in the destructuring.
- After the line `const setCode = ...;` add:

```ts
  const setSlug = setSlugForProduct(setDirectory, product);
  const crumbs = buildProductCrumbs(product, setSlug);
```

- Replace the whole breadcrumb block WP31 kept (from the `{/* Breadcrumb */}` comment, or `{/* Breadcrumb nav: ... */}`, through the closing `</nav>`) with:

```tsx
      {/* Breadcrumb trail and its BreadcrumbList (WP37). Escaped by serializeJsonLd. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildBreadcrumbJsonLd(crumbs)) }}
      />
      <Breadcrumbs
        className="mb-3"
        items={crumbs.map((crumb, index) => ({
          name: crumb.name,
          href: index < crumbs.length - 1 ? crumb.path : undefined,
        }))}
      />
```

  The WP13 Product JSON-LD `<script>` stays the first child of `<main>`.
- In the header's meta `<p>` (the one that renders `{generation && <span>{generation}</span>}`), insert as its first child:

```tsx
            {setSlug ? (
              <Link
                href={setPath(setSlug)}
                prefetch={false}
                className="font-medium text-action underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
              >
                {setName}
              </Link>
            ) : (
              <span>{setName}</span>
            )}
```

- Change `<SiblingList setName={setName} rows={siblingRows} />` to `<SiblingList setName={setName} setHref={setSlug ? setPath(setSlug) : null} rows={siblingRows} />`.

15c. `frontend/app/product/[id]/SiblingList.tsx` (WP31): add `import Link from "next/link";`, add `setHref?: string | null` to the props (`{ setName, setHref = null, rows }`), and make the heading:

```tsx
      <h2 id="siblings-heading" className="text-h3 font-semibold text-ink">
        Other products in{" "}
        {setHref ? (
          <Link
            href={setHref}
            prefetch={false}
            className="text-action underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
          >
            {setName}
          </Link>
        ) : (
          setName
        )}
      </h2>
```

15d. `frontend/app/product/[id]/productMeta.ts`, `buildProductMetadata`:
- Inside `openGraph`, delete the two comment lines `// image_url values are absolute storage URLs ...` and `// WP37 replaces this with a file-based opengraph-image per product.` and the three-line spread `...(product.image_url ? { images: [{ url: product.image_url, alt: name }] } : {}),` below them. The file-based `opengraph-image.tsx` (step 17g) now supplies `og:image` and `twitter:image`; a config `images` key would be overridden anyway.
- Replace the two comment lines `// Product photos are roughly square; ...` and `// WP37 switches this to summary_large_image ...` and `twitter: { card: "summary" },` with:

```ts
    // The share image (opengraph-image.tsx, WP37) is 1200 x 630.
    twitter: { card: "summary_large_image" },
```

### Step 16. `frontend/app/sitemap.ts`

16a. Imports: add `getCachedSetDirectory` to the `./lib/serverMarketData` import and `import { buildSetCatalog, setSitemapRows } from "./lib/setHubs";`.

16b. In `STATIC_ROUTES` replace `{ path: "/analytics", changeFrequency: "daily", priority: 0.6 },` with `{ path: "/sets", changeFrequency: "daily", priority: 0.7 },`. Update the comment above the array: "/stats and /analytics redirect to /sets;".

16c. In `sitemap()`, replace `const products = await getCachedMarketProductSummaries();` with:

```ts
  const [products, directory] = await Promise.all([
    getCachedMarketProductSummaries(),
    getCachedSetDirectory(),
  ]);
  // Thrown on purpose, like a failed summaries read: Next keeps serving the
  // previous sitemap instead of caching one without the set hubs.
  if (directory === null) throw new Error("sitemap: set directory unavailable");
```

and directly before the final `return`:

```ts
  // Indexable set hubs only (3+ priced products, WP37); lastModified is the
  // newest price_recorded_at among the set's products.
  const setEntries: MetadataRoute.Sitemap = setSitemapRows(buildSetCatalog(directory, products)).map((row) => ({
    url: absoluteUrl(row.path),
    lastModified: toDate(row.lastModified),
    changeFrequency: "daily" as const,
    priority: 0.6,
  }));
```

Return `[...staticEntries, ...setEntries, ...productEntries]`.

### Step 17. Share images

17a. Fonts. From the repo root:

```bash
mkdir -p frontend/assets/og && cd "$(mktemp -d)" && npm pack geist@1.7.2 >/dev/null && tar xzf geist-1.7.2.tgz
cp package/dist/fonts/geist-sans/Geist-Regular.ttf package/dist/fonts/geist-sans/Geist-SemiBold.ttf package/LICENSE.txt "$OLDPWD/frontend/assets/og/"
cd "$OLDPWD" && mv frontend/assets/og/LICENSE.txt frontend/assets/og/OFL.txt
sha256sum frontend/assets/og/*.ttf
# expect
# 5c8968eafb98a4c4f47033daf29e38e284a6f2a82eb017d171ab040fe7c4b615  frontend/assets/og/Geist-Regular.ttf
# 612ec98df33935354f39e81e54101656961ab6e5549f64b63eb57868ba7bab8d  frontend/assets/og/Geist-SemiBold.ttf
du -cb frontend/assets/og/*.ttf | tail -1      # 253920 (under ImageResponse's 500 kB limit)
```

If `geist@1.7.2` is unavailable, take the same two files from the newest `geist` 1.x release and record its version and hashes in the PR. Do not use variable fonts (`Geist[wght].ttf`): Satori needs static TTF or OTF files.

17b. `frontend/app/lib/ogTheme.ts` (new):

```ts
/**
 * Colours for the share images (WP37). Satori cannot read CSS variables, so
 * these copy globals.css tokens; app/lib/__tests__/ogTheme.test.ts fails when
 * a token changes and this file does not. The only raw hex colours WP37 adds
 * (uiConventions baseline: this file).
 */
export const OG_COLORS = {
  ink: "#0f172a",
  inkSoft: "#475569",
  border: "#e2e8f0",
  page: "#f8fafc",
  surface: "#ffffff",
  accent: "#dc2626",
  chartLine: "#1d4ed8",
  gainText: "#047857",
  lossText: "#be123c",
} as const;

/** The globals.css custom property each colour copies. */
export const OG_COLOR_TOKENS: Readonly<Record<keyof typeof OG_COLORS, string>> = {
  ink: "--pf-ink",
  inkSoft: "--pf-ink-soft",
  border: "--pf-border",
  page: "--pf-bg",
  surface: "--pf-surface",
  accent: "--pf-accent",
  chartLine: "--pf-chart-line",
  gainText: "--pf-gain-text",
  lossText: "--pf-loss-text",
};
```

17c. `frontend/app/lib/ogPhoto.ts` (new):

```ts
/**
 * Which product photos a share card may embed (WP37). Satori, the renderer
 * behind next/og in Next 16.3, decodes PNG, APNG, JPEG, GIF and SVG and throws
 * on WebP and AVIF (checked by scripts/og-formats.test.mjs). Product originals
 * keep the format the scraper detected and thumbnails are always WebP, so a
 * photo is used only when its bytes are PNG or JPEG; otherwise the card uses
 * its no-photo layout. Pure: the fetch lives in components/og/ogAssets.ts.
 */
export const OG_PHOTO_MAX_BYTES = 1_500_000;
export const OG_PHOTO_TIMEOUT_MS = 3_000;

export type OgPhotoType = "image/png" | "image/jpeg";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/** The image type from its first bytes; null for WebP, AVIF, GIF and anything else. */
export function sniffOgPhotoType(bytes: Uint8Array): OgPhotoType | null {
  const starts = (signature: readonly number[]) =>
    bytes.length >= signature.length && signature.every((value, i) => bytes[i] === value);
  if (starts(PNG_SIGNATURE)) return "image/png";
  if (starts(JPEG_SIGNATURE)) return "image/jpeg";
  return null;
}

/** https URLs on the hosts next.config.ts already allows for product images. */
export function isAllowedOgPhotoUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return host.endsWith(".supabase.co") || host === "tcgplayer.com" || host.endsWith(".tcgplayer.com");
}
```

17d. `frontend/app/lib/shareCard.ts` (new):

```ts
/**
 * Share card content (WP37): what the product and set Open Graph images say,
 * decided here so it can be tested without rendering an image. The renderers
 * (app/components/og/ShareCards.tsx) only lay it out.
 *
 * Rules (research/trust-seo-brand.md §11.8): every card states the day it
 * describes, because X, Discord, iMessage and Reddit cache a card per URL for
 * days; a withheld price (migration 0023) shows "No current price" and when it
 * was last priced, never the old number.
 */
import {
  changeDirection,
  formatDateOnly,
  formatInteger,
  formatMoney,
  formatPercent,
  type ChangeDirection,
} from "./format";
import { decodeSparkline, SPARKLINE_MAX_LEVEL } from "./sparkline";

export const SHARE_SITE = "pokefin.ca";
export const SHARE_TITLE_MAX_CHARS = 64;
/** Pixel box of the 90-day line on the product card. */
export const SHARE_SPARKLINE = { width: 600, height: 96, pad: 6 } as const;
export const SHARE_SET_PHOTO_COUNT = 3;
/** Photos the set card fetches at most (in parallel); WebP originals fall out, so it tries a few more than it shows. */
export const SHARE_SET_PHOTO_TRIES = 6;

export interface ShareChange {
  value: number;
  direction: ChangeDirection;
  /** Unsigned, the glyph carries the direction: "4.2% 30D". */
  text: string;
}

export interface ShareSparkline {
  path: string;
  width: number;
  height: number;
}

export interface ProductShareModel {
  title: string;
  context: string | null;
  /** "C$82.10", "$59.99 USD", or "No current price". */
  headline: string;
  /** "$59.99 USD" beside a CAD headline; "Last priced Sep 12, 2026"; "Not priced yet"; or null. */
  secondary: string | null;
  change: ShareChange | null;
  sparkline: ShareSparkline | null;
  /** The dated source line: "TCGplayer Market Price for Sep 29, 2026 · pokefin.ca". */
  footer: string;
  withheld: boolean;
}

export interface ProductShareInput {
  /** getProductDisplayName(product). */
  title: string;
  /** "Evolving Skies · Sword & Shield"; null when unknown. */
  context: string | null;
  /** WP31 QuoteModel.state. */
  state: "fresh" | "aging" | "withheld" | "never";
  /** UTC day of the price (QuoteModel.priceDay). */
  priceDay: string | null;
  usd: number | null;
  /** CAD at the quote's Bank of Canada rate (QuoteModel.price.cad); null without a rate. */
  cad: number | null;
  /** 30-day change in USD Market Price terms (QuoteModel.changes.usd["30D"]). */
  change30dUsd: number | null;
  /** 30-day change in CAD at each day's Bank of Canada rate (QuoteModel.changes.cad?.["30D"]). */
  change30dCad: number | null;
  /** WP26 encoded series for 3M (90 days); null or undefined for none. */
  series: string | null | undefined;
  /** Today, YYYY-MM-DD (UTC). */
  today: string;
}

export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function shareChange(value: number | null | undefined, suffix: string): ShareChange | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return { value, direction: changeDirection(value), text: `${formatPercent(Math.abs(value))} ${suffix}` };
}

/** Absolute pixel path for Satori, which has no vector-effect: x spans the box, y maps level 0..63. */
export function sparklinePixelPath(levels: readonly number[], width: number, height: number, pad: number): string | null {
  if (levels.length < 2) return null;
  const stepX = (width - 2 * pad) / (levels.length - 1);
  const span = height - 2 * pad;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return levels
    .map((level, i) => {
      const x = r1(pad + i * stepX);
      const y = r1(pad + ((SPARKLINE_MAX_LEVEL - level) / SPARKLINE_MAX_LEVEL) * span);
      return `${i === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
}

function shareSparkline(series: string | null | undefined): ShareSparkline | null {
  if (!series) return null;
  const levels = decodeSparkline(series);
  if (!levels) return null;
  const { width, height, pad } = SHARE_SPARKLINE;
  const path = sparklinePixelPath(levels, width, height, pad);
  return path ? { path, width, height } : null;
}

export function buildProductShareModel(input: ProductShareInput): ProductShareModel {
  const title = truncateText(input.title, SHARE_TITLE_MAX_CHARS);
  const priced =
    (input.state === "fresh" || input.state === "aging") &&
    typeof input.usd === "number" &&
    Number.isFinite(input.usd) &&
    input.priceDay !== null;

  if (!priced) {
    return {
      title,
      context: input.context,
      headline: "No current price",
      secondary: input.priceDay ? `Last priced ${formatDateOnly(input.priceDay)}` : "Not priced yet",
      change: null,
      sparkline: null,
      footer: `As of ${formatDateOnly(input.today)} · ${SHARE_SITE}`,
      withheld: true,
    };
  }

  const usdText = `${formatMoney(input.usd, "USD")} USD`;
  const hasCad = typeof input.cad === "number" && Number.isFinite(input.cad);
  // The change matches the headline currency (WP31 decision 3). A CAD
  // headline without a CAD return says its change is in USD terms.
  const cadChange = hasCad ? shareChange(input.change30dCad, "30D") : null;
  const change = cadChange ?? shareChange(input.change30dUsd, hasCad ? "30D in USD" : "30D");
  return {
    title,
    context: input.context,
    headline: hasCad ? formatMoney(input.cad, "CAD") : usdText,
    secondary: hasCad ? usdText : null,
    change,
    sparkline: shareSparkline(input.series),
    footer: `TCGplayer Market Price for ${formatDateOnly(input.priceDay)} · ${SHARE_SITE}`,
    withheld: false,
  };
}

export interface SetShareModel {
  title: string;
  context: string | null;
  /** "9 tracked sealed products" (", 7 priced" when some are withheld). */
  stat: string;
  /** Median 1-year change across priced products (get_set_analytics). */
  change: ShareChange | null;
  footer: string;
  /** Up to SHARE_SET_PHOTO_COUNT photo URLs, priced products first by price. */
  photoUrls: string[];
}

export interface SetShareInput {
  name: string;
  generation: string | null;
  releaseDate: string | null;
  productCount: number;
  pricedCount: number;
  median1y: number | null;
  newestPriceDay: string | null;
  today: string;
  photoUrls: readonly string[];
}

export function buildSetShareModel(input: SetShareInput): SetShareModel {
  const context = [input.generation, input.releaseDate ? `Released ${formatDateOnly(input.releaseDate)}` : null]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  const products = `${formatInteger(input.productCount)} tracked sealed ${input.productCount === 1 ? "product" : "products"}`;
  const stat = input.pricedCount < input.productCount ? `${products}, ${formatInteger(input.pricedCount)} priced` : products;
  const priced = input.pricedCount > 0 && input.newestPriceDay !== null;
  return {
    title: truncateText(input.name, SHARE_TITLE_MAX_CHARS),
    context: context || null,
    stat,
    change: priced ? shareChange(input.median1y, "median 1Y") : null,
    footer: priced
      ? `TCGplayer Market Prices as of ${formatDateOnly(input.newestPriceDay)} · ${SHARE_SITE}`
      : `No current prices · As of ${formatDateOnly(input.today)} · ${SHARE_SITE}`,
    photoUrls: input.photoUrls.slice(0, SHARE_SET_PHOTO_COUNT),
  };
}
```

17e. `frontend/app/components/og/ogAssets.ts` (new, server only):

```ts
import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isAllowedOgPhotoUrl, OG_PHOTO_MAX_BYTES, OG_PHOTO_TIMEOUT_MS, sniffOgPhotoType } from "../../lib/ogPhoto";

/**
 * Fonts and photos for the share images (WP37). Server only.
 *
 * Fonts: Geist Regular and SemiBold (SIL OFL, frontend/assets/og/OFL.txt),
 * read once per server instance. The literal paths let Next's file tracing
 * include them in the function bundle (Verification checks the .nft.json).
 * Together about 254 kB, under ImageResponse's 500 kB bundle limit.
 */
export interface OgFont {
  name: string;
  data: Buffer;
  weight: 400 | 600;
  style: "normal";
}

let fontsPromise: Promise<OgFont[]> | null = null;

export function loadOgFonts(): Promise<OgFont[]> {
  fontsPromise ??= Promise.all([
    readFile(join(process.cwd(), "assets/og/Geist-Regular.ttf")),
    readFile(join(process.cwd(), "assets/og/Geist-SemiBold.ttf")),
  ]).then(([regular, semibold]) => [
    { name: "Geist", data: regular, weight: 400, style: "normal" },
    { name: "Geist", data: semibold, weight: 600, style: "normal" },
  ]);
  fontsPromise.catch(() => {
    fontsPromise = null;
  });
  return fontsPromise;
}

/**
 * A product photo as a data URL Satori can decode, or null for the no-photo
 * layout: a host outside next.config.ts's image hosts, a fetch failure or
 * timeout, more than OG_PHOTO_MAX_BYTES, or any format but PNG and JPEG
 * (Satori throws on WebP). Never throws.
 */
export async function loadOgPhoto(url: string | null | undefined): Promise<string | null> {
  if (!url || !isAllowedOgPhotoUrl(url)) return null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(OG_PHOTO_TIMEOUT_MS),
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > OG_PHOTO_MAX_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > OG_PHOTO_MAX_BYTES) return null;
    const type = sniffOgPhotoType(bytes);
    return type ? `data:${type};base64,${Buffer.from(bytes).toString("base64")}` : null;
  } catch {
    return null;
  }
}
```

17f. `frontend/app/components/og/ShareCards.tsx` (new):

```tsx
import type { ReactNode } from "react";
import { OG_COLORS } from "../../lib/ogTheme";
import type { ProductShareModel, SetShareModel, ShareChange } from "../../lib/shareCard";
import { MARK_GLYPH_PATH, MARK_TILE_RADIUS } from "../brand/PokefinMark";

/*
 * Share image layouts (WP37), rendered by next/og (Satori) at 1200 x 630.
 * Satori rules: inline styles only, flexbox only, every element with more
 * than one child sets display: "flex", fonts come from the ImageResponse
 * options (Geist 400 and 600). The direction glyph is an SVG triangle: the
 * fonts have no ▲ ▼ and a missing glyph would make Satori fetch a fallback
 * font at render time.
 */

export const SHARE_SIZE = { width: 1200, height: 630 } as const;

function Glyph({ direction, color }: { direction: ShareChange["direction"]; color: string }) {
  if (direction === "flat") return null;
  return (
    <svg width="26" height="22" viewBox="0 0 12 10">
      <path d={direction === "up" ? "M0 10 L6 0 L12 10 Z" : "M0 0 L12 0 L6 10 Z"} fill={color} />
    </svg>
  );
}

function ChangeLine({ change, fontSize }: { change: ShareChange; fontSize: number }) {
  const color = change.direction === "up" ? OG_COLORS.gainText : change.direction === "down" ? OG_COLORS.lossText : OG_COLORS.inkSoft;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize, color, fontWeight: 600 }}>
      <Glyph direction={change.direction} color={color} />
      <div style={{ display: "flex" }}>{change.text}</div>
    </div>
  );
}

function Mark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <svg width="44" height="44" viewBox="0 0 32 32">
        <rect width="32" height="32" rx={MARK_TILE_RADIUS} fill={OG_COLORS.accent} />
        {/* evenodd, as in PokefinMark: the square counter of the "P" is a hole. */}
        <path d={MARK_GLYPH_PATH} fillRule="evenodd" fill={OG_COLORS.surface} />
      </svg>
      <div style={{ display: "flex", fontSize: 34, fontWeight: 600, color: OG_COLORS.ink }}>
        <span>Pok</span>
        <span style={{ color: OG_COLORS.accent }}>{"é"}</span>
        <span>fin</span>
      </div>
    </div>
  );
}

function Frame({ children, footer }: { children: ReactNode; footer: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: OG_COLORS.page,
        color: OG_COLORS.ink,
        fontFamily: "Geist",
        padding: "48px 56px 40px",
      }}
    >
      <div style={{ display: "flex", flex: 1, gap: 48, alignItems: "center" }}>{children}</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: `2px solid ${OG_COLORS.border}`,
          paddingTop: 24,
        }}
      >
        <div style={{ display: "flex", fontSize: 26, color: OG_COLORS.inkSoft }}>{footer}</div>
        <Mark />
      </div>
    </div>
  );
}

function Photo({ src, size }: { src: string; size: number }) {
  return (
    <div
      style={{
        display: "flex",
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        background: OG_COLORS.surface,
        border: `2px solid ${OG_COLORS.border}`,
        borderRadius: 24,
        padding: 20,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders <img>, not next/image */}
      <img src={src} width={size - 44} height={size - 44} style={{ objectFit: "contain" }} alt="" />
    </div>
  );
}

export function ProductShareCard({ model, photo }: { model: ProductShareModel; photo: string | null }) {
  return (
    <Frame footer={model.footer}>
      {photo && <Photo src={photo} size={360} />}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        {model.context && (
          <div style={{ display: "flex", fontSize: 26, color: OG_COLORS.inkSoft }}>{model.context}</div>
        )}
        <div
          style={{
            display: "block",
            fontSize: photo ? 44 : 54,
            fontWeight: 600,
            lineHeight: 1.15,
            marginTop: 8,
            lineClamp: 2,
          }}
        >
          {model.title}
        </div>
        {model.withheld ? (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 28 }}>
            <div style={{ display: "flex", fontSize: 56, fontWeight: 600 }}>{model.headline}</div>
            {model.secondary && (
              <div style={{ display: "flex", fontSize: 30, color: OG_COLORS.inkSoft, marginTop: 8 }}>{model.secondary}</div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "baseline", gap: 20, marginTop: 24 }}>
            <div style={{ display: "flex", fontSize: 72, fontWeight: 600 }}>{model.headline}</div>
            {model.secondary && (
              <div style={{ display: "flex", fontSize: 30, color: OG_COLORS.inkSoft }}>{model.secondary}</div>
            )}
          </div>
        )}
        {(model.change || model.sparkline) && (
          <div style={{ display: "flex", alignItems: "center", gap: 24, marginTop: 16 }}>
            {model.change && <ChangeLine change={model.change} fontSize={32} />}
            {model.sparkline && (
              <div style={{ display: "flex", fontSize: 22, color: OG_COLORS.inkSoft }}>Last 90 days</div>
            )}
          </div>
        )}
        {model.sparkline && (
          <div style={{ display: "flex", marginTop: 12 }}>
            <svg
              width={model.sparkline.width}
              height={model.sparkline.height}
              viewBox={`0 0 ${model.sparkline.width} ${model.sparkline.height}`}
            >
              <path
                d={model.sparkline.path}
                fill="none"
                stroke={OG_COLORS.chartLine}
                strokeWidth={4}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          </div>
        )}
      </div>
    </Frame>
  );
}

export function SetShareCard({ model, photos }: { model: SetShareModel; photos: string[] }) {
  return (
    <Frame footer={model.footer}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        {model.context && <div style={{ display: "flex", fontSize: 26, color: OG_COLORS.inkSoft }}>{model.context}</div>}
        <div style={{ display: "block", fontSize: 64, fontWeight: 600, lineHeight: 1.1, marginTop: 10, lineClamp: 2 }}>
          {model.title}
        </div>
        <div style={{ display: "flex", fontSize: 30, marginTop: 20 }}>{model.stat}</div>
        {model.change && (
          <div style={{ display: "flex", marginTop: 14 }}>
            <ChangeLine change={model.change} fontSize={36} />
          </div>
        )}
      </div>
      {photos.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {photos.map((src, i) => (
            <Photo key={i} src={src} size={photos.length === 1 ? 300 : photos.length === 2 ? 210 : 140} />
          ))}
        </div>
      )}
    </Frame>
  );
}
```

The product layout above was rendered with `next/og` while writing this spec at 1200 x 630 for four cases (fresh with photo, fresh without photo, withheld, a 100-character title with a four-digit price): nothing overflows, titles clamp at 2 lines with an ellipsis, and each PNG is 60 to 80 kB. Keep the sizes as written.

17g. `frontend/app/product/[id]/opengraph-image.tsx` (new):

```tsx
import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { loadOgFonts, loadOgPhoto } from "../../components/og/ogAssets";
import { ProductShareCard, SHARE_SIZE } from "../../components/og/ShareCards";
import { toDailyPoints } from "../../lib/marketMath";
import { statsFor } from "../../lib/marketStats";
import {
  getCachedExchangeRate,
  getCachedFxDaily,
  getCachedProductDetail,
  getCachedProductStats,
  getCachedSparklines,
} from "../../lib/serverMarketData";
import { buildProductShareModel } from "../../lib/shareCard";
import { sparklineFor } from "../../lib/sparkline";
import { buildQuote, todayUtcKey } from "./productModel";
import { getProductDisplayName, parseProductId } from "./productMeta";

/*
 * Product share image (WP37, research/trust-seo-brand.md §11.8). Same cached
 * reads and the same quote as the page (WP31 buildQuote), so the card can
 * never show a price the page withholds. ISR: rendered on the first crawler
 * fetch and again after each scrape revalidation, daily at the latest.
 */
// Static, so it describes the card without a number: a withheld product's
// card has no price, change or line (the alt must never claim one).
export const alt = "Pokéfin share card: this product's TCGplayer Market Price status and the day it describes";
export const size = SHARE_SIZE;
export const contentType = "image/png";
// ISR like the page (WP11, WP26 route pattern): rendered on the first
// request, cached, and regenerated when the scraper revalidates the
// market-products tag or after a day. Next re-exports these into the
// generated image route.
export const dynamic = "force-static";
export const revalidate = 86400;
export async function generateStaticParams() {
  return [];
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const productId = parseProductId(id);
  if (productId === null) notFound();

  const [detail, statsSnapshot, fx, latestRate, sparklines, fonts] = await Promise.all([
    getCachedProductDetail(productId),
    getCachedProductStats(),
    getCachedFxDaily(),
    getCachedExchangeRate(),
    getCachedSparklines("3M"),
    loadOgFonts(),
  ]);
  if (!detail) notFound();

  const { product } = detail;
  const today = todayUtcKey();
  const quote = buildQuote({
    product,
    stats: statsFor(statsSnapshot, productId),
    points: toDailyPoints(detail.history),
    listings: detail.listings ?? null,
    fx,
    latestRate,
    today,
  });
  const context = [product.sets?.name, product.sets?.generations?.name].filter(Boolean).join(" · ") || null;
  const model = buildProductShareModel({
    title: getProductDisplayName(product),
    context,
    state: quote.state,
    priceDay: quote.priceDay,
    usd: quote.price?.usd ?? null,
    cad: quote.price?.cad ?? null,
    change30dUsd: quote.changes?.usd["30D"] ?? null,
    change30dCad: quote.changes?.cad?.["30D"] ?? null,
    series: sparklineFor(sparklines, productId),
    today,
  });
  const photo = await loadOgPhoto(product.image_url);
  return new ImageResponse(<ProductShareCard model={model} photo={photo} />, { ...size, fonts });
}
```

It reads the same cached data and the same `buildQuote` as the page (WP31), so the card can never show a price the page withholds.

17h. `frontend/app/sets/[slug]/opengraph-image.tsx` (new):

```tsx
import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { loadOgFonts, loadOgPhoto } from "../../components/og/ogAssets";
import { SetShareCard, SHARE_SIZE } from "../../components/og/ShareCards";
import { utcTodayKey } from "../../lib/marketIndex";
import { loadSetHub } from "../../lib/setHubsData";
import { buildSetShareModel, SHARE_SET_PHOTO_COUNT, SHARE_SET_PHOTO_TRIES } from "../../lib/shareCard";

/*
 * Set share image (WP37): set name, era, release date, tracked products, the
 * median 1-year change and up to three product photos (PNG or JPEG only).
 * Dated by the newest TCGplayer price day in the set.
 */
export const alt = "Pokéfin share card: a Pokémon TCG set's sealed products and their median 1-year change";
export const size = SHARE_SIZE;
export const contentType = "image/png";
// ISR like the page (WP11, WP26 route pattern): rendered on the first
// request, cached, and regenerated when the scraper revalidates the
// market-products tag or after a day. Next re-exports these into the
// generated image route.
export const dynamic = "force-static";
export const revalidate = 86400;
export async function generateStaticParams() {
  return [];
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [result, fonts] = await Promise.all([loadSetHub(slug), loadOgFonts()]);
  if (result.kind !== "found") notFound();
  const { hub, rows } = result.data;

  const candidates = rows
    .filter((row) => row.usdPrice !== null && row.imageUrl)
    .map((row) => row.imageUrl as string);
  // At most SHARE_SET_PHOTO_TRIES photos, fetched in parallel: one 3 s
  // timeout bounds the render. A sequential loop over every priced product
  // could wait 27 x 3 s when the originals are WebP and past the function limit.
  const tried = await Promise.all(candidates.slice(0, SHARE_SET_PHOTO_TRIES).map((url) => loadOgPhoto(url)));
  const photos = tried.filter((photo): photo is string => photo !== null).slice(0, SHARE_SET_PHOTO_COUNT);

  const model = buildSetShareModel({
    name: hub.name,
    generation: hub.generation,
    releaseDate: hub.releaseDate,
    productCount: hub.productCount,
    pricedCount: hub.pricedCount,
    median1y: hub.analytics?.median365 ?? null,
    newestPriceDay: hub.newestPriceDay,
    today: utcTodayKey(),
    photoUrls: candidates,
  });
  return new ImageResponse(<SetShareCard model={model} photos={photos} />, { ...size, fonts });
}
```

17i. File tracing. `readFile(join(process.cwd(), "assets/og/..."))` with literal paths is the pattern Next documents for local assets in image routes, and its file tracing includes them. Verification step 6 checks the traced files. Only if that check finds no `Geist-Regular.ttf` in the image routes' `.nft.json`, add to `nextConfig` in `next.config.ts`:

```ts
  // WP37: the share-image fonts are read at runtime from assets/og.
  outputFileTracingIncludes: {
    "/product/[id]/opengraph-image": ["./assets/og/**"],
    "/sets/[slug]/opengraph-image": ["./assets/og/**"],
  },
```

17j. `frontend/scripts/og-formats.test.mjs` (new; runs with `pnpm run test:scripts`): records the spike, so a Next upgrade that starts decoding WebP is noticed.

```js
// WP37: which photo formats next/og (Satori) decodes in this Next version.
// lib/ogPhoto.ts embeds a product photo only when it is PNG or JPEG, because
// WebP threw when WP37 was written. If the WebP case starts to pass after a
// Next upgrade, this test fails: allow image/webp in sniffOgPhotoType (and
// its test) so share cards can use the WebP thumbnails, then update this test.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { ImageResponse } from "next/og.js";

// 1x1 images.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const WEBP = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

async function render(mime, base64) {
  const element = h(
    "div",
    { style: { display: "flex", width: "100%", height: "100%" } },
    h("img", { src: `data:${mime};base64,${base64}`, width: 10, height: 10 })
  );
  const res = new ImageResponse(element, { width: 40, height: 40 });
  return Buffer.from(await res.arrayBuffer());
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test("PNG and JPEG photos render", async () => {
  for (const [mime, data] of [["image/png", PNG], ["image/jpeg", JPEG]]) {
    const out = await render(mime, data);
    assert.ok(out.subarray(0, 4).equals(PNG_SIGNATURE), `${mime} did not render a PNG`);
  }
});

test("WebP photos still fail, so share cards must not embed them", async () => {
  await assert.rejects(render("image/webp", WEBP));
});
```

### Step 18. Performance budgets, fixture and production checks

18a. `frontend/scripts/fixtures/perf.mjs` (WP22):
- Add above `buildPerfData`:

```js
/**
 * WP37: the URL slug of a fixture set name. Fixture names are ASCII words, so
 * pokefin_slugify (migration 0041) reduces to this; perf-fixture.test.mjs
 * checks it on the shared ASCII anchors.
 */
export function fixtureSetSlug(name) {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}
```

- In `buildPerfData`, directly above the final `return { ... };` (after every other table, so no earlier random draw changes):

```js
  // WP37: public.sets as the set hubs read it (no random draws). The oldest
  // set's stored slug carries its id, as 0041 gives a duplicate name, so its
  // name-derived URL exercises the set page's 308 (Verification step 6).
  const setRows = sets.map((set, i) => ({
    id: set.id,
    slug: i === sets.length - 1 ? `${fixtureSetSlug(set.name)}-${set.id}` : fixtureSetSlug(set.name),
    name: set.name,
    code: set.code,
    release_date: set.release_date,
    expansion_type: set.expansion_type,
    generation_id: set.generation.id,
  }));
```

  and add `setRows` to the returned object.
- In `perfRoutes()`, add `"/rest/v1/sets": rows("setRows"),` below the last `"/rest/v1/..."` entry. `/rest/v1/product_daily_stats` already exists (WP32); the median line's `in`, `gte` and two-key `order` are supported by `applyPostgrest`.
- Find the fixture set page used by the budgets (the set of product 900001):

```bash
cd frontend && node --input-type=module -e 'import("./scripts/fixtures/perf.mjs").then((m) => { const d = m.buildPerfData({ baseUrl: "http://127.0.0.1:3100" }); const s = d.summaries.find((r) => r.id === 900001); console.log(d.setRows.find((r) => r.id === s.set_id).slug); })'
# expect: journey-prism-storm   (set 9111; computed from WP22's fixture while writing this spec)
```

  Use the printed slug wherever this spec writes `journey-prism-storm`.

18b. `frontend/perf-budgets.json`, `routes`: delete the `"/analytics"` entry and add (a new route is not a raise; the deletion is, see step 18h):

```json
    "/sets": {
      "source": "html",
      "jsGzKb": { "target": 150, "limit": null, "recorded": null },
      "documentBrKb": { "target": 40, "limit": null, "recorded": null }
    },
    "/sets/journey-prism-storm": {
      "source": "html",
      "label": "/sets/[slug]",
      "jsGzKb": { "target": 150, "limit": null, "recorded": null },
      "documentBrKb": { "target": 30, "limit": null, "recorded": null }
    },
```

18c. Same file, `rum.targets`: rename the key `"/analytics"` to `"/sets"` and set its values to `{ "lcpMs": 1800, "inpMs": 150, "cls": 0.05, "ttfbMs": 600 }`; add `"/sets/[slug]": { "lcpMs": 1800, "inpMs": 150, "cls": 0.05, "ttfbMs": 900 }`.

18d. Same file, `forbiddenChunks` (soft check (f)): add `"/sets"` and `"/sets/journey-prism-storm"` to the `routes` of `"supabase-js"` and of `"recharts"`. If there is no `"recharts"` rule, add it exactly as WP29 step 21c wrote it, with these two routes.

18e. `frontend/eslint.config.mjs` (soft check (g)): append to `PUBLIC_ROUTE_CLIENT_FILES`:

```js
  "app/sets/**/*.{ts,tsx}",
  "app/lib/setHubs.ts",
  "app/lib/riskReturnChart.ts",
  "app/lib/taxonomySlug.ts",
  "app/lib/shareCard.ts",
```

`page.tsx` files reach `serverMarketData` through `setHubsData.ts`, which the rule allows (it bans only the browser Supabase modules).

18f. `frontend/scripts/prod-smoke-lib.mjs`:
- In `PUBLIC_CHECKS`, replace the `/analytics` entry, whatever its fields (WP22 step 25 may have set `minPrices: 0` and added `minReturns`), with `{ path: "/sets", minPrices: 0, minReturns: 10 }` when `judgePage` supports `minReturns` (`grep -n "minReturns" scripts/prod-smoke-lib.mjs`), else `{ path: "/sets", minPrices: 0 }`. The sets table shows medians and counts, not prices; the set page check below counts prices.
- Append to `REDIRECT_CHECKS` (WP33; soft check (e)): `{ from: "/analytics", to: "/sets" }, { from: "/stats", to: "/sets" }`.
- Append:

```js
// WP37: a set page renders prices; its path is the first set link on /sets.
export const SET_PAGE_MIN_PRICES = 1;

export function firstSetPath(html) {
  const slug = /href="\/sets\/([a-z0-9]+(?:-[a-z0-9]+)*)"/.exec(html ?? "")?.[1];
  return slug ? `/sets/${slug}` : null;
}
```

  `frontend/scripts/prod-smoke.mjs`, in `runChecks`: declare `let setsHtml = "";` next to `let pricesHtml = "";`; inside the `PUBLIC_CHECKS` loop's callback add `if (check.path === "/sets") setsHtml = seen.html;` next to the `/prices` line; after the product page check add:

```js
    const setPagePath = lib.firstSetPath(setsHtml);
    result.checks.push(
      setPagePath
        ? await withRetry(setPagePath, async () =>
            lib.judgePage({ path: setPagePath, minPrices: lib.SET_PAGE_MIN_PRICES, ...(await visit(page, ORIGIN + setPagePath)) })
          )
        : { name: "/sets/<slug>", ok: false, detail: "no /sets/<slug> link on /sets" }
    );
```

18g. `frontend/scripts/prod-confirm.mjs`: after `const productId = ...;` add

```js
  const setsHtml = await (await fetch(`${ORIGIN}/sets`)).text();
  const setSlug = /href="\/sets\/([a-z0-9]+(?:-[a-z0-9]+)*)"/.exec(setsHtml)?.[1] ?? null;
```

and replace the `const route = ...` line in the routes loop with

```js
    const route = budgetRoute.startsWith("/product/")
      ? productId ? `/product/${productId}` : null
      : budgetRoute.startsWith("/sets/")
        ? setSlug ? `/sets/${setSlug}` : null
        : budgetRoute;
```

and the warning text in the `if (!route)` branch with ``warnings.push(`no matching link found on production for ${budgetRoute}; skipped`);``.

18h. Limits. Build and measure (Verification step 7) with `pnpm perf:budget` (it reports the two new routes as `unset`). Do not run `--write-limits` (it rewrites limits of routes this package does not own). For each of the four new slots set `limit = min(target, ceil(measured x 1.05))` (or `ceil(measured x 1.05)` when measured is above target) and `recorded = measured` by hand, WP22's formula, then run `pnpm perf:budget` again: every row `ok` or `over target`. Write in the PR body one line per removed key, for example `Perf budget raise: routes./analytics.jsGzKb route moved to /sets (308); budgeted as routes./sets.jsGzKb` (and the same for every other `routes./analytics.*` key the base branch has). Never raise a `target`.

### Step 19. Conventions tests

19a. `frontend/app/__tests__/uiConventions.test.ts` (WP23, WP24): the WP24 case "every /stats header except Set is a MetricLabel" reads a file this package deletes. Replace that `it(...)` with:

```ts
  it("every /sets column header is a MetricLabel with a defined key", () => {
    const table = fs.readFileSync(path.join(APP, "sets/SetsTable.tsx"), "utf8");
    expect(table).toMatch(/<SortHeader[\s\S]*?<MetricLabel metric=\{column\.metric\} \/>/);
    for (const column of Object.values(SETS_COLUMNS)) expect(isMetricKey(column.metric)).toBe(true);
  });
```

with `import { SETS_COLUMNS } from "../sets/setsState";` at the top (`isMetricKey`, `fs`, `path` and `APP` are already imported by WP24).

19b. Hex ratchet: `app/lib/ogTheme.ts` holds 9 hex literals (Satori cannot read CSS variables). Run

```bash
cd frontend
pnpm exec jest app/__tests__/uiConventions.test.ts          # may fail only with "< baseline; lower the baseline" and "lib/ogTheme.ts: 9 > baseline 0"
UPDATE_UI_BASELINE=1 pnpm exec jest app/__tests__/uiConventions.test.ts
git diff app/__tests__/uiConventions.baseline.json          # every changed count goes DOWN; the only new entry is "lib/ogTheme.ts": 9 under "hex"
```

The PR states the one allowed raise: "hex ratchet: lib/ogTheme.ts 9, share images are rendered by Satori, which takes literal colours; ogTheme.test.ts ties each to its globals.css token". Any other raise: fix the file.

### Step 20. Documentation

- `README.md` (repo root), pages list: replace `/stats` and `/analytics` with `/sets` (every set on one table, presets, risk and return chart; `/stats` and `/analytics` redirect) and `/sets/[slug]` (a set's products, index or median line, summary); mention the product and set share images. In the migrations section add one line for `0041_taxonomy_slugs.sql`: "URL slugs for sets, product types and generations; a missing slug is filled on insert; renaming never changes a slug; to move a URL, update `slug` by hand (the old name-derived URL keeps redirecting)."
- `frontend/README.md`, the perf budgets section: list `/sets` and `/sets/[slug]`.

### Step 21. Phase B: generated types

After the owner has applied 0041 (Owner action 2):

```bash
cd frontend
SUPABASE_ACCESS_TOKEN=... pnpm types:db          # or use the file the owner pushed
grep -c "slug: string" app/types/database.ts      # 3 or more (Row types of sets, product_types, generations)
pnpm exec tsc --noEmit                            # exit 0
```

Do not edit the generated file. Remove `[waiting for DB types]` from the PR title.

## Pitfalls: do not do this

- **Do not derive slugs in TypeScript for links you can resolve from the directory.** Stored slugs win (a duplicate name has `-<code>`). `slugifyTaxonomyName` is only for `setSearchHref` and the name-based redirect; everywhere else use `setSlugForProduct`, `hub.slug` or `setPath(entry.slug)`.
- **Do not chain redirects.** `/stats` goes straight to `/sets`, never through `/analytics`. Do not keep `app/analytics/page.tsx` "just in case": the redirect would shadow it anyway.
- **Do not add `"use client"`, Recharts, `ChartBundle`, `PriceChart` or a client fetch to anything under `app/sets/`.** The set chart is WP29's server `IndexChart`; the scatter is server SVG. The source test and `forbiddenChunks` fail the build otherwise.
- **Do not make `/sets` static with `dynamic = "force-static"`**: Next then passes empty `searchParams` and presets and sorting stop working. Do not add a `loading.tsx` under `app/sets/` (it flashes on every sort click); only `app/sets/[slug]/loading.tsx` exists.
- **Do not call a cached read from inside another `unstable_cache` callback.** Compose in `setHubsData.ts` (WP11's rule; the cause of hundreds of extra RPC calls once).
- **Do not print a withheld price anywhere new**: not in the set table, the summary, `ItemList`, the sitemap, the share image or its `alt`. The share card shows "No current price" and "Last priced {date}"; the product card's data comes from WP31's `buildQuote`, never from `product.usd_price` directly.
- **Do not omit the date from a share card.** Every card has a dated footer, priced or not.
- **Do not embed WebP or AVIF in a share image.** Satori throws on WebP in Next 16.3 (`og-formats.test.mjs` records it); `loadOgPhoto` sniffs bytes and falls back to the no-photo layout. Do not trust the file extension or the `content-type` header.
- **Do not fetch photos from arbitrary hosts** in the image route: only https Supabase Storage and TCGplayer hosts (the `next.config.ts` image hosts), with a 3 s timeout and a 1.5 MB cap.
- **Do not set `openGraph.images` in `buildProductMetadata` or in the set page's metadata**: the file-based image is the source; Next would override a config value anyway, and the two would disagree in tests.
- **Do not put prices in `<title>` or the meta description** (they go stale in search results; `research/trust-seo-brand.md` §11.7).
- **Do not index thin hubs**: fewer than 3 priced products means `noindex, follow`, no sitemap entry, no ItemList entry, no footer link. Do not create set-by-type, type or era pages in this package.
- **Do not write summary copy by hand or with an LLM**, and do not fill a missing number with a placeholder: drop the sentence.
- **Do not edit migrations 0001 to 0040**, and do not change `get_set_analytics` or `get_market_product_summaries`: the hubs join the cached summaries and the set directory in TypeScript (`research/trust-seo-brand.md` §11.2).
- **Do not change a stored slug automatically on rename.** URL stability is the point; the name-derived redirect covers renamed sets.
- **Do not raise a perf `target`**, and do not raise or remove a budget key without a `Perf budget raise:` line (WP22 D11).
- **Do not move `MiniSparkline` or `IndexChart`** to new folders; import them where they are.

## Tests

Paths from `frontend/` unless they start with `tests/`. Jest tests marked node run with `/** @jest-environment node */`. Every listed file was type-checked against the dependency specs' signatures while writing this spec, and items 1 to 6 were also executed (against stand-ins for WP24's `metricDefinitions.ts`, which item 5's last case needs for real).

### 1. `app/lib/__tests__/taxonomySlug.test.ts` (new, node)

The anchors are shared, value for value, with `tests/test_wp37_taxonomy_slugs.py`.

```ts
/** @jest-environment node */
import { isTaxonomySlug, setPath, slugifyTaxonomyName } from "../taxonomySlug";

// Shared, value for value, with tests/test_wp37_taxonomy_slugs.py (the SQL)
// and scripts/perf-fixture.test.mjs (the fixture mirror).
const ANCHORS: Array<[string, string]> = [
  ["Prismatic Evolutions", "prismatic-evolutions"],
  ["Scarlet & Violet", "scarlet-and-violet"],
  ["Sun & Moon: Cosmic Eclipse", "sun-and-moon-cosmic-eclipse"],
  ["Champion's Path", "champions-path"],
  ["Champion’s Path", "champions-path"],
  ["Pokémon GO", "pokemon-go"],
  ["ÉVOLUTION Céleste", "evolution-celeste"],
  ["  --Hello--World--  ", "hello-world"],
  ["SV8.5", "sv8-5"],
  ["Nidoran♀ & ♂", "nidoran-and"],
  ["???", ""],
  ["x".repeat(79) + " y", "x".repeat(79)],
  ["a".repeat(90), "a".repeat(80)],
];

describe("slugifyTaxonomyName mirrors pokefin_slugify (migration 0041)", () => {
  it.each(ANCHORS)("%j -> %j", (input, expected) => {
    expect(slugifyTaxonomyName(input)).toBe(expected);
  });

  it("only produces valid slugs or the empty string", () => {
    for (const [input] of ANCHORS) {
      const slug = slugifyTaxonomyName(input);
      expect(slug === "" || isTaxonomySlug(slug)).toBe(true);
    }
  });
});

describe("isTaxonomySlug and setPath", () => {
  it("accepts the stored format and rejects anything else", () => {
    expect(isTaxonomySlug("crown-zenith-swsh12-5")).toBe(true);
    expect(isTaxonomySlug("set-42")).toBe(true);
    for (const bad of ["", "Crown-Zenith", "crown--zenith", "-crown", "crown-", "crown zenith", "a".repeat(121), 42, null]) {
      expect(isTaxonomySlug(bad)).toBe(false);
    }
  });

  it("builds the set page path", () => {
    expect(setPath("prismatic-evolutions")).toBe("/sets/prismatic-evolutions");
  });
});
```

### 2. `app/lib/__tests__/setHubs.test.ts` (new, node): directory, noindex threshold, sitemap, footer, hubs, rows, summary null-dropping, median line

```ts
/** @jest-environment node */
import type { Product } from "../../types/market";
import type { SetAnalyticsRow } from "../marketData";
import type { ProductStatsSnapshot } from "../marketStats";
import type { IndexSummary } from "../marketIndex";
import {
  buildSetCatalog,
  buildSetHubs,
  buildSetMedianLine,
  buildSetProductRows,
  buildSetSummary,
  footerSetLinks,
  MIN_PRICED_PRODUCTS_FOR_INDEXING,
  neighbourSets,
  resolveSetSlug,
  setSitemapRows,
  setSlugForProduct,
  toSetDirectory,
  type SetDailyPriceRow,
  type SetProductRow,
} from "../setHubs";

const DIRECTORY = toSetDirectory([
  { id: 1, slug: "crown-zenith", name: "Crown Zenith", code: "SWSH12.5", release_date: "2023-01-20", expansion_type: "Special Expansion", generation_id: 2 },
  { id: 2, slug: "crown-zenith-cz-gg", name: "Crown Zenith", code: "CZ-GG", release_date: "2023-01-20", expansion_type: null, generation_id: 2 },
  { id: 3, slug: "prismatic-evolutions", name: "Prismatic Evolutions", code: "SV8.5", release_date: "2025-01-17", expansion_type: null, generation_id: 1 },
  { id: 4, slug: "future-set", name: "Future Set", code: "FUT", release_date: "2099-01-01", expansion_type: null, generation_id: 1 },
  { id: 5, slug: "Not A Slug", name: "Broken", code: "B", release_date: null, expansion_type: null, generation_id: null },
]);

function product(id: number, setId: number, usd: number | null, extra: Partial<Product> & { label?: string; r30?: number | null; r1y?: number | null } = {}): Product {
  const { label = "Elite Trainer Box", r30 = null, r1y = null, ...rest } = extra;
  const set = DIRECTORY.find((entry) => entry.id === setId);
  return {
    id,
    usd_price: usd,
    url: `https://www.tcgplayer.com/product/${id}`,
    price_recorded_at: usd === null ? "2026-09-01T04:00:00" : "2026-09-30T04:00:00",
    last_updated: "2026-09-30T04:00:00",
    variant: null,
    image_url: null,
    sets: { id: setId, name: set?.name ?? "?", code: set?.code ?? "?", release_date: set?.releaseDate ?? "2025-01-01", generations: { id: 1, name: "Scarlet & Violet" } },
    product_types: { id: 1, name: label.toLowerCase().replace(/ /g, "_"), label },
    returns: { "1D": null, "7D": null, "1M": r30, "3M": null, "6M": null, "1Y": r1y },
    ...rest,
  } as Product;
}

const EMPTY_STATS: ProductStatsSnapshot = { day: null, byProductId: {} };

describe("directory and slug resolution", () => {
  it("drops rows without a valid slug or name", () => {
    expect(DIRECTORY.map((entry) => entry.id)).toEqual([1, 2, 3, 4]);
  });

  it("finds a stored slug, redirects a name-derived one, and misses the rest", () => {
    expect(resolveSetSlug(DIRECTORY, "crown-zenith-cz-gg")).toEqual({ kind: "found", entry: DIRECTORY[1] });
    expect(resolveSetSlug(DIRECTORY, "nope")).toEqual({ kind: "missing" });
    expect(resolveSetSlug(DIRECTORY, "Crown-Zenith")).toEqual({ kind: "missing" });
    const renamed = toSetDirectory([{ id: 9, slug: "old-name", name: "New Name", code: "N", release_date: null, expansion_type: null, generation_id: null }]);
    expect(resolveSetSlug(renamed, "new-name")).toEqual({ kind: "redirect", slug: "old-name" });
  });

  it("gives a product its set's stored slug, or null", () => {
    expect(setSlugForProduct(DIRECTORY, product(1, 2, 10))).toBe("crown-zenith-cz-gg");
    expect(setSlugForProduct(DIRECTORY, product(1, 77, 10))).toBeNull();
    expect(setSlugForProduct(null, product(1, 2, 10))).toBeNull();
  });
});

describe("catalog, noindex threshold, sitemap and footer", () => {
  const twoPriced = [product(10, 3, 100), product(11, 3, 80), product(12, 3, null)];
  const threePriced = [...twoPriced, product(13, 3, 20), product(20, 1, 50), product(30, 4, 40)];

  it(`indexes a hub only with ${MIN_PRICED_PRODUCTS_FOR_INDEXING} or more priced products`, () => {
    const [prismatic] = buildSetCatalog(DIRECTORY, twoPriced);
    expect(prismatic).toMatchObject({ id: 3, productCount: 3, pricedCount: 2, indexable: false, newestPriceDay: "2026-09-30" });
    expect(buildSetCatalog(DIRECTORY, threePriced).find((entry) => entry.id === 3)?.indexable).toBe(true);
  });

  it("leaves noindex hubs out of the sitemap and dates the rest by the newest price", () => {
    const rows = setSitemapRows(buildSetCatalog(DIRECTORY, threePriced));
    expect(rows).toEqual([{ path: "/sets/prismatic-evolutions", lastModified: "2026-09-30T04:00:00" }]);
  });

  it("links the newest released, indexed sets in the footer", () => {
    const catalog = buildSetCatalog(DIRECTORY, [...threePriced, product(31, 4, 40), product(32, 4, 40)]);
    expect(footerSetLinks(catalog, "2026-10-01")).toEqual([
      { key: "set-3", label: "Prismatic Evolutions", href: "/sets/prismatic-evolutions" },
    ]);
  });

  it("skips sets with no active product", () => {
    expect(buildSetCatalog(DIRECTORY, []).length).toBe(0);
  });
});

describe("hubs", () => {
  const products = [product(10, 3, 100), product(11, 3, 80), product(13, 3, 20), product(20, 1, 50)];
  const stats: ProductStatsSnapshot = {
    day: "2026-09-30",
    byProductId: {
      10: { units_sold_30d: 412, active_listings: 5, qty_available: 30, vol_weekly_52w: 20 },
      11: { units_sold_30d: 10, active_listings: null, qty_available: null, vol_weekly_52w: 30 },
    } as unknown as ProductStatsSnapshot["byProductId"],
  };
  const analytics = [{ key: "SV8.5:Prismatic Evolutions", median365: 38.2, rank: 1, investScore: 1.2 } as SetAnalyticsRow];

  it("matches analytics on code:name, takes the median weekly volatility and totals liquidity", () => {
    const [hub] = buildSetHubs({ catalog: buildSetCatalog(DIRECTORY, products), stats, analytics, indexSummaries: null });
    expect(hub.analytics?.median365).toBe(38.2);
    expect(hub.volWeeklyMedian).toBe(25);
    expect(hub.liquidity).toEqual({
      unitsSold30d: 422,
      activeListings: 5,
      unitsOnMarket: 30,
      daysOfSupply: 30 / (412 / 30),
      productsWithVolume: 2,
      productsWithListings: 1,
    });
    expect(hub.index).toBeNull();
  });

  it("uses a set index only when it is published for the headline's day", () => {
    const summary = (code: string, kind: IndexSummary["kind"], day: string) => ({ code, kind, day, name: code, level: 100 } as IndexSummary);
    const catalog = buildSetCatalog(DIRECTORY, products);
    const current = buildSetHubs({ catalog, stats, analytics, indexSummaries: [summary("sealed", "headline", "2026-09-30"), summary("set-3", "set", "2026-09-30")] });
    expect(current[0].index?.code).toBe("set-3");
    const old = buildSetHubs({ catalog, stats, analytics, indexSummaries: [summary("sealed", "headline", "2026-09-30"), summary("set-3", "set", "2026-08-31")] });
    expect(old[0].index).toBeNull();
  });

  it("returns null liquidity figures when no product reports them", () => {
    const [hub] = buildSetHubs({ catalog: buildSetCatalog(DIRECTORY, products), stats: EMPTY_STATS, analytics: [], indexSummaries: null });
    expect(hub.liquidity.unitsSold30d).toBeNull();
    expect(hub.liquidity.daysOfSupply).toBeNull();
    expect(hub.volWeeklyMedian).toBeNull();
  });

  it("finds the previous and next set by release date", () => {
    const catalog = buildSetCatalog(DIRECTORY, [...products, product(30, 4, 1)]);
    const hubs = buildSetHubs({ catalog, stats: EMPTY_STATS, analytics: [], indexSummaries: null });
    const { previous, next } = neighbourSets(hubs, 3);
    expect(previous?.id).toBe(1);
    expect(next?.id).toBe(4);
  });
});

describe("set page rows", () => {
  it("withholds price and returns of a stale product and sorts priced rows first", () => {
    const rows = buildSetProductRows(
      [product(12, 3, null, { r30: 9, r1y: 9 }), product(10, 3, 100, { r30: 1, r1y: 61 }), product(11, 3, 80)],
      EMPTY_STATS
    );
    expect(rows.map((row) => [row.id, row.usdPrice, row.change1y])).toEqual([
      [10, 100, 61],
      [11, 80, null],
      [12, null, null],
    ]);
  });
});

describe("buildSetSummary drops a sentence whose input is missing", () => {
  const row = (over: Partial<SetProductRow>): SetProductRow => ({
    id: 1, href: "/product/1", name: "Elite Trainer Box", imageUrl: null, usdPrice: 50, priceRecordedAt: null,
    change30d: null, change1y: null, unitsSold30d: null, daysOfSupply: null, ...over,
  });

  it("writes every sentence when every input exists", () => {
    const rows = [
      row({ id: 1, name: "Booster Bundle", change1y: 61, unitsSold30d: 100 }),
      row({ id: 2, name: "Elite Trainer Box", change1y: 12, unitsSold30d: 412 }),
      row({ id: 3, name: "Booster Box", usdPrice: null }),
    ];
    expect(buildSetSummary({ setName: "Prismatic Evolutions", productCount: 3, releaseDate: "2025-01-17", median1y: 38.2, rows })).toEqual([
      "Prismatic Evolutions has 3 tracked sealed products, released Jan 17, 2025.",
      "The median 1-year change is +38.2%.",
      "The Booster Bundle rose the most over 1 year (+61.0%).",
      "The Elite Trainer Box sold the most units in the last 30 days (412).",
      "1 product has no current price.",
    ]);
  });

  it("keeps only the first sentence when every optional input is null", () => {
    const sentences = buildSetSummary({ setName: "Crown Zenith", productCount: 1, releaseDate: null, median1y: null, rows: [row({})] });
    expect(sentences).toEqual(["Crown Zenith has 1 tracked sealed product."]);
  });

  it("never prints a placeholder", () => {
    const sentences = buildSetSummary({ setName: "X", productCount: 2, releaseDate: null, median1y: Number.NaN, rows: [row({ change1y: -5 }), row({ id: 2, usdPrice: null })] });
    expect(sentences.join(" ")).not.toMatch(/null|undefined|NaN|--/);
    expect(sentences).toContain("1 product has no current price.");
  });

  it("says 'held up best' when no product rose", () => {
    const rows = [row({ id: 1, name: "Tin", change1y: -10 }), row({ id: 2, name: "Booster Box", change1y: -2 })];
    expect(buildSetSummary({ setName: "S", productCount: 2, releaseDate: null, median1y: -6, rows })).toContain(
      "The Booster Box held up best over 1 year (-2.0%)."
    );
  });
});

describe("buildSetMedianLine", () => {
  const r = (product_id: number, day: string, usd_price: number, is_price_fresh = true): SetDailyPriceRow => ({ product_id, day, usd_price, is_price_fresh });

  it("chains the median daily change from 100 and ignores stale prices", () => {
    const points = buildSetMedianLine(
      [r(1, "2026-01-01", 10), r(2, "2026-01-01", 20), r(1, "2026-01-02", 11), r(2, "2026-01-02", 22), r(1, "2026-01-03", 40, false), r(2, "2026-01-03", 22)],
      "2026-01-01",
      "2026-01-03"
    );
    expect(points.map((p) => [p.day, p.level, p.nContributing, p.weekly, p.provisional])).toEqual([
      ["2026-01-01", 100, 0, false, false],
      ["2026-01-02", 110, 2, false, false],
      ["2026-01-03", 110, 1, false, false],
    ]);
  });

  it("clips a daily change at the index limit (50%)", () => {
    const points = buildSetMedianLine([r(1, "2026-01-01", 10), r(2, "2026-01-01", 10), r(1, "2026-01-02", 100), r(2, "2026-01-02", 100)], "2026-01-01", "2026-01-02");
    expect(points[1].level).toBe(150);
  });

  it("returns no points with fewer than 2 priced products", () => {
    expect(buildSetMedianLine([r(1, "2026-01-01", 10), r(1, "2026-01-02", 11)], "2026-01-01", "2026-01-02")).toEqual([]);
  });
});
```

### 3. `app/lib/__tests__/riskReturnChart.test.ts` (new, node)

```ts
/** @jest-environment node */
import { buildRiskReturnChart, RISK_RETURN_MIN_POINTS } from "../riskReturnChart";
import type { SetHub } from "../setHubs";

function hub(id: number, vol: number | null, ret: number | null, products = 5): SetHub {
  return {
    id, slug: `s-${id}`, path: `/sets/s-${id}`, name: `Set ${id}`, code: "C", releaseDate: null, expansionType: null, generation: null,
    productIds: [], productCount: products, pricedCount: products, newestPriceAt: null, newestPriceDay: null, indexable: true,
    analytics: ret === null ? null : ({ median365: ret } as SetHub["analytics"]),
    volWeeklyMedian: vol,
    liquidity: { unitsSold30d: null, activeListings: null, unitsOnMarket: null, daysOfSupply: null, productsWithVolume: 0, productsWithListings: 0 },
    index: null,
  };
}

describe("buildRiskReturnChart", () => {
  it(`needs ${RISK_RETURN_MIN_POINTS} plottable sets`, () => {
    expect(buildRiskReturnChart([hub(1, 10, 5), hub(2, 20, -5), hub(3, null, 4)])).toBeNull();
  });

  it("places dots on round-number axes, counts the omitted sets and sizes dots by products", () => {
    const model = buildRiskReturnChart([hub(1, 10, 5, 2), hub(2, 20, -5, 8), hub(3, 35, 40, 8), hub(4, null, 4)]);
    expect(model).not.toBeNull();
    if (!model) return;
    expect(model.omitted).toBe(1);
    expect(model.xTicks[0]).toMatchObject({ value: 0, pct: 0 });
    expect(model.xTicks[model.xTicks.length - 1].pct).toBe(100);
    expect(model.zeroPct).not.toBeNull();
    const byId = new Map(model.points.map((p) => [p.id, p]));
    expect(byId.get(2)!.diameterPx).toBeGreaterThan(byId.get(1)!.diameterPx);
    expect(byId.get(3)!.yPct).toBeLessThan(byId.get(2)!.yPct);
    expect(byId.get(1)!.title).toBe("Set 1: volatility 10.0%, 1Y +5.0%, 2 products");
    for (const p of model.points) {
      expect(p.xPct).toBeGreaterThanOrEqual(0);
      expect(p.xPct).toBeLessThanOrEqual(100);
      expect(p.yPct).toBeGreaterThanOrEqual(0);
      expect(p.yPct).toBeLessThanOrEqual(100);
    }
  });
});
```

### 4. `app/lib/__tests__/shareCard.test.ts` (new, node): the withheld state

```ts
/** @jest-environment node */
import { buildProductShareModel, buildSetShareModel, sparklinePixelPath, truncateText, type ProductShareInput } from "../shareCard";

const BASE: ProductShareInput = {
  title: "Prismatic Evolutions Elite Trainer Box (Pokémon Center)",
  context: "Prismatic Evolutions · Scarlet & Violet",
  state: "fresh",
  priceDay: "2026-09-30",
  usd: 59.99,
  cad: 82.1,
  change30dUsd: 4.04,
  change30dCad: -1.26,
  series: "ACEGIKMOQSUWYacehjlnprtvxz13579_",
  today: "2026-10-01",
};

describe("product share card", () => {
  it("dates a fresh price, shows CAD with USD beside it, and the CAD change", () => {
    const model = buildProductShareModel(BASE);
    expect(model).toMatchObject({
      headline: "C$82.10",
      secondary: "$59.99 USD",
      change: { direction: "down", text: "1.3% 30D" },
      footer: "TCGplayer Market Price for Sep 30, 2026 · pokefin.ca",
      withheld: false,
    });
    expect(model.sparkline?.path.startsWith("M6 ")).toBe(true);
  });

  it("labels a USD change under a CAD price", () => {
    expect(buildProductShareModel({ ...BASE, change30dCad: null }).change?.text).toBe("4.0% 30D in USD");
  });

  it("falls back to USD when no rate exists", () => {
    const model = buildProductShareModel({ ...BASE, cad: null, change30dCad: null });
    expect(model.headline).toBe("$59.99 USD");
    expect(model.secondary).toBeNull();
    expect(model.change?.text).toBe("4.0% 30D");
  });

  it.each(["withheld", "never"] as const)("a %s price says 'No current price' and never prints the old number", (state) => {
    const model = buildProductShareModel({ ...BASE, state, priceDay: state === "never" ? null : "2026-09-12" });
    expect(model.headline).toBe("No current price");
    expect(model.secondary).toBe(state === "never" ? "Not priced yet" : "Last priced Sep 12, 2026");
    expect(model.footer).toBe("As of Oct 1, 2026 · pokefin.ca");
    expect(model.change).toBeNull();
    expect(model.sparkline).toBeNull();
    expect(JSON.stringify(model)).not.toMatch(/59\.99|82\.10|\$/);
  });

  it("treats an aging price as priced and dates it", () => {
    const model = buildProductShareModel({ ...BASE, state: "aging", priceDay: "2026-09-25" });
    expect(model.footer).toBe("TCGplayer Market Price for Sep 25, 2026 · pokefin.ca");
  });

  it("draws nothing for a malformed series", () => {
    expect(buildProductShareModel({ ...BASE, series: "!" }).sparkline).toBeNull();
    expect(sparklinePixelPath([1], 100, 10, 0)).toBeNull();
  });

  it("truncates long titles with an ellipsis", () => {
    expect(truncateText("abcdef", 4)).toBe("abc…");
    expect(truncateText("abc", 4)).toBe("abc");
  });
});

describe("set share card", () => {
  it("dates the set by its newest price and shows the median 1Y change", () => {
    const model = buildSetShareModel({ name: "Prismatic Evolutions", generation: "Scarlet & Violet", releaseDate: "2025-01-17", productCount: 9, pricedCount: 8, median1y: 38.2, newestPriceDay: "2026-09-30", today: "2026-10-01", photoUrls: ["a", "b", "c", "d"] });
    expect(model).toMatchObject({
      context: "Scarlet & Violet · Released Jan 17, 2025",
      stat: "9 tracked sealed products, 8 priced",
      change: { direction: "up", text: "38.2% median 1Y" },
      footer: "TCGplayer Market Prices as of Sep 30, 2026 · pokefin.ca",
      photoUrls: ["a", "b", "c"],
    });
  });

  it("with no priced product shows no change and still carries a date", () => {
    const model = buildSetShareModel({ name: "S", generation: null, releaseDate: null, productCount: 2, pricedCount: 0, median1y: 12, newestPriceDay: null, today: "2026-10-01", photoUrls: [] });
    expect(model.change).toBeNull();
    expect(model.context).toBeNull();
    expect(model.footer).toBe("No current prices · As of Oct 1, 2026 · pokefin.ca");
  });
});
```

### 5. `app/sets/__tests__/setsState.test.ts` (new, node)

```ts
/** @jest-environment node */
import { isMetricKey } from "../../lib/metricDefinitions";
import type { SetHub } from "../../lib/setHubs";
import { nextSort, parseSetsState, SETS_COLUMNS, SETS_VIEWS, setsHref, sortHubs } from "../setsState";

const hub = (id: number, name: string, med365: number | null) =>
  ({ id, name, analytics: med365 === null ? null : { median365: med365 } } as unknown as SetHub);

describe("sets table state", () => {
  it("defaults to the performance view sorted by composite score", () => {
    expect(parseSetsState({})).toEqual({ view: "performance", sort: { key: "composite", dir: "desc" } });
    expect(setsHref(parseSetsState({}))).toBe("/sets");
  });

  it("falls back to the view's default for an unknown or out-of-view sort", () => {
    expect(parseSetsState({ view: "risk", sort: "units30" })).toEqual({ view: "risk", sort: { key: "volWeekly", dir: "asc" } });
    expect(parseSetsState({ view: "nope" }).view).toBe("performance");
  });

  it("keeps an explicit direction and writes only non-default parameters", () => {
    const state = parseSetsState({ view: "liquidity", sort: "dos", dir: "desc" });
    expect(state).toEqual({ view: "liquidity", sort: { key: "dos", dir: "desc" } });
    expect(setsHref(state)).toBe("/sets?view=liquidity&sort=dos&dir=desc");
  });

  it("flips the sorted column and starts another in its first direction", () => {
    expect(nextSort({ key: "med365", dir: "desc" }, "med365")).toEqual({ key: "med365", dir: "asc" });
    expect(nextSort({ key: "med365", dir: "desc" }, "dos")).toEqual({ key: "dos", dir: "asc" });
    expect(nextSort({ key: "med365", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
  });

  it("sorts missing values last in both directions, ties by name", () => {
    const hubs = [hub(1, "B", null), hub(2, "A", 5), hub(3, "C", 9), hub(4, "D", 5)];
    expect(sortHubs(hubs, { key: "med365", dir: "desc" }).map((h) => h.id)).toEqual([3, 2, 4, 1]);
    expect(sortHubs(hubs, { key: "med365", dir: "asc" }).map((h) => h.id)).toEqual([2, 4, 3, 1]);
  });

  it("labels every column with a defined metric", () => {
    for (const column of Object.values(SETS_COLUMNS)) expect(isMetricKey(column.metric)).toBe(true);
    for (const view of SETS_VIEWS) for (const key of view.columns) expect(SETS_COLUMNS[key]).toBeDefined();
  });
});
```

### 6. `app/components/og/__tests__/ShareCards.test.tsx` (new, node)

```tsx
/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server";
import { buildProductShareModel, buildSetShareModel, type ProductShareInput } from "../../../lib/shareCard";
import { ProductShareCard, SetShareCard } from "../ShareCards";

const STALE_INPUT: ProductShareInput = {
  title: "Evolving Skies Booster Box",
  context: "Evolving Skies · Sword & Shield",
  state: "withheld",
  priceDay: "2026-09-12",
  usd: null,
  cad: null,
  change30dUsd: null,
  change30dCad: null,
  series: null,
  today: "2026-10-01",
};

/** Satori needs an explicit display on every div (flex for several children). */
function divStyles(html: string): string[] {
  return [...html.matchAll(/<div([^>]*)>/g)].map((m) => /style="([^"]*)"/.exec(m[1])?.[1] ?? "");
}

describe("share card layouts", () => {
  it("a stale product's card says 'No current price' with its last priced day and today's date", () => {
    const html = renderToStaticMarkup(<ProductShareCard model={buildProductShareModel(STALE_INPUT)} photo={null} />);
    expect(html).toContain("No current price");
    expect(html).toContain("Last priced Sep 12, 2026");
    expect(html).toContain("As of Oct 1, 2026 · pokefin.ca");
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toContain("<img");
  });

  it("sets display on every div, so Satori can lay it out", () => {
    const fresh = buildProductShareModel({ ...STALE_INPUT, state: "fresh", priceDay: "2026-09-30", usd: 59.99, cad: 82.1, change30dUsd: 1, change30dCad: 1, series: "AZ_" });
    const set = buildSetShareModel({ name: "S", generation: "G", releaseDate: "2025-01-17", productCount: 3, pricedCount: 3, median1y: 5, newestPriceDay: "2026-09-30", today: "2026-10-01", photoUrls: [] });
    for (const html of [
      renderToStaticMarkup(<ProductShareCard model={fresh} photo="data:image/png;base64,AAAA" />),
      renderToStaticMarkup(<SetShareCard model={set} photos={["data:image/png;base64,AAAA"]} />),
    ]) {
      const styles = divStyles(html);
      expect(styles.length).toBeGreaterThan(5);
      for (const style of styles) expect(style).toMatch(/display:(flex|block)/);
    }
  });
});
```

### 7. `app/sets/__tests__/SetsPage.test.tsx` (new, jsdom): replaces WP24's `app/stats/__tests__/page.test.tsx`

```tsx
import { render, screen, within } from "@testing-library/react";
import type { SetHub } from "../../lib/setHubs";
import type { SetHubsData } from "../../lib/setHubsData";

const loadSetHubs = jest.fn<Promise<SetHubsData | null>, []>();
jest.mock("../../lib/setHubsData", () => ({ loadSetHubs: () => loadSetHubs() }));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, prefetch: _prefetch, scroll: _scroll, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean; scroll?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock("../../components/IntentLink", () => ({
  __esModule: true,
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
jest.mock("../../components/CardRinkPromo", () => ({ __esModule: true, default: () => null }));

import SetsPage from "../page";

function hub(id: number, name: string, rank: number | null, indexable: boolean, vol: number | null, med365: number | null): SetHub {
  return {
    id, slug: name.toLowerCase().replace(/ /g, "-"), path: `/sets/${name.toLowerCase().replace(/ /g, "-")}`, name, code: "C", releaseDate: "2025-01-17",
    expansionType: null, generation: "Scarlet & Violet", productIds: [], productCount: 4, pricedCount: indexable ? 4 : 1,
    newestPriceAt: "2026-09-30T04:00:00", newestPriceDay: "2026-09-30", indexable,
    analytics: { key: "", name, code: "C", generation: "", releaseDate: null, daysSinceRelease: 600, productCount: 4, avg30: 1, avg90: 2, avg365: 3, median30: 1, median90: 2, median365: med365, consistency90: 66.7, consistency365: 50, volatility90: 1.2, maxDrawdown365: -12, trend90: 0.1, trend365: 0.2, pricePerDay: 0.1, momentumScore: 1, investScore: rank === null ? null : 1.87 - rank, rank },
    volWeeklyMedian: vol,
    liquidity: { unitsSold30d: 100, activeListings: 20, unitsOnMarket: 50, daysOfSupply: 15, productsWithVolume: 4, productsWithListings: 4 },
    index: null,
  };
}

const DATA = (hubs: SetHub[]): SetHubsData => ({ directory: [], products: [], catalog: hubs, hubs, rankedCount: hubs.filter((h) => h.analytics?.rank !== null).length, newestPriceDay: "2026-09-30" });
const run = async (searchParams: Record<string, string> = {}) => render(await SetsPage({ searchParams: Promise.resolve(searchParams) }));

beforeEach(() => jest.clearAllMocks());

describe("/sets", () => {
  it("ranks by composite percentile with labelled, linked headers and no legacy label", async () => {
    loadSetHubs.mockResolvedValue(DATA([hub(1, "Alpha Set", 1, true, 20, 10), hub(2, "Beta Set", 2, false, 30, -5), hub(3, "Gamma Set", null, true, 25, 12)]));
    const { container } = await run();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Pokémon TCG sets");
    expect(container.textContent).not.toContain("Invest Score");
    const table = screen.getAllByRole("table")[0];
    // Two ranked sets: rank 1 is "Top 50%", rank 2 reads "Bottom 50%" (WP24 formatCompositePercentile), unranked "--".
    expect(within(table).getAllByText("Top 50%").length).toBe(1);
    expect(within(table).getAllByText("Bottom 50%").length).toBe(1);
    expect(container.querySelector('a[href="/methodology#composite-score"]')).not.toBeNull();
    // Consistency is an integer percent.
    expect(within(table).getAllByText("50%").length).toBeGreaterThan(0);
  });

  it("lists only indexable hubs in the ItemList", async () => {
    loadSetHubs.mockResolvedValue(DATA([hub(1, "Alpha Set", 1, true, 20, 10), hub(2, "Beta Set", 2, false, 30, -5), hub(3, "Gamma Set", null, true, 25, 12)]));
    const { container } = await run();
    const lds = [...container.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent ?? "{}"));
    const collection = lds.find((ld) => ld["@type"] === "CollectionPage");
    expect(collection.mainEntity.itemListElement.map((i: { name: string }) => i.name)).toEqual(["Alpha Set", "Gamma Set"]);
  });

  it("draws the risk and return chart with a table fallback of links", async () => {
    loadSetHubs.mockResolvedValue(DATA([hub(1, "Alpha Set", 1, true, 20, 10), hub(2, "Beta Set", 2, false, 30, -5), hub(3, "Gamma Set", null, true, 25, 12)]));
    const { container } = await run();
    expect(container.querySelectorAll("svg a[data-set-id]").length).toBe(3);
    expect(container.querySelector("svg a title")?.textContent).toMatch(/volatility .*1Y/);
    const fallback = screen.getByText("Chart data as a table").closest("details") as HTMLElement;
    expect(within(fallback).getByText("Beta Set").closest("a")?.getAttribute("href")).toBe("/sets/beta-set");
  });

  it("switches column presets through links", async () => {
    loadSetHubs.mockResolvedValue(DATA([hub(1, "Alpha Set", 1, true, 20, 10)]));
    await run({ view: "liquidity" });
    const presets = screen.getByRole("navigation", { name: "Columns" });
    expect(within(presets).getByText("Liquidity").getAttribute("aria-current")).toBe("page");
    expect(within(presets).getByText("Risk").getAttribute("href")).toBe("/sets?view=risk");
  });

  it("shows an error state, never an empty table, when the directory read fails", async () => {
    loadSetHubs.mockResolvedValue(null);
    await run();
    expect(screen.getByText("Sets could not be loaded")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
```

### 8. `app/sets/[slug]/__tests__/setPage.test.tsx` (new, jsdom): noindex below 3 priced products, redirect, 404, withheld row

```tsx
import { render, screen, within } from "@testing-library/react";
import type { SetHub, SetProductRow } from "../../../lib/setHubs";
import type { SetPageResult } from "../../../lib/setHubsData";

const loadSetHub = jest.fn<Promise<SetPageResult>, [string]>();
const loadSetChart = jest.fn();
jest.mock("../../../lib/setHubsData", () => ({
  loadSetHub: (slug: string) => loadSetHub(slug),
  loadSetChart: (...args: unknown[]) => loadSetChart(...args),
}));
const notFound = jest.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const permanentRedirect = jest.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT ${path}`);
});
jest.mock("next/navigation", () => ({
  notFound: () => notFound(),
  permanentRedirect: (path: string) => permanentRedirect(path),
}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, prefetch: _prefetch, scroll: _scroll, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean; scroll?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock("../../../components/IntentLink", () => ({
  __esModule: true,
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
jest.mock("../../../components/MarketView/MiniSparkline", () => ({ __esModule: true, default: () => <span data-testid="sparkline" /> }));
jest.mock("../../../components/Price", () => ({ __esModule: true, default: ({ usd }: { usd: number }) => <span>{`$${usd.toFixed(2)}`}</span> }));
jest.mock("../../../components/CardRinkPromo", () => ({ __esModule: true, default: () => null }));

import SetPage, { generateMetadata } from "../page";

function hub(over: Partial<SetHub> = {}): SetHub {
  return {
    id: 3, slug: "prismatic-evolutions", path: "/sets/prismatic-evolutions", name: "Prismatic Evolutions", code: "SV8.5",
    releaseDate: "2025-01-17", expansionType: null, generation: "Scarlet & Violet", productIds: [10, 12], productCount: 2,
    pricedCount: 1, newestPriceAt: "2026-09-30T04:00:00", newestPriceDay: "2026-09-30", indexable: false,
    analytics: null, volWeeklyMedian: null,
    liquidity: { unitsSold30d: 412, activeListings: 5, unitsOnMarket: 30, daysOfSupply: 2.2, productsWithVolume: 1, productsWithListings: 1 },
    index: null, ...over,
  };
}

const ROWS: SetProductRow[] = [
  { id: 10, href: "/product/10", name: "Elite Trainer Box", imageUrl: null, usdPrice: 59.99, priceRecordedAt: "2026-09-30T04:00:00", change30d: 4.2, change1y: 12, unitsSold30d: 412, daysOfSupply: 2.2 },
  { id: 12, href: "/product/12", name: "Booster Box", imageUrl: null, usdPrice: null, priceRecordedAt: "2026-09-01T04:00:00", change30d: null, change1y: null, unitsSold30d: null, daysOfSupply: null },
];

function found(h: SetHub): SetPageResult {
  return { kind: "found", data: { hub: h, rows: ROWS, summary: ["Prismatic Evolutions has 2 tracked sealed products.", "1 product has no current price."], previous: null, next: null, sparklines: null, statsDay: "2026-09-30" } };
}

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  jest.clearAllMocks();
  loadSetChart.mockResolvedValue({ kind: "median", points: [] });
});

describe("set page metadata", () => {
  it("is noindex below 3 priced products", async () => {
    loadSetHub.mockResolvedValue(found(hub({ pricedCount: 2, indexable: false })));
    const meta = await generateMetadata(params("prismatic-evolutions"));
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBe("/sets/prismatic-evolutions");
  });

  it("is indexable from 3 priced products, with a large share card and no config image", async () => {
    loadSetHub.mockResolvedValue(found(hub({ pricedCount: 3, indexable: true })));
    const meta = await generateMetadata(params("prismatic-evolutions"));
    expect(meta.robots).toBeUndefined();
    expect(meta.title).toBe("Prismatic Evolutions Sealed Product Prices");
    expect(meta.twitter).toEqual({ card: "summary_large_image" });
    expect(meta.openGraph && "images" in meta.openGraph).toBe(false);
  });

  it("is noindex with no canonical for an unknown slug", async () => {
    loadSetHub.mockResolvedValue({ kind: "missing" });
    const meta = await generateMetadata(params("nope"));
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBeNull();
  });
});

describe("set page", () => {
  it("redirects a name-derived slug to the stored one with a permanent redirect", async () => {
    loadSetHub.mockResolvedValue({ kind: "redirect", slug: "crown-zenith-swsh12-5" });
    await expect(SetPage(params("crown-zenith"))).rejects.toThrow("NEXT_REDIRECT /sets/crown-zenith-swsh12-5");
  });

  it("404s an unknown slug", async () => {
    loadSetHub.mockResolvedValue({ kind: "missing" });
    await expect(SetPage(params("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders the title, the summary, the products and the JSON-LD", async () => {
    loadSetHub.mockResolvedValue(found(hub()));
    const { container } = render(await SetPage(params("prismatic-evolutions")));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Prismatic Evolutions sealed product prices");
    expect(screen.getByText(/1 product has no current price\./)).toBeTruthy();
    const table = screen.getByRole("table");
    const withheld = within(table).getByText("Booster Box").closest("tr") as HTMLElement;
    expect(within(withheld).getAllByText("No current price", { exact: false }).length).toBeGreaterThan(0);
    expect(within(withheld).queryByText(/\$\d/)).toBeNull();
    const types = [...container.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent ?? "{}")["@type"]);
    expect(types).toEqual(["CollectionPage", "BreadcrumbList"]);
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByText("Sets").closest("a")?.getAttribute("href")).toBe("/sets");
  });

  it("explains the median line when the set has no index", async () => {
    loadSetHub.mockResolvedValue(found(hub()));
    render(await SetPage(params("prismatic-evolutions")));
    expect(screen.getByText(/has no index yet/)).toBeTruthy();
    expect(screen.getByText("No history")).toBeTruthy();
  });
});
```

If `IndexChart` or a WP23 component fails to render in jsdom because of a missing global, mock that component the same way as `MiniSparkline`; do not change the components.

### 9. `app/__tests__/setsRoutes.test.ts` (new, node): redirects, deleted routes, zero client charting code

```ts
/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";

const FRONTEND = path.join(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(FRONTEND, rel), "utf8");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : files(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("WP37 routes", () => {
  it("/analytics and /stats answer one permanent redirect each, straight to /sets", () => {
    const config = read("next.config.ts");
    expect(config).toMatch(/\{\s*source:\s*"\/stats",\s*destination:\s*"\/sets",\s*permanent:\s*true\s*\}/);
    expect(config).toMatch(/\{\s*source:\s*"\/analytics",\s*destination:\s*"\/sets",\s*permanent:\s*true\s*\}/);
    expect(config).not.toMatch(/destination:\s*"\/analytics"/);
    expect(fs.existsSync(path.join(FRONTEND, "app/analytics"))).toBe(false);
    expect(fs.existsSync(path.join(FRONTEND, "app/stats"))).toBe(false);
  });

  it("the sets pages ship no client charting code and no client component of their own", () => {
    const sources = [...files(path.join(FRONTEND, "app/sets")), path.join(FRONTEND, "app/lib/setHubs.ts"), path.join(FRONTEND, "app/lib/riskReturnChart.ts")];
    for (const file of sources) {
      const text = fs.readFileSync(file, "utf8");
      expect([file, /^\s*["']use client["']/m.test(text)]).toEqual([file, false]);
      expect([file, /recharts|ChartBundle|components\/PriceChart|charts\//.test(text)]).toEqual([file, false]);
    }
  });
});
```

### 10. `app/product/[id]/__tests__/productBreadcrumbs.test.ts` (new, node)

```ts
/** @jest-environment node */
import type { Product } from "../../../types/market";
import { buildProductCrumbs } from "../productBreadcrumbs";

const PRODUCT = {
  id: 42,
  usd_price: 59.99,
  url: "",
  last_updated: "",
  variant: "Pokémon Center",
  sets: { id: 3, name: "Prismatic Evolutions", code: "SV8.5", release_date: "2025-01-17" },
  product_types: { id: 2, name: "elite_trainer_box", label: "Elite Trainer Box" },
} as Product;

describe("buildProductCrumbs", () => {
  it("is Home › Sets › {Set} › {Type} with the variant", () => {
    expect(buildProductCrumbs(PRODUCT, "prismatic-evolutions")).toEqual([
      { name: "Home", path: "/" },
      { name: "Sets", path: "/sets" },
      { name: "Prismatic Evolutions", path: "/sets/prismatic-evolutions" },
      { name: "Elite Trainer Box (Pokémon Center)", path: "/product/42" },
    ]);
  });

  it("leaves the set out when it has no slug", () => {
    expect(buildProductCrumbs({ ...PRODUCT, variant: null }, null).map((c) => c.name)).toEqual(["Home", "Sets", "Elite Trainer Box"]);
  });
});
```

### 11. `app/lib/__tests__/ogPhoto.test.ts` and `app/lib/__tests__/ogTheme.test.ts` (new, node)

```ts
/** @jest-environment node */
import { isAllowedOgPhotoUrl, sniffOgPhotoType } from "../ogPhoto";

describe("share image photos", () => {
  it("accepts PNG and JPEG bytes only", () => {
    expect(sniffOgPhotoType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffOgPhotoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffOgPhotoType(new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBeNull();
    expect(sniffOgPhotoType(new Uint8Array([0xff]))).toBeNull();
  });

  it("fetches only https product image hosts", () => {
    expect(isAllowedOgPhotoUrl("https://abc.supabase.co/storage/v1/object/public/product-images/products/1.jpg")).toBe(true);
    expect(isAllowedOgPhotoUrl("https://tcgplayer-cdn.tcgplayer.com/product/1_200w.jpg")).toBe(true);
    expect(isAllowedOgPhotoUrl("http://abc.supabase.co/x.jpg")).toBe(false);
    expect(isAllowedOgPhotoUrl("https://evil.example/x.jpg")).toBe(false);
    expect(isAllowedOgPhotoUrl("https://supabase.co.evil.example/x.jpg")).toBe(false);
    expect(isAllowedOgPhotoUrl("not a url")).toBe(false);
  });
});
```

```ts
/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";
import { OG_COLORS, OG_COLOR_TOKENS } from "../ogTheme";

const CSS = fs.readFileSync(path.join(__dirname, "..", "..", "globals.css"), "utf8");

function tokenHex(token: string): string | null {
  const match = new RegExp(`(?<![\\w-])${token}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(CSS);
  return match ? match[1].toLowerCase() : null;
}

it("every share-image colour equals its globals.css token", () => {
  for (const [key, token] of Object.entries(OG_COLOR_TOKENS)) {
    expect([key, tokenHex(token)]).toEqual([key, OG_COLORS[key as keyof typeof OG_COLORS]]);
  }
});
```

### 12. Updates to existing tests

- `app/__tests__/sitemap.test.ts` (WP13, WP24, WP29, WP33): mock `getCachedSetDirectory` next to `getCachedMarketProductSummaries` (resolve a directory with one set whose fixture products include 3 priced ones, and one set with 1 priced product). Expect `https://pokefin.ca/sets` instead of `/analytics`, the indexable set URL with `lastModified` equal to its newest `price_recorded_at`, no URL for the other set, and `/analytics` and `/stats` in the hidden list. Add a case: `getCachedSetDirectory` resolving `null` makes `sitemap()` reject.
- `app/product/[id]/__tests__/productMeta.test.ts` (WP13): `buildProductMetadata(product).openGraph` has no `images` key even when `image_url` is set, and `twitter` equals `{ card: "summary_large_image" }`. Remove or update any assertion of the old image or `summary` card.
- `app/components/__tests__/Footer.test.tsx` (WP24, WP27): Browse's Sets link is `/sets`; `render(<Footer setLinks={[{ key: "set-3", label: "Prismatic Evolutions", href: "/sets/prismatic-evolutions" }]} />)` shows that link in Browse with `prefetch={false}` behaviour unchanged; `render(<Footer />)` still renders.
- `app/components/nav/__tests__/navConfig.test.ts` (WP27): `SETS.href` is `/sets`; `isNavActive(SETS, "/sets/x")`, `isNavActive(SETS, "/analytics")` are true; `setSearchHref("Prismatic Evolutions")` is `/sets/prismatic-evolutions`; `setSearchHref("???")` is `/prices?q=%3F%3F%3F`. Update WP27's search tests that expected a `/prices?q=` set href to use `setSearchHref(...)`'s new value.
- `app/__tests__/uiConventions.test.ts`: step 19a.
- WP24's methodology and metric-definition tests must pass unchanged (they iterate the new section and the six new definitions: anchors resolve, `short` is at most 120 characters, no banned words).

### 13. Scripts (`pnpm run test:scripts`)

- `scripts/og-formats.test.mjs` (new, step 17j): PNG and JPEG render, WebP rejects.
- `scripts/perf-fixture.test.mjs` (WP22): add (import `fs` and `fixtureSetSlug` if the file does not already):

```js
test("WP37: fixture sets have unique valid slugs and the budgeted set page exists", () => {
  const data = buildPerfData({ baseUrl: "http://127.0.0.1:3100" });
  const slugs = data.setRows.map((row) => row.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const slug of slugs) assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  const budgets = JSON.parse(fs.readFileSync(new URL("../perf-budgets.json", import.meta.url), "utf8"));
  const setRoute = Object.keys(budgets.routes).find((route) => route.startsWith("/sets/"));
  assert.ok(setRoute && slugs.includes(setRoute.slice("/sets/".length)), `${setRoute} is not a fixture set`);
});

test("WP37: fixtureSetSlug agrees with pokefin_slugify on the ASCII anchors", () => {
  for (const [input, expected] of [
    ["Prismatic Evolutions", "prismatic-evolutions"],
    ["Scarlet & Violet", "scarlet-and-violet"],
    ["Sun & Moon: Cosmic Eclipse", "sun-and-moon-cosmic-eclipse"],
    ["Champion's Path", "champions-path"],
    ["  --Hello--World--  ", "hello-world"],
    ["SV8.5", "sv8-5"],
    ["???", ""],
    ["x".repeat(79) + " y", "x".repeat(79)],
    ["a".repeat(90), "a".repeat(80)],
  ]) {
    assert.equal(fixtureSetSlug(input), expected);
  }
});
```

- `scripts/prod-smoke-lib.test.mjs` (WP22, WP33): add (import `firstSetPath`, `REDIRECT_CHECKS`, `judgeRedirect`, `PUBLIC_CHECKS`):

```js
test("WP37: set page check and the two redirects", () => {
  assert.equal(firstSetPath('<a href="/sets/prismatic-evolutions">x</a>'), "/sets/prismatic-evolutions");
  assert.equal(firstSetPath('<a href="/sets">x</a><a href="/sets?view=risk">y</a>'), null);
  assert.ok(PUBLIC_CHECKS.some((check) => check.path === "/sets"));
  assert.ok(!PUBLIC_CHECKS.some((check) => check.path === "/analytics"));
  for (const from of ["/analytics", "/stats"]) {
    assert.deepEqual(REDIRECT_CHECKS.find((redirect) => redirect.from === from), { from, to: "/sets" });
  }
  assert.equal(judgeRedirect({ from: "/stats", to: "/sets", status: 308, location: "https://www.pokefin.ca/sets" }).ok, true);
  assert.equal(judgeRedirect({ from: "/stats", to: "/sets", status: 308, location: "/analytics" }).ok, false);
});
```

### Existing tests that must pass unchanged

Every earlier DB test module (their `INSERT INTO public.sets` and `public.product_types` rows now get slugs from the trigger), WP21's `tests/test_db_roles_integration.py`, WP29's index tests, WP31's product page tests, WP26's sparkline tests.

## Verification

```bash
# 1. Migration shape and replay (repo root): step 2. Expect exit=3, the three function hashes, 12 OK on replay_twice,
#    3 triggers, 6 constraints, NOT NULL on the three columns.

# 2. Database tests, twice (repo root)
POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once python -m pytest tests/test_wp37_taxonomy_slugs.py -q   # 27 passed, twice
python -m pytest tests/ -q                                                                                                               # all pass

# 3. Types, lint, tests (frontend/)
cd frontend
pnpm exec tsc --noEmit             # phase A: only errors in serverMarketData.ts about "slug" on "sets"; phase B: exit 0
pnpm lint                          # 0 errors, no new warnings
pnpm exec jest app/lib/__tests__/taxonomySlug.test.ts app/lib/__tests__/setHubs.test.ts app/lib/__tests__/riskReturnChart.test.ts \
  app/lib/__tests__/shareCard.test.ts app/lib/__tests__/ogPhoto.test.ts app/lib/__tests__/ogTheme.test.ts \
  app/sets app/components/og app/__tests__/setsRoutes.test.ts "app/product/\[id\]" app/__tests__/sitemap.test.ts \
  app/__tests__/uiConventions.test.ts app/components/__tests__/Footer.test.tsx app/components/nav
# all pass
pnpm test --ci                     # whole suite green; count = baseline + new tests - WP24's deleted stats page test
pnpm run test:scripts              # all pass, including og-formats, perf-fixture and prod-smoke-lib additions

# 4. Source checks
grep -rln '"use client"' app/sets app/lib/setHubs.ts app/lib/riskReturnChart.ts app/lib/shareCard.ts app/components/og   # no output
grep -rn 'recharts\|ChartBundle\|PriceChart' app/sets                                                                    # no output
grep -rn '"/analytics"\|"/stats"' app --include=*.ts --include=*.tsx | grep -v __tests__                                 # only navConfig.ts match array
LC_ALL=C grep -rl $'\xe2\x80\x94' app/sets app/lib/setHubs.ts app/lib/shareCard.ts app/components/og app/content/methodology.ts app/methodology   # no output
grep -rn 'Invest Score\|TCGPlayer\|real-time\|all-time' app/sets app/lib/setHubs.ts app/lib/shareCard.ts app/components/og # no output

# 5. Default stub build (empty catalog)
pnpm build:stub > /tmp/wp37-build.log 2>&1; echo "exit=$?"
# expect exit=0. Route table: ƒ /sets (dynamic); /sets/[slug] listed like /product/[id] (ISR, revalidate 1d);
# /product/[id]/opengraph-image and /sets/[slug]/opengraph-image listed (not prerendered, revalidate 1d);
# no /analytics and no /stats route.

# 6. Perf build and server (WP22)
SUPABASE_STUB_FIXTURE=perf pnpm build:stub > /tmp/wp37-perf.log 2>&1; echo "exit=$?"     # exit=0, no "(no fixture route)" line
node scripts/perf-serve.mjs &   # serves http://127.0.0.1:3100
O=http://127.0.0.1:3100
curl -sI $O/stats | grep -iE '^HTTP|^location'                 # HTTP/1.1 308, location: /sets
curl -sI "$O/analytics?view=risk" | grep -iE '^HTTP|^location'  # HTTP/1.1 308, location: /sets?view=risk
curl -s $O/sets | grep -o 'href="/sets/[a-z0-9-]*"' | sort -u | wc -l          # about 55 (every fixture set with products)
curl -s $O/sets | grep -o '"@type":"[A-Za-z]*"' | sort | uniq -c                # CollectionPage, ItemList, BreadcrumbList, ListItem
curl -s "$O/sets?view=liquidity&sort=dos&dir=asc" | grep -c 'aria-sort="ascending"'   # 1
curl -s $O/sets/journey-prism-storm | grep -o '<h1[^>]*>[^<]*</h1>'             # ...>Journey Prism Storm sealed product prices</h1>
for i in 1 2; do curl -sI $O/sets/journey-prism-storm | grep -i '^x-nextjs-cache'; done   # second answer HIT (or STALE)
curl -s -o /dev/null -w '%{http_code}\n' $O/sets/no-such-set                    # 404
# A name-derived slug that is not stored (the fixture's oldest set): one 308 to the stored slug, also when served from the ISR cache.
OLD=$(node --input-type=module -e 'import("./scripts/fixtures/perf.mjs").then((m) => { const d = m.buildPerfData({ baseUrl: "http://127.0.0.1:3100" }); const r = d.setRows[d.setRows.length - 1]; console.log(m.fixtureSetSlug(r.name), r.slug); })')
set -- $OLD; for i in 1 2; do curl -sI $O/sets/$1 | grep -iE '^HTTP|^location'; done   # twice: HTTP/1.1 308 and location: /sets/$2
# If the second answer is not a 308 (a cached 200 with a meta refresh), record it in the PR under risks and keep the page:
# the target still carries the canonical, and duplicate or renamed sets are rare.
SETIMG=$(curl -s $O/sets/journey-prism-storm | grep -o '<meta property="og:image" content="[^"]*"' | head -1 | sed 's/.*content="//;s/"$//')
curl -s "$SETIMG" -o /tmp/wp37-set.png && file /tmp/wp37-set.png                # PNG image data, 1200 x 630; open it: set name, product count, dated footer
curl -s $O/product/900001 | grep -o '"@type":"BreadcrumbList"' | wc -l           # 1
curl -s $O/product/900001 | grep -o 'href="/sets/journey-prism-storm"' | wc -l   # 3 or more (breadcrumb, header line, siblings)
curl -s $O/product/900001 | grep -o '<meta name="twitter:card" content="[^"]*"'  # summary_large_image
IMG=$(curl -s $O/product/900001 | grep -o '<meta property="og:image" content="[^"]*"' | head -1 | sed 's/.*content="//;s/"$//')
curl -s "$IMG" -o /tmp/wp37-card.png && file /tmp/wp37-card.png                 # PNG image data, 1200 x 630
IMG=$(curl -s $O/product/900300 | grep -o '<meta property="og:image" content="[^"]*"' | head -1 | sed 's/.*content="//;s/"$//')
curl -s "$IMG" -o /tmp/wp37-stale.png && file /tmp/wp37-stale.png               # PNG 1200 x 630; open it: "No current price", "Last priced ...", "As of ..."
curl -s $O/sitemap.xml | grep -c '<loc>[^<]*/sets/'                              # number of fixture sets with 3+ priced products
curl -s $O/sitemap.xml | grep -c '/analytics\|/stats'                            # 0
find .next/server/app -name '*.nft.json' -path '*opengraph-image*' | xargs grep -l 'assets/og/Geist-Regular.ttf' | wc -l   # 2 (else step 17i)

# 7. Budgets (perf server still running)
pnpm perf:budget
# rows "/sets JS (gz)", "/sets document (br)", "/sets/[slug] JS (gz)", "/sets/[slug] document (br)": unset before step 18h, then ok or over target;
# "forbidden chunks: ... /sets: supabase-js not reachable, recharts not reachable; /sets/journey-prism-storm: ... not reachable";
# no unmatched fixture request. Expected sizes: /sets JS about the shared bundle plus IntentLink (under 150 gz),
# documents well under 40 and 30 kB br. A breach means a client component or chart leaked in: fix it, do not raise.
kill %1
```

Manual checks (perf server, Chrome device toolbar at 390 x 844 and at 1440 x 900):
1. `/sets` at 1440: one-line 44 px rows, bold sorted header with ▼, faint ↕ on others; every header "?" opens `/methodology#...`; Performance, Risk and Liquidity switch columns without a page jump; clicking "Med 1Y" sorts descending, again ascending, missing values last both times; consistency shows integers ("67%"); composite shows "Top N%" with the z-score in the tooltip; hovering a dot shows its title and clicking it opens the set; the "Chart data as a table" disclosure opens with Enter.
2. `/sets` at 390: no horizontal page scroll; the preset control is full width; chips scroll horizontally and are 44 px tall; rows are two lines; the chart labels are 12 px and legible.
3. `/sets/journey-prism-storm` at both widths: breadcrumb, H1, meta line, provenance and as-of, summary sentences (no "null", "NaN" or "--" in prose), stats card, product table (desktop) or list (phone) with sparklines and "No history" for a stale product, the index chart with its last point labelled, previous and next set cards.
4. A set with no index (WP29's fixture gives sets younger than 120 days none, for example `/sets/storm-brilliant`): the "Median price change" card and its caption ("No history" when its products have fewer than 2 days of stats).
5. `/product/900001`: breadcrumb `Home › Sets › {Set} › {Type}`, each crumb but the last a link; the set name in the header line and in "Other products in" links to the set page.
6. Footer on any page: Browse lists Prices, Screener, Sets (`/sets`), Methodology and up to 5 set links.
7. Global search (Ctrl or Cmd K): type a set name; the set result opens `/sets/<slug>`.
8. Keyboard only on `/sets`: Tab reaches the presets, each sort link (name "Sort by ..."), each "?" link and each row link with a visible focus ring; scatter dots are skipped; the table fallback is reachable.
9. VoiceOver or NVDA on a set page: the breadcrumb is announced as a navigation landmark with the current page; a withheld price reads "No current price".

## Owner actions

1. **Before applying 0041, check for slug collisions** (SQL editor, read-only; the expression is `pokefin_slugify` inlined because the function does not exist yet):

```sql
-- WP37 owner check A1: name slugs that collide, per table, BEFORE applying 0041.
-- The expression is pokefin_slugify (0041) inlined, because the function does not exist yet.
WITH src AS (
  SELECT 'sets' AS tbl, id, name AS source, format('code %s, released %s', code, coalesce(release_date::text, 'unknown')) AS detail,
         release_date AS sort_date
  FROM public.sets
  UNION ALL
  SELECT 'product_types', id, coalesce(nullif(btrim(label), ''), name), format('name %s', name), NULL::date
  FROM public.product_types
  UNION ALL
  SELECT 'generations', id, name, '', NULL::date
  FROM public.generations
), slugged AS (
  SELECT *, btrim(left(btrim(regexp_replace(translate(
           replace(replace(replace(lower(source), '&', ' and '), chr(39), ''), chr(8217), ''),
           'àáâäãåāèéêëēìíîïīòóôöõøōùúûüūçñýÿ', 'aaaaaaaeeeeeiiiiiooooooouuuuucnyy'),
         '[^a-z0-9]+', '-', 'g'), '-'), 80), '-') AS base
  FROM src
)
SELECT tbl, base, count(*) AS rows,
       string_agg(format('%s (id %s; %s)', source, id, detail), ' | ' ORDER BY sort_date NULLS LAST, id) AS members_in_fill_order
FROM slugged
GROUP BY tbl, base
HAVING count(*) > 1 OR base = ''
ORDER BY tbl, base;
```

   No rows is the normal result. A row lists names that would share a slug, in fill order: the first keeps the bare slug, the next gets `-<code>` (sets) or `-<name>` (product types), then `-<id>`. An empty `base` row is a name with no letters or digits; it gets `set-<id>`, `type-<id>` or `era-<id>`. If you prefer other slugs, apply 0041 and then set them by hand before the deploy, for example `UPDATE public.sets SET slug = 'crown-zenith-galarian-gallery' WHERE id = 123;` (lower-case letters, digits and single hyphens; the CHECK rejects anything else). Paste the result into the PR.
2. **Apply `migrations/0041_taxonomy_slugs.sql` before the PR merges** (the frontend reads `sets.slug`; see Deploy order in Before you start) in the Supabase SQL editor (paste the whole file) or with `supabase db push`. Then run the verification query the executor attaches (`/tmp/wp37_0041.sql`): every row OK. Spot-check: `SELECT name, code, slug FROM public.sets ORDER BY release_date DESC NULLS LAST LIMIT 15;` and `SELECT count(*) FROM public.sets WHERE slug IS NULL;` (0).
3. **Generate the database types** for phase B: `pnpm types:db` in `frontend/` with your `SUPABASE_ACCESS_TOKEN`, or give the executor a token for one run; push `app/types/database.ts` to the PR branch.
4. **After deploy**: `curl -sI https://www.pokefin.ca/stats` and `.../analytics` (one 308 each to `/sets`); open `/sets` and two set pages on a phone; paste a product link and a set link into Discord or the X card validator and check the date line; in Google Search Console resubmit `sitemap.xml` and, after a week, check that set pages are being indexed (URL Inspection on one `/sets/<slug>`). The daily smoke test now checks `/sets`, one set page and both redirects.
5. **Renaming a set later** never changes its slug. To move a set's URL, update `slug` by hand; the old URL then 404s unless it is the name-derived slug of the set's current name, which redirects.

## Acceptance criteria

- [ ] `migrations/0041_taxonomy_slugs.sql` exists; `verify_migration.py` exits 3 with no REFUSED line; the verification query returns 12 OK on `replay_twice`; WP21's replay harness passes; `tests/test_wp37_taxonomy_slugs.py` passes 27 of 27 twice in a row; every earlier DB test passes.
- [ ] `sets`, `product_types` and `generations` each have a NOT NULL, unique `slug` with the format CHECK and a BEFORE INSERT default-slug trigger; duplicates resolve deterministically (oldest keeps the bare slug, then `-<qualifier>`, then `-<id>`); renaming keeps the slug.
- [ ] `/analytics` and `/stats` each answer a single 308 to `/sets` (query kept); `app/analytics/` and `app/stats/` no longer exist; the daily smoke test checks both redirects.
- [ ] `/sets` is server-rendered with no client component of its own: a sortable table (44 px rows, visible sort state, `aria-sort`) with Performance, Risk and Liquidity presets, composite score as "Top N%", consistency as integers, a `DataList` on phones, the column definitions disclosure and the decision note.
- [ ] The risk/return chart is server SVG: x weekly volatility (set median), y Med 1Y, dot size product count, `<title>` on every dot, an sr-only summary and a keyboard-accessible table fallback with links.
- [ ] `/sets/[slug]` is ISR (revalidate 1 day, empty `generateStaticParams`), H1 "{Set} sealed product prices", provenance and as-of, a summary whose sentences drop when their input is null, the products table or list with WP26 sparklines, the WP29 set index chart or the median line with its caption, set units sold 30D, listings, units on market and days of supply, release date, previous and next sets, and `CollectionPage`, `ItemList` and `BreadcrumbList` JSON-LD.
- [ ] A hub with fewer than 3 priced products renders with `noindex, follow` and is absent from the sitemap, the `/sets` ItemList and the footer; indexable hubs are in the sitemap with `lastModified` = newest `price_recorded_at`.
- [ ] The product breadcrumb is `Home › Sets › {Set} › {Type}` with all but the last crumb linked and a matching `BreadcrumbList`; the set name links to the set page in the header line and in the siblings heading.
- [ ] Nav "Sets" points to `/sets`; set search results open set pages; the footer Browse column lists up to 5 newest released, indexed sets.
- [ ] Product and set share images are 1200 x 630 PNGs with a mandatory date line and the Pokéfin mark; the product card shows the price in CAD and USD (or USD only without a rate), the 30D change with a glyph in the headline's currency, and the 90-day line; **a stale product's card shows "No current price"** and "Last priced {date}" and no price digits; WebP photos are never embedded (`og-formats.test.mjs` passes); fonts are committed under `frontend/assets/og/` (253,920 bytes total).
- [ ] `buildProductMetadata` has no `openGraph.images` and sets `twitter.card` to `summary_large_image`.
- [ ] The set share image fetches at most `SHARE_SET_PHOTO_TRIES` (6) photos, in parallel, so one 3 s timeout bounds its render; the share-card mark draws its glyph with `fillRule="evenodd"`.
- [ ] A name-derived slug that is not stored answers one 308 to the stored slug (fixture check in Verification step 6, twice); an aging price on a phone row shows "Last priced {date}" with the clock.
- [ ] New files use `focus-visible:outline-hidden` (never `outline-none`) and no colour transitions (WP23); every `CardRinkPromo` call is prop-less (WP15 removed `variant`); sort links are at least 24 px, 44 px on touch.
- [ ] **`/sets` and a set page have zero client charting JS**: `perf:budget` reports recharts and supabase-js not reachable on both; `setsRoutes.test.ts` passes; **`/sets` and `/sets/[slug]` are in `perf-budgets.json`** with limits set and statuses ok or over target; the PR carries a `Perf budget raise:` line for each removed `routes./analytics.*` key and no other raise.
- [ ] Methodology has a `#set-pages` section and a version bump with a change row; six new metric definitions resolve to it.
- [ ] `tsc` exits 0 after phase B; lint 0 errors; Jest and script tests green; the conventions baseline raised only by `lib/ogTheme.ts: 9`.

## Rollback

1. **Code**: revert the merge commit (`git revert -m 1 <merge sha>`) and deploy. Browsers cache a 308 permanently, so in the same revert commit add temporary redirects back, before WP13's list: `{ source: "/sets", destination: "/analytics", permanent: false }` and `{ source: "/sets/:slug", destination: "/analytics", permanent: false }` (307, not cached); remove them once WP37 is re-applied. The share images disappear and product pages return to WP13's photo card.
2. **Database**: the slug columns, triggers and functions are harmless to keep (nothing else reads them). To remove them, write a new numbered migration at the next free number (never edit 0041):

```sql
DROP TRIGGER IF EXISTS sets_default_slug ON public.sets;
DROP TRIGGER IF EXISTS product_types_default_slug ON public.product_types;
DROP TRIGGER IF EXISTS generations_default_slug ON public.generations;
ALTER TABLE public.sets DROP COLUMN IF EXISTS slug;
ALTER TABLE public.product_types DROP COLUMN IF EXISTS slug;
ALTER TABLE public.generations DROP COLUMN IF EXISTS slug;
DROP FUNCTION IF EXISTS public.pokefin_default_slug();
DROP FUNCTION IF EXISTS public.pokefin_free_slug(text, bigint, text, text);
DROP FUNCTION IF EXISTS public.pokefin_slugify(text);
```

   Then regenerate `app/types/database.ts`. Drop the columns only after the code revert is deployed: the set pages, product breadcrumbs, sitemap and footer read `sets.slug`.

## Commit and PR

Branch: `remediation/wp37-sets-section-and-share-cards`.

Commits (each builds and passes its tests):
1. `feat(db): URL slugs for sets, product types and generations (0041, WP37)`: the migration, `tests/test_wp37_taxonomy_slugs.py`, README migration line.
2. `feat(sets): set data layer, /sets and set pages (WP37)`: `taxonomySlug.ts`, `setHubs.ts`, `setHubsData.ts`, `serverMarketData.ts`, `jsonLd.ts`, `riskReturnChart.ts`, `Breadcrumbs.tsx`, `app/sets/**`, their tests.
3. `feat(nav): /sets replaces /analytics and /stats; breadcrumbs and set links (WP37)`: `next.config.ts`, deleted `app/analytics` and `app/stats`, `navConfig.ts`, `Footer.tsx`, `layout.tsx`, product page, `SiblingList.tsx`, `productBreadcrumbs.ts`, `productMeta.ts`, `sitemap.ts`, link fixes, their tests.
4. `feat(og): dated share images for products and sets (WP37)`: `assets/og/*`, `ogTheme.ts`, `ogPhoto.ts`, `shareCard.ts`, `components/og/*`, the two `opengraph-image.tsx`, `og-formats.test.mjs`, their tests.
5. `docs(methodology): set pages (WP37)`: `methodology.ts`, `MethodologyArticle.tsx`, `metricDefinitions.ts`.
6. `perf: set routes in budgets, fixture and production checks (WP37)`: `perf.mjs`, `perf-fixture.test.mjs`, `perf-budgets.json`, `eslint.config.mjs`, `prod-smoke-lib.mjs`, `prod-smoke.mjs`, `prod-confirm.mjs`, `prod-smoke-lib.test.mjs`, conventions baseline, `frontend/README.md`.
7. (phase B) `chore(types): regenerate database types for 0041 (WP37)`.

Commit 2 message body:

```text
Every set gets a page and every set sits on one table.

- /sets: server-rendered table with Performance, Risk and Liquidity
  presets and link-based sorting; composite score as a percentile;
  risk/return scatter as server SVG with a table fallback.
- /sets/[slug]: ISR; products with baked sparklines, set totals for
  sales and supply, the WP29 set index or a median line, a summary
  built from the numbers (sentences drop when an input is null),
  previous and next sets, CollectionPage and BreadcrumbList JSON-LD.
- Hubs with fewer than 3 priced products are noindex.
- No client component and no charting library on either route.
```

PR title: `feat: sets section, set pages and dated share cards (WP37)`

PR body:
- Goal in two sentences and a link to this spec.
- Phase status: "[waiting for DB types]" until step 21, then removed.
- The owner's collision query result (Owner action 1).
- Verification output: `verify_migration.py` stderr, the replay harness's last line, the 12-OK count, both DB test runs, `tsc`, lint, Jest and script summaries, the curl checks of Verification step 6, the `perf:budget` table rows for `/sets` and `/sets/[slug]`, and the forbidden-chunk lines.
- `Perf budget raise:` lines for each removed `routes./analytics.*` key (step 18h), and the conventions note "hex ratchet: lib/ogTheme.ts 9, ..." (step 19b).
- Screenshots at 390 and 1440 px: `/sets` (Performance and Risk presets), a set page with an index, a set page with the median line, a product page breadcrumb; and the three share images (fresh product, stale product, set).
- Soft dependencies found missing (Before you start) and what was done.
- "Noticed, out of scope": type and era hubs (`/sealed/[slug]`, `/eras/[slug]`) can now use `product_types.slug` and `generations.slug`; the "Other {type} prices" block on product pages (`research/trust-seo-brand.md` §11.4) waits for type hubs; a weekly web edition share card (`app/weekly/[date]/opengraph-image.tsx`) waits for the weekly edition; scraper image derivatives (PX05) would let share cards embed WebP-only products as JPEG.
