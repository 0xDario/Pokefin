# WP19: MarketView decomposition and row memoisation

- **Findings covered**
  - F045 (item 2 and the verifier's additions, for `/market`): `MarketView.tsx` (862 lines at review) mixes row derivation, a 16-way sort `switch`, a hand-written 16-`<th>` header and a hand-maintained column count; adding one column touches 5 to 7 places and a missing `case` silently sorts as "missing". Item (1) (pure `buildMarketRows` plus tests for the row maths) was done by WP17 step 13 and WP18 (`lib/marketMath.ts` and its tests); this PR adds the column table (item 2), derives the column count from it and types the default sort direction by column (verifier additions). Item (3) (URL state) is resolved for `/prices` by WP08 and is deliberately NOT applied to `/market` (verifier correction). Item (4) (one settings object or context for the 11 `ProductCard` props on `/prices`) is NOT done here and no other package does it (WP20's CurrencyContext removes the `initialExchangeRate` prop plumbing, not the `ProductCard` props); it is listed as a follow-up in the PR body (see "Commit and PR") and under Owner actions.
  - F125 (full; severity low, confirmed by full-effort re-verification): every expand tap, every history arrival and every collapse rebuilds and reconciles all ~306 inline rows, because `expandedProductId`, `loadingProductIds` and `priceHistory` are dependencies of the one `tableBody`/`rows` memo and rows are not components. Measured on the real MarketView with 306 products (production React 19, jsdom, 4-core 2.1 GHz Xeon): expand tap 43 to 58 ms, collapse 47 to 53 ms, history-arrival commit 90 to 120 ms; with a `memo` row the tap drops to about 2 ms. The history-arrival commit only drops too if row objects keep their identity for unchanged products (step 2); a `memo` row alone does not fix it. After this PR one product's expand/loading/history change re-renders one `memo` row (two on expand when another row was open). Step 1 (one daily series per product instead of two) is a harmless cleanup kept from the earlier review; it is NOT part of the F125 fix and has no measurable effect, because the ~300 products without loaded history return early from `toDailyPoints`.
- **Priority rationale**: last structural refactor of the heaviest client table; it lands after WP09 (loading store, SVG sparkline) and WP18 (shared market math) so it does not fight them. F125 is low severity: no data or correctness impact, one page and one interaction. It is user-visible only as tap latency on `/market`: about 40 to 60 ms per Show/Hide tap on desktop (barely perceptible), roughly 150 to 250 ms on a mid-range phone, at or over the 200 ms INP "poor" threshold, twice per expand (the tap, then again when the history lands). So it comes late.
- **Effort**: M (5 to 7 hours, including tests).
- **Depends on**: WP18 (hard: `app/lib/marketMath.ts` with `toDailyPoints`, `maxDrawdownPercent`, `volatilityPercent`; `app/lib/sorting.ts`; `MarketView/returns.ts` deleted; `MarketView/sorting.ts` reduced to a re-export plus `getDefaultSortDirection`; the "Vol 30D (ann.)" header and `renderVolatilityValue` in `MarketView.tsx`), WP17 (hard: `MarketView/buildRows.ts` with `buildMarketRow`/`buildMarketRows` and `buildRows.test.ts`, lint blocking in CI), WP09 (per-product loading store `useLoadingProductIds`, `MiniSparkline` without currency props). Also assumes the in-order landing of WP07 (`lib/format.ts`), WP13 (`NoResults` in MarketView), WP14 (contrast classes) and WP15 (promo removed from MarketView, link colour token).
- **Unblocks**: nothing directly; WP20 (CurrencyContext) will touch `MarketView.tsx` props that this PR leaves in one place (`MarketTableRow` props).
- **Suggested branch name**: `remediation/wp19-marketview-refactor`
- **Risk level**: medium. Pure client refactor with no data or API change, but the file carries edits from seven earlier packages (WP07, WP09, WP13, WP14, WP15, WP17, WP18) that must be carried into the new modules exactly (class strings, formatters, copy); a mistake shows as a wrong column, not a crash.

## Why

`/market` renders a ~306-row table from one 862-line component. Sorting is a 16-case `switch` (`MarketView.tsx:366-401`) mirroring a `SortKey` union (`:70-86`), the header repeats the same button markup 16 times (`:695-853`), and the expanded row's `colSpan` comes from a hard-coded `showAllColumns ? 19 : 10` (`:244`), so adding a column means editing five places and a forgotten `case` compiles and silently sorts the column as empty. On the performance side, the whole `<tbody>` is one `useMemo` keyed on `loadingProductIds` and `priceHistory` (`:617-629`) with inline rows, and `expandedProductId` is a dependency too, so clicking "Show" on one product rebuilds and reconciles every row twice (commit 1: expansion plus loading on; commit 2: history plus loading off), and "Hide" does it a third time. Commit 2 is the most expensive one because `priceHistory` changes, which re-derives `rows` and `sortedRows` for every product and hands back a new row object per product (measured 90 to 120 ms in jsdom, with or without a `memo` row; the tap itself measured 43 to 58 ms, about 2 ms with a `memo` row). Phone users feel this as a sluggish Show/Hide. The two `toDailyPoints` passes per product (drawdown and volatility, `:322-323` at review; inside `getMaxDrawdownPercent` and `getVolatilityPercent` after WP18) are not a measurable part of this cost: products with no loaded history return `[]` immediately. Step 1 merges them anyway as a cleanup. After this PR the table is driven by one column descriptor list (header, cells, sort accessor, default direction and column count all derive from it), rows are a `memo` component fed stable row objects, and an expand/collapse or history arrival re-renders only the affected row(s). Nothing visible changes except faster Show/Hide taps: same columns, labels, order, default sort and behaviour.

## Before you start

Read these files fully, in their CURRENT state (line numbers below are from review HEAD `a188fea`; earlier packages have moved them, so find every edit by the quoted code, never by the number alone):

- `frontend/app/components/MarketView/MarketView.tsx`
- `frontend/app/components/MarketView/buildRows.ts` (added by WP17 step 13, rewired by WP18 step 4) and `frontend/app/components/MarketView/__tests__/buildRows.test.ts`
- `frontend/app/lib/marketMath.ts` (WP18 step 1) and `frontend/app/lib/__tests__/marketMath.test.ts`
- `frontend/app/components/MarketView/sorting.ts` (after WP18 step 3b: a re-export of `lib/sorting.ts` plus `getDefaultSortDirection`) and `frontend/app/components/MarketView/__tests__/sorting.test.ts`
- `frontend/app/components/MarketView/MiniSparkline.tsx` (WP09 rewrote it)
- `frontend/app/components/ProductPrices/hooks/useProductData.ts` and `frontend/app/components/ProductPrices/hooks/historyLoadingStore.ts` (WP09)
- `frontend/app/components/MarketView/__tests__/MarketView.emptyState.test.tsx` (WP13; its mock block is reused)
- `frontend/app/market/page.tsx` (renders `<MarketView>` with no Suspense boundary; must stay that way)
- `audits/remediation/WP18-market-math-and-compare.md` steps 1, 3, 4 and 5a, `audits/remediation/WP17-lint-tests-observability-ci-gate.md` "Step 13" and `audits/remediation/WP09-prices-card-rendering.md` steps 2, 4d and 6c (what they put in these files)

Run from `frontend/` and record the output in the PR description:

```bash
wc -l app/components/MarketView/MarketView.tsx
grep -c '        case "' app/components/MarketView/MarketView.tsx      # expect 16 (the sort switch)
grep -n 'showAllColumns ? 19 : 10' app/components/MarketView/MarketView.tsx                          # expect 1 hit
grep -n 'Fragment key={product.id}' app/components/MarketView/MarketView.tsx                        # inline rows, expect 1
grep -rn 'useSearchParams\|useRouter\|next/navigation' app/components/MarketView                    # expect no output
grep -rn 'getDefaultSortDirection' app --include=*.ts --include=*.tsx | grep -v __tests__           # expect exactly 3: MarketView/sorting.ts (definition), MarketView.tsx (import line and handleSort call)
grep -n 'useLoadingProductIds\|loadingProductIds' app/components/MarketView/MarketView.tsx
grep -n -A2 '<MiniSparkline' app/components/MarketView/MarketView.tsx                              # WP09: history prop only
grep -n 'lib/format\|NoResults\|CardRinkPromo\|pf-gain-text\|pf-pokeblue' app/components/MarketView/MarketView.tsx
grep -n '\.\.\.priceHistoryRef.current' app/components/ProductPrices/hooks/useProductData.ts         # expect 1 hit
```

Preconditions. Run these too; if any one prints something other than the expected result, stop and report it in the PR instead of improvising (WP17 and WP18 are hard dependencies):

```bash
test -f app/components/MarketView/buildRows.ts && echo ok                                            # ok (WP17)
test -e app/components/MarketView/returns.ts || echo ok                                              # ok (WP18 step 7c deleted it)
grep -c 'export function toDailyPoints\|export function maxDrawdownPercent\|export function volatilityPercent' app/lib/marketMath.ts   # 3 (WP18)
grep -c 'export function compareSortValues' app/lib/sorting.ts                                       # 1 (WP18)
grep -n 'from "../../lib/marketMath"' app/components/MarketView/buildRows.ts                        # 2 hits: the import and the DAY_MS/getReleaseMs re-export (WP18 4a, 4b)
grep -n 'getMaxDrawdownPercent(history)\|lookbackPoints: 30' app/components/MarketView/buildRows.ts  # 2 hits (WP18 4c)
grep -n 'renderVolatilityValue\|Vol 30D (ann.)' app/components/MarketView/MarketView.tsx            # 3 hits: the function, the cell, the header (WP18 5a)
```

Assumptions to check, and what to do if one is false:

1. **`buildMarketRow` keeps WP17's signature** `buildMarketRow(product, history, volume, convertPrice, todayUtcMs)` after WP18 (WP18 4c keeps `convertPrice` because `price` still uses it) and `buildRows.ts` still exports `buildMarketRows`, `MarketRow`, `RETURN_WINDOWS`, `ReturnWindowLabel`, plus the re-exported `DAY_MS` and `getReleaseMs`. Check with `grep -n '^export' app/components/MarketView/buildRows.ts`. If the argument list differs, keep the real one everywhere this spec calls `buildMarketRow`/`buildRows`.
2. **Loading ids come from WP09's store.** Expect `const loadingProductIds = useLoadingProductIds(historyLoadingStore);` in MarketView. If WP09 did not land and `loadingProductIds` is still a `number[]` from `useProductData`, the code below works unchanged (`new Set(loadingProductIds)` accepts both).
3. **`priceHistory` keeps per-product array identity.** `useProductData.ts:134-137` (review HEAD) builds `{ ...priceHistoryRef.current, [productId]: history }`, so only the loaded product's array is new. WP09 keeps that spread. If the grep above finds no hit because the hook now rebuilds every array on each load, row reuse in step 2 cannot work: stop and report it in the PR instead of adding deep comparisons.

## Implementation steps

Order: 1, 2, 3, 4, 5, 6, then tests (7). Steps 1 to 4 keep the build green (step 1 changes only how two `buildMarketRow` values are computed; steps 2 to 4 add code); step 5 switches MarketView over; step 6 deletes the now-dead helper.

### Step 1. Build the daily series once per product (cleanup, not the F125 fix)

This step has no measurable performance effect (full-effort re-verification of F125: products without loaded history return `[]` from `toDailyPoints` at once, and only the few products with loaded history pay for the second pass). It is kept because it is harmless, already proven equivalent by the tests in `buildRows.reuse.test.ts`, and removes a duplicated pass. The F125 fix is steps 2, 4 and 5. If the equivalence tests fail and you cannot make step 1 match WP18's helpers exactly within 30 minutes, revert step 1 (keep `getMaxDrawdownPercent`/`getVolatilityPercent` in `buildRows.ts`), delete the `describe("buildMarketRow drawdown and volatility ...")` block from `buildRows.reuse.test.ts`, drop the two step-1 greps from Verification, and say so in the PR.

File: `app/components/MarketView/buildRows.ts`. No change to `lib/marketMath.ts`: WP18 already exports the series builder `toDailyPoints(history, maxPoints?)` and the series-level functions `maxDrawdownPercent(prices)` and `volatilityPercent(prices, unit)`; the history-level `getMaxDrawdownPercent` and `getVolatilityPercent` each call `toDailyPoints` themselves, which is the double pass.

1a. In the `import { ... } from "../../lib/marketMath";` block (WP18 4a), remove `getMaxDrawdownPercent` and `getVolatilityPercent` and add `maxDrawdownPercent`, `toDailyPoints` and `volatilityPercent`, keeping the list alphabetical. The block becomes:

```ts
import {
  daysSinceUtcMs,
  getCagrPercent,
  getReturnPercent,
  maxDrawdownPercent,
  perDay,
  releaseDateUtcMs,
  toDailyPoints,
  volatilityPercent,
} from "../../lib/marketMath";
```

(If WP18 left a different set of names in that import, keep its other names and only make the two removals and three additions.)

1b. In `buildMarketRow`, replace the drawdown line and the volatility statement WP18 wrote:

```ts
  const maxDrawdown = getMaxDrawdownPercent(history);
  // Annualised (daily std-dev times sqrt(365)); the column header says so.
  const volatility30d = getVolatilityPercent(history, {
    lookbackPoints: 30,
    unit: "annualised",
  });
```

with

```ts
  // One daily series per product, shared by drawdown and volatility.
  // Same numbers as the history-based helpers in lib/marketMath: those build
  // this series themselves, and volatility takes its newest 30 points.
  const dailyPrices = toDailyPoints(history).map((point) => point.price);
  const maxDrawdown = maxDrawdownPercent(dailyPrices);
  // Annualised (daily std-dev times sqrt(365)); the column header says so.
  const volatility30d = volatilityPercent(dailyPrices.slice(-30), "annualised");
```

Why this is exact: `getMaxDrawdownPercent(history)` is `maxDrawdownPercent(toDailyPoints(history).map(p => p.price))`, and `getVolatilityPercent(history, { lookbackPoints: 30, unit })` is `volatilityPercent(prices.slice(-Math.max(30, 3)), unit)` over the same prices. Keep the comment above these lines about drawdown and volatility staying ungated. Change nothing else in `buildMarketRow`; `buildRows.test.ts` must pass unchanged. Do not touch `app/product/[id]/page.tsx`: after WP18 it calls the `lib/marketMath` helpers directly and computes each metric once per page render.

### Step 2. `app/components/MarketView/buildRows.ts`: stable row objects

Append at the end of the file:

```ts
interface CachedMarketRow {
  product: Product;
  history: PriceHistoryEntry[] | undefined;
  // Whatever volume type buildMarketRow takes (WP11/WP17 narrowed it).
  volume: Parameters<typeof buildMarketRow>[2];
  convertPrice: (usdPrice: number) => number;
  todayUtcMs: number;
  row: MarketRow;
}

export type MarketRowsBuilder = typeof buildMarketRows;

/**
 * A `buildMarketRows` with the same signature and results that hands back the
 * SAME row object for a product whose inputs are all unchanged (same product,
 * history and volume objects, same `convertPrice`, same UTC day).
 *
 * That identity is what lets `memo(MarketTableRow)` skip every row except the
 * one whose history just loaded (F125). useProductData replaces only the
 * loaded product's entry in `priceHistory`; every other entry keeps its array
 * identity, so every other row is reused.
 *
 * One builder per MarketView instance (create it in a lazy useState). The
 * cache is keyed by product id, never pruned, and bounded by the catalog size.
 */
export function createMarketRowsBuilder(): MarketRowsBuilder {
  const cache = new Map<number, CachedMarketRow>();

  return (products, priceHistory, volumeMetrics, convertPrice, todayUtcMs) =>
    products.map((product) => {
      const history = priceHistory[product.id];
      const volume = volumeMetrics[product.id];
      const cached = cache.get(product.id);
      if (
        cached &&
        cached.product === product &&
        cached.history === history &&
        cached.volume === volume &&
        cached.convertPrice === convertPrice &&
        cached.todayUtcMs === todayUtcMs
      ) {
        return cached.row;
      }

      const row = buildMarketRow(
        product,
        history,
        volume,
        convertPrice,
        todayUtcMs
      );
      cache.set(product.id, {
        product,
        history,
        volume,
        convertPrice,
        todayUtcMs,
        row,
      });
      return row;
    });
}
```

`Product` and `PriceHistoryEntry` are already imported as types at the top of `buildRows.ts` (WP17); do not add a second import. `convertPrice` stays in the cache key even though, after WP18, only `price` and `pricePerDay` depend on it: a currency toggle must rebuild every row. Why a builder and not a ref: eslint-plugin-react-hooks 7.1.1 (shipped with eslint-config-next 16, blocking since WP17) reports `react-hooks/refs` for reading `ref.current` during render; a builder held in lazy `useState` is invisible to that rule and is guaranteed to survive re-renders (a `useMemo(() => create(), [])` is not).

### Step 3. New file `app/components/MarketView/columns.tsx`: the column descriptor table (F045)

This replaces the `SortKey` union (`MarketView.tsx:70-86`), `KEY_RETURN_WINDOWS` (`:90`), the cell helpers (`:113-188`, plus WP18's `renderVolatilityValue`), the sort `switch` (`:354-413`), `getSortIndicator` (`:438-441`), the per-cell JSX (`:471-562`), the header (`:695-853`) and `visibleColumnCount` (`:244`).

Class strings and formatter calls: move them from the CURRENT `MarketView.tsx`, cell by cell. The code below shows the state expected after WP07 (`formatDateOnly`, `formatMoney`), WP09 (`<MiniSparkline history={...} />`), WP14 (`--pf-gain-text`/`--pf-loss-text`, `text-slate-500` on the rank cell and the "Loading..."/"Open chart" text), WP15 and WP18 (step 5a: the volatility header reads "Vol 30D (ann.)" with a `title` on its button, and the volatility cell uses `renderVolatilityValue`, not `renderReturnValue`). Where the current file differs from this snippet (a class, a label, the `title` text, an `aria-label`), the current file wins: copy it into the matching descriptor. A header button `title` goes in the descriptor's optional `headerHint` field (rendered as `title` on the header button in step 5h).

```tsx
import type { ReactNode } from "react";
import { formatDateOnly, formatMoney } from "../../lib/format";
import type { Currency, Product } from "../ProductPrices/types";
import ProductImage from "../ProductPrices/shared/ProductImage";
import ExpansionTypeBadge from "../ProductPrices/shared/ExpansionTypeBadge";
import VariantBadge from "../ProductPrices/shared/VariantBadge";
import MiniSparkline from "./MiniSparkline";
import type { MarketRow, ReturnWindowLabel } from "./buildRows";
import {
  compareSortValues,
  type SortDirection,
  type SortValue,
} from "./sorting";

/**
 * The /market table, one entry per column, in display order. Header cells,
 * body cells, the visible-column count and the sort keys are all derived
 * from this list, so adding a column is one entry here (F045).
 */

/** Per-row values a cell may need beyond the row itself. */
export interface MarketCellContext {
  /** 1-based position in the current sort order. */
  rank: number;
  isExpanded: boolean;
  isLoading: boolean;
  currency: Currency;
  formatPrice: (usdPrice: number | null | undefined) => string;
  onToggle: () => void;
}

interface MarketColumnBase<Id extends string = string> {
  id: Id;
  /** Header text. */
  label: string;
  /** Optional header tooltip (rendered as `title`). */
  headerHint?: string;
  /** Shown in the default "key columns" view (otherwise only in "all"). */
  keyColumn: boolean;
  headerClassName: string;
  cellClassName: string;
  render: (row: MarketRow, ctx: MarketCellContext) => ReactNode;
}

export interface SortableMarketColumn<Id extends string = string>
  extends MarketColumnBase<Id> {
  sortable: true;
  /** The value compareSortValues sorts on. null (or NaN) sorts last. */
  accessor: (row: MarketRow) => SortValue;
  /** Direction on first click. "asc" where a smaller value is more interesting. */
  defaultDirection: SortDirection;
}

export interface StaticMarketColumn<Id extends string = string>
  extends MarketColumnBase<Id> {
  sortable: false;
}

export type MarketColumn = SortableMarketColumn | StaticMarketColumn;

const TH = "px-3 py-3 text-right";
const TD = "px-3 py-4 text-right";
const TD_MUTED = "px-3 py-4 text-right text-slate-600";

// Moved from MarketView.tsx. Colours as WP14 left them.
function renderReturnValue(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return <span className="text-slate-400">--</span>;
  }

  const sign = value > 0 ? "+" : "";
  const colorClass =
    value > 0
      ? "text-[var(--pf-gain-text)]"
      : value < 0
      ? "text-[var(--pf-loss-text)]"
      : "text-slate-500";

  return (
    <span className={`font-semibold ${colorClass}`}>
      {sign}
      {value.toFixed(2)}%
    </span>
  );
}

// Moved from MarketView.tsx (WP18 step 5a). Volatility is a size, not a gain
// or a loss: no sign and no gain/loss colour.
function renderVolatilityValue(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return <span className="text-slate-400">--</span>;
  }
  return <span className="font-semibold text-slate-700">{value.toFixed(2)}%</span>;
}

function getProductTypeLabel(product: Product) {
  return (
    product.product_types?.label ||
    product.product_types?.name ||
    "Unknown Type"
  );
}

function getSetName(product: Product) {
  return product.sets?.name || "Unknown Set";
}

// Moved from MarketView.tsx (renderProductCell / renderSetCell).
function renderProductCell(product: Product) {
  const productType = getProductTypeLabel(product);
  const setName = getSetName(product);

  return (
    <div className="flex items-center gap-3">
      <ProductImage
        imageUrl={product.image_url}
        productName={`${setName} ${productType}`}
        className="w-14 h-14 rounded-lg border border-slate-200 bg-white"
        preferThumbnail
      />
      <div>
        <div className="text-sm font-semibold text-slate-900">
          {productType}
        </div>
        <div className="text-xs text-slate-500">{setName}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          <ExpansionTypeBadge type={product.sets?.expansion_type} />
          {product.variant && <VariantBadge variant={product.variant} />}
        </div>
      </div>
    </div>
  );
}

function renderSetCell(product: Product) {
  const setName = getSetName(product);
  const setCode = product.sets?.code || "N/A";
  const generation = product.sets?.generations?.name || "Unknown";

  return (
    <div className="space-y-1">
      <div className="text-sm font-medium text-slate-800">{setName}</div>
      <div className="text-xs text-slate-500">
        {generation} / {setCode}
      </div>
    </div>
  );
}

function returnColumn<const Id extends string>(
  id: Id,
  label: ReturnWindowLabel,
  keyColumn: boolean
): SortableMarketColumn<Id> {
  return {
    id,
    label,
    keyColumn,
    sortable: true,
    defaultDirection: "desc",
    headerClassName: TH,
    cellClassName: TD,
    accessor: (row) => row.returns[label],
    render: (row) => renderReturnValue(row.returns[label]),
  };
}

export const MARKET_COLUMNS = [
  {
    id: "rank",
    label: "#",
    keyColumn: true,
    sortable: false,
    headerClassName: "sticky left-0 z-20 w-14 bg-slate-50 px-3 py-3 text-left",
    cellClassName:
      "sticky left-0 z-10 w-14 bg-white px-3 py-4 text-slate-500 group-hover:bg-slate-50",
    render: (_row, ctx) => ctx.rank,
  },
  {
    id: "product",
    label: "Product",
    keyColumn: true,
    sortable: true,
    defaultDirection: "asc",
    headerClassName: "sticky left-14 z-20 bg-slate-50 px-3 py-3 text-left",
    cellClassName:
      "sticky left-14 z-10 bg-white px-3 py-4 group-hover:bg-slate-50",
    accessor: (row) =>
      `${getProductTypeLabel(row.product)} ${row.product.variant || ""}`
        .trim()
        .toLowerCase(),
    render: (row) => renderProductCell(row.product),
  },
  {
    id: "set",
    label: "Set",
    keyColumn: true,
    sortable: true,
    defaultDirection: "asc",
    headerClassName: "px-3 py-3 text-left",
    cellClassName: "px-3 py-4",
    accessor: (row) => getSetName(row.product).toLowerCase(),
    render: (row) => renderSetCell(row.product),
  },
  {
    id: "price",
    label: "Price",
    keyColumn: true,
    sortable: true,
    defaultDirection: "desc",
    headerClassName: TH,
    cellClassName: "px-3 py-4 text-right font-semibold text-slate-900",
    accessor: (row) => row.price,
    render: (row, ctx) => ctx.formatPrice(row.product.usd_price),
  },
  {
    id: "release_date",
    label: "Release",
    keyColumn: false,
    sortable: true,
    defaultDirection: "desc",
    headerClassName: TH,
    cellClassName: TD_MUTED,
    accessor: (row) => row.releaseMs,
    render: (row) => formatDateOnly(row.product.sets?.release_date),
  },
  {
    id: "days_since_release",
    label: "Days Since",
    keyColumn: false,
    sortable: true,
    defaultDirection: "asc",
    headerClassName: TH,
    cellClassName: TD_MUTED,
    accessor: (row) => row.daysSinceRelease,
    render: (row) => row.daysSinceRelease ?? "--",
  },
  {
    id: "price_per_day",
    label: "Price/Day",
    keyColumn: false,
    sortable: true,
    defaultDirection: "desc",
    headerClassName: TH,
    cellClassName: TD_MUTED,
    accessor: (row) => row.pricePerDay,
    render: (row, ctx) => formatMoney(row.pricePerDay, ctx.currency),
  },
  {
    id: "cagr",
    label: "CAGR",
    keyColumn: false,
    sortable: true,
    defaultDirection: "desc",
    headerClassName: TH,
    cellClassName: TD,
    accessor: (row) => row.cagr,
    render: (row) => renderReturnValue(row.cagr),
  },
  {
    id: "max_drawdown",
    label: "Max DD",
    keyColumn: false,
    sortable: true,
    defaultDirection: "asc",
    headerClassName: TH,
    cellClassName: TD,
    accessor: (row) => row.maxDrawdown,
    render: (row) =>
      renderReturnValue(row.maxDrawdown === null ? null : row.maxDrawdown * -1),
  },
  {
    id: "volatility_30d",
    label: "Vol 30D (ann.)",
    // WP18's header title, verbatim.
    headerHint:
      "Annualised volatility: standard deviation of daily price changes over the last 30 priced days, times the square root of 365. The Stats page shows the daily figure, which is about 19 times smaller.",
    keyColumn: false,
    sortable: true,
    defaultDirection: "asc",
    headerClassName: TH,
    cellClassName: TD,
    accessor: (row) => row.volatility30d,
    render: (row) => renderVolatilityValue(row.volatility30d),
  },
  returnColumn("return_7d", "7D", true),
  returnColumn("return_1m", "1M", true),
  returnColumn("return_3m", "3M", true),
  returnColumn("return_6m", "6M", false),
  returnColumn("return_1y", "1Y", false),
  {
    id: "vol_30d",
    label: "Vol (30d)",
    keyColumn: true,
    sortable: true,
    defaultDirection: "desc",
    headerClassName: TH,
    cellClassName: TD,
    accessor: (row) => row.unitsSold30d,
    render: (row) =>
      row.unitsSold30d !== null ? (
        <span className="font-semibold text-slate-700 tabular-nums">
          {row.unitsSold30d}
        </span>
      ) : (
        <span className="text-slate-400">--</span>
      ),
  },
  {
    id: "vol_trend",
    label: "Vol Δ",
    keyColumn: true,
    sortable: true,
    defaultDirection: "desc",
    headerClassName: TH,
    cellClassName: TD,
    accessor: (row) => row.volumeTrend,
    render: (row) => renderReturnValue(row.volumeTrend),
  },
  {
    id: "sparkline",
    label: "Last 7D",
    keyColumn: false,
    sortable: false,
    headerClassName: TH,
    cellClassName: "px-3 py-4",
    render: (row, ctx) => (
      <div className="flex justify-end">
        {row.history && row.history.length > 1 ? (
          <MiniSparkline history={row.history} />
        ) : ctx.isLoading ? (
          <span className="text-xs text-slate-500">Loading...</span>
        ) : (
          <span className="text-xs text-slate-500">Open chart</span>
        )}
      </div>
    ),
  },
  {
    id: "chart",
    label: "Chart",
    keyColumn: true,
    sortable: false,
    headerClassName: TH,
    cellClassName: TD,
    render: (_row, ctx) => (
      <button
        type="button"
        onClick={ctx.onToggle}
        className="rounded-md border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
        aria-expanded={ctx.isExpanded}
      >
        {ctx.isExpanded ? "Hide" : "Show"}
      </button>
    ),
  },
] as const satisfies readonly MarketColumn[];

type SortableColumnEntry = Extract<
  (typeof MARKET_COLUMNS)[number],
  { sortable: true }
>;

/** Every sortable column id. Derived, so it cannot drift from the table. */
export type SortKey = SortableColumnEntry["id"];

/** A column as the table sees it: sortable ones carry a real SortKey id. */
export type MarketTableColumn = SortableMarketColumn<SortKey> | StaticMarketColumn;

/** Default view: the columns flagged keyColumn. Stable identity (memo prop). */
export const KEY_COLUMNS: readonly MarketTableColumn[] = MARKET_COLUMNS.filter(
  (column) => column.keyColumn
);

/** "Show all columns" view. Stable identity (memo prop). */
export const ALL_COLUMNS: readonly MarketTableColumn[] = MARKET_COLUMNS;

const SORTABLE_COLUMNS = new Map<SortKey, SortableMarketColumn<SortKey>>(
  ALL_COLUMNS.filter(
    (column): column is SortableMarketColumn<SortKey> => column.sortable
  ).map((column) => [column.id, column])
);

export function getSortColumn(key: SortKey): SortableMarketColumn<SortKey> {
  const column = SORTABLE_COLUMNS.get(key);
  if (!column) {
    throw new Error(`Unknown market sort key: ${key}`);
  }
  return column;
}

/**
 * Sorted copy of `rows`. Each row's sort value is read once (not once per
 * comparison), then compareSortValues sinks missing values to the bottom in
 * both directions. Array.prototype.sort is stable, so ties keep input order.
 */
export function sortMarketRows(
  rows: readonly MarketRow[],
  key: SortKey,
  direction: SortDirection
): MarketRow[] {
  const { accessor } = getSortColumn(key);
  return rows
    .map((row) => ({ row, value: accessor(row) }))
    .sort((a, b) => compareSortValues(a.value, b.value, direction))
    .map((entry) => entry.row);
}
```

Notes for this file:

- The display order and the key/all split reproduce review HEAD exactly: key view (10) is `# Product Set Price 7D 1M 3M Vol(30d) VolΔ Chart`; all view (19) inserts `Release, Days Since, Price/Day, CAGR, Max DD, Vol 30D` after Price, `6M, 1Y` after 3M and `Last 7D` before Chart (`MarketView.tsx:482-552`, `:734-851`).
- The `accessor`s reproduce the 16 `case`s of `MarketView.tsx:366-398` one for one; `defaultDirection` reproduces `getDefaultSortDirection` (in `MarketView/sorting.ts`, `:63-68` at review HEAD): asc for product, set, days_since_release, max_drawdown, volatility_30d; desc for the rest.
- `./sorting` still re-exports `compareSortValues`, `SortDirection` and `SortValue` from `lib/sorting.ts` after step 6, so this import stays valid. `compareSortValues`'s optional fourth argument (WP18's string comparator) is not passed: the Market table keeps plain `localeCompare`, as today.
- If `MiniSparkline` still takes `currency`/`exchangeRate` (WP09 missing), add `exchangeRate: number` to `MarketCellContext`, pass it from `MarketTableRow`, and render `<MiniSparkline history={row.history} currency={ctx.currency} exchangeRate={ctx.exchangeRate} />`.
- `as const satisfies` keeps each `id` as a literal (so `SortKey` is the exact 16-member union) while still type-checking every entry and contextually typing the `render`/`accessor` parameters. Verified with TypeScript 6.0.3 against this repo's `tsconfig.json`, including the `headerHint` on one entry only.
- No `"use client"` in this file: it is imported only by `MarketView.tsx` and `MarketTableRow.tsx`, which are client modules.

### Step 4. New file `app/components/MarketView/MarketTableRow.tsx`: the memoised row (F125)

The component is named `MarketTableRow` because WP17 already exports a `MarketRow` type (the row data) from `buildRows.ts`.

Move the `PriceChart` `next/dynamic` block and its ChartBundle comment from `MarketView.tsx:30-40` into this file unchanged. Move the expanded-row JSX from `MarketView.tsx:564-611` unchanged except for the renamed variables shown (`isLoading` instead of `loadingProductIds.includes(product.id)`, `currency` instead of `selectedCurrency`, `columns.length` instead of `visibleColumnCount`). Keep the link's colour class as WP15 left it in the current file (expected `text-[var(--pf-pokeblue)]`, `text-blue-600` at review HEAD).

```tsx
"use client";

import dynamic from "next/dynamic";
import { memo } from "react";
import type { ChartTimeframe, Currency } from "../ProductPrices/types";
import type { MarketRow } from "./buildRows";
import type { MarketCellContext, MarketTableColumn } from "./columns";

// Must import through ChartBundle (never "../PriceChart" directly) so Recharts
// stays in the single shared async chunk instead of forking a second copy.
const PriceChart = dynamic(
  () => import("../charts/ChartBundle").then((m) => m.PriceChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[200px] w-full animate-pulse rounded-md border border-slate-200 bg-slate-100" />
    ),
  }
);

export interface MarketTableRowProps {
  row: MarketRow;
  /** 1-based position in the current sort order. */
  rank: number;
  /** KEY_COLUMNS or ALL_COLUMNS from ./columns (stable identities). */
  columns: readonly MarketTableColumn[];
  isExpanded: boolean;
  isLoading: boolean;
  chartTimeframe: ChartTimeframe;
  currency: Currency;
  exchangeRate: number;
  formatPrice: (usdPrice: number | null | undefined) => string;
  /** Must be referentially stable (useCallback) or every row re-renders. */
  onToggle: (productId: number) => void;
}

/**
 * One product's table row, plus its expanded chart row when open.
 *
 * memo(): every prop is a primitive or a stable reference, so a history or
 * loading change for one product re-renders that product's row only (F125).
 * MarketView keeps row objects stable via createMarketRowsBuilder.
 */
function MarketTableRow({
  row,
  rank,
  columns,
  isExpanded,
  isLoading,
  chartTimeframe,
  currency,
  exchangeRate,
  formatPrice,
  onToggle,
}: MarketTableRowProps) {
  const { product, history } = row;
  const ctx: MarketCellContext = {
    rank,
    isExpanded,
    isLoading,
    currency,
    formatPrice,
    onToggle: () => onToggle(product.id),
  };

  return (
    <>
      <tr className="group border-t border-slate-100 hover:bg-slate-50">
        {columns.map((column) => (
          <td key={column.id} className={column.cellClassName}>
            {column.render(row, ctx)}
          </td>
        ))}
      </tr>
      {isExpanded && (
        <tr className="bg-slate-50">
          <td colSpan={columns.length} className="px-6 py-5">
            {isLoading ? (
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
                Loading price history...
              </div>
            ) : history && history.length > 1 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">
                      Price history
                    </div>
                    <div className="text-xs text-slate-500">
                      Showing {chartTimeframe} range
                    </div>
                  </div>
                  {product.url && (
                    <a
                      href={product.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-[var(--pf-pokeblue)] hover:underline"
                    >
                      View on TCGplayer &gt;
                    </a>
                  )}
                </div>
                <div className="mt-3">
                  <PriceChart
                    data={history}
                    range={chartTimeframe}
                    currency={currency}
                    exchangeRate={exchangeRate}
                    height={220}
                    releaseDate={product.sets?.release_date}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">
                Price history not available yet.
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default memo(MarketTableRow);
```

WP18 (F073) only added an optional `heightClassName` prop to `PriceChart` and passes it from `ResponsivePriceChart`, not from MarketView. If the current `MarketView.tsx` call or its `next/dynamic` block still differs from the one above (a later package changed it), copy the current version, not the one above.

### Step 5. `app/components/MarketView/MarketView.tsx`: switch to the new modules

Do these edits in order, then run `pnpm exec eslint app/components/MarketView/MarketView.tsx` and delete every import it reports as unused.

5a. **Imports.** Remove `Fragment` from the React import (keep `useCallback, useDeferredValue, useEffect, useMemo, useState`). Remove `import dynamic from "next/dynamic";`, the `PriceChart` dynamic block and its comment (moved in step 4), and the imports of `ProductImage`, `ExpansionTypeBadge`, `VariantBadge`, `MiniSparkline` and `formatDateOnly`/`formatMoney` from `lib/format` (only if nothing else in the file uses them). Replace the whole `import { ... } from "./sorting";` statement (it imports `compareSortValues`, `getDefaultSortDirection`, `type SortDirection`, `type SortValue`) with the single `import type { SortDirection } from "./sorting";` shown below, so the file has exactly one `./sorting` import. Change the `./buildRows` import to `import { createMarketRowsBuilder, DAY_MS, getReleaseMs } from "./buildRows";` (drop `buildMarketRows`, `RETURN_WINDOWS`, `ReturnWindowLabel`). Add:

```ts
import {
  ALL_COLUMNS,
  getSortColumn,
  KEY_COLUMNS,
  sortMarketRows,
  type SortKey,
} from "./columns";
import MarketTableRow from "./MarketTableRow";
import type { SortDirection } from "./sorting";
```

Keep `utcMidnightMs`, `NoResults` (WP13), `useLoadingProductIds` (WP09), `ControlBar`, the three hooks, `filterProducts`/`getAvailableGenerations` and the types import.

5b. **Delete module-level code now in `columns.tsx`:** the `SortKey` union, `KEY_RETURN_WINDOWS`, `renderReturnValue`, `renderVolatilityValue` (WP18), `formatRatio` (if still present), `renderProductCell`, `renderSetCell`, `formatReleaseDate` (if still present). Keep `AGE_FILTER_OPTIONS`, `AgeFilterValue`, `MarketViewProps`, `EMPTY_PRODUCTS`.

5c. **Column set.** Replace

```ts
  // Total visible columns drives colSpan on the expanded chart row.
  const visibleColumnCount = showAllColumns ? 19 : 10;
```

with

```ts
  // Stable module-level arrays, so MarketTableRow's memo sees the same
  // `columns` prop until the toggle flips. colSpan is columns.length.
  const visibleColumns = showAllColumns ? ALL_COLUMNS : KEY_COLUMNS;
```

5d. **Rows.** Replace WP17's `rows` useMemo (the one calling `buildMarketRows(...)`) with:

```ts
  // One builder per mounted MarketView: it hands back the previous row object
  // for every product whose inputs did not change, which is what lets
  // memo(MarketTableRow) skip them (F125).
  const [buildRows] = useState(createMarketRowsBuilder);
  const rows = useMemo(
    () =>
      buildRows(
        filteredProducts,
        priceHistory,
        volumeMetrics,
        convertPrice,
        utcMidnightMs()
      ),
    [buildRows, filteredProducts, priceHistory, convertPrice, volumeMetrics]
  );
```

(`useState(createMarketRowsBuilder)` passes the factory as the lazy initialiser: React calls it once and stores the returned builder function.) If WP17 or WP18 changed the argument list, keep their argument list.

5e. **Sorting.** Replace the whole `sortedRows` useMemo (the one containing `getSortValue` and `switch (key)`) with:

```ts
  const sortedRows = useMemo(
    () => sortMarketRows(rows, sortKey, sortDirection),
    [rows, sortKey, sortDirection]
  );

  // Per-row boolean for MarketTableRow; the Set identity changes exactly when
  // the loading list does.
  const loadingIdSet = useMemo(
    () => new Set(loadingProductIds),
    [loadingProductIds]
  );
```

5f. **Sort handler.** In `handleSort`, change `setSortDirection(getDefaultSortDirection(key));` to `setSortDirection(getSortColumn(key).defaultDirection);`. Delete `getSortIndicator` and, if still present, `const currencySymbol = ...`. Leave `toggleExpanded` exactly as it is (see Pitfalls).

5g. **Table body.** Keep the explanatory comment above `tableBody` (`:445-450`) and replace the `useMemo` with:

```tsx
  const tableBody = useMemo(
    () => (
      <tbody>
        {sortedRows.map((row, index) => (
          <MarketTableRow
            key={row.product.id}
            row={row}
            rank={index + 1}
            columns={visibleColumns}
            isExpanded={expandedProductId === row.product.id}
            isLoading={loadingIdSet.has(row.product.id)}
            chartTimeframe={chartTimeframe}
            currency={selectedCurrency}
            exchangeRate={exchangeRate}
            formatPrice={formatPrice}
            onToggle={toggleExpanded}
          />
        ))}
      </tbody>
    ),
    [
      sortedRows,
      visibleColumns,
      expandedProductId,
      loadingIdSet,
      chartTimeframe,
      selectedCurrency,
      exchangeRate,
      formatPrice,
      toggleExpanded,
    ]
  );
```

5h. **Header.** Replace everything from `<thead className=` to its closing `</thead>` with the block below. It keeps the thead classes, the button classes and the ` ^`/` v` indicator text; it adds `scope="col"` and puts `aria-sort` on whichever column is sorted (previously only Price carried `aria-sort`, and it was wrong for every other sort).

```tsx
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    {visibleColumns.map((column) => {
                      if (!column.sortable) {
                        return (
                          <th key={column.id} scope="col" className={column.headerClassName}>
                            {column.label}
                          </th>
                        );
                      }
                      const isSorted = sortKey === column.id;
                      return (
                        <th
                          key={column.id}
                          scope="col"
                          className={column.headerClassName}
                          aria-sort={
                            isSorted
                              ? sortDirection === "asc"
                                ? "ascending"
                                : "descending"
                              : undefined
                          }
                        >
                          <button
                            type="button"
                            onClick={() => handleSort(column.id)}
                            title={column.headerHint}
                            className="font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
                          >
                            {column.label}
                            {isSorted ? (sortDirection === "asc" ? " ^" : " v") : ""}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
```

If WP14 changed the header button classes or the indicator, keep WP14's version. Leave `{tableBody}`, the `<table>` element and its `min-w-[...]` classes, the `NoResults` block and the `!loading && !showNoResults` guard (WP13) untouched.

5i. Expected result: no `switch`, no `Fragment`, no `next/dynamic`, no `visibleColumnCount`, no JSX per cell in `MarketView.tsx`; the file drops from 862 lines at review to roughly 330 to 380 depending on upstream additions.

### Step 6. Remove `getDefaultSortDirection`

The "Before you start" grep showed `MarketView.tsx` as its only non-test user (WP18 added no other). After step 5 nothing imports or calls it.

6a. Replace the whole content of `app/components/MarketView/sorting.ts` with the block below. This deletes `getDefaultSortDirection`, its doc comment, and the `import type { SortDirection } from "../../lib/sorting";` line WP18 added for it (left behind, that import is an unused-variable lint error, and lint blocks CI). The re-export stays because `columns.tsx`, `MarketView.tsx` and `__tests__/sorting.test.ts` import from `./sorting` / `../sorting`.

```ts
/**
 * The null-sinking comparator for the Market View table. It is shared with
 * components/SortableTable and lives in lib/sorting.ts; it is re-exported
 * here so existing imports keep working. Default sort directions live on the
 * column descriptors in ./columns.tsx.
 */
export {
  compareSortValues,
  isMissingSortValue,
  type SortDirection,
  type SortValue,
  type StringComparator,
} from "../../lib/sorting";
```

If WP18's re-export list differs, keep WP18's list and only drop the import line and `getDefaultSortDirection`.

6b. In `app/components/MarketView/__tests__/sorting.test.ts`, delete the whole `describe("getDefaultSortDirection", ...)` block (`:84-97` at review HEAD; WP18 appended its comparator block after it, keep that) and remove `getDefaultSortDirection,` from the file's import. Its cases move to `columns.test.ts` (step 7).

### Step 7. Tests

Add the four new test files and the one update listed under Tests, exactly as written there. Write them after step 6 so they run against the finished code.

## Pitfalls: do not do this

- **Do not add `useSearchParams`, `useRouter` or any URL-state hook to MarketView** (F045 verifier correction). `/market` is statically prerendered and `app/market/page.tsx` renders `<MarketView>` with no Suspense boundary: `useSearchParams` there is a build error in Next 16, and adding a Suspense boundary would ship the ~300-row table as a fallback in the static HTML (the F012/F025 defect) and `router.replace` per keystroke is F016. URL state for `/market` is out of scope.
- **Do not remove the `tableBody` useMemo or the `useDeferredValue` search.** The comment at `MarketView.tsx:445-450` explains it: the urgent keystroke render must reuse the same element objects so React bails out of the body. `memo` rows do not replace that; they only stop per-row work when the body is rebuilt.
- **Do not build rows with a fresh object per render and rely on `memo` anyway.** `memo` compares `row` by reference; `buildMarketRows` alone returns new objects for every product on every history change, which makes `memo` useless. Use `createMarketRowsBuilder` (step 2).
- **Do not hold the row cache in `useRef` and read it during render**, and do not create the builder with `useMemo(() => createMarketRowsBuilder(), [])`. The first trips `react-hooks/refs` (lint blocks CI since WP17); the second is allowed to be thrown away by React. Use `useState(createMarketRowsBuilder)`.
- **Do not deep-compare history arrays** to decide row reuse. Reference equality is correct because `useProductData` replaces only the loaded product's array; a deep compare costs more than the work it saves.
- **Do not pass inline arrow functions or new objects as `MarketTableRow` props** (`onToggle={() => ...}`, `columns={MARKET_COLUMNS.filter(...)}`, a context object). Each would be a new reference per parent render and re-render all 306 rows. `toggleExpanded` is `useCallback`'d; `KEY_COLUMNS`/`ALL_COLUMNS` are module constants.
- **Do not move the `ensureHistoryLoaded` call out of `toggleExpanded`'s state updater "for purity".** It starts the load in the same render batch as the expansion; relying only on the effect at `:348-352` would paint one frame of "Price history not available yet." before "Loading price history...". Leave `toggleExpanded` and that effect exactly as they are.
- **Do not subscribe each row to the loading store with `useIsHistoryLoading`.** The plan keeps `MarketTableRow` a pure function of props (`isLoading` boolean derived from the Set), which keeps it testable without a store; the Set rebuild costs microseconds.
- **Do not add a `MarketViewSettingsContext` or change `ProductCard`/`ProductPrices`/`RecentlyReleased` props** (F045 item 4). The verifier warned an un-memoised provider value defeats `memo` for every card, and those files carry WP08/WP09 memo boundaries this package does not own. Item 4 is recorded as an open follow-up (Owner actions), not done here.
- **Do not force MarketView onto WP18's `components/SortableTable`** (F043, used by `/compare`). MarketView's columns need sticky classes, a render context, an expandable second row per product and a key/all split the compare tables do not have. Reuse only `compareSortValues`.
- **Do not change any maths, rounding, labels, column order, default sort (`release_date` desc) or copy.** This PR is behaviour-preserving; `buildRows.test.ts` (WP17) and `app/lib/__tests__/marketMath.test.ts` (WP18) must pass unchanged. In particular do not annualise or de-annualise volatility here (F005 is WP18's), and do not edit `lib/marketMath.ts` at all.
- **Do not replace `dailyPrices.slice(-30)` with `toDailyPoints(history, 30)` for both metrics.** `maxPoints` would also cut the drawdown series to 30 days and change every Max DD value; drawdown uses the full series, only volatility uses the newest 30 points.
- **Do not drop or re-offset the sticky `#` column on phones** (F125 "consider" item). It is a UX choice, not a proven performance fix: the scroll/compositing cost of the 612 sticky cells was not measured on a device and is speculative. It changes the phone layout and the plan owner did not ask for it; leave both sticky columns as they are.
- **Do not treat a `memo` row as the whole F125 fix.** Measured: `memo(MarketTableRow)` alone cuts the Show/Hide tap from about 45 ms to 2 ms, but the history-arrival commit stays at 90 to 120 ms unless row objects for unchanged products keep their identity. Steps 2 and 5d (`createMarketRowsBuilder` in `useState`) are mandatory, not an optimisation on top.
- **Do not use `getDefaultSortDirection(key: string)` with a `SortKey` cast.** The verifier asked for the parameter to be typed as `SortKey`; putting `defaultDirection` on the column descriptor gives the same guarantee without making the shared sorting module depend on a MarketView type.
- **Do not put shared test fixtures in a non-test file under `__tests__/`.** Jest's default `testMatch` treats every file in `__tests__` as a suite and fails one with no tests. Inline the small `makeProduct`/`makeRow` helpers per file as shown.
- **Do not use `require()` inside `jest.mock` factories** (`@typescript-eslint/no-require-imports` is an error). Return a named function component that uses JSX, as shown.

## Tests

All files under `frontend/app/components/MarketView/__tests__/`. Default jsdom environment; no `@jest-environment` docblock needed. Write each new file exactly as below. All four were type-checked and linted clean (`tsc --noEmit`, `eslint app/components/MarketView`) in a copy of review HEAD plus WP17 step 13, WP18's `lib/marketMath.ts`, `lib/sorting.ts` and step 4 `buildRows.ts` edits (with a stand-in `lib/format.ts` exposing WP07's signatures), and steps 1 to 6 of this spec. Earlier versions of these files passed under jest (47 MarketView tests); the WP18-specific cases (the "Vol 30D (ann.)" label, the drawdown/volatility equivalence block) were type-checked but not run, and the F125 render-count case in `MarketView.table.test.tsx` was added after that check and has not been run. If the render-count case sees extra calls only from a mount-time update (for example a second settle of volume metrics or the exchange rate), add one more `await act(async () => { await Promise.resolve(); });` before `mockProductImage.mockClear()`; if it sees other products' names after the click, the wiring is wrong (step 5), not the test. The equivalence block must pass as written: if it fails, step 1 does not match WP18's helpers, so fix step 1, not the test. If the label case fails, the header text in the current `MarketView.tsx` before this PR is the truth: fix the descriptor if it was copied wrong, or the test if the label really changed upstream.

### New: `columns.test.ts`

Covers: key view ids in order (10); all view ids in order (19); every label (WP18's "Vol 30D (ann.)"; if a later edit in the current file changed another label, assert the current label); unique ids; the default directions moved from `sorting.test.ts` (asc for product, set, days_since_release, max_drawdown, volatility_30d; desc for the other 11); exactly 16 sortable columns; `sortMarketRows` sinks a missing price in both directions, sorts the product column by lower-cased type label plus variant, keeps input order on ties, does not mutate its input and returns the same row objects.

```ts
import {
  ALL_COLUMNS,
  getSortColumn,
  KEY_COLUMNS,
  MARKET_COLUMNS,
  sortMarketRows,
  type SortKey,
} from "../columns";
import { buildMarketRow, type MarketRow } from "../buildRows";
import type { Product } from "../../ProductPrices/types";

jest.mock("../../ProductPrices/shared/ProductImage", () => ({ __esModule: true, default: () => null }));
jest.mock("../MiniSparkline", () => ({ __esModule: true, default: () => null }));

const TODAY_UTC_MS = Date.UTC(2026, 8, 25);
const identity = (usd: number) => usd;

function makeRow(id: number, overrides: Partial<Product> = {}): MarketRow {
  const product: Product = {
    id,
    usd_price: 100 + id,
    url: `https://example.test/p/${id}`,
    last_updated: "2026-09-25T00:00:00Z",
    price_recorded_at: "2026-09-25T00:00:00Z",
    sets: { name: `Set ${id}`, code: `S${id}`, release_date: "2026-01-01" },
    product_types: { id: 1, name: "booster_box", label: "Booster Box" },
    returns: null,
    ...overrides,
  };
  return buildMarketRow(product, undefined, undefined, identity, TODAY_UTC_MS);
}

const ids = (columns: readonly { id: string }[]) => columns.map((c) => c.id);

describe("market column table", () => {
  it("keeps the key-column view in the order and count the table had (10)", () => {
    expect(ids(KEY_COLUMNS)).toEqual([
      "rank", "product", "set", "price",
      "return_7d", "return_1m", "return_3m",
      "vol_30d", "vol_trend", "chart",
    ]);
  });

  it("keeps the all-columns view in the order and count the table had (19)", () => {
    expect(ids(ALL_COLUMNS)).toEqual([
      "rank", "product", "set", "price",
      "release_date", "days_since_release", "price_per_day",
      "cagr", "max_drawdown", "volatility_30d",
      "return_7d", "return_1m", "return_3m", "return_6m", "return_1y",
      "vol_30d", "vol_trend", "sparkline", "chart",
    ]);
  });

  it("keeps the header labels", () => {
    expect(MARKET_COLUMNS.map((c) => c.label)).toEqual([
      "#", "Product", "Set", "Price", "Release", "Days Since", "Price/Day",
      "CAGR", "Max DD", "Vol 30D (ann.)", "7D", "1M", "3M", "6M", "1Y",
      "Vol (30d)", "Vol Δ", "Last 7D", "Chart",
    ]);
  });

  it("has unique ids", () => {
    expect(new Set(ids(MARKET_COLUMNS)).size).toBe(MARKET_COLUMNS.length);
  });

  it("opens name-like and lower-is-better columns ascending (was getDefaultSortDirection)", () => {
    const asc: SortKey[] = ["product", "set", "days_since_release", "max_drawdown", "volatility_30d"];
    for (const key of asc) expect(getSortColumn(key).defaultDirection).toBe("asc");
    const desc: SortKey[] = [
      "price", "release_date", "price_per_day", "cagr",
      "return_7d", "return_1m", "return_3m", "return_6m", "return_1y",
      "vol_30d", "vol_trend",
    ];
    for (const key of desc) expect(getSortColumn(key).defaultDirection).toBe("desc");
  });

  it("exposes exactly 16 sort keys, one per former switch case", () => {
    expect(MARKET_COLUMNS.filter((c) => c.sortable)).toHaveLength(16);
  });
});

describe("sortMarketRows", () => {
  const cheap = makeRow(1, { usd_price: 50 });
  const dear = makeRow(2, { usd_price: 300 });
  const unpriced = makeRow(3, { usd_price: null });

  it("sorts by price in both directions and sinks the missing price", () => {
    const rows = [unpriced, cheap, dear];
    expect(sortMarketRows(rows, "price", "desc").map((r) => r.product.id)).toEqual([2, 1, 3]);
    expect(sortMarketRows(rows, "price", "asc").map((r) => r.product.id)).toEqual([1, 2, 3]);
  });

  it("sorts the product column by type label plus variant, case-insensitively", () => {
    const a = makeRow(4, { product_types: { id: 1, name: "etb", label: "elite Trainer Box" } });
    const b = makeRow(5, { product_types: { id: 2, name: "bb", label: "Booster Box" }, variant: "Pokemon Center" });
    const c = makeRow(6, { product_types: { id: 2, name: "bb", label: "Booster Box" } });
    expect(sortMarketRows([a, b, c], "product", "asc").map((r) => r.product.id)).toEqual([6, 5, 4]);
  });

  it("keeps input order for ties and does not mutate the input", () => {
    const x = makeRow(7, { usd_price: 10 });
    const y = makeRow(8, { usd_price: 10 });
    const input: MarketRow[] = [x, y];
    expect(sortMarketRows(input, "price", "desc")).toEqual([x, y]);
    expect(input).toEqual([x, y]);
  });

  it("returns the same row objects (identity matters for memo rows)", () => {
    const sorted = sortMarketRows([cheap, dear], "price", "desc");
    expect(sorted[0]).toBe(dear);
    expect(sorted[1]).toBe(cheap);
  });
});
```

### New: `buildRows.reuse.test.ts`

Covers `createMarketRowsBuilder` (first call matches `buildMarketRows`; a row whose inputs did not change is the same object after another product's history lands; a new `convertPrice`, a new UTC day, a new product object or a new volume entry rebuilds the row; a product filtered out and back in gets its cached row back) and step 1 (drawdown and volatility from the one daily series equal WP18's history-based helpers exactly, including past the 30-point lookback).

```ts
import { buildMarketRow, createMarketRowsBuilder } from "../buildRows";
import { getMaxDrawdownPercent, getVolatilityPercent } from "../../../lib/marketMath";
import type { PriceHistoryEntry, Product } from "../../ProductPrices/types";

// The volume type buildMarketRow accepts, whatever WP11 named it.
type Volume = NonNullable<Parameters<typeof buildMarketRow>[2]>;

const TODAY_UTC_MS = Date.UTC(2026, 8, 25);
const identity = (usd: number) => usd;

function makeProduct(id: number): Product {
  return {
    id,
    usd_price: 100 + id,
    url: `https://example.test/p/${id}`,
    last_updated: "2026-09-25T00:00:00Z",
    price_recorded_at: "2026-09-25T00:00:00Z",
    sets: { name: `Set ${id}`, code: `S${id}`, release_date: "2026-01-01" },
    product_types: { id: 1, name: "booster_box", label: "Booster Box" },
    returns: null,
  };
}

function makeHistory(prices: number[]): PriceHistoryEntry[] {
  return prices.map((usd_price, index) => ({
    usd_price,
    recorded_at: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
  }));
}

const p1 = makeProduct(1);
const p2 = makeProduct(2);
const h1 = makeHistory([100, 110, 90, 120]);
const h2 = makeHistory([50, 55, 60]);
const NO_VOLUME: Record<number, Volume> = {};

describe("createMarketRowsBuilder", () => {
  it("returns the same rows as buildMarketRows on first call", () => {
    const build = createMarketRowsBuilder();
    const rows = build([p1, p2], { 1: h1 }, NO_VOLUME, identity, TODAY_UTC_MS);
    expect(rows.map((r) => r.product)).toEqual([p1, p2]);
    expect(rows[0].history).toBe(h1);
    expect(rows[1].history).toBeUndefined();
  });

  it("reuses a row object when none of its inputs changed", () => {
    const build = createMarketRowsBuilder();
    const first = build([p1, p2], { 1: h1 }, NO_VOLUME, identity, TODAY_UTC_MS);
    // History loads for product 2 only: new priceHistory object, same h1 array.
    const second = build([p1, p2], { 1: h1, 2: h2 }, NO_VOLUME, identity, TODAY_UTC_MS);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect(second[1].history).toBe(h2);
    expect(second[1].maxDrawdown).toBe(0);
  });

  it("rebuilds every row when convertPrice changes (currency toggle)", () => {
    const build = createMarketRowsBuilder();
    const first = build([p1, p2], { 1: h1 }, NO_VOLUME, identity, TODAY_UTC_MS);
    const toCad = (usd: number) => usd * 1.5;
    const second = build([p1, p2], { 1: h1 }, NO_VOLUME, toCad, TODAY_UTC_MS);
    expect(second[0]).not.toBe(first[0]);
    expect(second[0].price).toBeCloseTo(first[0].price! * 1.5);
  });

  it("rebuilds when the UTC day, the product object or its volume entry changes", () => {
    const build = createMarketRowsBuilder();
    const first = build([p1], { 1: h1 }, NO_VOLUME, identity, TODAY_UTC_MS);
    expect(build([p1], { 1: h1 }, NO_VOLUME, identity, TODAY_UTC_MS + 86_400_000)[0]).not.toBe(first[0]);

    const build2 = createMarketRowsBuilder();
    const a = build2([p1], { 1: h1 }, NO_VOLUME, identity, TODAY_UTC_MS);
    expect(build2([{ ...p1 }], { 1: h1 }, NO_VOLUME, identity, TODAY_UTC_MS)[0]).not.toBe(a[0]);

    const build3 = createMarketRowsBuilder();
    const b = build3([p1], { 1: h1 }, NO_VOLUME, identity, TODAY_UTC_MS);
    const volume = { 1: { product_id: 1, units_sold_30d: 5, units_sold_prior_30d: 4 } as Volume };
    const c = build3([p1], { 1: h1 }, volume, identity, TODAY_UTC_MS);
    expect(c[0]).not.toBe(b[0]);
    expect(c[0].unitsSold30d).toBe(5);
  });

  it("keeps cached rows for products filtered out and back in", () => {
    const build = createMarketRowsBuilder();
    const all = build([p1, p2], { 1: h1 }, NO_VOLUME, identity, TODAY_UTC_MS);
    build([p2], { 1: h1 }, NO_VOLUME, identity, TODAY_UTC_MS); // search hides p1
    const again = build([p1, p2], { 1: h1 }, NO_VOLUME, identity, TODAY_UTC_MS);
    expect(again[0]).toBe(all[0]);
  });
});

describe("buildMarketRow drawdown and volatility (one daily series, F125)", () => {
  // One reading per UTC day from 2026-07-01, so more than 30 days is valid.
  function makeDailyHistory(prices: number[]): PriceHistoryEntry[] {
    return prices.map((usd_price, index) => ({
      usd_price,
      recorded_at: new Date(Date.UTC(2026, 6, 1) + index * 86_400_000).toISOString(),
    }));
  }

  it("matches the history-based helpers exactly (short series)", () => {
    const history = makeDailyHistory([100, 120, 80, 90, 95, 70, 110]);
    const row = buildMarketRow(p1, history, undefined, identity, TODAY_UTC_MS);
    expect(row.maxDrawdown).not.toBeNull();
    expect(row.volatility30d).not.toBeNull();
    expect(row.maxDrawdown).toBe(getMaxDrawdownPercent(history));
    expect(row.volatility30d).toBe(
      getVolatilityPercent(history, { lookbackPoints: 30, unit: "annualised" })
    );
  });

  it("matches them exactly past the 30-point volatility lookback", () => {
    const prices = Array.from({ length: 45 }, (_, i) => 100 + ((i * 37) % 23) - (i === 10 ? 40 : 0));
    const history = makeDailyHistory(prices);
    const row = buildMarketRow(p1, history, undefined, identity, TODAY_UTC_MS);
    expect(row.maxDrawdown).toBe(getMaxDrawdownPercent(history));
    expect(row.volatility30d).toBe(
      getVolatilityPercent(history, { lookbackPoints: 30, unit: "annualised" })
    );
  });

  it("is null for both when there is no history", () => {
    const row = buildMarketRow(p1, undefined, undefined, identity, TODAY_UTC_MS);
    expect(row.maxDrawdown).toBeNull();
    expect(row.volatility30d).toBeNull();
  });
});
```

### New: `MarketTableRow.test.tsx`

Renders rows inside `<table><tbody>` with a probe column passed as `columns` (the row renders cells only through `columns`, so a probe's `render` counts real renders). Covers: one row's `isLoading` change re-renders exactly that row; replacing one row object re-renders exactly that row; an identical parent re-render re-renders no row; the expanded row's `td` spans `columns.length` and shows the loading and empty messages; `ctx.onToggle` calls `onToggle` with the row's product id.

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import MarketTableRow from "../MarketTableRow";
import { buildMarketRow, type MarketRow } from "../buildRows";
import type { MarketTableColumn } from "../columns";
import type { PriceHistoryEntry, Product } from "../../ProductPrices/types";

// The expanded row loads PriceChart through next/dynamic; stub the bundle so
// jsdom never imports Recharts.
jest.mock("../../charts/ChartBundle", () => ({
  PriceChart: function MockPriceChart() {
    return <div data-testid="price-chart" />;
  },
}));

const TODAY_UTC_MS = Date.UTC(2026, 8, 25);
const identity = (usd: number) => usd;
const formatPrice = (usd: number | null | undefined) => (usd == null ? "--" : `$${usd.toFixed(2)}`);
const onToggle = jest.fn();

const mockProbe = jest.fn();
// A probe column: records every time a row actually renders its cells.
const PROBE_COLUMNS: readonly MarketTableColumn[] = [
  {
    id: "probe",
    label: "Probe",
    keyColumn: true,
    sortable: false,
    headerClassName: "",
    cellClassName: "",
    render: (row, ctx) => {
      mockProbe(row.product.id);
      return `${row.product.id}:${ctx.rank}:${ctx.isLoading ? "loading" : "idle"}`;
    },
  },
];

function makeRow(id: number, history?: PriceHistoryEntry[]): MarketRow {
  const product: Product = {
    id,
    usd_price: 100,
    url: `https://example.test/p/${id}`,
    last_updated: "2026-09-25T00:00:00Z",
    price_recorded_at: "2026-09-25T00:00:00Z",
    sets: { name: `Set ${id}`, code: `S${id}`, release_date: "2026-01-01" },
    product_types: { id: 1, name: "booster_box", label: "Booster Box" },
    returns: null,
  };
  return buildMarketRow(product, history, undefined, identity, TODAY_UTC_MS);
}

const ROWS = [makeRow(1), makeRow(2), makeRow(3)];

function Table({
  rows = ROWS,
  loadingId = null,
  expandedId = null,
}: {
  rows?: MarketRow[];
  loadingId?: number | null;
  expandedId?: number | null;
}) {
  return (
    <table>
      <tbody>
        {rows.map((row, index) => (
          <MarketTableRow
            key={row.product.id}
            row={row}
            rank={index + 1}
            columns={PROBE_COLUMNS}
            isExpanded={expandedId === row.product.id}
            isLoading={loadingId === row.product.id}
            chartTimeframe="1Y"
            currency="USD"
            exchangeRate={1.36}
            formatPrice={formatPrice}
            onToggle={onToggle}
          />
        ))}
      </tbody>
    </table>
  );
}

beforeEach(() => {
  mockProbe.mockClear();
  onToggle.mockClear();
});

describe("MarketTableRow memoisation (F125)", () => {
  it("re-renders only the row whose loading flag changed", () => {
    const { rerender } = render(<Table />);
    expect(mockProbe).toHaveBeenCalledTimes(3);
    mockProbe.mockClear();

    rerender(<Table loadingId={2} />);
    expect(mockProbe).toHaveBeenCalledTimes(1);
    expect(mockProbe).toHaveBeenCalledWith(2);
    expect(screen.getByText("2:2:loading")).toBeInTheDocument();
  });

  it("re-renders only the row whose row object changed (history landed)", () => {
    const { rerender } = render(<Table />);
    mockProbe.mockClear();

    const withHistory = [ROWS[0], makeRow(2, [
      { usd_price: 90, recorded_at: "2026-09-01T00:00:00Z" },
      { usd_price: 100, recorded_at: "2026-09-02T00:00:00Z" },
    ]), ROWS[2]];
    rerender(<Table rows={withHistory} />);
    expect(mockProbe).toHaveBeenCalledTimes(1);
    expect(mockProbe).toHaveBeenCalledWith(2);
  });

  it("re-renders nothing when the parent re-renders with identical props", () => {
    const { rerender } = render(<Table />);
    mockProbe.mockClear();
    rerender(<Table />);
    expect(mockProbe).not.toHaveBeenCalled();
  });
});

describe("MarketTableRow expanded row", () => {
  it("spans every visible column and shows the loading message while loading", () => {
    render(<Table expandedId={1} loadingId={1} />);
    const cell = screen.getByText("Loading price history...").closest("td");
    expect(cell).toHaveAttribute("colspan", String(PROBE_COLUMNS.length));
  });

  it("shows the empty message when there is no usable history", () => {
    render(<Table expandedId={3} />);
    expect(screen.getByText("Price history not available yet.")).toBeInTheDocument();
  });

  it("passes a toggle bound to the row's product id to its cells", () => {
    const toggleColumns: readonly MarketTableColumn[] = [
      {
        id: "chart",
        label: "Chart",
        keyColumn: true,
        sortable: false,
        headerClassName: "",
        cellClassName: "",
        render: (_row, ctx) => (
          <button type="button" onClick={ctx.onToggle}>
            toggle
          </button>
        ),
      },
    ];
    render(
      <table>
        <tbody>
          <MarketTableRow
            row={ROWS[1]}
            rank={2}
            columns={toggleColumns}
            isExpanded={false}
            isLoading={false}
            chartTimeframe="1Y"
            currency="USD"
            exchangeRate={1.36}
            formatPrice={formatPrice}
            onToggle={onToggle}
          />
        </tbody>
      </table>
    );
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(onToggle).toHaveBeenCalledWith(2);
  });
});
```

### New: `MarketView.table.test.tsx`

Renders the real `MarketView`. Covers: 10 `columnheader`s, 19 after "Show all columns"; default order newest release first; "Price" opens descending with `aria-sort="descending"` and flips to ascending; "Set" opens ascending; "Show" loads history once, shows the chart in a `td` with `colspan="10"`, "Hide" removes it. F125 integration check: across the expand tap, the history arrival and the collapse, only the toggled row re-renders (counted through the `ProductImage` mock). This is the one test that fails if any `MarketTableRow` prop is unstable in the real wiring (an inline arrow, a new `columns` array, a row builder that returns new objects); if it fails, fix the wiring in step 5, never the assertion.

```tsx
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";

// Same mock block as WP13's MarketView.emptyState.test.tsx. If that file has
// grown extra mocks since (WP09/WP12/WP15), copy them here too. The
// CardRinkPromo mock is harmless after WP15 removed the import.
jest.mock("../../../lib/clientMarketData", () => ({
  fetchMarketProductsClient: jest.fn().mockResolvedValue([]),
  fetchProductHistoryClient: jest.fn().mockResolvedValue([]),
  fetchVolumeMetrics: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../../lib/exchangeRate", () => ({
  fetchLatestExchangeRateClient: jest.fn().mockResolvedValue({ rate: 1.36, date: null }),
}));
jest.mock("../MiniSparkline", () => ({ __esModule: true, default: () => null }));
// Every row renders exactly one ProductImage (Product column), so counting
// its calls counts real MarketTableRow renders (F125 regression check).
const mockProductImage = jest.fn();
jest.mock("../../ProductPrices/shared/ProductImage", () => ({
  __esModule: true,
  default: function MockProductImage(props: { productName: string }) {
    mockProductImage(props.productName);
    return null;
  },
}));
jest.mock("../../CardRinkPromo", () => ({ __esModule: true, default: () => null }));
jest.mock("../../charts/ChartBundle", () => ({
  PriceChart: function MockPriceChart() {
    return <div data-testid="price-chart" />;
  },
}));

import MarketView from "../MarketView";
import { fetchProductHistoryClient } from "../../../lib/clientMarketData";
import type { Product } from "../../ProductPrices/types";

const fetchHistoryMock = fetchProductHistoryClient as jest.MockedFunction<
  typeof fetchProductHistoryClient
>;

function makeProduct(id: number, usdPrice: number, releaseDate: string): Product {
  return {
    id,
    usd_price: usdPrice,
    url: `https://example.test/p/${id}`,
    last_updated: "2026-09-25T00:00:00Z",
    price_recorded_at: new Date().toISOString(),
    sets: { name: `Set ${id}`, code: `S${id}`, release_date: releaseDate },
    product_types: { id: 1, name: "booster_box", label: `Type ${id}` },
    returns: null,
  };
}

const PRODUCTS = [
  makeProduct(1, 50, "2025-01-01"),
  makeProduct(2, 300, "2026-01-01"),
  makeProduct(3, 120, "2024-01-01"),
];

function renderView() {
  return render(
    <MarketView initialProducts={PRODUCTS} initialExchangeRate={1.36} initialVolumeMetrics={{}} />
  );
}

/** The set name of each body row, top to bottom ("Set 2", ...). */
function rowOrder() {
  const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
  return rows.map((row) => within(row).getAllByRole("cell")[2].textContent?.slice(0, 5));
}

beforeEach(() => jest.clearAllMocks());

describe("MarketView table", () => {
  it("renders the 10 key columns, and 19 after 'Show all columns'", () => {
    renderView();
    expect(screen.getAllByRole("columnheader")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Show all columns" }));
    expect(screen.getAllByRole("columnheader")).toHaveLength(19);
  });

  it("defaults to newest release first", () => {
    renderView();
    expect(rowOrder()).toEqual(["Set 2", "Set 1", "Set 3"]);
  });

  it("sorts by price descending on first click and ascending on the second", () => {
    renderView();
    const priceButton = screen.getByRole("button", { name: /^Price/ });
    fireEvent.click(priceButton);
    expect(screen.getByRole("columnheader", { name: /Price/ })).toHaveAttribute("aria-sort", "descending");
    expect(rowOrder()).toEqual(["Set 2", "Set 3", "Set 1"]);
    fireEvent.click(priceButton);
    expect(screen.getByRole("columnheader", { name: /Price/ })).toHaveAttribute("aria-sort", "ascending");
    expect(rowOrder()).toEqual(["Set 1", "Set 3", "Set 2"]);
  });

  it("opens the Set column ascending on first click", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /^Set/ }));
    expect(rowOrder()).toEqual(["Set 1", "Set 2", "Set 3"]);
  });

  it("expands a row, loads its history once, and collapses it again", async () => {
    fetchHistoryMock.mockResolvedValue([
      { usd_price: 90, recorded_at: "2026-09-01T00:00:00Z" },
      { usd_price: 100, recorded_at: "2026-09-02T00:00:00Z" },
    ]);
    renderView();
    const [firstShow] = screen.getAllByRole("button", { name: "Show" });
    await act(async () => {
      fireEvent.click(firstShow);
    });
    expect(await screen.findByTestId("price-chart")).toBeInTheDocument();
    expect(fetchHistoryMock).toHaveBeenCalledTimes(1);
    const expandedCell = screen.getByTestId("price-chart").closest("td");
    expect(expandedCell).toHaveAttribute("colspan", "10");
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByTestId("price-chart")).not.toBeInTheDocument();
  });

  it("re-renders only the toggled row on expand, history arrival and collapse (F125)", async () => {
    fetchHistoryMock.mockResolvedValue([
      { usd_price: 90, recorded_at: "2026-09-01T00:00:00Z" },
      { usd_price: 100, recorded_at: "2026-09-02T00:00:00Z" },
    ]);
    renderView();
    // Let mount effects settle (volume metrics, exchange rate) before counting.
    await act(async () => {
      await Promise.resolve();
    });
    mockProductImage.mockClear();

    // Default sort is newest release first, so the first "Show" is product 2.
    const [firstShow] = screen.getAllByRole("button", { name: "Show" });
    await act(async () => {
      fireEvent.click(firstShow);
    });
    await screen.findByTestId("price-chart");
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));

    // Before this PR every commit re-rendered all 3 rows ("Set 1 Type 1" and
    // "Set 3 Type 3" would appear here too).
    expect(mockProductImage).toHaveBeenCalled();
    expect(new Set(mockProductImage.mock.calls.map(([name]) => name))).toEqual(
      new Set(["Set 2 Type 2"])
    );
  });
});
```

If `MarketView.emptyState.test.tsx` (WP13) mocks more modules than this file's block, add the same mocks here. If WP09's history batching means `fetchProductHistoryClient` is no longer what `ensureHistoryLoaded` calls, mock whatever `useProductData` now calls (read the hook) and assert on that instead. If this file cannot be made to render in jsdom within about 30 minutes, keep the other three new files, cover `/market` with manual checks 1 to 3, and say so in the PR (same escape hatch WP13 used).

### Update: `sorting.test.ts`

Step 6b: delete the `getDefaultSortDirection` describe block and its import name. Every `compareSortValues`/`isMissingSortValue` case, including WP18's "compareSortValues with a string comparator" block, stays unchanged.

### Must pass unchanged

`buildRows.test.ts` (WP17, as updated by WP18), `app/lib/__tests__/marketMath.test.ts` (WP18), `useProductData.test.tsx`, `MarketView.emptyState.test.tsx` (WP13), `MiniSparkline*.test.tsx` (WP09), and every other suite.

## Verification

From `frontend/`:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit                                   # exit 0
pnpm exec eslint app/components/MarketView            # 0 problems
pnpm test --ci app/components/MarketView                 # all suites pass, including the 4 new files
pnpm test --ci                                           # full suite green
pnpm run lint                                            # 0 errors (CI blocks on this since WP17)
pnpm build:stub                                          # exit 0 (do not run while another agent builds in this checkout)
```

In the `pnpm build:stub` route table, `/market` must show the same rendering symbol and revalidate value as on the base branch (`master`) before this PR (static/ISR, not `ƒ Dynamic`), and the build log must have no "useSearchParams() should be wrapped in a suspense boundary" error.

Greps that must hold:

```bash
grep -n 'switch (key)\|visibleColumnCount\|showAllColumns ? 19 : 10\|Fragment\|next/dynamic' app/components/MarketView/MarketView.tsx   # no output
grep -rn 'useSearchParams\|useRouter\|next/navigation' app/components/MarketView                              # no output
grep -c 'toDailyPoints(' app/components/MarketView/buildRows.ts                                              # 1
grep -n 'getMaxDrawdownPercent\|getVolatilityPercent' app/components/MarketView/buildRows.ts                  # no output
grep -rn 'getDefaultSortDirection' app                                                                       # no output
grep -n '^import' app/components/MarketView/sorting.ts                                                       # no output (re-export only)
grep -rn 'MarketView/returns\|from "./returns"' app                                                          # no output (WP18 deleted it; nothing re-adds it)
git diff --stat "$(git merge-base HEAD origin/master)" -- app/lib/marketMath.ts "app/product/[id]/page.tsx"   # no output (untouched)
grep -n 'export default memo(MarketTableRow)' app/components/MarketView/MarketTableRow.tsx                   # 1 hit
wc -l app/components/MarketView/MarketView.tsx                                                               # well under 862 (about 330-380)
```

Manual checks (on the Vercel preview for this PR, which has real data; the local stub build has an empty catalog):

1. Open `/market`. The table looks identical to production: same 10 columns in the same order, newest release first, same row numbers, same colours. Click "Show all columns": 19 columns, same order as production. Toggle back.
2. Click every sortable header once and again: first click direction matches production (Product, Set, Days Since, Max DD, Vol 30D (ann.) ascending; the rest descending); "--" values stay at the bottom in both directions; the sorted header shows ` v`/` ^`. Hovering "Vol 30D (ann.)" shows WP18's annualised-volatility tooltip; its cells show an unsigned slate value, not green/red.
3. Click "Show" on a row: "Loading price history..." then the chart; "Hide" collapses it. Expand a second row: the first collapses. Switch USD/CAD with a row open: prices and the chart update.
4. Type in the search box quickly: characters never lag; the count updates; clear it. Pick an age filter and a generation: rows filter as before. A search with no match shows the WP13 "No products match" panel.
5. Render check (the F125 fix): open React DevTools, Profiler, enable "Highlight updates when components render", record, click "Show" on one row, wait for the chart, click "Hide", stop. Correct: each of the three commits (tap, history arrival, collapse) renders one or two `MarketTableRow`s (the toggled row, plus the previously expanded row on expansion), not ~306, and each commit is a few ms on desktop. Before this PR (production), the same recording shows the whole table flashing and roughly 40 to 60 ms per tap commit on desktop. Put the before/after commit durations in the PR body.
6. View source (or `curl -s <preview>/market | grep -c '<tr'`): the server HTML still contains the table rows (the page did not bail out to client rendering).

## Owner actions

- No migrations, env vars or dashboard changes.
- If Vercel preview protection stops the executor from opening the preview with real data, the owner performs manual checks 1 to 6 on the preview and replies on the PR with the result.
- F045 item (4) (the 11 `ProductCard` props threaded through three `/prices` call sites and `RecentlyReleased`) is not done by this package or by WP20. After merging, the owner decides whether to open a follow-up for it (the verifier's lower-risk option is a single memoised `cardSettings` object prop rather than a context). Until then F045 stays partially open for `/prices` in the tracker.

## Acceptance criteria

- [ ] `app/components/MarketView/columns.tsx` exists; `SortKey` is derived from `MARKET_COLUMNS` (no hand-written union); header cells, body cells, sort accessors, default directions and the column count all come from it.
- [ ] `MarketView.tsx` contains no `switch (key)`, no `visibleColumnCount`, no `19 : 10`, no per-cell JSX, no `Fragment`, no `next/dynamic`, and no `useSearchParams`/`useRouter`.
- [ ] `MarketTableRow.tsx` default-exports `memo(MarketTableRow)`; MarketView passes it only primitives and stable references.
- [ ] `createMarketRowsBuilder` exists in `buildRows.ts` and MarketView creates it with `useState(createMarketRowsBuilder)`.
- [ ] `MarketView.table.test.tsx` includes the F125 render-count test and it passes (only the toggled row re-renders across expand, history arrival and collapse).
- [ ] `buildMarketRow` calls `toDailyPoints` exactly once (or step 1 was reverted under its documented escape hatch and the PR says so) and derives drawdown (`maxDrawdownPercent`) and 30-point annualised volatility (`volatilityPercent`) from that series, with values identical to WP18's `getMaxDrawdownPercent`/`getVolatilityPercent`; `lib/marketMath.ts` and `/product/[id]` are unchanged.
- [ ] `getDefaultSortDirection` is removed; `MarketView/sorting.ts` is only the re-export of `lib/sorting.ts`.
- [ ] The volatility column keeps WP18's label "Vol 30D (ann.)", its `title` and `renderVolatilityValue`.
- [ ] New tests `columns.test.ts`, `buildRows.reuse.test.ts`, `MarketTableRow.test.tsx`, `MarketView.table.test.tsx` pass (or the last is replaced by the documented manual check); `buildRows.test.ts`, `app/lib/__tests__/marketMath.test.ts` and `sorting.test.ts` (minus the moved block) pass unchanged.
- [ ] `pnpm exec tsc --noEmit`, `pnpm run lint`, `pnpm test --ci` and `pnpm build:stub` exit 0; `/market` keeps its static/ISR status.
- [ ] On the preview, `/market` looks and sorts exactly as production, and the Profiler shows one or two row renders per expand, history-arrival and collapse commit.

## Rollback

Code only; no migrations, env vars or data. Revert the PR's merge commit (`git revert -m 1 <merge-sha>`) and redeploy. The revert restores the inline table, the switch, `getDefaultSortDirection` and its tests, and the two-pass drawdown/volatility calls in `buildRows.ts` together; `createMarketRowsBuilder`, `columns.tsx` and `MarketTableRow.tsx` disappear with it, and nothing outside `app/components/MarketView/` imports them (verify with `grep -rn "createMarketRowsBuilder\|MarketTableRow\|MarketView/columns" app | grep -v "app/components/MarketView/"` before reverting if later PRs have landed; it must print nothing). Partial rollback is not supported: `MarketView.tsx`, `columns.tsx` and `MarketTableRow.tsx` change together.

## Commit and PR

Commit message:

```
refactor(market): drive the table from a column list; memoise rows

- columns.tsx: one descriptor per column (header, cell, sort accessor,
  default direction); SortKey, the visible-column count and colSpan are
  derived from it. Replaces the 16-case sort switch and 16 hand-written
  <th>s (F045).
- MarketTableRow: memo() row fed stable row objects from
  createMarketRowsBuilder, so an expand, history load or collapse
  re-renders one row instead of ~306 (F125).
- buildMarketRow builds the daily series once and derives drawdown and
  volatility from it with lib/marketMath's series functions (was two
  toDailyPoints passes per product); cleanup only, numbers unchanged.
- getDefaultSortDirection folded into the column descriptors.
- /market stays statically rendered: no URL state added.
```

PR title: `refactor(market): column-driven table and memoised rows (WP19: F045, F125)`

PR body summary: link `audits/remediation/WP19-marketview-refactor.md`; list F045 (items 1 and 2 plus the verifier's additions done for `/market`, item 1 via WP17/WP18; item 3 deliberately not applied to `/market` per the verifier; item 4, the `ProductCard` prop threading on `/prices`, NOT done and listed as an open follow-up for the owner) and F125 (full; sticky `#` column intentionally unchanged); state that nothing user-visible changes; paste the "Before you start" grep output next to the Verification grep output; paste the `pnpm build:stub` route-table line for `/market`; attach a before/after React Profiler screenshot of one expand; note that `aria-sort` now follows the sorted column and header cells gained `scope="col"`.
