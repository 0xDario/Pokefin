import { NextRequest, NextResponse } from "next/server";
import { createRouteSupabaseClient } from "../../../lib/routeSupabase";
import { rejectIfBodyTooLarge, rejectIfCsrfFails } from "../../../lib/csrf";
import { logSupabaseError } from "../../../lib/logger";

/**
 * Server-side sign-up. The profile row is created by the
 * on_auth_user_created trigger reading raw_user_meta_data.
 */
export async function POST(req: NextRequest) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, 4096);
  if (tooLarge) return tooLarge;

  let body: {
    email?: unknown;
    password?: unknown;
    username?: unknown;
    captchaToken?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const username = typeof body.username === "string" ? body.username : "";
  const captchaToken =
    typeof body.captchaToken === "string" ? body.captchaToken : undefined;

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      captchaToken,
      data: { username },
    },
  });

  if (error) {
    logSupabaseError("sign_up_failed", error);
    return NextResponse.json(
      { error: error.message },
      { status: error.status ?? 400 }
    );
  }

  return NextResponse.json({ user: data.user });
}
