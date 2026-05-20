# API & Infrastructure Security Audit — Pokefin

Scope: Next.js (App Router) frontend deployed on Vercel, a single API route (`frontend/app/api/account/delete/route.ts`), an auth callback route (`frontend/app/auth/callback/route.ts`), Python data scrapers (`main.py`, `compare_prices.py`, `backfill_historical_prices.py`, `generate_skus.py`, `update_shopify_skus.py`), and Supabase as backend. The Python files are NOT HTTP servers — they are scheduled scrapers / CLI tools that talk outbound to Supabase, TCGPlayer, Bank of Canada and Shopify. So "API attack surface" is effectively (a) the Next.js App Router routes and (b) Supabase PostgREST exposed by the anon key.

Date: 2026-05-19
Reviewer focus: CORS, rate limiting, versioning, request size limits, HTTP security headers, key management, error handling.

---

## Summary Risk Score: 6.5 / 10

The single first-party API route (`/api/account/delete`) is reasonably authenticated and short, and Supabase Auth handles its own captcha / rate limits. The principal risks are:

1. No HTTP security headers are configured anywhere (no CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy). `frontend/next.config.ts` does not define `async headers()`.
2. No middleware, no app-level rate limiting and no Vercel rate-limit / WAF configuration on the `/api/account/delete` route or auth `/auth/callback` route. Repeated `DELETE` calls after stolen session token would let an attacker hammer the admin-delete path.
3. Supabase service-role key is used inside an HTTP route on the same Vercel function namespace as anon-key code (`frontend/app/api/account/delete/route.ts:55-72`). If `SUPABASE_SERVICE_ROLE_KEY` is misconfigured (e.g. mistakenly prefixed `NEXT_PUBLIC_`) it becomes a critical exposure. There is no scope limitation — the admin client has full DB privileges.
4. The Supabase project URL is hard-coded in `frontend/next.config.ts:16` (`tyrhvavwvphazpmwluft.supabase.co`), removing a small layer of obscurity but more importantly tying the deployment to a specific environment in source control.
5. No request body size limits or JSON depth limits configured (Next.js defaults apply, ~1 MB JSON, but never explicitly set).
6. Error handling in `/api/account/delete` calls `console.error("Failed to delete profile:", profileError)` — Supabase error objects routinely include `details`, `hint`, raw SQL fragments. This goes to Vercel logs (not the response, which is good) but is still verbose.

---

## Findings

### F1 — Missing HTTP security headers across the entire application

- Severity: **High**
- CWE: CWE-693 (Protection Mechanism Failure), CWE-1021 (Improper Restriction of Rendered UI Layers / Clickjacking)
- Evidence:
  - `frontend/next.config.ts:1-26` — config defines only `images.remotePatterns`. No `async headers()` block, no `poweredByHeader: false`, no CSP.
  - `frontend/app/layout.tsx:18-28` — `metadata` only; no `viewport`, no header injection.
  - Grep for `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`, `Permissions-Policy`, `Referrer-Policy` across the repo returns no matches.
- Why it matters:
  - No CSP means an injected `<script>` (e.g. via a Recharts SVG render path or markdown rendered via product fields) executes freely; supabase JWTs in cookies/localStorage can be exfiltrated.
  - No X-Frame-Options / `frame-ancestors` means the site can be iframed and used for clickjacking against the authenticated user (e.g. clicking the "Delete account" button on a hidden iframe).
  - No HSTS leaves the site vulnerable to SSL-strip / cookie capture from a first request over a stale `http://` host alias.
  - No `X-Content-Type-Options: nosniff` allows MIME-sniff attacks on the Supabase Storage-served images proxied through Next.
- Exploitability:
  - Clickjacking of `/account` delete button by framing `https://pokefin.ca/account` and overlaying a transparent button is straightforward today.
  - XSS impact is amplified by absent CSP.
- Remediation (drop-in in `frontend/next.config.ts`):
  ```ts
  import type { NextConfig } from "next";

  const cspParts = [
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
    { key: "Content-Security-Policy", value: cspParts },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ];

  const nextConfig: NextConfig = {
    poweredByHeader: false,
    images: { remotePatterns: [/* unchanged */] },
    async headers() {
      return [{ source: "/:path*", headers: securityHeaders }];
    },
  };

  export default nextConfig;
  ```
- Defense in depth:
  - Add a `report-uri` / `report-to` to CSP and monitor violations.
  - Consider migrating Supabase auth to `Secure; HttpOnly; SameSite=Lax` cookies via `@supabase/ssr` exclusively (already partly done in `auth/callback/route.ts`).

---

### F2 — No rate limiting on `/api/account/delete` or auth flows

- Severity: **High**
- CWE: CWE-770 (Allocation of Resources Without Limits or Throttling), CWE-307 (Improper Restriction of Excessive Authentication Attempts)
- Evidence:
  - `frontend/app/api/account/delete/route.ts:6-93` — no rate limiter, no per-IP / per-user throttle. Only check is `supabase.auth.getUser()` returning a user.
  - `frontend/app/auth/callback/route.ts:5-44` — exchanges any inbound `?code=` for a session with no throttle.
  - No `frontend/middleware.ts` exists (`find` returned nothing).
  - No Vercel rate-limit configuration (no `vercel.json` present).
  - Supabase Auth itself does have built-in limits, and Turnstile is enforced client-side on `login`/`signup` pages (`frontend/app/auth/login/page.tsx:103-106`, `frontend/app/auth/signup/page.tsx:178-181`), but Turnstile is only client-driven; if Supabase project's "Captcha protection" is not enabled server-side then captcha can be bypassed by calling Supabase directly with the anon key.
- Why it matters:
  - A valid (e.g. leaked / XSS-stolen) Supabase access token can be replayed against `DELETE /api/account/delete` thousands of times in a burst. Each call triggers `auth.admin.deleteUser` if a service-role key is set.
  - `auth/callback` can be brute-forced with random codes (low success probability, but no back-off allows OAuth code guessing / probing).
- Remediation:
  - Add a per-IP/per-user limiter. Easiest drop-in with no extra infra is Vercel KV + `@upstash/ratelimit`, or Cloudflare's built-in rate limit rules. Minimal example using Upstash:
    ```ts
    // frontend/app/lib/rateLimit.ts
    import { Ratelimit } from "@upstash/ratelimit";
    import { Redis } from "@upstash/redis";

    export const accountDeleteLimiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.fixedWindow(3, "1 h"),
      analytics: true,
      prefix: "rl:acct-del",
    });
    ```
    Then in `route.ts`:
    ```ts
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const { success } = await accountDeleteLimiter.limit(`${user.id}:${ip}`);
    if (!success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    ```
  - Add a `middleware.ts` with a coarser global limiter (e.g. 60 req/min/IP) for `/api/*` and `/auth/callback`.
  - Verify Supabase dashboard → Auth → "Captcha protection" is enabled so Turnstile is also enforced server-side, not only via the JS form.
- Defense in depth:
  - Require a re-authentication step before destructive actions (delete account) — Supabase supports `reauthenticate` flow.

---

### F3 — Supabase Service Role Key handled in a request-handler in the same code path as anon code

- Severity: **High** (Critical if env var is ever misnamed `NEXT_PUBLIC_*`)
- CWE: CWE-522 (Insufficiently Protected Credentials), CWE-732 (Incorrect Permission Assignment), CWE-250 (Execution with Unnecessary Privileges)
- Evidence:
  - `frontend/app/api/account/delete/route.ts:55-68`
    ```ts
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceRoleKey) {
      const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceRoleKey,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
      ...
    }
    ```
  - The admin client has *full database* privileges. There is no scope limit, RLS is bypassed.
- Why it matters:
  - If, during a refactor, someone renames the env var to `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` (a class of mistake that has actually happened in production projects), the key is bundled into the browser and game over.
  - The Vercel function runtime now has the service-role key in memory; any RCE / SSRF / log-disclosure (e.g. unhandled exception printing `process.env`) leaks it.
- Remediation:
  - Move the privileged deletion path to a Supabase Edge Function (or Postgres `SECURITY DEFINER` function) that authenticates the caller via JWT and only does the one thing it needs. The Next.js route then just calls the edge function with the user's JWT — service-role key never enters the Next.js process.
    ```sql
    -- migrations/2026xxxx_delete_account.sql
    create or replace function public.delete_my_account()
    returns void
    language plpgsql
    security definer
    set search_path = public
    as $$
    begin
      if auth.uid() is null then
        raise exception 'not authenticated';
      end if;
      delete from public.profiles where id = auth.uid();
      delete from auth.users where id = auth.uid();
    end;
    $$;
    revoke all on function public.delete_my_account() from public;
    grant execute on function public.delete_my_account() to authenticated;
    ```
    Then in `route.ts` replace the service-role branch with `await supabase.rpc("delete_my_account")`.
  - If keeping the current architecture, add a `runtime = "nodejs"` directive and **assert** at module load that the key is not exposed:
    ```ts
    export const runtime = "nodejs";
    if (process.env.SUPABASE_SERVICE_ROLE_KEY?.startsWith("NEXT_PUBLIC")) {
      throw new Error("Service role key must not be public");
    }
    ```
  - Add a guard that this route only runs on POST/DELETE and from the same origin (`request.headers.get("origin")` check) — see F4.
- Defense in depth:
  - Rotate `SUPABASE_SERVICE_ROLE_KEY` on a schedule (Supabase supports key rotation).
  - Restrict the key to a Vercel "preview/production" env scope; do not expose it to "development".

---

### F4 — No origin/CSRF check on the state-changing API route

- Severity: **High**
- CWE: CWE-352 (Cross-Site Request Forgery)
- Evidence:
  - `frontend/app/api/account/delete/route.ts:6` — `export async function DELETE(request: NextRequest)` accepts a DELETE with no `Origin`/`Referer`/CSRF-token validation.
  - Supabase auth is stored in cookies via `@supabase/ssr` (`auth/callback/route.ts:14-32`). With the default `SameSite=Lax`, a cross-origin `fetch("https://pokefin.ca/api/account/delete", {method:"DELETE", credentials:"include"})` from `attacker.example` will fail the cookie attach in modern browsers — but if a future change introduces `SameSite=None` (e.g. for embedded analytics) or if a same-site subdomain (`*.pokefin.ca`) is ever XSS'd, the protection collapses.
  - There's no explicit CSRF token, no double-submit cookie, and no `Origin` allow-list.
- Why it matters: a single bug (cookie flag change, subdomain takeover, or migration to Bearer-tokened auth) instantly turns this into a one-click account-deletion CSRF.
- Remediation: Add an origin allow-list. Minimal snippet at top of the `DELETE` handler:
  ```ts
  const allowed = new Set([
    "https://pokefin.ca",
    "https://www.pokefin.ca",
  ]);
  const origin = request.headers.get("origin");
  if (origin && !allowed.has(origin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  ```
  Better: require a custom header (e.g. `x-requested-with: pokefin-web`) and reject without it — simple browsers won't send it cross-origin without a preflight.
- Defense in depth:
  - Add CORS response headers explicitly: do not echo arbitrary `Origin` values.
  - If you keep the route, also require a recent re-auth challenge (Supabase `reauthentication`) for the destructive op.

---

### F5 — No explicit request size / body parser limit; no upload restrictions

- Severity: **Medium**
- CWE: CWE-770, CWE-400 (Uncontrolled Resource Consumption)
- Evidence:
  - `frontend/app/api/account/delete/route.ts` reads no body but does not declare a size or runtime limit. The current single route happens to take a zero-body DELETE, so concrete risk today is low.
  - There is no `export const dynamic`, `export const runtime`, no `bodyParser` config.
  - No file upload routes exist in `frontend/app/api/`, but the Python `download_and_upload_image` in `main.py:236-326` uploads up to ~30 MB by default into Supabase Storage with `cache-control: 3600` and `upsert: true` and bounds only by `if len(response.content) < 1000` (`main.py:264`) — there is no maximum size.
- Why it matters:
  - Future API routes (Box recipe save, portfolio import, etc.) are likely to land in `frontend/app/api/**` and will silently inherit the absent body limit (Next.js default 1 MB for parsed JSON, but no enforcement on raw streams).
  - The scraper's `download_and_upload_image` will happily store a multi-hundred-MB blob if TCGPlayer's CDN ever serves one, filling Supabase Storage quota.
- Remediation:
  - For each App Router route, declare:
    ```ts
    export const runtime = "nodejs";
    export const maxDuration = 10;
    // for routes that parse JSON, manually clamp:
    const text = await request.text();
    if (text.length > 4096) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    const body = JSON.parse(text);
    ```
  - In `main.py:260-266`, cap the download size:
    ```python
    MAX_IMAGE_BYTES = 5 * 1024 * 1024
    response = requests.get(image_url, headers=headers, timeout=30, stream=True)
    content = b""
    for chunk in response.iter_content(64 * 1024):
        content += chunk
        if len(content) > MAX_IMAGE_BYTES:
            logger.warning(f"Image exceeds {MAX_IMAGE_BYTES} bytes; skipping")
            return None
    ```
- Defense in depth: Set a Vercel function memory cap and a per-route `maxDuration` so a single slow body cannot pin a worker.

---

### F6 — Verbose error logging may leak DB internals; production stack traces unconfigured

- Severity: **Medium**
- CWE: CWE-209 (Information Exposure Through Error Message), CWE-532 (Insertion of Sensitive Information into Log File)
- Evidence:
  - `frontend/app/api/account/delete/route.ts:47` `console.error("Failed to delete profile:", profileError)` — Supabase `PostgrestError` includes `message`, `details` (often raw SQL), `hint`, and `code`.
  - `frontend/app/api/account/delete/route.ts:75` same pattern for admin deletion error.
  - `frontend/app/context/AuthContext.tsx:54, 60, 152` — error objects logged to browser console with full Supabase error payload (visible to anyone with the browser open, plus aggregated by Sentry/etc if added later).
  - Responses themselves return generic strings (`"Failed to delete profile"`) — good.
  - No global `error.tsx` boundary visible in `frontend/app/`, so the default Next.js 500 page may surface dev-mode stack traces if `NODE_ENV` is ever misconfigured.
- Why it matters: Server logs (Vercel) and browser console are both reachable in different attack scenarios; a SQL hint that names a column is enumeration-friendly. In dev, full Postgres errors leaked into the UI can drive injection attempts.
- Remediation:
  - Replace verbose `console.error(..., error)` with a serializer that drops `details`/`hint` in production:
    ```ts
    function logSupabaseError(label: string, err: { message?: string; code?: string }) {
      console.error(label, { message: err?.message, code: err?.code });
    }
    ```
  - Add a top-level `frontend/app/error.tsx` and `frontend/app/global-error.tsx` that render a generic 500 page with no stack info regardless of env.
  - In all `route.ts` files, wrap the handler in a try/catch that returns `{ error: "Internal server error" }` with status 500 (currently the implicit Next runtime might surface an uncaught throw page).
- Defense in depth: Forward logs to a SIEM and scrub `details`/`hint` server-side before persistence.

---

### F7 — Hard-coded Supabase project hostname in source (`tyrhvavwvphazpmwluft.supabase.co`)

- Severity: **Low**
- CWE: CWE-540 (Inclusion of Sensitive Information in Source Code), CWE-1188 (Insecure Default Initialization of Resource)
- Evidence: `frontend/next.config.ts:16`
  ```ts
  hostname: 'tyrhvavwvphazpmwluft.supabase.co',
  ```
  The wildcard pattern at line 20 `**.supabase.co` already covers it, so this line is redundant *and* leaks the project ref. The project ref is the same identifier that's already public via the anon JWT, so this is not by itself sensitive — however, it tightly couples public repos to a specific Supabase project and complicates env separation (preview vs prod).
- Remediation: Remove the explicit hostname and keep only the `**.supabase.co` wildcard, or move it to `process.env.NEXT_PUBLIC_SUPABASE_HOSTNAME` derived at build time:
  ```ts
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.tcgplayer.com' },
      { protocol: 'https', hostname: 'tcgplayer.com' },
      { protocol: 'https', hostname: '**.supabase.co' },
    ],
  },
  ```

---

### F8 — No API versioning strategy

- Severity: **Low** (informational)
- CWE: n/a
- Evidence: The single route is `frontend/app/api/account/delete/route.ts`. No `/v1/` prefix, no `Accept-Version` handling, no deprecation header strategy.
- Why it matters: As more API routes are added (Box recipe save, portfolio import, etc.), client/server contract changes will become breaking. A versioning strategy is much easier to introduce now than later.
- Remediation: Adopt `/api/v1/...` as a convention going forward; for the existing route, alias both `/api/account/delete` and `/api/v1/account/delete` and add a `Deprecation: true` header to the unversioned path within 6 months.
- Defense in depth: Use a content-negotiation versioning header (`Accept: application/vnd.pokefin.v1+json`) for richer evolution.

---

### F9 — Anon Supabase key handles all data access; PostgREST is the de-facto API with no app-layer rate limit

- Severity: **Medium**
- CWE: CWE-770, CWE-799 (Improper Control of Interaction Frequency)
- Evidence:
  - `frontend/app/lib/supabase.ts:1-12` exposes a browser-side Supabase client.
  - Most pages (e.g. `frontend/app/components/ProductPrices.tsx:11-12`, the `useBoxRecipes`, `usePortfolioData` hooks) talk directly to PostgREST. The anon key is therefore your real public API.
  - Supabase RLS is the only authorization boundary, and there's no app-layer abuse limiter on heavy queries (e.g. unbounded `select *` on `products` joined with price history).
- Why it matters:
  - An attacker can replay the anon key against PostgREST from any origin (Supabase has no CORS allow-list by default beyond `*`) and pull large datasets, drive read amplification, or generate compute-heavy queries on `product_price_history`.
  - Supabase rate-limits per IP at the project level, but you cannot tune per-table — and they don't protect against distributed abuse.
- Remediation:
  - Configure **Postgres function-level rate limits** via `pg_cron` + a `request_log` table, or migrate hot endpoints behind Next.js route handlers that you can rate-limit at the edge.
  - Tighten RLS so `select` policies require `auth.uid()` for user-owned tables (`portfolios`, `portfolio_holdings`, `portfolio_lots`, `box_recipes`). The schema does not show RLS policies — verify with `select * from pg_policies` (use Supabase MCP `list_tables` + advisor).
  - Add Cloudflare or Vercel WAF in front of `*.supabase.co` indirectly by routing reads through your Next.js API.
  - Status: **Unable to verify** the actual RLS policies from the audit scope — would need `pg_policies` dump or Supabase advisor output.
- Defense in depth: Enable Supabase's "Network restrictions" if the project is accessed only from Vercel egress IPs (not the case here since browsers connect directly).

---

### F10 — No CORS configuration anywhere (relies on browser same-origin + Supabase defaults)

- Severity: **Low** (current attack surface) / **Medium** (if more API routes are added)
- CWE: CWE-942 (Permissive Cross-domain Policy with Untrusted Domains)
- Evidence:
  - No `Access-Control-Allow-*` headers configured anywhere in repo.
  - The Next.js `/api/account/delete` route doesn't set CORS headers, so it implicitly relies on Same-Origin Policy. That's fine until/unless the API is also called from a different origin (mobile app, custom domain) — at which point developers tend to add `Access-Control-Allow-Origin: *`, which is the bad outcome we want to pre-empt.
  - Supabase PostgREST is, by default, configured permissively (responds to any origin) — that is a Supabase-side setting visible via the dashboard; **unable to verify** without project access.
- Remediation: Add an explicit deny-by-default `OPTIONS` handler to each Next.js API route:
  ```ts
  export async function OPTIONS(request: NextRequest) {
    const origin = request.headers.get("origin") ?? "";
    const allowed = ["https://pokefin.ca", "https://www.pokefin.ca"].includes(origin);
    return new NextResponse(null, {
      status: allowed ? 204 : 403,
      headers: allowed
        ? {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "DELETE, POST, OPTIONS",
            "Access-Control-Allow-Headers": "content-type, authorization",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Max-Age": "600",
          }
        : {},
    });
  }
  ```
  Mirror the `Access-Control-Allow-Origin` on the `DELETE` response only after origin check.
- Defense in depth: Document that `Access-Control-Allow-Origin: *` plus `Access-Control-Allow-Credentials: true` is never a valid combination.

---

### F11 — Captcha is client-only; Turnstile site key is in repo via env, but server verification depends on Supabase config

- Severity: **Low**
- CWE: CWE-602 (Client-Side Enforcement of Server-Side Security)
- Evidence:
  - `frontend/app/auth/login/page.tsx:103-114` and `frontend/app/auth/signup/page.tsx:178-189` gate the submit button on Turnstile token, but the token is passed only as `captchaToken` to `supabase.auth.signIn*` — server-side enforcement happens only if the Supabase project has captcha enabled.
  - **Unable to verify** without dashboard access.
- Remediation: Confirm Supabase Auth → "Captcha protection" is on, with the matching Turnstile secret. Otherwise attackers bypass the gate entirely by hitting Supabase Auth API directly with the anon key.

---

### F12 — Python scrapers store credentials in a Python module on disk

- Severity: **Low** (out of HTTP scope but listed for completeness)
- CWE: CWE-256 / CWE-522
- Evidence:
  - `main.py:22` `from secretsFile import SUPABASE_URL, SUPABASE_KEY`
  - `compare_prices.py:27` `from secretsFile import SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_TOKEN, SHOPIFY_API_VERSION`
  - `.gitignore` correctly excludes `secretsFile.py`, but the convention is fragile compared to environment variables. `compare_prices.py:47-49` already supports env fallback — generalize that pattern everywhere.
  - `SUPABASE_KEY` here is *probably* anon (per the frontend pattern), but `main.py` writes to `products`, `exchange_rates`, `product_price_history`, and uploads to Storage. If RLS prevents anon writes (likely), then this key is *actually* the service-role key in deployment — placed on a shared disk in clear text.
- Remediation: Use `os.environ` consistently and document that the deploy environment must inject `SUPABASE_SERVICE_ROLE_KEY` only into the scraper host, not into the Vercel build.
  ```python
  SUPABASE_URL = os.environ["SUPABASE_URL"]
  SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
  ```
- Defense in depth: Rotate the scraper's key on a 90-day cadence.

---

## Top 5 prioritized fixes

1. **Add HTTP security headers in `frontend/next.config.ts`** (F1) — CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. Drop-in snippet in F1.
2. **Move the admin-delete path off the Next.js function** (F3) — use a Supabase `SECURITY DEFINER` RPC or Edge Function so the service-role key never lives in the web tier; add an `Origin` check meanwhile (F4).
3. **Add rate limiting** (F2) on `/api/account/delete` and `/auth/callback` (Upstash Ratelimit or Cloudflare rule), plus a `middleware.ts` for `/api/*`. Verify Supabase captcha enforcement is on.
4. **Stop logging full Supabase error objects in API routes** (F6) — log only `message` + `code`; add `frontend/app/error.tsx` + `global-error.tsx` to mask stack traces.
5. **Cap request and download sizes** (F5) — clamp Next.js JSON bodies (`request.text()` + length check) and cap `download_and_upload_image` to a maximum size with streaming.

---

## Checklist diff

| Check item | Status | Notes |
|---|---|---|
| 1.1 CORS not using wildcard in production | Pass | No CORS configured at all in Next.js layer; same-origin only. Supabase-side CORS unable-to-verify. |
| 1.2 CORS proper origin validation | Fail | No explicit allow-list; `/api/account/delete` accepts any origin (relies on cookie SameSite). See F4/F10. |
| 1.3 CORS credentials handling | Not Applicable / Fail | Not yet needed but undocumented — F10. |
| 2.1 Rate limiting on all endpoints | Fail | No app-layer rate limiting; F2. |
| 2.2 Different limits for different operations | Fail | None. |
| 2.3 Distributed rate limiting | Fail | None. Vercel serverless multiplies the need. |
| 3.1 API versioning — deprecated handling | Fail | No versioning at all; F8. |
| 3.2 Breaking-change management | Fail | None documented. |
| 4.1 Body parser limits | Fail | Implicit Next defaults only; not declared. F5. |
| 4.2 File upload restrictions | Not Applicable (Next) / Fail (Python scraper) | No upload routes in Next; scraper has no upper bound on image size. F5. |
| 4.3 JSON depth limits | Fail | Not configured. |
| 5.1 Helmet / Next.js headers config | Fail | `next.config.ts` has no `headers()`. F1. |
| 5.2 CSP | Fail | Absent. F1. |
| 5.3 X-Frame-Options | Fail | Absent — clickjacking risk on `/account`. F1. |
| 5.4 X-Content-Type-Options | Fail | Absent. F1. |
| 5.5 Strict-Transport-Security | Fail | Absent (Vercel may set it by default on `*.vercel.app`, but custom domain `pokefin.ca` is **unable to verify**). F1. |
| 6.1 Secure secret storage | Partial / Fail | `.gitignore` covers `secretsFile.py`; service-role key handled in Vercel env. Scraper stores creds in a Python file. F3, F12. |
| 6.2 Rotation policy | Fail | None documented. |
| 6.3 Scope limitations | Fail | Service-role key is full DB superuser; no scoped key. F3. |
| 7.1 No stack traces in production | Partial | API route returns generic messages, but no `error.tsx`/`global-error.tsx` boundary; logs are verbose. F6. |
| 7.2 Generic error messages | Pass (in responses) / Fail (in logs) | Responses are generic. Logs are not. F6. |
| 7.3 Proper status codes | Pass | `401`, `500`, `200` correctly chosen in `/api/account/delete`. |

---

## Unable to verify (need additional context)

- Supabase project settings: CORS allow-list, captcha enforcement, RLS policies on `portfolios`, `portfolio_holdings`, `portfolio_lots`, `box_recipes`, `profiles`. Would be confirmed via `pg_policies` and Supabase Advisor (`mcp__...__get_advisors`).
- HSTS on `pokefin.ca`: Vercel default headers vs custom-domain configuration. Would be confirmed with `curl -I https://pokefin.ca`.
- Whether `SUPABASE_SERVICE_ROLE_KEY` is set in production or never set (the code is conditional). Confirm via Vercel env vars.
- Whether `compare_prices.py`/`main.py` actually run with the anon key or the service-role key in production. Confirm via deploy docs.
