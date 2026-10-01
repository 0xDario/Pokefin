# WP28: MSRP, pack contents, cost per pack and box NAV from the catalog

- **Goal**: every product with curated data shows how far its Market Price sits from retail ("1.4x MSRP") and what one pack costs inside it, the daily statistics carry a pack NAV and premium to packs for every product with known contents, and the Box NAV calculator can start from a real catalog product (packs, promo value and today's Market Price pre-filled, `?product=<id>` shareable) instead of from nothing.
- **Why now / value**: "x MSRP" and "price per pack" are the lingua franca of sealed investing and no page shows either (`research/competitive-landscape.md` §2 "Community norms": "x MSRP and price per pack are the lingua franca"; `research/ui-audit.md` `/product/[id]`: "No MSRP and no x times MSRP, the single most-used number in sealed-product investing"). WP31 (product decision page), WP33 (Value preset, Below pack value), WP30 (list column) and WP35 (MSRP alert suggestion) read these fields; landing the data path first lets them ship without inventing it.
- **Effort**: M, 12 to 14 hours (migration and DB tests 3 h, loader and template scripts with tests 3 h, server reads, `/prices` and calculator UI 4 h, methodology and definitions 1 h, fixture, verification and PR 2 h). Owner curation (D7) is separate: 3 to 5 hours.
- **Depends on**: WP06 (box recipes API, `BoxRecipe.currency`, `loadRecipeIntoState`, `copyState`/`shareStatus`), WP11 (`boosterPackData.ts`, server-fed `/box-calculator`, `revalidate_hook.py`, cache tags), WP21 (`pokefin_scraper`, replay harness, schema baseline, `load_supabase_readonly_credentials`), WP23 (tokens, `AsOf`, `SegmentedControl` currency control), WP24 (`/methodology`, `metricDefinitions.ts`, `PACK_VALUE_LABELS`, `packValueBandsText`, `#box-nav`), WP25 (`product_daily_stats`, `refresh_market_analytics`, `product_stats_latest`, `getCachedProductStats`, `fetchAllRows`, perf fixture `productStats`). Through them: WP07 (`format.ts`), WP13 (`productMeta.ts`), WP17 (`nav.ts`, blocking lint and tests), WP20 (`CurrencyProvider`, `app/types/market.ts`, `pnpm types:db`), WP22 (perf fixture and budgets). Soft: WP26 (card `sparkline` prop; the card edit works with or without it), WP27 (relabels the calculator's currency control "Recipe currency" and makes it follow the header; the catalog amounts follow either), WP30 (list rows; see step 12d).
- **Unblocks**: WP30 (x MSRP on list rows: `formatMsrpMultiple`, `initialMsrpMultiples`), WP31 (x MSRP, cost per pack, NAV with reason, "Open in Box NAV" through `boxCalculatorHref`, product release date), WP33 (Value preset and Below pack value from `premium_to_packs_pct`), WP34 (x MSRP column), WP35 (MSRP alert suggestion). WP32 lists per-product release dates as a follow-up; `product_catalog_attributes.release_date` is ready for it.
- **Placement**: after WP25, because it replaces `refresh_market_analytics` again. Reserves migration **0036** and keeps it if it merges out of order. It can merge before or after WP29: WP29's 0037 only calls `refresh_market_analytics` and does not redefine it (WP29 spec, Pitfalls: "0037 does not replace it; it only calls it"). No other Track 2 spec redefines the function; Before you start, check 2, stops the executor if one has. WP30, WP31, WP33, WP34 and WP35 read its fields softly and hide them when absent, so curation (D7) can lag without blocking them.
- **Suggested branch name**: `remediation/wp28-msrp-and-pack-contents`
- **Risk level**: medium. It replaces the SECURITY DEFINER refresh the scraper calls every run and adds a SECURITY DEFINER write function; both are contained by EXECUTE grants (`service_role` only for the write), an additive schema, a database test module that proves every gate and role, and a loader that writes nothing unless its input validates.

## Why

A collector looking at a booster box on Pokéfin today cannot see the two numbers the hobby prices everything in: how many times retail it trades at, and what one pack costs inside it. The Box NAV calculator makes every visitor type a recipe from scratch, even for a booster box whose contents never vary, and it prices packs silently from a variant when a set has no standard pack. The data to fix all three is small and static: MSRP, a product release date and pack contents for about 300 products, curated once (`research/data-opportunities.md` §4 items 2 to 4, "hours of curation"; §3.10 for the NAV rules). This package stores that curation (committed CSVs, an idempotent loader, no admin UI), adds x MSRP, cost per pack, pack NAV and premium to packs to the daily statistics under the same 14-day freshness gate as every other price-anchored number, shows x MSRP on `/prices`, and lets the calculator start from a catalog product with every field still editable. It serves both audiences in `01-PRODUCT-DIRECTION.md` §5 item 8 (sealed structure analytics) and feeds the product decision page (§5 item 1). No surveyed tracker shows an MSRP multiple beyond a partial niche tool, and per-pack normalisation lives only in single-purpose sites (`research/competitive-landscape.md` §3a rows "MSRP multiple" and "Per-pack normalisation"; §5 item 3, "Sealed structure analytics").

## Design

### Data model (migration `0036_product_attributes.sql`)

| Object | Definition |
|---|---|
| `products.msrp_usd numeric(10,2)` | US MSRP at launch. `CHECK > 0`. NULL: not recorded. |
| `products.msrp_cad numeric(10,2)` | Canadian MSRP at launch, reference only. `CHECK > 0`. |
| `products.msrp_source text` | Where the MSRP came from. At most 200 characters. Required when either MSRP is set (`products_msrp_has_source`). |
| `products.release_date date` | The product's own release date when it differs from its set's (Pokémon Center products, late collections). `>= 1996-01-01`. |
| `product_contents(product_id, pack_set_id, quantity, promo_value_usd)` | Booster packs inside a sealed product. PK `(product_id, pack_set_id)`, FK to `products` (cascade) and `sets`, `quantity > 0`, `promo_value_usd >= 0` or NULL. Index on `pack_set_id`. RLS on, SELECT for `anon`/`authenticated`, no write grant. |
| `product_daily_stats` + 5 columns | `msrp_multiple`, `cost_per_pack_usd`, `nav_usd`, `premium_to_packs_pct` (double precision) and `nav_status` (text, CHECK list). |
| `refresh_product_structure_stats(p_day)` | Internal step; fills the 5 columns for `p_day`. |
| `refresh_market_analytics(p_day)` | Replaced: FX step, stats step, then the structure step. Returns `structure_rows` as well. |
| `product_stats_latest` | Re-created (same query) so its `s.*` includes the new columns. |
| `product_catalog_attributes` (view) | One row per active product: MSRPs, source, `release_date` = product date else set date, `release_date_source` (`product`/`set`), `pack_count`. This is the "release date defaults to the set date in reads" rule, in one place. |
| `apply_product_attributes(p_attributes jsonb, p_contents jsonb, p_allow_clear_all boolean DEFAULT false)` | The loader's only write path. SECURITY DEFINER, EXECUTE for `service_role` only. Full sync in one transaction. |

### Metric definitions (per product per UTC day `D`, in `product_daily_stats`)

`price` below is the row's `usd_price`, which WP25 already sets to NULL unless `is_price_fresh` (migration 0023 rule: newest price at most 14 days old and agreeing with `products.usd_price`). Every column is NULL when `price` is NULL.

| Column | Formula | Edge cases |
|---|---|---|
| `msrp_multiple` | `price / msrp_usd` | NULL without a recorded US MSRP. Never estimated, never from `msrp_cad` (Market Price is a US marketplace price). |
| `cost_per_pack_usd` | `price / sum(quantity)` over the product's `product_contents` rows | NULL without recorded contents. Extras (promo cards, sleeves, dice) stay in the price. Needs no pack price, so a stale pack does not hide it. |
| `nav_usd` | `sum(quantity x pack_price(set)) + sum(promo_value_usd)` | Only when `nav_status = 'ok'`. |
| `premium_to_packs_pct` | `(price / nav_usd - 1) x 100` | Same sign convention as the calculator's premium (positive: dearer than its packs). |
| `nav_status` | first match of: no contents -> NULL; `price` NULL -> `box_price_withheld`; any set without exactly one active standard pack -> `no_standard_pack`; any standard pack with a NULL gated price on `D` -> `pack_price_withheld`; else `ok` | |

`pack_price(set)`: the `usd_price` on day `D` (already gated) of the set's standard booster pack: an active product of type `booster_pack` whose `variant` is NULL or blank. A variant pack (sleeved, Pokémon Center, Japanese) never prices a set (`research/data-opportunities.md` §3.10: "never price a pack from a variant silently"). A set with two active standard packs is ambiguous and also yields `no_standard_pack`. An inactive pack has no stats row and counts as withheld or missing the same way.

Worked example (the DB test's fixture): booster box at $198.00, US MSRP $143.64, 36 packs of a set whose standard pack is $5.00: x MSRP = 1.378 (printed "1.4x"), cost per pack = $5.50, NAV = $180.00, premium to packs = +10.0%, status `ok`. The same set's ETB at $60.00 with 9 packs and a $3.50 recorded promo: NAV = $48.50, premium +23.7%. An ETB whose pack was last priced 20 days ago: cost per pack $7.78, x MSRP shown, NAV `--` with "A pack inside has no current Market Price."

Performance: the structure step reads about 306 stats rows, 150 contents rows and 60 pack rows; measured 5.7 ms on a production-size scratch dataset (306 products, 600 days of prices), against 0.75 s for the whole refresh. WP25's 10 s budget test covers it because it calls the full refresh.

### Curation flow (no admin UI)

```
 scripts/make_attribute_template.py --write        (owner, once, then for new products)
      appends one row per missing product, rule defaults, reviewed=no
                     |
                     v
 data/product_attributes.csv  +  data/product_contents.csv    (committed; owner edits, sets reviewed=yes)
                     |
                     v
 scripts/load_product_attributes.py [--apply]     (owner; service key)
   validate files -> validate ids against the database -> print diff
   --apply: apply_product_attributes(...) -> refresh_market_analytics(today) -> WP11 revalidation
```

- The two CSVs are the whole truth. After `--apply`, a product without a reviewed row has no MSRP, no release date override and no contents. Rows with `reviewed=no` are skipped and counted, so a template guess never reaches the site.
- Columns. `product_attributes.csv`: `product_id,product_name,msrp_usd,msrp_cad,msrp_source,release_date,reviewed,notes`. `product_contents.csv`: `product_id,product_name,pack_set_id,pack_set_name,quantity,promo_value_usd,reviewed,notes`. `product_name`, `pack_set_name` and `notes` are for the human; the loader ignores them.
- Loader validation (exit 2, nothing written, on any failure): exact header; integer ids; `msrp_usd` 1.00 to 2000.00, `msrp_cad` 1.00 to 3000.00, at most 2 decimals; `msrp_source` required with an MSRP, at most 200 characters; `release_date` ISO, 1996-01-01 to today plus 366 days; `quantity` 1 to 100; `promo_value_usd` 0 to 1000.00 and on at most one row per product; `reviewed` is `yes` or `no`; no duplicate product (attributes) or product and set (contents); contents on a `booster_pack` product. Unknown product or set ids are reported and skipped (exit 1 and nothing written with `--strict`). An empty reviewed attribute set while MSRPs exist needs `--allow-clear-all` (the SQL function enforces it too).
- Template rules (defaults to verify, never facts): booster box 36 packs, booster bundle 6 packs, each with MSRP = packs x era pack MSRP (Scarlet & Violet $4.49; Sword & Shield, Sun & Moon, XY $3.99); Elite Trainer Box 9 packs (Scarlet & Violet, Mega Evolution) or 8 (Sword & Shield, Sun & Moon, XY), 10 for Sword & Shield and Sun & Moon special expansions, MSRP $49.99 (Scarlet & Violet) or $39.99 (older eras), none for Mega Evolution; a standard booster pack gets the era pack MSRP and no contents (x MSRP on single packs is the most quoted pack number); variants and every other type get no defaults. `msrp_source` is "template default, verify" until the owner replaces it.

### UI

The design system is WP23's: `text-*` type scale, `text-ink`/`text-ink-soft`, `border-line`, `bg-surface`, `rounded-card`/`rounded-control`, `bg-warn-fill`/`text-warn-text`, `AsOf`, `pointer-coarse:min-h-11`. Copy follows `01-PRODUCT-DIRECTION.md` §3.7: numbers before adjectives, "Market Price", no "live", no em dashes.

#### `/prices` card: x MSRP as a secondary figure

A caption line directly under the price, only when the product has a multiple. Nothing else on the card moves; products without an MSRP show no line (hidden, never estimated). The multiple is currency-neutral, so the USD/CAD toggle does not change it. Screen readers hear "1.4 times MSRP".

390 px (one column) and 1440 px (grid) use the same card anatomy:

```
+----------------------------+        +----------------------------+
| [img] Booster Box          |        | [img] Premium Collection   |
|       C$612.40   /\/\__/\  |        |       C$81.30     ______/  |
|       1.4x MSRP            |  <- caption, ink-soft, tabular     |
|       1M +4.2%             |        |       1M -1.1%             |   <- no MSRP recorded: no line
|       [Show full chart]    |        |       [Show full chart]    |
+----------------------------+        +----------------------------+
```

Stale product (price withheld by 0023): `msrp_multiple` is NULL, so no line; the card keeps WP26's "No history" and "Last priced" states.

#### `/box-calculator`: "Start from a product"

A new card between the currency control and the recipe name card. It renders only when at least one product has recorded contents; before curation (D7) the page looks exactly as today.

390 px, product picked from the catalog, everything fresh:

```
+------------------------------------+
| Pokéfin Tools                      |
| Collection Box NAV Calculator      |
| Pick a product or build a recipe   |
| for any collection box, and see... |
+------------------------------------+
| CURRENCY [ USD |#CAD#] 1 USD = 1.36|
+------------------------------------+
| Start from a product               |
| [Surging Sparks Booster Box     v] |  native select, 44 px, 16 px text
| Fills the packs, the recorded promo|
| value and today's Market Price.    |
| Every field stays editable.        |
| Market Price C$271.96 as of Sep 29 |
| · MSRP $161.64 USD · 1.2x MSRP     |
| · 36 packs                         |
+------------------------------------+
| [Surging Sparks Booster Box] [Save]|  recipe name card (WP06), name pre-filled
+------------------------------------+
| Booster Packs                      |
| Surging Sparks  C$6.80/pack  - 36 +|
+------------------------------------+
| Promo / Extras Value (CAD)  [    ] |
| Retail / Sticker Price (CAD)       |
| [C$ 271.96                      ]  |
| Cost per pack: C$7.55 across 36    |
| packs                              |
+------------------------------------+
| Above pack value    11.1% above NAV|  WP24 verdict block, neutral surface
| Below: 10% or more under NAV. Near:|  WP24 band thresholds, unchanged
| from 10% under to 5% over. Above:  |
| more than 5% over.                 |
| Screens describe past prices. ...  |
+------------------------------------+
```

1440 px: the same cards in the existing `max-w-4xl` column; the picker spans the card, and the summary line fits on one line.

```
+--------------------------------------------------------------------------------------+
| Start from a product                                                                 |
| [Surging Sparks Booster Box                                                       v] |
| Fills the packs, the recorded promo value and today's Market Price. Every field ...  |
| Market Price C$271.96 as of Sep 29 · MSRP $161.64 USD · 1.2x MSRP · 36 packs         |
+--------------------------------------------------------------------------------------+
```

States:

| State | What shows |
|---|---|
| No product has contents (before D7, or the attributes read failed) | No picker card. The read failure is logged (`server_product_attributes_failed`) and retried on the next render. |
| `?product=<id>` of a product with contents | Picker set to it; name, packs, promo and retail pre-filled on first render (no flash of an empty recipe). |
| `?product=<id>` unknown, not active, or without contents | Status line in a small card: "Product {id} has no recorded pack contents yet. Pick a product above or build the recipe by hand." A malformed value (`?product=abc`) is never echoed: "This link's product has no recorded pack contents yet. ..." |
| `?product=` and `?recipe=` together | The shared recipe wins (WP06 behaviour); the product is ignored. |
| Picked product's price withheld | Retail stays empty; the summary line reads, in warn text, "No current Market Price; last priced Sep 2, 2026. Enter the price you were quoted." |
| A pack in the recipe has no current price | Warn card: "NAV unavailable: no current Market Price for Evolving Skies (prices older than 14 days are hidden). A missing pack is never valued at $0." A set with no tracked pack at all reads "no booster pack tracked for {set}". |
| A set priced from a variant (no standard pack exists) | The pack row adds "priced from Sleeved pack" in caption text. |
| Currency switched after a pick (on the page, or in the header after WP27) | Retail and promo follow the currency until the user types in that field; the typed value then stays as typed (like a hand-built recipe). |

Interactions:

- Picking a product replaces the recipe (name, packs, promo, retail), clears the saved-recipe id and share state (a pick is a new, unsaved recipe) and writes `?product=<id>` with `history.replaceState` (no navigation, no request; the URL is shareable). "Build your own recipe" is the same as the New button, and removes `?product=`.
- Every field stays editable. Save and share are WP06's, unchanged: the saved recipe stores the retail and promo in the display currency, like a hand-built one.
- The verdict block and its band thresholds are WP24's (`PACK_VALUE_LABELS`, `packValueBandsText()`, `DecisionNote`); this package only verifies they render.
- Cost per pack shows under the retail input whenever a retail price and at least one pack exist, even when NAV is unavailable.

Accessibility: the select has a visible `<label>` and a hint tied with `aria-describedby`; the summary line is plain text after the select; the missing-link and NAV-unavailable messages are `role="status"`; the x MSRP caption has an `sr-only` sentence; no new colour-only cue (warn text always carries words). Touch target 44 px on coarse pointers; 16 px text on phones (no iOS zoom).

Performance: `/prices` sends a `product id -> multiple` map (about 150 numbers, under 1 kB br) instead of the stats snapshot; `MsrpMultiple` and `formatMsrpMultiple` add about 0.3 kB gz to the route. `/box-calculator` adds the picker (about 1 kB gz) and the catalog options in the RSC payload (about 150 entries, 4 to 6 kB br), no client fetch. No charting code and no new request on either route.

### Methodology (version bump, next minor after WP25's 1.1)

- New `#msrp` ("MSRP multiple") and `#cost-per-pack` ("Cost per pack"), directly before `#box-nav`.
- `#box-nav` gains the catalog NAV paragraph, a reason table (one row per `nav_status`, text from `NAV_STATUS_TEXT`) and the variant rule.
- `metricDefinitions.ts` gains `msrp`, `msrpMultiple`, `costPerPack`, `packNav`, `premiumToPacks`.

## Before you start

All paths are relative to the repo root unless they start with `app/`, `scripts/fixtures/` or another path under `frontend/` (then they are relative to `frontend/`).

Read in full:

- `audits/remediation/01-PRODUCT-DIRECTION.md` §2, §3, §5 item 8, §6, §8 (migration registry); `research/data-opportunities.md` §2 ("Gates every new metric must respect"), §3.10, §4 items 2 to 4, §5.
- `audits/remediation/WP25-market-analytics-foundation.md` steps 1, 2, 8, 9, 11, 13, 14 and Tests item 1 (the fixtures this package's DB test mirrors).
- `migrations/0033_product_daily_stats.sql` and `migrations/0034_fx_daily.sql` (WP25), `migrations/0023_price_freshness_guard.sql`, `migrations/0032_scraper_least_privilege_role.sql` (WP21), `verify_migration.py` (docstring), `scripts/db/replay_migrations.sh`, `revalidate_hook.py`, `secrets_loader.py`, `market_analytics.py`, `scripts/backfill_daily_stats.py`.
- `frontend/app/lib/serverMarketData.ts` (WP25's `fetchAllRows`, `PRODUCT_STATS_SELECT`, `getCachedProductStats`), `app/lib/marketStats.ts`, `app/types/market.ts`, `app/lib/currency.ts`, `app/lib/format.ts`, `app/lib/metricDefinitions.ts`, `app/content/methodology.ts`, `app/methodology/MethodologyArticle.tsx` and its test, `app/components/ui/AsOf.tsx`, `app/components/ui/README.md` (WP23).
- `app/components/BoxCalculator/BoxCalculator.tsx`, `nav.ts`, `types.ts`, `boosterPackData.ts`, `hooks/useBoosterBoxPrices.ts`, `__tests__/BoxCalculator.test.tsx`, `app/box-calculator/page.tsx`, `app/product/[id]/productMeta.ts`.
- `app/prices/page.tsx`, `app/components/ProductPrices/index.tsx`, `app/components/ProductPrices/cards/ProductCard.tsx` and the ProductCard tests under `app/components/ProductPrices/__tests__/`.
- `scripts/fixtures/perf.mjs` (WP22, WP25, WP26 additions), `perf-budgets.json`.

Confirm the starting state (repo root):

```bash
# 1. Migration number: 0036 is reserved for this package (01-PRODUCT-DIRECTION.md section 8).
ls migrations | grep -E '^0036_'                        # expect no output
ls migrations/0033_* migrations/0034_*                  # expect 2 files (WP25)

# 2. The newest definition of refresh_market_analytics is WP25's. WP29's 0037 and the
#    other Track 2 migrations only call it, so they do not show up here.
grep -lE "CREATE (OR REPLACE )?FUNCTION public\.refresh_market_analytics" migrations/*.sql | sort | tail -1
# expect: migrations/0034_fx_daily.sql

# 3. No trigger on products rewrites columns on every UPDATE (apply_product_attributes
#    updates products rows; a trigger that bumps last_updated would change the
#    scraper's due-products order and the "updated" dates the site prints).
grep -n "TRIGGER" migrations/0000_baseline.sql migrations/00*.sql | grep -i "ON public.products\b"   # expect no output
```

If check 2 prints a later file, stop and report it to the owner. Do not improvise: a migration numbered above 0036 that replaces `refresh_market_analytics` would run after 0036 in every replay and drop this package's step, and 0036 cannot be edited after merge. The owner's fix is to have that later migration copy 0036's function body; say so in your report. If check 3 prints a trigger, read its function: if it only reacts to `usd_price` (WP16's plausibility guard style), continue and name it in the PR; if it sets `last_updated` or any other column on every UPDATE, stop and report it.

```bash
# WP06 and WP11: recipe sharing state, server-fed calculator
grep -n "setRecipeSharing\|const \[copyState" frontend/app/components/BoxCalculator/BoxCalculator.tsx   # 2+ lines
grep -n "export function buildBoosterPackData" frontend/app/components/BoxCalculator/boosterPackData.ts # 1 line
grep -n "initialPackData" frontend/app/box-calculator/page.tsx                                        # 1+ lines
ls revalidate_hook.py                                                                                 # exists

# WP13: display name helpers
grep -n "export function getProductDisplayName\|export function getProductLabel" "frontend/app/product/[id]/productMeta.ts"  # 2 lines

# WP17: calculateNav in its own module
grep -n "export function calculateNav" frontend/app/components/BoxCalculator/nav.ts                   # 1 line

# WP20: currency context in the calculator
grep -n "useCurrencyConversion()" frontend/app/components/BoxCalculator/BoxCalculator.tsx             # 1 line
grep -n "export function convertUsd" frontend/app/lib/currency.ts                                     # 1 line
grep -n '"types:db"' frontend/package.json                                                            # 1 line

# WP21: replay harness, least-privilege role, read-only credentials
ls scripts/db/replay_migrations.sh migrations/0032_* migrations/0000_baseline.sql
grep -n "def load_supabase_readonly_credentials" secrets_loader.py                                    # 1 line

# WP22: budgets and fixture
grep -n '"/box-calculator"' frontend/perf-budgets.json                                                # 1 line

# WP23: tokens and AsOf
ls frontend/app/components/ui/AsOf.tsx
grep -n "\-\-pf-warn-fill\|\-\-pf-radius-card" frontend/app/globals.css                              # 2+ lines

# WP24: verdict labels and bands, methodology anchors, definitions
grep -n "packValueBandsText" frontend/app/components/BoxCalculator/BoxCalculator.tsx                  # 1+ lines
grep -n 'anchor: "box-nav"' frontend/app/content/methodology.ts                                       # 1 line
grep -n "export const METRIC_DEFINITIONS" frontend/app/lib/metricDefinitions.ts                       # 1 line

# WP25: stats read, pager, fixture rows, methodology version
grep -n "export async function getCachedProductStats\|const PRODUCT_STATS_SELECT\|async function fetchAllRows" frontend/app/lib/serverMarketData.ts   # 3 lines
grep -n '"/rest/v1/product_stats_latest": rows("productStats")' frontend/scripts/fixtures/perf.mjs     # 1 line
grep -n 'key: "distinctPrices365d"' frontend/app/lib/metricDefinitions.ts                             # 1 line
grep -n "export const STALE_ROW_WITHHELD_COLUMNS\|stats.is_price_fresh = false;" frontend/app/lib/marketStats.ts   # 2 lines (read-time gate, step 5c)
grep -n "METHODOLOGY_VERSION = \|METHODOLOGY_EFFECTIVE_DATE = " frontend/app/content/methodology.ts   # note both values

# Soft: WP30 may already render an x MSRP slot (its variant B copy of the formatter)
ls frontend/app/components/ProductPrices/shared/msrp.ts                                                # expect: no such file
grep -n "initialMsrpMultiples" frontend/app/components/ProductPrices/index.tsx                         # expect no output
```

If a hard check fails, stop and report which package is missing; this package extends their files and must not recreate them. Defaults for the soft cases:

- The WP30 checks find `shared/msrp.ts` and `initialMsrpMultiples`: WP30 merged first and already renders a multiple column and card detail line. Do steps 7, 8 and 12a as written, skip steps 12b and 12c, and do step 12d instead.
- `METHODOLOGY_VERSION` is not `"1.1"` (another package bumped it, for example WP29 merged first and set `"1.2"`): use the next minor version above the current one wherever this spec says `"1.2"`, and keep every other instruction.
- `load_supabase_readonly_credentials` is missing: stop (WP21 is missing). The template script falls back at runtime, but the dependency check guards the rest of WP21.

Tooling:

- Local Postgres for the database test, as in WP25: Docker (`docker run -d --name pokefin-replay -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17`) or the PostgreSQL 16 binaries on the dev container (`/usr/lib/postgresql/16/bin`). The SQL in this spec was applied twice in a row to a Supabase-shaped PostgreSQL 16.13 scratch database on top of WP25's 0033 and 0034 exactly as specified, and every case of the DB test (19) passed, twice in a row.
- A Python venv with `requirements.txt`, `pytest` and `psycopg[binary]` (WP21 added it).

Baseline, from `frontend/`: `pnpm exec tsc --noEmit` (exit 0), `pnpm lint` (0 errors), `pnpm test --ci` (all pass). From the repo root: `python -m pytest tests/ -q` (all pass; DB modules skip without `POKEFIN_TEST_DATABASE_URL`). Record the counts for the PR.

The work has two phases, like WP25. **Phase A** (steps 1 to 17) needs nothing from the owner; at its end open a draft PR titled `[waiting for DB types] feat: MSRP, pack contents, cost per pack and catalog box NAV (WP28)` and hand the owner Owner actions 1 and 2. **Phase B** (step 18) regenerates `frontend/app/types/database.ts` once 0036 is in production, then finishes the PR. In phase A, `tsc` fails on the new `.from("product_catalog_attributes")` and `.from("product_contents")` reads and on the new `product_stats_latest` columns until phase B; that is expected and the only allowed failure in phase A.

## Implementation steps

### Step 1. `migrations/0036_product_attributes.sql` (new)

Create the file with exactly this content:

```sql
-- Migration: MSRP, product release dates, pack contents, and the catalog
-- structure metrics in product_daily_stats: x MSRP, cost per pack, pack NAV
-- and premium to packs (WP28; research/data-opportunities.md sections 3.10
-- and 4 items 2 to 4).
--
-- Reference data. MSRP, the product release date and the pack contents are
-- curated by the owner in data/product_attributes.csv and
-- data/product_contents.csv and written only by
-- scripts/load_product_attributes.py through apply_product_attributes()
-- below (EXECUTE for service_role only). No API role can write them.
--
-- Rules (mirrored by frontend/app/lib/productAttributes.ts and documented on
-- /methodology#msrp, #cost-per-pack and #box-nav):
--   * A product without a recorded MSRP has no multiple. Nothing is estimated.
--   * msrp_multiple = Market Price / US MSRP. The multiple always uses the US
--     MSRP, because Market Price is a US marketplace price. msrp_cad is shown
--     for reference only.
--   * cost_per_pack_usd = Market Price / booster packs in the product.
--   * nav_usd = sum(quantity x Market Price of the set's standard booster
--     pack) + recorded promo value. Only a non-variant booster_pack product
--     prices a set; a variant is never used. NAV is computed only when the
--     product's own price and every pack price pass the freshness gate
--     (0023, via product_daily_stats.usd_price of the same day); otherwise it
--     is NULL and nav_status says why.
--   * premium_to_packs_pct = (Market Price / nav_usd - 1) x 100.
--   * Every price-anchored column is NULL when the product's price is
--     withheld, like the rest of product_daily_stats.
--
-- refresh_market_analytics (0033, 0034) is replaced to run the new step after
-- the per-product stats step, keeping every earlier call. Later packages that
-- replace it again must keep refresh_product_structure_stats(p_day) after
-- refresh_product_daily_stats(p_day). product_stats_latest is re-created so
-- its s.* picks up the new columns.
--
-- Idempotent. Safe to re-run.
--
-- Verification:
--   SELECT public.refresh_market_analytics((now() AT TIME ZONE 'UTC')::date);
--   -- No structure value without a fresh price (expect 0):
--   SELECT count(*) FROM public.product_daily_stats
--    WHERE NOT is_price_fresh
--      AND num_nonnulls(msrp_multiple, cost_per_pack_usd, nav_usd, premium_to_packs_pct) > 0;
--   -- NAV only with status ok (expect 0):
--   SELECT count(*) FROM public.product_daily_stats
--    WHERE (nav_usd IS NOT NULL) <> (nav_status IS NOT DISTINCT FROM 'ok');
--   -- anon cannot write the contents or load attributes (expect false, false):
--   SELECT has_table_privilege('anon', 'public.product_contents', 'INSERT'),
--          has_function_privilege('anon', 'public.apply_product_attributes(jsonb, jsonb, boolean)', 'EXECUTE');

-- ============================================================
-- 1. products: MSRP and product release date
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS msrp_usd numeric(10,2),
  ADD COLUMN IF NOT EXISTS msrp_cad numeric(10,2),
  ADD COLUMN IF NOT EXISTS msrp_source text,
  ADD COLUMN IF NOT EXISTS release_date date;

DO $$ BEGIN
  ALTER TABLE public.products
    ADD CONSTRAINT products_msrp_usd_positive CHECK (msrp_usd IS NULL OR msrp_usd > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.products
    ADD CONSTRAINT products_msrp_cad_positive CHECK (msrp_cad IS NULL OR msrp_cad > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.products
    ADD CONSTRAINT products_msrp_source_len CHECK (msrp_source IS NULL OR char_length(msrp_source) <= 200);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  -- A recorded MSRP names where it came from.
  ALTER TABLE public.products
    ADD CONSTRAINT products_msrp_has_source
      CHECK ((msrp_usd IS NULL AND msrp_cad IS NULL) OR msrp_source IS NOT NULL);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.products
    ADD CONSTRAINT products_release_date_sane CHECK (release_date IS NULL OR release_date >= DATE '1996-01-01');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- ============================================================
-- 2. product_contents: booster packs inside a sealed product
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_contents (
  product_id      bigint NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  pack_set_id     bigint NOT NULL REFERENCES public.sets(id),
  quantity        integer NOT NULL,
  promo_value_usd numeric(10,2),
  CONSTRAINT product_contents_pkey PRIMARY KEY (product_id, pack_set_id)
);

DO $$ BEGIN
  ALTER TABLE public.product_contents
    ADD CONSTRAINT product_contents_quantity_positive CHECK (quantity > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.product_contents
    ADD CONSTRAINT product_contents_promo_non_negative CHECK (promo_value_usd IS NULL OR promo_value_usd >= 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- The primary key covers product_id; this covers the sets foreign key.
CREATE INDEX IF NOT EXISTS product_contents_pack_set_id_idx
  ON public.product_contents (pack_set_id);

ALTER TABLE public.product_contents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY product_contents_read ON public.product_contents
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Supabase's default privileges give anon and authenticated ALL on new
-- tables, TRUNCATE included, which RLS does not stop. Keep SELECT only.
REVOKE ALL ON TABLE public.product_contents FROM anon, authenticated;
GRANT SELECT ON TABLE public.product_contents TO anon, authenticated;

-- ============================================================
-- 3. product_daily_stats: structure columns
-- ============================================================

ALTER TABLE public.product_daily_stats
  ADD COLUMN IF NOT EXISTS msrp_multiple        double precision,
  ADD COLUMN IF NOT EXISTS cost_per_pack_usd    double precision,
  ADD COLUMN IF NOT EXISTS nav_usd              double precision,
  ADD COLUMN IF NOT EXISTS premium_to_packs_pct double precision,
  ADD COLUMN IF NOT EXISTS nav_status           text;

DO $$ BEGIN
  -- NULL: no recorded contents. Keep in sync with NAV_STATUSES in
  -- frontend/app/lib/productAttributes.ts (drift-tested).
  ALTER TABLE public.product_daily_stats
    ADD CONSTRAINT product_daily_stats_nav_status_valid
      CHECK (nav_status IS NULL OR nav_status IN
             ('ok', 'box_price_withheld', 'no_standard_pack', 'pack_price_withheld'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- ============================================================
-- 4. The structure step (internal; called by the refresh below)
-- ============================================================

CREATE OR REPLACE FUNCTION public.refresh_product_structure_stats(p_day date)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  -- Runs after refresh_product_daily_stats(p_day): every active product has
  -- its row for p_day, with usd_price already NULL unless fresh (0023).
  WITH std_pack AS (
    -- The standard booster pack of each set: active, product type
    -- booster_pack, no variant. Its price is that day's gated price.
    SELECT p.set_id,
           count(*) AS n_std,
           max(s.usd_price) AS pack_usd
      FROM public.products p
      JOIN public.product_types t ON t.id = p.product_type_id AND t.name = 'booster_pack'
      LEFT JOIN public.product_daily_stats s ON s.product_id = p.id AND s.day = p_day
     WHERE p.active = true
       AND NULLIF(btrim(p.variant), '') IS NULL
       AND p.set_id IS NOT NULL
     GROUP BY p.set_id
  ),
  per_product AS (
    SELECT c.product_id,
           sum(c.quantity) AS pack_count,
           sum(c.quantity * sp.pack_usd) AS packs_usd,
           COALESCE(sum(c.promo_value_usd), 0)::double precision AS promo_usd,
           -- Exactly one standard pack per set, or the set cannot be priced.
           bool_or(sp.n_std IS DISTINCT FROM 1) AS missing_std,
           bool_or(sp.n_std = 1 AND sp.pack_usd IS NULL) AS pack_withheld
      FROM public.product_contents c
      LEFT JOIN std_pack sp ON sp.set_id = c.pack_set_id
     GROUP BY c.product_id
  ),
  computed AS (
    SELECT s.product_id,
           CASE WHEN s.usd_price > 0 AND p.msrp_usd > 0
                THEN s.usd_price / p.msrp_usd::double precision END AS msrp_multiple,
           CASE WHEN s.usd_price > 0 AND pp.pack_count > 0
                THEN s.usd_price / pp.pack_count END AS cost_per_pack_usd,
           CASE WHEN pp.product_id IS NULL THEN NULL
                WHEN s.usd_price IS NULL THEN 'box_price_withheld'
                WHEN pp.missing_std THEN 'no_standard_pack'
                WHEN pp.pack_withheld THEN 'pack_price_withheld'
                ELSE 'ok' END AS nav_status,
           pp.packs_usd + pp.promo_usd AS nav_candidate
      FROM public.product_daily_stats s
      JOIN public.products p ON p.id = s.product_id
      LEFT JOIN per_product pp ON pp.product_id = s.product_id
     WHERE s.day = p_day
  ),
  final AS (
    SELECT c.product_id, c.msrp_multiple, c.cost_per_pack_usd, c.nav_status,
           CASE WHEN c.nav_status = 'ok' THEN c.nav_candidate END AS nav_usd
      FROM computed c
  )
  UPDATE public.product_daily_stats t
     SET msrp_multiple = f.msrp_multiple,
         cost_per_pack_usd = f.cost_per_pack_usd,
         nav_usd = f.nav_usd,
         premium_to_packs_pct = CASE WHEN f.nav_usd > 0
                                     THEN (t.usd_price / f.nav_usd - 1) * 100 END,
         nav_status = f.nav_status
    FROM final f
   WHERE t.day = p_day
     AND t.product_id = f.product_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_product_structure_stats(date) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 5. refresh_market_analytics with the structure step (replaces 0034's body)
-- ============================================================

CREATE OR REPLACE FUNCTION public.refresh_market_analytics(p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_fx integer;
  v_stats integer;
  v_structure integer;
BEGIN
  IF p_day IS NULL OR p_day > v_today OR p_day < DATE '2020-01-01' THEN
    RAISE EXCEPTION 'refresh_market_analytics: p_day must be between 2020-01-01 and % (UTC), got %',
      v_today, p_day USING ERRCODE = '22023';
  END IF;

  -- One refresh at a time (the scraper and the nightly job can overlap).
  PERFORM pg_advisory_xact_lock(hashtext('pokefin.refresh_market_analytics'));

  v_fx := public.refresh_fx_daily(p_day);
  v_stats := public.refresh_product_daily_stats(p_day);
  -- WP28: x MSRP, cost per pack and pack NAV, from the rows just written.
  v_structure := public.refresh_product_structure_stats(p_day);

  RETURN jsonb_build_object(
    'day', p_day,
    'fx_rows', v_fx,
    'product_rows', v_stats,
    'structure_rows', v_structure,
    'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_market_analytics(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_market_analytics(date) TO service_role, pokefin_scraper;

-- ============================================================
-- 6. Read paths
-- ============================================================

-- Same definition as 0033. Re-created so s.* includes the new columns (a
-- view's column list is fixed when it is created); they are appended last.
CREATE OR REPLACE VIEW public.product_stats_latest
WITH (security_invoker = true)
AS
SELECT s.*
  FROM public.product_daily_stats s
  JOIN public.products p ON p.id = s.product_id AND p.active = true
 WHERE s.day = (SELECT max(d.day) FROM public.product_daily_stats d);

REVOKE ALL ON TABLE public.product_stats_latest FROM anon, authenticated;
GRANT SELECT ON TABLE public.product_stats_latest TO anon, authenticated;

-- One row per active product: its curated attributes, the release date
-- readers should use (the product's own, else its set's) and its pack count.
CREATE OR REPLACE VIEW public.product_catalog_attributes
WITH (security_invoker = true)
AS
SELECT p.id AS product_id,
       p.msrp_usd,
       p.msrp_cad,
       p.msrp_source,
       COALESCE(p.release_date, st.release_date) AS release_date,
       CASE WHEN p.release_date IS NOT NULL THEN 'product'
            WHEN st.release_date IS NOT NULL THEN 'set' END AS release_date_source,
       (SELECT sum(c.quantity)::integer
          FROM public.product_contents c
         WHERE c.product_id = p.id) AS pack_count
  FROM public.products p
  LEFT JOIN public.sets st ON st.id = p.set_id
 WHERE p.active = true;

REVOKE ALL ON TABLE public.product_catalog_attributes FROM anon, authenticated;
GRANT SELECT ON TABLE public.product_catalog_attributes TO anon, authenticated;

-- ============================================================
-- 7. The loader's write path
-- ============================================================

-- Replaces every product's MSRP, MSRP source and release date, and the whole
-- product_contents table, with the reviewed CSV rows, in one transaction.
-- A product absent from p_attributes ends with NULL attributes; a contents
-- row absent from p_contents is deleted. p_allow_clear_all must be true to
-- apply an empty p_attributes while MSRPs exist (guards against a truncated
-- CSV). SECURITY DEFINER so the caller needs no table privilege; EXECUTE is
-- granted to service_role only (scripts/load_product_attributes.py).
CREATE OR REPLACE FUNCTION public.apply_product_attributes(
  p_attributes jsonb,
  p_contents jsonb,
  p_allow_clear_all boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bad text;
  v_attr_changed integer;
  v_deleted integer;
  v_upserted integer;
BEGIN
  IF jsonb_typeof(p_attributes) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_contents) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'apply_product_attributes: p_attributes and p_contents must be JSON arrays'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_attributes) = 0 AND NOT p_allow_clear_all
     AND EXISTS (SELECT 1 FROM public.products WHERE msrp_usd IS NOT NULL) THEN
    RAISE EXCEPTION 'apply_product_attributes: empty p_attributes would clear every MSRP; pass p_allow_clear_all => true to do that'
      USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(COALESCE(d.product_id::text, 'null'), ', ') INTO v_bad
    FROM (SELECT a.product_id
            FROM jsonb_to_recordset(p_attributes)
           AS a(product_id bigint, msrp_usd numeric, msrp_cad numeric, msrp_source text, release_date date)
           GROUP BY a.product_id HAVING count(*) > 1 OR a.product_id IS NULL) d;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'apply_product_attributes: duplicate or missing product_id in p_attributes: %', v_bad
      USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(COALESCE(d.product_id::text, 'null') || '/' || COALESCE(d.pack_set_id::text, 'null'), ', ') INTO v_bad
    FROM (SELECT c.product_id, c.pack_set_id
            FROM jsonb_to_recordset(p_contents)
           AS c(product_id bigint, pack_set_id bigint, quantity integer, promo_value_usd numeric)
           GROUP BY 1, 2
          HAVING count(*) > 1 OR c.product_id IS NULL OR c.pack_set_id IS NULL) d;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'apply_product_attributes: duplicate product/set in p_contents: %', v_bad
      USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(DISTINCT x.product_id::text, ', ') INTO v_bad
    FROM (SELECT a.product_id FROM jsonb_to_recordset(p_attributes)
           AS a(product_id bigint, msrp_usd numeric, msrp_cad numeric, msrp_source text, release_date date)
          UNION ALL
          SELECT c.product_id FROM jsonb_to_recordset(p_contents)
           AS c(product_id bigint, pack_set_id bigint, quantity integer, promo_value_usd numeric)) x
   WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = x.product_id);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'apply_product_attributes: unknown product ids: %', v_bad USING ERRCODE = '23503';
  END IF;

  SELECT string_agg(DISTINCT c.pack_set_id::text, ', ') INTO v_bad
    FROM jsonb_to_recordset(p_contents)
           AS c(product_id bigint, pack_set_id bigint, quantity integer, promo_value_usd numeric)
   WHERE NOT EXISTS (SELECT 1 FROM public.sets s WHERE s.id = c.pack_set_id);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'apply_product_attributes: unknown set ids: %', v_bad USING ERRCODE = '23503';
  END IF;

  -- Attributes: listed products take the CSV values, every other product is
  -- cleared. Only rows that change are written.
  UPDATE public.products p
     SET msrp_usd = a.msrp_usd,
         msrp_cad = a.msrp_cad,
         msrp_source = a.msrp_source,
         release_date = a.release_date
    FROM (SELECT pr.id, x.msrp_usd, x.msrp_cad, x.msrp_source, x.release_date
            FROM public.products pr
            LEFT JOIN jsonb_to_recordset(p_attributes)
           AS x(product_id bigint, msrp_usd numeric, msrp_cad numeric, msrp_source text, release_date date)
                   ON x.product_id = pr.id) a
   WHERE p.id = a.id
     AND (p.msrp_usd, p.msrp_cad, p.msrp_source, p.release_date)
         IS DISTINCT FROM (a.msrp_usd::numeric(10,2), a.msrp_cad::numeric(10,2), a.msrp_source, a.release_date);
  GET DIAGNOSTICS v_attr_changed = ROW_COUNT;

  DELETE FROM public.product_contents pc
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(p_contents)
           AS c(product_id bigint, pack_set_id bigint, quantity integer, promo_value_usd numeric)
                      WHERE c.product_id = pc.product_id AND c.pack_set_id = pc.pack_set_id);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.product_contents AS pc (product_id, pack_set_id, quantity, promo_value_usd)
  SELECT c.product_id, c.pack_set_id, c.quantity, c.promo_value_usd
    FROM jsonb_to_recordset(p_contents)
           AS c(product_id bigint, pack_set_id bigint, quantity integer, promo_value_usd numeric)
  ON CONFLICT (product_id, pack_set_id) DO UPDATE
     SET quantity = EXCLUDED.quantity,
         promo_value_usd = EXCLUDED.promo_value_usd
   WHERE (pc.quantity, pc.promo_value_usd) IS DISTINCT FROM (EXCLUDED.quantity, EXCLUDED.promo_value_usd);
  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'attributes_changed', v_attr_changed,
    'contents_deleted', v_deleted,
    'contents_written', v_upserted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_product_attributes(jsonb, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_product_attributes(jsonb, jsonb, boolean) TO service_role;
```

Check it (repo root):

```bash
python3 verify_migration.py migrations/0036_product_attributes.sql > /tmp/wp28_0036.sql; echo "exit=$?"
# expect exit=3 and on stderr:
#   -- function refresh_product_structure_stats(p_day date): body <md5>, ..., security invoker, plpgsql, ..., config search_path=public,pg_temp
#   -- function refresh_market_analytics(p_day date): body <md5>, ..., security definer, ...
#   -- function apply_product_attributes(p_attributes jsonb, p_contents jsonb, p_allow_clear_all boolean): body <md5>, ..., security definer, ...
#   -- index product_contents_pack_set_id_idx on product_contents: using btree pack_set_id
#   54 "-- privilege" lines (14 each on product_contents, product_stats_latest and
#     product_catalog_attributes; EXECUTE revoked for public, anon, authenticated on the three
#     functions; EXECUTE granted to service_role and pokefin_scraper on refresh_market_analytics
#     and to service_role on apply_product_attributes)
#   -- rls public.product_contents: enabled
#   -- NOT VERIFIED (out of scope, check by hand): 2 x ALTER TABLE (other than RLS enablement), 1 x CREATE (table/type/etc), 2 x CREATE VIEW, 9 x DO block
grep -c "^-- privilege" <(python3 verify_migration.py migrations/0036_product_attributes.sql 2>&1 >/dev/null)   # 54
```

With the file copied verbatim the three body hashes are `af76b02b8c6b787089fb8128840aa68e` (`refresh_product_structure_stats`), `15d9ade57a450fd11bd1dfd52d362b91` (`refresh_market_analytics`) and `5a67186d788f8906e8db3eeed0ade5e6` (`apply_product_attributes`). Any edit changes them; what matters is that the generated query returns only OK rows after apply. After 0036 is applied, the 0033 and 0034 queries each report one `MISMATCH` (`refresh_market_analytics`, body): 0036 superseded them. That is the expected cross-file result.

Replay locally (WP21 harness):

```bash
PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh
# expect "OK: <N> files replayed once (replay_once) and twice (replay_twice)", N one more than before
```

`scripts/db/replay_migrations.sh` needs no edit: it picks up `NNNN_*.sql` files by name.

### Step 2. `data/product_attributes.csv` and `data/product_contents.csv` (new, header only)

The owner fills them (Owner action 3). Commit them with the header row only, each ending with a newline:

`data/product_attributes.csv`:

```
product_id,product_name,msrp_usd,msrp_cad,msrp_source,release_date,reviewed,notes
```

`data/product_contents.csv`:

```
product_id,product_name,pack_set_id,pack_set_name,quantity,promo_value_usd,reviewed,notes
```

Do not put guessed rows in them: MSRPs and contents are the owner's curation (decision D7), and the template script in step 4 generates the starting rows from the production catalog.

### Step 3. `scripts/load_product_attributes.py` (new)

`chmod +x` it. It imports `supabase`, `secrets_loader` and `revalidate_hook` only inside the functions that need them, so its tests need none of them.

```python
#!/usr/bin/env python3
"""
Load the owner-curated MSRP, release dates and pack contents (WP28).

Reads data/product_attributes.csv and data/product_contents.csv, validates
every row, and writes the reviewed rows through
public.apply_product_attributes (migration 0036) in one transaction. The two
files are the whole truth: after --apply, a product without a reviewed row
has no MSRP, no release date override and no contents.

  python scripts/load_product_attributes.py            # validate against the database, print the diff, write nothing
  python scripts/load_product_attributes.py --apply    # write, refresh today's stats, revalidate the site
  python scripts/load_product_attributes.py --check    # offline: validate the files only (CI)

Exit codes: 0 done; 1 unknown product or set ids with --strict; 2 invalid
rows or files (nothing written).

Rows with reviewed=no are skipped and counted, so the template's guesses
never reach the site unreviewed. Uses the service key: a one-off admin tool,
like generate_skus.py (WP21).
"""

from __future__ import annotations

import argparse
import csv
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

ATTRIBUTES_CSV = ROOT / "data" / "product_attributes.csv"
CONTENTS_CSV = ROOT / "data" / "product_contents.csv"

ATTRIBUTE_COLUMNS = [
    "product_id", "product_name", "msrp_usd", "msrp_cad", "msrp_source",
    "release_date", "reviewed", "notes",
]
CONTENT_COLUMNS = [
    "product_id", "product_name", "pack_set_id", "pack_set_name", "quantity",
    "promo_value_usd", "reviewed", "notes",
]

# Bounds. Anything outside is a typo, not a product: the dearest tracked
# sealed product retails well under these.
MSRP_USD_MIN, MSRP_USD_MAX = Decimal("1.00"), Decimal("2000.00")
MSRP_CAD_MIN, MSRP_CAD_MAX = Decimal("1.00"), Decimal("3000.00")
PROMO_USD_MAX = Decimal("1000.00")
QUANTITY_MIN, QUANTITY_MAX = 1, 100
MSRP_SOURCE_MAX_LEN = 200  # products_msrp_source_len (0036)
RELEASE_DATE_MIN = date(1996, 1, 1)  # products_release_date_sane (0036)
RELEASE_DATE_MAX_AHEAD_DAYS = 366
PACK_TYPE_NAME = "booster_pack"


class CsvFileError(Exception):
    """A file that cannot be read as the expected CSV (missing, wrong header)."""


@dataclass(frozen=True)
class AttributeRow:
    line: int
    product_id: int
    msrp_usd: Decimal | None
    msrp_cad: Decimal | None
    msrp_source: str | None
    release_date: date | None
    reviewed: bool


@dataclass(frozen=True)
class ContentRow:
    line: int
    product_id: int
    pack_set_id: int
    quantity: int
    promo_value_usd: Decimal | None
    reviewed: bool


@dataclass(frozen=True)
class Catalog:
    """What the database knows: product id -> (type name, set id), set ids."""
    products: dict[int, tuple[str | None, int | None]]
    set_ids: frozenset[int]


def read_csv(path: Path, columns: list[str]) -> list[tuple[int, dict[str, str]]]:
    """(line number, row) pairs. The header must be exactly `columns`."""
    if not path.exists():
        raise CsvFileError(f"{path.name}: file not found")
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != columns:
            raise CsvFileError(f"{path.name}: header must be {','.join(columns)}, got {','.join(reader.fieldnames or [])}")
        return [(n, row) for n, row in enumerate(reader, start=2)
                if any((v or "").strip() for v in row.values())]


def _cell(row: dict[str, str], key: str) -> str | None:
    value = (row.get(key) or "").strip()
    return value or None


def _money(raw: str | None, label: str, low: Decimal, high: Decimal, errors: list[str], where: str) -> Decimal | None:
    if raw is None:
        return None
    try:
        value = Decimal(raw)
    except InvalidOperation:
        errors.append(f"{where}: {label} {raw!r} is not a number")
        return None
    if not value.is_finite() or value.as_tuple().exponent < -2:
        errors.append(f"{where}: {label} {raw!r} must have at most 2 decimals")
        return None
    if not low <= value <= high:
        errors.append(f"{where}: {label} {raw} is outside {low} to {high}")
        return None
    return value


def _int(raw: str | None, label: str, errors: list[str], where: str) -> int | None:
    if raw is None:
        errors.append(f"{where}: {label} is required")
        return None
    try:
        return int(raw)
    except ValueError:
        errors.append(f"{where}: {label} {raw!r} is not a whole number")
        return None


def _reviewed(raw: str | None, errors: list[str], where: str) -> bool:
    value = (raw or "").lower()
    if value not in ("yes", "no"):
        errors.append(f"{where}: reviewed must be yes or no, got {raw!r}")
    return value == "yes"


def parse_attributes(rows, today: date) -> tuple[list[AttributeRow], list[str]]:
    out: list[AttributeRow] = []
    errors: list[str] = []
    seen: dict[int, int] = {}
    for line, row in rows:
        where = f"product_attributes.csv line {line}"
        before = len(errors)
        product_id = _int(_cell(row, "product_id"), "product_id", errors, where)
        msrp_usd = _money(_cell(row, "msrp_usd"), "msrp_usd", MSRP_USD_MIN, MSRP_USD_MAX, errors, where)
        msrp_cad = _money(_cell(row, "msrp_cad"), "msrp_cad", MSRP_CAD_MIN, MSRP_CAD_MAX, errors, where)
        source = _cell(row, "msrp_source")
        if (msrp_usd is not None or msrp_cad is not None) and source is None:
            errors.append(f"{where}: msrp_source is required when an MSRP is given")
        if source is not None and len(source) > MSRP_SOURCE_MAX_LEN:
            errors.append(f"{where}: msrp_source is longer than {MSRP_SOURCE_MAX_LEN} characters")
        release_raw = _cell(row, "release_date")
        release = None
        if release_raw is not None:
            try:
                release = date.fromisoformat(release_raw)
            except ValueError:
                errors.append(f"{where}: release_date {release_raw!r} is not YYYY-MM-DD")
            else:
                if not RELEASE_DATE_MIN <= release <= today + timedelta(days=RELEASE_DATE_MAX_AHEAD_DAYS):
                    errors.append(f"{where}: release_date {release_raw} is out of range")
        reviewed = _reviewed(_cell(row, "reviewed"), errors, where)
        if product_id is not None:
            if product_id in seen:
                errors.append(f"{where}: product_id {product_id} repeats line {seen[product_id]}")
            seen[product_id] = line
        if len(errors) == before and product_id is not None:
            out.append(AttributeRow(line, product_id, msrp_usd, msrp_cad, source, release, reviewed))
    return out, errors


def parse_contents(rows) -> tuple[list[ContentRow], list[str]]:
    out: list[ContentRow] = []
    errors: list[str] = []
    seen: dict[tuple[int, int], int] = {}
    promo_line: dict[int, int] = {}
    for line, row in rows:
        where = f"product_contents.csv line {line}"
        before = len(errors)
        product_id = _int(_cell(row, "product_id"), "product_id", errors, where)
        pack_set_id = _int(_cell(row, "pack_set_id"), "pack_set_id", errors, where)
        quantity = _int(_cell(row, "quantity"), "quantity", errors, where)
        if quantity is not None and not QUANTITY_MIN <= quantity <= QUANTITY_MAX:
            errors.append(f"{where}: quantity {quantity} is outside {QUANTITY_MIN} to {QUANTITY_MAX}")
        promo = _money(_cell(row, "promo_value_usd"), "promo_value_usd", Decimal("0"), PROMO_USD_MAX, errors, where)
        reviewed = _reviewed(_cell(row, "reviewed"), errors, where)
        if product_id is not None and pack_set_id is not None:
            key = (product_id, pack_set_id)
            if key in seen:
                errors.append(f"{where}: product {product_id} and set {pack_set_id} repeat line {seen[key]}")
            seen[key] = line
        if promo is not None and product_id is not None:
            # One promo value per product, on one of its rows.
            if product_id in promo_line:
                errors.append(f"{where}: product {product_id} already has promo_value_usd on line {promo_line[product_id]}")
            promo_line[product_id] = line
        if len(errors) == before:
            out.append(ContentRow(line, product_id, pack_set_id, quantity, promo, reviewed))
    return out, errors


def check_catalog(attributes, contents, catalog: Catalog):
    """
    Split reviewed rows into known and unknown against the database.
    Returns (known attributes, known contents, unknown messages, errors).
    Contents on a booster pack product are an error: a pack holds no packs.
    """
    unknown: list[str] = []
    errors: list[str] = []
    known_attributes = []
    for row in attributes:
        if row.product_id not in catalog.products:
            unknown.append(f"product_attributes.csv line {row.line}: unknown product_id {row.product_id}")
        else:
            known_attributes.append(row)
    known_contents = []
    for row in contents:
        where = f"product_contents.csv line {row.line}"
        if row.product_id not in catalog.products:
            unknown.append(f"{where}: unknown product_id {row.product_id}")
            continue
        if row.pack_set_id not in catalog.set_ids:
            unknown.append(f"{where}: unknown pack_set_id {row.pack_set_id}")
            continue
        type_name, _ = catalog.products[row.product_id]
        if type_name == PACK_TYPE_NAME:
            errors.append(f"{where}: product {row.product_id} is a booster pack; packs have no contents")
            continue
        known_contents.append(row)
    return known_attributes, known_contents, unknown, errors


def _money_json(value: Decimal | None) -> str | None:
    return None if value is None else format(value, "f")


def build_payload(attributes, contents) -> tuple[list[dict], list[dict]]:
    """JSON arrays for apply_product_attributes. Only reviewed rows."""
    attribute_payload = [
        {
            "product_id": r.product_id,
            "msrp_usd": _money_json(r.msrp_usd),
            "msrp_cad": _money_json(r.msrp_cad),
            "msrp_source": r.msrp_source,
            "release_date": r.release_date.isoformat() if r.release_date else None,
        }
        for r in attributes if r.reviewed
    ]
    content_payload = [
        {
            "product_id": r.product_id,
            "pack_set_id": r.pack_set_id,
            "quantity": r.quantity,
            "promo_value_usd": _money_json(r.promo_value_usd),
        }
        for r in contents if r.reviewed
    ]
    return attribute_payload, content_payload


def load_files(today: date, attributes_path: Path = ATTRIBUTES_CSV, contents_path: Path = CONTENTS_CSV):
    """(attribute rows, content rows, errors). File errors are returned, not raised."""
    try:
        attribute_rows = read_csv(attributes_path, ATTRIBUTE_COLUMNS)
        content_rows = read_csv(contents_path, CONTENT_COLUMNS)
    except CsvFileError as e:
        return [], [], [str(e)]
    attributes, attribute_errors = parse_attributes(attribute_rows, today)
    contents, content_errors = parse_contents(content_rows)
    return attributes, contents, attribute_errors + content_errors


def _fetch_all(client, table: str, columns: str) -> list[dict]:
    rows: list[dict] = []
    start = 0
    while True:
        batch = client.table(table).select(columns).order("id").range(start, start + 999).execute().data or []
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        start += 1000


def fetch_catalog(client) -> Catalog:
    products = _fetch_all(client, "products", "id, set_id, product_types(name)")
    sets = _fetch_all(client, "sets", "id")
    return Catalog(
        products={int(p["id"]): ((p.get("product_types") or {}).get("name"), p.get("set_id")) for p in products},
        set_ids=frozenset(int(s["id"]) for s in sets),
    )


def fetch_current(client) -> tuple[int, int]:
    """(products with an MSRP, contents rows) now in the database."""
    with_msrp = client.table("products").select("id", count="exact").not_.is_("msrp_usd", "null").limit(1).execute()
    contents = client.table("product_contents").select("product_id", count="exact").limit(1).execute()
    return with_msrp.count or 0, contents.count or 0


def open_service_client():
    from secrets_loader import load_supabase_credentials
    from supabase import create_client

    url, key = load_supabase_credentials()
    return create_client(url, key)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="write the reviewed rows")
    mode.add_argument("--check", action="store_true", help="validate the files only; no database")
    parser.add_argument("--attributes", type=Path, default=ATTRIBUTES_CSV, help="attributes CSV path")
    parser.add_argument("--contents", type=Path, default=CONTENTS_CSV, help="contents CSV path")
    parser.add_argument("--strict", action="store_true", help="unknown product or set ids are fatal")
    parser.add_argument("--allow-clear-all", action="store_true",
                        help="allow applying zero reviewed attribute rows (clears every MSRP)")
    return parser.parse_args(argv)


def main(argv=None, *, client=None, today: date | None = None, revalidate=None) -> int:
    args = parse_args(argv)
    today = today or datetime.now(timezone.utc).date()
    attributes, contents, errors = load_files(today, args.attributes, args.contents)
    pending = sum(not r.reviewed for r in attributes) + sum(not r.reviewed for r in contents)
    if errors:
        print(f"{len(errors)} invalid rows; nothing written:", file=sys.stderr)
        for message in errors:
            print(f"  {message}", file=sys.stderr)
        return 2
    reviewed_attributes = [r for r in attributes if r.reviewed]
    reviewed_contents = [r for r in contents if r.reviewed]
    print(f"Files OK: {len(reviewed_attributes)} reviewed attribute rows, "
          f"{len(reviewed_contents)} reviewed contents rows, {pending} rows pending review.")
    if args.check:
        return 0

    client = client or open_service_client()
    known_attributes, known_contents, unknown, catalog_errors = check_catalog(
        reviewed_attributes, reviewed_contents, fetch_catalog(client))
    if catalog_errors:
        print(f"{len(catalog_errors)} invalid rows; nothing written:", file=sys.stderr)
        for message in catalog_errors:
            print(f"  {message}", file=sys.stderr)
        return 2
    for message in unknown:
        print(f"UNKNOWN {message}", file=sys.stderr)
    if unknown and args.strict:
        print("Unknown ids with --strict; nothing written.", file=sys.stderr)
        return 1

    attribute_payload, content_payload = build_payload(known_attributes, known_contents)
    msrp_now, contents_now = fetch_current(client)
    msrp_next = sum(1 for a in attribute_payload if a["msrp_usd"] is not None)
    print(f"Products with an MSRP: {msrp_now} now, {msrp_next} after apply.")
    print(f"Contents rows: {contents_now} now, {len(content_payload)} after apply.")
    if not args.apply:
        print("Dry run: nothing written. Re-run with --apply.")
        return 0

    result = client.rpc("apply_product_attributes", {
        "p_attributes": attribute_payload,
        "p_contents": content_payload,
        "p_allow_clear_all": bool(args.allow_clear_all),
    }).execute().data
    print(f"Applied: {result}")
    refreshed = client.rpc("refresh_market_analytics", {"p_day": today.isoformat()}).execute().data
    print(f"Market analytics refreshed for {today}: {refreshed}")
    if revalidate is None:
        from revalidate_hook import trigger_site_revalidation as revalidate
    print("Site caches revalidated." if revalidate() else
          "Site revalidation skipped or failed; pages refresh within a day (WP11 backstop).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Notes:

- The service key is required: `apply_product_attributes` is granted to `service_role` only, and the scraper role must not write reference data (WP21's least-privilege rule). `generate_skus.py` and the backfills use the same key the same way.
- `refresh_market_analytics(today)` makes the new values visible in `product_stats_latest` at once; the site then revalidates through WP11's hook. Without `REVALIDATE_URL`, pages pick the values up at the daily backstop.
- Money travels as decimal strings (`"143.64"`) so no float rounding reaches `numeric(10,2)`; `jsonb_to_recordset` parses them into `numeric`.

### Step 4. `scripts/make_attribute_template.py` (new)

`chmod +x` it.

```python
#!/usr/bin/env python3
"""
Starter rows for data/product_attributes.csv and data/product_contents.csv (WP28).

Reads the active products and appends one attribute row per product that the
files do not list yet (standard booster packs included, for their x MSRP),
plus contents rows for the formulaic types (booster box, booster bundle,
Elite Trainer Box), with rule-based defaults by era.
Every generated row has reviewed=no: the loader ignores it until the owner
checks it against the product's listing or announcement, corrects it and
sets reviewed=yes. Existing rows are never changed.

  python scripts/make_attribute_template.py            # print what would be appended
  python scripts/make_attribute_template.py --write    # append to the two files

Reads public data only (publishable key when set, like the weekly report).
"""

from __future__ import annotations

import argparse
import csv
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from load_product_attributes import (  # noqa: E402
    ATTRIBUTE_COLUMNS,
    ATTRIBUTES_CSV,
    CONTENT_COLUMNS,
    CONTENTS_CSV,
    PACK_TYPE_NAME,
)

# Defaults to CHECK, not facts: verify each against the product's listing or
# launch announcement before setting reviewed=yes. Keys are lower-case
# generation names with "and" written as "&".
PACK_MSRP_USD = {
    "scarlet & violet": Decimal("4.49"),
    "sword & shield": Decimal("3.99"),
    "sun & moon": Decimal("3.99"),
    "xy": Decimal("3.99"),
}
ETB_MSRP_USD = {
    "scarlet & violet": Decimal("49.99"),
    "sword & shield": Decimal("39.99"),
    "sun & moon": Decimal("39.99"),
    "xy": Decimal("39.99"),
}
ETB_PACKS = {"mega evolution": 9, "scarlet & violet": 9, "sword & shield": 8, "sun & moon": 8, "xy": 8}
# Special expansions of these eras shipped 10-pack ETBs (Hidden Fates,
# Champion's Path, Shining Fates, Celebrations, Pokemon GO, Crown Zenith).
ETB_SPECIAL_PACKS = {"sword & shield": 10, "sun & moon": 10}
FIXED_PACKS = {"booster_box": 36, "booster_bundle": 6}
ETB_TYPE = "elite_trainer_box"
TEMPLATE_SOURCE = "template default, verify"


def era_key(generation_name: str | None) -> str:
    return (generation_name or "").strip().lower().replace(" and ", " & ")


def display_name(product: dict) -> str:
    set_name = (product.get("sets") or {}).get("name") or "Unknown Set"
    type_label = (product.get("product_types") or {}).get("label") or (product.get("product_types") or {}).get("name") or "Unknown Product"
    variant = f" ({product['variant']})" if product.get("variant") else ""
    return f"{set_name} {type_label}{variant}"


def default_rows(product: dict, pack_sets: set[int]) -> tuple[dict, list[dict]]:
    """(attribute row, contents rows) with the rule defaults for one product."""
    sets = product.get("sets") or {}
    type_name = (product.get("product_types") or {}).get("name")
    era = era_key(((sets.get("generations") or {}).get("name")))
    special = sets.get("expansion_type") == "Special Expansion"
    name = display_name(product)
    notes: list[str] = []

    packs = None
    msrp = None
    if type_name in FIXED_PACKS and not product.get("variant"):
        packs = FIXED_PACKS[type_name]
        if era in PACK_MSRP_USD:
            msrp = PACK_MSRP_USD[era] * packs
        notes.append(f"{type_name}: {packs} packs, MSRP = {packs} x era pack MSRP")
    elif type_name == ETB_TYPE and not product.get("variant"):
        packs = ETB_SPECIAL_PACKS.get(era) if special else None
        packs = packs or ETB_PACKS.get(era)
        msrp = ETB_MSRP_USD.get(era)
        notes.append(f"ETB, era {era or 'unknown'}{', special expansion' if special else ''}")
    elif type_name == PACK_TYPE_NAME and not product.get("variant"):
        # A pack holds no packs: an MSRP default only, never contents.
        msrp = PACK_MSRP_USD.get(era)
        notes.append(f"booster pack, era {era or 'unknown'}")
    else:
        notes.append("no rule: fill MSRP and contents by hand, or leave blank")

    attribute = {
        "product_id": product["id"],
        "product_name": name,
        "msrp_usd": "" if msrp is None else format(msrp, "f"),
        "msrp_cad": "",
        "msrp_source": TEMPLATE_SOURCE if msrp is not None else "",
        "release_date": "",
        "reviewed": "no",
        "notes": "; ".join(notes),
    }
    contents: list[dict] = []
    set_id = product.get("set_id")
    if packs is not None and set_id is not None:
        contents.append({
            "product_id": product["id"],
            "product_name": name,
            "pack_set_id": set_id,
            "pack_set_name": sets.get("name") or "",
            "quantity": packs,
            "promo_value_usd": "",
            "reviewed": "no",
            "notes": "" if set_id in pack_sets else "no standard booster pack tracked for this set: NAV will be unavailable",
        })
    return attribute, contents


def existing_ids(path: Path, column: str = "product_id") -> set[int]:
    if not path.exists():
        return set()
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return {int(r[column]) for r in csv.DictReader(handle) if (r.get(column) or "").strip().isdigit()}


def plan(products: list[dict], attributes_path: Path, contents_path: Path):
    """Rows to append: products missing from each file, newest set first. Packs get no contents rows."""
    pack_sets = {
        p["set_id"] for p in products
        if (p.get("product_types") or {}).get("name") == PACK_TYPE_NAME and not p.get("variant")
    }
    listed_attributes = existing_ids(attributes_path)
    listed_contents = existing_ids(contents_path)
    ordered = sorted(
        products,
        key=lambda p: ((p.get("sets") or {}).get("release_date") or "", p["id"]),
        reverse=True,
    )
    new_attributes, new_contents = [], []
    for product in ordered:
        attribute, contents = default_rows(product, pack_sets)
        if product["id"] not in listed_attributes:
            new_attributes.append(attribute)
        if product["id"] not in listed_contents:
            new_contents.extend(contents)
    return new_attributes, new_contents


def append_rows(path: Path, columns: list[str], rows: list[dict]) -> None:
    write_header = not path.exists() or path.stat().st_size == 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, lineterminator="\n")
        if write_header:
            writer.writeheader()
        writer.writerows(rows)


def fetch_products(client) -> list[dict]:
    rows: list[dict] = []
    start = 0
    while True:
        batch = (
            client.table("products")
            .select("id, variant, set_id, sets(name, release_date, expansion_type, generations(name)), product_types(name, label)")
            .eq("active", True)
            .order("id")
            .range(start, start + 999)
            .execute()
            .data
            or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        start += 1000


def open_readonly_client():
    from supabase import create_client

    try:
        from secrets_loader import load_supabase_readonly_credentials as load
    except ImportError:  # before WP21
        from secrets_loader import load_supabase_credentials as load
    url, key = load()
    return create_client(url, key)


def main(argv=None, *, client=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--write", action="store_true", help="append the rows to the two files")
    args = parser.parse_args(argv)
    products = fetch_products(client or open_readonly_client())
    new_attributes, new_contents = plan(products, ATTRIBUTES_CSV, CONTENTS_CSV)
    print(f"{len(products)} active products; {len(new_attributes)} attribute rows and "
          f"{len(new_contents)} contents rows to append (all reviewed=no).")
    if not args.write:
        for row in new_attributes[:10]:
            print(f"  {row['product_id']} {row['product_name']}: msrp {row['msrp_usd'] or '-'} ({row['notes']})")
        print("Dry run: nothing written. Re-run with --write.")
        return 0
    append_rows(ATTRIBUTES_CSV, ATTRIBUTE_COLUMNS, new_attributes)
    append_rows(CONTENTS_CSV, CONTENT_COLUMNS, new_contents)
    print(f"Appended to {ATTRIBUTES_CSV.relative_to(ROOT)} and {CONTENTS_CSV.relative_to(ROOT)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

The era table holds defaults for the owner to check, not facts. Do not add rules for collections, tins or blisters: their contents vary and a wrong default is worse than a blank.

### Step 5. `frontend/app/types/market.ts`: attribute types and the new stats columns

5a. In `interface ProductDailyStats` (WP25), add after `liquidity_score: number | null;`:

```ts
  /** WP28 (migration 0036): Market Price / US MSRP. */
  msrp_multiple: number | null;
  /** WP28: Market Price / booster packs in the product. */
  cost_per_pack_usd: number | null;
  /** WP28: pack NAV in USD, set only when nav_status is "ok". */
  nav_usd: number | null;
  /** WP28: (Market Price / nav_usd - 1) x 100. */
  premium_to_packs_pct: number | null;
  /** WP28: one of NAV_STATUSES (lib/productAttributes.ts); null without recorded contents. */
  nav_status: string | null;
```

`nav_status` stays `string | null` because the generated view type is `string`; readers narrow it with `isNavStatus`.

The five fields are required, so `tsc` flags any existing test or fixture that builds a complete `ProductDailyStats` literal (WP25's `marketStats.test.ts` full row, WP29's or WP33's fixtures if they merged first). In WP25's "full row" (every column non-null) add `msrp_multiple: 1.4, cost_per_pack_usd: 5.5, nav_usd: 180, premium_to_packs_pct: 10, nav_status: "ok"` so it stays full; in every other literal add the five fields as `null`. Change nothing else in those files.

5b. Append at the end of the file:

```ts
// ---- WP28: product attributes (migration 0036) ----

/** One product_catalog_attributes row: curated MSRP, release date and pack count. */
export interface ProductCatalogAttributes {
  product_id: number;
  /** US MSRP at launch; null when not recorded (never estimated). */
  msrp_usd: number | null;
  /** Canadian MSRP at launch, reference only. */
  msrp_cad: number | null;
  msrp_source: string | null;
  /** YYYY-MM-DD: the product's own release date, else its set's. */
  release_date: string | null;
  release_date_source: "product" | "set" | null;
  /** Booster packs in the product; null without recorded contents. */
  pack_count: number | null;
}

/** One product_contents row: packs of one set inside a sealed product. */
export interface ProductContentRow {
  product_id: number;
  pack_set_id: number;
  quantity: number;
  promo_value_usd: number | null;
}
```

5c. `frontend/app/lib/marketStats.ts` (WP25): the read-time staleness gate must cover the new columns. WP25 evaluates every gate as of the row's own day and re-checks the row's age at read time; its comment on `STALE_ROW_WITHHELD_COLUMNS` says "A later package that adds such a column to product_daily_stats adds it here too". Without this edit, a scraper and nightly job that both stop would leave "1.4x MSRP", a cost per pack and a NAV on screen indefinitely, which breaks the 0023 rule.

- Append to `STALE_ROW_WITHHELD_COLUMNS`, after `"liquidity_score",`:

```ts
  // WP28 (0036): anchored on the product's current price and its packs' prices.
  "msrp_multiple",
  "cost_per_pack_usd",
  "nav_usd",
  "premium_to_packs_pct",
```

- In `toProductStatsSnapshot`, inside the stale branch, directly after `stats.is_price_fresh = false;`, add:

```ts
      // WP28: a product with recorded contents keeps a reason, never a bare
      // NULL (NULL means "no recorded contents"). Its price is withheld now.
      if (typeof stats.nav_status === "string") stats.nav_status = "box_price_withheld";
```

`typeof` rather than `!== null`: a row read without the column (an older fixture) has `undefined` there and must stay as it is. The `satisfies readonly (keyof ProductDailyStats)[]` clause type-checks the four names against step 5a.

### Step 6. `frontend/app/lib/productAttributes.ts` (new)

```ts
/**
 * MSRP, pack contents and the catalog structure metrics (migration 0036,
 * WP28): status copy, formatting and the read helpers pages use.
 *
 * NAV_STATUSES mirrors the product_daily_stats_nav_status_valid CHECK in
 * 0036 and is drift-tested (productAttributesConstants.test.ts); change both
 * together and bump METHODOLOGY_VERSION. Isomorphic: no React, no Supabase.
 */
import type { ProductCatalogAttributes, ProductContentRow } from "../types/market";
import type { ProductStatsSnapshot } from "./marketStats";

/** Why product_daily_stats.nav_usd is or is not set. NULL in the table: no recorded contents. */
export const NAV_STATUSES = ["ok", "box_price_withheld", "no_standard_pack", "pack_price_withheld"] as const;
export type NavStatus = (typeof NAV_STATUSES)[number];

/** One sentence per status, for /methodology#box-nav and a "--" reason. */
export const NAV_STATUS_TEXT: Readonly<Record<NavStatus, string>> = {
  ok: "The product and every pack inside it have a current Market Price.",
  box_price_withheld: "The product itself has no current Market Price.",
  no_standard_pack: "A set inside has no standard booster pack tracked, and variants are never used.",
  pack_price_withheld: "A pack inside has no current Market Price.",
};

export function isNavStatus(value: unknown): value is NavStatus {
  return typeof value === "string" && (NAV_STATUSES as readonly string[]).includes(value);
}

/** Curated attributes and contents of every active product, keyed by product id. */
export interface ProductAttributesSnapshot {
  byProductId: Record<number, ProductCatalogAttributes>;
  contentsByProductId: Record<number, ProductContentRow[]>;
}

export const EMPTY_PRODUCT_ATTRIBUTES: ProductAttributesSnapshot = { byProductId: {}, contentsByProductId: {} };

/** Rows as PostgREST returns them: generated view types mark every column nullable. */
export type ProductCatalogAttributesRow = {
  [K in keyof ProductCatalogAttributes]: ProductCatalogAttributes[K] | string | null;
};
export type ProductContentDbRow = { [K in keyof ProductContentRow]: ProductContentRow[K] | string | null };

function finiteOrNull(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function toProductAttributesSnapshot(
  attributeRows: readonly ProductCatalogAttributesRow[],
  contentRows: readonly ProductContentDbRow[]
): ProductAttributesSnapshot {
  const byProductId: Record<number, ProductCatalogAttributes> = {};
  for (const row of attributeRows) {
    if (typeof row?.product_id !== "number") continue;
    byProductId[row.product_id] = {
      product_id: row.product_id,
      msrp_usd: finiteOrNull(row.msrp_usd),
      msrp_cad: finiteOrNull(row.msrp_cad),
      msrp_source: typeof row.msrp_source === "string" ? row.msrp_source : null,
      release_date: typeof row.release_date === "string" ? row.release_date : null,
      release_date_source:
        row.release_date_source === "product" || row.release_date_source === "set" ? row.release_date_source : null,
      pack_count: finiteOrNull(row.pack_count),
    };
  }
  const contentsByProductId: Record<number, ProductContentRow[]> = {};
  for (const row of contentRows) {
    const quantity = finiteOrNull(row?.quantity);
    if (typeof row?.product_id !== "number" || typeof row.pack_set_id !== "number" || quantity === null || quantity <= 0) {
      continue;
    }
    (contentsByProductId[row.product_id] ??= []).push({
      product_id: row.product_id,
      pack_set_id: row.pack_set_id,
      quantity,
      promo_value_usd: finiteOrNull(row.promo_value_usd),
    });
  }
  return { byProductId, contentsByProductId };
}

const MULTIPLE_ONE_DECIMAL = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MULTIPLE_WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * x MSRP as printed: 1.378 -> "1.4x", 0.94 -> "0.9x", 12.6 -> "13x".
 * null for a missing or non-positive value: the caller hides the figure.
 */
export function formatMsrpMultiple(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return null;
  return `${(value < 9.95 ? MULTIPLE_ONE_DECIMAL : MULTIPLE_WHOLE).format(value)}x`;
}

/**
 * product id -> x MSRP, only for products that have one, rounded to 3
 * decimals. This, not the stats snapshot, is what /prices sends to the browser.
 *
 * `pricedIds`: the products the page shows with a current Market Price. The
 * stats row and the catalog summary apply the same 14-day gate but at
 * different moments, so near the cutoff they can disagree for a few hours; a
 * product the page shows as withheld never gets a multiple beside it.
 */
export function msrpMultiplesById(
  snapshot: ProductStatsSnapshot,
  pricedIds?: ReadonlySet<number>
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const row of Object.values(snapshot.byProductId)) {
    const value = row.msrp_multiple;
    if (pricedIds && !pricedIds.has(row.product_id)) continue;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      out[row.product_id] = Math.round(value * 1000) / 1000;
    }
  }
  return out;
}

/** The calculator started from a catalog product (WP31's "Open in Box NAV"). */
export function boxCalculatorHref(productId: number): string {
  return `/box-calculator?product=${productId}`;
}
```

### Step 7. `frontend/app/lib/serverMarketData.ts`: the new stats columns and the attributes read

7a. Extend WP25's `PRODUCT_STATS_SELECT`: replace its last line

```ts
  qty_change_7d_pct, qty_change_30d_pct, liquidity_score, refreshed_at`;
```

with

```ts
  qty_change_7d_pct, qty_change_30d_pct, liquidity_score, refreshed_at,
  msrp_multiple, cost_per_pack_usd, nav_usd, premium_to_packs_pct, nav_status`;
```

(If a later package already appended columns, append these five after them, keeping one template literal.)

7b. Imports, next to WP25's `./marketStats` import:

```ts
import {
  EMPTY_PRODUCT_ATTRIBUTES,
  toProductAttributesSnapshot,
  type ProductAttributesSnapshot,
  type ProductCatalogAttributesRow,
  type ProductContentDbRow,
} from "./productAttributes";
```

7c. Directly below WP25's `fetchFxDaily` function, add:

```ts
/** Columns of product_catalog_attributes (migration 0036). Listed, not "*". */
const PRODUCT_ATTRIBUTES_SELECT = `product_id, msrp_usd, msrp_cad, msrp_source,
  release_date, release_date_source, pack_count`;

/**
 * Curated MSRP, release date and pack contents of every active product
 * (WP28): two indexed reads of small tables (about 306 and 150 rows).
 */
async function fetchProductAttributes(): Promise<ProductAttributesSnapshot> {
  const supabase = createMarketDataSupabaseClient();
  const [attributeRows, contentRows] = await Promise.all([
    fetchAllRows<ProductCatalogAttributesRow>("product_catalog_attributes", (from, to) =>
      supabase
        .from("product_catalog_attributes")
        .select(PRODUCT_ATTRIBUTES_SELECT)
        .order("product_id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<ProductContentDbRow>("product_contents", (from, to) =>
      supabase
        .from("product_contents")
        .select("product_id, pack_set_id, quantity, promo_value_usd")
        .order("product_id", { ascending: true })
        .order("pack_set_id", { ascending: true })
        .range(from, to)
    ),
  ]);
  return toProductAttributesSnapshot(attributeRows, contentRows);
}
```

If `tsc` (phase B) rejects the explicit type arguments because the generated row type is not assignable (for example a view column typed `string` where the row type expects a narrower union), drop the type argument and annotate the variable instead (`const attributeRows: ProductCatalogAttributesRow[] = ...`), as WP25 does; do not cast the client to `any`.

7d. At the end of the cached-exports block, after WP25's `getCachedFxDaily`, add:

```ts
const getCachedProductAttributesSnapshot = unstable_cache(
  fetchProductAttributes,
  ["product-attributes"],
  {
    revalidate: DAILY_BACKSTOP_SECONDS,
    tags: [CACHE_TAGS.marketProducts],
  }
);

/**
 * Curated attributes and pack contents (WP28). The loader triggers WP11's
 * revalidation after it writes, so the marketProducts tag refreshes this. On
 * a failed read returns EMPTY_PRODUCT_ATTRIBUTES, uncached: callers hide the
 * picker and MSRP lines rather than show a guess.
 */
export async function getCachedProductAttributes(): Promise<ProductAttributesSnapshot> {
  try {
    return await getCachedProductAttributesSnapshot();
  } catch (error) {
    logCaughtError("server_product_attributes_failed", error);
    return EMPTY_PRODUCT_ATTRIBUTES;
  }
}
```

Do not call it from another cached function's callback (WP11's nested-cache rule).

### Step 8. `frontend/app/components/ui/MsrpMultiple.tsx` (new)

```tsx
import { formatMsrpMultiple } from "../../lib/productAttributes";

/**
 * "1.4x MSRP" as a secondary figure (WP28). Renders nothing without a
 * multiple: a missing MSRP is hidden, never estimated. Server-compatible,
 * token classes only.
 */
export default function MsrpMultiple({
  value,
  className = "",
}: {
  value: number | null | undefined;
  className?: string;
}) {
  const text = formatMsrpMultiple(value);
  if (text === null) return null;
  return (
    <span className={`text-caption tabular-nums text-ink-soft ${className}`.trim()} title="Market Price divided by US MSRP">
      <span aria-hidden="true">{text} MSRP</span>
      <span className="sr-only">{`${text.slice(0, -1)} times MSRP`}</span>
    </span>
  );
}
```

Add one line to WP23's `app/components/ui/README.md` component list: "`MsrpMultiple`: x MSRP caption (`value` from `product_daily_stats.msrp_multiple`); renders nothing when absent. WP28."

### Step 9. Box calculator: catalog options (three new files)

9a. `frontend/app/components/BoxCalculator/catalogPrefill.ts` (browser-safe helpers and the option type):

```ts
/**
 * Catalog products the Box NAV calculator can start from (WP28), and the
 * helpers that turn one into a recipe. Pure and tiny: BoxCalculator imports
 * it into the browser bundle. The server-side builder is catalogOptions.ts.
 */
import { convertUsd } from "../../lib/currency";
import type { Currency } from "../../types/market";
import type { PackEntry } from "./types";

export interface CatalogBoxOption {
  productId: number;
  /** "Surging Sparks Booster Box (Pokemon Center)". */
  name: string;
  /** Product type label, for the picker's groups. */
  typeLabel: string;
  /** YYYY-MM-DD: the product's own release date, else its set's. null when neither is known. */
  releaseDate: string | null;
  /** Guarded Market Price (0023). null: withheld, never a number to show. */
  usdPrice: number | null;
  /** YYYY-MM-DD of the newest price row, kept when the price is withheld. */
  pricedOn: string | null;
  msrpUsd: number | null;
  msrpCad: number | null;
  /** Recorded promo value in USD, null when none is recorded. */
  promoValueUsd: number | null;
  packs: Array<{ setId: number; setName: string; quantity: number }>;
}

/** The option's packs as recipe rows. Stable ids, so re-picking the same product keeps the rows. */
export function packsFromOption(option: CatalogBoxOption): PackEntry[] {
  return option.packs.map((pack) => ({
    id: `catalog-${option.productId}-${pack.setId}`,
    setId: pack.setId,
    setName: pack.setName,
    quantity: pack.quantity,
  }));
}

/** A USD amount in `currency`, rounded to cents, the way the calculator's inputs hold money. */
export function amountIn(usd: number, currency: Currency, rate: number): number {
  return Math.round(convertUsd(usd, currency, rate) * 100) / 100;
}

/** ?product=<id> as a product id; null for anything but a positive integer. */
export function parseProductParam(raw: string | null | undefined): number | null {
  if (!raw || !/^[1-9]\d{0,11}$/.test(raw)) return null;
  return Number(raw);
}

export function findCatalogOption(
  options: readonly CatalogBoxOption[],
  productId: number | null
): CatalogBoxOption | null {
  if (productId === null) return null;
  return options.find((option) => option.productId === productId) ?? null;
}

/** Total booster packs in a recipe. */
export function packCount(packs: readonly PackEntry[]): number {
  return packs.reduce((sum, pack) => sum + pack.quantity, 0);
}

/** Price per pack in the price's own currency; null without a price or packs. */
export function costPerPack(retailPrice: number, packs: readonly PackEntry[]): number | null {
  const count = packCount(packs);
  return retailPrice > 0 && count > 0 ? retailPrice / count : null;
}
```

9b. `frontend/app/components/BoxCalculator/catalogOptions.ts` (server builder; the page imports it, the client never does):

```ts
/**
 * Server-side builder for the Box NAV calculator's product picker (WP28).
 * box-calculator/page.tsx calls it once per cache refresh; only the options
 * (about 150 products with recorded contents) reach the browser.
 */
import { recordedAtDateKey } from "../../lib/format";
import type { ProductAttributesSnapshot } from "../../lib/productAttributes";
import { getProductDisplayName, getProductLabel } from "../../product/[id]/productMeta";
import type { Product } from "../../types/market";
import type { CatalogBoxOption } from "./catalogPrefill";
import type { SetOption } from "./types";

export function buildCatalogBoxOptions(
  products: readonly Product[],
  attributes: ProductAttributesSnapshot,
  packSets: readonly SetOption[]
): CatalogBoxOption[] {
  // Pack set names: the calculator's own set list first (sets with a booster
  // pack), then any product's set, so a name never depends on pack pricing.
  const setNames = new Map<number, string>();
  for (const set of packSets) setNames.set(set.id, set.name);
  for (const product of products) {
    const set = product.sets;
    if (set?.id !== undefined && !setNames.has(set.id)) setNames.set(set.id, set.name);
  }

  const options: CatalogBoxOption[] = [];
  for (const product of products) {
    const contents = attributes.contentsByProductId[product.id];
    if (!contents || contents.length === 0) continue;
    const attrs = attributes.byProductId[product.id];
    const promoValueUsd = contents.reduce<number | null>(
      (sum, row) => (row.promo_value_usd === null ? sum : (sum ?? 0) + row.promo_value_usd),
      null
    );
    options.push({
      productId: product.id,
      name: getProductDisplayName(product),
      typeLabel: getProductLabel(product),
      releaseDate: attrs?.release_date || product.sets?.release_date || null,
      usdPrice: typeof product.usd_price === "number" && product.usd_price > 0 ? product.usd_price : null,
      pricedOn: recordedAtDateKey(product.price_recorded_at ?? null),
      msrpUsd: attrs?.msrp_usd ?? null,
      msrpCad: attrs?.msrp_cad ?? null,
      promoValueUsd,
      packs: contents
        .map((row) => ({
          setId: row.pack_set_id,
          setName: setNames.get(row.pack_set_id) ?? `Set ${row.pack_set_id}`,
          quantity: row.quantity,
        }))
        .sort((a, b) => b.quantity - a.quantity || a.setName.localeCompare(b.setName)),
    });
  }
  // Newest first, like the set picker; ties by name.
  return options.sort(
    (a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") || a.name.localeCompare(b.name)
  );
}
```

9c. `frontend/app/components/BoxCalculator/ProductPicker.tsx`:

```tsx
"use client";

import { useId } from "react";
import { formatDateOnly, formatInteger, formatMoney } from "../../lib/format";
import { formatMsrpMultiple } from "../../lib/productAttributes";
import AsOf from "../ui/AsOf";
import type { CatalogBoxOption } from "./catalogPrefill";

interface ProductPickerProps {
  /** Products with recorded pack contents, newest first (catalogOptions.ts). */
  options: readonly CatalogBoxOption[];
  /** The product the recipe started from, or null for a hand-built recipe. */
  value: number | null;
  onChange: (productId: number | null) => void;
}

/** Options grouped by product type label (groups A to Z), keeping each group's newest-first order. */
export function groupCatalogOptions(options: readonly CatalogBoxOption[]): Array<[string, CatalogBoxOption[]]> {
  const groups = new Map<string, CatalogBoxOption[]>();
  for (const option of options) {
    const group = groups.get(option.typeLabel);
    if (group) group.push(option);
    else groups.set(option.typeLabel, [option]);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * "Start from a product" (WP28). A native select: one thumb on a phone,
 * type-to-find on a desktop, no extra script. Choosing the first option
 * starts a blank recipe.
 */
export default function ProductPicker({ options, value, onChange }: ProductPickerProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-small font-medium text-ink">
        Start from a product
      </label>
      <select
        id={id}
        value={value === null ? "" : String(value)}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
        aria-describedby={`${id}-hint`}
        className="mt-1 w-full rounded-control border border-line bg-surface px-3 py-2 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action md:text-body pointer-coarse:min-h-11"
      >
        <option value="">Build your own recipe</option>
        {groupCatalogOptions(options).map(([label, group]) => (
          <optgroup key={label} label={label}>
            {group.map((option) => (
              <option key={option.productId} value={option.productId}>
                {option.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p id={`${id}-hint`} className="mt-1 text-caption text-ink-soft">
        Fills the packs, the recorded promo value and today&apos;s Market Price. Every field stays editable.
      </p>
    </div>
  );
}

/**
 * One line under the picker: the picked product's Market Price with its
 * as-of date, MSRP, x MSRP and pack count. A withheld price says so and asks
 * for the quoted price instead of showing a number.
 */
export function CatalogProductSummary({
  option,
  formatPrice,
}: {
  option: CatalogBoxOption;
  /** useCurrencyConversion().formatPrice: a USD amount in the display currency. */
  formatPrice: (usd: number | null | undefined) => string;
}) {
  const packs = option.packs.reduce((sum, pack) => sum + pack.quantity, 0);
  const multiple =
    option.usdPrice !== null && option.msrpUsd !== null ? formatMsrpMultiple(option.usdPrice / option.msrpUsd) : null;
  return (
    <p className="mt-3 text-small tabular-nums text-ink-soft">
      {option.usdPrice !== null ? (
        <>
          Market Price <span className="font-medium text-ink">{formatPrice(option.usdPrice)}</span>
          {option.pricedOn && (
            <>
              {" "}
              <AsOf date={option.pricedOn} />
            </>
          )}
        </>
      ) : (
        <span className="text-warn-text">
          No current Market Price{option.pricedOn ? `; last priced ${formatDateOnly(option.pricedOn)}` : ""}. Enter
          the price you were quoted.
        </span>
      )}
      {option.msrpUsd !== null && (
        <>
          {" · "}MSRP {formatMoney(option.msrpUsd, "USD")} USD
          {option.msrpCad !== null && ` (${formatMoney(option.msrpCad, "CAD")})`}
        </>
      )}
      {multiple !== null && <>{` · ${multiple} MSRP`}</>}
      {` · ${formatInteger(packs)} ${packs === 1 ? "pack" : "packs"}`}
    </p>
  );
}
```

These three files were type-checked with `tsc --strict` against stand-ins of WP07's `format.ts`, WP13's `productMeta.ts`, WP20's `currency.ts` and WP23's `AsOf`; if a real signature differs (for example `formatMoney` takes an options object third), adapt the call, not the design.

### Step 10. `frontend/app/components/BoxCalculator/hooks/useBoosterBoxPrices.ts`: the variant a set was priced from

Directly after the `getPackPrice` `useCallback` (leave it unchanged), add:

```ts
  // WP28: the variant getPackPrice priced a set from, or null when it used
  // the standard pack (or found no price). The calculator labels that row,
  // so a variant price is never used silently (data-opportunities.md 3.10).
  // Mirrors getPackPrice's choice exactly: the first cheapest priced variant.
  const getPackVariant = useCallback(
    (setId: number): string | null => {
      const matches = boosterPackPrices.filter((p) => p.setId === setId);
      if (matches.length === 0 || matches.some((p) => !p.variant)) return null;
      let cheapest: BoosterPackPrice | null = null;
      for (const p of matches) {
        if (p.usdPrice === null) continue;
        if (cheapest === null || cheapest.usdPrice === null || p.usdPrice < cheapest.usdPrice) cheapest = p;
      }
      return cheapest?.variant ?? null;
    },
    [boosterPackPrices]
  );
```

and add `getPackVariant` to the hook's return object: `return { boosterPackPrices, sets, loading, getPackPrice, getPackVariant };` (keep any other returned names).

Then update every test that mocks this hook so the mock returns the new function: `grep -rln "useBoosterPackPrices: () =>" app --include=*.test.tsx` (at least WP06's `BoxCalculator.test.tsx`). In each mock object add `getPackVariant: () => null`. Change nothing else in those tests.

### Step 11. `frontend/app/components/BoxCalculator/BoxCalculator.tsx`

Locate every edit by the quoted code; WP06, WP07, WP11, WP14, WP15, WP17, WP20, WP23 and WP24 have all edited this file.

11a. Imports. Add:

```ts
import ProductPicker, { CatalogProductSummary } from "./ProductPicker";
import {
  amountIn,
  costPerPack,
  findCatalogOption,
  packCount,
  packsFromOption,
  parseProductParam,
  type CatalogBoxOption,
} from "./catalogPrefill";
import { PRICE_STALENESS_TOLERANCE_DAYS } from "../../lib/marketPulse";
```

Extend the existing `../../lib/format` import (WP07) with `formatInteger` and `formatMoney` if they are not already in it; do not add a second import of that module. Change `useBoosterPackPrices(initialPackData)`'s destructure to also take `getPackVariant`.

11b. Props. In `type BoxCalculatorProps` add:

```ts
  /** Catalog products with recorded pack contents (WP28), built on the server. */
  catalogBoxes?: readonly CatalogBoxOption[];
```

Above the component add `const NO_CATALOG_BOXES: readonly CatalogBoxOption[] = [];` and destructure `catalogBoxes = NO_CATALOG_BOXES` in the signature next to `initialPackData`.

11c. Initial catalog product. Directly above the `// Recipe state` comment (after every hook call that the recipe state follows, and after `const searchParams = useSearchParams();`), add:

```ts
  // WP28: ?product=<id> starts the recipe from a catalog product. A shared
  // ?recipe= link wins when both are present. Read once: this component
  // renders only in the browser (useSearchParams under the page's Suspense
  // boundary), so the first render already sees the URL and nothing flashes.
  const productParam = searchParams.get("product");
  const [initialCatalog] = useState<CatalogBoxOption | null>(() =>
    searchParams.get("recipe") ? null : findCatalogOption(catalogBoxes, parseProductParam(productParam))
  );
```

11d. Recipe state. Replace these four lines of the recipe state block (keep the others):

```ts
  const [recipeName, setRecipeName] = useState("My Collection Box");
  const [packs, setPacks] = useState<PackEntry[]>([]);
  const [promoValue, setPromoValue] = useState(0);
  const [retailPrice, setRetailPrice] = useState(0);
```

with

```ts
  const [recipeName, setRecipeName] = useState(initialCatalog?.name ?? "My Collection Box");
  const [packs, setPacks] = useState<PackEntry[]>(() => (initialCatalog ? packsFromOption(initialCatalog) : []));
  const [typedPromoValue, setPromoValue] = useState(0);
  const [typedRetailPrice, setRetailPrice] = useState(0);
```

and directly after the recipe state block add:

```ts
  // WP28: the catalog product the recipe started from and its USD amounts.
  // An amount that came from the catalog follows the display currency until
  // the user types in its field (or loads or clears the recipe); the typed
  // value then stays as typed, like a hand-built recipe.
  const [catalogProductId, setCatalogProductId] = useState<number | null>(initialCatalog?.productId ?? null);
  const [catalogUsd, setCatalogUsd] = useState<{ retail: number | null; promo: number | null } | null>(() =>
    initialCatalog ? { retail: initialCatalog.usdPrice, promo: initialCatalog.promoValueUsd } : null
  );
  const retailPrice =
    catalogUsd !== null && catalogUsd.retail !== null
      ? amountIn(catalogUsd.retail, selectedCurrency, exchangeRate)
      : typedRetailPrice;
  const promoValue =
    catalogUsd !== null && catalogUsd.promo !== null
      ? amountIn(catalogUsd.promo, selectedCurrency, exchangeRate)
      : typedPromoValue;
  const catalogProduct = useMemo(
    () => findCatalogOption(catalogBoxes, catalogProductId),
    [catalogBoxes, catalogProductId]
  );
```

Every existing read of `retailPrice` and `promoValue` (the NAV memo, `handleSave`, the inputs' `value`) now reads the derived values, which is intended. `selectedCurrency` and `exchangeRate` come from WP20's `useCurrencyConversion()` destructure, which is above the recipe state; if it is below, move this block below it. These hooks must stay above the `if (pricesLoading) {` early return.

11e. `loadRecipeIntoState`: at the end of its body add

```ts
      setCatalogProductId(null);
      setCatalogUsd(null);
```

(state setters are stable, so the `useCallback` dependency list does not change).

11f. `handleNewRecipe`: at the end of its body add

```ts
    setCatalogProductId(null);
    setCatalogUsd(null);
    replaceProductParam(null);
```

11g. Directly after `handleNewRecipe`, add the picker handler:

```ts
  // WP28: a pick replaces the recipe with the product's recorded contents and
  // today's Market Price. It is a new, unsaved recipe: saving and sharing
  // then work as for any recipe (WP06).
  const handleSelectCatalogProduct = (productId: number | null) => {
    const option = findCatalogOption(catalogBoxes, productId);
    if (!option) {
      handleNewRecipe();
      return;
    }
    setRecipeName(option.name);
    setPacks(packsFromOption(option));
    setRetailPrice(0);
    setPromoValue(0);
    setCatalogProductId(option.productId);
    setCatalogUsd({ retail: option.usdPrice, promo: option.promoValueUsd });
    setCurrentRecipeId(undefined);
    setCurrentShareCode(null);
    setCopyState("idle");
    setShareStatus("idle");
    replaceProductParam(option.productId);
  };
```

If WP15 added more per-recipe state that `handleNewRecipe` resets (for example inline validation messages), reset it here too.

11h. Module level, directly above the component (next to `NO_CATALOG_BOXES`):

```ts
/**
 * Keep ?product= in the address bar in step with the picker, without a
 * navigation or a request (Next.js syncs useSearchParams with the native
 * History API). Picking a product also drops ?recipe=, so the URL always
 * describes what is on screen.
 */
function replaceProductParam(productId: number | null): void {
  const url = new URL(window.location.href);
  if (productId === null) {
    url.searchParams.delete("product");
  } else {
    url.searchParams.set("product", String(productId));
    url.searchParams.delete("recipe");
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
```

11i. Derived values. Directly after the `unpricedPacks` `useMemo`, add:

```ts
  // WP28: cost per pack of the price being tested, shown even when NAV is not.
  const recipePackCount = packCount(packs);
  const recipeCostPerPack = costPerPack(retailPrice, packs);
  // A pack with no price either has one withheld (0023) or has no booster
  // pack product at all; the message says which.
  const untrackedPacks = unpricedPacks.filter((pack) => !setNameMap.has(pack.setId));
  const withheldPacks = unpricedPacks.filter((pack) => setNameMap.has(pack.setId));
  const productLinkMissing =
    productParam !== null && initialCatalog === null && !searchParams.get("recipe") &&
    catalogProductId === null && packs.length === 0;
  // Never echo a malformed parameter back to the page; name only a real id.
  const productParamId = parseProductParam(productParam);
```

11j. The picker card. Directly after the currency control element (the `<CurrencySelector ... />` call; its `onChange` calls `rememberCurrency` after WP20, or is `setSelectedCurrency` with `label="Recipe currency"` after WP27), insert:

```tsx
      {/* WP28: start from a catalog product. Hidden until products have recorded contents. */}
      {catalogBoxes.length > 0 && (
        <div className="rounded-card border border-line bg-surface p-5">
          <ProductPicker
            options={catalogBoxes}
            value={catalogProductId}
            onChange={handleSelectCatalogProduct}
          />
          {catalogProduct && <CatalogProductSummary option={catalogProduct} formatPrice={formatPrice} />}
        </div>
      )}
      {productLinkMissing && (
        <p role="status" className="rounded-card border border-line bg-surface p-5 text-small text-ink-soft">
          {productParamId !== null ? `Product ${productParamId} has` : "This link's product has"} no recorded pack
          contents yet.{" "}
          {catalogBoxes.length > 0 ? "Pick a product above or build the recipe by hand." : "Build the recipe by hand."}
        </p>
      )}
```

11k. Pack rows. In the pack list `packs.map((pack) => { ... })`, next to `const packPrice = getPackPrice(pack.setId);` add `const packVariant = getPackVariant(pack.setId);`, and directly after the element that prints `{formatPrice(packPrice)}/pack` add:

```tsx
                    {packPrice !== null && packVariant && (
                      <span className="ml-2 text-caption text-ink-soft">priced from {packVariant} pack</span>
                    )}
```

11l. Retail and promo inputs. In the retail input's `onChange`, after the `setRetailPrice(...)` call, add `setCatalogUsd((prev) => (prev ? { ...prev, retail: null } : prev));`. In the promo input's `onChange`, after the `setPromoValue(...)` call, add `setCatalogUsd((prev) => (prev ? { ...prev, promo: null } : prev));`. If an `onChange` is a single expression, turn it into a block. Leave each input's `value` expression as it is (it now reads the derived value).

Directly after the retail input's wrapping `<div className="relative">...</div>`, add:

```tsx
            {recipeCostPerPack !== null && (
              <p className="mt-2 text-caption tabular-nums text-ink-soft">
                Cost per pack: {formatMoney(recipeCostPerPack, selectedCurrency)} across{" "}
                {formatInteger(recipePackCount)} {recipePackCount === 1 ? "pack" : "packs"}
              </p>
            )}
```

11m. NAV unavailable. Replace the whole `{!navResult && unpricedPacks.length > 0 && ( ... )}` block (WP24 reworded it to start "NAV unavailable:") with:

```tsx
      {!navResult && unpricedPacks.length > 0 && (
        <div role="status" className="rounded-card border border-line bg-warn-fill p-5 text-small text-ink">
          <span className="font-medium">NAV unavailable:</span>{" "}
          {[
            withheldPacks.length > 0 &&
              `no current Market Price for ${withheldPacks.map((pack) => pack.setName).join(", ")} (prices older than ${PRICE_STALENESS_TOLERANCE_DAYS} days are hidden)`,
            untrackedPacks.length > 0 &&
              `no booster pack tracked for ${untrackedPacks.map((pack) => pack.setName).join(", ")}`,
          ]
            .filter(Boolean)
            .join("; ")}
          . A missing pack is never valued at $0.
        </div>
      )}
```

11n. "How it works" list (rendered when `packs.length === 0`): add as its first item, only when the picker exists, `{catalogBoxes.length > 0 && <li>Pick a product under Start from a product to fill its packs, promo value and Market Price, or add packs by hand.</li>}`. Before curation the list stays as it is, so it never points at a control that is not on the page. Leave the other items as the file has them.

11o. Verify WP24's verdict block is intact: `grep -n "packValueBandsText()\|PACK_VALUE_LABELS\[navResult.signal\]\|DecisionNote" app/components/BoxCalculator/BoxCalculator.tsx` prints 3 lines. The band thresholds beside the verdict are WP24's; do not duplicate them.

### Step 12. `/prices`: x MSRP on cards

12a. `frontend/app/prices/page.tsx`. Add `getCachedProductStats` to the `../lib/serverMarketData` import and `import { msrpMultiplesById } from "../lib/productAttributes";`. Add `getCachedProductStats()` as the last element of the page's `Promise.all` and `productStats` as the last destructured name (keep every other element, including WP26's `getCachedSparklines`). After the `Promise.all`, build the map from the products the page shows priced, and pass `initialMsrpMultiples={msrpMultiples}` to `<ProductPrices ...>`:

```tsx
  // WP28: a multiple only beside a price the page actually shows.
  const pricedIds = new Set(products.filter((p) => typeof p.usd_price === "number").map((p) => p.id));
  const msrpMultiples = msrpMultiplesById(productStats, pricedIds);
```

Use the guarded summaries the page already has (`products`, or `catalogProducts` after WP11's projection: both keep `usd_price`). Example of the `Promise.all` with WP26's shape:

```tsx
  const [products, volumeMetrics, sparklines, productStats] = await Promise.all([
    getCachedMarketProductSummaries(),
    getCachedVolumeMetrics(),
    getCachedSparklines(PRICES_URL_DEFAULTS.chart),
    // WP28: x MSRP per product. Only the id -> multiple map goes to the
    // browser (about 150 numbers), never the stats snapshot.
    getCachedProductStats(),
  ]);
```

12b. `frontend/app/components/ProductPrices/index.tsx`:

- Module level: `const NO_MSRP_MULTIPLES: Readonly<Record<number, number>> = {};`
- Props interface: `/** WP28: product id -> x MSRP, for products that have one. */ initialMsrpMultiples?: Readonly<Record<number, number>>;` and destructure `initialMsrpMultiples = NO_MSRP_MULTIPLES`.
- In every `<ProductCard` inside `cardList` (flat, grouped, type_grouped) add `msrpMultiple={initialMsrpMultiples[product.id] ?? null}`, and add `initialMsrpMultiples` to the `cardList` dependency array.

12c. `frontend/app/components/ProductPrices/cards/ProductCard.tsx`:

- Import: `import MsrpMultiple from "../../ui/MsrpMultiple";`
- Props interface: add `/** WP28: x MSRP; null or absent hides the line. */ msrpMultiple?: number | null;` and destructure `msrpMultiple`.
- In BOTH view branches (flat and grouped), directly after the element that prints the card's current price (the one that calls `formatPrice(` with the product's price), add `<MsrpMultiple value={msrpMultiple} className="block" />` as its next sibling. If that price element shares a flex row with the sparkline (WP26 layout), put the `MsrpMultiple` directly after the row's closing tag instead, so the 96x40 sparkline slot keeps its size and position.

12d. Only when the WP30 checks in Before you start found its files (WP30 merged first). WP30 already declares `initialMsrpMultiples` on the container, feeds it to its list rows (x MSRP column and sort) and to its card detail line, and hides both while the map is empty. Then:

- Replace the whole body of `frontend/app/components/ProductPrices/shared/msrp.ts` (WP30's variant B, a copy of the formatter) with WP30's variant A:

```ts
/** x MSRP text ("1.4x"), or null. WP28 owns the formatter. */
export { formatMsrpMultiple } from "../../../lib/productAttributes";
```

- Step 12a's `initialMsrpMultiples={msrpMultiples}` on `<ProductPrices>` is the only wiring needed. Do not add a second prop, and skip 12b and 12c.
- Tests: in Tests item 9 use WP30's card props (`showSet` true and false instead of `viewMode`), as WP30's spec says; keep the assertions.

Home (`RecentlyReleased`) and `/market` do not pass `msrpMultiple`; the prop is optional, so their cards and rows are unchanged. WP32 and WP33 wire their own surfaces.

### Step 13. `frontend/app/box-calculator/page.tsx`: the catalog options

Add the imports:

```ts
import { buildCatalogBoxOptions } from "../components/BoxCalculator/catalogOptions";
```

and `getCachedProductAttributes` to the `../lib/serverMarketData` import. Replace the page's single summaries read (WP11 with WP20's edit: `const products = await getCachedMarketProductSummaries().catch(...)`) with:

```tsx
  // Server-fed like /market (review F143). Caught so a failed read degrades
  // to the browser fetch instead of failing the build or the regeneration.
  const [products, attributes] = await Promise.all([
    getCachedMarketProductSummaries().catch((error: unknown) => {
      logCaughtError("box_calculator_initial_products_failed", error);
      return null;
    }),
    // WP28: recorded pack contents for the "Start from a product" picker.
    getCachedProductAttributes(),
  ]);
  const packData = products ? buildBoosterPackData(products) : undefined;
  const catalogBoxes = products ? buildCatalogBoxOptions(products, attributes, packData?.sets ?? []) : [];
```

and render `<BoxCalculator initialPackData={packData} catalogBoxes={catalogBoxes} />` (keep any other props the element has, and keep the `<Suspense>` around it: the calculator reads `useSearchParams`).

Change the intro sentence (WP24's "Build a recipe for any collection box and see whether its price is below, near or above the value of its packs.") to: "Pick a product or build a recipe for any collection box, and see whether its price is below, near or above the value of its packs."

### Step 14. `frontend/scripts/fixtures/perf.mjs`: fixture routes for the new reads

WP22's rule: a new data endpoint gets a fixture route in the same PR. `/box-calculator` reads `product_catalog_attributes` and `product_contents` at build and request time; `/prices` now reads `product_stats_latest` (WP25's route, extended here).

14a. In `buildPerfData`, directly after WP25's `fxDaily` loop and before the final `return`, add:

```js
  // WP28: curated attributes for the three formulaic product types, and the
  // structure columns of productStats. No rand() calls, so every value above
  // (and every recorded limit) is unchanged. The fixture has no booster_pack
  // type, so no NAV is computable: nav_status is "no_standard_pack".
  const WP28_RULES = {
    booster_box: { msrp: 143.64, packs: 36 },
    elite_trainer_box: { msrp: 49.99, packs: 9 },
    booster_bundle: { msrp: 26.94, packs: 6 },
  };
  const productAttributes = [];
  const productContents = [];
  for (const s of summaries) {
    const rule = s.variant ? undefined : WP28_RULES[s.product_type_name];
    productAttributes.push({
      product_id: s.id,
      msrp_usd: rule ? rule.msrp : null,
      msrp_cad: null,
      msrp_source: rule ? "perf fixture" : null,
      release_date: s.set_release_date,
      release_date_source: "set",
      pack_count: rule ? rule.packs : null,
    });
    if (rule) productContents.push({ product_id: s.id, pack_set_id: s.set_id, quantity: rule.packs, promo_value_usd: null });
  }
  const attributesById = new Map(productAttributes.map((a) => [a.product_id, a]));
  for (const row of productStats) {
    const a = attributesById.get(row.product_id);
    const fresh = row.usd_price !== null;
    row.msrp_multiple = fresh && a?.msrp_usd ? round2(row.usd_price / a.msrp_usd) : null;
    row.cost_per_pack_usd = fresh && a?.pack_count ? round2(row.usd_price / a.pack_count) : null;
    row.nav_usd = null;
    row.premium_to_packs_pct = null;
    row.nav_status = a?.pack_count ? (fresh ? "no_standard_pack" : "box_price_withheld") : null;
  }
```

and add `productAttributes, productContents` to the returned object.

14b. In `perfRoutes()`, below WP25's `"/rest/v1/fx_daily"` entry, add:

```js
    "/rest/v1/product_catalog_attributes": rows("productAttributes"),
    "/rest/v1/product_contents": rows("productContents"),
```

Both reads use plain `select`, `order` (one or two keys) and `range`, which WP22's `applyPostgrest` supports.

### Step 15. Methodology (version bump) and metric definitions

15a. `frontend/app/content/methodology.ts`:

- Note the current values: `grep -n "METHODOLOGY_VERSION = \|METHODOLOGY_EFFECTIVE_DATE = " frontend/app/content/methodology.ts` (call them `PREV_VERSION`, normally `"1.1"`, and `PREV_DATE`).
- `export const METHODOLOGY_VERSION = "1.2";` and `export const METHODOLOGY_EFFECTIVE_DATE = "<today, date -u +%F>";`.
- In `METHODOLOGY_SECTIONS`, insert directly before the `box-nav` entry:

```ts
  { anchor: "msrp", title: "MSRP multiple" },
  { anchor: "cost-per-pack", title: "Cost per pack" },
```

- In `METHODOLOGY_CHANGES`, the first entry currently reads `version: METHODOLOGY_VERSION, date: METHODOLOGY_EFFECTIVE_DATE`. Turn it into literals (`version: "<PREV_VERSION>"`, `date: "<PREV_DATE>"`, same summary) and insert above it:

```ts
  {
    version: METHODOLOGY_VERSION,
    date: METHODOLOGY_EFFECTIVE_DATE,
    summary:
      "Adds the MSRP multiple and cost per pack, and a daily pack NAV for products whose contents Pokéfin records, with the reason when it is withheld.",
  },
```

15b. `frontend/app/lib/metricDefinitions.ts`: append to the product-level group of `DEFINITIONS`, directly after WP25's `distinctPrices365d` entry:

```ts
  // Sealed structure (WP28, migration 0036)
  def({ key: "msrp", label: "MSRP", unitLabel: "USD", window: null, short: "Suggested US retail price at launch, recorded by hand with its source. Never estimated.", anchor: "msrp" }),
  def({ key: "msrpMultiple", label: "x MSRP", unitLabel: "multiple", window: "latest TCGplayer day", short: "Market Price divided by the US MSRP. Hidden when either is missing or the price is withheld.", anchor: "msrp" }),
  def({ key: "costPerPack", label: "Cost per pack", unitLabel: "USD per pack", window: "latest TCGplayer day", short: "Market Price divided by the booster packs the product contains. Extras stay in the price.", anchor: "cost-per-pack" }),
  def({ key: "packNav", label: "Pack value (NAV)", unitLabel: "USD", window: "latest TCGplayer day", short: "Sum of the Market Prices of the standard packs inside, plus any recorded promo value.", anchor: "box-nav" }),
  def({ key: "premiumToPacks", label: "Premium to packs", unitLabel: "%", window: "latest TCGplayer day", short: "Market Price against pack value (NAV). Negative means the product costs less than its packs.", anchor: "box-nav" }),
```

Every `short` is under 120 characters (longest: `msrpMultiple` and `premiumToPacks`, 92) and contains no word from WP24's banned list.

15c. `frontend/app/methodology/MethodologyArticle.tsx`:

- Import: `import { NAV_STATUSES, NAV_STATUS_TEXT } from "../lib/productAttributes";`
- Directly before `<Section id="box-nav">`, add:

```tsx
          <Section id="msrp">
            <p>
              MSRP is the suggested retail price when the product launched. Pokéfin records it by hand for each
              product from the publisher&apos;s product page, the launch announcement or a major retailer&apos;s listing,
              and keeps the source with the number. A product without a recorded MSRP shows no multiple; Pokéfin never
              estimates one.
            </p>
            <p>
              x MSRP = Market Price ÷ US MSRP. It uses the US MSRP because Market Price is a US marketplace price; a
              Canadian MSRP, where recorded, is shown beside it for reference only. It is withheld with the price.
            </p>
          </Section>

          <Section id="cost-per-pack">
            <p>
              Cost per pack = Market Price ÷ booster packs in the product, from the contents Pokéfin records. Promo
              cards, sleeves, dice and other extras stay in the price, so an Elite Trainer Box costs more per pack than
              its packs alone. It is withheld with the price and hidden for products without recorded contents.
            </p>
          </Section>
```

- Inside `<Section id="box-nav">`, after its last paragraph (WP24's "A pack with no current price makes NAV unavailable..."), add:

```tsx
            <p>
              For products whose contents Pokéfin records, the NAV is also computed every day from the catalog: each
              set is priced by its standard booster pack, never by a variant such as a sleeved or Pokémon Center pack,
              plus the promo value Pokéfin records, if any. Premium to packs = Market Price ÷ NAV - 1, the comparison
              the calculator makes. The daily NAV is published only when the product and every pack in it have a
              current Market Price; otherwise it shows <code>--</code> with one of these reasons:
            </p>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH}>Status</th>
                  <th className={TH}>Meaning</th>
                </tr>
              </thead>
              <tbody>
                {NAV_STATUSES.map((status) => (
                  <tr key={status} data-nav-status={status}>
                    <td className={TD}>
                      <code>{status}</code>
                    </td>
                    <td className={TD}>{NAV_STATUS_TEXT[status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              The calculator can fall back to a variant pack when a set has no standard pack, and then labels that pack
              row; the daily NAV never does.
            </p>
```

Check: `grep -cP '\x{2014}' frontend/app/methodology/MethodologyArticle.tsx frontend/app/lib/productAttributes.ts frontend/app/components/BoxCalculator/*.tsx` prints 0 for each file.

### Step 16. Documentation

16a. `README.md`, section "Database", after WP25's "Market analytics tables (WP25)" subsection:

```markdown
#### Product attributes (WP28)

- `products.msrp_usd`, `msrp_cad`, `msrp_source`, `release_date` and the
  `product_contents` table hold owner-curated reference data: MSRP at launch,
  a product release date where it differs from the set's, and the booster
  packs inside each sealed product.
- The source of truth is `data/product_attributes.csv` and
  `data/product_contents.csv`. Only reviewed rows (`reviewed=yes`) load.
  `python scripts/make_attribute_template.py --write` appends starter rows for
  products the files do not list yet; `python scripts/load_product_attributes.py`
  validates and shows the diff; `--apply` writes (service key), refreshes
  today's `product_daily_stats` and revalidates the site.
- `refresh_market_analytics` fills `msrp_multiple`, `cost_per_pack_usd`,
  `nav_usd`, `premium_to_packs_pct` and `nav_status` from them daily. Rules:
  `migrations/0036_product_attributes.sql` and `/methodology#msrp`,
  `#cost-per-pack`, `#box-nav`.
```

16b. `audits/HARDENING_FOLLOWUPS.md` section 7: add as the newest bullet of the migration run (directly above the newest existing "**Migration" bullet):

```markdown
- **Migration 0036: pending apply** (WP28). `products.msrp_usd`, `msrp_cad`,
  `msrp_source`, `release_date`; `product_contents`; five structure columns on
  `product_daily_stats`; `refresh_product_structure_stats(date)`;
  `refresh_market_analytics(date)` replaced (adds the structure step);
  `product_stats_latest` re-created; `product_catalog_attributes`;
  `apply_product_attributes(jsonb, jsonb, boolean)` (SECURITY DEFINER, EXECUTE
  for service_role only). Additive.
```

### Step 17. Tests

Write every file in the Tests section below. Then run the phase A checks from Verification that do not need generated types, and open the draft PR.

### Step 18. Phase B: generated types

After the owner has applied 0036 (Owner action 1):

```bash
cd frontend
SUPABASE_ACCESS_TOKEN=... pnpm types:db          # or use the file the owner pushed
grep -oE "product_contents|product_catalog_attributes|apply_product_attributes|refresh_product_structure_stats|msrp_multiple|nav_status" app/types/database.ts | sort -u | wc -l   # 6
pnpm exec tsc --noEmit                            # exit 0
```

Do not edit the generated file. If `tsc` rejects a row assignment in `fetchProductAttributes` or `fetchProductStatsLatest`, adjust the row types in `lib/productAttributes.ts` (or annotate the variable as step 7c says), not the generated file, and say so in the PR.

## Pitfalls: do not do this

- **Do not estimate an MSRP.** A product without a reviewed MSRP shows no multiple anywhere: no fallback to the template value, to `msrp_cad` x rate, or to a type average.
- **Do not compute x MSRP from `msrp_cad`,** and do not convert it at today's rate. Market Price is a US marketplace price; the multiple is `usd_price / msrp_usd`, the same in USD and CAD views.
- **Do not price a set from a variant pack in SQL,** and do not let the calculator do it silently: the catalog NAV uses only the standard pack (`variant` NULL or blank); the calculator's existing fallback stays but its row now says "priced from {variant} pack".
- **Do not value a withheld pack at $0,** and do not compute NAV when the product's own price is withheld. `nav_status` says why; the UI shows `--` or the reason.
- **Do not re-run 0033 or 0034 after 0036 is applied.** Their `CREATE OR REPLACE` would put back a `refresh_market_analytics` without the structure step. Only re-run the newest file that defines it. The same rule binds any later package that replaces the function (none of WP29 to WP37 does today; WP29's 0037 only calls it): copy 0036's function body, keep `refresh_product_structure_stats(p_day)` after `refresh_product_daily_stats(p_day)`, and keep the `structure_rows` key.
- **Do not drop and re-create `product_stats_latest`** in a later migration without `s.*` (or without the five columns): `getCachedProductStats` selects them by name.
- **Do not skip step 5c.** The four structure numbers are price-anchored; WP25's read-time gate must withhold them like `usd_price` when the stats rows stop advancing.
- **Do not show a multiple beside a withheld price.** `/prices` builds its map only from the products it shows priced (`pricedIds`, step 12a).
- **Do not grant any write on `product_contents` or the new `products` columns** to `anon`, `authenticated` or `pokefin_scraper`. The only write path is `apply_product_attributes`, EXECUTE for `service_role`. Do not give it to the scraper role "to make the loader easier".
- **Do not add an admin UI or an API route** for attributes. The CSVs in git are the audit trail.
- **Do not commit guessed MSRPs or contents** in `data/*.csv`. The PR ships headers only; the template writes `reviewed=no` rows that the loader ignores.
- **Do not load CSVs from CI or point the loader at a test database with the service key.** CI runs `--check` (offline) through the unit test only.
- **Do not send the stats snapshot to the browser.** `/prices` passes `msrpMultiplesById(...)` (a small map); the calculator page passes the built options, never `ProductAttributesSnapshot` or the product list.
- **Do not fetch attributes from the browser,** and do not add a client request to `/prices` or `/box-calculator`. Both are server-fed from cached reads (WP11, WP26 rules).
- **Do not navigate on a pick** (`router.push`/`router.replace`): `history.replaceState` updates `?product=` without an RSC request.
- **Do not set state from an effect to apply `?product=`.** The initial pick is read in `useState` initialisers (no flash, no `react-hooks/set-state-in-effect` violation).
- **Do not change WP24's verdict block, bands or labels,** or `calculateNav`'s thresholds. This package only shows cost per pack and the product context next to them.
- **Do not call `getCachedProductAttributes()` or `getCachedProductStats()` inside another `unstable_cache` callback** (WP11's nested-cache rule).
- **Do not use "undervalued", "buy", "deal", "live" or an em dash** in any new copy (WP24's conventions test).
- **Do not edit `verify_migration.py`, `schema.sql` or any existing migration,** and do not apply migrations to production yourself.

## Tests

### 1. `tests/fixtures/wp28/product_attributes.csv` and `tests/fixtures/wp28/product_contents.csv` (new)

The committed fixture the DB test loads through the loader's own parser. Ids are fixed (`9280001` to `9280010`, sets `928001` to `928003`) and created by the DB test with `OVERRIDING SYSTEM VALUE`.

`tests/fixtures/wp28/product_attributes.csv`:

```
product_id,product_name,msrp_usd,msrp_cad,msrp_source,release_date,reviewed,notes
9280001,WP28 Alpha Booster Box,143.64,,TPCi product page,,yes,fixture: fresh box and fresh pack
9280003,WP28 Alpha Elite Trainer Box,49.99,69.99,Pokemon Center listing,2024-11-22,yes,fixture: product release date overrides the set's
9280005,WP28 Beta Elite Trainer Box,49.99,,Pokemon Center listing,,yes,fixture: stale pack
9280007,WP28 Gamma Premium Collection,,,,,yes,fixture: variant-only pack set
9280009,WP28 Alpha Booster Box (Case),143.64,,TPCi product page,,yes,fixture: stale box
9280010,WP28 Alpha Booster Bundle,26.94,,template default,,no,fixture: pending review is skipped
```

`tests/fixtures/wp28/product_contents.csv`:

```
product_id,product_name,pack_set_id,pack_set_name,quantity,promo_value_usd,reviewed,notes
9280001,WP28 Alpha Booster Box,928001,WP28 Alpha,36,,yes,
9280003,WP28 Alpha Elite Trainer Box,928001,WP28 Alpha,9,3.50,yes,promo card valued by hand
9280005,WP28 Beta Elite Trainer Box,928002,WP28 Beta,9,,yes,
9280007,WP28 Gamma Premium Collection,928003,WP28 Gamma,4,,yes,
9280008,WP28 Mixed Collection,928001,WP28 Alpha,4,10.00,yes,
9280008,WP28 Mixed Collection,928002,WP28 Beta,2,,yes,
9280009,WP28 Alpha Booster Box (Case),928001,WP28 Alpha,36,,yes,
9280010,WP28 Alpha Booster Bundle,928001,WP28 Alpha,6,,no,
```

### 2. `tests/test_wp28_product_attributes.py` (new, unit, no network, no database)

41 cases (`python -m pytest tests/test_wp28_product_attributes.py -q`: `41 passed`). The prototype ran 40; the booster-pack template case and the pack row in the append test were added in review and must pass too.

```python
"""
Unit tests for WP28's loader and template scripts. No network, no database.

  python -m pytest tests/test_wp28_product_attributes.py -v
"""
import csv
import importlib.util
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "wp28"
TODAY = date(2026, 9, 30)


def load_script(name):
    sys.path.insert(0, str(ROOT / "scripts"))
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # dataclasses resolve annotations through sys.modules
    spec.loader.exec_module(module)
    return module


loader = load_script("load_product_attributes")
template = load_script("make_attribute_template")

ATTR_HEADER = ",".join(loader.ATTRIBUTE_COLUMNS)
CONT_HEADER = ",".join(loader.CONTENT_COLUMNS)


def write(tmp_path, name, header, *lines):
    path = tmp_path / name
    path.write_text("\n".join([header, *lines]) + "\n", encoding="utf-8")
    return path


def attrs(tmp_path, *lines):
    rows = loader.read_csv(write(tmp_path, "a.csv", ATTR_HEADER, *lines), loader.ATTRIBUTE_COLUMNS)
    return loader.parse_attributes(rows, TODAY)


def contents(tmp_path, *lines):
    rows = loader.read_csv(write(tmp_path, "c.csv", CONT_HEADER, *lines), loader.CONTENT_COLUMNS)
    return loader.parse_contents(rows)


# ------------------------------------------------------------ files


def test_committed_files_are_valid():
    """data/*.csv must always load: CI runs the same check as --check."""
    _, _, errors = loader.load_files(TODAY)
    assert errors == []


def test_fixture_files_are_valid():
    a, c, errors = loader.load_files(TODAY, FIXTURES / "product_attributes.csv", FIXTURES / "product_contents.csv")
    assert errors == []
    assert sum(r.reviewed for r in a) == 5 and sum(r.reviewed for r in c) == 7


def test_wrong_header_is_a_file_error(tmp_path):
    bad = write(tmp_path, "a.csv", "product_id,msrp_usd")
    _, _, errors = loader.load_files(TODAY, bad, FIXTURES / "product_contents.csv")
    assert errors and "header must be" in errors[0]


# ------------------------------------------------------------ attributes


def test_valid_attribute_row(tmp_path):
    rows, errors = attrs(tmp_path, "5,Box,143.64,199.99,TPCi,2024-11-08,yes,")
    assert errors == []
    assert rows[0].msrp_usd == Decimal("143.64") and rows[0].release_date == date(2024, 11, 8)


@pytest.mark.parametrize("line, fragment", [
    ("5,Box,0.50,,TPCi,,yes,", "outside"),
    ("5,Box,2500,,TPCi,,yes,", "outside"),
    ("5,Box,49.999,,TPCi,,yes,", "at most 2 decimals"),
    ("5,Box,abc,,TPCi,,yes,", "not a number"),
    ("5,Box,,5000,TPCi,,yes,", "outside"),
    ("5,Box,49.99,,,,yes,", "msrp_source is required"),
    ("5,Box,,,,2024-13-01,yes,", "not YYYY-MM-DD"),
    ("5,Box,,,,1990-01-01,yes,", "out of range"),
    ("5,Box,,,,,maybe,", "reviewed must be yes or no"),
    ("x,Box,,,,,yes,", "not a whole number"),
])
def test_invalid_attribute_rows(tmp_path, line, fragment):
    rows, errors = attrs(tmp_path, line)
    assert rows == [] and len(errors) == 1 and fragment in errors[0]


def test_duplicate_product_is_an_error(tmp_path):
    _, errors = attrs(tmp_path, "5,Box,,,,,yes,", "5,Box,,,,,no,")
    assert errors == ["product_attributes.csv line 3: product_id 5 repeats line 2"]


def test_long_source_is_an_error(tmp_path):
    _, errors = attrs(tmp_path, f"5,Box,49.99,,{'s' * 201},,yes,")
    assert "longer than 200" in errors[0]


# ------------------------------------------------------------ contents


def test_valid_contents_rows(tmp_path):
    rows, errors = contents(tmp_path, "5,Box,7,Set,36,,yes,", "6,Col,7,Set,4,12.50,yes,", "6,Col,8,Set2,2,,yes,")
    assert errors == [] and [r.quantity for r in rows] == [36, 4, 2]


@pytest.mark.parametrize("line, fragment", [
    ("5,Box,7,Set,0,,yes,", "outside 1 to 100"),
    ("5,Box,7,Set,101,,yes,", "outside 1 to 100"),
    ("5,Box,7,Set,,,yes,", "quantity is required"),
    ("5,Box,,Set,3,,yes,", "pack_set_id is required"),
    ("5,Box,7,Set,3,-1,yes,", "outside"),
])
def test_invalid_contents_rows(tmp_path, line, fragment):
    rows, errors = contents(tmp_path, line)
    assert rows == [] and fragment in errors[0]


def test_duplicate_product_set_and_second_promo_are_errors(tmp_path):
    _, errors = contents(tmp_path, "5,Box,7,Set,3,1.00,yes,", "5,Box,7,Set,3,,yes,", "5,Box,8,Set,3,2.00,yes,")
    assert any("repeat line 2" in e for e in errors)
    assert any("already has promo_value_usd on line 2" in e for e in errors)


# ------------------------------------------------------------ catalog and payload


CATALOG = loader.Catalog(
    products={5: ("booster_box", 7), 6: ("premium_collection", 7), 9: ("booster_pack", 7)},
    set_ids=frozenset({7, 8}),
)


def test_unknown_ids_are_reported_and_packs_cannot_have_contents(tmp_path):
    a, _ = attrs(tmp_path, "5,Box,,,,,yes,", "404,Gone,,,,,yes,")
    c, _ = contents(tmp_path, "5,Box,7,Set,36,,yes,", "6,Col,99,Set,2,,yes,", "9,Pack,7,Set,1,,yes,")
    known_a, known_c, unknown, errors = loader.check_catalog(a, c, CATALOG)
    assert [r.product_id for r in known_a] == [5] and [r.product_id for r in known_c] == [5]
    assert any("unknown product_id 404" in u for u in unknown)
    assert any("unknown pack_set_id 99" in u for u in unknown)
    assert errors and "packs have no contents" in errors[0]


def test_payload_keeps_reviewed_rows_and_exact_decimals(tmp_path):
    a, _ = attrs(tmp_path, "5,Box,143.64,,TPCi,2024-11-08,yes,", "6,Col,59.99,,guess,,no,")
    c, _ = contents(tmp_path, "5,Box,7,Set,36,,yes,", "6,Col,7,Set,4,10,no,")
    attribute_payload, content_payload = loader.build_payload(a, c)
    assert attribute_payload == [{"product_id": 5, "msrp_usd": "143.64", "msrp_cad": None,
                                  "msrp_source": "TPCi", "release_date": "2024-11-08"}]
    assert content_payload == [{"product_id": 5, "pack_set_id": 7, "quantity": 36, "promo_value_usd": None}]


# ------------------------------------------------------------ main


def fake_client(products=None, sets=None):
    client = MagicMock()
    tables = {
        "products": [{"id": 9280001, "set_id": 928001, "product_types": {"name": "booster_box"}},
                     {"id": 9280003, "set_id": 928001, "product_types": {"name": "elite_trainer_box"}},
                     {"id": 9280005, "set_id": 928002, "product_types": {"name": "elite_trainer_box"}},
                     {"id": 9280007, "set_id": 928003, "product_types": {"name": "premium_collection"}},
                     {"id": 9280008, "set_id": 928001, "product_types": {"name": "premium_collection"}},
                     {"id": 9280009, "set_id": 928001, "product_types": {"name": "booster_box"}}]
        if products is None else products,
        "sets": [{"id": 928001}, {"id": 928002}, {"id": 928003}] if sets is None else sets,
    }

    def table(name):
        query = MagicMock()
        chain = query.select.return_value
        for method in ("order", "range", "not_", "is_", "limit"):
            setattr(chain, method, MagicMock(return_value=chain))
        chain.not_ = chain
        chain.execute.return_value.data = tables.get(name, [])
        chain.execute.return_value.count = 0
        return query

    client.table.side_effect = table
    client.rpc.return_value.execute.return_value.data = {"ok": True}
    return client


FIXTURE_ARGS = ["--attributes", str(FIXTURES / "product_attributes.csv"),
                "--contents", str(FIXTURES / "product_contents.csv")]


def test_check_mode_needs_no_database(capsys):
    assert loader.main(["--check", *FIXTURE_ARGS], today=TODAY) == 0
    assert "5 reviewed attribute rows, 7 reviewed contents rows, 2 rows pending review" in capsys.readouterr().out


def test_invalid_files_exit_2_and_write_nothing(tmp_path):
    bad = write(tmp_path, "a.csv", ATTR_HEADER, "5,Box,0,,x,,yes,")
    client = fake_client()
    assert loader.main(["--apply", "--attributes", str(bad), "--contents", str(FIXTURES / "product_contents.csv")],
                       client=client, today=TODAY) == 2
    client.rpc.assert_not_called()


def test_dry_run_reads_but_never_writes(capsys):
    client = fake_client()
    assert loader.main(FIXTURE_ARGS, client=client, today=TODAY) == 0
    client.rpc.assert_not_called()
    assert "Dry run" in capsys.readouterr().out


def test_apply_writes_refreshes_and_revalidates():
    client = fake_client()
    revalidate = MagicMock(return_value=True)
    assert loader.main(["--apply", *FIXTURE_ARGS], client=client, today=TODAY, revalidate=revalidate) == 0
    name, params = client.rpc.call_args_list[0].args
    assert name == "apply_product_attributes"
    assert [a["product_id"] for a in params["p_attributes"]] == [9280001, 9280003, 9280005, 9280007, 9280009]
    assert len(params["p_contents"]) == 7 and params["p_allow_clear_all"] is False
    assert client.rpc.call_args_list[1].args == ("refresh_market_analytics", {"p_day": "2026-09-30"})
    revalidate.assert_called_once()


def test_unknown_ids_skip_by_default_and_fail_with_strict(capsys):
    products = [{"id": 9280001, "set_id": 928001, "product_types": {"name": "booster_box"}}]
    client = fake_client(products=products)
    assert loader.main(["--apply", "--strict", *FIXTURE_ARGS], client=client, today=TODAY) == 1
    client.rpc.assert_not_called()
    client = fake_client(products=products)
    assert loader.main(["--apply", *FIXTURE_ARGS], client=client, today=TODAY, revalidate=lambda: False) == 0
    _, params = client.rpc.call_args_list[0].args
    assert [a["product_id"] for a in params["p_attributes"]] == [9280001]
    assert "UNKNOWN" in capsys.readouterr().err


# ------------------------------------------------------------ template


def product(pid, type_name, gen, *, special=False, variant=None, set_id=10, release="2025-01-17"):
    return {
        "id": pid, "variant": variant, "set_id": set_id,
        "sets": {"name": "Test Set", "release_date": release,
                 "expansion_type": "Special Expansion" if special else "Main Series",
                 "generations": {"name": gen}},
        "product_types": {"name": type_name, "label": type_name.replace("_", " ").title()},
    }


@pytest.mark.parametrize("p, msrp, packs", [
    (product(1, "booster_box", "Scarlet & Violet"), "161.64", 36),
    (product(2, "booster_bundle", "Sword and Shield"), "23.94", 6),
    (product(3, "elite_trainer_box", "Scarlet & Violet"), "49.99", 9),
    (product(4, "elite_trainer_box", "Sword & Shield", special=True), "39.99", 10),
    (product(5, "elite_trainer_box", "Sword & Shield"), "39.99", 8),
    (product(6, "elite_trainer_box", "Mega Evolution"), "", 9),
    (product(7, "premium_collection", "Scarlet & Violet"), "", None),
    (product(8, "elite_trainer_box", "Scarlet & Violet", variant="Pokemon Center"), "", None),
    (product(9, "booster_pack", "Scarlet & Violet"), "4.49", None),
])
def test_template_rules(p, msrp, packs):
    attribute, rows = template.default_rows(p, pack_sets={10})
    assert attribute["msrp_usd"] == msrp and attribute["reviewed"] == "no"
    assert attribute["msrp_source"] == (template.TEMPLATE_SOURCE if msrp else "")
    assert [r["quantity"] for r in rows] == ([packs] if packs else [])


def test_template_notes_a_set_without_a_standard_pack():
    _, rows = template.default_rows(product(1, "booster_box", "Scarlet & Violet", set_id=11), pack_sets={10})
    assert "no standard booster pack" in rows[0]["notes"]


def test_template_appends_only_missing_products_and_gives_packs_no_contents(tmp_path):
    a = write(tmp_path, "a.csv", ATTR_HEADER, "1,Listed,,,,,yes,")
    c = tmp_path / "c.csv"
    products = [product(1, "booster_box", "Scarlet & Violet"), product(2, "booster_box", "Scarlet & Violet"),
                product(3, "booster_pack", "Scarlet & Violet")]
    new_a, new_c = template.plan(products, a, c)
    assert [r["product_id"] for r in new_a] == [3, 2]  # same set date: higher id first
    assert [r["product_id"] for r in new_c] == [2, 1]  # the pack (3) gets no contents row
    template.append_rows(a, loader.ATTRIBUTE_COLUMNS, new_a)
    template.append_rows(c, loader.CONTENT_COLUMNS, new_c)
    with a.open() as handle:
        assert [r["product_id"] for r in csv.DictReader(handle)] == ["1", "3", "2"]
    assert c.read_text().splitlines()[0] == CONT_HEADER
    # The appended rows load (reviewed=no, so they are skipped, not rejected).
    _, _, errors = loader.load_files(TODAY, a, c)
    assert errors == []
```

### 3. `tests/test_wp28_product_attributes_db.py` (new, needs the replayed database)

The SQL gating test. Skipped unless `POKEFIN_TEST_DATABASE_URL` is set; CI's "Database replay and Python tests" job sets it to `replay_once`. It covers: the fixture CSV loaded end to end (x MSRP, cost per pack, NAV and premium on a booster box), promo value in NAV, a stale pack (NULL NAV, `pack_price_withheld`, cost per pack kept), a stale box (every structure column NULL), a variant-only set (`no_standard_pack`), uncurated products, the global "no value without a fresh price" invariant, the release-date default, full-sync semantics and idempotency of `apply_product_attributes`, the empty-payload guard, rejected payloads writing nothing, and the role grants. 19 passed against the scratch database, twice in a row on the same database (it cleans up after itself); WP25's 22 cases still pass on a database with 0036 applied.

```python
"""
Database checks for migration 0036 (MSRP, pack contents, the structure
columns of product_daily_stats, apply_product_attributes), run against a
database rebuilt by scripts/db/replay_migrations.sh.

Skipped unless POKEFIN_TEST_DATABASE_URL points at that replayed database as
a superuser (CI sets it; job "database"). NEVER point it at production: the
fixtures write rows, and apply_product_attributes replaces every product's
attributes and the whole product_contents table.

  POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/replay_once \
    python -m pytest tests/test_wp28_product_attributes_db.py -v
"""
import importlib.util
import os
import sys
import uuid
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlparse

import pytest

DSN = os.environ.get("POKEFIN_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="POKEFIN_TEST_DATABASE_URL not set")

psycopg = pytest.importorskip("psycopg")
from psycopg import errors  # noqa: E402
from psycopg.types.json import Jsonb  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "wp28"
TAG = "wp28-" + uuid.uuid4().hex[:8]

# Fixed ids, so the committed fixture CSVs can name them.
SET_ALPHA, SET_BETA, SET_GAMMA = 928001, 928002, 928003
BOX, PACK_A, ETB_A, PACK_B, ETB_B, PACK_C_VARIANT, COLLECTION_C, MIXED, BOX_STALE, BUNDLE = range(9280001, 9280011)


def load_loader():
    sys.path.insert(0, str(ROOT / "scripts"))
    spec = importlib.util.spec_from_file_location(
        "load_product_attributes", ROOT / "scripts" / "load_product_attributes.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["load_product_attributes"] = module
    spec.loader.exec_module(module)
    return module


loader = load_loader()


@pytest.fixture(scope="module")
def admin():
    host = (urlparse(DSN).hostname or "").lower()
    assert host in ("localhost", "127.0.0.1", "postgres"), "refusing a non-local database"
    with psycopg.connect(DSN, autocommit=True) as conn:
        yield conn


@pytest.fixture(scope="module")
def today(admin):
    return admin.execute("SELECT (now() AT TIME ZONE 'UTC')::date").fetchone()[0]


def type_id(admin, name, label):
    row = admin.execute("SELECT id FROM public.product_types WHERE name = %s", (name,)).fetchone()
    if row:
        return row[0], False
    return admin.execute(
        "INSERT INTO public.product_types (name, label) VALUES (%s, %s) RETURNING id", (name, label)
    ).fetchone()[0], True


@pytest.fixture(scope="module")
def catalog(admin, today):
    """Three sets, their packs and eight sealed products, with prices."""
    pack_type, made_pack_type = type_id(admin, "booster_pack", "Booster Pack")
    box_type = admin.execute(
        "INSERT INTO public.product_types (name, label) VALUES (%s, 'WP28 box') RETURNING id", (TAG,)
    ).fetchone()[0]
    for set_id, code, release in ((SET_ALPHA, "W28A", "2024-11-08"), (SET_BETA, "W28B", "2025-01-17"),
                                  (SET_GAMMA, "W28C", "2025-03-28")):
        admin.execute(
            "INSERT INTO public.sets (id, code, name, release_date) OVERRIDING SYSTEM VALUE "
            "VALUES (%s, %s, %s, %s)", (set_id, code, f"{TAG} {code}", release))
    products = [
        # id, set, type, price, variant, price days ago (newest, oldest)
        (BOX, SET_ALPHA, box_type, 198.0, None, (0, 9)),
        (PACK_A, SET_ALPHA, pack_type, 5.0, None, (0, 9)),
        (ETB_A, SET_ALPHA, box_type, 60.0, None, (0, 9)),
        (PACK_B, SET_BETA, pack_type, 6.0, None, (20, 29)),      # stale pack
        (ETB_B, SET_BETA, box_type, 70.0, None, (0, 9)),
        (PACK_C_VARIANT, SET_GAMMA, pack_type, 7.0, "Sleeved", (0, 9)),
        (COLLECTION_C, SET_GAMMA, box_type, 80.0, None, (0, 9)),
        (MIXED, SET_ALPHA, box_type, 50.0, None, (0, 9)),
        (BOX_STALE, SET_ALPHA, box_type, 150.0, None, (20, 29)),  # stale box
        (BUNDLE, SET_ALPHA, box_type, 30.0, None, (0, 9)),
    ]
    for pid, set_id, ptype, price, variant, (newest, oldest) in products:
        admin.execute(
            "INSERT INTO public.products (id, set_id, product_type_id, usd_price, url, variant, last_updated) "
            "OVERRIDING SYSTEM VALUE VALUES (%s, %s, %s, %s, %s, %s, now())",
            (pid, set_id, ptype, price, f"https://www.tcgplayer.com/product/{pid}", variant))
        for ago in range(newest, oldest + 1):
            admin.execute(
                "INSERT INTO public.product_price_history (product_id, usd_price, recorded_at) "
                "VALUES (%s, %s, %s::timestamp + interval '3 hours')",
                (pid, price, today - timedelta(days=ago)))
    yield {"pack_type": pack_type, "box_type": box_type}
    ids = [p[0] for p in products]
    admin.execute("DELETE FROM public.product_contents WHERE product_id = ANY(%s)", (ids,))
    admin.execute("DELETE FROM public.product_price_history WHERE product_id = ANY(%s)", (ids,))
    admin.execute("DELETE FROM public.products WHERE id = ANY(%s)", (ids,))  # stats rows cascade
    admin.execute("DELETE FROM public.sets WHERE id IN (%s, %s, %s)", (SET_ALPHA, SET_BETA, SET_GAMMA))
    admin.execute("DELETE FROM public.product_types WHERE id = %s", (box_type,))
    if made_pack_type:
        admin.execute("DELETE FROM public.product_types WHERE id = %s", (pack_type,))


def apply(admin, attributes, contents, allow_clear_all=False):
    return admin.execute(
        "SELECT public.apply_product_attributes(%s, %s, %s)",
        (Jsonb(attributes), Jsonb(contents), allow_clear_all)).fetchone()[0]


def apply_fixture(admin, today):
    a, c, problems = loader.load_files(today, FIXTURES / "product_attributes.csv",
                                       FIXTURES / "product_contents.csv")
    assert problems == []
    return apply(admin, *loader.build_payload(a, c))


def refresh(admin, day):
    return admin.execute("SELECT public.refresh_market_analytics(%s)", (day,)).fetchone()[0]


def stats(admin, day, pid):
    cur = admin.execute(
        "SELECT * FROM public.product_daily_stats WHERE day = %s AND product_id = %s", (day, pid))
    names = [c.name for c in cur.description]
    row = cur.fetchone()
    return dict(zip(names, row)) if row else None


@pytest.fixture(scope="module")
def loaded(admin, catalog, today):
    result = apply_fixture(admin, today)
    summary = refresh(admin, today)
    return result, summary


# ---------------------------------------------------------------- fixture CSV


def test_fixture_load_writes_reviewed_rows_only(admin, loaded):
    result, summary = loaded
    assert result["contents_written"] == 7
    assert summary["structure_rows"] >= 10
    assert admin.execute(
        "SELECT count(*) FROM public.product_contents WHERE product_id = %s", (BUNDLE,)).fetchone()[0] == 0
    assert admin.execute(
        "SELECT msrp_usd FROM public.products WHERE id = %s", (BUNDLE,)).fetchone()[0] is None


def test_booster_box_shows_msrp_multiple_cost_per_pack_and_nav(admin, loaded, today):
    s = stats(admin, today, BOX)
    assert s["msrp_multiple"] == pytest.approx(198 / 143.64)
    assert s["cost_per_pack_usd"] == pytest.approx(5.5)
    assert s["nav_usd"] == pytest.approx(180.0)
    assert s["premium_to_packs_pct"] == pytest.approx(10.0)
    assert s["nav_status"] == "ok"
    latest = admin.execute(
        "SELECT msrp_multiple, cost_per_pack_usd, nav_status FROM public.product_stats_latest "
        "WHERE product_id = %s", (BOX,)).fetchone()
    assert latest[2] == "ok" and latest[1] == pytest.approx(5.5)


def test_promo_value_is_added_to_nav(admin, loaded, today):
    s = stats(admin, today, ETB_A)
    assert s["nav_usd"] == pytest.approx(9 * 5 + 3.5)
    assert s["premium_to_packs_pct"] == pytest.approx((60 / 48.5 - 1) * 100)


# ---------------------------------------------------------------- gates


def test_stale_pack_means_no_nav_and_says_why(admin, loaded, today):
    s = stats(admin, today, ETB_B)
    assert s["nav_usd"] is None and s["premium_to_packs_pct"] is None
    assert s["nav_status"] == "pack_price_withheld"
    # The product's own price is fresh, so cost per pack and x MSRP still show.
    assert s["cost_per_pack_usd"] == pytest.approx(70 / 9)
    assert s["msrp_multiple"] == pytest.approx(70 / 49.99)
    # One stale set is enough, even with a fresh one beside it.
    assert stats(admin, today, MIXED)["nav_status"] == "pack_price_withheld"


def test_stale_box_withholds_every_price_anchored_value(admin, loaded, today):
    s = stats(admin, today, BOX_STALE)
    assert s["is_price_fresh"] is False
    assert s["nav_status"] == "box_price_withheld"
    for col in ("msrp_multiple", "cost_per_pack_usd", "nav_usd", "premium_to_packs_pct"):
        assert s[col] is None, col


def test_variant_pack_never_prices_a_set(admin, loaded, today):
    s = stats(admin, today, COLLECTION_C)
    assert s["nav_status"] == "no_standard_pack" and s["nav_usd"] is None
    assert s["cost_per_pack_usd"] == pytest.approx(20.0)


def test_products_without_curation_have_no_structure_values(admin, loaded, today):
    for pid in (PACK_A, BUNDLE):
        s = stats(admin, today, pid)
        assert (s["msrp_multiple"], s["cost_per_pack_usd"], s["nav_usd"], s["nav_status"]) == (None, None, None, None)


def test_no_structure_value_without_a_fresh_price(admin, loaded):
    assert admin.execute(
        "SELECT count(*) FROM public.product_daily_stats WHERE NOT is_price_fresh AND "
        "num_nonnulls(msrp_multiple, cost_per_pack_usd, nav_usd, premium_to_packs_pct) > 0"
    ).fetchone()[0] == 0
    assert admin.execute(
        "SELECT count(*) FROM public.product_daily_stats "
        "WHERE (nav_usd IS NOT NULL) <> (nav_status IS NOT DISTINCT FROM 'ok')"
    ).fetchone()[0] == 0


# ---------------------------------------------------------------- reads


def test_release_date_defaults_to_the_set_date(admin, loaded):
    rows = dict(
        (r[0], r[1:]) for r in admin.execute(
            "SELECT product_id, release_date, release_date_source, pack_count "
            "FROM public.product_catalog_attributes WHERE product_id IN (%s, %s, %s)", (BOX, ETB_A, MIXED)))
    assert rows[BOX] == (date(2024, 11, 8), "set", 36)
    assert rows[ETB_A] == (date(2024, 11, 22), "product", 9)
    assert rows[MIXED][2] == 6


# ---------------------------------------------------------------- loader function


def test_apply_is_a_full_sync_and_refresh_clears_removed_values(admin, loaded, today):
    try:
        a, c, _ = loader.load_files(today, FIXTURES / "product_attributes.csv", FIXTURES / "product_contents.csv")
        attributes, contents = loader.build_payload(a, c)
        result = apply(admin, [x for x in attributes if x["product_id"] != BOX],
                       [x for x in contents if x["product_id"] != BOX])
        assert result["attributes_changed"] == 1 and result["contents_deleted"] == 1
        refresh(admin, today)
        s = stats(admin, today, BOX)
        assert (s["msrp_multiple"], s["cost_per_pack_usd"], s["nav_usd"], s["nav_status"]) == (None, None, None, None)
        # Re-applying the same payload changes nothing.
        again = apply(admin, [x for x in attributes if x["product_id"] != BOX],
                      [x for x in contents if x["product_id"] != BOX])
        assert again == {"attributes_changed": 0, "contents_deleted": 0, "contents_written": 0}
    finally:
        apply_fixture(admin, today)
        refresh(admin, today)
    assert stats(admin, today, BOX)["nav_status"] == "ok"


def test_empty_payload_needs_the_explicit_flag(admin, loaded):
    with pytest.raises(errors.InvalidParameterValue):
        apply(admin, [], [])
    assert admin.execute("SELECT count(*) FROM public.products WHERE msrp_usd IS NOT NULL").fetchone()[0] > 0


@pytest.mark.parametrize("attributes, contents, error", [
    # 9289999: outside every fixture range, so it cannot exist in the replayed database.
    ([{"product_id": 9289999}], [], errors.ForeignKeyViolation),
    ([{"product_id": BOX}, {"product_id": BOX}], [], errors.InvalidParameterValue),
    ([{"product_id": BOX}], [{"product_id": BOX, "pack_set_id": 9289999, "quantity": 1}], errors.ForeignKeyViolation),
    ([{"product_id": BOX}], [{"product_id": BOX, "pack_set_id": SET_ALPHA, "quantity": 0}], errors.CheckViolation),
    ([{"product_id": BOX, "msrp_usd": "10"}], [], errors.CheckViolation),  # an MSRP needs a source
])
def test_apply_rejects_bad_payloads_and_writes_nothing(admin, loaded, attributes, contents, error):
    before = admin.execute("SELECT count(*) FROM public.product_contents").fetchone()[0]
    with pytest.raises(error):
        apply(admin, attributes, contents)
    assert admin.execute("SELECT count(*) FROM public.product_contents").fetchone()[0] == before
    assert admin.execute("SELECT msrp_usd FROM public.products WHERE id = %s", (BOX,)).fetchone()[0] is not None


# ---------------------------------------------------------------- roles


def as_role(admin, role):
    admin.execute("BEGIN")
    admin.execute(f"SET LOCAL ROLE {role}")


def test_api_roles_read_but_cannot_write(admin, loaded, today):
    for role in ("anon", "authenticated"):
        as_role(admin, role)
        try:
            admin.execute("SELECT count(*) FROM public.product_contents").fetchone()
            admin.execute("SELECT count(*) FROM public.product_catalog_attributes").fetchone()
            admin.execute("SELECT nav_status FROM public.product_stats_latest LIMIT 1").fetchone()
        finally:
            admin.execute("ROLLBACK")
        for stmt in (
            f"INSERT INTO public.product_contents VALUES ({BUNDLE}, {SET_ALPHA}, 6, NULL)",
            "TRUNCATE public.product_contents",
            "SELECT public.apply_product_attributes('[]'::jsonb, '[]'::jsonb, true)",
            f"SELECT public.refresh_product_structure_stats('{today}'::date)",
        ):
            as_role(admin, role)
            try:
                with pytest.raises(errors.InsufficientPrivilege):
                    admin.execute(stmt)
            finally:
                admin.execute("ROLLBACK")
        # products has no write policy: an API role's UPDATE matches no row.
        as_role(admin, role)
        try:
            cur = admin.execute(f"UPDATE public.products SET msrp_usd = 1, msrp_source = 'x' WHERE id = {BOX}")
            assert cur.rowcount == 0
        except errors.InsufficientPrivilege:
            pass  # no table privilege at all is fine too
        finally:
            admin.execute("ROLLBACK")


def test_only_service_role_runs_the_loader_function(admin, loaded):
    as_role(admin, "pokefin_scraper")
    try:
        with pytest.raises(errors.InsufficientPrivilege):
            admin.execute("SELECT public.apply_product_attributes('[]'::jsonb, '[]'::jsonb, true)")
    finally:
        admin.execute("ROLLBACK")
    as_role(admin, "service_role")
    try:
        result = admin.execute(
            "SELECT public.apply_product_attributes('[]'::jsonb, '[]'::jsonb, true)").fetchone()[0]
        assert result["contents_deleted"] >= 7
    finally:
        admin.execute("ROLLBACK")
    assert admin.execute("SELECT count(*) FROM public.product_contents").fetchone()[0] >= 7


def test_scraper_role_refresh_includes_the_structure_step(admin, loaded, today):
    as_role(admin, "pokefin_scraper")
    try:
        summary = admin.execute("SELECT public.refresh_market_analytics(%s)", (today,)).fetchone()[0]
        assert summary["structure_rows"] >= 10
    finally:
        admin.execute("ROLLBACK")
```

### 4. `frontend/app/lib/__tests__/productAttributes.test.ts` (new, `@jest-environment node`)

```ts
/** @jest-environment node */
import type { ProductDailyStats } from "../../types/market";
import {
  boxCalculatorHref,
  formatMsrpMultiple,
  isNavStatus,
  msrpMultiplesById,
  NAV_STATUS_TEXT,
  NAV_STATUSES,
  toProductAttributesSnapshot,
} from "../productAttributes";

function statsRow(productId: number, multiple: number | null): ProductDailyStats {
  return { product_id: productId, day: "2026-09-30", msrp_multiple: multiple } as unknown as ProductDailyStats;
}

describe("formatMsrpMultiple", () => {
  it.each([
    [1.378, "1.4x"],
    [0.94, "0.9x"],
    [9.94, "9.9x"],
    [9.96, "10x"],
    [12.6, "13x"],
  ])("%p prints %p", (value, printed) => {
    expect(formatMsrpMultiple(value)).toBe(printed);
  });

  it.each([null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])("hides %p", (value) => {
    expect(formatMsrpMultiple(value)).toBeNull();
  });
});

describe("msrpMultiplesById", () => {
  it("keeps positive multiples only, rounded to 3 decimals", () => {
    const snapshot = {
      day: "2026-09-30",
      byProductId: { 1: statsRow(1, 1.378446), 2: statsRow(2, null), 3: statsRow(3, 0) },
    };
    expect(msrpMultiplesById(snapshot)).toEqual({ 1: 1.378 });
  });

  it("drops products the page shows without a current price", () => {
    const snapshot = { day: "2026-09-30", byProductId: { 1: statsRow(1, 1.4), 4: statsRow(4, 2.1) } };
    expect(msrpMultiplesById(snapshot, new Set([4]))).toEqual({ 4: 2.1 });
    expect(msrpMultiplesById(snapshot, new Set())).toEqual({});
  });

  it("is empty for an empty snapshot", () => {
    expect(msrpMultiplesById({ day: null, byProductId: {} })).toEqual({});
  });
});

describe("toProductAttributesSnapshot", () => {
  it("keys attributes by product, parses numeric strings and groups contents", () => {
    const snapshot = toProductAttributesSnapshot(
      [
        { product_id: 1, msrp_usd: "143.64", msrp_cad: null, msrp_source: "TPCi", release_date: "2024-11-22", release_date_source: "product", pack_count: 36 },
        { product_id: null, msrp_usd: null, msrp_cad: null, msrp_source: null, release_date: null, release_date_source: null, pack_count: null },
      ],
      [
        { product_id: 2, pack_set_id: 7, quantity: 4, promo_value_usd: "10" },
        { product_id: 2, pack_set_id: 8, quantity: 2, promo_value_usd: null },
        { product_id: 3, pack_set_id: 7, quantity: 0, promo_value_usd: null },
      ]
    );
    expect(snapshot.byProductId[1]).toEqual({
      product_id: 1, msrp_usd: 143.64, msrp_cad: null, msrp_source: "TPCi",
      release_date: "2024-11-22", release_date_source: "product", pack_count: 36,
    });
    expect(Object.keys(snapshot.byProductId)).toEqual(["1"]);
    expect(snapshot.contentsByProductId[2]).toHaveLength(2);
    expect(snapshot.contentsByProductId[2][0].promo_value_usd).toBe(10);
    expect(snapshot.contentsByProductId[3]).toBeUndefined();
  });
});

describe("NAV status copy", () => {
  it("has one sentence per status and narrows unknown values", () => {
    expect(Object.keys(NAV_STATUS_TEXT).sort()).toEqual([...NAV_STATUSES].sort());
    expect(isNavStatus("pack_price_withheld")).toBe(true);
    expect(isNavStatus("stale")).toBe(false);
    expect(isNavStatus(null)).toBe(false);
  });
});

it("links the calculator to a product", () => {
  expect(boxCalculatorHref(101)).toBe("/box-calculator?product=101");
});
```

### 5. `frontend/app/lib/__tests__/productAttributesConstants.test.ts` (new, `@jest-environment node`)

Ties the TypeScript status list and the SQL together, like WP25's `marketStatsConstants.test.ts`.

```ts
/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";
import { NAV_STATUSES } from "../productAttributes";

const MIGRATIONS = path.resolve(__dirname, "../../../../migrations");
const sql0036 = fs.readFileSync(path.join(MIGRATIONS, "0036_product_attributes.sql"), "utf8");

/** Text of the highest-numbered NNNN_*.sql file that defines `fn`. */
function newestDefinition(fn: string): string {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort().reverse();
  for (const file of files) {
    const text = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    if (new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`, "i").test(text)) return text;
  }
  throw new Error(`no numbered migration defines ${fn}`);
}

/** The text from `CREATE OR REPLACE FUNCTION public.<fn>(` to the next `$$;`. */
function functionBody(text: string, fn: string): string {
  // CREATE only: a GRANT or REVOKE line also contains "FUNCTION public.<fn>(".
  const start = text.search(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`, "i"));
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf("$$;", start);
  return text.slice(start, end);
}

it("NAV_STATUSES equals the nav_status CHECK list", () => {
  const match = sql0036.match(/nav_status IS NULL OR nav_status IN\s*\(([^)]*)\)/);
  expect(match).not.toBeNull();
  const listed = [...match![1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
  expect(listed).toEqual([...NAV_STATUSES]);
});

it("the structure step can write every status, and prices packs only from standard booster packs", () => {
  const body = functionBody(sql0036, "refresh_product_structure_stats");
  for (const status of NAV_STATUSES) expect(body).toContain(`'${status}'`);
  expect(body).toContain("t.name = 'booster_pack'");
  expect(body).toContain("NULLIF(btrim(p.variant), '') IS NULL");
});

it("the newest refresh_market_analytics runs the structure step after the stats step", () => {
  const body = functionBody(newestDefinition("refresh_market_analytics"), "refresh_market_analytics");
  const stats = body.indexOf(":= public.refresh_product_daily_stats(p_day)");
  const structure = body.indexOf(":= public.refresh_product_structure_stats(p_day)");
  expect(stats).toBeGreaterThan(-1);
  expect(structure).toBeGreaterThan(stats);
});
```

### 6. `frontend/app/components/BoxCalculator/__tests__/catalogOptions.test.ts` (new, `@jest-environment node`)

```ts
/** @jest-environment node */
import { toProductAttributesSnapshot } from "../../../lib/productAttributes";
import type { Product } from "../../../types/market";
import { buildCatalogBoxOptions } from "../catalogOptions";
import { amountIn, costPerPack, findCatalogOption, packsFromOption, parseProductParam } from "../catalogPrefill";

function product(id: number, over: Partial<Product>): Product {
  return {
    id,
    usd_price: 100,
    url: `https://www.tcgplayer.com/product/${id}`,
    last_updated: "2026-09-29T10:00:00",
    price_recorded_at: "2026-09-29T10:00:00",
    variant: null,
    sets: { id: 7, name: "Surging Sparks", code: "SSP", release_date: "2024-11-08" },
    product_types: { id: 1, name: "booster_box", label: "Booster Box" },
    ...over,
  } as Product;
}

const attributes = toProductAttributesSnapshot(
  [{ product_id: 1, msrp_usd: 143.64, msrp_cad: null, msrp_source: "TPCi", release_date: "2024-11-22", release_date_source: "product", pack_count: 36 }],
  [
    { product_id: 1, pack_set_id: 7, quantity: 36, promo_value_usd: null },
    { product_id: 2, pack_set_id: 7, quantity: 4, promo_value_usd: 10 },
    { product_id: 2, pack_set_id: 9, quantity: 2, promo_value_usd: 2.5 },
  ]
);

const products = [
  product(1, { usd_price: 199.97 }),
  product(2, {
    usd_price: null,
    price_recorded_at: "2026-09-02T10:00:00",
    variant: "Pokemon Center",
    sets: { id: 8, name: "Prismatic Evolutions", code: "PRE", release_date: "2025-01-17" },
    product_types: { id: 2, name: "premium_collection", label: "Premium Collection" },
  }),
  product(3, {}), // no contents: not an option
];

describe("buildCatalogBoxOptions", () => {
  const options = buildCatalogBoxOptions(products, attributes, [
    { id: 7, name: "Surging Sparks", code: "SSP", releaseDate: "2024-11-08" },
  ]);

  it("lists only products with recorded contents, newest first", () => {
    expect(options.map((o) => o.productId)).toEqual([2, 1]);
  });

  it("carries the display name, price, as-of day, MSRP and the product's own release date", () => {
    const box = findCatalogOption(options, 1)!;
    expect(box.name).toBe("Surging Sparks Booster Box");
    expect(box.usdPrice).toBe(199.97);
    expect(box.pricedOn).toBe("2026-09-29");
    expect(box.msrpUsd).toBe(143.64);
    expect(box.releaseDate).toBe("2024-11-22");
    expect(box.promoValueUsd).toBeNull();
  });

  it("keeps a withheld price as null with its last priced day, sums promo values and names every pack set", () => {
    const collection = findCatalogOption(options, 2)!;
    expect(collection.name).toBe("Prismatic Evolutions Premium Collection (Pokemon Center)");
    expect(collection.usdPrice).toBeNull();
    expect(collection.pricedOn).toBe("2026-09-02");
    expect(collection.promoValueUsd).toBe(12.5);
    expect(collection.releaseDate).toBe("2025-01-17");
    expect(collection.packs).toEqual([
      { setId: 7, setName: "Surging Sparks", quantity: 4 },
      { setId: 9, setName: "Set 9", quantity: 2 },
    ]);
  });
});

describe("catalog prefill helpers", () => {
  const box = { productId: 1, packs: [{ setId: 7, setName: "Surging Sparks", quantity: 36 }] };

  it("builds recipe rows with stable ids", () => {
    expect(packsFromOption(box as never)).toEqual([{ id: "catalog-1-7", setId: 7, setName: "Surging Sparks", quantity: 36 }]);
  });

  it("converts to the display currency in cents", () => {
    expect(amountIn(199.97, "CAD", 1.36)).toBe(271.96);
    expect(amountIn(199.97, "USD", 1.36)).toBe(199.97);
  });

  it("computes cost per pack only with a price and packs", () => {
    const rows = packsFromOption(box as never);
    expect(costPerPack(180, rows)).toBe(5);
    expect(costPerPack(0, rows)).toBeNull();
    expect(costPerPack(180, [])).toBeNull();
  });

  it("parses ?product= strictly", () => {
    expect(parseProductParam("101")).toBe(101);
    for (const bad of [null, "", "0", "-3", "1e3", "12a", "9999999999999"]) expect(parseProductParam(bad)).toBeNull();
  });
});
```

### 7. `frontend/app/components/BoxCalculator/__tests__/BoxCalculator.catalog.test.tsx` (new, jsdom): the picker pre-fill

Same mocking approach as WP06's `BoxCalculator.test.tsx`; the component renders outside `CurrencyProvider`, so the context fallback applies (display currency CAD at `DEFAULT_EXCHANGE_RATE`).

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import BoxCalculator from "../BoxCalculator";
import type { CatalogBoxOption } from "../catalogPrefill";
import { packValueBandsText } from "../nav";
import { DEFAULT_EXCHANGE_RATE } from "../../../lib/currency";
import { formatMoney } from "../../../lib/format";

let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({ useSearchParams: () => mockSearch }));

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: null, sessionStatus: "unauthenticated" }),
}));

const mockSets = [
  { id: 7, name: "Surging Sparks", code: "SSP", releaseDate: "2024-11-08" },
  { id: 8, name: "Evolving Skies", code: "EVS", releaseDate: "2021-08-27" },
];
// Surging Sparks packs are priced; Evolving Skies' pack is withheld (0023).
const mockPackUsd: Record<number, number | null> = { 7: 5, 8: null };
jest.mock("../hooks/useBoosterBoxPrices", () => ({
  useBoosterPackPrices: () => ({
    sets: mockSets,
    loading: false,
    getPackPrice: (setId: number) => mockPackUsd[setId] ?? null,
    getPackVariant: () => null,
  }),
}));

const mockRecipes = {
  savedRecipes: [],
  recipesLoading: false,
  recipesError: false,
  reloadRecipes: jest.fn(),
  saveRecipe: jest.fn(),
  setRecipeSharing: jest.fn(),
  deleteRecipe: jest.fn(),
  loadSharedRecipe: jest.fn(),
};
jest.mock("../hooks/useBoxRecipes", () => ({ useBoxRecipes: () => mockRecipes }));

const BOX: CatalogBoxOption = {
  productId: 101,
  name: "Surging Sparks Booster Box",
  typeLabel: "Booster Box",
  releaseDate: "2024-11-08",
  usdPrice: 199.97,
  pricedOn: "2026-09-29",
  msrpUsd: 161.64, // 36 x $4.49, the template's Scarlet & Violet rule
  msrpCad: null,
  promoValueUsd: null,
  packs: [{ setId: 7, setName: "Surging Sparks", quantity: 36 }],
};
const ETB_STALE_PACK: CatalogBoxOption = {
  productId: 102,
  name: "Evolving Skies Elite Trainer Box",
  typeLabel: "Elite Trainer Box",
  releaseDate: "2021-08-27",
  usdPrice: 90,
  pricedOn: "2026-09-29",
  msrpUsd: 39.99,
  msrpCad: null,
  promoValueUsd: 2.5,
  packs: [{ setId: 8, setName: "Evolving Skies", quantity: 8 }],
};
const BUNDLE_WITHHELD: CatalogBoxOption = {
  productId: 103,
  name: "Surging Sparks Booster Bundle",
  typeLabel: "Booster Bundle",
  releaseDate: "2024-11-08",
  usdPrice: null,
  pricedOn: "2026-09-02",
  msrpUsd: null,
  msrpCad: null,
  promoValueUsd: null,
  packs: [{ setId: 7, setName: "Surging Sparks", quantity: 6 }],
};
const CATALOG = [BOX, ETB_STALE_PACK, BUNDLE_WITHHELD];

const cad = (usd: number) => Math.round(usd * DEFAULT_EXCHANGE_RATE * 100) / 100;
const retailInput = () => screen.getByLabelText(/Retail \/ Sticker Price/) as HTMLInputElement;
const promoInput = () => screen.getByLabelText(/Promo \/ Extras Value/) as HTMLInputElement;
const picker = () => screen.getByLabelText("Start from a product") as HTMLSelectElement;
const recipeName = () => (screen.getByLabelText("Recipe name") as HTMLInputElement).value;

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockRecipes.loadSharedRecipe.mockResolvedValue(null);
  window.history.replaceState(null, "", "/box-calculator");
  jest.useFakeTimers({ now: new Date("2026-09-30T12:00:00Z") });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("?product=<id> pre-fills name, packs, retail and cost per pack on the first render", () => {
  mockSearch = new URLSearchParams("product=101");
  render(<BoxCalculator catalogBoxes={CATALOG} />);
  expect(picker().value).toBe("101");
  expect(recipeName()).toBe("Surging Sparks Booster Box");
  expect(screen.getAllByText("Surging Sparks").length).toBeGreaterThan(0); // pack row and breakdown
  expect(Number(retailInput().value)).toBe(cad(199.97));
  expect(promoInput().value).toBe("");
  expect(screen.getByText(/1\.2x MSRP/)).toBeInTheDocument(); // 199.97 / 161.64 = 1.237
  expect(screen.getByText(/MSRP \$161\.64 USD/)).toBeInTheDocument();
  const perPack = formatMoney(cad(199.97) / 36, "CAD");
  expect(screen.getByText(new RegExp(`Cost per pack: ${perPack.replace(/[$.]/g, "\\$&")} across 36 packs`))).toBeInTheDocument();
  // 36 packs at $5.00 = $180 NAV; $199.97 is 11.1% above it: WP24's label and bands.
  expect(screen.getByText("Above pack value")).toBeInTheDocument();
  expect(screen.getByText(packValueBandsText())).toBeInTheDocument();
});

it("catalog amounts follow the currency until the user types in the field", () => {
  mockSearch = new URLSearchParams("product=102");
  render(<BoxCalculator catalogBoxes={CATALOG} />);
  expect(Number(promoInput().value)).toBe(cad(2.5));
  fireEvent.click(screen.getByRole("radio", { name: /USD/ }));
  expect(Number(retailInput().value)).toBe(90);
  expect(Number(promoInput().value)).toBe(2.5);
  fireEvent.change(retailInput(), { target: { value: "85" } });
  fireEvent.click(screen.getByRole("radio", { name: /CAD/ }));
  expect(retailInput().value).toBe("85");
  expect(Number(promoInput().value)).toBe(cad(2.5));
});

it("a stale pack yields no NAV and says why, while cost per pack stays", () => {
  mockSearch = new URLSearchParams("product=102");
  render(<BoxCalculator catalogBoxes={CATALOG} />);
  const status = screen.getByText(/NAV unavailable:/).closest("[role='status']")!;
  expect(status).toHaveTextContent("no current Market Price for Evolving Skies");
  expect(status).toHaveTextContent("older than 14 days");
  expect(status).toHaveTextContent("never valued at $0");
  expect(screen.queryByText(/pack value$/)).not.toBeInTheDocument();
  expect(screen.getByText(/Cost per pack:/)).toBeInTheDocument();
});

it("a withheld product price leaves retail empty and asks for the quoted price", () => {
  mockSearch = new URLSearchParams("product=103");
  render(<BoxCalculator catalogBoxes={CATALOG} />);
  expect(retailInput().value).toBe("");
  expect(screen.getByText(/No current Market Price; last priced Sep 2, 2026\. Enter/)).toBeInTheDocument();
  expect(screen.queryByText(/Cost per pack:/)).not.toBeInTheDocument();
});

it("a shared recipe link wins over ?product=", () => {
  mockSearch = new URLSearchParams("recipe=abc12345&product=101");
  render(<BoxCalculator catalogBoxes={CATALOG} />);
  expect(picker().value).toBe("");
  expect(recipeName()).toBe("My Collection Box");
});

it("an unknown product id says there are no recorded contents", () => {
  mockSearch = new URLSearchParams("product=999");
  render(<BoxCalculator catalogBoxes={CATALOG} />);
  expect(screen.getByRole("status")).toHaveTextContent("Product 999 has no recorded pack contents yet");
});

it("picking a product fills the recipe and updates the URL without navigating", () => {
  const replace = jest.spyOn(window.history, "replaceState");
  render(<BoxCalculator catalogBoxes={CATALOG} />);
  fireEvent.change(picker(), { target: { value: "102" } });
  expect(recipeName()).toBe("Evolving Skies Elite Trainer Box");
  expect(replace).toHaveBeenLastCalledWith(null, "", "/box-calculator?product=102");
  fireEvent.change(picker(), { target: { value: "" } });
  expect(recipeName()).toBe("My Collection Box");
  expect(replace).toHaveBeenLastCalledWith(null, "", "/box-calculator");
});

it("shows no picker when no product has recorded contents", () => {
  render(<BoxCalculator />);
  expect(screen.queryByLabelText("Start from a product")).not.toBeInTheDocument();
});
```

Adapt only what the earlier packages force, and say so in the PR: the `AuthContext` mock shape (copy WP06's test and set `user: null`), the currency control's accessible names (WP23: radios named USD and CAD, in a radiogroup named "Currency", or "Recipe currency" after WP27), and the field names (WP14: the recipe name input's `aria-label` "Recipe name", the labels "Retail / Sticker Price (CAD)" and "Promo / Extras Value (CAD)"). Do not mock `lib/exchangeRate`: the component renders outside `CurrencyProvider` and never loads it, and WP26 may have removed that module. If `role="status"` matches more than one element in the unknown-id case, use `getByText(/Product 999 has no recorded pack contents yet/)`.

### 8. `frontend/app/components/ui/__tests__/MsrpMultiple.test.tsx` (new)

- `render(<MsrpMultiple value={1.378} />)`: the visible text is `1.4x MSRP` (in an `aria-hidden` span), the `sr-only` text is `1.4 times MSRP`, and the wrapper's `title` is "Market Price divided by US MSRP".
- `value={12.6}` shows `13x MSRP`.
- `value={null}`, `undefined`, `0` and `NaN` render nothing (`container` is empty).
- `expect(await axeViolations(container)).toEqual([])` for the 1.378 case (WP23's `@/test-utils/axe`).

### 9. `frontend/app/components/ProductPrices/__tests__/ProductCard.msrp.test.tsx` (new)

Copy the render helper and mocks from WP26's `ProductCard.history.test.tsx` (the minimal product, `LazyPriceChart` mock, `historyLoadingStore`). Cases, each for `viewMode="flat"` and `viewMode="grouped"`:

- `msrpMultiple={1.378}`: the card contains `1.4x MSRP`.
- `msrpMultiple={null}` and the prop omitted: the card contains no text matching `/MSRP/`.

### 10. `frontend/app/lib/__tests__/serverMarketData.attributes.test.ts` (new, `@jest-environment node`)

Same `server-only`, `@supabase/supabase-js`, `../logger` and `next/cache` mocks and the same `tableMock` helper as WP25's `serverMarketData.stats.test.ts`, with the Supabase `from` mock returning a separate chain per table name. Cases:

- `getCachedProductAttributes` reads `product_catalog_attributes` (select string contains `release_date_source` and `pack_count`, no `*`, ordered by `product_id` ascending) and `product_contents` (ordered by `product_id` then `pack_set_id`), and returns a snapshot whose `byProductId[1].msrp_usd` is `143.64` for a row that sent `"143.64"`, and whose `contentsByProductId[1]` holds the row's `quantity`.
- An error on either table returns `{ byProductId: {}, contentsByProductId: {} }` and calls `logCaughtError` with `"server_product_attributes_failed"`.
- `getCachedProductStats` (WP25's case) now selects `msrp_multiple`, `cost_per_pack_usd`, `nav_usd`, `premium_to_packs_pct` and `nav_status` as well: assert the select string contains each.

### 11. `frontend/app/components/BoxCalculator/__tests__/useBoosterBoxPrices.test.tsx` (update)

Keep every existing case. Add, using the file's `buildBoosterPackData` helpers:

- A set with a standard pack (priced or not): `getPackVariant(setId)` is `null`.
- A set with only variants priced 6 ("Sleeved") and 4 ("Pokemon Center"): `getPackPrice` is 4 and `getPackVariant` is `"Pokemon Center"`.
- A set with only unpriced variants, and an unknown set: `getPackVariant` is `null`.

### 12. Updates to WP24's and WP25's tests

- `app/lib/__tests__/metricDefinitions.test.ts`: add `metricHref("msrpMultiple")` is `/methodology#msrp`, `metricHref("costPerPack")` is `/methodology#cost-per-pack`, `metricHref("packNav")` and `metricHref("premiumToPacks")` are `/methodology#box-nav`. The existing cases (unique keys, 120-character limit, real anchors, banned words) cover the new entries unchanged.
- `app/methodology/__tests__/MethodologyArticle.test.tsx`: add cases: `#msrp` contains `x MSRP = Market Price ÷ US MSRP`; `#cost-per-pack` contains `Cost per pack = Market Price ÷ booster packs`; for every status in `NAV_STATUSES`, `#box-nav tr[data-nav-status="<status>"]` contains `NAV_STATUS_TEXT[status]`; `#changes` has one more row than before this package (three after WP24 and WP25; four if WP29 merged first), the first with `METHODOLOGY_VERSION`, the second with the previous version (`"1.1"` unless Before you start said otherwise). Count the rows with `METHODOLOGY_CHANGES.length`, not a literal. The existing anchor-existence, em dash and axe cases cover the new sections unchanged.
- WP06's `app/components/BoxCalculator/__tests__/BoxCalculator.test.tsx`: only the `getPackVariant: () => null` addition from step 10.
- WP25's `app/lib/__tests__/marketStats.test.ts`, read-time gate case (step 5c): with the full row (now carrying `msrp_multiple: 1.4`, `cost_per_pack_usd: 5.5`, `nav_usd: 180`, `premium_to_packs_pct: 10`, `nav_status: "ok"`) and `{ today: "2026-10-02" }` (3 days), the four numbers are `null` and `nav_status` is `"box_price_withheld"`; with `{ today: "2026-10-01" }` they are unchanged. Add a row with `nav_status: null` read 3 days late: it stays `null` (no contents is not a withheld price). Add `"msrp_multiple"`, `"cost_per_pack_usd"`, `"nav_usd"` and `"premium_to_packs_pct"` to the case that lists the price-anchored columns `STALE_ROW_WITHHELD_COLUMNS` must contain.

## Verification

Repo root:

```bash
python3 verify_migration.py migrations/0036_product_attributes.sql > /dev/null; echo "exit=$?"   # exit=3
grep -c "^-- privilege" <(python3 verify_migration.py migrations/0036_product_attributes.sql 2>&1 >/dev/null)   # 54

PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh
# "OK: <N> files replayed once (replay_once) and twice (replay_twice)"

python -m pytest tests/ -q
# all pass; tests/test_wp28_product_attributes_db.py skips (19 more skipped than the baseline)

POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once python -m pytest tests/ -q
# all pass: tests/test_wp28_product_attributes_db.py 19 passed, tests/test_wp25_market_analytics_db.py 22 passed;
# run it twice: the second run must pass too

python -m pytest tests/test_wp28_product_attributes.py -q                  # 41 passed
python3 -m py_compile scripts/load_product_attributes.py scripts/make_attribute_template.py
python scripts/load_product_attributes.py --check
# "Files OK: 0 reviewed attribute rows, 0 reviewed contents rows, 0 rows pending review."
python scripts/load_product_attributes.py --check \
  --attributes tests/fixtures/wp28/product_attributes.csv --contents tests/fixtures/wp28/product_contents.csv
# "Files OK: 5 reviewed attribute rows, 7 reviewed contents rows, 2 rows pending review."
```

Timing on the replayed database (print it for the PR; WP25's 10 s budget test covers it):

```bash
psql "postgresql://postgres:postgres@localhost:55432/replay_once" -c "\timing on" \
  -c "SELECT public.refresh_market_analytics((now() AT TIME ZONE 'UTC')::date)"
# the result includes "structure_rows"; the prototype measured 5.7 ms for the structure step
# and 0.75 s for the whole refresh at production size
```

From `frontend/` (phase B, after step 18):

```bash
pnpm exec tsc --noEmit                                       # exit 0
pnpm lint                                                    # 0 errors (WP17 gate)
pnpm test --ci app/lib/__tests__/productAttributes app/lib/__tests__/productAttributesConstants \
  app/lib/__tests__/serverMarketData app/components/BoxCalculator app/components/ui \
  app/components/ProductPrices app/lib/__tests__/metricDefinitions app/methodology
# all pass
pnpm test --ci                                               # whole suite passes
pnpm build:stub                                              # exit 0; /prices and /box-calculator still static (Revalidate 1d)
grep -cP '\x{2014}' app/lib/productAttributes.ts app/components/ui/MsrpMultiple.tsx \
  app/components/BoxCalculator/*.ts app/components/BoxCalculator/*.tsx app/methodology/MethodologyArticle.tsx   # 0 each
grep -rn "product_contents\|product_catalog_attributes" app --include=*.tsx | grep -v __tests__
# no output: no component reads the tables directly (only serverMarketData.ts does)
```

Performance (WP22 gate), from `frontend/`:

```bash
SUPABASE_STUB_FIXTURE=perf pnpm build:stub       # exit 0, no unmatched stub request
node scripts/perf-serve.mjs &                     # wait for .perf/ready
pnpm perf:budget                                  # exit 0, no limit raised
```

Compare with the same run on `master` and paste both tables in the PR. Expected deltas: `/prices` `documentBrKb` at most +1.0, `flightBrKb` at most +1.0 and `jsGzKb` at most +0.5; `/box-calculator` `jsGzKb` at most +3.0; every other route unchanged within 0.3 kB. A larger delta means the snapshot or the product list leaked into a client prop: fix it, do not raise a limit. `pnpm run test:scripts` passes (fixture coverage sees both request logs).

Manual checks (`pnpm build:stub` with the perf fixture, then `node scripts/perf-serve.mjs`, browser at 390x844 and 1440x900):

1. `/prices`: booster boxes, ETBs and bundles show an `N.Nx MSRP` caption under the price; other types show none; the stale products (900300 to 900305) show none; toggling USD/CAD leaves the multiples unchanged; the sparkline slot is still 96x40 and nothing shifts on load (Lighthouse CLS unchanged).
2. `/box-calculator`: the "Start from a product" card lists products grouped by type; picking a booster box fills the name, a 36-pack row, retail in CAD and the cost-per-pack line, and the URL shows `?product=<id>`; reload keeps it; switching to USD converts retail; typing a retail and switching back keeps the typed value; "Build your own recipe" clears the recipe and the parameter. In the fixture every pack set lacks a standard pack, so the NAV card reads "no booster pack tracked for ...": that is the expected fixture state.
3. `/box-calculator?product=999999`: the "no recorded pack contents" line; no error in the console.
4. At 390 px the select is full width, 44 px tall, and focusing it does not zoom the page (iOS Safari or the Chrome device toolbar's touch emulation).
5. Keyboard only: Tab reaches the picker; arrow keys change the product; the recipe fills without a page reload; screen reader (VoiceOver or NVDA) announces "Start from a product" and the hint.
6. `/methodology#msrp`, `#cost-per-pack` and `#box-nav` render with the reason table; the version and change log show the bump.

## Owner actions

1. **Apply the migration** with Supabase MCP `apply_migration` (preferred) or the SQL editor: `0036_product_attributes.sql`, after 0033 and 0034 (0035 may come before or after it). Then run the `verify_migration.py` query for 0036: every row OK. The 0033 and 0034 queries now each report one `MISMATCH` for the `refresh_market_analytics` body (superseded by 0036, expected). Then run `SELECT public.refresh_market_analytics((now() AT TIME ZONE 'UTC')::date);` (the result includes `structure_rows`, about the active product count) and the three verification queries in the migration header (expect 0, 0, and `false, false`). Apply before the code deploys: the new stats columns are selected by name.
2. **Types for phase B.** Run `pnpm types:db` with your access token and push `frontend/app/types/database.ts` to the branch, or give the executor a token.
3. **Curate (decision D7, about 3 to 5 hours).** From the repo root with the scraper env sourced (`set -a && source ~/.config/pokefin/env && set +a`):
   - `python scripts/make_attribute_template.py` (dry run: prints the counts and the first rows), then `python scripts/make_attribute_template.py --write`.
   - Open both CSVs in a spreadsheet. For each row: check the MSRP against the product's official listing or launch announcement and replace `msrp_source` with the real source (for example "Pokemon Center listing, 2024-11"); add `msrp_cad` where you know the Canadian MSRP; set `release_date` only when the product launched on a different day than its set; for collections and other products without a rule, add one contents row per pack set with its quantity; leave `promo_value_usd` blank unless you want a promo counted in NAV (it is your estimate, shown as "recorded promo value"). Set `reviewed` to `yes` on every row you checked. A row you cannot verify stays `no` and never loads.
   - `python scripts/load_product_attributes.py --check` until it prints "Files OK", then commit both files to `master` in a PR titled `data: curate MSRP and pack contents (WP28)`.
4. **Load.** With the service key available to `secrets_loader.load_supabase_credentials` and `REVALIDATE_URL`/`REVALIDATE_SECRET` set: `python scripts/load_product_attributes.py` (dry run: read every `UNKNOWN` line; fix or remove those rows), then `python scripts/load_product_attributes.py --apply`. Expect "Applied: {...}", "Market analytics refreshed for ...: {..., "structure_rows": ...}" and "Site caches revalidated."
5. **Optional history.** `python scripts/backfill_daily_stats.py` re-runs 400 days (about 7 minutes) so the new columns have a past (MSRP and contents are static, so past days compute correctly). WP31's premium-over-time view uses it.
6. **Check production**: `/prices` shows x MSRP on curated products; `/box-calculator?product=<a booster box id>` is fully pre-filled; and in the SQL editor `SELECT nav_status, count(*) FROM public.product_stats_latest GROUP BY 1;` shows `ok` for boxes whose packs are fresh.
7. **Record it.** In `audits/HARDENING_FOLLOWUPS.md` section 7, change "**Migration 0036: pending apply**" to "**Migration 0036 applied** (YYYY-MM-DD, via Supabase MCP)" with the counts from step 4, and commit to `master` as `docs: record migration 0036 as applied`.
8. **Later, for each new product**: `make_attribute_template.py --write` appends only products the files do not list; review, commit, load.

## Acceptance criteria

- [ ] `migrations/0036_product_attributes.sql` exists with the content of step 1; no other migration file changed; `verify_migration.py` exits 3 with 54 privilege lines; the replay harness passes once and twice.
- [ ] `tests/test_wp28_product_attributes_db.py`: 19 passed against `replay_once`, twice in a row; skipped without the env var; WP25's DB module still passes.
- [ ] With the fixture CSV loaded, the booster box's `product_daily_stats` row has `msrp_multiple` 198/143.64, `cost_per_pack_usd` 5.5, `nav_usd` 180, `premium_to_packs_pct` 10 and `nav_status` `ok`.
- [ ] A stale pack gives `nav_usd` NULL with `nav_status = 'pack_price_withheld'` and keeps cost per pack; a stale box has every structure column NULL (`box_price_withheld`); a variant-only set gives `no_standard_pack`; no structure value exists where `is_price_fresh` is false.
- [ ] `anon` and `authenticated` can SELECT `product_contents`, `product_catalog_attributes` and the new `product_stats_latest` columns, and cannot write `product_contents` or execute `apply_product_attributes` or `refresh_product_structure_stats`; `pokefin_scraper` cannot execute `apply_product_attributes` but its refresh includes the structure step; `service_role` can execute `apply_product_attributes`.
- [ ] `apply_product_attributes` is a full sync, idempotent (a second identical call changes 0 rows), rejects unknown ids, duplicates and an unguarded empty payload, and writes nothing when it fails.
- [ ] `scripts/load_product_attributes.py` and `scripts/make_attribute_template.py` exist and are executable; `tests/test_wp28_product_attributes.py` passes (41 cases); `--check` passes on the committed header-only CSVs.
- [ ] `data/product_attributes.csv` and `data/product_contents.csv` are committed with headers only.
- [ ] `getCachedProductStats` exposes the five new fields; `getCachedProductAttributes` exists, is tagged `market-products`, degrades uncached on error.
- [ ] `STALE_ROW_WITHHELD_COLUMNS` contains the four structure numbers, and a stats row read more than `STATS_ROW_MAX_AGE_DAYS` late has them `null` and `nav_status` `"box_price_withheld"` (or `null` when it had no contents); `marketStats.test.ts` proves it.
- [ ] `/prices` cards show `N.Nx MSRP` under the price when a multiple exists and nothing otherwise; the page sends only an id-to-multiple map, built only for products it shows with a current price; with WP30 merged first, `shared/msrp.ts` is WP30's variant A re-export.
- [ ] `/box-calculator?product=<id>` renders with the picker set, recipe name, packs, promo and retail pre-filled on the first render; the retail and promo follow the currency until edited; picking updates `?product=` without navigation; a shared `?recipe=` wins; an unknown id shows the "no recorded pack contents" line; the picker is hidden when no product has contents.
- [ ] A stale pack in the calculator shows "NAV unavailable:" with the set name and the 14-day reason and no verdict; cost per pack still shows; a variant-priced pack row says "priced from {variant} pack".
- [ ] WP24's verdict label, band thresholds and decision note render unchanged beside the verdict.
- [ ] `/methodology` shows the bumped version, `#msrp`, `#cost-per-pack` and the `#box-nav` reason table; `metricDefinitions.ts` has the five new keys; the drift test ties `NAV_STATUSES` to the SQL.
- [ ] `perf.mjs` routes `/rest/v1/product_catalog_attributes` and `/rest/v1/product_contents`; `pnpm perf:budget` exits 0 with no limit raised and the deltas stated in Verification.
- [ ] `app/types/database.ts` is regenerated (phase B); `tsc`, lint and the whole Jest suite pass; `pnpm build:stub` exits 0.
- [ ] README and `audits/HARDENING_FOLLOWUPS.md` updated (step 16).

## Rollback

- **Code**: revert the PR. `/prices` loses the caption, the calculator loses the picker; the loader and template disappear. The database objects stay and are harmless: nothing else reads them, and the refresh keeps filling the columns.
- **Curated data**: the CSVs in git are the source of truth; re-running the loader restores the database from them at any time.
- **Database** (after the code revert, and only after reverting the packages that read these objects: WP30, WP31, WP33, WP34 and WP35 read them softly, so their code must stop selecting the columns first). As a new numbered migration `NNNN_drop_product_attributes.sql` at the next free number, never by editing 0036:

```sql
-- 1. Put back the refresh without the structure step: paste section 3 of
--    migrations/0034_fx_daily.sql verbatim here (from
--    "CREATE OR REPLACE FUNCTION public.refresh_market_analytics" through its
--    GRANT EXECUTE line). Do not re-run the whole 0034 file.

-- 2. Drop this package's objects.
DROP FUNCTION IF EXISTS public.apply_product_attributes(jsonb, jsonb, boolean);
DROP FUNCTION IF EXISTS public.refresh_product_structure_stats(date);
DROP VIEW IF EXISTS public.product_catalog_attributes;
DROP TABLE IF EXISTS public.product_contents;

-- 3. The view must be re-created to lose columns: drop it, drop the columns,
--    then paste section 5 of migrations/0033_product_daily_stats.sql verbatim
--    (the CREATE OR REPLACE VIEW public.product_stats_latest statement and its
--    REVOKE and GRANT lines).
DROP VIEW IF EXISTS public.product_stats_latest;
ALTER TABLE public.product_daily_stats
  DROP COLUMN IF EXISTS msrp_multiple,
  DROP COLUMN IF EXISTS cost_per_pack_usd,
  DROP COLUMN IF EXISTS nav_usd,
  DROP COLUMN IF EXISTS premium_to_packs_pct,
  DROP COLUMN IF EXISTS nav_status;

-- 4. Products: the four columns and their constraints.
ALTER TABLE public.products
  DROP COLUMN IF EXISTS msrp_usd,
  DROP COLUMN IF EXISTS msrp_cad,
  DROP COLUMN IF EXISTS msrp_source,
  DROP COLUMN IF EXISTS release_date;
```

  Then regenerate `app/types/database.ts`.

## Commit and PR

Branch: `remediation/wp28-msrp-and-pack-contents`.

Commits (phase A, in this order; phase B adds the fourth):

1. `feat(db): product attributes, pack contents and catalog NAV (WP28)`: `migrations/0036_product_attributes.sql`, `tests/test_wp28_product_attributes_db.py`, `tests/fixtures/wp28/*`.
2. `feat(scripts): curated MSRP and contents loader and template (WP28)`: both scripts, `data/*.csv` (headers), `tests/test_wp28_product_attributes.py`, `README.md`, `audits/HARDENING_FOLLOWUPS.md`.
3. `feat(ui): x MSRP on cards, calculator starts from a catalog product (WP28)`: everything under `frontend/`.
4. `chore(types): regenerate database types for 0036 (WP28)`.

Squash-merge message:

```text
feat: MSRP, pack contents, cost per pack and catalog box NAV (WP28)

x MSRP and cost per pack are the numbers sealed collectors price in, and
the calculator made every visitor type a recipe even for a booster box.

- 0036: products.msrp_usd, msrp_cad, msrp_source, release_date;
  product_contents; product_daily_stats gains msrp_multiple,
  cost_per_pack_usd, nav_usd, premium_to_packs_pct and nav_status,
  written by a new step of refresh_market_analytics under the 0023 gate;
  packs price a set only through its standard booster pack;
  product_catalog_attributes (release date defaults to the set's);
  apply_product_attributes, SECURITY DEFINER, EXECUTE for service_role only.
- data/*.csv are the source of truth (reviewed rows only);
  scripts/load_product_attributes.py validates, diffs and applies;
  scripts/make_attribute_template.py appends rule-based starter rows.
- /prices cards show x MSRP; the Box NAV calculator starts from a catalog
  product (?product=<id>), shows cost per pack, says why NAV is missing and
  labels variant-priced packs.
- /methodology: #msrp, #cost-per-pack, catalog NAV and its reasons.
```

PR title: `feat: MSRP, pack contents, cost per pack and catalog box NAV (WP28)`

PR body:

- Goal in two sentences and a link to this spec.
- Phase status: "[waiting for DB types]" until step 18, then removed.
- Verification output: `verify_migration.py` stderr, the replay harness's last line, pytest summaries with and without `POKEFIN_TEST_DATABASE_URL` (both runs of the DB modules), the refresh timing, the two `--check` outputs, tsc, lint, Jest summary, `perf:budget` tables for `master` and the branch.
- Screenshots at 390 and 1440 px: a `/prices` group with x MSRP captions; `/box-calculator?product=<id>` pre-filled; the NAV-unavailable card; `/methodology#box-nav`.
- Owner actions 1 to 8 copied from this spec, with the outputs of 1 and 4 once run.
- Any dependency artifact that was missing and what was done (Before you start), and any adaptation in the tests (Tests item 7).
- "Noticed, out of scope": the product page shows x MSRP, cost per pack and NAV in WP31; the screener's Value preset and Below pack value filter are WP33; the list view's x MSRP column is WP30; the MSRP alert suggestion is WP35; product release dates reach new-release feeds in WP32; the calculator still offers a variant fallback for hand-built recipes (labelled now); a curated `set_events` table (print status, reprints) is deferred (`01-PRODUCT-DIRECTION.md` §10).
