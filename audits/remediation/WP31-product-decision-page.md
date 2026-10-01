# WP31: Product decision page: quote header, key stats, honest chart, actions

- **Goal**: on one screen of `/product/[id]`, a collector sees whether a sealed product is cheap relative to its own history (52-week range, tracked high, CAGR only when a year exists), its MSRP (x MSRP, cost per pack, pack NAV) and the market (Sealed Index or set index overlay), and whether they could sell it (units sold, sell-through, days of supply, liquidity percentile). Every number carries the TCGplayer day it describes, CAD is shown at the Bank of Canada rate of that day, and the page ends in actions: Add to portfolio, Watch (slot for WP34), Open in Box NAV, View on TCGplayer.
- **Why now / value**: this is signature feature 1 of `01-PRODUCT-DIRECTION.md` §5. Every input now exists: `product_daily_stats` and `fx_daily` (WP25), MSRP and pack contents (WP28), the index route (WP29), `Stat`/`Delta`/`RangeBar`/`AsOf` (WP23), `MetricLabel`/`ReportLink` (WP24). Today the page is a dead end with a type-only H1, a USD-only price with no date and no change, contradictory CAGR and drawdown figures, and the chart 1.5 screens down on phones.
- **Effort**: L, about 15 to 16 hours (page model and chart model with tests 5 h, header, stats, pulse, siblings and actions components 4 h, chart panel and Recharts implementation 3.5 h, portfolio add flow and proxy 1.5 h, methodology, definitions, verification and PR 1.5 h).
- **Depends on**: WP38 (`applyLatestPrices` in `app/lib/portfolio.ts`, used by step 18a), WP05 (`AddHoldingModal` mounted only while open, `portfolioApi.ts`), WP12 (`ProductImage` `priority` hero), WP13 (`productMeta.ts`: `parseProductId`, `productPath`, `getProductLabel`, `getProductDisplayName`, JSON-LD, `loading.tsx`, `not-found.tsx`; `redirects.ts`), WP18 (`lib/marketMath.ts`), WP20 (`useCurrency`, `app/types/market.ts`), WP22 (`perf-budgets.json` route `/product/900001`, `pnpm perf:budget`, perf fixture), WP23 (`Stat`, `Delta`, `RangeBar`, `AsOf`, `Skeleton`, `EmptyState`, `SegmentedControl`, `Badge`, `buttonClasses`, tokens), WP24 (`MetricLabel`, `ReportLink`, `metricDefinitions.ts`, `/methodology`), WP25 (`getCachedProductStats`, `getCachedFxDaily`, `fetchAllRows`, `lib/fx.ts`, `lib/marketStats.ts`), WP28 (soft: `getCachedProductAttributes`, `boxCalculatorHref`, `NAV_STATUS_TEXT`, stats columns `msrp_multiple` to `nav_status`), WP29 (soft: `GET /api/public/index/[code]`, `getCachedIndexSummary`, index codes `sealed` and `set-<sets.id>`). Through them: WP07 (`format.ts`), WP11 (ISR product page, `getCachedProductDetailRows`, `getCachedExchangeRate`, `app/components/IntentLink.tsx` from its step 13a), WP14 (contrast tokens), WP15 (promo last in `<main>`), WP17 (blocking lint and tests). Optional, with a default for each case in Before you start: WP26 (`getCachedProductHistory`), WP27 (header currency toggle), WP33 (may have added the `maxDrawdown1y` definition first), WP36 (may have rewritten the `#limits` bullet first).
- **Unblocks**: WP34 (fills the `watch` slot of `ProductActions`), WP37 (breadcrumbs and the dynamic share card read `buildQuote` from `productModel.ts`), and the deferred "compare up to 5 products" overlay (reuses `lib/productChart.ts`).
- **Placement**: Track 2, after WP29 and WP28, so the overlays and x MSRP exist. Both are soft: the benchmark toggles are hidden while WP29's route is absent (a test forces the flag on when it lands), and every WP28 figure hides when its data is absent, so this package can start after WP25 if curation lags. It must precede WP34 and WP37. No migration (the registry in `00-PLAN.md` gives Track 2 0038 to 0047, the last being WP37's 0047; this package adds none).
- **Suggested branch name**: `remediation/wp31-product-decision-page`
- **Risk level**: medium. It rewrites the page behind every product URL and changes one shared read (full price history instead of 367 days) and the auth redirect's `next` value; URL, canonical, metadata and JSON-LD are untouched, and every rule has a unit test.

## Why

A collector who lands on a product page today cannot answer the one question the site exists for: is this cheap, and could I get out of it? The H1 is only the product type ("Booster Bundle"), the price has no date, no change and no CAD, "CAGR -38.73%" on the tile and "CAGR -25.56%" on the chart chip use different windows, drawdown and volatility stay visible for a stale product whose returns are withheld, Market Pulse says "Not enough volume history yet" when the missing input is price, there is no MSRP multiple, no action besides the TCGplayer link, and on a phone the chart is the seventh block (`research/ui-audit.md` `/product/[id]`, top-10 items 4 and 8). The competitive research ranks the product page as a decision page first among Pokéfin's gaps (`research/competitive-landscape.md` §4 item 2) and names x MSRP "the lingua franca" of sealed investing (§2); the data audit gives the exact metrics and gates this page needs: tracked high "since {first date}", never all-time (`research/data-opportunities.md` §3.3), liquidity as exit risk (§3.4), weekly annualised volatility (§3.13) and CAD at the rate of each day (§3.14). After this package the page leads with a dated quote and change chips, puts the chart directly under it with a legend, a volume pane, round ticks and an index overlay, measures the chart's range change with the same anchor rule as the chips (so the page never shows two different "1Y" numbers), shows one key-stats grid whose every label links to its definition, withholds every price-anchored figure together, and gives signed-in users a path to their portfolio (`research/trust-seo-brand.md` §5.1 for as-of stamps; `research/performance-excellence.md` §7.1 for keeping Recharts lazy).

## Design

### Decisions (binding)

1. H1 is `getProductDisplayName(product)` (WP13): "Evolving Skies Booster Bundle", with the variant in parentheses when present.
2. The headline price is in the visitor's currency (`useCurrency().currency`, default CAD) with its code. The other currency is a secondary line converted at the Bank of Canada rate of the price's day (`rateOn(fx, priceDay)`, WP25). When `fx_daily` has no rate for that day, the latest rate from `getCachedExchangeRate()` is used and labelled "the latest Bank of Canada rate". When neither exists, CAD is not shown and USD is printed with its code.
3. Every CAD figure in the quote header and the key-stats grid uses the quote's rate (one rate per panel, stated once). The chart converts each point at its own day's rate. Change chips in CAD are CAD returns: `(P1 x FX1) / (P0 x FX0) - 1`.
4. The chart sits directly under the header on every breakpoint.
5. When the price is withheld (migration 0023, 14 days), the quote header shows only "No current price. Last recorded {date}." with a methodology link, and the key-stats grid is not rendered. History metrics (tracked high, max drawdown, weekly volatility) move into a "Recorded history" block inside the chart section, captioned "Describes recorded history to {last date}."
6. CAGR is shown only when the latest price is at least 365 days after the first tracked price, and is measured from that first tracked price. Otherwise the tile is not rendered.
7. The moving average is a fixed 30-calendar-day window, computed on daily-collected points only, needing at least 20 of them; the legend says "30-day average".
8. Volume has its own pane with its own axis, daily bars up to 92 days, weekly bars beyond.
9. Benchmark overlays are rebased to the product's price on the first day of the visible range where both exist, so both lines start at the same point. Only one overlay at a time.
10. Default chart range 1Y; ranges 7D, 1M, 3M, 6M, 1Y, Max. A range of N days starts at the same anchor the change chips use (WP25 and WP10's rule): the newest point on or before `end - N` and no older than `end - N - tol` (`tol` 7 up to 1M, 14 beyond, `returnAnchorToleranceDays`). Without such a point it starts at `max(first point, end - N + 1)`. The summary line always prints the start date ("1Y change ▲ 18.5% since Sep 29, 2025"), so the chart's change and the 1Y chip agree, and when they cannot (stats computed for a later day than the last price) the dates say why.
11. Points recorded before daily collection began are weekly points drawn dashed, footnoted "Dashed: weekly points before {date}." Daily collection is detected per product: backfilled rows carry the timestamp `12:00:00` exactly (`backfill_historical_prices.py:816`, `"recorded_at": f"{entry['date']} 12:00:00"`), rows written by the scraper carry the scrape time with microseconds.
12. No URL, canonical, metadata or JSON-LD change (WP13 owns them). The breadcrumb block stays exactly as it is (WP37 changes it).
13. `app/components/PriceChart.tsx` is not edited: cards and `/market` still use it. The product page gets its own chart implementation in the lazy `ChartBundle`.
14. The page stays ISR (WP11). Nothing on it reads the session: "Add to portfolio" is a plain link to `/portfolio?add=<id>`, and `proxy.ts` sends logged-out visitors to sign-in with the full path, query included, in `next`.

### Page anatomy

Phone order (390 px): title row (96 px thumbnail and H1), quote header, actions, chart, key stats, Market Pulse, siblings, promo. Desktop keeps the same DOM order; the image spans the first three rows of a two-column grid.

1440 px, fresh price, CAD selected, WP28 and WP29 data present:

```
Market View / Evolving Skies                                            (breadcrumb, unchanged)
+----------------------+  Evolving Skies Booster Bundle                                    H1 24/32
|                      |  Sword & Shield . SWSH07 . Released Aug 27, 2021   Special Expansion
|     hero image       |
|     300 x 288        |  Market Price (?)
|   (LCP, priority)    |  C$82.10 CAD                                                  display 32/40
|                      |  TCGplayer Market Price for Sep 29, 2026
|                      |  From $59.99 USD at the Bank of Canada rate of Sep 29
|                      |  Change (?)  ▲ 1.2% 1D   ▲ 3.4% 7D   ▼ 2.0% 30D   ▲ 18.5% 1Y
|                      |  In CAD at each day's Bank of Canada rate
|                      |  Lowest listing (?) C$78.60 before shipping, 4.3% below Market Price . 42 listings . as of Sep 29
+----------------------+  Price look wrong? Report it
                          [ Add to portfolio ] [ Open in Box NAV ]  View on TCGplayer
+---------------------------------------------------------------------------------------------+
| Price history          [ 7D | 1M | 3M | 6M |#1Y#| Max ]     ( vs Sealed Index ) ( vs Evolving Skies Index ) |
| ━ Price  ━ 30-day average (light)  ▮ Units sold  - - Sealed Index                         |
| 1Y change ▲ 18.5% since Sep 29, 2025                                                        |
| C$120 +----------------------------------------------------------------------------------+ |
| C$100 |                                              ___/\__/\___          Sep 29 •       | |
|  C$80 |- - - - - - -_ _ _ _ _ /\____/\___/----'                    \___/                 | |
|  C$60 +----------------------------------------------------------------------------------+ |
|   300 | ▮ ▮  ▮ ▮ ▮▮ ▮ ▮  ▮▮ ▮ ▮ ▮ ▮▮ ▮ ▮ ▮ ▮▮  ▮ ▮ ▮                                     | |
|     0 +----------------------------------------------------------------------------------+ |
|        Oct 2025             Jan 2026             Apr                  Jul                  |
| Dashed: weekly points before Jul 7, 2026. CAD at the Bank of Canada rate of each day.      |
| Sealed Index rebased to this product's price on Sep 30, 2025. Units sold: weekly totals.   |
+---------------------------------------------------------------------------------------------+
+---------------------------------------------------------------------------------------------+
| Key stats                                     CAD at the Bank of Canada rate of Sep 29 (CAD only)     |
| 52-week range (?)                              Tracked high (?)     CAGR since first tracked (?)     |
| |--------------------------|-------|           C$98.40              ▲ 8.1%                            |
| C$61.20                      C$98.40           Reached Mar 3, 2026   per year since Sep 1, 2024       |
| 17% below 52-week high                         16.6% below the tracked high                          |
| Retail and packs                                                                              |
| x MSRP (?) 1.4x   MSRP (?) $43.99 USD   Cost per pack (?) C$13.68   Pack value (NAV) (?) C$70.10 |
|                                          6 packs                     Premium to packs (?) +17.1%   |
| Liquidity                                                                                     |
| Units sold (30d) (?) 212   Sell-through (30d) (?) 34%   Days of supply (?) 12.4   Liquidity (percentile) (?) 71 |
| Risk                                                                                          |
| Volatility 1Y (weekly, annualised) (?) 18.2%     Max drawdown (1Y) (?) 21.4%  Sep 30, 2025 to Sep 29, 2026 |
+---------------------------------------------------------------------------------------------+
| Market Pulse (?)  Demand surge  Price and volume rising together: buyers are absorbing supply |
| Units sold (7d) 58 | Volume trend +22.0% | Active listings 42 | Units on market 96 | Supply change (30d) -8.0% | Orders (30d) 140 |
+---------------------------------------------------------------------------------------------+
Other products in Evolving Skies   (5 cards per row: image, name, price, ▲ 4.2% 30D)
(CardRinkPromo, last child of <main>, WP15)
```

390 px, same product:

```
+--------------------------------------+
| Market View / Evolving Skies         |
| +------+ Evolving Skies Booster      |  96 px thumbnail, H1 wraps
| | img  | Bundle                      |
| +------+ Sword & Shield . SWSH07 .   |
|          Released Aug 27, 2021       |
| Market Price (?)                     |
| C$82.10 CAD                          |  32 px
| TCGplayer Market Price for Sep 29,   |
| 2026                                 |
| From $59.99 USD at the Bank of       |
| Canada rate of Sep 29                |
| Change (?)                           |
| ▲ 1.2% 1D  ▲ 3.4% 7D  ▼ 2.0% 30D     |
| ▲ 18.5% 1Y                           |
| Lowest listing (?) C$78.60 before    |
| shipping . 42 listings . as of Sep 29|
| Price look wrong? Report it          |
| [ Add to portfolio ] [Open in Box NAV]|  44 px targets
| View on TCGplayer                    |
+--------------------------------------+
| Price history                        |
| [7D|1M|3M|6M|#1Y#|Max]               |  full width, 44 px
| (vs Sealed Index) (vs Evolving Skies |
| Index)                               |
| ━ Price ━ 30-day avg ▮ Units sold    |
| 1Y change ▲ 18.5% since Sep 29, 2025 |
| [ price pane 220 px ]                |
| [ volume pane 76 px ]                |
| Dashed: weekly points before Jul 7...|
+--------------------------------------+
| Key stats   (one column, range bar   |
| full width, then 2-column Stat grid) |
+--------------------------------------+
| Market Pulse (2-column grid)         |
+--------------------------------------+
| Other products in Evolving Skies     |
| [40px] Elite Trainer Box   C$74.10 ▲ 2.1% 30D |  56 px rows, one link each
+--------------------------------------+
```

Withheld price (stale fixture 900300 or any product priced 14 or more days ago):

```
| Market Price (?)                                                   |
| No current price. Last recorded Sep 5, 2026. Why prices are hidden |
| Price look wrong? Report it                                        |
| [ Add to portfolio ]  View on TCGplayer                            |
+--------------------------------------------------------------------+
| Price history   [ ... ]                                            |
| No price since Sep 5, 2026. The chart shows recorded history only. |  warn text
| [ chart to Sep 5, 2026, last point labelled "Sep 5" ]              |
| Recorded history                                                    |
| Describes recorded history to Sep 5, 2026.                          |
| Tracked high C$98.40 (Mar 3, 2026) | Max drawdown (1Y) 21.4% | Volatility 1Y (weekly, annualised) 18.2% |
+--------------------------------------------------------------------+
(no Key stats section)
| Market Pulse (?)  No signal  Needs a 30-day price change: the price is withheld, so there is no 30-day price change. |
```

### Quote header states (`ProductQuoteHeader.tsx`)

`priceDay` is the UTC day of `product.price_recorded_at`. `age` is whole UTC days from `priceDay` to today.

| State | Condition | Shows |
|---|---|---|
| `fresh` | price present, `age` 0 or 1 | price, `AsOf` hero "TCGplayer Market Price for Sep 29, 2026", secondary currency line, chips, listing line (fresh snapshot only), report link |
| `aging` | price present, `age` 2 to 13 | the same, but `AsOf` renders its stale variant: clock icon and "Last priced Sep 25, 2026" in warn text. The 1D chip is `--` (WP25 nulls `ret_1d` unless `price_day >= D - 1`) |
| `withheld` | `usd_price` null, `price_recorded_at` present | "No current price. Last recorded Sep 5, 2026." plus "Why prices are hidden" (`/methodology#freshness`), report link. No chips, no listing line, no secondary line |
| `never` | `usd_price` null, no `price_recorded_at` | "No current price. This product has never been priced." plus the same link and report link |

Chips (1D, 7D, 30D, 1Y) come from the product's `product_daily_stats` row only when that row agrees with the page's price: `is_price_fresh`, `price_day === priceDay` and `|stats.usd_price - usd_price| < 0.005`. Otherwise every chip is `--` with the screen-reader reason "Not available". In CAD mode each chip is a CAD return computed from the same anchor the SQL uses (see Metric definitions); if any non-null chip cannot be converted (no rate for its anchor day, or the recomputed USD return disagrees with the stats value by more than 0.05 points), the whole row falls back to the USD values with the caption "In USD Market Price terms".

The listing line appears only when the listings snapshot is fresh (`isListingsSnapshotFresh`, 3 days): "Lowest listing C$78.60 before shipping, 4.3% below Market Price · 42 listings · as of Sep 29". Its numbers come from one source: the stats row's listing columns when that row has a `listings_snapshot_date`, otherwise the page's own latest snapshot (never a mix of the two). The "below/above Market Price" clause is `stats.ask_premium_pct`, neutral text, shown only when the stats row agrees with the page price (same rule as the chips). The date is plain text "as of {Mon D}", not `AsOf`: `AsOf` would print "Last priced" on a 2 to 3 day old snapshot, which is a listing, not a price. It is omitted in the withheld and never states.

### Metric definitions (all computed in `productModel.ts`, all USD before conversion)

| Figure | Formula | Shown when | Source |
|---|---|---|---|
| Change 1D | `stats.ret_1d` | stats agree with the page price | WP25 |
| Change 7D, 30D, 1Y | `stats.ret_7d`, `ret_30d`, `ret_365d` | same | WP25 |
| CAD change | anchor A = newest daily point with day in `[D - N - tol, D - N]` (`D` = `stats.day`, `N`/`tol` from `RETURN_ANCHOR_WINDOWS`: 7/7, 30/7, 365/14); for 1D, newest point in `[priceDay - 3, priceDay - 1]`. CAD = `cadReturnPercent(fx, {A.day, A.usd}, {priceDay, price})` | USD value non-null, anchor found, recomputed USD return within 0.05 points of the stats value, both rates exist | WP25 `fx.ts` |
| 52-week range | `stats.low_52w`, `stats.high_52w`, marker at the page price | fresh or aging, both finite, `high > low` | WP25 |
| Range window label | "52-week" when `stats.day - first_tracked_day >= 364`, else "tracked" with "Tracked since {date}: less than a year of history." | | |
| Tracked high | `stats.tracked_high_usd` on `tracked_high_day`, "tracked since {first_tracked_day}"; distance = `(price / high - 1) x 100`, printed "16.6% below the tracked high", or "At the tracked high" when `>= -0.05` | fresh or aging | WP25 |
| CAGR since first tracked | `cagrPercent(firstPoint.price, price, firstDayMs, priceDayMs)` (WP18) | fresh or aging, and `priceDay - firstPoint.day >= 365` | full history |
| x MSRP, MSRP | `stats.msrp_multiple` (printed with `formatMsrpMultiple`), `attributes.msrp_usd` always in USD with its code (a US MSRP is never converted) | value present | WP28 |
| Cost per pack | `stats.cost_per_pack_usd`, sub "{pack_count} packs" | value present | WP28 |
| Pack value (NAV) | `stats.nav_usd` when `nav_status = 'ok'`, sub "Premium to packs +17.1%" (`premium_to_packs_pct`, neutral text: it is not a return); otherwise `--` with `NAV_STATUS_TEXT[status]` | product has recorded contents | WP28 |
| Units sold (30d), Sell-through (30d), Days of supply, Liquidity (percentile) | `stats.units_sold_30d`, `sell_through_30d`, `days_of_supply`, `liquidity_score`. Without a stats row: `getUnitsSoldWindow(sales, 30)`, `getDaysOfSupply`, `u / (u + qty) x 100` from a fresh snapshot, percentile `--` | fresh or aging | WP25, `marketPulse.ts` |
| Volatility 1Y (weekly, annualised) | `stats.vol_weekly_52w` | fresh or aging (key stats), withheld (recorded history) | WP25 |
| Max drawdown (1Y) | `maxDrawdownPercent` (WP18) over daily points with day in `(end - 365, end]`, `end` = `priceDay` (or the last recorded day when withheld); sub "{end - 364} to {end}" | at least 2 points | full history |

Gain and loss colour appears only on the change chips, CAGR and the chart's range change. Distance from high, premium to packs, volume trend and supply change are neutral signed text.

### Chart (`ProductChartPanel.tsx` and `components/charts/ProductPriceChartImpl.tsx`)

- **Payload** (server, `buildChartPayload`): full price history as compact columns `{ d, v }`. Points before `dailySince` are thinned to one per week (every Monday, plus the first point and the last point before `dailySince`). `dailySince` = the earliest day with a non-backfill timestamp, `null` when the product has none (then every point is weekly and dashed, footnote "Dashed: weekly points only."). Daily and weekly sales buckets as two compact series (null quantities dropped: unknown is not zero, migrations 0018 to 0021). `fx_daily` sliced from the first price day. About 4 to 6 kB br in the RSC payload for a product with a year and a half of history.
- **Range**: end = the last recorded price day (never "today"). Start = the anchor of decision 10 (newest point in `[end - N - tol, end - N]`), else `max(first day, end - N + 1)`; Max = first day. The x-domain is `[first visible point, end]`, clamped to data. When the range asks for more than exists, the summary says "Change ... since {first day}" without the range name. If fewer than 2 points fall in the range, the last 2 points are shown.
- **Axes**: numeric time axis (UTC day numbers). X ticks: days or Mondays up to 62 days, month starts beyond (every 1, 2, 3, 6 or 12 months, at most 5 ticks), labelled "Sep 1" or "Sep", with the year on January and on the first tick. Y ticks: 5 round numbers from a 1, 2, 2.5, 5 x 10^k step, domain extended to the outer ticks, floor at 0.
- **Series**: price solid (`--pf-chart-line`, 2 px) from `dailySince`, dashed (4 4) before it, with the first daily point repeated in the dashed series so the two join. A gap longer than 14 days (`PRICE_STALENESS_TOLERANCE_DAYS`) breaks the line. 30-day average: same colour at 45% opacity, 1.5 px. Benchmark: `--pf-chart-bench`, dashed 6 4. Last price point: a dot labelled with its date ("Sep 29"), text anchored to its left so it never clips at the right edge. Release date: a dashed ink-soft reference line labelled "Release" when inside the domain.
- **Volume pane**: its own chart, 76 px, same x-domain and left axis width (64 px) so bars line up; y axis with two ticks (0 and a round max). Daily bars when the visible span is at most 92 days, interior days zero-filled (TCGplayer writes explicit zero buckets); otherwise weekly bars on Mondays: 7 daily buckets summed, else the TCGplayer weekly row, else a partial sum flagged in the tooltip. Price and volume charts share `syncId="product-chart"` with `syncMethod="value"`.
- **Currency**: CAD converts each point at its own day's rate (`rateOn`). A day without a rate is a gap, never today's rate. If `fx_daily` is empty, the chart shows USD with the note "Shown in USD: Bank of Canada rates are unavailable." Points before the first rate add "CAD starts {date}: earlier points have no Bank of Canada rate."; a missing rate inside the series adds "Days without a Bank of Canada rate are left blank." The notes render inside the chart box, under the summary line.
- **Benchmark**: the toggles "vs Sealed Index" and "vs {Set} Index" are `aria-pressed` buttons, mutually exclusive. The server decides which exist: WP29 creates a set index only for a set with at least 3 qualifying constituents, so the page reads `getCachedIndexSummary()` and renders the set toggle only when `set-<sets.id>` is in it (`availableBenchmarks`). The first press fetches `/api/public/index/<code>` once per page load (module-level promise cache). A 404 (an index dropped after the page was cached) disables that toggle with the text "No {Set} Index yet". A network error shows "Index unavailable. Select again to retry." in an always-present `role="status"` line, and the next press on that toggle retries (it does not switch the toggle off). The toggles are not rendered while `BENCHMARKS_ENABLED` is false (WP29 absent).
- **Tooltip**: date ("Sep 29, 2026", "(weekly point)" when dashed), price with currency code, 30-day average, units sold ("58 sold that week" or "12 sold that day", "partial week" when flagged), and "{Index name} +4.2% since Sep 30".
- **Legend** (HTML above the chart, server-rendered in the panel): Price, 30-day average, Units sold (when the product has sales data), the active benchmark name.
- **Summary line** (inside the reserved chart height): "{range} change ▲ 18.5% since Sep 29, 2025" with `Delta`, or "Change ▲ 4.0% since {first day}" for a history shorter than the range. When withheld: "No price since Sep 5, 2026. The chart shows recorded history only." in warn text, no change. Chart notes (currency gaps, an index with no values in range) follow on the same wrapped line in caption size.
- **Footnotes** (below the chart, `min-h` reserved): the dashed note, "CAD at the Bank of Canada rate of each day." (CAD only), the benchmark rebasing note, the volume resolution note, and a "How the chart is drawn" link to `/methodology#market-price`.
- **States**: loading is a flat `Skeleton` of the exact reserved height (no fake chart shape); fewer than 2 recorded prices renders `EmptyState` "No history" with "Pokéfin has fewer than two recorded prices for this product."; a chart chunk that fails to load leaves the skeleton (Next's dynamic loader) and the rest of the page works.

### WP29 contract (from WP29's spec, "Public contracts for later packages" and steps 11 and 12)

- Route `GET /api/public/index/[code]`: ISR (`force-static`, `revalidate = 86400`, empty `generateStaticParams`), 404 for a malformed or unknown code, 500 (never cached) on a read failure.
- Body (`CompactIndexSeries` in `lib/marketIndex.ts`): `{ code, name, asOf, base: 100, weeklyUntil, d: ["YYYY-MM-DD", ...], l: [level to 4 decimals, ...], p: [positions of provisional points] }`, oldest first, one entry per published day (D-1); weekly (Mondays only) up to `weeklyUntil`, daily after.
- Codes: `sealed` (name "Pokéfin Sealed Index") for the headline index, `set-<sets.id>` (numeric set id, name "<set name> Index") for set indices, created only for a set with at least 3 qualifying constituents.
- `getCachedIndexSummary(): Promise<IndexSummary[] | null>` in `serverMarketData.ts` lists every published index (`code`, `name`, ...); `null` means the read failed.

This package keeps its own 30-line loader in `benchmark.ts` instead of WP29's `fetchPublicIndexSeries` (that helper exists only when WP26's `publicMarketApi.ts` does), so it compiles in every merge order. If soft check (b) shows a body that differs from the above, change only `parseIndexPayload`, `SEALED_INDEX_CODE` and `setIndexCode` and say so in the PR.

### Actions row (`ProductActions.tsx`)

| Action | Element | Condition |
|---|---|---|
| Add to portfolio | `Link` to `/portfolio?add=<id>`, `buttonClasses({ variant: "primary" })`, `prefetch={false}` | always (the one primary action) |
| Watch | the `watch` prop, rendered as given | WP34 passes it; empty until then |
| Open in Box NAV | `Link` to `boxCalculatorHref(id)` (WP28), secondary | the product has recorded pack contents |
| View on TCGplayer | external `<a target="_blank" rel="noopener noreferrer">`, ghost, sr-only "(opens in a new tab)" | `product.url` is non-empty |

Logged-out visitors: `/portfolio` is protected by `proxy.ts`, which after this package redirects to `/auth/login?next=%2Fportfolio%3Fadd%3D42`. After sign-in WP13's `safeReturnToPath` keeps the query, the dashboard opens `AddHoldingModal` with the product selected and its Market Price pre-filled (WP05's pre-fill effect), and `?add` is removed from the URL when the modal closes.

### Market Pulse

Same signal logic and inputs as today (`getPulseSignal(product.returns["1M"], volumeTrend)`). Tiles: Units sold (7d), Volume trend, Active listings, Units on market, Supply change (30d) (WP25), Orders (30d) (WP25). Units sold (30d) and Days of supply move to the key-stats liquidity row. The "No signal" text names the missing input:

| Missing | Text |
|---|---|
| price change only, price withheld | "Needs a 30-day price change: the price is withheld, so there is no 30-day price change." |
| price change only, price current | "Needs a 30-day price change: there is no 30-day price change yet." |
| volume trend only | "Needs a volume trend: there is not enough sales history yet." |
| both | "Needs a 30-day price change and a volume trend: {price clause}, and there is not enough sales history for a volume trend." |

### Siblings

One DOM for both breakpoints: a list of 56 px rows on phones (40 px thumbnail, name, price, `Delta` 30D) and a 3 to 5 column card grid from 768 px. Each item is one `IntentLink` (WP11 step 13a: prefetch after an 80 ms hover, on focus or pointerdown, never on viewport entry). Hover changes the background instantly: no `transition-colors` (`01-PRODUCT-DIRECTION.md` §3.5 allows only opacity and transform transitions). Name is the product type plus variant (the set is in the heading). Price in the visitor's currency at the sibling's own price-day rate; withheld siblings show `--` and "Price withheld" to screen readers.

### Accessibility

- One H1. Sections are `<section aria-labelledby>` with H2 headings ("Price history", "Key stats", "Market Pulse", "Other products in {set}"); the quote header is `<section aria-label="Price">`.
- Every key-stats and Market Pulse label is a `MetricLabel` (24 px "?" link with an accessible name).
- `Delta` carries direction in words; `AsOf` carries staleness in words; `RangeBar` gives a sentence.
- Range control is WP23's `SegmentedControl` (APG radio group). Benchmark toggles are buttons with `aria-pressed`; a disabled one uses `aria-disabled="true"` and keeps focus. The benchmark `role="status"` element is rendered empty from the first paint, so its loading and error text is announced when it appears.
- The chart is `aria-hidden` apart from its heading, summary line and footnotes; the summary line and the key stats carry the same information in text.
- 44 px targets on coarse pointers for every button and link in the actions row, toolbar and sibling rows.

### Performance

- Recharts and `lib/productChart.ts` stay in the lazy `ChartBundle` chunk. The route's initial JS gains `QuoteClient.tsx` (currency pickers, about 1 kB gz), `ProductChartPanel.tsx` and `benchmark.ts` (about 2 kB gz); `IntentLink` is already there (WP11). Budget: initial JS at or under 145 kB gz, document at or under 30 kB br, and the `ChartBundle` chunk (which now also carries `ProductPriceChartImpl` and `productChart.ts`, about 5 kB gz) at or under WP22's `lazyChunkGzKb` (120 kB gz).
- Server reads: six cached reads side by side (`getCachedProductDetail`, `getCachedProductStats`, `getCachedFxDaily`, `getCachedExchangeRate`, `getCachedProductAttributes`, `getCachedIndexSummary`), none nested. The only new database read is the paged full history inside the existing per-product `product-detail-rows` entry (about 1 to 2 PostgREST pages for a product with two years of daily rows).
- The price history in the RSC payload is compact columns with the pre-daily part thinned to weekly points, replacing today's 367 row objects: the document should shrink or stay level.
- No client fetch on page load. The index route is fetched only on a toggle press.
- LCP: at 1440 px the LCP element stays WP12's hero `<img>` (preload, `fetchpriority="high"`). At 390 px the brief makes the image a 96 px thumbnail, so the LCP element becomes server-rendered text in the header (the H1 or the price), which paints with the first HTML; it must never be the chart, a skeleton or a client-only node. The thumbnail keeps `priority`.
- CLS: the chart box has a fixed height per breakpoint (with or without the volume pane, known on the server), the legend and footnotes have reserved minimum heights, and the currency switch after hydration swaps text of equal line height.

## Before you start

Paths are relative to `frontend/` unless they start with `migrations/` or `audits/`.

Read:
- `audits/remediation/01-PRODUCT-DIRECTION.md` (§2, §3, §5 item 1, §6).
- `audits/remediation/research/ui-audit.md` section `/product/[id]`; `research/data-opportunities.md` §2, §3.3, §3.4, §3.13, §3.14.
- Specs: WP23 steps 8, 9, 11, 14, 15, 16, 17 (component APIs); WP24 steps 5, 6, 17 (definitions, `MetricLabel`, `ReportLink`, product page labels); WP25 Design, steps 8 to 12, 14 and its `#limits` and `#currency` methodology edits; WP28 Design, steps 5 to 8; WP29 "Public contracts for later packages", steps 11 and 12; WP13 step 7 (`productMeta.ts`); WP11 steps 4, 7 and 13 (`IntentLink`); WP12 steps 6 and 7; WP05 steps 15 and 16; WP33 step 5 (it may add `maxDrawdown1y` before you); WP36 step 22d (the `#limits` bullet both packages edit).
- Current code: `app/product/[id]/page.tsx`, `app/product/[id]/ProductDetailChart.tsx`, `app/product/[id]/loading.tsx`, `app/product/[id]/productMeta.ts`, `app/components/charts/ChartBundle.tsx`, `app/lib/serverMarketData.ts` (`fetchProductDetailRows`, `fetchAllRows`, the cached exports), `app/lib/marketPulse.ts`, `app/lib/fx.ts`, `app/lib/marketStats.ts`, `app/lib/marketMath.ts`, `app/context/CurrencyContext.tsx`, `app/components/Portfolio/PortfolioDashboard.tsx`, `app/components/Portfolio/cards/AddHoldingModal.tsx`, `app/lib/portfolio.ts` (`searchProducts`, `applyFreshPricesToSearchResults`), `app/portfolio/page.tsx`, `proxy.ts`, `app/content/methodology.ts`, `app/methodology/MethodologyArticle.tsx`, `app/lib/metricDefinitions.ts`.

Find every call site you will affect:

```bash
cd frontend
grep -rn "ProductDetailChart" app                        # page.tsx only; the file is deleted in step 15
grep -rn "getCachedProductDetail\b\|getCachedProductDetailRows\|getCachedProductHistory" app --include=*.ts --include=*.tsx
grep -rn "getPulseSignal\|PULSE_SIGNAL_META" app --include=*.ts --include=*.tsx
grep -rn "AddHoldingModal" app --include=*.tsx
grep -rn 'url.searchParams.set("next"' proxy.ts         # 1 line
```

Starting state (all must pass before you edit):

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit                                   # 0 errors
pnpm run lint                                            # 0 errors
pnpm test --ci                                           # all green
git status --short                                       # clean
```

Landed packages (hard dependencies: stop and report if a check fails):

```bash
cd frontend
# WP05: modal mounted only while open
grep -n "isAddModalOpen && (" app/components/Portfolio/PortfolioDashboard.tsx            # 1 line
ls app/lib/portfolioApi.ts
# WP11: ISR product page, the per-product rows cache, intent-only product links
grep -n "export const revalidate = 86400" "app/product/[id]/page.tsx"                   # 1 line
grep -n "const getCachedProductDetailRows = unstable_cache" app/lib/serverMarketData.ts # 1 line
grep -n "export async function getCachedExchangeRate" app/lib/serverMarketData.ts      # 1 line
grep -n "export default function IntentLink" app/components/IntentLink.tsx              # 1 line
# WP12: hero image priority
grep -n "priority" "app/product/[id]/page.tsx"                                          # 1 line (hero)
# WP13: product helpers, loading skeleton, redirects
grep -n "export function parseProductId\|export function productPath\|export function getProductLabel\|export function getProductDisplayName" "app/product/[id]/productMeta.ts"   # 4 lines
ls "app/product/[id]/loading.tsx" "app/product/[id]/not-found.tsx" app/lib/redirects.ts
# WP18
grep -n "export function cagrPercent\|export function maxDrawdownPercent\|export function toDailyPoints\|export function dateKeyUtcMs\|export function recordedDayKey\|export const DAY_MS" app/lib/marketMath.ts   # 6 lines
# WP20
grep -n "export function useCurrency" app/context/CurrencyContext.tsx                  # 1 line
ls app/types/market.ts
# WP22
grep -n '"/product/900001"' perf-budgets.json                                            # 1 line
grep -n '"perf:budget"\|"build:stub"' package.json                                       # 2 lines
# WP23
ls app/components/ui/{Delta,Stat,RangeBar,AsOf,Skeleton,EmptyState,SegmentedControl,Button,Badge}.tsx
grep -n "export const STALE_AFTER_DAYS" app/components/ui/AsOf.tsx                      # 1 line
# WP24
ls app/components/ui/MetricLabel.tsx app/components/ui/ReportLink.tsx app/lib/metricDefinitions.ts app/content/methodology.ts app/methodology/MethodologyArticle.tsx
# WP25
grep -n "export async function getCachedProductStats\|export async function getCachedFxDaily\|async function fetchAllRows" app/lib/serverMarketData.ts   # 3 lines
grep -n "export function cadReturnPercent\|export function rateOn\|export function sliceFxSeries" app/lib/fx.ts   # 3 lines
grep -n "export const RETURN_ANCHOR_WINDOWS\|export const ONE_DAY_PREVIOUS_MAX_GAP_DAYS\|export function statsFor\|export function returnAnchorToleranceDays" app/lib/marketStats.ts   # 4 lines
grep -n "WP31 and WP36 remove this bullet\|WP31 removes this bullet" app/methodology/MethodologyArticle.tsx   # 1 line (step 2b says what each means; 0 lines: skip that bullet)
grep -n "volatilityWeekly52w\|range52w\|trackedHigh\|sellThrough30d\|liquidityScore\|supplyChange30d\|transactions30d" app/lib/metricDefinitions.ts | wc -l   # 7 or more
```

Soft and optional packages (record each result in the PR body):

```bash
cd frontend
# (a) WP28 code. Present: use it as written. Absent: see "WP28 absent" in step 6 and step 11.
grep -n "export async function getCachedProductAttributes" app/lib/serverMarketData.ts
grep -n "export function boxCalculatorHref\|export const NAV_STATUS_TEXT\|export function isNavStatus\|export function formatMsrpMultiple" app/lib/productAttributes.ts
# (b) WP29 index route and summary read. Present (both lines): BENCHMARKS_ENABLED = true in step 13
#     and the page reads getCachedIndexSummary in step 16. Absent: false, and step 16's "WP29 absent".
ls "app/api/public/index/[code]/route.ts"
grep -n "export async function getCachedIndexSummary" app/lib/serverMarketData.ts
#     If present, read toCompactIndexSeries in app/lib/marketIndex.ts; compare with "WP29 contract" above.
# (c) WP26 history accessor. Present: step 4c slices it. Absent: skip step 4c.
grep -n "export async function getCachedProductHistory" app/lib/serverMarketData.ts
# (d) WP27 header currency toggle. Present: skip ProductCurrencyToggle in step 11. Absent: add it.
ls app/components/nav/HeaderCurrencyToggle.tsx
# (e) WP33 may already define maxDrawdown1y (its step 5c). Present: step 1 skips that entry.
grep -n 'key: "maxDrawdown1y"' app/lib/metricDefinitions.ts
# (f) Methodology version, for step 2.
grep -n "METHODOLOGY_VERSION = \|METHODOLOGY_EFFECTIVE_DATE = " app/content/methodology.ts
```

Also note the current product-route numbers from the latest `master` CI job summary ("/product/[id] JS (gz)" and document br), or measure them now with the Verification perf commands on a clean checkout. You need them for the PR.

## Implementation steps

### Step 1. `app/lib/metricDefinitions.ts`: four new definitions

1a. Extend the `./marketStats` import (WP25 added it) with `ONE_DAY_PREVIOUS_MAX_GAP_DAYS` if it is not imported yet.

1b. In `DEFINITIONS`, directly after the last product-level entry (WP28's `premiumToPacks`, WP33's `fromHigh52w` or WP25's `distinctPrices365d`, whichever is last), add:

```ts
  // WP31: product decision page
  def({ key: "priceChange", label: "Change", unitLabel: "%", window: "1D, 7D, 30D, 1Y", short: `To the latest Market Price from the previous recorded day (at most ${ONE_DAY_PREVIOUS_MAX_GAP_DAYS} days back) and from 7, 30 and 365 days earlier.`, anchor: "returns" }),
  def({ key: "cagrSinceTracked", label: "CAGR since first tracked", unitLabel: "% per year", window: "first tracked price to latest, 365 days or more", short: "Compound annual growth from the first tracked price to the latest. Shown only with 365 or more days of history.", anchor: "cagr" }),
  def({ key: "maxDrawdown1y", label: "Max drawdown (1Y)", unitLabel: "%", window: "365 days to the latest price", short: "Largest fall from a peak to a later low in the recorded prices of the last 365 days.", anchor: "drawdown" }),
  def({ key: "lowestListing", label: "Lowest listing", unitLabel: "USD", window: "latest snapshot", short: "Cheapest active TCGplayer listing in the latest daily snapshot, item price before shipping.", anchor: "ask-premium" }),
```

If soft check (e) printed a line, WP33 already defined `maxDrawdown1y` with this exact text: leave out that line (a duplicate key fails WP24's uniqueness test). If `tsc` reports that `"ask-premium"` is not a `MethodologyTarget` (WP25 named the subsection differently), use the anchor WP25's `askPremium` definition uses. Do not change existing entries: `cagr`, `maxDrawdown` and `volatility30dAnnualised` still describe other pages. Every `short` stays at or under 120 characters (WP24's test).

### Step 2. Methodology: version bump, CAGR rule, chart figures

2a. `app/content/methodology.ts`: note the current `METHODOLOGY_VERSION` (call it `PREV_VERSION`) and `METHODOLOGY_EFFECTIVE_DATE` (`PREV_DATE`). Set `METHODOLOGY_VERSION` to the next minor version above `PREV_VERSION` (for example "1.3" to "1.4") and `METHODOLOGY_EFFECTIVE_DATE` to today (`date -u +%F`). In `METHODOLOGY_CHANGES`, turn the first entry's `version: METHODOLOGY_VERSION, date: METHODOLOGY_EFFECTIVE_DATE` into the literals `version: "<PREV_VERSION>", date: "<PREV_DATE>"` (same summary) and insert above it:

```ts
  {
    version: METHODOLOGY_VERSION,
    date: METHODOLOGY_EFFECTIVE_DATE,
    summary:
      "Product pages: CAGR is measured from the first tracked price and shown only with 365 or more days of history; volatility uses the weekly annualised figure; max drawdown covers the last 365 days; CAD figures use the Bank of Canada rate of the price's day; the chart's range change uses the return anchor rule and the chart adds a 30-day average, a weekly segment before daily collection and index overlays rebased to the start of the range.",
  },
```

2b. `app/methodology/MethodologyArticle.tsx`:

- `#cagr`: replace the sentence that starts "Product pages use the oldest price in the last year of recorded history." through "so read it with the length of the chart." with:

```tsx
              Product pages measure it from the first tracked price to the latest one and show it only when the two
              are at least 365 days apart, so a short history is never stretched to a full year. The Market table
              still annualises the chart window it shows.
```

  Keep "It is withheld with the price." at the end of the paragraph.
- `#volatility`: in `tr[data-vol="product"]`, change the first cell from "Product pages and the Market table" to "The Market table". In `tr[data-vol="weekly"]` (WP25), change the first cell from "Pages built on the daily statistics" to "Product pages and other pages built on the daily statistics" (if WP25's text differs, prefix it with "Product pages and " and lower-case its first letter).
- `#currency` (WP25's version): append a paragraph at the end of the section:

```tsx
            <p>
              Product pages convert the headline price, the key statistics and the lowest listing at the Bank of
              Canada rate of the day the price describes, and say which rate they used. Their change chips and
              chart are CAD returns at each day&apos;s rate.
            </p>
```

- `#limits`: the CAD history bullet WP25 wrote. Three cases (soft check above):
  - Comment `{/* WP31 removes this bullet */}` (WP36 merged first and left only product charts): delete the comment and its `<li>`.
  - Comment `{/* WP31 and WP36 remove this bullet */}` (WP36 not merged): keep the comment unchanged (WP36 step 22d finds it by this text) and change the bullet's text to `Portfolio charts still convert CAD history at the latest rate until they move to the daily rates described under Canadian dollars.`
  - Neither comment: change nothing here and say so in the PR.
- `#market-price`: append three rows to the "Figure / Meaning" table body:

```tsx
                <tr><td className={TD}>30-day average (chart)</td><td className={TD}>Mean of the daily Market Prices recorded in the 30 days ending on each day. Drawn only where at least 20 of those days have a price.</td></tr>
                <tr><td className={TD}>Dashed line (chart)</td><td className={TD}>Weekly points from TCGplayer&apos;s history, before Pokéfin began recording the product daily. Daily steps in that period are not real moves.</td></tr>
                <tr><td className={TD}>Index overlay (chart)</td><td className={TD}>A Pokéfin index rebased to the product&apos;s price on the first day of the visible range, so both lines start together. Index days are published for the previous day.</td></tr>
                <tr><td className={TD}>Range change (chart)</td><td className={TD}>From the price at the start of the range to the latest price. The start is found with the same rule as the returns above, so the 1Y range change and the 1Y chip agree.</td></tr>
```

2c. Update WP24's methodology test: the `#changes` row-count assertion becomes the previous count plus one (count with `METHODOLOGY_CHANGES.length`, not a literal), and the first row has `METHODOLOGY_VERSION`. Add assertions: `#cagr` contains "at least 365 days apart"; `tr[data-vol="product"]` still contains `String(PRODUCT_VOLATILITY_LOOKBACK_POINTS)`; `tr[data-vol="weekly"]` contains "Product pages"; `#currency` contains "rate of the day the price describes"; `#limits` does not contain "Product and portfolio charts".

### Step 3. `app/lib/marketPulse.ts`: the missing-input reason

Append after `getPulseSignal`:

```ts
/**
 * Why Market Pulse has no signal, naming the missing input (WP31). Null when
 * both inputs exist (the caller then says "Stable" or the signal).
 */
export function getPulseMissingReason(
  priceReturn30d: number | null,
  volumeTrend: number | null,
  priceWithheld: boolean
): string | null {
  const noPrice = priceReturn30d === null;
  const noVolume = volumeTrend === null;
  if (!noPrice && !noVolume) return null;
  const priceClause = priceWithheld
    ? "the price is withheld, so there is no 30-day price change"
    : "there is no 30-day price change yet";
  if (noPrice && noVolume) {
    return `Needs a 30-day price change and a volume trend: ${priceClause}, and there is not enough sales history for a volume trend.`;
  }
  if (noPrice) return `Needs a 30-day price change: ${priceClause}.`;
  return "Needs a volume trend: there is not enough sales history yet.";
}
```

### Step 4. `app/lib/serverMarketData.ts`: full price history for the product page

4a. In `fetchProductDetailRows` (WP11 block A), replace the first element of the `Promise.all` (the `supabase.from("product_price_history")...order("recorded_at", { ascending: true })` query) with a paged, newest-first read of the whole history:

```ts
    // Full history (WP31: the chart's Max range and CAGR since the first
    // tracked price). Paged because PostgREST caps a response at 1000 rows;
    // newest first so a cap would cut the oldest rows, never the newest.
    // groupHistoryRowsByProduct re-sorts ascending.
    fetchAllRows("product_price_history", (from, to) =>
      supabase
        .from("product_price_history")
        .select("product_id, usd_price, recorded_at")
        .eq("product_id", productId)
        .order("recorded_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
    ).then(
      (rows) => ({ data: rows, error: null }),
      (error: unknown) => ({ data: null, error })
    ),
```

Keep the destructuring `{ data: historyRows, error }` and the following `if (error) { throw error; }` unchanged. Delete the now-unused `startDate`/`startDateStr` lines of the price query (the sales query keeps its own `salesStartDate`). If `tsc` complains that `historyRows` is `unknown[]`, give `fetchAllRows` the row type explicitly: `fetchAllRows<{ product_id: number; usd_price: number; recorded_at: string }>(...)`.

4b. Change the cache key of `getCachedProductDetailRows` from `["product-detail-rows"]` to `["product-detail-rows", "full-history"]`, so entries written with the 367-day window are never read as full history. Update the comment above it: "A new key when the cached value's content changes (WP11 shape, WP31 full history)."

4c. Only if WP26's `getCachedProductHistory` exists (soft check c): keep its 367-day contract for `/api/public/history/[id]`. Add the import `import { historySince } from "./productChart";` and change its body to:

```ts
  const rows = await getCachedProductDetailRows(productId);
  return historySince(rows.history, 367);
```

and its doc comment's first line to "One product's price history (the last 367 days), from the same cached rows as /product/[id]".

4d. Update the comment in block C that says "History is fetched 367 days back, so a product last priced before that window has an empty history and is correctly treated as unpriced." to: "History is the full recorded series; a product last priced more than PRICE_STALENESS_TOLERANCE_DAYS ago keeps its history and is withheld by the timestamp check below."

### Step 5. `app/lib/productChart.ts` (new): chart payload and view

Isomorphic and pure. The server page imports `buildChartPayload`; `ProductPriceChartImpl` (lazy) imports `buildChartView`; client components import its types only (`import type`). If `SalesHistoryEntry` is not exported from `app/types/market.ts`, import it from the module `serverMarketData.ts` imports it from.

```ts
/**
 * The product page chart (WP31): the compact payload the server embeds and
 * the view the lazy Recharts component draws. Pure. Runtime imports only
 * from the server page, serverMarketData and components/charts (the lazy
 * ChartBundle chunk); client components use `import type`.
 */
import { rateOn, sliceFxSeries, type FxDailySeries } from "./fx";
import { formatDateOnly, formatMonthDay, recordedAtDateKey } from "./format";
import { dateKeyUtcMs, DAY_MS, recordedDayKey, toDailyPoints, type HistoryRow } from "./marketMath";
import { PRICE_STALENESS_TOLERANCE_DAYS } from "./marketPulse";
import { returnAnchorToleranceDays } from "./marketStats";
import type { SalesHistoryEntry } from "../types/market";

export const CHART_RANGES = ["7D", "1M", "3M", "6M", "1Y", "MAX"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];
export const RANGE_DAYS: Readonly<Record<Exclude<ChartRange, "MAX">, number>> = {
  "7D": 7,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
};
export const DEFAULT_CHART_RANGE: ChartRange = "1Y";
export const MOVING_AVERAGE_DAYS = 30;
export const MOVING_AVERAGE_MIN_POINTS = 20;
export const DAILY_VOLUME_MAX_SPAN_DAYS = 92;

export interface CompactSeries {
  d: string[];
  v: number[];
}

export interface ChartPayload {
  /** USD Market Price, oldest first; weekly points before dailySince. */
  price: CompactSeries;
  /** First day recorded by the daily collector; null when there is none. */
  dailySince: string | null;
  volumeDaily: CompactSeries;
  /** TCGplayer weekly buckets; d is the bucket's Monday. */
  volumeWeekly: CompactSeries;
  /** fx_daily from the first price day (WP25). */
  fx: FxDailySeries;
  /** The page withholds the current price (migration 0023). */
  withheld: boolean;
  releaseDate: string | null;
}

export interface IndexOverlay {
  name: string;
  days: readonly string[];
  levels: readonly number[];
}

export interface ChartRow {
  t: number;
  dateKey: string;
  /** Display-currency price, for the tooltip; null on a line break. */
  price: number | null;
  weekly: number | null;
  daily: number | null;
  ma30: number | null;
  bench: number | null;
  benchChange: number | null;
  coarse: boolean;
  units: number | null;
  unitsWeekly: boolean;
  unitsPartial: boolean;
}

export interface VolumeBar {
  t: number;
  dateKey: string;
  units: number;
  weekly: boolean;
  partial: boolean;
}

export interface ChartView {
  empty: boolean;
  currency: "USD" | "CAD";
  notes: string[];
  rows: ChartRow[];
  volume: VolumeBar[];
  volumeResolution: "daily" | "weekly" | null;
  domain: [number, number];
  xTicks: Array<{ t: number; label: string }>;
  y: { min: number; max: number; ticks: number[]; decimals: 0 | 2 };
  volumeY: { max: number; ticks: number[] } | null;
  last: { t: number; value: number; label: string; dateKey: string } | null;
  change: { pct: number; fromKey: string; toKey: string } | null;
  trackedSince: string | null;
  dashedBefore: string | null;
  weeklyOnly: boolean;
  benchmarkStart: string | null;
  releaseT: number | null;
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Days since 1970-01-01 for a YYYY-MM-DD key, or null. */
export function dayNumber(key: string): number | null {
  const ms = dateKeyUtcMs(key);
  return ms === null ? null : Math.round(ms / DAY_MS);
}

export function dayKey(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

function weekday(n: number): number {
  return new Date(n * DAY_MS).getUTCDay();
}

/** The Monday on or before day n. */
export function mondayOf(n: number): number {
  return n - ((weekday(n) + 6) % 7);
}

// backfill_historical_prices.py writes "YYYY-MM-DD 12:00:00" for every
// backfilled day; the scraper writes now() with microseconds.
const BACKFILL_TIME_RE = /[T ]12:00:00(?:\.0+)?(?:Z|[+-]00(?::?00)?)?$/;

export function isBackfillTimestamp(recordedAt: string): boolean {
  return BACKFILL_TIME_RE.test(recordedAt.trim());
}

/** The earliest day written by the daily collector, or null. */
export function firstDailyCollectionDay(history: readonly HistoryRow[]): string | null {
  let first: string | null = null;
  for (const row of history) {
    if (isBackfillTimestamp(row.recorded_at)) continue;
    const key = recordedDayKey(row.recorded_at);
    if (key !== null && (first === null || key < first)) first = key;
  }
  return first;
}

/** Rows whose UTC day is within the last `days` days (for the 367-day history route). */
export function historySince<T extends HistoryRow>(
  history: readonly T[],
  days: number,
  now: Date = new Date()
): T[] {
  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
  return history.filter((row) => {
    const key = recordedAtDateKey(row.recorded_at);
    return key !== null && key >= cutoff;
  });
}

export function buildChartPayload({
  history,
  salesHistory,
  fx,
  withheld,
  releaseDate,
}: {
  history: readonly HistoryRow[];
  salesHistory: readonly SalesHistoryEntry[];
  fx: FxDailySeries;
  withheld: boolean;
  releaseDate: string | null | undefined;
}): ChartPayload {
  const points = toDailyPoints(history);
  const dailySince = firstDailyCollectionDay(history);
  const price: CompactSeries = { d: [], v: [] };
  points.forEach((point, i) => {
    const coarse = dailySince === null || point.dateKey < dailySince;
    if (coarse) {
      const next = points[i + 1];
      const lastCoarse = next === undefined || (dailySince !== null && next.dateKey >= dailySince);
      const n = dayNumber(point.dateKey);
      const monday = n !== null && weekday(n) === 1;
      if (!(i === 0 || monday || lastCoarse)) return;
    }
    price.d.push(point.dateKey);
    price.v.push(point.price);
  });

  const volumeDaily: CompactSeries = { d: [], v: [] };
  const volumeWeekly: CompactSeries = { d: [], v: [] };
  const sortedSales = [...salesHistory].sort((a, b) => (a.bucket_date < b.bucket_date ? -1 : a.bucket_date > b.bucket_date ? 1 : 0));
  for (const row of sortedSales) {
    // A NULL quantity is unknown, never zero (migrations 0018 to 0021).
    if (typeof row.quantity_sold !== "number" || !DAY_KEY_RE.test(row.bucket_date)) continue;
    const target = row.granularity === "day" ? volumeDaily : row.granularity === "week" ? volumeWeekly : null;
    if (target === null) continue;
    target.d.push(row.bucket_date);
    target.v.push(row.quantity_sold);
  }

  return {
    price,
    dailySince,
    volumeDaily,
    volumeWeekly,
    fx: price.d.length > 0 ? sliceFxSeries(fx, price.d[0]) : fx,
    withheld,
    releaseDate: releaseDate ? releaseDate.slice(0, 10) : null,
  };
}

/**
 * Five round-number ticks: the step is 1, 2, 2.5 or 5 x 10^k, the domain
 * runs from the tick at or below min to the tick at or above max, never
 * below 0 when the data is not.
 */
export function niceTicks(
  min: number,
  max: number,
  target = 5
): { min: number; max: number; ticks: number[]; step: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1], step: 1 };
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (hi - lo < 1e-9) {
    const pad = Math.max(Math.abs(hi) * 0.02, 1);
    lo -= pad;
    hi += pad;
  }
  const rough = (hi - lo) / (target - 1);
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough - 1e-12) ?? 10 * power;
  let niceLo = Math.floor(lo / step + 1e-9) * step;
  if (niceLo < 0 && Math.min(min, max) >= 0) niceLo = 0;
  const niceHi = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = niceLo; v <= niceHi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { min: ticks[0], max: ticks[ticks.length - 1], ticks, step };
}

const MONTH = (key: string) => formatMonthDay(key).split(" ")[0];

/** At most `maxTicks` x-axis ticks between two day numbers, inclusive. */
export function timeTicks(startN: number, endN: number, maxTicks = 5): Array<{ t: number; label: string }> {
  const span = endN - startN;
  if (span <= 0) return [{ t: startN, label: formatMonthDay(dayKey(startN)) }];
  if (span <= 62) {
    const step = [1, 2, 7, 14, 21].find((s) => span / s <= maxTicks - 1) ?? 28;
    let first = startN;
    if (step >= 7) {
      first = mondayOf(startN);
      if (first < startN) first += 7;
    }
    const ticks: Array<{ t: number; label: string }> = [];
    for (let n = first; n <= endN; n += step) ticks.push({ t: n, label: formatMonthDay(dayKey(n)) });
    return ticks;
  }
  const months = [1, 2, 3, 6, 12].find((m) => span / (30.44 * m) <= maxTicks - 1) ?? 24;
  const start = new Date(startN * DAY_MS);
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  if (start.getUTCDate() > 1) month += 1;
  while (month % months !== 0) month += 1;
  const ticks: Array<{ t: number; label: string }> = [];
  for (;;) {
    year += Math.floor(month / 12);
    month %= 12;
    const n = Math.round(Date.UTC(year, month, 1) / DAY_MS);
    if (n > endN) break;
    const key = dayKey(n);
    const withYear = ticks.length === 0 || month === 0;
    ticks.push({ t: n, label: withYear ? `${MONTH(key)} ${year}` : MONTH(key) });
    month += months;
  }
  return ticks;
}

function buildVolumeBars(
  payload: ChartPayload,
  startN: number,
  endN: number
): { bars: VolumeBar[]; resolution: "daily" | "weekly" | null } {
  const daily = new Map<number, number>();
  payload.volumeDaily.d.forEach((key, i) => {
    const n = dayNumber(key);
    if (n !== null) daily.set(n, (daily.get(n) ?? 0) + payload.volumeDaily.v[i]);
  });
  const weeklyRows = new Map<number, number>();
  payload.volumeWeekly.d.forEach((key, i) => {
    const n = dayNumber(key);
    if (n !== null) weeklyRows.set(mondayOf(n), payload.volumeWeekly.v[i]);
  });

  if (endN - startN + 1 <= DAILY_VOLUME_MAX_SPAN_DAYS) {
    const covered = [...daily.keys()].filter((n) => n >= startN && n <= endN).sort((a, b) => a - b);
    if (covered.length > 0) {
      const bars: VolumeBar[] = [];
      // Interior days are zero-filled: TCGplayer writes explicit zero buckets.
      for (let n = covered[0]; n <= covered[covered.length - 1]; n += 1) {
        bars.push({ t: n, dateKey: dayKey(n), units: daily.get(n) ?? 0, weekly: false, partial: false });
      }
      return { bars, resolution: "daily" };
    }
  }

  const bars: VolumeBar[] = [];
  for (let monday = mondayOf(startN); monday <= endN; monday += 7) {
    let sum = 0;
    let days = 0;
    for (let n = monday; n < monday + 7; n += 1) {
      const units = daily.get(n);
      if (units !== undefined) {
        sum += units;
        days += 1;
      }
    }
    const weekRow = weeklyRows.get(monday);
    let units: number | null = null;
    let partial = false;
    if (days === 7) units = sum;
    else if (weekRow !== undefined) units = weekRow;
    else if (days > 0) {
      units = sum;
      partial = true;
    }
    if (units === null) continue;
    bars.push({ t: Math.max(monday, startN), dateKey: dayKey(monday), units, weekly: true, partial });
  }
  return { bars, resolution: bars.length > 0 ? "weekly" : null };
}

const EMPTY_Y = { min: 0, max: 1, ticks: [0, 1], decimals: 0 as const };

export function buildChartView({
  payload,
  range,
  currency,
  benchmark,
}: {
  payload: ChartPayload;
  range: ChartRange;
  currency: "USD" | "CAD";
  benchmark: IndexOverlay | null;
}): ChartView {
  const all = payload.price.d
    .map((dateKey, i) => ({ dateKey, n: dayNumber(dateKey), usd: payload.price.v[i] }))
    .filter((p): p is { dateKey: string; n: number; usd: number } => p.n !== null && Number.isFinite(p.usd) && p.usd > 0);

  const displayCurrency: "USD" | "CAD" = currency === "CAD" && payload.fx.start !== null ? "CAD" : "USD";
  const notes: string[] = [];
  if (currency === "CAD" && displayCurrency === "USD") notes.push("Shown in USD: Bank of Canada rates are unavailable.");

  if (all.length < 2) {
    return {
      empty: true, currency: displayCurrency, notes, rows: [], volume: [], volumeResolution: null,
      domain: [0, 1], xTicks: [], y: EMPTY_Y, volumeY: null, last: null, change: null,
      trackedSince: null, dashedBefore: null, weeklyOnly: false, benchmarkStart: null, releaseT: null,
    };
  }

  const convert = (key: string, usd: number): number | null => {
    if (displayCurrency === "USD") return usd;
    const rate = rateOn(payload.fx, key);
    return rate === null ? null : usd * rate;
  };
  const isCoarse = (key: string) => payload.dailySince === null || key < payload.dailySince;

  const firstN = all[0].n;
  const endN = all[all.length - 1].n;
  // The range starts at the anchor the change chips use (WP25 / WP10 rule):
  // the newest point on or before end - N, no older than end - N - tol.
  // Without one, at end - N + 1 clamped to the first point.
  let startN = firstN;
  let trackedSince: string | null = null;
  if (range !== "MAX") {
    const days = RANGE_DAYS[range];
    const anchorMax = endN - days;
    const anchorMin = anchorMax - returnAnchorToleranceDays(days);
    let anchor: number | null = null;
    for (let i = all.length - 1; i >= 0; i -= 1) {
      if (all[i].n > anchorMax) continue;
      if (all[i].n >= anchorMin) anchor = all[i].n;
      break;
    }
    const requestedStart = endN - days + 1;
    startN = anchor ?? Math.max(firstN, requestedStart);
    trackedSince = anchor === null && requestedStart < firstN ? all[0].dateKey : null;
  }

  // 30-day average of daily-collected points, in the display currency.
  const ma = new Map<number, number>();
  const dailyPoints = all.filter((p) => !isCoarse(p.dateKey)).map((p) => ({ n: p.n, value: convert(p.dateKey, p.usd) }));
  let lo = 0;
  let sum = 0;
  let count = 0;
  for (let hi = 0; hi < dailyPoints.length; hi += 1) {
    const add = dailyPoints[hi].value;
    if (add !== null) {
      sum += add;
      count += 1;
    }
    while (dailyPoints[lo].n < dailyPoints[hi].n - (MOVING_AVERAGE_DAYS - 1)) {
      const drop = dailyPoints[lo].value;
      if (drop !== null) {
        sum -= drop;
        count -= 1;
      }
      lo += 1;
    }
    if (count >= MOVING_AVERAGE_MIN_POINTS) ma.set(dailyPoints[hi].n, sum / count);
  }

  let visible = all.filter((p) => p.n >= startN);
  if (visible.length < 2) visible = all.slice(-2);
  const domainStart = visible[0].n;

  const { bars, resolution } = buildVolumeBars(payload, domainStart, endN);
  const barFor = (n: number): VolumeBar | null => {
    for (const bar of bars) {
      if (!bar.weekly && bar.t === n) return bar;
      if (bar.weekly) {
        const monday = dayNumber(bar.dateKey);
        if (monday !== null && n >= monday && n < monday + 7) return bar;
      }
    }
    return null;
  };

  const levels = benchmark ? new Map(benchmark.days.map((day, i) => [day, benchmark.levels[i]])) : null;
  let base: { usd: number; level: number; key: string } | null = null;
  if (levels) {
    for (const p of visible) {
      const level = levels.get(p.dateKey);
      if (level !== undefined && Number.isFinite(level) && level > 0) {
        base = { usd: p.usd, level, key: p.dateKey };
        break;
      }
    }
    if (base === null) notes.push("The index has no values in this range.");
  }

  const benchBase = base;
  const rows: ChartRow[] = [];
  let prev: (typeof visible)[number] | null = null;
  let cadGapBeforeStart = false;
  let cadGapInside = false;
  for (const p of visible) {
    if (prev !== null && p.n - prev.n > PRICE_STALENESS_TOLERANCE_DAYS) {
      // A gap longer than the price guard's tolerance breaks the line.
      rows.push({
        t: prev.n + 1, dateKey: dayKey(prev.n + 1), price: null, weekly: null, daily: null, ma30: null,
        bench: null, benchChange: null, coarse: false, units: null, unitsWeekly: false, unitsPartial: false,
      });
    }
    const value = convert(p.dateKey, p.usd);
    if (value === null) {
      if (payload.fx.start !== null && p.dateKey < payload.fx.start) cadGapBeforeStart = true;
      else cadGapInside = true;
    }
    const coarse = isCoarse(p.dateKey);
    // The first daily point is repeated in the dashed series so the two join.
    const joinsDashed = !coarse && prev !== null && isCoarse(prev.dateKey);
    const level = levels?.get(p.dateKey);
    const ratio =
      benchBase !== null && level !== undefined && Number.isFinite(level) && level > 0 ? level / benchBase.level : null;
    const bar = barFor(p.n);
    rows.push({
      t: p.n,
      dateKey: p.dateKey,
      price: value,
      weekly: coarse || joinsDashed ? value : null,
      daily: coarse ? null : value,
      ma30: coarse ? null : ma.get(p.n) ?? null,
      bench: ratio !== null && benchBase !== null ? convert(p.dateKey, benchBase.usd * ratio) : null,
      benchChange: ratio !== null ? (ratio - 1) * 100 : null,
      coarse,
      units: bar ? bar.units : null,
      unitsWeekly: bar ? bar.weekly : false,
      unitsPartial: bar ? bar.partial : false,
    });
    prev = p;
  }

  if (cadGapBeforeStart && payload.fx.start !== null) {
    notes.push(`CAD starts ${formatDateOnly(payload.fx.start)}: earlier points have no Bank of Canada rate.`);
  }
  if (cadGapInside) notes.push("Days without a Bank of Canada rate are left blank.");

  const values = rows.flatMap((r) => [r.weekly, r.daily, r.ma30, r.bench]).filter((v): v is number => v !== null);
  const ticks = values.length > 0 ? niceTicks(Math.min(...values), Math.max(...values)) : { ...EMPTY_Y, step: 1 };
  const decimals: 0 | 2 = Number.isInteger(ticks.step) ? 0 : 2;

  const priced = rows.filter((r): r is ChartRow & { price: number } => r.price !== null);
  const lastRow = priced[priced.length - 1] ?? null;
  const firstRow = priced[0] ?? null;
  const volumeMax = bars.length > 0 ? niceTicks(0, Math.max(...bars.map((b) => b.units), 1), 2) : null;

  const releaseN = payload.releaseDate ? dayNumber(payload.releaseDate) : null;

  return {
    empty: false,
    currency: displayCurrency,
    notes,
    rows,
    volume: bars,
    volumeResolution: resolution,
    domain: [domainStart, endN],
    xTicks: timeTicks(domainStart, endN),
    y: { min: ticks.min, max: ticks.max, ticks: ticks.ticks, decimals },
    volumeY: volumeMax ? { max: volumeMax.max, ticks: [0, volumeMax.max] } : null,
    last: lastRow ? { t: lastRow.t, value: lastRow.price, label: formatMonthDay(lastRow.dateKey), dateKey: lastRow.dateKey } : null,
    change:
      !payload.withheld && firstRow && lastRow && firstRow !== lastRow && firstRow.price > 0
        ? { pct: (lastRow.price / firstRow.price - 1) * 100, fromKey: firstRow.dateKey, toKey: lastRow.dateKey }
        : null,
    trackedSince,
    dashedBefore: rows.some((r) => r.coarse) && payload.dailySince !== null ? payload.dailySince : null,
    weeklyOnly: payload.dailySince === null,
    benchmarkStart: base ? base.key : null,
    releaseT: releaseN !== null && releaseN >= domainStart && releaseN <= endN ? releaseN : null,
  };
}
```

### Step 6. `app/product/[id]/productModel.ts` (new): quote, key stats, recorded history, pulse, siblings

```ts
/**
 * The product decision page's numbers (WP31). Pure: the page passes its
 * cached reads in, tests pass fixtures. Every price-anchored figure is null
 * unless the page shows a current price (migration 0023), every CAD figure
 * carries the rate it used, and history figures state their window.
 */
import type { Product, ProductDailyStats, SalesHistoryEntry } from "../../types/market";
import type { ProductListingsSnapshot } from "../../lib/serverMarketData";
import type { ProductAttributesSnapshot } from "../../lib/productAttributes";
import { STALE_AFTER_DAYS } from "../../components/ui/AsOf";
import { recordedAtDateKey } from "../../lib/format";
import { cadReturnPercent, rateOn, usdToCadOn, type FxDailySeries } from "../../lib/fx";
import { cagrPercent, dateKeyUtcMs, DAY_MS, maxDrawdownPercent, type DailyPoint } from "../../lib/marketMath";
import { ONE_DAY_PREVIOUS_MAX_GAP_DAYS, RETURN_ANCHOR_WINDOWS } from "../../lib/marketStats";
import {
  getDaysOfSupply,
  getPriorUnitsSold30d,
  getPulseMissingReason,
  getPulseSignal,
  getUnitsSoldWindow,
  getVolumeTrendPercent,
  isListingsSnapshotFresh,
  PULSE_SIGNAL_META,
  type PulseTone,
} from "../../lib/marketPulse";
import { hasCurrentPrice } from "../../lib/priceGuard";
import { isNavStatus, NAV_STATUS_TEXT } from "../../lib/productAttributes";
import { getProductLabel, productPath } from "./productMeta";
```

If `Product` or `SalesHistoryEntry` is not exported from `app/types/market.ts`, import them from the module `page.tsx` imports `Product` from today. If `ProductListingsSnapshot` is not exported from `serverMarketData.ts`, export it there (it is a type; add `export` to its declaration).

**WP28 absent** (soft check a failed): delete the two `productAttributes` imports, replace `ProductAttributesSnapshot` in this file with `null`-typed parameters (`attributes: null`), make `buildStructure` return `null` unconditionally with the comment `// WP28 not merged: structure figures hidden.`, and delete `navReason`.

```ts
export const CAGR_MIN_DAYS = 365;
export const CHANGE_WINDOWS = ["1D", "7D", "30D", "1Y"] as const;
export type ChangeWindow = (typeof CHANGE_WINDOWS)[number];
export type ChangeRow = Record<ChangeWindow, number | null>;

/** A USD amount and its CAD value at a stated rate (null when no rate exists). */
export interface MoneyPair {
  usd: number;
  cad: number | null;
}

export interface QuoteRate {
  rate: number;
  /** The day the rate is for. */
  day: string;
  /** "dated": fx_daily for the price's day. "latest": the newest rate, labelled so. */
  kind: "dated" | "latest";
}

export type QuoteState = "fresh" | "aging" | "withheld" | "never";

export interface QuoteModel {
  state: QuoteState;
  priceDay: string | null;
  ageDays: number | null;
  price: MoneyPair | null;
  rate: QuoteRate | null;
  changes: { usd: ChangeRow; cad: ChangeRow | null } | null;
  listing: {
    lowest: MoneyPair | null;
    count: number | null;
    snapshotDay: string;
    /** Lowest ask vs Market Price in percent points (stats.ask_premium_pct); null unless the stats row agrees. */
    askPremiumPct: number | null;
  } | null;
}

export interface LatestRate {
  rate: number;
  date: string | null;
}

const NO_CHANGES: ChangeRow = { "1D": null, "7D": null, "30D": null, "1Y": null };

/** Today's UTC date key. A function so render code stays lint-pure. */
export function todayUtcKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addDays(key: string, days: number): string {
  const ms = dateKeyUtcMs(key);
  if (ms === null) throw new Error(`addDays: bad date key ${key}`);
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

export function dayDiff(fromKey: string, toKey: string): number | null {
  const from = dateKeyUtcMs(fromKey);
  const to = dateKeyUtcMs(toKey);
  return from === null || to === null ? null : Math.round((to - from) / DAY_MS);
}

/** Noon UTC of a day: the same calendar day in every zone from UTC-11 to UTC+11. */
function referenceDateFor(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}

export function money(usd: number, rate: QuoteRate | null): MoneyPair {
  return { usd, cad: rate === null ? null : usd * rate.rate };
}

export function quoteRate(fx: FxDailySeries, day: string, latest: LatestRate): QuoteRate | null {
  const dated = rateOn(fx, day);
  if (dated !== null) return { rate: dated, day, kind: "dated" };
  if (latest.date !== null && Number.isFinite(latest.rate) && latest.rate > 0) {
    return { rate: latest.rate, day: latest.date.slice(0, 10), kind: "latest" };
  }
  return null;
}

/** Newest point with minKey <= day <= maxKey (points oldest first). */
function anchorBetween(points: readonly DailyPoint[], minKey: string, maxKey: string): DailyPoint | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const key = points[i].dateKey;
    if (key > maxKey) continue;
    return key >= minKey ? points[i] : null;
  }
  return null;
}

function statsAgree(stats: ProductDailyStats | null, priceDay: string | null, usd: number): stats is ProductDailyStats {
  return (
    stats !== null &&
    stats.is_price_fresh &&
    priceDay !== null &&
    stats.price_day === priceDay &&
    typeof stats.usd_price === "number" &&
    Math.abs(stats.usd_price - usd) < 0.005
  );
}

const WINDOW_SOURCES: ReadonlyArray<{ window: ChangeWindow; statKey: "ret_7d" | "ret_30d" | "ret_365d" }> = [
  { window: "7D", statKey: "ret_7d" },
  { window: "30D", statKey: "ret_30d" },
  { window: "1Y", statKey: "ret_365d" },
];

function buildChanges(
  stats: ProductDailyStats,
  points: readonly DailyPoint[],
  fx: FxDailySeries,
  priceDay: string,
  usd: number
): { usd: ChangeRow; cad: ChangeRow | null } {
  const usdRow: ChangeRow = {
    "1D": stats.ret_1d,
    "7D": stats.ret_7d,
    "30D": stats.ret_30d,
    "1Y": stats.ret_365d,
  };
  const cadRow: ChangeRow = { ...NO_CHANGES };
  let cadComplete = true;

  const convert = (window: ChangeWindow, anchor: DailyPoint | null) => {
    const statValue = usdRow[window];
    if (statValue === null) return;
    if (anchor === null) {
      cadComplete = false;
      return;
    }
    const recomputed = (usd / anchor.price - 1) * 100;
    if (Math.abs(recomputed - statValue) > 0.05) {
      cadComplete = false;
      return;
    }
    const cad = cadReturnPercent(fx, { day: anchor.dateKey, usd: anchor.price }, { day: priceDay, usd });
    if (cad === null) cadComplete = false;
    else cadRow[window] = cad;
  };

  convert("1D", anchorBetween(points, addDays(priceDay, -ONE_DAY_PREVIOUS_MAX_GAP_DAYS), addDays(priceDay, -1)));
  for (const { window, statKey } of WINDOW_SOURCES) {
    const spec = RETURN_ANCHOR_WINDOWS.find((w) => w.key === statKey);
    if (!spec) {
      cadComplete = false;
      continue;
    }
    convert(window, anchorBetween(points, addDays(stats.day, -spec.days - spec.toleranceDays), addDays(stats.day, -spec.days)));
  }
  return { usd: usdRow, cad: cadComplete ? cadRow : null };
}

export interface QuoteInput {
  product: Product;
  stats: ProductDailyStats | null;
  /** Full history as daily points (toDailyPoints), oldest first. */
  points: readonly DailyPoint[];
  listings: ProductListingsSnapshot | null;
  fx: FxDailySeries;
  latestRate: LatestRate;
  today: string;
}

export function buildQuote({ product, stats, points, listings, fx, latestRate, today }: QuoteInput): QuoteModel {
  const priceDay = recordedAtDateKey(product.price_recorded_at ?? null);
  if (!hasCurrentPrice(product) || typeof product.usd_price !== "number") {
    return {
      state: priceDay ? "withheld" : "never",
      priceDay,
      ageDays: null,
      price: null,
      rate: null,
      changes: null,
      listing: null,
    };
  }
  const usd = product.usd_price;
  const ageDays = priceDay ? dayDiff(priceDay, today) : null;
  const state: QuoteState = ageDays !== null && ageDays >= STALE_AFTER_DAYS ? "aging" : "fresh";
  const rate = quoteRate(fx, priceDay ?? today, latestRate);
  const changes =
    priceDay !== null && statsAgree(stats, priceDay, usd)
      ? buildChanges(stats, points, fx, priceDay, usd)
      : { usd: { ...NO_CHANGES }, cad: null };

  // One source for the whole line: the stats row when it carries a snapshot,
  // else the page's own latest snapshot. Never a date from one and a price
  // from the other.
  const fromStats = typeof stats?.listings_snapshot_date === "string";
  const snapshotDay = (fromStats ? stats?.listings_snapshot_date : listings?.snapshot_date)?.slice(0, 10) ?? null;
  let listing: QuoteModel["listing"] = null;
  if (snapshotDay !== null && isListingsSnapshotFresh(snapshotDay, referenceDateFor(today))) {
    const lowest = fromStats ? stats?.lowest_ask_usd ?? null : listings?.lowest_listing_price ?? null;
    const count = fromStats ? stats?.active_listings ?? null : listings?.active_listings ?? null;
    if (lowest !== null || count !== null) {
      listing = {
        lowest: lowest === null ? null : money(lowest, rate),
        count,
        snapshotDay,
        askPremiumPct:
          fromStats && priceDay !== null && statsAgree(stats, priceDay, usd) ? stats.ask_premium_pct : null,
      };
    }
  }

  return { state, priceDay, ageDays, price: money(usd, rate), rate, changes, listing };
}

/** CAGR from the first tracked price, only with CAGR_MIN_DAYS or more of history. */
export function cagrSinceFirstTracked(
  points: readonly DailyPoint[],
  price: number | null,
  priceDay: string | null
): { value: number; since: string; days: number } | null {
  if (price === null || priceDay === null || points.length === 0) return null;
  const first = points[0];
  const startMs = dateKeyUtcMs(first.dateKey);
  const endMs = dateKeyUtcMs(priceDay);
  if (startMs === null || endMs === null) return null;
  const days = Math.round((endMs - startMs) / DAY_MS);
  if (days < CAGR_MIN_DAYS) return null;
  const value = cagrPercent(first.price, price, startMs, endMs);
  return value === null ? null : { value, since: first.dateKey, days };
}

/** Max drawdown over the 365 days ending at endKey (inclusive). */
export function maxDrawdownOverYear(
  points: readonly DailyPoint[],
  endKey: string
): { value: number; from: string; to: string } | null {
  const from = addDays(endKey, -364);
  const prices = points.filter((p) => p.dateKey >= from && p.dateKey <= endKey).map((p) => p.price);
  const value = maxDrawdownPercent(prices);
  return value === null ? null : { value, from, to: endKey };
}

export interface KeyStatsModel {
  rate: QuoteRate | null;
  range: {
    low: MoneyPair;
    high: MoneyPair;
    value: MoneyPair;
    windowLabel: "52-week" | "tracked";
    since: string | null;
  } | null;
  trackedHigh: { high: MoneyPair; day: string; since: string; belowPct: number | null } | null;
  cagr: { value: number; since: string } | null;
  structure: {
    msrpMultiple: number | null;
    msrpUsd: number | null;
    msrpSource: string | null;
    costPerPack: MoneyPair | null;
    packCount: number | null;
    nav: { value: MoneyPair | null; premiumPct: number | null; reason: string | null } | null;
  } | null;
  liquidity: {
    unitsSold30d: number | null;
    sellThrough30d: number | null;
    daysOfSupply: number | null;
    liquidityScore: number | null;
    typeLabel: string;
  };
  risk: { volatilityWeekly: number | null; maxDrawdown1y: { value: number; from: string; to: string } | null };
}

type StructureFields = {
  msrp_multiple?: number | null;
  cost_per_pack_usd?: number | null;
  nav_usd?: number | null;
  premium_to_packs_pct?: number | null;
  nav_status?: string | null;
};

function navReason(status: string | null | undefined): string {
  if (isNavStatus(status)) return NAV_STATUS_TEXT[status];
  return "Pack value is computed with the next daily refresh.";
}

function buildStructure(
  productId: number,
  stats: ProductDailyStats | null,
  statsOk: boolean,
  attributes: ProductAttributesSnapshot | null,
  rate: QuoteRate | null
): KeyStatsModel["structure"] {
  const s = (stats ?? {}) as StructureFields;
  const attrs = attributes?.byProductId[productId] ?? null;
  const hasContents = (attributes?.contentsByProductId[productId]?.length ?? 0) > 0;
  const msrpMultiple = statsOk ? s.msrp_multiple ?? null : null;
  const costPerPackUsd = statsOk ? s.cost_per_pack_usd ?? null : null;
  const nav = hasContents
    ? statsOk && s.nav_status === "ok" && typeof s.nav_usd === "number"
      ? { value: money(s.nav_usd, rate), premiumPct: s.premium_to_packs_pct ?? null, reason: null }
      : { value: null, premiumPct: null, reason: navReason(s.nav_status) }
    : null;
  const msrpUsd = attrs?.msrp_usd ?? null;
  if (msrpMultiple === null && msrpUsd === null && costPerPackUsd === null && nav === null) return null;
  return {
    msrpMultiple,
    msrpUsd,
    msrpSource: attrs?.msrp_source ?? null,
    costPerPack: costPerPackUsd === null ? null : money(costPerPackUsd, rate),
    packCount: attrs?.pack_count ?? null,
    nav,
  };
}

export interface KeyStatsInput {
  quote: QuoteModel;
  product: Product;
  stats: ProductDailyStats | null;
  points: readonly DailyPoint[];
  salesHistory: SalesHistoryEntry[];
  listings: ProductListingsSnapshot | null;
  attributes: ProductAttributesSnapshot | null;
  today: string;
}

/** Null unless the page shows a current price: headline stats are withheld with it. */
export function buildKeyStats(input: KeyStatsInput): KeyStatsModel | null {
  const { quote, product, stats, points, salesHistory, listings, attributes, today } = input;
  if ((quote.state !== "fresh" && quote.state !== "aging") || quote.price === null) return null;
  const usd = quote.price.usd;
  const rate = quote.rate;
  const statsOk = statsAgree(stats, quote.priceDay, usd);

  let range: KeyStatsModel["range"] = null;
  if (stats && typeof stats.low_52w === "number" && typeof stats.high_52w === "number" && stats.high_52w > stats.low_52w) {
    const span = stats.first_tracked_day ? dayDiff(stats.first_tracked_day, stats.day) : null;
    const tracked = span !== null && span < 364;
    range = {
      low: money(stats.low_52w, rate),
      high: money(stats.high_52w, rate),
      value: quote.price,
      windowLabel: tracked ? "tracked" : "52-week",
      since: tracked ? stats.first_tracked_day : null,
    };
  }

  let trackedHigh: KeyStatsModel["trackedHigh"] = null;
  if (stats && typeof stats.tracked_high_usd === "number" && stats.tracked_high_usd > 0 && stats.tracked_high_day && stats.first_tracked_day) {
    const below = (usd / stats.tracked_high_usd - 1) * 100;
    trackedHigh = {
      high: money(stats.tracked_high_usd, rate),
      day: stats.tracked_high_day,
      since: stats.first_tracked_day,
      belowPct: below >= -0.05 ? null : -below,
    };
  }

  const cagr = cagrSinceFirstTracked(points, usd, quote.priceDay);

  // Liquidity: the daily stats row, else the page's own sales and listings.
  const ref = referenceDateFor(today);
  const freshSnapshot = isListingsSnapshotFresh(listings?.snapshot_date, ref);
  const fallbackUnits = getUnitsSoldWindow(salesHistory, 30, 0, ref);
  const fallbackQty = freshSnapshot ? listings?.total_quantity_available ?? null : null;
  const liquidity = stats
    ? {
        unitsSold30d: stats.units_sold_30d,
        sellThrough30d: stats.sell_through_30d,
        daysOfSupply: stats.days_of_supply,
        liquidityScore: stats.liquidity_score,
      }
    : {
        unitsSold30d: fallbackUnits,
        sellThrough30d:
          fallbackUnits !== null && fallbackQty !== null && fallbackUnits + fallbackQty > 0
            ? (fallbackUnits / (fallbackUnits + fallbackQty)) * 100
            : null,
        daysOfSupply: getDaysOfSupply(fallbackQty, fallbackUnits),
        liquidityScore: null,
      };

  return {
    rate,
    range,
    trackedHigh,
    cagr: cagr ? { value: cagr.value, since: cagr.since } : null,
    structure: buildStructure(product.id, stats, statsOk, attributes, rate),
    liquidity: { ...liquidity, typeLabel: getProductLabel(product) },
    risk: {
      volatilityWeekly: stats?.vol_weekly_52w ?? null,
      maxDrawdown1y: quote.priceDay ? maxDrawdownOverYear(points, quote.priceDay) : null,
    },
  };
}

export interface RecordedHistoryModel {
  lastDay: string;
  trackedHigh: { high: MoneyPair; day: string } | null;
  maxDrawdown1y: { value: number; from: string; to: string } | null;
  volatilityWeekly: number | null;
}

/** Withheld price only: history metrics, dated to the last recorded day. */
export function buildRecordedHistory({
  quote,
  stats,
  points,
  fx,
}: {
  quote: QuoteModel;
  stats: ProductDailyStats | null;
  points: readonly DailyPoint[];
  fx: FxDailySeries;
}): RecordedHistoryModel | null {
  if (quote.state !== "withheld" || points.length < 2) return null;
  const lastDay = points[points.length - 1].dateKey;
  const high = stats?.tracked_high_usd;
  const highDay = stats?.tracked_high_day;
  return {
    lastDay,
    trackedHigh:
      typeof high === "number" && high > 0 && highDay
        ? { high: { usd: high, cad: usdToCadOn(fx, highDay, high) }, day: highDay }
        : null,
    maxDrawdown1y: maxDrawdownOverYear(points, lastDay),
    volatilityWeekly: stats?.vol_weekly_52w ?? null,
  };
}

export interface PulseModel {
  label: string;
  tone: PulseTone;
  description: string | null;
  unitsSold7d: number | null;
  volumeTrend: number | null;
  activeListings: number | null;
  unitsOnMarket: number | null;
  supplyChange30d: number | null;
  orders30d: number | null;
}

/** Market Pulse, same inputs and thresholds as before WP31; the reason names what is missing. */
export function buildPulse({
  product,
  stats,
  salesHistory,
  listings,
}: {
  product: Product;
  stats: ProductDailyStats | null;
  salesHistory: SalesHistoryEntry[];
  listings: ProductListingsSnapshot | null;
}): PulseModel {
  const unitsSold7d = getUnitsSoldWindow(salesHistory, 7);
  const unitsSold30d = getUnitsSoldWindow(salesHistory, 30);
  const volumeTrend = getVolumeTrendPercent(unitsSold30d, getPriorUnitsSold30d(salesHistory));
  const supplyIsFresh = isListingsSnapshotFresh(listings?.snapshot_date);
  const priceReturn30d = product.returns?.["1M"] ?? null;
  const signal = getPulseSignal(priceReturn30d, volumeTrend);
  const meta = signal ? PULSE_SIGNAL_META[signal] : null;
  const hasInputs = priceReturn30d !== null && volumeTrend !== null;
  return {
    label: meta ? meta.label : hasInputs ? "Stable" : "No signal",
    tone: meta ? meta.tone : "neutral",
    description: meta
      ? meta.description
      : getPulseMissingReason(priceReturn30d, volumeTrend, !hasCurrentPrice(product)),
    unitsSold7d,
    volumeTrend,
    activeListings: supplyIsFresh ? listings?.active_listings ?? null : null,
    unitsOnMarket: supplyIsFresh ? listings?.total_quantity_available ?? null : null,
    supplyChange30d: stats?.qty_change_30d_pct ?? null,
    orders30d: stats?.tx_30d ?? null,
  };
}

export interface SiblingRow {
  id: number;
  href: string;
  name: string;
  imageUrl: string | null;
  price: MoneyPair | null;
  change30d: number | null;
}

export function buildSiblingRows(
  siblings: readonly Product[],
  fx: FxDailySeries,
  latestRate: LatestRate
): SiblingRow[] {
  return siblings.map((sibling) => {
    const priceDay = recordedAtDateKey(sibling.price_recorded_at ?? null);
    const usd = hasCurrentPrice(sibling) && typeof sibling.usd_price === "number" ? sibling.usd_price : null;
    const rate = usd !== null && priceDay !== null ? quoteRate(fx, priceDay, latestRate) : null;
    return {
      id: sibling.id,
      href: productPath(sibling.id),
      name: `${getProductLabel(sibling)}${sibling.variant ? ` (${sibling.variant})` : ""}`,
      imageUrl: sibling.image_url ?? null,
      price: usd === null ? null : money(usd, rate),
      change30d: usd === null ? null : sibling.returns?.["1M"] ?? null,
    };
  });
}
```

Check the signatures this file relies on before running `tsc`: `getUnitsSoldWindow(sales, days, offsetDays, referenceDate)`, `isListingsSnapshotFresh(snapshotDate, referenceDate)` and `getDaysOfSupply(unitsOnMarket, unitsSold30d)` exist in `marketPulse.ts` today; `getPriorUnitsSold30d` and `getVolumeTrendPercent` are called exactly as the current page calls them. `PULSE_SIGNAL_META[signal]` has `label`, `description` and `tone`. If `ProductDailyStats.day` or any WP25 column name differs, use WP25's name.

### Step 7. `app/product/[id]/QuoteClient.tsx` (new, `"use client"`): currency pickers

The only client code in the header and stats. It imports types from `productModel.ts` with `import type` only, so the model and its imports stay on the server.

```tsx
"use client";

import Delta from "../../components/ui/Delta";
import RangeBar from "../../components/ui/RangeBar";
import { useCurrency } from "../../context/CurrencyContext";
import { formatDateOnly, formatMoney, formatMonthDay } from "../../lib/format";
import type { ChangeRow, MoneyPair, QuoteRate } from "./productModel";

type Code = "USD" | "CAD";

// Local copy: importing CHANGE_WINDOWS from productModel would pull the
// server-side model into the client bundle.
const WINDOWS = ["1D", "7D", "30D", "1Y"] as const;

function pick(pair: MoneyPair, currency: Code): { value: number; code: Code } {
  return currency === "CAD" && pair.cad !== null ? { value: pair.cad, code: "CAD" } : { value: pair.usd, code: "USD" };
}

/** A money figure in the visitor's currency; USD with its code when no CAD value exists. */
export function CurrencyAmount({ pair, showCode = false }: { pair: MoneyPair; showCode?: boolean }) {
  const { currency } = useCurrency();
  const { value, code } = pick(pair, currency);
  return (
    <span className="tabular-nums">
      {formatMoney(value, code)}
      {(showCode || code !== currency) && (
        <span className="ml-1 text-small font-medium text-ink-soft">{code}</span>
      )}
    </span>
  );
}

function rateText(rate: QuoteRate, referenceYear: string): string {
  const when = rate.day.slice(0, 4) === referenceYear ? formatMonthDay(rate.day) : formatDateOnly(rate.day);
  return rate.kind === "dated" ? `the Bank of Canada rate of ${when}` : `the latest Bank of Canada rate (${when})`;
}

/** Key stats caption, CAD only: "CAD at the Bank of Canada rate of Sep 29". */
export function CadRateNote({ rate, referenceYear }: { rate: QuoteRate | null; referenceYear: string }) {
  const { currency } = useCurrency();
  if (currency !== "CAD" || rate === null) return null;
  return <p className="text-caption text-ink-soft">CAD at {rateText(rate, referenceYear)}</p>;
}

/** "≈ C$82.10 at the Bank of Canada rate of Sep 29" or "From $59.99 USD at ...". */
export function QuoteSecondaryLine({
  price,
  rate,
  referenceYear,
}: {
  price: MoneyPair;
  rate: QuoteRate | null;
  referenceYear: string;
}) {
  const { currency } = useCurrency();
  if (rate === null || price.cad === null) return null;
  const text =
    currency === "CAD"
      ? `From ${formatMoney(price.usd, "USD")} USD at ${rateText(rate, referenceYear)}`
      : `≈ ${formatMoney(price.cad, "CAD")} at ${rateText(rate, referenceYear)}`;
  return <p className="text-small text-ink-soft">{text}</p>;
}

export function QuoteChanges({
  usd,
  cad,
  missingReason,
}: {
  usd: ChangeRow;
  cad: ChangeRow | null;
  missingReason: string;
}) {
  const { currency } = useCurrency();
  const row = currency === "CAD" && cad !== null ? cad : usd;
  const anyValue = WINDOWS.some((w) => row[w] !== null);
  const note =
    currency === "CAD" && anyValue
      ? cad !== null
        ? "In CAD at each day's Bank of Canada rate"
        : "In USD Market Price terms"
      : null;
  return (
    <div className="flex flex-col gap-1">
      <ul aria-label="Price change" className="flex flex-wrap gap-x-4 gap-y-1 text-body">
        {WINDOWS.map((window) => (
          <li key={window}>
            <Delta value={row[window]} period={window} missingReason={missingReason} />
          </li>
        ))}
      </ul>
      {note && <p className="text-caption text-ink-soft">{note}</p>}
    </div>
  );
}

export function QuoteRangeBar({
  low,
  high,
  value,
  windowLabel,
}: {
  low: MoneyPair;
  high: MoneyPair;
  value: MoneyPair;
  windowLabel: string;
}) {
  const { currency } = useCurrency();
  const l = pick(low, currency);
  const h = pick(high, currency);
  return (
    <RangeBar
      low={low.usd}
      high={high.usd}
      value={value.usd}
      lowLabel={formatMoney(l.value, l.code)}
      highLabel={formatMoney(h.value, h.code)}
      windowLabel={windowLabel}
      showSummary
    />
  );
}
```

`useCurrency()` renders the default (CAD) on the server and during hydration and the stored preference right after (WP20's `useSyncExternalStore`), so there is no hydration mismatch.

### Step 8. `app/product/[id]/ProductQuoteHeader.tsx` (new, server)

```tsx
import Link from "next/link";
import AsOf from "../../components/ui/AsOf";
import MetricLabel from "../../components/ui/MetricLabel";
import ReportLink from "../../components/ui/ReportLink";
import { formatDateOnly, formatInteger, formatMonthDay, formatPercent } from "../../lib/format";
import { productPath } from "./productMeta";
import type { QuoteModel } from "./productModel";
import { CurrencyAmount, QuoteChanges, QuoteSecondaryLine } from "./QuoteClient";

const LINK =
  "font-medium text-action underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action";

/** Neutral text (not a return): "4.3% below Market Price". Flat band as Delta's (0.05 points). */
function premiumText(pct: number): string {
  if (Math.abs(pct) < 0.05) return "at Market Price";
  return `${formatPercent(Math.abs(pct))} ${pct < 0 ? "below" : "above"} Market Price`;
}

export default function ProductQuoteHeader({
  quote,
  productId,
  today,
}: {
  quote: QuoteModel;
  productId: number;
  today: string;
}) {
  const report = <ReportLink topic="wrong_price" productId={productId} from={productPath(productId)} />;

  if (quote.state === "withheld" || quote.state === "never" || quote.price === null) {
    const sentence = quote.priceDay
      ? `No current price. Last recorded ${formatDateOnly(quote.priceDay)}.`
      : "No current price. This product has never been priced.";
    return (
      <section aria-label="Price" data-section="quote" data-quote-state={quote.state} className="flex flex-col gap-2">
        <div className="text-small font-medium text-ink-soft">
          <MetricLabel metric="marketPrice" />
        </div>
        <p className="text-body text-ink">
          {sentence}{" "}
          <Link href="/methodology#freshness" prefetch={false} className={LINK}>
            Why prices are hidden
          </Link>
        </p>
        <div>{report}</div>
      </section>
    );
  }

  const changes = quote.changes ?? { usd: { "1D": null, "7D": null, "30D": null, "1Y": null }, cad: null };
  return (
    <section aria-label="Price" data-section="quote" data-quote-state={quote.state} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="text-small font-medium text-ink-soft">
          <MetricLabel metric="marketPrice" />
        </div>
        <p className="text-display font-semibold text-ink">
          <CurrencyAmount pair={quote.price} showCode />
        </p>
        <AsOf date={quote.priceDay} variant="hero" prefix="TCGplayer Market Price for" referenceDate={today} />
        <QuoteSecondaryLine price={quote.price} rate={quote.rate} referenceYear={today.slice(0, 4)} />
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-small font-medium text-ink-soft">
          <MetricLabel metric="priceChange" />
        </div>
        <QuoteChanges usd={changes.usd} cad={changes.cad} missingReason="Not available" />
      </div>
      {quote.listing && (
        <p className="text-small text-ink-soft" data-testid="quote-listing">
          <MetricLabel metric="lowestListing" />{" "}
          <span className="text-ink">{quote.listing.lowest ? <CurrencyAmount pair={quote.listing.lowest} /> : "--"}</span>{" "}
          before shipping
          {quote.listing.askPremiumPct !== null &&
            `, ${premiumText(quote.listing.askPremiumPct)}`}
          {quote.listing.count !== null && ` · ${formatInteger(quote.listing.count)} listings`}
          {" · "}
          {/* Plain date, not AsOf: AsOf says "Last priced" from 2 days, and this is a listing snapshot. */}
          <time dateTime={quote.listing.snapshotDay}>as of {formatMonthDay(quote.listing.snapshotDay)}</time>
        </p>
      )}
      <div>{report}</div>
    </section>
  );
}
```

### Step 9. `app/product/[id]/KeyStats.tsx` and `RecordedHistory.tsx` (new, server)

9a. `KeyStats.tsx`:

```tsx
import Delta from "../../components/ui/Delta";
import MetricLabel from "../../components/ui/MetricLabel";
import Stat from "../../components/ui/Stat";
import { formatDateOnly, formatInteger, formatMoney, formatPercent, formatSignedPercent } from "../../lib/format";
import { formatMsrpMultiple } from "../../lib/productAttributes";
import type { KeyStatsModel } from "./productModel";
import { CadRateNote, CurrencyAmount, QuoteRangeBar } from "./QuoteClient";

const GROUP = "mt-6 border-t border-line pt-4";
const GROUP_TITLE = "text-small font-semibold text-ink";
const GRID = "mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4";

function count(value: number | null): string {
  return value === null ? "--" : formatInteger(Math.round(value));
}

export default function KeyStats({ model, today }: { model: KeyStatsModel; today: string }) {
  const { range, trackedHigh, cagr, structure, liquidity, risk, rate } = model;
  return (
    <section
      aria-labelledby="key-stats-heading"
      data-section="key-stats"
      className="rounded-card border border-line bg-surface p-4 md:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="key-stats-heading" className="text-h3 font-semibold text-ink">Key stats</h2>
        {/* Rendered only while CAD is selected; one rate for the whole panel. */}
        <CadRateNote rate={rate} referenceYear={today.slice(0, 4)} />
      </div>

      <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {range && (
          <div className="flex flex-col gap-2">
            <div className="text-small font-medium text-ink-soft"><MetricLabel metric="range52w" /></div>
            <QuoteRangeBar low={range.low} high={range.high} value={range.value} windowLabel={range.windowLabel} />
            {range.since && (
              <p className="text-caption text-ink-soft">
                Tracked since {formatDateOnly(range.since)}: less than a year of history.
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          {trackedHigh && (
            <Stat
              label={<MetricLabel metric="trackedHigh" />}
              value={<CurrencyAmount pair={trackedHigh.high} />}
              sub={`Reached ${formatDateOnly(trackedHigh.day)} · tracked since ${formatDateOnly(trackedHigh.since)}`}
              asOf={
                trackedHigh.belowPct === null
                  ? "At the tracked high"
                  : `${formatPercent(trackedHigh.belowPct)} below the tracked high`
              }
            />
          )}
          {cagr && (
            <Stat
              label={<MetricLabel metric="cagrSinceTracked" />}
              value={<Delta value={cagr.value} />}
              sub={`per year since ${formatDateOnly(cagr.since)}`}
            />
          )}
        </div>
      </div>

      {structure && (
        <div className={GROUP}>
          <h3 className={GROUP_TITLE}>Retail and packs</h3>
          <div className={GRID}>
            {structure.msrpMultiple !== null && (
              <Stat label={<MetricLabel metric="msrpMultiple" />} value={formatMsrpMultiple(structure.msrpMultiple) ?? "--"} />
            )}
            {structure.msrpUsd !== null && (
              <Stat
                label={<MetricLabel metric="msrp" />}
                value={<span>{formatMoney(structure.msrpUsd, "USD")}<span className="ml-1 text-small font-medium text-ink-soft">USD</span></span>}
                sub={structure.msrpSource ? <span className="block truncate" title={structure.msrpSource}>Source: {structure.msrpSource}</span> : undefined}
              />
            )}
            {structure.costPerPack && (
              <Stat
                label={<MetricLabel metric="costPerPack" />}
                value={<CurrencyAmount pair={structure.costPerPack} />}
                sub={structure.packCount !== null ? `${formatInteger(structure.packCount)} packs` : undefined}
              />
            )}
            {structure.nav && (
              <Stat
                label={<MetricLabel metric="packNav" />}
                value={structure.nav.value ? <CurrencyAmount pair={structure.nav.value} /> : "--"}
                sub={
                  structure.nav.value ? (
                    <span>
                      <MetricLabel metric="premiumToPacks" /> {formatSignedPercent(structure.nav.premiumPct)}
                    </span>
                  ) : (
                    structure.nav.reason
                  )
                }
              />
            )}
          </div>
        </div>
      )}

      <div className={GROUP}>
        <h3 className={GROUP_TITLE}>Liquidity</h3>
        <div className={GRID}>
          <Stat label={<MetricLabel metric="unitsSold30d" />} value={count(liquidity.unitsSold30d)} />
          <Stat label={<MetricLabel metric="sellThrough30d" />} value={formatPercent(liquidity.sellThrough30d, { decimals: 0 })} />
          <Stat
            label={<MetricLabel metric="daysOfSupply" />}
            value={liquidity.daysOfSupply === null ? "--" : liquidity.daysOfSupply.toFixed(1)}
          />
          <Stat
            label={<MetricLabel metric="liquidityScore" />}
            value={count(liquidity.liquidityScore)}
            sub={liquidity.liquidityScore === null ? undefined : `within ${liquidity.typeLabel}`}
          />
        </div>
      </div>

      <div className={GROUP}>
        <h3 className={GROUP_TITLE}>Risk</h3>
        <div className={GRID}>
          <Stat label={<MetricLabel metric="volatilityWeekly52w" />} value={formatPercent(risk.volatilityWeekly)} />
          <Stat
            label={<MetricLabel metric="maxDrawdown1y" />}
            value={risk.maxDrawdown1y ? formatPercent(risk.maxDrawdown1y.value) : "--"}
            sub={risk.maxDrawdown1y ? `${formatDateOnly(risk.maxDrawdown1y.from)} to ${formatDateOnly(risk.maxDrawdown1y.to)}` : undefined}
          />
        </div>
      </div>
    </section>
  );
}
```

WP28 absent: drop the `formatMsrpMultiple` import and the whole `{structure && (...)}` block (structure is always null then).

9b. `RecordedHistory.tsx`:

```tsx
import MetricLabel from "../../components/ui/MetricLabel";
import Stat from "../../components/ui/Stat";
import { formatDateOnly, formatPercent } from "../../lib/format";
import type { RecordedHistoryModel } from "./productModel";
import { CurrencyAmount } from "./QuoteClient";

/** History metrics for a withheld price, inside the chart section (WP31 decision 5). */
export default function RecordedHistory({ model }: { model: RecordedHistoryModel }) {
  return (
    <div data-section="recorded-history" className="mt-4 border-t border-line pt-4">
      <h3 className="text-small font-semibold text-ink">Recorded history</h3>
      <p className="text-caption text-ink-soft">Describes recorded history to {formatDateOnly(model.lastDay)}.</p>
      <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-3">
        {model.trackedHigh && (
          <Stat
            label={<MetricLabel metric="trackedHigh" />}
            value={<CurrencyAmount pair={model.trackedHigh.high} />}
            sub={`Reached ${formatDateOnly(model.trackedHigh.day)}`}
          />
        )}
        <Stat
          label={<MetricLabel metric="maxDrawdown1y" />}
          value={model.maxDrawdown1y ? formatPercent(model.maxDrawdown1y.value) : "--"}
          sub={model.maxDrawdown1y ? `${formatDateOnly(model.maxDrawdown1y.from)} to ${formatDateOnly(model.maxDrawdown1y.to)}` : undefined}
        />
        <Stat label={<MetricLabel metric="volatilityWeekly52w" />} value={formatPercent(model.volatilityWeekly)} />
      </div>
    </div>
  );
}
```

The tracked high here is converted at the rate of the day it was reached (`usdToCadOn`), because no current rate applies to a withheld product.

### Step 10. `app/product/[id]/MarketPulseSection.tsx` (new, server)

```tsx
import Badge from "../../components/ui/Badge";
import MetricLabel from "../../components/ui/MetricLabel";
import Stat from "../../components/ui/Stat";
import { formatInteger, formatSignedPercent } from "../../lib/format";
import type { PulseModel } from "./productModel";

function count(value: number | null): string {
  return value === null ? "--" : formatInteger(value);
}

export default function MarketPulseSection({ pulse }: { pulse: PulseModel }) {
  return (
    <section
      aria-labelledby="pulse-heading"
      data-section="market-pulse"
      className="rounded-card border border-line bg-surface p-4 md:p-5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="pulse-heading" className="text-h3 font-semibold text-ink">
          <MetricLabel metric="marketPulse" />
        </h2>
        <Badge variant={pulse.tone === "warn" ? "warn" : "neutral"}>{pulse.label}</Badge>
        {pulse.description && <p className="text-small text-ink-soft">{pulse.description}</p>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={<MetricLabel metric="unitsSold7d" />} value={count(pulse.unitsSold7d)} />
        <Stat label={<MetricLabel metric="volumeTrend" />} value={formatSignedPercent(pulse.volumeTrend)} />
        <Stat label={<MetricLabel metric="activeListings" />} value={count(pulse.activeListings)} />
        <Stat label={<MetricLabel metric="unitsOnMarket" />} value={count(pulse.unitsOnMarket)} />
        <Stat label={<MetricLabel metric="supplyChange30d" />} value={formatSignedPercent(pulse.supplyChange30d)} />
        <Stat label={<MetricLabel metric="transactions30d" />} value={count(pulse.orders30d)} />
      </div>
    </section>
  );
}
```

### Step 11. `app/product/[id]/ProductActions.tsx` (new, server) and the currency fallback

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses } from "../../components/ui/Button";

export interface ProductActionsProps {
  productId: number;
  /** WP28 boxCalculatorHref(id) when the product has recorded contents. */
  boxNavHref: string | null;
  /** products.url; "" or null hides the link. */
  tcgplayerUrl: string | null | undefined;
  /** WP34 passes its Watch control here. Empty until then. */
  watch?: ReactNode;
  /** Only while WP27's header toggle is absent. */
  currencyToggle?: ReactNode;
}

export default function ProductActions({ productId, boxNavHref, tcgplayerUrl, watch, currencyToggle }: ProductActionsProps) {
  return (
    <div data-section="actions" className="flex flex-wrap items-center gap-2">
      <Link href={`/portfolio?add=${productId}`} prefetch={false} className={buttonClasses({ variant: "primary" })}>
        Add to portfolio
      </Link>
      {watch}
      {boxNavHref && (
        <Link href={boxNavHref} prefetch={false} className={buttonClasses({ variant: "secondary" })}>
          Open in Box NAV
        </Link>
      )}
      {tcgplayerUrl && (
        <a href={tcgplayerUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "ghost" })}>
          View on TCGplayer<span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
      {currencyToggle}
    </div>
  );
}
```

Only when soft check (d) found no `HeaderCurrencyToggle`: create `app/product/[id]/ProductCurrencyToggle.tsx`:

```tsx
"use client";

import SegmentedControl from "../../components/ui/SegmentedControl";
import { useCurrency } from "../../context/CurrencyContext";

const OPTIONS = [
  { value: "CAD", label: "CAD" },
  { value: "USD", label: "USD" },
] as const;

/** Until WP27 moves the currency choice into the header. Delete it then. */
export default function ProductCurrencyToggle() {
  const { currency, setCurrency } = useCurrency();
  return (
    <SegmentedControl
      label="Currency"
      hideLabel
      options={OPTIONS}
      value={currency}
      onChange={setCurrency}
      fullWidthOnPhone={false}
    />
  );
}
```

and pass `currencyToggle={<ProductCurrencyToggle />}` from the page. Note it in the PR ("delete when WP27 lands").

### Step 12. Siblings: `app/product/[id]/SiblingList.tsx`

`IntentLink` exists (WP11 step 13a, checked in Before you start); do not create or copy it.

`SiblingList.tsx` (server):

```tsx
import IntentLink from "../../components/IntentLink";
import ProductImage from "../../components/ProductPrices/shared/ProductImage";
import Delta from "../../components/ui/Delta";
import type { SiblingRow } from "./productModel";
import { CurrencyAmount } from "./QuoteClient";

export default function SiblingList({ setName, rows }: { setName: string; rows: SiblingRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="siblings-heading" data-section="siblings">
      <h2 id="siblings-heading" className="text-h3 font-semibold text-ink">Other products in {setName}</h2>
      <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-surface md:grid md:grid-cols-3 md:gap-3 md:divide-y-0 md:border-0 md:bg-transparent lg:grid-cols-5">
        {rows.map((row) => (
          <li key={row.id}>
            <IntentLink
              href={row.href}
              className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action md:h-full md:flex-col md:items-stretch md:rounded-card md:border md:border-line md:bg-surface md:p-3 md:hover:bg-surface-alt"
            >
              <ProductImage imageUrl={row.imageUrl} productName={row.name} preferThumbnail className="size-10 shrink-0 md:h-28 md:w-full" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-ink md:whitespace-normal md:line-clamp-2">{row.name}</p>
                <p className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-2 md:justify-start">
                  <span className="text-body font-semibold text-ink">
                    {row.price ? <CurrencyAmount pair={row.price} /> : "--"}
                  </span>
                  <Delta value={row.change30d} period="30D" missingReason={row.price ? "Not available" : "Price withheld"} />
                </p>
              </div>
            </IntentLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Keep whatever props WP12 gave the sibling `ProductImage` today (`preferThumbnail`), never `priority`.

### Step 13. `app/product/[id]/benchmark.ts` (new): index overlay loader

```ts
/**
 * The chart's index overlays (WP29's GET /api/public/index/[code]).
 * Client-safe and tiny: ProductChartPanel imports it.
 */
export const BENCHMARKS_ENABLED: boolean = true; // false when app/api/public/index/[code]/route.ts does not exist (test enforces)
export const SEALED_INDEX_CODE = "sealed";
/** Short label for toggles and the legend (WP29's full name is "Pokéfin Sealed Index"). */
export const SEALED_INDEX_NAME = "Sealed Index";

/** WP29 set index code: "set-<sets.id>". */
export function setIndexCode(setId: number): string {
  return `set-${setId}`;
}

export interface BenchmarkChoice {
  /** Offer the Sealed Index toggle. */
  sealed: boolean;
  /** The set index code to offer, or null. */
  set: string | null;
}

/**
 * Which toggles the page offers. `codes` are the published index codes
 * (getCachedIndexSummary), or null when that read failed: then both are
 * offered and a 404 on press disables the missing one.
 */
export function availableBenchmarks(
  enabled: boolean,
  codes: readonly string[] | null,
  setId: number | null
): BenchmarkChoice {
  if (!enabled) return { sealed: false, set: null };
  const setCode = setId === null ? null : setIndexCode(setId);
  if (codes === null) return { sealed: true, set: setCode };
  return {
    sealed: codes.includes(SEALED_INDEX_CODE),
    set: setCode !== null && codes.includes(setCode) ? setCode : null,
  };
}

export interface IndexSeries {
  code: string;
  name: string;
  days: string[];
  levels: number[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * WP29 body { code, name, asOf, base, weeklyUntil, d, l, p } to an
 * IndexSeries, or null. Only d and l are drawn; p (provisional positions)
 * and the rest are ignored here.
 */
export function parseIndexPayload(code: string, json: unknown): IndexSeries | null {
  if (typeof json !== "object" || json === null) return null;
  const { d, l, name, code: bodyCode } = json as { d?: unknown; l?: unknown; name?: unknown; code?: unknown };
  if (bodyCode !== undefined && bodyCode !== code) return null;
  if (!Array.isArray(d) || !Array.isArray(l) || d.length !== l.length || d.length === 0) return null;
  const days: string[] = [];
  const levels: number[] = [];
  for (let i = 0; i < d.length; i += 1) {
    const day = d[i];
    const level = l[i];
    if (typeof day !== "string" || !DAY_RE.test(day)) return null;
    if (typeof level !== "number" || !Number.isFinite(level) || level <= 0) return null;
    days.push(day);
    levels.push(level);
  }
  return { code, name: typeof name === "string" && name ? name : code, days, levels };
}

const cache = new Map<string, Promise<IndexSeries | "missing">>();

/**
 * One request per code per page load. 404 resolves "missing" (no such
 * index); any other failure rejects and is forgotten, so the next press retries.
 */
export function loadIndexSeries(code: string): Promise<IndexSeries | "missing"> {
  const cached = cache.get(code);
  if (cached) return cached;
  const request = fetch(`/api/public/index/${encodeURIComponent(code)}`).then(async (res) => {
    if (res.status === 404) return "missing" as const;
    if (!res.ok) throw new Error(`index ${code}: HTTP ${res.status}`);
    const series = parseIndexPayload(code, await res.json());
    if (series === null) throw new Error(`index ${code}: malformed body`);
    return series;
  });
  cache.set(code, request);
  request.catch(() => cache.delete(code));
  return request;
}

/** Test hook. */
export function resetIndexCacheForTests(): void {
  cache.clear();
}
```

Set `BENCHMARKS_ENABLED` from soft check (b). If WP29's body differs from "WP29 contract" (Before you start), adjust `parseIndexPayload`, `SEALED_INDEX_CODE` and `setIndexCode` only.

### Step 14. `app/components/charts/ProductPriceChartImpl.tsx` (new) and `ChartBundle.tsx`

14a. Add to `app/components/charts/ChartBundle.tsx`, below the `PriceChart` export:

```ts
export { default as ProductPriceChartImpl } from "./ProductPriceChartImpl";
```

14b. `ProductPriceChartImpl.tsx`:

```tsx
"use client";

import { memo, useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Delta from "../ui/Delta";
import { formatDateOnly, formatInteger, formatMoney, formatMonthDay, formatSignedPercent } from "../../lib/format";
import {
  buildChartView,
  type ChartPayload,
  type ChartRange,
  type ChartRow,
  type IndexOverlay,
} from "../../lib/productChart";

export interface ProductPriceChartImplProps {
  payload: ChartPayload;
  range: ChartRange;
  rangeLabel: string;
  currency: "USD" | "CAD";
  benchmark: IndexOverlay | null;
}

const AXIS_WIDTH = 64;
const MARGIN = { top: 16, right: 12, bottom: 0, left: 0 };
const TICK = { fill: "var(--pf-ink-soft)", fontSize: 12 };

type TooltipProps = {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
  currency: "USD" | "CAD";
  benchmarkName: string | null;
  benchmarkStart: string | null;
};

function PriceTooltip({ active, payload, currency, benchmarkName, benchmarkStart }: TooltipProps) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row || row.price === null) return null;
  return (
    <div className="rounded-control border border-line bg-surface px-3 py-2 text-small shadow-md">
      <p className="font-medium text-ink">
        {formatDateOnly(row.dateKey)}
        {row.coarse ? " (weekly point)" : ""}
      </p>
      <p className="tabular-nums text-ink">{formatMoney(row.price, currency)} {currency}</p>
      {row.ma30 !== null && <p className="tabular-nums text-ink-soft">30-day average {formatMoney(row.ma30, currency)}</p>}
      {row.units !== null && (
        <p className="tabular-nums text-ink-soft">
          {formatInteger(row.units)} sold {row.unitsWeekly ? (row.unitsPartial ? "that week (partial week)" : "that week") : "that day"}
        </p>
      )}
      {row.benchChange !== null && benchmarkName && benchmarkStart && (
        <p className="tabular-nums text-ink-soft">
          {benchmarkName} {formatSignedPercent(row.benchChange)} since {formatMonthDay(benchmarkStart)}
        </p>
      )}
    </div>
  );
}

function NoTooltip() {
  return null;
}

type LabelProps = { viewBox?: { x?: number; y?: number }; text: string };

/** The last point's date, anchored to its left so it never clips at the right edge. */
function LastPointLabel({ viewBox, text }: LabelProps) {
  const x = viewBox?.x ?? 0;
  const y = viewBox?.y ?? 0;
  return (
    <text x={x - 4} y={y - 6} textAnchor="end" fontSize={12} fill="var(--pf-ink-soft)">
      {text}
    </text>
  );
}

function ProductPriceChartImpl({ payload, range, rangeLabel, currency, benchmark }: ProductPriceChartImplProps) {
  const view = useMemo(
    () => buildChartView({ payload, range, currency, benchmark }),
    [payload, range, currency, benchmark]
  );
  if (view.empty) return null;
  const volumeY = view.volumeY;
  const hasVolume = view.volume.length > 0 && volumeY !== null;
  const moneyTick = (v: number) => formatMoney(v, view.currency, { decimals: view.y.decimals });
  const xLabel = new Map(view.xTicks.map((tick) => [tick.t, tick.label]));
  const xAxis = (hide: boolean) => (
    <XAxis
      type="number"
      dataKey="t"
      domain={view.domain}
      ticks={view.xTicks.map((tick) => tick.t)}
      tickFormatter={(t: number) => xLabel.get(t) ?? ""}
      tick={TICK}
      tickLine={false}
      axisLine={{ stroke: "var(--pf-chart-grid)" }}
      allowDataOverflow
      hide={hide}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <p className="flex min-h-6 flex-wrap items-baseline gap-x-2 text-small" aria-live="polite">
        {payload.withheld && view.last ? (
          <span className="text-warn-text">
            No price since {formatDateOnly(view.last.dateKey)}. The chart shows recorded history only.
          </span>
        ) : view.change ? (
          <>
            <span className="text-ink-soft">{view.trackedSince ? "Change" : `${rangeLabel} change`}</span>
            <Delta value={view.change.pct} />
            {/* Always dated: the start is the return anchor, so this matches the chip of the same window. */}
            <span className="text-ink-soft">since {formatDateOnly(view.change.fromKey)}</span>
          </>
        ) : null}
        {view.notes.map((note) => (
          <span key={note} className="text-caption text-ink-soft">
            {note}
          </span>
        ))}
      </p>
      <div className="min-h-0 flex-1" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={view.rows} margin={MARGIN} syncId="product-chart" syncMethod="value">
            <CartesianGrid vertical={false} stroke="var(--pf-chart-grid)" />
            {xAxis(hasVolume)}
            <YAxis
              domain={[view.y.min, view.y.max]}
              ticks={view.y.ticks}
              tickFormatter={moneyTick}
              tick={TICK}
              tickLine={false}
              axisLine={false}
              width={AXIS_WIDTH}
              allowDataOverflow
            />
            <Tooltip
              content={
                <PriceTooltip
                  currency={view.currency}
                  benchmarkName={benchmark?.name ?? null}
                  benchmarkStart={view.benchmarkStart}
                />
              }
              cursor={{ stroke: "var(--pf-ink-soft)", strokeDasharray: "3 3" }}
              isAnimationActive={false}
            />
            {view.releaseT !== null && (
              <ReferenceLine
                x={view.releaseT}
                stroke="var(--pf-ink-soft)"
                strokeDasharray="3 3"
                label={{ value: "Release", position: "insideTopLeft", fontSize: 12, fill: "var(--pf-ink-soft)" }}
              />
            )}
            <Line dataKey="weekly" stroke="var(--pf-chart-line)" strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="daily" stroke="var(--pf-chart-line)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="ma30" stroke="var(--pf-chart-line)" strokeOpacity={0.45} strokeWidth={1.5} dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
            {benchmark && (
              <Line dataKey="bench" stroke="var(--pf-chart-bench)" strokeWidth={1.5} strokeDasharray="6 4" dot={false} activeDot={false} connectNulls isAnimationActive={false} />
            )}
            {view.last && (
              <ReferenceDot
                x={view.last.t}
                y={view.last.value}
                r={3}
                fill="var(--pf-chart-line)"
                stroke="var(--pf-surface)"
                label={<LastPointLabel text={view.last.label} />}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {hasVolume && volumeY !== null && (
        <div className="h-[76px]" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={view.volume} margin={{ ...MARGIN, top: 4 }} syncId="product-chart" syncMethod="value">
              {xAxis(false)}
              <YAxis
                domain={[0, volumeY.max]}
                ticks={volumeY.ticks}
                tickFormatter={(v: number) => formatInteger(v)}
                tick={TICK}
                tickLine={false}
                axisLine={false}
                width={AXIS_WIDTH}
              />
              <Tooltip content={<NoTooltip />} cursor={{ fill: "var(--pf-chart-grid)" }} isAnimationActive={false} />
              <Bar dataKey="units" fill="var(--pf-chart-volume)" isAnimationActive={false} maxBarSize={12} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default memo(ProductPriceChartImpl);
```

If Recharts 3's types reject `syncMethod="value"` on `ComposedChart`, check `node_modules/recharts/types/chart/types.d.ts` (or the `CategoricalChartProps` type) for the prop name and use it; if the prop does not exist, drop it and set `syncId` only (index sync is acceptable because both panes share the domain) and say so in the PR. Colours are CSS variables only (the conventions test bans hex).

### Step 15. `app/product/[id]/ProductChartPanel.tsx` (new, `"use client"`); delete `ProductDetailChart.tsx`

```tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import EmptyState from "../../components/ui/EmptyState";
import SegmentedControl from "../../components/ui/SegmentedControl";
import Skeleton from "../../components/ui/Skeleton";
import { useCurrency } from "../../context/CurrencyContext";
import { formatDateOnly } from "../../lib/format";
import type { ChartPayload, ChartRange } from "../../lib/productChart";
import {
  loadIndexSeries,
  SEALED_INDEX_CODE,
  SEALED_INDEX_NAME,
  type BenchmarkChoice,
  type IndexSeries,
} from "./benchmark";

// Recharts and lib/productChart load only here, through the shared lazy
// ChartBundle chunk (app/components/charts/ChartBundle.tsx).
const ProductPriceChart = dynamic(
  () => import("../../components/charts/ChartBundle").then((m) => m.ProductPriceChartImpl),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> }
);

const RANGE_OPTIONS = [
  { value: "7D", label: "7D" },
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "1Y", label: "1Y" },
  { value: "MAX", label: "Max", ariaLabel: "All tracked history" },
] as const satisfies ReadonlyArray<{ value: ChartRange; label: string; ariaLabel?: string }>;

// Local copies (importing productChart or marketStats at runtime would pull
// them into the initial bundle). The tolerance makes the dashed-footnote
// check cover the earliest start the range can have (its return anchor).
const RANGE_DAYS_LOCAL: Record<Exclude<ChartRange, "MAX">, number> = { "7D": 7, "1M": 30, "3M": 90, "6M": 180, "1Y": 365 };
const anchorToleranceLocal = (days: number) => (days <= 30 ? 7 : 14);

type BenchKey = "sealed" | "set";
type BenchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; series: IndexSeries }
  | { status: "missing" }
  | { status: "error" };

/** YYYY-MM-DD minus n days, zone-free. */
function minusDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - n * 86_400_000).toISOString().slice(0, 10);
}

// Colour changes are instant (01-PRODUCT-DIRECTION.md §3.5): no transition-colors.
const TOGGLE =
  "inline-flex items-center rounded-control border border-line px-3 text-small font-medium text-ink h-8 pointer-coarse:min-h-11 hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action aria-pressed:border-action aria-pressed:text-action aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

export default function ProductChartPanel({
  payload,
  setName,
  benchmarks,
  hasVolume,
  children,
}: {
  payload: ChartPayload;
  setName: string;
  /** Which index toggles to offer (availableBenchmarks, decided on the server). */
  benchmarks: BenchmarkChoice;
  hasVolume: boolean;
  /** RecordedHistory for a withheld price (server-rendered). */
  children?: ReactNode;
}) {
  const { currency } = useCurrency();
  const [range, setRange] = useState<ChartRange>("1Y");
  const [active, setActive] = useState<BenchKey | null>(null);
  const [bench, setBench] = useState<Record<BenchKey, BenchState>>({ sealed: { status: "idle" }, set: { status: "idle" } });
  const hasHistory = payload.price.d.length >= 2;
  const setIndexName = `${setName} Index`;

  /** One typed write per toggle, so every state literal is checked against BenchState. */
  function put(key: BenchKey, next: BenchState) {
    setBench((b) => ({ ...b, [key]: next }));
  }

  function toggle(key: BenchKey) {
    const state = bench[key];
    if (state.status === "missing") return;
    // A press on the active toggle switches it off, except after an error:
    // then it retries ("Select again to retry").
    if (active === key && state.status !== "error") {
      setActive(null);
      return;
    }
    setActive(key);
    if (state.status === "ready" || state.status === "loading") return;
    const code = key === "sealed" ? SEALED_INDEX_CODE : benchmarks.set;
    if (code === null) return;
    put(key, { status: "loading" });
    loadIndexSeries(code).then(
      (result) => {
        if (result === "missing") {
          put(key, { status: "missing" });
          setActive((a) => (a === key ? null : a));
        } else {
          put(key, { status: "ready", series: result });
        }
      },
      () => put(key, { status: "error" })
    );
  }

  const activeState = active ? bench[active] : null;
  const readySeries = activeState?.status === "ready" ? activeState.series : null;
  const benchmarkName = active === "sealed" ? SEALED_INDEX_NAME : setIndexName;
  // Memoised so the memo()'d chart only recomputes its view when the overlay really changes.
  const benchmark = useMemo(
    () => (readySeries ? { name: benchmarkName, days: readySeries.days, levels: readySeries.levels } : null),
    [readySeries, benchmarkName]
  );

  const lastKey = payload.price.d[payload.price.d.length - 1] ?? null;
  // Earliest start the range can have (its return anchor may sit up to the
  // tolerance before end - N), so the footnote is never missing when a dashed
  // segment is drawn.
  const startKey =
    lastKey === null
      ? null
      : range === "MAX"
        ? payload.price.d[0]
        : minusDays(lastKey, RANGE_DAYS_LOCAL[range] + anchorToleranceLocal(RANGE_DAYS_LOCAL[range]));
  const showsDashed =
    hasHistory && startKey !== null && (payload.dailySince === null || payload.dailySince > startKey);
  const cadShown = currency === "CAD" && payload.fx.start !== null;
  const status =
    activeState?.status === "error"
      ? "Index unavailable. Select again to retry."
      : activeState?.status === "loading"
        ? "Loading the index."
        : "";

  const toggleButton = (key: BenchKey, label: string) => {
    const state = bench[key];
    const missing = state.status === "missing";
    return (
      <button
        type="button"
        className={TOGGLE}
        aria-pressed={active === key}
        aria-disabled={missing || undefined}
        onClick={() => toggle(key)}
      >
        {missing ? `No ${setName} Index yet` : label}
      </button>
    );
  };

  return (
    <section aria-labelledby="chart-heading" data-section="chart" className="rounded-card border border-line bg-surface p-4 md:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
        <h2 id="chart-heading" className="text-h3 font-semibold text-ink">Price history</h2>
        {hasHistory && (
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <SegmentedControl label="Range" ariaLabel="Chart range" hideLabel options={RANGE_OPTIONS} value={range} onChange={setRange} />
            {(benchmarks.sealed || benchmarks.set !== null) && (
              <div className="flex flex-wrap gap-2">
                {benchmarks.sealed && toggleButton("sealed", `vs ${SEALED_INDEX_NAME}`)}
                {benchmarks.set !== null && toggleButton("set", `vs ${setIndexName}`)}
              </div>
            )}
          </div>
        )}
      </div>

      {hasHistory ? (
        <>
          <ul aria-label="Chart legend" className="mt-3 flex min-h-6 flex-wrap gap-x-4 gap-y-1 text-caption text-ink-soft">
            <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-0.5 w-4 bg-chart-line" />Price</li>
            <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-0.5 w-4 bg-chart-line opacity-45" />30-day average</li>
            {hasVolume && <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block size-2.5 bg-chart-volume" />Units sold</li>}
            {benchmark && <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-4 border-t-2 border-dashed border-chart-bench" />{benchmark.name}</li>}
          </ul>
          <div className={`mt-2 ${hasVolume ? "h-[320px] md:h-[380px]" : "h-[244px] md:h-[304px]"}`}>
            <ProductPriceChart
              payload={payload}
              range={range}
              rangeLabel={range === "MAX" ? "Max" : range}
              currency={currency}
              benchmark={benchmark}
            />
          </div>
          <div className="mt-2 min-h-12 text-caption text-ink-soft">
            {/* Always mounted, so screen readers announce the text when it appears. */}
            <p role="status">{status}</p>
            {showsDashed && (
              <p>{payload.dailySince ? `Dashed: weekly points before ${formatDateOnly(payload.dailySince)}.` : "Dashed: weekly points only."}</p>
            )}
            {cadShown && <p>CAD at the Bank of Canada rate of each day.</p>}
            {benchmark && <p>{benchmark.name} rebased to this product&apos;s price on the first day of the range. Index days are published for the previous day.</p>}
            {hasVolume && <p>Units sold on TCGplayer; bars are daily up to 3 months and weekly totals beyond.</p>}
            <p>
              <Link href="/methodology#market-price" prefetch={false} className="font-medium text-action underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action">
                How the chart is drawn
              </Link>
            </p>
          </div>
        </>
      ) : (
        <EmptyState className="mt-3" title="No history" description="Pokéfin has fewer than two recorded prices for this product." />
      )}
      {children}
    </section>
  );
}
```

Heights: the price pane is the chart box minus the 24 px summary line minus the 76 px volume pane when present (220 px phone, 280 px desktop); a wrapped summary line (notes) takes its height from the price pane, never from the page. `bg-chart-line`, `bg-chart-volume` and `border-chart-bench` come from WP23 step 3c (`--color-chart-line`, `--color-chart-volume`, `--color-chart-bench` in `@theme inline`); if `grep -c "color-chart-line\|color-chart-volume\|color-chart-bench" app/globals.css` prints less than 3, stop and report (WP23 is incomplete); never write a hex value.

Then delete `app/product/[id]/ProductDetailChart.tsx` (`git rm`). `grep -rn "ProductDetailChart" app` must print nothing.

### Step 16. `app/product/[id]/page.tsx`: the new composition

Keep, unchanged: the `revalidate` and `generateStaticParams` exports (WP11), `generateMetadata` and every import it uses (WP13), the JSON-LD `<script>` as the first child of `<main>` (WP13), the breadcrumb `<nav>` block exactly as the file has it, and `<CardRinkPromo variant="footer" />` as the last child of `<main>` (WP15). Delete everything else in the file (the local `ReturnValue`, `MetricTile`, `formatCount`, `PULSE_TONE_CLASSES`, the old hero, return metrics, Market Pulse and siblings markup) and write the page function as:

```tsx
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const productId = parseProductId(id);
  if (productId === null) notFound();

  // Six cached reads side by side, none nested (WP11 rule).
  const [detail, statsSnapshot, fx, latestRate, attributes, indexSummaries] = await Promise.all([
    getCachedProductDetail(productId),
    getCachedProductStats(),
    getCachedFxDaily(),
    getCachedExchangeRate(),
    getCachedProductAttributes(),
    getCachedIndexSummary(),
  ]);
  if (!detail) notFound();

  const { product, history, siblings } = detail;
  const salesHistory = detail.salesHistory ?? [];
  const listings = detail.listings ?? null;
  const stats = statsFor(statsSnapshot, productId);
  const today = todayUtcKey();
  const points = toDailyPoints(history);

  const setName = product.sets?.name ?? "Unknown Set";
  const setCode = product.sets?.code ?? null;
  const setId = product.sets?.id ?? null;
  const generation = product.sets?.generations?.name ?? null;
  const releaseDate = attributes.byProductId[productId]?.release_date ?? product.sets?.release_date ?? null;
  const hasContents = (attributes.contentsByProductId[productId]?.length ?? 0) > 0;

  const quote = buildQuote({ product, stats, points, listings, fx, latestRate, today });
  const keyStats = buildKeyStats({ quote, product, stats, points, salesHistory, listings, attributes, today });
  const recorded = buildRecordedHistory({ quote, stats, points, fx });
  const pulse = buildPulse({ product, stats, salesHistory, listings });
  const chartPayload = buildChartPayload({
    history,
    salesHistory,
    fx,
    withheld: quote.state === "withheld" || quote.state === "never",
    releaseDate,
  });
  const hasVolume = chartPayload.volumeDaily.d.length > 0 || chartPayload.volumeWeekly.d.length > 0;
  const siblingRows = buildSiblingRows(siblings, fx, latestRate);
  const benchmarks = availableBenchmarks(
    BENCHMARKS_ENABLED,
    indexSummaries ? indexSummaries.map((summary) => summary.code) : null,
    setId
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-4 md:px-6 md:py-6">
      {/* JSON-LD script: keep exactly as WP13 wrote it */}
      {/* Breadcrumb nav: keep exactly as it is (WP37 changes it) */}

      <div className="mt-2 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-4 md:grid-cols-[300px_minmax(0,1fr)] md:gap-x-6">
        <div className="md:row-span-3">
          <div className="size-24 overflow-hidden rounded-control md:size-auto md:rounded-card md:border md:border-line md:bg-surface md:p-4">
            <ProductImage
              imageUrl={product.image_url}
              productName={getProductDisplayName(product)}
              className="size-24 md:h-72 md:w-full"
              priority
            />
          </div>
        </div>
        <header className="min-w-0 self-center md:self-start">
          <h1 className="text-h1 font-semibold tracking-tight text-ink">{getProductDisplayName(product)}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink-soft">
            {generation && <span>{generation}</span>}
            {setCode && <span className="tabular-nums uppercase tracking-wide">{setCode}</span>}
            {releaseDate && <span>Released {formatDateOnly(releaseDate)}</span>}
            <ExpansionTypeBadge type={product.sets?.expansion_type} />
          </p>
        </header>
        <div className="col-span-2 md:col-span-1 md:col-start-2">
          <ProductQuoteHeader quote={quote} productId={productId} today={today} />
        </div>
        <div className="col-span-2 md:col-span-1 md:col-start-2">
          <ProductActions
            productId={productId}
            boxNavHref={hasContents ? boxCalculatorHref(productId) : null}
            tcgplayerUrl={product.url}
          />
        </div>
      </div>

      <div className="mt-6">
        <ProductChartPanel payload={chartPayload} setName={setName} benchmarks={benchmarks} hasVolume={hasVolume}>
          {recorded && <RecordedHistory model={recorded} />}
        </ProductChartPanel>
      </div>

      {keyStats && (
        <div className="mt-6">
          <KeyStats model={keyStats} today={today} />
        </div>
      )}

      <div className="mt-6">
        <MarketPulseSection pulse={pulse} />
      </div>

      <div className="mt-6">
        <SiblingList setName={setName} rows={siblingRows} />
      </div>

      <CardRinkPromo variant="footer" />
    </main>
  );
}
```

Imports to add (keep the ones `generateMetadata` needs): `ProductImage`, `ExpansionTypeBadge` (already imported), `getCachedProductDetail`, `getCachedProductStats`, `getCachedFxDaily`, `getCachedExchangeRate`, `getCachedProductAttributes`, `getCachedIndexSummary` from `../../lib/serverMarketData`; `availableBenchmarks`, `BENCHMARKS_ENABLED` from `./benchmark`; `statsFor` from `../../lib/marketStats`; `formatDateOnly` from `../../lib/format`; `toDailyPoints` from `../../lib/marketMath`; `boxCalculatorHref` from `../../lib/productAttributes`; `buildChartPayload` from `../../lib/productChart`; `getProductDisplayName`, `parseProductId` from `./productMeta`; `buildKeyStats`, `buildPulse`, `buildQuote`, `buildRecordedHistory`, `buildSiblingRows`, `todayUtcKey` from `./productModel`; the six new components. Remove imports nothing uses any more (`VariantBadge`, `marketPulse` helpers, `priceGuard`, WP18 helpers, `Link` if the breadcrumb does not use it).

Adjustments:
- If the existing main wrapper class differs (WP15 may have set it), keep WP15's padding classes and add `mx-auto max-w-6xl` only if no max width is set yet.
- If `parseProductId` is already applied differently in the current page (WP13), keep that form.
- WP28 absent: remove `getCachedProductAttributes` from the `Promise.all` and use `const attributes = null;`, `releaseDate = product.sets?.release_date ?? null`, `hasContents = false`, and delete the `boxCalculatorHref` import.
- WP29 absent (soft check (b)): remove `getCachedIndexSummary` from the `Promise.all` and its import, and use `const indexSummaries = null;` (`BENCHMARKS_ENABLED` is false, so `availableBenchmarks` offers nothing). When WP29 lands later, the flag test fails; the fix is to set the flag and restore this read.
- `getCachedExchangeRate()` returns `{ rate, date }` (WP11); pass it as `latestRate`. If its field names differ, map them to `{ rate, date }` inline.
- The hero keeps WP12's `priority` prop; do not add `priority` anywhere else.

16b. `app/product/[id]/productMeta.ts`, `buildProductMetadata`: this package puts CAD on the page (the quote header and the chart), so the description gains the sentence WP13 deliberately left out (WP13 Pitfalls: "WP31 adds CAD and the sentence"). Change only the description line to:

```ts
    description: `Daily TCGplayer Market Price, returns, volatility and price history for ${setName} ${label}. Prices in USD and CAD.`,
```

and update the comment above it if it says the page is USD only. In WP13's `app/product/[id]/__tests__/productMeta.test.ts`, change the expected description to `"Daily TCGplayer Market Price, returns, volatility and price history for Prismatic Evolutions Elite Trainer Box. Prices in USD and CAD."`; keep every other assertion. Title, canonical, Open Graph, Twitter and JSON-LD do not change.

### Step 17. `app/product/[id]/loading.tsx`: match the new layout

Replace WP13's skeleton body (keep the file's default export name and any comment explaining the route) with flat `Skeleton` bars that reserve the same boxes as the page, so the streamed page does not shift:

```tsx
import Skeleton from "../../components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-4 md:px-6 md:py-6" aria-busy="true">
      <p role="status" className="sr-only">Loading the product</p>
      <Skeleton className="h-5 w-48" />
      <div className="mt-2 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-4 md:grid-cols-[300px_minmax(0,1fr)] md:gap-x-6">
        <Skeleton className="size-24 md:h-80 md:w-full md:row-span-3" />
        <div className="flex flex-col gap-2 self-center md:self-start">
          <Skeleton className="h-8 w-full max-w-md" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="col-span-2 flex flex-col gap-2 md:col-span-1 md:col-start-2">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-5 w-72" />
        </div>
        <Skeleton className="col-span-2 h-10 w-72 md:col-span-1 md:col-start-2" />
      </div>
      <Skeleton className="mt-6 h-[420px] w-full rounded-card md:h-[480px]" />
      <Skeleton className="mt-6 h-72 w-full rounded-card" />
    </main>
  );
}
```

`Skeleton` renders a `<span className="block ...">`; grid and `row-span` classes apply to it directly.

### Step 18. Portfolio: `?add=<id>` opens the add flow pre-filled

18a. `app/lib/portfolio.ts`: add below `searchProducts`:

```ts
/**
 * One catalog product for the add flow (/portfolio?add=<id>, WP31), with the
 * same fresh-price rule as search results (WP38's applyLatestPrices): a
 * withheld price comes back null.
 */
export async function getProductForAdd(productId: number): Promise<ProductSearchResult | null> {
  if (!Number.isSafeInteger(productId) || productId <= 0) return null;
  const { data, error } = await supabase
    .from("products")
    .select(`
        id, usd_price, image_url, variant,
        sets ( name, code ),
        product_types ( name, label )
      `)
    .eq("id", productId)
    .limit(1);
  if (error) {
    logSupabaseError("product_for_add_failed", error);
    return null;
  }
  const products = (data || []) as unknown as ProductSearchResult[];
  const [product] = await applyLatestPrices(products);
  return product ?? null;
}
```

Use the same client (`supabase` or WP12's lazy loader call) and logger helper `searchProducts` uses after WP05, WP12, WP17 and WP38; copy its form exactly, changing only the filter and limit. WP38 step 8 deleted `getFreshProductsById` and `applyFreshPricesToSearchResults` and prices search results with the module-private `applyLatestPrices(products)` (one `get_latest_prices` call); check with `grep -n "async function applyLatestPrices" app/lib/portfolio.ts` (1 line) and `grep -c "getFreshProductsById" app/lib/portfolio.ts` (0).

18b. `app/components/Portfolio/cards/AddHoldingModal.tsx`: add an optional prop `initialProductId?: number | null;` to the props interface and destructuring, import `getProductForAdd` from `../../../lib/portfolio`, and add after the state declarations:

```tsx
  // /portfolio?add=<id> (WP31): select the product once it loads. The
  // existing pre-fill effect then fills its Market Price, or leaves the
  // field empty when the price is withheld.
  const [initialStatus, setInitialStatus] = useState<"idle" | "loading" | "missing">(
    initialProductId ? "loading" : "idle"
  );
  useEffect(() => {
    if (!initialProductId) return;
    let cancelled = false;
    getProductForAdd(initialProductId).then(
      (product) => {
        if (cancelled) return;
        if (product) {
          setSelectedProduct(product);
          setInitialStatus("idle");
        } else {
          setInitialStatus("missing");
        }
      },
      // A network failure (fetch rejects) degrades to the search field.
      () => {
        if (!cancelled) setInitialStatus("missing");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [initialProductId]);
```

Render directly above the product search field:

```tsx
        {initialStatus === "loading" && (
          <p role="status" className="text-small text-ink-soft">Loading the product you picked…</p>
        )}
        {initialStatus === "missing" && (
          <p role="status" className="text-small text-ink-soft">That product is not in the catalog. Search for it below.</p>
        )}
```

State is set only inside the promise callback, never synchronously in the effect (`react-hooks/set-state-in-effect`).

18c. `app/components/Portfolio/PortfolioDashboard.tsx`: the dashboard renders only in the browser (WP05 pitfall: `/portfolio` never server-renders it), so a lazy state initializer may read `window.location`:

```tsx
/** ?add=<positive integer> from the current URL, or null. */
function readAddParam(): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("add");
  return raw && /^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : null;
}
```

Replace `const [isAddModalOpen, setIsAddModalOpen] = useState(false);` with:

```tsx
  const [addProductId, setAddProductId] = useState<number | null>(readAddParam);
  const [isAddModalOpen, setIsAddModalOpen] = useState(() => addProductId !== null);
```

and change the modal block (WP05 step 15f) to:

```tsx
      {portfolio && isAddModalOpen && (
        <AddHoldingModal
          isOpen
          initialProductId={addProductId}
          onClose={() => {
            setIsAddModalOpen(false);
            if (addProductId !== null) {
              setAddProductId(null);
              // Drop ?add so a reload does not reopen the dialog.
              window.history.replaceState(window.history.state, "", window.location.pathname);
            }
          }}
          onSuccess={applyHoldingSaved}
        />
      )}
```

Keep every other prop WP05, WP14 or WP36 put on the modal. The "Add Holding" button keeps `setIsAddModalOpen(true)` (no initial product).

18d. `app/portfolio/page.tsx`: the client auth gate WP13 wrote calls `loginPathWithNext("/portfolio")`. Change the argument to `` `/portfolio${window.location.search}` `` (it runs in an effect, in the browser), so a session that expires client-side keeps `?add`.

### Step 19. `proxy.ts`: keep the query in `next`

In the `requiresAuth && !user` branch replace

```ts
    url.searchParams.set("next", path);
```

with

```ts
    // The return path keeps its query (WP31: /portfolio?add=42), and the
    // original query is not repeated on the login URL.
    url.search = "";
    url.searchParams.set("next", `${path}${req.nextUrl.search}`);
```

`safeReturnToPath` (WP13) keeps query strings, so sign-in lands on `/portfolio?add=42`. A request without a query produces exactly the URL it did before (`/auth/login?next=%2Fportfolio`).

### Step 20. Documentation

- `frontend/README.md`, in WP22's performance section, add: "`/product/[id]` renders its chart through `components/charts/ProductPriceChartImpl.tsx` in the lazy `ChartBundle` chunk; `lib/productChart.ts` (payload and view math) must only be imported at runtime by the server page and that component. Index overlays fetch `/api/public/index/<code>` on the first toggle only."
- Repo `README.md`, Market Pulse metrics section: one sentence: "The product page shows Market Pulse under the key stats; when there is no signal it names the missing input (price change or volume trend)."
- PR body lists the soft-check results, the measured budget numbers and the new metric keys.

### Step 21. Budgets

No new route. Run the perf commands in Verification. `/product/[id]` JS must stay at or under its recorded limit (at most 145 kB gz), the document at or under 30 kB br, and the largest lazy chunk at or under `lazyChunkGzKb` (120 kB gz; the `ChartBundle` chunk grows by about 5 kB gz). Do not raise any of them. The two leak checks below run on every PR, not only when a number is over:

```bash
cd frontend
# Initial scripts of the product page (from the perf server's HTML).
grep -o 'src="/_next/static/chunks/[^"]*\.js"' /tmp/p1.html | sed 's/src="\/_next\///;s/"$//' | sort -u > /tmp/p1-initial.txt
# Chunks that carry lib/productChart.ts (a string only that file contains) and Recharts.
grep -rl --include="*.js" "Bank of Canada rates are unavailable" .next/static/chunks | sed 's/^\.next\///' | sort -u > /tmp/chart-lib.txt
grep -rl --include="*.js" "recharts-wrapper" .next/static/chunks | sed 's/^\.next\///' | sort -u > /tmp/recharts.txt
comm -12 /tmp/p1-initial.txt /tmp/chart-lib.txt      # nothing
comm -12 /tmp/p1-initial.txt /tmp/recharts.txt       # nothing
test -s /tmp/chart-lib.txt && test -s /tmp/recharts.txt && echo "markers found"   # proves the checks above checked something
```

If a `comm` line prints a file: find the runtime (non-`import type`) import that pulled `productChart.ts`, `productModel.ts` or `recharts` into a client component of the initial bundle and make it type-only. If JS is still over: remove `ProductCurrencyToggle` if it was added (the header toggle replaces it), then stop and report. Report the before and after numbers in the PR.

## Pitfalls: do not do this

- **Do not edit `app/components/PriceChart.tsx` or its wrappers.** Cards and `/market` still use them; the product page stops importing them.
- **Do not import `recharts`, `lib/productChart.ts` or `productModel.ts` at runtime from a client component that ships in the route's initial bundle.** Types only (`import type`). The charting library must stay in the `ChartBundle` chunk.
- **Do not read the session on the product page.** It is ISR; "Add to portfolio" is a link and the proxy handles sign-in.
- **Do not convert history at today's rate.** Chart points use their own day's rate; header and key stats use the quote's rate and say which. A day without a rate is a gap, not an estimate.
- **Do not show CAGR under 365 days, or compute it from the start of the visible range.** It runs from the first tracked price.
- **Do not show any price-anchored figure (change, CAGR, range marker, tracked-high distance, x MSRP, cost per pack, NAV, lowest listing) when the price is withheld.** The key-stats section is not rendered at all in that state.
- **Do not colour distance from high, premium to packs, volume trend or supply change** green or red. Gain and loss colours are for changes and returns only.
- **Do not print "all-time", "live", "real-time" or "TCGPlayer".** "Tracked high since {date}", "TCGplayer".
- **Do not convert the MSRP.** It is a US MSRP; it prints in USD with its code.
- **Do not change the URL, canonical, metadata, JSON-LD or breadcrumb.** WP13 and WP37 own them.
- **Do not put `priority` on any image other than the hero**, and do not remove it from the hero.
- **Do not fetch the index on page load or on hover.** Only on the first toggle press, once per code.
- **Do not build a set index code from the set's code.** WP29's codes are `set-<sets.id>` (numeric id); `set-swsh07` never exists and every press would 404.
- **Do not offer a set toggle the server knows is missing.** WP29 publishes a set index only for sets with 3 or more qualifying constituents; `availableBenchmarks` hides the rest.
- **Do not measure the chart's range change from `end - N + 1` when an anchor exists.** It must use the return anchor rule, or the "1Y change" under the chart contradicts the 1Y chip above it.
- **Do not use `AsOf` for the listing snapshot date.** It prints "Last priced" from 2 days old; a listing is not a price.
- **Do not add `transition-colors` (or any colour transition)** to toggles, rows or links on this page (`01-PRODUCT-DIRECTION.md` §3.5).
- **Do not create `IntentLink`.** WP11 created it; this package only imports it.
- **Do not zero-fill volume outside the covered span, or treat a NULL bucket as zero.**
- **Do not call `getCachedProductStats`, `getCachedFxDaily`, `getCachedProductAttributes` or `getCachedIndexSummary` inside another cached function's callback** (WP11's nested-cache rule). The page calls them side by side.
- **Do not cast Supabase clients to `any`** to get past type errors in `fetchAllRows`.
- **Do not add an em dash anywhere**, in code comments or copy.

## Tests

All new test files follow the repo's Jest setup (`next/jest`). Model tests use `/** @jest-environment node */`; component tests use jsdom and WP23's `test-utils/axe.ts`.

### 1. `app/lib/__tests__/productChart.test.ts` (new, node)

```ts
/** @jest-environment node */
import {
  buildChartPayload,
  buildChartView,
  firstDailyCollectionDay,
  historySince,
  isBackfillTimestamp,
  niceTicks,
  timeTicks,
  dayNumber,
  type ChartPayload,
} from "../productChart";
import { buildFxSeries, EMPTY_FX_SERIES } from "../fx";

function days(start: string, n: number): string[] {
  const base = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}

function payload(overrides: Partial<ChartPayload> = {}): ChartPayload {
  const d = days("2026-08-21", 40);
  return {
    price: { d, v: d.map((_, i) => 100 + i) },
    dailySince: d[0],
    volumeDaily: { d: [], v: [] },
    volumeWeekly: { d: [], v: [] },
    fx: EMPTY_FX_SERIES,
    withheld: false,
    releaseDate: null,
    ...overrides,
  };
}

describe("niceTicks", () => {
  it.each([
    [263, 518],
    [0.8, 3.1],
    [1649.99, 1712.4],
    [59.99, 59.99],
  ])("gives round, evenly spaced ticks covering %p..%p", (min, max) => {
    const { ticks, step } = niceTicks(min, max);
    const mantissa = step / Math.pow(10, Math.floor(Math.log10(step)));
    expect([1, 2, 2.5, 5]).toContain(Number(mantissa.toFixed(6)));
    expect(ticks[0]).toBeLessThanOrEqual(min);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
    for (const t of ticks) expect(Number((t / step).toFixed(6)) % 1).toBe(0);
  });
  it("never goes below zero for non-negative data", () => {
    expect(niceTicks(3, 400).min).toBe(0);
  });
});

describe("chart domain is clamped to data", () => {
  it("a 40-day history on 1Y spans first to last point and reports tracked-since", () => {
    const view = buildChartView({ payload: payload(), range: "1Y", currency: "USD", benchmark: null });
    expect(view.domain).toEqual([dayNumber("2026-08-21"), dayNumber("2026-09-29")]);
    expect(view.trackedSince).toBe("2026-08-21");
    expect(view.last?.dateKey).toBe("2026-09-29");
    expect(view.last?.label).toBe("Sep 29");
  });
  it("1M starts at the return anchor (newest point on or before end - 30) and never extends past the end", () => {
    const view = buildChartView({ payload: payload(), range: "1M", currency: "USD", benchmark: null });
    expect(view.domain).toEqual([dayNumber("2026-08-30"), dayNumber("2026-09-29")]);
    expect(view.trackedSince).toBeNull();
    expect(view.change?.fromKey).toBe("2026-08-30");
    expect(view.change?.pct).toBeCloseTo((139 / 109 - 1) * 100, 6);
  });
  it("1Y uses the anchor window [end - 379, end - 365] like ret_365d, else end - 364", () => {
    const d = days("2025-08-26", 400); // ends 2026-09-29
    const long = payload({ price: { d, v: d.map((_, i) => 50 + i) }, dailySince: d[0] });
    expect(buildChartView({ payload: long, range: "1Y", currency: "USD", benchmark: null }).change?.fromKey).toBe("2025-09-29");
    const gap = d.filter((k) => k < "2025-09-15" || k > "2025-09-29");
    const holed = payload({ price: { d: gap, v: gap.map(() => 50) }, dailySince: gap[0] });
    expect(buildChartView({ payload: holed, range: "1Y", currency: "USD", benchmark: null }).domain[0]).toBe(dayNumber("2025-09-30"));
  });
  it("Max starts at the first point", () => {
    const view = buildChartView({ payload: payload(), range: "MAX", currency: "USD", benchmark: null });
    expect(view.domain[0]).toBe(dayNumber("2026-08-21"));
  });
  it("a withheld product has no range change and still labels its last day", () => {
    const view = buildChartView({ payload: payload({ withheld: true }), range: "1Y", currency: "USD", benchmark: null });
    expect(view.change).toBeNull();
    expect(view.last?.dateKey).toBe("2026-09-29");
  });
  it("fewer than two points is empty", () => {
    const view = buildChartView({ payload: payload({ price: { d: ["2026-09-29"], v: [10] } }), range: "1Y", currency: "USD", benchmark: null });
    expect(view.empty).toBe(true);
  });
});

describe("weekly segment and 30-day average", () => {
  it("detects backfill timestamps", () => {
    expect(isBackfillTimestamp("2025-09-01T12:00:00")).toBe(true);
    expect(isBackfillTimestamp("2025-09-01 12:00:00")).toBe(true);
    expect(isBackfillTimestamp("2026-07-07T04:12:33.123456")).toBe(false);
    expect(firstDailyCollectionDay([
      { recorded_at: "2026-07-05T12:00:00", usd_price: 1 },
      { recorded_at: "2026-07-06T12:00:00", usd_price: 1 },
      { recorded_at: "2026-07-07T04:12:33.1", usd_price: 1 },
    ])).toBe("2026-07-07");
  });
  it("thins pre-daily points to Mondays plus the edges and joins the two lines", () => {
    const backfill = days("2026-06-01", 36).map((d) => ({ recorded_at: `${d}T12:00:00`, usd_price: 50 }));
    const live = days("2026-07-07", 20).map((d, i) => ({ recorded_at: `${d}T05:00:00.5`, usd_price: 50 + i }));
    const p = buildChartPayload({ history: [...backfill, ...live], salesHistory: [], fx: EMPTY_FX_SERIES, withheld: false, releaseDate: null });
    expect(p.dailySince).toBe("2026-07-07");
    const coarse = p.price.d.filter((d) => d < "2026-07-07");
    expect(coarse).toEqual(["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22", "2026-06-29", "2026-07-06"]);
    const view = buildChartView({ payload: p, range: "MAX", currency: "USD", benchmark: null });
    const first = view.rows.find((r) => r.dateKey === "2026-07-07");
    expect(first?.weekly).toBe(50);
    expect(first?.daily).toBe(50);
    expect(view.dashedBefore).toBe("2026-07-07");
  });
  it("draws the 30-day average only from 20 daily points", () => {
    const view = buildChartView({ payload: payload(), range: "MAX", currency: "USD", benchmark: null });
    expect(view.rows[18].ma30).toBeNull();
    expect(view.rows[19].ma30).toBeCloseTo((100 + 119) / 2, 6);
    expect(view.rows[39].ma30).toBeCloseTo((110 + 139) / 2, 6); // window of 30 days
  });
});

describe("currency and benchmark", () => {
  it("converts each point at its own day's rate and leaves gaps without a rate", () => {
    const fx = buildFxSeries([
      { day: "2026-09-01", usd_to_cad: 1.3, source_date: "2026-09-01", source: "boc" },
      { day: "2026-09-29", usd_to_cad: 1.4, source_date: "2026-09-29", source: "boc" },
    ]);
    const view = buildChartView({ payload: payload({ fx }), range: "MAX", currency: "CAD", benchmark: null });
    expect(view.currency).toBe("CAD");
    expect(view.rows.find((r) => r.dateKey === "2026-09-01")?.price).toBeCloseTo(111 * 1.3, 6);
    expect(view.rows.find((r) => r.dateKey === "2026-09-29")?.price).toBeCloseTo(139 * 1.4, 6);
    expect(view.rows.find((r) => r.dateKey === "2026-08-25")?.price).toBeNull();
    expect(view.notes).toContain("CAD starts Sep 1, 2026: earlier points have no Bank of Canada rate.");
    expect(view.notes).toContain("Days without a Bank of Canada rate are left blank."); // Sep 2 to Sep 28 have no row
  });
  it("falls back to USD with a note when fx is empty", () => {
    const view = buildChartView({ payload: payload(), range: "1M", currency: "CAD", benchmark: null });
    expect(view.currency).toBe("USD");
    expect(view.notes).toContain("Shown in USD: Bank of Canada rates are unavailable.");
  });
  it("rebases the index to the first visible day", () => {
    const d = days("2026-08-30", 31);
    const view = buildChartView({
      payload: payload(),
      range: "1M",
      currency: "USD",
      benchmark: { name: "Sealed Index", days: d, levels: d.map((_, i) => 1000 + 10 * i) },
    });
    expect(view.benchmarkStart).toBe("2026-08-30");
    expect(view.rows[0].bench).toBeCloseTo(109, 6);
    expect(view.rows[30].bench).toBeCloseTo(109 * (1300 / 1000), 6);
    expect(view.rows[30].benchChange).toBeCloseTo(30, 6);
  });
  it("starts the overlay at the first day both series have (the index is published for D-1)", () => {
    const d = days("2026-09-01", 28); // index ends 2026-09-28, the product on 2026-09-29
    const view = buildChartView({
      payload: payload(),
      range: "1M",
      currency: "USD",
      benchmark: { name: "Sealed Index", days: d, levels: d.map(() => 1000) },
    });
    expect(view.benchmarkStart).toBe("2026-09-01");
    expect(view.rows.find((r) => r.dateKey === "2026-09-29")?.bench).toBeNull();
  });
});

describe("volume", () => {
  it("uses daily bars up to 92 days and weekly bars beyond", () => {
    const d = days("2026-08-21", 40);
    const p = payload({ volumeDaily: { d, v: d.map(() => 2) } });
    expect(buildChartView({ payload: p, range: "1M", currency: "USD", benchmark: null }).volumeResolution).toBe("daily");
    const long = payload({
      price: { d: days("2025-09-01", 394), v: days("2025-09-01", 394).map(() => 10) },
      volumeDaily: { d, v: d.map(() => 2) },
      volumeWeekly: { d: ["2025-09-01"], v: [30] },
    });
    const view = buildChartView({ payload: long, range: "1Y", currency: "USD", benchmark: null });
    expect(view.volumeResolution).toBe("weekly");
    expect(view.volume.every((b) => b.weekly)).toBe(true);
  });
});

describe("helpers", () => {
  it("historySince keeps the last N days", () => {
    const rows = days("2025-01-01", 700).map((d) => ({ recorded_at: `${d}T05:00:00`, usd_price: 1 }));
    const kept = historySince(rows, 367, new Date("2026-09-30T10:00:00Z"));
    expect(kept[0].recorded_at.slice(0, 10)).toBe("2025-09-28");
  });
  it("timeTicks returns at most five ticks inside the domain", () => {
    const start = dayNumber("2025-09-30") as number;
    const end = dayNumber("2026-09-29") as number;
    const ticks = timeTicks(start, end);
    expect(ticks.length).toBeLessThanOrEqual(5);
    for (const t of ticks) {
      expect(t.t).toBeGreaterThanOrEqual(start);
      expect(t.t).toBeLessThanOrEqual(end);
    }
  });
});
```

Adjust the MA expectation arithmetic if you change `MOVING_AVERAGE_MIN_POINTS`; the constants are the spec, the test must follow them.

### 2. `app/product/[id]/__tests__/productModel.test.ts` (new, node)

Build fixtures with a `makeProduct(overrides)` (id 42, `usd_price: 59.99`, `price_recorded_at: "2026-09-29T05:10:00"`, `returns` with `"1M": 2`, `sets` with id 12, name "Evolving Skies", code "SWSH07", `product_types` label "Booster Bundle"), a `makeStats(overrides)` (all WP25 columns; `day: "2026-09-30"`, `price_day: "2026-09-29"`, `usd_price: 59.99`, `is_price_fresh: true`, `ret_1d: 1.2`, `ret_7d: 3.4`, `ret_30d: -2`, `ret_365d: 18.5`, `low_52w: 50`, `high_52w: 72`, `tracked_high_usd: 72`, `tracked_high_day: "2026-03-03"`, `first_tracked_day: "2025-09-01"`, `vol_weekly_52w: 18.2`, `units_sold_30d: 212`, `sell_through_30d: 34`, `days_of_supply: 12.4`, `liquidity_score: 71`, `listings_snapshot_date: "2026-09-29"`, `lowest_ask_usd: 57.5`, `active_listings: 42`, `ask_premium_pct: -4.2`, others null; with WP28 merged, the five WP28 columns are null too) and `dailyPoints(start, n, priceFn)`. `today = "2026-09-30"`, `latestRate = { rate: 1.37, date: "2026-09-29" }`, an fx series with `1.3686` on every day from 2025-08-01 to 2026-09-30.

Cases (each an `it`):

1. **fresh**: `buildQuote` gives `state "fresh"`, `ageDays 1`, `price.cad` = 59.99 x 1.3686, `rate.kind "dated"`, `rate.day "2026-09-29"`, `changes.usd` equal to the stats values, and `listing` with `count 42`, `lowest.usd 57.5`, `askPremiumPct -4.2` and `snapshotDay "2026-09-29"`. With `stats: null` and a page snapshot `{ active_listings: 7, total_quantity_available: 9, lowest_listing_price: 61, snapshot_date: "2026-09-28" }`, `listing` is `{ count 7, lowest.usd 61, snapshotDay "2026-09-28", askPremiumPct null }` (one source, never mixed).
2. **aging 2 days and 13 days**: `price_recorded_at` `2026-09-28...` and `2026-09-17...`, stats `price_day` matching and `ret_1d: null` (WP25 nulls it unless `price_day >= D - 1`): `state "aging"`, price present, `changes.usd["1D"]` null, key stats not null.
3. **withheld**: `usd_price: null`, `price_recorded_at: "2026-09-05T05:00:00"`: `state "withheld"`, `price`, `changes`, `listing` all null; `buildKeyStats` returns null; `buildRecordedHistory` returns `lastDay` of the points and a tracked high converted with the rate of `tracked_high_day`.
4. **never**: no `price_recorded_at`: `state "never"`, `priceDay null`.
5. **stats disagree**: stats `usd_price: 58` gives every chip null and `cad null`.
6. **CAD chips**: fx 1.30 on every day from 2025-08-01 through 2026-08-31 and 1.40 from 2026-09-01 through 2026-09-30; daily points from 2025-09-01 to 2026-09-29 with price `40 + 0.05 x i`, the last one 59.99 (set it explicitly). Build the stats row's `ret_1d`, `ret_7d`, `ret_30d` and `ret_365d` from those points with the SQL anchor rule (anchors 2026-09-28, 2026-09-23, 2026-08-31 and 2025-09-30 for `D = 2026-09-30`), so every recomputed USD return agrees. Then `changes.cad["30D"]` equals `((59.99 x 1.40) / (P(2026-08-31) x 1.30) - 1) x 100` to 6 places and `changes.cad["7D"]` equals the USD value (same rate at both ends). Removing every point from 2026-09-16 to 2026-09-23 (the 7D anchor window) while keeping `ret_7d` makes `changes.cad` null (whole-row fallback); setting `ret_30d` 0.2 points away from the recomputed value also makes it null.
7. **stale snapshot**: `listings_snapshot_date: "2026-09-20"` gives `listing null`.
8. **CAGR rule**: 40 daily points ending 2026-09-29: `cagrSinceFirstTracked` null and `buildKeyStats(...).cagr` null; 365 days (first point 2025-09-29): not null and equal to `cagrPercent(first, last, ...)`; 364 days: null; withheld: null.
9. **range label**: `first_tracked_day: "2026-06-01"` gives `windowLabel "tracked"` and `since "2026-06-01"`; `"2025-09-01"` gives `"52-week"`.
10. **tracked high**: price 59.99 vs high 72 gives `belowPct` 16.68 (to 2 places); price 72 gives `belowPct null`.
11. **structure** (skip when WP28 is absent): no MSRP, no contents gives `structure null`; `msrp_multiple 1.36`, attributes with `msrp_usd 43.99`, contents present and `nav_status "pack_price_withheld"` gives `nav.value null` and `nav.reason` equal to `NAV_STATUS_TEXT.pack_price_withheld`.
12. **liquidity fallback**: `stats null` uses `getUnitsSoldWindow` and a null percentile.
13. **max drawdown window**: points rising to 100 on 2025-06-01 then falling to 50 by 2025-07-01 and recovering, `priceDay 2026-09-29`: the 1Y drawdown excludes the 2025 fall.
14. **siblings**: a withheld sibling has `price null` and `change30d null`; a priced one has `cad` at its own day's rate and `href "/product/<id>"`.

### 3. `app/lib/__tests__/marketPulse.reason.test.ts` (new, node)

Assert the four strings of the Market Pulse table exactly, and `null` when both inputs exist.

### 4. `app/product/[id]/__tests__/ProductQuoteHeader.test.tsx` (new, jsdom)

Render inside WP20's `CurrencyProvider` (`initialRate={{ rate: 1.37, date: "2026-09-29" }}`), after `_resetCurrencyPreferenceForTests()` and `localStorage.clear()`. Build `quote` with `buildQuote` from test 2's fixtures.

- fresh, default CAD: text "C$82.10" (59.99 x 1.3686 rounded) and "CAD"; "TCGplayer Market Price for Sep 29, 2026"; "From $59.99 USD at the Bank of Canada rate of Sep 29"; a list named "Price change" with four items; the listing line (`data-testid="quote-listing"`) contains "C$78.69", "before shipping, 4.2% below Market Price", "42 listings" and "as of Sep 29", and does not contain "Last priced"; "Price look wrong? Report it"; axe clean.
- fresh, USD stored (`localStorage.setItem("pokefin.currency", "USD")` before render, then `await` a tick): "$59.99" with "USD" and "≈ C$82.10 at the Bank of Canada rate of Sep 29".
- aging (5 days, stats `price_day` 2026-09-25 and `ret_1d: null`): `screen.getByText("Last priced Sep 25, 2026").closest("time")` has the `text-warn-text` class; the first item of the "Price change" list has `data-direction="missing"`.
- withheld: exact text "No current price. Last recorded Sep 5, 2026."; a link "Why prices are hidden" to `/methodology#freshness`; no list named "Price change"; no element matching `/\d%/`; `data-quote-state="withheld"`.
- never: "No current price. This product has never been priced."

### 5. `app/product/[id]/__tests__/KeyStats.test.tsx` (new, jsdom)

Render inside `CurrencyProvider` as in test 4 (`CurrencyAmount`, `QuoteRangeBar` and `CadRateNote` read `useCurrency`), with `today="2026-09-30"`; build the model with `buildKeyStats` from test 2's fixtures.

- Fresh model: headings "Key stats", "Liquidity", "Risk"; `MetricLabel` links for `range52w`, `trackedHigh`, `unitsSold30d`, `sellThrough30d`, `daysOfSupply`, `liquidityScore`, `volatilityWeekly52w`, `maxDrawdown1y` (by accessible name "How {label} is calculated"); "16.7% below the tracked high"; "CAD at the Bank of Canada rate of Sep 29"; axe clean.
- USD stored (`localStorage.setItem("pokefin.currency", "USD")` before render): no text matching `/CAD at the Bank of Canada/`.
- 40-day model (`cagr null`): no text "CAGR".
- `structure null`: no heading "Retail and packs".
- Every `a[href^="/methodology#"]` target anchor is in `METHODOLOGY_SECTIONS` or `METHODOLOGY_SUBSECTIONS`.

### 6. `app/product/[id]/__tests__/ProductChartPanel.test.tsx` (new, jsdom)

Mock `../../../components/charts/ChartBundle` so `ProductPriceChartImpl` renders `<div data-testid="chart" data-range={props.range} data-bench={props.benchmark?.name ?? ""} />` (write it with `require("react").createElement` inside the factory, for the reason given below), and mock `next/dynamic` to render the imported component through `React.lazy` (follow the pattern existing chart-wrapper tests use; if none exists, use the block below and `await screen.findByTestId("chart")`). A `jest.mock` factory cannot use imports from the test file, so it requires React itself:

```tsx
jest.mock("next/dynamic", () => {
  const React = require("react");
  return {
    __esModule: true,
    default: (loader: () => Promise<React.ComponentType<Record<string, unknown>>>) => {
      const Lazy = React.lazy(() => loader().then((Component) => ({ default: Component })));
      // createElement, not JSX: the automatic JSX runtime's helper is an
      // out-of-scope variable, which jest.mock factories may not reference.
      return function DynamicMock(props: Record<string, unknown>) {
        return React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy, props));
      };
    },
  };
});
```

Render inside `CurrencyProvider` (test 4). Default props: a 40-day payload, `setName="Evolving Skies"`, `benchmarks={{ sealed: true, set: "set-12" }}`, `hasVolume`.

- The range group "Chart range" has six radios, "1Y" checked, "Max" named "All tracked history".
- Choosing "Max" passes `range="MAX"`.
- `benchmarks={{ sealed: false, set: null }}`: no button named "vs Sealed Index" or "vs Evolving Skies Index".
- `benchmarks={{ sealed: true, set: null }}`: "vs Sealed Index" present, no "vs Evolving Skies Index".
- Pressing "vs Sealed Index" calls `fetch` once with `/api/public/index/sealed` (mock `global.fetch` resolving `{ ok: true, status: 200, json: async () => ({ code: "sealed", name: "Pokéfin Sealed Index", asOf: "2026-09-28", base: 100, weeklyUntil: null, d: ["2026-09-28"], l: [1000], p: [] }) }`), sets `aria-pressed="true"`, passes the benchmark to the chart (`data-bench="Sealed Index"`) and adds a legend item "Sealed Index"; pressing it off and on again makes no second request.
- A 404 for `/api/public/index/set-12` turns the set button into "No Evolving Skies Index yet" with `aria-disabled="true"`.
- A rejected `fetch` for the sealed index: the `role="status"` element (present from the first render, empty) reads "Index unavailable. Select again to retry." and the button stays `aria-pressed="true"`; the next press calls `fetch` again (second call) and, with a 200 answer, the status element is empty again.
- Payload with one price point: "No history" and no radio group.
- Footnote "Dashed: weekly points before Jul 7, 2026." appears when `dailySince` is inside the default 1Y range; the "How the chart is drawn" link has `href="/methodology#market-price"`.

Call `resetIndexCacheForTests()` in `beforeEach`.

### 7. `app/product/[id]/__tests__/benchmarkFlag.test.ts` (new, node)

```ts
/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";
import { availableBenchmarks, BENCHMARKS_ENABLED, parseIndexPayload, setIndexCode } from "../benchmark";

it("BENCHMARKS_ENABLED matches whether WP29's index route exists", () => {
  const route = path.join(__dirname, "..", "..", "..", "api", "public", "index", "[code]", "route.ts");
  // When this fails after WP29 lands: set the flag to true and restore the
  // getCachedIndexSummary read in page.tsx (WP31 step 16).
  expect(BENCHMARKS_ENABLED).toBe(fs.existsSync(route));
});

it("parses WP29's compact index body and rejects malformed ones", () => {
  const body = { code: "sealed", name: "Pokéfin Sealed Index", asOf: "2026-09-28", base: 100, weeklyUntil: null, d: ["2026-09-28"], l: [1000], p: [] };
  expect(parseIndexPayload("sealed", body)?.levels).toEqual([1000]);
  expect(parseIndexPayload("set-12", body)).toBeNull(); // code mismatch
  expect(parseIndexPayload("sealed", { d: ["2026-09-28"], l: [0] })).toBeNull();
  expect(parseIndexPayload("sealed", { d: ["x"], l: [1] })).toBeNull();
  expect(parseIndexPayload("sealed", null)).toBeNull();
});

it("uses WP29's set-<sets.id> codes and offers only published indices", () => {
  expect(setIndexCode(12)).toBe("set-12");
  expect(availableBenchmarks(false, ["sealed", "set-12"], 12)).toEqual({ sealed: false, set: null });
  expect(availableBenchmarks(true, ["sealed", "set-12"], 12)).toEqual({ sealed: true, set: "set-12" });
  expect(availableBenchmarks(true, ["sealed"], 12)).toEqual({ sealed: true, set: null });
  expect(availableBenchmarks(true, null, 12)).toEqual({ sealed: true, set: "set-12" }); // summary unreadable
  expect(availableBenchmarks(true, ["sealed"], null)).toEqual({ sealed: true, set: null });
});
```

This test fails the day WP29's route lands while the flag is still false, so the flag cannot be forgotten.

### 8. Portfolio and proxy

- `app/components/Portfolio/__tests__/AddHoldingModal.test.tsx` (WP05's file): new cases. Mock `../../../lib/portfolio` `getProductForAdd` resolving a product with `usd_price: 59.99`: rendering with `initialProductId={42}` shows "Loading the product you picked…", then the product is selected and the price field holds "59.99". Resolving `null` shows "That product is not in the catalog. Search for it below." and an empty price field.
- `app/components/Portfolio/__tests__/PortfolioDashboard.addParam.test.tsx` (new): with `window.history.replaceState(null, "", "/portfolio?add=42")` and WP05's data hook mocked to a loaded portfolio, the modal is open with `initialProductId` 42 (mock `AddHoldingModal` to render its props); closing it calls `replaceState` with `/portfolio`. `?add=abc` and `?add=0` open nothing.
- `app/lib/__tests__/proxy.test.ts` (WP17's file): add

```ts
  it("keeps the query of a protected path in next=", async () => {
    const res = await proxy(req("/portfolio?add=42"));
    expect(res.headers.get("location")).toBe("https://pokefin.ca/auth/login?next=%2Fportfolio%3Fadd%3D42");
  });
```

  and keep the existing `/portfolio` and `/account/settings` cases unchanged (they must still pass).

### 9. Existing tests to update

- WP24's `metricDefinitions.test.ts` needs no change beyond passing (new shorts are under 120 characters, no banned words); its "every MetricTile and MetricLabel uses a defined key" case now scans the new files.
- WP24's methodology test: step 2c.
- WP23's `uiConventions.test.ts`: must pass without raising any ratchet; the new files are token-only.
- Any test that asserted the old product page copy ("Return Metrics", "Price History", "View on TCGPlayer", "Not enough volume history yet"): update to the new copy. Find them with `grep -rn "Return Metrics\|Not enough volume history\|Price History" app --include=*.test.*`.
- Tests that render or read the product page or its chart (WP11's sibling `IntentLink` case, WP12's hero `priority` case, WP13's metadata and JSON-LD cases, WP24's product label cases): `grep -rln "product/\[id\]\|ProductDetailChart" app --include=*.test.* --include=*.test.tsx`. Keep every metadata, JSON-LD, canonical, hero `priority` and sibling-`IntentLink` assertion passing unchanged (they guard behaviour this package must not change), except the product description, which step 16b extends with " Prices in USD and CAD."; update only assertions about markup this package replaces, and list each changed assertion in the PR.
- WP11's `serverMarketData` tests that mock `product_price_history` with a single `query({...})` result: the history read is now paged (`range(0, 999)`, newest first), so give the mock a `range` method that returns the same result; assertions on the returned `history` stay as they are (it is re-sorted ascending).

## Verification

From `frontend/`:

```bash
pnpm exec tsc --noEmit                         # 0 errors
pnpm run lint                                  # 0 errors, 0 new warnings
pnpm test --ci app/lib/__tests__/productChart.test.ts "app/product/[id]/__tests__" \
  app/lib/__tests__/marketPulse.reason.test.ts app/lib/__tests__/proxy.test.ts \
  app/components/Portfolio/__tests__ app/lib/__tests__/metricDefinitions.test.ts \
  app/__tests__/uiConventions.test.ts app/methodology
pnpm test --ci                                 # everything green
grep -rn "ProductDetailChart" app              # nothing
grep -rn "TCGPlayer\|all-time\|real-time" "app/product/[id]" app/lib/productChart.ts app/components/charts/ProductPriceChartImpl.tsx   # nothing
LC_ALL=C.UTF-8 grep -rnP "\x{2014}" "app/product/[id]" app/lib/productChart.ts app/components/charts/ProductPriceChartImpl.tsx app/methodology/MethodologyArticle.tsx   # nothing (no em dash; the locale makes \x{2014} a code point)
grep -rn "transition-colors" "app/product/[id]"   # nothing
```

Build and budgets (WP00, WP22):

```bash
SUPABASE_STUB_FIXTURE=perf pnpm build:stub     # exit 0; /product/[id] still ISR (Revalidate 1d), not ƒ
node scripts/perf-serve.mjs &                  # wait for .perf/ready
pnpm perf:budget                               # "/product/[id] JS (gz)" <= its limit (<= 145), document br <= 30, largest lazy chunk <= 120, status ok or "over target", never FAIL
curl -s http://127.0.0.1:3100/product/900001 -o /tmp/p1.html
grep -c 'data-section="quote"' /tmp/p1.html              # 1 or more
grep -c 'data-section="key-stats"' /tmp/p1.html          # 1 or more
grep -c 'TCGplayer Market Price for' /tmp/p1.html        # 1 or more
grep -c 'data-section="chart"' /tmp/p1.html              # 1 or more (the panel is server-rendered; only the plot is lazy)
grep -c 'role="status"' /tmp/p1.html                     # 1 or more (the benchmark status region exists before any press)
# Step 21's chunk checks run here, against /tmp/p1.html.
curl -s http://127.0.0.1:3100/product/900300 -o /tmp/p300.html   # the stale fixture product
grep -c 'data-section="key-stats"' /tmp/p300.html        # 0
grep -c 'No current price. Last recorded' /tmp/p300.html # 1 or more
node -e '
const html = require("fs").readFileSync("/tmp/p300.html", "utf8");
const start = html.indexOf("data-section=\"quote\"");
const quote = html.slice(start, html.indexOf("</section>", start));
const bad = /\d%|CAGR|drawdown|Volatility|NAV|MSRP|Lowest listing/i.exec(quote);
if (start < 0 || bad) { console.error("stale quote leaks:", bad && bad[0]); process.exit(1); }
console.log("stale quote clean");'
pnpm dlx @lhci/cli@0.15.1 autorun              # all assertions pass on /product/900001
kill %1
```

In the Lighthouse report for `/product/900001` (mobile), check the LCP element: it must be the H1, the price text or the hero thumbnail, never a skeleton or chart node. At 1440 px in Chrome DevTools (Performance panel, "LCP" marker) it must be the hero `<img>`.

Manual checks against the perf server (`http://127.0.0.1:3100`):

- 390 px, `/product/900001`: order is thumbnail and title, price, change chips, listing line, report link, actions, chart, key stats, Market Pulse, siblings. No horizontal scroll. Range and toggle controls are 44 px tall on a touch emulation. Switching the header currency (or the fallback toggle) changes the price, secondary line, chips caption, key-stats money and chart axis together.
- 1440 px, same page: image left spanning three rows, header right; chart full width with legend, a dated last point, round y ticks, a volume pane aligned with the price pane; tooltip shows date, price with code, 30-day average and units sold.
- Range: 7D, 1M, 3M, 6M, 1Y, Max each re-draw without layout shift; the summary always ends "since {date}"; on a product with a year of history the 1Y range change equals the 1Y chip in the header (same currency); on a product with under a year of history, 1Y shows "Change ... since {first day}".
- Withheld (`/product/900300`): the quote shows only the sentence, link and report link; no Key stats section; Market Pulse reason names the price.
- Keyboard: Tab reaches the metric "?" links, report link, actions, range radios (arrow keys move), benchmark toggles; focus rings visible.
- Logged out: "Add to portfolio" goes to `/auth/login?next=%2Fportfolio%3Fadd%3D900001`; after signing in (real credentials only; otherwise rely on tests 8 and say so) the add dialog opens with the product selected and the price pre-filled.
- If WP29 has landed: "vs Sealed Index" draws a dashed grey line starting at the product's first visible price; a second press removes it with no new request (Network panel). A product whose set has a published index (look one up on `/indices/sealed`) shows "vs {Set} Index"; a product whose set has none shows no set toggle.

## Owner actions

- None required to merge.
- After deploy, open three real product pages (one booster box with a long history, one product released in the last two months, one with a withheld price) and confirm: the dashed segment ends where daily collection began for that product (the backfill timestamp rule), CAGR appears only on the long-history one, and the withheld one shows no key stats. Report any product whose dashed boundary looks wrong; the fix is to its data, not the rule.
- x MSRP, cost per pack, pack NAV and "Open in Box NAV" appear only once D7 curation (WP28) is loaded; the index toggles only once WP29 is deployed.

## Acceptance criteria

- [ ] H1 is `getProductDisplayName(product)`; URL, canonical, metadata, JSON-LD and breadcrumb are byte-identical to before for the same product, except the meta description, which ends "... for {set} {label}. Prices in USD and CAD." (step 16b).
- [ ] Fresh price: display price in the visitor's currency with its code, "TCGplayer Market Price for {Mon D, YYYY}", the other currency at the Bank of Canada rate of the price's day, 1D/7D/30D/1Y `Delta` chips, a lowest-listing line only with a fresh snapshot ("before shipping", the gap to Market Price as neutral text, numbers from one source, dated "as of"), and a `ReportLink`.
- [ ] Price 2 to 13 days old: `AsOf` shows "Last priced {date}" in warn text; figures still shown.
- [ ] Withheld price (the stale fixture 900300): the header shows only "No current price. Last recorded {date}." with the methodology link and report link; the page renders no key-stats section and no return, CAGR, drawdown, volatility or NAV in the header or stats (Verification node check passes).
- [ ] A product with 40 days of history shows no CAGR; CAGR appears only with 365 or more days from the first tracked price.
- [ ] Key stats: 52-week (or tracked) range bar with the percent off the high, tracked high with its date and "tracked since", x MSRP, MSRP (USD), cost per pack and pack NAV when present, liquidity row, weekly annualised volatility and 1Y max drawdown with its dates; every label is a `MetricLabel` to a defined `/methodology` anchor.
- [ ] Market Pulse "No signal" text names the missing input (price change or volume trend).
- [ ] Chart: directly under the header; legend; own volume pane and axis; round y ticks; x-domain clamped to data; last point labelled with its date; dashed weekly segment with its footnote; ranges 7D to Max starting at the return anchor, with a dated summary that matches the chip of the same window; CAD at dated rates with visible notes for missing rates; index toggles use WP29's `sealed` and `set-<sets.id>` codes, appear only for published indices, fetch once on first press, retry after an error, and are hidden without WP29; Recharts and `productChart.ts` only in the lazy `ChartBundle` chunk (step 21's `comm` checks print nothing).
- [ ] Actions: Add to portfolio (`/portfolio?add=<id>`, pre-filled dialog; logged-out users reach sign-in with `next` keeping the query), an empty `watch` slot, Open in Box NAV when contents exist, View on TCGplayer.
- [ ] Phone order: title, price header, chart, key stats, Market Pulse, siblings; 96 px thumbnail; siblings show price and 30D `Delta` and use `IntentLink`.
- [ ] Tests cover the header states (fresh, 2 to 13 days, withheld, never), the CAGR rule and the chart domain clamp, and all tests pass.
- [ ] `/product/[id]` initial JS at or under 145 kB gz and document at or under 30 kB br in `pnpm perf:budget`; no budget raised.
- [ ] LCP element at 1440 px is the WP12 hero image; at 390 px it is server-rendered header text or the hero thumbnail.
- [ ] `tsc`, lint and the full Jest suite pass; methodology version bumped with a change-log row; `#limits` no longer says product charts use the latest rate; no `transition-colors` in any file this package creates (`grep -rn "transition-colors" "app/product/[id]"` prints nothing).

## Rollback

- Code only, no migration. Revert the PR (`git revert <merge sha>`). The page returns to its previous composition, `ProductDetailChart.tsx` comes back, and `getCachedProductDetailRows` returns to the 367-day window under its old cache key (so no mixed entries are read).
- Partial rollback if only the chart misbehaves: set the panel to render `EmptyState` by returning early in `ProductChartPanel` and ship that as a hotfix while investigating; the header, stats and actions do not depend on the chart.
- If the proxy change causes a redirect problem, revert only `proxy.ts` (the `?add` link then loses its query after sign-in, which degrades to opening `/portfolio` without the dialog).
- Methodology: a revert removes the version row; that is acceptable because the product page it describes is reverted with it.

## Commit and PR

Commits, in order:

1. `feat(methodology): product-page CAGR, drawdown and chart definitions (WP31)`: `metricDefinitions.ts`, `methodology.ts`, `MethodologyArticle.tsx`, `marketPulse.ts`, their tests.
2. `feat(data): full product price history and chart payload (WP31)`: `serverMarketData.ts`, `lib/productChart.ts`, `productChart.test.ts`.
3. `feat(product): decision page model, quote header, key stats, pulse, siblings, actions (WP31)`: `productModel.ts`, `QuoteClient.tsx`, `ProductQuoteHeader.tsx`, `KeyStats.tsx`, `RecordedHistory.tsx`, `MarketPulseSection.tsx`, `ProductActions.tsx`, `SiblingList.tsx` (and `ProductCurrencyToggle.tsx` when created), `page.tsx`, `loading.tsx`, tests 2, 4, 5.
4. `feat(product): honest price chart with volume pane and index overlays (WP31)`: `benchmark.ts`, `ProductChartPanel.tsx`, `ProductPriceChartImpl.tsx`, `ChartBundle.tsx`, deletion of `ProductDetailChart.tsx`, tests 6 and 7.
5. `feat(portfolio): open the add flow from a product page (WP31)`: `portfolio.ts`, `AddHoldingModal.tsx`, `PortfolioDashboard.tsx`, `portfolio/page.tsx`, `proxy.ts`, test 8.
6. `docs: product page chart and pulse notes (WP31)`.

End every commit message with the attribution lines the session requires.

PR title: `WP31: product decision page (quote header, key stats, honest chart, actions)`

PR body:

```markdown
## What
- /product/[id] leads with a dated quote: price in the visitor's currency, "TCGplayer Market Price for {date}", the other currency at the Bank of Canada rate of that day, 1D/7D/30D/1Y changes (CAD returns at dated rates), lowest listing before shipping, report link.
- Chart directly under the header: legend, own volume pane, round ticks, domain clamped to data, dated last point, dashed weekly segment before daily collection, 7D to Max, index overlays rebased to the range start (fetched on first toggle).
- Key stats: 52-week range, tracked high since first tracked day, CAGR only with 365+ days, x MSRP / MSRP / cost per pack / pack NAV (WP28), liquidity row, weekly volatility and 1Y drawdown. Withheld prices withhold all of it; history metrics move under the chart, dated.
- Market Pulse names the missing input. Siblings show price and 30D change with intent-only prefetch (WP11's IntentLink).
- The chart's range change starts at the return anchor, so it matches the header chip of the same window.
- Actions: Add to portfolio (/portfolio?add=<id> opens a pre-filled dialog; sign-in keeps the query), Watch slot for WP34, Open in Box NAV, View on TCGplayer.

## Soft checks
- WP28 code: present / absent
- WP29 index route: present (BENCHMARKS_ENABLED = true) / absent (false; the flag test will force it on)
- WP26 getCachedProductHistory: present (sliced to 367 days) / absent
- WP27 header toggle: present / absent (ProductCurrencyToggle added; delete with WP27)
- WP33 maxDrawdown1y definition: already present (skipped) / added here
- Methodology #limits bullet: deleted (WP36 merged first) / rewritten to portfolio charts only (comment kept for WP36) / not found

## Budgets
| | before | after | limit |
|---|---|---|---|
| /product/[id] JS (gz) | | | |
| /product/[id] document (br) | | | |
LCP element: 1440 px hero img; 390 px {H1 | price | thumbnail}.

## Not changed
URL, canonical, metadata, JSON-LD, breadcrumb (WP13, WP37). PriceChart.tsx (cards, /market).
```

Append the PR attribution line the session requires.
