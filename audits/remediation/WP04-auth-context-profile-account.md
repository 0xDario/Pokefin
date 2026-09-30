# WP04: Restore signed-in features, part 1: session, profile and account

- **Findings covered**
  - F001 (partial, cluster members F001, F018): the browser Supabase client never has a session because session cookies are HttpOnly, so every client-side user-table query runs as `anon` and is rejected by RLS. **In scope here (part 1):** the profile read moves into `GET /api/auth/me`, the username write moves to a new `PATCH /api/profile`, and `AuthContext.tsx` and `account/page.tsx` stop importing `app/lib/supabase`. Portfolio access is WP05, box recipes are WP06.
  - F058 (full for the auth part, cluster members F058, F062, F106): `AuthContext` replaces `user`/`profile` object identity on every window focus and rebuilds the context value (and every callback) on every render, so the `/account` username field is reset while the user types and every `useAuth()` consumer re-renders. Two parts of this cluster are deliberately NOT done here: F106's exchange-rate TTL note is the same defect as F150, which WP11 step 8a fixes (WP11 also forbids `exchangeRate.ts` importing `clientMarketData.ts`); switching `useBoxRecipes`/`BoxCalculator` from `user` to `user?.id` is WP06. This package removes the identity churn at its source, which is what makes the `/account` bug go away.
  - F063 (full): any failed `/api/auth/me` call (network error, 429, 5xx) is treated as "signed out", so a transient error on tab focus flips the header to "Sign In" and bounces the user from `/portfolio` or `/account` to the login page.
  - F124 (full): the header shows a pulsing skeleton in the auth slot on every page until `/api/auth/me` answers, instead of defaulting to the signed-out "Sign In / Sign Up" UI.
- **Priority rationale**: every signed-in user has had no username in the header and a broken "Update Username" form since 2026-05-27, and this package also builds the session state (`sessionStatus`) that WP05 and WP06 need to restore the portfolio and box recipes.
- **Effort**: M, about 6 to 8 hours including tests.
- **Depends on**:
  - WP02, which must have merged. It provides `USERNAME_RE`, `USERNAME_FORMAT_MESSAGE`, `USERNAME_HINT` and `USERNAME_MAX_LENGTH` in `app/lib/validation.ts` (WP02 step 1). It also creates `POST /api/auth/forgot-password` and makes `AuthContext.resetPassword(email, captchaToken?)` call it (WP02 steps 9 and 11), and it edits the password section of `account/page.tsx` (WP02 step 16: a `validation` import and a hidden `autoComplete="username"` email field).
  - WP03 (merged before this package in plan order): it adds refs and an Escape handler to `Header.tsx` and creates `app/components/__tests__/Header.test.tsx`.
  - WP00, for `pnpm build:stub`.
- **Unblocks**: WP05, WP06, WP13 directly; WP12 through them. WP05 and WP06 extend the ESLint guard list created in step 9.
- **Suggested branch name**: `remediation/wp04-auth-context-profile-account`
- **Risk level**: medium. `AuthContext` is mounted on every page (`app/layout.tsx:48`); a mistake shows the wrong header state site-wide. The route-level and context-level tests below cover each state transition, and no database or environment change is involved.

## Why

Since commit `fec21dc` (2026-05-27) the session lives only in HttpOnly cookies, which the browser Supabase client (`frontend/app/lib/supabase.ts:23`) cannot read, so its `profiles` SELECT (`AuthContext.tsx:57-70`) and UPDATE (`account/page.tsx:65-68`) go out as `anon` and PostgREST answers 401 with code 42501 (confirmed in production edge logs: zero 2xx responses on user tables from the browser client). Signed-in users therefore see their email prefix instead of their username in the header, and "Update Username" fails with the raw text "permission denied for table profiles". On top of that, `AuthContext` signs the user out locally on any network blip, 429 or 5xx during a tab-focus refresh (`AuthContext.tsx:82-86, 94-97`), which kicks them off `/portfolio` and `/account`; it also replaces its objects on every focus, which wipes an unsaved username edit, and it shows a skeleton in the header of every page for every visitor. After this PR the profile is read and written server-side with the cookie session, the header shows the username, a transient failure never signs anyone out, focus refreshes are rate-limited and cause no re-render when nothing changed, and anonymous visitors see "Sign In / Sign Up" immediately.

## Before you start

Read these files fully. Line numbers are from HEAD `a188fea`. Earlier packages move some of them: WP02 adds one import line near the top of `account/page.tsx` (so its later lines are one higher) and lengthens `resetPassword` in `AuthContext.tsx`; WP03 adds about 20 lines near the top of `Header.tsx` (so its auth-slot lines are about 20 higher). Always match on the quoted code, not the number.

- `frontend/app/context/AuthContext.tsx` (230 lines at HEAD, longer after WP02). Key spots: `:5` browser-client import; `:57-70` `fetchProfile`; `:75-98` `refreshSession` (clears state on any failure at `:82-86` and `:94-97`); `:100-118` boot and focus effect; `:120-204` five auth methods as plain functions; `resetPassword` (after WP02 it `fetch`es `/api/auth/forgot-password`); the inline context value at the end of `AuthProvider`.
- `frontend/app/api/auth/me/route.ts` (20 lines). Returns `{ user }` and turns every `getUser()` error into `{ user: null }`.
- `frontend/app/account/page.tsx` (368 lines at HEAD). Key spots (HEAD numbers; add 1 after WP02's import line): `:6` browser-client import; `:13` username state; `:33-37` effect that copies `profile.username` into state on every `profile` identity change (current lint error `react-hooks/set-state-in-effect` at `:35`); `:39-44` redirect on `!loading && !user`; `:46-82` username handler with the browser UPDATE at `:65-68` and raw `error.message` at `:74`; `:172-189` loading and redirect render guards; `:222-231` the username input and its hint. WP02 added `import { PASSWORD_HINT, PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT_MESSAGE } from "../lib/validation";` and a hidden `autoComplete="username"` email input inside the password form.
- `frontend/app/components/Header.tsx` (310 lines at HEAD, about 330 after WP03). Key spots (HEAD numbers): `:45` `useAuth()` destructure; `:73` `displayName`; `:117-119` desktop skeleton; `:250-255` mobile skeleton.
- `frontend/app/components/__tests__/Header.test.tsx` (created by WP03). Its `MockAuth` type and `mockAuth` objects have `loading` but no `sessionStatus`.
- `frontend/app/portfolio/page.tsx` (104 lines). `:10` destructure; `:34-39` redirect effect; `:41-58` render guards.
- `frontend/app/auth/reset-password/page.tsx:27` and `:71-104` (shows "Link invalid or expired" whenever `user` is null after loading, including after a network failure).
- `frontend/app/auth/forgot-password/page.tsx` (the only caller of `resetPassword`; after WP02 it calls `resetPassword(email, captchaToken)`).
- `frontend/app/lib/validation.ts` (WP02 added the username constants) and `frontend/app/lib/authErrors.ts` (WP02; `AUTH_MESSAGES` is a pure module safe to import from client code).
- Route pattern to copy: `frontend/app/api/auth/sign-in/route.ts`, `frontend/app/api/auth/update-password/route.ts`, `frontend/app/lib/csrf.ts`, `frontend/app/lib/routeSupabase.ts`, `frontend/app/lib/logger.ts`.
- `frontend/app/context/__tests__/AuthContext.test.tsx` (it mocks `lib/supabase` wholesale, which is why the anon bug shipped).
- `frontend/eslint.config.mjs` (35 lines), `frontend/jest.config.js` (jsdom by default).
- `frontend/proxy.ts:11-14, 69-89` (the server already redirects anonymous requests for `/account` and `/portfolio` to `/auth/login?next=...`; the client redirects in those pages only matter when a session ends while the page is open).
- `migrations/0003_integrity_constraints.sql:66-68` (`profiles_username_format` CHECK `username IS NULL OR username ~ '^[A-Za-z0-9_]{3,32}$'`), `schema.sql:78-86` (`username text UNIQUE`), `migrations/0014_rls_perf_and_dedupe.sql:55-58` (`profiles_self` policy, `FOR ALL TO authenticated`), `migrations/0004_handle_new_user_trigger.sql` (profile rows are created only by the trigger).

Confirm the starting state (run from `frontend/`):

```bash
# 1. Both files still import the anonymous browser client.
grep -n 'lib/supabase"' app/context/AuthContext.tsx app/account/page.tsx
# expect: app/context/AuthContext.tsx:5 and exactly one hit in app/account/page.tsx (:6 or :7, depending on where WP02 put its import)

# 2. Any failure clears the user (F063).
grep -n "setUser(null)" app/context/AuthContext.tsx
# expect: exactly three hits (:83, :95, :175)

# 3. Header skeletons (F124).
grep -n "loading ?" app/components/Header.tsx
# expect: exactly two hits (desktop and mobile auth slot)

# 4. The only lint error in the files this package touches.
pnpm exec eslint app/account/page.tsx app/context/AuthContext.tsx app/components/Header.tsx app/portfolio/page.tsx app/auth/reset-password/page.tsx app/api/auth/me/route.ts
# expect: exactly 1 error, react-hooks/set-state-in-effect in app/account/page.tsx
# (at :35:7 on HEAD, :36:7 after WP02's import line)

# 5. WP02 has landed. Every command must print what its comment says.
grep -c "export const USERNAME_RE\|export const USERNAME_FORMAT_MESSAGE\|export const USERNAME_HINT\|export const USERNAME_MAX_LENGTH" app/lib/validation.ts
# expect: 4
grep -n '"/api/auth/forgot-password"' app/context/AuthContext.tsx
# expect: 1 hit (inside resetPassword)
grep -rln "resetPasswordForEmail" app --include=*.ts --include=*.tsx | grep -v __tests__
# expect: only app/api/auth/forgot-password/route.ts
ls app/components/__tests__/Header.test.tsx
# expect: the file exists (WP03)
# If any of the first three checks fails, WP02 has not landed: STOP and report it.
# Do not recreate WP02's work here. If only the Header test is missing, skip step 6d.

# 6. Record the full lint baseline (the error count on the last line). Verification compares against it.
pnpm run lint 2>&1 | tail -3

# 7. Baseline tests pass.
pnpm test --ci app/context
```

Names used below, all from WP02's `app/lib/validation.ts`: `USERNAME_RE` (`/^[A-Za-z0-9_]{3,32}$/`), `USERNAME_FORMAT_MESSAGE` (the fixed rules message), `USERNAME_HINT` (the input hint), `USERNAME_MAX_LENGTH` (32). Do not create a separate `username.ts` module (WP02 step 1 says so explicitly).

## Implementation steps

Order: steps 2 to 4 (server side and helpers) first, then step 5 (`AuthContext`), then steps 6 to 8 (consumers), then 9 (lint guard), 10 (docs), and the tests in the Tests section. Steps 1 and 11 are intentionally empty (kept so that step numbers cited by WP05, WP06, WP12, WP13 and WP15 stay valid). Commit only when the Verification section is green.

### Step 1. No username module (WP02 provides the rules)

Do not create any file. Import `USERNAME_RE`, `USERNAME_FORMAT_MESSAGE`, `USERNAME_HINT` and `USERNAME_MAX_LENGTH` from `app/lib/validation.ts` (WP02 step 1) wherever this spec needs them. Check 5 in "Before you start" already confirmed they exist.

### Step 2. Shared "is this an authoritative signed-out answer" helper

Create `frontend/app/lib/authSession.ts`. Both routes in steps 3 and 4 use it. The point: `supabase.auth.getUser()` returns `user: null` both when there is no session (authoritative) and when GoTrue is unreachable or rate-limiting (not authoritative). Verified against the installed auth-js 2.112: no cookie gives `AuthSessionMissingError` (status 400); an invalid or already-rotated refresh token gives `AuthApiError` 400/401/403; a network failure gives `AuthRetryableFetchError` with status 0; 500-504 and 520-530 give `AuthRetryableFetchError` with that status; a GoTrue `session_not_found` (the user signed out elsewhere) is converted to `AuthSessionMissingError`; a non-JSON 4xx body gives `AuthUnknownError`, which this helper treats as not authoritative (`node_modules/.pnpm/@supabase+auth-js@2.112.2/node_modules/@supabase/auth-js/dist/main/lib/fetch.js:32-86`, and `_getUser` in `GoTrueClient.js`). The two predicates used below are re-exported by `@supabase/supabase-js` (its `index.d.cts` has `export * from "@supabase/auth-js"`).

```ts
import { isAuthApiError, isAuthSessionMissingError } from "@supabase/supabase-js";

/**
 * True when a failed supabase.auth.getUser() really means "no valid session"
 * (no cookie, or GoTrue rejected the token with a 4xx other than 429).
 * False for network failures, 5xx and 429: those say nothing about the session
 * and must never sign the user out.
 */
export function isAuthoritativeSignedOut(error: unknown): boolean {
  if (!error) return true;
  if (isAuthSessionMissingError(error)) return true;
  if (isAuthApiError(error)) {
    const status = error.status ?? 0;
    return status >= 400 && status < 500 && status !== 429;
  }
  return false;
}
```

Do not add `import "server-only"` here; it has no secrets and the tests import it directly.

### Step 3. `GET /api/auth/me` returns `{ user, profile }`, and 503 when it cannot tell

Replace the whole of `frontend/app/api/auth/me/route.ts`:

```ts
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createRouteSupabaseClient } from "../../../lib/routeSupabase";
import { isAuthoritativeSignedOut } from "../../../lib/authSession";
import { logCaughtError, logSupabaseError } from "../../../lib/logger";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Returns the caller's user and profile from the HttpOnly session cookie.
 * The browser Supabase client cannot read those cookies (it always runs as
 * anon, and RLS rejects anon on profiles), so AuthContext calls this route at
 * boot and on window focus, and the profile read happens here with the
 * cookie-backed server client (review F001).
 *
 * Contract relied on by AuthContext:
 *   200 { user: null, profile: null }        authoritative: not signed in
 *   200 { user, profile }                    signed in (profile may be null if no row)
 *   200 { user, profile: null, profileError: true }  signed in, profile read failed
 *   503 { error }                            could not determine the session
 * No CSRF guard: read-only, reflects only the caller's own session, and
 * never returns tokens.
 */
export async function GET() {
  const supabase = await createRouteSupabaseClient();

  let user: User | null = null;
  let userError: unknown = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    userError = result.error;
  } catch (err) {
    logCaughtError("auth_me_get_user_threw", err);
    return NextResponse.json(
      { error: "Session check unavailable" },
      { status: 503, headers: NO_STORE }
    );
  }

  if (!user) {
    if (isAuthoritativeSignedOut(userError)) {
      return NextResponse.json({ user: null, profile: null }, { headers: NO_STORE });
    }
    logSupabaseError("auth_me_unavailable", userError as { message?: unknown; code?: unknown; name?: unknown });
    return NextResponse.json(
      { error: "Session check unavailable" },
      { status: 503, headers: NO_STORE }
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, username, email")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    logSupabaseError("profile_fetch_failed", profileError);
    return NextResponse.json(
      { user, profile: null, profileError: true },
      { headers: NO_STORE }
    );
  }

  return NextResponse.json({ user, profile: profile ?? null }, { headers: NO_STORE });
}
```

Notes: `.eq("id", user.id)` is redundant with RLS but keeps the query plan to one row and documents intent. Do not add `export const revalidate` or any caching; the route reads `cookies()` and is dynamic. F124's optional idea of skipping the proxy's `getUser()` for `/api/auth/*` is deliberately not done: the proxy's call is what rotates the refresh-token cookies (audit F-5), and removing it is a session-lifecycle change outside this package.

### Step 4. `PATCH /api/profile` (new)

4a. Create `frontend/app/api/profile/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createRouteSupabaseClient } from "../../lib/routeSupabase";
import { rejectIfBodyTooLarge, rejectIfCsrfFails } from "../../lib/csrf";
import { isAuthoritativeSignedOut } from "../../lib/authSession";
import { logSupabaseError } from "../../lib/logger";
import { USERNAME_FORMAT_MESSAGE, USERNAME_RE } from "../../lib/validation";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const UPDATE_FAILED = "Could not update username. Please try again.";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Update the caller's username. Replaces the browser-side
 * supabase.from("profiles").update(...) that ran as anon and always failed
 * (review F001). Only `username` is accepted: profile rows are created by the
 * on_auth_user_created trigger and no other column is client-writable here.
 */
export async function PATCH(req: NextRequest) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, 1024);
  if (tooLarge) return tooLarge;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid body" }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return json({ error: "Invalid body" }, 400);
  }

  const raw = (body as { username?: unknown }).username;
  const username = typeof raw === "string" ? raw.trim() : "";
  if (!USERNAME_RE.test(username)) {
    return json({ error: USERNAME_FORMAT_MESSAGE }, 400);
  }

  const supabase = await createRouteSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (!user) {
    if (isAuthoritativeSignedOut(userError)) {
      return json({ error: "Unauthorized" }, 401);
    }
    return json({ error: "Service temporarily unavailable. Please try again." }, 503);
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ username })
    .eq("id", user.id)
    .select("id, username, email")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return json({ error: "Username is taken" }, 409);
    if (error.code === "23514") return json({ error: USERNAME_FORMAT_MESSAGE }, 400);
    logSupabaseError("profile_update_failed", error);
    return json({ error: UPDATE_FAILED }, 500);
  }
  if (!data) {
    // No profiles row for this user (trigger never ran). Do not insert one
    // from here: row creation is the trigger's job (migration 0004, audit M-10).
    return json({ error: UPDATE_FAILED }, 404);
  }

  return json({ profile: data });
}
```

`/api/profile` falls under the proxy's `general` rate-limit class (60/min per IP) through WP02's `if (path.startsWith("/api/")) return "general";` in `classifyRoute` (`app/lib/rateLimit.ts`). That is correct; do not add it to WP02's `SENSITIVE_PATHS`. Do not add a GET handler: the profile read is in `/api/auth/me`.

Password reset needs no route here: WP02 already moved `resetPasswordForEmail` into `POST /api/auth/forgot-password` and `AuthContext.resetPassword` already calls it. Do not create `app/api/auth/reset-password/route.ts`.

### Step 5. Rewrite `frontend/app/context/AuthContext.tsx`

Replace the whole file with the version below. What changes and why:

- No import of `../lib/supabase` (F001). The profile arrives with `/api/auth/me`; username writes go through `updateUsername` to `PATCH /api/profile`; `resetPassword` keeps calling WP02's `POST /api/auth/forgot-password`.
- `sessionStatus: "unknown" | "anonymous" | "authenticated"` (F063). Only an authoritative answer changes it: a 200 with `user: null`, or a 401/403. Network errors, 429 and 5xx (including the new 503) keep the previous state.
- Focus refresh is skipped when the tab is not visible or when the last refresh started less than 30 s ago (F063). Explicit calls (`refreshSession()` from a "Try again" button, the refresh after sign-in) are never debounced. Concurrent calls share one request.
- Identity stability (F058): an unchanged payload returns the previous state object, so React bails out and no consumer re-renders; all methods are `useCallback`, the context value is `useMemo`.
- Results of a refresh that started before a sign-in, sign-up or sign-out are dropped (generation counter), so a slow boot request cannot overwrite a fresh sign-in.
- `loading` is kept with its current meaning (true until the first `/api/auth/me` attempt settles) because WP03's Header test mock and other packages read it.
- `resetPassword` is WP02's body unchanged (signature `(email: string, captchaToken?: string)`, URL `/api/auth/forgot-password`, fallback message `"Could not send the reset email"`), only wrapped in `useCallback`. Before replacing the file, diff WP02's `resetPassword` against the block below; if WP02's merged version differs in any detail (URL, body, fallback string), keep WP02's version inside the `useCallback`.
- Every other method body (`signUp`, `signIn`, `signOut`, `updatePassword`) keeps the request it sends today (URL, headers, JSON body); only the state handling around it changes.

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthError, User } from "@supabase/supabase-js";

/**
 * "unknown": no authoritative answer yet (boot, or every check so far failed
 * with a network error / 429 / 5xx). "anonymous": the server said there is no
 * valid session. "authenticated": the server returned a user.
 */
export type SessionStatus = "unknown" | "anonymous" | "authenticated";

export interface UserProfile {
  id: string;
  username: string | null;
  email: string | null;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  sessionStatus: SessionStatus;
  /** True only until the first /api/auth/me attempt settles (answer or failure). */
  loading: boolean;
  /** Re-check the session now (not debounced). Never signs out on a transient failure. */
  refreshSession: () => Promise<void>;
  signUp: (email: string, password: string, username: string, captchaToken?: string) => Promise<{ error: AuthError | null }>;
  signIn: (email: string, password: string, captchaToken?: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string, captchaToken?: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: AuthError | null }>;
  /** PATCH /api/profile. Returns a user-safe message on failure. */
  updateUsername: (username: string) => Promise<{ error: string | null }>;
}

/** A window focus re-checks the session at most this often. */
export const FOCUS_REFRESH_MIN_INTERVAL_MS = 30_000;

const USERNAME_UPDATE_FAILED = "Could not update username. Please try again.";
const RATE_LIMITED = "Too many requests. Please wait a minute and try again.";
const NETWORK_ERROR = "Network error. Please try again.";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const FETCH_HEADERS = {
  "Content-Type": "application/json",
  "x-pokefin-request": "1",
} as const;

type AuthSnapshot = {
  status: SessionStatus;
  user: User | null;
  profile: UserProfile | null;
};

/** `profile: undefined` means "not known in this update": keep the current one for the same user. */
type IncomingAuth = { user: User | null; profile?: UserProfile | null };

type MeResponse = {
  user?: User | null;
  profile?: UserProfile | null;
  profileError?: boolean;
};

const INITIAL_SNAPSHOT: AuthSnapshot = { status: "unknown", user: null, profile: null };

/**
 * Coerce an arbitrary thrown value or fetch error into the shape the
 * UI expects (`AuthError | null`). We only need a `.message` string,
 * but keep the AuthError type for backwards-compat with the auth pages.
 */
function asAuthError(message: string): AuthError {
  return { name: "AuthError", message, status: 0 } as AuthError;
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === "string") return data.error;
  } catch {
    /* ignore parse errors */
  }
  return fallback;
}

/** Structural equality for the small JSON payloads /api/auth/me returns. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Returns `prev` itself when nothing changed, so React skips the re-render. */
function nextSnapshot(prev: AuthSnapshot, incoming: IncomingAuth): AuthSnapshot {
  if (!incoming.user) {
    if (prev.status === "anonymous" && prev.user === null && prev.profile === null) return prev;
    return { status: "anonymous", user: null, profile: null };
  }
  const user = sameJson(prev.user, incoming.user) ? (prev.user as User) : incoming.user;
  let profile: UserProfile | null;
  if (incoming.profile === undefined) {
    profile = prev.profile && prev.profile.id === user.id ? prev.profile : null;
  } else {
    profile = sameJson(prev.profile, incoming.profile) ? prev.profile : incoming.profile;
  }
  if (prev.status === "authenticated" && prev.user === user && prev.profile === profile) {
    return prev;
  }
  return { status: "authenticated", user, profile };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(INITIAL_SNAPSHOT);
  const [initialCheckDone, setInitialCheckDone] = useState(false);

  const lastRefreshStartedAt = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  // Bumped by sign-in / sign-up / sign-out so an older in-flight
  // /api/auth/me answer cannot overwrite the new state.
  const generation = useRef(0);

  const apply = useCallback((incoming: IncomingAuth) => {
    setSnapshot((prev) => nextSnapshot(prev, incoming));
  }, []);

  const invalidatePending = useCallback(() => {
    generation.current += 1;
    inFlight.current = null;
  }, []);

  // Always issues a new request. Use refreshSession() to share an in-flight one.
  const startRefresh = useCallback((): Promise<void> => {
    const gen = generation.current;
    lastRefreshStartedAt.current = Date.now();
    const request = (async () => {
      let res: Response;
      try {
        res = await fetch("/api/auth/me", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
      } catch {
        return; // Network error says nothing about the session: keep state.
      }
      if (gen !== generation.current) return;
      if (res.status === 401 || res.status === 403) {
        apply({ user: null, profile: null });
        return;
      }
      if (!res.ok) return; // 429, 5xx, 503 "unavailable": transient, keep state.
      let body: MeResponse;
      try {
        body = (await res.json()) as MeResponse;
      } catch {
        return;
      }
      if (gen !== generation.current) return;
      apply({
        user: body.user ?? null,
        profile: body.profileError ? undefined : (body.profile ?? null),
      });
    })();
    inFlight.current = request;
    void request.finally(() => {
      if (inFlight.current === request) inFlight.current = null;
    });
    return request;
  }, [apply]);

  const refreshSession = useCallback(
    (): Promise<void> => inFlight.current ?? startRefresh(),
    [startRefresh]
  );

  useEffect(() => {
    let cancelled = false;
    void refreshSession().finally(() => {
      if (!cancelled) setInitialCheckDone(true);
    });

    // Focus catches "my session expired while the tab was in the background"
    // and "I signed out in another tab". Debounced: /api/* shares a 60/min
    // per-IP bucket (app/lib/rateLimit.ts), and a focus burst must not use it up.
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefreshStartedAt.current < FOCUS_REFRESH_MIN_INTERVAL_MS) return;
      void refreshSession();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshSession]);

  const signUp = useCallback(
    async (email: string, password: string, username: string, captchaToken?: string) => {
      try {
        const res = await fetch("/api/auth/sign-up", {
          method: "POST",
          headers: FETCH_HEADERS,
          credentials: "same-origin",
          body: JSON.stringify({ email, password, username, captchaToken }),
        });
        if (!res.ok) {
          const message = await readErrorMessage(res, "Sign-up failed");
          return { error: asAuthError(message) };
        }
        // With email confirmation on, sign-up returns a user but no session,
        // so ask the server instead of trusting the response body.
        invalidatePending();
        void startRefresh();
        return { error: null };
      } catch {
        return { error: asAuthError("Network error") };
      }
    },
    [invalidatePending, startRefresh]
  );

  const signIn = useCallback(
    async (email: string, password: string, captchaToken?: string) => {
      try {
        const res = await fetch("/api/auth/sign-in", {
          method: "POST",
          headers: FETCH_HEADERS,
          credentials: "same-origin",
          body: JSON.stringify({ email, password, captchaToken }),
        });
        if (!res.ok) {
          const message = await readErrorMessage(res, "Sign-in failed");
          return { error: asAuthError(message) };
        }
        const { user: signedInUser } = (await res.json()) as { user: User | null };
        invalidatePending();
        apply({ user: signedInUser ?? null, profile: undefined });
        void startRefresh(); // loads the profile; the caller does not wait for it
        return { error: null };
      } catch {
        return { error: asAuthError("Network error") };
      }
    },
    [apply, invalidatePending, startRefresh]
  );

  const signOut = useCallback(async () => {
    invalidatePending();
    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: FETCH_HEADERS,
        credentials: "same-origin",
      });
    } catch {
      /* Clear locally anyway; the next refresh reports the server's view. */
    } finally {
      apply({ user: null, profile: null });
    }
  }, [apply, invalidatePending]);

  // WP02's body (steps 9 and 11), unchanged: the server route forwards the
  // captcha token and a fixed redirectTo, and stores the PKCE verifier in an
  // HttpOnly cookie (F019, F079). Only the useCallback wrapper is new.
  const resetPassword = useCallback(async (email: string, captchaToken?: string) => {
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
  }, []);

  const updatePassword = useCallback(async (newPassword: string) => {
    try {
      const res = await fetch("/api/auth/update-password", {
        method: "POST",
        headers: FETCH_HEADERS,
        credentials: "same-origin",
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) {
        const message = await readErrorMessage(res, "Failed to update password");
        return { error: asAuthError(message) };
      }
      return { error: null };
    } catch {
      return { error: asAuthError("Network error") };
    }
  }, []);

  const updateUsername = useCallback(
    async (username: string): Promise<{ error: string | null }> => {
      let res: Response;
      try {
        res = await fetch("/api/profile", {
          method: "PATCH",
          headers: FETCH_HEADERS,
          credentials: "same-origin",
          body: JSON.stringify({ username }),
        });
      } catch {
        return { error: NETWORK_ERROR };
      }
      if (res.status === 401) {
        invalidatePending();
        apply({ user: null, profile: null });
        return { error: "Your session has expired. Please sign in again." };
      }
      if (res.status === 429) return { error: RATE_LIMITED };
      if (!res.ok) return { error: await readErrorMessage(res, USERNAME_UPDATE_FAILED) };
      try {
        const body = (await res.json()) as { profile?: UserProfile | null };
        const saved = body.profile;
        if (saved) {
          setSnapshot((prev) =>
            prev.user && prev.user.id === saved.id && !sameJson(prev.profile, saved)
              ? { ...prev, profile: saved }
              : prev
          );
        }
      } catch {
        /* Saved, but the body was unreadable; the next refresh brings the profile. */
      }
      return { error: null };
    },
    [apply, invalidatePending]
  );

  const value = useMemo<AuthContextType>(
    () => ({
      user: snapshot.user,
      profile: snapshot.profile,
      sessionStatus: snapshot.status,
      loading: !initialCheckDone,
      refreshSession,
      signUp,
      signIn,
      signOut,
      resetPassword,
      updatePassword,
      updateUsername,
    }),
    [
      snapshot,
      initialCheckDone,
      refreshSession,
      signUp,
      signIn,
      signOut,
      resetPassword,
      updatePassword,
      updateUsername,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
```

Server messages from `/api/profile` are fixed strings (step 4a), so `updateUsername` may pass them through. The proxy's 429 is `text/plain`, which is why 429 is handled before `readErrorMessage`.

### Step 6. Header: signed-out UI by default (F124)

`frontend/app/components/Header.tsx`:

6a. The first line of `Header()` (`:45` on HEAD; WP03 kept the same text): replace `const { user, profile, loading, signOut } = useAuth();` with:

```tsx
  const { user, profile, sessionStatus, signOut } = useAuth();
  // Signed-out UI is the default while the session is unknown: most visitors
  // are anonymous, and a skeleton here flashed on every page (review F124).
  const signedIn = sessionStatus === "authenticated" && user !== null;
```

Keep every line WP03 added after it (the four refs, both effects). `loading` is no longer read anywhere in `Header.tsx` after 6b and 6c; if `grep -n "loading" app/components/Header.tsx` still shows a use, stop and report it.

6b. Desktop auth slot (`:117-119` on HEAD, about 20 lines later after WP03). Replace

```tsx
            {loading ? (
              <div className="w-8 h-8 rounded-full bg-slate-200 animate-pulse" />
            ) : user ? (
```

with

```tsx
            {signedIn && user ? (
```

6c. Mobile auth slot (`:250-255` on HEAD, about 20 lines later after WP03). Replace

```tsx
            {loading ? (
              <div className="flex items-center px-3 py-2">
                <div className="w-8 h-8 rounded-full bg-slate-200 animate-pulse" />
                <div className="ml-3 h-4 w-24 bg-slate-200 rounded animate-pulse" />
              </div>
            ) : user ? (
```

with

```tsx
            {signedIn && user ? (
```

(`&& user` keeps TypeScript's narrowing of `user` for the two `user.email` reads inside those branches.) Change nothing else in the file. `displayName` at `:73` now shows the username because `profile` is finally populated.

6d. `app/components/__tests__/Header.test.tsx` (WP03; skip only if check 5 showed it missing): in its `MockAuth` type add `sessionStatus: "unknown" | "anonymous" | "authenticated";`, in the `beforeEach` default set `sessionStatus: "anonymous"`, and in the "Header user dropdown" `beforeEach` add `sessionStatus: "authenticated"`. If WP03 guessed other literal values (for example `"signed-in"`), replace them with these. Keep `loading` in the mock; it is harmless. Without this step the two "Header user dropdown" cases fail, because the avatar button now renders only for `"authenticated"`.

### Step 7. Account page: server-side username write, edit-safe field, correct redirect (F001, F058, F063)

`frontend/app/account/page.tsx`:

7a. Imports (top of the file). Remove `import { supabase } from "../lib/supabase";`. Keep `useState, useEffect`. Add after the `useAuth` import:

```tsx
import SessionUnavailable from "../components/SessionUnavailable";
```

and extend WP02's existing `validation` import (do not add a second import from the same module) so it reads:

```tsx
import {
  PASSWORD_HINT,
  PASSWORD_MIN_LENGTH,
  PASSWORD_TOO_SHORT_MESSAGE,
  USERNAME_FORMAT_MESSAGE,
  USERNAME_HINT,
  USERNAME_MAX_LENGTH,
  USERNAME_RE,
} from "../lib/validation";
```

7b. The `useAuth()` destructure (`:9` on HEAD). Replace it with:

```tsx
  const {
    user,
    profile,
    loading,
    sessionStatus,
    refreshSession,
    updatePassword,
    updateUsername,
    signOut,
  } = useAuth();
```

7c. Replace `const [username, setUsername] = useState("");` (`:13` on HEAD) with a draft that is `null` until the user types. The field shows the saved username until then, so a background refresh can never overwrite an edit, and there is no effect or ref read during render (both are flagged by the `react-hooks` lint rules in this repo):

```tsx
  // null = untouched: show the saved username (updates when the profile loads).
  // A string = the user's edit, which a background session refresh never overwrites.
  const [usernameDraft, setUsernameDraft] = useState<string | null>(null);
  const username = usernameDraft ?? profile?.username ?? "";
```

This replaces the plan's "lazy seed plus dirty ref": a ref would have to be read during render to decide what to show (lint rule `react-hooks/refs`), and a sync effect is the current lint error. The draft pattern gives the same behaviour.

7d. Delete the `useEffect` that calls `setUsername(profile.username)` (`:33-37` on HEAD, five lines from `useEffect(() => {` to `}, [profile]);`).

7e. Replace the redirect effect (the `// Redirect if not logged in` comment and its `useEffect`, `:39-44` on HEAD) with:

```tsx
  // proxy.ts already redirects anonymous requests for /account server-side.
  // This only handles a session that ends while the page is open, and only
  // on an authoritative answer: never on a network error, 429 or 5xx.
  useEffect(() => {
    if (sessionStatus === "anonymous") {
      router.push("/auth/login");
    }
  }, [sessionStatus, router]);
```

Keep the target `"/auth/login"` exactly as it is; aligning the return-to parameter is WP13 (F002).

7f. Replace the whole `handleUsernameUpdate` function (`:46-82` on HEAD) with:

```tsx
  const handleUsernameUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError(null);
    setUsernameSuccess(false);

    const candidate = username.trim();
    if (!USERNAME_RE.test(candidate)) {
      setUsernameError(USERNAME_FORMAT_MESSAGE);
      return;
    }
    if (candidate === profile?.username) {
      setUsernameDraft(null);
      return;
    }

    setUsernameLoading(true);
    const { error } = await updateUsername(candidate);
    setUsernameLoading(false);

    if (error) {
      setUsernameError(error);
      return;
    }
    setUsernameDraft(null);
    setUsernameSuccess(true);
    setTimeout(() => setUsernameSuccess(false), 3000);
  };
```

The messages the user can now see are fixed: the rules message, "Username is taken", "Could not update username. Please try again.", the rate-limit and network strings, and "Your session has expired. Please sign in again.". No PostgREST text reaches the page.

7g. The username `<input id="username">` (`:222-228` on HEAD). Change `onChange={(e) => setUsername(e.target.value)}` to `onChange={(e) => setUsernameDraft(e.target.value)}` and add `name="nickname"`, `autoComplete="nickname"` and `maxLength={USERNAME_MAX_LENGTH}`. Do NOT use `autoComplete="username"`: sign-in is by email, WP02 already put a hidden `autoComplete="username"` email field in this page's password form, and WP02's pitfalls forbid marking the display handle as the login identifier (password managers would save and later fill it into the login email field). Replace the hint text `Letters, numbers, and underscores only` in the `<p>` right below the input with `{USERNAME_HINT}`.

7h. Render guards (`:172-189` on HEAD). Replace the `if (loading) {...}` and `if (!user) {...}` blocks with:

```tsx
  if (sessionStatus === "unknown") {
    if (loading) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--pf-pokeball)]"></div>
        </div>
      );
    }
    return <SessionUnavailable onRetry={refreshSession} />;
  }

  if (sessionStatus === "anonymous" || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-600">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[var(--pf-pokeball)]"></div>
          <span>Redirecting to login…</span>
        </div>
      </div>
    );
  }
```

Apart from extending the shared `validation` import in 7a, do not touch the password, export or delete sections (WP01 and WP02 own those).

7i. Create `frontend/app/components/SessionUnavailable.tsx` (used by steps 7h and 8):

```tsx
"use client";

import { useState } from "react";

/**
 * Shown when the session check failed for a transient reason (offline, 429,
 * 5xx) before any authoritative answer arrived. We must not redirect to the
 * login page in that case, because the HttpOnly session may still be valid.
 */
export default function SessionUnavailable({ onRetry }: { onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div role="alert" className="max-w-sm text-center">
        <p className="text-slate-700">
          We couldn&apos;t confirm that you&apos;re signed in. Check your connection and try again.
        </p>
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="mt-4 bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
        >
          {retrying ? "Retrying..." : "Try again"}
        </button>
      </div>
    </div>
  );
}
```

### Step 8. Portfolio and reset-password pages: redirect or declare "invalid" only on an authoritative answer (F063)

8a. `frontend/app/portfolio/page.tsx`. Add `import SessionUnavailable from "../components/SessionUnavailable";`. Line 10: `const { user, loading: authLoading, sessionStatus, refreshSession } = useAuth();`. Replace the effect at `:34-39` with:

```tsx
  // proxy.ts gates /portfolio server-side; this only reacts to a session that
  // ends while the page is open, and only on an authoritative answer.
  useEffect(() => {
    if (sessionStatus === "anonymous") {
      router.push("/auth/login?redirect=/portfolio");
    }
  }, [sessionStatus, router]);
```

(Keep the URL unchanged; WP13 owns the `redirect` versus `next` parameter.) Replace the guards at `:41-58` with the same two-block structure as step 7h: `sessionStatus === "unknown"` shows the existing spinner while `authLoading` and `<SessionUnavailable onRetry={refreshSession} />` otherwise; `sessionStatus === "anonymous" || !user` shows the existing "Redirecting to login…" markup. Do not touch `PortfolioDashboard` or the currency code (WP05, WP20).

8b. `frontend/app/auth/reset-password/page.tsx`. Add `import SessionUnavailable from "../../components/SessionUnavailable";`. Line 27: `const { user, loading: authLoading, sessionStatus, refreshSession, updatePassword } = useAuth();`. Replace the `if (authLoading) {` guard at `:71` with `if (sessionStatus === "unknown") {` and, inside it, return the existing spinner markup when `authLoading` is true and `<SessionUnavailable onRetry={refreshSession} />` otherwise. Leave the `if (!user)` "Link invalid or expired" block as is: it is now only reached on an authoritative "anonymous".

### Step 9. ESLint guard: these files may not import the anonymous browser client

`frontend/eslint.config.mjs`. Above `export default [`, add:

```js
// Files that must never import the anonymous browser Supabase client
// (app/lib/supabase.ts). Session cookies are HttpOnly, so that client always
// runs as `anon` and RLS rejects every user-table query (review F001).
// WP05 (portfolio) and WP06 (box recipes) append their files here.
const ANON_CLIENT_FORBIDDEN_FILES = [
  "app/context/AuthContext.tsx",
  "app/account/page.tsx",
];
```

and append this object as the last element of the exported array (after the `no-explicit-any` block):

```js
  {
    files: ANON_CLIENT_FORBIDDEN_FILES,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@supabase/ssr",
              message:
                "Do not build a Supabase client here. User data goes through cookie-backed route handlers (app/api/*).",
            },
          ],
          patterns: [
            {
              regex: "(^|/)lib/supabase$",
              message:
                "app/lib/supabase is the anonymous browser client; RLS rejects it on user tables. Call a route handler instead.",
            },
          ],
        },
      ],
    },
  },
```

Verified with ESLint 9.39.5 (the installed version) while writing this spec: the regex flags `../lib/supabase`, `../../lib/supabase` and `@/app/lib/supabase`, and does not flag `../lib/supabaseData` or type imports from `@supabase/supabase-js`. Nothing in `eslint-config-next` sets `no-restricted-imports`, so this block does not override anything.

### Step 10. Documentation drift

10a. The comment at the top of the rewritten `AuthContext.test.tsx` (see Tests) must no longer claim that `supabase` is used for the profiles SELECT.

10b. `audits/HARDENING_FOLLOWUPS.md`, section 7 ("Round-2 follow-ups", starts at `:139`): add as the first bullet:

```markdown
- **Signed-in data ran as anon (review 2026-09-25, F001), part 1 fixed.**
  After fec21dc made every session cookie HttpOnly, the browser Supabase
  client (app/lib/supabase.ts) could no longer see the session, so its
  profiles/portfolios/box_recipes queries ran as anon and RLS rejected them
  (401/42501 in edge logs). The profile read now happens in GET /api/auth/me
  and the username write in PATCH /api/profile, both on the cookie-backed
  route client. Portfolio and box recipes follow in WP05/WP06. The earlier
  "web app verified end-to-end in incognito" note predates fec21dc; re-verify
  a signed-in session after WP06.
```

### Step 11. Nothing to do (exchange-rate TTL belongs to WP11)

Do not edit `app/lib/exchangeRate.ts` or `app/lib/clientMarketData.ts`. F106's note that the client exchange-rate cache never expires is the same defect as F150, which WP11 step 8a fixes with its own `EXCHANGE_RATE_TTL_MS`; WP11's pitfalls forbid making `exchangeRate.ts` import `clientMarketData.ts`, and WP12 rebases on WP11's version of the file.

## Pitfalls: do not do this

- **Do not bridge the session to the browser client.** No `supabase.auth.setSession(...)`, no returning `access_token` from `/api/auth/me`, no `accessToken` option on the browser client. The review and every F001 verifier reject `setSession` because it writes the JWT back into a JS-readable cookie and reopens session-cookie audit F-2; the `accessToken` option also makes every `supabase.auth.*` call throw (supabase-js `dist/index.cjs:640`).
- **Do not re-grant `anon` on `profiles` or loosen the `TO authenticated` policies** to make the browser query work. That reopens the tenant-data exposure migrations 0001, 0013 and 0014 closed.
- **Do not clear the user on anything except an authoritative answer.** Network rejections, 429 (the proxy's `text/plain` response), 5xx and the new 503 must leave `user`, `profile` and `sessionStatus` unchanged. A 401/403 or `{ user: null }` must still clear them so a real sign-out in another tab propagates (F063 verifier).
- **Do not map every `getUser()` error to `{ user: null }` in the routes.** That is today's bug moved server-side: a GoTrue outage would sign everyone out. Use `isAuthoritativeSignedOut` (step 2).
- **Do not debounce explicit refreshes.** Only the focus handler is rate-limited; the "Try again" button and the refresh after sign-in must always fetch.
- **Do not skip the visibility check** on the focus handler (F063 verifier): `focus` can fire for a hidden document on some platforms.
- **Do not seed the username with `useEffect` + `setState`** (current lint error `react-hooks/set-state-in-effect`) or by reading a ref during render (`react-hooks/refs`). Use the `usernameDraft` pattern from step 7c.
- **Do not echo Supabase or PostgREST `error.message` to the client** (F001 verifier correction c). `/api/profile` returns only the fixed strings in step 4a; the old `setUsernameError(error.message)` at `account/page.tsx:74` goes away.
- **Do not accept any field but `username` in `PATCH /api/profile`, and do not upsert or insert a `profiles` row there.** Profile rows are created only by the `on_auth_user_created` trigger (migration 0004, audit M-10); WP21 later restricts column updates further.
- **Do not remove `loading` from the context.** WP03's Header test and the account, portfolio and reset-password pages read it. Its meaning is unchanged.
- **Do not keep a skeleton in the Header** for the `"unknown"` state. Signed-out UI is the default (F124).
- **Do not delete `app/lib/supabase.ts`** or touch `app/lib/portfolio.ts`, `useBoxRecipes.ts`, `usePortfolioData.ts`, `BoxCalculator.tsx` or `EditHoldingModal.tsx`. Public reads (`clientMarketData.ts`, `exchangeRate.ts`, the `get_shared_recipe` RPC) legitimately stay on the anon client, and portfolio and recipes are WP05 and WP06. Switching those hooks from `user` to `user?.id` dependencies is also theirs; this package already stops the identity churn at the source.
- **Do not change login redirect URLs or query parameters** (`/auth/login`, `?redirect=/portfolio`). WP13 (F002) reconciles `redirect` and `next`.
- **Do not touch password reset.** Keep WP02's `POST /api/auth/forgot-password` route and `resetPassword` body exactly (URL, captcha token, fixed `redirectTo`); only wrap it in `useCallback`. Do not create `app/api/auth/reset-password/route.ts` (nothing would call it), and do not add an app-side Turnstile `siteverify` call (F019 verifier: tokens are single use and Supabase is the only verifier).
- **Do not use `autoComplete="username"` on the account page's username field.** It is a display handle; the sign-in identifier is the email, and WP02's hidden email field in the password form already carries `autoComplete="username"`. Use `name="nickname" autoComplete="nickname"` (step 7g).
- **Do not create `app/lib/username.ts` or redefine the username regex or message.** Import them from WP02's `app/lib/validation.ts`, so the sign-up form, the sign-up route, the account form and `PATCH /api/profile` show the same text.
- **Do not edit `app/lib/exchangeRate.ts` or `app/lib/clientMarketData.ts`.** The exchange-rate TTL (F106 note, F150) is WP11 step 8a.
- **Do not write a transient-failure test that asserts right after `waitFor(() => meCalls() ...)`.** The fetch is counted before its failure is handled, so such an assertion passes even against the old sign-out-on-error code. Flush with `await flush()` (see the test skeleton) before asserting.
- **Do not write route tests without `/** @jest-environment node */`** on the first line. Under the default jsdom environment `next/server` throws `ReferenceError: Request is not defined`.
- **Do not use a second `no-restricted-imports` block for the same files** in `eslint.config.mjs`; in flat config the later block silently replaces the earlier rule options. WP05 and WP06 add file paths to `ANON_CLIENT_FORBIDDEN_FILES` instead.

## Tests

All test files below are new or fully rewritten. Variables referenced inside `jest.mock` factories must start with `mock`.

### 1. `frontend/app/context/__tests__/AuthContext.test.tsx` (rewrite)

Remove the `lib/supabase` mock and the `mockFrom`/`mockSelect`/`mockEq`/`mockMaybeSingle` plumbing. Keep the existing signIn/signUp/signOut/updatePassword/context-surface cases, adapted as noted. Required cases:

- Guard: the module mock below makes the whole file fail if `AuthContext` imports the browser client.
- Boot: `loading` true then false; `sessionStatus` `"unknown"` then `"anonymous"` for `{ user: null, profile: null }`; `"authenticated"` with user and profile populated from one `/api/auth/me` response (and no other fetch).
- Boot 401 and 403: `"anonymous"`.
- Boot network rejection, 503 and 429: `loading` false, `sessionStatus` stays `"unknown"`, `user` null.
- Signed in, then focus after 31 s with a network rejection: user, profile and `"authenticated"` unchanged. Same for 503 and 429. Call `await flush()` after the fetch count reaches 2 and before asserting (see the skeleton); otherwise the assertion runs before the failure is handled and cannot catch a regression.
- Signed in, then focus after 31 s with 401: `"anonymous"`, user and profile null.
- Signed in, then focus after 31 s with `{ user: null }`: `"anonymous"`.
- `profileError: true` keeps the previous profile for the same user.
- Focus debounce: a focus 10 s after boot does not fetch; a focus 31 s after boot fetches once; two focus events in the same tick produce one fetch; a focus while `document.visibilityState` is `"hidden"` does not fetch.
- `refreshSession()` called directly 1 s after boot does fetch (not debounced).
- Identity: after a focus refresh returning an equal but freshly parsed payload, the consumer does not re-render and `user`/`profile` are the same references.
- signIn: POSTs with CSRF header (find the call by URL, because a `/api/auth/me` refresh now follows), sets `"authenticated"` immediately, then the profile from the follow-up `/api/auth/me` appears.
- signIn while the boot refresh is still pending and that boot refresh later resolves `{ user: null }`: the state stays `"authenticated"` (generation guard).
- signUp: POSTs the body, then calls `/api/auth/me`; state follows `/api/auth/me` (anonymous when it returns `{ user: null }`).
- signOut: POSTs to `/api/auth/sign-out`, ends `"anonymous"`; a rejected sign-out fetch also ends `"anonymous"` and does not throw.
- resetPassword (carry over WP02's cases): POSTs `{ email, captchaToken }` to `/api/auth/forgot-password` with the CSRF header; a non-2xx returns the server's `error` string as `error.message`; a rejected fetch returns `"Network error"`.
- updateUsername: PATCHes `/api/profile` with `{ username }` and CSRF header; on 200 the context `profile.username` changes; on 409 returns `"Username is taken"` and profile is unchanged; on 429 returns the rate-limit string; on 401 returns the session-expired string and state becomes `"anonymous"`; on rejection returns `"Network error. Please try again."`.
- Context surface: has `sessionStatus`, `refreshSession`, `updateUsername`, `loading`; still no `session`.

Skeleton for the non-obvious parts:

```tsx
/**
 * AuthContext: session state from /api/auth/me (user + profile), with
 * sessionStatus that only changes on an authoritative answer (F063),
 * debounced focus refresh, and stable identities (F058). AuthContext must
 * not import app/lib/supabase (F001): the mock below fails the file if it does.
 */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, FOCUS_REFRESH_MIN_INTERVAL_MS, useAuth } from "../AuthContext";

jest.mock("../../lib/supabase", () => {
  throw new Error("AuthContext must not import app/lib/supabase (anonymous browser client)");
});

type Auth = ReturnType<typeof useAuth>;

const fetchMock = jest.fn();
let now = 1_000_000;

// Fresh object per call, so identity tests are meaningful.
function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(JSON.stringify(body)),
  };
}

const ME_SIGNED_IN = {
  user: { id: "u1", email: "ash@example.com" },
  profile: { id: "u1", username: "ash", email: "ash@example.com" },
};

function meCalls() {
  return fetchMock.mock.calls.filter(([url]) => url === "/api/auth/me").length;
}

function lastCallTo(url: string) {
  const call = [...fetchMock.mock.calls].reverse().find(([u]) => u === url);
  if (!call) throw new Error(`no call to ${url}`);
  return call as [string, RequestInit];
}

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse(200, { user: null, profile: null }));
  now = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function TestConsumer({ onRender }: { onRender?: (auth: Auth) => void }) {
  const auth = useAuth();
  onRender?.(auth);
  return (
    <div>
      <span data-testid="loading">{String(auth.loading)}</span>
      <span data-testid="status">{auth.sessionStatus}</span>
      <span data-testid="user">{auth.user?.email ?? "no-user"}</span>
      <span data-testid="profile">{auth.profile?.username ?? "no-profile"}</span>
    </div>
  );
}

async function renderAndSettle(onRender?: (auth: Auth) => void) {
  render(
    <AuthProvider>
      <TestConsumer onRender={onRender} />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
}

async function focusAfter(ms: number) {
  now += ms;
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
}

// Let every pending fetch/json promise settle and React apply the result.
// A macrotask runs after all queued microtasks.
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("transient failures never sign the user out (F063)", () => {
  it.each([
    ["network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["503", async () => jsonResponse(503, { error: "Session check unavailable" })],
    ["429", async () => ({ ok: false, status: 429, json: async () => { throw new Error("text/plain"); } })],
  ])("keeps the signed-in state on %s during a focus refresh", async (_label, failure) => {
    fetchMock.mockImplementation(async () => jsonResponse(200, ME_SIGNED_IN));
    await renderAndSettle();
    await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("ash"));

    fetchMock.mockImplementationOnce(failure as () => Promise<unknown>);
    await focusAfter(FOCUS_REFRESH_MIN_INTERVAL_MS + 1_000);
    await waitFor(() => expect(meCalls()).toBe(2));
    await flush(); // the failure must be fully handled before we assert

    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    expect(screen.getByTestId("user")).toHaveTextContent("ash@example.com");
    expect(screen.getByTestId("profile")).toHaveTextContent("ash");
  });

  it("clears the session on an authoritative 401", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, ME_SIGNED_IN));
    await renderAndSettle();
    fetchMock.mockImplementationOnce(async () => jsonResponse(401, { error: "Unauthorized" }));
    await focusAfter(FOCUS_REFRESH_MIN_INTERVAL_MS + 1_000);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(screen.getByTestId("user")).toHaveTextContent("no-user");
  });

  it("stays unknown (not anonymous) when the very first check fails", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    await renderAndSettle();
    expect(screen.getByTestId("status")).toHaveTextContent("unknown");
  });
});

describe("focus refresh debounce", () => {
  it("ignores focus within the interval and refreshes after it", async () => {
    await renderAndSettle();
    expect(meCalls()).toBe(1);
    await focusAfter(10_000);
    expect(meCalls()).toBe(1);
    await focusAfter(FOCUS_REFRESH_MIN_INTERVAL_MS);
    await waitFor(() => expect(meCalls()).toBe(2));
  });

  it("does not refresh while the document is hidden", async () => {
    await renderAndSettle();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    await focusAfter(FOCUS_REFRESH_MIN_INTERVAL_MS + 1_000);
    expect(meCalls()).toBe(1);
  });
});

describe("identity stability (F058)", () => {
  it("does not re-render consumers when /api/auth/me returns equal data", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, ME_SIGNED_IN));
    const renders: Auth[] = [];
    await renderAndSettle((auth) => renders.push(auth));
    await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("ash"));
    const count = renders.length;
    const last = renders[renders.length - 1];

    await focusAfter(FOCUS_REFRESH_MIN_INTERVAL_MS + 1_000);
    await waitFor(() => expect(meCalls()).toBe(2));
    await flush();

    expect(renders.length).toBe(count);
    expect(renders[renders.length - 1].user).toBe(last.user);
    expect(renders[renders.length - 1].profile).toBe(last.profile);
  });
});

describe("generation guard", () => {
  it("a slow boot answer cannot undo a sign-in", async () => {
    let resolveBoot!: (v: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise((r) => { resolveBoot = r; }));
    let auth!: Auth;
    render(
      <AuthProvider>
        <TestConsumer onRender={(a) => { auth = a; }} />
      </AuthProvider>
    );
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/auth/sign-in"
        ? jsonResponse(200, { user: ME_SIGNED_IN.user })
        : jsonResponse(200, ME_SIGNED_IN)
    );
    await act(async () => {
      await auth.signIn("ash@example.com", "pw", "captcha");
    });
    await act(async () => {
      resolveBoot(jsonResponse(200, { user: null, profile: null }));
    });
    await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("ash"));
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
  });
});
```

Write the remaining cases (signUp, signOut, resetPassword, updateUsername, profileError, context surface, "two focus events in one tick produce one fetch", "`refreshSession()` is not debounced") in the same style. For the "two focus events" case, make the `/api/auth/me` mock return a promise you resolve manually, dispatch `focus` twice inside one `act`, then assert `meCalls()` is 2 (boot plus one).

### 2. `frontend/app/api/auth/me/__tests__/route.test.ts` (new)

```ts
/** @jest-environment node */
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";

const mockGetUser = jest.fn();
const mockMaybeSingle = jest.fn();
const mockEq = jest.fn();
const mockSelect = jest.fn();
const mockFrom = jest.fn();

jest.mock("../../../../lib/routeSupabase", () => ({
  createRouteSupabaseClient: async () => ({
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => mockFrom(table),
  }),
}));

import { GET } from "../route";

const USER = { id: "u1", email: "ash@example.com" };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockFrom.mockReturnValue({ select: mockSelect });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
});

afterEach(() => jest.restoreAllMocks());

it("returns an authoritative anonymous answer when there is no session", async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
  const res = await GET();
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ user: null, profile: null });
  expect(mockFrom).not.toHaveBeenCalled();
});

it("treats a rejected refresh token (4xx) as signed out", async () => {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found"),
  });
  const res = await GET();
  expect(res.status).toBe(200);
  expect((await res.json()).user).toBeNull();
});

it.each([
  ["network failure", new AuthRetryableFetchError("fetch failed", 0)],
  ["GoTrue 503", new AuthRetryableFetchError("Service Unavailable", 503)],
  ["GoTrue 429", new AuthApiError("Too many requests", 429, "over_request_rate_limit")],
])("returns 503 (not signed out) on %s", async (_label, error) => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error });
  const res = await GET();
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("no-store");
});

it("returns 503 when getUser throws", async () => {
  mockGetUser.mockRejectedValue(new Error("boom"));
  expect((await GET()).status).toBe(503);
});

it("returns the user and their profile read with the cookie client", async () => {
  mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
  mockMaybeSingle.mockResolvedValue({
    data: { id: "u1", username: "ash", email: "ash@example.com" },
    error: null,
  });
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    user: USER,
    profile: { id: "u1", username: "ash", email: "ash@example.com" },
  });
  expect(mockFrom).toHaveBeenCalledWith("profiles");
  expect(mockSelect).toHaveBeenCalledWith("id, username, email");
  expect(mockEq).toHaveBeenCalledWith("id", "u1");
});

it("flags a failed profile read without dropping the user", async () => {
  mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
  mockMaybeSingle.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
  const body = await (await GET()).json();
  expect(body).toEqual({ user: USER, profile: null, profileError: true });
  expect(JSON.stringify(body)).not.toContain("permission denied");
});

it("returns profile null (no flag) when the row does not exist", async () => {
  mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  expect(await (await GET()).json()).toEqual({ user: USER, profile: null });
});
```

### 3. `frontend/app/api/profile/__tests__/route.test.ts` (new)

Same docblock and mock style (the mock path is `"../../../lib/routeSupabase"`). The update chain is `from("profiles").update({ username }).eq("id", id).select("id, username, email").maybeSingle()`, so mock `mockUpdate`, `mockUpdateEq`, `mockUpdateSelect`, `mockUpdateMaybeSingle`. Build requests with:

```ts
import { NextRequest } from "next/server";

function patch(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/profile", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-pokefin-request": "1",
      origin: "http://localhost:3000",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
```

(`isAllowedOrigin` accepts `http://localhost*` because Jest sets `NODE_ENV=test`.) Cases:

- 403 without `x-pokefin-request`; 403 with `origin: https://evil.example`. `mockGetUser` not called.
- 413 with header `content-length: 5000`.
- 400 for malformed JSON (`"{"`), for a JSON `null` body, and for usernames `"ab"`, `"a".repeat(33)`, `"bad name"`, `"émile"`, a number. Body `error` equals `USERNAME_FORMAT_MESSAGE` (import it from `../../../lib/validation`) for the username cases. `mockGetUser` not called.
- 401 when `getUser` returns `AuthSessionMissingError`; 503 when it returns `AuthRetryableFetchError(…, 0)`.
- 200: `"  ash_k  "` is trimmed; `mockUpdate` called with exactly `{ username: "ash_k" }` (no other keys, even if the request body carried `email` or `id`); `mockUpdateEq` called with `("id", "u1")`; response `{ profile: {...} }` with `cache-control: no-store`.
- 409 `{ error: "Username is taken" }` on `{ code: "23505" }`.
- 400 with the rules message on `{ code: "23514" }`.
- 500 on `{ code: "XX000", message: "secret detail" }`: body is exactly `{ error: "Could not update username. Please try again." }` and does not contain `"secret detail"`.
- 404 when `maybeSingle` returns `{ data: null, error: null }`.

### 4. (none)

No reset-password route test: this package adds no reset route. WP02's `forgot-password` route tests stay as they are.

### 5. `frontend/app/account/__tests__/page.test.tsx` (new)

jsdom (no docblock). Mock `next/navigation` (`useRouter: () => ({ push: mockPush })`) and `../../context/AuthContext` (`useAuth: () => mockAuth`). Default `mockAuth`: `sessionStatus: "authenticated"`, `loading: false`, `user: { id: "u1", email: "ash@example.com" }`, `profile: { id: "u1", username: "ash", email: "ash@example.com" }`, `updateUsername: jest.fn().mockResolvedValue({ error: null })`, `refreshSession: jest.fn().mockResolvedValue(undefined)`, and plain `jest.fn()` for `updatePassword` and `signOut`. Get the field with `screen.getByLabelText("Username")`. Cases:

- The field shows `"ash"`; after `fireEvent.change(input, { target: { value: "ash_ketchum" } })`, set `mockAuth = { ...mockAuth, profile: { ...mockAuth.profile } }` and `rerender(<AccountPage />)`: the field still shows `"ash_ketchum"` (F058 regression test).
- With `profile: null` on first render the field is empty; after `rerender` with the profile it shows `"ash"` (no typing happened).
- Submitting `"  ash_k "` calls `updateUsername("ash_k")` once and shows "Username updated successfully!".
- `updateUsername` resolving `{ error: "Username is taken" }` shows exactly that text.
- Submitting `"ab"` shows the rules message and does not call `updateUsername`.
- `sessionStatus: "unknown", loading: false, user: null`: shows "Try again", clicking it calls `refreshSession`, and `mockPush` is never called.
- `sessionStatus: "anonymous", user: null`: `mockPush` called with `"/auth/login"` (WP13 later changes this expectation).
- The username field has `autocomplete="nickname"` and `maxlength="32"` (guards step 7g).

### 6. `frontend/app/components/__tests__/Header.auth.test.tsx` (new; separate from WP03's `Header.test.tsx` to avoid merge conflicts)

Copy the `next/navigation` and `next/link` mocks from WP03's `app/components/__tests__/Header.test.tsx` verbatim, and mock `../../context/AuthContext` with `useAuth: () => mockAuth` where `mockAuth` has `user`, `profile`, `sessionStatus`, `loading: false` and `signOut: jest.fn()`. Cases:

- `sessionStatus: "unknown", user: null`: "Sign In" and "Sign Up" links are present, and `container.querySelector(".animate-pulse")` is null (F124).
- `sessionStatus: "anonymous"`: same.
- `sessionStatus: "authenticated"` with profile `ash`: a button with accessible name matching `/ash/` exists and "Sign In" is absent.

### 7. (none)

No exchange-rate test: step 11 is empty (WP11 owns that file).

### 8. Existing tests to re-run unchanged

`app/lib/__tests__/supabase.test.ts` (the browser client still exists), `app/lib/__tests__/rateLimit.test.ts`, WP02's route tests under `app/api/auth/` (including `forgot-password`) and `app/lib/__tests__/validation.test.ts`, and WP03's `app/components/__tests__/Header.test.tsx` after step 6d.

## Verification

Run from `frontend/`:

```bash
pnpm install --frozen-lockfile

# Type check: expect no output, exit 0.
pnpm exec tsc --noEmit

# Lint the touched files: expect 0 errors (the pre-existing set-state-in-effect
# error in account/page.tsx is gone).
pnpm exec eslint eslint.config.mjs app/context/AuthContext.tsx app/account/page.tsx \
  app/components/Header.tsx app/components/SessionUnavailable.tsx app/portfolio/page.tsx \
  app/auth/reset-password/page.tsx app/api/auth/me/route.ts app/api/profile/route.ts \
  app/lib/authSession.ts app/context/__tests__ app/account/__tests__ app/api \
  app/components/__tests__

# Files this package must not have touched: the git diff and ls lines must print nothing.
git fetch origin master
git diff --name-only origin/master...HEAD -- app/lib/exchangeRate.ts app/lib/clientMarketData.ts \
  app/lib/validation.ts app/lib/rateLimit.ts app/api/auth/forgot-password app/lib/supabase.ts
ls app/lib/username.ts app/api/auth/reset-password 2>&1 | grep -v "No such file"

# The guard works (lints stdin under the guarded file name; no file is modified).
echo 'import { supabase } from "../lib/supabase"; export const x = supabase;' \
  | pnpm exec eslint --stdin --stdin-filename app/account/page.tsx | grep -c "no-restricted-imports"
# expect: 1   (before step 9 this prints 0)
echo 'import { supabase } from "../lib/supabase"; export const x = supabase;' \
  | pnpm exec eslint --stdin --stdin-filename app/context/AuthContext.tsx | grep -c "no-restricted-imports"
# expect: 1

# No browser-client use left in the two guarded files.
grep -n "lib/supabase\|supabase\.from\|supabase\.auth" app/context/AuthContext.tsx app/account/page.tsx
# expect: no output

# Header has no auth skeleton.
grep -n "loading ?" app/components/Header.tsx
# expect: no output

# Full lint: the error count on the last line must be exactly one lower than the
# baseline you recorded in "Before you start" check 6 (the account/page.tsx
# set-state-in-effect error is fixed and nothing new is added).
pnpm run lint 2>&1 | tail -3

# Tests.
pnpm test --ci app/context app/api app/account app/components/__tests__ app/lib/__tests__
pnpm test --ci   # full suite, all green

# Production build against the WP00 stub.
pnpm build:stub
# expect: exit 0, and the route list includes ƒ /api/auth/me and ƒ /api/profile
```

Manual checks (local, needs a real Supabase project in `.env.local`; skip if you have none and list them in the PR for the owner):

1. `pnpm dev`, open `/` in a private window while signed out. The header shows "Sign In" and "Sign Up" on first paint, with no grey pulsing circle at any point (throttle to "Slow 4G" in DevTools to make a flash visible).
2. Sign in. The header shows the username (not the email prefix). DevTools Network shows `GET /api/auth/me` returning `{ user, profile }` and no request to `/rest/v1/profiles` from the browser.
3. On `/account`, type a new username, switch to another window for 35 s, come back. The typed text is still there. Save it: "Username updated successfully!", the header updates without a reload, and the request is `PATCH /api/profile` with status 200.
4. Save a username another account already uses: the page shows "Username is taken".
5. On `/portfolio`, set DevTools to Offline, switch windows for 35 s and come back. You stay on `/portfolio`, the header still shows you signed in, and the console shows a failed `/api/auth/me`. Go back online and focus again after 30 s: `/api/auth/me` returns 200.
6. Focus the window several times within 30 s: at most one `/api/auth/me` request.
7. Sign out in a second tab, wait 30 s, focus the first tab on `/account`: it redirects to `/auth/login`.
8. Request a password reset from `/auth/forgot-password`: the request is `POST /api/auth/forgot-password` (unchanged from WP02) and the success message appears.

## Owner actions

No migrations and no environment variables. After the deploy that contains this PR:

1. **Production smoke test (5 minutes).** In a private window on https://pokefin.ca: sign in; confirm the header shows your username; on `/account` change the username and change it back; confirm both saves show "Username updated successfully!". In DevTools Network, confirm `PATCH /api/profile` returned 200 and that no request went to `*.supabase.co/rest/v1/profiles`.
2. **Log check.** In Supabase Dashboard > Logs > API (edge logs), filter on path `/rest/v1/profiles` for the hour after the deploy. Expect no new 401 rows from `x-client-info: supabase-ssr ... createBrowserClient`. In Vercel > Project > Logs, filter for `profile_fetch_failed` and `auth_me_unavailable`; expect none (or only isolated ones during a Supabase incident).
3. **Transient-failure check (2 minutes).** Signed in on `/portfolio` in production, turn Wi-Fi off, switch to another app for 35 s, switch back: you stay on `/portfolio` and the header still shows your username. Turn Wi-Fi on again.

## Acceptance criteria

- [ ] `app/context/AuthContext.tsx` and `app/account/page.tsx` contain no import of `app/lib/supabase` and no `supabase.` call; ESLint fails if one is added.
- [ ] `GET /api/auth/me` returns `{ user, profile }` for a signed-in user, `{ user: null, profile: null }` with 200 for an anonymous one, and 503 for network, 5xx and 429 failures from GoTrue, always with `Cache-Control: no-store`.
- [ ] `PATCH /api/profile` rejects missing CSRF header or bad Origin with 403, invalid usernames with 400, no session with 401, a taken name with 409 `"Username is taken"`, and never returns a Supabase error message.
- [ ] The header shows the username for a signed-in user and shows "Sign In / Sign Up" (no skeleton) while the session is unknown or anonymous.
- [ ] A network error, 429 or 5xx on `/api/auth/me` never changes `user`, `profile` or `sessionStatus`; a 401/403 or `{ user: null }` sets `"anonymous"`.
- [ ] `/account` and `/portfolio` redirect to login only when `sessionStatus === "anonymous"`, and show a "Try again" panel instead when the first check failed.
- [ ] A focus refresh happens at most once per 30 s and only when the document is visible; an unchanged answer causes no consumer re-render.
- [ ] An unsaved username edit survives a focus refresh.
- [ ] The account username field uses `autoComplete="nickname"`, `maxLength={USERNAME_MAX_LENGTH}` and WP02's `USERNAME_HINT`; the rules message is WP02's `USERNAME_FORMAT_MESSAGE` in both the page and `PATCH /api/profile`.
- [ ] `resetPassword` still calls `POST /api/auth/forgot-password`; no `app/lib/username.ts`, no `app/api/auth/reset-password/route.ts`, and no change to `exchangeRate.ts` or `clientMarketData.ts`.
- [ ] `pnpm exec tsc --noEmit`, the touched-file lint, `pnpm test --ci` and `pnpm build:stub` all pass.

## Rollback

Revert the merge commit (`git revert -m 1 <merge-sha>`) and redeploy. There is no migration or data change to undo. Reverting restores the pre-PR state: profile reads and username writes fail as anon again, and a transient `/api/auth/me` failure signs users out again. WP05 and WP06 build on this package (`sessionStatus`, `authSession.ts`, `ANON_CLIENT_FORBIDDEN_FILES`); if either has merged, revert them first, newest first.

## Commit and PR

Commit message:

```text
fix(auth): read and write the profile server-side; stable session state

The browser Supabase client cannot see the HttpOnly session cookie, so the
profiles SELECT in AuthContext and the username UPDATE on /account ran as
anon and RLS rejected them for every signed-in user (review F001, part 1).

- GET /api/auth/me now returns { user, profile } from the cookie-backed
  route client, and 503 instead of "signed out" when GoTrue is unreachable.
- New PATCH /api/profile (CSRF-gated, USERNAME_RE, 23505 -> "Username is
  taken", fixed error strings only).
- AuthContext: no browser-client import; sessionStatus
  unknown|anonymous|authenticated changes only on authoritative answers;
  focus refresh debounced to 30 s and skipped when hidden; stable
  identities and a memoized context value (F058, F063).
- Header defaults to the signed-out UI instead of a skeleton (F124).
- /account keeps unsaved username edits across refreshes; /account,
  /portfolio and /auth/reset-password redirect or declare the link invalid
  only on an authoritative "anonymous".
- ESLint no-restricted-imports guard for app/lib/supabase in these files.
```

PR title: `fix(auth): restore profile and username for signed-in users; stop transient sign-outs (WP04)`

PR body summary: link this spec; list findings F001 (part 1), F058, F063, F124; state that F106's exchange-rate note is left to WP11 (F150); paste the Verification command outputs; list the Owner actions above; note follow-ups for WP05/WP06 (append their files to `ANON_CLIENT_FORBIDDEN_FILES`, key `usePortfolioData`/`useBoxRecipes` on `user?.id`) and WP13 (login return-to parameter). Also note, as an open item for the owner, that the F001 verifiers asked for a signed-in end-to-end smoke test against a real Supabase test project (sign in through `/api/auth/sign-in`, then expect 200 from `/api/auth/me` with a non-null `profile`); no package in the plan adds it because CI has no Supabase test project.
