# WP22: Performance budget gate, real-user monitoring and production smoke test

- **Goal**: every pull request shows what it costs in bytes per route and fails when it breaks a budget or a layout-stability rule; the owner gets one GitHub issue within a week when real-user p75 on a route regresses; and a production page that renders without prices, or a signed-in flow that stops working, is reported within a day instead of months.
- **Why now / value**: WP08, WP09, WP11 and WP12 bought the site its speed, and nothing protects it. Track 2 adds 16 packages of new UI (indices, sparklines, screener, watchlist, share cards); without a gate each one can quietly add 10 to 30 kB, and the product direction makes this package the precondition for all of them (01-PRODUCT-DIRECTION.md §6.1, "WP22 lands first"). Separately, the signed-in features were broken in production for months (WP01, WP04 to WP06) without anyone noticing; a daily smoke test is the cheapest possible alarm.
- **Effort**: L, 14 to 16 hours (fixture and stub 4 h, measurement and budget scripts 3 h, Lighthouse CI including one calibration round trip 2 h, smoke, confirmation and RUM workflows 3 h, tests 2 h, quick wins and docs 1 h). Plus about 1 hour of owner time.
- **Depends on**: WP00 (stub harness, `pnpm build:stub`, `pnpm test:scripts`), WP08 (opt-in `SUPABASE_STUB_FIXTURE` mechanism), WP12 (supabase-js off the hydration path; limits must be recorded after it), WP17 (blocking lint, `instrumentation-client.ts`, the `error.tsx` comment this package edits), WP21 (adds the `database` job to `ci.yml`; landing after it avoids a merge conflict). Also reads the results of WP01 (`POST /api/account/export`), WP05 (`GET /api/portfolio`), WP11 (ISR product page with `generateStaticParams` returning `[]`), WP13 (`/sitemap.xml`, `/stats` redirect), WP15 (restyled error pages) and WP20 (`app/types/database.ts`, async root layout).
- **Unblocks**: every Track 2 package that lists it: WP23, WP26, WP27, WP29, WP30, WP32, WP33 and WP37 (each adds its routes to `frontend/perf-budgets.json`), and indirectly all later ones.
- **Placement**: first package of Track 2, after WP21. It can move to right after WP17 if the owner wants budgets to guard WP18 to WP21; nothing else changes if it moves, because it only adds CI steps, a fixture, scripts and workflows (see "Before you start" for what to do when WP21 has not landed).
- **Suggested branch name**: `remediation/wp22-perf-budget-gate-and-rum`
- **Risk level**: medium. It adds blocking steps to the required `Frontend (lint + typecheck + tests)` check, so a flaky assertion would block every PR; only deterministic byte counts and stable Lighthouse audits block, timings only warn, and one step can be removed in a one-line follow-up. Runtime changes are two lines of behaviour (lazy Sentry in the error boundaries, query strings stripped from Speed Insights events).

## Why

Today nothing measures what a PR costs a visitor. `pnpm build:stub` proves the app builds, but against an empty catalog, so a route's HTML and flight data are unrealistically small, and nobody reads the chunk sizes anyway. A stub build of master in this workspace shows how easy it is to lose track: `/prices` loads 15 scripts, 232 kB gzip (1 kB = 1024 bytes) plus a 39.5 kB `noModule` polyfill that modern browsers skip, and the floor every route pays is 145.5 kB, of which 3.6 kB is `@sentry/nextjs` pulled in statically by `error.tsx` and `global-error.tsx` even though no DSN is set. Speed Insights is installed but unconfigured and nobody looks at it, and the only check of production is a human visiting the site. After this PR a realistic synthetic catalog (306 products, 55 sets, a year of history for the pages Lighthouse visits) feeds a CI build; a script prints each route's JS, CSS, document and flight bytes in the job summary and fails on a breach; Lighthouse CI fails on layout shift, bfcache loss, byte growth and oversized catalog images; production is measured after each deploy, smoke-tested every morning (including a signed-in portfolio load and data export), and checked weekly against real-user p75 targets. Evidence and the exact design come from `audits/remediation/research/performance-excellence.md` §3 (targets), §4 (budgets), §5 (CI enforcement, fixture, pipeline), §6 (Speed Insights and weekly alerting), §9 and §15 (lazy Sentry), §17 (owner measurements), and from `01-PRODUCT-DIRECTION.md` §6.1 (the rules every Track 2 package follows).

## Design

This is infrastructure. There is no new page. The user-facing surfaces are the CI job summary, GitHub issues and two lines of runtime behaviour.

### D1. Topology of the perf build

```text
 CI job "Frontend (lint + typecheck + tests)"  (existing required check, name unchanged)

 SUPABASE_STUB_FIXTURE=perf pnpm build:stub
   stub listens on 127.0.0.1:3100 (fixed for perf, so NEXT_PUBLIC_SUPABASE_URL is
   inlined as http://127.0.0.1:3100 and the served build can reach it again)
   next build prerenders /, /prices, /market, /analytics ... from the fixture
   writes .perf/build-requests.json (every stub endpoint hit, matched or not)

 node scripts/perf-serve.mjs  (background)
   http://127.0.0.1:3100  front door = the same stub, fixture "perf":
       /rest/v1/*, /storage/v1/*, /auth/v1/*  -> answered from the fixture
       everything else                         -> proxied to next start
   http://127.0.0.1:3101  next start (the perf build)
   writes .perf/serve-requests.ndjson, then .perf/ready after warming every route

 pnpm perf:budget          bytes, blocking   (reads HTML from :3100, files from .next/)
 pnpm dlx @lhci/cli autorun  Lighthouse x3 on 4 URLs, CLS/bf-cache/bytes/images blocking
 node scripts/perf-lhci-summary.mjs   medians + suggested byte limits into the job summary
 pnpm run test:scripts     again: the fixture-coverage test now sees both request logs
```

One origin is required, not a convenience: the app's CSP (`next.config.ts`) allows `connect-src` and `img-src` only for `'self'` and `https://*.supabase.co`. A stub on a different port would be blocked in the browser, so every sparkline fetch and every product image would fail and Lighthouse would measure a broken page. The front door also removes the CSP `upgrade-insecure-requests` directive from proxied responses (it would ask the browser to move plain-http localhost requests to https) and drops `Strict-Transport-Security`. Neither affects any measured byte.

### D2. The perf fixture

Synthetic and seeded (mulberry32, seed `20260930`), generated at stub start with timestamps rebased to the current time. No scraped data, product photo or production dump is committed.

| Data | Contents | Served at |
|---|---|---|
| Summaries | 306 `MarketSummaryRow`s, ids 900001 to 900306. Log-normal USD prices (median $80, clamped $5 to $2,000). Returns 1D to 1Y, null when the set is younger than the window. Variants on about 15%. `image_url` in the production path shape but on the stub origin; 10 products (900290 to 900299) without an image | `POST /rest/v1/rpc/get_market_product_summaries` |
| Freshness | 300 products priced 1 to 30 hours ago; 6 deliberately stale products (900300 to 900305) priced 20 to 40 days ago with `usd_price` and every return null, exactly as migration 0023's gate returns them | inside the summaries |
| Sets | 55 sets over 9 generations, names of 1 to 3 words (5 to 30 characters), set 0 releases in 20 days, set 1 released 10 to 40 days ago, the oldest about 14 years ago; about 15% "Special Expansion" | inside the summaries |
| Product types | 12 types with production-style labels | inside the summaries |
| Volume | `get_market_product_volume_metrics` rows for about 80% of priced products (always for 900001 to 900003) | `POST /rest/v1/rpc/get_market_product_volume_metrics` |
| Listings | one snapshot per product that has volume | `GET /rest/v1/product_listings_history` |
| Price history | 365 daily rows for 900001, 900002, 900003, ending at the current price; other products have none (their sparklines show the empty state) | `GET /rest/v1/product_price_history` |
| Sales history | 52 weekly and 30 daily rows for 900001 to 900003 | `GET /rest/v1/product_sales_history` |
| Set analytics | one row per set (55), `key` = `code:name` as in the SQL | `POST /rest/v1/rpc/get_set_analytics` |
| Exchange rate | one row, 1.3714 | `GET /rest/v1/exchange_rates` (also answers `.single()` with an object) |
| Images | `products/<id>.jpg` -> `scripts/fixtures/img/original.jpg` (743x1000 JPEG, about 90 kB, like production originals); `products/<id>_thumb.webp` -> `thumb.webp` (190x256, about 11 kB, like the scraper's thumbnails). Gradient plus seeded noise, made once with Pillow. Served with `cache-control: no-cache` like Supabase Storage on the free plan | `GET /storage/v1/object/public/product-images/*` |

Table routes support the PostgREST subset the app uses: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `is`, `not.<op>`, `order` (several keys, `asc`/`desc`), `limit`, `offset` and a flat `select` with aliases. Anything else throws, so an unsupported query fails loudly instead of returning a silently wrong page.

Coverage rule: with `fixture: "perf"`, every Supabase request that has no fixture route is recorded as unmatched. `build:stub` exits 1 on any unmatched request during a perf build, `perf:budget` fails on any unmatched request in the serve log, and `scripts/supabase-stub.test.mjs` fails when either log contains one. Adding a query without a fixture turns CI red instead of making a page silently cheap.

### D3. Measurement definitions

All sizes in kB where 1 kB = 1024 bytes, one decimal.

- **Route JS (gz)** = sum over the route's initial scripts of `gzip -9(file)`. Initial scripts = every `<script src="/_next/...">` in the route's HTML **without** `nomodule` (the polyfill chunk is excluded because browsers that run modules never download it; WP12's ad hoc script counted it). gzip -9 per file is the unit of research §4 and WP12, and a conservative stand-in for the brotli Vercel serves.
- **Route JS (br)**: same files, brotli quality 11. Printed, not budgeted.
- **Shared JS** = the scripts present on every measured route (set intersection), summed as above. This is the floor every page pays: framework, router, layout, error boundaries.
- **`/portfolio`** (anonymous requests are redirected to sign-in, so there is no HTML to fetch): `build-manifest.json` `rootMainFiles` plus the union of every `entryJSFiles` list in `.next/server/app/portfolio/page_client-reference-manifest.js`. The script cross-checks this method on `/prices` against its HTML and prints a warning if the two sets differ.
- **Document (br)** = brotli q11 of the full HTML response body. **Inline flight (br)** = brotli q11 of the concatenated `self.__next_f.push(...)` script bodies.
- **Largest lazy chunk (gz)** = the largest `gzip -9` of any `.next/static/chunks/**/*.js` that is in no route's initial set and is not a polyfill file.
- **CSS (gz)** = sum of `gzip -9` over the union of `<link rel="stylesheet" href="/_next/...">` across routes.
- **Preloaded fonts** = per route, count and raw bytes of `<link rel="preload" as="font">` (woff2 is already compressed). Hard cap: 1 file; budget on the largest per-route total.
- **Third-party scripts** = any `<script src>` not starting with `/`. Must be zero except the origins a route lists in `thirdPartyAllow` (`/auth/login` may load `https://challenges.cloudflare.com`).
- **Calibration** = fixture `/prices` raw HTML bytes vs `calibration.pricesHtmlBytesProd` (production `/prices` raw bytes). Warning, never failure, when the ratio is off by more than 15%.

Edge cases: a route that does not answer 200 fails the gate; an empty `.perf/` (no perf build) fails with the command to run; the date strings in the HTML change length by a byte or two from day to day, which the 5% headroom absorbs.

### D4. Targets and limits

`frontend/perf-budgets.json` holds, for each budget, a **target** (the research §4 number, the goal) and a **limit** (what CI enforces). Limits start as `null` and are written by `pnpm perf:budget --write-limits`:

```text
limit = min(target, ceil(measured x 1.05))   when measured <= target
limit = ceil(measured x 1.05)                when measured >  target
```

Why not simply enforce the targets: several are below what the plan can reach today. The shared floor is about 141 kB after WP12 and the lazy Sentry change (react-dom alone is 71.5 kB), against a 125 kB target. Enforcing 125 would make CI red on the day this lands; enforcing a generous number would let a 30 kB regression through. The ratchet blocks growth of more than 5% on every route from day one, keeps the target visible, and prints "over target" wherever the site has not reached it yet. The research's own tightening rule ("once a route has 2 weeks of green RUM, tighten its limit to the measured value plus 5%") uses the same formula.

| Key | Target (kB) | Source |
|---|---:|---|
| `shared.jsGzKb` | 125 | §4 shared floor |
| `/` JS, document br | 150, 60 | §4 |
| `/prices` JS, document br, flight br | 155, 70, 22 | §4 |
| `/market` JS, document br | 165, 60 | §4 |
| `/analytics` JS | 150 | not in §4; WP22 uses `/`'s number (catalog page, charts lazy) |
| `/compare`, `/box-calculator` JS | 170 each | §4 |
| `/privacy`, `/auth/login` JS | 130 each | §4 |
| `/product/[id]` (measured on `/product/900001`) JS, document br | 145, 30 | §4 |
| `/portfolio` JS (manifest) | 180 | §4 |
| `lazyChunkGzKb` | 120 | §4 (Recharts is 118) |
| `cssGzKb` | 14 | §4 |
| `fonts.preloadKb` | 35 (max 1 file) | §4 |

Statuses: `ok`; `over target` (passes, shown); `FAIL` (measured above limit); `unset` (limit null in CI: fails and says to run `--write-limits`); `missing` (the route could not be measured: fails).

Raise rule, enforced: on a `pull_request` event the script reads the base branch's `perf-budgets.json` (`git show HEAD^1:...`, which is the base tip in a PR merge commit; the checkout fetches depth 2) and, for every key whose `limit` or `target` went up, requires a line `Perf budget raise: <key> <reason>` in the PR body. Adding a new route is not a raise.

### D5. Lighthouse CI

`pnpm dlx @lhci/cli@0.15.1 autorun` with `frontend/lighthouserc.json`, so the lockfile does not change. URLs `/`, `/prices`, `/product/900001`, `/market` on `http://127.0.0.1:3100`, 3 runs each, Lighthouse's default mobile emulation, performance category only. Assertions per URL:

| Audit | Level | Threshold | Why |
|---|---|---|---|
| `cumulative-layout-shift` | error | median ≤ 0.05 | Behaviour, stable in lab |
| `bf-cache` | error | score 1 | Behaviour; back navigation is the most common catalog move |
| `resource-summary:script:size` | error | calibrated: median x 1.10 of the first CI run | Total script transfer during load, including lazy chunks the byte gate does not see (the supabase-js loader, Recharts on the product page) |
| `resource-summary:image:size` | error | calibrated the same way | Catches a slot that starts loading originals instead of thumbnails |
| `uses-responsive-images` | error on `/` and `/prices`, warn on `/market` and `/product/900001` | 0 items | `/market` puts 256 px thumbnails into 56 px slots and the product hero is the 743 px original; both wait for the deferred image-derivative work (research §10, PX05). If `/` or `/prices` also fail on the first run, move them to warn and say so in the PR |
| `largest-contentful-paint` | warn | median ≤ 2500 ms | Runner variance is 20 to 30% (research §5.1) |
| `total-blocking-time` | warn | median ≤ 300 ms | Same |

Reports go to `frontend/lhci-reports/` (filesystem target, never public temporary storage) and are uploaded as the `perf-reports` artifact with `.perf/`.

### D6. Production confirmation (after each deploy, informational)

`.github/workflows/prod-confirm.yml` runs on `deployment_status` when a `Production` deployment succeeds. It waits 30 s for the alias, then for each HTML route of the budget file (the product route uses the first `/product/<id>` link found on production `/prices`): one warm-up request, then a measured request with the same functions and units as the CI gate (static files fetched over HTTPS instead of read from disk). It records `x-vercel-cache` (expected `HIT`, `STALE` or `PRERENDER`), document and JS sizes, compares JS with the CI limit, checks that `https://pokefin.ca/` answers exactly one `308` to `https://www.pokefin.ca/`, and prints the `/prices` calibration drift. It never fails the run; problems are `::warning::` annotations.

### D7. Production smoke test (daily)

`.github/workflows/prod-smoke.yml`, daily at 11:07 UTC and on demand. Playwright (Chromium, pinned `playwright@1.63.0`, installed into a temp prefix, no lockfile change) against `https://www.pokefin.ca`:

| Check | Pass condition |
|---|---|
| `/`, `/prices`, `/market`, `/analytics`, `/box-calculator` | HTTP 200, final URL on the same path, no error-page marker, and at least N price-formatted strings (`$12.34`, `C$1,234.56`, `US$5.00`) in the rendered body text; N per page in `prod-smoke-lib.mjs`, calibrated from production at implementation time |
| One product page | the id from repository variable `SMOKE_PRODUCT_ID`, else the first `/product/<id>` link on `/prices`; HTTP 200 and at least 1 price |
| `/sitemap.xml` | HTTP 200 and at least 200 `<loc>` entries under `/product/` |
| Signed in: `/portfolio` | not redirected to `/auth/login`, HTTP 200, and the page's own `GET /api/portfolio` answers 200 |
| Signed in: export | `POST /api/account/export` from the page (same-origin, `x-pokefin-request: 1`) answers 200. Only the status is read; the body (the smoke account's data) is never logged |

Each public check is retried once after 30 s before it counts as failed (a cold ISR render or a deploy in progress).

**How the signed-in leg signs in.** A password sign-in needs a Cloudflare Turnstile token, and Supabase verifies it (WP02 made the token mandatory on every credential route), so a headless browser cannot sign in reliably, and a service-role key in GitHub would undo WP21's least-privilege work. Default design: a **rotating session**. The owner seeds it once with the `cookie` request header of a signed-in session of a dedicated smoke account (secret `SMOKE_SESSION_SEED`). Each run loads the previous run's Playwright storage state, visits `/portfolio`, where `proxy.ts` refreshes the Supabase session and sets rotated cookies, and saves the new state encrypted (`openssl enc -aes-256-cbc -pbkdf2`, key in secret `SMOKE_STATE_KEY`) into the Actions cache for the next run. If the chain breaks (a run redirected to sign-in), the workflow opens a separate issue labelled `prod-smoke-session` with re-seed instructions, instead of reporting a site outage. Without the secrets, the signed-in leg reports "not configured" and the public leg still runs.

Issues: on failure, one open issue labelled `prod-smoke` is created or gets a new comment; when a later run passes, it gets a "passing again" comment and is closed. Labels are created on first use.

### D8. Real-user monitoring

- **Speed Insights configuration** (`app/layout.tsx` through a small client wrapper, because a server component cannot pass a function prop to a client component): `sampleRate={1}` (explicit; low traffic needs every sample, research §6), and `beforeSend` that removes the query string and hash from `event.url`, because `/prices?q=` carries what users typed. Routes are still grouped by pattern (`/product/[id]`) by the library.
- **Weekly check** (`.github/workflows/rum-weekly.yml`, Mondays 13:07 UTC and on demand): `vercel metrics` p75 for LCP, INP, CLS and TTFB grouped by route over 7 days, plus the matching `_count` metrics, compared with `rum.targets` in `perf-budgets.json` (from research §3 and 01-PRODUCT-DIRECTION.md §6.1). A route with fewer than 200 samples is reported "insufficient data", never a breach. Any breach opens or updates one issue labelled `perf-regression`; a clean week comments and closes it. The raw CLI JSON is uploaded as an artifact.
- The job is **disabled until the owner confirms the plan exposes the metrics**: it runs only when the repository variable `RUM_WEEKLY_ENABLED` is `true`. If `vercel metrics schema vercel.speed_insights` fails on the owner's plan, the variable stays unset and the self-hosted web-vitals beacon (research §6 fallback) becomes a follow-up, not part of this PR.

RUM targets (p75, ms except CLS):

| Route pattern | LCP | INP | CLS | TTFB |
|---|---:|---:|---:|---:|
| `/`, `/analytics` | 1800 | 150 | 0.05 | 400 |
| `/prices` | 1800 | 150 | 0.02 | 400 |
| `/product/[id]` | 1800 | 150 | 0.05 | 900 (cold renders count) |
| `/market` | 2000 | 150 | 0.05 | 400 |
| `/compare`, `/box-calculator` | 2000 | 150 | 0.05 | 400 |
| `/portfolio`, `/account` | 2500 | 200 | 0.05 | 900 |
| `/auth/login`, `/auth/signup`, `/privacy` | 1500 | 100 | 0.02 | 400 |
| any other route | 2500 | 200 | 0.1 | 800 |

`/prices` INP on filters has a stricter 100 ms goal in the research, but RUM cannot separate interactions per control, so the route-level alarm uses 150.

### D9. Quick win: lazy Sentry in the error boundaries

`app/error.tsx` and `app/global-error.tsx` import `@sentry/nextjs` statically. Error boundaries are part of every route's first load, so the SDK chunk ships on every page (3.6 kB gz measured on a stub build without a DSN; more when a DSN is set). After this PR both files call `import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error))`, and only when `NEXT_PUBLIC_SENTRY_DSN` was set at build time (the value is inlined, so a build without a DSN contains no import at all). WP17's `instrumentation-client.ts` initialises the SDK with the same lazy pattern, and a dynamic import resolves to the same module instance, so events still carry WP17's scrubbing.

### D10. What people see

CI job summary (the budget table; values illustrative):

```text
## Performance budgets
Sizes in kB (1 kB = 1024 bytes). JS and CSS: gzip -9 per file, summed. Documents and flight: brotli q11.

| Budget                      | Measured | Limit | Target | Recorded | Status      |
|-----------------------------|---------:|------:|-------:|---------:|-------------|
| Shared JS (gz)              |    141.2 |   149 |    125 |    141.2 | over target |
| / JS (gz)                   |    152.8 |   161 |    150 |    152.8 | over target |
| /prices JS (gz)             |    163.9 |   173 |    155 |    163.9 | over target |
| /prices document (br)       |     58.4 |    62 |     70 |     58.4 | ok          |
| /prices inline flight (br)  |     17.1 |    18 |     22 |     17.1 | ok          |
| /product/[id] JS (gz)       |    143.0 |   145 |    145 |    143.0 | ok          |
| Largest lazy chunk (gz)     |    118.3 |   120 |    120 |    118.3 | ok          |
| CSS (gz)                    |     11.0 |    12 |     14 |     11.0 | ok          |
...
Shared chunks (9): 2q-sya_sd7gzs.js, 3a4rc5favqh_n.js, ...
Largest lazy chunks: 1k2...js 118.3, 3nn...js 64.6, ...
**Warnings**
- calibration: fixture /prices HTML is 8% smaller than production (ok, under 15%)
```

Lighthouse summary (per URL, medians of 3):

```text
| URL             | CLS   | LCP ms | TBT ms | Script KiB | Image KiB | bf-cache | Resp. images | Suggested script limit | Suggested image limit |
|-----------------|-------|--------|--------|-----------:|----------:|----------|--------------|-----------------------:|----------------------:|
| /prices         | 0.001 | 1920   | 210    | 238        | 96        | 3/3 pass | 0 items      | 268288 B               | 108544 B              |
```

Smoke failure issue (label `prod-smoke`):

```text
Title: Production smoke test failing
Run: https://github.com/0xDario/Pokefin/actions/runs/123
| Check        | Result | Detail                                   |
| /prices      | FAIL   | HTTP 200, 0 prices (needs 50), retried   |
| /market      | ok     | HTTP 200, 306 prices                     |
| Signed in    | ok     | /portfolio 200, /api/portfolio 200, export 200 |
Likely causes: scraper stopped for 14+ days (0023 withholds every price), an RPC failing, a deploy that renders without data.
```

### D11. Rules for every later package (also written into `frontend/README.md`)

1. A PR that adds a route adds it to `frontend/perf-budgets.json` in the same PR with `"limit": null`, runs `pnpm perf:budget --write-limits` against the perf build, and commits the result. A new data endpoint gets a fixture route in `scripts/fixtures/perf.mjs` in the same PR.
2. A PR that raises any `limit` or `target` puts `Perf budget raise: <key> <reason>` in its body. CI enforces it.
3. Never loosen a Lighthouse assertion to get green; fix the page or state the exception and its reason in the PR.

## Before you start

Read these fully:

- `audits/remediation/research/performance-excellence.md` §3 to §6, §9, §15 to §17, and `audits/remediation/01-PRODUCT-DIRECTION.md` §6.1.
- `audits/remediation/WP00-verification-harness-and-ci-build.md` steps 1, 2 and 5 (stub, build script, CI job), `WP08-prices-url-state-and-ssr.md` step 7 (the `catalog` fixture), `WP12-bundle-and-images.md` "Bundle analysis", `WP17-lint-tests-observability-ci-gate.md` steps 4, 5 and 15, `WP21-db-hardening-least-privilege.md` step 14.
- Current code: `frontend/scripts/supabase-stub.mjs`, `frontend/scripts/build-with-stub.mjs`, `frontend/scripts/supabase-stub.test.mjs`, `frontend/package.json`, `frontend/.gitignore`, `frontend/eslint.config.mjs`, `frontend/next.config.ts` (the CSP), `frontend/app/layout.tsx`, `frontend/app/error.tsx`, `frontend/app/global-error.tsx`, `frontend/instrumentation-client.ts`, `frontend/app/lib/serverMarketData.ts` (every `.from(` and `.rpc(`), `frontend/app/lib/marketData.ts` (`MarketSummaryRow`), `frontend/app/components/ProductPrices/types/index.ts` (`ProductVolumeMetrics`, `SalesHistoryEntry`), `frontend/proxy.ts` (matcher, session refresh), `frontend/app/api/account/export/route.ts`, `frontend/app/api/portfolio/route.ts`, `.github/workflows/ci.yml`.
- `migrations/0023_price_freshness_guard.sql`: `get_market_product_summaries` returns `usd_price` NULL for stale products; `get_set_analytics` builds `key` as `concat(code, ':', name)`.

Confirm the dependencies (run from `frontend/`). Each line says what to do if it fails.

```bash
grep -n '"build:stub"\|"test:scripts"' package.json            # WP00: 2 lines. Missing: stop.
grep -n 'catalog:' scripts/supabase-stub.mjs                   # WP08: 1 line. Missing: stop.
grep -n 'SUPABASE_STUB_FIXTURE' scripts/build-with-stub.mjs    # WP08: at least 1 line. Missing: stop.
ls app/lib/supabaseLoader.ts                                   # WP12. Missing: stop (limits recorded before WP12 would be 66 kB too loose).
grep -c 'continue-on-error' ../.github/workflows/ci.yml        # WP17: expect 0 in the frontend job (WP21's drift step has one; see next line)
grep -n 'name: Lint$' ../.github/workflows/ci.yml              # WP17: 1 line. Missing: stop.
ls instrumentation-client.ts                                    # WP17. Missing: stop.
grep -n 'Database replay and Python tests' ../.github/workflows/ci.yml   # WP21: 1 line. Missing: continue (placement allows it), but rebase before merge if WP21 lands first.
grep -n 'export const revalidate' 'app/product/[id]/page.tsx'  # WP11: 1 line. Missing: continue; /product/900001 renders dynamically, same bytes.
ls app/sitemap.ts                                               # WP13. Missing: drop the sitemap check from the smoke test and say so in the PR.
ls app/types/database.ts                                        # WP20. Missing: continue; the fixture-shape test skips itself.
ls app/api/portfolio/route.ts app/api/account/export/route.ts   # WP05, WP01: both exist. Missing: stop.
```

Record the starting state:

```bash
git status --porcelain                           # clean
pnpm install --frozen-lockfile
pnpm run lint; echo "exit=$?"                    # exit=0 (WP17)
pnpm test --ci 2>&1 | tail -5                    # note the suite and test counts
pnpm run test:scripts 2>&1 | grep -E '^# (pass|fail)'   # note the counts
pnpm build:stub > /tmp/wp22-base.log 2>&1; echo "exit=$?"   # exit=0
grep -A40 'stub requests during build' /tmp/wp22-base.log   # the endpoints the build calls; each must get a perf fixture route in step 5
grep -rn '\.rpc(\|\.from("' app --include=*.ts --include=*.tsx | grep -v __tests__   # every Supabase read in the app
```

Measure the baseline Sentry cost (research §17 item 5) so the PR can state it:

```bash
for f in $(grep -l "captureException" .next/static/chunks/*.js); do printf '%s ' "$f"; gzip -9c "$f" | wc -c; done
```

Check the tools this package needs: `node --version` (22.x), `python3 -c "import PIL"` (only for step 4; if it fails, `python3 -m venv /tmp/wp22-venv && /tmp/wp22-venv/bin/pip install Pillow==12.3.0` and use `/tmp/wp22-venv/bin/python`), `curl -sI https://www.pokefin.ca/prices | head -1` (network to production, needed for calibration and the smoke dry run; without it, see steps 22 and the Verification fallbacks).

Never run a build or `perf-serve` while another agent builds in the same checkout: both use `.next/` and ports 3100 and 3101.

## Implementation steps

Order: steps 1 to 13 build the local gate and are verified locally (step 22) before step 14 changes CI. Steps 15 to 21 are independent of each other. Step 23 needs one CI round trip.

### 1. `frontend/.gitignore`

Append:

```gitignore

# performance gate (WP22): request logs, budget results, Lighthouse output
/.perf/
/.lighthouseci/
/lhci-reports/
```

### 2. New `frontend/scripts/perf-config.mjs`

```js
// Shared constants for the performance gate (WP22).
// One origin serves the perf build: the Supabase stub answers the Supabase
// API paths and proxies everything else to `next start` (see perf-serve.mjs).
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const NEXT_DIR = path.join(FRONTEND_DIR, ".next");
export const PERF_DIR = path.join(FRONTEND_DIR, ".perf");
export const BUDGETS_FILE = path.join(FRONTEND_DIR, "perf-budgets.json");

export const PERF_HOST = "127.0.0.1";
// Fixed, not ephemeral: NEXT_PUBLIC_SUPABASE_URL is inlined at build time,
// so the served build must find the stub at the same address.
export const PERF_FRONT_PORT = 3100;
export const PERF_NEXT_PORT = 3101;
export const PERF_ORIGIN = `http://${PERF_HOST}:${PERF_FRONT_PORT}`;
```

### 3. New `frontend/scripts/fixtures/postgrest.mjs`

```js
// Just enough PostgREST query semantics for the perf fixture (WP22):
// horizontal filters (eq, neq, gt, gte, lt, lte, in, is, not.<op>), order,
// limit, offset and a flat select with aliases. Embedded selects such as
// `sets ( ... )` and or/and groups are not supported and throw, so an
// unsupported query fails the perf build instead of returning a wrong page.

const RESERVED = new Set(["select", "order", "limit", "offset", "columns", "on_conflict"]);

function scalar(raw) {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

/** Total order used by filters and sorting: nulls last, numbers numerically, else string order (ISO dates sort correctly as strings). */
export function compareValues(a, b) {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull || bNull) return aNull && bNull ? 0 : aNull ? 1 : -1;
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  }
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b) ? 0 : String(a) < String(b) ? -1 : 1;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function test(row, column, expression) {
  let op = expression.slice(0, expression.indexOf("."));
  let raw = expression.slice(expression.indexOf(".") + 1);
  let negate = false;
  if (op === "not") {
    negate = true;
    op = raw.slice(0, raw.indexOf("."));
    raw = raw.slice(raw.indexOf(".") + 1);
  }
  const value = row[column];
  let ok;
  switch (op) {
    case "eq":
      ok = compareValues(value, scalar(raw)) === 0;
      break;
    case "neq":
      ok = compareValues(value, scalar(raw)) !== 0;
      break;
    case "gt":
      ok = value != null && compareValues(value, raw) > 0;
      break;
    case "gte":
      ok = value != null && compareValues(value, raw) >= 0;
      break;
    case "lt":
      ok = value != null && compareValues(value, raw) < 0;
      break;
    case "lte":
      ok = value != null && compareValues(value, raw) <= 0;
      break;
    case "in": {
      const list = raw.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, ""));
      ok = value != null && list.some((v) => compareValues(value, v) === 0);
      break;
    }
    case "is":
      ok = raw === "null" ? value === null || value === undefined : value === scalar(raw);
      break;
    default:
      throw new Error(`perf fixture: unsupported PostgREST operator "${op}" on column "${column}"`);
  }
  return negate ? !ok : ok;
}

/**
 * Apply a PostgREST query string to in-memory rows.
 * @param {Array<Record<string, unknown>>} rows
 * @param {URL} url
 */
export function applyPostgrest(rows, url) {
  const params = url.searchParams;
  for (const key of params.keys()) {
    if (key === "or" || key === "and") throw new Error(`perf fixture: PostgREST "${key}" groups are not supported`);
  }
  let out = rows.filter((row) => {
    for (const [key, expression] of params) {
      if (RESERVED.has(key)) continue;
      if (key.includes(".")) throw new Error(`perf fixture: filter on embedded column "${key}" is not supported`);
      if (!test(row, key, expression)) return false;
    }
    return true;
  });

  const order = params.get("order");
  if (order) {
    const keys = order.split(",").map((part) => {
      const [column, direction = "asc"] = part.split(".");
      return { column, desc: direction === "desc" };
    });
    out = [...out].sort((a, b) => {
      for (const { column, desc } of keys) {
        const c = compareValues(a[column], b[column]);
        if (c !== 0) return desc ? -c : c;
      }
      return 0;
    });
  }

  const offset = Number(params.get("offset") ?? 0);
  const limit = params.has("limit") ? Number(params.get("limit")) : Number.POSITIVE_INFINITY;
  out = out.slice(offset, offset + limit);

  const select = params.get("select");
  if (select && select.trim() !== "*") {
    if (select.includes("(")) throw new Error(`perf fixture: embedded select "${select}" is not supported`);
    const columns = select.split(",").map((c) => c.trim()).filter(Boolean).map((c) => {
      const [alias, source] = c.includes(":") ? c.split(":") : [c, c];
      return { alias, source: source.split("::")[0] };
    });
    out = out.map((row) => Object.fromEntries(columns.map(({ alias, source }) => [alias, row[source] ?? null])));
  }
  return out;
}
```

### 4. Fixture images: new `frontend/scripts/fixtures/make-images.py`, output in `frontend/scripts/fixtures/img/`

```python
"""Stand-in product images for the WP22 perf fixture.

Run once from frontend/:  python3 scripts/fixtures/make-images.py
Writes scripts/fixtures/img/original.jpg (743x1000 JPEG, about 90 kB, like the
TCGplayer originals the scraper stores) and thumb.webp (190x256 WebP at the
scraper's quality 78, about 11 kB, like main.py's thumbnails).
A gradient plus seeded noise: no product artwork is committed. The noise
amplitude is searched so each file lands within 5% of its byte target.
"""
import random
from io import BytesIO
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent / "img"
SPECS = {
    "original.jpg": {"size": (743, 1000), "target": 90_000, "format": "JPEG", "save": {"quality": 85}},
    "thumb.webp": {"size": (190, 256), "target": 11_000, "format": "WEBP", "save": {"quality": 78, "method": 6}},
}


def clamp(v):
    return 0 if v < 0 else 255 if v > 255 else v


def render(size, amplitude, seed=20260930):
    rnd = random.Random(seed)
    w, h = size
    img = Image.new("RGB", size)
    px = img.load()
    for y in range(h):
        for x in range(w):
            n = rnd.randint(-amplitude, amplitude)
            px[x, y] = (clamp(40 + 180 * x // w + n), clamp(60 + 120 * y // h + n), clamp(150 - n))
    return img


def encode(img, spec):
    buf = BytesIO()
    img.save(buf, spec["format"], **spec["save"])
    return buf.getvalue()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, spec in SPECS.items():
        lo, hi = 0, 128
        best = None
        for _ in range(9):
            mid = (lo + hi) // 2
            data = encode(render(spec["size"], mid), spec)
            best = data
            if abs(len(data) - spec["target"]) <= spec["target"] * 0.05:
                break
            if len(data) < spec["target"]:
                lo = mid + 1
            else:
                hi = mid - 1
        (OUT / name).write_bytes(best)
        print(f"{name}: {len(best)} bytes")


if __name__ == "__main__":
    main()
```

Run it once (`python3 scripts/fixtures/make-images.py`, or the venv python from "Before you start"). Expect two lines, `original.jpg` between 85,500 and 94,500 bytes and `thumb.webp` between 10,450 and 11,550 bytes. If a file misses its window after the 9 iterations, rerun with a different `seed` default and keep whichever lands inside; if neither does, keep the closest and state the sizes in the PR. Commit both images and the script. `ls -l scripts/fixtures/img` must list exactly these two files, about 100 kB together.

### 5. New `frontend/scripts/fixtures/perf.mjs`

```js
// Synthetic, seeded fixture for the performance budget gate (WP22).
//
// No scraped data: every name, price and date is generated. Cardinality and
// string lengths follow production (306 products, 55 sets, 9 generations,
// 12 product types) so the byte budgets measure a realistic page. Timestamps
// are rebased to "now" at first use, so the 14-day price freshness gate of
// migration 0023 keeps 300 prices and withholds the 6 stale ones.
//
// Every Supabase read the app makes during a perf build or on the perf server
// must have a route here (see the coverage rule in supabase-stub.mjs). When a
// PR adds a query, add a route in the same PR, with rows shaped like the
// production response (app/types/database.ts is the reference). Do not add a
// route that returns [] just to silence the check unless production also
// returns nothing to the anon key.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyPostgrest } from "./postgrest.mjs";

const IMG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "img");
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const PERF_SEED = 20260930;
export const PERF_FIRST_ID = 900001;
export const PERF_PRODUCT_COUNT = 306;
export const PERF_SET_COUNT = 55;
export const PERF_HISTORY_IDS = [900001, 900002, 900003];
export const PERF_STALE_IDS = [900300, 900301, 900302, 900303, 900304, 900305];
export const PERF_NO_IMAGE_IDS = Array.from({ length: 10 }, (_, i) => 900290 + i);
export const PRICE_STALENESS_DAYS = 14; // migration 0023

/** mulberry32: small, fast, deterministic PRNG. Returns floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Newest first. Ids 801 to 809.
const GENERATIONS = [
  "Mega Evolution",
  "Scarlet & Violet",
  "Sword & Shield",
  "Sun & Moon",
  "XY",
  "Black & White",
  "HeartGold & SoulSilver",
  "Platinum",
  "Diamond & Pearl",
];

// [id, name, label, weight]
const PRODUCT_TYPES = [
  [1, "booster_box", "Booster Box", 18],
  [2, "elite_trainer_box", "Elite Trainer Box", 20],
  [3, "booster_bundle", "Booster Bundle", 14],
  [4, "pokemon_center_etb", "Pokémon Center Elite Trainer Box", 8],
  [5, "collection_box", "Collection Box", 10],
  [6, "premium_collection", "Premium Collection", 6],
  [7, "ultra_premium_collection", "Ultra-Premium Collection", 3],
  [8, "tin", "Tin", 6],
  [9, "three_pack_blister", "3-Pack Blister", 5],
  [10, "build_and_battle", "Build & Battle Box", 4],
  [11, "sleeved_booster", "Sleeved Booster Pack", 3],
  [12, "booster_box_case", "Booster Box Case", 3],
];

const VARIANTS = ["Pokemon Center", "Costco Exclusive", "Case", "Japanese"];

const SET_WORDS = [
  "Crimson", "Tidal", "Ember", "Aurora", "Summit", "Obsidian", "Radiant", "Echo",
  "Verdant", "Storm", "Lunar", "Solar", "Prism", "Rift", "Crown", "Zenith",
  "Frost", "Cinder", "Gale", "Harbor", "Twilight", "Paradox", "Destined", "Celestial",
  "Brilliant", "Fusion", "Legends", "Shrouded", "Journey", "Origins",
];

/**
 * Build every table the perf fixture serves. Deterministic for a given `now`.
 * @param {{ now?: Date, baseUrl: string }} options baseUrl is the stub origin, used for image_url.
 */
export function buildPerfData({ now = new Date(), baseUrl }) {
  const rand = mulberry32(PERF_SEED);
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const round2 = (x) => Math.round(x * 100) / 100;
  const nowMs = now.getTime();
  // Offset-less UTC, like product_price_history.recorded_at and the RPC.
  const isoNoZone = (ms) => new Date(ms).toISOString().slice(0, 19);
  const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
  const weighted = (items) => {
    const total = items.reduce((s, it) => s + it[3], 0);
    let r = rand() * total;
    for (const it of items) {
      r -= it[3];
      if (r < 0) return it;
    }
    return items[items.length - 1];
  };
  const mean = (values) => (values.length ? round2(values.reduce((a, b) => a + b, 0) / values.length) : null);
  const median = (values) => {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return round2(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
  };

  const generations = GENERATIONS.map((name, i) => ({ id: 801 + i, name }));

  const sets = [];
  const usedNames = new Set();
  for (let i = 0; i < PERF_SET_COUNT; i++) {
    const words = rand() < 0.25 ? 1 : rand() < 0.73 ? 2 : 3;
    let name = Array.from({ length: words }, () => pick(SET_WORDS)).join(" ");
    while (usedNames.has(name)) name = `${name} ${pick(SET_WORDS)}`;
    usedNames.add(name);
    // Set 0 releases in 20 days (pre-orders), set 1 released 10 to 40 days
    // ago, the oldest about 14 years ago.
    const releaseMs = i === 0 ? nowMs + 20 * DAY_MS : nowMs - (i * 95 - 85 + int(0, 30)) * DAY_MS;
    sets.push({
      id: 9101 + i,
      name,
      code: `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i * 7) % 26))}${String(i + 1).padStart(2, "0")}`,
      releaseMs,
      release_date: isoDate(releaseMs),
      expansion_type: rand() < 0.15 ? "Special Expansion" : "Main Series",
      generation: generations[Math.min(generations.length - 1, Math.floor((i * generations.length) / PERF_SET_COUNT))],
    });
  }

  const summaries = [];
  for (let p = 0; p < PERF_PRODUCT_COUNT; p++) {
    const id = PERF_FIRST_ID + p;
    // 5 products per set for the first 275, the remaining 31 go to the 31
    // newest sets. The +10 puts 900001 to 900003 in sets 2 to 3 years old.
    const set = sets[p < 275 ? (p + 10) % PERF_SET_COUNT : (p - 275) % 31];
    const type = weighted(PRODUCT_TYPES);
    const staleIndex = PERF_STALE_IDS.indexOf(id);
    const stale = staleIndex !== -1;
    const price = Math.min(2000, Math.max(5, Math.exp(Math.log(80) + 1.1 * normal())));
    const recordedMs = stale ? nowMs - (20 + staleIndex * 4) * DAY_MS : nowMs - int(1, 30) * HOUR_MS;
    const ageDays = (nowMs - set.releaseMs) / DAY_MS;
    const ret = (days) => (stale || ageDays < days ? null : round2(normal() * Math.min(45, 1.1 * Math.sqrt(days))));
    summaries.push({
      id,
      usd_price: stale ? null : round2(price),
      url: `https://www.tcgplayer.com/product/${id}`,
      price_recorded_at: isoNoZone(recordedMs),
      last_updated: isoNoZone(recordedMs),
      variant: rand() < 0.15 ? pick(VARIANTS) : null,
      image_url: PERF_NO_IMAGE_IDS.includes(id)
        ? null
        : `${baseUrl}/storage/v1/object/public/product-images/products/${id}.jpg`,
      sku: rand() < 0.7 ? `PF-${id}` : null,
      set_id: set.id,
      set_name: set.name,
      set_code: set.code,
      set_release_date: set.release_date,
      set_expansion_type: set.expansion_type,
      generation_id: set.generation.id,
      generation_name: set.generation.name,
      product_type_id: type[0],
      product_type_name: type[1],
      product_type_label: type[2],
      return_1d: ret(1),
      return_7d: ret(7),
      return_30d: ret(30),
      return_90d: ret(90),
      return_180d: ret(180),
      return_365d: ret(365),
    });
  }

  const volume = [];
  const listings = [];
  for (const s of summaries) {
    const forced = PERF_HISTORY_IDS.includes(s.id);
    if (s.usd_price === null || (!forced && rand() >= 0.8)) continue;
    const units30 = int(0, 400);
    const row = {
      product_id: s.id,
      units_sold_7d: Math.round(units30 * (0.15 + rand() * 0.2)),
      units_sold_30d: units30,
      units_sold_prior_30d: int(0, 400),
      transaction_count_30d: Math.round(units30 * (0.6 + rand() * 0.3)),
      active_listings: int(1, 250),
      total_quantity_available: int(1, 900),
      lowest_listing_price: round2(s.usd_price * (0.95 + rand() * 0.15)),
      listings_snapshot_date: isoDate(nowMs),
    };
    volume.push(row);
    listings.push({
      product_id: s.id,
      active_listings: row.active_listings,
      total_quantity_available: row.total_quantity_available,
      lowest_listing_price: row.lowest_listing_price,
      snapshot_date: row.listings_snapshot_date,
    });
  }

  const history = [];
  const sales = [];
  let historyId = 1;
  for (const id of PERF_HISTORY_IDS) {
    const s = summaries.find((row) => row.id === id);
    const lastMs = Date.parse(`${s.price_recorded_at}Z`);
    const points = [];
    let walk = s.usd_price;
    for (let d = 0; d < 365; d++) {
      points.push(round2(walk));
      walk = walk / (1 + normal() * 0.012);
    }
    points.reverse(); // oldest first; the last point is the current price
    points.forEach((usd, i) => {
      history.push({ id: historyId++, product_id: id, usd_price: usd, recorded_at: isoNoZone(lastMs - (364 - i) * DAY_MS) });
    });
    const saleRow = (bucketMs, granularity, lo, hi) => ({
      product_id: id,
      bucket_date: isoDate(bucketMs),
      granularity,
      quantity_sold: int(lo, hi),
      transaction_count: int(Math.max(1, lo - 1), hi),
      low_sale_price: round2(s.usd_price * 0.92),
      high_sale_price: round2(s.usd_price * 1.08),
      market_price: round2(s.usd_price),
    });
    for (let w = 51; w >= 0; w--) sales.push(saleRow(nowMs - (w * 7 + 3) * DAY_MS, "week", 5, 120));
    for (let d = 29; d >= 0; d--) sales.push(saleRow(nowMs - d * DAY_MS, "day", 0, 25));
  }

  const setAnalytics = sets.map((set) => {
    const members = summaries.filter((s) => s.set_id === set.id);
    const priced = members.filter((s) => s.usd_price !== null);
    const days = Math.round((nowMs - set.releaseMs) / DAY_MS);
    const returnsOf = (key) => priced.map((s) => s[key]).filter((v) => v !== null);
    return {
      key: `${set.code}:${set.name}`,
      name: set.name,
      code: set.code,
      generation: set.generation.name,
      release_date: set.release_date,
      days_since_release: days,
      product_count: members.length,
      avg30: mean(returnsOf("return_30d")),
      avg90: mean(returnsOf("return_90d")),
      avg365: mean(returnsOf("return_365d")),
      median30: median(returnsOf("return_30d")),
      median90: median(returnsOf("return_90d")),
      median365: median(returnsOf("return_365d")),
      consistency90: days >= 90 ? int(20, 95) : null,
      consistency365: days >= 365 ? int(20, 95) : null,
      volatility90: days >= 90 ? round2(5 + rand() * 40) : null,
      max_drawdown365: days >= 365 ? round2(-(5 + rand() * 45)) : null,
      trend90: days >= 90 ? round2(normal() * 10) : null,
      trend365: days >= 365 ? round2(normal() * 25) : null,
      price_per_day: days > 0 ? round2(rand() * 0.5) : null,
      momentum_score: round2(rand() * 100),
      invest_score: round2(rand() * 100),
      rank: 0,
    };
  });
  [...setAnalytics]
    .sort((a, b) => b.invest_score - a.invest_score)
    .forEach((row, i) => {
      row.rank = i + 1;
    });

  const exchangeRates = [{ id: 1, usd_to_cad: 1.3714, recorded_at: isoNoZone(nowMs - 6 * HOUR_MS) }];

  return { summaries, volume, listings, history, sales, setAnalytics, exchangeRates, sets, generations };
}

const IMAGE_FILES = { thumb: ["thumb.webp", "image/webp"], original: ["original.jpg", "image/jpeg"] };
const imageBytes = new Map();

/** Raw response for a product image path, or null for anything else (404). */
export function productImage(pathname) {
  const match = /\/products\/(\d+)(_thumb)?\.(?:jpg|jpeg|png|webp)$/i.exec(pathname);
  if (!match) return null;
  const [file, contentType] = match[2] ? IMAGE_FILES.thumb : IMAGE_FILES.original;
  if (!imageBytes.has(file)) imageBytes.set(file, fs.readFileSync(path.join(IMG_DIR, file)));
  const body = imageBytes.get(file);
  return {
    raw: {
      status: 200,
      // Supabase Storage on the free plan serves every object as no-cache.
      headers: { "content-type": contentType, "cache-control": "no-cache", "content-length": String(body.length) },
      body,
    },
  };
}

/**
 * Route table for FIXTURES.perf in supabase-stub.mjs. Keys are exact paths,
 * or a prefix ending in "/*". Data is built once per stub origin, at the
 * first request, so timestamps are relative to that moment.
 */
export function perfRoutes() {
  let memo = null;
  const data = (ctx) => {
    if (!memo || memo.baseUrl !== ctx.baseUrl) memo = { baseUrl: ctx.baseUrl, ...buildPerfData({ baseUrl: ctx.baseUrl }) };
    return memo;
  };
  const rows = (key) => (ctx) => applyPostgrest(data(ctx)[key], ctx.url);
  return {
    "/rest/v1/rpc/get_market_product_summaries": rows("summaries"),
    "/rest/v1/rpc/get_market_product_volume_metrics": rows("volume"),
    "/rest/v1/rpc/get_set_analytics": rows("setAnalytics"),
    "/rest/v1/exchange_rates": rows("exchangeRates"),
    "/rest/v1/product_price_history": rows("history"),
    "/rest/v1/product_sales_history": rows("sales"),
    "/rest/v1/product_listings_history": rows("listings"),
    "/storage/v1/object/public/product-images/*": (ctx) => productImage(ctx.pathname),
  };
}
```

Then compare the route list with the endpoints recorded in `/tmp/wp22-base.log` and the grep from "Before you start". Every endpoint the public pages call (build time and request time, server and browser) needs a route. Endpoints that only signed-in pages call (`portfolios`, `portfolio_holdings`, `portfolio_lots`, `box_recipes`, `profiles`, `rpc/get_portfolio_history`, `rpc/get_shared_recipe`) are not reached by the perf build and need none. If an endpoint the public pages call is missing, add a route that builds its rows from the same `buildPerfData` tables (for a table read, add a `rows("<key>")` entry and a table to the return value). The coverage checks in steps 6, 7 and 11 tell you if you missed one.

### 6. `frontend/scripts/supabase-stub.mjs`: register the perf fixture, route with context, `.single()`, coverage flag, one-origin proxy

6a. Imports. Add below the existing imports:

```js
import { perfRoutes } from "./fixtures/perf.mjs";
```

6b. Replace WP08's `const FIXTURES = { catalog: { ... } };` with the block below. Keep `catalogSummaryRows()` (WP08) exactly as it is; its route keeps working because a route handler may ignore its argument.

```js
// A fixture maps a request path to a handler. Keys are exact paths, or a
// prefix ending in "/*". A handler receives
//   { method, url: URL, pathname, headers, body, baseUrl }
// and returns an array of rows (answered like PostgREST, including
// `.single()`), `{ raw: { status, headers, body } }` for a non-JSON response
// (images), or null for a 404.
const FIXTURES = {
  catalog: { "/rest/v1/rpc/get_market_product_summaries": catalogSummaryRows },
  // WP22: synthetic 306-product catalog for the performance gate.
  perf: perfRoutes(),
};

// Paths the real Supabase serves. With `fallthrough`, every other path is
// proxied to the app, so the page and its Supabase calls share one origin.
const SUPABASE_PATH = /^\/(?:rest|storage|auth|realtime|functions)\/v1\//;

function findRoute(routes, pathname) {
  if (routes[pathname]) return routes[pathname];
  for (const [key, handler] of Object.entries(routes)) {
    if (key.endsWith("/*") && pathname.startsWith(key.slice(0, -1))) return handler;
  }
  return undefined;
}

// Test-harness proxy for perf-serve.mjs. Drops the CSP directive
// upgrade-insecure-requests (it would push plain-http localhost requests to
// https) and HSTS; neither changes a measured byte.
function proxyRequest(target, req, res) {
  const upstream = http.request(
    new URL(req.url ?? "/", target),
    { method: req.method, headers: req.headers },
    (up) => {
      const headers = { ...up.headers };
      const csp = headers["content-security-policy"];
      if (typeof csp === "string") {
        headers["content-security-policy"] = csp
          .split(";")
          .map((directive) => directive.trim())
          .filter((directive) => directive && directive !== "upgrade-insecure-requests")
          .join("; ");
      }
      delete headers["strict-transport-security"];
      res.writeHead(up.statusCode ?? 502, headers);
      up.pipe(res);
    }
  );
  upstream.on("error", (err) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`[supabase-stub] upstream ${target} unreachable: ${err.message}`);
  });
  req.pipe(upstream);
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
```

6c. Replace the whole `startSupabaseStub` function, including its JSDoc, with:

```js
/**
 * Start the stub. Resolves once it is listening.
 * @param {{
 *   port?: number,
 *   fixture?: string,
 *   fallthrough?: string,
 *   onRequest?: (method: string, url: string, info: { matched: boolean }) => void,
 * }} [options]
 *   fixture: opt-in data set ("catalog", "perf"). Without it every request
 *     gets the empty answer described at the top of this file.
 *   fallthrough: origin (for example http://127.0.0.1:3101) that receives
 *     every request outside the Supabase API paths (perf-serve.mjs).
 *   onRequest: called once per Supabase request; `matched` is true when a
 *     fixture route answered it.
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export function startSupabaseStub({ port = DEFAULT_STUB_PORT, fixture, fallthrough, onRequest } = {}) {
  const fixtureRoutes = fixture ? FIXTURES[fixture] : undefined;
  if (fixture && !fixtureRoutes) {
    return Promise.reject(new Error(`Unknown SUPABASE_STUB_FIXTURE "${fixture}"`));
  }
  let baseUrl = `http://${STUB_HOST}:${port}`;

  const server = http.createServer((req, res) => {
    const rawUrl = req.url ?? "/";
    const pathname = rawUrl.split("?")[0];
    if (fallthrough && !SUPABASE_PATH.test(pathname)) {
      proxyRequest(fallthrough, req, res);
      return;
    }

    // Collect the body (RPC calls POST JSON) before answering.
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const method = req.method ?? "GET";
      const accept = String(req.headers.accept ?? "");
      const wantsObject = accept.includes("application/vnd.pgrst.object+json");
      const handler = fixtureRoutes ? findRoute(fixtureRoutes, pathname) : undefined;
      onRequest?.(method, rawUrl, { matched: Boolean(handler) });

      if (handler) {
        const result = handler({
          method,
          url: new URL(rawUrl, baseUrl),
          pathname,
          headers: req.headers,
          body: Buffer.concat(chunks).toString("utf8"),
          baseUrl,
        });
        if (result && !Array.isArray(result) && result.raw) {
          res.writeHead(result.raw.status, result.raw.headers);
          res.end(method === "HEAD" ? undefined : result.raw.body);
          return;
        }
        if (!Array.isArray(result)) {
          res.writeHead(404, JSON_HEADERS);
          res.end(method === "HEAD" ? undefined : "{}");
          return;
        }
        if (wantsObject) {
          if (result.length === 1) {
            res.writeHead(200, JSON_HEADERS);
            res.end(method === "HEAD" ? undefined : JSON.stringify(result[0]));
          } else {
            res.writeHead(406, JSON_HEADERS);
            res.end(PGRST116);
          }
          return;
        }
        res.writeHead(200, {
          ...JSON_HEADERS,
          "content-range": result.length ? `0-${result.length - 1}/${result.length}` : "*/0",
        });
        res.end(method === "HEAD" ? undefined : JSON.stringify(result));
        return;
      }

      if (wantsObject) {
        res.writeHead(406, JSON_HEADERS);
        res.end(PGRST116);
        return;
      }

      res.writeHead(200, { ...JSON_HEADERS, "content-range": "*/0" });
      res.end(method === "HEAD" ? undefined : "[]");
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, STUB_HOST, () => {
      server.off("error", reject);
      const address = server.address();
      const boundPort = typeof address === "object" && address ? address.port : port;
      baseUrl = `http://${STUB_HOST}:${boundPort}`;
      resolve({
        url: baseUrl,
        port: boundPort,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
```

This keeps every WP00 and WP08 behaviour: empty `200 []` with `content-range: */0` by default, `406 PGRST116` for `.single()` without a matching route, WP08's catalog answering with `0-1/2`, unknown fixture names rejected, `onRequest` called before answering (the extra third argument is ignored by the existing callers). Update the header comment at the top of the file: after the two bullets add `//   - with a fixture (SUPABASE_STUB_FIXTURE=catalog|perf), matching paths are answered from it (see FIXTURES);` and `//   - with fallthrough, non-Supabase paths are proxied to the app (perf-serve.mjs).`

6d. CLI block at the bottom: no change needed beyond WP08's `fixture:` line. If the CLI's `onRequest` prints `${method} ${url}`, leave it.

### 7. `frontend/scripts/build-with-stub.mjs`: fixed port for perf, request log, coverage failure

7a. Add below the existing imports:

```js
import { mkdirSync, writeFileSync } from "node:fs";
import { PERF_DIR, PERF_FRONT_PORT } from "./perf-config.mjs";
```

(If the file already imports from `node:fs`, add `mkdirSync, writeFileSync` to that import instead of a second import line.)

7b. Replace the block from `const port = process.env.SUPABASE_STUB_PORT ...` through the `startSupabaseStub({ ... })` call (WP08 put `const fixture = ...` between them) with:

```js
  const fixture = process.env.SUPABASE_STUB_FIXTURE || undefined;
  // Port 0 = ephemeral, so a local `supabase start` (which owns 54321) or a
  // second build cannot collide. The perf build uses a fixed port because
  // NEXT_PUBLIC_SUPABASE_URL is inlined and perf-serve.mjs must serve the
  // stub at the same address later (WP22). Override with SUPABASE_STUB_PORT.
  const port = process.env.SUPABASE_STUB_PORT
    ? Number(process.env.SUPABASE_STUB_PORT)
    : fixture === "perf"
      ? PERF_FRONT_PORT
      : 0;
  const requestCounts = new Map();
  const stub = await startSupabaseStub({
    port,
    fixture,
    onRequest: (method, url, info) => {
      const key = `${method} ${url.split("?")[0]}`;
      const entry = requestCounts.get(key) ?? { count: 0, matched: info.matched };
      entry.count += 1;
      requestCounts.set(key, entry);
    },
  });
```

7c. Replace the summary block (from `const summary = [...requestCounts.entries()]` through the `console.log` that prints it) with:

```js
  const summary = [...requestCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { count, matched }]) => `  ${count}x ${key}${fixture && !matched ? "  (no fixture route)" : ""}`)
    .join("\n");
  console.log(`[build:stub] stub requests during build:\n${summary || "  (none)"}`);

  if (fixture) {
    mkdirSync(PERF_DIR, { recursive: true });
    const requests = [...requestCounts.entries()].map(([key, { count, matched }]) => {
      const [method, pathname] = key.split(" ");
      return { method, path: pathname, count, matched };
    });
    writeFileSync(`${PERF_DIR}/build-requests.json`, `${JSON.stringify({ fixture, requests }, null, 2)}\n`);
    const unmatched = requests.filter((r) => !r.matched);
    if (fixture === "perf" && unmatched.length > 0) {
      console.error(
        `[build:stub] the perf fixture has no route for:\n${unmatched.map((r) => `  ${r.method} ${r.path}`).join("\n")}\n` +
          "Add a route in scripts/fixtures/perf.mjs (WP22 coverage rule)."
      );
      if (exitCode === 0) exitCode = 1;
    }
  }
```

`exitCode` must be declared with `let` (WP00 declares `let exitCode = 1;` and assigns the build's code); keep the `console.log` of `next build exited with ${exitCode}` and `process.exitCode = exitCode;` after this block, so the perf coverage failure is reported as the exit code. The catalog fixture writes the log but never fails on unmatched requests (by design it answers one endpoint only).

### 8. New `frontend/scripts/perf-serve.mjs`

```js
/* eslint-disable no-console -- terminal tool; console output is its UI. */
// Serve the perf build for the budget gate and Lighthouse CI (WP22).
//
//   http://127.0.0.1:3100  front door: the Supabase stub with fixture "perf"
//                          answers /rest|storage|auth/v1/*; every other path
//                          is proxied to
//   http://127.0.0.1:3101  `next start` on the output of
//                          `SUPABASE_STUB_FIXTURE=perf pnpm build:stub`.
//
// One origin, because the app's CSP allows only 'self' and *.supabase.co in
// connect-src and img-src, so the browser's Supabase and image requests must
// be same-origin to reach the stub.
//
// Writes .perf/serve-requests.ndjson (every Supabase request, with whether a
// fixture route answered it) and .perf/ready once every budget route has been
// warmed twice. Stop with Ctrl+C or SIGTERM. The .next/ output is a stub
// build: never deploy it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  BUDGETS_FILE,
  FRONTEND_DIR,
  NEXT_DIR,
  PERF_DIR,
  PERF_FRONT_PORT,
  PERF_HOST,
  PERF_NEXT_PORT,
  PERF_ORIGIN,
} from "./perf-config.mjs";
import { startSupabaseStub } from "./supabase-stub.mjs";

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const fetchCacheDir = path.join(NEXT_DIR, "cache", "fetch-cache");

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      await res.arrayBuffer();
      if (res.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not answer within ${timeoutMs} ms`);
}

async function main() {
  const buildLog = path.join(PERF_DIR, "build-requests.json");
  const isPerfBuild =
    fs.existsSync(path.join(NEXT_DIR, "BUILD_ID")) &&
    fs.existsSync(buildLog) &&
    JSON.parse(fs.readFileSync(buildLog, "utf8")).fixture === "perf";
  if (!isPerfBuild) {
    throw new Error("No perf build found. Run `SUPABASE_STUB_FIXTURE=perf pnpm build:stub` first.");
  }

  fs.mkdirSync(PERF_DIR, { recursive: true });
  fs.rmSync(path.join(PERF_DIR, "ready"), { force: true });
  const logPath = path.join(PERF_DIR, "serve-requests.ndjson");
  fs.writeFileSync(logPath, "");
  fs.rmSync(fetchCacheDir, { recursive: true, force: true });

  const stub = await startSupabaseStub({
    port: PERF_FRONT_PORT,
    fixture: "perf",
    fallthrough: `http://${PERF_HOST}:${PERF_NEXT_PORT}`,
    onRequest: (method, url, info) =>
      fs.appendFileSync(logPath, `${JSON.stringify({ method, path: url.split("?")[0], matched: info.matched })}\n`),
  });

  const next = spawn(process.execPath, [nextBin, "start", "-p", String(PERF_NEXT_PORT), "-H", PERF_HOST], {
    cwd: FRONTEND_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: stub.url,
      NEXT_PUBLIC_SUPABASE_KEY: "stub-anon-key",
      NEXT_PUBLIC_SENTRY_DSN: "",
      SENTRY_DSN: "",
      SENTRY_AUTH_TOKEN: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });

  let stopping = false;
  const stop = async (code) => {
    if (stopping) return;
    stopping = true;
    next.kill("SIGTERM");
    await stub.close();
    // Same guarantee as build-with-stub: stub data never reaches a real build.
    fs.rmSync(fetchCacheDir, { recursive: true, force: true });
    process.exit(code);
  };
  process.on("SIGINT", () => void stop(0));
  process.on("SIGTERM", () => void stop(0));
  next.on("exit", (code) => {
    if (!stopping) console.error(`[perf:serve] next start exited with ${code}`);
    void stop(code ?? 1);
  });

  await waitForServer(`${PERF_ORIGIN}/`, 90_000);

  // Warm every HTML route twice: the first request renders ISR pages that
  // were not prerendered (the product page), the second is what gets measured.
  const budgets = JSON.parse(fs.readFileSync(BUDGETS_FILE, "utf8"));
  const routes = Object.entries(budgets.routes)
    .filter(([, spec]) => spec.source !== "manifest")
    .map(([route]) => route);
  for (let pass = 0; pass < 2; pass++) {
    for (const route of routes) {
      const res = await fetch(PERF_ORIGIN + route);
      await res.arrayBuffer();
      if (pass === 1 && res.status !== 200) console.error(`[perf:serve] warm-up ${route}: HTTP ${res.status}`);
    }
  }
  fs.writeFileSync(path.join(PERF_DIR, "ready"), `${new Date().toISOString()}\n`);
  console.log(`[perf:serve] ready on ${PERF_ORIGIN} (Ctrl+C to stop)`);
}

main().catch((err) => {
  console.error("[perf:serve]", err);
  process.exit(1);
});
```

### 9. New `frontend/scripts/perf-measure.mjs` (measurement and budget logic, shared by the gate and production confirmation)

```js
// Measurement and budget logic for the performance gate (WP22). Pure where
// possible so scripts/perf-measure.test.mjs can test it without a build.
// Units: 1 kB = 1024 bytes. JS and CSS: gzip -9 per file, summed. Documents
// and inline flight: brotli quality 11.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";

export const KB = 1024;

export const gzipSize = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
export const brotliSize = (buf) =>
  zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  }).length;

/** Bytes to kB with one decimal. */
export const kb = (bytes) => Math.round((bytes / KB) * 10) / 10;
export const sum = (list, field) => list.reduce((total, item) => total + item[field], 0);

function attr(tag, name) {
  const match = new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match ? (match[1] ?? match[2]) : undefined;
}
const hasAttr = (tag, name) => new RegExp(`\\s${name}(?=[\\s=>/])`, "i").test(tag);
const stripQuery = (href) => decodeURIComponent(href.split("?")[0]);

/** Extract what the budgets measure from a Next HTML document. Pure. */
export function parseDocument(html) {
  const scripts = new Set();
  const thirdParty = new Set();
  const stylesheets = new Set();
  const fontPreloads = new Set();
  let flight = "";
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const tag = `<script${match[1]}>`;
    const src = attr(tag, "src");
    if (src) {
      // Browsers that run modules never fetch nomodule polyfills.
      if (hasAttr(tag, "nomodule")) continue;
      if (src.startsWith("/_next/")) scripts.add(stripQuery(src));
      else if (!src.startsWith("/") || src.startsWith("//")) {
        try {
          thirdParty.add(new URL(src, "https://invalid.local").origin);
        } catch {
          thirdParty.add(src);
        }
      }
      continue;
    }
    if (match[2].startsWith("self.__next_f.push(")) flight += match[2];
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (!href) continue;
    if (rel === "stylesheet" && href.startsWith("/_next/")) stylesheets.add(stripQuery(href));
    if (rel === "preload" && (attr(tag, "as") ?? "").toLowerCase() === "font") fontPreloads.add(stripQuery(href));
  }
  return {
    scripts: [...scripts],
    thirdParty: [...thirdParty],
    stylesheets: [...stylesheets],
    fontPreloads: [...fontPreloads],
    flight,
  };
}

/**
 * Initial scripts and stylesheets of an App Router page from its client
 * reference manifest, for routes with no fetchable HTML (the proxy sends
 * anonymous /portfolio visitors to sign-in). rootMainFiles plus every
 * entryJSFiles list (layout, error boundaries, page).
 */
export function manifestAssets(nextDir, route) {
  const segment = route === "/" ? "" : route.slice(1);
  const file = path.join(nextDir, "server", "app", segment, "page_client-reference-manifest.js");
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox);
  const manifest = sandbox.__RSC_MANIFEST?.[`${route === "/" ? "" : route}/page`];
  if (!manifest) throw new Error(`no client reference manifest entry for ${route}`);
  const buildManifest = JSON.parse(fs.readFileSync(path.join(nextDir, "build-manifest.json"), "utf8"));
  const scripts = new Set((buildManifest.rootMainFiles ?? []).map((f) => `/_next/${f}`));
  for (const files of Object.values(manifest.entryJSFiles ?? {})) for (const f of files) scripts.add(`/_next/${f}`);
  const stylesheets = new Set();
  for (const list of Object.values(manifest.entryCSSFiles ?? {})) {
    for (const entry of list) if (!entry.inlined) stylesheets.add(`/_next/${entry.path}`);
  }
  return { scripts: [...scripts], stylesheets: [...stylesheets] };
}

export function readAssetFromDisk(nextDir) {
  return async (assetPath) => fs.readFileSync(path.join(nextDir, assetPath.replace(/^\/_next\//, "")));
}

export function readAssetOverHttp(origin) {
  return async (assetPath) => {
    const res = await fetch(origin + assetPath);
    if (!res.ok) throw new Error(`${assetPath}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
}

const sizeCache = new Map();
export async function sizeAssets(paths, readAsset) {
  const out = [];
  for (const p of paths) {
    if (!sizeCache.has(p)) {
      const buf = await readAsset(p);
      sizeCache.set(p, { path: p, raw: buf.length, gz: gzipSize(buf), br: brotliSize(buf) });
    }
    out.push(sizeCache.get(p));
  }
  return out;
}

/** Fetch a route's HTML and size everything it loads initially. */
export async function measureHtmlRoute({ origin, route, readAsset }) {
  const res = await fetch(origin + route, { redirect: "manual" });
  const headers = { cache: res.headers.get("x-vercel-cache"), age: res.headers.get("age") };
  if (res.status !== 200) {
    await res.arrayBuffer();
    return { route, status: res.status, headers, error: `HTTP ${res.status}` };
  }
  const html = Buffer.from(await res.arrayBuffer());
  const doc = parseDocument(html.toString("utf8"));
  const flight = Buffer.from(doc.flight, "utf8");
  return {
    route,
    status: 200,
    headers,
    document: { raw: html.length, gz: gzipSize(html), br: brotliSize(html) },
    flight: { raw: flight.length, br: flight.length ? brotliSize(flight) : 0 },
    scripts: await sizeAssets(doc.scripts, readAsset),
    stylesheets: await sizeAssets(doc.stylesheets, readAsset),
    fontPreloads: await sizeAssets(doc.fontPreloads, readAsset),
    thirdParty: doc.thirdParty,
  };
}

export async function measureAssetRoute(route, assets, readAsset) {
  return {
    route,
    status: 200,
    headers: {},
    document: null,
    flight: null,
    scripts: await sizeAssets(assets.scripts, readAsset),
    stylesheets: await sizeAssets(assets.stylesheets, readAsset),
    fontPreloads: [],
    thirdParty: [],
  };
}

/** Script paths present on every measured route: the shared floor. */
export function sharedScripts(results) {
  if (results.length === 0) return [];
  const [first, ...rest] = results.map((r) => new Set(r.scripts.map((s) => s.path)));
  return [...first].filter((p) => rest.every((set) => set.has(p))).sort();
}

/** Every built chunk that no route loads initially, largest first (gz). */
export function lazyChunks(nextDir, initial, excluded) {
  const dir = path.join(nextDir, "static", "chunks");
  return fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".js"))
    .map((f) => `/_next/static/chunks/${f.split(path.sep).join("/")}`)
    .filter((p) => !initial.has(p) && !excluded.has(p))
    .map((p) => ({ path: p, gz: gzipSize(fs.readFileSync(path.join(nextDir, p.replace(/^\/_next\//, "")))) }))
    .sort((a, b) => b.gz - a.gz);
}

/** Supabase requests the perf fixture did not answer, from both logs. */
export function unmatchedStubRequests(perfDir) {
  const out = new Set();
  const buildLog = path.join(perfDir, "build-requests.json");
  if (fs.existsSync(buildLog)) {
    const log = JSON.parse(fs.readFileSync(buildLog, "utf8"));
    if (log.fixture === "perf") for (const r of log.requests) if (!r.matched) out.add(`build: ${r.method} ${r.path}`);
  }
  const serveLog = path.join(perfDir, "serve-requests.ndjson");
  if (fs.existsSync(serveLog)) {
    for (const line of fs.readFileSync(serveLog, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      if (!r.matched) out.add(`serve: ${r.method} ${r.path}`);
    }
  }
  return [...out].sort();
}

/** Every budget slot in perf-budgets.json, with a reference to its spec object. */
export function budgetSlots(budgets) {
  const slots = [];
  const add = (key, label, spec) => {
    if (spec) slots.push({ key, label, spec });
  };
  add("shared.jsGzKb", "Shared JS (gz)", budgets.shared?.jsGzKb);
  for (const [route, r] of Object.entries(budgets.routes ?? {})) {
    const name = r.label ?? route;
    add(`routes.${route}.jsGzKb`, `${name} JS (gz)`, r.jsGzKb);
    add(`routes.${route}.documentBrKb`, `${name} document (br)`, r.documentBrKb);
    add(`routes.${route}.flightBrKb`, `${name} inline flight (br)`, r.flightBrKb);
  }
  add("lazyChunkGzKb", "Largest lazy chunk (gz)", budgets.lazyChunkGzKb);
  add("cssGzKb", "CSS (gz)", budgets.cssGzKb);
  add("fonts.preloadKb", "Preloaded fonts per route (raw)", budgets.fonts?.preloadKb);
  return slots;
}

/** The enforced limit for a new budget (design D4). Whole kB. */
export function limitFor(measuredKb, targetKb, headroom = 1.05) {
  const padded = Math.ceil(measuredKb * headroom);
  return measuredKb <= targetKb ? Math.min(targetKb, padded) : padded;
}

export const FAILING = new Set(["FAIL", "unset", "missing"]);

export function evaluateSlots(slots, measured) {
  return slots.map((slot) => {
    const value = measured.get(slot.key);
    const { target, limit, recorded } = slot.spec;
    let status;
    if (value === undefined) status = "missing";
    else if (limit === null || limit === undefined) status = "unset";
    else if (value > limit) status = "FAIL";
    else if (value > target) status = "over target";
    else status = "ok";
    return { key: slot.key, label: slot.label, value, target, limit: limit ?? null, recorded: recorded ?? null, status };
  });
}

/** Keys whose limit or target is higher than on the base branch. New keys are not raises. */
export function findRaisedLimits(baseBudgets, headBudgets) {
  const base = new Map(budgetSlots(baseBudgets).map((s) => [s.key, s.spec]));
  return budgetSlots(headBudgets)
    .filter((slot) => {
      const before = base.get(slot.key);
      if (!before) return false;
      const limitRaised = before.limit != null && slot.spec.limit != null && slot.spec.limit > before.limit;
      return limitRaised || slot.spec.target > before.target;
    })
    .map((slot) => slot.key);
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Raised keys without a `Perf budget raise: <key> <reason>` line in the PR body. */
export function missingRaiseReasons(keys, prBody) {
  return keys.filter(
    (key) => !new RegExp(`^\\s*Perf budget raise:\\s*${escapeRegExp(key)}\\s+\\S`, "mi").test(prBody ?? "")
  );
}

export function renderBudgetTable({ rows, shared, lazy, errors, warnings }) {
  const cell = (v) => (v === null || v === undefined ? "-" : String(v));
  const lines = [
    "## Performance budgets",
    "",
    "Sizes in kB (1 kB = 1024 bytes). JS and CSS: gzip -9 per file, summed. Documents and flight: brotli q11.",
    "",
    "| Budget | Measured | Limit | Target | Recorded | Status |",
    "|---|---:|---:|---:|---:|---|",
    ...rows.map((r) => `| ${r.label} | ${cell(r.value)} | ${cell(r.limit)} | ${cell(r.target)} | ${cell(r.recorded)} | ${r.status} |`),
    "",
    `Shared chunks (${shared.length}): ${shared.map((p) => p.split("/").pop()).join(", ") || "none"}`,
    "",
    `Largest lazy chunks: ${lazy.map((c) => `${c.path.split("/").pop()} ${kb(c.gz)}`).join(", ") || "none"}`,
  ];
  if (warnings.length) lines.push("", "**Warnings**", ...warnings.map((w) => `- ${w}`));
  if (errors.length) lines.push("", "**Errors**", ...errors.map((e) => `- ${e}`));
  return lines.join("\n");
}
```

### 10. New `frontend/perf-budgets.json`

Every `limit` and `recorded` starts as `null`; step 22 fills them from the measurement. `rum` feeds the weekly check (step 19).

```json
{
  "$comment": [
    "Performance budgets enforced by scripts/perf-budget.mjs in CI (WP22). Read frontend/README.md, 'Performance budgets'.",
    "Units: kB = 1024 bytes. JS and CSS: gzip -9 of each file, summed. Documents and inline flight: brotli quality 11.",
    "target: the goal (audits/remediation/research/performance-excellence.md section 4). limit: what CI enforces.",
    "New budget: add it with \"limit\": null and run `pnpm perf:budget --write-limits` on the perf build. It sets limit = min(target, ceil(measured x headroomRatio)) when measured <= target, else ceil(measured x headroomRatio).",
    "Raising a limit or a target needs the line `Perf budget raise: <key> <reason>` in the PR body; CI checks it.",
    "After 2 weeks of green RUM on a route, tighten its limit to the measured value x 1.05."
  ],
  "headroomRatio": 1.05,
  "shared": {
    "jsGzKb": { "target": 125, "limit": null, "recorded": null }
  },
  "routes": {
    "/": {
      "source": "html",
      "jsGzKb": { "target": 150, "limit": null, "recorded": null },
      "documentBrKb": { "target": 60, "limit": null, "recorded": null }
    },
    "/prices": {
      "source": "html",
      "jsGzKb": { "target": 155, "limit": null, "recorded": null },
      "documentBrKb": { "target": 70, "limit": null, "recorded": null },
      "flightBrKb": { "target": 22, "limit": null, "recorded": null }
    },
    "/market": {
      "source": "html",
      "jsGzKb": { "target": 165, "limit": null, "recorded": null },
      "documentBrKb": { "target": 60, "limit": null, "recorded": null }
    },
    "/analytics": {
      "source": "html",
      "jsGzKb": { "target": 150, "limit": null, "recorded": null }
    },
    "/compare": {
      "source": "html",
      "jsGzKb": { "target": 170, "limit": null, "recorded": null }
    },
    "/box-calculator": {
      "source": "html",
      "jsGzKb": { "target": 170, "limit": null, "recorded": null }
    },
    "/privacy": {
      "source": "html",
      "jsGzKb": { "target": 130, "limit": null, "recorded": null }
    },
    "/auth/login": {
      "source": "html",
      "thirdPartyAllow": ["https://challenges.cloudflare.com"],
      "jsGzKb": { "target": 130, "limit": null, "recorded": null }
    },
    "/product/900001": {
      "source": "html",
      "label": "/product/[id]",
      "jsGzKb": { "target": 145, "limit": null, "recorded": null },
      "documentBrKb": { "target": 30, "limit": null, "recorded": null }
    },
    "/portfolio": {
      "source": "manifest",
      "jsGzKb": { "target": 180, "limit": null, "recorded": null }
    }
  },
  "lazyChunkGzKb": { "target": 120, "limit": null, "recorded": null },
  "cssGzKb": { "target": 14, "limit": null, "recorded": null },
  "fonts": {
    "maxPreloads": 1,
    "preloadKb": { "target": 35, "limit": null, "recorded": null }
  },
  "calibration": {
    "pricesHtmlBytesProd": null,
    "measuredOn": null,
    "warnDriftRatio": 0.15
  },
  "rum": {
    "minSamples": 200,
    "since": "7d",
    "granularity": "7d",
    "filters": [],
    "metricIds": {
      "lcpMs": "vercel.speed_insights.lcp_ms",
      "lcpCount": "vercel.speed_insights.lcp_count",
      "inpMs": "vercel.speed_insights.inp_ms",
      "inpCount": "vercel.speed_insights.inp_count",
      "cls": "vercel.speed_insights.cls",
      "clsCount": "vercel.speed_insights.cls_count",
      "ttfbMs": "vercel.speed_insights.ttfb_ms",
      "ttfbCount": "vercel.speed_insights.ttfb_count"
    },
    "defaultTargets": { "lcpMs": 2500, "inpMs": 200, "cls": 0.1, "ttfbMs": 800 },
    "targets": {
      "/": { "lcpMs": 1800, "inpMs": 150, "cls": 0.05, "ttfbMs": 400 },
      "/prices": { "lcpMs": 1800, "inpMs": 150, "cls": 0.02, "ttfbMs": 400 },
      "/product/[id]": { "lcpMs": 1800, "inpMs": 150, "cls": 0.05, "ttfbMs": 900 },
      "/market": { "lcpMs": 2000, "inpMs": 150, "cls": 0.05, "ttfbMs": 400 },
      "/analytics": { "lcpMs": 1800, "inpMs": 150, "cls": 0.05, "ttfbMs": 400 },
      "/compare": { "lcpMs": 2000, "inpMs": 150, "cls": 0.05, "ttfbMs": 400 },
      "/box-calculator": { "lcpMs": 2000, "inpMs": 150, "cls": 0.05, "ttfbMs": 400 },
      "/portfolio": { "lcpMs": 2500, "inpMs": 200, "cls": 0.05, "ttfbMs": 900 },
      "/account": { "lcpMs": 2500, "inpMs": 200, "cls": 0.05, "ttfbMs": 900 },
      "/auth/login": { "lcpMs": 1500, "inpMs": 100, "cls": 0.02, "ttfbMs": 400 },
      "/auth/signup": { "lcpMs": 1500, "inpMs": 100, "cls": 0.02, "ttfbMs": 400 },
      "/privacy": { "lcpMs": 1500, "inpMs": 100, "cls": 0.02, "ttfbMs": 400 }
    }
  },
  "baseline": null
}
```

### 11. New `frontend/scripts/perf-budget.mjs`

```js
/* eslint-disable no-console -- terminal tool; console output is its UI. */
// Byte budgets for the perf build (WP22). Blocking in CI.
//
// Usage, from frontend/, with `node scripts/perf-serve.mjs` running on the
// output of `SUPABASE_STUB_FIXTURE=perf pnpm build:stub`:
//   pnpm perf:budget                  measure, compare, exit 1 on any breach
//   pnpm perf:budget --write-limits   also fill every "limit": null from this measurement
//
// Writes the table to stdout and $GITHUB_STEP_SUMMARY, and the full result to
// .perf/budget-result.json. On a pull_request event it also checks that every
// raised limit or target is explained in the PR body (design D4).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BUDGETS_FILE, NEXT_DIR, PERF_DIR, PERF_ORIGIN } from "./perf-config.mjs";
import {
  FAILING,
  budgetSlots,
  evaluateSlots,
  findRaisedLimits,
  kb,
  lazyChunks,
  limitFor,
  manifestAssets,
  measureAssetRoute,
  measureHtmlRoute,
  missingRaiseReasons,
  readAssetFromDisk,
  renderBudgetTable,
  sharedScripts,
  sum,
  unmatchedStubRequests,
} from "./perf-measure.mjs";

const WRITE_LIMITS = process.argv.slice(2).includes("--write-limits");

function pullRequestContext() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request" || !process.env.GITHUB_EVENT_PATH) return null;
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  let base = null;
  try {
    // In a PR merge commit, HEAD^1 is the base branch tip (checkout uses fetch-depth: 2).
    base = JSON.parse(
      execFileSync("git", ["show", "HEAD^1:./perf-budgets.json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    );
  } catch {
    base = null; // first PR that adds the file, or shallow history
  }
  return { body: event.pull_request?.body ?? "", base };
}

async function main() {
  const budgets = JSON.parse(fs.readFileSync(BUDGETS_FILE, "utf8"));
  const readAsset = readAssetFromDisk(NEXT_DIR);
  const errors = [];
  const warnings = [];

  try {
    await fetch(`${PERF_ORIGIN}/`).then((r) => r.arrayBuffer());
  } catch {
    throw new Error(`nothing answers on ${PERF_ORIGIN}; start \`node scripts/perf-serve.mjs\` first`);
  }

  const results = [];
  for (const [route, spec] of Object.entries(budgets.routes)) {
    const result =
      spec.source === "manifest"
        ? await measureAssetRoute(route, manifestAssets(NEXT_DIR, route), readAsset)
        : await measureHtmlRoute({ origin: PERF_ORIGIN, route, readAsset });
    if (result.error) errors.push(`${route}: ${result.error}`);
    else results.push(result);
  }

  // The manifest method must agree with the HTML on a route that has both.
  const prices = results.find((r) => r.route === "/prices");
  if (prices && Object.values(budgets.routes).some((s) => s.source === "manifest")) {
    try {
      const viaManifest = new Set(manifestAssets(NEXT_DIR, "/prices").scripts);
      const viaHtml = new Set(prices.scripts.map((s) => s.path));
      const onlyManifest = [...viaManifest].filter((p) => !viaHtml.has(p));
      const onlyHtml = [...viaHtml].filter((p) => !viaManifest.has(p));
      if (onlyManifest.length || onlyHtml.length) {
        warnings.push(
          `manifest-measured routes may be off: for /prices the manifest lists ${onlyManifest.length} extra and misses ${onlyHtml.length} of the HTML's scripts`
        );
      }
    } catch (err) {
      warnings.push(`manifest cross-check skipped: ${err.message}`);
    }
  }

  const measured = new Map();
  const byPath = new Map(results.flatMap((r) => r.scripts.map((s) => [s.path, s])));
  const shared = sharedScripts(results);
  measured.set("shared.jsGzKb", kb(sum(shared.map((p) => byPath.get(p)), "gz")));
  for (const r of results) {
    measured.set(`routes.${r.route}.jsGzKb`, kb(sum(r.scripts, "gz")));
    if (r.document) {
      measured.set(`routes.${r.route}.documentBrKb`, kb(r.document.br));
      measured.set(`routes.${r.route}.flightBrKb`, kb(r.flight.br));
    }
  }
  const buildManifest = JSON.parse(fs.readFileSync(path.join(NEXT_DIR, "build-manifest.json"), "utf8"));
  const polyfills = new Set((buildManifest.polyfillFiles ?? []).map((f) => `/_next/${f}`));
  const initial = new Set(byPath.keys());
  const lazy = lazyChunks(NEXT_DIR, initial, polyfills);
  measured.set("lazyChunkGzKb", kb(lazy[0]?.gz ?? 0));
  const css = new Map(results.flatMap((r) => r.stylesheets.map((s) => [s.path, s])));
  measured.set("cssGzKb", kb(sum([...css.values()], "gz")));
  measured.set("fonts.preloadKb", kb(Math.max(0, ...results.map((r) => sum(r.fontPreloads, "raw")))));

  for (const r of results) {
    if (r.fontPreloads.length > budgets.fonts.maxPreloads) {
      errors.push(`${r.route}: ${r.fontPreloads.length} font preloads (max ${budgets.fonts.maxPreloads})`);
    }
    const allowed = new Set(budgets.routes[r.route].thirdPartyAllow ?? []);
    for (const origin of r.thirdParty) if (!allowed.has(origin)) errors.push(`${r.route}: third-party script from ${origin}`);
  }

  const prodBytes = budgets.calibration?.pricesHtmlBytesProd;
  if (prices && prodBytes) {
    const drift = prices.document.raw / prodBytes - 1;
    const text = `calibration: fixture /prices HTML is ${prices.document.raw} bytes, production ${prodBytes} (${(drift * 100).toFixed(1)}%)`;
    warnings.push(Math.abs(drift) > budgets.calibration.warnDriftRatio ? `${text}, more than ${budgets.calibration.warnDriftRatio * 100}% apart: re-check the fixture` : text);
  } else {
    warnings.push("calibration.pricesHtmlBytesProd is not set: `curl -s https://www.pokefin.ca/prices | wc -c` and store it");
  }

  for (const miss of unmatchedStubRequests(PERF_DIR)) errors.push(`perf fixture has no route for ${miss}`);

  if (WRITE_LIMITS) {
    let written = 0;
    for (const slot of budgetSlots(budgets)) {
      const value = measured.get(slot.key);
      if (value === undefined || slot.spec.limit !== null) continue;
      slot.spec.limit = limitFor(value, slot.spec.target, budgets.headroomRatio);
      slot.spec.recorded = value;
      written += 1;
    }
    fs.writeFileSync(BUDGETS_FILE, `${JSON.stringify(budgets, null, 2)}\n`);
    console.log(`[perf:budget] wrote ${written} limit(s) to perf-budgets.json`);
  }

  const rows = evaluateSlots(budgetSlots(budgets), measured);
  for (const row of rows) {
    if (row.status === "FAIL") errors.push(`${row.key}: ${row.value} kB is over its limit of ${row.limit} kB`);
    if (row.status === "unset") errors.push(`${row.key}: limit is null; run \`pnpm perf:budget --write-limits\` and commit perf-budgets.json`);
    if (row.status === "missing") errors.push(`${row.key}: not measured (route failed above)`);
  }

  const pr = pullRequestContext();
  if (pr?.base) {
    const raised = findRaisedLimits(pr.base, budgets);
    if (raised.length) warnings.push(`raised in this PR: ${raised.join(", ")}`);
    for (const key of missingRaiseReasons(raised, pr.body)) {
      errors.push(`${key} was raised without a "Perf budget raise: ${key} <reason>" line in the PR body (edit the body, then re-run this job)`);
    }
  }

  const table = renderBudgetTable({ rows, shared, lazy: lazy.slice(0, 5), errors, warnings });
  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n\n`);
  fs.mkdirSync(PERF_DIR, { recursive: true });
  fs.writeFileSync(path.join(PERF_DIR, "budget-result.json"), `${JSON.stringify({ rows, errors, warnings, results }, null, 2)}\n`);

  if (errors.length || rows.some((r) => FAILING.has(r.status))) {
    for (const e of errors) console.error(`::error::perf budget: ${e}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[perf:budget]", err);
  process.exitCode = 1;
});
```

### 12. Lighthouse CI: new `frontend/lighthouserc.json` and `frontend/scripts/perf-lhci-summary.mjs`

12a. `frontend/lighthouserc.json`. The four `resource-summary` thresholds per URL start as `["warn", { "maxNumericValue": 1 }]` placeholders; step 23 replaces them with calibrated `error` values. Do not merge with a placeholder left.

```json
{
  "ci": {
    "collect": {
      "url": [
        "http://127.0.0.1:3100/",
        "http://127.0.0.1:3100/prices",
        "http://127.0.0.1:3100/product/900001",
        "http://127.0.0.1:3100/market"
      ],
      "numberOfRuns": 3,
      "settings": {
        "onlyCategories": ["performance"]
      }
    },
    "assert": {
      "assertMatrix": [
        {
          "matchingUrlPattern": "^http://127\\.0\\.0\\.1:3100/$",
          "assertions": {
            "cumulative-layout-shift": ["error", { "maxNumericValue": 0.05, "aggregationMethod": "median" }],
            "bf-cache": ["error", { "minScore": 1 }],
            "uses-responsive-images": ["error", { "maxLength": 0 }],
            "resource-summary:script:size": ["warn", { "maxNumericValue": 1, "aggregationMethod": "median" }],
            "resource-summary:image:size": ["warn", { "maxNumericValue": 1, "aggregationMethod": "median" }],
            "largest-contentful-paint": ["warn", { "maxNumericValue": 2500, "aggregationMethod": "median" }],
            "total-blocking-time": ["warn", { "maxNumericValue": 300, "aggregationMethod": "median" }]
          }
        },
        {
          "matchingUrlPattern": "^http://127\\.0\\.0\\.1:3100/prices$",
          "assertions": {
            "cumulative-layout-shift": ["error", { "maxNumericValue": 0.05, "aggregationMethod": "median" }],
            "bf-cache": ["error", { "minScore": 1 }],
            "uses-responsive-images": ["error", { "maxLength": 0 }],
            "resource-summary:script:size": ["warn", { "maxNumericValue": 1, "aggregationMethod": "median" }],
            "resource-summary:image:size": ["warn", { "maxNumericValue": 1, "aggregationMethod": "median" }],
            "largest-contentful-paint": ["warn", { "maxNumericValue": 2500, "aggregationMethod": "median" }],
            "total-blocking-time": ["warn", { "maxNumericValue": 300, "aggregationMethod": "median" }]
          }
        },
        {
          "matchingUrlPattern": "^http://127\\.0\\.0\\.1:3100/product/900001$",
          "assertions": {
            "cumulative-layout-shift": ["error", { "maxNumericValue": 0.05, "aggregationMethod": "median" }],
            "bf-cache": ["error", { "minScore": 1 }],
            "uses-responsive-images": ["warn", { "maxLength": 0 }],
            "resource-summary:script:size": ["warn", { "maxNumericValue": 1, "aggregationMethod": "median" }],
            "resource-summary:image:size": ["warn", { "maxNumericValue": 1, "aggregationMethod": "median" }],
            "largest-contentful-paint": ["warn", { "maxNumericValue": 2500, "aggregationMethod": "median" }],
            "total-blocking-time": ["warn", { "maxNumericValue": 300, "aggregationMethod": "median" }]
          }
        },
        {
          "matchingUrlPattern": "^http://127\\.0\\.0\\.1:3100/market$",
          "assertions": {
            "cumulative-layout-shift": ["error", { "maxNumericValue": 0.05, "aggregationMethod": "median" }],
            "bf-cache": ["error", { "minScore": 1 }],
            "uses-responsive-images": ["warn", { "maxLength": 0 }],
            "resource-summary:script:size": ["warn", { "maxNumericValue": 1, "aggregationMethod": "median" }],
            "resource-summary:image:size": ["warn", { "maxNumericValue": 1, "aggregationMethod": "median" }],
            "largest-contentful-paint": ["warn", { "maxNumericValue": 2500, "aggregationMethod": "median" }],
            "total-blocking-time": ["warn", { "maxNumericValue": 300, "aggregationMethod": "median" }]
          }
        }
      ]
    },
    "upload": {
      "target": "filesystem",
      "outputDir": "./lhci-reports"
    }
  }
}
```

`uses-responsive-images` is `warn` on `/product/900001` (the hero is the 743 px original) and `/market` (256 px thumbnails in 56 px rows) until the deferred image-derivative work (research §10, PX05) lands; that package must switch both to `error`.

12b. `frontend/scripts/perf-lhci-summary.mjs`:

```js
/* eslint-disable no-console -- terminal tool; console output is its UI. */
// Summarise Lighthouse CI results (WP22): per URL, the median of the runs for
// CLS, LCP, TBT, script and image transfer, bf-cache passes and oversized
// images, plus suggested byte limits (median x 1.10, rounded up to 1 KiB) for
// the resource-summary assertions in lighthouserc.json. Informational.
import fs from "node:fs";
import path from "node:path";
import { FRONTEND_DIR } from "./perf-config.mjs";

const DIR = path.join(FRONTEND_DIR, ".lighthouseci");
const median = (values) => {
  const s = values.filter((v) => typeof v === "number").sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const transfer = (lhr, type) =>
  lhr.audits["resource-summary"]?.details?.items?.find((i) => i.resourceType === type)?.transferSize ?? null;
const suggest = (bytes) => (bytes === null ? "-" : `${Math.ceil((bytes * 1.1) / 1024) * 1024} B`);

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /^lhr-.*\.json$/.test(f)) : [];
if (files.length === 0) {
  console.log("[perf:lhci-summary] no Lighthouse results in .lighthouseci/");
  process.exit(0);
}
const byUrl = new Map();
for (const file of files) {
  const lhr = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
  const url = new URL(lhr.requestedUrl).pathname;
  if (!byUrl.has(url)) byUrl.set(url, []);
  byUrl.get(url).push(lhr);
}
const lines = [
  "## Lighthouse CI (medians of the runs)",
  "",
  "| URL | CLS | LCP ms | TBT ms | Script KiB | Image KiB | bf-cache | Oversized images | Suggested script limit | Suggested image limit |",
  "|---|---:|---:|---:|---:|---:|---|---:|---:|---:|",
];
for (const [url, runs] of [...byUrl.entries()].sort()) {
  const script = median(runs.map((l) => transfer(l, "script")));
  const image = median(runs.map((l) => transfer(l, "image")));
  const num = (id) => median(runs.map((l) => l.audits[id]?.numericValue));
  const cls = num("cumulative-layout-shift");
  const bfPasses = runs.filter((l) => l.audits["bf-cache"]?.score === 1).length;
  const oversized = Math.max(...runs.map((l) => l.audits["uses-responsive-images"]?.details?.items?.length ?? 0));
  lines.push(
    `| ${url} | ${cls === null ? "-" : cls.toFixed(3)} | ${Math.round(num("largest-contentful-paint") ?? 0)} | ${Math.round(num("total-blocking-time") ?? 0)} | ${script === null ? "-" : (script / 1024).toFixed(1)} | ${image === null ? "-" : (image / 1024).toFixed(1)} | ${bfPasses}/${runs.length} pass | ${oversized} | ${suggest(script)} | ${suggest(image)} |`
  );
}
const table = lines.join("\n");
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n\n`);
```

### 13. `frontend/package.json`: two scripts

In `"scripts"`, after `"build:stub"`, add:

```json
    "perf:serve": "node scripts/perf-serve.mjs",
    "perf:budget": "node scripts/perf-budget.mjs",
```

No dependency changes. `pnpm-lock.yaml` must not change in this PR.

### 14. `.github/workflows/ci.yml`: the gate in the existing required job

Only the `frontend` job changes. Keep its `name:` byte for byte (branch protection requires it). Do not touch the other jobs, including WP21's `database` job.

14a. In the frontend job's checkout step, add `fetch-depth: 2` next to `persist-credentials: false` (the raise check reads the base branch's `perf-budgets.json` from `HEAD^1`):

```yaml
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
          # HEAD^1 of a PR merge commit is the base tip: perf-budget.mjs
          # compares perf-budgets.json with it to enforce the raise rule.
          fetch-depth: 2
```

14b. Change the job's `timeout-minutes: 20` to `timeout-minutes: 30`.

14c. Replace the step

```yaml
      - name: Production build (Supabase stub)
        run: pnpm build:stub
```

(and its three comment lines above it) with:

```yaml
      # Full `next build` against the local Supabase stub serving the
      # synthetic perf fixture (306 products, WP22). Still the build gate,
      # and the output the budget and Lighthouse steps below measure.
      - name: Production build (Supabase stub, perf fixture)
        env:
          SUPABASE_STUB_FIXTURE: perf
        run: pnpm build:stub
      - name: Start perf server
        run: |
          nohup node scripts/perf-serve.mjs > "$RUNNER_TEMP/perf-serve.log" 2>&1 &
          echo $! > "$RUNNER_TEMP/perf-serve.pid"
          for i in $(seq 120); do
            if [ -f .perf/ready ]; then echo "perf server ready after ${i}s"; exit 0; fi
            if ! kill -0 "$(cat "$RUNNER_TEMP/perf-serve.pid")" 2>/dev/null; then
              cat "$RUNNER_TEMP/perf-serve.log"; exit 1
            fi
            sleep 1
          done
          cat "$RUNNER_TEMP/perf-serve.log"; exit 1
      - name: Performance budgets (bytes, blocking)
        run: pnpm perf:budget
      # Pinned and run with dlx so the lockfile does not change. Blocks on
      # CLS, bf-cache, byte totals and catalog image sizing; LCP and TBT only
      # warn (runner variance is 20 to 30%).
      - name: Lighthouse CI
        run: pnpm dlx @lhci/cli@0.15.1 autorun
      - name: Lighthouse summary
        if: always()
        run: node scripts/perf-lhci-summary.mjs
      # Second run: the fixture-coverage test now sees the build and serve
      # request logs and fails on any Supabase endpoint without a fixture route.
      - name: Perf fixture coverage (node --test)
        if: always()
        run: pnpm run test:scripts
      - name: Upload performance reports
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: perf-reports
          path: |
            frontend/.perf/
            frontend/lhci-reports/
            frontend/.lighthouseci/
          if-no-files-found: ignore
          retention-days: 14
      - name: Stop perf server
        if: always()
        run: |
          if [ -f "$RUNNER_TEMP/perf-serve.pid" ]; then kill "$(cat "$RUNNER_TEMP/perf-serve.pid")" 2>/dev/null || true; fi
          tail -n 40 "$RUNNER_TEMP/perf-serve.log" 2>/dev/null || true
```

If `pnpm dlx @lhci/cli@0.15.1 autorun` fails before collecting anything because pnpm 11 refuses a dependency's build script, replace that one command with `npx --yes @lhci/cli@0.15.1 autorun` and say so in the PR; do not add `@lhci/cli` to `package.json`.

Checks after editing (repo root):

```bash
python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/ci.yml')); print([j['name'] for j in d['jobs'].values()]); print([s.get('name', s.get('run', s.get('uses'))) for s in d['jobs']['frontend']['steps']])"
# job names unchanged; frontend steps end with: ... Production build (Supabase stub, perf fixture), Start perf server,
# Performance budgets (bytes, blocking), Lighthouse CI, Lighthouse summary, Perf fixture coverage (node --test),
# Upload performance reports, Stop perf server
```

### 15. New `frontend/scripts/gh-issue.mjs` (one open issue per label, shared by the smoke and RUM jobs)

```js
// One open GitHub issue per label (WP22). Used by prod-smoke.mjs and
// rum-weekly.mjs inside GitHub Actions, through the gh CLI with GH_TOKEN and
// GH_REPO set by the workflow. Never used locally.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

function bodyFile(body) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gh-issue-")), "body.md");
  fs.writeFileSync(file, body);
  return file;
}

function openIssueNumber(label) {
  const list = JSON.parse(gh(["issue", "list", "--label", label, "--state", "open", "--json", "number", "--limit", "1"]));
  return list[0]?.number ?? null;
}

/** Create the label's open issue, or comment on it if one exists. */
export function upsertIssue({ label, title, body, color = "B60205", description = "Opened by a WP22 monitoring workflow" }) {
  gh(["label", "create", label, "--color", color, "--description", description, "--force"]);
  const number = openIssueNumber(label);
  if (number) gh(["issue", "comment", String(number), "--body-file", bodyFile(body)]);
  else gh(["issue", "create", "--title", title, "--label", label, "--body-file", bodyFile(body)]);
}

/** Comment on and close the label's open issue, if there is one. */
export function resolveIssue({ label, body }) {
  const number = openIssueNumber(label);
  if (!number) return;
  gh(["issue", "comment", String(number), "--body-file", bodyFile(body)]);
  gh(["issue", "close", String(number)]);
}
```

### 16. Production confirmation: new `frontend/scripts/prod-confirm.mjs` and `.github/workflows/prod-confirm.yml`

16a. `frontend/scripts/prod-confirm.mjs`:

```js
/* eslint-disable no-console -- terminal tool; console output is its UI. */
// Production confirmation after a deploy (WP22). Informational: it never
// fails. Measures the budget routes on the live site with the same functions
// and units as the CI gate, records x-vercel-cache, checks the apex redirect
// and the /prices calibration, and writes a table to the job summary.
// Usage: node scripts/prod-confirm.mjs [--origin https://www.pokefin.ca]
import fs from "node:fs";
import { BUDGETS_FILE } from "./perf-config.mjs";
import { kb, measureHtmlRoute, readAssetOverHttp, sum } from "./perf-measure.mjs";

const flag = process.argv.indexOf("--origin");
const ORIGIN = flag > -1 ? process.argv[flag + 1] : "https://www.pokefin.ca";
const APEX = "https://pokefin.ca/";
const CACHED = new Set(["HIT", "STALE", "PRERENDER"]);

async function main() {
  const budgets = JSON.parse(fs.readFileSync(BUDGETS_FILE, "utf8"));
  const readAsset = readAssetOverHttp(ORIGIN);
  const warnings = [];
  const pricesHtml = await (await fetch(`${ORIGIN}/prices`)).text();
  const productId = /\/product\/(\d+)/.exec(pricesHtml)?.[1] ?? null;
  let calibration = null;

  const lines = [
    "## Production confirmation",
    "",
    `Origin ${ORIGIN}. Same units as the CI budget table (kB = 1024 bytes; JS gzip -9 per file; document brotli q11).`,
    "",
    "| Route | HTTP | x-vercel-cache | Document raw bytes | Document br kB | JS gz kB | CI limit kB |",
    "|---|---:|---|---:|---:|---:|---:|",
  ];
  for (const [budgetRoute, spec] of Object.entries(budgets.routes)) {
    if (spec.source === "manifest") continue;
    const route = budgetRoute.startsWith("/product/") ? (productId ? `/product/${productId}` : null) : budgetRoute;
    if (!route) {
      warnings.push(`no /product/<id> link found on /prices; ${budgetRoute} skipped`);
      continue;
    }
    await fetch(ORIGIN + route).then((r) => r.arrayBuffer()).catch(() => undefined); // warm-up
    const r = await measureHtmlRoute({ origin: ORIGIN, route, readAsset });
    const cache = r.headers.cache ?? "absent";
    if (r.error) {
      lines.push(`| ${route} | ${r.status} | ${cache} | - | - | - | - |`);
      warnings.push(`${route}: ${r.error}`);
      continue;
    }
    const jsKb = kb(sum(r.scripts, "gz"));
    const limit = spec.jsGzKb?.limit ?? null;
    lines.push(`| ${route} | 200 | ${cache} | ${r.document.raw} | ${kb(r.document.br)} | ${jsKb} | ${limit ?? "-"} |`);
    if (!CACHED.has(cache)) warnings.push(`${route}: x-vercel-cache is ${cache} after a warm-up request (expected HIT, STALE or PRERENDER)`);
    if (limit !== null && jsKb > limit) warnings.push(`${route}: production JS ${jsKb} kB is over the CI limit ${limit} kB (the Vercel build differs from the CI build)`);
    if (budgetRoute === "/prices" && budgets.calibration?.pricesHtmlBytesProd) {
      const drift = r.document.raw / budgets.calibration.pricesHtmlBytesProd - 1;
      calibration = `/prices calibration: ${r.document.raw} bytes live vs ${budgets.calibration.pricesHtmlBytesProd} recorded (${(drift * 100).toFixed(1)}%)`;
    }
  }
  if (calibration) lines.push("", calibration);

  const apex = await fetch(APEX, { redirect: "manual" });
  const location = apex.headers.get("location") ?? "";
  lines.push("", `Apex: ${APEX} answered ${apex.status} to ${location || "(no location)"}`);
  if (apex.status !== 308 || !location.startsWith("https://www.pokefin.ca")) {
    warnings.push(`apex redirect is ${apex.status} to "${location}" (expected one 308 to https://www.pokefin.ca/)`);
  }

  if (warnings.length) lines.push("", "**Warnings**", ...warnings.map((w) => `- ${w}`));
  const report = lines.join("\n");
  console.log(report);
  for (const w of warnings) console.log(`::warning::${w}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}

main().catch((err) => console.log(`::warning::prod-confirm could not finish: ${err.message}`));
```

16b. `.github/workflows/prod-confirm.yml`:

```yaml
name: Production confirmation

# After each successful Production deployment (Vercel's GitHub integration
# sends deployment_status), measure the live site with the same units as the
# CI budget gate. Informational only: it never blocks anything (WP22).
on:
  deployment_status:

permissions:
  contents: read

jobs:
  confirm:
    name: Production bytes and CDN cache (informational)
    if: github.event.deployment_status.state == 'success' && github.event.deployment.environment == 'Production'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    continue-on-error: true
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: "22"
      # The production alias moves to the new deployment around the time the
      # success event fires; give it a moment.
      - run: sleep 30
      - name: Measure www.pokefin.ca
        run: node scripts/prod-confirm.mjs --origin https://www.pokefin.ca
```

### 17. Production smoke test: new `frontend/scripts/prod-smoke-lib.mjs`, `frontend/scripts/prod-smoke.mjs`, `.github/workflows/prod-smoke.yml`

17a. `frontend/scripts/prod-smoke-lib.mjs` (pure; tested by `scripts/prod-smoke-lib.test.mjs`):

```js
// Pure helpers for the daily production smoke test (WP22).

// Money as WP07's formatMoney prints it: $12.34, C$1,234.56, US$5.00 (optionally followed by a currency code).
export const PRICE_RE = /(?:C\$|US\$|\$)\s?\d{1,3}(?:,\d{3})*\.\d{2}/g;

// minPrices: calibrated against production at implementation time (step 17d).
export const PUBLIC_CHECKS = [
  { path: "/", minPrices: 3 },
  { path: "/prices", minPrices: 50 },
  { path: "/market", minPrices: 50 },
  { path: "/analytics", minPrices: 1 },
  { path: "/box-calculator", minPrices: 1 },
];
export const PRODUCT_MIN_PRICES = 1;
export const SITEMAP_MIN_PRODUCTS = 200;
export const ERROR_MARKERS = ["Something went wrong", "This page could not be found", "Application error"];

export const countPrices = (text) => (text.match(PRICE_RE) ?? []).length;

/** Judge one rendered public page. */
export function judgePage({ path, status, finalPath, text, minPrices }) {
  const prices = countPrices(text ?? "");
  const marker = ERROR_MARKERS.find((m) => (text ?? "").includes(m));
  let reason = null;
  if (status !== 200) reason = `HTTP ${status}`;
  else if (finalPath !== path) reason = `redirected to ${finalPath}`;
  else if (marker) reason = `error page ("${marker}")`;
  else if (prices < minPrices) reason = `${prices} prices (needs ${minPrices})`;
  return { name: path, ok: reason === null, detail: reason ?? `HTTP 200, ${prices} prices` };
}

export function firstProductId(html) {
  return /\/product\/(\d+)/.exec(html ?? "")?.[1] ?? null;
}

export function countSitemapProducts(xml) {
  return ((xml ?? "").match(/<loc>[^<]*\/product\/\d+\/?<\/loc>/g) ?? []).length;
}

/** Playwright cookies from a copied `cookie:` request header; only Supabase auth cookies (sb-*) are kept. */
export function cookiesFromHeader(header, domain) {
  return (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      return { name: part.slice(0, eq), value: part.slice(eq + 1) };
    })
    .filter((c) => c.name.startsWith("sb-") && c.value)
    .map((c) => ({ ...c, domain, path: "/", httpOnly: true, secure: true, sameSite: "Lax" }));
}

export const SESSION_RESEED_HELP = [
  "The smoke test's signed-in session is no longer valid (the run was sent to /auth/login).",
  "Either the rotating session chain broke (a failed run, a cache eviction after 7 idle days, or the smoke account's session was used elsewhere), or sign-in is broken on the site. Check the site first: sign in with any account and open /portfolio.",
  "",
  "To re-seed (owner):",
  "1. Open a private browser window, sign in to https://www.pokefin.ca as the smoke account, open /portfolio.",
  "2. DevTools, Network, click the /portfolio document request, copy the full value of the `cookie` request header.",
  "3. Close the private window without signing out (signing out revokes the session).",
  "4. GitHub, Settings, Secrets and variables, Actions: replace SMOKE_SESSION_SEED with the copied value.",
  "5. Actions, Production smoke, Run workflow. This issue closes when the signed-in leg passes.",
].join("\n");

export function renderSummary(result, runUrl) {
  const rows = [...result.checks, { name: "Signed in", ok: result.auth.status === "ok" || result.auth.status === "not-configured", detail: result.auth.detail }];
  return [
    `## Production smoke: ${result.failed ? "FAILING" : "passing"}`,
    "",
    `Origin ${result.origin}, ${result.startedAt}${runUrl ? `, run ${runUrl}` : ""}`,
    "",
    "| Check | Result | Detail |",
    "|---|---|---|",
    ...rows.map((r) => `| ${r.name} | ${r.ok ? "ok" : "FAIL"} | ${r.detail}${r.retried ? " (after one retry)" : ""} |`),
    "",
    result.failed
      ? "Likely causes: the scraper stopped for 14+ days (migration 0023 then withholds every price), an RPC failing or timing out, a deploy that renders without data, or a broken signed-in route."
      : "",
  ].join("\n");
}
```

17b. `frontend/scripts/prod-smoke.mjs`:

```js
/* eslint-disable no-console -- terminal tool; console output is its UI. */
// Daily production smoke test (WP22). Playwright against the live site.
//
//   node scripts/prod-smoke.mjs            run the checks, write $SMOKE_RESULT, exit 1 on failure
//   node scripts/prod-smoke.mjs --report   open, update or close the GitHub issues from $SMOKE_RESULT
//
// Env: SMOKE_ORIGIN (default https://www.pokefin.ca), SMOKE_PRODUCT_ID
// (optional), PLAYWRIGHT_PREFIX (npm prefix where playwright is installed),
// SMOKE_STATE_IN / SMOKE_STATE_OUT (Playwright storage state of the rotating
// session), SMOKE_SESSION_SEED (cookie header, used when there is no state),
// SMOKE_RESULT (result JSON path), RUN_URL. The export response body (the
// smoke account's data) is never read or logged; only its status.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { resolveIssue, upsertIssue } from "./gh-issue.mjs";
import * as lib from "./prod-smoke-lib.mjs";

const ORIGIN = process.env.SMOKE_ORIGIN || "https://www.pokefin.ca";
const RESULT = process.env.SMOKE_RESULT || path.join(process.cwd(), ".perf", "smoke-result.json");
const RUN_URL = process.env.RUN_URL || "";

function loadPlaywright() {
  const prefix = process.env.PLAYWRIGHT_PREFIX;
  const requireFrom = createRequire(prefix ? path.join(prefix, "noop.cjs") : import.meta.url);
  return requireFrom("playwright");
}

async function visit(page, url) {
  const res = await page.goto(url, { waitUntil: "load", timeout: 45_000 });
  const text = await page.locator("body").innerText({ timeout: 15_000 }).catch(() => "");
  return { status: res?.status() ?? 0, finalPath: new URL(page.url()).pathname, text, html: await page.content() };
}

async function withRetry(run) {
  const first = await run();
  if (first.ok) return first;
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  return { ...(await run()), retried: true };
}

async function signedInLeg(browser) {
  const stateIn = process.env.SMOKE_STATE_IN;
  const seed = process.env.SMOKE_SESSION_SEED;
  let context;
  if (stateIn && fs.existsSync(stateIn)) context = await browser.newContext({ storageState: stateIn });
  else if (seed) {
    context = await browser.newContext();
    await context.addCookies(lib.cookiesFromHeader(seed, new URL(ORIGIN).hostname));
  } else {
    return { status: "not-configured", detail: "no SMOKE_SESSION_SEED or saved session; signed-in checks skipped" };
  }
  const page = await context.newPage();
  const portfolioApi = page
    .waitForResponse((r) => new URL(r.url()).pathname === "/api/portfolio" && r.request().method() === "GET", { timeout: 30_000 })
    .catch(() => null);
  const nav = await page.goto(`${ORIGIN}/portfolio`, { waitUntil: "load", timeout: 45_000 });
  if (new URL(page.url()).pathname.startsWith("/auth/login")) {
    await context.close();
    return { status: "session-expired", detail: "redirected to /auth/login: the saved session is no longer valid" };
  }
  const api = await portfolioApi;
  const exportStatus = await page.evaluate(async () => {
    const res = await fetch("/api/account/export", { method: "POST", headers: { "x-pokefin-request": "1" } });
    return res.status;
  });
  // Save even when a check failed: proxy.ts has rotated the refresh token,
  // and only the new one is valid tomorrow.
  if (process.env.SMOKE_STATE_OUT) await context.storageState({ path: process.env.SMOKE_STATE_OUT });
  await context.close();
  const ok = nav?.status() === 200 && api?.status() === 200 && exportStatus === 200;
  return {
    status: ok ? "ok" : "failed",
    detail: `/portfolio ${nav?.status() ?? "no response"}, /api/portfolio ${api?.status() ?? "not called"}, export ${exportStatus}`,
  };
}

async function runChecks() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const result = { origin: ORIGIN, startedAt: new Date().toISOString(), checks: [], auth: { status: "not-configured", detail: "" } };
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    let pricesHtml = "";
    for (const check of lib.PUBLIC_CHECKS) {
      result.checks.push(
        await withRetry(async () => {
          const seen = await visit(page, ORIGIN + check.path);
          if (check.path === "/prices") pricesHtml = seen.html;
          return lib.judgePage({ ...check, ...seen });
        })
      );
    }
    const productId = process.env.SMOKE_PRODUCT_ID || lib.firstProductId(pricesHtml);
    if (productId) {
      const productPath = `/product/${productId}`;
      result.checks.push(
        await withRetry(async () => lib.judgePage({ path: productPath, minPrices: lib.PRODUCT_MIN_PRICES, ...(await visit(page, ORIGIN + productPath)) }))
      );
    } else {
      result.checks.push({ name: "/product/<id>", ok: false, detail: "no product link on /prices and SMOKE_PRODUCT_ID unset" });
    }
    const sitemap = await context.request.get(`${ORIGIN}/sitemap.xml`);
    const products = lib.countSitemapProducts(await sitemap.text());
    result.checks.push({
      name: "/sitemap.xml",
      ok: sitemap.status() === 200 && products >= lib.SITEMAP_MIN_PRODUCTS,
      detail: `HTTP ${sitemap.status()}, ${products} product URLs (needs ${lib.SITEMAP_MIN_PRODUCTS})`,
    });
    await context.close();
    result.auth = await signedInLeg(browser);
  } finally {
    await browser.close();
  }
  result.failed = result.checks.some((c) => !c.ok) || result.auth.status === "failed";
  fs.mkdirSync(path.dirname(RESULT), { recursive: true });
  fs.writeFileSync(RESULT, `${JSON.stringify(result, null, 2)}\n`);
  const summary = lib.renderSummary(result, RUN_URL);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (result.failed) process.exitCode = 1;
}

function report() {
  if (!fs.existsSync(RESULT)) {
    upsertIssue({ label: "prod-smoke", title: "Production smoke test failing", body: `The smoke run crashed before writing a result.\n\n${RUN_URL}` });
    return;
  }
  const result = JSON.parse(fs.readFileSync(RESULT, "utf8"));
  if (result.failed) upsertIssue({ label: "prod-smoke", title: "Production smoke test failing", body: lib.renderSummary(result, RUN_URL) });
  else resolveIssue({ label: "prod-smoke", body: `Passing again.\n\n${RUN_URL}` });
  if (result.auth.status === "session-expired") {
    upsertIssue({ label: "prod-smoke-session", title: "Smoke test session needs a re-seed", color: "FBCA04", body: `${lib.SESSION_RESEED_HELP}\n\n${RUN_URL}` });
  } else if (result.auth.status === "ok") {
    resolveIssue({ label: "prod-smoke-session", body: `Signed-in checks pass again.\n\n${RUN_URL}` });
  }
}

if (process.argv.includes("--report")) report();
else
  runChecks().catch((err) => {
    console.error("[prod-smoke]", err);
    process.exitCode = 1;
  });
```

17c. `.github/workflows/prod-smoke.yml`:

```yaml
name: Production smoke

# Daily check that production renders prices and that a signed-in user can
# load the portfolio and export their data (WP22). Opens, updates or closes
# one issue labelled prod-smoke (and prod-smoke-session when the smoke
# account's session needs a re-seed).
on:
  schedule:
    - cron: "7 11 * * *"
  workflow_dispatch:

permissions:
  contents: read
  issues: write

concurrency:
  group: prod-smoke
  cancel-in-progress: false

jobs:
  smoke:
    name: Production smoke
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      SMOKE_ORIGIN: https://www.pokefin.ca
      SMOKE_PRODUCT_ID: ${{ vars.SMOKE_PRODUCT_ID }}
      PLAYWRIGHT_PREFIX: ${{ runner.temp }}/pw
      SMOKE_STATE_IN: ${{ runner.temp }}/smoke-state.json
      SMOKE_STATE_OUT: ${{ runner.temp }}/smoke-state-new.json
      SMOKE_RESULT: ${{ runner.temp }}/smoke-result.json
      RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: "22"
      # Pinned, installed outside the repo: no lockfile change.
      - name: Install Playwright
        run: |
          mkdir -p "$PLAYWRIGHT_PREFIX"
          npm install --no-save --no-audit --no-fund --prefix "$PLAYWRIGHT_PREFIX" playwright@1.63.0
          "$PLAYWRIGHT_PREFIX/node_modules/.bin/playwright" install --with-deps chromium
      - name: Restore the rotating session
        uses: actions/cache/restore@v6
        with:
          path: ${{ runner.temp }}/smoke-state.enc
          key: smoke-session-${{ github.run_id }}
          restore-keys: smoke-session-
      - name: Decrypt the session
        env:
          SMOKE_STATE_KEY: ${{ secrets.SMOKE_STATE_KEY }}
        run: |
          if [ -n "$SMOKE_STATE_KEY" ] && [ -f "$RUNNER_TEMP/smoke-state.enc" ]; then
            openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:SMOKE_STATE_KEY \
              -in "$RUNNER_TEMP/smoke-state.enc" -out "$SMOKE_STATE_IN" \
              || { echo "::warning::could not decrypt the saved smoke session; falling back to SMOKE_SESSION_SEED"; rm -f "$SMOKE_STATE_IN"; }
          fi
      - name: Smoke test
        env:
          SMOKE_SESSION_SEED: ${{ secrets.SMOKE_SESSION_SEED }}
        run: node scripts/prod-smoke.mjs
      - name: Encrypt the rotated session
        id: encrypt
        if: always()
        env:
          SMOKE_STATE_KEY: ${{ secrets.SMOKE_STATE_KEY }}
        run: |
          if [ -n "$SMOKE_STATE_KEY" ] && [ -f "$SMOKE_STATE_OUT" ]; then
            openssl enc -e -aes-256-cbc -pbkdf2 -iter 200000 -pass env:SMOKE_STATE_KEY \
              -in "$SMOKE_STATE_OUT" -out "$RUNNER_TEMP/smoke-state.enc"
            echo "saved=true" >> "$GITHUB_OUTPUT"
          fi
          rm -f "$SMOKE_STATE_IN" "$SMOKE_STATE_OUT"
      - name: Save the rotating session
        if: always() && steps.encrypt.outputs.saved == 'true'
        uses: actions/cache/save@v6
        with:
          path: ${{ runner.temp }}/smoke-state.enc
          key: smoke-session-${{ github.run_id }}
      - name: Open, update or close issues
        if: always()
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
        run: node scripts/prod-smoke.mjs --report
```

17d. Calibrate the page thresholds against production before committing (needs network; Playwright is installed only in a temp prefix):

```bash
mkdir -p /tmp/wp22-pw && npm install --no-save --no-audit --no-fund --prefix /tmp/wp22-pw playwright@1.63.0
/tmp/wp22-pw/node_modules/.bin/playwright install chromium
PLAYWRIGHT_PREFIX=/tmp/wp22-pw SMOKE_RESULT=/tmp/wp22-smoke.json node scripts/prod-smoke.mjs; echo "exit=$?"
```

Read the printed table. For each public page, set its `minPrices` in `prod-smoke-lib.mjs` to `max(1, floor(observed / 3))` if that is lower than the default above, so a normal day passes with a wide margin while a page with no prices still fails; never raise a default. If `/analytics` shows 0 prices because the page renders returns rather than money, set its `minPrices` to 0 and add `{ path: "/analytics", minReturns: 10 }` handling: in `judgePage`, also count `/[+−-]?\d{1,3}\.\d%/g` matches and fail when fewer than `minReturns`; add a test case for it. The signed-in row shows "not configured" locally; that is expected. The run must end with exit=0. If it cannot (production really is broken, or no network), say so in the PR and leave the defaults.

### 18. Speed Insights configuration: new `frontend/app/lib/rum.ts`, new `frontend/app/components/SpeedInsightsClient.tsx`, edit `frontend/app/layout.tsx`

18a. `frontend/app/lib/rum.ts`:

```ts
/**
 * Speed Insights `beforeSend` (WP22): drop the query string and hash from the
 * reported URL. /prices?q= carries what the visitor typed, and grouping is by
 * route pattern anyway. Typed structurally: the Next entry of
 * @vercel/speed-insights does not export its event type.
 */
export function stripQueryFromVitalsUrl<T extends { url: string }>(event: T): T {
  const cut = event.url.search(/[?#]/);
  return cut === -1 ? event : { ...event, url: event.url.slice(0, cut) };
}
```

18b. `frontend/app/components/SpeedInsightsClient.tsx`:

```tsx
"use client";

import { SpeedInsights } from "@vercel/speed-insights/next";
import { stripQueryFromVitalsUrl } from "../lib/rum";

/**
 * Speed Insights with the site's settings (WP22). A client wrapper because
 * the root layout is a server component and cannot pass a function prop.
 * sampleRate 1: traffic is low, so every sample counts; lower it only if the
 * plan's monthly data-point allowance runs out (Vercel, Usage).
 */
export default function SpeedInsightsClient() {
  return <SpeedInsights sampleRate={1} beforeSend={stripQueryFromVitalsUrl} />;
}
```

18c. `frontend/app/layout.tsx`: replace the line `import { SpeedInsights } from "@vercel/speed-insights/next"` (it has no semicolon at `a188fea`; match it with or without one) with

```tsx
import SpeedInsightsClient from "./components/SpeedInsightsClient";
```

and the element `<SpeedInsights />` with `<SpeedInsightsClient />`. Change nothing else in the layout (WP13, WP14, WP20 and later packages own the rest). Check: `grep -n "SpeedInsights" app/layout.tsx` prints exactly the new import and `<SpeedInsightsClient />`.

### 19. Weekly RUM check: new `frontend/scripts/rum-weekly.mjs` and `.github/workflows/rum-weekly.yml`

19a. `frontend/scripts/rum-weekly.mjs`:

```js
/* eslint-disable no-console -- terminal tool; console output is its UI. */
// Weekly real-user check (WP22): p75 LCP, INP, CLS and TTFB per route over
// the last 7 days from Vercel Speed Insights (`vercel metrics`), compared
// with rum.targets in perf-budgets.json. Routes with fewer than
// rum.minSamples samples are "insufficient data", never a breach. A breach
// opens or updates the issue labelled perf-regression; a clean week closes it.
// Env: VERCEL_TOKEN, VERCEL_PROJECT (default pokefin), VERCEL_SCOPE
// (optional team slug), RUN_URL, GH_TOKEN and GH_REPO for the issue.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveIssue, upsertIssue } from "./gh-issue.mjs";
import { BUDGETS_FILE, PERF_DIR } from "./perf-config.mjs";

export const METRICS = [
  { key: "lcpMs", countKey: "lcpCount", label: "LCP", unit: " ms" },
  { key: "inpMs", countKey: "inpCount", label: "INP", unit: " ms" },
  { key: "cls", countKey: "clsCount", label: "CLS", unit: "" },
  { key: "ttfbMs", countKey: "ttfbCount", label: "TTFB", unit: " ms" },
];

/**
 * Route -> number from `vercel metrics --group-by route --format json`.
 * Tolerant of the exact shape: any object with a string `route` (directly or
 * under groups/dimensions/group) and a numeric value/p75/sum/count. Throws
 * when nothing matches or a route repeats (time-bucketed output).
 */
export function extractRouteValues(json) {
  const out = new Map();
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const route = [node.route, node.groups?.route, node.dimensions?.route, node.group?.route].find((v) => typeof v === "string");
    const value = [node.value, node.p75, node.sum, node.count].find((v) => typeof v === "number");
    if (route !== undefined && value !== undefined) {
      if (out.has(route)) throw new Error(`route ${route} appears twice: the output is time-bucketed; adjust rum.granularity in perf-budgets.json`);
      out.set(route, value);
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(json);
  if (out.size === 0) throw new Error("unrecognised `vercel metrics --format json` output (raw output saved in .perf/rum-raw/)");
  return out;
}

/** One row per route and metric. */
export function evaluateRum({ rum, p75, counts }) {
  const rows = [];
  for (const metric of METRICS) {
    for (const [route, value] of p75[metric.key] ?? new Map()) {
      const samples = counts[metric.key]?.get(route) ?? 0;
      const target = (rum.targets[route] ?? rum.defaultTargets)[metric.key];
      const status = samples < rum.minSamples ? "insufficient data" : value > target ? "breach" : "ok";
      rows.push({ route, metric: metric.label, unit: metric.unit, value, target, samples, status });
    }
  }
  return rows.sort((a, b) => a.route.localeCompare(b.route) || a.metric.localeCompare(b.metric));
}

export function renderRumReport(rows, { since, runUrl }) {
  const fmt = (row, v) => (row.metric === "CLS" ? v.toFixed(3) : `${Math.round(v)}${row.unit}`);
  const breaches = rows.filter((r) => r.status === "breach");
  return [
    `## Real-user p75, last ${since}: ${breaches.length ? `${breaches.length} breach(es)` : "no breach"}`,
    "",
    runUrl ? `Run: ${runUrl}` : "",
    "",
    "| Route | Metric | p75 | Target | Samples | Status |",
    "|---|---|---:|---:|---:|---|",
    ...rows.map((r) => `| ${r.route} | ${r.metric} | ${fmt(r, r.value)} | ${fmt(r, r.target)} | ${r.samples} | ${r.status} |`),
    "",
    "Targets: frontend/perf-budgets.json `rum`. Read a breach in Vercel, Speed Insights, filtered to the route, then open the metric's element attribution (research/performance-excellence.md section 6).",
  ].join("\n");
}

function query(metricId, aggregation, rum, env) {
  const args = ["metrics", metricId, "--aggregation", aggregation, "--group-by", "route", "--since", rum.since, "--limit", "100", "--prod", "--project", env.project, "--format", "json", "--token", env.token];
  if (rum.granularity) args.push("--granularity", rum.granularity);
  for (const filter of rum.filters ?? []) args.push("--filter", filter);
  if (env.scope) args.push("--scope", env.scope);
  const out = execFileSync("vercel", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const rawDir = path.join(PERF_DIR, "rum-raw");
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, `${metricId}.${aggregation}.json`), out);
  return extractRouteValues(JSON.parse(out));
}

function main() {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    console.log("::notice::VERCEL_TOKEN is not set; the weekly RUM check is skipped.");
    return;
  }
  const { rum } = JSON.parse(fs.readFileSync(BUDGETS_FILE, "utf8"));
  const env = { token, project: process.env.VERCEL_PROJECT || "pokefin", scope: process.env.VERCEL_SCOPE || "" };
  const p75 = {};
  const counts = {};
  for (const metric of METRICS) {
    p75[metric.key] = query(rum.metricIds[metric.key], "p75", rum, env);
    counts[metric.key] = query(rum.metricIds[metric.countKey], "sum", rum, env);
  }
  const rows = evaluateRum({ rum, p75, counts });
  const report = renderRumReport(rows, { since: rum.since, runUrl: process.env.RUN_URL ?? "" });
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  if (!process.env.GH_TOKEN) return;
  if (rows.some((r) => r.status === "breach")) {
    upsertIssue({ label: "perf-regression", title: "Real-user performance regression", color: "D93F0B", body: report });
  } else {
    resolveIssue({ label: "perf-regression", body: `No route breaches its p75 target this week.\n\n${process.env.RUN_URL ?? ""}` });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (err) {
    console.error(`::error::rum-weekly: ${err.message}`);
    process.exitCode = 1;
  }
}
```

19b. `.github/workflows/rum-weekly.yml`:

```yaml
name: RUM weekly

# Weekly real-user p75 check against frontend/perf-budgets.json (WP22).
#
# Disabled until the owner confirms that `vercel metrics schema
# vercel.speed_insights` works on this Vercel plan and sets the repository
# variable RUM_WEEKLY_ENABLED to true. If the schema command fails on the
# plan, leave the variable unset: the self-hosted web-vitals beacon
# (research/performance-excellence.md section 6, fallback) is a follow-up.
on:
  schedule:
    - cron: "7 13 * * 1"
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  rum:
    name: Real-user p75 check
    if: vars.RUM_WEEKLY_ENABLED == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: "22"
      - name: Install the Vercel CLI (pinned)
        run: npm install --global --no-audit --no-fund vercel@61.1.0
      - name: Compare p75 with the targets
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_PROJECT: ${{ vars.VERCEL_PROJECT }}
          VERCEL_SCOPE: ${{ vars.VERCEL_SCOPE }}
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: node scripts/rum-weekly.mjs
      - name: Upload raw metrics
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: rum-raw
          path: frontend/.perf/rum-raw/
          if-no-files-found: ignore
          retention-days: 30
```

### 20. Lazy Sentry in the error boundaries: `frontend/app/error.tsx`, `frontend/app/global-error.tsx`

In both files:

- Delete `import * as Sentry from "@sentry/nextjs";`.
- Replace the whole `useEffect(() => { ... }, [error]);` block with:

```tsx
  useEffect(() => {
    // No-op until NEXT_PUBLIC_SENTRY_DSN is set (see instrumentation-client.ts).
    // Loaded on demand (WP22): error boundaries ship with every route, so a
    // static import put the SDK in every page's first-load JS. The DSN is
    // inlined at build time, so a build without one contains no import.
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
    void import("@sentry/nextjs")
      .then((Sentry) => Sentry.captureException(error))
      .catch(() => undefined);
  }, [error]);
```

Keep everything else (WP15's markup and inline styles, WP17's behaviour). Check: `grep -n "sentry" app/error.tsx app/global-error.tsx` prints only the comment and the `import("@sentry/nextjs")` line in each file.

### 21. `frontend/README.md`: document the gate

Add this section after WP00's "Building without a Supabase project" section:

````markdown
## Performance budgets (CI)

Every PR builds the app against a synthetic 306-product catalog and fails when a route's bytes, layout stability or bfcache eligibility regress. Locally, from `frontend/`:

```bash
SUPABASE_STUB_FIXTURE=perf pnpm build:stub   # stub on 127.0.0.1:3100, fixture "perf"
pnpm perf:serve                              # stub + next start behind http://127.0.0.1:3100 (keep it running)
pnpm perf:budget                             # in a second terminal: the budget table, exit 1 on a breach
pnpm dlx @lhci/cli@0.15.1 autorun            # optional, needs Chrome: Lighthouse as in CI
```

- Budgets live in `perf-budgets.json`: `target` is the goal, `limit` is enforced (1 kB = 1024 bytes; JS and CSS gzip -9 per file; documents brotli).
- A new route goes into `perf-budgets.json` in the same PR, with `"limit": null`; then run `pnpm perf:budget --write-limits` and commit the file.
- A new Supabase query the public pages make needs a route in `scripts/fixtures/perf.mjs` in the same PR; the perf build fails otherwise.
- Raising a `limit` or `target` needs `Perf budget raise: <key> <reason>` in the PR body. CI checks it.
- Lighthouse assertions (`lighthouserc.json`) are never loosened to get green.
- Production is checked by three workflows: `prod-confirm.yml` (after each deploy, informational), `prod-smoke.yml` (daily, opens a `prod-smoke` issue) and `rum-weekly.yml` (weekly real-user p75, opens a `perf-regression` issue once enabled).

`.perf/`, `.lighthouseci/` and `lhci-reports/` are local outputs and are git-ignored. The `.next/` of a perf build is a stub build: never deploy it.
````

### 22. First measurement: build, serve, write the limits, calibrate

From `frontend/`:

```bash
SUPABASE_STUB_FIXTURE=perf pnpm build:stub > /tmp/wp22-perf-build.log 2>&1; echo "exit=$?"
# exit=0, the log shows "(fixture: perf)", a stub URL of http://127.0.0.1:3100, and no "(no fixture route)" lines.
# A "(no fixture route)" line: add the route in scripts/fixtures/perf.mjs (step 5) and rebuild.
node scripts/perf-serve.mjs > /tmp/wp22-serve.log 2>&1 &
for i in $(seq 120); do [ -f .perf/ready ] && break; node -e "setTimeout(()=>{},1000)"; done; cat .perf/ready
pnpm perf:budget --write-limits; echo "exit=$?"
# exit=0; "wrote N limit(s)" with N = 20 (one per budget slot); every row "ok" or "over target".
```

Then calibration, if you have network:

```bash
PROD=$(curl -s https://www.pokefin.ca/prices | wc -c); echo "$PROD"
```

Put the number into `calibration.pricesHtmlBytesProd` and today's date (`YYYY-MM-DD`) into `calibration.measuredOn` in `perf-budgets.json`, then run `pnpm perf:budget` again and read the calibration warning. More than 15% apart: compare the fixture's `/prices` HTML with production's (card count, set group count, name lengths) and adjust `scripts/fixtures/perf.mjs` (set-name word counts, variant rate, image share), then rebuild and re-measure; if it stays apart after one adjustment, keep it, since calibration only warns, and state the numbers in the PR. Without network, leave both `null` and list it under Owner actions.

Stop the server (`kill %1` or `pkill -f scripts/perf-serve.mjs`) and check `git diff perf-budgets.json`: only `limit`, `recorded` and the calibration fields changed. Every `limit` below its `target` equals `min(target, ceil(recorded x 1.05))`; every `limit` above its `target` equals `ceil(recorded x 1.05)`. Paste the table into the PR.

### 23. Lighthouse calibration (one CI round trip)

1. Push the branch and open the PR (draft) with the placeholder `resource-summary` assertions from step 12a. CI runs Lighthouse; the placeholders only warn.
2. Open the job summary's "Lighthouse CI (medians of the runs)" table. For each URL, copy "Suggested script limit" and "Suggested image limit" (bytes).
3. In `lighthouserc.json`, replace each URL's two placeholders with `["error", { "maxNumericValue": <suggested bytes>, "aggregationMethod": "median" }]`.
4. In the same table check: CLS below 0.05 and bf-cache "3/3 pass" on all four URLs, and 0 oversized images on `/` and `/prices`. If a URL fails bf-cache or CLS, find the cause in the uploaded report (`perf-reports` artifact, `lhci-reports/*.html`, "Page prevented back/forward cache restoration" or "Avoid large layout shifts"). A real defect in the page is out of scope: switch only that URL's assertion to `warn`, open a follow-up issue with the reason and the report, and list it in the PR. Do the same if `uses-responsive-images` fails on `/` or `/prices`. Never raise the CLS threshold.
5. Push. The Lighthouse step must now pass with every remaining assertion at `error`.

`grep -c '"maxNumericValue": 1,' lighthouserc.json` must print 0 before merge.

## Pitfalls: do not do this

- **Do not enforce the research targets directly as limits.** Several are below what the site measures today (the shared floor alone is about 141 kB against 125); CI would be red on day one. The ratchet in D4 is the decision. Equally, do not set limits by hand to round numbers "with room": a 30 kB regression must fail.
- **Do not count `nomodule` scripts.** The polyfill chunk (39.5 kB gz) is never downloaded by the browsers that matter; WP12's ad hoc script counted it, this gate does not. Do not "fix" the numbers to match WP12's.
- **Do not run the perf stub on an ephemeral port.** `NEXT_PUBLIC_SUPABASE_URL` is inlined at build time; `perf-serve` must answer on the same address (127.0.0.1:3100). Use `127.0.0.1` everywhere, never `localhost`: the CSP's `'self'` compares origins as strings.
- **Do not serve the stub and the app on different origins, and do not add the stub's origin to the CSP in `next.config.ts`.** The front door exists so production code stays untouched. The CSP rewrite in `proxyRequest` is test-harness only.
- **Do not add a fixture route that returns `[]` to silence the coverage check** unless production also returns nothing to the anon key. Empty data makes a page cheap and the budget meaningless.
- **Do not commit scraped data, real product photos or a production dump** into the fixture. Names, prices and images are generated; that is a hard rule (no TCGplayer data redistribution, trust-seo-brand.md §9).
- **Do not make Lighthouse timings blocking** (LCP, TBT, Speed Index). Runner variance is 20 to 30%. Do not raise the CLS threshold or switch `bf-cache` to warn to get a PR green; step 23 is the only sanctioned exception path, with a follow-up issue.
- **Do not add `@lhci/cli`, `playwright` or `vercel` to `package.json`.** They run through `pnpm dlx`, a temp npm prefix and a global install, pinned by version, so `pnpm-lock.yaml` does not change.
- **Do not rename the `Frontend (lint + typecheck + tests)` job or add a new required job.** Branch protection requires the existing names; the gate is steps in the existing job.
- **Do not put a Supabase service-role key, a password or a Turnstile bypass in GitHub** to make the signed-in smoke leg work. The rotating session is the design; WP21 removed the service key from everything that does not need it.
- **Do not log the export response body or the session state.** The smoke script reads the status only; the state file is encrypted before it touches the cache and deleted from the runner after use. Never upload it as an artifact.
- **Do not sign out of the smoke account in the browser you copied the seed from.** Signing out revokes the session family and breaks the chain. Close the private window instead.
- **Do not pass `beforeSend` from `layout.tsx` directly.** The layout is a server component; a function prop to the client `SpeedInsights` component fails the build ("Functions cannot be passed directly to Client Components"). Use the `SpeedInsightsClient` wrapper.
- **Do not lower `sampleRate`** below 1 in this PR. Traffic is low; sampling would push routes below the 200-sample floor.
- **Do not keep a static `@sentry/nextjs` import anywhere in `app/`** (WP17's logger already loads it lazily). The test in "Tests" enforces it for the two error boundaries.
- **Do not enable `rum-weekly.yml` by removing its `if:`.** It stays gated on `RUM_WEEKLY_ENABLED` until the owner has confirmed the metrics are available on the plan.
- **Do not deploy, `vercel deploy --prebuilt`, or `next start` for anything but measurement on a perf build.** Its `.next/` is a stub build with synthetic data (WP00 rule).
- **Do not run the perf build or `perf-serve` while another agent builds in the same checkout.** Both use `.next/` and ports 3100 and 3101.
- **Do not commit `.perf/`, `.lighthouseci/` or `lhci-reports/`**, nor `frontend/AGENTS.md` or `frontend/CLAUDE.md` if a dev server wrote them. `git status --porcelain` must list only the files in the Commit section.

## Tests

Node test runner (`pnpm run test:scripts`, files in `frontend/scripts/*.test.mjs`) for the tooling, Jest for the two app changes.

### 1. `frontend/scripts/supabase-stub.test.mjs` (update: 4 new tests)

Add to the import block: `import fs from "node:fs";`, `import http from "node:http";`, `import path from "node:path";`, `import { fileURLToPath } from "node:url";`. Append:

```js
test('fixture "perf" serves 306 summaries, .single() objects and images', async () => {
  const fx = await startSupabaseStub({ port: 0, fixture: "perf" });
  try {
    const res = await fetch(`${fx.url}/rest/v1/rpc/get_market_product_summaries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-range"), "0-305/306");
    const rows = await res.json();
    assert.equal(rows.length, 306);
    assert.ok(rows[0].image_url.startsWith(`${fx.url}/storage/v1/object/public/product-images/products/`));

    const single = await fetch(`${fx.url}/rest/v1/exchange_rates?select=usd_to_cad,recorded_at&order=recorded_at.desc&limit=1`, {
      headers: { accept: "application/vnd.pgrst.object+json" },
    });
    assert.equal(single.status, 200);
    assert.equal(typeof (await single.json()).usd_to_cad, "number");

    const img = await fetch(`${fx.url}/storage/v1/object/public/product-images/products/900001_thumb.webp`);
    assert.equal(img.headers.get("content-type"), "image/webp");
    assert.ok((await img.arrayBuffer()).byteLength > 5000);
  } finally {
    await fx.close();
  }
});

test("the perf fixture reports endpoints it does not cover", async () => {
  const seen = [];
  const fx = await startSupabaseStub({
    port: 0,
    fixture: "perf",
    onRequest: (method, url, info) => seen.push({ path: url.split("?")[0], matched: info.matched }),
  });
  try {
    const res = await fetch(`${fx.url}/rest/v1/some_new_table?select=*`);
    assert.deepEqual(await res.json(), []);
    assert.deepEqual(seen, [{ path: "/rest/v1/some_new_table", matched: false }]);
  } finally {
    await fx.close();
  }
});

test("fallthrough proxies app paths and drops upgrade-insecure-requests and HSTS", async () => {
  const app = http.createServer((req, res) => {
    res.writeHead(200, {
      "content-type": "text/html",
      "content-security-policy": "default-src 'self'; upgrade-insecure-requests",
      "strict-transport-security": "max-age=1",
    });
    res.end(`<p>${req.url}</p>`);
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const fx = await startSupabaseStub({ port: 0, fixture: "perf", fallthrough: `http://127.0.0.1:${app.address().port}` });
  try {
    const page = await fetch(`${fx.url}/prices?q=x`);
    assert.equal(await page.text(), "<p>/prices?q=x</p>");
    assert.equal(page.headers.get("content-security-policy"), "default-src 'self'");
    assert.equal(page.headers.get("strict-transport-security"), null);
    const api = await fetch(`${fx.url}/rest/v1/rpc/get_set_analytics`, { method: "POST", body: "{}" });
    assert.equal((await api.json()).length, 55);
  } finally {
    await fx.close();
    app.closeAllConnections();
    await new Promise((resolve) => app.close(resolve));
  }
});

// Meaningful in CI's second test:scripts run, after the perf build and
// perf-serve wrote their request logs; skipped when the logs do not exist.
test("the perf build and perf server hit no endpoint the fixture does not cover", (t) => {
  const perfDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".perf");
  const buildLog = path.join(perfDir, "build-requests.json");
  const serveLog = path.join(perfDir, "serve-requests.ndjson");
  if (!fs.existsSync(buildLog) && !fs.existsSync(serveLog)) {
    t.skip("no perf request logs; run SUPABASE_STUB_FIXTURE=perf pnpm build:stub and scripts/perf-serve.mjs first");
    return;
  }
  const unmatched = [];
  if (fs.existsSync(buildLog)) {
    const log = JSON.parse(fs.readFileSync(buildLog, "utf8"));
    if (log.fixture === "perf") unmatched.push(...log.requests.filter((r) => !r.matched).map((r) => `build ${r.method} ${r.path}`));
  }
  if (fs.existsSync(serveLog)) {
    for (const line of fs.readFileSync(serveLog, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(line);
      if (!r.matched) unmatched.push(`serve ${r.method} ${r.path}`);
    }
  }
  assert.deepEqual(unmatched, []);
});
```

WP00's four and WP08's three tests must still pass unchanged.

### 2. New `frontend/scripts/perf-fixture.test.mjs` (9 tests)

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PERF_HISTORY_IDS,
  PERF_STALE_IDS,
  PRICE_STALENESS_DAYS,
  buildPerfData,
  mulberry32,
  productImage,
} from "./fixtures/perf.mjs";
import { applyPostgrest } from "./fixtures/postgrest.mjs";

const NOW = new Date("2026-09-30T15:00:00Z");
const BASE = "http://127.0.0.1:3100";
const data = buildPerfData({ now: NOW, baseUrl: BASE });
const query = (table, qs) => applyPostgrest(data[table], new URL(`${BASE}/rest/v1/x?${qs}`));

test("mulberry32 is deterministic", () => {
  const a = mulberry32(1);
  const b = mulberry32(1);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("the same now gives the same data", () => {
  assert.deepEqual(buildPerfData({ now: NOW, baseUrl: BASE }), data);
});

test("cardinality follows production", () => {
  assert.equal(data.summaries.length, 306);
  assert.equal(new Set(data.summaries.map((r) => r.set_id)).size, 55);
  assert.equal(new Set(data.summaries.map((r) => r.generation_id)).size, 9);
  assert.equal(new Set(data.summaries.map((r) => r.product_type_label)).size, 12);
  const variants = data.summaries.filter((r) => r.variant !== null).length;
  assert.ok(variants >= 30 && variants <= 62, `variants: ${variants}`);
  const priced = data.summaries.filter((r) => r.usd_price !== null).length;
  assert.ok(data.volume.length >= priced * 0.7 && data.volume.length <= priced * 0.9, `volume rows: ${data.volume.length}`);
  assert.equal(data.setAnalytics.length, 55);
  assert.equal(data.setAnalytics.reduce((s, r) => s + r.product_count, 0), 306);
});

test("prices are log-normal between $5 and $2,000", () => {
  const prices = data.summaries.map((r) => r.usd_price).filter((p) => p !== null).sort((a, b) => a - b);
  assert.ok(prices[0] >= 5 && prices.at(-1) <= 2000);
  const median = prices[Math.floor(prices.length / 2)];
  assert.ok(median > 40 && median < 200, `median: ${median}`);
});

test("300 fresh prices, and 6 stale ones withheld as migration 0023 does", () => {
  const ageDays = (r) => (NOW.getTime() - Date.parse(`${r.price_recorded_at}Z`)) / 86_400_000;
  const stale = data.summaries.filter((r) => PERF_STALE_IDS.includes(r.id));
  assert.equal(stale.length, 6);
  for (const r of stale) {
    assert.equal(r.usd_price, null);
    assert.equal(r.return_1d, null);
    assert.ok(ageDays(r) > PRICE_STALENESS_DAYS);
  }
  for (const r of data.summaries.filter((s) => !PERF_STALE_IDS.includes(s.id))) {
    assert.notEqual(r.usd_price, null);
    assert.ok(ageDays(r) < 2);
  }
});

test("365 days of history for the Lighthouse products, ending at the current price", () => {
  for (const id of PERF_HISTORY_IDS) {
    const rows = query("history", `product_id=eq.${id}&order=recorded_at.asc`);
    assert.equal(rows.length, 365);
    assert.equal(rows.at(-1).usd_price, data.summaries.find((r) => r.id === id).usd_price);
  }
});

test("PostgREST subset: in, gte, order, limit, select with alias; unsupported syntax throws", () => {
  const rows = query("history", "select=pid:product_id,usd_price&product_id=in.(900001,900002)&recorded_at=gte.2026-09-01&order=recorded_at.desc&limit=3");
  assert.equal(rows.length, 3);
  assert.deepEqual(Object.keys(rows[0]), ["pid", "usd_price"]);
  assert.throws(() => query("history", "or=(product_id.eq.1)"), /not supported/);
  assert.throws(() => query("history", "select=id,sets(name)"), /not supported/);
});

test("images: jpeg original, webp thumbnail, null otherwise", () => {
  const original = productImage("/storage/v1/object/public/product-images/products/900001.jpg");
  const thumb = productImage("/storage/v1/object/public/product-images/products/900001_thumb.webp");
  assert.equal(original.raw.headers["content-type"], "image/jpeg");
  assert.equal(thumb.raw.headers["content-type"], "image/webp");
  assert.ok(original.raw.body.length > thumb.raw.body.length);
  assert.equal(productImage("/storage/v1/object/public/product-images/other/file.txt"), null);
});

test("RPC rows carry exactly the columns of app/types/database.ts", (t) => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "types", "database.ts");
  if (!fs.existsSync(file)) {
    t.skip("app/types/database.ts not present (WP20)");
    return;
  }
  const src = fs.readFileSync(file, "utf8");
  const pairs = [
    ["get_market_product_summaries", "summaries"],
    ["get_market_product_volume_metrics", "volume"],
    ["get_set_analytics", "setAnalytics"],
  ];
  for (const [rpc, table] of pairs) {
    const block = new RegExp(`${rpc}:\\s*\\{[\\s\\S]*?Returns:\\s*\\{([\\s\\S]*?)\\}\\[\\]`).exec(src);
    assert.ok(block, `${rpc} not found in database.ts`);
    const columns = [...block[1].matchAll(/^\s*([a-z0-9_]+)\??:/gm)].map((m) => m[1]).sort();
    assert.deepEqual(Object.keys(data[table][0]).sort(), columns, rpc);
  }
});
```

If the last test fails because the generated types list a column the fixture lacks (or the reverse), fix the fixture, never the test.

### 3. New `frontend/scripts/perf-measure.test.mjs` (6 tests)

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  budgetSlots,
  evaluateSlots,
  findRaisedLimits,
  limitFor,
  manifestAssets,
  missingRaiseReasons,
  parseDocument,
  sharedScripts,
} from "./perf-measure.mjs";

const HTML = `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="/_next/static/chunks/a.css?dpl=1" data-precedence="next"/>
<link rel="preload" href="/_next/static/media/geist.woff2" as="font" crossorigin="" type="font/woff2"/>
<script src="/_next/static/chunks/main.js" async=""></script>
<script src="/_next/static/chunks/polyfill.js" noModule=""></script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async></script>
</head><body><script>self.__next_f.push([1,"abc"])</script><script>self.__next_f.push([1,"def"])</script><script>window.x=1</script></body></html>`;

test("parseDocument: module scripts only, third parties, stylesheet, font preload, flight", () => {
  const doc = parseDocument(HTML);
  assert.deepEqual(doc.scripts, ["/_next/static/chunks/main.js"]);
  assert.deepEqual(doc.thirdParty, ["https://challenges.cloudflare.com"]);
  assert.deepEqual(doc.stylesheets, ["/_next/static/chunks/a.css"]);
  assert.deepEqual(doc.fontPreloads, ["/_next/static/media/geist.woff2"]);
  assert.equal(doc.flight, 'self.__next_f.push([1,"abc"])self.__next_f.push([1,"def"])');
});

test("manifestAssets: rootMainFiles plus every entryJSFiles list", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp22-manifest-"));
  fs.mkdirSync(path.join(dir, "server", "app", "portfolio"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "build-manifest.json"),
    JSON.stringify({ rootMainFiles: ["static/chunks/root.js"], polyfillFiles: ["static/chunks/poly.js"] })
  );
  const manifest = {
    entryJSFiles: {
      "[project]/app/layout": ["static/chunks/layout.js"],
      "[project]/app/portfolio/page": ["static/chunks/layout.js", "static/chunks/page.js"],
    },
    entryCSSFiles: { "[project]/app/layout": [{ path: "static/chunks/a.css", inlined: false }] },
  };
  fs.writeFileSync(
    path.join(dir, "server", "app", "portfolio", "page_client-reference-manifest.js"),
    `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST["/portfolio/page"] = ${JSON.stringify(manifest)};`
  );
  assert.deepEqual(manifestAssets(dir, "/portfolio"), {
    scripts: ["/_next/static/chunks/root.js", "/_next/static/chunks/layout.js", "/_next/static/chunks/page.js"],
    stylesheets: ["/_next/static/chunks/a.css"],
  });
});

test("sharedScripts is the intersection of every route's scripts", () => {
  const r = (...paths) => ({ scripts: paths.map((p) => ({ path: p })) });
  assert.deepEqual(sharedScripts([r("a", "b", "c"), r("b", "c", "d"), r("c", "b")]), ["b", "c"]);
});

test("limitFor: 5% headroom, capped at the target while under it", () => {
  assert.equal(limitFor(100, 150), 105);
  assert.equal(limitFor(148, 150), 150);
  assert.equal(limitFor(163.9, 155), 173);
});

test("evaluateSlots: ok, over target, FAIL, unset", () => {
  const budgets = {
    shared: { jsGzKb: { target: 125, limit: 150, recorded: 141 } },
    routes: {
      "/a": { jsGzKb: { target: 150, limit: 160, recorded: 150 } },
      "/b": { jsGzKb: { target: 150, limit: null, recorded: null } },
    },
    cssGzKb: { target: 14, limit: 12, recorded: 11 },
  };
  const measured = new Map([["shared.jsGzKb", 141], ["routes./a.jsGzKb", 161], ["routes./b.jsGzKb", 100], ["cssGzKb", 11]]);
  const status = Object.fromEntries(evaluateSlots(budgetSlots(budgets), measured).map((row) => [row.key, row.status]));
  assert.deepEqual(status, { "shared.jsGzKb": "over target", "routes./a.jsGzKb": "FAIL", "routes./b.jsGzKb": "unset", cssGzKb: "ok" });
});

test("a raised limit needs a reason line; a new route is not a raise", () => {
  const base = { routes: { "/a": { jsGzKb: { target: 150, limit: 160 } } } };
  const head = { routes: { "/a": { jsGzKb: { target: 150, limit: 170 } }, "/new": { jsGzKb: { target: 150, limit: 140 } } } };
  const raised = findRaisedLimits(base, head);
  assert.deepEqual(raised, ["routes./a.jsGzKb"]);
  assert.deepEqual(missingRaiseReasons(raised, "no reason here"), ["routes./a.jsGzKb"]);
  assert.deepEqual(missingRaiseReasons(raised, "Perf budget raise: routes./a.jsGzKb"), ["routes./a.jsGzKb"]);
  assert.deepEqual(missingRaiseReasons(raised, "Summary\nPerf budget raise: routes./a.jsGzKb index chart adds 9 kB"), []);
});
```

### 4. New `frontend/scripts/prod-smoke-lib.test.mjs` (5 tests)

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { cookiesFromHeader, countPrices, countSitemapProducts, firstProductId, judgePage, renderSummary } from "./prod-smoke-lib.mjs";

test("countPrices matches formatMoney output only", () => {
  assert.equal(countPrices("$59.99 USD, C$82.10 and US$1,234.50; 12.5% and $5"), 3);
});

test("judgePage: pass, no prices, HTTP error, redirect, error page", () => {
  const base = { path: "/prices", status: 200, finalPath: "/prices", minPrices: 50 };
  assert.equal(judgePage({ ...base, text: "$1.00 ".repeat(60) }).ok, true);
  assert.match(judgePage({ ...base, text: "-- -- --" }).detail, /0 prices \(needs 50\)/);
  assert.match(judgePage({ ...base, status: 500, text: "" }).detail, /HTTP 500/);
  assert.match(judgePage({ ...base, finalPath: "/auth/login", text: "$1.00" }).detail, /redirected/);
  assert.match(judgePage({ ...base, text: `Something went wrong ${"$1.00 ".repeat(60)}` }).detail, /error page/);
});

test("firstProductId and countSitemapProducts", () => {
  assert.equal(firstProductId('<a href="/product/123456">x</a><a href="/product/9">'), "123456");
  assert.equal(firstProductId("<p>none</p>"), null);
  const xml = "<urlset><url><loc>https://www.pokefin.ca/</loc></url><url><loc>https://www.pokefin.ca/product/1</loc></url><url><loc>https://www.pokefin.ca/product/2</loc></url></urlset>";
  assert.equal(countSitemapProducts(xml), 2);
});

test("cookiesFromHeader keeps only non-empty sb- cookies, scoped to the host", () => {
  const cookies = cookiesFromHeader("_ga=1; sb-abc-auth-token.0=base64-eyJ=; sb-abc-auth-token.1=more; sb-empty=", "www.pokefin.ca");
  assert.deepEqual(cookies.map((c) => c.name), ["sb-abc-auth-token.0", "sb-abc-auth-token.1"]);
  assert.equal(cookies[0].value, "base64-eyJ=");
  assert.equal(cookies[0].domain, "www.pokefin.ca");
  assert.equal(cookies[0].secure, true);
});

test("renderSummary lists every check and the signed-in leg", () => {
  const md = renderSummary(
    { origin: "https://www.pokefin.ca", startedAt: "2026-09-30T11:07:00Z", failed: true, checks: [{ name: "/prices", ok: false, detail: "0 prices (needs 50)", retried: true }], auth: { status: "ok", detail: "/portfolio 200, /api/portfolio 200, export 200" } },
    "https://example.test/run/1"
  );
  assert.match(md, /FAILING/);
  assert.match(md, /\| \/prices \| FAIL \| 0 prices \(needs 50\) \(after one retry\) \|/);
  assert.match(md, /\| Signed in \| ok \|/);
});
```

### 5. New `frontend/scripts/rum-weekly.test.mjs` (3 tests)

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateRum, extractRouteValues, renderRumReport } from "./rum-weekly.mjs";

test("extractRouteValues reads flat and nested shapes", () => {
  assert.deepEqual([...extractRouteValues([{ route: "/", value: 1500 }, { route: "/prices", value: 2100 }])], [["/", 1500], ["/prices", 2100]]);
  assert.deepEqual([...extractRouteValues({ data: [{ groups: { route: "/market" }, p75: 1900 }] })], [["/market", 1900]]);
});

test("extractRouteValues rejects unknown and time-bucketed output", () => {
  assert.throws(() => extractRouteValues({ foo: 1 }), /unrecognised/);
  assert.throws(() => extractRouteValues([{ route: "/", value: 1 }, { route: "/", value: 2 }]), /time-bucketed/);
});

test("evaluateRum: a breach needs enough samples; unknown routes use the defaults", () => {
  const rum = {
    minSamples: 200,
    targets: { "/prices": { lcpMs: 1800, inpMs: 150, cls: 0.02, ttfbMs: 400 } },
    defaultTargets: { lcpMs: 2500, inpMs: 200, cls: 0.1, ttfbMs: 800 },
  };
  const p75 = { lcpMs: new Map([["/prices", 2100], ["/new", 2600], ["/quiet", 9000]]) };
  const counts = { lcpMs: new Map([["/prices", 450], ["/new", 300], ["/quiet", 12]]) };
  const rows = evaluateRum({ rum, p75, counts });
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.route, r.status])), { "/new": "breach", "/prices": "breach", "/quiet": "insufficient data" });
  assert.match(renderRumReport(rows, { since: "7d", runUrl: "" }), /2 breach/);
});
```

### 6. New `frontend/app/lib/__tests__/rum.test.ts` (3 tests)

```ts
import { stripQueryFromVitalsUrl } from "../rum";

describe("stripQueryFromVitalsUrl", () => {
  it("drops the query string and the hash", () => {
    expect(stripQueryFromVitalsUrl({ type: "vital", url: "https://www.pokefin.ca/prices?q=etb&sort=price#top" }).url).toBe(
      "https://www.pokefin.ca/prices"
    );
  });
  it("returns the same object when there is nothing to strip", () => {
    const event = { type: "vital", url: "https://www.pokefin.ca/product/42" };
    expect(stripQueryFromVitalsUrl(event)).toBe(event);
  });
  it("keeps the other fields", () => {
    expect(stripQueryFromVitalsUrl({ type: "vital", url: "https://x.test/a?b=1", route: "/a" })).toEqual({ type: "vital", url: "https://x.test/a", route: "/a" });
  });
});
```

### 7. New `frontend/app/components/__tests__/SpeedInsightsClient.test.tsx` (1 test)

```tsx
import { render } from "@testing-library/react";
import SpeedInsightsClient from "../SpeedInsightsClient";
import { stripQueryFromVitalsUrl } from "../../lib/rum";

const mockProps: unknown[] = [];
jest.mock("@vercel/speed-insights/next", () => ({
  SpeedInsights: (props: unknown) => {
    mockProps.push(props);
    return null;
  },
}));

it("samples every page view and strips query strings before sending", () => {
  render(<SpeedInsightsClient />);
  expect(mockProps).toEqual([{ sampleRate: 1, beforeSend: stripQueryFromVitalsUrl }]);
});
```

### 8. New `frontend/app/__tests__/errorBoundarySentry.test.tsx` (4 tests)

```tsx
import fs from "node:fs";
import path from "node:path";
import { render, waitFor } from "@testing-library/react";
import ErrorPage from "../error";

const mockCaptureException = jest.fn();
jest.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

const ORIGINAL_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
afterEach(() => {
  if (ORIGINAL_DSN === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  else process.env.NEXT_PUBLIC_SENTRY_DSN = ORIGINAL_DSN;
  mockCaptureException.mockReset();
});

it("reports through a lazy import when a DSN is set", async () => {
  process.env.NEXT_PUBLIC_SENTRY_DSN = "https://key@o1.ingest.us.sentry.io/2";
  const error = new Error("boom");
  render(<ErrorPage error={error} reset={() => {}} />);
  await waitFor(() => expect(mockCaptureException).toHaveBeenCalledWith(error));
});

it("does nothing without a DSN", async () => {
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  render(<ErrorPage error={new Error("quiet")} reset={() => {}} />);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mockCaptureException).not.toHaveBeenCalled();
});

it.each(["error.tsx", "global-error.tsx"])("%s imports @sentry/nextjs only dynamically", (file) => {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  expect(source).not.toMatch(/^\s*import[^;]*from\s+["']@sentry\/nextjs["']/m);
  expect(source).toContain('import("@sentry/nextjs")');
});
```

If the default export of `app/error.tsx` has another name after WP15, keep the default import as written (the name does not matter). If Jest's module registry returns the real SDK for the dynamic import (the mock not applied), report it in the PR and keep only the two static tests; do not mock `import()` by hand.

Expected totals: `pnpm run test:scripts` gains 27 tests (4 + 9 + 6 + 5 + 3); `pnpm test --ci` gains 3 suites and 8 tests.

## Verification

From `frontend/` unless stated.

WP00 standard checks, adapted:

```bash
pnpm install --frozen-lockfile
git diff --stat master -- pnpm-lock.yaml package.json      # package.json: only the two perf:* scripts; lockfile: nothing
pnpm exec tsc --noEmit                                     # exit 0
pnpm run lint; echo "exit=$?"                              # exit=0, 0 errors (scripts carry an eslint-disable for no-console)
pnpm exec eslint scripts app/lib/rum.ts app/components/SpeedInsightsClient.tsx app/layout.tsx app/error.tsx app/global-error.tsx \
  app/lib/__tests__/rum.test.ts app/components/__tests__/SpeedInsightsClient.test.tsx app/__tests__/errorBoundarySentry.test.tsx   # 0 errors
pnpm test --ci                                             # all pass; 3 more suites and 8 more tests than the starting state
pnpm exec jest app/lib/__tests__/rum.test.ts app/components/__tests__/SpeedInsightsClient.test.tsx app/__tests__/errorBoundarySentry.test.tsx --ci
pnpm run test:scripts                                      # "# fail 0"; the coverage test is skipped if no .perf/ logs exist yet
pnpm build:stub; echo "exit=$?"                            # the default empty-stub build still exits 0 (no fixture, ephemeral port)
```

The perf gate end to end (step 22 did this once; repeat on the final commit):

```bash
rm -rf .perf
SUPABASE_STUB_FIXTURE=perf pnpm build:stub > /tmp/wp22-perf-build.log 2>&1; echo "exit=$?"   # exit=0
grep -c "no fixture route" /tmp/wp22-perf-build.log                                           # 0
node scripts/perf-serve.mjs > /tmp/wp22-serve.log 2>&1 &
for i in $(seq 120); do [ -f .perf/ready ] && break; node -e "setTimeout(()=>{},1000)"; done; cat .perf/ready
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' http://127.0.0.1:3100/prices           # 200 and a size close to calibration.pricesHtmlBytesProd
curl -s -D - -o /dev/null http://127.0.0.1:3100/prices | grep -i content-security-policy | grep -c upgrade-insecure   # 0
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:3100/storage/v1/object/public/product-images/products/900001_thumb.webp   # 200 image/webp
pnpm perf:budget; echo "exit=$?"                                                               # exit=0, the table, every row ok or over target
pnpm run test:scripts 2>&1 | grep -E '^# (pass|fail|skipped)'                                  # fail 0, skipped 0 (the coverage test ran)
```

If Chrome is available locally, also run `pnpm dlx @lhci/cli@0.15.1 autorun` and `node scripts/perf-lhci-summary.mjs` against the running server; otherwise CI is the check. Then stop the server (`pkill -f scripts/perf-serve.mjs`) and confirm `test ! -e .next/cache/fetch-cache && echo wiped`.

Budget sanity against the design: in the table, `/prices` JS is the shared floor plus 15 to 35 kB of route code; the shared floor is within 10 kB of 141 kB; the lazy chunk list's largest entry is Recharts (about 118 kB) or supabase-js (about 64 kB); CSS is 10 to 14 kB. A number far outside these ranges means a measurement bug: check `parseDocument` against the route's HTML (`curl -s http://127.0.0.1:3100/prices > /tmp/p.html`) before writing limits.

Sentry saving (research §17 item 5): repeat the "Before you start" command on the perf build. Expect the `captureException` chunk to appear in no route's initial script list (`grep -l <chunk> .next/server/app/*.html` prints nothing) and the shared floor to be about 3.6 kB lower than the starting build. Put both numbers in the PR.

Probes in CI (both on a throwaway branch; nothing from them is merged):

1. JS budget probe. From the WP22 branch: `git switch -c remediation/wp22-probe-js`. Create the probe file and reference it from the `/prices` client container:

   ```bash
   node -e 'const c=require("crypto");process.stdout.write("// WP22 budget probe. Never merge.\nexport const PERF_PROBE = \""+c.randomBytes(30720).toString("base64")+"\";\n")' > app/components/ProductPrices/perfProbe.ts
   gzip -9c app/components/ProductPrices/perfProbe.ts | wc -c    # about 31000
   ```

   In `app/components/ProductPrices/index.tsx` add `import { PERF_PROBE } from "./perfProbe";` and, inside the component body, `useEffect(() => { (window as unknown as { __perfProbe?: string }).__perfProbe = PERF_PROBE; }, []);` (import `useEffect` if needed). Commit, push, open a draft PR against the WP22 branch. Expected: "Performance budgets (bytes, blocking)" fails with `routes./prices.jsGzKb: <n> kB is over its limit`, and the table shows `/prices JS (gz)` about 30 kB higher. Close the PR and delete the branch (`git push origin --delete remediation/wp22-probe-js`).
2. CLS probe. `git switch -c remediation/wp22-probe-cls` from the WP22 branch. New `app/prices/PerfClsProbe.tsx`:

   ```tsx
   "use client";
   // WP22 CLS probe. Never merge.
   import { useEffect, useState } from "react";
   export default function PerfClsProbe() {
     const [show, setShow] = useState(false);
     useEffect(() => {
       const t = setTimeout(() => setShow(true), 400);
       return () => clearTimeout(t);
     }, []);
     return show ? <div style={{ height: 400 }} aria-hidden="true" /> : null;
   }
   ```

   Render `<PerfClsProbe />` as the first child of the page's top-level element in `app/prices/page.tsx`. Push, draft PR. Expected: the budget step passes (a few hundred bytes), and "Lighthouse CI" fails with `cumulative-layout-shift` failure for `/prices` (expected ≤ 0.05, found about 0.2 or more). Close and delete the branch.

Paste links to both failed runs in the WP22 PR.

CI time: after the WP22 PR's final green run,

```bash
gh run list --workflow CI --branch master --limit 5 --json databaseId --jq '.[].databaseId' | head -3 | while read id; do
  gh run view "$id" --json jobs --jq '.jobs[] | select(.name=="Frontend (lint + typecheck + tests)") | [.startedAt, .completedAt] | @tsv'; done
gh pr checks --json name,startedAt,completedAt --jq '.[] | select(.name=="Frontend (lint + typecheck + tests)")'
```

The PR's Frontend job must take at most 5 minutes longer than the median of the three master runs. If it takes longer, first check whether the time went into `pnpm dlx` downloads or Chrome runs (the step timings in the log); the only allowed reduction is dropping `/market` from `lighthouserc.json`'s URLs (keep it in the byte gate), stated in the PR.

Workflows (repo root):

```bash
for f in ci prod-confirm prod-smoke rum-weekly; do python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/$f.yml')); print('$f ok')"; done
grep -n "RUM_WEEKLY_ENABLED" .github/workflows/rum-weekly.yml        # the job-level if
grep -c "secrets\." .github/workflows/ci.yml                         # 0: the CI job still uses no secrets
```

If `actionlint` is installed, run it on all four files and expect no output.

Production (needs network; before merge):

- Smoke dry run from step 17d: exit 0 against `https://www.pokefin.ca`, signed-in row "not configured". Paste the table.
- `node scripts/prod-confirm.mjs --origin https://www.pokefin.ca`: a table for 9 routes, and read the apex line. A warning is information for the owner, not a blocker.

Manual checks at 390 px and 1440 px: there is no visual change in this PR. On the PR's Vercel preview, at both widths, open `/prices?q=etb`, interact once (tap a filter), then in DevTools Network filter `speed-insights`: the vitals request's JSON `url` field has no `?q=`. On a production build the beacon posts to `/_vercel/speed-insights/vitals`; on a preview it may not send at all, in which case note that in the PR and let the owner check it on production after merge.

## Owner actions

1. **Function region** (research §7.4): Vercel, Project pokefin, Settings, Functions, Region: `cle1` (Cleveland, next to Supabase us-east-2). Confirmation: `curl -sI https://www.pokefin.ca/product/<any id> | grep -i x-vercel-id` on a cold response contains `cle1`.
2. **Apex redirect**: `curl -sI https://pokefin.ca/ | head -3` must show exactly one `308` with `location: https://www.pokefin.ca/`. If it shows `307`, Vercel, Domains, `pokefin.ca`, set the redirect to permanent (308). The `prod-confirm` workflow reports it after every deploy.
3. **Speed Insights metrics access**: create a Vercel access token (Account Settings, Tokens; scope: the team that owns pokefin; no expiry or 1 year). Locally, `npx vercel@61.1.0 metrics schema vercel.speed_insights --token <token>`.
   - If it lists metrics: add the repository secret `VERCEL_TOKEN`, variables `VERCEL_PROJECT` (the project name, `pokefin` if that is its name) and `VERCEL_SCOPE` (the team slug, empty for a personal account), then run the exact query once: `npx vercel@61.1.0 metrics vercel.speed_insights.lcp_ms --aggregation p75 --group-by route --since 7d --granularity 7d --limit 100 --prod --project <name> --format json --token <token>`. If it errors on `--granularity 7d`, set `"granularity": null` in `perf-budgets.json` `rum` in a small PR. If the dimension names include device type and country, add the filters (for example `"device_type eq 'mobile'"`, `"country eq 'CA'"`, with the names the schema prints) to `rum.filters`. Then set the repository variable `RUM_WEEKLY_ENABLED` to `true` and run "RUM weekly" once from the Actions tab. Confirmation: a green run with the p75 table in its summary.
   - If the schema command fails on the plan: do nothing more; the workflow stays disabled and the self-hosted web-vitals beacon becomes a follow-up.
4. **Smoke account and secrets**: create a dedicated account (for example `smoke+pokefin@<your domain>`) through the normal sign-up, add one holding to its portfolio. Then:
   - `openssl rand -base64 48`, save it as repository secret `SMOKE_STATE_KEY`.
   - Private browser window: sign in as the smoke account, open `/portfolio`, DevTools, Network, the `/portfolio` document request, copy the full `cookie` request header value; close the window without signing out. Save it as repository secret `SMOKE_SESSION_SEED`.
   - Optional: repository variable `SMOKE_PRODUCT_ID` with a long-lived product id.
   - Actions, "Production smoke", Run workflow. Confirmation: green, and the summary's "Signed in" row shows `/portfolio 200, /api/portfolio 200, export 200`. From then on the workflow rotates the session itself; re-seed only when a `prod-smoke-session` issue asks.
5. **RUM baseline** (research §17 item 1): in Vercel, Speed Insights, Device Mobile, Country Canada (or the CLI with the filters from item 3), read the 28-day p75 LCP, INP, CLS and TTFB and the sample count per route, and put them into `perf-budgets.json` under `baseline` in a small PR: `{ "exportedOn": "YYYY-MM-DD", "window": "28d", "filters": "mobile, CA", "routes": { "/prices": { "lcpMs": 0, "inpMs": 0, "cls": 0, "ttfbMs": 0, "samples": 0 } } }` with the real numbers.
6. **Calibration**, only if the PR says the executor had no network: `curl -s https://www.pokefin.ca/prices | wc -c` into `calibration.pricesHtmlBytesProd`, with the date in `calibration.measuredOn`.
7. Nothing to change in branch protection: the gate runs inside the already-required `Frontend (lint + typecheck + tests)` check.

## Acceptance criteria

- [ ] `SUPABASE_STUB_FIXTURE=perf pnpm build:stub` exits 0, uses port 3100, and reports no endpoint without a fixture route; the default `pnpm build:stub` still exits 0 on an ephemeral port.
- [ ] `scripts/fixtures/perf.mjs` generates 306 products, 55 sets, 9 generations, 12 product types, about 15% variants, volume for about 80% of priced products, 6 stale products withheld as 0023 does, 365 days of history for 900001 to 900003, set analytics for all 55 sets, from a mulberry32 seed; `scripts/fixtures/img/` holds exactly `original.jpg` and `thumb.webp`, about 100 kB together, generated by the committed script.
- [ ] `perf-serve` serves the app and the stub on one origin (127.0.0.1:3100), without `upgrade-insecure-requests` in the proxied CSP, and wipes `.next/cache/fetch-cache` on exit.
- [ ] `frontend/perf-budgets.json` holds the D4 targets, a non-null `limit` and `recorded` for all 20 slots computed by the D4 rule, the calibration fields, and the RUM targets.
- [ ] CI prints the budget table and the Lighthouse table in the Frontend job summary and uploads the `perf-reports` artifact.
- [ ] The JS probe (about 30 kB gz added to `/prices`) fails the "Performance budgets" step (link in the PR).
- [ ] The CLS probe fails the "Lighthouse CI" step on `cumulative-layout-shift` for `/prices` (link in the PR).
- [ ] `lighthouserc.json` has no `"maxNumericValue": 1` placeholder; CLS, bf-cache and resource-summary are `error` on all four URLs (except exceptions documented in the PR per step 23), `uses-responsive-images` is `error` on `/` and `/prices`, LCP and TBT are `warn`.
- [ ] A PR that raises a limit without a `Perf budget raise: <key> <reason>` line fails (covered by `perf-measure.test.mjs`; the step reads the PR body).
- [ ] The Frontend job's name is unchanged, it uses no secrets, and it takes at most 5 minutes longer than the median of the last three master runs.
- [ ] `pnpm-lock.yaml` is unchanged; `package.json` gains only `perf:serve` and `perf:budget`.
- [ ] `app/error.tsx` and `app/global-error.tsx` have no static `@sentry/nextjs` import; the shared floor dropped by the Sentry chunk (number in the PR).
- [ ] `app/layout.tsx` renders `<SpeedInsightsClient />` with `sampleRate={1}` and the query-stripping `beforeSend`.
- [ ] `prod-confirm.yml`, `prod-smoke.yml` and `rum-weekly.yml` exist, parse, declare least-privilege `permissions`, and `rum-weekly` runs only when `RUM_WEEKLY_ENABLED` is `true`.
- [ ] The smoke script passes against production locally (public checks) before merge, and the "Production smoke" workflow is green on its first manual run after the owner adds the secrets.
- [ ] `pnpm run test:scripts` passes with 27 more tests, `pnpm test --ci` with 3 more suites and 8 more tests, `pnpm run lint` exits 0.
- [ ] `frontend/README.md` documents the gate and the rules for later packages.

## Rollback

`git revert <merge commit>` removes the gate, the fixture, the workflows and the two runtime changes together; nothing in the database, Vercel or Supabase depends on them. Partial rollbacks, each a one-file follow-up PR:

- Lighthouse flaky or too slow: delete the `Lighthouse CI` and `Lighthouse summary` steps from `ci.yml`. The byte gate stays.
- Byte gate blocking an urgent fix for a reason unrelated to the fix: do not raise limits silently; either add the `Perf budget raise:` line with the reason, or revert only the `Performance budgets (bytes, blocking)` step and restore it in the next PR.
- Perf build failing for fixture reasons: change the build step back to `run: pnpm build:stub` without the `env:` and delete the steps after it; the plain build gate is restored.
- Smoke or RUM workflows noisy: disable them in the Actions tab (Disable workflow) and open an issue; the scripts can stay.
- Sentry or Speed Insights change: revert `app/error.tsx`, `app/global-error.tsx`, `app/layout.tsx` and `app/components/SpeedInsightsClient.tsx` only.

The owner's secrets and variables (`VERCEL_TOKEN`, `SMOKE_*`, `RUM_WEEKLY_ENABLED`) can be deleted in Settings, Secrets and variables, Actions. The `smoke-session-*` cache entries expire on their own after 7 days, or can be deleted in Actions, Caches.

## Commit and PR

Files changed (and nothing else): `.github/workflows/ci.yml`, `.github/workflows/prod-confirm.yml`, `.github/workflows/prod-smoke.yml`, `.github/workflows/rum-weekly.yml`, `frontend/.gitignore`, `frontend/README.md`, `frontend/package.json`, `frontend/perf-budgets.json`, `frontend/lighthouserc.json`, `frontend/app/layout.tsx`, `frontend/app/error.tsx`, `frontend/app/global-error.tsx`, `frontend/app/lib/rum.ts`, `frontend/app/components/SpeedInsightsClient.tsx`, the three Jest test files, and under `frontend/scripts/`: `supabase-stub.mjs`, `build-with-stub.mjs`, `supabase-stub.test.mjs`, `perf-config.mjs`, `perf-serve.mjs`, `perf-measure.mjs`, `perf-measure.test.mjs`, `perf-budget.mjs`, `perf-lhci-summary.mjs`, `perf-fixture.test.mjs`, `gh-issue.mjs`, `prod-confirm.mjs`, `prod-smoke-lib.mjs`, `prod-smoke-lib.test.mjs`, `prod-smoke.mjs`, `rum-weekly.mjs`, `rum-weekly.test.mjs`, `fixtures/perf.mjs`, `fixtures/postgrest.mjs`, `fixtures/make-images.py`, `fixtures/img/original.jpg`, `fixtures/img/thumb.webp`. No migrations.

Commit message:

```
ci: performance budget gate, Lighthouse CI, production smoke and RUM (WP22)

- synthetic seeded perf fixture (306 products, 55 sets, 365-day history for
  the Lighthouse product pages, noise images) behind SUPABASE_STUB_FIXTURE=perf;
  the perf build fails on any Supabase endpoint without a fixture route
- perf-serve: stub and next start behind one origin (the CSP allows only
  'self'), perf-budget: per-route gzip/brotli JS, document, flight, CSS,
  fonts, lazy chunks, third-party scripts; blocking, table in the job summary
- perf-budgets.json: research targets plus ratcheted limits (measured x 1.05,
  capped at target); raising one needs a "Perf budget raise:" line in the PR
- Lighthouse CI (pinned, dlx): CLS, bf-cache, byte totals and catalog image
  sizing block; LCP and TBT warn
- prod-confirm (after each production deploy), prod-smoke (daily, Playwright,
  rotating encrypted session for the signed-in leg), rum-weekly (vercel
  metrics p75 per route, gated on RUM_WEEKLY_ENABLED); one issue per label
- Speed Insights: sampleRate 1, query strings stripped in beforeSend
- error boundaries load @sentry/nextjs on demand, only when a DSN is set
```

PR title: `ci: performance budget gate, Lighthouse CI, production smoke and RUM (WP22)`

PR body:

- **What**: the list from the commit message, the design sections D1 to D11 in one line each.
- **Budget table** from step 22 and the **Lighthouse table** from the final CI run; which budgets are "over target" today and by how much.
- **Measured savings**: Sentry chunk before and after (bytes, shared floor), from Verification.
- **Probe runs**: links to the failed JS-probe and CLS-probe runs.
- **Calibration**: fixture vs production `/prices` bytes and drift, or "no network, owner action 6".
- **Lighthouse exceptions**: every assertion set to `warn` beyond D5's table, with the reason and the follow-up issue (none expected).
- **Smoke dry run** table from step 17d, and the `minPrices` values chosen.
- **CI time**: the Frontend job duration vs the master median.
- **Rule for later packages**: quote D11.
- **Owner actions** 1 to 7, verbatim.
- **Follow-ups**: switch `uses-responsive-images` to `error` on `/market` and `/product/[id]` with the image-derivative work (PX05); self-hosted web-vitals beacon if the plan does not expose Speed Insights metrics; tighten limits to measured x 1.05 after 2 weeks of green RUM per route.
