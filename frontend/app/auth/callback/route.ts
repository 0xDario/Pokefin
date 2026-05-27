import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { stripControlChars } from "../../lib/validation";

function safeNextPath(raw: string | null): string {
  if (!raw) return "/";
  // Strip ASCII control characters (CR/LF can split log lines or
  // headers if the value is ever propagated).
  const cleaned = stripControlChars(raw);
  // Only allow same-origin relative paths beginning with a single
  // forward slash. Block protocol-relative ("//evil"), URL-encoded
  // slashes, backslashes, and anything that decodes to a network-path
  // reference.
  if (!cleaned.startsWith("/")) return "/";
  if (cleaned.startsWith("//") || cleaned.startsWith("/\\")) return "/";
  try {
    const decoded = decodeURIComponent(cleaned);
    if (decoded.startsWith("//") || decoded.startsWith("/\\")) return "/";
  } catch {
    return "/";
  }
  return cleaned;
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
