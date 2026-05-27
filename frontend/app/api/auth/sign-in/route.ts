import { NextRequest, NextResponse } from "next/server";
import { createRouteSupabaseClient } from "../../../lib/routeSupabase";
import { rejectIfBodyTooLarge, rejectIfCsrfFails } from "../../../lib/csrf";
import { logSupabaseError } from "../../../lib/logger";

/**
 * Server-side sign-in. Replaces the previous browser-side
 * `supabase.auth.signInWithPassword(...)` so the session cookie is
 * minted by the server with HttpOnly + Secure from the start. The
 * browser never writes the cookie via `document.cookie`, closing the
 * XSS-readable window that the @supabase/ssr browser client opened
 * (audit finding session-cookie F-2).
 */
export async function POST(req: NextRequest) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, 4096);
  if (tooLarge) return tooLarge;

  let body: { email?: unknown; password?: unknown; captchaToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const captchaToken =
    typeof body.captchaToken === "string" ? body.captchaToken : undefined;

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken },
  });

  if (error) {
    logSupabaseError("sign_in_failed", error);
    return NextResponse.json(
      { error: error.message },
      { status: error.status ?? 401 }
    );
  }

  return NextResponse.json({ user: data.user });
}
