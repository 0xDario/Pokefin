import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { logSupabaseError } from "../../../lib/logger";

const ALLOWED_ORIGINS = new Set([
  process.env.NEXT_PUBLIC_SITE_URL ?? "",
  "https://pokefin.ca",
  "https://www.pokefin.ca",
]);

function isAllowedOrigin(origin: string | null) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (process.env.NODE_ENV !== "production" && origin.startsWith("http://localhost")) {
    return true;
  }
  return false;
}

/**
 * GDPR Art. 15 / 20 — data portability.
 * Returns a JSON blob with the caller's profile, portfolios, holdings,
 * lots, and box recipes. CSRF-gated identically to DELETE /api/account/delete.
 */
export async function POST(request: NextRequest) {
  if (request.headers.get("x-pokefin-request") !== "1") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isAllowedOrigin(request.headers.get("origin"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
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
            cookieStore.set(name, value, options);
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

  const { data, error: rpcError } = await supabase.rpc("export_my_data");
  if (rpcError) {
    logSupabaseError("export_my_data_failed", rpcError);
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 });
  }

  return new NextResponse(JSON.stringify(data ?? {}, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="pokefin-data-${user.id}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
