# WP06: Restore signed-in features, part 3: box recipes and sharing

- **Findings covered**:
  - F001 (partial, cluster members F001, F018): the browser Supabase client never has a session (the session cookie is HttpOnly), so every `box_recipes` query in `useBoxRecipes.ts` runs as `anon` and RLS plus migration 0013 reject it. **In scope here (part 3):** all `box_recipes` reads and writes move to cookie-backed route handlers under `app/api/box-recipes/`. Part 1 (profile) is WP04, part 2 (portfolio) is WP05.
  - F055 (full, severity low): the calculator never sets `isPublic`, so every save writes `share_code = null, is_public = false` and a freshly saved recipe can never show "Share Link", although the page advertises "Save and share". The residual symptom: legacy rows auto-shared before migration 0005 still carry a non-null `share_code` with `is_public = false`, so opening one from the saved list shows a Share Link whose URL loads nothing for the recipient. (The "re-saving silently un-shares a public recipe" half is unreachable in practice: no app path can set `is_public = true`, and 0005's `DEFAULT false` already killed the legacy links. Step 1 section 2 purges those dead codes; the UI only shows copy controls when a code exists, which after the migration means the recipe is public.)
  - F059 (full, severity low): the saved-recipes list converts a retail price that is already in the display currency (C$150 shows as C$204.00), and recipes are stored without a currency.
  - F149 (full, severity low): recipes are fetched twice on mount (`loadMyRecipes` changes identity when the set list arrives) and again on every window focus (`AuthContext.tsx:88` replaces the `user` object on each `refreshSession`), with no guard against an older response overwriting a newer one. Keying the fetch on the user id with a cancel flag (step 8) fixes all three. The explicit column list is kept for clarity only: it is not a performance fix (the old `select("*")` read the same columns). The new `limit(100)` must not hide recipes silently, so step 9k shows a notice when the list is full.
  - F116 (full, severity info, code hygiene): "Copied!" shows before (and even if) the clipboard write fails; the shared-recipe effect has no cancel flag and stale dependencies.
  - F117 (full, severity low, latent until a set with a NULL `release_date` has a booster pack product): the set picker sorts with `new Date("")`, a NaN comparator, for sets with no release date. The order then changes between page loads (it follows the RPC's row order), not between renders.
  - F131 (full, severity info today, low once this package ships a working share control): share codes are chosen by the client with no database format check, and `get_shared_recipe` returns the owner's `auth.users` UUID to anonymous callers.
- **Priority rationale**: the Box Calculator's save, list and share features have been dead for every signed-in user since 2026-05-27 (F001, critical). The ride-along findings are low or info on their own. F131 is latent today because no recipe can be public, but this package makes sharing possible, so the server-owned share code and the trimmed RPC must ship in the same PR (migration applied first).
- **Effort**: L (about 10 hours: one migration, three route handlers, a hook rewrite, component edits, six test files).
- **Depends on**: WP04 (`sessionStatus` in `AuthContext`, `app/lib/authSession.ts`, the `ANON_CLIENT_FORBIDDEN_FILES` ESLint guard). WP00 for `pnpm build:stub`. WP01 claims migration numbers 0024 and 0025; WP10 claims 0027 to 0029 and WP16 claims 0030, so this package's migration is **0026**. WP05 runs before this package in plan order and, as specified, creates `rejectIfNotAppRequest` in `app/lib/csrf.ts` (WP05 step 6a), `app/lib/routeAuth.ts` with `requireRouteUser`, `jsonNoStore` and `NO_STORE` (WP05 step 6b, byte-identical to step 3b below), the `no-restricted-syntax` ESLint block (WP05 step 18c) and the relative-path `^\.{1,2}/supabase$` import pattern (WP05 step 18b). The default path is therefore: skip steps 3a, 3b and 4, and use the first variant of step 11b. Steps 3a, 3b, 4 and the second variant of 11b are fallbacks for a tree where those files are missing.
- **Also closes (handed over by WP04)**: the F058 note that `useBoxRecipes` / `BoxCalculator` must key their recipe loading on `user?.id`, not on the `user` object (WP04 "Pitfalls" and PR body). Step 8 keys the fetch on the user id and step 9d deletes the `[user, loadMyRecipes]` effect.
- **Unblocks**: WP11 (server-fed tools, F143/F068 touch `/box-calculator`), WP12 (bundle work on the calculator), WP17 (lint to zero, blocking CI), WP20 (currency context, CSRF helper dedupe), WP21 (least-privilege and schema baseline; it must include the new column, constraints and trigger).
- **Suggested branch name**: `remediation/wp06-box-recipes-api`
- **Risk level**: medium. It adds a migration that changes the `get_shared_recipe` return shape and adds a trigger, and the migration must be applied before the code deploys; the code path it replaces is fully broken in production today, so there is no working behaviour to regress.

## Why

Since commit `fec21dc` the session lives only in HttpOnly cookies, but `frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts` still reads and writes `box_recipes` through the anonymous browser client (`useBoxRecipes.ts:4`, `:64-68`, `:109-123`, `:144-156`, `:184-188`), so PostgREST answers 401 / 42501: signed-in users never see their saved recipes, and Save shows "Error". Even before that broke, sharing never worked: the UI never sets `isPublic` (`BoxCalculator.tsx:207-214`), so a newly saved recipe never gets a share code and the Share Link button (`:318-325`) never renders for it; the only recipes that show the button are legacy rows auto-shared before migration 0005, whose `is_public` is false, so their link opens an empty calculator for the recipient. The share code itself is generated in JavaScript and accepted by the database in any format, and the public lookup RPC hands the owner's account UUID to anyone holding a link. Smaller defects ride along: the saved list shows CAD prices multiplied by the exchange rate a second time, recipes do not record which currency their prices were typed in, recipes are fetched twice per visit, "Copied!" appears even when copying failed, and the set picker's sort is undefined for sets without a release date. After this PR, saved recipes load once through `GET /api/box-recipes`, Save and Delete work through CSRF-gated route handlers, a saved recipe gets an explicit "Make shareable" / "Stop sharing" control whose code the database mints, re-saving never changes sharing, each recipe remembers its currency, and the public RPC returns only what the calculator renders.

## Before you start

Read these files fully (line numbers are from HEAD `a188fea`; adapt if earlier packages moved them):

- `frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts` (240 lines). `:4` browser-client import; `:8-14` client `generateShareCode`; `:20-53` `fromDbPacks` (kept verbatim); `:60-94` `loadMyRecipes` with `select("*")` and deps `[user, setNameMap]`; `:96-178` `saveRecipe` (always writes `share_code` / `is_public`); `:180-198` `deleteRecipe`; `:200-230` `loadSharedRecipe` (RPC, maps `row.user_id`).
- `frontend/app/components/BoxCalculator/BoxCalculator.tsx` (747 lines). `:73-97` hooks; `:99-114` state; `:116-119` load effect; `:121-129` shared-recipe effect (missing deps, no cancel flag); `:131-138` `loadRecipeIntoState`; `:180-226` `handleSave`; `:228-234` `handleCopyShareLink`; `:236-248` new/delete; `:275-278` `currencySymbol` and `fmtPrice`; `:300-332` action buttons; `:335-381` saved list (`formatPrice(r.retailPrice)` at `:361`); `:741` "Save and share your recipes" copy.
- `frontend/app/components/BoxCalculator/types.ts` (55 lines), `frontend/app/components/BoxCalculator/hooks/useBoosterBoxPrices.ts` (99 lines, sort at `:56-61`), `frontend/app/components/BoxCalculator/__tests__/useBoosterBoxPrices.test.tsx`.
- `frontend/app/components/ProductPrices/hooks/useCurrencyConversion.ts:13-14` (display currency defaults to `"CAD"`; `setSelectedCurrency` is a plain `useState` setter, so it is stable) and `:64-70` (`formatPrice` treats its input as USD and converts).
- `frontend/app/lib/csrf.ts`, `frontend/app/lib/routeSupabase.ts`, `frontend/app/lib/logger.ts`, `frontend/app/lib/validation.ts`, `frontend/app/api/account/export/route.ts`, `frontend/app/api/profile/route.ts` (WP04), `frontend/app/api/portfolio/route.ts` and `frontend/app/lib/routeAuth.ts` (WP05): the route-handler pattern.
- `frontend/eslint.config.mjs` (after WP04 and WP05: `ANON_CLIENT_FORBIDDEN_FILES`, the `no-restricted-imports` block and WP05's `no-restricted-syntax` block).
- `migrations/create_box_recipes.sql`, `migrations/0005_box_recipes_share_code_hardening.sql` (the RPC at `:21-36`), `migrations/0008_box_recipes_rls_hardening.sql:58-133`, `migrations/0013_revoke_anon_on_user_tables.sql:21`, `migrations/0014_rls_perf_and_dedupe.sql:89-104` (current owner-only policies), `migrations/0023_price_freshness_guard.sql:50-60` (why a dropped and recreated function must restate its grants), `migrations/0006_function_execute_grants_hardening.sql` (trigger helpers are not RPC-callable).
- `verify_migration.py:1-100` (docstring) and `:1491-1505` (`UNVERIFIABLE`). It is a generic parser that hard-codes nothing about `box_recipes` or `get_shared_recipe`, and it refuses column-level grants (`:1262-1270`). **It needs no change in this package.**

Confirm the starting state (run from `frontend/` unless noted):

```bash
# 1. The hook still uses the anonymous browser client (F001).
grep -n 'lib/supabase"' app/components/BoxCalculator/hooks/useBoxRecipes.ts
# expect: 4:import { supabase } from "../../../lib/supabase";

# 2. The UI never sets isPublic (F055).
grep -n "isPublic" app/components/BoxCalculator/BoxCalculator.tsx
# expect: no output

# 3. Saved list converts an already-display-currency price (F059).
grep -n "formatPrice(r.retailPrice)" app/components/BoxCalculator/BoxCalculator.tsx
# expect: one hit around :361

# 4. select("*") and the setNameMap dependency (F149).
grep -n 'select("\*")\|\[user, setNameMap\]' app/components/BoxCalculator/hooks/useBoxRecipes.ts
# expect: :66 and :94

# 5. Clipboard promise ignored (F116) and NaN sort (F117).
grep -n "navigator.clipboard.writeText(url);" app/components/BoxCalculator/BoxCalculator.tsx
grep -n "new Date(b.releaseDate)" app/components/BoxCalculator/hooks/useBoosterBoxPrices.ts
# expect: one hit each (:231 and :59)

# 6. The RPC returns the whole row, including user_id (F131).
grep -n "RETURNS SETOF public.box_recipes" ../migrations/0005_box_recipes_share_code_hardening.sql
# expect: 22:RETURNS SETOF public.box_recipes

# 7. Migration number. 0026 is reserved for this package (WP10 already
# numbers its files 0027-0029 assuming it).
ls ../migrations | grep '^002[4-9]'
# expect: 0024_export_my_data_volatile.sql and 0025_portfolio_fk_indexes.sql
# (WP01), and no 0026_ file. This spec writes 0026 everywhere. 0026 is a
# fixed reservation (WP10 0027-0029, WP16 0030, WP21 0031-0032): use it even
# if WP10's or WP16's files are already present. Only if a 0026_ file that is
# not this package's already exists: stop and ask the owner for the number
# (do not take "the next free" one, it may be reserved), replace 0026 in the
# comments of steps 1, 2 and 6, and say in the PR body which number you used.

# 8. What WP04 and WP05 left behind. Record the answers; steps branch on them.
grep -n "sessionStatus" app/context/AuthContext.tsx | head -3
ls app/lib/authSession.ts
grep -n "ANON_CLIENT_FORBIDDEN_FILES\|no-restricted-syntax" eslint.config.mjs
grep -n "export function rejectIfNotAppRequest" app/lib/csrf.ts
grep -rn "requireRouteUser\|export function jsonNoStore" app/lib | grep -v __tests__

# 9. Baseline lint for the files this package touches.
pnpm exec eslint app/components/BoxCalculator
# expect: 0 errors, 2 warnings (recipesLoading unused at BoxCalculator.tsx:92,
# react-hooks/exhaustive-deps at :129). Both are gone after this PR.

# 10. Baseline tests pass.
pnpm test --ci app/components/BoxCalculator
```

Assumptions to check, and what to do if they are wrong:

- **`sessionStatus` (WP04).** Expected on `useAuth()` as `"unknown" | "anonymous" | "authenticated"`. If check 8 finds nothing, WP04 has not landed: stop, because this package also relies on WP04's ESLint guard and route helpers. (If you are told to proceed anyway, replace the `userId` line in step 8 with `const userId = user?.id ?? null;` and drop `sessionStatus` from the test mocks.)
- **`app/lib/authSession.ts` (WP04 step 2).** Must export `isAuthoritativeSignedOut`. If the file is missing, create it exactly as in step 3a.
- **`rejectIfNotAppRequest` (WP05 step 6a).** Expected to exist. If `app/lib/csrf.ts` exports it (or an equivalent header-only check under another name), use it and skip step 4. Only if it is missing, add it in step 4.
- **`app/lib/routeAuth.ts` (WP05 step 6b).** Expected to exist, exporting `requireRouteUser`, `jsonNoStore` and `NO_STORE`; check 8's last grep prints them. Then skip step 3b and import from `app/lib/routeAuth.ts` exactly as step 5 does. If WP05 put an equivalent helper under a different file or name, import that instead in steps 5a, 5b and 5c. Only if no such helper exists, create it in step 3b.
- **`get_shared_recipe` callers.** Only `useBoxRecipes.ts:206` calls it: `grep -rn 'rpc("get_shared_recipe"' app --include=*.ts --include=*.tsx` must print that line only. (A plain `grep get_shared_recipe` also prints the comment at `:202`.) If anything else calls it, it must stop reading `id`, `user_id`, `share_code`, `is_public`, `created_at` and `updated_at`, which the new RPC no longer returns.
- **Legacy share data.** The migration regenerates any public row's share code that is not 32 lowercase hex characters, which breaks that one link. Before this PR, the UI could never make a recipe public, so the expected count is 0; the owner checks it (Owner actions, step 1).

## Implementation steps

Order: step 1 (migration file) can be written first or last, but the owner must apply it before this code is deployed (see Owner actions). Steps 2 to 6 create new modules; steps 7 to 10 edit existing files and depend on them; step 11 (ESLint) goes last so lint does not fail mid-way.

### Step 1. `migrations/0026_box_recipes_sharing_and_currency.sql` (new)

Decisions baked into this file, each checked against the code:

- **Share codes come from a trigger, not from the route.** A route-only generator would still let any signed-in user `PATCH` `share_code` directly through PostgREST with their JWT; a `BEFORE INSERT OR UPDATE` trigger makes the database the only author, whatever the client sends. This makes column-level grants unnecessary (and `verify_migration.py` refuses column-level grants anyway).
- **Codes use `md5(gen_random_uuid()::text || gen_random_uuid()::text)`**: 244 bits from the server CSPRNG folded to 32 hex chars. `gen_random_uuid()` is core PostgreSQL 13+; `gen_random_bytes` needs `pgcrypto`, whose schema differs between Supabase (`extensions`) and a plain replay.
- **Legacy currency is `'CAD'`, the column default is `'USD'`.** The plan said "default USD". The code shows the calculator's display currency has defaulted to CAD since the first commit (`useCurrencyConversion.ts:13`, present in `bb76e2d`), so any existing recipe's prices were most likely typed in CAD; backfilling them as USD would reinterpret them. The first statement backfills existing rows with `'CAD'`; the second sets `'USD'` as the default for any future writer that omits the column (the app always sends it).
- **The RPC returns five columns** (`name, retail_price, promo_value, packs, currency`). The plan required dropping `user_id`; `id`, `share_code`, `is_public` and the timestamps are dropped too because no caller needs them, and returning `id` made a signed-in visitor's "Save" try to update the owner's row (it now becomes an unsaved copy, step 8).

Create the file with exactly this content (it was applied twice on a scratch PostgreSQL 16 with a Supabase-shaped scaffold while this spec was written; see "Migration replay" under Verification for the checks it passed):

```sql
-- Migration: box recipe sharing is decided by the database, recipes remember
-- their currency, and the public share lookup stops leaking the owner id.
--
-- Review findings (audits/2026-09-25-security-performance-ux-review.md):
--   F131  share codes were chosen by the client with no format check, so any
--         signed-in user could publish under a 1-character code, and
--         get_shared_recipe returned the whole row, including the owner's
--         auth.users UUID, to anonymous callers.
--   F055  the UI never set is_public, so sharing never worked, and legacy
--         pre-0005 rows kept a share_code that no longer resolves. With the
--         trigger below the client can only flip is_public; the code itself
--         is server-owned.
--   F059  recipes stored retail/promo prices with no currency.
--
-- What this does (idempotent; safe to re-run):
--   1. box_recipes.currency ('USD' | 'CAD'). Existing rows are backfilled to
--      'CAD' because the calculator's currency selector has defaulted to CAD
--      since the first commit (useCurrencyConversion.ts initialCurrency), so
--      that is what an existing recipe's prices were typed in. New rows get
--      'USD' if a writer ever omits the column; the app always sends it.
--   2. Normalises existing share data so the constraints can be added:
--      private rows lose any leftover code (pre-0005 rows were auto-shared);
--      public rows without a well-formed code get a fresh one.
--   3. CHECK constraints: 32 lowercase hex chars; a code exists exactly when
--      the recipe is public; currency is USD or CAD.
--   4. BEFORE INSERT OR UPDATE trigger: whatever the client sends for
--      share_code is ignored. is_public = true keeps the current code or mints
--      a new 128-bit one; is_public = false clears it (the old link dies, and
--      sharing again mints a new code).
--   5. get_shared_recipe returns only the fields the calculator renders:
--      no id, no user_id, no share_code, no timestamps. The return type
--      changes, so the function is dropped and recreated; the search_path pin
--      and the EXECUTE grants are re-applied by hand (see 0023's header for
--      why a recreated function must have its grants restated).
--
-- Share codes are md5 over two gen_random_uuid() values: 244 bits from the
-- server CSPRNG, folded to 128 bits of output. md5 is used only as a
-- fixed-width mixer here, not for collision resistance. gen_random_uuid() is
-- core PostgreSQL (13+), so this needs no pgcrypto and no extensions schema.
--
-- verify_migration.py checks the two functions and their grants; the column,
-- constraints, trigger, UPDATEs and DO blocks are listed as NOT VERIFIED
-- (exit code 3). Check those with:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.box_recipes'::regclass
--      AND conname IN ('box_recipes_share_code_format',
--                      'box_recipes_share_code_iff_public',
--                      'box_recipes_currency_valid');           -- expect 3 rows
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'public.box_recipes'::regclass
--      AND tgname = 'box_recipes_share_code_trg';               -- expect 1 row, 'O'
--   SELECT column_default, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'box_recipes'
--      AND column_name = 'currency';                           -- expect 'USD'::text, NO

-- ============================================================
-- 1. currency column
-- ============================================================

ALTER TABLE public.box_recipes
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CAD';

ALTER TABLE public.box_recipes
  ALTER COLUMN currency SET DEFAULT 'USD';

-- ============================================================
-- 2. Normalise existing share data
-- ============================================================

UPDATE public.box_recipes
   SET share_code = NULL
 WHERE NOT is_public
   AND share_code IS NOT NULL;

UPDATE public.box_recipes
   SET share_code = md5(gen_random_uuid()::text || gen_random_uuid()::text)
 WHERE is_public
   AND (share_code IS NULL OR share_code !~ '^[0-9a-f]{32}$');

-- ============================================================
-- 3. Constraints
-- ============================================================

DO $$ BEGIN
  ALTER TABLE public.box_recipes
    ADD CONSTRAINT box_recipes_share_code_format
    CHECK (share_code IS NULL OR share_code ~ '^[0-9a-f]{32}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.box_recipes
    ADD CONSTRAINT box_recipes_share_code_iff_public
    CHECK (is_public = (share_code IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.box_recipes
    ADD CONSTRAINT box_recipes_currency_valid
    CHECK (currency IN ('USD', 'CAD'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 4. Server-owned share codes
-- ============================================================

CREATE OR REPLACE FUNCTION public.box_recipes_share_code_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_public THEN
    IF TG_OP = 'UPDATE'
       AND OLD.share_code IS NOT NULL
       AND OLD.share_code ~ '^[0-9a-f]{32}$' THEN
      NEW.share_code := OLD.share_code;
    ELSE
      NEW.share_code := md5(gen_random_uuid()::text || gen_random_uuid()::text);
    END IF;
  ELSE
    NEW.share_code := NULL;
  END IF;
  RETURN NEW;
END
$$;

-- Trigger-only helper: not callable over PostgREST (same rule as 0006/0012).
REVOKE ALL ON FUNCTION public.box_recipes_share_code_guard() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS box_recipes_share_code_trg ON public.box_recipes;
CREATE TRIGGER box_recipes_share_code_trg
  BEFORE INSERT OR UPDATE ON public.box_recipes
  FOR EACH ROW
  EXECUTE FUNCTION public.box_recipes_share_code_guard();

-- ============================================================
-- 5. get_shared_recipe without the owner id
-- ============================================================

DROP FUNCTION IF EXISTS public.get_shared_recipe(text);

CREATE FUNCTION public.get_shared_recipe(p_share_code text)
RETURNS TABLE (
  name text,
  retail_price double precision,
  promo_value double precision,
  packs jsonb,
  currency text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.name, r.retail_price, r.promo_value, r.packs, r.currency
    FROM public.box_recipes r
   WHERE r.share_code = p_share_code
     AND r.is_public = true
   LIMIT 1;
$$;

REVOKE ALL    ON FUNCTION public.get_shared_recipe(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_shared_recipe(text) TO anon, authenticated, service_role;
```

The SQL never names its own file. If the owner assigned another number (Before you start, check 7), update the two comment references to `0026` in steps 2 and 6.

### Step 2. `frontend/app/lib/boxRecipes.ts` (new): shapes and validation shared by routes and hook

No Supabase client and no `server-only` import, so both the routes and the browser hook can use it. If your migration number is not 0026, fix the file name in the header comment.

```ts
/**
 * Box recipe shapes and write validation, shared by the /api/box-recipes
 * route handlers (server) and useBoxRecipes (client). Keep this module free
 * of Supabase clients and server-only imports so both sides can load it.
 *
 * The bounds mirror the CHECK constraints in migrations 0008 and
 * 0026_box_recipes_sharing_and_currency.sql; the database stays the authority.
 */
import {
  PRICE_MAX,
  QUANTITY_MAX,
  RECIPE_NAME_MAX_LEN,
  RECIPE_PACKS_MAX,
  isFiniteInRange,
} from "./validation";

export type RecipeCurrency = "USD" | "CAD";
export const RECIPE_CURRENCIES: readonly RecipeCurrency[] = ["USD", "CAD"];

/** Every column the calculator reads, and nothing else (review F149). */
export const BOX_RECIPE_COLUMNS =
  "id, name, retail_price, promo_value, packs, currency, share_code, is_public, created_at, updated_at";

/** Upper bound on one user's recipe list; the UI shows a short scroll list. */
export const BOX_RECIPES_LIST_LIMIT = 100;

/** Mirrors CHECK box_recipes_share_code_format (review F131). */
export const SHARE_CODE_RE = /^[0-9a-f]{32}$/;

export interface DbPack {
  set_id: number;
  quantity: number;
}

/** One row as GET/POST/PATCH /api/box-recipes return it. */
export interface BoxRecipeRow {
  id: number;
  name: string;
  retail_price: number;
  promo_value: number;
  packs: unknown;
  currency: RecipeCurrency;
  share_code: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

/** What the get_shared_recipe RPC returns: no id, no owner, no share code. */
export interface SharedRecipeRow {
  name: string;
  retail_price: number;
  promo_value: number;
  packs: unknown;
  currency: RecipeCurrency;
}

/** JSON body accepted by POST /api/box-recipes and PATCH /api/box-recipes/[id]. */
export interface RecipeWriteBody {
  name?: string;
  retailPrice?: number;
  promoValue?: number;
  packs?: { setId: number; quantity: number }[];
  currency?: RecipeCurrency;
  isPublic?: boolean;
}

/**
 * Column values a route may write. share_code, user_id, id and the
 * timestamps are deliberately absent: the trigger owns share_code and the
 * route sets user_id / updated_at itself.
 */
export interface RecipeDbWrite {
  name?: string;
  retail_price?: number;
  promo_value?: number;
  packs?: DbPack[];
  currency?: RecipeCurrency;
  is_public?: boolean;
}

export type RecipeWriteResult =
  | { ok: true; value: RecipeDbWrite }
  | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parsePacks(raw: unknown): DbPack[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > RECIPE_PACKS_MAX) {
    return null;
  }
  const out: DbPack[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) return null;
    const { setId, quantity } = item;
    if (typeof setId !== "number" || !Number.isInteger(setId) || setId <= 0) {
      return null;
    }
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > QUANTITY_MAX
    ) {
      return null;
    }
    out.push({ set_id: setId, quantity });
  }
  return out;
}

/**
 * Validate a recipe write body.
 * - "create": name, retailPrice, promoValue, packs and currency are required;
 *   isPublic defaults to false.
 * - "update": any non-empty subset. A field that is absent is not written, so
 *   saving the form (which never sends isPublic) cannot un-share a recipe
 *   (review F055).
 * Unknown keys are ignored, never forwarded.
 */
export function parseRecipeWrite(
  body: unknown,
  mode: "create" | "update"
): RecipeWriteResult {
  if (!isPlainObject(body)) return { ok: false, error: "Invalid body" };
  const value: RecipeDbWrite = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string") return { ok: false, error: "Invalid name" };
    const name = body.name.trim();
    // Code points, like Postgres char_length(), not UTF-16 units.
    const length = Array.from(name).length;
    if (length < 1 || length > RECIPE_NAME_MAX_LEN) {
      return {
        ok: false,
        error: `Recipe name must be 1-${RECIPE_NAME_MAX_LEN} characters`,
      };
    }
    value.name = name;
  }

  if (body.retailPrice !== undefined) {
    if (!isFiniteInRange(body.retailPrice, 0, PRICE_MAX)) {
      return { ok: false, error: "Invalid retail price" };
    }
    value.retail_price = body.retailPrice;
  }

  if (body.promoValue !== undefined) {
    if (!isFiniteInRange(body.promoValue, 0, PRICE_MAX)) {
      return { ok: false, error: "Invalid promo value" };
    }
    value.promo_value = body.promoValue;
  }

  if (body.packs !== undefined) {
    const packs = parsePacks(body.packs);
    if (!packs) {
      return {
        ok: false,
        error: `Recipe must have 1-${RECIPE_PACKS_MAX} valid pack types`,
      };
    }
    value.packs = packs;
  }

  if (body.currency !== undefined) {
    if (!RECIPE_CURRENCIES.includes(body.currency as RecipeCurrency)) {
      return { ok: false, error: "Invalid currency" };
    }
    value.currency = body.currency as RecipeCurrency;
  }

  if (body.isPublic !== undefined) {
    if (typeof body.isPublic !== "boolean") {
      return { ok: false, error: "Invalid visibility" };
    }
    value.is_public = body.isPublic;
  }

  if (mode === "create") {
    if (
      value.name === undefined ||
      value.retail_price === undefined ||
      value.promo_value === undefined ||
      value.packs === undefined ||
      value.currency === undefined
    ) {
      return { ok: false, error: "Missing recipe fields" };
    }
    if (value.is_public === undefined) value.is_public = false;
  } else if (Object.keys(value).length === 0) {
    return { ok: false, error: "Nothing to update" };
  }

  return { ok: true, value };
}

/** The [id] route segment as a positive safe integer, or null. */
export function parseRecipeId(raw: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}
```

Notes: `isFiniteInRange` is a type guard, so `body.retailPrice` is a `number` after the check. `Array.from(name).length` counts code points, which is what Postgres `char_length()` in `box_recipes_name_len` counts; `name.length` would reject a 200-emoji name the database accepts.

### Step 3. Route auth helpers

3a. **Only if** `frontend/app/lib/authSession.ts` does not exist (WP04 step 2), create it:

```ts
import { isAuthApiError, isAuthSessionMissingError } from "@supabase/supabase-js";

/**
 * True when a failed supabase.auth.getUser() really means "no valid session"
 * (no cookie, or GoTrue rejected the token with a 4xx other than 429).
 * False for network failures, 5xx and 429: those say nothing about the session
 * and must never sign the user out.
 */
export function isAuthoritativeSignedOut(error: unknown): boolean {
  if (!error) return true;
  if (isAuthSessionMissingError(error)) return true;
  if (isAuthApiError(error)) {
    const status = error.status ?? 0;
    return status >= 400 && status < 500 && status !== 429;
  }
  return false;
}
```

3b. Create `frontend/app/lib/routeAuth.ts` (skip if an equivalent helper exists, see "Before you start"):

```ts
import "server-only";

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { createRouteSupabaseClient } from "./routeSupabase";
import { isAuthoritativeSignedOut } from "./authSession";

type RouteSupabaseClient = Awaited<ReturnType<typeof createRouteSupabaseClient>>;

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const UNAVAILABLE = "Service temporarily unavailable. Please try again.";

/**
 * Resolve the caller from the HttpOnly session cookie.
 * Returns the user, or a response to send as-is: 401 when the session is
 * authoritatively missing or rejected, 503 when GoTrue could not answer
 * (network, 5xx, 429). A 503 must never be read as "signed out" (review F063).
 */
export async function requireRouteUser(
  supabase: RouteSupabaseClient
): Promise<{ user: User; response: null } | { user: null; response: NextResponse }> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (data.user) return { user: data.user, response: null };
    if (isAuthoritativeSignedOut(error)) {
      return { user: null, response: jsonNoStore({ error: "Unauthorized" }, 401) };
    }
    return { user: null, response: jsonNoStore({ error: UNAVAILABLE }, 503) };
  } catch {
    return { user: null, response: jsonNoStore({ error: UNAVAILABLE }, 503) };
  }
}
```

### Step 4. `frontend/app/lib/csrf.ts`: header-only gate for private GETs (skip if WP05 added it)

Append:

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

### Step 5. Route handlers under `frontend/app/api/box-recipes/`

5a. `frontend/app/api/box-recipes/recipeErrors.ts` (new). The helper lives here, not in a `route.ts`, because Next's build rejects any export from a route file other than HTTP handlers and route config.

```ts
import "server-only";

import { logSupabaseError } from "../../lib/logger";
import { jsonNoStore } from "../../lib/routeAuth";

/**
 * Map a failed box_recipes INSERT/UPDATE to a fixed client message.
 * Never echo PostgREST's message: it can name tables and constraints.
 * 23514 is a CHECK violation (bounds in migrations 0008 and 0026), which
 * parseRecipeWrite should already have caught, so it is still a 400.
 */
export function recipeWriteFailed(
  label: string,
  error: { code?: string; message?: string; name?: string }
) {
  if (error.code === "23514") {
    return jsonNoStore({ error: "Invalid recipe" }, 400);
  }
  logSupabaseError(label, error);
  return jsonNoStore({ error: "Could not save recipe. Please try again." }, 500);
}
```

5b. `frontend/app/api/box-recipes/route.ts` (new): `GET` lists, `POST` creates.

```ts
import { NextRequest } from "next/server";
import { createRouteSupabaseClient } from "../../lib/routeSupabase";
import {
  rejectIfBodyTooLarge,
  rejectIfCsrfFails,
  rejectIfNotAppRequest,
} from "../../lib/csrf";
import { logSupabaseError } from "../../lib/logger";
import { jsonNoStore, requireRouteUser } from "../../lib/routeAuth";
import {
  BOX_RECIPE_COLUMNS,
  BOX_RECIPES_LIST_LIMIT,
  parseRecipeWrite,
} from "../../lib/boxRecipes";
import { recipeWriteFailed } from "./recipeErrors";

/** 50 packs plus a 200-character name is ~4 KB of JSON. */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * The caller's saved box recipes, newest first, read with the cookie
 * session. Replaces the browser-side supabase.from("box_recipes") query,
 * which ran as anon and was always rejected by RLS (review F001).
 *
 * GET uses the header-only gate: browsers omit Origin on same-origin GETs,
 * so rejectIfCsrfFails would refuse every legitimate load.
 */
export async function GET(req: NextRequest) {
  const forbidden = rejectIfNotAppRequest(req);
  if (forbidden) return forbidden;

  const supabase = await createRouteSupabaseClient();
  const auth = await requireRouteUser(supabase);
  if (auth.response) return auth.response;

  const { data, error } = await supabase
    .from("box_recipes")
    .select(BOX_RECIPE_COLUMNS)
    .eq("user_id", auth.user.id)
    .order("updated_at", { ascending: false })
    .limit(BOX_RECIPES_LIST_LIMIT);

  if (error) {
    logSupabaseError("recipes_list_failed", error);
    return jsonNoStore({ error: "Could not load recipes." }, 500);
  }
  return jsonNoStore({ recipes: data ?? [] });
}

/** Create a recipe. share_code is minted by the database trigger, never here. */
export async function POST(req: NextRequest) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, MAX_BODY_BYTES);
  if (tooLarge) return tooLarge;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonNoStore({ error: "Invalid body" }, 400);
  }
  const parsed = parseRecipeWrite(body, "create");
  if (!parsed.ok) return jsonNoStore({ error: parsed.error }, 400);

  const supabase = await createRouteSupabaseClient();
  const auth = await requireRouteUser(supabase);
  if (auth.response) return auth.response;

  const { data, error } = await supabase
    .from("box_recipes")
    .insert({ ...parsed.value, user_id: auth.user.id })
    .select(BOX_RECIPE_COLUMNS)
    .single();

  if (error) return recipeWriteFailed("recipe_insert_failed", error);
  return jsonNoStore({ recipe: data }, 201);
}
```

5c. `frontend/app/api/box-recipes/[id]/route.ts` (new): `PATCH` partial update, `DELETE`. In Next 16 `params` is a Promise; the context type below matches what the build's route type check expects.

```ts
import { NextRequest } from "next/server";
import { createRouteSupabaseClient } from "../../../lib/routeSupabase";
import { rejectIfBodyTooLarge, rejectIfCsrfFails } from "../../../lib/csrf";
import { logSupabaseError } from "../../../lib/logger";
import { jsonNoStore, requireRouteUser } from "../../../lib/routeAuth";
import {
  BOX_RECIPE_COLUMNS,
  parseRecipeId,
  parseRecipeWrite,
} from "../../../lib/boxRecipes";
import { recipeWriteFailed } from "../recipeErrors";

type RouteContext = { params: Promise<{ id: string }> };

const MAX_BODY_BYTES = 16 * 1024;
const NOT_FOUND = { error: "Recipe not found" };

/**
 * Partial update. Only the fields present in the body are written, so the
 * calculator's Save (which never sends isPublic) cannot un-share a recipe,
 * and "Make shareable" sends { isPublic } alone (review F055).
 */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, MAX_BODY_BYTES);
  if (tooLarge) return tooLarge;

  const id = parseRecipeId((await params).id);
  if (id === null) return jsonNoStore(NOT_FOUND, 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonNoStore({ error: "Invalid body" }, 400);
  }
  const parsed = parseRecipeWrite(body, "update");
  if (!parsed.ok) return jsonNoStore({ error: parsed.error }, 400);

  const supabase = await createRouteSupabaseClient();
  const auth = await requireRouteUser(supabase);
  if (auth.response) return auth.response;

  const { data, error } = await supabase
    .from("box_recipes")
    .update({ ...parsed.value, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .select(BOX_RECIPE_COLUMNS)
    .maybeSingle();

  if (error) return recipeWriteFailed("recipe_update_failed", error);
  // RLS hides other users' rows, so "not yours" and "does not exist" are
  // both zero rows here, and both are a 404.
  if (!data) return jsonNoStore(NOT_FOUND, 404);
  return jsonNoStore({ recipe: data });
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, 1024);
  if (tooLarge) return tooLarge;

  const id = parseRecipeId((await params).id);
  if (id === null) return jsonNoStore(NOT_FOUND, 404);

  const supabase = await createRouteSupabaseClient();
  const auth = await requireRouteUser(supabase);
  if (auth.response) return auth.response;

  const { data, error } = await supabase
    .from("box_recipes")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .select("id");

  if (error) {
    logSupabaseError("recipe_delete_failed", error);
    return jsonNoStore({ error: "Could not delete recipe. Please try again." }, 500);
  }
  if (!data || data.length === 0) return jsonNoStore(NOT_FOUND, 404);
  return jsonNoStore({ ok: true });
}
```

All three routes fall under the proxy's `general` rate-limit class through the `/api/` prefix (`app/lib/rateLimit.ts:76`), 60 requests per minute per IP, which a person editing recipes does not approach. Do not add `export const revalidate` or any caching: the handlers read cookies and are dynamic.

### Step 6. `frontend/app/components/BoxCalculator/sharedRecipe.ts` (new): the one anon read

The shared-link RPC stays on the anonymous browser client (it is granted to `anon` on purpose so logged-out visitors can open a link). It moves out of `useBoxRecipes.ts` into its own module so that the hook can be put under the ESLint guard in step 11 while this file stays outside it. If your migration number differs, fix `0026` in the comment.

```ts
"use client";

import { supabase } from "../../lib/supabase";
import { logSupabaseError } from "../../lib/logger";
import { SHARE_CODE_RE, type SharedRecipeRow } from "../../lib/boxRecipes";

/**
 * The only box-recipe read that stays on the anonymous browser client.
 * get_shared_recipe is granted to anon on purpose (migrations 0005 and 0026)
 * so a logged-out visitor can open a share link. It returns one public row by
 * exact code and no owner id. Everything else about recipes goes through
 * /api/box-recipes (review F001).
 */
export async function fetchSharedRecipe(
  shareCode: string
): Promise<SharedRecipeRow | null> {
  // Codes are 32 lowercase hex chars (CHECK box_recipes_share_code_format);
  // anything else cannot match, so skip the round trip.
  if (!SHARE_CODE_RE.test(shareCode)) return null;

  const { data, error } = await supabase.rpc("get_shared_recipe", {
    p_share_code: shareCode,
  });
  if (error) {
    logSupabaseError("shared_recipe_fetch_failed", error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as SharedRecipeRow | undefined) ?? null;
}
```

### Step 7. `frontend/app/components/BoxCalculator/types.ts`

Add at the top of the file:

```ts
import type { Currency } from "../ProductPrices/types";

```

Replace the `BoxRecipe` interface (`:8-19`) with:

```ts
export interface BoxRecipe {
  id?: number;
  name: string;
  retailPrice: number;
  promoValue: number;
  packs: PackEntry[];
  /** The currency retailPrice and promoValue were typed in (review F059). */
  currency: Currency;
  /** Set by the database when the recipe is public; null otherwise. */
  shareCode?: string | null;
  isPublic?: boolean;
  createdAt?: string;
  updatedAt?: string;
}
```

`userId` is removed: nothing reads it (`grep -rn "userId" app/components/BoxCalculator` printed only the mapping lines at `useBoxRecipes.ts:86, :168, :224` and `types.ts:16`), and the RPC no longer returns it. `currency` is required, so TypeScript will point at every place that builds a `BoxRecipe`: `useBoxRecipes.ts` (rewritten in step 8) and `BoxCalculator.tsx:207` (step 9e).

### Step 8. `frontend/app/components/BoxCalculator/hooks/useBoxRecipes.ts` (rewrite)

Replace the whole file with the version below. What changes and why:

- No `app/lib/supabase` import (F001). CRUD goes to `/api/box-recipes` with `x-pokefin-request: 1`.
- The list is fetched in an effect keyed on the user **id** (`[userId, reloadKey]`), not on `user` or `setNameMap`, so it runs once per signed-in user (F149). Raw rows are stored, and `savedRecipes` is derived with `useMemo` over `(rows, setNameMap)`, so set names appear as soon as the set list arrives, with no refetch.
- The effect calls `setStore` only after an `await`, and signed-out and loading states are derived from `store.ownerId` instead of being set in the effect, so the `react-hooks/set-state-in-effect` rule stays clean.
- `saveRecipe` never sends `isPublic` or `shareCode` (F055). Sharing is a separate `setRecipeSharing(id, isPublic)` that sends `{ isPublic }` alone.
- `loadSharedRecipe` returns an unsaved copy (no `id`, no `shareCode`) in the recipe's own currency.
- The component-level `loadMyRecipes` effect is gone; the hook owns fetching. `reloadRecipes` retries after a failure.

`fromDbPacks` (`:20-53`) is carried over verbatim.

```ts
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { logCaughtError } from "../../../lib/logger";
import type {
  BoxRecipeRow,
  RecipeWriteBody,
  SharedRecipeRow,
} from "../../../lib/boxRecipes";
import { fetchSharedRecipe } from "../sharedRecipe";
import type { BoxRecipe, PackEntry } from "../types";

// Box recipes live behind cookie-backed route handlers. The browser Supabase
// client cannot see the HttpOnly session, so it runs as anon and RLS rejects
// it on box_recipes (review F001). eslint.config.mjs forbids importing
// app/lib/supabase in this file.
const API = "/api/box-recipes";
const READ_HEADERS = { "x-pokefin-request": "1" } as const;
const WRITE_HEADERS = {
  "Content-Type": "application/json",
  "x-pokefin-request": "1",
} as const;

// Module-level so "no rows" keeps one identity and the useMemo below holds.
const NO_ROWS: BoxRecipeRow[] = [];

function fromDbPacks(
  dbPacks: unknown,
  setNameMap: Map<number, string>
): PackEntry[] {
  // Defense-in-depth: a malformed JSONB row (or a freshly shared
  // recipe whose schema drifted) must not crash the UI. We accept
  // only entries with { set_id: positive int, quantity: 1-100000 }
  // and silently drop anything else.
  if (!Array.isArray(dbPacks)) return [];
  const out: PackEntry[] = [];
  for (const raw of dbPacks) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as { set_id?: unknown; quantity?: unknown };
    if (
      typeof p.set_id !== "number" ||
      !Number.isInteger(p.set_id) ||
      p.set_id <= 0
    ) continue;
    if (
      typeof p.quantity !== "number" ||
      !Number.isInteger(p.quantity) ||
      p.quantity < 1 ||
      p.quantity > 100_000
    ) continue;
    out.push({
      id: crypto.randomUUID(),
      setId: p.set_id,
      setName: setNameMap.get(p.set_id) || `Set #${p.set_id}`,
      quantity: p.quantity,
    });
    if (out.length >= 50) break;
  }
  return out;
}

export function rowToRecipe(
  row: BoxRecipeRow,
  setNameMap: Map<number, string>
): BoxRecipe {
  return {
    id: row.id,
    name: row.name,
    retailPrice: row.retail_price,
    promoValue: row.promo_value,
    packs: fromDbPacks(row.packs, setNameMap),
    currency: row.currency === "CAD" ? "CAD" : "USD",
    shareCode: row.share_code,
    isPublic: row.is_public,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * A shared recipe becomes an unsaved copy: no id (so "Save" creates the
 * viewer's own row instead of trying to update the owner's) and no share code.
 */
export function sharedRowToRecipe(
  row: SharedRecipeRow,
  setNameMap: Map<number, string>
): BoxRecipe {
  return {
    name: row.name,
    retailPrice: row.retail_price,
    promoValue: row.promo_value,
    packs: fromDbPacks(row.packs, setNameMap),
    currency: row.currency === "CAD" ? "CAD" : "USD",
  };
}

/** The body for POST/PATCH. Never includes isPublic: see setRecipeSharing. */
function toWriteBody(recipe: BoxRecipe): RecipeWriteBody {
  return {
    name: recipe.name,
    retailPrice: recipe.retailPrice,
    promoValue: recipe.promoValue,
    packs: recipe.packs.map((p) => ({ setId: p.setId, quantity: p.quantity })),
    currency: recipe.currency,
  };
}

async function readRecipe(res: Response): Promise<BoxRecipeRow | null> {
  if (!res.ok) {
    console.error("recipe_request_failed", { status: res.status });
    return null;
  }
  const body = (await res.json()) as { recipe?: BoxRecipeRow };
  return body.recipe ?? null;
}

interface RecipeStore {
  /** Whose rows these are; rows for any other user id are never shown. */
  ownerId: string | null;
  rows: BoxRecipeRow[];
  failed: boolean;
}

export function useBoxRecipes(setNameMap: Map<number, string>) {
  const { user, sessionStatus } = useAuth();
  const userId = sessionStatus === "authenticated" && user ? user.id : null;

  const [store, setStore] = useState<RecipeStore>({
    ownerId: null,
    rows: NO_ROWS,
    failed: false,
  });
  const [reloadKey, setReloadKey] = useState(0);

  // One GET per signed-in user id (and per explicit retry). It depends on the
  // id, not on the user object or setNameMap, so the set list arriving does
  // not trigger a second fetch (review F149).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      let loaded: BoxRecipeRow[] | null = null;
      try {
        const res = await fetch(API, { headers: READ_HEADERS, cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { recipes?: BoxRecipeRow[] };
          loaded = body.recipes ?? [];
        } else {
          console.error("recipes_load_failed", { status: res.status });
        }
      } catch (error) {
        logCaughtError("recipes_load_failed", error);
      }
      if (cancelled) return;
      const rows = loaded;
      setStore((prev) =>
        rows
          ? { ownerId: userId, rows, failed: false }
          : {
              ownerId: userId,
              rows: prev.ownerId === userId ? prev.rows : NO_ROWS,
              failed: true,
            }
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, reloadKey]);

  const ownRows =
    userId !== null && store.ownerId === userId ? store.rows : NO_ROWS;

  // Set names are applied at render time, so the list shows real names as
  // soon as the set list arrives, with no refetch and no "Set #123" flash.
  const savedRecipes = useMemo(
    () => ownRows.map((row) => rowToRecipe(row, setNameMap)),
    [ownRows, setNameMap]
  );
  const recipesLoading = userId !== null && store.ownerId !== userId;
  const recipesError =
    userId !== null && store.ownerId === userId && store.failed;

  const reloadRecipes = useCallback(() => setReloadKey((k) => k + 1), []);

  const upsertRow = useCallback(
    (row: BoxRecipeRow) => {
      setStore((prev) =>
        prev.ownerId === userId
          ? { ...prev, rows: [row, ...prev.rows.filter((r) => r.id !== row.id)] }
          : prev
      );
    },
    [userId]
  );

  const saveRecipe = useCallback(
    async (recipe: BoxRecipe): Promise<BoxRecipe | null> => {
      if (!userId) return null;
      try {
        const res = await fetch(recipe.id ? `${API}/${recipe.id}` : API, {
          method: recipe.id ? "PATCH" : "POST",
          headers: WRITE_HEADERS,
          body: JSON.stringify(toWriteBody(recipe)),
        });
        const row = await readRecipe(res);
        if (!row) return null;
        upsertRow(row);
        return rowToRecipe(row, setNameMap);
      } catch (error) {
        logCaughtError("recipe_save_failed", error);
        return null;
      }
    },
    [userId, upsertRow, setNameMap]
  );

  /**
   * Share or stop sharing a saved recipe. Sends only { isPublic }; the
   * database trigger mints or clears the share code (review F055, F131).
   */
  const setRecipeSharing = useCallback(
    async (recipeId: number, isPublic: boolean): Promise<BoxRecipe | null> => {
      if (!userId) return null;
      try {
        const res = await fetch(`${API}/${recipeId}`, {
          method: "PATCH",
          headers: WRITE_HEADERS,
          body: JSON.stringify({ isPublic } satisfies RecipeWriteBody),
        });
        const row = await readRecipe(res);
        if (!row) return null;
        upsertRow(row);
        return rowToRecipe(row, setNameMap);
      } catch (error) {
        logCaughtError("recipe_sharing_failed", error);
        return null;
      }
    },
    [userId, upsertRow, setNameMap]
  );

  const deleteRecipe = useCallback(
    async (recipeId: number): Promise<boolean> => {
      if (!userId) return false;
      try {
        const res = await fetch(`${API}/${recipeId}`, {
          method: "DELETE",
          headers: READ_HEADERS,
        });
        // 404 means it is already gone; drop it from the list either way.
        if (!res.ok && res.status !== 404) {
          console.error("recipe_delete_failed", { status: res.status });
          return false;
        }
        setStore((prev) =>
          prev.ownerId === userId
            ? { ...prev, rows: prev.rows.filter((r) => r.id !== recipeId) }
            : prev
        );
        return true;
      } catch (error) {
        logCaughtError("recipe_delete_failed", error);
        return false;
      }
    },
    [userId]
  );

  const loadSharedRecipe = useCallback(
    async (shareCode: string): Promise<BoxRecipe | null> => {
      const row = await fetchSharedRecipe(shareCode);
      return row ? sharedRowToRecipe(row, setNameMap) : null;
    },
    [setNameMap]
  );

  return {
    savedRecipes,
    recipesLoading,
    recipesError,
    reloadRecipes,
    saveRecipe,
    setRecipeSharing,
    deleteRecipe,
    loadSharedRecipe,
  };
}
```

### Step 9. `frontend/app/components/BoxCalculator/BoxCalculator.tsx`

Apply these edits in order. Each "Replace" block is the exact current text.

9a. Imports. Line 3 becomes:

```ts
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
```

After line 10 (`import { PackEntry, BoxRecipe, NavResult } from "./types";`) add:

```ts
import type { Currency } from "../ProductPrices/types";
import { logCaughtError } from "../../lib/logger";
import { BOX_RECIPES_LIST_LIMIT } from "../../lib/boxRecipes";
```

9b. Above the `calculateNav` doc comment (line 18, `/**` followed by ` * Calculate NAV in the user's display currency.`), add this module-level helper:

```ts
/** Format a value already expressed in `currency`; never converts. */
function formatInCurrency(value: number, currency: Currency): string {
  return `${currency === "CAD" ? "C$" : "$"}${value.toFixed(2)}`;
}

```

9c. Replace the hook destructure at `:90-97`:

```ts
  const {
    savedRecipes,
    recipesLoading,
    loadMyRecipes,
    saveRecipe,
    deleteRecipe,
    loadSharedRecipe,
  } = useBoxRecipes(setNameMap);
```

with:

```ts
  const {
    savedRecipes,
    recipesLoading,
    recipesError,
    reloadRecipes,
    saveRecipe,
    setRecipeSharing,
    deleteRecipe,
    loadSharedRecipe,
  } = useBoxRecipes(setNameMap);
```

9d. Replace `:113-138`, from `  const [copied, setCopied] = useState(false);` through the closing `}` of `function loadRecipeIntoState`, with:

```tsx
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [shareStatus, setShareStatus] = useState<"idle" | "working" | "error">("idle");
  const [sharedLinkMissing, setSharedLinkMissing] = useState(false);
  const [showSavedRecipes, setShowSavedRecipes] = useState(false);

  // Saved recipes are fetched inside useBoxRecipes, once per signed-in user.

  const loadRecipeIntoState = useCallback(
    (recipe: BoxRecipe) => {
      setRecipeName(recipe.name);
      setPacks(recipe.packs);
      setPromoValue(recipe.promoValue);
      setRetailPrice(recipe.retailPrice);
      setCurrentRecipeId(recipe.id);
      setCurrentShareCode(recipe.shareCode ?? null);
      setCopyState("idle");
      setShareStatus("idle");
      // Retail and promo were typed in the recipe's currency. Show them in
      // it rather than reinterpreting them in the current one (review F059).
      setSelectedCurrency(recipe.currency);
    },
    [setSelectedCurrency]
  );

  // Latest pack count, readable from the async shared-recipe callback.
  const packsCountRef = useRef(0);
  useEffect(() => {
    packsCountRef.current = packs.length;
  }, [packs]);

  // Load a shared recipe from ?recipe=<code> once the set names are known.
  const sharedCode = searchParams.get("recipe");
  const setsReady = setNameMap.size > 0;
  useEffect(() => {
    if (!sharedCode || !setsReady) return;
    let cancelled = false;
    loadSharedRecipe(sharedCode).then((recipe) => {
      if (cancelled) return;
      if (!recipe) {
        setSharedLinkMissing(true);
        return;
      }
      // Do not overwrite a recipe the visitor already started while the
      // RPC was in flight (review F116).
      if (packsCountRef.current > 0) return;
      loadRecipeIntoState(recipe);
    });
    return () => {
      cancelled = true;
    };
  }, [sharedCode, setsReady, loadSharedRecipe, loadRecipeIntoState]);
```

This deletes the `loadMyRecipes` effect (`:116-119`) and the old shared-recipe effect (`:121-129`). `loadSharedRecipe` changes identity exactly once (when `setNameMap` goes from empty to filled, the same render in which `setsReady` flips), so the effect runs once per page load. The line `const [showSavedRecipes, setShowSavedRecipes] = useState(false);` was inside the replaced range and is re-declared above; make sure it exists exactly once.

9e. In `handleSave`, replace `:207-219`:

```ts
    const recipe: BoxRecipe = {
      id: currentRecipeId,
      name: trimmedName,
      retailPrice,
      promoValue,
      packs,
      shareCode: currentShareCode,
    };

    const saved = await saveRecipe(recipe);
    if (saved) {
      setCurrentRecipeId(saved.id);
      setCurrentShareCode(saved.shareCode || null);
```

with:

```ts
    // No isPublic here: saving never changes whether a recipe is shared
    // (review F055). Sharing has its own control below.
    const recipe: BoxRecipe = {
      id: currentRecipeId,
      name: trimmedName,
      retailPrice,
      promoValue,
      packs,
      currency: selectedCurrency,
    };

    const saved = await saveRecipe(recipe);
    if (saved) {
      setCurrentRecipeId(saved.id);
      setCurrentShareCode(saved.shareCode ?? null);
```

9f. Replace `handleCopyShareLink` (`:228-234`) with the share URL, an awaited copy, and the sharing toggle:

```tsx
  const shareUrl = currentShareCode
    ? `${typeof window === "undefined" ? "" : window.location.origin}/box-calculator?recipe=${currentShareCode}`
    : null;

  const handleCopyShareLink = async () => {
    if (!shareUrl) return;
    try {
      // navigator.clipboard is undefined outside secure contexts; that
      // TypeError lands in the catch too.
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch (error) {
      // Report failure and show the link for manual copying (review F116).
      logCaughtError("share_link_copy_failed", error);
      setCopyState("failed");
    }
  };

  const handleSetSharing = async (makePublic: boolean) => {
    if (currentRecipeId === undefined) return;
    if (
      !makePublic &&
      !window.confirm(
        "Stop sharing? Anyone with the current link will no longer be able to open this recipe."
      )
    ) {
      return;
    }
    setShareStatus("working");
    const updated = await setRecipeSharing(currentRecipeId, makePublic);
    if (updated) {
      setCurrentShareCode(updated.shareCode ?? null);
      setCopyState("idle");
      setShareStatus("idle");
    } else {
      setShareStatus("error");
    }
  };
```

9g. In `handleNewRecipe` (`:236-243`), after `setCurrentShareCode(null);` add:

```ts
    setCopyState("idle");
    setShareStatus("idle");
```

9h. Replace `handleDeleteRecipe` (`:245-248`) with:

```ts
  const handleDeleteRecipe = async (recipeId: number) => {
    const deleted = await deleteRecipe(recipeId);
    if (deleted && currentRecipeId === recipeId) handleNewRecipe();
  };
```

9i. Line 278 becomes:

```ts
  const fmtPrice = (value: number) => formatInCurrency(value, selectedCurrency);
```

Keep `currencySymbol` (`:275`): the two input prefixes still use it.

9j. Replace the Share Link button block (`:318-325`):

```tsx
            {currentShareCode && (
              <button
                onClick={handleCopyShareLink}
                className="px-4 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
              >
                {copied ? "Copied!" : "Share Link"}
              </button>
            )}
```

with:

```tsx
            {user && currentRecipeId !== undefined && !currentShareCode && (
              <button
                onClick={() => handleSetSharing(true)}
                disabled={shareStatus === "working"}
                title="Anyone with the link can view the last saved version of this recipe"
                className="px-4 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 rounded-lg transition-colors"
              >
                {shareStatus === "working" ? "Sharing..." : "Make shareable"}
              </button>
            )}
            {user && currentShareCode && (
              <>
                <button
                  onClick={handleCopyShareLink}
                  className="px-4 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
                >
                  {copyState === "copied" ? "Copied!" : "Copy share link"}
                </button>
                <button
                  onClick={() => handleSetSharing(false)}
                  disabled={shareStatus === "working"}
                  className="px-4 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 rounded-lg transition-colors"
                >
                  Stop sharing
                </button>
              </>
            )}
```

"Make shareable" appears only for a saved recipe (it shares the last saved version, which the tooltip says). A recipe opened from someone else's link has no `id`, so it shows no sharing controls until the visitor saves their own copy.

9k. Directly above the `{/* Saved Recipes Toggle */}` comment (`:335`), insert the status lines:

```tsx
        {shareStatus === "error" && (
          <p role="alert" className="text-sm text-rose-600 mb-2">
            Could not update sharing. Please try again.
          </p>
        )}
        {copyState === "failed" && shareUrl && (
          <div className="mb-2">
            <label htmlFor="box-share-url" className="block text-sm text-gray-600 mb-1">
              Copying failed. Copy the link manually:
            </label>
            <input
              id="box-share-url"
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-gray-50 text-gray-900 text-sm"
            />
          </div>
        )}
        {sharedLinkMissing && (
          <p role="status" className="text-sm text-gray-600 mb-2">
            This shared recipe link is invalid or is no longer shared.
          </p>
        )}
        {user && recipesLoading && (
          <p className="text-sm text-gray-500 mb-2">Loading saved recipes...</p>
        )}
        {user && recipesError && (
          <p role="alert" className="text-sm text-rose-600 mb-2">
            Could not load your saved recipes.{" "}
            <button onClick={reloadRecipes} className="underline">
              Try again
            </button>
          </p>
        )}
        {user && savedRecipes.length >= BOX_RECIPES_LIST_LIMIT && (
          <p role="status" className="text-sm text-gray-500 mb-2">
            Showing your {BOX_RECIPES_LIST_LIMIT} most recently updated recipes.
          </p>
        )}

```

This also uses `recipesLoading`, which clears the existing unused-variable warning. The last block exists because `GET /api/box-recipes` stops at `BOX_RECIPES_LIST_LIMIT` rows ordered by `updated_at` (step 5a): without it, a user with more than 100 recipes would lose the oldest ones from the list with no hint (review F149 verifier). Use `>=`, not `===`: a save in the same session prepends a row and can push the count past the limit.

9l. In the saved list, replace line 361:

```tsx
                        {r.packs.length} pack type{r.packs.length !== 1 ? "s" : ""} &middot; {formatPrice(r.retailPrice)}
```

with:

```tsx
                        {r.packs.length} pack type{r.packs.length !== 1 ? "s" : ""} &middot; {formatInCurrency(r.retailPrice, r.currency)}
                        {r.shareCode ? " · Shared" : ""}
```

(The `·` inside `" · Shared"` is the literal middle-dot character U+00B7, or write the string as `" · Shared"`. Do not write `&middot;` inside that JavaScript string: HTML entities are decoded only in JSX text, so it would render the eight characters `&middot;` literally.) The plan said "use `fmtPrice(r.retailPrice)`". That fixes the double conversion but still labels a CAD recipe with "$" while USD is selected; now that each recipe stores its currency, the label must use the recipe's own currency.

Leave everything else, including the "How it works" copy at `:741` ("Save and share your recipes to revisit them later"), which is now true. WP15 owns copy changes.

### Step 10. `frontend/app/components/BoxCalculator/hooks/useBoosterBoxPrices.ts` (F117)

Above `export function useBoosterPackPrices() {` add:

```ts
/**
 * Newest release first; sets with no release date last; ties by name.
 * Compares the YYYY-MM-DD strings directly: new Date("") is NaN, and a
 * comparator that returns NaN makes the order engine-dependent (review F117).
 */
export function compareSetsNewestFirst(a: SetOption, b: SetOption): number {
  const aDate = a.releaseDate || "";
  const bDate = b.releaseDate || "";
  if (aDate !== bDate) {
    if (!aDate) return 1;
    if (!bDate) return -1;
    return bDate.localeCompare(aDate);
  }
  return a.name.localeCompare(b.name);
}
```

Replace `:56-61`:

```ts
        // Sort sets by release date descending (newest first)
        setSets(
          Array.from(setMap.values()).sort(
            (a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime()
          )
        );
```

with:

```ts
        setSets(Array.from(setMap.values()).sort(compareSetsNewestFirst));
```

`release_date` arrives as `YYYY-MM-DD` or `""` (`app/lib/marketData.ts:325`), so string order is date order.

### Step 11. ESLint guards (`frontend/eslint.config.mjs`)

11a. Append to WP04's `ANON_CLIENT_FORBIDDEN_FILES` array (after WP05's entries if present):

```js
  // WP06: box recipes (review F001, part 3). sharedRecipe.ts is deliberately
  // absent: get_shared_recipe is granted to anon and stays on that client.
  "app/components/BoxCalculator/BoxCalculator.tsx",
  "app/components/BoxCalculator/hooks/useBoxRecipes.ts",
  "app/lib/boxRecipes.ts",
  "app/api/box-recipes/**/*.ts",
```

If `ANON_CLIENT_FORBIDDEN_FILES` does not exist (WP04 step 9 missing), add WP04's block verbatim: the array above `export default [` containing `"app/context/AuthContext.tsx"`, `"app/account/page.tsx"` and these four entries, plus this object as the last element of the exported array:

```js
  {
    files: ANON_CLIENT_FORBIDDEN_FILES,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@supabase/ssr",
              message:
                "Do not build a Supabase client here. User data goes through cookie-backed route handlers (app/api/*).",
            },
          ],
          patterns: [
            {
              regex: "(^|/)lib/supabase$",
              message:
                "app/lib/supabase is the anonymous browser client; RLS rejects it on user tables. Call a route handler instead.",
            },
          ],
        },
      ],
    },
  },
```

11b. If WP05's `no-restricted-syntax` block exists (its comment says "WP06 adds box_recipes to this list once useBoxRecipes stops querying it"), add `box_recipes` to its selector regex, so it reads:

```js
            "CallExpression[callee.property.name='from'][arguments.0.value=/^(portfolios|portfolio_holdings|portfolio_lots|profiles|box_recipes)$/]",
```

(Keep whatever WP05 decided about `profiles`; only append `|box_recipes`.) Update its comment to say box_recipes is covered. If WP05's block does not exist, add this object at the end of the exported array instead:

```js
  // WP06: box_recipes may be queried only from route handlers. Browser code
  // runs as anon, and RLS plus migration 0013 reject it there (review F001).
  {
    files: ["app/**/*.{ts,tsx}", "proxy.ts"],
    ignores: ["app/api/**", "**/__tests__/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='from'][arguments.0.value=/^box_recipes$/]",
          message:
            "User tables are only reachable through cookie-backed route handlers (app/api/*). The browser Supabase client is anonymous and RLS rejects it here.",
        },
      ],
    },
  },
```

Both variants were checked with the installed ESLint 9.39.5 while writing this spec: the old `useBoxRecipes.ts` produces one `no-restricted-imports` error and four `no-restricted-syntax` errors; the new files produce none; `from("box_recipes")` inside `app/api/box-recipes/route.ts` is not flagged.

## Pitfalls: do not do this

- **Do not bridge the session to the browser client** (`supabase.auth.setSession`, returning tokens from a route, or the `accessToken` client option). Every F001 verifier rejects it: it puts the JWT back in JS-readable storage (session-cookie audit F-2), and the `accessToken` option makes every `supabase.auth.*` call throw.
- **Do not re-grant `anon` on `box_recipes` or loosen the `TO authenticated` policies** (migrations 0008, 0013, 0014) to make browser queries work.
- **Do not move `get_shared_recipe` behind a route or onto the cookie client.** It is deliberately anon-callable so logged-out visitors can open links, and production logs show anon RPCs succeed. It lives in `sharedRecipe.ts`, outside the ESLint guard.
- **Do not send `isPublic` (or `undefined` keys) from Save.** Per the F055 verifier correction, the update body must omit sharing fields entirely unless the caller is changing visibility; `parseRecipeWrite(..., "update")` writes only keys that are present. `setRecipeSharing` is the only caller that sends `isPublic`.
- **Do not generate or accept share codes in JavaScript.** Delete `generateShareCode`. The routes never read `shareCode` / `share_code` from a body, and the trigger overwrites whatever a direct PostgREST write sends.
- **Do not use column-level `GRANT`/`REVOKE` for `share_code`** (the F131 finder's option 3). With the table-level `UPDATE` grant that `authenticated` already holds, `REVOKE UPDATE (share_code)` changes nothing, and `verify_migration.py` refuses column-level grants (exit code 1). The trigger is the control.
- **Do not use `CREATE OR REPLACE FUNCTION` for `get_shared_recipe`.** Its return type changes from `SETOF box_recipes` to a `TABLE`, which Postgres rejects on replace. Drop and recreate, and restate `SET search_path = public` and the EXECUTE grants (0023's header explains why a recreated function silently loses them).
- **Do not use `extensions.gen_random_bytes` / `pgcrypto`**: its schema differs between environments and a plpgsql body only fails at the first INSERT. `gen_random_uuid()` is core.
- **Do not add `NOTIFY pgrst, 'reload schema'` to the migration.** Supabase reloads the PostgREST schema cache on DDL by itself, and `verify_migration.py` refuses unrecognised statements.
- **Do not backfill legacy `currency` as `'USD'`.** The calculator has defaulted to CAD since the first commit; see step 1.
- **Do not use `rejectIfCsrfFails` on `GET`.** Browsers do not send `Origin` on a same-origin GET, so every load would 403. Use the header-only `rejectIfNotAppRequest`. Mutations (`POST`, `PATCH`, `DELETE`) keep the full `rejectIfCsrfFails` plus `rejectIfBodyTooLarge`.
- **Do not export helpers from `route.ts` files.** Next's build fails on non-handler exports; shared code goes in `recipeErrors.ts`, `app/lib/boxRecipes.ts` or `app/lib/routeAuth.ts`.
- **Do not map every `getUser()` error to 401.** A GoTrue outage must return 503 (`requireRouteUser`), or the client treats it as "signed out" (F063).
- **Do not echo PostgREST `error.message` to the client.** Routes return fixed strings; `logSupabaseError` logs the safe fields.
- **Do not key the fetch effect on `user`, `setNameMap` or `loadMyRecipes`.** Key it on the user id (F149). Do not call `setState` synchronously in an effect body (`react-hooks/set-state-in-effect`); derive signed-out and loading state instead, as step 8 does.
- **Do not format saved-recipe prices with `formatPrice`** (it converts from USD) or with the display currency; use the recipe's own `currency` (step 9l).
- **Do not set "Copied!" before `writeText` resolves**, and do not swallow the failure (F116).
- **Do not keep `new Date(...)` in the set sort** (F117). Compare the date strings.
- **Do not touch `export_my_data`** (WP01 owns it in migration 0024). The F059 verifier asks for `'currency'` in the export's `box_recipes` object; it is deferred on purpose, because redefining the function here would duplicate WP01's body and break WP34's precondition that only 0011 and 0024 define it. The export does not include the new `currency` column; list that as a follow-up in the PR description (the next package that replaces `export_my_data`, currently WP34, should add `'currency', currency` to the `box_recipes` object).
- **Do not edit `schema.sql`.** It already lacks `is_public` and is reconciled by WP21 (F135); list the new column, constraints and trigger as input for WP21 in the PR description.
- **Do not deploy the code before the migration is applied.** The routes select `currency`, which does not exist until the migration runs, so `GET /api/box-recipes` would return 500. The reverse order is safe: the old client code is already broken for signed-in users, and the trigger handles its writes.
- **Do not write route tests without `/** @jest-environment node */`** on the first line; under jsdom `next/server` throws.

## Tests

The tests below were run green against a copy of the tree with these changes while this spec was written (6 suites, 74 tests; full suite 28 suites, 335 tests), except the two shared-link race cases in test file 5, which replaced a weaker single case during review (so expect 75 tests in these 6 suites). `next/jest` (`node_modules/next/dist/build/jest/jest.js`, `'^server-only$'` in its `moduleNameMapper`) maps `server-only` to an empty module, so `routeAuth.ts` and `recipeErrors.ts` load in tests; `jest.config.js` itself does not need a change.

### 1. `frontend/app/lib/__tests__/boxRecipes.test.ts` (new)

Covers: create mapping and `is_public` default; client share/owner fields never forwarded; every validation bound; code-point name length; non-object bodies; update writes only sent fields; visibility-only update; empty update rejected; `parseRecipeId` accepts and rejects; `SHARE_CODE_RE`.

```ts
import {
  SHARE_CODE_RE,
  parseRecipeId,
  parseRecipeWrite,
} from "../boxRecipes";

const VALID = {
  name: "  Surging Sparks ETB  ",
  retailPrice: 59.99,
  promoValue: 5,
  packs: [{ setId: 7, quantity: 9 }],
  currency: "CAD",
};

describe("parseRecipeWrite (create)", () => {
  it("maps camelCase to columns, trims the name and defaults is_public to false", () => {
    expect(parseRecipeWrite(VALID, "create")).toEqual({
      ok: true,
      value: {
        name: "Surging Sparks ETB",
        retail_price: 59.99,
        promo_value: 5,
        packs: [{ set_id: 7, quantity: 9 }],
        currency: "CAD",
        is_public: false,
      },
    });
  });

  it("never forwards share_code, user_id, id or timestamps", () => {
    const result = parseRecipeWrite(
      {
        ...VALID,
        shareCode: "1",
        share_code: "1",
        user_id: "someone-else",
        userId: "someone-else",
        id: 5,
        updated_at: "2020-01-01",
      },
      "create"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value).sort()).toEqual(
        ["currency", "is_public", "name", "packs", "promo_value", "retail_price"]
      );
    }
  });

  it.each([
    ["missing currency", { ...VALID, currency: undefined }],
    ["unknown currency", { ...VALID, currency: "EUR" }],
    ["empty name", { ...VALID, name: "   " }],
    ["201-character name", { ...VALID, name: "a".repeat(201) }],
    ["negative price", { ...VALID, retailPrice: -1 }],
    ["NaN promo", { ...VALID, promoValue: Number.NaN }],
    ["price above PRICE_MAX", { ...VALID, retailPrice: 1_000_001 }],
    ["no packs", { ...VALID, packs: [] }],
    ["51 packs", { ...VALID, packs: Array.from({ length: 51 }, (_, i) => ({ setId: i + 1, quantity: 1 })) }],
    ["fractional quantity", { ...VALID, packs: [{ setId: 1, quantity: 1.5 }] }],
    ["zero set id", { ...VALID, packs: [{ setId: 0, quantity: 1 }] }],
    ["string isPublic", { ...VALID, isPublic: "true" }],
  ])("rejects %s", (_label, body) => {
    expect(parseRecipeWrite(body, "create").ok).toBe(false);
  });

  it("counts code points like char_length(), not UTF-16 units", () => {
    // 200 emoji are 400 UTF-16 units but 200 characters to Postgres.
    expect(parseRecipeWrite({ ...VALID, name: "\u{1F525}".repeat(200) }, "create").ok).toBe(true);
  });

  it.each([null, "x", 42, [VALID]])("rejects a non-object body (%p)", (body) => {
    expect(parseRecipeWrite(body, "create")).toEqual({ ok: false, error: "Invalid body" });
  });
});

describe("parseRecipeWrite (update)", () => {
  it("writes only the fields that were sent (a Save never touches is_public)", () => {
    const result = parseRecipeWrite(VALID, "update");
    expect(result.ok).toBe(true);
    if (result.ok) expect("is_public" in result.value).toBe(false);
  });

  it("accepts a visibility-only change", () => {
    expect(parseRecipeWrite({ isPublic: true }, "update")).toEqual({
      ok: true,
      value: { is_public: true },
    });
  });

  it("rejects an empty update", () => {
    expect(parseRecipeWrite({ shareCode: "abc" }, "update")).toEqual({
      ok: false,
      error: "Nothing to update",
    });
  });
});

describe("parseRecipeId", () => {
  it.each([
    ["1", 1],
    ["9007199254740991", 9007199254740991],
  ])("accepts %s", (raw, id) => expect(parseRecipeId(raw)).toBe(id));

  it.each(["0", "-1", "01", "1.5", "abc", "", "9007199254740993", "1e3"])(
    "rejects %p",
    (raw) => expect(parseRecipeId(raw)).toBeNull()
  );
});

describe("SHARE_CODE_RE", () => {
  it("matches only 32 lowercase hex characters", () => {
    expect(SHARE_CODE_RE.test("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(SHARE_CODE_RE.test("0123456789ABCDEF0123456789ABCDEF")).toBe(false);
    expect(SHARE_CODE_RE.test("1")).toBe(false);
    expect(SHARE_CODE_RE.test("0123456789abcdef0123456789abcdef0")).toBe(false);
  });
});
```

### 2. `frontend/app/api/box-recipes/__tests__/route.test.ts` (new)

Covers GET: explicit column list, `user_id` filter, order, limit 100, `no-store`; header required but not Origin; 401 on no session; 503 on unreachable auth; database text hidden. POST: 403 without header or with a foreign Origin; 413; 400 on malformed JSON and invalid currency before auth runs; insert payload is exactly the parsed columns plus `user_id` (client `shareCode`, `share_code`, `user_id` ignored); 23514 maps to 400, anything else to a fixed 500.

```ts
/** @jest-environment node */
import { NextRequest } from "next/server";
import {
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";

const mockGetUser = jest.fn();
const mockFrom = jest.fn();

jest.mock("../../../lib/routeSupabase", () => ({
  createRouteSupabaseClient: async () => ({
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => mockFrom(table),
  }),
}));

import { GET, POST } from "../route";
import { BOX_RECIPE_COLUMNS } from "../../../lib/boxRecipes";

const USER = { id: "u1", email: "ash@example.com" };
const ROW = {
  id: 3,
  name: "ETB",
  retail_price: 59.99,
  promo_value: 5,
  packs: [{ set_id: 7, quantity: 9 }],
  currency: "CAD",
  share_code: null,
  is_public: false,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};
const BODY = {
  name: "ETB",
  retailPrice: 59.99,
  promoValue: 5,
  packs: [{ setId: 7, quantity: 9 }],
  currency: "CAD",
};

/** A chainable query builder whose terminal call resolves to `result`. */
function builder(result: unknown) {
  const b: Record<string, jest.Mock> = {};
  for (const m of ["select", "eq", "order", "insert", "update", "delete"]) {
    b[m] = jest.fn(() => b);
  }
  b.limit = jest.fn(() => Promise.resolve(result));
  b.single = jest.fn(() => Promise.resolve(result));
  b.maybeSingle = jest.fn(() => Promise.resolve(result));
  return b;
}

function get(headers: Record<string, string> = { "x-pokefin-request": "1" }) {
  return new NextRequest("http://localhost:3000/api/box-recipes", { headers });
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/box-recipes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pokefin-request": "1",
      origin: "http://localhost:3000",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
});

afterEach(() => jest.restoreAllMocks());

describe("GET /api/box-recipes", () => {
  it("lists the caller's recipes with an explicit column list and a limit", async () => {
    const b = builder({ data: [ROW], error: null });
    mockFrom.mockReturnValue(b);
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ recipes: [ROW] });
    expect(mockFrom).toHaveBeenCalledWith("box_recipes");
    expect(b.select).toHaveBeenCalledWith(BOX_RECIPE_COLUMNS);
    expect(b.select).not.toHaveBeenCalledWith("*");
    expect(b.eq).toHaveBeenCalledWith("user_id", "u1");
    expect(b.order).toHaveBeenCalledWith("updated_at", { ascending: false });
    expect(b.limit).toHaveBeenCalledWith(100);
  });

  it("requires the app header but not Origin (browsers omit Origin on same-origin GET)", async () => {
    mockFrom.mockReturnValue(builder({ data: [], error: null }));
    expect((await GET(get({}))).status).toBe(403);
    expect((await GET(get({ "x-pokefin-request": "1" }))).status).toBe(200);
  });

  it("returns 401 when there is no session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    expect((await GET(get())).status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns 503, not 401, when auth is unreachable", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError("fetch failed", 0) });
    expect((await GET(get())).status).toBe(503);
  });

  it("hides database error text", async () => {
    mockFrom.mockReturnValue(builder({ data: null, error: { code: "XX000", message: "secret detail" } }));
    const res = await GET(get());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
});

describe("POST /api/box-recipes", () => {
  it("rejects a request without the CSRF header or from another origin", async () => {
    expect((await POST(post(BODY, { "x-pokefin-request": "" }))).status).toBe(403);
    expect((await POST(post(BODY, { origin: "https://evil.example" }))).status).toBe(403);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("rejects an oversized body", async () => {
    expect((await POST(post(BODY, { "content-length": "20000" }))).status).toBe(413);
  });

  it("rejects malformed JSON and invalid recipes before touching auth", async () => {
    expect((await POST(post("{"))).status).toBe(400);
    expect((await POST(post({ ...BODY, currency: "EUR" }))).status).toBe(400);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("inserts with the caller's user_id and ignores client share fields", async () => {
    const b = builder({ data: ROW, error: null });
    mockFrom.mockReturnValue(b);
    const res = await POST(
      post({ ...BODY, shareCode: "1", share_code: "1", user_id: "other", isPublic: false })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ recipe: ROW });
    expect(b.insert).toHaveBeenCalledWith({
      name: "ETB",
      retail_price: 59.99,
      promo_value: 5,
      packs: [{ set_id: 7, quantity: 9 }],
      currency: "CAD",
      is_public: false,
      user_id: "u1",
    });
    expect(b.select).toHaveBeenCalledWith(BOX_RECIPE_COLUMNS);
  });

  it("maps a CHECK violation to 400 and anything else to a fixed 500", async () => {
    mockFrom.mockReturnValue(builder({ data: null, error: { code: "23514", message: "violates check" } }));
    expect((await POST(post(BODY))).status).toBe(400);
    mockFrom.mockReturnValue(builder({ data: null, error: { code: "XX000", message: "secret detail" } }));
    const res = await POST(post(BODY));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not save recipe. Please try again." });
  });
});
```

### 3. `frontend/app/api/box-recipes/[id]/__tests__/route.test.ts` (new)

Covers PATCH: only sent fields plus `updated_at` are written (no `is_public`, no `share_code`); visibility-only update; filters on `id` and `user_id`; 404 for a malformed id without querying; 404 when no row matched; 400 on empty update; 403 without header; 401 without session. DELETE: success, 404 when nothing deleted, 403 without header.

```ts
/** @jest-environment node */
import { NextRequest } from "next/server";
import { AuthSessionMissingError } from "@supabase/supabase-js";

const mockGetUser = jest.fn();
const mockFrom = jest.fn();

jest.mock("../../../../lib/routeSupabase", () => ({
  createRouteSupabaseClient: async () => ({
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => mockFrom(table),
  }),
}));

import { DELETE, PATCH } from "../route";

const USER = { id: "u1" };
const ROW = { id: 3, name: "ETB", share_code: "0123456789abcdef0123456789abcdef", is_public: true };

function builder(result: unknown) {
  const b: Record<string, jest.Mock> = {};
  for (const m of ["update", "delete", "eq"]) b[m] = jest.fn(() => b);
  // delete().eq().eq().select("id") is awaited directly; update(...).select(...) continues to maybeSingle().
  b.select = jest.fn(() => Object.assign(Promise.resolve(result), b));
  b.maybeSingle = jest.fn(() => Promise.resolve(result));
  return b;
}

function req(method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/box-recipes/3", {
    method,
    headers: {
      "content-type": "application/json",
      "x-pokefin-request": "1",
      origin: "http://localhost:3000",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
});

afterEach(() => jest.restoreAllMocks());

describe("PATCH /api/box-recipes/[id]", () => {
  it("writes only the fields sent: a Save never sends is_public or share_code (F055)", async () => {
    const b = builder({ data: ROW, error: null });
    mockFrom.mockReturnValue(b);
    const res = await PATCH(req("PATCH", { name: "Renamed", shareCode: "1" }), ctx("3"));
    expect(res.status).toBe(200);
    const written = b.update.mock.calls[0][0];
    expect(written.name).toBe("Renamed");
    expect(typeof written.updated_at).toBe("string");
    expect(written).not.toHaveProperty("is_public");
    expect(written).not.toHaveProperty("share_code");
    expect(b.eq).toHaveBeenCalledWith("id", 3);
    expect(b.eq).toHaveBeenCalledWith("user_id", "u1");
  });

  it("sends a visibility-only change as { is_public } plus updated_at", async () => {
    const b = builder({ data: ROW, error: null });
    mockFrom.mockReturnValue(b);
    await PATCH(req("PATCH", { isPublic: true }), ctx("3"));
    expect(Object.keys(b.update.mock.calls[0][0]).sort()).toEqual(["is_public", "updated_at"]);
  });

  it("returns 404 for a malformed id without querying", async () => {
    expect((await PATCH(req("PATCH", { name: "x" }), ctx("abc"))).status).toBe(404);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns 404 when no row matched (someone else's recipe or deleted)", async () => {
    mockFrom.mockReturnValue(builder({ data: null, error: null }));
    expect((await PATCH(req("PATCH", { name: "x" }), ctx("3"))).status).toBe(404);
  });

  it("rejects an empty update, a missing CSRF header and an anonymous caller", async () => {
    expect((await PATCH(req("PATCH", {}), ctx("3"))).status).toBe(400);
    expect((await PATCH(req("PATCH", { name: "x" }, { "x-pokefin-request": "" }), ctx("3"))).status).toBe(403);
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    expect((await PATCH(req("PATCH", { name: "x" }), ctx("3"))).status).toBe(401);
  });
});

describe("DELETE /api/box-recipes/[id]", () => {
  it("deletes the caller's row", async () => {
    const b = builder({ data: [{ id: 3 }], error: null });
    mockFrom.mockReturnValue(b);
    const res = await DELETE(req("DELETE"), ctx("3"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(b.eq).toHaveBeenCalledWith("user_id", "u1");
  });

  it("returns 404 when nothing was deleted", async () => {
    mockFrom.mockReturnValue(builder({ data: [], error: null }));
    expect((await DELETE(req("DELETE"), ctx("3"))).status).toBe(404);
  });

  it("requires the CSRF header", async () => {
    expect((await DELETE(req("DELETE", undefined, { "x-pokefin-request": "" }), ctx("3"))).status).toBe(403);
  });
});
```

### 4. `frontend/app/components/BoxCalculator/__tests__/useBoxRecipes.test.tsx` (new)

Covers: one GET even when set names arrive later, names update without a refetch (F149); no fetch when anonymous; failed load sets `recipesError` and `reloadRecipes` retries; PATCH body for an existing recipe has no `isPublic` (F055) and keeps the returned share code; POST for a new recipe puts it first; failed save returns null; sharing sends `{ isPublic: true }` alone; delete; shared recipe becomes an unsaved copy in its own currency with set names.

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { useBoxRecipes } from "../hooks/useBoxRecipes";
import { fetchSharedRecipe } from "../sharedRecipe";

const mockAuth: {
  user: { id: string } | null;
  sessionStatus: "unknown" | "anonymous" | "authenticated";
} = { user: { id: "u1" }, sessionStatus: "authenticated" };

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

jest.mock("../sharedRecipe", () => ({
  fetchSharedRecipe: jest.fn(),
}));

const fetchSharedMock = fetchSharedRecipe as jest.MockedFunction<typeof fetchSharedRecipe>;

const ROW = {
  id: 3,
  name: "ETB",
  retail_price: 150,
  promo_value: 5,
  packs: [{ set_id: 7, quantity: 9 }],
  currency: "CAD" as const,
  share_code: null,
  is_public: false,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const fetchMock = jest.fn();
const EMPTY_NAMES = new Map<number, string>();
const NAMES = new Map([[7, "Surging Sparks"]]);

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockAuth.user = { id: "u1" };
  mockAuth.sessionStatus = "authenticated";
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

it("fetches the list once, even when the set names arrive later (F149)", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ recipes: [ROW] }));
  const { result, rerender } = renderHook(({ names }) => useBoxRecipes(names), {
    initialProps: { names: EMPTY_NAMES },
  });
  await waitFor(() => expect(result.current.savedRecipes).toHaveLength(1));
  expect(result.current.savedRecipes[0].packs[0].setName).toBe("Set #7");

  rerender({ names: NAMES });
  expect(result.current.savedRecipes[0].packs[0].setName).toBe("Surging Sparks");
  expect(result.current.savedRecipes[0].currency).toBe("CAD");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/box-recipes",
    expect.objectContaining({ headers: { "x-pokefin-request": "1" } })
  );
});

it("does not fetch for an anonymous or unknown session", () => {
  mockAuth.user = null;
  mockAuth.sessionStatus = "anonymous";
  const { result } = renderHook(() => useBoxRecipes(NAMES));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(result.current.savedRecipes).toEqual([]);
  expect(result.current.recipesLoading).toBe(false);
});

it("reports a failed load and retries on reloadRecipes", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ error: "x" }, 500));
  const { result } = renderHook(() => useBoxRecipes(NAMES));
  await waitFor(() => expect(result.current.recipesError).toBe(true));

  fetchMock.mockResolvedValueOnce(jsonResponse({ recipes: [ROW] }));
  act(() => result.current.reloadRecipes());
  await waitFor(() => expect(result.current.savedRecipes).toHaveLength(1));
  expect(result.current.recipesError).toBe(false);
});

it("saves an existing recipe with PATCH and never sends isPublic (F055)", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ recipes: [{ ...ROW, is_public: true, share_code: "a".repeat(32) }] }));
  const { result } = renderHook(() => useBoxRecipes(NAMES));
  await waitFor(() => expect(result.current.savedRecipes).toHaveLength(1));

  fetchMock.mockResolvedValueOnce(
    jsonResponse({ recipe: { ...ROW, name: "Renamed", is_public: true, share_code: "a".repeat(32) } })
  );
  let saved: Awaited<ReturnType<typeof result.current.saveRecipe>> = null;
  await act(async () => {
    saved = await result.current.saveRecipe({
      id: 3,
      name: "Renamed",
      retailPrice: 150,
      promoValue: 5,
      currency: "CAD",
      packs: [{ id: "p", setId: 7, setName: "Surging Sparks", quantity: 9 }],
    });
  });

  const [url, init] = fetchMock.mock.calls[1];
  expect(url).toBe("/api/box-recipes/3");
  expect(init.method).toBe("PATCH");
  expect(init.headers).toEqual({ "Content-Type": "application/json", "x-pokefin-request": "1" });
  expect(JSON.parse(init.body)).toEqual({
    name: "Renamed",
    retailPrice: 150,
    promoValue: 5,
    packs: [{ setId: 7, quantity: 9 }],
    currency: "CAD",
  });
  expect(saved).toMatchObject({ id: 3, shareCode: "a".repeat(32), isPublic: true });
  expect(result.current.savedRecipes[0].name).toBe("Renamed");
});

it("creates a new recipe with POST and puts it first", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ recipes: [ROW] }));
  const { result } = renderHook(() => useBoxRecipes(NAMES));
  await waitFor(() => expect(result.current.savedRecipes).toHaveLength(1));

  fetchMock.mockResolvedValueOnce(jsonResponse({ recipe: { ...ROW, id: 4, name: "New" } }, 201));
  await act(async () => {
    await result.current.saveRecipe({
      name: "New",
      retailPrice: 1,
      promoValue: 0,
      currency: "USD",
      packs: [{ id: "p", setId: 7, setName: "x", quantity: 1 }],
    });
  });
  expect(fetchMock.mock.calls[1][0]).toBe("/api/box-recipes");
  expect(fetchMock.mock.calls[1][1].method).toBe("POST");
  expect(result.current.savedRecipes.map((r) => r.id)).toEqual([4, 3]);
});

it("returns null when a save fails", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ recipes: [] }));
  const { result } = renderHook(() => useBoxRecipes(NAMES));
  await waitFor(() => expect(result.current.recipesLoading).toBe(false));
  fetchMock.mockResolvedValueOnce(jsonResponse({ error: "x" }, 500));
  let saved: unknown = "unset";
  await act(async () => {
    saved = await result.current.saveRecipe({
      name: "New", retailPrice: 1, promoValue: 0, currency: "USD",
      packs: [{ id: "p", setId: 7, setName: "x", quantity: 1 }],
    });
  });
  expect(saved).toBeNull();
});

it("shares with a PATCH carrying only isPublic", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ recipes: [ROW] }));
  const { result } = renderHook(() => useBoxRecipes(NAMES));
  await waitFor(() => expect(result.current.savedRecipes).toHaveLength(1));
  fetchMock.mockResolvedValueOnce(jsonResponse({ recipe: { ...ROW, is_public: true, share_code: "b".repeat(32) } }));
  let shared: Awaited<ReturnType<typeof result.current.setRecipeSharing>> = null;
  await act(async () => {
    shared = await result.current.setRecipeSharing(3, true);
  });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ isPublic: true });
  expect(shared).toMatchObject({ shareCode: "b".repeat(32) });
});

it("deletes and drops the row", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ recipes: [ROW] }));
  const { result } = renderHook(() => useBoxRecipes(NAMES));
  await waitFor(() => expect(result.current.savedRecipes).toHaveLength(1));
  fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
  await act(async () => {
    expect(await result.current.deleteRecipe(3)).toBe(true);
  });
  expect(fetchMock.mock.calls[1]).toEqual([
    "/api/box-recipes/3",
    { method: "DELETE", headers: { "x-pokefin-request": "1" } },
  ]);
  expect(result.current.savedRecipes).toEqual([]);
});

it("turns a shared recipe into an unsaved copy in its own currency", async () => {
  mockAuth.user = null;
  mockAuth.sessionStatus = "anonymous";
  fetchSharedMock.mockResolvedValue({
    name: "Shared", retail_price: 40, promo_value: 0, packs: [{ set_id: 7, quantity: 2 }], currency: "USD",
  });
  const { result } = renderHook(() => useBoxRecipes(NAMES));
  const recipe = await result.current.loadSharedRecipe("c".repeat(32));
  expect(recipe).toMatchObject({ name: "Shared", currency: "USD", retailPrice: 40 });
  expect(recipe?.id).toBeUndefined();
  expect(recipe?.shareCode).toBeUndefined();
  expect(recipe?.packs[0].setName).toBe("Surging Sparks");
});
```

### 5. `frontend/app/components/BoxCalculator/__tests__/BoxCalculator.test.tsx` (new)

Mocks the two data hooks, `next/navigation`, `AuthContext` and `lib/exchangeRate`, so it tests only the component. Covers: saved-list price in the recipe's own currency with no conversion (F059); loading a recipe switches the display currency; Save sends `currency` and no `isPublic` / `shareCode` (F055); "Make shareable" appears only for a saved recipe and turns into "Copy share link" / "Stop sharing"; "Copied!" only after `writeText` resolves; a rejected write shows the manual-copy field and no "Copied!" (F116); a shared-recipe answer for a link that changed in the meantime is ignored (the effect's `cancelled` flag), and one that arrives after the visitor loaded or started a recipe does not overwrite it (the `packsCountRef` guard); an unresolvable link shows the message. The input with placeholder `"Recipe name..."` (`BoxCalculator.tsx:298`) starts as `"My Collection Box"` (`:100`).

```tsx
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import BoxCalculator from "../BoxCalculator";
import type { BoxRecipe } from "../types";

let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useSearchParams: () => mockSearch,
}));

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, sessionStatus: "authenticated" }),
}));

jest.mock("../../../lib/exchangeRate", () => ({
  fetchLatestExchangeRateClient: jest.fn().mockResolvedValue({ rate: 1.36, recordedAt: null }),
}));

const SETS = [{ id: 7, name: "Surging Sparks", code: "SSP", releaseDate: "2024-11-08" }];
const getPackPrice = () => 5;
jest.mock("../hooks/useBoosterBoxPrices", () => ({
  useBoosterPackPrices: () => ({ sets: SETS, loading: false, getPackPrice }),
}));

const SAVED: BoxRecipe = {
  id: 3,
  name: "Saved CAD box",
  retailPrice: 150,
  promoValue: 0,
  currency: "CAD",
  packs: [{ id: "p1", setId: 7, setName: "Surging Sparks", quantity: 2 }],
  shareCode: null,
  isPublic: false,
};

const hook = {
  savedRecipes: [SAVED],
  recipesLoading: false,
  recipesError: false,
  reloadRecipes: jest.fn(),
  saveRecipe: jest.fn(),
  setRecipeSharing: jest.fn(),
  deleteRecipe: jest.fn(),
  loadSharedRecipe: jest.fn(),
};
jest.mock("../hooks/useBoxRecipes", () => ({
  useBoxRecipes: () => hook,
}));

const writeText = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  hook.savedRecipes = [SAVED];
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

function openSavedAndLoad() {
  fireEvent.click(screen.getByText(/Show saved recipes/));
  fireEvent.click(screen.getByText("Saved CAD box"));
}

it("labels a saved recipe's price in its own currency without converting (F059)", async () => {
  render(<BoxCalculator />);
  fireEvent.click(screen.getByText(/Show saved recipes/));
  // Display currency defaults to CAD; C$150 must not become C$204.00.
  expect(screen.getByText(/C\$150\.00/)).toBeInTheDocument();
  expect(screen.queryByText(/C\$204\.00/)).not.toBeInTheDocument();
});

it("switches the display currency to the loaded recipe's currency (F059)", () => {
  hook.savedRecipes = [{ ...SAVED, currency: "USD", name: "Saved CAD box" }];
  render(<BoxCalculator />);
  openSavedAndLoad();
  expect(screen.getByText("Retail / Sticker Price (USD)")).toBeInTheDocument();
});

it("saves with the display currency and without isPublic (F055, F059)", async () => {
  hook.saveRecipe.mockResolvedValue({ ...SAVED, shareCode: null });
  render(<BoxCalculator />);
  openSavedAndLoad();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
  });
  const sent = hook.saveRecipe.mock.calls[0][0];
  expect(sent).toMatchObject({ id: 3, currency: "CAD" });
  expect(sent).not.toHaveProperty("isPublic");
  expect(sent).not.toHaveProperty("shareCode");
});

it("offers Make shareable for a saved recipe and then the copy link (F055)", async () => {
  hook.setRecipeSharing.mockResolvedValue({ ...SAVED, shareCode: "d".repeat(32), isPublic: true });
  render(<BoxCalculator />);
  expect(screen.queryByRole("button", { name: "Make shareable" })).not.toBeInTheDocument();
  openSavedAndLoad();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Make shareable" }));
  });
  expect(hook.setRecipeSharing).toHaveBeenCalledWith(3, true);
  expect(screen.getByRole("button", { name: "Copy share link" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Stop sharing" })).toBeInTheDocument();
});

it("shows Copied! only after the clipboard write resolves (F116)", async () => {
  hook.savedRecipes = [{ ...SAVED, shareCode: "d".repeat(32), isPublic: true }];
  writeText.mockResolvedValue(undefined);
  render(<BoxCalculator />);
  openSavedAndLoad();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));
  });
  expect(writeText).toHaveBeenCalledWith(`http://localhost:3000/box-calculator?recipe=${"d".repeat(32)}`);
  expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();
});

it("reports a rejected clipboard write and shows the link to copy by hand (F116)", async () => {
  hook.savedRecipes = [{ ...SAVED, shareCode: "d".repeat(32), isPublic: true }];
  writeText.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
  render(<BoxCalculator />);
  openSavedAndLoad();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));
  });
  expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Copy the link manually/)).toHaveValue(
    `http://localhost:3000/box-calculator?recipe=${"d".repeat(32)}`
  );
});

it("ignores a shared-recipe answer for a link that is no longer current (F116, cancel flag)", async () => {
  mockSearch = new URLSearchParams(`recipe=${"e".repeat(32)}`);
  const pending: Array<(r: BoxRecipe | null) => void> = [];
  hook.loadSharedRecipe.mockImplementation(
    () => new Promise<BoxRecipe | null>((resolve) => { pending.push(resolve); })
  );
  const { rerender } = render(<BoxCalculator />);
  expect(hook.loadSharedRecipe).toHaveBeenCalledTimes(1);

  // The ?recipe= value changes before the first answer arrives.
  mockSearch = new URLSearchParams(`recipe=${"f".repeat(32)}`);
  rerender(<BoxCalculator />);
  expect(hook.loadSharedRecipe).toHaveBeenCalledTimes(2);

  await act(async () => {
    pending[0]({ ...SAVED, id: undefined, name: "Stale" });
  });
  // Without the cancelled flag this would read "Stale".
  expect(screen.getByPlaceholderText("Recipe name...")).toHaveValue("My Collection Box");

  await act(async () => {
    pending[1]({ ...SAVED, id: undefined, name: "Current" });
  });
  expect(screen.getByPlaceholderText("Recipe name...")).toHaveValue("Current");
});

it("does not overwrite a recipe the visitor started before the shared one arrived (F116)", async () => {
  mockSearch = new URLSearchParams(`recipe=${"e".repeat(32)}`);
  let resolveShared: (r: BoxRecipe | null) => void = () => {};
  hook.loadSharedRecipe.mockImplementation(
    () => new Promise<BoxRecipe | null>((resolve) => { resolveShared = resolve; })
  );
  render(<BoxCalculator />);
  openSavedAndLoad(); // the form now holds 1 pack
  await act(async () => {
    resolveShared({ ...SAVED, id: undefined, name: "Late" });
  });
  expect(screen.getByPlaceholderText("Recipe name...")).toHaveValue("Saved CAD box");
});

it("says so when a shared link does not resolve", async () => {
  mockSearch = new URLSearchParams(`recipe=${"e".repeat(32)}`);
  hook.loadSharedRecipe.mockResolvedValue(null);
  render(<BoxCalculator />);
  await waitFor(() =>
    expect(screen.getByText(/invalid or is no longer shared/)).toBeInTheDocument()
  );
});
```

### 6. `frontend/app/components/BoxCalculator/__tests__/useBoosterBoxPrices.test.tsx` (update)

Change the hook import (line 3) to:

```ts
import {
  compareSetsNewestFirst,
  useBoosterPackPrices,
} from "../hooks/useBoosterBoxPrices";
```

and append:

```ts
describe("compareSetsNewestFirst (F117)", () => {
  const set = (id: number, name: string, releaseDate: string) => ({
    id,
    name,
    code: `S${id}`,
    releaseDate,
  });

  it("orders newest first, undated sets last, ties by name", () => {
    const sorted = [
      set(1, "Undated B", ""),
      set(2, "Old", "2023-03-31"),
      set(3, "New", "2025-01-17"),
      set(4, "Undated A", ""),
      set(5, "Same day B", "2024-11-08"),
      set(6, "Same day A", "2024-11-08"),
    ].sort(compareSetsNewestFirst);
    expect(sorted.map((s) => s.name)).toEqual([
      "New",
      "Same day A",
      "Same day B",
      "Old",
      "Undated A",
      "Undated B",
    ]);
  });

  it("never returns NaN", () => {
    expect(Number.isNaN(compareSetsNewestFirst(set(1, "a", ""), set(2, "b", "2024-01-01")))).toBe(false);
  });
});
```

### 7. Existing tests to re-run unchanged

`app/lib/__tests__/validation.test.ts`, `app/lib/__tests__/rateLimit.test.ts`, `app/context/__tests__/AuthContext.test.tsx`, WP04's and WP05's route tests if present.

## Verification

Run from `frontend/`:

```bash
pnpm install --frozen-lockfile

# Type check: expect no output, exit 0.
pnpm exec tsc --noEmit

# Lint the touched files: expect 0 errors and 0 warnings in these paths
# (eslint.config.mjs itself may show its pre-existing
# import/no-anonymous-default-export warning).
pnpm exec eslint eslint.config.mjs app/components/BoxCalculator app/api/box-recipes \
  app/lib/boxRecipes.ts app/lib/routeAuth.ts app/lib/csrf.ts app/lib/__tests__/boxRecipes.test.ts

# The guards work (lint stdin under a guarded file name; nothing is modified).
echo 'import { supabase } from "../../../lib/supabase"; export const x = supabase;' \
  | pnpm exec eslint --stdin --stdin-filename app/components/BoxCalculator/hooks/useBoxRecipes.ts \
  | grep -c "no-restricted-imports"
# expect: 1
echo 'declare const s: any; export const q = s.from("box_recipes").select("id");' \
  | pnpm exec eslint --stdin --stdin-filename app/components/BoxCalculator/hooks/useBoxRecipes.ts \
  | grep -c "no-restricted-syntax"
# expect: 1
echo 'declare const s: any; export const q = s.from("box_recipes").select("id");' \
  | pnpm exec eslint --stdin --stdin-filename app/api/box-recipes/route.ts \
  | grep -c "no-restricted-syntax"
# expect: 0

# No browser-client use and no client share code left.
# (The new hook has a local `userId` variable, so match only the old
# `userId:` / `userId?:` property, not the bare word.)
grep -rnE 'lib/supabase"|generateShareCode|select\("\*"\)|user_id: row|userId\??:' \
  app/components/BoxCalculator/hooks app/components/BoxCalculator/BoxCalculator.tsx app/components/BoxCalculator/types.ts
# expect: no output
grep -rn 'rpc("get_shared_recipe"' app --include=*.ts --include=*.tsx | grep -v __tests__
# expect: exactly one line, in app/components/BoxCalculator/sharedRecipe.ts
# (a plain "get_shared_recipe" grep also hits doc comments in sharedRecipe.ts
# and app/lib/boxRecipes.ts; that is expected)

# Full lint: the error count must not rise above master's; the two
# BoxCalculator warnings from "Before you start" check 9 are gone.
pnpm run lint 2>&1 | tail -3

# Tests.
pnpm test --ci app/lib/__tests__/boxRecipes.test.ts app/api/box-recipes app/components/BoxCalculator
# expect: 6 suites passed
pnpm test --ci
# expect: all suites pass

# Production build against the WP00 stub.
pnpm build:stub
# expect: exit 0, and the route list includes ƒ /api/box-recipes and ƒ /api/box-recipes/[id]
```

From the repo root:

```bash
# verify_migration.py reads the new file (it prints SQL to stdout and a summary to stderr).
python3 verify_migration.py migrations/0026_box_recipes_sharing_and_currency.sql > /tmp/wp06_verify.sql; echo "exit=$?"
# expect: exit=3, and stderr lists 2 functions, 7 privileges, and
# "NOT VERIFIED ...: 2 x ALTER TABLE (other than RLS enablement), 1 x CREATE TRIGGER,
#  3 x DO block, 2 x DROP object, 2 x data statement". No "refused" line.

# Python suite unaffected.
python -m pytest tests/ -q
```

**Migration replay (optional but recommended).** Replay the migration on a throwaway PostgreSQL** (any 13+; `psql` and PostgreSQL 16 binaries exist in the dev container at `/usr/lib/postgresql/16/bin`). Start a disposable cluster in a directory the `postgres` user can read, create a database, then load this scaffold, then `migrations/create_box_recipes.sql`, `0005`, `0008`, `0013`, and the box_recipes lines of `0014` (`sed -n '50,53p;89,105p' migrations/0014_rls_perf_and_dedupe.sql`):

```sql
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
CREATE TABLE public.profiles (id uuid PRIMARY KEY);
CREATE TABLE public.portfolios (id bigint PRIMARY KEY, user_id uuid);
CREATE TABLE public.portfolio_holdings (id bigint PRIMARY KEY, portfolio_id bigint, notes text);
CREATE TABLE public.portfolio_lots (id bigint PRIMARY KEY, holding_id bigint);
INSERT INTO auth.users VALUES ('11111111-1111-1111-1111-111111111111');
```

Seed legacy rows (after the four migrations, before 0026): one private row with `share_code = 'abc'`, one public row with a valid 32-hex code, one public row with `share_code = NULL`, one public row with `share_code = '1'`. Apply 0026 twice (expect success both times, one NOTICE each). Expected results, all observed while writing this spec:

- Private row: `share_code` NULL. Valid public row: code unchanged. The two bad public rows: fresh 32-hex codes, stable across the second run. All rows `currency = 'CAD'`; the column default is `'USD'`.
- As `authenticated` with `request.jwt.claim.sub` set: an INSERT sending `share_code = '1', is_public = true` gets a fresh 32-hex code; an INSERT with no `is_public` gets `share_code` NULL even when one was sent; `UPDATE ... SET share_code = '1'` on a public row keeps the old code; `UPDATE ... SET name = ...` keeps it; `is_public = false` clears it; `is_public = true` again mints a new one; `SET currency = 'EUR'` fails with `box_recipes_currency_valid`; `SELECT public.box_recipes_share_code_guard()` fails with permission denied.
- As `anon`: `get_shared_recipe('<valid code>')` returns exactly the columns `name, retail_price, promo_value, packs, currency`; `get_shared_recipe('1')` returns 0 rows; `SELECT count(*) FROM box_recipes` fails with permission denied.
- The query printed by `verify_migration.py` returns 9 rows, all `OK`.

**Manual checks** (local `pnpm dev` against a Supabase project where the migration is applied; the executor has no production access, so this is for the owner or a staging project):
   1. Sign in, open `/box-calculator`. DevTools Network: exactly one `GET /api/box-recipes` (200), no request to `/rest/v1/box_recipes` Switch to another browser tab and back: `/api/auth/me` may refetch, but no second `GET /api/box-recipes` appears (F149).
   2. Add a pack, set retail to 150 with CAD selected, Save. `POST /api/box-recipes` returns 201; the button shows "Saved!" then "Update"; "Make shareable" appears.
   3. Show saved recipes: the row reads "1 pack type · C$150.00" (not C$204.00).
   4. Click "Make shareable": `PATCH /api/box-recipes/<id>` with body `{"isPublic":true}`; "Copy share link" and "Stop sharing" appear. Click "Copy share link": "Copied!" and the clipboard holds `<origin>/box-calculator?recipe=<32 hex>`.
   5. Change the name and click Update. The PATCH body has no `isPublic`; the link from step 4 still opens the recipe in a private window.
   6. In the private window (signed out), the recipe loads with CAD selected and the RPC response (`/rest/v1/rpc/get_shared_recipe`) has no `id`, `user_id` or `share_code`. There are no sharing buttons.
   7. Back in the signed-in window, "Stop sharing" and confirm. Reloading the private window shows "This shared recipe link is invalid or is no longer shared."
   8. Switch to USD, then open the saved CAD recipe from the list: the selector flips to CAD.
   9. Delete the recipe: `DELETE /api/box-recipes/<id>` returns 200 and the row disappears.

## Owner actions

1. **Before merging the code**, check legacy share data in the Supabase SQL editor (select all text first, or use MCP `execute_sql`):

   ```sql
   SELECT count(*) FILTER (WHERE NOT is_public AND share_code IS NOT NULL) AS private_with_code,
          count(*) FILTER (WHERE is_public AND (share_code IS NULL OR share_code !~ '^[0-9a-f]{32}$')) AS public_bad_code,
          count(*) FILTER (WHERE is_public) AS public_total,
          count(*) AS total
     FROM public.box_recipes;
   ```

   `public_bad_code` rows get a new code, so any link already handed out for them stops working. Expected 0. If it is not 0 and those links matter, tell the author before applying.

   In the same session, confirm the production column types match what the new `get_shared_recipe` declares (a `LANGUAGE sql` function whose `SELECT` types differ from its `RETURNS TABLE` fails to create, and the migration would abort):

   ```sql
   SELECT column_name, data_type
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'box_recipes'
      AND column_name IN ('name', 'retail_price', 'promo_value', 'packs', 'share_code', 'is_public', 'currency')
    ORDER BY column_name;
   ```

   Expected: `is_public` boolean, `name` text, `packs` jsonb, `promo_value` double precision, `retail_price` double precision, `share_code` text, and no `currency` row yet. If any type differs, stop and tell the author: the `RETURNS TABLE` column types in step 1 must be changed to match before applying. (The migration runs as one transaction through `apply_migration` or a whole-file SQL editor run, so a failure leaves the old function in place.)
2. **Apply `migrations/0026_box_recipes_sharing_and_currency.sql`** to production via Supabase MCP `apply_migration` (preferred) or the SQL editor with the whole file selected. Do this **before** the Vercel deployment of this PR goes live.
3. **Verify:** run `python3 verify_migration.py migrations/0026_box_recipes_sharing_and_currency.sql`, execute the printed query: all 9 rows `OK`. Then run the three queries in the migration header: 3 constraint rows, 1 trigger row with `tgenabled = 'O'`, and `currency` default `'USD'::text`, not nullable. `verify_migration.py` on `0005` now reports a body `MISMATCH` for `get_shared_recipe`; that is correct, because 0026 redefines it.
4. **Run the Supabase security advisor** (Dashboard, Advisors, Security, or MCP `get_advisors` type `security`). Expect no new finding for `box_recipes_share_code_guard` (its `search_path` is pinned) or `get_shared_recipe`.
5. **Record it** in `audits/HARDENING_FOLLOWUPS.md` section 7 as a bullet in the existing style, placed newest-first in the run of migration bullets: directly above WP01's "**Migrations 0024 and 0025" bullet (or, if that is absent, directly above "**Migration 0022 applied**"), and below any WP10 "**Migrations 0027, 0028 and 0029" bullet if WP10 merged first. WP16's docs step finds it by the text "**Migration 0026". Text: "**Migration 0026 applied** (date, via Supabase MCP). Server-owned box recipe share codes (trigger + format/visibility CHECKs), `box_recipes.currency`, and `get_shared_recipe` without owner id. `public_bad_code` before apply: N." Add a second bullet: "**Open:** `export_my_data` (0011, redefined by WP01's 0024) does not export `box_recipes.currency`; add it the next time that function is redefined."
6. **After deploy**, run manual checks 1 to 9 from "Manual checks" under Verification on production with a test account.

## Acceptance criteria

- [ ] `useBoxRecipes.ts`, `BoxCalculator.tsx`, `app/lib/boxRecipes.ts` and `app/api/box-recipes/**` do not import `app/lib/supabase`, and ESLint fails if they do.
- [ ] No browser code calls `.from("box_recipes")`; ESLint fails if it does.
- [ ] A signed-in visit to `/box-calculator` makes exactly one `GET /api/box-recipes` and no `/rest/v1/box_recipes` request.
- [ ] `GET /api/box-recipes` selects an explicit column list with `limit(100)`; no `select("*")` remains in the box-recipe code. When the list holds 100 or more recipes, the calculator shows "Showing your 100 most recently updated recipes."
- [ ] Returning focus to the tab (which makes `AuthContext` replace its `user` object) does not trigger another `GET /api/box-recipes`.
- [ ] Saving a new recipe returns 201 and it appears first in the list; updating returns 200; deleting returns 200 and removes it.
- [ ] A saved recipe shows "Make shareable"; after clicking it, "Copy share link" and "Stop sharing" appear, and the link opens the recipe for a signed-out visitor.
- [ ] Clicking Update on a shared recipe sends no `isPublic` and does not change its share code.
- [ ] Share codes are 32 lowercase hex characters minted by the database; a client-supplied `share_code` is ignored on INSERT and UPDATE.
- [ ] `get_shared_recipe` returns only `name, retail_price, promo_value, packs, currency`.
- [ ] Every recipe row has `currency` in (`USD`, `CAD`); Save writes the display currency; loading a recipe switches the display to its currency; the saved list shows each price in its own currency without conversion.
- [ ] "Copied!" appears only after the clipboard write resolves; a failed write shows the link in a read-only field.
- [ ] A shared-recipe response for a `?recipe=` value that is no longer current, or one that arrives after the visitor loaded or added packs, does not change the form.
- [ ] `grep -rn 'rpc("get_shared_recipe"' app` prints exactly one line, in `app/components/BoxCalculator/sharedRecipe.ts`.
- [ ] The set picker orders newest first with undated sets last, and the comparator never returns NaN.
- [ ] `pnpm exec tsc --noEmit`, the lint commands, `pnpm test --ci` and `pnpm build:stub` pass; the migration verifies all `OK`.

## Rollback

Code: revert the merge commit. The reverted client goes back to the anonymous browser client, which is broken for signed-in users (as before this PR) but harmless; it keeps working against the migrated database because the trigger handles its writes and it does not read the RPC's removed columns in any way that throws.

Database: roll back **only after** the code revert is deployed (the new routes select `currency`). Run this as one script:

```sql
DROP TRIGGER IF EXISTS box_recipes_share_code_trg ON public.box_recipes;
DROP FUNCTION IF EXISTS public.box_recipes_share_code_guard();
ALTER TABLE public.box_recipes DROP CONSTRAINT IF EXISTS box_recipes_share_code_iff_public;
ALTER TABLE public.box_recipes DROP CONSTRAINT IF EXISTS box_recipes_share_code_format;
ALTER TABLE public.box_recipes DROP CONSTRAINT IF EXISTS box_recipes_currency_valid;

DROP FUNCTION IF EXISTS public.get_shared_recipe(text);
CREATE FUNCTION public.get_shared_recipe(p_share_code text)
RETURNS SETOF public.box_recipes
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
    FROM public.box_recipes
   WHERE share_code = p_share_code
     AND is_public = true
   LIMIT 1;
$$;
REVOKE ALL    ON FUNCTION public.get_shared_recipe(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_shared_recipe(text) TO anon, authenticated, service_role;
```

Leave the `currency` column in place (dropping it loses data and nothing breaks with it present; `SELECT *` in the restored RPC simply returns it too). Share codes minted by the trigger stay valid. Record the rollback in `audits/HARDENING_FOLLOWUPS.md`.

## Commit and PR

Commit message:

```text
fix(box-calculator): move recipes behind cookie-backed routes; server-owned share codes

The browser Supabase client cannot read the HttpOnly session, so every
box_recipes read and write ran as anon and RLS rejected it (review F001,
part 3). Recipes now go through GET/POST /api/box-recipes and
PATCH/DELETE /api/box-recipes/[id] on the cookie session, CSRF-gated.

Sharing works for the first time (F055): a saved recipe gets "Make
shareable" / "Stop sharing", Save never touches visibility, and a
database trigger owns the 32-hex share code (F131). get_shared_recipe
no longer returns the owner's user id. Recipes store their currency
(F059), the list is fetched once with explicit columns (F149), copy
feedback waits for the clipboard (F116), and the set sort no longer
uses a NaN comparator (F117).

Migration 0026_box_recipes_sharing_and_currency.sql must be applied
before this deploys.
```

PR title: `WP06: box recipes via route handlers, working share links, recipe currency`

PR body summary: link this spec; list F001 (part 3), F055, F059, F116, F117, F131, F149; call out in bold that migration 0026 must be applied before deploy, and paste the Owner actions; note the plan corrections (legacy currency backfilled as CAD with USD default; RPC trimmed to five columns; trigger instead of column grants); state whether steps 3a, 3b and 4 were needed or reused from WP04/WP05; paste the Verification outputs; list follow-ups: `export_my_data` does not include `currency` (WP01 area; recorded in `HARDENING_FOLLOWUPS.md` by Owner action 5), `schema.sql` lacks `is_public`, `currency`, the constraints and the trigger (WP21, F135), WP21's per-user row caps (F133) should cover `box_recipes`, and for WP07: `formatInCurrency` in `BoxCalculator.tsx` (step 9b) is a money formatter that WP07 step 6g should route through `formatMoney(value, currency)` together with `fmtPrice`. State the migration number you used (0026 unless check 7 found it taken).
