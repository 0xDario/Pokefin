# WP32: Market home: index header, breadth, screened movers, new releases

- **Goal**: in five seconds, a visitor to `/` sees what Pokéfin is (one line: 306 sealed products, TCGplayer Market Price, updated daily, stale prices hidden), whether the sealed market is up (Pokéfin Sealed Index level with 1D, 7D, 30D and 1Y changes, breadth, a 1Y chart), what moved (5 gainers and 5 losers over 7D or 30D, screened for liquidity, each with a sparkline) and what was just released (compact rows per new set). A signed-in collector also sees their portfolio value in their currency and its 1-day change, without the page losing its CDN cache.
- **Why now / value**: the home page is the first screen of every visit and still leads with a generic 350 px banner, two competing buttons, six unscreened mover cards and 430 px catalog cards (research/ui-audit.md "`/` Dashboard"). WP29 publishes the index and breadth, WP25 the screened daily statistics, WP26 the baked sparklines and WP27 the search and header: this package turns them into the daily reason to open Pokéfin (01-PRODUCT-DIRECTION.md §5 item 3, §4.2 step 2).
- **Effort**: M, 12 to 14 hours (pure helpers and their tests 2 h, three cached reads, fixture and fixture test 1.5 h, summary route, repo function and tests 1.5 h, eight home components and the page 4 h, methodology and definitions 1 h, budgets, Lighthouse, cache check and measurements 2 h, docs and cleanup 1 h).
- **Depends on**: WP05 (`app/lib/server/portfolioRepo.ts` with `findPortfolioId`, `HOLDING_SELECT`, `loadGuardedProducts`, `guardHoldings`; `app/lib/routeAuth.ts` `requireRouteUser` and `jsonNoStore`; `rejectIfNotAppRequest` in `app/lib/csrf.ts`), WP22 (`perf-budgets.json`, `lighthouserc.json`, `scripts/fixtures/perf.mjs`, `pnpm perf:budget`, `scripts/perf-serve.mjs`, `scripts/prod-smoke-lib.mjs`), WP23 (`Stat`, `Delta`, `DataList`/`DataListRow`, `SegmentedControl`, `Skeleton`, `Badge`, `AsOf`, `ProvenanceLine`, `buttonClasses`, `WarnIcon`, tokens, `test-utils/axe.ts`, the conventions ratchet), WP24 (`PROVENANCE_SENTENCE`, `MetricLabel`, `DecisionNote`, `app/content/methodology.ts`, `app/lib/metricDefinitions.ts`, `MethodologyArticle.tsx`), WP25 (`product_daily_stats`, `ProductDailyStats`, `getCachedProductStats`, `fetchAllRows`, `statsFor`), WP26 (`getCachedSparklines`, `sparklineFor`, `MiniSparkline size="row"`, `scripts/check-public-cache.mjs` with `isrProblems`, `PUBLIC_ROUTE_CLIENT_FILES`, `forbiddenChunks`), WP27 (`SearchTrigger`, `SearchIcon`, `navConfig.ts` with `SCREENER`, `productHref`, `setSearchHref`, `getCachedPipelineStatus`), WP29 (`getCachedIndexSummary`, `getCachedIndexSeries`, `currentSummaries`, `sliceIndexRange`, `INDEX_TYPE_FAMILY`, `INDEX_RULES`, `INDEX_CHANGE_WINDOWS`, `IndexChart`, the `index_constituents` table, the index perf fixture, the `#index-breadth` methodology anchor and the `breadth7d`/`newHighs52w` definitions). Through them: WP04 (`useAuth().sessionStatus`), WP07 (`format.ts`), WP11 (`cacheTags.ts`, `DAILY_BACKSTOP_SECONDS`, ISR), WP15 (`CardRinkPromo` last in `<main>`), WP20 (`useCurrency`, `app/types/*`, generated `database.ts`). Not used: WP28 (per-product release dates stay a follow-up; the page groups by set release date) and WP30 (the home rows are WP23 `DataListRow`s, not `ProductListRow`).
- **Unblocks**: WP34 (renders its watchlist movers as the `children` of `YourPokefin`, the slot this package leaves), WP36 (can extend `GET /api/portfolio/summary` instead of adding a second summary route), WP37 (its `setSearchHref()` change makes "All {n} products" in Recently released open the set page with no edit here).
- **Placement**: after WP29 (index data) and WP27 (search trigger, header). Must precede WP34. No migration: the registry (0033 to 0041, 01-PRODUCT-DIRECTION.md §8) is untouched; every read is an indexed read of a table WP25 or WP29 created.
- **Suggested branch name**: `remediation/wp32-market-home-dashboard`
- **Risk level**: medium. It rewrites the most visited page; the ISR shell is guarded by a source test and a cookie cache check in CI, the byte and Lighthouse gates catch regressions, no data changes, and rollback is one revert.

## Why

Today a visitor lands on a "Price Tracker" banner that fills a whole phone screen before any data, sees no market-level signal, and gets six mover cards mixing gainers and losers with no liquidity screen, so a one-listing ETB that stepped 4x can top the list; the only aggregate, "Avg 1M return", is an unweighted mean over every product including packs (research/ui-audit.md "`/` Dashboard", "First-time visitor comprehension"). Finance home pages lead with an index, breadth and a chart; Pokéfin now publishes all three (WP29), plus a finalised daily statistics table with the weekly report's liquidity inputs (WP25, research/data-opportunities.md §3.2, §3.6). This package replaces the hero with a market header (index level and changes, breadth including the share of constituents up over 30 days, a server-SVG 1Y chart, one provenance line and a search trigger), splits movers into Gainers and Losers columns of 5 for 7D and 30D using exactly the weekly report's screen plus a units-sold floor, turns Recently released into compact rows grouped by set with the change since first tracked, and adds a "Your Pokéfin" client island for signed-in users that never makes the page dynamic (01-PRODUCT-DIRECTION.md §2 principles 1, 2, 5; §6.1 rule "personal data streams into a client island"). Collector-investors who open the site daily benefit first; Canadians see every price in CAD at the header's rate; search visitors get a page that states source, cadence and coverage up front (research/trust-seo-brand.md §5.1).

## Design

### D1. Decisions (binding)

- The hero, the hero form, "Browse All Products", "Market View" buttons, `MoverCard`, `StatCard` and the whole Quick Stats row ("Products Tracked", "Avg 1M Return", "Most Expensive", "Last Refreshed") are removed. Coverage moves into the provenance line; freshness is WP27's data clock plus the provenance `AsOf`.
- Movers and Recently released describe the previous UTC day (D-1), the day the index publishes, read from `product_daily_stats` rows of that day. Their section headers say "Through {date} (UTC)".
- Movers screen, all four required: fresh price (`is_price_fresh` and `usd_price` not null), `usd_price >= 15` USD, `distinct_prices_365d >= 3`, `units_sold_30d >= 3`. No product-type exclusion beyond that (the price floor removes packs). 5 gainers and 5 losers per period.
- Periods 7D (`ret_7d`, WP26 sparkline period `7D`) and 30D (`ret_30d`, sparkline period `1M`). Both panels are in the server HTML; the toggle switches the `hidden` attribute and makes no request.
- The page stays a static ISR route: no `cookies()`, `headers()`, `searchParams`, `connection()`, `dynamic` export or `"use client"` in `app/page.tsx` or any server component it renders. Personal data comes only from the `YourPokefin` client island through `GET /api/portfolio/summary` (new, built on WP05's repo and gates). WP05 ships `GET /api/portfolio` (full payload, creates a portfolio on first use) and no summary route; the home page must neither download every holding nor create a portfolio, so this package adds the summary route.
- Prices render in the header's currency through a new client leaf `Price` (server HTML in CAD at the layout rate, the stored preference applied after hydration, no mismatch). The $15 floor is always USD.
- No thumbnails on the home page: rows are text, price, change and sparkline. Zero image bytes above the fold; the LCP element is the index level text.
- The store promo stays the last child of `<main>` (WP15).
- Phone order puts the first mover inside the first 390 x 844 screen: intro, index card (with breadth), movers, then the chart. Only the chart (which has no focusable element) is moved visually on phones, so focus order equals visual order.

### D2. Metric definitions

Notation: `r(p)` is product `p`'s `product_daily_stats` row for day `S` (the statistics day, normally D-1). Percent columns are percent points.

| Metric | Formula | Edge cases |
|---|---|---|
| Statistics day `S` | Yesterday (UTC) at render time when that day has rows; else the day of `product_stats_latest` (WP25 `getCachedProductStats().day`) | No rows at all: movers and Recently released show their "not available" state. `S` = today: the header says ", day in progress". `S` 2 or more days before today: warn `Badge` "Not updated since {date}" |
| Screen pass | `r.is_price_fresh AND r.usd_price IS NOT NULL AND r.usd_price >= 15 AND coalesce(r.distinct_prices_365d, 0) >= 3 AND coalesce(r.units_sold_30d, 0) >= 3` | NULL counts as failing (WP25 nulls withheld and stale inputs) |
| Change for period `P` | `r.ret_7d` (7D) or `r.ret_30d` (30D), WP25's bounded anchors | NULL: the product is not ranked for `P` |
| Gainers | Screened products with change `>= FLAT_BAND_PERCENT` (0.05), by change descending | Ties: more `units_sold_30d` first, then lower product id. Fewer than 5: show those |
| Losers | Screened products with change `<= -0.05`, by change ascending | Same ties |
| Up over 30D | Among headline constituents of the index day's month (`index_constituents`, code `sealed`, month = first day of the headline day's month) whose row on the headline day has `is_price_fresh` and a non-null `ret_30d`: `100 x count(ret_30d > 0.5) / count(*)`, 0 decimals | 0.5 is `INDEX_RULES.breadthFlatBandPct`, the dead band of WP29's 7D breadth. No member with a change: `--` with the reason |
| Advancers 7D, Decliners 7D, New 52-week highs / lows | WP29's `adv_7d`, `dec_7d`, `new_high_52w`, `new_low_52w` of the headline row; shares = count / (adv + dec + flat), 0 decimals | Sum 0: "No constituent has a 7-day change for this day." |
| Since first tracked | `(r.usd_price / f - 1) x 100`, `f` = `usd_price` of the product's `product_daily_stats` row on `r.first_tracked_day` | NULL when the current price is withheld, `f` is missing or not positive, or `first_tracked_day >= S` |
| Recently released | The 2 sets with the newest `sets.release_date <= S` that have active products; per set up to 8 products, current price descending, withheld prices last, then type label A to Z | "All {n} {set} products" link when a set has more than 8 |
| Portfolio value (island) | Sum over holdings with a guarded price of `quantity x products.usd_price` (WP05's freshness verdict) | No priced holding: `--` |
| Portfolio 1D change | Over holdings whose latest stats row has `is_price_fresh` and `ret_1d`: `prev = usd_price / (1 + ret_1d/100)`; change = `sum(q x (usd_price - prev))`; percent = change / `sum(q x prev)` x 100, 1 decimal | No such holding: `--` "No 1-day change for your holdings". The amount and value convert at the header's current rate |

All of these are documented on `/methodology#movers` and `#index-breadth` (step 16), which moves the methodology to the next minor version.

### D3. Screens

Desktop, 1440 px, signed out (content `max-w-7xl`, 12-column grid from 1024 px):

```
+--------------------------------------------------------------------------------------------------------------+
| [P] Pokéfin  Prices Screener Sets Portfolio Tools v  (o) Prices as of Oct 14, 6:10 AM EDT  [Q Search /] USD|CAD|
+--------------------------------------------------------------------------------------------------------------+
| Sealed Pokémon TCG market                                                  [(Q) Search products, sets or  / ] |
| 306 sealed products. TCGplayer Market Price in USD, updated daily. Prices older than 14 days are hidden.     |
| Prices as of Oct 14. Methodology                                                                              |
+-----------------------------------------------+--------------------------------------------------------------+
| Pokéfin Sealed Index                          | Sealed Index, last 12 months                  Open the index  |
| Index level (?)                               |                                                         150   |
| 142.87  ▲ 0.4% 1D                             |         __/\__            __/\____/\____ 142.87 · Oct 13 *     |
| as of the close of Oct 13, 2026 (UTC)         |   __/\_/      \__/\__/\__/                             125    |
| 7D           30D          1Y                  |                                                        100    |
| ▼ 2.3%       ▲ 1.2%       ▲ 18.4%             |  Nov 2025    Jan 2026    Mar 2026    May 2026    Jul 2026    |
| --------------------------------------------- |  ── Daily level                                              |
| Advancers 7D (?)        Decliners 7D (?)      |                                                              |
| ▲ 94  44%               ▼ 76  36%             |                                                              |
| Up over 30D (?)         New 52-week highs / lows (?)                                                         |
| 58%  of 204             11 / 0                |                                                              |
+-----------------------------------------------+--------------------------------------------------------------+
| Movers   Through Oct 13, 2026 (UTC)                                                            [#7D#| 30D ]  |
| Gainers 7D                                             | Losers 7D                                           |
| Booster Box  Surging Sparks                   /\_/‾    | Elite Trainer Box  Scarlet & Violet 151      ‾\_/   |  56 px rows
| 212 sold 30D                  C$612.40  ▲ 12.4% 7D     | 88 sold 30D                  C$81.30  ▼ 9.8% 7D    |
| ... up to 5 rows                                       | ... up to 5 rows                                    |
| Screened for liquidity: a Market Price of at least $15 USD, at least 3 different daily prices in the past  |
| year and at least 3 units sold in 30 days. Open the Screener                                                |
| Screens describe past prices. They are not recommendations. How we calculate this                          |
+--------------------------------------------------------------------------------------------------------------+
| By product type   30D change, as of the close of Oct 13, 2026 (UTC)                                         |
| [Booster Box        ] [Elite Trainer Box  ] [Booster Bundle     ] [Collections        ]                    |
| [131.20   ▲ 1.0% 30D] [118.40   ▼ 0.8% 30D] [104.02   ▲ 0.2% 30D] [ 97.10   ▼ 2.4% 30D]                    |
+--------------------------------------------------------------------------------------------------------------+
| Recently released   Through Oct 13, 2026 (UTC)                                                              |
| Phantasmal Flames   ME02 · Released Nov 14, 2025      | Mega Evolution   ME01 · Released Sep 26, 2025        |
| Booster Box                 C$412.10  ▲ 8.1% since Nov 14 | Elite Trainer Box        C$96.20  ▼ 3.0% since Sep 26 |
| 64 sold 30D                                           | 141 sold 30D                                         |
| ... up to 8 rows                                      | ...                                                  |
| All 11 Phantasmal Flames products                     |                                                      |
+--------------------------------------------------------------------------------------------------------------+
| [CardRinkPromo aside: WP15, WP24 label, WP27 secondary button]                                              |
+--------------------------------------------------------------------------------------------------------------+
```

Signed in, the island appears between "By product type" and "Recently released" (below the 900 px fold, so its late arrival shifts nothing in view):

```
+--------------------------------------------------------------------------------------------------------------+
| Your Pokéfin                                                                               Open portfolio    |
| Portfolio value                                                                                              |
| C$4,812.30  ▲ 0.6% 1D                               (WP34 renders watchlist movers in the second column)    |
| +C$28.70 over 1 day · 14 holdings, 22 units                                                                  |
| as of Oct 14                                                                                                 |
+--------------------------------------------------------------------------------------------------------------+
```

Phone, 390 x 844 (16 px gutters). Pixel budget to the first mover: header 64, padding 24, H1 32, provenance 3 lines 54, gap 16, search 44, gap 24, index card about 312, gap 24, movers header 60, "Gainers 7D" 26, first row 56: about 736 px, under 844.

```
+--------------------------------------+
| [P] Pokéfin (o)            [Q]  [=]  |  64 px (WP27)
+--------------------------------------+
| Sealed Pokémon TCG market            |  h1 24/32
| 306 sealed products. TCGplayer Market|  small 13/18, 3 lines
| Price in USD, updated daily. Prices  |
| older than 14 days are hidden. Prices|
| as of Oct 14. Methodology            |
| [(Q) Search products, sets or codes] |  44 px
| +----------------------------------+ |
| | Pokéfin Sealed Index             | |
| | Index level (?)                  | |
| | 142.87  ▲ 0.4% 1D                | |  32 px display
| | as of the close of Oct 13, 2026  | |
| | (UTC)                            | |
| | 7D        30D        1Y          | |
| | ▼ 2.3%    ▲ 1.2%     ▲ 18.4%     | |
| | -------------------------------- | |
| | Advancers 7D (?) Decliners 7D (?)| |
| | ▲ 94  44%        ▼ 76  36%       | |
| | Up over 30D (?)  New 52-week     | |
| | 58%  of 204      highs / lows (?)| |
| |                  11 / 0          | |
| +----------------------------------+ |
| Movers                  [#7D#| 30D ] |  44 px segments on touch
| Through Oct 13, 2026 (UTC)           |
| Gainers 7D                           |
| Booster Box  Surging Sparks   /\_/‾  |  56 px row: first mover, inside 844
| 212 sold 30D  C$612.40 ▲ 12.4% 7D    |
| ...                                  |
| Losers 7D                            |
| ...                                  |
| Screened for liquidity: ...          |
| Open the Screener                    |
| Screens describe past prices. ...    |
+--------------------------------------+
| Sealed Index, last 12 months   Open  |  chart moved below movers (phones only)
| [chart, 160 px]                      |
+--------------------------------------+
| By product type                      |
| [Booster Box    ] [Elite Trainer Box]|  2 x 2 tiles, 44 px minimum
| [Booster Bundle ] [Collections      ]|
+--------------------------------------+
| Your Pokéfin (signed in)             |
+--------------------------------------+
| Recently released                    |
| Phantasmal Flames                    |
| ME02 · Released Nov 14, 2025         |
| Booster Box                          |
| 64 sold 30D  C$412.10 ▲ 8.1% since N…|
+--------------------------------------+
| [promo]                              |
+--------------------------------------+
```

From 768 to 1023 px the page is one column in DOM order (the chart sits right under the index card).

### D4. States

| Where | State | What shows |
|---|---|---|
| Index card | read failed (`getCachedIndexSummary()` null) | h2 plus "The index could not be loaded. This is usually temporary. Reload the page in a minute." The chart card and the sub-index strip are not rendered; the index card spans the row |
| Index card | nothing published (`[]` or no headline) | "The Sealed Index is not published yet. Levels appear after the first nightly run." plus link "How the index works" (`/methodology#index`). Chart card and strip not rendered |
| Index card | provisional headline day | warn note (`role="note"`, `bg-warn-fill text-warn-text`, `WarnIcon`): "Provisional: {n} of {N} constituents ({x}%) were priced on {date}. How provisional days work" (link `/methodology#index-calculation`) |
| Index card | overdue (`isIndexOverdue(day, today)`) | warn note: "Not updated since {date}. The index is published each night for the previous day." |
| Index card | change without an anchor | `Delta` `--` with sr-only reason: 1D "No level for the previous day", 7D "No level 7 to 14 days earlier", 30D "No level 30 to 37 days earlier", 1Y "Less than a year of levels" (built from `INDEX_CHANGE_WINDOWS`) |
| Index card | Up over 30D unavailable (constituents or stats read failed, or no member with a change) | `--` with sr-only "Not available" |
| Chart card | series read failed | dashed 160 px box: "The index history could not be loaded." |
| Chart card | fewer than 2 points | WP29's `IndexChart` "No history" box (compact height) |
| Movers | no statistics day | "Movers are not available right now. The daily statistics could not be read." No toggle |
| Movers | a column empty | dashed box: "No product passed the screen with a gain over 7 days." / "... a fall over 30 days." |
| Movers | sparkline payload null (read failed) | the row has no sparkline slot (never a permanent flat bar, never "No history") |
| Movers | product has no series | WP26's "No history" in the 64 x 24 slot |
| Movers, Recently released | statistics day stale (2+ days) | warn `Badge` "Not updated since {date}" next to "Through {date} (UTC)" |
| Recently released | withheld price | Price `--`, `Delta` `--` "No current price" |
| Recently released | no first tracked price | `Delta` `--` "No first tracked price" |
| Recently released | no group | "No set in the catalog has been released yet." |
| Your Pokéfin | session unknown or anonymous | renders nothing |
| Your Pokéfin | loading | `role="status"` sr-only "Loading your portfolio", two flat `Skeleton` bars in a 96 px box |
| Your Pokéfin | error (non-2xx, network, bad body) | "Your portfolio could not be loaded." plus the header's "Open portfolio" link |
| Your Pokéfin | empty portfolio (no portfolio row or no holding) | "Your portfolio is empty." / "Add a product or import a Collectr CSV, and its value shows here." / secondary button "Go to your portfolio" |
| Page | summaries RPC throws | unchanged behaviour: the render throws (the cached ISR page keeps being served; a first render shows `error.tsx`) |

No `app/loading.tsx` (WP13's rule; the route is static).

### D5. Copy (every new user-facing string)

"Sealed Pokémon TCG market", "{n} sealed products." + `PROVENANCE_SENTENCE` + "Prices as of {Mon D}.", "Methodology", "Search products, sets or set codes", "Pokéfin Sealed Index", "Index level", "as of the close of {date} (UTC)", "7D", "30D", "1Y", "Advancers 7D", "Decliners 7D", "Up over 30D", "New 52-week highs / lows", "of {n}", "Sealed Index, last 12 months", "Open the index", "Movers", "Through {date} (UTC)", ", day in progress", "Movers period" (sr-only group name), "7 days", "30 days" (segment names), "Showing 7-day movers" / "Showing 30-day movers" (live region), "Gainers 7D", "Losers 7D", "Gainers 30D", "Losers 30D", "{n} sold 30D", "Screened for liquidity: a Market Price of at least ${15} USD, at least {3} different daily prices in the past year and at least {3} units sold in 30 days.", "Open the Screener", "By product type", "30D change, as of the close of {date} (UTC)", "Not published", "Recently released", "{CODE} · Released {date}", "since {Mon D}", "All {n} {set} products", "No sales data", "Your Pokéfin", "Open portfolio", "Portfolio value", "{±amount} over 1 day", "{n} holdings", "{n} units", "{n} without a current price", "Go to your portfolio", every state string in D4, WP24's decision note. No "live", "real-time", "all-time", "undervalued", "buy", "TCGPlayer" or em dash.

### D6. Interactions

- Period toggle (`SegmentedControl`, radio group "Movers period", segments "7D" and "30D" named "7 days" and "30 days"): arrow keys and click switch panels instantly; no network request; an sr-only `aria-live="polite"` line announces "Showing 30-day movers". Without JavaScript the 7D panel shows.
- Search trigger: WP27's `SearchTrigger`; click, Enter or Space opens the header's GlobalSearch dialog; hover and focus preload its chunk; the catalog loads only when the dialog opens.
- Rows: each mover and release row is one link to `/product/{id}` (`DataListRow`, `prefetch={false}`). Sub-index tiles link to `/indices/sealed`. Every link this package adds uses `prefetch={false}` (research/performance-excellence.md §8: up to 26 product links would otherwise prefetch on viewport entry).
- Currency: the header toggle re-renders every `Price` and the island's value; sparklines and changes do not change.

### D7. Accessibility

- One `h1`; sections labelled by their `h2` (`index-h`, `index-chart-h`, `movers-h`, `types-h`, `yours-h`, `recent-h`); column and set titles are `h3`.
- `Delta` carries direction as an sr-only word; breadth counts carry ▲/▼ as `aria-hidden` glyphs next to text labels. Colour is never the only cue.
- The chart SVG is `aria-hidden`; WP29's `figcaption` sentence gives range, first and last level, low and high.
- The hidden movers panel uses the `hidden` attribute, so its links leave the tab order and the accessibility tree.
- Touch targets: segments and tiles 44 px on coarse pointers (`pointer-coarse:min-h-11`), rows 56 px.
- Focus order equals visual order at every width. The only element moved by CSS order on phones is the chart card, and it has no focusable element: its "Open the index" link is `aria-hidden` with `tabIndex={-1}` at every width (a pointer convenience), because the index card's `h2` is already a link to `/indices/sealed` for keyboard and screen-reader users.

### D8. Design system use

WP23: `Stat` (hero size for the index level), `Delta`, `DataList`/`DataListRow`, `SegmentedControl`, `Skeleton`, `Badge` (warn), `AsOf`, `ProvenanceLine`, `buttonClasses`, `WarnIcon`; tokens `text-ink`, `text-ink-soft`, `bg-surface`, `bg-surface-alt`, `border-line`, `text-action`, `text-gain-text`, `text-loss-text`, `bg-warn-fill`, `text-warn-text`, `rounded-card`, `rounded-control`; type `text-h1`, `text-h2`, `text-h3`, `text-body`, `text-small`, `text-caption`, `text-display` (through `Stat`). WP24: `MetricLabel`, `DecisionNote`. WP26: `MiniSparkline size="row"`. WP29: `IndexChart` (new `size="compact"`). No raw palette class or hex in any new file (test).

### D9. Performance

- Server reads on `/` (all `unstable_cache`, tag `market-products`, daily backstop): summaries, index summary, index series, one day of `product_daily_stats` (about 306 rows, primary-key range), `index_constituents` for one month (about 250 rows, primary key), first tracked rows for at most 16 products (`in` on the primary key), two sparkline payloads, the pipeline status (React-cached, shared with the layout). The page renders once per scrape revalidation.
- Client JavaScript of its own: `MoversPeriodSwitch` (with `SegmentedControl`), `SearchTrigger` (tiny, WP27), `YourPokefin`, `Price`, `MiniSparkline`. `RecentlyReleased` (ProductCard, `useProductData`, the full-chart toggle and its lazy Recharts) leaves the route. Expected `/` JS: at or below the 150 kB gz target (WP22 measured 152.8 before WP26 and WP30); the byte gate records the new value.
- HTML: both movers panels (20 rows), the chart path (about 365 points), up to 16 release rows: the `/` document target stays 60 kB br.
- `forbiddenChunks`: supabase-js (WP26) and recharts (added here) must not be reachable from `/`.
- Lighthouse on `/`: LCP warn threshold tightened from 2500 to 1800 ms; CLS error 0.05 unchanged; `uses-responsive-images` stays an error with 0 items (no images).

## Before you start

Read:
- `audits/remediation/01-PRODUCT-DIRECTION.md` (all; binding), `research/ui-audit.md` "`/` Dashboard", "First-time visitor comprehension", "Mobile"; `research/data-opportunities.md` §3.2, §3.6, §3.7; `research/performance-excellence.md` §3, §4, §7.1; `research/trust-seo-brand.md` §5.1, §14.4.
- Specs: WP29 (Design, steps 8 to 10, 14, 15, 17, 21 to 23), WP26 (D1 to D3, steps 3, 5, 10, 15, 17, 19, 20), WP27 (steps 4, 10, 13, 14, 28), WP25 (Metric definitions, steps 8, 9, 11, 13), WP24 (steps 2, 4 to 6, 10, 22), WP23 (Components table, steps 8 to 18, 24), WP22 (D7, steps 10, 12, 14, 17), WP05 (steps 6 to 9, Tests 2).
- Code, current state (paths from `frontend/`): `app/page.tsx`, `app/components/dashboard/RecentlyReleased.tsx`, `app/lib/serverMarketData.ts` (find `fetchAllRows`, `getCachedProductStats`, `getCachedIndexSummary`, `getCachedIndexSeries`, `getCachedSparklines`, `getCachedPipelineStatus`), `app/lib/marketIndex.ts`, `app/lib/marketStats.ts`, `app/lib/sparkline.ts`, `app/indices/sealed/IndexChart.tsx`, `app/indices/sealed/page.tsx` (its `Notice`), `app/components/ui/*`, `app/components/search/SearchTrigger.tsx` and `SearchField.tsx`, `app/components/nav/navConfig.ts`, `app/components/MarketView/MiniSparkline.tsx`, `app/components/CardRinkPromo.tsx`, `app/context/CurrencyContext.tsx`, `app/context/AuthContext.tsx`, `app/lib/server/portfolioRepo.ts`, `app/lib/routeAuth.ts`, `app/lib/csrf.ts`, `app/api/portfolio/route.ts`, `app/types/market.ts`, `app/types/portfolio.ts`, `app/content/methodology.ts`, `app/content/disclosures.ts`, `app/methodology/MethodologyArticle.tsx` and its test, `app/lib/metricDefinitions.ts` and its test, `eslint.config.mjs` (`PUBLIC_ROUTE_CLIENT_FILES`), `perf-budgets.json`, `lighthouserc.json`, `scripts/fixtures/perf.mjs`, `scripts/perf-fixture.test.mjs`, `scripts/check-public-cache.mjs`, `scripts/public-route-imports.test.mjs`, `scripts/prod-smoke-lib.mjs`, `.github/workflows/ci.yml`, `app/__tests__/uiConventions.test.ts` and its baseline. Repo root: `generate_weekly_report.py` lines 40 to 60 (`PRICE_FLOOR`, `LIQUIDITY_MIN_DISTINCT_PRICES`).
- Every call site you will change: `grep -rn "RecentlyReleased\|components/dashboard\|HOME_SPARKLINE_PERIOD" app scripts eslint.config.mjs --include=*.ts --include=*.tsx --include=*.mjs`.

Confirm the starting state (from `frontend/`; each block must print what the comment says, otherwise stop and report the missing package):

```bash
git status --short                                                                  # clean
ls ../migrations | tail -3                                                          # nothing to add here: no migration in this package

# WP05
ls app/api/portfolio/route.ts app/lib/server/portfolioRepo.ts app/lib/routeAuth.ts
grep -n "export function rejectIfNotAppRequest" app/lib/csrf.ts                     # 1 line
grep -n "export async function findPortfolioId\|^const HOLDING_SELECT\|^async function loadGuardedProducts\|^async function guardHoldings" app/lib/server/portfolioRepo.ts   # 4 lines
grep -n "export async function requireRouteUser\|export function jsonNoStore" app/lib/routeAuth.ts   # 2 lines
# WP04 and WP20
grep -n "sessionStatus" app/context/AuthContext.tsx | head -3                       # 1+ lines
grep -n "formatPrice\|convertPrice" app/context/CurrencyContext.tsx | head -3        # 1+ lines
ls app/types/market.ts app/types/portfolio.ts
# WP22
ls perf-budgets.json lighthouserc.json scripts/fixtures/perf.mjs scripts/perf-serve.mjs scripts/prod-smoke-lib.mjs
grep -n '"perf:budget"' package.json                                                 # 1 line
# WP23
ls app/components/ui/{Stat,Delta,DataList,SegmentedControl,Skeleton,Badge,AsOf,ProvenanceLine,Button,icons}.tsx test-utils/axe.ts
# WP24
grep -n "export const PROVENANCE_SENTENCE" app/content/disclosures.ts               # 1 line
ls app/components/ui/MetricLabel.tsx app/components/ui/DecisionNote.tsx
grep -n "METHODOLOGY_VERSION = " app/content/methodology.ts                         # note the value (V_OLD)
# WP25
grep -n "async function fetchAllRows\|export async function getCachedProductStats" app/lib/serverMarketData.ts   # 2 lines
grep -n "export function statsFor" app/lib/marketStats.ts                           # 1 line
grep -c "product_daily_stats" app/types/database.ts                                 # 1 or more (WP25 phase B)
# WP26
grep -n "export async function getCachedSparklines" app/lib/serverMarketData.ts    # 1 line
grep -n "export function sparklineFor" app/lib/sparkline.ts                         # 1 line
grep -n 'row: "h-6 w-16"' app/components/MarketView/MiniSparkline.tsx               # 1 line
grep -n "export function isrProblems" scripts/check-public-cache.mjs                # 1 line
grep -n "const PUBLIC_ROUTE_CLIENT_FILES" eslint.config.mjs                         # 1 line
grep -n '"forbiddenChunks"' perf-budgets.json                                       # 1 line
# WP27
ls app/components/search/SearchTrigger.tsx app/components/search/SearchField.tsx app/components/nav/navConfig.ts
grep -n "export function SearchIcon" app/components/search/SearchField.tsx          # 1 line
grep -n "export function productHref\|export function setSearchHref\|export const SCREENER" app/components/nav/navConfig.ts   # 3 lines
grep -n "export const getCachedPipelineStatus" app/lib/serverMarketData.ts          # 1 line
# WP29
grep -n "export async function getCachedIndexSummary\|export async function getCachedIndexSeries" app/lib/serverMarketData.ts   # 2 lines
grep -n "export function currentSummaries\|export const INDEX_TYPE_FAMILY\|export const INDEX_CHANGE_WINDOWS\|export function isIndexOverdue" app/lib/marketIndex.ts   # 4 lines
ls app/indices/sealed/IndexChart.tsx
grep -c "index_constituents" app/types/database.ts                                  # 1 or more (WP29 phase B)
grep -n '"/rest/v1/market_index_summary"' scripts/fixtures/perf.mjs                 # 1 line
grep -n 'anchor: "index-breadth"' app/content/methodology.ts                        # 1 line
grep -n 'key: "breadth7d"' app/lib/metricDefinitions.ts                              # 1 line
# WP15
grep -n "export default function CardRinkPromo()" app/components/CardRinkPromo.tsx  # 1 line (no props)
```

Soft checks (record the answers; the steps say what to do):

```bash
grep -n "export const SEALED_INDEX" app/components/nav/navConfig.ts                 # WP29 step 23b: present or absent
grep -n '"recharts"' perf-budgets.json                                              # WP29 step 21c: present or absent
grep -n 'minPrices' scripts/prod-smoke-lib.mjs | grep 'path: "/"'                   # the "/" floor WP22 calibrated
grep -rn "HOME_SPARKLINE_PERIOD" app scripts                                        # importers of WP26's home constant
```

Baseline (record the counts for the PR): `pnpm exec tsc --noEmit` (exit 0), `pnpm lint` (0 errors), `pnpm test --ci` (all pass), `pnpm run test:scripts` (fail 0). Then the perf build once, to record the "before" numbers for the PR (`/` JS gz, `/` document br, Lighthouse LCP on `/`):

```bash
rm -rf .perf && SUPABASE_STUB_FIXTURE=perf pnpm build:stub > /tmp/wp32-before.log 2>&1; echo "exit=$?"
node scripts/perf-serve.mjs > /tmp/wp32-serve.log 2>&1 &
for i in $(seq 120); do [ -f .perf/ready ] && break; node -e "setTimeout(()=>{},1000)"; done
pnpm perf:budget | grep -E '^\| / '                                                # note "/ JS (gz)" and "/ document (br)"
pkill -f scripts/perf-serve.mjs
```

## Implementation steps

Paths are relative to `frontend/` unless they start with the repo root. Steps 1 to 6 add modules nothing uses yet (tsc stays green after each); step 7 onward builds the page.

### Step 1. `app/lib/moverPeriods.ts` (new): the period list the client switch needs

Kept apart from `marketHome.ts` so the client island imports two constants, not the helpers.

```ts
import type { ChartTimeframe } from "../types/market";

/**
 * The movers periods on the home page (WP32). `column` is the
 * product_daily_stats return (WP25); `sparkline` is the WP26 period whose
 * baked series the rows draw (30D uses the 1M series).
 */
export type MoverPeriod = "7D" | "30D";

export const MOVER_PERIODS: ReadonlyArray<{
  key: MoverPeriod;
  label: string;
  days: number;
  column: "ret_7d" | "ret_30d";
  sparkline: ChartTimeframe;
}> = [
  { key: "7D", label: "7D", days: 7, column: "ret_7d", sparkline: "7D" },
  { key: "30D", label: "30D", days: 30, column: "ret_30d", sparkline: "1M" },
];

export const DEFAULT_MOVER_PERIOD: MoverPeriod = "7D";
```

### Step 2. `app/lib/marketHome.ts` (new): screen, ranking, breadth, releases

```ts
/**
 * The market home (WP32) as pure functions over product_daily_stats rows
 * (WP25) and the catalog summaries. Isomorphic: no React, no Supabase.
 *
 * MOVERS_SCREEN mirrors generate_weekly_report.py (PRICE_FLOOR,
 * LIQUIDITY_MIN_DISTINCT_PRICES) and the Sealed Index screen (INDEX_RULES);
 * marketHomeConstants.test.ts drift-tests both, and /methodology#movers
 * prints these values. Change them together and bump METHODOLOGY_VERSION.
 */
import type { Product, ProductDailyStats } from "../types/market";
import { FLAT_BAND_PERCENT } from "./format";
import { INDEX_RULES } from "./marketIndex";
import { MOVER_PERIODS, type MoverPeriod } from "./moverPeriods";

export const MOVERS_SCREEN = {
  /** USD, never CAD. The weekly report's PRICE_FLOOR. */
  minPriceUsd: 15,
  /** Distinct daily prices in the past 365 days. The weekly report's LIQUIDITY_MIN_DISTINCT_PRICES. */
  minDistinctPrices365d: 3,
  /** Units sold on TCGplayer in the last 30 days, so a mover has traded. */
  minUnitsSold30d: 3,
  /** Rows per column. */
  perSide: 5,
} as const;

export const RECENT_SETS = 2;
export const RECENT_ROWS_PER_SET = 8;

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(value: unknown): value is string {
  return typeof value === "string" && DAY_KEY_RE.test(value);
}

/** "2026-10-13" -> "2026-10-01": the index_constituents month of a day. */
export function monthStartKey(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

// ------------------------------------------------------------------ rows

/** The product_daily_stats columns the home page reads. */
export type MarketDayRow = Pick<
  ProductDailyStats,
  | "product_id"
  | "day"
  | "usd_price"
  | "is_price_fresh"
  | "price_day"
  | "ret_7d"
  | "ret_30d"
  | "distinct_prices_365d"
  | "units_sold_30d"
  | "first_tracked_day"
>;

/** As PostgREST returns them (numeric may arrive as a string, anything may be null). */
export type MarketDayRowRaw = { [K in keyof MarketDayRow]?: MarketDayRow[K] | string | null };

function finite(value: unknown): number | null {
  const n = typeof value === "string" && value !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function toMarketDayRows(rows: readonly MarketDayRowRaw[]): MarketDayRow[] {
  const out: MarketDayRow[] = [];
  for (const row of rows) {
    if (!row || typeof row.product_id !== "number" || !isDayKey(row.day)) continue;
    out.push({
      product_id: row.product_id,
      day: row.day,
      usd_price: finite(row.usd_price),
      is_price_fresh: row.is_price_fresh === true,
      price_day: isDayKey(row.price_day) ? row.price_day : null,
      ret_7d: finite(row.ret_7d),
      ret_30d: finite(row.ret_30d),
      distinct_prices_365d: finite(row.distinct_prices_365d),
      units_sold_30d: finite(row.units_sold_30d),
      first_tracked_day: isDayKey(row.first_tracked_day) ? row.first_tracked_day : null,
    });
  }
  return out;
}

// ------------------------------------------------------------------ movers

export type ScreenFailure = "price_withheld" | "below_price_floor" | "too_few_prices" | "too_few_sales";

/** Why a row fails the movers screen, or null when it passes. Order matters for tests only. */
export function moversScreenFailure(row: MarketDayRow): ScreenFailure | null {
  if (!row.is_price_fresh || row.usd_price === null) return "price_withheld";
  if (row.usd_price < MOVERS_SCREEN.minPriceUsd) return "below_price_floor";
  if ((row.distinct_prices_365d ?? 0) < MOVERS_SCREEN.minDistinctPrices365d) return "too_few_prices";
  if ((row.units_sold_30d ?? 0) < MOVERS_SCREEN.minUnitsSold30d) return "too_few_sales";
  return null;
}

export interface Mover {
  productId: number;
  usdPrice: number;
  /** Percent points, the period's return. */
  change: number;
  unitsSold30d: number;
}

export interface MoversResult {
  period: MoverPeriod;
  gainers: Mover[];
  losers: Mover[];
  /** Products that passed the screen and have a change for the period. */
  screened: number;
}

function byUnitsThenId(a: Mover, b: Mover): number {
  return b.unitsSold30d - a.unitsSold30d || a.productId - b.productId;
}

/**
 * The period's gainers and losers among screened rows. A change inside the
 * flat band (it prints as 0.0%) is neither.
 */
export function selectMovers(
  rows: readonly MarketDayRow[],
  period: MoverPeriod,
  perSide: number = MOVERS_SCREEN.perSide
): MoversResult {
  const spec = MOVER_PERIODS.find((p) => p.key === period);
  if (!spec) throw new Error(`unknown mover period ${period}`);
  const candidates: Mover[] = [];
  for (const row of rows) {
    if (moversScreenFailure(row) !== null) continue;
    const change = row[spec.column];
    if (change === null) continue;
    candidates.push({
      productId: row.product_id,
      usdPrice: row.usd_price as number,
      change,
      unitsSold30d: row.units_sold_30d as number,
    });
  }
  const gainers = candidates
    .filter((m) => m.change >= FLAT_BAND_PERCENT)
    .sort((a, b) => b.change - a.change || byUnitsThenId(a, b))
    .slice(0, perSide);
  const losers = candidates
    .filter((m) => m.change <= -FLAT_BAND_PERCENT)
    .sort((a, b) => a.change - b.change || byUnitsThenId(a, b))
    .slice(0, perSide);
  return { period, gainers, losers, screened: candidates.length };
}

// ------------------------------------------------------------------ breadth

export interface Breadth30d {
  counted: number;
  up: number;
  down: number;
  flat: number;
  /** Percent of counted members up more than the dead band; null when none counted. */
  pctUp: number | null;
}

/** Headline constituents up over 30 days, WP29's dead band (INDEX_RULES.breadthFlatBandPct). */
export function breadth30d(rows: readonly MarketDayRow[], constituentIds: readonly number[]): Breadth30d {
  const members = new Set(constituentIds);
  const band = INDEX_RULES.breadthFlatBandPct;
  let up = 0;
  let down = 0;
  let flat = 0;
  for (const row of rows) {
    if (!members.has(row.product_id) || !row.is_price_fresh || row.ret_30d === null) continue;
    if (row.ret_30d > band) up += 1;
    else if (row.ret_30d < -band) down += 1;
    else flat += 1;
  }
  const counted = up + down + flat;
  return { counted, up, down, flat, pctUp: counted > 0 ? (up / counted) * 100 : null };
}

// ------------------------------------------------------------------ names and releases

/** Row title (type, with the variant) and subtitle (set name). */
export function productDisplayNames(product: Product): { type: string; set: string } {
  const type = product.product_types?.label || product.product_types?.name || "Sealed product";
  return {
    type: product.variant ? `${type} (${product.variant})` : type,
    set: product.sets?.name ?? "",
  };
}

export interface RecentGroup {
  key: string;
  setName: string;
  setCode: string;
  /** YYYY-MM-DD */
  releaseDate: string;
  /** Active products of the set. */
  total: number;
  /** The rows shown (at most rowsPerSet). */
  products: Product[];
}

function byPriceThenType(a: Product, b: Product): number {
  const pa = a.usd_price;
  const pb = b.usd_price;
  if (pa !== null && pb !== null && pa !== pb) return pb - pa;
  if (pa === null && pb !== null) return 1;
  if (pb === null && pa !== null) return -1;
  return productDisplayNames(a).type.localeCompare(productDisplayNames(b).type) || a.id - b.id;
}

/** The newest sets released on or before `onOrBefore`, with their products. */
export function recentReleaseGroups(
  products: readonly Product[],
  onOrBefore: string,
  sets: number = RECENT_SETS,
  rowsPerSet: number = RECENT_ROWS_PER_SET
): RecentGroup[] {
  const groups = new Map<string, Omit<RecentGroup, "total">>();
  for (const product of products) {
    const set = product.sets;
    const release = set?.release_date?.slice(0, 10);
    if (!set || !isDayKey(release) || release > onOrBefore) continue;
    const key = String(set.id ?? `${set.code}:${set.name}`);
    const group = groups.get(key) ?? { key, setName: set.name, setCode: set.code, releaseDate: release, products: [] };
    group.products.push(product);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) =>
      a.releaseDate < b.releaseDate ? 1 : a.releaseDate > b.releaseDate ? -1 : a.setName.localeCompare(b.setName)
    )
    .slice(0, sets)
    .map((group) => {
      const sorted = [...group.products].sort(byPriceThenType);
      return { ...group, total: sorted.length, products: sorted.slice(0, rowsPerSet) };
    });
}

// ------------------------------------------------------------------ since first tracked

/** [product id, first tracked day] for the given products, sorted by id (a stable cache key). */
export function firstTrackedPairs(
  productIds: readonly number[],
  rowsById: ReadonlyMap<number, MarketDayRow>
): Array<[number, string]> {
  const pairs: Array<[number, string]> = [];
  for (const id of [...new Set(productIds)].sort((a, b) => a - b)) {
    const day = rowsById.get(id)?.first_tracked_day;
    if (isDayKey(day)) pairs.push([id, day]);
  }
  return pairs;
}

/**
 * Keeps only the rows that are exactly a product's first tracked day with a
 * positive price. The read fetches ids x days, a superset.
 */
export function pickFirstTrackedPrices(
  pairs: ReadonlyArray<readonly [number, string]>,
  rows: ReadonlyArray<{ product_id?: number | null; day?: string | null; usd_price?: number | string | null }>
): Record<string, number> {
  const wanted = new Map(pairs.map(([id, day]) => [id, day]));
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (typeof row.product_id !== "number" || wanted.get(row.product_id) !== row.day) continue;
    const price = finite(row.usd_price);
    if (price !== null && price > 0) out[String(row.product_id)] = price;
  }
  return out;
}

/** Percent change since the first tracked price; null when it cannot be shown honestly. */
export function changeSinceFirstTracked(row: MarketDayRow | undefined, firstPrice: number | undefined): number | null {
  if (!row || !row.is_price_fresh || row.usd_price === null) return null;
  if (!row.first_tracked_day || row.first_tracked_day >= row.day) return null;
  if (firstPrice === undefined || !(firstPrice > 0)) return null;
  return (row.usd_price / firstPrice - 1) * 100;
}
```

### Step 3. `app/lib/serverMarketData.ts`: three cached reads

3a. Imports, next to WP29's `./marketIndex` import (add `isIndexCode` there if it is not already imported):

```ts
import { isDayKey, pickFirstTrackedPrices, toMarketDayRows, type MarketDayRow } from "./marketHome";
```

3b. Directly below WP29's `fetchIndexSeries` (above the cached exports block), add:

```ts
// ---- WP32: market home reads ----

/** The product_daily_stats columns the home page reads (lib/marketHome.ts MarketDayRow). */
const MARKET_DAY_SELECT = `product_id, day, usd_price, is_price_fresh, price_day,
  ret_7d, ret_30d, distinct_prices_365d, units_sold_30d, first_tracked_day`;

/** Every product_daily_stats row of one UTC day: a primary-key (day, product_id) range read. */
async function fetchMarketDayRows(day: string): Promise<MarketDayRow[]> {
  if (!isDayKey(day)) return [];
  const supabase = createMarketDataSupabaseClient();
  const rows = await fetchAllRows("product_daily_stats day", (from, to) =>
    supabase
      .from("product_daily_stats")
      .select(MARKET_DAY_SELECT)
      .eq("day", day)
      .order("product_id", { ascending: true })
      .range(from, to)
  );
  return toMarketDayRows(rows);
}

/** One index's constituents for one month (WP29 index_constituents, primary key). */
async function fetchIndexConstituentIds(code: string, month: string): Promise<number[]> {
  if (!isIndexCode(code) || !isDayKey(month)) return [];
  const supabase = createMarketDataSupabaseClient();
  const rows = await fetchAllRows("index_constituents", (from, to) =>
    supabase
      .from("index_constituents")
      .select("product_id")
      .eq("index_code", code)
      .eq("month", month)
      .order("product_id", { ascending: true })
      .range(from, to)
  );
  return rows.map((row) => row.product_id).filter((id): id is number => typeof id === "number");
}

/**
 * The price on each product's first tracked day. One read of ids x days on
 * the primary key (PostgREST or-groups are avoided: the perf fixture does not
 * support them), filtered to the exact pairs.
 */
async function fetchFirstTrackedPrices(
  pairs: ReadonlyArray<readonly [number, string]>
): Promise<Record<string, number>> {
  if (pairs.length === 0) return {};
  const ids = [...new Set(pairs.map(([id]) => id))];
  const days = [...new Set(pairs.map(([, day]) => day))];
  const supabase = createMarketDataSupabaseClient();
  const rows = await fetchAllRows("product_daily_stats first tracked", (from, to) =>
    supabase
      .from("product_daily_stats")
      .select("product_id, day, usd_price")
      .in("product_id", ids)
      .in("day", days)
      .order("product_id", { ascending: true })
      .order("day", { ascending: true })
      .range(from, to)
  );
  return pickFirstTrackedPrices(pairs, rows);
}
```

3c. At the end of the cached exports block (after WP29's `getCachedIndexSeries`), add:

```ts
const getCachedMarketDayRows = unstable_cache(fetchMarketDayRows, ["market-day-stats-v1"], {
  revalidate: DAILY_BACKSTOP_SECONDS,
  tags: [CACHE_TAGS.marketProducts],
});

/**
 * product_daily_stats rows of one UTC day (WP32 home: movers, 30D breadth,
 * new releases). [] when the day has no rows; null (uncached) when the read
 * failed, so the page shows "not available", never an empty market.
 */
export async function getCachedMarketDayStats(day: string): Promise<MarketDayRow[] | null> {
  try {
    return await getCachedMarketDayRows(day);
  } catch (error) {
    logCaughtError("server_market_day_stats_failed", error);
    return null;
  }
}

const getCachedIndexConstituentIds = unstable_cache(fetchIndexConstituentIds, ["index-constituents-v1"], {
  revalidate: DAILY_BACKSTOP_SECONDS,
  tags: [CACHE_TAGS.marketProducts],
});

/** Product ids of one index for one month (WP32). null (uncached) when the read failed. */
export async function getCachedIndexConstituents(code: string, month: string): Promise<number[] | null> {
  try {
    return await getCachedIndexConstituentIds(code, month);
  } catch (error) {
    logCaughtError("server_index_constituents_failed", error);
    return null;
  }
}

const getCachedFirstTrackedPriceMap = unstable_cache(fetchFirstTrackedPrices, ["first-tracked-prices-v1"], {
  revalidate: DAILY_BACKSTOP_SECONDS,
  tags: [CACHE_TAGS.marketProducts],
});

/**
 * Product id (string) -> USD price on its first tracked day, for the given
 * [id, day] pairs (WP32 Recently released). Pass firstTrackedPairs(): sorted,
 * so equal inputs share a cache entry. null (uncached) when the read failed.
 */
export async function getCachedFirstTrackedPrices(
  pairs: ReadonlyArray<readonly [number, string]>
): Promise<Record<string, number> | null> {
  try {
    return await getCachedFirstTrackedPriceMap(pairs);
  } catch (error) {
    logCaughtError("server_first_tracked_prices_failed", error);
    return null;
  }
}
```

Never call these from inside another `unstable_cache` callback (WP11's nested-cache rule). If `tsc` rejects the row types of `fetchAllRows` (for example `usd_price` typed `number` where `MarketDayRowRaw` expects `number | string | null`), annotate the variable (`const rows: MarketDayRowRaw[] = await fetchAllRows(...)`) as WP25 does; never cast the client to `any`. If `unstable_cache` rejects the readonly tuple parameter type, change the parameter to `Array<[number, string]>` in both `fetchFirstTrackedPrices` and the wrapper.

### Step 4. Perf fixture: `scripts/fixtures/perf.mjs`

WP22 rule: every new data endpoint gets a fixture route in the same PR, and the perf build fails on a request without one ("no fixture route").

4a. Add this function directly above `buildPerfData` (it uses the file's `DAY_MS`; no PRNG draw, so every recorded limit keeps its value):

```js
/**
 * WP32: product_daily_stats rows for the home page (yesterday's whole day and
 * each product's first tracked day) and the headline index constituents for
 * yesterday's month. Derived from WP25's productStats without random draws.
 */
export function buildHomeFixture({ nowMs, productStats }) {
  const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
  const now = new Date(nowMs);
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const yesterday = isoDate(todayMs - DAY_MS);
  const productDailyStats = [];
  for (const row of productStats) {
    productDailyStats.push({ ...row, day: yesterday, refreshed_at: `${isoDate(todayMs)}T00:30:00.000Z` });
    if (row.first_tracked_day && row.first_tracked_day < yesterday) {
      productDailyStats.push({
        ...row,
        day: row.first_tracked_day,
        usd_price: row.usd_price === null ? null : Math.round(row.usd_price * 80) / 100,
        is_price_fresh: row.usd_price !== null,
        ret_1d: null,
        ret_7d: null,
        ret_30d: null,
        ret_90d: null,
        ret_365d: null,
        refreshed_at: `${row.first_tracked_day}T23:59:00.000Z`,
      });
    }
  }
  const month = `${yesterday.slice(0, 7)}-01`;
  const indexConstituents = productStats
    .filter((r) => r.is_price_fresh && r.usd_price !== null && r.usd_price >= 15)
    .slice(0, 212)
    .map((r) => ({ index_code: "sealed", month, product_id: r.product_id }));
  return { productDailyStats, indexConstituents };
}
```

4b. In `buildPerfData`, directly above the final `return { ... };` (after WP29's `buildIndexFixture` line), add:

```js
  // WP32: home page reads (no random draws; see buildHomeFixture).
  const { productDailyStats, indexConstituents } = buildHomeFixture({ nowMs, productStats });
```

and add `productDailyStats, indexConstituents` to the returned object. If `productStats` has another name in the file, use WP25's variable (the rows behind `"/rest/v1/product_stats_latest"`).

4c. In `perfRoutes()`, below WP29's `"/rest/v1/index_definitions"` entry, add:

```js
    "/rest/v1/product_daily_stats": rows("productDailyStats"),
    "/rest/v1/index_constituents": rows("indexConstituents"),
```

If a route for either path already exists (a package that landed in between added it), keep one entry and merge the rows (concatenate, dropping exact duplicates of `(day, product_id)`).

### Step 5. Portfolio summary: repo function, pure summary, client helper, route

5a. `app/lib/server/portfolioRepo.ts`: append (it reuses the module-private `HOLDING_SELECT`, `loadGuardedProducts` and `guardHoldings`; if WP10 or a later package changed the holdings query inside `loadPortfolioPayload`, copy that query's current `.select(...)` and guard lines instead of the ones below):

```ts
/**
 * The caller's holdings for the home page strip (WP32), with the freshness
 * verdict applied. Unlike loadPortfolioPayload it never creates a portfolio:
 * a signed-in visitor who never opened /portfolio gets []. null on a failed
 * read, so the strip says "could not be loaded", not "empty".
 */
export async function loadPortfolioGlanceHoldings(
  supabase: RouteSupabase,
  userId: string
): Promise<HoldingWithProduct[] | null> {
  const productsPromise = loadGuardedProducts();
  let portfolioId: number | null;
  try {
    portfolioId = await findPortfolioId(supabase, userId);
  } catch {
    return null; // findPortfolioId logged it
  }
  if (portfolioId === null) return [];
  const { data, error } = await supabase
    .from("portfolio_holdings")
    .select(HOLDING_SELECT)
    .eq("portfolio_id", portfolioId);
  if (error) {
    logSupabaseError("holdings_glance_fetch_failed", error);
    return null;
  }
  return guardHoldings((data ?? []) as unknown as HoldingWithProduct[], await productsPromise);
}
```

5b. `app/lib/portfolioGlance.ts` (new; imported by the client island, so it imports nothing at runtime):

```ts
/**
 * The home page's "Your Pokéfin" strip (WP32): the shape GET
 * /api/portfolio/summary returns, its validator and the browser fetch.
 * Amounts are USD; the island converts them with useCurrency().
 */
export const PORTFOLIO_GLANCE_PATH = "/api/portfolio/summary";

export interface PortfolioGlance {
  /** Holding rows. */
  holdings: number;
  units: number;
  /** Holdings with a current (guarded) price. */
  priced: number;
  valueUsd: number | null;
  dayChangeUsd: number | null;
  /** Percent points, 1 decimal. */
  dayChangePct: number | null;
  /** Holdings with a known 1-day change. */
  dayChangeCovered: number;
  /** product_daily_stats day of the 1-day changes (YYYY-MM-DD), or null. */
  asOf: string | null;
}

const isCount = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isNumOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));

export function isPortfolioGlance(value: unknown): value is PortfolioGlance {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    isCount(v.holdings) &&
    typeof v.units === "number" &&
    Number.isFinite(v.units) &&
    isCount(v.priced) &&
    isNumOrNull(v.valueUsd) &&
    isNumOrNull(v.dayChangeUsd) &&
    isNumOrNull(v.dayChangePct) &&
    isCount(v.dayChangeCovered) &&
    (v.asOf === null || (typeof v.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.asOf)))
  );
}

/** Throws on a non-2xx answer, a network failure, an abort or an unexpected body. */
export async function fetchPortfolioGlance(signal?: AbortSignal): Promise<PortfolioGlance> {
  const res = await fetch(PORTFOLIO_GLANCE_PATH, {
    method: "GET",
    headers: { "x-pokefin-request": "1" },
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new Error(`portfolio summary: HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (!isPortfolioGlance(body)) throw new Error("portfolio summary: unexpected body");
  return body;
}
```

5c. `app/lib/portfolioGlanceSummary.ts` (new; server side of the same contract, pure):

```ts
import type { HoldingWithProduct } from "../types/portfolio";
import { statsFor, type ProductStatsSnapshot } from "./marketStats";
import type { PortfolioGlance } from "./portfolioGlance";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Value and 1-day change of guarded holdings (WP32). The value uses WP05's
 * guarded price; the 1-day change uses WP25's latest ret_1d, only where the
 * stats row is fresh. Amounts in USD.
 */
export function summarizeHoldings(
  holdings: readonly HoldingWithProduct[],
  stats: ProductStatsSnapshot
): PortfolioGlance {
  let units = 0;
  let priced = 0;
  let value = 0;
  let change = 0;
  let base = 0;
  let covered = 0;
  for (const holding of holdings) {
    const qty = typeof holding.quantity === "number" && Number.isFinite(holding.quantity) && holding.quantity > 0
      ? holding.quantity
      : 0;
    units += qty;
    const price = holding.products?.usd_price;
    if (qty === 0 || typeof price !== "number" || !Number.isFinite(price)) continue;
    priced += 1;
    value += qty * price;
    const s = statsFor(stats, holding.product_id);
    if (!s || !s.is_price_fresh || s.usd_price === null || s.ret_1d === null) continue;
    const previous = s.usd_price / (1 + s.ret_1d / 100);
    if (!Number.isFinite(previous) || previous <= 0) continue;
    change += qty * (s.usd_price - previous);
    base += qty * previous;
    covered += 1;
  }
  return {
    holdings: holdings.length,
    units,
    priced,
    valueUsd: priced > 0 ? round2(value) : null,
    dayChangeUsd: covered > 0 ? round2(change) : null,
    dayChangePct: covered > 0 && base > 0 ? Math.round((change / base) * 1000) / 10 : null,
    dayChangeCovered: covered,
    asOf: stats.day,
  };
}
```

5d. `app/api/portfolio/summary/route.ts` (new; same gates as WP05's `GET /api/portfolio`):

```ts
import { NextRequest } from "next/server";
import { createRouteSupabaseClient } from "../../../lib/routeSupabase";
import { rejectIfNotAppRequest } from "../../../lib/csrf";
import { jsonNoStore, requireRouteUser } from "../../../lib/routeAuth";
import { loadPortfolioGlanceHoldings } from "../../../lib/server/portfolioRepo";
import { getCachedProductStats } from "../../../lib/serverMarketData";
import { summarizeHoldings } from "../../../lib/portfolioGlanceSummary";
import { logCaughtError } from "../../../lib/logger";

const LOAD_FAILED = "Failed to load portfolio summary";

/**
 * The home page strip (WP32): value, holding counts and 1-day change of the
 * caller's portfolio, in USD. Never creates a portfolio. Private: no-store,
 * never cached by the CDN, and the home page itself never reads cookies, so
 * its ISR shell is the same for everyone.
 */
export async function GET(req: NextRequest) {
  const forbidden = rejectIfNotAppRequest(req);
  if (forbidden) return forbidden;

  try {
    const supabase = await createRouteSupabaseClient();
    const auth = await requireRouteUser(supabase);
    if (auth.response) return auth.response;

    const [holdings, stats] = await Promise.all([
      loadPortfolioGlanceHoldings(supabase, auth.user.id),
      getCachedProductStats(),
    ]);
    if (holdings === null) return jsonNoStore({ error: LOAD_FAILED }, 500);
    return jsonNoStore(summarizeHoldings(holdings, stats));
  } catch (error) {
    logCaughtError("portfolio_summary_failed", error);
    return jsonNoStore({ error: LOAD_FAILED }, 500);
  }
}
```

`proxy.ts` already runs for `/api/*` (rate limit, session refresh); nothing to change there. WP05's ESLint guard allows `.from("portfolio_holdings")` in `app/lib/server/**`.

### Step 6. `app/components/Price.tsx` (new): the currency leaf

```tsx
"use client";

import { useCurrency } from "../context/CurrencyContext";

/**
 * A USD price in the visitor's display currency (WP32). A client leaf, so a
 * server-rendered, CDN-cached page still follows the header's USD/CAD
 * toggle: the server HTML is CAD at the layout's rate (the default currency)
 * and the stored preference applies right after hydration without a
 * mismatch (WP20). "--" for a withheld price.
 */
export default function Price({ usd, className = "" }: { usd: number | null | undefined; className?: string }) {
  const { formatPrice } = useCurrency();
  return <span className={`tabular-nums ${className}`}>{formatPrice(usd)}</span>;
}
```

### Step 7. `app/indices/sealed/IndexChart.tsx` (WP29): a compact size

The index page must render exactly as before (default `size="page"`).

- Change the signature to `export default function IndexChart({ points, title, size = "page" }: { points: readonly IndexPoint[]; title: string; size?: "page" | "compact" }) {`.
- Above the component add:

```ts
/** Chart box heights: the index page, and the home page card (WP32). */
const HEIGHT: Readonly<Record<"page" | "compact", string>> = {
  page: "h-56 md:h-72",
  compact: "h-40 md:h-56",
};
```

- In the "No history" `div`, replace `h-56` and `md:h-72` in its class list with `${HEIGHT[size]}` (make the attribute a template literal). In `<div className="relative h-56 md:h-72">`, do the same: `` className={`relative ${HEIGHT[size]}`} ``.
- Check: `grep -n "h-56\|md:h-72" app/indices/sealed/IndexChart.tsx` prints only the `HEIGHT` line.

### Step 8. Home components (new, `app/components/home/`)

All server components unless marked `"use client"`. Token utilities only.

8a. `WarnNote.tsx`:

```tsx
import type { ReactNode } from "react";
import { WarnIcon } from "../ui/icons";

/** A one-line warning in the amber role (provisional or overdue index, WP32). */
export default function WarnNote({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="note"
      className={`flex items-start gap-2 rounded-control border border-line bg-warn-fill p-3 text-small text-warn-text ${className}`}
    >
      <WarnIcon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
```

8b. `homeStyles.ts`:

```ts
/** The inline text link used across the home sections (WP23 action colour). */
export const HOME_LINK =
  "rounded-control font-medium text-action underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center";

/** The card shell of every home section. */
export const HOME_CARD = "rounded-card border border-line bg-surface p-4 md:p-5";
```

8c. `HomeIntro.tsx`:

```tsx
import AsOf from "../ui/AsOf";
import ProvenanceLine from "../ui/ProvenanceLine";
import SearchTrigger from "../search/SearchTrigger";
import { SearchIcon } from "../search/SearchField";
import { PROVENANCE_SENTENCE } from "../../content/disclosures";
import { formatInteger } from "../../lib/format";

/**
 * What Pokéfin is and why the numbers can be trusted, in one line, plus the
 * search trigger that opens WP27's GlobalSearch (WP32).
 */
export default function HomeIntro({
  productCount,
  newestPricedAt,
  referenceDate,
}: {
  productCount: number;
  newestPricedAt: string | null;
  referenceDate: string;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0 md:max-w-3xl">
        <h1 className="text-h1 font-semibold tracking-tight text-ink">Sealed Pokémon TCG market</h1>
        <ProvenanceLine methodologyHref="/methodology" className="mt-1">
          {formatInteger(productCount)} sealed products. {PROVENANCE_SENTENCE}
          {newestPricedAt && (
            <>
              {" "}
              <AsOf date={newestPricedAt} referenceDate={referenceDate} prefix="Prices as of" />.
            </>
          )}
        </ProvenanceLine>
      </div>
      <SearchTrigger className="flex h-11 w-full shrink-0 items-center gap-2 rounded-control border border-line bg-surface px-3 text-left text-body text-ink-soft transition-colors duration-150 hover:border-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action motion-reduce:transition-none md:w-80">
        <SearchIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search products, sets or set codes</span>
        <kbd
          aria-hidden="true"
          className="hidden rounded-control border border-line px-1.5 text-caption font-medium text-ink-soft pointer-fine:inline"
        >
          /
        </kbd>
      </SearchTrigger>
    </div>
  );
}
```

8d. `IndexHeader.tsx`:

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import Delta from "../ui/Delta";
import MetricLabel from "../ui/MetricLabel";
import Stat from "../ui/Stat";
import WarnNote from "./WarnNote";
import { HOME_CARD, HOME_LINK } from "./homeStyles";
import { formatDateOnly, formatDecimal, formatInteger, formatPercent } from "../../lib/format";
import {
  HEADLINE_INDEX_NAME,
  INDEX_CHANGE_WINDOWS,
  INDEX_PAGE_PATH,
  isIndexOverdue,
  type IndexChangeKey,
  type IndexSummary,
} from "../../lib/marketIndex";
import type { Breadth30d } from "../../lib/marketHome";

/** sr-only reason for a change without an anchor, from the view's windows (WP29). */
export function indexChangeMissingReason(key: IndexChangeKey): string {
  const w = INDEX_CHANGE_WINDOWS.find((x) => x.key === key);
  if (!w || w.toleranceDays === 0) return "No level for the previous day";
  if (w.days >= 365) return "Less than a year of levels";
  return `No level ${w.days} to ${w.days + w.toleranceDays} days earlier`;
}

function CloseOf({ day }: { day: string }) {
  return (
    <>
      as of the close of <time dateTime={day}>{formatDateOnly(day)}</time> (UTC)
    </>
  );
}

function Item({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-small text-ink-soft">{label}</dt>
      <dd className="mt-0.5 text-body font-semibold tabular-nums text-ink">
        {value}
        {sub && <span className="ml-1.5 font-normal text-ink-soft">{sub}</span>}
      </dd>
    </div>
  );
}

function HomeBreadth({ headline, breadth }: { headline: IndexSummary; breadth: Breadth30d | null }) {
  const counted = headline.adv7d + headline.dec7d + headline.flat7d;
  if (counted === 0) {
    return (
      <p className="mt-4 border-t border-line pt-4 text-small text-ink-soft">
        No constituent has a 7-day change for this day.
      </p>
    );
  }
  const share = (n: number) => formatPercent((n / counted) * 100, { decimals: 0 });
  const pctUp = breadth?.pctUp ?? null;
  return (
    <dl data-home="breadth" className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4">
      <Item
        label={<MetricLabel metric="advancers7d" />}
        value={
          <span className="text-gain-text">
            <span aria-hidden="true">▲ </span>
            {formatInteger(headline.adv7d)}
          </span>
        }
        sub={share(headline.adv7d)}
      />
      <Item
        label={<MetricLabel metric="decliners7d" />}
        value={
          <span className="text-loss-text">
            <span aria-hidden="true">▼ </span>
            {formatInteger(headline.dec7d)}
          </span>
        }
        sub={share(headline.dec7d)}
      />
      <Item
        label={<MetricLabel metric="pctUp30d" />}
        value={
          pctUp === null ? (
            <>
              <span aria-hidden="true">--</span>
              <span className="sr-only">Not available</span>
            </>
          ) : (
            formatPercent(pctUp, { decimals: 0 })
          )
        }
        sub={pctUp === null || !breadth ? undefined : `of ${formatInteger(breadth.counted)}`}
      />
      <Item
        label={<MetricLabel metric="newHighsLows52w" />}
        value={`${formatInteger(headline.newHigh52w)} / ${formatInteger(headline.newLow52w)}`}
      />
    </dl>
  );
}

function Figures({ headline, breadth, today }: { headline: IndexSummary; breadth: Breadth30d | null; today: string }) {
  const windows: Array<[string, number | null, IndexChangeKey]> = [
    ["7D", headline.chg7d, "chg7d"],
    ["30D", headline.chg30d, "chg30d"],
    ["1Y", headline.chg365d, "chg365d"],
  ];
  return (
    <>
      <div data-home="index-level" className="mt-2">
        <Stat
          size="hero"
          label={<MetricLabel metric="indexLevel" />}
          value={formatDecimal(headline.level)}
          delta={<Delta value={headline.chg1d} period="1D" missingReason={indexChangeMissingReason("chg1d")} />}
          asOf={<CloseOf day={headline.day} />}
        />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        {windows.map(([label, value, key]) => (
          <div key={key}>
            <dt className="text-small text-ink-soft">{label}</dt>
            <dd className="mt-0.5 text-body">
              <Delta value={value} missingReason={indexChangeMissingReason(key)} />
            </dd>
          </div>
        ))}
      </dl>
      {headline.provisional && (
        <WarnNote className="mt-3">
          Provisional: {formatInteger(headline.nContributing)} of {formatInteger(headline.nConstituents)} constituents (
          {formatPercent(headline.coveragePct, { decimals: 0 })}) were priced on {formatDateOnly(headline.day)}.{" "}
          <Link href="/methodology#index-calculation" prefetch={false} className={HOME_LINK}>
            How provisional days work
          </Link>
        </WarnNote>
      )}
      {isIndexOverdue(headline.day, today) && (
        <WarnNote className="mt-3">
          Not updated since {formatDateOnly(headline.day)}. The index is published each night for the previous day.
        </WarnNote>
      )}
      <HomeBreadth headline={headline} breadth={breadth} />
    </>
  );
}

/** The market header's index card (WP32): level, changes, notes and breadth. */
export default function IndexHeader({
  summaries,
  headline,
  breadth,
  today,
}: {
  /** null: the read failed. */
  summaries: IndexSummary[] | null;
  headline: IndexSummary | null;
  breadth: Breadth30d | null;
  today: string;
}) {
  return (
    <section aria-labelledby="index-h" className={`h-full ${HOME_CARD}`}>
      <h2 id="index-h" className="text-h3 font-semibold text-ink">
        <Link
          href={INDEX_PAGE_PATH}
          prefetch={false}
          className="rounded-control hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
        >
          {HEADLINE_INDEX_NAME}
        </Link>
      </h2>
      {summaries === null ? (
        <p className="mt-2 text-small text-ink-soft">
          The index could not be loaded. This is usually temporary. Reload the page in a minute.
        </p>
      ) : headline === null ? (
        <p className="mt-2 text-small text-ink-soft">
          The Sealed Index is not published yet. Levels appear after the first nightly run.{" "}
          <Link href="/methodology#index" prefetch={false} className={HOME_LINK}>
            How the index works
          </Link>
        </p>
      ) : (
        <Figures headline={headline} breadth={breadth} today={today} />
      )}
    </section>
  );
}
```

If WP29 did not export `IndexChangeKey` (`grep -n "export type IndexChangeKey" app/lib/marketIndex.ts`), declare it locally as `type IndexChangeKey = (typeof INDEX_CHANGE_WINDOWS)[number]["key"];`.

8e. `IndexChartCard.tsx`:

```tsx
import Link from "next/link";
import IndexChart from "../../indices/sealed/IndexChart";
import { HOME_CARD, HOME_LINK } from "./homeStyles";
import { HEADLINE_INDEX_NAME, INDEX_PAGE_PATH, type IndexPoint } from "../../lib/marketIndex";

/**
 * The 1Y Sealed Index chart (WP29's server SVG, compact). No client
 * JavaScript. Its link is a pointer convenience only (aria-hidden, out of the
 * tab order): on phones this card is moved below the movers by CSS order, and
 * keyboard users reach the index page from the index card's heading.
 */
export default function IndexChartCard({ points }: { points: IndexPoint[] | null }) {
  return (
    <section aria-labelledby="index-chart-h" className={`h-full ${HOME_CARD}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="index-chart-h" className="text-h3 font-semibold text-ink">
          Sealed Index, last 12 months
        </h2>
        <Link href={INDEX_PAGE_PATH} prefetch={false} aria-hidden="true" tabIndex={-1} className={HOME_LINK}>
          Open the index
        </Link>
      </div>
      <div className="mt-3">
        {points === null ? (
          <p className="flex h-40 items-center justify-center rounded-control border border-dashed border-line text-small text-ink-soft md:h-56">
            The index history could not be loaded.
          </p>
        ) : (
          <IndexChart points={points} title={HEADLINE_INDEX_NAME} size="compact" />
        )}
      </div>
    </section>
  );
}
```

8f. `MoversPeriodSwitch.tsx` (`"use client"`):

```tsx
"use client";

import { useState, type ReactNode } from "react";
import SegmentedControl from "../ui/SegmentedControl";
import { DEFAULT_MOVER_PERIOD, MOVER_PERIODS, type MoverPeriod } from "../../lib/moverPeriods";

/**
 * Switches the server-rendered 7D and 30D movers panels (WP32). Both panels
 * are in the HTML; a switch flips the hidden attribute and makes no request.
 * Without JavaScript the 7D panel shows.
 */
export default function MoversPeriodSwitch({
  heading,
  panels,
}: {
  heading: ReactNode;
  panels: Readonly<Record<MoverPeriod, ReactNode>>;
}) {
  const [period, setPeriod] = useState<MoverPeriod>(DEFAULT_MOVER_PERIOD);
  const [announcement, setAnnouncement] = useState("");
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {heading}
        <SegmentedControl<MoverPeriod>
          label="Movers period"
          hideLabel
          fullWidthOnPhone={false}
          options={MOVER_PERIODS.map((p) => ({ value: p.key, label: p.label, ariaLabel: `${p.days} days` }))}
          value={period}
          onChange={(next) => {
            setPeriod(next);
            const days = MOVER_PERIODS.find((p) => p.key === next)?.days;
            setAnnouncement(`Showing ${days}-day movers`);
          }}
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {MOVER_PERIODS.map((p) => (
        <div key={p.key} data-period={p.key} hidden={p.key !== period}>
          {panels[p.key]}
        </div>
      ))}
    </>
  );
}
```

8g. `MoversSection.tsx`:

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import Badge from "../ui/Badge";
import { DataList, DataListRow } from "../ui/DataList";
import DecisionNote from "../ui/DecisionNote";
import Delta from "../ui/Delta";
import MiniSparkline from "../MarketView/MiniSparkline";
import Price from "../Price";
import MoversPeriodSwitch from "./MoversPeriodSwitch";
import { HOME_CARD, HOME_LINK } from "./homeStyles";
import { productHref, SCREENER } from "../nav/navConfig";
import { formatDateOnly, formatInteger } from "../../lib/format";
import { daysBetweenKeys } from "../../lib/marketIndex";
import { MOVERS_SCREEN, productDisplayNames, type Mover, type MoversResult } from "../../lib/marketHome";
import { MOVER_PERIODS, type MoverPeriod } from "../../lib/moverPeriods";
import { sparklineFor, type SparklinePayload } from "../../lib/sparkline";
import type { Product } from "../../types/market";

export function ThroughDay({ day, today }: { day: string; today: string }) {
  const age = daysBetweenKeys(day, today);
  return (
    <p className="flex flex-wrap items-center gap-2 text-caption text-ink-soft">
      <span>
        Through <time dateTime={day}>{formatDateOnly(day)}</time> (UTC){age <= 0 ? ", day in progress" : ""}
      </span>
      {age >= 2 && <Badge variant="warn">Not updated since {formatDateOnly(day)}</Badge>}
    </p>
  );
}

function MoverColumn({
  title,
  movers,
  emptyText,
  period,
  productsById,
  sparklines,
}: {
  title: string;
  movers: Mover[];
  emptyText: string;
  period: string;
  productsById: ReadonlyMap<number, Product>;
  sparklines: SparklinePayload | null;
}) {
  return (
    <div className="min-w-0">
      <h3 className="text-small font-semibold text-ink-soft">{title}</h3>
      {movers.length === 0 ? (
        <p className="mt-2 rounded-card border border-dashed border-line px-4 py-6 text-center text-small text-ink-soft">
          {emptyText}
        </p>
      ) : (
        <DataList label={title} className="mt-2 overflow-hidden rounded-card border">
          {movers.map((m) => {
            const product = productsById.get(m.productId);
            if (!product) return null;
            const names = productDisplayNames(product);
            return (
              <DataListRow
                key={m.productId}
                href={productHref(m.productId)}
                title={names.type}
                subtitle={names.set}
                meta={`${formatInteger(m.unitsSold30d)} sold 30D`}
                value={<Price usd={m.usdPrice} />}
                delta={<Delta value={m.change} period={period} />}
                sparkline={
                  sparklines ? <MiniSparkline series={sparklineFor(sparklines, m.productId)} size="row" /> : undefined
                }
              />
            );
          })}
        </DataList>
      )}
    </div>
  );
}

/** Screened gainers and losers for 7D and 30D (WP32, research/data-opportunities.md §3.6). */
export default function MoversSection({
  day,
  today,
  movers,
  productsById,
  sparklines,
}: {
  /** The statistics day, or null when no statistics could be read. */
  day: string | null;
  today: string;
  movers: Readonly<Record<MoverPeriod, MoversResult>> | null;
  productsById: ReadonlyMap<number, Product>;
  sparklines: Readonly<Record<MoverPeriod, SparklinePayload | null>>;
}) {
  const heading = (
    <div>
      <h2 id="movers-h" className="text-h2 font-semibold text-ink">
        Movers
      </h2>
      {day && <ThroughDay day={day} today={today} />}
    </div>
  );

  if (day === null || movers === null) {
    return (
      <section aria-labelledby="movers-h" className={HOME_CARD}>
        {heading}
        <p className="mt-3 text-small text-ink-soft">
          Movers are not available right now. The daily statistics could not be read.
        </p>
      </section>
    );
  }

  const panels = Object.fromEntries(
    MOVER_PERIODS.map((p) => [
      p.key,
      <div key={p.key} className="mt-3 grid gap-4 md:grid-cols-2">
        <MoverColumn
          title={`Gainers ${p.label}`}
          movers={movers[p.key].gainers}
          emptyText={`No product passed the screen with a gain over ${p.days} days.`}
          period={p.label}
          productsById={productsById}
          sparklines={sparklines[p.key]}
        />
        <MoverColumn
          title={`Losers ${p.label}`}
          movers={movers[p.key].losers}
          emptyText={`No product passed the screen with a fall over ${p.days} days.`}
          period={p.label}
          productsById={productsById}
          sparklines={sparklines[p.key]}
        />
      </div>,
    ])
  ) as Record<MoverPeriod, ReactNode>;

  return (
    <section aria-labelledby="movers-h" className={HOME_CARD}>
      <MoversPeriodSwitch heading={heading} panels={panels} />
      <p className="mt-4 text-small text-ink-soft">
        Screened for liquidity: a Market Price of at least ${MOVERS_SCREEN.minPriceUsd} USD, at least{" "}
        {MOVERS_SCREEN.minDistinctPrices365d} different daily prices in the past year and at least{" "}
        {MOVERS_SCREEN.minUnitsSold30d} units sold in 30 days.{" "}
        <Link href={SCREENER.href} prefetch={false} className={HOME_LINK}>
          Open the {SCREENER.label}
        </Link>
      </p>
      <DecisionNote anchor="movers" className="mt-2" />
    </section>
  );
}
```

If `daysBetweenKeys` is not exported by `marketIndex.ts`, import `daysBetween` from `../ui/AsOf` (WP23) instead; they compute the same thing.

8h. `SubIndexStrip.tsx`:

```tsx
import Link from "next/link";
import Delta from "../ui/Delta";
import { formatDateOnly, formatDecimal } from "../../lib/format";
import { INDEX_PAGE_PATH, INDEX_TYPE_FAMILY, type IndexSummary } from "../../lib/marketIndex";
import { indexChangeMissingReason } from "./IndexHeader";

/** The four product-type indices with their 30D change (WP32), linking to the index page. */
export default function SubIndexStrip({ headline, subIndices }: { headline: IndexSummary; subIndices: readonly IndexSummary[] }) {
  const byCode = new Map(subIndices.map((s) => [s.code, s]));
  return (
    <section aria-labelledby="types-h">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="types-h" className="text-h3 font-semibold text-ink">
          By product type
        </h2>
        <p className="text-caption text-ink-soft">
          30D change, as of the close of <time dateTime={headline.day}>{formatDateOnly(headline.day)}</time> (UTC)
        </p>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {INDEX_TYPE_FAMILY.map((t) => {
          const s = byCode.get(t.code);
          return (
            <li key={t.code}>
              <Link
                href={INDEX_PAGE_PATH}
                prefetch={false}
                className="flex min-h-11 flex-col gap-1 rounded-card border border-line bg-surface p-3 transition-colors duration-150 hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action motion-reduce:transition-none"
              >
                <span className="truncate text-small font-medium text-ink">{t.label}</span>
                <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-body font-semibold tabular-nums text-ink">{s ? formatDecimal(s.level) : "--"}</span>
                  <Delta
                    value={s ? s.chg30d : null}
                    period="30D"
                    missingReason={s ? indexChangeMissingReason("chg30d") : "Not published"}
                    className="text-small"
                  />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

8i. `RecentReleases.tsx`:

```tsx
import Link from "next/link";
import { DataList, DataListRow } from "../ui/DataList";
import Delta from "../ui/Delta";
import Price from "../Price";
import { ThroughDay } from "./MoversSection";
import { HOME_LINK } from "./homeStyles";
import { productHref, setSearchHref } from "../nav/navConfig";
import { formatDateOnly, formatInteger, formatMonthDay } from "../../lib/format";
import {
  changeSinceFirstTracked,
  productDisplayNames,
  type MarketDayRow,
  type RecentGroup,
} from "../../lib/marketHome";

function sinceLabel(firstDay: string, day: string): string {
  return `since ${firstDay.slice(0, 4) === day.slice(0, 4) ? formatMonthDay(firstDay) : formatDateOnly(firstDay)}`;
}

/** The newest sets as compact rows (WP32): type, price, change since first tracked, units sold 30D. */
export default function RecentReleases({
  day,
  today,
  groups,
  rowsById,
  firstPrices,
}: {
  day: string | null;
  today: string;
  groups: readonly RecentGroup[];
  rowsById: ReadonlyMap<number, MarketDayRow>;
  /** null: the read failed (every change shows "--"). */
  firstPrices: Readonly<Record<string, number>> | null;
}) {
  return (
    <section aria-labelledby="recent-h">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="recent-h" className="text-h2 font-semibold text-ink">
          Recently released
        </h2>
        {day && <ThroughDay day={day} today={today} />}
      </div>
      {groups.length === 0 || day === null ? (
        <p className="mt-3 text-small text-ink-soft">No set in the catalog has been released yet.</p>
      ) : (
        <div className="mt-3 grid gap-6 lg:grid-cols-2">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`recent-${group.key}`} className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 id={`recent-${group.key}`} className="text-h3 font-semibold text-ink">
                  {group.setName}
                </h3>
                <p className="text-caption text-ink-soft">
                  <span className="uppercase tracking-wide tabular-nums">{group.setCode}</span> · Released{" "}
                  <time dateTime={group.releaseDate}>{formatDateOnly(group.releaseDate)}</time>
                </p>
              </div>
              <DataList label={`${group.setName} products`} className="mt-2 overflow-hidden rounded-card border">
                {group.products.map((product) => {
                  const row = rowsById.get(product.id);
                  const price = row && row.is_price_fresh ? row.usd_price : null;
                  const change = changeSinceFirstTracked(row, firstPrices?.[String(product.id)]);
                  const units = row?.units_sold_30d ?? null;
                  return (
                    <DataListRow
                      key={product.id}
                      href={productHref(product.id)}
                      title={productDisplayNames(product).type}
                      meta={units === null ? "No sales data" : `${formatInteger(units)} sold 30D`}
                      value={<Price usd={price} />}
                      delta={
                        <Delta
                          value={change}
                          period={row?.first_tracked_day && change !== null ? sinceLabel(row.first_tracked_day, day) : undefined}
                          missingReason={price === null ? "No current price" : "No first tracked price"}
                        />
                      }
                    />
                  );
                })}
              </DataList>
              {group.total > group.products.length && (
                <p className="mt-2 text-small">
                  <Link href={setSearchHref(group.setName)} prefetch={false} className={HOME_LINK}>
                    All {formatInteger(group.total)} {group.setName} products
                  </Link>
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
```

`group.key` can contain `:` (fallback key); use `` `recent-${group.key.replace(/[^A-Za-z0-9_-]/g, "-")}` `` for both `id` and `aria-labelledby` if the set has no `id`.

8j. `YourPokefin.tsx` (`"use client"`):

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../../context/AuthContext";
import { useCurrency } from "../../context/CurrencyContext";
import AsOf from "../ui/AsOf";
import { buttonClasses } from "../ui/Button";
import Delta from "../ui/Delta";
import Skeleton from "../ui/Skeleton";
import Stat from "../ui/Stat";
import { HOME_CARD, HOME_LINK } from "./homeStyles";
import { formatInteger } from "../../lib/format";
import { fetchPortfolioGlance, type PortfolioGlance } from "../../lib/portfolioGlance";

type Loaded = { userId: string; glance: PortfolioGlance } | { userId: string; failed: true };

function GlanceLoading() {
  return (
    <div role="status">
      <span className="sr-only">Loading your portfolio</span>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-2 h-4 w-56" />
    </div>
  );
}

function Glance({ glance }: { glance: PortfolioGlance }) {
  const { formatPrice } = useCurrency();
  if (glance.holdings === 0) {
    return (
      <div>
        <p className="text-body text-ink">Your portfolio is empty.</p>
        <p className="mt-1 text-small text-ink-soft">Add a product or import a Collectr CSV, and its value shows here.</p>
        <Link href="/portfolio" prefetch={false} className={`mt-3 ${buttonClasses({ variant: "secondary", size: "sm" })}`}>
          Go to your portfolio
        </Link>
      </div>
    );
  }
  const change = glance.dayChangeUsd;
  const signed =
    change === null ? null : `${change > 0 ? "+" : change < 0 ? "-" : ""}${formatPrice(Math.abs(change))}`;
  const parts = [`${formatInteger(glance.holdings)} holdings`, `${formatInteger(glance.units)} units`];
  if (glance.priced < glance.holdings) {
    parts.push(`${formatInteger(glance.holdings - glance.priced)} without a current price`);
  }
  return (
    <Stat
      label="Portfolio value"
      value={formatPrice(glance.valueUsd)}
      delta={<Delta value={glance.dayChangePct} period="1D" missingReason="No 1-day change for your holdings" />}
      sub={
        <>
          {signed && <span className="tabular-nums">{signed} over 1 day · </span>}
          {parts.join(", ")}
        </>
      }
      asOf={glance.asOf ? <AsOf date={glance.asOf} /> : undefined}
    />
  );
}

/**
 * "Your Pokéfin" (WP32): a client island after the cached ISR shell. Renders
 * nothing until the session is authoritatively signed in (WP04), then reads
 * GET /api/portfolio/summary once per user. WP34 renders its watchlist
 * movers as `children` (the second column).
 */
export default function YourPokefin({ className = "", children }: { className?: string; children?: ReactNode }) {
  const { user, sessionStatus } = useAuth();
  const userId = sessionStatus === "authenticated" && user ? user.id : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (userId === null) return;
    const controller = new AbortController();
    fetchPortfolioGlance(controller.signal).then(
      (glance) => setLoaded({ userId, glance }),
      () => {
        if (!controller.signal.aborted) setLoaded({ userId, failed: true });
      }
    );
    return () => controller.abort();
  }, [userId]);

  if (userId === null) return null;
  const current = loaded !== null && loaded.userId === userId ? loaded : null;

  return (
    <section aria-labelledby="yours-h" className={`${HOME_CARD} ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="yours-h" className="text-h3 font-semibold text-ink">
          Your Pokéfin
        </h2>
        <Link href="/portfolio" prefetch={false} className={HOME_LINK}>
          Open portfolio
        </Link>
      </div>
      <div className={`mt-3 grid gap-4 ${children ? "md:grid-cols-2" : ""}`}>
        <div data-slot="portfolio" className="min-h-24">
          {current === null ? (
            <GlanceLoading />
          ) : "failed" in current ? (
            <p className="text-small text-ink-soft">Your portfolio could not be loaded.</p>
          ) : (
            <Glance glance={current.glance} />
          )}
        </div>
        {children}
      </div>
    </section>
  );
}
```

State is set only in promise callbacks (WP17's `react-hooks/set-state-in-effect`). The loading state is derived (no `setLoaded(null)` in the effect).

### Step 9. `app/page.tsx`: rewrite

Replace the whole file with:

```tsx
import CardRinkPromo from "./components/CardRinkPromo";
import HomeIntro from "./components/home/HomeIntro";
import IndexChartCard from "./components/home/IndexChartCard";
import IndexHeader from "./components/home/IndexHeader";
import MoversSection from "./components/home/MoversSection";
import RecentReleases from "./components/home/RecentReleases";
import SubIndexStrip from "./components/home/SubIndexStrip";
import YourPokefin from "./components/home/YourPokefin";
import {
  breadth30d,
  firstTrackedPairs,
  monthStartKey,
  recentReleaseGroups,
  selectMovers,
  toMarketDayRows,
  type MarketDayRow,
  type MoversResult,
} from "./lib/marketHome";
import { MOVER_PERIODS, type MoverPeriod } from "./lib/moverPeriods";
import { addDaysToKey, currentSummaries, HEADLINE_INDEX_CODE, sliceIndexRange, utcTodayKey } from "./lib/marketIndex";
import {
  getCachedFirstTrackedPrices,
  getCachedIndexConstituents,
  getCachedIndexSeries,
  getCachedIndexSummary,
  getCachedMarketDayStats,
  getCachedMarketProductSummaries,
  getCachedPipelineStatus,
  getCachedProductStats,
  getCachedSparklines,
} from "./lib/serverMarketData";
import type { SparklinePayload } from "./lib/sparkline";

/*
 * / : the market home (WP32). A static ISR page: every read below is an
 * unstable_cache entry tagged market-products (WP11), so it renders once per
 * scrape and the CDN serves the same HTML to everyone, signed in or not.
 * Do not read request data here or in the server components it renders, do
 * not add a client directive, a charting library or a browser fetch of
 * market data. Personal data belongs to the YourPokefin island only.
 */

const WIDE = "lg:col-span-12";
/** Phones: after the movers (flex order). Only non-focusable or later content gets it. */
const AFTER_MOVERS_ON_PHONE = "max-md:order-1";

export default async function Home() {
  const today = utcTodayKey();
  const yesterday = addDaysToKey(today, -1);

  const [products, summaries, series, yesterdayRows, pipeline, spark7d, spark1m] = await Promise.all([
    getCachedMarketProductSummaries(),
    getCachedIndexSummary(),
    getCachedIndexSeries(HEADLINE_INDEX_CODE),
    getCachedMarketDayStats(yesterday),
    getCachedPipelineStatus(),
    getCachedSparklines("7D"),
    getCachedSparklines("1M"),
  ]);

  // Movers and new releases describe the previous UTC day, like the index.
  // Without its rows (no scrape that day and no nightly finalisation), use the
  // newest day on record; the section header prints whichever day it is.
  let statsDay: string | null = yesterday;
  let dayRows: MarketDayRow[] = yesterdayRows ?? [];
  if (dayRows.length === 0) {
    const latest = await getCachedProductStats();
    statsDay = latest.day;
    dayRows = toMarketDayRows(Object.values(latest.byProductId));
  }
  if (dayRows.length === 0) statsDay = null;

  const { headline, subIndices } = summaries ? currentSummaries(summaries) : { headline: null, subIndices: [] };
  const productsById = new Map(products.map((p) => [p.id, p]));
  const rowsById = new Map(dayRows.map((r) => [r.product_id, r]));
  const recentGroups = statsDay ? recentReleaseGroups(products, statsDay) : [];
  const recentIds = recentGroups.flatMap((g) => g.products.map((p) => p.id));

  const [constituents, breadthRows, firstPrices] = await Promise.all([
    headline ? getCachedIndexConstituents(HEADLINE_INDEX_CODE, monthStartKey(headline.day)) : Promise.resolve(null),
    headline && headline.day !== statsDay ? getCachedMarketDayStats(headline.day) : Promise.resolve(dayRows),
    getCachedFirstTrackedPrices(firstTrackedPairs(recentIds, rowsById)),
  ]);
  const breadth = headline && constituents && breadthRows ? breadth30d(breadthRows, constituents) : null;

  const movers =
    statsDay === null
      ? null
      : (Object.fromEntries(MOVER_PERIODS.map((p) => [p.key, selectMovers(dayRows, p.key)])) as Record<
          MoverPeriod,
          MoversResult
        >);
  // Keyed by MOVER_PERIODS[].sparkline: 7D draws the 7D series, 30D the 1M series.
  const moverSparklines: Record<MoverPeriod, SparklinePayload | null> = { "7D": spark7d, "30D": spark1m };
  const hasIndex = headline !== null;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8 lg:grid lg:grid-cols-12">
      <div className={WIDE}>
        <HomeIntro productCount={products.length} newestPricedAt={pipeline.newestPricedAt} referenceDate={today} />
      </div>
      <div className={hasIndex ? "lg:col-span-5" : WIDE}>
        <IndexHeader summaries={summaries} headline={headline} breadth={breadth} today={today} />
      </div>
      {hasIndex && (
        <div className={`${AFTER_MOVERS_ON_PHONE} lg:col-span-7`}>
          <IndexChartCard points={series === null ? null : sliceIndexRange(series, "1y")} />
        </div>
      )}
      <div className={WIDE}>
        <MoversSection
          day={statsDay}
          today={today}
          movers={movers}
          productsById={productsById}
          sparklines={moverSparklines}
        />
      </div>
      {headline && (
        <div className={`${AFTER_MOVERS_ON_PHONE} ${WIDE}`}>
          <SubIndexStrip headline={headline} subIndices={subIndices} />
        </div>
      )}
      <YourPokefin className={`${AFTER_MOVERS_ON_PHONE} ${WIDE}`} />
      <div className={`${AFTER_MOVERS_ON_PHONE} ${WIDE}`}>
        <RecentReleases
          day={statsDay}
          today={today}
          groups={recentGroups}
          rowsById={rowsById}
          firstPrices={firstPrices}
        />
      </div>
      <div className={`${AFTER_MOVERS_ON_PHONE} ${WIDE}`}>
        <CardRinkPromo />
      </div>
    </main>
  );
}
```

Notes for the executor:
- `getCachedMarketProductSummaries()` is not wrapped: as today, a failed summaries read throws, so an ISR regeneration keeps serving the previous good page instead of caching a broken one.
- Items with `max-md:order-1` keep their DOM order among themselves, so on phones the order is intro, index card, movers, chart, sub-indices, island, releases, promo. The promo stays the last child of `<main>` (WP15).
- The island returns `null` when signed out, so it adds no empty grid item.
- `toMarketDayRows(Object.values(latest.byProductId))`: `ProductDailyStats` is structurally a `MarketDayRowRaw`. If `tsc` disagrees, map explicitly: `Object.values(latest.byProductId).map(({ product_id, day, usd_price, is_price_fresh, price_day, ret_7d, ret_30d, distinct_prices_365d, units_sold_30d, first_tracked_day }) => ({ product_id, day, usd_price, is_price_fresh, price_day, ret_7d, ret_30d, distinct_prices_365d, units_sold_30d, first_tracked_day }))`.

### Step 10. Delete the old strip and its dead code

- `git rm app/components/dashboard/RecentlyReleased.tsx` (the folder becomes empty; remove it).
- `grep -rn "RecentlyReleased\|components/dashboard" app scripts eslint.config.mjs` must print only the lines steps 11 and 17 change. Tests that render `RecentlyReleased` are deleted with it (list them in the PR); a test that only mocks it drops the mock.
- `app/lib/sparkline.ts`: delete `HOME_SPARKLINE_PERIOD` and its comment if the soft check showed no importer besides tests; delete a test assertion that only checks its value. If another module imports it, leave it.
- Nothing else is deleted: `getCachedVolumeMetrics`, `useProductData`, `ProductCard` and `hasCurrentPrice` still have other callers (`grep -rn` each before touching anything).

### Step 11. ESLint: the home modules join WP26's public-route list

In `eslint.config.mjs`, in `PUBLIC_ROUTE_CLIENT_FILES`, replace `"app/components/dashboard/**/*.{ts,tsx}",` with:

```js
  "app/components/home/**/*.{ts,tsx}",
  "app/components/Price.tsx",
  "app/lib/marketHome.ts",
  "app/lib/moverPeriods.ts",
  "app/lib/portfolioGlance.ts",
```

In `scripts/public-route-imports.test.mjs`, change the dashboard case's path `app/components/dashboard/probe.tsx` to `app/components/home/probe.tsx` (same code, same expectation). `pnpm lint` must stay at 0 errors: an error means a home module reaches Supabase; fix the import, never the rule.

### Step 12. Navigation (only if WP29 skipped it)

If the soft check found no `SEALED_INDEX` in `navConfig.ts`, apply WP29 step 23b and 23c exactly as written there (the `SEALED_INDEX` link, `FOOTER_BROWSE`, `PAGE_KEYWORDS`, `SEARCH_PAGES`, and the Footer and search tests). Otherwise skip this step. The primary nav does not change.

### Step 13. Metric definitions: `app/lib/metricDefinitions.ts`

Add `import { MOVERS_SCREEN } from "./marketHome";` (WP29 already imports `INDEX_RULES`; add it to that import if missing). Append at the end of `DEFINITIONS`, after the last entry:

```ts
  // Market home (WP32)
  def({ key: "movers", label: "Movers", unitLabel: "%", window: "7 or 30 days", short: `Largest 7D and 30D changes among products priced $${MOVERS_SCREEN.minPriceUsd}+ USD with ${MOVERS_SCREEN.minDistinctPrices365d}+ distinct prices a year and ${MOVERS_SCREEN.minUnitsSold30d}+ sold in 30D.`, anchor: "movers" }),
  def({ key: "sinceFirstTracked", label: "Since first tracked", unitLabel: "%", window: "since the first tracked day", short: "Change from the first Market Price Pokéfin recorded for the product to the price shown.", anchor: "movers" }),
  def({ key: "advancers7d", label: "Advancers 7D", unitLabel: "products", window: "7 days", short: `Sealed Index constituents whose 7-day change is above +${INDEX_RULES.breadthFlatBandPct}%.`, anchor: "index-breadth" }),
  def({ key: "decliners7d", label: "Decliners 7D", unitLabel: "products", window: "7 days", short: `Sealed Index constituents whose 7-day change is below -${INDEX_RULES.breadthFlatBandPct}%.`, anchor: "index-breadth" }),
  def({ key: "pctUp30d", label: "Up over 30D", unitLabel: "% of constituents", window: "30 days", short: `Share of Sealed Index constituents with a shown price whose 30-day change is above +${INDEX_RULES.breadthFlatBandPct}%.`, anchor: "index-breadth" }),
  def({ key: "newHighsLows52w", label: "New 52-week highs / lows", unitLabel: "products", window: "last 7 days", short: "Constituents that set a 52-week high, or a 52-week low, in the last 7 days.", anchor: "index-breadth" }),
```

Every `short` is under 120 characters and free of WP24's banned words (the test enforces both). `"movers"` becomes a valid anchor in step 14.

### Step 14. Methodology: `app/content/methodology.ts` and `MethodologyArticle.tsx`

14a. `app/content/methodology.ts`:
- Note the current values (`grep -n "METHODOLOGY_VERSION = \|METHODOLOGY_EFFECTIVE_DATE = " app/content/methodology.ts`), called `V_OLD` and `D_OLD`.
- Set `METHODOLOGY_VERSION` to the next minor version (for example `"1.3"` becomes `"1.4"`) and `METHODOLOGY_EFFECTIVE_DATE` to today (`date -u +%F`).
- In `METHODOLOGY_CHANGES`, the first row uses `METHODOLOGY_VERSION` and `METHODOLOGY_EFFECTIVE_DATE`: replace those two identifiers in that row with the literals `"V_OLD"` and `"D_OLD"` (the real values), then insert above it:

```ts
  {
    version: METHODOLOGY_VERSION,
    date: METHODOLOGY_EFFECTIVE_DATE,
    summary:
      "Adds the home page movers screen (price, distinct-price and units-sold floors), the change since first tracked, and the share of Sealed Index constituents up over 30 days.",
  },
```

- In `METHODOLOGY_SUBSECTIONS`, insert directly after the `{ anchor: "price-per-day", ... parent: "returns" }` entry (the last child of `returns`, so the list stays in page order):

```ts
  { anchor: "movers", title: "Movers and new releases", parent: "returns" },
```

14b. `app/methodology/MethodologyArticle.tsx`:
- Add `import { MOVERS_SCREEN } from "../lib/marketHome";` (`INDEX_RULES`, `LINK`, `Sub` and `PRICE_STALENESS_TOLERANCE_DAYS` are already in the file).
- Inside `<Section id="returns">`, directly before its closing `</Section>` (after its last `<Sub>`), add:

```tsx
            <Sub id="movers">
              <p>
                The home page lists the five largest gains and the five largest falls over 7 and 30 days, through the
                previous UTC day. Only products that pass a liquidity screen that day are ranked, the same screen the
                weekly report uses, plus a sales floor:
              </p>
              <ul className="ml-5 list-disc space-y-1">
                <li>its price is shown, not withheld under the {PRICE_STALENESS_TOLERANCE_DAYS}-day rule;</li>
                <li>its Market Price is at least ${MOVERS_SCREEN.minPriceUsd} USD;</li>
                <li>
                  it had at least {MOVERS_SCREEN.minDistinctPrices365d} different daily prices in the past year, so a
                  product whose price stepped once with nothing behind it is left out;
                </li>
                <li>at least {MOVERS_SCREEN.minUnitsSold30d} units sold on TCGplayer in the last 30 days.</li>
              </ul>
              <p>
                The changes are the 7-day and 30-day returns above. A change that rounds to 0.0% is neither a gain nor a
                fall. Ties go to the product with more units sold. The store linked on this site never affects the
                list.
              </p>
              <p>
                Recently released shows the products of the two newest sets. Since first tracked is the change from the
                first Market Price Pokéfin recorded for a product to the price shown. It is blank when either price is
                missing or the product was first priced that day.
              </p>
            </Sub>
```

- Inside WP29's `<Sub id="index-breadth">`, append a last paragraph:

```tsx
              <p>
                Up over 30D, on the home page, is the share of the month&apos;s constituents with a shown price whose
                30-day change is above +{INDEX_RULES.breadthFlatBandPct}%, among those that have a 30-day change.
              </p>
```

- Check: `grep -cP '\x{2014}' app/methodology/MethodologyArticle.tsx` prints 0.

### Step 15. Performance: budgets, forbidden chunks, Lighthouse

15a. `perf-budgets.json`, `routes["/"]`: set `jsGzKb.limit` and `documentBrKb.limit` to `null` (keep the targets 150 and 60). Step 20 fills them with `pnpm perf:budget --write-limits`. This is a tightening when the measurement is lower; if either measurement is above its old limit, stop and fix the page (never add a raise line for this package).

15b. `perf-budgets.json`, `forbiddenChunks`: if a `"recharts"` rule exists (WP29 step 21c), add `"/"` to its `routes`. If not, add:

```json
    "recharts": {
      "markers": ["recharts-wrapper"],
      "routes": ["/"],
      "reason": "WP32: the home page draws its index chart and sparklines as server SVG; no charting library may load on /."
    }
```

and add `"/indices/sealed"` to that `routes` too when the route exists in `routes`.

15c. `lighthouserc.json`, the `^http://127\.0\.0\.1:3100/$` assertions: change `"largest-contentful-paint"` `maxNumericValue` from 2500 to 1800 (still `"warn"`). After the first CI run, set that URL's `resource-summary:script:size` `maxNumericValue` to the "Suggested script limit" from `node scripts/perf-lhci-summary.mjs` only if it is lower than the current one (a tightening). Leave every other assertion unchanged.

15d. `scripts/prod-smoke-lib.mjs`: if the `{ path: "/", minPrices: N }` entry has `N > 5`, set it to 5 and say in the PR: "the new home shows 10 mover prices and up to 16 release prices; 5 is a floor a quiet market cannot break (the screen can leave a column short)". If `N <= 5`, leave it.

### Step 16. The ISR shell check: `scripts/check-home-cache.mjs` (new) and CI

16a. `scripts/check-home-cache.mjs`:

```js
/* eslint-disable no-console -- terminal tool; console output is its UI. */
// Prove "/" is one shared ISR shell, also for signed-in visitors (WP32).
//
//   node scripts/check-home-cache.mjs                                         perf server (CI)
//   node scripts/check-home-cache.mjs https://<preview host> --require-vercel-hit [--cookie "<name=value; ...>"]
//
// "/" is requested once without cookies, then twice with a Supabase session
// cookie (HOME_CACHE_COOKIE, --cookie, or a dummy). The cookied answers must
// come from the cache (x-vercel-cache or x-nextjs-cache HIT, STALE or
// PRERENDER), carry no private or no-store Cache-Control and no Set-Cookie,
// and the server HTML must not contain the signed-in strip.
// VERCEL_AUTOMATION_BYPASS_SECRET, when set, is sent as x-vercel-protection-bypass.
import { pathToFileURL } from "node:url";
import { PERF_ORIGIN } from "./perf-config.mjs";
import { isrProblems } from "./check-public-cache.mjs";

export const DUMMY_SESSION_COOKIE = "sb-pokefin-auth-token=wp32-cache-check";
const ISLAND_MARKER = 'aria-labelledby="yours-h"';

/** Problems with the three answers; [] when the shell is shared and cached. Pure. */
export function homeProblems({ anonymous, first, second }, { requireVercelHit = false } = {}) {
  const problems = [];
  if (anonymous.status !== 200) problems.push(`/ (anonymous): HTTP ${anonymous.status}`);
  problems.push(...isrProblems("/ (session cookie)", first, second, { requireVercelHit }));
  for (const [label, res] of [["anonymous", anonymous], ["session cookie", second]]) {
    if (res.headers.get("set-cookie")) problems.push(`/ (${label}): the response sets a cookie`);
    if ((res.text ?? "").includes(ISLAND_MARKER)) {
      problems.push(`/ (${label}): the signed-in strip is in the server HTML; it must stay a client island`);
    }
  }
  return problems;
}

async function get(origin, headers) {
  const res = await fetch(`${origin}/`, { headers, redirect: "manual" });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

async function main() {
  const args = process.argv.slice(2);
  const cookieFlag = args.indexOf("--cookie");
  const cookie = cookieFlag >= 0 ? args[cookieFlag + 1] : process.env.HOME_CACHE_COOKIE || DUMMY_SESSION_COOKIE;
  const origin = (args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--cookie") ?? PERF_ORIGIN).replace(/\/$/, "");
  const requireVercelHit = args.includes("--require-vercel-hit");
  const base = { accept: "text/html" };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    base["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  const anonymous = await get(origin, base);
  const first = await get(origin, { ...base, cookie });
  const second = await get(origin, { ...base, cookie });
  const problems = homeProblems({ anonymous, first, second }, { requireVercelHit });
  const state = second.headers.get("x-vercel-cache") ?? second.headers.get("x-nextjs-cache") ?? "-";
  console.log(`- / with a session cookie: ${second.status} ${state}, cache-control "${second.headers.get("cache-control")}"`);
  if (problems.length) {
    for (const p of problems) console.error(`::error::home cache: ${p}`);
    process.exitCode = 1;
  } else {
    console.log(`[check-home-cache] ok on ${origin}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error("[check-home-cache]", err);
    process.exitCode = 1;
  });
}
```

Never print the cookie value.

16b. `.github/workflows/ci.yml`, frontend job: directly after WP26's step `- name: Public API cache (blocking)` add:

```yaml
      # WP32: "/" must stay one cached ISR shell, also with a session cookie.
      - name: Home ISR shell with a session cookie (blocking)
        run: node scripts/check-home-cache.mjs
```

Keep the job name and every other step unchanged.

### Step 17. `scripts/measure-home.mjs` (new, manual): the first-screen check

```js
/* eslint-disable no-console -- manual measurement tool; console output is its UI. */
// WP32: prove the first phone screen shows the index level, its change and the
// first mover. Run against the perf build (SUPABASE_STUB_FIXTURE=perf pnpm build:stub,
// then node scripts/perf-serve.mjs). Not run in CI. Needs playwright-core outside the lockfile:
//   npm install --no-save --prefix /tmp/pw playwright-core@1.56
//   PW_DIR=/tmp/pw CHROME_PATH="$(command -v google-chrome || command -v chromium)" node scripts/measure-home.mjs
import { createRequire } from "node:module";
import path from "node:path";

const base = process.argv[2] ?? "http://127.0.0.1:3100";
const requireFromPw = createRequire(path.join(process.env.PW_DIR ?? "/tmp/pw", "node_modules", "noop.js"));
const { chromium } = requireFromPw("playwright-core");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });

async function measure(name, width, height, phone) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 3 : 1, isMobile: phone, hasTouch: phone });
  const page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  const result = await page.evaluate(() => {
    const bottom = (el) => (el ? Math.round(el.getBoundingClientRect().bottom) : null);
    return {
      level: bottom(document.querySelector('[data-home="index-level"] [data-direction]')),
      firstMover: bottom(document.querySelector('[data-period="7D"] li')),
      innerHeight: window.innerHeight,
    };
  });
  await context.close();
  return { name, ...result, ok: result.level !== null && result.firstMover !== null && result.firstMover <= result.innerHeight };
}

const rows = [await measure("390 x 844", 390, 844, true), await measure("1440 x 900", 1440, 900, false)];
await browser.close();
console.table(rows);
if (rows.some((r) => !r.ok)) process.exitCode = 1;
```

If the 390 x 844 row fails, add `hidden md:flex` to the `SearchTrigger` class list in `HomeIntro.tsx` (WP27's header already has a search button on phones) and measure again. Do not shrink type below the WP23 scale.

### Step 18. Conventions baseline

The rewrite removes every `--pf-pokeball` and hex use from `app/page.tsx` and deletes `RecentlyReleased.tsx`, so WP23's ratchet reports counts below the baseline. Regenerate and review:

```bash
UPDATE_UI_BASELINE=1 pnpm exec jest app/__tests__/uiConventions.test.ts
pnpm exec jest app/__tests__/uiConventions.test.ts
git diff app/__tests__/uiConventions.baseline.json   # only removals or lower counts; no components/home path, no page.tsx entry
```

### Step 19. Docs

`frontend/README.md`: under WP11's caching section (or at the end of the "Performance budgets" section if there is no caching section), add:

```markdown
### Home page (WP32)

`/` is a static ISR page: its data comes from cached reads tagged
`market-products` (index summary and series, one day of
`product_daily_stats`, index constituents, first tracked prices, two
sparkline payloads). It must never read cookies, headers or search params.
Signed-in data comes only from the `YourPokefin` island through
`GET /api/portfolio/summary`. CI proves the shell stays cached with a
session cookie (`node scripts/check-home-cache.mjs`); the movers screen
constants live in `app/lib/marketHome.ts` and mirror
`generate_weekly_report.py`.
```

### Step 20. Measure and record

Run the perf build and gates (Verification, block 3), then `pnpm perf:budget --write-limits`, review the diff of `perf-budgets.json` (only `/` limits and `recorded` values change, both at or below their previous values), and run `pnpm perf:budget` again (exit 0). Put the before and after rows for `/ JS (gz)` and `/ document (br)` in the PR.

## Pitfalls: do not do this

- **Do not read request data on `/`.** No `cookies()`, `headers()`, `searchParams`, `connection()`, `export const dynamic`, `unstable_noStore` or `"use client"` in `app/page.tsx` or the server components it renders. One of them makes every visit a serverless render and breaks the "same shell for everyone" acceptance.
- **Do not render anything personal on the server.** No `useAuth` in server files, no user id in props, no "Sign in to see your portfolio" teaser that depends on the session in the HTML. The island decides after hydration.
- **Do not fetch market data in the browser on `/`.** No `useSparklines`, no `publicMarketApi`, no `/api/public/*` call, no supabase-js. The period toggle switches pre-rendered panels.
- **Do not import a charting library.** No `recharts`, `ChartBundle`, `PriceChart`, `next/dynamic` chart. The index chart is WP29's server SVG; sparklines are WP26's encoded series.
- **Do not rank movers from `get_market_product_summaries` returns.** Those anchors are unbounded (WP25 note); use `product_daily_stats` `ret_7d` and `ret_30d`.
- **Do not apply the $15 floor in CAD,** and do not add a product-type exclusion: the screen is exactly the four rules, mirrored from the weekly report and tested.
- **Do not use today's partial statistics for movers when yesterday has rows.** The header says "Through {D-1}"; mixing days breaks that stamp.
- **Do not call `getOrCreatePortfolio` or `GET /api/portfolio` from the home page.** A home visit must not create a portfolio or download every holding.
- **Do not import `app/lib/portfolio.ts` or `portfolioApi.ts` into the island.** The first reaches supabase-js (forbidden on `/`); the second returns the full payload. Use `portfolioGlance.ts`.
- **Do not place the island above the movers.** It appears after hydration; above the fold it would shift content (CLS) and push the first mover off the first phone screen.
- **Do not call a new cached read inside another `unstable_cache` callback** (WP11's nested-cache rule), and do not use PostgREST `or` groups (the perf fixture rejects them; use `in` plus in-memory filtering as written).
- **Do not change `IndexChart`'s default rendering.** `/indices/sealed` must look exactly as before; only `size="compact"` is new.
- **Do not call the since-first-tracked change "since release".** The first tracked day is when Pokéfin first recorded a price, which can differ from the release date.
- **Do not add `app/loading.tsx`** (WP13) and do not add thumbnails to the rows (images would become LCP candidates and cost bytes).
- **Do not raise a perf budget or loosen a Lighthouse assertion** to get green. Fix the page.
- **Do not use colour alone or banned copy.** Glyph plus sr-only word on every change; no "live", "real-time", "all-time", "undervalued", "buy", "TCGPlayer", em dash.

## Tests

Frontend Jest (from `frontend/`). Component tests mock `next/link` the way WP24's `MetricLabel` tests do and run `axeViolations` from `test-utils/axe.ts` with real timers.

### 1. `app/lib/__tests__/marketHome.test.ts` (new, `@jest-environment node`)

```ts
/** @jest-environment node */
import {
  breadth30d,
  changeSinceFirstTracked,
  firstTrackedPairs,
  moversScreenFailure,
  pickFirstTrackedPrices,
  productDisplayNames,
  recentReleaseGroups,
  selectMovers,
  toMarketDayRows,
  monthStartKey,
  type MarketDayRow,
} from "../marketHome";
import type { Product } from "../../types/market";

const row = (id: number, over: Partial<MarketDayRow> = {}): MarketDayRow => ({
  product_id: id,
  day: "2026-10-13",
  usd_price: 100,
  is_price_fresh: true,
  price_day: "2026-10-13",
  ret_7d: 1,
  ret_30d: 2,
  distinct_prices_365d: 40,
  units_sold_30d: 25,
  first_tracked_day: "2025-11-07",
  ...over,
});

const product = (id: number, over: Partial<Product> = {}): Product =>
  ({
    id,
    usd_price: 100,
    url: "",
    last_updated: "2026-10-13T06:00:00",
    variant: null,
    sets: { id: 1, name: "Phantasmal Flames", code: "ME02", release_date: "2025-11-14" },
    product_types: { id: 1, name: "booster_box", label: "Booster Box" },
    ...over,
  }) as Product;

describe("movers screen", () => {
  it("excludes a one-listing product whose price stepped once", () => {
    // The weekly report's case: one listing, two distinct prices in a year, nothing sold, a 4x step.
    const oneListing = row(1, { ret_7d: 300, distinct_prices_365d: 2, units_sold_30d: 0 });
    const liquid = row(2, { ret_7d: 4.2 });
    expect(moversScreenFailure(oneListing)).toBe("too_few_prices");
    expect(selectMovers([oneListing, liquid], "7D").gainers.map((m) => m.productId)).toEqual([2]);
  });

  it("excludes a product with enough distinct prices but under 3 units sold in 30 days", () => {
    const thin = row(1, { ret_7d: 80, units_sold_30d: 2 });
    expect(moversScreenFailure(thin)).toBe("too_few_sales");
    expect(selectMovers([thin], "7D").gainers).toEqual([]);
    expect(moversScreenFailure(row(1, { units_sold_30d: null }))).toBe("too_few_sales");
  });

  it("applies the $15 floor in USD", () => {
    expect(moversScreenFailure(row(1, { usd_price: 14.99 }))).toBe("below_price_floor");
    expect(moversScreenFailure(row(1, { usd_price: 15 }))).toBeNull();
  });

  it("excludes withheld prices", () => {
    expect(moversScreenFailure(row(1, { is_price_fresh: false }))).toBe("price_withheld");
    expect(moversScreenFailure(row(1, { usd_price: null }))).toBe("price_withheld");
    expect(moversScreenFailure(row(1, { distinct_prices_365d: null }))).toBe("too_few_prices");
  });

  it("ranks 5 gainers descending and 5 losers ascending, ties by units then id", () => {
    const rows = [
      row(1, { ret_7d: 5 }), row(2, { ret_7d: 9 }), row(3, { ret_7d: 5, units_sold_30d: 90 }),
      row(4, { ret_7d: 1 }), row(5, { ret_7d: 2 }), row(6, { ret_7d: 3 }),
      row(7, { ret_7d: -4 }), row(8, { ret_7d: -12 }), row(9, { ret_7d: -4, units_sold_30d: 3 }),
    ];
    const { gainers, losers, screened } = selectMovers(rows, "7D");
    expect(gainers.map((m) => m.productId)).toEqual([2, 3, 1, 6, 5]);
    expect(losers.map((m) => m.productId)).toEqual([8, 7, 9]);
    expect(screened).toBe(9);
  });

  it("leaves flat changes out of both columns", () => {
    const { gainers, losers } = selectMovers([row(1, { ret_7d: 0.04 }), row(2, { ret_7d: -0.04 }), row(3, { ret_7d: 0.05 })], "7D");
    expect(gainers.map((m) => m.productId)).toEqual([3]);
    expect(losers).toEqual([]);
  });

  it("uses ret_30d for 30D and skips rows without the period's return", () => {
    const rows = [row(1, { ret_7d: 50, ret_30d: -3 }), row(2, { ret_7d: null, ret_30d: 7 }), row(3, { ret_30d: null })];
    const r30 = selectMovers(rows, "30D");
    expect(r30.gainers.map((m) => m.productId)).toEqual([2]);
    expect(r30.losers.map((m) => m.productId)).toEqual([1]);
    expect(selectMovers(rows, "7D").gainers.map((m) => m.productId)).toEqual([1, 3]);
  });
});

describe("breadth30d", () => {
  it("counts constituents with a fresh price and a 30-day change, with the 0.5% dead band", () => {
    const rows = [
      row(1, { ret_30d: 0.6 }), row(2, { ret_30d: 0.5 }), row(3, { ret_30d: -0.51 }),
      row(4, { ret_30d: null }), row(5, { ret_30d: 9, is_price_fresh: false }), row(6, { ret_30d: 20 }),
    ];
    expect(breadth30d(rows, [1, 2, 3, 4, 5])).toEqual({ counted: 3, up: 1, down: 1, flat: 1, pctUp: (1 / 3) * 100 });
    expect(breadth30d(rows, []).pctUp).toBeNull();
  });
});

describe("recent releases", () => {
  it("keeps the two newest released sets, prices descending, withheld last, capped", () => {
    const products = [
      product(1, { usd_price: 50 }),
      product(2, { usd_price: null }),
      product(3, { usd_price: 400 }),
      product(4, { sets: { id: 2, name: "Mega Evolution", code: "ME01", release_date: "2025-09-26" } }),
      product(5, { sets: { id: 3, name: "Older", code: "SV10", release_date: "2025-05-30" } }),
      product(6, { sets: { id: 4, name: "Future", code: "ME03", release_date: "2026-11-01" } }),
    ];
    const groups = recentReleaseGroups(products, "2026-10-13", 2, 2);
    expect(groups.map((g) => g.setName)).toEqual(["Phantasmal Flames", "Mega Evolution"]);
    expect(groups[0].products.map((p) => p.id)).toEqual([3, 1]);
    expect(groups[0].total).toBe(3);
  });

  it("names rows by type and variant", () => {
    expect(productDisplayNames(product(1, { variant: "Pokémon Center" })).type).toBe("Booster Box (Pokémon Center)");
  });
});

describe("since first tracked", () => {
  it("builds sorted pairs and keeps exact matches only", () => {
    const rowsById = new Map([[2, row(2, { first_tracked_day: "2025-12-01" })], [1, row(1)]]);
    const pairs = firstTrackedPairs([2, 1, 3], rowsById);
    expect(pairs).toEqual([[1, "2025-11-07"], [2, "2025-12-01"]]);
    const picked = pickFirstTrackedPrices(pairs, [
      { product_id: 1, day: "2025-11-07", usd_price: 80 },
      { product_id: 1, day: "2025-12-01", usd_price: 999 },
      { product_id: 2, day: "2025-12-01", usd_price: "120.5" },
      { product_id: 2, day: "2025-11-07", usd_price: 1 },
    ]);
    expect(picked).toEqual({ "1": 80, "2": 120.5 });
  });

  it("computes the change only when both prices are honest", () => {
    expect(changeSinceFirstTracked(row(1, { usd_price: 120 }), 80)).toBeCloseTo(50);
    expect(changeSinceFirstTracked(row(1, { is_price_fresh: false }), 80)).toBeNull();
    expect(changeSinceFirstTracked(row(1, { first_tracked_day: "2026-10-13" }), 80)).toBeNull();
    expect(changeSinceFirstTracked(row(1), undefined)).toBeNull();
    expect(changeSinceFirstTracked(undefined, 80)).toBeNull();
  });
});

describe("row parsing", () => {
  it("coerces numeric strings and drops malformed rows", () => {
    const rows = toMarketDayRows([
      { product_id: 1, day: "2026-10-13", usd_price: "15.50", is_price_fresh: true, ret_7d: "2.5" },
      { product_id: null, day: "2026-10-13" },
      { product_id: 2, day: "yesterday" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].usd_price).toBe(15.5);
    expect(rows[0].ret_7d).toBe(2.5);
    expect(rows[0].units_sold_30d).toBeNull();
    expect(monthStartKey("2026-10-13")).toBe("2026-10-01");
  });
});
```

### 2. `app/lib/__tests__/marketHomeConstants.test.ts` (new, node)

```ts
/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";
import { MOVERS_SCREEN } from "../marketHome";
import { INDEX_RULES } from "../marketIndex";
import { MOVER_PERIODS } from "../moverPeriods";

const REPORT = fs.readFileSync(path.resolve(__dirname, "../../../../generate_weekly_report.py"), "utf8");

function pyConstant(name: string): number {
  const match = REPORT.match(new RegExp(`^${name}\\s*=\\s*([0-9.]+)`, "m"));
  if (!match) throw new Error(`${name} not found in generate_weekly_report.py`);
  return Number(match[1]);
}

describe("movers screen constants", () => {
  it("mirror the weekly report's screen", () => {
    expect(MOVERS_SCREEN.minPriceUsd).toBe(pyConstant("PRICE_FLOOR"));
    expect(MOVERS_SCREEN.minDistinctPrices365d).toBe(pyConstant("LIQUIDITY_MIN_DISTINCT_PRICES"));
  });
  it("match the Sealed Index screen", () => {
    expect(MOVERS_SCREEN.minPriceUsd).toBe(INDEX_RULES.minPriceUsd);
    expect(MOVERS_SCREEN.minDistinctPrices365d).toBe(INDEX_RULES.minDistinctPrices365d);
  });
  it("draw 7D with the 7D series and 30D with the 1M series", () => {
    expect(MOVER_PERIODS.map((p) => [p.key, p.column, p.sparkline])).toEqual([
      ["7D", "ret_7d", "7D"],
      ["30D", "ret_30d", "1M"],
    ]);
  });
});
```

### 3. `app/lib/__tests__/portfolioGlance.test.ts` (new, node)

Cases for `summarizeHoldings` (build holdings as `{ id, product_id, quantity, products: { usd_price } }` cast to `HoldingWithProduct`, and a `ProductStatsSnapshot` with `day: "2026-10-14"` and `byProductId` rows carrying `is_price_fresh`, `usd_price`, `ret_1d`):
- two priced holdings (2 x $100 with `ret_1d` 10, 1 x $50 with `ret_1d` null): `valueUsd` 250, `dayChangeUsd` 18.18 (2 x (100 - 100/1.1)), `dayChangePct` 10, `dayChangeCovered` 1, `priced` 2, `units` 3, `asOf` "2026-10-14".
- a withheld holding (`usd_price` null) counts in `holdings` and `units`, not in `priced` or `valueUsd`.
- no priced holding: `valueUsd` null; no covered holding: both day fields null.
- a stale stats row (`is_price_fresh` false) is not covered.
- `[]`: `{ holdings: 0, units: 0, priced: 0, valueUsd: null, ... }`.
- `isPortfolioGlance` accepts the outputs above and rejects `null`, a string `valueUsd`, a negative `holdings` and `asOf: "yesterday"`.

### 4. `app/api/portfolio/summary/__tests__/route.test.ts` (new, node)

```ts
/** @jest-environment node */
import { NextRequest } from "next/server";

jest.mock("../../../../lib/routeSupabase", () => ({ createRouteSupabaseClient: async () => ({}) }));
jest.mock("../../../../lib/routeAuth", () => {
  const actual = jest.requireActual("../../../../lib/routeAuth");
  return { ...actual, requireRouteUser: jest.fn() };
});
jest.mock("../../../../lib/server/portfolioRepo", () => ({ loadPortfolioGlanceHoldings: jest.fn() }));
jest.mock("../../../../lib/serverMarketData", () => ({ getCachedProductStats: jest.fn() }));
jest.mock("../../../../lib/logger", () => ({ logCaughtError: jest.fn(), logSupabaseError: jest.fn() }));

import { jsonNoStore, requireRouteUser } from "../../../../lib/routeAuth";
import { loadPortfolioGlanceHoldings } from "../../../../lib/server/portfolioRepo";
import { getCachedProductStats } from "../../../../lib/serverMarketData";
import { logCaughtError } from "../../../../lib/logger";
import { GET } from "../route";

const request = (headers: Record<string, string> = { "x-pokefin-request": "1" }) =>
  new NextRequest("http://localhost/api/portfolio/summary", { headers });

const STATS = {
  day: "2026-10-14",
  byProductId: { 42: { product_id: 42, day: "2026-10-14", is_price_fresh: true, usd_price: 110, ret_1d: 10 } },
};

beforeEach(() => {
  jest.clearAllMocks();
  (requireRouteUser as jest.Mock).mockResolvedValue({ user: { id: "user-1" }, response: null });
  (getCachedProductStats as jest.Mock).mockResolvedValue(STATS);
});

it("403 without the app header, before any read", async () => {
  const res = await GET(request({}));
  expect(res.status).toBe(403);
  expect(loadPortfolioGlanceHoldings).not.toHaveBeenCalled();
});

it("passes the auth answer through (401)", async () => {
  (requireRouteUser as jest.Mock).mockResolvedValue({ user: null, response: jsonNoStore({ error: "Unauthorized" }, 401) });
  const res = await GET(request());
  expect(res.status).toBe(401);
  expect(loadPortfolioGlanceHoldings).not.toHaveBeenCalled();
});

it("200 with the summary, no-store", async () => {
  (loadPortfolioGlanceHoldings as jest.Mock).mockResolvedValue([
    { id: 1, product_id: 42, quantity: 2, products: { usd_price: 110 } },
  ]);
  const res = await GET(request());
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = await res.json();
  expect(body).toMatchObject({ holdings: 1, units: 2, priced: 1, valueUsd: 220, dayChangeUsd: 20, dayChangePct: 10, asOf: "2026-10-14" });
  expect(loadPortfolioGlanceHoldings).toHaveBeenCalledWith({}, "user-1");
});

it("500 when the holdings read fails", async () => {
  (loadPortfolioGlanceHoldings as jest.Mock).mockResolvedValue(null);
  const res = await GET(request());
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "Failed to load portfolio summary" });
});

it("500 and a log line when something throws", async () => {
  (loadPortfolioGlanceHoldings as jest.Mock).mockRejectedValue(new Error("boom"));
  const res = await GET(request());
  expect(res.status).toBe(500);
  expect(logCaughtError).toHaveBeenCalledWith("portfolio_summary_failed", expect.any(Error));
});
```

### 5. `app/lib/server/__tests__/portfolioRepo.glance.test.ts` (new, node)

Mock `../../serverMarketData` (`getCachedMarketProductSummaries` resolving `[{ id: 42, usd_price: 110, price_recorded_at: <today> }]`, `fetchNewestPricedAtForProducts` resolving `new Map()`) and build a fake route client the way WP05's `portfolioRepo.test.ts` does. Cases: no portfolio row returns `[]` and makes no holdings query and no insert (assert the fake's `insert` was never called); a holdings error returns `null` and logs `holdings_glance_fetch_failed`; a lookup error returns `null`; holdings come back with the guarded price (a product missing from the summaries gets `usd_price: null`).

### 6. Component tests (new, jsdom), `app/components/home/__tests__/`

- `MoversPeriodSwitch.test.tsx`: render with `panels={{ "7D": <p>seven</p>, "30D": <p>thirty</p> }}` and a heading; the 7D panel is visible and the 30D panel's container has the `hidden` attribute; `jest.spyOn(global, "fetch")`; click the radio named "30 days": 30D visible, 7D hidden, the live region reads "Showing 30-day movers", `fetch` was never called; ArrowLeft moves back to 7D; axe clean.
- `MoversSection.test.tsx`: render with two products, `movers` built by `selectMovers` from rows, `sparklines` `{ "7D": payload with series for one product, "30D": null }`, `day` "2026-10-13", `today` "2026-10-14". Asserts: h2 "Movers" and "Through Oct 13, 2026 (UTC)"; gainer row link `href="/product/1"` with "Booster Box", "Surging Sparks", "212 sold 30D" and a `Delta` with `data-direction="up"`; the 7D rows have a sparkline slot (`[data-slot="sparkline"]`), the 30D rows none; an empty column shows "No product passed the screen with a gain over 7 days."; the screen sentence contains "$15 USD", "3 different daily prices" and "3 units sold"; a link to `/methodology#movers` ("How we calculate this") and one to the Screener href; `day: null` shows "Movers are not available right now." and no radio group; `today` "2026-10-16" shows the warn badge "Not updated since Oct 13, 2026"; axe clean.
- `IndexHeader.test.tsx`: `summaries: null` shows the load error text and the heading link to `/indices/sealed`; `[]` shows "not published yet" with a link to `/methodology#index`; a published headline shows "142.87", `data-direction` on the 1D delta, 7D/30D/1Y deltas, "as of the close of Oct 13, 2026 (UTC)"; `chg365d: null` renders `--` with sr-only "Less than a year of levels"; `provisional: true` renders a `role="note"` with "Provisional: 136 of 212"; `today` two days after the headline renders "Not updated since"; breadth shows "▲", "94", "44%", "58%", "of 204", "11 / 0"; `breadth: null` shows `--` with "Not available"; all four breadth labels link to `/methodology#index-breadth`; axe clean.
- `SubIndexStrip.test.tsx`: four tiles in `INDEX_TYPE_FAMILY` order, each linking to `/indices/sealed`; a missing sub-index shows `--` and sr-only "Not published"; axe clean.
- `RecentReleases.test.tsx`: a group heading, "ME02 · Released Nov 14, 2025", rows with "64 sold 30D", "▲" and "since Nov 14"; a withheld row shows `--` and "No current price"; `firstPrices: null` makes every change `--` with "No first tracked price"; `total > products.length` shows "All 11 Phantasmal Flames products" linking to `setSearchHref("Phantasmal Flames")`; no groups shows the empty text; axe clean.
- `YourPokefin.test.tsx`: mock `../../../context/AuthContext` (`useAuth: () => mockAuth`) and `global.fetch`. Cases: `sessionStatus` "unknown" or "anonymous": the container is empty and `fetch` was not called; "authenticated": `fetch` called once with `"/api/portfolio/summary"` and header `x-pokefin-request: 1`, the loading status shows first, then "Portfolio value", "C$" (default CAD provider fallback), "▲" and "over 1 day", "14 holdings, 22 units"; `priced < holdings` adds "without a current price"; `holdings: 0` shows "Your portfolio is empty." and a link to `/portfolio`; a 500 answer shows "Your portfolio could not be loaded."; an invalid body shows the same; `children` renders in the second column; unmounting aborts the request (the signal passed to `fetch` is aborted); axe clean.

### 7. `app/__tests__/homeShell.test.ts` (new, node): the shell guards

```ts
/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";

const APP = path.resolve(__dirname, "..");
const HOME_DIR = path.join(APP, "components/home");
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (rel: string) => stripComments(fs.readFileSync(path.join(APP, rel), "utf8"));
const HOME_FILES = fs
  .readdirSync(HOME_DIR)
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => `components/home/${f}`);
const isClient = (text: string) => /^\s*["']use client["'];?/m.test(text);
const RAW_PALETTE =
  /\b(?:[a-z-]+:)*(?:text|bg|border|ring|fill|stroke|divide)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
const HEX = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;

describe("home shell (WP32)", () => {
  it("keeps / a static page", () => {
    const page = read("page.tsx");
    expect(isClient(page)).toBe(false);
    expect(page).not.toMatch(/next\/headers|\bcookies\(|\bheaders\(|searchParams|export const dynamic|unstable_noStore|\bconnection\(/);
  });

  it("keeps personal data out of the server render", () => {
    for (const file of ["page.tsx", ...HOME_FILES]) {
      const text = read(file);
      if (!isClient(text)) expect(`${file}: ${/useAuth|AuthContext|\/api\/portfolio/.test(text)}`).toBe(`${file}: false`);
    }
    expect(isClient(read("components/home/YourPokefin.tsx"))).toBe(true);
  });

  it("loads no charting library and fetches no market data in the browser", () => {
    for (const file of ["page.tsx", ...HOME_FILES, "components/Price.tsx"]) {
      expect(`${file}: ${/recharts|ChartBundle|PriceChart|PortfolioChart|next\/dynamic|useSparklines|publicMarketApi|\/api\/public\//.test(read(file))}`).toBe(`${file}: false`);
    }
  });

  it("uses design tokens only", () => {
    for (const file of ["page.tsx", ...HOME_FILES, "components/Price.tsx"]) {
      const text = read(file);
      expect(`${file}: ${RAW_PALETTE.test(text) || HEX.test(text)}`).toBe(`${file}: false`);
    }
  });

  it("keeps the store promo last in main", () => {
    const page = read("page.tsx");
    expect(page.lastIndexOf("<CardRinkPromo />")).toBeGreaterThan(page.lastIndexOf("<RecentReleases"));
    expect(page.indexOf("<CardRinkPromo />")).toBe(page.lastIndexOf("<CardRinkPromo />"));
  });
});
```

### 8. Updates to existing tests

- `app/methodology/__tests__/MethodologyArticle.test.tsx`: add a case: `#movers` contains `$${MOVERS_SCREEN.minPriceUsd} USD`, `${MOVERS_SCREEN.minDistinctPrices365d} different daily prices` and `${MOVERS_SCREEN.minUnitsSold30d} units sold`; `#index-breadth` contains "Up over 30D". The existing anchor-uniqueness case covers `#movers`.
- `app/lib/__tests__/metricDefinitions.test.ts`: no edit; it checks the new entries (length, banned words, anchors).
- `scripts/public-route-imports.test.mjs`: the path change in step 11.
- WP29's `IndexChart` test (if it asserts class names): add one case: `size="compact"` renders `h-40` and `md:h-56`; the default still renders `h-56` and `md:h-72`.
- Delete tests that render `RecentlyReleased`; drop `HOME_SPARKLINE_PERIOD` assertions (step 10).
- `app/__tests__/uiConventions.baseline.json`: regenerated (step 18).
- Footer and search tests only if step 12 ran (WP29 step 23c).

### 9. Script tests (node --test)

9a. `scripts/check-home-cache.test.mjs` (new):

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { homeProblems } from "./check-home-cache.mjs";

const res = (status, headers = {}, text = "<main><h1>Sealed Pokémon TCG market</h1></main>") => ({
  status,
  headers: new Headers(headers),
  text,
});
const CACHED = { "x-nextjs-cache": "HIT", "cache-control": "s-maxage=86400, stale-while-revalidate=31535913" };

test("a cached shell with a session cookie passes", () => {
  assert.deepEqual(homeProblems({ anonymous: res(200, CACHED), first: res(200, CACHED), second: res(200, CACHED) }), []);
});

test("a dynamic render fails", () => {
  const dynamic = res(200, { "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate" });
  assert.ok(homeProblems({ anonymous: res(200, CACHED), first: dynamic, second: dynamic }).length >= 1);
});

test("a Set-Cookie fails", () => {
  const withCookie = res(200, { ...CACHED, "set-cookie": "sb-x=1; Path=/" });
  assert.match(homeProblems({ anonymous: res(200, CACHED), first: withCookie, second: withCookie }).join("\n"), /sets a cookie/);
});

test("the signed-in strip in the server HTML fails", () => {
  const leaked = res(200, CACHED, '<section aria-labelledby="yours-h">');
  assert.match(homeProblems({ anonymous: res(200, CACHED), first: leaked, second: leaked }).join("\n"), /client island/);
});

test("--require-vercel-hit needs x-vercel-cache", () => {
  const problems = homeProblems({ anonymous: res(200, CACHED), first: res(200, CACHED), second: res(200, CACHED) }, { requireVercelHit: true });
  assert.match(problems.join("\n"), /x-vercel-cache/);
});
```

9b. `scripts/perf-fixture.test.mjs` (WP22): append (import `buildPerfData` and `assert` as the file's existing tests do):

```js
test("WP32 home fixture: yesterday's stats, first tracked rows, headline constituents", () => {
  const data = buildPerfData({ now: new Date("2026-10-14T15:00:00Z"), baseUrl: "http://127.0.0.1:3100" });
  const yesterday = data.productDailyStats.filter((r) => r.day === "2026-10-13");
  assert.equal(yesterday.length, data.productStats.length);
  const screened = yesterday.filter(
    (r) => r.is_price_fresh && r.usd_price >= 15 && r.distinct_prices_365d >= 3 && r.units_sold_30d >= 3
  );
  assert.ok(screened.filter((r) => r.ret_7d !== null && r.ret_7d >= 0.05).length >= 5);
  assert.ok(screened.filter((r) => r.ret_7d !== null && r.ret_7d <= -0.05).length >= 5);
  assert.ok(data.productDailyStats.some((r) => r.day === r.first_tracked_day && r.usd_price !== null));
  assert.ok(data.indexConstituents.length > 0);
  assert.ok(data.indexConstituents.every((r) => r.index_code === "sealed" && r.month === "2026-10-01"));
});
```

If the fixture yields fewer than 5 screened gainers or losers, do not loosen the test: in `buildHomeFixture`, for the yesterday copies only, set `units_sold_30d` to `Math.max(row.units_sold_30d ?? 0, 3)` and `distinct_prices_365d` to `Math.max(row.distinct_prices_365d ?? 0, 3)` for rows whose `usd_price >= 15`, and say so in the PR.

## Verification

From `frontend/` unless stated.

```bash
# 1. Types, lint, unit tests
pnpm exec tsc --noEmit                                         # exit 0
pnpm run lint; echo "exit=$?"                                  # exit=0, 0 errors
pnpm exec jest app/lib/__tests__/marketHome.test.ts app/lib/__tests__/marketHomeConstants.test.ts \
  app/lib/__tests__/portfolioGlance.test.ts app/api/portfolio/summary app/lib/server/__tests__/portfolioRepo.glance.test.ts \
  app/components/home app/__tests__/homeShell.test.ts app/methodology app/lib/__tests__/metricDefinitions.test.ts \
  app/__tests__/uiConventions.test.ts --ci                     # all pass
pnpm test --ci                                                 # all pass; count = baseline + new - deleted RecentlyReleased tests
pnpm run test:scripts                                          # "# fail 0"

# 2. Default stub build (WP00): the route stays static
pnpm build:stub > /tmp/wp32-build.log 2>&1; echo "exit=$?"     # exit=0
grep -E "^[│├└ ]*[○●ƒ] /\s" /tmp/wp32-build.log                  # the "/" line starts with ○ (static), never ƒ

# 3. Perf build, budgets, cache check
rm -rf .perf
SUPABASE_STUB_FIXTURE=perf pnpm build:stub > /tmp/wp32-perf.log 2>&1; echo "exit=$?"    # exit=0
grep -c "no fixture route" /tmp/wp32-perf.log                                            # 0
node scripts/perf-serve.mjs > /tmp/wp32-serve.log 2>&1 &
for i in $(seq 120); do [ -f .perf/ready ] && break; node -e "setTimeout(()=>{},1000)"; done; cat .perf/ready
curl -s http://127.0.0.1:3100/ | grep -c 'data-period="30D"'                               # 1 (both panels in the HTML)
curl -s http://127.0.0.1:3100/ | grep -c 'aria-labelledby="yours-h"'                       # 0 (island not in the HTML)
curl -s http://127.0.0.1:3100/ | grep -c '<img'                                            # 0
pnpm perf:budget --write-limits && git diff perf-budgets.json                              # only "/" limits and recorded values, not higher than before
pnpm perf:budget; echo "exit=$?"                                                            # exit=0; "/ JS (gz)" <= 150; "/ document (br)" <= 60; forbidden chunks ok
node scripts/check-home-cache.mjs                                                           # "[check-home-cache] ok on http://127.0.0.1:3100"
node scripts/check-public-cache.mjs                                                         # still ok (WP26)
PW_DIR=/tmp/pw CHROME_PATH="$(command -v google-chrome || command -v chromium)" node scripts/measure-home.mjs   # both rows ok (skip if no Chrome; state it in the PR)
pkill -f scripts/perf-serve.mjs
```

Lighthouse: if Chrome is available, `pnpm dlx @lhci/cli@0.15.1 autorun` against the running perf server, then `node scripts/perf-lhci-summary.mjs`: `/` median LCP at or under 1800 ms (warn only), CLS at or under 0.05 (error), `uses-responsive-images` 0 items, script size at or under the calibrated limit. Otherwise the CI Lighthouse step is the check; paste its summary in the PR.

Performance against the budgets (numbers in the PR): `/ JS (gz)` before and after (after at or below 150), `/ document (br)` before and after (at or below 60), shared JS unchanged within 1 kB, `/prices`, `/product/[id]` and `/indices/sealed` unchanged within 1 kB (no regression of WP08, WP09, WP12, WP29 gains).

Manual checks (`pnpm perf:serve` for anonymous views; `pnpm dev` against a real Supabase project, or the preview, for signed-in views):

- 390 px: the first screen shows the H1, the provenance line, the index level with its 1D change and the first gainer row; the chart sits after the movers; tiles are 2 x 2; rows are 56 px; no horizontal scroll; the header search button and the page search trigger both open the same dialog.
- 1440 px: index card and chart side by side, movers in two columns, first mover above the 900 px fold; the island (signed in) appears below the sub-index strip without moving anything in view.
- Toggle 7D/30D with the mouse and with arrow keys: panels swap instantly; the DevTools network panel shows no request.
- Switch USD/CAD in the header: every price and the portfolio value change; sparklines and percentages do not.
- Signed out: no "Your Pokéfin"; network panel shows no `/api/portfolio/summary` request. Signed in with holdings: value, 1D change, counts; with none: the empty state; with the route failing (block it in DevTools): the error text.
- Keyboard: Tab order is intro links, search, index links, movers toggle, mover rows, screen links, sub-index tiles, island links, release rows; the chart card's "Open the index" is skipped.
- Screen reader (VoiceOver or NVDA): the 1D change reads "Up 0.4% 1D"; breadth labels read with their "How ... is calculated" links; the toggle announces "Showing 30-day movers".
- `/indices/sealed` looks exactly as before (chart height unchanged).

Preview check after the PR's Vercel preview is ready (needs the preview host; optional real cookie from a signed-in browser session, never pasted into the PR):

```bash
VERCEL_AUTOMATION_BYPASS_SECRET=... node scripts/check-home-cache.mjs https://<preview host> --require-vercel-hit
VERCEL_AUTOMATION_BYPASS_SECRET=... node scripts/check-home-cache.mjs https://<preview host> --require-vercel-hit --cookie "$HOME_CACHE_COOKIE"
# both: "[check-home-cache] ok"; the second request with the cookie reports x-vercel-cache HIT
```

## Owner actions

1. After the preview deploys, sign in on the preview, copy the `cookie` request header of a request to `/` from DevTools, and run the second preview command above with it (`HOME_CACHE_COOKIE` env var, not the command line history if possible). Paste only the "ok" line into the PR. Five minutes.
2. Look at the preview at 390 px and 1440 px, signed out and signed in, and approve the layout in the PR. Ten minutes.
3. Informational: movers and new releases use the previous UTC day's statistics, which WP25's pg_cron job finalises at 00:30 UTC (owner decision D8). Without pg_cron the page still works from the rows the scraper wrote that day. No action if D8 is done.

No database action: this package adds no migration.

## Acceptance criteria

- [ ] At 390 x 844, the first screen shows the index level, its 1D change and the first 7D gainer row (`measure-home.mjs` row "390 x 844" ok, or a screenshot in the PR when Chrome is unavailable).
- [ ] The hero, both hero buttons, the hero form, `MoverCard`, the Quick Stats row (including "Avg 1M return") and `RecentlyReleased.tsx` are gone.
- [ ] The market header shows the Sealed Index level, 1D/7D/30D/1Y deltas, a 1Y server-SVG chart, advancers and decliners 7D, Up over 30D, new 52-week highs and lows, the provenance line with `AsOf` and a Methodology link, and a search trigger that opens GlobalSearch.
- [ ] The sub-index strip shows Booster Box, Elite Trainer Box, Booster Bundle and Collections with their 30D change, each linking to `/indices/sealed`.
- [ ] Movers show 5 gainers and 5 losers per period (fewer only when the screen leaves fewer), as `DataListRow`s with WP26 sparklines, under "Through {date} (UTC)", with the screen sentence, a `/methodology#movers` link and the decision note.
- [ ] `marketHome.test.ts` proves a one-listing product (2 distinct prices, 0 sold, a 300% step) is excluded; the constants test ties the screen to `generate_weekly_report.py` and `INDEX_RULES`.
- [ ] Both periods are in the server HTML; the toggle makes no network request (component test with a `fetch` spy).
- [ ] Recently released shows compact rows grouped by set with type, price, change since first tracked and units sold 30D.
- [ ] `YourPokefin` renders only when `sessionStatus` is "authenticated", reads `GET /api/portfolio/summary` once, shows value in the selected currency and the 1D change, and renders `children` in a second column (WP34's slot).
- [ ] `GET /api/portfolio/summary` returns 403 without the app header, passes 401/503 through, never creates a portfolio, and answers with `Cache-Control: no-store`.
- [ ] `homeShell.test.ts` passes: no request data, no client directive, no personal data and no charting library in the server render of `/`.
- [ ] CI step "Home ISR shell with a session cookie (blocking)" passes; on the preview, `check-home-cache.mjs --require-vercel-hit` with a session cookie reports `x-vercel-cache` HIT.
- [ ] `pnpm perf:budget`: `/ JS (gz)` at or below 150 kB; `/ document (br)` at or below 60 kB; no raise line in the PR; recharts and supabase-js unreachable from `/`.
- [ ] Lighthouse on `/`: LCP assertion at 1800 ms (warn), CLS at or below 0.05, 0 responsive-image items.
- [ ] `/methodology` is at the next minor version with a change-log row, `#movers` prints the screen from `MOVERS_SCREEN`, and `#index-breadth` explains Up over 30D; every new label resolves through `metricDefinitions.ts`.
- [ ] `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test --ci`, `pnpm run test:scripts` and `pnpm build:stub` all pass; the build lists `/` as static.
- [ ] `/indices/sealed` renders unchanged; `CardRinkPromo` is the last child of `<main>`; no em dash, "live", "real-time", "all-time" or "TCGPlayer" in the new files.

## Rollback

One revert of the PR restores the old home page, `RecentlyReleased.tsx`, the budgets, the Lighthouse threshold and the CI step. No database change to undo. If the methodology version has been bumped again by a later package, do not delete history on revert: keep the later version, remove the `#movers` subsection and the Up over 30D paragraph, and add a change-log row "Removed the home page movers screen" at the next minor version. `GET /api/portfolio/summary` can stay (unused) if WP34 or WP36 already depend on it; otherwise it goes with the revert. After the revert, run `pnpm perf:budget` once: the `/` limits return to their old values with the file.

## Commit and PR

Commits (in this order):

1. `feat(home): movers screen, breadth and release helpers (WP32)`: `app/lib/moverPeriods.ts`, `app/lib/marketHome.ts`, `marketHome.test.ts`, `marketHomeConstants.test.ts`.
2. `feat(data): day stats, index constituents and first tracked reads (WP32)`: `serverMarketData.ts`, `scripts/fixtures/perf.mjs`, `scripts/perf-fixture.test.mjs`.
3. `feat(portfolio): GET /api/portfolio/summary for the home strip (WP32)`: `portfolioRepo.ts`, `portfolioGlance.ts`, `portfolioGlanceSummary.ts`, the route and their tests.
4. `feat(home): market header, movers, sub-indices, recent releases, Your Pokéfin (WP32)`: `app/components/Price.tsx`, `app/components/home/*`, `IndexChart.tsx` size, `app/page.tsx`, deletion of `dashboard/RecentlyReleased.tsx`, `sparkline.ts` cleanup, ESLint list, component and shell tests, conventions baseline, nav (only if step 12 ran).
5. `docs(methodology): movers screen and 30D breadth (WP32)`: `methodology.ts`, `MethodologyArticle.tsx` and its test, `metricDefinitions.ts`.
6. `perf: home budgets, forbidden chunks, LCP threshold, ISR cookie check (WP32)`: `perf-budgets.json`, `lighthouserc.json`, `prod-smoke-lib.mjs` (if changed), `scripts/check-home-cache.mjs` and its test, `scripts/measure-home.mjs`, `ci.yml`, `frontend/README.md`.

End every commit message with the attribution lines the session's system reminder specifies.

PR title: `WP32: Market home: index header, breadth, screened movers, new releases`

PR body:
- What changed and why (the Why section, two sentences), with before and after screenshots at 390 px and 1440 px, signed out and signed in.
- The movers screen and the `/methodology#movers` link; the methodology version bump (`V_OLD` to new).
- The new route `GET /api/portfolio/summary` and why WP05's `GET /api/portfolio` is not used on the home page.
- Budget table: `/ JS (gz)` and `/ document (br)` before and after, `/prices`, `/product/[id]` and `/indices/sealed` unchanged; Lighthouse summary for `/`; `check-home-cache.mjs` output (perf server, preview anonymous, preview with a cookie: "ok" lines only); `measure-home.mjs` table.
- Test counts before and after; the list of deleted `RecentlyReleased` tests.
- Owner actions (the three above).
- Noticed, out of scope: per-product release dates from WP28's `product_catalog_attributes` for Recently released; the home rows use `DataListRow` (`prefetch={false}`), not WP30's `IntentLink` (switch when `DataListRow` accepts a link component); a daily breadth history chart (WP29 stores it; a later package can chart it); anything else found.

End the PR description with the attribution lines the session's system reminder specifies.
