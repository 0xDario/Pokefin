# WP09: /prices: lightweight sparklines, batched history, stable layout

- **Findings covered**
  - F014 (full; cluster members F014, F066): every `ProductCard` mounts a Recharts `<ResponsiveContainer><LineChart>` sparkline (one ResizeObserver and one Redux store per card, about 306 live after one scroll), and the 118 kB gzip Recharts chunk downloads on every `/` and `/prices` visit as soon as the first card's history arrives.
  - F070 (full; cluster members F067, F070): one PostgREST request per card as it scrolls into view (about 306 per full scroll), two to three parent re-renders of the whole card list per card, and a burst of up to 306 concurrent requests when the chart timeframe changes after browsing.
  - F015 (full): no `content-visibility` on the roughly 306 cards (10k to 17k DOM nodes), and every timeframe change disconnects and recreates all 306 IntersectionObservers.
  - F071 (full, button half only, per verifier): the "Show full chart" button only appears once history arrives, so each card grows about 30 px while the user scrolls (catalog grid and the home page "Recently Released" strip).
  - F126 (full): the mobile filter drawer animates `max-height` and `margin-top` with `transition-all`, and the cards use `transition-all` for a hover shadow.
- **Priority rationale**: `/prices` is the most visited page and these are its biggest remaining scroll and interaction costs once WP08 has put the catalog in the server HTML; the fix is dependency-free and needs no database change.
- **Effort**: M (8 to 10 hours: one component rewrite, one new data-layer batcher, one small store module, about 8 call-site edits, 5 new or updated test files).
- **Depends on**: WP07 (`recordedAtDateKey` in `app/lib/format.ts`; WP07 also edits `MiniSparkline.tsx` and `ProductCard.tsx`), WP08 (rewrites `ProductPrices/index.tsx`), and through them WP03 (removed the history toast and the hook-level `historyLoading`) and WP00 (`pnpm build:stub`).
- **Unblocks**: WP19 (MarketView row memoisation uses the per-product loading store added here), WP17 (lint and tests gate), and the `/prices` "no charting library while scrolling" done-criterion in `00-PLAN.md`.
- **Suggested branch name**: `remediation/wp09-prices-card-rendering`
- **Risk level**: medium. The history loader feeds every sparkline, return back-fill and full chart on `/`, `/prices` and `/market`; a batching bug (truncated pages, a lost resolver) would blank or corrupt charts site-wide, so the tests below are mandatory.

## Why

On `/prices` every card draws its 96x40 price line with a full Recharts chart. After one scroll through the catalog about 306 charts, 306 ResizeObservers and 306 chart stores are alive, and the 118 kB gzip charting library is downloaded on every visit to `/` and `/prices` just for those lines; switching USD/CAD or the chart period then re-renders all of them and freezes the page for a moment on phones. While scrolling, each card fires its own Supabase request (about 306 per scroll) and each request re-renders the entire card list two or three times; switching the timeframe after browsing fires hundreds of requests at once. Cards also grow about 30 px when their "Show full chart" button pops in, shifting the grid under the user's thumb, and opening the mobile filter drawer animates a layout property above the whole list. After this PR the sparkline is a plain SVG polyline that renders on the server and never loads Recharts, history is fetched in batched `.in()` queries (about 10x fewer requests), only the affected card re-renders when its loading state changes, off-screen cards skip layout and paint, cards keep a fixed height, and the drawer animates without `max-height`.

## Before you start

Read these files in full first (line numbers are at commit a188fea; WP03, WP07 and WP08 will have moved some of them, so locate code by the quoted text, not by number):

- `frontend/app/components/MarketView/MiniSparkline.tsx` (95 lines). `:43-53` the `next/dynamic` import of `ChartBundle.MiniSparklineImpl` with `ssr: false`; `:62-80` the data memo keyed on `[history, currency, exchangeRate, days]`; `:22-41` `SparklineSkeleton` (keep it).
- `frontend/app/components/charts/MiniSparklineImpl.tsx` (37 lines, the Recharts sparkline) and `frontend/app/components/charts/ChartBundle.tsx:27-28` (its two re-exports).
- `frontend/app/components/ProductPrices/cards/ProductCard.tsx` (345 lines). `:13-29` props; `:54-66` destructure; `:87-120` the three effects (IntersectionObserver with `hasTriggeredLoad` latch at `:88-108`, timeframe refetch at `:110-114`, full-chart load at `:116-120`); `:122-123` `hasHistory` and the toggle label; `:129` and `:232` card roots with `transition-all`; `:166-171` and `:279-284` `<MiniSparkline ... currency exchangeRate days={365} />`; `:190-210` and `:309-329` the conditional button.
- `frontend/app/components/ProductPrices/hooks/useProductData.ts` (188 lines). `:34` `loadingProductIds` state; `:97-176` `ensureHistoryLoaded` (`:117-119` and `:163-168` set loading state, `:123` calls `fetchProductHistoryClient`); `:178-187` return.
- `frontend/app/lib/clientMarketData.ts` (433 lines). `:54-58` history caches; `:80-160` `fetchNewestPricedAtClient` (the existing paging pattern to copy); `:250-306` `fetchProductHistoryClient` (`.eq("product_id", productId)` at `:275`).
- `frontend/app/lib/marketData.ts:73-93` (`TIMEFRAME_TO_DAYS`, `getDaysForTimeframe`, `getHistoryStartDate`, which reaches back `days + 2` days) and `:373-396` (`groupHistoryRowsByProduct`).
- `migrations/0003_integrity_constraints.sql:48-49`: unique index `product_price_history_product_day_uidx` on `(product_id, recorded_at::date)`, i.e. at most one history row per product per day. The chunk size below relies on it.
- `frontend/app/components/ProductPrices/index.tsx` (after WP08): every `<ProductCard` and the `useProductData` destructure.
- `frontend/app/components/dashboard/RecentlyReleased.tsx` (71 lines): `:24-25` destructure, `:50-63` the card.
- `frontend/app/components/MarketView/MarketView.tsx`: `:206-212` `useProductData` destructure, `:540-544` the only other `<MiniSparkline>` call site, `:545`, `:567`, `:622` reads of `loadingProductIds`.
- `frontend/app/components/ProductPrices/cards/ProductGrid.tsx` (24 lines), `frontend/app/components/ProductPrices/controls/ControlBar.tsx:104-191`, `frontend/app/globals.css` (82 lines).
- Tests: `frontend/app/components/MarketView/__tests__/useProductData.test.tsx` (209 lines), `frontend/app/lib/__tests__/clientMarketData.cache.test.ts` (146 lines; `:114-145` mocks the old `.eq().gte().order()` chain), and, if WP07 landed it, `frontend/app/components/ProductPrices/__tests__/ProductCard.format.test.tsx`.

Confirm the starting state from `frontend/`:

```bash
# Dependencies landed. Each must print a match; if one does not, STOP: the
# prerequisite package has not merged.
grep -n "export function recordedAtDateKey" app/lib/format.ts          # WP07
grep -rn "historyLoading" app/components/ProductPrices/hooks/useProductData.ts || echo "WP03 ok (no hook-level historyLoading)"
grep -n "useSearchParams" app/components/ProductPrices/index.tsx || echo "WP08 ok (no useSearchParams)"

# The bugs are still present. Expected output in the comments.
grep -rn "MiniSparklineImpl" app                     # 8 hits: MiniSparkline.tsx:47,48,92, ChartBundle.tsx:27, MiniSparklineImpl.tsx:10,16,19,22
grep -n '\.eq("product_id", productId)' app/lib/clientMarketData.ts   # 2 hits: :275 (price history) and :398 (sales history, stays)
grep -rn "content-visibility\|contain-intrinsic" app # no output
grep -n "hasHistory && (" app/components/ProductPrices/cards/ProductCard.tsx   # 4 hits: :191 and :310 (the conditional buttons), :201 and :320 (the full chart, stays)
grep -n "hasTriggeredLoad" app/components/ProductPrices/cards/ProductCard.tsx  # 4 hits
grep -n "max-h-\[1000px\]" app/components/ProductPrices/controls/ControlBar.tsx # 1 hit
grep -rn "loadingProductIds" app --include=*.tsx --include=*.ts
#   useProductData.ts:34,178,185 (after WP03: state + return only), index.tsx (destructure + 3 per-card props),
#   RecentlyReleased.tsx:24,55, MarketView.tsx:210,545,567,622, useProductData.test.tsx:73 (comment),164,183

# Baseline: these must pass before you change anything.
pnpm exec tsc --noEmit
pnpm test --ci app/components/MarketView app/components/ProductPrices app/lib/__tests__/clientMarketData.cache.test.ts
pnpm exec eslint app/components/ProductPrices app/components/MarketView/MiniSparkline.tsx app/components/MarketView/MarketView.tsx app/components/dashboard/RecentlyReleased.tsx app/lib/clientMarketData.ts app/components/charts/ChartBundle.tsx
#   expect 0 errors; the only warning today is ProductCard.tsx "'historyLoading' is assigned a value but never used" (this PR removes it)
```

Assumptions to check:

- Supabase's API "Max rows" setting is 1000 (the default). The existing `fetchNewestPricedAtClient` (`clientMarketData.ts:80`) already assumes it. The new batcher assumes it too; see Owner actions.
- `ProductCard` is rendered only by `ProductPrices/index.tsx` (3 sites) and `dashboard/RecentlyReleased.tsx` (1 site), and `MiniSparkline` only by `ProductCard.tsx` (2 sites) and `MarketView.tsx` (1 site). Re-run `grep -rn "<ProductCard\|<MiniSparkline" app` and update any extra site the same way.
- `ProductGrid` is used only by `ProductPrices/index.tsx` (so the `content-visibility` rule below reaches `/prices` only, not the home page strip).

## Implementation steps

Do the steps in order. Steps 1 to 3 are the data layer and compile on their own; step 4 changes `ProductCard`'s props, so steps 5 and 6 (its call sites) must land in the same commit or `tsc` fails in between.

### Step 1. Batched, chunked history reads: `frontend/app/lib/clientMarketData.ts`

Replace the whole `fetchProductHistoryClient` function (`:250-306`, from `export async function fetchProductHistoryClient(` through its closing `}` before the `fetchVolumeMetrics` doc comment) with the block below. The function keeps its name and signature (callers and the hook's jest mock stay valid) but now queues the request for 100 ms and answers every product queued in that window with one `.in("product_id", ids)` query per chunk. Keep the existing `productHistoryCache` and `productHistoryPromiseCache` declarations at `:54-58` unchanged; the block uses them. If WP12 has since replaced the static `supabase` import with a lazy accessor, use that accessor exactly as the rest of the file does.

```ts
/**
 * Price history is read in batches (F070).
 *
 * Cards ask for their history one at a time as they scroll into view. Each
 * ask used to be its own PostgREST request, about 306 for one scroll of
 * /prices. Asks made within HISTORY_BATCH_WINDOW_MS are now collected and
 * answered with `.in("product_id", ids)` queries.
 *
 * Chunking: PostgREST silently truncates a response at the API "Max rows"
 * setting (1000 on this project), with no error. The unique index
 * product_price_history_product_day_uidx (migration 0003) allows at most one
 * row per product per day, and getHistoryStartDate reaches back days + 2, so
 * one product contributes at most requestedDays + 3 rows. Chunks are sized so
 * a chunk fits one page; the page loop is a safety net, not the plan.
 */
const HISTORY_BATCH_WINDOW_MS = 100;
const HISTORY_PAGE_SIZE = 1000;
const HISTORY_MAX_PAGES = 10;

type HistoryRow = { product_id: number; usd_price: number; recorded_at: string };

type HistoryWaiter = {
  resolve: (history: PriceHistoryEntry[]) => void;
  reject: (error: unknown) => void;
};

// timeframe -> productId -> the one waiter for that product+timeframe. There
// is exactly one per key because productHistoryPromiseCache dedupes callers.
const pendingHistoryByTimeframe = new Map<
  ChartTimeframe,
  Map<number, HistoryWaiter>
>();
let historyFlushTimer: ReturnType<typeof setTimeout> | null = null;

function historyIdsPerRequest(requestedDays: number): number {
  // 7D: 100, 1M: 30, 3M: 10, 6M: 5, 1Y: 2.
  return Math.max(1, Math.floor(HISTORY_PAGE_SIZE / (requestedDays + 3)));
}

function readFreshHistory(
  productId: number,
  requestedDays: number
): PriceHistoryEntry[] | null {
  const cached = productHistoryCache.get(productId);
  if (
    cached &&
    cached.daysLoaded >= requestedDays &&
    Date.now() - cached.fetchedAt < CLIENT_CACHE_TTL_MS
  ) {
    return cached.history;
  }
  return null;
}

function storeHistory(
  productId: number,
  requestedDays: number,
  history: PriceHistoryEntry[]
): void {
  const current = productHistoryCache.get(productId);
  // Never replace a fresher, wider range with a narrower one.
  if (
    !current ||
    current.daysLoaded < requestedDays ||
    Date.now() - current.fetchedAt >= CLIENT_CACHE_TTL_MS
  ) {
    productHistoryCache.set(productId, {
      daysLoaded: requestedDays,
      history,
      fetchedAt: Date.now(),
    });
  }
}

async function queryHistoryChunk(
  productIds: number[],
  timeframe: ChartTimeframe
): Promise<Record<number, PriceHistoryEntry[]>> {
  const startDate = getHistoryStartDate(timeframe);
  const rows: HistoryRow[] = [];

  for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
    const from = page * HISTORY_PAGE_SIZE;
    const { data, error } = await supabase
      .from("product_price_history")
      .select("product_id, usd_price, recorded_at")
      .in("product_id", productIds)
      .gte("recorded_at", startDate)
      // Total order so a row cannot repeat or vanish across a page boundary.
      .order("product_id", { ascending: true })
      .order("recorded_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + HISTORY_PAGE_SIZE - 1);

    if (error) {
      throw error;
    }

    const pageRows = (data || []) as HistoryRow[];
    rows.push(...pageRows);
    if (pageRows.length < HISTORY_PAGE_SIZE) {
      return groupHistoryRowsByProduct(rows);
    }
  }

  logCaughtError(
    "product_history_page_cap_reached",
    new Error("Price history chunk exceeded the page cap; charts may be truncated.")
  );
  return groupHistoryRowsByProduct(rows);
}

function flushHistoryQueue(): void {
  historyFlushTimer = null;
  const batches = Array.from(pendingHistoryByTimeframe.entries());
  pendingHistoryByTimeframe.clear();

  for (const [timeframe, waiters] of batches) {
    const requestedDays = getDaysForTimeframe(timeframe);
    const ids = Array.from(waiters.keys());
    const chunkSize = historyIdsPerRequest(requestedDays);

    for (let start = 0; start < ids.length; start += chunkSize) {
      const chunk = ids.slice(start, start + chunkSize);
      queryHistoryChunk(chunk, timeframe).then(
        (historyByProduct) => {
          for (const productId of chunk) {
            // A product with no rows is a real, empty history (e.g. id 442),
            // not a failure: cache it so it is not refetched forever.
            const history = historyByProduct[productId] ?? [];
            storeHistory(productId, requestedDays, history);
            waiters.get(productId)?.resolve(history);
          }
        },
        (error: unknown) => {
          // Only this chunk fails; nothing is cached, so a retry refetches.
          for (const productId of chunk) {
            waiters.get(productId)?.reject(error);
          }
        }
      );
    }
  }
}

/**
 * History for one product, at least `timeframe` wide. Served from the session
 * cache when fresh; otherwise queued and fetched with every other product
 * requested in the same HISTORY_BATCH_WINDOW_MS window. Rejects when its
 * chunk's query fails.
 */
export function fetchProductHistoryClient(
  productId: number,
  timeframe: ChartTimeframe
): Promise<PriceHistoryEntry[]> {
  const requestedDays = getDaysForTimeframe(timeframe);
  const cached = readFreshHistory(productId, requestedDays);
  if (cached) {
    return Promise.resolve(cached);
  }

  const cacheKey = `${productId}:${timeframe}`;
  const inFlight = productHistoryPromiseCache.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = new Promise<PriceHistoryEntry[]>((resolve, reject) => {
    let waiters = pendingHistoryByTimeframe.get(timeframe);
    if (!waiters) {
      waiters = new Map();
      pendingHistoryByTimeframe.set(timeframe, waiters);
    }
    waiters.set(productId, { resolve, reject });
    if (historyFlushTimer === null) {
      historyFlushTimer = setTimeout(flushHistoryQueue, HISTORY_BATCH_WINDOW_MS);
    }
  });

  productHistoryPromiseCache.set(cacheKey, request);
  const forget = () => {
    productHistoryPromiseCache.delete(cacheKey);
  };
  // Handles the rejection on this derived chain only; callers still see it.
  request.then(forget, forget);
  return request;
}
```

Notes for this step:

- `getDaysForTimeframe`, `getHistoryStartDate` and `groupHistoryRowsByProduct` are already imported at `:10-17`; `logCaughtError` at `:20`; `ChartTimeframe` and `PriceHistoryEntry` at `:3-9`. Add nothing else.
- The `.order("id")` column exists (`fetchNewestPricedAtClient` already orders by it at `:127`).
- The resolve-after-`storeHistory` order matters: a caller woken by `resolve` that immediately asks for a narrower range must hit the cache.

### Step 2. Per-product loading store: new file `frontend/app/components/ProductPrices/hooks/historyLoadingStore.ts`

Loading flags move out of React state so that starting or finishing one card's load re-renders only that card, not the page that owns `useProductData` (F070).

```ts
"use client";

import { useSyncExternalStore } from "react";

/**
 * Which products have a price-history request in flight.
 *
 * Deliberately NOT React state in useProductData: a state update there
 * re-rendered the whole /prices card list twice per card (F070). Components
 * subscribe to exactly what they show: a card to its own id
 * (useIsHistoryLoading), MarketView to the whole list (useLoadingProductIds).
 */
export type HistoryLoadingStore = {
  subscribe: (listener: () => void) => () => void;
  isLoading: (productId: number) => boolean;
  /** Same array identity until the set changes (useSyncExternalStore needs that). */
  getLoadingIds: () => readonly number[];
  start: (productId: number) => void;
  finish: (productId: number) => void;
};

const NO_IDS: readonly number[] = Object.freeze([]);

export function createHistoryLoadingStore(): HistoryLoadingStore {
  const loading = new Set<number>();
  const listeners = new Set<() => void>();
  let snapshot: readonly number[] = NO_IDS;

  const emit = () => {
    snapshot = loading.size === 0 ? NO_IDS : Array.from(loading);
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isLoading: (productId) => loading.has(productId),
    getLoadingIds: () => snapshot,
    start(productId) {
      if (loading.has(productId)) return;
      loading.add(productId);
      emit();
    },
    finish(productId) {
      if (!loading.delete(productId)) return;
      emit();
    },
  };
}

const noopSubscribe = () => () => {};
const alwaysFalse = () => false;
const noIds = () => NO_IDS;

/** True while `productId` has a history request in flight. Server render: false. */
export function useIsHistoryLoading(
  store: HistoryLoadingStore | undefined,
  productId: number
): boolean {
  return useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? () => store.isLoading(productId) : alwaysFalse,
    alwaysFalse
  );
}

/** Every product with a request in flight. Re-renders the caller on any change. */
export function useLoadingProductIds(store: HistoryLoadingStore): readonly number[] {
  return useSyncExternalStore(store.subscribe, store.getLoadingIds, noIds);
}
```

### Step 3. Use the store in the hook: `frontend/app/components/ProductPrices/hooks/useProductData.ts`

3a. Imports: add `import { createHistoryLoadingStore } from "./historyLoadingStore";` after the `../types` import. After WP03 the React import is `import { useCallback, useEffect, useRef, useState } from "react";`; keep it.

3b. Delete the state line `const [loadingProductIds, setLoadingProductIds] = useState<number[]>([]);` (`:34`) and put this in its place:

```ts
  // Stable for the hook's lifetime (lazy useState initialiser). Loading flags
  // live here, outside React state, so a card starting or finishing its load
  // does not re-render the component that owns this hook (F070).
  const [historyLoadingStore] = useState(createHistoryLoadingStore);
```

3c. Inside `ensureHistoryLoaded`, replace

```ts
      setLoadingProductIds((prev) =>
        prev.includes(productId) ? prev : [...prev, productId]
      );
```

with

```ts
      historyLoadingStore.start(productId);
```

3d. In the same function's `finally` block, replace

```ts
          if (!stillLoading) {
            setLoadingProductIds((prev) =>
              prev.includes(productId)
                ? prev.filter((id) => id !== productId)
                : prev
            );
          }
```

with

```ts
          if (!stillLoading) {
            historyLoadingStore.finish(productId);
          }
```

3e. Change the `useCallback` dependency array of `ensureHistoryLoaded` from `[]` to `[historyLoadingStore]` (stable, so the callback identity is still stable; the existing identity test must keep passing). Leave the call `await fetchProductHistoryClient(productId, timeframe)` exactly as it is: the batching happens inside it (step 1), and the per-product `setPriceHistory` calls that resolve together in one batch are merged into one render by React's automatic batching.

3f. In the return object replace `loadingProductIds,` with `historyLoadingStore,`. After WP03 the return is:

```ts
  return {
    products,
    priceHistory,
    loading,
    historyLoadingStore,
    ensureHistoryLoaded,
  };
```

3g. Update the comment block above `priceHistoryRef` (`:55-59`) only if it mentions `loadingProductIds`; it does not at a188fea.

### Step 4. SVG sparkline: rewrite `frontend/app/components/MarketView/MiniSparkline.tsx`; delete the Recharts version

4a. Replace the whole file with the code below (it already contains WP07's `recordedAtDateKey` change, so WP07's edit to this file is preserved). With a min/max-normalised polyline both the shape and the up/down colour are independent of the currency scale, so the component no longer takes `currency` or `exchangeRate`, and a USD/CAD toggle does zero sparkline work (F014 verifier correction 3). No `next/dynamic`, no ResizeObserver, so it renders on the server too.

```tsx
"use client";

import { memo, useMemo } from "react";
import { recordedAtDateKey } from "../../lib/format";
import type { PriceHistoryEntry } from "../ProductPrices/types";

interface MiniSparklineProps {
  history?: PriceHistoryEntry[];
  /** Keep only the newest N daily points. */
  days?: number;
  className?: string;
}

// The box is h-10 w-24 (40x96 px); the viewBox matches it 1:1.
const VIEW_WIDTH = 96;
const VIEW_HEIGHT = 40;
// Keeps a 2px stroke at the extremes from being clipped.
const PAD_Y = 2;
// Site palette: gain = emerald-600, loss = rose-600 (globals.css --pf-gain/--pf-loss).
const GAIN_STROKE = "#059669";
const LOSS_STROKE = "#e11d48";

// Pulsing wavy line shown while price history is loading or unavailable.
// Reads as "we're drawing a sparkline" instead of a dead grey rectangle.
function SparklineSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`h-10 w-24 ${className}`} aria-hidden>
      <svg
        viewBox="0 0 96 40"
        className="h-full w-full animate-pulse"
        preserveAspectRatio="none"
      >
        <path
          d="M0 28 L12 22 L24 30 L36 18 L48 26 L60 14 L72 22 L84 12 L96 18"
          fill="none"
          stroke="#cbd5e1"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export type SparklinePath = { points: string; isUp: boolean };

/**
 * One point per UTC day (the first row of a day wins, as before), newest
 * `days` kept, scaled into the 96x40 box between the series' own min and max.
 * Null when there are fewer than two daily points.
 *
 * Scale-invariant on purpose: multiplying every price by an exchange rate
 * changes neither the points nor isUp, so no currency input is needed.
 */
export function buildSparklinePath(
  history: PriceHistoryEntry[] | undefined,
  days: number
): SparklinePath | null {
  if (!history || history.length < 2) return null;

  const priceByDay = new Map<string, number>();
  for (const entry of history) {
    const dayKey = recordedAtDateKey(entry.recorded_at);
    if (dayKey === null || priceByDay.has(dayKey)) continue;
    if (!Number.isFinite(entry.usd_price)) continue;
    priceByDay.set(dayKey, entry.usd_price);
  }

  const prices = Array.from(priceByDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-days)
    .map(([, price]) => price);
  if (prices.length < 2) return null;

  let min = prices[0];
  let max = prices[0];
  for (const price of prices) {
    if (price < min) min = price;
    if (price > max) max = price;
  }

  const span = max - min;
  const stepX = VIEW_WIDTH / (prices.length - 1);
  const usableHeight = VIEW_HEIGHT - PAD_Y * 2;
  const points = prices
    .map((price, index) => {
      const x = index * stepX;
      const y =
        span === 0
          ? VIEW_HEIGHT / 2
          : PAD_Y + (1 - (price - min) / span) * usableHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return { points, isUp: prices[prices.length - 1] >= prices[0] };
}

function MiniSparkline({ history, days = 7, className = "" }: MiniSparklineProps) {
  const path = useMemo(() => buildSparklinePath(history, days), [history, days]);

  if (!path) {
    return <SparklineSkeleton className={className} />;
  }

  return (
    <div className={`h-10 w-24 ${className}`}>
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
        focusable="false"
      >
        <polyline
          points={path.points}
          fill="none"
          stroke={path.isUp ? GAIN_STROKE : LOSS_STROKE}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

// memo: a currency or timeframe change re-renders the card, but the
// sparkline's props (history array identity, days) do not change.
export default memo(MiniSparkline);
```

4b. Delete `frontend/app/components/charts/MiniSparklineImpl.tsx` (`git rm`).

4c. In `frontend/app/components/charts/ChartBundle.tsx` delete the two lines

```ts
export { default as MiniSparklineImpl } from "./MiniSparklineImpl";
export type { SparklinePoint } from "./MiniSparklineImpl";
```

Leave the `PriceChart`, `PortfolioChartImpl` and `AllocationChartImpl` exports and the header comment as they are.

4d. `frontend/app/components/MarketView/MarketView.tsx` sparkline cell (`:540-544`): replace

```tsx
                        <MiniSparkline
                          history={history}
                          currency={selectedCurrency}
                          exchangeRate={exchangeRate}
                        />
```

with

```tsx
                        <MiniSparkline history={history} />
```

Do not remove `selectedCurrency` or `exchangeRate` from that `useMemo`'s dependency array: `PriceChart` in the expanded row still uses them.

### Step 5. `frontend/app/components/ProductPrices/cards/ProductCard.tsx`

5a. Imports. Change the React import to `import { memo, useEffect, useRef, useState } from "react";` (`useCallback` is no longer used after 5d; if WP07 added another `useCallback` use, keep it). Add below the `../types` import:

```ts
import { HistoryLoadingStore, useIsHistoryLoading } from "../hooks/historyLoadingStore";
```

5b. Props interface: replace the line `historyLoading?: boolean;` (`:19`) with

```ts
  /**
   * Per-product loading flags from useProductData. The card subscribes to its
   * own id, so another card's load never re-renders this one. Omitted (tests,
   * static callers) means "never loading".
   */
  historyLoadingStore?: HistoryLoadingStore;
```

5c. Destructure: replace `historyLoading = false,` (`:60`) with `historyLoadingStore,`.

5d. Replace everything from `const [showFullChart, setShowFullChart] = useState(false);` through the end of the third effect (`:67-69` plus `:87-120`, i.e. the `cardRef`/`hasTriggeredLoad` declarations, `handleIntersection` and all three `useEffect`s) with the code below. Keep the lines between them that WP07 left (`setName`, `productType`, `generation`, `setCode`, `releaseDate`, `accentClass`, etc.) in place between the declarations and the effects exactly as they are now.

Top of the component body:

```tsx
  const [showFullChart, setShowFullChart] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // Latest timeframe for the observer callback, so the observer is created
  // once per card instead of being rebuilt on every timeframe change (F015).
  const chartTimeframeRef = useRef(chartTimeframe);
  // Whether the card is within 200px of the viewport right now. Not latched:
  // a timeframe change refetches only cards near the viewport; the rest
  // refetch when they next scroll in (F070).
  const isNearViewportRef = useRef(false);
  const historyLoading = useIsHistoryLoading(historyLoadingStore, product.id);
```

The effects (where `handleIntersection` and the three old effects were):

```tsx
  // Load history when the card comes near the viewport. Re-entering the
  // viewport calls again on purpose: after a timeframe change, off-screen
  // cards pick up the new range here. When the range is already loaded,
  // ensureHistoryLoaded returns the cache with no request and no state update.
  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        isNearViewportRef.current = entry.isIntersecting;
        if (entry.isIntersecting) {
          onLoadChart(product.id, chartTimeframeRef.current);
        }
      },
      { rootMargin: "200px 0px" }
    );
    observer.observe(node);

    return () => observer.disconnect();
  }, [product.id, onLoadChart]);

  // Timeframe change: refetch only if the user can currently see this card.
  // The old code refetched every card ever seen, up to ~306 at once (F070).
  useEffect(() => {
    chartTimeframeRef.current = chartTimeframe;
    if (isNearViewportRef.current) {
      onLoadChart(product.id, chartTimeframe);
    }
  }, [chartTimeframe, product.id, onLoadChart]);

  useEffect(() => {
    if (showFullChart) {
      onLoadChart(product.id, chartTimeframe);
    }
  }, [showFullChart, product.id, chartTimeframe, onLoadChart]);

  const hasHistory = (history?.length ?? 0) > 1;
```

Delete the old `const hasHistory = history && history.length > 1;` and `const fullChartToggleLabel = ...` lines (`:122-123`).

5e. Add this component above `const ProductCard = memo(...)` (after `VolumeChip`, and after WP07's `StalePriceNote` if present):

```tsx
// Always rendered so the card never grows when history arrives (F071):
// invisible (the box is kept) and disabled until there is something to show,
// visible and disabled with a label while this card's history is loading.
function FullChartToggle({
  hasHistory,
  loading,
  open,
  onToggle,
}: {
  hasHistory: boolean;
  loading: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const label = hasHistory
    ? open
      ? "Hide chart"
      : "Show full chart"
    : loading
      ? "Loading chart..."
      : "Show full chart";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!hasHistory}
      className={`rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors enabled:hover:bg-slate-50 enabled:hover:border-slate-300 disabled:cursor-default disabled:text-slate-400 ${
        hasHistory || loading ? "" : "invisible"
      }`}
    >
      {label}
    </button>
  );
}
```

5f. In BOTH branches replace the conditional button

```tsx
            {hasHistory && (
              <button
                type="button"
                onClick={() => setShowFullChart((prev) => !prev)}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
              >
                {fullChartToggleLabel}
              </button>
            )}
```

with

```tsx
            <FullChartToggle
              hasHistory={hasHistory}
              loading={historyLoading}
              open={showFullChart}
              onToggle={() => setShowFullChart((prev) => !prev)}
            />
```

Keep the `{showFullChart && hasHistory && (<LazyPriceChart ... />)}` block that follows it unchanged. `LazyPriceChart` is the only path from a card to `ChartBundle`/Recharts, and it mounts only after the user clicks.

5g. In BOTH branches replace the sparkline

```tsx
            <MiniSparkline
              history={history}
              currency={selectedCurrency}
              exchangeRate={exchangeRate}
              days={365}
            />
```

with `<MiniSparkline history={history} days={365} />` (same indentation as the original). `selectedCurrency` and `exchangeRate` stay card props: `ReturnMetrics` and `LazyPriceChart` use them.

5h. Card roots (F015, F126). Flat root (`:129`): replace

```tsx
        className={`bg-white rounded-xl ring-1 ring-slate-200 shadow-sm hover:shadow-md hover:ring-slate-300 transition-all overflow-hidden ${accentClass}`}
```

with

```tsx
        className={`pf-card-flat bg-white rounded-xl ring-1 ring-slate-200 shadow-sm hover:shadow-md hover:ring-slate-300 transition-shadow overflow-hidden ${accentClass}`}
```

Grouped root (`:232`): replace

```tsx
      className={`bg-white rounded-lg ring-1 ring-slate-200 shadow-sm hover:shadow-md hover:ring-slate-300 transition-all ${accentClass}`}
```

with

```tsx
      className={`pf-card-grouped bg-white rounded-lg ring-1 ring-slate-200 shadow-sm hover:shadow-md hover:ring-slate-300 transition-shadow ${accentClass}`}
```

`transition-shadow` covers the ring too: Tailwind 4 draws `ring-*` with `box-shadow`. The two `pf-card-*` classes have no styles of their own; step 7 styles them only inside `ProductGrid`.

### Step 6. Call sites of the hook and the card

6a. `frontend/app/components/ProductPrices/index.tsx` (after WP08). In the `useProductData` destructure replace `loadingProductIds,` with `historyLoadingStore,`. In each of the three `<ProductCard` elements (flat, grouped, type_grouped) replace

```tsx
historyLoading={loadingProductIds.includes(product.id)}
```

with

```tsx
historyLoadingStore={historyLoadingStore}
```

If WP08 wrapped the card lists in `useMemo`, replace `loadingProductIds` with `historyLoadingStore` in those dependency arrays. After this, `grep -n loadingProductIds app/components/ProductPrices/index.tsx` must print nothing. The page component no longer re-renders when a card starts or finishes loading; it re-renders once per arriving batch (the `priceHistory` update), and `ProductCard`'s `memo` keeps unaffected cards from re-rendering.

6b. `frontend/app/components/dashboard/RecentlyReleased.tsx`. Replace `:24-25` with

```tsx
  const { priceHistory, historyLoadingStore, ensureHistoryLoaded } =
    useProductData({ initialProducts });
```

and in the card (`:55`) replace `historyLoading={loadingProductIds.includes(product.id)}` with `historyLoadingStore={historyLoadingStore}`.

6c. `frontend/app/components/MarketView/MarketView.tsx`. MarketView shows loading text in a table cell and the expanded row, and re-renders its whole table anyway (row memoisation is WP19, F125), so it subscribes to the full list and keeps its `loadingProductIds` variable. Add to the imports:

```ts
import { useLoadingProductIds } from "../ProductPrices/hooks/historyLoadingStore";
```

Replace the destructure at `:206-212` with

```tsx
  const {
    products,
    priceHistory,
    loading,
    historyLoadingStore,
    ensureHistoryLoaded,
  } = useProductData({ initialProducts });
  const loadingProductIds = useLoadingProductIds(historyLoadingStore);
```

Every other use of `loadingProductIds` in the file (`:545`, `:567`, the `useMemo` deps at `:622`) stays unchanged: `readonly number[]` supports `.includes`, and the array identity changes exactly when the set changes.

### Step 7. Skip off-screen catalog cards: `frontend/app/components/ProductPrices/cards/ProductGrid.tsx` and `frontend/app/globals.css`

7a. `ProductGrid.tsx`: add the marker class to the grid:

```tsx
      className={`pf-card-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 ${className}`}
```

7b. `globals.css`: append at the end of the file:

```css
/*
 * /prices renders every catalog card (~306). Off-screen cards skip layout and
 * paint (F015). Scoped to ProductGrid children so the home page's horizontal
 * "Recently Released" strip is unaffected: a card revealed by horizontal
 * scrolling there could change the strip's height.
 *
 * The card root's own box is still laid out at the placeholder size, so the
 * IntersectionObserver in ProductCard keeps firing. `auto` makes the browser
 * remember each card's real size after its first render; the lengths only
 * matter for cards never rendered yet (scrollbar length). They include the
 * always-present "Show full chart" slot (~30px, F071). Tailwind 4 has no
 * utility for these properties.
 */
.pf-card-grid > .pf-card-flat {
  content-visibility: auto;
  contain-intrinsic-block-size: auto 550px;
}

.pf-card-grid > .pf-card-grouped {
  content-visibility: auto;
  /* Below sm the grouped card stacks: image on top (h-48) then details. */
  contain-intrinsic-block-size: auto 430px;
}

@media (min-width: 40rem) {
  .pf-card-grid > .pf-card-grouped {
    contain-intrinsic-block-size: auto 210px;
  }
}
```

`40rem` is Tailwind 4's `sm` breakpoint. The block-size longhand is used (not the `contain-intrinsic-size` shorthand) so the placeholder never implies a width; card widths always come from the grid track. The plan's figures (520 / 400 / 180 px) were measured without the button slot; these add its 30 px.

### Step 8. Drawer without `max-height`: `frontend/app/components/ProductPrices/controls/ControlBar.tsx`

8a. Change the React import to `import { useId, useState } from "react";` and add `const panelId = useId();` directly below `const [drawerOpen, setDrawerOpen] = useState(false);`.

8b. On the mobile trigger `<button>` (`:107-112`) add `aria-controls={panelId}` next to `aria-expanded={drawerOpen}`.

8c. Replace the panel (`:129-189`, from the `{/* Filter panel ... */}` comment through the `</div>` that closes the panel, which is the one immediately before the outer card's closing `</div>`) with the structure below. The children (the filter flex row and the Done button) are unchanged; only the wrappers change.

```tsx
      {/* Filter panel: collapsible on mobile, always open on md+.
          Animates grid-template-rows 0fr -> 1fr instead of max-height and
          margin-top (F126). The spacing lives on an inner element so the
          collapsed row is truly 0px tall. */}
      <div
        id={panelId}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out md:grid-rows-[1fr] md:opacity-100 md:transition-none ${
          drawerOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden md:overflow-visible">
          <div className="pt-3 md:pt-0">
            <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:gap-x-5 md:gap-y-3">
              {/* ...the existing children of this flex row, unchanged:
                  GenerationFilter, ProductTypeFilter, SearchInput, AgeFilter,
                  ChartTimeframeButtons, the md:ml-auto CurrencySelector div... */}
            </div>

            {/* Done button: mobile only */}
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="md:hidden mt-3 w-full rounded-lg bg-[var(--pf-pokeblue)] hover:bg-[var(--pf-pokeblue-strong)] text-white py-2 text-sm font-semibold transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
```

Paste the real children from `:138-178` where the placeholder comment is; do not leave the comment in the file. `ControlBar` is also used by `/market` (`MarketView.tsx:635`), which gets the same behaviour. Honest expectation: the list below the bar still moves down frame by frame while the drawer opens (any height animation does that), but the cards are only translated, not re-laid-out internally, and with step 7 off-screen cards are skipped; the win is dropping the `transition-all` over layout properties and the 1000px `max-height` easing curve.

## Pitfalls: do not do this

- **Do not keep Recharts for the sparkline behind an IntersectionObserver.** The verifier noted both existing observers latch (`ProductCard.tsx:88-96` via `hasTriggeredLoad`, `LazyPriceChart.tsx:30-54`), so "unmount when off-screen" would need a new non-latching observer and still download the 118 kB chunk. The inline SVG removes the chunk, the stores and the ResizeObservers outright.
- **Do not pass `currency`/`exchangeRate` to `MiniSparkline` and do not precompute sparkline points in `useProductData`.** F014 verifier correction 3: the normalised polyline and its colour are scale-invariant, so the memo keys on `history` and `days` only. WP07's pitfall also forbids moving presentation into the data hook.
- **Do not keep `next/dynamic` or `ssr: false` in `MiniSparkline`.** The SVG has no browser-only dependency; server-rendering it is the point (WP08 puts the cards in the static HTML).
- **Do not issue one `.in("product_id", ids)` query for a whole batch without chunking.** PostgREST truncates at 1000 rows without an error. At 3M, 20 products are about 1,860 rows: the later products would get a partial or empty history, and `ensureHistoryLoaded` would record that range as loaded and never refetch it.
- **Do not treat "no rows for a product" as a failure.** Resolve `[]` and cache it; four live products (e.g. id 442) have zero history, and the existing test "does not refetch a product whose history is legitimately empty" must keep passing.
- **Do not reject a whole batch when one chunk fails**, and do not cache anything for a failed chunk: the existing test "clears the loading flag and returns [] when the fetch fails" requires a retry to refetch.
- **Do not put the loading flags back into React state in `useProductData`, and do not compute `loadingProductIds.includes(product.id)` in the parent.** Either one re-renders the whole card list per card (the F070 defect). Use the store.
- **Do not reintroduce the `hasTriggeredLoad` latch or refetch every previously seen card on a timeframe change.** Only cards near the viewport refetch; the rest refetch on re-entry. Keep the observer connected after the first load; that is what makes re-entry work.
- **Do not add `chartTimeframe` to the observer effect's dependencies.** Read it from `chartTimeframeRef`; otherwise every timeframe change rebuilds ~306 observers (F015 verifier correction 3).
- **Do not render `--` placeholders in `ReturnMetrics`.** F071 verifier: the number of return lines is fixed by the server summary and does not change when history arrives; placeholders would add noise lines without preventing any shift. Leave `ReturnMetrics.tsx` untouched.
- **Do not use `hidden`, `display:none` or conditional rendering for the button slot.** Those remove the box. `invisible` (visibility: hidden) keeps it and also removes it from the accessibility tree and tab order.
- **Do not use the finder's `contain-intrinsic-size: auto 280px`.** F015 verifier: a flat card is ~500-550 px and a grouped card is ~400 px below `sm`. Use the step 7 values.
- **Do not put `content-visibility` on the card root unconditionally.** On the home page strip (`RecentlyReleased.tsx:47-63`, horizontal scroller) a card revealed by horizontal scrolling could render taller than its placeholder and shift the section. The rule is scoped to `.pf-card-grid > ...`.
- **Do not add a virtualization library** (`@tanstack/react-virtual`, `react-window`). F015 verifier: the default view is grouped, windowing adds nothing over `content-visibility` for layout and paint, and its render-cost benefit is delivered here by the SVG sparkline and the store.
- **Do not add a database RPC or migration** (for example a `get_product_sparklines` function). That is outside this package; WP10 and WP11 own database and caching changes.
- **Do not wait on real 100 ms timers in new tests.** Use `jest.useFakeTimers()` and `await jest.advanceTimersByTimeAsync(100)`.
- **Do not remove `SparklineSkeleton`, `LazyPriceChart`, or the `PriceChart`/`PortfolioChartImpl`/`AllocationChartImpl` exports from `ChartBundle`.** Only `MiniSparklineImpl` goes.
- **Do not change `useCurrencyConversion`, `ReturnMetrics`, `ScrollToTop` (its `transition-all` is a fixed button, out of scope) or anything in `serverMarketData.ts`.**

## Tests

Run all new and updated tests with `pnpm test --ci <path>` from `frontend/`.

### New: `frontend/app/components/MarketView/__tests__/MiniSparkline.test.tsx`

Cases:
1. `buildSparklinePath` returns `null` for `undefined`, `[]`, one entry, and two entries on the same UTC day.
2. Rising series: `isUp === true`; the number of points equals the number of days; first x is `0`, last x is `96`; the lowest price has y `38.00`, the highest y `2.00`.
3. Falling series: `isUp === false`.
4. Flat series: every y is `20.00`.
5. `days` keeps the newest N days (10 daily entries, `days = 7` gives 7 points, the first is day 4).
6. Rendering: `<MiniSparkline history={rising} />` renders one `polyline` with `stroke="#059669"`; a falling series uses `#e11d48`; `<MiniSparkline />` with no history renders the skeleton (an element with class `animate-pulse`) and no `polyline`.
7. It never loads Recharts: mock `../../charts/ChartBundle` with a factory that throws; rendering a sparkline with history must not throw.

```tsx
import { render } from "@testing-library/react";
import MiniSparkline, { buildSparklinePath } from "../MiniSparkline";
import type { PriceHistoryEntry } from "../../ProductPrices/types";

// If MiniSparkline (or anything it imports) ever loads the chart bundle
// again, this factory runs and the test file fails.
jest.mock("../../charts/ChartBundle", () => {
  throw new Error("MiniSparkline must not load Recharts");
});

function daily(prices: number[]): PriceHistoryEntry[] {
  return prices.map((usd_price, index) => ({
    usd_price,
    recorded_at: `2026-09-${String(index + 1).padStart(2, "0")}T04:00:00`,
  }));
}

function parsePoints(points: string): Array<[number, number]> {
  return points.split(" ").map((pair) => pair.split(",").map(Number) as [number, number]);
}

describe("buildSparklinePath", () => {
  it("needs two distinct days", () => {
    expect(buildSparklinePath(undefined, 7)).toBeNull();
    expect(buildSparklinePath([], 7)).toBeNull();
    expect(buildSparklinePath(daily([10]), 7)).toBeNull();
    expect(
      buildSparklinePath(
        [
          { usd_price: 10, recorded_at: "2026-09-01T01:00:00" },
          { usd_price: 12, recorded_at: "2026-09-01T20:00:00" },
        ],
        7
      )
    ).toBeNull();
  });

  it("scales a rising series into the 96x40 box", () => {
    const path = buildSparklinePath(daily([10, 15, 20]), 7)!;
    expect(path.isUp).toBe(true);
    const points = parsePoints(path.points);
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual([0, 38]);
    expect(points[2]).toEqual([96, 2]);
  });

  it("is the same for any currency scale", () => {
    const usd = buildSparklinePath(daily([10, 12, 9]), 7);
    const cad = buildSparklinePath(daily([13.6, 16.32, 12.24]), 7);
    expect(cad).toEqual(usd);
  });

  // ...falling, flat (all y === 20), days slice
});

describe("<MiniSparkline>", () => {
  it("draws a gain-coloured polyline", () => {
    const { container } = render(<MiniSparkline history={daily([10, 15])} />);
    const line = container.querySelector("polyline");
    expect(line).not.toBeNull();
    expect(line!.getAttribute("stroke")).toBe("#059669");
  });

  it("shows the skeleton without history", () => {
    const { container } = render(<MiniSparkline />);
    expect(container.querySelector("polyline")).toBeNull();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });
});
```

If the currency-scale case fails on a floating-point last digit (it should not, because points are rounded to 2 decimals), compare `parsePoints` output with `toBeCloseTo` per coordinate instead of weakening the assertion.

### New: `frontend/app/components/MarketView/__tests__/MiniSparkline.ssr.test.tsx`

Proves the sparkline is in server HTML (no `ssr: false`):

```tsx
/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server";
import MiniSparkline from "../MiniSparkline";

it("renders the polyline on the server", () => {
  const html = renderToStaticMarkup(
    <MiniSparkline
      history={[
        { usd_price: 10, recorded_at: "2026-09-01T04:00:00" },
        { usd_price: 11, recorded_at: "2026-09-02T04:00:00" },
      ]}
    />
  );
  expect(html).toContain("<polyline");
});
```

### New: `frontend/app/lib/__tests__/clientMarketData.history.test.ts`

Mock the Supabase builder chain the batcher uses: `from().select().in().gte().order().order().order().range()`.

```ts
const fromMock = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    rpc: jest.fn(),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

jest.mock("../logger", () => ({
  logSupabaseError: jest.fn(),
  logCaughtError: jest.fn(),
}));

type Row = { product_id: number; usd_price: number; recorded_at: string };

let inCalls: number[][];
let rangeCalls: Array<[number, number]>;

function rowsFor(ids: number[], perProduct = 3): Row[] {
  return ids.flatMap((id) =>
    Array.from({ length: perProduct }, (_, day) => ({
      product_id: id,
      usd_price: id * 100 + day,
      recorded_at: `2026-09-${String(day + 1).padStart(2, "0")}T04:00:00`,
    }))
  );
}

function mockHistoryQuery(
  respond: (ids: number[], from: number) => { data: Row[] | null; error: unknown }
) {
  fromMock.mockImplementation(() => {
    let ids: number[] = [];
    const builder = {
      select: () => builder,
      in: (_column: string, values: number[]) => {
        ids = values;
        inCalls.push(values);
        return builder;
      },
      gte: () => builder,
      order: () => builder,
      range: (from: number, to: number) => {
        rangeCalls.push([from, to]);
        return Promise.resolve(respond(ids, from));
      },
    };
    return builder;
  });
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  jest.useFakeTimers();
  inCalls = [];
  rangeCalls = [];
});

afterEach(() => {
  jest.useRealTimers();
});

it("answers 25 cards at 3M with three chunked queries", async () => {
  const { fetchProductHistoryClient } = await import("../clientMarketData");
  mockHistoryQuery((ids) => ({ data: rowsFor(ids), error: null }));

  const ids = Array.from({ length: 25 }, (_, index) => index + 1);
  const pending = ids.map((id) => fetchProductHistoryClient(id, "3M"));
  expect(fromMock).not.toHaveBeenCalled(); // still inside the window

  await jest.advanceTimersByTimeAsync(100);
  const results = await Promise.all(pending);

  expect(fromMock).toHaveBeenCalledTimes(3);
  expect(inCalls.map((chunk) => chunk.length)).toEqual([10, 10, 5]);
  results.forEach((history, index) => {
    expect(history).toHaveLength(3);
    expect(history.every((entry) => Math.floor(entry.usd_price / 100) === ids[index])).toBe(true);
  });
});
```

Further cases, same file:
1. **1Y chunks by two**: 5 ids at `"1Y"` give `inCalls` lengths `[2, 2, 1]`.
2. **Separate windows, separate queries**: request id 1, advance 100 ms, request id 2, advance 100 ms: `inCalls` equals `[[1], [2]]`.
3. **Dedupe and cache**: two calls for `(1, "3M")` before the flush return the same promise (`toBe`) and produce one id in `inCalls`; after it resolves, `fetchProductHistoryClient(1, "1M")` resolves without advancing timers and `fromMock` is not called again.
4. **Empty history is a result**: respond with rows only for id 2; id 1 resolves `[]`; a second call for id 1 makes no query.
5. **Paging safety net**: respond with 1000 rows for `from === 0` and 5 rows for `from === 1000` (make the ids `[1]` at `"7D"` and generate the rows directly); `rangeCalls` equals `[[0, 999], [1000, 1999]]` and the result has 1005 entries.
6. **A failed chunk rejects only its products**: 12 ids at `"3M"`; respond `{ data: null, error: { message: "boom" } }` when `ids.includes(1)`. Use `Promise.allSettled`: ids 1 to 10 are `rejected`, 11 and 12 `fulfilled`. Requesting id 1 again queues a new query (`fromMock` call count increases after another 100 ms).

### Update: `frontend/app/lib/__tests__/clientMarketData.cache.test.ts`

Only the last test ("expires cached price history on the same clock as the products cache", `:114-145`) changes; the three product-cache tests stay as they are. Replace its `fromMock.mockImplementation(...)` with a builder like the one above whose `range` resolves `current`, and advance the batch window for every call that is not a cache hit:

```ts
    let current = history(100);
    fromMock.mockImplementation(() => {
      const builder = {
        select: () => builder,
        in: () => builder,
        gte: () => builder,
        order: () => builder,
        range: () => Promise.resolve(current),
      };
      return builder;
    });

    const first = fetchProductHistoryClient(1, "1M");
    await jest.advanceTimersByTimeAsync(100);
    expect((await first)[0].usd_price).toBe(100);

    current = history(142);

    jest.advanceTimersByTime(59 * 60 * 1000);
    // Cache hit: resolves without the batch timer.
    expect((await fetchProductHistoryClient(1, "1M"))[0].usd_price).toBe(100);

    jest.advanceTimersByTime(2 * 60 * 1000);
    const refreshed = fetchProductHistoryClient(1, "1M");
    await jest.advanceTimersByTimeAsync(100);
    expect((await refreshed)[0].usd_price).toBe(142);
```

Keep the test's name and comment.

### Update: `frontend/app/components/MarketView/__tests__/useProductData.test.tsx`

1. `:164` and `:183`: replace `expect(result.current.loadingProductIds).toEqual([]);` with `expect(result.current.historyLoadingStore.getLoadingIds()).toEqual([]);`. In the comment at `:73` change "flips loadingProductIds and priceHistory" to "flips the loading store and priceHistory". Everything else in the existing tests stays.
2. Add a `describe("useProductData - loading flags stay out of React state", ...)` with:

```tsx
  it("does not re-render the host when a load starts, only when history arrives", async () => {
    let resolveFetch!: (history: PriceHistoryEntry[]) => void;
    fetchHistoryMock.mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve; })
    );

    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useProductData({ initialProducts: PRODUCTS });
    });
    const before = renders;

    let pending!: Promise<PriceHistoryEntry[]>;
    act(() => {
      pending = result.current.ensureHistoryLoaded(475, "3M");
    });
    expect(renders).toBe(before);
    expect(result.current.historyLoadingStore.isLoading(475)).toBe(true);

    await act(async () => {
      resolveFetch(makeHistory(3));
      await pending;
    });
    expect(renders).toBe(before + 1);
    expect(result.current.priceHistory[475]).toHaveLength(3);
    expect(result.current.historyLoadingStore.isLoading(475)).toBe(false);
  });
```

3. "stays loading while a wider range is still in flight": two deferred fetches (3M then 1Y for id 475); resolve 3M: `isLoading(475)` is still `true`; resolve 1Y: `false`, and `priceHistory[475]` is the 1Y array.

### New: `frontend/app/components/ProductPrices/__tests__/historyLoadingStore.test.tsx`

1. `start` then `finish` notify listeners once each; a second `start` of the same id and a `finish` of an unknown id do not notify.
2. `getLoadingIds()` returns the same array identity across calls with no change, and a new identity after a change.
3. `useIsHistoryLoading`: render two small components subscribed to ids 1 and 2 with render counters; `act(() => store.start(1))` re-renders only the id-1 component and it now reports `true`.
4. `useIsHistoryLoading(undefined, 1)` returns `false`.

### New: `frontend/app/components/ProductPrices/__tests__/ProductCard.history.test.tsx`

Mock `../shared/ProductImage` to `() => null` and `../shared/LazyPriceChart` to `() => <div data-testid="full-chart" />` (as WP07's `ProductCard.format.test.tsx` does). Keep `MiniSparkline` real. Use a controllable IntersectionObserver:

```tsx
type ObserverRecord = { callback: IntersectionObserverCallback; elements: Element[] };
let observers: ObserverRecord[] = [];

class MockIntersectionObserver {
  private record: ObserverRecord;
  constructor(callback: IntersectionObserverCallback) {
    this.record = { callback, elements: [] };
    observers.push(this.record);
  }
  observe(element: Element) {
    this.record.elements.push(element);
  }
  unobserve() {}
  disconnect() {
    this.record.elements = [];
  }
  takeRecords() {
    return [];
  }
}

function setNearViewport(isIntersecting: boolean) {
  act(() => {
    for (const record of observers) {
      for (const element of record.elements) {
        record.callback(
          [{ isIntersecting, target: element } as unknown as IntersectionObserverEntry],
          {} as IntersectionObserver
        );
      }
    }
  });
}

beforeEach(() => {
  observers = [];
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    MockIntersectionObserver;
});
```

Base props: `product` (like WP07's `makeProduct`), `chartTimeframe: "3M"`, `selectedCurrency: "USD"`, `exchangeRate: 1.36`, `formatPrice: (p) => String(p)`, `onLoadChart: jest.fn()`. Cases:

1. **Slot reserved without history** (flat and grouped): `screen.getByRole("button", { name: "Show full chart" })` exists, `toBeDisabled()`, `toHaveClass("invisible")`.
2. **Loading label**: with `historyLoadingStore` where `store.start(product.id)` was called, the button reads "Loading chart...", is disabled and does not have `invisible`.
3. **With history**: `history` of 3 daily entries: button enabled, no `invisible`; clicking it shows `getByTestId("full-chart")` and the label "Hide chart".
4. **Only the affected card reacts**: two cards (ids 1 and 2) sharing one store; `act(() => store.start(1))`: card 1 shows "Loading chart...", card 2 still has the invisible "Show full chart".
5. **Observer behaviour**: `setNearViewport(true)` calls `onLoadChart(1, "3M")` once; `rerender` with `chartTimeframe="1Y"` calls `onLoadChart(1, "1Y")`; `setNearViewport(false)` then `rerender` with `"6M"` does NOT call `onLoadChart` with `"6M"`; `setNearViewport(true)` then calls `onLoadChart(1, "6M")`. Throughout, `observers.length` stays `1` (no rebuild on timeframe change).
6. **Root classes**: flat root (`container.firstChild`) has `pf-card-flat` and `transition-shadow` and not `transition-all`; grouped root has `pf-card-grouped`.

### Check, do not rewrite: `frontend/app/components/ProductPrices/__tests__/ProductCard.format.test.tsx` (WP07)

Its `baseProps` do not pass `historyLoading`, so it compiles unchanged. If it does pass `historyLoading`, delete that one prop; do not change any assertion.

### New: `frontend/app/components/ProductPrices/__tests__/ControlBar.test.tsx`

Render `ControlBar` with minimal props (`selectedGeneration="all"`, `availableGenerations={[]}`, `searchTerm=""`, `chartTimeframe="3M"`, `selectedCurrency="USD"`, `exchangeRate={1.36}`, `exchangeRateLoading={false}`, no-op callbacks). Find the trigger with `screen.getByRole("button", { name: /Filters/ })`, the panel with `document.getElementById(trigger.getAttribute("aria-controls")!)`. Assert: closed panel has `grid-rows-[0fr]` and no class containing `max-h-`; after `fireEvent.click(trigger)` it has `grid-rows-[1fr]` and `aria-expanded="true"`; clicking "Done" closes it again.

## Verification

From `frontend/`:

```bash
pnpm exec tsc --noEmit
# expect: no output, exit 0

pnpm exec eslint app/lib/clientMarketData.ts \
  app/components/ProductPrices/hooks/historyLoadingStore.ts \
  app/components/ProductPrices/hooks/useProductData.ts \
  app/components/MarketView/MiniSparkline.tsx app/components/MarketView/MarketView.tsx \
  app/components/charts/ChartBundle.tsx \
  app/components/ProductPrices/cards/ProductCard.tsx app/components/ProductPrices/cards/ProductGrid.tsx \
  app/components/ProductPrices/controls/ControlBar.tsx app/components/ProductPrices/index.tsx \
  app/components/dashboard/RecentlyReleased.tsx \
  app/components/MarketView/__tests__ app/components/ProductPrices/__tests__ app/lib/__tests__/clientMarketData.history.test.ts app/lib/__tests__/clientMarketData.cache.test.ts
# expect: 0 errors, 0 warnings (the old ProductCard 'historyLoading' warning is gone)

pnpm test --ci app/components/MarketView app/components/ProductPrices app/lib/__tests__/clientMarketData.cache.test.ts app/lib/__tests__/clientMarketData.history.test.ts
# expect: all suites pass

pnpm test --ci
# expect: full suite passes, no "open handles" or act() warnings from the new files

pnpm build:stub
# expect: exit 0. The stub serves no rows, so /prices has no cards in this build; it proves the build, not the data.

# Static proofs (expected output in comments):
grep -rn "MiniSparklineImpl\|SparklinePoint" app                          # no output
grep -rn "ChartBundle\|recharts" app/components/ProductPrices app/components/MarketView/MiniSparkline.tsx app/components/dashboard
#   only ResponsivePriceChart.tsx:9,11 and LazyPriceChart.tsx:9 (a comment): the full chart, mounted on click
grep -c '\.in("product_id"' app/lib/clientMarketData.ts                   # 2 (freshness + history)
grep -rn "loadingProductIds" app --include=*.ts --include=*.tsx
#   only MarketView.tsx (the useLoadingProductIds variable and its existing reads at :545, :567, :622)
grep -rn "hasTriggeredLoad\|transition-all" app/components/ProductPrices/cards app/components/ProductPrices/controls   # no output
grep -n "max-h-" app/components/ProductPrices/controls/ControlBar.tsx      # no output
grep -c "content-visibility: auto" app/globals.css                        # 2
```

Report in the PR the request counts the new jest tests prove: 25 cards at 3M produce 3 history requests (was 25); a timeframe change requests only cards near the viewport (was every card ever seen).

Manual checks (need real data; do them on the Vercel preview deployment of this PR, see Owner actions, or locally with `pnpm dev` if you have a `.env.local` pointing at the project's public URL and anon key):

1. Open `/prices` in Chrome, DevTools Network tab, "Disable cache" on, reload. Type `product_price_history` in the filter box. Before scrolling: note the request count (expect 1 to 3 at desktop width; production before this PR shows one per visible card, 12 to 20). Scroll slowly to the bottom: expect roughly 30 to 60 in total (production: about 306).
2. Same page, filter `chunks`, sort by Size. Before this PR one chunk of about 118 kB transferred (about 415 kB resource) appears as soon as the first sparklines draw. After: no such chunk appears while loading or scrolling; it appears exactly once after clicking "Show full chart" on any card.
3. Switch the chart timeframe from 3M to 1Y after scrolling halfway: expect only a handful of new `product_price_history` requests (visible cards, 2 per request at 1Y), not a burst of hundreds. Scroll back up: cards refetch as they come into view.
4. Toggle USD/CAD after a full scroll: no visible freeze; sparklines do not change shape; prices change.
5. Watch a card while it loads: the button slot shows "Loading chart..." then "Show full chart"; the card height does not change. Same on `/` in "Recently Released".
6. In the Elements panel, pick an off-screen card in `/prices` grouped view and check Computed: `content-visibility: auto`. Scroll to it: it renders and its history still loads (the IntersectionObserver fires).
7. At 375 px width, open and close the Filters drawer: it slides open and closed smoothly, with no content visible when closed. At 1024 px width the filters are always visible and the Filters button is hidden. Check `/market` too.
8. Console: no React hydration warnings and no Recharts "width(0) and height(0)" warnings while scrolling with a full chart open.

## Owner actions

1. **Confirm the API row cap is 1000 (read-only check).** Supabase Dashboard, project, Project Settings, API (Data API settings), "Max rows". Expected: `1000`. The batcher sizes chunks to fit 1000 rows and treats a page shorter than 1000 as the last page, like the existing `fetchNewestPricedAtClient`. If the value is lower, do not merge: tell the executor the value so `HISTORY_PAGE_SIZE` is set to it. If it is higher, nothing to do.
2. **Measure before and after.** Before merging, run manual checks 1 and 2 on production (`/prices`) and write down the numbers; then run manual checks 1 to 8 on this PR's Vercel preview deployment and add both sets of numbers to the PR. Done when the preview shows no roughly 118 kB Recharts chunk until "Show full chart" is clicked and at most about 60 `product_price_history` requests for a full scroll.

No migrations, no environment variables, no dashboard toggles.

## Acceptance criteria

- [ ] `app/components/charts/MiniSparklineImpl.tsx` is deleted and `ChartBundle.tsx` no longer exports `MiniSparklineImpl` or `SparklinePoint`.
- [ ] `MiniSparkline` renders an inline `<svg><polyline>` with no `next/dynamic`, no `currency`/`exchangeRate` props, and its markup appears in server-rendered HTML (SSR test passes).
- [ ] On the preview, `/` and `/prices` load no Recharts chunk until "Show full chart" is clicked.
- [ ] History for all products requested within 100 ms is fetched with `.in("product_id", ...)` in chunks of at most `floor(1000 / (days + 3))` products; 25 cards at 3M produce 3 requests.
- [ ] A product with no history resolves `[]` and is not refetched; a failed chunk rejects only its own products and can be retried.
- [ ] `useProductData` no longer holds loading flags in React state and returns `historyLoadingStore` instead of `loadingProductIds`; starting a load does not re-render the host component.
- [ ] A timeframe change refetches only cards near the viewport; each card creates exactly one IntersectionObserver for its lifetime.
- [ ] The "Show full chart" button is always rendered: invisible and disabled with no history, "Loading chart..." while loading, enabled once history exists; card height does not change when history arrives.
- [ ] `/prices` catalog cards (inside `ProductGrid`) have `content-visibility: auto` with the step 7 intrinsic block sizes; home page cards do not.
- [ ] Card roots use `transition-shadow`, not `transition-all`; the filter drawer animates `grid-template-rows` and contains no `max-h-` class.
- [ ] `tsc`, eslint on changed files, the full jest suite and `pnpm build:stub` all pass.

## Rollback

Code only, no migrations or data changes. Revert the merge commit (`git revert -m 1 <merge-sha>`) and redeploy; the old Recharts sparkline, per-product history queries and `loadingProductIds` return together. Partial rollback is not supported: the card, the hook, `MarketView` and `RecentlyReleased` change props together, so revert the whole PR. The browser-side history cache is in memory only, so no client state survives a deploy.

## Commit and PR

Commit message:

```
perf(prices): SVG sparklines, batched history, stable card layout

- MiniSparkline draws an inline SVG polyline (server-rendered, no currency
  props); the Recharts MiniSparklineImpl is removed, so / and /prices load
  no charting library until a full chart is opened (F014, F066).
- fetchProductHistoryClient batches requests made within 100 ms into
  chunked .in("product_id") queries sized to PostgREST's 1000-row page, with
  a paging safety net (F070, F067).
- Per-product loading flags move to a small external store; cards subscribe
  to their own id, so a load no longer re-renders the whole list. A
  timeframe change refetches only cards near the viewport, and each card
  keeps one IntersectionObserver (F070, F015).
- Catalog cards get content-visibility: auto with intrinsic sizes (F015);
  the "Show full chart" slot is always rendered (F071); cards use
  transition-shadow and the mobile filter drawer animates
  grid-template-rows instead of max-height (F126).
```

PR title: `perf(prices): SVG sparklines, batched history, stable card layout (WP09)`

PR body summary: link `audits/remediation/WP09-prices-card-rendering.md`; list F014, F066, F070, F067, F015, F071, F126; paste the Verification command output; include the before/after request and chunk counts from Owner action 2 (or state that they are pending on the preview); note that `ReturnMetrics` was intentionally not changed (F071 verifier) and that MarketView row memoisation is WP19; list any other findings noticed but not fixed.
