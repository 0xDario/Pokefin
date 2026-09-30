# WP19: MarketView decomposition and row memoisation

- **Findings covered**
  - F045 (full for `/market`): `MarketView.tsx` (862 lines at review) mixes row derivation, a 16-way sort `switch`, a hand-written 16-`<th>` header and a hand-maintained column count; adding one column touches 5 to 7 places and a missing `case` silently sorts as "missing". Its item (3) (URL state) is resolved for `/prices` by WP08 and is deliberately NOT applied to `/market` (verifier correction); its item (4) (ProductCard prop threading on `/prices`) is superseded by WP20's CurrencyContext (F051) and is not touched here.
  - F125 (full): every history fetch state change rebuilds all ~306 rows and their derived stats and reconciles every inline row; `toDailyPoints` runs twice per product. After this PR one product's loading/history change re-renders one `memo` row, and the daily series is built once per product.
- **Priority rationale**: last structural refactor of the heaviest client table; it lands after WP09 (loading store, SVG sparkline) and WP18 (shared market math) so it does not fight them, and it is low severity with no user-visible defect, so it comes late.
- **Effort**: M (5 to 7 hours, including tests).
- **Depends on**: WP09 (per-product loading store `useLoadingProductIds`, `MiniSparkline` without currency props), WP18 (market math consolidation; may have moved `returns.ts`/`sorting.ts`). Also assumes the in-order landing of WP07 (`lib/format.ts`), WP13 (`NoResults` in MarketView), WP14 (contrast classes), WP15 (promo removed from MarketView, link colour token) and WP17 (`MarketView/buildRows.ts` with `buildMarketRow`/`buildMarketRows` and tests, lint blocking in CI).
- **Unblocks**: nothing directly; WP20 (CurrencyContext) will touch `MarketView.tsx` props that this PR leaves in one place (`MarketTableRow` props).
- **Suggested branch name**: `remediation/wp19-marketview-refactor`
- **Risk level**: medium. Pure client refactor with no data or API change, but the file carries edits from six earlier packages that must be carried into the new modules exactly (class strings, formatters, copy); a mistake shows as a wrong column, not a crash.

## Why

`/market` renders a ~306-row table from one 862-line component. Sorting is a 16-case `switch` (`MarketView.tsx:366-401`) mirroring a `SortKey` union (`:70-86`), the header repeats the same button markup 16 times (`:695-853`), and the expanded row's `colSpan` comes from a hard-coded `showAllColumns ? 19 : 10` (`:244`), so adding a column means editing five places and a forgotten `case` compiles and silently sorts the column as empty. On the performance side, the whole `<tbody>` is one `useMemo` keyed on `loadingProductIds` and `priceHistory` (`:617-629`) with inline rows, so clicking "Show" on one product rebuilds and reconciles every row twice (loading on, then history plus loading off), and each rebuild recomputes drawdown and volatility with two separate `toDailyPoints` passes per product (`:322-323`, `returns.ts:90`, `:117`); phone users feel this as a sluggish expand. After this PR the table is driven by one column descriptor list (header, cells, sort accessor, default direction and column count all derive from it), rows are a `memo` component fed stable row objects, and an expand/collapse or history arrival re-renders only the affected row(s). Nothing visible changes: same columns, labels, order, default sort and behaviour.

## Before you start

Read these files fully, in their CURRENT state (line numbers below are from review HEAD `a188fea`; earlier packages have moved them):

- `frontend/app/components/MarketView/MarketView.tsx`
- `frontend/app/components/MarketView/buildRows.ts` (added by WP17 step 13) and `frontend/app/components/MarketView/__tests__/buildRows.test.ts`
- `frontend/app/components/MarketView/returns.ts` and `sorting.ts` (or wherever WP18 moved them), with their `__tests__`
- `frontend/app/components/MarketView/MiniSparkline.tsx` (WP09 rewrote it)
- `frontend/app/components/ProductPrices/hooks/useProductData.ts` and `frontend/app/components/ProductPrices/hooks/historyLoadingStore.ts` (WP09)
- `frontend/app/components/MarketView/__tests__/MarketView.emptyState.test.tsx` (WP13; its mock block is reused)
- `frontend/app/product/[id]/page.tsx:9-12,196-198` (second consumer of the drawdown/volatility helpers)
- `frontend/app/market/page.tsx` (renders `<MarketView>` with no Suspense boundary; must stay that way)
- `audits/remediation/WP17-lint-tests-observability-ci-gate.md` "Step 13" and `audits/remediation/WP09-prices-card-rendering.md` steps 2, 4d and 6c (what they put in this file)

Run from `frontend/` and record the output in the PR description:

```bash
wc -l app/components/MarketView/MarketView.tsx
grep -c '        case "' app/components/MarketView/MarketView.tsx      # expect 16 (the sort switch)
grep -n 'showAllColumns ? 19 : 10\|visibleColumnCount' app/components/MarketView/MarketView.tsx   # expect hits
grep -n 'Fragment key={product.id}' app/components/MarketView/MarketView.tsx                        # inline rows, expect 1
grep -rn 'useSearchParams\|useRouter\|next/navigation' app/components/MarketView                    # expect no output
ls app/components/MarketView/buildRows.ts                                                            # must exist (WP17)
grep -rn 'export function compareSortValues\|export function getDefaultSortDirection\|function toDailyPoints\|export function getMaxDrawdown\|export function getVolatility' app
grep -rn 'getDefaultSortDirection\|getMaxDrawdownPercent\|getVolatilityPercent\|toDailyPoints' app --include=*.ts --include=*.tsx | grep -v __tests__
grep -n 'useLoadingProductIds\|loadingProductIds\|historyLoadingStore' app/components/MarketView/MarketView.tsx
grep -n 'lib/format\|NoResults\|CardRinkPromo' app/components/MarketView/MarketView.tsx
```

Assumptions to check, and what to do if one is false:

1. **`buildRows.ts` exists** with `buildMarketRow(product, history, volume, convertPrice, todayUtcMs)`, `buildMarketRows(...)`, `MarketRow`, `RETURN_WINDOWS`, `DAY_MS`, `getReleaseMs`, `ReturnWindowLabel`. If it is missing, WP17 did not land its step 13: do that step first, exactly as written in the WP17 spec, as the first commit of this PR.
2. **Where the math lives.** At review HEAD `toDailyPoints` is a private function in `app/components/MarketView/returns.ts:5-22`, and `compareSortValues` is in `app/components/MarketView/sorting.ts:180-197`. WP18 (F005, F043) may have moved them to `app/lib/finance.ts` and `app/lib/sorting.ts` and may have dropped the `convertPrice` parameter from the percent helpers. Everywhere this spec says `./returns` or `./sorting`, import from the module the grep above found. If WP18 dropped `convertPrice`, drop it from the calls in step 2 too (call `toDailyPoints(history)`), and keep passing `convertPrice` only to the price conversion.
3. **Loading ids come from WP09's store.** Expect `const loadingProductIds = useLoadingProductIds(historyLoadingStore);` in MarketView. If WP09 did not land and `loadingProductIds` is still a `number[]` from `useProductData`, the code below works unchanged (`new Set(loadingProductIds)` accepts both).
4. **`priceHistory` keeps per-product array identity.** `useProductData.ts:134-139` builds `{ ...priceHistoryRef.current, [productId]: history }`, so only the loaded product's array is new. WP09 keeps that spread. Confirm with `grep -n '\.\.\.priceHistoryRef.current' app/components/ProductPrices/hooks/useProductData.ts`. If the hook now rebuilds every array on each load, row reuse in step 2 cannot work: stop and report it in the PR instead of adding deep comparisons.

## Implementation steps

Order: 1, 2, 3, 4, 5, 6, then tests (7). Steps 1 to 4 add code without breaking the build; step 5 switches MarketView over; step 6 deletes the now-dead helper.

### Step 1. Build the daily series once per product (F125)

File: `app/components/MarketView/returns.ts` (or its WP18 location; see assumption 2).

If the module already exports a daily-points builder and drawdown/volatility functions that take points (WP18 may have done this per F005's recommendation), skip this step and use those names in step 2.

Otherwise:

1a. Replace the private `function toDailyPoints(` block (`returns.ts:5-22`) with an exported, typed version. Body unchanged:

```ts
export interface DailyPoint {
  /** UTC calendar day, `YYYY-MM-DD` (the first 10 chars of recorded_at). */
  dateKey: string;
  price: number;
}

/**
 * One converted price per calendar day, oldest first (the first entry seen
 * for a day wins). Build it once per product and hand it to the
 * `...FromPoints` helpers; each call is a Map plus a sort.
 */
export function toDailyPoints(
  history: PriceHistoryEntry[] | undefined,
  convertPrice: (usdPrice: number) => number
): DailyPoint[] {
  if (!history || history.length === 0) return [];

  const byDay = new Map<string, number>();
  for (const entry of history) {
    const dayKey = entry.recorded_at.slice(0, 10);
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, convertPrice(entry.usd_price));
    }
  }

  return Array.from(byDay.entries())
    .map(([dateKey, price]) => ({ dateKey, price }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}
```

1b. Split `getMaxDrawdownPercent` (`:86-110`) and `getVolatilityPercent` (`:112-140`) into a points function plus a thin wrapper. The loop bodies move unchanged; the wrappers keep the old signatures because `app/product/[id]/page.tsx:197-198` still calls them:

```ts
/** Largest peak-to-trough fall over the points, as a positive percent. */
export function getMaxDrawdownFromPoints(
  points: readonly DailyPoint[]
): number | null {
  if (points.length < 2) return null;

  let peak = points[0].price;
  let maxDrawdown = 0;

  for (const point of points) {
    if (point.price > peak) {
      peak = point.price;
      continue;
    }

    if (peak <= 0) continue;
    const drawdown = ((point.price - peak) / peak) * 100;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return Math.abs(maxDrawdown);
}

export function getMaxDrawdownPercent(
  history: PriceHistoryEntry[] | undefined,
  convertPrice: (usdPrice: number) => number
): number | null {
  return getMaxDrawdownFromPoints(toDailyPoints(history, convertPrice));
}

/** Annualised volatility of daily % changes over the last `lookbackDays` points. */
export function getVolatilityFromPoints(
  points: readonly DailyPoint[],
  lookbackDays = 30
): number | null {
  if (points.length < 3) return null;

  const recentPoints = points.slice(-Math.max(lookbackDays, 3));
  const dailyChanges: number[] = [];

  for (let i = 1; i < recentPoints.length; i += 1) {
    const prev = recentPoints[i - 1].price;
    const curr = recentPoints[i].price;
    if (prev <= 0) continue;
    dailyChanges.push(((curr - prev) / prev) * 100);
  }

  if (dailyChanges.length < 2) return null;

  const mean =
    dailyChanges.reduce((sum, change) => sum + change, 0) / dailyChanges.length;
  const variance =
    dailyChanges.reduce((sum, change) => sum + (change - mean) ** 2, 0) /
    dailyChanges.length;
  const dailyVolatility = Math.sqrt(variance);

  return dailyVolatility * Math.sqrt(365);
}

export function getVolatilityPercent(
  history: PriceHistoryEntry[] | undefined,
  convertPrice: (usdPrice: number) => number,
  lookbackDays = 30
): number | null {
  return getVolatilityFromPoints(toDailyPoints(history, convertPrice), lookbackDays);
}
```

If WP18 changed the annualisation (for example an `{ annualize }` option) or the day keying, keep WP18's maths and only perform the split: the goal is "same numbers, one `toDailyPoints` per product". `getCagrPercent` and `getReturnPercent` do not use daily points; leave them alone.

### Step 2. `app/components/MarketView/buildRows.ts`: one series per row, and stable row objects

2a. Imports: replace `getMaxDrawdownPercent` and `getVolatilityPercent` in the `./returns` import with `getMaxDrawdownFromPoints`, `getVolatilityFromPoints` and `toDailyPoints`.

2b. In `buildMarketRow`, replace the two lines

```ts
  const maxDrawdown = getMaxDrawdownPercent(history, convertPrice);
  const volatility30d = getVolatilityPercent(history, convertPrice, 30);
```

with

```ts
  // One daily series per product, shared by drawdown and volatility (F125).
  const dailyPoints = toDailyPoints(history, convertPrice);
  const maxDrawdown = getMaxDrawdownFromPoints(dailyPoints);
  const volatility30d = getVolatilityFromPoints(dailyPoints, 30);
```

Keep the comment above them about drawdown and volatility staying ungated. Change nothing else in `buildMarketRow`; WP17's `buildRows.test.ts` must pass unchanged.

2c. Append at the end of the file:

```ts
interface CachedMarketRow {
  product: Product;
  history: PriceHistoryEntry[] | undefined;
  // Whatever volume type buildMarketRow takes (WP11 may have renamed it).
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

If WP18 removed `convertPrice` from `buildMarketRow`'s signature, remove it from `CachedMarketRow` and the comparison too. Why a builder and not a ref: eslint-plugin-react-hooks 7.1.1 (shipped with eslint-config-next 16, blocking since WP17) reports `react-hooks/refs` for reading `ref.current` during render; a builder held in lazy `useState` is invisible to that rule and is guaranteed to survive re-renders (a `useMemo(() => create(), [])` is not).

### Step 3. New file `app/components/MarketView/columns.tsx`: the column descriptor table (F045)

This replaces the `SortKey` union (`MarketView.tsx:70-86`), `KEY_RETURN_WINDOWS` (`:90`), the cell helpers (`:113-188`), the sort `switch` (`:354-413`), `getSortIndicator` (`:438-441`), the per-cell JSX (`:471-562`), the header (`:695-853`) and `visibleColumnCount` (`:244`).

Class strings and formatter calls: move them from the CURRENT `MarketView.tsx`, cell by cell. The code below shows the state expected after WP07 (`formatDateOnly`, `formatMoney`), WP09 (`<MiniSparkline history={...} />`), WP14 (`--pf-gain-text`/`--pf-loss-text`, `text-slate-500` on the rank cell and the "Loading..."/"Open chart" text) and WP15. Where the current file differs from this snippet (a class, a label, a `title`/tooltip WP18 added to "Vol 30D", an `aria-label`), the current file wins: copy it into the matching descriptor. If WP18 added a header hint, put it in the optional `headerHint` field (rendered as `title` on the header button in step 5).

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
    label: "Vol 30D",
    keyColumn: false,
    sortable: true,
    defaultDirection: "asc",
    headerClassName: TH,
    cellClassName: TD,
    accessor: (row) => row.volatility30d,
    render: (row) => renderReturnValue(row.volatility30d),
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
- The `accessor`s reproduce the 16 `case`s of `MarketView.tsx:366-398` one for one; `defaultDirection` reproduces `getDefaultSortDirection` (`sorting.ts:63-68`): asc for product, set, days_since_release, max_drawdown, volatility_30d; desc for the rest.
- If `lib/format.ts` does not export `formatDateOnly`/`formatMoney` (WP07 missing), keep the original `formatReleaseDate` and `formatRatio` helpers from `MarketView.tsx:113-116,139-142` in this file instead, with `formatRatio(row.pricePerDay, ctx.currency === "CAD" ? "C$" : "$")`.
- If `MiniSparkline` still takes `currency`/`exchangeRate` (WP09 missing), add `exchangeRate: number` to `MarketCellContext`, pass it from `MarketTableRow`, and render `<MiniSparkline history={row.history} currency={ctx.currency} exchangeRate={ctx.exchangeRate} />`.
- `as const satisfies` keeps each `id` as a literal (so `SortKey` is the exact 16-member union) while still type-checking every entry and contextually typing the `render`/`accessor` parameters. Verified with TypeScript 6.0.3 against this repo's `tsconfig.json`.

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
                      View on TCGPlayer &gt;
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

If WP18 (F073) changed the `PriceChart` props or how it is loaded, copy the current call from `MarketView.tsx`, not the one above.

### Step 5. `app/components/MarketView/MarketView.tsx`: switch to the new modules

Do these edits in order, then run `pnpm exec eslint app/components/MarketView/MarketView.tsx` and delete every import it reports as unused.

5a. **Imports.** Remove `Fragment` from the React import (keep `useCallback, useDeferredValue, useEffect, useMemo, useState`). Remove `import dynamic from "next/dynamic";`, the `PriceChart` dynamic block and its comment (moved in step 4), and the imports of `ProductImage`, `ExpansionTypeBadge`, `VariantBadge`, `MiniSparkline`, the `./returns` functions (if any are left after WP17), `compareSortValues`, `getDefaultSortDirection`, `SortValue`, and `formatDateOnly`/`formatMoney` from `lib/format` (only if nothing else in the file uses them). Change the `./buildRows` import to `import { createMarketRowsBuilder, DAY_MS, getReleaseMs } from "./buildRows";` (drop `buildMarketRows`, `RETURN_WINDOWS`, `ReturnWindowLabel` if now unused). Add:

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

5b. **Delete module-level code now in `columns.tsx`:** the `SortKey` union, `KEY_RETURN_WINDOWS`, `renderReturnValue`, `formatRatio` (if still present), `renderProductCell`, `renderSetCell`, `formatReleaseDate` (if still present). Keep `AGE_FILTER_OPTIONS`, `AgeFilterValue`, `MarketViewProps`, `EMPTY_PRODUCTS`.

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

Only if the grep in "Before you start" shows `MarketView.tsx` as its only non-test caller: delete the function and its doc comment (`sorting.ts:59-68` at review HEAD), and delete the `describe("getDefaultSortDirection", ...)` block (`__tests__/sorting.test.ts:84-97`) plus `getDefaultSortDirection,` from that test's import. Its cases move to `columns.test.ts` (step 7). If anything else imports it (for example `/compare` after WP18), leave it in place and unused by MarketView.

### Step 7. Tests

Add the four new test files and one update listed under Tests. Write them after step 5 so they run against the finished code.

## Pitfalls: do not do this

- **Do not add `useSearchParams`, `useRouter` or any URL-state hook to MarketView** (F045 verifier correction). `/market` is statically prerendered and `app/market/page.tsx` renders `<MarketView>` with no Suspense boundary: `useSearchParams` there is a build error in Next 16, and adding a Suspense boundary would ship the ~300-row table as a fallback in the static HTML (the F012/F025 defect) and `router.replace` per keystroke is F016. URL state for `/market` is out of scope.
- **Do not remove the `tableBody` useMemo or the `useDeferredValue` search.** The comment at `MarketView.tsx:445-450` explains it: the urgent keystroke render must reuse the same element objects so React bails out of the body. `memo` rows do not replace that; they only stop per-row work when the body is rebuilt.
- **Do not build rows with a fresh object per render and rely on `memo` anyway.** `memo` compares `row` by reference; `buildMarketRows` alone returns new objects for every product on every history change, which makes `memo` useless. Use `createMarketRowsBuilder` (step 2).
- **Do not hold the row cache in `useRef` and read it during render**, and do not create the builder with `useMemo(() => createMarketRowsBuilder(), [])`. The first trips `react-hooks/refs` (lint blocks CI since WP17); the second is allowed to be thrown away by React. Use `useState(createMarketRowsBuilder)`.
- **Do not deep-compare history arrays** to decide row reuse. Reference equality is correct because `useProductData` replaces only the loaded product's array; a deep compare costs more than the work it saves.
- **Do not pass inline arrow functions or new objects as `MarketTableRow` props** (`onToggle={() => ...}`, `columns={MARKET_COLUMNS.filter(...)}`, a context object). Each would be a new reference per parent render and re-render all 306 rows. `toggleExpanded` is `useCallback`'d; `KEY_COLUMNS`/`ALL_COLUMNS` are module constants.
- **Do not move the `ensureHistoryLoaded` call out of `toggleExpanded`'s state updater "for purity".** It starts the load in the same render batch as the expansion; relying only on the effect at `:348-352` would paint one frame of "Price history not available yet." before "Loading price history...". Leave `toggleExpanded` and that effect exactly as they are.
- **Do not subscribe each row to the loading store with `useIsHistoryLoading`.** The plan keeps `MarketTableRow` a pure function of props (`isLoading` boolean derived from the Set), which keeps it testable without a store; the Set rebuild costs microseconds.
- **Do not add a `MarketViewSettingsContext` or change `ProductCard`/`ProductPrices` props** (F045 item 4). The verifier warned an un-memoised provider value defeats `memo` for every card; WP20's CurrencyContext (F051) owns that change.
- **Do not force MarketView onto a generic table/column helper WP18 may have added for `/compare`** (F043 `SortableTable`). MarketView's columns need sticky classes, a render context and a key/all split the compare tables do not have. Reuse only `compareSortValues`.
- **Do not change any maths, rounding, labels, column order, default sort (`release_date` desc) or copy.** This PR is behaviour-preserving; `buildRows.test.ts` (WP17) and `returns.test.ts` must pass unchanged. In particular do not annualise or de-annualise volatility here (F005 is WP18's).
- **Do not drop or re-offset the sticky `#` column on phones** (F125 "consider" item). It changes the phone layout, the gain is unmeasured and the plan owner did not ask for it; leave both sticky columns as they are.
- **Do not use `getDefaultSortDirection(key: string)` with a `SortKey` cast.** The verifier asked for the parameter to be typed as `SortKey`; putting `defaultDirection` on the column descriptor gives the same guarantee without making the shared sorting module depend on a MarketView type.
- **Do not put shared test fixtures in a non-test file under `__tests__/`.** Jest's default `testMatch` treats every file in `__tests__` as a suite and fails one with no tests. Inline the small `makeProduct`/`makeRow` helpers per file as shown.
- **Do not use `require()` inside `jest.mock` factories** (`@typescript-eslint/no-require-imports` is an error). Return a named function component that uses JSX, as shown.

## Tests

All files under `frontend/app/components/MarketView/__tests__/`. Default jsdom environment; no `@jest-environment` docblock needed.

### New: `columns.test.ts`

Cases:
- `KEY_COLUMNS` ids in order: `rank, product, set, price, return_7d, return_1m, return_3m, vol_30d, vol_trend, chart` (10).
- `ALL_COLUMNS` ids in order: `rank, product, set, price, release_date, days_since_release, price_per_day, cagr, max_drawdown, volatility_30d, return_7d, return_1m, return_3m, return_6m, return_1y, vol_30d, vol_trend, sparkline, chart` (19).
- Labels in order: `#, Product, Set, Price, Release, Days Since, Price/Day, CAGR, Max DD, Vol 30D, 7D, 1M, 3M, 6M, 1Y, Vol (30d), Vol Δ, Last 7D, Chart`. If WP18 renamed a label, assert the current label.
- ids are unique; exactly 16 columns are sortable.
- Default directions (moved from `sorting.test.ts`): asc for product, set, days_since_release, max_drawdown, volatility_30d; desc for the other 11.
- `sortMarketRows`: price desc `[2,1,3]` and asc `[1,2,3]` with product 3 unpriced (missing sinks in both directions); product column sorts by lower-cased type label plus variant; ties keep input order and the input array is not mutated; returned elements are the same objects (`toBe`).

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
  // ...plus the id/label/default-direction cases listed above, e.g.
  // const asc: SortKey[] = ["product", "set", "days_since_release", "max_drawdown", "volatility_30d"];
  // for (const key of asc) expect(getSortColumn(key).defaultDirection).toBe("asc");
});
```

If WP13/WP14 made `hasCurrentPrice` depend on `price_recorded_at` freshness relative to the real clock and the unpriced/priced split misbehaves, add `jest.useFakeTimers({ now: new Date("2026-09-25T12:00:00Z") })` in `beforeEach` and `jest.useRealTimers()` in `afterEach`, as WP17's `buildRows.test.ts` does.

### New: `buildRows.reuse.test.ts`

Cases for `createMarketRowsBuilder`:
- First call returns the same data as `buildMarketRows` (products in order, `history` wired, missing history `undefined`).
- Second call with a NEW `priceHistory` object that keeps product 1's array and adds product 2's: row 0 is `toBe` the previous row 0; row 1 is a new object with the new history.
- Changing `convertPrice` (a new function, as a currency toggle produces) rebuilds every row and `price` scales.
- Changing `todayUtcMs`, the product object (`{ ...p1 }`) or the product's volume entry rebuilds that row.
- A product filtered out (search) and back in gets its cached row back (`toBe`).

```ts
import { buildMarketRow, createMarketRowsBuilder } from "../buildRows";
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

it("rebuilds when the product's volume entry changes", () => {
  const build = createMarketRowsBuilder();
  const before = build([p1], { 1: h1 }, NO_VOLUME, identity, TODAY_UTC_MS);
  const volume = { 1: { product_id: 1, units_sold_30d: 5, units_sold_prior_30d: 4 } as Volume };
  const after = build([p1], { 1: h1 }, volume, identity, TODAY_UTC_MS);
  expect(after[0]).not.toBe(before[0]);
  expect(after[0].unitsSold30d).toBe(5);
});
```

(Drop `identity`/`convertPrice` arguments if WP18 removed them from `buildMarketRow`.)

### New: `returns.points.test.ts` (or add a `describe` to the file WP18 moved the math tests to)

Cases (history with a duplicate same-day entry and one out-of-order entry: 09-01 100, 09-01T18 999, 09-03 80, 09-02 120, 09-04 90):
- `toDailyPoints` keeps the first price per UTC day and sorts oldest first: `[{2026-09-01,100},{2026-09-02,120},{2026-09-03,80},{2026-09-04,90}]`; applies `convertPrice`; returns `[]` for `undefined` and `[]`.
- `getMaxDrawdownFromPoints` is `33.333...` (120 to 80) and `null` for one point.
- `getMaxDrawdownFromPoints(points)` `toBe` `getMaxDrawdownPercent(history, identity)`, and `getVolatilityFromPoints(points, 30)` `toBe` `getVolatilityPercent(history, identity, 30)` (the wrappers are exact).
- `getVolatilityFromPoints` is `null` for two points and non-null for four.

This also closes the verifier's gap "returns.test.ts covers only getReturnPercent" for drawdown and volatility. Skip any case WP18 already covers in its moved test file.

### New: `MarketTableRow.test.tsx`

Render rows inside `<table><tbody>` with a probe column passed as `columns` (the row renders cells only through `columns`, so a probe's `render` counts real renders). Cases:
- Changing one row's `isLoading` re-renders exactly that row (probe called once, with that id).
- Replacing one row object (history landed) re-renders exactly that row.
- Re-rendering the parent with identical props re-renders no row.
- Expanded + loading shows "Loading price history..." in a `td` whose `colspan` equals `columns.length`; expanded with no history shows "Price history not available yet.".
- `ctx.onToggle` calls the `onToggle` prop with the row's product id.

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

it("re-renders only the row whose loading flag changed", () => {
  const { rerender } = render(<Table />);
  expect(mockProbe).toHaveBeenCalledTimes(3);
  mockProbe.mockClear();

  rerender(<Table loadingId={2} />);
  expect(mockProbe).toHaveBeenCalledTimes(1);
  expect(mockProbe).toHaveBeenCalledWith(2);
  expect(screen.getByText("2:2:loading")).toBeInTheDocument();
});

it("spans every visible column and shows the loading message while loading", () => {
  render(<Table expandedId={1} loadingId={1} />);
  const cell = screen.getByText("Loading price history...").closest("td");
  expect(cell).toHaveAttribute("colspan", String(PROBE_COLUMNS.length));
});
```

Write the remaining cases (row object replaced, identical rerender, empty-history message, toggle id via a column whose `render` returns `<button onClick={ctx.onToggle}>toggle</button>` then `fireEvent.click` and `expect(onToggle).toHaveBeenCalledWith(2)`) in the same style.

### New: `MarketView.table.test.tsx`

Copy the mock block from WP13's `MarketView.emptyState.test.tsx` (and any mock that file gained later), plus the ChartBundle stub above. Products: id 1 price 50 released 2025-01-01, id 2 price 300 released 2026-01-01, id 3 price 120 released 2024-01-01, labels `Type 1..3`, sets `Set 1..3`, `price_recorded_at: new Date().toISOString()` (so the price guard keeps them priced). Helper `rowOrder()` reads the Set cell (third cell) of each body row. Cases:
- 10 `columnheader`s; after clicking "Show all columns", 19.
- Default order is newest release first: `["Set 2", "Set 1", "Set 3"]`.
- Clicking "Price" sorts descending (`aria-sort="descending"` on that header, order `2,3,1`); clicking again sorts ascending (`aria-sort="ascending"`, order `1,3,2`).
- Clicking "Set" opens ascending (`1,2,3`).
- Mock `fetchProductHistoryClient` to resolve two points; click the first "Show" inside `act(async () => ...)`; `await screen.findByTestId("price-chart")`; history fetched exactly once; the chart's `td` has `colspan="10"`; clicking "Hide" removes it.

```tsx
function rowOrder() {
  const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
  return rows.map((row) => within(row).getAllByRole("cell")[2].textContent?.slice(0, 5));
}

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
```

If WP09's history batching means `fetchProductHistoryClient` is no longer what `ensureHistoryLoaded` calls, mock whatever `useProductData` now calls (read the hook) and assert on that instead. If this file cannot be made to render in jsdom within about 30 minutes, keep the other three new files, cover `/market` with the manual checks, and say so in the PR (same escape hatch WP13 used).

### Update: `sorting.test.ts`

Delete the `getDefaultSortDirection` describe block and import (step 6). Every `compareSortValues`/`isMissingSortValue` case stays unchanged.

### Must pass unchanged

`buildRows.test.ts` (WP17), `returns.test.ts`, `useProductData.test.tsx`, `MarketView.emptyState.test.tsx` (WP13), `MiniSparkline*.test.tsx` (WP09), and every other suite.

A prototype of steps 1 to 5 and these tests was type-checked, linted and run against review HEAD `a188fea` plus WP17 step 13 (47 MarketView tests passing, `tsc` and `eslint app/components/MarketView` clean); only the upstream class/formatter edits were not present in that prototype.

## Verification

From `frontend/`:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit                                   # exit 0
pnpm exec eslint app/components/MarketView "app/product/[id]/page.tsx"   # 0 problems
pnpm test --ci app/components/MarketView                 # all suites pass, including the 4 new files
pnpm test --ci                                           # full suite green
pnpm run lint                                            # 0 errors (CI blocks on this since WP17)
pnpm build:stub                                          # exit 0 (do not run while another agent builds in this checkout)
```

In the `pnpm build:stub` route table, `/market` must show the same rendering symbol and revalidate value as on `main` before this PR (static/ISR, not `ƒ Dynamic`), and the build log must have no "useSearchParams() should be wrapped in a suspense boundary" error.

Greps that must hold:

```bash
grep -n 'switch (key)\|visibleColumnCount\|showAllColumns ? 19 : 10\|Fragment\|next/dynamic' app/components/MarketView/MarketView.tsx   # no output
grep -rn 'useSearchParams\|useRouter\|next/navigation' app/components/MarketView                              # no output
grep -c 'toDailyPoints(' app/components/MarketView/buildRows.ts                                              # 1
grep -n 'export default memo(MarketTableRow)' app/components/MarketView/MarketTableRow.tsx                   # 1 hit
wc -l app/components/MarketView/MarketView.tsx                                                               # well under 862 (about 330-380)
```

Manual checks (on the Vercel preview for this PR, which has real data; the local stub build has an empty catalog):

1. Open `/market`. The table looks identical to production: same 10 columns in the same order, newest release first, same row numbers, same colours. Click "Show all columns": 19 columns, same order as production. Toggle back.
2. Click every sortable header once and again: first click direction matches production (Product, Set, Days Since, Max DD, Vol 30D ascending; the rest descending); "--" values stay at the bottom in both directions; the sorted header shows ` v`/` ^`.
3. Click "Show" on a row: "Loading price history..." then the chart; "Hide" collapses it. Expand a second row: the first collapses. Switch USD/CAD with a row open: prices and the chart update.
4. Type in the search box quickly: characters never lag; the count updates; clear it. Pick an age filter and a generation: rows filter as before. A search with no match shows the WP13 "No products match" panel.
5. Render check (the F125 fix): open React DevTools, Profiler, enable "Highlight updates when components render", record, click "Show" on one row, wait for the chart, stop. Correct: the commits for the loading flag and the history arrival each render one or two `MarketTableRow`s (the toggled row, plus the previously expanded row on expansion), not ~306. Before this PR (production), the same recording shows the whole table flashing.
6. View source (or `curl -s <preview>/market | grep -c '<tr'`): the server HTML still contains the table rows (the page did not bail out to client rendering).

## Owner actions

None required. The executor cannot open the Vercel preview with real data only if preview protection blocks them; in that case the owner performs manual checks 1 to 6 on the preview and replies on the PR with the result.

## Acceptance criteria

- [ ] `app/components/MarketView/columns.tsx` exists; `SortKey` is derived from `MARKET_COLUMNS` (no hand-written union); header cells, body cells, sort accessors, default directions and the column count all come from it.
- [ ] `MarketView.tsx` contains no `switch (key)`, no `visibleColumnCount`, no `19 : 10`, no per-cell JSX, no `Fragment`, no `next/dynamic`, and no `useSearchParams`/`useRouter`.
- [ ] `MarketTableRow.tsx` default-exports `memo(MarketTableRow)`; MarketView passes it only primitives and stable references.
- [ ] `createMarketRowsBuilder` exists in `buildRows.ts` and MarketView creates it with `useState(createMarketRowsBuilder)`.
- [ ] `buildMarketRow` calls `toDailyPoints` exactly once and derives drawdown and volatility from that series; `/product/[id]` still uses the history-based wrappers with identical numbers.
- [ ] `getDefaultSortDirection` is removed (or, if another module uses it, MarketView no longer does).
- [ ] New tests `columns.test.ts`, `buildRows.reuse.test.ts`, `returns.points.test.ts`, `MarketTableRow.test.tsx`, `MarketView.table.test.tsx` pass (or the last is replaced by the documented manual check); `buildRows.test.ts`, `returns.test.ts`, `sorting.test.ts` (minus the moved block) pass unchanged.
- [ ] `pnpm exec tsc --noEmit`, `pnpm run lint`, `pnpm test --ci` and `pnpm build:stub` exit 0; `/market` keeps its static/ISR status.
- [ ] On the preview, `/market` looks and sorts exactly as production, and the Profiler shows one or two row renders per expand/history commit.

## Rollback

Code only; no migrations, env vars or data. Revert the PR's merge commit (`git revert -m 1 <merge-sha>`) and redeploy. The revert restores the inline table, the switch, `getDefaultSortDirection` and its tests together; `returns.ts`'s new exports disappear with it, and nothing outside `app/components/MarketView/` imports them (verify with `grep -rn "FromPoints\|createMarketRowsBuilder\|MarketTableRow\|from \"./columns\"" app` before reverting if later PRs have landed). Partial rollback is not supported: `MarketView.tsx`, `columns.tsx` and `MarketTableRow.tsx` change together.

## Commit and PR

Commit message:

```
refactor(market): drive the table from a column list; memoise rows

- columns.tsx: one descriptor per column (header, cell, sort accessor,
  default direction); SortKey, the visible-column count and colSpan are
  derived from it. Replaces the 16-case sort switch and 16 hand-written
  <th>s (F045).
- MarketTableRow: memo() row fed stable row objects from
  createMarketRowsBuilder, so a history load or expand re-renders one
  row instead of ~306 (F125).
- buildMarketRow builds the daily series once and derives drawdown and
  volatility from it (was two toDailyPoints passes per product).
- getDefaultSortDirection folded into the column descriptors.
- /market stays statically rendered: no URL state added.
```

PR title: `refactor(market): column-driven table and memoised rows (WP19: F045, F125)`

PR body summary: link `audits/remediation/WP19-marketview-refactor.md`; list F045 (full for `/market`; item 3 deliberately not applied to `/market` per the verifier, item 4 left to WP20's CurrencyContext) and F125 (full; sticky `#` column intentionally unchanged); state that nothing user-visible changes; paste the "Before you start" grep output next to the Verification grep output; paste the `pnpm build:stub` route-table line for `/market`; attach a before/after React Profiler screenshot of one expand; note that `aria-sort` now follows the sorted column and header cells gained `scope="col"`.
