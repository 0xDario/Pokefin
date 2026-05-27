# Pokéfin — Initial Project Structure Audit

**Audit topic:** Initial Project Structure Audit
**Branch audited:** `claude/security-vulnerability-analysis-LT3JQ` (post-hardening, current state)
**Date:** 2026-05-21
**Scope:** Full project structure — entry points, routes, middleware, integrations, DB connections, auth flow, file uploads, rate limiting, and core-file dependency review.

> Earlier audits in `audits/*.md` were read for context only. This document audits the **current** code as committed on the hardening branch.

---

## 1. Inventory

### 1.1 Entry points

#### Next.js frontend (`frontend/`)

| Type | Path | Notes |
|---|---|---|
| Edge middleware | `frontend/middleware.ts` | Runs before matched routes; refreshes Supabase session, gates protected paths. |
| Route handler (API) | `frontend/app/api/account/delete/route.ts` | `DELETE` — account self-deletion via RPC. |
| Route handler (OAuth/PKCE) | `frontend/app/auth/callback/route.ts` | `GET` — exchanges auth code for session. |
| Root layout | `frontend/app/layout.tsx` | Wraps app in `AuthProvider`, renders `Header`/`Footer`. |
| Error boundaries | `frontend/app/error.tsx`, `frontend/app/global-error.tsx` | Segment + global error UI. |
| Server-rendered pages (server data fetch) | `app/page.tsx`, `app/market/page.tsx`, `app/prices/page.tsx`, `app/stats/page.tsx`, `app/analytics/page.tsx` (re-export of stats), `app/product/[id]/page.tsx` | Use `getCached*` server functions in `serverMarketData.ts`. |
| Client pages (CSR) | `app/portfolio/page.tsx`, `app/account/page.tsx`, `app/compare/page.tsx`, `app/box-calculator/page.tsx`, `app/auth/login/page.tsx`, `app/auth/signup/page.tsx`, `app/auth/forgot-password/page.tsx`, `app/auth/reset-password/page.tsx` | `"use client"`; fetch via browser Supabase client. |

There is **no** `app.js`/`server.js` Express entry — this is App Router only. Confirmed: there are exactly **2** `route.ts` handlers in `frontend/app/**`.

#### Python scrapers (repo root) — each has a `__main__`

| Script | `__main__` line | Purpose |
|---|---|---|
| `main.py` | `main.py:760` | Selenium TCGPlayer price scraper + Bank of Canada FX fetch. CLI: `--run-now`, `--debug`. |
| `backfill_historical_prices.py` | `backfill_historical_prices.py:803` | Historical price backfill into `product_price_history`. |
| `compare_prices.py` | `compare_prices.py:688` | Compares Supabase market prices vs Shopify Admin API. |
| `generate_skus.py` | `generate_skus.py:391` | Generates SKUs; `--apply`/`--export` flags. |
| `update_shopify_skus.py` | `update_shopify_skus.py:345` | Produces Shopify SKU import CSV; `--apply` flag. |

### 1.2 Route / endpoint table

| Method | Route | Handler / file | Auth gate | Data path |
|---|---|---|---|---|
| `DELETE` | `/api/account/delete` | `app/api/account/delete/route.ts:21` | Middleware matcher + in-handler `getUser()` + CSRF header + Origin allowlist | `supabase.rpc("delete_my_account")` |
| `GET` | `/auth/callback` | `app/auth/callback/route.ts:21` | Middleware matcher (no user requirement) | `supabase.auth.exchangeCodeForSession(code)` |
| `GET` (page) | `/` | `app/page.tsx` | none (public) | `getCachedExchangeRate`, `getCachedMarketProductSummaries` |
| `GET` (page) | `/market` | `app/market/page.tsx` | none (public) | `getCachedMarketProductSummaries`, `getCachedExchangeRate` |
| `GET` (page) | `/prices` | `app/prices/page.tsx` | none (public) | same as above |
| `GET` (page) | `/stats`, `/analytics` | `app/stats/page.tsx` (`analytics` re-exports) | none (public) | `getCachedSetAnalytics` |
| `GET` (page) | `/product/[id]` | `app/product/[id]/page.tsx` | none (public) | `getCachedProductDetail(productId)` |
| `GET` (page) | `/portfolio` | `app/portfolio/page.tsx` | Middleware (`/portfolio/:path*`) + client `useAuth` redirect | client Supabase via `portfolio.ts` |
| `GET` (page) | `/account` | `app/account/page.tsx` | Middleware (`/account/:path*`) + client `useAuth` redirect | client Supabase |
| `GET` (page) | `/box-calculator` | `app/box-calculator/page.tsx` | none (public; save requires login client-side) | `useBoxRecipes` (client Supabase + RPC) |
| `GET` (page) | `/compare` | `app/compare/page.tsx` | none (public) | client market + FX data |
| `GET` (page) | `/auth/login`, `/auth/signup`, `/auth/forgot-password`, `/auth/reset-password` | `app/auth/*/page.tsx` | none (public) | Supabase Auth |

#### Supabase RPCs (database functions invoked from app code)

| RPC | Defined in | Caller | Security |
|---|---|---|---|
| `delete_my_account()` | `migrations/0002_account_deletion.sql:40` | `app/api/account/delete/route.ts:60` | `SECURITY DEFINER`, `SET search_path = public, auth`; bound to `auth.uid()`; `GRANT EXECUTE` to `authenticated` only. |
| `get_shared_recipe(p_share_code text)` | `migrations/0005_box_recipes_share_code_hardening.sql:21` | `useBoxRecipes.ts:183` | `SECURITY DEFINER`, returns `SETOF` w/ `LIMIT 1`, filters `is_public = true`; `GRANT EXECUTE` to `anon, authenticated`. |
| `handle_new_user()` | `migrations/0004_handle_new_user_trigger.sql:5` | `AFTER INSERT` trigger on `auth.users` | `SECURITY DEFINER`; not directly callable. |
| `get_market_product_summaries()` | `migrations/20260506_market_performance_functions.sql` | `serverMarketData.ts:559` | Aggregate read function (public market data). |
| `get_set_analytics()` | `migrations/20260506_market_performance_functions.sql` | `serverMarketData.ts:570` | Aggregate read function (public market data). |

### 1.3 Middleware chain and order

`frontend/middleware.ts` — single middleware function:

```
matcher = [ "/account/:path*", "/portfolio/:path*", "/api/account/:path*", "/auth/callback" ]
```

Order of operations inside `middleware()`:
1. `NextResponse.next({ request })` — create pass-through response.
2. Read `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_KEY`; **if missing → return early, no auth gate** (`middleware.ts:14`).
3. Construct `createServerClient` with cookie get/set bridged to req/res.
4. `await supabase.auth.getUser()` — refreshes session, rotates cookies onto `res`.
5. Match `path` against `PROTECTED_PATTERNS` (`/account`, `/portfolio` only).
6. If `requiresAuth && !user` → 302 redirect to `/auth/login?next=<path>`.
7. Otherwise return `res`.

**Observations:**
- There is **no rate-limiting stage** in the chain (deferred — see §1.8).
- `PROTECTED_PATTERNS` covers `/account` and `/portfolio` but **not** `/api/account/:path*`, even though the matcher includes it. The API route is matched (so the middleware runs and refreshes the session) but the middleware does **not** itself reject unauthenticated API calls — the route handler does its own `getUser()` check (`route.ts:53`). Functionally safe, but the gate ordering is in the route handler, not middleware.
- `/auth/callback` is matched only so the session-cookie refresh runs; it is intentionally unauthenticated.

### 1.4 External service integrations

| Service | Where | Direction | Auth material |
|---|---|---|---|
| **Supabase** (PostgreSQL + Auth + PostgREST + RPC) | `supabase.ts`, `serverSupabase.ts`, `serverMarketData.ts`, `middleware.ts`, `api/account/delete/route.ts`, `auth/callback/route.ts`, `import.ts`, `portfolio.ts`, `useBoxRecipes.ts`; Python: `main.py`, `backfill_historical_prices.py`, `compare_prices.py`, `generate_skus.py` | Read/write DB, Auth | Anon key (`NEXT_PUBLIC_SUPABASE_KEY`) on frontend; Python uses key from `secretsFile.py` (expected to be service-role for scraper writes). |
| **Cloudflare Turnstile** | `app/auth/login/page.tsx:103`, `app/auth/signup/page.tsx:178`; site key `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Token passed to `supabase.auth.signUp/signInWithPassword` (`AuthContext.tsx:117-140`). | CAPTCHA challenge | Site key public; **secret verified server-side by Supabase Auth** (configured in dashboard, not in repo). No local `siteverify` call exists — correct for the Supabase captcha integration. |
| **TCGPlayer** | `main.py` (Selenium scrape; `page_source.html` is a sample dump), image fetch `main.py:260`. Images allowed in CSP `img-src` and `next.config.ts` `remotePatterns`. | Outbound scrape | None. |
| **Bank of Canada** | `main.py:455` (`requests.get(boc_url, timeout=10)`) | Outbound API for USD/CAD rate | None. |
| **Shopify Admin API** | `compare_prices.py:71` (`/admin/api/{ver}/products.json`), `update_shopify_skus.py` | Outbound API | `X-Shopify-Access-Token` from `SHOPIFY_ADMIN_API_TOKEN` (env / `secretsFile.py`). |
| **Vercel** | Hosting platform (`.vercel` git-ignored). No code integration. | Deploy target | — |

### 1.5 Database connection points

| File | Client kind | Notes |
|---|---|---|
| `frontend/app/lib/supabase.ts` | `createBrowserClient` (anon, PKCE flow) | Module-level singleton; throws if env vars missing. |
| `frontend/app/lib/serverSupabase.ts` | `createServerClient` w/ `next/headers` cookies | `import "server-only"`; `createServerSupabaseClient()` per request. |
| `frontend/app/lib/serverMarketData.ts` | Uses `createServerSupabaseClient()` | Cached server reads (`unstable_cache`, 3600s) + RPC calls. |
| `frontend/middleware.ts` | `createServerClient` w/ req/res cookie bridge | Session refresh + gate. |
| `frontend/app/api/account/delete/route.ts` | `createServerClient` w/ `next/headers` cookies | RPC call. |
| `frontend/app/auth/callback/route.ts` | `createServerClient` w/ req/res cookie bridge | Code exchange. |
| `frontend/app/lib/portfolio.ts`, `import.ts`, `useBoxRecipes.ts` | Browser client (`./supabase`) | All portfolio/recipe CRUD runs through the **anon** client; security relies on RLS. |
| Python `main.py:163`, `backfill_historical_prices.py:53`, `compare_prices.py:42`, `generate_skus.py:33` | `create_client(SUPABASE_URL, SUPABASE_KEY)` | Credentials imported from `secretsFile.py` (`from secretsFile import SUPABASE_URL, SUPABASE_KEY`). `secretsFileTemplate.py` is the committed placeholder. |

### 1.6 Authentication / authorization flow

- **Sign-up / sign-in:** `AuthContext.tsx` calls `supabase.auth.signUp` / `signInWithPassword` with a Turnstile `captchaToken`. Profile row is created **server-side** by the `on_auth_user_created` trigger → `handle_new_user()` (`migrations/0004`); the client no longer inserts into `profiles` (mass-assignment surface removed).
- **Sessions:** `@supabase/ssr` cookie-based sessions. Browser client uses PKCE flow (`supabase.ts:13`). Middleware refreshes/rotates the session cookie on every matched request.
- **Route gate:** `middleware.ts` redirects unauthenticated users away from `/account*` and `/portfolio*`. Client pages additionally redirect via `useAuth()` (`portfolio/page.tsx`, `account/page.tsx`).
- **Authorization (data layer):** RLS enabled on `profiles`, `portfolios`, `portfolio_holdings`, `portfolio_lots`, `products`, `product_price_history`, `sets`, `generations`, `product_types`, `exchange_rates` (`migrations/0001`) and `box_recipes` (`create_box_recipes.sql` + `0005`). User-owned tables use owner-scoped `auth.uid()` policies; reference data is read-only to `anon`/`authenticated`. `portfolio.ts` adds **defense-in-depth** owner filters (`userOwnsHolding`, `.eq("user_id", ...)`) on top of RLS.
- **Account deletion:** `DELETE /api/account/delete` requires the `x-pokefin-request: 1` header and an allowlisted `Origin`, re-checks `getUser()`, then calls `delete_my_account()` RPC (cascades via `ON DELETE CASCADE`). No service-role key needed in the function tier.
- **Password reset:** `resetPasswordForEmail` deliberately omits `redirectTo`, relying on the Supabase-configured Site URL → `/auth/callback?type=recovery` → `/auth/reset-password`.

### 1.7 File upload handling locations

- **No multipart/form-data file upload endpoint exists.** The only "upload"-like surface is **client-side CSV import** in `frontend/app/lib/import.ts` (`parseCollectrCSV`, `processCollectrImport`) used by `app/components/Portfolio/cards/ImportHoldingsModal.tsx`. The CSV is parsed entirely in the browser; matched rows are inserted via `addHolding()` (anon client → RLS-gated `portfolio_holdings`). No file ever reaches a server route or disk.
- Python scrapers write `page_source.html` and read/write local JSON/CSV, but those are not network-exposed upload handlers.

### 1.8 API rate limiting implementation

- **No application-level rate limiting exists in code.** Confirmed: `middleware.ts` has no limiter; no `@upstash/ratelimit` / `@upstash/redis` in `frontend/package.json`.
- `audits/HARDENING_FOLLOWUPS.md` §4 explicitly defers this pending an Upstash account and gives a drop-in snippet. Auth-endpoint abuse is currently mitigated only by **Supabase Auth's built-in rate limits** (dashboard-configured) and **Cloudflare Turnstile** on login/signup.

---

## 2. Findings

### F-1 — `.env` files not git-ignored at repo root (Python side)

- **Severity:** Medium
- **CWE:** CWE-538 (Insertion of Sensitive Information into Externally-Accessible File), CWE-312 (Cleartext Storage)
- **Evidence:** `/.gitignore` (root) lines 1–11 ignore `secretsFile.py`, `.idea`, `__pycache__`, `venv`, `my_listings.json`, `price-check-*.md`, `price_report_*.md` — but **no `.env` pattern**. `frontend/.gitignore:34` ignores `.env*` but only within `frontend/`. Verified: `git check-ignore .env` at repo root returns nothing (`.env` NOT ignored); `git check-ignore secretsFile.py` succeeds.
- **Why it matters:** `compare_prices.py` and `_get_shopify_credentials()` (`compare_prices.py:48-52`) read `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_API_TOKEN`, `SHOPIFY_API_VERSION`, plus `SUPABASE_URL`/`SUPABASE_KEY` from `os.getenv(...)`. A developer following the common pattern of placing those in a root `.env` file would have it committed without warning. The Shopify Admin token and a Supabase service-role key are high-value secrets.
- **Exploitability + PoC:** Low-effort accidental exposure. PoC (non-destructive): `echo 'SHOPIFY_ADMIN_API_TOKEN=test' > .env && git status --porcelain` — `.env` shows as an untracked candidate for `git add` (it is not ignored). On a real commit it would be pushed to GitHub.
- **Remediation (minimal drop-in):** add to root `.gitignore`:
  ```gitignore
  # env files (Python side)
  .env
  .env.*
  ```
- **Defense-in-depth:** Enable GitHub secret scanning + push protection (no `.github/` config currently does this); rotate any secret if a `.env` was ever committed; prefer a secrets manager / CI variables over files on disk.

### F-2 — `page_source.html` (424 KB scrape dump) committed to the repo

- **Severity:** Low
- **CWE:** CWE-540 (Inclusion of Sensitive Information in Source Code), CWE-1188 (Insecure Default)
- **Evidence:** `git ls-files` lists `page_source.html`; file is 424,663 bytes at repo root. It is a raw TCGPlayer page dump produced by the Selenium scraper in `main.py`. Not referenced by any application code.
- **Why it matters:** Scrape dumps can embed third-party tracking tokens, session artifacts, or internal URLs, and they bloat the repo. It is build/debug output, not source.
- **Exploitability + PoC:** Informational — inspect with `git show HEAD:page_source.html | head`. No direct exploit, but it is an anti-pattern that increases the chance of future sensitive-artifact commits.
- **Remediation:** `git rm --cached page_source.html` and add `page_source.html` (and ideally `*.html` scratch dumps) to root `.gitignore`. *(Do not perform repo edits as part of this audit — recorded as a recommendation.)*
- **Defense-in-depth:** Have the scraper write debug HTML to a `tmp/` or `debug/` directory that is git-ignored by default.

### F-3 — Middleware fails open when Supabase env vars are absent

- **Severity:** Low
- **CWE:** CWE-636 (Not Failing Securely — "Failing Open")
- **Evidence:** `frontend/middleware.ts:12-14`:
  ```ts
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) return res;   // <- skips the auth gate
  ```
- **Why it matters:** If the env vars are missing or misnamed in a given deployment/preview, the middleware returns the pass-through response **without enforcing the `/account` and `/portfolio` redirect**. Pages still fail closed because the browser Supabase client throws at import (`supabase.ts:6-10`) and protected client pages redirect via `useAuth()`, so impact is limited — but the middleware gate itself is bypassed.
- **Exploitability:** Requires a misconfigured environment; not remotely exploitable on a correctly configured prod deployment. Low severity because the data layer (RLS) and client-side `useAuth` redirects still hold.
- **Remediation (minimal drop-in):** fail closed for protected paths:
  ```ts
  if (!supabaseUrl || !supabaseKey) {
    const path = req.nextUrl.pathname;
    if (PROTECTED_PATTERNS.some((re) => re.test(path))) {
      const url = req.nextUrl.clone();
      url.pathname = "/auth/login";
      return NextResponse.redirect(url);
    }
    return res;
  }
  ```
- **Defense-in-depth:** Validate required env vars at build time (e.g., a `next.config.ts` assertion or a Vercel "required env var" setting) so a missing var fails the deploy rather than degrading auth.

### F-4 — No application-layer rate limiting (auth + account endpoints)

- **Severity:** Medium
- **CWE:** CWE-307 (Improper Restriction of Excessive Authentication Attempts), CWE-770 (Allocation of Resources Without Limits)
- **Evidence:** No limiter in `middleware.ts`; no `@upstash/*` deps in `frontend/package.json`. `audits/HARDENING_FOLLOWUPS.md` §4 confirms it is deferred. The matcher already includes `/api/account/:path*` and `/auth/callback`, so a limiter could slot into the existing middleware.
- **Why it matters:** `/auth/login`, `/auth/signup`, `/auth/forgot-password` and `DELETE /api/account/delete` are reachable without an app-layer throttle. Mitigations that *do* exist: Turnstile on login/signup, and Supabase Auth's own rate limits. But `/auth/forgot-password` and the callback are not Turnstile-gated, and account-delete relies only on per-request auth checks.
- **Exploitability + safe PoC:** Credential-stuffing / password-spray / reset-email flooding. Minimal *non-destructive* probe: `for i in $(seq 1 30); do curl -s -o /dev/null -w "%{http_code}\n" https://pokefin.ca/auth/forgot-password; done` — observe whether any `429` ever appears (currently none from the app tier).
- **Remediation (minimal drop-in):** Implement the `HARDENING_FOLLOWUPS.md` §4 snippet (Upstash `Ratelimit.fixedWindow` in `middleware.ts` before the auth gate) **or** configure Cloudflare WAF rate-limiting rules for `/auth/*` and `/api/*`.
- **Defense-in-depth:** Add Turnstile to `/auth/forgot-password`; verify Supabase Auth rate-limit settings (HARDENING §2); add monitoring/alerting on auth-failure spikes.

### F-5 — Portfolio/box-recipe CRUD runs entirely on the anonymous client (RLS-only authorization)

- **Severity:** Low (informational / architectural — currently safe given RLS)
- **CWE:** CWE-602 (Client-Side Enforcement of Server-Side Security) — partial
- **Evidence:** `portfolio.ts`, `import.ts`, and `useBoxRecipes.ts` all import the **browser** anon client (`./supabase`). All inserts/updates/deletes for `portfolios`, `portfolio_holdings`, `portfolio_lots`, `box_recipes` go through PostgREST as the `authenticated` role. Authorization is enforced solely by RLS policies (`migrations/0001`, `create_box_recipes.sql`, `0005`) plus the optional defense-in-depth `.eq("user_id", …)` filters in `portfolio.ts`.
- **Why it matters:** The entire write-side security model depends on the migrations actually being applied to the production database. `HARDENING_FOLLOWUPS.md` §1 explicitly states the migrations are **not yet applied** — until they are, every authenticated user could read/modify other users' rows. This is a deployment-state risk, not a code defect.
- **Exploitability + PoC:** If RLS is not enabled in prod: an authenticated user can run `supabase.from('portfolio_holdings').select('*')` and receive all users' holdings. Verify with the assertion query in `HARDENING_FOLLOWUPS.md` §1 (`rowsecurity` should be `t` and `policy_count >= 1` for every public table).
- **Remediation:** Apply migrations `0001`–`0005` to production (HARDENING §1) and run the post-apply assertions. The code is correct; the gate is operational.
- **Defense-in-depth:** Consider routing sensitive mutations through server actions / route handlers with `serverSupabaseClient` so authorization is not 100% reliant on a single RLS toggle; keep the `userOwnsHolding`-style checks.

### F-6 — `box_recipes` RLS write policies are not role-scoped to `authenticated`

- **Severity:** Low
- **CWE:** CWE-732 (Incorrect Permission Assignment for Critical Resource)
- **Evidence:** In `migrations/create_box_recipes.sql:31-48` the INSERT/UPDATE/DELETE/SELECT policies are declared without `TO authenticated` (e.g. `CREATE POLICY "Users can create their own recipes" ON public.box_recipes FOR INSERT WITH CHECK (auth.uid() = user_id);`). Migration `0001`'s user-owned policies, by contrast, all specify `FOR ALL TO authenticated`. The `box_recipes` policies therefore also apply to the `anon` role.
- **Why it matters:** For `anon`, `auth.uid()` is `NULL`, so `auth.uid() = user_id` is `NULL` (never true) and the practical effect is still "deny" — so this is **not currently exploitable**. It is flagged as a hardening inconsistency: relying on `NULL`-comparison semantics instead of an explicit role grant is fragile and diverges from the pattern used in `0001`.
- **Exploitability:** None demonstrated — `WITH CHECK (auth.uid() = user_id)` blocks anon inserts. Low severity, defense-in-depth only.
- **Remediation (minimal drop-in):** add a follow-up migration recreating the four policies with `TO authenticated`, e.g.:
  ```sql
  DROP POLICY IF EXISTS "Users can create their own recipes" ON public.box_recipes;
  CREATE POLICY box_recipes_insert_self ON public.box_recipes
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  -- repeat for SELECT-own / UPDATE / DELETE
  ```
- **Defense-in-depth:** Note `UPDATE` policy lacks a `WITH CHECK` clause (`create_box_recipes.sql:41-43`) — a user could `UPDATE` a row they own and change `user_id` to another user. Add `WITH CHECK (auth.uid() = user_id)` to the UPDATE policy.

### F-7 — Dependency review (versions read from `frontend/package-lock.json`)

- **Severity:** Low (no confirmed exploitable CVE in the resolved versions)
- **CWE:** CWE-1395 (Dependency on Vulnerable Third-Party Component) — *not currently triggered*
- **Evidence — resolved versions from `frontend/package-lock.json` (lockfileVersion 3):**

  | Package | Resolved version | Assessment |
  |---|---|---|
  | `next` | 16.1.1 | Current major; well past the CVE-2025-29927 middleware-bypass range (`<15.2.3`/`<14.2.25`) and past the CVE-2024-34351 SSRF range. **Pass.** |
  | `react` / `react-dom` | 19.2.3 | Current. No known advisories. |
  | `@supabase/ssr` | 0.8.0 | Matches `package.json`. No known advisories. |
  | `@supabase/supabase-js` | 2.90.0 | Current. No known advisories. |
  | `recharts` | 2.15.4 | No known advisories. |
  | `@marsidev/react-turnstile` | 1.4.1 | No known advisories. |
  | `eslint-config-next` | 16.1.1 | Dev dep. |
  | `typescript` | 5.9.3 | Dev dep. |
  | `jest` | 29.7.0 | Dev dep. |
  | `braces` | 3.0.3 | Past the CVE-2024-4068 fix (`>=3.0.3`). **Pass.** |
  | `cross-spawn` | 7.0.6 | Past the CVE-2024-21538 ReDoS fix (`>=7.0.5`). **Pass.** |
  | `ws` | 8.19.0 | Past the CVE-2024-37890 DoS fix. **Pass.** |
  | `semver` | 6.3.1 | Past the CVE-2022-25883 ReDoS fix (`6.3.1`). **Pass.** |
  | `postcss` | 8.5.6 | Past the CVE-2023-44270 fix (`>=8.4.31`). **Pass.** |
  | `cookie` | 1.1.1 | Past the CVE-2024-47764 fix (`>=0.7.0`). **Pass.** |
  | `nanoid` | 3.3.11 | Past the CVE-2024-55565 fix (`>=3.3.8`). **Pass.** |
  | `@babel/helpers` | 7.28.4 | Past the CVE-2025-27789 RegExp fix. **Pass.** |
  | `tough-cookie` | 4.1.4 | Past the CVE-2023-26136 prototype-pollution fix (`>=4.1.3`). **Pass.** |

- **Note:** Two lockfiles are present — `frontend/package-lock.json` (npm) and `frontend/pnpm-lock.yaml`. Versions above are from `package-lock.json` as instructed. Keeping both lockfiles risks drift between npm and pnpm installs.
- **Python deps (`requirements.txt`):** `requests`, `selenium`, `webdriver-manager`, `supabase`, `beautifulsoup4` — **all unpinned (no version specifiers)**. **Unable to verify** exact installed versions from the repo (no `Pipfile.lock` / `poetry.lock` / pinned `requirements.txt`).
- **Why it matters:** Unpinned Python deps mean every install can pull a different (potentially newly-vulnerable) version, and builds are not reproducible. `selenium`/`webdriver-manager` historically have had advisories; without pins, exposure is indeterminate.
- **Remediation:** Pin Python deps with hashes (`pip-compile`/`uv` → fully pinned `requirements.txt`), and decide on a single JS package manager (delete the unused lockfile). Run `npm audit` / `pip-audit` in CI.
- **Defense-in-depth:** Add Dependabot or Renovate (no `.github/dependabot.yml` present) and a CI `audit` step (see F-8).

### F-8 — No CI security gates (`.github/` has only Copilot instructions)

- **Severity:** Low
- **CWE:** CWE-1120 (Excessive Code Complexity / lack of automated checks — process gap)
- **Evidence:** `.github/` contains only `copilot-instructions.md`. There is **no `.github/workflows/` directory**, no `dependabot.yml`, no CodeQL/secret-scanning config. `frontend/package.json` defines `lint`, `test`, `build` scripts that are never run automatically.
- **Why it matters:** Findings F-1, F-2, F-7 (and any future regressions of the hardening work) would be caught automatically by a CI pipeline running `npm audit`, `pip-audit`, secret scanning, and the existing Jest/Python test suites (`frontend/app/**/__tests__`, `tests/test_*.py`).
- **Remediation:** Add a GitHub Actions workflow that runs `npm ci && npm run lint && npm test && npm run build` for `frontend/`, `python -m pytest tests/` for the scrapers, plus `npm audit --audit-level=high` and `pip-audit`. Enable Dependabot and GitHub secret-scanning push protection.
- **Defense-in-depth:** Add CodeQL scanning; require the workflow as a branch-protection status check on `master`.

---

## 3. Summary risk score

**Overall: 3.5 / 10 (Low–Moderate).**

The hardening branch is in good shape: RLS migrations, security headers (`next.config.ts`), `@supabase/ssr` cookie sessions, CSRF/Origin gate on account-delete, server-side profile creation, CSPRNG share codes, LIKE-escaping, and a tightly-scoped `delete_my_account` RPC are all present in code. No exploitable dependency CVE was confirmed. The residual risk is dominated by **operational/deployment state** (migrations must actually be applied — F-5), **deferred rate limiting** (F-4), and **process gaps** (root `.env` not ignored — F-1; no CI — F-8). No Critical or High code-level vulnerability was found in the current state.

### Top prioritized fixes

1. **Apply migrations `0001`–`0005` to production and run the assertion queries** (F-5). Until done, RLS may be off and the entire portfolio/recipe authorization model is absent. Highest real-world impact.
2. **Add `.env` / `.env.*` to the root `.gitignore`** (F-1). One-line change preventing accidental Shopify-token / Supabase-key disclosure.
3. **Implement rate limiting** on `/auth/*` and `/api/*` — Upstash snippet from `HARDENING_FOLLOWUPS.md` §4 or Cloudflare WAF rules (F-4).
4. **Add a CI pipeline** with `npm audit` / `pip-audit`, lint, tests, secret-scanning, and Dependabot (F-7, F-8).
5. **Make middleware fail closed** when Supabase env vars are missing, and add an explicit `WITH CHECK` to the `box_recipes` UPDATE policy + `TO authenticated` scoping (F-3, F-6).

---

## 4. Checklist diff — the 8 enumerated items

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | All entry points identified | **Pass** | 2 `route.ts` handlers, `middleware.ts`, layout/error boundaries, all `page.tsx`; 5 Python `__main__` scripts. See §1.1. |
| 2 | All routes & endpoints (route.ts, server pages, RPCs) | **Pass** | Full route table + 5 Supabase RPCs documented. See §1.2. |
| 3 | Middleware chain & order (rate-limit vs auth) | **Pass (with finding)** | Single middleware: session-refresh → auth gate. No rate-limit stage (deferred). `/api/account/*` is matched but gated only by the route handler, not middleware. See §1.3, F-3. |
| 4 | External service integrations | **Pass** | Supabase, Turnstile, TCGPlayer, Bank of Canada, Shopify, Vercel — all enumerated. See §1.4. |
| 5 | Database connection points | **Pass** | `supabase.ts`, `serverSupabase.ts`, `serverMarketData.ts`, middleware, route handlers, Python `create_client` via `secretsFile.py`. See §1.5. |
| 6 | Auth / authz flow (SSR cookies + middleware + RLS) | **Pass (with finding)** | `@supabase/ssr` cookies + PKCE + middleware gate + RLS + trigger-based profile creation. Authorization correctness depends on migrations being applied in prod. See §1.6, F-5, F-6. |
| 7 | File upload handling | **Not Applicable** | No server-side file-upload endpoint. Only client-side CSV parsing in `import.ts`; data persists via RLS-gated inserts. See §1.7. |
| 8 | API rate limiting | **Fail** | No app-layer rate limiting in code; confirmed deferred in `HARDENING_FOLLOWUPS.md` §4. Only Turnstile + Supabase Auth built-in limits exist. See §1.8, F-4. |

---

## 5. Cited locations (quick index)

- Entry points: `frontend/middleware.ts`, `frontend/app/api/account/delete/route.ts`, `frontend/app/auth/callback/route.ts`, `frontend/app/layout.tsx`, `frontend/app/error.tsx`, `frontend/app/global-error.tsx`; `main.py:760`, `backfill_historical_prices.py:803`, `compare_prices.py:688`, `generate_skus.py:391`, `update_shopify_skus.py:345`.
- Middleware gate: `frontend/middleware.ts:4-7` (patterns), `:12-14` (fail-open), `:31-43` (gate), `:48-55` (matcher).
- Security headers / CSP: `frontend/next.config.ts:3-33`.
- DB clients: `frontend/app/lib/supabase.ts:12`, `serverSupabase.ts:15`, `serverMarketData.ts:559/570`.
- RPC defs: `migrations/0002_account_deletion.sql:40`, `migrations/0004_handle_new_user_trigger.sql:5`, `migrations/0005_box_recipes_share_code_hardening.sql:21`.
- RLS: `migrations/0001_enable_rls_and_policies.sql`, `migrations/create_box_recipes.sql:22-48`.
- gitignore: root `/.gitignore` (no `.env`), `frontend/.gitignore:34`.
- Dependency versions: `frontend/package-lock.json`; Python `requirements.txt` (unpinned).
