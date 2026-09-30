# WP08: /prices: URL state without navigation, server-rendered catalog

- **Findings covered**
  - F012 (full, cluster members F012, F025): `ProductPrices` calls `useSearchParams()` at the top of the container (`frontend/app/components/ProductPrices/index.tsx:77`) under the page's only `<Suspense>` (`frontend/app/prices/page.tsx:30-37`), so the statically prerendered `/prices` HTML contains only "Loading…" and the ~306 cards appear after hydration.
  - F016 (full): every search keystroke runs `router.replace` (`index.tsx:150`), which in Next 16.3.6 is a real App Router navigation that refetches the whole page RSC payload per distinct query and re-renders all cards; filtering keys on the raw `searchTerm` with no deferral; `sortProducts` builds two `Date`s per comparison.
  - F054 (full, cluster members F054, F121): URL sync is one-way (state to URL). Clicking the header "Prices" link or using back/forward on `/prices` is reverted to the stale filters, and unknown query keys (`utm_source`) are stripped on mount.
- **Priority rationale**: `/prices` is the primary public catalog; this PR puts its content in the first HTML and removes a full-catalog download per keystroke, and it must land before WP09 reworks the same card list.
- **Effort**: M (5 to 7 hours, including the manual browser checks).
- **Depends on**: WP03 (removes the "Loading price history" toast and `historyLoading` from the `useProductData` destructure in `index.tsx`; fixes the "updated daily" copy in `prices/page.tsx`), WP07 (deterministic date formatting in `ProductCard.tsx` and `GroupHeader.tsx`, a hard prerequisite: once cards are server-rendered, any viewer-timezone formatting in them becomes a hydration mismatch on every card), WP00 (`pnpm build:stub`, `scripts/supabase-stub.mjs`).
- **Unblocks**: WP09 (edits the card list, which now lives in one `useMemo` named `cardList`), WP19 (the F045 verifier requires any shared URL-state helper to be built on `window.location`, not `useSearchParams`; `app/lib/locationSearch.ts` from this PR is that helper), WP20 (F105's currency context must read `?currency=` through `useLocationSearch`, never `useSearchParams` in the layout), WP11 and WP13 (they edit `prices/page.tsx`, which no longer has a `<Suspense>` wrapper).
- **Suggested branch name**: `remediation/wp08-prices-url-state-and-ssr`
- **Risk level**: medium. It changes how the busiest page renders (server HTML plus hydration instead of client-only) and how its URL is written; mistakes show up as hydration errors or filters that reset, both covered by the new tests and the manual checks.

## Why

Today a visitor opening `/prices` gets the page title and a grey "Loading…" line; the filter bar and every product card only appear after about 230 kB of JavaScript has downloaded and hydrated, which is one to two seconds on a mid-range phone, and crawlers and link previews see no products at all. The cause is one hook: `useSearchParams()` in a statically prerendered route makes Next skip everything up to the nearest `<Suspense>` in the static HTML, and here that is the whole catalog. Typing in the search box is also expensive: each letter triggers `router.replace`, which Next 16 treats as a navigation that re-downloads the entire catalog payload and re-renders all ~306 cards, so typing "booster" downloads the catalog seven times. Finally, the URL sync only goes one way: with a filter applied, clicking "Prices" in the header or pressing Back snaps the URL back to the old filter. After this PR the prerendered HTML contains the controls and every card, typing makes zero network requests and writes the URL once, 250 ms after the user pauses, and navigations that change the query (header link, back/forward) re-apply the URL's filters.

## Before you start

Read these files fully:

- `frontend/app/components/ProductPrices/index.tsx` (the container; 346 lines at review time, fewer after WP03).
- `frontend/app/prices/page.tsx` (42 lines).
- `frontend/app/components/ProductPrices/hooks/useProductData.ts` (the "adjust state during render" latch at lines 43-47 is the pattern this PR reuses).
- `frontend/app/components/ProductPrices/hooks/useCurrencyConversion.ts` (owns `selectedCurrency`; its `setSelectedCurrency` is called from the container).
- `frontend/app/components/ProductPrices/utils/sorting.ts` and `__tests__/sorting.test.ts`.
- `frontend/app/components/MarketView/MarketView.tsx:224-233` and `:438-451` (the `useDeferredValue` plus memoized table body pattern this PR copies).
- `frontend/scripts/supabase-stub.mjs`, `frontend/scripts/build-with-stub.mjs`, `frontend/scripts/supabase-stub.test.mjs` (added by WP00).
- `frontend/node_modules/next/dist/client/components/app-router.js:38-72` (`HistoryUpdater`) and `:233-306` (the `pushState`/`replaceState` patches and `popstate` handler). These explain why the design below needs `LocationSearchSignal`.

Run from `frontend/` and check each result:

```bash
git log --oneline -15                      # WP00, WP03 and WP07 merges must be present

# The bug still exists
grep -n 'useSearchParams\|router.replace\|usePathname' app/components/ProductPrices/index.tsx
#   expect: the import on line 4, `useSearchParams()` near line 77, `router.replace(` near line 150
grep -n 'Suspense' app/prices/page.tsx
#   expect: line 1 (import) and lines 30-37 (comment + wrapper)

# WP03 landed (toast gone)
grep -rn 'Loading price history' app          # expect: no output
grep -n 'historyLoading' app/components/ProductPrices/index.tsx
#   expect: exactly 3 hits, the per-card `historyLoading={loadingProductIds.includes(product.id)}` props

# WP07 landed (no viewer-locale or viewer-timezone formatting in server-rendered card markup)
grep -nE 'toLocale|resolvedOptions' app/components/ProductPrices/cards/ProductCard.tsx app/components/ProductPrices/cards/GroupHeader.tsx
#   expect: no output. If there is output, STOP: WP07 has not landed. Server-rendering the cards
#   with `toLocaleString(undefined, { timeZone: <viewer zone> })` makes every card a hydration
#   mismatch and React 19 would re-render the page on the client, undoing this PR's gain.

# WP00 landed
grep -n '"build:stub"\|"test:scripts"' package.json    # expect both
ls scripts/supabase-stub.mjs scripts/build-with-stub.mjs scripts/supabase-stub.test.mjs

# Clean lint baseline on the files this PR touches
pnpm exec eslint app/components/ProductPrices/index.tsx app/components/ProductPrices/utils/sorting.ts app/prices/page.tsx
#   expect: no output
```

Record the baseline prerendered HTML (the DOM-check script is defined once here and reused in Verification):

```bash
cat > /tmp/check-prices-html.sh <<'SH'
node -e '
const fs = require("fs");
const html = fs.readFileSync(process.argv[1], "utf8");
// Only real markup counts: the inline RSC payload (inside <script>) always
// carries the product data, whether or not anything was rendered.
const dom = html.replace(/<script\b[\s\S]*?<\/script>/g, "");
const count = (s) => dom.split(s).length - 1;
console.log(JSON.stringify({
  bailouts: count("BAILOUT_TO_CLIENT_SIDE_RENDERING"),
  loadingFallback: count(">Loading…<"),
  selects: count("<select"),
  allGenerations: count("All Generations"),
  foundLine: (dom.match(/Found (?:<!-- -->)?\d+(?:<!-- -->)? products/) || [null])[0],
  fixtureAlpha: count("Stubfixture Alpha"),
  fixtureBeta: count("Stubfixture Beta"),
  productLinks: count("href=\"/product/9000"),
}));
' "$1"
SH
pnpm build:stub
bash /tmp/check-prices-html.sh .next/server/app/prices.html
#   expect (before this PR): {"bailouts":1,"loadingFallback":1,"selects":0,"allGenerations":0,"foundLine":null,...}
wc -c .next/server/app/prices.html; gzip -c .next/server/app/prices.html | wc -c   # note both numbers for the PR
```

Assumptions to check:

- WP03 did not change anything in `index.tsx` other than deleting the toast block and the `historyLoading,` destructure line. Run `git log -p --follow app/components/ProductPrices/index.tsx | head -120` and compare. If a later merged WP changed something else in this file, carry that change into the new file in step 4.
- Nothing else reads `?gen`, `?type`, `?q`, `?sort`, `?dir`, `?view`, `?chart` or `?currency` on `/prices`: `grep -rn 'searchParams' app --include=*.tsx | grep -v __tests__` should list only `ProductPrices/index.tsx` and `BoxCalculator/BoxCalculator.tsx` (out of scope, see Pitfalls).
- The only in-app ways to reach `/prices` with a query are the home page GET form (`app/page.tsx:211-229`, full page load with `?q=`) and typed or shared URLs. `grep -rn '"/prices' app --include=*.tsx` should show `Header.tsx:9` and `page.tsx:212,233` only.

## Implementation steps

Design in one paragraph, so every step makes sense. The container stops calling `useSearchParams`. It reads the URL through a `useSyncExternalStore` store whose server snapshot is `""`, so the server and the hydration render both use defaults and match; right after hydration the store reports the real query and the container re-seeds its state from it. Filter changes are written from event handlers only, debounced 250 ms, with `window.history.replaceState(null, "", url)`, which Next 16 turns into a restore action with no network request. External URL changes reach the store through `popstate` and through a tiny `LocationSearchSignal` leaf. The leaf is the one place that still calls `useSearchParams`, inside its own `<Suspense fallback={null}>`, so only that empty leaf is skipped in the static HTML.

**Correction to the plan's decision "subscribe to popstate + a custom event".** That alone does not fix F054's main case. When the header `<Link href="/prices">` navigates within `/prices`, Next's `HistoryUpdater` writes the URL with `window.history.pushState(historyState, ...)` where `historyState.__NA === true` (`app-router.js:52-66`); the patched `pushState` passes such calls straight to the original (`app-router.js:255-257`), so no DOM event fires, and `useSyncExternalStore` only re-reads `window.location.search` during a render of the container, which happens before `HistoryUpdater`'s insertion effect writes the URL. The store would stay stale and the filters would not clear. The `LocationSearchSignal` leaf fixes this: `useSearchParams()` re-renders it on every committed router URL change, and its effect runs after `HistoryUpdater` has written the URL. Keeping `useSearchParams` in an isolated leaf is exactly the "Option B" of the F012 finding and costs one empty client-rendered boundary.

**Correction to the plan's decision "lastWrittenQuery ref".** A ref cannot be read during render (`react-hooks/refs` is an error in eslint-plugin-react-hooks 7.1.1), and doing the re-seed in an effect trips `react-hooks/set-state-in-effect`. The re-seed below runs during render with state only: when the URL changes, it re-seeds unless the URL already describes the current state. Our own writes always describe the current state, so they never re-seed. The ledger that the ref would have provided moves into `locationSearch.ts` as `pendingEchoes`, which also handles a real race: Next turns each `replaceState` into an `ACTION_RESTORE` transition, and on a busy phone the restore for write N can commit after write N+1, making `HistoryUpdater` briefly put the older query back in the address bar. Without the ledger that echo would reset the search box mid-typing.

All code below was type-checked (`tsc --noEmit`), linted with the repo's ESLint config and its tests run (full suite green) on a copy of `frontend/` with WP03's toast removal applied.

Do the steps in order: 1 to 3 add new modules nothing imports yet, 4 switches the container over, 5 removes the page-level Suspense (only safe after 4), 6 is independent, 7 extends the WP00 stub for verification, 8 adds tests.

### 1. New file `frontend/app/lib/locationSearch.ts`

The URL store, the echo ledger and the debounced writer. No `"use client"` directive: the module is only imported by client components, and it touches `window` only inside functions (plus one `typeof window !== "undefined"` guarded listener registration), so importing it during the server render is safe.

Why each piece exists:

- `getServerSnapshot` returns `""`: hydration renders defaults, identical to the prerendered HTML.
- `getSnapshot` returns the latest own write while echoes are outstanding, otherwise `window.location.search`.
- A module-level `popstate` listener counts back/forward as an external change.
- `replaceOwnedSearchParams` keeps foreign keys (F121's `utm_source` case) and the hash, and skips the write when nothing changes.
- `createDebouncedSearchWriter` drops a pending write when an external change happened after it was scheduled or the pathname changed, so a navigation is never overwritten with stale state.

```ts
import { useSyncExternalStore } from "react";

/**
 * `window.location.search` as a React external store, plus a debounced,
 * navigation-free URL writer. Used by /prices (ProductPrices).
 *
 * Why not `useSearchParams()` from next/navigation: in a statically
 * prerendered route it throws a client-side-rendering bailout, so everything
 * up to the nearest <Suspense> is left out of the static HTML. That is what
 * kept the whole /prices catalog out of the prerendered page (F012).
 * `useSyncExternalStore` with a server snapshot of "" renders URL-independent
 * defaults on the server and during hydration, then re-renders with the real
 * query string right after hydration, with no hydration mismatch.
 *
 * Consumers re-read the URL when:
 * - the browser fires `popstate` (back/forward);
 * - `replaceOwnedSearchParams` writes the URL (our own filter changes);
 * - `reportRouterSearch` sees an App Router navigation. It is called by
 *   <LocationSearchSignal/>. Next.js writes the URL for its own navigations
 *   (a <Link> to the same page with a different query, router.push) through
 *   the unpatched history API, which fires no DOM event, so without that
 *   signal this store would go stale.
 *
 * Echoes: Next.js 16 turns each `history.replaceState(null, ...)` into an
 * ACTION_RESTORE transition, and when that transition commits its
 * HistoryUpdater writes the URL again. On a busy main thread the restore for
 * write N can commit after write N+1, briefly putting the older query back in
 * the address bar. Those echoes are ours, not navigations: while any are
 * outstanding the store reports our latest write instead of the address bar,
 * so they can never reset the user's filters.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
// Search strings ("?a=b" or "") written by replaceOwnedSearchParams whose
// App Router echo has not been seen yet, oldest first.
let pendingEchoes: string[] = [];
// Bumped on every URL change we did not make (back/forward, App Router
// navigation). A pending debounced write is dropped when this moves.
let externalChangeCount = 0;
const MAX_PENDING_ECHOES = 50;

function emit(): void {
  for (const listener of Array.from(listeners)) listener();
}

function handleExternalChange(): void {
  pendingEchoes = [];
  externalChangeCount += 1;
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", handleExternalChange);
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string {
  return pendingEchoes.length > 0
    ? pendingEchoes[pendingEchoes.length - 1]
    : window.location.search;
}

function getServerSnapshot(): string {
  return "";
}

/**
 * The current query string including its leading "?", or "". Always "" on
 * the server and during hydration.
 */
export function useLocationSearch(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Called by <LocationSearchSignal/> with `useSearchParams().toString()`
 * whenever the App Router's committed query changes. Either it is the echo of
 * one of our own writes (ignored), or it is a navigation (consumers re-read
 * the URL and any pending debounced write is dropped).
 */
export function reportRouterSearch(routerSearch: string): void {
  const search = routerSearch ? `?${routerSearch}` : "";
  const index = pendingEchoes.indexOf(search);
  if (index === -1) {
    handleExternalChange();
    return;
  }
  pendingEchoes = pendingEchoes.slice(index + 1);
  if (pendingEchoes.length === 0) emit();
}

/**
 * Replace the `ownedKeys` of the current URL's query with `ownedQuery`
 * (a URLSearchParams string holding only non-default owned values), keeping
 * every other key (utm_source and friends) and the hash. No navigation and no
 * network request: Next.js 16 patches history.replaceState so a call with a
 * non-Next state object dispatches ACTION_RESTORE, which rebuilds the router
 * state from the same tree (node_modules/next/dist/client/components/
 * app-router.js, the replaceState patch).
 *
 * Returns true when the URL changed.
 */
export function replaceOwnedSearchParams(
  ownedQuery: string,
  ownedKeys: readonly string[]
): boolean {
  const intended = new URLSearchParams(getSnapshot());
  const next = new URLSearchParams(intended);
  for (const key of ownedKeys) next.delete(key);
  new URLSearchParams(ownedQuery).forEach((value, key) => {
    next.append(key, value);
  });

  const nextQuery = next.toString();
  if (nextQuery === intended.toString()) return false;

  const nextSearch = nextQuery ? `?${nextQuery}` : "";
  pendingEchoes.push(nextSearch);
  if (pendingEchoes.length > MAX_PENDING_ECHOES) pendingEchoes.shift();

  const { pathname, hash } = window.location;
  window.history.replaceState(null, "", `${pathname}${nextSearch}${hash}`);
  emit();
  return true;
}

export type DebouncedSearchWriter = {
  /** Write `ownedQuery` after `delayMs` of quiet; each call restarts the timer. */
  schedule: (ownedQuery: string) => void;
  /** Drop any pending write. Safe to call at any time. */
  cancel: () => void;
};

/**
 * Debounce replaceOwnedSearchParams. A pending write is dropped when the URL
 * changes under it (back/forward, a <Link>, leaving the page): the
 * navigation's URL wins and is never overwritten with stale state.
 */
export function createDebouncedSearchWriter(
  ownedKeys: readonly string[],
  delayMs: number
): DebouncedSearchWriter {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (ownedQuery: string) => {
    cancel();
    const pathname = window.location.pathname;
    const changesAtSchedule = externalChangeCount;
    timer = setTimeout(() => {
      timer = null;
      if (
        externalChangeCount !== changesAtSchedule ||
        window.location.pathname !== pathname
      ) {
        return;
      }
      replaceOwnedSearchParams(ownedQuery, ownedKeys);
    }, delayMs);
  };

  return { schedule, cancel };
}

/** Test helper: forget outstanding echoes. Never call from app code. */
export function resetLocationSearchForTests(): void {
  pendingEchoes = [];
  externalChangeCount = 0;
}
```

### 2. New file `frontend/app/components/LocationSearchSignal.tsx`

```tsx
"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { reportRouterSearch } from "../lib/locationSearch";

/**
 * Renders nothing. Reports the App Router's committed query string to
 * lib/locationSearch after every change (a <Link> to the same page,
 * router.push/replace, back/forward, and the echo of our own
 * history.replaceState writes), so useLocationSearch() consumers stay current.
 *
 * It is the only place that calls useSearchParams(), and it MUST be rendered
 * inside its own <Suspense fallback={null}>: on a statically prerendered
 * route useSearchParams() bails out to client rendering up to the nearest
 * Suspense boundary. Isolated here, only this empty leaf is missing from the
 * static HTML; the rest of the page is prerendered.
 *
 * The effect runs after Next.js's HistoryUpdater has written the new URL
 * (that happens in an insertion effect of the same commit), so consumers
 * read the new window.location.search.
 */
export default function LocationSearchSignal() {
  const search = useSearchParams().toString();

  useEffect(() => {
    reportRouterSearch(search);
  }, [search]);

  return null;
}
```

### 3. New file `frontend/app/components/ProductPrices/utils/urlState.ts`

Moves `DEFAULTS`, the enum lists and `pickEnum` out of `index.tsx:44-64` into a pure, testable module, and adds the canonical serializer used both to write the URL and to compare "does the URL describe the current state". Two deliberate behaviour changes versus `index.tsx:81-91`: an empty value (`?q=`, `?gen=`) now means the default (the old `?? DEFAULTS.gen` turned `?gen=` into a filter that matches nothing), and serialization order is fixed, so reordered shared URLs are equivalent.

```ts
import type { ChartTimeframe, Currency, SortBy, SortDirection, ViewMode } from "../types";

/** The /prices filter and view state that is mirrored in the query string. */
export interface PricesUrlState {
  gen: string;
  type: string;
  q: string;
  sort: SortBy;
  dir: SortDirection;
  view: ViewMode;
  chart: ChartTimeframe;
  currency: Currency;
}

/** Values equal to these are omitted from the URL to keep it clean. */
export const PRICES_URL_DEFAULTS: PricesUrlState = {
  gen: "all",
  type: "all",
  q: "",
  sort: "release_date",
  dir: "desc",
  view: "grouped",
  chart: "3M",
  currency: "CAD",
};

/** Query keys owned by /prices, in serialization order. Other keys in the URL are preserved. */
export const PRICES_URL_KEYS = [
  "gen",
  "type",
  "q",
  "sort",
  "dir",
  "view",
  "chart",
  "currency",
] as const satisfies readonly (keyof PricesUrlState)[];

const SORT_KEYS: readonly SortBy[] = ["release_date", "price"];
const SORT_DIRS: readonly SortDirection[] = ["asc", "desc"];
const VIEW_MODES: readonly ViewMode[] = ["flat", "grouped", "type_grouped"];
const CHART_TIMEFRAMES: readonly ChartTimeframe[] = ["7D", "1M", "3M", "6M", "1Y"];
const CURRENCIES: readonly Currency[] = ["USD", "CAD"];

function pickEnum<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Parse a query string ("?a=b", "a=b" or "") into a complete state.
 * Unknown enum values and empty strings fall back to the defaults, so a URL
 * like `?q=` (the home page search form submitted empty) means "no search".
 */
export function parsePricesQuery(search: string): PricesUrlState {
  const params = new URLSearchParams(search);
  const d = PRICES_URL_DEFAULTS;
  return {
    gen: params.get("gen") || d.gen,
    type: params.get("type") || d.type,
    q: params.get("q") || d.q,
    sort: pickEnum(params.get("sort"), SORT_KEYS, d.sort),
    dir: pickEnum(params.get("dir"), SORT_DIRS, d.dir),
    view: pickEnum(params.get("view"), VIEW_MODES, d.view),
    chart: pickEnum(params.get("chart"), CHART_TIMEFRAMES, d.chart),
    currency: pickEnum(params.get("currency"), CURRENCIES, d.currency),
  };
}

/**
 * Canonical owned-key query for a state: only non-default values, always in
 * PRICES_URL_KEYS order. Two states are equivalent exactly when their
 * serializations are equal.
 */
export function serializePricesState(state: PricesUrlState): string {
  const params = new URLSearchParams();
  for (const key of PRICES_URL_KEYS) {
    if (state[key] !== PRICES_URL_DEFAULTS[key]) {
      params.set(key, state[key]);
    }
  }
  return params.toString();
}
```

### 4. Replace `frontend/app/components/ProductPrices/index.tsx`

Replace the whole file with the version below. Changes versus the current file, with the current line numbers:

- Imports (`:3-4`): drop `useRef`, `usePathname`, `useRouter`, `useSearchParams`; add `Suspense`, `useDeferredValue`, `LocationSearchSignal`, the `urlState` helpers and `createDebouncedSearchWriter`/`useLocationSearch`. The `Currency` type import is no longer needed.
- `DEFAULTS`, `VIEW_MODES`, `SORT_KEYS`, `SORT_DIRS`, `CHART_TIMEFRAMES`, `CURRENCIES`, `pickEnum` (`:44-64`): deleted, now in `utils/urlState.ts`.
- `router`, `pathname`, `searchParams` and the frozen `initialFromUrl` memo (`:75-91`): replaced by `useLocationSearch()` and a lazy `useState` seed `initialUrlState`. During hydration the seed is the defaults (store server snapshot is `""`), so the hydration render matches the HTML.
- New "URL -> state" block: `appliedSearch` state plus the adjust-during-render re-seed (F054).
- The URL-sync `useEffect` (`:125-163`, with `router.replace` at `:150`): deleted. Replaced by `updateUrlState(patch)`, called from the control handlers, which sets state and schedules a debounced `replaceState` (F016). The URL is never written on mount or on a re-seed, which also removes F054's "replace on mount for reordered params".
- `useDeferredValue(searchTerm)` feeds `filterProducts` (F016).
- The three card-list JSX blocks (`:246-336`) move, unchanged apart from indentation, into one `cardList` `useMemo` keyed on the deferred-derived lists, like `MarketView.tsx:445-451`: the urgent keystroke render reuses the same element objects and React skips the grid.
- `handleSortChange` (`:192-195`) and the direct setter props on `ControlBar`/`SortControls` (`:204-224`) become `updateUrlState` calls.
- `<Suspense fallback={null}><LocationSearchSignal /></Suspense>` is rendered at the top of the root `div`.

If WP03 has landed, the toast block and `historyLoading` destructure are already gone; the file below matches that. Keep the three per-card `historyLoading={loadingProductIds.includes(product.id)}` props (WP09 owns them).

```tsx
"use client";

import { Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import ControlBar from "./controls/ControlBar";
import SortControls from "./controls/SortControls";
import ProductGrid from "./cards/ProductGrid";
import ProductCard from "./cards/ProductCard";
import GroupHeader from "./cards/GroupHeader";
import ProductTypeGroupHeader from "./cards/ProductTypeGroupHeader";
import CardRinkPromo from "../CardRinkPromo";
import LocationSearchSignal from "../LocationSearchSignal";
import ScrollToTop from "./shared/ScrollToTop";
import { useProductData } from "./hooks/useProductData";
import { useCurrencyConversion } from "./hooks/useCurrencyConversion";
import { useVolumeMetrics } from "./hooks/useVolumeMetrics";
import {
  filterProducts,
  getAvailableGenerations,
  getAvailableProductTypes,
  groupProductsBySet,
  groupProductsByType,
} from "./utils/filtering";
import { sortProducts } from "./utils/sorting";
import {
  PRICES_URL_KEYS,
  PricesUrlState,
  parsePricesQuery,
  serializePricesState,
} from "./utils/urlState";
import {
  createDebouncedSearchWriter,
  useLocationSearch,
} from "../../lib/locationSearch";
import {
  ChartTimeframe,
  Product,
  ProductVolumeMetrics,
  SortBy,
  SortDirection,
  ViewMode,
} from "./types";

interface ProductPricesProps {
  initialProducts?: Product[];
  initialExchangeRate?: number;
  /**
   * Server-rendered sales-volume metrics keyed by product_id. When supplied the
   * volume chips are correct on first paint and no client fetch happens.
   */
  initialVolumeMetrics?: Record<number, ProductVolumeMetrics>;
}

// Quiet period before filter/search changes are written to the URL. Long
// enough that typing a word produces one history write, short enough that a
// copied link is current.
const URL_WRITE_DEBOUNCE_MS = 250;

/**
 * Main ProductPrices container component
 * Mobile-first responsive design with modular architecture
 */
export default function ProductPrices({
  initialProducts = [],
  initialExchangeRate,
  initialVolumeMetrics,
}: ProductPricesProps) {
  // "" on the server and during hydration, the real query string afterwards.
  // Reading the URL this way (not useSearchParams) keeps the catalog in the
  // prerendered HTML (F012).
  const locationSearch = useLocationSearch();

  // First-render seed. During hydration locationSearch is "", so this is the
  // defaults: exactly what the server rendered. The URL's values are applied
  // by the "URL -> state" block below on the render right after hydration.
  // On a client-side mount it is the URL at render time.
  const [initialUrlState] = useState(() => parsePricesQuery(locationSearch));

  // View state (declared first so we can pass chartTimeframe to useProductData)
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>(initialUrlState.chart);

  const {
    products,
    priceHistory,
    loading,
    loadingProductIds,
    ensureHistoryLoaded,
  } = useProductData({ initialProducts });
  const {
    selectedCurrency,
    exchangeRate,
    exchangeRateLoading,
    setSelectedCurrency,
    formatPrice,
  } = useCurrencyConversion(initialExchangeRate, initialUrlState.currency);
  // Resolved once here rather than per card: ~300 cards would otherwise each own
  // a useState/useEffect whose resolution re-renders through ProductCard's memo.
  const volumeMetrics = useVolumeMetrics(initialVolumeMetrics);

  // Filter state
  const [selectedGeneration, setSelectedGeneration] = useState(initialUrlState.gen);
  const [selectedProductType, setSelectedProductType] = useState(initialUrlState.type);
  const [searchTerm, setSearchTerm] = useState(initialUrlState.q);

  // View state
  const [sortKey, setSortKey] = useState<SortBy>(initialUrlState.sort);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialUrlState.dir);
  const [viewMode, setViewMode] = useState<ViewMode>(initialUrlState.view);

  const urlState: PricesUrlState = {
    gen: selectedGeneration,
    type: selectedProductType,
    q: searchTerm,
    sort: sortKey,
    dir: sortDirection,
    view: viewMode,
    chart: chartTimeframe,
    currency: selectedCurrency,
  };

  // URL -> state (F054). When the query string changes and no longer
  // describes the current state, the URL wins: the header "Prices" link,
  // back/forward, and the first render after hydration all land here. Our own
  // debounced writes land here too, but they describe the current state, so
  // nothing is reset. This is React's "adjust state during render" pattern
  // (same as useProductData's initialProducts latch): React discards this
  // render and retries immediately, with no commit and no effect.
  const [appliedSearch, setAppliedSearch] = useState(locationSearch);
  if (appliedSearch !== locationSearch) {
    setAppliedSearch(locationSearch);
    const fromUrl = parsePricesQuery(locationSearch);
    if (serializePricesState(fromUrl) !== serializePricesState(urlState)) {
      setSelectedGeneration(fromUrl.gen);
      setSelectedProductType(fromUrl.type);
      setSearchTerm(fromUrl.q);
      setSortKey(fromUrl.sort);
      setSortDirection(fromUrl.dir);
      setViewMode(fromUrl.view);
      setChartTimeframe(fromUrl.chart);
      setSelectedCurrency(fromUrl.currency);
    }
  }

  // State -> URL (F016). Written from event handlers only, debounced, with
  // history.replaceState: no App Router navigation, so no RSC refetch of the
  // catalog per keystroke. Never written on mount or on a URL -> state reseed.
  const [urlWriter] = useState(() =>
    createDebouncedSearchWriter(PRICES_URL_KEYS, URL_WRITE_DEBOUNCE_MS)
  );
  useEffect(() => urlWriter.cancel, [urlWriter]);

  const updateUrlState = (patch: Partial<PricesUrlState>) => {
    if (patch.gen !== undefined) setSelectedGeneration(patch.gen);
    if (patch.type !== undefined) setSelectedProductType(patch.type);
    if (patch.q !== undefined) setSearchTerm(patch.q);
    if (patch.sort !== undefined) setSortKey(patch.sort);
    if (patch.dir !== undefined) setSortDirection(patch.dir);
    if (patch.view !== undefined) setViewMode(patch.view);
    if (patch.chart !== undefined) setChartTimeframe(patch.chart);
    if (patch.currency !== undefined) setSelectedCurrency(patch.currency);
    urlWriter.schedule(serializePricesState({ ...urlState, ...patch }));
  };

  // The search box renders `searchTerm` (urgent, every keystroke paints
  // immediately); filtering, grouping and the card lists key off the deferred
  // copy and render at transition priority, like MarketView.tsx.
  const deferredSearchTerm = useDeferredValue(searchTerm);

  // Derived data
  const availableGenerations = useMemo(
    () => getAvailableGenerations(products),
    [products]
  );
  const availableProductTypes = useMemo(
    () => getAvailableProductTypes(products),
    [products]
  );

  const filteredAndSortedProducts = useMemo(() => {
    const filtered = filterProducts(products, {
      selectedGeneration,
      selectedProductType,
      searchTerm: deferredSearchTerm,
    });
    return sortProducts(filtered, sortKey, sortDirection);
  }, [products, selectedGeneration, selectedProductType, deferredSearchTerm, sortKey, sortDirection]);

  const groupedProducts = useMemo(() => {
    return groupProductsBySet(filteredAndSortedProducts);
  }, [filteredAndSortedProducts]);
  const groupedProductsByType = useMemo(() => {
    return groupProductsByType(filteredAndSortedProducts);
  }, [filteredAndSortedProducts]);

  // The ~300 cards are the expensive part of this component. Building them in
  // a useMemo keyed on the deferred-derived lists means the urgent keystroke
  // render reuses the exact same element objects and React skips the grid.
  const cardList = useMemo(() => {
    if (loading) return null;

    if (viewMode === "flat") {
      return (
        <ProductGrid>
          {filteredAndSortedProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              viewMode="flat"
              chartTimeframe={chartTimeframe}
              history={priceHistory[product.id]}
              historyLoading={loadingProductIds.includes(product.id)}
              unitsSold30d={volumeMetrics[product.id]?.units_sold_30d ?? null}
              selectedCurrency={selectedCurrency}
              exchangeRate={exchangeRate}
              formatPrice={formatPrice}
              onLoadChart={ensureHistoryLoaded}
            />
          ))}
        </ProductGrid>
      );
    }

    if (viewMode === "grouped") {
      return (
        <div className="space-y-8">
          {Array.from(groupedProducts.entries()).map(([setName, setProducts]) => (
            <div key={setName}>
              <GroupHeader
                setName={setName}
                setCode={setProducts[0]?.sets?.code || "N/A"}
                generation={setProducts[0]?.sets?.generations?.name || "Unknown"}
                expansionType={setProducts[0]?.sets?.expansion_type}
                releaseDate={setProducts[0]?.sets?.release_date || ""}
              />

              <ProductGrid>
                {setProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    viewMode="grouped"
                    chartTimeframe={chartTimeframe}
                    history={priceHistory[product.id]}
                    historyLoading={loadingProductIds.includes(product.id)}
                    unitsSold30d={volumeMetrics[product.id]?.units_sold_30d ?? null}
                    selectedCurrency={selectedCurrency}
                    exchangeRate={exchangeRate}
                    formatPrice={formatPrice}
                    onLoadChart={ensureHistoryLoaded}
                  />
                ))}
              </ProductGrid>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-8">
        {Array.from(groupedProductsByType.entries()).map(
          ([productType, typeProducts]) => (
            <div key={productType}>
              <ProductTypeGroupHeader
                productType={productType}
                productCount={typeProducts.length}
                setCount={new Set(typeProducts.map((product) => product.sets?.name)).size}
              />

              <ProductGrid>
                {typeProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    viewMode="grouped"
                    showSetAsPrimary
                    chartTimeframe={chartTimeframe}
                    history={priceHistory[product.id]}
                    historyLoading={loadingProductIds.includes(product.id)}
                    unitsSold30d={volumeMetrics[product.id]?.units_sold_30d ?? null}
                    selectedCurrency={selectedCurrency}
                    exchangeRate={exchangeRate}
                    formatPrice={formatPrice}
                    onLoadChart={ensureHistoryLoaded}
                  />
                ))}
              </ProductGrid>
            </div>
          )
        )}
      </div>
    );
  }, [
    loading,
    viewMode,
    filteredAndSortedProducts,
    groupedProducts,
    groupedProductsByType,
    chartTimeframe,
    priceHistory,
    loadingProductIds,
    volumeMetrics,
    selectedCurrency,
    exchangeRate,
    formatPrice,
    ensureHistoryLoaded,
  ]);

  return (
    <div className="p-3 md:p-6 bg-[var(--pf-bg)] min-h-screen">
      {/* Re-announces the URL after App Router navigations. Its own boundary:
          it calls useSearchParams, which must not bail the catalog out of the
          static HTML. */}
      <Suspense fallback={null}>
        <LocationSearchSignal />
      </Suspense>

      <div className="space-y-4 md:space-y-6">
        {/* Control Bar */}
        <ControlBar
          selectedGeneration={selectedGeneration}
          availableGenerations={availableGenerations}
          onGenerationChange={(gen) => updateUrlState({ gen })}
          selectedProductType={selectedProductType}
          availableProductTypes={availableProductTypes}
          onProductTypeChange={(type) => updateUrlState({ type })}
          searchTerm={searchTerm}
          onSearchChange={(q) => updateUrlState({ q })}
          chartTimeframe={chartTimeframe}
          onChartTimeframeChange={(chart) => updateUrlState({ chart })}
          selectedCurrency={selectedCurrency}
          exchangeRate={exchangeRate}
          exchangeRateLoading={exchangeRateLoading}
          onCurrencyChange={(currency) => updateUrlState({ currency })}
        />

        {/* Sort Controls */}
        <SortControls
          sortKey={sortKey}
          sortDirection={sortDirection}
          viewMode={viewMode}
          onSortChange={(sort, dir) => updateUrlState({ sort, dir })}
          onViewModeChange={(view) => updateUrlState({ view })}
        />

        {/* Results Count */}
        <div className="text-sm text-slate-600">
          Found {filteredAndSortedProducts.length} products
        </div>

        {/* Loading State */}
        {loading && <div className="text-slate-600">Loading products...</div>}

        {cardList}

        {/* CardRinkTCG Promotional Banner */}
        {!loading && <CardRinkPromo variant="banner" />}
      </div>

      {/* Scroll to Top Button */}
      <ScrollToTop />
    </div>
  );
}
```

Note on `setSelectedCurrency` during render: it is the `useState` setter from `useCurrencyConversion`, a hook called by this component, so calling it conditionally during render is the same supported pattern as the other setters. Do not change `useCurrencyConversion`.

### 5. Edit `frontend/app/prices/page.tsx`

Delete line 1 (`import { Suspense } from "react";`) and replace lines 30-37:

```tsx
      {/* Suspense required because ProductPrices uses useSearchParams */}
      <Suspense fallback={<div className="text-slate-500">Loading…</div>}>
        <ProductPrices
          initialProducts={products}
          initialExchangeRate={exchangeRate.rate}
          initialVolumeMetrics={volumeMetrics}
        />
      </Suspense>
```

with:

```tsx
      <ProductPrices
        initialProducts={products}
        initialExchangeRate={exchangeRate.rate}
        initialVolumeMetrics={volumeMetrics}
      />
```

Keep WP03's subheading copy ("updated daily") untouched. Do not add `export const dynamic` or any other segment config.

### 6. `frontend/app/components/ProductPrices/utils/sorting.ts`: decorate before sorting (F016, minor)

Replace the body of `sortProducts` (current lines 94-130) with the version below. `new Date()` and `getProductSortOrder()` now run once per product instead of twice per comparison (the F016 verifier measured 1.04 ms to 0.20 ms per sort of 306 products). Ordering is identical, including for missing or unparseable dates (checked against the old implementation over 300 randomized lists with `""`, `undefined`, garbage and duplicate dates). The JSDoc block above the function stays.

```ts
export function sortProducts(
  products: Product[],
  sortKey: SortBy,
  sortDirection: SortDirection
): Product[] {
  if (sortKey === "release_date") {
    // Decorate once, then sort: new Date() and getProductSortOrder() run once
    // per product instead of twice per comparison (F016). Same ordering as
    // before, including for missing or unparseable dates.
    const decorated = products.map((product) => ({
      product,
      releaseMs: new Date(product.sets?.release_date ?? 0).getTime(),
      order: getProductSortOrder(product),
    }));
    decorated.sort((a, b) => {
      // Sort by release date
      if (a.releaseMs !== b.releaseMs) {
        return sortDirection === "asc"
          ? a.releaseMs - b.releaseMs
          : b.releaseMs - a.releaseMs;
      }
      // If same release date, use product type order as secondary sort
      return a.order - b.order;
    });
    return decorated.map((entry) => entry.product);
  }

  return [...products].sort((a, b) => {
    if (sortKey === "price") {
      // Unknown prices sort last in either direction, matching HoldingsTable.
      // Coercing them to 0 would file every stale and never-priced product in
      // among the genuinely cheap ones at the top of an ascending sort.
      const hasA = hasCurrentPrice(a);
      const hasB = hasCurrentPrice(b);
      if (!hasA && !hasB) return 0;
      if (!hasA) return 1;
      if (!hasB) return -1;
      const priceA = a.usd_price as number;
      const priceB = b.usd_price as number;
      return sortDirection === "asc" ? priceA - priceB : priceB - priceA;
    }

    return 0;
  });
}
```

### 7. Extend the WP00 stub with an opt-in two-product fixture: `frontend/scripts/supabase-stub.mjs` and `frontend/scripts/build-with-stub.mjs`

With the default stub the catalog is empty, so the build can only prove that controls are prerendered. This adds `SUPABASE_STUB_FIXTURE=catalog`, which makes only `POST /rest/v1/rpc/get_market_product_summaries` return two `MarketSummaryRow`s; every other request keeps WP00's empty behaviour. Default behaviour is unchanged.

7a. In `scripts/supabase-stub.mjs`, insert directly above the `/** Start the stub. ... */` JSDoc of `startSupabaseStub`:

```js
// Opt-in fixture data, for checking that prerendered pages contain real
// markup (WP08: /prices must ship product cards in its static HTML).
// Select with startSupabaseStub({ fixture: "catalog" }), or with
// SUPABASE_STUB_FIXTURE=catalog for build-with-stub.mjs and the CLI.
// Only get_market_product_summaries answers with rows; every other request
// keeps the empty behaviour above.
function catalogSummaryRows() {
  // Offset-less, like the RPC's recorded_at; recent, so the price freshness
  // guard (mapMarketSummaryRowToProduct) keeps the price.
  const now = new Date().toISOString().slice(0, 19);
  const base = {
    price_recorded_at: now,
    last_updated: now,
    variant: null,
    image_url: null,
    sku: null,
    set_expansion_type: null,
    return_1d: null,
    return_7d: null,
    return_30d: null,
    return_90d: null,
    return_180d: null,
    return_365d: null,
  };
  return [
    {
      ...base,
      id: 900001,
      usd_price: 123.45,
      url: "https://www.tcgplayer.com/product/900001",
      set_id: 9001,
      set_name: "Stubfixture Alpha",
      set_code: "SFA",
      set_release_date: "2026-01-16",
      generation_id: 901,
      generation_name: "Stubfixture Gen One",
      product_type_id: 1,
      product_type_name: "booster_box",
      product_type_label: "Booster Box",
    },
    {
      ...base,
      id: 900002,
      usd_price: 54.32,
      url: "https://www.tcgplayer.com/product/900002",
      set_id: 9002,
      set_name: "Stubfixture Beta",
      set_code: "SFB",
      set_release_date: "2025-11-14",
      generation_id: 902,
      generation_name: "Stubfixture Gen Two",
      product_type_id: 2,
      product_type_name: "elite_trainer_box",
      product_type_label: "Elite Trainer Box",
    },
  ];
}

const FIXTURES = {
  catalog: { "/rest/v1/rpc/get_market_product_summaries": catalogSummaryRows },
};
```

7b. Same file: change the JSDoc `@param` line and the signature, and reject unknown fixture names:

```js
 * @param {{ port?: number, fixture?: string, onRequest?: (method: string, url: string) => void }} [options]
```

```js
export function startSupabaseStub({ port = DEFAULT_STUB_PORT, fixture, onRequest } = {}) {
  const fixtureRoutes = fixture ? FIXTURES[fixture] : undefined;
  if (fixture && !fixtureRoutes) {
    return Promise.reject(new Error(`Unknown SUPABASE_STUB_FIXTURE "${fixture}"`));
  }
  const server = http.createServer((req, res) => {
```

7c. Same file, inside the request handler, directly after the `if (accept.includes("application/vnd.pgrst.object+json")) { ... return; }` block and before the default `res.writeHead(200, { ... "content-range": "*/0" })`:

```js
      const rowsFor = fixtureRoutes?.[(req.url ?? "/").split("?")[0]];
      if (rowsFor) {
        const rows = rowsFor();
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-range": `0-${rows.length - 1}/${rows.length}`,
        });
        res.end(method === "HEAD" ? undefined : JSON.stringify(rows));
        return;
      }
```

7d. Same file, CLI block at the bottom: pass `fixture: process.env.SUPABASE_STUB_FIXTURE || undefined,` to `startSupabaseStub({ ... })` (next to `port`).

7e. `scripts/build-with-stub.mjs`: replace

```js
  const stub = await startSupabaseStub({
    port,
    onRequest:
```

with

```js
  const fixture = process.env.SUPABASE_STUB_FIXTURE || undefined;
  const stub = await startSupabaseStub({
    port,
    fixture,
    onRequest:
```

and the listening log line with

```js
  console.log(
    `[build:stub] Supabase stub listening on ${stub.url}${fixture ? ` (fixture: ${fixture})` : ""}`
  );
```

If WP00's merged files differ from its spec, keep the intent: an opt-in `fixture` option read from `SUPABASE_STUB_FIXTURE` in the build script and CLI only (never inside `startSupabaseStub`, so the Node tests are not affected by a developer's environment), and a branch that answers the summaries RPC before the default empty response.

### 8. Tests

Add the files listed in the Tests section.

## Pitfalls: do not do this

- **Do not add `export const dynamic = "force-static"` to `prices/page.tsx`** (F012 verifier). It suppresses the bailout (`dynamic-rendering.js:609-611`) but makes `useSearchParams` return empty on the server and real values on the client, so every `?q=` visit (the home search form) hydration-mismatches and React 19 client-renders the tree anyway.
- **Do not keep `useSearchParams()` anywhere in `ProductPrices` or move it into a wrapper around the catalog** (for example `key={searchParams.toString()}` remounting, suggested by the F054 verifier as an alternative). Any `useSearchParams()` above the cards bails them out of the static HTML again. It may only live in the empty `LocationSearchSignal` leaf, inside its own `<Suspense fallback={null}>`. Removing that `Suspense` makes Next fail the build ("useSearchParams() should be wrapped in a suspense boundary") or, worse, bail out the whole page.
- **Do not rely on `popstate` plus a custom event alone** (the plan's original wording). Next's own navigations fire no event; see the correction in Implementation steps. Without `LocationSearchSignal`, the header "Prices" link still does not clear filters.
- **Do not use `router.replace` or `router.push` for filter changes.** In Next 16.3.6 a search-only change is a page-segment refresh that fetches the full RSC payload (F016 verifier, `ppr-navigations.js:99-103, 158-165`). Use `window.history.replaceState(null, "", url)`: the `null` state is required, because Next's patch only routes non-Next state objects into `ACTION_RESTORE` (`app-router.js:268-279`).
- **Do not call `replaceState` with Next's own state (`{ ...history.state }` or anything with `__NA`)** to skip the restore action. The router would keep the old canonical URL and its `HistoryUpdater` would write it back on the next router state change (any `router.refresh()`), silently resetting the address bar and then the filters.
- **Do not use `pushState` for filter changes.** Every keystroke would become a history entry and Back would step through letters.
- **Do not write the URL from a `useEffect` keyed on state** (the current design). On hydration the effect runs with default state before the store reports the URL and would schedule a write that strips `?q=`; it also writes on every re-seed. Write only from event handlers, as `updateUrlState` does.
- **Do not read a ref during render and do not `setState` inside an effect for the re-seed.** Both are errors under the repo's eslint-plugin-react-hooks 7.1.1 (`react-hooks/refs`, `react-hooks/set-state-in-effect`; verified). Use the adjust-state-during-render block exactly as written, with `appliedSearch` in state.
- **Do not read `window.location` directly in a `useState` initializer or in render.** The server has no `window` and, during hydration, a direct read would give the real query while the HTML was rendered with defaults: a hydration mismatch. Always go through `useLocationSearch()`.
- **Do not flush the pending URL write on unmount.** By the time the unmount cleanup runs, `HistoryUpdater` has already written the next page's URL, and a flush would overwrite it with `/prices?...`. `cancel` is correct; the pathname check in the writer is a second guard.
- **Do not defer the selects, sort or view through `useDeferredValue`.** Only the search term is typed continuously; deferring discrete choices adds a visible lag for no gain.
- **Do not change `useCurrencyConversion`, `useProductData`'s `sameProductList`, `ProductCard` or `MarketView`.** The F016 verifier's optional "compare by id + last_updated" is not needed once typing no longer refetches, and the other files belong to WP07, WP09, WP19 and WP20.
- **Do not fix `BoxCalculator.tsx:74`** (same `useSearchParams` bailout on `/box-calculator`, noted by the F012 verifier as lower priority). It is outside this package; list it in the PR description as a follow-up that can reuse `useLocationSearch`.
- **Do not leave the stub fixture on by default, and never `next start` or deploy a stub build** (WP00 rule). The fixture exists only to prove the HTML contains cards.
- **Do not judge success by grepping the raw `prices.html` for product names.** The inline RSC payload always contains them, even when nothing is rendered (the F012 verifier's point). Use `/tmp/check-prices-html.sh`, which strips `<script>` elements first.

## Tests

All are Jest tests under the default jsdom environment (no `@jest-environment node` docblock: `renderToString` and `hydrateRoot` both work under jsdom, verified). Expected totals after this PR: the pre-PR suite count plus 33 tests.

1. **New `frontend/app/lib/__tests__/locationSearch.test.tsx`** (13 tests). Cases: server render returns `""` even with `?q=abc` in the URL; client returns `?q=abc`; `popstate` re-reads; an App Router navigation reported through `reportRouterSearch` re-reads, and an unannounced `pushState` does not; out-of-order echoes of our own writes never change the reported value; `replaceOwnedSearchParams` keeps foreign keys and the hash, drops the `?` when empty, and does not write when nothing changes; the writer debounces to one write with the last value, `cancel()` drops it, and it drops the write after a reported navigation, after `popstate`, and after a pathname change.

```tsx
import { act, render, renderHook, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import {
  createDebouncedSearchWriter,
  replaceOwnedSearchParams,
  reportRouterSearch,
  resetLocationSearchForTests,
  useLocationSearch,
} from "../locationSearch";

const OWNED = ["gen", "q"] as const;

function Probe() {
  return <span data-testid="search">{`[${useLocationSearch()}]`}</span>;
}

beforeEach(() => {
  jest.useRealTimers();
  window.history.replaceState(null, "", "/prices");
  resetLocationSearchForTests();
});

describe("useLocationSearch", () => {
  it("renders the server snapshot (empty) in SSR even when the URL has a query", () => {
    window.history.replaceState(null, "", "/prices?q=abc");
    expect(renderToString(<Probe />)).toContain("[]");
  });

  it("returns the real query string on the client", () => {
    window.history.replaceState(null, "", "/prices?q=abc");
    render(<Probe />);
    expect(screen.getByTestId("search")).toHaveTextContent("[?q=abc]");
  });

  it("re-reads the URL on popstate", () => {
    const { result } = renderHook(() => useLocationSearch());
    act(() => {
      window.history.pushState(null, "", "/prices?gen=XY");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current).toBe("?gen=XY");
  });

  it("re-reads the URL when the App Router reports a navigation, and not before", () => {
    const { result } = renderHook(() => useLocationSearch());
    // Next.js's own history writes fire no event.
    window.history.pushState(null, "", "/prices?gen=XY");
    expect(result.current).toBe("");
    act(() => reportRouterSearch("gen=XY"));
    expect(result.current).toBe("?gen=XY");
  });

  it("ignores App Router echoes of our own writes, even out of order", () => {
    const { result } = renderHook(() => useLocationSearch());
    act(() => {
      replaceOwnedSearchParams("q=a", OWNED);
      replaceOwnedSearchParams("q=ab", OWNED);
    });
    expect(result.current).toBe("?q=ab");

    // The restore for the first write commits late and Next.js's
    // HistoryUpdater puts the older URL back in the address bar.
    act(() => {
      window.history.replaceState({ __NA: true }, "", "/prices?q=a");
      reportRouterSearch("q=a");
    });
    expect(result.current).toBe("?q=ab");

    act(() => {
      window.history.replaceState({ __NA: true }, "", "/prices?q=ab");
      reportRouterSearch("q=ab");
    });
    expect(result.current).toBe("?q=ab");
  });
});

describe("replaceOwnedSearchParams", () => {
  it("replaces owned keys, keeps foreign keys and the hash", () => {
    window.history.replaceState(null, "", "/prices?utm_source=news&q=old#top");
    const spy = jest.spyOn(window.history, "replaceState");

    expect(replaceOwnedSearchParams("gen=XY", OWNED)).toBe(true);

    expect(spy).toHaveBeenCalledWith(null, "", "/prices?utm_source=news&gen=XY#top");
    expect(window.location.search).toBe("?utm_source=news&gen=XY");
    spy.mockRestore();
  });

  it("drops the '?' entirely when nothing is left", () => {
    window.history.replaceState(null, "", "/prices?q=old");
    replaceOwnedSearchParams("", OWNED);
    expect(window.location.pathname + window.location.search).toBe("/prices");
  });

  it("is a no-op (no history write) when the URL already matches", () => {
    window.history.replaceState(null, "", "/prices?gen=XY");
    const spy = jest.spyOn(window.history, "replaceState");
    expect(replaceOwnedSearchParams("gen=XY", OWNED)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("createDebouncedSearchWriter", () => {
  beforeEach(() => jest.useFakeTimers());

  it("writes once, after the quiet period, with the last value", () => {
    const writer = createDebouncedSearchWriter(OWNED, 250);
    const spy = jest.spyOn(window.history, "replaceState");
    writer.schedule("q=a");
    writer.schedule("q=al");
    writer.schedule("q=alp");
    jest.advanceTimersByTime(249);
    expect(spy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?q=alp");
    spy.mockRestore();
  });

  it("cancel() drops the pending write", () => {
    const writer = createDebouncedSearchWriter(OWNED, 250);
    writer.schedule("q=a");
    writer.cancel();
    jest.advanceTimersByTime(1000);
    expect(window.location.search).toBe("");
  });

  it("drops the write when a navigation happened before it fired", () => {
    const writer = createDebouncedSearchWriter(OWNED, 250);
    writer.schedule("q=a");
    window.history.pushState(null, "", "/prices?gen=XY"); // a <Link>
    reportRouterSearch("gen=XY");
    jest.advanceTimersByTime(1000);
    expect(window.location.search).toBe("?gen=XY");
  });

  it("drops the write on back/forward", () => {
    const writer = createDebouncedSearchWriter(OWNED, 250);
    writer.schedule("q=a");
    window.history.pushState(null, "", "/prices?gen=XY");
    window.dispatchEvent(new PopStateEvent("popstate"));
    jest.advanceTimersByTime(1000);
    expect(window.location.search).toBe("?gen=XY");
  });

  it("drops the write when the page changed before it fired", () => {
    const writer = createDebouncedSearchWriter(OWNED, 250);
    writer.schedule("q=a");
    window.history.pushState(null, "", "/product/42");
    jest.advanceTimersByTime(1000);
    expect(window.location.pathname + window.location.search).toBe("/product/42");
  });
});
```

2. **New `frontend/app/components/__tests__/LocationSearchSignal.test.tsx`** (1 test): renders nothing, reports on mount and only when the router's search params change.

```tsx
import { render } from "@testing-library/react";

let currentSearch = "";
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

jest.mock("../../lib/locationSearch", () => ({
  reportRouterSearch: jest.fn(),
}));

import { reportRouterSearch } from "../../lib/locationSearch";
import LocationSearchSignal from "../LocationSearchSignal";

const reportMock = reportRouterSearch as jest.MockedFunction<typeof reportRouterSearch>;

describe("LocationSearchSignal", () => {
  it("reports on mount and whenever the App Router's search params change", () => {
    const { rerender, container } = render(<LocationSearchSignal />);
    expect(container).toBeEmptyDOMElement();
    expect(reportMock).toHaveBeenCalledTimes(1);
    expect(reportMock).toHaveBeenLastCalledWith("");

    rerender(<LocationSearchSignal />); // same params: no new report
    expect(reportMock).toHaveBeenCalledTimes(1);

    currentSearch = "gen=XY";
    rerender(<LocationSearchSignal />);
    expect(reportMock).toHaveBeenCalledTimes(2);
    expect(reportMock).toHaveBeenLastCalledWith("gen=XY");
  });
});
```

3. **New `frontend/app/components/ProductPrices/__tests__/urlState.test.ts`** (7 tests): defaults for empty input; every key parsed with or without `?`; unknown enums and empty values fall back; foreign keys ignored; defaults serialize to `""`; fixed key order regardless of input order; parse/serialize round trip.

```ts
import {
  PRICES_URL_DEFAULTS,
  parsePricesQuery,
  serializePricesState,
} from "../utils/urlState";

describe("parsePricesQuery", () => {
  it("returns the defaults for an empty query", () => {
    expect(parsePricesQuery("")).toEqual(PRICES_URL_DEFAULTS);
    expect(parsePricesQuery("?")).toEqual(PRICES_URL_DEFAULTS);
  });

  it("reads every owned key, with or without the leading '?'", () => {
    const expected = {
      gen: "Scarlet & Violet",
      type: "Booster Box",
      q: "151",
      sort: "price",
      dir: "asc",
      view: "flat",
      chart: "1Y",
      currency: "USD",
    };
    const query =
      "gen=Scarlet+%26+Violet&type=Booster+Box&q=151&sort=price&dir=asc&view=flat&chart=1Y&currency=USD";
    expect(parsePricesQuery(`?${query}`)).toEqual(expected);
    expect(parsePricesQuery(query)).toEqual(expected);
  });

  it("falls back to defaults for unknown enum values and empty strings", () => {
    expect(
      parsePricesQuery("?sort=bogus&dir=up&view=table&chart=5Y&currency=EUR&q=&gen=")
    ).toEqual(PRICES_URL_DEFAULTS);
  });

  it("ignores keys it does not own", () => {
    expect(parsePricesQuery("?utm_source=newsletter")).toEqual(PRICES_URL_DEFAULTS);
  });
});

describe("serializePricesState", () => {
  it("omits defaults entirely", () => {
    expect(serializePricesState(PRICES_URL_DEFAULTS)).toBe("");
  });

  it("uses a fixed key order regardless of the input URL's order", () => {
    const a = parsePricesQuery("?q=x&gen=XY&currency=USD");
    const b = parsePricesQuery("?currency=USD&gen=XY&q=x");
    expect(serializePricesState(a)).toBe("gen=XY&q=x&currency=USD");
    expect(serializePricesState(b)).toBe(serializePricesState(a));
  });

  it("round-trips through parse", () => {
    const state = { ...PRICES_URL_DEFAULTS, gen: "Sun & Moon", q: "elite trainer", view: "type_grouped" as const };
    expect(parsePricesQuery(serializePricesState(state))).toEqual(state);
  });
});
```

4. **New `frontend/app/components/ProductPrices/__tests__/ProductPrices.urlSync.test.tsx`** (10 tests). `ProductCard` is mocked to a one-line stub (these tests are about which products show and what the URL says), `next/navigation`'s `useRouter` is mocked to throw (the container must not use it), and `useSearchParams` reads a test-controlled `mockRouterSearch`. Cases: server render contains the controls and both cards and "Found 2 products" whatever the URL says; hydrating `?q=beta` produces no hydration error, then shows only the matching card and does not rewrite the URL; typing three letters writes the URL exactly once, 250 ms after the last one, via `replaceState(null, "", "/prices?q=alp")`; mount never writes the URL; foreign keys survive a filter change; returning a filter to its default removes its key; a same-page `<Link>` to `/prices` resets the filters and the old filter is not written back; `popstate` re-applies the URL; a pending write is dropped when a navigation lands first; a late echo of an older write does not reset the search box. Against the current implementation all 10 fail; with the echo ledger removed from `locationSearch.ts` the last one fails (both verified).

```tsx
/**
 * URL <-> state sync of the /prices container (F012, F016, F054).
 *
 * ProductCard is replaced by a stub: these tests are about which products are
 * shown and what the URL says, not about card rendering.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import type { Product } from "../types";

// The App Router's committed query, as LocationSearchSignal sees it. Tests
// that simulate a Next.js navigation call reportRouterSearch() directly.
let mockRouterSearch = "";
jest.mock("next/navigation", () => ({
  // Only LocationSearchSignal calls this. ProductPrices itself must not.
  useSearchParams: () => new URLSearchParams(mockRouterSearch),
  useRouter: () => {
    throw new Error("ProductPrices must not use the App Router for URL sync");
  },
}));

jest.mock("../cards/ProductCard", () => ({
  __esModule: true,
  default: ({ product }: { product: Product }) => (
    <div data-testid="card">{product.sets?.name}</div>
  ),
}));

jest.mock("../../CardRinkPromo", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../../../lib/clientMarketData", () => ({
  fetchMarketProductsClient: jest.fn().mockResolvedValue([]),
  fetchProductHistoryClient: jest.fn().mockResolvedValue([]),
  fetchVolumeMetrics: jest.fn().mockResolvedValue({}),
}));

jest.mock("../../../lib/exchangeRate", () => ({
  fetchLatestExchangeRateClient: jest.fn().mockResolvedValue({ rate: 1.36, date: null }),
}));

import ProductPrices from "../index";
import {
  reportRouterSearch,
  resetLocationSearchForTests,
} from "../../../lib/locationSearch";

function makeProduct(id: number, setName: string, generation: string, typeLabel: string): Product {
  return {
    id,
    usd_price: 100 + id,
    url: "https://example.test/product",
    last_updated: "2026-07-01T00:00:00",
    sets: {
      name: setName,
      code: setName.slice(0, 3).toUpperCase(),
      release_date: `2026-0${id}-01`,
      generations: { id, name: generation },
    },
    product_types: { id, name: typeLabel.toLowerCase().replace(/ /g, "_"), label: typeLabel },
  };
}

const PRODUCTS: Product[] = [
  makeProduct(1, "Alpha Set", "Gen One", "Booster Box"),
  makeProduct(2, "Beta Set", "Gen Two", "Elite Trainer Box"),
];

function Page() {
  return (
    <ProductPrices
      initialProducts={PRODUCTS}
      initialExchangeRate={1.36}
      initialVolumeMetrics={{}}
    />
  );
}

const cardNames = () => screen.queryAllByTestId("card").map((el) => el.textContent);
const searchBox = () => screen.getByPlaceholderText("Search by name or variant...");
const generationSelect = () =>
  screen.getByRole("option", { name: "All Generations" }).closest("select") as HTMLSelectElement;

beforeEach(() => {
  window.history.replaceState(null, "", "/prices");
  resetLocationSearchForTests();
  mockRouterSearch = "";
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("server render (F012)", () => {
  it("renders the controls and every card with defaults, whatever the URL says", () => {
    window.history.replaceState(null, "", "/prices?q=beta&view=flat");
    const html = renderToString(<Page />);
    expect(html).toContain("All Generations");
    expect(html).toContain("Alpha Set");
    expect(html).toContain("Beta Set");
    expect(html).toMatch(/Found <!-- -->2<!-- --> products/);
  });
});

describe("hydration", () => {
  it("hydrates without a mismatch, then applies the URL's filters", async () => {
    window.history.replaceState(null, "", "/prices?q=beta");
    // Server HTML is rendered from the server snapshot (""), i.e. defaults.
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Page />);
    document.body.appendChild(container);
    const errors = jest.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = jest.fn();

    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(container, <Page />, { onRecoverableError: recoverable });
    });
    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    expect(recoverable).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(cardNames()).toEqual(["Beta Set"]);
    expect((searchBox() as HTMLInputElement).value).toBe("beta");
    // Adopting the URL must not rewrite it.
    expect(window.location.search).toBe("?q=beta");

    errors.mockRestore();
    act(() => root?.unmount());
    container.remove();
  });
});

describe("state -> URL (F016)", () => {
  it("writes the search to the URL once, 250 ms after the last keystroke, via replaceState", () => {
    render(<Page />);
    const replaceSpy = jest.spyOn(window.history, "replaceState");

    fireEvent.change(searchBox(), { target: { value: "a" } });
    fireEvent.change(searchBox(), { target: { value: "al" } });
    fireEvent.change(searchBox(), { target: { value: "alp" } });
    act(() => {
      jest.advanceTimersByTime(249);
    });
    expect(replaceSpy).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith(null, "", "/prices?q=alp");
    expect(cardNames()).toEqual(["Alpha Set"]);
    replaceSpy.mockRestore();
  });

  it("does not touch the URL on mount, even for a non-canonical query", () => {
    window.history.replaceState(null, "", "/prices?q=beta&gen=Gen+Two&utm_source=news");
    const replaceSpy = jest.spyOn(window.history, "replaceState");
    render(<Page />);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(replaceSpy).not.toHaveBeenCalled();
    replaceSpy.mockRestore();
  });

  it("keeps query keys it does not own", () => {
    window.history.replaceState(null, "", "/prices?utm_source=news");
    render(<Page />);
    fireEvent.change(generationSelect(), { target: { value: "Gen One" } });
    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(window.location.search).toBe("?utm_source=news&gen=Gen+One");
  });

  it("removes the owned key when a value goes back to its default", () => {
    window.history.replaceState(null, "", "/prices?gen=Gen+One");
    render(<Page />);
    fireEvent.change(generationSelect(), { target: { value: "all" } });
    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(window.location.pathname + window.location.search).toBe("/prices");
  });
});

describe("URL -> state (F054)", () => {
  it("resets the filters when a same-page link navigates to plain /prices", () => {
    window.history.replaceState(null, "", "/prices?gen=Gen+Two");
    render(<Page />);
    expect(cardNames()).toEqual(["Beta Set"]);

    // What the header "Prices" <Link> does: Next.js pushes the URL without a
    // DOM event, then LocationSearchSignal reports the router's new query.
    act(() => {
      window.history.pushState({ __NA: true }, "", "/prices");
      reportRouterSearch("");
    });

    expect(cardNames()).toEqual(["Beta Set", "Alpha Set"]);
    expect(generationSelect().value).toBe("all");
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    // The old filter must not be written back.
    expect(window.location.search).toBe("");
  });

  it("follows back/forward (popstate)", () => {
    render(<Page />);
    act(() => {
      window.history.pushState({ __NA: true }, "", "/prices?q=alpha");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(cardNames()).toEqual(["Alpha Set"]);
    expect((searchBox() as HTMLInputElement).value).toBe("alpha");
  });

  it("drops a pending write when the URL changes before it fires", () => {
    render(<Page />);
    fireEvent.change(searchBox(), { target: { value: "alp" } });
    act(() => {
      window.history.pushState({ __NA: true }, "", "/prices?gen=Gen+Two");
      reportRouterSearch("gen=Gen+Two");
    });
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(window.location.search).toBe("?gen=Gen+Two");
    expect((searchBox() as HTMLInputElement).value).toBe("");
    expect(cardNames()).toEqual(["Beta Set"]);
  });

  it("does not reset the search when the App Router echoes an older write late", () => {
    render(<Page />);
    fireEvent.change(searchBox(), { target: { value: "al" } });
    act(() => {
      jest.advanceTimersByTime(250);
    });
    fireEvent.change(searchBox(), { target: { value: "alp" } });
    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(window.location.search).toBe("?q=alp");

    // Next.js commits the restore for "?q=al" only now, after "?q=alp" was
    // written, and its HistoryUpdater puts "?q=al" back in the address bar.
    act(() => {
      window.history.replaceState({ __NA: true }, "", "/prices?q=al");
      reportRouterSearch("q=al");
    });
    expect((searchBox() as HTMLInputElement).value).toBe("alp");

    // A re-render while the address bar is behind must not pick it up either.
    fireEvent.change(searchBox(), { target: { value: "alph" } });
    expect((searchBox() as HTMLInputElement).value).toBe("alph");
    expect(cardNames()).toEqual(["Alpha Set"]);

    // The later restores arrive; the next write still lands.
    act(() => {
      window.history.replaceState({ __NA: true }, "", "/prices?q=alp");
      reportRouterSearch("q=alp");
    });
    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(window.location.search).toBe("?q=alph");
    expect((searchBox() as HTMLInputElement).value).toBe("alph");
  });
});
```

5. **Update `frontend/app/components/ProductPrices/__tests__/sorting.test.ts`**: append (2 tests):

```ts
describe("sortProducts by release date", () => {
  const dated = (id: number, release_date: string) =>
    makeProduct({ id, sets: { name: `Set ${id}`, code: `S${id}`, release_date } });

  it("orders newest first for desc and oldest first for asc", () => {
    const products = [dated(1, "2024-05-01"), dated(2, "2026-01-15"), dated(3, "2025-03-10")];
    expect(sortProducts(products, "release_date", "desc").map((p) => p.id)).toEqual([2, 3, 1]);
    expect(sortProducts(products, "release_date", "asc").map((p) => p.id)).toEqual([1, 3, 2]);
  });

  it("returns a new array and leaves the input order untouched", () => {
    const products = [dated(1, "2024-05-01"), dated(2, "2026-01-15")];
    const sorted = sortProducts(products, "release_date", "desc");
    expect(sorted).not.toBe(products);
    expect(products.map((p) => p.id)).toEqual([1, 2]);
  });
});
```

6. **Update `frontend/scripts/supabase-stub.test.mjs`** (Node test runner, `pnpm test:scripts`): append (3 tests):

```js
test('fixture "catalog" serves two product summaries and nothing else', async () => {
  const fx = await startSupabaseStub({ port: 0, fixture: "catalog" });
  try {
    const res = await fetch(`${fx.url}/rest/v1/rpc/get_market_product_summaries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-range"), "0-1/2");
    const rows = await res.json();
    assert.deepEqual(
      rows.map((row) => row.set_name),
      ["Stubfixture Alpha", "Stubfixture Beta"]
    );

    const other = await fetch(`${fx.url}/rest/v1/rpc/get_set_analytics`, {
      method: "POST",
      body: "{}",
    });
    assert.deepEqual(await other.json(), []);
  } finally {
    await fx.close();
  }
});

test("an unknown fixture name is rejected", async () => {
  await assert.rejects(startSupabaseStub({ port: 0, fixture: "nope" }), /Unknown SUPABASE_STUB_FIXTURE/);
});

test("the default stub stays empty for the summaries RPC", async () => {
  const res = await fetch(`${stub.url}/rest/v1/rpc/get_market_product_summaries`, {
    method: "POST",
    body: "{}",
  });
  assert.deepEqual(await res.json(), []);
});
```

## Verification

Run from `frontend/`:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
#   expect: exit 0, no output

pnpm exec eslint app/lib/locationSearch.ts app/lib/__tests__/locationSearch.test.tsx \
  app/components/LocationSearchSignal.tsx app/components/__tests__/LocationSearchSignal.test.tsx \
  app/components/ProductPrices/index.tsx app/components/ProductPrices/utils/urlState.ts \
  app/components/ProductPrices/utils/sorting.ts app/components/ProductPrices/__tests__ \
  app/prices/page.tsx
#   expect: no output (zero errors, zero warnings)

pnpm test --ci app/lib/__tests__/locationSearch.test.tsx app/components/__tests__/LocationSearchSignal.test.tsx \
  app/components/ProductPrices/__tests__ app/components/MarketView/__tests__
#   expect: all pass (locationSearch 13, LocationSearchSignal 1, urlState 7, urlSync 10, sorting 4, MarketView suites unchanged)

pnpm test --ci
#   expect: all suites pass; total = pre-PR total + 33

pnpm run test:scripts
#   expect: all pass, including the 3 new fixture tests

grep -rn 'useSearchParams' app --include=*.ts --include=*.tsx | grep -v __tests__
#   expect exactly: app/components/LocationSearchSignal.tsx (import + call) and app/components/BoxCalculator/BoxCalculator.tsx (out of scope)
grep -n 'router.replace\|useRouter\|usePathname' app/components/ProductPrices/index.tsx
#   expect: no output

# Build with the empty stub
pnpm build:stub
#   expect: exit 0; the route table still lists `○ /prices` (static, with its revalidate)
bash /tmp/check-prices-html.sh .next/server/app/prices.html
#   expect: {"bailouts":1,"loadingFallback":0,"selects":2,"allGenerations":1,
#            "foundLine":"Found <!-- -->0<!-- --> products","fixtureAlpha":0,"fixtureBeta":0,"productLinks":0}
#   bailouts is the empty LocationSearchSignal boundary; 0 is also acceptable. If it is 1, confirm it is
#   `<!--$!--><template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING"></template><!--/$-->` with nothing
#   between the template and `<!--/$-->`:
grep -o '<!--\$!--><template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING"></template>.\{0,20\}' .next/server/app/prices.html

# Build with the two-product fixture
SUPABASE_STUB_FIXTURE=catalog pnpm build:stub
#   expect: exit 0 and the log line "(fixture: catalog)"
bash /tmp/check-prices-html.sh .next/server/app/prices.html
#   expect: loadingFallback 0, selects 2, foundLine "Found <!-- -->2<!-- --> products",
#           fixtureAlpha >= 1, fixtureBeta >= 1, productLinks >= 2
wc -c .next/server/app/prices.html; gzip -c .next/server/app/prices.html | wc -c
#   record in the PR; the empty-stub numbers are comparable to the baseline, real data will be larger (the cards are now in the HTML)
```

If the fixture build fails on a page other than `/prices` (the fixture also feeds `/`, `/market`), note the error in the PR, confirm the empty-stub build passes, and do not change other pages to make the fixture pass.

Manual checks in a browser. Use `pnpm dev` with real Supabase credentials in `.env.local` if you have them. Otherwise run the stub on the default port in one terminal, `cd frontend && SUPABASE_STUB_FIXTURE=catalog node scripts/supabase-stub.mjs`, and the app in another, `cd frontend && NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_KEY=stub-anon-key pnpm dev`. Then open `http://localhost:3000/prices`:

1. View Source (not DevTools Elements): the filter bar, "Found N products" and the product cards are in the HTML; there is no "Loading…".
2. DevTools, disable JavaScript, reload: controls and cards are visible (not interactive). Re-enable JavaScript.
3. DevTools Console after a normal reload: no "Hydration failed" or "did not match" errors.
4. DevTools Network, filter `_rsc`, then type `booster` in the search box: zero requests. The address bar changes to `?q=booster` once, about 250 ms after you stop typing. The input never lags behind your typing.
5. Open `/prices?q=beta` (fixture) or `/prices?q=booster` (real data) directly: the full catalog paints first, then filters to the matching cards once the page is interactive; the address bar is not rewritten; no console errors. This first paint of the unfiltered catalog is the accepted tradeoff (see below).
6. Pick a generation, then click "Prices" in the header: the filter resets to "All Generations", all cards show, the address bar is `/prices`, and it stays `/prices`.
7. Pick a generation, click a product card, press Back: `/prices?gen=...` comes back with the filter applied. Now click "Prices" in the header, then press Back: the filter is re-applied; press Forward: it clears.
8. Open `/prices?utm_source=test`, change the sort: the URL is `/prices?utm_source=test&sort=...`.
9. On `/`, submit the hero search form with `booster`: `/prices?q=booster` loads with the search box filled and results filtered after hydration.

Accepted tradeoff (write it in the PR): visits that arrive with a query string (the home search form, shared links) see the unfiltered catalog in the static HTML until hydration, then the filtered list. Before this PR the same visitors saw "Loading…" for the same period, so first content arrives earlier for everyone and nobody waits longer. Rendering per-query HTML would require dynamic rendering of `/prices` and lose the static/ISR page, which is not worth it.

## Owner actions

None required to merge or deploy: no migrations, no environment variables, no dashboard settings.

Optional post-deploy check (the executor has no production access): after the Vercel deploy, run `curl -s https://<production-domain>/prices | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const dom=s.replace(/<script\b[\s\S]*?<\/script>/g,"");console.log({found:(dom.match(/Found (?:<!-- -->)?\d+(?:<!-- -->)? products/)||[null])[0],loading:dom.includes(">Loading…<")})})'`. Correct: `found` shows the real product count (about 306) and `loading` is `false`. Then type in the search box on production with DevTools Network open: no `_rsc` requests.

## Acceptance criteria

- [ ] `grep -rn 'useSearchParams' frontend/app --include=*.tsx | grep -v __tests__` lists only `LocationSearchSignal.tsx` and `BoxCalculator.tsx`.
- [ ] `frontend/app/prices/page.tsx` has no `Suspense` and no `export const dynamic`.
- [ ] `pnpm exec tsc --noEmit` exits 0; ESLint on every touched file reports nothing.
- [ ] `pnpm test --ci` passes with 33 more tests than before; `pnpm run test:scripts` passes.
- [ ] `pnpm build:stub` exits 0 and the DOM check of `prices.html` shows `loadingFallback: 0`, `selects: 2`, `allGenerations: 1` and a `foundLine`.
- [ ] `SUPABASE_STUB_FIXTURE=catalog pnpm build:stub` DOM check shows both fixture products and "Found 2 products".
- [ ] Typing in the `/prices` search box issues zero `_rsc` requests and writes the URL once per pause.
- [ ] With a filter applied, the header "Prices" link clears it and the URL stays `/prices`.
- [ ] Back/forward within `/prices` re-applies the URL's filters.
- [ ] Loading `/prices?q=<term>` shows no hydration error, applies the filter after hydration, and does not rewrite the URL.
- [ ] Foreign query keys (`utm_source`) survive filter changes.

## Rollback

`git revert <merge commit>` and redeploy. There are no migrations, stored data or settings to undo. The revert restores `useSearchParams`, the `Suspense` wrapper and `router.replace` together, which is the known-working (slow) state; do not revert only part of the PR (for example restoring `useSearchParams` in the container without the `Suspense` wrapper fails the build). The stub fixture is opt-in and harmless to keep if only the app code is reverted.

## Commit and PR

Commit message:

```text
perf(prices): server-render the catalog and sync URL state without navigation (WP08)

- ProductPrices no longer calls useSearchParams, which bailed the whole
  catalog out of the prerendered /prices HTML (F012, F025). The URL is read
  through a useSyncExternalStore store (app/lib/locationSearch.ts) whose
  server snapshot is "", so SSR and hydration render defaults and the URL's
  filters apply right after hydration.
- Filter and search changes are written from event handlers, debounced
  250 ms, with history.replaceState(null, ...): no App Router navigation, so
  no RSC refetch of the catalog per keystroke (F016). Search filtering uses
  useDeferredValue and the card lists are memoized.
- URL -> state: back/forward and same-page links (header "Prices") re-seed
  the filters; an empty LocationSearchSignal leaf in its own Suspense
  boundary reports App Router navigations, and echoes of our own writes are
  ignored (F054, F121). Foreign query keys are preserved.
- sortProducts decorates once instead of building Dates per comparison.
- supabase stub: opt-in SUPABASE_STUB_FIXTURE=catalog with two products, to
  verify the prerendered HTML contains cards.
```

PR title: `perf(prices): server-rendered catalog, navigation-free URL state (WP08)`

PR body summary:

- What: F012/F025, F016, F054/F121 as above; list the new files (`app/lib/locationSearch.ts`, `app/components/LocationSearchSignal.tsx`, `ProductPrices/utils/urlState.ts`) and the stub fixture.
- Before/after: the two `/tmp/check-prices-html.sh` outputs (baseline and after, empty stub) plus the fixture output, and the `prices.html` raw and gzip sizes.
- Accepted tradeoff: query-string visits see the unfiltered catalog until hydration (previously "Loading…").
- Deviations from the plan, with reasons: the `LocationSearchSignal` leaf (Next navigations fire no DOM event), the echo ledger instead of a `lastWrittenQuery` ref (lint rules and the late-restore race).
- Follow-ups not done here: `BoxCalculator.tsx:74` has the same bailout on `/box-calculator` and can reuse `useLocationSearch`; WP19 and WP20 must build their URL state on `app/lib/locationSearch.ts`.
- Verification output from every command in the Verification section.
