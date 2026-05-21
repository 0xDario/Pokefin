# Security Audit — Logging and Monitoring

**Repository:** Pokefin
**Branch audited:** `claude/security-vulnerability-analysis-LT3JQ` (current HEAD)
**Audit topic:** Logging and Monitoring (OWASP ASVS V7, OWASP Top 10 A09:2021 — Security Logging and Monitoring Failures)
**Date:** 2026-05-21
**Scope:** `frontend/app/**` (Next.js 15 App Router) and Python scrapers (`main.py`, `backfill_historical_prices.py`, `compare_prices.py`, `generate_skus.py`, `update_shopify_skus.py`)
**Method:** Static analysis only. Items requiring runtime/platform inspection are marked "Unable to verify."

---

## Executive Summary

The recent hardening pass on `claude/security-vulnerability-analysis-LT3JQ` materially improved the logging posture in the auth- and account-sensitive code paths. The four named files (`AuthContext.tsx`, `lib/portfolio.ts`, `useBoxRecipes.ts`, `api/account/delete/route.ts`) were verified: their security-relevant call sites now log structured `{ code }` objects rather than full Supabase error objects. `error.tsx` and `global-error.tsx` were added and do **not** leak stack traces to users.

However, the application has **no security event logging, no audit trail, and no monitoring/alerting whatsoever**. There is no Sentry, no Vercel Analytics, no centralized logging, and no audit log of sensitive operations (account deletion, password change). This is the dominant gap and maps directly to A09:2021. Additionally, the hardening was applied **inconsistently** — several `console.error` call sites in the same files (`portfolio.ts`, `import.ts`, etc.) and a `getPortfolioData` catch block still log full error objects, partially undermining the structured-logging intent.

The Python scrapers do not leak the Supabase key or Shopify token in their current code paths, but `main.py` logs raw upload-response objects on failure (`logger.error(f"Upload failed: {upload_response}")`), which is a defense-in-depth concern if a future SDK version embeds request URLs/headers.

**Summary risk score: 4.5 / 10** — No single critical leak found, but the total absence of security logging and monitoring is a systemic Medium/High weakness that delays breach detection.

---

## Findings

### F-1. No security event logging or audit trail for sensitive operations

- **Severity:** High
- **CWE:** CWE-778 (Insufficient Logging)
- **Evidence:**
  - `frontend/app/api/account/delete/route.ts` — the `DELETE` handler. On a 401 (`userError || !user`, line 53-55) and on a 403 CSRF rejection (lines 24-29) it returns a response but writes **nothing** to any log. Only the RPC-failure branch logs (`delete_my_account_failed`, line 62). A *successful* account deletion (line 70) is never recorded.
  - `frontend/app/context/AuthContext.tsx` — `signIn` (lines 131-140), `signUp` (lines 117-129), `resetPassword` (lines 147-154), `updatePassword` (lines 156-161). All return the `AuthError` to the caller; none log a server-side security event for a failed login, a password change, or a password reset request.
  - `migrations/0002_account_deletion.sql` — `delete_my_account()` RPC (lines ~44-58). The function `DELETE FROM auth.users WHERE id = auth.uid()` with no `INSERT` into any audit table. The cascade destroys all user data with **zero forensic record** that the deletion occurred or who/when.
  - No `auth_events`, `audit_log`, or equivalent table exists in `migrations/` or `schema.sql`.
- **Why it matters:** Without server-side records of failed authorizations (the 401/403 in the delete route), failed logins, password changes, and account deletions, there is no way to detect credential-stuffing, account-takeover follow-through (attacker changes password then deletes account to cover tracks), or to satisfy incident-response / GDPR Art. 33 breach-notification obligations. `audits/HARDENING_FOLLOWUPS.md` §5 already flags the missing `auth_events` table as a known gap — it remains unaddressed in code.
- **Exploitability + minimal safe PoC:** Not directly exploitable; it is a *detection* failure. PoC for the visibility gap: from a logged-in browser session, call `fetch('/api/account/delete', { method: 'DELETE', headers: { 'x-pokefin-request': '1' } })`. The account and all portfolios/holdings/recipes are destroyed via cascade and **no log line anywhere** attributes the action. An attacker who has hijacked a session can wipe a victim's account and leave no trace.
- **Remediation (minimal drop-in):** Add structured server-side log lines at the security-relevant branches. In `api/account/delete/route.ts`:

  ```ts
  // 401 branch
  if (userError || !user) {
    console.warn("account_delete_unauthorized", { ts: new Date().toISOString() });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // 403 CSRF branch
  console.warn("account_delete_csrf_rejected", {
    ts: new Date().toISOString(),
    origin: request.headers.get("origin"),
  });
  // success branch (after RPC)
  console.info("account_deleted", { userId: user.id, ts: new Date().toISOString() });
  ```

  For a durable audit trail, add a migration creating an `audit_log` table and have `delete_my_account()` insert a row before the `DELETE` (capturing `auth.uid()` and `now()`), or add an `AFTER DELETE` trigger on `auth.users`.
- **Defense-in-depth:** Implement the `auth_events` table from `HARDENING_FOLLOWUPS.md` §5 driven by a Supabase trigger; enable and retain Supabase Auth's built-in log stream (it records login attempts internally — see F-2); forward logs to a SIEM with alerting on bursts of 401/403.

---

### F-2. No monitoring, alerting, or error-rate detection wired up

- **Severity:** Medium
- **CWE:** CWE-778 (Insufficient Logging), CWE-223 (Omission of Security-relevant Information)
- **Evidence:**
  - `frontend/package.json` dependencies: `@marsidev/react-turnstile`, `@supabase/ssr`, `@supabase/supabase-js`, `next`, `react`, `react-dom`, `recharts`. **No** `@sentry/nextjs`, `@vercel/analytics`, `@vercel/speed-insights`, `pino`, `winston`, `datadog`, `logtail`, or any APM/error-tracking package.
  - `frontend/app/layout.tsx` (lines 1-48) — root layout renders `AuthProvider`/`Header`/`Footer` only; no `<Analytics />`, no Sentry init, no instrumentation import.
  - No `frontend/sentry.*.config.ts`, no `frontend/instrumentation.ts`.
  - `frontend/next.config.ts` — security headers and image config only; no `withSentryConfig` wrapper, no `compiler.removeConsole`.
  - Server errors surface only as ephemeral `console.error` lines (visible in Vercel function logs if anyone looks) — nothing aggregates them or alerts on a spike.
- **Why it matters:** A09:2021 explicitly calls out "no alerting" as a Top-10 failure. A surge of failed logins (credential stuffing), a spike in 5xx errors from the delete route, or anomalous scraper behavior produces no notification. Mean-time-to-detect for an incident is effectively unbounded.
- **Exploitability + minimal safe PoC:** Not exploitable; it is an absence. Demonstration: trigger 500 errors by repeatedly hitting `/api/account/delete` with a malformed session — no alert fires, no dashboard increments.
- **Remediation (minimal drop-in):** Add error tracking. For Sentry on Next.js 15:

  ```bash
  cd frontend && npm install @sentry/nextjs
  npx @sentry/wizard@latest -i nextjs
  ```

  This generates `instrumentation.ts` / client+server configs and wraps `next.config.ts`. At minimum, add `@vercel/analytics` and render `<Analytics />` in `layout.tsx` for baseline traffic/anomaly visibility:

  ```ts
  import { Analytics } from "@vercel/analytics/react";
  // ...inside <body>, after <Footer />:
  <Analytics />
  ```
- **Defense-in-depth:** Configure Vercel Log Drains to a retained store; set Supabase dashboard alerts on auth error rates; add uptime monitoring on `/` and the scraper schedule.

---

### F-3. Inconsistent hardening — several `console.error` call sites still log full Supabase/Error objects

- **Severity:** Medium
- **CWE:** CWE-209 (Generation of Error Message Containing Sensitive Information), CWE-532 (Insertion of Sensitive Information into Log File)
- **Evidence:** The recent change converted *some* call sites to `{ code }` but left siblings in the same files emitting the entire error object, which for Supabase/PostgREST errors includes `message`, `details`, and `hint` (these can echo SQL fragments, column names, constraint names, and sometimes row values):
  - `frontend/app/lib/portfolio.ts:37` — `console.error("Error fetching portfolio:", fetchError);`
  - `frontend/app/lib/portfolio.ts:49` — `console.error("Error creating portfolio:", createError);`
  - `frontend/app/lib/portfolio.ts:126` — `console.error("Error fetching holdings:", error);`
  - `frontend/app/lib/portfolio.ts:367` — `console.error("Error fetching price history:", error);`
  - `frontend/app/lib/portfolio.ts:485` — `console.error("Error searching sets:", setsError);`
  - `frontend/app/lib/portfolio.ts:502` — `console.error("Error searching products by set:", error);`
  - `frontend/app/lib/portfolio.ts:523` — `console.error("Error fetching all products:", error);`
  - `frontend/app/lib/import.ts:248` / `:261` — full `error` / `allError` objects.
  - `frontend/app/lib/serverMarketData.ts:443` / `:573` — full `error` object (server-side; lands in Vercel function logs).
  - `frontend/app/components/Portfolio/hooks/usePortfolioData.ts:83` — `console.error("Error fetching portfolio data:", err);` logs a raw caught `err`.
  - `frontend/app/components/Portfolio/cards/ImportHoldingsModal.tsx:78` / `:129` — raw caught `err` from CSV parse / import.
  - `frontend/app/components/BoxCalculator/hooks/useBoosterBoxPrices.ts:26` — full `productsError`.
  - `frontend/app/components/ProductPrices/hooks/useProductData.ts:37` / `:89`, `useCurrencyConversion.ts:35`, `exchangeRate.ts:37`, `ProductPrices.tsx:171/203/221` — full error objects.
- **Why it matters:** Most of these are client-side (`console.*` runs in the browser console) so the *primary* risk is verbose internal-detail disclosure to anyone with DevTools open — useful for an attacker probing schema/RLS behavior. The server-side ones (`serverMarketData.ts`) write `details`/`hint` into Vercel function logs. The hardening intent (structured `{ code }`-only logging) is sound but only ~40% applied; the inconsistency means the policy is not enforceable and will regress.
- **Exploitability + minimal safe PoC:** Open the portfolio page in a browser with DevTools open and force a query error (e.g., a stale `portfolio_id`). The console prints the full PostgREST error including `message`/`details`/`hint`, revealing table/column names. Low impact in isolation; aids reconnaissance.
- **Remediation (minimal drop-in):** Apply the same pattern already used elsewhere in these files. Example for `portfolio.ts:37`:

  ```ts
  if (fetchError && fetchError.code !== "PGRST116") {
    console.error("portfolio_fetch_failed", { code: fetchError.code });
    return null;
  }
  ```

  For caught `unknown` errors (`usePortfolioData.ts:83`, `ImportHoldingsModal.tsx`), log only a stable label and never the raw object client-side:

  ```ts
  } catch (err) {
    console.error("portfolio_data_failed");
    setError(err instanceof Error ? err.message : "An error occurred");
  }
  ```
- **Defense-in-depth:** Add a tiny shared `logError(event: string, meta?: { code?: string })` helper in `frontend/app/lib/` and an ESLint rule banning bare `console.error` with a second object argument, so the structured-logging policy is enforced and cannot silently regress. In production, strip non-essential console output via `next.config.ts` `compiler: { removeConsole: { exclude: ['error', 'warn'] } }`.

---

### F-4. Python scraper logs raw response objects on failure

- **Severity:** Low
- **CWE:** CWE-532 (Insertion of Sensitive Information into Log File)
- **Evidence:**
  - `main.py:310` — `logger.debug(f"Public URL response: {public_url_response}")`
  - `main.py:317` — `logger.error(f"Upload failed: {upload_response}")`
  - `main.py:325` — `logger.error(f"Image upload error for product {product_id}: {e}")`
  - `compare_prices.py:53-108` — `fetch_shopify_products_api()` constructs `headers` containing `X-Shopify-Access-Token: token` (line 62). On HTTP error, `_raise_shopify_http_error` (lines 111-127) raises a friendly message that does **not** include the token or headers — good. `response.raise_for_status()` (line 74) raises a `requests.HTTPError` whose default string contains the URL but **not** request headers — acceptable.
- **Why it matters:** The Supabase URL/key are passed positionally to `create_client(SUPABASE_URL, SUPABASE_KEY)` (`main.py:163`, `generate_skus.py:33`, `compare_prices.py:42`) and are **not** interpolated into any log line — verified clean. The residual risk is `main.py:317`'s logging of the entire `upload_response`/`public_url_response` object: depending on the `supabase-py` / `storage3` version, these objects can carry the signed request URL or response headers. Today this is benign; it is a version-dependent latent leak. Scraper logs typically go to stdout/CI logs which are less protected than app logs.
- **Exploitability + minimal safe PoC:** Not currently exploitable — confirmed no key/token is in the logged objects with the pinned SDK. Cannot verify future SDK versions (marked Unable to verify for upgrade paths).
- **Remediation (minimal drop-in):** Log only a stable status, not the object:

  ```python
  logger.error(f"Upload failed for {filename}: status unavailable")
  # and
  logger.debug("Public URL response received but publicUrl key missing")
  ```
- **Defense-in-depth:** Add a logging filter that redacts anything matching the Supabase/Shopify key patterns (`eyJ...`, `shpat_...`) before emit; never run scrapers with `--debug` (`logger.setLevel(logging.DEBUG)`, `main.py:778`) in shared CI.

---

### F-5. Error boundaries are clean — no remediation needed (informational)

- **Severity:** Informational (Pass)
- **Evidence:** `frontend/app/error.tsx` (lines 1-20) destructures only `{ reset }` and ignores the `error` prop — it never renders `error.message`, `error.stack`, or `error.digest`. `frontend/app/global-error.tsx` (lines 1-16) does the same. Both render a generic "Something went wrong" message.
- **Why it matters:** Confirms no stack-trace or internal-error leakage to the end user via the React error boundaries — this is correct (CWE-209 avoided here).
- **Note:** The flip side is that because `error.tsx` ignores `error` entirely, the error is **not** reported anywhere either (no `useEffect(() => report(error), [error])`). Once F-2 is addressed, wire the boundary to the error tracker:

  ```tsx
  "use client";
  import { useEffect } from "react";
  export default function Error({ error, reset }: { error: Error; reset: () => void }) {
    useEffect(() => { /* Sentry.captureException(error) */ }, [error]);
    // ...unchanged UI
  }
  ```

---

## Log Injection Assessment (Item 3)

**Status: Pass (with one note).** No evidence of user-controlled input being concatenated into log lines in a way that enables CRLF/log-forging in the hardened call sites — the structured `{ code }` pattern in `AuthContext.tsx`, the `route.ts` handlers, `useBoxRecipes.ts`, and the converted `portfolio.ts` sites passes only a Supabase error `code` (a fixed enum-like string). The Python `logger` calls interpolate scraper-internal values (product IDs, counts, file paths, exception strings) — `product_id` originates from the database, not an untrusted external request, so injection risk is low. The remaining F-3 call sites that log full error objects could include user-influenced substrings inside `error.message` (e.g., a search term echoed back by PostgREST); console output is not newline-sanitized, so fixing F-3 also closes this minor surface. Recommendation: keep all log payloads structured (key/value), never string-concatenate request-derived values, and if logs are later shipped to a text-based aggregator, encode newlines.

## Log Storage, Retention, Rotation (Item 4)

**Status: Unable to verify (platform-dependent).** There is no application-managed log file, so rotation/backup is entirely a Vercel (function logs) and Supabase (Auth/Postgres logs) platform concern. By default Vercel retains runtime logs for a short, plan-dependent window and Supabase log retention is also plan-dependent — neither is configured in this repo. **Action:** configure a Vercel Log Drain and/or Supabase log export to a retained, access-controlled store; document a retention period aligned with incident-response needs (commonly 90 days minimum). Scraper logs go to stdout with no file handler (`logging.basicConfig` with a stream handler in all five scripts) — capture and retain them wherever the scraper runs (cron host / CI).

## Monitoring & Alerting (Item 5)

**Status: Fail.** Confirmed nothing is wired up — see F-2. No Sentry, no Vercel Analytics/Speed Insights, no APM, no error-rate alerts, no anomaly detection.

---

## Risk Score

**4.5 / 10.** No confirmed critical sensitive-data leak; the auth/account-sensitive paths were genuinely hardened. The score reflects the systemic A09:2021 exposure: zero security event logging, zero audit trail for irreversible operations (account deletion), zero monitoring/alerting, and an only-partially-applied structured-logging policy that will regress without enforcement.

## Top Prioritized Fixes

1. **(High — F-1)** Add server-side security event logging in `api/account/delete/route.ts` for the 401, 403, and success branches; add an `audit_log` table (or `auth.users` `AFTER DELETE` trigger / `delete_my_account()` insert) so account deletions are recorded. Log failed logins / password changes server-side or rely on (and retain) Supabase Auth logs.
2. **(Medium — F-2)** Install and configure `@sentry/nextjs` (or equivalent) and `@vercel/analytics`; wire `error.tsx` / `global-error.tsx` to report captured errors. Set error-rate alerts.
3. **(Medium — F-3)** Finish the hardening: convert the remaining ~15 full-error `console.error` call sites in `portfolio.ts`, `import.ts`, `serverMarketData.ts`, `usePortfolioData.ts`, `ImportHoldingsModal.tsx`, `useBoosterBoxPrices.ts`, `useProductData.ts`, `useCurrencyConversion.ts`, `exchangeRate.ts`, `ProductPrices.tsx` to structured `{ code }` logging. Add a shared `logError` helper + ESLint rule to prevent regression.
4. **(Low — F-4)** Stop logging raw `upload_response` / `public_url_response` objects in `main.py:310,317`; add a key-redaction logging filter to all scrapers.
5. **(Platform)** Configure Vercel Log Drain + Supabase log export with a documented retention period; verify Supabase Auth logging is enabled and retained.

---

## Logging Compliance Checklist

| # | Control | Status | Reference |
|---|---|---|---|
| 1 | Passwords never logged | Pass | `AuthContext.tsx` `signIn/signUp/updatePassword` return error to caller; no log of `password` |
| 2 | JWTs / session tokens never logged | Pass | No `session`/`access_token` interpolation in any `console.*` |
| 3 | Supabase anon/service key never logged | Pass | `create_client(SUPABASE_URL, SUPABASE_KEY)` positional; key not in any log line |
| 4 | Shopify Admin token never logged | Pass | `compare_prices.py` keeps token in `headers` only; error handler omits it |
| 5 | Email / PII never logged | Pass (mostly) | No `email` logged; F-3 full-error objects could echo user search strings |
| 6 | Password-reset links / recovery tokens never logged | Pass | `resetPassword` logs nothing; callback `route.ts` logs nothing |
| 7 | Full error objects (details/hint) not logged | **Fail** | F-3 — ~15 call sites still log full errors |
| 8 | Stack traces not shown to users | Pass | F-5 — `error.tsx` / `global-error.tsx` ignore `error` prop |
| 9 | Failed auth / authorization events logged server-side | **Fail** | F-1 — 401/403 in delete route silent; rely on Supabase Auth (unverified) |
| 10 | Sensitive operations audited (account delete, password change) | **Fail** | F-1 — `delete_my_account()` has no audit insert; no `audit_log` table |
| 11 | Input validation failures logged | **Fail** | CSV parse failure (`ImportHoldingsModal.tsx:78`) logs raw `err` only client-side; not a server event |
| 12 | Structured logging (no string-concat of untrusted input) | Partial | Hardened sites structured; F-3 sites not |
| 13 | Log injection / CRLF prevented | Pass | No CRLF-injectable user input in hardened sites; fix F-3 to fully close |
| 14 | Centralized logging | **Fail** | No log drain / aggregator configured in repo |
| 15 | Monitoring & alerting (Sentry / Analytics / error-rate) | **Fail** | F-2 — none present |
| 16 | Log retention / rotation / backup | Unable to verify | Platform (Vercel/Supabase) concern; not configured in repo |

## Checklist Diff — Audit's 5 Required Items

| Item | Topic | Result | Notes |
|---|---|---|---|
| 1 | Sensitive data not logged (passwords, tokens, PII, keys, cards) | **Partial Pass** | No password/token/key/email leak found. Hardening of `AuthContext.tsx`, `useBoxRecipes.ts`, `api/account/delete/route.ts` and key `portfolio.ts` sites **verified**. But F-3: ~15 sibling `console.error` sites still emit full Supabase error objects (`details`/`hint`). No card data exists in this app (N/A). |
| 2 | Security event logging (failed logins, authz failures, system errors) | **Fail** | F-1 — no server-side logging of failed auth, the delete route's 401/403, or successful account deletion. Supabase Auth logs login attempts internally, but reliance on it is unverified and unretained. |
| 3 | Log injection prevention / structured logging | **Pass (with note)** | Hardened paths use structured `{ code }`; no CRLF-injectable user input in them. Fix F-3 to fully close the surface where `error.message` could echo user input. |
| 4 | Log storage / retention / rotation / backup | **Not Applicable / Unable to verify** | No app-managed log files; entirely Vercel/Supabase platform configuration — not set in repo. |
| 5 | Monitoring alerts (anomaly / error-rate / performance) | **Fail** | F-2 — no Sentry, no Vercel Analytics/Speed Insights, no APM, no alerting anywhere. |

---

*Static analysis only. "Unable to verify" items (Supabase Auth log behavior/retention, Vercel log retention, future SDK response-object contents) require runtime/platform inspection. No source code was modified by this audit.*
