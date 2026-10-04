# WP18: Consolidate market math; split the compare page

- **Findings covered**
  - F005 (full; cluster members F005, F036, F040): return, volatility, drawdown, CAGR and release-date math is implemented in four TypeScript places (`serverMarketData.ts`, `MarketView/returns.ts`, `ReturnMetrics.tsx`, `PriceChart.tsx`) plus four `getReleaseMs` copies, and the copies disagree on volatility units (annualised on `/market` and `/product`, raw daily on `/stats`) with nothing on screen saying which.
  - F073 (full; low severity, confirmed by the full-effort re-verification): `PriceChart` re-parses, re-buckets and re-labels the whole history on every USD/CAD toggle (about 730 per-day `toLocaleDateString` calls for a 1Y chart, 40 to 55 ms on desktop, an estimated 80 to 200 ms on a mid-range phone, multiplied by every open chart), defines its tooltip and dot inside render (they remount only when a prop changes, because PriceChart is `memo`'d; cosmetic), and on phones renders at 200 px then 150 px because its height comes from a JS media check (only on a chart opened after the chart chunk is already loaded; the first open shows the CSS skeleton and does not shift).
  - F043 (full; cluster members F004, F035, F043): the Seller Tools client component (`app/compare/CompareDashboard.tsx` after WP11, formerly `page.tsx`) is a 1,000+ line file holding a CSV parser, the margin and threshold rules, a private null-sinking comparator, a `SortButton` and three hand-written tables, with zero tests.
  - F074 (full; low severity, confirmed by the full-effort re-verification): `/compare` re-renders and lays out three `table-auto` tables from the same rows on every keystroke. Rows are bounded by the ~306-SKU market catalog (a Shopify item is kept only if the catalog prices it), so the ceiling is ~306 rows per table, ~918 in all; filtering plus the three sorts cost about 0.25 ms, and the real cost is React reconciling every row plus auto table layout (an estimated 100 ms or more per keystroke on a mid-range phone). Fixes, in order of value: deferred search, memoised rows, `table-fixed` with `<colgroup>`; virtualization is not warranted at this size.
  - F003 (full): the Collectr import (`lib/import.ts`) has its own naive CSV parser that splits on newlines before handling quotes, so a multi-line or quoted note is truncated and loses its quote characters.
- **Priority rationale**: pure maintainability and consistency debt with one user-visible inconsistency (volatility units), scheduled after the caching and lint gates so the refactor lands under blocking lint and on settled code.
- **Effort**: L, about 12 hours (3 h market math and its five consumers, 1.5 h PriceChart, 4 h compare split with tabs, 1 h import parser, 2.5 h tests and verification).
- **Depends on**: WP17 (hard: step 4 edits `app/components/MarketView/buildRows.ts`, which WP17 step 13 creates; step 8 expects `PriceTooltip`/`PriceDot` already at module scope from WP17 step 8), WP07 (`app/lib/format.ts`: `parseRecordedAt`, `formatMoney`, `formatDateOnly`, `formatMonthDay`; offset-less `recorded_at` already parsed as UTC in the files this package edits), WP11 (`app/compare/page.tsx` is a server component rendering `app/compare/CompareDashboard.tsx`; `app/compare/marketProducts.ts` exports `MarketProduct` and `buildMarketProductMap`). Also assumes the packages that run before it in plan order have merged: WP14 (compare search `aria-label`, file input `sr-only`, gain/loss tokens), WP15 (compare error copy `MARKET_DATA_UNAVAILABLE`), WP17 (lint blocks CI; `MarketView/buildRows.ts` exists; `PriceTooltip` and `PriceDot` are already module-scope exports of `PriceChart.tsx`).
- **Unblocks**: WP19 (MarketView decomposition builds on `lib/marketMath.ts`, `lib/sorting.ts` and `components/SortableTable`), WP24, WP31 and WP33 (Track 2: `/methodology`, `metricDefinitions.ts` and the screener import `DAYS_PER_YEAR`, `ANNUALISATION_FACTOR`, `PRODUCT_VOLATILITY_LOOKBACK_POINTS`, `RETURN_WINDOW_DAYS` and the `SET_FALLBACK_*` windows from `lib/marketMath.ts` instead of retyping them), WP20 (types move and currency context; the compare page's local `DEFAULT_EXCHANGE_RATE = 1.35` is left for it).
- **Suggested branch name**: `remediation/wp18-market-math-and-compare`
- **Risk level**: medium. It touches the numbers shown on `/market`, `/product/[id]`, `/stats` (fallback path), the catalog cards, every price chart and `/compare`; the new code was proven number-for-number equal to the old on randomised histories, and the tests below pin that.

## Why

The same finance formulas live in four files and have already needed a hand back-port (PR #70 added the same freshness bail to four copies; `ReturnMetrics.tsx:46-47` says so). The one live inconsistency is volatility: `/market` ("Vol 30D") and the product page ("Volatility 30D") show an annualised figure, `/stats` ("Volatility 90D") shows the raw daily standard deviation, a roughly 19x gap under the same word, and only `/stats` says what its number is. PriceChart also redoes all its date parsing and day labelling when a visitor toggles USD/CAD, and on phones a chart opened after the chart code has loaded paints at 200 px and then re-renders at 150 px. The Seller Tools page holds the margin, profit-per-day and above/below-threshold rules sellers rely on inside one untestable component, renders three full tables at once (up to ~918 rows) and re-renders and re-lays out all of them on every keystroke, and the Collectr import truncates multi-line notes because it uses a second, weaker CSV parser. After this PR there is one isomorphic `lib/marketMath.ts` with an explicit volatility unit that every page labels, PriceChart converts currency in one cheap pass and sizes itself with CSS, `/compare` is a thin component over tested modules showing one table at a time with deferred search, and both CSV consumers share one RFC 4180 parser.

## Before you start

All paths are relative to `frontend/` unless they start with `.github/`, `audits/` or `migrations/`, or are `schema.sql`; those four are at the repo root.

Read these files in full first:

- `app/components/MarketView/returns.ts` (140 lines at `a188fea`; WP07 changed `getReturnPercent` and `getCagrPercent` to use `parseRecordedAt`).
- `app/lib/serverMarketData.ts`: `DAY_MS` (`:51` at `a188fea`), `getReleaseMs` `:196-202`, `getReturnPercent` `:204-227`, `buildDailySeries` `:229-248`, `getVolatility` `:250-268`, `getMaxDrawdown` `:270-288`, `getTrendSlope` `:290-315`, the loop in `fetchSetAnalyticsFallback` `:398-450` and the set mapping `:455-490`, and the fallback returns in `fetchProductsWithFallbackReturns` `:800-813`. Line numbers moved in WP05, WP07 and WP11; find each by name.
- `app/components/MarketView/buildRows.ts` and `app/components/MarketView/__tests__/buildRows.test.ts` (added by WP17 step 13), and `app/components/MarketView/MarketView.tsx` (header "Vol 30D" `:790-799`, cell `renderReturnValue(volatility30d)` `:509-513`, `renderReturnValue` `:118-137` at `a188fea`).
- `app/components/ProductPrices/shared/ReturnMetrics.tsx` (`getHistoricalReturn` `:31-62`, the days ternary `:95-107`).
- `app/components/ProductPrices/cards/ProductCard.tsx` (the two `<ReturnMetrics` elements, `:174-182` and `:290-299` at `a188fea`).
- `app/product/[id]/page.tsx` (imports `:8-12`, `DAY_MS` `:29`, `getReleaseMs` `:39-45`, days since release `:172-177`, `identity` and the three metrics `:190-198`, the "Volatility 30D" tile `:336-338`).
- `app/stats/page.tsx` (`STAT_TOOLTIPS.volatility90` `:17`, the two "Volatility 90D" headers `:168` and `:225`, and WP14's `METRIC_DEFINITIONS` if present).
- `app/components/PriceChart.tsx` (736 lines at `a188fea`): `groupedDaily` `:85-141`, `chartDataWithTrend` `:322-339`, `priceStats` `:378-400`, `investorStats` `:407-463`, `releaseDateInfo` `:512-548`, the no-data box `:560-569`, the chips and `ResponsiveContainer` `:592-612`. WP17 already replaced `CustomTooltip`/`CustomDot` (`:466-509`) with module-scope `PriceTooltip`/`PriceDot`.
- `app/components/ProductPrices/shared/ResponsivePriceChart.tsx` (60 lines) and `app/components/ProductPrices/hooks/useResponsive.ts` (49 lines; `ResponsivePriceChart` is its only importer).
- `app/compare/CompareDashboard.tsx` (the old `app/compare/page.tsx`, 1079 lines at `a188fea`: `parseCsv` `:82-138`, `parseShopifyCsv` `:146-199`, formatters `:201-230`, `calculateProfit`/`calculateMargin` `:236-244`, `compareValues` `:246-265`, `SortButton` `:267-306`, component `:308`, the three sorted memos `:458-494`, `summaryStats` `:496-515`, the three tables `:631-1075`), `app/compare/page.tsx` (server shell from WP11), `app/compare/marketProducts.ts`, `app/compare/__tests__/*`.
- `app/components/MarketView/sorting.ts` (68 lines) and its test.
- `app/lib/import.ts` `:136-205` (`parseCollectrCSV`, `parseCSVLine`) and `app/lib/__tests__/import.test.ts` (fixture at `:20-22`, the trailing-space assertion at `:31`).
- `migrations/20260506_market_performance_functions.sql:101-142` (SQL volatility is `stddev_pop` of daily percent changes, raw daily; drawdown only against `running_peak > 0`). Do not edit it.
- `.github/workflows/ci.yml` (WP07 step 10 added a timezone step that names `app/components/MarketView/__tests__/returns.test.ts`).

Confirm the starting state (run from `frontend/`):

```bash
# Dependencies landed. Each must print at least one line; if one prints nothing, stop.
grep -n "export function parseRecordedAt\|export function formatMoney\|export function formatDateOnly" app/lib/format.ts   # WP07
head -1 app/compare/page.tsx                        # WP11: must NOT be "use client";
test -f app/compare/CompareDashboard.tsx && grep -n "export default function CompareDashboard" app/compare/CompareDashboard.tsx   # WP11
grep -n "export function buildMarketProductMap\|export type MarketProduct" app/compare/marketProducts.ts   # WP11
grep -n "export function buildMarketRow\b\|export function getReleaseMs\|export const DAY_MS" app/components/MarketView/buildRows.ts   # WP17
grep -n "export function PriceTooltip\|export function PriceDot" app/components/PriceChart.tsx   # WP17

# The bugs still exist.
grep -n "Math.sqrt(365)" app/components/MarketView/returns.ts           # 1 hit: annualised
grep -n "return Math.sqrt(variance);" app/lib/serverMarketData.ts        # 1 hit: raw daily
grep -rn "function getReleaseMs\|function getReleaseUtcMs" app --include=*.ts --include=*.tsx   # buildRows.ts, serverMarketData.ts, product/[id]/page.tsx, CompareDashboard.tsx
grep -n "function getHistoricalReturn" app/components/ProductPrices/shared/ReturnMetrics.tsx   # 1 hit
grep -n "}, \[data, currency, exchangeRate\]);" app/components/PriceChart.tsx   # 1 hit: groupedDaily re-runs on currency
grep -n "useResponsive" app/components/ProductPrices/shared/ResponsivePriceChart.tsx   # 2 hits
grep -c "<table" app/compare/CompareDashboard.tsx                        # 3
grep -n 'csvContent.split("\\n")' app/lib/import.ts                       # 1 hit
grep -n "returns.test.ts" ../.github/workflows/ci.yml                    # WP07 zone step: 2 hits (0 if WP07 skipped step 10)
```

If `buildRows.ts` does not exist (WP17 not merged), make the step 4c edits inside the `rows` useMemo of `MarketView.tsx` instead (its `todayUtcMs` is the `const todayUtcMs = utcMidnightMs();` at the top of that memo), delete MarketView's own `const DAY_MS` and `function getReleaseMs`, and add `import { DAY_MS, releaseDateUtcMs as getReleaseMs } from "../../lib/marketMath";` so `filteredProducts` keeps compiling unchanged; step 4a's import then goes into `MarketView.tsx` in place of its `"./returns"` import. If `PriceTooltip`/`PriceDot` are not module-scope exports, do step 8e. Any other missing dependency: stop and report.

Record the lint state of the files you will touch (lint is blocking since WP17; it must stay at 0 errors):

```bash
pnpm exec eslint app/lib app/compare app/components/MarketView app/components/PriceChart.tsx \
  app/components/ProductPrices/shared app/components/ProductPrices/cards/ProductCard.tsx \
  "app/product/[id]/page.tsx" app/stats/page.tsx 2>&1 | tail -3
```

Assumption to keep in mind: `product_price_history.recorded_at` is `timestamp without time zone` holding UTC (`schema.sql:7`), so the date part of the string IS the UTC day. `sets.release_date` is a date key.

## Implementation steps

Do the steps in order. Steps 1 to 3 add new modules and their tests and change nothing on screen. Steps 4 to 7 switch the market-math consumers. Step 8 is PriceChart. Steps 9 to 13 are the compare split. Step 14 is the import parser. Step 15 is CI.

### Decisions baked into this spec (do not re-open them)

1. **One module, `app/lib/marketMath.ts`, USD only.** No `convertPrice` parameter anywhere (F005 verifier correction 2): every metric here is a percentage or a ratio, and FX is a single multiply, so converting first cannot change a result. Callers convert prices for display only. This was checked: old and new implementations agree to 2e-14 relative on 300 random histories, including CAD conversion.
2. **Volatility keeps each page's current number and states its unit.** `volatilityPercent(prices, unit)` has no default unit, so every caller writes `"daily"` or `"annualised"`. `/market` and `/product` stay annualised (the daily figure times the square root of 365) and say so; `/stats` stays daily, because it is fed by the SQL `get_set_analytics`, which averages `get_market_product_metrics().volatility_90d` (`migrations/0023_price_freshness_guard.sql:378`), a raw daily `stddev_pop` of daily percent changes (`migrations/20260506_market_performance_functions.sql:113-118`) and changing it needs a migration outside this package (F005 verifier correction 3). The UI labels are the fix, not the maths.
3. **Lookback is in daily points, not calendar days**, exactly as both old implementations did (`returns.ts:120` `slice(-Math.max(lookbackDays, 3))`, server `buildDailySeries(history, 90)`). Switching to calendar days would change numbers; note it as a follow-up.
4. **Day keys come from the string** (`recorded_at.split("T")[0].split(" ")[0]`), as `returns.ts:13` and `marketPulse.ts` `toRecordedDateKey` do, not from `new Date(...)` (F005 verifier: unify on the string slice).
5. **PriceChart's chips stay on the charted (downsampled) series** and are labelled as range figures with a `title` (F005 verifier correction 1). Moving them to daily points would change the displayed drawdown and ROI.
6. **The zero-peak guard in drawdown is kept but is not a bug fix** (F005 verifier correction 4: the old server copy produced `NaN`, which never won the `<` comparison). Do not describe it as one in the PR.
7. **PriceChart height is CSS-driven** via a new `heightClassName` prop on the wrapper directly around `ResponsiveContainer` (not on the PriceChart root: the chip row sits above the plot inside that root); `useResponsive` is deleted, not seeded from `matchMedia` (F073 verifier correction). `ResponsivePriceChart` is its only importer and mounts only on the client, so a `matchMedia` initializer would work today; CSS is still chosen because it needs no effect, no listener and stays correct if a server-rendered consumer is ever added.
8. **Compare modules live in `app/compare/`, not `app/lib/`.** The plan said `lib/compareMath.ts`; `compareMath.ts` needs WP11's `MarketProduct` type from `app/compare/marketProducts.ts`, and a `lib/` module importing from a route folder would recreate the inverted dependency F048 complains about. Only the shared parser goes to `app/lib/csv.ts`.
9. **The generic comparator moves to `app/lib/sorting.ts`** (F043 recommendation) and gains an optional string comparator, so `/compare` keeps its case- and accent-insensitive title sort (F043 verifier correction 2). `components/MarketView/sorting.ts` re-exports it, so MarketView and its test are unchanged. NaN now sorts as missing on `/compare` too; no compare value can be NaN.
10. **The CSV parser is RFC 4180 with one leniency**: a quote opens a quoted field only at the start of a field; a quote in the middle of an unquoted field is literal. The old Collectr parser toggled on every quote per line, so a stray inch mark (`12" shelf`) in a note stayed on its own line; a strict parser would swallow the rest of the file into that note. This keeps that case safe (F043 verifier correction 3). Shopify exports are RFC-compliant, so `/compare` sees no change.
11. **`/compare` shows one table at a time behind tabs**, keeps each table's own sort across tab switches, and filters with `useDeferredValue`. Tables are `table-fixed` with `<colgroup>` widths inside a horizontally scrollable wrapper with a minimum width, so phones scroll instead of crushing columns.
12. **Out of scope, leave as is**: the compare page's `DEFAULT_EXCHANGE_RATE = 1.35` (WP20 owns it, per WP11), the SQL, MarketView's sort switch and JSX layout (WP19), `app/lib/portfolio.ts` and `clientMarketData.ts` day arithmetic.

### Step 1. `app/lib/marketMath.ts` (new)

No `"use client"`, no `"server-only"`: imported by `serverMarketData.ts` (server-only), server pages and client components. It imports only `./format` (WP07) and `./marketPulse`.

```ts
/**
 * Market math shared by the server (serverMarketData), the Market table,
 * the product page, the catalog cards (ReturnMetrics) and PriceChart.
 *
 * Isomorphic: no "use client", no "server-only", no React. Every function is
 * pure and takes USD prices. Percent metrics are unit-free, so converting to
 * CAD first would not change any result (FX is a single multiply); callers
 * convert prices for display only.
 *
 * Mirrors the SQL in get_set_analytics / get_market_product_summaries where
 * both compute the same thing (population std-dev, drawdown only against a
 * positive running peak). Keep them in step.
 */
import { parseRecordedAt, recordedAtDateKey } from "./format";
import { utcMidnightMs } from "./marketPulse";

export const DAY_MS = 24 * 60 * 60 * 1000;

/*
 * Windows and factors. Exported so /methodology and metricDefinitions.ts
 * (WP24) import the numbers instead of retyping them. Changing one changes a
 * number shown on the site: do it only with a methodology version bump.
 */

/** Days in a year, for CAGR and for annualising volatility. */
export const DAYS_PER_YEAR = 365;

/** Daily volatility times this is annualised volatility (sqrt(365), about 19.1). */
export const ANNUALISATION_FACTOR = Math.sqrt(DAYS_PER_YEAR);

/**
 * Product pages and the Market table: volatility over the newest 30 daily
 * prices (points, not calendar days), annualised.
 */
export const PRODUCT_VOLATILITY_LOOKBACK_POINTS = 30;

/**
 * Set Analytics fallback (serverMarketData, used only when the SQL
 * get_set_analytics read fails). The short window feeds volatility and the
 * short trend, the long window feeds max drawdown and the long trend, each
 * over the newest N daily prices. They stand in for the SQL windows
 * `current_date - 90` (changes_90, trend_90_source) and `current_date - 365`
 * (drawdown_365_source, trend_365_source) in
 * migrations/20260506_market_performance_functions.sql, which count calendar
 * days; marketMath.test.ts pins the numbers to that file.
 */
export const SET_FALLBACK_SHORT_WINDOW_POINTS = 90;
export const SET_FALLBACK_LONG_WINDOW_POINTS = 365;

/** Return windows used across the site, in calendar days. */
export const RETURN_WINDOW_DAYS = {
  "1D": 1,
  "7D": 7,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
} as const;

export type ReturnWindowLabel = keyof typeof RETURN_WINDOW_DAYS;

/** One product_price_history row. Structural, so any history type fits. */
export interface HistoryRow {
  recorded_at: string;
  usd_price: number;
}

/** One price per UTC calendar day. */
export interface DailyPoint {
  dateKey: string;
  price: number;
}

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "YYYY-MM-DD" to epoch ms at UTC midnight, or null for anything else.
 * No Date parsing of the string, so the runtime zone cannot shift the day.
 */
export function dateKeyUtcMs(dateKey: string | null | undefined): number | null {
  if (!dateKey) return null;
  const match = DATE_KEY_RE.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day);
}

/**
 * A set's release_date ("2026-03-27", or with a time part) as UTC-midnight
 * epoch ms. Replaces the four getReleaseMs / getReleaseUtcMs copies.
 * The parameter is optional, like the old getReleaseMs(releaseDate?), so
 * WP17's buildRows.test.ts keeps compiling through the getReleaseMs re-export.
 */
export function releaseDateUtcMs(releaseDate?: string | null): number | null {
  if (!releaseDate) return null;
  return dateKeyUtcMs(releaseDate.split("T")[0].split(" ")[0]);
}

/**
 * Whole UTC days from `startUtcMs` to `todayUtcMs`, floored, never negative.
 * Null when there is no start.
 */
export function daysSinceUtcMs(
  startUtcMs: number | null,
  todayUtcMs: number = utcMidnightMs()
): number | null {
  if (startUtcMs === null) return null;
  return Math.max(0, Math.floor((todayUtcMs - startUtcMs) / DAY_MS));
}

/** value / days, or null when either is missing or days is not positive. */
export function perDay(value: number | null, days: number | null): number | null {
  if (value === null || days === null || days <= 0) return null;
  return value / days;
}

/**
 * The UTC calendar day of a recorded_at value, by string split.
 * recorded_at is `timestamp without time zone` holding UTC, so its date part
 * IS the UTC day; parsing it with new Date() would attach the runtime zone.
 */
export function recordedDayKey(recordedAt: string | null | undefined): string | null {
  if (!recordedAt) return null;
  const dateKey = recordedAt.trim().split("T")[0].split(" ")[0];
  return DATE_KEY_RE.test(dateKey) ? dateKey : null;
}

/**
 * History (oldest first) collapsed to the first reading of each UTC day,
 * oldest first. `maxPoints` keeps only the newest N days.
 */
export function toDailyPoints(
  history: readonly HistoryRow[] | undefined,
  maxPoints?: number
): DailyPoint[] {
  if (!history || history.length === 0) return [];

  const byDay = new Map<string, number>();
  for (const entry of history) {
    const dateKey = recordedDayKey(entry.recorded_at);
    if (dateKey === null) continue;
    if (!byDay.has(dateKey)) byDay.set(dateKey, entry.usd_price);
  }

  const points = Array.from(byDay, ([dateKey, price]) => ({ dateKey, price })).sort(
    (a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0)
  );

  return maxPoints !== undefined && points.length > maxPoints
    ? points.slice(-maxPoints)
    : points;
}

/** Percent change from `from` to `to`. Null when `from` is not positive. */
export function percentChange(from: number, to: number): number | null {
  if (!(from > 0)) return null;
  return ((to - from) / from) * 100;
}

/**
 * N-day return: newest reading vs the newest reading whose UTC date is on or
 * before (the UTC date of `referenceDate`) minus `days`. Null when the newest
 * reading is itself on or before that day (no current point to measure to),
 * when no reading is old enough, or when the past price is not positive.
 * History must be oldest first.
 */
export function getReturnPercent(
  history: readonly HistoryRow[] | undefined,
  days: number,
  referenceDate: Date = new Date()
): number | null {
  if (!history || history.length < 2) return null;

  const latestEntry = history[history.length - 1];

  // Same anchor as the get_market_product_summaries RPC this stands in for:
  // UTC calendar days, `day <= current_date - N` (WP07, review F122). Not
  // `now - N x 24h`: before the day's scrape an instant comparison rejected
  // the anchor-day row the RPC uses and fell back to an older one.
  const targetKey = new Date(utcMidnightMs(referenceDate) - days * DAY_MS)
    .toISOString()
    .slice(0, 10);

  // The newest reading must fall after the target day, or there is no "now"
  // to measure to, and the loop below would return a flat 0% against itself.
  const latestKey = recordedAtDateKey(latestEntry.recorded_at);
  if (latestKey === null || latestKey <= targetKey) return null;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const key = recordedAtDateKey(history[i].recorded_at);
    if (key !== null && key <= targetKey) {
      return percentChange(history[i].usd_price, latestEntry.usd_price);
    }
  }

  return null;
}

/**
 * Compound annual growth between two prices at two instants. Null when a
 * price is not positive or the span is not positive.
 */
export function cagrPercent(
  startPrice: number,
  endPrice: number,
  startMs: number | null,
  endMs: number | null
): number | null {
  if (!(startPrice > 0) || !(endPrice > 0)) return null;
  if (startMs === null || endMs === null) return null;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  const years = (endMs - startMs) / (DAYS_PER_YEAR * DAY_MS);
  return (Math.pow(endPrice / startPrice, 1 / years) - 1) * 100;
}

/** CAGR from the oldest to the newest history row. */
export function getCagrPercent(history: readonly HistoryRow[] | undefined): number | null {
  if (!history || history.length < 2) return null;
  const first = history[0];
  const last = history[history.length - 1];
  return cagrPercent(
    first.usd_price,
    last.usd_price,
    parseRecordedAt(first.recorded_at).getTime(),
    parseRecordedAt(last.recorded_at).getTime()
  );
}

/**
 * Largest peak-to-trough fall of a price series, as a positive percent
 * (25 means the price fell 25% from a prior peak). 0 for a series that never
 * fell. Null for fewer than 2 prices. A non-positive peak is skipped, like
 * the SQL's `WHEN running_peak > 0`.
 */
export function maxDrawdownPercent(prices: readonly number[]): number | null {
  if (prices.length < 2) return null;

  let peak = prices[0];
  let maxDrawdown = 0;

  for (const price of prices) {
    if (price > peak) {
      peak = price;
      continue;
    }
    if (!(peak > 0)) continue;
    const drawdown = ((price - peak) / peak) * 100;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  }

  return Math.abs(maxDrawdown);
}

/** Max drawdown over the daily series (optionally only the newest N days). */
export function getMaxDrawdownPercent(
  history: readonly HistoryRow[] | undefined,
  maxPoints?: number
): number | null {
  return maxDrawdownPercent(toDailyPoints(history, maxPoints).map((point) => point.price));
}

/**
 * "daily": population std-dev of day-over-day percent changes, the unit
 * /stats and the SQL (stddev_pop) use.
 * "annualised": the daily figure times sqrt(365), the unit the Market table
 * and the product page use. About 19x the daily figure.
 */
export type VolatilityUnit = "daily" | "annualised";

/**
 * Volatility of a daily price series in the given unit. There is no default
 * unit on purpose: every caller states which one it shows. Null for fewer
 * than 3 prices or fewer than 2 usable changes.
 */
export function volatilityPercent(
  prices: readonly number[],
  unit: VolatilityUnit
): number | null {
  if (prices.length < 3) return null;

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i += 1) {
    const previous = prices[i - 1];
    if (!(previous > 0)) continue;
    changes.push(((prices[i] - previous) / previous) * 100);
  }
  if (changes.length < 2) return null;

  const mean = changes.reduce((sum, value) => sum + value, 0) / changes.length;
  const variance =
    changes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / changes.length;
  const daily = Math.sqrt(variance);

  return unit === "annualised" ? daily * ANNUALISATION_FACTOR : daily;
}

/**
 * Volatility over the newest `lookbackPoints` daily prices (at least 3).
 * Points, not calendar days: a day with no reading is skipped, as before.
 */
export function getVolatilityPercent(
  history: readonly HistoryRow[] | undefined,
  { lookbackPoints, unit }: { lookbackPoints: number; unit: VolatilityUnit }
): number | null {
  const prices = toDailyPoints(history).map((point) => point.price);
  return volatilityPercent(prices.slice(-Math.max(lookbackPoints, 3)), unit);
}
```

The named constants are not a behaviour change: each one holds the number the code already used. Use them where this package writes the number inside `marketMath.ts` and `serverMarketData.ts` (step 6c). Do NOT replace the literal `30` in `lookbackPoints: 30` in `buildRows.ts` (step 4c) or `app/product/[id]/page.tsx` (step 5b): WP19's preflight greps and its step 1b match that literal text, and WP24 step 1a swaps those two literals for `PRODUCT_VOLATILITY_LOOKBACK_POINTS` after WP19. WP24 step 1a was written to add `PRODUCT_VOLATILITY_LOOKBACK_POINTS` and to export `DAYS_PER_YEAR` itself; after this package both already exist under those names, so WP24 must only do the literal swap (adding the constant a second time is a TypeScript redeclaration error). There is deliberately no separate `ANNUALISATION_DAYS`: the year length used for annualising volatility and for CAGR is the same 365, so it has one name, `DAYS_PER_YEAR`. The set-level windows that `/stats` normally shows come from SQL and are mirrored by WP24's `SET_METRIC_WINDOWS` in `app/lib/setAnalytics.ts`; the `SET_FALLBACK_*` constants here only govern the TypeScript fallback and end in `_POINTS` because they count priced days, not calendar days (decision 3). The strategist's suggested names (`VOLATILITY_WINDOW_DAYS`, `ANNUALISATION_DAYS`, `SET_VOLATILITY_WINDOW_DAYS`) are not used: `_DAYS` would misstate the unit, and WP24, WP31 and WP33 already reference `DAYS_PER_YEAR` and `PRODUCT_VOLATILITY_LOOKBACK_POINTS`.

Then create the test by moving the old one, so git keeps its history (do it here, not in step 7: `git mv` refuses to overwrite an existing destination):

```bash
git mv app/components/MarketView/__tests__/returns.test.ts app/lib/__tests__/marketMath.test.ts
```

Before overwriting it, list its `it(` titles (`grep -n "it(" app/lib/__tests__/marketMath.test.ts`). Replace the file's whole content with the Tests-section version (test 1). If the moved file had a case whose title is not in the Tests-section version, port it into the new file: drop its `identityConvert` argument, import from `../marketMath`, keep its expectation. Then run `pnpm exec jest app/lib/__tests__/marketMath.test.ts`; it must pass before you continue. `returns.ts` itself stays until step 7c.

### Step 2. `app/lib/csv.ts` (new)

```ts
/**
 * The one CSV parser for the app (Shopify export on /compare, Collectr
 * import on /portfolio). RFC 4180:
 *
 * - fields separated by commas, records by LF or CRLF;
 * - a field that STARTS with a double quote is quoted: commas, line breaks
 *   and "" (an escaped quote) inside it are data;
 * - a quote in the middle of an unquoted field is a literal character, so a
 *   stray inch mark (12" display) cannot swallow the rest of the file;
 * - CRLF inside a quoted field becomes LF; a leading UTF-8 BOM is dropped.
 *
 * Returns raw fields: no trimming, no header handling, and a blank line comes
 * back as [""]. Callers decide those (import.ts trims every field).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // True until the current field has consumed a character.
  let atFieldStart = true;

  const endField = () => {
    row.push(field);
    field = "";
    atFieldStart = true;
  };

  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else if (!(char === "\r" && text[i + 1] === "\n")) {
        field += char;
      }
      continue;
    }

    if (char === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
      continue;
    }

    if (char === ",") {
      endField();
      continue;
    }

    if (char === "\n") {
      endField();
      rows.push(row);
      row = [];
      continue;
    }

    if (char === "\r") continue;

    field += char;
    atFieldStart = false;
  }

  if (!atFieldStart || field.length > 0 || row.length > 0) {
    endField();
    rows.push(row);
  }

  return rows;
}
```

Add `app/lib/__tests__/csv.test.ts` (Tests section) and run it.

### Step 3. `app/lib/sorting.ts` (new) and `app/components/MarketView/sorting.ts` (re-export)

3a. Create `app/lib/sorting.ts` with the generic half of `MarketView/sorting.ts` (lines 1-57), plus an optional string comparator:

```ts
/**
 * Null-sinking comparators for sortable tables (the Market View table and
 * components/SortableTable, used by /compare).
 *
 * Kept in a plain module (no JSX, no Recharts) so the null-handling rules can
 * be unit tested without rendering a table. Moved from
 * components/MarketView/sorting.ts, which re-exports it.
 */

export type SortDirection = "asc" | "desc";

/** A cell value the table can sort on. `null` means "no data" (rendered "--"). */
export type SortValue = number | string | null;

/**
 * `null` and `NaN` both render as "--", so both must sort as "missing".
 */
export function isMissingSortValue(value: SortValue): boolean {
  return value === null || (typeof value === "number" && Number.isNaN(value));
}

/** Orders two strings. The default is plain `localeCompare`. */
export type StringComparator = (a: string, b: string) => number;

const defaultCompareStrings: StringComparator = (a, b) => a.localeCompare(b);

/**
 * Compares two present (non-missing) values. Strings compare with
 * `compareStrings`, numbers numerically. Always ascending: direction is
 * applied by `compareSortValues`.
 */
function comparePresentValues(
  valueA: number | string,
  valueB: number | string,
  compareStrings: StringComparator
): number {
  if (typeof valueA === "string" || typeof valueB === "string") {
    return compareStrings(String(valueA), String(valueB));
  }
  return valueA - valueB;
}

/**
 * Direction-aware comparator that always sinks missing values to the bottom.
 *
 * The missing-vs-present decision is resolved BEFORE the ascending/descending
 * flip is applied. Resolving it afterwards (the old behaviour) inverted the
 * sink for descending sorts, so every descending column led with a block of
 * "--" rows, which is what "Vol (30d)", "Vol Δ" and "1Y" all did.
 */
export function compareSortValues(
  valueA: SortValue,
  valueB: SortValue,
  direction: SortDirection,
  compareStrings: StringComparator = defaultCompareStrings
): number {
  const missingA = isMissingSortValue(valueA);
  const missingB = isMissingSortValue(valueB);

  if (missingA && missingB) return 0;
  if (missingA) return 1;
  if (missingB) return -1;

  const base = comparePresentValues(
    valueA as number | string,
    valueB as number | string,
    compareStrings
  );
  return direction === "asc" ? base : -base;
}
```

3b. Replace `app/components/MarketView/sorting.ts` lines 1-57 (everything above the `getDefaultSortDirection` doc comment) so the whole file becomes:

```ts
/**
 * Market View column defaults. The null-sinking comparator is shared with
 * components/SortableTable and lives in lib/sorting.ts; it is re-exported
 * here so existing imports keep working.
 */
import type { SortDirection } from "../../lib/sorting";

export {
  compareSortValues,
  isMissingSortValue,
  type SortDirection,
  type SortValue,
  type StringComparator,
} from "../../lib/sorting";

/**
 * Default direction for a freshly clicked column header. Columns where a
 * *smaller* number is the "better"/more interesting value open ascending.
 */
export function getDefaultSortDirection(key: string): SortDirection {
  if (key === "product" || key === "set") return "asc";
  if (key === "days_since_release") return "asc";
  if (key === "max_drawdown" || key === "volatility_30d") return "asc";
  return "desc";
}
```

`MarketView.tsx` and `MarketView/__tests__/sorting.test.ts` keep importing from `./sorting` / `../sorting` unchanged. Add the two comparator cases to that test (Tests section).

### Step 4. MarketView rows: `app/components/MarketView/buildRows.ts`

4a. Replace the import from `"./returns"` with:

```ts
import {
  daysSinceUtcMs,
  getCagrPercent,
  getMaxDrawdownPercent,
  getReturnPercent,
  getVolatilityPercent,
  perDay,
  releaseDateUtcMs,
} from "../../lib/marketMath";
```

4b. Delete `export const DAY_MS = 24 * 60 * 60 * 1000;` and the whole `export function getReleaseMs(...) { ... }`. In their place add:

```ts
// The shared implementations live in lib/marketMath.ts. Re-exported under the
// names MarketView.tsx and buildRows.test.ts already import (WP17); WP19 can
// switch those callers to the lib names.
export { DAY_MS, releaseDateUtcMs as getReleaseMs } from "../../lib/marketMath";
```

4c. Inside `buildMarketRow`, change only these expressions (keep every comment and the rest of the body):

- The five return fallbacks: `getReturnPercent(history, 7, convertPrice)` becomes `getReturnPercent(history, 7)`, and the same for 30, 90, 180, 365.
- Days since release (the `const releaseMs = getReleaseMs(...)` line and the `daysSinceRelease` ternary that follows it) become:

```ts
      const releaseMs = releaseDateUtcMs(product.sets?.release_date ?? null);
      const daysSinceRelease = daysSinceUtcMs(releaseMs, todayUtcMs);
```

- `pricePerDay` (the `price !== null && daysSinceRelease && daysSinceRelease > 0 ? price / daysSinceRelease : null` ternary) becomes `const pricePerDay = perDay(price, daysSinceRelease);`.
- `getCagrPercent(history, convertPrice)` becomes `getCagrPercent(history)`.
- `getMaxDrawdownPercent(history, convertPrice)` becomes `getMaxDrawdownPercent(history)`.
- `getVolatilityPercent(history, convertPrice, 30)` becomes:

```ts
      // Annualised (daily std-dev times sqrt(365)); the column header says so.
      const volatility30d = getVolatilityPercent(history, {
        lookbackPoints: 30,
        unit: "annualised",
      });
```

`convertPrice` stays a parameter: `price` still uses it. `buildRows.test.ts` must pass unchanged (its expectations, e.g. `volatility30d` close to `35 * Math.sqrt(365)`, were re-derived against the new code).

4d. `MarketView.tsx` still imports `DAY_MS` and `getReleaseMs` from `"./buildRows"` for `filteredProducts`; that keeps working through the re-export. Change nothing else there in this step.

### Step 5. Volatility units on screen (F005)

5a. `app/components/MarketView/MarketView.tsx`, below `renderReturnValue` add:

```tsx
// Volatility is a size, not a gain or a loss: no sign and no gain/loss colour
// (the product page already renders it this way).
function renderVolatilityValue(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return <span className="text-slate-400">--</span>;
  }
  return <span className="font-semibold text-slate-700">{value.toFixed(2)}%</span>;
}
```

Change the body cell `{renderReturnValue(volatility30d)}` to `{renderVolatilityValue(volatility30d)}`. Change the header button (the one with `onClick={() => handleSort("volatility_30d")}`) to:

```tsx
                        <button
                          type="button"
                          onClick={() => handleSort("volatility_30d")}
                          title="Annualised volatility: standard deviation of daily price changes over the last 30 priced days, times the square root of 365. The Stats page shows the daily figure, which is about 19 times smaller."
                          className="font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
                        >
                          Vol 30D (ann.){getSortIndicator("volatility_30d")}
                        </button>
```

Keep whatever `className` the button has now (WP14/WP15 may have changed it); only the `title` attribute and the label text change.

5b. `app/product/[id]/page.tsx`:

- Replace the import from `"../../components/MarketView/returns"` with:

```ts
import {
  daysSinceUtcMs,
  getCagrPercent,
  getMaxDrawdownPercent,
  getVolatilityPercent,
  perDay,
  releaseDateUtcMs,
} from "../../lib/marketMath";
```

- Delete `const DAY_MS = 24 * 60 * 60 * 1000;` and `function getReleaseMs(...)` (WP07 kept it).
- Replace the `releaseMs` / `todayUtcMs` / `daysSinceRelease` block with:

```ts
  const daysSinceRelease = daysSinceUtcMs(
    releaseDateUtcMs(product.sets?.release_date),
    utcMidnightMs()
  );
```

  If `releaseMs` or `todayUtcMs` is used anywhere else in the file (`grep -n "releaseMs\|todayUtcMs" "app/product/[id]/page.tsx"`), keep a `const releaseMs = releaseDateUtcMs(product.sets?.release_date);` and pass it instead.
- Inside the `pricePerDay` `derivedFromPrice` thunk, replace the ternary with `perDay(price > 0 ? price : null, daysSinceRelease)` (keep `const price = product.usd_price as number;`).
- Delete `const identity = (usd: number) => usd;` and change the three calls to `getCagrPercent(history)`, `getMaxDrawdownPercent(history)` and:

```ts
  // Annualised, like /market; the tile and the note under the grid say so.
  const volatility = getVolatilityPercent(history, { lookbackPoints: 30, unit: "annualised" });
```

- Tile label: `<MetricTile label="Volatility 30D">` becomes `<MetricTile label="Volatility 30D (annualised)">`.
- Directly after the `</div>` that closes the `grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8` grid in the "Return Metrics" section, add:

```tsx
        <p className="mt-3 text-xs text-slate-500">
          Volatility is annualised: the standard deviation of daily price changes
          over the last 30 priced days, times the square root of 365. Set-level
          volatility on the Stats page is the daily figure.
        </p>
```

5c. `app/stats/page.tsx`:

- `STAT_TOOLTIPS.volatility90` becomes `"Standard deviation of daily percent changes over the last 90 priced days (daily, not annualised). The Market table and product pages show annualised 30-day volatility, which is about 19 times larger."`
- Both `<StatHeader label="Volatility 90D" ...>` become `label="Volatility 90D (daily)"`.
- If WP14's `METRIC_DEFINITIONS` exists, change its `{ label: "Volatility 90D", key: "volatility90" }` entry to `label: "Volatility 90D (daily)"`.

### Step 6. Server fallback math: `app/lib/serverMarketData.ts`

6a. Add below the other `./` imports (keep `import "server-only";` first):

```ts
import {
  DAY_MS,
  SET_FALLBACK_LONG_WINDOW_POINTS,
  SET_FALLBACK_SHORT_WINDOW_POINTS,
  daysSinceUtcMs,
  getReturnPercent,
  maxDrawdownPercent,
  releaseDateUtcMs,
  toDailyPoints,
  volatilityPercent,
  type DailyPoint,
} from "./marketMath";
```

6b. Delete the local `const DAY_MS = 24 * 60 * 60 * 1000;` (other uses of `DAY_MS` in the file now use the import) and delete the functions `getReleaseMs`, `getReturnPercent`, `buildDailySeries`, `getVolatility` and `getMaxDrawdown`. Change `getTrendSlope`'s parameter type to `points: DailyPoint[]`; its body is unchanged.

6c. In `fetchSetAnalyticsFallback`'s per-product loop, replace the four series lines with:

```ts
    const series90 = toDailyPoints(history, SET_FALLBACK_SHORT_WINDOW_POINTS);
    const series365 = toDailyPoints(history, SET_FALLBACK_LONG_WINDOW_POINTS);
    // Daily, not annualised: this stands in for get_set_analytics, whose SQL
    // is stddev_pop of daily percent changes, and /stats labels it "daily".
    const volatility90 = volatilityPercent(
      series90.map((point) => point.price),
      "daily"
    );
    const maxDrawdown365 = maxDrawdownPercent(series365.map((point) => point.price));
```

(`const trend90 = getTrendSlope(series90);` and `trend365` stay.)

6d. In the same loop, the price-per-day block becomes:

```ts
    const daysSinceRelease = daysSinceUtcMs(releaseDateUtcMs(set.release_date));
    if (daysSinceRelease !== null && freshPrice !== null && freshPrice > 0) {
      if (daysSinceRelease > 0) {
        entry.pricePerDay.push(freshPrice / daysSinceRelease);
      }
    }
```

Keep the comment above it. In the `setStats` mapping, replace the `releaseMs` / `daysSinceRelease` pair with `const daysSinceRelease = daysSinceUtcMs(releaseDateUtcMs(entry.releaseDate), todayUtcMs);`.

6e. `getReturnPercent(history, 30)` and the six calls in `fetchProductsWithFallbackReturns` keep their text; they now resolve to the shared function (same `(history, days)` signature, `referenceDate` defaults to now).

6f. WP07 added `import { parseRecordedAt, recordedAtDateKey } from "./format";` for the deleted functions. Remove whichever of those names is no longer used (`grep -n "parseRecordedAt\|recordedAtDateKey" app/lib/serverMarketData.ts`); delete the import line if both are unused. Keep `utcMidnightMs` (still used).

### Step 7. Catalog cards: `ReturnMetrics.tsx` and `ProductCard.tsx`

7a. `app/components/ProductPrices/shared/ReturnMetrics.tsx`:

- Delete `interface ReturnData`, `const DAY_MS` (WP07), the WP07 `parseRecordedAt` import and the whole `getHistoricalReturn` function.
- Add `import { getReturnPercent, RETURN_WINDOW_DAYS } from "../../../lib/marketMath";`.
- Remove `Currency` from the `../types` import, remove `selectedCurrency` and `exchangeRate` from `ReturnMetricsProps` and from the destructuring, and delete the `convertPrice` function.
- Replace the whole `const days = label === "1D" ? ... : 365;` ternary and the `value = getHistoricalReturn(...)` line with:

```ts
        // Percent returns are the same in USD and CAD, so no conversion.
        value = getReturnPercent(history, RETURN_WINDOW_DAYS[label]);
```

7b. `app/components/ProductPrices/cards/ProductCard.tsx`: in both `<ReturnMetrics` elements delete the `selectedCurrency={selectedCurrency}` and `exchangeRate={exchangeRate}` lines. The card keeps both props (the chart uses them).

7c. Delete the old module: `git rm app/components/MarketView/returns.ts`. Its test was already moved to `app/lib/__tests__/marketMath.test.ts` in step 1; confirm `test -f app/components/MarketView/__tests__/returns.test.ts` fails (the file must not exist).

After step 7: `grep -rn "MarketView/returns\|from \"./returns\"" app` prints nothing, and `pnpm exec tsc --noEmit` passes.

### Step 8. `app/components/PriceChart.tsx` (F073, F005)

8a. Imports. Add below the `../lib/format` import:

```ts
import {
  DAY_MS,
  cagrPercent,
  dateKeyUtcMs,
  maxDrawdownPercent,
  percentChange,
  releaseDateUtcMs,
} from "../lib/marketMath";
```

8b. New prop. In the destructuring add `heightClassName,` after `height = 200,`, and in the props type add after `height?: number;`:

```ts
  /**
   * Responsive plot height as CSS classes, e.g. "h-[150px] md:h-[200px]".
   * When set it replaces `height`, so the first paint already has the right
   * size on every screen (no measure-then-resize on phones, F073).
   */
  heightClassName?: string;
```

8c. Currency out of the pipeline. Everything up to `chartDataWithTrend` becomes USD:

- Above `const groupedDaily = useMemo(() => {` add the comment `// Everything from here to chartDataWithTrend is in USD and does not depend on the currency, so a USD/CAD toggle does not re-parse and re-bucket the history (F073). displayData applies the rate once.` (wrap at 80 columns).
- In `groupedDaily`'s result mapping, `price: currency === "CAD" ? entry.usd_price * exchangeRate : entry.usd_price,` becomes `price: entry.usd_price,`.
- `groupedDaily`'s dependency array `[data, currency, exchangeRate]` becomes `[data]`.
- Directly after the `chartDataWithTrend` useMemo (ends `}, [chartData, range]);`) add:

```ts
  // The only currency-dependent step. Linear, so converting the finished USD
  // series equals converting every input row, and costs one pass.
  const displayData = useMemo<ChartPoint[]>(() => {
    if (currency !== "CAD") return chartDataWithTrend;
    return chartDataWithTrend.map((point) => ({
      ...point,
      price: point.price === null ? null : point.price * exchangeRate,
      trend: point.trend === null ? null : point.trend * exchangeRate,
    }));
  }, [chartDataWithTrend, currency, exchangeRate]);
```

- `priceStats`: `const prices = chartDataWithTrend` becomes `const prices = displayData`, and its dependency array `[chartDataWithTrend]` becomes `[displayData]` (the Y axis is in the display currency; its `minSpan` of 1 is not linear, so it must see converted values).
- `<ComposedChart data={chartDataWithTrend}` becomes `<ComposedChart data={displayData}`.

`slicedData`, `slicedDataWithVolume`, `chartData`, `chartDataWithTrend`, `dataAvailability` and `releaseDateInfo` stay on the USD series (only dates and null-ness matter there). This goes further than the re-verification's suggested split of `groupedDaily` into a `[data]` bucketing memo plus a `[buckets, currency, exchangeRate]` price map: with currency removed from every memo above `displayData`, a toggle re-runs no bucketing, no `slicedData` loop and no date labelling at all, only one linear pass over the charted points. Do not also add the split. `resolvePrice` in `slicedData` judges null-ness and freshness only, never the amount.

8d. `investorStats`: replace the whole useMemo with:

```ts
  // The chips describe the CHARTED series (the downsampled 3M/6M/1Y points),
  // not the daily history: range ROI, range CAGR and range max drawdown.
  // Computing them from daily points would change the numbers shown, because
  // daily data catches troughs the downsampled series skips. Percentages are
  // the same in USD and CAD, so this runs on the USD series and a currency
  // toggle does not recompute it.
  const investorStats = useMemo(() => {
    const priced = chartDataWithTrend.filter(
      (point): point is ChartPoint & { price: number } => point.price !== null
    );

    if (priced.length < 2) {
      return { returnPct: null, cagr: null, maxDrawdown: null };
    }

    // ROI and CAGR measure from a start point TO an endpoint, so a range whose
    // tail expired has no endpoint to measure to: filtering the nulls out would
    // silently promote the last stale reading into that role. Max drawdown
    // describes the series that exists, so it survives, the same split the
    // SQL and the product page use.
    const endpointExpired =
      chartDataWithTrend[chartDataWithTrend.length - 1].price === null;

    const first = priced[0];
    const last = priced[priced.length - 1];

    return {
      returnPct: endpointExpired ? null : percentChange(first.price, last.price),
      cagr: endpointExpired
        ? null
        : cagrPercent(
            first.price,
            last.price,
            dateKeyUtcMs(first.timestamp),
            dateKeyUtcMs(last.timestamp)
          ),
      maxDrawdown: maxDrawdownPercent(priced.map((point) => point.price)),
    };
  }, [chartDataWithTrend]);
```

This is equivalent to the old loop: `timestamp` is a `YYYY-MM-DD` key and `new Date(key)` parsed it as UTC midnight, which is what `dateKeyUtcMs` returns; the old `first <= 0` guard is `percentChange`'s `!(from > 0)`. Rendered output of the old and new component was compared on 600 random histories in UTC, Vancouver and Tokyo: identical text.

8e. Tooltip and dot. WP17 already made them module-scope `export function PriceTooltip` / `export function PriceDot`, used as `content={<PriceTooltip currency={currency} hasVolume={hasVolume} />}` and `dot={range === "7D" ? <PriceDot /> : false}`, and `app/components/charts/__tests__/chartTooltips.test.tsx` imports them. Verify with `grep -n "const CustomTooltip\|const CustomDot\|export function PriceTooltip\|export function PriceDot" app/components/PriceChart.tsx` (expect only the two `export function` lines) and change nothing. Only if the grep still shows `CustomTooltip`/`CustomDot`: do WP17 step 8c exactly as written there (it is the same fix), keeping the exports.

8f. Formatters (F073 "hoist Intl formatters"): WP07 replaced both per-day `toLocaleDateString` calls (`groupedDaily` and the `slicedData` loop, about 730 calls and 40 to 55 ms for a 1Y chart before WP07) with `formatMonthDay` (string split, no Intl) and the tooltip and axis with `formatMoney` (module-level `Intl.NumberFormat`). That is cheaper than the re-verification's suggested module-level `Intl.DateTimeFormat`, so do not add one, and do not change `slicedData` to reuse `existing.date` (with no Intl call per day there is nothing left to save). Verify: `grep -n "toLocale\|toFixed(0)\|currencySymbol" app/components/PriceChart.tsx` prints nothing (the `toFixed(6)` tick keys and the chips' `toFixed(2)` percentages are expected and are not matched). If it prints a hit, apply WP07 steps 6l and 8a to this file.

8g. `releaseDateInfo`: replace the body with the shared date helpers (same behaviour):

```ts
  const releaseDateInfo = useMemo(() => {
    if (!releaseDate || chartDataWithTrend.length === 0) return null;

    const releaseKey = releaseDate.split("T")[0].split(" ")[0];
    const releaseMs = releaseDateUtcMs(releaseDate);
    const rangeStartMs = dateKeyUtcMs(chartDataWithTrend[0].timestamp);
    const rangeEndMs = dateKeyUtcMs(
      chartDataWithTrend[chartDataWithTrend.length - 1].timestamp
    );

    if (releaseMs === null || rangeStartMs === null || rangeEndMs === null) {
      return null;
    }

    if (rangeEndMs - releaseMs > 365 * DAY_MS) {
      return null;
    }

    if (releaseMs < rangeStartMs || releaseMs > rangeEndMs) {
      return null;
    }

    const match = chartDataWithTrend.find((d) => d.timestamp === releaseKey);

    return match ? match.date : null;
  }, [releaseDate, chartDataWithTrend]);
```

8h. CSS height. Put the height classes only on the two elements below: the no-data box and a new wrapper directly around `ResponsiveContainer`. Do not put them on PriceChart's root `<div>`, on the `w-full ...` chart container that also holds the chip row, or on `ResponsivePriceChart`'s outer `<div className={className}>`: the ROI/CAGR/Max DD chip row (and the incomplete-data banner) render above the plot inside the same root, so a fixed height there with `height="100%"` on `ResponsiveContainer` would squash the plot by the chip row's height (F073 re-verification). With the wrapper below, the plot is exactly 150 or 200 px, as today, and the chips add their own height on top, as today.

The no-data box:

```tsx
      <div
        className={`w-full flex items-center justify-center text-sm text-slate-500 ${heightClassName ?? ""}`}
        style={heightClassName ? undefined : { height }}
      >
```

and the chart container: replace `<ResponsiveContainer width="100%" height={height}>` with a sized wrapper (close the new `</div>` right after `</ResponsiveContainer>`):

```tsx
        <div className={heightClassName} style={heightClassName ? undefined : { height }}>
          <ResponsiveContainer width="100%" height="100%">
            {/* ComposedChart and its children unchanged */}
          </ResponsiveContainer>
        </div>
```

8i. Chip titles (F005 "label them as range figures"): add a `title` to each chip `<span>`, text unchanged:

- ROI chip: ``title={`Change over the charted ${range} range`}``
- CAGR chip: ``title={`Annualised growth over the charted ${range} range`}``
- Max DD chip: ``title={`Largest peak-to-trough drop in the charted ${range} range`}``

### Step 9. `app/components/ProductPrices/shared/ResponsivePriceChart.tsx` and `useResponsive`

Replace the file with:

```tsx
"use client";

import dynamic from "next/dynamic";
import { PriceHistoryEntry, Currency, ChartTimeframe } from "../types";

// One height for the skeleton and the chart, set by CSS breakpoints, so the
// first paint on a phone is already 150 px (F073). A JS media check started at
// the desktop 200 px and re-rendered at 150 px after mount.
const CHART_HEIGHT_CLASSES = "h-[150px] md:h-[200px]";

// Recharts (~109 KB gzip) is fetched only when a chart actually mounts.
// The import specifier must match the other chart wrappers so all of them
// share a single async chunk - see app/components/charts/ChartBundle.tsx.
const PriceChart = dynamic(
  () => import("../../charts/ChartBundle").then((m) => m.PriceChart),
  {
    ssr: false,
    loading: () => (
      <div
        className={`${CHART_HEIGHT_CLASSES} w-full animate-pulse rounded-md border border-slate-200 bg-slate-100`}
      />
    ),
  }
);

interface ResponsivePriceChartProps {
  data: PriceHistoryEntry[];
  range: ChartTimeframe;
  currency?: Currency;
  exchangeRate?: number;
  className?: string;
  releaseDate?: string;
}

/**
 * PriceChart at 150 px below the md breakpoint (768 px) and 200 px above it.
 */
export default function ResponsivePriceChart({
  data,
  range,
  currency = "USD",
  exchangeRate = 1.36,
  className = "",
  releaseDate,
}: ResponsivePriceChartProps) {
  return (
    <div className={className}>
      <PriceChart
        data={data}
        range={range}
        currency={currency}
        exchangeRate={exchangeRate}
        heightClassName={CHART_HEIGHT_CLASSES}
        releaseDate={releaseDate}
      />
    </div>
  );
}
```

If the current file differs from the `a188fea` version described above (for example WP09 or WP12 changed the dynamic import or the skeleton), keep those changes and apply only: drop `useResponsive`, add `CHART_HEIGHT_CLASSES`, pass `heightClassName`. Leave `exchangeRate = 1.36` (WP20 owns the literal defaults).

Then `git rm app/components/ProductPrices/hooks/useResponsive.ts` after confirming `grep -rn "useResponsive" app` prints only that file. Do not add a `matchMedia` initializer anywhere.

### Step 10. `app/compare/shopifyCsv.ts` (new)

Moved from `CompareDashboard.tsx` (`ShopifyProduct`, `parseNumber`, `parseShopifyCsv`), now on the shared parser; logic unchanged.

```ts
import { parseCsv } from "../lib/csv";

/** One Shopify variant from a products_export.csv, keyed by Variant SKU. */
export type ShopifyProduct = {
  sku: string;
  title: string;
  handle?: string;
  shopifyPrice: number | null;
  shopifyCost: number | null;
};

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Shopify's product export to sku -> product. Needs the "Variant SKU" and
 * "Variant Price" columns; "Title", "Cost per item" and "Handle" are optional.
 * Rows without a sku or a numeric price are skipped. A repeated sku keeps the
 * last row. The error strings are shown to the user as written.
 */
export function parseShopifyCsv(text: string): {
  products: Record<string, ShopifyProduct>;
  error?: string;
} {
  const rows = parseCsv(text);
  if (!rows.length) {
    return { products: {}, error: "CSV file is empty." };
  }

  const headers = rows[0].map((header) => header.trim());
  const headerIndex = new Map<string, number>();
  headers.forEach((header, index) => {
    headerIndex.set(header, index);
  });

  const skuIndex = headerIndex.get("Variant SKU");
  const titleIndex = headerIndex.get("Title");
  const priceIndex = headerIndex.get("Variant Price");
  const costIndex = headerIndex.get("Cost per item");
  const handleIndex = headerIndex.get("Handle");

  if (skuIndex === undefined || priceIndex === undefined) {
    return {
      products: {},
      error:
        "Missing required columns. Ensure the CSV includes Variant SKU and Variant Price.",
    };
  }

  const products: Record<string, ShopifyProduct> = {};

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const sku = row[skuIndex]?.trim();
    if (!sku) continue;

    const title = titleIndex !== undefined ? row[titleIndex]?.trim() : "";
    const price = parseNumber(row[priceIndex]);
    const cost = costIndex !== undefined ? parseNumber(row[costIndex]) : null;
    const handle = handleIndex !== undefined ? row[handleIndex]?.trim() : "";

    if (price === null) continue;

    products[sku] = {
      sku,
      title: title || sku,
      handle: handle || undefined,
      shopifyPrice: price,
      shopifyCost: cost,
    };
  }

  return { products };
}
```

### Step 11. `app/compare/compareMath.ts` (new)

The business rules, moved and made pure. `getPriceStatus` replaces the two copies of the threshold rule (`summaryStats` and the Status cell).

```ts
/**
 * The Seller Tools business rules: matching a Shopify export to the market
 * catalog, profit, margin, profit per day since release, and the
 * above/below-threshold buckets. Pure, so every rule is unit tested
 * (compare/__tests__/compareMath.test.ts) without rendering the page.
 *
 * Money: Shopify prices and costs are CAD. The market price arrives in USD
 * and is converted with the page's exchange rate; every derived figure is CAD.
 */
import { daysSinceUtcMs, perDay, releaseDateUtcMs } from "../lib/marketMath";
import type { MarketProduct } from "./marketProducts";
import type { ShopifyProduct } from "./shopifyCsv";

export type ComparisonRow = {
  sku: string;
  title: string;
  shopifyPrice: number | null;
  shopifyCost: number | null;
  marketPriceUsd: number | null;
  marketPriceCad: number | null;
  difference: number | null;
  differencePct: number | null;
  shopifyProfit: number | null;
  shopifyMargin: number | null;
  marketProfit: number | null;
  marketProfitPerDay: number | null;
  marketMargin: number | null;
  releaseDate: string | null;
  releaseDateMs: number | null;
  setName?: string | null;
  productType?: string | null;
  lastUpdated?: string | null;
};

export type PriceStatus = "Below" | "Above" | "OK" | "N/A";

export type ComparisonSummary = {
  total: number;
  below: number;
  above: number;
  ok: number;
  missingCost: number;
};

/** price - cost, or null when either is missing. */
export function calculateProfit(price: number | null, cost: number | null): number | null {
  if (price === null || cost === null) return null;
  return price - cost;
}

/** (price - cost) / price as a percent, or null when missing or price is 0. */
export function calculateMargin(price: number | null, cost: number | null): number | null {
  if (price === null || cost === null || price === 0) return null;
  return ((price - cost) / price) * 100;
}

/**
 * One row per Shopify sku that is in the market catalog with a price.
 * Order follows `shopifyProducts` (the CSV order); the tables sort it.
 */
export function buildComparisonRows(
  shopifyProducts: Record<string, ShopifyProduct>,
  marketProducts: Record<string, MarketProduct>,
  exchangeRate: number,
  todayUtcMs: number
): ComparisonRow[] {
  const rows: ComparisonRow[] = [];

  for (const shopifyItem of Object.values(shopifyProducts)) {
    const marketItem = marketProducts[shopifyItem.sku];
    if (!marketItem || marketItem.marketPriceUsd === null) continue;

    const marketCad = marketItem.marketPriceUsd * exchangeRate;
    const difference =
      shopifyItem.shopifyPrice !== null ? shopifyItem.shopifyPrice - marketCad : null;
    const differencePct =
      difference !== null && marketCad > 0 ? (difference / marketCad) * 100 : null;
    const marketProfit = calculateProfit(marketCad, shopifyItem.shopifyCost);
    const releaseDate = marketItem.releaseDate ?? null;
    const releaseDateMs = releaseDateUtcMs(releaseDate);

    rows.push({
      sku: shopifyItem.sku,
      title: shopifyItem.title,
      shopifyPrice: shopifyItem.shopifyPrice,
      shopifyCost: shopifyItem.shopifyCost,
      marketPriceUsd: marketItem.marketPriceUsd,
      marketPriceCad: marketCad,
      difference,
      differencePct,
      shopifyProfit: calculateProfit(shopifyItem.shopifyPrice, shopifyItem.shopifyCost),
      shopifyMargin: calculateMargin(shopifyItem.shopifyPrice, shopifyItem.shopifyCost),
      marketProfit,
      marketProfitPerDay: perDay(marketProfit, daysSinceUtcMs(releaseDateMs, todayUtcMs)),
      marketMargin: calculateMargin(marketCad, shopifyItem.shopifyCost),
      releaseDate,
      releaseDateMs,
      setName: marketItem.setName,
      productType: marketItem.productType,
      lastUpdated: marketItem.lastUpdated,
    });
  }

  return rows;
}

/** Case-insensitive substring match on sku or title. Blank term keeps all. */
export function filterComparisonRows(
  rows: ComparisonRow[],
  searchTerm: string
): ComparisonRow[] {
  const term = searchTerm.trim().toLowerCase();
  if (!term) return rows;
  return rows.filter(
    (row) =>
      row.sku.toLowerCase().includes(term) || row.title.toLowerCase().includes(term)
  );
}

/**
 * Shopify price vs market: more than `thresholdPct` under the market is
 * "Below", more than `thresholdPct` over is "Above", anything within
 * (inclusive) is "OK".
 */
export function getPriceStatus(
  differencePct: number | null,
  thresholdPct: number
): PriceStatus {
  if (differencePct === null) return "N/A";
  if (differencePct < -thresholdPct) return "Below";
  if (differencePct > thresholdPct) return "Above";
  return "OK";
}

/** The five summary tiles. missingCost counts rows even when status is N/A. */
export function summarizeComparison(
  rows: ComparisonRow[],
  thresholdPct: number
): ComparisonSummary {
  const summary: ComparisonSummary = {
    total: rows.length,
    below: 0,
    above: 0,
    ok: 0,
    missingCost: 0,
  };

  for (const row of rows) {
    if (row.shopifyCost === null) summary.missingCost += 1;
    const status = getPriceStatus(row.differencePct, thresholdPct);
    if (status === "Below") summary.below += 1;
    else if (status === "Above") summary.above += 1;
    else if (status === "OK") summary.ok += 1;
  }

  return summary;
}
```

### Step 12. The table: `app/components/SortableTable/SortableTable.tsx`, `app/compare/compareColumns.tsx`, `app/compare/CompareTabs.tsx` (new)

12a. `app/components/SortableTable/SortableTable.tsx`. Generic, `table-fixed`, memoised at the table and at the row (F074 re-verification: a memoised row component is the second most valuable fix after the deferred search, because the filter keeps row object identity); its `SortButton` is the compare page's button (same markup, indicator hidden from screen readers, `aria-sort` on the header cell). Row and cell classes are the ones the compare page used, so the tables look the same.

```tsx
"use client";

import { memo, useMemo, type ReactNode } from "react";
import {
  compareSortValues,
  type SortDirection,
  type SortValue,
  type StringComparator,
} from "../../lib/sorting";

export type SortState<K extends string> = { key: K; direction: SortDirection };

export interface SortableColumn<Row, K extends string> {
  /** Unique within the table. Used as the React key. */
  id: string;
  label: string;
  /** Omit for a column that cannot be sorted; its header is a plain label. */
  sortKey?: K;
  /** Default "left". */
  align?: "left" | "right";
  /**
   * Width class for the <col> (the table is table-fixed). Omit on exactly
   * one column, usually the title, so it takes the remaining width.
   */
  widthClassName?: string;
  /** Full className of each body cell. */
  cellClassName: string;
  cell: (row: Row) => ReactNode;
  /** Optional title attribute of each body cell (hover text). */
  cellTitle?: (row: Row) => string | undefined;
}

export interface SortableTableProps<Row, K extends string> {
  /** Screen-reader caption. */
  caption: string;
  rows: readonly Row[];
  columns: readonly SortableColumn<Row, K>[];
  sort: SortState<K>;
  onSortChange: (next: SortState<K>) => void;
  /** The value a column sorts by. null (and NaN) sort last in both directions. */
  sortValue: (row: Row, key: K) => SortValue;
  rowKey: (row: Row) => string;
  emptyMessage: string;
  /** How string cells order. Default: plain localeCompare. */
  compareStrings?: StringComparator;
  /** Minimum table width class so narrow screens scroll instead of crushing columns. */
  minWidthClassName?: string;
}

type SortButtonProps<K extends string> = {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSortChange: (next: SortState<K>) => void;
  align?: "left" | "right";
};

/**
 * Column header button. A new column starts ascending; clicking the active
 * column flips its direction.
 */
export function SortButton<K extends string>({
  label,
  sortKey,
  sort,
  onSortChange,
  align = "left",
}: SortButtonProps<K>) {
  const isActive = sort.key === sortKey;
  const indicator = isActive ? (sort.direction === "asc" ? "▲" : "▼") : "↕";

  const handleClick = () => {
    onSortChange(
      isActive
        ? { key: sortKey, direction: sort.direction === "asc" ? "desc" : "asc" }
        : { key: sortKey, direction: "asc" }
    );
  };

  const alignment = align === "right" ? "justify-end text-right" : "justify-start";

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600 hover:text-slate-900 ${alignment}`}
    >
      <span>{label}</span>
      <span aria-hidden="true" className="text-[10px]">
        {indicator}
      </span>
    </button>
  );
}

type SortableTableRowProps<Row, K extends string> = {
  row: Row;
  columns: readonly SortableColumn<Row, K>[];
};

function SortableTableRowImpl<Row, K extends string>({
  row,
  columns,
}: SortableTableRowProps<Row, K>) {
  return (
    <tr className="rounded-xl bg-slate-50/80 shadow-sm ring-1 ring-slate-200/60 transition hover:bg-white">
      {columns.map((column) => (
        <td key={column.id} className={column.cellClassName} title={column.cellTitle?.(row)}>
          {column.cell(row)}
        </td>
      ))}
    </tr>
  );
}

/**
 * One body row, memoised (F074). When the search narrows or widens, rows that
 * stay keep the same object (filterComparisonRows uses Array.filter) and the
 * same memoised `columns`, so React skips them and only adds or removes the
 * rows that changed. Re-sorting moves rows without re-rendering them.
 */
const SortableTableRow = memo(SortableTableRowImpl) as typeof SortableTableRowImpl;

function SortableTableImpl<Row, K extends string>({
  caption,
  rows,
  columns,
  sort,
  onSortChange,
  sortValue,
  rowKey,
  emptyMessage,
  compareStrings,
  minWidthClassName = "",
}: SortableTableProps<Row, K>) {
  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) =>
      compareSortValues(
        sortValue(a, sort.key),
        sortValue(b, sort.key),
        sort.direction,
        compareStrings
      )
    );
    return copy;
  }, [rows, sort, sortValue, compareStrings]);

  return (
    <div className="overflow-x-auto">
      <table
        className={`w-full table-fixed border-separate border-spacing-y-2 text-sm ${minWidthClassName}`}
      >
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {columns.map((column) => (
            <col key={column.id} className={column.widthClassName} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => {
              const align = column.align ?? "left";
              const isActive = column.sortKey !== undefined && column.sortKey === sort.key;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={
                    isActive
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  className={`px-3 pb-2 ${align === "right" ? "text-right" : "text-left"}`}
                >
                  {column.sortKey !== undefined ? (
                    <SortButton
                      label={column.label}
                      sortKey={column.sortKey}
                      sort={sort}
                      onSortChange={onSortChange}
                      align={align}
                    />
                  ) : (
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {column.label}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <SortableTableRow key={rowKey(row)} row={row} columns={columns} />
          ))}
          {sortedRows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-6 text-center text-sm text-slate-500"
              >
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A sortable, table-fixed data table driven by column definitions.
 * Memoised: with stable props (module-level or memoised columns, sortValue,
 * rowKey) a parent re-render that does not change them skips the table.
 */
const SortableTable = memo(SortableTableImpl) as typeof SortableTableImpl;

export default SortableTable;
```

12b. `app/compare/compareColumns.tsx`: the three column sets, the page's formatters (moved from `CompareDashboard.tsx`, in their WP07 form) and the sort helpers. No `"use client"` needed (no hooks); it is only imported by the client component.

```tsx
import { formatDateOnly, formatMoney, type CurrencyCode } from "../lib/format";
import type { SortValue } from "../lib/sorting";
import type { SortableColumn } from "../components/SortableTable/SortableTable";
import { getPriceStatus, type ComparisonRow, type PriceStatus } from "./compareMath";

// Page convention: missing values render as an em dash character.
const MISSING = "\u2014";

// Shopify prices, costs and every derived figure here are CAD; only
// marketPriceUsd is USD and passes "USD" explicitly.
export function formatCurrency(value: number | null, currency: CurrencyCode = "CAD"): string {
  return formatMoney(value, currency, { missing: MISSING });
}

export function formatSignedCurrency(value: number | null): string {
  return formatMoney(value, "CAD", { signed: true, missing: MISSING });
}

export function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return MISSING;
  return `${value.toFixed(1)}%`;
}

export type CompareSortKey =
  | "sku"
  | "title"
  | "shopifyPrice"
  | "shopifyCost"
  | "marketPriceUsd"
  | "marketPriceCad"
  | "difference"
  | "differencePct";

export type ShopifyMarginSortKey =
  | "sku"
  | "title"
  | "shopifyPrice"
  | "shopifyCost"
  | "shopifyProfit"
  | "shopifyMargin";

export type MarketMarginSortKey =
  | "sku"
  | "title"
  | "releaseDateMs"
  | "marketPriceUsd"
  | "marketPriceCad"
  | "shopifyCost"
  | "marketProfit"
  | "marketProfitPerDay"
  | "marketMargin";

type AnySortKey = CompareSortKey | ShopifyMarginSortKey | MarketMarginSortKey;
type Column<K extends AnySortKey> = SortableColumn<ComparisonRow, K>;

/** Every sort key is a number, string or null field of ComparisonRow. */
export function comparisonSortValue(row: ComparisonRow, key: AnySortKey): SortValue {
  const value = row[key];
  return typeof value === "number" || typeof value === "string" ? value : null;
}

export function comparisonRowKey(row: ComparisonRow): string {
  return row.sku;
}

// Case- and accent-insensitive, as the page always sorted titles and skus.
const TITLE_COLLATOR = new Intl.Collator(undefined, { sensitivity: "base" });
export const compareTitles = (a: string, b: string): number => TITLE_COLLATOR.compare(a, b);

const STATUS_STYLES: Record<PriceStatus, string> = {
  Below: "bg-rose-100 text-rose-700",
  Above: "bg-emerald-100 text-emerald-700",
  OK: "bg-slate-100 text-slate-700",
  "N/A": "bg-slate-100 text-slate-700",
};

// Shared column pieces. Cell classes are the ones the page used before the
// split, so the tables look the same.
function skuColumn<K extends AnySortKey>(): Column<K> {
  return {
    id: "sku",
    label: "SKU",
    sortKey: "sku" as K,
    widthClassName: "w-36",
    cellClassName: "px-3 py-3 font-medium text-slate-900 break-all",
    cell: (row) => row.sku,
  };
}

function titleColumn<K extends AnySortKey>(): Column<K> {
  return {
    id: "title",
    label: "Title",
    sortKey: "title" as K,
    cellClassName: "px-3 py-3 text-slate-600 break-words",
    cell: (row) => row.title,
    cellTitle: (row) => row.title,
  };
}

function moneyColumn<K extends AnySortKey>(
  id: K & keyof ComparisonRow,
  label: string,
  cellClassName: string,
  render: (row: ComparisonRow) => string
): Column<K> {
  return {
    id,
    label,
    sortKey: id,
    align: "right",
    widthClassName: "w-24",
    cellClassName,
    cell: render,
  };
}

const RIGHT = "px-3 py-3 text-right text-slate-900";
const RIGHT_MUTED = "px-3 py-3 text-right text-slate-500";
const RIGHT_STRONG = "px-3 py-3 text-right font-semibold text-slate-900";

export function buildCompareColumns({
  showUsd,
  thresholdPct,
}: {
  showUsd: boolean;
  thresholdPct: number;
}): Column<CompareSortKey>[] {
  const columns: Column<CompareSortKey>[] = [
    skuColumn(),
    titleColumn(),
    moneyColumn("shopifyPrice", "Shopify", RIGHT, (row) => formatCurrency(row.shopifyPrice)),
    moneyColumn("shopifyCost", "Cost", RIGHT_MUTED, (row) => formatCurrency(row.shopifyCost)),
  ];
  if (showUsd) {
    columns.push(
      moneyColumn("marketPriceUsd", "Market USD", RIGHT_MUTED, (row) =>
        formatCurrency(row.marketPriceUsd, "USD")
      )
    );
  }
  columns.push(
    moneyColumn("marketPriceCad", "Market", RIGHT, (row) => formatCurrency(row.marketPriceCad)),
    moneyColumn("difference", "Diff", RIGHT_STRONG, (row) =>
      formatSignedCurrency(row.difference)
    ),
    {
      id: "differencePct",
      label: "Diff %",
      sortKey: "differencePct",
      align: "right",
      widthClassName: "w-20",
      cellClassName: RIGHT_MUTED,
      cell: (row) => formatPercent(row.differencePct),
    },
    {
      id: "status",
      label: "Status",
      widthClassName: "w-24",
      cellClassName: "px-3 py-3",
      cell: (row) => {
        const status = getPriceStatus(row.differencePct, thresholdPct);
        return (
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}>
            {status}
          </span>
        );
      },
    }
  );
  return columns;
}

export const SHOPIFY_MARGIN_COLUMNS: readonly Column<ShopifyMarginSortKey>[] = [
  skuColumn(),
  titleColumn(),
  moneyColumn("shopifyPrice", "Shopify", RIGHT, (row) => formatCurrency(row.shopifyPrice)),
  moneyColumn("shopifyCost", "Cost", RIGHT_MUTED, (row) => formatCurrency(row.shopifyCost)),
  moneyColumn("shopifyProfit", "Profit", RIGHT_STRONG, (row) =>
    formatSignedCurrency(row.shopifyProfit)
  ),
  {
    id: "shopifyMargin",
    label: "Margin",
    sortKey: "shopifyMargin",
    align: "right",
    widthClassName: "w-20",
    cellClassName: RIGHT_MUTED,
    cell: (row) => formatPercent(row.shopifyMargin),
  },
];

export function buildMarketMarginColumns({
  showUsd,
}: {
  showUsd: boolean;
}): Column<MarketMarginSortKey>[] {
  const columns: Column<MarketMarginSortKey>[] = [
    skuColumn(),
    titleColumn(),
    {
      id: "releaseDateMs",
      label: "Release Date",
      sortKey: "releaseDateMs",
      widthClassName: "w-32",
      cellClassName: "px-3 py-3 text-slate-500",
      cell: (row) => formatDateOnly(row.releaseDate),
    },
  ];
  if (showUsd) {
    columns.push(
      moneyColumn("marketPriceUsd", "Market USD", RIGHT_MUTED, (row) =>
        formatCurrency(row.marketPriceUsd, "USD")
      )
    );
  }
  columns.push(
    moneyColumn("marketPriceCad", "Market", RIGHT, (row) => formatCurrency(row.marketPriceCad)),
    moneyColumn("shopifyCost", "Cost", RIGHT_MUTED, (row) => formatCurrency(row.shopifyCost)),
    moneyColumn("marketProfit", "Profit", RIGHT_STRONG, (row) =>
      formatSignedCurrency(row.marketProfit)
    ),
    moneyColumn("marketProfitPerDay", "Profit / Day", RIGHT_MUTED, (row) =>
      formatSignedCurrency(row.marketProfitPerDay)
    ),
    {
      id: "marketMargin",
      label: "Margin",
      sortKey: "marketMargin",
      align: "right",
      widthClassName: "w-20",
      cellClassName: RIGHT_MUTED,
      cell: (row) => formatPercent(row.marketMargin),
    }
  );
  return columns;
}
```

Column widths assume the `max-w-[96rem]` page container; the title column has no width class and takes the rest. Keep every class a literal string so Tailwind sees it.

12c. `app/compare/CompareTabs.tsx`: WAI-ARIA tabs with automatic activation. `aria-controls` is set only on the selected tab because only the selected panel exists in the DOM.

```tsx
"use client";

import type { KeyboardEvent } from "react";

export type CompareTabId = "comparison" | "shopify-margin" | "market-margin";

export const COMPARE_TABS: ReadonlyArray<{
  id: CompareTabId;
  label: string;
  title: string;
  description: string;
}> = [
  {
    id: "comparison",
    label: "Price comparison",
    title: "Shopify vs Market Comparison",
    description: "Prices in CAD. Sort any column to explore.",
  },
  {
    id: "shopify-margin",
    label: "Shopify margin",
    title: "Shopify Margin Table",
    description: "Your Shopify price against your cost. Sorted by lowest margin first.",
  },
  {
    id: "market-margin",
    label: "Market margin",
    title: "Market Margin Table",
    description: "The market price against your cost. Sorted by lowest margin first.",
  },
];

export const compareTabDomId = (id: CompareTabId) => `compare-tab-${id}`;
export const comparePanelDomId = (id: CompareTabId) => `compare-panel-${id}`;

/**
 * WAI-ARIA tabs (automatic activation): Left/Right/Home/End move and select,
 * only the selected tab is in the tab order.
 */
export default function CompareTabs({
  active,
  onChange,
}: {
  active: CompareTabId;
  onChange: (next: CompareTabId) => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = COMPARE_TABS.length;
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % count;
    else if (event.key === "ArrowLeft") next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    if (next === -1) return;
    event.preventDefault();
    onChange(COMPARE_TABS[next].id);
    // Move focus with the selection. The tab buttons are siblings.
    const tabs =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Seller tool tables"
      className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1"
    >
      {COMPARE_TABS.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={compareTabDomId(tab.id)}
            aria-selected={selected}
            aria-controls={selected ? comparePanelDomId(tab.id) : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)] ${
              selected
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
```

### Step 13. `app/compare/CompareDashboard.tsx`: thin component

13a. Delete from the module scope: the types `ShopifyProduct`, `ComparisonRow`, `SortDirection`, `CompareSortKey`, `ShopifyProfitSortKey`, `MarketProfitSortKey`, `SortState`; the constants `DAY_MS` and `MISSING`; the functions `parseCsv`, `parseNumber`, `parseShopifyCsv`, `formatCurrency`, `formatSignedCurrency`, `formatPercent`, `getReleaseUtcMs`, `formatReleaseDate` (if still present), `getTodayUtcStartMs`, `calculateProfit`, `calculateMargin`, `compareValues` and the `SortButton` component. Keep `DEFAULT_EXCHANGE_RATE`, `MARKET_DATA_UNAVAILABLE` (WP15), `CompareDashboardProps` (WP11).

13b. Inside the component: keep every existing `useState`, the `needsProducts`/`needsRate` lines and the mount `useEffect` exactly as they are (WP11/WP15 versions). In particular `needsProducts` stays `initialMarketProducts === undefined`: an empty map must not trigger a browser fetch (WP11 pitfall; WP11's `CompareDashboard.test.tsx` case "with `initialMarketProducts={{}}` ... `fetchMarketProductsClient` is not called" guards it). Rename the sort states for the new key types (`shopifyProfitSort` becomes `shopifyMarginSort` of type `SortState<ShopifyMarginSortKey>`, `marketProfitSort` becomes `marketMarginSort` of type `SortState<MarketMarginSortKey>`), keep their initial values (`differencePct` / `shopifyMargin` / `marketMargin`, all `"asc"`), and add `const [activeTab, setActiveTab] = useState<CompareTabId>("comparison");`.

13c. Replace `comparisonRows`, `filteredRows`, the three `sorted*Rows` memos and `summaryStats` with the memos in the reference file below (`buildComparisonRows`, `useDeferredValue` + `filterComparisonRows`, `summarizeComparison`, and the two column memos). Sorting now happens inside `SortableTable`, only for the visible table.

13d. JSX: keep everything from `<main` through the end of the five summary tiles unchanged. Replace the rest (the "Shopify vs Market Comparison" card that holds the search input, and the `<div className="space-y-6">` holding the two margin tables) with the `<section>` in the reference file. Move the search `<input>` element into it exactly as it is in the current file (WP14 gave it `aria-label` and a focus ring); only its position changes.

13e. Imports: `useDeferredValue` from React; the new modules; remove every import that is now unused (`formatMoney`, `CurrencyCode`, `utcMidnightMs` if unused, etc.). `pnpm exec eslint app/compare` must report 0 problems.

Reference: the complete file after this step, assuming WP07, WP11, WP14 and WP15 landed exactly as specified. Where the current file's kept blocks (the props type, the state, the `needsProducts`/`needsRate` lines, the effect, the header card between the `KEEP-1` markers, the search input marked `KEEP-2`) differ from this reference, the current file wins for those blocks. Delete the three `KEEP` marker comments when done. Build the file by editing the current one (steps 13a to 13e); do not paste this reference over it wholesale.

```tsx
"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { fetchLatestExchangeRateClient } from "../lib/exchangeRate";
import { fetchMarketProductsClient } from "../lib/clientMarketData";
import { utcMidnightMs } from "../lib/marketPulse";
import { formatDateOnly } from "../lib/format";
import { logCaughtError } from "../lib/logger";
import type { ExchangeRateSnapshot } from "../lib/marketData";
import SortableTable, { type SortState } from "../components/SortableTable/SortableTable";
import { buildMarketProductMap, type MarketProduct } from "./marketProducts";
import { parseShopifyCsv, type ShopifyProduct } from "./shopifyCsv";
import {
  buildComparisonRows,
  filterComparisonRows,
  summarizeComparison,
} from "./compareMath";
import {
  SHOPIFY_MARGIN_COLUMNS,
  buildCompareColumns,
  buildMarketMarginColumns,
  compareTitles,
  comparisonRowKey,
  comparisonSortValue,
  type CompareSortKey,
  type MarketMarginSortKey,
  type ShopifyMarginSortKey,
} from "./compareColumns";
import CompareTabs, {
  COMPARE_TABS,
  comparePanelDomId,
  compareTabDomId,
  type CompareTabId,
} from "./CompareTabs";

const DEFAULT_EXCHANGE_RATE = 1.35;

const MARKET_DATA_UNAVAILABLE =
  "We couldn't load current market prices. Refresh the page to try again.";

type CompareDashboardProps = {
  /**
   * sku map built on the server (buildMarketProductMap). Absent when the
   * server had no catalog (failed read or empty stub): fetched in the
   * browser. Present but empty means "the catalog has no sku products", which
   * a browser fetch would not change.
   */
  initialMarketProducts?: Record<string, MarketProduct>;
  /** Server-cached rate. Absent when the server only had the hard-coded fallback: fetched in the browser. */
  initialExchangeRate?: ExchangeRateSnapshot;
};

export default function CompareDashboard({
  initialMarketProducts,
  initialExchangeRate,
}: CompareDashboardProps) {
  const [shopifyProducts, setShopifyProducts] = useState<
    Record<string, ShopifyProduct>
  >({});
  // page.tsx passes undefined when it had no catalog at all (the stub build,
  // or the summaries failed), so only then does the browser fetch. Do not
  // gate on the map being empty: a catalog with no sku products legitimately
  // builds {}, and refetching it in every browser would bring back F143.
  const needsProducts = initialMarketProducts === undefined;
  const needsRate = initialExchangeRate === undefined;

  const [marketProducts, setMarketProducts] = useState<
    Record<string, MarketProduct>
  >(() => initialMarketProducts ?? {});
  const [exchangeRate, setExchangeRate] = useState<number | null>(
    initialExchangeRate?.rate ?? null
  );
  const [exchangeRateDate, setExchangeRateDate] = useState<string | null>(
    initialExchangeRate?.date ?? null
  );
  const [loadingMarket, setLoadingMarket] = useState(needsProducts);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showUsd, setShowUsd] = useState(false);
  const [thresholdPct, setThresholdPct] = useState(5);
  const [activeTab, setActiveTab] = useState<CompareTabId>("comparison");

  const [compareSort, setCompareSort] = useState<SortState<CompareSortKey>>({
    key: "differencePct",
    direction: "asc",
  });
  const [shopifyMarginSort, setShopifyMarginSort] = useState<
    SortState<ShopifyMarginSortKey>
  >({ key: "shopifyMargin", direction: "asc" });
  const [marketMarginSort, setMarketMarginSort] = useState<
    SortState<MarketMarginSortKey>
  >({ key: "marketMargin", direction: "asc" });

  useEffect(() => {
    if (!needsProducts && !needsRate) return;

    let cancelled = false;

    const fetchMarketData = async () => {
      try {
        const [rateSnapshot, productData] = await Promise.all([
          needsRate ? fetchLatestExchangeRateClient() : Promise.resolve(null),
          needsProducts ? fetchMarketProductsClient() : Promise.resolve(null),
        ]);
        if (cancelled) return;

        if (rateSnapshot) {
          setExchangeRate(rateSnapshot.rate ?? DEFAULT_EXCHANGE_RATE);
          setExchangeRateDate(rateSnapshot.date ?? null);
        }
        if (productData) {
          setMarketProducts(buildMarketProductMap(productData));
        }
      } catch (err: unknown) {
        if (cancelled) return;
        // Never show err.message: it carries PostgREST / fetch wording.
        logCaughtError("compare_market_data_failed", err);
        setErrorMessage(MARKET_DATA_UNAVAILABLE);
      } finally {
        if (!cancelled) setLoadingMarket(false);
      }
    };

    fetchMarketData();

    return () => {
      cancelled = true;
    };
  }, [needsProducts, needsRate]);

  const exchangeRateValue = exchangeRate ?? DEFAULT_EXCHANGE_RATE;

  const comparisonRows = useMemo(
    () =>
      buildComparisonRows(
        shopifyProducts,
        marketProducts,
        exchangeRateValue,
        utcMidnightMs()
      ),
    [shopifyProducts, marketProducts, exchangeRateValue]
  );

  // The input renders `searchTerm` (urgent), the tables key off the deferred
  // copy, so typing never waits on filtering, sorting and laying out ~300
  // rows (F074). SortableTable is memoised, so the urgent render skips it.
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const isFiltering = deferredSearchTerm !== searchTerm;

  const filteredRows = useMemo(
    () => filterComparisonRows(comparisonRows, deferredSearchTerm),
    [comparisonRows, deferredSearchTerm]
  );

  const summaryStats = useMemo(
    () => summarizeComparison(comparisonRows, thresholdPct),
    [comparisonRows, thresholdPct]
  );

  const compareColumns = useMemo(
    () => buildCompareColumns({ showUsd, thresholdPct }),
    [showUsd, thresholdPct]
  );
  const marketMarginColumns = useMemo(
    () => buildMarketMarginColumns({ showUsd }),
    [showUsd]
  );

  const activeTabMeta =
    COMPARE_TABS.find((tab) => tab.id === activeTab) ?? COMPARE_TABS[0];

  const handleCsvUpload = async (file: File) => {
    const text = await file.text();
    const { products, error } = parseShopifyCsv(text);
    if (error) {
      setErrorMessage(error);
      setShopifyProducts({});
      setFileName(null);
      return;
    }
    setErrorMessage(null);
    setShopifyProducts(products);
    setFileName(file.name);
  };

  return (
    <main className="min-h-screen bg-[var(--pf-bg)]">
      <div className="mx-auto max-w-[96rem] space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        {/* KEEP-1 start: page heading, copied unchanged from the current file */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--pf-pokeball)]">
            Pokéfin Tools
          </p>
          <h1 className="mt-1 text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
            Seller Tools
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Upload your Shopify export and compare your store prices against the market. Pricing and margin insights surface in sortable tables. All prices are CAD unless noted.
          </p>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span className="tabular-nums">
                  Exchange rate: 1 USD = {exchangeRateValue.toFixed(4)} CAD
                </span>
                {exchangeRateDate && (
                  <span>Updated: {formatDateOnly(exchangeRateDate)}</span>
                )}
                {loadingMarket && <span>Loading market data…</span>}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="relative flex w-full cursor-pointer flex-col gap-1 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-600 transition hover:border-slate-400 focus-within:ring-2 focus-within:ring-[var(--pf-pokeblue)]">
                <span className="font-semibold text-slate-700">
                  Upload Shopify CSV
                </span>
                <span className="text-xs">
                  {fileName ?? "Choose products_export.csv"}
                </span>
                <input
                  type="file"
                  accept=".csv"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleCsvUpload(file);
                  }}
                />
              </label>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setShowUsd((prev) => !prev)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300"
                >
                  {showUsd ? "Hide USD" : "Show USD"}
                </button>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  Threshold %
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={thresholdPct}
                    onChange={(event) =>
                      setThresholdPct(Number(event.target.value) || 0)
                    }
                    className="w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                  />
                </label>
              </div>
            </div>
          </div>
          {errorMessage && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          {[
            { label: "Matched", value: summaryStats.total },
            { label: "Below Threshold", value: summaryStats.below },
            { label: "Above Threshold", value: summaryStats.above },
            { label: "Within Threshold", value: summaryStats.ok },
            { label: "Missing Cost", value: summaryStats.missingCost },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
            >
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {item.label}
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {item.value}
              </p>
            </div>
          ))}
        </div>
        {/* KEEP-1 end */}

        <section className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CompareTabs active={activeTab} onChange={setActiveTab} />
            {/* KEEP-2: the search input, copied unchanged from the current file */}
            <input
              type="text"
              placeholder="Search SKU or title"
              aria-label="Search by SKU or title"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)] md:w-64"
            />
          </div>

          <div
            role="tabpanel"
            id={comparePanelDomId(activeTab)}
            aria-labelledby={compareTabDomId(activeTab)}
            tabIndex={0}
          >
            <h2 className="text-lg font-semibold text-slate-900">
              {activeTabMeta.title}
            </h2>
            <p className="text-xs text-slate-500">{activeTabMeta.description}</p>
            <div
              aria-busy={isFiltering}
              className={`mt-4 transition-opacity ${isFiltering ? "opacity-60" : ""}`}
            >
              {activeTab === "comparison" && (
                <SortableTable
                  caption="Shopify prices compared with market prices"
                  rows={filteredRows}
                  columns={compareColumns}
                  sort={compareSort}
                  onSortChange={setCompareSort}
                  sortValue={comparisonSortValue}
                  rowKey={comparisonRowKey}
                  compareStrings={compareTitles}
                  emptyMessage="Upload a Shopify CSV to see matched products."
                  minWidthClassName="min-w-[56rem]"
                />
              )}
              {activeTab === "shopify-margin" && (
                <SortableTable
                  caption="Shopify margin by product"
                  rows={filteredRows}
                  columns={SHOPIFY_MARGIN_COLUMNS}
                  sort={shopifyMarginSort}
                  onSortChange={setShopifyMarginSort}
                  sortValue={comparisonSortValue}
                  rowKey={comparisonRowKey}
                  compareStrings={compareTitles}
                  emptyMessage="No matched products yet."
                  minWidthClassName="min-w-[44rem]"
                />
              )}
              {activeTab === "market-margin" && (
                <SortableTable
                  caption="Market margin by product"
                  rows={filteredRows}
                  columns={marketMarginColumns}
                  sort={marketMarginSort}
                  onSortChange={setMarketMarginSort}
                  sortValue={comparisonSortValue}
                  rowKey={comparisonRowKey}
                  compareStrings={compareTitles}
                  emptyMessage="No matched products yet."
                  minWidthClassName="min-w-[56rem]"
                />
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
```

Do not touch `app/compare/page.tsx` (WP11 server shell, WP13 metadata) or `app/compare/marketProducts.ts`.

### Step 14. `app/lib/import.ts`: shared parser for Collectr (F003)

14a. Add `import { parseCsv } from "./csv";` to the imports.

14b. Replace the body of `parseCollectrCSV` from its first line (`const lines = csvContent.split("\n")...`) through the line `if (values.length < 16) continue;` with:

```ts
  // RFC 4180 records (lib/csv.ts): quoted commas, "" escapes and a newline
  // inside a quoted Notes field stay in one record (F003). Blank lines are
  // dropped, as the old line split did.
  const records = parseCsv(csvContent).filter((fields) =>
    fields.some((field) => field.trim() !== "")
  );
  if (records.length < 2) return [];

  // Skip the header row. The cap is applied after parsing, so a record with
  // a multi-line note counts once. CSV_MAX_BYTES (enforced by the modal)
  // already bounds the parse.
  const dataRecords = records.slice(1, CSV_MAX_ROWS + 1);
  const rows: CollectrCSVRow[] = [];

  for (const record of dataRecords) {
    // Per-field trim, as before: Collectr pads names ("Booster Box ,"),
    // import.test.ts asserts the trimmed name, and the matcher compares
    // portfolioName and category exactly.
    const values = record.map((field) => field.trim());
    if (values.length < 16) continue;
```

The `const row: CollectrCSVRow = {...}` mapping and everything after it stay as they are.

14c. Delete `parseCSVLine` and its doc comment. Update the function's doc comment sentence "we also enforce CSV_MAX_ROWS here" to "we also enforce CSV_MAX_ROWS here, counted in records after parsing". Do not change `ImportHoldingsModal.tsx`'s line-count pre-check.

### Step 15. CI: the moved test in the timezone step

In `.github/workflows/ci.yml`, in WP07's "Timezone-sensitive tests" step, replace `app/components/MarketView/__tests__/returns.test.ts` on both lines with the moved test plus this package's two other zone-sensitive tests. From the repo root:

```bash
sed -i 's#app/components/MarketView/__tests__/returns.test.ts#app/lib/__tests__/marketMath.test.ts app/compare/__tests__/compareMath.test.ts app/components/__tests__/PriceChart.memo.test.tsx#g' .github/workflows/ci.yml
grep -c "app/lib/__tests__/marketMath.test.ts app/compare/__tests__/compareMath.test.ts app/components/__tests__/PriceChart.memo.test.tsx" .github/workflows/ci.yml   # expect 2
grep -c "MarketView/__tests__/returns.test.ts" .github/workflows/ci.yml                          # expect 0
```

A path that no longer exists makes jest exit 1 with "No tests found", which is why the old path must go. If the step does not exist (WP07 skipped its step 10), skip this step and say so in the PR.

## Pitfalls: do not do this

- **Do not compute PriceChart's ROI, CAGR or drawdown from daily points** (F005 verifier correction 1). The chips intentionally describe the downsampled charted series; daily data catches more troughs and changes the displayed numbers.
- **Do not keep a `convertPrice` parameter in the shared helpers** (F005 verifier correction 2). Percent metrics are currency-invariant; threading FX into the maths is the axis the copies diverged on.
- **Do not change the maths to make the volatility numbers agree** (F005 verifier correction 3). `/stats` comes from SQL `stddev_pop` (raw daily); de-annualising `/market` would silently shrink a column users sort by, and annualising `/stats` needs a migration. Label the units, as specified.
- **Do not give `volatilityPercent` a default unit.** The missing unit is the original bug.
- **Do not call the drawdown zero-peak guard a bug fix** (F005 verifier correction 4). The old code's `NaN` never won the comparison; the result is identical.
- **Do not seed `useResponsive` (or any state) from `window.matchMedia` in a `useState` initializer, and do not keep `useResponsive` with a changed default** (F073 verifier correction). Its only consumer, `ResponsivePriceChart`, mounts only on the client today, so it would work now, but a shared hook with window-dependent initial state causes a React 19 hydration mismatch the day a server-rendered component imports it. Use the CSS height classes.
- **Do not put the height classes on PriceChart's root or on `ResponsivePriceChart`'s outer `<div>`** (F073 re-verification). The chip row sits above the plot inside PriceChart's root; a fixed outer height with `ResponsiveContainer height="100%"` squashes the plot. Only the wrapper directly around `ResponsiveContainer` (and the no-data box) get them, per step 8h.
- **Do not add a module-level `Intl.DateTimeFormat`, a `[data]`/currency memo split or `existing.date` reuse to PriceChart** (F073 re-verification suggestions). WP07's `formatMonthDay` and step 8c's `displayData` already remove all per-day Intl work and all re-bucketing from the toggle; the extra changes would only add code.
- **Do not replace the literal `30` in `lookbackPoints: 30` in `buildRows.ts` or the product page** (Track 2). WP19 matches that text; WP24 step 1a swaps it for `PRODUCT_VOLATILITY_LOOKBACK_POINTS`.
- **Do not re-hoist or rename `PriceTooltip`/`PriceDot`.** WP17 did it and its tests import those names.
- **Do not pass Recharts `content` or `dot` as an inline arrow function** (WP17 pitfall): Recharts calls it as a component, so each render remounts.
- **Do not drop the per-field `.trim()` or the `CSV_MAX_ROWS` slice in `parseCollectrCSV`** (F003 verifier correction). `import.test.ts:31` asserts the trimmed `"Destined Rivals Booster Box"`, and the exact-match filter on `portfolioName`/`category` in `processCollectrImport` breaks on padded values.
- **Do not make the parser open quotes mid-field.** A strict "any quote toggles" or "any quote opens" rule turns a stray inch mark in a note into a field that swallows the rest of the file (F043 verifier correction 3).
- **Do not claim the old Collectr parser corrupted cost basis** (F003 verifier). Notes is the last column; the real effect was truncated notes and lost quote characters.
- **Do not swap `/compare` to plain `localeCompare`** (F043 verifier correction 2). Pass `compareTitles` (base sensitivity) so title and sku order stays case- and accent-insensitive.
- **Do not import `DEFAULT_EXCHANGE_RATE` from `lib/marketData` into the compare page or change `1.35`** here. WP11 recorded that WP20 owns it; the verifier showed the fallback is near-dead anyway.
- **Do not put `compareMath.ts` in `app/lib/`.** It would import from `app/compare/`, inverting the dependency direction (F048).
- **Do not expect a bundle-size or LCP change from the compare split** (F043 verifier correction 5). The win is testability and keystroke cost.
- **Do not change how `CompareDashboard` decides to fetch.** `needsProducts` is `initialMarketProducts === undefined` (WP11). Adding an "or the map is empty" condition makes every browser refetch the catalog when it has no sku products (F143) and fails WP11's `CompareDashboard.test.tsx`.
- **Do not paste the step 13 reference file over `CompareDashboard.tsx`.** Edit the current file; the reference only shows the target shape.
- **Do not `git mv` the returns test in step 7.** Step 1 already moved it; a second `git mv` onto an existing file fails.
- **Do not drop `matchProduct` from the `import.test.ts` import line** (WP17 added it and its cases); only add `CSV_MAX_ROWS`.
- **Do not paste a literal byte order mark into test sources.** Write `"\uFEFF..."`; an invisible character is lost or doubled by editors and the test then checks nothing.
- **Do not render all three tables and hide two with CSS.** Hidden tables still lay out on every update; only the active tab's table is mounted.
- **Do not create new row objects between `buildComparisonRows` and `SortableTable`** (F074 re-verification). `filterComparisonRows` must stay an `Array.filter` over the same objects (no `.map`, no spread), and `columns` must stay module-level or memoised; otherwise `SortableTableRow`'s `memo` never skips and every keystroke re-renders every row again.
- **Do not add virtualization (`@tanstack/react-virtual` or similar) to `/compare`** (F074 re-verification). It is not a dependency, rows are capped at the ~306-SKU catalog, and virtualizing `border-separate` tables with rounded ring rows breaks their layout.
- **Do not move MarketView's sort switch, columns or JSX** beyond the two volatility edits. That is WP19.
- **Do not edit the SQL migrations.** `get_set_analytics` stays the source of truth for `/stats`.
- **Do not write em dashes in new UI copy or comments** (house style; the plan forbids them).

## Tests

All paths relative to `frontend/`. Default environment is jsdom; none of these need `node`.

### 1. `app/lib/__tests__/marketMath.test.ts` (moved from `app/components/MarketView/__tests__/returns.test.ts`, rewritten)

Keeps the original `getReturnPercent` cases and all five of WP07's F122 cases (including "anchors on the UTC calendar day like the RPC" and the east-of-UTC regression, which pin WP07's date-key anchor) with the new signatures, and adds CAGR, drawdown, volatility units, daily points, date helpers and the exported windows and factors (Track 2: pinned to their values and to the SQL windows). It must pass under `TZ=UTC`, `TZ=America/Vancouver` and `TZ=Asia/Tokyo`.

```ts
import { readFileSync } from "fs";
import { join } from "path";
import {
  ANNUALISATION_FACTOR,
  DAYS_PER_YEAR,
  PRODUCT_VOLATILITY_LOOKBACK_POINTS,
  RETURN_WINDOW_DAYS,
  SET_FALLBACK_LONG_WINDOW_POINTS,
  SET_FALLBACK_SHORT_WINDOW_POINTS,
  cagrPercent,
  dateKeyUtcMs,
  daysSinceUtcMs,
  getCagrPercent,
  getMaxDrawdownPercent,
  getReturnPercent,
  getVolatilityPercent,
  maxDrawdownPercent,
  percentChange,
  perDay,
  releaseDateUtcMs,
  toDailyPoints,
  volatilityPercent,
  type HistoryRow,
} from "../marketMath";

function makeHistory(
  entries: Array<{ recordedAt: string; usdPrice: number }>
): HistoryRow[] {
  return entries.map((entry) => ({
    recorded_at: entry.recordedAt,
    usd_price: entry.usdPrice,
  }));
}

describe("getReturnPercent", () => {
  it("uses the newest point as current price for ascending history", () => {
    const history = makeHistory([
      { recordedAt: "2026-02-01T00:00:00Z", usdPrice: 100 },
      { recordedAt: "2026-02-03T00:00:00Z", usdPrice: 110 },
      { recordedAt: "2026-02-08T00:00:00Z", usdPrice: 130 },
      { recordedAt: "2026-02-10T00:00:00Z", usdPrice: 140 },
    ]);

    expect(
      getReturnPercent(history, 7, new Date("2026-02-10T12:00:00Z"))
    ).toBeCloseTo(27.2727, 3);
  });

  it("returns null when latest data is older than the requested window", () => {
    const history = makeHistory([
      { recordedAt: "2026-02-01T00:00:00Z", usdPrice: 100 },
      { recordedAt: "2026-02-10T00:00:00Z", usdPrice: 140 },
    ]);

    expect(getReturnPercent(history, 7, new Date("2026-02-20T00:00:00Z"))).toBeNull();
  });

  it("returns null when there is not enough history", () => {
    const history = makeHistory([{ recordedAt: "2026-02-10T00:00:00Z", usdPrice: 140 }]);
    expect(getReturnPercent(history, 7, new Date("2026-02-10T12:00:00Z"))).toBeNull();
  });

  it("returns null when the past price is 0", () => {
    const history = makeHistory([
      { recordedAt: "2026-02-01T00:00:00Z", usdPrice: 0 },
      { recordedAt: "2026-02-10T00:00:00Z", usdPrice: 140 },
    ]);
    expect(getReturnPercent(history, 7, new Date("2026-02-10T12:00:00Z"))).toBeNull();
  });
});

describe("offset-less recorded_at is UTC (F122)", () => {
  it("gives the same return for Z and offset-less spellings", () => {
    const ref = new Date("2026-02-10T12:00:00Z");
    const rows = [
      ["2026-02-01T00:00:00", 100],
      ["2026-02-03T00:00:00", 110],
      ["2026-02-08T00:00:00", 130],
      ["2026-02-10T00:00:00", 140],
    ] as const;
    const withZ = makeHistory(rows.map(([r, p]) => ({ recordedAt: `${r}Z`, usdPrice: p })));
    const bare = makeHistory(rows.map(([r, p]) => ({ recordedAt: r, usdPrice: p })));
    const spaced = makeHistory(
      rows.map(([r, p]) => ({ recordedAt: r.replace("T", " "), usdPrice: p }))
    );
    const expected = getReturnPercent(withZ, 7, ref);
    expect(expected).toBeCloseTo(27.2727, 3);
    expect(getReturnPercent(bare, 7, ref)).toBeCloseTo(expected!, 10);
    expect(getReturnPercent(spaced, 7, ref)).toBeCloseTo(expected!, 10);
  });

  it("picks the UTC row at the window edge in every zone", () => {
    const history = makeHistory([
      { recordedAt: "2026-02-01T01:00:00", usdPrice: 100 },
      { recordedAt: "2026-02-03T01:00:00", usdPrice: 110 },
      { recordedAt: "2026-02-10T01:00:00", usdPrice: 132 },
    ]);
    expect(
      getReturnPercent(history, 7, new Date("2026-02-10T02:00:00Z"))
    ).toBeCloseTo(20, 10);
  });

  it("anchors on the UTC calendar day like the RPC, not on now minus 7x24h", () => {
    // 02:00 UTC, before the day's 04:00 UTC scrape. The RPC's anchor is the
    // newest row with day <= 2026-02-03, i.e. the 02-03 04:00 row: (132-110)/110.
    // An instant comparison (now - 7 days = 02-03T02:00Z) rejected that row and
    // used the 02-02 row instead (32%), disagreeing with the server.
    const history = makeHistory([
      { recordedAt: "2026-02-02T04:00:00", usdPrice: 100 },
      { recordedAt: "2026-02-03T04:00:00", usdPrice: 110 },
      { recordedAt: "2026-02-10T01:00:00", usdPrice: 132 },
    ]);
    expect(
      getReturnPercent(history, 7, new Date("2026-02-10T02:00:00Z"))
    ).toBeCloseTo(20, 10);
  });

  it("finds no 7D anchor the RPC does not have (east-of-UTC regression)", () => {
    // Seven daily rows at 04:00 UTC, 2026-09-24 .. 2026-09-30, evaluated at
    // 2026-09-30T20:00Z. Target day 2026-09-23: no row on or before it, so the
    // RPC and this function both give null.
    const history = makeHistory(
      ["24", "25", "26", "27", "28", "29", "30"].map((d, i) => ({
        recordedAt: `2026-09-${d}T04:00:00`,
        usdPrice: 100 + i,
      }))
    );
    expect(
      getReturnPercent(history, 7, new Date("2026-09-30T20:00:00Z"))
    ).toBeNull();
  });

  it("CAGR is the same for Z and offset-less spellings", () => {
    const a = makeHistory([
      { recordedAt: "2025-02-10T04:00:00Z", usdPrice: 100 },
      { recordedAt: "2026-02-10T04:00:00Z", usdPrice: 121 },
    ]);
    const b = makeHistory([
      { recordedAt: "2025-02-10 04:00:00", usdPrice: 100 },
      { recordedAt: "2026-02-10T04:00:00", usdPrice: 121 },
    ]);
    expect(getCagrPercent(b)).toBeCloseTo(getCagrPercent(a)!, 10);
  });
});

describe("CAGR", () => {
  it("is 21% for +21% over exactly 365 days", () => {
    const history = makeHistory([
      { recordedAt: "2025-02-10T00:00:00", usdPrice: 100 },
      { recordedAt: "2026-02-10T00:00:00", usdPrice: 121 },
    ]);
    expect(getCagrPercent(history)).toBeCloseTo(21, 10);
  });

  it("is null for a non-positive price or a non-positive span", () => {
    expect(cagrPercent(0, 10, 0, 1000)).toBeNull();
    expect(cagrPercent(10, 0, 0, 1000)).toBeNull();
    expect(cagrPercent(10, 20, 1000, 1000)).toBeNull();
    expect(cagrPercent(10, 20, null, 1000)).toBeNull();
  });
});

describe("percentChange and perDay", () => {
  it("percentChange is null from a non-positive base", () => {
    expect(percentChange(100, 90)).toBeCloseTo(-10, 10);
    expect(percentChange(0, 90)).toBeNull();
  });

  it("perDay needs a positive day count", () => {
    expect(perDay(100, 4)).toBe(25);
    expect(perDay(100, 0)).toBeNull();
    expect(perDay(null, 4)).toBeNull();
    expect(perDay(100, null)).toBeNull();
  });
});

describe("toDailyPoints", () => {
  it("keeps the first reading of each UTC day, oldest first", () => {
    const history = makeHistory([
      { recordedAt: "2026-03-01T01:00:00", usdPrice: 10 },
      { recordedAt: "2026-03-01T20:00:00", usdPrice: 11 },
      { recordedAt: "2026-03-02 05:00:00", usdPrice: 12 },
      { recordedAt: "not a date", usdPrice: 99 },
    ]);
    expect(toDailyPoints(history)).toEqual([
      { dateKey: "2026-03-01", price: 10 },
      { dateKey: "2026-03-02", price: 12 },
    ]);
  });

  it("keeps only the newest maxPoints days", () => {
    const history = makeHistory(
      [1, 2, 3, 4].map((day) => ({ recordedAt: `2026-03-0${day}T00:00:00`, usdPrice: day }))
    );
    expect(toDailyPoints(history, 2).map((p) => p.price)).toEqual([3, 4]);
  });
});

describe("max drawdown", () => {
  it("is the largest fall from a running peak, as a positive percent", () => {
    expect(maxDrawdownPercent([100, 120, 90, 110, 60, 130])).toBeCloseTo(50, 10);
  });

  it("is 0 for a series that never fell and null below 2 points", () => {
    expect(maxDrawdownPercent([1, 2, 3])).toBe(0);
    expect(maxDrawdownPercent([5])).toBeNull();
  });

  it("skips a zero peak instead of dividing by it", () => {
    expect(maxDrawdownPercent([0, 0, 10, 5])).toBeCloseTo(50, 10);
  });

  it("works on daily points from history", () => {
    const history = makeHistory([
      { recordedAt: "2026-03-01T00:00:00", usdPrice: 100 },
      { recordedAt: "2026-03-02T00:00:00", usdPrice: 80 },
      { recordedAt: "2026-03-03T00:00:00", usdPrice: 120 },
    ]);
    expect(getMaxDrawdownPercent(history)).toBeCloseTo(20, 10);
  });
});

describe("volatility", () => {
  // Changes +10%, -10%, +10%: mean 10/3, population variance 800/9.
  const prices = [100, 110, 99, 108.9];
  const daily = Math.sqrt(800 / 9);

  it("daily is the population std-dev of daily % changes (the /stats and SQL unit)", () => {
    expect(volatilityPercent(prices, "daily")).toBeCloseTo(daily, 10);
  });

  it("annualised is daily times sqrt(365) (the /market and product page unit)", () => {
    expect(volatilityPercent(prices, "annualised")).toBeCloseTo(daily * Math.sqrt(365), 8);
  });

  it("needs 3 prices and 2 usable changes", () => {
    expect(volatilityPercent([100, 110], "daily")).toBeNull();
    expect(volatilityPercent([0, 0, 100], "daily")).toBeNull();
  });

  it("uses only the newest lookbackPoints daily prices", () => {
    const history = makeHistory(
      [500, 1, 100, 110, 99, 108.9].map((usdPrice, index) => ({
        recordedAt: `2026-03-0${index + 1}T00:00:00`,
        usdPrice,
      }))
    );
    expect(
      getVolatilityPercent(history, { lookbackPoints: 4, unit: "daily" })
    ).toBeCloseTo(daily, 10);
  });
});

describe("dates", () => {
  it("parses a release date key without the runtime zone", () => {
    expect(releaseDateUtcMs("2026-03-27")).toBe(Date.UTC(2026, 2, 27));
    expect(releaseDateUtcMs("2026-03-27T00:00:00")).toBe(Date.UTC(2026, 2, 27));
    expect(releaseDateUtcMs("2026-03-27 10:00:00")).toBe(Date.UTC(2026, 2, 27));
    expect(releaseDateUtcMs("27/03/2026")).toBeNull();
    expect(releaseDateUtcMs(null)).toBeNull();
    expect(dateKeyUtcMs("2026-13-01")).toBeNull();
  });

  it("counts whole UTC days since a start, never negative", () => {
    const today = Date.UTC(2026, 2, 30);
    expect(daysSinceUtcMs(Date.UTC(2026, 2, 27), today)).toBe(3);
    expect(daysSinceUtcMs(Date.UTC(2026, 3, 2), today)).toBe(0);
    expect(daysSinceUtcMs(null, today)).toBeNull();
  });
});

// /methodology and metricDefinitions.ts (WP24) print these. A change here is
// a change to numbers on the site and needs a methodology version bump.
describe("exported windows and factors", () => {
  it("hold the numbers the site has always used", () => {
    expect(DAYS_PER_YEAR).toBe(365);
    expect(ANNUALISATION_FACTOR).toBe(Math.sqrt(365));
    expect(PRODUCT_VOLATILITY_LOOKBACK_POINTS).toBe(30);
    expect(SET_FALLBACK_SHORT_WINDOW_POINTS).toBe(90);
    expect(SET_FALLBACK_LONG_WINDOW_POINTS).toBe(365);
    expect(RETURN_WINDOW_DAYS).toEqual({ "1D": 1, "7D": 7, "1M": 30, "3M": 90, "6M": 180, "1Y": 365 });
  });

  it("annualised volatility is daily volatility times ANNUALISATION_FACTOR", () => {
    const prices = [100, 110, 99, 108.9];
    expect(volatilityPercent(prices, "annualised")).toBeCloseTo(
      volatilityPercent(prices, "daily")! * ANNUALISATION_FACTOR,
      10
    );
  });

  it("the set fallback windows equal the SQL windows they stand in for", () => {
    // From frontend/app/lib/__tests__ up four levels is the repo root.
    const sql = readFileSync(
      join(__dirname, "../../../../migrations/20260506_market_performance_functions.sql"),
      "utf8"
    );
    const windowOf = (cte: string): number => {
      const match = new RegExp(`${cte} AS \\([\\s\\S]*?current_date - (\\d+)`).exec(sql);
      expect(match).not.toBeNull();
      return Number(match![1]);
    };
    expect(windowOf("changes_90")).toBe(SET_FALLBACK_SHORT_WINDOW_POINTS);
    expect(windowOf("trend_90_source")).toBe(SET_FALLBACK_SHORT_WINDOW_POINTS);
    expect(windowOf("drawdown_365_source")).toBe(SET_FALLBACK_LONG_WINDOW_POINTS);
    expect(windowOf("trend_365_source")).toBe(SET_FALLBACK_LONG_WINDOW_POINTS);
  });
});
```

The SQL test reads the migration that defines `get_market_product_metrics` today. If a later migration redefines that function with other windows, point the test at that file (`grep -ln "changes_90" ../migrations/*.sql`, take the newest) and change the constants with a methodology version bump; never edit the old migration.

### 2. `app/lib/__tests__/csv.test.ts` (new)

```ts
import { parseCsv } from "../csv";

describe("parseCsv (RFC 4180)", () => {
  it("returns no rows for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("splits plain rows and fields", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("does not add a row for a trailing newline", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("treats CRLF like LF", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a comma inside quotes in one field", () => {
    expect(parseCsv('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
  });

  it('unescapes "" inside a quoted field', () => {
    expect(parseCsv('"He said ""mint"", really",x')).toEqual([
      ['He said "mint", really', "x"],
    ]);
  });

  it("keeps a newline inside quotes in one field and one row", () => {
    expect(parseCsv('a,"line1\nline2",c\nd,e,f')).toEqual([
      ["a", "line1\nline2", "c"],
      ["d", "e", "f"],
    ]);
  });

  it("turns CRLF inside a quoted field into LF", () => {
    expect(parseCsv('"line1\r\nline2"')).toEqual([["line1\nline2"]]);
  });

  it("keeps a quote in the middle of an unquoted field literally", () => {
    // A bare inch mark in a note must not swallow the rest of the file.
    expect(parseCsv('12" display,x\nnext,row')).toEqual([
      ['12" display', "x"],
      ["next", "row"],
    ]);
  });

  it("keeps trailing empty fields", () => {
    expect(parseCsv("a,b,\n1,2,")).toEqual([
      ["a", "b", ""],
      ["1", "2", ""],
    ]);
  });

  it("strips a UTF-8 byte order mark", () => {
    // Write the BOM as the \uFEFF escape, never as a pasted invisible character.
    expect(parseCsv("\uFEFFHandle,Title\nh,t")[0]).toEqual(["Handle", "Title"]);
  });

  it("returns a blank line as a one-field row (callers filter it)", () => {
    expect(parseCsv("a\n\nb")).toEqual([["a"], [""], ["b"]]);
  });
});
```

### 3. `app/lib/__tests__/import.test.ts` (update)

Keep every existing case unchanged (in particular `:31`, the trimmed product name, and the `matchProduct` cases WP17 appended). Add `CSV_MAX_ROWS` to the existing value import from `"../import"`; do not drop any name already there. After WP17 that line reads `import { matchProduct, parseCollectrCSV, calculateImportSummary } from "../import";`, so it becomes `import { matchProduct, parseCollectrCSV, calculateImportSummary, CSV_MAX_ROWS } from "../import";`. Keep the `jest.mock` lines at the top as they are. Append:

```ts
describe("parseCollectrCSV with RFC 4180 quoting (F003)", () => {
  const HEADER =
    "Portfolio Name,Category,Set,Product Name,Card Number,Rarity,Variance,Grade,Card Condition,Average Cost Paid,Quantity,Market Price,Price Override,Watchlist,Date Added,Notes";
  const row = (productName: string, notes: string) =>
    `Sealed Product,Pokemon,Surging Sparks,${productName},,,Normal,Ungraded,Near Mint,200,2,250,0,false,2025-06-08,${notes}`;

  it("keeps a multi-line quoted note in one row and does not lose the next row", () => {
    const csv = [
      HEADER,
      row("Surging Sparks Booster Box", '"Bought at the shop.\nSecond line"'),
      row("Surging Sparks Elite Trainer Box", ""),
    ].join("\n");
    const rows = parseCollectrCSV(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].notes).toBe("Bought at the shop.\nSecond line");
    expect(rows[0].averageCostPaid).toBe(200);
    expect(rows[0].quantity).toBe(2);
    expect(rows[1].productName).toBe("Surging Sparks Elite Trainer Box");
  });

  it('keeps quote characters written as ""', () => {
    const csv = [HEADER, row("Surging Sparks Booster Box", '"He said ""mint"", really"')].join("\n");
    expect(parseCollectrCSV(csv)[0].notes).toBe('He said "mint", really');
  });

  it("keeps a literal quote in an unquoted note", () => {
    const csv = [HEADER, row("Surging Sparks Booster Box", '12" shelf'), row("Surging Sparks Booster Bundle", "")].join("\n");
    const rows = parseCollectrCSV(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].notes).toBe('12" shelf');
  });

  it("reads CRLF files and still trims padded fields", () => {
    const csv = [HEADER, row("Surging Sparks Booster Box ", " padded ")].join("\r\n") + "\r\n";
    const rows = parseCollectrCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].productName).toBe("Surging Sparks Booster Box");
    expect(rows[0].portfolioName).toBe("Sealed Product");
    expect(rows[0].notes).toBe("padded");
  });

  it("keeps a quoted comma inside the set name", () => {
    const csv = [
      HEADER,
      'Sealed Product,Pokemon,"Scarlet & Violet, 151",151 Booster Bundle,,,Normal,Ungraded,Near Mint,60,3,70,0,false,2025-06-09,',
    ].join("\n");
    const [parsed] = parseCollectrCSV(csv);
    expect(parsed.set).toBe("Scarlet & Violet, 151");
    expect(parsed.quantity).toBe(3);
  });

  it("skips blank lines", () => {
    const csv = [HEADER, "", row("Surging Sparks Booster Box", ""), "   ", ""].join("\n");
    expect(parseCollectrCSV(csv)).toHaveLength(1);
  });

  it("caps at CSV_MAX_ROWS records and counts a multi-line record once", () => {
    const lines = [HEADER, row("Box 0", '"first\nsecond"')];
    for (let i = 1; i <= CSV_MAX_ROWS; i += 1) lines.push(row(`Box ${i}`, ""));
    const rows = parseCollectrCSV(lines.join("\n"));
    expect(rows).toHaveLength(CSV_MAX_ROWS);
    expect(rows[CSV_MAX_ROWS - 1].productName).toBe(`Box ${CSV_MAX_ROWS - 1}`);
  });
});
```

The expected values were checked by running the new parse path on these exact strings.

### 4. `app/components/MarketView/__tests__/sorting.test.ts` (update)

Append:

```ts
describe("compareSortValues with a string comparator", () => {
  const baseInsensitive = new Intl.Collator("en", { sensitivity: "base" }).compare;

  it("uses the supplied comparator for strings", () => {
    expect(compareSortValues("alpha", "Alpha", "asc", baseInsensitive)).toBe(0);
    expect(compareSortValues("alpha", "Beta", "asc", baseInsensitive)).toBeLessThan(0);
    expect(compareSortValues("alpha", "Beta", "desc", baseInsensitive)).toBeGreaterThan(0);
  });

  it("still sinks missing values whatever the comparator", () => {
    expect(compareSortValues(null, "Beta", "asc", baseInsensitive)).toBe(1);
    expect(compareSortValues("Beta", null, "desc", baseInsensitive)).toBe(-1);
  });
});
```

### 5. `app/compare/__tests__/compareMath.test.ts` (new)

```ts
import {
  buildComparisonRows,
  calculateMargin,
  calculateProfit,
  filterComparisonRows,
  getPriceStatus,
  summarizeComparison,
  type ComparisonRow,
} from "../compareMath";
import type { MarketProduct } from "../marketProducts";
import type { ShopifyProduct } from "../shopifyCsv";

const TODAY = Date.UTC(2026, 8, 28);

function shopify(sku: string, price: number | null, cost: number | null, title = sku): ShopifyProduct {
  return { sku, title, shopifyPrice: price, shopifyCost: cost };
}

function market(sku: string, usd: number | null, releaseDate: string | null = null): MarketProduct {
  return { sku, marketPriceUsd: usd, releaseDate };
}

describe("calculateProfit / calculateMargin", () => {
  it("profit is price minus cost, null when either is missing", () => {
    expect(calculateProfit(150, 100)).toBe(50);
    expect(calculateProfit(null, 100)).toBeNull();
    expect(calculateProfit(150, null)).toBeNull();
  });

  it("margin is profit over price as a percent, null at price 0", () => {
    expect(calculateMargin(200, 150)).toBe(25);
    expect(calculateMargin(100, 150)).toBe(-50);
    expect(calculateMargin(0, 10)).toBeNull();
    expect(calculateMargin(100, null)).toBeNull();
  });
});

describe("buildComparisonRows", () => {
  it("joins on sku, converts the market price to CAD and derives every figure", () => {
    const rows = buildComparisonRows(
      { A: shopify("A", 150, 100) },
      { A: market("A", 100, "2026-09-18") },
      1.4,
      TODAY
    );
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.marketPriceCad).toBeCloseTo(140, 10);
    expect(row.difference).toBeCloseTo(10, 10);
    expect(row.differencePct).toBeCloseTo((10 / 140) * 100, 10);
    expect(row.shopifyProfit).toBe(50);
    expect(row.shopifyMargin).toBeCloseTo((50 / 150) * 100, 10);
    expect(row.marketProfit).toBeCloseTo(40, 10);
    expect(row.marketMargin).toBeCloseTo((40 / 140) * 100, 10);
    // 10 whole UTC days since 2026-09-18.
    expect(row.marketProfitPerDay).toBeCloseTo(4, 10);
    expect(row.releaseDateMs).toBe(Date.UTC(2026, 8, 18));
  });

  it("skips skus missing from the market and market items without a price", () => {
    const rows = buildComparisonRows(
      { A: shopify("A", 10, 5), B: shopify("B", 10, 5) },
      { B: market("B", null) },
      1.4,
      TODAY
    );
    expect(rows).toEqual([]);
  });

  it("keeps the CSV order", () => {
    const rows = buildComparisonRows(
      { Z: shopify("Z", 10, 5), A: shopify("A", 10, 5) },
      { A: market("A", 5), Z: market("Z", 5) },
      1.4,
      TODAY
    );
    expect(rows.map((row) => row.sku)).toEqual(["Z", "A"]);
  });

  it("has no profit per day without a release date or on release day", () => {
    const rows = buildComparisonRows(
      { A: shopify("A", 150, 100), B: shopify("B", 150, 100) },
      { A: market("A", 100, null), B: market("B", 100, "2026-09-28") },
      1.4,
      TODAY
    );
    expect(rows.map((row) => row.marketProfitPerDay)).toEqual([null, null]);
  });

  it("leaves cost-derived figures null when the cost is missing", () => {
    const [row] = buildComparisonRows(
      { A: shopify("A", 150, null) },
      { A: market("A", 100, "2026-01-01") },
      1.4,
      TODAY
    );
    expect(row.shopifyProfit).toBeNull();
    expect(row.shopifyMargin).toBeNull();
    expect(row.marketProfit).toBeNull();
    expect(row.marketProfitPerDay).toBeNull();
    expect(row.marketMargin).toBeNull();
    expect(row.difference).toBeCloseTo(10, 10);
  });

  it("has no difference % when the market price is 0", () => {
    const [row] = buildComparisonRows({ A: shopify("A", 10, 5) }, { A: market("A", 0) }, 1.4, TODAY);
    expect(row.difference).toBe(10);
    expect(row.differencePct).toBeNull();
  });
});

describe("getPriceStatus", () => {
  it("is inclusive at the threshold", () => {
    expect(getPriceStatus(-5, 5)).toBe("OK");
    expect(getPriceStatus(5, 5)).toBe("OK");
    expect(getPriceStatus(-5.01, 5)).toBe("Below");
    expect(getPriceStatus(5.01, 5)).toBe("Above");
    expect(getPriceStatus(null, 5)).toBe("N/A");
  });
});

describe("summarizeComparison", () => {
  it("counts buckets and missing costs (missing cost counts even without a status)", () => {
    const base = buildComparisonRows(
      {
        below: shopify("below", 80, 50),
        above: shopify("above", 120, 50),
        ok: shopify("ok", 101, null),
      },
      { below: market("below", 100), above: market("above", 100), ok: market("ok", 100) },
      1,
      TODAY
    );
    const noStatus: ComparisonRow = { ...base[0], sku: "none", differencePct: null, shopifyCost: null };
    expect(summarizeComparison([...base, noStatus], 5)).toEqual({
      total: 4,
      below: 1,
      above: 1,
      ok: 1,
      missingCost: 2,
    });
  });
});

describe("filterComparisonRows", () => {
  const rows = buildComparisonRows(
    { "SV-151-BB": shopify("SV-151-BB", 10, 5, "151 Booster Bundle"), "PE-ETB": shopify("PE-ETB", 10, 5, "Prismatic ETB") },
    { "SV-151-BB": market("SV-151-BB", 5), "PE-ETB": market("PE-ETB", 5) },
    1,
    TODAY
  );

  it("matches sku or title, case-insensitive, trimmed", () => {
    expect(filterComparisonRows(rows, "  prismatic ").map((r) => r.sku)).toEqual(["PE-ETB"]);
    expect(filterComparisonRows(rows, "sv-151").map((r) => r.sku)).toEqual(["SV-151-BB"]);
  });

  it("returns the same array for a blank term", () => {
    expect(filterComparisonRows(rows, "   ")).toBe(rows);
  });
});
```

### 6. `app/compare/__tests__/shopifyCsv.test.ts` (new)

```ts
import { parseShopifyCsv } from "../shopifyCsv";

const HEADER = "Handle,Title,Variant SKU,Variant Price,Cost per item";

describe("parseShopifyCsv", () => {
  it("reports an empty file", () => {
    expect(parseShopifyCsv("")).toEqual({ products: {}, error: "CSV file is empty." });
  });

  it("requires Variant SKU and Variant Price", () => {
    const result = parseShopifyCsv("Handle,Title\nh,t");
    expect(result.products).toEqual({});
    expect(result.error).toMatch(/Variant SKU and Variant Price/);
  });

  it("parses rows, keeps quoted commas in titles and falls back to the sku for a missing title", () => {
    const csv = `${HEADER}\r\nbox,"Scarlet & Violet, 151 Booster Bundle",SV151-BB,59.99,41.50\r\netb,,PE-ETB,89.99,\r\n`;
    const { products, error } = parseShopifyCsv(csv);
    expect(error).toBeUndefined();
    expect(products["SV151-BB"]).toEqual({
      sku: "SV151-BB",
      title: "Scarlet & Violet, 151 Booster Bundle",
      handle: "box",
      shopifyPrice: 59.99,
      shopifyCost: 41.5,
    });
    expect(products["PE-ETB"]).toMatchObject({ title: "PE-ETB", shopifyCost: null });
  });

  it("skips rows without a sku or a numeric price; a repeated sku keeps the last row", () => {
    const csv = `${HEADER}\na,A,,10,5\nb,B,SKU-1,abc,5\nc,C,SKU-2,10,5\nd,D,SKU-2,12,5`;
    const { products } = parseShopifyCsv(csv);
    expect(Object.keys(products)).toEqual(["SKU-2"]);
    expect(products["SKU-2"].shopifyPrice).toBe(12);
  });

  it("reads headers with a byte order mark and padding", () => {
    // \uFEFF is the byte order mark; keep it as an escape in the source.
    const { products } = parseShopifyCsv("\uFEFF Handle , Variant SKU , Variant Price \nh, S1 , 5 ");
    expect(products.S1?.shopifyPrice).toBe(5);
  });
});
```

### 7. `app/components/SortableTable/__tests__/SortableTable.test.tsx` (new)

```tsx
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import SortableTable, { type SortState, type SortableColumn } from "../SortableTable";

type Row = { id: string; name: string; value: number | null };
type Key = "name" | "value";

const COLUMNS: SortableColumn<Row, Key>[] = [
  { id: "name", label: "Name", sortKey: "name", cellClassName: "name-cell", cell: (row) => row.name },
  {
    id: "value",
    label: "Value",
    sortKey: "value",
    align: "right",
    widthClassName: "w-24",
    cellClassName: "value-cell",
    cell: (row) => (row.value === null ? "none" : String(row.value)),
  },
  { id: "note", label: "Note", cellClassName: "note-cell", cell: () => "n" },
];

const ROWS: Row[] = [
  { id: "1", name: "beta", value: 2 },
  { id: "2", name: "Alpha", value: null },
  { id: "3", name: "alpha", value: 3 },
  { id: "4", name: "Gamma", value: 1 },
];

const sortValue = (row: Row, key: Key) => row[key];
const rowKey = (row: Row) => row.id;
const baseInsensitive = new Intl.Collator("en", { sensitivity: "base" }).compare;

function Harness({ initial, rows = ROWS }: { initial: SortState<Key>; rows?: Row[] }) {
  const [sort, setSort] = useState(initial);
  return (
    <SortableTable
      caption="Test table"
      rows={rows}
      columns={COLUMNS}
      sort={sort}
      onSortChange={setSort}
      sortValue={sortValue}
      rowKey={rowKey}
      compareStrings={baseInsensitive}
      emptyMessage="Nothing here."
    />
  );
}

function columnText(className: string) {
  return Array.from(document.querySelectorAll(`td.${className}`)).map((td) => td.textContent);
}

describe("SortableTable", () => {
  it("sorts by the initial state with missing values last", () => {
    render(<Harness initial={{ key: "value", direction: "asc" }} />);
    expect(columnText("value-cell")).toEqual(["1", "2", "3", "none"]);
  });

  it("keeps missing values last when descending", () => {
    render(<Harness initial={{ key: "value", direction: "desc" }} />);
    expect(columnText("value-cell")).toEqual(["3", "2", "1", "none"]);
  });

  it("flips the active column and starts a new column ascending", () => {
    render(<Harness initial={{ key: "value", direction: "asc" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Value/ }));
    expect(columnText("value-cell")).toEqual(["3", "2", "1", "none"]);
    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    // Case-insensitive, stable: "Alpha" and "alpha" tie and keep input order.
    expect(columnText("name-cell")).toEqual(["Alpha", "alpha", "beta", "Gamma"]);
  });

  it("marks the sorted column with aria-sort and renders unsortable headers as text", () => {
    render(<Harness initial={{ key: "name", direction: "desc" }} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]).toHaveAttribute("aria-sort", "descending");
    expect(headers[1]).not.toHaveAttribute("aria-sort");
    expect(within(headers[2]).queryByRole("button")).toBeNull();
    expect(headers[2]).toHaveTextContent("Note");
  });

  it("is table-fixed with one <col> per column", () => {
    const { container } = render(<Harness initial={{ key: "name", direction: "asc" }} />);
    expect(container.querySelector("table")).toHaveClass("table-fixed");
    expect(container.querySelectorAll("colgroup col")).toHaveLength(3);
  });

  it("shows the empty message across every column", () => {
    render(<Harness initial={{ key: "name", direction: "asc" }} rows={[]} />);
    const cell = screen.getByText("Nothing here.");
    expect(cell).toHaveAttribute("colspan", "3");
  });

  it("does not re-render rows that survive a narrower filter (F074)", () => {
    const cell = jest.fn((row: Row) => row.name);
    const columns: SortableColumn<Row, Key>[] = [
      { id: "name", label: "Name", sortKey: "name", cellClassName: "name-cell", cell },
    ];
    const renderTable = (rows: Row[]) => (
      <SortableTable
        caption="Memo table"
        rows={rows}
        columns={columns}
        sort={{ key: "name", direction: "asc" }}
        onSortChange={() => {}}
        sortValue={sortValue}
        rowKey={rowKey}
        emptyMessage="Nothing here."
      />
    );
    const { rerender } = render(renderTable(ROWS));
    expect(cell).toHaveBeenCalledTimes(ROWS.length);
    cell.mockClear();

    // Same row objects, fewer of them: what filterComparisonRows produces.
    rerender(renderTable(ROWS.filter((row) => row.id !== "4")));
    expect(cell).not.toHaveBeenCalled();
    expect(columnText("name-cell")).toEqual(["Alpha", "alpha", "beta"]);
  });
});
```

### 8. `app/compare/__tests__/CompareDashboard.tables.test.tsx` (new)

WP11's `CompareDashboard.test.tsx` (fetch gating, rate text) must pass unchanged next to it.

```tsx
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CompareDashboard from "../CompareDashboard";
import type { MarketProduct } from "../marketProducts";

// The server supplies both, so the browser fetchers must not run. Mocked so
// the Supabase client is never constructed under jsdom.
jest.mock("../../lib/exchangeRate", () => ({
  fetchLatestExchangeRateClient: jest.fn(),
}));
jest.mock("../../lib/clientMarketData", () => ({
  fetchMarketProductsClient: jest.fn(),
}));

const MARKET: Record<string, MarketProduct> = {
  "SKU-A": { sku: "SKU-A", marketPriceUsd: 100, releaseDate: "2026-01-01" },
  "SKU-B": { sku: "SKU-B", marketPriceUsd: 50, releaseDate: "2026-02-01" },
};

const CSV = [
  "Handle,Title,Variant SKU,Variant Price,Cost per item",
  'a,"Alpha Box, sealed",SKU-A,160,120',
  "b,Beta Bundle,SKU-B,60,",
  "c,Not in catalog,SKU-Z,10,5",
].join("\n");

async function renderWithUpload() {
  const utils = render(
    <CompareDashboard
      initialMarketProducts={MARKET}
      initialExchangeRate={{ rate: 1.5, date: "2026-09-25T00:00:00" }}
    />
  );
  const input = utils.container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([CSV], "products_export.csv", { type: "text/csv" });
  // jsdom's File may lack text(); the component awaits it.
  Object.defineProperty(file, "text", { value: () => Promise.resolve(CSV) });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  await screen.findByText("SKU-A");
  return utils;
}

describe("CompareDashboard tables", () => {
  it("renders exactly one table, the price comparison, after an upload", async () => {
    await renderWithUpload();
    expect(screen.getAllByRole("table")).toHaveLength(1);
    const table = screen.getByRole("table", { name: /compared with market prices/i });
    // SKU-Z is not in the market catalog.
    expect(within(table).queryByText("SKU-Z")).toBeNull();
    // Market CAD = 100 * 1.5.
    expect(within(table).getByText("C$150.00")).toBeInTheDocument();
  });

  it("switches tables with the tabs and the arrow keys", async () => {
    await renderWithUpload();
    fireEvent.click(screen.getByRole("tab", { name: "Shopify margin" }));
    expect(screen.getByRole("table", { name: /Shopify margin/i })).toBeInTheDocument();
    expect(screen.getAllByRole("table")).toHaveLength(1);

    const selected = screen.getByRole("tab", { name: "Shopify margin" });
    expect(selected).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(selected, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Market margin" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("table", { name: /Market margin/i })).toBeInTheDocument();
  });

  it("keeps each table's sort when switching tabs", async () => {
    await renderWithUpload();
    fireEvent.click(screen.getByRole("button", { name: "SKU" }));
    fireEvent.click(screen.getByRole("tab", { name: "Market margin" }));
    fireEvent.click(screen.getByRole("tab", { name: "Price comparison" }));
    const header = screen.getAllByRole("columnheader")[0];
    expect(header).toHaveAttribute("aria-sort", "ascending");
  });

  it("filters rows from the search box", async () => {
    await renderWithUpload();
    fireEvent.change(screen.getByRole("textbox", { name: /search/i }), {
      target: { value: "beta" },
    });
    await waitFor(() => expect(screen.queryByText("SKU-A")).toBeNull());
    expect(screen.getByText("SKU-B")).toBeInTheDocument();
  });

  it("counts every matched row in the summary tiles, not only the filtered ones", async () => {
    await renderWithUpload();
    const matched = screen.getByText("Matched").parentElement as HTMLElement;
    expect(within(matched).getByText("2")).toBeInTheDocument();
  });
});
```

If WP14 did not give the search box an `aria-label`, its placeholder still provides the accessible name `/search/i` matches.

### 9. `app/components/__tests__/PriceChart.memo.test.tsx` (new)

```tsx
/**
 * PriceChart after WP18 (F073, F005): the currency toggle must not re-parse
 * the history, the investor chips must not change with the currency (they are
 * percentages of the charted series), and a CSS height class must replace the
 * JS height so phones do not render twice.
 */
jest.mock("recharts", () => {
  const Empty = () => null;
  const Container = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  );
  return {
    ResponsiveContainer: Container,
    ComposedChart: Empty,
    Area: Empty,
    Bar: Empty,
    Line: Empty,
    XAxis: Empty,
    YAxis: Empty,
    Tooltip: Empty,
    CartesianGrid: Empty,
    ReferenceLine: Empty,
  };
});

jest.mock("../../lib/format", () => {
  const actual = jest.requireActual("../../lib/format");
  return { ...actual, parseRecordedAt: jest.fn(actual.parseRecordedAt) };
});

import React from "react";
import { render, screen } from "@testing-library/react";
import PriceChart from "../PriceChart";
import { parseRecordedAt } from "../../lib/format";

function isoDaysAgo(days: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
  return `${d.toISOString().split("T")[0]}T09:00:00`;
}

// 1M window, no downsampling: 100 for ~10 days, 120 for ~8, then 90.
// ROI 100 -> 90 = -10%, max drawdown 120 -> 90 = 25%, in any zone.
const DATA = [
  { usd_price: 100, recorded_at: isoDaysAgo(20) },
  { usd_price: 120, recorded_at: isoDaysAgo(10) },
  { usd_price: 90, recorded_at: isoDaysAgo(2) },
];

describe("PriceChart memoisation and chips", () => {
  beforeEach(() => {
    (parseRecordedAt as jest.Mock).mockClear();
  });

  it("shows range ROI and drawdown of the charted series", () => {
    render(<PriceChart data={DATA} range="1M" />);
    expect(screen.getByText("ROI: -10.00%")).toBeInTheDocument();
    expect(screen.getByText("Max DD: -25.00%")).toBeInTheDocument();
  });

  it("does not re-parse the history or change the chips on a currency toggle", () => {
    const { rerender } = render(<PriceChart data={DATA} range="1M" currency="USD" />);
    const parsesAfterMount = (parseRecordedAt as jest.Mock).mock.calls.length;
    expect(parsesAfterMount).toBeGreaterThan(0);

    rerender(<PriceChart data={DATA} range="1M" currency="CAD" exchangeRate={1.5} />);

    expect((parseRecordedAt as jest.Mock).mock.calls.length).toBe(parsesAfterMount);
    expect(screen.getByText("ROI: -10.00%")).toBeInTheDocument();
    expect(screen.getByText("Max DD: -25.00%")).toBeInTheDocument();
  });

  it("uses the height class instead of an inline height when given", () => {
    render(
      <PriceChart
        data={[{ usd_price: 449.95, recorded_at: isoDaysAgo(95) }]}
        range="7D"
        heightClassName="h-[150px] md:h-[200px]"
      />
    );
    const box = screen.getByText("No prices recorded in this period");
    expect(box).toHaveClass("h-[150px]");
    expect(box.style.height).toBe("");
  });

  it("sizes only the plot wrapper, so the chip row does not eat the plot height", () => {
    render(<PriceChart data={DATA} range="1M" heightClassName="h-[150px] md:h-[200px]" />);
    const wrapper = screen.getByTestId("responsive-container").parentElement!;
    expect(wrapper).toHaveClass("h-[150px]");
    expect(wrapper.style.height).toBe("");
    expect(wrapper).not.toContainElement(screen.getByText("ROI: -10.00%"));
  });
});
```

The chip values were verified by server-rendering the new component with a stubbed Recharts: `ROI: -10.00%`, `CAGR: -85.38%`, `Max DD: -25.00%`, identical for USD and CAD at 1.5.

### 10. Existing suites that must pass unchanged

`app/components/MarketView/__tests__/buildRows.test.ts` (WP17; its `getReleaseMs` import resolves through the re-export), `app/components/__tests__/PriceChart.staleness.test.tsx`, `app/components/charts/__tests__/chartTooltips.test.tsx` (WP17), `app/lib/__tests__/serverMarketData.*.test.ts`, `app/compare/__tests__/CompareDashboard.test.tsx` and `marketProducts.test.ts` (WP11), WP07's `ProductCard.format.test.tsx`, WP09's ProductCard tests, and `app/__tests__/uiConventions.test.ts` (WP15: the new files use no `gray-*`, no raw `blue-400..700` and no `text-green-600`/`text-red-600`). Do not weaken any case.

## Verification

From `frontend/`:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit                                   # exit 0

pnpm exec eslint app/lib app/compare app/components/MarketView app/components/SortableTable \
  app/components/PriceChart.tsx app/components/ProductPrices/shared \
  app/components/ProductPrices/cards/ProductCard.tsx "app/product/[id]/page.tsx" app/stats/page.tsx
# expect: 0 errors (lint is blocking since WP17)

pnpm exec jest app/lib/__tests__/marketMath.test.ts app/lib/__tests__/csv.test.ts \
  app/lib/__tests__/import.test.ts app/lib/__tests__/serverMarketData app/compare \
  app/components/SortableTable app/components/MarketView app/components/__tests__ \
  app/components/charts app/components/ProductPrices
# expect: all pass

TZ=America/Vancouver pnpm exec jest app/lib/__tests__/marketMath.test.ts app/compare/__tests__/compareMath.test.ts app/components/__tests__/PriceChart.memo.test.tsx
TZ=Asia/Tokyo pnpm exec jest app/lib/__tests__/marketMath.test.ts app/compare/__tests__/compareMath.test.ts app/components/__tests__/PriceChart.memo.test.tsx
# expect: all pass in both zones

pnpm test --ci                                           # full suite, all pass
pnpm build:stub                                          # exit 0; /compare still listed as a static/ISR route

# Greps, each must print nothing:
grep -rn "function getReleaseMs\|function getReleaseUtcMs\|function getHistoricalReturn\|function buildDailySeries\|function getVolatility(\|function getMaxDrawdown(\|function parseCSVLine\|function compareValues" app --include=*.ts --include=*.tsx
grep -rn "MarketView/returns\|from \"./returns\"\|useResponsive" app --include=*.ts --include=*.tsx
grep -rn "convertPrice" app/lib/marketMath.ts app/components/ProductPrices/shared/ReturnMetrics.tsx
grep -n "toLocale\|CustomTooltip\|CustomDot\|}, \[data, currency, exchangeRate\]" app/components/PriceChart.tsx
grep -c "<table" app/compare/CompareDashboard.tsx | grep -v "^0$"

# One DAY_MS definition in the market-math files:
grep -rn "const DAY_MS = " app --include=*.ts --include=*.tsx | grep -v __tests__
# expect exactly two lines: app/lib/marketMath.ts and app/lib/portfolio.ts (WP05's copy;
# portfolio day arithmetic is out of scope, decision 12). Any other file is a missed copy.

# Track 2 constants exported; call-site literals left for WP19/WP24:
grep -c "^export const DAYS_PER_YEAR\|^export const ANNUALISATION_FACTOR\|^export const PRODUCT_VOLATILITY_LOOKBACK_POINTS\|^export const SET_FALLBACK_SHORT_WINDOW_POINTS\|^export const SET_FALLBACK_LONG_WINDOW_POINTS" app/lib/marketMath.ts
# expect 5
grep -n "lookbackPoints: 30" app/components/MarketView/buildRows.ts "app/product/[id]/page.tsx"
# expect 2 lines, one per file

# One CSV parser, two consumers:
grep -rn "parseCsv(" app --include=*.ts --include=*.tsx | grep -v __tests__
# expect: app/lib/csv.ts (definition), app/lib/import.ts, app/compare/shopifyCsv.ts

wc -l app/compare/CompareDashboard.tsx                   # expect under 400 (was 1000+)
```

From the repo root: `grep -n "marketMath.test.ts" .github/workflows/ci.yml` shows the two zone lines (if WP07 step 10 exists).

Manual checks (on the Vercel preview of the PR, which reads real data; the stub build has an empty catalog):

1. `/market`, click "Show all columns" (or the equivalent toggle): the header reads "Vol 30D (ann.)"; hovering it shows the annualised explanation; values have no "+" sign and are neutral grey, not green. Sort by it: ascending puts the calmest products first and "--" rows last. The numbers equal the production site's "Vol 30D" for the same product.
2. `/product/<any id>`: the tile reads "Volatility 30D (annualised)" with the note under the grid; CAGR, Max Drawdown and Volatility values equal production.
3. `/stats` (or `/analytics`): headers read "Volatility 90D (daily)"; the definition text mentions "daily, not annualised"; values equal production.
4. `/prices`: open a card's chart, note ROI, CAGR and Max DD on 1Y, toggle USD/CAD: the chips do not change and the axis switches between `$` and `C$`. Hover a chip: the "charted ... range" title appears. In Chrome DevTools device mode (iPhone 12), reload, open one chart, close it and open a second card's chart (the old 200 px then 150 px render happened only once the chart chunk was already loaded, so the first open does not show it): on the second open, inspect the element that wraps `.recharts-responsive-container`; it carries `h-[150px]` and its computed height is 150 px from the first frame (no 200 px render followed by a 150 px one). The plot is still 150 px tall below the chip row, not 150 px minus the chips. The chip row above the plot still appears when the chart mounts; that pre-existing shift is not in scope.
5. `/compare`: upload a real Shopify `products_export.csv`. Only one table is visible; the tabs "Price comparison", "Shopify margin", "Market margin" switch it; Left/Right arrow keys move between tabs when one is focused. Sort the comparison table by Title, switch tabs and back: the Title sort is kept. Type quickly in the search box: every character appears immediately and the table dims briefly while filtering. Summary tiles count all matched rows regardless of the search. On a 390 px wide viewport the table scrolls horizontally instead of squashing columns. Compare margin, profit and profit/day against production for three SKUs: identical.
6. `/portfolio` import (signed in): paste a Collectr CSV whose last column holds `"line one` newline `line two"` and a note with `""quoted""` text: the preview shows the full two-line note and the quotes; prices and quantities are the same as before.

## Owner actions

None. No migration, no environment variable, no dashboard change. The SQL behind `/stats` is unchanged.

## Acceptance criteria

- [ ] `app/lib/marketMath.ts` is the only implementation of N-day return, CAGR, max drawdown, volatility, daily bucketing and release-date parsing; `returns.ts`, `getHistoricalReturn`, `buildDailySeries`, `getVolatility`, `getMaxDrawdown` and every `getReleaseMs`/`getReleaseUtcMs` body are gone.
- [ ] No shared helper takes a currency conversion argument.
- [ ] `marketMath.ts` exports `DAYS_PER_YEAR`, `ANNUALISATION_FACTOR`, `PRODUCT_VOLATILITY_LOOKBACK_POINTS`, `SET_FALLBACK_SHORT_WINDOW_POINTS`, `SET_FALLBACK_LONG_WINDOW_POINTS` and `RETURN_WINDOW_DAYS`; `volatilityPercent`, `cagrPercent` and `fetchSetAnalyticsFallback` use them; `buildRows.ts` and the product page still write `lookbackPoints: 30` (WP24 swaps it); the "exported windows and factors" tests pass (Track 2).
- [ ] `volatilityPercent` requires a unit; `/market` and `/product` call it with `"annualised"`, the server fallback with `"daily"`.
- [ ] `/market` shows "Vol 30D (ann.)" with an explanatory title and unsigned neutral values; `/product` shows "Volatility 30D (annualised)" and the note; `/stats` shows "Volatility 90D (daily)" and the updated definition.
- [ ] Displayed values on `/market`, `/product`, `/stats` and the catalog cards are unchanged (spot-checked against production).
- [ ] PriceChart's `groupedDaily` depends on `[data]` only; a currency toggle does not call `parseRecordedAt` (`PriceChart.memo.test.tsx`), and the chips are unchanged by the toggle.
- [ ] PriceChart chips carry "charted range" titles and their values are unchanged.
- [ ] `useResponsive.ts` is deleted; `ResponsivePriceChart` passes `heightClassName="h-[150px] md:h-[200px]"` and the skeleton uses the same classes; the classes sit on the wrapper directly around `ResponsiveContainer` (and the no-data box), never on an element that also contains the chip row (`PriceChart.memo.test.tsx`).
- [ ] PriceChart has no `toLocale*` call and no module-level `Intl.DateTimeFormat` was added (WP07's `formatMonthDay` covers F073's formatter cost).
- [ ] `app/lib/csv.ts` is the only CSV parser; `import.ts` and `shopifyCsv.ts` use it; `import.test.ts` passes unchanged plus the F003 cases.
- [ ] `CompareDashboard.tsx` contains no `<table>`, no CSV parsing and no margin maths, and is under 400 lines; the rules live in `compareMath.ts` with tests.
- [ ] `/compare` mounts exactly one table (`CompareDashboard.tables.test.tsx`), each table is `table-fixed` with a `<colgroup>`, and search uses `useDeferredValue`.
- [ ] `SortableTable` renders each body row through the memoised `SortableTableRow`; a narrower filter over the same row objects re-renders no surviving row (`SortableTable.test.tsx`, F074).
- [ ] `/compare` title sort remains case-insensitive; nulls sort last in both directions.
- [ ] `tsc`, lint (0 errors), the full jest suite (also under Vancouver and Tokyo for the listed files) and `pnpm build:stub` pass.

## Rollback

Code only; no migrations or data changes. Revert the merge commit (`git revert -m 1 <merge-sha>`) and redeploy. The revert restores `returns.ts`, `useResponsive.ts`, the old compare file and the old test path together; the CI zone step path is restored by the same revert. Partial rollback is possible per area because the three areas are independent: PriceChart and ResponsivePriceChart (steps 8-9), compare (steps 10-13 plus `lib/sorting.ts` can stay), import (step 14; `lib/csv.ts` can stay).

## Commit and PR

Commit message:

```
refactor(market): one market-math module; split Seller Tools

- app/lib/marketMath.ts: USD-only return, CAGR, drawdown, volatility
  (explicit daily/annualised unit), daily points and release-date helpers,
  used by serverMarketData, MarketView buildRows, ReturnMetrics, the
  product page and PriceChart (F005); windows and factors exported as
  named constants for /methodology (no behaviour change)
- label volatility units on /market, /product and /stats; numbers unchanged
- PriceChart: currency applied once after a USD pipeline, chips labelled as
  charted-range figures, CSS-driven height; delete useResponsive (F073)
- app/lib/csv.ts: one RFC 4180 parser for the Shopify and Collectr imports;
  Collectr keeps per-field trim and the row cap (F003)
- /compare: compareMath/shopifyCsv modules with tests, generic SortableTable,
  one table per tab, deferred search, table-fixed (F043, F074)
- lib/sorting.ts: shared null-sinking comparator with a string comparator
```

PR title: `refactor(market): consolidate market math, label volatility units, split /compare (WP18)`

PR body summary: link `audits/remediation/WP18-market-math-and-compare.md`; list F005, F073, F043, F074, F003 with one line each; state the decisions (USD-only helpers; units labelled rather than maths changed, with the reason that `/stats` is SQL-fed; chips kept on the charted series; compare modules in `app/compare/` rather than `app/lib/`; lenient mid-field quotes); state what WP17 had already done (tooltip/dot hoisting, `buildRows.ts`) and that this PR only rewired them; paste the tsc, lint, jest (three zones) and `build:stub` output; include before/after screenshots of the `/market` volatility header, the product tile, the `/stats` header and the `/compare` tabs; list follow-ups not done here: volatility and drawdown lookbacks count priced days rather than calendar days (TS and SQL agree on neither exactly), `DEFAULT_EXCHANGE_RATE = 1.35` on `/compare` and the `1.36` prop defaults (WP20), MarketView table decomposition and `F125` row memoisation (WP19), and `HoldingsTable` still has its own sort button (could adopt `SortButton`).
