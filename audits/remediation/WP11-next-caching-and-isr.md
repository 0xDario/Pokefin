# WP11: Caching: scrape-triggered revalidation, ISR, server-fed tools

- **Findings covered**
  - F151 (low; full, cluster members F151, F123): every server cache revalidates hourly although prices change at most once per product per day, nothing ever calls `revalidateTag`, and production still issues 370 to 670 `get_market_product_summaries` calls a day (302 in one hour) despite the 1 hour cache. The "refreshed hourly" copy was already fixed by WP03; this package does the caching half. The re-verification put the waste at 4x the catalog's change rate (24 hourly refreshes against 6 scraper runs a day) and 24x a single product's, and confirmed that F123's "double lag" does not happen in Next 16.3.6: during ISR regeneration a stale `unstable_cache` entry is recomputed in the foreground (`unstable-cache.js:183-216`), which is what makes `revalidateTag(tag, "max")` in step 6 correct.
  - F147 (medium; full): `/product/[id]` is fully dynamic (no `revalidate`, no `generateStaticParams`), so every visit and every crawler hit is a serverless render that the CDN never caches.
  - F143 (full for `/compare` and `/box-calculator`): both tools call the heavy summaries RPC from each visitor's browser instead of receiving server-cached data like `/market`. The `/portfolio` page-load leg (pricing the holdings) was moved server-side by WP05 (`portfolioRepo` reads `getCachedMarketProductSummaries`) and is not touched here. Two user-triggered browser calls remain and are out of scope: the product search in the add-holding modal and the Collectr import matcher still reach `fetchMarketProductsClient` through `lib/portfolio.ts` (`applyFreshPricesToSearchResults`, `getAllProducts`), at most once per tab per hour thanks to its TTL cache. List them as a follow-up in the PR body (the F143 recommendation's `get_latest_prices(product_ids)` RPC would remove them; no package schedules it).
  - F146 (medium; partial, the verifier's "simplest low-risk fix"): the server fallback path (it runs only when `get_market_product_summaries` or `get_set_analytics` errors) fetches a year of price history oldest-first and truncates at 50k rows. At about 306 active products the surviving rows end roughly 200 days ago, so the 1D to 6M returns come out null and the 1Y return comes out as a wrong non-null number (measured from a months-old "latest" row); the set fallback's `returns365`, `vol90`, `drawdown365` and `trend90`/`trend365` are wrong the same way. This package orders the 367-day fetch newest first: afterwards 1D to 3M are correct, 6M and 1Y are null instead of wrong, and the set fallback's 365-day drawdown and trend describe only the surviving window (about five months). Not done here, and not scheduled by any package in the plan (both need a migration; WP11 adds none): a `get_latest_prices(p_product_ids bigint[] DEFAULT NULL)` RPC (`DISTINCT ON (product_id)` over `idx_price_history_product_recorded`) to replace the two "newest price per product" paging implementations (server `fetchNewestPricedAt`, which WP05's `fetchNewestPricedAtForProducts` reuses, and client `fetchNewestPricedAtClient`), and a per-product anchor RPC to replace the about 50 serial history pages the fallback still makes (the 14-day freshness pages run in parallel with them). List both as follow-ups in the PR, including this constraint for whoever writes the RPC: filter on `products.active` only when `p_product_ids` is NULL, never when ids are passed, or deactivated portfolio holdings lose their price.
  - F150 (low; full for the defect, partial for the call sites): the client exchange-rate cache never expires and pins the hard-coded 1.36 fallback into the tab forever after one failed read. Callers: `/portfolio`, `/compare` (public, not signed-in) and `/box-calculator` (through `useCurrencyConversion`). The Bank of Canada rate changes at most once per business day, so the harm is the pinned fallback, not drift. Fixed in `exchangeRate.ts` for every caller. `/compare` and `/box-calculator` also get the server-cached rate (steps 9 and 10). Known limit, state it in the PR: every consumer fetches once per mount, so the TTL takes effect on the next mount or client navigation; a page left open keeps the rate it mounted with in React state. Refreshing on `visibilitychange` would fix that but needs `useCurrencyConversion.ts`, which this package does not touch (WP17 owns its lint error; WP20's `CurrencyProvider` replaces these reads). `/portfolio` keeps its client read (now with the 1 hour TTL): it is a signed-in client page that WP04, WP05 and WP13 all edit, and turning it into a server wrapper is not worth one PostgREST read per tab per hour. Say so in the PR. (WP20 later closes this call site too: its `CurrencyProvider`, seeded by the root layout from `getCachedExchangeRate()`, replaces the `/portfolio` client read, which is why step 2e must keep `getCachedExchangeRate` non-throwing.)
  - F068 (full, as corrected by the verifier): `/prices` and `/market` serialise about 300 KB of product and volume JSON into the RSC payload, roughly a third of it fields no client component reads.
  - N04 (low; full, as narrowed by both verifiers; completeness review after the audit): `unstable_cache` stores error fallbacks as successful results. Two cases remain after the verifiers' corrections: (a) a failed `exchange_rates` read caches `DEFAULT_EXCHANGE_RATE` 1.36, and the client does not refetch because 1.36 is truthy; (b) a failed price-history or sales-history query caches an empty chart or empty sales history for that product. Steps 2c and 2e cover (a); step 4 covers (b): `fetchProductDetailRows` throws on a failed price-history query and on a failed sales-history query (except a missing table), so `unstable_cache` keeps the last good entry. The verifiers removed the volume-metrics and `/stats` claims (`useVolumeMetrics` already refetches in the browser; set analytics fall back before any empty result is cached). The `/stats` "migration" copy is WP15's (F103).
  - Track 2 (01-PRODUCT-DIRECTION.md §9 item 1; research/performance-excellence.md §8, item PX06): once this PR makes `/product/[id]` ISR, Next 16 prefetches every product `<Link>` that enters the viewport in full, up to 306 product pages per catalog scroll, each one a cold ISR render the first time. Step 13 adds `IntentLink` (prefetch only after an 80 ms hover, on focus and on pointerdown), uses it for every internal product link, and sets `prefetch={false}` on the footer links and the header's `/auth/*` links. It ships in this PR, not later, because this PR is what switches the viewport prefetch on.
- **Priority rationale**: the nested-cache bug found while scoping F151 is the main load generator on the database's heaviest RPC, and fixing it together with ISR and event-driven revalidation cuts that load by an order of magnitude while making pages fresher, not staler.
- **Effort**: M, about 12 to 15 hours including tests (step 13 adds about 3).
- **Depends on**: WP05 (portfolio route handlers call `getCachedMarketProductSummaries` server-side and add `fetchNewestPricedAtForProducts` to `serverMarketData.ts`), WP06 (rewrites `BoxCalculator.tsx`, adds `compareSetsNewestFirst` to `useBoosterBoxPrices.ts`), WP10 (bounded summaries and volume RPCs, so the fewer remaining calls are also cheap). Also relies on already-merged WP00 (`pnpm build:stub`), WP03 ("updated daily" copy), WP07 (`app/lib/format.ts`, `StalePriceNote` in `ProductCard.tsx`, deterministic dates in the compare page), WP08 (`prices/page.tsx` without `<Suspense>`) and WP09 (edits `clientMarketData.ts`, `MarketView.tsx` and `RecentlyReleased.tsx`, so their line numbers have moved).
- **Unblocks**: WP18 (splits the compare page; after this PR its client code lives in `app/compare/CompareDashboard.tsx`), WP20 (types and currency context build on `VolumeMetricsSummary` and the exchange-rate changes here), WP13 (its `loading.tsx` for `/product/[id]` no longer turns on per-card prefetch, because step 13 already made product links intent-only; its Pitfalls sentence about watching function invocations is superseded by step 13), WP30 (finds `app/components/IntentLink.tsx` in its soft check (a) and skips its own step 1). WP12 edits `exchangeRate.ts` and the tool pages too; rebase it on this PR if it has not merged yet.
- **Suggested branch name**: `remediation/wp11-next-caching-and-isr`
- **Risk level**: medium. It changes how long every public page and data cache lives; a mistake shows stale prices for up to a day. The daily backstop, the unit tests and the post-deploy checks bound that. Step 13 changes when product pages are prefetched; the pre-merge check in Owner actions step 2 confirms it. No migrations. Known limit: a wrapper fallback (the 1.36 rate, `{}` volume, the set-analytics JS fallback) is not stored in the Data Cache, but the ISR page rendered with it is, until the next scraper revalidation (at most about 4 hours while the scraper runs) or the daily backstop. The tool pages treat the rate fallback as "absent" and fetch in the browser; `useVolumeMetrics` does the same for `{}`.

## Why

Every market cache in `app/lib/serverMarketData.ts` revalidates on an hourly clock, but the scraper only runs every 4 hours and re-prices each product at most once per 23 hours, so most hourly refreshes recompute identical data, and pages can still lag a scrape by up to an hour. Worse, `getCachedProductDetail` calls `getCachedMarketProductSummaries` from inside its own `unstable_cache` callback, and Next.js bypasses the cache for a nested `unstable_cache` call, so every product-page cache miss (about 306 products, each expiring hourly, on a route that is fully dynamic) re-runs the summaries RPC; that matches the 302 calls production logged in one hour. `/compare` and `/box-calculator` additionally run the same RPC from each visitor's browser, adding about a second of spinner and a visible error whenever it hits the 3 s anon timeout, and the client exchange-rate cache can pin a stale or fallback rate for the life of a tab. After this PR the scraper tells the site when it has written data, every cache refreshes on that event with a daily backstop, product pages are ISR and served from the CDN, the two tools render with server-cached data, and `/prices` and `/market` ship about 20 KB less compressed payload. Making product pages ISR has one side effect this PR must also handle: Next 16 prefetches a static route in full when its `<Link>` scrolls into view, so without step 13 a scroll through `/prices` would fetch (and cold-render) up to 306 product pages that the visitor never opens.

## Before you start

Read these files fully first (paths relative to `frontend/` unless they start with the repo root). Every `file:line` in this spec is at the base commit of the plan, before WP05, WP06, WP07 and WP09 edited these files. In `serverMarketData.ts` everything from `guardedPrice` down sits about 30 lines lower after WP05 and WP07; `compare/page.tsx`, `BoxCalculator.tsx`, `MarketView.tsx` and `RecentlyReleased.tsx` have moved too. Locate every edit by the quoted code, never by the number alone.

- `app/lib/serverMarketData.ts` (926 lines at the base of this plan; WP05 and WP07 add about 30 lines). Key places: `fetchPriceHistoryPages` :81-128, `fetchNewestPricedAt` :141-167, `fetchSetAnalyticsFallback` :341-583 (the nested call is at :343), `fetchProductDetail` :600-732 (the nested call is at :603), `fetchLatestExchangeRate` :734-751, `fetchProductsWithFallbackReturns` :753-816, `fetchMarketProductSummaries` :818-827, `fetchVolumeMetrics` :835-853, `fetchSetAnalytics` :855-889, the five `unstable_cache` exports :891-926.
- `node_modules/next/dist/server/web/spec-extension/unstable-cache.js:114-160` (why nesting bypasses the cache: `case 'unstable-cache': isNestedUnstableCache = true` at :147, and the cache read is skipped when that flag is set at :160) and `:183-214` (a stale entry read during ISR regeneration is refreshed in the foreground, so a page regenerated after `revalidateTag(tag, "max")` gets fresh data).
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md` (Next 16 requires a second `profile` argument; single-argument form is deprecated).
- `app/lib/clientMarketData.ts` (433 lines), `app/lib/exchangeRate.ts` (50 lines), `app/components/ProductPrices/hooks/useVolumeMetrics.ts` (61 lines), `app/components/ProductPrices/hooks/useCurrencyConversion.ts` (81 lines).
- `app/product/[id]/page.tsx` (431 lines), `app/prices/page.tsx`, `app/market/page.tsx`, `app/box-calculator/page.tsx`, `app/compare/page.tsx` (1079 lines, `"use client"`; state :308-337, mount effect :339-382, `type MarketProduct` :16-23).
- `app/components/BoxCalculator/BoxCalculator.tsx` (signature and hook calls near the top of the default export), `app/components/BoxCalculator/hooks/useBoosterBoxPrices.ts`, `app/components/BoxCalculator/types.ts`, `app/components/BoxCalculator/__tests__/useBoosterBoxPrices.test.tsx`.
- `app/components/ProductPrices/types/index.ts` (`ProductVolumeMetrics` :24-34, `Product` :46-80), `app/components/ProductPrices/index.tsx` (props interface), `app/components/MarketView/MarketView.tsx` (:22-26 imports, props :103-106), `app/components/dashboard/RecentlyReleased.tsx` (:10-16).
- `app/lib/csrf.ts`, `app/lib/rateLimit.ts`, `proxy.ts` (matcher covers `/api/:path*`).
- For step 13: `app/components/ProductPrices/cards/ProductCard.tsx` (the five `<Link` elements whose `href` is `` `/product/${product.id}` ``), `app/page.tsx` (`MoverCard`, the home-page strip), the siblings section of `app/product/[id]/page.tsx` (`{siblings.map((sib) => (`), `app/components/Footer.tsx`, `app/components/Header.tsx` (four links to `/auth/login` and `/auth/signup`: two in the desktop bar, two in the mobile menu), `next.config.ts`, `node_modules/next/dist/client/app-dir/link.js:108-110` (`prefetch={false}` sets the intent to `'none'`, so Next's own hover prefetch is off too; that is why `IntentLink` calls `router.prefetch` itself) and `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/staleTimes.md`.
- `app/lib/__tests__/serverMarketData.freshness.test.ts`, `app/lib/__tests__/clientMarketData.cache.test.ts` (mocking patterns to copy).
- Repo root: `main.py` (`fetch_and_store_exchange_rate` :961-1022, `update_prices` :1055-1306, the `__main__` block :1490-1558), `run_scraper.sh`, `README.md` :100-140, `tests/test_main.py` (header :14-22 shows how `main` is imported).

Confirm the starting state (run from `frontend/`):

```bash
git log --oneline -25        # WP05, WP06, WP10 merged (and WP03, WP07, WP08)
grep -n "revalidate: 3600" app/lib/serverMarketData.ts
# expect 5 lines (the five unstable_cache options)
grep -n "await getCachedMarketProductSummaries()" app/lib/serverMarketData.ts
# expect 2: inside fetchSetAnalyticsFallback and fetchProductDetail. Both run
# inside an unstable_cache callback: this is the nested-cache bug.
grep -rn "revalidateTag\|revalidatePath" app
# expect no output
grep -nE "revalidate|generateStaticParams|dynamic" "app/product/[id]/page.tsx"
# expect no output
head -1 app/compare/page.tsx                 # expect "use client";
grep -n "cachedAt" app/lib/exchangeRate.ts   # expect no output (no TTL)
grep -n 'order("recorded_at", { ascending: true })' app/lib/serverMarketData.ts
# expect 2: fetchPriceHistoryPages and the product-detail history query
grep -n "fetchNewestPricedAtForProducts" app/lib/serverMarketData.ts    # WP05 landed: 1+ match
grep -n "compareSetsNewestFirst" app/components/BoxCalculator/hooks/useBoosterBoxPrices.ts   # WP06 landed: 1+ match
grep -n "toLocaleDateString" app/compare/page.tsx    # WP07 landed: expect no output
grep -n "StalePriceNote" app/components/ProductPrices/cards/ProductCard.tsx   # WP07 landed: 1+ match
grep -n "Suspense" app/prices/page.tsx               # WP08 landed: expect no output
grep -rn "refreshed hourly" app                      # WP03 landed: expect no output
ls app/components/IntentLink.tsx                     # expect: No such file or directory
grep -rn 'href={`/product/' app --include=*.tsx | grep -v __tests__
# expect: ProductCard.tsx (5 lines), app/page.tsx (1, MoverCard) and
# app/product/[id]/page.tsx (1, siblings). Any other hit (for example a /market
# row or a portfolio holding that an earlier package turned into an internal
# product link) is switched in step 13 too. At the base the /market row links
# out to TCGplayer with a plain <a> and portfolio holdings are not links.
grep -n "staleTimes" next.config.ts                  # expect no output
```

If `compareSetsNewestFirst` is missing, WP06 has not landed: stop, this PR depends on it. If `toLocaleDateString` is still in `app/compare/page.tsx`, WP07 has not landed: stop, because server-rendering the compare page with a viewer-timezone date would cause a hydration mismatch. If `fetchNewestPricedAtForProducts` is missing, WP05 has not landed: stop.

Record the baseline lint count for the files this PR touches (you compare against it in Verification):

```bash
pnpm exec eslint app/lib/serverMarketData.ts app/lib/exchangeRate.ts app/lib/clientMarketData.ts \
  "app/product/[id]/page.tsx" app/compare app/box-calculator app/components/BoxCalculator \
  app/prices/page.tsx app/market/page.tsx app/components/ProductPrices/types/index.ts \
  app/components/ProductPrices/hooks/useVolumeMetrics.ts app/components/ProductPrices/index.tsx \
  app/components/MarketView/MarketView.tsx app/components/dashboard/RecentlyReleased.tsx \
  app/components/ProductPrices/cards/ProductCard.tsx app/page.tsx app/components/Footer.tsx \
  app/components/Header.tsx next.config.ts 2>&1 | tail -2
```

Python side: tests that import `main` need the scraper's dependencies (`pip install -r requirements.txt` in a virtualenv). In an environment where `import supabase` fails, only `tests/test_revalidate_hook.py` can run; say so in the PR.

### What the investigation found (context for step 2 to step 4)

- The code-controlled cause of hundreds of summaries RPC calls per hour is the nested cache. `fetchProductDetail` (the callback of `getCachedProductDetail`, `serverMarketData.ts:919-926`) calls `getCachedMarketProductSummaries()` at :603. Inside an `unstable_cache` callback the work unit type is `'unstable-cache'`, so the inner call never reads the cache and always runs `get_market_product_summaries` (`unstable-cache.js:147,160`). The product route is dynamic, each of about 306 product-detail entries expires hourly, and crawlers walk all of them: up to one RPC per product per hour, which matches the 302 calls logged in a single hour. `fetchSetAnalyticsFallback` (:343) has the same pattern on the set-analytics error path.
- Per-region Data Cache is not something the code controls. Vercel functions run in one region unless configured otherwise; the owner check in Owner actions confirms that.
- Once revalidation is event-driven, a failed read must not be cached for a day. Today `fetchLatestExchangeRate` returns the 1.36 fallback and `fetchVolumeMetrics` returns `{}` on error, and `unstable_cache` stores those as successes. With a 24 hour backstop that would pin a wrong rate or blank volume chips until the next scrape. Steps 2 to 4 move the fallback outside the cache: the cached function throws (Next does not store a rejected result) and a thin wrapper degrades.

## Implementation steps

Steps 1 to 6 are the server caching core and must be done in order. Steps 7 to 11 are independent of each other but need step 1 and step 2. Step 12 (Python) is independent of the frontend. Step 13 (intent-only prefetch) touches no file of steps 1 to 12 except `app/product/[id]/page.tsx` (step 7 edits the top, step 13 the siblings list); it must ship in the same PR as step 7.

### Step 1. `frontend/app/lib/cacheTags.ts` (new)

One definition of the tag names, shared by `serverMarketData.ts` and the revalidate route. No `import "server-only"`, so the route test can import it without mocks.

```ts
/**
 * Cache tags carried by the market-data caches in serverMarketData.ts.
 *
 * app/api/revalidate/route.ts expires exactly these after each scraper run,
 * so a cache that is not tagged here is never refreshed by the scraper hook
 * and waits for the daily backstop instead.
 */
export const CACHE_TAGS = {
  exchangeRate: "exchange-rate",
  marketProducts: "market-products",
  setAnalytics: "set-analytics",
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

/** Every tag a scraper run can make stale: prices, volume, listings and the rate. */
export const SCRAPE_REVALIDATED_TAGS: readonly CacheTag[] = [
  CACHE_TAGS.marketProducts,
  CACHE_TAGS.setAnalytics,
  CACHE_TAGS.exchangeRate,
];
```

### Step 2. `frontend/app/lib/serverMarketData.ts`: daily backstop, no cached failures

2a. Imports. Keep `import "server-only";` first. Add `import { cache } from "react";` directly below it. Add `import { CACHE_TAGS } from "./cacheTags";` below the `./logger` import.

2b. Directly below `const DAY_MS = 24 * 60 * 60 * 1000;` (line 51) add:

```ts
/**
 * How long any market cache may be served without a refresh. The scraper
 * (main.py) calls POST /api/revalidate after every run that wrote data, which
 * marks these tags stale within seconds; this is only the backstop for a run
 * that never reported (scraper host down, hook misconfigured). One day, not an
 * hour: a product is re-priced at most once per 23 hours (main.py:1082), so an
 * hourly clock re-ran the heaviest RPCs many times a day for identical output
 * (review F151, F123).
 *
 * The backstop also bounds values computed from the clock, not the data: the
 * 14-day price-freshness cutoff the RPC applies at call time, and day counts
 * such as "days since release". If the scraper stops, a price can stay on a
 * page up to one day past its cutoff. Never raise this above a day, and never
 * replace it with `revalidate: false`.
 *
 * It is also the ISR period of every page that reads these caches, because
 * Next takes the lowest revalidate it sees during a render.
 */
const DAILY_BACKSTOP_SECONDS = 24 * 60 * 60;

/*
 * Never call one of the cached functions at the bottom of this file from
 * inside the callback of another. Next.js skips the cache for a nested
 * unstable_cache call and always runs the callback
 * (node_modules/next/dist/server/web/spec-extension/unstable-cache.js:147,160).
 * fetchProductDetail used to call getCachedMarketProductSummaries from inside
 * getCachedProductDetail, so every product-page cache miss re-ran
 * get_market_product_summaries: about 300 extra RPC calls an hour in
 * production (review F143, F151). Compose cached reads in plain async
 * functions instead, as getCachedProductDetail and getCachedSetAnalytics do.
 *
 * A function passed to unstable_cache throws on a failed read rather than
 * returning a fallback: Next does not store a rejected result, and the
 * exported wrapper degrades. A fallback returned from inside the cache would
 * be served for up to DAILY_BACKSTOP_SECONDS.
 */
```

2c. Replace `fetchLatestExchangeRate` (:734-751) with a version that throws, and validates the value (the WP00 stub and a malformed row must not produce `rate: undefined`):

```ts
async function fetchLatestExchangeRate(): Promise<ExchangeRateSnapshot> {
  const supabase = createMarketDataSupabaseClient();
  const { data, error } = await supabase
    .from("exchange_rates")
    .select("usd_to_cad, recorded_at")
    .order("recorded_at", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    throw error;
  }
  const rate = data?.usd_to_cad;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("exchange_rates returned no usable usd_to_cad");
  }

  return {
    rate,
    date: data.recorded_at ?? null,
  };
}
```

2d. In `fetchVolumeMetrics` (:835-853) replace the error branch

```ts
  if (error) {
    logSupabaseError("server_volume_metrics_failed", error);
    return {};
  }
```

with

```ts
  if (error) {
    // Thrown, not degraded here: see the comment above DAILY_BACKSTOP_SECONDS.
    // getCachedVolumeMetrics logs it and returns {}.
    throw error;
  }
```

and update its doc comment's last sentence to: `Errors, including the RPC not existing yet, reject; getCachedVolumeMetrics degrades them to an empty record without caching it.`

2e. Replace the whole block of cached exports (:891-926) with the block below. Step 3 and step 4 define `fetchSetAnalyticsFromRpc`, `fetchSetAnalyticsFallback(products)`, `fetchProductDetailRows` and `loadProductDetail`, which this block references; write steps 2e, 3 and 4 together before type-checking.

```ts
const getCachedExchangeRateSnapshot = unstable_cache(
  fetchLatestExchangeRate,
  ["exchange-rate"],
  {
    revalidate: DAILY_BACKSTOP_SECONDS,
    tags: [CACHE_TAGS.exchangeRate],
  }
);

/**
 * Latest USD to CAD rate. On a failed read returns the hard-coded fallback
 * with `date: null`, uncached, so the next render retries. Callers treat
 * `date === null` as "this is the fallback, not a real rate".
 */
export async function getCachedExchangeRate(): Promise<ExchangeRateSnapshot> {
  try {
    return await getCachedExchangeRateSnapshot();
  } catch (error) {
    logCaughtError("server_exchange_rate_failed", error);
    return { rate: DEFAULT_EXCHANGE_RATE, date: null };
  }
}

export const getCachedMarketProductSummaries = unstable_cache(
  fetchMarketProductSummaries,
  ["market-product-summaries"],
  {
    revalidate: DAILY_BACKSTOP_SECONDS,
    tags: [CACHE_TAGS.marketProducts],
  }
);

const getCachedVolumeMetricsRecord = unstable_cache(
  fetchVolumeMetrics,
  ["market-volume-metrics"],
  {
    revalidate: DAILY_BACKSTOP_SECONDS,
    tags: [CACHE_TAGS.marketProducts],
  }
);

/** Volume metrics keyed by product_id; {} (uncached) when the RPC fails. */
export async function getCachedVolumeMetrics(): Promise<
  Record<number, ProductVolumeMetrics>
> {
  try {
    return await getCachedVolumeMetricsRecord();
  } catch (error) {
    logCaughtError("server_volume_metrics_failed", error);
    return {};
  }
}

const getCachedSetAnalyticsFromRpc = unstable_cache(
  fetchSetAnalyticsFromRpc,
  ["set-analytics"],
  {
    revalidate: DAILY_BACKSTOP_SECONDS,
    tags: [CACHE_TAGS.setAnalytics],
  }
);

/**
 * Set analytics from the RPC; on an RPC error, the JS fallback computed from
 * the cached summaries. The fallback runs here, outside any unstable_cache
 * callback, so its getCachedMarketProductSummaries read is a real cache read
 * (see the comment above DAILY_BACKSTOP_SECONDS). It is not cached itself:
 * it only runs while the RPC is failing, and then only when /stats or
 * /analytics regenerates.
 */
export async function getCachedSetAnalytics(): Promise<SetAnalyticsRow[]> {
  try {
    return await getCachedSetAnalyticsFromRpc();
  } catch (error) {
    logCaughtError("server_set_analytics_failed", error);
    return fetchSetAnalyticsFallback(await getCachedMarketProductSummaries());
  }
}

const getCachedProductDetailRows = unstable_cache(
  fetchProductDetailRows,
  // A new key, not "product-detail": the cached value's shape changed, and
  // entries written by the previous code must never be read as rows.
  ["product-detail-rows"],
  {
    revalidate: DAILY_BACKSTOP_SECONDS,
    tags: [CACHE_TAGS.marketProducts],
  }
);

/**
 * Everything /product/[id] renders. Composes two cached reads (the catalog
 * summaries and this product's own rows) in a plain function, never one
 * inside the other. React's cache() dedupes the generateMetadata and page
 * calls within one render; across renders the page itself is ISR.
 */
export const getCachedProductDetail = cache(loadProductDetail);
```

`getCachedProductDetail` needs `getCachedProductDetailRows`, which is declared just above it; `loadProductDetail` (step 4) references `getCachedProductDetailRows` and `getCachedMarketProductSummaries` only when called, so function-declaration hoisting makes the order safe. Keep `loadProductDetail`, `fetchProductDetailRows` and `fetchSetAnalyticsFromRpc` as `async function` declarations (not `const` arrows) so they are hoisted.

### Step 3. `serverMarketData.ts`: set analytics without the nested call

3a. `fetchSetAnalyticsFallback` (:341-354). Change the signature and drop the nested read:

```ts
async function fetchSetAnalyticsFallback(
  products: Product[]
): Promise<SetAnalyticsRow[]> {
  if (products.length === 0) return [];
  const supabase = createMarketDataSupabaseClient();
```

Delete the old lines `const supabase = createMarketDataSupabaseClient();` and `const products = await getCachedMarketProductSummaries();` and `if (products.length === 0) return [];` (:342-344). The rest of the function body is unchanged except step 5b.

3b. Replace `fetchSetAnalytics` (:855-889) with `fetchSetAnalyticsFromRpc`, identical except for the name, the doc comment and the error branch:

```ts
/** get_set_analytics mapped to SetAnalyticsRow. Rejects on error (not cached). */
async function fetchSetAnalyticsFromRpc(): Promise<SetAnalyticsRow[]> {
  const supabase = createMarketDataSupabaseClient();
  const { data, error } = await supabase.rpc("get_set_analytics");

  if (error) {
    throw error;
  }

  return ((data || []) as any[]).map((row) => ({
    // ... the existing 23-field mapping (:865-887), unchanged ...
  }));
}
```

Copy the mapping object literally from the current `fetchSetAnalytics`; do not retype it.

### Step 4. `serverMarketData.ts`: product detail without the nested call

Replace `fetchProductDetail` (:600-732) with two functions. The `ProductListingsSnapshot` and `ProductDetail` types above it (:585-598) stay.

```ts
type ProductDetailRows = {
  history: PriceHistoryEntry[];
  salesHistory: SalesHistoryEntry[];
  listings: ProductListingsSnapshot | null;
};

/**
 * The per-product queries behind /product/[id], cached per product id.
 * Deliberately does NOT read the market summaries: this runs inside
 * unstable_cache, where a nested cached read is never served from cache.
 * Rejects when the price-history or sales-history query fails so the failure
 * is not cached and unstable_cache keeps serving the last good entry (N04).
 * A missing sales table (42P01, PGRST205) and any listings failure still
 * degrade to empty (those tables may not exist before their migrations).
 */
async function fetchProductDetailRows(
  productId: number
): Promise<ProductDetailRows> {
  const supabase = createMarketDataSupabaseClient();
  // MOVE BLOCK A here unchanged (see the list below this code).

  if (error) {
    throw error;
  }
  // N04: a transient sales failure (timeout, 5xx) must not be cached as an
  // empty sales history. Only a table that does not exist yet degrades.
  if (salesError && salesError.code !== "42P01" && salesError.code !== "PGRST205") {
    throw salesError;
  }

  const history = groupHistoryRowsByProduct(historyRows || [])[productId] || [];

  // MOVE BLOCK B here unchanged.

  return { history, salesHistory, listings };
}

async function loadProductDetail(
  productId: number
): Promise<ProductDetail | null> {
  const allProducts = await getCachedMarketProductSummaries();
  const summary = allProducts.find((p) => p.id === productId);
  if (!summary) return null;

  let rows: ProductDetailRows;
  try {
    rows = await getCachedProductDetailRows(productId);
  } catch (error) {
    // Same outcome the page had before for a failed history query: it renders
    // without history. Not cached, so the next regeneration retries.
    logCaughtError("server_product_history_failed", error);
    rows = { history: [], salesHistory: [], listings: null };
  }
  const { history, salesHistory, listings } = rows;

  // MOVE BLOCK C here, with its "Deliberately NOT compared" comment replaced
  // by the text given below.

  // MOVE BLOCK D here unchanged.
}
```

The four blocks, all taken from the current `fetchProductDetail` body (base line numbers in brackets, find them by the quoted first and last lines):

- **Block A** [608-648]: from `const startDate = new Date();` through the `]);` that closes the `Promise.all` of the three queries (`product_price_history`, `product_sales_history`, `product_listings_history`). It declares `historyRows`, `error`, `salesRows`, `salesError`, `listingsRows`, `listingsError`.
- **Block B** [696-717]: from `let salesHistory: SalesHistoryEntry[] = [];` through the closing `}` of the `if (listingsError) { ... } else { ... }` block, including both `logSupabaseError` calls.
- **Block C** [656-694]: from the comment line `// This page has the product's own price history in hand, so it decides` through the `};` that closes `const product: Product = { ... };`.
- **Block D** [719-731]: from `// Siblings share the same set.` through `return { product, history, salesHistory, listings, siblings };`.

After the move, the old `if (error) { logSupabaseError("server_product_history_failed", error); }` block and the old `fetchProductDetail` function are gone; nothing else from its body is left behind.

Inside block C, replace the comment block that starts `// Deliberately NOT compared against the newest history row's VALUE here,` and ends `// and a price an hour old is well inside a 14-day tolerance.` (base :666-679; it says the summary is cached for an hour while the history is queried live) with:

```ts
  // Deliberately NOT compared against the newest history row's VALUE here,
  // though the SQL and the fallbacks both do that. `summary` and `history`
  // come from two different cache entries. Both carry the market-products tag
  // and are refreshed together by the scraper hook, but the daily backstop can
  // expire one before the other, so for a while after a scrape the summary may
  // lag the history. Comparing them would then withhold the price AND every
  // return for a healthy product until the next refresh.
  //
  // The check belongs where both values are read in one snapshot, which is
  // migration 0023: post-0023 the RPC has already made it. The timestamp check
  // below is safe across the skew: a fresher recorded_at only makes it more
  // permissive, and a price a few hours old is well inside a 14-day tolerance.
```

The history error log label changes from `logSupabaseError("server_product_history_failed", error)` to the `logCaughtError` in `loadProductDetail`. Keep the label string. A thrown sales error is logged under the same label by the same `catch`; block B's own `logSupabaseError("server_product_sales_history_failed", salesError)` branch stays and now runs only for a missing table.

### Step 5. `serverMarketData.ts`: fallback history newest first (F146)

5a. `fetchPriceHistoryPages` (:81-128). Add an options parameter and use it for both `order` calls:

```ts
async function fetchPriceHistoryPages(
  supabase: MarketDataSupabaseClient,
  productIds: number[],
  startDateStr: string,
  { newestFirst = false }: { newestFirst?: boolean } = {}
): Promise<PriceHistoryRow[]> {
```

```ts
      .order("recorded_at", { ascending: !newestFirst })
      // ... keep the existing tiebreaker comment ...
      .order("id", { ascending: !newestFirst })
```

Replace its doc comment (:70-80) with:

```ts
/**
 * Page through product_price_history for a set of products.
 *
 * The cap is a real ceiling: a full year across every active product is well
 * over 100k rows (one row per product per day). The 367-day callers pass
 * newestFirst so the rows that survive the cap are the most recent ones
 * (about five months at ~306 active products): the 1D to 3M returns stay
 * correct and 6M and 1Y come back null, because getReturnPercent finds no
 * row old enough. Ordered oldest-first, the survivors ended about 200 days
 * ago: 1D to 6M were null and 1Y was a wrong non-null number measured from
 * that months-old "latest" row (review F146). The set fallback's 365-day
 * drawdown and trend still cover only the surviving window. Truncation is
 * logged. groupHistoryRowsByProduct re-sorts each product ascending, so
 * callers see the same order either way.
 */
```

5b. Pass the option in the two 367-day callers:
- `fetchSetAnalyticsFallback`: `fetchPriceHistoryPages(supabase, productIds, startDateStr, { newestFirst: true }),`
- `fetchProductsWithFallbackReturns` (:779-782): same change.

Do not pass it in `fetchNewestPricedAt` (a 14-day window that is always complete).

5c. Update the three comments that still say the long fetch is "ordered oldest-first":
- `fetchNewestPricedAt` doc (:134-139): replace the paragraph starting "Its own query rather than a max()" with: `Its own query rather than a max() over the paged history above, because that fetch is page-capped: it can end before the newest row of a product, and reading its truncation as staleness would blank prices across the site. This window is only PRICE_STALENESS_TOLERANCE_DAYS wide, so it is a few thousand rows and always complete.`
- In `fetchSetAnalyticsFallback` (:436-441) and `fetchProductsWithFallbackReturns` (:787-791): replace "that fetch is ordered oldest-first and the page cap truncates it" (or the equivalent wording) with "that fetch is page-capped".

Do not make `fetchMarketProductSummaries` throw instead of falling back (see Pitfalls).

### Step 6. `frontend/app/api/revalidate/route.ts` (new)

```ts
/**
 * POST /api/revalidate
 *
 * Called by the scraper (revalidate_hook.py, from main.py) after a run that
 * wrote prices or an exchange rate. Marks every market-data cache tag stale so
 * the next visit to each page regenerates it with fresh data, instead of
 * waiting for the daily backstop in serverMarketData.ts.
 *
 * Authenticated by a shared secret header, not by cookies, so the cookie CSRF
 * gate in lib/csrf.ts does not apply: no browser holds an ambient credential
 * for this route, and the scraper sends no Origin header. proxy.ts still
 * rate-limits it with the other /api/* routes.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { SCRAPE_REVALIDATED_TAGS } from "../../lib/cacheTags";

const SECRET_HEADER = "x-revalidate-secret";
const MIN_SECRET_LENGTH = 32;
const NO_STORE = { "Cache-Control": "no-store" };

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time: both sides are hashed to 32 bytes before comparing. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  return timingSafeEqual(sha256(provided), sha256(expected));
}

export async function POST(req: NextRequest) {
  // Read per request, not at module load, so a rotated secret and the tests
  // both take effect without a reload.
  const expected = process.env.REVALIDATE_SECRET ?? "";
  if (expected.length < MIN_SECRET_LENGTH) {
    // Fail closed: an unset or short secret never means "anyone may purge".
    return NextResponse.json(
      { error: "Revalidation is not configured" },
      { status: 503, headers: NO_STORE }
    );
  }

  if (!secretMatches(req.headers.get(SECRET_HEADER), expected)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE }
    );
  }

  for (const tag of SCRAPE_REVALIDATED_TAGS) {
    // "max": stale-while-revalidate. The next visitor to each page gets the
    // current page instantly and triggers a background regeneration; during
    // that regeneration the stale data caches are refreshed in the foreground
    // (unstable-cache.js:207-214), so the regenerated page has the new prices.
    revalidateTag(tag, "max");
  }

  return NextResponse.json(
    { revalidated: SCRAPE_REVALIDATED_TAGS, at: new Date().toISOString() },
    { headers: NO_STORE }
  );
}
```

No other method is exported, so Next answers 405 for GET. Do not change `proxy.ts` or `rateLimit.ts`: `/api/revalidate` falls in the per-IP "general" bucket (60 per minute), which the scraper's one call per run never approaches, and the proxy's `supabase.auth.getUser()` makes no network call when the request has no session cookie.

### Step 7. `frontend/app/product/[id]/page.tsx`: ISR (F147)

Insert directly after the last import (`import ProductDetailChart from "./ProductDetailChart";`, line 27):

```ts
// ISR (review F147). Each product page is rendered on its first request, then
// served from the CDN until the "market-products" tag is marked stale: by the
// scraper hook (POST /api/revalidate) after each run, or by this daily
// backstop. Must stay a number literal: Next reads segment config statically.
export const revalidate = 86400;

// Empty on purpose: nothing is prerendered at build time, so `next build`
// makes no Supabase calls for this route. dynamicParams defaults to true, so
// any product id is rendered on its first visit and then cached like a
// prerendered page.
export async function generateStaticParams(): Promise<Array<{ id: string }>> {
  return [];
}
```

Nothing else in the file changes in this step (step 13 edits the siblings list). `generateMetadata` (:125-147) and the page (:149-159) keep calling `getCachedProductDetail`; React `cache()` makes that one read per render, which is what the old `unstable_cache` wrapper on `fetchProductDetail` did for these two calls (the F147 re-verification's "keep the wrapper" point is met by `cache()` plus the two cached reads in step 4, see Pitfalls). Do not add `dynamic`, `dynamicParams` or `fetchCache` exports.

Two side effects to accept and state in the PR:
- An unknown id (`/product/999999`) renders `notFound()`, and that 404 is cached like any ISR page. `loadProductDetail` read the `market-products`-tagged summaries before returning null, so the scraper hook's revalidation also refreshes it; a product added to the catalog becomes visible after the scrape that prices it.
- Values computed from today's date (`daysSinceRelease` and the price per day derived from it, via `utcMidnightMs()` near `page.tsx:173`) are frozen at render time. After UTC midnight they can read one day low until the page regenerates: normally within about 4 hours (the next scrape that writes data), at most one day (the backstop). `/`, `/prices` and `/market` already behave this way as ISR pages.

### Step 8. Client caches (F150 and two stale comments)

8a. Replace `frontend/app/lib/exchangeRate.ts` entirely:

```ts
"use client";

import { DEFAULT_EXCHANGE_RATE, ExchangeRateSnapshot } from "./marketData";
import { supabase } from "./supabase";
import { logCaughtError } from "./logger";

/**
 * How long a fetched rate may be reused. Same clock as CLIENT_CACHE_TTL_MS in
 * clientMarketData.ts (review F150). Callers fetch once per mount, so a
 * long-lived tab picks up a newer rate on its next mount or client
 * navigation, not while a page stays open.
 */
export const EXCHANGE_RATE_TTL_MS = 60 * 60 * 1000;

let exchangeRateCache: ExchangeRateSnapshot | null = null;
let exchangeRateCachedAt = 0;
let exchangeRatePromise: Promise<ExchangeRateSnapshot> | null = null;

export async function fetchLatestExchangeRateClient(): Promise<ExchangeRateSnapshot> {
  if (
    exchangeRateCache &&
    Date.now() - exchangeRateCachedAt < EXCHANGE_RATE_TTL_MS
  ) {
    return exchangeRateCache;
  }

  if (exchangeRatePromise) {
    return exchangeRatePromise;
  }

  const request = (async (): Promise<ExchangeRateSnapshot> => {
    try {
      const { data, error } = await supabase
        .from("exchange_rates")
        .select("usd_to_cad, recorded_at")
        .order("recorded_at", { ascending: false })
        .limit(1)
        .single();

      if (error || !data) {
        throw error ?? new Error("No exchange rate data found.");
      }
      const rate = data.usd_to_cad;
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
        throw new Error("exchange_rates returned no usable usd_to_cad");
      }

      const snapshot: ExchangeRateSnapshot = {
        rate,
        date: data.recorded_at ?? null,
      };
      exchangeRateCache = snapshot;
      exchangeRateCachedAt = Date.now();
      return snapshot;
    } catch (error) {
      logCaughtError("client_exchange_rate_failed", error);
      // Never cached: one transient failure must not pin the hard-coded rate
      // into the tab. An expired real rate beats the constant, so prefer it.
      // No negative cache either: the next mount retries, which costs one
      // single-row query.
      return exchangeRateCache ?? { rate: DEFAULT_EXCHANGE_RATE, date: null };
    }
  })();

  // Cleared here, not in a finally inside the IIFE: if the query threw
  // synchronously, that finally would run before this assignment and leave a
  // settled promise in exchangeRatePromise for the life of the tab.
  exchangeRatePromise = request;
  try {
    return await request;
  } finally {
    if (exchangeRatePromise === request) {
      exchangeRatePromise = null;
    }
  }
}
```

8b. `frontend/app/lib/clientMarketData.ts` doc comment of `MARKET_PRODUCTS_TTL_MS` (:23-35): replace the last sentence ("An hour matches the server-side getCachedMarketProductSummaries revalidate, so both halves of the app age their view of the catalog at the same rate.") with: `An hour is well inside the scraper's 4-hour cadence, so a long-lived tab picks up each scrape within the hour; the server side refreshes on the scraper's revalidate hook (serverMarketData.ts).` Do not change any value in this file.

8c. `frontend/app/components/ProductPrices/hooks/useVolumeMetrics.ts`: the comment inside the hook (:25-28) says "unstable_cache stores that for an hour". Replace those four comment lines with: `// Gate on content, not existence: getCachedVolumeMetrics returns {} when the RPC fails, and the page rendered with it keeps that {} until it regenerates. Treating {} as "data supplied" would suppress the client fetch and leave every volume surface blank with no retry path.` Wrap it at the file's usual width, one `//` per line. In the comment above the final `return` (base :55-58), the words `a navigation that crosses the hourly` / `server-cache boundary` span two lines; replace them with `a navigation after the server cache refreshed` and re-wrap those two comment lines. (Step 11 changes this file's types too.)

### Step 9. `/compare` server-fed (F143)

9a. New `frontend/app/compare/marketProducts.ts` (no `"use client"`: both the server page and the client component import it):

```ts
import type { Product } from "../components/ProductPrices/types";

/** The market fields the Seller Tools tables read, per sku. */
export type MarketProduct = {
  sku: string;
  marketPriceUsd: number | null;
  setName?: string | null;
  releaseDate?: string | null;
  productType?: string | null;
  lastUpdated?: string | null;
};

/**
 * sku to market fields. Built on the server for the initial render
 * (page.tsx) and in the browser only when the server could not supply it.
 * Products without a sku cannot be matched to a Shopify row and are skipped.
 * Sending this map instead of the catalog keeps the RSC payload to the five
 * fields the tables use.
 */
export function buildMarketProductMap(
  products: Product[]
): Record<string, MarketProduct> {
  const map: Record<string, MarketProduct> = {};
  for (const item of products) {
    if (!item.sku) continue;
    const setInfo = item.sets;
    const typeInfo = item.product_types;
    map[item.sku] = {
      sku: item.sku,
      marketPriceUsd: typeof item.usd_price === "number" ? item.usd_price : null,
      setName: setInfo?.name ?? null,
      releaseDate: setInfo?.release_date ?? null,
      productType: typeInfo?.label ?? typeInfo?.name ?? null,
      lastUpdated: item.last_updated ?? null,
    };
  }
  return map;
}
```

9b. Move the client component: `git mv app/compare/page.tsx app/compare/CompareDashboard.tsx` (keeps history for WP18). In `CompareDashboard.tsx`:

- Delete `type MarketProduct = {...}` (:16-23) and add below the existing imports:

```ts
import type { ExchangeRateSnapshot } from "../lib/marketData";
import { buildMarketProductMap, type MarketProduct } from "./marketProducts";
```

- Above the component add:

```ts
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
```

- Rename `export default function CompareDashboardPage()` to `export default function CompareDashboard({ initialMarketProducts, initialExchangeRate }: CompareDashboardProps)`.
- Replace the four state lines for `marketProducts`, `exchangeRate`, `exchangeRateDate`, `loadingMarket` (:312-317) with:

```ts
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
```

- Replace the mount effect (:339-382) with:

```ts
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
      } catch (err: any) {
        if (cancelled) return;
        setErrorMessage(
          err?.message ||
            "Unable to load market data. Check your Supabase connection."
        );
      } finally {
        if (!cancelled) setLoadingMarket(false);
      }
    };

    fetchMarketData();

    return () => {
      cancelled = true;
    };
  }, [needsProducts, needsRate]);
```

Keep the existing `err: any` (it is in the current code and the file lints clean). Everything else in the file (1000+ lines of tables and CSV parsing) is unchanged. Keep the local `DEFAULT_EXCHANGE_RATE = 1.35`; WP20 owns unifying it.

9c. New `frontend/app/compare/page.tsx` (server component):

```tsx
import CompareDashboard from "./CompareDashboard";
import { buildMarketProductMap } from "./marketProducts";
import {
  getCachedExchangeRate,
  getCachedMarketProductSummaries,
} from "../lib/serverMarketData";
import { logCaughtError } from "../lib/logger";

/**
 * Server-fed like /market (review F143): the catalog comes from the shared
 * server cache instead of each browser running get_market_product_summaries.
 * The page is ISR (it inherits the caches' daily backstop and is refreshed by
 * the scraper hook).
 */
export default async function ComparePage() {
  const [products, exchangeRate] = await Promise.all([
    // Caught so a failed read degrades to the browser fetch instead of failing
    // the build or the regeneration.
    getCachedMarketProductSummaries().catch((error: unknown) => {
      logCaughtError("compare_initial_products_failed", error);
      return null;
    }),
    getCachedExchangeRate(),
  ]);

  return (
    <CompareDashboard
      // No catalog at all (failed read, or the empty WP00 stub): let the
      // browser try. A real catalog always has rows.
      initialMarketProducts={
        products && products.length > 0 ? buildMarketProductMap(products) : undefined
      }
      // date === null is the hard-coded fallback; let the browser try instead.
      initialExchangeRate={exchangeRate.date !== null ? exchangeRate : undefined}
    />
  );
}
```

If WP13 has already added `app/compare/layout.tsx` with metadata, leave it untouched. Do not add metadata here (WP13 owns it).

### Step 10. `/box-calculator` server-fed (F143)

10a. New `frontend/app/components/BoxCalculator/boosterPackData.ts` (no `"use client"`). Move WP06's `compareSetsNewestFirst` here verbatim (with its doc comment), and move the loop body of `useBoosterPackPrices`'s `fetchData` into a pure builder:

```ts
import type { Product } from "../ProductPrices/types";
import type { BoosterPackPrice, SetOption } from "./types";

export type BoosterPackData = {
  prices: BoosterPackPrice[];
  sets: SetOption[];
};

// compareSetsNewestFirst: moved here from hooks/useBoosterBoxPrices.ts
// (WP06), unchanged, including its doc comment.

/**
 * Booster-pack prices and the selectable sets, from guarded market summaries.
 * Pure, so the server page can build it once per cache refresh and send only
 * this (about 60 packs and 60 sets) instead of the whole catalog.
 */
export function buildBoosterPackData(products: Product[]): BoosterPackData {
  const prices: BoosterPackPrice[] = [];
  const setMap = new Map<number, SetOption>();

  for (const item of products) {
    const set = item.sets;
    if (item.product_types?.name !== "booster_pack" || !set?.id) {
      continue;
    }

    // The set stays selectable even with no current price: the picker and the
    // pack rows already render a "No price" state, and dropping the set would
    // make it vanish with no explanation. Only the price is withheld.
    if (!setMap.has(set.id)) {
      setMap.set(set.id, {
        id: set.id,
        name: set.name,
        code: set.code,
        releaseDate: set.release_date,
      });
    }

    // Unpriced packs are listed with a null price rather than dropped, so
    // getPackPrice can tell "this set has no standard pack" from "the standard
    // pack exists but cannot be priced" and never substitutes a variant's SKU.
    prices.push({
      setId: set.id,
      setName: set.name,
      usdPrice: item.usd_price,
      variant: item.variant ?? null,
    });
  }

  return {
    prices,
    sets: Array.from(setMap.values()).sort(compareSetsNewestFirst),
  };
}
```

10b. `frontend/app/components/BoxCalculator/hooks/useBoosterBoxPrices.ts`. Delete the `compareSetsNewestFirst` definition and re-export it so WP06's test import keeps working: `export { compareSetsNewestFirst } from "../boosterPackData";`. Add `import { buildBoosterPackData, type BoosterPackData } from "../boosterPackData";`. Replace the top of the hook through the end of its `useEffect` with:

```ts
/**
 * Booster-pack prices for the NAV calculator. Pass `initialData` when the
 * page built it on the server (box-calculator/page.tsx); the hook then makes
 * no request. Absent or empty, it falls back to the browser fetch.
 */
export function useBoosterPackPrices(initialData?: BoosterPackData) {
  // Gate on content, like useProductData: an empty result means the server
  // had nothing (the stub build, or the summaries failed).
  const hasInitial = initialData !== undefined && initialData.sets.length > 0;
  const [boosterPackPrices, setBoosterPackPrices] = useState<BoosterPackPrice[]>(
    () => (hasInitial && initialData ? initialData.prices : [])
  );
  const [sets, setSets] = useState<SetOption[]>(() =>
    hasInitial && initialData ? initialData.sets : []
  );
  const [loading, setLoading] = useState(!hasInitial);

  useEffect(() => {
    if (hasInitial) return;

    let cancelled = false;

    async function fetchData() {
      try {
        // Guarded summaries, not products.usd_price: a pack whose upstream
        // history stopped updating must not keep valuing a box.
        const products = await fetchMarketProductsClient();
        if (cancelled) return;
        const data = buildBoosterPackData(products);
        setBoosterPackPrices(data.prices);
        setSets(data.sets);
      } catch (error) {
        logCaughtError("booster_pack_prices_failed", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [hasInitial]);
```

`getPackPrice` and the return statement below stay unchanged. Remove the now-unused imports if any (`SetOption` and `BoosterPackPrice` are still used by the state types).

10c. `frontend/app/components/BoxCalculator/BoxCalculator.tsx`. Add `import type { BoosterPackData } from "./boosterPackData";`. Above the component add:

```ts
type BoxCalculatorProps = {
  /** Built on the server by box-calculator/page.tsx. Absent: fetched in the browser. */
  initialPackData?: BoosterPackData;
  /** Server-cached USD to CAD rate. Absent when the server only had the fallback. */
  initialExchangeRate?: number;
};
```

Change the signature to `export default function BoxCalculator({ initialPackData, initialExchangeRate }: BoxCalculatorProps = {})`, change `useBoosterPackPrices()` to `useBoosterPackPrices(initialPackData)` and `useCurrencyConversion()` to `useCurrencyConversion(initialExchangeRate)`. Nothing else changes; `render(<BoxCalculator />)` in WP06's tests stays valid.

10d. Replace `frontend/app/box-calculator/page.tsx`:

```tsx
import { Suspense } from "react";
import BoxCalculator from "../components/BoxCalculator/BoxCalculator";
import { buildBoosterPackData } from "../components/BoxCalculator/boosterPackData";
import CardRinkPromo from "../components/CardRinkPromo";
import {
  getCachedExchangeRate,
  getCachedMarketProductSummaries,
} from "../lib/serverMarketData";
import { logCaughtError } from "../lib/logger";

export default async function BoxCalculatorPage() {
  // Server-fed like /market (review F143). Caught so a failed read degrades
  // to the browser fetch instead of failing the build or the regeneration.
  const [products, exchangeRate] = await Promise.all([
    getCachedMarketProductSummaries().catch((error: unknown) => {
      logCaughtError("box_calculator_initial_products_failed", error);
      return null;
    }),
    getCachedExchangeRate(),
  ]);

  return (
    <main className="p-3 md:p-6">
      {/* ... the existing heading block, unchanged ... */}
      {/* Suspense stays: BoxCalculator reads useSearchParams (?recipe=). */}
      <Suspense fallback={<div className="max-w-4xl mx-auto"><div className="h-64 bg-slate-100 rounded-xl animate-pulse" /></div>}>
        <BoxCalculator
          initialPackData={products ? buildBoosterPackData(products) : undefined}
          // date === null is the hard-coded fallback; let the browser try instead.
          initialExchangeRate={exchangeRate.date !== null ? exchangeRate.rate : undefined}
        />
      </Suspense>
      <CardRinkPromo variant="footer" />
    </main>
  );
}
```

Copy the heading `<div className="mb-5 md:mb-6">...</div>` from the current file byte for byte.

### Step 11. Slim the `/prices` and `/market` payload (F068)

11a. `frontend/app/components/ProductPrices/types/index.ts`:
- Below `ProductVolumeMetrics` add:

```ts
/**
 * The volume fields client components read. Pages send this shape
 * (catalogProjection.ts); full ProductVolumeMetrics rows from the client
 * fetch satisfy it too.
 */
export type VolumeMetricsSummary = Pick<
  ProductVolumeMetrics,
  "units_sold_30d" | "units_sold_prior_30d"
>;
```

- In `Product.sets.generations` make the id optional: `id?: number;` (the projection drops it; nothing reads it, confirmed by `grep -rn "generations?\?\.id" app` returning no component code).

11b. New `frontend/app/lib/catalogProjection.ts`:

```ts
import type {
  Product,
  ProductReturnMetrics,
  ProductVolumeMetrics,
  VolumeMetricsSummary,
} from "../components/ProductPrices/types";
import { hasCurrentPrice } from "./priceGuard";

/**
 * Projections applied at the /prices and /market page boundary (review F068).
 * Both pages hand their data to client components, so every field is
 * serialised into the HTML. These keep only what those trees read; the
 * result is still a valid Product, so the client-fetched full objects remain
 * interchangeable with it.
 *
 * Not applied in serverMarketData: the dashboard needs sets.id (app/page.tsx)
 * and /product/[id] needs the full shape.
 */

function round2(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return value;
  const rounded = Math.round(value * 100) / 100;
  // Normalise -0 so a tiny negative return does not render as "-0.00".
  return rounded === 0 ? 0 : rounded;
}

function roundReturns(returns: ProductReturnMetrics): ProductReturnMetrics {
  return {
    "1D": round2(returns["1D"]),
    "7D": round2(returns["7D"]),
    "1M": round2(returns["1M"]),
    "3M": round2(returns["3M"]),
    "6M": round2(returns["6M"]),
    "1Y": round2(returns["1Y"]),
  };
}

/**
 * Drops sku, sets.id, sets.generation_id and generations.id (never read on
 * these pages) and price_recorded_at for priced products, and rounds the six
 * returns to 2 dp (they are displayed with toFixed(2)).
 *
 * price_recorded_at is kept when the product has NO current price:
 * ProductCard's StalePriceNote (WP07) prints "last recorded <date>" from it.
 */
export function toCatalogProduct(product: Product): Product {
  const projected: Product = {
    id: product.id,
    usd_price: product.usd_price,
    url: product.url,
    last_updated: product.last_updated,
  };
  if (product.variant !== undefined) projected.variant = product.variant;
  if (product.image_url !== undefined) projected.image_url = product.image_url;
  if (!hasCurrentPrice(product) && product.price_recorded_at !== undefined) {
    projected.price_recorded_at = product.price_recorded_at;
  }
  if (product.sets !== undefined) {
    const sets = product.sets;
    projected.sets =
      sets === null
        ? null
        : {
            name: sets.name,
            code: sets.code,
            release_date: sets.release_date,
            ...(sets.expansion_type !== undefined
              ? { expansion_type: sets.expansion_type }
              : {}),
            ...(sets.generations
              ? { generations: { name: sets.generations.name } }
              : {}),
          };
  }
  if (product.product_types !== undefined) {
    projected.product_types = product.product_types;
  }
  if (product.returns !== undefined) {
    projected.returns =
      product.returns === null ? null : roundReturns(product.returns);
  }
  return projected;
}

export function toCatalogProducts(products: Product[]): Product[] {
  return products.map(toCatalogProduct);
}

/** Keeps the two volume fields the client trees read. Every row is kept. */
export function toVolumeSummaries(
  metrics: Record<number, ProductVolumeMetrics>
): Record<number, VolumeMetricsSummary> {
  const summaries: Record<number, VolumeMetricsSummary> = {};
  for (const [id, row] of Object.entries(metrics)) {
    summaries[Number(id)] = {
      units_sold_30d: row.units_sold_30d,
      units_sold_prior_30d: row.units_sold_prior_30d,
    };
  }
  return summaries;
}
```

Before applying it, re-run the reader check, because WP07 to WP09 added client code after the verifier's grep:

```bash
grep -rnE "\.sku\b|price_recorded_at|sets\??\.id\b|generation_id|generations\??\.id" \
  app/components/ProductPrices app/components/MarketView | grep -v __tests__
# expect exactly: types/index.ts (price_recorded_at at :56, generation_id at
# :67 and :92, declarations only) and ProductCard.tsx (price_recorded_at inside
# WP07's StalePriceNote). If another reader of a dropped field appears, keep
# that field in toCatalogProduct and note it in the PR.
```

11c. Prop and hook types (types only, no logic change):
- `app/components/ProductPrices/hooks/useVolumeMetrics.ts`: replace `ProductVolumeMetrics` with `VolumeMetricsSummary` in the import, `EMPTY_METRICS`, the parameter type, the return type and the `useState` type. `fetchVolumeMetrics()` still returns full rows; they are assignable.
- `app/components/ProductPrices/index.tsx` props: `initialVolumeMetrics?: Record<number, VolumeMetricsSummary>;` and in the `./types` import replace `ProductVolumeMetrics` with `VolumeMetricsSummary` (remove `ProductVolumeMetrics` if no other use remains in the file; check with grep).
- `app/components/MarketView/MarketView.tsx` props (:106): `initialVolumeMetrics?: Record<number, VolumeMetricsSummary> | null;` and the same import swap at :22-26.
- `app/components/dashboard/RecentlyReleased.tsx` (:10, :15): same swap. The dashboard keeps sending full rows (its own slimming at `app/page.tsx:145-152` stays); full rows satisfy the narrower type.

11d. `frontend/app/prices/page.tsx`: add `import { toCatalogProducts, toVolumeSummaries } from "../lib/catalogProjection";`. After the `Promise.all`, add:

```ts
  // Only the fields the client tree reads go into the HTML (review F068).
  const catalogProducts = toCatalogProducts(products);
  const catalogVolumeMetrics = toVolumeSummaries(volumeMetrics);
```

and pass `initialProducts={catalogProducts}` and `initialVolumeMetrics={catalogVolumeMetrics}` to `<ProductPrices>`. Keep `{products.length} products tracked` reading `products`.

11e. `frontend/app/market/page.tsx`: the same import, the same two lines after its `Promise.all`, and pass them to `<MarketView>`.

### Step 12. Scraper: call the hook after a successful run (F151)

12a. New `revalidate_hook.py` at the repo root (next to `main.py`; it does not import `main`, so its tests need no Selenium or Supabase):

```python
"""
Tell the website that the scraper has written new data.

The Next.js app caches every market read (frontend/app/lib/serverMarketData.ts)
and serves the public pages from ISR. After a run that changed something,
main.py calls trigger_site_revalidation(), which POSTs to the app's
/api/revalidate route; the site then refreshes each page on its next visit
instead of waiting for the daily backstop.

Configuration (environment; run_scraper.sh sources ~/.config/pokefin/env):
  REVALIDATE_URL     https://<canonical host>/api/revalidate
  REVALIDATE_SECRET  same value as the REVALIDATE_SECRET env var in Vercel

With either unset, revalidation is skipped (local development). Every failure
is logged and swallowed: the scrape itself already succeeded, and the site
catches up at the daily backstop.
"""

import logging
import os
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)

REVALIDATE_TIMEOUT_SECONDS = 15
SECRET_HEADER = "x-revalidate-secret"
_LOCAL_HOSTS = {"localhost", "127.0.0.1"}


def should_revalidate_site(rate_stored: bool, prices_ok: bool, updated_count: int) -> bool:
    """True when update_prices finished and the run wrote something the site shows."""
    if not prices_ok:
        return False
    return bool(rate_stored) or updated_count > 0


def _url_is_acceptable(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme == "https" and parsed.hostname:
        return True
    # Plain http only to this machine, for testing against `pnpm dev`.
    return parsed.scheme == "http" and parsed.hostname in _LOCAL_HOSTS


def trigger_site_revalidation(session=None) -> bool:
    """POST to REVALIDATE_URL. Returns True on HTTP 200. Never raises."""
    try:
        url = os.environ.get("REVALIDATE_URL", "").strip()
        secret = os.environ.get("REVALIDATE_SECRET", "").strip()
        if not url or not secret:
            logger.info("Site revalidation skipped: REVALIDATE_URL or REVALIDATE_SECRET is not set.")
            return False
        if not _url_is_acceptable(url):
            logger.warning("Site revalidation skipped: REVALIDATE_URL must be an https URL.")
            return False

        http = session or requests
        response = http.post(
            url,
            headers={SECRET_HEADER: secret},
            timeout=REVALIDATE_TIMEOUT_SECONDS,
            # Never forward the secret to a redirect target.
            allow_redirects=False,
        )
        if 300 <= response.status_code < 400:
            logger.warning(
                f"Site revalidation got HTTP {response.status_code} "
                f"(redirect to {response.headers.get('location')}); "
                "set REVALIDATE_URL to the final https URL."
            )
            return False
        if response.status_code != 200:
            logger.warning(f"Site revalidation failed: HTTP {response.status_code}")
            return False

        logger.info("Site caches revalidated.")
        return True
    except Exception as e:  # noqa: BLE001 - a failed hook must never fail the run
        logger.warning(f"Site revalidation request failed: {type(e).__name__}: {e}")
        return False
```

12b. `main.py`:

- Imports: below `from secrets_loader import load_supabase_credentials` add `from revalidate_hook import should_revalidate_site, trigger_site_revalidation`.
- `fetch_and_store_exchange_rate` (:961-1022): make it return whether a row was stored. After `logger.info("Exchange rate stored in Supabase successfully.")` add `return True`; in the inner `except Exception as e:` (insert failed) add `return False` after the warning; in the outer `except Exception as e:` add `return False` after the error log. Add to the docstring: `Returns True when a new row was stored.`
- `update_prices` (:1055): make it return the number of products it updated. In the early exit `if not products_to_update:` change `return` to `return 0`. After the final `logger.info(... listings snapshots written ...)` at the end of the function (:1302-1306) add `return updated_count`. Add to the docstring: `Returns the number of products updated.`
- Add this function directly above the `# === Run Script ===` comment (:1489), after the blank lines that end the previous function:

```python
def run_jobs_once():
    """
    One scraper run: exchange rate, prices, then tell the website to refresh
    its caches when the run wrote something. Never raises.
    """
    rate_stored = False
    try:
        rate_stored = bool(fetch_and_store_exchange_rate())
    except Exception as e:
        logger.error(f"fetch_and_store_exchange_rate failed: {e}")

    prices_ok = False
    updated_count = 0
    try:
        updated_count = update_prices() or 0
        prices_ok = True
    except Exception as e:
        logger.error(f"update_prices failed: {e}")

    if should_revalidate_site(rate_stored=rate_stored, prices_ok=prices_ok, updated_count=updated_count):
        try:
            trigger_site_revalidation()
        except Exception as e:  # trigger_site_revalidation never raises; belt and braces
            logger.warning(f"Site revalidation failed: {e}")
    else:
        logger.info("Site revalidation not needed: this run wrote nothing new (or update_prices failed).")
```

- In the `--run-now` branch, replace the two `try` blocks (`fetch_and_store_exchange_rate()` and `update_prices()`) with `run_jobs_once()`. In the scheduled loop, replace the same two `try` blocks with `run_jobs_once()`. Leave the log lines, `time.sleep(1)` and the `KeyboardInterrupt` handling as they are.
- If WP16 has already restructured the run (for example a run lock or a scrubbed Chrome environment), keep its structure and call `run_jobs_once()` where the two jobs run. If WP16 added an allowlist or denylist of environment variables passed to Chrome (F082), add `REVALIDATE_SECRET` to the secrets it removes.

12c. Documentation and env templates:
- `frontend/.env.example`: append

```
# Server-only shared secret for POST /api/revalidate (header x-revalidate-secret).
# The scraper sends it after each run. At least 32 characters; generate with
# `openssl rand -hex 32`. Never prefix it with NEXT_PUBLIC_.
REVALIDATE_SECRET=
```

- `README.md`, in the scraper env-file heredoc (:113-116), add two lines after `SUPABASE_SERVICE_ROLE_KEY=...`:

```
REVALIDATE_URL=https://your-site-host/api/revalidate
REVALIDATE_SECRET=the-same-value-as-in-vercel
```

and one sentence below the block: `After each run that writes data, the scraper POSTs to REVALIDATE_URL so the site refreshes its caches; leave both unset locally to skip it. Use the host that answers without a redirect (pokefin.ca or www.pokefin.ca, whichever serves 200), because the hook does not follow redirects.` Do not hard-code one of the two hosts here: the repo references both (`layout.tsx:34` uses `pokefin.ca`, `.env.example` suggests `www.pokefin.ca`), and only the owner's check in Owner actions step 3 settles which one redirects.
- `run_scraper.sh`, in the comment that lists the env file contents (:25-28), add `#   REVALIDATE_URL=https://<site host, no redirect>/api/revalidate` and `#   REVALIDATE_SECRET=<same value as the Vercel env var>` lines directly after the `SUPABASE_SERVICE_ROLE_KEY` line.

### Step 13. Product links prefetch on intent only (Track 2, PX06)

Why in this PR: Next 16.3.6 prefetches a static route in full as soon as its `<Link>` enters the viewport (research/performance-excellence.md §8, from the bundled `prefetching.md`). Step 7 makes `/product/[id]` a static ISR route, so from this PR on, every product card, home-page mover and product-page sibling that scrolls into view would download its whole product page and, for each page not cached yet, wake a cold ISR render: up to 306 per scroll through `/prices`. `IntentLink` prefetches only when the visitor shows intent. WP13's later `loading.tsx` for `/product/[id]` then changes nothing for these links.

13a. New `frontend/app/components/IntentLink.tsx`. WP30 step 1 creates the same file when it is missing; keep this code identical to that spec so WP30 can reuse it.

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

`<Link prefetch={false}>` also turns off Next's own hover prefetch (`link.js:108-110`), which is why the handlers call `router.prefetch` themselves. The module-level `Set` lives until a full page load, so a product is prefetched at most once per visit even across client navigations; a later click on it still navigates normally.

13b. Use `IntentLink` for every internal product link. Keep every other prop (`className`, `key`, children) exactly as it is; change only the element name and the import.

- `app/components/ProductPrices/cards/ProductCard.tsx` (a client component; it also renders the "Recently released" strip on `/` through `RecentlyReleased.tsx`): replace each of the five `<Link` ... `</Link>` elements whose `href` is `` {`/product/${product.id}`} `` with `<IntentLink` ... `</IntentLink>`. Replace `import Link from "next/link";` with `import IntentLink from "../../IntentLink";`. If `grep -n "<Link" app/components/ProductPrices/cards/ProductCard.tsx` still finds a link to another route after the swap, keep the `next/link` import as well.
- `app/page.tsx`, `MoverCard`: replace its `<Link` ... `</Link>` (`` href={`/product/${product.id}`} ``) with `<IntentLink` ... `</IntentLink>` and add `import IntentLink from "./components/IntentLink";`. Keep `import Link from "next/link";`: the page's other links (`/prices`, `/market` and so on) stay `Link`.
- `app/product/[id]/page.tsx`, the siblings list (`{siblings.map((sib) => (`): replace that `<Link` ... `</Link>` (`` href={`/product/${sib.id}`} ``) with `<IntentLink` ... `</IntentLink>` and add `import IntentLink from "../../components/IntentLink";`. Keep `import Link from "next/link";` for the `/market` breadcrumb.
- Any other hit of the "Before you start" grep for `` href={`/product/ `` (for example a `/market` row or a portfolio holding that an earlier package made into an internal product link): the same swap. External links (`product.url` to TCGplayer, `target="_blank"`) stay plain `<a>` elements.

`app/page.tsx` and the product page are server components. Rendering the client `IntentLink` from them is fine because they pass only serialisable props (`href`, `className`, `key`, children). Never pass an event handler to `IntentLink` from a server component.

13c. `frontend/app/components/Footer.tsx`: add `prefetch={false}` to every `<Link` element in the file (the two `.map` lists, which include `/auth/login` and `/auth/signup`, the CardRinkTCG link and the `/privacy` link). The footer enters the viewport at the end of every long page and would otherwise prefetch every route it lists although nobody is about to open them. After the edit, `grep -c "prefetch={false}" app/components/Footer.tsx` equals `grep -c "<Link" app/components/Footer.tsx`.

13d. `frontend/app/components/Header.tsx`: add `prefetch={false}` to the four `<Link` elements whose `href` starts with `/auth/` (Sign In and Sign Up in the desktop bar and in the mobile menu). They are dynamic, rarely clicked, and each prefetch counts against the proxy's auth rate limit. Leave every other header link (logo, primary nav, `/portfolio`, `/account`, the other mobile-menu links) on the default prefetch: those are the core destinations, and the mobile menu is only visible after the tap that opens it.

13e. `frontend/next.config.ts` (optional, recommended; the PR says whether it was done): keep the client router cache for prefetched static pages for 30 minutes instead of the default 5, so going back and forth between `/prices` and product pages reuses what was prefetched. Data changes at most every 4 hours. Inside `const nextConfig: NextConfig = {`, add the block below after `poweredByHeader: false,`. If an earlier package already added an `experimental` object, add only the `staleTimes` line and its comment inside that object.

```ts
  experimental: {
    // Client router cache for prefetched static pages: 30 minutes instead of
    // the default 5 (research/performance-excellence.md §8). It only extends a
    // TTL; delete this key to roll back.
    staleTimes: { static: 1800 },
  },
```

## Pitfalls: do not do this

- **Do not call a cached function from inside another cached function's callback.** Next skips the cache for a nested `unstable_cache` call (`unstable-cache.js:147,160`). That was the root cause of hundreds of summaries RPC calls an hour. Compose cached reads in plain async functions (`loadProductDetail`, `getCachedSetAnalytics`).
- **Do not call `revalidateTag(tag)` with one argument.** Next 16 deprecates it (it logs a warning and behaves like `{ expire: 0 }`). Do not use `updateTag`: it throws outside Server Actions (`revalidate.js`, `updateTag`). Do not use `{ expire: 0 }`: it makes the first visitor after every scrape wait on the summaries RPC and, if that times out, on the fallback's about 50 serial history pages. `"max"` is correct because regeneration refreshes stale data caches in the foreground.
- **Do not set `revalidate: false`** on the caches (F123's suggestion). The daily backstop keeps the site current if the scraper host or the hook dies, and it is the only thing that ages out clock-derived values: the RPC nulls a price once its `price_recorded_at` crosses the 14-day cutoff, computed at call time, so with no clock a stalled scraper would leave expired prices on the pages indefinitely. The re-verification called 6 hours "a safe value"; this spec keeps 24 hours because the scraper hook covers normal freshness and WP13, WP24 and WP26 are written against `86400` and `DAILY_BACKSTOP_SECONDS`. Do not change it in this PR.
- **Do not return a fallback from inside an `unstable_cache` callback** for the exchange rate, volume metrics or set analytics. With a 24 hour backstop a cached fallback would stick until the next scrape. Throw inside, degrade in the exported wrapper.
- **Do not make `fetchMarketProductSummaries` throw instead of falling back** (F146 verifier). At build time `unstable_cache` has no stale entry to serve, so a throw fails the build instead of keeping the previous page, and WP05's `/api/portfolio` would lose prices during an RPC outage. Keep the fallback; only reorder it. Accepted consequence, state it in the PR: the fallback catalog (6M and 1Y returns null; the set fallback's 365-day drawdown and trend over about five months) is now cached until the next scraper revalidation instead of for one hour. It still makes about 50 serial history page requests (the 14-day freshness pages overlap them through `Promise.all`); only a migration can remove those. (On a stale entry a failing RPC is not reached at all: `unstable_cache` keeps serving the previous value when a refresh throws, `unstable-cache.js:190-196`, but the summaries function does not throw, so the fallback result replaces it.)
- **Do not gate `/compare` on the sku map being empty.** `page.tsx` passes `undefined` when it had no catalog; an empty map is a real answer and must not make every browser fetch the catalog again.
- **Do not change the order in `fetchNewestPricedAt`.** Its 14-day window is complete; only the two 367-day callers pass `newestFirst`.
- **Do not add a CSRF check to `/api/revalidate`** and do not remove `/api/*` from the proxy matcher. The scraper sends no Origin header, so `rejectIfCsrfFails` would 403 every call; the route has no cookie authority to protect. The proxy's per-IP limit stays as a brute-force brake.
- **Do not compare the secret with `===` or call `timingSafeEqual` on the raw strings.** `===` leaks timing; `timingSafeEqual` throws on unequal lengths. Hash both sides first, as the route does.
- **Do not put the secret in the query string** (it lands in access logs) or in a `NEXT_PUBLIC_*` variable (it would ship to browsers).
- **Do not follow redirects in the Python hook.** A redirect from the apex to `www` would forward the custom secret header to whatever `Location` says. Treat 3xx as a misconfiguration.
- **Do not fail or retry the scraper run on a revalidation error.** Log and move on; the backstop covers it.
- **Do not add `/api/market/products` or rewire `fetchMarketProductsClient` to `fetch()`** (F143 verifier). The proxy rate-limits and session-refreshes every `/api/*` hit, middleware runs before the CDN cache, and the rewire breaks `clientMarketData.cache.test.ts`. Server components passing initial data is the fix.
- **Do not pass the whole catalog to `/compare` or `/box-calculator`.** Build the sku map and the booster-pack data on the server; that is the point of `buildMarketProductMap` and `buildBoosterPackData`.
- **Do not import `buildBoosterPackData` from `useBoosterBoxPrices.ts` in the server page.** That file is `"use client"`; a server component importing a function from it gets a client reference, not the function. Pure helpers live in `boosterPackData.ts` and `marketProducts.ts`.
- **Do not remove the `<Suspense>` around `<BoxCalculator>`.** It still calls `useSearchParams` for `?recipe=`; without the boundary the build fails.
- **Do not make `generateStaticParams` call Supabase.** Returning all ids would put 306 renders and their queries into every build and every stub build. `[]` plus `dynamicParams` (default) gives ISR on first hit. Do not set `dynamicParams = false` (every product would 404) or `dynamic = "force-static"`.
- **Do not drop the per-product data cache entirely** (F147 verifier: keep it). The narrower `product-detail-rows` cache is what keeps a product page's three queries off the database if the route ever falls back to dynamic rendering. Only the nesting goes. The F147 re-verification also warns against removing the `unstable_cache` wrapper around `fetchProductDetail`, because it deduplicated the `generateMetadata` and page calls and shared the summaries cache with `/` and `/prices`. Step 2e keeps both properties: React `cache()` dedupes the two calls within a render, and `loadProductDetail` reads the shared `getCachedMarketProductSummaries` entry. Do not remove `cache()` from `getCachedProductDetail`.
- **Do not restructure the catalog payload** into a sets map, `set_id` references, image paths or volume tuples (F068 verifier). It saves about 1 KB compressed and touches ProductCard, MarketView, RecentlyReleased, filtering, set grouping and ProductImage's URL regex.
- **Do not drop `price_recorded_at` for products without a current price.** Correction to the F068 verifier, whose grep predates WP07: `ProductCard`'s `StalePriceNote` reads it to print "last recorded <date>". Keep it when `usd_price` is null, drop it otherwise.
- **Do not apply the projection inside `serverMarketData.ts` or on the dashboard.** `app/page.tsx:128` groups by `sets.id`, `/product/[id]` needs the full shape, and WP05's portfolio code reads summaries server-side.
- **Do not make `exchangeRate.ts` import `clientMarketData.ts`** to reuse its TTL constant. It would pull the market-data module into every bundle that only converts currency (WP12 is shrinking those).
- **Do not change `MARKET_PRODUCTS_TTL_MS` or `CLIENT_CACHE_TTL_MS`.** Only their comment is stale.
- **Do not touch the "updated daily" copy** (WP03) or `useCurrencyConversion.ts` (its lint error is WP17's).
- **Do not leave a product link in a grid or list as a plain `<Link>`, and do not give one `prefetch={true}`.** With step 7 a default `<Link>` to `/product/<id>` prefetches the full page on viewport entry. Use `IntentLink`.
- **Do not prefetch from an `IntersectionObserver`, a mount effect or any other trigger that fires without the visitor pointing, focusing or pressing.** That is viewport prefetch again.
- **Do not add `prefetch={false}` to the header's primary nav, logo, `/portfolio` or `/account` links.** Only the footer and the `/auth/*` links lose prefetch (research §8 keeps it for the core destinations).
- **Do not change `IntentLink`'s code or export names** (`INTENT_DWELL_MS`, `resetIntentPrefetchForTests`, the default export). WP30 checks for the file and builds on this exact component.
- **Do not forget the `next/navigation` mock in tests.** `IntentLink` calls `useRouter()`, which throws `invariant expected app router to be mounted` outside the App Router. Every test that renders a product card, the product page or the home page needs the mock described in test 12.

## Tests

Route and server-module tests start with `/** @jest-environment node */` (`next/server` throws under jsdom). Mock `server-only` with `jest.mock("server-only", () => ({}))` wherever the module under test imports it.

### 1. `frontend/app/api/revalidate/__tests__/route.test.ts` (new)

```ts
/** @jest-environment node */
jest.mock("next/cache", () => ({ revalidateTag: jest.fn() }));

import { revalidateTag } from "next/cache";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { SCRAPE_REVALIDATED_TAGS } from "../../../lib/cacheTags";

const SECRET = "s".repeat(40);
const revalidateTagMock = revalidateTag as jest.Mock;

function post(headers: Record<string, string> = {}) {
  return POST(
    new NextRequest("http://localhost/api/revalidate", { method: "POST", headers })
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.REVALIDATE_SECRET = SECRET;
});

afterAll(() => {
  delete process.env.REVALIDATE_SECRET;
});

it("fails closed with 503 when the secret is unset", async () => {
  delete process.env.REVALIDATE_SECRET;
  const res = await post({ "x-revalidate-secret": SECRET });
  expect(res.status).toBe(503);
  expect(revalidateTagMock).not.toHaveBeenCalled();
});

it("fails closed with 503 when the secret is shorter than 32 characters", async () => {
  process.env.REVALIDATE_SECRET = "short";
  const res = await post({ "x-revalidate-secret": "short" });
  expect(res.status).toBe(503);
  expect(revalidateTagMock).not.toHaveBeenCalled();
});

it.each([
  ["no header", {}],
  ["a wrong secret of the same length", { "x-revalidate-secret": "t".repeat(40) }],
  ["a wrong secret of another length", { "x-revalidate-secret": "nope" }],
  ["the secret in another header", { authorization: `Bearer ${SECRET}` }],
])("rejects %s with 401", async (_label, headers) => {
  const res = await post(headers as Record<string, string>);
  expect(res.status).toBe(401);
  expect(revalidateTagMock).not.toHaveBeenCalled();
});

it("marks every scrape tag stale with the max profile", async () => {
  const res = await post({ "x-revalidate-secret": SECRET });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(revalidateTagMock).toHaveBeenCalledTimes(SCRAPE_REVALIDATED_TAGS.length);
  for (const tag of ["market-products", "set-analytics", "exchange-rate"]) {
    expect(revalidateTagMock).toHaveBeenCalledWith(tag, "max");
  }
  const body = await res.json();
  expect(body.revalidated).toEqual([...SCRAPE_REVALIDATED_TAGS]);
});
```

### 2. `frontend/app/lib/__tests__/serverMarketData.cache.test.ts` (new)

A fake `unstable_cache` that behaves like Next's in the two ways that matter: it stores only resolved values, and it bypasses the cache for a call made while another cached callback is running. The registry lives inside the mock factory (a `const` declared at the top of the test file would still be in its temporal dead zone when the module under test calls `unstable_cache` at import time).

```ts
/** @jest-environment node */
jest.mock("server-only", () => ({}));

const rpcMock = jest.fn();
const fromMock = jest.fn();
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: rpcMock, from: fromMock }),
}));
jest.mock("../logger", () => ({
  logSupabaseError: jest.fn(),
  logCaughtError: jest.fn(),
}));

type CacheOptions = { revalidate?: number; tags?: string[] };
jest.mock("next/cache", () => {
  const registry: Array<{ keyParts: string[]; options: CacheOptions }> = [];
  const nested: string[] = [];
  const store = new Map<string, unknown>();
  let depth = 0;
  return {
    __registry: registry,
    __nested: nested,
    __store: store,
    unstable_cache:
      (fn: (...args: unknown[]) => Promise<unknown>, keyParts: string[], options: CacheOptions) => {
        registry.push({ keyParts, options });
        return async (...args: unknown[]) => {
          const key = `${keyParts.join(",")}:${JSON.stringify(args)}`;
          if (depth > 0) {
            nested.push(keyParts.join(","));   // Next would skip the cache here
          } else if (store.has(key)) {
            return store.get(key);
          }
          depth += 1;
          try {
            const value = await fn(...args);
            store.set(key, value);             // only resolved values are stored
            return value;
          } finally {
            depth -= 1;
          }
        };
      },
  };
});

import {
  getCachedExchangeRate,
  getCachedMarketProductSummaries,
  getCachedProductDetail,
  getCachedSetAnalytics,
  getCachedVolumeMetrics,
} from "../serverMarketData";
import { CACHE_TAGS } from "../cacheTags";

const nextCache = jest.requireMock("next/cache") as {
  __registry: Array<{ keyParts: string[]; options: CacheOptions }>;
  __nested: string[];
  __store: Map<string, unknown>;
};

type Result = { data: unknown; error: unknown };
/** A PostgREST builder stand-in: every method chains, awaiting resolves `result`. */
function query(result: Result) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "gte", "order", "range", "limit", "single"]) {
    chain[method] = () => chain;
  }
  chain.then = (onFulfilled: (r: Result) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

/** A MarketSummaryRow. Every product is in set 1, so they are siblings. */
function summaryRow(id: number) {
  return {
    id,
    usd_price: 10,
    url: `https://example.com/${id}`,
    price_recorded_at: new Date().toISOString().split("T")[0] + "T09:00:00",
    last_updated: "2026-09-25T04:00:00",
    variant: null,
    image_url: null,
    sku: `SKU-${id}`,
    set_id: 1,
    set_name: "Set",
    set_code: "S",
    set_release_date: "2024-01-01",
    set_expansion_type: null,
    generation_id: 1,
    generation_name: "Gen",
    product_type_id: 1,
    product_type_name: "booster_pack",
    product_type_label: "Booster Pack",
    return_1d: null,
    return_7d: null,
    return_30d: null,
    return_90d: null,
    return_180d: null,
    return_365d: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  nextCache.__store.clear();
  nextCache.__nested.length = 0;
  // Default: a healthy database. Every case overrides only what it tests.
  // Without this default rpc() returns undefined, the destructure in
  // fetchMarketProductSummaries throws, and the detail cases fail for the
  // wrong reason.
  rpcMock.mockImplementation(async (name: string) =>
    name === "get_market_product_summaries"
      ? { data: [summaryRow(1), summaryRow(2)], error: null }
      : { data: [], error: null }
  );
  fromMock.mockImplementation(() => query({ data: [], error: null }));
});
```

Use `mockImplementationOnce` (or a `name`/`table` switch) to make a single call fail; do not replace the default for the whole file.

Cases:
- **every cache uses the daily backstop and a known tag**: every `__registry` entry has `options.revalidate === 86400` and every tag is in `Object.values(CACHE_TAGS)`; the key parts include `"product-detail-rows"` and do not include `"product-detail"`.
- **product detail reads the summaries from their cache, never nested**: with the default mocks, `await getCachedProductDetail(1)` and `await getCachedProductDetail(2)` both return non-null with `siblings` of length 1; `__nested` is empty; `rpcMock.mock.calls.filter(([name]) => name === "get_market_product_summaries")` has length 1.
- **an unknown product id makes no per-product queries**: with the default mocks, `await getCachedProductDetail(999)` is `null` and `fromMock` was not called.
- **a failed history query is not cached**: `fromMock.mockImplementation((table: string) => table === "product_price_history" ? query({ data: null, error: { message: "down" } }) : query({ data: [], error: null }))`; `(await getCachedProductDetail(1))?.history` equals `[]`. Then `fromMock.mockImplementation((table: string) => table === "product_price_history" ? query({ data: [{ product_id: 1, usd_price: 10, recorded_at: "2026-09-24T09:00:00" }], error: null }) : query({ data: [], error: null }))`; a second `getCachedProductDetail(1)` returns `history` equal to `[{ usd_price: 10, recorded_at: "2026-09-24T09:00:00" }]` (the failure was not stored).
- **a failed sales-history query is not cached (N04)**: `fromMock.mockImplementation((table: string) => table === "product_sales_history" ? query({ data: null, error: { message: "timeout", code: "57014" } }) : query({ data: [], error: null }))`; `(await getCachedProductDetail(1))?.salesHistory` equals `[]`. Then `fromMock.mockImplementation((table: string) => table === "product_sales_history" ? query({ data: [{ bucket_date: "2026-09-24", granularity: "day", quantity_sold: 3, transaction_count: 2, low_sale_price: 9, high_sale_price: 11, market_price: 10 }], error: null }) : query({ data: [], error: null }))`; a second `getCachedProductDetail(1)` returns `salesHistory` of length 1 (the failure was not stored).
- **a missing sales table still degrades (N04)**: `product_sales_history` returns `query({ data: null, error: { message: "relation does not exist", code: "42P01" } })` and `product_price_history` returns one row `{ product_id: 1, usd_price: 10, recorded_at: "2026-09-24T09:00:00" }`; `getCachedProductDetail(1)` resolves with `salesHistory` equal to `[]` and `history` of length 1.
- **a failed exchange-rate read is not cached**: `fromMock` for `"exchange_rates"` returns `query({ data: null, error: { code: "PGRST116" } })`; `getCachedExchangeRate()` resolves `{ rate: 1.36, date: null }`; switch to `query({ data: { usd_to_cad: 1.41, recorded_at: "2026-09-25T00:00:00" }, error: null })`; the next call resolves `{ rate: 1.41, date: "2026-09-25T00:00:00" }`.
- **a malformed rate is rejected**: `data: { usd_to_cad: null, recorded_at: null }` yields `{ rate: 1.36, date: null }`.
- **a failed volume read is not cached**: `get_market_product_volume_metrics` errors once (result `{}`), then succeeds with one row (result has that product id).
- **set analytics falls back outside any cache callback**: `rpcMock.mockImplementation(async (name: string) => name === "get_set_analytics" ? { data: null, error: { message: "timeout" } } : { data: [], error: null })` (summaries resolve `[]`); `getCachedSetAnalytics()` resolves `[]`, `__nested` is empty, and `rpcMock` was called with `"get_market_product_summaries"` (the fallback read the summaries).

### 3. `frontend/app/lib/__tests__/serverMarketData.fallbackOrder.test.ts` (new)

Same `server-only`, `@supabase/supabase-js`, `../logger` mocks as the freshness test, and `next/cache` as `{ unstable_cache: (fn) => fn }`. Copy `PRODUCT_ROW` from `serverMarketData.freshness.test.ts`.

```ts
it("pages the 367-day fallback newest first and the freshness window oldest first", async () => {
  const orderCalls: Array<{ bound: string; column: string; ascending: boolean }> = [];
  rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
  fromMock.mockImplementation((table: string) => {
    if (table === "products") {
      return {
        select: () => ({
          eq: () => ({ order: () => Promise.resolve({ data: [PRODUCT_ROW], error: null }) }),
        }),
      };
    }
    if (table === "product_price_history") {
      return {
        select: () => ({
          in: () => ({
            gte: (_column: string, bound: string) => {
              const chain = {
                order: (column: string, opts: { ascending: boolean }) => {
                  orderCalls.push({ bound, column, ascending: opts.ascending });
                  return chain;
                },
                range: () => Promise.resolve({ data: [], error: null }),
              };
              return chain;
            },
          }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });

  await getCachedMarketProductSummaries();

  const bounds = [...new Set(orderCalls.map((c) => c.bound))].sort();
  expect(bounds).toHaveLength(2);
  const [yearBound, toleranceBound] = bounds; // ISO dates sort chronologically
  expect(orderCalls.filter((c) => c.bound === yearBound).every((c) => !c.ascending)).toBe(true);
  expect(orderCalls.filter((c) => c.bound === toleranceBound).every((c) => c.ascending)).toBe(true);
  expect(orderCalls.map((c) => c.column)).toEqual(
    expect.arrayContaining(["recorded_at", "id"])
  );
});
```

Add a second case, "keeps the short-window returns when the long window arrives newest first". Copy `recordedDaysAgo` from the freshness test. Build the same `fromMock` shape as the first case, with these differences: the `products` query resolves `{ data: [{ ...PRODUCT_ROW, usd_price: 110 }], error: null }` (a copy; do not mutate `PRODUCT_ROW`), and `range(from)` resolves `from === 0 ? rows : []`, where `rows` is, for the year bound (the earlier of the two `gte` bounds, compare them as strings), `[{ product_id: 42, usd_price: 110, recorded_at: recordedDaysAgo(1) }, { product_id: 42, usd_price: 100, recorded_at: recordedDaysAgo(8) }]` (newest first, as the real query now returns them), and for the tolerance bound `[{ product_id: 42, usd_price: 110, recorded_at: recordedDaysAgo(1) }]`. Tell the bounds apart the way the freshness test's `mockSupabase` does (`bound >= toleranceBound`, with `toleranceBound` 20 days back). Then `const [product] = await getCachedMarketProductSummaries();` and `expect(product.returns?.["7D"]).toBeCloseTo(10, 5)`, proving the grouping re-sorts and the short returns survive. Also assert `expect(product.returns?.["6M"]).toBeNull()` and `expect(product.returns?.["1Y"]).toBeNull()`: with no row old enough, the long returns are null, never a number computed from the wrong anchor.

`serverMarketData.freshness.test.ts` must pass unchanged (its mocks ignore `order` arguments; `groupHistoryRowsByProduct` re-sorts).

### 4. `frontend/app/lib/__tests__/exchangeRate.test.ts` (new)

The first line of the file is `export {};`. The file has no static import (the module under test is imported dynamically), so without it TypeScript treats the file as a global script and its `const fromMock` collides with the one in `clientMarketData.cache.test.ts` (`tsc` error TS2451; WP09 hit the same thing). Copy the `jest.mock("../supabase", ...)` and `jest.mock("../logger", ...)` pattern and the `jest.resetModules()` plus `const { fetchLatestExchangeRateClient, EXCHANGE_RATE_TTL_MS } = await import("../exchangeRate")` per test from `clientMarketData.cache.test.ts`. `fromMock` returns a chain `select().order().limit().single()` resolving to the queued result (a failure is `{ data: null, error: { message: "down" } }`, a success `{ data: { usd_to_cad: 1.41, recorded_at: "2026-09-25T00:00:00" }, error: null }`). Cases:
- two calls inside the TTL make one query;
- after advancing `Date.now` past `EXCHANGE_RATE_TTL_MS` (`jest.spyOn(Date, "now")`), a call queries again and returns the new rate;
- a failure on the first ever call returns `{ rate: 1.36, date: null }`, and the next call queries again (the fallback was not cached);
- a failure after an expired good value returns that expired value (rate and date), not 1.36;
- a row with `usd_to_cad: null` returns `{ rate: 1.36, date: null }` and is not cached (the next call queries again);
- two concurrent calls share one in-flight query, and a third call after both resolve (inside the TTL) makes no query.

### 5. `frontend/app/lib/__tests__/catalogProjection.test.ts` (new)

Build a product with every field set (sku, `price_recorded_at`, `sets` with `id`, `generation_id`, `expansion_type`, `generations: { id, name }`, `product_types`, returns with many decimals). Cases:
- priced product: `sku`, `price_recorded_at`, `sets.id`, `sets.generation_id`, `sets.generations.id` are absent (`not.toHaveProperty`); `sets.name`, `code`, `release_date`, `expansion_type`, `generations.name`, `product_types`, `url`, `image_url`, `variant`, `last_updated` are equal to the input;
- product with `usd_price: null` keeps `price_recorded_at`;
- returns are rounded (`5.85649798051793` becomes `5.86`), `null` stays `null`, `-0.004` becomes `0` with `Object.is(value, 0)` true;
- `sets: null` and `returns: null` pass through as `null`; an absent `expansion_type` produces no key;
- `JSON.stringify(toCatalogProduct(p)).length < JSON.stringify(p).length`;
- `toVolumeSummaries` keeps exactly `units_sold_30d` and `units_sold_prior_30d` for every input row, including rows where both are null.

### 6. `frontend/app/components/BoxCalculator/__tests__/boosterPackData.test.ts` (new)

Reuse the `makeProduct` helper shape from `useBoosterBoxPrices.test.tsx`. Cases: non-booster-pack products and products without `sets.id` are skipped; an unpriced pack is listed with `usdPrice: null`; one set entry per set id; sets come out newest release first (`compareSetsNewestFirst`).

### 7. `frontend/app/components/BoxCalculator/__tests__/useBoosterBoxPrices.test.tsx` (update)

Keep every existing case unchanged (they call `useBoosterPackPrices()` with no argument). Import `buildBoosterPackData` from `../boosterPackData` and add:

```ts
describe("server-supplied data (F143)", () => {
  it("uses it on the first render and never fetches", () => {
    const initial = buildBoosterPackData([makeProduct(1, 8.5), makeProduct(2, null)]);
    const { result } = renderHook(() => useBoosterPackPrices(initial));
    expect(result.current.loading).toBe(false);
    expect(result.current.sets.map((s) => s.id).sort()).toEqual([1, 2]);
    expect(result.current.getPackPrice(1)).toBe(8.5);
    expect(fetchProductsMock).not.toHaveBeenCalled();
  });

  it("falls back to the browser fetch when the server data is empty", async () => {
    fetchProductsMock.mockResolvedValue([makeProduct(3, 4)]);
    const { result } = renderHook(() => useBoosterPackPrices({ prices: [], sets: [] }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchProductsMock).toHaveBeenCalledTimes(1);
    expect(result.current.getPackPrice(3)).toBe(4);
  });
});
```

WP06's `compareSetsNewestFirst` cases keep importing it from `../hooks/useBoosterBoxPrices` and must pass through the re-export.

### 8. `frontend/app/compare/__tests__/marketProducts.test.ts` and `CompareDashboard.test.tsx` (new)

`marketProducts.test.ts`: products without sku are skipped; `marketPriceUsd` is null for a null price; `productType` prefers `label` over `name`; `setName`, `releaseDate`, `lastUpdated` map through.

`CompareDashboard.test.tsx` (jsdom): mock `../../lib/exchangeRate` (`fetchLatestExchangeRateClient: jest.fn()`) and `../../lib/clientMarketData` (`fetchMarketProductsClient: jest.fn()`), import both names statically and cast each with `as jest.Mock`. In `beforeEach`, `jest.clearAllMocks()`, then `fetchLatestExchangeRateClient.mockResolvedValue({ rate: 1.3333, date: "2026-09-24T00:00:00" })` and `fetchMarketProductsClient.mockResolvedValue([])` (an unresolved `jest.fn()` returns `undefined`, and `buildMarketProductMap(undefined)` would throw into the error banner). The rate text sits inside `Exchange rate: 1 USD = ... CAD`, so match it with a regex, not an exact string. Cases:
- with `initialMarketProducts={{ "SKU-1": { sku: "SKU-1", marketPriceUsd: 10 } }}` and `initialExchangeRate={{ rate: 1.4, date: "2026-09-25T00:00:00" }}`: neither mock is called, `screen.getByText(/1 USD = 1\.4000 CAD/)` is present, and `screen.queryByText(/Loading market data/)` is null;
- with `initialMarketProducts={{}}` (a catalog with no sku products) and a rate: `fetchMarketProductsClient` is not called;
- with no props: both mocks are called once, and `await screen.findByText(/1 USD = 1\.3333 CAD/)` resolves;
- with products but no rate: only `fetchLatestExchangeRateClient` is called.

### 9. `tests/test_revalidate_hook.py` (new, repo root)

```python
import logging

import pytest
import requests

import revalidate_hook as hook

SECRET = "x" * 40
URL = "https://pokefin.example/api/revalidate"


class FakeResponse:
    def __init__(self, status_code, headers=None):
        self.status_code = status_code
        self.headers = headers or {}


class FakeSession:
    def __init__(self, response=None, exc=None):
        self.response = response
        self.exc = exc
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if self.exc:
            raise self.exc
        return self.response


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("REVALIDATE_URL", URL)
    monkeypatch.setenv("REVALIDATE_SECRET", SECRET)


def test_skips_when_not_configured(monkeypatch):
    monkeypatch.delenv("REVALIDATE_URL", raising=False)
    monkeypatch.delenv("REVALIDATE_SECRET", raising=False)
    session = FakeSession(FakeResponse(200))
    assert hook.trigger_site_revalidation(session=session) is False
    assert session.calls == []


def test_posts_the_secret_header_without_following_redirects(configured):
    session = FakeSession(FakeResponse(200))
    assert hook.trigger_site_revalidation(session=session) is True
    url, kwargs = session.calls[0]
    assert url == URL
    assert kwargs["headers"] == {"x-revalidate-secret": SECRET}
    assert kwargs["allow_redirects"] is False
    assert kwargs["timeout"] == hook.REVALIDATE_TIMEOUT_SECONDS


@pytest.mark.parametrize("status", [301, 308, 401, 404, 429, 500, 503])
def test_non_200_is_a_logged_failure(configured, status):
    assert hook.trigger_site_revalidation(session=FakeSession(FakeResponse(status))) is False


def test_network_errors_never_raise(configured):
    session = FakeSession(exc=requests.ConnectionError("boom"))
    assert hook.trigger_site_revalidation(session=session) is False


def test_rejects_plain_http_to_a_remote_host(monkeypatch):
    monkeypatch.setenv("REVALIDATE_URL", "http://pokefin.example/api/revalidate")
    monkeypatch.setenv("REVALIDATE_SECRET", SECRET)
    session = FakeSession(FakeResponse(200))
    assert hook.trigger_site_revalidation(session=session) is False
    assert session.calls == []


def test_allows_http_localhost(monkeypatch):
    monkeypatch.setenv("REVALIDATE_URL", "http://localhost:3000/api/revalidate")
    monkeypatch.setenv("REVALIDATE_SECRET", SECRET)
    assert hook.trigger_site_revalidation(session=FakeSession(FakeResponse(200))) is True


def test_never_logs_the_secret(configured, caplog):
    caplog.set_level(logging.DEBUG)
    for response in (FakeResponse(200), FakeResponse(401), FakeResponse(308, {"location": "https://x"})):
        hook.trigger_site_revalidation(session=FakeSession(response))
    hook.trigger_site_revalidation(session=FakeSession(exc=requests.Timeout("slow")))
    assert SECRET not in caplog.text


@pytest.mark.parametrize(
    "rate_stored,prices_ok,updated_count,expected",
    [
        (False, True, 0, False),
        (True, True, 0, True),
        (False, True, 3, True),
        (True, False, 5, False),
    ],
)
def test_should_revalidate_site(rate_stored, prices_ok, updated_count, expected):
    assert hook.should_revalidate_site(rate_stored, prices_ok, updated_count) is expected
```

### 10. `tests/test_main.py` (update)

Append:

```python
class TestRunJobsOnce:
    """main.run_jobs_once calls the site revalidation hook only after a run that wrote data."""

    def test_revalidates_after_a_run_that_updated_prices(self):
        import main
        with patch("main.fetch_and_store_exchange_rate", return_value=False), \
             patch("main.update_prices", return_value=4), \
             patch("main.trigger_site_revalidation") as trigger:
            main.run_jobs_once()
        trigger.assert_called_once_with()

    def test_revalidates_after_only_a_new_exchange_rate(self):
        import main
        with patch("main.fetch_and_store_exchange_rate", return_value=True), \
             patch("main.update_prices", return_value=0), \
             patch("main.trigger_site_revalidation") as trigger:
            main.run_jobs_once()
        trigger.assert_called_once_with()

    def test_skips_when_nothing_was_written(self):
        import main
        with patch("main.fetch_and_store_exchange_rate", return_value=False), \
             patch("main.update_prices", return_value=0), \
             patch("main.trigger_site_revalidation") as trigger:
            main.run_jobs_once()
        trigger.assert_not_called()

    def test_skips_and_does_not_raise_when_update_prices_fails(self):
        import main
        with patch("main.fetch_and_store_exchange_rate", return_value=True), \
             patch("main.update_prices", side_effect=RuntimeError("chrome died")), \
             patch("main.trigger_site_revalidation") as trigger:
            main.run_jobs_once()
        trigger.assert_not_called()

    def test_a_raising_hook_does_not_fail_the_run(self):
        import main
        with patch("main.fetch_and_store_exchange_rate", return_value=True), \
             patch("main.update_prices", return_value=1), \
             patch("main.trigger_site_revalidation", side_effect=RuntimeError("boom")):
            main.run_jobs_once()   # must not raise
```

### 11. `frontend/app/components/__tests__/IntentLink.test.tsx` (new, jsdom, fake timers)

```ts
const mockPrefetch = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: mockPrefetch, push: jest.fn(), replace: jest.fn() }),
}));
```

`jest.useFakeTimers()`; in `beforeEach` call `jest.clearAllMocks()` and `resetIntentPrefetchForTests()`. Render `<IntentLink href="/product/7" className="card" data-anchor-link="">Seven</IntentLink>` with `@testing-library/react` and get the anchor with `screen.getByRole("link", { name: "Seven" })`. Cases:
- renders an `<a>` with `href="/product/7"`, the children, `className="card"` and the `data-anchor-link` attribute; rendering alone calls `mockPrefetch` 0 times;
- `fireEvent.mouseEnter`, advance 79 ms: no prefetch; advance 1 ms more: `mockPrefetch` called once with `"/product/7"`;
- `fireEvent.mouseEnter`, advance 40 ms, `fireEvent.mouseLeave`, advance 200 ms: no prefetch;
- `fireEvent.focus` prefetches immediately; `fireEvent.pointerDown` prefetches immediately (separate cases, each after the reset);
- after one prefetch, another `mouseEnter` plus 200 ms, a `focus` and a `pointerDown` call nothing more (still 1 call);
- a caller's own `onMouseEnter` passed as a prop still runs.

Wrap timer advances in `act(() => { jest.advanceTimersByTime(n); })`.

### 12. Existing tests that render an `IntentLink` (update)

`IntentLink` calls `useRouter()`. Any existing test that renders `ProductCard`, `ProductPrices`, `RecentlyReleased`, the home page or the product page now needs `next/navigation` mocked with a `useRouter` that has `prefetch`. Find them by running `pnpm test --ci` after step 13: every failure that mentions `invariant expected app router to be mounted`, `useRouter is not a function` or a thrown `useRouter` mock is one of them. Known ones from earlier packages: WP07's `app/components/ProductPrices/__tests__/ProductCard.format.test.tsx`, WP09's `ProductCard.history.test.tsx`, and WP08's two `ProductPrices` tests that mock `next/navigation`.

- A file with no `next/navigation` mock: add, next to its other `jest.mock` calls,

```ts
jest.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));
```

- A file that already mocks `next/navigation` with only `useSearchParams`: add the same `useRouter` key to its existing factory. Never add a second `jest.mock("next/navigation", ...)` to one file.
- WP08's URL-sync test, whose `useRouter` mock throws "ProductPrices must not use the App Router for URL sync": keep the test's intent and move the throw to the navigation methods:

```ts
  useRouter: () => ({
    prefetch: jest.fn(),
    push: () => {
      throw new Error("ProductPrices must not use the App Router for URL sync");
    },
    replace: () => {
      throw new Error("ProductPrices must not use the App Router for URL sync");
    },
  }),
```

- A test whose `next/link` mock spreads every prop onto an `<a>` would now pass `prefetch={false}` to the DOM, and React logs a warning. Drop `prefetch` in that mock (`({ children, href, prefetch: _prefetch, ...rest }) => ...`).

Change nothing else in these files. List each file you changed in the PR.

### 13. `frontend/app/components/ProductPrices/__tests__/ProductCard.prefetch.test.tsx` (new, jsdom)

Copy `makeProduct`, `baseProps`, the two heavy-child mocks and any `IntersectionObserver` stub from `ProductCard.format.test.tsx` (WP07, as updated by WP09), and use the `mockPrefetch` mock from test 11. Call `resetIntentPrefetchForTests()` in `beforeEach`. Cases:
- rendering a flat card (`viewMode="flat"`) for product 1 calls `mockPrefetch` 0 times;
- `fireEvent.focus` on the first `a[href="/product/1"]` calls `mockPrefetch` once with `"/product/1"`; focusing the card's other `a[href="/product/1"]` (the flat card has two: the image and the set name) adds no call.

### Existing tests that must pass

Unchanged except for the `next/navigation` mocks of test 12: `serverMarketData.freshness.test.ts`, `clientMarketData.cache.test.ts`, `useProductData.test.tsx`, WP05's portfolio route and repo tests (they mock `getCachedMarketProductSummaries`), WP06's `BoxCalculator` tests, `rateLimit.test.ts`, and `tests/test_main.py`'s existing classes.

## Verification

Run from `frontend/`:

```bash
pnpm install --frozen-lockfile

pnpm exec tsc --noEmit
# expect: exit 0, no output

pnpm exec eslint app/lib/cacheTags.ts app/lib/catalogProjection.ts app/lib/serverMarketData.ts \
  app/lib/exchangeRate.ts app/lib/clientMarketData.ts app/api/revalidate "app/product/[id]/page.tsx" \
  app/compare app/box-calculator app/components/BoxCalculator app/prices/page.tsx app/market/page.tsx \
  app/components/ProductPrices/types/index.ts app/components/ProductPrices/hooks/useVolumeMetrics.ts \
  app/components/ProductPrices/index.tsx app/components/MarketView/MarketView.tsx \
  app/components/dashboard/RecentlyReleased.tsx app/components/IntentLink.tsx \
  app/components/ProductPrices/cards/ProductCard.tsx app/page.tsx app/components/Footer.tsx \
  app/components/Header.tsx next.config.ts 2>&1 | tail -2
# expect: error count no higher than the baseline recorded in "Before you start";
# 0 errors in cacheTags.ts, catalogProjection.ts, exchangeRate.ts, app/api/revalidate,
# app/compare, app/box-calculator, boosterPackData.ts, IntentLink.tsx.

pnpm test --ci app/api/revalidate app/lib/__tests__/serverMarketData app/lib/__tests__/exchangeRate \
  app/lib/__tests__/catalogProjection app/lib/__tests__/clientMarketData app/components/BoxCalculator \
  app/compare app/components/MarketView app/components/ProductPrices \
  app/components/__tests__/IntentLink.test.tsx
# expect: all pass

pnpm test --ci
# expect: the full suite passes

# Static checks. Each expects the stated output.
grep -rn "revalidate: 3600" app                          # no output
grep -rn "unstable_cache(" app --include=*.ts | grep -v __tests__ | wc -l
# expect 5 (exchange rate, summaries, volume, set analytics, product-detail rows)
grep -n "revalidateTag(" app/api/revalidate/route.ts     # one call, with "max"
grep -rn "fetchMarketProductsClient\|fetchLatestExchangeRateClient" app/compare app/box-calculator | grep -v __tests__
# expect: only app/compare/CompareDashboard.tsx (the import lines and the fallback effect)
grep -rn -B3 'href={`/product/' app --include=*.tsx | grep -v __tests__ | grep "<Link"
# expect no output: every internal product link is an IntentLink
grep -c "prefetch={false}" app/components/Header.tsx     # 4
[ "$(grep -c 'prefetch={false}' app/components/Footer.tsx)" = "$(grep -c '<Link' app/components/Footer.tsx)" ] && echo footer-ok
# expect: footer-ok
grep -n "staleTimes" next.config.ts                      # 1 line if step 13e was done

pnpm build:stub
# expect: exit 0. In the route table:
#   /, /prices, /market, /stats, /analytics, /compare, /box-calculator: static (○) with Revalidate 1d
#   /product/[id]: ● (SSG) or ○ with Revalidate 1d, NOT ƒ (Dynamic)
#   /api/revalidate: ƒ (Dynamic)
# (WP00's note that these pages show "Revalidate 1h" is superseded by this PR.)
```

From the repo root, in a virtualenv with `requirements.txt` and `pytest` installed:

```bash
python -m pytest tests/test_revalidate_hook.py tests/test_main.py -q
# expect: all pass
python -m pytest tests/ -q
# expect: all pass
```

Manual checks (local, no production access needed):

1. Route against the dev server with the WP00 stub. Terminal 1: `node scripts/supabase-stub.mjs`. Terminal 2: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_KEY=stub REVALIDATE_SECRET=$(printf 'a%.0s' {1..40}) pnpm dev`. Terminal 3:
   - `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/revalidate` prints `401`.
   - `curl -s -X POST -H "x-revalidate-secret: $(printf 'a%.0s' {1..40})" http://localhost:3000/api/revalidate` prints `{"revalidated":["market-products","set-analytics","exchange-rate"],"at":"..."}`.
   - `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/revalidate` (GET) prints `405`.
   - Restart terminal 2 without `REVALIDATE_SECRET`: the authenticated POST prints `503`.
2. Python hook against the same dev server (from the repo root): `REVALIDATE_URL=http://localhost:3000/api/revalidate REVALIDATE_SECRET=$(printf 'a%.0s' {1..40}) python -c "import logging; logging.basicConfig(level=logging.INFO); import revalidate_hook as h; print(h.trigger_site_revalidation())"` prints `True`, and the dev server logs `POST /api/revalidate 200`.
3. `/compare` and `/box-calculator` still work with the stub: both pages load; because the stub returns no products, the browser falls back to its own fetch (the stub terminal logs a `POST /rest/v1/rpc/get_market_product_summaries`). With real data (after deploy) that request must be absent; see Owner actions.
4. Step 13 cannot be checked against the stub: its catalog is empty, so `/prices` has no product links. The prefetch check is Owner actions step 2. Locally, confirm only that `/` and `/prices` render without a console error about the App Router.

## Owner actions

Do these in this order. If steps 1, 3 and 4 are skipped, the site still works but refreshes at most once a day. Step 2 is the pre-merge check for step 13.

1. **Before merging: set the secret in Vercel.** Generate it locally with `openssl rand -hex 32`. Vercel dashboard, project, Settings, Environment Variables: add `REVALIDATE_SECRET` with that value for the **Production** environment only (preview deployments then answer 503, which is intended). It must not start with `NEXT_PUBLIC_`. Confirm: the variable is listed for Production.
2. **Before merging: prefetch check (step 13).** Use the PR's Vercel preview deployment (it reads the same public Supabase data; the missing `REVALIDATE_SECRET` there does not matter). If previews have no Supabase variables, run `pnpm build && pnpm start` locally with the production `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_KEY` (the public anon key) in `frontend/.env.local`. Do not use `pnpm dev`: Next does not prefetch in development. In Chrome DevTools, Network tab, filter `_rsc`, open `/prices`, clear the log, then scroll from top to bottom at reading speed. Expect: 0 requests to `/product/...` while scrolling; when the pointer rests on a card for more than 80 ms, exactly one request for that card's product, and none again for the same card. Tab to a product link: one request for that product. Scroll to the footer: no `_rsc` request for any footer route or for `/auth/login` and `/auth/signup`. Paste the counts into the PR. Any product request during the scroll means a product link is still a plain `<Link>`: run the `<Link` grep from Verification.
3. **Merge and let Vercel deploy.** The deploy picks up the new variable. Confirm with the canonical host (check which one serves without a redirect first: `curl -sI https://pokefin.ca/ | head -1` and `curl -sI https://www.pokefin.ca/ | head -1`; use the one that answers 200):
   - `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<canonical-host>/api/revalidate` prints `401`.
   - `curl -s -X POST -H "x-revalidate-secret: <secret>" https://<canonical-host>/api/revalidate` prints JSON with `"revalidated":["market-products","set-analytics","exchange-rate"]`.
4. **Configure the scraper host.** Append to `~/.config/pokefin/env` (the file `run_scraper.sh` sources; keep `chmod 600`):
   ```
   REVALIDATE_URL=https://<canonical-host>/api/revalidate
   REVALIDATE_SECRET=<the same secret>
   ```
   Confirm after the next scheduled run: `grep -E "Site caches revalidated|Site revalidation" <repo>/scraper.log | tail -3` shows `Site caches revalidated.` (or "not needed" for a run that wrote nothing). A line with `HTTP 30x` means the URL uses the redirecting host; switch to the canonical one.
5. **Confirm ISR on product pages.** `curl -sI https://<canonical-host>/product/<any id> | grep -iE "x-vercel-cache|cache-control"` twice: the second response shows `x-vercel-cache: HIT` (or `STALE`), and `cache-control` is not `private, no-cache, no-store`.
6. **Confirm the tools no longer call the RPC from the browser.** Open `/compare` and `/box-calculator` with DevTools, Network tab, filter `supabase.co`: no request to `rpc/get_market_product_summaries` and none to `exchange_rates` (both pages receive the server-cached rate unless the server only had the 1.36 fallback). The set picker in the box calculator is populated as soon as the page hydrates. If `/compare` still requests the summaries, check that the production catalog is not empty and that `CompareDashboard` gates on `initialMarketProducts === undefined`.
7. **Confirm the database load drop after 48 hours.** Supabase dashboard, Logs, API (edge) logs, filter on path `rpc/get_market_product_summaries`, group by day: server-originated calls per day fall from 370 to 670 to under 100, and the `canceling statement due to statement timeout` count in Postgres logs trends to zero (WP10 bounds the RPC itself).
8. **Optional: confirm a single function region.** Vercel, Settings, Functions, Function Region: exactly one region selected. Several regions each keep their own Data Cache and multiply cold misses.
9. **Optional: measure F068.** Compare before and after deploy: `curl -s -H 'Accept-Encoding: br' -o /dev/null -w '%{size_download}\n' https://<canonical-host>/prices` should be about 20 KB smaller.

## Acceptance criteria

- [ ] `grep -rn "revalidate: 3600" frontend/app` returns nothing; all five `unstable_cache` calls use 86400 and a tag from `CACHE_TAGS`.
- [ ] No cached callback in `serverMarketData.ts` calls another cached function (`serverMarketData.cache.test.ts` "never nested" cases pass).
- [ ] A failed exchange-rate, volume, product price-history or product sales-history read is not cached; a missing sales table still degrades to an empty sales history (tests pass, including the two N04 cases).
- [ ] `POST /api/revalidate` returns 503 without a configured secret, 401 with a wrong or missing header, 200 with the right one, and calls `revalidateTag(tag, "max")` for exactly `market-products`, `set-analytics`, `exchange-rate`.
- [ ] `/product/[id]` exports `revalidate = 86400` and a `generateStaticParams` returning `[]`; `pnpm build:stub` does not list it as ƒ.
- [ ] `/compare` and `/box-calculator` are server components that pass initial data; `CompareDashboard` fetches the catalog only when `initialMarketProducts` is `undefined` (an empty map does not refetch), and `useBoosterPackPrices` fetches only when the server data is absent or has no sets.
- [ ] The 367-day fallback history is requested newest first; `fetchNewestPricedAt` still oldest first.
- [ ] `fetchLatestExchangeRateClient` re-fetches after 1 hour and never caches the 1.36 fallback.
- [ ] `/prices` and `/market` pass projected products (no `sku`, `sets.id`, `generation_id`, `generations.id`; `price_recorded_at` only for unpriced products; returns rounded to 2 dp) and two-field volume metrics.
- [ ] `main.py` calls `trigger_site_revalidation` once per run that wrote data, never when `update_prices` raised, and a hook failure never fails the run.
- [ ] `pnpm exec tsc --noEmit`, `pnpm test --ci`, `pnpm build:stub` and `python -m pytest tests/ -q` pass; lint errors in touched files do not exceed the baseline.
- [ ] `REVALIDATE_SECRET` is documented in `frontend/.env.example`; `REVALIDATE_URL` and `REVALIDATE_SECRET` in `README.md` and `run_scraper.sh`.
- [ ] `app/components/IntentLink.tsx` exists with the step 13a code; every internal product link (`ProductCard`, `MoverCard`, product-page siblings, and any other `` href={`/product/ `` hit) is an `IntentLink` (the Verification `<Link` grep prints nothing); `IntentLink.test.tsx` and `ProductCard.prefetch.test.tsx` pass.
- [ ] Every `<Link` in `Footer.tsx` and the four `/auth/*` links in `Header.tsx` have `prefetch={false}`; no other header link changed.
- [ ] Owner actions step 2 done on a production build: scrolling `/prices` issues 0 product `_rsc` prefetches until a pointer rests on a card; the counts are in the PR.
- [ ] The PR states whether `experimental.staleTimes.static = 1800` (step 13e) was added.

## Rollback

No migrations. Revert the merge commit (`git revert -m 1 <merge-sha>`) and deploy. Pages return to hourly caches immediately; product pages become dynamic again. The `product-detail-rows` Data Cache entries are simply never read again. After the revert, the scraper's hook gets 404 from the removed route and logs `Site revalidation failed: HTTP 404` without failing the run; remove `REVALIDATE_URL` from `~/.config/pokefin/env` to silence it. The `REVALIDATE_SECRET` variable in Vercel is harmless if left; delete it for tidiness. If only the Python side misbehaves, removing `REVALIDATE_URL` on the scraper host disables the hook without a deploy. If only step 13 misbehaves (for example a product link that does not navigate), revert the `IntentLink` swaps to `<Link>` in a follow-up PR only together with reverting step 7, because ISR product pages with default `<Link>` prefetch bring back the 306-page prefetch; removing `staleTimes` from `next.config.ts` is safe on its own.

## Commit and PR

Commit message:

```
perf(cache): scrape-triggered revalidation, product ISR, server-fed tools

- Fix nested unstable_cache: product detail and the set-analytics fallback
  read the summaries cache instead of re-running the RPC on every miss
- POST /api/revalidate (secret header, revalidateTag "max"); main.py calls it
  after runs that wrote data; caches move to a daily backstop
- Failed exchange-rate, volume and history reads are no longer cached
- /product/[id] is ISR (revalidate 86400, generateStaticParams [])
- /compare and /box-calculator receive server-cached data
- Fallback price history is paged newest first
- Client exchange-rate cache gets a 1h TTL and never caches the fallback
- /prices and /market send projected products and two-field volume metrics
- Product links prefetch on intent only (IntentLink); footer and auth links
  never prefetch; client staleTimes.static 1800 (if done)

Review findings: F151, F123, F147, F143, F068; F146 and F150 in part (see PR body)
Track 2: PX06 (01-PRODUCT-DIRECTION.md section 9 item 1)
```

PR title: `perf(cache): scrape-triggered revalidation, product ISR, server-fed tools (WP11)`

PR body summary: what was wrong (hourly clock on data that changes daily; a nested `unstable_cache` that bypassed the summaries cache on every product-page miss, the likely source of ~300 RPC calls an hour; dynamic product pages; two tools running the heavy RPC per browser; oldest-first fallback truncation; a never-expiring client rate; oversized RSC props); what changed, step by step; the step 13 prefetch counts from Owner actions step 2 and the list of test files whose `next/navigation` mock was extended (test 12); the decisions and why (`"max"` not `{ expire: 0 }`; product links prefetch on intent because ISR product pages would otherwise be prefetched on viewport entry; a 24-hour backstop, not 6 hours, because the scraper hook covers normal freshness; throw inside caches, degrade outside; keep a narrower per-product cache; keep `price_recorded_at` for unpriced products because of WP07's StalePriceNote, correcting the F068 verifier); the Owner actions checklist verbatim (secret in Vercel before merge, scraper env after deploy, the curl checks); test and build output pasted from Verification; follow-ups not done here: the `/portfolio` search still uses the client summaries fetch (WP05 decision) and `/portfolio` still reads the exchange rate in the browser (now with a 1 hour TTL; F150 partial); a page left open keeps the rate it mounted with until the next mount or navigation (F150; a `visibilitychange` refresh in `useCurrencyConversion.ts` would close it); F146's `get_latest_prices` RPC (filter on `active` only when no ids are passed) and a per-product anchor RPC for the about 50 serial history pages on the fallback path are not scheduled by any package (they need a migration); the fallback catalog (6M and 1Y null, set 365-day drawdown and trend over about five months) is now cached until the next scrape instead of an hour; unknown product ids are cached as ISR 404s and day counts on product pages can read one day low for a few hours after UTC midnight (F147 side effects); `ExchangeRateService.ts` is unused; and the compare page's own `DEFAULT_EXCHANGE_RATE = 1.35` differs from `1.36` (WP20).
