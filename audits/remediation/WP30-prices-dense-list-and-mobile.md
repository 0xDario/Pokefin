# WP30: Prices: dense list view, phone catalog and fixed card anatomy

- **Goal**: a collector on a phone scans all 306 sealed products as a dense two-line list with the price and the Period's change on every row (at least 8 products on the first 390 px screen instead of 1), and a desktop user gets a one-line 44 px list by default with a visible, URL-backed sort, plus an optional card view whose prices line up in one fixed column.
- **Why now / value**: `/prices` is the most visited page and still renders 450 px cards on phones (about 135 screens for the catalog) and 430 px cards on desktop whose product type wraps and whose price overflows (research/ui-audit.md `/prices`). WP26 made sparklines free to draw, WP23 shipped `DataList`, `Delta` and `AsOf`, and WP33 needs the phone row this package builds. It is also WP26's planned recovery for the `/prices` document budget ("WP30's list view is the planned recovery (it drops card chrome)", WP26 step 26).
- **Effort**: L, 14 to 16 hours (URL state, sorting and projection 2.5 h, list row, list view and header 3 h, card rewrite and cards view 2.5 h, toolbar and container wiring 2 h, CSS layout and intrinsic sizes 1 h, scroll anchor 1 h, tests 2.5 h, measurement, Lighthouse and budgets 1.5 h).
- **Depends on**: WP08 (`urlState.ts`, `updateUrlState`, `useLocationSearch`, the `cardList` memo this package replaces), WP09 (`historyLoadingStore`, `pf-card-grid` and its `content-visibility` rules, replaced here), WP11 (`catalogProjection.ts`, `toVolumeSummaries`, ISR `/prices`, and `app/components/IntentLink.tsx` from its step 13a, which already switched every other product link on the site), WP22 (`perf-budgets.json`, `lighthouserc.json`, the perf fixture, `pnpm perf:budget`, `scripts/perf-serve.mjs`), WP23 (`DataList`, `Delta`, `AsOf` with `STALE_AFTER_DAYS` and `daysBetween`, `PageHeader`, `ProvenanceLine`, `SegmentedControl`, `Badge`, `Skeleton`, tokens, `startToggleTransition` in the container, `uiConventions` ratchet), WP26 (`MiniSparkline series`, `sparklineFor`, `useSparklines`, `FullChartToggle`/`FullChartPanel` in `ProductCard`, Suspense per set group). Also reads WP07 (`format.ts`), WP12 (`ProductImage` `priority`), WP13 (`NoResults`), WP20 (`app/types/market.ts`, `useCurrency`). Soft, with a default for each case in "Before you start": WP24 (`PROVENANCE_SENTENCE`, `METRIC_DEFINITIONS`), WP27 (currency moved to the header; this package works before or after it), WP28 (x MSRP data; the column and sort appear only when it exists). `IntentLink` is expected from WP11; step 1 recreates the same file only if it is missing (WP31 and WP37 point at step 1 for the same fallback).
- **Unblocks**: WP33 (imports `catalogValues.ts` (`formatDaysOfSupply`), `freshness.ts` (`utcDateKey`), `shared/msrp.ts` and the `list` sparkline size; its phone rows are WP23 `DataListRow`s, not `ProductListRow`), WP28 step 12d (passes its multiples into the prop this package defines), WP34 step 17b (may add an optional `action` slot to `ProductListRow`).
- **Placement**: Speed lane, after WP26 and WP23 (WP22 -> WP26 -> WP30 -> WP33). It must precede WP33. No migration: the registry (0033 to 0041, 01-PRODUCT-DIRECTION.md §8) is untouched and nothing is numbered after WP21's 0032 by this package.
- **Suggested branch name**: `remediation/wp30-prices-dense-list-and-mobile`
- **Risk level**: medium. It changes the default rendering of the busiest page and its URL enums; layout regressions are caught by the Lighthouse CLS gate (tightened to 0.02 here), the byte budgets and the intrinsic-size test, and rollback is one revert with no data change.

## Why

A phone visitor to `/prices` today sees one product per 450 px card, so reading the catalog takes about 135 screens, and there is no compact view at all; on desktop the grouped cards wrap "Elite / Trainer / Box" onto three lines, clip the price at the card edge, and put the sparkline left of the price in one view and right of it in another, so prices cannot be scanned down a column (research/ui-audit.md `/prices`, "What looks unprofessional or confusing", and "Mobile": "Catalog cards are 450 px each; a phone user browsing 306 products scrolls about 135 screens"). The sort offers only release date and price, while an investor ranks by change, units sold and supply (ui-audit.md `/prices` improvement 4; competitive-landscape.md §4 item 10: "Show it next to the price, because an illiquid +40% is a different asset from a liquid +40%"). The audit's top recommendation is one phone list pattern for every dataset and a dense catalog list with cards as an option (ui-audit.md top-10 item 1, `/prices` improvements 1 and 2; 01-PRODUCT-DIRECTION.md §3.3), and the performance research asks for Suspense-chunked hydration, transitions on heavy toggles and a correct return position after Back (research/performance-excellence.md §13.2 to §13.4). After this package `/prices` opens as a list on every viewport (two lines of 56 px on phones, one line of 44 px from 768 px), the Period drives both the sparkline and the one change shown, the sort covers change, units, supply and x MSRP with its state in the URL and on screen, cards keep one fixed anatomy at 170 px, and Back returns to the row that was tapped. Collectors on phones at a card show benefit most; desktop investors get a scannable ranked list.

## Design

### D1. Decisions (binding)

| # | Decision | Source |
|---|---|---|
| 1 | `/prices` keeps its URL and WP08's URL mechanism. New key `view=list\|cards` (default `list` on every viewport) and new key `group=set\|none` (default `none`) | ui-audit.md `/prices` 1 and 2 |
| 2 | Grouping by set is a checkbox ("Group by set") that works in both views. Grouping by product type ("By Type") is removed: the Product type filter plus sorting covers it | task scope; ui-audit.md "Visual language" (badge and chrome budget) |
| 3 | Legacy `view` values keep working: `grouped` means cards grouped by set, `flat` and `type_grouped` mean ungrouped cards | shared links |
| 4 | One Period control (WP26's "Period", URL key `chart`, default 3M) drives the sparkline window, the one change shown on each row and card, the "change" sort and the range a card chart opens at. The Period is not renamed again (WP26) | ui-audit.md `/prices` 3 |
| 5 | Sort keys: `release_date`, `price`, `change`, `units_30d`, `days_supply`, `msrp`. The "change" sort ranks by the Period's return and is labelled "{Period} change" ("1M change" is the 30D change, "1Y change" the 1Y change). One key keeps the ranked value visible in every row; two fixed keys would rank by a number the row does not show whenever the Period differs. `msrp` is offered only when WP28 data exists | ui-audit.md `/prices` 4 |
| 6 | Sort state is visible (select value, bold header with an arrow on desktop, the sorted value in the phone row's meta slot) and in the URL (`sort`, `dir`) | task scope |
| 7 | The left-edge colour stripe and the per-card "Updated:" line are removed. Freshness is shown once per page (`ProvenanceLine` plus `AsOf`) and per item only when the price is 2 or more UTC days old: desktop list rows (from 768 px) show WP23's `AsOf variant="table"` clock glyph after the price; phone list rows and cards show the visible words "Last priced Sep 25" (`AsOf` inline variant, warn colour), because a `title` tooltip never shows on touch (WP23 `AsOf`: "phone rows use inline") | trust-seo-brand.md §5.1; 01-PRODUCT-DIRECTION.md §2 principle 1; WP23 step 17 |
| 8 | Phones never load thumbnails in the list (the thumbnail cell is `display: none` below 768 px, and lazy images that are not displayed are not fetched), which keeps above-the-fold image bytes at 0 kB against the 60 kB budget | performance-excellence.md §4 |
| 9 | Product links in rows and cards are WP11's `IntentLink` (prefetch after an 80 ms hover, on focus and on pointerdown; never on viewport entry) | performance-excellence.md §8 |
| 10 | The empty state stays WP13's `NoResults` | task scope |
| 11 | Light theme only, tokens only, no new component in `app/components/ui/` | 01-PRODUCT-DIRECTION.md §3.6; WP23 |

### D2. URL state

| Key | Values | Default (omitted from the URL) | Notes |
|---|---|---|---|
| `gen`, `type`, `q`, `dir`, `chart` | unchanged (WP08) | unchanged | `chart` is the Period |
| `currency` | unchanged until WP27 removes it | `CAD` | not touched by this package |
| `sort` | `release_date`, `price`, `change`, `units_30d`, `days_supply`, `msrp` | `release_date` | unknown values fall back to the default (WP08's `pickEnum`) |
| `view` | `list`, `cards` (legacy `grouped`, `flat`, `type_grouped` are read, never written) | `list` | |
| `group` | `set`, `none` | `none` | a legacy `view=grouped` sets `set` unless `group` is present |

Serialization order becomes `gen, type, q, sort, dir, view, group, chart, currency` (WP08's fixed order with `group` after `view`). The server always renders the defaults (WP08: the location store's server snapshot is `""`), so the prerendered HTML is the list view, ungrouped, sorted by release date, 3M.

Starting direction when a sort is picked: release date descending (newest first), price descending, change descending (largest rise first), units sold descending, days of supply ascending (thinnest supply first), x MSRP descending. Picking the active sort again, or pressing the direction button, flips the direction.

### D3. Screens

`/prices` at 390 x 844, list view (default). Heights in px on the right; the first screen holds the page header, the collapsed filter bar, the toolbar and 8 full rows.

```
+--------------------------------------+
| [mark] Prices  Screener  ...  (clock)|  64  sticky site header (WP27)
+--------------------------------------+
| Sealed product prices                |  32  h1 (text-h1)
| 306 products tracked. TCGplayer      |
| Market Price in USD, updated daily.  |  54  ProvenanceLine, 3 lines of 18
| Prices older than 14 days are hidden.|
| Prices as of Sep 29. Methodology     |
+--------------------------------------+
| (funnel) Filters (0)              v  |  70  ControlBar, collapsed (Period is inside)
+--------------------------------------+
| [Release date      v] [v]  [List|Cards]  44  Sort select, direction, View
| [ ] Group by set   Found 306 products · 3M change   44
+--------------------------------------+
| Evolving Skies · Booster Box         |  line 1 (20): set · type, variant (truncated)
| 212 sold 30D   C$612.40 ^ 4.2% /\/\_ |  line 2 (24): meta | price | Delta | 64x24 trend
+--------------------------------------+  56 per row, 1 px divider
| Evolving Skies · Elite Trainer Box P.|
| (c)Last priced Sep 25 C$81.30 v1.1% _/|  priced 2+ days ago: warn note replaces the meta
+--------------------------------------+
| Silver Tempest · Booster Bundle      |
| (c)Last priced Aug 1  --  -- No hist.|  withheld: "--", sr-only reason, "No history"
+--------------------------------------+
  ... 8 rows fully visible at 390 x 844 (measured, D10)
```

The meta slot (line 2, left) shows, in this order of precedence: "Last priced {date}" (clock icon, warn colour) when the price is 2 or more UTC days old or withheld with a known date; else the value the list is sorted by when that value has no other place on the row ("18 days of supply" when sorted by days of supply, "1.4x MSRP" when sorted by x MSRP); else units sold in 30 days. Trust beats the sort value: a stale price must never look current on a phone.

`/prices` at 1440 x 900, list view, sorted by 3M change descending, WP28 data present:

```
Sealed product prices
306 products tracked. TCGplayer Market Price in USD, updated daily. Prices older than 14 days are hidden. Prices as of Sep 29. Methodology
+------------------------------------------------------------------------------------------------------------+
| GENERATION [All v]  PRODUCT TYPE [All v]  [ (o) Search by name or variant ]                                   |
| PERIOD [ 7D | 1M |#3M#| 6M | 1Y ]                            CURRENCY [ USD |#CAD#]  1 USD = 1.3612 CAD       |
+------------------------------------------------------------------------------------------------------------+
SORT BY [3M change v] [v]    [#List#| Cards ]    [ ] Group by set                          Found 306 products
------------------------------------------------------------------------------------------------------------  40 header, sticky under the site header
     PRODUCT                                     PRICE   3M CHANGE v   TREND        SOLD 30D  DAYS SUPPLY  X MSRP
[i]  Crown Zenith · Elite Trainer Box  PKC   C$142.10     ^ 38.2%    ___/''''       55        9            2.9x   44
[i]  Evolving Skies · Booster Box            C$612.40     ^ 4.2%     /\/\_/\        212       18           2.1x   44
[i]  Silver Tempest · Booster Bundle (c)      C$41.70     v 1.1%     ''\___         40        55           1.4x   44
[i]  Hidden Fates · Elite Trainer Box              --     --         No history     --        --           --     44
```

Columns from 768 px: 40 px thumbnail, "Set · Type" with the variant as secondary text (fills the rest), price 112 px right-aligned tabular, Period change 96 px (`Delta`), trend 96 x 28 sparkline, units sold 30D 80 px. From 1024 px: days of supply 96 px, and x MSRP 72 px when WP28 data exists. The sorted column header is bold ink with an arrow (up for ascending, down for descending); other sortable headers are semibold ink-soft with a faint double arrow. "Product" and "Trend" are not sortable.

Grouped (checkbox on), both breakpoints: each set starts with a one-line header, then its rows (list) or its cards (cards view). Sets appear in the order of their first product under the current sort (newest set first by default; the set holding the biggest riser first when sorted by change), and rows inside a set keep the sort. Group-level facts appear once, in the header:

```
Evolving Skies   SWSH07 · Sword & Shield · Released Aug 27, 2021   Special Expansion
```

`/prices` at 1440, cards view grouped by set (three columns from 1280 px, two from 768 px, one below). Every card is the same 170 px tall; the type never wraps; prices share one x position in every column:

```
Evolving Skies   SWSH07 · Sword & Shield · Released Aug 27, 2021
+--------------------------------------------+ +--------------------------------------------+ +---------...
| [img] Booster Box                          | | [img] Elite Trainer Box                    | | [img] ...
| 64px  212 sold 30D · 2.1x MSRP             | | 64px  Pokemon Center · 40 sold 30D         | |
|        C$612.40   /\/\__/\                  | |         C$81.30   ____/                    | |
|        ^ 4.2% 3M  (96x40)                   | |       v 1.1% 3M   (96x40)                  | |
|       [Show full chart]  View on TCGplayer | |       [Show full chart]  View on TCGplayer | |
+--------------------------------------------+ +--------------------------------------------+ +---------...
```

Card anatomy, top to bottom inside a 12 px padded bordered box: (ungrouped only) caption line "Set · CODE · Aug 27, 2021" (16 px); title = product type (`h3`, 16/24, truncates with a `title` attribute, never wraps); detail line (13/18): variant, units sold 30D and x MSRP joined by " · ", led by "Last priced Sep 25" (clock, warn colour) when the price is 2 or more days old, or replaced by the withheld-price note; price row: a 112 px right-aligned column holding only the price (20/28) with the change directly under it (`Delta` with the Period label), then the 96 x 40 sparkline beside it (no glyph sits on the price line, so a four-digit CAD price such as "C$1,649.99" fits the column); actions row, a fixed 44 px: "Show full chart" (WP26) and "View on TCGplayer". The chart panel opens under the card body (WP26 states unchanged). Ungrouped cards are 186 px because of the caption line. The text column needs 220 px (112 + 12 + 96), so a card is at least 322 px wide: true for every grid track from a 360 px phone up (the narrowest track, 2 columns at 768 px, leaves 250 px). 320 px phones are out of scope; the sparkline clips there rather than wrapping.

`/prices` at 390, cards view: one column, the same card anatomy and heights.

### D4. States

| State | List row | Card | Page |
|---|---|---|---|
| First paint | From server HTML: price, change, 3M sparkline, units | same | `AsOf` "Prices as of Sep 29" |
| Period switched, series not loaded yet | WP26 flat bar in the trend slot; change already updated | same | list dimmed to 70% while the transition is pending |
| Currency switched | prices re-render at transition priority, list dimmed | same | |
| Price 2 to 13 days old | clock glyph after the price, tooltip and sr-only "Last priced Sep 25" | same, next to the price | |
| Price withheld (14 days, migration 0023) | price "--", change "--" with sr-only "Price withheld", "No history" in the trend slot, clock glyph "Last priced Aug 1" | detail line "No current price, last recorded Aug 1, 2026" (WP07 copy) | |
| Newest price in the catalog 2+ days old (collector stopped) | | | `AsOf` turns amber: "Last priced Sep 25" |
| Too little history for the Period | change "--" with sr-only "Not enough price history for this period" | same | |
| No units, supply or MSRP data | "--" in that cell | the part is left out of the detail line | x MSRP column and sort hidden when no product has a multiple |
| No products match | | | WP13 `NoResults` with "Clear filters" (unchanged) |
| Server read failed | | | ISR keeps the last good page (WP11); nothing new here |
| Sparkline request failed | flat bar stays (WP26) | same | |
| Card chart failed | | "Chart unavailable." and "Try again" (WP26) | |

There is no loading spinner: the list is in the HTML.

### D5. Metric and sort definitions

All values come from data the page already has; nothing is computed per visitor on the server.

| Value | Definition | Edge cases |
|---|---|---|
| Change (Period P) | `product.returns[P]` from `get_market_product_summaries` (percent points, WP11 rounds to 2 dp), P in 7D, 1M, 3M, 6M, 1Y | `null` when the price is withheld (`hasCurrentPrice` false) or the RPC returned null. Printed by `Delta`: 1 decimal, glyph, flat inside ±0.05% |
| Units sold 30D | `volumeMetrics[id].units_sold_30d` (0018 to 0021 guards) | `null` prints "--" |
| Days of supply | `total_quantity_available / (units_sold_30d / 30)`, computed on the server with `getDaysOfSupply` (`app/lib/marketPulse.ts`, the same formula as WP25's `product_daily_stats.days_of_supply` and WP24's `daysOfSupply` definition), sent as 1 decimal under 10 days and whole days above | `null` when nothing sold in 30 days or either input is null (stale listings are nulled by 0022). Printed "<1" below 1, else whole days |
| x MSRP | WP28's `initialMsrpMultiples[id]` (Market Price / US MSRP) | absent when WP28 has not landed or the product has no MSRP |
| Price sort | `usd_price` of products with a current price | unchanged from WP08: withheld prices last in both directions |
| Numeric sorts (change, units, supply, x MSRP) | ascending or descending by the value above | `null` values last in both directions; ties keep the previous order (the filtered list's release-date order), so the result is deterministic |
| Release date sort | unchanged (WP08: date, then product type order) | |
| Stale glyph | `daysBetween(price day, referenceDate) >= STALE_AFTER_DAYS` (2), where the price day is the UTC date of `price_recorded_at` and `referenceDate` is the UTC date of the server render | the page sends `price_recorded_at` only for products that are stale at render time or withheld, so fresh rows carry no date |
| "Prices as of" | the newest UTC price day among products with a current price | nothing rendered when no product has one |

Rendering the reference date on the server and passing it down means the server HTML and the hydrated client agree even across UTC midnight.

### D6. Interaction and performance

- **Toggles at transition priority** (research §13.2): Period, currency, sort, direction, view and group updates run inside WP23's `startToggleTransition`; `SegmentedControl` already paints its pressed segment optimistically. Currency set from the header after WP27 reaches the list through a deferred copy (`useDeferredValue`), so the header toggle paints first as well. While either is pending the catalog wrapper has `aria-busy="true"` and `opacity-70`.
- **Suspense-chunked hydration** (§13.3): each set group, or each run of 24 rows or cards when ungrouped, sits in its own `<Suspense fallback={null}>`. The boundaries never suspend; React hydrates them as separate units and yields between them.
- **Rows are memoised** (`memo(ProductListRow)`); a Period change re-renders rows (their change and sparkline change), a keystroke does not (WP08's deferred search).
- **Intrinsic sizes** (§13.4 fix 1): every list row and card has `content-visibility: auto` with a `contain-intrinsic-block-size` read from four CSS custom properties. List rows have a fixed CSS height, so the estimate is exact by construction; cards are sized by fixed line heights. A unit test asserts each custom property is within 10% of the fixture median recorded by `scripts/measure-catalog.mjs`.
- **Scroll anchor restore** (§13.4 fix 2): a product-link click stores `{ id, offsetFromTop }` in `history.state` (key `pfPricesAnchor`, via `history.replaceState` with the existing state spread, which Next passes through untouched because it carries `__NA`). When `/prices` mounts again (Back) and has applied the URL's state, it scrolls so the anchored row sits at its recorded offset (tolerance 4 px, two passes one frame apart), then removes the key. Next keeps custom history state on traversal (`completeTraverseNavigation` sets `preserveCustomHistoryState: true` in the installed 16.3.6).
- **No new request**: no fetch is added. Sort, view and group are client-only. The x MSRP map and days of supply are in the page props.
- **Prefetch**: every product link is an `IntentLink` (80 ms hover dwell, focus, pointerdown; one prefetch per href per page load).
- **Bytes**: a list row is about 40% of a grouped card's HTML, so the `/prices` document should drop; the flight grows by the days-of-supply numbers (under 1 kB br). Route JS changes by about +3 kB gz (list, toolbar, anchor, `IntentLink`) minus the deleted `ReturnMetrics`, `ProductTypeGroupHeader` and card chrome.

### D7. Copy (every new or changed user-facing string)

"Sealed product prices" (h1); "{n} products tracked. " + WP24's `PROVENANCE_SENTENCE` + "Prices as of Sep 29." + "Methodology"; "Sort by"; "Release date", "Price", "{Period} change", "Units sold 30D", "Days of supply", "x MSRP"; direction names "Newest first", "Oldest first", "High to low", "Low to high"; "View", "List", "Cards"; "Group by set"; "Found {n} products" (unchanged, WP13 forbids changing it) plus " · {Period} change" on phones; list header "Product", "Price", "{Period} change", "Trend", "Sold 30D", "Days supply", "x MSRP"; row suffixes (sr-only from 768 px) " sold 30D", " days of supply", " MSRP"; missing-change reasons "Price withheld", "Not enough price history for this period"; card "View on TCGplayer" with sr-only " (opens in a new tab)"; set header "Released {date}". Removed: "Updated: ...", "By Type", "By Set", "Flat", "sold/30d" chips, the per-card return rows. No "live", "real-time" or "all-time"; "TCGplayer" spelled that way; no em dashes.

### D8. Accessibility

- The list is a `<ul>` (WP23 `DataList`, named "Products" or "{Set} products") of `<li>` rows, each with exactly one link whose text is the whole row: "Evolving Skies · Booster Box Pokemon Center C$612.40 Up 4.2% 212 sold 30D 18 days of supply". The suffixes are visible on phones and `sr-only` from 768 px, where the column header carries them visually.
- Change direction is never colour only (`Delta`: glyph plus sr-only word). The stale glyph has visible tooltip text and sr-only "Last priced {date}" (`AsOf` table variant).
- Thumbnails are decorative (`alt=""`) because the link text names the product; the card's image link is `aria-hidden="true"` and `tabIndex={-1}` so each card has one link in the tab order for the product (the title) plus the TCGplayer link and the chart button.
- Sort: a native `<select>` labelled "Sort by" (label visible from 640 px, `sr-only` below), a direction button whose name states the current and next order, and header buttons (desktop) whose names include the sort state ("3M change, sorted high to low"). View is WP23's radio group named "View". "Group by set" is a native checkbox with its label.
- Headings: one `h1`; set group headers `h2`; card titles `h3`; list rows have no heading.
- Touch targets: select, direction button, checkbox label and segments are 44 px on coarse pointers (`pointer-coarse:`); list rows are 56 px tall on phones. Inputs are 16 px text on phones (no iOS zoom).
- Focus: `focus-visible:ring-2 ring-action` on rows (inset), links and buttons. `motion-reduce:transition-none` on the dim and hover transitions.
- The sparkline stays `aria-hidden` (WP26).

### D9. Design system use (WP23)

`DataList` (the `<ul>`), `Delta`, `AsOf` (inline and table variants), `PageHeader`, `ProvenanceLine`, `SegmentedControl`, `Badge` (expansion type, once per group), WP26's `MiniSparkline` and `Skeleton`, WP13's `NoResults`. Token utilities only in new and rewritten files (`text-ink`, `text-ink-soft`, `bg-surface`, `bg-surface-alt`, `border-line`, `divide-line`, `text-action`, `ring-action`, `accent-action`, `rounded-control`, `rounded-card`, `text-h1`, `text-h2`, `text-h3`, `text-body`, `text-small`, `text-caption`). The phone row reproduces `DataListRow`'s anatomy (two lines, 56 px, title and subtitle on line 1, meta left and value plus delta right on line 2, 64 x 24 sparkline) inside a single responsive grid element instead of using `DataListRow`, because `DataListRow` is phone-only and a second desktop DOM would double the row HTML against the 70 kB document budget. No new component goes into `app/components/ui/`.

### D10. Budgets and measured acceptance

| Check | Target | How |
|---|---|---|
| Rows fully visible on the first 390 x 844 screen, list view | at least 8, with price and change | `scripts/measure-catalog.mjs`, recorded in `layoutMetrics.ts` |
| `/prices` document (br) | ≤ 70 kB | `pnpm perf:budget` |
| `/prices` initial JS (gz) | ≤ 155 kB | `pnpm perf:budget` |
| `/prices` CLS (Lighthouse CI, mobile) | ≤ 0.02 (assertion tightened from 0.05) | `lighthouserc.json` |
| Toggle INP | one frame plus input delay | Chrome Performance trace (4x CPU), attached to the PR |
| Intrinsic sizes | within 10% of the fixture medians | `layoutMetrics.test.ts` |
| Grouped card height | ≤ 180 px, no truncated type title at 1440 | measure script |
| Back navigation | returns to the tapped row | manual, plus `scrollAnchor.test.ts` |

## Before you start

Read fully (paths from `frontend/`):

- `01-PRODUCT-DIRECTION.md` §2, §3.3, §3.4, §3.5, §6.1; `research/ui-audit.md` "`/prices` Catalog", "Mobile", top-10 item 1; `research/performance-excellence.md` §4, §8, §10.4, §13.
- `app/components/ProductPrices/index.tsx` (WP08's container as changed by WP09, WP13, WP20, WP23, WP26, and WP27/WP28 if landed). Locate: `initialUrlState`, the `urlState` object, the "URL -> state" block, `updateUrlState`, `deferredSearchTerm`, `filteredAndSortedProducts`, `groupedProducts`, `groupedProductsByType`, the `cardList` memo, `startToggleTransition`/`isTogglePending`, the `<SortControls` element, the "Found {n} products" element, the `<NoResults` block, the WP23 wrapper around `{cardList}`, `useSparklines`.
- `app/components/ProductPrices/utils/urlState.ts`, `utils/sorting.ts`, `utils/filtering.ts`, `controls/SortControls.tsx`, `controls/ControlBar.tsx`, `cards/ProductCard.tsx`, `cards/ProductGrid.tsx`, `cards/GroupHeader.tsx`, `cards/ProductTypeGroupHeader.tsx`, `shared/ProductImage.tsx`, `shared/ReturnMetrics.tsx`, `hooks/historyLoadingStore.ts`, `hooks/useSparklines.ts`, `hooks/useVolumeMetrics.ts`.
- `app/components/MarketView/MiniSparkline.tsx` (WP26), `app/lib/sparkline.ts`, `app/lib/catalogProjection.ts`, `app/lib/marketPulse.ts` (`getDaysOfSupply`), `app/lib/priceGuard.ts`, `app/lib/format.ts`, `app/types/market.ts`.
- `app/components/ui/{DataList,Delta,AsOf,PageHeader,ProvenanceLine,SegmentedControl,Badge,Skeleton}.tsx`, `app/components/ui/README.md`.
- `app/prices/page.tsx`, `app/components/dashboard/RecentlyReleased.tsx` (if it still exists), `app/globals.css` (WP09's `.pf-card-grid` block, WP23 tokens).
- Tests you will edit: `app/components/ProductPrices/__tests__/{urlState,sorting,ProductPrices.urlSync,ProductCard.format,ProductCard.history,controls.a11y}.test.ts(x)`, `ProductCard.msrp.test.tsx` (WP28, if present), `app/lib/__tests__/catalogProjection.test.ts`, `app/components/MarketView/__tests__/MiniSparkline.test.tsx`, `app/components/ProductPrices/__tests__/ProductImage.test.tsx`, `app/__tests__/uiConventions.test.ts`.
- `frontend/perf-budgets.json`, `frontend/lighthouserc.json`, `frontend/scripts/perf-serve.mjs`, `frontend/scripts/fixtures/perf.mjs`, `frontend/README.md` "Performance budgets".
- `node_modules/next/dist/client/components/app-router.js` lines 38 to 96 and 233 to 300 (history patches: a `replaceState` whose data carries `__NA` is passed straight to the browser) and `segment-cache/navigation.js` `completeTraverseNavigation` (`preserveCustomHistoryState: true`).

Confirm the starting state (from `frontend/`):

```bash
git status --short                                   # clean
ls ../migrations | tail -3                           # nothing to add; this package has no migration

# WP08: URL state module, no search-params hook in the container
grep -n "export function parsePricesQuery\|export const PRICES_URL_KEYS" app/components/ProductPrices/utils/urlState.ts   # 2 lines
grep -c "useSearchParams" app/components/ProductPrices/index.tsx                                                       # 0
# WP09: per-product loading store and the card grid marker
ls app/components/ProductPrices/hooks/historyLoadingStore.ts
grep -n "pf-card-grid" app/components/ProductPrices/cards/ProductGrid.tsx app/globals.css                             # 1 + at least 2 lines
# WP11: projection
grep -n "export function toVolumeSummaries\|export function toCatalogProducts" app/lib/catalogProjection.ts           # 2 lines
# WP13: empty state
ls app/components/NoResults.tsx && grep -n "<NoResults" app/components/ProductPrices/index.tsx
# WP20: domain types and currency context
ls app/types/market.ts app/context/CurrencyContext.tsx && grep -n "export type VolumeMetricsSummary" app/types/market.ts
# WP22: perf gate
ls perf-budgets.json lighthouserc.json scripts/perf-serve.mjs scripts/fixtures/perf.mjs
# WP23: components and the transition in the container
ls app/components/ui/{DataList,Delta,AsOf,PageHeader,ProvenanceLine,SegmentedControl,Badge,Skeleton}.tsx
grep -n "export const STALE_AFTER_DAYS\|export function daysBetween" app/components/ui/AsOf.tsx                      # 2 lines
grep -n "startToggleTransition\|isTogglePending" app/components/ProductPrices/index.tsx                              # several lines
# WP26: baked sparklines
grep -n "useSparklines\|sparklineFor" app/components/ProductPrices/index.tsx
grep -n 'row: "h-6 w-16"' app/components/MarketView/MiniSparkline.tsx                                                 # 1 line
grep -n "function FullChartToggle\|function FullChartPanel" app/components/ProductPrices/cards/ProductCard.tsx        # 2 lines
```

If any of these hard checks fails, stop and report the missing package: this package edits their files and must not recreate them.

Soft checks, each with the default to apply:

```bash
# (a) IntentLink (01-PRODUCT-DIRECTION.md §9 item 1 assigns it to WP11; no spec wrote it)
ls app/components/IntentLink.tsx
# (b) WP24 copy and definitions
grep -n "export const PROVENANCE_SENTENCE" app/content/disclosures.ts
grep -n "export const METRIC_DEFINITIONS" app/lib/metricDefinitions.ts
# (c) WP27 currency in the header
grep -n "useLegacyCurrencyParam" app/components/ProductPrices/index.tsx
# (d) WP28 x MSRP
grep -n "export function formatMsrpMultiple\|export function msrpMultiplesById" app/lib/productAttributes.ts
grep -n "initialMsrpMultiples\|NO_MSRP_MULTIPLES" app/components/ProductPrices/index.tsx
# (e) home strip still renders ProductCard
grep -rln "ProductPrices/cards/ProductCard\|./cards/ProductCard" app --include=*.tsx | grep -v __tests__
# (f) field names this spec relies on
grep -n "getProductTypeLabel" app/components/ProductPrices/utils/filtering.ts
grep -n "export function getDaysOfSupply" app/lib/marketPulse.ts
```

- (a) Missing: create it in step 1. Present: skip step 1, read its props, and use it as step 13 onward shows if it takes `href` and passes other props to `next/link`; if its API differs, adapt the call sites, not the component.
- (b) `PROVENANCE_SENTENCE` missing: in step 19 use the literal `"TCGplayer Market Price in USD, updated daily. Prices older than 14 days are hidden."` and omit `methodologyHref`; note it in the PR. `METRIC_DEFINITIONS` missing: in step 14 make `metricShort` return `undefined` and delete its import.
- (c) Either state works. Do not touch currency code: the container keeps using the `selectedCurrency`, `exchangeRate` and `formatPrice` variables it has.
- (d) Present: `shared/msrp.ts` re-exports WP28's formatter (step 7 variant A) and the container already has `initialMsrpMultiples`; keep its declaration and skip adding it in step 18b. Missing: step 7 variant B and add the prop in step 18b; the page passes nothing, so the column and the sort stay hidden until WP28's step 12d wires it.
- (e) Lists `app/components/dashboard/RecentlyReleased.tsx`: do step 20. Lists nothing else outside `ProductPrices/`: skip step 20.
- (f) `getProductTypeLabel` not found: WP27 or another package renamed it; use the function in `filtering.ts` that returns `label || name || "Unknown Type"`, or add it as written in step 8. `getDaysOfSupply` moved: import it from where `grep -rn "export function getDaysOfSupply" app/lib` finds it.

Tooling: Node and pnpm as in WP00. For the measurements in step 26 you need Chrome or Chromium and `playwright-core` installed outside the lockfile (`npm install --no-save --prefix /tmp/pw playwright-core@1.56`), exactly as `research/tools/README.md` does.

## Implementation steps

Order: steps 1 to 17 add or rewrite modules nothing uses yet (tsc stays green after each if you run it with the container untouched, except steps 2, 5 and 6, which change shared types; finish 2 to 8 together), 18 switches the container, 19 and 20 the pages, 21 the CSS, 22 deletes dead files, 23 to 26 measurement, gates and tests. Paths are relative to `frontend/`.

### Step 1. `app/components/IntentLink.tsx` (new, only when soft check (a) found nothing)

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ComponentProps } from "react";

/**
 * Hover dwell before a prefetch, so a pointer sweeping across the catalog
 * prefetches nothing (research/performance-excellence.md §8).
 */
export const INTENT_DWELL_MS = 80;

// Each href is prefetched at most once per page load. router.prefetch also
// dedupes in its own cache; this skips the call and the timer.
const prefetchedHrefs = new Set<string>();

/** Test hook: forget which hrefs were prefetched. */
export function resetIntentPrefetchForTests(): void {
  prefetchedHrefs.clear();
}

type IntentLinkProps = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & {
  href: string;
};

/**
 * A product link for grids and lists. Next 16 prefetches a static route in
 * full when its Link enters the viewport, and product pages are ISR (WP11),
 * so a catalog scroll would fetch up to 306 product pages. This link never
 * prefetches on viewport entry: only after an 80 ms hover, on focus, and on
 * pointerdown (80 to 150 ms before the click on touch screens).
 */
export default function IntentLink({
  href,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onPointerDown,
  ...rest
}: IntentLinkProps) {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    []
  );

  const cancel = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const prefetchNow = () => {
    cancel();
    if (prefetchedHrefs.has(href)) return;
    prefetchedHrefs.add(href);
    router.prefetch(href);
  };

  return (
    <Link
      {...rest}
      href={href}
      prefetch={false}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        if (!prefetchedHrefs.has(href) && timerRef.current === null) {
          timerRef.current = setTimeout(prefetchNow, INTENT_DWELL_MS);
        }
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        cancel();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        prefetchNow();
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        prefetchNow();
      }}
    />
  );
}
```

`<Link prefetch={false}>` also disables Next's own intent prefetch (research §8), which is why the handlers call `router.prefetch` themselves. Only the `/prices` rows and cards switch to it in this package; the home strip, `/market` and product-page siblings are listed as follow-ups in the PR.

### Step 2. `app/types/market.ts`: view, group, sort and the volume summary

Replace the `ViewMode` and `SortBy` lines and add `GroupBy`:

```ts
/** /prices presentation (WP30). */
export type ViewMode = "list" | "cards";
/** /prices grouping (WP30): by set, or one ranked list. */
export type GroupBy = "none" | "set";
/** /prices sort keys (WP30). "change" ranks by the selected Period's return. */
export type SortBy = "release_date" | "price" | "change" | "units_30d" | "days_supply" | "msrp";
```

Replace WP11's `VolumeMetricsSummary` declaration with:

```ts
/**
 * The volume fields client components read. Pages send this shape
 * (catalogProjection.ts); full ProductVolumeMetrics rows satisfy it too.
 * days_of_supply is computed on the server for /prices only (WP30).
 */
export type VolumeMetricsSummary = Pick<
  ProductVolumeMetrics,
  "units_sold_30d" | "units_sold_prior_30d"
> & {
  days_of_supply?: number | null;
};
```

`pnpm exec tsc --noEmit` now reports every use of the old `ViewMode` and `SortBy` values; steps 5, 6, 15, 17 and 18 resolve them.

### Step 3. `app/lib/catalogProjection.ts`: days of supply for `/prices`

Add `import { getDaysOfSupply } from "./marketPulse";` and replace `toVolumeSummaries` with:

```ts
export interface VolumeSummaryOptions {
  /** Add days_of_supply (WP30). Only /prices reads it; /market does not send it. */
  daysOfSupply?: boolean;
}

/**
 * Days of supply as sent to the browser: 1 decimal under 10 days, whole days
 * above. The list prints whole days ("<1" below one), so this only keeps the
 * sort order of thin supply exact while saving bytes.
 */
export function compactDaysOfSupply(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  return value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
}

/** Keeps the volume fields the client trees read. Every row is kept. */
export function toVolumeSummaries(
  metrics: Record<number, ProductVolumeMetrics>,
  options: VolumeSummaryOptions = {}
): Record<number, VolumeMetricsSummary> {
  const summaries: Record<number, VolumeMetricsSummary> = {};
  for (const [id, row] of Object.entries(metrics)) {
    const summary: VolumeMetricsSummary = {
      units_sold_30d: row.units_sold_30d,
      units_sold_prior_30d: row.units_sold_prior_30d,
    };
    if (options.daysOfSupply) {
      // Same formula as WP25's product_daily_stats.days_of_supply and WP24's
      // daysOfSupply definition: units on market / (units sold 30D / 30).
      summary.days_of_supply = compactDaysOfSupply(
        getDaysOfSupply(row.total_quantity_available, row.units_sold_30d)
      );
    }
    summaries[Number(id)] = summary;
  }
  return summaries;
}
```

If the file imports types from a different module after WP20, keep its import lines; only the function body and the new exports change. `/market`'s call stays `toVolumeSummaries(volumeMetrics)`.

### Step 4. `app/components/ProductPrices/utils/freshness.ts` (new, server-side helpers)

```ts
import { recordedAtDateKey } from "../../../lib/format";
import { hasCurrentPrice } from "../../../lib/priceGuard";
import type { Product } from "../../../types/market";
import { STALE_AFTER_DAYS, daysBetween } from "../../ui/AsOf";

/** The UTC date (YYYY-MM-DD) of `now`. The page passes it down as referenceDate. */
export function utcDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Newest TCGplayer day among products that have a current price, or null. */
export function newestPriceDay(products: readonly Product[]): string | null {
  let newest: string | null = null;
  for (const product of products) {
    if (!hasCurrentPrice(product)) continue;
    const key = recordedAtDateKey(product.price_recorded_at ?? null);
    if (key !== null && (newest === null || key > newest)) newest = key;
  }
  return newest;
}

/**
 * WP11's projection drops price_recorded_at for priced products to save
 * bytes. The list flags a price that is STALE_AFTER_DAYS or more old (WP23
 * AsOf table variant), so put the date back, as YYYY-MM-DD, for exactly those
 * products. Withheld products keep WP11's value. Fresh products carry no date.
 */
export function withStalePriceDates(
  projected: Product[],
  source: readonly Product[],
  referenceDate: string
): Product[] {
  const staleDays = new Map<number, string>();
  for (const product of source) {
    if (!hasCurrentPrice(product)) continue;
    const key = recordedAtDateKey(product.price_recorded_at ?? null);
    if (key !== null && daysBetween(key, referenceDate) >= STALE_AFTER_DAYS) {
      staleDays.set(product.id, key);
    }
  }
  if (staleDays.size === 0) return projected;
  return projected.map((product) => {
    const key = staleDays.get(product.id);
    return key === undefined ? product : { ...product, price_recorded_at: key };
  });
}
```

`AsOf.tsx` has no `"use client"` directive, so the server page can import this module. Do not move these helpers into `app/lib`: WP20's guard forbids `app/lib` importing from `app/components`.

### Step 5. `app/components/ProductPrices/utils/urlState.ts`: view, group, sort

Edit, do not replace the file (WP27 may already have removed `currency` from it; leave whatever it did):

5a. Type import: add `GroupBy` to the existing `import type { ... } from "../../../types/market"` (or from the path the file uses).

5b. `PricesUrlState`: add `group: GroupBy;` directly after `view: ViewMode;`.

5c. `PRICES_URL_DEFAULTS`: `view: "list",` (was `"grouped"`) and add `group: "none",` after it.

5d. `PRICES_URL_KEYS`: insert `"group",` directly after `"view",`.

5e. Replace the `SORT_KEYS` and `VIEW_MODES` constants and add the two new ones:

```ts
const SORT_KEYS: readonly SortBy[] = [
  "release_date",
  "price",
  "change",
  "units_30d",
  "days_supply",
  "msrp",
];
const VIEW_MODES: readonly ViewMode[] = ["list", "cards"];
const GROUPS: readonly GroupBy[] = ["none", "set"];

/**
 * `view` values written before WP30. They are read (shared links, bookmarks)
 * and never written: the next URL write uses the canonical keys.
 */
const LEGACY_VIEWS: Readonly<Record<string, { view: ViewMode; group: GroupBy }>> = {
  grouped: { view: "cards", group: "set" },
  flat: { view: "cards", group: "none" },
  type_grouped: { view: "cards", group: "none" },
};

function legacyView(value: string | null): { view: ViewMode; group: GroupBy } | null {
  return value !== null && Object.prototype.hasOwnProperty.call(LEGACY_VIEWS, value)
    ? LEGACY_VIEWS[value]
    : null;
}
```

5f. In `parsePricesQuery`, replace the `view:` line with the two lines below, and declare `legacy` just before the `return {`:

```ts
  const legacy = legacyView(params.get("view"));
  return {
    // ...other keys unchanged...
    view: legacy ? legacy.view : pickEnum(params.get("view"), VIEW_MODES, d.view),
    group: pickEnum(params.get("group"), GROUPS, legacy ? legacy.group : d.group),
    // ...
  };
```

`serializePricesState` needs no change: it walks `PRICES_URL_KEYS`.

### Step 6. `app/components/ProductPrices/utils/sorting.ts`: the new sorts

Keep `getProductSortOrder`, WP08's `release_date` branch and the `price` comparator exactly as they are. Change the imports to:

```ts
import { hasCurrentPrice } from "../../../lib/priceGuard";
import type {
  ChartTimeframe,
  Product,
  SortBy,
  SortDirection,
  VolumeMetricsSummary,
} from "../../../types/market";
import { periodChange } from "./catalogValues";
```

Add below the imports:

```ts
/** What the numeric sorts read besides the product itself (WP30). */
export interface SortContext {
  /** The Period: "change" ranks by this window's return. */
  period: ChartTimeframe;
  volumeMetrics?: Readonly<Record<number, VolumeMetricsSummary>>;
  msrpMultiples?: Readonly<Record<number, number>>;
}

/** The direction a sort starts in when it is picked. */
export const DEFAULT_SORT_DIRECTION: Readonly<Record<SortBy, SortDirection>> = {
  release_date: "desc",
  price: "desc",
  change: "desc",
  units_30d: "desc",
  days_supply: "asc",
  msrp: "desc",
};

const SORT_LABELS: Readonly<Record<Exclude<SortBy, "change">, string>> = {
  release_date: "Release date",
  price: "Price",
  units_30d: "Units sold 30D",
  days_supply: "Days of supply",
  msrp: "x MSRP",
};

/** Visible name of a sort. "change" names the Period: "1M change" is the 30-day change. */
export function sortLabel(key: SortBy, period: ChartTimeframe): string {
  return key === "change" ? `${period} change` : SORT_LABELS[key];
}

/** Plain-language order, for the direction button and header names. */
export function directionLabel(key: SortBy, direction: SortDirection): string {
  if (key === "release_date") return direction === "desc" ? "Newest first" : "Oldest first";
  return direction === "desc" ? "High to low" : "Low to high";
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The number a sort ranks by. null sorts last in both directions. */
export function sortValue(product: Product, key: SortBy, context: SortContext): number | null {
  switch (key) {
    case "price":
      return hasCurrentPrice(product) ? finiteOrNull(product.usd_price) : null;
    case "change":
      return periodChange(product, context.period);
    case "units_30d":
      return finiteOrNull(context.volumeMetrics?.[product.id]?.units_sold_30d);
    case "days_supply":
      return finiteOrNull(context.volumeMetrics?.[product.id]?.days_of_supply);
    case "msrp":
      return finiteOrNull(context.msrpMultiples?.[product.id]);
    default:
      return null;
  }
}

// Only reached by callers that pass no context (older tests): every numeric
// value is then unknown for units, supply and MSRP, and "change" uses 3M.
const NO_CONTEXT: SortContext = { period: "3M" };
```

Change the signature to `export function sortProducts(products: Product[], sortKey: SortBy, sortDirection: SortDirection, context?: SortContext): Product[]` (update its JSDoc: "Sort by release date, price, the Period's change, units sold 30D, days of supply or x MSRP"). Directly after the `release_date` branch's closing `}` and before the `return [...products].sort(` of the price comparator, insert:

```ts
  if (sortKey !== "price") {
    // Numeric sorts (WP30): decorate once, unknown values last in both
    // directions, ties keep the incoming order so the result is deterministic.
    const ctx = context ?? NO_CONTEXT;
    const decorated = products.map((product, index) => ({
      product,
      index,
      value: sortValue(product, sortKey, ctx),
    }));
    decorated.sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value === b.value) return a.index - b.index;
        return a.value === null ? 1 : -1;
      }
      if (a.value !== b.value) {
        return sortDirection === "asc" ? a.value - b.value : b.value - a.value;
      }
      return a.index - b.index;
    });
    return decorated.map((entry) => entry.product);
  }
```

### Step 7. Shared value helpers

7a. `app/components/ProductPrices/utils/catalogValues.ts` (new):

```ts
import { formatInteger } from "../../../lib/format";
import { hasCurrentPrice } from "../../../lib/priceGuard";
import type { ChartTimeframe, Product, SortBy } from "../../../types/market";
import { getProductTypeLabel } from "./filtering";

/** Rows or cards per Suspense boundary when ungrouped (research §13.3). */
export const ITEMS_PER_CHUNK = 24;

export function chunk<T>(items: readonly T[], size: number = ITEMS_PER_CHUNK): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}

/**
 * The one change a row or card shows: the Period's return in percent points,
 * only when the product has a current price (migration 0023 withholds the
 * rest). Same number in USD and CAD.
 */
export function periodChange(product: Product, period: ChartTimeframe): number | null {
  if (!hasCurrentPrice(product)) return null;
  const value = product.returns?.[period];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Screen-reader reason for a missing change. */
export function changeMissingReason(product: Product): string {
  return hasCurrentPrice(product) ? "Not enough price history for this period" : "Price withheld";
}

export function catalogNames(product: Product): { setName: string; typeLabel: string } {
  return {
    setName: product.sets?.name || "Unknown Set",
    typeLabel: getProductTypeLabel(product),
  };
}

export function formatUnits(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? formatInteger(value) : "--";
}

/** Whole days, "<1" below one day, "--" when unknown. */
export function formatDaysOfSupply(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  if (value < 1) return "<1";
  return formatInteger(Math.round(value));
}

/**
 * Which value the phone row's meta slot shows: the sorted value when the row
 * has no other place for it, else units sold 30D. Also the CSS switch
 * (data-meta on the catalog wrapper).
 */
export type ListMetaKey = "units" | "dos" | "msrp";

export function listMetaKey(sortKey: SortBy): ListMetaKey {
  if (sortKey === "days_supply") return "dos";
  if (sortKey === "msrp") return "msrp";
  return "units";
}
```

7b. `app/components/ProductPrices/shared/msrp.ts` (new). Variant A, WP28 landed:

```ts
/** x MSRP text ("1.4x"), or null. WP28 owns the formatter. */
export { formatMsrpMultiple } from "../../../lib/productAttributes";
```

Variant B, WP28 not landed (WP28's step 12d replaces this body with variant A):

```ts
const ONE_DECIMAL = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * x MSRP text ("1.4x"), or null. Copy of WP28's formatMsrpMultiple so the
 * list compiles before WP28; WP28 step 12d replaces this file with a
 * re-export. The page sends no multiples until then, so nothing prints.
 */
export function formatMsrpMultiple(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return null;
  return `${(value < 9.95 ? ONE_DECIMAL : WHOLE).format(value)}x`;
}
```

### Step 8. `app/components/ProductPrices/utils/filtering.ts`

- Export the label helper: `function getProductTypeLabel(` becomes `export function getProductTypeLabel(`.
- Delete `groupProductsByType` and its JSDoc. Before deleting, `grep -rn "groupProductsByType" app` must list only `filtering.ts` and `ProductPrices/index.tsx` (the container stops using it in step 18); if a test imports it, delete that test case.

### Step 9. `app/components/ProductPrices/shared/ProductImage.tsx`: a `thumb` variant

Additive edits to WP12's file:

- Props, after `priority?: boolean;`:

```ts
  /**
   * "thumb" (WP30): a 40 or 64 px thumbnail next to text that already names
   * the product. Decorative (alt=""), almost no inner padding, visible at once
   * (no fade and no "Loading..." overlay), and a plain neutral box when there
   * is no image. Use with preferThumbnail.
   */
  variant?: "default" | "thumb";
```

- Destructure `variant = "default",` and add `const isThumb = variant === "thumb";` as the first line of the body.
- `const [isLoading, setIsLoading] = useState(!priority);` becomes `useState(!priority && !isThumb);`.
- Directly before the existing `if (!imageUrl || imageError) {` fallback, add:

```tsx
  if ((!imageUrl || imageError) && isThumb) {
    return <div aria-hidden="true" className={`bg-surface-alt ${className}`} />;
  }
```

- Inner wrapper: `className="w-full h-full flex items-center justify-center p-4"` becomes ``className={`w-full h-full flex items-center justify-center ${isThumb ? "p-0.5" : "p-4"}`}``.
- `alt={productName}` becomes `alt={isThumb ? "" : productName}`.

Nothing else changes (thumbnail fallback, `priority`, `loading`, the overlay condition).

### Step 10. `app/components/MarketView/MiniSparkline.tsx`: a responsive list size

WP26's file. Change `type SparklineSize = "card" | "row";` to `type SparklineSize = "card" | "row" | "list";` and add to `BOX`:

```ts
  // list: /prices list rows (WP30): 64x24 on phones, 96x28 from 768 px.
  list: "h-6 w-16 md:h-7 md:w-24",
```

### Step 11. Scroll anchor: `utils/scrollAnchor.ts` and `hooks/useScrollAnchor.ts` (new)

11a. `app/components/ProductPrices/utils/scrollAnchor.ts`:

```ts
/**
 * Return to the tapped row after Back (research/performance-excellence.md
 * §13.4). On a product-link click the row's id and its distance from the top
 * of the viewport go into history.state; when /prices mounts again the page
 * scrolls so that row sits at the same distance.
 */

export const SCROLL_ANCHOR_KEY = "pfPricesAnchor";
/** Closer than this, the browser's own restoration is kept. */
export const ANCHOR_TOLERANCE_PX = 4;

export interface ScrollAnchor {
  id: number;
  offsetFromTop: number;
}

export function readScrollAnchor(state: unknown): ScrollAnchor | null {
  if (typeof state !== "object" || state === null) return null;
  const value = (state as Record<string, unknown>)[SCROLL_ANCHOR_KEY];
  if (typeof value !== "object" || value === null) return null;
  const { id, offsetFromTop } = value as Record<string, unknown>;
  if (typeof id !== "number" || !Number.isInteger(id)) return null;
  if (typeof offsetFromTop !== "number" || !Number.isFinite(offsetFromTop)) return null;
  return { id, offsetFromTop };
}

/**
 * The history state with the anchor set (or removed with null). Every other
 * key is kept, including Next's __NA and tree: a replaceState whose data has
 * __NA goes straight to the browser without a router action.
 */
export function withScrollAnchor(state: unknown, anchor: ScrollAnchor | null): Record<string, unknown> {
  const next: Record<string, unknown> =
    typeof state === "object" && state !== null ? { ...(state as Record<string, unknown>) } : {};
  if (anchor) next[SCROLL_ANCHOR_KEY] = anchor;
  else delete next[SCROLL_ANCHOR_KEY];
  return next;
}

/** Pixels to scroll by so the anchored element is back at its offset; 0 when close enough. */
export function anchorScrollDelta(
  currentTop: number,
  anchor: ScrollAnchor,
  tolerance: number = ANCHOR_TOLERANCE_PX
): number {
  const delta = Math.round(currentTop - anchor.offsetFromTop);
  return Math.abs(delta) <= tolerance ? 0 : delta;
}

export interface ClickLike {
  target: EventTarget | null;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/**
 * The anchor for a plain left click on a product link (an element with
 * data-anchor-link) inside a row or card (an element with data-anchor-id).
 * Modified clicks open a new tab and keep this page, so they record nothing.
 */
export function anchorFromClick(event: ClickLike): ScrollAnchor | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const link = target.closest("a[data-anchor-link]");
  if (!link) return null;
  const item = link.closest<HTMLElement>("[data-anchor-id]");
  if (!item) return null;
  const id = Number(item.dataset.anchorId);
  if (!Number.isInteger(id)) return null;
  return { id, offsetFromTop: Math.round(item.getBoundingClientRect().top) };
}
```

11b. `app/components/ProductPrices/hooks/useScrollAnchor.ts`:

```ts
"use client";

import { useCallback, useEffect, useSyncExternalStore, type MouseEvent } from "react";
import {
  anchorFromClick,
  anchorScrollDelta,
  readScrollAnchor,
  withScrollAnchor,
} from "../utils/scrollAnchor";

const noopSubscribe = () => () => {};

/**
 * false on the server and during hydration, true afterwards. The render that
 * flips it is the one in which the container applies the URL's state (WP08),
 * so an effect keyed on it sees the rows the URL asks for. On a client-side
 * mount (Back) it is true from the first render.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * Restores the scroll position to the anchored row once per mount and
 * returns the click-capture handler that records the anchor.
 */
export function useScrollAnchor(): (event: MouseEvent<HTMLElement>) => void {
  const hydrated = useIsHydrated();

  useEffect(() => {
    if (!hydrated) return;
    const anchor = readScrollAnchor(window.history.state);
    if (!anchor) return;
    // Clear first: a reload or a later visit must not jump back here.
    window.history.replaceState(withScrollAnchor(window.history.state, null), "");

    let frame = 0;
    let passes = 0;
    const correct = () => {
      const element = document.querySelector<HTMLElement>(`[data-anchor-id="${anchor.id}"]`);
      if (!element) return; // filtered out since: keep the browser's position
      const delta = anchorScrollDelta(element.getBoundingClientRect().top, anchor);
      if (delta !== 0) {
        window.scrollTo({ top: window.scrollY + delta, behavior: "instant" });
      }
      // Rows scrolled into view replace their content-visibility estimate
      // with their real height; one more pass absorbs any difference.
      passes += 1;
      if (passes < 2) frame = window.requestAnimationFrame(correct);
    };
    frame = window.requestAnimationFrame(correct);
    return () => window.cancelAnimationFrame(frame);
  }, [hydrated]);

  return useCallback((event: MouseEvent<HTMLElement>) => {
    const anchor = anchorFromClick(event);
    if (!anchor) return;
    window.history.replaceState(withScrollAnchor(window.history.state, anchor), "");
  }, []);
}
```

The `replaceState` calls pass no URL, so Next's patched `replaceState` never dispatches a router action; the data carries Next's `__NA` because it spreads the current state. WP08's debounced URL writer uses `replaceState(null, ...)`, which would drop the key, but a pending write is cancelled when a navigation lands first (WP08), so a click followed by navigation keeps the anchor.

### Step 12. `app/components/ProductPrices/views/SetGroupHeader.tsx` (new)

```tsx
import Badge from "../../ui/Badge";
import { formatDateOnly } from "../../../lib/format";

export interface SetGroupHeaderProps {
  /** id of the h2, for the section's aria-labelledby. */
  id: string;
  setName: string;
  setCode?: string | null;
  generation?: string | null;
  expansionType?: string | null;
  releaseDate?: string | null;
}

/**
 * One-line set header for both catalog views (WP30). Facts shared by the
 * whole group (code, era, release, "Special Expansion") appear once here and
 * never on the rows (01-PRODUCT-DIRECTION.md §3.3 badge budget).
 */
export default function SetGroupHeader({
  id,
  setName,
  setCode,
  generation,
  expansionType,
  releaseDate,
}: SetGroupHeaderProps) {
  const facts = [generation, releaseDate ? `Released ${formatDateOnly(releaseDate)}` : null].filter(
    (fact): fact is string => Boolean(fact)
  );
  return (
    <div className="flex min-h-10 min-w-0 items-baseline gap-x-3 px-1 py-2">
      <h2 id={id} className="min-w-0 max-w-full truncate text-h3 font-semibold text-ink">
        {setName}
      </h2>
      <p className="min-w-0 flex-1 truncate text-small text-ink-soft">
        {setCode && <span className="uppercase tabular-nums tracking-wide">{setCode}</span>}
        {facts.map((fact, index) => (
          <span key={fact}>
            {setCode || index > 0 ? " · " : ""}
            {fact}
          </span>
        ))}
      </p>
      {expansionType && expansionType !== "Main Series" && (
        <Badge className="shrink-0">{expansionType}</Badge>
      )}
    </div>
  );
}
```

### Step 13. `app/components/ProductPrices/views/ProductListRow.tsx` (new)

```tsx
import { memo } from "react";
import IntentLink from "../../IntentLink";
import MiniSparkline from "../../MarketView/MiniSparkline";
import AsOf from "../../ui/AsOf";
import Delta from "../../ui/Delta";
import ProductImage from "../shared/ProductImage";
import { formatMsrpMultiple } from "../shared/msrp";
import {
  catalogNames,
  changeMissingReason,
  formatDaysOfSupply,
  formatUnits,
  periodChange,
} from "../utils/catalogValues";
import type { ChartTimeframe, Product } from "../../../types/market";

export interface ProductListRowProps {
  product: Product;
  /** The Period: which return the Delta shows. */
  period: ChartTimeframe;
  /** WP26 encoded series; undefined = not loaded (flat bar), null = "No history". */
  sparkline: string | null | undefined;
  unitsSold30d: number | null;
  daysOfSupply: number | null;
  msrpMultiple: number | null;
  /** Render the x MSRP cell (only when some product has one). */
  showMsrp: boolean;
  formatPrice: (usdPrice: number | null | undefined) => string;
  /** Server render date (YYYY-MM-DD). Without it no stale glyph is drawn. */
  referenceDate?: string;
}

/**
 * One catalog row (WP30). A single grid element that is two lines of 56 px
 * below 768 px (DataListRow anatomy) and one line of 44 px from 768 px. The
 * layout lives in globals.css (.pf-list-row, .pf-a-*); do not add Tailwind
 * display, grid, height or padding utilities to those elements. WP33 reuses
 * this row on phones.
 */
function ProductListRow({
  product,
  period,
  sparkline,
  unitsSold30d,
  daysOfSupply,
  msrpMultiple,
  showMsrp,
  formatPrice,
  referenceDate,
}: ProductListRowProps) {
  const { setName, typeLabel } = catalogNames(product);
  return (
    <li data-anchor-id={product.id} className="pf-cv-row">
      <IntentLink
        href={`/product/${product.id}`}
        data-anchor-link=""
        className="pf-list-row text-body transition-colors duration-150 hover:bg-surface-alt active:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action motion-reduce:transition-none"
      >
        <span className="pf-a-thumb size-10 overflow-hidden rounded-control bg-surface-alt">
          <ProductImage
            imageUrl={product.image_url}
            productName={`${setName} ${typeLabel}`}
            className="size-10"
            preferThumbnail
            variant="thumb"
          />
        </span>
        <span className="pf-a-name min-w-0 truncate">
          <span className="font-medium text-ink">
            {setName} · {typeLabel}
          </span>
          {product.variant && <span className="ml-2 text-small text-ink-soft">{product.variant}</span>}
        </span>
        <span className="pf-a-price whitespace-nowrap text-right font-semibold tabular-nums text-ink">
          {formatPrice(product.usd_price)}
          {referenceDate && (
            <AsOf
              date={product.price_recorded_at}
              variant="table"
              referenceDate={referenceDate}
              className="ml-1"
            />
          )}
        </span>
        <span className="pf-a-delta whitespace-nowrap text-right text-small">
          <Delta value={periodChange(product, period)} missingReason={changeMissingReason(product)} />
        </span>
        <span className="pf-a-trend" aria-hidden="true">
          <MiniSparkline series={sparkline} size="list" />
        </span>
        <span className="pf-a-units min-w-0 truncate text-small tabular-nums text-ink-soft md:text-right">
          {formatUnits(unitsSold30d)}
          <span className="pf-meta-suffix"> sold 30D</span>
        </span>
        <span className="pf-a-dos min-w-0 truncate text-small tabular-nums text-ink-soft md:text-right">
          {formatDaysOfSupply(daysOfSupply)}
          <span className="pf-meta-suffix"> days of supply</span>
        </span>
        {showMsrp && (
          <span className="pf-a-msrp min-w-0 truncate text-small tabular-nums text-ink-soft md:text-right">
            {formatMsrpMultiple(msrpMultiple) ?? "--"}
            <span className="pf-meta-suffix"> MSRP</span>
          </span>
        )}
      </IntentLink>
    </li>
  );
}

export default memo(ProductListRow);
```

Grid items are blockified, so `truncate` works on these spans. `IntentLink` forwards `data-anchor-link` to the `<a>`.

### Step 14. `app/components/ProductPrices/views/ListView.tsx` (new)

```tsx
import { Suspense } from "react";
import { DataList } from "../../ui/DataList";
import { METRIC_DEFINITIONS } from "../../../lib/metricDefinitions";
import { sparklineFor, type SparklinePayload } from "../../../lib/sparkline";
import { chunk } from "../utils/catalogValues";
import { DEFAULT_SORT_DIRECTION, directionLabel } from "../utils/sorting";
import ProductListRow from "./ProductListRow";
import SetGroupHeader from "./SetGroupHeader";
import type {
  ChartTimeframe,
  Product,
  SortBy,
  SortDirection,
  VolumeMetricsSummary,
} from "../../../types/market";

const RETURN_METRIC: Readonly<Record<ChartTimeframe, string>> = {
  "7D": "return7d",
  "1M": "return1m",
  "3M": "return3m",
  "6M": "return6m",
  "1Y": "return1y",
};

/** WP24's one-line definition for a header tooltip; undefined when the key is unknown. */
function metricShort(key: string): string | undefined {
  const definitions = METRIC_DEFINITIONS as unknown as Readonly<Record<string, { short: string } | undefined>>;
  return definitions[key]?.short;
}

export interface ListHeaderProps {
  period: ChartTimeframe;
  sortKey: SortBy;
  sortDirection: SortDirection;
  showMsrp: boolean;
  onSort: (key: SortBy, direction: SortDirection) => void;
}

function HeaderSortButton({
  column,
  label,
  help,
  sortKey,
  sortDirection,
  onSort,
}: {
  column: SortBy;
  label: string;
  help?: string;
  sortKey: SortBy;
  sortDirection: SortDirection;
  onSort: (key: SortBy, direction: SortDirection) => void;
}) {
  const active = sortKey === column;
  const next: SortDirection = active
    ? sortDirection === "asc"
      ? "desc"
      : "asc"
    : DEFAULT_SORT_DIRECTION[column];
  return (
    <button
      type="button"
      onClick={() => onSort(column, next)}
      title={help}
      className={`flex w-full items-center justify-end gap-1 rounded-control uppercase tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action ${
        active ? "font-bold text-ink" : "font-semibold text-ink-soft hover:text-ink"
      }`}
    >
      {label}
      <span aria-hidden="true" className={active ? "" : "opacity-40"}>
        {active ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
      </span>
      {active && <span className="sr-only">{`, sorted ${directionLabel(column, sortDirection).toLowerCase()}`}</span>}
    </button>
  );
}

/**
 * Column header for the list from 768 px (hidden on phones by CSS). Sticky
 * under the 64 px site header. Cheap to render, so the container renders it
 * outside the memoised list body.
 */
export function ListHeader({ period, sortKey, sortDirection, showMsrp, onSort }: ListHeaderProps) {
  const sortable = (area: string, column: SortBy, label: string, help?: string) => (
    <span className={area}>
      <HeaderSortButton
        column={column}
        label={label}
        help={help}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={onSort}
      />
    </span>
  );
  return (
    <div className="pf-list-row pf-list-head sticky top-16 z-10 border-b border-line bg-surface text-caption text-ink-soft">
      <span className="pf-a-thumb" aria-hidden="true" />
      <span className="pf-a-name font-semibold uppercase tracking-wide">Product</span>
      {sortable("pf-a-price", "price", "Price", metricShort("marketPrice"))}
      {sortable("pf-a-delta", "change", `${period} change`, metricShort(RETURN_METRIC[period]))}
      <span
        className="pf-a-trend font-semibold uppercase tracking-wide"
        title="Price over the selected period, scaled to its own low and high"
      >
        Trend
      </span>
      {sortable("pf-a-units", "units_30d", "Sold 30D", metricShort("unitsSold30d"))}
      {sortable("pf-a-dos", "days_supply", "Days supply", metricShort("daysOfSupply"))}
      {showMsrp && sortable("pf-a-msrp", "msrp", "x MSRP", metricShort("msrpMultiple"))}
    </div>
  );
}

export interface ListViewProps {
  products: readonly Product[];
  /** Set name to its products, in display order, when grouped; else null. */
  groups: ReadonlyMap<string, readonly Product[]> | null;
  period: ChartTimeframe;
  sparklines: SparklinePayload | undefined;
  volumeMetrics: Readonly<Record<number, VolumeMetricsSummary>>;
  msrpMultiples: Readonly<Record<number, number>>;
  showMsrp: boolean;
  formatPrice: (usdPrice: number | null | undefined) => string;
  referenceDate?: string;
}

/**
 * The default /prices view (WP30): one ranked list, or one list per set.
 * Each set group, or each run of 24 rows, is its own Suspense boundary so
 * React hydrates the page in slices (research §13.3). The boundaries never
 * suspend: all data is in props.
 */
export default function ListView({
  products,
  groups,
  period,
  sparklines,
  volumeMetrics,
  msrpMultiples,
  showMsrp,
  formatPrice,
  referenceDate,
}: ListViewProps) {
  const rows = (items: readonly Product[]) =>
    items.map((product) => (
      <ProductListRow
        key={product.id}
        product={product}
        period={period}
        sparkline={sparklineFor(sparklines, product.id)}
        unitsSold30d={volumeMetrics[product.id]?.units_sold_30d ?? null}
        daysOfSupply={volumeMetrics[product.id]?.days_of_supply ?? null}
        msrpMultiple={msrpMultiples[product.id] ?? null}
        showMsrp={showMsrp}
        formatPrice={formatPrice}
        referenceDate={referenceDate}
      />
    ));

  if (groups) {
    return (
      <div className="space-y-4">
        {Array.from(groups.entries()).map(([setName, setProducts], index) => {
          const first = setProducts[0];
          const headingId = `pf-list-set-${index}`;
          return (
            <Suspense key={setName} fallback={null}>
              <section aria-labelledby={headingId}>
                <SetGroupHeader
                  id={headingId}
                  setName={setName}
                  setCode={first?.sets?.code}
                  generation={first?.sets?.generations?.name}
                  expansionType={first?.sets?.expansion_type}
                  releaseDate={first?.sets?.release_date}
                />
                <DataList label={`${setName} products`}>{rows(setProducts)}</DataList>
              </section>
            </Suspense>
          );
        })}
      </div>
    );
  }

  return (
    <DataList label="Products">
      {chunk(products).map((items, index) => (
        // Index keys keep the boundaries stable across sorts; rows keep their
        // own product-id keys inside each boundary.
        <Suspense key={index} fallback={null}>
          {rows(items)}
        </Suspense>
      ))}
    </DataList>
  );
}
```

If `METRIC_DEFINITIONS` does not exist (soft check (b)), delete its import and make `metricShort` return `undefined`. If WP28 has not landed, `metricShort("msrpMultiple")` returns `undefined`, which is fine (the column is hidden anyway).

### Step 15. `app/components/ProductPrices/cards/ProductCard.tsx`: fixed anatomy

Replace the file. Carry over WP26's `FullChartToggle` and `FullChartPanel` functions and the chart-fetch effect exactly as they are in the current file (the versions below are WP26's; if WP23, WP27 or WP28 restyled them, keep the current file's class strings). If WP28 has landed, its `msrpMultiple` prop and `MsrpMultiple` element are replaced by the detail line below (the text stays "1.4x MSRP", which WP28's test asserts).

```tsx
"use client";

import { memo, useEffect, useState, type ReactNode } from "react";
import IntentLink from "../../IntentLink";
import MiniSparkline from "../../MarketView/MiniSparkline";
import AsOf from "../../ui/AsOf";
import Delta from "../../ui/Delta";
import Skeleton from "../../ui/Skeleton";
import LazyPriceChart from "../shared/LazyPriceChart";
import ProductImage from "../shared/ProductImage";
import { formatMsrpMultiple } from "../shared/msrp";
import { type HistoryLoadingStore, useIsHistoryLoading } from "../hooks/historyLoadingStore";
import {
  catalogNames,
  changeMissingReason,
  formatUnits,
  periodChange,
} from "../utils/catalogValues";
import { formatDateOnly } from "../../../lib/format";
import { hasCurrentPrice } from "../../../lib/priceGuard";
import type { ChartTimeframe, Currency, PriceHistoryEntry, Product } from "../../../types/market";

interface ProductCardProps {
  product: Product;
  /**
   * Ungrouped cards name the set, code and release date above the title.
   * Inside a set group the group header already says it.
   */
  showSet?: boolean;
  /** The Period: the change shown, and the range the chart opens at. */
  chartTimeframe: ChartTimeframe;
  history?: PriceHistoryEntry[];
  historyLoadingStore?: HistoryLoadingStore;
  /** WP26 encoded series: undefined = not loaded (flat bar), null = "No history". */
  sparkline?: string | null;
  unitsSold30d?: number | null;
  /** WP28: x MSRP; null or absent leaves it out of the detail line. */
  msrpMultiple?: number | null;
  /** Server render date (YYYY-MM-DD). Without it no stale glyph is drawn. */
  referenceDate?: string;
  selectedCurrency: Currency;
  exchangeRate: number;
  formatPrice: (price: number | null | undefined) => string;
  /** Fetch full history when the chart opens (WP26). Resolves null on failure. */
  onLoadChart: (productId: number) => Promise<PriceHistoryEntry[] | null>;
}

// WP07's withheld-price note, as a plain string for the detail line.
function stalePriceNote(product: Product): string {
  return product.price_recorded_at
    ? `No current price, last recorded ${formatDateOnly(product.price_recorded_at)}`
    : "No current price yet";
}

// Variant, units sold and x MSRP on one line; the withheld note replaces them.
function detailLine(product: Product, unitsSold30d: number | null, msrpMultiple: number | null): string {
  if (!hasCurrentPrice(product)) return stalePriceNote(product);
  const msrp = formatMsrpMultiple(msrpMultiple);
  return [
    product.variant || null,
    unitsSold30d !== null ? `${formatUnits(unitsSold30d)} sold 30D` : null,
    msrp ? `${msrp} MSRP` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

// FullChartToggle and FullChartPanel: WP26's components, unchanged. Paste the
// current file's two functions here.

const ProductCard = memo(function ProductCard({
  product,
  showSet = true,
  chartTimeframe,
  history,
  historyLoadingStore,
  sparkline,
  unitsSold30d = null,
  msrpMultiple = null,
  referenceDate,
  selectedCurrency,
  exchangeRate,
  formatPrice,
  onLoadChart,
}: ProductCardProps) {
  const [showFullChart, setShowFullChart] = useState(false);
  const historyLoading = useIsHistoryLoading(historyLoadingStore, product.id);
  const [chartFailed, setChartFailed] = useState(false);
  const [chartAttempt, setChartAttempt] = useState(0);

  // WP26: full history is fetched only when the chart opens.
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

  const { setName, typeLabel } = catalogNames(product);
  const href = `/product/${product.id}`;
  const setFacts = [
    product.sets?.code ? product.sets.code.toUpperCase() : null,
    product.sets?.release_date ? formatDateOnly(product.sets.release_date) : null,
  ].filter((fact): fact is string => fact !== null);
  const detail = detailLine(product, unitsSold30d, msrpMultiple);

  // The article carries no padding or border, so its height is exactly what
  // contain-intrinsic-block-size estimates (globals.css --pf-size-card*).
  return (
    <article data-anchor-id={product.id} data-show-set={showSet ? "" : undefined} className="pf-card">
      <div className="rounded-card border border-line bg-surface p-3">
        <div className="flex gap-3">
          <IntentLink
            href={href}
            data-anchor-link=""
            tabIndex={-1}
            aria-hidden="true"
            className="block size-16 shrink-0 overflow-hidden rounded-control bg-surface-alt"
          >
            <ProductImage
              imageUrl={product.image_url}
              productName={`${setName} ${typeLabel}`}
              className="size-16"
              preferThumbnail
              variant="thumb"
            />
          </IntentLink>

          <div className="min-w-0 flex-1">
            {showSet && (
              <p className="truncate text-caption text-ink-soft">
                {[setName, ...setFacts].join(" · ")}
              </p>
            )}
            <h3 className="truncate text-h3 font-semibold text-ink" title={typeLabel}>
              <IntentLink
                href={href}
                data-anchor-link=""
                className="rounded-control hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
              >
                {typeLabel}
              </IntentLink>
            </h3>
            {/* Always rendered (non-breaking space when empty): fixed height. */}
            <p className="truncate text-small text-ink-soft">{detail || " "}</p>

            <div className="mt-2 flex items-center gap-3">
              {/* One fixed-width price column: prices line up across cards. */}
              <div className="w-28 shrink-0 text-right">
                <p className="whitespace-nowrap text-h2 font-semibold tabular-nums text-ink">
                  {formatPrice(product.usd_price)}
                  {referenceDate && (
                    <AsOf
                      date={product.price_recorded_at}
                      variant="table"
                      referenceDate={referenceDate}
                      className="ml-1"
                    />
                  )}
                </p>
                <div className="text-small">
                  <Delta
                    value={periodChange(product, chartTimeframe)}
                    period={chartTimeframe}
                    missingReason={changeMissingReason(product)}
                  />
                </div>
              </div>
              <MiniSparkline series={sparkline} />
            </div>

            {/* Fixed 44 px row on every pointer type: constant card height. */}
            <div className="mt-1 flex h-11 items-center gap-3">
              <FullChartToggle open={showFullChart} onToggle={() => setShowFullChart((prev) => !prev)} />
              <a
                href={product.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-control text-small font-semibold text-action hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
              >
                View on TCGplayer
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          </div>
        </div>

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
      </div>
    </article>
  );
});

export default ProductCard;
```

Notes:
- `ReactNode` and `Skeleton` are used by the pasted `FullChartPanel`; if the pasted code does not use one of them, drop that import (lint names it).
- The `LazyPriceChart` props are WP26's; if the current file passes different ones, keep the current file's.
- Removed on purpose: `viewMode`, `showSetAsPrimary`, `getAccentClass` (the stripe), `VolumeChip`, `ReturnMetrics`, `ExpansionTypeBadge`, `VariantBadge`, the "Updated:" line, the 160 to 192 px image boxes.
- Height budget: 12 (padding) + [16 caption, ungrouped only] + 24 (title) + 18 (detail) + 8 + 46 (price 28 and change 18; the 40 px sparkline fits beside) + 4 + 44 (actions) + 12 (padding) + 2 (border) = 170 px grouped, 186 px ungrouped.

### Step 16. `cards/ProductGrid.tsx` and `views/CardsView.tsx`

16a. `app/components/ProductPrices/cards/ProductGrid.tsx`: the grid class becomes

```tsx
      className={`pf-card-grid grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 ${className}`}
```

and its JSDoc: "Mobile: 1 column. From 768 px: 2. From 1280 px: 3 (a 3-column card at 1440 px is about 448 px wide, enough for the type title, the 112 px price column and the 96 px sparkline on one line)."

16b. `app/components/ProductPrices/views/CardsView.tsx` (new):

```tsx
import { Suspense } from "react";
import ProductCard from "../cards/ProductCard";
import ProductGrid from "../cards/ProductGrid";
import type { HistoryLoadingStore } from "../hooks/historyLoadingStore";
import { chunk } from "../utils/catalogValues";
import { sparklineFor, type SparklinePayload } from "../../../lib/sparkline";
import SetGroupHeader from "./SetGroupHeader";
import type {
  ChartTimeframe,
  Currency,
  PriceHistoryEntry,
  Product,
  VolumeMetricsSummary,
} from "../../../types/market";

export interface CardsViewProps {
  products: readonly Product[];
  groups: ReadonlyMap<string, readonly Product[]> | null;
  period: ChartTimeframe;
  sparklines: SparklinePayload | undefined;
  volumeMetrics: Readonly<Record<number, VolumeMetricsSummary>>;
  msrpMultiples: Readonly<Record<number, number>>;
  priceHistory: Readonly<Record<number, PriceHistoryEntry[]>>;
  historyLoadingStore: HistoryLoadingStore;
  onLoadChart: (productId: number) => Promise<PriceHistoryEntry[] | null>;
  selectedCurrency: Currency;
  exchangeRate: number;
  formatPrice: (usdPrice: number | null | undefined) => string;
  referenceDate?: string;
}

/** The optional card view (WP30), grouped by set or in runs of 24. */
export default function CardsView({
  products,
  groups,
  period,
  sparklines,
  volumeMetrics,
  msrpMultiples,
  priceHistory,
  historyLoadingStore,
  onLoadChart,
  selectedCurrency,
  exchangeRate,
  formatPrice,
  referenceDate,
}: CardsViewProps) {
  const card = (product: Product, showSet: boolean) => (
    <ProductCard
      key={product.id}
      product={product}
      showSet={showSet}
      chartTimeframe={period}
      history={priceHistory[product.id]}
      historyLoadingStore={historyLoadingStore}
      sparkline={sparklineFor(sparklines, product.id)}
      unitsSold30d={volumeMetrics[product.id]?.units_sold_30d ?? null}
      msrpMultiple={msrpMultiples[product.id] ?? null}
      referenceDate={referenceDate}
      selectedCurrency={selectedCurrency}
      exchangeRate={exchangeRate}
      formatPrice={formatPrice}
      onLoadChart={onLoadChart}
    />
  );

  if (groups) {
    return (
      <div className="space-y-6">
        {Array.from(groups.entries()).map(([setName, setProducts], index) => {
          const first = setProducts[0];
          const headingId = `pf-cards-set-${index}`;
          return (
            <Suspense key={setName} fallback={null}>
              <section aria-labelledby={headingId}>
                <SetGroupHeader
                  id={headingId}
                  setName={setName}
                  setCode={first?.sets?.code}
                  generation={first?.sets?.generations?.name}
                  expansionType={first?.sets?.expansion_type}
                  releaseDate={first?.sets?.release_date}
                />
                <ProductGrid>{setProducts.map((product) => card(product, false))}</ProductGrid>
              </section>
            </Suspense>
          );
        })}
      </div>
    );
  }

  return (
    <ProductGrid>
      {chunk(products).map((items, index) => (
        <Suspense key={index} fallback={null}>
          {items.map((product) => card(product, true))}
        </Suspense>
      ))}
    </ProductGrid>
  );
}
```

`Suspense` renders no element, so every `article.pf-card` stays a direct child of `.pf-card-grid` and the CSS selectors in step 21 match.

### Step 17. `app/components/ProductPrices/controls/SortControls.tsx`: sort, view, group, count

Replace the file:

```tsx
"use client";

import { useId } from "react";
import SegmentedControl, { type SegmentedOption } from "../../ui/SegmentedControl";
import { DEFAULT_SORT_DIRECTION, directionLabel, sortLabel } from "../utils/sorting";
import type {
  ChartTimeframe,
  GroupBy,
  SortBy,
  SortDirection,
  ViewMode,
} from "../../../types/market";

const VIEW_OPTIONS: readonly SegmentedOption<ViewMode>[] = [
  { value: "list", label: "List" },
  { value: "cards", label: "Cards" },
];

const SORT_ORDER: readonly SortBy[] = [
  "release_date",
  "price",
  "change",
  "units_30d",
  "days_supply",
  "msrp",
];

interface SortControlsProps {
  sortKey: SortBy;
  sortDirection: SortDirection;
  /** The Period, which names the change sort ("3M change"). */
  period: ChartTimeframe;
  /** Offer x MSRP only when some product has one (WP28 data). */
  showMsrp: boolean;
  viewMode: ViewMode;
  groupBy: GroupBy;
  resultCount: number;
  onSortChange: (key: SortBy, direction: SortDirection) => void;
  onViewModeChange: (view: ViewMode) => void;
  onGroupByChange: (group: GroupBy) => void;
}

/**
 * /prices toolbar (WP30). Phones: row 1 sort select, direction and view;
 * row 2 the group checkbox and the result count. From 768 px: one row.
 */
export default function SortControls({
  sortKey,
  sortDirection,
  period,
  showMsrp,
  viewMode,
  groupBy,
  resultCount,
  onSortChange,
  onViewModeChange,
  onGroupByChange,
}: SortControlsProps) {
  const sortId = `${useId()}-sort`;
  const options = SORT_ORDER.filter((key) => key !== "msrp" || showMsrp);
  const nextDirection: SortDirection = sortDirection === "asc" ? "desc" : "asc";
  const current = directionLabel(sortKey, sortDirection);
  const next = directionLabel(sortKey, nextDirection).toLowerCase();

  return (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-x-6 md:gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <label
          htmlFor={sortId}
          className="sr-only text-caption font-semibold uppercase tracking-wide text-ink-soft sm:not-sr-only"
        >
          Sort by
        </label>
        <select
          id={sortId}
          value={sortKey}
          onChange={(event) => {
            const key = event.target.value as SortBy;
            if (key !== sortKey) onSortChange(key, DEFAULT_SORT_DIRECTION[key]);
          }}
          className="h-9 min-w-0 flex-1 rounded-control border border-line bg-surface px-2 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action pointer-coarse:h-11 sm:flex-none sm:text-sm"
        >
          {options.map((key) => (
            <option key={key} value={key}>
              {sortLabel(key, period)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onSortChange(sortKey, nextDirection)}
          title={`${current}. Click for ${next}.`}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action pointer-coarse:size-11"
        >
          <span aria-hidden="true">{sortDirection === "asc" ? "↑" : "↓"}</span>
          <span className="sr-only">{`Sort order: ${current}. Change to ${next}`}</span>
        </button>
        <SegmentedControl
          label="View"
          hideLabel
          options={VIEW_OPTIONS}
          value={viewMode}
          onChange={onViewModeChange}
          fullWidthOnPhone={false}
          className="ml-auto md:ml-4"
        />
      </div>

      <div className="flex items-center justify-between gap-3 md:contents">
        <label className="inline-flex items-center gap-2 text-small text-ink pointer-coarse:min-h-11 md:order-2">
          <input
            type="checkbox"
            checked={groupBy === "set"}
            onChange={(event) => onGroupByChange(event.target.checked ? "set" : "none")}
            className="size-4 accent-action"
          />
          Group by set
        </label>
        <p className="text-small text-ink-soft md:order-3 md:ml-auto">
          <span>Found {resultCount} products</span>
          <span className="md:hidden">{` · ${period} change`}</span>
        </p>
      </div>
    </div>
  );
}
```

"Found {resultCount} products" is WP08's exact copy, now inside the toolbar; the element in the container is removed in step 18 (WP13 forbids changing this copy; WP08's server test matches `Found <!-- -->2<!-- --> products`, which this markup still produces).

### Step 18. `app/components/ProductPrices/index.tsx`: wire the views

Edit in place; do not replace the file (WP13, WP20, WP23, WP26 and possibly WP27/WP28 changed it).

18a. Imports:
- Delete the imports of `ProductGrid`, `ProductCard`, `GroupHeader` and `ProductTypeGroupHeader`, and remove `groupProductsByType` from the `./utils/filtering` import.
- Remove `sparklineFor` from the `../../lib/sparkline` import if nothing else in the file uses it (keep `type SparklinePayload`).
- Add:

```ts
import ListView, { ListHeader } from "./views/ListView";
import CardsView from "./views/CardsView";
import { useScrollAnchor } from "./hooks/useScrollAnchor";
import { listMetaKey } from "./utils/catalogValues";
import type { SortContext } from "./utils/sorting";
```

- Add `GroupBy` to the type import from `../../types/market` (or the path the file uses for `SortBy`).

18b. Props. In `ProductPricesProps` add:

```ts
  /**
   * The server render's UTC date (YYYY-MM-DD), so the stale-price glyph is
   * the same in the HTML and after hydration, even across midnight UTC.
   */
  referenceDate?: string;
```

and destructure `referenceDate`. Only if soft check (d) found no `initialMsrpMultiples`: add at module level `const NO_MSRP_MULTIPLES: Readonly<Record<number, number>> = {};`, the prop `/** WP28: product id -> x MSRP, for products that have one. */ initialMsrpMultiples?: Readonly<Record<number, number>>;` and destructure `initialMsrpMultiples = NO_MSRP_MULTIPLES` (WP28's exact names, so its step 12a works unchanged).

18c. State. Below `const [viewMode, setViewMode] = useState<ViewMode>(initialUrlState.view);` add:

```ts
  const [groupBy, setGroupBy] = useState<GroupBy>(initialUrlState.group);
```

In the `urlState` object literal add `group: groupBy,` after `view: viewMode,`. In the "URL -> state" block add `setGroupBy(fromUrl.group);` after `setViewMode(fromUrl.view);`. In `updateUrlState` add `if (patch.group !== undefined) setGroupBy(patch.group);` after the `patch.view` line.

18d. Scroll anchor. Directly after the `updateUrlState` function add:

```ts
  // Back from a product page returns to the tapped row (research §13.4).
  const captureScrollAnchor = useScrollAnchor();
```

18e. Sorting. Replace the `filteredAndSortedProducts` memo and the two grouping memos (`groupedProducts`, `groupedProductsByType`) with:

```ts
  // x MSRP is offered only when WP28's data exists. An old ?sort=msrp link
  // without data falls back to the default order.
  const hasMsrp = useMemo(
    () => Object.keys(initialMsrpMultiples).length > 0,
    [initialMsrpMultiples]
  );
  const effectiveSortKey: SortBy =
    sortKey === "msrp" && !hasMsrp ? PRICES_URL_DEFAULTS.sort : sortKey;
  const sortContext = useMemo<SortContext>(
    () => ({ period: chartTimeframe, volumeMetrics, msrpMultiples: initialMsrpMultiples }),
    [chartTimeframe, volumeMetrics, initialMsrpMultiples]
  );

  const filteredAndSortedProducts = useMemo(() => {
    const filtered = filterProducts(products, {
      selectedGeneration,
      selectedProductType,
      searchTerm: deferredSearchTerm,
    });
    return sortProducts(filtered, effectiveSortKey, sortDirection, sortContext);
  }, [
    products,
    selectedGeneration,
    selectedProductType,
    deferredSearchTerm,
    effectiveSortKey,
    sortDirection,
    sortContext,
  ]);

  const groupedProducts = useMemo(
    () => (groupBy === "set" ? groupProductsBySet(filteredAndSortedProducts) : null),
    [groupBy, filteredAndSortedProducts]
  );
```

Keep the filter arguments exactly as the current memo has them (WP27 may have changed the search argument); only the `sortProducts` call, its dependencies and the grouping change. `PRICES_URL_DEFAULTS` is already imported from `./utils/urlState` (WP13); if it is not, add it to that import.

18f. Deferred display values. Directly after 18e:

```ts
  // Currency changes (this page's toggle, or the header after WP27) re-render
  // every row. The views read a deferred copy, so the control paints first
  // and the rows follow at transition priority, dimmed while pending.
  const display = useMemo(
    () => ({ selectedCurrency, exchangeRate, formatPrice }),
    [selectedCurrency, exchangeRate, formatPrice]
  );
  const deferredDisplay = useDeferredValue(display);
  const displayPending =
    deferredDisplay.selectedCurrency !== selectedCurrency ||
    deferredDisplay.exchangeRate !== exchangeRate;
  const catalogPending = isTogglePending || displayPending;
  const metaKey = listMetaKey(effectiveSortKey);
```

18g. Replace the whole `cardList` memo (from `const cardList = useMemo(() => {` through its dependency array and `);`) with:

```tsx
  // The expensive part: ~306 rows or cards. Keyed on the deferred-derived
  // lists (WP08) and the deferred display values, never on isTogglePending,
  // so an urgent render (a keystroke, a pressed toggle) reuses these elements.
  const catalogView = useMemo(() => {
    if (filteredAndSortedProducts.length === 0) return null;
    if (viewMode === "list") {
      return (
        <ListView
          products={filteredAndSortedProducts}
          groups={groupedProducts}
          period={chartTimeframe}
          sparklines={sparklines}
          volumeMetrics={volumeMetrics}
          msrpMultiples={initialMsrpMultiples}
          showMsrp={hasMsrp}
          formatPrice={deferredDisplay.formatPrice}
          referenceDate={referenceDate}
        />
      );
    }
    return (
      <CardsView
        products={filteredAndSortedProducts}
        groups={groupedProducts}
        period={chartTimeframe}
        sparklines={sparklines}
        volumeMetrics={volumeMetrics}
        msrpMultiples={initialMsrpMultiples}
        priceHistory={priceHistory}
        historyLoadingStore={historyLoadingStore}
        onLoadChart={ensureHistoryLoaded}
        selectedCurrency={deferredDisplay.selectedCurrency}
        exchangeRate={deferredDisplay.exchangeRate}
        formatPrice={deferredDisplay.formatPrice}
        referenceDate={referenceDate}
      />
    );
  }, [
    viewMode,
    filteredAndSortedProducts,
    groupedProducts,
    chartTimeframe,
    sparklines,
    volumeMetrics,
    initialMsrpMultiples,
    hasMsrp,
    deferredDisplay,
    referenceDate,
    priceHistory,
    historyLoadingStore,
    ensureHistoryLoaded,
  ]);

  const handleSortChange = (sort: SortBy, dir: SortDirection) =>
    startToggleTransition(() => updateUrlState({ sort, dir }));
```

18h. Replace the `<SortControls ... />` element with:

```tsx
        <SortControls
          sortKey={effectiveSortKey}
          sortDirection={sortDirection}
          period={chartTimeframe}
          showMsrp={hasMsrp}
          viewMode={viewMode}
          groupBy={groupBy}
          resultCount={filteredAndSortedProducts.length}
          onSortChange={handleSortChange}
          onViewModeChange={(view) => startToggleTransition(() => updateUrlState({ view }))}
          onGroupByChange={(group) => startToggleTransition(() => updateUrlState({ group }))}
        />
```

and delete the old results-count element (`<div className="text-sm text-slate-600">Found {filteredAndSortedProducts.length} products</div>`, possibly restyled by WP15 or WP23, and its `{/* Results Count */}` comment). Keep the `<NoResults ... />` block where it is.

18i. Replace WP23's dim wrapper (the `{cardList && (<div aria-busy=... >{cardList}</div>)}` block) with:

```tsx
        {catalogView && (
          <div
            data-view={viewMode}
            data-meta={metaKey}
            data-msrp={hasMsrp ? "" : undefined}
            aria-busy={catalogPending || undefined}
            onClickCapture={captureScrollAnchor}
            className={`transition-opacity duration-150 motion-reduce:transition-none ${
              catalogPending ? "opacity-70" : ""
            }`}
          >
            {viewMode === "list" && (
              <ListHeader
                period={chartTimeframe}
                sortKey={effectiveSortKey}
                sortDirection={sortDirection}
                showMsrp={hasMsrp}
                onSort={handleSortChange}
              />
            )}
            {catalogView}
          </div>
        )}
```

18j. Root element: remove the page padding classes (`p-3 md:p-6`) and `min-h-screen` from the root `<div>` of the component (the page's `<main>` already pads it; the double padding cost 24 px of width and 12 px of height on phones). Keep any other classes, the `LocationSearchSignal` Suspense, `space-y-4 md:space-y-6` and `ScrollToTop`.

18k. Leave unchanged: `onChartTimeframeChange` and the currency handler (WP23 already wraps them in `startToggleTransition`), `useSparklines`, `useProductData`, `useVolumeMetrics`, the WP08 URL logic, `NoResults`.

After 18: `grep -n "cardList\|groupedProductsByType\|ProductTypeGroupHeader\|viewMode === \"flat\"\|type_grouped" app/components/ProductPrices/index.tsx` prints nothing, and `grep -c "useSearchParams" app/components/ProductPrices/index.tsx` still prints 0.

### Step 19. `app/prices/page.tsx`: header, reference date, stale dates, days of supply

19a. Imports (keep everything else, including WP13's `metadata`, WP26's `getCachedSparklines` and WP28's `getCachedProductStats` if present):

```tsx
import AsOf from "../components/ui/AsOf";
import PageHeader from "../components/ui/PageHeader";
import ProvenanceLine from "../components/ui/ProvenanceLine";
import { PROVENANCE_SENTENCE } from "../content/disclosures";
import {
  newestPriceDay,
  utcDateKey,
  withStalePriceDates,
} from "../components/ProductPrices/utils/freshness";
```

19b. After the `Promise.all`, replace WP11's two projection lines with:

```ts
  // The server render's UTC date: the stale glyph and "Prices as of" are
  // computed against it on both sides of hydration.
  const referenceDate = utcDateKey();
  const newestDay = newestPriceDay(products);
  // Only the fields the client tree reads go into the HTML (WP11). WP30 adds
  // back the price date for prices 2+ days old (the row glyph) and days of
  // supply (the list column and sort).
  const catalogProducts = withStalePriceDates(toCatalogProducts(products), products, referenceDate);
  const catalogVolumeMetrics = toVolumeSummaries(volumeMetrics, { daysOfSupply: true });
```

19c. Replace the page header block (the `<div className="mb-5 md:mb-6">` holding the eyebrow `<p>`, the `<h1>` and the "{products.length} products tracked" paragraph, as WP03, WP15 and WP24 left it) with:

```tsx
      <PageHeader
        className="mb-4 md:mb-6"
        title="Sealed product prices"
        provenance={
          <ProvenanceLine methodologyHref="/methodology#source">
            {`${products.length} products tracked. ${PROVENANCE_SENTENCE}`}
            {newestDay && (
              <>
                {" "}
                <AsOf date={newestDay} referenceDate={referenceDate} prefix="Prices as of" />.
              </>
            )}
          </ProvenanceLine>
        }
      />
```

19d. On `<ProductPrices ...>` add `referenceDate={referenceDate}`. Keep every other prop.

Nothing here makes the route dynamic: no `cookies()`, `headers()` or `searchParams`. `pnpm build:stub` must still list `/prices` as static with Revalidate 1d.

### Step 20. `app/components/dashboard/RecentlyReleased.tsx` (only if soft check (e) listed it)

On its `<ProductCard`: delete `viewMode="flat"` (and `showSetAsPrimary` if present), add `showSet={false}` (the strip is grouped under WP26's set headers). Change the card wrapper `w-[260px]` to `w-[320px]` (the fixed price column and sparkline need 320 px). Do not pass `referenceDate`: without it the home cards draw no stale glyph, so the ISR home page cannot mismatch across midnight UTC. WP32 rebuilds this strip.

### Step 21. `app/globals.css`: list layout and intrinsic sizes

21a. Delete WP09's block: the comment starting `/*\n * /prices renders every catalog card (~306).` and the three rules for `.pf-card-grid > .pf-card-flat` and `.pf-card-grid > .pf-card-grouped` (including the `@media (min-width: 40rem)` one).

21b. Append:

```css
/* ------------------------------------------------------------------------
 * /prices list rows, cards and their intrinsic sizes (WP30).
 *
 * One DOM per row: the grid re-arranges it per breakpoint. Do not put
 * Tailwind display, grid, height or padding utilities on elements that carry
 * pf-list-row, pf-list-head or pf-a-* classes: these rules own them.
 *
 * The four --pf-size-* values feed contain-intrinsic-block-size and must stay
 * within 10% of the fixture medians recorded in
 * app/components/ProductPrices/views/layoutMetrics.ts (layoutMetrics.test.ts).
 * List rows have a fixed height, so their estimate is exact.
 * ---------------------------------------------------------------------- */
:root {
  --pf-size-list-row: 3.5rem;      /* 56 px: two-line phone row */
  --pf-size-list-row-md: 2.75rem;  /* 44 px: one-line row from 768 px */
  --pf-size-card: 10.625rem;       /* 170 px: card inside a set group */
  --pf-size-card-set: 11.625rem;   /* 186 px: ungrouped card (set line) */
}

@layer components {
  .pf-list-row {
    display: grid;
    align-items: center;
    column-gap: 0.5rem;
    height: var(--pf-size-list-row);
    padding: 0.375rem 0.75rem;
    grid-template-columns: minmax(0, 1fr) auto auto 4rem;
    grid-template-rows: 1.25rem 1.5rem;
    grid-template-areas:
      "name name name name"
      "meta price delta trend";
  }
  .pf-list-head { display: none; }
  .pf-a-thumb { display: none; grid-area: thumb; }
  .pf-a-name { grid-area: name; }
  .pf-a-price { grid-area: price; }
  .pf-a-delta { grid-area: delta; }
  .pf-a-trend { grid-area: trend; }
  .pf-a-units { grid-area: meta; }
  .pf-a-dos,
  .pf-a-msrp { display: none; }
  /* Phones: the meta slot shows the sorted value when the row has no column for it. */
  [data-meta="dos"] .pf-a-units,
  [data-meta="msrp"] .pf-a-units { display: none; }
  [data-meta="dos"] .pf-a-dos { display: block; grid-area: meta; }
  [data-meta="msrp"] .pf-a-msrp { display: block; grid-area: meta; }

  .pf-cv-row {
    content-visibility: auto;
    contain-intrinsic-block-size: auto var(--pf-size-list-row);
  }
  .pf-card-grid > .pf-card {
    content-visibility: auto;
    contain-intrinsic-block-size: auto var(--pf-size-card);
  }
  .pf-card-grid > .pf-card[data-show-set] {
    contain-intrinsic-block-size: auto var(--pf-size-card-set);
  }

  @media (min-width: 48rem) {
    .pf-list-row {
      column-gap: 0.75rem;
      height: var(--pf-size-list-row-md);
      padding: 0 1rem;
      grid-template-columns: 2.5rem minmax(0, 1fr) 7rem 6rem 6rem 5rem;
      grid-template-rows: minmax(0, 1fr);
      grid-template-areas: "thumb name price delta trend units";
    }
    .pf-list-head { display: grid; height: 2.5rem; }
    .pf-a-thumb { display: block; }
    .pf-a-units,
    [data-meta] .pf-a-units { display: block; grid-area: units; }
    [data-meta] .pf-a-dos,
    [data-meta] .pf-a-msrp { display: none; }
    /* The column header names these values; keep the words for screen readers. */
    .pf-meta-suffix {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border-width: 0;
    }
    .pf-cv-row { contain-intrinsic-block-size: auto var(--pf-size-list-row-md); }
  }

  @media (min-width: 64rem) {
    .pf-list-row {
      grid-template-columns: 2.5rem minmax(0, 1fr) 7rem 6rem 6rem 5rem 6rem;
      grid-template-areas: "thumb name price delta trend units dos";
    }
    [data-msrp] .pf-list-row {
      grid-template-columns: 2.5rem minmax(0, 1fr) 7rem 6rem 6rem 5rem 6rem 4.5rem;
      grid-template-areas: "thumb name price delta trend units dos msrp";
    }
    [data-meta] .pf-a-dos { display: block; grid-area: dos; }
    [data-meta][data-msrp] .pf-a-msrp { display: block; grid-area: msrp; }
  }
}
```

The catalog wrapper always carries `data-meta` (step 18i), so the `[data-meta]` selectors apply; rows rendered elsewhere without it (WP33 tests) still get the phone default. `48rem` and `64rem` are Tailwind 4's `md` and `lg`.

### Step 22. Delete dead code

```bash
grep -rn "ProductTypeGroupHeader" app | grep -v "cards/ProductTypeGroupHeader.tsx"     # expect nothing
git rm app/components/ProductPrices/cards/ProductTypeGroupHeader.tsx
grep -rn "shared/ReturnMetrics\|from \"./ReturnMetrics\"" app                           # expect only test files, if any
git rm app/components/ProductPrices/shared/ReturnMetrics.tsx
```

Delete any test file that only tests `ReturnMetrics` or `ProductTypeGroupHeader`. Keep `GroupHeader.tsx` (the home strip uses it), `VariantBadge.tsx` and `ExpansionTypeBadge.tsx` (`/market` and the product page use them). If `grep -rn "ReturnMetrics" app --include=*.tsx | grep -v ProductReturnMetrics` shows a non-test importer other than `ProductCard.tsx`, keep the file and name the importer in the PR.

### Step 23. `app/components/ProductPrices/views/layoutMetrics.ts` (new) and `scripts/measure-catalog.mjs` (new)

23a. `layoutMetrics.ts` (the numbers are placeholders from the design; step 26 replaces them with the measured medians):

```ts
/**
 * Fixture medians (px) of rendered catalog items, measured with
 * `node scripts/measure-catalog.mjs` against the perf build (WP22 fixture).
 * globals.css --pf-size-* feed contain-intrinsic-block-size and must stay
 * within INTRINSIC_SIZE_TOLERANCE of these (layoutMetrics.test.ts), so a
 * restored scroll position lands on the right row (research §13.4).
 * Re-measure and update both whenever a row or card changes height.
 */
export const MEASURED_ITEM_HEIGHTS_PX = {
  "--pf-size-list-row": 56,
  "--pf-size-list-row-md": 44,
  "--pf-size-card": 170,
  "--pf-size-card-set": 186,
} as const;

/** Rows with price and change fully visible on the first 390 x 844 screen. */
export const MEASURED_PHONE_FIRST_SCREEN_ROWS = 8;

/** Tallest grouped card at 1440 px. */
export const MEASURED_MAX_GROUPED_CARD_PX = 170;

/** YYYY-MM-DD of the measurement. */
export const MEASURED_ON = "2026-10-01";

export const INTRINSIC_SIZE_TOLERANCE = 0.1;
```

23b. `scripts/measure-catalog.mjs`:

```js
/* eslint-disable no-console -- manual measurement tool; console output is its UI. */
// WP30: measure /prices on the perf build (SUPABASE_STUB_FIXTURE=perf pnpm build:stub,
// then node scripts/perf-serve.mjs). Not run in CI. Needs playwright-core outside the lockfile:
//   npm install --no-save --prefix /tmp/pw playwright-core@1.56
//   PW_DIR=/tmp/pw CHROME_PATH="$(command -v google-chrome || command -v chromium)" node scripts/measure-catalog.mjs
import { createRequire } from "node:module";
import path from "node:path";

const base = process.argv[2] ?? "http://127.0.0.1:3100";
const requireFromPw = createRequire(path.join(process.env.PW_DIR ?? "/tmp/pw", "node_modules", "noop.js"));
const { chromium } = requireFromPw("playwright-core");

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });

async function measure({ name, width, height, phone, query, selector }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: phone ? 3 : 1,
    isMobile: phone,
    hasTouch: phone,
  });
  const page = await context.newPage();
  await page.goto(`${base}/prices${query}`, { waitUntil: "networkidle" });
  await page.waitForSelector(`[data-view] ${selector}`);
  await page.waitForFunction(() => !document.querySelector("[data-view][aria-busy]"));
  const firstScreen = await page.evaluate(
    () =>
      [...document.querySelectorAll("[data-anchor-id]")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight && el.querySelector("[data-direction]");
      }).length
  );
  // Render everything, then read real heights (clientHeight: no border).
  await page.addStyleTag({ content: ".pf-cv-row, .pf-card-grid > .pf-card { content-visibility: visible !important; }" });
  const heights = await page.$$eval(selector, (els) => els.map((el) => el.clientHeight));
  const truncatedTitles = await page.$$eval("[data-view] article h3", (els) =>
    els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent)
  );
  await context.close();
  return { name, count: heights.length, median: median(heights), max: Math.max(...heights), firstScreen, truncatedTitles };
}

const results = [
  await measure({ name: "--pf-size-list-row (390, list)", width: 390, height: 844, phone: true, query: "", selector: "li.pf-cv-row" }),
  await measure({ name: "--pf-size-list-row-md (1440, list)", width: 1440, height: 900, phone: false, query: "", selector: "li.pf-cv-row" }),
  await measure({ name: "--pf-size-card (1440, cards grouped)", width: 1440, height: 900, phone: false, query: "?view=cards&group=set", selector: ".pf-card-grid > .pf-card" }),
  await measure({ name: "--pf-size-card (390, cards grouped)", width: 390, height: 844, phone: true, query: "?view=cards&group=set", selector: ".pf-card-grid > .pf-card" }),
  await measure({ name: "--pf-size-card-set (1440, cards)", width: 1440, height: 900, phone: false, query: "?view=cards", selector: ".pf-card-grid > .pf-card[data-show-set]" }),
];
await browser.close();
console.table(results.map(({ truncatedTitles, ...row }) => ({ ...row, truncated: truncatedTitles.length })));
for (const row of results) if (row.truncatedTitles.length) console.log(row.name, "truncated:", row.truncatedTitles);
```

### Step 24. Lighthouse and budgets

24a. `lighthouserc.json`: in the `/prices` entry of `assertMatrix` (pattern `^http://127\\.0\\.0\\.1:3100/prices$`), change `"cumulative-layout-shift": ["error", { "maxNumericValue": 0.05, "aggregationMethod": "median" }]` to `0.02`. Leave the other URLs at 0.05 (01-PRODUCT-DIRECTION.md §6.1: ≤ 0.02 is the `/prices` target only).

24b. `/prices` `resource-summary:image:size`: phones load no thumbnails in the list, so the median image transfer drops. After the CI run (step 26), set this URL's threshold to the job summary's "Suggested image limit" when it is lower than the current one, and never below 1024. Leave `resource-summary:script:size` as calibrated unless the run exceeds it; then follow WP22 D11 (state the reason in the PR; never loosen to get green without one).

24c. `perf-budgets.json`: do not run `--write-limits` (it rewrites every route). After step 26's measurement, for each of `/prices` `jsGzKb`, `documentBrKb` and `flightBrKb`: if `ceil(measured x 1.05)` is below the current `limit`, set `limit` to `min(target, ceil(measured x 1.05))` and `recorded` to the measured value by hand (a lowered limit needs no PR line). If a measurement is above its limit, the gate fails: find the cause first (step 26); a justified raise needs `Perf budget raise: routes./prices.<key> <reason>` in the PR body (WP22 D11.2). No new route is added.

### Step 25. Conventions baseline and docs

25a. `ProductCard.tsx` loses its `--pf-pokeball` and hex uses and two files are deleted, so WP23's ratchet reports lowered counts:

```bash
UPDATE_UI_BASELINE=1 pnpm exec jest app/__tests__/uiConventions.test.ts
pnpm exec jest app/__tests__/uiConventions.test.ts        # passes without the variable
git diff app/__tests__/uiConventions.baseline.json        # only lowered or removed entries
```

If any count went up, fix the file; never raise the baseline.

25b. `app/components/ui/README.md`: under the `DataList` entry add one line: "`/prices` rows (`ProductPrices/views/ProductListRow.tsx`, WP30) reproduce `DataListRow`'s phone anatomy in one responsive grid element (layout in `globals.css`, `.pf-list-row`); reuse that row for product lists that also need desktop columns (WP33)."

### Step 26. Measure, record, calibrate

From `frontend/`:

```bash
rm -rf .perf
SUPABASE_STUB_FIXTURE=perf pnpm build:stub > /tmp/wp30-perf-build.log 2>&1; echo "exit=$?"     # exit=0
grep -c "no fixture route" /tmp/wp30-perf-build.log                                             # 0
node scripts/perf-serve.mjs > /tmp/wp30-serve.log 2>&1 &
for i in $(seq 120); do [ -f .perf/ready ] && break; node -e "setTimeout(()=>{},1000)"; done; cat .perf/ready
pnpm perf:budget; echo "exit=$?"
npm install --no-save --prefix /tmp/pw playwright-core@1.56
PW_DIR=/tmp/pw CHROME_PATH="$(command -v google-chrome || command -v chromium)" node scripts/measure-catalog.mjs
```

1. Copy each median into `MEASURED_ITEM_HEIGHTS_PX` (round to the nearest integer), the phone list `firstScreen` into `MEASURED_PHONE_FIRST_SCREEN_ROWS`, the 1440 grouped `max` into `MEASURED_MAX_GROUPED_CARD_PX`, and today's date into `MEASURED_ON`. The two `--pf-size-card` measurements (390 and 1440) must agree within 2 px; record the 1440 value.
2. If a median differs from the CSS value by more than 10%, fix the CSS value (the rem value equal to the median / 16, rounded to 0.125rem), not the tolerance.
3. If `firstScreen` is below 8: first check that the ControlBar is collapsed and nothing else sits above the list; then hide the product count sentence in the provenance on phones (wrap `${products.length} products tracked. ` in `<span className="hidden sm:inline">`), re-measure, and say so in the PR.
4. If the 1440 grouped `max` exceeds 180 or `truncated` is not 0 at 1440: a detail line or title is wrapping or too long. Check the fixture's longest type label; the card must not wrap (`truncate` is on every text line). Fix the class, not the budget.
5. `pnpm perf:budget`: read the `/prices` rows and apply step 24c.
6. Kill the server (`pkill -f scripts/perf-serve.mjs`).
7. Push the branch; in the CI job summary read the Lighthouse table for `/prices` (CLS must be ≤ 0.02, bf-cache 3/3, 0 oversized images) and apply step 24b.
8. INP trace: on the perf build (`node scripts/perf-serve.mjs`), Chrome DevTools, Performance panel, CPU 4x slowdown, device toolbar at 390 x 844. Record: tap Period 1Y, tap Cards, tap List, change Sort to "Days of supply", tick "Group by set", change currency (on `/prices` or in the header after WP27). For each interaction, the Interactions track must show processing plus presentation delay within one frame (≤ 16 ms) beyond the input delay, with the list re-render in a separate later task. Save the trace (`.json.gz`) and attach it to the PR with a screenshot of the Interactions track.

## Pitfalls: do not do this

- **Do not render two DOMs** (a phone `DataList` plus a hidden desktop table, or `DataListRow` plus desktop cells). It doubles the row HTML against the 70 kB document budget and doubles hydration. One element per row, re-arranged by CSS.
- **Do not put Tailwind `hidden`, `block`, `flex`, `grid`, `h-*` or `p-*` utilities on elements with `pf-list-row`, `pf-list-head` or `pf-a-*` classes.** `globals.css` owns display, grid areas, height and padding there; a utility on the same element silently wins (utilities layer) and breaks the column alignment at one breakpoint. Wrap the content in a child element when it needs such a utility (the header buttons do this).
- **Do not write the search-params hook name in `ProductPrices/index.tsx`,** not even in a comment (WP08's precheck greps for it).
- **Do not decide staleness in the browser with today's date.** Pass the server's `referenceDate` down; a client-side `new Date()` makes the glyph differ between the ISR HTML and hydration around midnight UTC.
- **Do not send `price_recorded_at` for every product.** Only stale (2+ days) and withheld products carry it; fresh rows need no date and the flight budget is 22 kB br.
- **Do not compute days of supply in the browser from raw listing quantities.** The server sends one rounded number per product; `total_quantity_available` stays out of the payload.
- **Do not use plain `next/link` (default prefetch) for product links in rows or cards.** Product pages are ISR; viewport prefetch would fetch up to 306 of them per scroll (research §8). Use `IntentLink`.
- **Do not give a list or card thumbnail `priority`.** The list's LCP is text; a preload on a thumbnail hidden on phones downloads bytes nobody sees.
- **Do not put `isTogglePending` or `displayPending` in the `catalogView` memo's dependencies,** and do not read them inside the memo. The memo must stay keyed on data, or every pressed toggle re-renders 306 rows at urgent priority.
- **Do not key the ungrouped Suspense chunks by product id.** Index keys keep the boundaries stable across sorts; product-id keys would remount whole chunks on every sort.
- **Do not rename the Period control or the `chart` URL key** (WP26 already renamed the label; `?chart=` links must keep working).
- **Do not change "Found {n} products"** (WP13) or move it out of a single `<span>` (WP08's and WP13's tests match it).
- **Do not pass a URL to `history.replaceState` in the anchor code, and do not use `router.replace` for it.** A URL argument makes Next dispatch a router action; the anchor must be a silent state write.
- **Do not fetch price history for list rows or on scroll.** Sparklines are baked (WP26); history loads only when a card's chart is opened.
- **Do not colour the sparkline by direction or the row by return.** The `Delta` carries gain or loss; the stripe is gone for good (01-PRODUCT-DIRECTION.md §3.2, §3.4).
- **Do not show the variant, expansion type or units as pills on rows or cards.** Variant is text; expansion type appears once in the set header (badge budget, §3.3).
- **Do not let a row or card line wrap.** Every text line truncates; a wrapped line breaks the fixed heights that the intrinsic sizes and the scroll anchor rely on.
- **Do not run `pnpm perf:budget --write-limits`, loosen a Lighthouse assertion, or raise the conventions baseline** to get green (WP22 D11, WP23 step 24).
- **Do not touch `/market`, `ControlBar.tsx` or the currency code.** `/market` shares `ControlBar` and becomes WP33's screener; currency moves to the header in WP27.

## Tests

All paths under `frontend/`. New component tests run axe through WP23's helper (`import { axeViolations } from "@/test-utils/axe";`, expect `[]`). Tests that render `IntentLink` mock `next/navigation`:

```ts
const mockPrefetch = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: mockPrefetch, push: jest.fn(), replace: jest.fn() }),
  usePathname: () => "/prices",
  useSearchParams: () => new URLSearchParams(""),
}));
```

Shared fixtures for the new tests: `app/components/ProductPrices/__tests__/fixtures/catalogProducts.ts` (new) exporting `makeProduct(overrides)` (id, `usd_price: 100`, `url`, `last_updated`, set "Evolving Skies"/"SWSH07"/`2021-08-27` with generation "Sword & Shield", type `booster_box`/"Booster Box", `returns` with all six keys) and `PRODUCTS` (5 products over 2 sets, one withheld with `usd_price: null` and `price_recorded_at: "2026-08-01T04:00:00"`, one variant "Pokemon Center Exclusive").

### 1. `app/components/ProductPrices/__tests__/scrollAnchor.test.ts` (new, jsdom): the anchor logic

```ts
import {
  ANCHOR_TOLERANCE_PX,
  SCROLL_ANCHOR_KEY,
  anchorFromClick,
  anchorScrollDelta,
  readScrollAnchor,
  withScrollAnchor,
} from "../utils/scrollAnchor";

const plain = (target: EventTarget | null, overrides: Partial<Parameters<typeof anchorFromClick>[0]> = {}) => ({
  target,
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
  ...overrides,
});

function row(id: string, top: number) {
  const li = document.createElement("li");
  li.dataset.anchorId = id;
  li.getBoundingClientRect = () => ({ top, bottom: top + 56, left: 0, right: 390, width: 390, height: 56, x: 0, y: top, toJSON: () => ({}) });
  const link = document.createElement("a");
  link.setAttribute("data-anchor-link", "");
  const inner = document.createElement("span");
  link.appendChild(inner);
  li.appendChild(link);
  document.body.appendChild(li);
  return { li, link, inner };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("history state", () => {
  it("sets, reads and clears the anchor and keeps Next's keys", () => {
    const state = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: ["", {}] } };
    const withAnchor = withScrollAnchor(state, { id: 42, offsetFromTop: 120 });
    expect(withAnchor).toEqual({ ...state, [SCROLL_ANCHOR_KEY]: { id: 42, offsetFromTop: 120 } });
    expect(readScrollAnchor(withAnchor)).toEqual({ id: 42, offsetFromTop: 120 });
    expect(withScrollAnchor(withAnchor, null)).toEqual(state);
    expect(state).not.toHaveProperty(SCROLL_ANCHOR_KEY);
  });

  it("starts from an empty object when there is no state", () => {
    expect(withScrollAnchor(null, { id: 1, offsetFromTop: 0 })).toEqual({ [SCROLL_ANCHOR_KEY]: { id: 1, offsetFromTop: 0 } });
  });

  it.each([
    null,
    undefined,
    5,
    {},
    { [SCROLL_ANCHOR_KEY]: null },
    { [SCROLL_ANCHOR_KEY]: { id: "4", offsetFromTop: 1 } },
    { [SCROLL_ANCHOR_KEY]: { id: 4.5, offsetFromTop: 1 } },
    { [SCROLL_ANCHOR_KEY]: { id: 4, offsetFromTop: Number.NaN } },
  ])("rejects %p", (state) => {
    expect(readScrollAnchor(state)).toBeNull();
  });
});

describe("anchorScrollDelta", () => {
  const anchor = { id: 1, offsetFromTop: 120 };
  it("keeps the position within the tolerance", () => {
    expect(anchorScrollDelta(120, anchor)).toBe(0);
    expect(anchorScrollDelta(120 + ANCHOR_TOLERANCE_PX, anchor)).toBe(0);
    expect(anchorScrollDelta(120 - ANCHOR_TOLERANCE_PX, anchor)).toBe(0);
  });
  it("returns the signed, rounded distance beyond it", () => {
    expect(anchorScrollDelta(700, anchor)).toBe(580);
    expect(anchorScrollDelta(-300.4, anchor)).toBe(-420);
  });
});

describe("anchorFromClick", () => {
  it("records the row's id and rounded top for a plain click inside a product link", () => {
    const { inner } = row("42", 233.6);
    expect(anchorFromClick(plain(inner))).toEqual({ id: 42, offsetFromTop: 234 });
  });

  it.each([
    { button: 1 },
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { defaultPrevented: true },
  ])("ignores %p", (overrides) => {
    const { link } = row("42", 100);
    expect(anchorFromClick(plain(link, overrides))).toBeNull();
  });

  it("ignores links that are not product links and clicks outside rows", () => {
    const { li } = row("42", 100);
    const external = document.createElement("a");
    li.appendChild(external);
    expect(anchorFromClick(plain(external))).toBeNull();
    const loose = document.createElement("a");
    loose.setAttribute("data-anchor-link", "");
    document.body.appendChild(loose);
    expect(anchorFromClick(plain(loose))).toBeNull();
    expect(anchorFromClick(plain(null))).toBeNull();
  });
});
```

### 2. `app/components/ProductPrices/__tests__/useScrollAnchor.test.tsx` (new, jsdom)

A harness renders `<ul onClickCapture={capture}>` with `<li data-anchor-id={id}><a href={`/product/${id}`} data-anchor-link="" onClick={(e) => e.preventDefault()}>{id}</a></li>` for ids 1 to 5, where `capture = useScrollAnchor()`. Before each case: `window.history.replaceState({ __NA: true }, "")`, `jest.spyOn(window, "scrollTo").mockImplementation(() => {})`, and `jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 1; })`. Cases:

- Clicking link 3 (with `li[data-anchor-id="3"].getBoundingClientRect` returning `top: 300`) leaves `window.history.state` equal to `{ __NA: true, pfPricesAnchor: { id: 3, offsetFromTop: 300 } }` and does not change `location.href`.
- A ctrl-click records nothing.
- Restore: with `history.state = { __NA: true, pfPricesAnchor: { id: 4, offsetFromTop: 100 } }`, `window.scrollY` stubbed to 50 and row 4's top returning 900 on the first read and 100 on the second, rendering the harness calls `window.scrollTo` once with `{ top: 850, behavior: "instant" }`, and afterwards `history.state` has no `pfPricesAnchor` but keeps `__NA`.
- Restore with an anchor whose row is not rendered calls `scrollTo` zero times and still clears the key.
- Without an anchor in the state, nothing is called.

### 3. `app/components/ProductPrices/__tests__/layoutMetrics.test.ts` (new, `@jest-environment node`)

```ts
/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";
import {
  INTRINSIC_SIZE_TOLERANCE,
  MEASURED_ITEM_HEIGHTS_PX,
  MEASURED_MAX_GROUPED_CARD_PX,
  MEASURED_PHONE_FIRST_SCREEN_ROWS,
} from "../views/layoutMetrics";

const css = fs.readFileSync(path.join(__dirname, "../../../globals.css"), "utf8");

function customPropertyPx(name: string): number {
  const match = css.match(new RegExp(`${name}:\\s*([\\d.]+)rem\\s*;`));
  if (!match) throw new Error(`${name} is not defined in rem in globals.css`);
  return Number(match[1]) * 16;
}

describe("catalog intrinsic sizes (research/performance-excellence.md §13.4)", () => {
  it.each(Object.entries(MEASURED_ITEM_HEIGHTS_PX))(
    "%s is within 10%% of the fixture median",
    (name, measured) => {
      const cssPx = customPropertyPx(name);
      expect(Math.abs(cssPx - measured) / measured).toBeLessThanOrEqual(INTRINSIC_SIZE_TOLERANCE);
    }
  );

  it("feeds every content-visibility rule from those properties", () => {
    expect(css).toMatch(/\.pf-cv-row\s*\{[^}]*contain-intrinsic-block-size:\s*auto var\(--pf-size-list-row\)/);
    expect(css).toMatch(/\.pf-cv-row\s*\{[^}]*contain-intrinsic-block-size:\s*auto var\(--pf-size-list-row-md\)/);
    expect(css).toMatch(/\.pf-card-grid > \.pf-card\s*\{[^}]*contain-intrinsic-block-size:\s*auto var\(--pf-size-card\)/);
    expect(css).toMatch(/\.pf-card\[data-show-set\]\s*\{[^}]*var\(--pf-size-card-set\)/);
    expect(css).toMatch(/\.pf-list-row\s*\{[^}]*height:\s*var\(--pf-size-list-row\)/);
    expect(css).not.toMatch(/pf-card-flat|pf-card-grouped/);
  });

  it("records the acceptance measurements", () => {
    expect(MEASURED_PHONE_FIRST_SCREEN_ROWS).toBeGreaterThanOrEqual(8);
    expect(MEASURED_MAX_GROUPED_CARD_PX).toBeLessThanOrEqual(180);
  });
});
```

Against the tree before this package the file does not compile (no `layoutMetrics.ts`); changing `--pf-size-card` to `14rem` makes the first case fail.

### 4. `app/components/ProductPrices/__tests__/sorting.test.ts` (extend)

Keep every existing case. Add, using the file's `makeProduct` with `returns` set per case:

- `change` with context `{ period: "1M" }`: products with `returns["1M"]` 5, -2, null, 12 sort descending as 12, 5, -2, null and ascending as -2, 5, 12, null; a product with `usd_price: null` and `returns["1M"]: 30` sorts last in both directions (withheld); switching the context to `{ period: "1Y" }` ranks by `returns["1Y"]`.
- `units_30d` with `volumeMetrics` `{1: {units_sold_30d: 4}, 2: {units_sold_30d: 40}, 3: {units_sold_30d: null}}` and product 4 absent: descending 2, 1, then 3 and 4 in input order.
- `days_supply` ascending with `days_of_supply` 0, 18, 3.5, null: 0, 3.5, 18, null.
- `msrp` with `msrpMultiples` `{1: 1.4, 2: 2.1}`: descending 2, 1, others in input order; without `msrpMultiples` every product keeps input order.
- Ties keep input order (two products with equal change, both directions).
- No context: `sortProducts(list, "units_30d", "desc")` returns the input order; `"change"` uses `returns["3M"]`.
- `DEFAULT_SORT_DIRECTION.days_supply` is `"asc"`, every other key `"desc"`; `sortLabel("change", "1M")` is `"1M change"`, `sortLabel("msrp", "3M")` is `"x MSRP"`; `directionLabel("release_date", "desc")` is `"Newest first"`, `directionLabel("price", "asc")` is `"Low to high"`.

### 5. `app/components/ProductPrices/__tests__/urlState.test.ts` (update WP08's file)

- "reads every owned key": replace `view=flat` in the query with `view=cards&group=set` and the expected `view: "flat"` with `view: "cards", group: "set"`. If WP27 removed `currency`, the test already lacks it; keep that.
- "round-trips through parse": replace `view: "type_grouped" as const` with `view: "cards" as const, group: "set" as const`.
- New cases: `parsePricesQuery("")` has `view: "list"` and `group: "none"`; `?view=grouped` gives `{ view: "cards", group: "set" }`; `?view=flat` and `?view=type_grouped` give `{ view: "cards", group: "none" }`; `?view=grouped&group=none` gives `group: "none"`; `?view=constructor` and `?group=toString` give the defaults; every new sort key parses (`?sort=change`, `units_30d`, `days_supply`, `msrp`); `serializePricesState({ ...PRICES_URL_DEFAULTS, view: "cards", group: "set", sort: "change" })` is `"sort=change&view=cards&group=set"`; a legacy query re-serializes canonically (`serializePricesState(parsePricesQuery("?view=grouped"))` is `"view=cards&group=set"`).

### 6. `app/lib/__tests__/catalogProjection.test.ts` (extend WP11's file)

- `toVolumeSummaries(rows)` returns objects with exactly `units_sold_30d` and `units_sold_prior_30d` (no `days_of_supply` key).
- With `{ daysOfSupply: true }`: quantity 60 and units 30 give 60; quantity 5 and units 30 give 5; quantity 1 and units 90 give 0.3; units 0, units null or quantity null give null.
- `compactDaysOfSupply`: 12.4 -> 12, 9.96 -> 10, 3.14 -> 3.1, -1 -> null, `NaN` -> null, null -> null.

### 7. `app/components/ProductPrices/__tests__/freshness.test.ts` (new, node)

- `utcDateKey(new Date("2026-09-30T23:59:59Z"))` is `"2026-09-30"`.
- `newestPriceDay` returns the newest UTC day among priced products, ignores withheld products (`usd_price: null`) even when newer, and returns null for an empty list or when none is priced.
- `withStalePriceDates` with `referenceDate "2026-09-30"`: a priced product recorded `2026-09-28T23:00:00` gets `price_recorded_at: "2026-09-28"`; one recorded `2026-09-29T01:00:00` gets nothing; a withheld product keeps its projected value; when nothing is stale it returns the same array instance.

### 8. `app/components/ProductPrices/__tests__/ProductListRow.test.tsx` (new, jsdom)

Render inside `<ul>` with `period="3M"`, `formatPrice={(v) => formatMoney(v, "USD")}` (WP07; use `formatUsdAs` if that is what the file uses), `showMsrp={false}`. Cases:

- The single link is named by the whole row and has `href="/product/1"` and `data-anchor-link`; the `li` has `data-anchor-id="1"` and class `pf-cv-row`.
- Line text: "Evolving Skies · Booster Box", the variant text when present, "$100.00", a `Delta` with `data-direction="up"` and "4.2%" for `returns["3M"]: 4.2`.
- `sparkline="ACEG"` draws a `path`; `sparkline={null}` shows "No history"; `undefined` shows the flat bar (`data-testid="sparkline-skeleton"`).
- Withheld product: price "--", `Delta` `data-direction="missing"` with sr-only "Price withheld".
- `referenceDate="2026-09-30"` and `price_recorded_at: "2026-09-27"`: a `time[datetime="2026-09-27"]` with title "Last priced Sep 27"; with `price_recorded_at` absent, or with no `referenceDate`, no `time` element.
- Cells: units 212 prints "212" plus the suffix " sold 30D"; days of supply 0.4 prints "<1", 18.2 prints "18", null prints "--"; with `showMsrp` and `msrpMultiple={1.378}` the MSRP cell prints "1.4x"; without `showMsrp` there is no `.pf-a-msrp`.
- No text "Updated" and no element with a `border-l-4` class.
- Hovering the link for 80 ms (fake timers) calls `mockPrefetch("/product/1")` once; leaving after 50 ms calls nothing.
- `axeViolations(container)` is `[]`.

### 9. `app/components/ProductPrices/__tests__/ListView.test.tsx` (new, jsdom)

- Ungrouped, 50 products: one list named "Products" with 50 `listitem`s in input order.
- Grouped (`groups` from `groupProductsBySet`): one `section` per set, labelled by an `h2` with the set name, each with a list named "{set} products"; the header line shows the code, generation and "Released Aug 27, 2021"; a "Special Expansion" set shows that text once, a "Main Series" set shows no badge.
- `ListHeader` with `sortKey="change"`, `sortDirection="desc"`, `period="1Y"`: the button named "1Y change, sorted high to low" has class `font-bold`; clicking it calls `onSort("change", "asc")`; clicking "Days supply" calls `onSort("days_supply", "asc")`; clicking "Price" calls `onSort("price", "desc")`; "x MSRP" is absent unless `showMsrp`; "Product" and "Trend" are not buttons.
- `axeViolations` is `[]` for the grouped list and for the header.

### 10. `app/components/ProductPrices/__tests__/SortControls.test.tsx` (new, jsdom)

- The combobox named "Sort by" lists "Release date", "Price", "3M change", "Units sold 30D", "Days of supply"; "x MSRP" only with `showMsrp`; with `period="1M"` the change option reads "1M change".
- Choosing "Days of supply" calls `onSortChange("days_supply", "asc")`; choosing "Price" calls `onSortChange("price", "desc")`.
- The direction button's name is "Sort order: Newest first. Change to oldest first" for release date descending; clicking it calls `onSortChange("release_date", "asc")`.
- The radio group named "View" has "List" checked; choosing "Cards" calls `onViewModeChange("cards")` (inside a transition, assert with `await waitFor`).
- The checkbox named "Group by set" is unchecked for `groupBy="none"`; clicking it calls `onGroupByChange("set")`.
- "Found 306 products" is in the document (`getByText("Found 306 products")`).
- `axeViolations` is `[]`.

### 11. `app/components/ProductPrices/__tests__/ProductCard.anatomy.test.tsx` (new, jsdom)

Mock `../shared/LazyPriceChart` as in WP26's history test. Cases:

- The title `h3` holds the type ("Booster Box") and a link to `/product/1`; the image link is `aria-hidden="true"` with `tabindex="-1"`; `article` has `data-anchor-id="1"` and class `pf-card`.
- `showSet={false}`: no set caption and no `data-show-set`; `showSet` (default): caption "Evolving Skies · SWSH07 · Aug 27, 2021" and `data-show-set=""`.
- Detail line: "Pokemon Center Exclusive · 212 sold 30D · 1.4x MSRP" for a variant product with `unitsSold30d={212}` and `msrpMultiple={1.378}`; with none of them the line is a non-breaking space.
- Price "$100.00" and, in the same fixed-width column, a `Delta` with the Period label "3M".
- No "Updated", no `border-l-4`, no "sold/30d" chip, no text "Loading...".
- Withheld: "No current price, last recorded Aug 1, 2026" and "--".
- Stale glyph as in test 8.
- `axeViolations` is `[]`.

### 12. `app/components/__tests__/IntentLink.test.tsx` (new, jsdom, fake timers)

Call `resetIntentPrefetchForTests()` in `beforeEach`. Cases: renders an `<a href="/product/7">` with the children and forwards `className` and `data-anchor-link`; `mouseEnter` then 79 ms: no prefetch, at 80 ms: `mockPrefetch("/product/7")` once; `mouseEnter` then `mouseLeave` at 40 ms, then 200 ms: none; `focus` prefetches immediately; `pointerDown` prefetches immediately; a second hover of the same href after a prefetch calls nothing; the caller's own `onMouseEnter` still runs.

### 13. `app/components/ProductPrices/__tests__/ProductPrices.view.test.tsx` (new, jsdom)

Copy the mocks and `Page` helper from `ProductPrices.urlSync.test.tsx` (WP08, as updated by WP26 and WP27), replacing its `next/navigation` mock with the one at the top of this section plus `useSearchParams` reading `mockRouterSearch`, and do not mock `ProductListRow`, `ProductCard` or `IntentLink`. Pass `initialSparklines` with a series for product 1 and `referenceDate="2026-09-30"`. Cases:

- Server render (`renderToString`): contains `data-view="list"`, one `li.pf-cv-row` per product, "Found N products", no `<article`.
- Hydrating the server HTML (`hydrateRoot`) produces no recoverable error and no `console.error`.
- Hydrating `?view=grouped` switches to cards grouped by set (`article.pf-card` elements and `h2` set names) and does not rewrite the URL.
- Choosing "Cards" in the View group writes `view=cards` to the URL once after 250 ms (fake timers) and renders `article.pf-card`.
- Ticking "Group by set" renders one `section` per set and writes `group=set`.
- Choosing "Days of supply" orders rows by `days_of_supply` ascending, sets `data-meta="dos"` on the wrapper and writes `sort=days_supply&dir=asc`.
- Without `initialMsrpMultiples` there is no "x MSRP" option; with `{ 1: 1.4 }` there is, and the wrapper has `data-msrp`.
- `?sort=msrp` without multiples sorts by release date and the select shows "Release date".
- Clicking a row link (default prevented by a capturing `document` listener) leaves `history.state.pfPricesAnchor.id` equal to that product id.
- While a transition is pending (Period change to "1Y" with `fetchPublicSparklines` unresolved), the wrapper has `aria-busy="true"` and `opacity-70`; after resolution neither.

### 14. Existing tests to update

- `ProductPrices.urlSync.test.tsx` (WP08, WP13): add, next to the `ProductCard` mock, `jest.mock("../views/ProductListRow", () => ({ __esModule: true, default: ({ product }: { product: Product }) => <li data-testid="card">{product.sets?.name}</li> }))`, so `cardNames()` keeps working with the list default. Its URLs that used `view=flat` stay valid (legacy). No assertion changes.
- `ProductCard.format.test.tsx` (WP07): remove `viewMode` from every render. Case "flat: release date, Eastern timestamp with zone, grouped money" becomes "ungrouped: set caption with release date, grouped money": expect `getByText(/Sep 26, 2026/)` and "$1,649.99", and `queryByText(/Updated:/)` to be null. Case "grouped with set as primary" becomes `showSet` and keeps its `/Sep 26, 2026/` assertion. The two withheld-price cases are unchanged apart from `viewMode` becoming `showSet={false}`.
- `ProductCard.history.test.tsx` (WP26): replace `viewMode="flat"` with nothing (default `showSet`). Assertions unchanged.
- `ProductCard.msrp.test.tsx` (WP28, only if present): "each for `viewMode="flat"` and `viewMode="grouped"`" becomes each for `showSet` true and false; assertions unchanged (`1.4x MSRP`; no `/MSRP/` when null).
- `controls.a11y.test.tsx` (WP14, WP23): the `SortControls` case renders the new props and asserts a combobox named "Sort by", a button whose name starts with "Sort order:", a radiogroup named "View" and a checkbox named "Group by set".
- `app/components/MarketView/__tests__/MiniSparkline.test.tsx` (WP26): add `size="list"` renders a box with classes `h-6 w-16 md:h-7 md:w-24`.
- `app/components/ProductPrices/__tests__/ProductImage.test.tsx` (WP12): add `variant="thumb"`: the `img` has `alt=""`, no "Loading..." text and class `opacity-100` on first render; with no `imageUrl` it renders one `aria-hidden` div and no "No Image" text.
- `app/__tests__/uiConventions.test.ts`: no code change; the baseline is regenerated in step 25a.
- Any test that imported `ReturnMetrics`, `ProductTypeGroupHeader` or `groupProductsByType`: delete those cases with their subjects.

## Verification

From `frontend/`:

```bash
pnpm install --frozen-lockfile
git diff --stat HEAD -- package.json pnpm-lock.yaml                 # empty: no dependency change
pnpm exec tsc --noEmit                                              # exit 0
pnpm run lint; echo "exit=$?"                                       # exit=0, 0 errors
pnpm exec jest --ci app/components/ProductPrices app/components/__tests__/IntentLink.test.tsx \
  app/components/MarketView/__tests__/MiniSparkline.test.tsx app/lib/__tests__/catalogProjection.test.ts \
  app/__tests__/uiConventions.test.ts                               # all pass
pnpm test --ci                                                      # all suites pass
pnpm run test:scripts                                               # "# fail 0"
pnpm build:stub; echo "exit=$?"                                     # exit=0; route table lists /prices as static, Revalidate 1d
```

Static checks on the tree:

```bash
grep -c "useSearchParams" app/components/ProductPrices/index.tsx                                  # 0
grep -rn "border-l-4\|Updated:\|sold/30d\|type_grouped\|ProductTypeGroupHeader\|ReturnMetrics\b" app/components/ProductPrices app/prices --include=*.tsx --include=*.ts | grep -v __tests__   # nothing
grep -rn "TCGPlayer\|real-time\|all-time" app/components/ProductPrices app/prices app/components/IntentLink.tsx | grep -v __tests__   # nothing
grep -rn "$(printf '\xe2\x80\x94')" app/components/ProductPrices app/prices app/components/IntentLink.tsx app/globals.css   # nothing (no em dash)
grep -rn "slate-\|gray-\|#[0-9a-fA-F]\{6\}" app/components/ProductPrices/views app/components/ProductPrices/utils/catalogValues.ts app/components/ProductPrices/cards/ProductCard.tsx app/components/ProductPrices/controls/SortControls.tsx   # nothing (tokens only)
grep -n "<Link\b" app/components/ProductPrices/views/*.tsx app/components/ProductPrices/cards/ProductCard.tsx   # nothing: product links are IntentLink
```

Server HTML (with `pnpm build:stub` and `pnpm start` against the stub, or the perf build of step 26):

```bash
curl -s http://127.0.0.1:3100/prices > /tmp/prices.html
grep -o 'class="pf-cv-row"' /tmp/prices.html | wc -l          # 306 on the perf fixture
grep -c '<article' /tmp/prices.html                           # 0 (cards are not the default)
grep -o 'data-view="list"' /tmp/prices.html | wc -l           # 1
grep -o 'data-meta="units"' /tmp/prices.html | wc -l          # 1
grep -o 'rel="preload" as="image"' /tmp/prices.html | wc -l   # 0 (no thumbnail preload)
```

Performance against the budget (step 26 has the commands):

- `pnpm perf:budget`: `/prices` document ≤ 70 kB br, initial JS ≤ 155 kB gz (see Acceptance for the case where the base branch is already above), flight within its limit; no other route changes by more than 0.5 kB.
- Lighthouse CI on the PR: `/prices` CLS median ≤ 0.02, bf-cache 3/3, 0 oversized images; `/` still passes its assertions (the home strip card changed width).
- `node scripts/measure-catalog.mjs`: first screen at 390 x 844 shows at least 8 rows; grouped card max ≤ 180 px at 1440; 0 truncated titles at 1440; medians recorded in `layoutMetrics.ts`.
- INP trace attached (step 26 item 8).

Manual checks on the perf build (`node scripts/perf-serve.mjs`, Chrome device toolbar):

At 390 x 844 (touch emulation):
1. First screen: header, title, provenance with "Prices as of {date}", collapsed Filters, toolbar, then at least 8 rows each with price and change.
2. Rows are 56 px, two lines, no thumbnails; the Network panel shows no request to `product-images` while scrolling the list.
3. Open Filters, choose Period 1Y: every row's change and sparkline switch to 1Y (flat bars until `/api/public/sparklines/1Y` resolves), the count line says "1Y change", the list dims then undims.
4. Sort by "Days of supply": the meta slot shows "{n} days of supply", thinnest first, products without data last; the URL has `sort=days_supply&dir=asc`.
5. Scroll to about row 120, tap a product, press Back: the tapped row is back at the same position (within a few pixels). Repeat in cards view and in grouped mode.
6. Switch to Cards, tick Group by set: one column of 170 px cards under one-line set headers; "Show full chart" opens the chart under the card (WP26 behaviour).
7. A stale product (fixture 900300 to 900305): "--", "Price withheld" for screen readers, "No history", clock glyph with "Last priced ...".
8. VoiceOver or TalkBack spot check: a row reads as one link with set, type, variant, price, direction and change, and units.

At 1440 x 900:
9. List: 44 px one-line rows, thumbnails, columns aligned under a sticky 40 px header; the sorted header is bold with an arrow; clicking "Sold 30D" sorts by units descending, clicking again ascending.
10. Group by set: set headers with code, generation and release date; "Special Expansion" once per such set; column header stays at the top.
11. Cards grouped: three columns, every card the same height, no type title truncated or wrapped, prices aligned in one column per grid column, no left stripe, no "Updated" line.
12. Keyboard: Tab reaches Sort by, direction, View, Group by set, then header buttons, then rows; every focus ring is visible; Enter on a row opens the product.
13. Hover a row for more than 80 ms: one `_rsc` prefetch for that product; scrolling the whole list without hovering makes no product prefetch (DevTools Network, filter `_rsc`).
14. `/` home page (if step 20 applied): Recently Released cards are 320 px wide with the new anatomy and no stale glyph.

## Owner actions

1. Review the before and after screenshots at 390 x 844 and 1440 x 900 (list, list grouped, cards grouped) in the PR, and the three defaults they show: list view, ungrouped, and "By Type" grouping removed in favour of the type filter. Say in the PR if any default should change; no code decision is blocked on it.
2. Approve or reject any `Perf budget raise:` line in the PR body (none is expected).
3. Optional, after merge: check Speed Insights for `/prices` after two weeks (INP ≤ 100 ms on filters, CLS ≤ 0.02, 01-PRODUCT-DIRECTION.md §6.1) and tighten the limits per WP22's rule.

## Acceptance criteria

- [ ] `/prices` opens in the list view on every viewport; `?view=cards`, `?group=set` and the legacy `?view=grouped|flat|type_grouped` work; the URL carries only non-default keys.
- [ ] At 390 x 844 the first screen shows at least 8 products with price and change (`MEASURED_PHONE_FIRST_SCREEN_ROWS` ≥ 8, measured with `scripts/measure-catalog.mjs`).
- [ ] Phone rows are two lines of 56 px (set · type and variant; units or the sorted value, price, `Delta`, 64 x 24 sparkline); rows from 768 px are one 44 px line with thumbnail, name with variant, 112 px right-aligned tabular price, Period change, 96 x 28 sparkline and units sold 30D; days of supply and (when WP28 data exists) x MSRP from 1024 px.
- [ ] Cards: type is the title, variant in the detail line, one fixed-width price column with the change under it and the 96 x 40 sparkline beside it; grouped cards ≤ 180 px (`MEASURED_MAX_GROUPED_CARD_PX`); no type title wraps or truncates at 1440 on the fixture.
- [ ] No left-edge stripe and no per-card "Updated:" line anywhere in `/prices`; freshness shows once in the provenance line (`AsOf`) and as a clock glyph on rows and cards priced 2 or more days ago.
- [ ] One Period control drives the sparkline window, the single change shown, the "change" sort and the card chart range.
- [ ] Sort options: release date, price, {Period} change, units sold 30D, days of supply, x MSRP (only when data exists); nulls last in both directions; state visible in the select, the desktop header and the phone meta slot, and in the URL.
- [ ] Each set group, or each run of 24 ungrouped rows or cards, is its own `<Suspense fallback={null}>`.
- [ ] Period, currency, sort, direction, view and group changes run at transition priority with the list dimmed (`aria-busy`, `opacity-70`) while pending; the INP trace attached to the PR shows one frame plus input delay per toggle.
- [ ] `contain-intrinsic-block-size` values come from `--pf-size-*` and `layoutMetrics.test.ts` asserts each is within 10% of the recorded fixture median.
- [ ] Back from a product page returns to the tapped row (manual check at 390 and 1440, list and cards) and `scrollAnchor.test.ts` plus `useScrollAnchor.test.tsx` pass.
- [ ] Product links in rows and cards are `IntentLink`; scrolling the list makes no product prefetch.
- [ ] The empty state is WP13's `NoResults`, unchanged.
- [ ] `pnpm perf:budget`: `/prices` document ≤ 70 kB br and initial JS ≤ 155 kB gz. If the base branch was already above 155 kB gz, this PR does not increase `/prices` JS by more than 3 kB gz and the PR states both numbers and asks the owner (Owner action 2); this line is then marked with the measured value.
- [ ] Lighthouse CI `/prices` CLS assertion is 0.02 and passes; `/` and `/prices` keep 0 oversized images and 3/3 bf-cache.
- [ ] `tsc`, lint, `pnpm test --ci`, `pnpm run test:scripts` and `pnpm build:stub` pass; `/prices` is still static with Revalidate 1d.
- [ ] `uiConventions.baseline.json` only lowered or removed entries; no raw palette class or hex in new files; no em dash, "TCGPlayer", "live", "real-time" or "all-time" in changed UI copy.
- [ ] No migration, no new dependency, no change to `/market`, `ControlBar.tsx` or currency code.

## Rollback

Revert the PR (`git revert <merge sha>`). No migration, no data or schema change, no new environment variable. After the revert, URLs written with `view=list|cards`, `group=` or the new `sort` values fall back to WP08's defaults through `pickEnum` (unknown values are ignored), so shared links still open `/prices`. History entries holding `pfPricesAnchor` are ignored by the old code. If only one part misbehaves in production: the list default can be switched off without a revert by changing `PRICES_URL_DEFAULTS.view` to `"cards"` (one line, cards still render correctly), and the scroll anchor can be disabled by returning early from `useScrollAnchor`'s effect.

## Commit and PR

Branch `remediation/wp30-prices-dense-list-and-mobile`. Commits, in order:

1. `feat(prices): URL state, sorts and projection for the list view (WP30)`: types, `catalogProjection.ts`, `freshness.ts`, `urlState.ts`, `sorting.ts`, `catalogValues.ts`, `msrp.ts`, `filtering.ts`, their tests.
2. `feat(prices): dense list rows, list view and fixed card anatomy (WP30)`: `IntentLink`, `ProductImage` thumb, `MiniSparkline` list size, `SetGroupHeader`, `ProductListRow`, `ListView`, `ProductCard`, `ProductGrid`, `CardsView`, `SortControls`, `globals.css`, tests.
3. `feat(prices): wire views, scroll anchor and provenance into /prices (WP30)`: `useScrollAnchor`, `index.tsx`, `prices/page.tsx`, `RecentlyReleased.tsx`, deletions, updated tests, baseline.
4. `chore(perf): measured catalog sizes, /prices CLS 0.02 and budgets (WP30)`: `layoutMetrics.ts`, `scripts/measure-catalog.mjs`, `lighthouserc.json`, `perf-budgets.json`.

Each commit message ends with the attribution lines from the session's system reminder.

PR title: `WP30: /prices dense list view, phone catalog and fixed card anatomy`

PR body:
- Link `audits/remediation/WP30-prices-dense-list-and-mobile.md`; the goal in two sentences.
- Before and after screenshots: 390 x 844 list (first screen), 390 cards grouped, 1440 list sorted by change, 1440 list grouped, 1440 cards grouped.
- The measure script's table and the recorded `layoutMetrics.ts` values.
- `pnpm perf:budget` before (base branch) and after for `/prices` (JS gz, document br, flight br) and any limit lowered by hand; any `Perf budget raise:` line with its reason.
- The Lighthouse summary row for `/prices` (CLS, bf-cache, oversized images, script and image KiB) and any `resource-summary` threshold changed.
- The INP trace file and the Interactions-track screenshot.
- Which soft dependencies were present (IntentLink created here or reused, WP24, WP27, WP28) and what was done for each.
- Visible changes elsewhere: the home "Recently Released" cards use the new anatomy at 320 px (if step 20 applied).
- Noticed, out of scope: `/market`, the home strip and product-page siblings still use default-prefetch links (switch them to `IntentLink` in WP33, WP32 and WP31); the catalog's returns come from `get_market_product_summaries` and still accept an unbounded anchor (WP25 note; the catalog can move to `product_daily_stats` in WP33); column headers use `title` tooltips rather than WP24's `MetricLabel` (WP33 decides the screener header pattern); `GroupHeader.tsx` remains only for the home strip (WP32).
