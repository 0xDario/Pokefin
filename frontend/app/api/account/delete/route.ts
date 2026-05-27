import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { hardenCookieOptions } from "../../../lib/cookieOptions";

const ALLOWED_ORIGINS = new Set([
  process.env.NEXT_PUBLIC_SITE_URL ?? "",
  "https://pokefin.ca",
  "https://www.pokefin.ca",
]);

function isAllowedOrigin(origin: string | null) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Local development.
  if (process.env.NODE_ENV !== "production" && origin.startsWith("http://localhost")) {
    return true;
  }
  return false;
}

export async function DELETE(request: NextRequest) {
  // CSRF defense: require a custom header that browsers will not
  // attach on a cross-origin form/link, and an allowlisted Origin.
  if (request.headers.get("x-pokefin-request") !== "1") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isAllowedOrigin(request.headers.get("origin"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Reject oversized request bodies. We don't read a body for DELETE
  // anyway, but Content-Length above this cap suggests abuse.
  const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > 1024) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, hardenCookieOptions(options));
          });
        },
      },
    }
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The delete_my_account() SECURITY DEFINER RPC deletes auth.users
  // and cascades through profiles/portfolios/portfolio_holdings/
  // portfolio_lots/box_recipes. No service-role key required.
  const { error: rpcError } = await supabase.rpc("delete_my_account");
  if (rpcError) {
    console.error("delete_my_account_failed", { code: rpcError.code });
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }

  await supabase.auth.signOut();
  return NextResponse.json({ success: true });
}
