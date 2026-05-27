import { NextRequest, NextResponse } from "next/server";
import { createRouteSupabaseClient } from "../../../lib/routeSupabase";
import { rejectIfBodyTooLarge, rejectIfCsrfFails } from "../../../lib/csrf";

export async function POST(req: NextRequest) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, 256);
  if (tooLarge) return tooLarge;

  const supabase = await createRouteSupabaseClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
