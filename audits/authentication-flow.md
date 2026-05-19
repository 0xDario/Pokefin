# Authentication Flow Security Audit — Pokefin

**Scope:** Authentication and session handling for the Pokefin Next.js (App Router) frontend at `/home/user/Pokefin/frontend`, using Supabase Auth + a Postgres profile table.
**Date:** 2026-05-19
**Auth model:** Supabase Auth (password + email confirmation) with `@supabase/supabase-js` client and `@supabase/ssr` server adapter. Supabase manages bcrypt password storage, JWT issuance (HS256 by project default), JWT secret rotation, refresh-token rotation, and email/reset-link issuance internally.

Because Supabase manages bcrypt, JWT signing/algorithms, refresh-token rotation, and one-time reset-token issuance internally, several checklist items reduce to "Not Applicable — managed by Supabase". The audit below focuses on what the **application code** controls: session storage on the client, cookie handling on the server, redirect URL hygiene, captcha enforcement, RLS/AuthZ via Supabase row-level security, validation, account deletion privilege handling, and logging.

---

## 1. Findings

### F-1. Session is stored in browser `localStorage` (default `@supabase/supabase-js` client), not HttpOnly cookies

- **Severity:** High
- **CWE:** CWE-922 (Insecure Storage of Sensitive Information), CWE-1004 (Sensitive Cookie Without HttpOnly Flag) — analogous
- **Evidence:**
  - `frontend/app/lib/supabase.ts:12` — `export const supabase = createClient(supabaseUrl, supabaseAnonKey);` (no `auth.storage`/`flowType`/cookie options; default storage is `window.localStorage`).
  - `frontend/app/context/AuthContext.tsx:72,82,93` — sessions are read with `supabase.auth.getSession()` / `getUser()` from this client-only object, confirming there is no SSR cookie persistence path through this client.
  - `frontend/app/auth/callback/route.ts:14–34` and `frontend/app/api/account/delete/route.ts:7–32` are the only places using `@supabase/ssr` `createServerClient` with `cookies()`, meaning only the OAuth code exchange and the delete endpoint hydrate cookies. All other auth happens client-side via `localStorage`.
- **Why it matters:** Access tokens and refresh tokens in `localStorage` are reachable by any XSS payload (an attacker can `localStorage.getItem('sb-…-auth-token')` and exfiltrate the refresh token, which Supabase will then rotate forever on the attacker's behalf). HttpOnly cookies prevent JS access entirely.
- **Exploitability:** Any reflected/stored/DOM XSS or compromised dependency in the bundle yields full account takeover (token theft + offline refresh).
- **Remediation snippet:**

```ts
// frontend/app/lib/supabase.ts — use the SSR-compatible browser client with cookie storage
import { createBrowserClient } from "@supabase/ssr";

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);
```

```ts
// frontend/app/lib/serverSupabase.ts — read same cookies on the server
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) =>
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, { ...options, httpOnly: true, secure: true, sameSite: "lax" })
          ),
      },
    }
  );
}
```

Also add `middleware.ts` (currently absent) calling `supabase.auth.getUser()` so the SSR token is refreshed and protected pages are gated server-side.
- **Defense-in-depth:** Strict CSP (no inline scripts, locked script-src), Subresource Integrity on third-party scripts, dependency scanning to reduce XSS blast-radius.

---

### F-2. No Next.js `middleware.ts` — protected routes are guarded only client-side

- **Severity:** High
- **CWE:** CWE-862 (Missing Authorization), CWE-602 (Client-Side Enforcement of Server-Side Security)
- **Evidence:**
  - `find frontend -name "middleware.*"` returns no file.
  - `frontend/app/account/page.tsx:36–40` — the only auth gate on `/account` is a client-side `useEffect` redirect: `if (!loading && !user) router.push("/auth/login");`. The page renders and ships before that runs.
  - `/portfolio` and other private pages similarly depend on the client `AuthContext` rather than SSR auth.
- **Why it matters:** A user who has not logged in (or a stale/expired session) still receives the protected route's HTML and any data the page fetches during render. Real authorization must be enforced server-side; in App Router that means `middleware.ts` + per-route server `getUser()` checks, plus RLS.
- **Exploitability:** Direct GET to a protected path returns server-rendered output; if any server-only data ever leaks via RSC props it becomes information disclosure. Today the saving grace is that almost everything is RLS-checked by Supabase, but the pattern is fragile.
- **Remediation snippet:**

```ts
// frontend/middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PROTECTED = [/^\/account/, /^\/portfolio/];

export async function middleware(req: NextRequest) {
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

export const config = { matcher: ["/account/:path*", "/portfolio/:path*"] };
```

- **Defense-in-depth:** Keep Supabase RLS as the ultimate gate; have each server route also call `getUser()` before returning user-specific data.

---

### F-3. RLS not visible on `profiles` or `portfolios` (Unable to verify)

- **Severity:** High (if RLS is in fact off) / Medium (if enabled but not in this repo)
- **CWE:** CWE-284 (Improper Access Control), CWE-639 (Authorization Bypass Through User-Controlled Key)
- **Evidence:**
  - `schema.sql:78–86` defines `public.profiles` and `schema.sql:40–48` defines `public.portfolios`, both referencing `auth.users(id)`. Neither table has any `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` statement anywhere in `schema.sql` or `migrations/`.
  - Only `migrations/create_box_recipes.sql:22–48` enables RLS and policies (for `box_recipes`).
  - The frontend exposes the anon key publicly (`frontend/app/lib/supabase.ts:12`, `serverSupabase.ts:18`) and queries `profiles` directly from the browser (`AuthContext.tsx:38–51`, `account/page.tsx:61–64`). Without RLS, any anon user could `select * from profiles` or `update profiles set username='x' where id='<any uuid>'` using the publishable anon key.
- **Why it matters:** RLS is the only authorization layer between the public anon key and tenant data. Missing RLS on `profiles` and `portfolios` is a complete tenant-isolation failure.
- **Exploitability (PoC if RLS off):**

```bash
curl "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/profiles?select=id,email,username" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_KEY"
# Returns every user's email if RLS is disabled.
```

- **Remediation snippet:**

```sql
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_self_select ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY profiles_self_insert ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY profiles_self_delete ON public.profiles
  FOR DELETE USING (auth.uid() = id);

ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;
CREATE POLICY portfolios_self_all ON public.portfolios
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.portfolio_holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY holdings_via_portfolio ON public.portfolio_holdings
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.portfolios p
                 WHERE p.id = portfolio_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.portfolios p
                      WHERE p.id = portfolio_id AND p.user_id = auth.uid()));

ALTER TABLE public.portfolio_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY lots_via_holding ON public.portfolio_lots
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.portfolio_holdings h
                 JOIN public.portfolios p ON p.id = h.portfolio_id
                 WHERE h.id = holding_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.portfolio_holdings h
                      JOIN public.portfolios p ON p.id = h.portfolio_id
                      WHERE h.id = holding_id AND p.user_id = auth.uid()));
```

- **Code that would prove status:** Output of `select tablename, rowsecurity from pg_tables where schemaname='public';` and `select * from pg_policies where schemaname='public';` (or run the Supabase MCP `get_advisors` security lints). Marked **Unable to verify** because no migration in this repo enables RLS for `profiles`/`portfolios`.

---

### F-4. Recovery flow accepts tokens from the URL fragment and trusts them client-side

- **Severity:** Medium
- **CWE:** CWE-598 (Use of GET Request Method With Sensitive Query Strings), CWE-1275 (Sensitive Cookie with Improper SameSite)
- **Evidence:** `frontend/app/auth/reset-password/page.tsx:36–53`

```ts
const hashParams = new URLSearchParams(window.location.hash.substring(1));
const accessToken = hashParams.get("access_token");
const type = hashParams.get("type");
if (accessToken && type === "recovery") {
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: hashParams.get("refresh_token") || "",
  });
  if (!error) setIsValidSession(true);
}
```

- **Why it matters:** The URL fragment is not transmitted to the server, but it lives in `window.location.hash`, in browser history, and can leak via `document.referrer`/extensions/`postMessage` if any third-party script runs after recovery. Supabase's modern PKCE flow goes through `/auth/callback?code=…` (see `auth/callback/route.ts:34`) where the code is exchanged server-side into HttpOnly cookies. Keeping both flows means the implicit-flow path is a soft-spot.
- **Remediation:** Configure Supabase project to issue PKCE recovery links, route to `/auth/callback?type=recovery&code=…`, and remove the implicit-token branch. The callback route already handles `type=recovery` (`auth/callback/route.ts:38–41`). After PKCE, the reset-password page only needs to verify a server session, not parse the hash.
- **Defense-in-depth:** Clear the hash immediately (`history.replaceState(null,'',location.pathname)`), require re-auth before showing the form, short Supabase recovery TTL (default 1h — tighten to 15m).

---

### F-5. Password reset uses `window.location.origin` for `redirectTo`

- **Severity:** Medium (Low if Supabase "Redirect URLs" allowlist is correctly configured)
- **CWE:** CWE-601 (Open Redirect)
- **Evidence:** `frontend/app/context/AuthContext.tsx:178–180`

```ts
const { error } = await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${window.location.origin}/auth/reset-password`,
});
```

- **Why it matters:** `redirectTo` is sent to Supabase from a client whose `origin` an attacker controls (e.g., if the user opens the forgot-password page from a phishing mirror, `origin` becomes the attacker's domain). Supabase rejects unknown origins only if you have explicitly listed allowed URLs in the dashboard ("Authentication → URL Configuration → Redirect URLs"). If the allowlist contains wildcards or is misconfigured, the reset email link sends users to the attacker's site bearing a recovery token in the hash.
- **Exploitability:** Phishing page that calls `resetPasswordForEmail` for a victim email with `redirectTo: 'https://evil.example/auth/reset-password'`. If allowlisted, email arrives with `…#access_token=…` to the attacker's page.
- **Remediation snippet:**

```ts
const ALLOWED_ORIGINS = new Set([
  "https://pokefin.ca",
  "https://www.pokefin.ca",
]);
const origin = ALLOWED_ORIGINS.has(window.location.origin)
  ? window.location.origin
  : "https://pokefin.ca";
await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${origin}/auth/callback?type=recovery&next=/auth/reset-password`,
});
```

Also: in the Supabase dashboard, set the "Site URL" + a small, explicit "Redirect URLs" list with no wildcards.
- **Defense-in-depth:** Same allowlist pattern for `emailRedirectTo` on signup (not currently set — Supabase falls back to Site URL, which is fine if Site URL is the production domain).

---

### F-6. `next` redirect allowlist in callback route is too permissive

- **Severity:** Low
- **CWE:** CWE-601 (Open Redirect)
- **Evidence:** `frontend/app/auth/callback/route.ts:11–12,43`

```ts
const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
…
return NextResponse.redirect(new URL(safeNext, request.url));
```

- **Why it matters:** The check blocks protocol-relative URLs (`//evil.com`) and absolute URLs but accepts `/\\evil.com` (back-slash) which some browsers normalize to a protocol-relative URL, and accepts `/anything?weird=…#…`. Acceptable for now; harden to a stricter regex/path-allowlist for defense-in-depth.
- **Remediation:**

```ts
const SAFE_PATH = /^\/(?!\/|\\)[A-Za-z0-9._~\-/?&=#%]*$/;
const safeNext = next && SAFE_PATH.test(next) ? next : "/";
```

Or maintain an explicit allowlist of known paths.

---

### F-7. Server route uses `@supabase/ssr` but does not write back refreshed cookies in the response

- **Severity:** Medium
- **CWE:** CWE-613 (Insufficient Session Expiration), CWE-384 (Session Fixation) — adjacent
- **Evidence:** `frontend/app/api/account/delete/route.ts:7–32` and `frontend/app/auth/callback/route.ts:14–34` both use `cookieStore.set(...)` inside `setAll`. In a Route Handler, `next/headers#cookies()` is read-only for the current response unless you return a `NextResponse` that carries those cookies. The callback route returns a fresh `NextResponse.redirect(...)` (line 43) without piping the just-written cookies, so the `Set-Cookie` headers from Supabase's session exchange may not reach the browser. The delete route returns `NextResponse.json` (line 92) similarly without forwarding cookies.
- **Why it matters:** Refreshed/new auth cookies can be silently dropped, which can lead to repeated re-login or — worse — to the SDK falling back to localStorage and never adopting cookie-based auth at all. It also breaks the SSR session-validation pattern needed by F-1/F-2.
- **Remediation snippet (callback):**

```ts
const response = NextResponse.redirect(new URL(safeNext, request.url));
const supabase = createServerClient(URL, KEY, {
  cookies: {
    getAll: () => request.cookies.getAll(),
    setAll: (toSet) =>
      toSet.forEach(({ name, value, options }) =>
        response.cookies.set(name, value, options)
      ),
  },
});
await supabase.auth.exchangeCodeForSession(code);
return response;
```

- **Defense-in-depth:** Standardize a `getServerSupabase(req, res)` helper used by every route handler/middleware, then mutate `res.cookies` only.

---

### F-8. Account deletion is correctly gated but logs PII details

- **Severity:** Low
- **CWE:** CWE-532 (Insertion of Sensitive Information into Log File)
- **Evidence:** `frontend/app/api/account/delete/route.ts:47, 75, 84` — `console.error("Failed to delete auth user:", deleteError)` and `console.warn("SUPABASE_SERVICE_ROLE_KEY not set …")`. Combined with `AuthContext.tsx:54,60,152` which log profile-creation/fetch failures. Errors are objects (not raw passwords/tokens), but on Vercel they end up in build/runtime logs and can include PostgREST messages containing user IDs and emails. The warning at line 84 also leaks operational config (which key is/isn't set) to logs.
- **Why it matters:** Aggregated logs become PII repositories and reveal infra state.
- **Remediation:** Strip identifying fields before logging; gate verbose error logs behind `NODE_ENV !== "production"`; never log presence/absence of secrets.

```ts
if (process.env.NODE_ENV !== "production") {
  console.error("delete_profile_failed", { code: profileError.code });
}
```

---

### F-9. Account-delete route lacks CSRF protection and re-authentication step

- **Severity:** Medium
- **CWE:** CWE-352 (CSRF), CWE-306 (Missing Authentication for Critical Function — reauth)
- **Evidence:** `frontend/app/api/account/delete/route.ts:6–93` accepts `DELETE` based solely on the session cookie. There is no SameSite enforcement done at the app layer, no Origin/Referer check, no anti-CSRF token, and no fresh-credential check (e.g., recent password re-entry).
- **Why it matters:** Supabase cookies default to `SameSite=Lax`, which blocks third-party `fetch` CSRF for state-changing methods in modern browsers, so the practical risk is reduced — but defense-in-depth for a destructive action (and for older browsers/extensions) is warranted. More importantly, deletion is a high-impact action that should require recent authentication.
- **Remediation snippet:**

```ts
// 1) Origin check
const origin = request.headers.get("origin");
const ALLOWED = new Set(["https://pokefin.ca", "https://www.pokefin.ca"]);
if (!origin || !ALLOWED.has(origin)) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// 2) Require fresh re-auth: client posts current password in body, server re-verifies
const { password } = await request.json();
const { error: reauthErr } = await supabase.auth.signInWithPassword({
  email: user.email!,
  password,
});
if (reauthErr) return NextResponse.json({ error: "Re-auth required" }, { status: 401 });
```

- **Defense-in-depth:** Server-stored short-lived "step-up" token (cookie) issued only after a recent password prompt.

---

### F-10. Username update is client-side only with no server validation

- **Severity:** Low
- **CWE:** CWE-20 (Improper Input Validation), CWE-915 (Mass Assignment) — partial
- **Evidence:** `frontend/app/account/page.tsx:61–64`

```ts
const { error } = await supabase.from("profiles").update({ username }).eq("id", user!.id);
```

- The client picks both the field name and value; only the JS form validates length/regex (`account/page.tsx:47–57`). The same is true for profile inserts in `AuthContext.tsx:46–51` and `AuthContext.tsx:144–150`.
- **Why it matters:** A user can update `username` to anything (including extremely long strings, emoji, or HTML/JS for stored-XSS) by calling PostgREST directly with their JWT. Today this is limited by the schema not having a `role` column, so escalation isn't possible, but rendering of arbitrary usernames in `Header.tsx:128` and `account/page.tsx` is sanitization-dependent.
- **Remediation:** Move validation to a Postgres trigger/`CHECK` constraint and an RLS policy.

```sql
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format
  CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_]{3,32}$');

CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
```

Add an explicit allowlist of updatable columns in any future server-side update path (e.g., `update({ username }).select('id, username')` — never `update(req.body)`).
- **Defense-in-depth:** Render usernames with React's default escaping only (already the case) and add a CSP `script-src 'self'`.

---

### F-11. Hard-coded 8-character password policy; no upper bound; no breach check

- **Severity:** Low
- **CWE:** CWE-521 (Weak Password Requirements)
- **Evidence:** `auth/signup/page.tsx:63–66`, `auth/reset-password/page.tsx:89–92`, `account/page.tsx:90–93` all enforce only `password.length < 8`. Supabase project minimum is also typically 6–8 by default.
- **Why it matters:** 8-char is below current OWASP guidance (12+ when no MFA) and there's no maximum (Supabase caps at 72 due to bcrypt internally; the form doesn't communicate that, leading to silent truncation if Supabase is configured for plain bcrypt).
- **Remediation:** Raise the minimum to 12 characters, ban common passwords (e.g., `zxcvbn` or HIBP k-anonymity API), and document the 72-byte bcrypt limit. Configure Supabase: `Auth → Policies → Password minimum length = 12`, enable "Leaked password protection".

---

### F-12. Captcha token is sent but not provably verified

- **Severity:** Low (Not Applicable to app — depends on Supabase project setting)
- **CWE:** CWE-799 (Improper Control of Interaction Frequency)
- **Evidence:** `auth/login/page.tsx:103–106`, `auth/signup/page.tsx:178–181` collect a Turnstile token. `AuthContext.tsx:131–168` passes it to Supabase via `options.captchaToken`. Verification happens inside Supabase if the project has "Bot and Abuse Protection" enabled.
- **Why it matters:** If the Supabase project doesn't have Turnstile configured with the same site key, the token is ignored and brute-force protection is lost. Forgot-password (`auth/forgot-password/page.tsx`) does **not** include a captcha at all.
- **Remediation:** Configure Supabase project with the matching Turnstile secret key; add a Turnstile widget to `forgot-password` and the password-reset/account-delete flows. Mark as Pass once verified in Supabase dashboard.

---

### F-13. No application-level rate limiting on auth endpoints

- **Severity:** Medium (Not Applicable to app — depends on Supabase project setting)
- **CWE:** CWE-307 (Improper Restriction of Excessive Authentication Attempts)
- **Evidence:** No middleware, no `Upstash`/`@vercel/kv`-style limiter is present (`grep -r "rate.*limit\|ratelimit" frontend` returns nothing). Supabase provides per-project rate limits for `/auth/v1/token`, `/auth/v1/recover`, etc., configurable in the dashboard.
- **Why it matters:** Without app-side limits, the only floor is Supabase's defaults. The custom `/api/account/delete` endpoint has no limiter at all (a hostile authenticated bot can be DOS'd by repeatedly invoking `auth.admin.deleteUser` failures).
- **Remediation:** Add Upstash limiter on `/api/account/delete` and on any future custom auth routes; verify Supabase's "Rate Limits" page sets sensible per-IP and per-user caps; tighten reset email rate (default 60s) to ≥120s and per-account caps.

---

### F-14. Profile pre-creation in `signUp` will fail without RLS / unauthenticated context

- **Severity:** Informational / Low
- **Evidence:** `frontend/app/context/AuthContext.tsx:143–155` — directly after `supabase.auth.signUp`, while email confirmation is still pending and the user has no JWT, the client tries to `insert` into `profiles`. With proper RLS (`auth.uid() = id`), this insert will fail because there is no session yet. The fallback at lines 47–51 is also unauthenticated-anon-key territory and will fail under RLS. The proper pattern is a Postgres trigger on `auth.users`.
- **Why it matters:** Either profiles are being created with the anon role today (proves missing RLS — see F-3), or they fail silently and the user logs in to a partial state.
- **Remediation snippet:**

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'username');
  RETURN NEW;
END;$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

Then drop the client-side `profiles.insert` in `AuthContext.tsx`.

---

### F-15. `serverSupabase.ts` is server-only but disables session/refresh — used by zero callers

- **Severity:** Informational
- **Evidence:** `frontend/app/lib/serverSupabase.ts:14–24` exports `createServerSupabaseClient()` with `persistSession: false, autoRefreshToken: false`. `grep -r "createServerSupabaseClient\|serverSupabase" frontend` shows no importers. The real server routes (`auth/callback/route.ts`, `api/account/delete/route.ts`) instead inline `createServerClient` from `@supabase/ssr`.
- **Why it matters:** Dead code that may mislead future developers into believing there is a SSR pattern. Either delete it or refactor every server route to use it (preferred).

---

### F-16. Sign-up confirmation page leaks account existence

- **Severity:** Informational (Low)
- **CWE:** CWE-204 (Observable Response Discrepancy)
- **Evidence:** `auth/signup/page.tsx:81–105` always shows "Check your email" on success but Supabase by default returns an error for already-registered emails (visible at line 72–74 as a red banner). The forgot-password page (`auth/forgot-password/page.tsx:42–64`) correctly uses a generic "If an account exists…" message.
- **Why it matters:** A response oracle (different success vs error banner for signup) lets an attacker enumerate registered emails.
- **Remediation:** Configure Supabase "Confirm signup" to obscure existing-email errors (enable "Email obfuscation"); always show the same neutral page on signup attempts.

---

### F-17. Reset-password screen does not invalidate other sessions

- **Severity:** Low
- **CWE:** CWE-613 (Insufficient Session Expiration)
- **Evidence:** `auth/reset-password/page.tsx:96–98` and `account/page.tsx:97` call `supabase.auth.updateUser({ password })`. Supabase rotates the current refresh token but, depending on project config, may not revoke *other* sessions/devices.
- **Remediation:** After successful password change, call `supabase.auth.signOut({ scope: "others" })` (v2 SDK) on the same client, and consider configuring Supabase "Sign out users on password change" (project setting).

---

## 2. Risk Score

**Overall residual risk: 7 / 10** — dominated by the combination of localStorage token storage (F-1), absent server-side route protection / middleware (F-2), and the unverified RLS state on `profiles`/`portfolios` (F-3). Any one of these alone is a material risk; together they form a credible chain to tenant data exposure.

---

## 3. Top 5 Prioritized Fixes

1. **Verify and enable RLS** on `profiles`, `portfolios`, `portfolio_holdings`, `portfolio_lots` with `auth.uid()`-bound policies (F-3, F-14). Highest impact, lowest implementation cost.
2. **Move sessions to HttpOnly cookies** via `@supabase/ssr`'s `createBrowserClient` + `createServerClient`, and add `frontend/middleware.ts` that refreshes the session and gates `/account`, `/portfolio` (F-1, F-2, F-7).
3. **Lock down redirect URLs**: hardcode an origin allowlist for `resetPasswordForEmail` and harden the `?next=` regex in `auth/callback/route.ts`; configure Supabase "Redirect URLs" to the production domain only (F-5, F-6).
4. **Harden the account-delete route**: Origin check + recent-password re-auth + rate limit; redact logs (F-8, F-9, F-13).
5. **Replace client-side profile creation with a Postgres trigger** and add `CHECK` constraints for `username` (F-10, F-14); raise password min to 12 chars and enable leaked-password protection (F-11).

---

## 4. Checklist Diff

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Password hashing (bcrypt rounds, async, no double-hash, compare) | Not Applicable — managed by Supabase | App never sees plaintext after submit. |
| 2 | JWT secret/key strength & storage | Not Applicable — managed by Supabase | HS256 by default; rotation is a project-level operation (see F-20). |
| 3 | Token settings (TTL, alg/iss/aud/sub/jti/iat/exp/nbf) | Not Applicable — managed by Supabase | Project-level TTLs; verify in dashboard. |
| 4 | Refresh token implementation (rotation, reuse, cookie flags, hashed at rest) | **Fail** | Refresh tokens live in `localStorage` (F-1); rotation/reuse-detection is by Supabase but defeated by XSS. No HttpOnly cookie path in client SDK init. |
| 5 | Session invalidation on password change/reset | **Partial Fail** | App does not call `signOut({ scope: "others" })` (F-17). |
| 6 | Brute-force protection (rate limit, backoff, captcha) | **Partial** | Turnstile on login/signup only, not on forgot-password/reset/account-delete (F-12, F-13). Unable to verify Supabase rate-limit dashboard settings. |
| 7 | Account enumeration defenses | **Partial Fail** | Signup leaks existence via error banner (F-16); forgot-password is fine. |
| 8 | Password reset flow (cryptographic token, hashed at rest, ≤30m TTL, one-time use, throttle email) | Not Applicable — managed by Supabase | App relies on Supabase recovery tokens. Verify TTL ≤ 30m in dashboard. Implicit-flow hash token used (F-4). |
| 9 | Email verification (one-time, short TTL, server-verified, no mass-assignment) | Not Applicable — managed by Supabase | Confirmation enforced at signup (signup page shows "Check your email"). |
| 10 | SQL/NoSQL injection in auth paths | **Pass** | All DB access goes through PostgREST via the Supabase client (parameterized). No raw SQL strings in app code. |
| 11 | AuthZ integrity (roles loaded server-side, deny-by-default, DB check for sensitive ops) | **Fail** | Protected routes guarded client-side only (F-2); no `middleware.ts`; `profiles`/`portfolios` RLS unverified (F-3). |
| 12 | Cookie & CSRF configuration | **Fail** | Auth cookies are not used by the client SDK (F-1). Account-delete lacks Origin/CSRF check (F-9). SameSite/HttpOnly flags depend on `@supabase/ssr` defaults — not explicitly set. |
| 13 | Input validation & normalization | **Partial** | Username regex + 8-char password client-side only (F-10, F-11). No email normalization (lowercasing) before signUp/signIn. No zod/joi anywhere. |
| 14 | Mass assignment risks | **Partial Fail** | Client-side `profiles.update({ username })` works on any field client picks (F-10); future schema columns (e.g., `role`) would be writable unless RLS/`WITH CHECK` constrains. |
| 15 | JWT misuse (no jwt.decode for authz, always verify with explicit algorithms) | **Pass** | App never decodes JWTs; uses `supabase.auth.getUser()` which verifies against Supabase. |
| 16 | Logging & telemetry (no passwords/tokens/reset links/PII in logs) | **Partial Fail** | `console.error/warn` of full Supabase error objects in three places (F-8). No redaction layer. |
| 17 | Dependency & crypto hygiene | **Pass-ish** | `@supabase/supabase-js ^2.50.0`, `@supabase/ssr ^0.8.0` are current. No `jsonwebtoken`/`bcrypt`/`MD5` usage. No custom JWT parser. |
| 18 | Transport & CORS | **Unable to verify** | No `cors` config or `headers()` in `next.config.ts`. HTTPS enforced by Vercel/host. No wildcard credentials observed. Supabase REST endpoint enforces its own CORS. |
| 19 | Open redirect / `next` param | **Pass with caveats** | Callback route validates `?next=` (F-6 harden suggested). Reset-password uses `window.location.origin` (F-5). |
| 20 | Operational controls (secret rotation, env key separation, monitoring, RT reuse alerts) | **Partial** | Service-role key is referenced and gated behind `if (serviceRoleKey)` (`delete/route.ts:55-87`) — good. No monitoring/alerting on auth events in app. Public anon key correctly used in client. Supabase `SUPABASE_SERVICE_ROLE_KEY` must never leak to client; the `serverSupabase.ts` file currently uses anon key, which is correct, but the variable name `NEXT_PUBLIC_SUPABASE_KEY` for an anon key is intentional. |

---

## 5. Bonus Hardening

- **PKCE everywhere:** Configure Supabase Auth to use `flowType: "pkce"` in the browser client; this eliminates the implicit-flow hash tokens in F-4 entirely.
- **CSP + Trusted Types:** `Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'` mitigates F-1's XSS blast radius.
- **HSTS preload, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`** — add via `next.config.ts` `headers()`.
- **Asymmetric JWT (RS256/ES256)** — Supabase now supports keypair-based JWTs; enable in project so the public verify-key can be cached at the edge without sharing the HS256 secret.
- **`jti` deny-list** for stolen tokens (Supabase + KV); cron sweeps to revoke compromised refresh tokens.
- **Active session UI** on `/account`: list devices/sessions with revoke; backed by `supabase.auth.admin.listUserSessions` via a privileged server route.
- **Step-up authentication** (recent password / WebAuthn) for delete-account and email change.
- **Audit log** of auth events shipped to a dedicated sink (Supabase Logflare / Logtail) with PII scrubbing.
- **Email change** flow currently isn't implemented in the app; when adding it, require double-confirmation (old + new email) and invalidate sessions.

---

## 6. Quick Tests to Validate Fixes

Run these after applying the remediations:

```bash
# 1) RLS — should return 401/empty as anon
curl -s "$SUPABASE_URL/rest/v1/profiles?select=id,email" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" | jq

# 2) Middleware gate — should 307 to /auth/login
curl -i https://pokefin.ca/account

# 3) HttpOnly cookies — after login, check Set-Cookie attributes
curl -i -c cookies.txt -X POST https://pokefin.ca/auth/v1/token?grant_type=password \
  -d '{"email":"u@e.com","password":"…"}'
grep -i "set-cookie:.*HttpOnly.*Secure.*SameSite=Lax" cookies.txt

# 4) Open redirect — should redirect to "/"
curl -i "https://pokefin.ca/auth/callback?code=…&next=/\\evil.com"

# 5) Account-delete CSRF — must 403 without matching Origin
curl -i -X DELETE https://pokefin.ca/api/account/delete \
  -H "Origin: https://evil.example" -H "Cookie: <victim-session>"

# 6) Password policy — UI rejects 11-char, accepts 12-char.

# 7) Sign-up enumeration — same neutral response for existing and new emails.

# 8) Reset link domain — confirm Supabase rejects redirectTo not in allowlist.

# 9) Other-session invalidation — log in on browser A and B; change password on A;
#    refresh on B should land on /auth/login.

# 10) Logs — search Vercel runtime logs for "delete_profile_failed" — no PII present.
```

---

## 7. Files Reviewed

- `/home/user/Pokefin/frontend/app/lib/supabase.ts`
- `/home/user/Pokefin/frontend/app/lib/serverSupabase.ts`
- `/home/user/Pokefin/frontend/app/context/AuthContext.tsx`
- `/home/user/Pokefin/frontend/app/auth/login/page.tsx`
- `/home/user/Pokefin/frontend/app/auth/signup/page.tsx`
- `/home/user/Pokefin/frontend/app/auth/callback/route.ts`
- `/home/user/Pokefin/frontend/app/auth/reset-password/page.tsx`
- `/home/user/Pokefin/frontend/app/auth/forgot-password/page.tsx`
- `/home/user/Pokefin/frontend/app/api/account/delete/route.ts`
- `/home/user/Pokefin/frontend/app/account/page.tsx`
- `/home/user/Pokefin/frontend/app/components/Header.tsx`
- `/home/user/Pokefin/frontend/app/layout.tsx`
- `/home/user/Pokefin/frontend/next.config.ts`
- `/home/user/Pokefin/frontend/package.json`
- `/home/user/Pokefin/schema.sql`
- `/home/user/Pokefin/migrations/create_box_recipes.sql`
- `/home/user/Pokefin/migrations/20260506_market_performance_functions.sql`
- (No `frontend/middleware.ts` — confirmed absent)

**Items marked "Unable to verify"** require either Supabase dashboard inspection or a `supabase.list_policies` / `get_advisors` query against the live project: RLS state of `profiles`/`portfolios`/`portfolio_holdings`/`portfolio_lots`, Supabase Auth rate-limit values, Site URL + Redirect URLs allowlist, password minimum / leaked-password setting, Turnstile project configuration, JWT TTLs, "Sign out users on password change" toggle.
