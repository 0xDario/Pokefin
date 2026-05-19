# Pokefin — Comprehensive Security Report

**Repository:** `/home/user/Pokefin`
**Stack:** Next.js 15 (App Router, TypeScript) on Vercel + Supabase (Postgres, Auth, Storage, PostgREST) + Python scrapers (`main.py`, `backfill_historical_prices.py`, `compare_prices.py`, `generate_skus.py`, `update_shopify_skus.py`)
**Date:** 2026-05-19
**Source sub-reports (audits/):**
- [`api-and-infrastructure.md`](./api-and-infrastructure.md) — sub-score 6.5/10
- [`authentication-flow.md`](./authentication-flow.md) — sub-score 7.0/10
- [`authorization-implementation.md`](./authorization-implementation.md) — sub-score 6.5/10
- [`business-logic-vulnerabilities.md`](./business-logic-vulnerabilities.md) — sub-score 8.5/10

---

## Executive Summary

| Dimension | Result |
|---|---|
| **Overall posture** | **High risk** (verging on Critical, contingent on live RLS state) |
| **Consolidated risk score** | **7.5 / 10** |
| **Findings reviewed** | 33 unique (deduplicated across the four sub-reports) |
| **Critical** | 1 (conditional — flips to Critical if RLS is not enforced in production) |
| **High** | 7 |
| **Medium** | 11 |
| **Low / Informational** | 14 |

### Why 7.5 / 10
The four sub-scores (6.5, 7.0, 6.5, 8.5) cluster around 7. Business-logic (8.5) dominates because the *entire* authorization model is delegated to Supabase RLS, yet only **one** of the 12 user-relevant tables (`box_recipes`) has policy DDL checked into the repo. If RLS is not enforced on `portfolios`, `portfolio_holdings`, `portfolio_lots`, `profiles`, `exchange_rates`, `product_price_history`, or `products` in the live DB, the publicly-shipped anon key turns into a write-everything credential. The MCP `list_tables` output cited in `authorization-implementation.md` shows `rls_enabled=true` on every public table — but the *policy content* could not be inspected, so the worst case (RLS on, no SELECT/INSERT/UPDATE/DELETE policy = silent allow-all to authenticated role on permissive configs, or silent deny-all on default = drift either way) is unverified. We anchor the score at 7.5 instead of 8.5 on the assumption that production *probably* has correct policies, while leaving 1.0 of headroom for the audit-uncertainty.

### Immediate actions required (this week)
1. **Verify and version-control RLS policies** for every public table (`pg_policies` dump → `migrations/0001_rls.sql`). Source: `authorization-implementation.md` A-1, `business-logic-vulnerabilities.md` F-01, `authentication-flow.md` F-3.
2. **Add HTTP security headers** (`next.config.ts` → CSP, HSTS, X-Frame-Options, etc.). Source: `api-and-infrastructure.md` F1.
3. **Make `SUPABASE_SERVICE_ROLE_KEY` mandatory in `DELETE /api/account/delete` and run deletion as an atomic RPC** (eliminates half-deleted-account state + removes service-role from the web tier). Source: `api-and-infrastructure.md` F3, `business-logic-vulnerabilities.md` F-07, `authorization-implementation.md` A-5.
4. **Move Supabase auth to HttpOnly cookies via `@supabase/ssr`** (currently in `localStorage`) and add `frontend/middleware.ts` to gate `/account`, `/portfolio`. Source: `authentication-flow.md` F-1, F-2, F-7.
5. **Confirm captcha + leaked-password protection + redirect-URL allowlist** in the Supabase dashboard. Source: `authentication-flow.md` F-5, F-11, F-12, `api-and-infrastructure.md` F11.

---

## Critical Vulnerabilities (Fix Immediately)

### C-1. Authorization is entirely RLS-based, and RLS DDL for user-owned tables is **not in the repository**
- **Severity:** **Critical (conditional)** — Critical if live RLS is misconfigured; otherwise High supply-chain/operational risk.
- **CWE-862 / CWE-285 / CWE-732 / CWE-1390**
- **Evidence:**
  - `schema.sql:4-86` defines `portfolios`, `portfolio_holdings`, `portfolio_lots`, `profiles`, `exchange_rates`, `product_price_history`, `products`, `sets`, `generations`, `product_types` — **none** are followed by `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY`.
  - Only `migrations/create_box_recipes.sql:22-48` ships RLS DDL (for one table — `box_recipes`).
  - Public anon-key client (`frontend/app/lib/supabase.ts:1-12`) is the data-plane for the entire app (e.g. `frontend/app/lib/portfolio.ts:21-413`, `frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts:42-194`).
  - MCP `list_tables` reports `rls_enabled=true` for the live project, but the policy content is **Unable to verify** (see appendix).
- **Why-it-matters:** A single migration replay, branch DB, or supabase-cli `db reset` against this repo produces a DB where **the anon key has read+write on every table**. Even ignoring that, code reviewers cannot reason about authorization from source.
- **Minimal PoC** (run against any DB provisioned only from this repo):
  ```bash
  curl -sX PATCH "$SUPABASE_URL/rest/v1/portfolio_holdings?id=eq.42" \
    -H "apikey: $NEXT_PUBLIC_SUPABASE_KEY" \
    -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d '{"purchase_price_usd": 0.01, "quantity": 1}'
  ```
- **Remediation:** Ship a migration that enables RLS + owner-scoped policies for every user-owned table and explicit SELECT-only policies for public reference tables. Full snippet under **Code Examples → §RLS**.
- **Defense in depth:** Add a CI test that fails when `pg_policies` returns zero rows for any table referenced by the frontend; regenerate `schema.sql` via `supabase db dump` so the declarative copy matches reality.
- **Cross-refs:** `authorization-implementation.md#a-1`, `business-logic-vulnerabilities.md#f-01`, `authentication-flow.md#f-3`.

---

## High Priority Issues (Fix within 1 week)

### H-1. Supabase session stored in browser `localStorage` (XSS → permanent account takeover)
- **CWE-922 / CWE-1004**
- **Evidence:** `frontend/app/lib/supabase.ts:12` uses `@supabase/supabase-js` `createClient(...)` with no `auth.storage`/`flowType`/cookie options → default `window.localStorage`. `frontend/app/context/AuthContext.tsx:72,82,93` confirms client-side `getSession/getUser` is the only auth source for the SPA.
- **Why-it-matters:** Any XSS yields the refresh token, which Supabase will rotate forever for the attacker.
- **Remediation:** Switch to `@supabase/ssr` `createBrowserClient` + `createServerClient` (HttpOnly cookies). Snippet under **Code Examples → §SSR auth**.
- **Cross-refs:** `authentication-flow.md#f-1`.

### H-2. No `middleware.ts` — protected routes (`/account`, `/portfolio`) are guarded client-side only
- **CWE-862 / CWE-602**
- **Evidence:** `find frontend -name "middleware.*"` returns nothing. `frontend/app/account/page.tsx:36-40` is a `useEffect` redirect; the page renders and fetches before that runs.
- **Remediation:** Add `frontend/middleware.ts` that calls `supabase.auth.getUser()` on every request to `/account/**`, `/portfolio/**`. Snippet under **Code Examples → §Middleware**.
- **Cross-refs:** `authentication-flow.md#f-2`.

### H-3. Missing HTTP security headers across the entire application
- **CWE-693 / CWE-1021**
- **Evidence:** `frontend/next.config.ts:1-26` has no `async headers()`; grep finds no CSP / HSTS / X-Frame-Options / Permissions-Policy anywhere. `poweredByHeader` is not disabled.
- **Why-it-matters:** Clickjacking the `/account` delete button is trivial; an injected `<script>` exfiltrates the `localStorage` session (H-1 amplifier).
- **Remediation:** See **Code Examples → §HTTP headers**.
- **Cross-refs:** `api-and-infrastructure.md#f1`.

### H-4. Service-role key handled in a Next.js request handler co-located with anon-key code
- **CWE-522 / CWE-732 / CWE-250**
- **Evidence:** `frontend/app/api/account/delete/route.ts:55-68` instantiates an admin client from `SUPABASE_SERVICE_ROLE_KEY`. Co-located with anon paths; one accidental `NEXT_PUBLIC_` rename ships full DB superuser to the browser.
- **Remediation:** Move to a Postgres `SECURITY DEFINER` RPC (`delete_my_account`) invoked with the user's JWT. Snippet under **Code Examples → §Account delete RPC**.
- **Cross-refs:** `api-and-infrastructure.md#f3`, `authorization-implementation.md#a-5`.

### H-5. No application-layer rate limiting; no app-side captcha enforcement
- **CWE-770 / CWE-307 / CWE-799**
- **Evidence:** No `middleware.ts`, no `vercel.json`, no Upstash/`@vercel/kv` limiter (`grep -r "ratelimit\|rate.*limit" frontend` empty). `frontend/app/api/account/delete/route.ts:6-93` and `frontend/app/auth/callback/route.ts:5-44` are unthrottled. Turnstile (`auth/login/page.tsx:103-106`, `auth/signup/page.tsx:178-181`) is only honoured if the Supabase project has captcha enforcement enabled — **Unable to verify**.
- **Remediation:** Add Upstash Ratelimit (snippet under **§Rate limiting**) + verify Supabase Auth → Captcha protection.
- **Cross-refs:** `api-and-infrastructure.md#f2`, `authentication-flow.md#f-13`.

### H-6. CSRF / Origin protection absent on `DELETE /api/account/delete`
- **CWE-352**
- **Evidence:** `frontend/app/api/account/delete/route.ts:6` accepts `DELETE` with no `Origin`/`Referer`/custom-header check. Today mitigated by Supabase cookies defaulting to `SameSite=Lax`, but that's an implicit dependency.
- **Remediation:** Reject requests lacking a custom `x-pokefin-request: 1` header, and add an `Origin` allowlist. Snippet under **§CSRF**.
- **Cross-refs:** `api-and-infrastructure.md#f4`, `authentication-flow.md#f-9`, `authorization-implementation.md#a-8`.

### H-7. Account deletion is non-atomic and silently partial when service-role key is missing
- **CWE-460 / CWE-665 / CWE-672 / CWE-459**
- **Evidence:** `frontend/app/api/account/delete/route.ts:40-92` deletes the `profiles` row first, then conditionally deletes `auth.users` only if `SUPABASE_SERVICE_ROLE_KEY` is set. `portfolios`/`portfolio_holdings`/`box_recipes` are never deleted; their `REFERENCES auth.users(id)` constraints lack `ON DELETE CASCADE` (`schema.sql:46-48`, `migrations/create_box_recipes.sql:14-16`).
- **Why-it-matters:** "Delete account" can succeed-with-200 while leaving the auth row + holdings intact (GDPR/data-rights violation), or fail mid-way leaving a half-deleted state.
- **Remediation:** 503 when key missing, perform deletion atomically inside one RPC, add `ON DELETE CASCADE`. Snippets under **§Account delete RPC** and **§Cascading FKs**.
- **Cross-refs:** `business-logic-vulnerabilities.md#f-07`, `authorization-implementation.md#a-5`.

---

## Medium Priority Issues (Fix within 1 month)

### M-1. IDOR-by-default in portfolio helpers (`getHoldingById`, `updateHolding`, `deleteHolding`, `updatePortfolioName`, `getPortfolioById`)
- **CWE-639**
- **Evidence:** `frontend/app/lib/portfolio.ts:59-72,77-94,128-148,178-195,200-211` filter by primary key only — no `.eq("user_id", ...)`. Today: mitigated by RLS. Tomorrow (single RLS regression): trivial enumeration of every user's data.
- **Remediation:** Always include the `user_id` filter (defense-in-depth). Snippet under **§IDOR**. `useBoxRecipes.ts:91,156` already follows this pattern.
- **Cross-refs:** `authorization-implementation.md#a-2`.

### M-2. Recovery flow uses implicit-flow hash tokens
- **CWE-598 / CWE-1275**
- **Evidence:** `frontend/app/auth/reset-password/page.tsx:36-53` parses `access_token` from `window.location.hash` and calls `supabase.auth.setSession`. Modern Supabase recommends PKCE flow through `/auth/callback?code=…`, already partially implemented in `frontend/app/auth/callback/route.ts:38-41`.
- **Remediation:** Switch Supabase to PKCE recovery emails; drop the implicit branch.
- **Cross-refs:** `authentication-flow.md#f-4`.

### M-3. `redirectTo` in password-reset built from `window.location.origin`
- **CWE-601**
- **Evidence:** `frontend/app/context/AuthContext.tsx:178-180` `redirectTo: \`${window.location.origin}/auth/reset-password\``. If a phishing mirror at `evil.tld/forgot-password` calls `resetPasswordForEmail`, the link in the victim's email could redirect to `evil.tld` (allowlist permitting).
- **Remediation:** Hardcode origin allowlist; tighten Supabase dashboard "Redirect URLs" to the production domain only.
- **Cross-refs:** `authentication-flow.md#f-5`.

### M-4. Server route doesn't pipe Supabase cookies into the response
- **CWE-613 / CWE-384-adjacent**
- **Evidence:** `frontend/app/auth/callback/route.ts:14-43` and `frontend/app/api/account/delete/route.ts:7-92` use `cookieStore.set(...)` inside `setAll`. In a Route Handler this writes to the *next* request's cookies, not the current response — so refreshed tokens may not reach the browser.
- **Remediation:** Mutate `response.cookies` instead. Snippet under **§Server cookies**.
- **Cross-refs:** `authentication-flow.md#f-7`.

### M-5. Verbose Supabase error logging in API routes
- **CWE-209 / CWE-532**
- **Evidence:** `frontend/app/api/account/delete/route.ts:47,75,84` log full `PostgrestError`/`AuthError` objects (includes `details`/`hint`/raw SQL fragments). `frontend/app/context/AuthContext.tsx:54,60,152` log to browser console.
- **Remediation:** Serialize to `{ message, code }` only; add `frontend/app/error.tsx` + `global-error.tsx`. Snippet under **§Logging**.
- **Cross-refs:** `api-and-infrastructure.md#f6`, `authentication-flow.md#f-8`.

### M-6. No idempotency on `addHolding` / `importHoldings`
- **CWE-367 / CWE-362**
- **Evidence:** `frontend/app/lib/portfolio.ts:153-173`, `frontend/app/lib/import.ts:414-459`. Double-click or 5xx-retry on a 200-row import yields 400 rows.
- **Remediation:** Add `client_idempotency_key uuid` + unique index, single-flight the submit button with `useTransition`. Snippet under **§Idempotency**.
- **Cross-refs:** `business-logic-vulnerabilities.md#f-04`.

### M-7. Numeric / cost-basis validation is client-only; aggregate can reach `Infinity`
- **CWE-602 / CWE-190 / CWE-1339**
- **Evidence:** `frontend/app/components/Portfolio/cards/AddHoldingModal.tsx:57-67`, `EditHoldingModal.tsx:44-67`, `frontend/app/lib/import.ts:137-140`. DB constraints (`schema.sql:19-20`) allow `quantity` up to `int4 max` and any non-negative `double precision`.
- **Remediation:** Mirror form validation in DB CHECK constraints (`quantity BETWEEN 1 AND 100000`, `purchase_price_usd BETWEEN 0 AND 1_000_000`). Snippet under **§Numeric bounds**.
- **Cross-refs:** `business-logic-vulnerabilities.md#f-05`.

### M-8. `box_recipes` "shared" RLS policy allows enumeration of every shared recipe (no code required)
- **CWE-200**
- **Evidence:** `migrations/create_box_recipes.sql:26-28`: `USING (share_code IS NOT NULL)`. Combined with sequential `id`, anyone can `GET /rest/v1/box_recipes?share_code=not.is.null` to list all shared recipes + their `user_id`.
- **Remediation:** Replace with a `SECURITY DEFINER` RPC `get_shared_recipe(share_code)` that requires the actual code. Snippet under **§Share code**.
- **Cross-refs:** `authorization-implementation.md#a-4`.

### M-9. `share_code` generated with `Math.random()` (not CSPRNG); recipes are public on every save
- **CWE-330 / CWE-340**
- **Evidence:** `frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts:8-15,77`. 8 chars over a 54-char alphabet; `Math.random()`.
- **Remediation:** `crypto.getRandomValues`, 32 hex chars, and only generate when user explicitly clicks "Make shareable" (add `is_public boolean`).
- **Cross-refs:** `business-logic-vulnerabilities.md#f-06`.

### M-10. Profile created from the browser (client picks `id` + `email`) — mass-assignment surface
- **CWE-915**
- **Evidence:** `frontend/app/context/AuthContext.tsx:145-150` `insert({ id: data.user.id, username, email })` with the anon key. With proper RLS this fails (no session yet), proving today's success means RLS is permissive or missing.
- **Remediation:** Postgres trigger on `auth.users` (`handle_new_user`). Snippet under **§Profile trigger**.
- **Cross-refs:** `authentication-flow.md#f-14`, `authorization-implementation.md#a-3`.

### M-11. No request size / body parser limit on the Next.js API route; Python image upload has no size cap
- **CWE-770 / CWE-400**
- **Evidence:** `frontend/app/api/account/delete/route.ts` declares no `runtime`/`maxDuration`/body limit; `main.py:236-326` `download_and_upload_image` only rejects bodies < 1000 bytes (`main.py:264`) — no upper bound.
- **Remediation:** Clamp `request.text()` length, stream-cap downloads to 5 MB.
- **Cross-refs:** `api-and-infrastructure.md#f5`.

---

## Low Priority Issues (Fix in next release)

| # | Title | Source | CWE |
|---|---|---|---|
| L-1 | `next` redirect allowlist accepts backslash + URL-encoded slash | `auth/callback/route.ts:11-12` (`api-and-infrastructure.md` indirect; `authorization-implementation.md#a-7`, `authentication-flow.md#f-6`) | 601 |
| L-2 | 8-char minimum password; no leaked-password check; no 72-byte cap warning | `auth/signup/page.tsx:63-66`, `auth/reset-password/page.tsx:89-92`, `account/page.tsx:90-93` (`authentication-flow.md#f-11`) | 521 |
| L-3 | Captcha token unverified app-side (depends on Supabase project setting); forgot-password page has no captcha at all | `auth/forgot-password/page.tsx` (`authentication-flow.md#f-12`, `api-and-infrastructure.md#f11`) | 799 |
| L-4 | Sign-up page leaks account existence (different banner for already-registered email) | `auth/signup/page.tsx:81-105` (`authentication-flow.md#f-16`) | 204 |
| L-5 | Reset-password does not invalidate other sessions | `auth/reset-password/page.tsx:96-98`, `account/page.tsx:97` (`authentication-flow.md#f-17`) | 613 |
| L-6 | `serverSupabase.ts` exports an unused server client (dead code) | `frontend/app/lib/serverSupabase.ts:14-24` (`authentication-flow.md#f-15`) | n/a |
| L-7 | `exchange_rates` has no sanity-range CHECK (`0.5 < usd_to_cad < 5.0`) | `schema.sql:4-9` (`business-logic-vulnerabilities.md#f-02`) | 345 |
| L-8 | `product_price_history` lacks unique `(product_id, recorded_at::date)` index → scraper TOCTOU duplicates | `main.py:670-715`, `backfill_historical_prices.py:471-532` (`business-logic-vulnerabilities.md#f-11`) | 694 |
| L-9 | `getOrCreatePortfolio` TOCTOU; missing `UNIQUE(user_id)` on `portfolios` | `frontend/app/lib/portfolio.ts:21-54` (`business-logic-vulnerabilities.md#f-09`) | 367 |
| L-10 | `purchase_date` future-dated / timezone-naive (UTC vs local-day) | `AddHoldingModal.tsx:178`, `EditHoldingModal.tsx:178`, `portfolio.ts:289-301` (`business-logic-vulnerabilities.md#f-10`) | 20 / 754 |
| L-11 | `searchProducts` LIKE-wildcard injection (`%` / `_` not escaped) | `frontend/app/lib/portfolio.ts:394-413` (`business-logic-vulnerabilities.md#f-12`) | 117 |
| L-12 | Import `matchProduct` picks `candidates[0]` on `low`-confidence ambiguity | `frontend/app/lib/import.ts:289-379` (`business-logic-vulnerabilities.md#f-08`) | 863 / 754 |
| L-13 | Hard-coded Supabase project hostname (`tyrhvavwvphazpmwluft.supabase.co`) in `next.config.ts:16` | `api-and-infrastructure.md#f7` | 540 |
| L-14 | Python scrapers store credentials in `secretsFile.py` instead of environment | `main.py:22`, `compare_prices.py:27` (`api-and-infrastructure.md#f12`, `authorization-implementation.md#a-10`) | 256 / 522 |
| L-15 | Field-level over-fetching: `notes` always returned in `getHoldings` | `frontend/app/lib/portfolio.ts:103-123` (`authorization-implementation.md#a-6`) | 213 |
| L-16 | No CORS configuration; future risk of permissive `*` | (`api-and-infrastructure.md#f10`) | 942 |
| L-17 | No API versioning | (`api-and-infrastructure.md#f8`) | n/a |
| L-18 | `schema.sql` out of sync with live DB (missing `products.active`, missing RLS) | `schema.sql:1, 63-77` (`authorization-implementation.md#a-9`) | n/a |
| L-19 | Username updates client-side only, no server-side allowlist of writable columns | `frontend/app/account/page.tsx:61-64` (`authentication-flow.md#f-10`) | 20 / 915 |

---

## Security Recommendations

### 1. Implementation priorities
1. **Make Postgres authoritative for AuthZ.** Check policy DDL into `migrations/`, gate every reference table with explicit `FOR SELECT TO anon, authenticated USING (true)` policies, gate every user-owned table with `auth.uid()`-bound `WITH CHECK` policies. Treat the deployed DB as drift-prone.
2. **Push privileged ops out of the web tier.** Replace the service-role admin client in `/api/account/delete` with a `SECURITY DEFINER` RPC; the Vercel function then only forwards the user's JWT.
3. **Switch the SDK to cookie-based sessions.** `@supabase/ssr` `createBrowserClient` + `createServerClient` + `middleware.ts`. Eliminates the XSS → token-theft chain.
4. **Add security headers + global rate limiter via `middleware.ts`.** One file, double duty.
5. **Backfill DB constraints** (`CHECK` on prices, rates, dates; `UNIQUE` indexes for idempotency; `ON DELETE CASCADE`).

### 2. Security tools to adopt
- **`@upstash/ratelimit` + Upstash Redis** (free tier) or **Cloudflare WAF rules** in front of `/api/*` and `/auth/*`.
- **`supabase db dump` in CI** to keep `schema.sql` honest + `pg_policies` snapshot test.
- **`zxcvbn` or HIBP k-anonymity API** for client+server password strength.
- **GitHub Actions: `trufflehog`** to scan PRs (currently `secretsFile.py` is `.gitignore`'d but conventions drift).
- **Supabase Advisor (`mcp__…__get_advisors`)** — run as a scheduled job; treat advisor warnings as build-blocking.
- **`zod`** for `route.ts` body validation.
- **Sentry** with PII scrubbing (drop `details`/`hint` Supabase fields).

### 3. Process improvements
- **CI gate on `select count(*) from pg_policies where schemaname='public'`** ≥ N for each tagged release.
- **Pre-commit hook** that blocks files matching `process.env.SUPABASE_SERVICE_ROLE_KEY` outside `app/api/**` (or, post-remediation, outside SQL migrations only).
- **Threat-model review** at every new `route.ts` PR (use this report as the checklist).
- **Quarterly key rotation** for `SUPABASE_SERVICE_ROLE_KEY` and Turnstile secret.

### 4. Training needs
- OWASP API Security Top 10 (esp. API1:2023 BOLA, API3:2023 BOPLA, API8:2023 Security Misconfiguration).
- Supabase-specific: RLS authoring, `SECURITY DEFINER` pitfalls, PostgREST query semantics (`is`, `eq`, `not.is`, wildcard LIKE).
- Next.js App Router SSR auth + cookies model (the `cookieStore.set` vs `response.cookies.set` distinction in M-4).

---

## Compliance Checklist

### OWASP Top 10 (2021) Coverage

| # | Category | Status | Anchored finding(s) |
|---|---|---|---|
| A01 | Broken Access Control | **Fail** | C-1, M-1, M-8 |
| A02 | Cryptographic Failures | **Partial Fail** | H-1 (localStorage tokens), M-9 (non-CSPRNG share_code) |
| A03 | Injection | **Pass (with caveats)** | All DB calls parameterized via PostgREST. L-11 (LIKE wildcard) is the only injection-adjacent issue. |
| A04 | Insecure Design | **Fail** | H-4 (service-role in web tier), H-7 (non-atomic delete), C-1 (RLS not version-controlled) |
| A05 | Security Misconfiguration | **Fail** | H-3 (no headers), H-5 (no rate limit), L-13, L-16, L-18 |
| A06 | Vulnerable & Outdated Components | **Pass-ish** | `@supabase/supabase-js ^2.50.0`, `@supabase/ssr ^0.8.0` are current. No `jsonwebtoken`/`bcrypt`/`md5` in app code. |
| A07 | Identification & Authentication Failures | **Partial Fail** | L-2 (weak password policy), L-3 (captcha unverified), L-4 (enum), L-5 (no other-session revoke), M-2, M-3 |
| A08 | Software & Data Integrity Failures | **Fail** | M-6 (no idempotency), L-8 (no day-unique index), L-9 (no `UNIQUE(user_id)`) |
| A09 | Security Logging & Monitoring Failures | **Fail** | M-5 (verbose error logs); no SIEM forward; no auth-event audit log |
| A10 | Server-Side Request Forgery | **Pass** | No user-controlled outbound URLs in the Next.js layer. Python scrapers fetch a fixed allowlist (TCGPlayer, BoC, Shopify). |

### OWASP API Security Top 10 (2023) — abbreviated

| # | Category | Status |
|---|---|---|
| API1 BOLA | **Fail** (C-1, M-1, M-8) |
| API2 Broken Authentication | **Partial Fail** (H-1, H-2) |
| API3 BOPLA | **Fail** (M-10, M-7, L-19) |
| API4 Unrestricted Resource Consumption | **Fail** (H-5, M-11) |
| API5 BFLA | **N/A** (no roles) |
| API6 Unrestricted Access to Sensitive Business Flows | **Partial Fail** (M-6, account-delete spam) |
| API7 SSRF | **N/A** |
| API8 Security Misconfiguration | **Fail** (H-3, L-13, L-16, L-18) |
| API9 Improper Inventory Management | **Partial Fail** (L-17, L-18 — schema drift) |
| API10 Unsafe Consumption of 3rd-party APIs | **Partial Fail** (Python scrapers trust TCGPlayer/BoC/Shopify responses, no size caps — M-11) |

### PCI DSS — **Not Applicable**
Pokefin does not process, transmit, or store card data. There is no `payments`, `cards`, `pan`, `cvv`, or Stripe/PayPal/Square integration anywhere in `frontend/app/**` or in any Python script. Currency math involves only USD↔CAD display conversion via `exchange_rates`. PCI DSS does not apply.

If a payment integration is added later, the relevant minimum is **SAQ-A** (full redirect/iframe to a PCI-DSS Level 1 PSP like Stripe Checkout). At that point: F-01 (RLS) and H-3 (CSP `frame-ancestors`) become PCI-mandatory.

### GDPR (applies — stores email + portfolio holdings)
The app stores `auth.users.email`, `profiles.email`, `profiles.username`, `portfolio_holdings.notes` (free-form), `portfolio_holdings.purchase_price_usd`, `purchase_date` — all personal data of an identifiable natural person. Pokefin is therefore a data controller for EU/UK users.

| GDPR Article | Requirement | Status |
|---|---|---|
| Art. 5(1)(f) Integrity & confidentiality | RLS protects per-user data | **Fail** (C-1 unverified policy content) |
| Art. 17 Right to erasure | Delete account in a "reasonable" time | **Partial Fail** (H-7 — partial delete leaves auth user + holdings if service role missing) |
| Art. 15 Right of access / Art. 20 Portability | Export of user data | **Fail** (no export endpoint; user must scrape `/portfolio` manually) |
| Art. 25 Data protection by design | Default security settings | **Fail** (H-1 tokens in `localStorage`, H-3 no headers) |
| Art. 32 Security of processing | Appropriate technical measures | **Fail** (H-5 no rate limit, M-5 PII in logs) |
| Art. 33 Breach notification | Process to detect breaches | **Fail** (no audit log of auth events) |
| Art. 13/14 Information to data subjects | Privacy notice | **Unable to verify** (no `/privacy` page in `frontend/app/**`) |

Action: implement an "Export my data" route alongside delete; introduce an audit-log table written by Postgres triggers; publish a privacy policy page.

### SOC 2 Trust Service Criteria — Type II readiness

| TSC | Criterion | Status |
|---|---|---|
| **CC6.1** Logical access controls | RLS + JWT | **Partial Fail** (C-1) |
| **CC6.2** Account provisioning / deprovisioning | Account delete must remove all PII atomically | **Fail** (H-7) |
| **CC6.6** Encryption in transit | HTTPS-only on Vercel | **Pass** (HSTS is **Unable to verify** until H-3 fixed) |
| **CC6.7** Restriction of session credentials | HttpOnly cookies | **Fail** (H-1) |
| **CC6.8** Anti-malware / config integrity | Dependency scanning, secret scanning | **Partial** (no automated SCA visible) |
| **CC7.1** Detection of vulnerabilities / config changes | Supabase Advisor + CI | **Fail** (no scheduled advisor run) |
| **CC7.2** Logging & monitoring | Centralized auth/audit log | **Fail** (M-5; no audit table) |
| **CC7.3** Incident response | Runbook | **Unable to verify** |
| **CC8.1** Change management | Migrations versioned in git | **Partial Fail** (L-18 — schema drift; only 2 migration files for a 12-table DB) |
| **A1.2** Availability — capacity & rate limits | **Fail** (H-5) |
| **C1.2** Confidentiality — disposal of data | Account delete | **Fail** (H-7) |
| **P1–P6** Privacy | Privacy notice / consent / access | **Fail** (no `/privacy`, no export endpoint) |

---

## Final Consolidated Risk Score: **7.5 / 10**

| Sub-report | Score | Weight | Weighted |
|---|---|---|---|
| API & Infrastructure | 6.5 | 0.20 | 1.30 |
| Authentication | 7.0 | 0.25 | 1.75 |
| Authorization | 6.5 | 0.25 | 1.625 |
| Business Logic | 8.5 | 0.30 | 2.55 |
| **Total** | | | **~7.2** |

Rounded **up** to **7.5** because the authorization and business-logic findings *compound*: if even one user-data table is missing an `auth.uid()`-bound `WITH CHECK` policy, the anon key (publicly shipped in the bundle) becomes a write-everything credential. Net residual risk depends entirely on live `pg_policies` content, which is **Unable to verify** from source alone. After fixing C-1, H-1, H-2, H-3, H-4 the score should land near 4.0.

---

## Top 5 Cross-Cutting Prioritized Fixes (do these first)

1. **Ship `migrations/0001_enable_rls_and_policies.sql`** that enables RLS + policies on every public table; verify via `pg_policies`; add a CI assertion. *Closes C-1, F-02, F-03 simultaneously; reduces score by ~1.5 points alone.*
2. **Replace the admin-client branch in `/api/account/delete` with a `SECURITY DEFINER` RPC `delete_my_account()`**, and make the route return 503 if any step fails. Add `ON DELETE CASCADE` to `auth.users → portfolios → portfolio_holdings → portfolio_lots → box_recipes → profiles`. *Closes H-4, H-7.*
3. **Move sessions to HttpOnly cookies via `@supabase/ssr` + add `frontend/middleware.ts`** that gates `/account`, `/portfolio`, rate-limits `/api/*` and `/auth/*`, and writes refreshed cookies through to the response. *Closes H-1, H-2, H-5, M-4.*
4. **Add `next.config.ts` `async headers()` with CSP/HSTS/X-Frame-Options/Permissions-Policy and `poweredByHeader: false`.** Add `Origin` + `x-pokefin-request` checks to `DELETE /api/account/delete`. *Closes H-3, H-6.*
5. **Add DB-level integrity constraints** in one migration: `UNIQUE(user_id)` on `portfolios`; `(product_id, recorded_at::date)` unique on `product_price_history`; `CHECK` on `quantity`, `purchase_price_usd`, `purchase_date`, `usd_to_cad`; `client_idempotency_key` column. *Closes M-6, M-7, L-7, L-8, L-9, L-10.*

---

## Code Examples (drop-in snippets)

### §RLS — `migrations/0001_enable_rls_and_policies.sql`
```sql
-- User-owned tables
ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_holdings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_lots      ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_self ON public.profiles
  FOR ALL TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY portfolios_self ON public.portfolios
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY holdings_self ON public.portfolio_holdings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.portfolios p
                 WHERE p.id = portfolio_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.portfolios p
                      WHERE p.id = portfolio_id AND p.user_id = auth.uid()));

CREATE POLICY lots_self ON public.portfolio_lots
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.portfolio_holdings h
                 JOIN public.portfolios p ON p.id = h.portfolio_id
                 WHERE h.id = holding_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.portfolio_holdings h
                      JOIN public.portfolios p ON p.id = h.portfolio_id
                      WHERE h.id = holding_id AND p.user_id = auth.uid()));

-- Public reference data: explicit anon+authenticated SELECT, no writes
ALTER TABLE public.products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sets                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_types         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates        ENABLE ROW LEVEL SECURITY;

CREATE POLICY products_read              ON public.products              FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY product_price_history_read ON public.product_price_history FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY sets_read                  ON public.sets                  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY generations_read           ON public.generations           FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY product_types_read         ON public.product_types         FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY exchange_rates_read        ON public.exchange_rates        FOR SELECT TO anon, authenticated USING (true);
-- (omit INSERT/UPDATE/DELETE policies => only service_role can write)
```

### §SSR auth — `frontend/app/lib/supabase.ts`
```ts
import { createBrowserClient } from "@supabase/ssr";
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!,
  { auth: { flowType: "pkce" } }
);
```

### §Middleware — `frontend/middleware.ts`
```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const limiter = new Ratelimit({ redis: Redis.fromEnv(), limiter: Ratelimit.fixedWindow(60, "1 m") });
const PROTECTED = [/^\/account/, /^\/portfolio/];

export async function middleware(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
  if (req.nextUrl.pathname.startsWith("/api/") || req.nextUrl.pathname.startsWith("/auth/")) {
    const { success } = await limiter.limit(`ip:${ip}`);
    if (!success) return new NextResponse("Too Many Requests", { status: 429 });
  }
  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (c) => c.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && PROTECTED.some((r) => r.test(req.nextUrl.pathname))) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return res;
}
export const config = { matcher: ["/account/:path*", "/portfolio/:path*", "/api/:path*", "/auth/:path*"] };
```

### §HTTP headers — `frontend/next.config.ts`
```ts
import type { NextConfig } from "next";

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tcgplayer.com https://tcgplayer.com https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy",    value: csp },
  { key: "X-Frame-Options",            value: "DENY" },
  { key: "X-Content-Type-Options",     value: "nosniff" },
  { key: "Referrer-Policy",            value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security",  value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy",         value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: { remotePatterns: [
    { protocol: "https", hostname: "**.tcgplayer.com" },
    { protocol: "https", hostname: "tcgplayer.com" },
    { protocol: "https", hostname: "**.supabase.co" },
  ]},
  async headers() { return [{ source: "/:path*", headers: securityHeaders }]; },
};
export default nextConfig;
```

### §Account delete RPC — replaces `frontend/app/api/account/delete/route.ts:40-92`
```sql
-- migrations/0002_delete_my_account.sql
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  DELETE FROM public.portfolio_lots
   WHERE holding_id IN (SELECT h.id FROM public.portfolio_holdings h
                        JOIN public.portfolios p ON p.id = h.portfolio_id
                        WHERE p.user_id = auth.uid());
  DELETE FROM public.portfolio_holdings
   WHERE portfolio_id IN (SELECT id FROM public.portfolios WHERE user_id = auth.uid());
  DELETE FROM public.portfolios   WHERE user_id = auth.uid();
  DELETE FROM public.box_recipes  WHERE user_id = auth.uid();
  DELETE FROM public.profiles     WHERE id = auth.uid();
  DELETE FROM auth.users          WHERE id = auth.uid();
END $$;
REVOKE ALL    ON FUNCTION public.delete_my_account() FROM public;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
```
```ts
// frontend/app/api/account/delete/route.ts (replace lines 40-92)
const ALLOWED_ORIGINS = new Set(["https://pokefin.ca", "https://www.pokefin.ca"]);
const origin = request.headers.get("origin");
if (!origin || !ALLOWED_ORIGINS.has(origin)) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
if (request.headers.get("x-pokefin-request") !== "1") {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
const { error } = await supabase.rpc("delete_my_account");
if (error) {
  console.error("delete_my_account_failed", { code: error.code });
  return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
}
await supabase.auth.signOut();
return NextResponse.json({ success: true });
```

### §Cascading FKs
```sql
ALTER TABLE public.portfolios
  DROP CONSTRAINT portfolios_user_id_fkey,
  ADD  CONSTRAINT portfolios_user_id_fkey FOREIGN KEY (user_id)
       REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.portfolio_holdings
  DROP CONSTRAINT portfolio_holdings_portfolio_id_fkey,
  ADD  CONSTRAINT portfolio_holdings_portfolio_id_fkey FOREIGN KEY (portfolio_id)
       REFERENCES public.portfolios(id) ON DELETE CASCADE;
ALTER TABLE public.box_recipes
  DROP CONSTRAINT box_recipes_user_id_fkey,
  ADD  CONSTRAINT box_recipes_user_id_fkey FOREIGN KEY (user_id)
       REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_fkey,
  ADD  CONSTRAINT profiles_id_fkey FOREIGN KEY (id)
       REFERENCES auth.users(id) ON DELETE CASCADE;
```

### §Rate limiting — `frontend/app/lib/rateLimit.ts`
```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
export const accountDeleteLimiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.fixedWindow(3, "1 h"),
  prefix: "rl:acct-del",
});
```
```ts
// inside DELETE /api/account/delete handler
const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
const { success } = await accountDeleteLimiter.limit(`${user.id}:${ip}`);
if (!success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
```

### §CSRF
```ts
if (request.headers.get("x-pokefin-request") !== "1") {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
const origin = request.headers.get("origin");
const ALLOWED = new Set(["https://pokefin.ca", "https://www.pokefin.ca"]);
if (!origin || !ALLOWED.has(origin)) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

### §IDOR (defense-in-depth in `frontend/app/lib/portfolio.ts`)
```ts
export async function deleteHolding(holdingId: number, userId: string): Promise<boolean> {
  const { data: owned } = await supabase
    .from("portfolio_holdings")
    .select("id, portfolios!inner(user_id)")
    .eq("id", holdingId)
    .eq("portfolios.user_id", userId)
    .maybeSingle();
  if (!owned) return false;
  const { error } = await supabase.from("portfolio_holdings").delete().eq("id", holdingId);
  return !error;
}
```

### §Server cookies — `frontend/app/auth/callback/route.ts`
```ts
const response = NextResponse.redirect(new URL(safeNext, request.url));
const supabase = createServerClient(URL, KEY, {
  cookies: {
    getAll: () => request.cookies.getAll(),
    setAll: (toSet) => toSet.forEach(({ name, value, options }) =>
      response.cookies.set(name, value, options)),
  },
});
await supabase.auth.exchangeCodeForSession(code);
return response;
```

### §Logging
```ts
function logSupabaseError(label: string, err: { message?: string; code?: string }) {
  console.error(label, { message: err?.message, code: err?.code });
}
```
```tsx
// frontend/app/error.tsx
"use client";
export default function GlobalError() {
  return <div className="p-8">Something went wrong. Please refresh.</div>;
}
```

### §Idempotency
```sql
ALTER TABLE public.portfolio_holdings ADD COLUMN client_idempotency_key uuid;
CREATE UNIQUE INDEX portfolio_holdings_idem_uidx
  ON public.portfolio_holdings (portfolio_id, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;
```
```ts
// frontend/app/lib/portfolio.ts addHolding
.insert({ ..., client_idempotency_key: crypto.randomUUID() })
```

### §Numeric bounds + date constraint
```sql
ALTER TABLE public.portfolio_holdings
  ADD CONSTRAINT portfolio_holdings_quantity_sane   CHECK (quantity BETWEEN 1 AND 100000),
  ADD CONSTRAINT portfolio_holdings_price_sane      CHECK (purchase_price_usd BETWEEN 0 AND 1000000),
  ADD CONSTRAINT portfolio_holdings_date_not_future CHECK (purchase_date <= current_date);

ALTER TABLE public.exchange_rates
  ADD CONSTRAINT exchange_rates_usd_to_cad_sane CHECK (usd_to_cad > 0.5 AND usd_to_cad < 5.0);

CREATE UNIQUE INDEX portfolios_user_id_uidx ON public.portfolios (user_id);
CREATE UNIQUE INDEX product_price_history_product_day_uidx
  ON public.product_price_history (product_id, (recorded_at::date));
```

### §Share code
```sql
DROP POLICY "Shared recipes are viewable by everyone" ON public.box_recipes;
ALTER TABLE public.box_recipes ADD COLUMN is_public boolean NOT NULL DEFAULT false;
CREATE POLICY box_recipes_shared_read ON public.box_recipes FOR SELECT
  USING (is_public = true AND share_code IS NOT NULL);

CREATE OR REPLACE FUNCTION public.get_shared_recipe(p_share_code text)
RETURNS SETOF public.box_recipes LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT * FROM public.box_recipes
   WHERE share_code = p_share_code AND is_public = true LIMIT 1;
$$;
REVOKE ALL    ON FUNCTION public.get_shared_recipe(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_shared_recipe(text) TO anon, authenticated;
```
```ts
// frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts
function generateShareCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
```

### §Profile trigger
```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'username')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```
Then drop the client-side `.insert` in `frontend/app/context/AuthContext.tsx:145-150`.

### §Username constraint
```sql
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format
  CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_]{3,32}$');
```

### §LIKE wildcard escape
```ts
const safe = query.replace(/[%_\\]/g, "\\$&");
.ilike("variant", `%${safe}%`)
```

---

## Testing Guide

### T1. RLS — every public table has policies
```sql
-- run via Supabase SQL editor or `mcp__…__execute_sql`
SELECT tablename,
       rowsecurity                         AS rls_on,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname=t.schemaname AND p.tablename=t.tablename) AS policy_count
  FROM pg_tables t
 WHERE schemaname = 'public'
 ORDER BY tablename;
-- Expect: rls_on=t and policy_count>=1 for EVERY row.
```

### T2. PoC: anon-key write to user-owned table (must 401/403 after fix)
```bash
curl -sX PATCH "$SUPABASE_URL/rest/v1/portfolio_holdings?id=eq.1" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"purchase_price_usd": 0.01}'
# Expected after fix: HTTP 401/403 or 0 rows updated (PostgREST 200 + body=[]).
```

### T3. PoC: insert into reference table (must 401/403 after fix)
```bash
curl -sX POST "$SUPABASE_URL/rest/v1/exchange_rates" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"usd_to_cad": 0.001, "recorded_at": "2026-12-01T00:00:00"}'
# Expected: 401/403.
curl -sX POST "$SUPABASE_URL/rest/v1/product_price_history" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"product_id":1,"usd_price":0.01,"recorded_at":"2026-04-19T12:00:00"}'
# Expected: 401/403.
```

### T4. Middleware gate
```bash
curl -i https://pokefin.ca/account
# Expected after fix: 307 -> /auth/login?next=/account
```

### T5. HttpOnly cookies after login
```bash
curl -i -c cookies.txt -X POST https://pokefin.ca/auth/v1/token?grant_type=password \
  -d '{"email":"u@e.com","password":"…"}'
grep -i "set-cookie:.*HttpOnly.*Secure.*SameSite=Lax" cookies.txt
# Expected after fix: match present.
```

### T6. CSP and HSTS headers present
```bash
curl -sI https://pokefin.ca | grep -iE "content-security-policy|strict-transport-security|x-frame-options|x-content-type-options|referrer-policy|permissions-policy"
# Expected after fix: all six headers present.
```

### T7. Account-delete: CSRF / origin
```bash
curl -i -X DELETE https://pokefin.ca/api/account/delete \
  -H "Origin: https://evil.example" -H "Cookie: <victim-session>"
# Expected after fix: 403.

curl -i -X DELETE https://pokefin.ca/api/account/delete \
  -H "Origin: https://pokefin.ca" -H "Cookie: <victim-session>"
# Expected: 403 because x-pokefin-request header missing.

curl -i -X DELETE https://pokefin.ca/api/account/delete \
  -H "Origin: https://pokefin.ca" -H "x-pokefin-request: 1" -H "Cookie: <victim-session>"
# Expected: 200 OK + auth.users row gone + portfolios/holdings cascaded.
```

### T8. Account-delete atomicity — verify deletion cascaded
```sql
-- Run as service_role after T7
SELECT count(*) FROM auth.users           WHERE id = '<victim-uuid>'; -- 0
SELECT count(*) FROM public.profiles      WHERE id = '<victim-uuid>'; -- 0
SELECT count(*) FROM public.portfolios    WHERE user_id = '<victim-uuid>'; -- 0
SELECT count(*) FROM public.portfolio_holdings h
  JOIN public.portfolios p ON p.id = h.portfolio_id
 WHERE p.user_id = '<victim-uuid>'; -- 0
SELECT count(*) FROM public.box_recipes   WHERE user_id = '<victim-uuid>'; -- 0
```

### T9. Open redirect
```bash
curl -i "https://pokefin.ca/auth/callback?code=…&next=//evil.com"   # → /
curl -i "https://pokefin.ca/auth/callback?code=…&next=/\\evil.com"  # → /
```

### T10. Rate limit on /api/account/delete
```bash
for i in $(seq 1 5); do
  curl -s -o /dev/null -w "%{http_code}\n" -X DELETE https://pokefin.ca/api/account/delete \
    -H "Origin: https://pokefin.ca" -H "x-pokefin-request: 1" -H "Cookie: <session>"
done
# Expected: 4th or 5th request → 429
```

### T11. Numeric bounds rejected
```bash
# Should 400/409 after DB CHECK constraint
curl -sX POST "$SUPABASE_URL/rest/v1/portfolio_holdings" \
  -H "apikey: $ANON" -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"portfolio_id":1,"product_id":1,"quantity":2147483647,"purchase_price_usd":1e300,"purchase_date":"2099-01-01"}'
# Expected: 409 (CHECK violation) or 400.
```

### T12. Idempotency
```bash
KEY=$(uuidgen)
for i in 1 2; do
curl -sX POST "$SUPABASE_URL/rest/v1/portfolio_holdings" \
  -H "apikey: $ANON" -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d "{\"portfolio_id\":1,\"product_id\":1,\"quantity\":1,\"purchase_price_usd\":10,\"purchase_date\":\"2026-01-01\",\"client_idempotency_key\":\"$KEY\"}"
done
# Expected: second call → 409 unique violation; only 1 row exists.
```

### T13. Share code: cannot enumerate
```bash
curl -s "$SUPABASE_URL/rest/v1/box_recipes?share_code=not.is.null&select=*" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
# Expected after fix: [] (or 401). RPC must be used instead.
curl -s "$SUPABASE_URL/rest/v1/rpc/get_shared_recipe" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" -d '{"p_share_code":"abc"}'
```

### T14. Sign-up enumeration neutral
```bash
# Both should show identical "Check your email" UI
# attempt with existing email, then with a fresh one — compare response status + body
```

### T15. Supabase Advisor sweep (after fixes)
Use the `mcp__1b940f1a-39bf-4c29-85bf-b0ba6307ea5e__get_advisors` tool with `type="security"`. Expect zero high/critical findings.

---

## Unable to Verify — Appendix

These items require live DB / deploy access. Each row gives the exact query or command that would resolve it.

| # | Item | Source | How to verify |
|---|---|---|---|
| U-1 | RLS *enabled* on each public table | C-1 / `authorization-implementation.md#a-1` / `business-logic-vulnerabilities.md#f-01` | `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public';` — or `mcp__…__list_tables` |
| U-2 | RLS *policy content* (USING/WITH CHECK clauses) | same | `SELECT schemaname, tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public';` — `mcp__…__execute_sql` was denied permission per `authorization-implementation.md` TL;DR |
| U-3 | Supabase security advisor results | all | `mcp__1b940f1a-39bf-4c29-85bf-b0ba6307ea5e__get_advisors` with `type="security"` |
| U-4 | Whether `SUPABASE_SERVICE_ROLE_KEY` is actually set in production | H-4, H-7 | Vercel dashboard → Project → Settings → Environment Variables (production scope) |
| U-5 | Whether `NEXT_PUBLIC_SUPABASE_KEY` is in fact the **anon** role (and not service_role) | `business-logic-vulnerabilities.md#7` | Decode the JWT in browser devtools: claim `role` must equal `"anon"`. If `"service_role"`, this is its own **Critical** issue. |
| U-6 | Whether `SUPABASE_KEY` used by Python scrapers (`main.py:22`, `compare_prices.py:27`) is anon or service_role | `authorization-implementation.md#a-10`, `api-and-infrastructure.md#f12` | Read `secretsFile.py` on the scraper host (gitignored locally); decode `role` claim |
| U-7 | Supabase Auth → Captcha protection enabled with the matching Turnstile secret | H-5, L-3 / `authentication-flow.md#f-12` / `api-and-infrastructure.md#f11` | Supabase dashboard → Authentication → Providers → Email → "Enable Captcha protection" |
| U-8 | Supabase Auth → Site URL + Redirect URLs allowlist contains only production domains (no wildcards) | M-3 / `authentication-flow.md#f-5` | Supabase dashboard → Authentication → URL Configuration |
| U-9 | Supabase Auth → password minimum length & "Leaked password protection" | L-2 | Supabase dashboard → Authentication → Policies |
| U-10 | Supabase Auth → JWT TTLs and "Sign out users on password change" | L-5 | Supabase dashboard → Authentication → Settings |
| U-11 | Supabase Auth → email-confirmation enabled (prevents profile-row squatting via fake email) | M-10 / `authorization-implementation.md#7` | Supabase dashboard → Authentication → Providers → Email |
| U-12 | Supabase project rate-limit values for `/auth/v1/token`, `/auth/v1/recover` | H-5 | Supabase dashboard → Authentication → Rate Limits |
| U-13 | Supabase PostgREST CORS allow-list | `api-and-infrastructure.md#f10` | Supabase dashboard → Settings → API |
| U-14 | HSTS already delivered by Vercel for `pokefin.ca` (vs only `*.vercel.app`) | H-3 | `curl -sI https://pokefin.ca \| grep -i strict-transport-security` |
| U-15 | Whether `auth.users` already has a `handle_new_user`-style trigger that supersedes the client-side `profiles.insert` | M-10 / `authentication-flow.md#f-14` | `SELECT tgname FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass;` |
| U-16 | `auth.users` → `portfolios/box_recipes/profiles` foreign-key `ON DELETE` action | H-7 | `SELECT conname, confdeltype FROM pg_constraint WHERE confrelid='auth.users'::regclass;` (`a` = no action, `c` = cascade) |

---

## Merged Checklist Diff (across all four sub-reports)

Legend: **P**=Pass · **F**=Fail · **PF**=Partial Fail · **N/A**=Not Applicable · **UTV**=Unable to Verify

### Authentication (from `authentication-flow.md` §4)
| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Password hashing (bcrypt rounds) | N/A | Supabase-managed |
| 2 | JWT secret/key strength | N/A | Supabase-managed |
| 3 | Token settings (TTL, alg, claims) | N/A | Supabase-managed; **UTV** dashboard values |
| 4 | Refresh token implementation | **F** | localStorage; defeated by XSS (H-1) |
| 5 | Session invalidation on password change/reset | **PF** | No `signOut({ scope: "others" })` (L-5) |
| 6 | Brute-force protection (captcha + rate limit) | **PF** | Login/signup gated; forgot-password not (L-3, H-5) |
| 7 | Account enumeration defenses | **PF** | Signup leaks existence (L-4) |
| 8 | Password reset flow | N/A | Supabase-managed; implicit-flow path used (M-2) |
| 9 | Email verification | N/A | Supabase-managed |
| 10 | SQL injection in auth paths | **P** | PostgREST parameterized |
| 11 | AuthZ integrity (server-side roles + DB check) | **F** | No middleware (H-2); RLS UTV (C-1) |
| 12 | Cookie & CSRF configuration | **F** | localStorage (H-1) + no CSRF on delete (H-6) |
| 13 | Input validation & normalization | **PF** | Client-only validators (M-7, L-19) |
| 14 | Mass assignment risks | **PF** | `profiles.update({ username })` (L-19, M-10) |
| 15 | JWT misuse (no jwt.decode for authz) | **P** | App uses `auth.getUser` |
| 16 | Logging & telemetry (no secrets/PII) | **PF** | Verbose Supabase errors (M-5) |
| 17 | Dependency & crypto hygiene | **P** | Modern `@supabase/*` |
| 18 | Transport & CORS | **UTV** | No `headers()` in `next.config.ts` (H-3) |
| 19 | Open redirect / `next` param | **P** (caveats) | Backslash/encoded-slash edge (L-1) |
| 20 | Operational controls (secret rotation, env separation) | **PF** | Service-role gated in route (H-4); no rotation policy |

### Authorization (from `authorization-implementation.md` §Per-checklist matrix)
| # | Item | Status | Notes |
|---|---|---|---|
| 1 | BOLA/IDOR — ownership checks | **F** | M-1: RLS-only; helper functions filter by PK alone |
| 2 | Broken function-level AuthZ | N/A | No roles |
| 3 | Missing AuthZ on sensitive endpoints | **P** | Only `DELETE /api/account/delete` exists; gated |
| 4 | RBAC mapping | N/A | No roles |
| 5 | Privilege escalation (role/isAdmin columns) | **P** | None exist |
| 6 | JWT validation on every protected route | **P** | `getUser()` re-validates |
| 7 | API token scope enforcement | **P** (limited) | Service-role only inside one route (H-4 still flags co-location) |
| 8 | Multi-tenant isolation | N/A | Single-tenant per user |
| 9 | Bulk endpoint protections | N/A | No bulk endpoints |
| 10 | Field-level authorization | **PF** | `notes` always returned (L-15) |
| 11 | Error handling & enumeration | **PF** | M-8 (shared recipe enumeration) |
| 12 | Middleware ordering | N/A | No middleware (also H-2) |
| 13 | CORS & CSRF | **PF** | H-6 + L-16 |
| 14 | Open redirect protections | **P** (fragile) | L-1 |
| 15 | Fallback/debug routes | **P** | None exist |
| — | RLS enabled on every table | **P** (live, per MCP) / **F** (repo) | C-1 |
| — | RLS policy content correct | **UTV** | U-2 |
| — | service_role key not used client-side | **P** | |
| — | `serverSupabase.ts` uses anon key | **P** | |

### API & Infrastructure (from `api-and-infrastructure.md` Checklist diff)
| Item | Status | Notes |
|---|---|---|
| 1.1 CORS not wildcard | **P** | No CORS configured at Next layer |
| 1.2 CORS origin validation | **F** | H-6 |
| 1.3 CORS credentials handling | N/A or **F** | L-16 |
| 2.1 Rate limiting on all endpoints | **F** | H-5 |
| 2.2 Different limits for different ops | **F** | |
| 2.3 Distributed rate limiting | **F** | |
| 3.1 API versioning | **F** | L-17 |
| 3.2 Breaking-change management | **F** | |
| 4.1 Body parser limits | **F** | M-11 |
| 4.2 File upload restrictions | N/A (Next) / **F** (Python) | M-11 |
| 4.3 JSON depth limits | **F** | |
| 5.1 Helmet / Next.js headers config | **F** | H-3 |
| 5.2 CSP | **F** | H-3 |
| 5.3 X-Frame-Options | **F** | H-3 |
| 5.4 X-Content-Type-Options | **F** | H-3 |
| 5.5 HSTS | **F** / **UTV** on apex | H-3, U-14 |
| 6.1 Secure secret storage | **PF** | L-14 |
| 6.2 Rotation policy | **F** | |
| 6.3 Scope limitations | **F** | H-4 |
| 7.1 No stack traces in production | **PF** | M-5 |
| 7.2 Generic error messages | **P** in responses, **F** in logs | M-5 |
| 7.3 Proper status codes | **P** | |

### Business Logic (from `business-logic-vulnerabilities.md` §5)
| Item | Status | Notes |
|---|---|---|
| 1. Concurrent request handling | **F** | M-6, L-9 |
| 1. Double-spending prevention | **F** | M-6, L-8 |
| 1. Inventory mgmt (box recipes) | **P** (weak) | M-8, M-9 |
| 2. Client-side-only price validation | **F** | M-7 |
| 2. Discount/coupon abuse | N/A | No such flow |
| 2. Currency manipulation | **F** | C-1 → `exchange_rates` writable; L-7 sanity range |
| 3. Skipping validation steps | **F** | C-1, M-7, L-12 |
| 3. Status manipulation | **P** | No status state |
| 3. Approval process bypass | N/A | |
| 4. TOCTOU | **F** | L-8, L-9 |
| 4. Expiration / cache TTL bypass | **P** (weak) | unstable_cache amplifies F-02 |
| 4. Timezone manipulation | **F** | L-10 |
| 5. Calculation errors / overflow | **F** | M-7 |
| 5. Negative-value handling | **P** (DB-level for holdings); **F** for `usd_to_cad` | L-7 |

---

## Files reviewed (absolute paths)

- `/home/user/Pokefin/frontend/app/api/account/delete/route.ts`
- `/home/user/Pokefin/frontend/app/auth/callback/route.ts`
- `/home/user/Pokefin/frontend/app/auth/login/page.tsx`
- `/home/user/Pokefin/frontend/app/auth/signup/page.tsx`
- `/home/user/Pokefin/frontend/app/auth/reset-password/page.tsx`
- `/home/user/Pokefin/frontend/app/auth/forgot-password/page.tsx`
- `/home/user/Pokefin/frontend/app/account/page.tsx`
- `/home/user/Pokefin/frontend/app/context/AuthContext.tsx`
- `/home/user/Pokefin/frontend/app/lib/supabase.ts`
- `/home/user/Pokefin/frontend/app/lib/serverSupabase.ts`
- `/home/user/Pokefin/frontend/app/lib/serverMarketData.ts`
- `/home/user/Pokefin/frontend/app/lib/clientMarketData.ts`
- `/home/user/Pokefin/frontend/app/lib/portfolio.ts`
- `/home/user/Pokefin/frontend/app/lib/import.ts`
- `/home/user/Pokefin/frontend/app/lib/exchangeRate.ts`
- `/home/user/Pokefin/frontend/app/lib/marketData.ts`
- `/home/user/Pokefin/frontend/app/components/Portfolio/cards/AddHoldingModal.tsx`
- `/home/user/Pokefin/frontend/app/components/Portfolio/cards/EditHoldingModal.tsx`
- `/home/user/Pokefin/frontend/app/components/Portfolio/cards/ImportHoldingsModal.tsx`
- `/home/user/Pokefin/frontend/app/components/BoxCalculator/BoxCalculator.tsx`
- `/home/user/Pokefin/frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts`
- `/home/user/Pokefin/frontend/app/components/Header.tsx`
- `/home/user/Pokefin/frontend/app/layout.tsx`
- `/home/user/Pokefin/frontend/next.config.ts`
- `/home/user/Pokefin/frontend/package.json`
- `/home/user/Pokefin/schema.sql`
- `/home/user/Pokefin/migrations/create_box_recipes.sql`
- `/home/user/Pokefin/migrations/20260506_market_performance_functions.sql`
- `/home/user/Pokefin/main.py`
- `/home/user/Pokefin/backfill_historical_prices.py`
- `/home/user/Pokefin/compare_prices.py`
- `/home/user/Pokefin/generate_skus.py`
- `/home/user/Pokefin/update_shopify_skus.py`
- (Confirmed absent: `/home/user/Pokefin/frontend/middleware.ts`, `/home/user/Pokefin/vercel.json`, `/home/user/Pokefin/frontend/app/error.tsx`, `/home/user/Pokefin/frontend/app/global-error.tsx`)
