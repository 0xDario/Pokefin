# WP33: Screener: dense ranked table, filters and presets (replaces Market View)

- **Goal**: an investor ranks and filters all 306 sealed products by return, risk, liquidity, supply and value in one dense 44 px table, starts from a ready-made screen such as "Off highs with thin supply", shares any view by copying the URL, and exports what they see as CSV. On a 390 px phone the same screen is a sortable two-line list with a filter sheet and a sort sheet, never a clipped table. `/market` becomes `/screener` with a 308 that keeps the query string.
- **Why now / value**: `/market` today is a 93 px-row table that shows no sort state, prints CAGR, drawdown and volatility as `--` until each row's history is fetched, and is "unusable on a phone" (research/ui-audit.md `/market`). WP25 made every metric an indexed read of `product_daily_stats`, WP26 made sparklines free, WP30 shipped the phone row helpers and `IntentLink`, and WP23/WP24 shipped the table vocabulary and metric definitions. Supply and liquidity screens are the feature competitors cannot copy (01-PRODUCT-DIRECTION.md §5 item 4; research/competitive-landscape.md §4 item 3, §5 item 2).
- **Effort**: L, 16 to 18 hours (migration 0042 and its DB test 2.5 h, row builder, stats column and fixture 1.5 h, metrics, URL state, filters and presets 2.5 h, table, phone list and filter UI 5 h, CSV 0.75 h, route move, nav, perf config and smoke 1.5 h, methodology 1 h, tests 2.5 h, measurement 1 h). The migration is the part above the 14 to 16 h of 01-PRODUCT-DIRECTION.md §8: "Max drawdown 1Y" is a decided Risk column and `product_daily_stats` has no such column (see D1 item 9).
- **Depends on**: WP13 (`NoResults`, `app/sitemap.ts`, the `redirects()` block in `next.config.ts`, per-route `metadata`), WP19 (the column-descriptor pattern this package reuses; its `MarketView` files are deleted here), WP22 (`perf-budgets.json`, `lighthouserc.json`, `scripts/fixtures/perf.mjs`, `prod-smoke-lib.mjs`, `pnpm perf:budget`), WP23 (`DataList`, `DataListRow`, `Delta`, `AsOf`, `Badge`, `Button`, `PageHeader`, `ProvenanceLine`, `SegmentedControl`, `EmptyState`, token utilities, the `uiConventions` ratchet), WP24 (`MetricLabel`, `DecisionNote`, `PROVENANCE_SENTENCE`, `DECISION_NOTE`, `metricDefinitions.ts`, `/methodology` and `content/methodology.ts`), WP25 (`product_daily_stats`, `product_stats_latest`, `getCachedProductStats`, `PRODUCT_STATS_SELECT`, `ProductDailyStats`, the perf fixture's `productStats`), WP26 (`getCachedSparklines`, `sparklineFor`, `MiniSparkline` `series` and sizes, `WARM_PATHS`, `forbiddenChunks`, the public-route ESLint list), WP30 (`IntentLink`, `catalogValues.ts`, `shared/msrp.ts`, `utils/freshness.ts` with `utcDateKey` and `isPriceDayStale`, the `list` sparkline size). Through them: WP07 (`format.ts`), WP08 (`locationSearch.ts`, `LocationSearchSignal`), WP11 (cached reads and tags), WP14 (`Dialog`), WP18 (`lib/sorting.ts`), WP20 (`useCurrency`, `app/types/market.ts`, `pnpm types:db`), WP21 (replay harness, `pokefin_scraper`). Soft, each with a default in "Before you start": WP27 (`navConfig.ts`, `Dialog` `placement`, currency in the header), WP28 (x MSRP, cost per pack, premium to packs; the Value columns, "Near MSRP" and "Below pack value" appear only when the data exists), WP31 (the `maxDrawdown1y` definition), WP32 (home links through `SCREENER.href`).
- **Unblocks**: WP35 (alert suggestions can link to a screen by URL), WP37 (the set page can deep-link to `/screener?set=<id>`), and the deferred `saved_views` table (the URL format defined here is what it would store).
- **Placement**: Speed lane, after WP30 and WP25 (WP22 -> WP26 -> WP30 -> WP33). It reserves migration **0042**, the first number after the 0033 to 0041 registry, and keeps it even if it merges before WP34 to WP37. The migration only adds a column, a trigger and re-creates a view with the same query, so it has no ordering constraint with 0038 to 0041.
- **Suggested branch name**: `remediation/wp33-screener-with-presets`
- **Risk level**: medium. It moves a public route (a wrong redirect breaks shared links and search results; covered by a smoke check and a curl check), adds a trigger on the table the scraper writes every run (it catches its own errors and never aborts the refresh), and replaces a whole page; there is no user data involved and rollback is a revert plus one optional `DROP TRIGGER`. Deploy order matters: 0042 must be in production before the frontend ships, because the shared stats select names the new column (Owner action 1; phase B enforces it, since the types are generated from production).

## Why

A collector-investor cannot answer "which sealed products are 20% off their highs and still selling faster than they are listed?" anywhere on Pokéfin today. `/market` shows 10 rows per 1440 px screen, gives no visible sort state, labels columns "VOL Δ" without a definition, prints `--` for CAGR, drawdown and volatility on every row until that row's chart is opened, and on a phone keeps the desktop table so the price column is off-screen and scrolled cells slide under the sticky columns (research/ui-audit.md `/market`, "What looks unprofessional or confusing" and top improvements 1 to 4; research/ui-audit.md "Mobile": "on a phone none shows its key number in the first screen"). The research ranks a screener with presets and shareable URLs as a core finance pattern that every benchmark product has and Pokéfin lacks (research/competitive-landscape.md §2 table row "Screener plus saved presets", §4 item 3), and the supply and liquidity columns from listings history are the feature no competitor surfaces (research/competitive-landscape.md §5 item 2; research/data-opportunities.md §3.4, §3.5, and §3.18 "Screener presets"). After this package `/screener` is server-rendered from `product_daily_stats` with no client history fetch, ranks every product on 18 metrics in four column presets, applies six documented screens, keeps every choice in the URL, exports the visible view as CSV with fresh values only, and renders a thumb-friendly list below 768 px; the 1-year maximum drawdown becomes a precomputed column, as research/data-opportunities.md §3.13 asks. Investors get the ranking tool; collectors get a phone list that works at a card show; the owner gets a shareable surface for every screen.

## Design

### D1. Decisions (binding)

| # | Decision | Source |
|---|---|---|
| 1 | `/market` becomes `/screener`: `next.config.ts` answers `/market` with a 308 to `/screener`, query string preserved (Next passes it through). `app/market/` is deleted. Nav label "Screener". Prices stays the browse catalog | task scope; 01-PRODUCT-DIRECTION.md §4.1 |
| 2 | The URL is the saved view and the share mechanism. No `saved_views` table | task scope |
| 3 | Four column presets (Performance, Risk, Liquidity, Value) replace the key/all toggle. Value appears only when WP28 data exists | task scope; ui-audit.md `/market` improvement 4 |
| 4 | The inline per-row history chart, the Chart column, CAGR, Price/Day, Release and Days Since columns are removed. Rows link to the product page | task scope; ui-audit.md `/market` ("CAGR -70.17% annualised from 40 days") |
| 5 | Every metric comes from `product_stats_latest` (WP25) joined on the server to the catalog summaries, the volume metrics and the 1Y baked sparklines (WP26). No client fetch of any kind | task scope; 01-PRODUCT-DIRECTION.md §6.1 |
| 6 | A product whose price is withheld (not `is_price_fresh`, migration 0023) shows `--` in every metric column (price included), sinks to the bottom of every metric sort (nulls sort last; the Name sort stays A to Z), never matches a preset, and exports blank values | task scope; 01-PRODUCT-DIRECTION.md §2 principle 1 |
| 7 | Returns are the USD Market Price returns from `product_daily_stats` (bounded anchors, WP25). They are the same in USD and CAD, as on `/prices` (WP30 D5). A caption says so | WP30 D5; WP25 `#returns` |
| 8 | "Delta" in the brief means every return cell renders with WP23's `Delta` (glyph plus 1-decimal magnitude, gain/loss colour). Volume trend, supply change, from-high and premium to packs are neutral signed text (they are not returns) | 01-PRODUCT-DIRECTION.md §3.2 |
| 9 | "Max drawdown 1Y" is stored as `product_daily_stats.max_dd_365d_pct`, written by a BEFORE trigger in migration 0042, with the product page's definition (WP31 `maxDrawdownOverYear`, WP18 `maxDrawdownPercent`). Computing it per request for 306 products would break the "indexed read of a precomputed table" rule | 01-PRODUCT-DIRECTION.md §6.1; data-opportunities.md §3.13 |
| 10 | Filters: search, product type, era, set (single selects, same values as `/prices`), price band (USD buckets), return window range, from 52-week high, volatility, max drawdown, sell-through, days of supply, 30D supply change, liquidity percentile, x MSRP, premium to packs, Market Pulse signal, "Current price only". Min and max are inclusive; the price band's upper end is exclusive; an active range excludes rows whose value is unknown | task scope |
| 11 | Six presets in `app/screener/presets.ts`, each a full `ScreenerState` (filters plus sort and column preset), each with `priced` on, each documented on `/methodology#screens` from the same constants. A preset whose required metric has no data anywhere is not offered | task scope |
| 12 | A column that a filter or the sort uses is always visible, appended after the preset's columns in canonical order | ui-audit.md `/market` (sorted value must be visible) |
| 13 | Default view: Performance columns, sorted by 1M change, high to low (ui-audit.md `/market` improvement 2: "default sort by 30D change"). The server renders the default view; the URL's view is applied right after hydration (WP08's mechanism) | ui-audit.md |
| 14 | The table renders 50 rows, then "Show 50 more" and "Show all {n}". Sorting and filtering always rank the whole catalog; only rendering is paged. This keeps the document and sort INP inside budget | 01-PRODUCT-DIRECTION.md §6.1 |
| 15 | Phones (below 768 px) render WP23's `DataList` with `DataListRow`; the table is not rendered there. Both are in the server HTML (CSS shows one); after hydration only the one for the current width stays mounted | task scope; ui-audit.md top-10 item 1 |
| 16 | CSV export is client-side from the loaded rows: every row that matches the filters (not only the 50 rendered), in the current order, the visible columns only, fresh values only, amounts in the selected currency, and one attribution line at the end | task scope; trust-seo-brand.md §9 |
| 17 | Sort, filter, preset, column and "Show more" changes update a draft state urgently (controls paint at once) and the results in `startTransition`, with the results dimmed to 70% while pending | task scope; performance-excellence.md §13.2 |
| 18 | Light theme, token utilities only, no raw palette class and no hex in new files. No new component in `app/components/ui/`; `MetricLabel.tsx` only gains an exported `MetricHelpLink` extracted from its own markup | 01-PRODUCT-DIRECTION.md §3; WP23 ratchet |

### D2. Metrics (columns)

Every value is computed on the server by `buildScreenerRows` (`app/screener/screenerData.ts`) and rounded to 2 decimals before it is sent. `S` is the product's `product_stats_latest` row (WP25), `V` its volume-metrics row (WP11, `units_sold_30d` and `units_sold_prior_30d`), `P` its catalog summary. "Fresh" = `hasCurrentPrice(P)` and, when `S` exists, `S.is_price_fresh` and `S.usd_price` not null. When not fresh, every metric is null.

| Id | Header | Full label (MetricLabel key) | Value | Format | Sort starts | Width |
|---|---|---|---|---|---|---|
| `price` | Price | Market Price (`marketPrice`) | `S.usd_price`, else `P.usd_price` | `formatPrice` (currency context), plus WP23 `AsOf variant="table"` clock at 2+ days | high first | 120 |
| `r7d` `r1m` `r3m` `r1y` | 7D, 1M, 3M, 1Y | `return7d`, `return1m`, `return3m`, `return1y` | `S.ret_7d`, `ret_30d`, `ret_90d`, `ret_365d`; without `S`: `P.returns["7D" / "1M" / "3M" / "1Y"]` | `Delta` | high first | 88 each |
| `signal` | Signal | Market Pulse (`marketPulse`) | `getPulseSignal(r1m, vtrend)` (thresholds 2% and 20%, WP24 exports them) | `Badge` neutral with `PULSE_SIGNAL_META[s].label` | not sortable | 128 |
| `vol` | Volatility 1Y | Volatility 1Y (weekly, annualised) (`volatilityWeekly52w`) | `S.vol_weekly_52w` | `formatPercent`, 1 dp | low first | 104 |
| `dd` | Max DD 1Y | Max drawdown (1Y) (`maxDrawdown1y`) | `S.max_dd_365d_pct` (migration 0042), a positive magnitude | `formatPercent`, 1 dp | low first | 104 |
| `off` | From 52W high | From 52-week high (`fromHigh52w`, new) | `(S.usd_price / S.high_52w - 1) x 100` when `S.high_52w > 0` | `formatPercent`; "At high" when `>= -0.05` | most below first | 112 |
| `units` | Sold 30D | Units sold (30d) (`unitsSold30d`) | `S.units_sold_30d`, else `V.units_sold_30d` when there is no `S` | integer | high first | 96 |
| `vtrend` | Volume trend | Volume trend (`volumeTrend`) | `getVolumeTrendPercent(V.units_sold_30d, V.units_sold_prior_30d)` | `formatSignedPercent`, neutral | high first | 104 |
| `st` | Sell-through | Sell-through (30d) (`sellThrough30d`) | `S.sell_through_30d` | `formatPercent`, 0 dp | high first | 104 |
| `dos` | Days supply | Days of supply (`daysOfSupply`) | `S.days_of_supply` | WP30 `formatDaysOfSupply` ("<1", whole days) | low first | 96 |
| `sc30` | Supply 30D | Supply change (30d) (`supplyChange30d`) | `S.qty_change_30d_pct` | `formatSignedPercent`, neutral | most negative first | 104 |
| `liq` | Liquidity | Liquidity (percentile) (`liquidityScore`) | `S.liquidity_score` | integer | high first | 96 |
| `msrp` | x MSRP | x MSRP (`msrpMultiple`, WP28) | `S.msrp_multiple` | `formatMsrpMultiple` ("1.4x") | low first | 88 |
| `cpp` | Per pack | Cost per pack (`costPerPack`, WP28) | `S.cost_per_pack_usd` | `formatPrice` | low first | 104 |
| `prem` | vs packs | Premium to packs (`premiumToPacks`, WP28) | `S.premium_to_packs_pct` | `formatSignedPercent`, neutral | most negative first | 96 |

Edge cases: a product with no `S` row (added after the last refresh, or the stats read failed) keeps price, returns (from the catalog RPC), units and volume trend, and shows `--` for the rest. A missing value prints `--` with an `sr-only` reason: "Price withheld" for a stale row, "Not available" otherwise ("No signal" in the Signal column). Nulls sort last in both directions (`compareSortValues`, WP18); ties keep the base order (set release date newest first, then type label, then product id), so every sort is deterministic.

Column presets (the "Columns" control):

| Preset | Columns after #, Product and Price | Trend |
|---|---|---|
| Performance (default) | 7D, 1M, 3M, 1Y, Signal | Trend 1Y |
| Risk | Volatility 1Y, Max DD 1Y, From 52W high, 1Y | Trend 1Y |
| Liquidity | Sold 30D, Volume trend, Sell-through, Days supply, Supply 30D, Liquidity | Trend 1Y |
| Value (only with WP28 data) | x MSRP, Per pack, vs packs | Trend 1Y |

1Y is repeated in Risk so risk is always read next to the return it cost. The Trend column is WP26's baked 1Y sparkline (`MiniSparkline size="list"`, 96x28), header "Trend 1Y" with the `title` "Price over the last year, scaled to its own low and high".

### D3. URL state

All keys are optional; a key at its default is omitted, and keys are written in this fixed order, so two equal views have equal URLs. Numbers are plain decimals in the units the column shows (percent points, days, multiples, USD for the price band).

| Key | Meaning | Default |
|---|---|---|
| `q` | search in set name, set code, type label, type name, variant (case-insensitive, at most 100 characters) | empty |
| `type` | product type label, exactly as `/prices` uses it | all |
| `gen` | era (generation name), as on `/prices` | all |
| `set` | set id (positive integer) | all |
| `pmin`, `pmax` | price band in USD, `pmin <= price < pmax` | none |
| `rw` | return window of the return range: `7d`, `1m`, `3m`, `1y` (written only with `rmin` or `rmax`) | `1y` |
| `rmin`, `rmax` | return range, % | none |
| `offmin`, `offmax` | from 52-week high, % (values are 0 or negative) | none |
| `volmin`, `volmax` | volatility 1Y, % | none |
| `ddmin`, `ddmax` | max drawdown 1Y, % (positive) | none |
| `stmin`, `stmax` | sell-through 30D, % | none |
| `dosmin`, `dosmax` | days of supply | none |
| `sc30min`, `sc30max` | supply change 30D, % | none |
| `liqmin`, `liqmax` | liquidity percentile, 0 to 100 | none |
| `msrpmin`, `msrpmax` | x MSRP | none |
| `premmin`, `premmax` | premium to packs, % | none |
| `sig` | `demand_surge`, `thin_supply`, `distribution`, `cooling` | any |
| `priced` | `1` = current price only | off |
| `sort` | `name`, `price`, `r7d`, `r1m`, `r3m`, `r1y`, `vol`, `dd`, `off`, `units`, `vtrend`, `st`, `dos`, `sc30`, `liq`, `msrp`, `cpp`, `prem` | `r1m` |
| `dir` | `asc`, `desc` (written only when it differs from the sort's starting direction) | per sort |
| `cols` | `performance`, `risk`, `liquidity`, `value` | `performance` |

Unknown values fall back to the default; an unparseable number is ignored. Foreign keys (`utm_source`) are kept by WP08's `replaceOwnedSearchParams`. Example: the "Low-volatility compounders" screen is `/screener?rmin=10&volmax=15&ddmax=15&priced=1&sort=r1y&cols=risk`.

Price band select values: Any, "Under US$50" (`pmax=50`), "US$50 to US$150", "US$150 to US$500", "US$500 and up" (`pmin=500`). Any other pair (hand-edited URL) shows as "Custom range".

### D4. Presets (screens)

Constants live in `PRESET_RULES` (`app/screener/presets.ts`) and are printed on `/methodology#screens`; a changed threshold bumps the methodology version. Every preset sets `priced=1`, clears the search and every other filter.

| Id | Name | Rules | Sort, columns | Needs data in |
|---|---|---|---|---|
| `off-highs-thin-supply` | Off highs with thin supply | from 52-week high `<= -20`; days of supply `<= 30` | from high, most below first; Risk (Days supply appended) | `off`, `dos` |
| `near-msrp` | Near MSRP | x MSRP `<= 1.25` | x MSRP low first; Value | `msrp` (WP28) |
| `supply-draining` | Supply draining | supply change 30D `<= -15`; sell-through `>= 20` | supply change, most negative first; Liquidity | `sc30`, `st` |
| `low-vol-compounders` | Low-volatility compounders | 1Y return `>= 10`; volatility 1Y `<= 15`; max drawdown 1Y `<= 15` | 1Y high first; Risk | `r1y`, `vol`, `dd` |
| `distribution-warning` | Distribution warning | Market Pulse = Distribution (1M change `<= -2%` and volume trend `>= +20%`) | 1M low first; Performance | `signal` |
| `below-pack-value` | Below pack value | premium to packs `<= -1` | premium, most negative first; Value | `prem` (WP28) |

A preset is "active" (its button pressed, "Screen: {name}" shown) when the current filters equal its filters; sort and columns may differ. Changing any filter leaves the preset.

### D5. Screens

`/screener` at 1440 x 900, default view (Performance), first paint from the server HTML:

```
+----------------------------------------------------------------------------------------------------------------------------+
| [mark] Prices  Screener  Sets  Portfolio  Tools v                 (clock) Prices as of Sep 29   [Q Search /]  USD|CAD   (a) |  64
+----------------------------------------------------------------------------------------------------------------------------+
  Screener                                                                                                        h1 24/32
  306 sealed products. TCGplayer Market Price in USD, updated daily. Prices older than 14 days are hidden. Prices as of Sep 29. Methodology
  SCREENS [Off highs with thin supply] [Near MSRP] [Supply draining] [Low-volatility compounders] [Distribution warning] [Below pack value]
  SEARCH                 PRODUCT TYPE      ERA              SET                 PRICE (USD)      MARKET PULSE
  [Name, set or code  ]  [All types    v]  [All eras     v] [All sets        v] [Any price    v] [Any signal   v]  [ ] Current price only  [Metric filters]
  No filters. Every tracked product is listed.                                                                            36 (fixed)
  Found 306 products · showing 50                         COLUMNS [#Performance#| Risk | Liquidity | Value ]   [Export CSV]
  +--------------------------------------------------------------------------------------------------------------------------+
  |  #  PRODUCT                                  PRICE ?     7D ?     1M v ?     3M ?     1Y ?    SIGNAL ?        TREND 1Y     |  40
  |  1  Elite Trainer Box · Crown Zenith  PKC   C$142.10   ▲ 3.1%   ▲ 38.2%   ▲ 41.0%  ▲ 62.4%  Demand surge   ___/''''     |  44
  |  2  Booster Box · Evolving Skies            C$612.40   ▲ 0.4%   ▲ 12.0%   ▲ 4.2%   ▲ 21.7%  --             /\/\_/\      |  44
  |  3  Booster Bundle · Silver Tempest (c)      C$41.70   ▼ 1.1%   ▲ 9.8%    ▼ 2.0%   --       Thin supply    ''\___       |  44
  | ...                                                                                                                      |
  | 306 Elite Trainer Box · Hidden Fates             --       --       --        --       --      --             No history   |  44
  +--------------------------------------------------------------------------------------------------------------------------+
                                       [ Show 50 more ]   Show all 306
  Returns and changes are on the USD Market Price, so they are the same in both currencies. CAD prices use the latest Bank of Canada rate.
  Screens describe past prices. They are not recommendations. How we calculate this
```

- `?` is `MetricHelpLink` (24 px target) next to each metric header's sort button; `v` is the visible ▼ of the sorted column (bold ink header, `aria-sort="descending"`); other sortable headers show a faint ↕.
- `(c)` is the WP23 table `AsOf` clock (price 2 to 13 days old; `title` and `sr-only` "Last priced Sep 25"). The withheld row shows `--` everywhere and the clock with "Last priced Aug 1". Phones print the same fact as words (below).
- `#` is a CSS counter (not a prop), so re-sorting moves rows without re-rendering them.
- `#` and Product are sticky on the left; when the table is wider than its container (768 to 1279 px, or extra columns) it scrolls horizontally inside its rounded border. The header is not sticky: a sticky header does not work inside a horizontal scroll container, and 50-row pages keep it within about two screens.

Risk preset with the "Off highs with thin supply" screen applied (1440 px). Days supply is appended because a filter uses it:

```
  SCREENS [#Off highs with thin supply#] [Near MSRP] ...
  Screen: Off highs with thin supply  [Current price only x] [From 52-week high at most -20% x] [Days of supply at most 30 days x]  Clear all
  Found 28 products                                        COLUMNS [ Performance |#Risk#| Liquidity | Value ]   [Export CSV]
  |  #  PRODUCT                               PRICE ?   VOLATILITY 1Y ?  MAX DD 1Y ?  FROM 52W HIGH ^ ?   1Y ?     DAYS SUPPLY ?  TREND 1Y |
  |  1  Booster Box · Fusion Strike           C$298.00      18.4%          31.2%          -36.9%       ▼ 12.4%       9          ''\__    |
```

`/screener` at 390 x 844 (phone), default view. Heights in px on the right:

```
+--------------------------------------+
| [mark] (clock)          [Q]  [=]     |  64  site header (WP27)
+--------------------------------------+
| Screener                             |  32  h1
| 306 sealed products. TCGplayer Market|
| Price in USD, updated daily. Prices  |  54  ProvenanceLine (3 lines)
| older than 14 days are hidden. ...   |
| [Screens: choose one             v]  |  44  select, applies on change
| [ Filters (0) ] [ Sort: 1M change ][v]| 44  two sheet triggers + direction toggle
| No filters. Every tracked product ...|  36  fixed-height filter line
| Found 306 products · showing 50      |  20
+--------------------------------------+
| Elite Trainer Box · Crown Zen..  __/ |  line 1: title, variant, 64x24 trend 1Y
| 55 sold 30D        C$142.10 ▲38.2% 1M|  line 2: meta | price, Delta (sorted window, else 1M)
+--------------------------------------+  56+ per row
| Booster Box · Evolving Skies    /\/\ |
| 212 sold 30D        C$612.40 ▲12.0% 1M|
+--------------------------------------+
| Booster Bundle · Silver Tempest ''\_ |
| (c) Last priced Sep 25 C$41.70 ▲9.8% 1M|
+--------------------------------------+
  ... at least 6 rows fully visible (measured, step 28)
        [ Show 50 more ]  Show all 306
  Returns and changes are on the USD ...
  Screens describe past prices. ...
```

The meta slot shows the sorted metric when it has no other place in the row: "18 days of supply", "Volatility 1Y 12.3%", "Max DD 1Y 18.2%", "From 52W high -23.4%" (or "At 52-week high"), "Volume trend +12.0%", "Sell-through 38%", "Supply 30D -18.0%", "Liquidity 72", "1.4x MSRP", "Per pack C$5.50", "vs packs -3.1%"; for name, price and return sorts it shows units sold. A row whose price is 2 or more days old, or withheld, shows "Last priced {Mon D}" there instead (warn text with the clock glyph), whatever the sort. The Delta shows the sorted return window (7D, 1M, 3M or 1Y), otherwise 1M.

Phone filter sheet (WP14 `Dialog`, full screen with WP27's `placement="top"`):

```
+--------------------------------------+
| Filters                          [x] |
|--------------------------------------|
| SEARCH                               |
| [Name, set or code               ]   |  16 px text (no iOS zoom)
| PRODUCT TYPE     [All types      v]  |
| ERA              [All eras       v]  |
| SET              [All sets       v]  |
| PRICE (USD)      [Any price      v]  |
| MARKET PULSE     [Any signal     v]  |
| [x] Current price only               |
| Performance                          |
|  RETURN WINDOW   [1Y             v]  |
|  1Y return (%)   Min [   ] Max [   ] |
| Risk                                 |
|  From 52-week high ? (%)  Min  Max   |
|  Volatility 1Y (weekly...) ? (%) ... |
|  Max drawdown (1Y) ? (%)   ...       |
| Liquidity                            |
|  Sell-through (30d) ? (%) ...        |
|  Days of supply ? (days) ...         |
|  Supply change (30d) ? (%) ...       |
|  Liquidity (percentile) ? ...        |
| Value (only with WP28 data)          |
|  x MSRP ? (x) ...  Premium to packs  |
|--------------------------------------|
| [ Reset ]   [   Show 28 products   ] |  footer pinned
+--------------------------------------+
```

Phone sort sheet: title "Sort by", groups General (Name, Market Price), Performance (7D to 1Y), Risk, Liquidity, Value; each option a 44 px button with a check on the current one; choosing one applies it with its starting direction and closes the sheet. The direction toggle next to "Sort" flips it.

Desktop "Metric filters" opens an in-flow panel under the filter bar with the same Performance, Risk, Liquidity and Value groups in four columns (`grid-cols-4` from 1280 px, two columns from 768 px).

### D6. States

| State | Desktop table | Phone list | Page |
|---|---|---|---|
| First paint | default view, 50 rows, from the server HTML | same | "Prices as of Sep 29" |
| URL has a view (shared link) | right after hydration the view is applied, rows re-sort or re-filter once, the fixed-height filter line shows the chips (no layout shift above the table) | same | |
| Sort, filter, preset, columns changed | header arrow, pressed preset, chips paint at once; rows update in a transition, dimmed to 70% with `aria-busy` | same | |
| Price 2 to 13 days old | clock after the price, `title` and `sr-only` "Last priced Sep 25" | the meta slot reads "Last priced Sep 25" in warn text (WP23 `AsOf` inline variant: a tooltip never shows on touch) | |
| Price withheld | `--` in every metric cell with `sr-only` "Price withheld", clock "Last priced Aug 1", sparkline "No history" | `--` price and change, meta "Last priced Aug 1" | |
| No stats row (new product) | price, returns, units, volume trend, signal; others `--` | same | |
| Stats read failed (`stats.day` null) | as above for every row | same | warn line: "Risk, supply and value statistics are unavailable right now. Prices and returns come from the catalog." Presets needing them are not offered |
| No WP28 data | Value preset, Near MSRP, Below pack value, x MSRP and premium filters hidden | same | |
| No products match | WP13 `NoResults` ("No products match these filters", "Clear filters") | same | |
| Catalog empty (outage) | WP23 `EmptyState` "No products to screen right now." | same | |
| Sparkline payload null | flat bar (WP26 `undefined`) | same | never "No history" for a failed read |
| Export with 0 rows | button disabled | same | |

There is no loading spinner: the rows are in the HTML.

### D7. Copy (every new user-facing string)

"Screener" (h1, nav, title); `{n} sealed products. ` + `PROVENANCE_SENTENCE` + " Prices as of {Mon D}." + "Methodology"; "Screens"; the six preset names and summaries from D4; "Screens: choose one"; "Search", placeholder "Name, set or code"; "Product type", "All types"; "Era", "All eras"; "Set", "All sets"; "Price (USD)", "Any price", "Under US$50", "US$50 to US$150", "US$150 to US$500", "US$500 and up", "Custom range"; "Market Pulse", "Any signal"; "Current price only"; "Metric filters", "Metric filters ({n})"; "Performance", "Risk", "Liquidity", "Value"; "Return window"; "{W} return"; "Min", "Max"; "Reset", "Clear all"; "No filters. Every tracked product is listed."; "Screen: {name}"; chip texts "{Label} at least {v}", "{Label} at most {v}", "{Label} between {a} and {b}", "Current price only", "Search "{q}"", "Type: {t}", "Era: {e}", "Set: {s}", "Price: {band}", "Market Pulse: {signal}"; "Filters", "Filters ({n})", "Sort: {label}", "Sort by", "General", "Name", "Market Price", "Show {n} products"; "Found {n} products", " · showing {k}" (every count through `productCount`: "1 product", "{n} products"); "Columns"; "Export CSV"; "Show {k} more", "Show all {n}"; "Trend 1Y"; "At high"; the returns caption in D5; "Risk, supply and value statistics are unavailable right now. Prices and returns come from the catalog."; "No products to screen right now."; "Last priced {Mon D}" (phone meta, WP23 `AsOf`); "At 52-week high" (phone meta); sr-only: "Rank", "Price withheld", "Not available", "No signal", ", remove filter", "Sort order: high to low. Switch to low to high". CSV headers in D8. No "live", "real-time", "all-time", "undervalued", "buy"; "TCGplayer" spelled that way; no em dashes.

### D8. CSV

`pokefin-screener-{statsDay}.csv`, UTF-8 with BOM, CRLF line ends (RFC 4180). Header row: `Product ID`, `Product type`, `Set`, `Set code`, `Era`, `Variant`, `Market Price ({USD|CAD})`, `Price day`, `Price status` (`current` or `withheld`), then one column per visible metric: `{full label} ({unit})` where the unit is the currency code for money, `%` for percents, `x` for x MSRP, `days` for days of supply, and the definition's `unitLabel` for integers; Signal has no unit. Values: money in the selected currency (converted at the latest rate by `useCurrency().convertPrice`), 2 decimals; percents 1 decimal (sell-through 0); integers whole; days 1 decimal; x MSRP 2 decimals; signal as its label. Withheld rows: price and metrics empty. Text cells that start with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` (formula injection); cells with a comma, quote or line break are quoted. Last line, after one empty line: `Source: Pokéfin (<page URL>). TCGplayer Market Price data, daily statistics for <statsDay>. [USD converted to CAD at <rate, 4 decimals> (Bank of Canada, <rateDate>). ]` + `DECISION_NOTE`. No price history, no raw listings: only the view (01-PRODUCT-DIRECTION.md §7).

### D9. Accessibility

- One `h1`. The table has a `sr-only` caption ("Screener results: 212 products, sorted by 1M change, high to low"); headers are `th scope="col"`; the sorted header carries `aria-sort`. Each sortable header is a `<button>` whose name is its visible short label; the full label and definition are in its `title` and in the adjacent `MetricHelpLink` ("How Volatility 1Y (weekly, annualised) is calculated"). The rank number is CSS generated content (`::before`), which browsers expose to screen readers; the visible `#` header is `aria-hidden` and the header says "Rank" to screen readers.
- One link per row (the product name, WP30 `IntentLink`); the variant is part of its text. The phone row is WP23's single-link `DataListRow`.
- Direction is never colour-only (`Delta` glyph plus `sr-only` word). Missing values say why (`sr-only`).
- Preset buttons use `aria-pressed`; the phone preset select is labelled "Screen". Chips are buttons named "{text}, remove filter". The "Metric filters" button has `aria-expanded` and `aria-controls="screener-metric-filters"`.
- Range inputs are `inputMode="decimal"` text inputs named "Min, {full label}" and "Max, {full label}" (visible text "Min"/"Max" is part of the name, WCAG 2.5.3), `aria-invalid` while the text is not a number.
- Sheets are WP14 `Dialog`s (focus trapped, Escape and backdrop close, focus returns to the trigger). The sort sheet uses buttons with `aria-pressed`, not radios, so arrow keys do not apply and close it.
- "Found {n} products" is `role="status"` (polite). The results region has `aria-busy` while a transition is pending.
- Touch targets: every control `pointer-coarse:min-h-11`; phone rows at least 56 px; inputs 16 px text below 640 px. Focus: `focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action` everywhere (never `outline-none`: in Tailwind 4 it removes the only focus cue in Windows forced-colours mode, and WP24's trust test fails on it in `MetricLabel.tsx` and `MethodologyArticle.tsx`). Colour changes are instant (no `transition-colors`, 01-PRODUCT-DIRECTION.md §3.5); the only transition is the opacity dim, with `motion-reduce:transition-none`.
- Sparklines stay `aria-hidden` (WP26).

### D10. Design system use

WP23: `DataList`, `DataListRow`, `Delta`, `AsOf`, `Badge`, `Button`, `PageHeader`, `ProvenanceLine`, `SegmentedControl` (Columns), `EmptyState`; WP24: `MetricLabel` (filter legends), `MetricHelpLink` (new export of `MetricLabel.tsx`), `DecisionNote anchor="screens"`; WP14 `Dialog`; WP13 `NoResults`; WP26 `MiniSparkline`; WP30 `IntentLink`, `formatDaysOfSupply`, `formatMsrpMultiple`. Tokens only: `text-ink`, `text-ink-soft`, `text-action`, `bg-action`, `bg-surface`, `bg-surface-alt`, `border-line`, `divide-line`, `ring-action`, `accent-action`, `text-warn-text`, `border-warn-text`, `rounded-control`, `rounded-card`, `text-h1` to `text-caption`. Table density follows WP23's dense `SortableTable` (40 px header, 44 px rows, hairline dividers); the table itself is Screener-specific because `SortableTable` sorts internally, takes string labels and has no sticky columns.

### D11. Performance and budgets

| Check | Target | How |
|---|---|---|
| `/screener` initial JS (gz) | ≤ 165 kB (hard) | `perf-budgets.json` route `/screener`, `pnpm perf:budget` |
| `/screener` document (br) | ≤ 60 kB (target) | same |
| Sort INP, 1440 px, 4x CPU, default view | ≤ 150 ms for every click | `scripts/measure-screener.mjs`, trace attached to the PR |
| Phone sort-sheet pick INP, 390 px, 4x CPU | ≤ 150 ms | same script |
| CLS (Lighthouse CI, mobile) | ≤ 0.05 | `lighthouserc.json` `/screener` |
| Rows fully visible on the first 390 x 844 screen | ≥ 6 | same script |
| supabase-js and Recharts reachable from `/screener` | never | `forbiddenChunks` |
| Requests after load | 0 (no history, no sparkline fetch) | DevTools, manual |

How the budget holds: the metric filter panel and both phone sheets are `next/dynamic` chunks loaded on first open (preloaded on hover and focus of their trigger); the CSV module is a dynamic `import()` on click; rows are memoised and receive only stable props (the rank is a CSS counter, columns come from a cache keyed by the id list); rendering stops at 50 rows; no charting library, no Supabase client, no product images (the thumbnail column is dropped, which also clears WP22's `uses-responsive-images` warning for this route).

## Before you start

Read fully (paths from `frontend/` unless stated):

- `audits/remediation/01-PRODUCT-DIRECTION.md` §2, §3, §4.1, §6; `research/ui-audit.md` "`/market` Market View", "Mobile", top-10 items 1 and 7; `research/competitive-landscape.md` §4 item 3; `research/data-opportunities.md` §3.3 to §3.5, §3.13; `research/performance-excellence.md` §13.
- Specs: WP19 step 3 (descriptor pattern), WP22 D2 to D7 and steps 10, 12, 17, WP23 steps 8, 13, 17, 22, 24, WP24 steps 4 to 6, 10, 22, WP25 steps 1, 8, 9, 11, 13, 14, WP26 steps 3, 5, 10, 17, 19, 22, WP28 steps 1, 5, 7, 14, 15, WP30 steps 1, 4, 7, 13, WP31 step 1.
- Code: `app/market/page.tsx`; everything in `app/components/MarketView/`; `app/lib/serverMarketData.ts` (`getCachedMarketProductSummaries`, `getCachedVolumeMetrics`, `getCachedProductStats`, `PRODUCT_STATS_SELECT`, `getCachedSparklines`); `app/lib/marketStats.ts`; `app/lib/marketPulse.ts`; `app/lib/priceGuard.ts`; `app/lib/format.ts`; `app/lib/sorting.ts`; `app/lib/sparkline.ts`; `app/lib/locationSearch.ts`; `app/components/LocationSearchSignal.tsx`; `app/components/ProductPrices/index.tsx` (how WP08 wires the URL store); `app/components/ProductPrices/utils/{catalogValues,freshness}.ts`; `app/components/ProductPrices/shared/msrp.ts`; `app/components/IntentLink.tsx`; `app/components/ui/{DataList,Delta,AsOf,Badge,Button,PageHeader,ProvenanceLine,SegmentedControl,EmptyState,Dialog,MetricLabel,DecisionNote}.tsx`; `app/components/NoResults.tsx`; `app/lib/metricDefinitions.ts`; `app/content/{methodology,disclosures}.ts`; `app/methodology/MethodologyArticle.tsx` and its test; `app/types/market.ts`; `next.config.ts`; `app/sitemap.ts`; `eslint.config.mjs`; `perf-budgets.json`; `lighthouserc.json`; `scripts/fixtures/perf.mjs`; `scripts/perf-fixture.test.mjs`; `scripts/prod-smoke-lib.mjs`, `scripts/prod-smoke.mjs`, `scripts/prod-smoke-lib.test.mjs`; `app/__tests__/uiConventions.test.ts`; repo root `revalidate_hook.py`, `tests/test_revalidate_hook.py`, `migrations/0033_*.sql`, `migrations/0036_*.sql` (if present), `tests/test_wp25_market_analytics_db.py`, `verify_migration.py`.

Confirm the starting state:

```bash
cd /home/user/Pokefin
git status --short                                               # clean
ls migrations | grep -E '^0042_'                                 # no output: 0042 is free
ls migrations | grep -E '^00(3[3-9]|4[01])_'                     # the Track 2 migrations that exist; 0033 must be listed

cd frontend
# WP08
ls app/lib/locationSearch.ts app/components/LocationSearchSignal.tsx
grep -n "export function createDebouncedSearchWriter\|export function useLocationSearch" app/lib/locationSearch.ts   # 2 lines
# WP13
ls app/components/NoResults.tsx app/sitemap.ts
grep -n 'source: "/stats"' next.config.ts                        # 1 line (the redirects() block)
grep -n '"/market"' app/sitemap.ts                               # 1 line
# WP18
grep -n "export function compareSortValues" app/lib/sorting.ts   # 1 line
# WP19 (deleted here)
ls app/components/MarketView/                                    # MarketView.tsx, MarketTableRow.tsx, columns.tsx, buildRows.ts, sorting.ts, MiniSparkline.tsx, __tests__
# WP20
grep -n "export function useCurrency" app/context/CurrencyContext.tsx      # 1 line
grep -n '"types:db"' package.json                                          # 1 line
# WP22
ls perf-budgets.json lighthouserc.json scripts/fixtures/perf.mjs scripts/perf-serve.mjs scripts/prod-smoke-lib.mjs
grep -n '"/market"' perf-budgets.json lighthouserc.json scripts/prod-smoke-lib.mjs   # several lines
# WP23
ls app/components/ui/{DataList,Delta,AsOf,Badge,Button,PageHeader,ProvenanceLine,SegmentedControl,EmptyState,Dialog}.tsx
grep -n "export function DataListRow\|export function DataList" app/components/ui/DataList.tsx   # 2 lines
grep -n "export function formatPercent\|export function formatSignedPercent\|export function formatInteger" app/lib/format.ts   # 3 lines
# WP24
ls app/components/ui/MetricLabel.tsx app/components/ui/DecisionNote.tsx app/content/methodology.ts app/methodology/MethodologyArticle.tsx
grep -n "export const DECISION_NOTE\|export const PROVENANCE_SENTENCE" app/content/disclosures.ts   # 2 lines
grep -n "export const PRICE_THRESHOLD_PCT\|export const VOLUME_THRESHOLD_PCT" app/lib/marketPulse.ts   # 2 lines
# WP25
grep -n "export async function getCachedProductStats" app/lib/serverMarketData.ts               # 1 line
grep -n "const PRODUCT_STATS_SELECT" app/lib/serverMarketData.ts                                # 1 line
grep -n "export function statsFor\|export function toProductStatsSnapshot" app/lib/marketStats.ts   # 2 lines
grep -n 'key: "volatilityWeekly52w"\|key: "sellThrough30d"\|key: "supplyChange30d"\|key: "liquidityScore"' app/lib/metricDefinitions.ts   # 4 lines
grep -n 'anchor: "range-52w"' app/content/methodology.ts                                        # 1 line
grep -n '"/rest/v1/product_stats_latest"' scripts/fixtures/perf.mjs                             # 1 line
# WP26
grep -n "export async function getCachedSparklines" app/lib/serverMarketData.ts                 # 1 line
grep -n "export function sparklineFor" app/lib/sparkline.ts                                      # 1 line
grep -n '"/market"' ../revalidate_hook.py eslint.config.mjs                                      # WARM_PATHS and the public-route list
# WP30
ls app/components/IntentLink.tsx app/components/ProductPrices/utils/catalogValues.ts app/components/ProductPrices/utils/freshness.ts app/components/ProductPrices/shared/msrp.ts
grep -n 'list: "h-6 w-16 md:h-7 md:w-24"' app/components/MarketView/MiniSparkline.tsx           # 1 line
grep -n "export function formatDaysOfSupply\|export function utcDateKey\|export function isPriceDayStale" app/components/ProductPrices/utils/catalogValues.ts app/components/ProductPrices/utils/freshness.ts   # 3 lines
```

If any of these hard checks fails, stop and report the missing package: this package edits their files and must not recreate them.

Soft checks, each with the default to apply:

```bash
# (a) WP27: nav module, Dialog placement, currency in the header
grep -n 'href: "/market"' app/components/nav/navConfig.ts
grep -n "type DialogPlacement" app/components/ui/Dialog.tsx
grep -rn "useCurrency" app/components/Header.tsx app/components/nav 2>/dev/null | head -3
# (b) WP28: value metrics
grep -n 'key: "msrpMultiple"\|key: "costPerPack"\|key: "premiumToPacks"' app/lib/metricDefinitions.ts
grep -n "msrp_multiple: number | null" app/types/market.ts
# (c) WP31: drawdown definition
grep -n 'key: "maxDrawdown1y"' app/lib/metricDefinitions.ts
# (d) remaining /market links
grep -rn '"/market"\|/market"' app --include=*.ts --include=*.tsx | grep -v "components/MarketView/"
```

- (a) `navConfig.ts` present: step 21c changes one line there. Absent: step 21c edits `app/components/Header.tsx` and `app/components/Footer.tsx` instead (label "Screener", href "/screener"). `DialogPlacement` present: sheets use `placement="top"` (full screen on phones). Absent: omit the prop (centred dialog, WP14 default). Header currency present: nothing to add. Absent: step 19 renders WP20's `CurrencySelector` in the results bar (see the note there).
- (b) All three keys present: use them. Absent: step 5b adds them with WP28's exact text but anchor `"box-nav"`, and the PR notes that WP28 must change those three entries instead of adding them. `msrp_multiple` absent from the type: nothing to do, `screenerData.ts` reads the WP28 columns through an optional-field type.
- (c) Present: use it. Absent: step 5c adds WP31's definition, and the PR notes that WP31 must skip it.
- (d) Every hit is handled in step 21 (links become `/screener`).

Tooling: Node and pnpm as in WP00; Python venv and local Postgres for the database test exactly as WP25 "Before you start" describes (Docker `postgres:17` or the PostgreSQL 16 binaries, `scripts/db/replay_migrations.sh`); Chrome or Chromium plus `playwright-core` outside the lockfile for step 28 (`npm install --no-save --prefix /tmp/pw playwright-core@1.56`).

Baseline, from `frontend/`: `pnpm exec tsc --noEmit` (exit 0), `pnpm lint` (0 errors), `pnpm test --ci` (all pass), `pnpm test:scripts` (all pass). From the repo root: `python -m pytest tests/ -q`. Record the counts for the PR.

The work has two phases, like WP25 and WP28. **Phase A** (steps 1 to 28) needs nothing from the owner; at its end open a draft PR titled `[waiting for DB types] feat: Screener with presets (WP33)` and hand the owner Owner actions 1 and 2. **Phase B** (step 29) regenerates `app/types/database.ts` once 0042 is in production. Until then `tsc` reports that `max_dd_365d_pct` is not a column of `product_stats_latest` in `serverMarketData.ts`; that is the only allowed `tsc` failure in phase A. Do not cast around it.

`next build` type-checks, so that one error also fails `pnpm build:stub` in phase A, and step 28 needs a build. Two ways, in this order of preference: (1) if the owner can apply 0042 and push the types quickly, do step 29 first and then step 28; (2) otherwise measure on a temporary, uncommitted edit of the generated file: in `app/types/database.ts` add `max_dd_365d_pct: number | null` to the `Row` of `product_daily_stats` and of `product_stats_latest` and `max_dd_365d_pct?: number | null` to the table's `Insert` and `Update`, run step 28, then discard it with `git checkout app/types/database.ts` before any commit (`git status` must not list the file). Never commit a hand edit of `database.ts`; step 29 regenerates it from production. The draft PR's CI build fails until phase B; that is expected.

## Implementation steps

Paths are relative to `frontend/` unless they start with the repo root (`migrations/`, `tests/`, `revalidate_hook.py`, `README.md`, `audits/`). Order: 1 to 6 data and shared definitions, 7 to 13 pure screener modules (no React), 14 to 19 components, 20 to 23 the route, 24 methodology, 25 to 27 perf, smoke and docs, 28 measurement, 29 phase B.

### Step 1. `migrations/0042_product_max_drawdown.sql` (new, repo root)

Create the file with exactly this content:

```sql
-- Migration 0042: 1-year maximum drawdown in product_daily_stats (WP33).
--
-- The Screener's Risk columns rank all active products by maximum drawdown
-- over the last 365 days. Computed per request that is a window function over
-- a year of price history for every product, which 01-PRODUCT-DIRECTION.md
-- section 6.1 rules out ("every new read is an indexed read of a precomputed
-- table"). This migration stores it on product_daily_stats.
--
-- Definition (the same as the product page: WP31 maxDrawdownOverYear over
-- WP18 toDailyPoints and maxDrawdownPercent): take the FIRST price row of
-- each UTC day with day in [price_day - 364, price_day] and usd_price > 0;
-- walk them oldest first keeping the running peak; a day's drawdown is
-- (1 - price / peak) x 100; the column is the largest of them, a positive
-- percent (0 when the price never fell below an earlier peak). NULL when
-- fewer than 2 days are in the window or the row has no price_day.
--
-- It describes recorded history, like the tracked high and weekly volatility,
-- so it is not gated on is_price_fresh (the 0023 split between price-anchored
-- and series columns). Pages that rank on it withhold it with the price.
--
-- How it is written: a BEFORE INSERT OR UPDATE OF price_day, usd_price
-- trigger. refresh_product_daily_stats (0033) upserts every row with both
-- columns in its SET list, so every refresh recomputes the value, and no
-- later migration has to replace refresh_market_analytics to keep it (0036
-- and 0037 replace that function; this file does not touch it). WP28's
-- structure step updates other columns only and does not fire the trigger.
-- An error inside the trigger sets the column to NULL with a WARNING and
-- never aborts the refresh.
--
-- product_stats_latest is re-created with the same query so its s.* includes
-- the new column (a view's column list is fixed when it is created).
--
-- Idempotent. Safe to re-run. Apply after every earlier numbered migration
-- that exists.
--
-- Verification:
--   SELECT public.refresh_market_analytics((now() AT TIME ZONE 'UTC')::date);
--   -- Values are percents between 0 and 100 (expect 0):
--   SELECT count(*) FROM public.product_daily_stats
--    WHERE max_dd_365d_pct < 0 OR max_dd_365d_pct > 100;
--   -- Latest rows with 2 or more priced days in the window have a value (expect 0):
--   SELECT count(*) FROM public.product_stats_latest s
--    WHERE s.max_dd_365d_pct IS NULL
--      AND (SELECT count(DISTINCT h.recorded_at::date)
--             FROM public.product_price_history h
--            WHERE h.product_id = s.product_id
--              AND h.recorded_at >= (s.price_day - 364)::timestamp
--              AND h.recorded_at <  (s.price_day + 1)::timestamp
--              AND h.usd_price > 0) >= 2;
--   -- anon reads the column and cannot run the helper (expect true, false):
--   SELECT has_column_privilege('anon', 'public.product_stats_latest', 'max_dd_365d_pct', 'SELECT'),
--          has_function_privilege('anon', 'public.product_max_drawdown_365d(bigint, date)', 'EXECUTE');

-- ============================================================
-- 1. Column
-- ============================================================

ALTER TABLE public.product_daily_stats
  ADD COLUMN IF NOT EXISTS max_dd_365d_pct double precision;

DO $$ BEGIN
  ALTER TABLE public.product_daily_stats
    ADD CONSTRAINT product_daily_stats_max_dd_range
      CHECK (max_dd_365d_pct IS NULL OR (max_dd_365d_pct >= 0 AND max_dd_365d_pct <= 100));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- ============================================================
-- 2. The computation (internal)
-- ============================================================

CREATE OR REPLACE FUNCTION public.product_max_drawdown_365d(p_product_id bigint, p_end date)
RETURNS double precision
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH days AS (
    -- First reading of each UTC day, like toDailyPoints (WP18).
    SELECT DISTINCT ON (h.recorded_at::date)
           h.recorded_at::date AS day,
           h.usd_price::double precision AS usd
      FROM public.product_price_history h
     WHERE h.product_id = p_product_id
       AND h.recorded_at >= (p_end - 364)::timestamp
       AND h.recorded_at <  (p_end + 1)::timestamp
       AND h.usd_price > 0
     ORDER BY h.recorded_at::date, h.recorded_at ASC
  ),
  walk AS (
    SELECT d.usd,
           max(d.usd) OVER (ORDER BY d.day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS peak,
           count(*) OVER () AS n
      FROM days d
  )
  SELECT CASE WHEN max(w.n) >= 2 THEN max((1 - w.usd / w.peak) * 100) END
    FROM walk w;
$$;

REVOKE ALL ON FUNCTION public.product_max_drawdown_365d(bigint, date) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3. The trigger
-- ============================================================

CREATE OR REPLACE FUNCTION public.product_daily_stats_set_max_dd()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    NEW.max_dd_365d_pct := public.product_max_drawdown_365d(NEW.product_id, NEW.price_day);
  EXCEPTION WHEN OTHERS THEN
    -- Never fail the refresh for this column: the scraper's hook must not
    -- lose a run's statistics over one derived value.
    RAISE WARNING 'product_daily_stats_set_max_dd(product %, day %): %', NEW.product_id, NEW.day, SQLERRM;
    NEW.max_dd_365d_pct := NULL;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.product_daily_stats_set_max_dd() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS product_daily_stats_max_dd ON public.product_daily_stats;
CREATE TRIGGER product_daily_stats_max_dd
  BEFORE INSERT OR UPDATE OF price_day, usd_price ON public.product_daily_stats
  FOR EACH ROW EXECUTE FUNCTION public.product_daily_stats_set_max_dd();

-- ============================================================
-- 4. Read path: same query as 0033 and 0036, re-created for s.*
-- ============================================================

CREATE OR REPLACE VIEW public.product_stats_latest
WITH (security_invoker = true)
AS
SELECT s.*
  FROM public.product_daily_stats s
  JOIN public.products p ON p.id = s.product_id AND p.active = true
 WHERE s.day = (SELECT max(d.day) FROM public.product_daily_stats d);

REVOKE ALL ON TABLE public.product_stats_latest FROM anon, authenticated;
GRANT SELECT ON TABLE public.product_stats_latest TO anon, authenticated;

-- ============================================================
-- 5. Fill the newest two days (pages read the newest day; older rows keep
--    NULL until a refresh rewrites them)
-- ============================================================

UPDATE public.product_daily_stats
   SET price_day = price_day
 WHERE day >= (SELECT max(d.day) - 1 FROM public.product_daily_stats d);
```

Notes:
- Who executes the helper: the refresh runs as the owner of `refresh_market_analytics` (SECURITY DEFINER, owner `postgres`), the backfill in section 5 runs as the migration runner, and nobody else writes the table (WP25 revoked writes from `anon` and `authenticated`; `pokefin_scraper` only calls the refresh). A direct write by any other role would hit "permission denied" on the helper, which the trigger catches (value NULL).
- Performance: the helper is an index range scan on `product_price_history (product_id, recorded_at)` (indexes from `20260506_market_performance_functions.sql` and 0023) of at most about 365 rows. The upsert fires the trigger twice per row (BEFORE INSERT on the proposed row, BEFORE UPDATE on conflict): about 612 scans per refresh, well under 100 ms on production size. WP25's 10 s refresh budget test covers it because it calls the full refresh.
- Checked during review on PostgreSQL 16.13, on a scaffold with 0003's one-row-per-day index, an RLS-enabled `product_daily_stats` and a refresh that upserts with `ON CONFLICT ... DO UPDATE SET usd_price, price_day, ...`: the file applies twice cleanly; a second refresh of the same day recomputes through the BEFORE UPDATE path; an UPDATE that does not name `price_day` or `usd_price` leaves the value alone; a refresh of a past day uses that day's window; and a role without EXECUTE on the helper gets a WARNING and NULL instead of an aborted statement. Values carry float noise (for example `9.999999999999998`); the Screener rounds to 2 decimals and the DB test uses `pytest.approx`.
- `backfill_daily_stats.py` (WP25) needs no change: every row it writes goes through the trigger. Rewriting 400 days takes a few minutes longer than before; say so in the README (step 26).

Check the file with the repo's migration checker (from the repo root):

```bash
python3 verify_migration.py migrations/0042_product_max_drawdown.sql > /tmp/wp33_0042.sql; echo "exit=$?"
# expect exit=3 and on stderr:
#   -- function product_max_drawdown_365d(p_product_id bigint, p_end date): body <md5>, ... security invoker, sql, volatility s, config search_path=public,pg_temp
#   -- function product_daily_stats_set_max_dd(): body <md5>, ... security invoker, plpgsql, volatility v, config search_path=public,pg_temp
#   -- privilege lines: EXECUTE revoked for public, anon, authenticated on both functions;
#      INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER revoked and SELECT granted for anon and authenticated on product_stats_latest
#   -- NOT VERIFIED (out of scope, check by hand): 1 x CREATE TRIGGER, 1 x CREATE VIEW, 1 x DO block, 1 x UPDATE (or similar)
```

If the checker's output format differs, what matters is that the generated verification query returns OK rows after you apply the file to the replayed database (step 2).

Then replay the whole chain twice (WP21's harness) and confirm it stays green:

```bash
bash scripts/db/replay_migrations.sh        # replay_once and replay_twice, exit 0
```

### Step 2. `tests/test_wp33_max_drawdown_db.py` (new, repo root)

Runs in WP21's "Database replay and Python tests" CI job, like WP25's module. Code in "Tests", item 1. Run it now against the replayed database:

```bash
POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once \
  python -m pytest tests/test_wp33_max_drawdown_db.py -v            # 9 passed
POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once \
  python -m pytest tests/test_wp25_market_analytics_db.py -q        # still all pass (refresh budget included)
```

Use the port your local Postgres listens on (WP25 uses 55432 for the Docker container).

### Step 3. The stats row: type and select

3a. `app/types/market.ts`, in `interface ProductDailyStats` (WP25), add as the last member (after WP28's `nav_status` if present, else after `refreshed_at`):

```ts
  /** WP33 (migration 0042): largest peak-to-later-low fall over the 365 days ending at price_day, % (positive). Not gated. */
  max_dd_365d_pct: number | null;
```

3b. `app/lib/serverMarketData.ts`, `PRODUCT_STATS_SELECT` (WP25, extended by WP28): append `, max_dd_365d_pct` inside the template literal, after the last column it lists today, keeping one template literal. For example, after WP28 the last line becomes:

```ts
  msrp_multiple, cost_per_pack_usd, nav_usd, premium_to_packs_pct, nav_status, max_dd_365d_pct`;
```

3c. Run `pnpm exec tsc --noEmit`. Expected errors: (1) the phase A error in `fetchProductStatsLatest` about `max_dd_365d_pct` (resolved in step 29), and (2) any test or helper that builds a full `ProductDailyStats` object literal without the new field: add `max_dd_365d_pct: null` to each such literal. Nothing else may fail.

### Step 4. Perf fixture: the new column

4a. `scripts/fixtures/perf.mjs`, in `buildPerfData`, directly above the final `return { ... };` (after every other package's block, so no earlier draw changes and every recorded limit stays valid), add:

```js
  // WP33: max_dd_365d_pct (migration 0042). Its own PRNG stream, so every
  // value above is unchanged. Not gated, like the SQL: stale rows keep it.
  const ddRand = mulberry32((PERF_SEED ^ 0x0033) >>> 0);
  for (const row of productStats) {
    row.max_dd_365d_pct = row.price_day === null ? null : Math.round((2 + ddRand() * 48) * 100) / 100;
  }
```

If `productStats` has another name in the file, use the array WP25 added (the rows behind `"/rest/v1/product_stats_latest"`).

4b. `scripts/perf-fixture.test.mjs`: append (import `buildPerfData` and `assert` as the file's existing tests do):

```js
test("WP33: every product stats row has a max drawdown between 0 and 100", () => {
  const data = buildPerfData({ now: new Date("2026-10-14T15:00:00Z"), baseUrl: "http://127.0.0.1:3100" });
  assert.equal(data.productStats.length, 306);
  for (const row of data.productStats) {
    assert.ok(row.max_dd_365d_pct === null || (row.max_dd_365d_pct >= 0 && row.max_dd_365d_pct <= 100), String(row.product_id));
  }
  assert.ok(data.productStats.filter((row) => typeof row.max_dd_365d_pct === "number").length > 250);
});
```

### Step 5. `app/lib/metricDefinitions.ts`: the definitions the Screener needs

5a. Directly after WP25's `distinctPrices365d` entry (or after WP28's `premiumToPacks`, or WP31's `lowestListing`, whichever is last in the product-level group), add:

```ts
  // WP33: Screener
  def({ key: "fromHigh52w", label: "From 52-week high", unitLabel: "%", window: "52 weeks", short: `Current Market Price against the 52-week high (held ${TRACKED_HIGH_ROLLING_ROWS} recorded days). Hidden when the price is withheld.`, anchor: "range-52w" }),
```

`TRACKED_HIGH_ROLLING_ROWS` is already in scope: WP25's `range52w` entry uses it (if the file imports it under another name, use that). The 52-week high is WP25's robust high, so a one-day spike never sets it and the value can be slightly above 0 right after a new high; the cell prints "At high" from -0.05% up.

5b. Only if soft check (b) found none of WP28's three keys, add below it (WP28 step 15 text with the `"box-nav"` anchor, because `"msrp"` and `"cost-per-pack"` do not exist without WP28):

```ts
  def({ key: "msrpMultiple", label: "x MSRP", unitLabel: "multiple", window: "latest TCGplayer day", short: "Market Price divided by the US MSRP. Hidden when either is missing or the price is withheld.", anchor: "box-nav" }),
  def({ key: "costPerPack", label: "Cost per pack", unitLabel: "USD per pack", window: "latest TCGplayer day", short: "Market Price divided by the booster packs the product contains. Extras stay in the price.", anchor: "box-nav" }),
  def({ key: "premiumToPacks", label: "Premium to packs", unitLabel: "%", window: "latest TCGplayer day", short: "Market Price against pack value (NAV). Negative means the product costs less than its packs.", anchor: "box-nav" }),
```

5c. Only if soft check (c) found no `maxDrawdown1y`, add (WP31 step 1 text):

```ts
  def({ key: "maxDrawdown1y", label: "Max drawdown (1Y)", unitLabel: "%", window: "365 days to the latest price", short: "Largest fall from a peak to a later low in the recorded prices of the last 365 days.", anchor: "drawdown" }),
```

Every `short` stays at most 120 characters (WP24's test).

### Step 6. `app/components/ui/MetricLabel.tsx`: export the "?" link on its own

The sort button of a table header must contain the label text, and a link cannot sit inside a button. Extract the link WP24 renders into an exported function and use it in `MetricLabel`, so the output of `MetricLabel` is byte-for-byte unchanged:

```tsx
/**
 * The "?" link to a metric's /methodology definition, without the label
 * text. For places where the label sits elsewhere, such as a sort button in
 * a table header (WP33). MetricLabel renders the same link.
 */
export function MetricHelpLink({ metric, className = "" }: { metric: MetricKey; className?: string }) {
  const definition = METRIC_DEFINITIONS[metric];
  return (
    <Link
      href={metricHref(metric)}
      prefetch={false}
      title={definition.short}
      aria-label={`How ${definition.label} is calculated`}
      className={`group inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action ${className}`.trim()}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line text-caption font-semibold normal-case leading-none text-ink-soft group-hover:border-action group-hover:text-action"
      >
        ?
      </span>
    </Link>
  );
}
```

and in `MetricLabel`'s linked branch replace the whole `<Link ...>...</Link>` element with `<MetricHelpLink metric={metric} />`. Copy the class strings from the CURRENT file, not from this snippet, if they differ (WP27 or a later package may have touched them). WP24's `MetricLabel.test.tsx` must pass unchanged, and so must WP24's trust test in `uiConventions.test.ts`, which fails on `outline-none`, `transition-colors` or a raw palette class anywhere in `MetricLabel.tsx` (it is in `TRUST_FILES`). Add one line to `app/components/ui/README.md` under `MetricLabel`: "`MetricHelpLink`: the same "?" link without the label, for a header whose label is inside a sort button (WP33)."

### Step 7. `app/screener/types.ts` (new)

No `"use client"`, no React: the files under `app/screener/` except `page.tsx` are pure modules shared by the server page, the client components, `/methodology` and the tests.

```ts
import type { PulseSignal } from "../lib/marketPulse";

/**
 * One product as the Screener ranks it (WP33). Built on the server by
 * buildScreenerRows (screenerData.ts) and sent to the client as JSON, so
 * every field is a primitive. Metric fields are named by the metric ids of
 * metrics.ts. null always means withheld or unknown, never zero.
 */
export interface ScreenerRow {
  id: number;
  typeLabel: string;
  /** product_types.name ("booster_box"), searched like on /prices. */
  typeName: string;
  setName: string;
  setCode: string | null;
  setId: number | null;
  /** YYYY-MM-DD release date of the set; orders the era and set lists. */
  setRelease: string | null;
  /** Generation name ("Scarlet & Violet"). */
  era: string | null;
  variant: string | null;
  /** TCGplayer day of the newest price. Kept for withheld rows ("Last priced"). */
  priceDay: string | null;
  /** The price passes the 14-day gate (migration 0023). false: every metric below is null. */
  fresh: boolean;
  /** Market Price, USD. */
  price: number | null;
  r7d: number | null;
  r1m: number | null;
  r3m: number | null;
  r1y: number | null;
  signal: PulseSignal | null;
  vol: number | null;
  dd: number | null;
  off: number | null;
  units: number | null;
  vtrend: number | null;
  st: number | null;
  dos: number | null;
  sc30: number | null;
  liq: number | null;
  msrp: number | null;
  /** USD per pack. */
  cpp: number | null;
  prem: number | null;
}

/** "Booster Box · Evolving Skies": the product cell and the phone row title. */
export function screenerProductName(row: Pick<ScreenerRow, "typeLabel" | "setName">): string {
  return `${row.typeLabel} · ${row.setName}`;
}

/** "1 product", "28 products": every count the Screener prints. */
export function productCount(n: number): string {
  return `${n} ${n === 1 ? "product" : "products"}`;
}
```

### Step 8. `app/screener/metrics.ts` (new): the column descriptors

The Screener's version of WP19's descriptor list: one entry per metric, and everything else (sort keys, starting directions, column presets, the CSV columns, the header cells) derives from it. It must not import `urlState.ts` or `filters.ts` (they import it; a cycle would leave constants undefined at load).

```ts
import { METRIC_DEFINITIONS, type MetricKey } from "../lib/metricDefinitions";
import type { SortDirection } from "../lib/sorting";
import type { ChartTimeframe } from "../types/market";
import type { ScreenerRow } from "./types";

export type ScreenerMetricId =
  | "price" | "r7d" | "r1m" | "r3m" | "r1y" | "signal"
  | "vol" | "dd" | "off"
  | "units" | "vtrend" | "st" | "dos" | "sc30" | "liq"
  | "msrp" | "cpp" | "prem";
export type NumericMetricId = Exclude<ScreenerMetricId, "signal">;
export type SortKey = "name" | NumericMetricId;

export type MetricFormat =
  | "money" | "return" | "percent" | "percent0" | "signedPercent"
  | "fromHigh" | "integer" | "days" | "multiple" | "signal";

export interface ScreenerMetric {
  id: ScreenerMetricId;
  /** Definition, label and /methodology anchor (WP24). */
  metric: MetricKey;
  /** Header text; the full label is METRIC_DEFINITIONS[metric].label. */
  short: string;
  format: MetricFormat;
  sortable: boolean;
  /** Direction on first pick: "asc" where a smaller value is the interesting end. */
  defaultDirection: SortDirection;
  widthPx: number;
}

/** Canonical order (appended columns follow it). */
export const SCREENER_METRICS: readonly ScreenerMetric[] = [
  { id: "price", metric: "marketPrice", short: "Price", format: "money", sortable: true, defaultDirection: "desc", widthPx: 120 },
  { id: "r7d", metric: "return7d", short: "7D", format: "return", sortable: true, defaultDirection: "desc", widthPx: 88 },
  { id: "r1m", metric: "return1m", short: "1M", format: "return", sortable: true, defaultDirection: "desc", widthPx: 88 },
  { id: "r3m", metric: "return3m", short: "3M", format: "return", sortable: true, defaultDirection: "desc", widthPx: 88 },
  { id: "r1y", metric: "return1y", short: "1Y", format: "return", sortable: true, defaultDirection: "desc", widthPx: 88 },
  { id: "signal", metric: "marketPulse", short: "Signal", format: "signal", sortable: false, defaultDirection: "desc", widthPx: 128 },
  { id: "vol", metric: "volatilityWeekly52w", short: "Volatility 1Y", format: "percent", sortable: true, defaultDirection: "asc", widthPx: 104 },
  { id: "dd", metric: "maxDrawdown1y", short: "Max DD 1Y", format: "percent", sortable: true, defaultDirection: "asc", widthPx: 104 },
  { id: "off", metric: "fromHigh52w", short: "From 52W high", format: "fromHigh", sortable: true, defaultDirection: "asc", widthPx: 112 },
  { id: "units", metric: "unitsSold30d", short: "Sold 30D", format: "integer", sortable: true, defaultDirection: "desc", widthPx: 96 },
  { id: "vtrend", metric: "volumeTrend", short: "Volume trend", format: "signedPercent", sortable: true, defaultDirection: "desc", widthPx: 104 },
  { id: "st", metric: "sellThrough30d", short: "Sell-through", format: "percent0", sortable: true, defaultDirection: "desc", widthPx: 104 },
  { id: "dos", metric: "daysOfSupply", short: "Days supply", format: "days", sortable: true, defaultDirection: "asc", widthPx: 96 },
  { id: "sc30", metric: "supplyChange30d", short: "Supply 30D", format: "signedPercent", sortable: true, defaultDirection: "asc", widthPx: 104 },
  { id: "liq", metric: "liquidityScore", short: "Liquidity", format: "integer", sortable: true, defaultDirection: "desc", widthPx: 96 },
  { id: "msrp", metric: "msrpMultiple", short: "x MSRP", format: "multiple", sortable: true, defaultDirection: "asc", widthPx: 88 },
  { id: "cpp", metric: "costPerPack", short: "Per pack", format: "money", sortable: true, defaultDirection: "asc", widthPx: 104 },
  { id: "prem", metric: "premiumToPacks", short: "vs packs", format: "signedPercent", sortable: true, defaultDirection: "asc", widthPx: 96 },
];

export const METRIC_BY_ID = Object.fromEntries(SCREENER_METRICS.map((m) => [m.id, m])) as Readonly<
  Record<ScreenerMetricId, ScreenerMetric>
>;

export const SORT_KEYS: readonly SortKey[] = [
  "name",
  ...SCREENER_METRICS.filter((m) => m.sortable).map((m) => m.id as NumericMetricId),
];

const RETURN_IDS: readonly ScreenerMetricId[] = ["r7d", "r1m", "r3m", "r1y"];

export function isReturnMetric(id: SortKey): id is "r7d" | "r1m" | "r3m" | "r1y" {
  return (RETURN_IDS as readonly string[]).includes(id);
}

export function defaultDirectionFor(key: SortKey): SortDirection {
  return key === "name" ? "asc" : METRIC_BY_ID[key].defaultDirection;
}

/** Toolbar text: "1M change", "Days supply", "Price", "Name". */
export function sortShortLabel(key: SortKey): string {
  if (key === "name") return "Name";
  return isReturnMetric(key) ? `${METRIC_BY_ID[key].short} change` : METRIC_BY_ID[key].short;
}

/** Sort sheet and methodology text: the full definition label. */
export function sortFullLabel(key: SortKey): string {
  if (key === "name") return "Name";
  if (isReturnMetric(key)) return `${METRIC_BY_ID[key].short} change`;
  return METRIC_DEFINITIONS[METRIC_BY_ID[key].metric].label;
}

/** "high to low", "low to high", or "A to Z" / "Z to A" for names. */
export function directionPhrase(key: SortKey, direction: SortDirection): string {
  if (key === "name") return direction === "asc" ? "A to Z" : "Z to A";
  return direction === "desc" ? "high to low" : "low to high";
}

export type ColumnPreset = "performance" | "risk" | "liquidity" | "value";
export const COLUMN_PRESET_IDS: readonly ColumnPreset[] = ["performance", "risk", "liquidity", "value"];

export const COLUMN_PRESETS: Readonly<Record<ColumnPreset, { label: string; ids: readonly ScreenerMetricId[] }>> = {
  performance: { label: "Performance", ids: ["r7d", "r1m", "r3m", "r1y", "signal"] },
  risk: { label: "Risk", ids: ["vol", "dd", "off", "r1y"] },
  liquidity: { label: "Liquidity", ids: ["units", "vtrend", "st", "dos", "sc30", "liq"] },
  value: { label: "Value", ids: ["msrp", "cpp", "prem"] },
};

export const VALUE_METRIC_IDS: readonly ScreenerMetricId[] = ["msrp", "cpp", "prem"];

/** Trend column window: WP26's 1Y baked sparkline, embedded in the page. */
export const SCREENER_SPARKLINE_PERIOD: ChartTimeframe = "1Y";

/** Rows rendered before "Show more". Sorting and filtering always use every row. */
export const PAGE_SIZE = 50;

export type Availability = Readonly<Record<ScreenerMetricId, boolean>>;

/** true for each metric that has at least one known value in the catalog. */
export function metricAvailability(rows: readonly ScreenerRow[]): Availability {
  const out = Object.fromEntries(SCREENER_METRICS.map((m) => [m.id, false])) as Record<ScreenerMetricId, boolean>;
  for (const row of rows) {
    for (const m of SCREENER_METRICS) {
      if (!out[m.id] && row[m.id] !== null) out[m.id] = true;
    }
  }
  return out;
}

export function hasValueData(availability: Availability): boolean {
  return VALUE_METRIC_IDS.some((id) => availability[id]);
}

/** The Value preset falls back to Performance when WP28 data is absent. */
export function effectiveColumnPreset(cols: ColumnPreset, availability: Availability): ColumnPreset {
  return cols === "value" && !hasValueData(availability) ? "performance" : cols;
}

const COLUMN_CACHE = new Map<string, readonly ScreenerMetric[]>();

/**
 * The same array instance for the same id list, so memoised rows keep equal
 * props across renders that do not change the columns (a sort, for example).
 */
export function columnsFor(ids: readonly ScreenerMetricId[]): readonly ScreenerMetric[] {
  const key = ids.join(",");
  let columns = COLUMN_CACHE.get(key);
  if (!columns) {
    columns = ids.map((id) => METRIC_BY_ID[id]);
    COLUMN_CACHE.set(key, columns);
  }
  return columns;
}
```

`row[m.id]` type-checks because every `ScreenerMetricId` is a field of `ScreenerRow`; if `tsc` says otherwise, a field name in `types.ts` does not match an id here: fix the name, do not cast.

### Step 9. `app/screener/urlState.ts` (new)

```ts
import type { PulseSignal } from "../lib/marketPulse";
import type { SortDirection } from "../lib/sorting";
import { COLUMN_PRESET_IDS, SORT_KEYS, defaultDirectionFor, type ColumnPreset, type SortKey } from "./metrics";

/**
 * The Screener's view as URL state (WP33). The URL is the saved view and the
 * share mechanism: parse and serialize are exact inverses on canonical
 * states, defaults are omitted, and keys are written in SCREENER_URL_KEYS
 * order, so two equal views have equal URLs.
 */

export const RANGE_FILTERS = ["ret", "off", "vol", "dd", "st", "dos", "sc30", "liq", "msrp", "prem"] as const;
export type RangeFilterKey = (typeof RANGE_FILTERS)[number];

/** URL prefix: `${prefix}min` and `${prefix}max`. */
const RANGE_PREFIX: Readonly<Record<RangeFilterKey, string>> = {
  ret: "r",
  off: "off",
  vol: "vol",
  dd: "dd",
  st: "st",
  dos: "dos",
  sc30: "sc30",
  liq: "liq",
  msrp: "msrp",
  prem: "prem",
};

export const RETURN_WINDOWS = ["7d", "1m", "3m", "1y"] as const;
export type ReturnWindow = (typeof RETURN_WINDOWS)[number];
export const RETURN_WINDOW_LABELS: Readonly<Record<ReturnWindow, string>> = { "7d": "7D", "1m": "1M", "3m": "3M", "1y": "1Y" };

export const PULSE_SIGNALS: readonly PulseSignal[] = ["demand_surge", "thin_supply", "distribution", "cooling"];

export interface Range {
  min: number | null;
  max: number | null;
}

export interface ScreenerState {
  q: string;
  /** Product type label, as on /prices. "" = all. */
  type: string;
  /** Era (generation name), as on /prices. "" = all. */
  gen: string;
  set: number | null;
  /** USD, pmin <= price < pmax. */
  pmin: number | null;
  pmax: number | null;
  rw: ReturnWindow;
  ranges: Readonly<Record<RangeFilterKey, Range>>;
  sig: PulseSignal | null;
  priced: boolean;
  sort: SortKey;
  dir: SortDirection;
  cols: ColumnPreset;
}

export const EMPTY_RANGE: Range = { min: null, max: null };
export const EMPTY_RANGES = Object.fromEntries(RANGE_FILTERS.map((k) => [k, EMPTY_RANGE])) as Readonly<
  Record<RangeFilterKey, Range>
>;

export const DEFAULT_SORT: SortKey = "r1m";

export const SCREENER_DEFAULTS: ScreenerState = {
  q: "",
  type: "",
  gen: "",
  set: null,
  pmin: null,
  pmax: null,
  rw: "1y",
  ranges: EMPTY_RANGES,
  sig: null,
  priced: false,
  sort: DEFAULT_SORT,
  dir: defaultDirectionFor(DEFAULT_SORT),
  cols: "performance",
};

export const SCREENER_URL_KEYS: readonly string[] = [
  "q", "type", "gen", "set", "pmin", "pmax", "rw",
  ...RANGE_FILTERS.flatMap((k) => [`${RANGE_PREFIX[k]}min`, `${RANGE_PREFIX[k]}max`]),
  "sig", "priced", "sort", "dir", "cols",
];

const MAX_QUERY_LENGTH = 100;

/** A finite number, or null for empty or unparseable text. Also used by the range inputs. */
export function parseNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function parseId(value: string | null): number | null {
  const n = parseNumber(value);
  return n !== null && Number.isSafeInteger(n) && n > 0 ? n : null;
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function isRangeActive(range: Range): boolean {
  return range.min !== null || range.max !== null;
}

/** Canonical form: the return window only matters with a return range. */
export function normalizeScreenerState(state: ScreenerState): ScreenerState {
  if (!isRangeActive(state.ranges.ret) && state.rw !== SCREENER_DEFAULTS.rw) {
    return { ...state, rw: SCREENER_DEFAULTS.rw };
  }
  return state;
}

export function parseScreenerQuery(search: string): ScreenerState {
  const params = new URLSearchParams(search);
  const d = SCREENER_DEFAULTS;
  const ranges = {} as Record<RangeFilterKey, Range>;
  for (const key of RANGE_FILTERS) {
    const prefix = RANGE_PREFIX[key];
    ranges[key] = {
      min: parseNumber(params.get(`${prefix}min`)),
      max: parseNumber(params.get(`${prefix}max`)),
    };
  }
  const sort = pick(params.get("sort"), SORT_KEYS, d.sort);
  const sig = params.get("sig");
  return normalizeScreenerState({
    q: (params.get("q") ?? "").slice(0, MAX_QUERY_LENGTH),
    type: params.get("type") ?? "",
    gen: params.get("gen") ?? "",
    set: parseId(params.get("set")),
    pmin: parseNumber(params.get("pmin")),
    pmax: parseNumber(params.get("pmax")),
    rw: pick(params.get("rw"), RETURN_WINDOWS, d.rw),
    ranges,
    sig: sig !== null && (PULSE_SIGNALS as readonly string[]).includes(sig) ? (sig as PulseSignal) : null,
    priced: params.get("priced") === "1",
    sort,
    dir: pick(params.get("dir"), ["asc", "desc"] as const, defaultDirectionFor(sort)),
    cols: pick(params.get("cols"), COLUMN_PRESET_IDS, d.cols),
  });
}

/** Owned-key query string (no leading "?"), canonical. */
export function serializeScreenerState(input: ScreenerState): string {
  const state = normalizeScreenerState(input);
  const params = new URLSearchParams();
  const setNumber = (key: string, value: number | null) => {
    if (value !== null) params.set(key, String(value));
  };
  if (state.q) params.set("q", state.q);
  if (state.type) params.set("type", state.type);
  if (state.gen) params.set("gen", state.gen);
  setNumber("set", state.set);
  setNumber("pmin", state.pmin);
  setNumber("pmax", state.pmax);
  if (state.rw !== SCREENER_DEFAULTS.rw) params.set("rw", state.rw);
  for (const key of RANGE_FILTERS) {
    setNumber(`${RANGE_PREFIX[key]}min`, state.ranges[key].min);
    setNumber(`${RANGE_PREFIX[key]}max`, state.ranges[key].max);
  }
  if (state.sig) params.set("sig", state.sig);
  if (state.priced) params.set("priced", "1");
  if (state.sort !== SCREENER_DEFAULTS.sort) params.set("sort", state.sort);
  if (state.dir !== defaultDirectionFor(state.sort)) params.set("dir", state.dir);
  if (state.cols !== SCREENER_DEFAULTS.cols) params.set("cols", state.cols);
  return params.toString();
}

/** The filters only (sort, direction and columns at their defaults). Equal filters, equal strings. */
export function filterQuery(state: ScreenerState): string {
  return serializeScreenerState({
    ...state,
    sort: SCREENER_DEFAULTS.sort,
    dir: SCREENER_DEFAULTS.dir,
    cols: SCREENER_DEFAULTS.cols,
  });
}

export function withRange(state: ScreenerState, key: RangeFilterKey, range: Range): ScreenerState {
  return normalizeScreenerState({ ...state, ranges: { ...state.ranges, [key]: range } });
}

/** Every filter back to its default; sort, direction and columns kept. */
export function resetFilters(state: ScreenerState): ScreenerState {
  return { ...SCREENER_DEFAULTS, sort: state.sort, dir: state.dir, cols: state.cols };
}
```

### Step 10. `app/screener/filters.ts` (new)

```ts
import { METRIC_DEFINITIONS } from "../lib/metricDefinitions";
import { PULSE_SIGNAL_META } from "../lib/marketPulse";
import { compareSortValues, type SortDirection, type SortValue } from "../lib/sorting";
import {
  COLUMN_PRESETS,
  METRIC_BY_ID,
  SCREENER_METRICS,
  effectiveColumnPreset,
  type Availability,
  type NumericMetricId,
  type ScreenerMetricId,
  type SortKey,
} from "./metrics";
import {
  RANGE_FILTERS,
  RETURN_WINDOW_LABELS,
  isRangeActive,
  type Range,
  type RangeFilterKey,
  type ReturnWindow,
  type ScreenerState,
} from "./urlState";
import type { ScreenerRow } from "./types";

const RETURN_WINDOW_METRIC: Readonly<Record<ReturnWindow, NumericMetricId>> = {
  "7d": "r7d",
  "1m": "r1m",
  "3m": "r3m",
  "1y": "r1y",
};

const RANGE_METRIC: Readonly<Record<Exclude<RangeFilterKey, "ret">, NumericMetricId>> = {
  off: "off",
  vol: "vol",
  dd: "dd",
  st: "st",
  dos: "dos",
  sc30: "sc30",
  liq: "liq",
  msrp: "msrp",
  prem: "prem",
};

/** Units the range inputs, chips and methodology print. */
export const RANGE_UNITS: Readonly<Record<RangeFilterKey, "%" | "x" | "days" | "">> = {
  ret: "%",
  off: "%",
  vol: "%",
  dd: "%",
  st: "%",
  dos: "days",
  sc30: "%",
  liq: "",
  msrp: "x",
  prem: "%",
};

/** The column a range filters; the return range follows the return window. */
export function rangeMetricId(key: RangeFilterKey, rw: ReturnWindow): NumericMetricId {
  return key === "ret" ? RETURN_WINDOW_METRIC[rw] : RANGE_METRIC[key];
}

function inRange(value: number | null, range: Range): boolean {
  if (!isRangeActive(range)) return true;
  if (value === null) return false;
  if (range.min !== null && value < range.min) return false;
  if (range.max !== null && value > range.max) return false;
  return true;
}

function matchesSearch(row: ScreenerRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.setName, row.setCode, row.typeLabel, row.typeName, row.variant].some(
    (text) => typeof text === "string" && text.toLowerCase().includes(q)
  );
}

export function matchesScreen(row: ScreenerRow, state: ScreenerState): boolean {
  if (state.priced && !row.fresh) return false;
  if (state.type && row.typeLabel !== state.type) return false;
  if (state.gen && row.era !== state.gen) return false;
  if (state.set !== null && row.setId !== state.set) return false;
  if (state.pmin !== null || state.pmax !== null) {
    if (row.price === null) return false;
    if (state.pmin !== null && row.price < state.pmin) return false;
    if (state.pmax !== null && row.price >= state.pmax) return false;
  }
  for (const key of RANGE_FILTERS) {
    if (!inRange(row[rangeMetricId(key, state.rw)], state.ranges[key])) return false;
  }
  if (state.sig !== null && row.signal !== state.sig) return false;
  return matchesSearch(row, state.q);
}

export function sortValueOf(row: ScreenerRow, key: SortKey): SortValue {
  if (key === "name") return `${row.typeLabel} ${row.setName} ${row.variant ?? ""}`.trim().toLowerCase();
  return row[key];
}

/**
 * Sorted copy. Each value is read once; unknown values sink to the bottom in
 * both directions (compareSortValues, WP18); ties keep the input order, which
 * is the server's base order, so the result is deterministic.
 */
export function sortRows(rows: readonly ScreenerRow[], key: SortKey, direction: SortDirection): ScreenerRow[] {
  return rows
    .map((row) => ({ row, value: sortValueOf(row, key) }))
    .sort((a, b) => compareSortValues(a.value, b.value, direction))
    .map((entry) => entry.row);
}

/** Filter, then sort. The whole catalog, every time: rendering is paged, ranking is not. */
export function applyScreen(rows: readonly ScreenerRow[], state: ScreenerState): ScreenerRow[] {
  return sortRows(
    rows.filter((row) => matchesScreen(row, state)),
    state.sort,
    state.dir
  );
}

/**
 * The preset's columns, then (in canonical order) every column a filter or
 * the sort uses, so the value a view depends on is always on screen.
 */
export function visibleColumnIds(state: ScreenerState, availability: Availability): ScreenerMetricId[] {
  const ids: ScreenerMetricId[] = [...COLUMN_PRESETS[effectiveColumnPreset(state.cols, availability)].ids];
  const extra = new Set<ScreenerMetricId>();
  for (const key of RANGE_FILTERS) {
    if (isRangeActive(state.ranges[key])) extra.add(rangeMetricId(key, state.rw));
  }
  if (state.sig !== null) extra.add("signal");
  if (state.sort !== "name" && state.sort !== "price") extra.add(state.sort);
  for (const metric of SCREENER_METRICS) {
    if (metric.id !== "price" && extra.has(metric.id) && !ids.includes(metric.id)) ids.push(metric.id);
  }
  return ids;
}

export interface Option {
  value: string;
  label: string;
}

export interface FilterOptions {
  types: Option[];
  eras: Option[];
  sets: Option[];
  setNames: ReadonlyMap<number, string>;
}

/** Select options from the rows: types A to Z, eras and sets newest release first. */
export function filterOptions(rows: readonly ScreenerRow[]): FilterOptions {
  const types = new Set<string>();
  const eraRelease = new Map<string, string>();
  const sets = new Map<number, { label: string; release: string }>();
  for (const row of rows) {
    types.add(row.typeLabel);
    const release = row.setRelease ?? "";
    if (row.era && (eraRelease.get(row.era) ?? "") <= release) eraRelease.set(row.era, release);
    if (row.setId !== null && !sets.has(row.setId)) {
      sets.set(row.setId, { label: row.setCode ? `${row.setName} (${row.setCode})` : row.setName, release });
    }
  }
  const byReleaseDesc = <T extends { release: string; label: string }>(a: T, b: T) =>
    a.release === b.release ? a.label.localeCompare(b.label) : a.release < b.release ? 1 : -1;
  return {
    types: [...types].sort((a, b) => a.localeCompare(b)).map((t) => ({ value: t, label: t })),
    eras: [...eraRelease.entries()]
      .map(([era, release]) => ({ release, label: era }))
      .sort(byReleaseDesc)
      .map((e) => ({ value: e.label, label: e.label })),
    sets: [...sets.entries()]
      .map(([id, s]) => ({ id, ...s }))
      .sort(byReleaseDesc)
      .map((s) => ({ value: String(s.id), label: s.label })),
    setNames: new Map([...sets.entries()].map(([id, s]) => [id, s.label])),
  };
}

export const PRICE_BANDS: ReadonlyArray<{ value: string; label: string; pmin: number | null; pmax: number | null }> = [
  { value: "under-50", label: "Under US$50", pmin: null, pmax: 50 },
  { value: "50-150", label: "US$50 to US$150", pmin: 50, pmax: 150 },
  { value: "150-500", label: "US$150 to US$500", pmin: 150, pmax: 500 },
  { value: "500-up", label: "US$500 and up", pmin: 500, pmax: null },
];

/** "" for no band, a PRICE_BANDS value, or "custom" for any other pair. */
export function priceBandValue(pmin: number | null, pmax: number | null): string {
  if (pmin === null && pmax === null) return "";
  return PRICE_BANDS.find((b) => b.pmin === pmin && b.pmax === pmax)?.value ?? "custom";
}

function priceText(pmin: number | null, pmax: number | null): string {
  const band = PRICE_BANDS.find((b) => b.pmin === pmin && b.pmax === pmax);
  if (band) return band.label;
  if (pmin !== null && pmax !== null) return `US$${pmin} to US$${pmax}`;
  return pmin !== null ? `US$${pmin} and up` : `Under US$${pmax}`;
}

function threshold(value: number, unit: string): string {
  if (unit === "%") return `${value}%`;
  if (unit === "x") return `${value}x`;
  if (unit === "days") return `${value} days`;
  return String(value);
}

/** "1Y return", "Days of supply", "From 52-week high". */
export function rangeLabel(key: RangeFilterKey, rw: ReturnWindow): string {
  if (key === "ret") return `${RETURN_WINDOW_LABELS[rw]} return`;
  return METRIC_DEFINITIONS[METRIC_BY_ID[rangeMetricId(key, rw)].metric].label;
}

function rangeText(range: Range, unit: string): string {
  if (range.min !== null && range.max !== null) return `between ${threshold(range.min, "")} and ${threshold(range.max, unit)}`;
  if (range.min !== null) return `at least ${threshold(range.min, unit)}`;
  return `at most ${threshold(range.max as number, unit)}`;
}

export interface FilterChip {
  key: string;
  text: string;
  clear: (state: ScreenerState) => ScreenerState;
}

/** One chip per active filter: "Current price only" first, then URL key order. Also the rule list on /methodology#screens. */
export function describeFilters(state: ScreenerState, setNames: ReadonlyMap<number, string>): FilterChip[] {
  const chips: FilterChip[] = [];
  if (state.priced) chips.push({ key: "priced", text: "Current price only", clear: (s) => ({ ...s, priced: false }) });
  if (state.q) chips.push({ key: "q", text: `Search "${state.q}"`, clear: (s) => ({ ...s, q: "" }) });
  if (state.type) chips.push({ key: "type", text: `Type: ${state.type}`, clear: (s) => ({ ...s, type: "" }) });
  if (state.gen) chips.push({ key: "gen", text: `Era: ${state.gen}`, clear: (s) => ({ ...s, gen: "" }) });
  if (state.set !== null) {
    chips.push({ key: "set", text: `Set: ${setNames.get(state.set) ?? `#${state.set}`}`, clear: (s) => ({ ...s, set: null }) });
  }
  if (state.pmin !== null || state.pmax !== null) {
    chips.push({ key: "price", text: `Price: ${priceText(state.pmin, state.pmax)}`, clear: (s) => ({ ...s, pmin: null, pmax: null }) });
  }
  for (const key of RANGE_FILTERS) {
    const range = state.ranges[key];
    if (!isRangeActive(range)) continue;
    chips.push({
      key,
      text: `${rangeLabel(key, state.rw)} ${rangeText(range, RANGE_UNITS[key])}`,
      clear: (s) => ({ ...s, ranges: { ...s.ranges, [key]: { min: null, max: null } } }),
    });
  }
  if (state.sig !== null) {
    chips.push({ key: "sig", text: `Market Pulse: ${PULSE_SIGNAL_META[state.sig].label}`, clear: (s) => ({ ...s, sig: null }) });
  }
  return chips;
}

/** Newest TCGplayer day among rows with a current price, or null. */
export function newestFreshPriceDay(rows: readonly ScreenerRow[]): string | null {
  let newest: string | null = null;
  for (const row of rows) {
    if (row.fresh && row.priceDay !== null && (newest === null || row.priceDay > newest)) newest = row.priceDay;
  }
  return newest;
}
```

### Step 11. `app/screener/presets.ts` (new)

```ts
import type { MethodologySubAnchor } from "../content/methodology";
import { PRICE_THRESHOLD_PCT, VOLUME_THRESHOLD_PCT, type PulseSignal } from "../lib/marketPulse";
import type { SortDirection } from "../lib/sorting";
import type { Availability, ColumnPreset, ScreenerMetricId, SortKey } from "./metrics";
import {
  EMPTY_RANGES,
  SCREENER_DEFAULTS,
  filterQuery,
  serializeScreenerState,
  type Range,
  type RangeFilterKey,
  type ReturnWindow,
  type ScreenerState,
} from "./urlState";

/**
 * The built-in screens (WP33). Printed on /methodology#screens from these
 * constants; a change to any threshold is a methodology change (bump
 * METHODOLOGY_VERSION and add a METHODOLOGY_CHANGES row). The unit test per
 * preset re-states these numbers independently, so it fails on a silent change.
 */
export const PRESET_RULES = {
  offHighsFromHighMax: -20,
  offHighsDaysOfSupplyMax: 30,
  nearMsrpMultipleMax: 1.25,
  drainingSupplyChange30dMax: -15,
  drainingSellThroughMin: 20,
  compounderReturn1yMin: 10,
  compounderVolatilityMax: 15,
  compounderDrawdownMax: 15,
  belowPacksPremiumMax: -1,
} as const;

export type PresetId =
  | "off-highs-thin-supply"
  | "near-msrp"
  | "supply-draining"
  | "low-vol-compounders"
  | "distribution-warning"
  | "below-pack-value";

export interface ScreenerPreset {
  id: PresetId;
  name: string;
  summary: string;
  /** h3 on /methodology#screens (content/methodology.ts METHODOLOGY_SUBSECTIONS). */
  anchor: MethodologySubAnchor;
  /** The full view: filters (with priced on), sort, direction and columns. */
  state: ScreenerState;
  /** Offered only when each of these metrics has data somewhere in the catalog. */
  requires: readonly ScreenerMetricId[];
}

interface PresetView {
  ranges?: Partial<Record<RangeFilterKey, Range>>;
  rw?: ReturnWindow;
  sig?: PulseSignal;
  sort: SortKey;
  dir: SortDirection;
  cols: ColumnPreset;
}

function preset(
  id: PresetId,
  name: string,
  summary: string,
  anchor: MethodologySubAnchor,
  view: PresetView,
  requires: readonly ScreenerMetricId[]
): ScreenerPreset {
  return {
    id,
    name,
    summary,
    anchor,
    requires,
    state: {
      ...SCREENER_DEFAULTS,
      priced: true,
      rw: view.rw ?? SCREENER_DEFAULTS.rw,
      ranges: { ...EMPTY_RANGES, ...view.ranges },
      sig: view.sig ?? null,
      sort: view.sort,
      dir: view.dir,
      cols: view.cols,
    },
  };
}

const R = PRESET_RULES;

export const SCREENER_PRESETS: readonly ScreenerPreset[] = [
  preset(
    "off-highs-thin-supply",
    "Off highs with thin supply",
    `At least ${-R.offHighsFromHighMax}% below the 52-week high, with ${R.offHighsDaysOfSupplyMax} days of supply or less at the 30-day sales rate.`,
    "screen-off-highs-thin-supply",
    {
      ranges: { off: { min: null, max: R.offHighsFromHighMax }, dos: { min: null, max: R.offHighsDaysOfSupplyMax } },
      sort: "off",
      dir: "asc",
      cols: "risk",
    },
    ["off", "dos"]
  ),
  preset(
    "near-msrp",
    "Near MSRP",
    `At or below ${R.nearMsrpMultipleMax}x the US MSRP.`,
    "screen-near-msrp",
    { ranges: { msrp: { min: null, max: R.nearMsrpMultipleMax } }, sort: "msrp", dir: "asc", cols: "value" },
    ["msrp"]
  ),
  preset(
    "supply-draining",
    "Supply draining",
    `Units on the market down at least ${-R.drainingSupplyChange30dMax}% over 30 days, with a 30-day sell-through of ${R.drainingSellThroughMin}% or more.`,
    "screen-supply-draining",
    {
      ranges: { sc30: { min: null, max: R.drainingSupplyChange30dMax }, st: { min: R.drainingSellThroughMin, max: null } },
      sort: "sc30",
      dir: "asc",
      cols: "liquidity",
    },
    ["sc30", "st"]
  ),
  preset(
    "low-vol-compounders",
    "Low-volatility compounders",
    `Up at least ${R.compounderReturn1yMin}% over 1 year, with 1-year weekly volatility and maximum drawdown of ${R.compounderVolatilityMax}% or less.`,
    "screen-low-vol-compounders",
    {
      rw: "1y",
      ranges: {
        ret: { min: R.compounderReturn1yMin, max: null },
        vol: { min: null, max: R.compounderVolatilityMax },
        dd: { min: null, max: R.compounderDrawdownMax },
      },
      sort: "r1y",
      dir: "desc",
      cols: "risk",
    },
    ["r1y", "vol", "dd"]
  ),
  preset(
    "distribution-warning",
    "Distribution warning",
    `Market Pulse reads Distribution: the 1-month change is down ${PRICE_THRESHOLD_PCT}% or more while units sold in the last 30 days are up ${VOLUME_THRESHOLD_PCT}% or more on the 30 days before.`,
    "screen-distribution-warning",
    { sig: "distribution", sort: "r1m", dir: "asc", cols: "performance" },
    ["signal"]
  ),
  preset(
    "below-pack-value",
    "Below pack value",
    `Market Price at least ${-R.belowPacksPremiumMax}% below the value of the standard packs inside.`,
    "screen-below-pack-value",
    { ranges: { prem: { min: null, max: R.belowPacksPremiumMax } }, sort: "prem", dir: "asc", cols: "value" },
    ["prem"]
  ),
];

export function presetHref(preset: ScreenerPreset): string {
  return `/screener?${serializeScreenerState(preset.state)}`;
}

/** The preset whose filters equal the view's (sort and columns may differ). */
export function matchingPreset(state: ScreenerState): ScreenerPreset | null {
  const query = filterQuery(state);
  return SCREENER_PRESETS.find((p) => filterQuery(p.state) === query) ?? null;
}

export function availablePresets(availability: Availability): ScreenerPreset[] {
  return SCREENER_PRESETS.filter((p) => p.requires.every((id) => availability[id]));
}
```

`MethodologySubAnchor` only accepts these six anchors after step 24a adds them; until then `tsc` reports them, which is expected mid-step.

### Step 12. `app/screener/screenerData.ts` (new): the server-side row builder

```ts
import { getPulseSignal, getVolumeTrendPercent } from "../lib/marketPulse";
import { statsFor, type ProductStatsSnapshot } from "../lib/marketStats";
import { hasCurrentPrice } from "../lib/priceGuard";
import type { Product, ProductDailyStats, VolumeMetricsSummary } from "../types/market";
import type { ScreenerRow } from "./types";

/**
 * WP28 columns, read softly: undefined before WP28 lands, then number | null.
 * The intersection is harmless once ProductDailyStats declares them.
 */
type StructureFields = {
  msrp_multiple?: number | null;
  cost_per_pack_usd?: number | null;
  premium_to_packs_pct?: number | null;
};

/** 2 decimals, the precision sent to the client; null for anything not finite. */
export function round2(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function dayKey(value: string | null | undefined): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value ?? "");
  return match ? match[1] : null;
}

/** Set release newest first, then type label, then id: the tie order of every sort. */
function baseOrder(a: ScreenerRow, b: ScreenerRow): number {
  if (a.setRelease !== b.setRelease) {
    if (a.setRelease === null) return 1;
    if (b.setRelease === null) return -1;
    return a.setRelease < b.setRelease ? 1 : -1;
  }
  const byType = a.typeLabel.localeCompare(b.typeLabel);
  return byType !== 0 ? byType : a.id - b.id;
}

/**
 * One row per catalog product, from the catalog summaries (identity, price
 * gate), the latest daily statistics (every metric, WP25, WP28, 0042) and
 * the volume metrics (prior 30 days for the volume trend). A product whose
 * price is withheld in either source gets null in every metric (D1 item 6).
 */
export function buildScreenerRows(
  products: readonly Product[],
  stats: ProductStatsSnapshot,
  volume: Readonly<Record<number, VolumeMetricsSummary>>
): ScreenerRow[] {
  const rows = products.map((product): ScreenerRow => {
    const s = statsFor(stats, product.id) as (ProductDailyStats & StructureFields) | null;
    const v = volume[product.id];
    const fresh = hasCurrentPrice(product) && (s === null || (s.is_price_fresh && s.usd_price !== null));
    const gated = (value: number | null | undefined) => (fresh ? round2(value) : null);
    const r1m = gated(s ? s.ret_30d : product.returns?.["1M"]);
    const vtrend = fresh
      ? round2(getVolumeTrendPercent(v?.units_sold_30d ?? null, v?.units_sold_prior_30d ?? null))
      : null;
    const high = s?.high_52w ?? null;
    return {
      id: product.id,
      typeLabel: product.product_types?.label || product.product_types?.name || "Unknown Type",
      typeName: product.product_types?.name ?? "",
      setName: product.sets?.name || "Unknown Set",
      setCode: product.sets?.code && product.sets.code !== "N/A" ? product.sets.code : null,
      setId: product.sets?.id ?? null,
      setRelease: dayKey(product.sets?.release_date),
      era: product.sets?.generations?.name ?? null,
      variant: product.variant?.trim() ? product.variant.trim() : null,
      priceDay: s?.price_day ?? dayKey(product.price_recorded_at),
      fresh,
      price: gated(s ? s.usd_price : product.usd_price),
      r7d: gated(s ? s.ret_7d : product.returns?.["7D"]),
      r1m,
      r3m: gated(s ? s.ret_90d : product.returns?.["3M"]),
      r1y: gated(s ? s.ret_365d : product.returns?.["1Y"]),
      signal: fresh ? getPulseSignal(r1m, vtrend) : null,
      vol: gated(s?.vol_weekly_52w),
      dd: gated(s?.max_dd_365d_pct),
      off: fresh && s && s.usd_price !== null && high !== null && high > 0 ? round2((s.usd_price / high - 1) * 100) : null,
      units: fresh ? (s ? s.units_sold_30d : v?.units_sold_30d ?? null) : null,
      vtrend,
      st: gated(s?.sell_through_30d),
      dos: gated(s?.days_of_supply),
      sc30: gated(s?.qty_change_30d_pct),
      liq: gated(s?.liquidity_score),
      msrp: gated(s?.msrp_multiple),
      cpp: gated(s?.cost_per_pack_usd),
      prem: gated(s?.premium_to_packs_pct),
    };
  });
  return rows.sort(baseOrder);
}
```

Notes:
- `product.returns` keys: if `tsc` rejects `"1M"`, use the keys `ProductPrices/utils/catalogValues.ts` `periodChange` uses; they are the same `ChartTimeframe` labels.
- `units` from `S` when a stats row exists (the same 0018 to 0021 gates, the same day as every other metric), else from the volume RPC.
- `VolumeMetricsSummary` (WP11/WP30) has `units_sold_30d` and `units_sold_prior_30d`; full `ProductVolumeMetrics` rows satisfy it.
- `getPulseSignal` takes the rounded values, the same ones the table prints, so a displayed "-2.0%" and the signal agree.

### Step 13. `app/screener/exportCsv.ts` (new)

Loaded with a dynamic `import()` on click, so it is not in the initial bundle.

```ts
import { DECISION_NOTE } from "../content/disclosures";
import { METRIC_DEFINITIONS } from "../lib/metricDefinitions";
import { PULSE_SIGNAL_META } from "../lib/marketPulse";
import type { Currency } from "../types/market";
import { METRIC_BY_ID, type NumericMetricId, type ScreenerMetric, type ScreenerMetricId } from "./metrics";
import type { ScreenerRow } from "./types";

export interface CsvOptions {
  currency: Currency;
  /** useCurrency().convertPrice: USD to the selected currency at the latest rate. */
  convertPrice: (usd: number | null | undefined) => number | null;
  exchangeRate: number;
  exchangeRateDate: string | null;
  /** product_daily_stats day the values describe. */
  statsDay: string | null;
  /** window.location.href: the view, shareable. */
  pageUrl: string;
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** One RFC 4180 cell. Text that a spreadsheet would run as a formula gets a leading quote. */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function fixed(value: number | null | undefined, decimals: number): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;
}

function header(metric: ScreenerMetric, currency: Currency): string {
  const definition = METRIC_DEFINITIONS[metric.metric];
  switch (metric.format) {
    case "money":
      return `${definition.label} (${currency})`;
    case "multiple":
      return `${definition.label} (x)`;
    case "days":
      return `${definition.label} (days)`;
    case "integer":
      return `${definition.label} (${definition.unitLabel})`;
    case "signal":
      return definition.label;
    default:
      return `${definition.label} (%)`;
  }
}

function value(metric: ScreenerMetric, row: ScreenerRow, options: CsvOptions): string | number | null {
  if (metric.id === "signal") return row.signal ? PULSE_SIGNAL_META[row.signal].label : null;
  const raw = row[metric.id as NumericMetricId];
  switch (metric.format) {
    case "money":
      return fixed(options.convertPrice(raw), 2);
    case "percent0":
      return fixed(raw, 0);
    case "integer":
      return fixed(raw, 0);
    case "multiple":
      return fixed(raw, 2);
    default:
      return fixed(raw, 1);
  }
}

/**
 * The view as CSV (D8): every matching row in the current order, the visible
 * columns, fresh values only (withheld rows are already null), and one
 * attribution line. No history, no raw listings.
 */
export function buildScreenerCsv(
  rows: readonly ScreenerRow[],
  columnIds: readonly ScreenerMetricId[],
  options: CsvOptions
): string {
  const metrics = columnIds.filter((id) => id !== "price").map((id) => METRIC_BY_ID[id]);
  const lines: string[] = [];
  lines.push(
    [
      "Product ID",
      "Product type",
      "Set",
      "Set code",
      "Era",
      "Variant",
      `Market Price (${options.currency})`,
      "Price day",
      "Price status",
      ...metrics.map((m) => header(m, options.currency)),
    ]
      .map(csvCell)
      .join(",")
  );
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.typeLabel,
        row.setName,
        row.setCode,
        row.era,
        row.variant,
        fixed(options.convertPrice(row.price), 2),
        row.priceDay,
        row.fresh ? "current" : "withheld",
        ...metrics.map((m) => value(m, row, options)),
      ]
        .map(csvCell)
        .join(",")
    );
  }
  const fx =
    options.currency === "CAD"
      ? `USD converted to CAD at ${options.exchangeRate.toFixed(4)} (Bank of Canada${options.exchangeRateDate ? `, ${options.exchangeRateDate}` : ""}). `
      : "";
  lines.push("");
  lines.push(
    csvCell(
      `Source: Pokéfin (${options.pageUrl}). TCGplayer Market Price data, daily statistics for ${options.statsDay ?? "the latest day"}. ${fx}${DECISION_NOTE}`
    )
  );
  return lines.join("\r\n") + "\r\n";
}

export function csvFilename(day: string): string {
  return `pokefin-screener-${day}.csv`;
}

/** Browser download. The BOM makes spreadsheet apps read UTF-8 ("Pokéfin"). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }); // write the escape, not a pasted BOM character
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari can cancel a download whose object URL is revoked in the same tick.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

`convertPrice` must return `null` for `null` input (WP20's `convertUsd` does). If WP20 named it differently, pass the context's USD-to-selected-currency function.

### Step 14. `app/globals.css`: the rank counter

Append at the end of the file (no colour values, so WP23's hex ratchet is untouched):

```css
/*
 * WP33: Screener rank column. A CSS counter instead of a rank prop, so a
 * re-sort moves memoised rows without re-rendering any of them.
 */
.pf-screener-body {
  counter-reset: pf-rank;
}
.pf-screener-body > tr {
  counter-increment: pf-rank;
}
.pf-screener-rank::before {
  content: counter(pf-rank);
}
```

### Step 15. `app/components/Screener/useMinWidthMd.ts` and `columns.tsx` (new)

15a. `useMinWidthMd.ts`:

```ts
"use client";

import { useSyncExternalStore } from "react";

/** Tailwind's md breakpoint (768 px). */
const QUERY = "(min-width: 48rem)";

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * true from 768 px, false below, null on the server and during hydration.
 * While null the Screener renders both layouts (CSS shows one, so nothing
 * shifts); afterwards only the one for the current width stays mounted, so a
 * sort re-renders one list, not two.
 */
export function useMinWidthMd(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => null
  );
}
```

15b. `columns.tsx` (cell rendering shared by the table and the phone list; no `"use client"`, it is imported only by client components):

```tsx
import type { ReactNode } from "react";
import Badge from "../ui/Badge";
import Delta from "../ui/Delta";
import { formatInteger, formatPercent, formatSignedPercent } from "../../lib/format";
import { PULSE_SIGNAL_META } from "../../lib/marketPulse";
import { formatMsrpMultiple } from "../ProductPrices/shared/msrp";
import { formatDaysOfSupply } from "../ProductPrices/utils/catalogValues";
import {
  METRIC_BY_ID,
  isReturnMetric,
  type NumericMetricId,
  type ScreenerMetric,
  type SortKey,
} from "../../screener/metrics";
import type { ScreenerRow } from "../../screener/types";

export interface CellContext {
  /** useCurrency().formatPrice: USD in, the selected currency out, "--" for null. */
  formatPrice: (usd: number | null | undefined) => string;
}

/** "--" with a reason for screen readers. */
export function Missing({ reason }: { reason: string }) {
  return (
    <span className="text-ink-soft">
      <span aria-hidden="true">--</span>
      <span className="sr-only">{reason}</span>
    </span>
  );
}

export function missingReason(row: ScreenerRow): string {
  return row.fresh ? "Not available" : "Price withheld";
}

/** The printed value of a metric, or null when it is unknown. */
export function formatMetricValue(metric: ScreenerMetric, value: number | null, ctx: CellContext): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  switch (metric.format) {
    case "money":
      return ctx.formatPrice(value);
    case "return":
    case "signedPercent":
      return formatSignedPercent(value);
    case "percent":
      return formatPercent(value);
    case "percent0":
      return formatPercent(value, { decimals: 0 });
    case "fromHigh":
      return value >= -0.05 ? "At high" : formatPercent(value);
    case "integer":
      return formatInteger(Math.round(value));
    case "days":
      return formatDaysOfSupply(value);
    case "multiple":
      return formatMsrpMultiple(value);
    default:
      return null;
  }
}

/** One table cell's content. Returns use Delta (glyph, gain/loss colour); every other metric is neutral text. */
export function renderMetricCell(metric: ScreenerMetric, row: ScreenerRow, ctx: CellContext): ReactNode {
  if (metric.id === "signal") {
    return row.signal ? (
      <Badge>{PULSE_SIGNAL_META[row.signal].label}</Badge>
    ) : (
      <Missing reason={row.fresh ? "No signal" : "Price withheld"} />
    );
  }
  const value = row[metric.id as NumericMetricId];
  if (metric.format === "return") return <Delta value={value} missingReason={missingReason(row)} />;
  const text = formatMetricValue(metric, value, ctx);
  return text === null ? <Missing reason={missingReason(row)} /> : text;
}

/**
 * Phone row, line 2 left: the sorted metric when the row has no other place
 * for it, else units sold in 30 days.
 */
export function phoneMeta(row: ScreenerRow, sort: SortKey, ctx: CellContext): string {
  if (sort === "name" || sort === "price" || sort === "units" || isReturnMetric(sort)) {
    return `${row.units === null ? "--" : formatInteger(row.units)} sold 30D`;
  }
  const metric = METRIC_BY_ID[sort];
  const text = formatMetricValue(metric, row[sort], ctx) ?? "--";
  if (sort === "off" && text === "At high") return "At 52-week high";
  if (sort === "dos") return `${text} days of supply`;
  if (sort === "msrp") return `${text} MSRP`;
  return `${metric.short} ${text}`;
}
```

If `formatMsrpMultiple` returns `string | null` (WP28 and WP30 both do), the `multiple` case already returns null for a missing value. If `formatDaysOfSupply` returns `"--"` for null, that path is never reached because null returns first.

### Step 16. The table: `ScreenerTableRow.tsx` and `ScreenerTable.tsx` (new, `app/components/Screener/`)

16a. `ScreenerTableRow.tsx`:

```tsx
"use client";

import { memo } from "react";
import IntentLink from "../IntentLink";
import MiniSparkline from "../MarketView/MiniSparkline";
import AsOf from "../ui/AsOf";
import type { ScreenerMetric } from "../../screener/metrics";
import { screenerProductName, type ScreenerRow } from "../../screener/types";
import { Missing, missingReason, renderMetricCell, type CellContext } from "./columns";

export interface ScreenerTableRowProps {
  row: ScreenerRow;
  /** From columnsFor(): the same instance until the column set changes. */
  columns: readonly ScreenerMetric[];
  /** Memoised in the container; changes only with the currency. */
  ctx: CellContext;
  referenceDate: string;
  /** WP26 series (a string, so the prop is stable): undefined = flat bar, null = "No history". */
  sparkline: string | null | undefined;
}

// Borders live on the cells, not the <tr>: the table uses border-separate
// (step 16b), because collapsed borders do not travel with sticky cells.
const CELL = "whitespace-nowrap border-b border-line px-3 text-right";

/**
 * One 44 px row. Memoised with primitive or cached props only: a sort moves
 * rows without re-rendering them (the rank is a CSS counter, step 14).
 */
function ScreenerTableRow({ row, columns, ctx, referenceDate, sparkline }: ScreenerTableRowProps) {
  const name = screenerProductName(row);
  return (
    <tr className="group h-11 bg-surface hover:bg-surface-alt">
      {/* The number is CSS generated content (step 14); browsers expose it to screen readers, under the "Rank" header. */}
      <td className="pf-screener-rank sticky left-0 z-10 border-b border-line bg-surface px-3 text-right text-small text-ink-soft group-hover:bg-surface-alt" />
      <td className="sticky left-12 z-10 overflow-hidden border-b border-r border-line bg-surface px-3 group-hover:bg-surface-alt">
        <IntentLink
          href={`/product/${row.id}`}
          title={row.variant ? `${name}, ${row.variant}` : name}
          className="block truncate rounded-control font-medium text-ink hover:text-action focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
        >
          {name}
          {row.variant && <span className="ml-2 text-small font-normal text-ink-soft">{row.variant}</span>}
        </IntentLink>
      </td>
      <td className={`${CELL} font-semibold text-ink`}>
        {row.price === null ? <Missing reason={missingReason(row)} /> : ctx.formatPrice(row.price)}
        <AsOf date={row.priceDay} variant="table" referenceDate={referenceDate} className="ml-1" />
      </td>
      {columns.map((metric) => (
        <td key={metric.id} className={`${CELL} text-ink`}>
          {renderMetricCell(metric, row, ctx)}
        </td>
      ))}
      <td className="border-b border-line px-3">
        <MiniSparkline series={sparkline} size="list" className="ml-auto" />
      </td>
    </tr>
  );
}

export default memo(ScreenerTableRow);
```

16b. `ScreenerTable.tsx`:

```tsx
"use client";

import { memo } from "react";
import { MetricHelpLink } from "../ui/MetricLabel";
import { METRIC_DEFINITIONS } from "../../lib/metricDefinitions";
import type { SortDirection } from "../../lib/sorting";
import { sparklineFor, type SparklinePayload } from "../../lib/sparkline";
import {
  METRIC_BY_ID,
  directionPhrase,
  sortFullLabel,
  type ScreenerMetric,
  type SortKey,
} from "../../screener/metrics";
import { productCount, type ScreenerRow } from "../../screener/types";
import type { CellContext } from "./columns";
import ScreenerTableRow from "./ScreenerTableRow";

const RANK_PX = 48; // = left-12, the product column's sticky offset
const PRODUCT_MIN_PX = 240;
const TREND_PX = 120;
const TH = "h-10 border-b border-line px-3 text-right align-middle text-caption";

function ariaSort(active: boolean, dir: SortDirection): "ascending" | "descending" | undefined {
  if (!active) return undefined;
  return dir === "asc" ? "ascending" : "descending";
}

interface SortHeaderProps {
  sortKey: SortKey;
  label: string;
  title: string;
  sort: SortKey;
  dir: SortDirection;
  onSort: (key: SortKey) => void;
}

/** Header button: bold ink with ▲/▼ when sorted, a faint ↕ otherwise (WP23 dense table rules). */
function SortHeader({ sortKey, label, title, sort, dir, onSort }: SortHeaderProps) {
  const active = sort === sortKey;
  return (
    <button
      type="button"
      title={title}
      onClick={() => onSort(sortKey)}
      className={`inline-flex h-10 items-center gap-1 uppercase tracking-wide hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action pointer-coarse:min-h-11 ${
        active ? "font-bold text-ink" : "font-semibold text-ink-soft"
      }`}
    >
      <span>{label}</span>
      <span aria-hidden="true" className={active ? "text-ink" : "text-ink-soft opacity-60"}>
        {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </button>
  );
}

function titleOf(metric: ScreenerMetric): string {
  const definition = METRIC_DEFINITIONS[metric.metric];
  return `${definition.label}: ${definition.short}`;
}

export interface ScreenerTableProps {
  rows: readonly ScreenerRow[];
  columns: readonly ScreenerMetric[];
  sort: SortKey;
  dir: SortDirection;
  onSort: (key: SortKey) => void;
  ctx: CellContext;
  referenceDate: string;
  sparklines: SparklinePayload | null;
  /** Rows that match (for the caption); rows may be the first page only. */
  total: number;
}

function ScreenerTable({ rows, columns, sort, dir, onSort, ctx, referenceDate, sparklines, total }: ScreenerTableProps) {
  const price = METRIC_BY_ID.price;
  const minWidth = RANK_PX + PRODUCT_MIN_PX + price.widthPx + TREND_PX + columns.reduce((sum, c) => sum + c.widthPx, 0);
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <table className="w-full table-fixed border-separate border-spacing-0 text-body tabular-nums" style={{ minWidth }}>
        <caption className="sr-only">
          {`Screener results: ${productCount(total)}, sorted by ${sortFullLabel(sort)}, ${directionPhrase(sort, dir)}`}
        </caption>
        <colgroup>
          <col style={{ width: RANK_PX }} />
          <col />
          <col style={{ width: price.widthPx }} />
          {columns.map((c) => (
            <col key={c.id} style={{ width: c.widthPx }} />
          ))}
          <col style={{ width: TREND_PX }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-20 h-10 border-b border-line bg-surface px-3 text-right text-caption font-semibold text-ink-soft">
              <span aria-hidden="true">#</span>
              <span className="sr-only">Rank</span>
            </th>
            <th
              scope="col"
              aria-sort={ariaSort(sort === "name", dir)}
              className="sticky left-12 z-20 h-10 border-b border-r border-line bg-surface px-3 text-left align-middle text-caption"
            >
              <SortHeader sortKey="name" label="Product" title="Sort by name" sort={sort} dir={dir} onSort={onSort} />
            </th>
            <th scope="col" aria-sort={ariaSort(sort === "price", dir)} className={TH}>
              <span className="inline-flex items-center justify-end gap-0.5">
                <SortHeader sortKey="price" label={price.short} title={titleOf(price)} sort={sort} dir={dir} onSort={onSort} />
                <MetricHelpLink metric={price.metric} />
              </span>
            </th>
            {columns.map((c) => (
              <th key={c.id} scope="col" aria-sort={c.sortable ? ariaSort(sort === c.id, dir) : undefined} className={TH}>
                <span className="inline-flex items-center justify-end gap-0.5">
                  {c.sortable ? (
                    <SortHeader sortKey={c.id as SortKey} label={c.short} title={titleOf(c)} sort={sort} dir={dir} onSort={onSort} />
                  ) : (
                    <span title={titleOf(c)} className="font-semibold uppercase tracking-wide text-ink-soft">
                      {c.short}
                    </span>
                  )}
                  <MetricHelpLink metric={c.metric} />
                </span>
              </th>
            ))}
            <th
              scope="col"
              title="Price over the last year, scaled to its own low and high"
              className={`${TH} font-semibold uppercase tracking-wide text-ink-soft`}
            >
              Trend 1Y
            </th>
          </tr>
        </thead>
        <tbody className="pf-screener-body [&>tr:last-child>td]:border-b-0">
          {rows.map((row) => (
            <ScreenerTableRow
              key={row.id}
              row={row}
              columns={columns}
              ctx={ctx}
              referenceDate={referenceDate}
              sparkline={sparklineFor(sparklines, row.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default memo(ScreenerTable);
```

Do not add Suspense boundaries around row chunks (WP26 pitfall: position-keyed boundaries remount rows on every sort).

### Step 17. `app/components/Screener/ScreenerPhoneList.tsx` (new)

```tsx
"use client";

import { memo } from "react";
import MiniSparkline from "../MarketView/MiniSparkline";
import AsOf from "../ui/AsOf";
import { DataList, DataListRow } from "../ui/DataList";
import Delta from "../ui/Delta";
import { sparklineFor, type SparklinePayload } from "../../lib/sparkline";
import { METRIC_BY_ID, isReturnMetric, type SortKey } from "../../screener/metrics";
import { screenerProductName, type ScreenerRow } from "../../screener/types";
import { isPriceDayStale } from "../ProductPrices/utils/freshness";
import { Missing, missingReason, phoneMeta, type CellContext } from "./columns";

interface ItemProps {
  row: ScreenerRow;
  sort: SortKey;
  ctx: CellContext;
  referenceDate: string;
  sparkline: string | null | undefined;
}

/**
 * WP23 DataListRow: title and variant, then meta | price, Delta, and the 64x24 1Y trend.
 * A price 2 or more days old (or withheld) prints "Last priced Sep 25" in words in the
 * meta slot: a tooltip glyph says nothing on touch (WP23 AsOf, WP30 D1 item 7).
 */
const ScreenerListItem = memo(function ScreenerListItem({ row, sort, ctx, referenceDate, sparkline }: ItemProps) {
  const deltaId = isReturnMetric(sort) ? sort : "r1m";
  const stale = isPriceDayStale(row.priceDay, referenceDate);
  return (
    <DataListRow
      href={`/product/${row.id}`}
      title={screenerProductName(row)}
      subtitle={row.variant ?? undefined}
      meta={stale ? <AsOf date={row.priceDay} referenceDate={referenceDate} /> : phoneMeta(row, sort, ctx)}
      value={row.price === null ? <Missing reason={missingReason(row)} /> : ctx.formatPrice(row.price)}
      delta={<Delta value={row[deltaId]} period={METRIC_BY_ID[deltaId].short} missingReason={missingReason(row)} />}
      sparkline={<MiniSparkline series={sparkline} size="row" />}
    />
  );
});

export interface ScreenerPhoneListProps {
  rows: readonly ScreenerRow[];
  sort: SortKey;
  ctx: CellContext;
  referenceDate: string;
  sparklines: SparklinePayload | null;
}

function ScreenerPhoneList({ rows, sort, ctx, referenceDate, sparklines }: ScreenerPhoneListProps) {
  return (
    <DataList label="Screener results">
      {rows.map((row) => (
        <ScreenerListItem
          key={row.id}
          row={row}
          sort={sort}
          ctx={ctx}
          referenceDate={referenceDate}
          sparkline={sparklineFor(sparklines, row.id)}
        />
      ))}
    </DataList>
  );
}

export default memo(ScreenerPhoneList);
```

`DataListRow` links with `prefetch={false}` (WP23), so a phone list never prefetches product pages.

### Step 18. Filter, preset and sheet components (new, `app/components/Screener/`)

18a. `fields.tsx`:

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { parseNumber, type Range } from "../../screener/urlState";

export const FIELD_LABEL =
  "flex min-w-0 flex-col gap-1 text-caption font-semibold uppercase tracking-wide text-ink-soft";
export const FIELD_CONTROL =
  "h-10 rounded-control border border-line bg-surface px-3 text-base normal-case tracking-normal text-ink sm:text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action pointer-coarse:h-11";

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  anyLabel,
}: {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  /** Label of the empty option; omit for a select without one. */
  anyLabel?: string;
}) {
  // A value from a shared URL that is not in the catalog stays selectable, so the select shows the truth.
  const known = value === "" || options.some((o) => o.value === value);
  return (
    <label className={FIELD_LABEL}>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className={FIELD_CONTROL}>
        {anyLabel !== undefined && <option value="">{anyLabel}</option>}
        {!known && <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * A number typed as text: "-", "1." and "" are valid on the way to a number.
 * A parseable value is committed at once (urgent draft state in the
 * container); an external change (Reset, a preset) replaces the text.
 */
export function NumberInput({
  label,
  name,
  value,
  onCommit,
}: {
  /** Visible text: "Min" or "Max". */
  label: string;
  /** Accessible name, starting with the visible text: "Min, Days of supply". */
  name: string;
  value: number | null;
  onCommit: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (parseNumber(text) !== value) setText(value === null ? "" : String(value));
  }
  const invalid = text.trim() !== "" && parseNumber(text) === null;
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-caption text-ink-soft">
      <span aria-hidden="true">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={name}
        aria-invalid={invalid || undefined}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (next.trim() === "") onCommit(null);
          else {
            const parsed = parseNumber(next);
            if (parsed !== null) onCommit(parsed);
          }
        }}
        className={`${FIELD_CONTROL} w-full tabular-nums ${invalid ? "border-warn-text" : ""}`}
      />
    </label>
  );
}

export function RangeField({
  legend,
  legendText,
  unit,
  range,
  onChange,
}: {
  /** Visible legend, usually <MetricLabel metric=... />. */
  legend: ReactNode;
  /** The full label as text, for the input names. */
  legendText: string;
  /** "%", "x", "days" or "". */
  unit: string;
  range: Range;
  onChange: (range: Range) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-small font-medium text-ink">
        {legend}
        {unit && <span className="ml-1 text-ink-soft">({unit})</span>}
      </legend>
      <div className="mt-1 flex gap-2">
        <NumberInput label="Min" name={`Min, ${legendText}`} value={range.min} onCommit={(min) => onChange({ ...range, min })} />
        <NumberInput label="Max" name={`Max, ${legendText}`} value={range.max} onCommit={(max) => onChange({ ...range, max })} />
      </div>
    </fieldset>
  );
}
```

18b. `CategoricalFilters.tsx`:

```tsx
"use client";

import { PULSE_SIGNAL_META, type PulseSignal } from "../../lib/marketPulse";
import { PRICE_BANDS, priceBandValue, type FilterOptions } from "../../screener/filters";
import { PULSE_SIGNALS, type ScreenerState } from "../../screener/urlState";
import { FIELD_CONTROL, FIELD_LABEL, SelectField } from "./fields";

export interface FilterProps {
  state: ScreenerState;
  onChange: (next: ScreenerState) => void;
}

const SIGNAL_OPTIONS = PULSE_SIGNALS.map((s) => ({ value: s, label: PULSE_SIGNAL_META[s].label }));

/** Search, type, era, set, price band, signal and "Current price only": the desktop bar and the phone sheet. */
export default function CategoricalFilters({
  state,
  onChange,
  options,
  layout,
}: FilterProps & { options: FilterOptions; layout: "bar" | "sheet" }) {
  const band = priceBandValue(state.pmin, state.pmax);
  const bandOptions = [
    ...PRICE_BANDS.map((b) => ({ value: b.value, label: b.label })),
    ...(band === "custom" ? [{ value: "custom", label: "Custom range" }] : []),
  ];
  return (
    <div className={layout === "bar" ? "contents" : "space-y-4"}>
      <label className={FIELD_LABEL}>
        Search
        <input
          type="search"
          value={state.q}
          maxLength={100}
          autoComplete="off"
          placeholder="Name, set or code"
          onChange={(event) => onChange({ ...state, q: event.target.value })}
          className={`${FIELD_CONTROL} ${layout === "bar" ? "w-60" : "w-full"}`}
        />
      </label>
      <SelectField label="Product type" anyLabel="All types" value={state.type} options={options.types} onChange={(type) => onChange({ ...state, type })} />
      <SelectField label="Era" anyLabel="All eras" value={state.gen} options={options.eras} onChange={(gen) => onChange({ ...state, gen })} />
      <SelectField
        label="Set"
        anyLabel="All sets"
        value={state.set === null ? "" : String(state.set)}
        options={options.sets}
        onChange={(value) => onChange({ ...state, set: value ? Number(value) : null })}
      />
      <SelectField
        label="Price (USD)"
        anyLabel="Any price"
        value={band}
        options={bandOptions}
        onChange={(value) => {
          if (value === "custom") return;
          const picked = PRICE_BANDS.find((b) => b.value === value);
          onChange({ ...state, pmin: picked ? picked.pmin : null, pmax: picked ? picked.pmax : null });
        }}
      />
      <SelectField
        label="Market Pulse"
        anyLabel="Any signal"
        value={state.sig ?? ""}
        options={SIGNAL_OPTIONS}
        onChange={(value) =>
          onChange({ ...state, sig: (PULSE_SIGNALS as readonly string[]).includes(value) ? (value as PulseSignal) : null })
        }
      />
      <label className="inline-flex min-h-10 items-center gap-2 self-end text-small text-ink pointer-coarse:min-h-11">
        <input
          type="checkbox"
          checked={state.priced}
          onChange={(event) => onChange({ ...state, priced: event.target.checked })}
          className="size-4 accent-action"
        />
        Current price only
      </label>
    </div>
  );
}
```

18c. `MetricFilterFields.tsx`:

```tsx
"use client";

import { useState } from "react";
import MetricLabel from "../ui/MetricLabel";
import { METRIC_DEFINITIONS } from "../../lib/metricDefinitions";
import { RANGE_UNITS, rangeLabel, rangeMetricId } from "../../screener/filters";
import { METRIC_BY_ID, type Availability } from "../../screener/metrics";
import {
  RETURN_WINDOWS,
  RETURN_WINDOW_LABELS,
  isRangeActive,
  withRange,
  type RangeFilterKey,
  type ReturnWindow,
} from "../../screener/urlState";
import type { FilterProps } from "./CategoricalFilters";
import { RangeField, SelectField } from "./fields";

const GROUPS: ReadonlyArray<{ legend: string; keys: readonly RangeFilterKey[] }> = [
  { legend: "Risk", keys: ["off", "vol", "dd"] },
  { legend: "Liquidity", keys: ["st", "dos", "sc30", "liq"] },
  { legend: "Value", keys: ["msrp", "prem"] },
];

const WINDOW_OPTIONS = RETURN_WINDOWS.map((w) => ({ value: w, label: RETURN_WINDOW_LABELS[w] }));

/**
 * Return window plus its range. The window is kept locally until a Min or
 * Max exists, because the URL carries rw only with a return range
 * (normalizeScreenerState resets it otherwise).
 */
function ReturnRange({ state, onChange }: FilterProps) {
  const [local, setLocal] = useState<ReturnWindow>(state.rw);
  const active = isRangeActive(state.ranges.ret);
  const rw = active ? state.rw : local;
  return (
    <>
      <SelectField
        label="Return window"
        value={rw}
        options={WINDOW_OPTIONS}
        onChange={(value) => {
          setLocal(value as ReturnWindow);
          if (active) onChange({ ...state, rw: value as ReturnWindow });
        }}
      />
      <RangeField
        legend={rangeLabel("ret", rw)}
        legendText={rangeLabel("ret", rw)}
        unit={RANGE_UNITS.ret}
        range={state.ranges.ret}
        onChange={(range) => onChange(withRange({ ...state, rw }, "ret", range))}
      />
    </>
  );
}

/**
 * The range filters, grouped. A field shows when its metric has data in the
 * catalog or when it is already active (a shared URL), so nothing that
 * filters the results is ever hidden.
 */
export default function MetricFilterFields({
  state,
  onChange,
  availability,
  className = "",
}: FilterProps & { availability: Availability; className?: string }) {
  const shown = (key: RangeFilterKey) =>
    availability[rangeMetricId(key, state.rw)] || isRangeActive(state.ranges[key]);
  return (
    <div className={className}>
      <fieldset className="min-w-0 space-y-3">
        <legend className="text-small font-semibold text-ink">Performance</legend>
        <ReturnRange state={state} onChange={onChange} />
      </fieldset>
      {GROUPS.map((group) => {
        const keys = group.keys.filter(shown);
        if (keys.length === 0) return null;
        return (
          <fieldset key={group.legend} className="min-w-0 space-y-3">
            <legend className="text-small font-semibold text-ink">{group.legend}</legend>
            {keys.map((key) => {
              const metric = METRIC_BY_ID[rangeMetricId(key, state.rw)].metric;
              return (
                <RangeField
                  key={key}
                  legend={<MetricLabel metric={metric} />}
                  legendText={METRIC_DEFINITIONS[metric].label}
                  unit={RANGE_UNITS[key]}
                  range={state.ranges[key]}
                  onChange={(range) => onChange(withRange(state, key, range))}
                />
              );
            })}
          </fieldset>
        );
      })}
    </div>
  );
}
```

18d. `FilterBar.tsx` (desktop, in the server HTML):

```tsx
"use client";

import Button from "../ui/Button";
import type { FilterOptions } from "../../screener/filters";
import CategoricalFilters, { type FilterProps } from "./CategoricalFilters";

export default function FilterBar({
  state,
  onChange,
  options,
  metricCount,
  metricPanelOpen,
  onToggleMetricPanel,
  onIntent,
  onReset,
  hasFilters,
}: FilterProps & {
  options: FilterOptions;
  metricCount: number;
  metricPanelOpen: boolean;
  onToggleMetricPanel: () => void;
  /** Preload the metric panel chunk on hover and focus. */
  onIntent: () => void;
  onReset: () => void;
  hasFilters: boolean;
}) {
  return (
    <div className="hidden md:flex md:flex-wrap md:items-end md:gap-3">
      <CategoricalFilters state={state} onChange={onChange} options={options} layout="bar" />
      <Button
        variant="secondary"
        aria-expanded={metricPanelOpen}
        aria-controls="screener-metric-filters"
        onClick={onToggleMetricPanel}
        onPointerEnter={onIntent}
        onFocus={onIntent}
      >
        {metricCount > 0 ? `Metric filters (${metricCount})` : "Metric filters"}
      </Button>
      {hasFilters && (
        <Button variant="ghost" onClick={onReset}>
          Reset
        </Button>
      )}
    </div>
  );
}
```

18e. `MetricFilterPanel.tsx` (lazy):

```tsx
"use client";

import MetricFilterFields from "./MetricFilterFields";
import type { FilterProps } from "./CategoricalFilters";
import type { Availability } from "../../screener/metrics";

export default function MetricFilterPanel(props: FilterProps & { availability: Availability }) {
  return (
    <section aria-label="Metric filters" className="rounded-card border border-line bg-surface p-4">
      <MetricFilterFields {...props} className="grid gap-6 md:grid-cols-2 xl:grid-cols-4" />
    </section>
  );
}
```

18f. `FilterSheet.tsx` (lazy, phones). Pass `placement="top"` only when soft check (a) found `DialogPlacement`; otherwise delete that prop:

```tsx
"use client";

import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import type { FilterOptions } from "../../screener/filters";
import type { Availability } from "../../screener/metrics";
import { productCount } from "../../screener/types";
import CategoricalFilters, { type FilterProps } from "./CategoricalFilters";
import MetricFilterFields from "./MetricFilterFields";

export default function FilterSheet({
  state,
  onChange,
  options,
  availability,
  resultCount,
  onReset,
  onClose,
}: FilterProps & {
  options: FilterOptions;
  availability: Availability;
  resultCount: number;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="Filters"
      placement="top"
      footer={
        // A fragment: WP14's Dialog already wraps the footer in a flex row with
        // gap-3, a top border and p-4. A second wrapper doubles both.
        <>
          <Button variant="secondary" onClick={onReset}>
            Reset
          </Button>
          <Button className="flex-1" onClick={onClose}>
            {`Show ${productCount(resultCount)}`}
          </Button>
        </>
      }
    >
      <div className="space-y-6 p-4">
        <CategoricalFilters state={state} onChange={onChange} options={options} layout="sheet" />
        <MetricFilterFields state={state} onChange={onChange} availability={availability} className="space-y-6" />
      </div>
    </Dialog>
  );
}
```

18g. `SortSheet.tsx` (lazy, phones). Buttons with `aria-pressed`, not radios (D9):

```tsx
"use client";

import Dialog from "../ui/Dialog";
import { sortFullLabel, type Availability, type SortKey } from "../../screener/metrics";

const GROUPS: ReadonlyArray<{ legend: string; keys: readonly SortKey[] }> = [
  { legend: "General", keys: ["name", "price"] },
  { legend: "Performance", keys: ["r7d", "r1m", "r3m", "r1y"] },
  { legend: "Risk", keys: ["vol", "dd", "off"] },
  { legend: "Liquidity", keys: ["units", "vtrend", "st", "dos", "sc30", "liq"] },
  { legend: "Value", keys: ["msrp", "cpp", "prem"] },
];

export default function SortSheet({
  sort,
  availability,
  onSelect,
  onClose,
}: {
  sort: SortKey;
  availability: Availability;
  onSelect: (key: SortKey) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onClose={onClose} title="Sort by" placement="top">
      <div className="space-y-4 p-4">
        {GROUPS.map((group) => {
          const keys = group.keys.filter((key) => key === "name" || key === sort || availability[key]);
          if (keys.length === 0) return null;
          const headingId = `screener-sort-${group.legend.toLowerCase()}`;
          return (
            <section key={group.legend} aria-labelledby={headingId}>
              <h3 id={headingId} className="text-caption font-semibold uppercase tracking-wide text-ink-soft">
                {group.legend}
              </h3>
              <ul className="mt-1 divide-y divide-line">
                {keys.map((key) => (
                  <li key={key}>
                    <button
                      type="button"
                      aria-pressed={sort === key}
                      onClick={() => onSelect(key)}
                      className="flex min-h-11 w-full items-center justify-between px-1 text-left text-body text-ink hover:bg-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action"
                    >
                      <span>{key === "price" ? "Market Price" : sortFullLabel(key)}</span>
                      {sort === key && (
                        <span aria-hidden="true" className="text-action">
                          ✓
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}
```

18h. `PresetBar.tsx`:

```tsx
"use client";

import type { ScreenerPreset } from "../../screener/presets";

export default function PresetBar({
  presets,
  activeId,
  onApply,
}: {
  presets: readonly ScreenerPreset[];
  activeId: string | null;
  onApply: (preset: ScreenerPreset) => void;
}) {
  if (presets.length === 0) return null;
  return (
    <>
      <div role="group" aria-labelledby="screener-screens-label" className="hidden md:flex md:flex-wrap md:items-center md:gap-2">
        <span id="screener-screens-label" className="text-caption font-semibold uppercase tracking-wide text-ink-soft">
          Screens
        </span>
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-pressed={activeId === preset.id}
            title={preset.summary}
            onClick={() => onApply(preset)}
            className="h-9 rounded-control border border-line bg-surface px-3 text-small font-medium text-ink hover:bg-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action pointer-coarse:min-h-11 aria-pressed:border-action aria-pressed:bg-action aria-pressed:text-white"
          >
            {preset.name}
          </button>
        ))}
      </div>
      <select
        aria-label="Screen"
        value={activeId ?? ""}
        onChange={(event) => {
          const picked = presets.find((p) => p.id === event.target.value);
          if (picked) onApply(picked);
        }}
        className="h-11 w-full rounded-control border border-line bg-surface px-3 text-base text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action md:hidden"
      >
        <option value="">Screens: choose one</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </>
  );
}
```

18i. `ActiveFilters.tsx` (always one line of fixed height, so applying a shared URL after hydration shifts nothing above the table):

```tsx
"use client";

import type { FilterChip } from "../../screener/filters";
import type { ScreenerPreset } from "../../screener/presets";
import type { ScreenerState } from "../../screener/urlState";

export default function ActiveFilters({
  state,
  preset,
  chips,
  onChange,
  onReset,
}: {
  state: ScreenerState;
  preset: ScreenerPreset | null;
  chips: readonly FilterChip[];
  onChange: (next: ScreenerState) => void;
  onReset: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Active filters"
      className="flex h-9 items-center gap-2 overflow-x-auto whitespace-nowrap text-small pointer-coarse:h-12"
    >
      {preset && <span className="shrink-0 font-medium text-ink">Screen: {preset.name}</span>}
      {chips.length === 0 ? (
        <span className="text-ink-soft">No filters. Every tracked product is listed.</span>
      ) : (
        <>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => onChange(chip.clear(state))}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-control border border-line bg-surface px-2 text-ink hover:bg-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action pointer-coarse:h-11"
            >
              <span>{chip.text}</span>
              <span aria-hidden="true">×</span>
              <span className="sr-only">, remove filter</span>
            </button>
          ))}
          <button
            type="button"
            onClick={onReset}
            className="h-7 shrink-0 rounded-control px-2 font-medium text-action hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action pointer-coarse:h-11"
          >
            Clear all
          </button>
        </>
      )}
    </div>
  );
}
```

If WP23's `Button` does not merge a `className` prop into its classes (check `app/components/ui/Button.tsx`), wrap the buttons that pass `className="flex-1"` in `<div className="flex-1">` and pass `className="w-full"` through `buttonClasses()` on a plain `<button>` instead. Do not edit `Button.tsx`.

### Step 19. `app/components/Screener/Screener.tsx` (new): the container

```tsx
"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useMemo, useState, useTransition } from "react";
import LocationSearchSignal from "../LocationSearchSignal";
import NoResults from "../NoResults";
import Button from "../ui/Button";
import DecisionNote from "../ui/DecisionNote";
import EmptyState from "../ui/EmptyState";
import SegmentedControl from "../ui/SegmentedControl";
import { WarnIcon } from "../ui/icons";
import { useCurrency } from "../../context/CurrencyContext";
import { createDebouncedSearchWriter, useLocationSearch } from "../../lib/locationSearch";
import type { SparklinePayload } from "../../lib/sparkline";
import { applyScreen, describeFilters, filterOptions, visibleColumnIds } from "../../screener/filters";
import {
  COLUMN_PRESETS,
  COLUMN_PRESET_IDS,
  PAGE_SIZE,
  columnsFor,
  defaultDirectionFor,
  directionPhrase,
  effectiveColumnPreset,
  hasValueData,
  metricAvailability,
  sortShortLabel,
  type ColumnPreset,
  type SortKey,
} from "../../screener/metrics";
import { availablePresets, matchingPreset, type ScreenerPreset } from "../../screener/presets";
import {
  RANGE_FILTERS,
  SCREENER_URL_KEYS,
  filterQuery,
  isRangeActive,
  normalizeScreenerState,
  parseScreenerQuery,
  resetFilters,
  serializeScreenerState,
  type ScreenerState,
} from "../../screener/urlState";
import { productCount, type ScreenerRow } from "../../screener/types";
import ActiveFilters from "./ActiveFilters";
import FilterBar from "./FilterBar";
import PresetBar from "./PresetBar";
import ScreenerPhoneList from "./ScreenerPhoneList";
import ScreenerTable from "./ScreenerTable";
import { useMinWidthMd } from "./useMinWidthMd";

// Closed by default: each loads on first open and is preloaded on hover or
// focus of its trigger, so none of them is in the initial bundle.
const loadMetricFilterPanel = () => import("./MetricFilterPanel");
const loadFilterSheet = () => import("./FilterSheet");
const loadSortSheet = () => import("./SortSheet");
const MetricFilterPanel = dynamic(loadMetricFilterPanel, { ssr: false });
const FilterSheet = dynamic(loadFilterSheet, { ssr: false });
const SortSheet = dynamic(loadSortSheet, { ssr: false });

/** Same debounce as /prices (WP08). */
const URL_WRITE_DEBOUNCE_MS = 250;

export interface ScreenerProps {
  rows: ScreenerRow[];
  sparklines: SparklinePayload | null;
  /** Server render date (YYYY-MM-DD, UTC), for the stale-price glyph. */
  referenceDate: string;
  /** product_daily_stats day, or null when the stats read failed. */
  statsDay: string | null;
}

type Sheet = "filters" | "sort" | null;

export default function Screener({ rows, sparklines, referenceDate, statsDay }: ScreenerProps) {
  const { currency, formatPrice, convertPrice, exchangeRate, exchangeRateDate } = useCurrency();
  const locationSearch = useLocationSearch();

  // Seed: during hydration the store's server snapshot is "", so this is the
  // default view, exactly what the server rendered; on a client-side mount
  // (a <Link> to /screener?...) it is the URL at render time (WP08's seed).
  const [initialState] = useState(() => parseScreenerQuery(locationSearch));
  // draft: what the controls show, updated urgently so a pressed segment,
  // arrow or chip paints on the next frame. applied: what the results use,
  // updated in a transition (D1 item 17).
  const [draft, setDraft] = useState<ScreenerState>(initialState);
  const [applied, setApplied] = useState<ScreenerState>(initialState);
  const [isPending, startTransition] = useTransition();

  // URL -> state (WP08's pattern). The server and hydration render the
  // default view (the store's server snapshot is ""); right after hydration,
  // back/forward, or a <Link> to /screener?..., the URL wins. Our own writes
  // describe the current state, so they never re-seed.
  const [seenSearch, setSeenSearch] = useState(locationSearch);
  if (seenSearch !== locationSearch) {
    setSeenSearch(locationSearch);
    const fromUrl = parseScreenerQuery(locationSearch);
    if (serializeScreenerState(fromUrl) !== serializeScreenerState(draft)) {
      setDraft(fromUrl);
      setApplied(fromUrl);
    }
  }

  // State -> URL: from event handlers only, debounced, history.replaceState.
  const [urlWriter] = useState(() => createDebouncedSearchWriter(SCREENER_URL_KEYS, URL_WRITE_DEBOUNCE_MS));
  useEffect(() => urlWriter.cancel, [urlWriter]);

  const apply = (next: ScreenerState) => {
    const normalized = normalizeScreenerState(next);
    setDraft(normalized);
    startTransition(() => setApplied(normalized));
    urlWriter.schedule(serializeScreenerState(normalized));
  };

  const availability = useMemo(() => metricAvailability(rows), [rows]);
  const options = useMemo(() => filterOptions(rows), [rows]);
  const presets = useMemo(() => availablePresets(availability), [availability]);
  const matched = useMemo(() => applyScreen(rows, applied), [rows, applied]);

  // "Show more" is per filter set: it resets when the filters change, not on a sort.
  const appliedFilters = filterQuery(applied);
  const [page, setPage] = useState({ filters: appliedFilters, count: PAGE_SIZE });
  const visibleCount = page.filters === appliedFilters ? page.count : PAGE_SIZE;
  const shown = useMemo(() => matched.slice(0, visibleCount), [matched, visibleCount]);
  const showCount = (count: number) => startTransition(() => setPage({ filters: appliedFilters, count }));

  // Columns follow the applied view (a draft change must not re-render rows urgently).
  const columns = columnsFor(visibleColumnIds(applied, availability));
  const ctx = useMemo(() => ({ formatPrice }), [formatPrice]);
  const md = useMinWidthMd();

  const [sheet, setSheet] = useState<Sheet>(null);
  const [metricPanelOpen, setMetricPanelOpen] = useState(false);

  const activePreset = matchingPreset(draft);
  const chips = describeFilters(draft, options.setNames);
  const metricCount = RANGE_FILTERS.filter((key) => isRangeActive(draft.ranges[key])).length;
  const columnOptions = COLUMN_PRESET_IDS.filter((id) => id !== "value" || hasValueData(availability)).map(
    (id) => ({ value: id, label: COLUMN_PRESETS[id].label })
  );

  const onSort = (key: SortKey) =>
    apply(
      draft.sort === key
        ? { ...draft, dir: draft.dir === "asc" ? "desc" : "asc" }
        : { ...draft, sort: key, dir: defaultDirectionFor(key) }
    );
  const onReset = () => apply(resetFilters(draft));
  const onPreset = (preset: ScreenerPreset) => apply(preset.state);
  const flipDirection = () => apply({ ...draft, dir: draft.dir === "asc" ? "desc" : "asc" });

  const exportCsv = async () => {
    const { buildScreenerCsv, csvFilename, downloadCsv } = await import("../../screener/exportCsv");
    const csv = buildScreenerCsv(
      matched,
      columns.map((c) => c.id),
      { currency, convertPrice, exchangeRate, exchangeRateDate, statsDay, pageUrl: window.location.href }
    );
    downloadCsv(csvFilename(statsDay ?? referenceDate), csv);
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No products to screen right now."
        description="The catalog could not be read. Try again in a few minutes."
      />
    );
  }

  return (
    <div className="space-y-3">
      {statsDay === null && (
        <p className="flex items-center gap-1 text-small text-warn-text">
          <WarnIcon className="size-4 shrink-0" />
          Risk, supply and value statistics are unavailable right now. Prices and returns come from the catalog.
        </p>
      )}

      <PresetBar presets={presets} activeId={activePreset?.id ?? null} onApply={onPreset} />

      <FilterBar
        state={draft}
        onChange={apply}
        options={options}
        metricCount={metricCount}
        metricPanelOpen={metricPanelOpen}
        onToggleMetricPanel={() => setMetricPanelOpen((open) => !open)}
        onIntent={() => void loadMetricFilterPanel()}
        onReset={onReset}
        hasFilters={chips.length > 0}
      />
      {metricPanelOpen && (
        <div id="screener-metric-filters" className="hidden md:block">
          <MetricFilterPanel state={draft} onChange={apply} availability={availability} />
        </div>
      )}

      <div className="flex gap-2 md:hidden">
        <Button
          variant="secondary"
          className="flex-1"
          aria-haspopup="dialog"
          onClick={() => setSheet("filters")}
          onPointerEnter={() => void loadFilterSheet()}
          onFocus={() => void loadFilterSheet()}
        >
          {chips.length > 0 ? `Filters (${chips.length})` : "Filters"}
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          aria-haspopup="dialog"
          onClick={() => setSheet("sort")}
          onPointerEnter={() => void loadSortSheet()}
          onFocus={() => void loadSortSheet()}
        >
          {`Sort: ${sortShortLabel(draft.sort)}`}
        </Button>
        <Button
          variant="secondary"
          aria-label={`Sort order: ${directionPhrase(draft.sort, draft.dir)}. Switch to ${directionPhrase(
            draft.sort,
            draft.dir === "asc" ? "desc" : "asc"
          )}`}
          onClick={flipDirection}
        >
          <span aria-hidden="true">{draft.dir === "asc" ? "▲" : "▼"}</span>
        </Button>
      </div>

      <ActiveFilters state={draft} preset={activePreset} chips={chips} onChange={apply} onReset={onReset} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-small text-ink-soft">
          {`Found ${productCount(matched.length)}`}
          {matched.length > shown.length ? ` · showing ${shown.length}` : ""}
        </p>
        <div className="flex items-center gap-3">
          <div className="hidden md:block">
            <SegmentedControl
              label="Columns"
              options={columnOptions}
              value={effectiveColumnPreset(draft.cols, availability)}
              onChange={(cols: ColumnPreset) => apply({ ...draft, cols })}
              fullWidthOnPhone={false}
            />
          </div>
          <Button variant="secondary" size="sm" disabled={matched.length === 0} onClick={() => void exportCsv()}>
            Export CSV
          </Button>
        </div>
      </div>

      <div
        aria-busy={isPending || undefined}
        className={`transition-opacity duration-150 motion-reduce:transition-none ${isPending ? "opacity-70" : ""}`}
      >
        {matched.length === 0 ? (
          <NoResults query={draft.q.trim()} onClearFilters={onReset} />
        ) : (
          <>
            {md !== false && (
              <div className="hidden md:block">
                <ScreenerTable
                  rows={shown}
                  columns={columns}
                  sort={draft.sort}
                  dir={draft.dir}
                  onSort={onSort}
                  ctx={ctx}
                  referenceDate={referenceDate}
                  sparklines={sparklines}
                  total={matched.length}
                />
              </div>
            )}
            {md !== true && (
              <div className="md:hidden">
                <ScreenerPhoneList
                  rows={shown}
                  sort={applied.sort}
                  ctx={ctx}
                  referenceDate={referenceDate}
                  sparklines={sparklines}
                />
              </div>
            )}
            {matched.length > shown.length && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <Button variant="secondary" onClick={() => showCount(visibleCount + PAGE_SIZE)}>
                  {`Show ${Math.min(PAGE_SIZE, matched.length - shown.length)} more`}
                </Button>
                <Button variant="ghost" onClick={() => showCount(matched.length)}>
                  {`Show all ${matched.length}`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <p className="text-caption text-ink-soft">
        Returns and changes are on the USD Market Price, so they are the same in both currencies. CAD prices use the
        latest Bank of Canada rate.
      </p>
      <DecisionNote anchor="screens" />

      {sheet === "filters" && (
        <FilterSheet
          state={draft}
          onChange={apply}
          options={options}
          availability={availability}
          resultCount={matched.length}
          onReset={onReset}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "sort" && (
        <SortSheet
          sort={draft.sort}
          availability={availability}
          onSelect={(key) => {
            apply({ ...draft, sort: key, dir: defaultDirectionFor(key) });
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}

      <Suspense fallback={null}>
        <LocationSearchSignal />
      </Suspense>
    </div>
  );
}
```

Notes:
- The header arrow reads `draft` (instant); the rows read `applied` (transition). The table header therefore re-renders urgently, the memoised rows do not.
- If `useCurrency()` names differ (WP20: `currency`, `formatPrice`, `convertPrice`, `exchangeRate`, `exchangeRateDate`), keep the context's names and map them here.
- If soft check (a) found no currency control in the header (WP27 absent), render WP20's shared `CurrencySelector` in the results bar, left of "Export CSV", exactly as `app/portfolio/page.tsx` does after WP20 (`value={currency}`, `onChange={setCurrency}` from `useCurrency()`), and delete it again when WP27 lands (WP27's step 26 lists the pages that lose their selector).
- `LocationSearchSignal` is the only `useSearchParams` caller, inside its own Suspense (WP08). Do not call `useSearchParams` in this component: it would drop the table out of the static HTML.

### Step 20. `app/screener/page.tsx` (new)

```tsx
import type { Metadata } from "next";
import Screener from "../components/Screener/Screener";
import { utcDateKey } from "../components/ProductPrices/utils/freshness";
import AsOf from "../components/ui/AsOf";
import PageHeader from "../components/ui/PageHeader";
import ProvenanceLine from "../components/ui/ProvenanceLine";
import { PROVENANCE_SENTENCE } from "../content/disclosures";
import {
  getCachedMarketProductSummaries,
  getCachedProductStats,
  getCachedSparklines,
  getCachedVolumeMetrics,
} from "../lib/serverMarketData";
import { newestFreshPriceDay } from "./filters";
import { SCREENER_SPARKLINE_PERIOD } from "./metrics";
import { buildScreenerRows } from "./screenerData";

export const metadata: Metadata = {
  title: "Screener",
  description:
    "Rank and filter every tracked sealed Pokémon TCG product by returns, risk, liquidity, supply and MSRP multiple, from daily TCGplayer Market Price data. Share any screen by its URL.",
};

// No segment config: like /market before it, the page is static and
// regenerated through the cached reads' tags (WP11) and the daily backstop.
export default async function ScreenerPage() {
  const [products, stats, volume, sparklines] = await Promise.all([
    getCachedMarketProductSummaries(),
    getCachedProductStats(),
    getCachedVolumeMetrics(),
    getCachedSparklines(SCREENER_SPARKLINE_PERIOD),
  ]);
  const rows = buildScreenerRows(products, stats, volume);
  const referenceDate = utcDateKey();
  const pricesAsOf = newestFreshPriceDay(rows);

  return (
    <main className="mx-auto w-full max-w-[96rem] space-y-4 px-4 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Screener"
        provenance={
          <ProvenanceLine methodologyHref="/methodology#screens">
            {`${rows.length} sealed products. ${PROVENANCE_SENTENCE} `}
            {pricesAsOf && (
              <>
                <AsOf date={pricesAsOf} referenceDate={referenceDate} prefix="Prices as of" />.
              </>
            )}
          </ProvenanceLine>
        }
      />
      <Screener rows={rows} sparklines={sparklines} referenceDate={referenceDate} statsDay={stats.day} />
    </main>
  );
}
```

- Before deleting `app/market/page.tsx` (step 21a), look at what it renders after WP15 and WP24 besides the header and `<MarketView>` (normally the store promotion with its disclosure, `CardRinkPromo`). Copy that element verbatim as the last child of `<main>` here, below the Screener. The promotion never sits between the filters and the results (WP15).
- If `ProvenanceLine` does not accept a `ReactNode` child mix, pass the sentence as its child and put `AsOf` in `PageHeader`'s `provenance` next to it in a fragment; keep the visible text identical.
- The page sends every row (about 306) and the 1Y series map in the RSC payload. Nothing else: no history, no listings, no images.
- `max-w-[96rem]` (1536 px, the width `/compare` uses) lets the Liquidity view fit without a sideways scroll at 1440 px. Do not write `max-w-screen-2xl`: Tailwind 4 does not generate the `max-w-screen-*` utilities.

### Step 21. Move the route: `/market` to `/screener`

21a. Delete `app/market/` (the directory: `page.tsx` and any `loading.tsx`, `error.tsx` or tests in it).

21b. `next.config.ts`: in the array WP13's `redirects()` returns, add one entry after the `/stats` one and change nothing else:

```ts
      // WP33: the screener moved. permanent: true answers 308 (method and
      // body kept); Next passes the query string through to the destination.
      { source: "/market", destination: "/screener", permanent: true },
```

21c. Navigation. With WP27 (soft check (a)): in `app/components/nav/navConfig.ts` change `SCREENER.href` from `"/market"` to `"/screener"` and update the module comment's line "WP33 sets SCREENER.href to "/screener";" to "WP33 moved the Screener to /screener (done);". Keep `match: ["/market", "/screener"]` (a `/market` request is redirected, but the active state stays right during the redirect). Without WP27: in `app/components/Header.tsx` and `app/components/Footer.tsx` change `{ href: "/market", label: "Market View" }` to `{ href: "/screener", label: "Screener" }`.

21d. Every other link. Run from `frontend/`:

```bash
grep -rn '"/market"\|/market"\|/market?' app scripts --include=*.ts --include=*.tsx --include=*.mjs | grep -v "components/MarketView/MiniSparkline"
```

Change each link target to `/screener` (home page buttons if WP32 has not replaced them, `app/components/NotFoundPanel.tsx`, the product page breadcrumb or back link, WP27's search page list if it has a literal). Change a visible label "Market View" next to such a link to "Screener". Update the tests that assert those hrefs (WP13's `NotFoundPanel` test, WP27's `Header`/`Footer`/`navConfig` tests where they expect `/market` as the Screener href; leave tests that only use `/market` as a mocked pathname). The only `/market` strings left afterwards are: the redirect in `next.config.ts`, WP27's `match` array, `REDIRECT_CHECKS` (step 25d), and test fixtures that exercise the redirect.

21e. `app/sitemap.ts`: `{ path: "/market", changeFrequency: "daily", priority: 0.8 }` becomes `{ path: "/screener", changeFrequency: "daily", priority: 0.8 }`.

21f. `app/components/charts/ChartBundle.tsx`: its comment lists `/market` among the routes with Recharts in the eager list; change `/market` to nothing (remove it from the list). Comment only.

### Step 22. Delete the Market View

Delete every file in `app/components/MarketView/` and its `__tests__/` except these, which stay: `MiniSparkline.tsx`, `__tests__/MiniSparkline*.test.tsx` and `__tests__/useProductData.test.tsx` (it tests the `/prices` hook). Expected deletions (whichever exist after WP17, WP19, WP24 and WP26): `MarketView.tsx`, `MarketTableRow.tsx`, `columns.tsx`, `buildRows.ts`, `sorting.ts`, any other component or hook WP19 split out of `MarketView.tsx`, and every other test in `__tests__/` (`columns.test.ts`, `buildRows*.test.ts`, `MarketTableRow.test.tsx`, `MarketView*.test.tsx`, `sorting.test.ts`). Before deleting a file that is not on this list, `grep -rn` its module name in `app/`: if anything outside `MarketView/` imports it, stop and report it. Afterwards `ls app/components/MarketView app/components/MarketView/__tests__` shows only the kept files. Moving `MiniSparkline` out of this folder is out of scope (many importers).

Then confirm nothing imports what was deleted:

```bash
grep -rn "MarketView/\(MarketView\|MarketTableRow\|columns\|buildRows\|sorting\)\|from \"\./\(buildRows\|columns\|MarketTableRow\)\"" app --include=*.ts --include=*.tsx
# expect no output
grep -rln "PRODUCT_VOLATILITY_LOOKBACK_POINTS" app --include=*.ts --include=*.tsx
# expect lib/marketMath.ts, lib/metricDefinitions.ts and the product page; buildRows.ts was one user
```

`ControlBar`'s age-filter props (`selectedAgeFilter`, `ageFilterOptions`, `onAgeFilterChange`) and `AgeFilter.tsx` lose their only user; leave them (optional props, no lint error) and list them as a follow-up in the PR.

### Step 23. `eslint.config.mjs`: the Screener is a public route

In WP26's `PUBLIC_ROUTE_CLIENT_FILES`, replace `"app/market/**/*.{ts,tsx}",` with `"app/screener/**/*.{ts,tsx}",` and add `"app/components/Screener/**/*.{ts,tsx}",` after the `MarketView` entry (keep the `MarketView` entry: `MiniSparkline` still lives there). In `PUBLIC_ROUTE_IMPORT_MESSAGE` replace `/market` with `/screener`. If `scripts/public-route-imports.test.mjs` (WP26) lists `app/market/...` as a probe path, change it to `app/screener/probe.tsx`. Run `pnpm test:scripts`.

### Step 24. Methodology: `#screens` and the 1-year drawdown

24a. `app/content/methodology.ts`:

- Note the current values: `grep -n "METHODOLOGY_VERSION = \|METHODOLOGY_EFFECTIVE_DATE = " app/content/methodology.ts` (call them `PREV_VERSION` and `PREV_DATE`).
- Set `METHODOLOGY_VERSION` to the next minor version above `PREV_VERSION` (for example "1.4" to "1.5") and `METHODOLOGY_EFFECTIVE_DATE` to today (`date -u +%F`).
- In `METHODOLOGY_SECTIONS`, insert directly after the `market-pulse` entry:

```ts
  { anchor: "screens", title: "Screener and screens" },
```

- Append to `METHODOLOGY_SUBSECTIONS` (titles must equal the preset names; a test checks it):

```ts
  { anchor: "screen-off-highs-thin-supply", title: "Off highs with thin supply", parent: "screens" },
  { anchor: "screen-near-msrp", title: "Near MSRP", parent: "screens" },
  { anchor: "screen-supply-draining", title: "Supply draining", parent: "screens" },
  { anchor: "screen-low-vol-compounders", title: "Low-volatility compounders", parent: "screens" },
  { anchor: "screen-distribution-warning", title: "Distribution warning", parent: "screens" },
  { anchor: "screen-below-pack-value", title: "Below pack value", parent: "screens" },
```

- In `METHODOLOGY_CHANGES`, turn the first entry's `version: METHODOLOGY_VERSION, date: METHODOLOGY_EFFECTIVE_DATE` into the literals `version: "<PREV_VERSION>", date: "<PREV_DATE>"` (same summary) and insert above it:

```ts
  {
    version: METHODOLOGY_VERSION,
    date: METHODOLOGY_EFFECTIVE_DATE,
    summary:
      "Adds the Screener and its six screens, and the 1-year maximum drawdown in the daily statistics.",
  },
```

24b. `app/methodology/MethodologyArticle.tsx`:

- Imports (add `Link` from `next/link` if the file does not import it):

```ts
import { describeFilters } from "../screener/filters";
import { directionPhrase, sortFullLabel } from "../screener/metrics";
import { SCREENER_PRESETS, presetHref } from "../screener/presets";
```

- Directly after the `<Section id="market-pulse">...</Section>` element, add:

```tsx
          <Section id="screens">
            <p>
              The Screener ranks every tracked product on Pokéfin&apos;s daily statistics. A filter keeps a product
              only when its value is known and inside the range. Both ends of a range are included, except the price
              band, whose upper end is excluded. A product whose price is withheld (see When we hide a price) shows{" "}
              <code>--</code> in every column, is ranked last and never matches a screen: every screen below
              requires a current price.
            </p>
            <p>
              Returns and changes are on the USD Market Price, so they read the same in both currencies. The Market
              Pulse column uses the 1-month change from the daily statistics. A view, including a screen, is written
              into the page address, so it can be bookmarked or shared. The thresholds below are fixed; changing one
              is a methodology change.
            </p>
            {SCREENER_PRESETS.map((preset) => (
              <Sub key={preset.id} id={preset.anchor}>
                <p>{preset.summary}</p>
                <ul className="ml-5 list-disc space-y-1">
                  {describeFilters(preset.state, new Map()).map((chip) => (
                    <li key={chip.key}>{chip.text}</li>
                  ))}
                  <li>
                    Sorted by {sortFullLabel(preset.state.sort)}, {directionPhrase(preset.state.sort, preset.state.dir)}
                  </li>
                </ul>
                <p>
                  <Link
                    href={presetHref(preset)}
                    prefetch={false}
                    className="font-medium text-action underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
                  >
                    Open this screen
                  </Link>
                </p>
              </Sub>
            ))}
          </Section>
```

- In `<Section id="drawdown">`, append this paragraph at the end:

```tsx
            <p>
              Maximum drawdown (1Y), shown in the Screener and on product pages, uses the first price of each UTC day
              in the 365 days ending at the price shown: the largest fall from a running peak to a later price, as a
              positive percent. It needs at least two priced days and describes recorded history, so it is computed
              even when the current price is withheld; the Screener hides it with the price.
            </p>
```

- In `<Section id="returns">`, if the paragraph WP25 wrote contains "(the catalog and the Market table)", change it to "(the Prices catalog)". Then `grep -n "Market View\|Market table" app/methodology/MethodologyArticle.tsx` and change every remaining mention of the old view to "the Screener".
- Check: `grep -cP '\x{2014}' app/methodology/MethodologyArticle.tsx` prints 0.

24c. The methodology page stays a server component with no `"use client"` (WP24's trust-file test). The three imports are pure modules.

### Step 25. Performance gate, Lighthouse, smoke test and cache warming

25a. `perf-budgets.json`:
- In `routes`, replace the `"/market"` entry with:

```json
    "/screener": {
      "source": "html",
      "jsGzKb": { "target": 165, "limit": null, "recorded": null },
      "documentBrKb": { "target": 60, "limit": null, "recorded": null }
    },
```

- In `rum.targets`, rename the key `"/market"` to `"/screener"` (same values: LCP 2000, INP 150, CLS 0.05, TTFB 400).
- In `forbiddenChunks["supabase-js"].routes` (WP26), replace `"/market"` with `"/screener"`.
- Recharts guard. WP26's `checkForbiddenChunks` iterates every entry of `forbiddenChunks` (`for (const [name, rule] of Object.entries(rules))`) and WP26's `reachabilityControl` already proves `recharts-wrapper` is in a built chunk, so add, next to `"supabase-js"`:

```json
    "recharts": {
      "markers": ["recharts-wrapper"],
      "routes": ["/screener"],
      "reason": "WP33: /screener draws only baked SVG sparklines; no charting library may be reachable (01-PRODUCT-DIRECTION.md section 6.1)."
    }
```

  Confirm with `grep -n "Object.entries(rules)" scripts/perf-measure.mjs` (1 line; WP26 put `checkForbiddenChunks` there and `perf-budget.mjs` calls it). If that grep finds nothing (the script was rewritten), stop and report it rather than skipping the rule.
- Do not run `pnpm perf:budget --write-limits` (it rewrites every route). Set the two `/screener` limits by hand in step 28.

25b. `lighthouserc.json`: in `collect.url` replace `"http://127.0.0.1:3100/market"` with `"http://127.0.0.1:3100/screener"`; in `assertMatrix` change the `/market` entry's `matchingUrlPattern` to `"^http://127\\.0\\.0\\.1:3100/screener$"`, set its `uses-responsive-images` to `["error", { "maxLength": 0 }]` (the Screener loads no product images), and set both `resource-summary` entries back to the placeholder `["warn", { "maxNumericValue": 1, "aggregationMethod": "median" }]` until step 28 calibrates them (a new URL, not a loosened one; WP22 D11). Keep CLS 0.05 and bf-cache as they are.

25c. `scripts/check-public-cache.mjs` (WP26): `grep -n "/market" scripts/check-public-cache.mjs`; replace any hit with `/screener`.

25d. `scripts/prod-smoke-lib.mjs`: in `PUBLIC_CHECKS` replace `{ path: "/market", minPrices: 50 }` with `{ path: "/screener", minPrices: 40 }` (the first page renders 50 rows; 6 fixture-like stale rows print none). Append:

```js
// WP33: old URLs that must keep working (shared links, search results).
export const REDIRECT_CHECKS = [{ from: "/market?sort=r1y&cols=risk", to: "/screener?sort=r1y&cols=risk" }];

/** A permanent redirect to the expected path and query. `location` may be absolute or relative. */
export function judgeRedirect({ from, to, status, location }) {
  let got = null;
  if (location) {
    const target = new URL(location, "https://redirect.invalid");
    got = `${target.pathname}${target.search}`;
  }
  const ok = status === 308 && got === to;
  return {
    name: `${from} -> ${to}`,
    ok,
    detail: ok ? `HTTP 308 to ${got}` : `HTTP ${status}${got ? ` to ${got}` : ", no location"}`,
  };
}
```

25e. `scripts/prod-smoke.mjs`, in `runChecks`, directly after the `for (const check of lib.PUBLIC_CHECKS) { ... }` loop, add:

```js
    for (const redirect of lib.REDIRECT_CHECKS) {
      result.checks.push(
        await withRetry(`${redirect.from} -> ${redirect.to}`, async () => {
          const res = await context.request.get(ORIGIN + redirect.from, { maxRedirects: 0 });
          return lib.judgeRedirect({ ...redirect, status: res.status(), location: res.headers()["location"] ?? null });
        })
      );
    }
```

25f. `revalidate_hook.py` (repo root): in `WARM_PATHS` replace `"/market",` with `"/screener",`, and in the comment above it change the line `# render. WP33 must update "/market" when it moves the screener.` to `# render.` (keep the two lines before it). In `tests/test_revalidate_hook.py`, update any assertion that lists `"/market"` among the warmed paths to `"/screener"`.

### Step 26. Documentation

26a. `README.md` (repo root): in the pages list, replace `/market` (Market View) with `/screener` (Screener: ranked table, filters, six screens, CSV; `/market` redirects). In WP25's "Market analytics tables" subsection add the bullet:

```markdown
- `product_daily_stats.max_dd_365d_pct` (migration 0042, WP33): largest fall
  from a running peak over the first price of each day in the 365 days ending
  at `price_day`. Written by the trigger `product_daily_stats_max_dd` on every
  refresh; not gated on freshness. `backfill_daily_stats.py` fills it for
  rewritten days (a few minutes longer than before).
- Screener screens: `frontend/app/screener/presets.ts`, documented at
  `/methodology#screens`. A threshold change bumps the methodology version.
```

26b. `frontend/README.md`, section "Performance budgets (CI)": where it lists the measured routes, replace `/market` with `/screener`.

26c. `audits/HARDENING_FOLLOWUPS.md` section 7: add as the newest bullet of the migration run (directly above the newest existing "**Migration" bullet):

```markdown
- **Migration 0042: pending apply** (WP33). `product_daily_stats.max_dd_365d_pct`,
  helper `product_max_drawdown_365d(bigint, date)` and trigger
  `product_daily_stats_max_dd` (EXECUTE revoked from PUBLIC, anon,
  authenticated), `product_stats_latest` re-created with the same query.
  Additive; `refresh_market_analytics` is not replaced.
```

26d. `audits/remediation/01-PRODUCT-DIRECTION.md` §8, in the WP33 row of the table, change the Migrations cell from `none` to `0042` and the Effort cell from `L, 14 to 16 h` to `L, 16 to 18 h`, and at the end of the "Migration registry" paragraph add: "WP33 adds 0042 (1-year maximum drawdown), the first number after the registry." No other edit to that file.

### Step 27. Conventions, copy and dead-code checks

```bash
cd /home/user/Pokefin/frontend
pnpm exec jest app/__tests__/uiConventions.test.ts
# If it fails only with "< baseline; lower the baseline" (deleted MarketView files had raw palette classes):
UPDATE_UI_BASELINE=1 pnpm exec jest app/__tests__/uiConventions.test.ts
git diff app/__tests__/uiConventions.baseline.json      # only lowered or removed entries, none raised
pnpm exec jest app/__tests__/uiConventions.test.ts      # passes without the variable
grep -rnE "\b(slate|gray|blue|emerald|green|rose|red|amber)-[0-9]{2,3}\b|#[0-9a-fA-F]{3,8}\b" app/components/Screener app/screener   # no output
grep -rnP '\x{2014}' app/components/Screener app/screener                                               # no output
grep -rniE "\blive\b|real[- ]?time|all[- ]time|undervalued|\bbuy\b" app/components/Screener app/screener   # no output
grep -rn "TCGPlayer" app/components/Screener app/screener                                                   # no output (case-sensitive)
grep -rnE "recharts|ChartBundle|PriceChart|supabase" app/components/Screener app/screener                # no output
grep -rnE "outline-none|transition-colors|transition-all" app/components/Screener app/screener app/components/ui/MetricLabel.tsx app/methodology/MethodologyArticle.tsx   # no output
# Repo-wide: the only /market strings left are the allowed ones (step 21d)
cd /home/user/Pokefin && git grep -nE '"/market|/market"|/market\?' -- ':!audits' ; cd frontend
# expect only: next.config.ts (redirect source), navConfig.ts (match array), prod-smoke-lib.mjs (REDIRECT_CHECKS),
# tests that exercise the redirect or mock a pathname. Anything in .github/, perf-budgets.json, lighthouserc.json,
# revalidate_hook.py, README files or app code is a missed link: fix it.
```

If a new file raised a count, fix the file; never raise the baseline.

### Step 28. Measure, set limits, calibrate

Needs a passing `next build`: run it after step 29, or on the temporary types edit described in "Before you start" (discarded before committing).

28a. `scripts/measure-screener.mjs` (new; manual tool, not run in CI):

```js
/* eslint-disable no-console -- manual measurement tool; console output is its UI. */
// WP33: sort INP (4x CPU) and first-screen rows on /screener, against the perf
// build (SUPABASE_STUB_FIXTURE=perf pnpm build:stub, then node scripts/perf-serve.mjs).
// Needs playwright-core outside the lockfile:
//   npm install --no-save --prefix /tmp/pw playwright-core@1.56
//   PW_DIR=/tmp/pw CHROME_PATH="$(command -v google-chrome || command -v chromium)" node scripts/measure-screener.mjs
// Writes .perf/screener-sort-trace.json (gzip it and attach it to the PR). Exits 1 over budget.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const base = process.argv[2] ?? "http://127.0.0.1:3100";
const requireFromPw = createRequire(path.join(process.env.PW_DIR ?? "/tmp/pw", "node_modules", "noop.js"));
const { chromium } = requireFromPw("playwright-core");

const INP_BUDGET_MS = 150;
const MIN_PHONE_ROWS = 6;

function observe() {
  window.__pfEvents = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.interactionId) window.__pfEvents.push({ id: entry.interactionId, duration: entry.duration });
    }
  }).observe({ type: "event", durationThreshold: 16, buffered: true });
}

async function takeInteractions(page) {
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const byId = new Map();
    for (const e of window.__pfEvents) byId.set(e.id, Math.max(byId.get(e.id) ?? 0, e.duration));
    window.__pfEvents = [];
    return [...byId.values()];
  });
}

fs.mkdirSync(".perf", { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const report = {};

{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/screener`, { waitUntil: "networkidle" });
  await page.waitForSelector("table tbody tr");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(observe);
  await browser.startTracing(page, { path: ".perf/screener-sort-trace.json" });
  const durations = [];
  for (const label of ["7D", "3M", "1Y", "Price", "1M"]) {
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: label, exact: true }).first().click();
      durations.push(...(await takeInteractions(page)));
    }
  }
  await browser.stopTracing();
  report.desktopSortMaxMs = Math.max(...durations);
  report.desktopSortInteractions = durations.length;
  await page.getByRole("button", { name: /^Show all/ }).click();
  report.desktopShowAllMs = Math.max(0, ...(await takeInteractions(page)));
  await context.close();
}

{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${base}/screener`, { waitUntil: "networkidle" });
  await page.waitForSelector('ul[aria-label="Screener results"] li');
  report.phoneFirstScreenRows = await page.evaluate(
    () =>
      [...document.querySelectorAll('ul[aria-label="Screener results"] li')].filter((li) => {
        const r = li.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      }).length
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.getByRole("button", { name: /^Sort: / }).tap();
  await page.getByRole("dialog").waitFor();
  await page.evaluate(observe);
  await page.getByRole("button", { name: "Days of supply", exact: true }).tap();
  report.phoneSortPickMs = Math.max(0, ...(await takeInteractions(page)));
  await context.close();
}

await browser.close();
console.table(report);
const failures = [];
if (report.desktopSortMaxMs > INP_BUDGET_MS) failures.push(`desktop sort ${report.desktopSortMaxMs} ms > ${INP_BUDGET_MS}`);
if (report.phoneSortPickMs > INP_BUDGET_MS) failures.push(`phone sort pick ${report.phoneSortPickMs} ms > ${INP_BUDGET_MS}`);
if (report.phoneFirstScreenRows < MIN_PHONE_ROWS) failures.push(`${report.phoneFirstScreenRows} phone rows < ${MIN_PHONE_ROWS}`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
```

Event Timing reports durations rounded to 8 ms and includes input delay, processing and presentation, which is what INP measures. A click that paints within a frame reports no entry (threshold 16 ms); `Math.max(0, ...)` treats that as 0.

28b. Run, from `frontend/`:

```bash
rm -rf .perf
SUPABASE_STUB_FIXTURE=perf pnpm build:stub > /tmp/wp33-perf-build.log 2>&1; echo "exit=$?"     # exit=0
grep -c "no fixture route" /tmp/wp33-perf-build.log                                             # 0
node scripts/perf-serve.mjs > /tmp/wp33-serve.log 2>&1 &
for i in $(seq 120); do [ -f .perf/ready ] && break; node -e "setTimeout(()=>{},1000)"; done; cat .perf/ready
pnpm perf:budget; echo "exit=$?"
curl -sI "http://127.0.0.1:3100/market?sort=r1y&cols=risk" | grep -iE "^HTTP|^location"
# HTTP/1.1 308 Permanent Redirect
# location: /screener?sort=r1y&cols=risk
npm install --no-save --prefix /tmp/pw playwright-core@1.56
PW_DIR=/tmp/pw CHROME_PATH="$(command -v google-chrome || command -v chromium)" node scripts/measure-screener.mjs; echo "exit=$?"
gzip -kf .perf/screener-sort-trace.json
pkill -f scripts/perf-serve.mjs
```

28c. Limits. Read the `/screener` rows of `pnpm perf:budget` (they print `unset`):
- `jsGzKb`: the measured value must be at most 165. If it is: set `limit` to `min(165, ceil(measured x 1.05))` and `recorded` to the measured value, by hand. If it is above 165, the package is not done: check that `MetricFilterPanel`, `FilterSheet`, `SortSheet` and `exportCsv` are separate chunks (`grep -l "Metric filters" .next/static/chunks/*.js` must not match an initial script of `/screener`), that no chart or Supabase module is reachable, and that `app/components/Screener/*` imports nothing from `ProductPrices/index.tsx`. Never raise the target.
- `documentBrKb`: if the measured value is at most 60, set `limit` and `recorded` the same way. If it is above 60: set `PAGE_SIZE` to 40 in `metrics.ts`, rebuild and measure again; if still above, set `limit = ceil(measured x 1.05)`, leave the target at 60 (the gate then shows "over target"), and write `Perf budget raise: routes./screener.documentBrKb <measured and the reason>` in the PR body.
- Re-run `pnpm perf:budget`: exit 0, every row `ok` or `over target`, the `forbiddenChunks` line reports "supabase-js not reachable" for `/screener`.

28d. Lighthouse (after step 29: CI cannot build the branch before the generated types exist): push the branch; in the CI job summary read the `/screener` row of the Lighthouse table (CLS ≤ 0.05, bf-cache 3/3, 0 oversized images) and set its `resource-summary:script:size` and `resource-summary:image:size` to `["error", { "maxNumericValue": <Suggested limit>, "aggregationMethod": "median" }]` from the summary's "Suggested script limit" and "Suggested image limit" (image: never below 1024). Push again; the Lighthouse step must pass with no placeholder left.

28e. If `measure-screener.mjs` exits 1:
- Desktop sort over 150 ms: open the trace. If each `ScreenerTableRow` renders on a sort, a prop is unstable (check `columns` comes from `columnsFor`, `ctx` from `useMemo`, `sparkline` is a string); if the long task is style and layout, confirm `PAGE_SIZE` rows only are in the DOM and the phone list is unmounted at 1440 (`md === true`).
- Phone pick over 150 ms: the sheet must close in the same handler (it does) and `ScreenerListItem` must be memoised.
- Fewer than 6 phone rows: first check the filter line is one line (36 px) and the Screen select has no separate label; then hide the product count in the provenance below 640 px (`<span className="hidden sm:inline">{rows.length} sealed products. </span>` split out of the template string) and measure again; say so in the PR.

### Step 29. Phase B: generated types

After the owner has applied 0042 (Owner action 1):

```bash
cd /home/user/Pokefin/frontend
SUPABASE_ACCESS_TOKEN=... pnpm types:db          # or use the file the owner pushed
grep -c "max_dd_365d_pct" app/types/database.ts   # at least 2 (table and view)
pnpm exec tsc --noEmit                            # exit 0
```

Do not edit the generated file. Then mark the PR ready for review and remove `[waiting for DB types]` from its title.

## Pitfalls: do not do this

- **Do not fetch history or sparklines on the client.** No `useProductData`, `ensureHistoryLoaded`, `useSparklines`, `/api/public/*` call or `PriceChart` in the Screener tree. The 1Y series is in the page props; the product page owns the chart.
- **Do not compute max drawdown, volatility or any window metric in the page or the browser.** Read `product_daily_stats` columns. If a metric is missing there, it needs a migration, not a per-request loop over history.
- **Do not replace `refresh_market_analytics` or `refresh_product_daily_stats` in 0042.** The trigger exists so the function chain 0033, 0034, 0036, 0037 stays untouched. Do not re-run 0033 or 0036 after 0042 either (WP25/WP28 pitfalls): re-run only the newest file that defines a function.
- **Do not gate `max_dd_365d_pct` in SQL.** It is a series column (0023 split). The Screener hides it for withheld rows in `buildScreenerRows`.
- **Do not pass the rank, a per-render array or an inline object as a row prop.** The rank is a CSS counter; `columns` comes from `columnsFor`; `ctx` is memoised; the sparkline is a string. Any unstable prop re-renders all 50 rows on every sort and breaks the INP budget.
- **Do not derive the visible columns from `draft`.** Columns follow `applied`; otherwise a click re-renders every row urgently.
- **Do not call `useSearchParams` in the container**, and do not write the URL on mount or on a URL re-seed (WP08). `LocationSearchSignal` in its own Suspense is the only reader.
- **Do not add Suspense boundaries around row chunks** (WP26: position-keyed boundaries remount rows on each sort).
- **Do not render the desktop table in a scroll box on phones** or keep both layouts mounted after hydration.
- **Do not use radio inputs with apply-on-change in the sort sheet**: arrow keys would apply and close it on the first press.
- **Do not change a preset threshold to make a test pass.** The fixture test re-states the thresholds on purpose. A threshold change is a methodology change with a version bump.
- **Do not export stale values, price history or listings in the CSV**, and do not export only the rendered 50 rows: the CSV is every matching row, visible columns only (D8).
- **Do not keep `app/market/page.tsx`** next to the redirect (redirects run first and the page would be dead code), and do not use a 307 (`permanent: false`): shared links and search results must transfer.
- **Do not run `pnpm perf:budget --write-limits`**, and never raise the `/screener` JS target of 165 kB.
- **Do not use raw palette classes, hex values, `text-muted`, "live", "real-time", "all-time", "undervalued", "buy" or em dashes** in any new file (WP23/WP24 conventions). Preset names are fixed as written in D4.
- **Do not change `MetricLabel`'s rendered output** when extracting `MetricHelpLink`; WP24's test must pass unchanged.
- **Do not write `focus-visible:outline-none` or `transition-colors`** in any new or edited file. Use `focus-visible:outline-hidden` (Tailwind 4: `outline-none` hides focus in forced-colours mode; WP24's trust test fails on it in `MetricLabel.tsx` and `MethodologyArticle.tsx`), and keep colour changes instant (01-PRODUCT-DIRECTION.md §3.5).
- **Do not use `border-collapse` on the table or put row borders on `<tr>`.** Collapsed borders do not move with sticky cells, so the Product divider and row rules would slide off the pinned columns; the table is `border-separate border-spacing-0` with borders on the cells (step 16).
- **Do not use the `AsOf` table variant in the phone list.** Its clock has only a tooltip, which never shows on touch; phone rows print "Last priced {date}" (step 17).
- **Do not edit `ControlBar.tsx`, `ProductPrices/index.tsx` or `MiniSparkline.tsx`.** `/prices` is out of scope; this package only reuses WP30's helpers.

## Tests

Run the frontend tests from `frontend/`, the Python tests from the repo root. Test files under `app/screener/__tests__/` are `@jest-environment node` unless they render React.

### 1. `tests/test_wp33_max_drawdown_db.py` (new, needs the replayed database)

```python
"""
Database checks for migration 0042 (product_daily_stats.max_dd_365d_pct,
WP33), run against a database rebuilt by scripts/db/replay_migrations.sh.

Skipped unless POKEFIN_TEST_DATABASE_URL points at that replayed database as a
superuser (CI sets it; job "Database replay and Python tests"). NEVER point it
at production: the fixtures write rows.

  POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once \
    python -m pytest tests/test_wp33_max_drawdown_db.py -v
"""
import os
import uuid
from datetime import timedelta
from urllib.parse import urlparse

import pytest

DSN = os.environ.get("POKEFIN_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="POKEFIN_TEST_DATABASE_URL not set")

psycopg = pytest.importorskip("psycopg")

TAG = "wp33-" + uuid.uuid4().hex[:8]


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
    set_id = admin.execute(
        "INSERT INTO public.sets (code, name) VALUES (%s, %s) RETURNING id", (TAG, TAG + " set")
    ).fetchone()[0]
    type_id = admin.execute(
        "INSERT INTO public.product_types (name, label) VALUES (%s, 'WP33') RETURNING id", (TAG,)
    ).fetchone()[0]
    yield {"set_id": set_id, "type": type_id}
    admin.execute(
        "DELETE FROM public.product_price_history WHERE product_id IN "
        "(SELECT id FROM public.products WHERE set_id = %s)", (set_id,))
    admin.execute("DELETE FROM public.products WHERE set_id = %s", (set_id,))  # stats rows cascade
    admin.execute("DELETE FROM public.product_types WHERE id = %s", (type_id,))
    admin.execute("DELETE FROM public.sets WHERE id = %s", (set_id,))


def make_product(admin, catalog, rows):
    """rows: [(day, usd, hour)]. products.usd_price = the newest row's price, so the price is fresh when recent."""
    newest = max(rows, key=lambda r: (r[0], r[2]))[1]
    pid = admin.execute(
        "INSERT INTO public.products (set_id, product_type_id, usd_price, url, last_updated) "
        "VALUES (%s, %s, %s, %s, now()) RETURNING id",
        (catalog["set_id"], catalog["type"], newest,
         f"https://www.tcgplayer.com/product/{uuid.uuid4().int % 10**9}"),
    ).fetchone()[0]
    for day, usd, hour in rows:
        admin.execute(
            "INSERT INTO public.product_price_history (product_id, usd_price, recorded_at) "
            "VALUES (%s, %s, %s::timestamp + make_interval(hours => %s))",
            (pid, usd, day, hour),
        )
    return pid


def refresh(admin, day):
    admin.execute("SELECT public.refresh_market_analytics(%s)", (day,))


def max_dd(admin, day, pid):
    row = admin.execute(
        "SELECT max_dd_365d_pct FROM public.product_daily_stats WHERE day = %s AND product_id = %s", (day, pid)
    ).fetchone()
    return row[0] if row else "no row"


def d(today, offset):
    return today - timedelta(days=offset)


def test_peak_to_later_low(admin, catalog, today):
    pid = make_product(admin, catalog, [(d(today, 10), 100, 3), (d(today, 8), 120, 3), (d(today, 6), 90, 3),
                                        (d(today, 4), 110, 3), (d(today, 1), 115, 3)])
    refresh(admin, today)
    assert max_dd(admin, today, pid) == pytest.approx(25.0)   # 120 -> 90


def test_rising_prices_give_zero(admin, catalog, today):
    pid = make_product(admin, catalog, [(d(today, 5), 100, 3), (d(today, 3), 110, 3), (d(today, 1), 120, 3)])
    refresh(admin, today)
    assert max_dd(admin, today, pid) == pytest.approx(0.0)


def test_one_priced_day_gives_null(admin, catalog, today):
    pid = make_product(admin, catalog, [(d(today, 1), 50, 3)])
    refresh(admin, today)
    assert max_dd(admin, today, pid) is None


def test_window_is_the_365_days_ending_at_the_price_day(admin, catalog, today):
    pid = make_product(admin, catalog, [(d(today, 400), 200, 3), (d(today, 300), 100, 3), (d(today, 1), 90, 3)])
    refresh(admin, today)
    assert max_dd(admin, today, pid) == pytest.approx(10.0)   # the 200 is outside the window


def test_past_day_refresh_uses_that_days_window(admin, catalog, today):
    # The nightly D-1 job and backfill_daily_stats.py rebuild past days: the
    # window ends at that day's price_day, so later prices never leak in.
    # (One row per product per day: 0003's unique index on (product_id,
    # recorded_at::date) makes a second same-day row impossible, so the
    # helper's DISTINCT ON is only a guard.)
    pid = make_product(admin, catalog, [(d(today, 10), 100, 3), (d(today, 8), 120, 3), (d(today, 6), 90, 3),
                                        (d(today, 2), 60, 3)])
    refresh(admin, d(today, 5))
    assert max_dd(admin, d(today, 5), pid) == pytest.approx(25.0)   # 120 -> 90; the 60 comes after day -5
    refresh(admin, today)
    assert max_dd(admin, today, pid) == pytest.approx(50.0)         # 120 -> 60


def test_withheld_price_keeps_the_series_value(admin, catalog, today):
    pid = make_product(admin, catalog, [(d(today, 40), 100, 3), (d(today, 20), 80, 3)])
    refresh(admin, today)
    fresh = admin.execute(
        "SELECT is_price_fresh FROM public.product_daily_stats WHERE day = %s AND product_id = %s", (today, pid)
    ).fetchone()[0]
    assert fresh is False
    assert max_dd(admin, today, pid) == pytest.approx(20.0)   # window ends at price_day, not gated


def test_only_price_columns_fire_the_trigger(admin, catalog, today):
    pid = make_product(admin, catalog, [(d(today, 6), 100, 3), (d(today, 2), 75, 3)])
    refresh(admin, today)
    where = "WHERE day = %s AND product_id = %s"
    admin.execute(f"UPDATE public.product_daily_stats SET max_dd_365d_pct = 99 {where}", (today, pid))
    admin.execute(f"UPDATE public.product_daily_stats SET liquidity_score = liquidity_score {where}", (today, pid))
    assert max_dd(admin, today, pid) == pytest.approx(99.0)   # not in UPDATE OF: untouched
    admin.execute(f"UPDATE public.product_daily_stats SET price_day = price_day {where}", (today, pid))
    assert max_dd(admin, today, pid) == pytest.approx(25.0)   # recomputed


def test_refresh_is_idempotent(admin, catalog, today):
    pid = make_product(admin, catalog, [(d(today, 9), 100, 3), (d(today, 7), 70, 3), (d(today, 1), 90, 3)])
    refresh(admin, today)
    first = max_dd(admin, today, pid)
    refresh(admin, today)
    assert max_dd(admin, today, pid) == pytest.approx(first) == pytest.approx(30.0)


def test_view_and_privileges(admin):
    cols = [r[0] for r in admin.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = 'product_stats_latest'").fetchall()]
    assert "max_dd_365d_pct" in cols
    ok = admin.execute(
        "SELECT has_column_privilege('anon', 'public.product_stats_latest', 'max_dd_365d_pct', 'SELECT'), "
        "has_function_privilege('anon', 'public.product_max_drawdown_365d(bigint, date)', 'EXECUTE'), "
        "has_function_privilege('authenticated', 'public.product_max_drawdown_365d(bigint, date)', 'EXECUTE')"
    ).fetchone()
    assert ok == (True, False, False)
    admin.execute("SET ROLE anon")
    try:
        admin.execute("SELECT max_dd_365d_pct FROM public.product_stats_latest LIMIT 1").fetchall()
    finally:
        admin.execute("RESET ROLE")
```

If `products` has another NOT NULL column without a default in the replayed schema, copy WP25's `make_product` column list (it is the reference for this schema).

### 2. `app/screener/__tests__/urlState.test.ts` (new)

- `parseScreenerQuery("")` equals `SCREENER_DEFAULTS`; `serializeScreenerState(SCREENER_DEFAULTS)` is `""`.
- Round trip: for each of these queries `serializeScreenerState(parseScreenerQuery(q))` equals `q`: `"sort=r3m"`, `"sort=r3m&dir=asc"`, `"rw=3m&rmin=5"`, `"offmax=-20&dosmax=30&priced=1&sort=off&cols=risk"`, `"q=evolving&type=Booster+Box&gen=Sword+%26+Shield&set=9101&pmin=50&pmax=150&sig=distribution"`.
- Order: `parseScreenerQuery("cols=risk&sort=vol&q=x")` serializes to `"q=x&sort=vol&cols=risk"`.
- Defaults omitted: `"sort=r1m&dir=desc&cols=performance&rw=1y"` serializes to `""`; `"sort=vol&dir=asc"` to `"sort=vol"` (asc is vol's start).
- `rw` without a return range is dropped: `"rw=3m"` serializes to `""`.
- Invalid values fall back: `sort=bogus` gives `r1m`; `dir=up` gives the sort's start; `cols=x` gives `performance`; `sig=hot` gives null; `set=-3` and `set=1.5` give null; `volmax=abc` gives null; `priced=true` gives false.
- `q` longer than 100 characters is cut to 100.
- `filterQuery` ignores sort, dir and cols: `filterQuery(parse("offmax=-20&sort=vol&cols=liquidity"))` equals `filterQuery(parse("offmax=-20"))`.
- `resetFilters` keeps sort, dir and cols and clears everything else.
- `SCREENER_URL_KEYS` has 32 entries, no duplicates, and every key `serializeScreenerState` can write is in it (serialize a state with every field set and check each key of the result).

### 3. `app/screener/__tests__/filters.test.ts` (new)

A `row(overrides)` factory returning a full fresh `ScreenerRow` (all metrics set to mid values, `priceDay: "2026-09-29"`; put it in `frontend/test-utils/screenerRows.ts` and import it as `@/test-utils/screenerRows`, so tests 7 and 8 reuse it; not under `__tests__/`, where Jest's default `testMatch` would run it as an empty suite). Cases:
- Ranges: min and max inclusive (`volmax=15` keeps 15, drops 15.01); an active range drops a row whose value is null; an inactive range keeps it.
- Price band: `pmin=50&pmax=150` keeps 50 and 149.99, drops 150 and a null price.
- `priced` drops a row with `fresh: false`; without it the stale row stays and sorts last in both directions for `r1m`, `vol` and `price`.
- Return window: `rw=3m&rmin=5` filters on `r3m`, not `r1y`.
- `sig`, `type`, `gen`, `set` exact matches; `q` matches set name, set code, type label, type name and variant case-insensitively, and ignores surrounding spaces.
- `sortRows` by `name` is A to Z on "{type} {set} {variant}"; equal values keep input order (stable) in both directions.
- `visibleColumnIds`: default gives `["r7d","r1m","r3m","r1y","signal"]`; `cols=risk&dosmax=30` gives `["vol","dd","off","r1y","dos"]`; `sort=liq` on Performance appends `"liq"`; `cols=value` without value data gives the Performance list.
- `describeFilters` texts: `"Current price only"`, `"From 52-week high at most -20%"`, `"Days of supply at most 30 days"`, `"1Y return at least 10%"`, `"x MSRP at most 1.25x"`, `"Liquidity (percentile) between 40 and 80"`, `"Price: US$50 to US$150"`, `"Market Pulse: Distribution"`, `"Set: Evolving Skies (EVS)"` (with a set-name map); each chip's `clear` removes only its own filter.
- `filterOptions`: types A to Z; eras and sets newest release first; set labels "Name (CODE)".
- `priceBandValue`: `(null, 50)` is `"under-50"`, `(null, null)` is `""`, `(10, 20)` is `"custom"`.

### 4. `app/screener/__tests__/screenerData.test.ts` (new)

Build `Product` objects (the shape `mapMarketSummaryRowToProduct` returns) and `ProductDailyStats` rows by hand:
- Fresh product with stats: every field maps as D2 says; `off` is `round2((usd / high_52w - 1) * 100)`; `signal` is `getPulseSignal(r1m, vtrend)`; values are rounded to 2 decimals.
- Stale in the catalog (`usd_price` null) or `is_price_fresh` false in stats: `fresh` false, every metric null, `priceDay` kept.
- No stats row: price and returns from the catalog summary (`returns["1M"]` and so on), `units` from volume, `vol`, `dd`, `off`, `st`, `dos`, `sc30`, `liq`, `msrp`, `cpp`, `prem` null.
- Stats row without WP28 fields (`msrp_multiple` undefined): `msrp`, `cpp`, `prem` null, no throw.
- Order: newer set release first, then type label, then id; a null release last.
- `setCode` "N/A" becomes null; a blank variant becomes null.

### 5. `app/screener/__tests__/presets.fixture.test.ts` (new): one test per preset on the WP22 perf fixture

```ts
/**
 * @jest-environment node
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { mapMarketSummaryRowToProduct, type MarketSummaryRow } from "../../lib/marketData";
import { toProductStatsSnapshot, type ProductDailyStatsRow } from "../../lib/marketStats";
import { applyScreen } from "../filters";
import { metricAvailability } from "../metrics";
import { SCREENER_PRESETS, availablePresets, type PresetId } from "../presets";
import { buildScreenerRows, round2 } from "../screenerData";

// The fixture module uses import.meta, which Jest's CommonJS transform cannot
// load, so a child Node process builds it (WP26 uses the same node -e call).
const FRONTEND = path.resolve(__dirname, "../../..");
type StatsRow = Record<string, unknown> & { product_id: number };
type VolumeRow = { product_id: number; units_sold_30d: number; units_sold_prior_30d: number };
interface Fixture {
  summaries: MarketSummaryRow[];
  productStats: StatsRow[];
  volume: VolumeRow[];
  staleIds: number[];
}

function loadFixture(): Fixture {
  const script =
    'import("./scripts/fixtures/perf.mjs").then((m) => { const d = m.buildPerfData({ baseUrl: "http://127.0.0.1:3100" });' +
    " process.stdout.write(JSON.stringify({ summaries: d.summaries, productStats: d.productStats, volume: d.volume, staleIds: m.PERF_STALE_IDS })); });";
  const out = execFileSync(process.execPath, ["-e", script], { cwd: FRONTEND, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out) as Fixture;
}

const fixture = loadFixture();
const products = fixture.summaries.map((row) => mapMarketSummaryRowToProduct(row));
const stats = toProductStatsSnapshot(fixture.productStats as unknown as ProductDailyStatsRow[]);
const volume = Object.fromEntries(fixture.volume.map((v) => [v.product_id, v]));
const rows = buildScreenerRows(products, stats, volume);
const offered = new Set(availablePresets(metricAvailability(rows)).map((p) => p.id));

function run(id: PresetId): number[] {
  const preset = SCREENER_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(id);
  return applyScreen(rows, preset.state).map((r) => r.id).sort((a, b) => a - b);
}

// The oracle re-states each rule on the raw fixture rows, independently of
// the screener modules (thresholds written out as numbers on purpose).
const summaryById = new Map(fixture.summaries.map((s) => [s.id, s]));
const volumeById = new Map(fixture.volume.map((v) => [v.product_id, v]));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const le = (v: number | null, max: number) => v !== null && v <= max;
const ge = (v: number | null, min: number) => v !== null && v >= min;
function fresh(s: StatsRow): boolean {
  return summaryById.get(s.product_id)?.usd_price != null && s.is_price_fresh === true && num(s.usd_price) !== null;
}
function oracle(rule: (s: StatsRow) => boolean): number[] {
  return fixture.productStats.filter((s) => fresh(s) && rule(s)).map((s) => s.product_id).sort((a, b) => a - b);
}
const hasAny = (column: string) => fixture.productStats.some((s) => num(s[column]) !== null);

describe("screener presets on the WP22 perf fixture", () => {
  it("Off highs with thin supply", () => {
    const expected = oracle((s) => {
      const high = num(s.high_52w);
      const off = high !== null && high > 0 ? round2(((s.usd_price as number) / high - 1) * 100) : null;
      return le(off, -20) && le(round2(num(s.days_of_supply)), 30);
    });
    expect(expected.length).toBeGreaterThan(0);
    expect(run("off-highs-thin-supply")).toEqual(expected);
  });

  it("Near MSRP", () => {
    if (!hasAny("msrp_multiple")) {
      expect(offered.has("near-msrp")).toBe(false);
      return;
    }
    const expected = oracle((s) => le(round2(num(s.msrp_multiple)), 1.25));
    expect(expected.length).toBeGreaterThan(0);
    expect(run("near-msrp")).toEqual(expected);
  });

  it("Supply draining", () => {
    const expected = oracle((s) => le(round2(num(s.qty_change_30d_pct)), -15) && ge(round2(num(s.sell_through_30d)), 20));
    expect(expected.length).toBeGreaterThan(0);
    expect(run("supply-draining")).toEqual(expected);
  });

  it("Low-volatility compounders", () => {
    const expected = oracle(
      (s) =>
        ge(round2(num(s.ret_365d)), 10) &&
        le(round2(num(s.vol_weekly_52w)), 15) &&
        le(round2(num(s.max_dd_365d_pct)), 15)
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(run("low-vol-compounders")).toEqual(expected);
  });

  it("Distribution warning", () => {
    const expected = oracle((s) => {
      const v = volumeById.get(s.product_id);
      if (!v || !(v.units_sold_prior_30d > 0)) return false;
      const trend = round2(((v.units_sold_30d - v.units_sold_prior_30d) / v.units_sold_prior_30d) * 100);
      return le(round2(num(s.ret_30d)), -2) && ge(trend, 20);
    });
    expect(expected.length).toBeGreaterThan(0);
    expect(run("distribution-warning")).toEqual(expected);
  });

  it("Below pack value", () => {
    // WP28's fixture has no booster pack type, so no NAV and no premium: the preset is not offered.
    if (!hasAny("premium_to_packs_pct")) {
      expect(offered.has("below-pack-value")).toBe(false);
      expect(run("below-pack-value")).toEqual([]);
      return;
    }
    expect(run("below-pack-value")).toEqual(oracle((s) => le(round2(num(s.premium_to_packs_pct)), -1)));
  });

  it("never returns a product whose price is withheld", () => {
    for (const preset of SCREENER_PRESETS) {
      const ids = applyScreen(rows, preset.state).map((r) => r.id);
      expect(ids.filter((id) => fixture.staleIds.includes(id))).toEqual([]);
    }
  });

  it("shows -- for every metric of a withheld product", () => {
    for (const id of fixture.staleIds) {
      const row = rows.find((r) => r.id === id);
      expect(row?.fresh).toBe(false);
      expect([row?.price, row?.r1m, row?.vol, row?.dd, row?.off, row?.dos, row?.liq]).toEqual([null, null, null, null, null, null, null]);
    }
  });
});
```

If `mapMarketSummaryRowToProduct` takes more arguments after WP10/WP11, call it the way `fetchMarketProductSummaries` in `serverMarketData.ts` does. If a preset other than "Near MSRP" and "Below pack value" matches no fixture product (the oracle's `toBeGreaterThan(0)` fails), do not change a threshold: for "Low-volatility compounders" only, set WP33's own `max_dd_365d_pct` (step 4a) to 5 for up to three fixture products that already meet the other two rules, and say so in the PR; for any other preset, stop and report it.

### 6. `app/screener/__tests__/presets.test.ts` (new)

- Every preset has `state.priced === true`, a unique id and a unique anchor; `serializeScreenerState(p.state)` round-trips through `parseScreenerQuery`.
- Drift with the methodology: for every preset, `METHODOLOGY_SUBSECTIONS` has an entry with `anchor === preset.anchor`, `parent === "screens"` and `title === preset.name`; `METHODOLOGY_SECTIONS` contains `"screens"`.
- `matchingPreset(p.state)` returns `p` for every preset; it still returns `p` with a different sort, direction or columns; it returns null after one extra filter.
- `availablePresets` with every metric available returns all six; with `msrp` and `prem` unavailable it returns the four others; with `dd` unavailable it drops "Low-volatility compounders".
- `presetHref` of "Off highs with thin supply" equals `"/screener?offmax=-20&dosmax=30&priced=1&sort=off&cols=risk"` (`dir` is omitted because `asc` is `off`'s starting direction), and of "Low-volatility compounders" equals `"/screener?rmin=10&volmax=15&ddmax=15&priced=1&sort=r1y&cols=risk"`.
- `PRESET_RULES` values equal the numbers in D4 (this is the second, deliberate copy of the thresholds).

### 7. `app/screener/__tests__/exportCsv.test.ts` (new)

- Header row: the nine base headers, then `"{label} (%)"`, `"(x)"`, `"(days)"`, `"(CAD)"` forms for the given column ids; `price` in `columnIds` does not add a second price column.
- A fresh row: values with the D8 precision; `Price status` "current"; money converted with the passed `convertPrice` (use `(v) => v === null || v === undefined ? null : v * 1.37`).
- A withheld row: empty price, "withheld", empty metric cells.
- Text safety: a variant `=HYPERLINK("x")` becomes `"'=HYPERLINK(""x"")"`; a set name with a comma is quoted.
- The last line starts with `Source: Pokéfin (` and contains the page URL, the stats day, `DECISION_NOTE`, and "USD converted to CAD at 1.3700" only when the currency is CAD (exchangeRate 1.37).
- Lines end with `\r\n`; there is exactly one empty line before the attribution line.
- `csvFilename("2026-09-29")` is `"pokefin-screener-2026-09-29.csv"`.

### 8. `app/components/Screener/__tests__/Screener.test.tsx` (new, jsdom, fake timers)

Mocks: `next/navigation` (`useRouter` with `prefetch: jest.fn()`, `useSearchParams` returning `new URLSearchParams()`, `usePathname` returning `"/screener"`); `../../LocationSearchSignal` returning `null`; `../../../context/CurrencyContext` with `useCurrency` returning `{ currency: "USD", formatPrice: (v) => (v == null ? "--" : "$" + Number(v).toFixed(2)), convertPrice: (v) => v ?? null, exchangeRate: 1.37, exchangeRateDate: "2026-09-29" }`; `window.matchMedia` stubbed per test (`matches: true` for desktop). Rows: 60 synthetic `ScreenerRow`s (the factory from test 3) with distinct `r1m`, plus 1 withheld row (`fresh: false`, every metric null, `priceDay: "2026-08-01"`); render with `referenceDate="2026-09-29"` and `statsDay="2026-09-29"`. Before each test `window.history.replaceState(null, "", "/screener")`.

- Desktop default: one `table`; 50 body rows; the first row's link is the product with the highest `r1m`; the `1M` header cell has `aria-sort="descending"` and its button shows "▼"; "Found 61 products · showing 50" is in the status; the withheld row is not in the first 50.
- Sort: click the `3M` header button; after `act(() => jest.runAllTimers())`, `aria-sort` moved to 3M, the rows are ordered by `r3m` descending, and `window.location.search` is `"?sort=r3m"`. Click it again: ascending, URL `"?sort=r3m&dir=asc"`.
- Rows do not re-render on a sort: wrap `ScreenerTableRow` with a render counter through `jest.mock("../ScreenerTableRow", ...)` that re-exports the real component inside a spy `memo`; sorting after the first render adds 0 renders for rows present in both orders. (If mocking the default export this way is awkward, assert instead that `columnsFor` returns the same array for the same ids and that the row props are referentially equal across the two renders by capturing them in the spy.)
- Show more: click "Show 11 more": 61 rows; the withheld row is last and shows `--` in every metric cell with the sr-only text "Price withheld".
- Preset: click "Low-volatility compounders": the button has `aria-pressed="true"`, "Screen: Low-volatility compounders" and the chips "Current price only", "1Y return at least 10%" are shown, the `Volatility 1Y` header exists, and every rendered row satisfies the rules; the URL (after timers) equals `presetHref(...)` without the `/screener` prefix.
- Chip removal: click the "1Y return at least 10%, remove filter" button: the preset is no longer pressed and the chip is gone.
- Columns: choose "Liquidity" in the Columns radio group: the headers `Sold 30D`, `Volume trend`, `Sell-through`, `Days supply`, `Supply 30D`, `Liquidity` appear in that order; URL has `cols=liquidity`.
- No results: type "zzzz" in Search: `NoResults` text "No products match “zzzz”" and "Clear filters" restores 50 rows.
- Seed from the URL on a client mount: set `window.history.replaceState(null, "", "/screener?sort=vol&cols=risk")` before rendering: the `Volatility 1Y` header has `aria-sort="ascending"` on the first render and nothing is written to the URL.
- Phone: `matchMedia` false: no `table`; a list named "Screener results" with 50 items; a row's text contains "sold 30D"; the "Sort: 1M change" and "Filters" buttons exist; with the sort set to `dos` (URL seed `?sort=dos`), row meta reads "{n} days of supply".
- Stats unavailable (`statsDay={null}`): the warn sentence is shown.
- axe: `import { axeViolations } from "@/test-utils/axe";` (WP23) and `expect(await axeViolations(container)).toEqual([])` on the desktop render and on the phone render.
- Phone staleness: a fresh row whose `priceDay` is 3 days before `referenceDate` shows the visible text "Last priced {Mon D}" in its list item (not only a `title`), and the withheld row shows "Last priced" with its own date.
- Counts: with one matching row the status reads "Found 1 product" (`productCount`).

### 9. `app/components/Screener/__tests__/sheets.test.tsx` (new, jsdom)

Render `FilterSheet` and `SortSheet` directly (no dynamic import). WP14's jsdom `<dialog>` polyfill applies.
- `SortSheet`: the dialog is named "Sort by"; the current key's button has `aria-pressed="true"`; clicking "Days of supply" calls `onSelect("dos")` once; Value keys are absent when `availability.msrp`, `cpp` and `prem` are false; Escape calls `onClose`.
- `FilterSheet`: typing "-2" then "0" in "Min, From 52-week high" commits `-2` then `-20` (the `-` alone commits nothing and the input has `aria-invalid="true"`); "Reset" calls `onReset`; the footer button reads "Show 12 products" for `resultCount={12}`; Value fields are absent without value data.
- `NumberInput` external change: re-render with `value={null}` after typing "15": the input clears.

### 10. Updates to existing tests

- `app/components/ui/__tests__/MetricLabel.test.tsx` (WP24): passes unchanged; add one case: `render(<MetricHelpLink metric="daysOfSupply" />)` has one link to `/methodology#supply`, named "How Days of supply is calculated", with `title` equal to the definition's `short`, and no label text.
- `app/lib/__tests__/metricDefinitions.test.ts` (WP24): passes unchanged (it checks every definition's anchor and length, now including `fromHigh52w`).
- `app/methodology/__tests__/MethodologyArticle.test.tsx`: add: the `#screens` section has six `h3`s with the preset names and each has an "Open this screen" link equal to `presetHref(preset)`; the version and change-log assertions use the new version.
- `app/lib/__tests__/serverMarketData.stats.test.ts` (WP25): the select string contains `max_dd_365d_pct`.
- `scripts/perf-fixture.test.mjs`: step 4b's test.
- `scripts/prod-smoke-lib.test.mjs`: `judgeRedirect` passes for `{ status: 308, location: "/screener?sort=r1y&cols=risk" }` and for the absolute `https://pokefin.ca/screener?sort=r1y&cols=risk`; fails for 307, for 200 with no location, and for a location without the query. `PUBLIC_CHECKS` contains `/screener` and not `/market`.
- `tests/test_revalidate_hook.py`: `"/screener" in WARM_PATHS` and `"/market" not in WARM_PATHS`.
- Tests removed with the Market View (step 22) are not replaced one for one: tests 3, 5 and 8 cover the new table.

## Verification

From `frontend/` unless stated. Phase A expects exactly one `tsc` error (the `max_dd_365d_pct` select, step 29).

```bash
pnpm exec tsc --noEmit                                   # phase A: only the max_dd_365d_pct select error; phase B: exit 0
pnpm lint                                                # 0 errors, 0 new warnings
pnpm exec jest app/screener app/components/Screener app/components/ui/__tests__/MetricLabel.test.tsx \
  app/methodology app/lib/__tests__/metricDefinitions.test.ts app/lib/__tests__/serverMarketData.stats.test.ts \
  app/__tests__/uiConventions.test.ts                   # all pass
pnpm test --ci                                           # all pass; count = baseline - deleted MarketView tests + new tests
pnpm test:scripts                                        # all pass (fixture, smoke lib, public-route imports)
pnpm build:stub; echo "exit=$?"                          # phase B (or the temporary types edit): exit 0; the route list shows ○ /screener and no /market page
# The default stub has no products (the page renders its EmptyState). Check the HTML on the perf fixture:
SUPABASE_STUB_FIXTURE=perf pnpm build:stub > /tmp/wp33-perf-build.log 2>&1; echo "exit=$?"   # exit 0
grep -c "BAILOUT_TO_CLIENT_SIDE_RENDERING" .next/server/app/screener.html   # at most 1 (the empty LocationSearchSignal leaf)
grep -o "<tr" .next/server/app/screener.html | wc -l      # 51 (header + 50 rows)
grep -c 'aria-label="Screener results"' .next/server/app/screener.html      # 1
grep -c "recharts\|GoTrueClient" .next/server/app/screener.html            # 0
```

Repo root, database (after `bash scripts/db/replay_migrations.sh`):

```bash
POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once python -m pytest \
  tests/test_wp33_max_drawdown_db.py tests/test_wp25_market_analytics_db.py -q     # all pass
python -m pytest tests/test_revalidate_hook.py tests/test_migration_volatility.py -q   # all pass (WP01's check: the
#   STABLE helper writes nothing; the trigger function is VOLATILE)
bash scripts/db/replay_migrations.sh                                                # replay_once and replay_twice, exit 0
```

Performance (step 28): `pnpm perf:budget` exit 0 with `/screener` JS ≤ 165 kB gz and document ≤ 60 kB br (or the stated raise), supabase-js not reachable; `measure-screener.mjs` exit 0 (desktop sort ≤ 150 ms, phone pick ≤ 150 ms, ≥ 6 phone rows); `curl -sI .../market?sort=r1y&cols=risk` shows 308 and `location: /screener?sort=r1y&cols=risk`; Lighthouse `/screener` CLS ≤ 0.05, bf-cache pass, no placeholder threshold left.

Manual, on the perf server (`node scripts/perf-serve.mjs`, `http://127.0.0.1:3100`):

1. 1440 x 900: `/screener` opens on Performance, 1M ▼ bold; 44 px rows (DevTools: row height 44); the product name is one line; `?` beside every metric header opens its methodology anchor; no network request after load (Network panel, filter Fetch/XHR: empty); scrolling the table to the bottom and clicking "Show all 306" renders 306 rows with the six withheld ones last.
2. Click each Screens button: rows, chips, pressed state and URL change; reload keeps the view; copy the URL into a new tab: the same view.
3. Columns Risk: Volatility 1Y, Max DD 1Y, From 52W high, 1Y; sort by Max DD: ascending, arrow ▲. Metric filters: type `-20` in From 52-week high Max: the chip "From 52-week high at most -20%" appears, the column stays visible after switching Columns to Liquidity.
4. Export CSV: open it in a spreadsheet: header row, all matching rows (not only 50), visible columns only, withheld rows blank with "withheld", the attribution line at the end, "Pokéfin" spelled correctly.
5. 1024 x 768: the table scrolls horizontally inside its border; # and Product stay pinned; no page-level horizontal scroll.
6. 390 x 844 (DevTools device mode, touch): no table; list rows at least 56 px; "Filters" opens a full-screen sheet with 16 px inputs (no zoom on focus); "Show 28 products" closes it; "Sort: 1M change" opens the sort sheet; picking "Days of supply" closes it and every row's meta reads "... days of supply"; the ▼/▲ button flips the order. No horizontal page scroll.
7. `http://127.0.0.1:3100/market` and `/market?sort=r1y&cols=risk` land on `/screener` with the same query; the header's Screener link is marked current on `/screener`.
8. Keyboard only: Tab reaches Screens, filters, Metric filters, Columns, Export, then the header sort buttons and `?` links, then row links; Enter on a header sorts; Escape closes the sheets and returns focus to the trigger.
9. `/methodology#screens`: six sub-sections with their rules and an "Open this screen" link each; the version shows the bump.

## Owner actions

1. **Apply migration 0042 before this PR merges or deploys.** The PR changes the shared `PRODUCT_STATS_SELECT`, which `/prices`, product pages and the Screener all read: deployed against a database without the column, PostgREST rejects the select, `getCachedProductStats` returns its empty fallback, and every page loses its risk, supply and value statistics until the column exists. Apply in number order: every earlier numbered migration that exists in `migrations/` must already be in production (0033 at least; if 0036 is merged but not yet applied, apply 0036 first, so the view's column order matches the replay). In the Supabase SQL editor paste `migrations/0042_product_max_drawdown.sql`, run it, then run its three verification queries (expect `0`, `0`, and `true, false`). It is additive: no existing object changes, `refresh_market_analytics` is untouched. Then refresh `schema.sql` from production as README "Database" describes (WP21 Owner action C), so CI's drift step reads clean, and change the `audits/HARDENING_FOLLOWUPS.md` bullet "**Migration 0042: pending apply**" to "**Migration 0042 applied** (date, via Supabase MCP or SQL editor)".
2. **Generated types**: run `SUPABASE_ACCESS_TOKEN=... pnpm types:db` in `frontend/` and push `app/types/database.ts` to the PR branch, or give the executor a token for it (step 29).
3. **After deploy**: open `https://pokefin.ca/market?sort=r1y&cols=risk` once (the apex is the canonical host, WP02/WP13) and confirm it lands on `/screener?sort=r1y&cols=risk`; the daily smoke test checks it from then on. Nothing to do in Search Console: the sitemap lists `/screener` and the 308 transfers the old URL.
4. **Optional review of the screen thresholds** in D4 (defaults are set; a change later is a methodology change with a version bump). The Value columns, "Near MSRP" and "Below pack value" appear as soon as WP28's curation (D7) has data; nothing else is needed.

## Acceptance criteria

- [ ] `/market` and `/market?<any query>` answer 308 to `/screener?<same query>`; `app/market/` no longer exists; nav, footer, home, 404 panel and product page link to `/screener`; the sitemap lists `/screener` and not `/market`.
- [ ] `/screener` renders 50 rows in the server HTML with no client fetch after load, from `product_stats_latest`, the catalog summaries, the volume metrics and the 1Y baked sparklines.
- [ ] Desktop table: 44 px one-line rows, product cell "{Type} · {Set}" with the variant as secondary text, a visible arrow and `aria-sort` on the sorted column, a `MetricHelpLink` on every metric header, sticky # and Product columns whose divider and row rules stay with them while the table scrolls sideways (borders on cells, `border-separate`).
- [ ] Phone rows: a price 2 or more days old, or withheld, reads "Last priced {Mon D}" as visible text; no phone row relies on a tooltip.
- [ ] Every focusable control in the new files uses `focus-visible:outline-hidden` with the action ring; no `outline-none` or `transition-colors` anywhere in the diff; WP24's trust test passes.
- [ ] 0042 was applied in production before the frontend deployed; `schema.sql` refreshed; `HARDENING_FOLLOWUPS.md` records the apply.
- [ ] Column presets Performance, Risk, Liquidity and Value (Value only with WP28 data) replace the key/all toggle; a filtered or sorted column is always visible.
- [ ] Every filter in D3 works, is in the URL, round-trips on reload and on a shared link, and appears as a removable chip.
- [ ] Six presets live in `app/screener/presets.ts`, each documented on `/methodology#screens` from the same constants, and `presets.fixture.test.ts` has one passing test per preset on the WP22 perf fixture.
- [ ] Withheld products show `--` (with the sr-only reason) in every metric column, sort last, are excluded from every preset (tested), and export blank values.
- [ ] Phones below 768 px get the `DataList` with a filter sheet and a sort sheet; no table is mounted there after hydration; at least 6 rows are fully visible on the first 390 x 844 screen (measured).
- [ ] Sort, filter, preset, column and "Show more" changes update the results in `startTransition`, dimmed while pending.
- [ ] Sort INP ≤ 150 ms at 1440 px and the phone sort pick ≤ 150 ms under 4x CPU throttling; the trace (`screener-sort-trace.json.gz`) is attached to the PR.
- [ ] `perf-budgets.json` has `/screener` with JS target 165 and document target 60; `pnpm perf:budget` passes with `/screener` JS ≤ 165 kB gz; supabase-js is not reachable from `/screener`; Lighthouse `/screener` passes with calibrated thresholds.
- [ ] CSV export: every matching row in the current order, visible columns only, fresh values only, currency in the headers, formula-safe text, one attribution line with `DECISION_NOTE`.
- [ ] `DecisionNote anchor="screens"` sits under the results; the returns caption says returns are on the USD Market Price.
- [ ] Migration 0042 adds `max_dd_365d_pct` with the WP31/WP18 definition through a trigger, re-creates `product_stats_latest`, replays twice cleanly, and `test_wp33_max_drawdown_db.py` passes (9 tests); WP25's DB tests still pass.
- [ ] The smoke test checks `/screener` and the `/market` redirect; `WARM_PATHS` warms `/screener`; the ESLint public-route guard covers `app/screener` and `app/components/Screener`.
- [ ] No raw palette class, hex value, em dash or banned word in any new file; the conventions baseline only went down; `MetricLabel`'s output is unchanged.
- [ ] `tsc` (after phase B), lint, Jest, `test:scripts`, `build:stub` and the Python tests pass.

## Rollback

1. Revert the merge commit (`git revert -m 1 <merge-sha>`) and redeploy. `/market` and Market View come back. In the same revert commit add a temporary `{ source: "/screener", destination: "/market", permanent: false }` to `next.config.ts` `redirects()`, so links shared since the release keep working (307, not cached as permanent); remove it once Market View is replaced again.
2. Database: leave 0042 in place. The column and trigger are additive and harmless to the reverted code (it does not select the column). If the trigger itself is the problem (for example refresh warnings in the logs), run `DROP TRIGGER IF EXISTS product_daily_stats_max_dd ON public.product_daily_stats;`: new rows then get NULL, nothing else changes. Full removal, only after the frontend no longer selects the column: `DROP TRIGGER IF EXISTS product_daily_stats_max_dd ON public.product_daily_stats; DROP FUNCTION IF EXISTS public.product_daily_stats_set_max_dd(); DROP FUNCTION IF EXISTS public.product_max_drawdown_365d(bigint, date);` then re-create `product_stats_latest` after `ALTER TABLE public.product_daily_stats DROP COLUMN max_dd_365d_pct` (drop the view first, re-create it with the 0042 section 4 statement and its grants).
3. Browsers that followed the 308 cache it; after a revert without step 1's temporary redirect they would keep requesting `/screener` and get a 404. That is why step 1 adds it.

## Commit and PR

Commits, in order (each builds; the first two are phase A's database part):

1. `feat(db): max drawdown 1Y in product_daily_stats (WP33, migration 0042)`: `migrations/0042_product_max_drawdown.sql`, `tests/test_wp33_max_drawdown_db.py`.
2. `feat(data): screener stats column, fixture and definitions (WP33)`: `app/types/market.ts`, `serverMarketData.ts` select, `scripts/fixtures/perf.mjs`, `scripts/perf-fixture.test.mjs`, `metricDefinitions.ts`, `MetricLabel.tsx` (`MetricHelpLink`), `ui/README.md`.
3. `feat(screener): URL state, filters, presets, row builder and CSV (WP33)`: `app/screener/{types,metrics,urlState,filters,presets,screenerData,exportCsv}.ts`, `test-utils/screenerRows.ts` and their tests.
4. `feat(screener): table, phone list, filter and sort sheets, page (WP33)`: `app/components/Screener/*`, `app/screener/page.tsx`, `globals.css`, component tests.
5. `feat(nav): move /market to /screener with a 308 (WP33)`: `next.config.ts`, nav, links, sitemap, deleted `app/market/` and Market View files, ESLint list, updated tests.
6. `docs(methodology): screens and 1-year drawdown (WP33)`: `content/methodology.ts`, `MethodologyArticle.tsx` and its test.
7. `perf: /screener budgets, Lighthouse, smoke redirect check, cache warm (WP33)`: `perf-budgets.json`, `lighthouserc.json`, `check-public-cache.mjs`, `prod-smoke-lib.mjs`, `prod-smoke.mjs`, `prod-smoke-lib.test.mjs`, `revalidate_hook.py`, `tests/test_revalidate_hook.py`, `scripts/measure-screener.mjs`, conventions baseline.
8. `docs: screener, migration 0042 (WP33)`: `README.md`, `frontend/README.md`, `audits/HARDENING_FOLLOWUPS.md`, `audits/remediation/01-PRODUCT-DIRECTION.md` registry line.
9. Phase B: `chore(types): regenerate database types for 0042 (WP33)`: `app/types/database.ts`.

End every commit message with the attribution lines the session's system reminder gives.

PR title: `feat: Screener with presets, replaces Market View (WP33)` (prefixed `[waiting for DB types]` until phase B).

PR body:

```markdown
## What
- `/market` becomes `/screener` (308, query kept). A dense ranked table of every sealed product on 18 metrics in four column presets (Performance, Risk, Liquidity, Value), 17 filters in the URL, six documented screens, CSV export of the view, and a phone list with filter and sort sheets.
- Server-rendered from `product_stats_latest` (WP25), the catalog, volume metrics and 1Y baked sparklines (WP26). No client fetch.
- Migration 0042: `product_daily_stats.max_dd_365d_pct` (1-year max drawdown, product-page definition) written by a trigger; `refresh_market_analytics` untouched.
- `/methodology#screens` documents every screen from the same constants (version <new>).

## Why
research/ui-audit.md `/market` (93 px rows, no sort state, unusable on phones), research/competitive-landscape.md §4 item 3 (screener with presets and shareable URLs), research/data-opportunities.md §3.4, §3.5, §3.13.

## Numbers (perf build, WP22 fixture)
| | Before (/market) | After (/screener) | Target |
|---|---|---|---|
| Initial JS (gz) | <x> | <y> | 165 |
| Document (br) | <x> | <y> | 60 |
| Sort INP, 1440, 4x CPU (max of 10) | n/a | <ms> | 150 |
| Phone sort pick INP, 4x CPU | n/a | <ms> | 150 |
| Rows on first 390 x 844 screen | 0 (price off-screen) | <n> | 6 |
| Lighthouse CLS (median) | <x> | <y> | 0.05 |
Trace: screener-sort-trace.json.gz (attached). Screenshots: 1440 Performance, 1440 Risk with "Off highs with thin supply", 390 list, 390 filter sheet, 390 sort sheet.

## Checks
tsc, lint, jest (<counts>), test:scripts, build:stub, DB tests (0042 and WP25), perf:budget, measure-screener, curl 308.

## Owner
1. Apply 0042 (verification queries in the file header). 2. Types (phase B). 3. After deploy, open /market?sort=r1y&cols=risk once.

## Follow-ups (out of scope)
- `ControlBar` age-filter props and `AgeFilter.tsx` have no user left.
- WP31's product page can read `max_dd_365d_pct` instead of computing the drawdown from history.
- `saved_views` for signed-in users (the URL format here is what it would store).
- Moving `MiniSparkline` out of `components/MarketView/`.
```

If a budget raise was needed (step 28c), add the line `Perf budget raise: routes./screener.documentBrKb <reason>` to the body.
