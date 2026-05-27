import { NextRequest, NextResponse } from "next/server";
import { createRouteSupabaseClient } from "../../../lib/routeSupabase";
import { rejectIfBodyTooLarge, rejectIfCsrfFails } from "../../../lib/csrf";
import { logSupabaseError } from "../../../lib/logger";

/**
 * Server-side password update. Requires an active session cookie.
 * Supabase will rotate the refresh token on success and the new
 * HttpOnly cookie lands via the hardened setAll path.
 */
export async function POST(req: NextRequest) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, 2048);
  if (tooLarge) return tooLarge;

  let body: { password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!password) {
    return NextResponse.json({ error: "Password is required" }, { status: 400 });
  }

  const supabase = await createRouteSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    logSupabaseError("update_password_failed", error);
    return NextResponse.json(
      { error: error.message },
      { status: error.status ?? 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
