# WP14: Accessibility: dialogs, labels, contrast

- **Findings covered**
  - F030 (full; cluster members F023, F030, F094): the Add, Edit and Import Holding modals are plain `<div>` overlays with no dialog role, no focus move, trap or restore, no Escape, and close (X) buttons with an empty accessible name; `ProductSearchSelect` has no combobox/listbox semantics or arrow-key support, and its clear (X) button is also unnamed. The Header items that the finder bundled here are F022 and were done in WP03.
  - F031 (full): labels are not associated with their inputs in the portfolio modals, the `/prices` filter controls, BoxCalculator and the compare page; the search inputs have only a placeholder. The `autoComplete` half of the finding belongs to F024 (WP02) and is not repeated here.
  - F095 (full; cluster members F095, F104): `text-slate-400` (2.56:1) is used for informational text, often at 10 to 11 px; gain and loss text colours fail 4.5:1; ReturnMetrics bypasses the gain/loss tokens; some icon buttons are small or named only by `title`; `ScrollToTop` puts `aria-hidden` on a focusable button; the `/stats` column definitions exist only as `title` tooltips. The "white on the blue-500 toast" item (3.68:1) is already closed: WP03 deleted that toast (baseline check 4b confirms). The MarketView "Show/Hide" button (about 26 px tall) and the CardRinkPromo dismiss button (about 28 px) are above the 24 px WCAG 2.5.8 minimum and keep their size; say so in the PR.
- **Priority rationale**: the Add/Edit/Import flow is the site's only authenticated data-entry surface and WP05 just made it work again, so it should be operable by keyboard and screen-reader users before the polish package (WP15) adds confirm dialogs that follow the same native-`<dialog>` rules and reuse this package's jsdom polyfill.
- **Effort**: M, about 9 hours (3 h Dialog and the three modals, 1.5 h ProductSearchSelect, 1.5 h labels in controls/BoxCalculator/compare, 1 h contrast pass, 2 h tests).
- **Depends on**: WP05 (hard: the modals, `PortfolioDashboard` and `useProductSearch` are edited on top of WP05's rewrite). The plan runs packages in order, so these have also landed and change where code lives: WP11 moved the compare page's client code to `app/compare/CompareDashboard.tsx` (step 11 edits that file, not `page.tsx`); WP13 moved the login form to `app/auth/login/LoginForm.tsx` and added `app/components/NotFoundPanel.tsx` (its `placeholder:text-slate-400` is covered by step 13's sed); WP09 rewrote the `ControlBar` drawer (collapsed controls are already `invisible`, so out of the tab order) and added a `disabled:text-slate-400` chart-toggle button in `ProductCard`; WP03 did the Header items and removed the `/prices` toast; WP06 changed the BoxCalculator saved-recipe markup; WP07 added `formatMoney` to `ProductSearchSelect`; WP09, WP12 and WP13 may already have removed some `text-slate-400` lines listed below.
- **Unblocks**: WP15 (its step 1 skips the jsdom `<dialog>` polyfill because step 1 here adds it; its `ConfirmDialog` is self-contained and follows the same rules, so it does not import `Dialog.tsx`; its baseline says "expect Modal.tsx" but only needs `app/components/ui/` to exist, so the name `Dialog.tsx` is correct; its ReturnMetrics step skips because step 12b here did it; F091 must treat the gain/loss text tokens as done), WP17 (removes two `react-hooks/set-state-in-effect` lint errors in the modals), WP18 (expects the compare search `aria-label`, the `sr-only` file input and `METRIC_DEFINITIONS` in `stats/page.tsx`), WP19 (expects the MarketView `--pf-gain-text`/`--pf-loss-text` and `text-slate-500` classes).
- **Suggested branch name**: `remediation/wp14-accessibility`
- **Risk level**: medium. No data, API, auth or schema change, but it changes how the three portfolio modals open, close and take focus (native `<dialog>` top layer), and it touches colour classes in about 20 files.

## Why

A keyboard user who clicks "Add Holding" on `/portfolio` today sees the form, but focus stays on the page behind it: reaching the form costs 13 + 2N Tab presses (N = holdings), Escape does nothing, Tab walks back into the dimmed page, and a screen reader never hears that a dialog opened and announces each close X as just "button". Across the portfolio forms, the `/prices` filter bar and the box calculator, labels are not tied to their fields, so fields are announced as "spin button" or "combo box" with no name and clicking a label does not focus its field. Small grey captions (the "Updated" time, set codes, units, ranks) are drawn in slate-400 at 2.6:1, and the green used for gains is 3.3 to 3.8:1, so the site's core signal fails WCAG AA. After this PR the three modals are real modal dialogs (named, focus moved in, contained, restored, Escape closes), the product picker is an APG combobox, every form control has a programmatic name, and all informational text and gain/loss text meets 4.5:1.

## Before you start

Read these files fully (line numbers are pre-WP05 HEAD `a188fea`; WP05 and others will have shifted some, so find code by the quoted anchors):

- `frontend/app/components/Portfolio/cards/AddHoldingModal.tsx` (247 lines before WP05). Overlay shell `:117-145`, labels `:149,161,173,192,206`, error `:219-223`.
- `frontend/app/components/Portfolio/cards/EditHoldingModal.tsx` (239). Populate effect `:39-48`, shell `:94-127`, labels `:153,165,184,198`.
- `frontend/app/components/Portfolio/cards/ImportHoldingsModal.tsx` (531). `handleClose` `:174-181`, shell `:192-221`, textarea `:274-280`, matched rows `:350-398`, footer `:489-526`.
- `frontend/app/components/Portfolio/shared/ProductSearchSelect.tsx` (140). Props `:7-11`, clear X `:68-76`, input `:81-88`, list `:104-132`.
- `frontend/app/components/Portfolio/PortfolioDashboard.tsx` (modal blocks at the end, as rewritten by WP05 step 15f).
- `frontend/app/components/Portfolio/cards/HoldingCard.tsx` (135). Action buttons `:83-102`, gain/loss colour `:116-122`.
- `frontend/app/components/Portfolio/hooks/useProductSearch.ts` (WP05 rewrite; returns `searchQuery, setSearchQuery, results, loading, error`).
- `frontend/app/components/ProductPrices/controls/{GenerationFilter,ProductTypeFilter,AgeFilter,CurrencySelector,ChartTimeframeButtons,SearchInput,SortControls}.tsx`.
- `frontend/app/components/BoxCalculator/BoxCalculator.tsx` (747 before WP06). Recipe name `:293-299`, saved-list delete `:364-376`, set select `:392-406`, Qty `:410-418`, pack row buttons `:461-492`, promo/retail `:500-541`, premium/discount colour `:706-712`.
- `frontend/app/compare/CompareDashboard.tsx` (WP11 moved the client code here with `git mv` from `page.tsx`; if WP11 has not landed, edit `app/compare/page.tsx` instead). Pre-WP11 lines: file input `:561-578`, search `:641-647`.
- `frontend/app/globals.css` (82 lines), tokens `:19-32`.
- `frontend/app/stats/page.tsx` (274). `STAT_TOOLTIPS` `:4-25`, `InfoIcon` `:27-39`, All Set Metrics section `:201-267`.
- `frontend/app/components/ProductPrices/shared/ScrollToTop.tsx` (58), `ReturnMetrics.tsx` `:114-129`.
- `frontend/jest.setup.ts`, `frontend/jest.config.js` (jsdom default; route tests use `/** @jest-environment node */` and still load `jest.setup.ts`).
- `frontend/node_modules/.pnpm/jsdom@26.1.0_supports-color@8.1.1/node_modules/jsdom/lib/jsdom/living/nodes/HTMLDialogElement-impl.js`: jsdom has `HTMLDialogElement` with a reflected `open` attribute but NO `showModal`, `show` or `close`, and its UA stylesheet hides `dialog:not([open])`. The test polyfill in step 1 is required, otherwise every `getByRole` inside a dialog fails.

Confirm the starting state (run from `frontend/`):

```bash
# 1. WP05 has landed. Expect: the file exists, and no portfolioId props remain.
test -f app/lib/portfolioApi.ts && echo "WP05 ok"
grep -n "portfolioId" app/components/Portfolio/cards/AddHoldingModal.tsx app/components/Portfolio/cards/ImportHoldingsModal.tsx
# If the first line prints nothing or the grep prints hits, WP05 is missing: stop and report.

# 2. The dialog bug. Expect no output.
grep -rnE 'role="dialog"|aria-modal|<dialog|showModal' app --include=*.tsx
# Expect 3 hits, one per modal.
grep -rn "fixed inset-0 z-50" app/components/Portfolio/cards

# 3. Unassociated labels. Expect 25 lines (AddHoldingModal 5, EditHoldingModal 4, controls 5,
#    BoxCalculator 3, multi-line labels whose htmlFor is on the next line: auth/forgot-password 1,
#    auth/login/LoginForm.tsx 2, account 3; compare/CompareDashboard.tsx 2, labels that wrap their input).
grep -rnP '<label(?![^>]*htmlFor)' app --include=*.tsx | grep -v __tests__

# 3b. Earlier packages moved these files. Expect both paths to exist.
ls app/compare/CompareDashboard.tsx app/auth/login/LoginForm.tsx

# 4. Contrast. Expect about 49 tsx lines, plus WP09's disabled:text-slate-400 and WP13's
#    NotFoundPanel placeholder, minus any "Loading..." text WP09 removed.
grep -rn "slate-400" app --include=*.tsx | grep -v __tests__ | wc -l
# Expect 2 hits (ReturnMetrics.tsx, the green/red text).
grep -rnE "text-(green|red)-600" app --include=*.tsx | grep -v __tests__

# 4b. The F095 blue-500 toast is gone (WP03). Expect no output. If it prints a line,
#     WP03 is missing: stop and report.
grep -rn "bg-blue-500 text-white" app --include=*.tsx

# 5. Nothing exists yet. Expect "No such file or directory" and no output.
ls app/components/ui 2>&1
grep -n "HTMLDialogElement" jest.setup.ts

# 6. Lint baseline. Use this exact file list here and again in Verification, and
#    record the final "N problems (E errors, W warnings)" line in the PR. The
#    absolute number depends on what WP04 to WP13 fixed; what matters is the delta.
LINT_FILES="app/components/Portfolio app/components/ProductPrices \
  app/components/BoxCalculator/BoxCalculator.tsx app/components/MarketView/MarketView.tsx \
  app/components/CardRinkPromo.tsx app/components/charts app/stats/page.tsx app/compare \
  app/page.tsx app/product app/account/page.tsx app/auth"
pnpm exec eslint $LINT_FILES 2>&1 | tail -n 3
# Also record the error count per file. After WP05 AddHoldingModal.tsx (pre-fill effect)
# and EditHoldingModal.tsx (populate effect) each show exactly 1 (react-hooks/set-state-in-effect).
pnpm exec eslint $LINT_FILES -f json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const f of JSON.parse(s))if(f.errorCount)console.log(f.errorCount,f.filePath.replace(process.cwd()+"/",""))})'
```

Assumptions to check:

- WP07 landed: `ProductSearchSelect.tsx` imports `formatMoney` from `../../../lib/format` and renders `formatMoney(..., "USD", { missing: "N/A" })`. If it did not, keep the price expressions exactly as you find them in step 4; nothing else depends on WP07.
- WP03 landed: `Header.tsx` already has `aria-expanded`, Escape handling and a focus ring. Do not touch `Header.tsx` in this PR either way. `Header.tsx` also keeps its logo `role="img"`; that one is correct.
- WP05's `AddHoldingModal` is mounted only while open (`{portfolio && isAddModalOpen && (<AddHoldingModal isOpen ... />)}`) and `ImportHoldingsModal` is always mounted with `isOpen={isImportModalOpen}`. If WP05 wired them differently, keep its wiring for Add and Import; only the Edit block changes (step 6b).
- F103 (native `window.confirm`/`alert` in `PortfolioDashboard`, `account/page.tsx`, `BoxCalculator`) is WP15. WP05's PR text says "WP14 replaces them"; the plan owner reassigned that to WP15. Leave every `confirm`/`alert` as it is.

## Implementation steps

Order: step 1 (test polyfill) before anything that renders a `<dialog>` in tests; step 3 (Dialog) before steps 5 to 7; step 4 before step 5. Steps 8 to 15 are independent of each other.

### Step 1. `frontend/jest.setup.ts`: minimal `<dialog>` polyfill for jsdom

Append at the end of the file:

```ts
// jsdom 26 ships HTMLDialogElement (with a reflected `open` attribute and a
// UA rule hiding dialog:not([open])) but no showModal/show/close. These
// stand-ins toggle `open` and fire "close" like a browser does, so dialog
// content is visible to Testing Library queries. Top layer, inertness of the
// page behind and browser focusing steps are NOT emulated: Dialog moves focus
// itself, and trap behaviour is checked manually in a browser.
// Guarded because route tests run this file under the node environment.
if (typeof HTMLDialogElement !== "undefined") {
  const proto = HTMLDialogElement.prototype;
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.show !== "function") {
    proto.show = function show(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function close(this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
}
```

Use `typeof ... !== "function"`, not `if (!proto.showModal)`: TypeScript flags the latter (TS2774, function always defined). `jest.setup.ts` is excluded from ESLint but is type-checked by `tsc`.

### Step 2. `frontend/app/globals.css`: text tokens for gain/loss, muted comment, scroll lock

2a. Line 26, replace the comment on `--pf-muted` so nobody routes information through it again (it IS slate-400):

```css
  --pf-muted: #94a3b8;           /* decorative only: "--" placeholders, disabled states, icons beside a text label. 2.6:1 on white: never for information */
```

2b. Directly below line 29 (`--pf-gain: #059669;` with its `emerald-600` comment) insert:

```css
  --pf-gain-text: #047857;       /* emerald-700: gain TEXT. 5.48:1 on white, 5.24:1 on slate-50 */
```

and directly below line 31 (`--pf-loss: #e11d48;` with its `rose-600` comment) insert:

```css
  --pf-loss-text: #be123c;       /* rose-700: loss TEXT. 6.29:1 on white, 6.01:1 on slate-50 */
```

Then append one line to the existing comment block above them (after the line-28 comment, before `--pf-gain`):

```css
  /* --pf-gain/--pf-loss are for fills, strokes and borders: #059669 is 3.77:1 on white and fails AA as text. All gain/loss TEXT uses the -text variants. */
```

Measured ratios (WCAG relative luminance, computed with the standard formula): slate-400 #94a3b8 2.56 (white) / 2.45 (slate-50); slate-500 #64748b 4.76 / 4.55; slate-600 #475569 7.58 / 7.24; emerald-600 #059669 3.77 / 3.60; green-600 #16a34a 3.30; emerald-700 #047857 5.48 / 5.24; rose-600 #e11d48 4.70 / 4.49 (fails on slate-50); rose-700 #be123c 6.29 / 6.01; rose-500 #f43f5e 3.67; red-600 #dc2626 4.83 / 4.62.

2c. Append at the end of the file (background scroll lock while a modal dialog is open; pure CSS, no JS):

```css
/* A modal <dialog> makes the page inert but does not stop it scrolling
   under the backdrop. Lock the root scroller while any dialog is open. */
html:has(dialog[open]) {
  overflow: hidden;
}
```

Use `dialog[open]`, not `dialog:modal`: an attribute selector has no parser risk in Lightning CSS, and this app never opens a non-modal dialog.

### Step 3. `frontend/app/components/ui/Dialog.tsx` (new): the one reusable modal

Create the directory `frontend/app/components/ui/` and this file:

```tsx
"use client";

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";

type DialogSize = "md" | "lg";

// One class per size: passing a second max-w-* through className would make
// the winner depend on CSS order, not on class order.
const SIZE_CLASS: Record<DialogSize, string> = {
  md: "max-w-lg",
  lg: "max-w-3xl",
};

export interface DialogProps {
  /** Opens with showModal() when true, closes when false. */
  open: boolean;
  /**
   * Called for every close request: Escape, the X button, a backdrop click,
   * the browser's own cancel/close. Must be idempotent (it can be called twice
   * for one Escape in some browsers) and should set `open` to false or unmount.
   */
  onClose: () => void;
  /** Visible heading; also the dialog's accessible name. */
  title: ReactNode;
  children: ReactNode;
  /** Optional action bar pinned below the scrolling body. */
  footer?: ReactNode;
  /** Element to focus after opening. Defaults to the close button. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** id of an element inside children that describes the dialog. */
  descriptionId?: string;
  size?: DialogSize;
  closeLabel?: string;
}

/**
 * Modal dialog on the native <dialog> element. showModal() puts it in the top
 * layer and makes the rest of the page inert (focus containment and no
 * reachable background controls, WCAG 2.4.3 / 4.1.2). This component adds
 * what the element does not do consistently: explicit initial focus, focus
 * restore on close and on unmount, Escape handled as a keydown so a child
 * (the product combobox) can claim it first, and backdrop click to close.
 */
export default function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  initialFocusRef,
  descriptionId,
  size = "md",
  closeLabel = "Close",
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Set when WE call close() because `open` went false or we unmounted, so the
  // resulting native "close" event is not reported back to the parent.
  const closingFromPropRef = useRef(false);
  // A click whose press started inside the panel (for example a text
  // selection drag) and ended on the backdrop must not close the dialog.
  const pressStartedOnBackdropRef = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    // Explicit focus: React's autoFocus runs at commit, before this effect,
    // while the dialog is still closed, so it would be a no-op.
    (initialFocusRef?.current ?? closeButtonRef.current)?.focus();

    return () => {
      if (dialog.open) {
        closingFromPropRef.current = true;
        dialog.close();
      }
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open, initialFocusRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    // A child (the combobox closing its listbox) already used this Escape.
    if (event.isDefaultPrevented()) return;
    // preventDefault also stops the browser from turning this key press into
    // a "cancel" close request, so the parent's state stays the one source.
    event.preventDefault();
    onClose();
  };

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    // Close requests that are not an Escape keydown (Android back gesture).
    event.preventDefault();
    onClose();
  };

  const handleNativeClose = () => {
    if (closingFromPropRef.current) {
      closingFromPropRef.current = false;
      return;
    }
    // The browser closed the dialog on its own (a close request it did not
    // let us cancel). Tell the parent so its state matches the DOM.
    onClose();
  };

  const handlePointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    // The dialog has no padding and the panel fills it, so the dialog element
    // itself is only ever the target when the ::backdrop was pressed.
    pressStartedOnBackdropRef.current = event.target === event.currentTarget;
  };

  const handleClick = (event: MouseEvent<HTMLDialogElement>) => {
    const startedOnBackdrop = pressStartedOnBackdropRef.current;
    pressStartedOnBackdropRef.current = false;
    if (startedOnBackdrop && event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-modal="true"
      onKeyDown={handleKeyDown}
      onCancel={handleCancel}
      onClose={handleNativeClose}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className={`m-auto w-[calc(100%-2rem)] ${SIZE_CLASS[size]} max-h-[calc(100dvh-2rem)] overflow-hidden rounded-lg bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/50`}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 p-4">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="-m-1.5 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-pokeblue)]"
          >
            <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-3 border-t border-slate-200 p-4">{footer}</div>
        ) : null}
      </div>
    </dialog>
  );
}
```

Why each class matters: Tailwind 4 preflight sets `margin: 0` on every element, which cancels the UA `margin: auto` that centres a modal dialog, so `m-auto` is mandatory; it also beats `space-y-*` on a parent (`:where()` selector, specificity 0), which would otherwise push the dialog to the bottom edge. `p-0` keeps the backdrop-click test exact. `overflow-hidden` plus the inner flex column keeps the header and footer fixed and scrolls only the body. The close button is 32 x 32 px (20 px icon + `p-1.5`), above the 24 px WCAG 2.5.8 minimum; `-m-1.5` keeps the header height unchanged. `aria-modal="true"` is redundant for a `showModal()` dialog in current browsers but harmless and helps older VoiceOver.

### Step 4. `frontend/app/components/Portfolio/shared/ProductSearchSelect.tsx`: APG combobox (rewrite)

Replace the whole file. The only lines carried over from WP07 are the two `formatMoney(..., { missing: "N/A" })` expressions; if WP07 has not landed, keep whatever price expressions the file has.

```tsx
"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useProductSearch } from "../hooks";
import { formatMoney } from "../../../lib/format";
import type { ProductSearchResult } from "../types";

interface ProductSearchSelectProps {
  onSelect: (product: ProductSearchResult | null) => void;
  selectedProduct: ProductSearchResult | null;
  placeholder?: string;
  /** id for the text input, so the parent's <label htmlFor> names it. */
  inputId?: string;
  /** id of the parent's visible label; names the selected-product group. */
  labelId?: string;
  /** Lets the parent dialog put initial focus on the input. */
  inputRef?: RefObject<HTMLInputElement | null>;
}

type PendingFocus = "input" | "clear" | null;

function getProductDisplayName(product: ProductSearchResult) {
  const setName = product.sets?.name || "Unknown Set";
  const productType = product.product_types?.label || product.product_types?.name || "";
  const variant = product.variant ? ` (${product.variant})` : "";
  return `${setName} - ${productType}${variant}`;
}

/**
 * Editable combobox with a listbox popup (WAI-ARIA APG "combobox with list
 * autocomplete"). DOM focus stays on the input; the highlighted option is
 * exposed with aria-activedescendant. ArrowDown/ArrowUp move (wrapping),
 * Enter picks, Escape closes the popup first, then clears the text, and only
 * then lets the dialog close.
 */
export default function ProductSearchSelect({
  onSelect,
  selectedProduct,
  placeholder = "Search for a product...",
  inputId,
  labelId,
  inputRef,
}: ProductSearchSelectProps) {
  const { searchQuery, setSearchQuery, results, loading } = useProductSearch();
  const [isOpen, setIsOpen] = useState(false);
  // The highlight remembers which query it belongs to, so new results for a
  // new query start unhighlighted without a setState-in-effect reset.
  const [active, setActive] = useState<{ query: string; index: number }>({ query: "", index: -1 });
  const containerRef = useRef<HTMLDivElement>(null);
  const ownInputRef = useRef<HTMLInputElement>(null);
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef<PendingFocus>(null);
  const textInputRef = inputRef ?? ownInputRef;
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (productId: number) => `${baseId}-option-${productId}`;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const displayProducts = searchQuery.length >= 2 ? results : [];
  const listboxOpen = isOpen && !loading && displayProducts.length > 0;
  const activeIndex =
    listboxOpen && active.query === searchQuery && active.index < displayProducts.length
      ? active.index
      : -1;
  const activeProduct = activeIndex >= 0 ? displayProducts[activeIndex] : null;
  const activeOptionId = activeProduct ? optionId(activeProduct.id) : undefined;

  // Selecting swaps the input for the selected-product card and clearing
  // swaps it back; either way the focused element unmounts. Put focus on the
  // control that replaced it instead of letting it fall to <body>.
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (target === null) return;
    pendingFocusRef.current = null;
    if (target === "clear") clearButtonRef.current?.focus();
    else textInputRef.current?.focus();
  }, [selectedProduct, textInputRef]);

  // Keep the highlighted option visible in the scrolling popup.
  useEffect(() => {
    if (!activeOptionId) return;
    // scrollIntoView is missing in jsdom, hence the optional call.
    document.getElementById(activeOptionId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeOptionId]);

  const handleSelect = (product: ProductSearchResult) => {
    pendingFocusRef.current = "clear";
    onSelect(product);
    setSearchQuery("");
    setIsOpen(false);
    setActive({ query: "", index: -1 });
  };

  const handleClear = () => {
    pendingFocusRef.current = "input";
    onSelect(null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        setIsOpen(true);
        const count = displayProducts.length;
        if (loading || count === 0) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        const from = activeIndex === -1 ? (step === 1 ? -1 : count) : activeIndex;
        setActive({ query: searchQuery, index: (from + step + count) % count });
        return;
      }
      case "Enter":
        // With the popup closed, Enter keeps its normal meaning (submit).
        if (!listboxOpen) return;
        event.preventDefault();
        if (activeProduct) handleSelect(activeProduct);
        return;
      case "Escape":
        if (isOpen) {
          event.preventDefault(); // the Dialog sees this and stays open
          setIsOpen(false);
        } else if (searchQuery) {
          event.preventDefault();
          setSearchQuery("");
        }
        return;
      case "Tab":
        setIsOpen(false);
        return;
    }
  };

  const statusMessage =
    !isOpen || searchQuery.length < 2
      ? ""
      : loading
        ? "Searching..."
        : displayProducts.length === 0
          ? "No products found"
          : `${displayProducts.length} product${displayProducts.length === 1 ? "" : "s"} found. Use the up and down arrow keys to choose one.`;

  return (
    <div className="relative" ref={containerRef}>
      {selectedProduct ? (
        <div
          role="group"
          aria-labelledby={labelId}
          className="flex items-center gap-3 p-3 border border-slate-300 rounded-lg bg-slate-50"
        >
          {selectedProduct.image_url && (
            <img src={selectedProduct.image_url} alt="" className="w-12 h-12 object-cover rounded" />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-slate-900 truncate">
              {getProductDisplayName(selectedProduct)}
            </p>
            <p className="text-sm text-slate-600">
              Current: {formatMoney(selectedProduct.usd_price, "USD", { missing: "N/A" })}
            </p>
          </div>
          <button
            ref={clearButtonRef}
            type="button"
            onClick={handleClear}
            aria-label={`Clear selected product: ${getProductDisplayName(selectedProduct)}`}
            className="-m-1.5 rounded-md p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-pokeblue)]"
          >
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <>
          <input
            ref={textInputRef}
            id={inputId}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={listboxOpen}
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            autoComplete="off"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setIsOpen(true);
            }}
            onClick={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-transparent bg-white text-slate-900 placeholder:text-slate-500"
          />

          {isOpen && (
            <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
              {loading ? (
                <div className="p-4 text-center text-slate-500">
                  <div aria-hidden="true" className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
                </div>
              ) : displayProducts.length === 0 ? (
                <div className="p-4 text-center text-slate-500">
                  {searchQuery.length >= 2 ? "No products found" : "Type at least 2 characters to search."}
                </div>
              ) : (
                <ul id={listboxId} role="listbox" aria-label="Matching products">
                  {displayProducts.map((product, index) => {
                    const highlighted = index === activeIndex;
                    return (
                      <li
                        key={product.id}
                        id={optionId(product.id)}
                        role="option"
                        aria-selected={highlighted}
                        // Keep DOM focus on the input while clicking an option.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSelect(product)}
                        className={`flex w-full cursor-pointer items-center gap-3 p-3 text-left ${
                          highlighted ? "bg-slate-100" : "hover:bg-slate-100"
                        }`}
                      >
                        {product.image_url ? (
                          <img src={product.image_url} alt="" className="w-10 h-10 object-cover rounded flex-shrink-0" />
                        ) : (
                          <div className="w-10 h-10 bg-slate-200 rounded flex-shrink-0"></div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-900 truncate">{getProductDisplayName(product)}</p>
                          <p className="text-sm text-slate-600">
                            {formatMoney(product.usd_price, "USD", { missing: "N/A" })}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {statusMessage}
      </div>
    </div>
  );
}
```

The option price is `text-slate-600`, not the old `text-slate-500`: the highlighted option has `bg-slate-100`, where slate-500 is 4.34:1 and fails; slate-600 is 6.92:1. The popup is absolutely positioned inside the Dialog's scrolling body, so a long result list extends that body's scroll area instead of spilling over the dialog edge; manual check 4 covers it.

Behaviour changes to accept and mention in the PR: the popup no longer opens on focus (only on typing, click or ArrowDown), so the dialog's initial focus on this input does not pop a hint and the first Escape closes the dialog; results are no longer `<button>`s reached by Tab but options reached by the arrow keys, which is the APG pattern (options inside a listbox must not contain buttons). `aria-controls` is always present because aria-query (used by jsx-a11y `role-has-required-aria-props`) lists it as required on `combobox`.

### Step 5. `frontend/app/components/Portfolio/cards/AddHoldingModal.tsx`

5a. Imports. Change the React import (WP05 left `useState, useEffect, useRef`) to:

```tsx
import { useId, useRef, useState } from "react";
```

and add below the `ProductSearchSelect` import:

```tsx
import Dialog from "../../ui/Dialog";
```

5b. Below the `attemptRef` declaration (WP05 step 16e), add:

```tsx
  const fieldId = useId();
  const productInputId = `${fieldId}-product`;
  const productLabelId = `${fieldId}-product-label`;
  const quantityId = `${fieldId}-quantity`;
  const priceId = `${fieldId}-price`;
  const dateId = `${fieldId}-date`;
  const notesId = `${fieldId}-notes`;
  const productInputRef = useRef<HTMLInputElement>(null);
```

5c. Replace the pre-fill effect (the `useEffect` that starts `if (!selectedProduct) return;` and calls `hasCurrentPrice(selectedProduct)`, including its comment block) with an event handler. Keep the comment text, it still explains the else branch:

```tsx
  // Pre-fill purchase price when a product is selected.
  //
  // The else branch matters: the freshness guard nulls the price of a product
  // it cannot value, and without clearing, switching from a priced product to
  // an unpriced one leaves the FIRST product's price in the field, which then
  // saves as the new holding's cost basis. A wrong number written to the
  // portfolio is worse than an empty field the user has to fill in.
  // Done in the selection handler rather than an effect, so no state is set
  // during an effect (react-hooks/set-state-in-effect).
  const handleProductSelect = (product: ProductSearchResult | null) => {
    setSelectedProduct(product);
    if (!product) return; // clearing the product keeps the typed price, as before
    setPurchasePrice(hasCurrentPrice(product) ? (product.usd_price as number).toFixed(2) : "");
  };
```

5d. Leave `handleSubmit` exactly as WP05/WP07 left it.

5e. Replace everything from `if (!isOpen) return null;` to the end of the component with:

```tsx
  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onClose={onClose} title="Add Holding" initialFocusRef={productInputRef}>
      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {/* Product Selection */}
        <div>
          <label id={productLabelId} htmlFor={productInputId} className="block text-sm font-medium text-slate-700 mb-1">
            Product
          </label>
          <ProductSearchSelect
            onSelect={handleProductSelect}
            selectedProduct={selectedProduct}
            inputId={productInputId}
            labelId={productLabelId}
            inputRef={productInputRef}
          />
        </div>

        {/* Quantity and Price Row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor={quantityId} className="block text-sm font-medium text-slate-700 mb-1">
              Quantity
            </label>
            <input
              id={quantityId}
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-transparent bg-white text-slate-900"
            />
          </div>
          <div>
            <label htmlFor={priceId} className="block text-sm font-medium text-slate-700 mb-1">
              Purchase Price (USD)
            </label>
            <div className="relative">
              <span aria-hidden="true" className="absolute left-3 top-2.5 text-slate-500">$</span>
              <input
                id={priceId}
                type="number"
                step="0.01"
                min="0"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                className="w-full pl-7 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-transparent bg-white text-slate-900"
              />
            </div>
          </div>
        </div>

        {/* Purchase Date */}
        <div>
          <label htmlFor={dateId} className="block text-sm font-medium text-slate-700 mb-1">
            Purchase Date
          </label>
          <input
            id={dateId}
            type="date"
            value={purchaseDate}
            max={maxPurchaseDateKey()}
            onChange={(e) => setPurchaseDate(e.target.value)}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-transparent bg-white text-slate-900"
          />
        </div>

        {/* Notes */}
        <div>
          <label htmlFor={notesId} className="block text-sm font-medium text-slate-700 mb-1">
            Notes (optional)
          </label>
          <textarea
            id={notesId}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-transparent bg-white text-slate-900 resize-none placeholder:text-slate-500"
            placeholder="e.g., Purchased from local game store"
          ></textarea>
        </div>

        {/* Error */}
        {error && (
          <div role="alert" className="text-rose-600 text-sm">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? "Adding..." : "Add Holding"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
```

If WP05 used a different `max` expression for the date input, keep WP05's expression. Keep every label's `htmlFor` on the same line as `<label` or the next line exactly as shown (the Verification grep reads both). `text-rose-600` on white is 4.70:1 and stays.

### Step 6. `EditHoldingModal.tsx` and `PortfolioDashboard.tsx`

6a. `frontend/app/components/Portfolio/cards/EditHoldingModal.tsx`:

- React import becomes `import { useId, useRef, useState } from "react";` and add `import Dialog from "../../ui/Dialog";`.
- Props: `holding: HoldingWithProduct;` (non-null; the dashboard now mounts the modal only with a holding, step 6b). Keep `isOpen`, `onClose`, `onSuccess` as WP05 left them.
- Replace the four empty `useState("")` field states and the populate effect ("Populate form when holding changes", lines 39-48 before WP05) with initialisers. Keep the `loading` and `error` states:

```tsx
  // Mounted fresh (keyed by holding id) for every edit, so state is seeded
  // once from the holding instead of copied in by an effect.
  const [quantity, setQuantity] = useState(() => holding.quantity.toString());
  const [purchasePrice, setPurchasePrice] = useState(() => holding.purchase_price_usd.toFixed(2));
  const [purchaseDate, setPurchaseDate] = useState(() => holding.purchase_date);
  const [notes, setNotes] = useState(() => holding.notes || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const quantityId = `${fieldId}-quantity`;
  const priceId = `${fieldId}-price`;
  const dateId = `${fieldId}-date`;
  const notesId = `${fieldId}-notes`;
  const quantityRef = useRef<HTMLInputElement>(null);
```

- In `handleSubmit` delete the line `if (!holding) return;` (the prop is non-null now). Leave the rest of `handleSubmit` unchanged.
- Replace `if (!isOpen || !holding) return null;` with `if (!isOpen) return null;`.
- Replace the returned JSX (the outer `<div className="fixed inset-0 z-50 overflow-y-auto">` through its closing `</div>`) with the same structure as step 5e: `<Dialog open={isOpen} onClose={onClose} title="Edit Holding" initialFocusRef={quantityRef}>` wrapping the existing `<form onSubmit={handleSubmit} className="p-4 space-y-4">`. Inside the form keep the read-only product block (lines 129-148) unchanged, then apply to Quantity, Purchase Price, Purchase Date and Notes exactly the `htmlFor`/`id` pairs, `aria-hidden` on the `$` span, `placeholder:text-slate-500` on the textarea and `role="alert"` on the error div shown in step 5e. Add `ref={quantityRef}` to the Quantity input. Keep WP05's `max={editMaxDate(holding.purchase_date)}` on the date input and the footer buttons ("Cancel", "Saving..." / "Save Changes") unchanged.

6b. `frontend/app/components/Portfolio/PortfolioDashboard.tsx`: replace the Edit Modal block (WP05 step 15f) with:

```tsx
      {/* Edit Modal: mounted per edit and keyed by holding, so the form is
          seeded from the holding on mount (no populate effect). */}
      {editingHolding && (
        <EditHoldingModal
          key={editingHolding.id}
          holding={editingHolding}
          isOpen
          onClose={() => setEditingHolding(null)}
          onSuccess={applyHoldingSaved}
        />
      )}
```

Use whatever `onSuccess` handler WP05 wired (`applyHoldingSaved` in the WP05 spec). Also in the `if (error)` block change `<p className="text-rose-600 mb-4">{error}</p>` to `text-rose-700` (the page background is slate-50, where rose-600 is 4.49:1). Do not touch `handleDelete`, `window.confirm` or `alert` (WP15).

### Step 7. `frontend/app/components/Portfolio/cards/ImportHoldingsModal.tsx`

7a. React import: `import { useState, useRef, useId, useEffect } from "react";` and add `import Dialog from "../../ui/Dialog";`.

7b. Below `const fileInputRef = useRef<HTMLInputElement>(null);` add:

```tsx
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const pasteId = `${baseId}-paste`;
  // Bumped on every close. An import or parse that finishes after the user
  // closed the dialog (Escape is now one key away) must not write its result
  // into the next session's wizard.
  const sessionRef = useRef(0);

  // Each step change unmounts the button that had focus (upload, Process
  // CSV, Import, Back). Move focus to the step body so keyboard and screen
  // reader users continue from the new content. prevStepRef skips the first
  // run and React StrictMode's second effect run.
  const prevStepRef = useRef(step);
  useEffect(() => {
    if (prevStepRef.current === step) return;
    prevStepRef.current = step;
    bodyRef.current?.focus();
  }, [step]);
```

7c. `processCSV`: first line of the function body add `const session = sessionRef.current;`, and directly after `const results = await processCollectrImport(content);` add `if (sessionRef.current !== session) return;`. In the `catch` add the same guard as its first line.

7d. `handleImport`: after `setLoading(true);` add `const session = sessionRef.current;`. Directly after `const results = await importHoldings(toImport);` add:

```tsx
      if (sessionRef.current !== session) {
        // Closed mid-import: rows may have been saved, so refresh the dashboard.
        onSuccess();
        return;
      }
```

and as the first line of its `catch` add `if (sessionRef.current !== session) return;`.

7e. `handleClose`: add `sessionRef.current += 1;` as its first line, and add `setLoading(false);` next to the existing `setError(null);`. The `setLoading(false)` is required: the guards in 7c and 7d return before the function's own `setLoading(false)`, and the dashboard keeps this component mounted between opens (WP05 step 15f), so without the reset a dialog closed mid-parse or mid-import reopens with "Processing..." on a disabled upload button forever. The resulting function:

```tsx
  const handleClose = () => {
    sessionRef.current += 1;
    setCsvContent("");
    setMatchResults([]);
    setSelectedMatches(new Set());
    setStep("upload");
    setError(null);
    setLoading(false);
    onClose();
  };
```

Pass `handleClose` (not `onClose`) to the Dialog, so Escape, the X and a backdrop click all reset the wizard exactly like the old backdrop did.

7f. Replace the outer shell. Everything from `if (!isOpen) return null;` to the end of the component becomes the structure below; the four step blocks (`{step === "upload" && (...)}`, `preview`, `importing`, `complete`) move inside unchanged except for the edits in 7g:

```tsx
  if (!isOpen) return null;

  const footer = (
    <>
      {step === "upload" && (
        <button
          type="button"
          onClick={handleClose}
          className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        >
          Cancel
        </button>
      )}
      {step === "preview" && (
        <>
          <button
            type="button"
            onClick={() => setStep("upload")}
            className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={selectedMatches.size === 0}
            className="px-4 py-2 bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            Import {selectedMatches.size} Items
          </button>
        </>
      )}
      {step === "complete" && (
        <button
          type="button"
          onClick={handleComplete}
          className="px-4 py-2 bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white font-medium rounded-lg transition-colors"
        >
          Done
        </button>
      )}
    </>
  );

  return (
    <Dialog
      open={isOpen}
      onClose={handleClose}
      title="Import from Collectr"
      size="lg"
      initialFocusRef={uploadButtonRef}
      footer={footer}
    >
      <div ref={bodyRef} tabIndex={-1} className="p-4 focus:outline-none">
        {/* the four step blocks, unchanged except 7g */}
      </div>
    </Dialog>
  );
}
```

Paste the four step blocks where the placeholder comment is and delete the comment. The old footer `<div className="flex justify-end gap-3 p-4 border-t border-slate-200">` and its three step conditionals are replaced by the `footer` constant above (same buttons, now with `type="button"`); delete the old one.

7g. Edits inside the step blocks:

- Upload button (`onClick={() => fileInputRef.current?.click()}`): add `ref={uploadButtonRef}` and `type="button"`.
- Paste textarea: add `id={pasteId}` and `placeholder:text-slate-500` to its className, and directly above it (inside the same `<div>`) add `<label htmlFor={pasteId} className="sr-only">Collectr CSV content</label>`. Add `type="button"` to the "Process CSV" button.
- Both error blocks (`<div className="text-rose-600 text-sm bg-rose-50 p-3 rounded-lg">`): add `role="alert"` and change `text-rose-600` to `text-rose-700` (rose-600 on rose-50 is 4.28:1).
- Summary tiles: every `text-emerald-600` becomes `text-emerald-700` (4 places: Matched count and label, Imported count and label; emerald-600 on emerald-50 is 3.58:1) and the Errors tile's two `text-rose-600` become `text-rose-700`.
- Select All / Deselect All buttons: add `type="button"`.
- Matched rows: the checkbox has no name today. On the `<p className="font-medium text-slate-900 text-sm truncate">` that prints the set and product type, add `id={`${baseId}-match-${idx}`}`, and on the checkbox add `aria-labelledby={`${baseId}-match-${idx}`}`. Keep the row's `onClick` (mouse convenience; both handlers compute from the same render's `selectedMatches`, so a click on the checkbox still toggles once).
- Unmatched "Reason:" line: `text-xs text-slate-400` becomes `text-xs text-slate-600` (it sits on `bg-slate-50`). The two decorative SVGs with `text-slate-400` stay.
- The `importing` spinner div: add `aria-hidden="true"`; the "Importing holdings..." text stays as the visible and announced status.

### Step 8. `frontend/app/components/Portfolio/cards/HoldingCard.tsx`

8a. Below `const variant = ...` add:

```tsx
  const holdingName = `${setName}${productType ? ` ${productType}` : ""}${variant}`;
```

8b. Replace the actions block (`<div className="flex flex-col gap-1">` with the Edit and Delete buttons) with:

```tsx
        {/* Actions: 32 px targets, 8 px apart, so Delete is hard to hit by
            accident; named for screen readers (title alone is not shown on
            touch or keyboard focus). */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onEdit(holding)}
            className="rounded p-2 text-slate-500 hover:bg-blue-50 hover:text-[var(--pf-pokeblue)]"
            title="Edit"
            aria-label={`Edit ${holdingName}`}
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onDelete(holding.id)}
            className="rounded p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
            title="Delete"
            aria-label={`Delete ${holdingName}`}
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
```

Keep `title="Edit"`/`title="Delete"`: `HoldingCard.test.tsx` finds the buttons with `getByTitle`. The names start with "Edit "/"Delete " and never contain "Name", "Value" or "Date", so the `HoldingsTable.test.tsx` sort-button queries (`/Name/`, `/Value/`, `/Date/`) still match exactly one button.

8c. Gain/loss colour (`: isPositive ? "text-emerald-600" : "text-rose-600"` in the Performance Bar, on `bg-slate-50`): change to `"text-[var(--pf-gain-text)]"` and `"text-[var(--pf-loss-text)]"`.

### Step 9. `/prices` controls: names for every control (`frontend/app/components/ProductPrices/controls/`)

9a. `GenerationFilter.tsx`, `ProductTypeFilter.tsx`, `AgeFilter.tsx` (same change in each). Add `import { useId } from "react";` at the top, `const selectId = useId();` as the first line of the component, `htmlFor={selectId}` on the `<label>` and `id={selectId}` on the `<select>`. Example for GenerationFilter:

```tsx
import { useId } from "react";
// ...
  const selectId = useId();
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2 w-full sm:w-auto">
      <label htmlFor={selectId} className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Generation
      </label>
      <select
        id={selectId}
        value={selectedGeneration}
        // ...rest unchanged
```

9b. `CurrencySelector.tsx`: `import { useId } from "react";`, `const labelId = useId();`; the `<label>` becomes `<span id={labelId} className="text-xs font-semibold uppercase tracking-wide text-slate-500">Currency</span>` (a `<label>` must point at one labelable control, and this is a button group); the button container `<div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">` gets `role="group" aria-labelledby={labelId}`. The rate text `text-[11px] ... text-slate-500` is on white (4.76:1) and stays.

9c. `ChartTimeframeButtons.tsx`: the radiogroup is already named `aria-label="Chart timeframe"` (verifier correction). Replace only the orphan `<label className="...">Chart</label>` with `<span aria-hidden="true" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Chart</span>` so the visible word stays and is not read twice. No other change.

9d. `SortControls.tsx`: `import { useId } from "react";`, `const baseId = useId();`. Give the "Sort by" span `id={`${baseId}-sort`}` and its button container `role="group" aria-labelledby={`${baseId}-sort`}`; same for "View" with `${baseId}-view`.

9e. `SearchInput.tsx`: add an optional prop `ariaLabel?: string` (default `"Search products"`), render `aria-label={ariaLabel}` on the `<input>`, and change `placeholder:text-slate-400` to `placeholder:text-slate-500`. The magnifier SVG (`aria-hidden`, decorative) keeps `text-slate-400`.

### Step 10. `frontend/app/components/BoxCalculator/BoxCalculator.tsx`: labels, names, colours

Find each spot by its anchor; WP06 may have moved lines.

- Add `useId` to the existing `react` import (after WP06 it is `useState, useEffect, useMemo, useCallback, useRef`).
- Directly after `const [showSavedRecipes, setShowSavedRecipes] = useState(false);` add `const fieldId = useId();`. It must stay above the `if (pricesLoading) {` early return (hooks rule).
- Recipe name input (`placeholder="Recipe name..."`): add `aria-label="Recipe name"`.
- Saved-list delete button (`title="Delete recipe"`): add `aria-label={`Delete recipe ${r.name}`}`, change `text-gray-400` to `text-gray-500` (icon contrast 2.54 to 4.83:1, WCAG 1.4.11) and `p-1` to `p-1.5 rounded`, add `aria-hidden="true"` to its `<svg>`.
- Set select (`<option value="">Select a set...</option>`): add `id={`${fieldId}-set`}` to the `<select>` and directly above it `<label htmlFor={`${fieldId}-set`} className="sr-only">Booster pack set</label>` (absolutely positioned, so it takes no space in the flex row).
- Qty label (`>Qty:</label>`): `<label htmlFor={`${fieldId}-qty`} className="text-sm text-gray-600 whitespace-nowrap">Qty:</label>` and `id={`${fieldId}-qty`}` on the number input after it.
- Pack row minus/plus buttons (text `-` and `+`): add `aria-label={`Decrease ${pack.setName} quantity`}` and `aria-label={`Increase ${pack.setName} quantity`}`. They are 28 x 28 px and stay that size.
- Pack row remove button (`title="Remove"`): add `aria-label={`Remove ${pack.setName}`}`, `text-gray-400` to `text-gray-500`, `p-1` to `p-1.5 rounded`, `aria-hidden="true"` on the `<svg>`.
- "No price data" span: `text-rose-500` becomes `text-rose-700` (3.67 to 6.29:1).
- Promo field: the `<label className="block text-sm font-medium text-gray-700 mb-2">` before "Promo / Extras Value" gets `htmlFor={`${fieldId}-promo`}`; the hint `<p className="text-xs text-gray-500 mb-3">` gets `id={`${fieldId}-promo-hint`}`; the input gets `id={`${fieldId}-promo`}` and `aria-describedby={`${fieldId}-promo-hint`}`; the currency-symbol `<span>` gets `aria-hidden="true"`.
- Retail field: same with `retail` / `retail-hint`.
- Premium/discount cell (`navResult.premiumDiscount > 0 ? "text-rose-600" : "text-emerald-600"`, 16 px bold, emerald-600 fails): change to `"text-[var(--pf-loss-text)]"` and `"text-[var(--pf-gain-text)]"` (premium is the bad outcome, so it keeps the loss colour).

Do not convert `gray-*` to `slate-*` or `blue-*` to tokens here; that codemod is WP15 (F091).

### Step 11. `frontend/app/compare/CompareDashboard.tsx`

WP11 moved the client code here (`git mv` from `app/compare/page.tsx`, which is now a server wrapper). If `CompareDashboard.tsx` does not exist, WP11 is missing: make the same edits in `app/compare/page.tsx` and say so in the PR.

- Search input (`placeholder="Search SKU or title"`): add `aria-label="Search by SKU or title"` and add `focus:ring-2 focus:ring-[var(--pf-pokeblue)]` to its className (today it has `focus:outline-none` and only a border change, so keyboard focus is barely visible).
- CSV upload (`accept=".csv"` inside the dashed `<label>`): the `<input type="file">` has `className="hidden"` (display:none), which makes it unreachable by keyboard. Change it to `className="sr-only"` and add `relative focus-within:ring-2 focus-within:ring-[var(--pf-pokeblue)]` to the wrapping `<label>`'s className (`relative` anchors the absolutely positioned `sr-only` input inside the label, so focusing it does not scroll the page to its top). Clicking still opens the picker; Tab now reaches it and Space opens it.

### Step 12. Gain/loss TEXT colours: one rule everywhere

Every place that colours gain/loss TEXT uses `--pf-gain-text` / `--pf-loss-text`. Fills, strokes, borders (for example `ProductCard.tsx:37-38` border, sparkline strokes) keep `--pf-gain` / `--pf-loss`.

12a. Mechanical replace of the exact class strings (safe: every current use is a text class):

```bash
cd frontend
grep -rl 'text-\[var(--pf-gain)\]\|text-\[var(--pf-loss)\]' app --include=*.tsx | xargs -r sed -i \
  -e 's/text-\[var(--pf-gain)\]/text-[var(--pf-gain-text)]/g' \
  -e 's/text-\[var(--pf-loss)\]/text-[var(--pf-loss-text)]/g'
```

This covers `app/page.tsx` (MoverCard change), `app/product/[id]/page.tsx` (ReturnValue), `app/stats/page.tsx` (ReturnCell, ScoreCell), `app/auth/reset-password/page.tsx` (the large "!" glyph on `bg-rose-100`, 5.24:1 after the change) and any file WP05 to WP13 added. Run the `grep -rl` part alone first and list the files it prints in the PR.

12b. Hand edits (replace the positive branch with `text-[var(--pf-gain-text)]` and the negative branch with `text-[var(--pf-loss-text)]`):

- `app/components/ProductPrices/shared/ReturnMetrics.tsx`, the `colorClass` ternary (`"text-green-600"` / `"text-red-600"`, lines 115-120). This also fixes F091's "brand red on the card" for this file; WP15 must not redo it.
- `app/components/MarketView/MarketView.tsx`, `renderReturnValue` (`"text-emerald-600"` / `"text-rose-600"`).
- `app/components/Portfolio/shared/PortfolioSummaryCard.tsx`, both ternaries (Unrealized G/L and ROI).
- `HoldingCard.tsx` (step 8c) and `BoxCalculator.tsx` (step 10).

12c. Other failing green status text: `app/account/page.tsx`, both success messages `<div className="text-emerald-600 text-sm">` become `text-emerald-700`. The `text-rose-600` error messages on white (4.70:1) stay.

### Step 13. `text-slate-400` on informational text

Change only these (the background decides slate-500 vs slate-600: slate-500 is 4.76:1 on white but only 4.55:1 on slate-50, so small text on the page background or a tinted surface gets slate-600, which equals `--pf-ink-soft`). Find each by its anchor; skip a line that an earlier package already removed and note it in the PR.

| File | Anchor | Change to | Why |
| --- | --- | --- | --- |
| `ProductPrices/cards/ProductCard.tsx` | `<p className="text-[10px] md:text-xs text-slate-400 mt-2">` above `Updated:` | `text-xs text-slate-500 mt-2` | white card; 10 px was too small (F095) |
| `ProductPrices/cards/GroupHeader.tsx` | `text-[11px] font-mono text-slate-400` (set code) | `text-slate-600` | page background |
| `app/page.tsx` | `text-xs font-semibold uppercase tracking-wider text-slate-400` ("7-Day") | `text-slate-600` | page background |
| `app/product/[id]/page.tsx` | `text-xs font-mono text-slate-400` (set code) | `text-slate-600` | page background |
| `app/product/[id]/page.tsx` | `ml-1.5 text-sm font-semibold text-slate-400` ("USD") | `text-slate-600` | page background |
| `app/stats/page.tsx` | `text-[11px] font-semibold uppercase tracking-wider text-slate-400` ("Top 10") | `text-slate-500` | white section |
| `app/stats/page.tsx` | `px-3 py-3 text-slate-400 tabular-nums` (rank cell, 2 places) | `text-slate-500` | white rows |
| `MarketView/MarketView.tsx` | `w-14 bg-white px-3 py-4 text-slate-400` (row number) | `text-slate-500` | white cell (4.55:1 on its `group-hover:bg-slate-50`) |
| `MarketView/MarketView.tsx` | `text-xs text-slate-400">Loading...` and `">Open chart` (if still present after WP09) | `text-slate-500` | white cell |
| `charts/AllocationChartImpl.tsx` | `<li className="text-xs text-slate-400">` ("+N more") | `text-slate-500` | white card |
| `CardRinkPromo.tsx` | `<p className="mt-6 text-center text-xs text-slate-400">` ("Powered by pokefin.ca" line) | `text-slate-500` | white card |
| `CardRinkPromo.tsx` | dismiss button `p-1.5 rounded-md text-slate-400` | `text-slate-500` | icon-only control, 1.4.11 needs 3:1 |
| `ProductPrices/shared/ProductImage.tsx` | `<div className="text-slate-400">Loading...</div>` (WP12 keeps this text for non-priority images and its tests assert the text, not the class) | `text-slate-600` | on `bg-slate-200` (slate-500 there is 3.86:1) |
| `ImportHoldingsModal.tsx` | "Reason:" line | `text-slate-600` | done in step 7g |

Placeholders: replace `placeholder:text-slate-400` with `placeholder:text-slate-500` in every file (the hero search in `app/page.tsx`, `SearchInput.tsx`, WP13's `components/NotFoundPanel.tsx`, and the auth pages including `auth/login/LoginForm.tsx`, whose placeholders are the only format hint):

```bash
cd frontend
grep -rl 'placeholder:text-slate-400' app --include=*.tsx | xargs -r sed -i 's/placeholder:text-slate-400/placeholder:text-slate-500/g'
```

Keep `text-slate-400` (decorative, or passes on a dark surface), and say so in the PR:

- `--` no-data placeholders: `MarketView.tsx` (`renderReturnValue` and the volume cell), `stats/page.tsx` (ReturnCell, ScoreCell), `product/[id]/page.tsx` (ReturnValue, formatCount, "Days of supply"), `app/page.tsx` MoverCard `change === null`.
- Decorative icons next to a text label: `Header.tsx` chevron and menu icons (WP03's file), `SearchInput.tsx` magnifier, `ControlBar.tsx` chevron, `ImportHoldingsModal.tsx` upload and X icons, `HoldingCard.tsx` no-image placeholder icon.
- Dark tooltips, `bg-slate-900` (slate-400 there is 6.96:1): `PriceChart.tsx` currency unit (the verifier cited it, but on this background it passes), `PortfolioChartImpl.tsx`, `AllocationChartImpl.tsx` percentage.
- `compare/CompareDashboard.tsx` `hover:border-slate-400` (a border, not text).
- `disabled:text-slate-400` (WP09's chart toggle button in `ProductCard.tsx`, and any other `disabled:` variant): WCAG 1.4.3 exempts inactive controls.

Tap targets (F104): the MarketView row "Show/Hide" button (`px-3 py-1 text-xs`, about 26 px tall) and the CardRinkPromo dismiss button (`p-1.5` around a 16 px icon, about 28 px) already meet the 24 px WCAG 2.5.8 minimum. Leave their size unchanged and list them in the PR as checked.

### Step 14. `frontend/app/stats/page.tsx`: definitions that work on touch and for screen readers

14a. Replace `InfoIcon` (a 16 px `role="img"` focusable span whose text only appears as a mouse tooltip) with a decorative marker:

```tsx
function InfoIcon({ text }: { text: string }) {
  // Decorative. The same definitions are listed under "What do these columns
  // mean?" below the table, which works on touch and for screen readers; the
  // title stays as a hover hint for mouse users. Not focusable, so it is not
  // a tap target (the old 16 px focusable span failed WCAG 2.5.8).
  return (
    <span
      aria-hidden="true"
      title={text}
      className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold text-slate-500"
    >
      i
    </span>
  );
}
```

14b. Below `StatHeader`, add:

```tsx
const METRIC_DEFINITIONS: ReadonlyArray<{ label: string; key: keyof typeof STAT_TOOLTIPS }> = [
  { label: "Rank", key: "rank" },
  { label: "Release", key: "release" },
  { label: "Days Since", key: "days_since" },
  { label: "Products", key: "products" },
  { label: "Avg 30D", key: "avg30" },
  { label: "Avg 90D", key: "avg90" },
  { label: "Avg 1Y", key: "avg365" },
  { label: "Med 30D", key: "median30" },
  { label: "Med 90D", key: "median90" },
  { label: "Med 1Y", key: "median365" },
  { label: "Consistency 90D", key: "consistency90" },
  { label: "Consistency 1Y", key: "consistency365" },
  { label: "Volatility 90D", key: "volatility90" },
  { label: "Max Drawdown 1Y", key: "maxDrawdown365" },
  { label: "Trend 90D", key: "trend90" },
  { label: "Trend 1Y", key: "trend365" },
  { label: "Price/Day", key: "pricePerDay" },
  { label: "Momentum", key: "momentum" },
  { label: "Invest Score", key: "investScore" },
];

function MetricDefinitions() {
  return (
    <details className="border-t border-slate-200 px-4 py-3 text-sm">
      <summary className="cursor-pointer py-1 font-semibold text-slate-700 hover:text-slate-900">
        What do these columns mean?
      </summary>
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {METRIC_DEFINITIONS.map(({ label, key }) => (
          <div key={key}>
            <dt className="font-semibold text-slate-900">{label}</dt>
            <dd className="text-slate-600">{STAT_TOOLTIPS[key]}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
```

14c. In the "All Set Metrics" `<section>`, render `<MetricDefinitions />` after the `<div className="overflow-x-auto">...</div>` that wraps the table and before `</section>`. `<details>` needs no JavaScript, so the page stays a server component. If TypeScript reports a key that is not in `STAT_TOOLTIPS`, the object changed: list exactly its keys in table order.

### Step 15. `frontend/app/components/ProductPrices/shared/ScrollToTop.tsx`

Replace `aria-hidden={!isVisible}` with `inert={!isVisible}`. `aria-hidden` on a focusable button leaves it in the tab order while hiding it from screen readers (an invisible, unnamed tab stop); `inert` (React 19 boolean prop, all evergreen browsers) removes it from both while it is faded out. Keep `aria-label` and the `pointer-events-none` class.

### Step 16. Update existing tests that assert the old classes

```bash
cd frontend
grep -rnE 'text-(emerald|rose|green|red)-600|pf-gain\)|pf-loss\)' app --include=*.test.tsx
```

Expected hits: `Portfolio/__tests__/HoldingCard.test.tsx` (gain and loss `toHaveClass`), `Portfolio/__tests__/PortfolioSummaryCard.test.tsx` (three `toHaveClass`). Change `"text-emerald-600"` to `"text-[var(--pf-gain-text)]"` and `"text-rose-600"` to `"text-[var(--pf-loss-text)]"`. Leave the formatted strings as WP07 left them. Update any other hit the same way.

## Pitfalls: do not do this

- **Do not use `autoFocus` for the first field.** React 19 never renders the `autofocus` attribute; it calls `.focus()` at commit, which runs before the effect that calls `showModal()`, while the dialog is still closed, so it is a no-op and the browser then focuses the X (verifier correction 4). Focus explicitly after `showModal()` (Dialog's `initialFocusRef`).
- **Do not call `showModal()` without the `!dialog.open` guard, and never render `<dialog open>`.** `showModal()` throws `InvalidStateError` on an already-open dialog, and a dialog opened by the attribute is non-modal (no inert background, no top layer).
- **Do not put `flex`, `block` or `grid` on the `<dialog>` element.** An author `display` beats the UA rule `dialog:not([open]) { display: none }`, so a closed dialog would render. Layout goes on the inner `div`.
- **Do not drop `m-auto` from the dialog.** Tailwind 4 preflight sets `margin: 0` on everything; without `m-auto` the modal sits in the top-left corner, and a parent `space-y-*` pushes it to the bottom.
- **Do not keep the old backdrop `<div onClick={onClose}>` or `fixed inset-0` wrapper.** Use `backdrop:bg-black/50` and the target check (verifier correction 5). A plain `onClick={onClose}` on the dialog closes on every click inside it.
- **Do not wire ImportHoldingsModal's Dialog to `onClose`.** It must be `handleClose`, or Escape leaves the wizard on a stale step (verifier correction 5).
- **Do not rely on the browser's `cancel` event alone for Escape.** The combobox must be able to consume Escape first; handling it as a keydown with `isDefaultPrevented()` gives that ordering, and `preventDefault()` on the keydown stops the duplicate close request.
- **Do not add a global `:focus-visible { outline }` rule.** Preflight keeps browser default focus outlines; a global rule would stack on the `focus:ring-2` of every text input (inputs match `:focus-visible` on click too) and change the look site-wide for no gain.
- **Do not put `<button>`s inside `role="option"`.** Interactive content inside an option breaks the listbox pattern; the option `li` itself handles the click and `onMouseDown` keeps focus on the input.
- **Do not open the combobox popup on focus any more.** With initial focus on the input it would pop a hint on every open and swallow the first Escape.
- **Do not route hint text through `--pf-muted` or `text-muted`.** Both are slate-400 (verifier correction on F095). Use slate-500 on white, slate-600 (= `--pf-ink-soft`) on slate-50 or tinted surfaces.
- **Do not darken `--pf-gain` / `--pf-loss` themselves.** They also drive borders and sparkline strokes where 3:1 is enough and the brighter hue is intended; add the `-text` tokens instead.
- **Do not add `role="img"`, `tabIndex` or `aria-label` back to the stats `InfoIcon`** and do not build a JS popover for it; the `<details>` list is the accessible source and keeps `/stats` a server component.
- **Do not use `aria-hidden` to hide a focusable element** (ScrollToTop); use `inert`.
- **Do not touch `Header.tsx`** (WP03 did F022), the auth pages' `autoComplete`/`name` attributes (WP02, F024), `window.confirm`/`alert` (WP15, F103), the `gray-*`/`blue-*` codemod or CardRinkPromo placement/semantics (WP15, F091/F097). Only the class strings listed here change in those files.
- **Do not "fix" `ProductCard`'s `className="text-[10px] md:text-xs mt-1"` on `<ReturnMetrics>`.** It is inert (ReturnMetrics' inner `<p className="text-sm">` sets the size); leave it for WP19.
- **Do not add jest-axe or other dependencies in this PR.** An automated axe gate belongs to WP17 with the rest of CI.
- **Do not hard-code ids** in the modals or controls; use `useId()` (the controls render in both `/prices` and `/market`, and ids must stay unique and SSR-stable).
- **Do not call `setState` in the new effects** (Dialog, ProductSearchSelect focus effects, Import step effect). They only move focus or scroll; `react-hooks/set-state-in-effect` would flag anything else.

## Tests

All new test files live under the jsdom default environment (no docblock). Run them after step 1.

### 1. `frontend/app/components/ui/__tests__/Dialog.test.tsx` (new)

```tsx
import { useRef, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import Dialog from "../Dialog";

// The showModal spy below is installed per test; undo it so the polyfill is intact.
afterEach(() => {
  jest.restoreAllMocks();
});

function Harness({
  mountWhileOpen = false,
  withInitialFocus = false,
  onCloseSpy = () => {},
}: {
  mountWhileOpen?: boolean;
  withInitialFocus?: boolean;
  onCloseSpy?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialog = (
    <Dialog
      open={open}
      onClose={() => {
        onCloseSpy();
        setOpen(false);
      }}
      title="Test dialog"
      initialFocusRef={withInitialFocus ? inputRef : undefined}
    >
      <div className="p-4">
        <label htmlFor="field">Field</label>
        <input id="field" ref={inputRef} />
      </div>
    </Dialog>
  );
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {mountWhileOpen ? open && dialog : dialog}
    </>
  );
}

function openDialog() {
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus(); // fireEvent.click does not move focus in jsdom
  fireEvent.click(opener);
  return screen.getByRole("dialog", { name: "Test dialog" });
}
```

Cases (run the focus and Escape cases for both `mountWhileOpen` values with `describe.each([false, true])`):

- Closed: `queryByRole("dialog")` is null.
- Open: the dialog has the `open` attribute and `aria-modal="true"`; `HTMLDialogElement.prototype.showModal` (spy with `jest.spyOn`) was called once; without `initialFocusRef` the "Close" button has focus; with it, the "Field" input has focus.
- `fireEvent.keyDown(screen.getByLabelText("Field"), { key: "Escape" })` closes it (`queryByRole("dialog")` null), `onCloseSpy` called exactly once, and the "Open" button has focus again.
- The "Close" button closes it and restores focus the same way.
- A child that calls `preventDefault()` in its own `onKeyDown` for Escape keeps the dialog open (render `<Dialog open onClose={onClose} title="T"><input onKeyDown={(e) => e.preventDefault()} aria-label="child" /></Dialog>` and assert `onClose` not called).
- `fireEvent(dialog, new Event("cancel", { cancelable: true }))` returns `false` (default prevented) and calls `onClose`.
- Backdrop: `fireEvent.pointerDown(dialog); fireEvent.click(dialog)` calls `onClose` once; `fireEvent.pointerDown(input); fireEvent.click(dialog)` does not; `fireEvent.pointerDown(input); fireEvent.click(input)` does not.
- Browser-initiated close: with `<Dialog open onClose={onClose} ...>`, `act(() => { (screen.getByRole("dialog") as HTMLDialogElement).close(); })` calls `onClose` once.
- Prop-initiated close is not echoed: `const { rerender } = render(<Dialog open onClose={onClose} title="T">x</Dialog>)`, then `rerender(<Dialog open={false} onClose={onClose} title="T">x</Dialog>)`: `onClose` not called, dialog has no `open` attribute.

### 2. `frontend/app/components/Portfolio/__tests__/ProductSearchSelect.test.tsx` (new)

```tsx
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ProductSearchResult } from "../types";

const mockResults: ProductSearchResult[] = [
  { id: 1, usd_price: 100, image_url: null, variant: null, sets: { name: "151", code: "MEW" }, product_types: { name: "booster_box", label: "Booster Box" } },
  { id: 2, usd_price: null, image_url: null, variant: null, sets: { name: "Obsidian Flames", code: "OBF" }, product_types: { name: "etb", label: "Elite Trainer Box" } },
];

// The factory runs lazily; it may reference mock-prefixed bindings only.
// jest.requireActual, not require(): @typescript-eslint/no-require-imports is
// an error in this repo and test files are linted (same rule WP05's
// AddHoldingModal.test.tsx follows).
jest.mock("../hooks", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    usePortfolioData: jest.fn(),
    useProductSearch: () => {
      const [searchQuery, setSearchQuery] = React.useState("");
      return {
        searchQuery,
        setSearchQuery,
        results: searchQuery.length >= 2 ? mockResults : [],
        loading: false,
        error: null,
      };
    },
  };
});

import ProductSearchSelect from "../shared/ProductSearchSelect";

function Harness({ onSelectSpy, onSubmit }: { onSelectSpy: jest.Mock; onSubmit: jest.Mock }) {
  const [selected, setSelected] = useState<ProductSearchResult | null>(null);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <label id="lbl" htmlFor="inp">Product</label>
      <ProductSearchSelect
        inputId="inp"
        labelId="lbl"
        selectedProduct={selected}
        onSelect={(p) => { onSelectSpy(p); setSelected(p); }}
      />
    </form>
  );
}
```

Cases:

- The combobox is found by `getByRole("combobox", { name: "Product" })`, has `aria-expanded="false"`, `aria-autocomplete="list"` and an `aria-controls` value.
- `fireEvent.change(combo, { target: { value: "ob" } })`: `getByRole("listbox")` has 2 `option`s, `aria-expanded="true"`, no `aria-activedescendant`, and `getByRole("status")` has text "2 products found..." (use a regex).
- ArrowDown: `aria-activedescendant` equals the first option's `id` and that option has `aria-selected="true"`; ArrowDown again: second; ArrowDown again: wraps to first; ArrowUp: wraps to last.
- Enter on the highlighted option: `fireEvent.keyDown` returns `false`, `onSelectSpy` called with `mockResults[1]` (after two ArrowDowns), `onSubmit` not called, `getByRole("group", { name: "Product" })` exists, and the button matching `{ name: /^Clear selected product/ }` has focus.
- Clicking that clear button calls `onSelectSpy(null)` and the combobox has focus again.
- Escape with the listbox open: `fireEvent.keyDown` returns `false`, `queryByRole("listbox")` is null. Escape again with text "ob": returns `false`, the input value becomes "". Escape a third time: returns `true` (not claimed, so a Dialog would close).
- Mouse: clicking an option (`fireEvent.click(within(listbox).getAllByRole("option")[0])`) selects it.

### 3. `frontend/app/components/Portfolio/__tests__/PortfolioModals.a11y.test.tsx` (new)

Mocks (paths relative to the test file):

```tsx
// Copy test 2's `mockResults` array (products 1 and 2) and its `jest.mock("../hooks", ...)`
// factory into this file verbatim, above the mocks below. Do not import them from test 2.
jest.mock("../../../lib/portfolioApi", () => ({ addHolding: jest.fn(), updateHolding: jest.fn() }));
jest.mock("../../../lib/import", () => ({
  processCollectrImport: jest.fn(),
  importHoldings: jest.fn(),
  calculateImportSummary: jest.fn(() => ({ total: 0, matched: 0, unmatched: 0, imported: 0, skipped: 0, errors: 0 })),
  CSV_MAX_BYTES: 2 * 1024 * 1024,
  CSV_MAX_ROWS: 10_000,
}));
jest.mock("../../../lib/logger", () => ({ logCaughtError: jest.fn() }));
```

Mocking `../hooks` also keeps `usePortfolioData` (and through it the Supabase browser client) from loading.

Cases:

- AddHoldingModal (`<AddHoldingModal isOpen onClose={onClose} onSuccess={jest.fn()} />`): `getByRole("dialog", { name: "Add Holding" })`; the combobox named "Product" has focus; `getByLabelText("Quantity")`, `getByLabelText("Purchase Price (USD)")`, `getByLabelText("Purchase Date")`, `getByLabelText("Notes (optional)")` each return the matching input/textarea; `getByRole("button", { name: "Close" })` exists; `fireEvent.keyDown(getByLabelText("Quantity"), { key: "Escape" })` calls `onClose` once.
- AddHoldingModal price pre-fill (replaces the removed effect): `fireEvent.change(combobox, { target: { value: "15" } })`, `fireEvent.keyDown(combobox, { key: "ArrowDown" })`, `fireEvent.keyDown(combobox, { key: "Enter" })` selects product 1 (usd_price 100): `getByLabelText("Purchase Price (USD)")` has value `100` (`toHaveValue(100)`, it is a number input). Then click the button named `/^Clear selected product/`, query the combobox again (it is a new element), type "15" again, ArrowDown twice, Enter: product 2 (usd_price null) is selected and the price input has no value (`toHaveValue(null)`). Use the real `lib/priceGuard` (for a plain product object `hasCurrentPrice` only checks `usd_price !== null`, `priceGuard.ts:135-140`), so no mock is needed.
- EditHoldingModal with a fixture `{ id: 7, quantity: 2, purchase_price_usd: 12.5, purchase_date: "2026-01-02", notes: "", products: { id: 1, usd_price: 20, image_url: null, variant: null, url: "", sets: { name: "151" }, product_types: { name: "booster_box", label: "Booster Box" } } } as unknown as HoldingWithProduct`: dialog named "Edit Holding"; `getByLabelText("Quantity")` has focus and value "2"; price "12.50"; Escape calls `onClose`.
- ImportHoldingsModal (`isOpen`, `onClose`, `onSuccess` mocks): dialog named "Import from Collectr"; the "Click to upload CSV file" button has focus; `fireEvent.change(getByLabelText("Collectr CSV content"), { target: { value: "a,b" } })`, then Escape on the textarea: `onClose` called once and the textarea value is "" (wizard reset through `handleClose`).
- ImportHoldingsModal closed mid-parse (steps 7c and 7e): import `processCollectrImport` from `"../../../lib/import"` (it is the mock) and make it return a promise you resolve by hand (`let resolveParse!: (v: unknown) => void; (processCollectrImport as jest.Mock).mockReturnValue(new Promise((r) => { resolveParse = r; }));`). Paste "a,b", click "Process CSV", press Escape on the textarea (`onClose` called once), then `await act(async () => { resolveParse([{ csvRow: {}, matchedProduct: null, matchConfidence: "none" }]); })`. Expect: no "Matched Products" / "Unmatched" preview heading appears, and the button named "Click to upload CSV file" exists and is not disabled (proves `setLoading(false)` in `handleClose`).

### 4. `frontend/app/components/ProductPrices/__tests__/controls.a11y.test.tsx` (new)

- `GenerationFilter`, `ProductTypeFilter`, `AgeFilter`: `getByLabelText("Generation")` (resp. "Product Type", "Min Age") is the `getByRole("combobox")`; clicking the label text is not needed.
- Two `GenerationFilter`s rendered side by side get different select ids.
- `CurrencySelector`: `getByRole("group", { name: "Currency" })` contains the USD and CAD buttons.
- `ChartTimeframeButtons`: `getByRole("radiogroup", { name: "Chart timeframe" })` exists and `container.querySelector("label")` is null.
- `SortControls`: groups named "Sort by" and "View".
- `SearchInput`: `getByRole("textbox", { name: "Search products" })`; with `ariaLabel="Find a set"` the name follows the prop.

### 5. `frontend/app/components/ProductPrices/__tests__/ScrollToTop.test.tsx` (new)

- Initially (`window.scrollY` 0) the button (`getByRole("button", { name: "Scroll to top" })`) has the `inert` attribute and no `aria-hidden`.
- After `Object.defineProperty(window, "scrollY", { value: 400, configurable: true })` and `fireEvent.scroll(window)`, it has no `inert` attribute. Restore `scrollY` in `afterEach`.

### 6. Updates

- `Portfolio/__tests__/HoldingCard.test.tsx`: class assertions per step 16; add a case: `getByRole("button", { name: /^Edit / })` and `getByRole("button", { name: /^Delete / })` exist and their names include the set name from the fixture.
- `Portfolio/__tests__/PortfolioSummaryCard.test.tsx`: class assertions per step 16.
- WP05's `Portfolio/__tests__/AddHoldingModal.test.tsx` must pass unchanged (its `ProductSearchSelect` mock ignores the new props; `getByRole("button", { name: "Add Holding" })` still finds only the submit button because the dialog title is a heading). If it fails with "Unable to find role", step 1's polyfill is missing.

## Verification

Run from `frontend/`:

```bash
pnpm exec tsc --noEmit
# expect: exit 0

LINT_FILES="app/components/Portfolio app/components/ProductPrices \
  app/components/BoxCalculator/BoxCalculator.tsx app/components/MarketView/MarketView.tsx \
  app/components/CardRinkPromo.tsx app/components/charts app/stats/page.tsx app/compare \
  app/page.tsx app/product app/account/page.tsx app/auth"
pnpm exec eslint $LINT_FILES 2>&1 | tail -n 3
# expect: exactly 2 errors fewer than the baseline from "Before you start" check 6, and the
# same number of warnings (the rewrite keeps ProductSearchSelect's two <img> warnings).
pnpm exec eslint $LINT_FILES -f json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const f of JSON.parse(s))if(f.errorCount)console.log(f.errorCount,f.filePath.replace(process.cwd()+"/",""))})'
# expect: the baseline list minus AddHoldingModal.tsx and EditHoldingModal.tsx. No file this PR
# created or edited appears (errors still listed belong to WP15/WP17, e.g. HoldingsTable x5,
# CardRinkPromo, charts/*Impl.tsx).
pnpm exec eslint app/components/ui
# expect: no output (0 problems in Dialog.tsx and its test)

pnpm exec jest --ci app/components/ui app/components/Portfolio app/components/ProductPrices
# expect: all suites pass, including the 5 new files

pnpm test --ci
# expect: all suites pass; suite count = base count + 5

pnpm build:stub
# expect: exit 0 (WP00 script). If WP00 is missing, skip and say so in the PR.

# Static checks. Each expected result is exact.
grep -rn "fixed inset-0" app/components/Portfolio
# expect: no output
grep -rnE '<dialog|showModal' app --include=*.tsx | grep -v __tests__
# expect: only app/components/ui/Dialog.tsx
grep -rnP '<label(?![^>]*htmlFor)' app --include=*.tsx | grep -v __tests__
# expect exactly 8 lines (baseline check 3's 25 minus the 17 fixed here): the 6 multi-line labels whose htmlFor is on the next line
# (auth/forgot-password/page.tsx x1, auth/login/LoginForm.tsx x2, account/page.tsx x3) and
# compare/CompareDashboard.tsx x2 (labels that wrap their input). No hit in Portfolio/,
# ProductPrices/controls/ or BoxCalculator/. Check each hit with: grep -n -A1 '<label' <file>
grep -rnE 'text-(green|red)-600|text-emerald-600|text-\[var\(--pf-(gain|loss)\)\]' app --include=*.tsx | grep -v __tests__
# expect: no output
grep -rn "slate-400" app --include=*.tsx | grep -v __tests__
# expect: only the keep-list in step 13 (-- placeholders, decorative icons, dark tooltips,
# a hover border, disabled: variants)
grep -rn 'aria-hidden={!isVisible}' app --include=*.tsx; grep -n 'role="img"\|tabIndex' app/stats/page.tsx
# expect: no output (Header.tsx's logo role="img" is correct and is not checked here)
```

Manual checks (the executor can do the first three with `pnpm build:stub` then `pnpm start`, or `pnpm dev`; the portfolio ones need a signed-in account, see Owner actions):

1. `/prices`: click the word "Generation": the select gets focus. With VoiceOver (Safari) or NVDA (Chrome), Tab to each filter: announced as "Generation, combo box", "Product Type, combo box", "Search products, edit text", "Currency, group".
2. `/stats` (needs data; on the stub the page shows the unavailable notice, so check it on the Vercel preview): "What do these columns mean?" expands with a tap and lists 19 definitions; the "i" markers are not Tab stops.
3. Scroll `/prices` down and back to the top: while the round button is hidden, Tab never lands on an invisible element.
4. `/portfolio`, keyboard only: Tab to "Add Holding", Enter. Correct: the dialog is centred, the page behind is dimmed and does not scroll, focus is in the Product field, the screen reader says "Add Holding, dialog". Type two letters: the result list is fully visible, or reachable by scrolling the dialog body, and is never cut off with no way to reach the last option. ArrowDown twice, Enter: the product card appears and focus is on its clear button. Tab cycles only through the dialog's controls (and the browser UI), never the page behind. Escape closes it and focus is back on "Add Holding". Repeat with Edit (focus lands in Quantity, back on the card's Edit button after Escape) and Import (focus on the upload button; Escape after pasting text and reopening shows an empty upload step).
5. Click inside a Notes textarea, drag the selection out onto the dimmed backdrop and release: the dialog stays open. A plain click on the backdrop closes it.
6. On a phone width (375 px): the dialogs fit with a 16 px margin, the body scrolls when the keyboard is up, the Edit/Delete icons on each holding card are clearly separate 32 px targets.

## Owner actions

1. Smoke test on the Vercel preview of this PR with a real account (about 10 minutes): run manual checks 2, 4, 5 and 6 above in Chrome and Safari (desktop and iOS). Confirm: each modal opens centred with focus inside, Escape and the X close it and return focus to the button that opened it, Add Holding still saves a holding, Import still imports a pasted Collectr CSV. Reply on the PR with pass/fail per check.

No migration, environment variable or dashboard setting is involved.

## Acceptance criteria

- [ ] `app/components/ui/Dialog.tsx` exists and is the only `<dialog>` in the app; Add, Edit and Import Holding use it; no `fixed inset-0` overlay remains in `app/components/Portfolio`.
- [ ] Each portfolio modal is exposed as `role=dialog` with the accessible name of its heading and `aria-modal="true"`.
- [ ] On open, focus is in the first field (Add: Product combobox; Edit: Quantity; Import: upload button); on close by Escape, X, Cancel or backdrop, focus returns to the opener.
- [ ] Escape closes each modal, except while the product listbox is open, where it closes only the listbox.
- [ ] The close buttons and the product clear button have accessible names and are at least 24 x 24 px.
- [ ] `ProductSearchSelect` is a combobox with `aria-expanded`, `aria-controls`, `aria-autocomplete="list"` and `aria-activedescendant`; ArrowUp/ArrowDown/Enter/Escape work as specified; results are `role=option` inside `role=listbox`.
- [ ] Every input and select in the portfolio modals, the `/prices` controls, BoxCalculator and the compare search has a programmatic name (`getByLabelText` or `getByRole(..., { name })` finds it).
- [ ] `ChartTimeframeButtons` renders no `<label>`; its radiogroup is still named "Chart timeframe".
- [ ] `--pf-gain-text` and `--pf-loss-text` exist in `globals.css`; no gain/loss text uses `text-green-600`, `text-red-600`, `text-emerald-600` or `text-[var(--pf-gain|loss)]`.
- [ ] No informational text uses `text-slate-400`; the "Updated:" line on product cards is at least 12 px.
- [ ] `/stats` shows a "What do these columns mean?" disclosure with every column definition; `InfoIcon` is not focusable.
- [ ] `ScrollToTop` uses `inert` when hidden and has no `aria-hidden`.
- [ ] AddHoldingModal and EditHoldingModal have 0 lint errors; no new lint errors anywhere.
- [ ] `tsc`, the full jest suite and `pnpm build:stub` pass; the 5 new test files are included.
- [ ] Owner smoke test on the preview passes.

## Rollback

Revert the PR commit (`git revert <sha>`) and redeploy. No migration, data or configuration change is involved, so nothing else needs undoing. Reverting restores the pre-PR overlays (mouse users unaffected either way). If only one piece misbehaves in a browser (for example the dialog on an old iOS), prefer a follow-up that keeps the labels and contrast changes and reverts only the modal files: `git checkout <sha>~1 -- app/components/Portfolio/cards app/components/Portfolio/PortfolioDashboard.tsx` and remove `app/components/ui/Dialog.tsx` in a new commit.

## Commit and PR

Commit message:

```text
fix(a11y): accessible portfolio dialogs, labelled controls, AA contrast

Keyboard and screen-reader users could not reliably use Add/Edit/Import
Holding: no dialog role, focus stayed behind the overlay, Escape did
nothing and the close buttons had no name. Form labels were not tied to
their inputs, and grey captions and gain/loss text failed WCAG AA.

- Add app/components/ui/Dialog.tsx on native <dialog> + showModal():
  named, modal, explicit initial focus, focus restore, Escape as keydown
  (children can claim it), backdrop click with drag guard (F030).
- Move the three portfolio modals onto it; Import closes through
  handleClose and ignores results that land after close.
- ProductSearchSelect becomes an APG combobox with a listbox,
  aria-activedescendant and arrow/Enter/Escape keys; named clear button.
- useId label/input pairs in the modals, /prices controls, BoxCalculator;
  aria-label on search inputs; group names for button groups (F031).
- Add --pf-gain-text/--pf-loss-text and use them for all gain/loss text;
  slate-400 informational text to slate-500/600; 32 px icon targets;
  ScrollToTop uses inert; /stats column definitions in a <details> (F095).
- jest: minimal HTMLDialogElement polyfill for jsdom.
```

PR title: `fix(a11y): accessible portfolio dialogs, labelled controls, AA contrast (WP14)`

PR body summary: what was broken (per finding, with the WCAG criteria 2.4.3, 4.1.2, 1.3.1, 1.4.3, 1.4.11, 2.5.8), the Dialog API and why native `<dialog>` (plus the four Tailwind/React gotchas it handles), the combobox keyboard model, the contrast table from step 2 and the step-13 change/keep lists, the lint-error delta (-2), test and build output, the owner smoke-test checklist, the tap-target sizes checked and left unchanged (MarketView Show/Hide, CardRinkPromo dismiss), and "Noticed, out of scope": BoxCalculator's saved-recipe rows load only on mouse click (clickable `<div>`), and radiogroup/button groups use one Tab stop per button instead of arrow-key roving focus. `window.confirm`/`alert` stay for WP15 (F103), whose `ConfirmDialog` follows the same native-`<dialog>` rules; mention that it could later be rebuilt on `Dialog`.
