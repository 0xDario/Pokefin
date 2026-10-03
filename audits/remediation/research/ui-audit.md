# Pokéfin UI/UX audit from the rendered site

Date: 2026-09-30. Scope: every public page at 390x844 (phone) and 1440x900 (desktop), plus the interactive states that need a click (mobile menu, filter drawer, flat view, inline charts, all-columns table, 1Y chart hover, stale product, box recipe, Shopify CSV upload, login). Portfolio and account need a session, so they were judged from code.

## Method

- A Node stub on 127.0.0.1:54399 mimicked PostgREST for every call the app makes (`get_market_product_summaries`, `get_market_product_volume_metrics`, `get_set_analytics`, `exchange_rates`, `product_price_history`, `product_sales_history`, `product_listings_history`, `products`, `sets`). It served 58 products across 13 sets and 4 generations (Booster Box, ETB, Booster Bundle, Collection Box, Booster Pack, two Pokémon Center ETBs), a year of daily prices with drift, noise and jumps, 30 daily plus 52 weekly sales buckets, and a listings snapshot. One product (id 105, Cosmic Eclipse ETB) was left 25 days stale to exercise the migration 0023 freshness gate. Product images are coloured SVG placeholders, so image quality is not judged here.
- `next dev` (16.3.6, Turbopack) ran against the stub. Playwright (chromium 1194) captured full pages plus viewport-sized segments with `bypassCSP` (the CSP only allows `*.supabase.co`). The Next dev indicator was hidden before capture.
- Screenshots are not committed (about 26 MB). Regenerate them into `research/tools/shots/` with the scripts in `research/tools/` (see its README). File names below are relative to that folder. `seg2/<page>-<viewport>-<n>.png` are the readable segments, `<page>-<viewport>.png` the full pages.
- Caveats: Cloudflare Turnstile could not load in the sandbox, so the auth buttons render disabled; dev-mode timings are not production performance and are not used as evidence.

Where a problem is already fixed by a work package, it is tagged `[WPnn]` and not argued again. Everything untagged is new.

---

## Page by page

### `/` Dashboard

Shots: `seg2/home-desktop-1.png`, `seg2/home-desktop-2.png`, `home-loaded-desktop.png`, `seg2/home-mobile-1.png` to `-4.png`.

What works
- Clean white-card language, clear H1, search in the hero that submits to `/prices?q=`.
- Top Movers as compact cards with price and 7D change is the right primitive.
- Quick Stats row is a good idea for a market overview.

What looks unprofessional or confusing
- The hero is a generic "Price Tracker" banner that takes 350 px (desktop) and a whole phone screen before any data. It says nothing about why to trust the numbers (source, cadence, coverage, methodology) and has two competing primary buttons (red Search, blue Browse) plus a secondary.
- No market-level signal. A finance home page leads with an index ("Sealed market +2.1% 30D"), breadth (advancers vs decliners), and a chart. Pokéfin leads with a banner and a list. The only aggregate, "Avg 1M return +0.19%", is an unweighted mean over every product including packs and is buried under the product cards.
- Top Movers mixes 3 gainers and 3 losers in one unlabeled row. The red/green split is the only cue; on 1440 px the six cards leave a gap on the right, and on a phone only two are visible with no scroll affordance (`seg2/home-mobile-1.png`).
- "Recently Released" is the full catalog card (430 px tall each). Every card repeats the set name as its H2 ("Phantasmal Flames" five times in a row, `seg2/home-desktop-2.png`) while the thing that differs, the product type, is a smaller H3. Each card also repeats generation, set code and release date already shown in the group header.
- Sparkline skeleton is a fixed grey zigzag that trends up (`MiniSparkline.tsx` `SparklineSkeleton`). Below the fold, and whenever history is unavailable, cards show a fake upward chart that reads as data (`seg2/home-desktop-2.png` before scroll vs `home-loaded-desktop.png` after).
- "Most expensive $1800.00" (no grouping) and "Last refreshed Sep 30, 2:49 AM" rendered in the server's timezone with no zone label [WP07]. "Updated: 9/30/2026, 2:39:00 AM UTC" on every card is noise at card level; freshness belongs once per page.
- The CardRinkTCG promo is the largest block on the page (400 px) [WP15 for count and placement].
- Copy says "refreshed hourly" [WP03].

Top improvements
1. Replace the hero with a market header: index level and 1D/7D/30D change, breadth, a 1Y index chart, and one line of trust copy ("306 sealed products, TCGPlayer market prices, updated daily, stale prices withheld").
2. Split Top Movers into Gainers and Losers columns with a 7D/30D toggle, show 5 each as dense rows with a sparkline, and exclude low-liquidity items (units sold 30D below a floor) so a single sale cannot top the list.
3. Recently Released as compact rows (product type, price, change since release, units sold), grouped by set, not full catalog cards.
4. Replace the zigzag skeleton with a flat neutral bar, and show "No history" text when history is genuinely absent.

### `/prices` Catalog

Shots: `seg2/prices-desktop-1.png`, `-2.png`, `prices-flat-desktop.png`, `prices-fullchart-desktop.png`, `prices-search-empty-desktop.png`, `seg2/prices-mobile-1.png` to `-27.png`, `prices-filters-open-mobile.png`.

What works
- Filters, timeframe, currency, sort and view controls are all present; the mobile filter drawer with a Done button is a sensible pattern.
- USD/CAD toggle with the rate displayed next to it is exactly right for a Canadian audience.
- Grouping by set with a set header (name, generation, code, expansion badge, release date) is a good mental model for collectors.

What looks unprofessional or confusing
- Grouped desktop cards are broken at 1440 px: the product type wraps to three lines ("Elite / Trainer / Box"), the price and "sold/30d" chip overflow the card's right edge ("C$410.4" clipped, `seg2/prices-desktop-2.png`), and the variant badge ("Pokemon Center Exclusive", "Ultra Premium Collection") renders as a large wrapped pill that pushes content down. Three columns of a four-zone horizontal layout do not fit in about 430 px.
- The layout of the price zone differs between views: in grouped view sparkline sits left of the price, in flat view far right, on phones left again. Nothing aligns across cards, so scanning prices down a column is impossible.
- The CHART timeframe control (7D to 1Y) changes which return rows cards show (1M only, or 1M and 3M) but the sparkline is always 365 days. The label "CHART" implies it controls the chart it does not control.
- Flat view shows 3 cards per row at 1440 px, each about 600 px tall (`prices-flat-desktop.png`): 58 products need 20 screens, 306 would need about 100.
- Phones: one product per 450 px card (27 segments for 58 products, `seg2/prices-mobile-*`). There is no list/compact view on mobile at all.
- Left-edge stripe colour encodes the sign of the 1M return. It is unexplained, uses the same red as the brand and the CTAs, and conflicts with the visible return when the timeframe is 3M.
- Zero results render "Found 0 products" followed by the promo, with no "clear filters" action [WP13 for the empty state].
- Image placeholder text "Loading..." in a grey box is visible for below-fold cards on first paint (`seg2/prices-desktop-2.png`).
- Sort offers only Release Date and Price. No sort by return, volume, or supply, which are what an investor ranks by.

Top improvements
1. Make the default catalog a dense responsive list (thumbnail, set and type, price, 1D, 30D, sparkline, units sold 30D) with a card grid as an option. On phones a two-line row: name on line one, price plus change on line two, right-aligned.
2. Fix the card anatomy: product type is the title within a set group, variant as a small secondary line, a single fixed-width price column right-aligned with tabular numbers, the sparkline beside it at a fixed size, and the change directly under the price.
3. Rename CHART to "Period" and make it drive the sparkline window and the single return shown, so one control changes one thing everywhere.
4. Add sorts: 30D change, 1Y change, units sold, days of supply, price vs MSRP.

### `/market` Market View

Shots: `seg2/market-desktop-1.png`, `-2.png`, `market-allcols-sorted-desktop.png`, `market-row-chart-desktop.png`, `seg2/market-mobile-1.png`, `-2.png`, `market-mobile-scrolled.png`.

What works
- A real table with rank, product, set, price, 7D/1M/3M, volume and volume change, and an inline expandable chart per row. Numbers are right-aligned and tabular. Sign colouring is consistent.
- "Show all columns" is the right idea for a power view.

What looks unprofessional or confusing
- Row height about 93 px on desktop because every product cell stacks name, set name and an expansion badge; the set name then repeats in the Set column. Finance tables run 40 to 48 px. Ten rows fill a 1440x900 screen.
- No visible sort state. The default sort is release date, but only the all-columns view shows a tiny "RELEASE V" marker; key-columns view shows no arrow at all. The hint "Click a column header to sort" is doing the work of an affordance.
- Column labels "VOL Δ" and "VOL (30D)" are unexplained; "Chart: Show" buttons in every row add a column of identical controls.
- All-columns view collides: the sticky product column overlaps the Set column so set names are clipped ("scended Heroes", "Mega volution", `market-allcols-sorted-desktop.png`), and CAGR, Max DD and Vol 30D are "--" for every row until each row's history is fetched.
- Inline chart for a 40-day-old product says "Showing 1Y range" and draws the line in the last 10% of the width, with "CAGR -70.17%" annualised from 40 days next to an "Only 40d of data" warning (`market-row-chart-desktop.png`). A number the UI itself flags as unreliable should not be printed.
- Phones: the table keeps the desktop structure. The first screen shows the promo and the header; the price column is off-screen; once scrolled horizontally, the sticky rank and product columns take about 60% of the width and the scrolled cells slide under them, clipped ("9.71%", `market-mobile-scrolled.png`). This page is unusable on a phone.
- The promo banner sits between the filters and the table [WP15].

Top improvements
1. One-line rows: product type plus set as a single link, badge moved to a tooltip or a small dot, Set column dropped in key view. Target 44 px rows.
2. Visible sort state on every sortable header (arrow and bold), default sort by 30D change or volume, sort persisted in the URL.
3. Phone layout as a list, not a table: name, price, selected-period change, and a small sparkline, with a sort sheet. Keep the full table for 768 px and up.
4. Column presets ("Performance", "Liquidity", "Risk") instead of a single key/all toggle, and a short header tooltip for each metric.
5. Clamp the inline chart x-domain to available data and suppress CAGR below 365 days of history.

### `/product/[id]` Product detail

Shots: `seg2/product-desktop-1.png`, `-2.png`, `product-1y-hover-desktop.png`, `product-stale-desktop.png`, `seg2/product-mobile-1.png` to `-4.png`.

What works
- Strong price hero, breadcrumb, sibling products in the same set, and a Market Pulse block (units sold, volume trend, active listings, units on market, days of supply) that no competitor shows this cleanly. Days of supply is a genuinely useful sealed-market metric.
- The chart tooltip is good: date, price with currency, and units sold that week (`product-1y-hover-desktop.png`).
- The stale state is honest: "No current price, last recorded Sep 5, 2026" and a "No recent prices" chart flag (`product-stale-desktop.png`).

What looks unprofessional or confusing
- H1 is only the product type ("Booster Bundle"); the set is a small subtitle. Every product in the catalog shares one of five H1s. The name people search for is "Evolving Skies Booster Bundle" [SEO title is WP13, the on-page H1 is not].
- The price has no change beside it (no 1D or 30D delta), no "as of" date, and USD only. The rest of the site defaults to CAD with a toggle; this page has no toggle.
- Return metrics contradict each other: tile "CAGR -38.73%" equals the 1Y return because only 367 days of history are fetched, while the chart chip says "CAGR -25.56%" for the 3M window (annualised 3 months), and tile "Max drawdown -43.28%" vs chip "Max DD -13.19%" use different windows with no label. "Volatility 30D 18.26%" has no unit explanation (daily stdev? annualised?) [WP18 unifies the math, not the labelling or the window choice].
- The stale product still shows Max drawdown and Volatility while every return is withheld, and Market Pulse says "No signal: Not enough volume history yet" although 396 units sold are displayed right below. The message is wrong: the missing input is price, not volume.
- Chart: the dashed orange line is an unlabeled moving average whose window changes with the timeframe (3, 5, 10 or 14 points); volume bars share the price plot with no volume axis or legend; y-axis ticks are odd values ($263, $327, $391, $455, $518) instead of round numbers.
- No action on the page besides "View on TCGPlayer": no Add to portfolio, no Watch, no Compare, no Alert. The page is a dead end for a signed-in collector.
- No MSRP and no "x times MSRP", the single most-used number in sealed-product investing.
- On phones the image takes 380 px before the name; the chart is the 7th block, about 1.5 screens down (`seg2/product-mobile-2.png`).
- Sibling cards show price only, no change, and use "Loading..." placeholders.

Top improvements
1. Title "Evolving Skies Booster Bundle", price with 1D and 30D change, "as of" date, USD/CAD toggle, and an actions row: Add to portfolio, Watch, Compare.
2. Move the chart directly under the price hero; image shrinks to a thumbnail on phones.
3. One metrics strip with explicit windows ("Max drawdown, 1Y"), CAGR computed from release date or first price and only shown with at least 365 days, volatility labelled "daily, 30D".
4. MSRP row: MSRP, current multiple, and annualised return since release.
5. Chart legend (Price, 14-day average, Units sold) and a separate volume pane or a right-side volume axis; round-number y ticks.

### `/stats` and `/analytics` Set Analytics

Shots: `seg2/stats-desktop-1.png`, `-2.png`, `seg2/stats-mobile-1.png` to `-4.png`. `/analytics` renders the identical page (`analytics-desktop.png`).

What works
- Real analytics (average and median returns by window, consistency, volatility, drawdown, composite score, rank) with an info icon per header.

What looks unprofessional or confusing
- Two routes serve the same page; the nav calls it "Set Analytics" and the URL is `/stats`.
- Two stacked tables where the first (Top 10) is a subset of the second. No chart at all on an analytics page.
- Rows are not clickable and there is no set page to go to. There is no sort on any column.
- "Invest Score 1.06" has no scale or meaning for a reader (it is a z-score blend). "Consistency 60.00%" with two decimals over 5 products implies precision that does not exist.
- The All Set Metrics table overflows on desktop too: "Max Drawdown 1Y" is clipped at the right edge (`seg2/stats-desktop-1.png`) and set names wrap to four lines.
- On phones both tables show Rank, Set and Release; every metric is off-screen (`seg2/stats-mobile-1.png`).
- Tooltips are `title` attributes, invisible on touch.

Top improvements
1. One sortable table with column presets, sets linking to a new set page (products in the set, set index chart, set-level Market Pulse).
2. A risk/return scatter (1Y return vs volatility, point size by product count) as the page's lead visual.
3. Replace "Invest Score" with a 0 to 100 percentile score and a plain-language band ("Top quartile").
4. Integer percentages for consistency, and a phone layout of set rows with the 2 or 3 most important metrics.

### `/compare` Seller Tools

Shots: `seg2/compare-desktop-1.png`, `compare-csv-desktop.png`, `seg2/compare-mobile-1.png`, `compare-csv-mobile.png`.

What works
- After upload, the three tables (store vs market, store margin, market margin) are clear and the status pills (Below, OK, Above) are readable.

What looks unprofessional or confusing
- Empty state is five zero KPI tiles and three empty tables. The upload control is a small dashed box in the top-right corner; there is no description of the expected CSV, no sample file, and nothing tells the user that matching is by SKU.
- Prices lack grouping ("$2599.99") and use "$" while the page says prices are CAD [WP07].
- "Below" in red reads as bad, but for a seller "priced below market" is an opportunity to raise price, not an error. Colour semantics are ambiguous.
- "Profit / day" (+$0.30) is not a metric a seller uses.
- Phones: three wide tables, each horizontally scrolled, SKU wrapping ("EVS-/1") (`compare-csv-mobile.png`).

Top improvements
1. Upload-first empty state: a large drop zone, required columns listed, a downloadable sample, and a note on SKU matching.
2. Replace red/green status with neutral "Under market by 26.9%" plus an action ("Raise to C$410"), and a bulk export of suggested prices.
3. Phone layout as cards per SKU.

### `/box-calculator` Collection Box NAV

Shots: `seg2/boxcalc-desktop-1.png`, `boxcalc-filled-desktop.png`, `seg2/boxcalc-mobile-1.png`, `-2.png`.

What works
- The filled state is the best screen on the site: a clear verdict ("Fair Price, 4.8% above NAV"), four KPIs, a pack-by-pack breakdown and a premium line (`boxcalc-filled-desktop.png`).
- The set picker shows the per-pack price inline.

What looks unprofessional or confusing
- It starts from nothing. The catalog already contains the collection boxes; the user must hand-build a recipe and type the retail price. There is no "pick a product" path that pre-fills the retail price from market data.
- "How it works" sits below the inputs.
- The Add Packs button is grey (disabled look) until a set is chosen, with no hint. The currency toggle floats above the form, unaligned with the form's column.
- The verdict uses fixed thresholds (-10%, +5%) that are not shown.

Top improvements
1. Start with "Choose a collection box" from the catalog, pre-fill retail with the current market price and a stored default recipe, then let the user edit.
2. Show the thresholds next to the verdict and a one-line explanation of NAV.

### `/auth/login`, `/auth/signup`, `/portfolio`, `/account`

Shots: `seg2/login-desktop-1.png`, `login-filled-desktop.png`, `seg2/signup-desktop-1.png`, `seg2/portfolio-desktop-1.png` (redirect).

What works
- Centered single-card forms, clear labels, helper text under username and password.

What looks unprofessional or confusing
- No value proposition on sign-up or on the redirect from `/portfolio`: the user is bounced to "Welcome back" with no line saying the portfolio needs an account and what it gives them.
- The submit button renders pale red and disabled until Turnstile resolves, with no text explaining the wait (here it never resolved because the widget was blocked).
- Portfolio (code review): header, summary card (value, cost basis, gain/loss), allocation by set, value chart, holdings table, Add and Import. The empty state is one icon and "No holdings yet". There is no import-first onboarding (the Collectr importer is the fastest route in and is a secondary button), no per-holding contribution to P&L, no comparison against the market, no realised gains.

Top improvements
1. Contextual auth copy ("Sign in to track your collection's value") on redirects, and a status line under the disabled button while verification runs.
2. Portfolio empty state with three routes: Import from Collectr, Add a product, Try a sample portfolio.

### `/privacy`, 404

Shots: `seg2/privacy-desktop-1.png`, `seg2/notfound-desktop-1.png`, `seg2/notfound-mobile-1.png`.

- Privacy reads well; it uses a narrow text column that no other page uses.
- 404 is Next's stock "404 | This page could not be found." in an unstyled font, with no search, no links [WP13].

---

## Cross-cutting

### Navigation and information architecture

- The nav is organised by tool, not by task: Prices, Market View, Set Analytics, Seller Tools, Box Calculator. Prices and Market View are two presentations of the same dataset under two names; a newcomer cannot tell which to use. Portfolio, the feature most likely to bring a user back, is absent from the logged-out nav and appears only in the footer.
- No global search. The only search boxes are the home hero and page-level filters. For a product site this is the most used control on competitor sites.
- No set pages and no generation pages, so there is no browse path from "Evolving Skies" to its products except filtering. Breadcrumbs on product pages point to Market View, not the set.
- Product pages are dead ends: no link to add to portfolio, no compare, no alert.
- Suggested IA: Markets (index and movers, the current home), Products (one catalog with list/card/table views, replacing Prices and Market View), Sets (index table plus per-set pages), Portfolio (always visible, gated with a teaser), Tools (Box NAV, Seller CSV). Global search in the header with keyboard shortcut.

### Visual language

- There is a real token set in `globals.css` (`--pf-pokeball`, `--pf-pokeblue`, gain/loss, surfaces, ink) and a recognisable card style (white, 1 px slate border, small shadow, rounded-xl), uppercase red eyebrow labels, and heavy display headings. That is a foundation.
- It is not a system yet. Tailwind usage: 459 `text-slate` vs 53 `text-gray`; 126 `rounded-lg`, 33 `rounded-xl`, 23 `rounded-md`, 13 `rounded-2xl`; 68 `shadow-sm`, 16 `shadow-lg`; `text-rose`/`text-emerald` beside `pf-gain`/`pf-loss` [token drift is WP15]. Beyond drift: there is no shared Table, Stat, Badge, SegmentedControl or PageHeader component, so every page reinvents them (three different segmented controls: timeframe, currency, view).
- Red does four jobs: brand, primary CTA, loss, and the promo. When red means both "buy here" and "down 12%", neither reads cleanly. Blue does two (secondary CTA and links). A finance UI keeps gain/loss colours exclusive.
- Badges are overused: expansion type, variant, sold/30d, Pulse state and pills in charts all look alike, so none stands out. "Special Expansion" is shown on every row of a set that already has it in the group header.
- Density is consumer-shop, not finance: 430 to 600 px cards, 93 px table rows, 60 px KPI tiles with one number each.
- Number formatting is inconsistent across pages (C$ vs $ in CAD mode, 2 decimals on percentages everywhere including 60.00% consistency, no grouping) [WP07 for money and dates; percentage precision rules are new].

### First-time visitor comprehension (the 5-second test)

- What it is: partly. "Pokémon Sealed Product Price Tracker" is clear; "Pokéfin" suggests finance, but nothing on the first screen looks like a market (no index, no chart, no movers above the fold on phones).
- Why trust it: no. The page never states the source methodology (TCGPlayer market price, once a day), coverage (how many products, which sets), the freshness gate (stale prices withheld after 14 days, a real differentiator), or who runs it. The only freshness signal is a card-level "Updated" line and, wrongly, "hourly".
- What to do next: unclear. Two browse buttons with no difference explained, a search box, and a large store promo that looks like the primary CTA.
- Fix: a trust strip under the header on every data page ("TCGPlayer market prices, updated daily, last update Sep 30 06:10 ET, 306 products, stale prices hidden, Methodology"), and a methodology page that documents returns, volatility, days of supply, Market Pulse and the composite score.

### Charts

- Recharts output is readable: gridlines are light, the tooltip is good. Gaps: unlabeled moving average, volume without axis, odd tick values, fixed 1Y domain on short histories, and a sparkline skeleton that looks like real data.
- No chart shows a benchmark. The single most useful comparison for an investor is "this product vs the sealed market index" or "vs its set".
- No chart supports range selection or comparing two products.

### Empty, loading and error states

- Loading: "Loading..." text in image boxes, fake zigzag sparklines, cards that grow when "Show full chart" arrives [WP09 for the growth].
- Empty: "Found 0 products" [WP13], five zero tiles and three empty tables on Seller Tools, one-line portfolio empty state.
- Error and stale: the product stale state is good; the Pulse "No signal" message gives the wrong reason; returns and risk metrics are gated inconsistently (returns withheld, drawdown and volatility shown).

### Mobile

- Menu works (fix for close is WP03) but has no backdrop, so the page shows through below it (`menu-open-mobile.png`).
- Tables (Market View, Set Analytics, Seller Tools) are desktop tables in a scroll container; on a phone none shows its key number in the first screen. This is the biggest mobile gap.
- Catalog cards are 450 px each; a phone user browsing 306 products scrolls about 135 screens.
- Horizontal carousels (Top Movers, Recently Released) have no visible scroll affordance beyond a clipped card.

---

## The 10 highest-leverage UI/UX improvements beyond the existing plan

Ordered by impact on the investor use case per unit of effort. None is covered by WP00 to WP21.

1. **A mobile-first list pattern for every dataset.** One `DataList` component (two-line rows: name, set and type; price, period change, sparkline) used for Market View, Set Analytics, Seller Tools and the catalog below 768 px. Fixes the three unusable phone tables and the 450 px catalog cards in one component. Evidence: `market-mobile-scrolled.png`, `seg2/stats-mobile-1.png`, `compare-csv-mobile.png`, `seg2/prices-mobile-1.png`.

2. **A sealed market index and a real market home.** Compute a daily index (for example, liquidity-weighted or equal-weighted price relative across booster boxes and ETBs, plus sub-indices per generation and product type) in a migration numbered after WP21, render it as the home header with 1D/7D/30D/1Y changes, breadth and a chart. This is the "why come back daily" feature, and it gives every product and set a benchmark. Respects the daily cadence.

3. **Merge Prices and Market View into one Products screen with three views** (list, table, cards), one filter bar, URL state (building on WP08), and dense 44 px rows with visible sort state. Removes the "which page do I use" question and halves the surfaces to maintain.

4. **Product page as a decision page.** Full name as H1, price with 1D/30D change and "as of" date, USD/CAD toggle, MSRP and multiple, chart directly under the hero with a legend and a benchmark overlay (index or set), then one metrics strip with explicit windows, then Market Pulse with plain-language labels. Actions row: Add to portfolio, Watch, Compare. Evidence: `seg2/product-desktop-1.png`, `product-stale-desktop.png`.

5. **Watchlist and price alerts.** A signed-in user can watch products and get an email when a price crosses a threshold or moves more than N% in 7D. Uses the existing daily scrape cadence and the Python email pipeline already used for the weekly PDF, so no new paid service. Gives the sign-up form a reason to exist.

6. **Set pages and a clickable Set Analytics.** `/sets/[code]` with the set's products, a set index chart, set-level supply and volume, and release-age context; Set Analytics becomes one sortable table plus a risk/return scatter, with each row linking to its set page. Evidence: `seg2/stats-desktop-1.png` (no links, no chart, duplicated tables).

7. **Trust layer on every data page.** A thin strip with source, cadence, last update in ET and the stale-price rule, linking to a Methodology page that defines every metric (returns, CAGR rule, volatility unit, drawdown window, days of supply, Market Pulse thresholds, composite score). Replace "Invest Score" with a percentile and plain band. Addresses the 5-second trust gap and the unexplained metrics.

8. **Metric honesty rules applied in the UI.** Do not print CAGR under 365 days of data; label every risk metric with its window and unit; clamp chart domains to available data; gate drawdown and volatility with the price freshness gate like returns; fix the Pulse "No signal" reason; replace the zigzag skeleton with a neutral bar. Evidence: `market-row-chart-desktop.png` (CAGR -70% on 40 days), `product-stale-desktop.png`.

9. **Design system pass with finance semantics.** Shared Table, Stat, Badge, SegmentedControl and PageHeader components; gain and loss colours reserved for returns only (brand CTA moves off pure red, or losses move to a distinct rose with a down arrow glyph so colour is not the only cue); badge budget (at most one badge per row); percentage precision rules (1 decimal for returns, integers for shares and consistency); 8 px spacing scale and two radii. WP15 fixes drift within the current look; this sets the look.

10. **Onboarding into the portfolio.** Show Portfolio in the logged-out nav with a teaser (sample portfolio with value chart and allocation), make "Import from Collectr" the primary empty-state action, and on the portfolio add per-holding P&L contribution and a "vs sealed index" line. Evidence: portfolio redirect in `seg2/portfolio-desktop-1.png` with no context, empty state in `HoldingsTable.tsx`.

Also worth doing, smaller: global header search with product autocomplete; Box Calculator that starts from a catalog collection box with a stored default recipe and pre-filled market retail; Seller Tools upload-first empty state with a sample CSV and action-oriented status copy; backdrop on the mobile menu; Top Movers split into gainers and losers with a liquidity floor.

---

## Incidental finding

`next dev` 16.3.6 writes `frontend/AGENTS.md` and `frontend/CLAUDE.md` into the working tree on start (`node_modules/next/dist/server/lib/generate-agent-files.js`). Running the app for this audit created both files (untracked, 2026-09-30 04:38 UTC). They were not removed because the deletion was blocked by a permission check; the owner should delete them or add them to `.gitignore`, and set `agentRules: false` in `next.config.ts` so dev runs stop recreating them.
