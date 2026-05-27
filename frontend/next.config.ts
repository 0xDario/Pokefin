import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tcgplayer.com https://tcgplayer.com https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [
      // Limit the next/image optimizer to specific paths on these hosts.
      // Closes file-handling F-6 (overly broad remotePatterns).
      {
        protocol: "https",
        hostname: "**.tcgplayer.com",
        pathname: "/images/**",
      },
      {
        protocol: "https",
        hostname: "tcgplayer.com",
        pathname: "/images/**",
      },
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// withSentryConfig is a no-op when SENTRY_AUTH_TOKEN / NEXT_PUBLIC_SENTRY_DSN
// aren't set; safe to ship before you provision the Sentry project.
export default withSentryConfig(nextConfig, {
  silent: !process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // `disableLogger` was deprecated in @sentry/nextjs 10.x in favour of
  // the nested `webpack.treeshake.removeDebugLogging` option. Same
  // semantics — strips Sentry's internal debug logger calls from the
  // production bundle to shave bundle size. (Currently a no-op under
  // Turbopack; Sentry surfaces a separate notice for that.)
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
  sourcemaps: {
    // Delete sourcemap files after they've been uploaded so they
    // don't ship in the public bundle.
    deleteSourcemapsAfterUpload: true,
  },
});
