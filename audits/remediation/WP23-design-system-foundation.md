# WP23: Design system foundation: semantic tokens, finance components, phone list pattern

- **Goal**: every page speaks one visual language. Red is only the brand, gains and losses read without colour (glyph plus text), sortable tables are dense with a visible sort state, and every dataset has a phone list pattern, so Track 2 packages assemble pages from shared components instead of reinventing them.
- **Why now / value**: WP24 to WP37 all build UI. Without a shared `Delta`, `Stat`, `SegmentedControl`, `DataList`, `AsOf` and `Button`, each package would invent its own (the audit already counts three hand-built segmented controls and a brand red doing four jobs). Landing the vocabulary once, with a conventions test that blocks regressions, makes every later page cheaper and consistent.
- **Effort**: L, about 15 hours (tokens and fonts 1.5 h, `format.ts` 1 h, 12 components 6 h, control/skeleton/table migrations 3 h, conventions test and README 1.5 h, tests and verification 2 h).
- **Depends on**: WP07 (`app/lib/format.ts`), WP14 (`app/components/ui/Dialog.tsx`, `--pf-gain-text`/`--pf-loss-text`, jsdom `<dialog>` polyfill, `controls.a11y.test.tsx`), WP15 (`app/__tests__/uiConventions.test.ts`, `app/components/ui/ConfirmDialog.tsx`, no `red-*` utilities left), WP18 (`app/components/SortableTable/SortableTable.tsx`, `app/compare/compareColumns.tsx`), WP19 (`MarketView/columns.tsx` renders `MiniSparkline` inside the memoised `MarketTableRow`), WP20 (`CurrencyProvider`, shared `CurrencySelector` on `/prices`, `/market`, `/box-calculator`, `/portfolio`), WP22 (`frontend/perf-budgets.json`, `pnpm perf:budget`). Through them: WP00 (`pnpm build:stub`), WP08 (`/prices` URL state, `updateUrlState`, `cardList`), WP09 (SVG `MiniSparkline`, `buildSparklinePath`), WP13 (`NotFoundPanel.tsx` search form), WP17 (blocking lint and tests).
- **Unblocks**: WP24 (uses `AsOf`, `ProvenanceLine`, `Stat` label slot), WP26 (`Skeleton`, the "No history" state, the `DataListRow` 64x24 sparkline slot), WP27 (`Button`, `SegmentedControl`, `--pf-accent` for the new mark), WP30 and WP33 (`DataList`, dense `SortableTable`, `Delta`, `Badge`), WP31 and WP32 (`Stat`, `Delta`, `RangeBar`, `AsOf`, `PageHeader`), WP34 to WP37 (all of the above).
- **Placement**: after WP20 (the last frontend package of the existing plan) and after WP22, before every Track 2 UI package. It deliberately runs after WP14 and WP15, not before: WP14 ships `Dialog` and the contrast tokens and WP15 fixes drift within the current look. Moving it earlier would force WP14, WP15, WP18 and WP19 to rewrite their class-level steps. No existing spec changes.
- **Suggested branch name**: `remediation/wp23-design-system-foundation`
- **Risk level**: medium. No data, API or schema change, but it edits `globals.css` (loaded by every page), the root layout's fonts, and the shared currency, timeframe and view controls used on `/prices`, `/market`, `/box-calculator` and `/portfolio`.

## Why

Today the site has tokens but no system: red is the logo, the primary CTA, the loss colour and the promo at once, so "buy here" and "down 12%" look alike; gain and loss rely on colour alone in most places; the `/prices` timeframe, currency and view toggles are three hand-built button rows with different semantics (radiogroup, `aria-pressed`, group), each about 28 px tall on a phone; the sparkline skeleton is a fake upward zigzag that reads as data; and tables use 93 px card rows with no visible sort state (`research/ui-audit.md` "Cross-cutting: Visual language", `/` item 4, `/market` items 1 and 2, top-10 items 1 and 9). Geist Mono is downloaded on four routes only to render set codes (`research/performance-excellence.md` §9 item 2). This package adds the semantic tokens and twelve components that Track 2 builds on, migrates the three `/prices` toggles, the sparkline skeleton, the one generic sortable table and the search inputs to them, drops Geist Mono, and extends WP15's conventions test so red, `font-mono` and new raw hex colours cannot creep back. Collectors on phones get 44 px toggles that respond on the next frame (`research/performance-excellence.md` §13.1, §13.2); every later package gets finance-grade parts with the precision rules of `01-PRODUCT-DIRECTION.md` §3 built in. Page redesigns stay in their own packages, so the visible change here is limited to the migrated controls.

## Design

### Decisions (binding, from `01-PRODUCT-DIRECTION.md` §3)

- Light-only theme. `:root { color-scheme: light }`. No dark tokens ship.
- Brand red `--pf-accent` (#dc2626) is for the logo mark and the accent "é" only. Blue `--pf-action` (#2563eb, hover `--pf-action-strong` #1d4ed8) is the action colour: primary buttons, links, focus ring, selected segment.
- Gain `--pf-gain-text` (#047857) always with ▲, loss `--pf-loss-text` (#be123c) always with ▼, flat `--pf-ink-soft` (#475569) with no glyph. Flat means strictly inside ±0.05% (`FLAT_BAND_PERCENT`), which is exactly the set of values that would print as `0.0%`.
- Amber is the warning role: `--pf-warn-text` #b45309 (5.0:1 on white), `--pf-warn-fill` #fffbeb.
- Geist Mono is dropped. Set codes render as `font-sans tabular-nums tracking-wide uppercase`.
- Two radii: 8 px (`rounded-control`) for controls and chips, 12 px (`rounded-card`) for cards and dialogs. Spacing is Tailwind's default 4 px base. Borders first; shadow only on overlays.
- Rows: 44 px on desktop tables (`h-11`), 40 px table header (`h-10`), 56 px minimum phone list rows (`min-h-14`).
- Badge budget: at most one badge per row. Badge variants are text (no pill): `neutral`, `info`, `warn`.
- Precision: returns and changes 1 decimal; shares and consistency integers (`formatPercent(v, { decimals: 0 })`). Money stays WP07 `formatMoney`.
- Touch targets: every new interactive control gets `pointer-coarse:min-h-11` (44 px on touch screens, unchanged density with a mouse).
- Motion: colour and opacity transitions only, 150 ms, `motion-reduce:transition-none`. No pulsing skeletons, no count-ups.
- Existing red CTAs are not repainted in this PR (no visual change outside the migrated controls). `--pf-pokeball` becomes a deprecated alias of `--pf-accent`, and the conventions test ratchets its use per file so it can only go down. Page packages (WP27, WP30 to WP37) repaint their own CTAs with `Button`.

### Tokens (`frontend/app/globals.css`)

| Token | Value | Tailwind utility | Role |
|---|---|---|---|
| `--pf-accent` | #dc2626 | `text-accent`, `bg-accent` | Logo mark and wordmark "é" only (conventions test enforces) |
| `--pf-action` | #2563eb | `bg-action`, `text-action`, `ring-action` | Primary button, link, focus ring, selected segment |
| `--pf-action-strong` | #1d4ed8 | `bg-action-strong`, `text-action-strong` | Hover and pressed action, info badge text |
| `--pf-pokeball`, `--pf-pokeball-strong` | alias of accent, #b91c1c | existing | Deprecated, ratcheted |
| `--pf-pokeblue`, `--pf-pokeblue-strong` | alias of action, action-strong | existing | Deprecated alias, same values |
| `--pf-gain-text`, `--pf-loss-text` | #047857, #be123c (WP14) | `text-gain-text`, `text-loss-text` | Change and return text only |
| `--pf-warn-text`, `--pf-warn-fill` | #b45309, #fffbeb | `text-warn-text`, `bg-warn-fill` | Stale price, delayed pipeline, provisional day |
| `--pf-chart-line` | #1d4ed8 | `stroke-chart-line` | Price line (WP26, WP31) |
| `--pf-chart-bench` | #64748b | `stroke-chart-bench` | Benchmark line, dashed (WP29, WP31, WP36) |
| `--pf-chart-grid` | #e2e8f0 | `bg-chart-grid`, `stroke-chart-grid` | Gridlines, range track |
| `--pf-chart-volume` | #cbd5e1 | `fill-chart-volume` | Volume bars |
| `--pf-border` | #e2e8f0 (existing) | `border-line`, `divide-line` (new alias) | Dividers |
| `--pf-radius-control`, `--pf-radius-card` | 8px, 12px | `rounded-control`, `rounded-card` | The two radii |
| type scale | see below | `text-display` ... `text-caption` | |

Type scale (`@theme`, rem at a 16 px root): `text-display` 32/40, `text-h1` 24/32, `text-h2` 20/28, `text-h3` 16/24, `text-body` 14/20, `text-prose` 16/26, `text-small` 13/18, `text-caption` 12/16. Weights are set with `font-semibold` (600) on display and headings. Nothing smaller than 12 px in new components.

### Components (`frontend/app/components/ui/`)

All are server-compatible (no `"use client"`) except `SegmentedControl`. All use token utilities only: no raw palette classes (`slate-*`, `blue-*`...) and no hex, enforced by the conventions test. Default exports, direct imports (no barrel `index.ts`; WP20 removed barrels).

| Component | Props (summary) | Rendering and states |
|---|---|---|
| `Delta` | `value: number \| null \| undefined` (percent units), `period?`, `missingReason?`, `className?` | Up: `▲ 4.2%` in `text-gain-text`; down: `▼ 3.1%` in `text-loss-text`; flat: `0.0%` in `text-ink-soft`, no glyph. Glyph is `aria-hidden`; an `sr-only` word ("Up", "Down", "Unchanged") carries direction. Missing: visible `--` plus `sr-only` reason (default "Not available"). `data-direction` attribute for tests. Optional `period` ("30D") in ink-soft after the number |
| `Stat` | `label: ReactNode`, `value: ReactNode`, `sub?`, `delta?`, `asOf?`, `size?: "default" \| "hero"` | Label (small, ink-soft), value (`text-h2`, or `text-display` for hero) with `delta` beside it, then sub-line and as-of line (caption). The label slot takes WP24's `MetricLabel` |
| `Badge` | `variant?: "neutral" \| "info" \| "warn"`, `children` | 12 px medium text. neutral ink-soft, info action-strong, warn warn-text with a warning triangle icon (`aria-hidden`). No fill, no border, no pill |
| `SegmentedControl<T>` | `label`, `ariaLabel?`, `hideLabel?`, `options: {value,label,ariaLabel?}[]`, `value`, `onChange`, `trailing?`, `fullWidthOnPhone?` (default true), `className?` | `role="radiogroup"` of `<button role="radio">`. Roving tabindex (only the checked radio is in the tab order). Arrow keys move focus and select, with wrap; Home/End. `onChange` runs inside `startTransition`; the pressed state is `useOptimistic`, so it paints on the next frame while the page re-renders. Selected: `bg-action text-white`; others ink-soft with `hover:bg-surface-alt`. 12 px semibold labels, `pointer-coarse:min-h-11 pointer-coarse:min-w-11`. Phones: full width, equal segments |
| `PageHeader` | `title`, `provenance?`, `actions?` | `h1.text-h1`; provenance slot under it; actions right-aligned on desktop, below on phones |
| `DataList`, `DataListRow` | list: `label`, `children`; row: `href?`, `title`, `subtitle?`, `meta?`, `value?`, `delta?`, `sparkline?`, `leading?`, `prefetch?` (default false) | `<ul aria-label>` with divided `<li>` rows, each `min-h-14` and one link (`next/link`, `prefetch={false}` by default). Line 1: title (medium, truncated) and subtitle (small, ink-soft). Line 2: meta left, value and delta right, tabular. Optional 40x40 leading slot; optional sparkline slot fixed at 64x24 (`h-6 w-16`, `aria-hidden`) |
| `EmptyState` | `title`, `description?`, `action?`, `headingLevel?: 2 \| 3` | Dashed-border card, centred. Title is a `<p>` unless `headingLevel` is given |
| `Skeleton` | `className?` | `aria-hidden` flat bar, `bg-surface-alt rounded-control`. No animation, no shape |
| `RangeBar` | `low`, `high`, `value`, `lowLabel`, `highLabel`, `windowLabel?` (default "52-week"), `showSummary?` | Track (`bg-chart-grid`) with an ink marker at the clamped position; low and high labels under it; a summary sentence ("38% below 52-week high", "At 52-week high", "At 52-week low", "Less than 1% below 52-week high", "No 52-week range yet"), `sr-only` unless `showSummary`. Non-finite input renders nothing |
| `Button` + `buttonClasses()` | `variant?: "primary" \| "secondary" \| "ghost"`, `size?: "sm" \| "md"`, native button props | primary `bg-action` white text; secondary bordered surface; ghost action text. `type="button"` default. Never red. `buttonClasses()` styles a `Link` the same way |
| `AsOf` | `date` (YYYY-MM-DD or `recorded_at`), `variant?: "inline" \| "hero" \| "table"`, `referenceDate?`, `prefix?` (default "as of") | Always a `<time dateTime="YYYY-MM-DD">`. Age = UTC days from `date` to `referenceDate` (default today UTC). Fresh (0 to 1 day): inline "as of Sep 29" (caption, ink-soft), hero "as of Sep 29, 2026" (small). Stale (2 days or more): clock icon plus "Last priced Sep 25" in warn-text. Table variant: nothing when fresh; when stale, only the clock icon with `title` and `sr-only` text. Year shown when it differs from the reference year. Missing or unparseable date renders nothing. Withholding at 14 days stays upstream (migration 0023) |
| `ProvenanceLine` | `children`, `methodologyHref?`, `methodologyLabel?` | One `<p>` in small ink-soft text, optional trailing link in action colour. WP24 supplies the copy |
| `icons.tsx` | `ClockIcon`, `WarnIcon` | 16x16 stroke icons, `currentColor`, `aria-hidden` |

`format.ts` (WP07 module) gains `formatPercent`, `formatSignedPercent`, `FLAT_BAND_PERCENT`, `changeDirection`.

### Screens changed in this PR

`/prices` at 1440 px (after). The controls keep their positions; only the three toggles change to `SegmentedControl` (blue selected segment, 8 px radius, no shadow):

```
+-------------------------------------------------------------------------------------------+
| GENERATION [All generations v]  PRODUCT TYPE [All types v]  [ (o) Search by name or variant ] |
| CHART  [ 7D | 1M |#3M#| 6M | 1Y ]                    CURRENCY [ USD |#CAD#]  1 USD = 1.3612 CAD |
+-------------------------------------------------------------------------------------------+
SORT BY [Release Date v][Price]                                  VIEW [ By Type |#By Set#| Flat ]
Found 306 products
(card grid, dimmed to 70% opacity while a toggle's re-render is pending)
```

`/prices` at 390 px, filter drawer open. Segments fill the width and are 44 px tall on touch screens:

```
+------------------------------------+
| Filters (2)                     ^  |
| GENERATION                         |
| [All generations               v]  |
| [ (o) Search by name or variant ]  |  16 px text: no iOS focus zoom
| CHART                              |
| [ 7D | 1M |#3M#| 6M | 1Y ]         |  44 px
| CURRENCY                           |
| [ USD |#CAD#]  1 USD = 1.3612 CAD  |  44 px, not stretched (as today)
| [             Done              ]  |
+------------------------------------+
SORT BY [Release Date v][Price]
VIEW
[ By Type |#By Set#| Flat ]             44 px
```

Card sparkline slot, three states (96x40 box, unchanged size):

```
loading / not yet requested     loaded, fewer than 2 days      loaded
+------------------+            +------------------+          +------------------+
|                  |            |                  |          |        /\  /\/   |
| ================ |  flat bar  |    No history    |  12 px   |   /\/\/  \/      |
|                  |            |                  |          | /                |
+------------------+            +------------------+          +------------------+
```

Dense `SortableTable` (used by `/compare`), 1440 px. Sorted header bold with a visible arrow, 40 px header, 44 px one-line rows, hairline dividers instead of floating card rows:

```
SKU         TITLE                          SHOPIFY v   COST        MARKET      DIFF        DIFF %   STATUS
----------------------------------------------------------------------------------------------------------  40 px
EVS-BB      Evolving Skies Booster Box...  C$689.99    C$520.00    C$612.40    +C$77.59    12.7%    Above   44 px
----------------------------------------------------------------------------------------------------------
SIT-ETB     Silver Tempest Elite Traine... C$74.99     C$55.00     C$81.30     -C$6.31     -7.8%    OK      44 px
```

Header: `SHOPIFY v` is bold ink with a visible ▼; other sortable headers are semibold ink-soft with a faint ↕. Titles truncate with the full text in the `title` attribute.

### Component sheet (used by later packages; not placed on pages in this PR)

`DataListRow` at 390 px (WP30, WP33, WP37 use it below 768 px):

```
+----------------------------------------------------------+
| [img] Booster Box  Evolving Skies                  /\/\_ |  line 1: title + subtitle, 64x24 sparkline
|       SWSH07 . Aug 2021            C$612.40  ^ 4.2% 30D  |  line 2: meta | value + Delta
+----------------------------------------------------------+  min 56 px, whole row is one link
```

`Stat` (hero) with `Delta`, `AsOf` and `RangeBar` at 1440 px (WP31 product header):

```
Market Price                                   52-week range
C$612.40  ^ 4.2% 30D                           |-----------------|------------|
TCGplayer Market Price in USD: $450.00         C$401.20                C$790.00
as of Sep 29, 2026                             38% below 52-week high (sr-only unless showSummary)
```

Stale product in a dense table (WP33): `C$81.30 (clock)` where the clock has the tooltip and screen-reader text "Last priced Sep 25".

### States

- Loading: `Skeleton` flat bars only; the sparkline skeleton is a flat bar in the 96x40 box. Nothing pulses.
- Empty: `EmptyState` (title, one sentence, one action). Sparkline with a loaded but too-short history: "No history".
- Missing value: `Delta` shows `--` with an `sr-only` reason; `formatPercent` returns `--` (or the `missing` option).
- Stale data: `AsOf` switches to warn colour plus clock icon at 2 or more days; the price itself is withheld upstream at 14 days (migration 0023) and this PR does not change that gate.
- Error: out of scope (pages own their error copy, WP15 messages).

### Copy

"as of Sep 29", "Last priced Sep 25", "No history", "Up", "Down", "Unchanged", "Not available", "38% below 52-week high", "At 52-week high", "At 52-week low", "Less than 1% below 52-week high", "No 52-week range yet". No "live", "real-time" or "all-time" anywhere. No em dashes.

### Accessibility

- `SegmentedControl` follows the APG radio group pattern (roving tabindex, arrows select, Home/End). Name from the visible label via `aria-labelledby`, or from `ariaLabel` (the visible label is then `aria-hidden` so it is not read twice, which keeps WP14's "Chart timeframe" name).
- Direction is never colour-only: glyph plus `sr-only` word in `Delta`, icon plus text in `AsOf` and warn `Badge`.
- `RangeBar` gives a sentence, not a picture, to screen readers.
- `DataListRow` is one link per row (no nested interactive elements); the sparkline slot is `aria-hidden`.
- Focus: `focus-visible:ring-2 ring-action` on every interactive component.
- Every component test runs axe-core (color-contrast is disabled in jsdom; token contrast is fixed: action 5.2:1, action-strong 6.7:1, gain-text 5.5:1, loss-text 6.3:1, warn-text 5.0:1, ink-soft 7.6:1 on white).

### Performance

- One font file on first view (Geist Sans latin). Geist Mono's `@font-face` rules and its late request on four routes disappear.
- New CSS is a few dozen utilities; the WP22 CSS budget (14 kB gz) holds. New client JS is `SegmentedControl` (about 1 kB); every other component is server-compatible and unused by pages in this PR.
- Toggles on `/prices` re-render the card list at transition priority with the list dimmed, so the pressed segment paints on the next frame (INP target 100 ms on `/prices` filters).

## Before you start

Read these files fully (paths relative to `frontend/`):

- `app/globals.css` (tokens; WP14 added `--pf-gain-text`/`--pf-loss-text` and the dialog scroll lock, WP09 added `content-visibility` rules at the end).
- `app/layout.tsx` (fonts; WP13 metadata, WP20 `CurrencyProvider`).
- `app/lib/format.ts` (WP07; `formatMoney`, `formatDateOnly`, `formatMonthDay`, `recordedAtDateKey`) and `app/lib/__tests__/format.test.ts`.
- `app/components/ui/Dialog.tsx` (WP14) and `app/components/ui/ConfirmDialog.tsx` (WP15): the directory's existing conventions.
- `app/__tests__/uiConventions.test.ts` (WP15): note the names `APP`, `collect`, `SOURCES`, `violations`; this PR appends to that file.
- `app/components/ProductPrices/controls/ChartTimeframeButtons.tsx`, `CurrencySelector.tsx`, `SortControls.tsx`, `SearchInput.tsx`, `ControlBar.tsx` (WP14 names, WP20 imports).
- `app/components/ProductPrices/index.tsx` (WP08 `updateUrlState` and `cardList`, WP09 `historyLoadingStore`, WP20 `rememberCurrency`).
- `app/components/ProductPrices/__tests__/controls.a11y.test.tsx` (WP14).
- `app/components/MarketView/MiniSparkline.tsx` (WP09) and `app/components/MarketView/__tests__/MiniSparkline.test.tsx`, `MiniSparkline.ssr.test.tsx`.
- Every `<MiniSparkline` call site: `grep -rn "<MiniSparkline" app --include=*.tsx | grep -v __tests__` (expect `ProductPrices/cards/ProductCard.tsx` twice and `MarketView/columns.tsx` once; `MarketView.tsx` itself no longer renders it after WP19).
- `app/components/SortableTable/SortableTable.tsx` and its test (WP18); `app/compare/compareColumns.tsx` (WP18).
- The four search inputs: `app/components/ProductPrices/controls/SearchInput.tsx`, `app/page.tsx` (hero form), `app/components/NotFoundPanel.tsx` (WP13), and the compare search in `app/compare/CompareDashboard.tsx` (WP18 moved it next to `CompareTabs`).
- The four `font-mono` call sites: `app/components/ProductPrices/cards/GroupHeader.tsx`, `app/stats/page.tsx` (two), `app/product/[id]/page.tsx`, `app/components/Portfolio/cards/ImportHoldingsModal.tsx` (the CSV textarea).
- `/home/user/Pokefin/audits/remediation/01-PRODUCT-DIRECTION.md` §3 and `research/performance-excellence.md` §9 and §13.

Confirm the starting state (run from `frontend/`):

```bash
git log --oneline -1

# WP07: four hits.
grep -cE "export function (formatMoney|formatDateOnly|formatMonthDay|recordedAtDateKey)\b" app/lib/format.ts
# No percent helpers yet: expect 0.
grep -cE "export function (formatPercent|formatSignedPercent)\b" app/lib/format.ts

# WP14: Dialog exists, two text tokens, the controls a11y test exists.
ls app/components/ui/Dialog.tsx app/components/ProductPrices/__tests__/controls.a11y.test.tsx
grep -cE -- "--pf-(gain|loss)-text:" app/globals.css                         # 2

# WP15: conventions test and ConfirmDialog exist; no red-* utilities remain.
ls app/__tests__/uiConventions.test.ts app/components/ui/ConfirmDialog.tsx
grep -n "function violations" app/__tests__/uiConventions.test.ts             # 1 hit
grep -rnE "\b([a-z-]+:)*(text|bg|border|ring|outline|fill|stroke|from|via|to|divide|decoration|accent|caret|shadow|placeholder)-red-[0-9]{2,3}\b" app --include=*.tsx --include=*.ts | grep -v __tests__
# expect no output. If BoxCalculator.tsx still has hover:text-red-500, WP15 step 6 did not
# fully land: replace each hover:text-red-500 with hover:text-[var(--pf-loss)] (WP15's mapping) in this PR.

# WP17: lint blocks CI (no continue-on-error on the lint step).
grep -n "continue-on-error" ../.github/workflows/ci.yml                       # no lint hit

# WP18: generic table and compare columns.
ls app/components/SortableTable/SortableTable.tsx app/compare/compareColumns.tsx app/lib/marketMath.ts
grep -n 'border-separate border-spacing-y-2' app/components/SortableTable/SortableTable.tsx   # 1 hit

# WP19: column descriptors (MiniSparkline call site) and the memoised row.
ls app/components/MarketView/columns.tsx app/components/MarketView/MarketTableRow.tsx

# WP20: currency context; CurrencySelector used on 4 surfaces.
ls app/context/CurrencyContext.tsx
grep -rln "<CurrencySelector" app --include=*.tsx | grep -v __tests__
# expect ControlBar.tsx, BoxCalculator.tsx, app/portfolio/page.tsx

# WP09 and WP08.
grep -c "export function buildSparklinePath" app/components/MarketView/MiniSparkline.tsx   # 1
grep -c "animate-pulse" app/components/MarketView/MiniSparkline.tsx                       # 1 (the zigzag)
grep -n "const cardList = useMemo\|{cardList}" app/components/ProductPrices/index.tsx     # 2 hits

# WP13.
ls app/components/NotFoundPanel.tsx

# WP22: budgets and scripts.
ls perf-budgets.json scripts/perf-budget.mjs scripts/perf-serve.mjs
node -e 'console.log(require("./package.json").scripts["perf:budget"])'      # a command, not undefined

# Current font-mono and Geist Mono usage: expect 5 font-mono lines, then 5 lines in layout.tsx
# (import, comment, const, variable, body class) and 1 in globals.css (--font-mono).
grep -rn "font-mono" app --include=*.tsx | grep -v __tests__
grep -n "Geist_Mono\|geistMono\|geist-mono" app/layout.tsx app/globals.css

# axe-core is only a transitive dependency today (via eslint-plugin-jsx-a11y): expect 4.13.0.
node -e 'console.log(require("axe-core/package.json").version)' 2>/dev/null || ls node_modules/.pnpm | grep "^axe-core@"
```

What to do if a dependency is missing:

- WP14, WP15, WP18 or WP20 missing (a `ls` fails): stop and report. This package edits their files and tests.
- WP19 missing (`columns.tsx` absent; the sparkline is then rendered in `MarketView.tsx`): continue; the `MiniSparkline` change is call-site neutral. Report it.
- WP22 missing (`perf-budgets.json` or the scripts absent): continue, run the manual size checks in Verification instead of `pnpm perf:budget`, and say so in the PR.
- WP13 missing (`NotFoundPanel.tsx` absent): skip that one search input.

Record the "before" measurements now (step 0 below) before editing anything.

## Implementation steps

### Step 0. Baseline screenshots and sizes (before any edit)

0a. Build and serve the realistic fixture (WP22):

```bash
cd /home/user/Pokefin/frontend
SUPABASE_STUB_FIXTURE=perf pnpm build:stub
rm -f .perf/ready
node scripts/perf-serve.mjs &   # WP22 front door on 127.0.0.1:3100 (stub + next start); note the PID
until [ -f .perf/ready ]; do sleep 2; done   # WP22 writes .perf/ready after warming every route
```

If WP22 is missing, use the research fixture instead (58 products; dev mode is acceptable for a visual comparison, not for sizes):

```bash
node /home/user/Pokefin/audits/remediation/research/tools/fixture-stub.js &
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 NEXT_PUBLIC_SUPABASE_KEY=stub pnpm exec next dev -p 3100 &
```

0b. Screenshots of `/prices`, `/market`, `/compare`, `/stats` and `/box-calculator` at 390x844 and 1440x900. `shoot.js` hardcodes port 3099, so make an untracked copy pointing at 3100:

```bash
cd /home/user/Pokefin/audits/remediation/research/tools
npm install --no-save playwright-core@1.56
sed 's#http://localhost:3099#http://127.0.0.1:3100#' shoot.js > shoot.local.js
mkdir -p shots/seg2
PAGES="prices:/prices,market:/market,compare:/compare,stats:/stats,boxcalc:/box-calculator" node shoot.local.js
rm -rf /tmp/wp23-shots-before && mv shots /tmp/wp23-shots-before
```

Set `CHROME_PATH` if Playwright cannot find a browser (see `research/tools/README.md`).

0c. Sizes (only with the WP22 build):

```bash
cd /home/user/Pokefin/frontend
pnpm perf:budget | tee /tmp/wp23-budget-before.txt
find .next/static -name '*.css' -print0 | xargs -0 cat | gzip -9 | wc -c | tee /tmp/wp23-css-before.txt
```

Stop the server (`kill <PID>`). Do not commit anything from `research/tools/` (`shoot.local.js`, `shots/`, `node_modules/`).

### Step 1. Add `axe-core` as a direct dev dependency

```bash
cd /home/user/Pokefin/frontend
pnpm add -D axe-core@4.13.0
```

Pin the version already in the lockfile (4.13.0, transitive through `eslint-plugin-jsx-a11y`) so the lockfile change is one importer entry. Do not add `jest-axe` (it drags jest 29 matcher packages into a jest 30 tree); the helper in step 2 calls axe-core directly.

### Step 2. `frontend/test-utils/axe.ts` (new): axe helper for component tests

Outside `app/` so Next never bundles it and the conventions scan ignores it. Import it in tests as `@/test-utils/axe` (the jest `moduleNameMapper` maps `@/` to `frontend/`).

```ts
import axe from "axe-core";

/**
 * axe-core violations for a rendered subtree, formatted for
 * `expect(await axeViolations(container)).toEqual([])`.
 *
 * jsdom does no layout, so color-contrast is disabled (token contrast is fixed
 * in globals.css and checked by hand). `region` is disabled because components
 * render outside page landmarks in unit tests.
 */
export async function axeViolations(node: Element): Promise<string[]> {
  const results = await axe.run(node, {
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
    },
  });
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((n) => n.target.join(" ")).join(" | ")}`
  );
}
```

### Step 3. `frontend/app/globals.css`: semantic tokens, colour scheme, drop the mono font variable

3a. Replace the Brand block at the top of `:root` (the `/* Brand */` comment and the five `--pf-poke*` lines under it, through `--pf-pokeyellow`) with:

```css
  color-scheme: light;

  /* Brand (WP23): the logo mark and the wordmark accent "é" only. Never a
     button, never text on data, never the promo. The conventions test allows
     --pf-accent / text-accent / bg-accent only in Header.tsx and Footer.tsx. */
  --pf-accent: #dc2626;

  /* Action (WP23): primary buttons, links, focus ring, selected segment. */
  --pf-action: #2563eb;
  --pf-action-strong: #1d4ed8;

  /* Deprecated aliases (WP23). Same values as before, so existing call sites
     keep their look. uiConventions.test.ts ratchets --pf-pokeball per file:
     new code uses Button (action colour); page packages remove the rest. */
  --pf-pokeball: var(--pf-accent);
  --pf-pokeball-strong: #b91c1c;
  --pf-pokeblue: var(--pf-action);
  --pf-pokeblue-strong: var(--pf-action-strong);
  --pf-pokeyellow: #facc15;
```

3b. Directly after the data-semantics block (after the `--pf-loss-soft` line and WP14's `--pf-loss-text` line, before the `/* Legacy aliases consumed elsewhere */` comment), insert:

```css
  /* Warning role (WP23): stale price, delayed pipeline, provisional day.
     #b45309 is 5.0:1 on white and 4.8:1 on --pf-bg. */
  --pf-warn-text: #b45309;
  --pf-warn-fill: #fffbeb;

  /* Charts (WP23). The price line never changes colour with direction; the
     change chip carries gain/loss. Benchmark lines are drawn dashed. */
  --pf-chart-line: #1d4ed8;
  --pf-chart-bench: #64748b;
  --pf-chart-grid: #e2e8f0;
  --pf-chart-volume: #cbd5e1;

  /* Two radii (WP23): controls and chips, cards and dialogs. */
  --pf-radius-control: 8px;
  --pf-radius-card: 12px;
```

3c. In `@theme inline`, delete the line `--font-mono: var(--font-geist-mono);` (Geist Mono is removed in step 4; `font-mono` is banned by the conventions test). Then add, after the `--color-loss: var(--pf-loss);` line:

```css
  /* WP23 semantic utilities: text-ink-soft, bg-action, text-gain-text, ... */
  --color-accent: var(--pf-accent);
  --color-action: var(--pf-action);
  --color-action-strong: var(--pf-action-strong);
  --color-line: var(--pf-border);
  --color-gain-text: var(--pf-gain-text);
  --color-loss-text: var(--pf-loss-text);
  --color-warn-text: var(--pf-warn-text);
  --color-warn-fill: var(--pf-warn-fill);
  --color-chart-line: var(--pf-chart-line);
  --color-chart-bench: var(--pf-chart-bench);
  --color-chart-grid: var(--pf-chart-grid);
  --color-chart-volume: var(--pf-chart-volume);
  --radius-control: var(--pf-radius-control);
  --radius-card: var(--pf-radius-card);
```

3d. After the closing `}` of `@theme inline`, add a second theme block for the type scale:

```css
/* Type scale (WP23, 01-PRODUCT-DIRECTION.md §3.1). Weights are set with
   font-semibold on display and headings. Nothing smaller than 12 px. */
@theme {
  --text-display: 2rem;
  --text-display--line-height: 2.5rem;
  --text-h1: 1.5rem;
  --text-h1--line-height: 2rem;
  --text-h2: 1.25rem;
  --text-h2--line-height: 1.75rem;
  --text-h3: 1rem;
  --text-h3--line-height: 1.5rem;
  --text-body: 0.875rem;
  --text-body--line-height: 1.25rem;
  --text-prose: 1rem;
  --text-prose--line-height: 1.625rem;
  --text-small: 0.8125rem;
  --text-small--line-height: 1.125rem;
  --text-caption: 0.75rem;
  --text-caption--line-height: 1rem;
}
```

Keep the `@custom-variant dark` line, every other token, WP14's rules and WP09's `content-visibility` rules unchanged. Do not change any existing token value.

### Step 4. `frontend/app/layout.tsx`: one font family

- Import line: `import { Geist, Geist_Mono } from "next/font/google";` becomes `import { Geist } from "next/font/google";`.
- Delete the `geistMono` constant and the comment block above it (the `// preload: false - next/font would otherwise emit ...` lines).
- The body class `` `${geistSans.variable} ${geistMono.variable} antialiased` `` becomes `` `${geistSans.variable} antialiased` ``.

Leave WP13's metadata, WP20's `CurrencyProvider`, `Analytics` and `SpeedInsights` as they are. Do not write the words "font-mono" in any comment (the conventions test scans comments).

### Step 5. The five `font-mono` call sites

Replace `font-mono` in each class list; keep every other class exactly as the file has it (WP14 may have changed `text-slate-400` to `text-slate-500`):

| File | Anchor | Change |
|---|---|---|
| `app/components/ProductPrices/cards/GroupHeader.tsx` | `<span className="text-[11px] font-mono ...">{setCode}</span>` | `font-mono` becomes `font-sans tabular-nums tracking-wide uppercase` |
| `app/stats/page.tsx` (two identical lines) | `<span className="font-mono">{set.code}</span>` | `className="font-sans tabular-nums tracking-wide uppercase"` |
| `app/product/[id]/page.tsx` | `<span className="text-xs font-mono ...">{setCode}</span>` | `font-mono` becomes `font-sans tabular-nums tracking-wide uppercase` |
| `app/components/Portfolio/cards/ImportHoldingsModal.tsx` | the CSV `<textarea ... resize-none font-mono text-sm">` | `font-mono` becomes `font-sans tabular-nums` (no `uppercase`: CSS uppercase on a textarea would show pasted CSV in capitals while the value stays unchanged, which is confusing) |

Then `grep -rn "font-mono" app | grep -v __tests__` must print nothing.

### Step 6. `frontend/app/lib/format.ts`: percent helpers

Append at the end of the file (after `formatInteger`):

```ts
/*
 * Percent display (WP23, 01-PRODUCT-DIRECTION.md §3.3). Inputs are already in
 * percent units: 4.2 means 4.2%. Returns and changes show 1 decimal; shares,
 * consistency and other proportions use decimals: 0. Same en-US digits as
 * formatMoney, built once at module scope.
 */
const PERCENT_FORMATTERS = {
  0: new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  1: new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
} as const;

export interface FormatPercentOptions {
  /** Default 1 (returns, changes). 0 for shares and consistency. */
  decimals?: 0 | 1;
  /** Returned for null, undefined, NaN and Infinity. Default "--". */
  missing?: string;
}

function percentDigits(value: number, decimals: 0 | 1): { digits: string; roundsToZero: boolean } {
  const digits = PERCENT_FORMATTERS[decimals].format(Math.abs(value));
  return { digits, roundsToZero: !/[1-9]/.test(digits) };
}

/** 4.23 -> "4.2%"; -4.25 -> "-4.3%"; -0.04 -> "0.0%" (never "-0.0%"). */
export function formatPercent(
  value: number | null | undefined,
  { decimals = 1, missing = "--" }: FormatPercentOptions = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return missing;
  const { digits, roundsToZero } = percentDigits(value, decimals);
  return `${value < 0 && !roundsToZero ? "-" : ""}${digits}%`;
}

/** Changes with an explicit sign: "+4.2%", "-4.2%". A value that rounds to zero is "0.0%". */
export function formatSignedPercent(
  value: number | null | undefined,
  { decimals = 1, missing = "--" }: FormatPercentOptions = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return missing;
  const { digits, roundsToZero } = percentDigits(value, decimals);
  const sign = roundsToZero ? "" : value < 0 ? "-" : "+";
  return `${sign}${digits}%`;
}

/**
 * Changes strictly inside ±0.05% are flat: exactly the values that print as
 * "0.0%" at 1 decimal, so a flat change never shows an arrow and an arrow
 * never sits next to "0.0%".
 */
export const FLAT_BAND_PERCENT = 0.05;

export type ChangeDirection = "up" | "down" | "flat";

export function changeDirection(value: number): ChangeDirection {
  if (Math.abs(value) < FLAT_BAND_PERCENT) return "flat";
  return value > 0 ? "up" : "down";
}
```

Do not replace existing `toFixed` percent call sites in this PR (page packages migrate them). Do not import this `formatPercent` into `app/compare/compareColumns.tsx`, which has a local function of the same name.

### Step 7. `frontend/app/components/ui/icons.tsx` (new)

```tsx
type IconProps = { className?: string };

/** Stale-price clock. Decorative: always paired with text or sr-only text. */
export function ClockIcon({ className = "size-3.5" }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.75V8l2.25 1.5" />
    </svg>
  );
}

/** Warning triangle for the warn Badge. Decorative. */
export function WarnIcon({ className = "size-3.5" }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M8 2.5 14.25 13.5H1.75L8 2.5Z" />
      <path d="M8 6.75v3" />
      <path d="M8 11.75h.01" />
    </svg>
  );
}
```

### Step 8. `frontend/app/components/ui/Delta.tsx` (new)

```tsx
import { changeDirection, formatPercent, type ChangeDirection } from "../../lib/format";

export interface DeltaProps {
  /** A change in percent units (4.2 means +4.2%). Null when withheld or unknown. */
  value: number | null | undefined;
  /** Optional window label shown after the number, e.g. "30D". */
  period?: string;
  /** Screen-reader reason when value is missing, e.g. "Price withheld". */
  missingReason?: string;
  className?: string;
}

const TONE: Record<ChangeDirection, string> = {
  up: "text-gain-text",
  down: "text-loss-text",
  flat: "text-ink-soft",
};

const GLYPH: Record<ChangeDirection, string | null> = { up: "▲", down: "▼", flat: null };
const SPOKEN: Record<ChangeDirection, string> = { up: "Up", down: "Down", flat: "Unchanged" };

/**
 * A signed change: glyph plus 1-decimal magnitude, gain/loss colour only on
 * the change itself (01-PRODUCT-DIRECTION.md §3.2). Colour is never the only
 * cue: the glyph is decorative and an sr-only word carries the direction.
 */
export default function Delta({
  value,
  period,
  missingReason = "Not available",
  className = "",
}: DeltaProps) {
  const periodLabel = period ? (
    <span className="font-normal text-ink-soft">{period}</span>
  ) : null;

  if (value === null || value === undefined || !Number.isFinite(value)) {
    return (
      <span
        data-direction="missing"
        className={`inline-flex items-baseline gap-1 whitespace-nowrap tabular-nums text-ink-soft ${className}`}
      >
        <span aria-hidden="true">--</span>
        <span className="sr-only">{missingReason}</span>
        {periodLabel}
      </span>
    );
  }

  const direction = changeDirection(value);
  const glyph = GLYPH[direction];
  return (
    <span
      data-direction={direction}
      className={`inline-flex items-baseline gap-1 whitespace-nowrap font-medium tabular-nums ${TONE[direction]} ${className}`}
    >
      {glyph && (
        <span aria-hidden="true" className="text-[0.75em] leading-none">
          {glyph}
        </span>
      )}
      <span className="sr-only">{SPOKEN[direction]} </span>
      <span>{formatPercent(Math.abs(value))}</span>
      {periodLabel}
    </span>
  );
}
```

The magnitude is unsigned on purpose: the glyph and the spoken word carry the sign, so the text never reads "▼ -3.1%". Use `formatSignedPercent` where a glyph is not possible (CSV, email subject lines).

### Step 9. `frontend/app/components/ui/Stat.tsx` (new)

```tsx
import type { ReactNode } from "react";

export interface StatProps {
  /** Plain text or WP24's MetricLabel (label plus methodology link). */
  label: ReactNode;
  /** Already formatted, e.g. formatMoney(...). */
  value: ReactNode;
  /** One secondary line, e.g. "TCGplayer Market Price in USD: $450.00". */
  sub?: ReactNode;
  /** Usually a <Delta />. */
  delta?: ReactNode;
  /** Usually an <AsOf />. */
  asOf?: ReactNode;
  /** "hero" uses the 32 px display size (product price, index level). */
  size?: "default" | "hero";
  className?: string;
}

export default function Stat({
  label,
  value,
  sub,
  delta,
  asOf,
  size = "default",
  className = "",
}: StatProps) {
  const valueClass = size === "hero" ? "text-display" : "text-h2";
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <div className="text-small font-medium text-ink-soft">{label}</div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`${valueClass} font-semibold tabular-nums text-ink`}>{value}</span>
        {delta}
      </div>
      {sub && <div className="text-small text-ink-soft">{sub}</div>}
      {asOf && <div className="text-caption text-ink-soft">{asOf}</div>}
    </div>
  );
}
```

### Step 10. `frontend/app/components/ui/Badge.tsx` (new)

```tsx
import type { ReactNode } from "react";
import { WarnIcon } from "./icons";

export type BadgeVariant = "neutral" | "info" | "warn";

const VARIANT: Record<BadgeVariant, string> = {
  neutral: "text-ink-soft",
  info: "text-action-strong",
  warn: "text-warn-text",
};

/**
 * Text badge (no pill). Budget: at most one badge per row; facts shared by a
 * whole group ("Special Expansion") go in the group header, once.
 */
export default function Badge({
  variant = "neutral",
  children,
  className = "",
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-variant={variant}
      className={`inline-flex items-center gap-1 text-caption font-medium ${VARIANT[variant]} ${className}`}
    >
      {variant === "warn" && <WarnIcon className="size-3 shrink-0" />}
      {children}
    </span>
  );
}
```

### Step 11. `frontend/app/components/ui/SegmentedControl.tsx` (new)

```tsx
"use client";

import {
  startTransition,
  useId,
  useOptimistic,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string;
}

export interface SegmentedControlProps<T extends string> {
  /** Visible label; also the group's accessible name unless `ariaLabel` is set. */
  label: string;
  /**
   * Accessible name when it should be longer than the visible label
   * ("Chart timeframe" vs "Chart"). The visible label is then aria-hidden.
   */
  ariaLabel?: string;
  /** Visually hide the label (it still names the group). */
  hideLabel?: boolean;
  options: readonly SegmentedOption<T>[];
  value: T;
  /** Runs inside startTransition: heavy list re-renders stay interruptible. */
  onChange: (value: T) => void;
  /** Rendered on the same row as the segments, e.g. the exchange-rate text. */
  trailing?: ReactNode;
  /** Stretch to the container width below sm, equal segments. Default true. */
  fullWidthOnPhone?: boolean;
  className?: string;
}

/**
 * One-of-N toggle (APG radio group): roving tabindex, arrow keys move focus
 * and select, Home/End. The pressed state is optimistic, so it paints on the
 * next frame while the parent re-renders at transition priority
 * (research/performance-excellence.md §13.2). Heavy parents can also wrap
 * their handler in their own startTransition to read isPending and dim.
 */
export default function SegmentedControl<T extends string>({
  label,
  ariaLabel,
  hideLabel = false,
  options,
  value,
  onChange,
  trailing,
  fullWidthOnPhone = true,
  className = "",
}: SegmentedControlProps<T>) {
  const labelId = useId();
  const [shown, setShown] = useOptimistic(value);

  const select = (next: T) => {
    if (next === shown) return;
    startTransition(() => {
      setShown(next);
      onChange(next);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = options.length - 1;
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = index === 0 ? last : index - 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      '[role="radio"]'
    );
    radios?.[nextIndex]?.focus();
    select(options[nextIndex].value);
  };

  const checkedIndex = options.findIndex((option) => option.value === shown);
  const tabStop = checkedIndex === -1 ? 0 : checkedIndex;
  const showVisibleLabel = !(hideLabel && ariaLabel);

  return (
    <div
      className={`flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2 ${
        fullWidthOnPhone ? "w-full sm:w-auto" : ""
      } ${className}`}
    >
      {showVisibleLabel && (
        <span
          id={labelId}
          aria-hidden={ariaLabel ? true : undefined}
          className={
            hideLabel
              ? "sr-only"
              : "text-xs font-semibold uppercase tracking-wide text-ink-soft"
          }
        >
          {label}
        </span>
      )}
      <div className={`flex items-center gap-2 ${fullWidthOnPhone ? "w-full sm:w-auto" : ""}`}>
        <div
          role="radiogroup"
          aria-labelledby={ariaLabel ? undefined : labelId}
          aria-label={ariaLabel}
          className={`inline-flex rounded-control border border-line bg-surface p-0.5 ${
            fullWidthOnPhone ? "w-full sm:w-auto" : ""
          }`}
        >
          {options.map((option, index) => {
            const checked = option.value === shown;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={option.ariaLabel}
                tabIndex={index === tabStop ? 0 : -1}
                onClick={() => select(option.value)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className={`${
                  fullWidthOnPhone ? "flex-1 sm:flex-initial" : ""
                } inline-flex items-center justify-center rounded-control px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-1 pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${
                  checked
                    ? "bg-action text-white"
                    : "text-ink-soft hover:bg-surface-alt hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {trailing}
      </div>
    </div>
  );
}
```

Notes: `aria-checked` and the tab stop read `shown` (the optimistic value), never `value` directly. If the parent rejects the change (does not update `value`), the optimistic state falls back to `value` when the transition ends, so the control stays controlled. Focus moves through the DOM (`parentElement.querySelectorAll`) instead of refs, which keeps the React Compiler lint rules (`react-hooks/refs`) quiet.

### Step 12. `frontend/app/components/ui/PageHeader.tsx` (new)

```tsx
import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: ReactNode;
  /** Usually a <ProvenanceLine /> (WP24 supplies the copy). */
  provenance?: ReactNode;
  /** Page actions; one primary Button at most. */
  actions?: ReactNode;
  className?: string;
}

export default function PageHeader({ title, provenance, actions, className = "" }: PageHeaderProps) {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        <h1 className="text-h1 font-semibold tracking-tight text-ink">{title}</h1>
        {provenance && <div className="mt-1">{provenance}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
```

### Step 13. `frontend/app/components/ui/DataList.tsx` (new)

```tsx
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Phone list pattern (01-PRODUCT-DIRECTION.md §3.3): every dataset renders as
 * two-line rows at least 56 px tall below 768 px. No desktop table in a scroll
 * box on phones.
 */
export function DataList({
  label,
  children,
  className = "",
}: {
  /** Accessible name of the list, e.g. "Products". */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ul aria-label={label} className={`divide-y divide-line border-y border-line bg-surface ${className}`}>
      {children}
    </ul>
  );
}

export interface DataListRowProps {
  /** Row link target. Without it the row is static. */
  href?: string;
  /** Line 1, primary: product name. */
  title: ReactNode;
  /** Line 1, secondary: set name. */
  subtitle?: ReactNode;
  /** Line 2, left: set code, release month, units sold. */
  meta?: ReactNode;
  /** Line 2, right: formatted price. */
  value?: ReactNode;
  /** Line 2, right of value: usually a <Delta />. */
  delta?: ReactNode;
  /** 64x24 slot (WP26 baked sparkline). Decorative. */
  sparkline?: ReactNode;
  /** Optional 40x40 thumbnail slot. */
  leading?: ReactNode;
  /** Default false: a list can hold hundreds of product links. */
  prefetch?: boolean;
}

const ROW =
  "flex min-h-14 items-center gap-3 px-4 py-2 transition-colors duration-150 motion-reduce:transition-none";

export function DataListRow({
  href,
  title,
  subtitle,
  meta,
  value,
  delta,
  sparkline,
  leading,
  prefetch = false,
}: DataListRowProps) {
  const body = (
    <>
      {leading && <div className="size-10 shrink-0 overflow-hidden rounded-control">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-body font-medium text-ink">{title}</span>
          {subtitle && <span className="truncate text-small text-ink-soft">{subtitle}</span>}
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-small text-ink-soft">{meta}</span>
          <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
            {value !== undefined && (
              <span className="text-body font-semibold text-ink">{value}</span>
            )}
            {delta}
          </span>
        </div>
      </div>
      {sparkline && (
        <div className="h-6 w-16 shrink-0" aria-hidden="true" data-slot="sparkline">
          {sparkline}
        </div>
      )}
    </>
  );

  return (
    <li>
      {href ? (
        <Link
          href={href}
          prefetch={prefetch}
          className={`${ROW} hover:bg-surface-alt active:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action`}
        >
          {body}
        </Link>
      ) : (
        <div className={ROW}>{body}</div>
      )}
    </li>
  );
}
```

### Step 14. `frontend/app/components/ui/EmptyState.tsx` and `Skeleton.tsx` (new)

`EmptyState.tsx`:

```tsx
import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** One action, usually a Button or a Link styled with buttonClasses(). */
  action?: ReactNode;
  /** Render the title as h2 or h3 when it starts a section. Default: <p>. */
  headingLevel?: 2 | 3;
  className?: string;
}

export default function EmptyState({
  title,
  description,
  action,
  headingLevel,
  className = "",
}: EmptyStateProps) {
  const Title = headingLevel === 2 ? "h2" : headingLevel === 3 ? "h3" : "p";
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-card border border-dashed border-line bg-surface px-6 py-10 text-center ${className}`}
    >
      <Title className="text-h3 font-semibold text-ink">{title}</Title>
      {description && <p className="max-w-prose text-body text-ink-soft">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
```

`Skeleton.tsx`:

```tsx
/**
 * Loading placeholder: a flat neutral bar. Never a fake chart shape, never
 * pulsing (01-PRODUCT-DIRECTION.md §3.4, §3.5). Size it with className.
 */
export default function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-skeleton=""
      className={`block rounded-control bg-surface-alt ${className}`}
    />
  );
}
```

### Step 15. `frontend/app/components/ui/RangeBar.tsx` (new)

```tsx
export interface RangeBarProps {
  low: number;
  high: number;
  value: number;
  /** Formatted, e.g. formatMoney(low, currency). */
  lowLabel: string;
  highLabel: string;
  /** "52-week" by default; "tracked" when history is shorter than a year. */
  windowLabel?: string;
  /** Show the summary sentence visibly (it is always available to screen readers). */
  showSummary?: boolean;
  className?: string;
}

/** Marker position in percent of the track, clamped to 0..100. */
export function rangePosition(low: number, high: number, value: number): number {
  if (!(high > low)) return 50;
  const raw = ((value - low) / (high - low)) * 100;
  return Math.min(100, Math.max(0, raw));
}

/** "38% below 52-week high", "At 52-week high", ... */
export function describeRange(
  low: number,
  high: number,
  value: number,
  windowLabel = "52-week"
): string {
  if (!(high > low)) return `No ${windowLabel} range yet`;
  if (value >= high) return `At ${windowLabel} high`;
  if (value <= low) return `At ${windowLabel} low`;
  const below = Math.round(((high - value) / high) * 100);
  return below < 1
    ? `Less than 1% below ${windowLabel} high`
    : `${below}% below ${windowLabel} high`;
}

export default function RangeBar({
  low,
  high,
  value,
  lowLabel,
  highLabel,
  windowLabel = "52-week",
  showSummary = false,
  className = "",
}: RangeBarProps) {
  if (![low, high, value].every(Number.isFinite)) return null;
  const position = rangePosition(low, high, value);
  return (
    <div className={className}>
      <div className="relative h-1.5 rounded-control bg-chart-grid" aria-hidden="true">
        <span
          data-testid="range-marker"
          className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-control bg-ink"
          style={{ left: `${position}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between gap-2 text-caption tabular-nums text-ink-soft">
        <span>
          <span className="sr-only">{windowLabel} low </span>
          {lowLabel}
        </span>
        <span>
          <span className="sr-only">{windowLabel} high </span>
          {highLabel}
        </span>
      </div>
      <p className={showSummary ? "mt-1 text-small text-ink-soft" : "sr-only"}>
        {describeRange(low, high, value, windowLabel)}
      </p>
    </div>
  );
}
```

### Step 16. `frontend/app/components/ui/Button.tsx` (new)

```tsx
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-action text-white hover:bg-action-strong active:bg-action-strong",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-alt active:bg-surface-alt",
  ghost: "text-action hover:bg-surface-alt active:bg-surface-alt",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
};

/**
 * Classes for anything that should look like a button, e.g. a next/link:
 * <Link href="/portfolio" className={buttonClasses({ variant: "secondary" })}>.
 * Never red: brand red is the logo only (01-PRODUCT-DIRECTION.md §3.2).
 */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className = "",
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`.trim();
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export default function Button({
  variant,
  size,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...rest} />;
}
```

Destructive confirmations keep WP15's `ConfirmDialog` button (rose). Do not add a red or "danger" variant here.

### Step 17. `frontend/app/components/ui/AsOf.tsx` (new)

```tsx
import { formatDateOnly, formatMonthDay, recordedAtDateKey } from "../../lib/format";
import { ClockIcon } from "./icons";

export type AsOfVariant = "inline" | "hero" | "table";

/** From this many days old, a shown price is flagged (research/trust-seo-brand.md §5.1). */
export const STALE_AFTER_DAYS = 2;

const DAY_MS = 86_400_000;

/** Today's UTC date key. A module function, so component render stays lint-pure. */
function todayUtcKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole UTC days from `fromKey` to `toKey` (both YYYY-MM-DD). */
export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round(
    (Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS
  );
}

export interface AsOfProps {
  /** The TCGplayer day the number describes: YYYY-MM-DD or a recorded_at. */
  date: string | null | undefined;
  variant?: AsOfVariant;
  /**
   * Today as YYYY-MM-DD (UTC). Defaults to the render time. Inside a client
   * component, pass the value the server used, so a render on either side
   * of midnight UTC cannot cause a hydration mismatch.
   */
  referenceDate?: string;
  /** Fresh-state prefix. Default "as of". */
  prefix?: string;
  className?: string;
}

/**
 * The as-of stamp for a price (01-PRODUCT-DIRECTION.md §6.2). Says which
 * TCGplayer day the number describes, not when the page rendered. Prices are
 * withheld upstream at 14 days (migration 0023); this component only flags
 * the 2 to 13 day window.
 */
export default function AsOf({
  date,
  variant = "inline",
  referenceDate,
  prefix = "as of",
  className = "",
}: AsOfProps) {
  const key = recordedAtDateKey(date);
  if (key === null) return null;

  const today = referenceDate ?? todayUtcKey();
  const stale = daysBetween(key, today) >= STALE_AFTER_DAYS;
  const shortDate = key.slice(0, 4) === today.slice(0, 4) ? formatMonthDay(key) : formatDateOnly(key);
  const text = variant === "hero" ? formatDateOnly(key) : shortDate;

  if (variant === "table") {
    if (!stale) return null;
    const label = `Last priced ${shortDate}`;
    return (
      <time dateTime={key} title={label} className={`inline-flex items-center text-warn-text ${className}`}>
        <ClockIcon className="size-3.5" />
        <span className="sr-only">{label}</span>
      </time>
    );
  }

  const size = variant === "hero" ? "text-small" : "text-caption";
  if (stale) {
    return (
      <time dateTime={key} className={`inline-flex items-center gap-1 ${size} text-warn-text ${className}`}>
        <ClockIcon className="size-3.5 shrink-0" />
        Last priced {text}
      </time>
    );
  }
  return (
    <time dateTime={key} className={`${size} text-ink-soft ${className}`}>
      {prefix} {text}
    </time>
  );
}
```

WP24 builds its trust copy on this component and on `ProvenanceLine`; it must not create a second `AsOf` under `components/trust/` (the research file's provisional location is superseded).

### Step 18. `frontend/app/components/ui/ProvenanceLine.tsx` (new)

```tsx
import Link from "next/link";
import type { ReactNode } from "react";

export interface ProvenanceLineProps {
  /** The sentence, e.g. WP24's "TCGplayer Market Price in USD, updated daily. ..." */
  children: ReactNode;
  /** WP24's /methodology anchor. Omit until that page exists. */
  methodologyHref?: string;
  methodologyLabel?: string;
  className?: string;
}

/** The one line under a data page's title: source, cadence, stale rule. */
export default function ProvenanceLine({
  children,
  methodologyHref,
  methodologyLabel = "Methodology",
  className = "",
}: ProvenanceLineProps) {
  return (
    <p className={`text-small text-ink-soft ${className}`}>
      {children}
      {methodologyHref && (
        <>
          {" "}
          <Link
            href={methodologyHref}
            prefetch={false}
            className="font-medium text-action underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            {methodologyLabel}
          </Link>
        </>
      )}
    </p>
  );
}
```

### Step 19. Migrate the `/prices` toggles to `SegmentedControl`

All three files live in `frontend/app/components/ProductPrices/controls/`. Keep each file's existing type imports (WP20 may have moved `Currency` to `app/types/market`); only the JSX and the option arrays change.

19a. `ChartTimeframeButtons.tsx`: replace the component body. Keep the `TIMEFRAMES` array and the props interface.

```tsx
import SegmentedControl from "../../ui/SegmentedControl";
// keep the file's existing `ChartTimeframe` type import

// ...props interface and TIMEFRAMES unchanged...

const TIMEFRAME_OPTIONS = TIMEFRAMES.map((timeframe) => ({ value: timeframe, label: timeframe }));

export default function ChartTimeframeButtons({ selected, onChange }: ChartTimeframeButtonsProps) {
  // Visible "Chart", accessible "Chart timeframe" (WP14's name). WP30 renames it "Period".
  return (
    <SegmentedControl
      label="Chart"
      ariaLabel="Chart timeframe"
      options={TIMEFRAME_OPTIONS}
      value={selected}
      onChange={onChange}
    />
  );
}
```

19b. `CurrencySelector.tsx`: replace the component body. Copy the rate `<span>` exactly as the file has it now (class list and text), only its position changes to the `trailing` slot. Remove the `useId` import and `labelId` WP14 added if nothing else uses them.

```tsx
import SegmentedControl, { type SegmentedOption } from "../../ui/SegmentedControl";
// keep the file's existing `Currency` type import and props interface

const CURRENCY_OPTIONS: readonly SegmentedOption<Currency>[] = [
  { value: "USD", label: "🇺🇸 USD" },
  { value: "CAD", label: "🇨🇦 CAD" },
];

export default function CurrencySelector({
  selectedCurrency,
  exchangeRate,
  exchangeRateLoading,
  onChange,
}: CurrencySelectorProps) {
  return (
    <SegmentedControl
      label="Currency"
      options={CURRENCY_OPTIONS}
      value={selectedCurrency}
      onChange={onChange}
      fullWidthOnPhone={false}
      trailing={
        <span className="text-[11px] font-medium text-slate-500 tabular-nums whitespace-nowrap">
          {exchangeRateLoading ? "rate…" : `1 USD = ${exchangeRate.toFixed(4)} CAD`}
        </span>
      }
    />
  );
}
```

The same component renders on `/prices` and `/market` (through `ControlBar`), `/box-calculator` and `/portfolio` (WP20). All four get the new control; their `onChange` handlers are unchanged.

19c. `SortControls.tsx`: leave the "Sort by" block exactly as it is (sort keys toggle direction, which is not a one-of-N choice). Replace the whole `{/* View */}` block with the control below, and derive the options from the existing `VIEW_MODES` array so WP08's keys and labels are kept. Remove the `${baseId}-view` id WP14 added; keep `baseId` for "Sort by".

```tsx
import SegmentedControl from "../../ui/SegmentedControl";

const VIEW_OPTIONS = VIEW_MODES.map(({ key, label }) => ({ value: key, label }));

// in the JSX, replacing the {/* View */} block:
      {/* View */}
      <SegmentedControl
        label="View"
        options={VIEW_OPTIONS}
        value={viewMode}
        onChange={onViewModeChange}
        fullWidthOnPhone={false}
      />
```

`fullWidthOnPhone={false}` keeps today's phone layout (the view buttons were never full width). The timeframe control keeps the default (full width on phones, as today).

### Step 20. `/prices`: run the heavy toggles at transition priority and dim the list

`frontend/app/components/ProductPrices/index.tsx`:

20a. Add `useTransition` to the existing React import, and below the other state hooks:

```ts
  // Toggles re-render ~306 cards. Running them as a transition lets the
  // pressed segment paint on the next frame; the list dims while pending
  // (research/performance-excellence.md §13.2).
  const [isTogglePending, startToggleTransition] = useTransition();
```

20b. Wrap the three toggle handlers passed to `ControlBar` and `SortControls` (the other handlers, including search, stay as they are):

```tsx
          onChartTimeframeChange={(chart) =>
            startToggleTransition(() => updateUrlState({ chart }))
          }
          onCurrencyChange={(currency) =>
            startToggleTransition(() => {
              updateUrlState({ currency });
              // WP20: an explicit choice becomes the site-wide preference.
              rememberCurrency(currency);
            })
          }
```

```tsx
          onViewModeChange={(view) => startToggleTransition(() => updateUrlState({ view }))}
```

If WP20's `rememberCurrency` line is absent, wrap only `updateUrlState({ currency })`.

20c. Replace the bare `{cardList}` line with:

```tsx
        {cardList && (
          <div
            aria-busy={isTogglePending || undefined}
            className={`transition-opacity duration-150 motion-reduce:transition-none ${
              isTogglePending ? "opacity-70" : ""
            }`}
          >
            {cardList}
          </div>
        )}
```

The wrapper is a plain block inside the existing `space-y-*` column, so spacing is unchanged. Do not put `isTogglePending` into the `cardList` `useMemo` dependencies; the memo must stay keyed on data only.

### Step 21. `MiniSparkline`: flat skeleton bar and "No history"

`frontend/app/components/MarketView/MiniSparkline.tsx` (WP09 version):

21a. Add `import Skeleton from "../ui/Skeleton";` below the existing imports.

21b. Replace the whole `SparklineSkeleton` function (the pulsing zigzag `<svg>` and its comment) with:

```tsx
// Not loaded yet (below the fold, or loading): a flat neutral bar in the
// sparkline's box. Never a fake chart shape (01-PRODUCT-DIRECTION.md §3.4).
function SparklineSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      data-testid="sparkline-skeleton"
      aria-hidden="true"
      className={`flex h-10 w-24 items-center ${className}`}
    >
      <Skeleton className="h-1 w-full" />
    </div>
  );
}

// Loaded, but fewer than two daily points: say so instead of drawing nothing.
function SparklineEmpty({ className = "" }: { className?: string }) {
  return (
    <div className={`flex h-10 w-24 items-center justify-center text-xs text-ink-soft ${className}`}>
      No history
    </div>
  );
}
```

21c. In `MiniSparkline`, replace

```tsx
  if (!path) {
    return <SparklineSkeleton className={className} />;
  }
```

with

```tsx
  if (!path) {
    // undefined = not loaded yet; an array (even []) = loaded.
    return history === undefined ? (
      <SparklineSkeleton className={className} />
    ) : (
      <SparklineEmpty className={className} />
    );
  }
```

Leave `buildSparklinePath`, the stroke constants, the polyline and the `memo` export unchanged (the stroke colours are WP26's to revisit).

21d. Check the call sites: `grep -rn "<MiniSparkline" app --include=*.tsx | grep -v __tests__`. Each must pass `history={...}` straight from the history map (`priceHistory[product.id]` in `ProductCard`'s parent, `row.history` in `MarketView/columns.tsx`), which is `undefined` until loaded. `MarketRow.history` is typed `PriceHistoryEntry[] | undefined` in `MarketView/buildRows.ts` (WP17); confirm with `grep -n "history: PriceHistoryEntry\[\] | undefined" app/components/MarketView/buildRows.ts`. If any call site or row builder coalesces with `?? []` or `|| []`, remove that coalescing for the value passed to `MiniSparkline` only (keep it for the maths); otherwise every unloaded card would say "No history".

### Step 22. `SortableTable`: dense rows and a visible sort state

`frontend/app/components/SortableTable/SortableTable.tsx` (WP18):

22a. Replace the `SortButton` function body's `indicator`, `alignment` and returned JSX with:

```tsx
  const isActive = sort.key === sortKey;
  const indicator = isActive ? (sort.direction === "asc" ? "▲" : "▼") : "↕";

  const handleClick = () => {
    onSortChange(
      isActive
        ? { key: sortKey, direction: sort.direction === "asc" ? "desc" : "asc" }
        : { key: sortKey, direction: "asc" }
    );
  };

  const alignment = align === "right" ? "justify-end text-right" : "justify-start";

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex h-10 w-full items-center gap-1 text-xs uppercase tracking-wide transition-colors duration-150 motion-reduce:transition-none hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action pointer-coarse:min-h-11 ${
        isActive ? "font-bold text-ink" : "font-semibold text-ink-soft"
      } ${alignment}`}
    >
      <span>{label}</span>
      <span aria-hidden="true" className={isActive ? "text-xs text-ink" : "text-xs text-muted"}>
        {indicator}
      </span>
    </button>
  );
```

`text-muted` (slate-400) is allowed here only because the inactive arrow is decorative and `aria-hidden` (WP14 rule).

22b. In `SortableTableImpl`'s returned JSX, change only these class lists and add one attribute; keep the caption, colgroup, sorting, `aria-sort` and empty-row logic:

- `<table className={`w-full table-fixed border-separate border-spacing-y-2 text-sm ${minWidthClassName}`}>` becomes `` <table className={`w-full table-fixed border-collapse text-sm tabular-nums ${minWidthClassName}`}> ``.
- The header `<tr>` gets `className="border-b border-line"`.
- Each header `<th>`: `className={`px-3 pb-2 ${...}`}` becomes `` className={`h-10 px-3 align-middle ${align === "right" ? "text-right" : "text-left"}`} `` and add `data-sorted={isActive ? "true" : undefined}`.
- The unsortable header `<span>`: `text-slate-600` becomes `text-ink-soft`.
- Each body `<tr>`: `className="rounded-xl bg-slate-50/80 shadow-sm ring-1 ring-slate-200/60 transition hover:bg-white"` becomes `className="h-11 border-b border-line bg-surface transition-colors duration-150 motion-reduce:transition-none hover:bg-surface-alt"`.
- The empty-message `<td>`: `text-slate-500` becomes `text-ink-soft`.

22c. `frontend/app/compare/compareColumns.tsx`: one line per row, so long SKUs and titles truncate instead of wrapping the row past 44 px.

- `skuColumn`: `cellClassName: "px-3 py-3 font-medium text-slate-900 break-all"` becomes `"px-3 py-3 font-medium text-slate-900 truncate"`, and add `cellTitle: (row) => row.sku,`.
- `titleColumn`: `cellClassName: "px-3 py-3 text-slate-600 break-words"` becomes `"px-3 py-3 text-slate-600 truncate"` (it already has `cellTitle`).

Nothing else in `/compare` changes. `CompareTabs` is WAI-ARIA tabs, not a segmented control: leave it.

### Step 23. Search inputs: 16 px on phones

In each search input's class list, replace `text-sm` with `text-base sm:text-sm` (iOS zooms into focused inputs under 16 px; `research/performance-excellence.md` §13.1). Do not change `type`, placeholder or `aria-label` (WP14's tests query `role="textbox"`).

| File | Input |
|---|---|
| `app/components/ProductPrices/controls/SearchInput.tsx` | the only `<input>` |
| `app/page.tsx` | the hero form's `<input name="q">` |
| `app/components/NotFoundPanel.tsx` (WP13) | the form's `<input name="q">` |
| `app/compare/CompareDashboard.tsx` | the "Search SKU or title" input |

Confirm with `grep -rn 'name="q"\|Search SKU or title\|placeholder={placeholder}' app --include=*.tsx | grep -v __tests__`: four inputs plus `ProductSearchSelect` (the portfolio combobox has no size class, so it is already 16 px; leave it).

### Step 24. `app/__tests__/uiConventions.test.ts`: design-system rules and ratchets

Append the block below to the end of WP15's file. It reuses WP15's `SOURCES`, `violations`, `fs` and `path`; if WP15 named them differently, use its names.

```ts
// ---------------------------------------------------------------------------
// WP23 design-system rules: red is the brand accent only, one font family,
// no new raw colours, and components/ui stays token-only.
//
// Two rules are ratchets against uiConventions.baseline.json (per-file counts
// that may only go down). Regenerate after legitimately LOWERING a count:
//   UPDATE_UI_BASELINE=1 pnpm exec jest app/__tests__/uiConventions.test.ts
// A PR that raises a count must say why in its description.
// ---------------------------------------------------------------------------

// Files that render the logo mark and the wordmark accent.
const BRAND_FILES = ["components/Header.tsx", "components/Footer.tsx"];
const UI_DIR = "components/ui/";
// WP14/WP15 components written before the token utilities existed.
const UI_LEGACY = ["components/ui/Dialog.tsx", "components/ui/ConfirmDialog.tsx"];

const RED_UTILITY_RE =
  /\b(?:[a-z-]+:)*(?:text|bg|border|ring|outline|fill|stroke|from|via|to|divide|decoration|accent|caret|shadow|placeholder)-red-\d{2,3}\b/g;
const ACCENT_RE =
  /--pf-accent\b|\b(?:[a-z-]+:)*(?:text|bg|border|fill|stroke|ring|decoration)-accent\b/g;
const BRAND_RED_RE =
  /--pf-pokeball(?:-strong)?\b|\b(?:[a-z-]+:)*(?:text|bg|border|ring|outline|fill|stroke|from|via|to|divide|decoration|accent|shadow)-pokeball(?:-strong)?\b/g;
const HEX_RE = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const RAW_PALETTE_RE =
  /\b(?:[a-z-]+:)*(?:text|bg|border|ring|outline|fill|stroke|from|via|to|divide|placeholder|decoration|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

type Baseline = Record<"hex" | "brandRed", Record<string, number>>;

function countPerFile(re: RegExp): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const source of SOURCES) {
    const count = [...source.text.matchAll(re)].length;
    if (count > 0) counts[source.file] = count;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))
  );
}

const BASELINE_PATH = path.join(__dirname, "uiConventions.baseline.json");
const CURRENT: Baseline = {
  hex: countPerFile(HEX_RE),
  brandRed: countPerFile(BRAND_RED_RE),
};
if (process.env.UPDATE_UI_BASELINE === "1") {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(CURRENT, null, 2)}\n`);
}
const BASELINE: Baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));

function ratchet(kind: keyof Baseline): string[] {
  const errors: string[] = [];
  const allowed = BASELINE[kind];
  const now = CURRENT[kind];
  for (const [file, count] of Object.entries(now)) {
    const max = allowed[file] ?? 0;
    if (count > max) errors.push(`${file}: ${count} > baseline ${max}`);
  }
  for (const [file, max] of Object.entries(allowed)) {
    const count = now[file] ?? 0;
    if (count < max) errors.push(`${file}: ${count} < baseline ${max}; lower the baseline`);
  }
  return errors;
}

describe("design system (WP23)", () => {
  it("uses no Tailwind red-* utilities outside the logo files", () => {
    expect(violations(RED_UTILITY_RE, BRAND_FILES)).toEqual([]);
  });

  it("uses the brand accent only in the logo files", () => {
    expect(violations(ACCENT_RE, BRAND_FILES)).toEqual([]);
  });

  it("adds no brand red (--pf-pokeball) beyond the baseline", () => {
    expect(ratchet("brandRed")).toEqual([]);
  });

  it("adds no raw hex colour beyond the baseline", () => {
    expect(ratchet("hex")).toEqual([]);
  });

  it("uses one font family (no monospace utility)", () => {
    expect(violations(/\bfont-mono\b/g)).toEqual([]);
  });

  it("keeps components/ui token-only", () => {
    const uiFiles = SOURCES.filter(
      (s) => s.file.startsWith(UI_DIR) && !UI_LEGACY.includes(s.file)
    );
    expect(uiFiles.length).toBeGreaterThanOrEqual(12);
    const found = uiFiles.flatMap((s) =>
      [RAW_PALETTE_RE, HEX_RE, BRAND_RED_RE].flatMap((re) =>
        [...s.text.matchAll(re)].map((m) => `${s.file}: ${m[0]}`)
      )
    );
    expect(found).toEqual([]);
  });
});
```

Generate the baseline once, after steps 3 to 23 are done:

```bash
cd /home/user/Pokefin/frontend
UPDATE_UI_BASELINE=1 pnpm exec jest app/__tests__/uiConventions.test.ts
pnpm exec jest app/__tests__/uiConventions.test.ts      # passes without the variable
cat app/__tests__/uiConventions.baseline.json
```

Review the file before committing: `hex` lists only files that had hex colours before this PR (at review time `PriceChart.tsx`, `charts/PortfolioChartImpl.tsx`, `charts/AllocationChartImpl.tsx`, `Header.tsx`, `Footer.tsx`, `CardRinkPromo.tsx`, the four auth pages, `MarketView/MiniSparkline.tsx` with 2 after step 21, plus WP15's `global-error.tsx`); `brandRed` lists today's `--pf-pokeball` users. No `components/ui/` path may appear in either list. If one does, fix the component, do not keep the entry.

### Step 25. `frontend/app/components/ui/README.md` (new): usage rules

Write it with this content. Tailwind 4 scans Markdown files for class names, so keep class-looking words in this file to utilities that already exist in the components.

~~~markdown
# Pokéfin UI components

The shared vocabulary for every page (WP23, `audits/remediation/01-PRODUCT-DIRECTION.md` §3). Build pages from these parts. If a page needs something new and reusable, add it here with a test and an axe check.

## Rules

- **Colour roles.** Brand red (`--pf-accent`) is the logo mark and the wordmark "é" only. Blue (`--pf-action`) is the action colour: primary buttons, links, focus ring, selected segment, one primary action per view. Gain and loss colours (`--pf-gain-text`, `--pf-loss-text`) appear only on changes and returns, always with a glyph. Amber (`--pf-warn-text`, `--pf-warn-fill`) is the warning role. A seller's "priced below market" is neutral text, not loss red.
- **Tokens, not palette.** Components in this folder use token utilities only (`text-ink`, `text-ink-soft`, `bg-surface`, `bg-surface-alt`, `border-line`, `bg-action`, `text-gain-text`, `text-warn-text`, `rounded-control`, `rounded-card`). No raw palette classes and no hex. `app/__tests__/uiConventions.test.ts` enforces it.
- **Deprecated.** `--pf-pokeball` and `--pf-pokeblue` are aliases kept so old pages look the same. Do not add new uses; the conventions test ratchets them per file.
- **Type.** One family (Geist Sans). Every number is tabular. Scale: `text-display` 32, `text-h1` 24, `text-h2` 20, `text-h3` 16, `text-body` 14, `text-prose` 16, `text-small` 13, `text-caption` 12. Nothing smaller than 12 px. Set codes: `font-sans tabular-nums tracking-wide uppercase`.
- **Density.** Desktop tables: 40 px header, 44 px one-line rows, sorted column bold with a visible arrow and `aria-sort`. Phones below 768 px: `DataList` rows (56 px minimum), never a desktop table in a scroll box.
- **Radii and spacing.** 8 px for controls and chips (`rounded-control`), 12 px for cards and dialogs (`rounded-card`). 4 px spacing base. Borders first; shadows only on overlays.
- **Badges.** At most one per row. Text variants only: neutral, info, warn. Group-level facts go in the group header once.
- **Precision.** `formatPercent` and `formatSignedPercent` from `app/lib/format.ts`: returns and changes 1 decimal, shares and consistency `decimals: 0`. Money: `formatMoney`, with the currency code on headline prices. Changes inside ±0.05% are flat (`FLAT_BAND_PERCENT`).
- **Touch.** Every interactive control is at least 44 px on coarse pointers (`pointer-coarse:min-h-11`).
- **Motion.** Colour and opacity only, 150 ms, disabled under reduced motion. Skeletons are flat bars. No pulsing, shimmer or count-up numbers.
- **Honesty.** Every headline price carries an `AsOf`. Missing values show `--` with a screen-reader reason. Never write "live", "real-time" or "all-time".

## Components

| Component | Use it for | Do not |
|---|---|---|
| `Delta` | Any change or return: glyph, 1 decimal, dead band, `--` with a reason when null | Colour a price or a level with gain/loss |
| `Stat` | KPI tiles and quote headers: label slot, value, optional Delta, sub-line, AsOf | Put more than one number in the value |
| `Badge` | One short status per row | Add a second badge to a row, or use it as a button |
| `SegmentedControl` | One-of-N view, period and currency toggles; `onChange` runs in a transition | Use it for tabs that swap panels (use tabs) or for sort keys with a direction |
| `PageHeader` | Every page title: H1, provenance slot, actions slot | Add a red eyebrow |
| `DataList`, `DataListRow` | Every dataset below 768 px: two-line link rows, optional 64x24 sparkline | Nest buttons inside a row link |
| `EmptyState` | Zero results, empty portfolio, empty watchlist: title, one sentence, one action | Show zero-filled tiles instead |
| `Skeleton` | Loading placeholders | Draw a fake chart or animate it |
| `RangeBar` | 52-week or tracked range with its accessible sentence | Call it "all-time" |
| `Button`, `buttonClasses` | Actions; `buttonClasses()` styles a `Link` | Make a button red |
| `AsOf` | The TCGplayer day behind a price; warns at 2 days or older; table variant shows only a clock when stale | Show render time or "x minutes ago" in cached HTML |
| `ProvenanceLine` | The line under a data page's title: source, cadence, stale rule, methodology link | Write per-card "Updated" stamps |
| `Dialog`, `ConfirmDialog` | Modal content and destructive confirmations (WP14, WP15) | Build a new overlay |

## Tests

Each component has a Jest test in `__tests__/` that includes an axe-core check through `test-utils/axe.ts` (`expect(await axeViolations(container)).toEqual([])`).
~~~

### Step 26. Contributor docs

If `/home/user/Pokefin/.github/copilot-instructions.md` exists (WP20 rewrote it), find the styling line (`Styling: Tailwind CSS 4, mobile first, ...`) and append one sentence to that paragraph:

```text
Shared UI parts, tokens and the colour, type, density and precision rules are in `frontend/app/components/ui/README.md` (WP23); build pages from those components.
```

If the file does not exist, skip this step and say so in the PR.

### Step 27. Update the existing tests that the migration changes

27a. `app/components/ProductPrices/__tests__/controls.a11y.test.tsx` (WP14):

- `CurrencySelector` case: `getByRole("group", { name: "Currency" })` becomes `getByRole("radiogroup", { name: "Currency" })`; inside it expect `getAllByRole("radio")` to have length 2 and `getByRole("radio", { name: /USD/ })`, `getByRole("radio", { name: /CAD/ })` to exist.
- `SortControls` case: the "Sort by" group assertion stays; the "View" assertion becomes `getByRole("radiogroup", { name: "View" })`.
- `ChartTimeframeButtons` case: unchanged (radiogroup named "Chart timeframe", no `<label>` element). It must pass as is.
- `SearchInput` case: unchanged.

27b. `app/components/MarketView/__tests__/MiniSparkline.test.tsx` (WP09): replace the case "shows the skeleton without history" with the two cases in Tests section 13. Every other case stays.

27c. Other tests that clicked the migrated toggles as buttons:

```bash
grep -rnE 'aria-pressed|name: /?(🇺🇸 )?USD|name: /?(🇨🇦 )?CAD|By Type|By Set|"Flat"|name: "(7D|1M|3M|6M|1Y)"' app --include=*.test.tsx --include=*.test.ts
```

For each hit that targets a currency, timeframe or view toggle, change `getByRole("button", ...)` to `getByRole("radio", ...)` and `aria-pressed` to `aria-checked`. Leave sort-key buttons (`Release Date`, `Price`) and every other `aria-pressed` (HoldingsTable's `SortButton`) unchanged. List every edited test in the PR.

### Step 28. Performance budget file

WP22 already caps preloaded fonts at one file per route, and Geist Mono was loaded with `preload: false`, so the preload count is 1 before and after this PR; the gain is that the mono `@font-face` rules leave the CSS and the late mono request on `/prices`, `/`, `/stats` and `/product/[id]` disappears. Do not edit `frontend/perf-budgets.json`: this PR adds no route and must not raise any limit. If `pnpm perf:budget` reports a limit breach, reduce the cost (for example a component accidentally marked `"use client"`) instead of raising the limit.

## Pitfalls: do not do this

- **Do not change any existing token value or remove `--pf-pokeball`/`--pf-pokeblue`.** They are aliases now; existing pages must look identical outside the migrated controls.
- **Do not repaint red CTAs (Search button, auth buttons, spinners) in this PR.** The ratchet stops new uses; page packages move their CTAs to `Button`. A sweep here would break the "no visual change" acceptance and collide with WP24 to WP37.
- **Do not use raw palette classes or hex in `components/ui/`.** Only token utilities. The conventions test fails otherwise.
- **Do not write the monospace utility name anywhere under `app/`, comments included.** The conventions test is a text scan. If a monospace face is ever needed, use the system stack `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` through a token, not Geist Mono.
- **Do not animate `Skeleton`** or keep `animate-pulse` in the sparkline skeleton. No shape, no pulse.
- **Do not show "No history" for `history === undefined`.** Undefined means "not loaded yet".
- **Do not call `onChange` outside `startTransition`, and do not derive `aria-checked` from `value`.** Use the optimistic `shown` value, or the pressed state lags the list render.
- **Do not add `"use client"` to components that do not need it.** Only `SegmentedControl` uses hooks. The rest must stay usable from server components.
- **Do not call `new Date()` or `Date.now()` directly in a component body** (`react-hooks/purity`). `AsOf` uses the module helper `todayUtcKey()`.
- **Do not create `app/components/ui/index.ts`.** Direct imports only (WP20 removed barrels).
- **Do not import `formatPercent` from `lib/format` into `app/compare/compareColumns.tsx`.** It has its own local function of that name; migrating it is a later package's job.
- **Do not change search input `type` to `search`.** WP14's tests query `role="textbox"`; the global search (WP27) sets its own attributes.
- **Do not add `jest-axe`.** Use `axe-core` through `test-utils/axe.ts`.
- **Do not regenerate `uiConventions.baseline.json` to hide a new violation.** Only lowered counts are legitimate.
- **Do not turn `CompareTabs` or the sort-key buttons into `SegmentedControl`.** Tabs swap panels; sort keys carry a direction.
- **Do not put `isTogglePending` in the `cardList` memo dependencies**, and do not dim anything but the card list.
- **Do not remove the `@custom-variant dark` line** in `globals.css`; it keeps stray `dark:` classes inert.
- **Do not add a dark theme or `prefers-color-scheme` rules.** Light-only is decided for this track.
- **Do not write em dashes** in code comments, copy, the README or the PR.

## Tests

All paths relative to `frontend/`. Default environment is jsdom. Import the axe helper as `import { axeViolations } from "@/test-utils/axe";`.

### 1. `app/lib/__tests__/format.percent.test.ts` (new)

```ts
import {
  changeDirection,
  FLAT_BAND_PERCENT,
  formatPercent,
  formatSignedPercent,
} from "../format";

describe("formatPercent", () => {
  it.each([
    [4.23, "4.2%"],
    [-4.25, "-4.3%"],
    [0, "0.0%"],
    [-0.04, "0.0%"],
    [0.05, "0.1%"],
    [-38.73, "-38.7%"],
    [1234.56, "1,234.6%"],
  ])("%p -> %p", (value, expected) => {
    expect(formatPercent(value)).toBe(expected);
  });

  it("prints shares and consistency as integers", () => {
    expect(formatPercent(60, { decimals: 0 })).toBe("60%");
    expect(formatPercent(59.5, { decimals: 0 })).toBe("60%");
    expect(formatPercent(-0.4, { decimals: 0 })).toBe("0%");
  });

  it("returns the missing marker for non-numbers", () => {
    expect(formatPercent(null)).toBe("--");
    expect(formatPercent(undefined)).toBe("--");
    expect(formatPercent(Number.NaN)).toBe("--");
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("--");
    expect(formatPercent(null, { missing: "N/A" })).toBe("N/A");
  });
});

describe("formatSignedPercent", () => {
  it.each([
    [4.2, "+4.2%"],
    [-4.2, "-4.2%"],
    [0, "0.0%"],
    [0.04, "0.0%"],
    [-0.04, "0.0%"],
    [12345.67, "+12,345.7%"],
  ])("%p -> %p", (value, expected) => {
    expect(formatSignedPercent(value)).toBe(expected);
  });

  it("supports integers and the missing marker", () => {
    expect(formatSignedPercent(7.6, { decimals: 0 })).toBe("+8%");
    expect(formatSignedPercent(null)).toBe("--");
  });
});

describe("changeDirection", () => {
  it("uses a ±0.05% dead band", () => {
    expect(FLAT_BAND_PERCENT).toBe(0.05);
    expect(changeDirection(0)).toBe("flat");
    expect(changeDirection(0.049)).toBe("flat");
    expect(changeDirection(-0.049)).toBe("flat");
    expect(changeDirection(0.05)).toBe("up");
    expect(changeDirection(-0.05)).toBe("down");
    expect(changeDirection(3)).toBe("up");
    expect(changeDirection(-3)).toBe("down");
  });

  it("never pairs an arrow with 0.0% and never shows 0.0% with an arrow", () => {
    for (let i = -200; i <= 200; i += 1) {
      const value = i / 1000;
      const shown = formatPercent(Math.abs(value));
      if (changeDirection(value) === "flat") expect(shown).toBe("0.0%");
      else expect(shown).not.toBe("0.0%");
    }
  });
});
```

### 2. `app/components/ui/__tests__/Delta.test.tsx` (new)

```tsx
import { render, screen } from "@testing-library/react";
import Delta from "../Delta";
import { axeViolations } from "@/test-utils/axe";

function root(container: HTMLElement) {
  return container.firstElementChild as HTMLElement;
}

describe("<Delta>", () => {
  it("shows a gain with ▲, one decimal, the gain token and a spoken direction", () => {
    const { container } = render(<Delta value={4.23} period="30D" />);
    expect(root(container)).toHaveAttribute("data-direction", "up");
    expect(root(container)).toHaveClass("text-gain-text");
    expect(screen.getByText("4.2%")).toBeInTheDocument();
    expect(screen.getByText("▲")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Up")).toHaveClass("sr-only");
    expect(screen.getByText("30D")).toBeInTheDocument();
  });

  it("shows a loss with ▼ and an unsigned magnitude", () => {
    const { container } = render(<Delta value={-3.06} />);
    expect(root(container)).toHaveAttribute("data-direction", "down");
    expect(root(container)).toHaveClass("text-loss-text");
    expect(screen.getByText("3.1%")).toBeInTheDocument();
    expect(screen.getByText("▼")).toBeInTheDocument();
    expect(screen.getByText("Down")).toHaveClass("sr-only");
  });

  it("treats changes inside ±0.05% as flat, with no glyph", () => {
    const { container } = render(<Delta value={0.04} />);
    expect(root(container)).toHaveAttribute("data-direction", "flat");
    expect(root(container)).toHaveClass("text-ink-soft");
    expect(screen.getByText("0.0%")).toBeInTheDocument();
    expect(screen.queryByText("▲")).toBeNull();
    expect(screen.queryByText("▼")).toBeNull();
    expect(screen.getByText("Unchanged")).toHaveClass("sr-only");
  });

  it("starts the arrow at exactly 0.05%", () => {
    const { container } = render(<Delta value={0.05} />);
    expect(root(container)).toHaveAttribute("data-direction", "up");
    expect(screen.getByText("0.1%")).toBeInTheDocument();
  });

  it("shows -- with a screen-reader reason when the value is missing", () => {
    const { container, rerender } = render(<Delta value={null} />);
    expect(root(container)).toHaveAttribute("data-direction", "missing");
    expect(screen.getByText("--")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Not available")).toHaveClass("sr-only");
    rerender(<Delta value={Number.NaN} missingReason="Price withheld" />);
    expect(screen.getByText("Price withheld")).toHaveClass("sr-only");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <p>
        <Delta value={4.2} period="7D" /> <Delta value={-1.5} /> <Delta value={0} />{" "}
        <Delta value={null} />
      </p>
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
```

### 3. `app/components/ui/__tests__/SegmentedControl.test.tsx` (new)

```tsx
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import SegmentedControl, { type SegmentedOption } from "../SegmentedControl";
import { axeViolations } from "@/test-utils/axe";

type Period = "7D" | "1M" | "1Y";

const OPTIONS: readonly SegmentedOption<Period>[] = [
  { value: "7D", label: "7D" },
  { value: "1M", label: "1M" },
  { value: "1Y", label: "1Y" },
];

function Harness({
  initial = "7D",
  onChange = () => {},
  accept = true,
  ariaLabel,
  hideLabel,
}: {
  initial?: Period;
  onChange?: (value: Period) => void;
  accept?: boolean;
  ariaLabel?: string;
  hideLabel?: boolean;
}) {
  const [value, setValue] = useState<Period>(initial);
  return (
    <SegmentedControl
      label="Period"
      ariaLabel={ariaLabel}
      hideLabel={hideLabel}
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        onChange(next);
        if (accept) setValue(next);
      }}
    />
  );
}

const radio = (name: string) => screen.getByRole("radio", { name });

describe("<SegmentedControl>", () => {
  it("is a named radiogroup with one tab stop on the checked option", () => {
    render(<Harness initial="1M" />);
    expect(screen.getByRole("radiogroup", { name: "Period" })).toBeInTheDocument();
    expect(radio("1M")).toHaveAttribute("aria-checked", "true");
    expect(radio("1M")).toHaveAttribute("tabindex", "0");
    expect(radio("7D")).toHaveAttribute("tabindex", "-1");
    expect(radio("1Y")).toHaveAttribute("tabindex", "-1");
  });

  it("selects on click and reports the value", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(radio("1Y"));
    expect(onChange).toHaveBeenCalledWith("1Y");
    expect(radio("1Y")).toHaveAttribute("aria-checked", "true");
    expect(radio("7D")).toHaveAttribute("aria-checked", "false");
  });

  it("ignores a click on the checked option", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(radio("7D"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("moves focus and selection with arrows (wrapping), Home and End", () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    radio("7D").focus();
    fireEvent.keyDown(radio("7D"), { key: "ArrowRight" });
    expect(radio("1M")).toHaveFocus();
    expect(radio("1M")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radio("1M"), { key: "End" });
    expect(radio("1Y")).toHaveFocus();
    fireEvent.keyDown(radio("1Y"), { key: "ArrowRight" });
    expect(radio("7D")).toHaveFocus();
    fireEvent.keyDown(radio("7D"), { key: "ArrowLeft" });
    expect(radio("1Y")).toHaveFocus();
    fireEvent.keyDown(radio("1Y"), { key: "Home" });
    expect(radio("7D")).toHaveFocus();
    fireEvent.keyDown(radio("7D"), { key: "a" });
    expect(onChange.mock.calls.map(([value]) => value)).toEqual(["1M", "1Y", "7D", "1Y", "7D"]);
  });

  it("stays controlled when the parent rejects a change", () => {
    const onChange = jest.fn();
    render(<Harness accept={false} onChange={onChange} />);
    fireEvent.click(radio("1Y"));
    expect(onChange).toHaveBeenCalledWith("1Y");
    expect(radio("7D")).toHaveAttribute("aria-checked", "true");
    expect(radio("1Y")).toHaveAttribute("aria-checked", "false");
  });

  it("uses ariaLabel as the name and hides the shorter visible label from AT", () => {
    render(<Harness ariaLabel="Chart timeframe" />);
    expect(screen.getByRole("radiogroup", { name: "Chart timeframe" })).toBeInTheDocument();
    expect(screen.getByText("Period")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the name when the label is visually hidden", () => {
    render(<Harness hideLabel />);
    expect(screen.getByRole("radiogroup", { name: "Period" })).toBeInTheDocument();
    expect(screen.getByText("Period")).toHaveClass("sr-only");
  });

  it("has 44 px targets on coarse pointers and never uses brand red", () => {
    render(<Harness />);
    for (const element of screen.getAllByRole("radio")) {
      expect(element).toHaveClass("pointer-coarse:min-h-11", "pointer-coarse:min-w-11");
      expect(element.className).not.toMatch(/\bred-\d|pokeball|-accent\b/);
    }
    expect(radio("7D")).toHaveClass("bg-action");
  });

  it("has no axe violations", async () => {
    const { container } = render(<Harness />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
```

### 4. `app/components/ui/__tests__/SegmentedControl.transition.test.tsx` (new)

Proves `onChange` runs inside `startTransition`. The `react` mock only wraps `startTransition`; everything else is the real module.

```tsx
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import SegmentedControl from "../SegmentedControl";

type Flag = { __pfInTransition?: boolean };

jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    startTransition: (callback: () => void) =>
      actual.startTransition(() => {
        (globalThis as Flag).__pfInTransition = true;
        try {
          callback();
        } finally {
          (globalThis as Flag).__pfInTransition = false;
        }
      }),
  };
});

it("calls onChange inside startTransition", () => {
  const seen: boolean[] = [];
  function Harness() {
    const [value, setValue] = useState<"a" | "b">("a");
    return (
      <SegmentedControl
        label="Mode"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        value={value}
        onChange={(next) => {
          seen.push(Boolean((globalThis as Flag).__pfInTransition));
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("radio", { name: "B" }));
  expect(seen).toEqual([true]);
  expect(screen.getByRole("radio", { name: "B" })).toHaveAttribute("aria-checked", "true");
});
```

If spreading the mocked `react` module breaks rendering in this Jest version (an "Invalid hook call" error), replace this file's assertion with: spy on `console.error`, click "B", and assert that no call mentions "optimistic state update occurred outside a transition" (React's warning when `useOptimistic` is set outside a transition). Say which variant you used in the PR.

### 5. `app/components/ui/__tests__/SegmentedControl.ssr.test.tsx` (new)

```tsx
/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server";
import SegmentedControl from "../SegmentedControl";

it("renders the radiogroup and its checked state on the server", () => {
  const html = renderToStaticMarkup(
    <SegmentedControl
      label="View"
      options={[
        { value: "grouped", label: "By Set" },
        { value: "flat", label: "Flat" },
      ]}
      value="flat"
      onChange={() => {}}
    />
  );
  expect(html).toContain('role="radiogroup"');
  expect(html).toMatch(/aria-checked="true"[^>]*>Flat</);
});
```

### 6. `app/components/ui/__tests__/AsOf.test.tsx` (new)

```tsx
import { render, screen } from "@testing-library/react";
import AsOf, { daysBetween } from "../AsOf";
import { axeViolations } from "@/test-utils/axe";

const REF = "2026-09-30";

describe("daysBetween", () => {
  it("counts whole UTC days", () => {
    expect(daysBetween("2026-09-29", "2026-09-30")).toBe(1);
    expect(daysBetween("2026-09-30", "2026-09-30")).toBe(0);
    expect(daysBetween("2026-09-25", "2026-09-30")).toBe(5);
  });
});

describe("<AsOf>", () => {
  it("inline, fresh: 'as of Sep 29' in a <time>", () => {
    const { container } = render(<AsOf date="2026-09-29T04:10:00" referenceDate={REF} />);
    const time = container.querySelector("time")!;
    expect(time).toHaveAttribute("datetime", "2026-09-29");
    expect(time).toHaveTextContent("as of Sep 29");
    expect(time).toHaveClass("text-ink-soft");
    expect(time.querySelector("svg")).toBeNull();
  });

  it("inline, 2 days or older: clock and 'Last priced' in the warning colour", () => {
    const { container } = render(<AsOf date="2026-09-28" referenceDate={REF} />);
    const time = container.querySelector("time")!;
    expect(time).toHaveTextContent("Last priced Sep 28");
    expect(time).toHaveClass("text-warn-text");
    expect(time.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("hero: full date with year", () => {
    render(<AsOf date="2026-09-29" variant="hero" referenceDate={REF} />);
    expect(screen.getByText("as of Sep 29, 2026")).toBeInTheDocument();
  });

  it("shows the year when it differs from the reference year", () => {
    render(<AsOf date="2025-12-30" referenceDate="2025-12-31" />);
    expect(screen.getByText("as of Dec 30, 2025")).toBeInTheDocument();
  });

  it("table: nothing when fresh, a clock with a name when stale", () => {
    const { container, rerender } = render(
      <AsOf date="2026-09-29" variant="table" referenceDate={REF} />
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<AsOf date="2026-09-25" variant="table" referenceDate={REF} />);
    const time = container.querySelector("time")!;
    expect(time).toHaveAttribute("title", "Last priced Sep 25");
    expect(screen.getByText("Last priced Sep 25")).toHaveClass("sr-only");
  });

  it("renders nothing for a missing or malformed date", () => {
    const { container, rerender } = render(<AsOf date={null} referenceDate={REF} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AsOf date="not a date" referenceDate={REF} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <p>
        <AsOf date="2026-09-29" referenceDate={REF} />{" "}
        <AsOf date="2026-09-20" referenceDate={REF} />{" "}
        <AsOf date="2026-09-20" variant="table" referenceDate={REF} />
      </p>
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
```

### 7. `app/components/ui/__tests__/RangeBar.test.tsx` (new)

```tsx
import { render, screen } from "@testing-library/react";
import RangeBar, { describeRange, rangePosition } from "../RangeBar";
import { axeViolations } from "@/test-utils/axe";

describe("describeRange", () => {
  it.each([
    [100, 200, 124, "38% below 52-week high"],
    [100, 200, 200, "At 52-week high"],
    [100, 200, 250, "At 52-week high"],
    [100, 200, 100, "At 52-week low"],
    [100, 200, 199.5, "Less than 1% below 52-week high"],
    [150, 150, 150, "No 52-week range yet"],
  ])("low %p high %p value %p -> %p", (low, high, value, expected) => {
    expect(describeRange(low, high, value)).toBe(expected);
  });

  it("uses the window label", () => {
    expect(describeRange(100, 200, 124, "tracked")).toBe("38% below tracked high");
  });
});

describe("rangePosition", () => {
  it("clamps to the track", () => {
    expect(rangePosition(100, 200, 124)).toBe(24);
    expect(rangePosition(100, 200, 50)).toBe(0);
    expect(rangePosition(100, 200, 500)).toBe(100);
    expect(rangePosition(150, 150, 150)).toBe(50);
  });
});

describe("<RangeBar>", () => {
  it("places the marker and gives screen readers a sentence", () => {
    render(<RangeBar low={100} high={200} value={124} lowLabel="C$100.00" highLabel="C$200.00" />);
    expect(screen.getByTestId("range-marker")).toHaveStyle({ left: "24%" });
    expect(screen.getByText("38% below 52-week high")).toHaveClass("sr-only");
    expect(screen.getByText("C$100.00")).toBeInTheDocument();
    expect(screen.getByText("52-week high")).toHaveClass("sr-only");
  });

  it("shows the sentence when asked", () => {
    render(
      <RangeBar low={1} high={2} value={2} lowLabel="$1.00" highLabel="$2.00" showSummary />
    );
    expect(screen.getByText("At 52-week high")).not.toHaveClass("sr-only");
  });

  it("renders nothing for non-finite input", () => {
    const { container } = render(
      <RangeBar low={Number.NaN} high={2} value={1} lowLabel="" highLabel="" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <RangeBar low={100} high={200} value={124} lowLabel="C$100.00" highLabel="C$200.00" />
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
```

Note: `screen.getByText("52-week high")` matches the `sr-only` span text "52-week high " (trailing space trimmed by the default normalizer).

### 8. `app/components/ui/__tests__/DataList.test.tsx` (new)

```tsx
import { render, screen, within } from "@testing-library/react";
import { DataList, DataListRow } from "../DataList";
import Delta from "../Delta";
import { axeViolations } from "@/test-utils/axe";

function renderList() {
  return render(
    <DataList label="Products">
      <DataListRow
        href="/product/1"
        title="Booster Box"
        subtitle="Evolving Skies"
        meta="SWSH07"
        value="C$612.40"
        delta={<Delta value={4.2} period="30D" />}
        sparkline={<svg data-testid="spark" />}
      />
      <DataListRow title="Elite Trainer Box" subtitle="Silver Tempest" value="C$81.30" />
    </DataList>
  );
}

describe("<DataList>", () => {
  it("is a named list of two-line rows, one link per linked row", () => {
    renderList();
    const list = screen.getByRole("list", { name: "Products" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const link = within(items[0]).getByRole("link");
    expect(link).toHaveAttribute("href", "/product/1");
    expect(link).toHaveClass("min-h-14");
    expect(within(items[1]).queryByRole("link")).toBeNull();
    expect(screen.getByText("C$612.40")).toBeInTheDocument();
  });

  it("gives the sparkline a fixed, decorative 64x24 slot", () => {
    renderList();
    const slot = screen.getByTestId("spark").parentElement!;
    expect(slot).toHaveAttribute("data-slot", "sparkline");
    expect(slot).toHaveAttribute("aria-hidden", "true");
    expect(slot).toHaveClass("h-6", "w-16");
  });

  it("has no axe violations", async () => {
    const { container } = renderList();
    expect(await axeViolations(container)).toEqual([]);
  });
});
```

### 9. `app/components/ui/__tests__/Button.test.tsx` (new)

```tsx
import { render, screen } from "@testing-library/react";
import Button, { buttonClasses } from "../Button";
import { axeViolations } from "@/test-utils/axe";

describe("<Button>", () => {
  it("defaults to a primary action-colour button of type button", () => {
    render(<Button>Add to portfolio</Button>);
    const button = screen.getByRole("button", { name: "Add to portfolio" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("bg-action", "text-white", "pointer-coarse:min-h-11");
  });

  it("is never red in any variant", () => {
    for (const variant of ["primary", "secondary", "ghost"] as const) {
      expect(buttonClasses({ variant })).not.toMatch(/\bred-\d|pokeball|-accent\b/);
    }
  });

  it("passes native props through", () => {
    render(
      <Button type="submit" variant="secondary" disabled>
        Save
      </Button>
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toBeDisabled();
    expect(button).toHaveClass("border-line");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <div>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
      </div>
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
```

### 10. `app/components/ui/__tests__/Stat.test.tsx`, `Badge.test.tsx`, `PageHeader.test.tsx`, `EmptyState.test.tsx`, `Skeleton.test.tsx`, `ProvenanceLine.test.tsx` (new)

Write one file per component. Each ends with an axe case (`expect(await axeViolations(container)).toEqual([])`) on the rendered example.

- `Stat`: `render(<Stat label="Market Price" value="C$612.40" delta={<Delta value={4.2} />} sub="USD $450.00" asOf={<AsOf date="2026-09-29" referenceDate="2026-09-30" />} />)`: every text is present ("Market Price", "C$612.40", "4.2%", "USD $450.00", "as of Sep 29"); the value element has class `text-h2`; with `size="hero"` it has `text-display`.
- `Badge`: default `data-variant="neutral"` and class `text-ink-soft`; `variant="warn"` has `text-warn-text` and an `svg[aria-hidden="true"]`; `variant="info"` has `text-action-strong`; no variant's class list contains `rounded-full` or a `bg-` class.
- `PageHeader`: `getByRole("heading", { level: 1, name: "Prices" })`; provenance text and an actions button render; without `actions` no action container is rendered (`container.querySelectorAll("button")` is empty).
- `EmptyState`: default title is not a heading (`queryByRole("heading")` is null); `headingLevel={2}` gives `getByRole("heading", { level: 2, name: "No products match" })`; description and action render.
- `Skeleton`: `aria-hidden="true"`, has `data-skeleton`, and its class list matches none of `/animate-/`.
- `ProvenanceLine`: text renders; with `methodologyHref="/methodology#returns"` a link named "Methodology" points there; without it there is no link.

### 11. `app/components/SortableTable/__tests__/SortableTable.dense.test.tsx` (new)

WP18's `SortableTable.test.tsx` must pass unchanged next to it.

```tsx
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import SortableTable, { type SortState, type SortableColumn } from "../SortableTable";
import { SHOPIFY_MARGIN_COLUMNS } from "../../../compare/compareColumns";

type Row = { id: string; name: string; value: number };
type Key = "name" | "value";

const COLUMNS: SortableColumn<Row, Key>[] = [
  { id: "name", label: "Name", sortKey: "name", cellClassName: "px-3 py-3", cell: (r) => r.name },
  {
    id: "value",
    label: "Value",
    sortKey: "value",
    align: "right",
    widthClassName: "w-24",
    cellClassName: "px-3 py-3 text-right",
    cell: (r) => String(r.value),
  },
];
const ROWS: Row[] = [
  { id: "1", name: "a", value: 2 },
  { id: "2", name: "b", value: 1 },
];

function Harness() {
  const [sort, setSort] = useState<SortState<Key>>({ key: "value", direction: "desc" });
  return (
    <SortableTable
      caption="Dense"
      rows={ROWS}
      columns={COLUMNS}
      sort={sort}
      onSortChange={setSort}
      sortValue={(row, key) => row[key]}
      rowKey={(row) => row.id}
      emptyMessage="None"
    />
  );
}

describe("SortableTable dense layout", () => {
  it("uses collapsed 44 px rows and a 40 px header", () => {
    const { container } = render(<Harness />);
    const table = container.querySelector("table")!;
    expect(table).toHaveClass("border-collapse");
    expect(table).not.toHaveClass("border-separate");
    for (const row of Array.from(container.querySelectorAll("tbody tr"))) {
      expect(row).toHaveClass("h-11");
    }
    for (const th of screen.getAllByRole("columnheader")) {
      expect(th).toHaveClass("h-10");
    }
  });

  it("marks the sorted column bold with a visible arrow and aria-sort", () => {
    render(<Harness />);
    const [nameHeader, valueHeader] = screen.getAllByRole("columnheader");
    expect(valueHeader).toHaveAttribute("aria-sort", "descending");
    expect(valueHeader).toHaveAttribute("data-sorted", "true");
    const valueButton = screen.getByRole("button", { name: /Value/ });
    expect(valueButton).toHaveClass("font-bold");
    expect(valueButton).toHaveTextContent("▼");
    expect(nameHeader).not.toHaveAttribute("data-sorted");
    expect(screen.getByRole("button", { name: /Name/ })).toHaveClass("font-semibold");

    fireEvent.click(screen.getByRole("button", { name: /Value/ }));
    expect(valueHeader).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("button", { name: /Value/ })).toHaveTextContent("▲");
  });

  it("keeps compare SKU and title cells on one line", () => {
    const sku = SHOPIFY_MARGIN_COLUMNS.find((c) => c.id === "sku")!;
    const title = SHOPIFY_MARGIN_COLUMNS.find((c) => c.id === "title")!;
    expect(sku.cellClassName).toContain("truncate");
    expect(sku.cellTitle).toBeDefined();
    expect(title.cellClassName).toContain("truncate");
  });
});
```

### 12. `app/components/ProductPrices/__tests__/controls.a11y.test.tsx` (update)

As step 27a. After the change: `CurrencySelector` is a radiogroup named "Currency" with two radios; `SortControls` has a group named "Sort by" and a radiogroup named "View"; `ChartTimeframeButtons` and `SearchInput` cases unchanged. Add one case: rendering `ChartTimeframeButtons` with `selected="3M"` gives `getByRole("radio", { name: "3M" })` with `aria-checked="true"` and `tabindex="0"`.

### 13. `app/components/MarketView/__tests__/MiniSparkline.test.tsx` (update)

Add `screen` to the `@testing-library/react` import. Replace the "shows the skeleton without history" case with:

```tsx
  it("shows a flat skeleton bar while history is not loaded", () => {
    const { container } = render(<MiniSparkline />);
    expect(container.querySelector("polyline")).toBeNull();
    const skeleton = screen.getByTestId("sparkline-skeleton");
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(skeleton.querySelector("svg, path")).toBeNull();
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("says 'No history' when loaded history has fewer than two days", () => {
    const { rerender } = render(<MiniSparkline history={[]} />);
    expect(screen.getByText("No history")).toBeInTheDocument();
    expect(screen.queryByTestId("sparkline-skeleton")).toBeNull();
    rerender(<MiniSparkline history={daily([10])} />);
    expect(screen.getByText("No history")).toBeInTheDocument();
  });
```

`MiniSparkline.ssr.test.tsx` must pass unchanged.

### 14. `app/__tests__/uiConventions.test.ts` (extended in step 24)

Must pass on the finished tree without `UPDATE_UI_BASELINE`. Sanity-check the guards once by hand and revert each probe before moving on:

- add the monospace utility class to `ui/Badge.tsx`: the font rule fails;
- add `bg-red-500` to `ui/Button.tsx`: the red rule and the token-only rule fail;
- add the string `"#123456"` to `ui/Stat.tsx`: the hex ratchet and the token-only rule fail;
- add `bg-[var(--pf-pokeball)]` to `ui/Delta.tsx`: the brandRed ratchet and the token-only rule fail.

## Verification

Run from `frontend/`:

```bash
pnpm install --frozen-lockfile
# expect: exit 0 (lockfile includes axe-core as a direct dev dependency)

pnpm exec tsc --noEmit
# expect: exit 0

pnpm run lint
# expect: 0 errors, 0 new warnings (lint is blocking since WP17)
pnpm exec eslint app/components/ui test-utils app/lib/format.ts
# expect: no output

pnpm test --ci app/components/ui app/lib/__tests__/format.percent.test.ts \
  app/lib/__tests__/format.test.ts app/__tests__/uiConventions.test.ts \
  app/components/SortableTable app/components/MarketView/__tests__ \
  app/components/ProductPrices/__tests__/controls.a11y.test.tsx
# expect: all pass (about 20 suites; the new ui suites each include an axe case)

pnpm test --ci
# expect: all suites pass; suite count = base + 16 new files

# Static checks. Each expected result is exact.
grep -rn "font-mono\|Geist_Mono\|geist-mono" app | grep -v __tests__
# expect: no output
grep -rnE "animate-pulse|M0 28 L12 22" app/components/MarketView/MiniSparkline.tsx
# expect: no output
grep -c "color-scheme: light" app/globals.css
# expect: 1
grep -rlE "ui/(SegmentedControl|Skeleton)" app --include=*.tsx | grep -v __tests__ | sort
# expect exactly: app/components/MarketView/MiniSparkline.tsx and
# app/components/ProductPrices/controls/{ChartTimeframeButtons,CurrencySelector,SortControls}.tsx
ls app/components/ui
# expect: AsOf.tsx Badge.tsx Button.tsx ConfirmDialog.tsx DataList.tsx Delta.tsx Dialog.tsx
# EmptyState.tsx PageHeader.tsx ProvenanceLine.tsx README.md RangeBar.tsx SegmentedControl.tsx
# Skeleton.tsx Stat.tsx __tests__ icons.tsx (no index.ts)
```

Build and budgets (WP22):

```bash
SUPABASE_STUB_FIXTURE=perf pnpm build:stub
# expect: exit 0, "[build:stub] next build exited with 0"
rm -f .perf/ready
node scripts/perf-serve.mjs &
until [ -f .perf/ready ]; do sleep 2; done
pnpm perf:budget | tee /tmp/wp23-budget-after.txt
# expect: exit 0, every row within budget. Compare with /tmp/wp23-budget-before.txt:
# /prices initial JS grows by at most 2 kB gz (SegmentedControl); other routes within 2 kB.

find .next/static -name '*.css' -print0 | xargs -0 cat | gzip -9 | wc -c
# expect: <= 14336 (14 kB) and within 1.5 kB of /tmp/wp23-css-before.txt
grep -l "Geist Mono" $(find .next/static -name '*.css')
# expect: no output
curl -s http://127.0.0.1:3100/prices > /tmp/wp23-prices.html
grep -o '<link[^>]*as="font"[^>]*>' /tmp/wp23-prices.html | wc -l
# expect: 1 (Geist Sans latin, the only font file on first view)
grep -o 'role="radiogroup"' /tmp/wp23-prices.html | wc -l
# expect: 3 (Chart timeframe, Currency, View), server-rendered
grep -c 'data-testid="sparkline-skeleton"' /tmp/wp23-prices.html
# expect: >= 1 (cards whose history is not loaded at render show the flat bar)
# stop the server: kill <PID of perf-serve.mjs>
```

If WP22 is missing: run `pnpm build:stub` (WP00) instead, skip `perf:budget`, take the CSS and font numbers from the same commands against `.next/` (use `.next/server/app/prices.html` in place of the curl output), and state in the PR that the WP22 gate was not available.

Screenshots (after): repeat step 0b with the finished tree and move the output to `/tmp/wp23-shots-after`. Compare each pair at 390 and 1440. The only differences allowed:

1. `/prices`, `/market`, `/box-calculator`: the timeframe, currency and view toggles (8 px segment radius, no shadow on the selected segment, ink-soft labels; 44 px tall in the 390 px shots because `shoot.js` sets `hasTouch`).
2. `/prices`, `/market`: sparkline slots of unloaded cards show a flat bar instead of the grey zigzag; loaded cards with under two days show "No history".
3. `/prices` group headers, `/stats`, `/product/[id]`: set codes in Geist Sans uppercase instead of Geist Mono.
4. `/prices` search input at 390 px: 16 px text.
5. `/compare` tables (only if the page has data in the fixture): hairline rows instead of floating cards, bold sorted header.

Anything else that moved is a regression: find the token or class that changed and fix it. Attach the `/prices` before and after pairs (both widths) to the PR.

Manual checks (on the WP22 server at `http://127.0.0.1:3100`, or `pnpm build:stub && pnpm start`):

1. 1440 px, `/prices`: Tab to the Chart control: one Tab stop lands on the checked segment; Right arrow moves and selects; the cards dim briefly and the segment is blue on the next frame. Screen reader (VoiceOver or NVDA): "Chart timeframe, radio group", "3M, radio button, checked, 3 of 5".
2. 390 px with touch emulation, `/prices`, filter drawer open: each segment is at least 44 px tall; tapping CAD paints the segment immediately and prices update; focusing the search box does not zoom the page on an iOS device or simulator.
3. `/prices` in a dark-mode OS: form controls, scrollbars and the 404 page stay light (`color-scheme: light`).
4. `/box-calculator` and `/portfolio` (signed in): the currency control works as before and remembers the choice across pages (WP20).
5. `/compare` with a Shopify CSV loaded: rows are one line and 44 px; the sorted header is bold with ▲ or ▼; long titles end in an ellipsis with the full title on hover.

## Owner actions

None required: no migration, environment variable or dashboard change. Optional, 5 minutes: look at the before and after `/prices` screenshots attached to the PR and confirm the toggle and skeleton look. Accept (already decided in `01-PRODUCT-DIRECTION.md`): light-only for this track.

## Acceptance criteria

- [ ] `globals.css` defines `--pf-accent`, `--pf-action`, `--pf-action-strong`, `--pf-warn-text`, `--pf-warn-fill`, `--pf-chart-line`, `--pf-chart-bench`, `--pf-chart-grid`, `--pf-chart-volume`, `--pf-radius-control`, `--pf-radius-card`, the eight `--text-*` scale entries and `color-scheme: light`; WP14's `--pf-gain-text`/`--pf-loss-text` are unchanged; `--pf-pokeball`/`--pf-pokeblue` are aliases with unchanged values.
- [ ] `layout.tsx` loads only Geist Sans; no `font-mono`, `Geist_Mono` or `--font-geist-mono` remains under `app/`.
- [ ] `format.ts` exports `formatPercent`, `formatSignedPercent`, `FLAT_BAND_PERCENT` (0.05) and `changeDirection`, with tests.
- [ ] `app/components/ui/` contains `Delta`, `Stat`, `Badge`, `SegmentedControl`, `PageHeader`, `DataList` (with `DataListRow`), `EmptyState`, `Skeleton`, `RangeBar`, `Button`, `AsOf`, `ProvenanceLine`, `icons.tsx` and `README.md`; each component has a Jest test with an axe case, and all pass.
- [ ] Only `SegmentedControl` has `"use client"`; no `components/ui/index.ts`.
- [ ] `/prices` timeframe, currency and view toggles are `SegmentedControl` radiogroups (server-rendered, arrow keys, `onChange` in a transition, 44 px on coarse pointers); the card list dims while a toggle is pending.
- [ ] `MiniSparkline` shows a flat, non-animated bar when history is not loaded and "No history" when loaded history has fewer than two days.
- [ ] `SortableTable` renders 40 px headers, 44 px collapsed rows, a bold sorted header with a visible ▲/▼ and `aria-sort`; WP18's table tests pass unchanged.
- [ ] The four search inputs use `text-base sm:text-sm`.
- [ ] `uiConventions.test.ts` fails on `red-*` utilities outside Header/Footer, on `--pf-accent` outside Header/Footer, on `font-mono`, on new hex or `--pf-pokeball` uses beyond `uiConventions.baseline.json`, and on raw palette or hex in `components/ui/`; it passes on this tree; the baseline has no `components/ui/` entry.
- [ ] `tsc`, `lint` and the full Jest suite pass; `pnpm build:stub` succeeds.
- [ ] WP22 budgets hold (`pnpm perf:budget` exit 0), CSS is at most 14 kB gz, and `/prices` preloads exactly one font file.
- [ ] Before and after screenshots of `/prices` at 390 and 1440 px show no change beyond the five allowed differences listed in Verification.

## Rollback

`git revert <merge commit>` and redeploy. There is no migration, data or configuration change. Partial rollbacks:

- Control migration only (a toggle misbehaves in a browser): `git checkout <merge>~1 -- app/components/ProductPrices/controls app/components/ProductPrices/index.tsx app/components/ProductPrices/__tests__/controls.a11y.test.tsx` in a new commit. The components, tokens and conventions test stay.
- Font change only: restore `layout.tsx` and the `--font-mono` line from `<merge>~1`, and remove the font rule from `uiConventions.test.ts` in the same commit, otherwise the test fails on the restored call sites.
- Reverting the conventions block alone is safe; nothing else depends on it.

## Commit and PR

Branch: `remediation/wp23-design-system-foundation`.

Commit message:

```text
feat(ui): design system foundation, finance components, phone list pattern

Pages had tokens but no system: red was brand, CTA, loss and promo at
once, gains and losses relied on colour, three /prices toggles were
hand-built, the sparkline skeleton was a fake upward line, and Geist Mono
loaded on four routes for set codes.

- globals.css: semantic tokens (accent, action, warn, chart, radii, type
  scale), color-scheme light; pokeball/pokeblue kept as aliases.
- Drop Geist Mono; set codes use tabular uppercase Geist Sans.
- format.ts: formatPercent, formatSignedPercent, ±0.05% flat dead band.
- components/ui: Delta, Stat, Badge, SegmentedControl, PageHeader,
  DataList/DataListRow, EmptyState, Skeleton, RangeBar, Button, AsOf,
  ProvenanceLine, with Jest and axe-core tests and a usage README.
- /prices timeframe, currency and view toggles use SegmentedControl
  (radiogroup, arrow keys, transition, 44 px touch targets); the card
  list dims while a toggle renders.
- MiniSparkline: flat skeleton bar, "No history" when history is absent.
- SortableTable: 44 px rows, bold sorted header, visible arrow.
- Search inputs are 16 px on phones.
- uiConventions: ban red-* outside the logo and font-mono; ratchet
  --pf-pokeball and raw hex; keep components/ui token-only.
```

PR title: `feat(ui): design system foundation, finance components, phone list pattern (WP23)`

PR body: the goal in two sentences; the token table; the component list with one line each; the five allowed visual differences with the `/prices` before and after screenshots at 390 and 1440 px; `perf:budget` before and after, CSS gz before and after, font preload count; the generated `uiConventions.baseline.json` (hex and brandRed counts per file) and a note that counts may only go down; every existing test edited in step 27 and why; whether the transition test used the `react` mock or the console fallback; whether WP22, WP13 or WP19 were missing and what was done instead; "Noticed, out of scope": red CTAs, eyebrow labels and promo still use `--pf-pokeball` (page packages), the currency rate text is 11 px (below the 12 px floor; WP30), the product and stats set-code lines keep their 11 to 12 px sizes, `compareColumns.tsx` has its own `formatPercent` (later package), `CompareTabs` keeps its own style.
