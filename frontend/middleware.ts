import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PROTECTED_PATTERNS: RegExp[] = [
  /^\/account(?:\/|$)/,
  /^\/portfolio(?:\/|$)/,
];

export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: req });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) return res;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookies.set({ name, value, ...options });
        });
      },
    },
  });

  // Touching getUser refreshes the session and triggers the cookie
  // setAll above so rotated tokens reach the browser on this response.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;
  const requiresAuth = PROTECTED_PATTERNS.some((re) => re.test(path));

  if (requiresAuth && !user) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: [
    "/account/:path*",
    "/portfolio/:path*",
    "/api/account/:path*",
    "/auth/callback",
  ],
};
