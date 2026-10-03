# WP17: Zero lint errors, critical-path tests, observability, blocking CI

- **Findings covered**
  - F056 (full; members F039, F065, F114, F120; severity low, re-verified 2026-09-30): five components are declared inside render (HoldingsTable `SortButton`, the `CustomTooltip` in `AllocationChartImpl.tsx:83` and `PortfolioChartImpl.tsx:93`, plus PriceChart's `CustomTooltip`/`CustomDot` at `PriceChart.tsx:466`/`:494`, used at `:662`/`:714`, which lint misses behind `memo()`). Lint reports seven `react-hooks/static-components` errors for them (five `SortButton` usages plus the two chart tooltips). The only user-visible effect is on `/portfolio`: every sort click remounts the five sort buttons, so a keyboard or screen-reader user loses focus to `<body>` and must tab back to flip the direction. The chart sites have no visible effect (those components hold no hover state and re-render only when chart props change, and Recharts 3 tracks hover in its own store); they are hoisted to clear the lint errors and keep one pattern.
  - F050 (full; member F042): `proxy.ts`, `csrf.ts`, `cookieOptions.ts`, `routeSupabase.ts`, the account delete route, `matchProduct`, `calculateNav` and MarketView's row derivation have no tests; `proxy.ts` is outside `collectCoverageFrom` and every `page.tsx` (including client pages) is excluded from coverage.
  - F108 (full; member F049; severity low, re-verified 2026-09-30: no visitor-facing effect, and 14 of the original 15 `{ code }` sites run in the browser, so today no handled error reaches the owner anywhere): raw `console.*` calls bypass `app/lib/logger.ts`, `no-console` is not enforced, the promised Sentry hook in the logger was never written, and there is no `instrumentation.ts`, so the server and edge Sentry configs never load (and under Turbopack `sentry.client.config.ts` never loads either).
  - N03 (completeness review after the audit; both verifiers confirmed it, one rated it low because no DSN is set yet and Vercel runtime logs still show server errors): Sentry never initialises, because the repo has no `instrumentation.ts` or `instrumentation-client.ts` and Turbopack builds ignore `sentry.client.config.ts`. Same defect as F108's Sentry part; step 5 closes it in full: `instrumentation.ts` with `register()` loading the server and edge configs by `NEXT_RUNTIME` and `onRequestError` calling `Sentry.captureRequestError` (5a), `instrumentation-client.ts` replacing `sentry.client.config.ts` (5b, 5c), the shared `beforeSend` scrubber on all three runtimes, edge included (5e), the Sentry ingest origin in `connect-src` (F128, step 6) and the corrected `HARDENING_FOLLOWUPS.md` setup note (6d). Tests: `instrumentation.test.ts` (test 13); acceptance: the `instrumentation*.ts` items below. Not in this package: N03's separate UX item, making "Try again" in `error.tsx` and `global-error.tsx` refetch server data (`router.refresh()` with `reset()` inside `startTransition`); the verifiers split it off and the plan assigns it to WP38.
  - F128 (full): CSP `connect-src` has no Sentry ingest origin, so browser events would be blocked the moment a DSN is set; `'unsafe-inline'` in `script-src` is undocumented; no CSP violation is ever reported anywhere (the verifiers' corrected recommendation: report from the enforced policy, not from a strict Report-Only one).
  - F076 (partial; members F037, F052, F064, F139; severity medium, re-verified 2026-09-30): only the remaining part, "make lint blocking once clean". The build gate, the pnpm pin and the branch-protection owner actions (required CI checks, optional required Vercel preview) were WP00. The lint errors are fixed in code, never silenced: the re-verification allowed targeted `eslint-disable` for the `set-state-in-effect` sites, but this spec keeps the stricter rule (see Pitfalls). `--max-warnings=0` stays off.
- **Priority rationale**: this is the last gate before the large refactors (WP18 to WP21), so it turns lint and the critical-path tests into merge blockers first and makes production errors observable before code starts moving.
- **Effort**: L (about 11 hours: lint fixes 2 h, logger, Sentry wiring and event scrubbing 3 h, tests 5 h, config and verification 1 h).
- **Depends on**: WP05, WP06, WP09, WP14 (they remove most of the set-state-in-effect errors and rewrite the files whose `console.*` calls this package converts). Also assumes WP00 (`pnpm build:stub`, which sets `NEXT_PUBLIC_SENTRY_DSN=""` for the build), WP01 (export route test), WP02 (`proxy.rateLimit.test.ts`, auth route tests), WP05 (`rejectIfNotAppRequest` in `csrf.ts`, `import.holdings.test.ts` covering `importHoldings` and `processCollectrImport`), WP06 (`useBoxRecipes.ts` already imports `logCaughtError`), WP07 (`app/lib/format.ts` with `formatMoney`), WP11 (`VolumeMetricsSummary`: `useVolumeMetrics` returns `Record<number, VolumeMetricsSummary>`, which is why `buildRows.ts` types the volume argument as a `Pick`), WP13 (`app/auth/login/page.tsx` is a server component) and WP15 (CardRinkPromo rewrite, `deleteLoading` put to use, SortButton `aria-pressed`) have merged; the plan runs packages in order.
- **Unblocks**: WP18 and WP19 (they refactor MarketView and the market math under blocking lint and on top of the `buildRows.ts` module and tests added here; WP19's "extract buildRows.ts" step is done by this package), WP20 (the new delete-route and `csrf.ts` tests guard its CSRF dedupe, F034), WP21. Every later PR is lint-gated.
- **Suggested branch name**: `remediation/wp17-lint-tests-observability-ci-gate`
- **Risk level**: low. Runtime changes are limited to component identity (same markup), a hook that derives instead of syncing state, and Sentry/CSP code paths that stay inert until the owner sets a DSN.

## Why

`pnpm run lint` fails with 16 errors today (33 problems at commit `a188fea`), and CI ignores it (`.github/workflows/ci.yml:31-33`, `continue-on-error: true`), so real bugs ship: on `/portfolio` a keyboard user who presses Enter on a sort button loses focus because the button is a new component type on every render (`HoldingsTable.tsx:79`). The code that mints session cookies, gates CSRF, deletes accounts, matches imported holdings and prices box recipes has no regression tests, and the coverage report cannot even see `proxy.ts`. Error reporting is wired only on paper: handled errors are logged with ad hoc `console.error(label, { code })` shapes that drop the message, `logger.ts` never calls Sentry, and without `instrumentation.ts` Sentry never starts on the server; if the owner set a DSN today, the browser SDK would not start under Turbopack and the CSP would block its requests anyway. After this PR lint has zero errors and blocks merges, the critical paths have tests, every log line goes through the logger, and setting one Vercel variable turns on working error reporting.

## Before you start

Read these files fully:

- `frontend/eslint.config.mjs` (after WP04 to WP07 it has `ANON_CLIENT_FORBIDDEN_FILES`, `no-restricted-imports`, `no-restricted-syntax` and `no-restricted-properties` blocks)
- `frontend/jest.config.js`, `.github/workflows/ci.yml`
- `frontend/app/lib/logger.ts`, `frontend/app/lib/__tests__/logger.test.ts`
- `frontend/sentry.client.config.ts`, `frontend/sentry.server.config.ts`, `frontend/sentry.edge.config.ts`, `frontend/next.config.ts`, `frontend/app/error.tsx`, `frontend/app/global-error.tsx`, `frontend/.env.example`, `audits/HARDENING_FOLLOWUPS.md` (section 7, lines 181-184)
- `frontend/proxy.ts`, `frontend/app/lib/cookieOptions.ts`, `frontend/app/lib/csrf.ts`, `frontend/app/lib/routeSupabase.ts`, `frontend/app/lib/rateLimit.ts`
- `frontend/app/api/account/delete/route.ts`, `frontend/app/api/account/export/__tests__/route.test.ts` (WP01, the pattern to copy)
- `frontend/app/components/Portfolio/cards/HoldingsTable.tsx`, `frontend/app/components/charts/AllocationChartImpl.tsx`, `frontend/app/components/charts/PortfolioChartImpl.tsx`, `frontend/app/components/PriceChart.tsx`
- `frontend/app/components/ProductPrices/hooks/useCurrencyConversion.ts`
- `frontend/app/components/BoxCalculator/BoxCalculator.tsx` (only `calculateNav` and its call site), `frontend/app/components/BoxCalculator/types.ts`
- `frontend/app/lib/import.ts` (`matchProduct` and helpers), `frontend/app/lib/__tests__/import.test.ts`
- `frontend/app/components/MarketView/MarketView.tsx` (constants at the top, `getReleaseMs`, the `rows` useMemo), `frontend/app/components/MarketView/returns.ts`

Confirm the starting state (run from `frontend/`):

```bash
pnpm install --frozen-lockfile

# 1. Dependencies merged. Expect every file to exist.
ls app/api/account/export/__tests__/route.test.ts app/lib/__tests__/proxy.rateLimit.test.ts \
   app/api/auth/__tests__/routes.test.ts app/lib/__tests__/import.holdings.test.ts app/lib/format.ts
grep -n "export function formatMoney" app/lib/format.ts            # WP07, expect 1 hit
grep -n "_resetRateLimitStoreForTests" app/lib/rateLimit.ts        # expect 1 hit

# 2. Record the lint baseline (errors exit non-zero; that is expected here).
pnpm exec eslint . -f json -o /tmp/wp17-lint-before.json || true
node -e 'const r=require("/tmp/wp17-lint-before.json");for(const f of r)for(const m of f.messages)console.log((m.severity===2?"ERROR ":"warn  ")+f.filePath.replace(process.cwd()+"/","")+":"+m.line+"  "+(m.ruleId||"unused-directive"))' | sort

# 3. Raw console calls outside the logger.
grep -rn "console\.\(log\|info\|warn\|error\|debug\)" app proxy.ts --include=*.ts --include=*.tsx \
  | grep -v "/__tests__/" | grep -v "^app/lib/logger.ts"

# 4. Sentry wiring gaps. Expect: no instrumentation files; sentry.client.config.ts exists;
#    logger.ts has no "sentry"; connect-src has no sentry host; lint is continue-on-error.
ls instrumentation*.ts 2>&1; ls sentry.*.config.ts
grep -ci sentry app/lib/logger.ts
grep -n "connect-src" next.config.ts
grep -n "continue-on-error" ../.github/workflows/ci.yml

# 5. Coverage config: expect 'app/**/*' and '!app/**/page.tsx', no 'proxy.ts'.
grep -n "collectCoverageFrom" -A6 jest.config.js

# 6. Test-suite baseline. Write the "Test Suites: N passed" number down; the
#    Verification section compares against it.
pnpm test --ci 2>&1 | grep -E "^Tests?( Suites)?:" | tee /tmp/wp17-jest-before.txt

# 7. Dependencies this spec relies on by name. Expect 1 hit each.
grep -n "export function rejectIfNotAppRequest" app/lib/csrf.ts                 # WP05
grep -n "export type VolumeMetricsSummary" app/components/ProductPrices/types/index.ts  # WP11
grep -n 'from "../../../lib/logger"' app/components/BoxCalculator/hooks/useBoxRecipes.ts  # WP06
```

Expected lint residue from step 2 if WP00 to WP16 landed as specified (at `a188fea` there were 16 errors and 17 warnings; the other packages remove most of them):

| File | Rule | Owner | Handled in |
| --- | --- | --- | --- |
| `Portfolio/cards/HoldingsTable.tsx` (x5) | react-hooks/static-components (error) | WP17 | step 7 |
| `charts/AllocationChartImpl.tsx` | react-hooks/static-components (error) | WP17 | step 8 |
| `charts/PortfolioChartImpl.tsx` | react-hooks/static-components (error) | WP17 | step 8 |
| `ProductPrices/hooks/useCurrencyConversion.ts` | react-hooks/set-state-in-effect (error) | WP17 | step 9 |
| `lib/supabase.ts`, `lib/serverSupabase.ts`, `lib/serverMarketData.ts` | unused `no-console` directive (warn) | WP17 | step 3 |
| `lib/validation.ts` | unused `no-control-regex` directive (warn) | WP17 | step 10 |
| `auth/signup/page.tsx` `router`, `stats/page.tsx` `formatScore`, `Portfolio/__tests__/HoldingsTable.test.tsx` `within` | no-unused-vars (warn) | WP17 | step 10 |
| `eslint.config.mjs` | import/no-anonymous-default-export (warn) | WP17 | step 4 |
| `<img>` in the Portfolio cards/modals and `ProductSearchSelect.tsx` | @next/next/no-img-element (warn) | accepted | leave (see Pitfalls) |

These must already be gone. If one is still present, see step 10's fallback rules: `account/page.tsx` (WP04), `AddHoldingModal.tsx` and `EditHoldingModal.tsx` (WP05, WP14), `usePortfolioData.ts` and `useProductSearch.ts` (WP05), `CardRinkPromo.tsx` (WP15), `BoxCalculator.tsx` `recipesLoading` and exhaustive-deps (WP06), `PortfolioDashboard.tsx` `deleteLoading` (WP15), `ProductCard.tsx` `historyLoading` (WP09).

Expected raw console sites from step 3 (after WP04 to WP06): three `console.error(label, { status: res.status })` calls in `app/components/BoxCalculator/hooks/useBoxRecipes.ts` (WP06 wrote them), `console.error("delete_my_account_failed", { code: rpcError.code })` in `app/api/account/delete/route.ts:70`, any `console.error(label, { code: error.code })` left in `app/lib/portfolio.ts` (WP05 deleted most; `product_search_failed` near the end of the file may remain unless WP12 changed it), and the three env-guard `console.warn` calls in `app/lib/supabase.ts:18`, `app/lib/serverSupabase.ts:19`, `app/lib/serverMarketData.ts:37`. Convert whatever the grep prints; the list is informative, the grep is authoritative.

Record a bundle baseline before editing anything (WP00's stub build):

```bash
pnpm build:stub
node -e '
const fs=require("fs"),zlib=require("zlib"),path=require("path");
for (const page of ["index","prices","market","portfolio"]) {
  const f=`.next/server/app/${page}.html`; if(!fs.existsSync(f)){console.log(page,"(no html)");continue;}
  const html=fs.readFileSync(f,"utf8");
  const srcs=[...new Set([...html.matchAll(/src="\/_next\/(static\/[^"]+?\.js)"/g)].map(m=>m[1]))];
  const gz=srcs.reduce((s,p)=>s+zlib.gzipSync(fs.readFileSync(path.join(".next",p))).length,0);
  console.log(page.padEnd(10),String(srcs.length).padStart(3),"scripts",(gz/1024).toFixed(1).padStart(7),"kB gzip");
}' | tee /tmp/wp17-bundle-before.txt
```

Assumptions to check:

- `NEXT_PUBLIC_SENTRY_DSN` is unset in production (HARDENING_FOLLOWUPS.md section 7 lists it as "Optional"). Nothing in this PR changes runtime behaviour until it is set.
- `next build` uses Turbopack (Next 16 default; `package.json` `"build": "next build"`). Under Turbopack `@sentry/nextjs` 10.69 ignores `sentry.client.config.ts` (see `node_modules/@sentry/nextjs/build/cjs/config/webpack.js:210-215`, "When using Turbopack ... will no longer work"), which is why step 5 moves it. That deprecation warning is printed only by the webpack code path, so a Turbopack build never shows it; do not use its absence as proof of anything.
- Sentry's server SDK copies the incoming request's headers, including the raw `cookie` header, onto every event it captures (`@sentry/core` `integrations/requestdata.js`, `extractNormalizedRequestData`; with `sendDefaultPii` off it drops the header only for span attributes, not for events). The existing server `beforeSend` deletes `event.request.cookies` but not `event.request.headers.cookie`, and the edge config has no `beforeSend` at all. The Supabase session cookie (`sb-<ref>-auth-token`) carries the access and refresh tokens, so the moment this package turns on server reporting (`onRequestError`, the logger), a signed-in user's error would ship their tokens to Sentry. Step 5e closes that before anything can report.
- `next/jest` maps `server-only` to an empty module (`node_modules/next/dist/build/jest/jest.js:191-192`), so tests may import `routeSupabase.ts` without mocking `server-only`.

## Implementation steps

Order: steps 1 to 3 (logger, then call sites) before step 4 (the `no-console` rule would fail otherwise). Steps 5 and 6 (Sentry, CSP) are independent of the lint work; inside step 5, do 5e (event scrubbing) in the same commit as 5a so no commit can report unscrubbed events. Steps 7 to 10 clear the remaining lint. Steps 11 to 13 are small extractions that the tests need. Step 14 is coverage config. Step 15 flips CI only after `pnpm run lint` exits 0. Write the tests from the Tests section alongside the step they cover.

### Step 1. Correction to the plan: how the logger reports to Sentry

The plan says "wire logger to Sentry.captureException when DSN set". Two verifier corrections (F108) and the code change that:

1. `logger.ts` is imported by client modules on the first-load path of `/prices` and `/portfolio` (`clientMarketData.ts`, `portfolio.ts`, the ProductPrices and Portfolio hooks). A static `import * as Sentry from "@sentry/nextjs"` there would put the browser SDK in first-load JS. Use a lazy `import("@sentry/nextjs")` that runs only when a DSN is configured and an error is actually logged.
2. `logSupabaseError` only has a sanitized plain object; `captureException` on a plain object produces stackless "Non-Error exception captured" events. Use `captureMessage(label, { level: "error", extra })` for Supabase errors, HTTP failures and non-Error throws. Keep `captureException` for real `Error` instances in `logCaughtError`, where it gives a stack.

### Step 2. `frontend/app/lib/logger.ts`: Sentry hook and two new helpers

Replace the whole file with:

```ts
/**
 * Structured logging helpers. Application code logs only through this module;
 * eslint `no-console` enforces that everywhere except here (review F108).
 *
 * The audit found that ~15 sites passed raw Supabase error objects to
 * console.error, leaking the `details` and `hint` fields that can include
 * schema fragments. logSupabaseError formats only the safe shape.
 *
 * Sentry: when NEXT_PUBLIC_SENTRY_DSN (browser and server) or SENTRY_DSN
 * (server only) is set, every error helper also reports to Sentry. The SDK is
 * imported lazily, so nothing is downloaded while no DSN is configured and a
 * page that never logs an error never loads it. The SDK is initialised by
 * instrumentation.ts (server, edge) and instrumentation-client.ts (browser);
 * before that runs, the capture calls are no-ops. Every runtime's beforeSend
 * runs scrubSentryEvent (app/lib/sentryScrub.ts), which strips emails, IPs,
 * cookies, the cookie/authorization headers and any details/hint extras.
 */

type SentryModule = typeof import("@sentry/nextjs");
type LogFields = Record<string, string | number | boolean | null>;

let sentryModule: Promise<SentryModule | null> | null = null;

function sentryConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN);
}

/** Runs `send` with the Sentry SDK when a DSN is configured. Never throws. */
function withSentry(send: (sentry: SentryModule) => void): void {
  if (!sentryConfigured()) return;
  sentryModule ??= import("@sentry/nextjs").catch(() => null);
  void sentryModule
    .then((sentry) => {
      if (sentry) send(sentry);
    })
    .catch(() => undefined);
}

function reportMessage(label: string, extra: LogFields): void {
  withSentry((sentry) => {
    sentry.captureMessage(label, { level: "error", extra });
  });
}

interface SupabaseLikeError {
  message?: unknown;
  code?: unknown;
  name?: unknown;
}

export function logSupabaseError(label: string, err: SupabaseLikeError | null | undefined) {
  if (!err) {
    const fields = { code: "unknown", message: "no error object" };
    console.error(label, fields);
    reportMessage(label, fields);
    return;
  }
  // Only the safe fields. message + code are normally short; cap
  // message length defensively in case a future SDK version expands it.
  const message =
    typeof err.message === "string" ? err.message.slice(0, 300) : null;
  const code = typeof err.code === "string" ? err.code : null;
  const name = typeof err.name === "string" ? err.name : null;
  console.error(label, { code, name, message });
  reportMessage(label, { code, name, message });
}

/**
 * For caught Error instances (e.g. fetch/network failures).
 * Keeps message + name in the console; drops stack to avoid leaking source
 * paths via client-side console exfiltration. Sentry gets the Error itself
 * (with its stack), which only the project owner can read.
 */
export function logCaughtError(label: string, err: unknown) {
  if (err instanceof Error) {
    console.error(label, { name: err.name, message: err.message.slice(0, 300) });
    // An aborted fetch is a cancelled request (unmount, superseded search),
    // not a failure anyone should be alerted about.
    if (err.name !== "AbortError") {
      withSentry((sentry) => {
        sentry.captureException(err, { tags: { label } });
      });
    }
  } else if (typeof err === "string") {
    const fields = { message: err.slice(0, 300) };
    console.error(label, fields);
    reportMessage(label, fields);
  } else {
    const fields = { message: "non-error thrown" };
    console.error(label, fields);
    reportMessage(label, fields);
  }
}

/**
 * For a fetch that came back with a non-2xx status (there is no Error object).
 * Only 5xx is reported to Sentry: a 4xx here is an expired session or a
 * rejected input, which the UI already handles.
 */
export function logHttpFailure(label: string, status: number) {
  console.error(label, { status });
  if (status >= 500) reportMessage(label, { status });
}

/** Configuration warnings, e.g. a missing env var at module load. Console only. */
export function logWarning(label: string, message: string) {
  console.warn(label, { message: message.slice(0, 300) });
}
```

Existing console assertions in `logger.test.ts` keep passing because the console output of the two existing helpers is unchanged.

### Step 3. Route every raw `console.*` call through the logger

Re-run the grep from "Before you start" step 3 and convert every hit with this table. Add the needed names to the file's existing `logger` import, or add one (`"./logger"` inside `app/lib`, `"../../../lib/logger"` from `app/api/account/delete/route.ts` and from `app/components/BoxCalculator/hooks/useBoxRecipes.ts`).

| Current shape | Replace with |
| --- | --- |
| `console.error("<label>", { code: <err>.code })` where `<err>` is a Supabase/PostgREST error | `logSupabaseError("<label>", <err>)` |
| `console.error("<label>", { status: <res>.status })` | `logHttpFailure("<label>", <res>.status)` |
| `console.error("<label>", <caught>)` inside a `catch` | `logCaughtError("<label>", <caught>)` |
| env-guard `console.warn("[x] NEXT_PUBLIC_SUPABASE_URL ...")` | `logWarning("<x>_env_missing", "<same text without the [x] prefix>")`, and delete the `// eslint-disable-next-line no-console` line above it |
| any `console.log/info/debug` | delete it if it is a debugging leftover; otherwise `logWarning` |

Concrete edits for the known sites:

- `app/api/account/delete/route.ts`: add `import { logSupabaseError } from "../../../lib/logger";` after the `cookieOptions` import; line 70 becomes `logSupabaseError("delete_my_account_failed", rpcError);`. Change nothing else in this route (WP20 dedupes its CSRF block).
- `app/components/BoxCalculator/hooks/useBoxRecipes.ts`: WP06 already imports `{ logCaughtError } from "../../../lib/logger"`; change that one line to `import { logCaughtError, logHttpFailure } from "../../../lib/logger";` (do not add a second import of the same module); `console.error("recipe_request_failed", { status: res.status })` becomes `logHttpFailure("recipe_request_failed", res.status)`, and the same for `recipes_load_failed` and `recipe_delete_failed`.
- `app/lib/supabase.ts` lines 13-21 become:

```ts
if (
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.NEXT_PUBLIC_SUPABASE_KEY
) {
  logWarning(
    "supabase_env_missing",
    "NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_KEY is unset; using placeholders, runtime calls will fail."
  );
}
```

  with `import { logWarning } from "./logger";` below the `@supabase/ssr` import. Same in `app/lib/serverSupabase.ts` (label `server_supabase_env_missing`, import below `./cookieOptions`) and `app/lib/serverMarketData.ts` (label `server_market_data_env_missing`; it already imports `logCaughtError, logSupabaseError` from `./logger`, add `logWarning` there).

Then `grep` again: it must print nothing (comment lines that merely mention `console.error` are fine; lint in step 4 is the real check).

### Step 4. `frontend/eslint.config.mjs`: `no-console`, and a named export

4a. Change `export default [` to `const eslintConfig = [`, and after the array's closing `];` add:

```js

export default eslintConfig;
```

This clears `import/no-anonymous-default-export`. Keep `ANON_CLIENT_FORBIDDEN_FILES` and every existing object exactly as they are.

4b. Append these two objects as the last elements of the array:

```js
  // WP17 (review F108): application code logs only through app/lib/logger.ts,
  // which sanitizes Supabase errors and reports to Sentry when a DSN is set.
  {
    files: [
      "app/**/*.{ts,tsx}",
      "proxy.ts",
      "instrumentation.ts",
      "instrumentation-client.ts",
    ],
    ignores: ["app/lib/logger.ts", "**/__tests__/**"],
    rules: {
      "no-console": "error",
    },
  },
  // Build and maintenance scripts talk to a terminal; console is their UI.
  {
    files: ["scripts/**/*.{js,mjs,cjs,ts}"],
    rules: {
      "no-console": "warn",
    },
  },
```

`no-console` is a core ESLint rule; nothing in `eslint-config-next` configures it (`pnpm exec eslint --print-config app/lib/portfolio.ts | grep no-console` prints nothing today), so these objects do not override another setting.

### Step 5. Sentry actually starts: `instrumentation.ts` and `instrumentation-client.ts`

Corrections to the plan: it lists only `instrumentation.ts`. The browser side needs `instrumentation-client.ts` too, because under Turbopack (the Next 16 default for `next build`) `@sentry/nextjs` no longer loads `sentry.client.config.ts`. Without this, the logger's browser reports and F128's CSP change would have nothing to serve. Both files load the SDK only when a DSN is set, and step 5e makes every runtime scrub the session cookie header before this package lets anything report.

5a. New file `frontend/instrumentation.ts`. It loads nothing from Sentry unless a DSN is set: a static `import * as Sentry from "@sentry/nextjs"` here (the snippet in Sentry's docs and in the F108 verifier note) would load the whole Node SDK, OpenTelemetry included, on every serverless cold start even with no DSN, which breaks the "inert until the owner sets a DSN" promise.

```ts
/**
 * Next 16 calls register() once per server runtime at startup. It is the only
 * place the server and edge Sentry configs are loaded; without this file they
 * never run (review F108).
 *
 * Nothing from @sentry/nextjs is imported while no DSN is set, so a deployment
 * without Sentry pays no cold-start cost for it.
 */
import type { Instrumentation } from "next";

function sentryDsnConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN);
}

export async function register() {
  if (!sentryDsnConfigured()) return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Reports errors thrown by server components, route handlers, server actions
// and proxy.ts. register() has already loaded the SDK when a DSN is set, so
// this import resolves from the module cache.
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  if (!sentryDsnConfigured()) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(error, request, context);
};
```

`Instrumentation` is exported by `next` (`node_modules/next/dist/types.d.ts:19`); Next's request and context types are assignable to `captureRequestError`'s parameters (`node_modules/@sentry/nextjs/build/types/common/captureRequestError.d.ts`).

5b. New file `frontend/instrumentation-client.ts`, carrying the options of `sentry.client.config.ts` unchanged except that `beforeSend` calls the shared scrubber from step 5e, and loading the SDK lazily and only when a DSN was set at build time:

```ts
/**
 * Browser Sentry init. Next 16 runs this file on every page before hydration.
 * It replaces sentry.client.config.ts, which @sentry/nextjs ignores under
 * Turbopack (review F108).
 *
 * The SDK is imported only when NEXT_PUBLIC_SENTRY_DSN was set at build time,
 * so visitors of a build without a DSN download none of it, and a build with
 * one loads it as a separate chunk instead of growing every page's first-load
 * JS. Errors thrown before that chunk arrives are not reported.
 *
 * scrubSentryEvent strips Supabase error `details`/`hint`, email addresses,
 * IPs, cookies and the cookie/authorization headers.
 */
import { scrubSentryEvent } from "./app/lib/sentryScrub";

type RouterTransitionHook = (href: string, navigationType: string) => void;

let routerTransitionHook: RouterTransitionHook | null = null;

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.init({
        dsn,
        tracesSampleRate: 0.1,
        enabled: true,
        environment: process.env.NODE_ENV,
        beforeSend(event) {
          scrubSentryEvent(event);
          return event;
        },
        beforeSendTransaction(event) {
          scrubSentryEvent(event);
          return event;
        },
      });
      routerTransitionHook = Sentry.captureRouterTransitionStart;
    })
    .catch(() => undefined);
}

// Next calls this on every client-side navigation. It forwards to Sentry once
// the SDK has loaded, and is a no-op before that or without a DSN. The name
// must appear in this file: withSentryConfig greps for it and prints an
// "ACTION REQUIRED" warning at build time when it is missing.
export function onRouterTransitionStart(href: string, navigationType: string) {
  routerTransitionHook?.(href, navigationType);
}
```

5c. Delete `frontend/sentry.client.config.ts` (`git rm`). `eslint.config.mjs` still ignores `sentry.*.config.ts`; the two remaining config files change only as step 5e says.

5d. `frontend/app/error.tsx`: change the comment directly above `Sentry.captureException(error);` (`:14` at `a188fea`; WP15 restyled the file, so find it by text) to `// No-op until NEXT_PUBLIC_SENTRY_DSN is set (see instrumentation-client.ts).` Keep the static `@sentry/nextjs` import in `error.tsx` and `global-error.tsx` as they are (they already ship today; changing them is out of scope).

5e. One event scrubber for every runtime. New file `frontend/app/lib/sentryScrub.ts`:

```ts
/**
 * beforeSend / beforeSendTransaction body shared by the browser, Node.js and
 * edge Sentry configs (review F108).
 *
 * Sentry's server SDK copies the incoming request headers, including the raw
 * `cookie` header, onto every event. The Supabase session cookie carries the
 * access and refresh tokens, so the header must go, not just
 * `event.request.cookies`. Supabase error `details`/`hint` extras can carry
 * schema fragments (the reason logSupabaseError exists).
 *
 * Typed structurally so it accepts Sentry's ErrorEvent and TransactionEvent
 * without importing Sentry types (the merged @sentry/nextjs type entry
 * re-exports client and server copies of them).
 */
export interface SentryEventLike {
  user?: { email?: unknown; ip_address?: unknown };
  request?: { cookies?: unknown; headers?: Record<string, unknown> };
  extra?: Record<string, unknown>;
}

const SENSITIVE_HEADER =
  /^(cookie|authorization|proxy-authorization|forwarded|x-forwarded-for|x-real-ip|x-vercel-forwarded-for|x-vercel-proxied-for|cf-connecting-ip|true-client-ip)$/i;

/** Mutates the event in place. */
export function scrubSentryEvent(event: SentryEventLike): void {
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
  }
  if (event.request) {
    delete event.request.cookies;
    const headers = event.request.headers;
    if (headers) {
      for (const name of Object.keys(headers)) {
        if (SENSITIVE_HEADER.test(name)) delete headers[name];
      }
    }
  }
  if (event.extra) {
    delete event.extra.details;
    delete event.extra.hint;
  }
}
```

In `frontend/sentry.server.config.ts`: add `import { scrubSentryEvent } from "./app/lib/sentryScrub";` below the `@sentry/nextjs` import, replace the whole `beforeSend(event) { ... }` method (lines 12-26) with the same two methods as in 5b:

```ts
    beforeSend(event) {
      scrubSentryEvent(event);
      return event;
    },
    beforeSendTransaction(event) {
      scrubSentryEvent(event);
      return event;
    },
```

In `frontend/sentry.edge.config.ts`: add the same import, and add the same two methods after `environment: process.env.NODE_ENV,` (the edge config has no `beforeSend` today). Change nothing else in either file (DSN resolution and sample rates stay).

### Step 6. `frontend/next.config.ts`: Sentry origin in `connect-src`, CSP violation reports, and the `'unsafe-inline'` rationale (F128)

Line numbers below are at `a188fea`. WP02 (images) and WP13 (`redirects()`) edited other parts of this file, so find each spot by the quoted text.

6a. Above `const csp = [` add:

```ts
// Sentry, derived from the DSN and only when one is configured (review F128).
// NEXT_PUBLIC_* values are inlined at build time and these headers are fixed
// when the config is loaded, so adding a DSN in Vercel needs a redeploy either
// way. A DSN looks like https://<key>@o<org>.ingest.<region>.sentry.io/<project>.
function parseSentryDsn(
  dsn: string | undefined
): { origin: string; key: string; projectId: string } | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    if (url.protocol !== "https:") return null;
    const projectId = url.pathname.split("/").filter(Boolean).pop() ?? "";
    if (!url.username || !/^\d+$/.test(projectId)) return null;
    return { origin: url.origin, key: url.username, projectId };
  } catch {
    return null;
  }
}

const sentryDsn = parseSentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);
// Browser events are POSTed to the DSN's ingest host: allow exactly that origin.
const sentryOrigin = sentryDsn?.origin ?? null;
// CSP violation reports go to the project's security endpoint. Report
// submissions are not governed by connect-src.
const cspReportUrl = sentryDsn
  ? `${sentryDsn.origin}/api/${sentryDsn.projectId}/security/?sentry_key=${sentryDsn.key}`
  : null;
```

6b. Replace the `connect-src` entry (`"connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com",`, line 25) with:

```ts
  `connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com${
    sentryOrigin ? ` ${sentryOrigin}` : ""
  }`,
```

`url.origin` drops the key and the path, giving the org-specific host, not a wildcard.

Then make the enforced policy report its violations (F128 verifiers: report from the enforced CSP, never from a strict Report-Only policy). After the last entry of the array (`"upgrade-insecure-requests",`) and before `].join("; ");`, add:

```ts
  // Legacy report-uri for browsers without the Reporting API, report-to for
  // the rest (its endpoint is named in the Reporting-Endpoints header below).
  ...(cspReportUrl ? [`report-uri ${cspReportUrl}`, "report-to csp-endpoint"] : []),
```

and in `securityHeaders`, directly after the `{ key: "Content-Security-Policy", value: csp },` line, add:

```ts
  ...(cspReportUrl
    ? [{ key: "Reporting-Endpoints", value: `csp-endpoint="${cspReportUrl}"` }]
    : []),
```

Without a DSN the CSP string and the header list are byte-identical to today.

6c. Insert this comment directly above the `script-src` template literal (line 15), after the existing dev-allowance comment:

```ts
  // 'unsafe-inline' in script-src is an accepted trade-off (review F128).
  // Every public page is static or ISR, and Next inlines its flight data as
  // per-page <script>self.__next_f.push(...)</script> tags, so:
  //  - a nonce needs a fresh value per response, which would force every page
  //    to render dynamically (no ISR, no CDN cache);
  //  - hashes cannot be listed ahead of time for per-page flight scripts;
  //  - adding ANY nonce or hash makes CSP3 browsers ignore 'unsafe-inline',
  //    which would block those flight scripts and break hydration. Do not add
  //    hashes "incrementally".
  // The app has no raw-HTML sinks (no dangerouslySetInnerHTML, innerHTML or
  // next/script). If the public pages ever render dynamically, move the CSP
  // into proxy.ts with the Next 16 nonce pattern instead: a per-request nonce
  // passed as the x-nonce request header, 'nonce-<value>' 'strict-dynamic'
  // here, and the proxy matcher widened to
  // /((?!_next/static|_next/image|favicon.ico).*).
```

6d. Docs. In `audits/HARDENING_FOLLOWUPS.md` section 7, replace the whole four-line bullet that starts `- **Optional**: create a Sentry project` and ends `set.` (lines 181-184) with:

```markdown
- **Optional**: create a Sentry project, add `NEXT_PUBLIC_SENTRY_DSN`
  to Vercel (and `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT`
  if you want source-map upload), then redeploy. Since WP17 the DSN
  switches on server, edge and browser reporting (instrumentation.ts,
  instrumentation-client.ts), the logger's error helpers report to Sentry,
  and next.config.ts adds the DSN's ingest origin to CSP `connect-src`
  and sends CSP violation reports to the project's security endpoint.
  Every runtime scrubs cookies, auth/IP headers, emails and Supabase
  `details`/`hint` before sending (app/lib/sentryScrub.ts); keep Sentry's
  server-side Data Scrubbing on as well. All of it is inert until the DSN
  is set, and a DSN added later only takes effect after a redeploy (it is
  read at build time).
```

In `frontend/.env.example`, change the Sentry comment line to `# Sentry: DSN is safe to expose; the auth token is build-only and secret. Redeploy after changing the DSN (read at build time).`

### Step 7. `HoldingsTable.tsx`: hoist `SortButton` (F056)

Delete the inner `const SortButton = (...) => (...)` (currently `:79-95`; WP15 added `type="button"`, `aria-pressed` and the `bg-blue-50 text-[var(--pf-pokeblue-strong)]` active class). Add this at module scope, between the imports and `interface HoldingsTableProps`. Copy the `<button>` JSX from the current file verbatim, replacing only the free variables: `handleSort(field)` becomes `onSort(field)`, `sortBy === field` becomes `active`, `sortDirection` becomes `direction`. After WP15 the result is:

```tsx
interface SortButtonProps {
  field: HoldingSortBy;
  label: string;
  active: boolean;
  direction: HoldingSortDirection;
  onSort: (field: HoldingSortBy) => void;
}

// Module scope on purpose: a component declared inside HoldingsTable was a new
// type on every render, so React remounted all five buttons on each sort click
// and keyboard focus fell back to <body> (review F056).
function SortButton({ field, label, active, direction, onSort }: SortButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      aria-pressed={active}
      className={`text-xs font-medium px-2 py-1 rounded ${
        active
          ? "bg-blue-50 text-[var(--pf-pokeblue-strong)]"
          : "text-slate-500 hover:bg-slate-100"
      }`}
    >
      {label}
      {active && (
        <span className="ml-1">{direction === "asc" ? "↑" : "↓"}</span>
      )}
    </button>
  );
}

const SORT_FIELDS: ReadonlyArray<{ field: HoldingSortBy; label: string }> = [
  { field: "purchase_date", label: "Date" },
  { field: "name", label: "Name" },
  { field: "value", label: "Value" },
  { field: "gain_loss", label: "G/L" },
  { field: "gain_loss_percent", label: "G/L %" },
];
```

Replace the five `<SortButton field=... label=... />` lines (`:132-136`) with:

```tsx
            {SORT_FIELDS.map(({ field, label }) => (
              <SortButton
                key={field}
                field={field}
                label={label}
                active={sortBy === field}
                direction={sortDirection}
                onSort={handleSort}
              />
            ))}
```

Keep `handleSort`, the sort logic and the labels unchanged. If WP15's attributes or classes differ from the block above, keep what the file has.

### Step 8. Chart tooltips and dot at module scope (F056)

Recharts 3.10 renders an element passed as Tooltip `content` with `React.cloneElement(content, props)`, and a function with `React.createElement(content, props)` (`node_modules/recharts/lib/component/Tooltip.js:40-48`). So the fix is a module-scope component passed as an element, `content={<AllocationTooltip currency={currency} />}`. An inline render prop `content={(p) => ...}` renders correctly but is a new component type each render and remounts just the same. (Line `dot` clones an element and calls a function directly, `node_modules/recharts/lib/component/Dots.js:30-36`; use the element form there too, for one pattern.)

These chart changes have no visible effect for users (F056 re-verification): the tooltips and dot hold no state and only re-render when chart props change. 8a and 8b are required because lint flags them; 8c clears a site lint cannot see and removes its `any` types. Keep the rendered output identical.

In each file, copy the current tooltip body verbatim (keep its classNames, text and the WP07 `formatMoney` calls); only the free variables become props. Use this minimal props type rather than Recharts' generic `TooltipContentProps` (its payload values are typed `number | string | array`, and Recharts injects them at runtime anyway):

```ts
interface ChartTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown; payload?: unknown }>;
  label?: string | number;
}
```

8a. `frontend/app/components/charts/AllocationChartImpl.tsx`. Add `ChartTooltipProps` below `COLORS`, then:

```tsx
// Module scope so Recharts gets the same component type on every render
// (review F056). Recharts clones this element and injects active/payload.
export function AllocationTooltip({
  active,
  payload,
  currency,
}: ChartTooltipProps & { currency: "USD" | "CAD" }) {
  if (!active || !payload || payload.length === 0) return null;
  const data = payload[0].payload as AllocationItem;
  return (
    <div className="bg-slate-900 text-white px-4 py-3 rounded-lg shadow-xl">
      <p className="font-semibold mb-1">{data.name}</p>
      <p className="text-sm">{formatMoney(data.value, currency)}</p>
      <p className="text-xs text-slate-400">{data.percentage.toFixed(1)}%</p>
    </div>
  );
}
```

Delete the inner `const CustomTooltip` and change the usage to `<Tooltip content={<AllocationTooltip currency={currency} />} />`. If `currencySymbol` is now unused, delete it.

8b. `frontend/app/components/charts/PortfolioChartImpl.tsx`. Add `ChartTooltipProps` below the props interface, then:

```tsx
// Module scope so Recharts gets the same component type on every render
// (review F056).
export function PortfolioTooltip({
  active,
  payload,
  label,
  currency,
}: ChartTooltipProps & { currency: "USD" | "CAD" }) {
  const value = payload?.[0]?.value;
  if (!active || typeof value !== "number") return null;
  const point = payload?.[0]?.payload as
    | { isPartial?: boolean; pricedProducts?: number; heldProducts?: number }
    | undefined;
  return (
    <div className="bg-slate-900 text-white px-4 py-3 rounded-lg shadow-xl border-2 border-emerald-500">
      <p className="text-xs font-semibold text-slate-300 mb-1">{label}</p>
      <p className="text-lg font-bold">
        <span className="text-emerald-400">{formatMoney(value, currency)}</span>
        <span className="text-xs text-slate-400 ml-1">{currency}</span>
      </p>
      {/* Copy the `{point?.isPartial && (<p ...> ... </p>)}` block from the
          current CustomTooltip here verbatim. */}
    </div>
  );
}
```

`typeof value !== "number"` replaces the old `payload[0].value !== null` check (it also rejects `undefined`). Delete the inner `CustomTooltip`; the `<Tooltip` usage (`:224-231`) becomes `content={<PortfolioTooltip currency={currency} />}` with the `cursor` prop unchanged. Keep `currencySymbol` (the compact `k` Y-axis formatter still uses it).

8c. `frontend/app/components/PriceChart.tsx`. Lint does not flag these (the component is wrapped in `memo()`), but they have the same defect. Add above `const PriceChart = memo(`:

```tsx
interface ChartTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown; payload?: unknown }>;
  label?: string | number;
}

// Module scope so Recharts gets the same component type on every render
// (review F056).
export function PriceTooltip({
  active,
  payload,
  label,
  currency,
  hasVolume,
}: ChartTooltipProps & { currency: Currency; hasVolume: boolean }) {
  if (!active || !payload || !payload.length) return null;

  // With volume bars enabled the payload gains a "volume" entry, so find
  // the price entry explicitly instead of relying on payload order.
  const priceEntry = payload.find((entry) => entry.dataKey === "price");
  if (!priceEntry || typeof priceEntry.value !== "number") return null;

  const point = (priceEntry.payload ?? {}) as { volume?: unknown; volumeIsWeekly?: boolean };
  const showVolume = hasVolume && typeof point.volume === "number";

  return (
    <div className="bg-slate-900 text-white px-4 py-3 rounded-lg shadow-xl border-2 border-blue-500">
      <p className="text-xs font-semibold text-slate-300 mb-1">{label}</p>
      <p className="text-lg font-bold">
        <span className="text-blue-400">{formatMoney(priceEntry.value, currency)}</span>
        <span className="text-xs text-slate-400 ml-1">{currency}</span>
      </p>
      {showVolume && (
        <p className="text-xs text-slate-300 mt-1 tabular-nums">
          {point.volume as number} sold{point.volumeIsWeekly ? " (week)" : ""}
        </p>
      )}
    </div>
  );
}

export function PriceDot({
  cx,
  cy,
  payload,
}: {
  cx?: number;
  cy?: number;
  payload?: { price: number | null };
}) {
  if (!payload || payload.price === null) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3}
      fill="#3b82f6"
      stroke="#fff"
      strokeWidth={1.5}
      className="transition-all hover:r-5"
    />
  );
}
```

Delete the inner `CustomTooltip` and `CustomDot` (`:465-509` at the 2026-09-30 re-verification: the declarations start at `:466` and `:494`, including their two comments; find them by name if WP07 or WP09 shifted the lines). Usages (`:662` and `:714`): `content={<PriceTooltip currency={currency} hasVolume={hasVolume} />}` and `dot={range === "7D" ? <PriceDot /> : false}`. If WP07 did not land, the price span keeps whatever the current body renders (for example `{currencySymbol}{priceEntry.value.toFixed(2)}`, adding a `currencySymbol` prop); do not change the output in this package.

### Step 9. `useCurrencyConversion.ts`: derive the rate instead of syncing it (set-state-in-effect)

The effect copies `initialExchangeRate` into state that its initializer already used (`:20-24`), which is the lint error. Replace lines 13-48 (the signature line through the end of the effect) with:

```ts
export function useCurrencyConversion(initialExchangeRate?: number, initialCurrency: Currency = "CAD") {
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(initialCurrency);
  // Rate fetched in the browser when the server did not supply one; null until
  // the request settles. A server-supplied rate is read straight from the
  // argument, so nothing is copied into state inside an effect
  // (react-hooks/set-state-in-effect).
  const [fetchedRate, setFetchedRate] = useState<number | null>(null);
  const serverRate = initialExchangeRate ? initialExchangeRate : null;

  useEffect(() => {
    if (serverRate !== null) return;
    let cancelled = false;
    fetchLatestExchangeRateClient()
      .then((result) => {
        if (!cancelled) setFetchedRate(result.rate);
      })
      .catch((error: unknown) => {
        logCaughtError("exchange_rate_load_failed", error);
        if (!cancelled) setFetchedRate(DEFAULT_EXCHANGE_RATE);
      });
    return () => {
      cancelled = true;
    };
  }, [serverRate]);

  const exchangeRate = serverRate ?? fetchedRate ?? DEFAULT_EXCHANGE_RATE;
  const exchangeRateLoading = serverRate === null && fetchedRate === null;
```

Add `import { DEFAULT_EXCHANGE_RATE } from "../../../lib/marketData";` (it is `1.36`, `marketData.ts:71`, the literal the old code used). Keep `convertPrice`, `formatPrice` (with WP07's `formatMoney`) and the return object exactly as they are. The returned `exchangeRate` and `exchangeRateLoading` have the same values as before in every case: server rate given (rate, false); fetching (1.36, true); fetched (rate, false); failed (1.36, false).

### Step 10. Remaining warnings, and fallbacks for leftovers

10a. `app/lib/validation.ts`: if lint still reports the unused directive, delete the line `// eslint-disable-next-line no-control-regex` above `stripControlChars`'s `return` (`:63` at `a188fea`; WP02 and WP05 edited this file). `no-control-regex` is not enabled by `eslint-config-next`, so the directive is unused.

10b. `app/auth/signup/page.tsx`: if lint still reports `'router' is assigned a value but never used`, delete `const router = useRouter();` (`:42`) and the `useRouter` import (`:4`).

10c. `app/stats/page.tsx`: if lint still reports `formatScore` unused, delete the function (`:55-58`).

10d. `app/components/Portfolio/__tests__/HoldingsTable.test.tsx`: if `within` is still unused after your test edits, remove it from the `@testing-library/react` import.

10e. Re-run lint. For anything left that the table in "Before you start" marks as already fixed:
- `account/page.tsx`, `usePortfolioData.ts`, `useProductSearch.ts`, `AddHoldingModal.tsx`, `EditHoldingModal.tsx`, `BoxCalculator.tsx`, `ProductCard.tsx`: their owning package (WP04, WP05, WP06, WP09, WP14) is a dependency. Stop and report it; do not paper over it here.
- `CardRinkPromo.tsx` set-state-in-effect (WP15 not merged): replace the dismissed-state effect with a store read:

```tsx
function subscribeNoop() {
  return () => {};
}
function readBannerDismissed(): boolean {
  try {
    return sessionStorage.getItem(BANNER_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}
// inside the component, replacing useState(false) + the useEffect:
const storedDismissed = useSyncExternalStore(subscribeNoop, readBannerDismissed, () => false);
const [dismissedNow, setDismissedNow] = useState(false);
const bannerDismissed = variant === "banner" && (dismissedNow || storedDismissed);
```

  Add `useSyncExternalStore` to the file's `react` import and drop `useEffect` from it if nothing else uses it. In `handleDismissBanner` call `setDismissedNow(true)` instead of `setBannerDismissed(true)`; the existing `if (bannerDismissed) return null;` in the banner branch keeps working with the new constant.
- `PortfolioDashboard.tsx` `deleteLoading` unused (WP15 not merged): change the destructure to `const [, setDeleteLoading] = useState...`.
- Any other new error from a file added by WP10 to WP16: fix it minimally with the same patterns (derive during render, set state only in promise callbacks or event handlers, module-scope components). Never add `eslint-disable` for `react-hooks/*` rules.

Leave the `@next/next/no-img-element` warnings (see Pitfalls).

### Step 11. `calculateNav` into its own module

Plan says "export it". Exporting it from `BoxCalculator.tsx` would force the test to load the whole client component graph (AuthContext, `useSearchParams`, the pack-price and recipe hooks), so move it instead.

New file `frontend/app/components/BoxCalculator/nav.ts`:

```ts
import type { NavResult, PackEntry } from "./types";

// (move the doc comment and the whole calculateNav function here verbatim
// from BoxCalculator.tsx, adding `export`)
export function calculateNav(
  packs: PackEntry[],
  promoValue: number,
  retailPrice: number,
  getPackPrice: (setId: number) => number | null,
  convertPackPrice: (usd: number) => number
): NavResult | null {
  // ...body unchanged...
}
```

In `BoxCalculator.tsx`, delete the function and its doc comment, and add `import { calculateNav } from "./nav";` after the `./types` import. Remove `NavResult` from the `./types` import if nothing else in the file uses it (`grep -n NavResult app/components/BoxCalculator/BoxCalculator.tsx`). WP06's `formatInCurrency` helper stays in `BoxCalculator.tsx`.

### Step 12. `app/lib/import.ts`: export `matchProduct`

Change `function matchProduct(` (`:290`) to `export function matchProduct(`. No other change.

### Step 13. MarketView row derivation into `buildRows.ts`

This is the pure `buildMarketRows` module the F045 recommendation names, so WP19 starts from it.

13a. New file `frontend/app/components/MarketView/buildRows.ts`:

```ts
import { getVolumeTrendPercent } from "../../lib/marketPulse";
import { derivedFromPrice, hasCurrentPrice } from "../../lib/priceGuard";
import type {
  PriceHistoryEntry,
  Product,
  ProductVolumeMetrics,
} from "../ProductPrices/types";
import {
  getCagrPercent,
  getMaxDrawdownPercent,
  getReturnPercent,
  getVolatilityPercent,
} from "./returns";

// Moved verbatim from MarketView.tsx.
export const RETURN_WINDOWS = [
  { label: "7D", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
] as const;

export const DAY_MS = 24 * 60 * 60 * 1000;

export type ReturnWindowLabel = (typeof RETURN_WINDOWS)[number]["label"];

export type ReturnMap = Record<ReturnWindowLabel, number | null>;

/**
 * The only volume fields a row reads. Equal to WP11's VolumeMetricsSummary
 * (what useVolumeMetrics returns after WP11); full ProductVolumeMetrics rows
 * satisfy it too.
 */
export type RowVolumeMetrics = Pick<
  ProductVolumeMetrics,
  "units_sold_30d" | "units_sold_prior_30d"
>;

export function getReleaseMs(releaseDate?: string | null): number | null {
  // body moved verbatim from MarketView.tsx
}

export interface MarketRow {
  product: Product;
  history: PriceHistoryEntry[] | undefined;
  returns: ReturnMap;
  releaseMs: number | null;
  daysSinceRelease: number | null;
  price: number | null;
  pricePerDay: number | null;
  cagr: number | null;
  maxDrawdown: number | null;
  volatility30d: number | null;
  unitsSold30d: number | null;
  volumeTrend: number | null;
}

/** One table row's derived stats. Pure: `todayUtcMs` is passed in. */
export function buildMarketRow(
  product: Product,
  history: PriceHistoryEntry[] | undefined,
  volume: RowVolumeMetrics | undefined,
  convertPrice: (usdPrice: number) => number,
  todayUtcMs: number
): MarketRow {
  // Move the body of the `filteredProducts.map((product) => { ... })` callback
  // from MarketView's `rows` useMemo here verbatim, with its comments, except:
  //  - drop `const history = priceHistory[product.id];` (it is a parameter),
  //  - `const productVolume = volumeMetrics[product.id];` becomes
  //    `const productVolume = volume;` (or use `volume` directly).
}

export function buildMarketRows(
  products: readonly Product[],
  priceHistory: Readonly<Record<number, PriceHistoryEntry[]>>,
  volumeMetrics: Readonly<Record<number, RowVolumeMetrics>>,
  convertPrice: (usdPrice: number) => number,
  todayUtcMs: number
): MarketRow[] {
  return products.map((product) =>
    buildMarketRow(
      product,
      priceHistory[product.id],
      volumeMetrics[product.id],
      convertPrice,
      todayUtcMs
    )
  );
}
```

13b. In `MarketView.tsx`: delete `RETURN_WINDOWS`, `DAY_MS`, `ReturnWindowLabel`, `ReturnMap` and `getReleaseMs`, and import them (`RETURN_WINDOWS, DAY_MS, getReleaseMs, buildMarketRows, type ReturnWindowLabel`) from `"./buildRows"`. Replace the `rows` useMemo with:

```tsx
  const rows = useMemo(
    () =>
      buildMarketRows(
        filteredProducts,
        priceHistory,
        volumeMetrics,
        convertPrice,
        utcMidnightMs()
      ),
    [filteredProducts, priceHistory, convertPrice, volumeMetrics]
  );
```

Keep the dependency array the file currently has if WP09 or later changed it. Remove imports from `MarketView.tsx` that are now unused (`getVolumeTrendPercent`, `derivedFromPrice`, `hasCurrentPrice`, the four `./returns` functions); keep `utcMidnightMs` (still used by `filteredProducts`). `(typeof rows)[number]` in `sortedRows` keeps working; do not change the sort code.

### Step 14. `frontend/jest.config.js`: coverage sees `proxy.ts` and client pages

At the top, after `const nextJest = require('next/jest');`, add:

```js
const fs = require('fs');
const path = require('path');

// Server (RSC) pages only run under Next, never under jsdom, so they are left
// out of coverage. Client pages ("use client") stay in the report so their
// logic is visible (review F050).
function serverPageCoverageExclusions(dir = path.join(__dirname, 'app')) {
  const exclusions = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') exclusions.push(...serverPageCoverageExclusions(full));
    } else if (entry.name === 'page.tsx') {
      const head = fs.readFileSync(full, 'utf8').slice(0, 300);
      if (!/^\s*["']use client["']/m.test(head)) {
        const rel = path.relative(__dirname, full).split(path.sep).join('/');
        // Escape glob metacharacters in route segments like [id] or (group).
        exclusions.push('!' + rel.replace(/[[\]()]/g, '\\$&'));
      }
    }
  }
  return exclusions;
}
```

and replace `collectCoverageFrom` with:

```js
  collectCoverageFrom: [
    'app/**/*.{js,jsx,ts,tsx}',
    'proxy.ts',
    '!app/**/*.d.ts',
    '!app/**/layout.tsx',
    ...serverPageCoverageExclusions(),
  ],
```

Do not add `coverageThreshold` and do not add coverage to CI.

### Step 15. CI: lint blocks (F076 remainder)

Only after `pnpm run lint` exits 0 locally. In `.github/workflows/ci.yml`, replace the lint block (the four-line comment starting `# Lint is reported but not blocking yet`, the `- name: Lint (non-blocking)` step and its `continue-on-error: true`) with:

```yaml
      # Lint blocks merges (WP17). Errors fail the job; warnings (raw <img>
      # thumbnails, console output in scripts/) are reported but allowed.
      - name: Lint
        run: pnpm run lint
```

Do not rename the job (`Frontend (lint + typecheck + tests)`): branch protection matches job names. Leave WP00's build and script-test steps unchanged.

### Step 16. Plan doc

`audits/remediation/00-PLAN.md`: replace the paragraph "Lint currently reports 16 pre-existing errors and does not block CI until WP17. Until then, a PR must not add new lint errors in the files it touches." with "Since WP17, lint blocks CI: `pnpm run lint` must report 0 errors. Warnings are allowed only for `@next/next/no-img-element` and `no-console` in `scripts/`."

## Pitfalls: do not do this

- **Do not pass Recharts Tooltip content as an inline function** (`content={(p) => <Tip {...p} />}`), even though the F056 re-verification notes it renders correctly in Recharts 3. Tooltip calls `React.createElement(content, props)` for functions, so a new arrow each render is a new component type and remounts exactly like the bug being fixed. Pass an element of a module-scope component, for `dot` as well.
- **Do not add `eslint-disable` comments for `react-hooks/static-components`, `set-state-in-effect` or `preserve-manual-memoization`**, and do not downgrade those rules in `eslint.config.mjs`. Fix the code.
- **Do not statically import `@sentry/nextjs` in `logger.ts`, `instrumentation-client.ts` or `instrumentation.ts`** (F108 verifier correction 1). The logger sits on the first-load path of `/prices` and `/portfolio`; a static import ships the SDK to every visitor even with no DSN. In `instrumentation.ts` it would load the Node SDK on every cold start. `app/lib/sentryScrub.ts` must not import Sentry either (it is statically imported by `instrumentation-client.ts`).
- **Do not keep the old `beforeSend` bodies that delete only `event.request.cookies`.** Sentry's server SDK also copies the raw `cookie` header into `event.request.headers`, and that header holds the Supabase access and refresh tokens. Every runtime must call `scrubSentryEvent` from both `beforeSend` and `beforeSendTransaction`.
- **Do not call `captureException` with the sanitized plain object** from `logSupabaseError` (F108 verifier correction 2). It creates stackless "Non-Error exception captured" events. Use `captureMessage` with `extra`.
- **Do not also enable Sentry's `captureConsoleIntegration`.** The logger already reports; both together double every event.
- **Do not keep `sentry.client.config.ts` next to `instrumentation-client.ts`.** Under webpack both would initialise the SDK; under Turbopack the old file is dead code that misleads readers.
- **Do not add a wildcard (`https://*.ingest.sentry.io`) or an unconditional Sentry host to `connect-src`** (F128 verifier). Derive the exact origin from the DSN, and only when one is set.
- **Do not add nonces, hashes, `'strict-dynamic'` or a `Content-Security-Policy-Report-Only` header** (F128 verifiers). Reporting goes on the enforced policy (step 6b), only when a DSN is set. With static/ISR pages there is no per-response nonce; any nonce or hash makes CSP3 browsers ignore `'unsafe-inline'` and blocks Next's inline flight scripts; a strict Report-Only policy would report every page load as a violation.
- **Do not add `tunnelRoute` to `withSentryConfig` in this PR.** The F128 verifiers preferred a tunnel, but they also accepted the org-specific origin in `connect-src`, and the plan chose that route: a tunnel adds a same-origin function route (invocations billed per event) and changes the Sentry build config, which is a separate decision for the owner. Mention it in the PR body as the alternative.
- **Do not make warnings fail CI** (`--max-warnings=0`). `no-console` is deliberately `warn` for `scripts/`, and the `<img>` warnings are accepted.
- **Do not convert the `<img>` thumbnails to `next/image` or disable `@next/next/no-img-element`.** They are 40 to 48 px product thumbnails and WP02 disabled the image optimizer (`images.unoptimized: true`), so `next/image` would add markup and nothing else; changing them is out of scope.
- **Do not remove the `"@typescript-eslint/no-explicit-any": "off"` override** (F037 suggested it). Turning it on adds dozens of new errors unrelated to this package.
- **Do not duplicate WP02's rate-limit cases** in `proxy.test.ts` (they live in `proxy.rateLimit.test.ts`) or WP01's export-route cases. Add a 429 case to `proxy.test.ts` only if `proxy.rateLimit.test.ts` does not exist.
- **Do not change the delete route's inline CSRF block or its Supabase client construction.** WP20 moves them onto `lib/csrf.ts` and `lib/routeSupabase.ts`; this package only swaps the `console.error` line and adds the test that must keep passing through WP20.
- **Do not delete the whole `page.tsx` coverage exclusion** (F050 verifier correction 7). Exclude only server pages; there is no `coverageThreshold`, so this cannot break CI.
- **Route, proxy and next.config tests need `/** @jest-environment node */` as their first line** (F050 verifier correction 3): `next/server` throws `ReferenceError: Request is not defined` under jsdom.
- **`jest.mock` factories may only reference variables whose names start with `mock`**, and should read them lazily (`(...a) => mockFn(...a)`), because the factory is hoisted above the `const` declarations.
- **Do not change `useCurrencyConversion`'s return shape or `formatPrice`.** Four components use the hook (`BoxCalculator`, `ProductPrices/index.tsx`, `dashboard/RecentlyReleased`, `MarketView`), and WP20 later replaces it with a context.
- **Do not move or rename MarketView's sort code, columns or JSX.** Only the per-row derivation moves; the rest is WP19.

## Tests

Existing suites that must keep passing unchanged: everything under `app/**/__tests__`, in particular `app/api/account/export/__tests__/route.test.ts` (WP01), `app/lib/__tests__/proxy.rateLimit.test.ts` and `app/api/auth/__tests__/routes.test.ts` (WP02), `app/lib/__tests__/import.holdings.test.ts` (WP05), `app/components/BoxCalculator/__tests__/BoxCalculator.test.tsx` (WP06, WP15), `app/components/__tests__/PriceChart.staleness.test.tsx`, `app/components/MarketView/__tests__/*`, and `app/components/Portfolio/__tests__/PortfolioChart.test.tsx` (WP05). Do not delete or weaken any case.

### 1. `frontend/app/lib/__tests__/logger.test.ts` (update)

Keep all existing cases. Add at the top of the file (before the imports):

```ts
const mockCaptureMessage = jest.fn();
const mockCaptureException = jest.fn();
jest.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));
```

extend the import to `import { logCaughtError, logHttpFailure, logSupabaseError, logWarning } from "../logger";`, and append:

```ts
// The logger loads Sentry with a dynamic import; let that promise settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Sentry reporting", () => {
  const saved = {
    pub: process.env.NEXT_PUBLIC_SENTRY_DSN,
    srv: process.env.SENTRY_DSN,
  };
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockCaptureMessage.mockClear();
    mockCaptureException.mockClear();
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    delete process.env.SENTRY_DSN;
  });
  afterEach(() => {
    errorSpy.mockRestore();
    if (saved.pub === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = saved.pub;
    if (saved.srv === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = saved.srv;
  });

  it("reports nothing without a DSN", async () => {
    logSupabaseError("x_failed", { code: "1", message: "m" });
    logCaughtError("y_failed", new Error("boom"));
    logHttpFailure("z_failed", 503);
    await flush();
    expect(mockCaptureMessage).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("sends a Supabase error as an error-level message with only the safe fields", async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://k@o1.ingest.us.sentry.io/2";
    logSupabaseError("holding_insert_failed", {
      code: "23505",
      name: "PostgrestError",
      message: "duplicate key",
      details: "schema fragment",
      hint: "use ON CONFLICT",
    } as unknown as Parameters<typeof logSupabaseError>[1]);
    await flush();
    expect(mockCaptureMessage).toHaveBeenCalledWith("holding_insert_failed", {
      level: "error",
      extra: { code: "23505", name: "PostgrestError", message: "duplicate key" },
    });
  });

  it("sends a caught Error with captureException and the label as a tag", async () => {
    process.env.SENTRY_DSN = "https://k@o1.ingest.us.sentry.io/2"; // server-only DSN also enables it
    const err = new TypeError("fetch failed");
    logCaughtError("recipes_load_failed", err);
    await flush();
    expect(mockCaptureException).toHaveBeenCalledWith(err, { tags: { label: "recipes_load_failed" } });
  });

  it("does not report an aborted request", async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://k@o1.ingest.us.sentry.io/2";
    const abort = new Error("aborted");
    abort.name = "AbortError";
    logCaughtError("search_failed", abort);
    await flush();
    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith("search_failed", { name: "AbortError", message: "aborted" });
  });

  it("reports HTTP 5xx but not 4xx", async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://k@o1.ingest.us.sentry.io/2";
    logHttpFailure("recipes_load_failed", 401);
    logHttpFailure("recipes_load_failed", 502);
    await flush();
    expect(errorSpy).toHaveBeenCalledWith("recipes_load_failed", { status: 401 });
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage).toHaveBeenCalledWith("recipes_load_failed", {
      level: "error",
      extra: { status: 502 },
    });
  });
});

describe("logWarning", () => {
  it("warns on the console and never reports", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://k@o1.ingest.us.sentry.io/2";
    logWarning("supabase_env_missing", "unset");
    await flush();
    expect(warn).toHaveBeenCalledWith("supabase_env_missing", { message: "unset" });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
    warn.mockRestore();
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });
});
```

Also add a case that a thrown string is reported as `captureMessage(label, { level: "error", extra: { message: "raw" } })` when a DSN is set.

### 2. `frontend/app/lib/__tests__/proxy.test.ts` (new)

```ts
/** @jest-environment node */
/**
 * proxy.ts: route protection and session-cookie propagation (review F050).
 * Rate limiting is covered by proxy.rateLimit.test.ts (WP02).
 */
import { NextRequest } from "next/server";
import { _resetRateLimitStoreForTests } from "../rateLimit";

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

let mockUser: { id: string } | null = null;
let mockRotated: CookieToSet[] = [];

jest.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: { setAll: (cookies: CookieToSet[]) => void } }
  ) => ({
    auth: {
      getUser: async () => {
        // Simulates @supabase/ssr rotating the refresh token mid-request.
        if (mockRotated.length > 0) options.cookies.setAll(mockRotated);
        return { data: { user: mockUser }, error: null };
      },
    },
  }),
}));

import { proxy } from "../../../proxy";

const ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_KEY"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function req(path: string) {
  return new NextRequest(`https://pokefin.ca${path}`, {
    headers: { "x-forwarded-for": "203.0.113.50" },
  });
}
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

beforeEach(() => {
  _resetRateLimitStoreForTests();
  mockUser = null;
  mockRotated = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_KEY = "stub-key";
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("route protection", () => {
  it("redirects an anonymous /portfolio request to login with next=", async () => {
    const res = await proxy(req("/portfolio"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://pokefin.ca/auth/login?next=%2Fportfolio");
  });

  it("keeps nested account paths in next=", async () => {
    const res = await proxy(req("/account/settings"));
    expect(res.headers.get("location")).toBe(
      "https://pokefin.ca/auth/login?next=%2Faccount%2Fsettings"
    );
  });

  it("lets a signed-in user through", async () => {
    mockUser = { id: "u1" };
    const res = await proxy(req("/portfolio"));
    expect(passedThrough(res)).toBe(true);
  });

  it("does not protect unrelated paths", async () => {
    expect(passedThrough(await proxy(req("/api/products")))).toBe(true);
    expect(passedThrough(await proxy(req("/portfolio-tips")))).toBe(true);
  });

  it("fails closed (503) on protected paths when Supabase env is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect((await proxy(req("/account"))).status).toBe(503);
    expect(passedThrough(await proxy(req("/api/products")))).toBe(true);
  });
});

describe("session cookies (audit session-cookie F-1, F-5)", () => {
  const rotated: CookieToSet = {
    name: "sb-stub-auth-token",
    value: "rotated",
    options: { httpOnly: false, maxAge: 100, path: "/" },
  };

  it("copies a rotation that happened during getUser onto the login redirect, hardened", async () => {
    mockRotated = [rotated];
    const res = await proxy(req("/portfolio"));
    expect(res.status).toBe(307);
    const cookie = res.cookies.get("sb-stub-auth-token");
    expect(cookie).toMatchObject({ value: "rotated", httpOnly: true, sameSite: "lax", path: "/" });
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("keeps the rotation on a pass-through response too", async () => {
    mockUser = { id: "u1" };
    mockRotated = [rotated];
    const res = await proxy(req("/portfolio"));
    expect(passedThrough(res)).toBe(true);
    expect(res.cookies.get("sb-stub-auth-token")).toMatchObject({ value: "rotated", httpOnly: true });
  });
});
```

### 3. `frontend/app/lib/__tests__/cookieOptions.test.ts` (new, default env)

Cases for `hardenCookieOptions`:
- `undefined` gives `{ httpOnly: true, secure: false, sameSite: "lax", path: "/" }` under `NODE_ENV=test`.
- `{ httpOnly: false }` still gives `httpOnly: true`.
- `sameSite: "strict"`, `path: "/auth"`, `maxAge: 400` and `domain` are preserved.
- With `NODE_ENV=production`, `secure` is `true`; set it with `Object.assign(process.env, { NODE_ENV: "production" })` (the `NODE_ENV` type is readonly) and restore the original value in `afterEach`.

### 4. `frontend/app/lib/__tests__/routeSupabase.test.ts` (new)

Pins that server-minted cookies (sign-in, audit session-cookie F-2) are hardened.

```ts
/** @jest-environment node */
const mockSet = jest.fn();
jest.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [{ name: "sb-stub-auth-token", value: "v0" }],
    set: (...args: unknown[]) => mockSet(...args),
  }),
}));

type CookieMethods = {
  getAll: () => Array<{ name: string; value: string }>;
  setAll: (c: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => void;
};
let mockCookieMethods: CookieMethods | undefined;
jest.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: CookieMethods }) => {
    mockCookieMethods = opts.cookies;
    return {};
  },
}));

import { createRouteSupabaseClient } from "../routeSupabase";

it("reads the request cookies", async () => {
  await createRouteSupabaseClient();
  expect(mockCookieMethods!.getAll()).toEqual([{ name: "sb-stub-auth-token", value: "v0" }]);
});

it("writes every cookie HttpOnly with SameSite and path defaults", async () => {
  await createRouteSupabaseClient();
  mockCookieMethods!.setAll([
    { name: "sb-stub-auth-token", value: "v1", options: { httpOnly: false, maxAge: 400 } },
  ]);
  expect(mockSet).toHaveBeenCalledWith(
    "sb-stub-auth-token",
    "v1",
    expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 400 })
  );
});
```

### 5. `frontend/app/lib/__tests__/csrf.test.ts` (new)

`ALLOWED_ORIGINS` is computed at module load from `NEXT_PUBLIC_SITE_URL`, so load the module per case:

```ts
/** @jest-environment node */
import { NextRequest } from "next/server";

type CsrfModule = typeof import("../csrf");

async function loadCsrf(siteUrl?: string): Promise<CsrfModule> {
  if (siteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = siteUrl;
  let mod: CsrfModule | undefined;
  await jest.isolateModulesAsync(async () => {
    mod = await import("../csrf");
  });
  return mod!;
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
afterEach(() => Object.assign(process.env, { NODE_ENV: ORIGINAL_NODE_ENV }));

function post(headers: Record<string, string>) {
  return new NextRequest("https://pokefin.ca/api/x", { method: "POST", headers });
}
```

Cases:
- `isAllowedOrigin`: `null` false; `"https://pokefin.ca"` and `"https://www.pokefin.ca"` true; the `NEXT_PUBLIC_SITE_URL` value (`"https://preview.example"`) true only when loaded with it; `"https://evil.example"` and `"https://pokefin.ca.evil.example"` false; `"http://localhost:3000"` true under `NODE_ENV=test` and false after `Object.assign(process.env, { NODE_ENV: "production" })`.
- `rejectIfCsrfFails`: no `x-pokefin-request` gives 403 with body `{ error: "Forbidden" }`; `x-pokefin-request: "true"` gives 403; correct header without `origin` gives 403; correct header plus `origin: https://pokefin.ca` returns `null`.
- `rejectIfBodyTooLarge(req, 1024)`: `content-length: 2048` gives 413 `{ error: "Payload too large" }`; `1024`, a missing header and `"abc"` return `null`.
- `rejectIfNotAppRequest` (WP05 step 6a): missing header and `x-pokefin-request: "true"` give 403 `{ error: "Forbidden" }`; the correct header with no `origin` returns `null` (it deliberately skips the Origin check, for same-origin GETs).
- Restore `NEXT_PUBLIC_SITE_URL` to its original value in `afterAll`.

### 6. `frontend/app/api/account/delete/__tests__/route.test.ts` (new)

```ts
/** @jest-environment node */
/**
 * DELETE /api/account/delete (review F050). Pins the CSRF gate, the body cap,
 * the auth gate, the RPC call and the generic 500. WP20 moves the inline CSRF
 * block onto lib/csrf.ts; these cases must keep passing through that change
 * (update only the mocks if the route switches to routeSupabase).
 */
import { NextRequest } from "next/server";

const mockGetUser = jest.fn();
const mockRpc = jest.fn();
const mockSignOut = jest.fn();
const mockLogSupabaseError = jest.fn();

jest.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
jest.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: (...a: unknown[]) => mockGetUser(...a),
      signOut: (...a: unknown[]) => mockSignOut(...a),
    },
    rpc: (...a: unknown[]) => mockRpc(...a),
  }),
}));
// Keep the real helpers (csrf.ts or routeSupabase.ts may import others after
// WP20) and spy only on the one this route calls.
jest.mock("../../../../lib/logger", () => ({
  ...jest.requireActual("../../../../lib/logger"),
  logSupabaseError: (...a: unknown[]) => mockLogSupabaseError(...a),
}));

import { DELETE } from "../route";

const USER_ID = "22222222-2222-2222-2222-222222222222";

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/account/delete", {
    method: "DELETE",
    headers: { "x-pokefin-request": "1", origin: "http://localhost:3000", ...headers },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mockRpc.mockResolvedValue({ data: null, error: null });
  mockSignOut.mockResolvedValue({ error: null });
});

it("rejects a request without the app header", async () => {
  const res = await DELETE(makeRequest({ "x-pokefin-request": "" }));
  expect(res.status).toBe(403);
  expect(mockRpc).not.toHaveBeenCalled();
});
```

Remaining cases in the same style: cross-site `origin: https://evil.example` gives 403 and no RPC; `content-length: 2048` gives 413 and no `getUser`; `getUser` resolving `{ data: { user: null }, error: null }` gives 401 and no RPC; `getUser` resolving `{ data: { user: null }, error: { message: "x" } }` gives 401; RPC error `{ code: "P0001", message: "x" }` gives 500 `{ error: "Failed to delete account" }`, calls `mockLogSupabaseError("delete_my_account_failed", expect.objectContaining({ code: "P0001" }))` and does not call `signOut`; success gives 200 `{ success: true }`, `mockRpc` called with `"delete_my_account"`, `mockSignOut` called once.

### 7. `frontend/app/lib/__tests__/import.test.ts` (update: `matchProduct`)

Extend the import to `import { matchProduct, parseCollectrCSV, calculateImportSummary } from "../import";` and add `CollectrCSVRow, ProductSearchResult` to the type import. Keep the existing `../supabase` mock (after WP05, add a mock for any module `import.ts` imports that builds a client at load time, if the suite fails to load). Append:

```ts
describe("matchProduct", () => {
  function row(set: string, productName: string): CollectrCSVRow {
    return {
      portfolioName: "Sealed Product", category: "Pokemon", set, productName,
      cardNumber: "", rarity: "", variance: "", grade: "", cardCondition: "",
      averageCostPaid: 100, quantity: 1, marketPrice: 0, priceOverride: 0,
      watchlist: false, dateAdded: "", notes: "",
    };
  }
  function product(id: number, setName: string, typeLabel: string, variant: string | null = null): ProductSearchResult {
    return {
      id, usd_price: 100, image_url: null, variant,
      sets: { name: setName, code: "X" },
      product_types: { name: typeLabel.toLowerCase().replace(/\W+/g, "_"), label: typeLabel },
    };
  }

  it("rejects unsupported product types", () => {
    expect(matchProduct(row("Surging Sparks", "Surging Sparks Card Sleeves"), [])).toEqual({
      product: null, confidence: "none", unmatchedReason: "Unsupported product type",
    });
  });

  it("reports an unknown set", () => {
    const r = matchProduct(row("Unknown Set", "Unknown Set Booster Box"), [product(1, "Surging Sparks", "Booster Box")]);
    expect(r).toMatchObject({ product: null, confidence: "none", unmatchedReason: "Set not found in database" });
  });

  it("reports a missing type within a known set", () => {
    const r = matchProduct(row("Surging Sparks", "Surging Sparks Elite Trainer Box"), [product(1, "Surging Sparks", "Booster Box")]);
    expect(r.unmatchedReason).toBe("No matching elite trainer boxes for this set");
  });

  it("matches a single candidate with high confidence, ignoring an SV: prefix", () => {
    const products = [product(1, "Surging Sparks", "Booster Box"), product(2, "Surging Sparks", "Elite Trainer Box")];
    expect(matchProduct(row("SV: Surging Sparks", "Surging Sparks Booster Box"), products)).toEqual({
      product: products[0], confidence: "high",
    });
  });
});
```

More cases in the same describe:
- Exact set name wins among several candidates: products `[product(3, "Surging Sparks Extra", "Booster Box"), product(1, "Surging Sparks", "Booster Box")]`, row set `"Surging Sparks"` gives product 1 with `"exact"`.
- Variant hint: products `[product(10, "Prismatic Evolutions", "Elite Trainer Box"), product(11, "Prismatic Evolutions", "Elite Trainer Box", "Pokemon Center")]`, row `("Prismatic", "Prismatic Evolutions Pokemon Center Elite Trainer Box")` gives 11 `"high"`; the same without "Pokemon Center" in the name gives 10 `"low"`.
- Tin vs mini tin: products `[product(20, "Paldean Fates", "Tin"), product(21, "Paldean Fates", "Mini Tin")]`; `"Paldean Fates Mini Tin"` gives 21 `"high"`, `"Paldean Fates Tin"` gives 20 `"high"`.
- 3-pack blister: products `[product(30, "Stellar Crown", "3-Pack Blister"), product(31, "Stellar Crown", "Blister")]`; `"Stellar Crown 3 Pack Blister"` gives 30 `"high"`.

### 8. `frontend/app/components/BoxCalculator/__tests__/nav.test.ts` (new)

```ts
import { calculateNav } from "../nav";
import type { PackEntry } from "../types";

const pack = (setId: number, quantity: number, setName = `Set ${setId}`): PackEntry => ({
  id: `p${setId}`, setId, setName, quantity,
});
const identity = (usd: number) => usd;
const priced = (prices: Record<number, number | null>) => (setId: number) => prices[setId] ?? null;
```

Cases:
- `[]` packs, `retailPrice <= 0` (0 and -5): `null`.
- Any pack whose `getPackPrice` returns `null`: `null` (even when other packs are priced).
- 36 packs at 4, promo 10, retail 120, identity: `totalPackValue 144`, `nav 154`, `premiumDiscount -34`, `premiumDiscountPercent` close to `-22.0779`, `signal "buy"`, `packBreakdown [{ setName: "Set 1", quantity: 36, perPackPrice: 4, totalValue: 144 }]`.
- Thresholds with one pack at 100 and promo 0: retail 90 gives `"buy"` (exactly -10%); 90.01 `"hold"`; 105 `"hold"` (exactly +5%); 105.01 `"avoid"`.
- `convertPackPrice` is applied per pack: price 4, convert `usd => usd * 1.36`, quantity 2: `perPackPrice` close to 5.44, `totalValue` close to 10.88; promo and retail are used as given (not converted).
- `nav` of 0 (pack price 0, promo 0, retail 10): `premiumDiscountPercent 0`, `signal "hold"`.

### 9. `frontend/app/components/MarketView/__tests__/buildRows.test.ts` (new)

Use fake time so `getReturnPercent`'s default reference date is fixed:

```ts
import { buildMarketRow, buildMarketRows, getReleaseMs } from "../buildRows";
import type { PriceHistoryEntry, Product, ProductVolumeMetrics } from "../../ProductPrices/types";

const TODAY = Date.UTC(2026, 8, 25); // 2026-09-25, 90 days after 2026-06-27
const identity = (usd: number) => usd;

const history: PriceHistoryEntry[] = [
  { usd_price: 100, recorded_at: "2026-06-27T00:00:00Z" },
  { usd_price: 80, recorded_at: "2026-07-27T00:00:00Z" },
  { usd_price: 120, recorded_at: "2026-09-25T00:00:00Z" },
];

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1, usd_price: 120, url: "https://example.com/p/1",
    last_updated: "2026-09-25T00:00:00Z", price_recorded_at: "2026-09-25T00:00:00Z",
    sets: { name: "Test Set", code: "TS", release_date: "2026-06-27" },
    product_types: { id: 1, name: "booster_box", label: "Booster Box" },
    returns: null,
    ...overrides,
  };
}

const volume: ProductVolumeMetrics = {
  product_id: 1, units_sold_7d: null, units_sold_30d: 30, units_sold_prior_30d: 20,
  transaction_count_30d: null, active_listings: null, total_quantity_available: null,
  lowest_listing_price: null, listings_snapshot_date: null,
};

beforeEach(() => jest.useFakeTimers({ now: new Date("2026-09-25T12:00:00Z") }));
afterEach(() => jest.useRealTimers());
```

Cases:
- Priced product, `returns: { "1D": null, "7D": 5, "1M": null, "3M": null, "6M": null, "1Y": null }`, with `history` and `volume`: `returns` equals `{ "7D": 5, "1M": 50, "3M": 20, "6M": null, "1Y": null }` (server value wins for 7D; 1M and 3M fall back to history: 80 to 120 and 100 to 120); `releaseMs === Date.UTC(2026, 5, 27)`; `daysSinceRelease 90`; `price 120`; `pricePerDay` close to `120 / 90`; `cagr` close to `(Math.pow(1.2, 365 / 90) - 1) * 100`; `maxDrawdown 20`; `volatility30d` close to `35 * Math.sqrt(365)`; `unitsSold30d 30`; `volumeTrend 50`.
- Currency conversion `usd => usd * 1.5`: `price 180`, `pricePerDay 2`, returns unchanged.
- Unpriced (`usd_price: null`, same server returns): every return `null`, `price`, `pricePerDay` and `cagr` `null`, but `maxDrawdown` still 20 and `volatility30d` not null (ungated by design).
- No volume: `unitsSold30d` and `volumeTrend` `null`.
- Release date `""` gives `releaseMs`, `daysSinceRelease` and `pricePerDay` `null`; release `"2026-09-25"` gives `daysSinceRelease 0` and `pricePerDay null`; a future release `"2026-12-01"` gives `daysSinceRelease 0`.
- `getReleaseMs`: `"2026-06-27T00:00:00+00:00"` and `"2026-06-27 10:00:00"` give `Date.UTC(2026, 5, 27)`; `"June 27"`, `null` and `undefined` give `null`.
- `buildMarketRows([p1, p2], { 1: history }, { 1: volume }, identity, TODAY)` returns two rows in input order, the second with `history` `undefined`.

### 10. `frontend/app/components/Portfolio/__tests__/HoldingsTable.test.tsx` (update)

Add to the "Sort button styling" describe (uses the file's existing `testHoldings`, `mockOnEdit`, `mockOnDelete`):

```tsx
    it("keeps the same button and keyboard focus after sorting (review F056)", () => {
      render(
        <HoldingsTable holdings={testHoldings} onEdit={mockOnEdit} onDelete={mockOnDelete} />
      );
      const valueButton = screen.getByRole("button", { name: /Value/ });
      valueButton.focus();
      fireEvent.click(valueButton);
      expect(screen.getByRole("button", { name: /Value/ })).toBe(valueButton);
      expect(document.activeElement).toBe(valueButton);
      fireEvent.click(valueButton); // second activation flips the direction
      expect(document.activeElement).toBe(valueButton);
    });
```

Before step 7 this test fails (the re-queried button is a different node and focus is on `<body>`); after step 7 it passes. Remove `within` from the import if it is unused.

### 11. `frontend/app/components/charts/__tests__/chartTooltips.test.tsx` (new)

```tsx
// The tooltips never render Recharts parts; stub the module so importing the
// chart files does not pull Recharts into jsdom.
jest.mock("recharts", () => ({}));

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AllocationTooltip } from "../AllocationChartImpl";
import { PortfolioTooltip } from "../PortfolioChartImpl";
import { PriceDot, PriceTooltip } from "../../PriceChart";
```

Cases:
- `AllocationTooltip`: `active={false}` renders nothing (`container` is empty); `active` with `payload={[{ payload: { name: "151", value: 1234.5, percentage: 42.25, color: "#000" } }]}` and `currency="CAD"` shows "151", "C$1,234.50" and "42.3%".
- `PortfolioTooltip`: `payload={[{ value: null }]}` renders nothing; `payload={[{ value: 1500, payload: { isPartial: true, pricedProducts: 2, heldProducts: 3 } }]}`, `label="Sep 25"`, `currency="USD"` shows "Sep 25", "$1,500.00" and text matching `/2 of 3/`.
- `PriceTooltip`: payload `[{ dataKey: "volume", value: 7 }, { dataKey: "price", value: 12.5, payload: { volume: 7, volumeIsWeekly: true } }]`, `hasVolume` true: shows "$12.50" and "7 sold (week)"; with `hasVolume={false}` no "sold" text; a price entry with `value: null` renders nothing.
- `PriceDot`: `payload={{ price: null }}` renders nothing; `payload={{ price: 10 }}` inside an `<svg>` renders one `circle`.

### 12. `frontend/app/components/ProductPrices/__tests__/useCurrencyConversion.test.tsx` (new)

Mock `../../../lib/exchangeRate` (`fetchLatestExchangeRateClient: (...a) => mockFetchRate(...a)`) and `../../../lib/logger` (`logCaughtError: (...a) => mockLogCaughtError(...a)`). Use `renderHook` and `waitFor` from `@testing-library/react`. Cases:
- `useCurrencyConversion(1.4)`: `exchangeRate 1.4`, `exchangeRateLoading false`, `mockFetchRate` never called.
- `useCurrencyConversion()`: first render `exchangeRate 1.36` and `exchangeRateLoading true`; after `mockFetchRate` resolves `{ rate: 1.5, date: null }`, `exchangeRate 1.5` and `exchangeRateLoading false`.
- Rejection: `exchangeRate 1.36`, `exchangeRateLoading false`, `mockLogCaughtError` called with `"exchange_rate_load_failed"`.
- `convertPrice(10)` is close to `14` (`toBeCloseTo`) with rate 1.4 in CAD; after `act(() => result.current.setSelectedCurrency("USD"))` it is `10`.
- For the "first render" case make `mockFetchRate` return a promise you resolve by hand (`let resolve!: (v: { rate: number; date: null }) => void; mockFetchRate.mockReturnValue(new Promise((r) => { resolve = r; }))`), assert, then `await act(async () => resolve({ rate: 1.5, date: null }))`.

### 13. `frontend/app/lib/__tests__/instrumentation.test.ts` (new)

```ts
/** @jest-environment node */
import type { Instrumentation } from "next";

const mockServerConfigLoaded = jest.fn();
const mockEdgeConfigLoaded = jest.fn();
const mockCaptureRequestError = jest.fn();

jest.mock("../../../sentry.server.config", () => {
  mockServerConfigLoaded();
  return {};
});
jest.mock("../../../sentry.edge.config", () => {
  mockEdgeConfigLoaded();
  return {};
});
jest.mock("@sentry/nextjs", () => ({
  captureRequestError: (...a: unknown[]) => mockCaptureRequestError(...a),
}));

const ENV_KEYS = ["NEXT_RUNTIME", "NEXT_PUBLIC_SENTRY_DSN", "SENTRY_DSN"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const DSN = "https://k@o1.ingest.us.sentry.io/2";

// Fresh module per case: the sentry.*.config mocks count how often they load.
function load() {
  return import("../../../instrumentation");
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

it("loads no Sentry config while no DSN is set", async () => {
  process.env.NEXT_RUNTIME = "nodejs";
  await (await load()).register();
  expect(mockServerConfigLoaded).not.toHaveBeenCalled();
  expect(mockEdgeConfigLoaded).not.toHaveBeenCalled();
});

it("loads the server Sentry config in the Node.js runtime", async () => {
  process.env.NEXT_RUNTIME = "nodejs";
  process.env.SENTRY_DSN = DSN; // a server-only DSN is enough
  await (await load()).register();
  expect(mockServerConfigLoaded).toHaveBeenCalledTimes(1);
  expect(mockEdgeConfigLoaded).not.toHaveBeenCalled();
});

it("loads the edge Sentry config in the edge runtime", async () => {
  process.env.NEXT_RUNTIME = "edge";
  process.env.NEXT_PUBLIC_SENTRY_DSN = DSN;
  await (await load()).register();
  expect(mockEdgeConfigLoaded).toHaveBeenCalledTimes(1);
  expect(mockServerConfigLoaded).not.toHaveBeenCalled();
});

it("forwards request errors to Sentry only when a DSN is set", async () => {
  const { onRequestError } = await load();
  const err = new Error("boom");
  const request: Parameters<Instrumentation.onRequestError>[1] = {
    path: "/api/x",
    method: "GET",
    headers: {},
  };
  const context: Parameters<Instrumentation.onRequestError>[2] = {
    routerKind: "App Router",
    routePath: "/api/x",
    routeType: "route",
    revalidateReason: undefined,
  };
  await onRequestError(err, request, context);
  expect(mockCaptureRequestError).not.toHaveBeenCalled();

  process.env.SENTRY_DSN = DSN;
  await onRequestError(err, request, context);
  expect(mockCaptureRequestError).toHaveBeenCalledWith(err, request, context);
});
```

### 14. `frontend/app/lib/__tests__/nextConfig.csp.test.ts` (new)

```ts
/** @jest-environment node */
import type { NextConfig } from "next";

jest.mock("@sentry/nextjs", () => ({ withSentryConfig: (config: unknown) => config }));

type HeaderList = Array<{ key: string; value: string }>;

async function headersFor(dsn: string | undefined): Promise<HeaderList> {
  if (dsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  else process.env.NEXT_PUBLIC_SENTRY_DSN = dsn;
  let config: NextConfig | undefined;
  await jest.isolateModulesAsync(async () => {
    config = (await import("../../../next.config")).default;
  });
  const rules = await config!.headers!();
  return rules.find((r) => r.source === "/:path*")!.headers;
}
async function cspFor(dsn: string | undefined): Promise<string> {
  const headers = await headersFor(dsn);
  return headers.find((h) => h.key === "Content-Security-Policy")!.value;
}
const directive = (csp: string, name: string) =>
  csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

const SAVED_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
afterEach(() => {
  if (SAVED_DSN === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  else process.env.NEXT_PUBLIC_SENTRY_DSN = SAVED_DSN;
});

const DSN = "https://abc123@o4507.ingest.us.sentry.io/4508";
const REPORT_URL = "https://o4507.ingest.us.sentry.io/api/4508/security/?sentry_key=abc123";

it("has no Sentry origin and no reporting without a DSN", async () => {
  const csp = await cspFor(undefined);
  expect(directive(csp, "connect-src")).toBe(
    "connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com"
  );
  expect(csp).not.toMatch(/report-uri|report-to/);
  expect((await headersFor(undefined)).some((h) => h.key === "Reporting-Endpoints")).toBe(false);
});

it("allows exactly the DSN's ingest origin", async () => {
  const connect = directive(await cspFor(DSN), "connect-src");
  expect(connect.endsWith(" https://o4507.ingest.us.sentry.io")).toBe(true);
  expect(connect).not.toContain("*.ingest");
  expect(connect).not.toContain("abc123");
});

it("reports violations of the enforced policy to the project's security endpoint", async () => {
  const csp = await cspFor(DSN);
  expect(directive(csp, "report-uri")).toBe(`report-uri ${REPORT_URL}`);
  expect(directive(csp, "report-to")).toBe("report-to csp-endpoint");
  expect(await headersFor(DSN)).toContainEqual({
    key: "Reporting-Endpoints",
    value: `csp-endpoint="${REPORT_URL}"`,
  });
  expect((await headersFor(DSN)).some((h) => h.key === "Content-Security-Policy-Report-Only")).toBe(false);
});

it("ignores a malformed, non-https or empty DSN", async () => {
  for (const dsn of ["not a url", "http://k@o1.ingest.sentry.io/2", "https://o1.ingest.sentry.io/2", ""]) {
    const csp = await cspFor(dsn);
    expect(directive(csp, "connect-src")).not.toContain("sentry");
    expect(csp).not.toMatch(/report-uri|report-to/);
  }
});

it("keeps script-src on 'unsafe-inline' without nonces or hashes", async () => {
  const script = directive(await cspFor(undefined), "script-src");
  expect(script).toContain("'unsafe-inline'");
  expect(script).not.toMatch(/'nonce-|'sha(256|384|512)-|strict-dynamic/);
});
```

### 15. `frontend/app/lib/__tests__/sentryScrub.test.ts` (new)

```ts
/** @jest-environment node */
import { scrubSentryEvent, type SentryEventLike } from "../sentryScrub";

const mockInit = jest.fn();
jest.mock("@sentry/nextjs", () => ({ init: (...a: unknown[]) => mockInit(...a) }));

function dirtyEvent(): SentryEventLike & { message: string } {
  return {
    message: "holding_insert_failed",
    user: { email: "a@b.c", ip_address: "203.0.113.5" },
    request: {
      cookies: { "sb-ref-auth-token": "secret" },
      headers: {
        cookie: "sb-ref-auth-token=secret",
        Authorization: "Bearer secret",
        "x-forwarded-for": "203.0.113.5",
        "user-agent": "jest",
      },
    },
    extra: { code: "23505", details: "schema fragment", hint: "use ON CONFLICT" },
  };
}

describe("scrubSentryEvent", () => {
  it("removes identity, cookies, auth and IP headers and Supabase details/hint", () => {
    const event = dirtyEvent();
    scrubSentryEvent(event);
    expect(event).toEqual({
      message: "holding_insert_failed",
      user: {},
      request: { headers: { "user-agent": "jest" } },
      extra: { code: "23505" },
    });
  });

  it("accepts an event without user, request or extra", () => {
    const event: SentryEventLike = {};
    expect(() => scrubSentryEvent(event)).not.toThrow();
    expect(event).toEqual({});
  });
});

describe("server and edge configs install the scrubber", () => {
  const saved = { pub: process.env.NEXT_PUBLIC_SENTRY_DSN, srv: process.env.SENTRY_DSN };
  beforeEach(() => {
    mockInit.mockClear();
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    process.env.SENTRY_DSN = "https://k@o1.ingest.us.sentry.io/2";
  });
  afterAll(() => {
    if (saved.pub === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = saved.pub;
    if (saved.srv === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = saved.srv;
  });

  type Hook = (event: SentryEventLike) => SentryEventLike | null;
  async function initOptions(load: () => Promise<unknown>) {
    await jest.isolateModulesAsync(async () => {
      await load();
    });
    expect(mockInit).toHaveBeenCalledTimes(1);
    return mockInit.mock.calls[0][0] as { beforeSend: Hook; beforeSendTransaction: Hook };
  }

  it.each([
    ["server", () => import("../../../sentry.server.config")],
    ["edge", () => import("../../../sentry.edge.config")],
  ])("%s config scrubs errors and transactions", async (_name, load) => {
    const options = await initOptions(load);
    for (const hook of [options.beforeSend, options.beforeSendTransaction]) {
      const out = hook(dirtyEvent());
      expect(out?.request?.headers).toEqual({ "user-agent": "jest" });
      expect(out?.request?.cookies).toBeUndefined();
      expect(out?.extra).toEqual({ code: "23505" });
    }
  });
});
```

## Verification

Run from `frontend/`:

```bash
pnpm exec tsc --noEmit
# expect: no output, exit 0

pnpm run lint
# expect: exit 0 and a last line like "✖ N problems (0 errors, N warnings)".

pnpm exec eslint . -f json -o /tmp/wp17-lint.json
node -e 'const r=require("/tmp/wp17-lint.json");const c={};for(const f of r)for(const m of f.messages){const k=(m.severity===2?"error ":"warn  ")+(m.ruleId||"unused-directive");c[k]=(c[k]||0)+1}console.log(c)'
# expect: only "warn  @next/next/no-img-element" and "warn  no-console" (the latter only for scripts/)

# no-console actually fires in app code (lints stdin; no file is written):
echo 'export const x = () => console.error("x");' | pnpm exec eslint --stdin --stdin-filename app/lib/probe.ts
# expect: 1 error, no-console
echo 'export const x = () => console.error("x");' | pnpm exec eslint --stdin --stdin-filename app/lib/logger.ts
# expect: no output

pnpm test --ci app/lib/__tests__/logger.test.ts app/lib/__tests__/proxy.test.ts \
  app/lib/__tests__/proxy.rateLimit.test.ts app/lib/__tests__/cookieOptions.test.ts \
  app/lib/__tests__/routeSupabase.test.ts app/lib/__tests__/csrf.test.ts \
  app/api/account/delete/__tests__/route.test.ts app/api/account/export/__tests__/route.test.ts \
  app/lib/__tests__/import.test.ts app/components/BoxCalculator/__tests__/nav.test.ts \
  app/components/MarketView/__tests__/buildRows.test.ts \
  app/components/Portfolio/__tests__/HoldingsTable.test.tsx \
  app/components/charts/__tests__/chartTooltips.test.tsx \
  app/components/ProductPrices/__tests__/useCurrencyConversion.test.tsx \
  app/lib/__tests__/instrumentation.test.ts app/lib/__tests__/nextConfig.csp.test.ts \
  app/lib/__tests__/sentryScrub.test.ts
# expect: all suites pass

pnpm test --ci 2>&1 | grep -E "^Tests?( Suites)?:"
# expect: all suites pass; "Test Suites" count = the number in /tmp/wp17-jest-before.txt + 12
# (12 new files: proxy, cookieOptions, routeSupabase, csrf, delete route, nav, buildRows,
# chartTooltips, useCurrencyConversion, instrumentation, nextConfig.csp, sentryScrub).

# Coverage config: proxy.ts included, server pages excluded, client pages included.
pnpm exec jest --showConfig | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log((j.globalConfig.collectCoverageFrom||j.configs[0].collectCoverageFrom).join("\n"))})'
# expect: 'proxy.ts'; no '!app/**/page.tsx'; '!app/page.tsx', '!app/prices/page.tsx', '!app/product/\[id\]/page.tsx'
# and one '!' entry for every other server page. Cross-check against the client pages:
grep -rlE "^\s*[\"']use client[\"']" app --include=page.tsx
# expect: none of the paths printed here appears as a '!' entry above (at the time of writing:
# app/account, app/portfolio and the auth pages other than login; WP11 made compare/page.tsx
# and WP13 made auth/login/page.tsx server components, so those two ARE excluded).
pnpm test:coverage --ci --coverageReporters=text 2>/dev/null | grep -E "proxy.ts|csrf.ts|cookieOptions.ts|buildRows.ts|nav.ts"
# expect: a row for each; csrf.ts, cookieOptions.ts, buildRows.ts and nav.ts at or near 100% lines.

pnpm build:stub 2>&1 | tee /tmp/wp17-build.log | tail -40
grep -c "\[@sentry/nextjs\] ACTION REQUIRED" /tmp/wp17-build.log
# expect: build succeeds; the grep prints 0 (withSentryConfig found onRouterTransitionStart
# in instrumentation-client.ts). The old client-config deprecation warning is webpack-only
# and never appears under Turbopack, so its absence proves nothing.
ls .next/server | grep -i instrumentation
# expect: at least one instrumentation*.js file
grep -o "connect-src[^;]*" .next/routes-manifest.json | sort -u
# expect: connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com   (no sentry, stub build has no DSN)
grep -c "report-uri\|Reporting-Endpoints" .next/routes-manifest.json
# expect: 0 (no DSN, no reporting)

# Bundle: rerun the measurement snippet from "Before you start" and compare.
# expect: every page within 1 kB gzip of /tmp/wp17-bundle-before.txt (Sentry is not in first-load JS).

# Raw console calls are gone from app code:
grep -rn "console\.\(log\|info\|warn\|error\|debug\)(" app proxy.ts instrumentation*.ts --include=*.ts --include=*.tsx \
  | grep -v "/__tests__/" | grep -v "^app/lib/logger.ts"
# expect: no output

grep -n "continue-on-error" ../.github/workflows/ci.yml
# expect: no output
test ! -e sentry.client.config.ts && test -e instrumentation.ts && test -e instrumentation-client.ts && echo ok
# expect: ok
```

No Python changes, so no pytest run.

Manual checks (local, `pnpm dev` with the stub or real env):

1. `/portfolio` (signed in, or render `HoldingsTable` in the test above): Tab to "Value", press Enter twice. Focus stays on "Value" and the arrow flips between up and down; the focus ring never disappears.
2. `/market`: expand a row, hover the chart, switch currency. The tooltip shows the same text as before this PR, and on the 7D range the dots render.
3. `/portfolio` allocation and history charts: hover shows the same tooltip content as before.
4. Browser devtools Network with no DSN configured: no request to any `sentry.io` host and no Sentry chunk loaded on any page.
5. With a fake DSN: `NEXT_PUBLIC_SENTRY_DSN=https://abc123@o1.ingest.us.sentry.io/2 pnpm dev` (plus your usual Supabase env), then `curl -sI http://localhost:3000/ | grep -io "connect-src[^;]*"` shows `https://o1.ingest.us.sentry.io` at the end, and the same headers contain `report-uri https://o1.ingest.us.sentry.io/api/2/security/?sentry_key=abc123` and `Reporting-Endpoints`. In the browser console run `setTimeout(() => { throw new Error("wp17 probe") })`: the Network tab shows a POST to `o1.ingest.us.sentry.io/api/2/envelope/` (Sentry rejects the fake key; that is fine) and the console shows no "Refused to connect" CSP error. Stop the server; do not commit any env file.

## Owner actions

None are required to merge or deploy: with no DSN set, everything added here is inert.

Optional, to turn on error reporting (the reason for F108 and F128):

1. Create a Sentry project (platform: Next.js). Copy its DSN (`https://<key>@o<org>.ingest.<region>.sentry.io/<project>`).
2. Vercel, project settings, Environment Variables: add `NEXT_PUBLIC_SENTRY_DSN` with that value for Production and Preview. Optionally add `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` for source-map upload.
3. Redeploy (the DSN and the CSP are read at build time; a variable change alone does nothing).
4. Confirm: `curl -sI https://pokefin.ca | grep -i content-security-policy` shows your `https://o<org>.ingest.<region>.sentry.io` origin at the end of `connect-src`, plus `report-uri https://o<org>.ingest.<region>.sentry.io/api/<project>/security/?sentry_key=<key>` and `report-to csp-endpoint`; `curl -sI https://pokefin.ca | grep -i reporting-endpoints` prints the same URL. Open the site, open devtools console, run `setTimeout(() => { throw new Error("sentry smoke test") })`. In the Network tab a POST to `.../api/<project>/envelope/` returns 200 with no CSP violation in the console, and the Sentry project shows a "sentry smoke test" issue within a minute.
5. In the Sentry project settings, leave "Data Scrubber" and "Use Default Scrubbers" on (they are on by default); the app already strips cookies, auth and IP headers, emails and Supabase `details`/`hint`, and the server-side scrubber is the second layer. Add an alert rule ("A new issue is created", notify by email) so handled failures such as `export_my_data_failed` (the WP01 ops note) reach you instead of sitting in the dashboard. CSP violation reports arrive as their own event type and count against the quota; if browser extensions flood them, add an Inbound Filter for the offending source instead of removing `report-uri`.
6. Branch protection needs no change: lint is a step inside the "Frontend (lint + typecheck + tests)" job, which WP00 owner action 1 confirmed as required. Confirm under GitHub, Settings, Branches (or Rules), rule for `master`, that this job is still listed as required; if it is not, add it, or blocking lint blocks nothing (F076: Dependabot PR #52 reached `master` because no build check was required). If WP00's optional owner action 5 (Vercel preview as a required check) was skipped, do it now as well.

## Acceptance criteria

- [ ] `pnpm run lint` exits 0 with 0 errors; the only warnings are `@next/next/no-img-element` and `no-console` in `scripts/`.
- [ ] `.github/workflows/ci.yml` has no `continue-on-error`; the lint step is named "Lint".
- [ ] `eslint.config.mjs` enforces `no-console: error` for `app/**`, `proxy.ts` and the instrumentation files (except `app/lib/logger.ts` and tests) and `warn` for `scripts/**`; its default export is a named constant.
- [ ] No `console.*` call exists in `app/` (outside tests and `logger.ts`) or `proxy.ts`.
- [ ] `logger.ts` exports `logSupabaseError`, `logCaughtError`, `logHttpFailure`, `logWarning`; with a DSN set it reports through a lazily imported `@sentry/nextjs` (`captureMessage` for sanitized fields, `captureException` for Error instances, nothing for AbortError or HTTP 4xx); without a DSN it imports nothing.
- [ ] `frontend/instrumentation.ts` and `frontend/instrumentation-client.ts` exist and import nothing from `@sentry/nextjs` while no DSN is set; `frontend/sentry.client.config.ts` does not exist; the stub build prints no `[@sentry/nextjs] ACTION REQUIRED` line.
- [ ] `app/lib/sentryScrub.ts` exists and is the `beforeSend` and `beforeSendTransaction` of the browser, server and edge inits; it removes the `cookie`, `authorization` and IP headers, `request.cookies`, `user.email`, `user.ip_address` and the `details`/`hint` extras.
- [ ] With `NEXT_PUBLIC_SENTRY_DSN` set, CSP `connect-src` contains exactly the DSN's https origin, the CSP ends with `report-uri <security endpoint>` and `report-to csp-endpoint`, and a `Reporting-Endpoints` header names the same URL; without it, the CSP and header list are unchanged. No `Content-Security-Policy-Report-Only` header exists. `next.config.ts` documents why `script-src` keeps `'unsafe-inline'`.
- [ ] `SortButton`, `AllocationTooltip`, `PortfolioTooltip`, `PriceTooltip` and `PriceDot` are declared at module scope; the HoldingsTable focus test passes.
- [ ] `useCurrencyConversion` has no setState call in an effect body.
- [ ] `calculateNav` lives in `BoxCalculator/nav.ts`, `matchProduct` is exported, MarketView rows are built by `MarketView/buildRows.ts`; each has the tests listed above.
- [ ] New tests exist and pass for `proxy.ts`, `cookieOptions.ts`, `routeSupabase.ts`, `csrf.ts`, the account delete route, `instrumentation.ts`, the CSP and `sentryScrub.ts` (including the server and edge configs).
- [ ] `collectCoverageFrom` includes `proxy.ts` and every `"use client"` page, and excludes only server pages.
- [ ] `tsc --noEmit`, the full Jest suite and `pnpm build:stub` pass; first-load JS per page is within 1 kB gzip of the baseline.
- [ ] `audits/HARDENING_FOLLOWUPS.md`, `frontend/.env.example` and `audits/remediation/00-PLAN.md` are updated as in steps 6d and 16.

## Rollback

No migrations, no data changes, no environment variables. Revert the merge commit (`git revert -m 1 <merge-sha>`) and redeploy. Partial rollbacks are safe per area:

- CI gate only: restore `continue-on-error: true` on the lint step (only if an urgent fix is blocked by a lint regression; fix the lint in the next PR and remove it again).
- Sentry only: revert `instrumentation.ts`, `instrumentation-client.ts`, `app/lib/sentryScrub.ts` and its test, the `sentry.server.config.ts`/`sentry.edge.config.ts` edits, restore `sentry.client.config.ts`, and revert the `logger.ts` Sentry lines; the console output is unchanged either way. If the DSN is already set in Vercel, removing it and redeploying disables all reporting, the `connect-src` entry and the CSP reporting.
- Component hoisting, `useCurrencyConversion`, and the three extractions (`nav.ts`, `buildRows.ts`, `matchProduct` export) are behaviour-preserving and independent; revert the file and its test together.

## Commit and PR

Commit message:

```text
chore(quality): zero lint errors, critical-path tests, Sentry wiring, blocking lint (WP17)

- Hoist HoldingsTable SortButton and the Recharts tooltips/dot to module
  scope so they stop remounting (sort buttons kept losing focus) (F056)
- Derive useCurrencyConversion's rate instead of syncing it in an effect
- Route every console call through app/lib/logger.ts; add logHttpFailure
  and logWarning; enforce no-console (warn in scripts/) (F108)
- Logger reports to Sentry via a lazy import when a DSN is set; add
  instrumentation.ts and instrumentation-client.ts (replaces
  sentry.client.config.ts, which Turbopack ignores) (F108)
- Scrub cookies, auth/IP headers, emails and Supabase details/hint from
  every Sentry event in all three runtimes (app/lib/sentryScrub.ts)
- CSP connect-src allows the DSN's ingest origin and the enforced CSP
  reports violations to the project's security endpoint, both only when a
  DSN is set; document why script-src keeps 'unsafe-inline' (F128)
- Tests for proxy.ts, cookieOptions, routeSupabase, csrf, the account
  delete route, matchProduct, calculateNav (moved to nav.ts), MarketView
  row derivation (moved to buildRows.ts), chart tooltips, the currency
  hook, instrumentation, the CSP and the Sentry scrubber (F050)
- Coverage includes proxy.ts and client pages; excludes only server pages
- CI: lint is blocking (F076)
```

PR title: `WP17: zero lint errors, critical-path tests, Sentry wiring, blocking lint`

PR body summary: link `audits/remediation/WP17-lint-tests-observability-ci-gate.md`; list F056, F050, F108, F128 and F076 (lint part) with one line each from the metadata above; state the corrections to the plan (the logger uses a lazy import with `captureMessage` for sanitized fields; `instrumentation-client.ts` is also required because Turbopack ignores `sentry.client.config.ts`; `instrumentation.ts` imports Sentry only when a DSN is set; every Sentry runtime scrubs the session cookie header, which the server SDK would otherwise send; CSP violation reporting was added to the enforced policy per the F128 verifiers; `calculateNav` moved to `nav.ts` rather than exported from the component file; MarketView rows moved to `buildRows.ts`); paste the lint rule counts before and after, the targeted and full Jest summaries, the coverage-config output, the `build:stub` result and the bundle comparison; list the optional owner action (set `NEXT_PUBLIC_SENTRY_DSN`, redeploy, smoke test). Note for WP19 that `buildRows.ts` and its tests already exist, and for WP20 that the delete-route test must keep passing after the CSRF dedupe.
