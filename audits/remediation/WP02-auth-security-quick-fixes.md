# WP02: Auth and security quick fixes

- **Findings covered**
  - F077 (full, cluster members F017, F077): `classifyRoute` puts every `/auth/*` page GET and RSC prefetch in the 5/min "sensitive" bucket (a cold homepage load spends 4 of 5 tokens and locks logged-out visitors out of login), while the credential POSTs under `/api/auth/*` get the loose 60/min "general" bucket.
  - F019 (full): the captcha token is optional in the sign-in and sign-up routes, forgot-password renders no Turnstile widget and sends no token, and a consumed token is reused after a failed submit.
  - F079 (full): `resetPasswordForEmail` passes no `redirectTo`, `/auth/callback` routes to the reset form only on a `type=recovery` query parameter that PKCE links never carry, ignores the exchange result, and the browser client still auto-exchanges any `?code=` it sees (`detectSessionInUrl` defaults to true; two F079 verifiers ask to turn it off).
  - F024 (full, cluster members F024, F098): forms enforce and advertise 8-character passwords while Supabase enforces 12, raw backend error strings reach the UI, and no auth input has an `autoComplete` attribute.
  - F132 (full, cluster members F130, F132): the sign-up route forwards any username string to Supabase with no validation, so a malformed or taken username becomes an opaque "Database error saving new user" 500; every `/api/auth/*` route echoes `error.message`.
  - F075 (full): `next.config.ts` still lets the `/_next/image` optimizer fetch from any `*.supabase.co` and `*.tcgplayer.com` host, although the app never uses the optimizer.
  - F078 (full): password change on `/account` requires only a live session. Per the F078 verifiers, this PR adds a "Current password" field to the `/account` form and forwards it to GoTrue as `current_password` (supported by the installed auth-js 2.112.2, `lib/types.d.ts:423`); GoTrue enforces it once the owner enables the "require current password" option (owner action 6), and skips it for recovery sessions, so `/auth/reset-password` is unchanged. The GoTrue error codes for a missing or wrong current password, and for "Secure password change" (the fallback toggle), map to clear messages. No `signInWithPassword` probe, no `signOut({ scope: "others" })`, no cookie `maxAge` change (all rejected by the verifiers).
- **Priority rationale**: these are the cheapest fixes on the path every visitor and account holder uses (sign in, sign up, reset password), two of them are user-visible failures today (login lockout, password reset), and the credential endpoint has 12 times the intended brute-force budget.
- **Effort**: M, about 7 to 9 hours including tests, plus about 45 minutes of owner time in Supabase and Vercel.
- **Depends on**: WP00 (for `pnpm build:stub`). If WP00 has not landed, skip the `pnpm build:stub` step in Verification and say so in the PR description; everything else still applies.
- **Unblocks**: WP04 (it edits `AuthContext.tsx` and `account/page.tsx` after this PR). WP13 builds on the `?error=auth_link` redirect added here and moves `safeNextPath` to `app/lib/redirects.ts`.
- **Names later packages rely on** (keep them exactly): the reset route is `POST /api/auth/forgot-password` (WP04's fallback text calls it `reset-password`; WP04 skips its own route because `AuthContext` no longer calls `resetPasswordForEmail`); username rules live in `app/lib/validation.ts` as `USERNAME_RE`, `USERNAME_MAX_LENGTH`, `USERNAME_FORMAT_MESSAGE` (WP04's "rules message"); `AuthContext.updatePassword(newPassword, currentPassword?)` sends `{ password, currentPassword }` (WP04 step 5 shows the old one-argument version; WP04 must keep this signature and body when it rewrites the file, and the PR description must say so); callback constants `RESET_PASSWORD_PATH` and `AUTH_LINK_FAILED_PATH` (WP13, WP20); `turnstileRef` in the login page (WP13 greps for it).
- **Suggested branch name**: `remediation/wp02-auth-security-quick-fixes`
- **Risk level**: medium. It touches every auth route and the login, signup and reset pages; a mistake here can block sign-in for everyone. Route tests, a proxy test and a manual end-to-end reset mitigate it. No migrations.

## Why

Today a logged-out visitor who opens the homepage, then the login page, then refreshes once can get a bare "Too Many Requests" page, because every `/auth/*` page load and every background link prefetch spends the 5-per-minute budget meant for credential abuse. Meanwhile the actual password endpoint (`POST /api/auth/sign-in`) allows 60 attempts per minute. Password reset is wired only through dashboard configuration: the app sends no captcha token (so, with Supabase captcha on, reset fails for everyone) and no `redirectTo` (so the link lands on the homepage, not the reset form). New users are told "At least 8 characters", then rejected by Supabase with "Password should be at least 12 characters", and a taken username produces an unexplained server error. After this PR, auth pages are never rate limited while the four credential endpoints get 10 attempts per minute per IP per endpoint, captcha is required in code on every credential route, the reset email is sent by a server route with an explicit callback URL, every form enforces 12-character passwords and 3 to 32 character usernames with password-manager hints, every Supabase auth error reaches the user as a fixed, friendly string, changing the password on `/account` asks for the current password, and the unused image optimizer endpoint is switched off.

## Before you start

Read these files fully before editing:

- `frontend/app/lib/rateLimit.ts` (89 lines) and `frontend/app/lib/__tests__/rateLimit.test.ts` (89 lines)
- `frontend/proxy.ts` (101 lines; the limiter runs first at lines 29-36, matcher at 94-101)
- `frontend/app/api/auth/sign-in/route.ts` (55 lines), `sign-up/route.ts` (60), `update-password/route.ts` (48), `me/route.ts`, `sign-out/route.ts`
- `frontend/app/api/account/export/route.ts` (the CSRF-gated route pattern; do not edit it here)
- `frontend/app/lib/csrf.ts`, `frontend/app/lib/routeSupabase.ts`, `frontend/app/lib/logger.ts`, `frontend/app/lib/cookieOptions.ts`, `frontend/app/lib/validation.ts`
- `frontend/app/auth/callback/route.ts` (67 lines)
- `frontend/app/auth/login/page.tsx`, `signup/page.tsx`, `forgot-password/page.tsx`, `reset-password/page.tsx`
- `frontend/app/account/page.tsx:84-113` (password handler) and `:256-320` (password form), plus the three other error `<div>`s at `:234-238` (username), `:331-333` (export) and `:352-356` (delete), which only get `role="alert"`. Do NOT change the username handler (`:46-82`) or any other part of the username form (`:214-253`); WP04 owns them.
- `frontend/app/lib/supabase.ts` (25 lines) and `frontend/app/lib/__tests__/supabase.test.ts:63-67` (asserts the exact client options)
- `frontend/app/context/AuthContext.tsx` (230 lines) and `frontend/app/context/__tests__/AuthContext.test.tsx` (309 lines)
- `frontend/next.config.ts:51-77`
- `frontend/app/components/ProductPrices/shared/ProductImage.tsx:93-106` (the only `next/image` use; already `unoptimized`)
- `migrations/0003_integrity_constraints.sql:66-68` (the username CHECK this PR mirrors), `schema.sql:80` (`username text UNIQUE`) and `migrations/0004_handle_new_user_trigger.sql` (the trigger whose failure GoTrue reports as a 500 "Database error saving new user")
- `frontend/node_modules/.pnpm/@supabase+auth-js@2.112.2/node_modules/@supabase/auth-js/dist/module/lib/fetch.js:21-44` (a GoTrue 500 becomes `AuthRetryableFetchError` with `status: 500` and NO `code`; only 4xx errors carry `code`)
- `audits/HARDENING_FOLLOWUPS.md:67-104` (dashboard settings table and the rate-limit section you will update)
- `frontend/node_modules/@marsidev/react-turnstile/dist/index.d.ts:212-221` (`TurnstileInstance.reset`) and `:328-356` (`onExpire`, `onError`)
- `frontend/node_modules/.pnpm/@supabase+auth-js@2.112.2/node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts` (the GoTrue error codes mapped below)

Confirm the starting state (run from `frontend/`):

```bash
# 1. /auth/* pages are "sensitive" and /api/auth/* is "general" (F077).
sed -n '66,78p' app/lib/rateLimit.ts
# expect: sensitive limit 5; `if (pathname.startsWith("/auth/")) return "sensitive";`

# 2. The proxy keys buckets by class and IP only.
grep -n 'rateLimit(`' proxy.ts
# expect: proxy.ts:34  const result = rateLimit(`${routeClass}:${ip}`, limit, windowMs);

# 3. Captcha is optional and error.message is echoed (F019, F132).
grep -n "captchaToken\|error.message" app/api/auth/*/route.ts
# expect: `: undefined;` for captchaToken in sign-in and sign-up, and `{ error: error.message }` in sign-in, sign-up, update-password

# 4. Browser-side reset with no options (F019, F079).
grep -n "resetPasswordForEmail" app/context/AuthContext.tsx
# expect: AuthContext.tsx:184  await supabase.auth.resetPasswordForEmail(email);

# 5. The callback keys off type=recovery and ignores the exchange result (F079).
grep -n 'type === "recovery"\|exchangeCodeForSession' app/auth/callback/route.ts
# expect: lines 33 and 63

# 6. 8-character rule in three places, no autoComplete anywhere (F024).
grep -rn "length < 8\|At least 8" app | grep -v __tests__
grep -rn "autoComplete" app | grep -v __tests__ | wc -l
# expect: 6 lines (signup 63/162, reset-password 53/157, account 94/279), then 0

# 7. Wildcard image hosts, and the optimizer is used nowhere (F075).
sed -n '53,73p' next.config.ts
grep -rn "next/image\|_next/image" app --include=*.ts --include=*.tsx | grep -v __tests__
# expect: remotePatterns with **.tcgplayer.com and **.supabase.co; only ProductImage.tsx imports next/image

# 8. No /api/auth/forgot-password route and no route tests yet.
ls app/api/auth
ls app/api/auth/__tests__ app/auth/callback/__tests__ 2>&1 | head -2
# expect: me sign-in sign-out sign-up update-password; "No such file or directory" twice

# 9. The browser client still auto-exchanges ?code= (F079).
grep -n "flowType" app/lib/supabase.ts
# expect: app/lib/supabase.ts:24  auth: { flowType: "pkce" },

# 10. Lint baseline for the files you will touch (record the count; it must not grow).
pnpm exec eslint proxy.ts next.config.ts app/lib app/api/auth app/auth app/account/page.tsx app/context 2>&1 | tail -3
```

Assumptions to check:

- WP03 may have landed first and changed "refreshed hourly" copy or `Header.tsx`. This PR does not touch `Header.tsx`, `Footer.tsx` or any copy outside the auth forms, so there is no conflict.
- If WP04 has already landed (it should not; it depends on this WP), `AuthContext.tsx` no longer imports `supabase`, and the account username form posts to a route. Apply steps 11 and 16 to the current code: change only `resetPassword`, `updatePassword` and the password section.
- WP01 lands before this PR and edits the export handler and export error text in `account/page.tsx` (`:115-140`, `:331-339`). Step 16 only adds `role="alert"` to the export error `<div>`; keep whatever text WP01 left.
- If line numbers differ, match on the quoted code, not the number.

## Implementation steps

Do the steps in order. Steps 1 to 3 create shared modules the later steps import.

### 1. `frontend/app/lib/validation.ts`: add password and username rules

Append after `RECIPE_PACKS_MAX` (line 16), before `isFiniteInRange`:

```ts
/**
 * Password rule. Mirrors Supabase Auth > Password Security > "Minimum
 * password length" (audits/HARDENING_FOLLOWUPS.md section 2). Supabase
 * stays the authority; this copy lets the forms and the /api/auth/*
 * routes reject short passwords before a round trip.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_HINT = `At least ${PASSWORD_MIN_LENGTH} characters`;
export const PASSWORD_TOO_SHORT_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;

/**
 * Username rule. Mirrors CHECK profiles_username_format in
 * migrations/0003_integrity_constraints.sql:66-68. Keep all three in sync.
 */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/;
export const USERNAME_HINT = "3 to 32 characters: letters, numbers, and underscores";
export const USERNAME_FORMAT_MESSAGE =
  "Username must be 3 to 32 characters and use only letters, numbers, and underscores.";

export function isValidUsername(s: unknown): s is string {
  return typeof s === "string" && USERNAME_RE.test(s);
}
```

Why here: `validation.ts` is already the shared, dependency-free module that mirrors DB CHECK constraints (see its header comment, lines 1-8), and it is imported by both client pages and routes. WP04 will import `USERNAME_RE` / `isValidUsername` from here for the account username form; do not create a separate `username.ts`.

### 2. `frontend/app/lib/authErrors.ts` (new file): fixed allowlist of auth messages

```ts
/**
 * Map Supabase Auth (GoTrue) errors to a fixed allowlist of user-facing
 * messages. Every /api/auth/* route returns one of these strings instead
 * of `error.message`, so the UI never shows raw backend wording and a
 * future SDK or server change cannot put new text in front of users.
 * Log the original with logSupabaseError before calling mapAuthError.
 *
 * Mapping is by `error.code` (stable GoTrue codes, see
 * @supabase/auth-js lib/error-codes.d.ts), never by message text.
 *
 * Pure module: it must not import next/server, so it can be unit-tested
 * in the default jsdom Jest environment.
 */
import { PASSWORD_TOO_SHORT_MESSAGE, USERNAME_FORMAT_MESSAGE } from "./validation";

export const AUTH_MESSAGES = {
  generic: "Something went wrong. Please try again.",
  invalidInput: "Please check the details you entered and try again.",
  captchaRequired: "Please complete the captcha check and try again.",
  captchaFailed: "The captcha check failed or expired. Please complete it again.",
  invalidCredentials: "Incorrect email or password.",
  emailNotConfirmed:
    "Please confirm your email address first. Check your inbox for the confirmation link.",
  weakPassword: PASSWORD_TOO_SHORT_MESSAGE,
  samePassword: "Your new password must be different from your current password.",
  userExists: "An account with this email already exists. Try signing in instead.",
  invalidEmail: "Please enter a valid email address.",
  invalidUsername: USERNAME_FORMAT_MESSAGE,
  usernameUnavailable:
    "We could not create your account. That username may already be taken, so please choose another one.",
  rateLimited: "Too many attempts. Please wait a minute and try again.",
  emailRateLimited: "Too many emails requested. Please wait a few minutes and try again.",
  signupDisabled: "New sign-ups are temporarily disabled.",
  sessionExpired: "Your session has expired. Please sign in again.",
  currentPasswordRequired: "Please enter your current password.",
  currentPasswordIncorrect: "Your current password is incorrect.",
  reauthenticationNeeded:
    "For your security, please sign out, sign in again, and then change your password.",
} as const;

export type AuthMessageKey = keyof typeof AUTH_MESSAGES;
export type AuthErrorContext = "sign_in" | "sign_up" | "update_password" | "forgot_password";

export interface MappedAuthError {
  status: number;
  body: { error: string; code: AuthMessageKey };
}

const BY_CODE: Record<string, { key: AuthMessageKey; status: number }> = {
  invalid_credentials: { key: "invalidCredentials", status: 401 },
  email_not_confirmed: { key: "emailNotConfirmed", status: 400 },
  captcha_failed: { key: "captchaFailed", status: 400 },
  weak_password: { key: "weakPassword", status: 422 },
  same_password: { key: "samePassword", status: 422 },
  user_already_exists: { key: "userExists", status: 422 },
  email_exists: { key: "userExists", status: 422 },
  email_address_invalid: { key: "invalidEmail", status: 400 },
  validation_failed: { key: "invalidInput", status: 400 },
  over_request_rate_limit: { key: "rateLimited", status: 429 },
  over_email_send_rate_limit: { key: "emailRateLimited", status: 429 },
  signup_disabled: { key: "signupDisabled", status: 403 },
  session_not_found: { key: "sessionExpired", status: 401 },
  session_expired: { key: "sessionExpired", status: 401 },
  refresh_token_not_found: { key: "sessionExpired", status: 401 },
  bad_jwt: { key: "sessionExpired", status: 401 },
  no_authorization: { key: "sessionExpired", status: 401 },
  // Returned once the owner enables "require current password" (F078,
  // owner action 6). Not in auth-js 2.112.2's ErrorCode union, so they are
  // plain strings here; GoTrue answers 400 for both.
  current_password_required: { key: "currentPasswordRequired", status: 400 },
  current_password_mismatch: { key: "currentPasswordIncorrect", status: 400 },
  // Returned if the owner uses the fallback "Secure password change" toggle
  // and the session is older than 24 hours (F078 owner action 6). 400, not
  // 401: the session is valid, and WP04's AuthContext treats 401 as signed out.
  reauthentication_needed: { key: "reauthenticationNeeded", status: 400 },
  reauthentication_not_valid: { key: "reauthenticationNeeded", status: 400 },
};

/** Build a response payload for one of the fixed messages. */
export function authMessage(key: AuthMessageKey, status: number): MappedAuthError {
  return { status, body: { error: AUTH_MESSAGES[key], code: key } };
}

export function mapAuthError(
  error: { code?: unknown; status?: unknown } | null | undefined,
  context: AuthErrorContext
): MappedAuthError {
  const code = typeof error?.code === "string" ? error.code : undefined;
  const status = typeof error?.status === "number" ? error.status : undefined;

  const known = code ? BY_CODE[code] : undefined;
  if (known) return authMessage(known.key, known.status);

  // GoTrue answers "Database error saving new user" (HTTP 500, which
  // auth-js turns into AuthRetryableFetchError with status 500 and no
  // code) when the on_auth_user_created trigger (migrations/0004) fails.
  // The sign-up route validates the username format first, so the
  // remaining cause is the profiles.username UNIQUE constraint
  // (schema.sql:80). Exactly 500 only: 502-504 and status 0 are outages
  // or network failures, not a taken username.
  if (context === "sign_up" && status === 500) {
    return authMessage("usernameUnavailable", 409);
  }
  if (status === 429) return authMessage("rateLimited", 429);
  if (status !== undefined && status >= 400 && status < 500) {
    return authMessage("generic", status);
  }
  return authMessage("generic", 500);
}
```

The `code` field in the JSON body is our own key, not GoTrue's code, so the client can branch on it later without depending on Supabase. `AuthContext.readErrorMessage` (lines 40-48) already reads only `data.error`, so no client change is needed to display these strings.

### 3. `frontend/app/lib/siteUrl.ts` (new file): canonical callback URL

```ts
/**
 * Canonical absolute site URL for links that leave the app (auth emails).
 * Never derived from the request Host or from window.location (audit M-3):
 * only from NEXT_PUBLIC_SITE_URL, which is inlined at build time.
 */
const FALLBACK_SITE_URL = "https://pokefin.ca";

export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const base = raw && /^https?:\/\/[^/]+/.test(raw) ? raw : FALLBACK_SITE_URL;
  return base.replace(/\/+$/, "");
}

/** Absolute URL of the PKCE callback, with an optional same-origin `next` path. */
export function authCallbackUrl(next?: string): string {
  const url = new URL("/auth/callback", `${getSiteUrl()}/`);
  if (next) url.searchParams.set("next", next);
  return url.toString();
}
```

`authCallbackUrl("/auth/reset-password")` returns `https://pokefin.ca/auth/callback?next=%2Fauth%2Freset-password` (verified with Node 22). `searchParams.get("next")` in the callback decodes it back to `/auth/reset-password`. The fallback matches production (`audits/HARDENING_FOLLOWUPS.md:87`), and local dev uses `http://localhost:3000` from `.env.example:9`.

### 4. `frontend/app/lib/rateLimit.ts`: reclassify routes, add a per-path key

Replace lines 66-78 (`RATE_LIMITS` and `classifyRoute`) with:

```ts
export const RATE_LIMITS = {
  // Per-IP limit shared by every other /api/* request and /auth/callback.
  general: { limit: 60, windowMs: 60_000 },
  // Credential and account endpoints. proxy.ts keys this class per path,
  // so each endpoint has its own budget per IP. 10 (not 5) so a Turnstile
  // solve plus two typos and a retry does not lock a real user out.
  sensitive: { limit: 10, windowMs: 60_000 },
} as const;

export type RouteClass = keyof typeof RATE_LIMITS;

// Exact paths, not a prefix: /api/auth/me is called on every page load
// and window focus (AuthContext.tsx:75-118) and must stay "general".
const SENSITIVE_PATHS = new Set([
  "/api/auth/sign-in",
  "/api/auth/sign-up",
  "/api/auth/update-password",
  "/api/auth/forgot-password",
]);

function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

export function classifyRoute(pathname: string): RouteClass | null {
  const path = normalizePath(pathname);
  if (SENSITIVE_PATHS.has(path)) return "sensitive";
  if (path.startsWith("/api/account/")) return "sensitive";
  // Single-use PKCE code exchange: keep a per-IP ceiling, but never share
  // a bucket with page loads.
  if (path === "/auth/callback") return "general";
  if (path.startsWith("/api/")) return "general";
  // /auth/login, /auth/signup, /auth/forgot-password, /auth/reset-password
  // are static pages. Limiting their HTML GETs and RSC prefetches only
  // locks visitors out of login (review finding F077).
  return null;
}

/**
 * Bucket key. Sensitive buckets are per path so a burst on one endpoint
 * (for example sign-up) cannot starve another (sign-in). General buckets
 * stay per IP so the 60/min budget is not multiplied by the number of
 * /api routes.
 */
export function rateLimitKey(routeClass: RouteClass, pathname: string, ip: string): string {
  return routeClass === "sensitive"
    ? `sensitive:${normalizePath(pathname)}:${ip}`
    : `${routeClass}:${ip}`;
}
```

Also update the stale comment in the file header only if it mentions `/auth/*`; it does not today, so leave lines 1-13 alone.

### 5. `frontend/proxy.ts`: use the per-path key

Change the import at lines 4-9 to add `rateLimitKey`:

```ts
import {
  RATE_LIMITS,
  classifyRoute,
  clientIp,
  rateLimit,
  rateLimitKey,
} from "./app/lib/rateLimit";
```

Replace lines 29-36:

```ts
  // 1) Rate limit credential endpoints, /api/* and /auth/callback before
  //    any auth work. Static /auth/* pages are not limited (F077).
  const routeClass = classifyRoute(path);
  if (routeClass) {
    const { limit, windowMs } = RATE_LIMITS[routeClass];
    const ip = clientIp(req);
    const result = rateLimit(rateLimitKey(routeClass, path, ip), limit, windowMs);
    if (!result.success) return tooManyRequests(result.resetSeconds);
  }
```

Leave the matcher (lines 94-101) unchanged. Do not add a header-based prefetch exemption (see Pitfalls).

### 6. `frontend/app/api/auth/sign-in/route.ts`: require captcha, map errors

Add imports after line 4:

```ts
import { authMessage, mapAuthError } from "../../../lib/authErrors";
```

Replace lines 29-30 with:

```ts
  const captchaToken =
    typeof body.captchaToken === "string" ? body.captchaToken : "";
```

Insert after the email/password check (after line 37):

```ts
  // Fail closed. Supabase verifies the token (Auth > Attack Protection),
  // but a request without one must never reach it, so the gate does not
  // depend on a dashboard toggle. Do NOT call Turnstile siteverify here:
  // tokens are single use and Supabase's own check would then fail.
  if (!captchaToken) {
    const m = authMessage("captchaRequired", 400);
    return NextResponse.json(m.body, { status: m.status });
  }
```

Replace lines 46-52 (the error branch) with:

```ts
  if (error) {
    logSupabaseError("sign_in_failed", error);
    const mapped = mapAuthError(error, "sign_in");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
```

Keep `options: { captchaToken }` at line 43 as is.

### 7. `frontend/app/api/auth/sign-up/route.ts`: validate username, password, captcha; set the confirmation redirect

Add imports after line 4:

```ts
import { authMessage, mapAuthError } from "../../../lib/authErrors";
import { authCallbackUrl } from "../../../lib/siteUrl";
import { PASSWORD_MIN_LENGTH, isValidUsername } from "../../../lib/validation";
```

Replace lines 31-32 with:

```ts
  const captchaToken =
    typeof body.captchaToken === "string" ? body.captchaToken : "";
```

Insert after the email/password check (after line 39), in this order:

```ts
  // Mirrors the profiles_username_format CHECK. Without this, a malformed
  // username fails inside the on_auth_user_created trigger and GoTrue
  // answers an opaque 500 (F132).
  if (!isValidUsername(username)) {
    const m = authMessage("invalidUsername", 400);
    return NextResponse.json(m.body, { status: m.status });
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    const m = authMessage("weakPassword", 400);
    return NextResponse.json(m.body, { status: m.status });
  }
  if (!captchaToken) {
    const m = authMessage("captchaRequired", 400);
    return NextResponse.json(m.body, { status: m.status });
  }
```

Replace the `signUp` call (lines 42-49) with:

```ts
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      captchaToken,
      // Send the confirmation link through the server callback, which
      // reads the HttpOnly PKCE verifier this client just stored. Without
      // it the link falls back to the bare Site URL.
      emailRedirectTo: authCallbackUrl(),
      data: { username },
    },
  });
```

Replace lines 51-57 (the error branch) with:

```ts
  if (error) {
    logSupabaseError("sign_up_failed", error);
    const mapped = mapAuthError(error, "sign_up");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
```

Decision: no migration is added to make `handle_new_user` tolerant of a taken username. After format validation the only trigger failure left is the UNIQUE violation, which `mapAuthError` turns into a 409 with a clear "username may already be taken" message. A tolerant trigger would create accounts with a NULL username, which the UI cannot handle until WP04.

### 8. `frontend/app/api/auth/update-password/route.ts`: length check, current password, fixed messages

Line numbers below refer to the file before this step; apply the edits from the bottom of the file up (error branch, then `updateUser`, then the unauthenticated branch, then the inserts, then imports) so earlier numbers stay valid.

Add imports after line 4:

```ts
import { authMessage, mapAuthError } from "../../../lib/authErrors";
import { PASSWORD_MIN_LENGTH } from "../../../lib/validation";
```

Change the body type at line 17 to `let body: { password?: unknown; currentPassword?: unknown };`.

Insert after the `if (!password)` block (after line 27):

```ts
  if (password.length < PASSWORD_MIN_LENGTH) {
    const m = authMessage("weakPassword", 400);
    return NextResponse.json(m.body, { status: m.status });
  }
  // F078: /account sends the current password; the recovery flow
  // (/auth/reset-password) does not. GoTrue verifies it when "require
  // current password" is enabled and skips the check for recovery
  // sessions itself, so the route only forwards it.
  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
```

Replace line 38 (`const { error } = await supabase.auth.updateUser({ password });`) with:

```ts
  const { error } = await supabase.auth.updateUser(
    currentPassword ? { password, current_password: currentPassword } : { password }
  );
```

Replace lines 34-36 (the unauthenticated branch) so the reset page shows a sentence instead of "Unauthorized":

```ts
  if (userError || !user) {
    const m = authMessage("sessionExpired", 401);
    return NextResponse.json(m.body, { status: m.status });
  }
```

Replace lines 39-45 (the error branch):

```ts
  if (error) {
    logSupabaseError("update_password_failed", error);
    const mapped = mapAuthError(error, "update_password");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
```

Do not add a `signInWithPassword` probe or `signOut({ scope: "others" })` (see Pitfalls), and do not require `currentPassword` in the route: the reset-password page legitimately omits it, and only GoTrue can tell a recovery session from a normal one reliably. F078 is closed by the `/account` field (step 16), this forwarding, the owner toggle (owner action 6) and the error mappings in step 2.

### 9. `frontend/app/api/auth/forgot-password/route.ts` (new file)

```ts
import { NextRequest, NextResponse } from "next/server";
import { createRouteSupabaseClient } from "../../../lib/routeSupabase";
import { rejectIfBodyTooLarge, rejectIfCsrfFails } from "../../../lib/csrf";
import { logSupabaseError } from "../../../lib/logger";
import { authMessage, mapAuthError } from "../../../lib/authErrors";
import { authCallbackUrl } from "../../../lib/siteUrl";

const EMAIL_MAX_LENGTH = 254;

/**
 * Sends the password-recovery email. Server-side on purpose:
 * - the captcha token is required and forwarded to Supabase, which
 *   verifies it. The app never calls Turnstile siteverify itself because
 *   tokens are single use.
 * - redirectTo is fixed to <NEXT_PUBLIC_SITE_URL>/auth/callback?next=
 *   /auth/reset-password, so the link no longer depends on the dashboard
 *   Site URL or on a type=recovery parameter PKCE links never carry.
 * - createRouteSupabaseClient stores the PKCE verifier in an HttpOnly
 *   cookie that /auth/callback reads when the link is opened in the same
 *   browser.
 * GoTrue answers 200 whether or not the address has an account, and so
 * does this route, so it is not an account-existence oracle.
 */
export async function POST(req: NextRequest) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, 4096);
  if (tooLarge) return tooLarge;

  let body: { email?: unknown; captchaToken?: unknown } | null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const captchaToken =
    typeof body.captchaToken === "string" ? body.captchaToken : "";

  if (!email || email.length > EMAIL_MAX_LENGTH || !email.includes("@")) {
    const m = authMessage("invalidEmail", 400);
    return NextResponse.json(m.body, { status: m.status });
  }
  if (!captchaToken) {
    const m = authMessage("captchaRequired", 400);
    return NextResponse.json(m.body, { status: m.status });
  }

  const supabase = await createRouteSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    captchaToken,
    redirectTo: authCallbackUrl("/auth/reset-password"),
  });

  if (error) {
    logSupabaseError("forgot_password_failed", error);
    const mapped = mapAuthError(error, "forgot_password");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  return NextResponse.json({ ok: true });
}
```

The path is classified "sensitive" by step 4 (`SENSITIVE_PATHS`).

### 10. `frontend/app/auth/callback/route.ts`: route recovery through `next`, check the exchange

Keep `safeNextPath` (lines 6-24) exactly as it is and where it is; WP13 moves it to `app/lib/redirects.ts`. Replace the imports (lines 1-4) and the whole `GET` function (lines 26-67) with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { hardenCookieOptions } from "../../lib/cookieOptions";
import { stripControlChars } from "../../lib/validation";

const RESET_PASSWORD_PATH = "/auth/reset-password";
// Where a failed or expired email link lands when it was not a recovery
// link. After a failed exchange the email is already confirmed (GoTrue
// verified it before redirecting), so the user just needs to sign in.
// WP13 renders a message for ?error=auth_link on the login page.
const AUTH_LINK_FAILED_PATH = "/auth/login?error=auth_link";
```

(`safeNextPath` stays here, unchanged.)

```ts
type PendingCookie = { name: string; value: string; options: CookieOptions };

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeNextPath(requestUrl.searchParams.get("next"));

  if (!code) {
    // GoTrue redirects here with ?error=...&error_code=... and no code when
    // the email link is expired or already used. Treat that like a failed
    // exchange instead of silently landing on `next`.
    if (requestUrl.searchParams.has("error")) {
      const failed = next === RESET_PASSWORD_PATH ? RESET_PASSWORD_PATH : AUTH_LINK_FAILED_PATH;
      return NextResponse.redirect(new URL(failed, request.url));
    }
    return NextResponse.redirect(new URL(next, request.url));
  }

  // Collect cookies and no-cache headers during the exchange, then write
  // them onto whichever redirect we decide on afterwards.
  const pendingCookies: PendingCookie[] = [];
  const pendingHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          pendingCookies.push(...cookiesToSet);
          Object.assign(pendingHeaders, headers);
        },
      },
    }
  );

  const flowId = requestUrl.searchParams.get("sb_flow_id") ?? undefined;
  const { data, error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined
  );
  // auth-js 2.112 returns redirectType ("recovery" when the verifier was
  // stored by the recovery-email request) but does not declare it in the type.
  const redirectType = (data as unknown as { redirectType?: string | null } | null)
    ?.redirectType;

  let target: string;
  if (error) {
    // The reset page already renders "Link invalid or expired" when there
    // is no session, so a failed recovery exchange goes there.
    target = next === RESET_PASSWORD_PATH ? RESET_PASSWORD_PATH : AUTH_LINK_FAILED_PATH;
  } else if (redirectType === "recovery") {
    target = RESET_PASSWORD_PATH;
  } else {
    target = next;
  }

  const response = NextResponse.redirect(new URL(target, request.url));
  for (const { name, value, options } of pendingCookies) {
    // HttpOnly + Secure enforced, as before.
    response.cookies.set({ name, value, ...hardenCookieOptions(options) });
  }
  for (const [key, value] of Object.entries(pendingHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}
```

Write the comment exactly as shown: the Verification grep for `resetPasswordForEmail` must match only the forgot-password route. The `type === "recovery"` branch is gone. `redirectType` is a code-side fallback that also covers a recovery link whose `next` was lost; the primary route is `next=/auth/reset-password` from step 9. Keep the inline `createServerClient`; WP20 consolidates it.

Also fix the stale comment in `frontend/app/auth/reset-password/page.tsx:35-37` in step 15.

### 11. `frontend/app/context/AuthContext.tsx`: `resetPassword` calls the new route; `updatePassword` sends the current password

Touch only `resetPassword`, `updatePassword` and their two interface lines. Lines 20-21 become:

```ts
  resetPassword: (email: string, captchaToken?: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (newPassword: string, currentPassword?: string) => Promise<{ error: AuthError | null }>;
```

In `updatePassword` (lines 188-204) change the first line to `const updatePassword = async (newPassword: string, currentPassword?: string) => {` and the body line to `body: JSON.stringify({ password: newPassword, currentPassword }),`. `JSON.stringify` drops an `undefined` `currentPassword`, so the reset-password page still sends `{ password }` and the existing `updatePassword` test (which expects exactly `{ password: "newSecurePassword123" }`) keeps passing.

Replace lines 180-186 with:

```ts
  const resetPassword = async (email: string, captchaToken?: string) => {
    // Server route: forwards the captcha token and a fixed redirectTo,
    // and stores the PKCE verifier in an HttpOnly cookie (F019, F079).
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: FETCH_HEADERS,
        credentials: "same-origin",
        body: JSON.stringify({ email, captchaToken }),
      });
      if (!res.ok) {
        const message = await readErrorMessage(res, "Could not send the reset email");
        return { error: asAuthError(message) };
      }
      return { error: null };
    } catch {
      return { error: asAuthError("Network error") };
    }
  };
```

Leave the `supabase` import at line 5 (still used by `fetchProfile`; WP04 removes it).

### 11b. `frontend/app/lib/supabase.ts`: stop the browser client from exchanging `?code=`

Change line 24 to:

```ts
  auth: { flowType: "pkce", detectSessionInUrl: false },
```

Why: every email link now goes to the server callback, which is the only place a PKCE code may be exchanged (the verifier cookie is HttpOnly). With the default `detectSessionInUrl: true`, any page that loads with a stray `?code=` makes the browser client try an exchange and, if it ever succeeds, write a JS-readable session cookie (session-cookie audit F-2). After step 11 no browser code calls `supabase.auth.*` (`AuthContext` uses the client only for the `profiles` SELECT), so nothing depends on the auto-exchange. Update `frontend/app/lib/__tests__/supabase.test.ts:66` to expect `{ auth: { flowType: "pkce", detectSessionInUrl: false } }`. Change nothing else in either file (WP12 and WP20 own later changes to `supabase.ts`).

### 12. `frontend/app/auth/forgot-password/page.tsx`: Turnstile widget, token reset, autoComplete

Change the imports (lines 3-5):

```tsx
import { useRef, useState } from "react";
import Link from "next/link";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useAuth } from "../../context/AuthContext";
```

Replace lines 20-40 (state and `handleSubmit`):

```tsx
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string>();
  const turnstileRef = useRef<TurnstileInstance | undefined>(undefined);
  const { resetPassword } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await resetPassword(email, captchaToken);

    if (error) {
      setError(error.message);
      setLoading(false);
      // Turnstile tokens are single use: Supabase consumed this one.
      setCaptchaToken(undefined);
      turnstileRef.current?.reset();
    } else {
      setSuccess(true);
      setLoading(false);
    }
  };
```

Add `role="alert"` to the error box (line 80): `<div role="alert" className="bg-rose-50 ...">`.

On the email input (lines 93-101) add `name="email"` and `autoComplete="username"` (the saved sign-in identifier is the email; see step 13).

Insert the widget between the email field's closing `</div>` (line 102) and the `<button>` (line 104), and gate the button:

```tsx
            <Turnstile
              ref={turnstileRef}
              siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
              onSuccess={(token) => setCaptchaToken(token)}
              onExpire={() => setCaptchaToken(undefined)}
              onError={() => setCaptchaToken(undefined)}
            />

            <button
              type="submit"
              disabled={loading || !captchaToken}
```

(keep the button's existing `className` and children). The ref pattern type-checks against `@marsidev/react-turnstile` 1.5.5 and React 19 (verified with `tsc` in a scratch project).

### 13. `frontend/app/auth/login/page.tsx`: token reset, autoComplete, alert role

- Line 3: `import { useRef, useState } from "react";`
- Line 6: `import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";`
- After line 31 add: `const turnstileRef = useRef<TurnstileInstance | undefined>(undefined);`
- Replace lines 42-45 (the `if (error) {` branch through `} else {`):

```tsx
    if (error) {
      setError(error.message);
      setLoading(false);
      // Turnstile tokens are single use: a retry needs a fresh one.
      setCaptchaToken(undefined);
      turnstileRef.current?.reset();
    } else {
```

- Line 61: add `role="alert"` to the error `<div>`.
- Email input (lines 74-82): add `name="email"` and `autoComplete="username"`. Sign-in is by email, so the email field is the credential identifier password managers must save and fill.
- Password input (lines 92-100): add `name="password"` and `autoComplete="current-password"`.
- Turnstile (lines 103-106): add `ref={turnstileRef}`, `onExpire={() => setCaptchaToken(undefined)}`, `onError={() => setCaptchaToken(undefined)}`.

Leave `router.push("/")` at line 46 unchanged (WP13 adds return-to).

### 14. `frontend/app/auth/signup/page.tsx`: shared rules, token reset, autoComplete

- Imports: `import { useRef, useState } from "react";`, `import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";`, and add

```tsx
import {
  PASSWORD_HINT,
  PASSWORD_MIN_LENGTH,
  PASSWORD_TOO_SHORT_MESSAGE,
  USERNAME_FORMAT_MESSAGE,
  USERNAME_HINT,
  USERNAME_MAX_LENGTH,
  USERNAME_RE,
} from "../../lib/validation";
```

- After line 40 add `const turnstileRef = useRef<TurnstileInstance | undefined>(undefined);`
- Replace lines 48-56 (two username checks) with one:

```tsx
    if (!USERNAME_RE.test(username)) {
      setError(USERNAME_FORMAT_MESSAGE);
      return;
    }
```

- Replace lines 63-66:

```tsx
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(PASSWORD_TOO_SHORT_MESSAGE);
      return;
    }
```

- Replace lines 72-75 (the `if (error) {` branch through `} else {`) with the same block as step 13: `if (error) {`, the four statements `setError(error.message)`, `setLoading(false)`, `setCaptchaToken(undefined)`, `turnstileRef.current?.reset()`, then `} else {`.
- Line 118: add `role="alert"` to the error `<div>`.
- Username input (lines 126-134): add `name="nickname"`, `autoComplete="nickname"`, `maxLength={USERNAME_MAX_LENGTH}`. Line 135 hint text becomes `{USERNAME_HINT}`. The display handle is not the sign-in identifier; marking it `username` would make password managers save "pokefan123" and later fill it into the login email field. This deliberately differs from item 4 of the F024 verifier correction (which suggests `username` on this field and `email` on the email field): that same correction puts `autoComplete="username"` on the login email field, and the two only stay consistent if the signup email field is the `username` one too. Do not "fix" it back.
- Email input (lines 140-148): add `name="email"`, `autoComplete="username"`.
- Password input (lines 153-161): add `name="new-password"`, `autoComplete="new-password"`, `minLength={PASSWORD_MIN_LENGTH}`. Line 162 hint becomes `{PASSWORD_HINT}`.
- Confirm input (lines 167-175): add `autoComplete="new-password"`, `minLength={PASSWORD_MIN_LENGTH}`.
- Turnstile (lines 178-181): add `ref`, `onExpire`, `onError` as in step 13.

### 15. `frontend/app/auth/reset-password/page.tsx`: 12 characters, autoComplete, comment

- Add `import { PASSWORD_HINT, PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT_MESSAGE } from "../../lib/validation";`
- Replace the comment at lines 35-37 with:

```tsx
  // Recovery flow: POST /api/auth/forgot-password sends a link whose
  // redirect is /auth/callback?next=/auth/reset-password. The callback
  // exchanges the PKCE code for a session (HttpOnly cookies) and
  // redirects here. We just check whether AuthContext sees a user.
```

- Replace lines 53-56:

```tsx
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(PASSWORD_TOO_SHORT_MESSAGE);
      return;
    }
```

- Line 140: add `role="alert"`.
- Inside the `<form>` at line 145, as its first child, add a hidden username field so password managers update the right saved entry:

```tsx
            <input
              type="email"
              name="username"
              autoComplete="username"
              value={user.email ?? ""}
              readOnly
              hidden
            />
```

- Password input (lines 148-156): add `name="new-password"`, `autoComplete="new-password"`, `minLength={PASSWORD_MIN_LENGTH}`; line 157 hint becomes `{PASSWORD_HINT}`.
- Confirm input (lines 162-170): add `autoComplete="new-password"`, `minLength={PASSWORD_MIN_LENGTH}`.

### 16. `frontend/app/account/page.tsx`: password section, current password, alert roles

- Add `import { PASSWORD_HINT, PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT_MESSAGE } from "../lib/validation";` and `import { AUTH_MESSAGES } from "../lib/authErrors";` next to the existing imports (`authErrors.ts` is a pure module, safe in a client component).
- After line 19 (`const [newPassword, setNewPassword] = useState("");`) add `const [currentPassword, setCurrentPassword] = useState("");`.
- In `handlePasswordUpdate`, replace lines 94-97:

```tsx
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setPasswordError(PASSWORD_TOO_SHORT_MESSAGE);
      return;
    }

    if (!currentPassword) {
      setPasswordError(AUTH_MESSAGES.currentPasswordRequired);
      return;
    }
```

- Line 101 becomes `const { error } = await updatePassword(newPassword, currentPassword);`.
- In the success branch (lines 105-109), next to `setNewPassword("");` add `setCurrentPassword("");`.
- Inside the password `<form>` (line 262), as its first child, add the same hidden `username` input as step 15 (`value={user.email ?? ""}`; `user` is non-null here because the page returns early at `:180-189` otherwise; if TypeScript disagrees, use `user?.email ?? ""`).
- Directly after that hidden input, before the "New Password" block (line 263), add:

```tsx
            <div>
              <label
                htmlFor="currentPassword"
                className="block text-sm font-medium mb-1"
              >
                Current Password
              </label>
              <input
                id="currentPassword"
                name="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-transparent bg-white"
                placeholder="••••••••"
              />
            </div>
```

  (The class string is copied from the existing new-password input at `:276`.)
- New password input (lines 270-278): add `autoComplete="new-password"`, `minLength={PASSWORD_MIN_LENGTH}`; line 279 hint becomes `{PASSWORD_HINT}`.
- Confirm input (lines 289-297): add `autoComplete="new-password"`, `minLength={PASSWORD_MIN_LENGTH}`.
- Add `role="alert"` to the four error `<div>`s: password `:301`, username `:235`, export `:332`, delete `:353`. Attribute only: do not change their text, class or the handlers that set them (WP01, WP04 and WP15 own those).

Do not touch `handleUsernameUpdate`, the rest of the username form, or the export and delete handlers. `setPasswordError(error.message)` at line 104 stays: the message is now a fixed string from the server. Do not add a current-password field to `/auth/reset-password`: that page runs on a recovery session, which GoTrue exempts.

### 17. `frontend/next.config.ts`: disable the image optimizer

Replace lines 53-73 (the whole `images: { remotePatterns: [...] }` block) with:

```ts
  // The Next image optimizer is disabled on purpose (commit bd29639 marked
  // the only next/image use unoptimized). With unoptimized: true Vercel
  // provisions no /_next/image endpoint, so nobody can make us fetch and
  // transform arbitrary images on our quota (review finding F075).
  images: { unoptimized: true },
```

Leave the CSP `img-src` (line 21) alone; WP17 owns CSP (F128). Leave the `unoptimized` prop in `ProductImage.tsx:105` in place.

### 18. `audits/HARDENING_FOLLOWUPS.md`: record the new behaviour

- Section 4, replace lines 100-104 with:

```markdown
Implemented in `frontend/app/lib/rateLimit.ts` and wired into
`frontend/proxy.ts`. 60 req/min per IP for `/api/*` and `/auth/callback`;
10 req/min per IP per endpoint for `/api/auth/sign-in`, `/api/auth/sign-up`,
`/api/auth/update-password`, `/api/auth/forgot-password` and `/api/account/*`.
The static auth pages (`/auth/login`, `/auth/signup`, `/auth/forgot-password`,
`/auth/reset-password`) are deliberately not limited: their page loads and
link prefetches must never lock a visitor out (review finding F077). Limit
state is per-instance (not durable across serverless cold starts), which is
the known tradeoff for shipping without an external account.
```

- Section 2 table (lines 71-79). Edit exactly these cells and rows; leave the others alone:
  - "Minimum password length" row: Required value becomes `12 (app enforces the same value since WP02: app/lib/validation.ts PASSWORD_MIN_LENGTH)`. Status stays `Done`.
  - "Redirect URLs allowlist" row: Required value becomes `https://pokefin.ca/auth/callback**` (+ `http://localhost:3000/auth/callback**` for dev); Status becomes `Pending (WP02 owner action 2)`.
  - "Captcha protection" row: append to the Required value `. App requires a token on sign-in, sign-up and forgot-password (WP02); Supabase is the only verifier`. Status becomes `Pending (WP02 owner action 1)`.
  - Add a row after "Minimum password length": `| Require current password on password change | Auth → Providers → Email (or Sign In / Providers → Email) | On; fallback: "Secure password change" | Pending (WP02 owner action 6) | F078 |`.
  - Owners mark rows `Done` only after the checks in Owner actions pass.

### 19. Tests

Write the tests in the Tests section. Order: update `rateLimit.test.ts`, `AuthContext.test.tsx` and `supabase.test.ts` first (they fail after steps 4, 11 and 11b), then add the new files.

## Pitfalls: do not do this

- Do not call Cloudflare `siteverify` from the app. Turnstile tokens are single use (`timeout-or-duplicate` on reuse); verifying in the route consumes the token and Supabase's own check then fails, breaking login for everyone. Supabase is the only verifier.
- Do not skip the limiter based on `RSC`, `Next-Router-Prefetch` or `next-router-segment-prefetch` headers. They are client-controlled, so an attacker adds them to bypass the limit. The proxy redirect to `/auth/login` and the email callback are real navigations anyway; reclassification is the fix.
- Do not classify `/api/auth/` by prefix as sensitive. `/api/auth/me` runs on every page load and window focus (`AuthContext.tsx:75-118`); at 10/min users would be signed out by the limiter.
- Do not key the general bucket per path. That multiplies the 60/min budget by the number of `/api` routes.
- Do not add `prefetch={false}` to `Header.tsx` / `Footer.tsx` links here. It is optional polish, does not fix the callback or shared-NAT cases, and WP03 is editing `Header.tsx`.
- Do not build `redirectTo` or `emailRedirectTo` from `window.location.origin`, the request `Host`/`Origin`, or a client-supplied body field. That reopens audit M-3 and lets anyone make our emails point elsewhere. Use `authCallbackUrl()` only.
- Do not keep or re-add the `type === "recovery"` branch in the callback. PKCE links never carry it.
- Do not ignore the `exchangeCodeForSession` result. A failed exchange must not redirect to the requested page as if signed in.
- Do not keep reset in the browser client with `supabase.auth.resetPasswordForEmail`. The browser client stores the PKCE verifier in a JS-readable cookie, and the plan moves all auth off that client.
- Do not reuse a captcha token after a failed submit. Clear it and call `turnstileRef.current?.reset()` on login, signup and forgot-password.
- Do not return `error.message` from any `/api/auth/*` route, and do not map errors by message text. Map by `error.code` through `mapAuthError`.
- Do not put `autoComplete="username"` on the signup display-name field. Sign-in is by email; the email field is the identifier.
- For F078: do not hand-roll a `signInWithPassword` probe for the current password (it counts as a login, needs a captcha token, and a cookie thief can call GoTrue directly anyway). Do not add `signOut({ scope: "others" })`: GoTrue already revokes other sessions on every password update. Do not cap the cookie `maxAge` as a "fix"; cookie lifetime is not session lifetime.
- For F075: do not pin `remotePatterns` to the project host instead of disabling the optimizer. Patterns have no `search` constraint, so nonce query strings still mint unbounded distinct sources. Do not add `/_next/image` to the proxy matcher; on Vercel the platform serves it, not the app.
- Do not add a migration to make `handle_new_user` swallow unique violations (see step 7 decision).
- Do not move `safeNextPath` (WP13), refactor the callback's inline client or the account routes' inline CSRF (WP20), change the account username form or `fetchProfile` (WP04), or pin CSP hosts (WP17).
- Do not import `next/server` into `authErrors.ts`, `siteUrl.ts` or `validation.ts`. They are imported by client components and by jsdom tests.
- Do not add a password-length check to the sign-in route or the login form. Accounts created before the 12-character rule may have 8 to 11 character passwords and must still be able to sign in.
- Do not widen the "username may be taken" mapping to every 5xx. Only `status === 500` in the `sign_up` context means the trigger failed; 502-504 (outage) and 0 (network) must stay generic.
- Do not use HTTP 401 for `currentPasswordRequired`, `currentPasswordIncorrect` or `reauthenticationNeeded`. The session is valid in those cases; a 401 reads as "signed out" to callers (WP04's `AuthContext` clears the user on 401 from its routes).
- Do not make `currentPassword` mandatory in `/api/auth/update-password`. The reset-password page (recovery session) does not send it, and GoTrue already exempts recovery sessions when it enforces the check.

## Tests

Route and proxy tests need `/** @jest-environment node */` as the first line (`next/server` fails under jsdom). Mock `routeSupabase` rather than importing it: it imports `server-only` and `next/headers`.

1. `frontend/app/lib/__tests__/rateLimit.test.ts` (update). Replace the `classifyRoute` describe (lines 48-67) and extend the imports with `rateLimitKey`:

```ts
describe("classifyRoute", () => {
  it("classifies the credential endpoints as sensitive", () => {
    for (const p of [
      "/api/auth/sign-in",
      "/api/auth/sign-up",
      "/api/auth/update-password",
      "/api/auth/forgot-password",
    ]) {
      expect(classifyRoute(p)).toBe("sensitive");
    }
  });
  it("ignores a trailing slash", () => {
    expect(classifyRoute("/api/auth/sign-in/")).toBe("sensitive");
  });
  it("classifies /api/account/* as sensitive", () => {
    expect(classifyRoute("/api/account/delete")).toBe("sensitive");
    expect(classifyRoute("/api/account/export")).toBe("sensitive");
  });
  it("keeps /api/auth/me and /api/auth/sign-out general", () => {
    expect(classifyRoute("/api/auth/me")).toBe("general");
    expect(classifyRoute("/api/auth/sign-out")).toBe("general");
  });
  it("classifies /auth/callback as general", () => {
    expect(classifyRoute("/auth/callback")).toBe("general");
  });
  it("does not limit the static auth pages", () => {
    for (const p of ["/auth/login", "/auth/signup", "/auth/forgot-password", "/auth/reset-password"]) {
      expect(classifyRoute(p)).toBeNull();
    }
  });
  it("classifies other /api/* as general", () => {
    expect(classifyRoute("/api/products")).toBe("general");
  });
  it("does not classify non-api/auth paths", () => {
    expect(classifyRoute("/")).toBeNull();
    expect(classifyRoute("/portfolio")).toBeNull();
  });
});

describe("rateLimitKey", () => {
  it("keys sensitive buckets per path and IP", () => {
    expect(rateLimitKey("sensitive", "/api/auth/sign-in", "1.2.3.4")).toBe("sensitive:/api/auth/sign-in:1.2.3.4");
    expect(rateLimitKey("sensitive", "/api/auth/sign-in/", "1.2.3.4")).toBe("sensitive:/api/auth/sign-in:1.2.3.4");
  });
  it("keys general buckets per IP only", () => {
    expect(rateLimitKey("general", "/api/products", "1.2.3.4")).toBe("general:1.2.3.4");
  });
});
```

In "RATE_LIMITS sanity" add `expect(RATE_LIMITS.sensitive.limit).toBe(10);`.

2. `frontend/app/lib/__tests__/proxy.rateLimit.test.ts` (new; named so it does not collide with the broader `proxy.test.ts` WP17 adds):

```ts
/** @jest-environment node */
import { NextRequest } from "next/server";
import { RATE_LIMITS, _resetRateLimitStoreForTests } from "../rateLimit";

jest.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  }),
}));

import { proxy } from "../../../proxy";

function req(path: string, method = "GET", ip = "203.0.113.7") {
  return new NextRequest(`https://pokefin.ca${path}`, {
    method,
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => _resetRateLimitStoreForTests());

it("never rate-limits auth page loads", async () => {
  for (let i = 0; i < 30; i++) {
    for (const p of ["/auth/login", "/auth/signup", "/auth/forgot-password", "/auth/reset-password"]) {
      expect((await proxy(req(p))).status).not.toBe(429);
    }
  }
});

it("allows RATE_LIMITS.sensitive.limit sign-in POSTs per minute, then 429", async () => {
  for (let i = 0; i < RATE_LIMITS.sensitive.limit; i++) {
    expect((await proxy(req("/api/auth/sign-in", "POST"))).status).not.toBe(429);
  }
  const denied = await proxy(req("/api/auth/sign-in", "POST"));
  expect(denied.status).toBe(429);
  expect(denied.headers.get("retry-after")).toBeTruthy();
});
```

Add cases: exhausting `/api/auth/sign-in` leaves `/api/auth/sign-up` and `/api/auth/forgot-password` usable from the same IP; exhausting IP `203.0.113.7` leaves IP `198.51.100.9` usable; 15 GETs to `/auth/callback` are all non-429.

3. `frontend/app/lib/__tests__/authErrors.test.ts` (new, default jsdom env is fine). Cases:
   - each code in `BY_CODE` used by the UI (`invalid_credentials` 401, `captcha_failed` 400, `weak_password` 422, `email_not_confirmed` 400, `over_email_send_rate_limit` 429, `current_password_required` 400, `current_password_mismatch` 400, `reauthentication_needed` 400) maps to the matching `AUTH_MESSAGES` string and that status.
   - the real shape of a GoTrue 500 (`{ name: "AuthRetryableFetchError", status: 500, message: "Database error saving new user" }`, no `code`) with context `sign_up` gives status 409 and `usernameUnavailable`; the same with `sign_in` gives 500 and `generic`; `{ status: 503 }` and `{ status: 0 }` with `sign_up` give `generic` (not `usernameUnavailable`).
   - an unknown code with status 422 gives `generic` with status 422; `{ status: 429 }` gives `rateLimited`; `null` gives `generic` 500.
   - a raw message is never returned: `mapAuthError({ code: "x", status: 400, message: "relation profiles violates ..." } as never, "sign_in").body.error` equals `AUTH_MESSAGES.generic`.

4. `frontend/app/lib/__tests__/validation.test.ts` (update): `PASSWORD_MIN_LENGTH === 12`; `USERNAME_RE` accepts `"abc"`, `"a_1"`, `"x".repeat(32)`; rejects `"ab"`, `"x".repeat(33)`, `"bad name"`, `"émile"`, `""`; `isValidUsername(42) === false`.

5. `frontend/app/api/auth/__tests__/routes.test.ts` (new):

```ts
/** @jest-environment node */
import { NextRequest } from "next/server";
import { AUTH_MESSAGES } from "../../../lib/authErrors";

const mockAuth = {
  signInWithPassword: jest.fn(),
  signUp: jest.fn(),
  getUser: jest.fn(),
  updateUser: jest.fn(),
  resetPasswordForEmail: jest.fn(),
};
jest.mock("../../../lib/routeSupabase", () => ({
  createRouteSupabaseClient: async () => ({ auth: mockAuth }),
}));
jest.mock("../../../lib/logger", () => ({ logSupabaseError: jest.fn() }));

import { POST as signIn } from "../sign-in/route";
import { POST as signUp } from "../sign-up/route";
import { POST as updatePassword } from "../update-password/route";
import { POST as forgotPassword } from "../forgot-password/route";

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`https://pokefin.ca${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pokefin-request": "1",
      origin: "https://pokefin.ca",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const GOOD_PASSWORD = "correct-horse-battery";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://pokefin.ca";
});
beforeEach(() => jest.clearAllMocks());

describe("sign-in", () => {
  it("rejects a missing captcha token with 400 and never calls Supabase", async () => {
    const res = await signIn(post("/api/auth/sign-in", { email: "a@b.co", password: "x" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(AUTH_MESSAGES.captchaRequired);
    expect(mockAuth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("maps invalid_credentials and never echoes the raw message", async () => {
    mockAuth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "invalid_credentials", status: 400, message: "Invalid login credentials" },
    });
    const res = await signIn(post("/api/auth/sign-in", { email: "a@b.co", password: "x", captchaToken: "t" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: AUTH_MESSAGES.invalidCredentials, code: "invalidCredentials" });
  });
});
```

   Remaining cases to write in the same style:
   - sign-in: `post(..., body, { "x-pokefin-request": "0" })` gives 403 (the helper cannot delete the header, so override it); captcha token is forwarded as `options.captchaToken`; an 8-character password with a captcha token still reaches `signInWithPassword` (no length check on sign-in).
   - sign-up: username `"ab"`, `"x".repeat(33)` and `"bad name"` give 400 `invalidUsername`; an 11-character password gives 400 `weakPassword`; missing captcha gives 400 `captchaRequired`; in all three `mockAuth.signUp` is not called. A valid request calls `signUp` with `options.emailRedirectTo === "https://pokefin.ca/auth/callback"` and `options.data.username`. A Supabase error `{ name: "AuthRetryableFetchError", status: 500, message: "Database error saving new user" }` (no `code`, which is what auth-js 2.112.2 produces for a GoTrue 500) gives 409 `usernameUnavailable`, and the raw message is not in the body.
   - update-password: an 11-character password gives 400 `weakPassword` and `getUser` is not called; `getUser` returning no user gives 401 `sessionExpired`; with `getUser` returning `{ data: { user: { id: "u1" } }, error: null }` and `updateUser` returning `{ data: { user: null }, error: null }`: body `{ password: GOOD_PASSWORD }` calls `updateUser` with exactly `{ password: GOOD_PASSWORD }`, and body `{ password: GOOD_PASSWORD, currentPassword: "old-password-1" }` calls it with exactly `{ password: GOOD_PASSWORD, current_password: "old-password-1" }`; `updateUser` returning `{ code: "current_password_mismatch", status: 400 }` gives 400 `currentPasswordIncorrect`; `{ code: "reauthentication_needed", status: 400 }` gives 400 `reauthenticationNeeded`.
   - forgot-password: missing captcha gives 400 `captchaRequired`; `"not-an-email"` gives 400 `invalidEmail`; a valid request calls `resetPasswordForEmail("a@b.co", { captchaToken: "t", redirectTo: "https://pokefin.ca/auth/callback?next=%2Fauth%2Freset-password" })` and returns 200 `{ ok: true }`; `{ code: "over_email_send_rate_limit", status: 429 }` gives 429 `emailRateLimited`; a JSON body of `null` gives 400.

6. `frontend/app/auth/callback/__tests__/route.test.ts` (new):

```ts
/** @jest-environment node */
import { NextRequest } from "next/server";

const mockExchange = jest.fn();
let mockCookieMethods: {
  setAll: (c: Array<{ name: string; value: string; options: object }>, h: Record<string, string>) => void;
} | null = null;

jest.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: typeof mockCookieMethods }) => {
    mockCookieMethods = opts.cookies;
    return {
      auth: {
        exchangeCodeForSession: (code: string, options?: { flowId?: string }) =>
          mockExchange(code, options),
      },
    };
  },
}));

import { GET } from "../route";

const get = (qs: string) => GET(new NextRequest(`https://pokefin.ca/auth/callback${qs}`));
const ok = (redirectType: string | null = null) => ({
  data: { user: {}, session: {}, redirectType },
  error: null,
});

beforeEach(() => jest.clearAllMocks());

it("sends a recovery link to the reset form and sets HttpOnly cookies", async () => {
  mockExchange.mockImplementation(async () => {
    mockCookieMethods!.setAll(
      [{ name: "sb-test-auth-token", value: "v", options: {} }],
      { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" }
    );
    return ok("recovery");
  });
  const res = await get("?code=abc&next=/auth/reset-password");
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("https://pokefin.ca/auth/reset-password");
  expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
  expect(res.headers.get("cache-control")).toMatch(/no-store/);
});
```

   Remaining cases: `?code=abc&sb_flow_id=f1` calls `mockExchange("abc", { flowId: "f1" })`, and `?code=abc` calls `mockExchange("abc", undefined)`; `redirectType: "recovery"` with no `next` goes to `/auth/reset-password`; success with `next=/portfolio` goes to `/portfolio`; `next=//evil.example` goes to `/`; exchange error with `next=/auth/reset-password` goes to `/auth/reset-password`; exchange error with no `next` goes to `/auth/login?error=auth_link`; no `code` redirects to `next` and `mockExchange` is not called; `?type=recovery` with no code goes to `/` (the old branch is gone); `?error=access_denied&error_code=otp_expired&next=/auth/reset-password` (no code) goes to `/auth/reset-password`; `?error=access_denied&error_code=otp_expired` (no code, no next) goes to `/auth/login?error=auth_link`. For the exchange-error cases return `{ data: { user: null, session: null, redirectType: null }, error: { name: "AuthPKCECodeVerifierMissingError", status: 400 } }` from `mockExchange`.

7. `frontend/app/context/__tests__/AuthContext.test.tsx` (update):
   - Remove `mockResetPasswordForEmail` (line 20) and the `auth` key from the `../../lib/supabase` mock (lines 28-30); keep `from`.
   - Update the header comment (lines 4-7): `supabase` is only used for the profiles SELECT.
   - Replace the `resetPassword` describe (lines 265-281) with two tests: (a) `resetPassword("reset@example.com", "captcha-r")` POSTs to `/api/auth/forgot-password` with `x-pokefin-request: 1`, `Content-Type: application/json` and body `{ email: "reset@example.com", captchaToken: "captcha-r" }`, and returns `{ error: null }`; (b) a `{ ok: false, status: 429, json: { error: "Too many emails requested. Please wait a few minutes and try again." } }` response returns an error whose `message` is that string.
   - In the `updatePassword` describe add a case: `updatePassword("newSecurePassword123", "oldPassword12")` sends body `{ password: "newSecurePassword123", currentPassword: "oldPassword12" }`. Keep the existing case unchanged (it proves the one-argument call still sends `{ password }` only).

8. `frontend/app/lib/__tests__/supabase.test.ts` (update): line 66 expects `{ auth: { flowType: "pkce", detectSessionInUrl: false } }`. No other change.

## Verification

Run from `frontend/`:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
# expect: no output, exit 0

pnpm exec eslint proxy.ts next.config.ts app/lib app/api/auth app/auth app/account/page.tsx app/context
# expect: error count not higher than the baseline recorded in "Before you start" check 10

pnpm test --ci app/lib/__tests__/rateLimit.test.ts app/lib/__tests__/proxy.rateLimit.test.ts \
  app/lib/__tests__/authErrors.test.ts app/lib/__tests__/validation.test.ts \
  app/lib/__tests__/supabase.test.ts app/api/auth/__tests__ app/auth/callback/__tests__ \
  app/context/__tests__/AuthContext.test.tsx
# expect: all suites pass

pnpm test --ci
# expect: all suites pass; the total test count is the pre-PR count plus the new cases (record both in the PR)

pnpm build:stub
# expect: build succeeds; /api/auth/forgot-password listed as a dynamic route (ƒ)
grep -oE '"unoptimized": ?[a-z]+' .next/images-manifest.json
# expect: "unoptimized": true   (the manifest is pretty-printed with a space after the colon)

# Code-level checks
grep -rn "error\.message" app/api/auth --include=route.ts
# expect: no output
grep -rn "length < 8\|At least 8" app | grep -v __tests__
# expect: no output
grep -rn "resetPasswordForEmail" app | grep -v __tests__
# expect: only app/api/auth/forgot-password/route.ts
grep -n 'type === "recovery"' app/auth/callback/route.ts
# expect: no output
grep -n "detectSessionInUrl" app/lib/supabase.ts
# expect: app/lib/supabase.ts:24  auth: { flowType: "pkce", detectSessionInUrl: false },
grep -n "current_password" app/api/auth/update-password/route.ts
# expect: one line, the updateUser call
grep -rn 'autoComplete="current-password"' app/auth/login/page.tsx app/account/page.tsx
# expect: two lines, one per file
```

Manual checks:

1. Limiter against a production build. After `pnpm build:stub`, run `pnpm exec next start -p 3100` in one shell, then in another:

   ```bash
   for i in $(seq 1 15); do curl -s -o /dev/null -w "%{http_code} " http://localhost:3100/auth/login; done; echo
   # expect: fifteen 200s
   for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3100/api/auth/sign-in \
     -H 'content-type: application/json' -d '{}'; done; echo
   # expect: ten 403s (no CSRF header), then 429
   curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/api/auth/sign-up -H 'content-type: application/json' -d '{}'
   # expect: 403, not 429 (separate per-path bucket)
   curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3100/_next/image?url=https%3A%2F%2Fx.supabase.co%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fa.png&w=64&q=75"
   # expect: 404 (next-server.js renders 404 for /_next/image when images.unoptimized is true)
   ```

2. Forms in dev. Put the Cloudflare always-pass test site key in `.env.local`: `NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA`, run `pnpm dev`, and check:
   - `/auth/forgot-password` shows the Turnstile widget; "Send Reset Link" is disabled until it succeeds.
   - `/auth/signup`: hint reads "At least 12 characters"; a 9-character password shows "Password must be at least 12 characters long." without a network request (browser native `minLength` bubble or the app message); a 33-character username cannot be typed past 32; `ab` shows the username message.
   - `/auth/login` with a wrong password (needs real Supabase env): message is "Incorrect email or password.", the widget re-renders, and the button stays disabled until a new token arrives.
   - In DevTools, inputs carry the `autoComplete` values from steps 12 to 16.
   - `/account` (needs real Supabase env and a signed-in test user): the password form has a "Current Password" field; submitting with it empty shows "Please enter your current password." without a network request (native `required` bubble or the app message).

## Owner actions

1. **Confirm Supabase captcha is on.** Supabase dashboard, Authentication, Attack Protection, "Enable Captcha protection" with provider Turnstile and the secret set. After deploy, confirm from a shell:

   ```bash
   curl -s -X POST https://pokefin.ca/api/auth/sign-in -H 'content-type: application/json' \
     -H 'x-pokefin-request: 1' -H 'origin: https://pokefin.ca' \
     -d '{"email":"nobody@example.com","password":"x","captchaToken":"invalid"}'
   ```

   Expect `"code":"captchaFailed"`. If the reply is `"code":"invalidCredentials"`, captcha is off in Supabase: turn it on. Without `captchaToken` the reply must be `"code":"captchaRequired"` (the app gate).
2. **Redirect allowlist.** Authentication, URL Configuration: keep Site URL `https://pokefin.ca`; add `https://pokefin.ca/auth/callback**` to Redirect URLs (and `http://localhost:3000/auth/callback**` for dev); remove the stale `https://pokefin.ca/auth/reset-password` entry. Confirm by the end-to-end reset in item 5.
3. **Email templates.** Authentication, Email Templates, "Reset Password" and "Confirm signup": the link must be the default `{{ .ConfirmationURL }}`. If either was hand-edited to a fixed URL or to `/auth/callback?type=recovery`, restore `{{ .ConfirmationURL }}`.
4. **Vercel environment and canonical host.** Vercel, Project Settings, Environment Variables: `NEXT_PUBLIC_SITE_URL` must be exactly `https://pokefin.ca` in Production. The PKCE verifier cookie is host-only, so the reset must be requested on the same host the link returns to. Run `curl -sI https://www.pokefin.ca/auth/forgot-password | grep -i '^location'`; expect a 307/308 to `https://pokefin.ca/...`. If there is no redirect, in Vercel, Domains, set `pokefin.ca` as primary and `www.pokefin.ca` to redirect to it. `NEXT_PUBLIC_*` values are inlined at build time, so redeploy after changing one. Preview deployments without their own `NEXT_PUBLIC_SITE_URL` fall back to `https://pokefin.ca`, so reset and confirmation emails sent from a preview point at production; that is expected, and the Redirect URL allowlist does not need preview hosts.
5. **End-to-end reset on production** (after deploy and items 1 to 4). Open `https://pokefin.ca/auth/forgot-password` in a private window, solve the widget, submit your own address; open the email link in the same browser; you must land on "Set new password"; set a 12+ character password and see "Password updated". In Supabase, Authentication, Logs, the sequence `user_recovery_requested`, `login`, `user_updated_password` must appear. Record the result next to `audits/HARDENING_FOLLOWUPS.md` section 2.
6. **Require the current password on password change (F078).** After this PR is deployed (so the new error codes show clear messages), Supabase dashboard, Authentication, Providers (or Sign In / Providers), Email: turn on the option that requires the current password when a user changes their password (GoTrue setting `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD`). Then check, signed in on `https://pokefin.ca/account`: a wrong current password shows "Your current password is incorrect." and the password does not change; the right one succeeds. Repeat owner action 5 once to confirm the recovery flow still works (GoTrue exempts recovery sessions). **Fallback if the dashboard does not offer that option:** turn on "Secure password change" on the same page instead; sessions older than 24 hours then see "For your security, please sign out, sign in again, and then change your password.", and a fresh session succeeds. Record which option you enabled in the new `HARDENING_FOLLOWUPS.md` row and mark it Done. If only the fallback was possible, add a line under section 2 that the `/account` current-password field is sent but not yet verified by GoTrue.
7. **Optional, recommended (F077 verifier): Vercel Firewall rate rule.** The in-app limiter is per serverless instance. In Vercel, Project, Firewall, add a rate-limit rule: `POST` requests whose path is `/api/auth/sign-in`, `/api/auth/sign-up` or `/api/auth/forgot-password`, 10 requests per 60 seconds per IP, action "Too Many Requests". No code change. Record it in `HARDENING_FOLLOWUPS.md` section 4 if you add it.

## Acceptance criteria

- [ ] `classifyRoute` returns `null` for `/auth/login`, `/auth/signup`, `/auth/forgot-password`, `/auth/reset-password`; `"general"` for `/auth/callback`, `/api/auth/me`, `/api/auth/sign-out`; `"sensitive"` for the four credential endpoints and `/api/account/*`.
- [ ] Fifteen consecutive GETs of `/auth/login` from one IP never return 429; the eleventh `POST /api/auth/sign-in` within a minute from one IP returns 429 while `/api/auth/sign-up` from the same IP still does not.
- [ ] `POST /api/auth/sign-in`, `/sign-up` and `/forgot-password` without `captchaToken` return 400 "Please complete the captcha check and try again." without calling Supabase.
- [ ] `/auth/forgot-password` renders the Turnstile widget and its submit button is disabled until a token exists.
- [ ] After a failed submit on login, signup or forgot-password, the widget resets and the button is disabled until a new token arrives.
- [ ] `grep -rn "resetPasswordForEmail" frontend/app` (excluding tests) matches only the forgot-password route, and it passes `captchaToken` and `redirectTo: https://pokefin.ca/auth/callback?next=%2Fauth%2Freset-password`.
- [ ] `/auth/callback` has no `type === "recovery"` branch, checks the exchange result, passes `sb_flow_id` as `flowId`, sends failed recovery exchanges (and GoTrue `?error=` redirects with `next=/auth/reset-password`) to `/auth/reset-password` and other failures to `/auth/login?error=auth_link`.
- [ ] `app/lib/supabase.ts` sets `detectSessionInUrl: false`.
- [ ] Signup, reset-password and account forms show "At least 12 characters" and reject 11-character passwords client-side; sign-up and update-password routes reject them with 400.
- [ ] The sign-up route rejects usernames that fail `/^[A-Za-z0-9_]{3,32}$/` with 400, and a GoTrue 500 becomes 409 "We could not create your account. That username may already be taken...".
- [ ] No `/api/auth/*` route returns `error.message`; every Supabase error branch returns `mapAuthError(...)` output (`{ error, code }` from `AUTH_MESSAGES`), and every new captcha, username and password check returns `authMessage(...)` output. The pre-existing fixed strings ("Invalid body", "Email and password are required", "Password is required", the CSRF "Forbidden" and "Payload too large") are unchanged.
- [ ] `/account` has a "Current Password" field (`autoComplete="current-password"`), and `POST /api/auth/update-password` forwards it as `current_password` only when present; the reset-password page sends no current password.
- [ ] Every auth input has the `autoComplete` value from steps 12 to 16; every error box on the login, signup, forgot-password, reset-password and account pages has `role="alert"`.
- [ ] `.next/images-manifest.json` has `"unoptimized": true` and `next.config.ts` has no `remotePatterns`.
- [ ] `pnpm exec tsc --noEmit`, the full `pnpm test --ci` and `pnpm build:stub` pass; no new lint errors in touched files.
- [ ] Owner actions 1 to 5 confirmed on production; action 6 done (primary option or fallback, recorded in `HARDENING_FOLLOWUPS.md`); action 7 done or noted as skipped.

## Rollback

- Code: `git revert <merge commit>` and redeploy. No migrations are added, so there is nothing to undo in the database.
- If you revert this PR after owner action 6, turn the option from action 6 off first. With "require current password" on and this PR reverted, `/account` sends no current password and every password change there fails; with the "Secure password change" fallback on, sessions older than 24 hours get a generic error instead of the re-sign-in message.
- The Redirect URL allowlist additions and template checks are harmless to leave in place after a revert. After a revert, password reset returns to its broken pre-PR state (no captcha token, no redirect), so prefer a forward fix over a revert for anything touching the reset flow.
- Partial rollback: steps 4 and 5 (limiter) and step 17 (`next.config.ts`) are independent of the rest and can be reverted alone if they misbehave.

## Commit and PR

Commit message:

```text
fix(auth): rate-limit credentials not pages, require captcha, wire password reset

- rateLimit: /auth/* pages are no longer limited; sign-in, sign-up,
  update-password, forgot-password and /api/account/* get 10/min per IP
  per path; /auth/callback and other /api/* stay general (F077)
- sign-in/sign-up/forgot-password require a captcha token; Supabase stays
  the only verifier; widgets reset after a failed submit (F019)
- new POST /api/auth/forgot-password with redirectTo
  <SITE_URL>/auth/callback?next=/auth/reset-password; callback routes via
  safeNextPath, passes sb_flow_id and checks the exchange result; browser
  client stops auto-exchanging ?code= (F079)
- PASSWORD_MIN_LENGTH = 12 and USERNAME_RE shared by forms and routes;
  autoComplete and role=alert on auth forms (F024, F132)
- app/lib/authErrors.ts maps GoTrue error codes to fixed messages; no
  /api/auth route returns error.message (F024, F132)
- /account asks for the current password and update-password forwards it
  as current_password; GoTrue enforces it once the dashboard option is on
  (F078)
- next.config: images.unoptimized, remotePatterns removed (F075)
```

PR title: `fix(auth): rate-limit credentials not pages, require captcha, wire password reset (WP02)`

PR body summary: list the findings covered (F077, F019, F079, F024, F132, F075, F078) with one line each as in the metadata above; paste the Verification output (tsc, lint counts before and after, jest summary, `pnpm build:stub` tail, the `images-manifest` grep, and the manual curl loop results); copy the Owner actions section verbatim as a checklist; note the interactions: WP04 rebases onto the `AuthContext.resetPassword` and `updatePassword(newPassword, currentPassword?)` changes and the account password section (it must keep the two-argument `updatePassword` and its `{ password, currentPassword }` body when it rewrites `AuthContext`, and should use `autoComplete="nickname"` rather than `"username"` on the account username input for the reason in step 14); WP04's fallback route name `/api/auth/reset-password` is not needed because the route here is `/api/auth/forgot-password`; WP12's pitfall "do not remove `images.remotePatterns`" is superseded by F075 here; WP13 should render `?error=auth_link` on the login page and move `safeNextPath` to `app/lib/redirects.ts`; WP20 consolidates the callback's inline Supabase client; WP17 owns CSP. List any out-of-scope issues noticed (for example the plain-text 429 body for document requests, or `/auth/:path*` still in the proxy matcher, which costs one `getUser()` per auth page load) instead of fixing them.
