import type { CookieOptions } from "@supabase/ssr";

/**
 * Override supabase-ssr's default cookie options so every cookie the
 * SERVER writes is HttpOnly + Secure.
 *
 * Why: `@supabase/ssr`'s `DEFAULT_COOKIE_OPTIONS` are
 * `{ path:"/", sameSite:"lax", httpOnly:false, maxAge:400d }` and the
 * library never sets `secure`. Without this helper every Set-Cookie
 * leaving the server would be missing the HttpOnly + Secure flags.
 * See audit finding session-cookie F-1.
 *
 * The browser client (`createBrowserClient`) writes via
 * `document.cookie` and CANNOT set HttpOnly regardless of options
 * (audit F-2 — architectural limit). This helper protects the
 * server-set path only.
 */
export function hardenCookieOptions(options?: CookieOptions): CookieOptions {
  return {
    ...options,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: options?.sameSite ?? "lax",
    path: options?.path ?? "/",
  };
}
