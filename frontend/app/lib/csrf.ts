import { NextResponse, type NextRequest } from "next/server";

const ALLOWED_ORIGINS = new Set(
  [
    process.env.NEXT_PUBLIC_SITE_URL ?? "",
    "https://pokefin.ca",
    "https://www.pokefin.ca",
  ].filter(Boolean)
);

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (
    process.env.NODE_ENV !== "production" &&
    origin.startsWith("http://localhost")
  ) {
    return true;
  }
  return false;
}

/**
 * Validate the standard CSRF gate used by every state-changing route
 * handler: a custom `x-pokefin-request: 1` header (browsers don't
 * attach custom headers on cross-site form/link navigations) and an
 * allowlisted Origin.
 *
 * Returns a 403 NextResponse if the request fails the check, or null
 * if it passes (continue handling).
 */
export function rejectIfCsrfFails(req: NextRequest): NextResponse | null {
  if (req.headers.get("x-pokefin-request") !== "1") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isAllowedOrigin(req.headers.get("origin"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * Reject oversized request bodies. DELETE / POST handlers that don't
 * read multi-KB bodies should set a low cap (e.g. 1 KiB).
 */
export function rejectIfBodyTooLarge(
  req: NextRequest,
  maxBytes: number
): NextResponse | null {
  const contentLength = parseInt(
    req.headers.get("content-length") ?? "0",
    10
  );
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return NextResponse.json(
      { error: "Payload too large" },
      { status: 413 }
    );
  }
  return null;
}
