import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

function safeNextPath(raw: string | null): string {
  if (!raw) return "/";
  // Only allow same-origin relative paths beginning with a single
  // forward slash. Block protocol-relative ("//evil"), URL-encoded
  // slashes, backslashes, and anything that decodes to a network-path
  // reference.
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("//") || decoded.startsWith("/\\")) return "/";
  } catch {
    return "/";
  }
  return raw;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeNextPath(requestUrl.searchParams.get("next"));
  const type = requestUrl.searchParams.get("type");

  const redirectTo =
    type === "recovery"
      ? new URL("/auth/reset-password", request.url)
      : new URL(next, request.url);

  const response = NextResponse.redirect(redirectTo);

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            // Write Supabase's refreshed session cookies onto the
            // outgoing response so the browser actually receives them.
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set({ name, value, ...options });
            });
          },
        },
      }
    );

    await supabase.auth.exchangeCodeForSession(code);
  }

  return response;
}
