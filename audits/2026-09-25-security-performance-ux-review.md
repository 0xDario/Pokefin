# Pokéfin: Security, Performance, Architecture and UX Review

**Repository:** `0xdario/pokefin` at `6e1704a` (master, 2026-09-25)
**Scope:** `frontend/` (Next.js 16.3.6, React 19.2, Supabase SSR, Recharts), `migrations/` and `schema.sql`, the Python scrape and report pipeline, CI.
**Method:** 10 finder passes plus a measured build, lint and test pass. 141 raw findings were deduplicated into 89 root causes. Every Critical, High and Medium root cause was re-derived from code by an independent adversarial verifier: 69 confirmed, 0 refuted. Details in section 7.

Finding ids (`F001` and so on) are stable references into the review working set. Where several finders reported the same root cause, every member id is listed.

---

## 1. Executive summary

**The most important fact in this report: every signed-in feature has been broken for every user since 2026-05-27.** Commit `fec21dc` moved session cookies to HttpOnly, which was the right security call. But the browser Supabase client that `portfolio.ts`, `useBoxRecipes.ts`, `account/page.tsx` and `AuthContext.fetchProfile` still use can no longer read the session. Those queries have run as `anon` for four months and RLS rejects all of them. Verifiers confirmed this in the production Postgres and API logs as 401 responses with error code 42501. The portfolio page shows "Failed to load portfolio", box recipes cannot be saved, username changes fail, and the header never shows a display name. Separately, the account data export fails on every call because `export_my_data()` is declared `STABLE` but performs an `INSERT`. The repo has zero GitHub issues, so no user has reported any of this. That is itself a signal: either nobody is using accounts, or nobody has a channel to tell you.

**Security posture is good and the May hardening mostly held.** CSRF gates, HttpOnly cookies, RLS on every table, SECURITY DEFINER functions with pinned search paths, the CSP and the SSRF-hardened image fetcher all verified clean. The real security issues are a rate-limit classifier that points the strict bucket at the wrong routes, captcha enforcement that lives only in a dashboard toggle, and an anon-callable RPC heavy enough to be a cheap DoS lever.

**Load performance is mediocre on the page that matters most.** `/prices` is marked static but ships a bare "Loading…" because `useSearchParams` sits above the page's only Suspense boundary, so the 306 cards render only after hydration. A 64.6 kB gzip Supabase bundle rides on every route, including the privacy page.

**Scroll and interaction performance is the weakest area.** Every product card mounts a live Recharts instance for a 96x40 sparkline. Every card that scrolls into view fires its own history request, and the loading state for each request re-renders the whole list. Worst of all, every keystroke in the `/prices` search box performs a real App Router navigation that re-downloads the entire catalog payload.

**The data layer works but is expensive.** The core metrics RPC scans the whole price-history table with no date bound. Production stats show it averaging 0.7 to 0.9 s, hitting the 3 s anonymous timeout about 10 times a day, and being called hundreds of times an hour despite a 1 hour cache.

**Architecture** is reasonable at the top level. The main debts are duplicated market math that has already diverged, a 1,079-line `compare/page.tsx`, and no tests on the proxy, API routes or CSV import.

**UX** is close to professional but undercut by details. These include release dates off by one day for North American visitors, a loading toast that covers the header, a mobile menu that cannot be closed with its own X button, one `<title>` for every page, no custom 404, and copy that promises "refreshed hourly" when prices move about once a day.

**Best impact-to-effort changes:**
1. Restore signed-in features by moving user-table access behind cookie-backed route handlers. Start with the profile read, which takes under an hour.
2. Ship a one-line migration that makes `export_my_data` `VOLATILE`.
3. Make `/prices` search write the URL with `history.replaceState` instead of `router.replace`, and remove the global loading toast.

---

## 2. Scorecard

| Dimension | Score /10 | Why |
|---|---|---|
| Security | 7 | May hardening held. Remaining issues are rate-limit misclassification, captcha that is optional in code, and an anon-callable heavy RPC. |
| Correctness | 3 | Every signed-in feature is broken, data export always fails, dates are off by one day west of UTC, and there is a hydration mismatch on `/`. |
| Load performance | 5 | ISR and lazy Recharts are right. `/prices` is client-rendered in practice and supabase-js is on every route. |
| Scroll and render performance | 4 | 306 live Recharts instances, per-card fetches that re-render the list, and a full catalog refetch per search keystroke. |
| Data layer and caching | 4 | Good client dedup and paging hygiene. The metrics RPC is unbounded, caches miss in production, and the portfolio fetch is a serial waterfall. |
| Architecture and code quality | 5 | Sensible module layout. Market math is duplicated and diverged, there is a 1,079-line page, types are untyped at the DB boundary, and critical paths have no tests. |
| UX and accessibility | 5 | Clean visual base. Timezone bugs, inaccessible modals, a broken mobile menu, weak SEO metadata and inaccurate refresh copy hold it back. |
| Ops and CI | 5 | Tests, audits and a secret scan exist. Lint does not block, CI never runs `next build`, and the scraper has no run lock or price sanity bounds. |

---

## 3. Top 10 actions

Ranked by impact divided by effort.

1. **Restore signed-in features (F001, F018).**
   - What: Step one (S): return `{ user, profile }` from `GET /api/auth/me` using `createRouteSupabaseClient()` and delete `fetchProfile`'s browser query. Step two (L): move portfolio, holdings, lots, box-recipe and username writes behind route handlers modeled on `app/api/account/export/route.ts`, gated with `rejectIfCsrfFails`. Step three (S): add an ESLint `no-restricted-imports` rule forbidding `app/lib/supabase` in those modules.
   - Why: Four months of total failure for every account holder.
   - Where: `frontend/app/lib/supabase.ts:23`, `frontend/app/context/AuthContext.tsx:57`, `frontend/app/lib/portfolio.ts:176-425`, `frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts:64-185`, `frontend/app/account/page.tsx:65`.
   - Effort: S for step one, L overall.
   - Effect: Portfolio, box recipes, username and header name work again.
   - Do not bridge by returning tokens to the browser and calling `setSession`. That reopens the XSS-readable session the May audit closed.
2. **Make data export work (F020).**
   - What: New migration `0024` that re-creates `export_my_data()` without `STABLE`, plus `REVOKE EXECUTE ... FROM PUBLIC, anon`.
   - Where: `migrations/0011_export_my_data.sql:10`.
   - Effort: S.
   - Effect: The GDPR export succeeds and the audit row is recorded.
3. **Fix rate-limit classification (F077, F017).**
   - What: Stop classifying `/auth/*` page GETs as sensitive. Classify only `POST /api/auth/sign-in`, `sign-up`, `update-password` and `/api/account/*` as sensitive, at 10 per minute. Key buckets per path.
   - Why: A single cold homepage load spends 4 of the 5 sensitive tokens through header link prefetches, so a user can be locked out of the login page by browsing. Meanwhile the password endpoint gets the loose 60 per minute bucket.
   - Where: `frontend/app/lib/rateLimit.ts:73-78`, `frontend/proxy.ts:34`.
   - Effort: S.
4. **Stop the per-keystroke catalog refetch on `/prices` (F016).**
   - What: Replace `router.replace` with a debounced `window.history.replaceState(null, "", url)`. Next 16 patches it into a restore action with no network request. Memoize the three card-list blocks.
   - Where: `frontend/app/components/ProductPrices/index.tsx:127-163`.
   - Effort: S.
   - Effect: Typing "booster" stops downloading the catalog seven times and re-rendering all 306 cards after each letter.
5. **Replace Recharts sparklines with an inline SVG polyline and batch history fetches (F014, F066, F070, F067).**
   - What: Draw a min/max-normalized `<polyline>`. It is scale-invariant, so it needs no currency props and can server-render. Collect intersecting ids over about 100 ms and fetch with one `.in("product_id", ids)` query. Keep per-card loading state out of the parent.
   - Where: `frontend/app/components/MarketView/MiniSparkline.tsx`, `frontend/app/components/ProductPrices/hooks/useProductData.ts:117-168`, `frontend/app/lib/clientMarketData.ts:273`.
   - Effort: M.
   - Effect: The 118 kB Recharts chunk leaves `/` and `/prices` for sparklines, about 300 chart instances disappear, and scroll-time requests drop by roughly 20 times.
6. **Server-render the `/prices` catalog (F012, F025).**
   - What: Remove `useSearchParams` from `ProductPrices`. Read the query with `useSyncExternalStore(subscribe, () => location.search, () => "")`, which is hydration-safe and lint-clean.
   - Where: `frontend/app/components/ProductPrices/index.tsx:77`, `frontend/app/prices/page.tsx:31`.
   - Effort: M.
   - Effect: Cards appear in the first HTML instead of after hydration.
   - Do not use `dynamic = "force-static"`. It causes hydration mismatches for any URL with `?q=`.
7. **Bound the metrics RPC and revalidate on scrape (F142, F080, F151, F123).**
   - What: Add `WHERE recorded_at >= current_date - 366` to `daily_history` and replace the correlated CTE lookups with `LATERAL` index reads. Add a secret-protected `/api/revalidate` route that `main.py` calls after each successful run, and raise `revalidate` to a daily backstop.
   - Where: `migrations/20260506_market_performance_functions.sql:38-98`, `frontend/app/lib/serverMarketData.ts:891-925`.
   - Effort: M.
   - Effect: Removes the 3 s timeouts and cuts RPC volume by an order of magnitude.
8. **One date and money formatting module (F007, F009, F010, F026, F089, F102, F096, F112, F115).**
   - What: Create `formatDateOnly` (fixed `en-CA` locale, `timeZone: "UTC"`), `formatTimestamp` (explicit zone and label) and `formatMoney` (`Intl.NumberFormat`). Replace every bare `toLocale*` call.
   - Where: `GroupHeader.tsx:19`, `ProductCard.tsx:75-83`, `MarketView.tsx:115`, `stats/page.tsx:52`, `app/page.tsx:185`.
   - Effort: S.
   - Effect: Release dates stop showing a day early, the hydration mismatch on `/` goes away, and prices get thousands separators.
9. **Fix the three most visible UI bugs (F022, F008, F032, F090, F024, F098).**
   - What: Put the mobile menu toggle inside the click-outside ref and add Escape and `aria-expanded`. Delete the fixed "Loading price history…" toast, since the sparkline skeletons already signal loading. Set `PASSWORD_MIN_LENGTH = 12` in one place, use it in the signup, reset and account forms, and add `autoComplete` attributes.
   - Where: `Header.tsx:53-64, 204-228`, `ProductPrices/index.tsx:236-244`, `auth/signup/page.tsx:63,162`.
   - Effort: S.
10. **Make CI catch what production catches (F076, F037, F052, F064, F139).**
    - What: Add the Vercel commit status as a required check, or a `pnpm build` job with read-only public Supabase secrets. Fix the 7 inline-component lint errors and the 8 set-state-in-effect errors, then remove `continue-on-error`. Drop the pinned `version: 10` from `pnpm/action-setup`, since `package.json` pins pnpm 11.
    - Where: `.github/workflows/ci.yml:19,31-36,48`.
    - Effort: M.

Close behind: product-page ISR (F147, S), hero image `priority` (F069, S), `content-visibility: auto` on cards (F015, S), and per-page metadata with a sitemap and robots file (F028, M).

---

## 4. Findings

Status tags use the verified severity. "Verified" means an independent verifier re-derived the claim from code, and sometimes from production logs. "Unverified" means finder-reported and not independently re-checked. Only Low and Info items carry that tag.

### Security

**Rate-limit classes are inverted (F077, F017)**
Medium · Verified · S · `frontend/app/lib/rateLimit.ts:73-78`
- Evidence: `if (pathname.startsWith("/auth/")) return "sensitive";` applies 5 per minute to static `/auth/login`, `/auth/signup` and `/auth/forgot-password` GETs and to their `?_rsc=` prefetches. Credential POSTs under `/api/auth/*` fall into `general` at 60 per minute. A verifier ran the real proxy and found that each auth link in the header costs 2 tokens, so one cold homepage load spends 4 of 5.
- Impact: Logged-out visitors can hit a plain-text 429 by browsing login, then signup, then forgot-password. Users behind a shared IP share that budget. The password endpoint gets 12 times the intended brute-force allowance.
- Fix: See Top 10 item 3. Do not rely on skipping prefetch headers, because the proxy redirect and the email callback are real navigations.

**Turnstile is optional in code; forgot-password sends no token (F019)**
Medium · Verified · S to M · `frontend/app/api/auth/sign-in/route.ts:29-44`, `sign-up/route.ts:31-49`, `AuthContext.tsx:184`
- Evidence: The `captchaToken` value is `undefined` when absent and is forwarded anyway. No `siteverify` call exists, and `forgot-password/page.tsx` renders no widget.
- Impact: Enforcement depends entirely on a Supabase dashboard toggle. If the toggle is on, password reset is broken for everyone because no token is sent. If it is off, sign-in and sign-up have no captcha.
- Fix:
  - Return 400 when `captchaToken` is missing in the sign-in and sign-up routes.
  - Add the widget to forgot-password and pass `{ captchaToken, redirectTo }`.
  - Reset the widget after every failed submit, since tokens are single-use.
  - Do not also call `siteverify` in the app while Supabase captcha is on. A single-use token verified twice fails the second check and breaks login.
  - Confirm the dashboard setting once on production.

**Password-recovery link is not wired in code (F079)**
Medium · Verified · S · `frontend/app/context/AuthContext.tsx:184`, `frontend/app/auth/callback/route.ts:30-35`
- Evidence: `resetPasswordForEmail(email)` passes no `redirectTo`, and the callback routes to the reset form only when `type=recovery`, a parameter PKCE links do not carry.
- Impact: Reset works only if someone hand-edited the email template or site URL in the dashboard. Any dashboard change breaks it silently.
- Fix: Pass `redirectTo: ${NEXT_PUBLIC_SITE_URL}/auth/callback?next=/auth/reset-password` and route recovery through `safeNextPath`. Never use `window.location.origin`; that preserves the earlier M-3 fix. Delete the `type === "recovery"` branch.

**Scraper, weekly report and emailer run with the service-role key (F081, F085)**
Medium · Verified · M · `secrets_loader.py:29-31`, `generate_weekly_report.py:198`
- Impact: A read-only report and an emailer hold a key that bypasses all RLS and unlocks auth admin. Nothing is exploitable today; the blast radius if the laptop or env file leaks is every account.
- Fix: Create a dedicated `NOBYPASSRLS` Postgres role with grants only on the reference and history tables, connected through the Supavisor pooler with psycopg. Give the weekly report a read-only role. User-mintable JWTs are not an option, because the legacy HS256 keys are revoked.

**Heavy RPCs are callable by anyone with the anon key (F080, part of F142)**
Covered under Data layer. The only guard is `ALTER ROLE anon SET statement_timeout = '3s'` (`migrations/0009_db_resource_guards.sql:22`). A loop of `POST /rest/v1/rpc/get_set_analytics` pins database CPU at no cost to the caller.

**next/image optimizer still accepts wildcard hosts (F075)**
Low · Verified · S · `frontend/next.config.ts:53-73`
- The comment claims "Closes file-handling F-6", but only `pathname` was narrowed. The only `<Image>` passes `unoptimized`.
- Fix: Set `images: { unoptimized: true }` and delete `remotePatterns`. That closes the endpoint and matches commit `bd29639`'s decision.

**Password change needs no current password (F078)**
Low · Verified · M · `frontend/app/api/auth/update-password/route.ts:17-38`
- Fix: Enable Supabase "Secure password change". Do not hand-roll a `signInWithPassword` probe. Do not add `signOut({ scope: "others" })`, because GoTrue already revokes other sessions on password update.

**Sign-up username has no server-side validation (F132, F130)**
Low · Verified · S · `frontend/app/api/auth/sign-up/route.ts:30-56`, `migrations/0004_handle_new_user_trigger.sql:12`
- A taken or malformed username becomes an opaque "Database error saving new user" 500.
- Fix: Share `USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/` between client, route and DB. Map GoTrue errors to a fixed allowlist of messages.

**Other low-severity security items:**
- **Chrome environment and sandbox (F082).** Verified. The service key and SMTP password are inherited by headless Chrome, which runs `--no-sandbox` on third-party pages (`main.py:657`). Pass a scrubbed `env` to the driver and run as a non-root user without `--no-sandbox`.
- **Unpinned CI action (F127).** Verified. `trufflesecurity/trufflehog@main` is unpinned and the workflow has no `permissions:` block (`.github/workflows/ci.yml:89`). Pin to a SHA, add `permissions: contents: read`, and set `persist-credentials: false`.
- **CSP (F128).** Verified. `script-src` uses `'unsafe-inline'` (`next.config.ts:15`). Nonces are not viable while public pages are static, so accept it and document why. Add the Sentry ingest origin to `connect-src` before setting a DSN.
- **Share-code format (F131).** Unverified. `box_recipes` share codes are client-chosen with no format CHECK, and `get_shared_recipe` returns the owner UUID to anon (`migrations/0005:22`). Add a hex-32 CHECK, generate the code server-side, and drop `user_id` from the RPC output.
- **Whole-row writes (F133).** Unverified. `FOR ALL` policies let users rewrite `profiles.email` and stuff large `packs` payloads (`migrations/0014:55`). Add column-level `REVOKE UPDATE (email, ...)` and a size CHECK on `packs`.
- **Thumbnail backfill (F136).** Unverified. `backfill_thumbnails.py:188` fetches URLs without `main.py`'s SSRF, size and magic-byte guards. Factor out and reuse `fetch_validated_image`.
- **Token on the command line (F138).** Unverified. `compare_prices.py:638` accepts the Shopify token as an argument. Read it from the environment only.

### Correctness and latent bugs

**Signed-in features run as anon (F001, F018)**
Critical · Verified, including production logs · S then L · `frontend/app/lib/supabase.ts:23`, `frontend/app/context/AuthContext.tsx:57`
- Evidence: Sessions are minted server-side with `httpOnly: true` (`cookieOptions.ts:21`). `createBrowserClient` reads `document.cookie`, which cannot see HttpOnly cookies, as `AuthContext.tsx:72-74` itself notes. The same client still issues `from("profiles")`, `from("portfolios")`, `from("portfolio_holdings")` and `from("box_recipes")`. Migration 0013 revoked `anon` on those tables. Production logs show 401 and 42501 responses.
- Impact: The portfolio page fails to load, box recipes cannot be saved, username updates fail with a raw "permission denied", and the header falls back to the email prefix. This affects every signed-in user and has since 2026-05-27.
- Severity: Verifiers rated it High because it is not a breach, since RLS is doing its job. It is ranked Critical here because it disables the entire account product.
- Fix: See Top 10 item 1. Also add a post-deploy smoke test that signs in and expects 200 from a profile endpoint, and alert on non-2xx rates for `/rest/v1/profiles`.

**`export_my_data()` is STABLE but INSERTs (F020)**
High · Verified by replaying the migration on Postgres 16 · S · `migrations/0011_export_my_data.sql:10,84`
- Impact: "Export my data" always shows "Failed to export data". It has never worked since it shipped in `5188327`.
- Fix: See Top 10 item 2. Keep the audit INSERT, because it is a documented requirement.

**Date-only values formatted in the viewer's timezone (F007, F009, F010, F026)**
High · Verified · S · `GroupHeader.tsx:18-20`, `ProductCard.tsx:75-83`, `MarketView.tsx:113-116`, `compare/page.tsx:226-230`
- Evidence: `new Date(releaseDate + "T00:00:00Z").toLocaleDateString()` has no `timeZone`, while `product/[id]/page.tsx:47-58` already carries the fix from `2969cd4`.
- Impact: Release dates show one day early for every visitor west of UTC on `/`, `/prices`, `/market` and `/compare`. On `/`, the server-rendered HTML and the client disagree, so React logs a hydration error and patches the text.
- Fix: See Top 10 item 8. Pin the locale as well as the zone, or server and client still disagree on format.

**Mobile menu cannot be closed with its X (F022, F008)**
Medium · Verified · S · `frontend/app/components/Header.tsx:53-64, 204-207, 224-228`
- The toggle button sits outside `mobileMenuRef`. `mousedown` closes the menu, then `click` re-opens it. The desktop dropdown's toggle is inside its ref, which is why only mobile breaks.
- Fix: Wrap the button and panel in one ref, add Escape, `aria-expanded` and `aria-controls`, and restore the focus ring.

**Portfolio data hook has no cancellation and blanks the page on refresh (F053, F057, F061)**
Medium · Verified · M · `frontend/app/components/Portfolio/hooks/usePortfolioData.ts:51-93`
- Impact: A timeframe click shows a full-page spinner, resets table sort, and can render an older, slower response over a newer one.
- Fix: Split `historyLoading` from `loading`, key a history effect on `[portfolio?.id, timeframe]` with a cancelled flag, and gate only the chart.

**Box Calculator "Share Link" is unreachable (F055)**
Medium · Verified · M · `frontend/app/components/BoxCalculator/BoxCalculator.tsx:213`
- `saveRecipe` never receives `isPublic`, so `share_code` is always written as null, and re-saving a legacy shared recipe breaks its link.
- Fix: Add a "Make shareable" control and send partial updates that omit sharing fields unless set.

**AuthContext churns identity; account username resets on focus (F058, F062, F106)**
Medium · Verified · S · `frontend/app/account/page.tsx:33`, `AuthContext.tsx:206`
- Fix: Seed the username lazily, sync it only when not dirty, and have `refreshSession` skip `setUser` and `setProfile` when nothing changed.

**Transient `/api/auth/me` failure signs the user out (F063)**
Medium · Verified · S · `frontend/app/context/AuthContext.tsx:82`
- A network blip, 429 or 5xx on tab focus flips the header to Sign In and bounces the user from `/portfolio`.
- Fix: Clear the user only on 401 or 403. Expose `sessionStatus: "unknown" | "anonymous" | "authenticated"` and debounce the focus refresh to at most once per 30 s.

**Scraped prices have no plausibility bound (F083)**
Medium · Verified · S · `main.py:1144`
- One malformed API value becomes the displayed price and a year-long history row.
- Fix: Add an absolute cap and a DB CHECK upper bound, and accept a large delta only when it is seen on two consecutive runs. Do not hard-reject outside ±5 times the current price, because that can permanently lock in a previously wrong value.

**History rows buffered past the product update (F084)**
Medium · Verified · S · `main.py:1253-1296`
- A crash loses up to 99 history rows while `products.last_updated` says they were updated.
- Fix: Flush the batches in the `finally:` block, or insert history before updating the product. The `(product_id, day)` unique index makes retries safe.

**Lower-severity correctness items:**
- **Login ignores return-to (F002, F006, F021, F027, F129).** Low. Verified. The proxy sets `next`, `/portfolio` sets `redirect`, `/account` sets nothing, and `login/page.tsx:46` always pushes `/`. Extract `safeNextPath` to `app/lib/redirects.ts`, read it in a Suspense-wrapped client child (not a bare `useSearchParams` on the static page), and standardize on `next`.
- **Inline components (F056, F039, F065, F114, F120).** Low. Verified. Seven components are defined inside render, so they remount: `HoldingsTable.tsx:79` `SortButton` and the Recharts tooltips and dots. Sort buttons lose keyboard focus. Hoist them to module scope.
- **CSV parsers (F003).** Low. Verified. Two divergent parsers exist (`import.ts:146`, `compare/page.tsx:82`). The verifier refuted the cost-basis corruption claim, since Notes is the last Collectr column. The actual effect is that multi-line notes are truncated. Unify on one RFC-4180 parser but keep per-field `.trim()`.
- **Idempotency key (F033).** Low. Verified. `addHolding` mints its own idempotency key, so retries cannot dedupe, and "duplicate" and "failure" both return null (`portfolio.ts:366`).
- **One-way URL sync (F054).** Low. Verified. URL sync on `/prices` only writes state to the URL (`index.tsx:147`), so the header Prices link cannot clear filters.
- **Recipe currency (F059).** Low. Verified. Saved recipes convert an already-converted retail price, and recipes store no currency (`BoxCalculator.tsx:361`).
- **Purchase-date "today" (F060).** Low. Verified. It uses the UTC day (`AddHoldingModal.tsx:46`). Clamp to `min(localToday, utcToday)` on the client. Do not loosen server validation, or the DB CHECK rejects the value with a raw error.
- **Stale search results (F110, F113, F119).** Low. Unverified. `useProductSearch.ts:137` lacks a stale-response guard.
- **Portfolio date series (F111).** Low. Unverified. It mixes local-day stepping with UTC keys (`portfolio.ts:833`).
- **Share copy (F116).** Low. Unverified. Share copy reports success before the clipboard write resolves (`BoxCalculator.tsx:231`).
- **NaN comparator (F117).** Low. Unverified. `new Date("")` produces a NaN comparator in the set picker (`useBoosterBoxPrices.ts:299`).
- **Offset-less timestamps (F122).** Low. Unverified. Offset-less `recorded_at` is parsed as local time in returns and sparkline math (`MarketView/returns.ts:34`). Add one `parseRecordedAt` helper.

### Load performance

**`/prices` is client-rendered in practice (F012, F025)**
High · Verified · M · `frontend/app/components/ProductPrices/index.tsx:77`, `frontend/app/prices/page.tsx:31`
- Impact: The static HTML contains the title and "Loading…". All ~300 cards appear only after the JS bundle hydrates, one to two seconds on a mid-range phone.
- Fix: See Top 10 item 6. Keep `useRouter` and `usePathname`, which do not bail out on this route.

**supabase-js on every route (F011, F013)**
Medium · Verified · S then M · `frontend/app/context/AuthContext.tsx:5`
- Evidence: The chunk is 246 kB raw and 64.6 kB gzip. It appears in all 16 page manifests and is about 31% of the JS floor on `/privacy`. It also eagerly constructs GoTrue and Realtime clients that can never find a session.
- Fix:
  - Profile via `/api/auth/me`, which is also part of Top 10 item 1.
  - Move the reset-password send to a route.
  - Delete the import. This clears it from `/stats`, `/analytics`, `/privacy`, `/auth/*`, `/product/[id]` and the 404.
  - For `/`, `/prices`, `/market`, `/compare`, `/box-calculator`, `/portfolio` and `/account`, replace the top-level imports in `clientMarketData.ts:21`, `exchangeRate.ts:4`, `portfolio.ts:1` and `useBoxRecipes.ts:4` with a memoized `import("./supabase")`.

**Product hero image invisible until hydration (F069)**
Medium · Verified · S · `frontend/app/components/ProductPrices/shared/ProductImage.tsx:42, 99-105`
- Evidence: `isLoading` starts true, so the SSR HTML carries `opacity-0` plus a pulse overlay. The image becomes visible only after hydration, which makes it the probable LCP element on `/product/[id]`. Sibling products on that page load full-size originals instead of thumbnails.
- Fix: Add `priority fetchPriority="high"` on the hero and remove `loading="lazy"`, or dev mode throws. Start the hero visible. Pass `preferThumbnail` for the sibling grid. Keep `unoptimized`, because the image-transform quota was the reason it was disabled.

**RSC prop over-fetch (F068)**
Low · Verified · S · `frontend/app/prices/page.tsx:32`, `market/page.tsx:29`
- Evidence: A verifier measured about 306 KB raw but 36.8 KB brotli against production.
- Fix: Projecting away unused fields (`sku`, `price_recorded_at`, set and generation ids) and rounding returns to 2 decimal places brings it to 16.9 KB. Do not restructure into maps, since the extra 1 KB saving is not worth the regression surface.

**Header auth slot skeleton (F124)**
Low · Unverified · S · `frontend/app/components/Header.tsx:117`
- The header flashes a skeleton on every page. Default to the signed-out UI instead.

### Scroll and render performance

**Search re-downloads the catalog per keystroke (F016)**
High · Verified · S · `frontend/app/components/ProductPrices/index.tsx:127-163`
- Evidence: A verifier traced Next 16.3.6's navigation reducer. A search-param-only `router.replace` refreshes the page segment. `/prices` has no per-segment prefetch, so each distinct query string triggers a full RSC fetch. On arrival, new `initialProducts` identities defeat `ProductCard`'s memo and all 306 cards re-render.
- Fix: See Top 10 item 4. The filter and sort cost about 1 ms and is not the problem.

**306 live Recharts sparklines (F014, F066)**
High · Verified · M · `frontend/app/components/ProductPrices/cards/ProductCard.tsx:166`, `MiniSparkline.tsx:47-80`
- Impact: Currency and timeframe toggles freeze the page on phones. `/` and `/prices` download a 118 kB gzip chart library to draw 96x40 lines.
- Fix: See Top 10 item 5.

**No `content-visibility` on 306 cards (F015)**
Medium · Verified · S · `frontend/app/components/ProductPrices/index.tsx:249`
- The page has about 18k DOM nodes.
- Fix: Add `content-visibility: auto` with `contain-intrinsic-size: auto 520px` on flat cards, and `auto 400px` on grouped cards below `sm` and `auto 180px` above it. Full virtualization is not needed.

**Cards grow when history arrives (F071)**
Medium · Verified · S · `frontend/app/components/ProductPrices/cards/ProductCard.tsx:190-205, 309`
- The "Show full chart" button appears late and shifts the grid about 30 px while the user scrolls.
- Fix: Always render the button, `invisible` and `disabled` until history exists. The ReturnMetrics lines do not change, so leave them alone.

**Uncached Intl work in every card (F072)**
Medium · Verified · S · `frontend/app/components/ProductPrices/cards/ProductCard.tsx:75-83`
- `Intl.DateTimeFormat().resolvedOptions()` and `toLocaleString` with options run per card per render.
- Fix: Hoist the formatters to module scope. This is subsumed by Top 10 item 8.

**Other low-severity scroll items:**
- **PriceChart (F073).** Low. Verified. PriceChart constructs Intl formatters per point and mounts twice on mobile (`PriceChart.tsx:186`). Hoist the formatters and use a CSS-driven height. Do not seed `useResponsive` from `matchMedia` in state init, because that causes a hydration mismatch.
- **Compare tables (F074).** Low. Verified. `/compare` re-sorts and re-renders three tables per keystroke (`compare/page.tsx:645`). Use `useDeferredValue`, `table-fixed`, and one table per tab.
- **MarketView rows (F125).** Low. Unverified. MarketView rows are not memoized (`MarketView.tsx:622`).
- **Filter drawer (F126).** Low. Unverified. The mobile filter drawer animates `max-height` (`ControlBar.tsx:131`). Animate `grid-template-rows` instead.

### Data layer and caching

**Metrics RPC scans all history, twice per revalidation (F142, F080)**
High · Verified, including production statistics · M · `migrations/20260506_market_performance_functions.sql:38-98`
- Evidence: `daily_history` has no date bound and is joined by six correlated `LIMIT 1` subqueries per product. It is called from both `get_market_product_summaries` and `get_set_analytics` (`0023:248, 354`). Production has 306 products and 151,017 history rows.
- Production numbers: about 45k calls, mean 734 to 903 ms, max clipped at 3.0 s, and 10 timeout cancellations in 24 h matching 10 HTTP 500s. One hour showed 302 server-side calls despite the 1 hour `unstable_cache`.
- Fix: See Top 10 item 7. Longer term, have `main.py` write a metrics table at the end of each run so the RPCs become an indexed 306-row read. Also find out why the server path misses its cache so often. Nested `unstable_cache` calls (`serverMarketData.ts:603` inside `:913`) and per-region Data Cache behavior are the first suspects.

**`/compare` and `/box-calculator` call the heavy RPC from each browser (F143)**
Medium · Verified · M · `frontend/app/compare/page.tsx:345-348`, `BoxCalculator/hooks/useBoosterBoxPrices.ts:19`
- Impact: About 1 s of extra spinner per visit. On the roughly 2.7% of calls that hit the 3 s cap, users see "Unable to load market data" or an empty set list.
- Fix: Make both pages server components that pass `initialProducts`, exactly like `market/page.tsx`. Avoid a `/api/market/products` route, because the proxy rate-limits and session-refreshes every `/api/*` hit.

**Portfolio load is a serial three-stage waterfall (F144)**
Medium · Verified · M · `frontend/app/components/Portfolio/hooks/usePortfolioData.ts:62-81`
- Fix: Implement this together with Top 10 item 1. A single `GET /api/portfolio` doing get-or-create plus holdings server-side, with history in its own timeframe-keyed effect.

**Portfolio history downloads every daily row (F145)**
Medium · Verified · M · `frontend/app/lib/portfolio.ts:470`
- It pages up to 300 sequential 1000-row requests.
- Fix: Add a `get_portfolio_history(p_portfolio_id, p_days)` RPC, `SECURITY INVOKER` so RLS still applies, that folds per day in SQL using index-ordered `LATERAL` reads. It returns about 365 rows in one round trip.

**Server fallback path truncates to the oldest rows (F146)**
Medium · Verified · M · `frontend/app/lib/serverMarketData.ts:88`
- When the summaries RPC errors, up to 55 sequential pages load, capped at 50k rows ordered oldest-first, so recent returns come out blank.
- Fix: Order the fallback descending. Do not make the fetcher throw at build time without handling it, because `unstable_cache` does not serve stale data during static generation.

**`/product/[id]` is fully dynamic (F147)**
Medium · Verified · S · `frontend/app/product/[id]/page.tsx:149`
- Fix: Add `export const revalidate = 3600` and `generateStaticParams` returning `[]`, so ISR fills pages on first hit. Then remove the redundant `unstable_cache` wrapper.

**Other low-severity data items:**
- **Volume metrics RPC (F148).** Low. Verified. The volume metrics RPC scans the whole sales table for `day_freshness` (`migrations/0022:57`). Bound it to 63 days and add a partial index. Do not bound `latest_listings`, because stale products deliberately return it.
- **Refresh cadence and "hourly" copy (F151, F123).** Low. Unverified, but orchestrator-confirmed for the copy. Every cache revalidates hourly, stacked with a 1 hour client cache. Meanwhile `main.py` runs every 4 hours with a 23 hour per-product interval (`main.py:1082`), so prices change about once a day. The site says "refreshed hourly" in six places: `layout.tsx:29,33`, `page.tsx:207`, `prices/page.tsx:27`, `Footer.tsx:89,111`. Change the copy to "updated daily", and move to scrape-triggered revalidation (Top 10 item 7).
- **Missing portfolio indexes (F134).** Unverified. `portfolio_holdings(portfolio_id)` and `portfolio_lots(holding_id)` have no index after 0014, yet the RLS joins and cascades use them.
- **Duplicate recipe fetch (F149).** Unverified. Box recipes are fetched twice on mount, with `select("*")` (`BoxCalculator.tsx:117`).
- **Exchange-rate cache (F150).** Unverified. The client exchange-rate cache never expires and caches the fallback value (`exchangeRate.ts:11`).

### Architecture and code quality

**Market math implemented three to five times, already diverged (F005, F036, F040)**
Medium · Verified · M · `frontend/app/lib/serverMarketData.ts:204-250`, `MarketView/returns.ts`, `ReturnMetrics.tsx`, `PriceChart.tsx`
- Impact: For the same product, "Vol 30D" on `/market` and `/product` is about 19 times the set-level "Volatility 90D" on `/stats`, with no unit label.
- Fix: Consolidate into `app/lib/marketMath.ts`. `returns.ts` is already isomorphic. Keep PriceChart's chips on its downsampled series, or label them as range figures, because switching to daily points changes the displayed numbers.

**`compare/page.tsx` is a 1,079-line client page (F043, F004, F035)**
Medium · Verified · M · `frontend/app/compare/page.tsx:82, 308`
- It holds the CSV parser, margin math, comparator, `SortButton` and three tables, with zero tests.
- Fix: Extract the parser, the math and the sortable table. Note that `compareSortValues` treats NaN as missing and sorts case-sensitively, unlike the local comparator.

**Critical paths have no tests (F050, F042)**
Medium · Verified · M · `frontend/jest.config.js:22-25`
- Evidence: Coverage is 31.9% of statements. `proxy.ts`, all 8 route handlers, `csrf.ts`, `cookieOptions.ts`, `matchProduct` and import, `calculateNav`, `MarketView` and `compare` are all at 0%. `proxy.ts` sits outside `collectCoverageFrom`.
- Fix: Start with regression tests for the three fixes from the May audit: `hardenCookieOptions`, server-minted sign-in cookies, and the proxy copying rotated cookies onto the redirect. Route tests need `/** @jest-environment node */`, because `next/server` throws under jsdom.

**Other low-severity architecture items:**
- **Duplicated CSRF logic (F034, F041, F046).** Verified. Account delete and export re-implement the CSRF gate and body cap inline (`api/account/delete/route.ts:6-37`). Use `lib/csrf.ts`. The OAuth callback needs a response-based helper, not `createRouteSupabaseClient`.
- **Untyped DB boundary (F047, F038).** Verified. The Supabase clients are untyped, so `as unknown as` and `any` appear at every row boundary. Generate `Database` types with `supabase gen types`.
- **MarketView size (F045).** Verified. `MarketView.tsx` is 862 lines. Do not port `ProductPrices`' `useSearchParams` URL sync into it, because that would bail `/market` out of static rendering.
- **Inverted dependency (F048).** Verified. `lib/` imports types from `components/*/types` in six modules. Move them to `app/types/` behind a re-export shim.
- **Prop-drilled currency (F051).** Verified. Currency and rate are prop-drilled through 11 components, each defaulting to 1.36 (1.35 in `compare`). Use a client `CurrencyProvider` seeded from the server rate.
- **Logger bypass (F108).** Verified. 18 raw `console.*` calls bypass `logger.ts`, and the promised Sentry hook was never wired. There is also no `instrumentation.ts`, so the server and edge Sentry configs never load.
- **Stale docs and dead code (F107, F109).** Unverified. `.github/copilot-instructions.md` describes an architecture that no longer exists. `ExchangeRateService.ts` and `fetchSalesHistory` are dead code.

### UX, accessibility and professionalism

**Global "Loading price history…" toast covers the header (F032, F090)**
Medium · Verified · S · `frontend/app/components/ProductPrices/index.tsx:236-244`
- The toast uses `fixed top-4 right-4 z-50`, the same z-index as the sticky header, and later in the DOM. It pops in and out while scrolling, covering the account and sign-in buttons.
- Fix: Delete it.

**Portfolio modals are not accessible dialogs (F030, F023, F094)**
Medium · Verified · M · `frontend/app/components/Portfolio/cards/AddHoldingModal.tsx:120`
- They have no `role="dialog"` or `aria-modal`, no focus move, trap or restore, no Escape, and the X buttons have no name. `ProductSearchSelect` lacks combobox semantics.
- Fix: Use native `<dialog>` with `showModal()`, or a small focus-trap hook.

**Form labels not associated with inputs (F031)**
Medium · Verified · M · `AddHoldingModal.tsx:149-194`, `ProductPrices/controls/*.tsx`
- Fix: Add `id` and `htmlFor` pairs. Give the search inputs an `aria-label`. The timeframe radiogroup is already labeled.

**Password rules disagree with the server (F024, F098)**
Medium · Verified · S · `frontend/app/auth/signup/page.tsx:63, 162`
- The form says "At least 8 characters" while Supabase enforces 12. Raw backend errors are shown, and there are no `autoComplete` attributes.
- Fix: See Top 10 item 9. Also map GoTrue's `weak_password` by `error.code`.

**SEO and metadata basics missing (F028, F029, F088)**
Medium · Verified · M · `frontend/app/layout.tsx:26`
- One `<title>` covers every page. There is no `metadataBase`, OG image, canonical, `robots.ts`, `sitemap.ts` or Product structured data.
- Fix: Add per-route `metadata` and a `generateMetadata` for products. Use `alternates: { canonical: "./" }`, not `"/"`, because `"/"` is inherited and would mark every page as a duplicate of the homepage. Set `metadataBase`.

**No `not-found.tsx` or `loading.tsx` (F093, F087, F100)**
Medium · Verified · S · `frontend/app/product/[id]/page.tsx:159`
- A bad product id gets Next's stock 404, which also turns the body black in dark mode. Product navigation gives no feedback, and zero-result states are bare text.
- Fix: Add a branded `app/not-found.tsx` and a `product/[id]/loading.tsx` skeleton.

**Contrast failures (F095, F104)**
Medium · Verified · S · `frontend/app/components/ProductPrices/shared/ReturnMetrics.tsx:115-120`, `ProductCard.tsx:221`
- `text-slate-400` has about 2.6:1 contrast and is used for informational 10 to 11 px text. The gain and loss greens and reds fail AA.
- Fix: Use `--pf-ink-soft` (#475569) for hint text, and do not route it through `--pf-muted`, which is slate-400.

**Inconsistent money and date formatting (F089, F102)**
Medium · Verified · M
- Money shows as "$1649.99" on some surfaces and "$1,649.99" on others.
- Fix: Top 10 item 8.

**Other low-severity UX items:**
- **Promo density (F097, F092, F101).** Verified. There are two or three CardRinkTCG calls to action per page, and the `/market` banner sits above the data. Keep one per page, below the content.
- **Design-token drift (F091, F099).** Verified. ReturnMetrics uses `text-red-600` instead of `--pf-loss`, so two reds appear on one card. BoxCalculator, privacy and error pages use `gray-*` and `blue-*`, and privacy says "Pokefin".
- **"Last Refreshed" (F096, F112, F115).** Verified. It is formatted in UTC with no zone label (`app/page.tsx:185`).
- **Developer copy and native dialogs (F103).** Verified. Developer-facing copy and raw error strings reach users, and `alert()` and `confirm()` are used (`stats/page.tsx:129`, `BoxCalculator.tsx`, `PortfolioDashboard.tsx`).

### Ops, CI and the Python pipeline

**CI quality gates are weak (F076, F037, F052, F064, F139)**
Medium · Verified · M · `.github/workflows/ci.yml:19, 31-36, 48`
- Evidence: Lint is `continue-on-error` with 16 errors, 7 of which are real remount bugs. `next build` never runs in CI. The build hard-fails without a reachable Supabase, because five pages prerender against it. CI pins pnpm 10 while `package.json` pins 11.
- Fix: See Top 10 item 10. Make the build tolerate a failed RPC by returning `[]` and relying on ISR, so a DB outage cannot break a deploy.

**Other low-severity ops items:**
- **Scraper run lock (F086).** Verified. There is no run lock and no Selenium page-load timeout (`run_scraper.sh:71`). Use `flock -n` and `driver.set_page_load_timeout(30)`.
- **Migration chain (F135).** Unverified. `schema.sql` and the migration chain cannot rebuild production. `products.active` is defined nowhere. Commit a `0000_baseline.sql` dumped from production.
- **Report render timeout (F137).** Unverified. The weekly report's headless Chrome render has no timeout (`generate_weekly_report.py:633`).
- **Dead import (F141).** Info, unverified. `main.py:1463` imports a module that does not exist. Delete `check_shopify_prices()`.

---

## 5. What is already solid

- **CSRF and cookies.** Every state-changing route enforces the `x-pokefin-request` header, an Origin allowlist and a body-size cap. `hardenCookieOptions` makes every server-set cookie HttpOnly, Secure and SameSite=Lax, including the redirect path in `proxy.ts` and the PKCE exchange.
- **Database authorization.** RLS is enabled on every public table. User policies are scoped `TO authenticated` with `WITH CHECK` and the `(SELECT auth.uid())` InitPlan pattern (0014). Anon grants are revoked on user tables (0013). `delete_my_account` and `export_my_data` are SECURITY DEFINER bound to `auth.uid()` with pinned `search_path`, and a replay confirmed deletion cascades correctly.
- **Headers.** The CSP includes `frame-ancestors 'none'`, `object-src 'none'` and `form-action 'self'`, plus HSTS preload, COOP and CORP, and `poweredByHeader: false`.
- **Scraper image fetch.** `main.py:693-828` uses a host allowlist, DNS-resolved private-IP refusal, no redirects, a streamed 8 MiB cap and magic-byte detection. The report and email renderers escape all scraped text.
- **Supply chain.** `pnpm audit --prod` is clean, overrides carry rationale comments, Dependabot covers npm, pip and Actions, and CI runs pip-audit and trufflehog.
- **Data correctness guards.** The price-freshness gate (0023) is mirrored consistently on every read path. Paging breaks ties on `id`. `portfolio.ts:487-495` fails closed on truncation.
- **Build shape.** Recharts is isolated in one lazy chunk through `ChartBundle.tsx`. Catalog pages are ISR with parallel server fetches. `MarketView` already uses `useDeferredValue` with a memoized body. `next/font` avoids preloading the mono face.
- **Tests.** 265 frontend tests and 161 Python tests pass. Typecheck is clean.

---

## 6. Roadmap

**Now (this week)**
- Profile via `/api/auth/me` (F001, step one). Done when the header shows the username for a signed-in user.
- Migration `0024` making `export_my_data` VOLATILE (F020). Done when "Export my data" downloads JSON.
- Rate-limit classification (F077). Done when five consecutive login-page loads never return 429.
- Search via `history.replaceState` with a debounce, and delete the toast (F016, F032). Done when typing in `/prices` search issues zero network requests.
- Mobile menu fix, password length constant, and changing "hourly" to "daily" (F022, F024, F151). Done when all three are visibly correct on a phone.
- Captcha required in the sign-in and sign-up routes, a widget on forgot-password, and an explicit `redirectTo` (F019, F079). Done when a password reset completes end to end on production.

**Next (this month)**
- Route handlers for portfolio, holdings, lots, box recipes and username, a lint guard, and a post-deploy smoke test (F001, step two, plus F144). Done when `/portfolio` loads and edits holdings for a real account.
- SVG sparklines, batched history fetches and `content-visibility` (F014, F070, F015). Done when `/prices` loads no Recharts chunk until a full chart is opened.
- Server-rendered `/prices` (F012). Done when `curl /prices` HTML contains product names.
- Bounded metrics RPC and scrape-triggered revalidation (F142, F151). Done when there are zero statement timeouts per day and RPC calls are about 6 per day per region.
- Formatting module (F007, F089). Done when there are no hydration errors on `/` and release dates match the product page.
- CI requires a build, lint blocks, and the inline-component errors are fixed (F076, F056).
- Product ISR, hero priority, `not-found.tsx` and per-route metadata with a sitemap (F147, F069, F093, F028).

**Later (this quarter)**
- Consolidate market math and extract the `compare` page modules (F005, F043).
- Generated DB types (F047), tests for the proxy, routes, import and NAV (F050).
- Accessible dialogs and labels, and a contrast pass (F030, F031, F095).
- A least-privilege scraper role, and price plausibility plus flush ordering in `main.py` (F081, F083, F084).
- Server-rendered `/compare` and `/box-calculator` (F143), and a portfolio history RPC (F145).
- A baseline migration so the schema can be rebuilt (F135).

---

## 7. Method and limits

Ten finder passes covered auth and session security, API and header security, database and RLS, the Python pipeline, initial load, scroll and render, data and caching, architecture, UX, and React correctness. A measurement pass ran `tsc`, ESLint, Jest and a production build against a stubbed PostgREST endpoint to get route sizes and chunk composition. The 141 raw findings were clustered by root cause into 89. Every Critical, High and Medium cluster was re-derived by an independent verifier instructed to refute it: by code reading, by replaying migrations on a local Postgres 16, by micro-benchmarks, and in several cases by read-only queries against production Supabase logs and `pg_stat_statements`. All 69 such clusters were confirmed; many had their severity lowered or their recommendation corrected, and those corrections are folded in above. The 20 Low and Info clusters marked "Unverified" were not independently re-checked.

Not covered: no Lighthouse or WebPageTest run against the live site, since the review container could not reach `pokefin.ca`. No penetration testing or dependency exploitation. Production database inspection was limited to logs, statement statistics and two read-only aggregate queries. Bundle sizes come from a local build and may differ slightly from Vercel's output.

---

## 8. Addendum: re-verification and completeness pass (2026-10-01)

Usage limits had cut short part of the original verification. As a result, some findings above were confirmed only by a single low-effort check, and the 20 Low and Info items were never independently checked. All 54 of those findings have now been re-derived from the code by independent full-effort adversarial verifiers. A completeness critic then looked for anything the review missed, and two separate verifiers checked each item it found.

### Re-verification results

| Result | Count | Findings |
|---|---|---|
| Held, same severity | 45 | All others in the re-verified set |
| Severity lowered one level | 8 | F055, F058, F081, F083, F084, F145 (Medium to Low); F116, F131 (Low to Info) |
| Refuted | 1 | F126 (mobile filter drawer animation) |
| Raised | 0 | None |

Several verdicts also corrected details: line numbers, impact scope, or a recommendation that would have regressed something. The work package specs in `audits/remediation/` incorporate every correction. The most important are:

- **F032 (loading toast):** the severity is Medium, not High. It covers header controls only on screens narrower than about 1728 px.
- **F058 (username resets on focus):** this is latent today, because the profile is always null while F001 is unfixed. It becomes visible as soon as F001 is fixed, so the two ship together.
- **F059 (box recipe currency):** the new currency column must default to CAD, not USD, because the calculator starts in CAD.
- **F142 (metrics RPC):** it is confirmed High. The fix rewrites the anchors as index-ordered reads and bounds the history to 366 days, in one migration.
- **F126:** the animation exists in the code, but there is no measurable cost, so it is now informational.

### New findings from the completeness pass

The critic found these by reading files that no earlier finding cited. Two independent verifiers confirmed each one. Owners are listed in `audits/remediation/00-PLAN.md`.

<!-- NEW_FINDINGS_OWNERS -->

**N01. The Collectr import matcher picks the wrong variant and imports blank costs as $0** (Medium, `frontend/app/lib/import.ts:352`)
- **Symptom:** a Pokémon Center or other variant row matches the lowest-id variant in its set, is labelled "exact" and is preselected. The holding is recorded against the wrong product.
- **Other effects:** rows with no cost import at a $0 basis. Portfolios not named "Sealed Product" are silently dropped.
- **Fix:** score candidates on variant tokens before set-name equality, return "low" when more than one candidate remains, and show the variant in the preview. Treat a blank cost as "needs cost", not 0. Drop the portfolio-name filter or make it a choice.

**N02. Market Pulse volume windows end at today while day buckets lag** (Medium, `frontend/app/lib/marketPulse.ts:315`, and migration 0022)
- **Symptom:** in steady state, "Units sold (7d)" reads about 7% to 21% low and the 30-day volume trend about 2% to 5% low. Products near the ±20% threshold lean toward "Cooling off".
- **Fix:** anchor both current windows at `current_date - 1`, shift the prior window by the same amount, and change the SQL and TypeScript together.

**N03. Sentry never initialises** (Medium, `frontend/next.config.ts:81`)
- **Cause:** there is no `instrumentation.ts`, so the server and edge configs never load. Turbopack, the Next 16 default, also does not load `sentry.client.config.ts`.
- **Symptom:** setting a DSN produces no events at all.
- **Fix:** add `instrumentation.ts` with `register()` and `onRequestError`, rename the client config to `instrumentation-client.ts`, and give the edge config the same `beforeSend` scrubbing.

**N04. unstable_cache stores error fallbacks as good results for an hour** (Low, `frontend/app/lib/serverMarketData.ts:845`)
- **Symptom:** one transient error on the exchange-rate read pins CAD prices to 1.36 for an hour. One failed history query leaves a product chart empty for an hour.
- **Fix:** throw from the cached fetchers so ISR keeps serving the last good entry, and never cache the default rate.

**N05. The USD/CAD rate has no freshness guard and comes from scraping Bank of Canada HTML** (Low, `main.py:976`)
- **Symptom:** a failing scrape leaves an old rate in use with no indication. CAD history charts apply today's rate to every past point, so CAD returns always equal USD returns.
- **Fix:** switch to the Valet JSON API with an upsert keyed on the observation date, alert when the rate is stale, and show the rate date next to the currency toggle.

**N06. The privacy policy omits Vercel Web Analytics and Speed Insights** (Low, `frontend/app/privacy/page.tsx:61`)
- **Other issues:** it also overstates Sentry scrubbing and session rotation, and its last-updated date predates these components.
- **Fix:** list both Vercel services as sub-processors, correct the two claims, and bump the date.

**N07. CardRinkPromo reads sessionStorage without a guard** (Low, `frontend/app/components/CardRinkPromo.tsx:37`)
- **Symptom:** visitors who block site data get the error page on `/market` and `/prices`. A dismissed banner flashes on every load.
- **Fix:** wrap storage access in try/catch with an in-memory fallback, and render nothing until the stored state is known.

**N08. Seller-tool scripts use unguarded prices and stamp the wrong SKUs** (Low, `update_shopify_skus.py:249`, `compare_prices.py:206`)
- **Prices:** `compare_prices.py` compares against `products.usd_price` with no freshness or active filter.
- **SKUs:** `update_shopify_skus.py` copies the parent SKU onto every variant row and can give a Japanese listing an English SKU.
- **Fix:** read guarded prices, filter to active products, and leave variant SKUs alone or suffix them. Reject language mismatches, and warn on duplicate SKUs.

**N09. This report contradicted itself in two places** (Info)
- **Hydration mismatch:** F007 and F089 place the GroupHeader hydration mismatch on `/prices`. Today it happens only on `/`, because `/prices` cards are not server-rendered (F012). It moves to `/prices` once F012 is fixed, so the formatting fix (WP07) must land before or with the server-rendering fix (WP08), and the plan orders them that way.
- **Sentry:** F108 and F128 assume Sentry initialises, but it does not (N03).
- **Latent findings:** F033, F053, F144, F145 and F149 are latent behind F001, because those code paths cannot run until signed-in data access is fixed.
