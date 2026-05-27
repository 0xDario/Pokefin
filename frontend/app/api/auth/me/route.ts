import { NextResponse } from "next/server";
import { createRouteSupabaseClient } from "../../../lib/routeSupabase";

/**
 * Returns the current user from the HttpOnly session cookie. The
 * browser cannot read those cookies directly, so AuthContext queries
 * this route at boot + on focus to learn whether the user is signed
 * in. Safe with no CSRF guard - read-only and reflects only the
 * caller's own session.
 */
export async function GET() {
  const supabase = await createRouteSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return NextResponse.json(
    { user: user ?? null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
