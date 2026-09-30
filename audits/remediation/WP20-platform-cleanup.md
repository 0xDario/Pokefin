# WP20: Types, currency context, CSRF dedupe, docs

- **Findings covered**
  - F034 (full; cluster members F034, F041, F046): the CSRF/origin gate, the body-size cap and the cookie-backed Supabase client are re-implemented inline in `api/account/delete`, `api/account/export` and `auth/callback` instead of using `lib/csrf.ts` and `lib/routeSupabase.ts`, and the copies have already drifted.
  - F047 (full; cluster members F038, F047): every Supabase client is untyped (no generated `Database` types), so row boundaries are held together with `as unknown as` and `any`, and `no-explicit-any` is switched off.
  - F048 (full): `app/lib` imports its domain types from `components/*/types` (six lib modules); `"use client"` sits on two plain lib modules; `serverSupabase.ts`, three exported interfaces and `PriceChart`'s duplicate types are dead or duplicated.
  - F051 (full; cluster members F051, F105): currency and exchange rate are prop-drilled with a literal `1.36` default in 12 places (`1.35` in `/compare`), `/portfolio` has its own toggle, and the chosen currency does not carry between pages.
  - F107 (full; cluster members F107, F109): `.github/copilot-instructions.md` describes an architecture that no longer exists, and dead modules/exports remain (`ExchangeRateService.ts`, `fetchSalesHistory` and its cache, the `Portfolio/index.ts` barrel, `searchProductsBySet`, `formatScore`).
- **Priority rationale**: no user-facing defect except currency persistence, so it runs last, after every package that edits these files has landed, and it prevents the next column rename or CSRF fix from silently missing half the code.
- **Effort**: L, about 15 hours (F034 2 h, F048 2.5 h, F051 4 h, F047 4 h plus the wait for the owner's generated types file, F107 1.5 h, tests and verification 1 h).
- **Depends on**: WP05 (`app/lib/server/portfolioRepo.ts`, `app/lib/portfolioApi.ts`, the portfolio route handlers), WP06 (`app/lib/boxRecipes.ts`, `app/lib/routeAuth.ts`, box-recipe routes, `useBoxRecipes` rewrite), WP11 (`getCachedExchangeRate` never throws and returns `date: null` for the fallback; `/compare` and `/box-calculator` are server-fed). Also assumes every package before it in plan order has merged, in particular WP00 (`pnpm build:stub`), WP02 (callback route collects cookies and headers), WP07 (`app/lib/format.ts`), WP08 (`/prices` URL state), WP12 (`app/lib/supabaseLoader.ts`), WP13 (`app/lib/redirects.ts`), WP17 (blocking lint, `logger.ts` helpers, delete-route and proxy tests, `useCurrencyConversion` test), WP18 (`app/lib/marketMath.ts`, `app/compare/CompareDashboard.tsx`).
- **Unblocks**: nothing in the plan depends on it. WP21 (and every later migration PR) should regenerate `frontend/app/types/database.ts` with the `pnpm types:db` script this package adds.
- **Suggested branch name**: `remediation/wp20-types-currency-csrf-docs`
- **Risk level**: medium. It touches the root layout (every page renders the new `CurrencyProvider`), the session-cookie code in `proxy.ts` and the OAuth callback, and the type of every Supabase query; the behaviour of each is pinned by existing and new tests.

## Why

The account delete and export endpoints and the email-link callback each carry their own copy of the CSRF gate and of the cookie-writing Supabase client, so the next hardening fix in `lib/csrf.ts` or `lib/routeSupabase.ts` silently skips the two most destructive endpoints. No Supabase client knows the database schema, so a column rename or a nullability change compiles, passes tests and shows up only as blank or wrong prices on the live site. The currency a visitor picks on `/prices` is forgotten on `/market` and `/portfolio` (which defaults to USD while every other page defaults to CAD), and 13 files each hard-code their own fallback rate, one of them different. The contributor instructions point at a Supabase pattern, a line range and a barrel convention that no longer exist, and several dead modules suggest a fourth way to build a client. After this PR there is one CSRF gate, three server client factories, one generated schema type that the compiler checks every query against, one currency preference that follows the visitor across pages, one fallback rate, and documentation that matches the code.

## Before you start

Read these files in full (paths relative to `frontend/` unless they start with `/` or `.github`):

- `app/api/account/delete/route.ts` (80 lines at `a188fea`; WP17 changed only line 70 to `logSupabaseError`), `app/api/account/export/route.ts` (79 lines), `app/api/auth/sign-in/route.ts` (the pattern to copy), `app/lib/csrf.ts` (61 lines at `a188fea`; WP05 appended `rejectIfNotAppRequest`), `app/lib/routeSupabase.ts` (38 lines), `app/lib/cookieOptions.ts`, `app/auth/callback/route.ts` (as rewritten by WP02 step 10 and WP13 step 2b: collects `pendingCookies`/`pendingHeaders`, then writes them onto the chosen redirect), `proxy.ts` (101 lines at `a188fea`; WP02 changed the rate-limit block only).
- `app/lib/supabase.ts`, `app/lib/supabaseLoader.ts` (WP12), `app/lib/serverSupabase.ts`, `app/lib/serverMarketData.ts` (client factory at `:42-49` at `a188fea`), `app/lib/clientMarketData.ts`, `app/lib/marketData.ts`, `app/lib/exchangeRate.ts`, `app/lib/portfolio.ts`, `app/lib/server/portfolioRepo.ts` (WP05), `app/lib/boxRecipes.ts` and `app/lib/routeAuth.ts` (WP06), `app/components/BoxCalculator/sharedRecipe.ts` (WP06).
- `app/components/ProductPrices/types/index.ts` (106 lines at `a188fea`, plus WP11's `VolumeMetricsSummary`), `app/components/Portfolio/types/index.ts` (192 lines at `a188fea`, plus WP05's `NewHoldingInput`), `app/components/PriceChart.tsx` (`:18-25` local `PriceHistoryEntry` and `Currency`), `app/components/ProductPrices/shared/ReturnMetrics.tsx:27` (a local `ReturnData` with a different shape from the exported one).
- `app/layout.tsx`, `app/context/AuthContext.tsx` (provider pattern), `app/components/ProductPrices/hooks/useCurrencyConversion.ts` (as rewritten by WP07 step 6a and WP17 step 9), `app/components/ProductPrices/controls/CurrencySelector.tsx`, `app/components/ProductPrices/index.tsx` (WP08 version: `useCurrencyConversion(initialExchangeRate, initialUrlState.currency)` and `onCurrencyChange={(currency) => updateUrlState({ currency })}`), `app/components/MarketView/MarketView.tsx`, `app/components/BoxCalculator/BoxCalculator.tsx`, `app/components/dashboard/RecentlyReleased.tsx`, `app/portfolio/page.tsx`, `app/components/Portfolio/PortfolioDashboard.tsx`, `app/compare/CompareDashboard.tsx` (WP18), and the pages that pass `initialExchangeRate`: `app/page.tsx`, `app/prices/page.tsx`, `app/market/page.tsx`, `app/box-calculator/page.tsx`.
- `eslint.config.mjs` (WP04 `ANON_CLIENT_FORBIDDEN_FILES`, WP05/WP06 `no-restricted-syntax`, WP12 repo-wide `no-restricted-imports`, WP17 `no-console` and the named export), `jest.config.js`, `package.json`, `.github/workflows/ci.yml`, `/home/user/Pokefin/.github/copilot-instructions.md` (101 lines), `/home/user/Pokefin/audits/HARDENING_FOLLOWUPS.md` (section 7), `/home/user/Pokefin/audits/authentication-flow.md:406-412` (F-15).
- Existing tests that must keep passing through this package: `app/api/account/delete/__tests__/route.test.ts` (WP17), `app/api/account/export/__tests__/route.test.ts` (WP01), `app/auth/callback/__tests__/route.test.ts` (WP02), `app/lib/__tests__/proxy.test.ts` (WP17), `app/lib/__tests__/routeSupabase.test.ts` (WP17), `app/lib/__tests__/csrf.test.ts` (WP17).

Confirm the starting state (from `frontend/`):

```bash
git log --oneline -1                    # latest master
# F034: inline CSRF copies still exist (expect delete and export routes listed)
grep -rln "ALLOWED_ORIGINS" app --include=*.ts | grep -v __tests__
# F034: inline client construction outside the factories (expect delete, export, callback, proxy.ts, serverSupabase)
grep -rn "createServerClient(" app proxy.ts --include=*.ts | grep -v __tests__
# F047: no Database types, casts present, any allowed
ls app/types/database.ts 2>&1 | head -1          # expect "No such file"
grep -rnE "as unknown as|as any\b|: any\b|any\[\]" app proxy.ts --include=*.ts --include=*.tsx | grep -v __tests__
grep -n "no-explicit-any" eslint.config.mjs       # expect the "off" override
# F048: lib depends on components (expect 6+ lib modules)
grep -rlnE "from \"(\.\./)+components/" app/lib --include=*.ts | grep -v __tests__
grep -rn "^\"use client\"" app/lib             # expect exchangeRate.ts and clientMarketData.ts
# F051: literal fallbacks (expect ~13 hits; the SVG path in PriceChart is a false positive)
grep -rnE "1\.3[56]\b" app --include=*.ts --include=*.tsx | grep -v __tests__ | grep -v 'd="'
# F107: dead code (expect each to have no importers besides itself)
grep -rn "ExchangeRateService\|fetchUSDToCADRate" app | grep -v "app/components/ExchangeRateService.ts"
grep -rn "fetchSalesHistory\|searchProductsBySet\|formatScore\|createServerSupabaseClient" app
grep -rn "components/Portfolio\"\|Portfolio/index\"" app
```

Assumptions to check before writing code. If one fails, stop and report instead of improvising:

1. `app/lib/format.ts` exports `formatMoney` and `CurrencyCode` (WP07). Needed by step 3.2.
2. `app/lib/serverMarketData.ts` exports `getCachedExchangeRate(): Promise<ExchangeRateSnapshot>` that catches its own errors and returns `{ rate: DEFAULT_EXCHANGE_RATE, date: null }` on failure (WP11 step 2e). Run `grep -n "export async function getCachedExchangeRate" -A8 app/lib/serverMarketData.ts` and check for the `try`/`catch`. If it is still a bare `unstable_cache` export that can reject, wrap the layout call in step 3.4 with `.catch(() => ({ rate: DEFAULT_EXCHANGE_RATE, date: null }))`.
3. `app/lib/supabaseLoader.ts` exists (WP12) and derives its client type from `typeof import("./supabase")`. If it declares its own client type, type it with `SupabaseClient<Database>` in step 4.3.
4. `pnpm build:stub` exists in `package.json` (WP00).
5. The generated database types (Owner actions, item 1) are available: either `app/types/database.ts` has been pushed to your branch by the owner, or `SUPABASE_ACCESS_TOKEN` is set in your environment so you can run `pnpm types:db` yourself after step 4.1. If neither is true when you reach step 4, finish every other step, open the PR as a **draft** titled with a `[waiting for DB types]` prefix, list Owner action 1 in the PR body, and complete step 4 once the file arrives. Do not hand-write `database.ts`.

## Implementation steps

Order: step 1 (F034) and step 2 (F048) are independent; step 3 (F051) needs step 2's `app/types/market.ts`; step 4 (F047) needs steps 1 to 3 and the generated file; step 5 (ESLint) needs steps 1, 2 and 4; step 6 (F107) goes last because the documentation describes the result. Run `pnpm exec tsc --noEmit` after each numbered step; it must be clean before you move on (step 4 is the exception: it is clean at the end of 4.6).

The new modules in 1.1, 1.3, 3.1, 3.3 and 3.5 and the mapper code in 4.4c/4.4e were type-checked with the installed TypeScript 6.0.3, `@types/react` 19, `@supabase/ssr` 0.12.4 and Next 16.3.6 while writing this spec (strict mode, no errors).

### Step 1. F034: one CSRF gate, three server client factories

1.1. New file `app/lib/supabaseEnv.ts`:

```ts
/**
 * Supabase URL and anon key for the server-side client factories
 * (routeSupabase.ts and requestSupabase.ts).
 *
 * Placeholders keep module load and `next build` page-data collection from
 * throwing when the env vars are missing; real calls then fail loudly with
 * DNS or auth errors. proxy.ts checks hasSupabaseEnv() first and fails closed
 * on protected routes. Read at call time, not at module load, so tests and
 * the build stub can set the variables after import.
 */
const PLACEHOLDER_URL = "https://placeholder.supabase.invalid";
const PLACEHOLDER_KEY = "placeholder-key";

export function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL;
}

export function supabaseAnonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_KEY || PLACEHOLDER_KEY;
}

export function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_KEY
  );
}
```

1.2. `app/lib/routeSupabase.ts`: delete the two module-level constants (`supabaseUrl`, `supabaseAnonKey`, lines 7-10 at `a188fea`), add `import { supabaseAnonKey, supabaseUrl } from "./supabaseEnv";` below the `./cookieOptions` import, change the call to `createServerClient(supabaseUrl(), supabaseAnonKey(), {`, and extend the doc comment with one paragraph:

```ts
 *
 * For code that builds its own NextResponse and must put the session
 * cookies on it (proxy.ts, app/auth/callback/route.ts), use
 * createRequestSupabaseClient from ./requestSupabase instead.
```

Leave the `setAll` body exactly as it is. If an earlier package changed anything else in this file, keep it.

1.3. New file `app/lib/requestSupabase.ts`. It is the response-based helper the F034 verifier asked for, shared by the proxy and the callback. It collects every cookie and header Supabase asks to set and writes them, hardened, onto whichever response the caller finally returns. That is the pattern WP02 already uses inline in the callback, and it removes the proxy's "copy cookies from `res` onto the redirect" step.

```ts
import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { hardenCookieOptions } from "./cookieOptions";
import { supabaseAnonKey, supabaseUrl } from "./supabaseEnv";

type PendingCookie = { name: string; value: string; options?: CookieOptions };

/**
 * Supabase client for code that returns a NextResponse it builds itself:
 * proxy.ts (session refresh on every matched request) and the email-link
 * callback (app/auth/callback/route.ts). Route handlers use
 * createRouteSupabaseClient from ./routeSupabase instead.
 *
 * Cookies and the no-cache headers Supabase sets during a call (token
 * rotation, code exchange) are collected, not written, because the response
 * that will carry them is often decided afterwards (pass-through or login
 * redirect; reset form or login error). Call applyTo(response) on the
 * response you return. Every cookie is written HttpOnly + Secure via
 * hardenCookieOptions (audit session-cookie F-1), and a rotation is never
 * lost on a redirect (audit session-cookie F-5).
 */
export function createRequestSupabaseClient(request: NextRequest) {
  const pendingCookies: PendingCookie[] = [];
  const pendingHeaders: Record<string, string> = {};

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        pendingCookies.push(...cookiesToSet);
        // `headers` is Cache-Control/Expires/Pragma when auth cookies are set:
        // a response carrying a session token must never be cached.
        Object.assign(pendingHeaders, headers);
      },
    },
  });

  function applyTo<R extends NextResponse>(response: R): R {
    for (const { name, value, options } of pendingCookies) {
      response.cookies.set({ name, value, ...hardenCookieOptions(options) });
    }
    for (const [key, value] of Object.entries(pendingHeaders)) {
      response.headers.set(key, value);
    }
    return response;
  }

  return { supabase, applyTo };
}
```

Notes: `Object.assign` with an `undefined` source is a no-op, so a caller (or a test mock) that invokes `setAll` with one argument is fine. `response.cookies.set` replaces an earlier cookie of the same name, so a second rotation in one request wins, which is what the old per-call writes did.

1.4. `proxy.ts`. Replace the imports `import { createServerClient } from "@supabase/ssr";` and `import { hardenCookieOptions } from "./app/lib/cookieOptions";` with:

```ts
import { createRequestSupabaseClient } from "./app/lib/requestSupabase";
import { hasSupabaseEnv } from "./app/lib/supabaseEnv";
```

Keep WP02's `rateLimit` import and the rate-limit block unchanged. Replace everything from `const res = NextResponse.next({ request: req });` to the end of the `proxy` function (lines 38-92 at `a188fea`) with:

```ts
  const res = NextResponse.next({ request: req });

  // 2) Fail closed if Supabase env vars are missing: for protected
  //    routes we cannot verify the session, so deny rather than allow.
  if (!hasSupabaseEnv()) {
    const requiresAuth = PROTECTED_PATTERNS.some((re) => re.test(path));
    if (requiresAuth) {
      return new NextResponse("Service unavailable", { status: 503 });
    }
    return res;
  }

  // 3) Refresh the session. Rotated cookies are collected by the helper and
  //    written, hardened, onto whichever response we return below, so a
  //    rotation that lands mid-request is never lost on the login redirect
  //    (audit session-cookie F-5).
  const { supabase, applyTo } = createRequestSupabaseClient(req);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const requiresAuth = PROTECTED_PATTERNS.some((re) => re.test(path));

  if (requiresAuth && !user) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("next", path);
    return applyTo(NextResponse.redirect(url));
  }

  return applyTo(res);
}
```

`PROTECTED_PATTERNS`, `tooManyRequests` and `config.matcher` stay as they are. Visible difference: when Supabase rotates the session during `getUser`, the response now also carries `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0` (the library's instruction for any response that sets auth cookies). Only matched paths (`/account`, `/portfolio`, `/api`, `/auth`) are affected.

1.5. `app/auth/callback/route.ts` (WP02/WP13 version). Remove the `createServerClient`/`CookieOptions` import from `@supabase/ssr`, the `hardenCookieOptions` import and the `PendingCookie` type. Add `import { createRequestSupabaseClient } from "../../lib/requestSupabase";`. Inside `GET`, replace the block from `const pendingCookies: PendingCookie[] = [];` through the closing `);` of the `createServerClient(...)` call with:

```ts
  // Cookies and no-cache headers set during the exchange are collected and
  // written onto whichever redirect we decide on below.
  const { supabase, applyTo } = createRequestSupabaseClient(request);
```

and replace the tail (from `const response = NextResponse.redirect(new URL(target, request.url));` through `return response;`, including both `for` loops) with:

```ts
  return applyTo(NextResponse.redirect(new URL(target, request.url)));
```

Everything between (the `flowId` read, `exchangeCodeForSession`, the `redirectType` read, the `target` decision, `RESET_PASSWORD_PATH`, `AUTH_LINK_FAILED_PATH`, the `safeNextPath` import from `app/lib/redirects.ts`) stays byte for byte. Delete WP02's comment "Keep the inline `createServerClient`; WP20 consolidates it" if it was copied into the file.

1.6. `app/api/account/delete/route.ts`. Replace lines 1-55 at `a188fea` (every import, `ALLOWED_ORIGINS`, `isAllowedOrigin`, and the handler body down to and including the inline `createServerClient(...)` call) so the file starts:

```ts
import { NextRequest, NextResponse } from "next/server";
import { rejectIfBodyTooLarge, rejectIfCsrfFails } from "../../../lib/csrf";
import { createRouteSupabaseClient } from "../../../lib/routeSupabase";
import { logSupabaseError } from "../../../lib/logger";

export async function DELETE(request: NextRequest) {
  // CSRF gate shared by every state-changing route (lib/csrf.ts): the
  // x-pokefin-request header plus an allowlisted Origin.
  const csrf = rejectIfCsrfFails(request);
  if (csrf) return csrf;
  // DELETE reads no body; anything above 1 KiB suggests abuse.
  const tooLarge = rejectIfBodyTooLarge(request, 1024);
  if (tooLarge) return tooLarge;

  const supabase = await createRouteSupabaseClient();
```

The rest (`getUser` and the 401, the `delete_my_account` RPC with its comment, `logSupabaseError("delete_my_account_failed", rpcError)` and the 500, `signOut`, `{ success: true }`) stays unchanged. If WP17 did not land and line 70 still reads `console.error("delete_my_account_failed", { code: rpcError.code });`, change it to `logSupabaseError("delete_my_account_failed", rpcError);`.

1.7. `app/api/account/export/route.ts`. Same change: replace lines 1-55 at `a188fea` with

```ts
import { NextRequest, NextResponse } from "next/server";
import { rejectIfBodyTooLarge, rejectIfCsrfFails } from "../../../lib/csrf";
import { createRouteSupabaseClient } from "../../../lib/routeSupabase";
import { logSupabaseError } from "../../../lib/logger";

/**
 * GDPR Art. 15 / 20: data portability.
 * Returns a JSON blob with the caller's profile, portfolios, holdings,
 * lots, and box recipes. Same CSRF gate and body cap as every other
 * state-changing route (lib/csrf.ts).
 */
export async function POST(request: NextRequest) {
  const csrf = rejectIfCsrfFails(request);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(request, 1024);
  if (tooLarge) return tooLarge;

  const supabase = await createRouteSupabaseClient();
```

and keep everything from the `getUser` call down unchanged (download headers, `Cache-Control: no-store`, the generic 500).

Status codes and bodies are identical to the inline versions (403 `{ error: "Forbidden" }`, 413 `{ error: "Payload too large" }`, 401, 500), so WP17's delete-route test and WP01's export-route test pass without edits: `createRouteSupabaseClient` calls the same `@supabase/ssr` `createServerClient` and `next/headers` `cookies()` those tests mock. The one behavioural difference is the drift fix: an unset `NEXT_PUBLIC_SITE_URL` no longer leaves `""` in the allowlist (`csrf.ts` filters it).

1.8. Delete `app/lib/serverSupabase.ts` (F048; zero importers, confirmed by the grep in "Before you start").

### Step 2. F048: domain types under `app/types/`, lib no longer depends on components

2.1. Delete the dead barrel `app/components/Portfolio/index.ts` (zero importers) and `app/components/ExchangeRateService.ts` (zero importers). Keep `app/components/Portfolio/hooks/index.ts` (it has importers: `PortfolioDashboard.tsx:4`, `shared/ProductSearchSelect.tsx:4`).

2.2. Move the two type modules with history:

```bash
mkdir -p app/types
git mv app/components/ProductPrices/types/index.ts app/types/market.ts
git mv app/components/Portfolio/types/index.ts app/types/portfolio.ts
```

Open both moved files. Neither has imports at `a188fea`; if an earlier package added a relative import to either, fix its path for the new location. Change the first comment line of `market.ts` to `// Market, catalog and chart domain types. Shared by app/lib and the UI; imports nothing from app/components.` and of `portfolio.ts` to `// Portfolio domain types. Shared by app/lib (including app/lib/server) and the UI.`

2.3. Rewrite every importer with this one-off codemod. Save it outside the repo (for example `/tmp/wp20-move-type-imports.mjs`), run it from `frontend/`, and do not commit it:

```js
// One-off codemod for WP20 (review F048). Run from frontend/:
//   node /tmp/wp20-move-type-imports.mjs --dry   # print what would change
//   node /tmp/wp20-move-type-imports.mjs         # rewrite files
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dry = process.argv.includes("--dry");
const MOVES = [
  ["app/components/ProductPrices/types", "app/types/market"],
  ["app/components/Portfolio/types", "app/types/portfolio"],
].map(([from, to]) => [path.join(root, from), path.join(root, to)]);
// The shims are recreated by hand in 2.4; never rewrite them.
const SKIP = new Set(MOVES.map(([from]) => path.join(from, "index.ts")));

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function target(file, spec) {
  let abs;
  if (spec.startsWith(".")) abs = path.resolve(path.dirname(file), spec);
  else if (spec.startsWith("@/")) abs = path.join(root, spec.slice(2));
  else return null;
  abs = abs.replace(/\/index$/, "");
  for (const [from, to] of MOVES) if (abs === from) return to;
  return null;
}

function newSpec(file, spec, to) {
  if (spec.startsWith("@/")) return "@/" + path.relative(root, to);
  let rel = path.relative(path.dirname(file), to);
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

// from "x" | import("x") | jest.mock("x" | jest.requireActual("x") | require("x")
const RE =
  /(\bfrom\s*|\bimport\s*\(\s*|\bjest\.(?:mock|requireActual|doMock)\s*\(\s*|\brequire\s*\(\s*)(["'])([^"']+)\2/g;

let changedFiles = 0;
const files = walk(path.join(root, "app")).concat(
  fs.existsSync(path.join(root, "proxy.ts")) ? [path.join(root, "proxy.ts")] : []
);
for (const file of files) {
  if (SKIP.has(file)) continue;
  const src = fs.readFileSync(file, "utf8");
  let hits = 0;
  const out = src.replace(RE, (m, lead, q, spec) => {
    const to = target(file, spec);
    if (!to) return m;
    hits++;
    const next = newSpec(file, spec, to);
    if (dry) console.log(`${path.relative(root, file)}: ${spec} -> ${next}`);
    return `${lead}${q}${next}${q}`;
  });
  if (hits > 0) {
    changedFiles++;
    if (!dry) fs.writeFileSync(file, out);
  }
}
console.log(`${dry ? "[dry] " : ""}${changedFiles} files ${dry ? "would change" : "changed"}`);
```

A dry run of this script against `a188fea` rewrote 55 files (54 after 2.1 deletes the barrel); expect more after WP05 to WP19 (portfolio routes, `portfolioRepo.ts`, `catalogProjection.ts`, `boosterPackData.ts`, `BoxCalculator/types.ts`, `marketMath.ts`, and their tests). Run it with `--dry` first, read the list, then without. Afterwards:

```bash
grep -rnE "(ProductPrices|Portfolio)/types\"|from \"\.\.?/types\"" app --include=*.ts --include=*.tsx | grep -v "BoxCalculator"
# expect no output (BoxCalculator/types.ts is a different, component-local module and stays)
```

2.4. Recreate the old paths as temporary re-export shims for branches in flight. `app/components/ProductPrices/types/index.ts`:

```ts
/**
 * @deprecated Moved to app/types/market.ts (review F048). This re-export
 * exists for one release so in-flight branches still compile; ESLint already
 * rejects new imports of this path. Delete it in the next cleanup.
 */
export * from "../../../types/market";
```

`app/components/Portfolio/types/index.ts`: the same comment naming `app/types/portfolio.ts`, and `export * from "../../../types/portfolio";`.

2.5. Remove the dead exported types. For each name, run `grep -rnw "<Name>" app --include=*.ts --include=*.tsx` and delete the declaration only when the only hits are the declaration itself (and, for `ReturnData`, the unrelated local interface at `app/components/ProductPrices/shared/ReturnMetrics.tsx:27`, which stays):

- `app/types/market.ts`: `ProductSet`, `ProductType`, `ReturnData` (the exported one was a misleading namesake of ReturnMetrics' local `{ percent }` shape). Keep `Generation` if anything references it; delete it too if not.
- `app/types/portfolio.ts`: `PortfolioLot`, `ImportSummary`.

2.6. `app/components/PriceChart.tsx`: delete the local `type PriceHistoryEntry = { ... }` and `type Currency = "USD" | "CAD";` (lines 20-25 at `a188fea`; WP18 may have moved them, find them with `grep -n "^type PriceHistoryEntry\|^type Currency" app/components/PriceChart.tsx`) and import them instead, merged into the existing type import that the codemod pointed at `../types/market`:

```ts
import type { Currency, PriceHistoryEntry, SalesHistoryEntry } from "../types/market";
```

The local and the shared `PriceHistoryEntry` are identical (`usd_price: number; recorded_at: string`), so no other change is needed.

2.7. Replace `"use client"` with `import "client-only"` in the two plain lib modules (F048 verifier correction 2: the directive is an accidental guard, `client-only` is the intended one). In `app/lib/exchangeRate.ts` and `app/lib/clientMarketData.ts`, replace the first line `"use client";` with:

```ts
// Browser-only: reads the anonymous Supabase client. A Server Component that
// imports this module fails the build instead of silently querying as anon
// on the server (review F048). Mirrors import "server-only" in
// serverMarketData.ts and routeSupabase.ts.
import "client-only";
```

Leave `"use client"` on the hook modules under `app/components/**/hooks/` untouched (out of scope).

`client-only` is not installed as a package (neither is `server-only`); Next aliases both at compile time and `next/types/global.d.ts` declares both modules for TypeScript. Jest does not alias `client-only` (`next/jest` maps only `server-only`), so add it to `jest.config.js` `moduleNameMapper`, after the `@/` entry:

```js
    // next/jest maps server-only to an empty module but not client-only.
    '^client-only$': require.resolve('next/dist/build/jest/__mocks__/empty.js'),
```

(`require.resolve('next/dist/build/jest/__mocks__/empty.js')` resolves from `frontend/`; verified against the installed Next 16.3.6.) If `pnpm build:stub` later fails with "Module not found: client-only", run `pnpm add client-only@0.0.1` and commit the lockfile change; do not revert to `"use client"`.

2.8. In `app/lib/exchangeRate.ts`, if it imports `DEFAULT_EXCHANGE_RATE` or `ExchangeRateSnapshot` from `./marketData`, point that import at `./currency` after step 3.1 (keeps `marketData.ts` and `priceGuard.ts` out of the lazily loaded rate chunk).

### Step 3. F051: one currency preference, one fallback rate

3.1. New file `app/lib/currency.ts`:

```ts
/**
 * Currency constants and pure helpers, shared by server and client code.
 * Prices are stored in USD everywhere; CAD is display-only.
 *
 * No React, no Supabase, no "use client": the root layout's CurrencyProvider,
 * server pages and lib modules all import this, so keep it tiny.
 */
import { formatMoney } from "./format";
import type { Currency } from "../types/market";

/**
 * The only hard-coded USD to CAD rate in the app (review F051). Used when no
 * rate could be read from exchange_rates.
 */
export const DEFAULT_EXCHANGE_RATE = 1.36;

/** Display currency before a visitor picks one. */
export const DEFAULT_CURRENCY: Currency = "CAD";

export const CURRENCIES: readonly Currency[] = ["USD", "CAD"];

export type ExchangeRateSnapshot = {
  rate: number;
  /** recorded_at of the rate. null means `rate` is the fallback, not a reading. */
  date: string | null;
};

export function isCurrency(value: unknown): value is Currency {
  return value === "USD" || value === "CAD";
}

/** A positive finite rate, else DEFAULT_EXCHANGE_RATE. */
export function usableRate(rate: number | null | undefined): number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0
    ? rate
    : DEFAULT_EXCHANGE_RATE;
}

/**
 * A USD amount in `currency`. null, undefined and 0 give 0: the contract
 * useCurrencyConversion's convertPrice always had.
 */
export function convertUsd(
  usdPrice: number | null | undefined,
  currency: Currency,
  rate: number
): number {
  if (!usdPrice) return 0;
  return currency === "CAD" ? usdPrice * rate : usdPrice;
}

/**
 * A USD price formatted in `currency`. A missing price renders as "--",
 * never as an amount: null means nothing was scraped or the newest price is
 * past PRICE_STALENESS_TOLERANCE_DAYS and priceGuard withheld it, and
 * "$0.00" would read as a real, very wrong market price. A literal 0 still
 * formats as 0.00 (calculator subtotals legitimately reach 0).
 */
export function formatUsdAs(
  usdPrice: number | null | undefined,
  currency: Currency,
  rate: number
): string {
  if (usdPrice === null || usdPrice === undefined || Number.isNaN(usdPrice)) {
    return "--";
  }
  return formatMoney(currency === "CAD" ? usdPrice * rate : usdPrice, currency);
}
```

3.2. `app/lib/marketData.ts`: replace the `export type ExchangeRateSnapshot = { ... };` block (lines 40-43 at `a188fea`) and `export const DEFAULT_EXCHANGE_RATE = 1.36;` (line 71) with, at the position of the old type:

```ts
// Moved to ./currency (WP20, review F051). Re-exported so existing imports
// (serverMarketData.ts, tests) keep working.
export { DEFAULT_EXCHANGE_RATE } from "./currency";
export type { ExchangeRateSnapshot } from "./currency";
```

Nothing else in `marketData.ts` uses either name (checked at `a188fea`); if `tsc` says otherwise, add a normal `import { DEFAULT_EXCHANGE_RATE } from "./currency";` as well.

3.3. New file `app/context/CurrencyContext.tsx`:

```tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Currency } from "../types/market";
import {
  DEFAULT_CURRENCY,
  DEFAULT_EXCHANGE_RATE,
  convertUsd,
  formatUsdAs,
  isCurrency,
  usableRate,
  type ExchangeRateSnapshot,
} from "../lib/currency";
import { logCaughtError } from "../lib/logger";

/**
 * Site-wide display currency and USD to CAD rate (review F051/F105).
 *
 * - The rate is seeded by the root layout from getCachedExchangeRate(), so
 *   every page has it on first render. When the server only had the fallback
 *   (date === null) the browser fetches once.
 * - The currency is the visitor's preference, kept in localStorage so it
 *   follows them across /market, /portfolio and /box-calculator. It is read
 *   with useSyncExternalStore: the server and the hydration render use the
 *   default, and React re-renders with the stored value right after
 *   hydration, with no mismatch.
 * - /prices keeps ?currency= as its source of truth (useCurrencyConversion
 *   with an initial currency) and only writes the preference when the user
 *   clicks, so the URL and the preference never fight during hydration.
 */

export const CURRENCY_STORAGE_KEY = "pokefin.currency";

export type CurrencyContextValue = {
  currency: Currency;
  /** Remember `currency` site-wide. Call from event handlers only. */
  setCurrency: (currency: Currency) => void;
  exchangeRate: number;
  exchangeRateDate: string | null;
  exchangeRateLoading: boolean;
  convertPrice: (usdPrice: number | null | undefined) => number;
  formatPrice: (usdPrice: number | null | undefined) => string;
};

// ---- preference store: localStorage with an in-memory fallback ----

// Set on every write so the choice holds for this tab even when storage is
// blocked (private mode, disabled site data).
let memoryCurrency: Currency | null = null;
const listeners = new Set<() => void>();

function readPreference(): Currency | null {
  if (memoryCurrency) return memoryCurrency;
  try {
    const stored = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
    return isCurrency(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writePreference(currency: Currency): void {
  memoryCurrency = currency;
  try {
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, currency);
  } catch {
    // Storage unavailable: the choice lasts for this tab only.
  }
  listeners.forEach((listener) => listener());
}

function subscribePreference(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changed the preference.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CURRENCY_STORAGE_KEY) return;
    memoryCurrency = isCurrency(event.newValue) ? event.newValue : null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

// The server has no preference.
function getServerPreference(): Currency | null {
  return null;
}

/** Test-only: forget the in-memory preference between cases. */
export function _resetCurrencyPreferenceForTests(): void {
  memoryCurrency = null;
}

// Used when a component renders outside the provider (unit tests of a single
// component). The root layout always mounts the provider in the app.
const FALLBACK_VALUE: CurrencyContextValue = {
  currency: DEFAULT_CURRENCY,
  setCurrency: () => {},
  exchangeRate: DEFAULT_EXCHANGE_RATE,
  exchangeRateDate: null,
  exchangeRateLoading: false,
  convertPrice: (usd) => convertUsd(usd, DEFAULT_CURRENCY, DEFAULT_EXCHANGE_RATE),
  formatPrice: (usd) => formatUsdAs(usd, DEFAULT_CURRENCY, DEFAULT_EXCHANGE_RATE),
};

const CurrencyContext = createContext<CurrencyContextValue>(FALLBACK_VALUE);

export function CurrencyProvider({
  initialRate,
  children,
}: {
  initialRate: ExchangeRateSnapshot;
  children: ReactNode;
}) {
  const stored = useSyncExternalStore(
    subscribePreference,
    readPreference,
    getServerPreference
  );
  const currency = stored ?? DEFAULT_CURRENCY;

  const needsBrowserRate = initialRate.date === null;
  const [browserRate, setBrowserRate] = useState<ExchangeRateSnapshot | null>(null);

  useEffect(() => {
    if (!needsBrowserRate) return;
    let cancelled = false;
    // Loaded on demand so supabase-js stays off the initial bundle of every
    // page (review F011; exchangeRate.ts reaches it through supabaseLoader).
    import("../lib/exchangeRate")
      .then(({ fetchLatestExchangeRateClient }) => fetchLatestExchangeRateClient())
      .then((snapshot) => {
        if (!cancelled) setBrowserRate(snapshot);
      })
      .catch((error: unknown) => {
        logCaughtError("exchange_rate_load_failed", error);
        if (!cancelled) setBrowserRate({ rate: DEFAULT_EXCHANGE_RATE, date: null });
      });
    return () => {
      cancelled = true;
    };
  }, [needsBrowserRate]);

  const snapshot = needsBrowserRate ? browserRate : initialRate;
  const exchangeRate = usableRate(snapshot?.rate);
  const exchangeRateDate = snapshot?.date ?? null;
  const exchangeRateLoading = needsBrowserRate && browserRate === null;

  const value = useMemo<CurrencyContextValue>(
    () => ({
      currency,
      setCurrency: writePreference,
      exchangeRate,
      exchangeRateDate,
      exchangeRateLoading,
      convertPrice: (usd) => convertUsd(usd, currency, exchangeRate),
      formatPrice: (usd) => formatUsdAs(usd, currency, exchangeRate),
    }),
    [currency, exchangeRate, exchangeRateDate, exchangeRateLoading]
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext);
}
```

The provider renders no DOM of its own, so server and client markup are identical. State is only set inside promise callbacks, never synchronously in the effect (`react-hooks/set-state-in-effect`).

3.4. `app/layout.tsx`. Add the imports:

```ts
import { CurrencyProvider } from "./context/CurrencyContext";
import { getCachedExchangeRate } from "./lib/serverMarketData";
```

Make the layout async, read the rate once, and wrap the tree inside `AuthProvider`. Replace the `RootLayout` function (lines 38-58 at `a188fea`; keep any attribute or child WP13/WP14 added to `<html>`/`<body>`) with:

```tsx
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // One cached read (unstable_cache, tag "exchange-rate"). Never throws: on a
  // failed read it returns the fallback with date null, and CurrencyProvider
  // then asks the browser to fetch.
  const exchangeRate = await getCachedExchangeRate();

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          <CurrencyProvider initialRate={exchangeRate}>
            <Header />
            {children}
            <Footer />
          </CurrencyProvider>
        </AuthProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
```

Consequence to state in the PR: pages that had no data dependency (`/auth/*`, `/account`) now depend on the exchange-rate cache entry, so they regenerate on the same daily backstop and tag as the market pages. That is harmless (the render is cheap) and it is what makes the rate available everywhere without a client request.

3.5. Rewrite `app/components/ProductPrices/hooks/useCurrencyConversion.ts` entirely. It becomes the hook for pages whose currency is decided by the page, not by the preference; the rate comes from the provider. The signature changes from `(initialExchangeRate?, initialCurrency = "CAD")` to `(initialCurrency?)`, so `tsc` flags every old call site.

```ts
"use client";

import { useCallback, useState } from "react";
import type { Currency } from "../../../types/market";
import { useCurrency } from "../../../context/CurrencyContext";
import { convertUsd, formatUsdAs } from "../../../lib/currency";

/**
 * Display currency owned by one page, priced with the site-wide rate from
 * CurrencyProvider (review F051).
 *
 * - initialCurrency given: the page decides. /prices passes its ?currency=
 *   value (the URL is its source of truth); the dashboard's Recently Released
 *   passes "USD".
 * - initialCurrency omitted: follows the site preference until
 *   setSelectedCurrency is called (/box-calculator, where loading a recipe
 *   switches to the recipe's currency without changing the preference).
 *
 * setSelectedCurrency changes this page only and is safe to call during
 * render (/prices does when the URL changes). To remember an explicit user
 * choice across pages, also call useCurrency().setCurrency from the click
 * handler. Pages whose currency is simply the preference (/market,
 * /portfolio) call useCurrency() directly.
 */
export function useCurrencyConversion(initialCurrency?: Currency) {
  const {
    currency: preferredCurrency,
    exchangeRate,
    exchangeRateLoading,
  } = useCurrency();
  const [pageCurrency, setSelectedCurrency] = useState<Currency | null>(
    initialCurrency ?? null
  );
  const selectedCurrency = pageCurrency ?? preferredCurrency;

  const convertPrice = useCallback(
    (usdPrice: number | null | undefined): number =>
      convertUsd(usdPrice, selectedCurrency, exchangeRate),
    [selectedCurrency, exchangeRate]
  );

  // "--" for a missing price, never "$0.00": see formatUsdAs in lib/currency.ts.
  const formatPrice = useCallback(
    (usdPrice: number | null | undefined): string =>
      formatUsdAs(usdPrice, selectedCurrency, exchangeRate),
    [selectedCurrency, exchangeRate]
  );

  return {
    selectedCurrency,
    exchangeRate,
    exchangeRateLoading,
    setSelectedCurrency,
    convertPrice,
    formatPrice,
  };
}
```

The return shape is the same as before, so the destructuring in the three remaining callers does not change.

3.6. `app/components/ProductPrices/index.tsx` (WP08 version):

- Delete `initialExchangeRate?: number;` from `ProductPricesProps` and `initialExchangeRate,` from the component's destructured props.
- `useCurrencyConversion(initialExchangeRate, initialUrlState.currency)` becomes `useCurrencyConversion(initialUrlState.currency)`.
- Add `import { useCurrency } from "../../context/CurrencyContext";` and, directly below the `useCurrencyConversion` destructure, `const { setCurrency: rememberCurrency } = useCurrency();`.
- Where `ControlBar` receives the currency handler (`onCurrencyChange={(currency) => updateUrlState({ currency })}` in the WP08 file), change it to:

```tsx
          onCurrencyChange={(currency) => {
            updateUrlState({ currency });
            // An explicit choice here becomes the site-wide preference; the
            // URL stays the source of truth on this page (review F051).
            rememberCurrency(currency);
          }}
```

Do not call `rememberCurrency` in the URL-to-state block that runs during render; that block keeps calling only `setSelectedCurrency`.

3.7. `app/prices/page.tsx`: stop passing `initialExchangeRate={exchangeRate.rate}`. If `exchangeRate` is then unused, remove `getCachedExchangeRate()` from the `Promise.all` and from the destructuring and the import.

3.8. `app/components/dashboard/RecentlyReleased.tsx`: delete `initialExchangeRate: number;` from the props interface and from the destructure; the hook call becomes `useCurrencyConversion("USD")`. `app/page.tsx`: stop passing `initialExchangeRate={exchangeRate.rate}` (line 284 at `a188fea`); remove `getCachedExchangeRate` from the page's `Promise.all`, destructuring and import if nothing else on the page uses the rate (`grep -n "exchangeRate" app/page.tsx`).

3.9. `app/components/MarketView/MarketView.tsx`: delete `initialExchangeRate?: number;` from `MarketViewProps` and `initialExchangeRate,` from the destructure. Replace the `useCurrencyConversion(initialExchangeRate)` destructure with:

```ts
  // The site-wide preference: a choice made here follows the visitor to
  // /portfolio and /box-calculator (review F051).
  const {
    currency: selectedCurrency,
    setCurrency: setSelectedCurrency,
    exchangeRate,
    exchangeRateLoading,
    convertPrice,
    formatPrice,
  } = useCurrency();
```

Swap the `useCurrencyConversion` import for `import { useCurrency } from "../../context/CurrencyContext";`. The local names are unchanged, so the rest of the file (and WP19's `columns.tsx`/`MarketTableRow.tsx`, which receive these as props) needs no edit. `app/market/page.tsx`: stop passing `initialExchangeRate`, and drop `getCachedExchangeRate` there if unused.

3.10. `app/components/BoxCalculator/BoxCalculator.tsx` (WP06/WP11 version): remove `initialExchangeRate?: number;` (and its comment) from `BoxCalculatorProps` and from the destructured props; `useCurrencyConversion(initialExchangeRate)` becomes `useCurrencyConversion()`. Add `import { useCurrency } from "../../context/CurrencyContext";`, and below the hook destructure `const { setCurrency: rememberCurrency } = useCurrency();`. The `CurrencySelector`'s `onChange={setSelectedCurrency}` becomes:

```tsx
        onChange={(currency) => {
          setSelectedCurrency(currency);
          rememberCurrency(currency);
        }}
```

`loadRecipeIntoState` keeps calling only `setSelectedCurrency(recipe.currency)`: a loaded (possibly shared) recipe changes this page, not the visitor's preference. `app/box-calculator/page.tsx`: delete the `initialExchangeRate=...` prop and its comment, and remove `getCachedExchangeRate` from its `Promise.all` and import (keep `getCachedMarketProductSummaries`; the destructure becomes `const [products] = await Promise.all([...])` or a plain `await`).

3.11. `/portfolio`. In `app/portfolio/page.tsx` (WP04/WP13 version):

- Delete the currency state and the rate effect (lines 13-32 at `a188fea`: `useState<"USD" | "CAD">("USD")`, `useState(1.36)`, the `fetchExchangeRate` effect) and the `fetchLatestExchangeRateClient` import. Keep `useEffect`/`useState` imports only if still used.
- Add imports `import CurrencySelector from "../components/ProductPrices/controls/CurrencySelector";` and `import { useCurrency } from "../context/CurrencyContext";`, and directly after the `useAuth()`/`useRouter()` lines (before any early `return`):

```ts
  const { currency, setCurrency, exchangeRate, exchangeRateLoading } = useCurrency();
```

- Replace the bespoke toggle block (`{/* Currency Toggle */}` and its `<div className="inline-flex rounded-lg ...">...</div>`, lines 76-96 at `a188fea`) with:

```tsx
          {/* Currency: the site-wide preference (review F051/F105). */}
          <div className="self-start sm:self-auto">
            <CurrencySelector
              selectedCurrency={currency}
              exchangeRate={exchangeRate}
              exchangeRateLoading={exchangeRateLoading}
              onChange={setCurrency}
            />
          </div>
```

- `<PortfolioDashboard currency={currency} exchangeRate={exchangeRate} />` becomes `<PortfolioDashboard />`.

In `app/components/Portfolio/PortfolioDashboard.tsx`: delete `interface PortfolioDashboardProps` and the destructured props with their defaults (`currency = "USD"`, `exchangeRate = 1.36`); the signature becomes `export default function PortfolioDashboard() {` and its first line `const { currency, exchangeRate } = useCurrency();` with `import { useCurrency } from "../../context/CurrencyContext";`. The four children keep receiving `currency` and `exchangeRate` as props (they are presentational and their tests pass them explicitly).

Visible change to call out in the PR: `/portfolio` used to open in USD regardless of the rest of the site; it now opens in the visitor's preference (CAD until they choose).

3.12. Replace every remaining literal fallback with the constant. In each file below, change the default `exchangeRate = 1.36` to `exchangeRate = DEFAULT_EXCHANGE_RATE` and add `import { DEFAULT_EXCHANGE_RATE } from "<relative path>/lib/currency";`:

- `app/components/Portfolio/cards/HoldingsTable.tsx`, `app/components/Portfolio/cards/HoldingCard.tsx`, `app/components/Portfolio/shared/PortfolioSummaryCard.tsx`, `app/components/Portfolio/shared/PortfolioChart.tsx`, `app/components/Portfolio/shared/AllocationChart.tsx` (path `../../../lib/currency`)
- `app/components/charts/PortfolioChartImpl.tsx`, `app/components/charts/AllocationChartImpl.tsx` (path `../../lib/currency`; WP17 may have moved the default into a module-scope tooltip's props, change it wherever it is)
- `app/components/PriceChart.tsx` (`../lib/currency`), `app/components/ProductPrices/shared/ResponsivePriceChart.tsx` (`../../../lib/currency`)

`app/compare/CompareDashboard.tsx` (WP18): delete `const DEFAULT_EXCHANGE_RATE = 1.35;` and add `import { DEFAULT_EXCHANGE_RATE } from "../lib/currency";`. The page keeps its own server-fed rate and fetch; only its fallback changes, from 1.35 to 1.36, and only when no rate could be read.

Then:

```bash
grep -rnE "1\.3[56]\b" app --include=*.ts --include=*.tsx | grep -v __tests__ | grep -v 'd="'
# expect exactly one line: app/lib/currency.ts  DEFAULT_EXCHANGE_RATE = 1.36
grep -rn "initialExchangeRate" app --include=*.ts --include=*.tsx | grep -v "compare/"
# expect no output outside /compare (tests included: fix them per the Tests section)
```

### Step 4. F047: generated `Database` types and typed row boundaries

4.1. Add the generator script to `package.json` `scripts` (after `"test:coverage"`):

```json
    "types:db": "pnpm dlx supabase@2.118.0 gen types --lang typescript --project-id tyrhvavwvphazpmwluft --schema public > app/types/database.ts.tmp && mv app/types/database.ts.tmp app/types/database.ts"
```

`tyrhvavwvphazpmwluft` is the production project ref (it appears in `audits/api-and-infrastructure.md`). The CLI needs `SUPABASE_ACCESS_TOKEN` (a Supabase personal access token) in the environment. The temp file keeps a failed run from truncating the committed types. Supabase CLI 2.118.0 was the latest release when this spec was written (`npx supabase@2.118.0 gen types --help` lists `--lang`, `--project-id`, `--schema`).

4.2. Obtain `app/types/database.ts`: run `SUPABASE_ACCESS_TOKEN=... pnpm types:db` if you have a token, otherwise use the file the owner pushed (Owner actions, item 1). Check it:

```bash
grep -c "export type Database = " app/types/database.ts                        # 1
grep -c "export type Tables<" app/types/database.ts                             # 1
grep -cE "get_market_product_summaries|get_set_analytics|export_my_data|delete_my_account|get_shared_recipe" app/types/database.ts   # 5 or more
grep -cE "get_portfolio_history|get_market_product_metrics|product_price_pending" app/types/database.ts   # 3 or more: migrations 0028 to 0030 applied
```

If the last check is below 3, the production database is missing migrations from WP10 or WP16; stop and ask the owner to apply them and regenerate. Do not edit the generated file. Add `"app/types/database.ts",` to the `ignores` list of the first object in `eslint.config.mjs` (generated code).

4.3. Type the four factories. Add `import type { Database } from "../types/database";` to each file in `app/lib` below and pass the generic:

- `app/lib/supabase.ts`: `createBrowserClient<Database>(supabaseUrl, supabaseAnonKey, {`
- `app/lib/routeSupabase.ts`: `createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {`
- `app/lib/requestSupabase.ts`: `createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {`
- `app/lib/serverMarketData.ts`: `createClient<Database>(supabaseUrl, supabaseAnonKey, {` inside `createMarketDataSupabaseClient`

Everything that derives its client type from these (`BrowserSupabaseClient` in `supabaseLoader.ts`, `RouteSupabase` in `portfolioRepo.ts`, `RouteSupabaseClient` in `routeAuth.ts`, `MarketDataSupabaseClient` in `serverMarketData.ts`) is typed automatically.

4.4. Run `pnpm exec tsc --noEmit`. Every error it now reports is a place where a select string, an RPC name, an insert payload or a row type disagrees with the schema. Fix each with these rules, in this order of preference:

a. **Replace a cast with an annotation.** `(data ?? []) as unknown as T[]`, `(data || []) as T[]`, `data as T` and `x as any[]` become an annotated assignment, which the compiler checks:

```ts
// before (app/lib/server/portfolioRepo.ts, WP05)
const holdings = await guardHoldings(
  (data ?? []) as unknown as HoldingWithProduct[],
  await productsPromise
);
// after
const rows: HoldingWithProduct[] = data ?? [];
const holdings = await guardHoldings(rows, await productsPromise);
```

```ts
// before (portfolioRepo.ts getOrCreatePortfolio)
if (existing) return existing as Portfolio;
// after: the portfolios Row type and Portfolio have the same fields
if (existing) return existing;
```

```ts
// before (serverMarketData.ts set analytics, WP11 fetchSetAnalyticsFromRpc)
return ((data || []) as any[]).map((row) => ({
// after: get_set_analytics RETURNS TABLE, so each row is typed
return (data ?? []).map((row) => ({
```

b. **When the annotation fails because the domain type is wrong, fix the domain type to match the database** and null-guard its consumers. Known case: `HoldingProduct.url` in `app/types/portfolio.ts` is `string` but `products.url` is nullable (`schema.sql:65`); change it to `url: string | null;` (no component reads it: `grep -rn "products\.url\|products?\.url" app` returns nothing at `a188fea`).

c. **When a column is wider than the domain type, narrow it at runtime in one named mapper**, never with a cast. Two known cases:

- `product_sales_history.granularity` is `text` (CHECK constrained to `'day'`/`'week'`), while `SalesHistoryEntry.granularity` is `"day" | "week"`. Add to `app/lib/marketData.ts` and use it at both sales reads (`serverMarketData.ts` product detail, `salesHistory = (salesRows || []) as SalesHistoryEntry[]`, line 700 at `a188fea`; and any client read left after step 6.1):

```ts
/**
 * product_sales_history rows as SalesHistoryEntry. granularity is text in the
 * schema (CHECK-constrained to 'day'/'week'); anything else is dropped rather
 * than cast.
 */
export function toSalesHistoryEntries(
  rows: ReadonlyArray<Omit<SalesHistoryEntry, "granularity"> & { granularity: string }>
): SalesHistoryEntry[] {
  const entries: SalesHistoryEntry[] = [];
  for (const row of rows) {
    if (row.granularity === "day" || row.granularity === "week") {
      entries.push({ ...row, granularity: row.granularity });
    }
  }
  return entries;
}
```

- `product_price_history.product_id` and `.recorded_at` are nullable (`schema.sql:48,50`). Widen `groupHistoryRowsByProduct`'s parameter in `app/lib/marketData.ts` and skip incomplete rows:

```ts
export function groupHistoryRowsByProduct(
  rows: ReadonlyArray<{
    product_id: number | null;
    usd_price: number;
    recorded_at: string | null;
  }>
): Record<number, PriceHistoryEntry[]> {
  const historyByProduct: Record<number, PriceHistoryEntry[]> = {};

  for (const entry of rows) {
    // Both columns are nullable in the schema; a row without them cannot be
    // placed on a chart.
    if (entry.product_id === null || entry.recorded_at === null) continue;
    ...unchanged from here (push, then the sort loop)
```

  Apply the same `continue` guard in any other loop over raw `product_price_history` rows that `tsc` flags (for example `fetchNewestPricedAtClient` in `clientMarketData.ts`, which casts at `:138` at `a188fea`). RPC results (`get_price_history_deduplicated`, WP09/WP10 batch RPCs) are declared non-null by the generator and need no guard.

d. **Keep hand-written RPC row types that are more precise than the generated ones.** The generator cannot see the nullability of function output columns and may emit them as non-null. Where `Database["public"]["Functions"][...]["Returns"]` columns lack `| null` but the hand-written type (`MarketSummaryRow`, `ProductVolumeMetrics`, WP10's history row types) has it, keep the hand-written type and assign into it with an annotation: `const rows: MarketSummaryRow[] = data ?? [];`. That still checks the column names and base types. Do not replace them with the generated `Returns` type.

e. **`mapProductsQueryResultToProducts`** (`app/lib/marketData.ts:351-370` at `a188fea`) loses its `any` but keeps its runtime normalisation of array-or-object embeds (F047 verifier: a query against a database with different relationship metadata returns arrays). Replace the function with:

```ts
type EmbeddedGeneration = { id: number; name: string };
type EmbeddedSet = {
  id: number;
  name: string;
  code: string;
  release_date: string | null;
  expansion_type: string | null;
  generation_id?: number | null;
  generations?: EmbeddedGeneration | EmbeddedGeneration[] | null;
};
type EmbeddedProductType = { id: number; name: string; label: string | null };

/**
 * A `products` row selected with its sets/generations/product_types embeds
 * (clientMarketData fetchProductsFallback, serverMarketData
 * fetchProductsWithFallbackReturns). Embeds are typed as "object or array" on
 * purpose: the typed client infers objects for these many-to-one joins, but a
 * database whose relationship metadata differs returns arrays, so the
 * normalisation below stays.
 */
export type ProductsQueryRow = {
  id: number;
  usd_price: number | null;
  url: string | null;
  last_updated: string | null;
  variant: string | null;
  image_url: string | null;
  sku: string | null;
  sets: EmbeddedSet | EmbeddedSet[] | null;
  product_types: EmbeddedProductType | EmbeddedProductType[] | null;
};

function firstOrSelf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
  return value ?? null;
}

export function mapProductsQueryResultToProducts(data: ProductsQueryRow[]): Product[] {
  return data.map((item) => {
    const set = firstOrSelf(item.sets);
    const generation = set ? firstOrSelf(set.generations) : null;
    const productType = firstOrSelf(item.product_types);
    return {
      id: item.id,
      usd_price: item.usd_price,
      url: item.url ?? "",
      last_updated: item.last_updated ?? "",
      variant: item.variant,
      image_url: item.image_url,
      sku: item.sku,
      sets: set
        ? {
            id: set.id,
            name: set.name,
            code: set.code,
            release_date: set.release_date ?? "",
            expansion_type: set.expansion_type ?? undefined,
            generation_id: set.generation_id ?? undefined,
            generations: generation ?? undefined,
          }
        : null,
      product_types: productType
        ? {
            id: productType.id,
            name: productType.name,
            label: productType.label ?? undefined,
          }
        : null,
      returns: null,
    };
  });
}
```

  Differences from the old spread, all intended: `url`/`last_updated` null become `""` (what `mapMarketSummaryRowToProduct` already does, and what the `Product` type promises); an empty embed array becomes `null` instead of `[]`; a null `release_date` becomes `""` (consumers already test it for truthiness). If WP11 made `Product.sets.generations.id` optional, this still type-checks. If the select strings in the two callers select more columns than `ProductsQueryRow` lists and a caller reads one of them afterwards, add that column to `ProductsQueryRow` and to the mapper.

f. **Last resort, only when the generated type genuinely cannot express the shape** (an RPC that returns `json`/`jsonb` into a structured type, or TypeScript error TS2589 "type instantiation is excessively deep" on one query): declare a named row type next to the query, validate or narrow what you can, and use one `as` with a comment that says why. Never `as unknown as`, never `any`. `export_my_data` returns `jsonb` and is only serialised, so it needs nothing.

4.5. Sweep the remaining boundary casts. Every hit of this grep is either fixed by 4.4 or explained by a comment on the line above it:

```bash
grep -rnE "\b(data|rows|existing|created|winner|salesRows|fallbackData)\b[^;]*\)? as [A-Z]" app --include=*.ts --include=*.tsx | grep -v __tests__
grep -rnE "as unknown as|as any\b|: any\b|any\[\]|<any>" app proxy.ts --include=*.ts --include=*.tsx | grep -v __tests__
# second grep: expect no output
```

Known `any` sites at `a188fea` and their fixes, in case an earlier package left one: `app/lib/marketData.ts:351-352` (step 4.4e); `app/lib/serverMarketData.ts:864` (4.4a); `useBoxRecipes.ts:78` (rewritten by WP06); chart tooltips in `PriceChart.tsx`, `PortfolioChartImpl.tsx`, `AllocationChartImpl.tsx` (WP17 step 8 typed them with `ChartTooltipProps`; if `PriceChart`'s `CustomDot (props: any)` survived, type it `(props: { cx?: number; cy?: number; payload?: unknown })` with the fields it reads); `catch (err: any)` (use `catch (err: unknown)` and narrow with `err instanceof Error`).

4.6. `eslint.config.mjs`: delete the object `{ rules: { "@typescript-eslint/no-explicit-any": "off" } }` so the rule returns to `eslint-config-next/typescript`'s `"error"`. Run `pnpm run lint`; fix any `no-explicit-any` error with `unknown` plus narrowing or a real type (tests included; there were none in tests at `a188fea`). Do not add `eslint-disable` comments for it.

4.7. Drift check. New workflow `/home/user/Pokefin/.github/workflows/db-types.yml` (separate from `ci.yml` so it never blocks a pull request):

```yaml
name: Database types

# Fails when app/types/database.ts no longer matches the production schema,
# i.e. a migration was applied without running `pnpm types:db` (review F047).
# Needs the repository secret SUPABASE_ACCESS_TOKEN; without it the job only
# prints a notice.
on:
  push:
    branches: [master]
  schedule:
    - cron: "17 6 * * 1" # Mondays 06:17 UTC
  workflow_dispatch:

permissions:
  contents: read

jobs:
  db-types:
    name: Database types in sync
    runs-on: ubuntu-latest
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    defaults:
      run:
        working-directory: frontend
    steps:
      - name: Skip without a token
        if: env.SUPABASE_ACCESS_TOKEN == ''
        run: echo "::notice::SUPABASE_ACCESS_TOKEN is not set; database type drift check skipped."
      - uses: actions/checkout@v7
        if: env.SUPABASE_ACCESS_TOKEN != ''
      # Copy the pnpm/action-setup and actions/setup-node steps from the
      # frontend job in ci.yml exactly as WP00 left them (same versions,
      # same pnpm pin), each with the same `if:` as the checkout above.
      - name: Regenerate and compare
        if: env.SUPABASE_ACCESS_TOKEN != ''
        run: |
          pnpm run types:db
          git diff --exit-code -- app/types/database.ts
```

Replace the comment block with the two copied steps (add `if: env.SUPABASE_ACCESS_TOKEN != ''` to each). If WP00 pinned actions by SHA in `ci.yml`, pin the same SHAs here.

### Step 5. ESLint guards for F034 and F048

`eslint.config.mjs`. Uses `@typescript-eslint/no-restricted-imports` (a different rule from the core `no-restricted-imports` that WP04 and WP12 configure), so no existing block is overridden. Above the exported array, next to `ANON_CLIENT_FORBIDDEN_FILES`, add:

```js
// WP20 (review F034, F048). Supabase clients are built in exactly these
// modules; everything else asks one of them. Domain types live in app/types/.
const SUPABASE_FACTORY_MODULES = [
  "app/lib/supabase.ts",
  "app/lib/routeSupabase.ts",
  "app/lib/requestSupabase.ts",
  "app/lib/serverMarketData.ts",
];
const FACTORY_AND_TYPE_IMPORT_RULES = {
  paths: [
    {
      name: "@supabase/ssr",
      allowTypeImports: true,
      message:
        "Build Supabase clients only in app/lib/routeSupabase.ts (route handlers), app/lib/requestSupabase.ts (proxy.ts, auth callback) or app/lib/supabase.ts (browser, via supabaseLoader).",
    },
    {
      name: "@supabase/supabase-js",
      importNames: ["createClient"],
      message:
        "createClient is used only in app/lib/serverMarketData.ts (anonymous cached market data). Use a factory from app/lib.",
    },
  ],
  patterns: [
    {
      regex: "(^|/)(ProductPrices|Portfolio)/types(/index)?$",
      message:
        "Domain types moved to app/types/market.ts and app/types/portfolio.ts (review F048).",
    },
  ],
};
```

and append these two objects as the last elements of the array (after WP17's `no-console` objects):

```js
  // WP20: one set of client factories, types from app/types.
  {
    files: ["app/**/*.{ts,tsx}", "proxy.ts"],
    ignores: [
      ...SUPABASE_FACTORY_MODULES,
      "app/components/ProductPrices/types/index.ts",
      "app/components/Portfolio/types/index.ts",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", FACTORY_AND_TYPE_IMPORT_RULES],
    },
  },
  // WP20: app/lib is the layer under the UI and must not import from it.
  // Same rule as above, so it repeats those options (in flat config the later
  // object replaces the rule's options for the files both match).
  {
    files: ["app/lib/**/*.ts"],
    ignores: [...SUPABASE_FACTORY_MODULES, "**/__tests__/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: FACTORY_AND_TYPE_IMPORT_RULES.paths,
          patterns: [
            ...FACTORY_AND_TYPE_IMPORT_RULES.patterns,
            {
              regex: "(^|/)components/",
              message:
                "app/lib must not depend on app/components (review F048). Move the shared code into app/lib or the type into app/types.",
            },
          ],
        },
      ],
    },
  },
```

These options were exercised with the installed ESLint 9.39.5 and `eslint-config-next` 16 while writing this spec: `import { createServerClient } from "@supabase/ssr"` and `import { createClient } from "@supabase/supabase-js"` are reported in a route file and in `proxy.ts`; `import type { CookieOptions } from "@supabase/ssr"` (cookieOptions.ts) and `import { isAuthApiError, type User } from "@supabase/supabase-js"` are not; the factory modules are not; `../ProductPrices/types` and `../../components/ProductPrices/types/index` are reported and `../../types/market` is not. The in-folder spelling `../types` inside `ProductPrices/` is not caught by the regex; the codemod removed every such import and the shims are deleted next release, when `tsc` catches any straggler.

Run `pnpm run lint`. Expected: 0 errors. If the `app/lib` object reports a real `app/lib` to `app/components` import that is not a type (for example a lib module importing a component helper), stop and report it in the PR instead of moving code in this package.

### Step 6. F107: dead code, contributor instructions, audit notes

6.1. Dead code. Delete each only after its grep prints nothing outside the definition (and outside tests you are about to update):

- `fetchSalesHistory` in `app/lib/clientMarketData.ts` (`:358-433` at `a188fea`, with its doc comment) and its two caches `salesHistoryCache` and `salesHistoryPromiseCache` (`:64-68`). Remove `SalesHistoryEntry` from that file's type import if it becomes unused, and remove any line in a cache-reset test helper that clears those two maps. Check: `grep -rn "fetchSalesHistory\|salesHistoryCache\|salesHistoryPromiseCache" app`. WP12's `app/lib/__tests__/supabaseLazyLoad.test.ts` has a case "`fetchSalesHistory(1, 30)` resolves `[]`": delete that case (the function no longer exists; the other never-throw cases still cover the loader).
- `searchProductsBySet` in `app/lib/portfolio.ts` (`:784-821` at `a188fea`). Check: `grep -rn "searchProductsBySet" app`.
- `formatScore` in `app/stats/page.tsx` (`:55-58` at `a188fea`) if WP17 step 10c did not already delete it.
- Already handled above: `ExchangeRateService.ts` and `Portfolio/index.ts` (2.1), `serverSupabase.ts` (1.8), the unused exported types (2.5).
- Verify only, do not redo: `/analytics` versus `/stats` duplication is WP13's (a `redirects()` entry); `deleteLoading` in `PortfolioDashboard.tsx` is WP15/WP17's; the pnpm version in CI is WP00's. If any is still open, list it in the PR body.

6.2. Replace `/home/user/Pokefin/.github/copilot-instructions.md` entirely with the text below. Before committing, confirm every path it names exists and every command runs; delete or correct a line for anything missing (an earlier package may have chosen a different file name) rather than leaving it wrong:

```bash
cd /home/user/Pokefin/frontend
for p in app/lib/supabase.ts app/lib/supabaseLoader.ts app/lib/routeSupabase.ts app/lib/requestSupabase.ts \
  app/lib/serverMarketData.ts app/lib/csrf.ts app/lib/routeAuth.ts app/lib/logger.ts app/lib/format.ts \
  app/lib/marketMath.ts app/lib/csv.ts app/lib/priceGuard.ts app/lib/marketPulse.ts app/lib/currency.ts \
  app/lib/cacheTags.ts app/lib/redirects.ts app/lib/validation.ts app/lib/portfolioInput.ts app/lib/boxRecipes.ts \
  app/lib/server app/api/revalidate/route.ts app/context/CurrencyContext.tsx app/context/AuthContext.tsx \
  app/types/market.ts app/types/portfolio.ts app/types/database.ts scripts/build-with-stub.mjs; do
  test -e "$p" || echo "MISSING $p"
done
grep -n "SUPABASE_SERVICE_ROLE_KEY\|REVALIDATE_URL\|REVALIDATE_SECRET" ../secrets_loader.py ../main.py | head
```

New content of `.github/copilot-instructions.md`:

````markdown
# Pokéfin contributor and Copilot instructions

These notes describe the code as it is. If they disagree with the code, the code wins: fix this file in the same PR.

## Project overview

- `frontend/`: Next.js 16 App Router (Turbopack), React 19, TypeScript (strict), Tailwind CSS 4, Supabase (`@supabase/ssr`, `@supabase/supabase-js`), Recharts. Deployed on Vercel.
- Repo root: the Python scraper and report pipeline (`main.py`, `generate_weekly_report.py`, `send_weekly_email.py`), run by cron through `run_scraper.sh` every 4 hours.
- `migrations/`: numbered SQL migrations, applied by hand in the Supabase SQL editor, in order. `schema.sql` is a reference snapshot, not the source of truth.

## Data flow

```
TCGPlayer -> main.py -> Supabase Postgres -> Next.js server components and route handlers -> browser
Bank of Canada -> main.py -> exchange_rates -> CurrencyProvider (USD/CAD display)
main.py (after a run that wrote data) -> POST /api/revalidate (x-revalidate-secret) -> cached pages refresh
```

## Supabase clients: which one to use

| Code | Use | Session |
| --- | --- | --- |
| Route handler (`app/api/**/route.ts`) | `createRouteSupabaseClient()` from `app/lib/routeSupabase.ts` | The caller's, from HttpOnly cookies. The only way to read or write user tables (`profiles`, `portfolios`, `portfolio_holdings`, `portfolio_lots`, `box_recipes`). |
| `proxy.ts`, `app/auth/callback/route.ts` | `createRequestSupabaseClient(request)` from `app/lib/requestSupabase.ts`, then `return applyTo(response)` | The caller's. Cookies Supabase sets are written, hardened, onto the response you return. |
| Cached public market data on the server | the private factory inside `app/lib/serverMarketData.ts` (functions wrapped in `unstable_cache`, tags from `app/lib/cacheTags.ts`) | None (anonymous). |
| Client components | `await getSupabase()` from `app/lib/supabaseLoader.ts` | None, ever: session cookies are HttpOnly. Public tables and RPCs only. Never import `app/lib/supabase.ts` directly. |

All clients are typed with `Database` from `app/types/database.ts`. That file is generated: never edit it; after applying a migration run `pnpm types:db` (needs `SUPABASE_ACCESS_TOKEN`) and commit the result. Do not cast query results (`as T`, `as unknown as T`); annotate instead (`const rows: HoldingWithProduct[] = data ?? [];`) so the compiler checks the select string against the type. `any` is a lint error.

ESLint enforces the table above: `@supabase/ssr` and `createClient` may only be imported by the factory modules, and user-table queries (`.from("portfolios")` and friends) are rejected outside `app/api/**` and `app/lib/server/**`.

## Route handler pattern

Copy `app/api/account/export/route.ts` or a route under `app/api/portfolio/`:

1. `rejectIfCsrfFails(req)` for every state-changing method (header `x-pokefin-request: 1` plus an allowlisted Origin), or `rejectIfNotAppRequest(req)` for a GET that returns private data. Both live in `app/lib/csrf.ts`; never re-implement them.
2. `rejectIfBodyTooLarge(req, maxBytes)`.
3. `const supabase = await createRouteSupabaseClient();`, then resolve the user with `requireRouteUser(supabase)` from `app/lib/routeAuth.ts` (401 when signed out, 503 when Supabase could not answer).
4. Parse input with the shared validators (`app/lib/validation.ts`, `app/lib/portfolioInput.ts`, `app/lib/boxRecipes.ts`). Queries on user tables live in `app/lib/server/`.
5. Log through `app/lib/logger.ts` (`logSupabaseError`, `logCaughtError`, `logHttpFailure`, `logWarning`); `console.*` is a lint error. Never return raw Supabase error text. Private responses send `Cache-Control: no-store`.

The browser calls these routes with the header `x-pokefin-request: 1` (see `FETCH_HEADERS` in `app/context/AuthContext.tsx`).

## Shared modules (use them, do not re-implement)

- `app/types/market.ts`, `app/types/portfolio.ts`: domain types. `app/lib` never imports from `app/components`.
- `app/lib/format.ts`: every user-visible date, timestamp and money string (`formatMoney`, `formatDateOnly`, `formatTimestamp`, `formatInteger`). No `toLocaleDateString`, no `toFixed` for money, no `Intl` formatters built in components.
- `app/lib/marketMath.ts`: returns, volatility, drawdown, CAGR and release-date math.
- `app/lib/priceGuard.ts` and `app/lib/marketPulse.ts`: whether a price is current. A withheld price is `null` and renders as `--`, never `$0.00`.
- `app/lib/currency.ts` and `app/context/CurrencyContext.tsx`: prices are stored in USD. `useCurrency()` gives the visitor's display currency (remembered across pages), the rate, `convertPrice` and `formatPrice`. The only fallback rate is `DEFAULT_EXCHANGE_RATE` in `app/lib/currency.ts`. Pages whose currency comes from somewhere else (`/prices` from `?currency=`, a loaded box recipe) use `useCurrencyConversion(initialCurrency)`.
- `app/lib/csv.ts`: CSV parsing. `app/lib/redirects.ts`: safe `next=` targets.

## Components

Feature folders under `app/components/<Feature>/` hold `hooks/`, `cards/`, `controls/`, `shared/`, `utils/` and `__tests__/`. There are no component barrels: import the file you need. Put `"use client"` only on components and hooks that need it; a plain module that must stay in the browser starts with `import "client-only"`, one that must stay on the server with `import "server-only"`.

Styling: Tailwind CSS 4, mobile first, `md:` for desktop variants (`p-3 md:p-6`). Brand colours are CSS variables in `app/globals.css` (`--pf-*`).

## Testing and checks

Frontend, from `frontend/`:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm run lint          # blocking in CI
pnpm test --ci
pnpm build:stub        # production build against a local Supabase stub; CI runs it on every PR
```

Tests live in `__tests__/` next to the code. Route handler, proxy and server-module tests start with `/** @jest-environment node */` (`next/server` fails under jsdom). Mock `app/lib/routeSupabase` (or `@supabase/ssr` plus `next/headers`) instead of calling Supabase. `jest.mock` factories may only reference variables whose names start with `mock`. Components that call `useCurrency()` work without a provider (defaults: CAD, `DEFAULT_EXCHANGE_RATE`); wrap them in `CurrencyProvider` when a test changes the currency.

Python, from the repo root in a virtualenv with `requirements.txt`:

```bash
python -m pytest tests/ -q
```

Python logging: module-level `logger = logging.getLogger(__name__)`.

## Environment variables

Frontend (Vercel): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_SENTRY_DSN` (optional), `REVALIDATE_SECRET`.

Scraper host: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REVALIDATE_URL`, `REVALIDATE_SECRET`. `secrets_loader.py` reads the environment first and falls back to a gitignored `secretsFile.py` for local development only.

Type generation (local or CI secret): `SUPABASE_ACCESS_TOKEN`.
````

6.3. `/home/user/Pokefin/audits/HARDENING_FOLLOWUPS.md`, section 7 ("Round-2 follow-ups"): add a bullet after the ones earlier packages added:

```markdown
- **Architecture cleanup (review 2026-09-25, WP20).** Deleted
  `frontend/app/lib/serverSupabase.ts` (closes audits/authentication-flow.md
  F-15). Server-side Supabase clients are now built in exactly three places:
  `routeSupabase.ts` (route handlers), `requestSupabase.ts` (proxy.ts and
  /auth/callback) and `serverMarketData.ts` (anonymous cached market data);
  `/api/account/delete` and `/api/account/export` use the shared
  `lib/csrf.ts` gate. ESLint (`@typescript-eslint/no-restricted-imports`)
  rejects any other `@supabase/ssr` or `createClient` import. All clients are
  typed with the generated `frontend/app/types/database.ts`; regenerate it
  with `pnpm types:db` after every migration (the "Database types" workflow
  reports drift).
```

Also check section 4: if it still says `frontend/middleware.ts`, change it to `frontend/proxy.ts` (F109; WP02 step 18 should already have done this).

## Pitfalls: do not do this

- **Do not use `createRouteSupabaseClient()` in `proxy.ts` or the callback.** F034 verifier: both write cookies onto a `NextResponse` they build; `cookies()` from `next/headers` would write to a different response. Use `createRequestSupabaseClient` and `applyTo`.
- **Do not write cookies onto the response inside `setAll`** in the new helper. The response is decided after the Supabase call (pass-through or redirect), and WP02's callback already depends on collect-then-apply. Writing early is exactly how a rotation got lost on the proxy's redirect (audit session-cookie F-5).
- **Do not drop `hardenCookieOptions`** anywhere cookies are written, and do not change `cookieOptions.ts`.
- **Do not change status codes, bodies or the order of checks in the account routes.** WP17's delete-route test and WP01's export-route test pin them and must pass without edits.
- **Do not simply delete `"use client"` from `exchangeRate.ts` and `clientMarketData.ts`** (F048 verifier correction 2). Replace it with `import "client-only"`; without any marker a future server import would silently run the anonymous browser client on the server.
- **Do not move the types by hand-editing 60 import lines.** Use the codemod (it resolves each specifier, so it cannot miss `../types` spellings inside the feature folders), then read the diff.
- **Do not delete the two shims in this PR.** The plan keeps them for one release for in-flight branches (ProductPrices/types had 32 importers at `a188fea`); ESLint already blocks new uses.
- **Do not read `localStorage` in `useState` initialisers or during render** for the currency. It differs between server and client and causes a hydration mismatch (F051 verifier). `useSyncExternalStore` with a `null` server snapshot is the pattern.
- **Do not make `/prices` follow the stored preference, and do not call `useCurrency().setCurrency` during render.** `/prices` keeps `?currency=` as its source of truth (F051 verifier); WP08's URL-to-state block calls the page-local `setSelectedCurrency` during render, which is only legal for the component's own state. Remember the preference only in click handlers.
- **Do not let a loaded or shared box recipe change the visitor's preference.** `loadRecipeIntoState` uses only the page-local setter.
- **Do not import `app/lib/exchangeRate.ts` statically from `CurrencyContext.tsx`.** The provider is in the root layout; a static import would pull the rate fetcher (and, without WP12, supabase-js) into every page's initial bundle.
- **Do not replace `MarketSummaryRow`, `ProductVolumeMetrics` or other hand-written RPC row types with the generated `Functions[...]["Returns"]` type.** The generator cannot see function output nullability; the hand-written types are more precise. Annotate assignments into them instead.
- **Do not remove the array-or-object normalisation from `mapProductsQueryResultToProducts`** (F047 verifier correction), even though the typed client infers objects.
- **Do not hand-write or edit `app/types/database.ts`.** Only `pnpm types:db` writes it. A hand-written file is a fourth hand-maintained shape, which is the problem F047 describes.
- **Do not add `eslint-disable` for `no-explicit-any` or `no-restricted-imports`** to get green.
- **Do not put the drift check in `ci.yml`.** It depends on the production schema, which changes when the owner applies a migration, not when a PR changes; it must not block unrelated pull requests.
- **Do not redo other packages' work**: `/analytics` redirect (WP13), `deleteLoading` (WP15/WP17), CI pnpm pin (WP00), `delete` route logging beyond the one fallback line (WP17).

## Tests

Route, proxy and server-module tests need `/** @jest-environment node */` as the first line. `jest.mock` factories may only reference variables whose names start with `mock`, read lazily (`(...a) => mockFn(...a)`).

### 1. `app/lib/__tests__/requestSupabase.test.ts` (new)

```ts
/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };
type CookieMethods = {
  getAll: () => Array<{ name: string; value: string }>;
  setAll: (cookies: CookieToSet[], headers?: Record<string, string>) => void;
};

let mockCookieMethods: CookieMethods | undefined;
const mockCreateServerClient = jest.fn();
jest.mock("@supabase/ssr", () => ({
  createServerClient: (url: string, key: string, opts: { cookies: CookieMethods }) => {
    mockCookieMethods = opts.cookies;
    mockCreateServerClient(url, key);
    return { marker: "client" };
  },
}));

import { createRequestSupabaseClient } from "../requestSupabase";

function request() {
  return new NextRequest("https://pokefin.ca/portfolio", {
    headers: { cookie: "sb-stub-auth-token=v0" },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCookieMethods = undefined;
});

it("reads the request cookies", () => {
  createRequestSupabaseClient(request());
  expect(mockCookieMethods!.getAll()).toEqual([
    expect.objectContaining({ name: "sb-stub-auth-token", value: "v0" }),
  ]);
});

it("writes nothing when Supabase set nothing", () => {
  const { applyTo } = createRequestSupabaseClient(request());
  const res = applyTo(NextResponse.next());
  expect(res.headers.get("set-cookie")).toBeNull();
});

it("writes collected cookies hardened and the no-cache headers onto the chosen response", () => {
  const { applyTo } = createRequestSupabaseClient(request());
  mockCookieMethods!.setAll(
    [{ name: "sb-stub-auth-token", value: "rotated", options: { httpOnly: false, maxAge: 100 } }],
    { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" }
  );
  const res = applyTo(NextResponse.redirect("https://pokefin.ca/auth/login"));
  expect(res.status).toBe(307);
  expect(res.cookies.get("sb-stub-auth-token")).toMatchObject({
    value: "rotated",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 100,
  });
  expect(res.headers.get("cache-control")).toContain("no-store");
});
```

Remaining cases: two `setAll` calls for the same cookie name leave the second value on the response; `setAll` called with one argument (no headers) does not throw and sets no `cache-control`; with `NEXT_PUBLIC_SUPABASE_URL`/`KEY` deleted from `process.env`, `mockCreateServerClient` receives `"https://placeholder.supabase.invalid"` and `"placeholder-key"`, and with them set it receives the set values (read at call time: set them after the import). Add one `describe("supabaseEnv")` in the same file for `hasSupabaseEnv()` (false when either variable is missing or empty, true when both are set).

### 2. `app/context/__tests__/CurrencyContext.test.tsx` (new, jsdom)

```tsx
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import {
  CURRENCY_STORAGE_KEY,
  CurrencyProvider,
  _resetCurrencyPreferenceForTests,
  useCurrency,
} from "../CurrencyContext";

const mockFetchRate = jest.fn();
jest.mock("../../lib/exchangeRate", () => ({
  fetchLatestExchangeRateClient: (...a: unknown[]) => mockFetchRate(...a),
}));
const mockLogCaughtError = jest.fn();
jest.mock("../../lib/logger", () => ({
  logCaughtError: (...a: unknown[]) => mockLogCaughtError(...a),
  logSupabaseError: jest.fn(),
}));

const REAL = { rate: 1.4, date: "2026-09-01T00:00:00" };
const FALLBACK = { rate: 1.36, date: null };

function Probe() {
  const c = useCurrency();
  return (
    <div>
      <span data-testid="currency">{c.currency}</span>
      <span data-testid="rate">{c.exchangeRate}</span>
      <span data-testid="loading">{String(c.exchangeRateLoading)}</span>
      <span data-testid="price">{c.formatPrice(10)}</span>
      <button onClick={() => c.setCurrency("USD")}>usd</button>
    </div>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  _resetCurrencyPreferenceForTests();
});

it("uses the server rate and never fetches when the server had a real one", () => {
  render(<CurrencyProvider initialRate={REAL}><Probe /></CurrencyProvider>);
  expect(screen.getByTestId("rate")).toHaveTextContent("1.4");
  expect(screen.getByTestId("loading")).toHaveTextContent("false");
  expect(screen.getByTestId("price")).toHaveTextContent("C$14.00");
  expect(mockFetchRate).not.toHaveBeenCalled();
});

it("hydrates with the default, then applies the stored preference without a mismatch", async () => {
  window.localStorage.setItem(CURRENCY_STORAGE_KEY, "USD");
  function Minimal() {
    return <span>{useCurrency().currency}</span>;
  }
  const container = document.createElement("div");
  container.innerHTML = "<span>CAD</span>"; // what the server rendered
  document.body.appendChild(container);
  const onRecoverableError = jest.fn();
  await act(async () => {
    hydrateRoot(
      container,
      <CurrencyProvider initialRate={REAL}><Minimal /></CurrencyProvider>,
      { onRecoverableError }
    );
  });
  expect(container.textContent).toBe("USD");
  expect(onRecoverableError).not.toHaveBeenCalled();
});
```

Remaining cases:
- fallback seed (`FALLBACK`): first render `loading` "true" and rate 1.36; after `mockFetchRate` resolves `{ rate: 1.5, date: "2026-09-02" }`, rate 1.5 and `loading` "false"; `mockFetchRate` called once.
- fallback seed and `mockFetchRate` rejects: rate 1.36, `loading` "false", `mockLogCaughtError` called with `"exchange_rate_load_failed"`.
- a non-finite or non-positive seed rate (`{ rate: NaN, date: "x" }`, `{ rate: 0, date: "x" }`) shows 1.36.
- default currency is CAD; clicking "usd" shows USD in every consumer and writes `"USD"` to `localStorage[CURRENCY_STORAGE_KEY]`; unmounting and mounting a fresh provider shows USD.
- a stored `"EUR"` is ignored (CAD).
- `jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); })`: clicking "usd" still switches to USD.
- a `StorageEvent` dispatched on `window` with `key: CURRENCY_STORAGE_KEY, newValue: "USD"` switches consumers to USD (another tab).
- `render(<Probe />)` with no provider: CAD, 1.36, `loading` "false", and clicking "usd" changes nothing.

### 3. `app/lib/__tests__/currency.test.ts` (new)

`isCurrency` ("USD", "CAD" true; "EUR", null, undefined false); `usableRate` (1.4 stays; 0, -1, NaN, Infinity, null, undefined give 1.36); `convertUsd` (null, undefined and 0 give 0; `convertUsd(10, "CAD", 1.4)` is 14; USD returns the input); `formatUsdAs` (null, undefined, NaN give "--"; `formatUsdAs(1649.99, "CAD", 1)` is "C$1,649.99"; `formatUsdAs(10, "USD", 1.4)` is "$10.00"; `formatUsdAs(0, "USD", 1)` is "$0.00"); `DEFAULT_EXCHANGE_RATE` is re-exported unchanged by `../marketData`.

### 4. `app/components/ProductPrices/__tests__/useCurrencyConversion.test.tsx` (rewrite WP17's file)

Drop the `lib/exchangeRate` mock (the hook no longer fetches). Use `renderHook` with a `wrapper` that renders `<CurrencyProvider initialRate={{ rate: 1.4, date: "2026-09-01" }}>`, and call `_resetCurrencyPreferenceForTests()` plus `localStorage.clear()` in `beforeEach`. Cases:
- `useCurrencyConversion()` follows the preference: `selectedCurrency` "CAD", `exchangeRate` 1.4, `exchangeRateLoading` false. Render both hooks in one `renderHook` callback (`() => ({ page: useCurrencyConversion(), site: useCurrency() })`), call `act(() => result.current.site.setCurrency("USD"))`, and `result.current.page.selectedCurrency` becomes "USD".
- `useCurrencyConversion("USD")` stays "USD" when the preference is "CAD".
- `setSelectedCurrency("CAD")` changes only the hook: `localStorage.getItem(CURRENCY_STORAGE_KEY)` stays null.
- `convertPrice(10)` is 14 in CAD; `convertPrice(null)` is 0; `formatPrice(null)` is "--"; `formatPrice(10)` is "C$14.00"; after `setSelectedCurrency("USD")`, `formatPrice(10)` is "$10.00".
- Without a wrapper: `exchangeRate` 1.36, `selectedCurrency` "CAD".

### 5. `app/lib/__tests__/marketData.mapProducts.test.ts` (new)

`mapProductsQueryResultToProducts` with: object embeds (typed-client shape) map field for field; array embeds (`sets: [{...}]`, `generations: [{ id: 1, name: "SV" }]`, `product_types: [{...}]`) give the same `Product` as the object form; empty arrays and `null` embeds give `sets: null` / `product_types: null`; `url: null` and `last_updated: null` give `""`; `release_date: null` gives `""`; `label: null` gives `label: undefined`; `returns` is always `null`. Also `toSalesHistoryEntries` keeps "day" and "week" rows and drops a "month" row, and `groupHistoryRowsByProduct` skips rows with a null `product_id` or `recorded_at` and still sorts the rest ascending.

### 6. `app/portfolio/__tests__/page.currency.test.tsx` (new, jsdom)

Mock `next/navigation` (`useRouter: () => ({ push: jest.fn(), replace: jest.fn() })`), `../../context/AuthContext` with the same signed-in `useAuth` mock WP13's `app/portfolio/__tests__/page.redirect.test.tsx` uses, and `../../components/Portfolio/PortfolioDashboard` with `() => { const { useCurrency } = jest.requireActual("../../context/CurrencyContext"); return <p data-testid="dash">{useCurrency().currency}</p>; }`. Render the page inside `<CurrencyProvider initialRate={{ rate: 1.4, date: "2026-09-01" }}>`. Cases: the currency selector group shows "1 USD = 1.4000 CAD" and CAD pressed, the dashboard shows CAD; clicking the USD button presses it, the dashboard shows USD, and `localStorage` holds "USD".

### 7. Existing tests to update

- Every test that renders `ProductPrices`, `MarketView`, `RecentlyReleased` or `BoxCalculator` with an `initialExchangeRate` prop (for example WP08's `initialExchangeRate={1.36}`): delete the prop. `grep -rn "initialExchangeRate" app --include=*.test.tsx | grep -v compare` must print nothing afterwards. Their `jest.mock(".../lib/exchangeRate")` lines may stay (harmless) or go.
- Any test that renders `<PortfolioDashboard currency=... exchangeRate=...>`: drop the props, and wrap in `CurrencyProvider` if it asserts a CAD value.
- `app/lib/__tests__/supabaseLazyLoad.test.ts` (WP12): delete the `fetchSalesHistory` case (step 6.1).
- Tests whose imports the codemod rewrote need no other change.

### 8. Must pass unchanged

`app/api/account/delete/__tests__/route.test.ts`, `app/api/account/export/__tests__/route.test.ts`, `app/auth/callback/__tests__/route.test.ts`, `app/lib/__tests__/proxy.test.ts`, `app/lib/__tests__/proxy.rateLimit.test.ts`, `app/lib/__tests__/routeSupabase.test.ts`, `app/lib/__tests__/csrf.test.ts`, the WP05 and WP06 route tests, `app/components/BoxCalculator/__tests__/BoxCalculator.test.tsx` ("loading a recipe switches the display currency" now exercises the page-local override), and the Portfolio component tests (they pass `currency`/`exchangeRate` explicitly).

## Verification

From `frontend/`:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit                 # 0 errors
pnpm run lint                          # 0 errors (warnings allowed only where WP17 allowed them)
pnpm test --ci                         # all suites pass
pnpm test --ci app/lib/__tests__/requestSupabase.test.ts app/context app/lib/__tests__/currency.test.ts \
  app/lib/__tests__/marketData.mapProducts.test.ts app/components/ProductPrices/__tests__/useCurrencyConversion.test.tsx \
  app/portfolio app/api/account app/auth/callback app/lib/__tests__/proxy.test.ts app/lib/__tests__/routeSupabase.test.ts \
  app/lib/__tests__/csrf.test.ts
pnpm build:stub                        # succeeds; every page prerenders with the stub's fallback rate
```

Structural checks (each must print exactly what is stated):

```bash
# F034: one allowlist, client construction only in the factories
grep -rn "ALLOWED_ORIGINS\|function isAllowedOrigin" app --include=*.ts | grep -v __tests__   # only app/lib/csrf.ts
grep -rnE "create(Server|Browser)Client\(|createClient(<[^>]*>)?\(" app proxy.ts --include=*.ts --include=*.tsx | grep -v __tests__
# only: lib/supabase.ts, lib/routeSupabase.ts, lib/requestSupabase.ts, lib/serverMarketData.ts
# F047
grep -rnE "as unknown as|as any\b|: any\b|any\[\]|<any>" app proxy.ts --include=*.ts --include=*.tsx | grep -v __tests__   # nothing
grep -n "no-explicit-any" eslint.config.mjs                                                          # nothing
grep -c "<Database>" app/lib/supabase.ts app/lib/routeSupabase.ts app/lib/requestSupabase.ts app/lib/serverMarketData.ts   # 1 each
# F048
grep -rnE "from \"(\.\./)+components/" app/lib --include=*.ts | grep -v __tests__                 # nothing
grep -rn "^\"use client\"" app/lib                                                                 # nothing
grep -rln "import \"client-only\"" app/lib                                                         # exchangeRate.ts, clientMarketData.ts
# F051
grep -rnE "1\.3[56]\b" app --include=*.ts --include=*.tsx | grep -v __tests__ | grep -v 'd="'     # only app/lib/currency.ts
# F107
ls app/components/ExchangeRateService.ts app/components/Portfolio/index.ts app/lib/serverSupabase.ts 2>&1 | grep -c "No such file"   # 3
grep -rn "fetchSalesHistory\|salesHistoryCache\|searchProductsBySet\|formatScore\|createServerSupabaseClient" app   # nothing
```

Lint probe (then delete the probe files): create `app/api/zz-probe/route.ts` containing `import { createServerClient } from "@supabase/ssr"; export const x = createServerClient;` and `app/lib/zzProbe.ts` containing `import type { Product } from "../components/ProductPrices/types"; import { sortProducts } from "../components/ProductPrices/utils/sorting"; export type P = Product; export const f = sortProducts;`. `pnpm exec eslint app/api/zz-probe app/lib/zzProbe.ts` must report all three imports: the `@supabase/ssr` one with the factory message, the `ProductPrices/types` one with the types-moved (or `components/`) message, and the `utils/sorting` one with the `app/lib must not depend on app/components` message. Delete both files.

Manual checks (`pnpm dev` with a real `.env.local`, or against the Vercel preview):

1. With cleared site data, open `/market`: currency CAD. Choose USD. Open `/box-calculator`: USD. Sign in and open `/portfolio`: the page shows the shared currency selector with USD pressed and the rate text "1 USD = x.xxxx CAD"; values are in USD. Reload each page: still USD. DevTools console shows no hydration warning on any of them.
2. Open `/prices?currency=CAD` while the preference is USD: `/prices` shows CAD (the URL wins). Click USD then CAD on `/prices`, then open `/market`: CAD (the click became the preference).
3. On `/box-calculator` with preference USD, load a saved or shared recipe typed in CAD: the calculator switches to CAD; `/market` is still USD.
4. Open `/market` in two tabs, change the currency in one: the other follows without a reload.
5. DevTools, Application, Local Storage: key `pokefin.currency` holds the last choice.
6. Sign-in by email link: click a confirmation or reset link; you land on the right page, signed in; the `sb-*-auth-token` cookie is HttpOnly. Visit `/portfolio` signed out: redirect to `/auth/login?next=%2Fportfolio`.
7. `/account`: "Export my data" downloads the JSON; delete-account flow still works on a throwaway account. `curl -s -X POST https://<preview>/api/account/export -H "x-pokefin-request: 1" -H "origin: https://evil.example" -o /dev/null -w "%{http_code}\n"` prints `403`.
8. `/compare`: with the rate loaded the page shows the same numbers as before; its fallback is now 1.36.

## Owner actions

1. **Generate the database types (needed before step 4).** Prerequisite: every migration on master has been applied in Supabase (the Owner actions of WP01, WP06, WP10 and WP16 are done). Create a personal access token at supabase.com, Account, Access Tokens, "Generate new token" (name it `pokefin-types`). Then, in a checkout of the WP20 branch:

   ```bash
   cd frontend
   SUPABASE_ACCESS_TOKEN=<token> pnpm dlx supabase@2.118.0 gen types --lang typescript --project-id tyrhvavwvphazpmwluft --schema public > app/types/database.ts
   git add app/types/database.ts && git commit -m "chore(types): generate Supabase Database types" && git push
   ```

   Alternatives if the CLI is not an option: the Supabase dashboard, Project Settings, API, "Generate types" (TypeScript, schema `public`), or the Supabase MCP `generate_typescript_types` tool; save the output verbatim as `frontend/app/types/database.ts`. Confirm: `grep -c "export type Database = " frontend/app/types/database.ts` prints `1`, and `grep -cE "get_portfolio_history|product_price_pending" frontend/app/types/database.ts` prints at least `2`.
2. **Enable the drift check (optional, recommended).** GitHub, repository Settings, Secrets and variables, Actions, "New repository secret": name `SUPABASE_ACCESS_TOKEN`, value the token from item 1 (or a dedicated one). Confirm: Actions, "Database types", "Run workflow" on master finishes green; without the secret it finishes green with the notice "SUPABASE_ACCESS_TOKEN is not set".
3. **From now on, after applying any migration**, run `pnpm types:db` from `frontend/` and commit the result in the PR that uses the new schema (or immediately after, if the migration shipped alone).

No database migration and no Vercel environment change is part of this package.

## Acceptance criteria

- [ ] `api/account/delete` and `api/account/export` call `rejectIfCsrfFails`, `rejectIfBodyTooLarge(request, 1024)` and `createRouteSupabaseClient()`; neither file declares an origin allowlist or calls `createServerClient`.
- [ ] `proxy.ts` and `app/auth/callback/route.ts` build their client with `createRequestSupabaseClient` and return `applyTo(...)`; neither imports `@supabase/ssr` or `hardenCookieOptions`.
- [ ] `app/lib/serverSupabase.ts`, `app/components/ExchangeRateService.ts` and `app/components/Portfolio/index.ts` no longer exist.
- [ ] `app/types/database.ts` is generated (not hand-edited) and all four factories pass `<Database>`.
- [ ] No `as unknown as`, `as any`, `: any` or `any[]` remains in non-test code under `app/` or in `proxy.ts`; `eslint.config.mjs` no longer turns `no-explicit-any` off; `pnpm run lint` has 0 errors.
- [ ] `mapProductsQueryResultToProducts` takes `ProductsQueryRow[]` and still normalises array embeds.
- [ ] `app/types/market.ts` and `app/types/portfolio.ts` hold the domain types; the old paths are one-line `@deprecated` re-export shims; no module in `app/lib` imports from `app/components`.
- [ ] `exchangeRate.ts` and `clientMarketData.ts` start with `import "client-only"`; no file in `app/lib` has `"use client"`.
- [ ] `PriceChart.tsx` imports `Currency` and `PriceHistoryEntry` from `app/types/market.ts`.
- [ ] `DEFAULT_EXCHANGE_RATE` is defined once (`app/lib/currency.ts`) and no other `1.35`/`1.36` literal remains in non-test code.
- [ ] The root layout renders `CurrencyProvider` with the server rate; `/market`, `/portfolio` and `/box-calculator` share one remembered currency; `/prices` follows `?currency=` and a click there updates the shared preference; no hydration warning appears.
- [ ] `/portfolio` renders the shared `CurrencySelector`; `PortfolioDashboard` takes no currency props.
- [ ] `fetchSalesHistory`, its caches, `searchProductsBySet` and `formatScore` are gone.
- [ ] `.github/copilot-instructions.md` matches the checklist in step 6.2 (every named path exists).
- [ ] `HARDENING_FOLLOWUPS.md` section 7 records the WP20 cleanup and F-15.
- [ ] `.github/workflows/db-types.yml` exists and `package.json` has `types:db`.
- [ ] `tsc`, lint, the full jest suite and `pnpm build:stub` pass.

## Rollback

No migrations, no data changes. Revert the merge commit (`git revert -m 1 <merge-sha>`) and redeploy. After a revert:

- The `pokefin.currency` localStorage entry left in visitors' browsers is ignored by the old code; nothing to clean up.
- The "Database types" workflow file is removed by the revert; the `SUPABASE_ACCESS_TOKEN` secret can stay or be deleted in repository settings.
- If only one part misbehaves in production, prefer a targeted revert: the currency work is steps 3.x (layout, `CurrencyContext.tsx`, `useCurrencyConversion.ts` and its callers); the cookie helper is steps 1.3 to 1.5 (`requestSupabase.ts`, `proxy.ts`, callback). The type work (step 4) has no runtime effect beyond the mapper in 4.4e and the null-row guards in 4.4c.

## Commit and PR

Suggested commits (one per finding keeps review easy; squash on merge is fine):

```
refactor(auth): account routes use lib/csrf and routeSupabase; one response-cookie helper for proxy and callback (F034)
refactor(types): move domain types to app/types, client-only markers, drop dead modules (F048)
feat(currency): site-wide CurrencyProvider seeded by the layout; one DEFAULT_EXCHANGE_RATE (F051)
refactor(db): generated Database types on every Supabase client; typed row boundaries; no-explicit-any on (F047)
docs: rewrite copilot-instructions for the current architecture; remove dead code (F107)
```

PR title: `WP20: typed Supabase clients, shared currency preference, one CSRF gate, current docs`

PR body summary: what was wrong (CSRF gate and cookie client copied into the account and callback routes and already drifted; untyped Supabase clients with `as unknown as` at every row boundary; lib depending on component-folder types; currency re-defaulted to 1.36/1.35 in 13 places and forgotten between pages; contributor docs describing a dead architecture). What changed, per finding, with the visible changes called out: `/portfolio` now opens in the visitor's remembered currency (CAD by default) instead of always USD; `/compare`'s fallback rate is 1.36 instead of 1.35; responses where the proxy refreshed a session now carry `Cache-Control: no-store`; every page now reads the cached exchange rate in the root layout. Paste the Verification output. List Owner actions 1 to 3. Note the two `@deprecated` type shims to delete next release, and any out-of-scope item found in 6.1.
