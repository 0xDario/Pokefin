# WP13: SEO metadata, 404 and loading states, login return-to

- **Findings covered**
  - F028 (full; cluster members F028, F029, F088): every navigation page renders the same `<title>`, and the site has no `metadataBase`, no default OG image, no canonical links, no `robots.txt`, no `sitemap.xml` and no Product structured data. Shared product links show the site name and no picture.
  - F093 (full as scoped by the plan; cluster members F093, F087, F100): no `not-found.tsx` (Next's stock 404, which also turns the body black in dark mode), no `loading.tsx` on the dynamic product route, and zero-result searches on `/prices` and `/market` show "Found 0 products" over nothing. Not in this package: the "Loading price history" toast (WP03 removed it), the `/prices` "Loading…" Suspense fallback (WP08 removed it), and the `ProductImage` "Loading..." text (WP12 owns `ProductImage.tsx` and its tests assert that text; see Pitfalls).
  - F002 (full; cluster members F002, F006, F021, F027, F129): the login page ignores the return-to destination, the three auth gates disagree on the parameter (`next`, `redirect`, none), and the only validator (`safeNextPath`) is private to the OAuth callback.
- **Priority rationale**: cheap, low-risk fixes to how every page looks in tabs, search results and link previews, plus a sign-in flow that finally returns people to the page they asked for.
- **Effort**: M, about 7 to 9 hours including tests and the stub-build checks.
- **Depends on**: WP04 (the `sessionStatus` redirect effects in `app/portfolio/page.tsx` and `app/account/page.tsx`, and `signIn` setting `"authenticated"` immediately). Also assumes the already-merged WP00 (`pnpm build:stub`, `scripts/supabase-stub.mjs`), WP02 (login page `turnstileRef`, callback route with `RESET_PASSWORD_PATH` and `?error=auth_link`, and `app/lib/siteUrl.ts` with `getSiteUrl()` and the apex fallback `FALLBACK_SITE_URL = "https://pokefin.ca"`), WP03 ("updated daily" description in `layout.tsx`), WP08 (`updateUrlState` and `PRICES_URL_DEFAULTS` in `/prices`, stub `SUPABASE_STUB_FIXTURE=catalog`), WP11 (`/compare` page is a server component; product page has `revalidate` and `generateStaticParams`). WP02 is a hard prerequisite (WP04 depends on it); for WP08 and WP11 each step says what to do when one of them has not landed.
- **Unblocks**: nothing in the plan depends on it formally. WP14 and WP15 must edit `app/auth/login/LoginForm.tsx` (not `page.tsx`) and the new `NotFoundPanel.tsx` / `NoResults.tsx` components after this lands. WP17's coverage config (which lists server pages explicitly) must treat `app/auth/login/page.tsx` and `app/analytics/page.tsx` as server pages after this PR; `LoginForm.tsx` is the client component.
- **Suggested branch name**: `remediation/wp13-seo-and-navigation`
- **Risk level**: medium. It changes the `<head>` of every page (a wrong canonical can de-index pages) and the post-login navigation; unit tests, the stub-build HTML checks and the owner's host check bound both.

## Why

Today every tab, bookmark and history entry on Pokéfin reads "Pokémon Sealed Product Price Tracker", whether it is Prices, Market View, a product or the 404 page, and pasting a product link into a chat shows a text-only card with the site name instead of the product and its photo. Search engines get no sitemap for the roughly 300 product pages (the site's best organic entry points), no canonical links (so `/stats` and `/analytics` are indexed as duplicates) and no Product data for rich results. A mistyped or stale product link lands on Next's unbranded "404 / This page could not be found" block, which goes black on dark-mode phones, tapping a product card gives no feedback until the server answers, and a search with no matches shows "Found 0 products" over an empty area. Finally, a visitor bounced from `/portfolio` or `/account` to sign in always lands on the home page afterwards. After this PR each page has its own title, description, canonical and preview image, product pages carry their photo and a Product JSON-LD block, `robots.txt` and `sitemap.xml` exist, bad links get a branded 404 with search, product navigation shows a skeleton instantly, empty results offer "Clear filters", and signing in returns the user to the validated `next` page.

## Before you start

Read these files fully (paths relative to `frontend/`):

- `app/layout.tsx` (58 lines at review time). Metadata is `:26-36`; `openGraph.url` is hardcoded to the apex at `:34`.
- `app/product/[id]/page.tsx` (431 lines at review time). `getProductLabel` `:31-37`; `generateMetadata` `:125-147` (hand-written `· Pokéfin` suffixes at `:137` and `:144`); the page `:149-159`, where `:156` `if (!Number.isFinite(productId)) notFound();` and `:159` `if (!detail) notFound();` already exist; `<main>` opens at `:225`. WP07, WP11 and WP12 have edited this file; find blocks by content.
- `app/auth/login/page.tsx` (138 lines at review time, a `"use client"` page). `handleSubmit` `:35-48` with the unconditional `router.push("/")` at `:46`; error box `:60-64`; `<form>` `:66`; `<Turnstile>` `:103-106`.
- `app/auth/callback/route.ts`. `safeNextPath` `:6-24`, imported helper `stripControlChars` `:4`. After WP02 the file also has `RESET_PASSWORD_PATH`, `AUTH_LINK_FAILED_PATH` and a `GET` that routes recovery links through `next === RESET_PASSWORD_PATH`.
- `app/lib/validation.ts:62-65` (`stripControlChars`).
- `app/lib/siteUrl.ts` (WP02 step 3): `const FALLBACK_SITE_URL = "https://pokefin.ca";`, `getSiteUrl(): string` (the `NEXT_PUBLIC_SITE_URL` value when it matches `^https?://[^/]+`, else the fallback, trailing slashes removed) and `authCallbackUrl()`. This PR reuses `getSiteUrl` for every SEO URL; it does not add a second site-URL reader.
- `app/portfolio/page.tsx` (redirect effect, `router.push("/auth/login?redirect=/portfolio")` at `:37` before WP04, inside a `sessionStatus === "anonymous"` effect after WP04) and `app/account/page.tsx` (`router.push("/auth/login")` at `:42`, same WP04 shape).
- `proxy.ts:69-89` (already redirects anonymous `/account` and `/portfolio` hits to `/auth/login?next=<path>`; no change needed) and `:94-100` (matcher: `robots.txt`, `sitemap.xml` and `opengraph-image` are not covered, so they are not rate-limited).
- `app/prices/page.tsx`, `app/market/page.tsx`, `app/analytics/page.tsx` (1 line: `export { default } from "../stats/page";`), `app/stats/page.tsx:106`, `app/box-calculator/page.tsx`, `app/compare/page.tsx`, `app/privacy/page.tsx:4-7`, and the auth pages `app/auth/signup/page.tsx`, `app/auth/forgot-password/page.tsx`, `app/auth/reset-password/page.tsx` (all `"use client"`, so they cannot export `metadata` themselves).
- `app/components/ProductPrices/index.tsx` (after WP08: `updateUrlState`, `deferredSearchTerm`, the "Found {n} products" line and `{loading && ...}` line near the end of the JSX) and `app/components/ProductPrices/utils/urlState.ts` (`PRICES_URL_DEFAULTS`).
- `app/components/MarketView/MarketView.tsx`: filter state `:224-237`, `rows` `:282`, "Found {rows.length} products" `:673`, `{loading && ...}` `:689`, table block `:691-857`.
- `app/page.tsx:211-229` (the hero search form the 404 page copies), `app/globals.css:1-8,66-69` (light-only palette), `next.config.ts:51-77`.
- `app/lib/serverMarketData.ts:896-903` (`getCachedMarketProductSummaries`; `fetchMarketProductSummaries` `:818-827` throws when both the RPC and the fallback fail) and `app/lib/priceGuard.ts:135-140` (`hasCurrentPrice`).
- Next docs shipped in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/`: `not-found.md`, `loading.md` (section "Status Codes"), `01-metadata/sitemap.md`, `01-metadata/robots.md`, `01-metadata/opengraph-image.md`.
- `node_modules/next/dist/lib/metadata/resolvers/resolve-url.js:69-92` (`"./"` resolves against the request pathname; a bare `"/"` resolves to the origin) and `node_modules/next/dist/lib/metadata/resolve-metadata.js:603-660` (`og:title` and `og:description` are filled from the page's `title`/`description` only when the inherited `openGraph` block has none).

Confirm the starting state (run from `frontend/`):

```bash
git log --oneline -30                         # WP04 merged (WP02, WP03, WP08, WP11 expected too)
grep -n 'sessionStatus' app/portfolio/page.tsx app/account/page.tsx
#   expect matches in both files. If none: WP04 has not landed. STOP, this PR depends on it.
grep -n 'metadataBase\|canonical\|url: "https://pokefin.ca"' app/layout.tsx
#   expect only: url: "https://pokefin.ca"  (no metadataBase, no canonical)
grep -rln 'export const metadata\|generateMetadata' app --include=*.tsx | grep -v __tests__
#   expect exactly: app/layout.tsx, app/privacy/page.tsx, app/product/[id]/page.tsx
ls app/robots.ts app/sitemap.ts app/not-found.tsx app/opengraph-image.tsx "app/product/[id]/loading.tsx" 2>&1 | grep -c 'No such file'
#   expect 5
grep -rn 'function safeNextPath' app            # expect app/auth/callback/route.ts only
grep -n 'router.push("/")' app/auth/login/page.tsx   # expect 1 match (the bug)
grep -rn 'auth/login' app/portfolio/page.tsx app/account/page.tsx
#   expect "/auth/login?redirect=/portfolio" and a bare "/auth/login"
grep -n 'turnstileRef' app/auth/login/page.tsx            # WP02 landed: 3+ matches
grep -n 'RESET_PASSWORD_PATH' app/auth/callback/route.ts   # WP02 landed: 2+ matches
grep -n 'updateUrlState' app/components/ProductPrices/index.tsx   # WP08 landed: several matches
grep -n 'PRICES_URL_DEFAULTS' app/components/ProductPrices/utils/urlState.ts   # WP08 landed: 1+ match
head -1 app/compare/page.tsx                  # WP11 landed: NOT "use client"
grep -n 'generateStaticParams\|export const revalidate' "app/product/[id]/page.tsx"   # WP11 landed: 2 matches
grep -rn 'No products match' app              # expect no output
grep -n 'FALLBACK_SITE_URL\|export function getSiteUrl' app/lib/siteUrl.ts
#   expect: const FALLBACK_SITE_URL = "https://pokefin.ca"; and export function getSiteUrl(): string {
#   If the file is missing, WP02 has not landed. STOP, this PR depends on it.
grep -n 'SITE_URL' .env.example                # expect: NEXT_PUBLIC_SITE_URL=http://localhost:3000 (local dev value)
```

Record the lint baseline for the files you will touch (compare in Verification):

```bash
pnpm exec eslint app/layout.tsx "app/product/[id]" app/auth app/portfolio app/account \
  app/prices/page.tsx app/market/page.tsx app/analytics/page.tsx app/box-calculator/page.tsx \
  app/compare/page.tsx app/privacy/page.tsx app/lib/siteUrl.ts app/components/ProductPrices/index.tsx \
  app/components/MarketView/MarketView.tsx 2>&1 | tail -3
```

(`next.config.ts` is in the ESLint ignore list, so it is not linted; `tsc` covers it.)

Record which files read the site URL (compare in Verification):

```bash
grep -rn 'NEXT_PUBLIC_SITE_URL' app --include=*.ts --include=*.tsx | grep -v __tests__
```

Assumptions to check while reading:

1. **Apex, through WP02's helper.** The canonical host is the apex `https://pokefin.ca`: `layout.tsx:34` hardcodes it, `audits/HARDENING_FOLLOWUPS.md:87` records `NEXT_PUBLIC_SITE_URL = https://pokefin.ca` as the production value, and WP02 (already merged) fixed its fallback to the apex in `app/lib/siteUrl.ts` and made its owner set Production `NEXT_PUBLIC_SITE_URL` to exactly `https://pokefin.ca` with `www` redirecting to it (WP02 owner action 4). `.env.example:9` is `http://localhost:3000`; only its comment on line 8 mentions `www` as an example. This spec therefore derives every SEO URL from WP02's `getSiteUrl()` (the env value, else the apex). Do not add a second fallback constant and do not hardcode either host anywhere else. The owner re-checks the serving host in Owner actions.
2. **Product 404s already exist.** `page.tsx:156,159` already call `notFound()`. The gap is id parsing: `Number()` accepts `"0x2a"`, `"4.2e1"`, `"042"` and `" 42"`, so `/product/0x2a` renders product 42 under a second URL. Step 7 makes parsing strict.
3. **The callback must keep accepting `/auth/...` targets.** WP02 routes password recovery through `next=/auth/reset-password` in `app/auth/callback/route.ts`. The new "no `/auth/` targets" rule must therefore live in a separate function used by the login page only (step 2).

## Implementation steps

Do the steps in order. Steps 1 and 2 add the shared helpers the later steps import.

### 1. Export WP02's fallback and add `frontend/app/lib/site.ts`

1a. `frontend/app/lib/siteUrl.ts` (WP02's file): change the one line `const FALLBACK_SITE_URL = "https://pokefin.ca";` to `export const FALLBACK_SITE_URL = "https://pokefin.ca";`. Change nothing else in that file (`getSiteUrl` and `authCallbackUrl` keep their bodies and signatures; the auth routes use them).

1b. New `frontend/app/lib/site.ts`: the SEO view of the same origin, the site name and the no-index robots value. It reads the origin only through WP02's `getSiteUrl()`, so auth emails and SEO URLs can never disagree.

```ts
import type { Metadata } from "next";
import { FALLBACK_SITE_URL, getSiteUrl } from "./siteUrl";

export const SITE_NAME = "Pokéfin";

/**
 * The public origin of the site as a URL, for metadataBase, canonical links,
 * the sitemap and JSON-LD. Always an origin (a path in the configured site
 * URL is dropped). Never throws: getSiteUrl() only checks the value with a regex,
 * so a value URL() rejects falls back instead of failing the build.
 */
export function getSiteOrigin(): URL {
  try {
    return new URL(new URL(getSiteUrl()).origin);
  } catch {
    return new URL(FALLBACK_SITE_URL);
  }
}

/** Absolute URL for a site path. "/" becomes the bare origin, as Next renders it. */
export function absoluteUrl(path: string): string {
  const base = getSiteOrigin();
  if (path === "/") return base.origin;
  return new URL(path, base).toString();
}

/** For pages that must never appear in search results (auth, account, portfolio). */
export const NO_INDEX: NonNullable<Metadata["robots"]> = {
  index: false,
  follow: true,
};
```

### 2. New `frontend/app/lib/redirects.ts`, and the callback imports from it (F002)

2a. Create the file. `safeNextPath` is moved verbatim from `app/auth/callback/route.ts:6-24` (only `export` and the doc comment are new). `safeReturnToPath` adds the two rules the login page needs. `loginPathWithNext` is what the client-side auth gates call.

```ts
import { stripControlChars } from "./validation";

/**
 * Validate a user-supplied redirect target. Returns a same-origin relative
 * path, or "/" for anything else. Moved unchanged from
 * app/auth/callback/route.ts, which still uses it: the callback must accept
 * /auth/... targets because password recovery is routed through
 * next=/auth/reset-password.
 */
export function safeNextPath(raw: string | null | undefined): string {
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

// Never a post-login destination: /auth/* would loop the user back onto the
// sign-in pages, /api/* is not a page.
const NON_RETURN_PREFIXES = ["/auth", "/api"];

/**
 * Where to send the user after a successful password sign-in. Same rules as
 * safeNextPath, plus: never back onto /auth/* or /api/*.
 */
export function safeReturnToPath(raw: string | null | undefined): string {
  const safe = safeNextPath(raw);
  if (safe === "/") return "/";
  let pathOnly: string;
  try {
    // URL() drops ?query and #hash and resolves "..", "%2e%2e" and "\" the
    // way the router will ("/portfolio/../auth/login" is "/auth/login");
    // decodeURIComponent then catches "/%61uth/login". The base is never
    // used for navigation.
    pathOnly = decodeURIComponent(
      new URL(safe, "https://return-to.invalid").pathname
    ).toLowerCase();
  } catch {
    return "/";
  }
  const blocked = NON_RETURN_PREFIXES.some(
    (prefix) => pathOnly === prefix || pathOnly.startsWith(`${prefix}/`)
  );
  return blocked ? "/" : safe;
}

/**
 * The login URL for a client-side auth gate, carrying the page to return to
 * in `next` (the same parameter proxy.ts sets). A target that would be
 * rejected after sign-in is dropped here too.
 */
export function loginPathWithNext(returnTo: string): string {
  const target = safeReturnToPath(returnTo);
  if (target === "/") return "/auth/login";
  return `/auth/login?next=${encodeURIComponent(target)}`;
}
```

2b. `frontend/app/auth/callback/route.ts`: delete the `safeNextPath` function (`:6-24`, the whole function), delete the `import { stripControlChars } from "../../lib/validation";` line (nothing else in the file uses it; `tsc` and ESLint confirm), and add:

```ts
import { safeNextPath } from "../../lib/redirects";
```

Leave every other line of the callback, including WP02's `RESET_PASSWORD_PATH` logic, unchanged. The callback keeps calling `safeNextPath`, not `safeReturnToPath` (see Pitfalls).

Run `grep -rn 'lib/redirect\.ts\|lib/redirect"' app`. The review's recommendation named the file `redirect.ts`; the plan uses `redirects.ts`. If the grep prints a comment, change it to `redirects.ts`; if it prints nothing, move on.

### 3. Root metadata: `frontend/app/layout.tsx` (F028)

Add below the existing imports:

```ts
import { getSiteOrigin, SITE_NAME } from "./lib/site";
```

Replace the whole `export const metadata: Metadata = { ... };` block (`:26-36`) with the block below. Keep WP03's description text exactly (the string that says "updated daily from TCGPlayer"); only the structure changes.

```ts
export const metadata: Metadata = {
  // Resolves every relative URL below (canonical, og:url, images) against the
  // real public origin. Without it Next falls back to http://localhost:3000.
  metadataBase: getSiteOrigin(),
  title: {
    default: "Pokéfin: Pokémon Sealed Product Price Tracker",
    // Child pages set a bare title ("Sealed Product Prices") and get the
    // suffix from here. Never hand-write "· Pokéfin" in a page title.
    template: `%s · ${SITE_NAME}`,
  },
  description:
    "Get up-to-date Pokémon sealed product prices, updated daily from TCGPlayer. Track the latest market trends and values for Pokémon TCG sealed items.",
  applicationName: SITE_NAME,
  // "./" resolves against each request's own pathname, so every page is its
  // own canonical (/prices -> https://.../prices, query string dropped).
  // A bare "/" here would be inherited by every page and mark all of them as
  // duplicates of the home page.
  alternates: { canonical: "./" },
  // No title or description here on purpose: Next then fills og:title and
  // og:description from each page's own title and description. The image
  // comes from app/opengraph-image.tsx.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: "./",
  },
  twitter: { card: "summary_large_image" },
};
```

Member finding F029 asks for a theme colour; the F028 verifier says it belongs in the `viewport` export, not in `metadata`. Change the first line of the file from `import type { Metadata } from "next";` to `import type { Metadata, Viewport } from "next";` and add directly below the `metadata` block:

```ts
// Browser UI colour (mobile address bar). White matches the sticky white
// header; the site has no dark theme (globals.css is light only).
export const viewport: Viewport = {
  themeColor: "#ffffff",
};
```

Next emits `<meta name="theme-color" content="#ffffff"/>` on every page. Do not put `themeColor` inside `metadata`.

### 4. Per-route metadata (F028)

Every title below is bare; the layout template appends ` · Pokéfin`. Add `import type { Metadata } from "next";` to each file that does not already import it.

4a. `frontend/app/prices/page.tsx` (server component). Below the imports:

```ts
export const metadata: Metadata = {
  title: "Sealed Product Prices",
  description:
    "Current market prices for every tracked Pokémon TCG sealed product, from booster boxes to Elite Trainer Boxes, updated daily from TCGPlayer.",
};
```

4b. `frontend/app/market/page.tsx`:

```ts
export const metadata: Metadata = {
  title: "Market View",
  description:
    "Compare Pokémon TCG sealed products by price, returns, sales volume and short-term trend in one sortable table.",
};
```

4c. `frontend/app/analytics/page.tsx`. Replace the one-line file with:

```ts
import type { Metadata } from "next";

// /stats permanently redirects here (next.config.ts), so this is the only URL
// that serves the set analytics page. Segment config (revalidate, dynamic) is
// NOT inherited through this re-export; declare it here if it is ever needed.
export { default } from "../stats/page";

export const metadata: Metadata = {
  title: "Set Analytics",
  description:
    "Rank Pokémon TCG sets by average and median returns, consistency and invest score, updated daily.",
};
```

Do not delete or move `app/stats/page.tsx`; this file imports it.

4d. `frontend/app/box-calculator/page.tsx`:

```ts
export const metadata: Metadata = {
  title: "Box Calculator",
  description:
    "Price any Pokémon TCG collection box against today's booster pack prices to see whether it is a good deal.",
};
```

4e. `/compare`. Run `head -1 app/compare/page.tsx`.
- If it is not `"use client"` (WP11 landed; the client code lives in `CompareDashboard.tsx`), add to `app/compare/page.tsx`:

```ts
export const metadata: Metadata = {
  title: "Seller Tools",
  description:
    "Upload a Shopify export and compare your store prices against the Pokémon sealed product market.",
};
```

- If it is still `"use client"`, create `app/compare/layout.tsx` instead, with the same `metadata` object and `export default function CompareLayout({ children }: { children: React.ReactNode }) { return children; }`. WP11's spec already says to leave such a layout untouched.

4f. `frontend/app/privacy/page.tsx:5`: the title string is "Privacy Policy", a dash character and "Pokefin". Replace the whole line with `title: "Privacy Policy",` (otherwise the template appends a second site name: "Privacy Policy, dash, Pokefin · Pokéfin"). Leave the description.

4g. Client-component routes get a pass-through `layout.tsx` that only carries metadata. Create each file exactly like this, changing the names, title and description:

`frontend/app/portfolio/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { NO_INDEX } from "../lib/site";

export const metadata: Metadata = {
  title: "My Portfolio",
  description: "Track the value and returns of your Pokémon sealed product collection.",
  robots: NO_INDEX,
};

export default function PortfolioLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

`frontend/app/account/layout.tsx`: `AccountLayout`, title `"Account settings"`, description `"Manage your Pokéfin username, password and data."`, `robots: NO_INDEX`, import from `"../lib/site"`.

`frontend/app/auth/signup/layout.tsx`: `SignUpLayout`, title `"Create an account"`, description `"Create a free Pokéfin account to track your sealed product portfolio."`, `robots: NO_INDEX`, import from `"../../lib/site"`.

`frontend/app/auth/forgot-password/layout.tsx`: `ForgotPasswordLayout`, title `"Forgot password"`, description `"Request a link to reset your Pokéfin password."`, `robots: NO_INDEX`, import from `"../../lib/site"`.

`frontend/app/auth/reset-password/layout.tsx`: `ResetPasswordLayout`, title `"Reset password"`, description `"Choose a new password for your Pokéfin account."`, `robots: NO_INDEX`, import from `"../../lib/site"`.

None of these layouts renders markup of its own; they must return `children` unchanged so the pages look exactly as before.

The login route gets its metadata in step 11 (its `page.tsx` becomes a server component). Do not add a layout for `/auth/login`.

The home page (`app/page.tsx`) needs no change: it inherits `title.default`, the description and the canonical.

### 5. `/stats` duplicate: `frontend/next.config.ts` (F028)

`/analytics` is the URL the header and footer link to (`Header.tsx:11`, `Footer.tsx:9`); `/stats` serves identical content. Add a `redirects()` method to `nextConfig`, directly after the `headers()` method (`:74-76`):

```ts
  async redirects() {
    // /analytics is the linked URL (Header, Footer); /stats served the same
    // page under a second URL with no canonical (review F028).
    return [{ source: "/stats", destination: "/analytics", permanent: true }];
  },
```

Leave the rest of the file, including `withSentryConfig`, unchanged.

### 6. Default share image and touch icon (F028)

6a. New `frontend/app/opengraph-image.tsx`. Statically generated at build (no request data), used as `og:image` and, through Next's twitter auto-fill, `twitter:image` for every page that does not set its own `openGraph` (only product pages do).

```tsx
import { ImageResponse } from "next/og";

export const alt = "Pokéfin: Pokémon sealed product prices, returns and trends";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <div style={{ display: "flex", fontSize: 30, letterSpacing: 6, color: "#dc2626" }}>
          POKÉFIN
        </div>
        <div style={{ display: "flex", marginTop: 24, fontSize: 72, lineHeight: 1.1 }}>
          Pokémon Sealed Product Prices
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 34, color: "#475569" }}>
          Market prices, returns and trends, updated daily from TCGPlayer.
        </div>
      </div>
    ),
    size
  );
}
```

Every `div` with more than one child must keep `display: "flex"` (Satori rejects anything else).

6b. Icons: run `file app/favicon.ico` (expect `PNG image data, 512 x 512`; the `.ico` is really a PNG, which the review found served as `type="image/x-icon"`), then `cp app/favicon.ico app/icon.png` and `cp app/favicon.ico app/apple-icon.png`. Next then emits `<link rel="icon" href="/icon.png?..." type="image/png" sizes="512x512">` and `<link rel="apple-touch-icon" href="/apple-icon.png?..." ...>` on every page. Do not delete or rename `favicon.ico` (browsers still request `/favicon.ico` directly). If `file` does not report a PNG, skip both copies and say so in the PR.

### 7. Product metadata, strict ids and JSON-LD (F028, F093)

7a. New `frontend/app/product/[id]/productMeta.ts` (a plain module next to the page; only `page.tsx` and route files are routes). Pure functions, unit-tested in step 13.

```ts
import type { Metadata } from "next";
import type { Product } from "../../components/ProductPrices/types";
import { hasCurrentPrice } from "../../lib/priceGuard";
import { absoluteUrl, NO_INDEX, SITE_NAME } from "../../lib/site";

// Canonical positive integers only: "42", never "042", "4.2e1", "0x2a" or
// " 42". Number() accepts all of those, which served the same product under
// several URLs.
const PRODUCT_ID_RE = /^[1-9]\d{0,15}$/;

export function parseProductId(raw: string): number | null {
  if (!PRODUCT_ID_RE.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export function productPath(id: number): string {
  return `/product/${id}`;
}

// Moved from page.tsx (was :31-37), unchanged.
export function getProductLabel(product: Product) {
  return (
    product.product_types?.label ||
    product.product_types?.name ||
    "Unknown Product"
  );
}

/** "Prismatic Evolutions Elite Trainer Box (Pokemon Center)". */
export function getProductDisplayName(product: Product): string {
  const setName = product.sets?.name ?? "Unknown Set";
  const variant = product.variant ? ` (${product.variant})` : "";
  return `${setName} ${getProductLabel(product)}${variant}`;
}

// Used by generateMetadata and by ./not-found.tsx: depending on whether the
// response streams, Next takes the 404's head from one or the other.
export const PRODUCT_NOT_FOUND_METADATA: Metadata = {
  title: "Product not found",
  robots: NO_INDEX,
  // No canonical on an error page (the layout's "./" would point at the bad URL).
  alternates: { canonical: null },
};

export function buildProductMetadata(product: Product): Metadata {
  const name = getProductDisplayName(product);
  const setName = product.sets?.name ?? "Unknown Set";
  const label = getProductLabel(product);
  const path = productPath(product.id);
  return {
    // Bare title: the root layout template appends " · Pokéfin".
    title: name,
    description: `Live price, return metrics, and one-year price history for ${setName} ${label} sealed product.`,
    // Explicit, from the product's own id, so any alias URL canonicalises here.
    alternates: { canonical: path },
    // Replaces the layout's openGraph block wholesale, so repeat siteName and
    // url. og:title and og:description are filled from title/description.
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      url: path,
      // image_url values are absolute storage URLs (main.py uploads them).
      ...(product.image_url
        ? { images: [{ url: product.image_url, alt: name }] }
        : {}),
    },
    // Product photos are roughly square; the large card would crop them.
    twitter: { card: "summary" },
  };
}

type JsonLd = Record<string, unknown>;

/**
 * schema.org Product for /product/[id]. `offers` is present only when the
 * price guard says the price is current: a withheld (stale) price is never
 * published, here or anywhere else.
 */
export function buildProductJsonLd(product: Product): JsonLd {
  const jsonLd: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: getProductDisplayName(product),
    url: absoluteUrl(productPath(product.id)),
    category: getProductLabel(product),
    brand: { "@type": "Brand", name: "Pokémon" },
  };
  if (product.image_url) jsonLd.image = [product.image_url];
  if (product.sku) jsonLd.sku = product.sku;
  if (hasCurrentPrice(product) && typeof product.usd_price === "number") {
    jsonLd.offers = {
      "@type": "Offer",
      price: product.usd_price.toFixed(2),
      priceCurrency: "USD",
      url: absoluteUrl(productPath(product.id)),
    };
  }
  return jsonLd;
}

/**
 * JSON for a <script type="application/ld+json"> body. Escaping "<" stops a
 * product or set name containing "</script>" from closing the tag.
 */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
```

7b. `frontend/app/product/[id]/page.tsx`:

- Delete the local `getProductLabel` function (`:31-37`) and add this import next to the other local imports (near `import ProductDetailChart from "./ProductDetailChart";`):

```ts
import {
  buildProductJsonLd,
  buildProductMetadata,
  getProductLabel,
  parseProductId,
  PRODUCT_NOT_FOUND_METADATA,
  serializeJsonLd,
} from "./productMeta";
```

  The page's other uses of `getProductLabel` (the `label` constant and the sibling grid) keep working through the import. At review time `Product` was used only by the deleted function: after the edits in this step, run `grep -nw "Product" "app/product/[id]/page.tsx"`; if the only hit is the `import { Product } from "../../components/ProductPrices/types";` line, delete that line (otherwise ESLint reports an unused import).

- Replace the body of `generateMetadata` (`:125-147`, the whole function) with:

```ts
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const productId = parseProductId(id);
  const detail =
    productId === null ? null : await getCachedProductDetail(productId);
  if (!detail) return PRODUCT_NOT_FOUND_METADATA;
  return buildProductMetadata(detail.product);
}
```

- In `ProductPage`, replace the first lines (`:154-159`):

```ts
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isFinite(productId)) notFound();

  const detail = await getCachedProductDetail(productId);
  if (!detail) notFound();
```

  with:

```ts
  const { id } = await params;
  const productId = parseProductId(id);
  if (productId === null) notFound();

  const detail = await getCachedProductDetail(productId);
  if (!detail) notFound();
```

- Make the JSON-LD script the first child of the page's `<main className="p-3 md:p-6">` (directly above the `{/* Breadcrumb */}` comment):

```tsx
      {/* Product JSON-LD. Escaped by serializeJsonLd; data, not executable script. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildProductJsonLd(product)) }}
      />
```

Do not change anything else in the page (WP07's formatters, WP11's `revalidate` and `generateStaticParams`, WP12's `priority` hero image stay as they are). If WP11 has not landed, do not add `generateStaticParams` here (see Pitfalls).

### 8. `robots.txt` and `sitemap.xml` (F028)

8a. New `frontend/app/robots.ts`:

```ts
import type { MetadataRoute } from "next";
import { absoluteUrl } from "./lib/site";

export default function robots(): MetadataRoute.Robots {
  // Vercel sets VERCEL_ENV at build time. Preview deployments must never be
  // indexed; production and local builds (VERCEL_ENV unset) get the real file.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /auth/* is NOT disallowed: those pages carry a noindex meta tag, and
      // a crawler that is blocked from fetching them never sees it.
      disallow: ["/api/", "/account", "/portfolio"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
```

8b. New `frontend/app/sitemap.ts`:

```ts
import type { MetadataRoute } from "next";
import { getCachedMarketProductSummaries } from "./lib/serverMarketData";
import { absoluteUrl } from "./lib/site";

// Regenerated at most daily. Must stay a number literal (read statically).
export const revalidate = 86400;

type ChangeFrequency = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

// Public, indexable pages only. /stats redirects to /analytics; /portfolio,
// /account and /auth/* are private or noindex.
const STATIC_ROUTES: Array<{ path: string; changeFrequency: ChangeFrequency; priority: number }> = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/prices", changeFrequency: "daily", priority: 0.9 },
  { path: "/market", changeFrequency: "daily", priority: 0.8 },
  { path: "/analytics", changeFrequency: "daily", priority: 0.6 },
  { path: "/box-calculator", changeFrequency: "weekly", priority: 0.5 },
  { path: "/compare", changeFrequency: "monthly", priority: 0.3 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.1 },
];

function toDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Not caught on purpose: fetchMarketProductSummaries only throws when both
  // the RPC and its fallback failed. At build that fails the build exactly as
  // the home page would; during a background regeneration Next keeps serving
  // the previous sitemap instead of caching one without products.
  const products = await getCachedMarketProductSummaries();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const productEntries: MetadataRoute.Sitemap = products
    .filter((product) => Number.isSafeInteger(product.id) && product.id > 0)
    .map((product) => ({
      url: absoluteUrl(`/product/${product.id}`),
      lastModified: toDate(product.price_recorded_at ?? product.last_updated),
      changeFrequency: "daily" as const,
      priority: 0.7,
    }));

  return [...staticEntries, ...productEntries];
}
```

Do not add `generateStaticParams` for the 300 products anywhere; the sitemap is the discovery lever.

### 9. Branded 404 pages (F093)

9a. New `frontend/app/components/NotFoundPanel.tsx` (server component, no `"use client"`). The search form mirrors `app/page.tsx:211-229` and works without JavaScript.

```tsx
import Link from "next/link";

type NotFoundPanelProps = {
  title: string;
  message: string;
};

export default function NotFoundPanel({ title, message }: NotFoundPanelProps) {
  return (
    <main className="p-3 md:p-6">
      <section className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 md:p-10 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--pf-pokeball)]">
          Error 404
        </p>
        <h1 className="mt-1 text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
          {title}
        </h1>
        <p className="mt-2 text-slate-600">{message}</p>

        <form action="/prices" method="get" role="search" className="mt-5 flex gap-2 max-w-md">
          <input
            type="search"
            name="q"
            placeholder="Search sealed products…"
            aria-label="Search sealed products"
            className="flex-1 min-h-[42px] px-3.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-[var(--pf-pokeblue)] transition-colors"
          />
          <button
            type="submit"
            className="rounded-lg bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white px-5 text-sm font-semibold transition-colors shadow-sm"
          >
            Search
          </button>
        </form>

        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/prices"
            className="rounded-lg bg-[var(--pf-pokeblue)] hover:bg-[var(--pf-pokeblue-strong)] text-white px-4 py-2 text-sm font-semibold transition-colors shadow-sm"
          >
            Browse all products
          </Link>
          <Link
            href="/market"
            className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 text-sm font-semibold transition-colors"
          >
            Market View
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 text-sm font-semibold transition-colors"
          >
            Home
          </Link>
        </div>
      </section>
    </main>
  );
}
```

9b. New `frontend/app/not-found.tsx` (catches unmatched URLs site-wide and replaces Next's default block, including its injected dark-mode `body{background:#000}` style):

```tsx
import type { Metadata } from "next";
import NotFoundPanel from "./components/NotFoundPanel";

// Next adds <meta name="robots" content="noindex"> to 404 responses itself.
// canonical: null removes the layout's "./" canonical, which on the
// prerendered 404 would otherwise point at https://<host>/_not-found.
export const metadata: Metadata = {
  title: "Page not found",
  alternates: { canonical: null },
};

export default function NotFound() {
  return (
    <NotFoundPanel
      title="We couldn't find that page"
      message="The link may be mistyped or out of date. Search the catalog or pick a page below."
    />
  );
}
```

9c. New `frontend/app/product/[id]/not-found.tsx` (rendered by the two `notFound()` calls in the product page):

```tsx
import type { Metadata } from "next";
import NotFoundPanel from "../../components/NotFoundPanel";
import { PRODUCT_NOT_FOUND_METADATA } from "./productMeta";

// When notFound() is thrown before the response streams, Next builds the
// 404's <head> from the layouts plus this export and skips the page's
// generateMetadata (resolve-metadata.js collectMetadata, errorConvention).
export const metadata: Metadata = PRODUCT_NOT_FOUND_METADATA;

export default function ProductNotFound() {
  return (
    <NotFoundPanel
      title="We don't track that product"
      message="This product is not in the Pokéfin catalog. It may have been removed, or the link may be wrong."
    />
  );
}
```

(The tab title for this case, "Product not found · Pokéfin", comes from `PRODUCT_NOT_FOUND_METADATA` in step 7, through either this export or `generateMetadata`.)

### 10. Product loading skeleton: new `frontend/app/product/[id]/loading.tsx` (F093)

Mirrors the page's breadcrumb, hero (`md:grid-cols-[300px_1fr]`, `h-72` image), three hero tiles, the eight return tiles and the chart card, so the layout does not jump when the page arrives.

```tsx
function Tile() {
  return <div className="h-14 rounded-lg border border-slate-200 bg-white" />;
}

export default function ProductLoading() {
  return (
    <main className="p-3 md:p-6" aria-busy="true">
      <span role="status" className="sr-only">
        Loading product…
      </span>
      <div className="animate-pulse" aria-hidden="true">
        <div className="mb-4 h-4 w-48 rounded bg-slate-200" />

        <div className="grid gap-6 md:grid-cols-[300px_1fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="h-72 w-full rounded-lg bg-slate-200" />
          </div>
          <div className="flex flex-col">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="mt-2 h-8 w-3/4 rounded bg-slate-200" />
            <div className="mt-2 h-4 w-1/2 rounded bg-slate-200" />
            <div className="mt-4 h-10 w-40 rounded bg-slate-200" />
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Tile />
              <Tile />
              <Tile />
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
          <div className="mb-3 h-4 w-32 rounded bg-slate-200" />
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Tile key={i} />
            ))}
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
          <div className="h-64 w-full rounded-lg bg-slate-100" />
        </div>
      </div>
    </main>
  );
}
```

Do not add `app/loading.tsx` (every other route is static or ISR; a root skeleton adds nothing and would wrap every page in a Suspense boundary).

### 11. Login reads `next` without losing its static HTML (F002)

The login page is statically prerendered. A bare `useSearchParams()` in it fails the build ("useSearchParams() should be wrapped in a suspense boundary") or, if the whole form is wrapped in Suspense, removes the form from the static HTML. The design below keeps the form static and puts only two tiny readers under their own `<Suspense fallback={null}>`: one renders a hidden `next` input inside the form, one renders the `?error=auth_link` notice WP02 asked for.

11a. Move the client component: `git mv app/auth/login/page.tsx app/auth/login/LoginForm.tsx` (keeps history and WP02's edits).

11b. In `LoginForm.tsx`:

- Change the `next/navigation` import to `import { useRouter, useSearchParams } from "next/navigation";`.
- Change the React import to also bring in `Suspense`, keeping what WP02 added: `import { Suspense, useRef, useState } from "react";` (if WP02 has not landed: `import { Suspense, useState } from "react";`).
- Add `import { safeReturnToPath } from "../../lib/redirects";`.
- Rename `export default function LoginPage()` to `export default function LoginForm()`.
- Directly above `export default function LoginForm()`, add:

```tsx
// Each reader sits under its own <Suspense fallback={null}>: useSearchParams
// in a statically prerendered page renders only on the client, and wrapping
// just these two keeps the rest of the form in the static HTML.

/** The validated post-login target, carried in the form. */
function NextPathField() {
  const searchParams = useSearchParams();
  return (
    <input
      type="hidden"
      name="next"
      value={safeReturnToPath(searchParams.get("next"))}
    />
  );
}

/** Shown when /auth/callback could not exchange an email link (WP02). */
function AuthLinkNotice() {
  const searchParams = useSearchParams();
  if (searchParams.get("error") !== "auth_link") return null;
  return (
    <div
      role="status"
      className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg mb-4 text-sm"
    >
      That link is invalid or has expired. Sign in with your email and password below.
    </div>
  );
}
```

- Replace `handleSubmit` (`:35-48` before WP02; after WP02 the error branch also resets the Turnstile token, keep those lines exactly) so it reads the target from the form and replaces instead of pushes:

```tsx
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Read before the await: React clears currentTarget afterwards.
    const rawNext = new FormData(e.currentTarget).get("next");
    // Validated again here (the hidden input can be edited in devtools).
    const target = safeReturnToPath(typeof rawNext === "string" ? rawNext : null);
    setError(null);
    setLoading(true);

    const { error } = await signIn(email, password, captchaToken);

    if (error) {
      setError(error.message);
      setLoading(false);
      // Turnstile tokens are single use: a retry needs a fresh one.
      setCaptchaToken(undefined);
      turnstileRef.current?.reset();
    } else {
      // replace, not push: Back after signing in must not return to the form.
      router.replace(target);
    }
  };
```

  (If WP02 has not landed, omit the two Turnstile reset lines.)

- Directly above the error box (`{error && (` at `:60`), insert:

```tsx
          <Suspense fallback={null}>
            <AuthLinkNotice />
          </Suspense>
```

- As the first child of `<form onSubmit={handleSubmit} className="space-y-4">` (`:66`), insert:

```tsx
            <Suspense fallback={null}>
              <NextPathField />
            </Suspense>
```

Everything else in the file (the `PokeballGlyph`, WP02's `autoComplete`, `role="alert"`, Turnstile props) stays.

11c. New `frontend/app/auth/login/page.tsx` (server component, so it can export metadata):

```tsx
import type { Metadata } from "next";
import LoginForm from "./LoginForm";
import { NO_INDEX } from "../../lib/site";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Pokéfin account.",
  robots: NO_INDEX,
};

export default function LoginPage() {
  return <LoginForm />;
}
```

No `<Suspense>` is needed here; the two readers inside `LoginForm` have their own.

### 12. One return-to contract in the client auth gates (F002)

Keep both client-side redirect effects (they still matter when a session ends while the page is open, after the proxy has already let the page render). Only their target changes, so all three gates use `next`.

12a. `frontend/app/portfolio/page.tsx`: add `import { loginPathWithNext } from "../lib/redirects";` and, inside the WP04 effect, replace `router.push("/auth/login?redirect=/portfolio");` with:

```tsx
      router.push(loginPathWithNext("/portfolio"));
```

12b. `frontend/app/account/page.tsx`: add `import { loginPathWithNext } from "../lib/redirects";` and, inside the WP04 effect, replace `router.push("/auth/login");` with:

```tsx
      router.push(loginPathWithNext("/account"));
```

Both produce `/auth/login?next=%2Fportfolio` and `/auth/login?next=%2Faccount`, the same encoding `proxy.ts:79` (`url.searchParams.set("next", path)`) produces. `proxy.ts` needs no change.

### 13. Zero-result empty states (F093)

13a. New `frontend/app/components/NoResults.tsx` (no directive; it is only imported by client components):

```tsx
type NoResultsProps = {
  /** The active search text, trimmed. Empty when only filters are active. */
  query: string;
  onClearFilters: () => void;
};

export default function NoResults({ query, onClearFilters }: NoResultsProps) {
  return (
    <div
      role="status"
      className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center shadow-sm"
    >
      <p className="text-base font-semibold text-slate-900">
        {query ? `No products match “${query}”` : "No products match these filters"}
      </p>
      <p className="mt-1 text-sm text-slate-600">
        Check the spelling, try a shorter search, or clear the filters to see every product.
      </p>
      <button
        type="button"
        onClick={onClearFilters}
        className="mt-4 inline-flex items-center rounded-lg bg-[var(--pf-pokeblue)] hover:bg-[var(--pf-pokeblue-strong)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors"
      >
        Clear filters
      </button>
    </div>
  );
}
```

13b. `frontend/app/components/ProductPrices/index.tsx` (post-WP08 file):

- Add `import NoResults from "../NoResults";` next to the other component imports.
- Add `PRICES_URL_DEFAULTS` to the existing `from "./utils/urlState"` import list.
- Directly after the line `{loading && <div className="text-slate-600">Loading products...</div>}`, insert:

```tsx
        {/* Zero results (F093). Only when the catalog itself is non-empty:
            an empty catalog is an outage, not a search with no matches. */}
        {!loading && products.length > 0 && filteredAndSortedProducts.length === 0 && (
          <NoResults
            query={deferredSearchTerm.trim()}
            onClearFilters={() =>
              updateUrlState({
                gen: PRICES_URL_DEFAULTS.gen,
                type: PRICES_URL_DEFAULTS.type,
                q: PRICES_URL_DEFAULTS.q,
              })
            }
          />
        )}
```

  `updateUrlState` also writes the cleaned URL (debounced), so the reset survives a reload. Sort, view, chart and currency are deliberately kept.

  If WP08 has not landed (no `updateUrlState`), use `query={searchTerm.trim()}` and `onClearFilters={() => { setSelectedGeneration("all"); setSelectedProductType("all"); setSearchTerm(""); }}` instead; the existing URL-sync effect then writes the URL.

13c. `frontend/app/components/MarketView/MarketView.tsx`:

- Add `import NoResults from "../NoResults";` next to `import CardRinkPromo from "../CardRinkPromo";` (`:41`).
- Directly before `return (` of the component (`:633` at review time, just after the `tableBody` `useMemo`), add:

```tsx
  // Zero results (F093): replace the header-only table with a reset panel.
  const showNoResults = !loading && products.length > 0 && rows.length === 0;
```

- Directly after `{loading && <div className="text-slate-600">Loading products...</div>}` (`:689`), insert:

```tsx
        {showNoResults && (
          <NoResults
            query={deferredSearchTerm.trim()}
            onClearFilters={() => {
              setSelectedGeneration("all");
              setSearchTerm("");
              setAgeFilter("all");
            }}
          />
        )}
```

- Change the table guard on the next line from `{!loading && (` to `{!loading && !showNoResults && (`. Nothing else in the table changes.

## Pitfalls: do not do this

- **Do not set `alternates: { canonical: "/" }` in the root layout** (F028 verifier correction). It is inherited by every page that does not set its own `alternates`, and `"/"` resolves to the bare origin (`resolve-url.js:70-85`), so `/prices`, `/market` and every product page would declare themselves duplicates of the home page. Use `"./"`, which resolves per request pathname.
- **Do not hand-write `· Pokéfin` (or the privacy page's dash-plus-"Pokefin" suffix) in any page title** (F028 verifier correction). The template applies to every string title (`resolve-title.js:14-18`); the old product and privacy titles would render "… · Pokéfin · Pokéfin". Titles in child pages are bare.
- **Do not keep the hardcoded `openGraph.url: "https://pokefin.ca"`** (F028 verifier correction). It made every page's `og:url` the apex home page. The layout uses `url: "./"` plus `metadataBase` from `NEXT_PUBLIC_SITE_URL`.
- **Do not hardcode the apex or www host** anywhere new, and do not add a second `NEXT_PUBLIC_SITE_URL` reader or fallback constant. `app/lib/site.ts` gets the origin only from WP02's `getSiteUrl()` and `FALLBACK_SITE_URL` in `app/lib/siteUrl.ts`, so auth-email links and canonical URLs always name the same host. Do not change `getSiteUrl`'s behaviour (the auth routes and their tests depend on it); the only edit to `siteUrl.ts` is the `export` in step 1a.
- **Do not name the new helper `getSiteUrl`.** WP02's `getSiteUrl()` returns a string; the SEO helper that returns a `URL` origin is `getSiteOrigin()`.
- **Do not put `openGraph.title` or `openGraph.description` in the layout.** Next only fills `og:title`/`og:description` from the page when the inherited block lacks them (`resolve-metadata.js:603-611`); setting them in the layout gives every page the home page's preview text.
- **Do not add `themeColor` to `metadata`** (F028 verifier). It goes in the layout's `export const viewport` (step 3); Next warns "Unsupported metadata themeColor" and ignores it inside `metadata`.
- **Do not add `generateStaticParams` returning the 300 product ids** (F028 verifier). It makes `next build` query all of them; the sitemap is the discovery lever. WP11's empty `generateStaticParams` stays as it is.
- **Do not call `useSearchParams()` in the login page body or wrap the whole form in `<Suspense>`** (F002 verifier corrections). The first fails the static prerender of `/auth/login`; the second ships the page with no form in its HTML. Only the two small readers in step 11 are suspended.
- **Do not apply the `/auth/` rejection to the OAuth callback.** The callback keeps `safeNextPath`; WP02 routes recovery through `next=/auth/reset-password`, and `safeReturnToPath` there would send every password-reset link to `/`.
- **Do not change `safeNextPath`'s existing checks** (control characters, `//`, `/\`, decoded variants). Move it verbatim.
- **Do not delete the client-side redirect effects** in `portfolio/page.tsx` and `account/page.tsx` (F002 verifier: they handle a session that ends mid-visit). Only the URL changes. Do not change `proxy.ts`.
- **Do not use `router.push(target)` after sign-in.** Use `router.replace` so Back does not reopen the login form. It is still a client navigation to the validated target.
- **Do not disallow `/auth/` in `robots.txt`.** Blocked pages are never fetched, so their `noindex` is never seen and the URLs can still be indexed from links.
- **Do not publish a price in JSON-LD when `hasCurrentPrice(product)` is false.** Omit `offers` entirely; a stale price must not reappear anywhere.
- **Do not interpolate product data into the JSON-LD script without `serializeJsonLd`.** A name containing `</script>` would otherwise close the tag.
- **Do not export `metadata` from a `"use client"` file.** Next rejects it at build. That is why the client routes get pass-through `layout.tsx` files and the login page is split.
- **Do not use `global-not-found.js`** (experimental flag). `app/not-found.tsx` inside the root layout is the right primitive here.
- **Do not add `app/loading.tsx`** (F093 verifier: every other route is static or ISR, a root skeleton adds nothing).
- **Do not remove `product/[id]/loading.tsx` because a bad product URL returns HTTP 200.** If the product route is still dynamic (WP11 not landed), a streamed 404 has status 200 plus `<meta name="robots" content="noindex">`, which Next documents as not indexed (`loading.md`, "Status Codes"). With WP11's ISR the status is 404.
- **Do not add `prefetch` props to product links in this PR.** The F093 verifier notes that a `loading.tsx` enables partial prefetch of dynamic routes, so every product card or mover link that scrolls into view on `/` and `/prices` may issue one server prefetch per product id (not rate-limited, so no lockout, but extra function invocations). Prefetch tuning is out of scope. Put this sentence in the PR body so the owner can watch function invocations after deploy: "product/[id]/loading.tsx makes visible product links prefetch up to the loading boundary; if Vercel function invocations for /product/* rise noticeably, add prefetch={false} to the product card and mover Links in a follow-up."
- **Do not leave the layout's `"./"` canonical on error pages.** Both `not-found.tsx` metadata exports set `alternates: { canonical: null }`; without it the prerendered 404 declares `https://<host>/_not-found` canonical.
- **Do not touch `ProductImage.tsx`'s "Loading..." text** (F093 member recommendation). WP12 owns that component and its tests assert the placeholder text for non-priority images; changing it breaks WP12's `ProductImage` tests.
- **Do not change the "Found {n} products" copy or add pluralisation** (copy is WP15). WP08's tests assert "Found 2 products".
- **Do not delete `app/stats/page.tsx`.** `app/analytics/page.tsx` re-exports it; `/stats` only redirects.

## Tests

All paths are under `frontend/`. Jest runs jsdom by default; none of these import `next/server`, so no `@jest-environment node` docblock is needed. Jest treats path arguments as regular expressions, so select files under `app/product/[id]` by name (`productMeta`), not by path.

### 1. New `app/lib/__tests__/redirects.test.ts`

Cases for `safeNextPath` (behaviour must be identical to the old callback function):
- `null`, `undefined`, `""` return `"/"`.
- `"/portfolio"` returns `"/portfolio"`; `"/prices?q=elite%20trainer"` is returned unchanged.
- `"//evil.com"`, `"/\\evil.com"`, `"%2F%2Fevil.com"`, `"/%2F%2Fevil.com"`, `"/%5Cevil.com"`, `"https://evil.com"`, `"javascript:alert(1)"`, `"evil.com"` return `"/"`.
- Malformed escape `"/%E0%A4%A"` returns `"/"`.
- Control characters: `"/\r\n//evil.com"` returns `"/"` (stripping makes it `"///evil.com"`); `"/port\r\nfolio"` returns `"/portfolio"`; `"/\t/evil.com"` returns `"/"`.
- `"/auth/reset-password"` returns `"/auth/reset-password"` (the callback depends on this).

Cases for `safeReturnToPath`:
- Everything `safeNextPath` rejects is rejected.
- `"/auth/login"`, `"/auth/signup?x=1"`, `"/auth"`, `"/%61uth/login"`, `"/AUTH/login"`, `"/api/account/export"`, `"/portfolio/../auth/login"`, `"/portfolio/%2e%2e/auth/login"` return `"/"`.
- `"/portfolio?tab=lots#top"` is returned unchanged (query and hash are kept).
- `"/authors"` and `"/apiary"` are returned unchanged (prefix match is per segment).
- `"/portfolio"` returns `"/portfolio"`.

Cases for `loginPathWithNext`:
- `"/portfolio"` gives `"/auth/login?next=%2Fportfolio"`; `"/account"` gives `"/auth/login?next=%2Faccount"`.
- `"/"`, `"//evil.com"`, `"/auth/signup"` give `"/auth/login"`.
- Round trip: `new URLSearchParams(loginPathWithNext("/portfolio").split("?")[1]).get("next")` equals `"/portfolio"`.

### 2. New `app/lib/__tests__/site.test.ts`

Save `process.env.NEXT_PUBLIC_SITE_URL` in `beforeAll` and restore it in `afterEach` (delete the key when it was undefined; `next/jest` may have loaded a local `.env.local`). Compare `getSiteOrigin().origin` (a `URL`'s `toString()` ends in `/`). Cases:
- `"https://pokefin.ca/"` gives `"https://pokefin.ca"`; `"https://www.pokefin.ca/some/path"` gives `"https://www.pokefin.ca"` (the path is dropped).
- Unset, `""` and `"not a url"` give the WP02 fallback `"https://pokefin.ca"`; so does `"https://exa mple.com"` (passes WP02's regex, rejected by `URL()`).
- `"http://localhost:3000"` gives `"http://localhost:3000"`.
- `absoluteUrl("/")` is the origin with no trailing slash; `absoluteUrl("/product/42")` is `"<origin>/product/42"`.
- `NO_INDEX` equals `{ index: false, follow: true }`.

Do not add cases for `getSiteUrl` itself; WP02's tests own it.

### 3. New `app/__tests__/robots.test.ts`

Save and restore `VERCEL_ENV` and `NEXT_PUBLIC_SITE_URL`; set the site URL to `https://pokefin.ca`. Cases:
- `VERCEL_ENV` unset and `"production"`: `rules` allows `"/"`, disallows exactly `["/api/", "/account", "/portfolio"]`, and `sitemap` is `"https://pokefin.ca/sitemap.xml"`.
- `VERCEL_ENV = "preview"`: `{ rules: { userAgent: "*", disallow: "/" } }` and no `sitemap`.
- In no case does the disallow list contain an `/auth` entry.

### 4. New `app/__tests__/sitemap.test.ts`

```ts
jest.mock("../lib/serverMarketData", () => ({
  getCachedMarketProductSummaries: jest.fn(),
}));

import sitemap from "../sitemap";
import { getCachedMarketProductSummaries } from "../lib/serverMarketData";
import type { Product } from "../components/ProductPrices/types";

const mockSummaries = getCachedMarketProductSummaries as unknown as jest.Mock;

function product(overrides: Partial<Product>): Product {
  return {
    id: 1,
    usd_price: 10,
    url: "https://www.tcgplayer.com/product/1",
    last_updated: "2026-09-20T04:00:00",
    ...overrides,
  } as Product;
}

const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://pokefin.ca";
  mockSummaries.mockReset();
});

afterAll(() => {
  if (ORIGINAL_SITE_URL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE_URL;
});

it("lists the public pages and every product, nothing private", async () => {
  mockSummaries.mockResolvedValue([
    product({ id: 42, price_recorded_at: "2026-09-20T04:00:00" }),
    product({ id: 7, last_updated: "not a date", price_recorded_at: null }),
  ]);
  const urls = (await sitemap()).map((entry) => entry.url);
  expect(urls).toEqual(
    expect.arrayContaining([
      "https://pokefin.ca",
      "https://pokefin.ca/prices",
      "https://pokefin.ca/market",
      "https://pokefin.ca/analytics",
      "https://pokefin.ca/product/42",
      "https://pokefin.ca/product/7",
    ])
  );
  for (const hidden of ["/stats", "/portfolio", "/account", "/auth/"]) {
    expect(urls.some((url) => url.includes(hidden))).toBe(false);
  }
});
```

Further cases: the entry for product 42 has `lastModified` instanceof `Date`; the entry for product 7 has `lastModified` undefined; a product with `id: 0` or `id: 1.5` is skipped; `mockSummaries.mockRejectedValue(new Error("rpc down"))` makes `sitemap()` reject (no silent product-less sitemap).

### 5. New `app/product/[id]/__tests__/productMeta.test.ts`

- `parseProductId`: `"42"` gives `42`; `"042"`, `"4.2"`, `"4.2e1"`, `"1e3"`, `"0x2a"`, `" 42"`, `"42 "`, `"-1"`, `"0"`, `""`, `"abc"`, `"12345678901234567"` (17 digits) give `null`.
- `buildProductMetadata` for `{ id: 42, sets: { name: "Prismatic Evolutions", ... }, product_types: { label: "Elite Trainer Box", ... }, variant: "Pokemon Center", image_url: "https://x.supabase.co/storage/v1/object/public/products/42.png" }`: `title` is `"Prismatic Evolutions Elite Trainer Box (Pokemon Center)"` and contains no `"Pokéfin"`; `alternates.canonical` is `"/product/42"`; `openGraph.url` is `"/product/42"`; `openGraph.images` is `[{ url: <image_url>, alt: <title> }]`; `twitter.card` is `"summary"`. With `image_url: null` the `openGraph` object has no `images` key.
- `PRODUCT_NOT_FOUND_METADATA`: `title` is `"Product not found"`, `robots` equals `NO_INDEX`, `alternates.canonical` is `null`.
- `buildProductJsonLd`: with `usd_price: 59.99` (and `NEXT_PUBLIC_SITE_URL` set to `https://pokefin.ca`, saved and restored as in test 2) the result has `"@type": "Product"`, `url: "https://pokefin.ca/product/42"`, `offers: { "@type": "Offer", price: "59.99", priceCurrency: "USD", url: "https://pokefin.ca/product/42" }`; with `usd_price: null` there is no `offers` key; `image` is an array when `image_url` is set and absent otherwise.
- `serializeJsonLd`: for a product whose set name is `"</script><script>alert(1)</script>"`, the output contains no `"<"` character and `JSON.parse(output).name` equals the original display name.

Access nested Metadata fields through narrow casts, for example `(meta.openGraph as { images?: unknown }).images`.

### 6. New `app/auth/login/__tests__/LoginForm.test.tsx`

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockSignIn = jest.fn();
let mockSearch = "";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ signIn: mockSignIn }),
}));

// Issues a token on mount so the submit button enables. A plain function
// component is enough: in React 19 `ref` is an ordinary prop, so WP02's
// ref={turnstileRef} is accepted and simply stays unset (the component calls
// turnstileRef.current?.reset(), which is then a no-op).
jest.mock("@marsidev/react-turnstile", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  function MockTurnstile({ onSuccess }: { onSuccess?: (token: string) => void }) {
    React.useEffect(() => {
      onSuccess?.("test-token");
    }, [onSuccess]);
    return null;
  }
  return { Turnstile: MockTurnstile };
});

import LoginForm from "../LoginForm";

async function signInWith(search: string) {
  mockSearch = search;
  render(<LoginForm />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ash@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pikachu-pikachu" } });
  const button = screen.getByRole("button", { name: "Sign In" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

beforeEach(() => {
  mockReplace.mockReset();
  mockPush.mockReset();
  mockSignIn.mockReset().mockResolvedValue({ error: null });
});

it.each([
  ["?next=%2Fportfolio", "/portfolio"],
  ["?next=/account", "/account"],
  ["", "/"],
  ["?next=%2F%2Fevil.com", "/"],
  ["?next=https%3A%2F%2Fevil.com", "/"],
  ["?next=%2Fauth%2Flogin", "/"],
  ["?redirect=%2Fportfolio", "/"],
])("after sign-in with %s it replaces to %s", async (search, expected) => {
  await signInWith(search);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(expected));
  expect(mockPush).not.toHaveBeenCalled();
});
```

More cases in the same file:
- `mockSignIn` resolving `{ error: { message: "Invalid login credentials" } }`: the message is shown and `mockReplace` is never called.
- `mockSearch = "?error=auth_link"`: the text "That link is invalid or has expired" is visible before any interaction; with `mockSearch = ""` it is absent.
- The hidden input: `container.querySelector('input[type="hidden"][name="next"]')` has value `"/portfolio"` for `?next=%2Fportfolio` and `"/"` for `?next=%2F%2Fevil.com`.

### 7. New `app/components/__tests__/NoResults.test.tsx` and `app/components/__tests__/NotFoundPanel.test.tsx`

`NoResults`: with `query="zzz"` the text `No products match “zzz”` is shown; with `query=""` the text "No products match these filters" is shown; clicking "Clear filters" calls the handler once; the root has `role="status"`.

`NotFoundPanel` (mock `next/link` as in test 6): the `h1` shows the given title; the form has `action="/prices"` and `method="get"` and contains `input[name="q"]`; links point to `/prices`, `/market` and `/`.

### 8. `/prices` empty state

If `app/components/ProductPrices/__tests__/ProductPrices.urlSync.test.tsx` exists (WP08), add one case to it using its existing mocks and render helper; otherwise create `app/components/ProductPrices/__tests__/ProductPrices.emptyState.test.tsx` by copying that file's mock block (ProductCard stub, `next/navigation` mock, `window.history.replaceState(null, "", "/prices")` in `beforeEach`). The case: render with two products; `fireEvent.change(screen.getByPlaceholderText("Search by name or variant..."), { target: { value: "zzzz" } })`; `await screen.findByText("No products match “zzzz”")`; click "Clear filters"; both stub cards are rendered again, the search input's value is `""`, and "No products match" is gone. A second case: `initialProducts={[]}` never shows the panel (with an empty list `useProductData` fetches on the client, so the file must mock `../../../lib/clientMarketData` with `fetchMarketProductsClient: jest.fn().mockResolvedValue([])`; add that mock if the copied block lacks it, and assert with `await waitFor(() => expect(screen.queryByText(/No products match/)).toBeNull())`).

### 9. New `app/components/MarketView/__tests__/MarketView.emptyState.test.tsx`

Mock the modules that would fetch or need browser APIs:

```ts
jest.mock("../../../lib/clientMarketData", () => ({
  fetchMarketProductsClient: jest.fn().mockResolvedValue([]),
  fetchProductHistoryClient: jest.fn().mockResolvedValue({}),
  fetchVolumeMetrics: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../../lib/exchangeRate", () => ({
  fetchLatestExchangeRateClient: jest.fn().mockResolvedValue({ rate: 1.36, date: null }),
}));
jest.mock("../MiniSparkline", () => ({ __esModule: true, default: () => null }));
jest.mock("../../ProductPrices/shared/ProductImage", () => ({ __esModule: true, default: () => null }));
jest.mock("../../CardRinkPromo", () => ({ __esModule: true, default: () => null }));
```

If `grep -n "^import" app/components/MarketView/MarketView.tsx` or the hooks it uses show another module that reads Supabase or `IntersectionObserver` at render (WP09 and WP12 may have added one), mock it the same way. Render `<MarketView initialProducts={[a, b]} initialExchangeRate={1.36} initialVolumeMetrics={{}} />` with two products built like `useProductData.test.tsx`'s `makeProduct`. Cases: the table is present (`screen.getByRole("table")`); after typing `"zzzz"` into the search input, `await screen.findByText("No products match “zzzz”")` and `screen.queryByRole("table")` is null; clicking "Clear filters" brings the table back with the search input empty. If this file cannot be made to render in jsdom within about 30 minutes, keep tests 7 and 8, cover `/market` with the manual check in Verification, and say so in the PR.

### 10. Auth gate targets

- New `app/portfolio/__tests__/page.redirect.test.tsx`: mock `next/navigation` (`useRouter: () => ({ push: mockPush })`), `../../context/AuthContext` (`useAuth: () => mockAuth`), `../../components/Portfolio/PortfolioDashboard` (`{ __esModule: true, default: () => null }`) and `../../lib/exchangeRate` (as in test 9); mock any other data module the page imports after WP05 (run `grep -n "^import" app/portfolio/page.tsx` and mock every `../lib/*` or `../components/*` module except `SessionUnavailable`). `mockAuth` always carries `refreshSession: jest.fn()` (WP04 destructures it). Cases: `sessionStatus: "anonymous", user: null, loading: false` calls `mockPush` exactly once with `"/auth/login?next=%2Fportfolio"`; `sessionStatus: "unknown", user: null, loading: true` never calls `mockPush`; `sessionStatus: "unknown", user: null, loading: false` (network error) never calls `mockPush`.
- Update WP04's `app/account/__tests__/page.test.tsx`: the case "`sessionStatus: "anonymous"`, user: null" now expects `mockPush` with `"/auth/login?next=%2Faccount"`. If WP04's file does not exist, add that single case in a new `app/account/__tests__/page.redirect.test.tsx` with the same mocks as WP04 describes.

### Existing tests that must pass unchanged

`app/lib/__tests__/validation.test.ts`, `rateLimit.test.ts`, WP02's callback/route tests (they import the route, which now imports `safeNextPath` from `app/lib/redirects.ts`; behaviour is identical), WP04's `AuthContext` and `Header` tests, WP08's `ProductPrices.urlSync.test.tsx` and `urlState.test.ts`.

## Verification

Run from `frontend/`:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
# expect: exit 0, no output

pnpm exec eslint app/layout.tsx "app/product/[id]" app/auth app/portfolio app/account \
  app/prices/page.tsx app/market/page.tsx app/analytics/page.tsx app/box-calculator/page.tsx \
  app/compare app/privacy/page.tsx app/components/ProductPrices/index.tsx \
  app/components/MarketView/MarketView.tsx app/components/NoResults.tsx \
  app/components/NotFoundPanel.tsx app/not-found.tsx app/robots.ts app/sitemap.ts \
  app/opengraph-image.tsx app/lib/site.ts app/lib/siteUrl.ts app/lib/redirects.ts app/__tests__ \
  app/lib/__tests__/redirects.test.ts app/lib/__tests__/site.test.ts app/components/__tests__ \
  app/components/ProductPrices/__tests__ app/components/MarketView/__tests__ 2>&1 | tail -3
# expect: no more problems than the baseline you recorded, and none (errors or warnings) in the new files

pnpm test --ci app/lib/__tests__/redirects.test.ts app/lib/__tests__/site.test.ts \
  app/__tests__ productMeta app/auth/login app/components/__tests__ \
  app/components/ProductPrices/__tests__ app/components/MarketView/__tests__ \
  app/portfolio app/account
# expect: all pass

pnpm test --ci
# expect: whole suite green; count = previous count + the new tests

grep -rn 'redirect=' app --include=*.ts --include=*.tsx | grep -v __tests__
# expect: no output
grep -rn 'function safeNextPath' app
# expect: app/lib/redirects.ts only
grep -rn '· Pokéfin"\|Pokefin",' app --include=*.tsx | grep -v __tests__
# expect: no output (no hand-written title suffixes)
grep -rn '"https://pokefin.ca"\|"https://www.pokefin.ca"' app --include=*.tsx
# expect: no output (layout no longer hardcodes a host; csrf/export/delete are .ts and unchanged)
grep -rn 'NEXT_PUBLIC_SITE_URL' app --include=*.ts --include=*.tsx | grep -v __tests__
# expect: exactly the lines the same grep printed before your first edit (run it then and keep
# the output; after WP02 that is siteUrl.ts, csrf.ts and the account export and delete routes).
# app/lib/site.ts and app/layout.tsx must NOT appear (they read the origin through getSiteUrl)
```

Stub build (WP00 harness; it sets `NEXT_PUBLIC_SITE_URL=http://localhost:3000`):

```bash
pnpm build:stub
# expect exit 0. In the route table: ○ /auth/login (static, NOT dynamic),
# ○ /robots.txt, ○ /sitemap.xml, ○ /opengraph-image, ○ /icon.png, ○ /apple-icon.png,
# /product/[id] as before (ISR if WP11 landed).

grep -o '<title>[^<]*</title>' .next/server/app/prices.html .next/server/app/market.html \
  .next/server/app/analytics.html .next/server/app/index.html .next/server/app/_not-found.html \
  .next/server/app/auth/login.html
# expect: "Sealed Product Prices · Pokéfin", "Market View · Pokéfin", "Set Analytics · Pokéfin",
#         "Pokéfin: Pokémon Sealed Product Price Tracker", "Page not found · Pokéfin", "Sign in · Pokéfin"

grep -o '<link rel="canonical" href="[^"]*"' .next/server/app/prices.html .next/server/app/index.html .next/server/app/analytics.html
# expect: http://localhost:3000/prices, http://localhost:3000, http://localhost:3000/analytics
grep -o 'property="og:url" content="[^"]*"' .next/server/app/market.html
# expect: http://localhost:3000/market
grep -c 'property="og:image"' .next/server/app/prices.html
# expect: 1 or more (the opengraph-image route)

grep -c 'id="email"' .next/server/app/auth/login.html
# expect: 1 (the form is in the static HTML)
grep -c 'noindex' .next/server/app/auth/login.html
# expect: 1 or more
grep -c 'name="theme-color" content="#ffffff"' .next/server/app/index.html
# expect: 1
grep -c 'next-error-h1' .next/server/app/_not-found.html
# expect: 0 (Next's stock 404 block is gone)
grep -c 'find that page' .next/server/app/_not-found.html
# expect: 1 or more
grep -c 'rel="canonical"' .next/server/app/_not-found.html
# expect: 0 (canonical: null on the 404)
grep -o '<link rel="apple-touch-icon"[^>]*>\|<link rel="icon"[^>]*>' .next/server/app/index.html
# expect: the favicon.ico link, an /icon.png link and an /apple-icon.png link

find .next/server/app -maxdepth 1 \( -name 'robots.txt*' -o -name 'sitemap.xml*' \)
cat .next/server/app/robots.txt.body
# expect: "Disallow: /api/", "/account", "/portfolio", no "/auth", and "Sitemap: http://localhost:3000/sitemap.xml"
cat .next/server/app/sitemap.xml.body
# expect: <loc> entries for /, /prices, /market, /analytics, /box-calculator, /compare, /privacy; no /stats

SUPABASE_STUB_FIXTURE=catalog pnpm build:stub
grep -o '<loc>[^<]*product[^<]*</loc>' .next/server/app/sitemap.xml.body
# expect: http://localhost:3000/product/900001 and http://localhost:3000/product/900002
# (if WP08's fixture flag does not exist, skip this check and say so in the PR)
```

If a file name differs (Next can change the `.body` suffix), locate it with the `find` command above.

Manual checks with a server (static checks first, using the stub build output):

```bash
pnpm start &      # serves the stub build on :3000; static pages only
curl -sI http://localhost:3000/stats | grep -iE '^HTTP|^location'
# expect: HTTP/1.1 308 and location: /analytics
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/definitely-not-a-page
# expect: 404
curl -s http://localhost:3000/opengraph-image -o /tmp/og.png && file /tmp/og.png
# expect: PNG image data, 1200 x 630
kill %1
```

Dynamic checks in the browser. Terminal 1: `cd frontend && SUPABASE_STUB_FIXTURE=catalog node scripts/supabase-stub.mjs`. Terminal 2: `cd frontend && NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_KEY=stub-anon-key NEXT_PUBLIC_SITE_URL=http://localhost:3000 pnpm dev`. Then:

1. `http://localhost:3000/product/900001`: renders. View source: `<title>Stubfixture Alpha Booster Box · Pokéfin</title>`, `<link rel="canonical" href="http://localhost:3000/product/900001"/>`, and a `<script type="application/ld+json">` whose JSON has `"@type":"Product"` and `"offers":{"@type":"Offer","price":"123.45","priceCurrency":"USD","url":"http://localhost:3000/product/900001"}`.
2. `/product/999999`, `/product/abc`, `/product/0900001` and `/product/0x10`: each shows "We don't track that product" with the search form and the three links, inside the normal header and footer, with a light background even with the OS in dark mode. Tab title "Product not found · Pokéfin".
3. `/nope`: shows "We couldn't find that page"; submitting "booster" in its search box lands on `/prices?q=booster` with the filter applied.
4. Product skeleton: DevTools Network "Slow 4G", go to `/prices`, click a product card. The pulse skeleton (image block, title bars, tiles) appears immediately, then the product page replaces it.
5. `/prices`: type "zzzz" in the search box. The "No products match “zzzz”" panel appears and no cards remain. Click "Clear filters": all cards return, the box is empty, and after about 250 ms the address bar has no `q=`.
6. `/market`: type "zzzz"; the table disappears and the panel shows; pick an age filter first to confirm "Clear filters" also resets it; after clearing, the table returns.
7. Sign-in return-to needs real Supabase auth. If you have real credentials in `.env.local`: signed out, open `/portfolio`; the URL becomes `/auth/login?next=%2Fportfolio`; sign in; you land on `/portfolio`, and Back does not show the login form. Open `/auth/login?next=https://example.com`, sign in: you land on `/`. Without credentials, rely on test 6 and say so in the PR.

## Owner actions

1. **Confirm the canonical host (same host as WP02 owner action 4).** Run `curl -sI https://pokefin.ca/ | grep -iE '^HTTP|^location'` and `curl -sI https://www.pokefin.ca/ | grep -iE '^HTTP|^location'`. Expected, after WP02 owner action 4: the apex answers `200` and `www` answers `307`/`308` with `location: https://pokefin.ca/`. In Vercel, Project, Settings, Environment Variables, check that `NEXT_PUBLIC_SITE_URL` for **Production** is exactly `https://pokefin.ca` (no trailing slash). If `www` serves `200` and the apex redirects instead, do not change the variable alone: auth emails (WP02) and canonical URLs both follow it, so fix the redirect direction in Vercel, Domains (apex primary, `www` redirecting to it) as WP02 owner action 4 describes. Redeploy production after any change to the variable (`NEXT_PUBLIC_*` values are inlined at build). Confirm: view source of `https://pokefin.ca/prices` shows `<link rel="canonical" href="https://pokefin.ca/prices"/>` and `<meta property="og:url" content="https://pokefin.ca/prices"/>`.
2. **Submit the sitemap** (recommended). In Google Search Console, add or open the property for the canonical host, go to Sitemaps and submit `https://<host>/sitemap.xml`. Confirm: status "Success" and a discovered URL count of about 300 plus 7.
3. **Spot-check previews after deploy.** Paste the URL of a production product whose page shows a current price into the Rich Results Test (search.google.com/test/rich-results): a "Product snippets" item is detected with no errors (warnings about missing reviews, ratings or availability are expected). A product whose price is withheld has no `offers`, so the test reports it as not eligible; that is intended. Paste the same URL into a Discord or Slack message: the card shows the product name and photo. Paste `https://<host>/prices`: the card shows "Sealed Product Prices · Pokéfin" and the Pokéfin share image.
4. **Preview deployments.** Open `https://<any-preview-url>/robots.txt`: it must say `Disallow: /`. If it shows the production rules, `VERCEL_ENV` was not visible at build time; tell the developer (no code change is expected).

## Acceptance criteria

- [ ] `/prices`, `/market`, `/analytics`, `/compare`, `/box-calculator`, `/portfolio`, `/account`, `/privacy` and the four `/auth/*` pages each have a distinct `<title>` ending in ` · Pokéfin`; the home page title is "Pokéfin: Pokémon Sealed Product Price Tracker"; no title contains "· Pokéfin · Pokéfin".
- [ ] Every indexable page has `<link rel="canonical">` pointing to its own path on the configured origin; no non-home page canonicalises to the home page.
- [ ] `og:url` matches each page's own path; `og:image` is the Pokéfin share image on every non-product page and the product photo on every product page that has one.
- [ ] `/portfolio`, `/account` and `/auth/*` pages carry `noindex`.
- [ ] `/robots.txt` disallows `/api/`, `/account`, `/portfolio`, does not disallow `/auth`, and links the sitemap; on preview deployments it disallows everything.
- [ ] `/sitemap.xml` lists the 7 public routes and one URL per product, and no `/stats`, `/portfolio`, `/account` or `/auth` URL.
- [ ] `/stats` answers `308` to `/analytics`.
- [ ] Product pages contain one Product JSON-LD block; `offers` appears only when the page shows a current price; the block contains no raw `<`.
- [ ] `/product/abc`, `/product/042`, `/product/0x10` and an unknown numeric id show the branded "We don't track that product" page; unmatched URLs show "We couldn't find that page"; neither contains `next-error-h1` or a `rel="canonical"` link, and both keep the light background in OS dark mode.
- [ ] Every page's `<head>` has `/icon.png` and `/apple-icon.png` links next to the existing `/favicon.ico`.
- [ ] `app/lib/site.ts` reads the origin only through WP02's `getSiteUrl()`; no new file reads `NEXT_PUBLIC_SITE_URL` directly and no new file hardcodes a `pokefin.ca` host.
- [ ] Clicking a product card shows the skeleton immediately.
- [ ] A zero-result search on `/prices` and on `/market` shows the "No products match" panel, and "Clear filters" restores the full list.
- [ ] `/auth/login` is still static (`○` in the build table) and its static HTML contains the form.
- [ ] After signing in from `/auth/login?next=%2Fportfolio` the user lands on `/portfolio` via `router.replace`; `next` values that are external, protocol-relative, encoded, or under `/auth/` or `/api/` land on `/`.
- [ ] `/auth/login?error=auth_link` shows the "link is invalid or has expired" notice.
- [ ] `grep -rn 'redirect=' app` (excluding tests) finds nothing; `safeNextPath` exists only in `app/lib/redirects.ts`; the callback's password-recovery routing is unchanged.
- [ ] `tsc`, the full Jest suite and `pnpm build:stub` pass; no new lint errors in touched files.

## Rollback

No migrations and no data changes. Revert the merge commit (`git revert -m 1 <merge-sha>`) and redeploy. Side effects that outlive the revert, all harmless: browsers that followed the permanent `/stats` to `/analytics` redirect keep doing so (same content); a submitted sitemap in Search Console starts returning 404 and Google drops it; the Vercel `NEXT_PUBLIC_SITE_URL` value set in Owner actions stays correct for the auth and CSRF code that already used it. If only one part misbehaves (for example the canonical host is wrong), prefer fixing `NEXT_PUBLIC_SITE_URL` and redeploying over reverting.

## Commit and PR

Commit message:

```
feat(seo): per-page metadata, sitemap, branded 404, login return-to

- Root metadata: metadataBase from getSiteUrl() (WP02's siteUrl.ts),
  title template, per-page canonical ("./"), og:url per page, share
  image, icon.png and apple-icon.png (F028)
- Per-route titles and descriptions; noindex on auth, account, portfolio;
  /stats redirects to /analytics (F028)
- Product pages: strict id parsing, canonical, product photo as og:image,
  Product JSON-LD without stale prices (F028, F093)
- robots.txt and a daily sitemap of every product (F028)
- Branded not-found pages, product loading skeleton, zero-result panels
  on /prices and /market (F093)
- safeNextPath moved to app/lib/redirects.ts with tests; login honours
  ?next= via Suspense-wrapped readers, auth gates standardised on next
  (F002)
```

PR title: `WP13: SEO metadata, 404 and loading states, login return-to`

PR body summary: list F028, F093 and F002 with one line each as in the metadata block above, and state what F093 items were intentionally left to other packages (toast: WP03; `/prices` Suspense fallback: WP08; `ProductImage` "Loading..." text: WP12). Paste the Verification output (tsc, lint counts before and after, Jest summary, the `pnpm build:stub` route table lines for `/auth/login`, `/robots.txt`, `/sitemap.xml`, `/opengraph-image`, and the grep results). List the four Owner actions. Note whether the sign-in return-to was checked manually or by unit tests only, and whether the `/market` empty state is covered by test 9 or only by the manual check. Include the prefetch sentence from Pitfalls verbatim. State that `app/lib/siteUrl.ts` changed only by exporting `FALLBACK_SITE_URL`, and that WP17's coverage list must treat `app/auth/login/page.tsx` and `app/analytics/page.tsx` as server pages.
