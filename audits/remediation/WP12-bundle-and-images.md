# WP12: Bundle size and hero image

- **Findings covered**
  - F011 (full; cluster members F011, F013): supabase-js (about 250 kB raw / 66 kB gzip, including GoTrue and Realtime) is on the initial script list of every page because modules rendered on first paint import `app/lib/supabase` statically. WP04 already removed the root-layout path (`AuthContext.tsx`); this package removes the remaining static importers so the library loads only when a page first queries public data.
  - F069 (full): the product detail hero image is lazy-loaded, has no fetch priority and stays `opacity-0` until hydration runs its `onLoad`, so it is the late LCP element on `/product/[id]`; the same page's sibling grid downloads full-size originals instead of thumbnails.
- **Priority rationale**: two measured, low-risk load-time wins (about 66 kB gzip of hydration-path JS on 6 routes: `/`, `/prices`, `/market`, `/compare`, `/box-calculator`, `/portfolio`; and the LCP element on every product page) that are safe to do now that WP04 to WP06 have removed every user-table query from the browser client.
- **Effort**: M, about 4 hours (1.5 h lazy loader and call sites, 1 h ProductImage, 1.5 h tests and the stub-build verification).
- **Depends on**: WP04 (AuthContext and account page no longer import `app/lib/supabase`), WP05 (`app/lib/portfolio.ts` holds reference reads only), WP06 (the shared-recipe RPC lives in `app/components/BoxCalculator/sharedRecipe.ts`). Uses WP00's `pnpm build:stub`. The plan executes packages in order, so WP07 to WP11 have also merged before this one: WP09 replaced `fetchProductHistoryClient` with a batcher (query in `queryHistoryChunk`), WP10 renamed the in-browser portfolio fold to `getPortfolioHistoryInBrowser` (it still calls `fetchPortfolioPriceHistory`), and WP11 step 8a rewrote `exchangeRate.ts`. Every `:line` below is HEAD (pre-WP04) unless it says otherwise; locate code by the function name and quoted text, not by the number.
- **Unblocks**: WP20 (types `BrowserSupabaseClient` and documents `supabaseLoader.ts`; it also deletes this package's `fetchSalesHistory` test case). WP17 (blocking lint) inherits the new ESLint guard.
- **Suggested branch name**: `remediation/wp12-bundle-and-images`
- **Risk level**: low. Data calls behave the same; the only runtime change is that the first public-data query of a page waits for one extra chunk fetch, and every failure of that fetch degrades exactly like a failed query.

## Why

Every page on the site ships the whole Supabase client library (database, auth, realtime and storage clients) in its first batch of JavaScript, and the browser must download, parse and run it before the page becomes interactive, even though no page needs it to render: all catalog data arrives with the HTML. WP04 removed the import that put it on every route through the auth provider, but the home page, `/prices`, `/market`, `/compare`, `/box-calculator` and `/portfolio` still pull it in statically through the market-data, exchange-rate, portfolio-search and shared-recipe modules. After this PR the library is a separate chunk that is fetched the first time a component actually asks for data (a card scrolls into view, the exchange rate loads), so it no longer sits on the hydration path of any page. Separately, on every product page the product photo is a grey "Loading..." box until the page's JavaScript has finished, even when the image bytes arrived long before; after this PR the photo is preloaded with high priority and paints as soon as it downloads, and the "Other products in this set" grid downloads small thumbnails instead of full-size originals.

## Before you start

Read these files in full:

- `frontend/app/lib/supabase.ts` (25 lines). `:23` constructs the browser client at module evaluation, which starts GoTrue's session recovery. Do not change this file.
- `frontend/app/lib/clientMarketData.ts` (433 lines at the time of writing). `:21` static import. Query sites: `fetchNewestPricedAtClient` `:105-160` (query at `:119`), `fetchProductsFallback` `:171-209` (`:173`), `fetchMarketProductsClient` `:211-248` (`:225`, inside `try` at `:224`), `fetchProductHistoryClient` `:250-306` (`:272`; WP09 replaces it with a batcher whose query lives in `queryHistoryChunk`), `fetchVolumeMetrics` `:314-356` (`:328`, inside `try` at `:327`), `fetchSalesHistory` `:364-433` (`:393`, inside `try` at `:392`).
- `frontend/app/lib/exchangeRate.ts` (50 lines at HEAD; WP11 step 8a replaced it in full, WP04 step 11 leaves it alone). `:4` static import; the single query sits inside the `try` of the IIFE (`:20-26` at HEAD).
- `frontend/app/lib/portfolio.ts`. `:1` static import. After WP05 the remaining query sites are `fetchPortfolioPriceHistory` (`:461-497` at HEAD, query at `:472`), `searchProducts` (`:756-777`), `searchProductsBySet` (`:784-818`), `getAllProducts` (`:823-843`), plus anything WP10 added.
- `frontend/app/components/BoxCalculator/sharedRecipe.ts` (created by WP06 step 6). Static import of `../../lib/supabase`; one RPC.
- `frontend/eslint.config.mjs`: WP04's `ANON_CLIENT_FORBIDDEN_FILES` array and its `no-restricted-imports` block (with WP05's second pattern), and WP05's `no-restricted-syntax` block.
- `frontend/app/components/ProductPrices/shared/ProductImage.tsx` (110 lines). `:42` `useState(true)` for `isLoading`; `:87-91` pulse overlay; `:99-101` `opacity-0` until loaded; `:102` `onLoad`; `:104` `loading="lazy"`; `:105` `unoptimized`.
- `frontend/app/product/[id]/page.tsx`. Hero `ProductImage` at `:238-242`; sibling grid `ProductImage` at `:411-415`.
- Tests that mock the client: `frontend/app/lib/__tests__/clientMarketData.cache.test.ts`, `portfolio.test.ts`, `portfolio.freshness.test.ts`, `import.test.ts`, WP09's `clientMarketData.history.test.ts`, WP11's `exchangeRate.test.ts`, WP10's `portfolio.history.test.ts` (imports `supabase` from `../supabase` statically to reach `fromMock`; still works because the loader's `import()` returns the same mocked module), WP05's portfolio tests, WP04's `app/context/__tests__/AuthContext.test.tsx` (its `lib/supabase` mock throws on load; keep it).

Confirm the starting state from `frontend/`:

```bash
# 1. WP04, WP05, WP06 have landed. Each must print nothing.
grep -n 'lib/supabase"' app/context/AuthContext.tsx app/account/page.tsx
grep -n 'from("portfolio' app/lib/portfolio.ts
grep -n 'lib/supabase"' app/components/BoxCalculator/hooks/useBoxRecipes.ts
# And this file must exist:
ls app/components/BoxCalculator/sharedRecipe.ts

# 2. The static importers this package removes. Expect exactly these four lines:
#    app/lib/clientMarketData.ts, app/lib/exchangeRate.ts, app/lib/portfolio.ts,
#    app/components/BoxCalculator/sharedRecipe.ts
grep -rn 'lib/supabase"\|from "\./supabase"\|from "\.\./supabase"' app --include=*.ts --include=*.tsx | grep -v __tests__

# 3. No client module imports a runtime value from @supabase/*. Every line printed
#    must be a server file (app/api/**, app/auth/callback/route.ts, app/lib/server/**,
#    routeSupabase.ts, serverSupabase.ts, serverMarketData.ts, authSession.ts, proxy.ts)
#    or app/lib/supabase.ts itself.
#    A line that starts with `}` is the end of a multi-line import: open the file and
#    check whether that import statement starts with `import type`.
grep -rn 'from "@supabase/' app proxy.ts --include=*.ts --include=*.tsx | grep -v __tests__ | grep -v 'import type'

# 4. F069 still present. Expect :42 useState(true) and :104 loading="lazy", and no "priority".
grep -n 'useState(true)\|loading="lazy"\|priority' app/components/ProductPrices/shared/ProductImage.tsx
# Expect the sibling ProductImage (~:411) to have no preferThumbnail line.
grep -n -A4 '<ProductImage' 'app/product/[id]/page.tsx'

# 5. WP00 harness exists.
grep -n '"build:stub"' package.json
```

Stop and report (do not improvise) if:

- Check 1 prints anything or `sharedRecipe.ts` is missing: a dependency has not landed. This package must not move user-table code.
- Check 2 prints a file not in the list: add it to step 3's call-site conversion only if it reads public tables or anon-granted RPCs; if it reads `profiles`, `portfolios`, `portfolio_holdings`, `portfolio_lots` or `box_recipes`, stop (that is an F001 regression, not a bundle issue).
- Check 3 prints a client module (a file with `"use client"` or imported by one) with a value import from `@supabase/*`: that import also pins supabase-js to the initial bundle. Convert it to `import type` if only types are used; otherwise stop and report.

Measure the baseline before changing anything (the build writes `.next/`; never run it while another agent builds in the same checkout). First save the analysis script from "Bundle analysis" in the Verification section, byte for byte, as `/tmp/wp12-analyze.sh` (outside the repo; do not commit it). Then:

```bash
pnpm build:stub > /tmp/wp12-build-before.log 2>&1; echo "exit=$?"   # exit=0
bash /tmp/wp12-analyze.sh > /tmp/wp12-before.txt 2>&1
cat /tmp/wp12-before.txt
```

If the baseline build does not exit 0, stop and report: the stub harness from WP00 is broken, and nothing in this package can be measured.

## Implementation steps

Make two commits: steps 1 to 5 (F011), then steps 6 and 7 (F069). They are independent, so either can be reverted alone.

### Step 1. New file `frontend/app/lib/supabaseLoader.ts`

One shared, memoised lazy accessor instead of four copies of `() => import("./supabase")`: the plan's per-file getter would work, but a single module keeps one memo, one retry policy and one ESLint allowlist entry.

```ts
import { logCaughtError } from "./logger";

/**
 * Lazy access to the anonymous browser Supabase client in ./supabase.
 *
 * Why lazy (review F011/F013): ./supabase pulls in supabase-js (about 250 kB
 * raw / 66 kB gzip: PostgREST, GoTrue, Realtime) and constructs the client at
 * module evaluation, which also starts GoTrue's session recovery. A static
 * import from any module a page renders puts that chunk on the page's
 * hydration path. The dynamic import() below makes the bundler emit it as a
 * separate async chunk, fetched the first time a component actually queries.
 *
 * Only public, anon-readable data goes through this client: the catalog,
 * price and sales history, exchange rates, and the get_shared_recipe RPC.
 * User tables are reached through cookie-backed route handlers in app/api/*
 * (review F001); eslint.config.mjs forbids this module in those files.
 *
 * This is the only module allowed to import ./supabase (eslint.config.mjs).
 */
export type BrowserSupabaseClient = (typeof import("./supabase"))["supabase"];

let clientPromise: Promise<BrowserSupabaseClient> | null = null;

/**
 * The browser client, loading its chunk on first use. Concurrent and later
 * callers share one load and one client. A failed load (offline, or a tab
 * that outlived its deployment's chunks) is not cached: the next call retries.
 */
export function getSupabase(): Promise<BrowserSupabaseClient> {
  if (!clientPromise) {
    clientPromise = import("./supabase").then(
      (mod) => mod.supabase,
      (error: unknown) => {
        clientPromise = null;
        throw error;
      }
    );
  }
  return clientPromise;
}

/**
 * For read paths whose contract is "degrade, never throw": logs a failed
 * load under the caller's label and returns null, so the caller can return
 * the same fallback it returns for a failed query.
 */
export async function getSupabaseOrNull(
  logLabel: string
): Promise<BrowserSupabaseClient | null> {
  try {
    return await getSupabase();
  } catch (error) {
    logCaughtError(logLabel, error);
    return null;
  }
}
```

No `"use client"` directive (it has no React code; every importer is already a client module). About the retry: resetting the memo guarantees this module never hands out a cached rejection. Whether the browser actually refetches the chunk on the next call is up to the bundler runtime (Turbopack's runtime may keep a failed chunk promise until the page reloads); that is acceptable, because every caller already degrades on failure. Do not add retry loops, timers or `location.reload()` to work around it. `typeof import("./supabase")` is a type-only reference and is erased; it does not create a static import. This was typechecked against the installed TypeScript 6 and supabase-js 2.112 while writing this spec: `(await getSupabase()).from(...).select(...).single()` and `.rpc(...)` keep their current types.

### Step 2. The conversion rule (applies to every file in step 3)

For each file:

1. Replace the static import line with `import { getSupabase } from "./supabaseLoader";` (or `getSupabaseOrNull`, or both, as the step says; adjust the relative path).
2. Run `pnpm exec tsc --noEmit`. Every remaining use of `supabase` in that file now fails with TS2304 "Cannot find name 'supabase'". That list is your complete set of call sites.
3. Fix each one by declaring `const supabase = await getSupabase();` (or the `getSupabaseOrNull` form) inside the innermost `async` function that contains the use, placed so a failed load takes the same path a failed query takes today:
   - The query is inside a `try` whose `catch` degrades (logs and returns a fallback): put `const supabase = await getSupabase();` as the first statement inside that `try`.
   - The function lets query errors reject (it `throw`s the PostgREST error or has only `try/finally`): put it as the first statement of the function body (or of the IIFE body), before the query.
   - The function never throws and returns a fallback value on a query error without a surrounding `try`: use `const supabase = await getSupabaseOrNull("<the label the function already logs query errors under>"); if (!supabase) return <that same fallback>;`.
4. Never declare it at module scope and never use top-level `await`: either would evaluate `./supabase` on import and undo the change.

### Step 3. Convert the four importers

3a. `frontend/app/lib/clientMarketData.ts`. Replace `:21` `import { supabase } from "./supabase";` with:

```ts
import { getSupabase, getSupabaseOrNull } from "./supabaseLoader";
```

Then, per function (HEAD line numbers; adapt to WP09/WP11 edits):

- `fetchNewestPricedAtClient` (`:105`). It never throws and fails closed with `new Map()`. Insert after the `if (productIds && productIds.length === 0) return newestByProduct;` line:

  ```ts
    const supabase = await getSupabaseOrNull("client_price_freshness_failed");
    // Same fail-closed answer as a query error below.
    if (!supabase) return new Map();
  ```

- `fetchProductsFallback` (`:171`). Errors throw today (`:184-186`). First statement of the body:

  ```ts
    const supabase = await getSupabase();
  ```

- `fetchMarketProductsClient` (`:211`). Inside the IIFE, first statement inside `try {` (`:224`), before `const { data, error } = await supabase.rpc(...)`:

  ```ts
        const supabase = await getSupabase();
  ```

- Price history (WP09's batcher). The query is in `async function queryHistoryChunk(productIds, timeframe)`: make `const supabase = await getSupabase();` its first statement (before `const startDate = ...`). A rejection then reaches the `.catch((error: unknown) => { ... waiters.get(productId)?.reject(error); })` that `flushHistoryQueue` chains on every `queryHistoryChunk(...)` call, so every queued card is settled. Do not put the `await` in `flushHistoryQueue` or `fetchProductHistoryClient` (both are synchronous; a rejection there would leave waiters pending forever). Only if WP09's batcher is absent (`grep -n "queryHistoryChunk" app/lib/clientMarketData.ts` prints nothing), put it as the first statement inside `const fetchPromise = (async () => {` (`:270` at HEAD).
- `fetchVolumeMetrics` (`:314`). First statement inside `try {` (`:327`); the existing `catch` already logs `volume_metrics_load_failed` and returns `{}`.
- `fetchSalesHistory` (`:364`). First statement inside the `try {` at `:392`; the existing `catch` logs `sales_history_load_failed` and leaves `sales = []`.

After this, `grep -n "supabase" app/lib/clientMarketData.ts` shows only the import line, the `const supabase = await getSupabase...` lines, and `supabase.from` / `supabase.rpc` uses inside those functions.

3b. `frontend/app/lib/exchangeRate.ts`. Replace `import { supabase } from "./supabase";` with `import { getSupabase } from "./supabaseLoader";`. Inside the IIFE, make the first statement inside `try {` :

```ts
      const supabase = await getSupabase();
```

so a failed load reaches the existing `catch` (`logCaughtError("client_exchange_rate_failed", ...)` and WP11's `return exchangeRateCache ?? { rate: DEFAULT_EXCHANGE_RATE, date: null }` fallback). Keep the `"use client"` directive and every other line.

3c. `frontend/app/lib/portfolio.ts`. Replace `import { supabase } from "./supabase";` with `import { getSupabaseOrNull } from "./supabaseLoader";`. In WP05's header doc comment, the first paragraph ends with the line ` * is why it can use the browser client in ./supabase.`; change that line to ` * is why it can use the browser client (loaded lazily through ./supabaseLoader).` (the sentence starts on the previous line, so search for `is why it can use the browser client`). Then:

- `fetchPortfolioPriceHistory` (`:461`). It returns `{ rows: null, error }` instead of throwing. First statement of the body:

  ```ts
    const supabase = await getSupabaseOrNull("portfolio_price_history_failed");
    if (!supabase) {
      return { rows: null, error: new Error("Supabase client failed to load.") };
    }
  ```

  (`Error` is already an accepted value for that `error` field: the page-cap branch returns `capError`, an `Error`.) After WP05 the body starts with `const rows: PortfolioPriceHistoryRow[] = [];`; insert the block above that line, before the `for` loop and its `signal?.aborted` check. A failed load then logs twice, once as `portfolio_price_history_failed` here and once as `price_history_fetch_failed` in the caller; that is expected, leave it. After WP10 this function still exists: `getPortfolioHistoryInBrowser` (the fallback used when `/api/portfolio/history` answers 501) calls it. If `grep -n "fetchPortfolioPriceHistory" app/lib/portfolio.ts` prints nothing (the owner already ran WP10's cleanup), skip this bullet.
- `searchProducts` (`:756`). After `if (!query || query.length < 2) return [];`:

  ```ts
    const supabase = await getSupabaseOrNull("product_search_failed");
    if (!supabase) return [];
  ```

- `searchProductsBySet` (`:784`). First statement:

  ```ts
    const supabase = await getSupabaseOrNull("sets_search_failed");
    if (!supabase) return [];
  ```

- `getAllProducts` (`:823`). First statement (its contract "degrades to []" is relied on by `import.ts` `fetchSupportedProducts`):

  ```ts
    const supabase = await getSupabaseOrNull("all_products_fetch_failed");
    if (!supabase) return [];
  ```

3d. `frontend/app/components/BoxCalculator/sharedRecipe.ts` (WP06). Replace `import { supabase } from "../../lib/supabase";` with `import { getSupabaseOrNull } from "../../lib/supabaseLoader";` and, directly after the `if (!SHARE_CODE_RE.test(shareCode)) return null;` guard:

```ts
  const supabase = await getSupabaseOrNull("shared_recipe_fetch_failed");
  if (!supabase) return null;
```

Update the file's doc comment "stays on the anonymous browser client" to "stays on the anonymous browser client (loaded lazily through lib/supabaseLoader)". Do not add `sharedRecipe.ts` to `ANON_CLIENT_FORBIDDEN_FILES`.

3e. Re-run check 2 from "Before you start". It must print nothing now. Then `grep -rn 'import("./supabase")' app` must print exactly one line, in `app/lib/supabaseLoader.ts`.

### Step 4. ESLint guards (`frontend/eslint.config.mjs`)

4a. A repo-wide guard so no module re-adds a static import. Insert this object into the exported array immediately BEFORE the object whose `files` is `ANON_CLIENT_FORBIDDEN_FILES` (order matters: in flat config, when two objects set `no-restricted-imports` for the same file, the later object's options replace the earlier ones, so the stricter anon-client block must come last). If that block does not exist, append this object as the last element.

```js
  // WP12 (review F011/F013): supabase-js is about 66 kB gzip and must stay off
  // every page's initial script list. Only app/lib/supabaseLoader.ts may load
  // app/lib/supabase, through a dynamic import(). Everything else calls
  // `await getSupabase()` from app/lib/supabaseLoader.
  {
    files: ["app/**/*.{ts,tsx}"],
    ignores: ["app/lib/supabaseLoader.ts", "**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)lib/supabase$",
              message:
                "A static import of app/lib/supabase puts supabase-js (~66 kB gzip) on the page's initial load. Use `await getSupabase()` from app/lib/supabaseLoader.",
            },
            {
              regex: "^\\.{1,2}/supabase$",
              message:
                "A static import of app/lib/supabase puts supabase-js (~66 kB gzip) on the page's initial load. Use `await getSupabase()` from app/lib/supabaseLoader.",
            },
          ],
        },
      ],
    },
  },
```

4b. In the `ANON_CLIENT_FORBIDDEN_FILES` block's `patterns` array, extend both regexes so the loader is forbidden there too (otherwise a portfolio or box-recipe file could reach the anon client through the loader and bypass WP04's guard):

- `"(^|/)lib/supabase$"` becomes `"(^|/)lib/supabase(Loader)?$"`
- `"^\\.{1,2}/supabase$"` becomes `"^\\.{1,2}/supabase(Loader)?$"`

Keep both messages and the `@supabase/ssr` path entry unchanged. Do not touch WP05's `no-restricted-syntax` block.

Both blocks were exercised with the installed ESLint 9.39.5 on probe files while writing this spec: a static `../../lib/supabase` import in an ordinary component gets the WP12 message; `./supabase` in `app/lib/clientMarketData.ts` gets it; the loader importing `./supabase` dynamically and a test importing `../supabase` are clean; a file in `ANON_CLIENT_FORBIDDEN_FILES` importing `../../lib/supabaseLoader` or `../../lib/supabase` gets the anon-client message. `no-restricted-imports` does not inspect dynamic `import()`, which is why the loader needs no exemption for its own call.

### Step 5. Existing tests

No production signature changes, so the existing `jest.mock("../supabase", ...)` mocks keep working: the loader's `import("./supabase")` resolves to the same module path, and next/jest compiles `import()` to `require`, which honours `jest.mock` and `jest.resetModules()` (the existing tests already rely on this for `await import("../clientMarketData")`).

Run the affected suites (see Verification). If one fails because it asserts a mock call before awaiting the function under test, the cause is the extra microtask hops of the lazy load: make the test await the returned promise (or `await jest.advanceTimersByTimeAsync(...)` where it uses fake timers) before asserting. Never make production code synchronous again to satisfy a test, and never weaken an assertion.

Commit 1 here (message in "Commit and PR").

### Step 6. `frontend/app/components/ProductPrices/shared/ProductImage.tsx`: `priority` prop

Correction to the plan's wording, verified against the installed Next 16.3.6: next/image's `priority` prop is marked `@deprecated` in favour of `preload` (`node_modules/next/dist/shared/lib/get-img-props.d.ts:24-28`); both do the same thing (`get-img-props.js:271` disables lazy loading; `:587` sets `meta.preload = preload || priority`, and `node_modules/next/dist/client/image-component.js:233-234` then calls `ReactDOM.preload(src, { as: "image", fetchPriority })`), and passing both throws in development (`:407-408`). So ProductImage exposes a prop named `priority` (the plan's API) and forwards it to next/image as `preload`. `fetchPriority` is an independent passthrough (`:150`, `:572`) and must be passed explicitly. `loading="lazy"` together with `preload` throws in development (`:400-401`), so `loading` is only set for non-priority images. Rendering these props with `react-dom/server` while writing this spec produced `<link rel="preload" as="image" href="<url>" fetchPriority="high"/>` followed by `<img ... fetchPriority="high" ...>` with no `loading` attribute.

6a. Props interface (`:6-18`). Add after `preferThumbnail?: boolean;`:

```ts
  /**
   * The page's main above-the-fold image (the product detail hero). Preloads
   * it with high fetch priority, loads it eagerly, and renders it visible from
   * the server HTML instead of fading in after hydration (review F069). Use it
   * for at most one image per page: a preload competes with everything else.
   */
  priority?: boolean;
```

6b. Destructuring (`:35-40`). Add `priority = false,` after `preferThumbnail = false,`.

6c. Replace `:42` `const [isLoading, setIsLoading] = useState(true);` with:

```ts
  // A priority image starts visible: its server-rendered <img> must paint as
  // soon as the bytes arrive. Gating it on onLoad kept it at opacity-0 behind
  // the pulse until the client bundle hydrated (review F069). Other images
  // keep the fade-in.
  const [isLoading, setIsLoading] = useState(!priority);
```

6d. Replace the `<Image ... />` element (`:93-106`) with:

```tsx
        {/* next/image 16: `preload` replaces the deprecated `priority` prop.
            It disables lazy loading and emits <link rel="preload">;
            fetchPriority is separate. `loading` must stay unset when preload
            is on (next/image throws in development otherwise).
            unoptimized stays: Vercel image transformations were turned off
            on purpose (commit bd29639, monthly quota). */}
        <Image
          key={resolvedUrl}
          src={resolvedUrl}
          alt={productName}
          width={200}
          height={200}
          className={`max-w-full max-h-full object-contain transition-opacity ${
            isLoading ? "opacity-0" : "opacity-100"
          }`}
          onLoad={handleImageLoad}
          onError={handleImageError}
          preload={priority}
          fetchPriority={priority ? "high" : undefined}
          loading={priority ? undefined : "lazy"}
          unoptimized
        />
```

Leave everything else (thumbnail logic, `handleImageError`, fallback markup, overlay condition `isLoading && (...)`) unchanged. With `priority`, `isLoading` starts false, so the overlay is not rendered and the class is `opacity-100` in the server HTML; `handleImageLoad` setting false again is a no-op. Server and client compute the same initial state, so there is no hydration mismatch. These props were typechecked against next 16.3.6 while writing this spec.

### Step 7. `frontend/app/product/[id]/page.tsx`

WP07 and WP11 have already edited this file, so find the two `<ProductImage` elements by content: the hero is the one with `className="w-full h-72"` under the `{/* Hero */}` comment; the sibling one is inside `siblings.map((sib) => (` with `className="w-full h-28"`. Change only the props shown.

7a. Hero (`:238-242` at HEAD): add `priority`:

```tsx
          <ProductImage
            imageUrl={product.image_url}
            productName={`${setName} ${label}`}
            className="w-full h-72"
            priority
          />
```

Do not add `preferThumbnail` here: the thumbnail is 256 px on its long edge (`main.py:97` `THUMBNAIL_MAX_EDGE`), too small for this slot.

7b. Sibling grid (`:411-415` at HEAD): add `preferThumbnail` (every other list-sized call site already passes it: `ProductCard.tsx:132-137` and `:236-241`, `MarketView.tsx:155-160`, `app/page.tsx:52-57`):

```tsx
                <ProductImage
                  imageUrl={sib.image_url}
                  productName={getProductLabel(sib)}
                  className="w-full h-28"
                  preferThumbnail
                />
```

Commit 2 here.

## Pitfalls: do not do this

- **Do not declare `const supabase = await getSupabase()` at module scope or use top-level `await`.** It evaluates `./supabase` on import and puts the chunk back on the initial load.
- **Do not cache a rejected import.** `getSupabase` must reset its memo on failure (step 1), so this module never pins a failure; whether the chunk itself is refetched is the bundler runtime's business (step 1 note). Do not change the existing fallback caching either: `fetchVolumeMetrics` caching `{}` and `fetchSalesHistory` caching `[]` after a failure is today's behaviour for a failed query and stays the same for a failed load.
- **Do not put the `await` outside the `try` that turns failures into the function's fallback.** `fetchVolumeMetrics`, `fetchSalesHistory`, `fetchNewestPricedAtClient`, `fetchLatestExchangeRateClient`, the portfolio searches and `fetchSharedRecipe` never reject today; callers (`useCurrencyConversion`, `import.ts`, the recipe loader) depend on that.
- **In WP09's batcher, do not await the client in `flushHistoryQueue` or `fetchProductHistoryClient`.** Put it in `queryHistoryChunk`, whose rejection is routed to the queued waiters. Anywhere else a failure leaves cards waiting forever.
- **Do not use `next/dynamic`, `React.lazy` or `webpackChunkName` comments.** `next/dynamic` is for components; Turbopack ignores webpack magic comments. A plain `import()` is what splits the chunk.
- **Do not leave a new test file without a top-level `import` or `export`.** `tsc --noEmit` type-checks tests (`tsconfig.json` includes `**/*.ts`), and a file with neither is a global script: two such files that both declare `mockEvaluations` fail with TS2451 "Cannot redeclare block-scoped variable". The test code below includes the `export {};` or static import that prevents this; keep it.
- **Do not import from `./supabase` anywhere else, including `import type`.** Use `BrowserSupabaseClient` from `supabaseLoader.ts` if a type is needed. The new ESLint guard enforces this.
- **Do not change `app/lib/supabase.ts`** (`flowType: "pkce"`, the placeholder handling) or bridge the cookie session into it. WP04's pitfalls still apply: the browser client stays anonymous; user tables go through route handlers.
- **Do not add `sharedRecipe.ts`, `clientMarketData.ts`, `exchangeRate.ts` or `portfolio.ts` to `ANON_CLIENT_FORBIDDEN_FILES`.** They read anon-readable data by design.
- **Do not expect the chunk to disappear from `/`, `/prices` or `/compare`.** Those pages query public data shortly after load (card intersection, exchange rate), so the chunk is still downloaded there, just after hydration instead of before it (F011 verifier correction 4). The measurable claim is "absent from every page's initial script list".
- **Do not use next/image's `priority` prop.** It is deprecated in 16.3.6; use `preload`, and never both (throws in development).
- **Do not keep `loading="lazy"` on the priority image.** next/image throws in development on `preload` + `loading="lazy"` (F069 verifier correction 1). Deleting `loading="lazy"` for non-priority images changes nothing (lazy is already the default), so keep it there for clarity.
- **Do not assume `preload` sets fetch priority.** It does not; pass `fetchPriority="high"` (F069 verifier correction 2).
- **Do not drop `unoptimized`, for the hero or anywhere.** Commit bd29639 turned Vercel image optimisation off after ~4.9K of the 5K monthly transformations were used (F069 verifier correction 3). A mid-size scraper derivative (`products/{id}_md.webp`) is the better long-term fix for the hero's size; list it as a follow-up, do not build it here.
- **Do not pass `preferThumbnail` to the hero.** The 256 px thumbnail is too small for the 300 px slot on high-DPR screens.
- **Do not add `priority` to grid or list images** (ProductCard, MarketView, RecentlyReleased, the sibling grid). Preloading many images competes with the real LCP element and wastes mobile bandwidth.
- **Do not remove `images.remotePatterns` from `next.config.ts`.** It is unused for rendering but still restricts the live `/_next/image` endpoint (F069 verifier correction 7); removing it is a separate security decision.
- **Do not add a `<link rel="preconnect">` or switch ProductImage to a plain `<img>`.** Both were considered by the verifier; the preconnect is marginal once the preload is in the HTML (correction 6), and the plain `<img>` is outside this plan's decision. Mention both as follow-ups in the PR.
- **Do not change the non-priority fade-in behaviour.** The plan limits the visibility change to priority images.
- **Do not run `pnpm build:stub` while another agent builds in the same checkout, and never `next start` or deploy the stub build** (its pages have empty data).

## Tests

### New: `frontend/app/lib/__tests__/supabaseLoader.test.ts`

```ts
/**
 * WP12 (review F011): the browser Supabase client is loaded on first use,
 * once, and a failed load is retried rather than cached.
 */
// Makes this file a module; without it tsc treats it as a global script and
// its `mockEvaluations` collides with supabaseLazyLoad.test.ts (TS2451).
export {};

let mockEvaluations = 0;
let mockFailuresLeft = 0;

jest.mock("../supabase", () => {
  mockEvaluations += 1;
  if (mockFailuresLeft > 0) {
    mockFailuresLeft -= 1;
    throw new Error("ChunkLoadError: Loading chunk failed");
  }
  return { supabase: { marker: "browser-client" } };
});

jest.mock("../logger", () => ({
  logCaughtError: jest.fn(),
  logSupabaseError: jest.fn(),
}));

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockEvaluations = 0;
  mockFailuresLeft = 0;
});

it("does not evaluate ./supabase when imported", async () => {
  await import("../supabaseLoader");
  expect(mockEvaluations).toBe(0);
});

it("shares one client across concurrent and later calls", async () => {
  const { getSupabase } = await import("../supabaseLoader");
  const [a, b] = await Promise.all([getSupabase(), getSupabase()]);
  const c = await getSupabase();
  expect(a).toBe(b);
  expect(b).toBe(c);
  expect(a).toEqual({ marker: "browser-client" });
  expect(mockEvaluations).toBe(1);
});

it("retries after a failed load instead of caching the rejection", async () => {
  mockFailuresLeft = 1;
  const { getSupabase } = await import("../supabaseLoader");
  await expect(getSupabase()).rejects.toThrow("ChunkLoadError");
  await expect(getSupabase()).resolves.toEqual({ marker: "browser-client" });
  expect(mockEvaluations).toBe(2);
});

it("getSupabaseOrNull logs under the caller's label and returns null", async () => {
  mockFailuresLeft = 1;
  const { getSupabaseOrNull } = await import("../supabaseLoader");
  const { logCaughtError } = await import("../logger");
  await expect(getSupabaseOrNull("probe_label")).resolves.toBeNull();
  expect(logCaughtError).toHaveBeenCalledWith("probe_label", expect.any(Error));
});
```

(Jest re-runs a `jest.mock` factory that threw, because the mock registry only stores a module after the factory returns: `jest-runtime` `_requireMockWithId`. That is what makes the retry case expressible.)

### New: `frontend/app/lib/__tests__/supabaseLazyLoad.test.ts`

```ts
/**
 * WP12 (review F011): the modules that read public data do not load the
 * browser Supabase client until they query, and a failed load degrades the
 * same way a failed query does.
 */
import { DEFAULT_EXCHANGE_RATE } from "../marketData";

const mockRpc = jest.fn();
const mockFrom = jest.fn();
let mockEvaluations = 0;
let mockFailLoad = false;

jest.mock("../supabase", () => {
  mockEvaluations += 1;
  if (mockFailLoad) {
    throw new Error("ChunkLoadError: Loading chunk failed");
  }
  return {
    supabase: {
      rpc: (...args: unknown[]) => mockRpc(...args),
      from: (...args: unknown[]) => mockFrom(...args),
    },
  };
});

jest.mock("../logger", () => ({
  logCaughtError: jest.fn(),
  logSupabaseError: jest.fn(),
}));

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockEvaluations = 0;
  mockFailLoad = false;
});

afterEach(() => {
  jest.useRealTimers();
});

it.each([
  "../clientMarketData",
  "../exchangeRate",
  "../portfolio",
  "../../components/BoxCalculator/sharedRecipe",
])("importing %s does not load the client", async (modulePath) => {
  await import(modulePath);
  expect(mockEvaluations).toBe(0);
});

it("loads the client on the first query, once", async () => {
  const single = jest.fn().mockResolvedValue({
    data: { usd_to_cad: 1.4, recorded_at: "2026-09-01T00:00:00" },
    error: null,
  });
  mockFrom.mockReturnValue({
    select: () => ({ order: () => ({ limit: () => ({ single }) }) }),
  });
  mockRpc.mockResolvedValue({ data: [], error: null });

  const { fetchLatestExchangeRateClient } = await import("../exchangeRate");
  expect(mockEvaluations).toBe(0);
  await expect(fetchLatestExchangeRateClient()).resolves.toMatchObject({ rate: 1.4 });
  expect(mockEvaluations).toBe(1);

  const { fetchVolumeMetrics } = await import("../clientMarketData");
  await fetchVolumeMetrics();
  expect(mockRpc).toHaveBeenCalledWith("get_market_product_volume_metrics");
  expect(mockEvaluations).toBe(1);
});

describe("a failed load degrades exactly like a failed query", () => {
  beforeEach(() => {
    mockFailLoad = true;
  });

  it("never-throw readers return their fallback", async () => {
    const { fetchLatestExchangeRateClient } = await import("../exchangeRate");
    const {
      fetchVolumeMetrics,
      fetchSalesHistory,
      fetchNewestPricedAtClient,
    } = await import("../clientMarketData");
    const { getAllProducts, searchProducts } = await import("../portfolio");
    const { fetchSharedRecipe } = await import(
      "../../components/BoxCalculator/sharedRecipe"
    );

    await expect(fetchLatestExchangeRateClient()).resolves.toEqual({
      rate: DEFAULT_EXCHANGE_RATE,
      date: null,
    });
    await expect(fetchVolumeMetrics()).resolves.toEqual({});
    await expect(fetchSalesHistory(1, 30)).resolves.toEqual([]);
    const newest = await fetchNewestPricedAtClient([1]);
    expect(newest.size).toBe(0);
    await expect(getAllProducts()).resolves.toEqual([]);
    await expect(searchProducts("ev")).resolves.toEqual([]);
    await expect(
      fetchSharedRecipe("0123456789abcdef0123456789abcdef")
    ).resolves.toBeNull();

    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("fetchMarketProductsClient rejects, as it does on a query error", async () => {
    const { fetchMarketProductsClient } = await import("../clientMarketData");
    await expect(fetchMarketProductsClient()).rejects.toThrow(/ChunkLoadError/);
  });

  it("a queued price-history request is rejected, not left pending", async () => {
    jest.useFakeTimers();
    const { fetchProductHistoryClient } = await import("../clientMarketData");
    const pending = fetchProductHistoryClient(1, "3M");
    const settled = expect(pending).rejects.toThrow(/ChunkLoadError/);
    await jest.advanceTimersByTimeAsync(100);
    await settled;
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
```

The static `import { DEFAULT_EXCHANGE_RATE } from "../marketData"` also makes the file a module (see the `export {};` note above); `marketData.ts` does not import `./supabase`. `await import(modulePath)` with a variable compiles to `require(modulePath)` under next/jest and resolves relative to this test file.

If WP10 or WP11 changed one of these functions' failure contract, assert the contract the function now documents, and say so in the PR. WP20 later deletes the `fetchSalesHistory` line together with that function; that is expected.

### New: `frontend/app/components/ProductPrices/__tests__/ProductImage.ssr.test.tsx`

The server HTML is what the browser paints before hydration, so this is the test that proves F069.

```tsx
/** @jest-environment node */
import { renderToString } from "react-dom/server";
import ProductImage from "../shared/ProductImage";

const SRC = "https://abc.supabase.co/storage/v1/object/public/products/42.jpg";

function imgTag(html: string): string {
  const match = html.match(/<img[^>]*>/);
  if (!match) throw new Error(`no <img> in ${html}`);
  return match[0];
}

describe("ProductImage server markup (review F069)", () => {
  it("priority: visible, eager, high priority and preloaded", () => {
    const html = renderToString(
      <ProductImage imageUrl={SRC} productName="Hero" priority />
    );
    const img = imgTag(html);
    expect(html).toMatch(/<link[^>]*rel="preload"[^>]*as="image"/);
    expect(html).toContain(`href="${SRC}"`);
    expect(img).toMatch(/fetchpriority="high"/i);
    expect(img).not.toMatch(/loading="lazy"/);
    expect(img).toContain("opacity-100");
    expect(img).not.toContain("opacity-0");
    expect(html).not.toContain("Loading...");
  });

  it("default: lazy, hidden behind the pulse until onLoad, not preloaded", () => {
    const html = renderToString(<ProductImage imageUrl={SRC} productName="Card" />);
    const img = imgTag(html);
    expect(img).toContain('loading="lazy"');
    expect(img).toContain("opacity-0");
    expect(img).not.toMatch(/fetchpriority/i);
    expect(html).toContain("Loading...");
    expect(html).not.toMatch(/rel="preload"/);
  });

  it("preferThumbnail renders the _thumb.webp derivative", () => {
    const html = renderToString(
      <ProductImage imageUrl={SRC} productName="Sibling" preferThumbnail />
    );
    expect(imgTag(html)).toContain(
      'src="https://abc.supabase.co/storage/v1/object/public/products/42_thumb.webp"'
    );
  });
});
```

### New: `frontend/app/components/ProductPrices/__tests__/ProductImage.test.tsx` (jsdom)

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProductImage from "../shared/ProductImage";

const SRC = "https://abc.supabase.co/storage/v1/object/public/products/42.jpg";

describe("ProductImage in the browser (review F069)", () => {
  it("priority: never shows the placeholder and does not throw", () => {
    // next/image throws in non-production builds on preload + loading="lazy",
    // so this render also proves loading is unset for the priority image.
    render(<ProductImage imageUrl={SRC} productName="Hero" priority />);
    expect(screen.queryByText("Loading...")).toBeNull();
    expect(screen.getByAltText("Hero")).toHaveClass("opacity-100");
  });

  it("default: hidden behind the pulse until onLoad, then visible", async () => {
    render(<ProductImage imageUrl={SRC} productName="Card" />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.getByAltText("Card")).toHaveClass("opacity-0");
    fireEvent.load(screen.getByAltText("Card"));
    // next/image calls the user onLoad after a resolved promise.
    await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
    expect(screen.getByAltText("Card")).toHaveClass("opacity-100");
  });

  it("thumbnail falls back to the original, then to the placeholder", () => {
    render(<ProductImage imageUrl={SRC} productName="Sibling" preferThumbnail />);
    const thumb = screen.getByAltText("Sibling");
    expect(thumb.getAttribute("src")).toMatch(/42_thumb\.webp$/);
    fireEvent.error(thumb);
    const original = screen.getByAltText("Sibling");
    expect(original.getAttribute("src")).toMatch(/42\.jpg$/);
    fireEvent.error(original);
    expect(screen.getByText("No Image")).toBeInTheDocument();
  });
});
```

### Existing tests

No edits expected (step 5). The full `pnpm test --ci` must pass with the suite count increased by exactly 4.

## Verification

From `frontend/`:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit                    # exit 0

pnpm exec eslint eslint.config.mjs app/lib/supabaseLoader.ts app/lib/clientMarketData.ts \
  app/lib/exchangeRate.ts app/lib/portfolio.ts app/components/BoxCalculator/sharedRecipe.ts \
  app/components/ProductPrices/shared/ProductImage.tsx 'app/product/[id]/page.tsx' \
  app/lib/__tests__/supabaseLoader.test.ts app/lib/__tests__/supabaseLazyLoad.test.ts \
  app/components/ProductPrices/__tests__/ProductImage.ssr.test.tsx \
  app/components/ProductPrices/__tests__/ProductImage.test.tsx
# expect: 0 errors

pnpm run lint 2>&1 | tail -1
# expect: error count equal to the base branch (record both numbers in the PR)

# No static importer of the browser client remains. Expect no output.
grep -rn 'lib/supabase"\|from "\./supabase"\|from "\.\./supabase"' app --include=*.ts --include=*.tsx | grep -v __tests__
# Exactly one dynamic import, in the loader.
grep -rn 'import("./supabase")' app

# The guards fire. Expect 1 error (WP12 message).
mkdir -p app/components/wp12probe && printf 'import { supabase } from "../../lib/supabase";\nexport const p = supabase;\n' > app/components/wp12probe/probe.ts
pnpm exec eslint app/components/wp12probe/probe.ts; rm -rf app/components/wp12probe
# Expect 1 error (anon-client message): the loader is forbidden in portfolio code.
mkdir -p app/components/Portfolio/wp12probe && printf 'import { getSupabase } from "../../../lib/supabaseLoader";\nexport const p = getSupabase;\n' > app/components/Portfolio/wp12probe/probe.ts
pnpm exec eslint app/components/Portfolio/wp12probe/probe.ts; rm -rf app/components/Portfolio/wp12probe

pnpm test --ci app/lib/__tests__ app/components/ProductPrices app/components/BoxCalculator app/components/Portfolio app/context
pnpm test --ci                            # all suites pass; 4 more suites than the base branch

pnpm build:stub > /tmp/wp12-build-after.log 2>&1; echo "exit=$?"   # exit=0
```

Bundle analysis. This is the exact content of `/tmp/wp12-analyze.sh` (saved in "Before you start" and already run once on the baseline build). After the build above, run `bash /tmp/wp12-analyze.sh > /tmp/wp12-after.txt 2>&1; cat /tmp/wp12-after.txt`.

```bash
#!/usr/bin/env bash
cd "$(git rev-parse --show-toplevel)/frontend" || exit 1
# A. Where the supabase-js chunk is referenced.
SUPA=$(grep -l -e RealtimeClient -e GoTrueClient -e createBrowserClient .next/static/chunks/*.js | xargs -n1 basename | sort -u)
echo "supabase chunks: ${SUPA:-NONE FOUND}"
for c in $SUPA; do
  echo "== $c"
  echo "-- prerendered HTML:";           find .next/server/app -name '*.html' -exec grep -l "$c" {} +
  echo "-- page client manifests:";      grep -rl "$c" .next/server/app --include=page_client-reference-manifest.js
  echo "-- other static chunks (loader):"; grep -l "$c" .next/static/chunks/*.js | grep -v "$c"
done

# B. Initial JS per prerendered page.
node -e '
const fs=require("fs"),zlib=require("zlib"),path=require("path");
for (const page of ["index","privacy","stats","analytics","prices","market","compare","box-calculator","portfolio","account","auth/login"]) {
  const f=`.next/server/app/${page}.html`; if(!fs.existsSync(f)){console.log(page,"(no html)");continue;}
  const html=fs.readFileSync(f,"utf8");
  const srcs=[...new Set([...html.matchAll(/\/_next\/(static\/chunks\/[^"?]+\.js)/g)].map(m=>m[1]))];
  let raw=0,gz=0; for(const s of srcs){const b=fs.readFileSync(path.join(".next",s)); raw+=b.length; gz+=zlib.gzipSync(b,{level:9}).length;}
  console.log(page.padEnd(16), String(srcs.length).padStart(3), "scripts", (raw/1024).toFixed(1).padStart(7)+" kB raw", (gz/1024).toFixed(1).padStart(6)+" kB gzip");
}'
```

Expected:

- A: `SUPA` names at least one chunk (the library still exists, now as an async chunk). For each: no prerendered HTML, no `page_client-reference-manifest.js` (this covers `/product/[id]`, `/portfolio` and every dynamic page), and at least one other static chunk referencing it (the async loader). On the baseline build the same chunk was listed in the HTML of `/`, `/prices`, `/market`, `/compare`, `/box-calculator` and `/portfolio` and in their manifests. This is the same way the existing `next/dynamic` Recharts chunk is referenced today (chunks only, no HTML or manifest), which was checked on a local build while writing this spec.
- B: every page whose baseline HTML listed the supabase chunk drops by roughly the chunk's size (about 245 kB raw / 60 to 66 kB gzip, measured at 251,861 B raw in a recent build). Pages that did not list it at baseline (`/privacy`, `/stats`, `/analytics`, `/auth/login`, and `/account` after WP04) change by less than 2 kB. A page printed as `(no html)` is dynamic; for it, analysis A's manifest check is the evidence. Paste both before/after outputs into the PR.

Stop and report (do not merge) if, after the change, analysis A lists a prerendered HTML file or a `page_client-reference-manifest.js` for a supabase chunk. Before reporting, re-run check 2 and check 3 from "Before you start" and include their output: a remaining static importer (or a client module value-importing `@supabase/*`) is the usual cause. If `SUPA` prints `NONE FOUND` on both builds, the marker strings were minified away; report that instead of guessing a chunk.

Manual checks on the PR's Vercel preview (real data; skip to Owner actions if you cannot open the preview):

1. `/product/<id>` (open any product from `/prices`). View source: the `<head>` contains `<link rel="preload" as="image" href="https://<project>.supabase.co/storage/v1/object/public/products/<id>.<ext>" fetchPriority="high"/>`; the hero `<img>` has `fetchPriority="high"`, no `loading` attribute and class `... opacity-100`; there is no "Loading..." next to it. The sibling `<img>` tags have `src` ending `_thumb.webp` (or the original for a product with no derivative) and `loading="lazy"`.
2. Same page, DevTools Performance panel, "Fast 4G" and 4x CPU slowdown, reload with the recorder on: the LCP marker is the hero image and lands at about the time its network request finishes, before the main JS finishes evaluating. On production (before) it lands after hydration.
3. `/privacy`: DevTools Network, reload, then search (Ctrl+F in the Network panel) for `RealtimeClient`: no results.
4. `/prices`: same search finds one JS chunk; its Initiator column is another script (not the document) and it starts after `DOMContentLoaded`. Scroll the catalog: sparklines and prices load as before; toggle CAD/USD: the rate still applies.
5. `/box-calculator?share=<a valid code>` if you have one, and `/portfolio` product search while signed in: both still return results.

## Owner actions

No configuration, migration or environment change. Confirmation only:

1. If the executor could not open the Vercel preview, run manual checks 1 to 5 above on the preview and reply on the PR with the results.
2. One week after deploy, open Vercel Speed Insights for the project, filter the route `/product/[id]`, and compare LCP p75 with the week before. Expect a clear drop on mobile (the verifier estimated 1.5 to 2.5 s on mid-range phones). Also compare "Total Blocking Time" / INP on `/` and `/prices`: they should not regress.

## Acceptance criteria

- [ ] `app/lib/supabaseLoader.ts` exists, exports `getSupabase`, `getSupabaseOrNull` and `BrowserSupabaseClient`, and is the only file containing `import("./supabase")`.
- [ ] No non-test file under `app/` imports `lib/supabase` statically (the grep in Verification prints nothing).
- [ ] `clientMarketData.ts`, `exchangeRate.ts`, `portfolio.ts` and `sharedRecipe.ts` await the loader inside the function that queries, and none of their never-throw functions rejects when the load fails (`supabaseLazyLoad.test.ts` passes).
- [ ] ESLint reports an error for a new static import of `lib/supabase` anywhere in `app/` outside tests, and for any import of `lib/supabaseLoader` in `ANON_CLIENT_FORBIDDEN_FILES`.
- [ ] After `pnpm build:stub`, the chunk containing `RealtimeClient` is referenced by no `.html` file and no `page_client-reference-manifest.js` under `.next/server/app`.
- [ ] `ProductImage` accepts `priority`; with it, the server HTML has a preload link and `fetchpriority="high"`, no `loading="lazy"`, no `opacity-0` and no "Loading..." (`ProductImage.ssr.test.tsx` passes).
- [ ] `ProductImage` still passes `unoptimized` in every case.
- [ ] `app/product/[id]/page.tsx` passes `priority` to the hero only and `preferThumbnail` to the sibling grid.
- [ ] `pnpm exec tsc --noEmit` exits 0, `pnpm test --ci` passes, and the lint error count is not higher than the base branch.

## Rollback

`git revert -m 1 <merge-sha>` for the whole PR, or `git revert <sha>` of only one of the two commits (commit 1 is the lazy loader, commit 2 is the image change; they do not depend on each other). This needs the PR merged with a merge commit, not squashed; say so in the PR body. If it was squashed anyway, revert the squash commit and re-apply the half you want to keep. No migrations, environment variables or dashboard settings are involved, so a revert is a normal redeploy with no data impact. If only the ESLint guard causes trouble, revert just the step 4 edits in `eslint.config.mjs`.

## Commit and PR

Commit 1:

```text
perf(bundle): load supabase-js lazily on first public-data query

The browser Supabase client was imported statically by clientMarketData,
exchangeRate, portfolio and the shared-recipe module, so supabase-js
(~250 kB raw / ~66 kB gzip, incl. GoTrue and Realtime) sat on the initial
script list of /, /prices, /market, /compare, /box-calculator and
/portfolio. A memoised getSupabase() in lib/supabaseLoader now imports it
on first use; a failed load is retried and degrades like a failed query.
ESLint forbids new static imports of lib/supabase and keeps the loader out
of user-table code.

Review: F011, F013.
```

Commit 2:

```text
perf(images): preload the product hero and render it visible from SSR

ProductImage gains a priority prop that forwards next/image `preload`
(the non-deprecated form of `priority`) plus fetchPriority="high", drops
loading="lazy" for that image, and starts it visible instead of waiting
for hydration to run onLoad. The product page hero uses it; the sibling
grid now requests thumbnails. Images stay unoptimized (bd29639).

Review: F069.
```

PR title: `perf: lazy-load supabase-js and preload the product hero image (WP12)`

PR body summary: what was slow (supabase-js on the hydration path of 6 routes; the product hero hidden until hydration and lazy; siblings fetching originals), the loader design (one memo, retry on failure, `getSupabaseOrNull` for never-throw paths), the list of converted functions and the failure contract each keeps, the ESLint guards, the before/after tables from bundle analysis A and B, the lint error counts, the test output, the manual-check results or a note that the owner must run them, and out-of-scope follow-ups: a mid-size `_md.webp` scraper derivative for the hero, a preconnect to the Supabase storage origin, removing `images.remotePatterns`, a plain `<img>` instead of next/image, the unused `app/components/ExchangeRateService.ts`, and the remaining post-hydration fade-in on grid images.
