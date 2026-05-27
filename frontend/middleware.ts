import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  RATE_LIMITS,
  classifyRoute,
  clientIp,
  rateLimit,
} from "./app/lib/rateLimit";

const PROTECTED_PATTERNS: RegExp[] = [
  /^\/account(?:\/|$)/,
  /^\/portfolio(?:\/|$)/,
];

function tooManyRequests(resetSeconds: number) {
  return new NextResponse("Too Many Requests", {
    status: 429,
    headers: {
      "Retry-After": String(resetSeconds),
      "Content-Type": "text/plain",
    },
  });
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // 1) Rate limit /api/* and /auth/* before any auth work.
  const routeClass = classifyRoute(path);
  if (routeClass) {
    const { limit, windowMs } = RATE_LIMITS[routeClass];
    const ip = clientIp(req);
    const result = rateLimit(`${routeClass}:${ip}`, limit, windowMs);
    if (!result.success) return tooManyRequests(result.resetSeconds);
  }

  const res = NextResponse.next({ request: req });

  // 2) Fail closed if Supabase env vars are missing — for protected
  //    routes we cannot verify the session, so deny rather than allow.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    const requiresAuth = PROTECTED_PATTERNS.some((re) => re.test(path));
    if (requiresAuth) {
      return new NextResponse("Service unavailable", { status: 503 });
    }
    return res;
  }

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

  // 3) Refresh the session and surface rotated cookies onto this response.
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    "/api/:path*",
    "/auth/:path*",
  ],
};
