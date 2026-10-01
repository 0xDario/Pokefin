# WP36: Portfolio analytics: vs the index, net of exit costs, in the currency you paid

- **Goal**: a signed-in collector opens `/portfolio` and sees, in one screen, whether their collection beat the sealed market ("Same money in the Pokéfin Sealed Index"), what they would actually net after selling fees (editable, default 15%), how long each holding would take to sell (a days-to-exit band), how value splits by set, product type and era with a flag when one product or set dominates, and their cost basis and P/L in the currency they paid, with a Canadian buyer's CAD P/L split into market move and currency move at Bank of Canada rates of the right days. A user with no holdings gets an import-first start: Import from Collectr, Add a product, or Explore a sample portfolio that is never saved.
- **Why now / value**: signature feature 6 of `01-PRODUCT-DIRECTION.md` §5 and the "Return" step of §4.2 ("am I beating the market, and what would I actually net on exit?"). Every input already exists after WP25 (`fx_daily`, `product_stats_latest`) and WP29 (the headline index series), so this package is mostly arithmetic and presentation. It also removes the last chart that converts CAD history at today's rate (WP25 left that bullet in `/methodology#limits` for WP31 and WP36), and it fixes a correctness gap: a Canadian who paid C$129.99 is stored today as if they paid US$129.99.
- **Effort**: L, 14 to 16 hours (migration and its two Python test modules 2.5 h, analytics builder, chart model and their tests 3 h, input, repo, two routes and the browser client with tests 2 h, modals and import currency 1.5 h, summary, chart, allocation, holdings table and phone list with tests 4 h, empty state and sample portfolio 1 h, methodology, budgets, docs, verification and PR 1.5 h).
- **Depends on**: WP05 (`app/lib/server/portfolioRepo.ts` with `HOLDING_SELECT`, `loadGuardedProducts`, `guardHoldings`, `getOrCreatePortfolio`, `findPortfolioId`; `app/lib/portfolioInput.ts` with `parseNewHolding`, `parseHoldingUpdate`, `describeWriteError`, `Parsed`; `app/lib/portfolioApi.ts` with `PortfolioApiError`, `readErrorMessage`, `JSON_HEADERS`, `NETWORK_ERROR`; `app/lib/routeAuth.ts`; `rejectIfNotAppRequest`; the four portfolio routes; `usePortfolioData`), WP10 (`GET /api/portfolio/history`, `get_portfolio_history`, migration 0029), WP14 (`app/components/ui/Dialog.tsx` and the modal markup), WP20 (`app/types/portfolio.ts`, `useCurrency()`, `pnpm types:db`, generated `app/types/database.ts`), WP21 (migrations 0031 and 0032, `scripts/db/replay_migrations.sh`, `tests/test_migration_volatility.py`, the CI "database" job, the DB test fixture pattern), WP23 (`Stat`, `Delta`, `Badge`, `SegmentedControl`, `DataList`, `Skeleton`, `Button`, `AsOf`, `icons.tsx`, tokens, dense `SortableTable`, `test-utils/axe.ts`, the `uiConventions` ratchet), WP25 (`fx_daily` in migration 0034, `app/lib/fx.ts`, `app/lib/marketStats.ts`, `getCachedFxDaily`, `getCachedProductStats`, `/methodology` v1.1 and its `#limits` bullet), WP29 (migration 0037, `getCachedIndexSeries`, `HEADLINE_INDEX_CODE`, `HEADLINE_INDEX_NAME`). Through them: WP07 (`app/lib/format.ts`), WP11 (`app/components/IntentLink.tsx`), WP15 (`ConfirmDialog`, the dashboard delete flow), WP17 (blocking lint, `PortfolioTooltip` at module scope, `chartTooltips.test.tsx`), WP18 (`app/lib/sorting.ts`, `SortableTable`), WP22 (`perf-budgets.json`, `pnpm perf:budget`), WP24 (`metricDefinitions.ts`, `MetricLabel`, `app/content/methodology.ts`, `MethodologyArticle.tsx`). Soft, with a default in Before you start: WP31 (`?add=` pre-fill in `AddHoldingModal` and the dashboard), WP34 (`PortfolioTabs` on `app/portfolio/page.tsx`, migration 0038), WP35 (migration 0039).
- **Unblocks**: nothing in Track 2 depends on it. A later "realised P/L" package builds on its lot model (it needs a sale model first, deferred in `01-PRODUCT-DIRECTION.md` §10).
- **Placement**: Track 2, after WP29 (index series) and WP25 (`fx_daily`, stats). Reserves migration **0040** and keeps it even if it merges before WP34 (0038) or WP35 (0039). It can run in parallel with WP31 to WP35; step 1 explains how 0040 stays correct in either merge order.
- **Suggested branch name**: `remediation/wp36-portfolio-analytics`
- **Risk level**: medium. It adds a trigger to two user tables and patches `export_my_data()` in place; both were replayed twice on PostgreSQL 16, the trigger fails closed (no rate, no row), every existing row keeps its USD value, and a 14-case database test proves the conversion, the exact round trip and the export.

## Why

Today `/portfolio` shows value, cost and gain in USD, converts to CAD at today's rate for every figure, and stops there: a collector cannot tell whether their buys beat simply buying the sealed market, the "gain" ignores the roughly 15% a sale costs, nothing says that 12 of a box that sells 3 a month is hard to exit, and a Canadian who paid in CAD has no way to record it (`research/ui-audit.md` "`/auth/login`, `/auth/signup`, `/portfolio`, `/account`" and top-10 item 10; `research/data-opportunities.md` §1 item 2 and §3.14). Brokerage-grade portfolio views lead with P/L against a benchmark and net of costs (`research/competitive-landscape.md` §4 item 5, OpenOrHold's "about 15% lost on sale"), and no sealed tracker does CAD cost basis at the purchase-date rate (`research/competitive-landscape.md` §5 item 1). This package adds the purchase currency and an exit-fee setting to the database, a pure analytics builder behind `GET /api/portfolio/analytics` (money-matched Sealed Index benchmark, exit value, days to exit, allocation, concentration, CAD market and currency split), a summary, chart overlay, allocation panel and holdings table built from WP23 components, a "Paid in" choice in the add, edit and import flows, and an import-first empty state with a client-only sample portfolio (`research/ui-audit.md` "Portfolio empty state with three routes"). Collector-investors who hold more than a few products benefit first; Canadian buyers get a cost basis that is finally correct.

## Design

### Decisions (binding, from the work order; do not reopen)

1. **Benchmark is money-matched.** Each lot's cost is invested in the Pokéfin Sealed Index (WP29 headline series, code `sealed`) on its purchase date and valued at the index's last published day. It is labelled "Same money in the Pokéfin Sealed Index", never "time-weighted return" (`research/competitive-landscape.md` §4 item 5 asks for time-weighted; the work order chose money-matched because it reads more simply).
2. **Exit value** = market value × (1 − exit fee ÷ 100). The fee defaults to 15% and is stored per portfolio (`portfolios.exit_fee_pct`, 0 to 50).
3. **Days to exit** per holding = quantity ÷ (units sold 30D ÷ 30), shown as a band: Under 1 week, 1 to 4 weeks, Over 1 month, Unknown.
4. **Cost basis in CAD** uses the purchase-date rate from `fx_daily`. CAD P/L is split into market move and currency move (`research/data-opportunities.md` §3.14).
5. **Realised P/L is out of scope** (no sale model yet). Nothing in this package records a sale.
6. **Migration 0040**, named `migrations/0040_portfolio_lot_currency.sql`. `purchase_price_usd` stays the canonical column; for a CAD lot it is computed in the database from the native price ÷ the purchase-date rate.

Decisions made in this spec, with the reason:

7. **The lot is the holding row.** The app has never written `portfolio_lots` (WP05 "Before you start" command 3); each `portfolio_holdings` row is one purchase (quantity, price, date). "Per-lot" figures are therefore per holding row. `portfolio_lots` gets the same columns and trigger so the two tables never diverge, but nothing reads it.
8. **Conversion lives in a database trigger**, not only in the route: the import route, the add route, the edit route and any direct PostgREST write by the user all store the same USD value, and a missing rate fails the write (SQLSTATE `PF001`, HTTP 400) instead of storing a guess.
9. **Days to exit uses every unit of the product you hold** (all lots of that product), shown on each of its rows: two lots of one box sell to the same buyers.
10. **The benchmark comparison covers lots with a current price and an index level on the purchase date.** Lots bought before the index's first day, and lots whose price is withheld, are left out of both sides and counted in a coverage line. The chart's index line includes every lot with an index level (the value line from WP10 also includes a withheld lot on the days it was priced).
11. **CAD figures come from the analytics payload** (`fx_daily`, the rate of each day) and never from `useCurrency().exchangeRate`, except the add modal's pre-filled price, which is only a starting value the user edits.
12. **Allocation is labelled bars, not a pie.** The Recharts pie (`AllocationChartImpl`) is deleted: one fewer chart in the lazy chunk, and a ranked list reads better than ten colours.
13. **The "ALL" range button is removed** from the portfolio chart: history is requested for at most 365 days, so "ALL" repeated "1Y" (cadence honesty, `01-PRODUCT-DIRECTION.md` principle 3). The `PortfolioTimeframe` type keeps "ALL" so WP05's hook does not change.
14. **The sample portfolio is static**: made-up purchases valued with formula-generated prices dated Sep 29, 2026, built in the browser from a lazily imported module, rendered with the real components in read-only mode, and labelled as not market data. It makes no request and saves nothing.

### Metric definitions

All amounts are totals for a row (quantity included) unless named per unit. USD figures use the guarded Market Price WP05 attaches to each holding (`products.usd_price`, `null` when withheld by migration 0023). CAD figures use `fx_daily` (WP25): `rateOn(fx, day)` is the rate of that UTC day, the last rate carried at most 14 days past the end of the series, `null` otherwise. "Today" is the UTC date of the request.

| Figure | Formula | Edge cases |
|---|---|---|
| Market value (lot) | `quantity × priceUsd` | `null` when the price is withheld; never 0 |
| Cost (USD) | `quantity × purchase_price_usd` | For a CAD lot, `purchase_price_usd` is the database's conversion at the purchase-date rate |
| Cost (CAD) | CAD lot: `quantity × purchase_price_native` (exact). USD lot: `costUsd × rateOn(fx, purchase_date)` | USD lot with no rate for its date: `null`, and the lot is left out of CAD totals ("Covers n of m priced holdings") |
| Rate at purchase `FX0` | CAD lot: `purchase_price_native ÷ purchase_price_usd` (the rate the database used). USD lot: `rateOn(fx, purchase_date)` | Stored conversion is never recomputed on read |
| Value (CAD) | `valueUsd × FX1`, `FX1 = rateOn(fx, today)` | `null` without a rate today |
| Unrealized P/L | `value − cost` in the same currency | Over priced lots only. `plPct = pl ÷ cost × 100`, `null` when cost is 0 |
| Market move (CAD) | `(valueUsd − costUsd) × FX0` | Sum with currency move equals CAD P/L exactly |
| Currency move (CAD) | `valueUsd × (FX1 − FX0)` | Positive when the US dollar rose against the Canadian dollar since purchase |
| Contribution | `lot P/L ÷ total priced cost × 100`, in points | Sums to the total return %. CAD: over lots with a CAD cost |
| Day change | `Σ quantity × (price − price ÷ (1 + ret_1d ÷ 100))` over holdings whose WP25 stats row is fresh and has `ret_1d` | Same rule as WP32's home strip, so both agree. `null` when none repriced; "n of m repriced" |
| Exit value | `market value × (1 − fee ÷ 100)` | Fee in [0, 50], 1 decimal, default 15 |
| Net of cost | `exit value − cost` over the same lots | |
| Days to exit | `productQuantity ÷ (units_sold_30d ÷ 30)` | Band: `< 7` Under 1 week; `7 ≤ d ≤ 30` 1 to 4 weeks; `> 30` Over 1 month; `units_sold_30d = 0` Over 1 month (no finite estimate); `units_sold_30d` null (stale or holed sales data, WP25 gate) Unknown |
| Index level on a day `L(d)` | Level of the newest published point on or before `d`, at most 7 days older | Weekly history (Mondays) before daily collection is covered by the 7-day rule; `null` otherwise |
| Same money in the index (lot) | `costUsd × L(last index day) ÷ L(purchase_date)` | Only with a current price and `L(purchase_date)`. Purchase after the last index day: ratio 1 |
| vs Sealed Index | `value − benchmark` (money) and `returnPct − benchmarkReturnPct` (points) over covered lots | Withheld when the index's last day is more than 7 days before today ("index_stale") or the read failed ("index_unavailable"); "no_covered_lots" when nothing qualifies. CAD: `cost` = CAD cost, value and benchmark × FX1; `null` when a covered lot has no CAD cost (USD shown with its code) |
| Index line (chart) | For each day `d` from today − 365 to the index's last day: `Σ costUsd × L(d) ÷ L(purchase_date)` over lots with `purchase_date ≤ d` and an index level on the purchase date | `null` before the first such lot and after the last index day. CAD: × `rateOn(fx, d)` |
| Value line (chart) | WP10 `get_portfolio_history`, USD; CAD: × `rateOn(fx, d)` per day | A CAD day without a rate is a gap. No `fx_daily` at all: USD with a note |
| Allocation | Priced value grouped by set (`sets.id`), product type (`product_types.id`) or era (`sets.generations.id`), share = group ÷ priced value | Top 6 shown, the rest folded into "Other (n)" |
| Concentration flag | A product, or a set, above 40% of the priced value | Only with at least 2 priced products (product flag) or 2 sets (set flag); a set flag is skipped when the set is one product that is already flagged |

### Data flow

```
 add / edit / import (browser)                       GET /portfolio (client island, WP04 gate)
   | purchase_currency, purchase_price_native          |
   v                                                    +--> GET /api/portfolio (WP05)  portfolio + guarded holdings
 POST/PATCH /api/portfolio/holdings*, /import (WP05)    +--> GET /api/portfolio/history (WP10)  value line, USD
   | parseNewHolding / parseHoldingUpdate (WP36)        +--> GET /api/portfolio/analytics (NEW)
   v                                                    |      loadPortfolioAnalyticsInput (fee + guarded holdings)
 portfolio_holdings  --BEFORE trigger (0040)-->         |      getCachedProductStats  (WP25, cached)
   CAD: purchase_price_usd := native / fx_daily(date)   |      getCachedFxDaily       (WP25, cached)
   USD: purchase_price_native := purchase_price_usd     |      getCachedIndexSeries("sealed") (WP29, cached)
   no rate: PF001 -> HTTP 400                           |      buildPortfolioAnalytics (pure) -> JSON, no-store
                                                        +--> PATCH /api/portfolio { exit_fee_pct } (NEW)
```

The analytics request repeats after every add, edit, delete, import or refresh (the holdings array changes); the previous request is aborted.

### API contract

`GET /api/portfolio/analytics`: same gates as WP05's `GET /api/portfolio` (403 without `x-pokefin-request: 1`, 401 signed out, 503 auth outage, 500 on a failed read), `Cache-Control: no-store`, never creates a portfolio. 200 body is `PortfolioAnalytics` (step 3): `version: 1`, `today`, `exitFeePct`, `statsDay`, `fxNow`, `fxSourceDate`, `totals`, `benchmark`, `benchmarkSeries` (`{ start, usd[] }`, 366 entries, or null), `allocation`, `concentration`, `lots[]` (one per holding row, keyed by `holdingId`), `fx` (the `fx_daily` series from today − 400 days, for the chart). About 9 kB plus 0.8 kB per holding before compression (measured: 12.5 kB for the 6-holding sample; the 366-point benchmark series and the 400-day FX slice are most of the fixed part), roughly a quarter of that over the wire with Vercel's gzip or brotli. It is a private `no-store` response fetched once per holdings change, never on first paint, so it does not touch the `/portfolio` JS budget.

`PATCH /api/portfolio`: body `{ "exit_fee_pct": number }` (0 to 50, rounded to 1 decimal), CSRF-gated like WP05's writes, at most 1 KB. 200 `{ "exit_fee_pct": 12.5 }`; 400 `{ error }` for an invalid value; 401/503 as above; 500 on a failed write. Creates the portfolio if missing (same as `GET /api/portfolio`).

Holding writes (WP05 routes, extended): bodies may carry `purchase_currency` (`"USD"` or `"CAD"`, default `"USD"`) and `purchase_price_native` (the per-unit price in that currency). A body with only `purchase_price_usd` is a USD price (clients from before WP36). A CAD price whose purchase date has no Bank of Canada rate answers 400 "There is no Bank of Canada rate for that purchase date. Enter the price in USD, or pick another date." Holdings in every response now carry `purchase_currency` and `purchase_price_native`.

### Layout

Built only from WP23 components and token utilities (`text-ink`, `text-ink-soft`, `bg-surface`, `bg-surface-alt`, `border-line`, `rounded-card`, `rounded-control`, `text-h2`, `text-h3`, `text-body`, `text-small`, `text-caption`, `text-warn-text`, `bg-warn-fill`, `bg-chart-grid`; chart strokes through `var(--pf-chart-line)`, `var(--pf-chart-bench)`, `var(--pf-chart-grid)`). No raw palette class, no hex, no brand red. Every number is `tabular-nums`. Cards: `rounded-card border border-line bg-surface p-4 md:p-6` (`CARD`). Primary action per view: "Add holding" when holdings exist, "Import from Collectr" in the empty state.

`/portfolio` at 1440 px, holdings present (figures illustrative; the page header and the Holdings | Watchlist tabs are WP13, WP15 and WP34's; unchanged):

```
My Portfolio
Track holdings, returns, and allocation across your sealed collection.
[ Holdings | Watchlist ]
                                                                        [Import from Collectr] [#Add holding#]
+-----------------------------------------------------------------------------------------------------------------+
| Market value ?        Day change ?          Unrealized P/L ?         Exit value ?            vs Sealed Index ?   |
| C$4,301.20            +C$5.12 ▲ 0.1% 1D     +C$982.55 ▲ 29.6%        C$3,656.02              +C$182.40 +5.9 pts  |
| as of Sep 29          5 of 6 repriced       Market +C$900.09 ·       Selling fees [ 15 ] %   Your return +26.7%, |
|                                             Currency move ? +C$82.46 Net of cost: +C$674.80  the same money in   |
|                                                                                              the index +20.9%    |
|                                                                                              Index as of Sep 29, 2026 |
+-----------------------------------------------------------------------------------------------------------------+
+--------------------------------------------------------------------------+ +------------------------------------+
| Value                                       [ 7D | 1M | 3M | 6M |#1Y#]    | | Allocation        [#Set#|Type|Era] |
| ── Your holdings  - - Same money in the Pokéfin Sealed Index             | | Evolving Skies     C$2,264 · 52%  |
|                                        [x] Compare with the Sealed Index | | ████████████████░░░░░░░░░░░░░░░    |
|   C$4.5k ┤                                          ___/‾‾               | | 151                C$938 · 22%     |
|          ┤                       ___----‾‾‾‾‾‾‾‾‾‾‾                      | | ███████░░░░░░░░░░░░░░░░░░░░░░░░    |
|   C$3.0k ┤ - - - - - - - - - - - - - - - - - - - - - -                   | | Crown Zenith       C$352 · 8%      |
|          └──────────────────────────────────────────────                 | | ...                                |
|           Oct 1         Jan 1          Apr 1          Jul 1              | | Concentrated Evolving Skies        |
| Last point Sep 30, 2026. The index is published for the previous day;   | | Booster Box is 52% of your priced  |
| its line ends Sep 29, 2026. Compares 5 of 6 priced holdings; 1 bought   | | value.                             |
| before the index starts on Jan 6, 2025.                                  | |                                    |
+--------------------------------------------------------------------------+ +------------------------------------+
+-----------------------------------------------------------------------------------------------------------------+
| Holdings (6)                                                                                                     |
| PRODUCT ↕            BOUGHT ↕      QTY  PAID (EACH)  PRICE         VALUE ▼     P/L ↕               CONTRIB. ↕  DAYS TO EXIT ↕  ACTIONS |
| Evolving Skies Bo..  Nov 14, 2025    2  C$845.00     C$1,132.40    C$2,264.80  +C$574.80 ▲ 34.0%   +23.4 pts   1 to 4 weeks    [E][D] |
| 151 Booster Bundle   Feb 3, 2026     6  C$64.99      C$78.12       C$468.72    +C$78.78 ▲ 20.2%    +3.2 pts    Under 1 week    [E][D] |
| Crown Zenith Elite.. Jan 20, 2026    4  $59.99       C$88.10       C$352.40    +C$24.30 ▲ 7.4%     +1.0 pts    Under 1 week    [E][D] |
|                                                                                in USD: +$17.60                                    |
| Paldean Fates Elit.. Mar 11, 2026    3  $54.50       -- (clock)    --          --                  --          Over 1 month    [E][D] |
| Days to exit: the units of each product you hold divided by its TCGplayer units sold per day over the last 30 days. It measures |
| market depth; it is not a quote. Contribution: each holding's P/L in points of your priced cost, so the column adds up to your total return. |
+-----------------------------------------------------------------------------------------------------------------+
```

`/portfolio` at 390 px (touch): the summary is a 2-column grid of `Stat`s with "vs Sealed Index" spanning both columns; the range control fills the width; holdings are a `DataList` with a sort select; every control is 44 px tall on touch screens; no horizontal scroll anywhere.

```
+--------------------------------------+
| My Portfolio                          |
| [ Holdings | Watchlist ]              |
|  [Import from Collectr] [#Add holding#]|
+--------------------------------------+
| Market value ?     Day change ?       |
| C$4,301.20         +C$5.12 ▲ 0.1% 1D  |
| as of Sep 29       5 of 6 repriced    |
| Unrealized P/L ?   Exit value ?       |
| +C$982.55          C$3,656.02         |
| ▲ 29.6%            Selling fees [15]% |
| Market +C$900.09 · Net of cost:       |
| Currency +C$82.46  +C$674.80          |
| vs Sealed Index ?                     |
| +C$182.40 +5.9 pts                    |
| Your return +26.7%, the same money in |
| the index +20.9%                      |
+--------------------------------------+
| Value                                 |
| [ 7D | 1M | 3M | 6M |#1Y#]            |
| ── holdings - - same money in index   |
| [x] Compare with the Sealed Index     |
| (chart, 250 px)                       |
+--------------------------------------+
| Allocation          [#Set#|Type|Era]  |
| Evolving Skies       C$2,264 · 52%    |
| ███████████████░░░░░░░░░░░░           |
| ...                                   |
+--------------------------------------+
| Holdings (6)                          |
| SORT BY                               |
| [Value             v] [Highest first] |
|---------------------------------------|
| Evolving Skies Booster Box     [E][D]|
| 2 × C$845.00 · Exit: 1 to 4 weeks     |
|              C$2,264.80 ▲ 34.0%       |
|---------------------------------------|
| Paldean Fates Elite Trainer Box [E][D]|
| 3 × $54.50 · Exit: over 1 month --  --|
|            (clock) Last priced Sep 1  |
+--------------------------------------+
```

Empty state (both widths; the three buttons stack full width below 640 px):

```
+- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
|                          Start with what you own                                   |
|  Import your Collectr export in one step, or add products one at a time. Pokéfin   |
|  values them every day at the TCGplayer Market Price, shows what you would net     |
|  after selling fees, and compares your purchases with the same money in the        |
|  Pokéfin Sealed Index.                                                             |
|  [#Import from Collectr#]  [Add a product]  Explore a sample portfolio             |
|  The sample uses made-up purchases and generated prices. Nothing is saved.         |
+- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
```

Sample portfolio (after "Explore a sample portfolio"): a note bar, then the full dashboard in read-only mode (no product links, no edit or delete, the fee field applies to this view only).

```
+----------------------------------------------------------------------------------------------+
| Sample portfolio. Made-up purchases valued with generated prices as of Sep 29, 2026, not     |
| market data. Nothing here is saved.            [#Import from Collectr#]  Close the sample    |
+----------------------------------------------------------------------------------------------+
(summary, chart, allocation, holdings as above, read-only)
```

In both wireframes `[E][D]` are the edit and delete icon buttons, `(clock)` is WP23's `AsOf` stale-price clock, and `#...#` marks the selected segment or the primary button.

Add holding dialog (WP14 `Dialog`; "Paid in" is new, between the product and the quantity and price row):

```
+-----------------------------------------------+
| Add Holding                               [x] |
| Product  [ Evolving Skies Booster Box      ]  |
| Paid in  [ USD |#CAD#]                        |
| Kept exactly as you enter it. Pokéfin converts|
| it to US dollars at the Bank of Canada rate   |
| of the purchase date to compare it with US    |
| Market Prices.                                |
| Quantity [ 1 ]   Price paid per unit (CAD)    |
|                  [ C$ 845.00 ]                |
| Purchase Date [ 2025-11-14 ]                  |
| Notes (optional) [                       ]    |
|                          Cancel  [Add Holding]|
+-----------------------------------------------+
```

The edit dialog has the same "Paid in" control, starting at the lot's currency and price. The Collectr import preview gets one more control under its Matched / Unmatched / Selected tiles: "Costs in this file are in [#USD#| CAD]".

### States

- **Loading** (first load, WP05 `loading`): two flat `Skeleton` bars and a visually hidden "Loading your portfolio…" status. No spinner.
- **Analytics loading** (holdings shown, analytics pending): summary values are flat skeleton bars; holdings rows show quantity, bought and paid at once and a skeleton in the price, value, P/L, contribution and days-to-exit cells; allocation shows three skeleton bars. The chart renders its value line as soon as history arrives; the index line appears when analytics arrives.
- **Analytics error**: a warn note at the top of the summary ("We could not load your portfolio figures. Your holdings below are up to date.") with "Try again"; analytics cells show `--`; the rest works. A 401 says "Your session has expired. Please sign in again."
- **Empty**: the empty state above (replaces WP05's one-line "No holdings yet").
- **Stale price** (withheld, 14 days or more): the row's price, value, P/L and contribution show `--` with a visually hidden "Price withheld. Last priced {date}." and the WP23 `AsOf` clock; the holding is excluded from value, P/L, exit value, allocation and the benchmark; the summary says "{n} of {m} holdings priced". A price 2 to 13 days old shows the clock with its value (desktop: the table-variant clock with its tooltip; phones: an inline "Last priced {date}" line, because a tooltip never shows on touch).
- **Index unavailable / stale / nothing to compare**: "vs Sealed Index" shows `--` with one sentence (see Copy); the chart hides the toggle when there is no series.
- **No FX**: a USD lot with no rate for its purchase date has no CAD cost; CAD totals say "Covers {n} of {m} priced holdings." With no `fx_daily` at all, CAD amounts fall back to USD with the code ("$1,234.00 USD") and the chart says it is in US dollars.
- **Fee field**: "Saving…", "Saved", or "Not saved. This view uses it until you reload."; an invalid value says "Enter 0 to 50." and is not applied.

### Copy (all new user-facing strings)

"Market value", "Day change", "Unrealized P/L", "Exit value", "vs Sealed Index", "Currency move", "Contribution", "Days to exit", "Selling fees", "Net of cost:", "{n} of {m} holdings priced", "{n} of {m} repriced", "Covers {n} of {m} priced holdings.", "Your return {+x%}, the same money in the index {+y%}", "Index as of {date}", "Compares {n} of {m} priced holdings; {k} bought before the index starts on {date}.", "The Pokéfin Sealed Index is not available right now.", "The Sealed Index has not been published since {date}.", "None of your priced holdings was bought on or after {date}, when the index starts.", "Same money in the Pokéfin Sealed Index", "Compare with the Sealed Index", "Your holdings", "Last point {date}. The index is published for the previous day; its line ends {date}.", "Bank of Canada rates are unavailable right now, so this chart is in US dollars.", "Allocation", "Set", "Type", "Era", "Other ({n})", "Concentrated", "{product} is {x%} of your priced value.", "{set} products are {x%} of your priced value.", "{n} holdings have no current price and are left out.", "Under 1 week", "1 to 4 weeks", "Over 1 month", "Unknown", "About {n} days of recent TCGplayer sales for the {q} you hold.", "No TCGplayer sales in the last 30 days.", "No recent TCGplayer sales data for this product.", "Paid in", "Price paid per unit ({USD|CAD})", "Kept exactly as you enter it. Pokéfin converts it to US dollars at the Bank of Canada rate of the purchase date to compare it with US Market Prices.", "Costs in this file are in", "Collectr exports costs in the currency your Collectr app shows. Pick CAD if you see C$ there.", "Start with what you own", "Import from Collectr", "Add a product", "Explore a sample portfolio", "The sample uses made-up purchases and generated prices. Nothing is saved.", "Sample portfolio.", "Close the sample", "There is no Bank of Canada rate for that purchase date. Enter the price in USD, or pick another date.", "Selling fees must be between 0% and 50%", "{+x} pts". No em dash, no "live", "real-time", "all-time", "TCGPlayer". Spelling follows the site's existing copy ("Unrealized", as today's summary card writes it). A difference of two returns (vs Sealed Index, contribution) always prints as points through `formatPoints` ("+5.9 pts"), never with `Delta`, which would print it as a percent change ("▲ 5.9%").

### Accessibility

- Each section is a `section` with a heading (`Portfolio summary` is visually hidden); every metric label is WP24's `MetricLabel` with its "?" link to `/methodology#...`.
- Direction is never colour alone: WP23 `Delta` carries a glyph and a spoken word, and point differences ("+5.9 pts", "-0.8 pts") carry the sign in the text itself. Bars in Allocation are decorative (`aria-hidden`); the name, amount and share are text.
- Holdings: desktop `SortableTable` (header buttons with `aria-sort`), phone `DataList` with a labelled sort `select` (16 px text, no iOS zoom) and an order button. Edit and delete are separate buttons with names ("Edit Evolving Skies Booster Box"), 44 px on touch; the product link is the row text, never wrapping a button.
- "Paid in" and "Group by" and the chart range are WP23 `SegmentedControl` radio groups (arrow keys, Home/End). The index toggle is a native checkbox with a visible label.
- The fee input has a visible label, `inputMode="decimal"`, `aria-invalid` when out of range and an `aria-describedby` status line with `role="status"`.
- The chart is supplementary: every number it shows is also in the summary as text. The tooltip is mouse-only, as on every other Pokéfin chart.
- Component tests run WP23's `axeViolations` and must return `[]`.

### Performance

- `/portfolio` is a client island behind WP04's gate; budget `routes./portfolio.jsGzKb` (target 180 kB gz, WP22). New initial code: about 6 to 8 kB gz (summary, allocation, the two holdings views, hook, helpers). Removed: `PortfolioSummaryCard`, `AllocationChart`, `HoldingCard` and the Recharts pie in the lazy chunk.
- Recharts stays lazy and loads only when there is history to plot. The sample portfolio (`demo/*`, about 3 kB gz) and the analytics builder load only after "Explore a sample portfolio".
- The analytics route does two indexed user-table reads (portfolio by `user_id`, holdings by `portfolio_id`); stats, FX and index series are `unstable_cache` hits under WP11's `market-products` tag. The builder is O(holdings × 366): under 10 ms for 1,000 holdings.
- The trigger adds one primary-key probe of `fx_daily` per CAD write.

## Before you start

Read these fully first (paths from `frontend/` unless they start with `migrations/`, `tests/` or `scripts/`):

- Specs: `audits/remediation/01-PRODUCT-DIRECTION.md` (§3, §4.2, §5 item 6, §6), WP05 (steps 3, 4, 6 to 9, 11, 12, 15 to 17; Tests 1, 2, 6, 8), WP10 (steps 4 to 9), WP14 (steps 3, 5, 6, 7), WP15 (step 9 and the dashboard test), WP17 (step 8b, Tests 11), WP20 (steps 2 and 3.11), WP21 (steps 2, 11b, 14 and the DB test fixture pattern), WP23 (Design and the component sheet), WP24 (steps 4 to 6, 10), WP25 (Design, steps 2, 9 to 12, 14), WP29 (Rules and formulas, steps 8 and 10), WP34 (step 1, export_my_data section, and Tests 1 and 2 for the fixture style).
- Code: `app/components/Portfolio/PortfolioDashboard.tsx`, `cards/AddHoldingModal.tsx`, `cards/EditHoldingModal.tsx`, `cards/ImportHoldingsModal.tsx`, `cards/HoldingsTable.tsx`, `cards/HoldingCard.tsx`, `shared/PortfolioSummaryCard.tsx`, `shared/PortfolioChart.tsx`, `shared/AllocationChart.tsx`, `hooks/usePortfolioData.ts`, `app/components/charts/PortfolioChartImpl.tsx`, `AllocationChartImpl.tsx`, `ChartBundle.tsx`, `app/portfolio/page.tsx`, `app/types/portfolio.ts`, `app/lib/portfolioInput.ts`, `app/lib/portfolioApi.ts`, `app/lib/server/portfolioRepo.ts`, `app/lib/import.ts`, `app/lib/portfolio.ts`, `app/lib/fx.ts`, `app/lib/marketStats.ts`, `app/lib/marketIndex.ts`, `app/lib/serverMarketData.ts` (`getCachedProductStats`, `getCachedFxDaily`, `getCachedIndexSeries`), `app/api/portfolio/route.ts` and its siblings, `app/content/methodology.ts`, `app/methodology/MethodologyArticle.tsx`, `app/lib/metricDefinitions.ts`, `app/components/ui/*`, `app/components/SortableTable/SortableTable.tsx`, `app/components/IntentLink.tsx`, `app/__tests__/uiConventions.test.ts` and its baseline, `perf-budgets.json`. Repo root: `migrations/0011_export_my_data.sql`, `migrations/0024_export_my_data_volatile.sql`, `migrations/0029_portfolio_history_rpc.sql`, `migrations/0031_user_table_write_limits.sql`, `migrations/0034_fx_daily.sql`, `migrations/0037_market_index.sql`, `tests/test_migration_volatility.py`, `verify_migration.py` (docstring), `README.md` (Database section), `audits/HARDENING_FOLLOWUPS.md` section 7.
- Every call site you will change or delete:

```bash
cd frontend
grep -rn "PortfolioSummaryCard\|AllocationChart\|AllocationTooltip\|HoldingCard\|HoldingSortBy\|HoldingSortDirection" app --include=*.ts --include=*.tsx
grep -rn "importHoldings(\|<AddHoldingModal\|<EditHoldingModal\|<ImportHoldingsModal\|<PortfolioChart\b" app --include=*.ts --include=*.tsx
grep -rn "purchase_price_usd" app --include=*.ts --include=*.tsx | grep -v __tests__
```

Confirm the starting state (repo root). Each line must print what its comment says; otherwise stop and report the missing package:

```bash
git checkout master && git pull && git checkout -b remediation/wp36-portfolio-analytics

# Migration registry: 0040 is free; WP21, WP25 and WP29 are in.
ls migrations | grep -E '^0040_'                                                   # no output
ls migrations/0031_*.sql migrations/0032_*.sql migrations/0034_fx_daily.sql migrations/0037_*.sql \
   scripts/db/replay_migrations.sh tests/test_migration_volatility.py                # all six exist
grep -n "CREATE TABLE IF NOT EXISTS public.fx_daily" migrations/0034_fx_daily.sql    # 1 line
grep -n "GRANT SELECT ON TABLE public.fx_daily TO anon, authenticated" migrations/0034_fx_daily.sql   # 1 line
# Which files define export_my_data in full. Record the list for the PR. Expect 0011 and 0024,
# plus 0038 (WP34) and 0039 (WP35) if they merged. Step 1d is the same whatever this prints.
grep -ln "FUNCTION public.export_my_data" migrations/*.sql
# The anchors step 1d patches must exist in the newest full definition. Expect 3 lines from that file.
F=$(grep -ln "FUNCTION public.export_my_data" migrations/*.sql | sort | tail -1)
grep -n "'notes', h.notes,\|'notes', l.notes,\|'name', p.name," "$F"

cd frontend
# WP05
grep -n "const HOLDING_SELECT\|async function loadGuardedProducts\|async function guardHoldings\|export async function getOrCreatePortfolio\|export async function findPortfolioId" app/lib/server/portfolioRepo.ts   # 5 lines
grep -n "export function parseNewHolding\|export function parseHoldingUpdate\|export function describeWriteError\|export type Parsed" app/lib/portfolioInput.ts   # 4 lines
grep -n "export class PortfolioApiError\|async function readErrorMessage\|const JSON_HEADERS\|const NETWORK_ERROR" app/lib/portfolioApi.ts   # 4 lines
grep -n "function importErrorMessage" app/lib/server/portfolioRepo.ts                 # 1 line
grep -n "export async function requireRouteUser\|export function jsonNoStore" app/lib/routeAuth.ts   # 2 lines
ls app/api/portfolio/route.ts app/api/portfolio/holdings/route.ts "app/api/portfolio/holdings/[id]/route.ts" app/api/portfolio/import/route.ts
# WP10
ls app/api/portfolio/history/route.ts
# WP14 and WP15
grep -n "export default function Dialog" app/components/ui/Dialog.tsx                  # 1 line
grep -c "<Dialog" app/components/Portfolio/cards/AddHoldingModal.tsx app/components/Portfolio/cards/EditHoldingModal.tsx   # 1 each
grep -n "ConfirmDialog" app/components/Portfolio/PortfolioDashboard.tsx | head -1      # 1 line
# WP17
grep -n "export function PortfolioTooltip" app/components/charts/PortfolioChartImpl.tsx   # 1 line
ls app/components/charts/__tests__/chartTooltips.test.tsx
# WP18 and WP11
grep -n "export function compareSortValues\|export type SortValue" app/lib/sorting.ts    # 2 lines
grep -n "export interface SortableColumn\|export type SortState" app/components/SortableTable/SortableTable.tsx   # 2 lines
ls app/components/IntentLink.tsx
# WP20
ls app/types/portfolio.ts app/types/database.ts
grep -n "export function useCurrency" app/context/CurrencyContext.tsx                   # 1 line
grep -n "useCurrency()" app/components/Portfolio/PortfolioDashboard.tsx                 # 1 line
grep -n '"types:db"' package.json                                                       # 1 line
# WP22
grep -n '"/portfolio": {' perf-budgets.json                                             # 1 or 2 lines
# WP23
ls app/components/ui/Stat.tsx app/components/ui/Delta.tsx app/components/ui/Badge.tsx app/components/ui/SegmentedControl.tsx \
   app/components/ui/DataList.tsx app/components/ui/Skeleton.tsx app/components/ui/Button.tsx app/components/ui/AsOf.tsx \
   app/components/ui/icons.tsx test-utils/axe.ts app/__tests__/uiConventions.baseline.json
grep -n "export function formatSignedPercent\|export function formatPercent\|export function formatMoney\|export function formatMonthDay\|export function formatDateOnly" app/lib/format.ts   # 5 lines
# WP24
grep -n "export function metricHref\|export type MetricKey" app/lib/metricDefinitions.ts   # 2 lines
ls app/components/ui/MetricLabel.tsx app/methodology/MethodologyArticle.tsx
grep -n 'anchor: "index"' app/content/methodology.ts                                   # 1 line
# WP25
grep -n "export async function getCachedFxDaily\|export async function getCachedProductStats" app/lib/serverMarketData.ts   # 2 lines
grep -n "export function rateOn\|export function sliceFxSeries\|export function usdToCadOn\|export const FX_CARRY_MAX_DAYS\|export const EMPTY_FX_SERIES" app/lib/fx.ts   # 5 lines
grep -n "export function statsFor\|export interface ProductStatsSnapshot" app/lib/marketStats.ts   # 2 lines
grep -n "WP31 and WP36 remove this bullet" app/methodology/MethodologyArticle.tsx       # 1 line (step 22d handles 0)
# WP29
grep -n "export async function getCachedIndexSeries" app/lib/serverMarketData.ts        # 1 line
grep -n "export const HEADLINE_INDEX_CODE\|export const HEADLINE_INDEX_NAME" app/lib/marketIndex.ts   # 2 lines

# Soft: WP31. Record the answer; steps 12 and 21 branch on it.
grep -n "initialProductId" app/components/Portfolio/cards/AddHoldingModal.tsx | head -1   # WP31 landed: 1 line
# Soft: WP34. Record it; nothing here edits app/portfolio/page.tsx.
ls app/components/Portfolio/PortfolioTabs.tsx 2>/dev/null
# Soft: product page dated FX (decides step 22d). Record whether this prints anything.
grep -rln "convertDailySeries\|toCadAtDatedRates\|usdToCadOn" "app/product/[id]" 2>/dev/null
```

Tooling:
- Local Postgres for the replay and the database tests (WP21): Docker `postgres:17`, or the PostgreSQL 16 binaries at `/usr/lib/postgresql/16/bin`. Every SQL statement in step 1 was applied twice to PostgreSQL 16.13 while this spec was written, on a scaffold with 0024's `export_my_data`, WP21's row-cap trigger and WP25's `fx_daily`; the 14 cases of `tests/test_wp36_portfolio_currency_db.py` passed there (the carry case was added in review and re-run there), and step 1d was also checked after 0038's body (`watchlist` kept) and in the order 0040, 0038, 0040 (keys restored).
- The analytics builder, chart model, input parsing and sample portfolio were compiled with the repo's TypeScript (`--strict`) against the WP05, WP20, WP23, WP25 and WP29 code those specs give, and their arithmetic was checked numerically; the expected numbers in Tests come from that run. The React components were type-checked against Recharts 3 and the WP18, WP23 and WP24 components.
- A Python venv with `requirements.txt` plus `pytest` (WP21 added `psycopg[binary]`).

Baseline (from `frontend/`): `pnpm exec tsc --noEmit` (exit 0), `pnpm lint` (0 errors), `pnpm test --ci` (all pass; record the suite and test counts), `pnpm run test:scripts` (all pass). From the repo root: `python -m pytest tests/ -q` (record). Note the `/portfolio` row of `pnpm perf:budget` from the latest master CI job summary (or measure it with Verification block 4 on a clean checkout).

Line numbers in this spec are hints. Find every edit point by the quoted code or the named function.

Two phases, like WP25 and WP34. **Phase A** (steps 1 to 23): open a draft PR titled `[waiting for DB types] WP36: Portfolio analytics` and hand the owner Owner actions 1 and 2. Until phase B, `tsc` may report errors only where a query names the new columns (`HOLDING_SELECT`, `.select("id, exit_fee_pct")`, `.update({ exit_fee_pct })`, `.select("exit_fee_pct")` in `portfolioRepo.ts`, and the insert of `purchase_currency`/`purchase_price_native` rows); that is expected and the only allowed failure. **Phase B** (step 24): regenerate `app/types/database.ts` once 0040 is in production, then finish the PR.

## Implementation steps

Order: step 1 (migration) and its tests first, then the pure modules (steps 2 to 7), the server (8 and 9), the browser client and write flows (10 to 13), the UI (14 to 21), methodology and docs (22, 23). Write each step's tests (see Tests) alongside it. Phase B is step 24.

### Step 1. `migrations/0040_portfolio_lot_currency.sql` (new, repo root)

Create the file with exactly this content:

```sql
-- Migration: purchase currency on portfolio holdings and lots, and an exit
-- fee per portfolio (WP36; research/data-opportunities.md section 3.14,
-- research/competitive-landscape.md section 4 item 5).
--
-- 1. portfolio_holdings and portfolio_lots gain
--      purchase_currency      'USD' or 'CAD', default 'USD'
--      purchase_price_native  the per-unit price in that currency, exactly
--                             as entered (numeric, so 129.99 stays 129.99)
--    purchase_price_usd stays the canonical column: every value, P/L,
--    get_portfolio_history (0029) and the app read it. For a CAD row it is
--    computed HERE, from purchase_price_native / the Bank of Canada rate of
--    purchase_date (fx_daily, 0034), by trigger *_purchase_currency_trg:
--      USD row  purchase_price_native := purchase_price_usd (the USD price
--               wins; a native value sent for a USD row is ignored).
--      CAD row  purchase_price_native is required. The rate is the fx_daily
--               row with the newest day <= purchase_date, used only when
--               purchase_date - source_date <= 14 (FX_CARRY_MAX_DAYS in
--               frontend/app/lib/fx.ts, counted from the Bank of Canada
--               date as rateOn() counts it). purchase_price_usd :=
--               round(native / rate, 6). No usable rate: SQLSTATE PF001,
--               which the routes answer with HTTP 400.
--               An UPDATE that changes neither the currency, the native
--               price nor the date keeps the stored USD value, so an
--               unchanged edit round-trips exactly even if fx_daily later
--               revises a carried-forward day.
--    A client may send any number in purchase_price_usd for a CAD row (the
--    routes send the native price as a placeholder because the column is
--    NOT NULL); it is always overwritten before the row is stored.
-- 2. portfolios gain exit_fee_pct, default 15, 0 to 50: the selling cost the
--    "exit value" figure assumes (EXIT_FEE_DEFAULT_PCT, EXIT_FEE_MIN_PCT and
--    EXIT_FEE_MAX_PCT in frontend/app/lib/portfolioExit.ts; drift-tested).
-- 3. Existing rows are USD: purchase_price_native := purchase_price_usd.
-- 4. export_my_data() gains the new columns: purchase_currency and
--    purchase_price_native on every holding and lot, exit_fee_pct on every
--    portfolio. The function is patched in place from its live definition
--    (pg_get_functiondef), so every key a later migration added
--    (watchlist, 0038; price alerts, 0039) is kept whatever order the
--    migrations reach production in. The block raises if the expected
--    anchors are missing, and does nothing when the keys are already there.
--    A migration numbered below 0040 that replaces export_my_data AFTER this
--    file was applied in production drops the keys again: re-run this file
--    afterwards (it is idempotent). Any later migration that replaces
--    export_my_data must keep the three keys.
--
-- Idempotent: safe to run twice (WP21 replay_twice).
--
-- Verification (after apply):
--   SELECT column_name, data_type, column_default FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND column_name IN ('purchase_currency', 'purchase_price_native', 'exit_fee_pct')
--    ORDER BY table_name, column_name;
--   -- 5 rows: portfolio_holdings x2, portfolio_lots x2, portfolios x1
--   SELECT count(*) FROM public.portfolio_holdings WHERE purchase_price_native IS NULL;  -- 0
--   SELECT tgname FROM pg_trigger WHERE tgname LIKE '%purchase_currency_trg';            -- 2 rows
--   SELECT position('purchase_currency' IN pg_get_functiondef('public.export_my_data()'::regprocedure)) > 0;  -- true

-- ============================================================
-- 1. Columns and constraints
-- ============================================================

ALTER TABLE public.portfolio_holdings
  ADD COLUMN IF NOT EXISTS purchase_currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS purchase_price_native numeric;

ALTER TABLE public.portfolio_lots
  ADD COLUMN IF NOT EXISTS purchase_currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS purchase_price_native numeric;

ALTER TABLE public.portfolios
  ADD COLUMN IF NOT EXISTS exit_fee_pct numeric NOT NULL DEFAULT 15;

DO $$ BEGIN
  ALTER TABLE public.portfolio_holdings
    ADD CONSTRAINT portfolio_holdings_purchase_currency_valid
    CHECK (purchase_currency IN ('USD', 'CAD'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.portfolio_holdings
    ADD CONSTRAINT portfolio_holdings_native_price_sane
    CHECK (purchase_price_native IS NULL OR purchase_price_native BETWEEN 0 AND 1000000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.portfolio_holdings
    ADD CONSTRAINT portfolio_holdings_cad_has_native
    CHECK (purchase_currency = 'USD' OR purchase_price_native IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.portfolio_lots
    ADD CONSTRAINT portfolio_lots_purchase_currency_valid
    CHECK (purchase_currency IN ('USD', 'CAD'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.portfolio_lots
    ADD CONSTRAINT portfolio_lots_native_price_sane
    CHECK (purchase_price_native IS NULL OR purchase_price_native BETWEEN 0 AND 1000000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.portfolio_lots
    ADD CONSTRAINT portfolio_lots_cad_has_native
    CHECK (purchase_currency = 'USD' OR purchase_price_native IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.portfolios
    ADD CONSTRAINT portfolios_exit_fee_pct_range
    CHECK (exit_fee_pct BETWEEN 0 AND 50);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. Backfill (before the triggers exist; a re-run matches no rows)
-- ============================================================

UPDATE public.portfolio_holdings
   SET purchase_price_native = purchase_price_usd::numeric
 WHERE purchase_price_native IS NULL AND purchase_currency = 'USD';

UPDATE public.portfolio_lots
   SET purchase_price_native = purchase_price_usd::numeric
 WHERE purchase_price_native IS NULL AND purchase_currency = 'USD';

-- ============================================================
-- 3. The conversion trigger (holdings and lots)
-- ============================================================

CREATE OR REPLACE FUNCTION public.apply_purchase_currency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rate double precision;
  v_source_date date;
BEGIN
  IF NEW.purchase_currency = 'USD' THEN
    -- The USD price is canonical for a USD row.
    NEW.purchase_price_native := NEW.purchase_price_usd::numeric;
    RETURN NEW;
  END IF;

  IF NEW.purchase_price_native IS NULL THEN
    RAISE EXCEPTION 'purchase_price_native is required when purchase_currency is CAD'
      USING ERRCODE = 'check_violation';
  END IF;

  -- An edit that leaves the CAD price and the date alone keeps the stored
  -- conversion (exact round trip).
  IF TG_OP = 'UPDATE'
     AND OLD.purchase_currency = 'CAD'
     AND NEW.purchase_price_native = OLD.purchase_price_native
     AND NEW.purchase_date = OLD.purchase_date THEN
    NEW.purchase_price_usd := OLD.purchase_price_usd;
    RETURN NEW;
  END IF;

  SELECT f.usd_to_cad, f.source_date
    INTO v_rate, v_source_date
    FROM public.fx_daily f
   WHERE f.day <= NEW.purchase_date
   ORDER BY f.day DESC
   LIMIT 1;

  -- 14 = FX_CARRY_MAX_DAYS (frontend/app/lib/fx.ts). The carry is counted
  -- from the Bank of Canada date behind the row (source_date), exactly as
  -- refresh_fx_daily (0034) and rateOn() count it, never from a row that is
  -- itself carried: a date in a gap or after the series ends gets no rate.
  IF v_rate IS NULL OR NEW.purchase_date - v_source_date > 14 THEN
    RAISE EXCEPTION 'no Bank of Canada rate for %', NEW.purchase_date
      USING ERRCODE = 'PF001',
            HINT = 'Enter the price in USD, or pick a purchase date that has a Bank of Canada rate.';
  END IF;

  NEW.purchase_price_usd := round(NEW.purchase_price_native / v_rate::numeric, 6)::double precision;
  RETURN NEW;
END
$$;

-- Trigger-only helper: not callable over PostgREST (same rule as 0031).
REVOKE ALL ON FUNCTION public.apply_purchase_currency() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS portfolio_holdings_purchase_currency_trg ON public.portfolio_holdings;
CREATE TRIGGER portfolio_holdings_purchase_currency_trg
  BEFORE INSERT OR UPDATE ON public.portfolio_holdings
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_purchase_currency();

DROP TRIGGER IF EXISTS portfolio_lots_purchase_currency_trg ON public.portfolio_lots;
CREATE TRIGGER portfolio_lots_purchase_currency_trg
  BEFORE INSERT OR UPDATE ON public.portfolio_lots
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_purchase_currency();

-- ============================================================
-- 4. export_my_data(): add the new columns, keep every other key
-- ============================================================

DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.export_my_data()'::regprocedure);
  v_new text;
BEGIN
  IF position('''purchase_currency''' IN v_def) > 0 THEN
    RETURN; -- already patched: a re-run, or a later migration kept the keys
  END IF;

  v_new := replace(v_def,
    $k$'notes', h.notes,$k$,
    $k$'notes', h.notes, 'purchase_currency', h.purchase_currency, 'purchase_price_native', h.purchase_price_native,$k$);
  v_new := replace(v_new,
    $k$'notes', l.notes,$k$,
    $k$'notes', l.notes, 'purchase_currency', l.purchase_currency, 'purchase_price_native', l.purchase_price_native,$k$);
  v_new := replace(v_new,
    $k$'name', p.name,$k$,
    $k$'name', p.name, 'exit_fee_pct', p.exit_fee_pct,$k$);

  -- Each anchor must have matched exactly once.
  IF (length(v_new) - length(replace(v_new, '''purchase_currency''', ''))) / length('''purchase_currency''') <> 2
     OR (length(v_new) - length(replace(v_new, '''exit_fee_pct''', ''))) / length('''exit_fee_pct''') <> 1 THEN
    RAISE EXCEPTION '0040: export_my_data() does not contain the expected holdings, lots and portfolios objects; patch it by hand (WP36)';
  END IF;

  EXECUTE v_new;
END
$patch$;
```

Why each part is shaped this way:

- **1a. Columns.** `purchase_price_native` is `numeric` with no scale, so a price arrives from JSON as `129.99` and comes back as `129.99` (exact round trip). `purchase_currency` is `NOT NULL DEFAULT 'USD'`, so every existing row and every pre-WP36 insert is a USD row. All constraints are in `DO` blocks that ignore `duplicate_object`, so the file is re-runnable (`replay_twice`).
- **1b. Backfill before the triggers.** On the first run it copies `purchase_price_usd` into `purchase_price_native` for every row; on a re-run it matches nothing. `double precision` to `numeric` keeps 15 significant digits (`33.333333333333336` becomes `33.3333333333333`); for a USD row `purchase_price_usd` stays the figure the app reads, so nothing changes for the user.
- **1c. Trigger.** `apply_purchase_currency()` is SECURITY INVOKER and reads `fx_daily` as the writing user (`authenticated` has SELECT through WP25's `fx_daily_read` policy). It fires on every insert and update of either table, so the add route, the edit route, the bulk import and a direct PostgREST call all store the same value. `PF001` is a custom SQLSTATE; supabase-js exposes it as `error.code`, which step 7 maps to HTTP 400. The 14-day carry is measured from the row's `source_date` (the Bank of Canada date), not from the row's `day`: a date inside a gap of more than 14 days, or more than 14 days after the newest Bank of Canada date, finds a carried row whose own `day` may be recent, and comparing against `day` would accept a rate up to 28 days old. `rateOn()` in `fx.ts` and `refresh_fx_daily` both count from the Bank of Canada date, so the database, the analytics and the chart agree on which days have a rate (Tests 1 `test_carry_counts_from_the_boc_date`). EXECUTE is revoked from every API role, as WP21 did for `enforce_owner_row_cap()`; triggers still fire. Alphabetical trigger order puts `portfolio_holdings_purchase_currency_trg` before WP21's `portfolio_holdings_row_cap_trg`; they do not interact.
- **1d. `export_my_data()` patched in place.** The function is redefined from its live definition (`pg_get_functiondef`) with three `replace()` calls, each anchored on a line every full definition since 0011 contains (`'notes', h.notes,`, `'notes', l.notes,`, `'name', p.name,`). A full `CREATE OR REPLACE FUNCTION public.export_my_data()` in this file would be wrong in two ways: if 0038 (WP34) or 0039 (WP35) is already applied, it would drop their keys; and WP34's "which files define export_my_data" check would find a third definition with no body to copy. The patch keeps every key, raises if an anchor is missing, and does nothing when the keys are already there. `CREATE OR REPLACE` through `EXECUTE` keeps the owner, the ACL (EXECUTE for `authenticated` and `service_role` only) and VOLATILE (pg_get_functiondef omits it because it is the default). The file deliberately never contains the text `FUNCTION public.export_my_data`: `tests/test_wp36_portfolio_currency_static.py` enforces it.
- **1e. Merge order.** If WP34 or WP35 merges after this package, their own instructions copy the newest full definition of `export_my_data` (0024's or 0038's body), which lacks the new keys. In a replayed database 0038 and 0039 run before 0040, so the replay is always right. In production the owner applies them after 0040, so Owner action 5 re-runs 0040 after any such migration (it is idempotent and only re-adds the keys). The static test also fails any future migration numbered above 0040 that redefines the function without the keys.

1f. Check the file. `verify_migration.py` sees one function, three revokes, and leaves the rest to the header queries:

```bash
python3 verify_migration.py migrations/0040_portfolio_lot_currency.sql > /tmp/wp36_0040.sql; echo "exit=$?"
# expect exit=3 and on stderr exactly:
#   -- function apply_purchase_currency(): body <md5>, non-strict, parallel u, security invoker, plpgsql, volatility v, config search_path=public,pg_temp
#   -- privilege EXECUTE on public.apply_purchase_currency() for public: revoked
#   -- privilege EXECUTE on public.apply_purchase_currency() for anon: revoked
#   -- privilege EXECUTE on public.apply_purchase_currency() for authenticated: revoked
#   -- NOT VERIFIED (out of scope, check by hand): 3 x ALTER TABLE (other than RLS enablement), 2 x CREATE TRIGGER, 8 x DO block, 2 x DROP object, 2 x data statement
#   -- run the statement below; every row must say OK
# With the file copied verbatim the body hash is f05a29233e0b66bb02a8b96bfa08f123.
grep -c "FUNCTION public.export_my_data" migrations/0040_portfolio_lot_currency.sql   # 0
```

1g. Replay (WP21): `PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh` (use your local server's URL); the last line is `OK: <N> files replayed once (replay_once) and twice (replay_twice)` with N one more than on master.

### Step 2. `app/types/portfolio.ts`: currency, native price and the exit fee

2a. In `interface Portfolio`, after `name: string;`, add:

```ts
  /** Selling cost the exit value assumes, percent (migration 0040). Absent in pre-0040 fixtures. */
  exit_fee_pct?: number;
```

2b. Directly below `interface Portfolio`, add:

```ts
/** The currency a lot was paid in (migration 0040). */
export type PurchaseCurrency = "USD" | "CAD";
```

2c. In `interface Holding`, after `notes: string | null;`, add:

```ts
  /** Migration 0040. Absent (read it as "USD") in fixtures written before it. */
  purchase_currency?: PurchaseCurrency;
  /** Per-unit price as entered, in purchase_currency. For a USD row it mirrors purchase_price_usd. */
  purchase_price_native?: number | null;
```

Optional on purpose: dozens of existing test fixtures build `Holding` objects without them, and the analytics treat a missing currency as USD. `PortfolioLot` is not read by the app; leave it.

2d. Replace WP05's `NewHoldingInput` and the `UpdateHolding` interface with:

```ts
// Body of POST /api/portfolio/holdings and one row of POST /api/portfolio/import.
// No portfolio_id: the server resolves the caller's portfolio from the session.
export interface NewHoldingInput {
  product_id: number;
  quantity: number;
  /**
   * USD row: the price. CAD row: a placeholder (the native price) because the
   * column is NOT NULL; migration 0040's trigger replaces it with the native
   * price / the Bank of Canada rate of purchase_date.
   */
  purchase_price_usd: number;
  purchase_date: string;
  notes: string | null;
  // Minted by the CALLER once per distinct submission and reused on retry, so
  // a retried request dedupes on portfolio_holdings_idem_uidx (migration 0003).
  client_idempotency_key: string;
  /** WP36. parseNewHolding always sets both; optional so pre-WP36 fixtures still type-check. */
  purchase_currency?: PurchaseCurrency;
  purchase_price_native?: number;
}

// Holding update data
export interface UpdateHolding {
  quantity?: number;
  purchase_price_usd?: number;
  purchase_date?: string;
  notes?: string | null;
  /** WP36: always sent together with purchase_price_native. */
  purchase_currency?: PurchaseCurrency;
  purchase_price_native?: number;
}
```

If WP05's `NewHoldingInput` comment differs from the one above, keep WP05's comment for the four fields it had and add only the new lines.

### Step 3. `app/types/portfolioAnalytics.ts` (new)

```ts
// Portfolio analytics (WP36): the shape GET /api/portfolio/analytics returns
// and the sample portfolio renders. Built by lib/portfolioAnalytics.ts.
// Amounts are totals for the row (quantity included) unless the name says
// "unit". USD amounts are the canonical figures; CAD amounts use the Bank of
// Canada rate of the day they describe (fx_daily, migration 0034).
import type { FxDailySeries } from "../lib/fx";
import type { ExitBand } from "../lib/portfolioExit";
import type { PurchaseCurrency } from "./portfolio";

export type BenchmarkLotStatus = "covered" | "no_price" | "before_index" | "index_unavailable";

export interface LotAnalytics {
  holdingId: number;
  productId: number;
  quantity: number;
  purchaseDate: string;
  purchaseCurrency: PurchaseCurrency;
  /** Per-unit price as entered, in purchaseCurrency. */
  unitPriceNative: number;
  costNative: number;
  costUsd: number;
  /** null for a USD lot whose purchase date has no Bank of Canada rate. */
  costCad: number | null;
  /** USD to CAD on the purchase date. CAD lot: the rate the database used (native / USD). */
  fxAtPurchase: number | null;
  /** Guarded Market Price per unit; null when withheld (migration 0023). */
  priceUsd: number | null;
  /** The TCGplayer day priceUsd describes (also set when the price is withheld: "last priced"). */
  priceDay: string | null;
  valueUsd: number | null;
  valueCad: number | null;
  plUsd: number | null;
  plPctUsd: number | null;
  plCad: number | null;
  plPctCad: number | null;
  /** CAD P/L split: the USD gain at the purchase-date rate ... */
  plCadMarket: number | null;
  /** ... plus the value's move from the purchase-date rate to today's. Sum = plCad. */
  plCadFx: number | null;
  /** P/L in the purchase currency. */
  plNative: number | null;
  /** This lot's P/L as percentage points of the portfolio's priced cost (sums to the total return). */
  contributionPctUsd: number | null;
  contributionPctCad: number | null;
  exitValueUsd: number | null;
  /** Every unit of this product you hold, across lots. Days to exit uses it. */
  productQuantity: number;
  unitsSold30d: number | null;
  daysToExit: number | null;
  exitBand: ExitBand;
  /** This lot's cost invested in the Sealed Index on its purchase date, valued at the index's last day. */
  benchmarkUsd: number | null;
  benchmarkStatus: BenchmarkLotStatus;
}

/** Totals over the lots that can be compared in one currency. */
export interface CurrencyTotals {
  /** Lots counted: priced lots (USD), or priced lots with a CAD cost basis (CAD). */
  lots: number;
  cost: number;
  /** null when `lots` is 0. */
  value: number | null;
  pl: number | null;
  plPct: number | null;
}

export interface PortfolioTotals {
  holdings: number;
  /** Lots with a current (guarded) price. */
  priced: number;
  units: number;
  /** Cost of every lot, priced or not. */
  costUsdAll: number;
  /** Market value of the priced lots. null when lots exist but none is priced. */
  valueUsd: number | null;
  /** valueUsd at today's Bank of Canada rate. */
  valueCad: number | null;
  usd: CurrencyTotals;
  cad: CurrencyTotals & { market: number | null; fx: number | null };
  dayChangeUsd: number | null;
  dayChangePct: number | null;
  dayChangeCovered: number;
}

export interface BenchmarkFigures {
  /** Cost of the compared lots. */
  cost: number;
  /** Their market value now. */
  value: number;
  /** The same money in the index. */
  benchmark: number;
  /** value - benchmark. */
  delta: number;
  returnPct: number | null;
  benchmarkReturnPct: number | null;
  /** returnPct - benchmarkReturnPct, percentage points. */
  deltaPts: number | null;
}

export interface BenchmarkComparison {
  status: "ok" | "unavailable";
  reason: null | "index_unavailable" | "index_stale" | "no_covered_lots";
  indexCode: string;
  indexName: string;
  /** The UTC day of the index level used (D-1 at best). */
  indexDay: string | null;
  firstIndexDay: string | null;
  coveredLots: number;
  pricedLots: number;
  beforeIndexLots: number;
  usd: BenchmarkFigures | null;
  /** null when a compared lot has no CAD cost basis or there is no rate for today. */
  cad: BenchmarkFigures | null;
}

/** usd[i] is the same-money index value on start + i days (USD); null where it cannot be computed. */
export interface BenchmarkSeries {
  start: string;
  usd: (number | null)[];
}

export interface AllocationGroup {
  key: string;
  name: string;
  valueUsd: number;
  /** Percent of the priced value, unrounded. */
  sharePct: number;
  lots: number;
}

export interface PortfolioAllocation {
  set: AllocationGroup[];
  type: AllocationGroup[];
  era: AllocationGroup[];
  pricedValueUsd: number;
  unpricedLots: number;
}

export interface ConcentrationFlag {
  kind: "product" | "set";
  key: string;
  name: string;
  sharePct: number;
}

export interface PortfolioAnalytics {
  version: 1;
  /** UTC day the analytics were computed for. */
  today: string;
  exitFeePct: number;
  /** product_daily_stats day behind the 1D change and the sales figures. */
  statsDay: string | null;
  fxNow: number | null;
  fxSourceDate: string | null;
  totals: PortfolioTotals;
  benchmark: BenchmarkComparison;
  benchmarkSeries: BenchmarkSeries | null;
  allocation: PortfolioAllocation;
  concentration: ConcentrationFlag[];
  lots: LotAnalytics[];
  /** fx_daily from today - 400 days, for the chart's CAD conversion. */
  fx: FxDailySeries;
}
```

### Step 4. `app/lib/portfolioExit.ts` (new)

Tiny and import-free: client components import it without pulling the builder.

```ts
/**
 * Exit costs, exit liquidity and concentration rules for the portfolio
 * (WP36). Import-free and tiny, so client components can use it without
 * pulling in the analytics builder (lib/portfolioAnalytics.ts).
 *
 * EXIT_FEE_DEFAULT_PCT, EXIT_FEE_MIN_PCT and EXIT_FEE_MAX_PCT mirror
 * portfolios.exit_fee_pct in migrations/0040_portfolio_lot_currency.sql
 * (tests/test_wp36_portfolio_currency_static.py checks them). /methodology
 * prints every constant here; a change bumps METHODOLOGY_VERSION.
 */

/** Selling cost assumed when the user has not set one: TCGplayer or eBay fees, payment and shipping. */
export const EXIT_FEE_DEFAULT_PCT = 15;
export const EXIT_FEE_MIN_PCT = 0;
export const EXIT_FEE_MAX_PCT = 50;

/** A fee the user may store: a finite number in [0, 50], rounded to 1 decimal. Otherwise null. */
export function normaliseExitFeePct(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < EXIT_FEE_MIN_PCT || value > EXIT_FEE_MAX_PCT) return null;
  return Math.round(value * 10) / 10;
}

/** What a market value nets after the selling fee. null in, null out. */
export function exitValueAfterFees(marketValue: number | null | undefined, feePct: number): number | null {
  if (marketValue === null || marketValue === undefined || !Number.isFinite(marketValue)) return null;
  return marketValue * (1 - feePct / 100);
}

export type ExitBand = "under_1w" | "1_4w" | "over_1m" | "unknown";

export const EXIT_BAND_LABELS: Readonly<Record<ExitBand, string>> = {
  under_1w: "Under 1 week",
  "1_4w": "1 to 4 weeks",
  over_1m: "Over 1 month",
  unknown: "Unknown",
};

/** Sort order, fastest exit first; unknown last. */
export const EXIT_BAND_ORDER: Readonly<Record<ExitBand, number>> = {
  under_1w: 0,
  "1_4w": 1,
  over_1m: 2,
  unknown: 3,
};

/** Band edges in days: under 7 is "Under 1 week", 7 to 30 is "1 to 4 weeks", over 30 is "Over 1 month". */
export const EXIT_BAND_WEEK_DAYS = 7;
export const EXIT_BAND_MONTH_DAYS = 30;
/** units_sold_30d covers 30 days. */
export const SALES_WINDOW_DAYS = 30;

/**
 * Days to exit = quantity / (units sold in 30 days / 30): how many days of the
 * product's recent TCGplayer sales your units equal. unitsSold30d is WP25's
 * gated figure (null when the sales data is stale or has holes): "unknown".
 * Zero sales in 30 days: no finite estimate, band "over_1m".
 */
export function daysToExit(
  quantity: number,
  unitsSold30d: number | null | undefined
): { days: number | null; band: ExitBand } {
  if (
    unitsSold30d === null ||
    unitsSold30d === undefined ||
    !Number.isFinite(unitsSold30d) ||
    unitsSold30d < 0 ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return { days: null, band: "unknown" };
  }
  if (unitsSold30d === 0) return { days: null, band: "over_1m" };
  const days = quantity / (unitsSold30d / SALES_WINDOW_DAYS);
  const band: ExitBand =
    days < EXIT_BAND_WEEK_DAYS ? "under_1w" : days <= EXIT_BAND_MONTH_DAYS ? "1_4w" : "over_1m";
  return { days, band };
}

/** A product or a set holding more than this share of the priced value is flagged. */
export const CONCENTRATION_THRESHOLD_PCT = 40;
```

### Step 5. `app/lib/portfolioAnalytics.ts` (new): the builder

Pure: no React, no Supabase, no `format.ts`. The route runs it on the server; the sample portfolio runs it in the browser from a lazy chunk.

```ts
/**
 * Portfolio analytics (WP36): unrealised P/L in USD and in CAD at dated
 * rates, the money-matched Sealed Index benchmark, exit value after fees,
 * days to exit, allocation and concentration.
 *
 * Pure and isomorphic: GET /api/portfolio/analytics runs it on the server,
 * and the sample portfolio runs it in the browser (lazy chunk). Inputs are
 * already guarded: a holding whose price is withheld (migration 0023) has
 * products.usd_price null, and nothing here ever substitutes a value for it.
 * /methodology#portfolio documents every formula; a change bumps
 * METHODOLOGY_VERSION.
 */
import type { HoldingWithProduct, PurchaseCurrency } from "../types/portfolio";
import type {
  AllocationGroup,
  BenchmarkComparison,
  BenchmarkFigures,
  BenchmarkLotStatus,
  BenchmarkSeries,
  ConcentrationFlag,
  LotAnalytics,
  PortfolioAllocation,
  PortfolioAnalytics,
} from "../types/portfolioAnalytics";
import { EMPTY_FX_SERIES, rateOn, sliceFxSeries, type FxDailySeries } from "./fx";
import { statsFor, type ProductStatsSnapshot } from "./marketStats";
import { CONCENTRATION_THRESHOLD_PCT, daysToExit, exitValueAfterFees } from "./portfolioExit";

/** An index level counts for a day when it is at most this many days older (weekly history has Monday points). */
export const INDEX_LEVEL_MAX_GAP_DAYS = 7;
/** The benchmark is withheld when the index's last published day is older than this. */
export const INDEX_STALE_AFTER_DAYS = 7;
/** The benchmark series covers today - 365 through today (the longest chart range). */
export const BENCHMARK_SERIES_DAYS = 365;
/** The FX series sent to the browser starts this many days back. */
export const FX_SLICE_DAYS = 400;

const DAY_MS = 86_400_000;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})/;

function dayNumber(key: string | null | undefined): number | null {
  if (!key) return null;
  const m = DATE_KEY.exec(key);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? Math.round(ms / DAY_MS) : null;
}

function dateKey(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

/** One index level: the day and the level. WP29's IndexPoint satisfies it. */
export interface IndexLevelPoint {
  day: string;
  level: number;
}

export interface IndexInput {
  code: string;
  name: string;
  /** Oldest first or any order. [] when nothing is published; null when the read failed. */
  points: readonly IndexLevelPoint[] | null;
}

interface LevelLookup {
  firstDay: number;
  lastDay: number;
  lastLevel: number;
  /** Level of the newest point on or before `day`, at most INDEX_LEVEL_MAX_GAP_DAYS older; else null. */
  levelOn(day: number): number | null;
}

export function buildLevelLookup(points: readonly IndexLevelPoint[]): LevelLookup | null {
  const rows = points
    .map((p) => ({ n: dayNumber(p.day), level: p.level }))
    .filter((r): r is { n: number; level: number } => r.n !== null && finite(r.level) && r.level > 0)
    .sort((a, b) => a.n - b.n);
  if (rows.length === 0) return null;
  const days = rows.map((r) => r.n);
  const levels = rows.map((r) => r.level);
  return {
    firstDay: days[0],
    lastDay: days[days.length - 1],
    lastLevel: levels[levels.length - 1],
    levelOn(day: number) {
      let lo = 0;
      let hi = days.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (days[mid] <= day) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (found < 0 || day - days[found] > INDEX_LEVEL_MAX_GAP_DAYS) return null;
      return levels[found];
    },
  };
}

/** "Evolving Skies Booster Box (Pokémon Center)": the parts the holdings list shows. */
export function holdingLabel(holding: HoldingWithProduct): string {
  const product = holding.products;
  const setName = product?.sets?.name || "Unknown set";
  const type = product?.product_types?.label || product?.product_types?.name || "";
  const variant = product?.variant ? ` (${product.variant})` : "";
  return `${setName}${type ? ` ${type}` : ""}${variant}`;
}

function purchaseCurrencyOf(holding: HoldingWithProduct): PurchaseCurrency {
  return holding.purchase_currency === "CAD" ? "CAD" : "USD";
}

/**
 * 1-day change of the priced holdings: quantity x (price - price / (1 +
 * ret_1d)), only where WP25's stats row is fresh. The same rule as WP32's
 * summarizeHoldings, so the home strip and /portfolio agree.
 */
export function dayChange(
  holdings: readonly HoldingWithProduct[],
  stats: ProductStatsSnapshot
): { changeUsd: number | null; changePct: number | null; covered: number } {
  let change = 0;
  let base = 0;
  let covered = 0;
  for (const h of holdings) {
    if (!(h.quantity > 0) || !finite(h.products?.usd_price)) continue;
    const s = statsFor(stats, h.product_id);
    if (!s || !s.is_price_fresh || s.usd_price === null || s.ret_1d === null) continue;
    const previous = s.usd_price / (1 + s.ret_1d / 100);
    if (!Number.isFinite(previous) || previous <= 0) continue;
    change += h.quantity * (s.usd_price - previous);
    base += h.quantity * previous;
    covered += 1;
  }
  return {
    changeUsd: covered > 0 ? Math.round(change * 100) / 100 : null,
    changePct: covered > 0 && base > 0 ? Math.round((change / base) * 1000) / 10 : null,
    covered,
  };
}

export interface PortfolioAnalyticsInput {
  /** YYYY-MM-DD, UTC. */
  today: string;
  exitFeePct: number;
  /** Guarded holdings (WP05 portfolioRepo). */
  holdings: readonly HoldingWithProduct[];
  stats: ProductStatsSnapshot;
  fx: FxDailySeries;
  index: IndexInput;
}

function figures(cost: number, value: number, benchmark: number): BenchmarkFigures {
  const returnPct = pct(value - cost, cost);
  const benchmarkReturnPct = pct(benchmark - cost, cost);
  return {
    cost,
    value,
    benchmark,
    delta: value - benchmark,
    returnPct,
    benchmarkReturnPct,
    deltaPts: returnPct === null || benchmarkReturnPct === null ? null : returnPct - benchmarkReturnPct,
  };
}

function groupBy(
  lots: readonly { holding: HoldingWithProduct; valueUsd: number | null }[],
  keyOf: (h: HoldingWithProduct) => { key: string; name: string },
  total: number
): AllocationGroup[] {
  const map = new Map<string, AllocationGroup>();
  for (const { holding, valueUsd } of lots) {
    if (valueUsd === null) continue;
    const { key, name } = keyOf(holding);
    const group = map.get(key) ?? { key, name, valueUsd: 0, sharePct: 0, lots: 0 };
    group.valueUsd += valueUsd;
    group.lots += 1;
    map.set(key, group);
  }
  const groups = [...map.values()];
  for (const g of groups) g.sharePct = total > 0 ? (g.valueUsd / total) * 100 : 0;
  return groups.sort((a, b) => b.valueUsd - a.valueUsd || a.name.localeCompare(b.name));
}

export function buildPortfolioAnalytics(input: PortfolioAnalyticsInput): PortfolioAnalytics {
  const { today, exitFeePct, holdings, stats, fx, index } = input;
  const todayNum = dayNumber(today);
  if (todayNum === null) throw new Error(`buildPortfolioAnalytics: bad today ${today}`);

  const fxNow = rateOn(fx, today);
  const lookup = index.points ? buildLevelLookup(index.points) : null;
  const indexStale = lookup !== null && todayNum - lookup.lastDay > INDEX_STALE_AFTER_DAYS;
  const indexUsable = lookup !== null && !indexStale;

  // Units per product, for days to exit (lots of one product sell to the same buyers).
  const productQuantity = new Map<number, number>();
  for (const h of holdings) {
    productQuantity.set(h.product_id, (productQuantity.get(h.product_id) ?? 0) + h.quantity);
  }

  const lots: LotAnalytics[] = holdings.map((h) => {
    const currency = purchaseCurrencyOf(h);
    const usdUnit = h.purchase_price_usd;
    const nativeUnit = currency === "CAD" && finite(h.purchase_price_native) ? h.purchase_price_native : usdUnit;
    const costUsd = h.quantity * usdUnit;
    const costNative = h.quantity * nativeUnit;
    const fxAtPurchase =
      currency === "CAD" && usdUnit > 0 ? nativeUnit / usdUnit : rateOn(fx, h.purchase_date);
    const costCad = currency === "CAD" ? costNative : fxAtPurchase === null ? null : costUsd * fxAtPurchase;

    const row = statsFor(stats, h.product_id);
    const price = finite(h.products?.usd_price) ? (h.products.usd_price as number) : null;
    const recorded = h.products?.price_recorded_at;
    const priceDay = row?.price_day ?? (recorded && DATE_KEY.test(recorded) ? recorded.slice(0, 10) : null);

    const valueUsd = price === null ? null : h.quantity * price;
    const valueCad = valueUsd === null || fxNow === null ? null : valueUsd * fxNow;
    const plUsd = valueUsd === null ? null : valueUsd - costUsd;
    const plCad = valueCad === null || costCad === null ? null : valueCad - costCad;
    const plCadMarket = valueUsd === null || fxAtPurchase === null ? null : (valueUsd - costUsd) * fxAtPurchase;
    const plCadFx =
      valueUsd === null || fxAtPurchase === null || fxNow === null ? null : valueUsd * (fxNow - fxAtPurchase);

    const qtyAll = productQuantity.get(h.product_id) ?? h.quantity;
    const exit = daysToExit(qtyAll, row ? row.units_sold_30d : null);

    let benchmarkStatus: BenchmarkLotStatus;
    let benchmarkUsd: number | null = null;
    const purchaseNum = dayNumber(h.purchase_date);
    if (!indexUsable || lookup === null || purchaseNum === null) {
      benchmarkStatus = "index_unavailable";
    } else if (valueUsd === null) {
      benchmarkStatus = "no_price";
    } else {
      const atPurchase = lookup.levelOn(purchaseNum);
      if (atPurchase === null) {
        benchmarkStatus = purchaseNum < lookup.firstDay ? "before_index" : "index_unavailable";
      } else {
        benchmarkStatus = "covered";
        benchmarkUsd = (costUsd * lookup.lastLevel) / atPurchase;
      }
    }

    return {
      holdingId: h.id,
      productId: h.product_id,
      quantity: h.quantity,
      purchaseDate: h.purchase_date,
      purchaseCurrency: currency,
      unitPriceNative: nativeUnit,
      costNative,
      costUsd,
      costCad,
      fxAtPurchase,
      priceUsd: price,
      priceDay,
      valueUsd,
      valueCad,
      plUsd,
      plPctUsd: plUsd === null ? null : pct(plUsd, costUsd),
      plCad,
      plPctCad: plCad === null || costCad === null ? null : pct(plCad, costCad),
      plCadMarket,
      plCadFx,
      plNative: currency === "CAD" ? plCad : plUsd,
      contributionPctUsd: null,
      contributionPctCad: null,
      exitValueUsd: exitValueAfterFees(valueUsd, exitFeePct),
      productQuantity: qtyAll,
      unitsSold30d: row ? row.units_sold_30d : null,
      daysToExit: exit.days,
      exitBand: exit.band,
      benchmarkUsd,
      benchmarkStatus,
    };
  });

  // Totals.
  let units = 0;
  let costUsdAll = 0;
  let priced = 0;
  let usdCost = 0;
  let usdValue = 0;
  let cadLots = 0;
  let cadCost = 0;
  let cadValue = 0;
  let cadMarket = 0;
  let cadFx = 0;
  for (const lot of lots) {
    units += lot.quantity;
    costUsdAll += lot.costUsd;
    if (lot.valueUsd === null) continue;
    priced += 1;
    usdCost += lot.costUsd;
    usdValue += lot.valueUsd;
    if (lot.valueCad !== null && lot.costCad !== null && lot.plCadMarket !== null && lot.plCadFx !== null) {
      cadLots += 1;
      cadCost += lot.costCad;
      cadValue += lot.valueCad;
      cadMarket += lot.plCadMarket;
      cadFx += lot.plCadFx;
    }
  }
  for (const lot of lots) {
    if (lot.plUsd !== null) lot.contributionPctUsd = pct(lot.plUsd, usdCost);
    if (lot.plCad !== null && lot.valueCad !== null && lot.costCad !== null && lot.plCadMarket !== null && lot.plCadFx !== null) {
      lot.contributionPctCad = pct(lot.plCad, cadCost);
    }
  }
  const valueUsd = holdings.length > 0 && priced === 0 ? null : usdValue;
  const day = dayChange(holdings, stats);

  // Benchmark: the covered lots only (a current price and an index level on the purchase date).
  const covered = lots.filter((l) => l.benchmarkStatus === "covered");
  let benchmark: BenchmarkComparison = {
    status: "unavailable",
    reason: lookup === null ? "index_unavailable" : indexStale ? "index_stale" : "no_covered_lots",
    indexCode: index.code,
    indexName: index.name,
    indexDay: lookup ? dateKey(lookup.lastDay) : null,
    firstIndexDay: lookup ? dateKey(lookup.firstDay) : null,
    coveredLots: covered.length,
    pricedLots: priced,
    beforeIndexLots: lots.filter((l) => l.benchmarkStatus === "before_index").length,
    usd: null,
    cad: null,
  };
  if (indexUsable && covered.length > 0) {
    let cost = 0;
    let value = 0;
    let bench = 0;
    let costCad = 0;
    let cadComplete = fxNow !== null;
    for (const lot of covered) {
      cost += lot.costUsd;
      value += lot.valueUsd as number;
      bench += lot.benchmarkUsd as number;
      if (lot.costCad === null) cadComplete = false;
      else costCad += lot.costCad;
    }
    benchmark = {
      ...benchmark,
      status: "ok",
      reason: null,
      usd: figures(cost, value, bench),
      cad: cadComplete && fxNow !== null ? figures(costCad, value * fxNow, bench * fxNow) : null,
    };
  }

  // Same-money series for the chart: every lot with an index level on its
  // purchase date, whatever its price today (the value line has the same lots).
  let benchmarkSeries: BenchmarkSeries | null = null;
  if (indexUsable && lookup !== null) {
    const seriesLots = holdings
      .map((h, i) => ({ start: dayNumber(h.purchase_date), cost: lots[i].costUsd }))
      .map((l) => ({ ...l, level: l.start === null ? null : lookup.levelOn(l.start) }))
      .filter((l): l is { start: number; cost: number; level: number } => l.start !== null && l.level !== null);
    if (seriesLots.length > 0) {
      const start = todayNum - BENCHMARK_SERIES_DAYS;
      const usd: (number | null)[] = [];
      for (let d = start; d <= todayNum; d++) {
        const level = d > lookup.lastDay ? null : lookup.levelOn(d);
        let sum = 0;
        let any = false;
        if (level !== null) {
          for (const l of seriesLots) {
            if (l.start > d) continue;
            sum += (l.cost * level) / l.level;
            any = true;
          }
        }
        usd.push(any ? sum : null);
      }
      benchmarkSeries = { start: dateKey(start), usd };
    }
  }

  // Allocation and concentration, by priced value.
  const valued = holdings.map((holding, i) => ({ holding, valueUsd: lots[i].valueUsd }));
  const allocation: PortfolioAllocation = {
    set: groupBy(valued, (h) => {
      const s = h.products?.sets;
      return s ? { key: `set-${s.id}`, name: s.name } : { key: "set-none", name: "Unknown set" };
    }, usdValue),
    type: groupBy(valued, (h) => {
      const t = h.products?.product_types;
      return t ? { key: `type-${t.id}`, name: t.label || t.name } : { key: "type-none", name: "Other" };
    }, usdValue),
    era: groupBy(valued, (h) => {
      const g = h.products?.sets?.generations;
      return g ? { key: `gen-${g.id}`, name: g.name } : { key: "gen-none", name: "Unknown era" };
    }, usdValue),
    pricedValueUsd: usdValue,
    unpricedLots: holdings.length - priced,
  };
  const byProduct = groupBy(valued, (h) => ({ key: `product-${h.product_id}`, name: holdingLabel(h) }), usdValue);
  const concentration: ConcentrationFlag[] = [];
  if (byProduct.length >= 2) {
    for (const g of byProduct) {
      if (g.sharePct > CONCENTRATION_THRESHOLD_PCT) {
        concentration.push({ kind: "product", key: g.key, name: g.name, sharePct: g.sharePct });
      }
    }
  }
  if (allocation.set.length >= 2) {
    // A set flag adds nothing when the set is one product that is already flagged.
    const productsPerSet = new Map<string, Set<number>>();
    for (const { holding, valueUsd } of valued) {
      if (valueUsd === null) continue;
      const key = holding.products?.sets ? `set-${holding.products.sets.id}` : "set-none";
      productsPerSet.set(key, (productsPerSet.get(key) ?? new Set<number>()).add(holding.product_id));
    }
    const flaggedProducts = new Set(concentration.map((c) => c.key));
    for (const g of allocation.set) {
      if (g.sharePct <= CONCENTRATION_THRESHOLD_PCT) continue;
      const ids = [...(productsPerSet.get(g.key) ?? [])];
      if (ids.length === 1 && flaggedProducts.has(`product-${ids[0]}`)) continue;
      concentration.push({ kind: "set", key: g.key, name: g.name, sharePct: g.sharePct });
    }
  }

  return {
    version: 1,
    today,
    exitFeePct,
    statsDay: stats.day,
    fxNow,
    fxSourceDate: fx.latestSourceDate,
    totals: {
      holdings: holdings.length,
      priced,
      units,
      costUsdAll,
      valueUsd,
      valueCad: valueUsd === null || fxNow === null ? null : valueUsd * fxNow,
      usd: {
        lots: priced,
        cost: usdCost,
        value: priced > 0 ? usdValue : null,
        pl: priced > 0 ? usdValue - usdCost : null,
        plPct: priced > 0 ? pct(usdValue - usdCost, usdCost) : null,
      },
      cad: {
        lots: cadLots,
        cost: cadCost,
        value: cadLots > 0 ? cadValue : null,
        pl: cadLots > 0 ? cadValue - cadCost : null,
        plPct: cadLots > 0 ? pct(cadValue - cadCost, cadCost) : null,
        market: cadLots > 0 ? cadMarket : null,
        fx: cadLots > 0 ? cadFx : null,
      },
      dayChangeUsd: day.changeUsd,
      dayChangePct: day.changePct,
      dayChangeCovered: day.covered,
    },
    benchmark,
    benchmarkSeries,
    allocation,
    concentration,
    lots,
    fx: fx.start === null ? EMPTY_FX_SERIES : sliceFxSeries(fx, dateKey(todayNum - FX_SLICE_DAYS)),
  };
}
```

`holdingLabel` here and `holdingName` in step 14 build the same text (the server needs it for concentration flags without importing a client module). If WP15 named its dashboard helper `holdingLabel` too, that one is replaced in step 21.

### Step 6. `app/lib/portfolioChart.ts` (new): chart rows in the display currency

```ts
/**
 * Rows for the portfolio value chart (WP36): the value line from
 * get_portfolio_history (WP10) and the same-money Sealed Index line from the
 * analytics payload, both in the display currency. CAD uses the Bank of
 * Canada rate of each day (fx_daily), never today's rate; a CAD day without a
 * rate is a gap. Pure: the chart implementation and its tests import it.
 */
import type { Currency } from "../types/market";
import type { PortfolioHistoryPoint } from "../types/portfolio";
import type { BenchmarkSeries } from "../types/portfolioAnalytics";
import { usdToCadOn, type FxDailySeries } from "./fx";

export interface PortfolioChartRow {
  dateKey: string;
  value: number | null;
  benchmark: number | null;
  /** Valued from only part of the holdings (priced_products < held_products). */
  isPartial: boolean;
  pricedProducts?: number;
  heldProducts?: number;
}

export interface PortfolioChartModel {
  rows: PortfolioChartRow[];
  /** The currency the rows are in. USD when CAD was asked for but no rates exist. */
  currency: Currency;
  /** CAD was asked for but fx_daily is empty: the chart shows USD with a note. */
  cadUnavailable: boolean;
  /** Some row has a benchmark value. */
  hasBenchmark: boolean;
  partialDays: number;
}

const DAY_MS = 86_400_000;

function dayIndex(start: string, key: string): number {
  return Math.round((Date.parse(`${key.slice(0, 10)}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS);
}

export function buildPortfolioChartModel(
  points: readonly PortfolioHistoryPoint[],
  benchmark: BenchmarkSeries | null,
  fx: FxDailySeries,
  currency: Currency
): PortfolioChartModel {
  const cadUnavailable = currency === "CAD" && fx.start === null;
  const target: Currency = cadUnavailable ? "USD" : currency;
  const convert = (dateKey: string, usd: number | null | undefined): number | null => {
    if (usd === null || usd === undefined || !Number.isFinite(usd)) return null;
    return target === "CAD" ? usdToCadOn(fx, dateKey, usd) : usd;
  };

  let partialDays = 0;
  let hasBenchmark = false;
  const rows = points.map((point) => {
    const dateKey = point.date.slice(0, 10);
    let benchUsd: number | null = null;
    if (benchmark) {
      const i = dayIndex(benchmark.start, dateKey);
      if (i >= 0 && i < benchmark.usd.length) benchUsd = benchmark.usd[i];
    }
    const isPartial =
      point.priced_products !== undefined &&
      point.held_products !== undefined &&
      point.priced_products < point.held_products;
    if (isPartial) partialDays += 1;
    const bench = convert(dateKey, benchUsd);
    if (bench !== null) hasBenchmark = true;
    return {
      dateKey,
      value: convert(dateKey, point.value),
      benchmark: bench,
      isPartial,
      pricedProducts: point.priced_products,
      heldProducts: point.held_products,
    };
  });

  return { rows, currency: target, cadUnavailable, hasBenchmark, partialDays };
}
```

### Step 7. `app/lib/portfolioInput.ts`: currency in the holding bodies, the fee body, PF001

7a. Imports. Add `PurchaseCurrency` to the `import type { ... } from "../types/portfolio";` line, and below it:

```ts
import { EXIT_FEE_MAX_PCT, EXIT_FEE_MIN_PCT, normaliseExitFeePct } from "./portfolioExit";
```

7b. In `parseNewHolding`, replace

```ts
  const price = raw.purchase_price_usd;
  if (!isValidPrice(price)) return fail(PRICE_MESSAGE);
```

with

```ts
  const currency = parsePurchaseCurrency(raw.purchase_currency);
  if (currency === null) return fail(CURRENCY_MESSAGE);
  // WP36: the price is purchase_price_native in that currency. A USD body
  // without it (a client from before WP36) still sends purchase_price_usd.
  const price =
    raw.purchase_price_native !== undefined
      ? raw.purchase_price_native
      : currency === "USD"
        ? raw.purchase_price_usd
        : undefined;
  if (!isValidPrice(price)) return fail(PRICE_MESSAGE);
```

and in the returned `value`, replace the line `purchase_price_usd: price,` with:

```ts
      // USD: the price. CAD: a placeholder that the 0040 trigger replaces
      // with price / the Bank of Canada rate of purchase_date (or rejects
      // with PF001); the column is NOT NULL, so something must be sent.
      purchase_price_usd: price,
      purchase_currency: currency,
      purchase_price_native: price,
```

7c. In `parseHoldingUpdate`, replace the block

```ts
  if ("purchase_price_usd" in raw) {
    const p = raw.purchase_price_usd;
    if (!isValidPrice(p)) return fail(PRICE_MESSAGE);
    out.purchase_price_usd = p;
  }
```

with

```ts
  if ("purchase_price_native" in raw || "purchase_currency" in raw) {
    // WP36: currency and native price travel together.
    const currency = parsePurchaseCurrency(raw.purchase_currency);
    if (!("purchase_currency" in raw) || currency === null) return fail(CURRENCY_MESSAGE);
    const native = raw.purchase_price_native;
    if (!isValidPrice(native)) return fail(PRICE_MESSAGE);
    out.purchase_currency = currency;
    out.purchase_price_native = native;
    // USD: the price. CAD: placeholder, replaced by the 0040 trigger (which
    // keeps the stored USD value when neither the price nor the date changed).
    out.purchase_price_usd = native;
  } else if ("purchase_price_usd" in raw) {
    // A client from before WP36: a USD price. Say so, or the 0040 trigger
    // would keep a CAD row's stored conversion and drop the edit.
    const p = raw.purchase_price_usd;
    if (!isValidPrice(p)) return fail(PRICE_MESSAGE);
    out.purchase_price_usd = p;
    out.purchase_currency = "USD";
  }
```

In the doc comment above `parseHoldingUpdate`, "Only the four editable columns are copied out." becomes "Only the editable columns (quantity, price, date, notes and, since WP36, purchase_currency and purchase_price_native) are copied out." Keep the rest of the comment: the route still passes only this parsed object to `.update()`.

7d. Directly above `export function describeWriteError(`, add:

```ts
export const CURRENCY_MESSAGE = "Currency must be USD or CAD";
export const FX_MISSING_MESSAGE =
  "There is no Bank of Canada rate for that purchase date. Enter the price in USD, or pick another date.";

/** "USD" when absent (clients from before WP36), the value when valid, else null. */
export function parsePurchaseCurrency(raw: unknown): PurchaseCurrency | null {
  if (raw === undefined || raw === null) return "USD";
  return raw === "USD" || raw === "CAD" ? raw : null;
}
```

7e. In `describeWriteError`, directly after the `if (code === "23503") { ... }` block, add:

```ts
  if (code === "PF001") {
    return { httpStatus: 400, message: FX_MISSING_MESSAGE };
  }
```

7f. Append at the end of the file:

```ts
/** Body of PATCH /api/portfolio (WP36): the exit fee. */
export const SETTINGS_BODY_MAX_BYTES = 1024;
export const EXIT_FEE_MESSAGE = `Selling fees must be between ${EXIT_FEE_MIN_PCT}% and ${EXIT_FEE_MAX_PCT}%`;

export function parsePortfolioSettings(raw: unknown): Parsed<{ exit_fee_pct: number }> {
  if (!isRecord(raw)) return fail("Invalid body");
  const fee = normaliseExitFeePct(raw.exit_fee_pct);
  if (fee === null) return fail(EXIT_FEE_MESSAGE);
  return { ok: true, value: { exit_fee_pct: fee } };
}
```

`isRecord` and `fail` are WP05's module-private helpers in this file. If WP10 appended `parseHistoryDays` at the end, append after it.

### Step 8. `app/lib/server/portfolioRepo.ts`: new columns, the analytics input, the fee

8a. In `HOLDING_SELECT`, add `purchase_currency, purchase_price_native,` after `notes,` on the first line:

```ts
const HOLDING_SELECT = `
  id, portfolio_id, product_id, quantity, purchase_price_usd, purchase_date, notes,
  purchase_currency, purchase_price_native, created_at, updated_at,
  products (
```

Keep the rest of the string exactly as WP05, WP10 or WP32 left it. Every holdings response (WP05's routes, WP32's summary) now carries both fields.

8b. In `importErrorMessage`, add as its first line:

```ts
  if (code === "PF001") return "No Bank of Canada rate for the purchase date";
```

8c. Add `import { EXIT_FEE_DEFAULT_PCT } from "../portfolioExit";` to the imports, and append at the end of the file:

```ts
/**
 * What GET /api/portfolio/analytics needs: the exit fee and the guarded
 * holdings. Never creates a portfolio: no portfolio means the default fee and
 * no holdings. null on a failed read, so the route answers 500 instead of an
 * empty portfolio.
 */
export async function loadPortfolioAnalyticsInput(
  supabase: RouteSupabase,
  userId: string
): Promise<{ exitFeePct: number; holdings: HoldingWithProduct[] } | null> {
  const productsPromise = loadGuardedProducts();
  const { data: portfolio, error: portfolioError } = await supabase
    .from("portfolios")
    .select("id, exit_fee_pct")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (portfolioError) {
    logSupabaseError("portfolio_analytics_portfolio_failed", portfolioError);
    return null;
  }
  if (!portfolio) return { exitFeePct: EXIT_FEE_DEFAULT_PCT, holdings: [] };

  const { data, error } = await supabase
    .from("portfolio_holdings")
    .select(HOLDING_SELECT)
    .eq("portfolio_id", portfolio.id)
    .order("created_at", { ascending: false });
  if (error) {
    logSupabaseError("portfolio_analytics_holdings_failed", error);
    return null;
  }
  const fee = Number(portfolio.exit_fee_pct);
  return {
    exitFeePct: Number.isFinite(fee) ? fee : EXIT_FEE_DEFAULT_PCT,
    holdings: await guardHoldings((data ?? []) as unknown as HoldingWithProduct[], await productsPromise),
  };
}

export type ExitFeeUpdateResult = { status: "ok"; exitFeePct: number } | { status: "error"; code: string | null };

/** PATCH /api/portfolio: the caller's exit fee (portfolio created on first use). */
export async function updatePortfolioExitFee(
  supabase: RouteSupabase,
  userId: string,
  exitFeePct: number
): Promise<ExitFeeUpdateResult> {
  const portfolio = await getOrCreatePortfolio(supabase, userId);
  if (!portfolio) return { status: "error", code: null };
  const { data, error } = await supabase
    .from("portfolios")
    .update({ exit_fee_pct: exitFeePct })
    .eq("id", portfolio.id)
    .select("exit_fee_pct")
    .single();
  if (error) {
    logSupabaseError("portfolio_exit_fee_update_failed", error);
    return { status: "error", code: error.code ?? null };
  }
  return { status: "ok", exitFeePct: Number(data.exit_fee_pct) };
}
```

Use the module's own `RouteSupabase` type, `loadGuardedProducts`, `guardHoldings` and `getOrCreatePortfolio` (WP05). If WP20 replaced the `as unknown as HoldingWithProduct[]` cast in `loadPortfolioPayload` with an annotation, write the holdings line the same way as that function does.

### Step 9. Route handlers

9a. `app/api/portfolio/analytics/route.ts` (new):

```ts
import { NextRequest } from "next/server";
import { createRouteSupabaseClient } from "../../../lib/routeSupabase";
import { rejectIfNotAppRequest } from "../../../lib/csrf";
import { jsonNoStore, requireRouteUser } from "../../../lib/routeAuth";
import { loadPortfolioAnalyticsInput } from "../../../lib/server/portfolioRepo";
import { getCachedFxDaily, getCachedIndexSeries, getCachedProductStats } from "../../../lib/serverMarketData";
import { buildPortfolioAnalytics } from "../../../lib/portfolioAnalytics";
import { HEADLINE_INDEX_CODE, HEADLINE_INDEX_NAME } from "../../../lib/marketIndex";
import { logCaughtError } from "../../../lib/logger";

const LOAD_FAILED = "Failed to load portfolio analytics";

/**
 * GET /api/portfolio/analytics (WP36): per-lot P/L in USD and CAD (dated
 * rates), the money-matched Sealed Index benchmark, exit value, days to exit,
 * allocation and concentration for the caller's portfolio. Never creates a
 * portfolio. Private: no-store. The three market reads are unstable_cache
 * entries (tag market-products), so a request costs one portfolio read, one
 * holdings read and the guarded summaries WP05 already caches.
 */
export async function GET(req: NextRequest) {
  const forbidden = rejectIfNotAppRequest(req);
  if (forbidden) return forbidden;

  try {
    const supabase = await createRouteSupabaseClient();
    const auth = await requireRouteUser(supabase);
    if (auth.response) return auth.response;

    const [input, stats, fx, indexPoints] = await Promise.all([
      loadPortfolioAnalyticsInput(supabase, auth.user.id),
      getCachedProductStats(),
      getCachedFxDaily(),
      getCachedIndexSeries(HEADLINE_INDEX_CODE),
    ]);
    if (input === null) return jsonNoStore({ error: LOAD_FAILED }, 500);

    const analytics = buildPortfolioAnalytics({
      today: new Date().toISOString().slice(0, 10),
      exitFeePct: input.exitFeePct,
      holdings: input.holdings,
      stats,
      fx,
      index: { code: HEADLINE_INDEX_CODE, name: HEADLINE_INDEX_NAME, points: indexPoints },
    });
    return jsonNoStore(analytics);
  } catch (error) {
    logCaughtError("portfolio_analytics_failed", error);
    return jsonNoStore({ error: LOAD_FAILED }, 500);
  }
}
```

9b. `app/api/portfolio/route.ts` (WP05 step 8a): add a `PATCH` handler next to `GET`. Extend the imports to:

```ts
import { NextRequest } from "next/server";
import { createRouteSupabaseClient } from "../../lib/routeSupabase";
import { rejectIfBodyTooLarge, rejectIfCsrfFails, rejectIfNotAppRequest } from "../../lib/csrf";
import { jsonNoStore, requireRouteUser } from "../../lib/routeAuth";
import { EXIT_FEE_MESSAGE, SETTINGS_BODY_MAX_BYTES, parsePortfolioSettings } from "../../lib/portfolioInput";
import { loadPortfolioPayload, updatePortfolioExitFee } from "../../lib/server/portfolioRepo";
import { logCaughtError } from "../../lib/logger";
```

and append:

```ts
const SAVE_FAILED = "Could not save the selling fee. Please try again.";

/**
 * PATCH /api/portfolio { exit_fee_pct } (WP36): the selling-fee assumption
 * behind the exit value, 0 to 50 percent. Creates the portfolio on first use,
 * like GET.
 */
export async function PATCH(req: NextRequest) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, SETTINGS_BODY_MAX_BYTES);
  if (tooLarge) return tooLarge;

  try {
    const supabase = await createRouteSupabaseClient();
    const auth = await requireRouteUser(supabase);
    if (auth.response) return auth.response;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonNoStore({ error: "Invalid body" }, 400);
    }
    const parsed = parsePortfolioSettings(raw);
    if (!parsed.ok) return jsonNoStore({ error: parsed.error }, 400);

    const result = await updatePortfolioExitFee(supabase, auth.user.id, parsed.value.exit_fee_pct);
    if (result.status === "error") {
      return result.code === "23514"
        ? jsonNoStore({ error: EXIT_FEE_MESSAGE }, 400)
        : jsonNoStore({ error: SAVE_FAILED }, 500);
    }
    return jsonNoStore({ exit_fee_pct: result.exitFeePct });
  } catch (error) {
    logCaughtError("portfolio_settings_patch_failed", error);
    return jsonNoStore({ error: SAVE_FAILED }, 500);
  }
}
```

The proxy rate limit (`/api/*`, 60 a minute) covers both routes; nothing to add. Export nothing else from either `route.ts`.

### Step 10. `app/lib/portfolioApi.ts`: the analytics and fee clients

Add `import type { PortfolioAnalytics } from "../types/portfolioAnalytics";` to the imports, and append at the end of the file:

```ts
// ---- WP36: analytics and the exit fee ----

/** Minimal shape check: a wrong body throws instead of rendering garbage. */
function isPortfolioAnalytics(value: unknown): value is PortfolioAnalytics {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<PortfolioAnalytics>;
  return v.version === 1 && Array.isArray(v.lots) && typeof v.totals === "object" && v.totals !== null;
}

/**
 * GET /api/portfolio/analytics. Throws PortfolioApiError on any non-2xx or an
 * unexpected body, and the fetch error on network failure or abort.
 */
export async function fetchPortfolioAnalytics(signal?: AbortSignal): Promise<PortfolioAnalytics> {
  const res = await fetch("/api/portfolio/analytics", {
    method: "GET",
    headers: { "x-pokefin-request": "1" },
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!res.ok) {
    throw new PortfolioApiError(await readErrorMessage(res, "Failed to load portfolio analytics"), res.status);
  }
  const body: unknown = await res.json();
  if (!isPortfolioAnalytics(body)) throw new PortfolioApiError("Failed to load portfolio analytics", 500);
  return body;
}

export type ExitFeeResult = { ok: true; exitFeePct: number } | { ok: false; message: string };

/** PATCH /api/portfolio { exit_fee_pct }. Never throws. */
export async function updateExitFee(exitFeePct: number): Promise<ExitFeeResult> {
  try {
    const res = await fetch("/api/portfolio", {
      method: "PATCH",
      headers: JSON_HEADERS,
      credentials: "same-origin",
      body: JSON.stringify({ exit_fee_pct: exitFeePct }),
    });
    if (!res.ok) {
      return { ok: false, message: await readErrorMessage(res, "Could not save the selling fee.") };
    }
    const body = (await res.json()) as { exit_fee_pct?: unknown };
    return typeof body.exit_fee_pct === "number"
      ? { ok: true, exitFeePct: body.exit_fee_pct }
      : { ok: false, message: "Could not save the selling fee." };
  } catch {
    return { ok: false, message: NETWORK_ERROR };
  }
}
```

### Step 11. Collectr import: the cost currency

11a. `app/lib/import.ts`: add `PurchaseCurrency` to the `import type { ... } from "../types/portfolio";` list, change the signature of `importHoldings` (WP05 step 11c) to

```ts
export async function importHoldings(
  matches: ImportMatchResult[],
  costCurrency: PurchaseCurrency = "USD"
): Promise<ImportMatchResult[]> {
```

add one sentence to its doc comment: "`costCurrency` is the currency of the file's Average Cost Paid column (WP36); a CAD cost is converted in the database at the rate of each row's purchase date.", and in the `rows.push({ ... })` object replace `purchase_price_usd: averageCostPaid,` with:

```ts
      purchase_price_usd: averageCostPaid,
      purchase_currency: costCurrency,
      purchase_price_native: averageCostPaid,
```

11b. `app/components/Portfolio/cards/ImportHoldingsModal.tsx`:
- Imports: `import SegmentedControl from "../../ui/SegmentedControl";`, `import { formatMoney } from "../../../lib/format";` (if not imported already) and add `PurchaseCurrency` to the `../../../types/portfolio` type import.
- State, below the existing `useState` lines: `const [costCurrency, setCostCurrency] = useState<PurchaseCurrency>("USD");`. Reset it to `"USD"` wherever the modal resets its wizard state (`handleClose`).
- Directly after the `{/* Summary */}` grid in the `step === "preview"` block (before `{/* Select All / Deselect All */}`), insert:

```tsx
                {/* WP36: the currency of the Average Cost Paid column */}
                <div>
                  <SegmentedControl
                    label="Costs in this file are in"
                    options={[
                      { value: "USD", label: "USD" },
                      { value: "CAD", label: "CAD" },
                    ]}
                    value={costCurrency}
                    onChange={(next: PurchaseCurrency) => setCostCurrency(next)}
                    fullWidthOnPhone={false}
                  />
                  <p className="mt-1 text-caption text-ink-soft">
                    Collectr exports costs in the currency your Collectr app shows. Pick CAD if you see C$ there.
                  </p>
                </div>
```

- In `handleImport`, `importHoldings(toImport)` becomes `importHoldings(toImport, costCurrency)`.
- The preview row text `Qty: {result.csvRow.quantity} @ ...{averageCostPaid}... each` (find it with `grep -n "averageCostPaid" app/components/Portfolio/cards/ImportHoldingsModal.tsx`): format the cost with `formatMoney(result.csvRow.averageCostPaid, costCurrency)`, keeping the rest of the text.

### Step 12. `app/components/Portfolio/cards/AddHoldingModal.tsx`: "Paid in"

Apply to the file as WP05, WP07, WP14, WP15 and (if present) WP31 left it. Keep every other prop, state, effect and the footer.

12a. Imports: add `useRef` to the React import if missing, and:

```tsx
import SegmentedControl from "../../ui/SegmentedControl";
import { useCurrency } from "../../../context/CurrencyContext";
```

and add `PurchaseCurrency` to the `../../../types/portfolio` type import.

12b. Above the component:

```tsx
const PAID_IN_OPTIONS = [
  { value: "USD", label: "USD" },
  { value: "CAD", label: "CAD" },
] as const satisfies readonly { value: PurchaseCurrency; label: string }[];

/** WP36: a USD Market Price as a starting price in the currency paid (rounded to cents). */
export function prefillPrice(usd: number, paidIn: PurchaseCurrency, usdToCad: number): string {
  return (paidIn === "CAD" ? usd * usdToCad : usd).toFixed(2);
}
```

12c. Below the existing state declarations:

```tsx
  // WP36: the currency paid, starting as the display currency (CAD by default).
  const { currency: displayCurrency, exchangeRate } = useCurrency();
  const [paidIn, setPaidIn] = useState<PurchaseCurrency>(displayCurrency);
  // The last pre-filled price text: a currency switch re-fills it only if the user has not typed over it.
  const prefilledRef = useRef<string | null>(null);
  const paidInHintId = `${fieldId}-paid-in-hint`;
```

(`fieldId` is WP14's `useId()` value; declare these lines after it.)

12d. Replace WP14's `handleProductSelect` body with:

```tsx
  const handleProductSelect = (product: ProductSearchResult | null) => {
    setSelectedProduct(product);
    if (!product) return; // clearing the product keeps the typed price, as before
    const next = hasCurrentPrice(product) ? prefillPrice(product.usd_price as number, paidIn, exchangeRate) : "";
    prefilledRef.current = next === "" ? null : next;
    setPurchasePrice(next);
  };

  const handlePaidInChange = (next: PurchaseCurrency) => {
    setPaidIn(next);
    if (
      selectedProduct &&
      hasCurrentPrice(selectedProduct) &&
      prefilledRef.current !== null &&
      purchasePrice === prefilledRef.current
    ) {
      const refilled = prefillPrice(selectedProduct.usd_price as number, next, exchangeRate);
      prefilledRef.current = refilled;
      setPurchasePrice(refilled);
    }
  };
```

Keep the existing comment block about the withheld-price else branch above `handleProductSelect`. The pre-filled CAD figure uses today's rate from `useCurrency()`; it is only a starting value, and the stored USD cost always comes from the purchase-date rate in the database.

12e. In `handleSubmit`, add `paidIn` to the idempotency signature (`JSON.stringify([selectedProduct.id, qty, paidIn, price, purchaseDate, cleanNotes])`), so switching currency mints a new key, and replace the `addHolding({ ... })` argument with:

```tsx
    const result = await addHolding({
      product_id: selectedProduct.id,
      quantity: qty,
      purchase_currency: paidIn,
      purchase_price_native: price,
      // Required by the type. For CAD the server stores price / the purchase-date rate.
      purchase_price_usd: price,
      purchase_date: purchaseDate,
      notes: cleanNotes,
      client_idempotency_key: attempt.key,
    });
```

12f. Markup. Directly after the product field's `<div>` (the one holding `ProductSearchSelect`) and before the Quantity and Price grid, insert:

```tsx
        {/* WP36: the currency paid */}
        <div>
          <SegmentedControl
            label="Paid in"
            options={PAID_IN_OPTIONS}
            value={paidIn}
            onChange={handlePaidInChange}
            fullWidthOnPhone={false}
          />
          {paidIn === "CAD" && (
            <p id={paidInHintId} className="mt-1 text-caption text-ink-soft">
              Kept exactly as you enter it. Pokéfin converts it to US dollars at the Bank of Canada rate of the purchase
              date to compare it with US Market Prices.
            </p>
          )}
        </div>
```

In the price field: the label text `Purchase Price (USD)` becomes `` {`Price paid per unit (${paidIn})`} ``; the `$` prefix span becomes `{paidIn === "CAD" ? "C$" : "$"}`; the input gets `inputMode="decimal"` and `aria-describedby={paidIn === "CAD" ? paidInHintId : undefined}`, and its left padding becomes `${paidIn === "CAD" ? "pl-10" : "pl-7"}` (make the `className` a template literal; keep its other classes).

12g. If WP31 landed (Before you start printed a line for `initialProductId`): its `getProductForAdd(initialProductId).then(` success branch must pre-fill through the same rule as a manual pick, or a CAD "Paid in" would show the USD Market Price under a CAD label and the user would save it as CAD. WP31's effect depends on `[initialProductId]` only, so it cannot call `handleProductSelect` directly (that function changes every render). Add `useEffectEvent` to the React import (stable in React 19.2; `eslint-plugin-react-hooks` 7 knows it and keeps it out of the dependency list), declare below `handlePaidInChange`:

```tsx
  // WP31's ?add= product: pre-filled exactly like a manual pick (currency-aware).
  const selectInitialProduct = useEffectEvent((product: ProductSearchResult) => handleProductSelect(product));
```

and in WP31's effect replace the body of `if (product) { ... }` so it reads:

```tsx
        if (product) {
          selectInitialProduct(product);
          setInitialStatus("idle");
        } else {
```

Leave the rest of WP31's effect (the `cancelled` flag, the rejection branch, the dependency array) and its two status lines exactly as they are. If WP31 has not landed, skip 12g.

### Step 13. `app/components/Portfolio/cards/EditHoldingModal.tsx`: "Paid in" and an exact round trip

Apply to the file as WP05 and WP14 left it (the modal is mounted per edit with a non-null `holding`).

13a. Imports as in 12a (`SegmentedControl`; `PurchaseCurrency` type). Copy `PAID_IN_OPTIONS` from 12b above the component (not `prefillPrice`).

13b. Replace WP14's `purchasePrice` state initialiser with:

```tsx
  // WP36: the lot's currency and its price in that currency. The text is
  // compared on submit: an untouched price is not sent, so it round-trips exactly.
  const [initialCurrency] = useState<PurchaseCurrency>(() =>
    holding.purchase_currency === "CAD" ? "CAD" : "USD"
  );
  const [initialPriceText] = useState(() =>
    (initialCurrency === "CAD" && typeof holding.purchase_price_native === "number"
      ? holding.purchase_price_native
      : holding.purchase_price_usd
    ).toFixed(2)
  );
  const [paidIn, setPaidIn] = useState<PurchaseCurrency>(initialCurrency);
  const [purchasePrice, setPurchasePrice] = useState(initialPriceText);
  const paidInHintId = `${fieldId}-paid-in-hint`;
```

(Declare it after WP14's `const fieldId = useId();`; move that line up if needed.)

13c. In `handleSubmit`, replace the `updates` object with:

```tsx
    const updates: UpdateHolding = {
      quantity: qty,
      purchase_date: purchaseDate,
      notes: clampNotes(notes),
    };
    // Send the price only when it or its currency changed: an untouched price
    // (even one stored with more than 2 decimals) keeps its stored value, and
    // an untouched CAD lot keeps its stored USD conversion (migration 0040).
    if (paidIn !== initialCurrency || purchasePrice.trim() !== initialPriceText) {
      updates.purchase_currency = paidIn;
      updates.purchase_price_native = price;
    }
```

Leave the validation above it (the price is still validated when unchanged) and the call to `updateHolding(holding.id, updates)` as they are.

13d. Markup: insert the same `{/* WP36: the currency paid */}` block as 12f, with `onChange={setPaidIn}`, directly after the read-only product block and before the Quantity field; apply the same label, prefix, `inputMode`, `aria-describedby` and padding changes to the price input.

### Step 14. `app/components/Portfolio/portfolioDisplay.ts` (new): display helpers and the holdings row model

```ts
import { formatDateOnly, formatMoney, formatSignedPercent } from "../../lib/format";
import { EXIT_BAND_LABELS, EXIT_BAND_ORDER } from "../../lib/portfolioExit";
import { STALE_AFTER_DAYS, daysBetween } from "../ui/AsOf";
import type { Currency } from "../../types/market";
import type { HoldingWithProduct } from "../../types/portfolio";
import type { BenchmarkComparison, LotAnalytics } from "../../types/portfolioAnalytics";
import type { SortValue } from "../../lib/sorting";

/** Card shell for the portfolio sections (WP23 tokens). */
export const CARD = "rounded-card border border-line bg-surface p-4 md:p-6";

/**
 * An amount in the display currency. In CAD, when the CAD figure is unknown
 * (no Bank of Canada rate for a date) the USD figure is shown with its code,
 * never converted at a guessed rate.
 */
export function money(
  currency: Currency,
  usd: number | null | undefined,
  cad: number | null | undefined,
  { signed = false }: { signed?: boolean } = {}
): string {
  if (currency === "CAD") {
    if (typeof cad === "number" && Number.isFinite(cad)) return formatMoney(cad, "CAD", { signed });
    if (typeof usd === "number" && Number.isFinite(usd)) return `${formatMoney(usd, "USD", { signed })} USD`;
    return "--";
  }
  return formatMoney(usd, "USD", { signed });
}

/** USD to CAD at the analytics rate, or null. */
export function toCad(usd: number | null | undefined, fxNow: number | null): number | null {
  return typeof usd === "number" && Number.isFinite(usd) && fxNow !== null ? usd * fxNow : null;
}

/** Percentage points: "+4.2 pts", "-0.8 pts", "--". */
export function formatPoints(value: number | null | undefined): string {
  const text = formatSignedPercent(value);
  return text === "--" ? text : `${text.slice(0, -1)} pts`;
}

/** "Evolving Skies Booster Box (Pokémon Center)". Same parts as lib/portfolioAnalytics holdingLabel. */
export function holdingName(holding: HoldingWithProduct): string {
  const product = holding.products;
  const setName = product?.sets?.name || "Unknown set";
  const type = product?.product_types?.label || product?.product_types?.name || "";
  const variant = product?.variant ? ` (${product.variant})` : "";
  return `${setName}${type ? ` ${type}` : ""}${variant}`;
}

export function productHref(productId: number): string {
  return `/product/${productId}`;
}

/** The per-unit price paid, in the currency paid: "C$129.99" or "$59.99". */
export function paidUnit(holding: HoldingWithProduct): string {
  const cad = holding.purchase_currency === "CAD" && typeof holding.purchase_price_native === "number";
  return cad
    ? formatMoney(holding.purchase_price_native as number, "CAD")
    : formatMoney(holding.purchase_price_usd, "USD");
}

export function exitBandText(lot: LotAnalytics): string {
  return EXIT_BAND_LABELS[lot.exitBand];
}

/** Hover and screen-reader detail for the band. */
export function exitBandDetail(lot: LotAnalytics): string {
  if (lot.exitBand === "unknown") return "No recent TCGplayer sales data for this product.";
  if (lot.daysToExit === null) return "No TCGplayer sales in the last 30 days.";
  const days = Math.max(1, Math.round(lot.daysToExit));
  return `About ${days} ${days === 1 ? "day" : "days"} of recent TCGplayer sales for the ${lot.productQuantity} you hold.`;
}

/**
 * True when the price day is 2 or more UTC days before `today`: the rule
 * WP23's AsOf uses to switch to its stale clock. Phone rows use it to show
 * the inline "Last priced" line only when it says something (WP23: the
 * table variant's tooltip never shows on touch).
 */
export function isPriceStale(priceDay: string | null, today: string | null): boolean {
  if (!priceDay || !today) return false;
  const age = daysBetween(priceDay.slice(0, 10), today.slice(0, 10));
  return Number.isFinite(age) && age >= STALE_AFTER_DAYS;
}

export function withheldReason(lot: LotAnalytics | null): string {
  if (lot?.priceDay) return `Price withheld. Last priced ${formatDateOnly(lot.priceDay)}.`;
  return "Price withheld: no recent TCGplayer price.";
}

export function benchmarkUnavailableText(b: BenchmarkComparison): string {
  if (b.reason === "index_stale" && b.indexDay) {
    return `The Sealed Index has not been published since ${formatDateOnly(b.indexDay)}.`;
  }
  if (b.reason === "no_covered_lots") {
    return b.firstIndexDay
      ? `None of your priced holdings was bought on or after ${formatDateOnly(b.firstIndexDay)}, when the index starts.`
      : "None of your holdings can be compared with the index yet.";
  }
  return "The Pokéfin Sealed Index is not available right now.";
}

export function benchmarkCoverageText(b: BenchmarkComparison): string | null {
  if (b.status !== "ok" || b.coveredLots >= b.pricedLots) return null;
  const before =
    b.beforeIndexLots > 0 && b.firstIndexDay
      ? `; ${b.beforeIndexLots} bought before the index starts on ${formatDateOnly(b.firstIndexDay)}`
      : "";
  return `Compares ${b.coveredLots} of ${b.pricedLots} priced holdings${before}.`;
}

// ---- Holdings rows and sorting ----

export interface HoldingRow {
  holding: HoldingWithProduct;
  /** null until the analytics response arrives (or when it failed). */
  lot: LotAnalytics | null;
  name: string;
}

export type HoldingSortKey = "name" | "date" | "value" | "pl" | "contribution" | "exit";
export type HoldingSort = { key: HoldingSortKey; direction: "asc" | "desc" };
export const DEFAULT_HOLDING_SORT: HoldingSort = { key: "value", direction: "desc" };

export const HOLDING_SORT_OPTIONS: readonly {
  key: HoldingSortKey;
  label: string;
  defaultDirection: "asc" | "desc";
  directionLabels: Record<"asc" | "desc", string>;
}[] = [
  { key: "value", label: "Value", defaultDirection: "desc", directionLabels: { desc: "Highest first", asc: "Lowest first" } },
  { key: "pl", label: "P/L", defaultDirection: "desc", directionLabels: { desc: "Best first", asc: "Worst first" } },
  { key: "contribution", label: "Contribution", defaultDirection: "desc", directionLabels: { desc: "Largest first", asc: "Smallest first" } },
  { key: "exit", label: "Days to exit", defaultDirection: "asc", directionLabels: { asc: "Fastest first", desc: "Slowest first" } },
  { key: "date", label: "Date bought", defaultDirection: "desc", directionLabels: { desc: "Newest first", asc: "Oldest first" } },
  { key: "name", label: "Name", defaultDirection: "asc", directionLabels: { asc: "A to Z", desc: "Z to A" } },
];

export function buildHoldingRows(
  holdings: readonly HoldingWithProduct[],
  lots: readonly LotAnalytics[] | null
): HoldingRow[] {
  const byId = new Map((lots ?? []).map((lot) => [lot.holdingId, lot]));
  return holdings.map((holding) => ({ holding, lot: byId.get(holding.id) ?? null, name: holdingName(holding) }));
}

/** Sort value per key in the display currency; null sorts last both ways. */
export function holdingSortValue(row: HoldingRow, key: HoldingSortKey, currency: Currency): SortValue {
  const lot = row.lot;
  switch (key) {
    case "name":
      return row.name;
    case "date":
      return row.holding.purchase_date;
    case "value":
      return lot?.valueUsd ?? null;
    case "pl":
      return (currency === "CAD" ? lot?.plCad : lot?.plUsd) ?? null;
    case "contribution":
      return (currency === "CAD" ? lot?.contributionPctCad : lot?.contributionPctUsd) ?? null;
    case "exit":
      if (!lot || lot.exitBand === "unknown") return null;
      return lot.daysToExit ?? EXIT_BAND_ORDER.over_1m * 1e6;
  }
}
```

### Step 15. `app/components/Portfolio/hooks/usePortfolioAnalytics.ts` (new)

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchPortfolioAnalytics, PortfolioApiError } from "../../../lib/portfolioApi";
import { logCaughtError } from "../../../lib/logger";
import type { HoldingWithProduct } from "../../../types/portfolio";
import type { PortfolioAnalytics } from "../../../types/portfolioAnalytics";

type Settled =
  | { holdings: readonly HoldingWithProduct[]; token: number; status: "ok"; data: PortfolioAnalytics }
  | { holdings: readonly HoldingWithProduct[]; token: number; status: "error"; errorText: string };

export interface UsePortfolioAnalyticsResult {
  /** The newest analytics that loaded, kept on screen while a newer request runs. */
  analytics: PortfolioAnalytics | null;
  /** True while the analytics for the current holdings are loading. */
  loading: boolean;
  /** Fixed text, never a thrown error's own message. */
  errorText: string | null;
  retry: () => void;
}

function analyticsErrorText(err: unknown): string {
  if (err instanceof PortfolioApiError && err.status === 401) {
    return "Your session has expired. Please sign in again.";
  }
  return "We could not load your portfolio figures.";
}

/**
 * GET /api/portfolio/analytics (WP36) for the holdings on screen. Re-runs when
 * the holdings array changes (add, edit, delete, import, refresh), aborting
 * the previous request, so an older response can never overwrite a newer
 * one. No request for an empty portfolio. No setState runs synchronously in
 * the effect body (react-hooks/set-state-in-effect).
 */
export function usePortfolioAnalytics(
  portfolioId: number | null,
  holdings: readonly HoldingWithProduct[]
): UsePortfolioAnalyticsResult {
  const [settled, setSettled] = useState<Settled | null>(null);
  const [lastOk, setLastOk] = useState<PortfolioAnalytics | null>(null);
  const [token, setToken] = useState(0);
  const active = portfolioId !== null && holdings.length > 0;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    fetchPortfolioAnalytics(controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        setSettled({ holdings, token, status: "ok", data });
        setLastOk(data);
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        logCaughtError("portfolio_analytics_fetch_failed", err);
        setSettled({ holdings, token, status: "error", errorText: analyticsErrorText(err) });
      }
    );
    return () => controller.abort();
  }, [active, holdings, token]);

  const current = settled !== null && settled.holdings === holdings && settled.token === token ? settled : null;
  const retry = useCallback(() => setToken((t) => t + 1), []);

  return {
    analytics: active ? (current?.status === "ok" ? current.data : lastOk) : null,
    loading: active && current === null,
    errorText: current?.status === "error" ? current.errorText : null,
    retry,
  };
}
```

Do not export it from `hooks/index.ts` (the dashboard imports it by path, which keeps WP15's `jest.mock("../hooks", ...)` working unchanged).

### Step 16. The summary: `shared/ExitFeeField.tsx` and `shared/PortfolioSummary.tsx` (new)

16a. `app/components/Portfolio/shared/ExitFeeField.tsx`:

```tsx
"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { EXIT_FEE_MAX_PCT, EXIT_FEE_MIN_PCT, normaliseExitFeePct } from "../../../lib/portfolioExit";

export type FeeStatus = "idle" | "saving" | "saved" | "error";

const STATUS_TEXT: Record<FeeStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Not saved. This view uses it until you reload.",
};

/**
 * The selling-fee assumption behind the exit value (WP36): a small number
 * field committed on blur or Enter. The parent applies it at once and saves
 * it (PATCH /api/portfolio); the sample portfolio applies it only.
 */
export default function ExitFeeField({
  value,
  onCommit,
  status = "idle",
}: {
  value: number;
  onCommit: (pct: number) => void;
  status?: FeeStatus;
}) {
  const id = useId();
  const [text, setText] = useState(() => String(value));
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    const parsed = normaliseExitFeePct(text.trim() === "" ? Number.NaN : Number(text));
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText(String(parsed));
    if (parsed !== value) onCommit(parsed);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <label htmlFor={id} className="text-small text-ink-soft">
        Selling fees
      </label>
      <span className="inline-flex items-center gap-1">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          autoComplete="off"
          min={EXIT_FEE_MIN_PCT}
          max={EXIT_FEE_MAX_PCT}
          step={0.5}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-status`}
          className="h-8 w-16 rounded-control border border-line bg-surface px-2 text-right text-base tabular-nums text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action md:text-small pointer-coarse:h-11"
        />
        <span aria-hidden="true" className="text-small text-ink-soft">%</span>
      </span>
      <span id={`${id}-status`} role="status" className={`text-caption ${invalid || status === "error" ? "text-warn-text" : "text-ink-soft"}`}>
        {invalid ? `Enter ${EXIT_FEE_MIN_PCT} to ${EXIT_FEE_MAX_PCT}.` : STATUS_TEXT[status]}
      </span>
    </span>
  );
}
```

16b. `app/components/Portfolio/shared/PortfolioSummary.tsx`:

```tsx
"use client";

import AsOf from "../../ui/AsOf";
import Button from "../../ui/Button";
import Delta from "../../ui/Delta";
import MetricLabel from "../../ui/MetricLabel";
import Skeleton from "../../ui/Skeleton";
import Stat from "../../ui/Stat";
import { WarnIcon } from "../../ui/icons";
import { formatDateOnly, formatSignedPercent } from "../../../lib/format";
import { exitValueAfterFees } from "../../../lib/portfolioExit";
import type { Currency } from "../../../types/market";
import type { PortfolioAnalytics } from "../../../types/portfolioAnalytics";
import ExitFeeField, { type FeeStatus } from "./ExitFeeField";
import { CARD, benchmarkCoverageText, benchmarkUnavailableText, formatPoints, money, toCad } from "../portfolioDisplay";

export interface PortfolioSummaryProps {
  analytics: PortfolioAnalytics | null;
  loading: boolean;
  errorText: string | null;
  onRetry?: () => void;
  currency: Currency;
  exitFeePct: number;
  onExitFeeCommit: (pct: number) => void;
  feeStatus?: FeeStatus;
}

const VALUE_SKELETON = <Skeleton className="h-7 w-28" />;
// Holds the height of the sub-lines that arrive with the analytics, so the
// chart and allocation below do not jump when they load (CLS budget 0.05).
const SUB_SKELETON = (
  <div className="mt-1 space-y-1.5">
    <Skeleton className="h-3 w-24" />
    <Skeleton className="h-3 w-20" />
  </div>
);

/**
 * The portfolio's headline figures (WP36): market value, day change,
 * unrealised P/L (with the CAD market and currency split), exit value after
 * the selling-fee assumption, and the same money in the Pokéfin Sealed Index.
 * A withheld price is never counted: the counts under each figure say what it
 * covers.
 */
export default function PortfolioSummary({
  analytics,
  loading,
  errorText,
  onRetry,
  currency,
  exitFeePct,
  onExitFeeCommit,
  feeStatus = "idle",
}: PortfolioSummaryProps) {
  const a = analytics;
  const t = a?.totals ?? null;
  const fxNow = a?.fxNow ?? null;
  const showSkeleton = a === null && loading;

  // CAD figures need a CAD cost basis; without one (no rate for any purchase
  // date) the USD figures are shown with their code.
  const cadReady = currency === "CAD" && t !== null && t.cad.lots > 0;
  const totals = t ? (cadReady ? t.cad : t.usd) : null;
  const net = (x: typeof totals) =>
    x && x.value !== null ? (exitValueAfterFees(x.value, exitFeePct) as number) - x.cost : null;
  const exitUsd = exitValueAfterFees(t?.valueUsd, exitFeePct);
  const exitCad = exitValueAfterFees(t?.valueCad, exitFeePct);
  const bench = a?.benchmark ?? null;
  const benchFigures = bench ? (currency === "CAD" ? bench.cad ?? bench.usd : bench.usd) : null;
  const benchInUsdOnly = currency === "CAD" && bench !== null && bench.cad === null && bench.usd !== null;
  const coverage = bench ? benchmarkCoverageText(bench) : null;

  return (
    <section aria-labelledby="portfolio-summary-title" className={CARD}>
      <h2 id="portfolio-summary-title" className="sr-only">
        Portfolio summary
      </h2>

      {errorText && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-control bg-warn-fill px-3 py-2 text-small text-warn-text">
          <WarnIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{errorText} Your holdings below are up to date.</span>
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-5">
        <Stat
          label={<MetricLabel metric="portfolioMarketValue" />}
          value={showSkeleton ? VALUE_SKELETON : money(currency, t?.valueUsd, t?.valueCad)}
          sub={showSkeleton ? SUB_SKELETON : t && t.priced < t.holdings ? `${t.priced} of ${t.holdings} holdings priced` : undefined}
          asOf={a?.statsDay ? <AsOf date={a.statsDay} referenceDate={a.today} /> : undefined}
        />
        <Stat
          label={<MetricLabel metric="portfolioDayChange" />}
          value={showSkeleton ? VALUE_SKELETON : money(currency, t?.dayChangeUsd, toCad(t?.dayChangeUsd, fxNow), { signed: true })}
          delta={t ? <Delta value={t.dayChangePct} period="1D" missingReason="No holding was repriced in the last day" /> : undefined}
          sub={showSkeleton ? SUB_SKELETON : t && t.dayChangeCovered < t.priced ? `${t.dayChangeCovered} of ${t.priced} repriced` : undefined}
        />
        <Stat
          label={<MetricLabel metric="unrealisedPl" />}
          value={showSkeleton ? VALUE_SKELETON : money(currency, t?.usd.pl, cadReady ? t?.cad.pl : null, { signed: true })}
          delta={totals ? <Delta value={totals.plPct} missingReason="No holding has a current price" /> : undefined}
          sub={
            showSkeleton ? SUB_SKELETON : cadReady && t ? (
              <>
                Market {money("CAD", null, t.cad.market, { signed: true })} · <MetricLabel metric="currencyEffect" />{" "}
                {money("CAD", null, t.cad.fx, { signed: true })}
                {t.cad.lots < t.priced && <span className="block">Covers {t.cad.lots} of {t.priced} priced holdings.</span>}
              </>
            ) : undefined
          }
        />
        <Stat
          label={<MetricLabel metric="exitValue" />}
          value={showSkeleton ? VALUE_SKELETON : money(currency, exitUsd, exitCad)}
          sub={
            <>
              <ExitFeeField value={exitFeePct} onCommit={onExitFeeCommit} status={feeStatus} />
              {t && t.usd.value !== null && (
                <span className="block">
                  Net of cost: {money(currency, net(t.usd), cadReady ? net(t.cad) : null, { signed: true })}
                </span>
              )}
            </>
          }
        />
        <Stat
          className="col-span-2 lg:col-span-1"
          label={<MetricLabel metric="vsSealedIndex" />}
          value={
            showSkeleton
              ? VALUE_SKELETON
              : benchFigures
                ? benchInUsdOnly
                  ? money("CAD", benchFigures.delta, null, { signed: true })
                  : money(currency, benchFigures.delta, benchFigures.delta, { signed: true })
                : "--"
          }
          delta={
            benchFigures ? (
              // Percentage points, not a percent change: Delta would print "5.9%".
              // The sign carries the direction (text, never colour alone).
              <span className="text-small font-medium tabular-nums text-ink-soft">{formatPoints(benchFigures.deltaPts)}</span>
            ) : undefined
          }
          sub={
            showSkeleton ? SUB_SKELETON : bench === null ? undefined : bench.status === "ok" && benchFigures ? (
              <>
                Your return {formatSignedPercent(benchFigures.returnPct)}, the same money in the index{" "}
                {formatSignedPercent(benchFigures.benchmarkReturnPct)}
                {coverage && <span className="block">{coverage}</span>}
              </>
            ) : (
              benchmarkUnavailableText(bench)
            )
          }
          asOf={bench?.indexDay && bench.status === "ok" ? `Index as of ${formatDateOnly(bench.indexDay)}` : undefined}
        />
      </div>
    </section>
  );
}
```

16c. Delete `app/components/Portfolio/shared/PortfolioSummaryCard.tsx` and `app/components/Portfolio/__tests__/PortfolioSummaryCard.test.tsx` (replaced by `PortfolioSummary` and its test). `calculatePortfolioSummary` in `app/lib/portfolio.ts` stays: WP05's hook still returns `summary`, and its tests cover it.

### Step 17. Allocation: `shared/AllocationPanel.tsx` (new), and the pie goes

17a. `app/components/Portfolio/shared/AllocationPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import Badge from "../../ui/Badge";
import SegmentedControl from "../../ui/SegmentedControl";
import Skeleton from "../../ui/Skeleton";
import { formatPercent } from "../../../lib/format";
import type { Currency } from "../../../types/market";
import type { AllocationGroup, ConcentrationFlag, PortfolioAllocation } from "../../../types/portfolioAnalytics";
import { CARD, money, toCad } from "../portfolioDisplay";

type GroupBy = "set" | "type" | "era";

const GROUP_OPTIONS = [
  { value: "set", label: "Set" },
  { value: "type", label: "Type" },
  { value: "era", label: "Era" },
] as const satisfies readonly { value: GroupBy; label: string }[];

/** Rows shown before the rest fold into "Other". */
export const ALLOCATION_MAX_ROWS = 6;

export function foldGroups(groups: readonly AllocationGroup[]): AllocationGroup[] {
  if (groups.length <= ALLOCATION_MAX_ROWS + 1) return [...groups];
  const head = groups.slice(0, ALLOCATION_MAX_ROWS);
  const rest = groups.slice(ALLOCATION_MAX_ROWS);
  return [
    ...head,
    {
      key: "other",
      name: `Other (${rest.length})`,
      valueUsd: rest.reduce((s, g) => s + g.valueUsd, 0),
      sharePct: rest.reduce((s, g) => s + g.sharePct, 0),
      lots: rest.reduce((s, g) => s + g.lots, 0),
    },
  ];
}

function flagText(flag: ConcentrationFlag): string {
  const share = formatPercent(flag.sharePct, { decimals: 0 });
  return flag.kind === "product"
    ? `${flag.name} is ${share} of your priced value.`
    : `${flag.name} products are ${share} of your priced value.`;
}

/**
 * Allocation of the priced value by set, product type or era (WP36), as
 * labelled bars (no chart library), with the concentration flags under it.
 */
export default function AllocationPanel({
  allocation,
  concentration,
  currency,
  fxNow,
  loading,
}: {
  allocation: PortfolioAllocation | null;
  concentration: readonly ConcentrationFlag[];
  currency: Currency;
  fxNow: number | null;
  loading: boolean;
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>("set");
  const groups = allocation ? foldGroups(allocation[groupBy]) : [];

  return (
    <section aria-labelledby="portfolio-allocation-title" className={`${CARD} flex h-full flex-col gap-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="portfolio-allocation-title" className="text-h3 font-semibold text-ink">
          Allocation
        </h2>
        <SegmentedControl
          label="Group by"
          hideLabel
          options={GROUP_OPTIONS}
          value={groupBy}
          onChange={setGroupBy}
          fullWidthOnPhone={false}
        />
      </div>

      {allocation === null ? (
        loading ? (
          <div className="space-y-3" aria-hidden="true">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <p className="text-small text-ink-soft">Allocation is not available right now.</p>
        )
      ) : groups.length === 0 ? (
        <p className="text-small text-ink-soft">No holding has a current price, so there is nothing to allocate yet.</p>
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => (
            <li key={g.key}>
              <div className="flex items-baseline justify-between gap-3 text-small">
                <span className="min-w-0 truncate font-medium text-ink" title={g.name}>
                  {g.name}
                </span>
                <span className="shrink-0 tabular-nums text-ink-soft">
                  {money(currency, g.valueUsd, toCad(g.valueUsd, fxNow))} ·{" "}
                  <span className="font-semibold text-ink">{formatPercent(g.sharePct, { decimals: 0 })}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-control bg-chart-grid" aria-hidden="true">
                <div
                  className="h-1.5 rounded-control"
                  style={{ width: `${Math.min(100, Math.max(0, g.sharePct))}%`, background: "var(--pf-chart-line)" }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {concentration.length > 0 && (
        <ul className="space-y-1 border-t border-line pt-3">
          {concentration.map((flag) => (
            <li key={flag.key} className="text-small text-ink">
              <Badge variant="warn">Concentrated</Badge> {flagText(flag)}
            </li>
          ))}
        </ul>
      )}

      {allocation && allocation.unpricedLots > 0 && (
        <p className="text-caption text-ink-soft">
          {allocation.unpricedLots} {allocation.unpricedLots === 1 ? "holding has" : "holdings have"} no current price
          and {allocation.unpricedLots === 1 ? "is" : "are"} left out.
        </p>
      )}
    </section>
  );
}
```

17b. Delete `app/components/Portfolio/shared/AllocationChart.tsx` and `app/components/charts/AllocationChartImpl.tsx`, and remove the line `export { default as AllocationChartImpl } from "./AllocationChartImpl";` from `app/components/charts/ChartBundle.tsx`.

17c. `app/components/charts/__tests__/chartTooltips.test.tsx` (WP17): delete the `import { AllocationTooltip } from "../AllocationChartImpl";` line and the `AllocationTooltip` cases. The `PortfolioTooltip` case is rewritten in Tests item 11.

### Step 18. Holdings: desktop table, phone list, row actions (new), and `HoldingCard` goes

18a. `app/components/Portfolio/cards/HoldingActions.tsx`:

```tsx
import type { HoldingWithProduct } from "../../../types/portfolio";

const ICON_BUTTON =
  "inline-flex size-9 items-center justify-center rounded-control text-ink-soft transition-colors duration-150 motion-reduce:transition-none hover:bg-surface-alt hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action pointer-coarse:size-11";

/** Edit and delete for one holding row (desktop table and phone list). */
export default function HoldingActions({
  holding,
  name,
  onEdit,
  onDelete,
}: {
  holding: HoldingWithProduct;
  name: string;
  onEdit: (holding: HoldingWithProduct) => void;
  onDelete: (holdingId: number) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" onClick={() => onEdit(holding)} aria-label={`Edit ${name}`} className={ICON_BUTTON}>
        <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true" focusable="false">
          <path d="M4 13.5V16h2.5l7.4-7.4-2.5-2.5L4 13.5zM15.7 6.8a.9.9 0 000-1.3l-1.2-1.2a.9.9 0 00-1.3 0l-1 1 2.5 2.5 1-1z" fill="currentColor" />
        </svg>
      </button>
      <button type="button" onClick={() => onDelete(holding.id)} aria-label={`Delete ${name}`} className={ICON_BUTTON}>
        <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true" focusable="false">
          <path d="M6 6l1 10h6l1-10M4.5 6h11M8 6V4h4v2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </span>
  );
}
```

18b. `app/components/Portfolio/cards/HoldingsDesktopTable.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import IntentLink from "../../IntentLink";
import SortableTable, { type SortableColumn } from "../../SortableTable/SortableTable";
import AsOf from "../../ui/AsOf";
import Delta from "../../ui/Delta";
import Skeleton from "../../ui/Skeleton";
import { formatDateOnly, formatMoney } from "../../../lib/format";
import type { Currency } from "../../../types/market";
import type { HoldingWithProduct } from "../../../types/portfolio";
import HoldingActions from "./HoldingActions";
import {
  exitBandDetail,
  exitBandText,
  formatPoints,
  holdingSortValue,
  money,
  paidUnit,
  productHref,
  toCad,
  withheldReason,
  type HoldingRow,
  type HoldingSort,
  type HoldingSortKey,
} from "../portfolioDisplay";

export interface HoldingsViewProps {
  rows: readonly HoldingRow[];
  currency: Currency;
  /** analytics.fxNow, for per-unit prices in CAD. */
  fxNow: number | null;
  /** analytics.today, so AsOf ages prices against the same day as the server. */
  today: string | null;
  sort: HoldingSort;
  onSortChange: (next: HoldingSort) => void;
  /** Sample portfolio: no links, no edit or delete. */
  readOnly?: boolean;
  onEdit?: (holding: HoldingWithProduct) => void;
  onDelete?: (holdingId: number) => void;
}

type Column = SortableColumn<HoldingRow, HoldingSortKey>;

const NUM = "px-3 text-right tabular-nums whitespace-nowrap";
const CELL_SKELETON = <Skeleton className="ml-auto h-3 w-12" />;

export default function HoldingsDesktopTable({
  rows,
  currency,
  fxNow,
  today,
  sort,
  onSortChange,
  readOnly = false,
  onEdit,
  onDelete,
}: HoldingsViewProps) {
  const columns = useMemo<Column[]>(() => {
    const list: Column[] = [
      {
        id: "product",
        label: "Product",
        sortKey: "name",
        cellClassName: "px-3 truncate",
        cellTitle: (row) => row.name,
        cell: (row) =>
          readOnly ? (
            <span className="font-medium text-ink">{row.name}</span>
          ) : (
            <IntentLink
              href={productHref(row.holding.product_id)}
              className="rounded-control font-medium text-ink hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              {row.name}
            </IntentLink>
          ),
      },
      {
        id: "date",
        label: "Bought",
        sortKey: "date",
        align: "right",
        widthClassName: "w-28",
        cellClassName: `${NUM} text-ink-soft`,
        cell: (row) => formatDateOnly(row.holding.purchase_date),
      },
      {
        id: "qty",
        label: "Qty",
        align: "right",
        widthClassName: "w-14",
        cellClassName: NUM,
        cell: (row) => row.holding.quantity,
      },
      {
        id: "paid",
        label: "Paid (each)",
        align: "right",
        widthClassName: "w-28",
        cellClassName: `${NUM} text-ink-soft`,
        cell: (row) => paidUnit(row.holding),
      },
      {
        id: "price",
        label: "Price",
        align: "right",
        widthClassName: "w-32",
        cellClassName: NUM,
        cell: (row) => {
          if (!row.lot) return CELL_SKELETON;
          if (row.lot.priceUsd === null) {
            return (
              <span className="inline-flex items-center justify-end gap-1 text-ink-soft">
                <span aria-hidden="true">--</span>
                <span className="sr-only">{withheldReason(row.lot)}</span>
                <AsOf date={row.lot.priceDay} variant="table" referenceDate={today ?? undefined} />
              </span>
            );
          }
          const price = currency === "CAD" ? toCad(row.lot.priceUsd, fxNow) : row.lot.priceUsd;
          return (
            <span className="inline-flex items-center justify-end gap-1">
              <span>{price === null ? `${formatMoney(row.lot.priceUsd, "USD")} USD` : formatMoney(price, currency)}</span>
              <AsOf date={row.lot.priceDay} variant="table" referenceDate={today ?? undefined} />
            </span>
          );
        },
      },
      {
        id: "value",
        label: "Value",
        sortKey: "value",
        align: "right",
        widthClassName: "w-28",
        cellClassName: `${NUM} font-semibold text-ink`,
        cell: (row) => (row.lot ? money(currency, row.lot.valueUsd, row.lot.valueCad) : CELL_SKELETON),
      },
      {
        id: "pl",
        label: "P/L",
        sortKey: "pl",
        align: "right",
        widthClassName: "w-40",
        cellClassName: NUM,
        cell: (row) => {
          const lot = row.lot;
          if (!lot) return CELL_SKELETON;
          const cad = currency === "CAD" && lot.plCad !== null;
          const pl = money(currency, lot.plUsd, lot.plCad, { signed: true });
          return (
            <span className="inline-flex flex-col items-end">
              <span className="inline-flex items-baseline gap-2">
                <span>{pl}</span>
                <Delta value={cad ? lot.plPctCad : lot.plPctUsd} missingReason={withheldReason(lot)} />
              </span>
              {lot.purchaseCurrency !== currency && lot.plNative !== null && (
                <span className="text-caption text-ink-soft">
                  in {lot.purchaseCurrency}: {formatMoney(lot.plNative, lot.purchaseCurrency, { signed: true })}
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: "contribution",
        label: "Contribution",
        sortKey: "contribution",
        align: "right",
        widthClassName: "w-28",
        cellClassName: `${NUM} text-ink-soft`,
        cell: (row) =>
          row.lot
            ? formatPoints(currency === "CAD" && row.lot.contributionPctCad !== null ? row.lot.contributionPctCad : row.lot.contributionPctUsd)
            : CELL_SKELETON,
      },
      {
        id: "exit",
        label: "Days to exit",
        sortKey: "exit",
        align: "right",
        widthClassName: "w-32",
        cellClassName: `${NUM} text-ink-soft`,
        cellTitle: (row) => (row.lot ? exitBandDetail(row.lot) : undefined),
        cell: (row) =>
          row.lot ? (
            <>
              {exitBandText(row.lot)}
              <span className="sr-only">. {exitBandDetail(row.lot)}</span>
            </>
          ) : (
            CELL_SKELETON
          ),
      },
    ];
    if (!readOnly && onEdit && onDelete) {
      list.push({
        id: "actions",
        label: "Actions",
        align: "right",
        widthClassName: "w-24",
        cellClassName: "px-2 text-right",
        cell: (row) => <HoldingActions holding={row.holding} name={row.name} onEdit={onEdit} onDelete={onDelete} />,
      });
    }
    return list;
  }, [currency, fxNow, today, readOnly, onEdit, onDelete]);

  const sortValue = useMemo(
    () => (row: HoldingRow, key: HoldingSortKey) => holdingSortValue(row, key, currency),
    [currency]
  );

  return (
    <SortableTable
      caption="Your holdings"
      rows={rows}
      columns={columns}
      sort={sort}
      onSortChange={onSortChange}
      sortValue={sortValue}
      rowKey={(row) => String(row.holding.id)}
      emptyMessage="No holdings yet."
      minWidthClassName="min-w-[72rem]"
    />
  );
}
```

18c. `app/components/Portfolio/cards/HoldingsPhoneList.tsx`:

```tsx
"use client";

import { useId, useMemo } from "react";
import IntentLink from "../../IntentLink";
import AsOf from "../../ui/AsOf";
import { DataList } from "../../ui/DataList";
import Delta from "../../ui/Delta";
import Skeleton from "../../ui/Skeleton";
import { compareSortValues } from "../../../lib/sorting";
import HoldingActions from "./HoldingActions";
import type { HoldingsViewProps } from "./HoldingsDesktopTable";
import {
  HOLDING_SORT_OPTIONS,
  exitBandText,
  holdingSortValue,
  isPriceStale,
  money,
  paidUnit,
  productHref,
  withheldReason,
  type HoldingRow,
  type HoldingSortKey,
} from "../portfolioDisplay";

const ROW_TEXT =
  "flex min-h-14 min-w-0 flex-1 flex-col justify-center px-4 py-2";
const ROW_LINK = `${ROW_TEXT} transition-colors duration-150 motion-reduce:transition-none hover:bg-surface-alt active:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action`;

/** Holdings below 768 px (WP23 phone list pattern): two-line rows, a sort select, row actions. */
export default function HoldingsPhoneList({
  rows,
  currency,
  today,
  sort,
  onSortChange,
  readOnly = false,
  onEdit,
  onDelete,
}: HoldingsViewProps) {
  const selectId = useId();
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) =>
        compareSortValues(holdingSortValue(a, sort.key, currency), holdingSortValue(b, sort.key, currency), sort.direction)
      ),
    [rows, sort, currency]
  );
  const current = HOLDING_SORT_OPTIONS.find((o) => o.key === sort.key) ?? HOLDING_SORT_OPTIONS[0];

  const body = (row: HoldingRow) => {
    const lot = row.lot;
    const meta = `${row.holding.quantity} × ${paidUnit(row.holding)}${lot ? ` · Exit: ${exitBandText(lot).toLowerCase()}` : ""}`;
    return (
      <>
        <span className="truncate text-body font-medium text-ink">{row.name}</span>
        <span className="mt-0.5 flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-small text-ink-soft">{meta}</span>
          <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
            {lot ? (
              <>
                <span className="text-body font-semibold text-ink">
                  {lot.valueUsd === null ? (
                    <>
                      <span aria-hidden="true">--</span>
                      <span className="sr-only">{withheldReason(lot)}</span>
                    </>
                  ) : (
                    money(currency, lot.valueUsd, lot.valueCad)
                  )}
                </span>
                <Delta
                  value={currency === "CAD" && lot.plPctCad !== null ? lot.plPctCad : lot.plPctUsd}
                  missingReason={withheldReason(lot)}
                />
              </>
            ) : (
              <Skeleton className="h-3 w-20" />
            )}
          </span>
        </span>
        {/* WP23: phone rows use the inline AsOf (a table-variant tooltip never shows on touch), and only when stale. */}
        {lot && isPriceStale(lot.priceDay, today) && (
          <span className="mt-0.5 self-end text-caption">
            <AsOf date={lot.priceDay} variant="inline" referenceDate={today ?? undefined} />
          </span>
        )}
      </>
    );
  };

  return (
    <div>
      <div className="mb-3 flex items-end gap-2 px-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={selectId} className="text-caption font-semibold uppercase tracking-wide text-ink-soft">
            Sort by
          </label>
          <select
            id={selectId}
            value={sort.key}
            onChange={(event) => {
              const key = event.target.value as HoldingSortKey;
              const option = HOLDING_SORT_OPTIONS.find((o) => o.key === key) ?? HOLDING_SORT_OPTIONS[0];
              onSortChange({ key, direction: option.defaultDirection });
            }}
            className="h-11 w-full rounded-control border border-line bg-surface px-3 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            {HOLDING_SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => onSortChange({ key: sort.key, direction: sort.direction === "asc" ? "desc" : "asc" })}
          className="h-11 shrink-0 rounded-control border border-line bg-surface px-3 text-small font-semibold text-ink hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
        >
          {current.directionLabels[sort.direction]}
        </button>
      </div>
      <DataList label="Your holdings">
        {sorted.map((row) => (
          <li key={row.holding.id} className="flex items-stretch">
            {readOnly ? (
              <div className={ROW_TEXT}>{body(row)}</div>
            ) : (
              <IntentLink href={productHref(row.holding.product_id)} className={ROW_LINK}>
                {body(row)}
              </IntentLink>
            )}
            {!readOnly && onEdit && onDelete && (
              <span className="flex shrink-0 items-center pr-2">
                <HoldingActions holding={row.holding} name={row.name} onEdit={onEdit} onDelete={onDelete} />
              </span>
            )}
          </li>
        ))}
      </DataList>
    </div>
  );
}
```

18d. Replace the whole of `app/components/Portfolio/cards/HoldingsTable.tsx` with:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { Currency } from "../../../types/market";
import type { HoldingWithProduct } from "../../../types/portfolio";
import type { PortfolioAnalytics } from "../../../types/portfolioAnalytics";
import HoldingsDesktopTable from "./HoldingsDesktopTable";
import HoldingsPhoneList from "./HoldingsPhoneList";
import { CARD, DEFAULT_HOLDING_SORT, buildHoldingRows, type HoldingSort } from "../portfolioDisplay";

/**
 * The holdings (WP36): a dense sortable table from 768 px, a two-line list
 * below it. Analytics columns (price, value, P/L, contribution, days to exit)
 * show flat skeletons until GET /api/portfolio/analytics answers.
 */
export default function HoldingsTable({
  holdings,
  analytics,
  currency,
  readOnly = false,
  onEdit,
  onDelete,
}: {
  holdings: readonly HoldingWithProduct[];
  analytics: PortfolioAnalytics | null;
  currency: Currency;
  readOnly?: boolean;
  onEdit?: (holding: HoldingWithProduct) => void;
  onDelete?: (holdingId: number) => void;
}) {
  const [sort, setSort] = useState<HoldingSort>(DEFAULT_HOLDING_SORT);
  const rows = useMemo(() => buildHoldingRows(holdings, analytics?.lots ?? null), [holdings, analytics]);
  const view = {
    rows,
    currency,
    fxNow: analytics?.fxNow ?? null,
    today: analytics?.today ?? null,
    sort,
    onSortChange: setSort,
    readOnly,
    onEdit,
    onDelete,
  };

  return (
    <section aria-labelledby="portfolio-holdings-title" className={`${CARD} px-0 md:px-0`}>
      <h2 id="portfolio-holdings-title" className="mb-3 px-4 text-h3 font-semibold text-ink md:px-6">
        Holdings ({holdings.length})
      </h2>
      <div className="hidden md:block md:px-3">
        <HoldingsDesktopTable {...view} />
      </div>
      <div className="md:hidden">
        <HoldingsPhoneList {...view} />
      </div>
      <p className="mt-3 px-4 text-caption text-ink-soft md:px-6">
        Days to exit: the units of each product you hold divided by its TCGplayer units sold per day over the last 30
        days. It measures market depth; it is not a quote. Contribution: each holding&apos;s P/L in points of your
        priced cost, so the column adds up to your total return.
      </p>
    </section>
  );
}
```

18e. Delete `app/components/Portfolio/cards/HoldingCard.tsx` and `app/components/Portfolio/__tests__/HoldingCard.test.tsx`. In `app/types/portfolio.ts`, delete `HoldingSortBy` and `HoldingSortDirection` if `grep -rn "HoldingSortBy\|HoldingSortDirection" app` now prints only that file. `calculateHoldingPerformance` in `app/lib/portfolio.ts` stays (tested; harmless).

### Step 19. The chart: index overlay and dated CAD

19a. Replace the whole of `app/components/charts/PortfolioChartImpl.tsx` with:

```tsx
"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMonthDay, formatMoney } from "../../lib/format";
import { buildPortfolioChartModel, type PortfolioChartRow } from "../../lib/portfolioChart";
import type { FxDailySeries } from "../../lib/fx";
import type { Currency } from "../../types/market";
import type { PortfolioHistoryPoint } from "../../types/portfolio";
import type { BenchmarkSeries } from "../../types/portfolioAnalytics";

export interface PortfolioChartImplProps {
  data: PortfolioHistoryPoint[];
  benchmark: BenchmarkSeries | null;
  fx: FxDailySeries;
  currency: Currency;
  showBenchmark: boolean;
  height?: number;
}

type ChartTooltipProps = {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: PortfolioChartRow }>;
};

const BENCH_LABEL = "Same money in the Pokéfin Sealed Index";

// Module scope so Recharts gets the same component type on every render
// (review F056, WP17).
export function PortfolioTooltip({ active, payload, currency }: ChartTooltipProps & { currency: Currency }) {
  const row = payload?.[0]?.payload;
  if (!active || !row || (row.value === null && row.benchmark === null)) return null;
  return (
    <div className="rounded-card border border-line bg-surface px-3 py-2 text-small text-ink shadow-lg">
      <p className="text-caption font-semibold text-ink-soft">{formatMonthDay(row.dateKey)}</p>
      <p className="tabular-nums">
        Your holdings: <span className="font-semibold">{formatMoney(row.value, currency)}</span>
      </p>
      {row.benchmark !== null && (
        <p className="tabular-nums text-ink-soft">
          Index, same money: <span className="font-semibold text-ink">{formatMoney(row.benchmark, currency)}</span>
        </p>
      )}
      {row.isPartial && (
        <p className="mt-1 text-caption text-warn-text">
          {row.pricedProducts} of {row.heldProducts} products priced: not comparable to fully priced days.
        </p>
      )}
    </div>
  );
}

/** Round tick values for the Y axis ("C$1.2k"). */
function compactMoney(value: number, currency: Currency): string {
  const symbol = currency === "CAD" ? "C$" : "$";
  return value >= 1000 ? `${symbol}${(value / 1000).toFixed(1)}k` : `${symbol}${value.toFixed(0)}`;
}

/**
 * Recharts implementation of PortfolioChart (WP36): the value line and the
 * dashed same-money Sealed Index line, both in the display currency at each
 * day's Bank of Canada rate. Only reachable through the lazily loaded
 * ChartBundle chunk.
 */
export default function PortfolioChartImpl({
  data,
  benchmark,
  fx,
  currency,
  showBenchmark,
  height = 250,
}: PortfolioChartImplProps) {
  const model = useMemo(
    () => buildPortfolioChartModel(data, showBenchmark ? benchmark : null, fx, currency),
    [data, benchmark, fx, currency, showBenchmark]
  );

  const domain = useMemo(() => {
    const values = model.rows
      .flatMap((r) => [r.value, r.benchmark])
      .filter((v): v is number => v !== null && v > 0);
    if (values.length === 0) return [0, 100];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min) * 0.1 || max * 0.05;
    return [Math.max(0, min - pad), max + pad];
  }, [model.rows]);

  const hasAnyValue = model.rows.some((r) => r.value !== null);
  if (!hasAnyValue) {
    return (
      <div className="flex h-48 items-center justify-center text-small text-ink-soft">
        No current prices for this period
      </div>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={model.rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--pf-chart-grid)" vertical={false} />
          <XAxis
            dataKey="dateKey"
            tickFormatter={(key: string) => formatMonthDay(key)}
            tick={{ fill: "var(--pf-ink-soft)", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--pf-border)" }}
            interval="preserveStartEnd"
            minTickGap={30}
          />
          <YAxis
            domain={domain}
            tick={{ fill: "var(--pf-ink-soft)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => compactMoney(v, model.currency)}
            width={56}
          />
          <Tooltip content={<PortfolioTooltip currency={model.currency} />} cursor={{ stroke: "var(--pf-border)" }} />
          <Line
            type="linear"
            dataKey="value"
            name="Your holdings"
            stroke="var(--pf-chart-line)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          {showBenchmark && model.hasBenchmark && (
            <Line
              type="linear"
              dataKey="benchmark"
              name={BENCH_LABEL}
              stroke="var(--pf-chart-bench)"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {model.partialDays > 0 && (
        <p className="mt-2 text-caption text-ink-soft">
          {model.partialDays} {model.partialDays === 1 ? "day is" : "days are"} valued from only part of the portfolio.
          Hover for the coverage. Movement across those points reflects what could be priced, not a change in holdings.
        </p>
      )}
      {model.cadUnavailable && (
        <p className="mt-2 text-caption text-warn-text">
          Bank of Canada rates are unavailable right now, so this chart is in US dollars.
        </p>
      )}
    </div>
  );
}
```

It keeps WP17's exported `PortfolioTooltip` (module scope) and the partial-day note, drops the gradient area and every hex colour (the `uiConventions` hex count for this file goes to 0), and converts CAD by date through `buildPortfolioChartModel`. If WP24's em dash sweep changed the partial-day wording, the text above already follows it.

19b. Replace the whole of `app/components/Portfolio/shared/PortfolioChart.tsx` with:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useId } from "react";
import SegmentedControl from "../../ui/SegmentedControl";
import Skeleton from "../../ui/Skeleton";
import { formatDateOnly } from "../../../lib/format";
import type { FxDailySeries } from "../../../lib/fx";
import type { Currency } from "../../../types/market";
import type { PortfolioHistoryPoint, PortfolioTimeframe } from "../../../types/portfolio";
import type { BenchmarkSeries } from "../../../types/portfolioAnalytics";
import { CARD } from "../portfolioDisplay";

const DEFAULT_HEIGHT = 250;

/** "ALL" is not offered: history is requested for at most 365 days, so it would repeat 1Y. */
const TIMEFRAME_OPTIONS = [
  { value: "7D", label: "7D" },
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "1Y", label: "1Y" },
] as const satisfies readonly { value: PortfolioTimeframe; label: string }[];

function PlotSkeleton() {
  return <Skeleton className="h-full w-full" />;
}

// Recharts loads only when there is something to plot, through the single
// ChartBundle chunk shared with the other charts (WP12).
const PortfolioChartImpl = dynamic(
  () => import("../../charts/ChartBundle").then((m) => m.PortfolioChartImpl),
  { ssr: false, loading: () => <div style={{ height: DEFAULT_HEIGHT }}><PlotSkeleton /></div> }
);

export interface PortfolioChartProps {
  data: PortfolioHistoryPoint[];
  timeframe: PortfolioTimeframe;
  onTimeframeChange: (timeframe: PortfolioTimeframe) => void;
  currency: Currency;
  benchmark: BenchmarkSeries | null;
  fx: FxDailySeries;
  showBenchmark: boolean;
  onShowBenchmarkChange: (show: boolean) => void;
  /** analytics.benchmark.indexDay: the last index day, shown under the chart. */
  indexDay: string | null;
  /** Why some lots are not in the index line, or null. */
  benchmarkNote: string | null;
  loading?: boolean;
  height?: number;
}

/**
 * Portfolio value over time with the money-matched Sealed Index (WP36).
 * The header (range, legend, index toggle) is always rendered, so a range
 * with nothing to plot never removes the control that picks another range.
 */
export default function PortfolioChart({
  data,
  timeframe,
  onTimeframeChange,
  currency,
  benchmark,
  fx,
  showBenchmark,
  onShowBenchmarkChange,
  indexDay,
  benchmarkNote,
  loading = false,
  height = DEFAULT_HEIGHT,
}: PortfolioChartProps) {
  const toggleId = useId();
  const canCompare = benchmark !== null;
  const last = data.length > 0 ? data[data.length - 1].date.slice(0, 10) : null;

  let body;
  if (data.length === 0) {
    body = loading ? (
      <div style={{ height }}>
        <PlotSkeleton />
      </div>
    ) : (
      <div className="flex h-48 items-center justify-center text-small text-ink-soft">No historical data available yet</div>
    );
  } else {
    body = (
      <div aria-busy={loading} className={loading ? "opacity-60 transition-opacity duration-150" : "transition-opacity duration-150"}>
        <PortfolioChartImpl
          data={data}
          benchmark={benchmark}
          fx={fx}
          currency={currency}
          showBenchmark={showBenchmark && canCompare}
          height={height}
        />
      </div>
    );
  }

  return (
    <section aria-labelledby="portfolio-chart-title" className={CARD}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="portfolio-chart-title" className="text-h3 font-semibold text-ink">
          Value
        </h2>
        <SegmentedControl
          label="Range"
          ariaLabel="Chart range"
          hideLabel
          options={TIMEFRAME_OPTIONS}
          value={timeframe === "ALL" ? "1Y" : timeframe}
          onChange={onTimeframeChange}
          fullWidthOnPhone
        />
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink-soft">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-0.5 w-5" style={{ background: "var(--pf-chart-line)" }} />
          Your holdings
        </span>
        {canCompare && showBenchmark && (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: "var(--pf-chart-bench)" }} />
            Same money in the Pokéfin Sealed Index
          </span>
        )}
        {canCompare && (
          <label htmlFor={toggleId} className="ml-auto inline-flex items-center gap-2 pointer-coarse:min-h-11">
            <input
              id={toggleId}
              type="checkbox"
              checked={showBenchmark}
              onChange={(event) => onShowBenchmarkChange(event.target.checked)}
              className="size-4 accent-action"
            />
            Compare with the Sealed Index
          </label>
        )}
      </div>

      {body}

      {data.length > 0 && (
        <p className="mt-2 text-caption text-ink-soft">
          {last && <>Last point {formatDateOnly(last)}. </>}
          {canCompare && showBenchmark && indexDay && <>The index is published for the previous day; its line ends {formatDateOnly(indexDay)}. </>}
          {canCompare && showBenchmark && benchmarkNote}
        </p>
      )}
    </section>
  );
}
```

The header is part of the wrapper now, so a range with nothing to plot still shows the range control (the old impl had to duplicate its header for that). WP05's `loading` behaviour is kept: skeleton on a first load, the previous chart dimmed on a reload.

### Step 20. Empty state and the sample portfolio (new)

20a. `app/components/Portfolio/PortfolioEmptyState.tsx`:

```tsx
import Button from "../ui/Button";
import { CARD } from "./portfolioDisplay";

/**
 * A portfolio with no holdings (WP36): three ways in, import first. The
 * sample portfolio is client-only and never saved.
 */
export default function PortfolioEmptyState({
  onImport,
  onAdd,
  onSample,
}: {
  onImport: () => void;
  onAdd: () => void;
  onSample: () => void;
}) {
  return (
    <section aria-labelledby="portfolio-empty-title" className={`${CARD} flex flex-col items-center gap-4 border-dashed px-6 py-10 text-center`}>
      <h2 id="portfolio-empty-title" className="text-h2 font-semibold text-ink">
        Start with what you own
      </h2>
      <p className="max-w-prose text-body text-ink-soft">
        Import your Collectr export in one step, or add products one at a time. Pokéfin values them every day at the
        TCGplayer Market Price, shows what you would net after selling fees, and compares your purchases with the same
        money in the Pokéfin Sealed Index.
      </p>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Button variant="primary" onClick={onImport}>
          Import from Collectr
        </Button>
        <Button variant="secondary" onClick={onAdd}>
          Add a product
        </Button>
        <Button variant="ghost" onClick={onSample}>
          Explore a sample portfolio
        </Button>
      </div>
      <p className="text-caption text-ink-soft">The sample uses made-up purchases and generated prices. Nothing is saved.</p>
    </section>
  );
}
```

20b. `app/components/Portfolio/demo/samplePortfolio.ts`:

```ts
/**
 * The sample portfolio (WP36): a static, made-up collection that shows a new
 * user what the dashboard does before they import anything. Client-only and
 * never saved: no request is made, nothing touches the user's portfolio.
 * Loaded with a dynamic import() from PortfolioEmptyState, so none of this is
 * in /portfolio's initial JavaScript.
 *
 * Prices, the index and the exchange rate are generated by fixed formulas, so
 * the sample renders identically on every visit and in tests. They are not
 * market data: the page says so.
 */
import { buildFxSeries, type FxDailyRow } from "../../../lib/fx";
import type { ProductStatsSnapshot } from "../../../lib/marketStats";
import { buildPortfolioAnalytics } from "../../../lib/portfolioAnalytics";
import type { ProductDailyStats } from "../../../types/market";
import type { HoldingWithProduct, PortfolioHistoryPoint } from "../../../types/portfolio";
import type { PortfolioAnalytics } from "../../../types/portfolioAnalytics";

/** The last day the sample is valued on. Fixed: the sample never moves. */
export const SAMPLE_AS_OF = "2026-09-29";
const SAMPLE_TODAY = "2026-09-30";
const DAY_MS = 86_400_000;
const HISTORY_DAYS = 365;
const SERIES_DAYS = 500;

interface SampleProduct {
  id: number;
  set: string;
  code: string;
  setId: number;
  era: string;
  eraId: number;
  type: string;
  typeId: number;
  /** Price SERIES_DAYS days before SAMPLE_TODAY, then a fixed daily drift and a gentle wave. */
  startPrice: number;
  dailyDrift: number;
  unitsSold30d: number;
}

// Negative ids: they can never collide with, or link to, a real catalog product.
const PRODUCTS: readonly SampleProduct[] = [
  { id: -1, set: "Evolving Skies", code: "EVS", setId: -1, era: "Sword & Shield", eraId: -1, type: "Booster Box", typeId: -1, startPrice: 560, dailyDrift: 0.0007, unitsSold30d: 4 },
  { id: -2, set: "Crown Zenith", code: "CRZ", setId: -2, era: "Sword & Shield", eraId: -1, type: "Elite Trainer Box", typeId: -2, startPrice: 62, dailyDrift: 0.0003, unitsSold30d: 210 },
  { id: -3, set: "151", code: "MEW", setId: -3, era: "Scarlet & Violet", eraId: -2, type: "Booster Bundle", typeId: -3, startPrice: 44, dailyDrift: 0.0006, unitsSold30d: 640 },
  { id: -4, set: "Paldean Fates", code: "PAF", setId: -4, era: "Scarlet & Violet", eraId: -2, type: "Elite Trainer Box", typeId: -2, startPrice: 58, dailyDrift: -0.0004, unitsSold30d: 2 },
  { id: -5, set: "Surging Sparks", code: "SSP", setId: -5, era: "Scarlet & Violet", eraId: -2, type: "Booster Box", typeId: -1, startPrice: 150, dailyDrift: 0.0009, unitsSold30d: 45 },
];

interface SampleLot {
  id: number;
  productId: number;
  quantity: number;
  purchaseDate: string;
  currency: "USD" | "CAD";
  /** Per unit, in currency. */
  price: number;
}

const LOTS: readonly SampleLot[] = [
  { id: -101, productId: -1, quantity: 2, purchaseDate: "2025-11-14", currency: "CAD", price: 845 },
  { id: -102, productId: -2, quantity: 4, purchaseDate: "2026-01-20", currency: "USD", price: 59.99 },
  { id: -103, productId: -3, quantity: 6, purchaseDate: "2026-02-03", currency: "CAD", price: 64.99 },
  { id: -104, productId: -4, quantity: 3, purchaseDate: "2026-03-11", currency: "USD", price: 54.5 },
  { id: -105, productId: -5, quantity: 2, purchaseDate: "2026-05-22", currency: "CAD", price: 229.99 },
  { id: -106, productId: -3, quantity: 4, purchaseDate: "2026-07-08", currency: "USD", price: 49.95 },
];

function dayNum(key: string): number {
  return Math.round(Date.parse(`${key}T00:00:00Z`) / DAY_MS);
}

function keyOf(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

const TODAY_NUM = dayNum(SAMPLE_TODAY);
const FIRST_NUM = TODAY_NUM - SERIES_DAYS;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Market Price of a sample product on day n (USD). */
function priceOn(p: SampleProduct, n: number): number {
  const t = n - FIRST_NUM;
  return round2(p.startPrice * Math.exp(p.dailyDrift * t) * (1 + 0.03 * Math.sin(t / 23 + p.id)));
}

/** USD to CAD on day n: around 1.37, moving a few cents over the year. */
function rateOn(n: number): number {
  return Math.round((1.37 + 0.025 * Math.sin((n - FIRST_NUM) / 61)) * 10000) / 10000;
}

/** A Sealed Index stand-in: base 100, a steady rise with a wave. */
function indexOn(n: number): number {
  const t = n - FIRST_NUM;
  return Math.round(100 * Math.exp(0.00065 * t) * (1 + 0.02 * Math.sin(t / 37)) * 1e6) / 1e6;
}

function toHolding(lot: SampleLot): HoldingWithProduct {
  const p = PRODUCTS.find((x) => x.id === lot.productId) as SampleProduct;
  const usdUnit =
    lot.currency === "CAD" ? Math.round((lot.price / rateOn(dayNum(lot.purchaseDate))) * 1e6) / 1e6 : lot.price;
  return {
    id: lot.id,
    portfolio_id: -1,
    product_id: p.id,
    quantity: lot.quantity,
    purchase_price_usd: usdUnit,
    purchase_date: lot.purchaseDate,
    notes: null,
    purchase_currency: lot.currency,
    purchase_price_native: lot.price,
    created_at: `${lot.purchaseDate}T12:00:00Z`,
    updated_at: `${lot.purchaseDate}T12:00:00Z`,
    products: {
      id: p.id,
      usd_price: priceOn(p, dayNum(SAMPLE_AS_OF)),
      price_recorded_at: `${SAMPLE_AS_OF}T08:00:00`,
      image_url: null,
      variant: null,
      url: null,
      sets: {
        id: p.setId,
        name: p.set,
        code: p.code,
        release_date: null,
        expansion_type: null,
        generations: { id: p.eraId, name: p.era },
      },
      product_types: { id: p.typeId, name: p.type, label: p.type },
    },
  };
}

function statsRow(p: SampleProduct): ProductDailyStats {
  const asOf = dayNum(SAMPLE_AS_OF);
  const price = priceOn(p, asOf);
  const prev = priceOn(p, asOf - 1);
  return {
    day: SAMPLE_AS_OF,
    product_id: p.id,
    usd_price: price,
    price_day: SAMPLE_AS_OF,
    is_price_fresh: true,
    ret_1d: (price / prev - 1) * 100,
    ret_7d: null,
    ret_30d: null,
    ret_90d: null,
    ret_365d: null,
    tracked_high_usd: null,
    tracked_high_day: null,
    first_tracked_day: null,
    dd_from_high_pct: null,
    high_52w: null,
    low_52w: null,
    pos_in_52w: null,
    distinct_prices_365d: null,
    obs_90d: null,
    vol_weekly_52w: null,
    units_sold_7d: null,
    units_sold_30d: p.unitsSold30d,
    tx_30d: null,
    active_listings: null,
    qty_available: null,
    lowest_ask_usd: null,
    listings_snapshot_date: null,
    ask_premium_pct: null,
    days_of_supply: null,
    sell_through_30d: null,
    qty_change_7d_pct: null,
    qty_change_30d_pct: null,
    liquidity_score: null,
    refreshed_at: `${SAMPLE_TODAY}T00:30:00Z`,
  };
}

export interface SamplePortfolio {
  holdings: HoldingWithProduct[];
  /** Value history for the chart, one point per day, oldest first (USD). */
  history: PortfolioHistoryPoint[];
  analytics: PortfolioAnalytics;
}

/** Built on demand (a few milliseconds); the result is the same every time. */
export function buildSamplePortfolio(exitFeePct: number): SamplePortfolio {
  const holdings = LOTS.map(toHolding);

  const fxRows: FxDailyRow[] = [];
  const indexPoints: { day: string; level: number }[] = [];
  for (let n = FIRST_NUM; n <= TODAY_NUM; n++) {
    const day = keyOf(n);
    fxRows.push({ day, usd_to_cad: rateOn(n), source_date: day, source: "boc" });
    if (n <= dayNum(SAMPLE_AS_OF)) indexPoints.push({ day, level: indexOn(n) });
  }

  const stats: ProductStatsSnapshot = {
    day: SAMPLE_AS_OF,
    byProductId: Object.fromEntries(PRODUCTS.map((p) => [p.id, statsRow(p)])),
  };

  const history: PortfolioHistoryPoint[] = [];
  for (let n = TODAY_NUM - HISTORY_DAYS; n <= TODAY_NUM; n++) {
    const valueDay = Math.min(n, dayNum(SAMPLE_AS_OF));
    let value = 0;
    const held = new Set<number>();
    for (const lot of LOTS) {
      if (dayNum(lot.purchaseDate) > n) continue;
      const p = PRODUCTS.find((x) => x.id === lot.productId) as SampleProduct;
      value += lot.quantity * priceOn(p, valueDay);
      held.add(p.id);
    }
    history.push({
      date: keyOf(n),
      value: held.size > 0 ? round2(value) : null,
      priced_products: held.size,
      held_products: held.size,
    });
  }

  const analytics = buildPortfolioAnalytics({
    today: SAMPLE_TODAY,
    exitFeePct,
    holdings,
    stats,
    fx: buildFxSeries(fxRows),
    index: { code: "sealed", name: "Pokéfin Sealed Index", points: indexPoints },
  });

  return { holdings, history, analytics };
}
```

20c. `app/components/Portfolio/demo/PortfolioSampleView.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import Button from "../../ui/Button";
import { formatDateOnly } from "../../../lib/format";
import { EXIT_FEE_DEFAULT_PCT } from "../../../lib/portfolioExit";
import type { Currency } from "../../../types/market";
import type { PortfolioTimeframe } from "../../../types/portfolio";
import AllocationPanel from "../shared/AllocationPanel";
import PortfolioChart from "../shared/PortfolioChart";
import PortfolioSummary from "../shared/PortfolioSummary";
import HoldingsTable from "../cards/HoldingsTable";
import { benchmarkCoverageText } from "../portfolioDisplay";
import { SAMPLE_AS_OF, buildSamplePortfolio } from "./samplePortfolio";

const RANGE_DAYS: Record<PortfolioTimeframe, number> = { "7D": 7, "1M": 30, "3M": 90, "6M": 180, "1Y": 365, ALL: 365 };

/**
 * The sample portfolio (WP36), rendered with the real dashboard components,
 * read-only. Loaded with next/dynamic only after "Explore a sample
 * portfolio", so its data and builder are never in /portfolio's initial
 * JavaScript. Makes no request and saves nothing; the fee field applies to
 * this view only.
 */
export default function PortfolioSampleView({
  currency,
  onExit,
  onImport,
}: {
  currency: Currency;
  onExit: () => void;
  onImport: () => void;
}) {
  const [fee, setFee] = useState(EXIT_FEE_DEFAULT_PCT);
  const [timeframe, setTimeframe] = useState<PortfolioTimeframe>("1Y");
  const [showBenchmark, setShowBenchmark] = useState(true);
  const sample = useMemo(() => buildSamplePortfolio(EXIT_FEE_DEFAULT_PCT), []);
  const history = useMemo(() => sample.history.slice(-(RANGE_DAYS[timeframe] + 1)), [sample, timeframe]);
  const a = sample.analytics;

  return (
    <div className="space-y-5 md:space-y-6">
      <div role="note" className="flex flex-col gap-3 rounded-card border border-line bg-surface-alt p-4 md:flex-row md:items-center">
        <p className="min-w-0 flex-1 text-small text-ink">
          <span className="font-semibold">Sample portfolio.</span> Made-up purchases valued with generated prices as of{" "}
          {formatDateOnly(SAMPLE_AS_OF)}, not market data. Nothing here is saved.
        </p>
        <div className="flex gap-2">
          <Button variant="primary" onClick={onImport}>
            Import from Collectr
          </Button>
          <Button variant="ghost" onClick={onExit}>
            Close the sample
          </Button>
        </div>
      </div>
      <PortfolioSummary
        analytics={a}
        loading={false}
        errorText={null}
        currency={currency}
        exitFeePct={fee}
        onExitFeeCommit={setFee}
      />
      <div className="grid gap-5 md:gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PortfolioChart
            data={history}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            currency={currency}
            benchmark={a.benchmarkSeries}
            fx={a.fx}
            showBenchmark={showBenchmark}
            onShowBenchmarkChange={setShowBenchmark}
            indexDay={a.benchmark.indexDay}
            benchmarkNote={benchmarkCoverageText(a.benchmark)}
          />
        </div>
        <AllocationPanel
          allocation={a.allocation}
          concentration={a.concentration}
          currency={currency}
          fxNow={a.fxNow}
          loading={false}
        />
      </div>
      <HoldingsTable holdings={sample.holdings} analytics={a} currency={currency} readOnly />
    </div>
  );
}
```

`statsRow` builds a complete `ProductDailyStats` literal, so it must list every field the interface has when you implement. WP28 adds five required fields (`msrp_multiple`, `cost_per_pack_usd`, `nav_usd`, `premium_to_packs_pct`, `nav_status`) and WP33 adds `max_dd_365d_pct`; if either merged first, `tsc` names the missing keys: add each as `null` here and in the Tests 3 `statsRow` helper (and in `test-utils/portfolioAnalyticsFixture.ts`). Never cast the literal to silence it.

With the formulas above the sample is worth US$3,116.42 (C$4,342.73 at its rate of 1.3935) against US$2,459.22 of cost (+26.7%; in CAD +C$982.55, of which market move +C$900.09 and currency move +C$82.46), the same money in the index returns +20.9% (so +5.9 points), it raises one concentration flag (Evolving Skies Booster Box, 52.4%), and the bands Under 1 week, 1 to 4 weeks and Over 1 month all appear. Tests item 9 pins these numbers.

### Step 21. `app/components/Portfolio/PortfolioDashboard.tsx`: wire it together

Replace the whole file with the version below. It keeps WP05's data flow (`applyHoldingSaved`, `applyHoldingDeleted`, `refresh`, history loading), WP14's per-edit modal mount, WP15's `ConfirmDialog` delete flow and copy, WP20's `useCurrency()`, and WP31's `?add=` pre-fill.

```tsx
"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { usePortfolioData } from "./hooks";
import { usePortfolioAnalytics } from "./hooks/usePortfolioAnalytics";
import { useCurrency } from "../../context/CurrencyContext";
import { deleteHolding, updateExitFee } from "../../lib/portfolioApi";
import { EXIT_FEE_DEFAULT_PCT } from "../../lib/portfolioExit";
import Button from "../ui/Button";
import ConfirmDialog from "../ui/ConfirmDialog";
import Skeleton from "../ui/Skeleton";
import PortfolioSummary from "./shared/PortfolioSummary";
import PortfolioChart from "./shared/PortfolioChart";
import AllocationPanel from "./shared/AllocationPanel";
import type { FeeStatus } from "./shared/ExitFeeField";
import HoldingsTable from "./cards/HoldingsTable";
import AddHoldingModal from "./cards/AddHoldingModal";
import EditHoldingModal from "./cards/EditHoldingModal";
import ImportHoldingsModal from "./cards/ImportHoldingsModal";
import PortfolioEmptyState from "./PortfolioEmptyState";
import { benchmarkCoverageText, holdingName } from "./portfolioDisplay";
import { EMPTY_FX_SERIES } from "../../lib/fx";
import type { HoldingWithProduct } from "../../types/portfolio";

// The sample portfolio and its builder load only when asked for (WP36).
const PortfolioSampleView = dynamic(() => import("./demo/PortfolioSampleView"), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});

/** ?add=<positive integer> from the current URL, or null (WP31). */
function readAddParam(): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("add");
  return raw && /^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : null;
}

export default function PortfolioDashboard() {
  const { currency } = useCurrency();
  const {
    portfolio,
    holdings,
    history,
    loading,
    historyLoading,
    error,
    timeframe,
    setTimeframe,
    refresh,
    applyHoldingSaved,
    applyHoldingDeleted,
  } = usePortfolioData();
  const analyticsState = usePortfolioAnalytics(portfolio?.id ?? null, holdings);
  const analytics = analyticsState.analytics;

  const [addProductId, setAddProductId] = useState<number | null>(readAddParam);
  const [isAddModalOpen, setIsAddModalOpen] = useState(() => addProductId !== null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [editingHolding, setEditingHolding] = useState<HoldingWithProduct | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HoldingWithProduct | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showSample, setShowSample] = useState(false);
  const [showBenchmark, setShowBenchmark] = useState(true);
  const [feeOverride, setFeeOverride] = useState<number | null>(null);
  const [feeStatus, setFeeStatus] = useState<FeeStatus>("idle");

  const exitFeePct = feeOverride ?? portfolio?.exit_fee_pct ?? EXIT_FEE_DEFAULT_PCT;

  // Only the newest save may set the status: two quick commits (12, then
  // 12.5) must never end on the first one's "Saved" after the second failed.
  const feeSaveSeq = useRef(0);
  const handleExitFeeCommit = useCallback(async (pct: number) => {
    const seq = ++feeSaveSeq.current;
    setFeeOverride(pct);
    setFeeStatus("saving");
    const result = await updateExitFee(pct);
    if (seq === feeSaveSeq.current) setFeeStatus(result.ok ? "saved" : "error");
  }, []);

  const handleDelete = useCallback(
    (holdingId: number) => {
      const holding = holdings.find((h) => h.id === holdingId);
      if (!holding) return;
      setDeleteError(null);
      setPendingDelete(holding);
    },
    [holdings]
  );

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const holdingId = pendingDelete.id;
    setDeleteLoading(holdingId);
    setDeleteError(null);
    const success = await deleteHolding(holdingId);
    setDeleteLoading(null);
    if (success) {
      applyHoldingDeleted(holdingId);
      setPendingDelete(null);
    } else {
      setDeleteError("We couldn't delete this holding. Please try again.");
    }
  };

  const openImport = useCallback(() => {
    setShowSample(false);
    setIsImportModalOpen(true);
  }, []);

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <p role="status" className="sr-only">
          Loading your portfolio…
        </p>
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
        <p role="alert" className="text-body text-ink">
          {error}
        </p>
        <Button variant="primary" onClick={refresh}>
          Try again
        </Button>
      </div>
    );
  }

  const empty = holdings.length === 0;

  return (
    <div className="space-y-5 md:space-y-6">
      {showSample ? (
        <PortfolioSampleView currency={currency} onExit={() => setShowSample(false)} onImport={openImport} />
      ) : empty ? (
        <PortfolioEmptyState
          onImport={openImport}
          onAdd={() => setIsAddModalOpen(true)}
          onSample={() => setShowSample(true)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" onClick={openImport}>
              Import from Collectr
            </Button>
            <Button variant="primary" onClick={() => setIsAddModalOpen(true)}>
              Add holding
            </Button>
          </div>

          <PortfolioSummary
            analytics={analytics}
            loading={analyticsState.loading}
            errorText={analyticsState.errorText}
            onRetry={analyticsState.retry}
            currency={currency}
            exitFeePct={exitFeePct}
            onExitFeeCommit={handleExitFeeCommit}
            feeStatus={feeStatus}
          />

          <div className="grid gap-5 md:gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <PortfolioChart
                data={history}
                timeframe={timeframe}
                onTimeframeChange={setTimeframe}
                currency={currency}
                benchmark={analytics?.benchmarkSeries ?? null}
                fx={analytics?.fx ?? EMPTY_FX_SERIES}
                showBenchmark={showBenchmark}
                onShowBenchmarkChange={setShowBenchmark}
                indexDay={analytics?.benchmark.indexDay ?? null}
                benchmarkNote={analytics ? benchmarkCoverageText(analytics.benchmark) : null}
                loading={historyLoading}
              />
            </div>
            <AllocationPanel
              allocation={analytics?.allocation ?? null}
              concentration={analytics?.concentration ?? []}
              currency={currency}
              fxNow={analytics?.fxNow ?? null}
              loading={analyticsState.loading}
            />
          </div>

          <HoldingsTable
            holdings={holdings}
            analytics={analytics}
            currency={currency}
            onEdit={setEditingHolding}
            onDelete={handleDelete}
          />
        </>
      )}

      {/* Add Modal: mounted only while open (WP05), pre-filled from ?add= (WP31). */}
      {portfolio && isAddModalOpen && (
        <AddHoldingModal
          isOpen
          initialProductId={addProductId}
          onClose={() => {
            setIsAddModalOpen(false);
            if (addProductId !== null) {
              setAddProductId(null);
              window.history.replaceState(window.history.state, "", window.location.pathname);
            }
          }}
          onSuccess={applyHoldingSaved}
        />
      )}

      {/* Edit Modal: mounted per edit, keyed by holding (WP14). */}
      {editingHolding && (
        <EditHoldingModal
          key={editingHolding.id}
          holding={editingHolding}
          isOpen
          onClose={() => setEditingHolding(null)}
          onSuccess={applyHoldingSaved}
        />
      )}

      {/* Import Modal */}
      {portfolio && (
        <ImportHoldingsModal isOpen={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} onSuccess={refresh} />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this holding?"
          confirmLabel="Delete holding"
          busyLabel="Deleting…"
          tone="danger"
          busy={deleteLoading === pendingDelete.id}
          error={deleteError}
          onConfirm={confirmDelete}
          onDismiss={() => {
            setPendingDelete(null);
            setDeleteError(null);
          }}
        >
          <p>{holdingName(pendingDelete)} will be removed from your portfolio. This cannot be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
```

If WP31 has not landed (Before you start, soft check printed nothing): delete `readAddParam`, the `addProductId` state, the `initialProductId={addProductId}` prop and the `if (addProductId !== null) { ... }` block in `onClose`, and initialise `isAddModalOpen` with `useState(false)`.

`app/portfolio/page.tsx` does not change (WP20 and WP27 already moved the currency control to the header; WP34's `PortfolioTabs` stays above the dashboard).

### Step 22. Metric definitions and `/methodology`

22a. `app/lib/metricDefinitions.ts`: add the imports

```ts
import { EXIT_FEE_DEFAULT_PCT } from "./portfolioExit";
```

and, inside `DEFINITIONS`, directly before the closing `] as const;` (after the last entry, whichever package added it), append:

```ts
  // Portfolio (WP36)
  def({ key: "portfolioMarketValue", label: "Market value", unitLabel: "currency", window: "latest TCGplayer day", short: "Quantity times Market Price for each holding with a current price. Withheld prices are left out.", anchor: "portfolio-pl" }),
  def({ key: "portfolioDayChange", label: "Day change", unitLabel: "currency", window: "1 day", short: "Change in market value since each product's previous recorded price, for holdings repriced in the last day.", anchor: "portfolio-pl" }),
  def({ key: "unrealisedPl", label: "Unrealized P/L", unitLabel: "currency", window: "since purchase", short: "Market value minus what you paid, for holdings with a current price. CAD cost uses the purchase-date rate.", anchor: "portfolio-pl" }),
  def({ key: "plContribution", label: "Contribution", unitLabel: "points", window: "since purchase", short: "A holding's P/L as points of your priced cost. The contributions add up to your total return.", anchor: "portfolio-pl" }),
  def({ key: "currencyEffect", label: "Currency move", unitLabel: "CAD", window: "since purchase", short: "The part of a CAD gain or loss caused by the US dollar moving against the Canadian dollar since purchase.", anchor: "portfolio-currency" }),
  def({ key: "exitValue", label: "Exit value", unitLabel: "currency", window: "latest TCGplayer day", short: `Market value less your selling-fee assumption (default ${EXIT_FEE_DEFAULT_PCT}%): roughly what selling would net.`, anchor: "exit-value" }),
  def({ key: "daysToExit", label: "Days to exit", unitLabel: "band", window: "30 days of sales", short: "Units you hold divided by the product's TCGplayer units sold per day over 30 days, as a band.", anchor: "days-to-exit" }),
  def({ key: "vsSealedIndex", label: "vs Sealed Index", unitLabel: "points", window: "since each purchase", short: "Your return minus the return of the same money put in the Pokéfin Sealed Index on each purchase date.", anchor: "portfolio-benchmark" }),
```

Every `short` is at most 120 characters (WP24's test enforces it; the longest, `portfolioDayChange`, is 107).

22b. `app/content/methodology.ts`:
- Note the current `METHODOLOGY_VERSION` (`PREV_VERSION`) and `METHODOLOGY_EFFECTIVE_DATE` (`PREV_DATE`). Set `METHODOLOGY_VERSION` to the next minor version above `PREV_VERSION` (for example "1.6" to "1.7") and `METHODOLOGY_EFFECTIVE_DATE` to today (`date -u +%F`).
- In `METHODOLOGY_SECTIONS`, insert `{ anchor: "portfolio", title: "Portfolio figures" },` directly after the `index` entry.
- Append to `METHODOLOGY_SUBSECTIONS`:

```ts
  { anchor: "portfolio-pl", title: "Value, P/L and contribution", parent: "portfolio" },
  { anchor: "portfolio-currency", title: "Cost in the currency you paid", parent: "portfolio" },
  { anchor: "portfolio-benchmark", title: "Same money in the Sealed Index", parent: "portfolio" },
  { anchor: "exit-value", title: "Exit value after selling fees", parent: "portfolio" },
  { anchor: "days-to-exit", title: "Days to exit and concentration", parent: "portfolio" },
```

- In `METHODOLOGY_CHANGES`, turn the first entry's `version: METHODOLOGY_VERSION, date: METHODOLOGY_EFFECTIVE_DATE` into the literals `version: "<PREV_VERSION>", date: "<PREV_DATE>"` (same summary) and insert above it:

```ts
  {
    version: METHODOLOGY_VERSION,
    date: METHODOLOGY_EFFECTIVE_DATE,
    summary:
      "Portfolio figures: cost in the currency you paid at the Bank of Canada rate of the purchase date, CAD P/L split into market and currency moves, the same money in the Sealed Index, exit value after selling fees, days to exit and concentration flags. Portfolio charts convert CAD at each day's rate.",
  },
```

22c. `app/methodology/MethodologyArticle.tsx`: add the imports

```tsx
import {
  CONCENTRATION_THRESHOLD_PCT,
  EXIT_BAND_MONTH_DAYS,
  EXIT_BAND_WEEK_DAYS,
  EXIT_FEE_DEFAULT_PCT,
  EXIT_FEE_MAX_PCT,
  EXIT_FEE_MIN_PCT,
} from "../lib/portfolioExit";
import { INDEX_LEVEL_MAX_GAP_DAYS, INDEX_STALE_AFTER_DAYS } from "../lib/portfolioAnalytics";
```

(add `FX_CARRY_MAX_DAYS` to the existing `../lib/fx` import, or import it if WP25 imported nothing from there), and directly after the closing `</Section>` of `<Section id="index">`, add:

```tsx
          <Section id="portfolio">
            <p>
              Portfolio figures follow the price rules above. A holding whose price is withheld counts for nothing in
              value, P/L, exit value, allocation and the index comparison, and each figure says how many holdings it
              covers. Nothing here is a recommendation: the figures describe recorded prices.
            </p>
            <Sub id="portfolio-pl">
              <p>
                Market value = quantity × Market Price, for holdings with a current price. Unrealized P/L = market
                value − cost, over the same holdings. Contribution = a holding&apos;s P/L ÷ the cost of all priced
                holdings, in percentage points, so the contributions add up to the total return. Day change = the sum
                of quantity × (price − price ÷ (1 + 1-day change)) over holdings repriced in the last day.
              </p>
            </Sub>
            <Sub id="portfolio-currency">
              <p>
                Each purchase keeps the currency you paid in. A Canadian-dollar price is stored exactly as entered and
                converted to US dollars at the Bank of Canada rate of the purchase date (the newest rate on or before
                it, carried at most {FX_CARRY_MAX_DAYS} days), so it can be compared with US Market Prices. A purchase
                date without a rate is refused rather than converted at a guess.
              </p>
              <p>
                In Canadian dollars, cost uses the purchase-date rate and value uses today&apos;s rate. CAD P/L =
                market move + currency move, where market move = (value − cost, in US dollars) × the purchase-date
                rate, and currency move = value in US dollars × (today&apos;s rate − the purchase-date rate). A
                US-dollar purchase whose date has no rate has no CAD cost and is left out of CAD totals.
              </p>
            </Sub>
            <Sub id="portfolio-benchmark">
              <p>
                Same money in the Sealed Index puts each purchase&apos;s cost into the Pokéfin Sealed Index on its
                purchase date and values it at the index&apos;s latest published day: cost × latest level ÷ level on
                the purchase date. The level on a day is the newest published level on or before it, at most{" "}
                {INDEX_LEVEL_MAX_GAP_DAYS} days older (weekly levels cover history before daily collection). vs Sealed
                Index = your return − the index&apos;s return on the same money, in percentage points, over holdings
                with a current price bought on or after the index&apos;s first day. It is withheld when the index has
                not been published for more than {INDEX_STALE_AFTER_DAYS} days.
              </p>
              <p>
                This is a money-matched comparison: it answers &quot;did my purchases beat buying the index on the
                same days?&quot;. It is not a time-weighted return.
              </p>
            </Sub>
            <Sub id="exit-value">
              <p>
                Exit value = market value × (1 − selling fees). The fee assumption covers marketplace fees, payment
                processing and shipping; it defaults to {EXIT_FEE_DEFAULT_PCT}% and you can set it from{" "}
                {EXIT_FEE_MIN_PCT}% to {EXIT_FEE_MAX_PCT}% for your portfolio. Net of cost = exit value − cost.
              </p>
            </Sub>
            <Sub id="days-to-exit">
              <p>
                Days to exit = the units of a product you hold ÷ (units sold on TCGplayer in the last 30 days ÷ 30),
                counting every purchase of that product. Under {EXIT_BAND_WEEK_DAYS} days is &quot;Under 1
                week&quot;, {EXIT_BAND_WEEK_DAYS} to {EXIT_BAND_MONTH_DAYS} days is &quot;1 to 4 weeks&quot;, more,
                or no sales in 30 days, is &quot;Over 1 month&quot;, and no recent sales data is &quot;Unknown&quot;.
                It assumes you could sell at the whole market&apos;s recent pace, so it is the fastest plausible exit,
                not a quote.
              </p>
              <p>
                A product, or a set, holding more than {CONCENTRATION_THRESHOLD_PCT}% of your priced value is flagged
                as concentrated.
              </p>
            </Sub>
          </Section>
```

If `Section` and `Sub` take their titles from `METHODOLOGY_SECTIONS`/`METHODOLOGY_SUBSECTIONS` by id (WP24), nothing else is needed; if they take a `title` prop, pass the titles from 22b.

22d. `#limits`: find the `{/* WP31 and WP36 remove this bullet */}` comment and the bullet under it. Its text is WP25's ("Product and portfolio charts still convert CAD history at the latest rate ...") or, if WP31 merged first, WP31's ("Portfolio charts still convert CAD history at the latest rate ..."); find it by the comment, not by the text.
- If Before you start's last soft check printed a file (the product page already converts by date): delete the bullet and the comment.
- Otherwise replace the bullet's text with `Product charts still convert CAD history at the latest rate until they move to the daily rates described under Canadian dollars.` and the comment with `{/* WP31 removes this bullet */}`.
- If neither the bullet nor the comment exists, change nothing here.

22e. Update WP24's methodology test (`app/methodology/__tests__/MethodologyArticle.test.tsx`): the `#changes` row-count assertion becomes the previous count plus one, and add: `#portfolio` exists, and `#portfolio-benchmark` contains "money-matched" and "not a time-weighted return"; `#exit-value` contains `${EXIT_FEE_DEFAULT_PCT}%`; `#days-to-exit` contains `${CONCENTRATION_THRESHOLD_PCT}%`. Check: `grep -cP '\x{2014}' app/methodology/MethodologyArticle.tsx` prints 0.

### Step 23. Conventions baseline, budgets, docs

23a. `app/__tests__/uiConventions.baseline.json` (WP23 ratchet): this package lowers counts (no hex in `charts/PortfolioChartImpl.tsx`, `AllocationChartImpl.tsx` deleted, no `--pf-pokeball` in the portfolio files), so regenerate it:

```bash
cd frontend
UPDATE_UI_BASELINE=1 pnpm exec jest app/__tests__/uiConventions.test.ts
git diff app/__tests__/uiConventions.baseline.json   # only lowered or removed entries; no new file, no higher count
pnpm exec jest app/__tests__/uiConventions.test.ts   # passes without the variable
```

If the diff adds an entry or raises a count, a new file uses hex or brand red: fix the file, not the baseline.

23b. `perf-budgets.json`: no new route (the analytics route is an API route). Do not edit it unless Verification block 4 shows `/portfolio` over its limit while at or under its 180 kB target. Then set `routes./portfolio.jsGzKb.limit` by hand to `ceil(measured × 1.05)` (`pnpm perf:budget --write-limits` only fills `null` limits) and put `Perf budget raise: routes./portfolio.jsGzKb <reason>` in the PR body; WP22's CI check requires that line. Above 180 kB: stop and shrink (step 21 must not import the sample portfolio, the builder or Recharts statically).

23c. `README.md`, Database section: below WP25's "#### Market analytics tables (WP25)" block (or at the end of the section if it is absent), add:

```markdown
#### Portfolio currency and exit fee (WP36)

- `portfolio_holdings` and `portfolio_lots` carry `purchase_currency` ('USD'
  or 'CAD') and `purchase_price_native` (the price as entered). For a CAD row
  the trigger `apply_purchase_currency()` stores `purchase_price_usd` =
  native / the Bank of Canada rate of `purchase_date` from `fx_daily`; a date
  without a rate is refused with SQLSTATE PF001. `portfolios.exit_fee_pct`
  (default 15, 0 to 50) is the selling-fee assumption behind "exit value".
- `migrations/0040_portfolio_lot_currency.sql` patches `export_my_data()` in
  place. Re-run 0040 after applying any migration numbered below it that
  replaces `export_my_data()` (0038, 0039), and keep the keys
  `purchase_currency`, `purchase_price_native` and `exit_fee_pct` in any
  future replacement.
```

23d. `audits/HARDENING_FOLLOWUPS.md` section 7: add, as the newest bullet of the newest-first run of migration bullets (leave the date for the owner): "**Migration 0040 applied** (date, via Supabase MCP). Purchase currency and native price on holdings and lots with a conversion trigger at the purchase-date Bank of Canada rate (SQLSTATE PF001 when no rate), `portfolios.exit_fee_pct`, and `export_my_data()` patched in place with the three keys. **Open:** re-run 0040 after 0038 or 0039 is applied if either lands after it." Do not write "applied" with a date yourself; the owner fills it in.

### Step 24. Phase B: generated types

After the owner has applied 0040 (Owner action 1):

```bash
cd frontend
SUPABASE_ACCESS_TOKEN=... pnpm types:db          # or use the file the owner pushed
grep -c "purchase_currency\|purchase_price_native\|exit_fee_pct" app/types/database.ts   # 9 or more
pnpm exec tsc --noEmit                            # exit 0
```

Do not edit the generated file. `purchase_price_native` is `number | null` in the Row type and `exit_fee_pct` is `number`; `HoldingWithProduct` (optional fields) accepts both.

## Pitfalls: do not do this

- **Do not redefine `export_my_data()` in full in 0040**, and do not write the text `FUNCTION public.export_my_data` anywhere in the file. A full body would drop WP34's and WP35's keys and would confuse their "which file defines it" check (step 1d, 1e).
- **Do not compute `purchase_price_usd` for a CAD lot in the browser or from `useCurrency().exchangeRate`.** The database converts at the purchase-date rate; the route sends the native price as a placeholder. Today's rate is only a pre-fill in the add form.
- **Do not convert CAD history or cost at today's rate** anywhere on `/portfolio`. CAD figures come from the analytics payload (`fx_daily` of each day); with no rate, show the USD figure with its code, never a guessed CAD figure.
- **Do not count a withheld price as zero, and do not substitute `products.usd_price`** for a holding WP05's guard nulled. Value, P/L, exit value, allocation and the benchmark skip it; the counts say so.
- **Do not label the benchmark a time-weighted return, "beta", "alpha" or "the market"**: it is "Same money in the Pokéfin Sealed Index". Never call the index cap-weighted.
- **Do not show "live", "real-time", "all-time" or "TCGPlayer"**, and no em dashes, in any new or changed file (WP15 and WP24 conventions tests).
- **Do not import `lib/portfolioAnalytics.ts`, `demo/*` or Recharts statically** from `PortfolioDashboard` or any component it renders eagerly. `portfolioAnalytics.ts` is for the route and the lazy sample; client components use `portfolioExit.ts` and `portfolioDisplay.ts`.
- **Do not create a portfolio from the analytics route.** `GET /api/portfolio/analytics` reads; only `GET /api/portfolio` and the writes create.
- **Do not send the price in the edit dialog when it is unchanged.** That is what keeps a CAD lot (and a 4-decimal Collectr price) exact.
- **Do not fetch analytics for an empty portfolio** or in the sample view; the sample makes no request at all.
- **Do not put a link and a button in one element.** Phone rows: the product link is the text block; edit and delete are sibling buttons.
- **Do not add a pie, a donut or a second colour palette** for allocation; bars use `--pf-chart-line` on the `bg-chart-grid` track.
- **Do not remove the `PortfolioTimeframe` "ALL" member**: WP05's hook maps it; only the button goes.
- **Do not touch `app/portfolio/page.tsx`**: WP34 may be editing it in parallel.
- **Do not record a sale or realised P/L.** Out of scope (deferred).

## Tests

Every numeric expectation below was computed by running the step 5, 6 and 20b code (Tests 3, 5 and 9) or the step 1 SQL (Tests 1) while this spec was written.

### 1. `tests/test_wp36_portfolio_currency_db.py` (new, needs the replayed database)

14 cases; all passed against step 1 on PostgreSQL 16.13. The `fx` fixture inserts one week of 2019 rates only where `fx_daily` has no row for that day, and deletes only what it inserted.

```python
"""
Database checks for migration 0040 (purchase currency, exit fee, WP36), run
against a database rebuilt by scripts/db/replay_migrations.sh.

Skipped unless POKEFIN_TEST_DATABASE_URL points at that replayed database as a
superuser (CI sets it; job "database"). NEVER point it at production: the
fixtures write rows.

  POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/replay_once \
    python -m pytest tests/test_wp36_portfolio_currency_db.py -v
"""
import os
import uuid
from datetime import date
from decimal import Decimal
from urllib.parse import urlparse

import pytest

DSN = os.environ.get("POKEFIN_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="POKEFIN_TEST_DATABASE_URL not set")

psycopg = pytest.importorskip("psycopg")
from psycopg import errors  # noqa: E402

TAG = "wp36-" + uuid.uuid4().hex[:8]

# Bank of Canada rates for a week in 2019, as fx_daily (0034) stores them:
# Friday's rate carried over the weekend. The June pair is a carried row
# whose own day (Jun 13) is recent but whose Bank of Canada date (Jun 3) is
# 10 days older: the carry cap counts from Jun 3.
FX_ROWS = [
    (date(2019, 3, 1), 1.3150, date(2019, 3, 1), "boc"),
    (date(2019, 3, 2), 1.3150, date(2019, 3, 1), "carry_forward"),
    (date(2019, 3, 3), 1.3150, date(2019, 3, 1), "carry_forward"),
    (date(2019, 3, 4), 1.3320, date(2019, 3, 4), "boc"),
    (date(2019, 6, 3), 1.3400, date(2019, 6, 3), "boc"),
    (date(2019, 6, 13), 1.3400, date(2019, 6, 3), "carry_forward"),
]


@pytest.fixture(scope="module")
def admin():
    host = (urlparse(DSN).hostname or "").lower()
    assert host in ("localhost", "127.0.0.1", "postgres"), "refusing a non-local database"
    with psycopg.connect(DSN, autocommit=True) as conn:
        yield conn


@pytest.fixture(scope="module")
def fx(admin):
    """Insert the test week unless a row for that day exists; remove only ours."""
    mine = []
    for day, rate, source_date, source in FX_ROWS:
        row = admin.execute(
            "INSERT INTO public.fx_daily (day, usd_to_cad, source_date, source) "
            "VALUES (%s, %s, %s, %s) ON CONFLICT (day) DO NOTHING RETURNING day",
            (day, rate, source_date, source),
        ).fetchone()
        if row:
            mine.append(row[0])
    rates = {
        d: r for d, r in admin.execute(
            "SELECT day, usd_to_cad FROM public.fx_daily WHERE day = ANY(%s)",
            ([row[0] for row in FX_ROWS],),
        ).fetchall()
    }
    yield rates
    for day in mine:
        admin.execute("DELETE FROM public.fx_daily WHERE day = %s", (day,))


@pytest.fixture(scope="module")
def product(admin):
    set_id = admin.execute(
        "INSERT INTO public.sets (code, name) VALUES (%s, %s) RETURNING id", (TAG, TAG + " set")
    ).fetchone()[0]
    pid = admin.execute(
        "INSERT INTO public.products (set_id, usd_price, url, last_updated) "
        "VALUES (%s, 100, 'https://www.tcgplayer.com/product/1', now()) RETURNING id",
        (set_id,),
    ).fetchone()[0]
    yield pid
    admin.execute("DELETE FROM public.portfolio_holdings WHERE product_id = %s", (pid,))
    admin.execute("DELETE FROM public.products WHERE id = %s", (pid,))
    admin.execute("DELETE FROM public.sets WHERE id = %s", (set_id,))


def new_user(admin):
    uid = str(uuid.uuid4())
    name = "u" + uuid.uuid4().hex[:10]
    admin.execute(
        "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (%s, %s, %s)",
        (uid, f"{name}@example.com", psycopg.types.json.Jsonb({"username": name})),
    )
    return uid


@pytest.fixture
def owner(admin):
    uid = new_user(admin)
    pid = admin.execute(
        "INSERT INTO public.portfolios (user_id) VALUES (%s) "
        "ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id RETURNING id",
        (uid,),
    ).fetchone()[0]
    yield uid, pid
    admin.execute("DELETE FROM auth.users WHERE id = %s", (uid,))


def as_user(admin, uid):
    admin.execute("BEGIN")
    admin.execute("SET LOCAL ROLE authenticated")
    admin.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", (uid,))


def rollback(admin):
    admin.execute("ROLLBACK")


def insert_holding(admin, portfolio_id, product_id, *, currency, native, usd, day, qty=1):
    return admin.execute(
        "INSERT INTO public.portfolio_holdings "
        "(portfolio_id, product_id, quantity, purchase_price_usd, purchase_date, "
        " purchase_currency, purchase_price_native) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s) "
        "RETURNING id, purchase_currency, purchase_price_native, purchase_price_usd",
        (portfolio_id, product_id, qty, usd, day, currency, native),
    ).fetchone()


class TestCurrency:
    def test_cad_lot_converts_at_the_purchase_date_rate(self, admin, owner, product, fx):
        uid, portfolio_id = owner
        as_user(admin, uid)
        try:
            # 2019-03-03 is a Sunday: the carried Friday rate applies. The
            # placeholder purchase_price_usd (the native price) is replaced.
            _, currency, native, usd = insert_holding(
                admin, portfolio_id, product, currency="CAD", native=Decimal("129.99"), usd=129.99, day="2019-03-03"
            )
        finally:
            rollback(admin)
        assert currency == "CAD"
        assert native == Decimal("129.99")
        assert usd == pytest.approx(round(129.99 / fx[date(2019, 3, 3)], 6), abs=1e-9)

    def test_cad_lot_round_trips_exactly(self, admin, owner, product, fx):
        uid, portfolio_id = owner
        as_user(admin, uid)
        try:
            hid, _, _, usd_before = insert_holding(
                admin, portfolio_id, product, currency="CAD", native=Decimal("129.99"), usd=129.99, day="2019-03-04"
            )
            # The routes send the native price again as the placeholder on every edit.
            row = admin.execute(
                "UPDATE public.portfolio_holdings SET quantity = 3, purchase_currency = 'CAD', "
                "purchase_price_native = 129.99, purchase_price_usd = 129.99 WHERE id = %s "
                "RETURNING purchase_currency, purchase_price_native, purchase_price_usd, quantity",
                (hid,),
            ).fetchone()
        finally:
            rollback(admin)
        assert row == ("CAD", Decimal("129.99"), usd_before, 3)

    def test_changing_the_date_reconverts(self, admin, owner, product, fx):
        uid, portfolio_id = owner
        as_user(admin, uid)
        try:
            hid, *_ = insert_holding(
                admin, portfolio_id, product, currency="CAD", native=Decimal("100"), usd=100, day="2019-03-01"
            )
            usd = admin.execute(
                "UPDATE public.portfolio_holdings SET purchase_date = '2019-03-04' WHERE id = %s "
                "RETURNING purchase_price_usd",
                (hid,),
            ).fetchone()[0]
        finally:
            rollback(admin)
        assert usd == pytest.approx(round(100 / fx[date(2019, 3, 4)], 6), abs=1e-9)

    def test_no_rate_is_pf001(self, admin, owner, product, fx):
        uid, portfolio_id = owner
        as_user(admin, uid)
        try:
            with pytest.raises(psycopg.Error) as exc:
                insert_holding(
                    admin, portfolio_id, product, currency="CAD", native=Decimal("10"), usd=10, day="2019-01-10"
                )
        finally:
            rollback(admin)
        assert exc.value.sqlstate == "PF001"

    def test_carry_counts_from_the_boc_date(self, admin, owner, product, fx):
        uid, portfolio_id = owner
        as_user(admin, uid)
        try:
            # The newest row on or before Jun 17 is Jun 13, carried from the
            # Jun 3 Bank of Canada rate: 14 days from Jun 3, allowed.
            _, _, _, usd = insert_holding(
                admin, portfolio_id, product, currency="CAD", native=Decimal("10"), usd=10, day="2019-06-17"
            )
            admin.execute("SAVEPOINT carry")
            # Jun 18 is 5 days after that row but 15 after its Bank of Canada date: refused.
            with pytest.raises(psycopg.Error) as exc:
                insert_holding(
                    admin, portfolio_id, product, currency="CAD", native=Decimal("10"), usd=10, day="2019-06-18"
                )
            admin.execute("ROLLBACK TO SAVEPOINT carry")
        finally:
            rollback(admin)
        assert usd == pytest.approx(round(10 / fx[date(2019, 6, 13)], 6), abs=1e-9)
        assert exc.value.sqlstate == "PF001"

    def test_cad_without_native_is_rejected(self, admin, owner, product, fx):
        uid, portfolio_id = owner
        as_user(admin, uid)
        try:
            with pytest.raises(errors.CheckViolation):
                insert_holding(admin, portfolio_id, product, currency="CAD", native=None, usd=10, day="2019-03-04")
        finally:
            rollback(admin)

    def test_unknown_currency_is_rejected(self, admin, owner, product, fx):
        uid, portfolio_id = owner
        as_user(admin, uid)
        try:
            with pytest.raises(errors.CheckViolation):
                insert_holding(admin, portfolio_id, product, currency="EUR", native=Decimal("10"), usd=10, day="2019-03-04")
        finally:
            rollback(admin)

    def test_usd_price_wins_for_a_usd_lot(self, admin, owner, product):
        uid, portfolio_id = owner
        as_user(admin, uid)
        try:
            row = insert_holding(
                admin, portfolio_id, product, currency="USD", native=Decimal("99"), usd=55.5, day="2019-03-04"
            )
        finally:
            rollback(admin)
        assert row[1:] == ("USD", Decimal("55.5"), 55.5)

    def test_switching_a_cad_lot_to_usd(self, admin, owner, product, fx):
        uid, portfolio_id = owner
        as_user(admin, uid)
        try:
            hid, *_ = insert_holding(
                admin, portfolio_id, product, currency="CAD", native=Decimal("135"), usd=135, day="2019-03-04"
            )
            row = admin.execute(
                "UPDATE public.portfolio_holdings SET purchase_currency = 'USD', purchase_price_usd = 80 "
                "WHERE id = %s RETURNING purchase_currency, purchase_price_native, purchase_price_usd",
                (hid,),
            ).fetchone()
        finally:
            rollback(admin)
        assert row == ("USD", Decimal("80"), 80.0)

    def test_legacy_insert_defaults_to_usd(self, admin, owner, product):
        uid, portfolio_id = owner
        as_user(admin, uid)
        try:
            row = admin.execute(
                "INSERT INTO public.portfolio_holdings (portfolio_id, product_id, quantity, purchase_price_usd, purchase_date) "
                "VALUES (%s, %s, 1, 42.5, '2019-03-04') RETURNING purchase_currency, purchase_price_native",
                (portfolio_id, product),
            ).fetchone()
        finally:
            rollback(admin)
        assert row == ("USD", Decimal("42.5"))


class TestExitFee:
    def test_default_and_range(self, admin, owner):
        uid, portfolio_id = owner
        assert admin.execute(
            "SELECT exit_fee_pct FROM public.portfolios WHERE id = %s", (portfolio_id,)
        ).fetchone()[0] == Decimal("15")
        as_user(admin, uid)
        try:
            fee = admin.execute(
                "UPDATE public.portfolios SET exit_fee_pct = 12.5 WHERE id = %s RETURNING exit_fee_pct",
                (portfolio_id,),
            ).fetchone()[0]
            assert fee == Decimal("12.5")
            with pytest.raises(errors.CheckViolation):
                admin.execute("UPDATE public.portfolios SET exit_fee_pct = 50.1 WHERE id = %s", (portfolio_id,))
        finally:
            rollback(admin)


class TestExport:
    def test_export_has_the_new_keys_and_keeps_the_rest(self, admin, owner, product, fx):
        uid, portfolio_id = owner
        as_user(admin, uid)
        try:
            insert_holding(admin, portfolio_id, product, currency="CAD", native=Decimal("129.99"), usd=129.99, day="2019-03-04")
            doc = admin.execute("SELECT public.export_my_data()").fetchone()[0]
        finally:
            rollback(admin)
        portfolio = doc["portfolios"][0]
        assert portfolio["exit_fee_pct"] == 15
        holding = portfolio["holdings"][0]
        assert holding["purchase_currency"] == "CAD"
        assert holding["purchase_price_native"] == 129.99
        assert {"profile", "portfolios", "box_recipes"} <= set(doc)

    def test_export_is_still_volatile_definer_and_not_for_anon(self, admin):
        row = admin.execute(
            "SELECT p.provolatile, p.prosecdef, has_function_privilege('anon', p.oid, 'EXECUTE') "
            "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
            "WHERE n.nspname = 'public' AND p.proname = 'export_my_data'"
        ).fetchone()
        assert row == ("v", True, False)

    def test_trigger_function_is_not_callable(self, admin):
        assert admin.execute(
            "SELECT has_function_privilege('authenticated', 'public.apply_purchase_currency()', 'EXECUTE')"
        ).fetchone()[0] is False
```

If a fixture INSERT fails with `NotNullViolation` or `CheckViolation` because `products` or `sets` gained a required column (for example after WP28), add that column with a valid value, as WP21's note says. Never weaken an assertion.

### 2. `tests/test_wp36_portfolio_currency_static.py` (new, no database)

```python
"""
Static checks for migration 0040 (WP36). No database needed.

  python -m pytest tests/test_wp36_portfolio_currency_static.py -v
"""
import importlib.util
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = Path(os.environ.get("POKEFIN_MIGRATIONS_DIR", ROOT / "migrations"))
MIGRATION = MIGRATIONS / "0040_portfolio_lot_currency.sql"
EXIT_TS = ROOT / "frontend" / "app" / "lib" / "portfolioExit.ts"
FX_TS = ROOT / "frontend" / "app" / "lib" / "fx.ts"


def _sql():
    return re.sub(r"--[^\n]*", "", MIGRATION.read_text())


def _volatility_module():
    spec = importlib.util.spec_from_file_location(
        "wp36_migration_volatility", ROOT / "tests" / "test_migration_volatility.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_is_rerunnable():
    sql = _sql()
    assert sql.count("ADD COLUMN IF NOT EXISTS") == 5
    assert sql.count("EXCEPTION WHEN duplicate_object THEN NULL") == 7
    for trigger in re.findall(r"CREATE TRIGGER (\w+)", sql):
        assert f"DROP TRIGGER IF EXISTS {trigger}" in sql
    assert "CREATE OR REPLACE FUNCTION public.apply_purchase_currency()" in sql
    assert "WHERE purchase_price_native IS NULL" in sql


def test_export_is_patched_in_place_not_redefined():
    sql = _sql()
    # A full CREATE of export_my_data here would drop the keys 0038 and 0039
    # add whenever 0040 is applied after them, and would hide this file from
    # their "which file defines export_my_data" check.
    assert "FUNCTION public.export_my_data" not in sql
    assert "pg_get_functiondef('public.export_my_data()'::regprocedure)" in sql
    for key in ("'purchase_currency', h.purchase_currency", "'purchase_price_native', l.purchase_price_native",
                "'exit_fee_pct', p.exit_fee_pct"):
        assert key in sql


def test_later_redefinitions_keep_the_new_keys():
    fns = _volatility_module().effective_functions()
    name, _, body = fns["public.export_my_data"]
    if name[:4].isdigit() and name[:4] > "0040":
        for key in ("purchase_currency", "purchase_price_native", "exit_fee_pct"):
            assert key in body, f"{name} replaces export_my_data and drops '{key}' (WP36, 0040)"


def test_exit_fee_bounds_match_the_frontend():
    sql = _sql()
    ts = EXIT_TS.read_text()
    default = re.search(r"exit_fee_pct numeric NOT NULL DEFAULT (\d+)", sql).group(1)
    low, high = re.search(r"CHECK \(exit_fee_pct BETWEEN (\d+) AND (\d+)\)", sql).groups()
    assert re.search(rf"export const EXIT_FEE_DEFAULT_PCT = {default};", ts)
    assert re.search(rf"export const EXIT_FEE_MIN_PCT = {low};", ts)
    assert re.search(rf"export const EXIT_FEE_MAX_PCT = {high};", ts)


def test_fx_carry_matches_fx_ts():
    # Counted from source_date (the Bank of Canada date), as rateOn() counts it.
    carry = re.search(r"NEW\.purchase_date - v_source_date > (\d+)", _sql()).group(1)
    assert re.search(rf"export const FX_CARRY_MAX_DAYS = {carry};", FX_TS.read_text())
```

Regression signal (checked while writing): adding a file `migrations/0045_x.sql` that redefines `export_my_data` without the keys fails `test_later_redefinitions_keep_the_new_keys`; with only the real files all 5 pass, and `tests/test_migration_volatility.py` still passes (the new trigger function is VOLATILE and writes nothing).

### 3. `frontend/app/lib/__tests__/portfolioAnalytics.test.ts` (new, node)

```ts
/** @jest-environment node */
import { buildFxSeries, type FxDailyRow } from "../fx";
import type { ProductStatsSnapshot } from "../marketStats";
import { buildPortfolioAnalytics, buildLevelLookup, dayChange } from "../portfolioAnalytics";
import type { ProductDailyStats } from "../../types/market";
import type { HoldingWithProduct } from "../../types/portfolio";

const DAY = 86_400_000;
const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// fx_daily: 1.40 until 2026-03-01, 1.35 until 2026-09-28, 1.38 from 2026-09-29.
const fxRows: FxDailyRow[] = [];
for (let ms = Date.UTC(2025, 11, 1); ms <= Date.UTC(2026, 8, 30); ms += DAY) {
  const day = keyOf(ms);
  const rate = day < "2026-03-02" ? 1.4 : day < "2026-09-29" ? 1.35 : 1.38;
  fxRows.push({ day, usd_to_cad: rate, source_date: day, source: "boc" });
}
const fx = buildFxSeries(fxRows);

// Index: 100 on 2025-12-01, +0.1 a day, last published day 2026-09-29 (D-1).
const points: { day: string; level: number }[] = [];
for (let ms = Date.UTC(2025, 11, 1), level = 100; ms <= Date.UTC(2026, 8, 29); ms += DAY, level += 0.1) {
  points.push({ day: keyOf(ms), level: Math.round(level * 1e6) / 1e6 });
}
const L = (day: string) => (points.find((p) => p.day === day) as { level: number }).level;
const index = { code: "sealed", name: "Pokéfin Sealed Index", points };

function holding(over: {
  id: number;
  productId: number;
  price: number | null;
  quantity?: number;
  usd?: number;
  date?: string;
  currency?: "USD" | "CAD";
  native?: number;
  setId?: number;
}): HoldingWithProduct {
  const setId = over.setId ?? 1;
  return {
    id: over.id,
    portfolio_id: 1,
    product_id: over.productId,
    quantity: over.quantity ?? 1,
    purchase_price_usd: over.usd ?? 100,
    purchase_date: over.date ?? "2026-01-05",
    notes: null,
    purchase_currency: over.currency,
    purchase_price_native: over.native,
    created_at: "",
    updated_at: "",
    products: {
      id: over.productId,
      usd_price: over.price,
      price_recorded_at: over.price === null ? null : "2026-09-29T08:00:00",
      image_url: null,
      variant: null,
      url: null,
      sets: { id: setId, name: `Set ${setId}`, code: `S${setId}`, release_date: null, expansion_type: null, generations: { id: 9, name: "Scarlet & Violet" } },
      product_types: { id: 1, name: "booster_box", label: "Booster Box" },
    },
  };
}

function statsRow(productId: number, over: Partial<ProductDailyStats>): ProductDailyStats {
  return {
    day: "2026-09-29", product_id: productId, usd_price: 150, price_day: "2026-09-29", is_price_fresh: true,
    ret_1d: null, ret_7d: null, ret_30d: null, ret_90d: null, ret_365d: null, tracked_high_usd: null,
    tracked_high_day: null, first_tracked_day: null, dd_from_high_pct: null, high_52w: null, low_52w: null,
    pos_in_52w: null, distinct_prices_365d: null, obs_90d: null, vol_weekly_52w: null, units_sold_7d: null,
    units_sold_30d: null, tx_30d: null, active_listings: null, qty_available: null, lowest_ask_usd: null,
    listings_snapshot_date: null, ask_premium_pct: null, days_of_supply: null, sell_through_30d: null,
    qty_change_7d_pct: null, qty_change_30d_pct: null, liquidity_score: null, refreshed_at: "2026-09-30",
    ...over,
  };
}

const stats: ProductStatsSnapshot = {
  day: "2026-09-29",
  byProductId: {
    1: statsRow(1, { ret_1d: 10, usd_price: 150, units_sold_30d: 60 }),
    2: statsRow(2, { units_sold_30d: 3 }),
    3: statsRow(3, { usd_price: null, is_price_fresh: false, price_day: "2026-09-01", units_sold_30d: null }),
  },
};

const holdings = [
  // USD lot: 2 x $100 on 2026-01-05, now $150.
  holding({ id: 11, productId: 1, quantity: 2, usd: 100, date: "2026-01-05", price: 150 }),
  // CAD lot: C$135 on 2026-03-02 (rate 1.35, so $100), now $120.
  holding({ id: 12, productId: 2, usd: 100, currency: "CAD", native: 135, date: "2026-03-02", price: 120, setId: 2 }),
  // Price withheld (migration 0023): usd_price is null after WP05's guard.
  holding({ id: 13, productId: 3, usd: 80, date: "2026-02-01", price: null, setId: 3 }),
  // Bought before the index's first day.
  holding({ id: 14, productId: 1, usd: 90, date: "2025-06-01", price: 150 }),
];

const a = buildPortfolioAnalytics({ today: "2026-09-30", exitFeePct: 15, holdings, stats, fx, index });
const lot = (id: number) => a.lots.find((l) => l.holdingId === id)!;

describe("buildPortfolioAnalytics", () => {
  it("values a USD lot in USD and in CAD at the dated rates, with the market and currency split", () => {
    const l = lot(11);
    expect(l.valueUsd).toBeCloseTo(300);
    expect(l.plUsd).toBeCloseTo(100);
    expect(l.costCad).toBeCloseTo(280); // 200 x 1.40 on the purchase date
    expect(l.valueCad).toBeCloseTo(414); // 300 x 1.38 today
    expect(l.plCad).toBeCloseTo(134);
    expect(l.plCadMarket).toBeCloseTo(140); // 100 x 1.40
    expect(l.plCadFx).toBeCloseTo(-6); // 300 x (1.38 - 1.40)
  });

  it("keeps a CAD lot's cost basis exactly as entered", () => {
    const l = lot(12);
    expect(l.purchaseCurrency).toBe("CAD");
    expect(l.costCad).toBe(135);
    expect(l.fxAtPurchase).toBeCloseTo(1.35);
    expect(l.plCad).toBeCloseTo(120 * 1.38 - 135);
    expect(l.plNative).toBeCloseTo(120 * 1.38 - 135);
    expect((l.plCadMarket as number) + (l.plCadFx as number)).toBeCloseTo(l.plCad as number);
  });

  it("never values a withheld price", () => {
    const l = lot(13);
    expect([l.valueUsd, l.valueCad, l.plUsd, l.plCad, l.exitValueUsd, l.benchmarkUsd]).toEqual([null, null, null, null, null, null]);
    expect(l.benchmarkStatus).toBe("no_price");
    expect(l.priceDay).toBe("2026-09-01");
    expect(a.totals.priced).toBe(3);
    expect(a.totals.valueUsd).toBeCloseTo(300 + 120 + 150);
    expect(a.totals.usd.cost).toBeCloseTo(390);
    expect(a.totals.costUsdAll).toBeCloseTo(470);
    expect(a.allocation.unpricedLots).toBe(1);
  });

  it("invests each lot's cost in the index on its own purchase date", () => {
    const b11 = (200 * L("2026-09-29")) / L("2026-01-05");
    const b12 = (100 * L("2026-09-29")) / L("2026-03-02");
    expect(lot(11).benchmarkUsd).toBeCloseTo(b11);
    expect(lot(12).benchmarkUsd).toBeCloseTo(b12);
    expect(lot(14).benchmarkStatus).toBe("before_index");
    expect(a.benchmark.status).toBe("ok");
    expect([a.benchmark.coveredLots, a.benchmark.pricedLots, a.benchmark.beforeIndexLots]).toEqual([2, 3, 1]);
    expect(a.benchmark.indexDay).toBe("2026-09-29");
    const usd = a.benchmark.usd!;
    expect(usd.cost).toBeCloseTo(300);
    expect(usd.value).toBeCloseTo(420);
    expect(usd.benchmark).toBeCloseTo(b11 + b12);
    expect(usd.deltaPts).toBeCloseTo(((420 - 300) / 300 - (b11 + b12 - 300) / 300) * 100);
    expect(a.benchmark.cad!.cost).toBeCloseTo(280 + 135);
    expect(a.benchmark.cad!.value).toBeCloseTo(420 * 1.38);
  });

  it("builds the same-money series from each purchase date, ending on the index's last day", () => {
    const s = a.benchmarkSeries!;
    const at = (day: string) => s.usd[(Date.parse(day) - Date.parse(s.start)) / DAY];
    expect(s.usd).toHaveLength(366);
    expect(at("2026-01-04")).toBeNull();
    expect(at("2026-01-05")).toBeCloseTo(200);
    // The withheld lot stays in the series (the value line has it on the days it was priced).
    const b13 = (80 * L("2026-09-29")) / L("2026-02-01");
    expect(at("2026-09-29")).toBeCloseTo((200 * L("2026-09-29")) / L("2026-01-05") + (100 * L("2026-09-29")) / L("2026-03-02") + b13);
    expect(at("2026-09-30")).toBeNull();
  });

  it("computes exit value, days to exit on the product's total units, and contributions", () => {
    expect(lot(11).exitValueUsd).toBeCloseTo(255);
    expect(lot(11).productQuantity).toBe(3); // lots 11 and 14 hold product 1
    expect(lot(11).daysToExit).toBeCloseTo(1.5); // 3 / (60 / 30)
    expect(lot(11).exitBand).toBe("under_1w");
    expect(lot(12).exitBand).toBe("1_4w"); // 1 / (3 / 30) = 10 days
    expect(lot(13).exitBand).toBe("unknown");
    const sum = a.lots.reduce((s, l) => s + (l.contributionPctUsd ?? 0), 0);
    expect(sum).toBeCloseTo(a.totals.usd.plPct as number);
  });

  it("flags concentration once per product, not again for a one-product set", () => {
    expect(a.allocation.set[0].key).toBe("set-1");
    expect(a.allocation.set[0].sharePct).toBeCloseTo((450 / 570) * 100);
    expect(a.concentration.map((c) => `${c.kind}:${c.key}`)).toEqual(["product:product-1"]);
  });

  it("uses WP25's 1-day change only where the stats row is fresh", () => {
    expect(dayChange(holdings, stats)).toEqual({ changeUsd: 40.91, changePct: 10, covered: 2 });
  });

  it("withholds the benchmark when the index is stale or missing", () => {
    const stale = buildPortfolioAnalytics({ today: "2026-10-20", exitFeePct: 15, holdings, stats, fx, index });
    expect([stale.benchmark.status, stale.benchmark.reason, stale.benchmarkSeries]).toEqual(["unavailable", "index_stale", null]);
    const missing = buildPortfolioAnalytics({ today: "2026-09-30", exitFeePct: 15, holdings, stats, fx, index: { ...index, points: null } });
    expect(missing.benchmark.reason).toBe("index_unavailable");
    expect(missing.lots.every((l) => l.benchmarkStatus === "index_unavailable")).toBe(true);
  });

  it("returns null totals, not zero, when nothing can be valued", () => {
    const only = buildPortfolioAnalytics({ today: "2026-09-30", exitFeePct: 15, holdings: [holdings[2]], stats, fx, index });
    expect([only.totals.valueUsd, only.totals.usd.value, only.totals.usd.pl]).toEqual([null, null, null]);
    const empty = buildPortfolioAnalytics({ today: "2026-09-30", exitFeePct: 15, holdings: [], stats, fx, index });
    expect([empty.totals.valueUsd, empty.benchmark.reason, empty.concentration]).toEqual([0, "no_covered_lots", []]);
  });

  it("leaves a USD lot without a purchase-date rate out of the CAD totals", () => {
    const early = holding({ id: 15, productId: 1, usd: 50, date: "2025-01-10", price: 150 });
    const r = buildPortfolioAnalytics({ today: "2026-09-30", exitFeePct: 15, holdings: [holdings[0], early], stats, fx, index });
    expect(r.lots[1].costCad).toBeNull();
    expect([r.totals.priced, r.totals.cad.lots]).toEqual([2, 1]);
  });

  it("looks up index levels at most 7 days back", () => {
    const lookup = buildLevelLookup([{ day: "2026-01-05", level: 100 }, { day: "2026-01-12", level: 101 }])!;
    const n = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY;
    expect(lookup.levelOn(n("2026-01-11"))).toBe(100);
    expect(lookup.levelOn(n("2026-01-19"))).toBe(101);
    expect(lookup.levelOn(n("2026-01-20"))).toBeNull();
    expect(lookup.levelOn(n("2026-01-04"))).toBeNull();
  });
});
```

### 4. `frontend/app/lib/__tests__/portfolioExit.test.ts` (new, node)

- `daysToExit`: `(3, 60)` is `{ days: 1.5, band: "under_1w" }`; `(1, 3)` is 10 days, `"1_4w"`; `(7, 30)` is exactly 7 days, `"1_4w"`; `(30, 30)` is 30 days, `"1_4w"`; `(31, 30)` is `"over_1m"`; `(2, 0)` is `{ days: null, band: "over_1m" }`; `(2, null)` and `(0, 10)` are `{ days: null, band: "unknown" }`.
- `exitValueAfterFees(1000, 12.5)` is 875; `(null, 15)` is null; `(0, 15)` is 0.
- `normaliseExitFeePct`: `12.34` is 12.3; `0` is 0; `50` is 50; `50.01`, `-1`, `NaN`, `"15"` are null.
- `EXIT_BAND_LABELS` has the four strings of the Copy list.

### 5. `frontend/app/lib/__tests__/portfolioChart.test.ts` (new, node)

Build `fx` and the benchmark series exactly as in Tests 3 (reuse the same constants; copy them, do not import from another test file). With `hist = [{ date: "2026-03-01", value: 300, priced_products: 2, held_products: 2 }, { date: "2026-03-02", value: 420, priced_products: 2, held_products: 3 }, { date: "2026-09-30", value: 570, priced_products: 3, held_products: 3 }]`:
- `buildPortfolioChartModel(hist, a.benchmarkSeries, fx, "CAD")`: row values `300 × 1.4` and `420 × 1.35` (dated rates, not today's 1.38); row 2's benchmark is `(200 × L(Mar 2) / L(Jan 5) + 100 + 80 × L(Mar 2) / L(Feb 1)) × 1.35`; row 3's benchmark is null (after the index's last day); `partialDays` 1; `currency` "CAD"; `hasBenchmark` true.
- With `EMPTY_FX_SERIES` and "CAD": `currency` "USD", `cadUnavailable` true, values unconverted (300).
- With "USD": values unconverted and `benchmark` in USD.
- With `benchmark` null: every row's `benchmark` is null and `hasBenchmark` false.

### 6. `frontend/app/lib/__tests__/portfolioInput.test.ts` (update WP05's file)

Add, with `key = "123e4567-e89b-12d3-a456-426614174000"` and `base = { product_id: 5, quantity: 2, purchase_date: "2026-01-05", notes: null, client_idempotency_key: key }`:
- `parseNewHolding({ ...base, purchase_currency: "CAD", purchase_price_native: 129.99 })` equals `{ ok: true, value: { product_id: 5, quantity: 2, purchase_price_usd: 129.99, purchase_currency: "CAD", purchase_price_native: 129.99, purchase_date: "2026-01-05", notes: null, client_idempotency_key: key } }`.
- `parseNewHolding({ ...base, purchase_price_usd: 59.99 })` (pre-WP36 body) gives currency "USD" and native 59.99.
- `{ ...base, purchase_currency: "CAD", purchase_price_usd: 10 }` (CAD without native) and `purchase_currency: "EUR"` fail.
- `parseHoldingUpdate({ purchase_currency: "CAD", purchase_price_native: 20 })` equals `{ ok: true, value: { purchase_currency: "CAD", purchase_price_native: 20, purchase_price_usd: 20 } }`; `{ purchase_price_native: 20 }` alone fails with `CURRENCY_MESSAGE`; `{ purchase_price_usd: 20 }` gives `{ purchase_price_usd: 20, purchase_currency: "USD" }`; `{ quantity: 3 }` gives `{ quantity: 3 }` (no currency key).
- `parsePortfolioSettings({ exit_fee_pct: 12.34 })` gives 12.3; `51`, `-0.1`, `"15"`, `{}` fail with `EXIT_FEE_MESSAGE` (or "Invalid body" for a non-object).
- `describeWriteError("PF001")` is `{ httpStatus: 400, message: FX_MISSING_MESSAGE }`.
Existing WP05 cases stay unchanged and must keep passing.

### 7. `frontend/app/lib/server/__tests__/portfolioRepo.analytics.test.ts` (new, node)

Mock the Supabase client the way WP05's `portfolioRepo.test.ts` does, and mock `../../serverMarketData` (`getCachedMarketProductSummaries` resolving `[]`, `fetchNewestPricedAtForProducts` resolving `new Map()`).
- `loadPortfolioAnalyticsInput`: no portfolio row gives `{ exitFeePct: 15, holdings: [] }` and makes no holdings query; a row `{ id: 7, exit_fee_pct: 12.5 }` gives `exitFeePct` 12.5 and queries `portfolio_holdings` with `.eq("portfolio_id", 7)`, and the select string contains `purchase_currency, purchase_price_native`; a portfolio read error or a holdings read error gives `null`; it never calls `.insert`.
- `updatePortfolioExitFee`: calls `.update({ exit_fee_pct: 12.5 })` with `.eq("id", <portfolio id>)` and returns `{ status: "ok", exitFeePct: 12.5 }`; a `23514` error returns `{ status: "error", code: "23514" }`.
- `insertImportedHoldings`: a row-level `PF001` error becomes `{ status: "error", error: "No Bank of Canada rate for the purchase date" }`.

### 8. Route tests (new, node; copy the setup of WP05's `app/api/portfolio/__tests__/routes.test.ts`)

`frontend/app/api/portfolio/__tests__/analytics.route.test.ts`: mock `routeSupabase`, `routeAuth` (`requireRouteUser`), `server/portfolioRepo` (`loadPortfolioAnalyticsInput`) and `serverMarketData` (`getCachedProductStats` → `EMPTY_PRODUCT_STATS`, `getCachedFxDaily` → `EMPTY_FX_SERIES`, `getCachedIndexSeries` → `[]`).
- 403 without `x-pokefin-request` (no auth call made); the 401 and 503 answers of `requireRouteUser` pass through.
- 200 with `Cache-Control: no-store`, `version` 1, `lots` of the mocked holding, and `getCachedIndexSeries` called once with `"sealed"`.
- 500 `{ error: "Failed to load portfolio analytics" }` when the repo returns null, and when it throws.

`frontend/app/api/portfolio/__tests__/settings.route.test.ts` (`PATCH /api/portfolio`):
- 403 without the CSRF header or with a foreign Origin (WP05's `rejectIfCsrfFails`), 413 above 1024 bytes.
- 400 for `{ exit_fee_pct: 60 }` with `EXIT_FEE_MESSAGE`; 400 for invalid JSON.
- 200 `{ exit_fee_pct: 12.5 }` and `updatePortfolioExitFee` called with `(client, "u1", 12.5)`; 400 when it returns code `23514`; 500 otherwise; every answer except the CSRF ones has `no-store`.
- WP05's existing GET tests for this file stay unchanged.

### 9. `frontend/app/components/Portfolio/__tests__/samplePortfolio.test.ts` (new, node)

`const s = buildSamplePortfolio(15)`:
- Deterministic: `JSON.stringify(buildSamplePortfolio(15))` equals `JSON.stringify(s)`.
- `s.history` has 366 points from "2025-09-30" to "2026-09-30"; the first non-null value is at index 45 (the first purchase, Nov 14, 2025).
- `s.analytics.totals.valueUsd` ≈ 3116.42 (`toBeCloseTo(3116.42, 2)`), `totals.valueCad` ≈ 4342.73, `fxNow` 1.3935, `totals.usd.cost` ≈ 2459.22, `totals.usd.plPct` ≈ 26.7 (1 decimal), `totals.cad.pl` ≈ 982.55, `totals.cad.market` ≈ 900.09, `totals.cad.fx` ≈ 82.46.
- `benchmark.status` "ok", `coveredLots` 6, `usd.returnPct` ≈ 26.7, `usd.benchmarkReturnPct` ≈ 20.9, `usd.deltaPts` ≈ 5.9.
- `concentration` is one product flag, "Evolving Skies Booster Box", share ≈ 52.4.
- The bands are, in holding order, `["1_4w", "under_1w", "under_1w", "over_1m", "under_1w", "under_1w"]`.
- Every holding has a negative `product_id` and `portfolio_id` -1.
- The module imports nothing from `lib/portfolioApi`, `lib/supabase*` or `next/*` (read the source with `fs` and assert).

### 10. `frontend/app/lib/__tests__/portfolioApi.analytics.test.ts` (new, jsdom default)

Mock `global.fetch`.
- `fetchPortfolioAnalytics(signal)`: GET `/api/portfolio/analytics` with header `x-pokefin-request: 1`, `cache: "no-store"` and the signal; resolves the body when it has `version: 1`, `lots` and `totals`; rejects with `PortfolioApiError` (status 500) for `{}`; rejects with status 401 and the WP05 session text on 401.
- `updateExitFee(12.5)`: PATCH `/api/portfolio` with JSON headers and body `{"exit_fee_pct":12.5}`; `{ ok: true, exitFeePct: 12.5 }` on 200; `{ ok: false, message }` with the route's error text on 400; the WP05 network text when `fetch` rejects.

### 11. `frontend/app/components/charts/__tests__/chartTooltips.test.tsx` (update WP17's file)

Delete the `AllocationTooltip` import and cases (step 17c). Replace the `PortfolioTooltip` case with: `active={false}` renders nothing; a payload row `{ dateKey: "2026-09-25", value: 1500, benchmark: 1400, isPartial: true, pricedProducts: 2, heldProducts: 3 }` with `currency="USD"` shows "Sep 25", "$1,500.00", "$1,400.00" and text matching `/2 of 3 products priced/`; a row with `value: null` and `benchmark: null` renders nothing.

### 12. Component and hook tests (new or updated, jsdom; every render ends with `expect(await axeViolations(container)).toEqual([])`)

Build analytics for the components with `buildPortfolioAnalytics` and the Tests 3 fixtures: copy them into `frontend/test-utils/portfolioAnalyticsFixture.ts` (outside `app/` and outside any `__tests__` folder, so Jest does not run it as a suite and Next never bundles it), exporting `fx`, `points`, `index`, `stats`, `holdings` and `analytics` (the Tests 3 call), and import it as `@/test-utils/portfolioAnalyticsFixture`. Or use `buildSamplePortfolio(15)`. Any suite that renders the holdings views with links (`HoldingsTable`, the dashboard) mocks `next/navigation` with `useRouter: () => ({ prefetch: jest.fn(), push: jest.fn() })`, because WP11's `IntentLink` calls `useRouter()` and jsdom has no app router; keep the real `IntentLink` so the link assertions test real anchors.

- `PortfolioSummary.test.tsx`: in USD shows "$570.00" market value, "3 of 4 holdings priced", the P/L with a `Delta`, "Selling fees" with value 15, "Index as of Sep 29, 2026", the vs Sealed Index difference as the text "+16.4 pts" (and no element with `data-direction` inside that figure: it is points, not a `Delta` percent) and "Compares 2 of 3 priced holdings; 1 bought before the index starts on Dec 1, 2025."; in CAD shows the CAD market value and "Market" and "Currency move" lines; `loading` with `analytics={null}` renders a skeleton in each of the five values (plus the sub-line skeletons under four of them) and no figure, and the fee field is already there; `errorText` renders the alert and "Try again" calls `onRetry`; a stale-index analytics (today "2026-10-20") shows "The Sealed Index has not been published since Sep 29, 2026."; typing 12.5 in the fee field and pressing Enter calls `onExitFeeCommit(12.5)` once and the exit value updates; typing 60 and blurring shows "Enter 0 to 50." and does not call it.
- `HoldingsTable.test.tsx` (replace WP05/WP15/WP17's file): the desktop table has the ten column headers (Product, Bought, Qty, Paid (each), Price, Value, P/L, Contribution, Days to exit, Actions); the withheld row's price cell has the visually hidden "Price withheld. Last priced Sep 1, 2026." and a `time` with `dateTime="2026-09-01"`; lot 11's row shows "+$100.00", "1.5"-day band "Under 1 week" with the detail text "About 2 days of recent TCGplayer sales for the 3 you hold." in its `title`, and its contribution in points; with `analytics={null}` analytics cells are skeletons and quantity, bought and paid show; clicking the "Days to exit" header sorts fastest first with the unknown band last; the phone list's sort select has the six options and its order button flips the label; in the phone list (`within(getByRole("list", { name: "Your holdings" }))`) the withheld row shows the inline "Last priced Sep 1" text and the rows priced on Sep 29 (today Sep 30) show no "as of" or "Last priced" text; "Edit {name}" and "Delete {name}" call `onEdit(holding)` and `onDelete(id)` (use `getAllByRole(...)[0]`: both views are in the DOM in jsdom); `readOnly` renders no links and no Edit or Delete buttons; a CAD lot viewed in USD shows "in CAD:" under its P/L.
- `AllocationPanel.test.tsx`: "Set" selected by default lists set groups with share text; choosing "Era" (click the radio) lists eras; nine groups fold into six plus "Other (3)"; the flag text "Set 1 Booster Box is 79% of your priced value." appears with the "Concentrated" badge (the Tests 3 fixture); "1 holding has no current price and is left out."; `allocation={null}` with `loading` shows skeletons, without it shows "Allocation is not available right now.".
- `PortfolioEmptyState.test.tsx`: the heading "Start with what you own"; the three buttons call `onImport`, `onAdd`, `onSample`; "Import from Collectr" is the primary button (it has the `bg-action` class).
- `PortfolioSampleView.test.tsx`: mock `../shared/PortfolioChart` to a stub; `global.fetch = jest.fn()`; renders the note starting "Sample portfolio." and "Sep 29, 2026"; the holdings show "Evolving Skies Booster Box" with no link and no "Edit" button; `fetch` was never called; "Close the sample" calls `onExit`; "Import from Collectr" calls `onImport`.
- `usePortfolioAnalytics.test.tsx` (`renderHook`): no fetch while `portfolioId` is null or holdings are empty; one fetch for a holdings array; a new array aborts the first request (its signal is aborted) and fetches again; while the second request runs, `analytics` is still the first result and `loading` is true; a rejection gives `errorText` "We could not load your portfolio figures." and `retry()` fetches again; a 401 `PortfolioApiError` gives the session text.
- `AddHoldingModal.test.tsx` (update WP05/WP31's file; mock `../../../context/CurrencyContext` `useCurrency` to `{ currency: "CAD", exchangeRate: 1.4, ... }`): "Paid in" starts at CAD; selecting a product priced $100 pre-fills "140.00" and the label reads "Price paid per unit (CAD)"; switching to USD re-fills "100.00"; after typing "95" switching back to CAD keeps "95"; submitting sends `purchase_currency: "CAD"`, `purchase_price_native: 140`, `purchase_price_usd: 140`; a second submit with the same values reuses the idempotency key, and switching currency mints a new one. If WP31 landed: WP31's `initialProductId` case (product at `usd_price: 59.99`) now expects "83.99" in the price field (59.99 × 1.4, step 12g) with "Paid in" on CAD; rewrite that one expectation, nothing else in WP31's cases.
- `PortfolioModals.a11y.test.tsx` (WP14's file; update): the add and edit dialogs' price label is now "Price paid per unit (CAD)" or "(USD)". Replace each `getByLabelText("Purchase Price (USD)")` with `getByLabelText(/^Price paid per unit/)`. The file does not mock `CurrencyContext`, so `useCurrency()` returns WP20's fallback (`DEFAULT_CURRENCY` "CAD", `DEFAULT_EXCHANGE_RATE`): in the add pre-fill case the expected value becomes `Number((100 * DEFAULT_EXCHANGE_RATE).toFixed(2))` (import `DEFAULT_EXCHANGE_RATE` from `app/lib/currency.ts`); the edit fixture has no `purchase_currency`, so it stays USD and "12.50". Every other assertion and the axe check stay as they are.
- `EditHoldingModal.test.tsx` (new or update): a CAD holding with `purchase_price_native: 129.99` shows CAD checked and "129.99"; saving after changing only the quantity sends `{ quantity, purchase_date, notes }` with no `purchase_currency` and no `purchase_price_native`; changing the price to 130 sends `purchase_currency: "CAD", purchase_price_native: 130`; switching to USD sends `purchase_currency: "USD"`; a USD holding stored at `33.333333` shows "33.33" and an untouched save sends no price.
- `ImportHoldingsModal.test.tsx` and `app/lib/__tests__/import.holdings.test.ts` (update WP05's files): choosing CAD in the preview sends rows with `purchase_currency: "CAD"` and `purchase_price_native` equal to the CSV cost; the default sends `"USD"`; the preview cost shows "C$" after choosing CAD.
- `PortfolioDashboard.test.tsx` (WP15) and `PortfolioDashboard.addParam.test.tsx` (WP31, if present): replace the `../shared/PortfolioSummaryCard` mock with `../shared/PortfolioSummary`, add `() => null` mocks for `../shared/AllocationPanel` and `../shared/PortfolioChart`, and mock `../hooks/usePortfolioAnalytics` to `{ analytics: null, loading: false, errorText: null, retry: jest.fn() }`. The delete-dialog cases keep their assertions; open the dialog with `getAllByRole("button", { name: /^Delete / })[0]`. Add: with `holdings: []` the empty state renders and "Explore a sample portfolio" mounts the sample (mock `../demo/PortfolioSampleView` to a component that renders "sample view" and wait with `findByText("sample view")`: `next/dynamic` resolves the mocked module asynchronously); "Add holding" opens the add modal; the fee commit calls `updateExitFee` (mock `../../lib/portfolioApi`).

### Existing tests that must keep passing unchanged

WP05's route, repo, hook and `portfolioApi` tests (except the files named above), WP10's history tests, WP24's `metricDefinitions` test (every `MetricLabel metric=` key resolves), WP23's `uiConventions` test (after 23a), WP34's watchlist tests and `tests/test_wp34_watchlist_static.py` (0040 does not redefine `export_my_data`), WP25's and WP29's tests, `tests/test_migration_volatility.py`.

## Verification

Block 1, database (repo root):

```bash
python3 verify_migration.py migrations/0040_portfolio_lot_currency.sql > /tmp/wp36_0040.sql; echo "exit=$?"   # exit=3, stderr as in step 1f
PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh       # last line "OK: ... replay_twice"
POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once \
  python -m pytest tests/test_wp36_portfolio_currency_db.py tests/test_wp36_portfolio_currency_static.py \
  tests/test_migration_volatility.py tests/test_db_roles_integration.py -v                                # all passed (14 + 5 + volatility + roles)
python -m pytest tests/ -q                                                                                 # all passed; DB modules skipped without the URL
```

Block 2, frontend unit (from `frontend/`):

```bash
pnpm exec tsc --noEmit                    # phase A: only the column errors named in Before you start; phase B: exit 0
pnpm lint                                 # 0 errors
pnpm exec jest app/lib/__tests__/portfolioAnalytics.test.ts app/lib/__tests__/portfolioExit.test.ts \
  app/lib/__tests__/portfolioChart.test.ts app/lib/__tests__/portfolioInput.test.ts \
  app/lib/server/__tests__/portfolioRepo.analytics.test.ts app/api/portfolio \
  app/lib/__tests__/portfolioApi.analytics.test.ts app/components/Portfolio app/components/charts \
  app/methodology app/lib/__tests__/metricDefinitions.test.ts app/__tests__/uiConventions.test.ts   # all pass
pnpm test --ci                            # all pass; suites = base + new files - deleted files (HoldingCard, PortfolioSummaryCard)
```

Block 3, guards (from `frontend/`):

```bash
grep -rn "lib/portfolioAnalytics\"\|demo/samplePortfolio\|recharts" app/components/Portfolio/PortfolioDashboard.tsx \
  app/components/Portfolio/shared app/components/Portfolio/cards                     # no output (lazy only)
grep -rln "AllocationChart\|PortfolioSummaryCard\|HoldingCard" app                     # no output
grep -rnP "\x{2014}|\blive\b|real-time|all-time|TCGPlayer" app/components/Portfolio app/lib/portfolioExit.ts \
  app/lib/portfolioAnalytics.ts app/lib/portfolioChart.ts app/components/charts/PortfolioChartImpl.tsx   # no output
grep -rnE "(text|bg|border|ring|fill|stroke)-(slate|gray|blue|emerald|rose|red|amber)-[0-9]" \
  app/components/Portfolio/shared app/components/Portfolio/portfolioDisplay.ts app/components/Portfolio/PortfolioEmptyState.tsx \
  app/components/Portfolio/demo app/components/Portfolio/cards/Holdings*.tsx app/components/Portfolio/cards/HoldingActions.tsx \
  app/components/charts/PortfolioChartImpl.tsx                                           # no output (tokens only)
```

Block 4, build and budgets (from `frontend/`):

```bash
pnpm build:stub > /tmp/wp36-build.log 2>&1; echo "exit=$?"                                  # exit=0
grep -nE " /api/portfolio/analytics| /portfolio\b" /tmp/wp36-build.log                       # both listed, ƒ (dynamic)
rm -rf .perf && SUPABASE_STUB_FIXTURE=perf pnpm build:stub > /tmp/wp36-perf.log 2>&1; echo "exit=$?"   # exit=0, no unmatched requests
pnpm perf:budget; echo "exit=$?"                                                            # exit=0
pnpm perf:budget | grep -E "^\| (/portfolio|Largest lazy chunk)"                            # record for the PR; /portfolio JS (gz) ≤ 180
```

Record `/portfolio` JS (gz) on master and on the branch; expect roughly +6 to +8 kB. The largest lazy chunk (Recharts) must not grow (the pie left it). If `/portfolio` is above its limit but at or under 180, follow step 23b; above 180, stop and shrink.

Block 5, manual (`pnpm dev` against the stub for layout, then the preview deploy with a real account for data):

1. 1440 px, signed in with holdings: the summary shows five figures with "?" links that open the right `/methodology#...` anchors; the chart shows the solid value line and the dashed index line with the legend; unticking "Compare with the Sealed Index" hides it; the range control has no "ALL".
2. Header toggle to CAD: market value, P/L, exit value and the benchmark switch to C$; the P/L shows "Market ... · Currency move ..."; the chart's CAD values on an old day differ from USD × today's rate (dated rates). Toggle back to USD.
3. Add a holding: "Paid in" starts at CAD; pick a product, the price pre-fills in CAD; enter C$129.99 dated last Sunday; save. Network: `POST /api/portfolio/holdings` sends `purchase_currency: "CAD", purchase_price_native: 129.99`; the response holding has `purchase_price_usd` = 129.99 ÷ that Sunday's carried Friday rate. Edit it, change only the quantity, save: the PATCH body has no price; reopen: still C$129.99, CAD.
4. Set selling fees to 12.5, press Enter: "Saved"; reload: 12.5 persists; the exit value equals market value × 0.875.
5. A holding whose price is withheld (or the stub's stale fixture): `--` with the clock in its price cell, excluded from value ("n of m holdings priced"), from allocation (note under the bars) and from the benchmark ("Compares ...").
6. Delete every holding (or use a new account): the empty state shows the three routes; "Explore a sample portfolio" shows the note and the sample read-only (no links, no Edit or Delete); Network shows no request; "Close the sample" returns; "Import from Collectr" opens the importer with "Costs in this file are in".
7. 390 x 844 (DevTools device mode, touch): no horizontal scroll; the summary is two columns with the index figure full width; the range control fills the width; holdings are two-line rows with Edit and Delete 44 px buttons; the sort select does not zoom on focus; the fee input is 44 px tall.
8. Keyboard only: Tab through the summary links, the fee field (Enter commits), the range radios (arrows), the checkbox, Group by radios, the table headers (Enter sorts, `aria-sort` changes), Edit and Delete; focus rings are visible.
9. Account page, "Export my data": every holding has `purchase_currency` and `purchase_price_native`; the portfolio has `exit_fee_pct`; the `watchlist` key is still there if WP34 merged.
10. Layout stability, 1440 x 900, CPU 4x slowdown, a portfolio of 6 or more holdings: DevTools Performance, record a reload. The layout shifts after the analytics response (Experience track) sum to under 0.05, the `/portfolio` CLS budget (WP22). If they do not, the summary's sub-line skeletons no longer match the loaded sub-lines: fix the skeleton, not the budget. Record the number in the PR.
11. Add a CAD holding dated before the first Bank of Canada rate in `fx_daily` (`SELECT min(day) FROM public.fx_daily;`, for example 2016-06-01 after Owner action 3): the dialog shows "There is no Bank of Canada rate for that purchase date. Enter the price in USD, or pick another date." and nothing is saved.

## Owner actions

1. **Apply migration 0040** in production with Supabase MCP `apply_migration` (preferred) or the SQL editor (select nothing before Run): `migrations/0040_portfolio_lot_currency.sql`, after 0034 (WP25) is applied. Then run the query `python3 verify_migration.py migrations/0040_portfolio_lot_currency.sql` prints (every row OK) and the four verification queries in the file header (5 rows; 0; 2 rows; true). The 0024 (and 0038, 0039) verification queries now report a `MISMATCH` on the `export_my_data` body; that is expected. Apply before the phase B code deploys: the routes select the new columns by name.
2. **Tell the executor** it is applied, so phase B regenerates `app/types/database.ts` (`pnpm types:db` needs the columns in production).
3. **Backfill older Bank of Canada rates** (10 minutes, once), so CAD cost basis works for purchases before 2020: `python scripts/backfill_fx_valet.py --start 2017-01-03` (WP25's script; the Valet series starts on 2017-01-03), then in the SQL editor `SELECT public.refresh_market_analytics((now() AT TIME ZONE 'UTC')::date);` (its FX step rebuilds `fx_daily` from the first rate). Check: `SELECT min(day) FROM public.fx_daily;` returns 2017-01-03. Without this, CAD purchases dated before the first rate are refused, and USD purchases before it have no CAD cost.
4. After merge, refresh `schema.sql` by WP21's procedure (the drift check reports the new columns until then).
5. **If WP34 (0038) or WP35 (0039) is applied in production after 0040**, run `migrations/0040_portfolio_lot_currency.sql` again right after it (idempotent; it only re-adds the three export keys), then check: `SELECT position('purchase_currency' IN pg_get_functiondef('public.export_my_data()'::regprocedure)) > 0;` returns true.
6. After deploy, do Verification block 5 steps 3, 4 and 9 with your own account (10 minutes). No new environment variable, secret, paid service or Vercel setting is needed.

## Acceptance criteria

- [ ] `migrations/0040_portfolio_lot_currency.sql` exists with step 1's content; no other migration changed; `verify_migration.py` exits 3 with the stderr of step 1f; the replay harness passes once and twice.
- [ ] `tests/test_wp36_portfolio_currency_db.py` passes against `replay_once` (14 cases): CAD converts at the purchase-date rate (including a carried weekend rate), the 14-day carry counts from the Bank of Canada date and not from a carried row's day, an unchanged CAD edit keeps its USD value exactly, a date change reconverts, no rate raises PF001, CAD without a native price and an unknown currency are refused, the USD price wins for a USD lot, a CAD lot switches to USD, a legacy insert defaults to USD, the fee defaults to 15 and is capped at 50, the export carries the new keys and stays VOLATILE, SECURITY DEFINER and closed to anon, and the trigger function is not callable.
- [ ] `tests/test_wp36_portfolio_currency_static.py` passes: 0040 is re-runnable, patches `export_my_data` in place without redefining it, and its fee bounds and FX carry match `portfolioExit.ts` and `fx.ts`.
- [ ] A lot entered in CAD round-trips exactly: add C$129.99, read it back as 129.99 CAD, edit something else, read it back unchanged (Tests 1 case 2, Tests 12 edit case, Verification block 5 step 3).
- [ ] A withheld price never feeds value or P/L: its row shows `--` with the reason and clock; it is excluded from market value, P/L, contribution, exit value, allocation and the benchmark comparison, and the coverage counts say so (Tests 3 "never values a withheld price", Tests 12).
- [ ] `GET /api/portfolio/analytics` answers per-lot P/L in USD and CAD (and native), the benchmark value and comparison, exit value, allocation by set, type and era, concentration flags over 40%, and days-to-exit bands; it is `no-store`, gated like WP05's GET, and never creates a portfolio.
- [ ] `PATCH /api/portfolio` stores `exit_fee_pct` in [0, 50] with CSRF and size gates; the summary's fee field applies at once and persists across reloads.
- [ ] The benchmark is money-matched (Tests 3 "invests each lot's cost ... on its own purchase date") and labelled "Same money in the Pokéfin Sealed Index"; it is withheld with a reason when the index is stale or missing.
- [ ] CAD cost uses the purchase-date rate from `fx_daily`, CAD P/L = market move + currency move exactly, and the portfolio chart converts CAD by date; `/methodology#limits` no longer says portfolio charts use the latest rate.
- [ ] The summary shows value, day change, unrealized P/L, exit value after the editable fee, and vs Sealed Index in percentage points ("+5.9 pts", never a `Delta` percent); the chart overlays the index line; the holdings table has P/L contribution, days to exit and the `AsOf` glyph on desktop and the two-line list on phones; allocation by set, type and era with flags.
- [ ] The add and edit dialogs have "Paid in"; the Collectr import preview has "Costs in this file are in".
- [ ] An empty portfolio shows Import from Collectr (primary), Add a product, and Explore a sample portfolio; the sample makes no request, saves nothing and is read-only.
- [ ] `/methodology` has `#portfolio` with its five sub-anchors, the version is bumped with a change-log row, and every new `MetricLabel` key is defined.
- [ ] `/portfolio` initial JS ≤ 180 kB gz (`pnpm perf:budget`), with no unexplained raise; the largest lazy chunk did not grow.
- [ ] `pnpm exec tsc --noEmit` (phase B), `pnpm lint`, `pnpm test --ci`, `pnpm build:stub`, `pnpm perf:budget`, and `python -m pytest tests/` all pass; the `uiConventions` baseline only went down.
- [ ] No em dash, "live", "real-time", "all-time" or "TCGPlayer" in any new or changed file; no raw palette class or hex in new files.

## Rollback

Code: revert the frontend commits (2 to 6 of Commit and PR). The dashboard returns to WP05/WP15's version; CAD lots keep their converted `purchase_price_usd`, which is all the old code reads, so values stay right. Keep commit 1 while 0040 is applied: the columns are inert without the new code, except that the trigger still converts CAD rows, which only the new code writes.

Database, only if the columns must go (after the code revert): add a new migration at the next free number, `NNNN_revert_portfolio_lot_currency.sql`, with exactly this content, and apply it. It was run twice on the scratch database (after 0040) and left `export_my_data()` working with the original keys; 0040 re-applied cleanly afterwards.

```sql
-- Revert of 0040 (WP36 rollback). Run only after the WP36 code is reverted.
DROP TRIGGER IF EXISTS portfolio_holdings_purchase_currency_trg ON public.portfolio_holdings;
DROP TRIGGER IF EXISTS portfolio_lots_purchase_currency_trg ON public.portfolio_lots;
DROP FUNCTION IF EXISTS public.apply_purchase_currency();

DO $revert$
DECLARE
  v_def text := pg_get_functiondef('public.export_my_data()'::regprocedure);
  v_new text;
BEGIN
  v_new := replace(v_def, $k$, 'purchase_currency', h.purchase_currency, 'purchase_price_native', h.purchase_price_native$k$, '');
  v_new := replace(v_new, $k$, 'purchase_currency', l.purchase_currency, 'purchase_price_native', l.purchase_price_native$k$, '');
  v_new := replace(v_new, $k$, 'exit_fee_pct', p.exit_fee_pct$k$, '');
  IF position('purchase_currency' IN v_new) > 0 OR position('exit_fee_pct' IN v_new) > 0 THEN
    RAISE EXCEPTION 'export_my_data() still mentions the 0040 columns; remove them by hand first';
  END IF;
  IF v_new <> v_def THEN
    EXECUTE v_new;
  END IF;
END
$revert$;

-- Every CAD lot keeps its converted purchase_price_usd, which is all the
-- pre-WP36 app reads.
ALTER TABLE public.portfolio_holdings
  DROP CONSTRAINT IF EXISTS portfolio_holdings_purchase_currency_valid,
  DROP CONSTRAINT IF EXISTS portfolio_holdings_native_price_sane,
  DROP CONSTRAINT IF EXISTS portfolio_holdings_cad_has_native,
  DROP COLUMN IF EXISTS purchase_currency,
  DROP COLUMN IF EXISTS purchase_price_native;
ALTER TABLE public.portfolio_lots
  DROP CONSTRAINT IF EXISTS portfolio_lots_purchase_currency_valid,
  DROP CONSTRAINT IF EXISTS portfolio_lots_native_price_sane,
  DROP CONSTRAINT IF EXISTS portfolio_lots_cad_has_native,
  DROP COLUMN IF EXISTS purchase_currency,
  DROP COLUMN IF EXISTS purchase_price_native;
ALTER TABLE public.portfolios
  DROP CONSTRAINT IF EXISTS portfolios_exit_fee_pct_range,
  DROP COLUMN IF EXISTS exit_fee_pct;
```

Never edit or delete `0040_portfolio_lot_currency.sql` after it has been applied.

## Commit and PR

Commits (in this order):

1. `feat(db): purchase currency, native price and exit fee on the portfolio (WP36)`: `migrations/0040_portfolio_lot_currency.sql`, `tests/test_wp36_portfolio_currency_db.py`, `tests/test_wp36_portfolio_currency_static.py`, `README.md`, `audits/HARDENING_FOLLOWUPS.md`.
2. `feat(portfolio): analytics builder, chart model and exit rules (WP36)`: `app/types/portfolio.ts`, `app/types/portfolioAnalytics.ts`, `app/lib/portfolioExit.ts`, `app/lib/portfolioAnalytics.ts`, `app/lib/portfolioChart.ts`, their tests.
3. `feat(portfolio): currency in holding writes, analytics and fee routes (WP36)`: `app/lib/portfolioInput.ts`, `app/lib/server/portfolioRepo.ts`, `app/api/portfolio/route.ts`, `app/api/portfolio/analytics/route.ts`, `app/lib/portfolioApi.ts`, `app/lib/import.ts`, their tests.
4. `feat(portfolio): summary, index overlay, allocation, holdings table and Paid in (WP36)`: everything under `app/components/Portfolio/` except `demo/` and `PortfolioEmptyState.tsx`, `app/components/charts/*`, their tests, the deleted files.
5. `feat(portfolio): import-first empty state and sample portfolio (WP36)`: `PortfolioEmptyState.tsx`, `demo/*`, their tests.
6. `docs(methodology): portfolio figures (WP36)`: `app/lib/metricDefinitions.ts`, `app/content/methodology.ts`, `app/methodology/MethodologyArticle.tsx`, their tests, `app/__tests__/uiConventions.baseline.json`, `perf-budgets.json` (only if step 23b applied).
7. Phase B: `chore(types): regenerate database types for 0040 (WP36)`: `app/types/database.ts`.

End every commit message with the attribution lines the session's system reminder specifies.

PR title: `WP36: Portfolio analytics: vs the index, net of exit costs, in the currency you paid`

PR body:
- What changed and why (the Why section, two sentences), with screenshots at 390 px and 1440 px: the summary in CAD, the chart with the index line, allocation with a flag, the holdings table with a withheld row, the add dialog with "Paid in", the empty state, the sample portfolio.
- **Migration 0040 must be applied by the owner before the phase B deploy** (Owner action 1), with the `verify_migration.py` result pasted once done; the Valet backfill (Owner action 3); and, if WP34 or WP35 merges later, the re-run (Owner action 5). State which files defined `export_my_data` when you started (Before you start).
- The decisions in Design (money-matched benchmark, coverage rules, conversion in the database, bars not a pie, "ALL" removed).
- Route contract (GET analytics, PATCH portfolio, the currency fields on holding writes, the PF001 400).
- Verification outputs: `verify_migration.py` stderr, the replay harness's last line, pytest summaries with and without `POKEFIN_TEST_DATABASE_URL`, `tsc` (phase A errors listed, phase B clean), lint, Jest counts before and after, the `perf:budget` rows for `/portfolio` and the largest lazy chunk on master and on the branch, the guard greps of block 3.
- Soft dependencies: whether WP31 (`?add=`), WP34 (tabs, 0038) and WP35 (0039) were present, and what step 22d did with the `#limits` bullet.
- Known limits and follow-ups: realised P/L needs a sale model (deferred); the benchmark is money-matched, not time-weighted; days to exit assumes the whole market's pace (an estimate of depth); CAD purchases dated before the first Bank of Canada rate are refused until Owner action 3; `portfolio_lots` still has no reader or writer; WP32's home strip uses the header's latest rate for CAD while `/portfolio` uses `fx_daily` (same Bank of Canada rate on most days).
- Owner actions 1 to 6 as a checklist.

End the PR description with the attribution lines the session's system reminder specifies.
