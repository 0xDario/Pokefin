# Performance excellence: from "fixed" to fastest in the niche

Date: 2026-09-30. Scope: what Pokéfin needs beyond WP00 to WP21 to be the fastest site in its niche on a mid-range phone on Canadian LTE, without a framework change or new paid services. Read against HEAD plus the WP00 to WP21 specs (in particular WP08, WP09, WP11, WP12, WP13, WP17), the 2026-09-25 review, and the sibling research files `competitive-landscape.md`, `data-opportunities.md` and `ui-audit.md`.

**Method.**
- Production measured directly. `https://www.pokefin.ca/prices` HTML and response headers, the site stylesheet, and 7 of the 15 initial script chunks were fetched through the Vercel connector on 2026-09-30. The other 8 chunk fetches failed in the connector, so the per-route JS total below is partly an estimate.
- Supabase project region read from the Supabase connector (read-only).
- Next.js behaviour checked against the docs bundled with the installed Next 16.3.6 (`frontend/node_modules/next/dist/docs/`), not from memory: prefetching, optimizing-prefetching, offline-support, view-transitions, preserving-ui-state, reactCompiler, turbopackRustReactCompiler, inlineCss, staleTimes, useOffline.
- Vercel caching behaviour for external rewrites checked in the Vercel docs.
- Not available: PageSpeed Insights (the unauthenticated API returned 429), Speed Insights data (the observability query API returned "Observability Data not found", probably a plan limit), and a local build (not run, per instructions). Every number marked "est." is an estimate with the reasoning shown. Section 17 lists the commands that replace each estimate with a measurement.

**Writing convention.** "gz" means gzip -9 (the unit WP12's analysis script uses, and a conservative stand-in for the brotli that Vercel actually serves). "Mid phone" means the Lighthouse mobile preset: Moto G Power class, 4x CPU slowdown, simulated slow 4G.

---

## 1. Top conclusions

1. **The plan fixes the worst defects, but it leaves the data-delivery model client-heavy.** After WP09 and WP12, `/`, `/prices` and `/market` still load the 66 kB gz supabase-js chunk right after hydration, because the first visible cards ask for price history immediately. They also still pull 365-day history rows through PostgREST in 15 to 30 batched requests per full scroll, just to draw 96x40 px lines. The biggest win left is **server-baked sparklines**: one SQL function returns a 32-point, 6-bit-encoded series per product (about 10 kB br for all 306 products). The series goes into the page payload for the default period and into a CDN-cached route for the other periods. That puts sparklines in the first paint (no pop-in), removes every history request during scroll, and lets the browser drop supabase-js entirely.
2. **WP11 plus default `<Link>` behaviour creates a prefetch storm.** Next 16 (without Cache Components) prefetches static routes in full as each link enters the viewport. WP11 makes `/product/[id]` ISR, which is static. After WP11, scrolling `/prices` prefetches up to 306 product pages, and each cold one is an ISR render with several Supabase queries. WP13 explicitly deferred prefetch tuning. An intent-only product link (hover, focus, pointerdown) must ship in the same release as WP11, or before it.
3. **Images are the largest remaining LCP lever, and they bypass every cache.** The owner verified that Supabase Storage on the free plan serves `cache-control: no-cache`. So every image view is a round trip to Ohio (us-east-2), on a separate origin that needs its own DNS and TLS handshake. The fix is to serve images same-origin through a Vercel external rewrite with CDN caching enabled (`x-vercel-enable-rewrite-caching: 1`), at content-hashed paths, with 4 scraper-made WebP widths and a custom `next/image` loader for real `srcset`. That uses zero Vercel image-optimization quota. Estimated gains: the product-page hero goes from about 91 kB to about 30 kB on a 2x screen, first-image connection setup drops by 100 to 300 ms, and repeat views make no image requests at all.
4. **Enforce budgets in CI with a byte-exact budget script, and use Lighthouse CI for CLS and trends.** Byte budgets (JS per route, CSS, HTML plus RSC payload, fonts, requests) are deterministic, so they can block. Lighthouse timing metrics on GitHub runners vary by 20 to 30%, so they warn. Both need a realistic synthetic fixture: 306 products, about 55 sets, 365 days of history for the product pages, and set analytics. The fixture should be served by an extension of WP00's stub, deterministic by seed and calibrated against production byte sizes. Today's fixture has 2 products, which makes budgets meaningless.
5. **Core Web Vitals targets (p75, mobile, Canada):** LCP at or under 1.8 s on catalog and product routes, INP at or under 150 ms everywhere (100 ms on `/prices` filters), CLS at or under 0.05 (0.02 on `/prices`). All are reachable with WP08 to WP12 plus this document. Section 3 has the table.
6. **Hydration and toggles are the INP risk after the plan.** Hydrating 306 client cards is one long task (est. 150 to 300 ms on a mid phone), and currency and period toggles re-render every card synchronously. Two cheap fixes: split the grid into `<Suspense>` boundaries (per set group, or per 24 cards) so React hydrates in interruptible slices, and move toggles into `startTransition` so the button's pressed state paints in the next frame.
7. **The React Compiler is ready to turn on once WP17 to WP19 land.** Lint already runs the compiler-derived hook rules, WP17 makes them zero-error and blocking, and the compiler silently skips any component that breaks them. So "lint-clean" is the same thing as "compiler coverage is maximal". Use `reactCompiler: true` with the stable Babel plugin. Try the experimental Rust port (`experimental.turbopackRustReactCompiler`, new in 16.3) on a preview only. Measure INP on `/market` sort and `/compare` input before and after.
8. **The offline shell for card shows is small and worth building.** Pieces: a manifest and icon set; a hand-written service worker of about 150 lines with navigation preload, so online TTFB does not regress; a CDN-cached public catalog JSON of about 15 kB br; and an `/offline` search page that shows last-synced prices with an "as of" date. Offline prices apply the same 14-day rule as migration 0023, so offline mode never shows a price the server would withhold. Next's `experimental.useOffline` retries soft navigations. It is experimental, so it goes in the last phase.
9. **Quick wins that cost under a day in total:**
   - Drop Geist Mono: it is used only for 4 set-code labels, and dropping it saves one font download.
   - Replace the 31 kB `favicon.ico`, which is really a 512x512 PNG.
   - Load Sentry lazily in `error.tsx` and `global-error.tsx`: both statically import `@sentry/nextjs` on every route, and WP17 left them as they are.
   - Use 16 px inputs on phones: the `text-sm` search boxes trigger iOS focus zoom today.
   - Set `prefetch={false}` on footer and auth links.
   - Move the Vercel function region to `cle1`, next to Supabase us-east-2.
   - Confirm that the apex-to-www hop is a single cacheable 308.
10. **Real-user monitoring.** Speed Insights is installed but unconfigured. Set a `sampleRate`, and strip query strings in `beforeSend`. Add a weekly GitHub Actions job that reads p75 per route with `vercel metrics` and opens an issue on a breach, with a minimum sample count so a low-traffic week does not raise false alarms. If the Hobby plan does not expose metrics to the CLI, the fallback is a sampled `useReportWebVitals` beacon into a Supabase table, reported in the weekly email the pipeline already sends.
11. **Cache Components is the next architecture step, not part of this track.** It would give back-navigation from a product page to `/prices` with DOM and scroll kept (Activity), one prefetched App Shell per route instead of one per link, and prefetches refreshed by `revalidateTag`. It conflicts with WP11's `unstable_cache` and segment-config design, so it gets a time-boxed spike after WP21, not a work package.

---

## 2. Baseline: what production ships today

Measured on `https://www.pokefin.ca/prices`, 2026-09-30, `x-vercel-cache: HIT`, `x-nextjs-prerender: 1`:

| Item | Value | Notes |
|---|---|---|
| HTML document | 356,419 B raw, 48.0 kB gz | 345 kB of it is inline RSC flight data (the full catalog). The body still contains "Loading…", because WP08 has not landed. |
| Flight payload fields | 306 × `image_url`, `usd_price`, `price_recorded_at` | `price_recorded_at` is still shipped (WP11 step 11 removes it). |
| Initial scripts | 15 `<script src>` | 7 measured (below). |
| supabase-js chunk | 251,921 B raw, 66.1 kB gz | Contains GoTrueClient and RealtimeClient. Matches the review's 64.6 kB. |
| react-dom chunk | 234,834 B raw, 73.4 kB gz | Fixed cost of the framework. |
| Layout chunk (Header, Footer, AuthContext, Analytics, SpeedInsights shims, Link) | about 30 kB raw | The AuthContext still imports `lib/supabase` (WP04 fixes this). |
| `error.tsx` and `global-error.tsx` chunks | under 1 kB each | Both import module 6872 (`@sentry/nextjs`). The chunk that contains it was not retrievable. Cost est. 10 to 40 kB gz, to be measured. |
| Stylesheet | 51,962 B raw, 10.9 kB gz | One file for all routes. 13 Geist `@font-face` blocks with `unicode-range`, plus a metric-adjusted Arial fallback. |
| Fonts | Geist latin woff2, preloaded | Geist Mono is not preloaded (correct). It is still downloaded on `/`, `/prices`, `/stats` and `/product/[id]` for set codes. |
| favicon | 31,682 B | A 512x512 PNG named `.ico` (WP13 notes this). |
| HTML caching | `public, max-age=0, must-revalidate`, CDN HIT, `x-nextjs-stale-time: 300` | Correct for ISR. |
| Images | `https://<ref>.supabase.co/storage/v1/object/public/product-images/...` | Separate origin, `no-cache` on the free plan (per `main.py:85-91`), `unoptimized`, 256 px thumbnails or the 743x1000 original (about 91 kB). |
| Supabase region | us-east-2 (Ohio) | Vercel functions default to `iad1`. `cle1` (Cleveland) is co-located with it. |
| Host | Production serves `www.pokefin.ca`. The apex redirected with a 307 in the connector fetch. | The connector adds a share parameter, so confirm the status with a plain `curl -sI https://pokefin.ca/`. It should be exactly one 308. |

Expected state after the plan, per the specs:
- WP08 puts cards in the HTML.
- WP11 slims the flight to about 16.9 kB br and makes product pages ISR.
- WP12 moves supabase-js off the hydration path and fixes the hero LCP.
- WP09 replaces Recharts sparklines with SVG and batches history.

**Estimated JS floor after WP04 plus WP12:** the review measured supabase-js at about 31% of the `/privacy` JS floor, which puts that floor at about 208 kB gz today. Removing supabase-js leaves about 143 kB gz (est.). Of that, react-dom (73 kB) plus the Next runtime, router and Turbopack loader make up the irreducible part. Header, auth and Sentry make up the rest.

---

## 3. Core Web Vitals targets per route

Targets are p75, mobile, Canadian visitors, measured by Speed Insights (RUM). Google's "good" thresholds are LCP 2.5 s, INP 200 ms and CLS 0.1. Targets sit well inside them, because a finance tool competes on feel.

| Route | Rendering after plan | LCP | INP | CLS | TTFB | Likely LCP element | What gets it there |
|---|---|---|---|---|---|---|---|
| `/` | ISR, CDN | ≤ 1.8 s | ≤ 150 ms | ≤ 0.05 | ≤ 400 ms | Hero heading or first Recently Released image | WP12, baked sparklines (no pop-in), first-row eager images |
| `/prices` | ISR, CDN, cards in HTML (WP08) | ≤ 1.8 s | ≤ 100 ms filters, ≤ 150 ms toggles | ≤ 0.02 | ≤ 400 ms | First card image or H1 | WP08, WP09, baked sparklines, first image `fetchPriority="high"`, Suspense-chunked hydration, transitions |
| `/market` | ISR, CDN | ≤ 2.0 s | ≤ 150 ms sort | ≤ 0.05 | ≤ 400 ms | Table header block | WP19, baked sparklines, compiler, transitions |
| `/product/[id]` | ISR (WP11) | ≤ 1.8 s | ≤ 150 ms | ≤ 0.05 | ≤ 400 ms warm, ≤ 900 ms cold | Hero image | WP12 hero priority, `srcset` hero (about 30 kB), same-origin image, intent prefetch |
| `/analytics`, `/stats` | ISR, CDN | ≤ 1.8 s | ≤ 150 ms | ≤ 0.05 | ≤ 400 ms | Heading or table | Charts lazy below the fold |
| `/compare`, `/box-calculator` | ISR, server-fed (WP11) | ≤ 2.0 s | ≤ 150 ms typing | ≤ 0.05 | ≤ 400 ms | Heading | WP18, `useDeferredValue`, compiler |
| `/portfolio`, `/account` | Dynamic, auth | ≤ 2.5 s | ≤ 200 ms | ≤ 0.05 | ≤ 900 ms | Summary card | WP05 route handlers, `cle1` region |
| `/auth/*`, `/privacy` | Static | ≤ 1.5 s | ≤ 100 ms | ≤ 0.02 | ≤ 400 ms | Heading | Floor JS only; Turnstile only on auth |

Rules that go with the table:
- A route "meets" a target only with at least 200 page views in the 28-day window. Below that, report "insufficient data" instead of passing or failing.
- TTFB for ISR routes assumes a CDN HIT. The cold-render number applies to the first visit after a deploy or a scrape revalidation (section 7.5 covers warming).

---

## 4. Performance budget

Budgets are enforced in CI (section 5) against the perf fixture. Unless a row says brotli, JS and payload sizes are gzip -9 sums of the `<script src>` files and inline flight data in the route's HTML, the same method as WP12's analysis script. "Route-specific" means initial JS minus the shared layout floor.

| Budget | Limit | Current (est.) | Source of the drop |
|---|---|---|---|
| Shared floor, initial JS (layout + framework) | ≤ 125 kB gz | about 208 today, about 143 after WP12 | WP04, WP12, lazy Sentry in error boundaries (PX03) |
| `/privacy`, `/auth/*` initial JS | ≤ 130 kB gz | floor | |
| `/` initial JS | ≤ 150 kB gz | unknown | baked sparklines remove the client data layer |
| `/prices` initial JS | ≤ 155 kB gz | about 230 (WP08 figure) | WP09, WP12, PX04 |
| `/market` initial JS | ≤ 165 kB gz | unknown | WP19, PX04 |
| `/product/[id]` initial JS | ≤ 145 kB gz | unknown | Recharts stays lazy (≤ 120 kB gz lazy chunk budget) |
| `/compare`, `/box-calculator` initial JS | ≤ 170 kB gz | unknown | WP11, WP18 |
| `/portfolio` initial JS | ≤ 180 kB gz | unknown | |
| Any lazy chunk | ≤ 120 kB gz, and flagged if it grows by more than 5% | Recharts is 118 | optional chart diet (section 10.6) |
| CSS (all routes, one file) | ≤ 14 kB gz | 10.9 | Tailwind 4 purges; the budget catches regressions |
| Fonts on first view | 1 file (Geist latin), ≤ 35 kB | 1 preloaded plus Geist Mono on 4 routes | PX03 drops Mono |
| `/prices` document (HTML + inline flight), brotli | ≤ 70 kB br | 48 kB gz with an empty card body today; about 60 to 80 kB after WP08 puts 306 cards in the HTML | WP11 slimming, baked sparklines add about 10 kB |
| `/prices` inline flight only, brotli | ≤ 22 kB br | 36.8 today, 16.9 after WP11 | |
| Other catalog documents (`/`, `/market`) | ≤ 60 kB br | unknown | |
| `/product/[id]` document | ≤ 30 kB br | unknown | history for the chart: 365 points compact, not full rows |
| Above-the-fold image bytes, `/prices` mobile | ≤ 60 kB | 3 thumbnails of about 11 kB each (blurry on 3x screens) | `srcset` (section 10) |
| LCP image, `/product/[id]` | ≤ 40 kB on a 2x screen | about 91 kB original | `srcset` w480 WebP |
| Requests before LCP, catalog routes | ≤ 20, 0 cross-origin | about 18 plus supabase.co images | same-origin `/img` |
| Third-party script on public routes | 0 | Turnstile only on `/auth/*` | keep |
| Main-thread long tasks during `/prices` hydration (lab, 4x CPU) | no task over 100 ms, TBT ≤ 300 ms | est. 150 to 300 ms in one task | Suspense-chunked hydration |

How the budgets change:
- A PR that raises a limit edits `frontend/perf-budgets.json` and states the reason in the PR body. The CI job summary prints the before and after table so the reviewer sees the cost.
- Once a route has 2 weeks of green RUM, tighten its limit to the measured value plus 5%.

---

## 5. Enforcement in CI

### 5.1 Decision

Use two layers, both built on WP00's `build:stub` harness:

1. **Blocking: a deterministic byte-budget script** (`frontend/scripts/perf-budget.mjs`). It runs after the build against `next start` on the fixture. Reasons:
   - Byte counts do not vary between runs.
   - It takes seconds.
   - It covers dynamic routes (product, portfolio shell) as well as prerendered ones.
   - It measures exactly what WP08, WP09 and WP12 improved, so it protects those gains.
2. **Lighthouse CI** (`@lhci/cli`, pinned and run with `pnpm dlx`, so the lockfile does not change). The mobile preset runs 3 times per URL and uses the median. Blocking assertions cover only the stable metrics: CLS, `resource-summary` byte counts, the `bf-cache` audit, and `uses-responsive-images`. Timing metrics (LCP, TBT, Speed Index) are `warn` with wide margins and are printed in the job summary for trend reading.

Why not Lighthouse alone: simulated throttling (Lantern) helps, but TBT and LCP on shared GitHub runners still vary by roughly 20 to 30% from run to run. A blocking timing gate would be either flaky or so loose that it catches nothing. Why not bytes alone: CLS, bfcache eligibility and oversized images are behaviour, not bytes, and Lighthouse checks them cheaply.

Not used:
- Vercel preview plus an external Lighthouse. Previews are behind SSO (`ssoProtection: prod_deployment_urls_and_all_previews`). A protection-bypass secret would work, but it couples CI to deployment timing.
- Paid tools (Calibre, SpeedCurve, DebugBear). The owner prefers no new paid services.

### 5.2 A realistic fixture (`SUPABASE_STUB_FIXTURE=perf`)

WP08 added an opt-in `catalog` fixture with 2 products. Budgets need realistic cardinality and string lengths. Extend the same mechanism: `FIXTURES.perf` in `scripts/supabase-stub.mjs`, generated by a new `scripts/fixtures/perf.mjs`.

- **Synthetic and deterministic, not a production snapshot.** Byte budgets depend on counts and string lengths, not on real prices. A seeded PRNG (mulberry32, seed in the file) makes every run identical, and no scraped TCGPlayer data gets committed.
- **Calibrated to production.** Generate:
  - 306 products, 55 sets and 9 generations, with set-name lengths drawn from the real distribution;
  - 12 product types with real labels ("Elite Trainer Box", "Booster Bundle", and so on);
  - variants on 15% of products;
  - log-normal prices ($5 to $2,000) and returns for 1D to 1Y;
  - volume metrics for 80% of products;
  - `image_url` values in the production path shape;
  - timestamps rebased to "now" so the 0023 freshness gate (14 days) keeps them, plus 6 deliberately stale products so the gate's empty state is covered;
  - 365 daily history rows for products 900001 to 900003 (the product pages Lighthouse visits);
  - set-analytics rows for all 55 sets;
  - sparkline series for all products (section 7.1).
- **Endpoint coverage is enforced.** `build-with-stub.mjs` already prints every stub endpoint hit. A new `node --test` case (in `scripts/supabase-stub.test.mjs`) fails if a request made during a `perf` build reached the default empty response. So adding a query without a fixture turns CI red, not silently cheap.
- **Calibration check.** `perf-budgets.json` stores `calibration.pricesHtmlBytesProd`, measured once from production after WP08 and WP11 deploy. The budget script warns if the fixture's `/prices` HTML is more than 15% away from it. That keeps the fixture honest as the UI changes.
- **Images.** The stub serves `GET /storage/v1/object/public/product-images/**` from `scripts/fixtures/img/` using 5 committed noise-textured WebP files, one per derivative width, sized to realistic byte counts (made once with Pillow from gradient plus noise, about 120 kB in total). That way Lighthouse's image audits see real bytes, and no copyrighted product photos are committed.

### 5.3 Pipeline

In the existing required job, `Frontend (lint + typecheck + tests)`:

```text
SUPABASE_STUB_FIXTURE=perf pnpm build:stub      # replaces the plain build:stub step; same build gate
pnpm perf:serve &                               # stub (fixture=perf) + `next start -p 3100`
pnpm perf:budget                                # bytes: blocking
pnpm dlx @lhci/cli@<pinned> autorun             # CLS/bytes blocking, timings warn
```

- `perf:serve` is a small Node script that reuses `startSupabaseStub({ fixture: "perf" })` and spawns `next start` with the stub URL. It is needed because ISR and dynamic routes query at request time.
- `perf:budget`:
  - fetches each route's HTML from `:3100` (`/`, `/prices`, `/market`, `/analytics`, `/stats`, `/compare`, `/box-calculator`, `/privacy`, `/auth/login`, `/product/900001`);
  - extracts the `<script src>`, stylesheet and preload URLs;
  - reads the files from `.next/static`, and gzips and brotlis them;
  - measures the inline `self.__next_f.push` payload bytes;
  - separately scans `.next/static/chunks` for lazy chunks over 120 kB gz;
  - writes a Markdown table to `$GITHUB_STEP_SUMMARY`;
  - exits 1 on any budget breach.

  For `/portfolio` (the proxy redirects anonymous users), read its client reference manifest instead of fetching HTML.
- `lighthouserc.json`:
  - URLs: `/`, `/prices`, `/product/900001`, `/market`;
  - `numberOfRuns: 3`, default mobile preset;
  - assertions: `cumulative-layout-shift` ≤ 0.05 (error), `bf-cache` pass (error), `uses-responsive-images` (error after PX05), `resource-summary:script:size` and `resource-summary:image:size` per URL (error, mirroring the JSON budget), `largest-contentful-paint` ≤ 2500 (warn), `total-blocking-time` ≤ 300 (warn);
  - `upload.target: filesystem`, then `actions/upload-artifact` for the reports (no public temporary storage).
- Expected added CI time: about 3 to 4 minutes. The build already exists, so the additions are the Lighthouse runs (12 runs of about 12 s each) plus the server start.

### 5.4 Production confirmation, not a gate

After each production deploy, add a non-blocking GitHub job (`deployment_status` event, environment Production) that curls the same routes on `https://www.pokefin.ca`. It checks `x-vercel-cache` (expect HIT after a warm-up request) and the byte sizes, and appends them to the job summary. This catches differences between the local build and Vercel's build, which the review flagged as possible.

---

## 6. Real-user monitoring with Speed Insights

**Configuration** (`app/layout.tsx`):

```tsx
<SpeedInsights
  sampleRate={0.5}
  beforeSend={(e) => ({ ...e, url: e.url.split("?")[0] })}
/>
```

- Start `sampleRate` at 1.0 while traffic is low. Lower it only if the plan's monthly data-point allowance runs out (check the Usage tab). A Hobby allowance can be exhausted mid-month, which hides regressions.
- Strip query strings in `beforeSend`, because `/prices?q=` carries user search terms. Speed Insights already groups by the route pattern (the bundled client computes `route`, for example `/product/[id]`).

**How to read it:**
- Always filter Device = Mobile and Country = Canada. Desktop numbers flatter the site.
- Read the p75 per route for LCP, INP, CLS, FCP and TTFB against section 3.
- For each red metric, open its element attribution (LCP element, INP interaction target, CLS source) and file it with the route and element.
- Compare the 7 days before and after every WP that claims a load or interaction gain: WP08 (`/prices` LCP), WP09 (`/prices` INP), WP11 (TTFB), WP12 (`/product/[id]` LCP), and every PX package.

**Alerting.** Speed Insights has no alerting of its own on this plan. Add `.github/workflows/rum-weekly.yml`:
- Schedule: Monday 13:07 UTC.
- It runs `vercel metrics vercel.speed_insights.<metric>_ms --aggregation p75 --group-by route --since 7d --prod --project pokefin`, plus the matching `_count` metric (commands from Vercel's "accessing metrics with Vercel CLI" docs), with a `VERCEL_TOKEN` secret.
- It compares the p75 values to the thresholds in `perf-budgets.json`, then opens or updates one GitHub issue labelled `perf-regression` listing each route that breached a threshold with at least 200 samples.

Owner action: run `vercel metrics schema vercel.speed_insights` once. If the plan does not expose these metrics (the connector's query API returned "not found" for this project), use the fallback:

- **Fallback, self-hosted and free:**
  - `useReportWebVitals` (from `next/web-vitals`) in a small client component posts sampled metrics with `navigator.sendBeacon` to `POST /api/vitals`.
  - That route handler validates, rate-limits and inserts into a `web_vitals` table (new migration: route, metric, value, rating, device class, attribution JSON, `created_at`; insert-only for anon; retention 90 days via the pipeline).
  - `experimental.webVitalsAttribution: ['LCP','INP','CLS']` adds the element attribution.
  - The Python pipeline's weekly report adds a "Site health" block (p75 per route from SQL) and emails it through the existing Brevo setup.
  - Cost: about 1 to 3k rows a day at 50% sampling, well inside the Supabase free tier.

**Lab tracking for low traffic.** If a route stays under 200 samples, section 5's Lighthouse trend (uploaded reports) is the primary signal. CrUX will probably report "insufficient data" for this origin. Check it once a quarter with a free PageSpeed Insights API key.

---

## 7. Data delivery: the architectural wins beyond the plan

### 7.1 Server-baked sparklines (PX04)

**Problem after WP09.**
- Each card's 96x40 line needs that product's history. WP09 batches the reads (the chunk size is bounded by the 1000-row PostgREST cap and one row per product per day), but a full scroll still costs 15 to 30 requests.
- Each 365-day history row is about 70 bytes raw, so a full-catalog scroll moves about 7.8 MB raw (about 0.8 MB compressed).
- The first request fires as soon as the above-the-fold cards mount, so the lazy supabase-js chunk (66 kB gz, about 250 kB to parse) loads right after hydration, inside the window where the first interaction is measured for INP.
- Sparklines appear after hydration and a network round trip, not in the first paint.

**Design.**
- New migration (next free number after WP21's 0032 and any number the sibling research tracks claim; `data-opportunities.md` starts at 0033). Name: `00NN_catalog_sparklines.sql`:

  ```sql
  -- One row per active product: a min/max-normalised, fixed-length series
  -- over the window, encoded 6 bits per point (0..63) as base64url chars.
  -- Scale-invariant like WP09's MiniSparkline, so no currency input.
  -- Products whose price fails the 0023 freshness test get NULL, matching
  -- the withheld price on the card.
  create function public.get_catalog_sparklines(p_days int, p_points int)
  returns table (product_id bigint, series text, first_day date, last_day date)
  language sql stable security invoker set search_path = public, pg_temp
  as $$ ... $$;
  revoke all on function public.get_catalog_sparklines(int, int) from public;
  grant execute on function public.get_catalog_sparklines(int, int) to anon, authenticated;
  ```

  The body buckets `product_price_history` rows for `recorded_at::date` in the window into `p_points` buckets (`width_bucket`), takes the last value per bucket, carries forward empty buckets, normalises per product, and encodes. It is one indexed range scan: about 112k rows for 1Y. It runs once per day plus once per scrape, not per visitor.
- Periods follow the ui-audit recommendation that "Period" drives the sparkline:
  - 7D: 7 daily points;
  - 1M: 30 daily points;
  - 3M, 6M, 1Y: 32 buckets each.
- Payload: 306 × about 45 bytes ≈ 14 kB raw, about 10 kB br per period.
- Server: `getCachedSparklines(period)` in `serverMarketData.ts`, tagged with WP11's market tag, so the scrape hook revalidates it.
  - `/`, `/prices` and `/market` pass the default period's map as a prop next to the products.
  - Other periods come from `GET /api/public/sparklines/[period]`: an ISR route handler with `revalidate = 86400`, `generateStaticParams` returning `[]` (consistent with WP11's no-build-time-queries rule), and the same tag. One CDN-cached request per period change for the whole catalog.
- Client: `MiniSparkline` (WP09's SVG) accepts `series: string | null` and decodes 32 chars into polyline points in microseconds. There is no data hook and no IntersectionObserver per card for sparklines. The SVG renders on the server, inside WP08's server HTML.
- "Show full chart" and MarketView row expansion fetch full history on click from `GET /api/public/history/[id]`. That route is ISR with tag `market-products`, returns compact columns (`{d:[...], p:[...]}` instead of row objects, about 5 kB br for a year) and is CDN-cached.

**Effect.**
- Zero history requests while scrolling.
- Zero supabase-js on `/`, `/prices` and `/market` (see 7.2).
- Sparklines in the first paint, so no pop-in and no fake skeleton line (ui-audit flags the fake zigzag).
- Estimated INP gain from removing the post-hydration chunk parse: 50 to 150 ms off the worst early interaction on a mid phone.
- The HTML grows by about 10 kB br, which the `/prices` document budget absorbs.

**Rejected alternative.** Render cards as server components and pass them into the client list as `ReactNode`s, to cut hydration. It doubles the flight payload, because every card's element tree is serialised on top of the data. Suspense-chunked hydration (section 13.3) gets most of the INP benefit at no payload cost.

### 7.2 No supabase-js in the browser (PX04)

After WP04 to WP06, the browser uses supabase-js only for public reads: catalog fallbacks, history, sales history, volume metrics, exchange rate, portfolio product search, and the shared-recipe RPC. Move each of them to a same-origin GET route handler under `app/api/public/`, ISR-cached where the data is public, or to data the page already has:

| Browser read today | Replacement |
|---|---|
| Price history for sparklines | baked series (7.1) |
| Full chart history | `/api/public/history/[id]` (ISR, tag) |
| Sales history (product page) | `/api/public/sales/[id]` (ISR, tag) or server-render it into the page |
| Volume metrics | already server-fed (`initialVolumeMetrics`); delete the client refetch |
| Exchange rate | server-fed in the page; client refresh from `/api/public/rate` (ISR, tag) |
| Portfolio search | filter the catalog the page already has, or `/api/public/catalog` (also the offline source, section 12) |
| Shared recipe (`get_shared_recipe`) | `/api/box-recipes/shared/[code]` (WP06's route family), `private, max-age=60` |

Then:
- delete `app/lib/supabase.ts` and `supabaseLoader.ts`;
- extend WP12's ESLint guard to forbid `@supabase/*` value imports in any client module;
- remove `https://*.supabase.co` from CSP `connect-src` (and from `img-src` after section 10).

Effect:
- No 66 kB gz chunk anywhere.
- No GoTrue session recovery in the browser.
- One fewer origin.
- Supabase egress drops, because the CDN answers repeated reads.
- The browser no longer holds the anon key, but the key is public anyway, so this is not a security claim.

### 7.3 Cache headers for API routes

| Route family | Header | Why |
|---|---|---|
| `/api/auth/*`, `/api/account/*`, `/api/portfolio*`, `/api/holdings*`, `/api/lots*`, `/api/box-recipes*` (owner reads and writes) | `Cache-Control: private, no-store` | User data. Never cached by the CDN or bfcache heuristics. Set it explicitly, even though Next 16 GET handlers are dynamic by default, so a future `revalidate` export cannot make them cacheable. |
| `/api/revalidate` (POST) | `no-store` (WP11) | |
| `/api/public/*` data routes | No manual header. Use segment config `export const revalidate = 86400`, `generateStaticParams` returning `[]`, and data read through tagged cached functions. | Next and Vercel treat them as ISR: the CDN serves them, `revalidateTag` from the scrape hook marks them stale, and the browser gets `public, max-age=0, must-revalidate` with ETag revalidation. Setting `CDN-Cache-Control` by hand would bypass tag invalidation. |
| `/api/vitals` (fallback RUM, POST) | `no-store` | |
| `/img/*` (section 10) | `Cache-Control: public, max-age=31536000, immutable`, `CDN-Cache-Control: max-age=31536000`, `x-vercel-enable-rewrite-caching: 1` | Paths are content-hashed, so the object at a given URL never changes. |
| `/sw.js` (section 12) | `Cache-Control: no-cache`, `Content-Type: application/javascript; charset=utf-8` | Browsers must always pick up a new worker. |
| `/manifest.webmanifest` | Next default | |

Verification per route: after two requests, `curl -sI` shows `x-vercel-cache: HIT` (or `STALE` during revalidation). For user routes, `x-vercel-cache` must be `MISS` or absent, and `cache-control` must contain `private`.

### 7.4 Function region next to the database (PX03)

Supabase is in us-east-2 (Ohio), and Vercel functions default to `iad1` (Washington). Set the project's function region to `cle1` (Cleveland) in Project Settings, Functions. Each ISR render, route handler and `proxy.ts` session check makes one or more database or Auth round trips. An inter-region hop of about 10 to 15 ms becomes about 1 to 2 ms. For a product-page cold render with 3 to 6 sequential reads, that saves an estimated 30 to 80 ms of cold TTFB. It is free and reversible. Confirm the region with `x-vercel-id` on a cold function response.

### 7.5 Warm after scrape and after deploy

WP11 marks tags stale after each scrape, so the next visitor gets the stale page and triggers a background regeneration. That is correct, but the first visitor after each scrape sees data one scrape old.
- **After scrape:** after `POST /api/revalidate` succeeds, `revalidate_hook.py` also sends a GET to `/`, `/prices`, `/market`, `/analytics`, `/stats` and the 5 sparkline periods. That is 10 requests per scrape and 60 a day, which fill the fresh versions before users arrive.
- **After deploy:** Vercel's ISR cache is per deployment, so every product page is cold after a deploy. A `deployment_status` GitHub job (Production, success) walks the sitemap from WP13 with concurrency 4 and a 250 ms delay: about 330 requests, which fits easily in the Hobby function allowance. It removes cold TTFB (est. 600 to 1200 ms) for real users and crawlers on the first visit to each product.

---

## 8. Prefetch strategy for Next 16 Links

Facts, from the bundled `prefetching.md` for 16.3.6 without Cache Components:
- A static route is prefetched in full when its `<Link>` enters the viewport.
- A dynamic route is not prefetched unless it has `loading.js`.
- The client cache keeps static prefetches for 5 minutes (`staleTimes.static`; production sends `x-nextjs-stale-time: 300`).
- The scheduler drops links that scroll off-screen and prioritises visible links, then hover and touch intent.
- `<Link prefetch={false}>` also disables intent prefetch: the installed `Link` code only calls `onNavigationIntent` when `prefetch !== false`.

Policy:

| Link set | Prefetch | Reason |
|---|---|---|
| Header primary nav (desktop) | Default (viewport) | These are the core destinations. After WP11 the heaviest, `/prices`, is about 17 kB br of flight. 5 links cost about 60 to 100 kB br per desktop page view, amortised over 5 minutes. On phones the nav is `display: none` until the menu opens, so nothing is prefetched until the user shows intent. |
| Header nav for `/compare` and `/box-calculator` | Revisit with Web Analytics click-through after 4 weeks | If fewer than 5% of page views click them, switch them to intent. |
| Mobile menu links | Default | They become visible only when the menu opens, which is itself intent. |
| Auth links (`/auth/login`, `/auth/signup`) everywhere | `prefetch={false}` | Dynamic, rarely clicked, and each prefetch counts against the proxy's auth rate limit (review F077; WP02 reclassifies it, but the waste stays). |
| Footer links | `prefetch={false}` | The footer reaches the viewport at the end of every long page and would prefetch 8 routes nobody is about to visit. |
| Product links in grids and lists (`/prices` cards, `/` strips, `/market` rows, product-page siblings, portfolio holdings) | Intent only: `IntentLink` | Up to 306 visible targets per catalog scroll. After WP11 each is a static ISR route, so viewport prefetch would fetch every product page (est. 5 to 8 kB br each) and wake a cold ISR render for each one not yet cached. The same pattern appears in `optimizing-prefetching.md` ("a grid makes one such server request per card. Prefetch on intent instead"). |
| Links in the product page to its own set on `/prices?set=` | Default | Single link. |

`IntentLink` (`app/components/IntentLink.tsx`), as a client component:
- It renders `<Link prefetch={false}>` and calls `router.prefetch(href)` on `onMouseEnter` (after an 80 ms dwell, cancelled on `onMouseLeave`, so a pointer sweeping across the grid does not prefetch everything), on `onFocus`, and on `onPointerDown`.
- `pointerdown` fires about 80 to 150 ms before `click` on touch, which is enough head start for the RSC request to be in flight when the navigation starts.
- It keeps a module-level `Set` of prefetched hrefs, so each href is prefetched at most once per page.

Timing: **ship `IntentLink` with WP11, or before it.** Adding a `loading.tsx` (WP13) or ISR (WP11) to `/product/[id]` without it switches on viewport prefetch for every card. List this as a pre-merge check in WP11's PR.

`staleTimes`: set `experimental.staleTimes.static = 1800`. Data changes at most every 4 hours, and a 30-minute client cache makes back-and-forth between `/prices` and product pages free during a browsing session. It is experimental, but it only extends a TTL. Roll back by deleting the key.

Rejected:
- Speculation Rules `prerender`: it prerenders whole documents and duplicates App Router soft navigation.
- ForesightJS (cursor prediction): a dependency for a marginal gain over the dwell timer.

---

## 9. Font strategy

1. **Keep Geist Sans through `next/font`.** It is self-hosted, immutable and variable (one file for every weight), preloads only the latin subset, and uses a metric-adjusted Arial fallback (`size-adjust: 104.76%`, measured in the production CSS), so the swap causes near-zero CLS. The é in "Pokéfin" (U+00E9) is in the preloaded latin subset.
2. **Drop Geist Mono** (PX03). It renders only set codes: `GroupHeader.tsx:34`, `stats/page.tsx:182` and `:241`, `product/[id]/page.tsx:254`, plus the import modal. Replace `font-mono` with `font-sans tabular-nums tracking-wide uppercase` for codes like "SV08". That removes the `Geist_Mono` import, one CSS variable, 13 extra `@font-face` rules' worth of CSS for the mono family, and a late font request (est. 20 to 30 kB) on 4 routes. If a monospace face is wanted, use the system stack `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`, which costs 0 bytes.
3. **Numbers.** Geist Sans has tabular figures. Keep `tabular-nums` on every price, return and table (`globals.css` already sets it on `table`). Extend it to the card price and return rows that are not tables (ui-audit wants a fixed-width price column).
4. **Do not preload a second weight or subset**, and do not use `display: optional`. `optional` would make first-visit text render in Arial for the whole page view on slow connections, which is a visible brand inconsistency for a gain the metric-matched fallback already provides.
5. **`experimental.inlineCss`: A/B it, do not adopt blindly.** The CSS is 10.9 kB gz. Inlining removes one render-blocking request (roughly one round trip on an already-open HTTP/2 connection, about 50 to 150 ms on LTE) for first visits. But every HTML response, including RSC-less document loads for returning users, gets 11 kB heavier and loses cross-page caching. Enable it on a preview, then compare FCP and LCP p75 for 2 weeks in Speed Insights, split by first versus repeat visit if the data allows. Keep it only if first-visit LCP improves by 100 ms or more.

---

## 10. Image pipeline

### 10.1 Derivatives made by the scraper (PX05, Python)

- On each image change, `main.py` writes WebP derivatives at widths **160, 320, 480, 640** (capped at the source width; originals are about 743x1000), quality 75, `method=6`, to `products/{id}/{h8}/w{W}.webp`. `h8` is the first 8 hex characters of the SHA-256 of the original bytes. Keep writing `products/{id}_thumb.webp` for one release so old HTML keeps working.
- Migration (next free number): `alter table products add column image_hash text, add column image_color text;`. `image_color` is the dominant colour (`#rrggbb`, from a 1x1 Pillow resize), used as the slot background instead of the grey "Loading..." pulse (7 bytes per product; no base64 LQIP, which would add about 300 bytes x 306 to the HTML).
- Size estimates (est., to be confirmed on the fixture set):

  | Width | Size |
  |---|---|
  | w160 | about 5 kB |
  | w320 | about 15 kB |
  | w480 | about 28 kB |
  | w640 | about 45 kB |
  | Original JPEG (for comparison) | about 91 kB |

- AVIF: Pillow wheels include an AVIF plugin in recent releases. AVIF saves roughly 20 to 30% over WebP at equal quality, but `next/image` with a custom loader emits one format (no `<picture>` switching). Stay on WebP unless a `<picture>`-based `ProductImage` is written later.
- Backfill: a one-off script over the 306 products (about 1,224 objects of about 25 kB each, about 30 MB of Storage).

### 10.2 Same-origin, CDN-cached serving (PX05)

`next.config.ts`:

```ts
async rewrites() {
  return [{ source: "/img/:path*", destination: `${SUPABASE_URL}/storage/v1/object/public/product-images/:path*` }];
},
// headers(): add for source "/img/:path*":
//   x-vercel-enable-rewrite-caching: 1
//   CDN-Cache-Control: max-age=31536000
//   Cache-Control: public, max-age=31536000, immutable
```

The Vercel docs ("Rewrites", "Override upstream caching headers" and "Enable rewrite caching") document both headers for external rewrites. Verify on a preview:
- the second `curl -sI /img/...` shows `x-vercel-cache: HIT`;
- the browser sees one immutable `Cache-Control`, not Supabase's `no-cache` next to it.

If Vercel forwards the upstream `no-cache` to the browser anyway, use `app/img/[...path]/route.ts` instead. It streams from Storage with explicit headers and is invoked only on a CDN miss (about 1,224 objects per region, once).

Effects:
- No separate DNS, TCP and TLS setup to `*.supabase.co` before the first image: an estimated 100 to 300 ms off LCP on mobile when the LCP element is an image.
- Repeat views make zero image requests instead of one conditional request per image.
- Bytes move from Supabase's free egress (5 GB a month, shared with API traffic) to Vercel's CDN transfer allowance, which is much larger.
- CSP `img-src` can drop `https://*.supabase.co` once no URL points there.

### 10.3 Real `srcset` without the Vercel image quota (PX05)

```ts
// next.config.ts
images: {
  loader: "custom",
  loaderFile: "./app/lib/productImageLoader.ts",
  imageSizes: [160],
  deviceSizes: [320, 480, 640],
}
```

- With exactly these sizes, `next/image` emits a 4-entry `srcset` that maps 1:1 to the derivatives.
- The loader turns `{ src: "<id>/<h8>", width }` into `/img/products/<id>/<h8>/w<nearest ≥ width>.webp`.
- Remove `unoptimized` (it disables `srcset`). The loader keeps the image-transformation quota at zero, because `next/image` never calls Vercel's optimizer when `loader: "custom"` is set.
- `ProductImage` gets a `sizes` prop per slot, computed from the layout:

| Slot | `sizes` | Chosen at 2x / 3x DPR | Today |
|---|---|---|---|
| `/prices` flat card (`h-40 sm:h-48`, `p-4`) | `(min-width: 640px) 120px, 120px` | w320 / w480 | 256 px thumbnail, soft on 2x and 3x |
| Grouped card (`sm:w-32 sm:h-32`) | `(min-width: 640px) 96px, 120px` | w320 / w320 | same |
| `/market` row (`w-14 h-14`) | `56px` | w160 / w160 | 256 px thumbnail |
| Home strip (`h-28`) | `84px` | w160 / w320 | 256 px thumbnail |
| Product hero (`h-72`, `p-4`) | `(min-width: 768px) 200px, 190px` | w480 / w640 | 91 kB original |

- WP12's `priority` (preload plus `fetchPriority="high"`) keeps working. `next/image` emits `imagesrcset` and `imagesizes` on the preload link, so the browser preloads the right width.

### 10.4 Loading priority on catalog pages

- On `/prices` and `/`, the first card image in document order gets `priority` (only one image per page, following WP12's rule), and the rest of the first row (index under 3) gets `loading="eager"` without a preload.
- Lazy loading an in-viewport image delays it until layout, which is exactly the wrong thing for LCP candidates.
- Everything else stays `loading="lazy"`.
- Estimate: if the first card image is the LCP element on phones (it competes with the H1), this saves 200 to 500 ms of LCP.

### 10.5 CLS

Every image slot already has a fixed-height box, and object-contain inside it keeps CLS at 0. Keep it that way. The `productImageLoader` test asserts every `ProductImage` call site passes a sized `className`.

### 10.6 Optional chart diet (P2)

Recharts is a 118 kB gz lazy chunk that costs about 400 ms of parse and execute on a mid phone the first time any chart opens.
- The product-detail price chart (line, area, crosshair, tooltip, range chips) can be a hand-written SVG component of about 6 to 8 kB gz, building on WP09's `MiniSparkline` geometry.
- Keep Recharts for analytics and portfolio charts, where the feature set pays for itself.
- Do this only if Speed Insights shows INP or LCP pressure on `/product/[id]` after PX05.

---

## 11. React Compiler adoption

**What WP17 unlocks.**
- `eslint-config-next` 16 ships `eslint-plugin-react-hooks` with the compiler-derived rules (purity, refs during render, set-state-in-effect, components declared inside render, immutability). These are the Rules of React the compiler relies on.
- The compiler does not fail on a violating component. It skips it silently, so today coverage would be partial and invisible.
- WP17 fixes the remaining violations (it names the inline component declarations and the set-state-in-effect cases) and makes lint blocking. After that, lint-clean means the compiler optimises every component, and CI stops new code from quietly opting out.
- WP19 (MarketView decomposition) and WP18 (compare split) turn the two largest components into units the compiler can memoise well.

**Plan (PX08, after WP19):**
1. `pnpm add -D babel-plugin-react-compiler` and `reactCompiler: true` in `next.config.ts`. Use the stable Babel path in production. Turbopack runs it only on files with JSX or hooks, so the build-time cost is small.
2. Try `experimental.turbopackRustReactCompiler: true` (introduced in 16.3.0, experimental; no Babel dependency) on a preview only, and compare build time and output. Switch when it leaves experimental.
3. Remove the manual `memo`, `useMemo` and `useCallback` only where the compiler's output makes them redundant, and do it in a separate follow-up PR, so the first PR is behaviour-neutral and easy to revert.
4. Escape hatch: `"use no memo"` at the top of any component that misbehaves, with a comment and an issue link.

**Expected gain and how to verify.**
- The compiler removes re-renders that plain props equality does not catch: new callback identities from parents, derived arrays, inline objects. Hot spots are `/market` sort and filter (MarketView rows are unmemoised, review F125), `/compare` typing (F074) and the portfolio tables.
- Estimate: 10 to 30% less render time on those interactions. It does not help the unavoidable "currency changed, every price changes" re-render.
- Before and after on the perf fixture, Chrome Performance panel, 4x CPU:
  - interaction duration for sorting `/market` by price;
  - interaction duration for toggling CAD/USD on `/prices`;
  - interaction duration for typing 5 characters in `/compare`.

  Record the numbers in the PR. Speed Insights INP p75 per route confirms the effect 2 weeks after deploy.
- Bundle impact: memo caches add roughly 2 to 5% to app code. The budget script (section 5) shows the exact delta.

---

## 12. PWA, installability and an offline shell for card shows

**Why.** A collector at a card show is standing at a vendor table with one bar of signal and wants the price of the box in front of them. Today a page load there fails or takes 10 seconds or more. The target: open the installed app, and within a second search 306 products and see last-synced prices with an honest "as of" date.

**Installability (PX09a, S).**
- `app/manifest.ts`:
  - `name`, `short_name` "Pokéfin", `start_url: "/?source=pwa"` (Web Analytics can then count installs), `display: "standalone"`;
  - `background_color` and `theme_color` from `--pf-bg` and `--pf-pokeball`;
  - icons: 192, 512 and 512 maskable, made from the header's Poké Ball SVG;
  - `shortcuts`: Prices, Portfolio, Box Calculator.
- `app/icon.svg`, `app/apple-icon.png` (180x180), and a real 32x32 `favicon.ico` of about 1 to 4 kB, replacing the 31 kB PNG. WP13 copies the PNG to `apple-icon.png`; this supersedes that with proper sizes.
- `export const viewport = { themeColor: "#dc2626", viewportFit: "cover" }` in the root layout.
- Chrome no longer requires a service worker for the install prompt. iOS uses Add to Home Screen with the apple icon.

**Service worker (PX09b, M).** Hand-written, not a library:
- Serwist is the option Next's docs point to, but its Turbopack path adds build integration.
- About 150 lines of worker code, fully auditable against the strict CSP.
- Served by `app/sw.js/route.ts` (static GET), so the worker can embed `VERCEL_GIT_COMMIT_SHA` as its cache version. Headers are listed in section 7.3.
- Registration: in a client component after `load` and `requestIdleCallback`, production only. Kill switch: `NEXT_PUBLIC_SW=off` makes the worker unregister itself and delete its caches on the next visit.
- **Navigation preload is mandatory.** `self.registration.navigationPreload.enable()` in `activate` runs the page request in parallel with worker startup. Without it, a worker adds its boot time (about 20 to 100 ms on Android) to every online navigation's TTFB.

Strategies:

| Request | Strategy | Cache and limits |
|---|---|---|
| `/_next/static/immutable/**` | cache-first | `static-<sha>`, 80 entries; old versions deleted on activate |
| Navigations to `/`, `/prices`, `/market`, `/product/*`, `/box-calculator` | network-first using the preload response, 3 s timeout, then the cached page, then `/offline` | `pages`, last 40 |
| `/api/public/catalog` | stale-while-revalidate; also refreshed on each online visit | `data` |
| `/api/public/sparklines/*`, `/api/public/rate` | stale-while-revalidate | `data` |
| `/img/**` | cache-first | `img`, 300 entries (about 5 MB) |
| `/api/auth/*`, `/api/account/*`, portfolio and recipe routes, `/account`, `/portfolio`, any response with `Set-Cookie` or `Cache-Control: private` or `no-store`, RSC requests (`RSC: 1` header) | network only, never cached | Private data must not persist on shared devices. RSC responses vary on router-state headers. |

When an RSC soft navigation fails offline, the App Router falls back to a document navigation, which the worker then answers from `pages` or `/offline`. Verify this on a preview with DevTools set to Offline, and record it in the PR.

**Offline catalog (PX09c, M).**
- `GET /api/public/catalog`: ISR, market tag. It returns a compact array per product: id, set, type label, variant, `usd_price`, `recorded_on`, return 7D and 30D, image path and hash. About 60 kB raw, about 15 kB br.
- `app/offline/page.tsx` is a static shell with a client search over the cached catalog (the same matcher `/prices` uses). USD and CAD use the cached rate.
- A header banner reads: "Offline. Prices as of Sep 29, 14:05. Last synced 2 h ago."
- **The freshness gate holds offline:** any cached price whose `recorded_on` is more than 14 days old at display time is withheld exactly like the 0023 server rule. It shows "No recent price", using the same `isPriceFresh()` from `marketPulse.ts`. That keeps the promise the migration makes, even for a phone that has been offline for weeks.
- Online pages get a small "Available offline" indicator after the first successful catalog sync, so users learn the feature exists.

**Connectivity-aware navigation (PX10, experimental).** After the spike in section 14, consider `experimental.useOffline`:
- it retries failed soft navigations and prefetches when the connection returns;
- `useOffline()` from `next/offline` drives the banner, more reliably than `navigator.onLine`;
- it is experimental in 16.3, so it goes behind a preview soak.

**What not to do:** no push notifications (alert emails come from the data-opportunities plan); no background sync of portfolio writes (conflict resolution for lots is not worth it); no precaching of all 306 product pages (about 2 to 3 MB for a feature most users never open).

---

## 13. Mobile interaction polish

### 13.1 Touch targets and input ergonomics (PX07, S)

- **Tap targets.** Several controls are below 44 px: sort and view toggles (`px-3 py-1.5 text-xs`, about 28 px), "Show full chart" (about 28 px), chips, and table sort headers. They pass WCAG 2.5.8 (24 px) but not the 44 px (Apple) or 48 px (Material) platform guidance. Tailwind 4's `pointer-coarse:` variant fixes this without changing desktop density: add `pointer-coarse:min-h-11 pointer-coarse:min-w-11` and at least 8 px spacing to every interactive control. The budget test in `app/__tests__/touchTargets.test.tsx` renders the controls and asserts the classes.
- **iOS focus zoom.** iOS Safari zooms into any focused input under 16 px. The `/prices` search (`SearchInput.tsx:32`) and the home search (`page.tsx:221`) are `text-sm` (14 px). Use `text-base sm:text-sm` on every input, select and textarea. Do not disable zoom with `maximum-scale`, because that is an accessibility regression.
- **Input attributes.** Searches: `type="search"`, `enterKeyHint="search"`. Money and quantity fields in portfolio and box calculator: `inputMode="decimal"`, `autoComplete="off"`. Purchase date: native `type="date"`.
- **Instant press feedback.** Give every button and card link an `active:` state (`active:bg-slate-100` or `active:scale-[0.98]`, compositor-only), and set `-webkit-tap-highlight-color: transparent` globally. Feedback on the next frame is what users perceive as responsiveness, independent of the navigation.
- **Safe areas.** The fixed scroll-to-top button and any bottom sheet use `bottom: max(1.5rem, env(safe-area-inset-bottom))`, which matters in the installed PWA with `viewportFit: "cover"`.
- **Overscroll.** WP14's `Dialog` and the filter drawer get `overscroll-behavior: contain`, so scrolling a sheet does not scroll the catalog behind it.

### 13.2 INP: transitions for heavy toggles (PX07)

- Currency, period, sort and view changes on `/prices` and `/market` re-render every card or row. Wrap their state setters in `startTransition`. The toggle's own pressed state (a separate urgent state, or `useOptimistic`) paints in the next frame, while the list re-renders as interruptible work. Dim the grid (`opacity-70` while `isPending`) so the pending work is visible.
- WP08 already defers search with debounce and `useDeferredValue`. Apply the same pattern to `/compare` (F074).
- Estimate: toggle INP drops from "full list render" (est. 80 to 200 ms on a mid phone for 306 cards) to about one frame plus input delay.

### 13.3 INP and TBT: Suspense-chunked hydration (PX07)

- Wrap each set group, or each run of 24 cards in flat view, of the `/prices` grid in its own `<Suspense fallback={null}>`, and do the same for `/market` row blocks.
- The boundaries never suspend at runtime, because the data is in the props. But React 19 hydrates each boundary as a separate unit, yields to the browser between units, and hydrates first the boundary the user interacts with.
- The single long hydration task on a 306-card page (est. 150 to 300 ms on a mid phone) becomes slices under 50 ms. A tap during hydration is handled at the next yield instead of after the whole list.
- Verify with the Lighthouse TBT trend and a Performance-panel trace (longest task during hydration).

### 13.4 Scroll restoration

- Without Cache Components, going back from a product page re-renders `/prices` from the router cache, and the browser restores the scroll offset.
- With WP09's `content-visibility: auto`, freshly mounted off-screen cards use their `contain-intrinsic-size` estimate. If the estimate is wrong, the restored offset lands on the wrong card.
- Two fixes:
  1. Make the intrinsic sizes per view mode accurate. Measure the median rendered card height per view mode on the fixture, and have the budget test assert the CSS values are within 10% of it.
  2. Anchor restore. On product-link click, store `{ id, offsetFromTop }` in `history.state` (via `history.replaceState` with the existing state spread). On mount, if the entry has an anchor and the anchored card is not within 100 px of its recorded offset, call `scrollIntoView` on it, then adjust by the offset.
- Cost: about 40 lines in `ProductPrices`. Correct return position is the most noticeable part of "feels native" on a phone.

### 13.5 View transitions (PX07, optional polish)

- React's `<ViewTransition>` works in the App Router without configuration (bundled `view-transitions.md`). `<Link transitionTypes>` exists since 16.2.
- Use it in two places only:
  - morph the card thumbnail into the product hero (`name={`product-img-${id}`}` on both sides);
  - a 150 ms crossfade of the page content on route change.
- Wrap the CSS in `@media (prefers-reduced-motion: no-preference)`.
- Keep the duration at or under 200 ms. A view transition captures snapshots and holds rendering, so long animations can hurt perceived latency and INP.
- Browsers without support navigate normally.
- Check TypeScript typings for `ViewTransition` against the installed `@types/react`; it may need the canary types reference.

---

## 14. Cache Components: a spike, not a work package

What it would add, according to the bundled docs:
- **Activity-preserved routes.** Up to 3 previous routes stay mounted but hidden, so going back to `/prices` keeps DOM, React state and scroll. That removes section 13.4 and the re-render cost of going back.
- **Partial Prefetching.** One App Shell per route, shared across all links, instead of one prefetch per link. That solves the section 8 grid problem natively.
- **Refreshed prefetches.** `revalidateTag` refreshes prefetched data.
- **Pairing with `useOffline`.**

What it conflicts with:
- WP11's `unstable_cache` wrappers and `export const revalidate` segment config (Cache Components uses `"use cache"` and `cacheLife`);
- WP08's static page assumptions;
- memory: keeping a 10k to 17k-node `/prices` DOM hidden while on a product page on low-end phones.

Proposal: after WP21 and PX04, run a 2-day spike on a branch.
- Enable `cacheComponents` and `partialPrefetching`.
- Port `serverMarketData.ts` to `"use cache"` with `cacheTag` and `cacheLife("days")`.
- Measure back-navigation time, memory (`performance.memory` on Chrome Android) and prefetch bytes on the fixture.
- Adopt only if back-navigation to `/prices` becomes instant at the right scroll position without a memory regression over 50 MB.

---

## 15. Sequencing as work packages

The IDs are proposals. Each package is one PR, following the plan's conventions.

| ID | Package | Depends on | Effort | Expected gain (est. unless measured) |
|---|---|---|---|---|
| PX01 | Perf fixture, byte-budget gate, Lighthouse CI, production confirmation job | WP00, WP08 (fixture mechanism), WP17 (CI blocking) | M (1.5 d) | Protects every later gain. CI +3 to 4 min. |
| PX02 | RUM: Speed Insights config, baseline export, weekly `vercel metrics` job (or the self-hosted fallback) | none | S (0.5 d; 1.5 d with the fallback) | Visibility; regression issue within 7 days. |
| PX03 | Quick wins: drop Geist Mono, icon set and small favicon, lazy Sentry in `error.tsx` and `global-error.tsx` (`import("@sentry/nextjs").then(s => s.captureException(error))`), 16 px inputs, `prefetch={false}` on footer and auth links, `cle1` region, `viewport` export, confirm a single apex-to-www 308 | WP17 (Sentry files), WP13 (icons) | S (1 d) | −1 font request (20 to 30 kB) on 4 routes; −30 kB favicon; −10 to 40 kB gz JS on every route (to be measured); −30 to 80 ms cold TTFB; no iOS zoom |
| PX06 | `IntentLink` for product lists, `staleTimes.static = 1800` | lands **with or before WP11** | S (0.5 d) | Avoids up to 306 product prefetches and ISR renders per catalog browse (est. 1 to 2 MB br per heavy session) |
| PX04 | Baked sparklines (migration), `/api/public/*` read routes, supabase-js removed from the browser, CSP `connect-src` tightened | WP09, WP10, WP11, WP12, WP21 | L (3 d) | −66 kB gz lazy chunk on `/`, `/prices`, `/market`; 0 scroll requests (from 15 to 30); sparklines in first paint; −50 to 150 ms early INP |
| PX05 | Image derivatives, `image_hash` and `image_color` (migration), backfill, `/img` rewrite with CDN caching, custom loader, `sizes`, first-row eager, CSP `img-src` tightened | WP12, WP16 (pipeline hardening), WP21 | M (2 d) | Hero about 91 kB to about 30 kB; −100 to 300 ms first-image connection; 0 repeat image requests; sharp thumbnails on 2x and 3x screens |
| PX07 | Interaction: touch targets, transitions for toggles, Suspense-chunked hydration, scroll anchor, accurate intrinsic sizes, optional view transitions | WP09, WP14, WP19 | M (2 d) | Toggle INP to about one frame; hydration long task split into slices under 50 ms; correct back-navigation position |
| PX08 | React Compiler (Babel), then a separate memo cleanup PR | WP17, WP18, WP19 | S + S | 10 to 30% less render time on `/market` and `/compare` interactions |
| PX09 | PWA: manifest and icons (a), service worker with navigation preload (b), offline catalog and `/offline` page (c) | PX03 (icons), PX04 (`/api/public/catalog`), PX05 (`/img`) | M to L (3 d) | Installable; sub-second offline price lookup at shows; no online TTFB regression (navigation preload) |
| PX10 | Spike: Cache Components, Partial Prefetching, `useOffline` | WP21, PX04 | S (2 d, time-boxed) | Decision document |

Critical path: PX01, PX02 and PX03 can start now (PX01 needs WP17 only for the blocking flag, not for the script). PX06 is pinned to WP11. PX04 and PX05 follow the plan's data and image work. Everything else follows WP19.

---

## 16. Risks and things not to do

- **Do not raise budgets to make a PR pass without a reason in the PR.** Budgets exist to make a cost visible, and a silent raise hides it.
- **Do not gate on Lighthouse timings.** Runner variance makes a blocking timing gate flaky or useless (section 5.1).
- **Do not enable Vercel image optimization** to get `srcset`. The quota is why it was turned off (commit `bd29639`), and the scraper-made derivatives give the same result for free.
- **Do not register a service worker without navigation preload, or without the kill switch.** A broken worker is the one performance change a revert cannot undo, because the old worker keeps running until it fetches a new `sw.js`.
- **Do not cache private routes, RSC requests or anything with `Set-Cookie` in the worker.**
- **Do not keep viewport prefetch on product grids once product pages are ISR** (section 8).
- **Do not show offline prices older than 14 days.** The 0023 guard is a product promise, not just a server detail.
- **Do not move sparkline normalisation into currency space.** It is scale-invariant, matching WP09's pitfall.
- **Risk:** the external-rewrite cache may not override Supabase's `no-cache` for browsers. Mitigation: the route-handler fallback in 10.2, verified on a preview before the loader switch.
- **Risk:** Hobby plan limits (Speed Insights data points, function invocations for warming). All usage in this document is estimated at low single-digit percentages of Hobby allowances. The owner checks the Usage tab after each phase.

---

## 17. Owner actions and measurements that replace estimates

1. **Baseline RUM:** in Speed Insights, export the 28-day p75 for LCP, INP, CLS and TTFB per route (Mobile, Canada) before PX work starts. Paste it into `perf-budgets.json` under `baseline`.
2. **Metrics access:** run `vercel metrics schema vercel.speed_insights`. If it errors on this plan, choose the self-hosted fallback in section 6.
3. **Apex redirect:** `curl -sI https://pokefin.ca/ | head -3` should show one `308` to `https://www.pokefin.ca/`. If it shows 307, change the domain redirect to permanent in Vercel, Domains. Make sure the weekly email, social profiles and the TCGPlayer or CardRink cross-links use `https://www.pokefin.ca` directly.
4. **Function region:** Vercel, Project, Settings, Functions, Region: `cle1`.
5. **Sentry cost measurement** (after WP17, from `frontend/`): `pnpm build:stub`, then `grep -l "captureException" .next/static/chunks/*.js | xargs -n1 sh -c 'gzip -9c "$0" | wc -c'`. Record the size of the chunk referenced from every route. That number decides whether PX03's lazy Sentry is worth its line.
6. **Image bytes:** after the PX05 backfill, `select percentile_cont(array[0.5,0.9]) within group (order by size)` over the derivatives' Storage metadata (or `du` of the local backfill output). This replaces the estimates in 10.1.
7. **Fixture calibration:** after WP08 and WP11 deploy, `curl -s https://www.pokefin.ca/prices | wc -c`, stored as `calibration.pricesHtmlBytesProd`.
8. **Prefetch reality check** (before and after PX06): on production, open DevTools Network, filter `_rsc`, scroll `/prices` from top to bottom at reading speed, and count the requests. Expected after PX06: 0 product prefetches until a pointer rests on a card.
