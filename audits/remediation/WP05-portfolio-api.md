# WP05: Restore signed-in features, part 2: portfolio

- **Findings covered**
  - F001 (partial, cluster members F001, F018): the browser Supabase client has no session (the session cookie is HttpOnly), so every `portfolios` / `portfolio_holdings` query in `app/lib/portfolio.ts` runs as `anon` and RLS plus migration 0013 reject it. **In scope here (part 2):** every `portfolios`, `portfolio_holdings` and `portfolio_lots` access moves to cookie-backed route handlers under `app/api/portfolio/`. Part 1 (profile, username) is WP04; part 3 (box recipes) is WP06.
  - F144 (full): the portfolio load is a three-stage browser waterfall (portfolio, then holdings plus the market RPC, then paged history) and the whole chain re-runs on every timeframe click and every add/edit/delete.
  - F053 (full, cluster members F053, F057, F061): `usePortfolioData` has no cancellation, blanks the whole dashboard on every refresh, lets an older slow history response overwrite a newer one, and resets the holdings-table sort.
  - F033 (full, cluster members F033, F044): `addHolding` mints its own idempotency key on every call so retries never dedupe, and a duplicate (idempotent success) and a failure both return `null`, so imports and the Add modal report false errors.
  - F110 (full, cluster members F110, F113, F119): `useProductSearch` has no stale-response guard, so a slower earlier search overwrites the results for the current query and clears the spinner early.
  - F060 (full, cluster members F060, F118): purchase-date default and `max` use the UTC calendar day, so evening users west of UTC get tomorrow pre-filled.
  - F111 (full): the portfolio history date series steps by local days but keys by UTC date, so a DST change skips or repeats a point.
- **Priority rationale**: `/portfolio` shows "Failed to load portfolio" to every signed-in user in production today, and this is the largest user-facing feature on the site.
- **Effort**: L, about 14 to 18 hours including tests.
- **Depends on**: WP04 (the `ANON_CLIENT_FORBIDDEN_FILES` ESLint guard, `sessionStatus` in `AuthContext`, the `/portfolio` page guards). WP00 for `pnpm build:stub`. WP01's `portfolio_holdings(portfolio_id)` index (migration 0025) makes the new queries cheaper but is not required.
- **Unblocks**: WP10 (replaces the client-side `getPortfolioHistory` with an RPC), WP11, WP12, WP14 (portfolio modals), WP17, WP20. WP06 copies the route and client pattern built here and extends the same ESLint guards.
- **Suggested branch name**: `remediation/wp05-portfolio-api`
- **Risk level**: medium. It rewrites the whole portfolio data path and every portfolio write, but that path is fully broken in production today, no migration or environment change is involved, and every route and the hook race are covered by tests.

## Why

Since commit `fec21dc` the session exists only in HttpOnly cookies, but `app/lib/portfolio.ts` still reads and writes `portfolios` and `portfolio_holdings` through the anonymous browser client (`portfolio.ts:1`, `:176-199`, `:268-280`, `:357-370`, `:395-400`, `:419-422`), so PostgREST answers 401 / 42501 and every signed-in user sees "Failed to load portfolio". Even when it worked, loading the page was three dependent browser round trips, and every chart-range click or edit re-ran all of them behind a full-page spinner that reset the table sort and could paint an older, slower range over the one the user picked. Retrying a failed "Add" or a CSV import could insert the same holding twice, because the idempotency key was minted inside `addHolding` on every call, and a successful dedupe was reported as an error. After this PR, `GET /api/portfolio` returns the portfolio and its freshness-guarded holdings in one request, writes go through CSRF-gated route handlers with a caller-owned idempotency key, timeframe changes only reload the chart, search and history ignore stale responses, and purchase dates never default to tomorrow.

## Before you start

Read these files fully first (paths relative to `frontend/`):

- `app/lib/portfolio.ts` (843 lines). User-table functions to move or delete: `getOrCreatePortfolio` :174-207, `getPortfolioById` :213-230, `updatePortfolioName` :236-255, `getHoldings` :264-291, `userOwnsHolding` :298-310, `getHoldingById` :316-349, `addHolding` :356-382, `updateHolding` :388-408, `deleteHolding` :413-430. Freshness helpers :22-165. History :436-497 and :584-738. Search :749-843.
- `app/lib/import.ts` (508 lines): `importHoldings` :415-487 calls `addHolding` per row; `processCollectrImport` :385-410.
- `app/components/Portfolio/hooks/usePortfolioData.ts` (109 lines), `hooks/useProductSearch.ts` (51 lines).
- `app/components/Portfolio/PortfolioDashboard.tsx` (219 lines), `cards/AddHoldingModal.tsx` (247), `cards/EditHoldingModal.tsx` (239), `cards/ImportHoldingsModal.tsx` (531), `shared/PortfolioChart.tsx` (84), `types/index.ts` (192).
- `app/lib/csrf.ts`, `app/lib/routeSupabase.ts`, `app/api/auth/sign-in/route.ts` (the route pattern to copy), `app/api/profile/route.ts` (added by WP04).
- `app/lib/serverMarketData.ts` :42-49 (`createMarketDataSupabaseClient`), :81-133 (`fetchPriceHistoryPages`), :135-176 (`fetchNewestPricedAt`), :896-903 (`getCachedMarketProductSummaries`).
- `app/lib/validation.ts` (65 lines plus WP02's additions), `app/lib/priceGuard.ts`, `app/lib/marketPulse.ts:76-78` (`utcMidnightMs`).
- `migrations/0003_integrity_constraints.sql:10-24` (`purchase_date <= current_date`, evaluated in UTC), `:40-41` (`portfolios_user_id_uidx`, one portfolio per user), `:54-60` (`client_idempotency_key uuid` and the PARTIAL unique index `portfolio_holdings_idem_uidx ... WHERE client_idempotency_key IS NOT NULL`); `migrations/0008_box_recipes_rls_hardening.sql:106-110` (`notes` at most 1000 chars); `migrations/0014_rls_perf_and_dedupe.sql:60-87` (owner-only policies).
- `app/lib/__tests__/portfolio.freshness.test.ts` (the `getHoldings freshness map` describe at :182-260 moves to the server repo test).
- `eslint.config.mjs` (WP04 added `ANON_CLIENT_FORBIDDEN_FILES` and a `no-restricted-imports` block).

Confirm the starting state from `frontend/`:

```bash
# 1. WP04 has landed: AuthContext and the account page no longer import the browser client,
#    and the ESLint guard list exists. Expect: no output from the first grep, one hit from the second.
grep -n 'lib/supabase' app/context/AuthContext.tsx app/account/page.tsx
grep -n 'ANON_CLIENT_FORBIDDEN_FILES' eslint.config.mjs | head -1
# If the first grep prints anything or the second prints nothing, WP04 is missing: stop.

# 2. The bug: user tables queried from the browser module. Expect 10 hits at lines 177,196,218,242,270,300,322,358,396,420.
grep -n 'from("portfolio' app/lib/portfolio.ts

# 3. portfolio_lots is never queried by the app (only comments). Expect hits only in
#    app/api/account/export/route.ts and app/api/account/delete/route.ts comments.
grep -rn "portfolio_lots" app --include=*.ts --include=*.tsx | grep -v __tests__

# 4. Nobody passes an idempotency key. Expect only types/index.ts:72 and portfolio.ts:366-367.
grep -rn "client_idempotency_key" app --include=*.ts --include=*.tsx

# 5. Dead user-table helpers. Expect no output (no callers outside portfolio.ts).
grep -rn "getPortfolioById\|updatePortfolioName\|getHoldingById" app --include=*.ts --include=*.tsx | grep -v "app/lib/portfolio.ts"

# 6. No portfolio routes yet. Expect "No such file or directory".
ls app/api/portfolio

# 7. Lint baseline for the files this PR touches. Record the output. At the time of writing:
#    11 errors: AddHoldingModal 43 and 62, EditHoldingModal 42, HoldingsTable 132-136 (5),
#    usePortfolioData 51 and 92, useProductSearch 24 (all react-hooks/*).
pnpm exec eslint app/components/Portfolio app/lib/portfolio.ts app/lib/import.ts app/lib/validation.ts app/portfolio
```

Assumptions to check:

- WP02 appended `PASSWORD_MIN_LENGTH`, `USERNAME_RE` and friends to `app/lib/validation.ts`. This PR only adds date helpers there and changes `isValidPastDate`; keep WP02's additions.
- WP04 may have added its own "header only" check for `GET /api/auth/me`. If `app/lib/csrf.ts` already exports a function that checks only `x-pokefin-request` (any name), reuse it in step 6 instead of adding `rejectIfNotAppRequest`.
- `@testing-library/react` 16 exports `renderHook` (it does at the time of writing).

## Implementation steps

Order: steps 1 to 7 add new modules that nothing imports yet (the build stays green after each). Steps 8 and 9 add the routes and their browser client. Steps 10 to 17 switch the client over and delete the old code. Step 18 adds the lint guards, step 19 the docs. Write the tests (see Tests) alongside the step they cover.

While this spec was written, the code of steps 1 to 18 was applied to a scratch copy of `frontend/` at base commit `a188fea` (plus a stand-in for WP04's ESLint block): `tsc --noEmit` reported only the expected `portfolio.freshness.test.ts` import of `getHoldings` (fixed by Tests 5), and ESLint on `app/components/Portfolio app/lib app/api/portfolio app/portfolio` reported exactly the 7 pre-existing errors listed in Verification, with 0 errors in every new or rewritten file. If you see other type or lint errors, the difference is in how a step was applied.

### Step 1. `app/lib/validation.ts`: local/UTC date keys and a clamped "today" (F060)

Add below `clampNotes` (after line 44), and replace `isValidPastDate` (lines 46-56):

```ts
/**
 * YYYY-MM-DD for `now` in `timeZone`. With no timeZone this is the runtime's
 * own zone: the viewer's zone in a browser, UTC on Vercel. Intl is used rather
 * than getFullYear/getMonth/getDate so tests can pass a zone explicitly.
 */
export function localDateKey(now: Date = new Date(), timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: "year" | "month" | "day") =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** YYYY-MM-DD of `now` in UTC: the day Postgres calls current_date. */
export function utcDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The latest purchase date the UI offers and pre-fills.
 *
 * The earlier of the viewer's local day and the UTC day. Not the local day
 * alone: east of UTC in the morning the local day is ahead of UTC, and the DB
 * CHECK portfolio_holdings_date_not_future (migration 0003) compares against
 * current_date in UTC, so the insert would fail with a raw constraint error.
 * Not the UTC day alone: west of UTC in the evening that is tomorrow, which is
 * what F060 reported. Server-side validation stays UTC (isValidPastDate with
 * no second argument) and is never loosened.
 */
export function maxPurchaseDateKey(now: Date = new Date(), timeZone?: string): string {
  const local = localDateKey(now, timeZone);
  const utc = utcDateKey(now);
  return local < utc ? local : utc;
}

/**
 * ISO date string YYYY-MM-DD that is a real calendar date and is not after
 * `maxDateKey` (default: today in UTC, matching the DB CHECK).
 */
export function isValidPastDate(s: unknown, maxDateKey?: string): s is string {
  if (typeof s !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  // Date rolls 2026-02-31 over to 2026-03-03; Postgres rejects it. Round-trip
  // so an impossible date is reported here, not as a raw 22008 later.
  if (d.toISOString().slice(0, 10) !== s) return false;
  return s <= (maxDateKey ?? utcDateKey());
}
```

`localDateKey` duplicates two private helpers (`marketPulse.ts:53`, `marketData.ts:108`). Leave those alone; WP07 consolidates date formatting.

### Step 2. `app/components/Portfolio/types/index.ts`: request types

Replace the `NewHolding` interface (lines 64-73) with:

```ts
// Body of POST /api/portfolio/holdings and one row of POST /api/portfolio/import.
// No portfolio_id: the server resolves the caller's portfolio from the session.
export interface NewHoldingInput {
  product_id: number;
  quantity: number;
  purchase_price_usd: number;
  purchase_date: string;
  notes: string | null;
  // Minted by the CALLER once per distinct submission and reused on retry, so
  // a retried request dedupes on portfolio_holdings_idem_uidx (migration 0003).
  client_idempotency_key: string;
}
```

In `ImportMatchResult` (lines 176-183) add after `errorMessage?: string;`:

```ts
  // Minted once when the CSV is parsed (processCollectrImport). A retry of the
  // same preview reuses it; parsing the file again mints a new one.
  idempotencyKey?: string;
```

Keep `UpdateHolding` and every other type unchanged. `NewHolding` has three users (`portfolio.ts`, `AddHoldingModal.tsx:7,96`, `import.ts:5,461`); all are rewritten below.

### Step 3. `app/lib/priceFreshness.ts` (new): the freshness decision without I/O

The browser keeps guarding search results, and the server now guards holdings. Both must apply the same rule, so move the pure part out of `portfolio.ts`:

```ts
import { resolvePrice } from "./priceGuard";
import type {
  HoldingWithProduct,
  ProductSearchResult,
} from "../components/Portfolio/types";

/**
 * The price-freshness decision for holdings and product search results, with
 * no I/O, so the browser (lib/portfolio.ts) and the portfolio route handlers
 * (lib/server/portfolioRepo.ts) apply exactly the same rule. Each side fetches
 * its own inputs: the guarded market summaries, and for products those
 * summaries do not describe, the newest in-window price-history row.
 */

export type ProductWithPrice = {
  id: number;
  usd_price: number | null;
  price_recorded_at?: string | null;
};

/** Same shape as clientMarketData's NewestPricedAt and serverMarketData's map values. */
export type NewestPricedAt = { recordedAt: string; usdPrice: number | null };

/**
 * Products that need a scoped freshness lookup: those the summaries map does
 * not describe (deactivated products). Empty when the map itself failed to
 * load, because then no verdict is reached for anyone and pickGuardedPrice
 * withholds every price.
 */
export function missingProductIds(
  productsById: Map<number, ProductWithPrice> | null,
  productIds: number[]
): number[] {
  if (productsById === null) return [];
  return [...new Set(productIds)].filter((id) => !productsById.has(id));
}

// MOVE pickGuardedPrice here VERBATIM from app/lib/portfolio.ts:77-124,
// including its doc comment, and add `export` in front of `function`.

export function applyGuardedPricesToHoldings(
  holdings: HoldingWithProduct[],
  productsById: Map<number, ProductWithPrice> | null,
  missingRecordedAt: Map<number, NewestPricedAt>
): HoldingWithProduct[] {
  return holdings.map((holding) => ({
    ...holding,
    products: {
      ...holding.products,
      ...pickGuardedPrice(
        productsById,
        missingRecordedAt,
        holding.product_id,
        holding.products?.usd_price
      ),
    },
  }));
}

export function applyGuardedPricesToSearchResults(
  products: ProductSearchResult[],
  productsById: Map<number, ProductWithPrice> | null,
  missingRecordedAt: Map<number, NewestPricedAt>
): ProductSearchResult[] {
  return products.map((product) => ({
    ...product,
    ...pickGuardedPrice(productsById, missingRecordedAt, product.id, product.usd_price),
  }));
}
```

This module must not import `./supabase`, `./clientMarketData` (a `"use client"` module) or anything server-only.

### Step 4. `app/lib/portfolioInput.ts` (new): request parsing shared by routes and client

```ts
import {
  PRICE_MAX,
  PRICE_MIN,
  QUANTITY_MAX,
  QUANTITY_MIN,
  clampNotes,
  isValidPastDate,
  isValidPrice,
  isValidQuantity,
} from "./validation";
import type { NewHoldingInput, UpdateHolding } from "../components/Portfolio/types";

/**
 * Parsing and limits for the /api/portfolio route bodies. Pure: imported by the
 * route handlers, the browser API client (lib/portfolioApi.ts) and tests.
 * Server-side date validation is UTC on purpose (see maxPurchaseDateKey).
 */

export const HOLDING_BODY_MAX_BYTES = 8 * 1024;
// 250 rows x (1000-char note, worst case ~6 bytes per char once JSON-escaped,
// plus ~250 bytes of fields) stays under 2 MiB; Vercel's limit is 4.5 MB.
export const IMPORT_MAX_ROWS_PER_REQUEST = 250;
export const IMPORT_BODY_MAX_BYTES = 2 * 1024 * 1024;

export type ImportRowResult = {
  index: number; // position in THIS request's rows array
  status: "imported" | "duplicate" | "error";
  error?: string;
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export const QUANTITY_MESSAGE = `Quantity must be a whole number between ${QUANTITY_MIN} and ${QUANTITY_MAX}`;
export const PRICE_MESSAGE = `Purchase price must be between ${PRICE_MIN} and ${PRICE_MAX.toLocaleString("en-US")}`;
export const DATE_MESSAGE = "Purchase date must be a real date that is not in the future";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail<T>(error: string): Parsed<T> {
  return { ok: false, error };
}

export function parseNewHolding(raw: unknown): Parsed<NewHoldingInput> {
  if (!isRecord(raw)) return fail("Invalid body");
  const productId = raw.product_id;
  if (typeof productId !== "number" || !Number.isSafeInteger(productId) || productId <= 0) {
    return fail("Invalid product");
  }
  const quantity = raw.quantity;
  if (!isValidQuantity(quantity)) return fail(QUANTITY_MESSAGE);
  const price = raw.purchase_price_usd;
  if (!isValidPrice(price)) return fail(PRICE_MESSAGE);
  const date = raw.purchase_date;
  if (!isValidPastDate(date)) return fail(DATE_MESSAGE);
  const notes = raw.notes;
  if (notes !== undefined && notes !== null && typeof notes !== "string") {
    return fail("Invalid notes");
  }
  const key = raw.client_idempotency_key;
  if (typeof key !== "string" || !UUID_RE.test(key)) return fail("Invalid idempotency key");
  return {
    ok: true,
    value: {
      product_id: productId,
      quantity,
      purchase_price_usd: price,
      purchase_date: date,
      notes: clampNotes(notes ?? null),
      client_idempotency_key: key.toLowerCase(),
    },
  };
}

/**
 * Only the four editable columns are copied out. Never pass a request body to
 * .update(): portfolio_id, product_id and client_idempotency_key must not be
 * client-writable through this route.
 */
export function parseHoldingUpdate(raw: unknown): Parsed<UpdateHolding> {
  if (!isRecord(raw)) return fail("Invalid body");
  const out: UpdateHolding = {};
  if ("quantity" in raw) {
    const q = raw.quantity;
    if (!isValidQuantity(q)) return fail(QUANTITY_MESSAGE);
    out.quantity = q;
  }
  if ("purchase_price_usd" in raw) {
    const p = raw.purchase_price_usd;
    if (!isValidPrice(p)) return fail(PRICE_MESSAGE);
    out.purchase_price_usd = p;
  }
  if ("purchase_date" in raw) {
    const d = raw.purchase_date;
    if (!isValidPastDate(d)) return fail(DATE_MESSAGE);
    out.purchase_date = d;
  }
  if ("notes" in raw) {
    const n = raw.notes;
    if (n !== null && typeof n !== "string") return fail("Invalid notes");
    out.notes = clampNotes(n);
  }
  if (Object.keys(out).length === 0) return fail("Nothing to update");
  return { ok: true, value: out };
}

export function parseImportEnvelope(raw: unknown): Parsed<unknown[]> {
  if (!isRecord(raw) || !Array.isArray(raw.rows)) return fail("Invalid body");
  if (raw.rows.length === 0) return fail("No rows to import");
  if (raw.rows.length > IMPORT_MAX_ROWS_PER_REQUEST) {
    return fail(`At most ${IMPORT_MAX_ROWS_PER_REQUEST} rows per request`);
  }
  return { ok: true, value: raw.rows };
}

/**
 * HTTP status and a safe message for a failed holdings write. Never echo the
 * PostgREST message: it can carry schema fragments (see lib/logger.ts).
 */
export function describeWriteError(code: string | null | undefined): {
  httpStatus: 400 | 500;
  message: string;
} {
  if (code === "23503") {
    return { httpStatus: 400, message: "That product no longer exists." };
  }
  if (code === "23514" || code === "22007" || code === "22008" || code === "22P02" || code === "22003") {
    return {
      httpStatus: 400,
      message: "One of the values is out of range. Check the quantity, price and date.",
    };
  }
  return { httpStatus: 500, message: "Could not save the holding. Please try again." };
}
```

### Step 5. `app/lib/serverMarketData.ts`: expose the scoped freshness lookup

Insert directly after `fetchNewestPricedAt` (after line 176, before the `guardedPrice` doc comment):

```ts
/**
 * fetchNewestPricedAt for callers outside this module (the portfolio route
 * handlers), scoped to a few product ids. Reference data, so it uses the same
 * anonymous client as the rest of this file. Fails closed: on any error it
 * returns an empty map, which withholds those products' prices instead of
 * trusting products.usd_price.
 */
export async function fetchNewestPricedAtForProducts(
  productIds: number[]
): Promise<Map<number, { recordedAt: string; usdPrice: number | null }>> {
  if (productIds.length === 0) return new Map();
  try {
    return await fetchNewestPricedAt(createMarketDataSupabaseClient(), productIds);
  } catch (error) {
    logSupabaseError(
      "server_price_freshness_failed",
      error as { code?: unknown; message?: unknown }
    );
    return new Map();
  }
}
```

Nothing else in this file changes.

### Step 6. `app/lib/csrf.ts`: header-only gate for private GETs

Append (skip if WP04 already added an equivalent helper; then use that name in step 7):

```ts
/**
 * Gate for read-only routes that return the caller's private data. Checks the
 * custom header only: browsers omit Origin on same-origin GET requests, so the
 * Origin check in rejectIfCsrfFails would refuse every legitimate load. A
 * cross-site page cannot add this header without a CORS preflight, which this
 * app never approves.
 */
export function rejectIfNotAppRequest(req: NextRequest): NextResponse | null {
  if (req.headers.get("x-pokefin-request") !== "1") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
```

### Step 7. `app/lib/server/portfolioRepo.ts` (new): every user-table query

This is the only module (besides the route handlers) allowed to query `portfolios` / `portfolio_holdings`. It receives the cookie-backed route client, so PostgREST sees the user's JWT and RLS (`migrations/0014:60-87`) applies. Holdings are always returned with the price-freshness verdict applied, exactly as the old client `getHoldings` did.

```ts
import "server-only";

import type { createRouteSupabaseClient } from "../routeSupabase";
import {
  fetchNewestPricedAtForProducts,
  getCachedMarketProductSummaries,
} from "../serverMarketData";
import {
  applyGuardedPricesToHoldings,
  missingProductIds,
  type NewestPricedAt,
  type ProductWithPrice,
} from "../priceFreshness";
import { logCaughtError, logSupabaseError } from "../logger";
import type {
  HoldingWithProduct,
  NewHoldingInput,
  Portfolio,
  UpdateHolding,
} from "../../components/Portfolio/types";

type RouteSupabase = Awaited<ReturnType<typeof createRouteSupabaseClient>>;

// Same columns and embeds the old client getHoldings selected (portfolio.ts:271-278).
const HOLDING_SELECT = `
  id, portfolio_id, product_id, quantity, purchase_price_usd, purchase_date, notes, created_at, updated_at,
  products (
    id, usd_price, image_url, variant, url,
    sets ( id, name, code, release_date, expansion_type, generations ( id, name ) ),
    product_types ( id, name, label )
  )`;

const KEY_LOOKUP_BATCH = 100; // 100 uuids keep the ?in=() URL around 4 KB
const INSERT_BATCH = 50;

/**
 * Guarded market prices, or null when the summaries are unavailable (fail
 * closed: null withholds every price, see pickGuardedPrice). Never rejects, so
 * callers may start it early and drop it on an error path.
 */
async function loadGuardedProducts(): Promise<Map<number, ProductWithPrice> | null> {
  try {
    const products = await getCachedMarketProductSummaries();
    return new Map(products.map((p) => [p.id, p]));
  } catch (error) {
    logCaughtError("portfolio_fresh_prices_failed", error);
    return null;
  }
}

async function guardHoldings(
  holdings: HoldingWithProduct[],
  productsById: Map<number, ProductWithPrice> | null
): Promise<HoldingWithProduct[]> {
  if (holdings.length === 0) return holdings;
  const missing = missingProductIds(productsById, holdings.map((h) => h.product_id));
  const missingRecordedAt: Map<number, NewestPricedAt> =
    missing.length > 0 ? await fetchNewestPricedAtForProducts(missing) : new Map();
  return applyGuardedPricesToHoldings(holdings, productsById, missingRecordedAt);
}

async function guardOne(row: unknown): Promise<HoldingWithProduct> {
  const [holding] = await guardHoldings(
    [row as HoldingWithProduct],
    await loadGuardedProducts()
  );
  return holding;
}

/**
 * The caller's portfolio, created on first use. portfolios_user_id_uidx
 * (migration 0003) allows one per user, so two first loads racing each other
 * make one INSERT fail with 23505: read the winner instead of failing.
 */
export async function getOrCreatePortfolio(
  supabase: RouteSupabase,
  userId: string
): Promise<Portfolio | null> {
  const select = () =>
    supabase
      .from("portfolios")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

  const { data: existing, error: fetchError } = await select();
  if (fetchError) {
    logSupabaseError("portfolio_fetch_failed", fetchError);
    return null;
  }
  if (existing) return existing as Portfolio;

  const { data: created, error: createError } = await supabase
    .from("portfolios")
    .insert({ user_id: userId, name: "My Portfolio" })
    .select()
    .single();
  if (!createError) return created as Portfolio;

  if (createError.code === "23505") {
    const { data: winner, error: rereadError } = await select();
    if (winner) return winner as Portfolio;
    if (rereadError) logSupabaseError("portfolio_reread_failed", rereadError);
    return null;
  }
  logSupabaseError("portfolio_create_failed", createError);
  return null;
}

/** The caller's portfolio id, or null when none exists. Throws on a query error. */
export async function findPortfolioId(
  supabase: RouteSupabase,
  userId: string
): Promise<number | null> {
  const { data, error } = await supabase
    .from("portfolios")
    .select("id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) {
    logSupabaseError("portfolio_lookup_failed", error);
    throw new Error("portfolio_lookup_failed");
  }
  return data ? (data as { id: number }).id : null;
}

/**
 * Everything the dashboard needs in one server round trip (F144): the
 * portfolio (created if missing) and its holdings with the freshness verdict
 * applied. The market summaries load starts first so it overlaps the two
 * PostgREST queries. Null on any failure: an empty holdings list on a failed
 * read would look like a portfolio that lost everything.
 */
export async function loadPortfolioPayload(
  supabase: RouteSupabase,
  userId: string
): Promise<{ portfolio: Portfolio; holdings: HoldingWithProduct[] } | null> {
  const productsPromise = loadGuardedProducts();
  const portfolio = await getOrCreatePortfolio(supabase, userId);
  if (!portfolio) return null;

  const { data, error } = await supabase
    .from("portfolio_holdings")
    .select(HOLDING_SELECT)
    .eq("portfolio_id", portfolio.id)
    .order("created_at", { ascending: false });
  if (error) {
    logSupabaseError("holdings_fetch_failed", error);
    return null;
  }
  const holdings = await guardHoldings(
    (data ?? []) as unknown as HoldingWithProduct[],
    await productsPromise
  );
  return { portfolio, holdings };
}

export type InsertHoldingResult =
  | { status: "inserted" | "duplicate"; holding: HoldingWithProduct }
  | { status: "error"; code: string | null };

/**
 * Insert one holding. A 23505 on portfolio_holdings_idem_uidx means an earlier
 * attempt with the same key already landed: that is success ("duplicate"),
 * and the existing row is returned so the UI can show it.
 */
export async function insertHolding(
  supabase: RouteSupabase,
  portfolioId: number,
  input: NewHoldingInput
): Promise<InsertHoldingResult> {
  const { data, error } = await supabase
    .from("portfolio_holdings")
    .insert({ portfolio_id: portfolioId, ...input })
    .select(HOLDING_SELECT)
    .single();
  if (!error) return { status: "inserted", holding: await guardOne(data) };

  if (error.code === "23505") {
    const { data: existing, error: readError } = await supabase
      .from("portfolio_holdings")
      .select(HOLDING_SELECT)
      .eq("portfolio_id", portfolioId)
      .eq("client_idempotency_key", input.client_idempotency_key)
      .maybeSingle();
    if (existing) return { status: "duplicate", holding: await guardOne(existing) };
    logSupabaseError("holding_duplicate_reread_failed", readError);
    return { status: "error", code: "23505" };
  }
  logSupabaseError("holding_insert_failed", error);
  return { status: "error", code: error.code ?? null };
}

export type UpdateHoldingResult =
  | { status: "updated"; holding: HoldingWithProduct }
  | { status: "not_found" }
  | { status: "error"; code: string | null };

/**
 * One statement, scoped to the caller's portfolio: the portfolio_id filter is
 * the defense in depth that userOwnsHolding used to add with an extra round
 * trip, and RLS still applies underneath.
 */
export async function updateHolding(
  supabase: RouteSupabase,
  portfolioId: number,
  holdingId: number,
  updates: UpdateHolding
): Promise<UpdateHoldingResult> {
  const { data, error } = await supabase
    .from("portfolio_holdings")
    .update(updates)
    .eq("id", holdingId)
    .eq("portfolio_id", portfolioId)
    .select(HOLDING_SELECT)
    .maybeSingle();
  if (error) {
    logSupabaseError("holding_update_failed", error);
    return { status: "error", code: error.code ?? null };
  }
  if (!data) return { status: "not_found" };
  return { status: "updated", holding: await guardOne(data) };
}

export type DeleteHoldingResult =
  | { status: "deleted" | "not_found" }
  | { status: "error"; code: string | null };

export async function deleteHolding(
  supabase: RouteSupabase,
  portfolioId: number,
  holdingId: number
): Promise<DeleteHoldingResult> {
  const { data, error } = await supabase
    .from("portfolio_holdings")
    .delete()
    .eq("id", holdingId)
    .eq("portfolio_id", portfolioId)
    .select("id");
  if (error) {
    logSupabaseError("holding_delete_failed", error);
    return { status: "error", code: error.code ?? null };
  }
  return { status: data && data.length > 0 ? "deleted" : "not_found" };
}

export type ImportOutcome =
  | { status: "imported" | "duplicate" }
  | { status: "error"; error: string };

function toInsertRow(portfolioId: number, row: NewHoldingInput) {
  return { portfolio_id: portfolioId, ...row };
}

function importErrorMessage(code: string | null | undefined): string {
  if (code === "23503") return "Product no longer exists";
  if (code === "23514" || code === "22007" || code === "22008" || code === "22P02") {
    return "A value is out of range";
  }
  return "Failed to add holding to portfolio";
}

/**
 * Bulk insert for the Collectr import, one outcome per input row (same order).
 *
 * 1. Keys that already exist are earlier attempts that landed: "duplicate".
 *    Looked up first because PostgREST cannot express ON CONFLICT against the
 *    PARTIAL unique index portfolio_holdings_idem_uidx (the WHERE predicate
 *    cannot be passed), so upsert/ignoreDuplicates would fail with 42P10.
 * 2. The rest go in batches of INSERT_BATCH. A batch that fails (a concurrent
 *    retry, a deleted product, a CHECK violation) is retried row by row so one
 *    bad row cannot sink its neighbours.
 * Throws only when the key lookup itself fails; the route turns that into 500
 * and the client retries with the same keys.
 */
export async function insertImportedHoldings(
  supabase: RouteSupabase,
  portfolioId: number,
  rows: NewHoldingInput[]
): Promise<ImportOutcome[]> {
  const outcomes: ImportOutcome[] = new Array(rows.length);

  const existing = new Set<string>();
  for (let i = 0; i < rows.length; i += KEY_LOOKUP_BATCH) {
    const keys = rows.slice(i, i + KEY_LOOKUP_BATCH).map((r) => r.client_idempotency_key);
    const { data, error } = await supabase
      .from("portfolio_holdings")
      .select("client_idempotency_key")
      .eq("portfolio_id", portfolioId)
      .in("client_idempotency_key", keys);
    if (error) {
      logSupabaseError("import_key_lookup_failed", error);
      throw new Error("import_key_lookup_failed");
    }
    for (const row of (data ?? []) as Array<{ client_idempotency_key: string | null }>) {
      if (row.client_idempotency_key) existing.add(row.client_idempotency_key);
    }
  }

  const pending: number[] = [];
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const key = row.client_idempotency_key;
    if (existing.has(key) || seen.has(key)) {
      outcomes[i] = { status: "duplicate" };
    } else {
      seen.add(key);
      pending.push(i);
    }
  });

  for (let b = 0; b < pending.length; b += INSERT_BATCH) {
    const batch = pending.slice(b, b + INSERT_BATCH);
    const { error } = await supabase
      .from("portfolio_holdings")
      .insert(batch.map((i) => toInsertRow(portfolioId, rows[i])));
    if (!error) {
      for (const i of batch) outcomes[i] = { status: "imported" };
      continue;
    }
    logSupabaseError("import_batch_insert_failed", error);
    for (const i of batch) {
      const { error: rowError } = await supabase
        .from("portfolio_holdings")
        .insert(toInsertRow(portfolioId, rows[i]));
      outcomes[i] = !rowError
        ? { status: "imported" }
        : rowError.code === "23505"
          ? { status: "duplicate" }
          : { status: "error", error: importErrorMessage(rowError.code) };
    }
  }
  return outcomes;
}
```

Notes for this step:

- `import type { createRouteSupabaseClient }` is a type-only import, so the repo does not pull `next/headers` at runtime; `typeof` on it is valid TypeScript.
- Do not add `updated_at` handling; the old code did not set it either (out of scope).
- `getPortfolioById`, `updatePortfolioName` and `getHoldingById` have no callers (Before you start, command 5) and are NOT recreated. `portfolio_lots` has no reader or writer in the app (command 3), so there is no lots function and no lots route.

### Step 8. Route handlers (new files)

All four follow `app/api/auth/sign-in/route.ts`: CSRF and size gates first, then `createRouteSupabaseClient()`, then `auth.getUser()` (401 when there is no user, before the body is parsed), then the repo. Every response carries `Cache-Control: no-store`. Unexpected throws are caught, logged with `logCaughtError`, and answered with a generic 500. None of them sets `export const dynamic` or `runtime` (reading cookies already makes them dynamic).

8a. `app/api/portfolio/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createRouteSupabaseClient } from "../../lib/routeSupabase";
import { rejectIfNotAppRequest } from "../../lib/csrf";
import { loadPortfolioPayload } from "../../lib/server/portfolioRepo";
import { logCaughtError } from "../../lib/logger";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * The caller's portfolio (created on first use) and its holdings with the
 * price-freshness verdict applied, in one response. Replaces three dependent
 * browser round trips that ran as anon and were rejected by RLS (F001, F144).
 * History is not included: it depends on the timeframe and is loaded by the
 * hook separately (WP10 moves it to an RPC).
 */
export async function GET(req: NextRequest) {
  const forbidden = rejectIfNotAppRequest(req);
  if (forbidden) return forbidden;

  try {
    const supabase = await createRouteSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }

    const payload = await loadPortfolioPayload(supabase, user.id);
    if (!payload) {
      return NextResponse.json(
        { error: "Failed to load portfolio" },
        { status: 500, headers: NO_STORE }
      );
    }
    return NextResponse.json(payload, { headers: NO_STORE });
  } catch (error) {
    logCaughtError("portfolio_get_failed", error);
    return NextResponse.json(
      { error: "Failed to load portfolio" },
      { status: 500, headers: NO_STORE }
    );
  }
}
```

8b. `app/api/portfolio/holdings/route.ts` (add one holding):

```ts
import { NextRequest, NextResponse } from "next/server";
import { createRouteSupabaseClient } from "../../../lib/routeSupabase";
import { rejectIfBodyTooLarge, rejectIfCsrfFails } from "../../../lib/csrf";
import {
  HOLDING_BODY_MAX_BYTES,
  describeWriteError,
  parseNewHolding,
} from "../../../lib/portfolioInput";
import { getOrCreatePortfolio, insertHolding } from "../../../lib/server/portfolioRepo";
import { logCaughtError } from "../../../lib/logger";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * 201 { status: "inserted", holding } for a new row, 200 { status: "duplicate",
 * holding } when the idempotency key already exists (a retry of a request that
 * landed). The key is required and is never minted here (F033).
 */
export async function POST(req: NextRequest) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, HOLDING_BODY_MAX_BYTES);
  if (tooLarge) return tooLarge;

  try {
    const supabase = await createRouteSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400, headers: NO_STORE });
    }
    const parsed = parseNewHolding(raw);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });
    }

    const portfolio = await getOrCreatePortfolio(supabase, user.id);
    if (!portfolio) {
      return NextResponse.json(
        { error: "Could not save the holding. Please try again." },
        { status: 500, headers: NO_STORE }
      );
    }

    const result = await insertHolding(supabase, portfolio.id, parsed.value);
    if (result.status === "error") {
      const { httpStatus, message } = describeWriteError(result.code);
      return NextResponse.json({ error: message }, { status: httpStatus, headers: NO_STORE });
    }
    return NextResponse.json(
      { status: result.status, holding: result.holding },
      { status: result.status === "inserted" ? 201 : 200, headers: NO_STORE }
    );
  } catch (error) {
    logCaughtError("portfolio_holding_post_failed", error);
    return NextResponse.json(
      { error: "Could not save the holding. Please try again." },
      { status: 500, headers: NO_STORE }
    );
  }
}
```

8c. `app/api/portfolio/holdings/[id]/route.ts` (edit and delete one holding). The second argument uses the Next 15+ Promise form of `params`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createRouteSupabaseClient } from "../../../../lib/routeSupabase";
import { rejectIfBodyTooLarge, rejectIfCsrfFails } from "../../../../lib/csrf";
import {
  HOLDING_BODY_MAX_BYTES,
  describeWriteError,
  parseHoldingUpdate,
} from "../../../../lib/portfolioInput";
import {
  deleteHolding,
  findPortfolioId,
  updateHolding,
} from "../../../../lib/server/portfolioRepo";
import { logCaughtError } from "../../../../lib/logger";

const NO_STORE = { "Cache-Control": "no-store" } as const;

type RouteContext = { params: Promise<{ id: string }> };

function parseHoldingId(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const id = Number(raw);
  return id > 0 ? id : null;
}

function notFound() {
  return NextResponse.json({ error: "Holding not found" }, { status: 404, headers: NO_STORE });
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, HOLDING_BODY_MAX_BYTES);
  if (tooLarge) return tooLarge;

  const holdingId = parseHoldingId((await params).id);
  if (holdingId === null) {
    return NextResponse.json({ error: "Invalid holding id" }, { status: 400, headers: NO_STORE });
  }

  try {
    const supabase = await createRouteSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400, headers: NO_STORE });
    }
    const parsed = parseHoldingUpdate(raw);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });
    }

    const portfolioId = await findPortfolioId(supabase, user.id);
    if (portfolioId === null) return notFound();

    const result = await updateHolding(supabase, portfolioId, holdingId, parsed.value);
    if (result.status === "not_found") return notFound();
    if (result.status === "error") {
      const { httpStatus, message } = describeWriteError(result.code);
      return NextResponse.json({ error: message }, { status: httpStatus, headers: NO_STORE });
    }
    return NextResponse.json({ holding: result.holding }, { headers: NO_STORE });
  } catch (error) {
    logCaughtError("portfolio_holding_patch_failed", error);
    return NextResponse.json(
      { error: "Could not save the holding. Please try again." },
      { status: 500, headers: NO_STORE }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, 1024);
  if (tooLarge) return tooLarge;

  const holdingId = parseHoldingId((await params).id);
  if (holdingId === null) {
    return NextResponse.json({ error: "Invalid holding id" }, { status: 400, headers: NO_STORE });
  }

  try {
    const supabase = await createRouteSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }

    const portfolioId = await findPortfolioId(supabase, user.id);
    if (portfolioId === null) return notFound();

    const result = await deleteHolding(supabase, portfolioId, holdingId);
    if (result.status === "not_found") return notFound();
    if (result.status === "error") {
      return NextResponse.json(
        { error: "Could not delete the holding. Please try again." },
        { status: 500, headers: NO_STORE }
      );
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    logCaughtError("portfolio_holding_delete_failed", error);
    return NextResponse.json(
      { error: "Could not delete the holding. Please try again." },
      { status: 500, headers: NO_STORE }
    );
  }
}
```

8d. `app/api/portfolio/import/route.ts` (bulk import; one request per 250 rows instead of one request per row, which would blow through the proxy's 60/min general limit, `app/lib/rateLimit.ts`):

```ts
import { NextRequest, NextResponse } from "next/server";
import { createRouteSupabaseClient } from "../../../lib/routeSupabase";
import { rejectIfBodyTooLarge, rejectIfCsrfFails } from "../../../lib/csrf";
import {
  IMPORT_BODY_MAX_BYTES,
  parseImportEnvelope,
  parseNewHolding,
  type ImportRowResult,
} from "../../../lib/portfolioInput";
import {
  getOrCreatePortfolio,
  insertImportedHoldings,
} from "../../../lib/server/portfolioRepo";
import { logCaughtError } from "../../../lib/logger";
import type { NewHoldingInput } from "../../../components/Portfolio/types";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Body { rows: NewHoldingInput[] } (1..IMPORT_MAX_ROWS_PER_REQUEST). Answers
 * 200 { results: ImportRowResult[] } with one entry per row, in order. An
 * invalid row is reported as that row's error; it does not fail the request.
 */
export async function POST(req: NextRequest) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, IMPORT_BODY_MAX_BYTES);
  if (tooLarge) return tooLarge;

  try {
    const supabase = await createRouteSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400, headers: NO_STORE });
    }
    const envelope = parseImportEnvelope(raw);
    if (!envelope.ok) {
      return NextResponse.json({ error: envelope.error }, { status: 400, headers: NO_STORE });
    }

    const portfolio = await getOrCreatePortfolio(supabase, user.id);
    if (!portfolio) {
      return NextResponse.json(
        { error: "Import failed. Please try again." },
        { status: 500, headers: NO_STORE }
      );
    }

    const results: ImportRowResult[] = new Array(envelope.value.length);
    const valid: NewHoldingInput[] = [];
    const validIndex: number[] = [];
    envelope.value.forEach((row, index) => {
      const parsed = parseNewHolding(row);
      if (parsed.ok) {
        valid.push(parsed.value);
        validIndex.push(index);
      } else {
        results[index] = { index, status: "error", error: parsed.error };
      }
    });

    if (valid.length > 0) {
      const outcomes = await insertImportedHoldings(supabase, portfolio.id, valid);
      outcomes.forEach((outcome, k) => {
        const index = validIndex[k];
        results[index] =
          outcome.status === "error"
            ? { index, status: "error", error: outcome.error }
            : { index, status: outcome.status };
      });
    }
    return NextResponse.json({ results }, { headers: NO_STORE });
  } catch (error) {
    logCaughtError("portfolio_import_failed", error);
    return NextResponse.json(
      { error: "Import failed. Please try again." },
      { status: 500, headers: NO_STORE }
    );
  }
}
```

The proxy classifies all of these as `general` (60/min per IP) through the `/api/` prefix, which is correct; do not change `rateLimit.ts`. `PROTECTED_PATTERNS` in `proxy.ts:11-14` does not match `/api/portfolio`, so an anonymous call gets this route's JSON 401 rather than a redirect, which is what the client expects.

### Step 9. `app/lib/portfolioApi.ts` (new): the browser client for these routes

```ts
import type {
  HoldingWithProduct,
  NewHoldingInput,
  Portfolio,
  UpdateHolding,
} from "../components/Portfolio/types";
import { IMPORT_MAX_ROWS_PER_REQUEST, type ImportRowResult } from "./portfolioInput";

/**
 * Browser-side client for the /api/portfolio route handlers.
 *
 * portfolios, portfolio_holdings and portfolio_lots are readable only by the
 * authenticated role (RLS plus migration 0013). The browser Supabase client in
 * lib/supabase.ts is always anonymous, because the session lives in an
 * HttpOnly cookie it cannot read, so every user-table read and write goes
 * through these same-origin routes, which build a cookie-backed server client.
 * Reference data (products, sets, price history, market RPCs) stays on the
 * anonymous client in lib/portfolio.ts.
 */

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "x-pokefin-request": "1",
} as const;

const NETWORK_ERROR = "Network error. Check your connection and try again.";

export class PortfolioApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PortfolioApiError";
    this.status = status;
  }
}

export type PortfolioPayload = { portfolio: Portfolio; holdings: HoldingWithProduct[] };

export type AddHoldingResult =
  | { status: "inserted" | "duplicate"; holding: HoldingWithProduct }
  | { status: "error"; message: string };

export type UpdateHoldingResult =
  | { ok: true; holding: HoldingWithProduct }
  | { ok: false; message: string };

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return "Your session has expired. Please sign in again.";
  if (res.status === 429) return "Too many requests. Please wait a minute and try again.";
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
      return (body as { error: string }).error;
    }
  } catch {
    // Not JSON: use the fallback.
  }
  return fallback;
}

/** Throws PortfolioApiError on any non-2xx, and the fetch error on network failure or abort. */
export async function fetchPortfolio(signal?: AbortSignal): Promise<PortfolioPayload> {
  const res = await fetch("/api/portfolio", {
    method: "GET",
    headers: { "x-pokefin-request": "1" },
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!res.ok) {
    throw new PortfolioApiError(await readErrorMessage(res, "Failed to load portfolio"), res.status);
  }
  return (await res.json()) as PortfolioPayload;
}

/**
 * "duplicate" is a success: an earlier attempt with the same key already
 * landed. Only "error" means nothing was saved.
 */
export async function addHolding(input: NewHoldingInput): Promise<AddHoldingResult> {
  try {
    const res = await fetch("/api/portfolio/holdings", {
      method: "POST",
      headers: JSON_HEADERS,
      credentials: "same-origin",
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      return {
        status: "error",
        message: await readErrorMessage(res, "Failed to add holding. Please try again."),
      };
    }
    const body = (await res.json()) as { status: "inserted" | "duplicate"; holding: HoldingWithProduct };
    return { status: body.status, holding: body.holding };
  } catch {
    return { status: "error", message: NETWORK_ERROR };
  }
}

export async function updateHolding(
  holdingId: number,
  updates: UpdateHolding
): Promise<UpdateHoldingResult> {
  try {
    const res = await fetch(`/api/portfolio/holdings/${holdingId}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      credentials: "same-origin",
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      return {
        ok: false,
        message: await readErrorMessage(res, "Failed to update holding. Please try again."),
      };
    }
    const body = (await res.json()) as { holding: HoldingWithProduct };
    return { ok: true, holding: body.holding };
  } catch {
    return { ok: false, message: NETWORK_ERROR };
  }
}

export async function deleteHolding(holdingId: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/portfolio/holdings/${holdingId}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
      credentials: "same-origin",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Sends rows in chunks of IMPORT_MAX_ROWS_PER_REQUEST, sequentially, and
 * returns one result per input row with `index` re-based onto `rows`. Throws
 * PortfolioApiError when a chunk fails as a whole; rows from earlier chunks
 * are already saved, and a retry with the same keys reports them "duplicate".
 */
export async function importHoldingRows(rows: NewHoldingInput[]): Promise<ImportRowResult[]> {
  const results: ImportRowResult[] = [];
  for (let start = 0; start < rows.length; start += IMPORT_MAX_ROWS_PER_REQUEST) {
    const chunk = rows.slice(start, start + IMPORT_MAX_ROWS_PER_REQUEST);
    const res = await fetch("/api/portfolio/import", {
      method: "POST",
      headers: JSON_HEADERS,
      credentials: "same-origin",
      body: JSON.stringify({ rows: chunk }),
    });
    if (!res.ok) {
      throw new PortfolioApiError(await readErrorMessage(res, "Import failed"), res.status);
    }
    const body = (await res.json()) as { results: ImportRowResult[] };
    for (const r of body.results) results.push({ ...r, index: r.index + start });
  }
  return results;
}
```

Do not add `"use client"` to this module (it has no React code). Do not import `./supabase` here.

### Step 10. `app/lib/portfolio.ts`: reference reads only

10a. Replace lines 1-165 (imports, `ProductWithPrice`, `getFreshProductsById`, `fetchRecordedAtForMissing`, `pickGuardedPrice`, `applyFreshPricesToHoldings`, `applyFreshPricesToSearchResults`) with:

```ts
/**
 * Reference-data reads for the portfolio UI: product search, the catalog the
 * Collectr import matcher uses, and the portfolio value history. Everything
 * here reads tables and RPCs the anonymous role may read (products, sets,
 * product_types, product_price_history, get_market_product_summaries), which
 * is why it can use the browser client in ./supabase.
 *
 * It must never touch portfolios, portfolio_holdings or portfolio_lots: the
 * browser client has no session (the session cookie is HttpOnly) and RLS plus
 * migration 0013 reject it there. User-table access lives in
 * lib/server/portfolioRepo.ts behind the /api/portfolio route handlers and is
 * reached from the browser through lib/portfolioApi.ts. eslint.config.mjs
 * enforces this.
 */
import { supabase } from "./supabase";
import {
  fetchMarketProductsClient,
  fetchNewestPricedAtClient,
} from "./clientMarketData";
import { PRICE_STALENESS_TOLERANCE_DAYS, utcMidnightMs } from "./marketPulse";
import { resolvePrice } from "./priceGuard";
import {
  applyGuardedPricesToSearchResults,
  missingProductIds,
  type NewestPricedAt,
  type ProductWithPrice,
} from "./priceFreshness";
import { logCaughtError, logSupabaseError } from "./logger";
import type {
  HoldingWithProduct,
  PortfolioSummary,
  HoldingPerformance,
  PortfolioHistoryPoint,
  ProductSearchResult,
} from "../components/Portfolio/types";

const DAY_MS = 24 * 60 * 60 * 1000;

// KEEP getFreshProductsById exactly as it is today (portfolio.ts:28-49,
// doc comment included).

async function fetchRecordedAtForMissing(
  productsById: Map<number, ProductWithPrice> | null,
  productIds: number[]
): Promise<Map<number, NewestPricedAt>> {
  const missing = missingProductIds(productsById, productIds);
  if (missing.length === 0) return new Map();
  // Scoped to the unmatched ids and shared with the catalog fallback, so the
  // paging and the fail-closed behaviour are defined once.
  return fetchNewestPricedAtClient(missing);
}

async function applyFreshPricesToSearchResults(
  products: ProductSearchResult[],
  productsById: Map<number, ProductWithPrice> | null
): Promise<ProductSearchResult[]> {
  const missingRecordedAt = await fetchRecordedAtForMissing(
    productsById,
    products.map((product) => product.id)
  );
  return applyGuardedPricesToSearchResults(products, productsById, missingRecordedAt);
}
```

Keep the doc comment of `fetchRecordedAtForMissing` (lines 51-62) above the new body.

10b. Delete lines 167-430 in full: the "Portfolio CRUD Operations" and "Holdings CRUD Operations" sections (`getOrCreatePortfolio`, `getPortfolioById`, `updatePortfolioName`, `getHoldings`, `userOwnsHolding`, `getHoldingById`, `addHolding`, `updateHolding`, `deleteHolding`). After this, `grep -n 'from("portfolio' app/lib/portfolio.ts` must print nothing.

10c. `fetchPortfolioPriceHistory` (lines 461-497): add an optional `signal` so a superseded 1Y request stops paging. New signature and loop body (the rest of the function, including the fail-closed cap block, is unchanged):

```ts
async function fetchPortfolioPriceHistory(
  productIds: number[],
  startIso: string,
  signal?: AbortSignal
): Promise<{
  rows: PortfolioPriceHistoryRow[] | null;
  error: Parameters<typeof logSupabaseError>[1];
  aborted?: boolean;
}> {
  const rows: PortfolioPriceHistoryRow[] = [];

  for (let page = 0; page < PRICE_HISTORY_MAX_PAGES; page++) {
    if (signal?.aborted) return { rows: null, error: null, aborted: true };
    const from = page * PRICE_HISTORY_PAGE_SIZE;
    let query = supabase
      .from("product_price_history")
      .select("product_id, usd_price, recorded_at")
      .in("product_id", productIds)
      .gte("recorded_at", startIso)
      .order("recorded_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PRICE_HISTORY_PAGE_SIZE - 1);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;

    if (signal?.aborted) return { rows: null, error: null, aborted: true };
    if (error) return { rows: null, error };
    if (!data || data.length === 0) return { rows, error: null };

    rows.push(...(data as PortfolioPriceHistoryRow[]));
    if (data.length < PRICE_HISTORY_PAGE_SIZE) return { rows, error: null };
  }
  // ... existing cap block unchanged ...
}
```

`.abortSignal()` is only called when a signal is passed; the existing tests pass none, so their mocked chain (`...range()` returning a Promise) keeps working.

10d. `getPortfolioHistory` (lines 584-738). Change the signature: `holdings` becomes required (the old fallback `holdingsInput ?? (await getHoldings(portfolioId))` queried a user table from the browser), and add `signal`. `portfolioId` stays as the first parameter because WP10 replaces this function with an RPC that takes it; ESLint's `after-used` rule does not flag it.

```ts
export async function getPortfolioHistory(
  portfolioId: number,
  days: number,
  holdings: HoldingWithProduct[],
  signal?: AbortSignal
): Promise<PortfolioHistoryPoint[]> {
  if (holdings.length === 0) return [];
```

Replace the date-window block at lines 614-624 (F111) with:

```ts
  // One point per UTC calendar day, ending today in UTC. recorded_at is a UTC
  // timestamp, the chart labels point.date with timeZone "UTC"
  // (PortfolioChartImpl), and the DB compares purchase_date with a UTC
  // current_date. Stepping by local days (setDate) instead made a DST change
  // skip or repeat a date, because a 23 or 25 hour step crosses a UTC midnight
  // twice or not at all.
  const endMs = utcMidnightMs();
  const startMs = endMs - days * DAY_MS;
  // Anchored to UTC midnight, not to now-minus-N-days. isPriceFresh judges by
  // calendar date, so a bound carrying the current time of day would exclude
  // rows recorded earlier on the oldest allowed date; the scraper writes
  // around 04:00 UTC.
  const priceHistoryStartDate = new Date(startMs - PRICE_STALENESS_TOLERANCE_DAYS * DAY_MS);

  const { rows: priceHistory, error, aborted } = await fetchPortfolioPriceHistory(
    productIds,
    priceHistoryStartDate.toISOString(),
    signal
  );

  if (aborted) return [];
  if (error || !priceHistory) {
    logSupabaseError("price_history_fetch_failed", error);
    return [];
  }
```

(This replaces lines 614-634; keep `const productIds = Array.from(holdingsByProduct.keys());` at 612 above it.) Replace the loop header at lines 670-674:

```ts
  // Generate date series
  const history: PortfolioHistoryPoint[] = [];

  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    const dateStr = new Date(ms).toISOString().slice(0, 10);
```

The loop body from `let dailyValue = 0;` (line 675) to the end of the function is unchanged. The point count is still `days + 1`.

10e. Leave `calculatePortfolioSummary`, `calculateHoldingPerformance`, `escapeLike`, `searchProducts`, `searchProductsBySet` and `getAllProducts` unchanged.

### Step 11. `app/lib/import.ts`: keys at parse time, one bulk request

11a. Imports (lines 1-15) become:

```ts
import type {
  CollectrCSVRow,
  ImportMatchResult,
  NewHoldingInput,
  ProductSearchResult,
} from "../components/Portfolio/types";
import { getAllProducts } from "./portfolio";
import { importHoldingRows } from "./portfolioApi";
import {
  QUANTITY_MAX,
  QUANTITY_MIN,
  PRICE_MAX,
  PRICE_MIN,
  clampNotes,
  isFiniteInRange,
  maxPurchaseDateKey,
} from "./validation";
```

11b. In `processCollectrImport` (line 400), add `idempotencyKey: crypto.randomUUID(),` to the pushed object, after `unmatchedReason,`. One key per row per parse: the preview's retry reuses them; "Back" and a new upload parse again and mint new ones. That is the per-attempt key the F033 verifier asked for. Do not derive the key from row content (a re-import of a corrected export would then skip unchanged rows and insert changed ones), and do not hash (the column is `uuid`; a hex digest fails with 22P02).

11c. Replace `importHoldings` (lines 412-487) with:

```ts
/**
 * Import the selected matches through POST /api/portfolio/import.
 *
 * Each row carries the idempotency key minted when the CSV was parsed, so a
 * retry of the same preview after a failure sends the same keys: rows that
 * already landed come back "duplicate" and count as imported instead of being
 * inserted twice (F033).
 *
 * Throws when a request fails as a whole (network, 401, 429, 5xx). The modal
 * then returns to the preview and the user retries with the same keys.
 */
export async function importHoldings(
  matches: ImportMatchResult[]
): Promise<ImportMatchResult[]> {
  const results: ImportMatchResult[] = [...matches];
  const rows: NewHoldingInput[] = [];
  const rowToMatch: number[] = [];

  matches.forEach((match, i) => {
    if (!match.matchedProduct || match.importStatus !== "pending") {
      results[i] = { ...match, importStatus: "skipped" };
      return;
    }
    const { quantity, averageCostPaid, dateAdded, notes } = match.csvRow;
    // Defense in depth: parsing coerces Infinity, NaN, negative and
    // out-of-range values to 0.
    if (!Number.isInteger(quantity) || quantity < QUANTITY_MIN || quantity > QUANTITY_MAX) {
      results[i] = { ...match, importStatus: "error", errorMessage: `Invalid quantity (${quantity})` };
      return;
    }
    if (!Number.isFinite(averageCostPaid) || averageCostPaid < PRICE_MIN || averageCostPaid > PRICE_MAX) {
      results[i] = { ...match, importStatus: "error", errorMessage: "Invalid price" };
      return;
    }
    rows.push({
      product_id: match.matchedProduct.id,
      quantity,
      purchase_price_usd: averageCostPaid,
      // Collectr exports YYYY-MM-DD. An empty date falls back to the latest
      // day both the viewer and the UTC DB CHECK accept (F060).
      purchase_date: dateAdded || maxPurchaseDateKey(),
      // Clamp AFTER adding the prefix: prefix plus a 1000-char note would
      // otherwise break portfolio_holdings_notes_len (migration 0008).
      notes: clampNotes(notes ? `Imported from Collectr. ${notes}` : "Imported from Collectr"),
      client_idempotency_key: match.idempotencyKey ?? crypto.randomUUID(),
    });
    rowToMatch.push(i);
  });

  if (rows.length === 0) return results;

  const rowResults = await importHoldingRows(rows);
  const answered = new Set<number>();
  for (const r of rowResults) {
    const i = rowToMatch[r.index];
    if (i === undefined) continue;
    answered.add(r.index);
    results[i] =
      r.status === "error"
        ? { ...matches[i], importStatus: "error", errorMessage: r.error ?? "Failed to add holding to portfolio" }
        : { ...matches[i], importStatus: "imported" };
  }
  rowToMatch.forEach((i, rowIndex) => {
    if (!answered.has(rowIndex)) {
      results[i] = { ...matches[i], importStatus: "error", errorMessage: "No result for this row" };
    }
  });
  return results;
}
```

`parseCollectrCSV`, the matcher and `calculateImportSummary` are unchanged (the CSV parser is WP18's F003).

### Step 12. `app/components/Portfolio/hooks/usePortfolioData.ts` (rewrite; F144, F053)

Replace the whole file:

```ts
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import {
  calculatePortfolioSummary,
  getPortfolioHistory,
} from "../../../lib/portfolio";
import { fetchPortfolio, PortfolioApiError } from "../../../lib/portfolioApi";
import { logCaughtError } from "../../../lib/logger";
import type {
  Portfolio,
  HoldingWithProduct,
  PortfolioSummary,
  PortfolioHistoryPoint,
  PortfolioTimeframe,
} from "../types";

interface UsePortfolioDataReturn {
  portfolio: Portfolio | null;
  holdings: HoldingWithProduct[];
  summary: PortfolioSummary;
  history: PortfolioHistoryPoint[];
  /** True only until the first portfolio + holdings load for this user finishes. */
  loading: boolean;
  /** True while the chart's history for the current timeframe and holdings is loading. */
  historyLoading: boolean;
  error: string | null;
  timeframe: PortfolioTimeframe;
  setTimeframe: (timeframe: PortfolioTimeframe) => void;
  /** Re-fetch portfolio + holdings in the background (after an import, or "Try Again"). */
  refresh: () => void;
  /** Put a holding returned by POST/PATCH into state; no refetch. */
  applyHoldingSaved: (holding: HoldingWithProduct) => void;
  applyHoldingDeleted: (holdingId: number) => void;
}

const TIMEFRAME_DAYS: Record<PortfolioTimeframe, number> = {
  "7D": 7,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  "ALL": 365,
};

type CoreState =
  | { userId: string; status: "ready"; portfolio: Portfolio; holdings: HoldingWithProduct[] }
  | { userId: string; status: "error"; message: string };

type HistoryState = {
  portfolioId: number;
  timeframe: PortfolioTimeframe;
  holdings: HoldingWithProduct[];
  points: PortfolioHistoryPoint[];
};

const NO_HOLDINGS: HoldingWithProduct[] = [];
const NO_HISTORY: PortfolioHistoryPoint[] = [];

function loadErrorMessage(err: unknown): string {
  if (err instanceof PortfolioApiError && err.status === 401) {
    return "Your session has expired. Please sign in again.";
  }
  return "Failed to load portfolio";
}

/**
 * Two independent loads, each cancelled by its effect cleanup:
 *  - portfolio + holdings: one GET /api/portfolio per user, repeated only by
 *    refresh(). A timeframe click never refetches them (F144).
 *  - history: keyed on portfolio id, timeframe and the holdings array it is
 *    computed from. Aborting the previous request means a slow 1Y response can
 *    never land after a later 7D one (F053).
 * `loading` is true only before the first data for this user, so a refresh or
 * a timeframe change never unmounts the dashboard (the table keeps its sort).
 * No setState runs synchronously in an effect body
 * (react-hooks/set-state-in-effect is an error in this repo).
 */
export function usePortfolioData(): UsePortfolioDataReturn {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [core, setCore] = useState<CoreState | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [historyState, setHistoryState] = useState<HistoryState | null>(null);
  const [timeframe, setTimeframe] = useState<PortfolioTimeframe>("1M");

  useEffect(() => {
    if (userId === null) return;
    const controller = new AbortController();
    fetchPortfolio(controller.signal).then(
      ({ portfolio, holdings }) => {
        if (controller.signal.aborted) return;
        setCore({ userId, status: "ready", portfolio, holdings });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        logCaughtError("portfolio_data_fetch_failed", err);
        setCore({ userId, status: "error", message: loadErrorMessage(err) });
      }
    );
    return () => controller.abort();
  }, [userId, reloadToken]);

  const current = core !== null && core.userId === userId ? core : null;
  const portfolio = current?.status === "ready" ? current.portfolio : null;
  const holdings = current?.status === "ready" ? current.holdings : NO_HOLDINGS;
  const portfolioId = portfolio?.id ?? null;

  useEffect(() => {
    if (portfolioId === null) return;
    const controller = new AbortController();
    getPortfolioHistory(portfolioId, TIMEFRAME_DAYS[timeframe], holdings, controller.signal).then(
      (points) => {
        if (controller.signal.aborted) return;
        setHistoryState({ portfolioId, timeframe, holdings, points });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        logCaughtError("portfolio_history_fetch_failed", err);
        setHistoryState({ portfolioId, timeframe, holdings, points: [] });
      }
    );
    return () => controller.abort();
  }, [portfolioId, timeframe, holdings]);

  const historyForPortfolio =
    historyState !== null && historyState.portfolioId === portfolioId ? historyState : null;
  const historyLoading =
    portfolioId !== null &&
    (historyForPortfolio === null ||
      historyForPortfolio.timeframe !== timeframe ||
      historyForPortfolio.holdings !== holdings);

  const summary = useMemo(() => calculatePortfolioSummary(holdings), [holdings]);

  const refresh = useCallback(() => {
    // After an error, drop back to the spinner so "Try Again" visibly works;
    // after a success, keep showing the current data while the refetch runs.
    setCore((prev) => (prev?.status === "error" ? null : prev));
    setReloadToken((token) => token + 1);
  }, []);

  const applyHoldingSaved = useCallback((saved: HoldingWithProduct) => {
    setCore((prev) => {
      if (prev === null || prev.status !== "ready") return prev;
      const exists = prev.holdings.some((h) => h.id === saved.id);
      return {
        ...prev,
        holdings: exists
          ? prev.holdings.map((h) => (h.id === saved.id ? saved : h))
          : [saved, ...prev.holdings],
      };
    });
  }, []);

  const applyHoldingDeleted = useCallback((holdingId: number) => {
    setCore((prev) =>
      prev === null || prev.status !== "ready"
        ? prev
        : { ...prev, holdings: prev.holdings.filter((h) => h.id !== holdingId) }
    );
  }, []);

  return {
    portfolio,
    holdings,
    summary,
    history: historyForPortfolio?.points ?? NO_HISTORY,
    loading: userId !== null && current === null,
    historyLoading,
    error: current?.status === "error" ? current.message : null,
    timeframe,
    setTimeframe,
    refresh,
    applyHoldingSaved,
    applyHoldingDeleted,
  };
}
```

Why local patching after add/edit/delete is safe here although the F144 verifier warned against it: that warning was about the old client `addHolding`, which returned a bare row without the `products` join and returned `null` for a duplicate. The new routes return the full joined, freshness-guarded row for insert, duplicate and update. Any change to `holdings` re-runs the history effect in the background, with the old chart kept on screen.

### Step 13. `app/components/Portfolio/hooks/useProductSearch.ts` (rewrite; F110)

Replace the whole file:

```ts
"use client";

import { useEffect, useState } from "react";
import { searchProducts } from "../../../lib/portfolio";
import type { ProductSearchResult } from "../types";

interface UseProductSearchReturn {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  results: ProductSearchResult[];
  loading: boolean;
  error: string | null;
}

type SearchResponse = {
  query: string;
  results: ProductSearchResult[];
  error: string | null;
};

const NO_RESULTS: ProductSearchResult[] = [];

/**
 * Debounced product search. A response is stored with the query it answers,
 * and only a response for the CURRENT query is shown, so a slower earlier
 * request can neither overwrite newer results nor clear the spinner early
 * (F110). The cleanup also drops any response that arrives after the query
 * changed. Everything else is derived during render: no setState runs
 * synchronously in the effect.
 */
export function useProductSearch(): UseProductSearchReturn {
  const [searchQuery, setSearchQuery] = useState("");
  const [response, setResponse] = useState<SearchResponse | null>(null);

  useEffect(() => {
    if (searchQuery.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchProducts(searchQuery).then(
        (results) => {
          if (!cancelled) setResponse({ query: searchQuery, results, error: null });
        },
        (err: unknown) => {
          if (!cancelled) {
            setResponse({
              query: searchQuery,
              results: [],
              error: err instanceof Error ? err.message : "Search failed",
            });
          }
        }
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const active = searchQuery.length >= 2;
  const current = active && response?.query === searchQuery ? response : null;

  return {
    searchQuery,
    setSearchQuery,
    results: current?.results ?? NO_RESULTS,
    loading: active && current === null,
    error: current?.error ?? null,
  };
}
```

Behavior change to accept: the spinner now shows during the 300 ms debounce too, instead of the previous query's results. `ProductSearchSelect.tsx:33` already hides results for queries shorter than 2 characters and needs no change.

### Step 14. `app/components/Portfolio/shared/PortfolioChart.tsx`: chart-only loading state

Add `loading?: boolean;` to `PortfolioChartProps` (after `height?: number;`), destructure `loading = false`, and replace the body of `PortfolioChart` from `if (data.length === 0) {` to the end with:

```tsx
  if (data.length === 0) {
    // First load of a range: show the skeleton, not "No historical data".
    if (loading) return <PortfolioChartSkeleton />;
    return (
      // ... the existing empty-state JSX, unchanged ...
    );
  }

  // Reload of a range: keep the previous chart visible, dimmed, until the new
  // data arrives. Only the chart signals loading; the rest of the dashboard
  // stays mounted (F053).
  return (
    <div aria-busy={loading} className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
      <PortfolioChartImpl
        data={data}
        timeframe={timeframe}
        onTimeframeChange={onTimeframeChange}
        currency={currency}
        exchangeRate={exchangeRate}
        height={height}
      />
    </div>
  );
```

Keep the empty-state JSX byte-identical to lines 60-71.

### Step 15. `app/components/Portfolio/PortfolioDashboard.tsx`

15a. Imports: replace line 5 (`useAuth`) and line 6 with `import { deleteHolding } from "../../lib/portfolioApi";`. `useAuth` is no longer needed here: delete `const { user } = useAuth();` (line 25).

15b. Destructure the new hook fields (lines 26-36):

```tsx
  const {
    portfolio,
    holdings,
    summary,
    history,
    loading,
    historyLoading,
    error,
    timeframe,
    setTimeframe,
    refresh,
    applyHoldingSaved,
    applyHoldingDeleted,
  } = usePortfolioData();
```

15c. Replace `handleDelete` through `handleImportSuccess` (lines 47-77) with:

```tsx
  const handleDelete = async (holdingId: number) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this holding? This action cannot be undone."
    );
    if (!confirmed) return;

    setDeleteLoading(holdingId);
    const success = await deleteHolding(holdingId);
    setDeleteLoading(null);

    if (success) {
      applyHoldingDeleted(holdingId);
    } else {
      alert("Failed to delete holding. Please try again.");
    }
  };

  const handleImportSuccess = () => {
    refresh();
  };
```

(`window.confirm`/`alert` stay; WP14 replaces them with accessible dialogs. `deleteLoading` keeps its existing unused-variable warning.)

15d. The `if (loading)` and `if (error)` blocks (lines 79-117) stay as they are; `onClick={refresh}` still works. With the new hook, `loading` is only true before the first load, so these no longer appear on a timeframe click or after a mutation.

15e. Pass `loading={historyLoading}` to `<PortfolioChart ... />` (lines 173-179).

15f. Replace the three modal blocks (lines 190-216) with:

```tsx
      {/* Add Modal: mounted only while open, so every open starts with a
          fresh form, a fresh idempotency key and today's date computed in
          the browser (never during SSR). */}
      {portfolio && isAddModalOpen && (
        <AddHoldingModal
          isOpen
          onClose={() => setIsAddModalOpen(false)}
          onSuccess={applyHoldingSaved}
        />
      )}

      {/* Edit Modal */}
      <EditHoldingModal
        holding={editingHolding}
        isOpen={!!editingHolding}
        onClose={() => setEditingHolding(null)}
        onSuccess={applyHoldingSaved}
      />

      {/* Import Modal */}
      {portfolio && (
        <ImportHoldingsModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          onSuccess={handleImportSuccess}
        />
      )}
```

`handleEdit` stays. `handleAddSuccess` and `handleEditSuccess` are deleted.

### Step 16. `app/components/Portfolio/cards/AddHoldingModal.tsx` (F033, F060)

16a. Imports (lines 3-17):

```tsx
import { useState, useEffect, useRef } from "react";
import ProductSearchSelect from "../shared/ProductSearchSelect";
import { addHolding } from "../../../lib/portfolioApi";
import { hasCurrentPrice } from "../../../lib/priceGuard";
import type { HoldingWithProduct, ProductSearchResult } from "../types";
import {
  QUANTITY_MAX,
  QUANTITY_MIN,
  PRICE_MAX,
  PRICE_MIN,
  clampNotes,
  isValidPastDate,
  isValidPrice,
  isValidQuantity,
  maxPurchaseDateKey,
} from "../../../lib/validation";
```

16b. Props (lines 19-31): remove `portfolioId` from the interface and the destructuring; change `onSuccess: () => void;` to `onSuccess: (holding: HoldingWithProduct) => void;`.

16c. Line 35: `const [purchaseDate, setPurchaseDate] = useState(() => maxPurchaseDateKey());`. This initializer runs in the browser only, because the dashboard mounts the modal after a click (step 15f); that is what keeps the local-date computation out of SSR, as the F060 verifier required.

16d. Delete the reset effect (lines 40-50, "Reset form when modal opens"): remounting on every open does its job. This also removes the lint error at line 43. Keep the pre-fill effect (lines 52-66) unchanged.

16e. Add below the `error` state:

```tsx
  // One idempotency key per distinct submission (F033). A retry with the same
  // values reuses it, so a request that reached the database before its
  // response was lost dedupes on portfolio_holdings_idem_uidx instead of
  // inserting a second row. Changing any field mints a new key, so edited
  // values are never swallowed as a "duplicate" of an earlier attempt. The
  // modal unmounts on close, so the next holding never inherits this key.
  const attemptRef = useRef<{ signature: string; key: string } | null>(null);
```

16f. In `handleSubmit`, replace from the date check (line 89) to the end of the function (line 115) with:

```tsx
    if (!isValidPastDate(purchaseDate, maxPurchaseDateKey())) {
      setError("Please select a valid date that is not in the future");
      return;
    }

    const cleanNotes = clampNotes(notes);
    const signature = JSON.stringify([selectedProduct.id, qty, price, purchaseDate, cleanNotes]);
    let attempt = attemptRef.current;
    if (attempt === null || attempt.signature !== signature) {
      attempt = { signature, key: crypto.randomUUID() };
      attemptRef.current = attempt;
    }

    setLoading(true);
    const result = await addHolding({
      product_id: selectedProduct.id,
      quantity: qty,
      purchase_price_usd: price,
      purchase_date: purchaseDate,
      notes: cleanNotes,
      client_idempotency_key: attempt.key,
    });
    setLoading(false);

    if (result.status === "error") {
      setError(result.message);
      return;
    }
    // "inserted" and "duplicate" are both success: the holding is saved.
    onSuccess(result.holding);
    onClose();
  };
```

16g. Line 198: `max={maxPurchaseDateKey()}`.

### Step 17. `EditHoldingModal.tsx` and `ImportHoldingsModal.tsx`

17a. `EditHoldingModal.tsx`:

- Line 4: `import { updateHolding } from "../../../lib/portfolioApi";`. Delete line 5 (`useAuth`) and line 31 (`const { user } = useAuth();`).
- Add `maxPurchaseDateKey` to the `validation` import, and `HoldingWithProduct` is already imported.
- Line 22: `onSuccess: (holding: HoldingWithProduct) => void;`.
- Add above the component:

```tsx
/**
 * Latest date the edit form accepts: today by the viewer's and the DB's
 * calendars (F060), or the holding's own stored date if that is later. A
 * holding saved in the evening before this fix can carry the UTC "tomorrow";
 * the DB accepted it, so re-saving it unchanged must not be blocked.
 */
function editMaxDate(storedDate: string): string {
  const max = maxPurchaseDateKey();
  return storedDate > max ? storedDate : max;
}
```

- Line 52: `if (!holding) return;`.
- Line 68: `if (!isValidPastDate(purchaseDate, editMaxDate(holding.purchase_date))) {`.
- Lines 82-91 become:

```tsx
    const result = await updateHolding(holding.id, updates);
    setLoading(false);

    if (result.ok) {
      onSuccess(result.holding);
      onClose();
    } else {
      setError(result.message);
    }
  };
```

- Line 190: `max={editMaxDate(holding.purchase_date)}` (the JSX is below the `if (!isOpen || !holding) return null;` guard, so `holding` is non-null there).
- Leave the populate effect (lines 39-48) as it is; its lint error is pre-existing and WP14 reworks the modals.

17b. `ImportHoldingsModal.tsx`: delete `portfolioId: number;` (line 23) and `portfolioId,` (line 32); line 158 becomes `const results = await importHoldings(toImport);`. Nothing else changes: on a throw the existing catch (lines 165-168) returns to the preview, and a retry reuses the keys minted in `processCollectrImport`.

### Step 18. ESLint guards (`eslint.config.mjs`)

18a. Append to WP04's `ANON_CLIENT_FORBIDDEN_FILES` array:

```js
  // WP05: portfolio user-table code. Reference reads (lib/portfolio.ts,
  // lib/clientMarketData.ts) may still use the anonymous client.
  "app/lib/import.ts",
  "app/lib/portfolioApi.ts",
  "app/lib/portfolioInput.ts",
  "app/lib/priceFreshness.ts",
  "app/lib/server/**/*.ts",
  "app/api/portfolio/**/*.ts",
  "app/components/Portfolio/**/*.{ts,tsx}",
  "app/portfolio/**/*.{ts,tsx}",
```

18b. WP04's pattern `(^|/)lib/supabase$` does not match the relative spellings used inside `app/lib` (`./supabase` from `import.ts`, `../supabase` from `app/lib/server/`). In WP04's `no-restricted-imports` block, add a second entry to its `patterns` array:

```js
            {
              regex: "^\\.{1,2}/supabase$",
              message:
                "app/lib/supabase is the anonymous browser client; RLS rejects it on user tables. Use a route handler (app/api/*) instead.",
            },
```

18c. Add a new config object at the end of the exported array. It is the guard that actually catches this class of bug (a user-table query from browser code), whatever client the file imports:

```js
  // WP05: portfolios / portfolio_holdings / portfolio_lots may be queried only
  // from route handlers (app/api/**) and server modules (app/lib/server/**).
  // Browser code runs as anon and RLS + migration 0013 reject it there.
  // WP06 adds box_recipes to this list once useBoxRecipes stops querying it.
  {
    files: ["app/**/*.{ts,tsx}", "proxy.ts"],
    ignores: ["app/api/**", "app/lib/server/**", "**/__tests__/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='from'][arguments.0.value=/^(portfolios|portfolio_holdings|portfolio_lots|profiles)$/]",
          message:
            "User tables are only reachable through cookie-backed route handlers (app/api/*). The browser Supabase client is anonymous and RLS rejects it here.",
        },
      ],
    },
  },
```

Include `profiles` only if this prints nothing: `grep -rn 'from("profiles")' app --include=*.ts --include=*.tsx | grep -v -e '^app/api/' -e '__tests__'` (it prints nothing once WP04 has landed). If it prints anything, drop `|profiles` from the regex and note it in the PR. Do not add `box_recipes` (`useBoxRecipes.ts` still queries it until WP06, so lint would fail).

If any earlier config object already sets `no-restricted-syntax` for overlapping files (none does at the time of writing; `pnpm exec eslint --print-config app/lib/portfolio.ts` shows it undefined), merge the selectors into one object: in flat config the later object replaces the earlier rule configuration for files both match.

The selector was verified with ESLint 9.39.5 while writing this spec: it flags `supabase.from("portfolio_holdings")` and does not flag `supabase.from("products")`.

### Step 19. Documentation

`audits/HARDENING_FOLLOWUPS.md`: in the bullet WP04 added ("Signed-in data ran as anon ... part 1 fixed"), change "part 1 fixed" to "parts 1 and 2 fixed" and append: "Portfolio reads and writes now go through /api/portfolio, /api/portfolio/holdings, /api/portfolio/holdings/[id] and /api/portfolio/import (WP05); history still reads product_price_history on the anonymous client until WP10." If that bullet does not exist, add it with that content as the first bullet of section 7.

## Pitfalls: do not do this

- **Do not bridge the session to the browser client** (`/api/auth/me` returning tokens plus `supabase.auth.setSession`, or the `accessToken` option). F001 verifiers: it writes the JWT back into JS-readable storage and reopens audit F-2, and with `accessToken` set supabase-js throws on every `supabase.auth.*` call.
- **Do not re-grant `anon` or loosen the `TO authenticated` policies** on `portfolios` / `portfolio_holdings` / `portfolio_lots`. RLS is doing its job; the client was wrong.
- **Do not mirror PostgREST one route per old function.** A 1:1 port of the ~15 calls plus one request per imported row runs into the proxy's 60/min per-IP limit (`rateLimit.ts`). One batched GET, per-holding writes, and one bulk import POST per 250 rows.
- **Do not move reference reads server-side here.** `searchProducts`, `getAllProducts`, `getPortfolioHistory` and the market summaries stay on the anonymous client (they read anon-readable tables and work in production). WP10 replaces `getPortfolioHistory` with an RPC; WP11 owns caching.
- **Do not import `lib/portfolio.ts` or `lib/clientMarketData.ts` from server code.** `clientMarketData.ts` is a `"use client"` module and both use the browser client. Server code uses `serverMarketData.ts` and `priceFreshness.ts`.
- **Do not mint the idempotency key inside `addHolding`, the route or the repo** (the original F033 bug), and do not keep one never-rotated key per component (F033 verifier: the next distinct holding would collide and be silently dropped as a duplicate).
- **Do not derive import keys from row content, and do not use a hash as the key.** The column is `uuid`, so a sha256 hex string fails with 22P02; and a content key makes a deliberate re-import of a corrected export skip unchanged rows while inserting changed ones. Per-parse random UUIDs are the chosen design, so re-importing the same file after "Back" or a new upload inserts again, by design.
- **Do not return the same value for "duplicate" and "error".** Duplicate is success: the Add modal closes and the import counts the row as imported.
- **Do not use `upsert` / `onConflict` / `ignoreDuplicates` for the import.** `portfolio_holdings_idem_uidx` is a partial index and PostgREST cannot pass its `WHERE` predicate, so Postgres answers 42P10. Use the key lookup plus batch insert in step 7.
- **Do not loosen server date validation or the DB CHECK** (F060 verifier). `isValidPastDate` without a second argument stays UTC on the server. Only the client default and `max` use `maxPurchaseDateKey()` (the earlier of local and UTC today). Using `max(localToday, utcToday)` would let an east-of-UTC morning date through to a raw constraint error.
- **Do not compute the local date during SSR.** It is computed in a `useState` initializer of a component that mounts only after a click (step 15f) and in handlers. Do not render `AddHoldingModal` unconditionally.
- **Do not call setState synchronously in an effect body**, and do not add `eslint-disable` for `react-hooks/set-state-in-effect`. Set state only in promise callbacks or event handlers, and derive `loading` / `historyLoading` during render as shown.
- **Do not put `setLoading(true)` at the top of a refresh** or gate the whole dashboard on it. Only the chart shows history loading.
- **Do not check `Origin` on the GET route.** Browsers omit `Origin` on same-origin GETs, so every load would get 403. Use the header-only `rejectIfNotAppRequest`.
- **Do not trust a `portfolio_id` from the request.** The server resolves the caller's portfolio from the session, and PATCH/DELETE filter on it.
- **Do not pass the request body to `.update()`.** `parseHoldingUpdate` copies only the four editable columns.
- **Do not echo PostgREST error messages** to the client; use `describeWriteError` and log with `logSupabaseError`.
- **Do not return `[]` holdings on a read error.** The route answers 500 so the dashboard shows "Failed to load portfolio" and a retry, not an empty portfolio.
- **Do not build a lots route or recreate `getPortfolioById` / `updatePortfolioName` / `getHoldingById`.** Nothing calls them.
- **Do not add `export const dynamic` or `runtime`** to the new routes; reading cookies already makes them dynamic.

## Tests

Route and repo tests start with `/** @jest-environment node */` (`next/server` throws under jsdom). Mock `routeSupabase` rather than importing it (it imports `server-only` and `next/headers`), and mock `server-only` with `jest.mock("server-only", () => ({}))` wherever a module under test imports it, as `serverMarketData.freshness.test.ts:12` does.

### 1. `app/lib/server/__tests__/portfolioRepo.test.ts` (new)

Use a thenable query-builder fake so any chain resolves to a canned result:

```ts
/** @jest-environment node */
jest.mock("server-only", () => ({}));
jest.mock("../../serverMarketData", () => ({
  getCachedMarketProductSummaries: jest.fn(),
  fetchNewestPricedAtForProducts: jest.fn(),
}));
jest.mock("../../logger", () => ({ logCaughtError: jest.fn(), logSupabaseError: jest.fn() }));

import {
  fetchNewestPricedAtForProducts,
  getCachedMarketProductSummaries,
} from "../../serverMarketData";
import {
  getOrCreatePortfolio,
  insertHolding,
  insertImportedHoldings,
  loadPortfolioPayload,
  updateHolding,
  deleteHolding,
} from "../portfolioRepo";

type Result = { data?: unknown; error?: { code?: string; message?: string } | null };
type Call = { method: string; args: unknown[] };

/** Every method returns the builder; awaiting it resolves to `result`. */
function q(result: Result) {
  const calls: Call[] = [];
  const builder: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          const settled = Promise.resolve({ data: null, error: null, ...result });
          return settled.then.bind(settled);
        }
        if (prop === "calls") return calls;
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args });
          return builder;
        };
      },
    }
  );
  return builder as unknown as { calls: Call[] };
}

const fromMock = jest.fn();
const supabase = { from: fromMock } as never;
const summariesMock = getCachedMarketProductSummaries as jest.Mock;
const newestMock = fetchNewestPricedAtForProducts as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  summariesMock.mockResolvedValue([]);
  newestMock.mockResolvedValue(new Map());
});
```

Cases:

- `getOrCreatePortfolio`: returns the existing row without inserting (one `from` call); inserts when none exists and returns the created row; on insert error `23505` re-reads and returns the winner; returns `null` and logs on a select error other than none; returns `null` on an insert error other than 23505.
- `loadPortfolioPayload` freshness, migrated from `portfolio.freshness.test.ts:182-260` (same four cases, same fixtures; queue `q({ data: PORTFOLIO })` then `q({ data: [holdingRow] })`): keeps a deactivated product's price when `newestMock` returns a recent matching row; withholds it when `newestMock` returns an empty map; takes the guarded price when the summaries contain the product (and does not call `newestMock`); withholds every price when `summariesMock` rejects. Also: returns `null` when the holdings select errors (not `[]`), and the holdings query filters `portfolio_id` with the portfolio's id (assert on `.calls`).
- `insertHolding`: success returns `{ status: "inserted" }` with the guarded row, and the insert payload contains `portfolio_id` and the caller's `client_idempotency_key` unchanged; error `23505` then a successful re-read returns `{ status: "duplicate", holding }` and the re-read filters on `client_idempotency_key`; error `23514` returns `{ status: "error", code: "23514" }`.
- `updateHolding`: filters on both `id` and `portfolio_id`; `data: null` returns `not_found`; error returns the code.
- `deleteHolding`: `data: []` returns `not_found`; `data: [{ id: 5 }]` returns `deleted`.
- `insertImportedHoldings`: (a) a key returned by the lookup is `duplicate` and is not in the insert payload; (b) two rows with the same key in one request: second is `duplicate`; (c) a successful batch marks all `imported`; (d) a failing batch falls back to per-row inserts where row A succeeds, row B fails `23505` (`duplicate`) and row C fails `23514` (`error`, "A value is out of range"); (e) a lookup error throws; (f) 120 rows issue two lookup calls (100 + 20) and three insert calls (50 + 50 + 20).

### 2. `app/api/portfolio/__tests__/routes.test.ts` (new)

```ts
/** @jest-environment node */
import { NextRequest } from "next/server";

const getUser = jest.fn();
jest.mock("../../../lib/routeSupabase", () => ({
  createRouteSupabaseClient: async () => ({ auth: { getUser } }),
}));
jest.mock("../../../lib/server/portfolioRepo", () => ({
  loadPortfolioPayload: jest.fn(),
  getOrCreatePortfolio: jest.fn(),
  findPortfolioId: jest.fn(),
  insertHolding: jest.fn(),
  updateHolding: jest.fn(),
  deleteHolding: jest.fn(),
  insertImportedHoldings: jest.fn(),
}));
jest.mock("../../../lib/logger", () => ({ logCaughtError: jest.fn(), logSupabaseError: jest.fn() }));

import * as repo from "../../../lib/server/portfolioRepo";
import { GET } from "../route";
import { POST as postHolding } from "../holdings/route";
import { PATCH, DELETE } from "../holdings/[id]/route";
import { POST as postImport } from "../import/route";

const USER = { id: "user-1" };
const PORTFOLIO = { id: 7, user_id: "user-1", name: "My Portfolio", created_at: "", updated_at: "" };
const KEY = "0b7c8f2e-3a1d-4c5e-9f6a-7b8c9d0e1f2a";
const VALID = {
  product_id: 42,
  quantity: 2,
  purchase_price_usd: 100,
  purchase_date: "2026-01-15",
  notes: null,
  client_idempotency_key: KEY,
};

function req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = {
    "x-pokefin-request": "1",
    origin: "https://pokefin.ca",
    "content-type": "application/json",
    ...init.headers,
  };
  return new NextRequest(`https://pokefin.ca${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: USER }, error: null });
  (repo.getOrCreatePortfolio as jest.Mock).mockResolvedValue(PORTFOLIO);
  (repo.findPortfolioId as jest.Mock).mockResolvedValue(7);
});
```

Cases (assert status, body and `Cache-Control: no-store` on every non-403 response):

- GET: 403 without `x-pokefin-request`; 200 WITHOUT an `origin` header (same-origin GET); 401 when `getUser` returns no user (repo not called); 500 when `loadPortfolioPayload` returns null; 200 with `{ portfolio, holdings }`; 500 when the repo throws.
- POST holdings: 403 without the header; 403 with `origin: https://evil.example`; 413 with `content-length: 9000`; 401 without a user (repo not called); 400 on invalid JSON; 400 on `client_idempotency_key: "abc"`; 400 on a future date (`"2999-01-01"`); 201 `{ status: "inserted" }`; 200 `{ status: "duplicate" }`; 400 when `insertHolding` returns code `23514`; 500 for code `XX000`; the body sent to `insertHolding` has no `portfolio_id` from the client and uses `PORTFOLIO.id` as the second argument even if the request body carries `portfolio_id: 999`.
- PATCH: 400 for id `"abc"`, `"0"` and `"-1"`; 400 for `{}` ("Nothing to update"); unknown keys such as `portfolio_id` and `client_idempotency_key` are not forwarded to `updateHolding`; 404 when `findPortfolioId` returns null; 404 on `not_found`; 200 `{ holding }`; 500 when `findPortfolioId` throws.
- DELETE: 403 without the header; 404 on `not_found`; 200 `{ ok: true }` with `deleteHolding` called as `(supabase, 7, 5)`.
- Import: 400 for `{ rows: [] }` and for 251 rows; a request with rows `[valid, invalid(quantity 0), valid]` calls `insertImportedHoldings` with the two valid rows only and answers `results` of length 3 with `index` 0..2, the middle one `{ status: "error", error: QUANTITY_MESSAGE }`; 500 when `insertImportedHoldings` throws.

### 3. `app/lib/__tests__/portfolioInput.test.ts` (new, jsdom default is fine)

`parseNewHolding`: accepts `VALID` and lowercases the key; rejects non-object, product id `0` / `1.5` / `"42"`, quantity `0` / `100001` / `1.5`, price `-1` / `NaN`, date `"2026-02-31"` and tomorrow in UTC, non-string notes, missing key; clamps 1500-char notes to 1000. `parseHoldingUpdate`: `{}` fails; `{ quantity: 3, portfolio_id: 9, id: 1 }` yields exactly `{ quantity: 3 }`; `notes: null` is kept as `null`. `parseImportEnvelope`: rejects `null`, `{ rows: "x" }`, empty and oversize arrays. `describeWriteError`: 23503 and 23514 are 400, `undefined` and `XX000` are 500, and no message contains the input code.

### 4. `app/lib/__tests__/validation.test.ts` (update)

Add:

```ts
describe("maxPurchaseDateKey", () => {
  it("uses the local day for an evening viewer west of UTC", () => {
    // 21:30 in Toronto on Sep 25 is 01:30 UTC on Sep 26.
    expect(maxPurchaseDateKey(new Date("2026-09-26T01:30:00Z"), "America/Toronto")).toBe("2026-09-25");
  });
  it("uses the UTC day for a morning viewer east of UTC", () => {
    // 05:00 in Tokyo on Sep 26 is 20:00 UTC on Sep 25; the DB would reject Sep 26.
    expect(maxPurchaseDateKey(new Date("2026-09-25T20:00:00Z"), "Asia/Tokyo")).toBe("2026-09-25");
  });
  it("agrees with UTC when the calendars agree", () => {
    expect(maxPurchaseDateKey(new Date("2026-09-25T12:00:00Z"), "America/Vancouver")).toBe("2026-09-25");
  });
});

describe("isValidPastDate with a max", () => {
  it("rejects a date after the given max", () => {
    expect(isValidPastDate("2026-09-26", "2026-09-25")).toBe(false);
    expect(isValidPastDate("2026-09-25", "2026-09-25")).toBe(true);
  });
  it("rejects impossible calendar dates", () => {
    expect(isValidPastDate("2026-02-31")).toBe(false);
  });
});
```

Also `localDateKey(new Date("2026-03-08T06:59:00Z"), "America/Toronto") === "2026-03-08"` and `utcDateKey(new Date("2026-09-26T01:30:00Z")) === "2026-09-26"`. Keep every existing case.

### 5. `app/lib/__tests__/portfolio.freshness.test.ts` (update)

- Remove the `getHoldings freshness map` describe (lines 182-260) and `getHoldings` from the import (they moved to test 1).
- The three `getPortfolioHistory coverage` cases keep passing unchanged (signature kept, holdings passed).
- Add a F111 describe. Fake the clock with `jest.useFakeTimers({ now, doNotFake: ["nextTick", "queueMicrotask"] })` and restore with `jest.useRealTimers()` in `afterEach`:
  - "ends on today's UTC date and has days+1 unique, contiguous points": `now = new Date("2026-09-26T00:30:00Z")`, `mockPriceHistoryRows([])`, `getPortfolioHistory(1, 7, [makeHolding({ product_id: 1 })])`; dates are `2026-09-19` .. `2026-09-26`, length 8, each consecutive pair exactly 86 400 000 ms apart.
  - "neither skips nor repeats a date across the November DST change": `now = new Date("2026-11-04T00:30:00Z")` (19:30 EST on Nov 3; DST ended Nov 1), 7 days; dates are exactly `2026-10-28` .. `2026-11-04`, length 8, `2026-11-01` present exactly once. Verified with Node 22 while writing this spec: the old loop under `TZ=America/Toronto` produces `2026-10-27 ... 2026-10-31, 2026-11-02, 2026-11-03, 2026-11-04` (starts a day early and skips `2026-11-01`), so this case fails on the old code in that zone and passes on the new code in any zone.
  - "returns [] without logging when aborted": pass an already-aborted `AbortController().signal`; result `[]`, `logSupabaseError` not called, `fromMock` not called.

The DST case is only discriminating when the Jest process runs west of UTC, which is why Verification runs this file a second time with `TZ=America/Toronto`.

### 6. `app/components/Portfolio/__tests__/usePortfolioData.test.tsx` (new)

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import type { HoldingWithProduct, PortfolioHistoryPoint } from "../types";

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));
jest.mock("../../../lib/portfolioApi", () => {
  class PortfolioApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { fetchPortfolio: jest.fn(), PortfolioApiError };
});
jest.mock("../../../lib/portfolio", () => ({
  getPortfolioHistory: jest.fn(),
  calculatePortfolioSummary: jest.fn(() => ({
    total_cost_basis: 0,
    priced_cost_basis: 0,
    total_current_value: 0,
    total_gain_loss: 0,
    total_gain_loss_percent: 0,
    holdings_count: 0,
    unpriced_holdings_count: 0,
    unique_products_count: 0,
  })),
}));
jest.mock("../../../lib/logger", () => ({ logCaughtError: jest.fn() }));

import { fetchPortfolio, PortfolioApiError } from "../../../lib/portfolioApi";
import { getPortfolioHistory } from "../../../lib/portfolio";
import { usePortfolioData } from "../hooks/usePortfolioData";

const fetchPortfolioMock = fetchPortfolio as jest.Mock;
const historyMock = getPortfolioHistory as jest.Mock;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
const point = (date: string): PortfolioHistoryPoint => ({ date, value: 1, priced_products: 1, held_products: 1 });
const PORTFOLIO = { id: 7, user_id: "user-1", name: "My Portfolio", created_at: "", updated_at: "" };
const HOLDING = { id: 1, product_id: 42 } as HoldingWithProduct;

beforeEach(() => {
  jest.clearAllMocks();
  fetchPortfolioMock.mockResolvedValue({ portfolio: PORTFOLIO, holdings: [HOLDING] });
});

it("keeps the newest timeframe's history when an older request resolves last", async () => {
  const initial = deferred<PortfolioHistoryPoint[]>();
  const slow1Y = deferred<PortfolioHistoryPoint[]>();
  const fast7D = deferred<PortfolioHistoryPoint[]>();
  historyMock.mockImplementation((_id: number, days: number) =>
    days === 30 ? initial.promise : days === 365 ? slow1Y.promise : fast7D.promise
  );

  const { result } = renderHook(() => usePortfolioData());
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => initial.resolve([point("2026-08-27")]));

  act(() => result.current.setTimeframe("1Y"));
  act(() => result.current.setTimeframe("7D"));
  await act(async () => fast7D.resolve([point("2026-09-20")]));
  await act(async () => slow1Y.resolve([point("2025-09-20")]));

  expect(result.current.timeframe).toBe("7D");
  expect(result.current.history).toEqual([point("2026-09-20")]);
  expect(result.current.historyLoading).toBe(false);
  // The 1Y request was aborted, not merely ignored.
  const oneYearCall = historyMock.mock.calls.find((c) => c[1] === 365)!;
  expect((oneYearCall[3] as AbortSignal).aborted).toBe(true);
});
```

Further cases in the same file:

- A timeframe change never calls `fetchPortfolio` again (exactly 1 call after three timeframe changes) and `loading` stays `false` throughout (record `result.current.loading` after each `act`).
- While a new timeframe loads, `historyLoading` is `true` and `history` still holds the previous points (the chart is dimmed, not blanked).
- `applyHoldingSaved(newHolding)` puts it first in `holdings`, re-runs `getPortfolioHistory` with the new array, and does not call `fetchPortfolio`; `applyHoldingSaved` with an existing id replaces it in place; `applyHoldingDeleted(1)` removes it.
- Error: `fetchPortfolio` rejects with `new PortfolioApiError("x", 401)`: `error` is "Your session has expired. Please sign in again." and `loading` is false; then `act(() => result.current.refresh())` sets `loading` to true and, after a successful second fetch, `error` is null and `portfolio` is set. A plain `Error` yields "Failed to load portfolio".
- Unmounting before `fetchPortfolio` resolves logs nothing and sets no state (no act warning): the signal passed to it is aborted.

### 7. `app/components/Portfolio/__tests__/useProductSearch.test.tsx` (new)

Mock `../../../lib/portfolio` with `searchProducts: jest.fn()`. Use `jest.useFakeTimers()`:

- Out of order: `"pika"` resolves after `"pikachu"`. Type `"pika"`, advance 300 ms, type `"pikachu"`, advance 300 ms, resolve `pikachu` with `[P2]`, then `pika` with `[P1]`: `results` is `[P2]` and `loading` is false.
- Early resolution does not clear the spinner: after typing `"pikachu"` and resolving only the `"pika"` request, `loading` is true and `results` is `[]`.
- A query shorter than 2 characters returns `[]`, `loading` false, and never calls `searchProducts`.
- Debounce: typing `"pi"`, `"pik"`, `"pika"` within 300 ms calls `searchProducts` once, with `"pika"`.

### 8. `app/components/Portfolio/__tests__/AddHoldingModal.test.tsx` (new)

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// The factory uses require + createElement rather than JSX: a jest.mock factory
// must not reference out-of-scope bindings such as the compiled JSX helper.
jest.mock("../shared/ProductSearchSelect", () => ({
  __esModule: true,
  default: ({ onSelect }: { onSelect: (p: unknown) => void }) => {
    const React = require("react");
    return React.createElement(
      "button",
      {
        type: "button",
        onClick: () =>
          onSelect({ id: 42, usd_price: null, image_url: null, variant: null, sets: null, product_types: null }),
      },
      "pick"
    );
  },
}));
jest.mock("../../../lib/portfolioApi", () => ({ addHolding: jest.fn() }));

import { addHolding } from "../../../lib/portfolioApi";
import AddHoldingModal from "../cards/AddHoldingModal";

const addHoldingMock = addHolding as jest.Mock;
const SAVED = { id: 9, product_id: 42 };

function renderModal() {
  const onSuccess = jest.fn();
  const onClose = jest.fn();
  const view = render(<AddHoldingModal isOpen onClose={onClose} onSuccess={onSuccess} />);
  fireEvent.click(screen.getByText("pick")); // select the product (price is cleared: usd_price null)
  return { ...view, onSuccess, onClose };
}

async function submit(price = "10") {
  fireEvent.change(screen.getAllByRole("spinbutton")[1], { target: { value: price } }); // [0] is quantity
  fireEvent.click(screen.getByRole("button", { name: "Add Holding" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Add Holding" })).not.toBeDisabled());
}

const keyOfCall = (n: number) => (addHoldingMock.mock.calls[n][0] as { client_idempotency_key: string }).client_idempotency_key;
```

Cases:

- A retry with the same values reuses the key: first call resolves `{ status: "error", message: "Network error. Check your connection and try again." }` (the message is shown), second resolves `{ status: "duplicate", holding: SAVED }`; both calls carry the same `client_idempotency_key` (a UUID), `onSuccess` is called with `SAVED`, `onClose` once.
- Changing a field after a failure mints a new key: error, change quantity to 3, submit: the two keys differ.
- Two separate mounts (simulating close and reopen) use different keys.
- `{ status: "inserted", holding }` calls `onSuccess(holding)` and `onClose()`.
- The date input (`container.querySelector('input[type="date"]')`) has `value` and `max` equal to `maxPurchaseDateKey()` at render time.
- The request body contains no `portfolio_id`.

### 9. `app/lib/__tests__/import.holdings.test.ts` (new)

Mock `../portfolio` (`getAllProducts: jest.fn()`) and `../portfolioApi` (`importHoldingRows: jest.fn()`). Cases:

- `processCollectrImport` gives every result a distinct UUID `idempotencyKey` (use two rows with `Category=Pokemon`, `Portfolio Name=Sealed Product` and an unsupported product name so no product catalog is needed).
- `importHoldings`: unmatched and non-pending rows become `skipped` and are not sent; quantity `0` becomes `error` "Invalid quantity (0)" and is not sent; a `duplicate` result maps to `imported`; an `error` result maps to `error` with the server message; `client_idempotency_key` equals the match's `idempotencyKey`; calling `importHoldings` twice with the same matches sends identical keys.
- An empty `dateAdded` sends `purchase_date === maxPurchaseDateKey()`; a 1000-char note is sent at 1000 chars including the "Imported from Collectr. " prefix.
- A rejection from `importHoldingRows` propagates (the modal relies on it).

### 10. `app/lib/__tests__/portfolioApi.test.ts` (new)

Replace `global.fetch` with a `jest.fn()` returning plain objects `{ ok, status, json: async () => body }` (jsdom has no `Response`). Cases: every call sends `x-pokefin-request: 1` and `credentials: "same-origin"`; `fetchPortfolio` throws `PortfolioApiError` with status 401 and the session message; `addHolding` maps 201/200 bodies to `inserted`/`duplicate`, a 400 `{ error: "X" }` to `{ status: "error", message: "X" }`, a thrown fetch to the network message; `updateHolding` hits `/api/portfolio/holdings/5` with PATCH; `deleteHolding` returns `false` on 404 and on a throw; `importHoldingRows` with 600 rows makes 3 requests of 250, 250 and 100 rows and re-bases `index` (the last result's index is 599); a 500 on the second chunk throws after the first chunk's request was made.

### 11. `app/components/Portfolio/__tests__/PortfolioChart.test.tsx` (new)

`render(<PortfolioChart data={[]} loading timeframe="1M" onTimeframeChange={jest.fn()} />)`: "No historical data available yet" is absent and the "Portfolio Value" heading is present. Without `loading`, the empty text is present.

### 12. `app/lib/__tests__/serverMarketData.freshness.test.ts` (update)

Add one case: `fetchNewestPricedAtForProducts([])` returns an empty map without calling `fromMock`; when `fromMock`'s chain resolves `{ data: null, error: { code: "57014" } }`, it returns an empty map and calls `logSupabaseError`.

### Existing tests that must keep passing unchanged

`portfolio.test.ts`, `import.test.ts`, `HoldingCard.test.tsx`, `HoldingsTable.test.tsx`, `PortfolioSummaryCard.test.tsx`, `validation.test.ts` (existing cases).

## Verification

From `frontend/`:

```bash
pnpm exec tsc --noEmit
# expect: exit 0

pnpm exec eslint app/lib app/api/portfolio app/components/Portfolio app/portfolio eslint.config.mjs
# expect: exactly 7 errors, all pre-existing and outside this PR's rewrites:
#   AddHoldingModal (pre-fill effect, react-hooks/set-state-in-effect),
#   EditHoldingModal (populate effect), HoldingsTable x5 (react-hooks/static-components, WP17).
# usePortfolioData.ts, useProductSearch.ts and every new file: 0 errors.

pnpm run lint 2>&1 | tail -1
# expect: the error count is 4 lower than on the base branch (record both numbers in the PR).

# Guard 1: no user-table query outside routes and server modules. Expect no output.
grep -rnE 'from\("(portfolios|portfolio_holdings|portfolio_lots)"\)' app --include=*.ts --include=*.tsx \
  | grep -v -e '^app/api/' -e '^app/lib/server/' -e '__tests__'

# Guard 2: the lint rules fire. Expect 2 errors (no-restricted-imports, no-restricted-syntax).
mkdir -p app/components/Portfolio/probe && cat > app/components/Portfolio/probe/probe.ts <<'EOF'
import { supabase } from "../../../lib/supabase";
export const probe = supabase.from("portfolio_holdings").select("id");
EOF
pnpm exec eslint app/components/Portfolio/probe/probe.ts; rm -rf app/components/Portfolio/probe
# And a server file importing ../supabase. Expect 1 error (no-restricted-imports).
printf 'import { supabase } from "../supabase";\nexport const p = supabase;\n' > app/lib/server/probe.ts
pnpm exec eslint app/lib/server/probe.ts; rm app/lib/server/probe.ts
# lib/portfolio.ts may still import the anon client. Expect 0 errors from this file.
pnpm exec eslint app/lib/portfolio.ts

# Keys are minted by callers only. Expect hits in AddHoldingModal.tsx and import.ts
# (crypto.randomUUID), none in portfolioRepo.ts or the routes.
grep -rn "randomUUID" app --include=*.ts --include=*.tsx | grep -v __tests__

pnpm exec jest app/api/portfolio app/lib/server app/lib/__tests__/portfolio app/lib/__tests__/import \
  app/lib/__tests__/validation.test.ts app/lib/__tests__/portfolioInput.test.ts \
  app/lib/__tests__/portfolioApi.test.ts app/lib/__tests__/serverMarketData.freshness.test.ts \
  app/components/Portfolio
# expect: all suites pass

TZ=America/Toronto pnpm exec jest app/lib/__tests__/portfolio.freshness.test.ts app/lib/__tests__/validation.test.ts
# expect: pass (the DST case is only discriminating west of UTC)

pnpm test --ci
# expect: all suites pass; suite count = base count + 9 new files

pnpm build:stub
# expect: exit 0; the route table lists ƒ /api/portfolio, ƒ /api/portfolio/holdings,
# ƒ /api/portfolio/holdings/[id] and ƒ /api/portfolio/import (dynamic)
```

Local smoke test of the gates, using WP00's stub (no real Supabase needed):

```bash
node scripts/supabase-stub.mjs &            # listens on 127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_KEY=stub pnpm dev &
# wait for "Ready", then:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/portfolio
# 403 (no x-pokefin-request)
curl -s -o /dev/null -w "%{http_code}\n" -H 'x-pokefin-request: 1' http://localhost:3000/api/portfolio
# 401 (no session cookie)
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'x-pokefin-request: 1' \
  -H 'content-type: application/json' -d '{}' http://localhost:3000/api/portfolio/holdings
# 403 (no Origin)
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'x-pokefin-request: 1' -H 'origin: http://localhost:3000' \
  -H 'content-type: application/json' -d '{}' http://localhost:3000/api/portfolio/holdings
# 401
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE -H 'x-pokefin-request: 1' -H 'origin: http://localhost:3000' \
  http://localhost:3000/api/portfolio/holdings/abc
# 400 (invalid id, checked before auth)
# stop both background processes afterwards (kill %1 %2)
```

Signed-in behavior needs a real Supabase project, which the executor does not have; it is the first Owner action. Paste all command output into the PR description.

## Owner actions

1. **Signed-in smoke test before or right after production deploy.** Preview deployments on `*.vercel.app` cannot be used for writes: `rejectIfCsrfFails` allows only `NEXT_PUBLIC_SITE_URL`, `pokefin.ca` and `www.pokefin.ca` (`csrf.ts:3-9`), and sign-in itself is a CSRF-gated POST. Either run the branch locally against the real project (`pnpm dev` with the production `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_KEY` in `.env.local`; `http://localhost` origins are allowed outside production), or check production within minutes of the deploy. Steps, with DevTools Network open:
   1. Sign in, open `/portfolio`. Expect the dashboard (not "Failed to load portfolio"), exactly one `GET /api/portfolio` with 200, and no request to `*.supabase.co/rest/v1/portfolios` or `/rest/v1/portfolio_holdings`.
   2. Click 7D, 1M, 1Y quickly. Expect no full-page spinner, the holdings table keeps its sort, the chart dims and ends on the range whose button is highlighted, and no new `GET /api/portfolio`.
   3. Add a holding. Expect one `POST /api/portfolio/holdings` with 201, the row at the top of the table, no page spinner. The date field is today's local date after 8 pm Eastern (not tomorrow).
   4. Set DevTools to Offline, click Add Holding again with a new product: expect "Network error...". Go Online, click Add Holding again without changing anything: expect success and ONE new row (the retry reused the key).
   5. Edit that holding's quantity: one `PATCH` with 200, the row updates in place. Delete it: one `DELETE` with 200, the row disappears.
   6. Import a small Collectr CSV (2 or 3 sealed rows): one `POST /api/portfolio/import`, the summary shows the right "Imported" count, and the table shows the rows after "Done".
   7. In the product search, type a name quickly and pause: the list matches the final text.
2. **Confirm the 401 noise is gone.** Supabase dashboard, Logs, API (edge) logs, filter path contains `/rest/v1/portfolio` and status 401, last 24 hours after the deploy. Expect zero rows (before the deploy every signed-in `/portfolio` visit produced them).

No migration, environment variable or dashboard setting changes.

## Acceptance criteria

- [ ] `grep -rnE 'from\("(portfolios|portfolio_holdings|portfolio_lots)"\)'` finds matches only under `app/api/` and `app/lib/server/`.
- [ ] `app/lib/portfolio.ts` contains no user-table query and no `getOrCreatePortfolio`, `getHoldings`, `addHolding`, `updateHolding`, `deleteHolding`, `userOwnsHolding`, `getPortfolioById`, `updatePortfolioName` or `getHoldingById`.
- [ ] `GET /api/portfolio` returns `{ portfolio, holdings }` with freshness-guarded prices, 403 without `x-pokefin-request`, 401 without a session, `Cache-Control: no-store` on every non-403 answer.
- [ ] `POST /api/portfolio/holdings`, `PATCH` / `DELETE /api/portfolio/holdings/[id]` and `POST /api/portfolio/import` reject a missing header or foreign Origin with 403, an oversized body with 413, no session with 401, and never echo a PostgREST message.
- [ ] A retried add with the same values sends the same `client_idempotency_key`; the server answers `duplicate` for an existing key and the UI treats it as success.
- [ ] The Collectr import sends at most one request per 250 rows, and a retry of the same preview reports already-saved rows as imported without inserting them again.
- [ ] Changing the timeframe does not call `GET /api/portfolio`, does not unmount the dashboard, and the chart always ends showing the last-selected range (hook test).
- [ ] A stale product-search response never replaces the results of the current query (hook test).
- [ ] The Add form's default and `max` date equal `maxPurchaseDateKey()`; server validation is still UTC-only.
- [ ] Portfolio history dates are contiguous UTC days, `days + 1` points, including across a DST change under `TZ=America/Toronto`.
- [ ] `usePortfolioData.ts` and `useProductSearch.ts` have 0 lint errors; the repo's total lint error count dropped by 4.
- [ ] The two ESLint probes in Verification report their errors.
- [ ] `pnpm exec tsc --noEmit`, `pnpm test --ci` and `pnpm build:stub` pass.
- [ ] Owner smoke test steps 1 to 7 pass on a real account.

## Rollback

Revert the PR's commit (`git revert <sha>`) and redeploy. No migration or configuration is involved. Reverting restores the pre-PR state, in which `/portfolio` fails for every signed-in user, so only revert if the new routes cause something worse (for example a 500 on every `GET /api/portfolio`). Rows written through the new routes are ordinary `portfolio_holdings` rows with a `client_idempotency_key` set, which the old code and the schema already allow, so no data cleanup is needed.

## Commit and PR

Commit message:

```text
fix(portfolio): move portfolio data behind cookie-backed routes

The browser Supabase client has no session since session cookies became
HttpOnly (fec21dc), so every portfolio read and write ran as anon and RLS
rejected it: /portfolio showed "Failed to load portfolio" to every
signed-in user.

- Add GET /api/portfolio (portfolio + freshness-guarded holdings in one
  response), POST /api/portfolio/holdings, PATCH/DELETE
  /api/portfolio/holdings/[id] and POST /api/portfolio/import, built on
  createRouteSupabaseClient with the CSRF and body-size gates (F001 part 2,
  F144).
- Caller-owned idempotency keys: one per distinct Add submission and one
  per parsed import row; a duplicate is reported as success (F033).
- usePortfolioData: separate history load keyed on portfolio, timeframe
  and holdings with abort; the dashboard no longer unmounts on refresh or
  timeframe change (F053).
- useProductSearch ignores stale responses (F110).
- Purchase dates default to the earlier of local and UTC today; server
  validation stays UTC (F060). History series steps in UTC days (F111).
- ESLint: user tables may only be queried from app/api and app/lib/server.
```

PR title: `fix(portfolio): restore signed-in portfolio via route handlers (WP05)`

PR body summary: what was broken (anon client on user tables, the waterfall, the idempotency no-op, the races, the date defaults), the four new routes with their gates and status codes, the modules split (`portfolio.ts` reference reads, `portfolioApi.ts` client, `portfolioInput.ts` parsing, `priceFreshness.ts` shared rule, `lib/server/portfolioRepo.ts` user tables), the ESLint guards, the lint-error delta, the Verification output, the Owner actions checklist, and out-of-scope notes: history still reads `product_price_history` on the anonymous client until WP10; `window.confirm` / `alert` and modal accessibility are WP14; the remaining lint errors in `HoldingsTable.tsx` are WP17.
