# WP15: Visual consistency, promo placement, user-facing copy

- **Findings covered**
  - F091 (full, cluster members F091, F099): design-token drift. `ReturnMetrics` coloured returns with `text-green-600`/`text-red-600` (Tailwind 4 values `#00a63e`/`#e7000b`; the red is close to the brand red `--pf-pokeball` `#dc2626`, not the rose loss token) while the same card's stripe uses `--pf-gain`/`--pf-loss` (WP14 step 12b fixed this file; step 5a here only verifies it); `BoxCalculator`, `/privacy`, `error.tsx`, `global-error.tsx`, `ScrollToTop`, `HoldingsTable`, the portfolio spinners and one MarketView link use the raw `gray-*`/`blue-*` palette; `/privacy` spells the brand "Pokefin". The slate-400 contrast part of F091 is **not** in this package: WP14 (F095) owns it.
  - F097 (full, cluster members F092, F097, F101): two or three CardRinkTCG calls to action per page, the `/market` banner sits above the results table, the promo's "footer" variant is a `<footer>` element inside `<main>`, and its "Powered by pokefin.ca" line reads as if the visitor were on the store's site. The cluster's merged recommendation and its verifier correction cover promo count, placement, semantics and the dead variants only. F092's separate IA suggestion (move "Seller Tools" out of the primary nav in `Header.tsx`) is not part of that recommendation and is a product decision, so this package does not change the nav; list it in the PR under "Noticed, out of scope".
  - F103 (full): developer-facing copy ("Supabase analytics function migration", "Check your Supabase connection"), raw error strings, native `alert()`/`confirm()` for validation and destructive actions, a doubled portfolio heading, "Pokemon"/"Pokefin" spelling drift, a privacy contact line with no link, and mixed `...`/`…` ellipses.
  - Track 2 (`01-PRODUCT-DIRECTION.md` section 9 item 3; `research/trust-seo-brand.md` section 3 rows "WP15 step 3", "WP15 pitfall" and "WP03 / WP15 copy", sections 7.2, 14.1 and 14.4): the promo label comes from one exported constant, `PROMO_RELATIONSHIP_LABEL` in the new `app/content/disclosures.ts`, so WP24 can reuse one source for the promo, the footer and `/about`; the promo shows the store's name as text instead of the Poké Ball glyph (a third-party trademark); the conventions test bans "TCGPlayer" (the source spells it "TCGplayer"), "live price" and "real-time" in `app/**/*.tsx`, and step 13e fixes the remaining hits. Code identifiers are not renamed.
- **Priority rationale**: all three are verified low-severity polish items; they come after WP14 because the destructive confirmations need an accessible dialog pattern and the jsdom `<dialog>` polyfill, and after WP04 to WP06 because those packages rewrite the account, portfolio and box-calculator code this package edits.
- **Effort**: M, about 7 to 9 hours including tests.
- **Depends on**: WP14 (hard: the native-`<dialog>` rules, the jsdom `<dialog>` polyfill in `jest.setup.ts`, `app/components/ui/Dialog.tsx`, the `--pf-gain-text`/`--pf-loss-text` tokens and the ReturnMetrics fix, and the slate-400 contrast sweep). The plan runs packages in order, so WP00 to WP13 have also landed; the ones whose output this spec edits are WP02, WP03, WP04, WP05, WP06, WP07, WP08, WP11 and WP13, and each has a stated check or fallback below.
- **Unblocks**: WP17 (expects the `CardRinkPromo` rewrite with no effect, `deleteLoading` in use in `PortfolioDashboard`, and `SortButton`'s `type="button"`/`aria-pressed`/`bg-blue-50 text-[var(--pf-pokeblue-strong)]`), WP18 (keeps `MARKET_DATA_UNAVAILABLE` and the `logCaughtError("compare_market_data_failed", err)` catch in `CompareDashboard.tsx`, and runs `uiConventions.test.ts`), WP19 (expects no `CardRinkPromo` in `MarketView.tsx` and the tokenised store link, whose text this PR changes to "View on TCGplayer &gt;"; WP19 must keep that spelling or the conventions test fails), WP24 (extends `app/content/disclosures.ts` instead of creating it, and must keep `PROMO_RELATIONSHIP_LABEL`, `STORE_NAME` and `STORE_URL` exported, for example `export const PROMO_RELATIONSHIP_LABEL = DISCLOSURE.promoLabel;`, or update `CardRinkPromo.tsx`'s import in the same PR). Keep those names exactly.
- **Suggested branch name**: `remediation/wp15-visual-polish-and-copy`
- **Risk level**: medium. Most changes are class names and strings, but the account-deletion and holding-deletion flows are rewired onto a new dialog; a wiring mistake would block a GDPR erasure path. Both flows get component tests. No migrations.

## Why

Pokéfin looks like two products today: the catalog, market and stats pages use the slate palette and the `--pf-*` tokens, while the Box Calculator, the privacy page and the error page use Tailwind's default gray and blue, and at review time a losing product card showed two different reds (rose stripe, brand-red percentage; WP14 has since fixed that file). The CardRinkTCG store is pitched up to three times on one screen at the bottom of `/prices` and `/market`, and on `/market` a large store banner sits between the filters and the table, so on a 360x640 phone the visitor sees an ad before a single price. Copy leaks implementation details ("Supabase", "migration"), box-calculator validation interrupts with OS `alert()` popups, account deletion is guarded by a single `window.confirm`, and the portfolio page prints its heading twice. The promo's "Partner store" label does not say whether Pokéfin is owned by, paid by or independent of the store, it carries the Poké Ball (a third-party trademark), and four UI strings still spell the price source "TCGPlayer". After this PR every page uses one palette, each page shows at most one promo and always after its primary content, the promo label lives in one constant that WP24 turns into a full disclosure, the source is spelled "TCGplayer", all errors are fixed user-facing sentences, and destructive actions use an accessible in-page confirmation (account deletion requires typing DELETE).

## Before you start

Read these files fully (paths relative to `frontend/`):

- `app/components/CardRinkPromo.tsx` (206 lines at review time; `<footer>` at `:155`, dead `header`/`card` variants at `:50-69`/`:137-150`, `sessionStorage` at `:12,37,45`), `app/components/Footer.tsx` (store link `:91-98`).
- Promo call sites: `app/page.tsx:323`, `app/prices/page.tsx:39`, `app/market/page.tsx:34`, `app/stats/page.tsx:271`, `app/product/[id]/page.tsx:428`, `app/box-calculator/page.tsx` (`:22` before WP11), `app/components/ProductPrices/index.tsx` (import `:11`, banner `:338-339` before WP08), `app/components/MarketView/MarketView.tsx` (import `:41`, banner `:664`, above "Found N products" at `:673`).
- `app/globals.css:10-64` (tokens), `app/stats/page.tsx:65-104` (the token pattern to copy) and `:128-132` (developer copy).
- `app/components/ProductPrices/shared/ReturnMetrics.tsx:114-129`.
- `app/components/BoxCalculator/BoxCalculator.tsx` (747 lines before WP06; alerts `:180-203`; Save label `:307-315`), and the WP06 spec step 9 (`audits/remediation/WP06-box-recipes-api.md`, section "Step 9") because WP06 rewrote large parts of this file and added a `window.confirm` in `handleSetSharing`.
- `app/privacy/page.tsx`, `app/error.tsx`, `app/global-error.tsx`.
- `app/account/page.tsx` as left by WP04 step 7 (export handler, delete handler with `window.confirm`, Danger Zone block).
- `app/components/Portfolio/PortfolioDashboard.tsx` as left by WP05 step 15 (`handleDelete` with `window.confirm` and `alert`, header row `:121-151`), `app/portfolio/page.tsx:63-74` (page-level H1).
- `app/components/Portfolio/cards/HoldingsTable.tsx:79-95` and its test `app/components/Portfolio/__tests__/HoldingsTable.test.tsx:395-447` (asserts `bg-blue-100`).
- `app/components/Portfolio/cards/ImportHoldingsModal.tsx` (review-time copy `:97`, `:226`; palette `:255`, `:356`, `:383`, `:444`; WP05 and WP14 moved these lines, so find them by the quoted text), `app/components/Portfolio/shared/ProductSearchSelect.tsx` (WP14 step 4 rewrote it; its loading spinner has `border-blue-500`), `app/components/ProductPrices/shared/ScrollToTop.tsx:36`, `app/components/MarketView/MarketView.tsx:587` (the "View on TCGPlayer" link).
- The compare market-data error: `app/compare/CompareDashboard.tsx` if WP11 landed (WP11 step 9 moved the client code there), otherwise `app/compare/page.tsx:371-375`.
- `app/components/Portfolio/hooks/usePortfolioData.ts` and `hooks/useProductSearch.ts` (WP05 rewrote both).
- `app/lib/logger.ts` (`logCaughtError`), `app/lib/authErrors.ts` (WP02, `AUTH_MESSAGES`), `app/lib/format.ts` (WP07, `formatInteger`), `jest.setup.ts`, `jest.config.js`.
- WP14's output: `app/components/ui/Dialog.tsx` (read it: `ConfirmDialog` in step 2 copies its Escape, native-close and backdrop handling) and the `HTMLDialogElement` polyfill WP14 step 1 appended to `jest.setup.ts`.
- Track 2 inputs: `audits/remediation/01-PRODUCT-DIRECTION.md` section 11 (owner decision D1, the CardRinkTCG relationship) and `audits/remediation/research/trust-seo-brand.md` section 7.2 (the label for each D1 answer). Step 3a uses them.

Confirm the starting state (run from `frontend/`):

```bash
git log --oneline -1

# 1. Promo: expect banner usages in ProductPrices/index.tsx and MarketView.tsx, footer usages on 6 pages,
#    and "<footer" in CardRinkPromo.tsx.
grep -rn "CardRinkPromo" app --include=*.tsx | grep -v __tests__
grep -n "<footer\|sessionStorage" app/components/CardRinkPromo.tsx

# 2. Native dialogs: expect account/page.tsx (confirm), PortfolioDashboard.tsx (confirm + alert),
#    BoxCalculator.tsx (4 alert calls + the WP06 "Stop sharing?" confirm).
grep -rn "window\.confirm(\|alert(" app --include=*.tsx | grep -v __tests__

# 3. Token drift. The first grep should print nothing (WP14 step 12b already moved ReturnMetrics
#    to the -text tokens; see step 5a). The second counts LINES with gray- in BoxCalculator:
#    60 at review time plus about 12 added by WP06, so expect roughly 70.
grep -n "text-green-600\|text-red-600" app/components/ProductPrices/shared/ReturnMetrics.tsx
grep -c "gray-" app/components/BoxCalculator/BoxCalculator.tsx

# 4. Copy: expect one hit each.
grep -rn "Supabase analytics" app/stats/page.tsx
grep -rln "Check your Supabase connection" app
grep -rn "\bPokefin\b" app --include=*.tsx | grep -v __tests__        # privacy/page.tsx only
grep -n "Pokemon" app/components/Portfolio/PortfolioDashboard.tsx app/components/Portfolio/cards/ImportHoldingsModal.tsx

# 4b. Track 2 copy (step 13e). After WP03 and WP13, expect "TCGPlayer" in exactly four .tsx lines:
#     ProductCard.tsx (2, "View on TCGPlayer →"), MarketView.tsx (1, "View on TCGPlayer &gt;"),
#     product/[id]/page.tsx (1, "View on TCGPlayer →"). The second grep expects only
#     BoxCalculator.tsx ("today&apos;s live booster pack market prices"); a "Live price" hit in
#     product/[id]/page.tsx means WP13 step 7 did not land (step 13e handles it). The third
#     expects no output (app/content is created in step 3a).
grep -rn "\bTCGPlayer\b" app --include=*.tsx | grep -v __tests__
grep -rniE "\blive prices?\b|\blive booster|\breal[- ]?time\b" app --include=*.tsx | grep -v __tests__
ls app/content 2>/dev/null

# 5. Dependencies this spec reads.
ls app/components/ui/ 2>/dev/null                    # WP14 (expect Dialog.tsx)
grep -n "HTMLDialogElement" jest.setup.ts            # WP14 polyfill; if absent, step 1 adds it
grep -n "export function formatInteger" app/lib/format.ts      # WP07
grep -n "sessionExpired\|rateLimited" app/lib/authErrors.ts     # WP02
grep -n "loadErrorMessage" app/components/Portfolio/hooks/usePortfolioData.ts   # WP05

# 6. Baselines. The eslint file list is the same one Verification uses (minus the files this
#    PR creates), so the two error counts are comparable.
pnpm exec tsc --noEmit
pnpm exec eslint app/components/CardRinkPromo.tsx app/components/MarketView/MarketView.tsx \
  app/components/ProductPrices/index.tsx app/components/ProductPrices/shared \
  app/components/BoxCalculator app/components/Portfolio app/account app/privacy app/error.tsx \
  app/global-error.tsx app/stats app/compare \
  app/page.tsx app/prices app/market app/product app/box-calculator 2>&1 | tail -3
pnpm test --ci 2>&1 | tail -5
```

Record the lint error count from baseline 6; this PR must not raise it.

Assumptions to check, with the fallback if false:

- WP14 landed: `app/components/ui/Dialog.tsx` exists, `jest.setup.ts` contains the `HTMLDialogElement` polyfill, and `ReturnMetrics.tsx` uses `text-[var(--pf-gain-text)]`/`text-[var(--pf-loss-text)]`. If `Dialog.tsx` is missing, stop: this package runs after WP14. (Step 1 and step 5a still carry fallbacks so a partially merged WP14 does not block the rest.)
- WP05 landed: `usePortfolioData.ts` has `loadErrorMessage` and never shows `err.message`; `PortfolioDashboard` has `applyHoldingDeleted` and imports `deleteHolding` from `../../lib/portfolioApi` (returns `boolean`). If WP05 has not landed, stop: this package's portfolio step is written against WP05's code.
- WP04 landed: `account/page.tsx` no longer imports `../lib/supabase`, and username errors are fixed strings. If not, stop.
- WP02 landed: `app/lib/authErrors.ts` exports `AUTH_MESSAGES` with `sessionExpired` and `rateLimited`. If missing, use the literal strings given in step 7.
- WP07 landed: `formatInteger` exists in `app/lib/format.ts`. If missing, use `PRICE_MAX.toLocaleString("en-US")` wherever step 11 writes `formatInteger(PRICE_MAX)`.
- WP03 landed: the fixed "Loading price history..." toast (`ProductPrices/index.tsx:237`, `bg-blue-500`) is gone. If it is still there, change its `bg-blue-500` to `bg-[var(--pf-pokeblue)]` in step 6 so the guard test passes.

## Implementation steps

Do the steps in order. Steps 1 and 2 create what later steps import. Step 6 (codemod) must run after step 5's manual spinner edits. Step 15 (ellipsis script) runs after every step that writes copy. Step 16 (guard test) runs last.

### Step 1. jsdom `<dialog>` polyfill (verify; add only if WP14 did not)

jsdom 26 (the version installed) implements `HTMLDialogElement` without `showModal()`, `show()` or `close()`. WP14 step 1 appended a polyfill to `frontend/jest.setup.ts`. If `grep -n "HTMLDialogElement" jest.setup.ts` printed a line, do nothing in this step. If it printed nothing, append exactly WP14's block (copied here so both packages produce the same file):

```ts
// jsdom 26 ships HTMLDialogElement (with a reflected `open` attribute and a
// UA rule hiding dialog:not([open])) but no showModal/show/close. These
// stand-ins toggle `open` and fire "close" like a browser does, so dialog
// content is visible to Testing Library queries. Top layer, inertness of the
// page behind and browser focusing steps are NOT emulated.
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

The `typeof HTMLDialogElement` guard keeps `/** @jest-environment node */` suites working (setup files run there too). Note that this `close()` dispatches `close` synchronously, while browsers dispatch it in a later task; `ConfirmDialog` in step 2 is written to behave the same either way.

### Step 2. `app/components/ui/ConfirmDialog.tsx` (new)

A confirmation dialog for destructive actions, used by steps 8, 9 and 11. WP14 created the `app/components/ui/` directory.

Deviation from the plan, and why: the plan says "use the WP14 dialog". WP14's `Dialog` (`app/components/ui/Dialog.tsx`) always renders an X close button and reports every close request to `onClose`, and it has no notion of a running action. A confirmation needs three things it does not provide: dismissal is blocked while the action runs (including the X and a browser-forced close), initial focus goes to Cancel (or to the typed-confirmation field), and the confirm button can require typed text. WP14's spec anticipates this ("its `ConfirmDialog` is self-contained and follows the same rules, so it does not import `Dialog.tsx`"). So `ConfirmDialog` is self-contained and copies `Dialog.tsx`'s handling of the native element: guard `!dialog.open` before `showModal()`; focus explicitly after `showModal()` instead of `autoFocus` (F030 correction 4); Escape as a `keydown` with `preventDefault()` plus `onCancel` for other close requests; an `onClose` handler that keeps React state in sync when the browser closes the dialog on its own; backdrop click only when the press also started on the backdrop (F030 correction 5). Do not import or modify `Dialog.tsx`. Mention the possible consolidation in the PR body.

The dialog is open for exactly as long as it is mounted. Parents render it conditionally (`{pending && <ConfirmDialog ... />}`). That resets the typed text on every open without a state-reset effect (`react-hooks/set-state-in-effect` is an error in this repo) and makes focus restore a plain effect cleanup.

```tsx
"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";

export interface ConfirmDialogProps {
  /** Short question, e.g. "Delete this holding?". Becomes the dialog's accessible name. */
  title: string;
  /** Consequence text. Becomes the dialog's accessible description. */
  children: ReactNode;
  /** Verb phrase on the confirm button, e.g. "Delete holding". */
  confirmLabel: string;
  /** Confirm button text while `busy`, e.g. "Deleting…". Defaults to confirmLabel. */
  busyLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  /** While true, both buttons are disabled and every dismissal path is ignored. */
  busy?: boolean;
  /** Fixed, user-facing failure text shown inside the dialog (never a raw error message). */
  error?: string | null;
  /** When set, the confirm button stays disabled until the user types exactly this text. */
  confirmText?: string;
  onConfirm: () => void;
  /** Called on Cancel, Escape, a backdrop click or a browser-forced close (never while busy). The parent unmounts the dialog. */
  onDismiss: () => void;
}

/**
 * Accessible confirmation for destructive actions (review F103). It replaces
 * the browser's native confirm and alert popups. Mounting opens a native modal
 * <dialog> (focus containment, inert page); unmounting closes it and returns
 * focus to the control that was focused before it opened.
 */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  error = null,
  confirmText,
  onConfirm,
  onDismiss,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Set when this component closes the dialog itself (unmount, or the
  // StrictMode effect re-run), so the resulting "close" event is ignored.
  const closingFromEffectRef = useRef(false);
  // A press that started inside the panel (e.g. selecting the typed text)
  // and ended on the backdrop must not dismiss.
  const pressStartedOnBackdropRef = useRef(false);
  const titleId = useId();
  const bodyId = useId();
  const inputId = useId();
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    // React 19 runs autoFocus at commit, before this effect, while the dialog
    // is still closed, so it would be a no-op. Focus here instead.
    (inputRef.current ?? cancelRef.current)?.focus();
    return () => {
      if (dialog.open) {
        closingFromEffectRef.current = true;
        dialog.close();
      }
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const typedOk = confirmText === undefined || typed.trim() === confirmText;

  const requestDismiss = () => {
    if (!busy) onDismiss();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    // preventDefault also stops the browser from turning this key press into
    // a cancel/close request, so React state stays the one source of truth.
    event.preventDefault();
    requestDismiss();
  };

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    // Close requests that are not an Escape keydown (Android back gesture).
    event.preventDefault();
    requestDismiss();
  };

  const handleNativeClose = () => {
    if (closingFromEffectRef.current) {
      closingFromEffectRef.current = false;
      return;
    }
    // The browser closed the dialog without a cancelable request (for
    // example a second Escape with no user activation in between). Keep the
    // DOM and the parent's state in agreement.
    if (busy) {
      dialogRef.current?.showModal();
      return;
    }
    onDismiss();
  };

  const handlePointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    // The <dialog> has no padding and the panel fills it, so the dialog element
    // itself is only ever the target when the ::backdrop was pressed.
    pressStartedOnBackdropRef.current = event.target === event.currentTarget;
  };

  const handleClick = (event: MouseEvent<HTMLDialogElement>) => {
    const startedOnBackdrop = pressStartedOnBackdropRef.current;
    pressStartedOnBackdropRef.current = false;
    if (startedOnBackdrop && event.target === event.currentTarget) requestDismiss();
  };

  const confirmClass =
    tone === "danger"
      ? "bg-rose-600 hover:bg-rose-700"
      : "bg-[var(--pf-pokeblue)] hover:bg-[var(--pf-pokeblue-strong)]";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onKeyDown={handleKeyDown}
      onCancel={handleCancel}
      onClose={handleNativeClose}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-slate-200 bg-white p-0 text-left shadow-xl backdrop:bg-slate-900/50"
    >
      <div className="p-6">
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <div id={bodyId} className="mt-2 space-y-2 text-sm text-slate-600">
          {children}
        </div>

        {confirmText !== undefined && (
          <div className="mt-4">
            <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
              Type <span className="font-mono font-semibold">{confirmText}</span> to confirm
            </label>
            <input
              id={inputId}
              ref={inputRef}
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={typed}
              disabled={busy}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-[var(--pf-pokeblue)]"
            />
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-rose-600">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={requestDismiss}
            disabled={busy}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !typedOk}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${confirmClass}`}
          >
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
```

Notes:
- `m-auto` is required because Tailwind 4's preflight sets `margin: 0` on every element, which removes the user-agent `margin: auto` that centres a modal dialog. Do not add `flex`, `block` or `grid` to the `<dialog>` itself (an author `display` would beat the UA `dialog:not([open]) { display: none }` rule); layout goes on the inner `div`, which also carries the padding so that a press anywhere inside the panel never has the `<dialog>` as its target.
- WP14's `html:has(dialog[open]) { overflow: hidden }` rule in `globals.css` also locks page scrolling behind this dialog; nothing to add.
- The doc comment deliberately does not contain the text `alert(` or `confirm(` with a parenthesis: the step 16 guard test scans comments too.

### Step 3. `app/content/disclosures.ts` and `app/components/CardRinkPromo.tsx`: one variant, an `<aside>`, a server component

3a. Create `app/content/disclosures.ts` (new directory `app/content/`). It is the one source for the store name, URL and relationship label (Track 2). WP24 later extends this file with the footer sentence, the `/about` copy and the `rel` value; no component may write the label as a literal.

First decide the label. Owner decision D1 (`01-PRODUCT-DIRECTION.md` section 11) is the true CardRinkTCG relationship. Treat D1 as answered only if the owner's answer is written in this PR's task, issue or review thread. Then set `PROMO_RELATIONSHIP_LABEL` to the matching wording from `research/trust-seo-brand.md` section 7.2 (the same strings WP24's `disclosureCopy()` uses):

| D1 answer | `PROMO_RELATIONSHIP_LABEL` |
|---|---|
| owned (the operator owns or co-owns CardRinkTCG) | `"From the team behind Pokéfin"` |
| paid (placement or commission is paid) | `"Sponsored"` |
| unpaid (personal connection, no payment) | `"A shop we like"` |
| not answered (the default) | `"Partner store"` |

If the answer is "paid", also change the promo link's `rel` in step 3b from `"noopener noreferrer"` to `"sponsored noopener noreferrer"` (Google's rule follows payment; see Pitfalls). Write the file:

```ts
/**
 * Who Pokéfin promotes and how it is related to them. The CardRinkTCG promo
 * reads these now; WP24 extends this file for the footer and /about, so the
 * wording cannot drift. Never write the store label as a literal elsewhere.
 *
 * PROMO_RELATIONSHIP_LABEL follows owner decision D1
 * (research/trust-seo-brand.md section 7.2):
 *   owned: "From the team behind Pokéfin"
 *   paid: "Sponsored" (store links then also get rel "sponsored")
 *   unpaid: "A shop we like"
 *   not answered yet: "Partner store"
 */
export const STORE_NAME = "CardRinkTCG.ca";
export const STORE_URL = "https://cardrinktcg.ca";

export const PROMO_RELATIONSHIP_LABEL = "Partner store";
```

(Replace `"Partner store"` with the table's value only when D1 is answered as described above, and update the PR body to say which answer was used.) The file is a plain module with no `"use client"` and no imports, so both server and client components can import it.

3b. Replace the whole `app/components/CardRinkPromo.tsx`. The `banner`, `header` and `card` variants go (banner: step 4 removes its two call sites; header/card: zero call sites). With no state and no storage reads it no longer needs `"use client"`, so it renders identically on server and client and cannot shift layout after hydration.

```tsx
import Link from "next/link";
import { PROMO_RELATIONSHIP_LABEL, STORE_NAME, STORE_URL } from "../content/disclosures";

const CATEGORIES = [
  { label: "Sealed Products", sub: "Booster boxes, ETBs, bundles & more" },
  { label: "Single Cards", sub: "Find the exact cards you need" },
  { label: "Graded Slabs", sub: "PSA, CGC, BGS certified cards" },
];

/**
 * The one CardRinkTCG promotion a page may show (review F097).
 *
 * Placement rule: at most once per page, as the last child of the page's
 * <main>, after the primary content. Never inside a data view (MarketView,
 * ProductPrices) and never above a table or grid.
 *
 * An <aside> labelled with the store relationship (content/disclosures.ts),
 * not a <footer>: it is related, promotional content, and the site footer is
 * Footer.tsx. The store's name as text replaces the old ball glyph, which
 * was a third-party trademark.
 */
export default function CardRinkPromo() {
  return (
    <aside aria-label={PROMO_RELATIONSHIP_LABEL} className="mt-12 pt-8">
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col items-center text-center gap-3 mb-6">
            {/* Wordmark in place of the old decorative glyph. aria-hidden because the
                paragraph below names the store, so screen readers hear it once. */}
            <p aria-hidden="true" className="text-xl font-bold tracking-tight text-slate-900">
              {STORE_NAME}
            </p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {PROMO_RELATIONSHIP_LABEL}
            </p>
            <h2 className="text-2xl font-bold text-slate-900">Ready to start collecting?</h2>
            <p className="text-slate-600 max-w-xl">
              Visit <span className="font-semibold text-slate-900">CardRinkTCG.ca</span>{" "}
              for Pokémon sealed products, singles, and graded slabs.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-7">
            {CATEGORIES.map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-center"
              >
                <h3 className="font-semibold text-slate-900">{item.label}</h3>
                <p className="text-xs text-slate-500 mt-1">{item.sub}</p>
              </div>
            ))}
          </div>

          <div className="text-center">
            <Link
              href={STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white px-8 py-3 rounded-lg font-semibold transition-colors shadow-sm"
            >
              Shop CardRinkTCG.ca →
            </Link>
          </div>
        </div>
      </div>
    </aside>
  );
}
```

What changed versus the old footer variant, besides the element: the `PokeballGlyph` SVG (the Poké Ball is a third-party trademark) is replaced by the store's name as plain text, a visible relationship label (`PROMO_RELATIONSHIP_LABEL`, "Partner store" while D1 is open) is added above the heading, store name and URL come from `content/disclosures.ts`, and the old tagline "Powered by pokefin.ca, Track prices, shop smart." (`:196-198` at review time, written as if the visitor were on the store's site; WP14 only changed its colour) is removed, and with it the dismiss button WP14 restyled.

Keep the paragraph text "Visit CardRinkTCG.ca for Pokémon sealed products, singles, and graded slabs." and the CTA text "Shop CardRinkTCG.ca →" exactly as written: WP24 step 9 finds the paragraph by that text. Leave the `PokeballGlyph` functions in `Footer.tsx`, `Header.tsx` and the auth pages alone; WP27 replaces the site mark.

### Step 4. Promo call sites: remove both banners, drop the `variant` prop

4a. `app/components/MarketView/MarketView.tsx`: delete the import line `import CardRinkPromo from "../CardRinkPromo";` (`:41`; WP13 added `import NoResults from "../NoResults";` next to it, keep that one) and delete the line `<CardRinkPromo variant="banner" />` (`:664`, directly after the age-filter note and before the comment "The count and the table both read from the deferred search term"), plus the blank line after it. Nothing replaces it: `/market` keeps its single promo in `app/market/page.tsx` after `<MarketView />`, which is below the table.

4b. `app/components/ProductPrices/index.tsx`: delete the import `import CardRinkPromo from "../CardRinkPromo";` and the two lines

```tsx
        {/* CardRinkTCG Promotional Banner */}
        {!loading && <CardRinkPromo variant="banner" />}
```

(`:338-339` at review time; WP08 kept them, find them with `grep -n "CardRinkPromo" app/components/ProductPrices/index.tsx`). `/prices` keeps its single promo in `app/prices/page.tsx`.

4c. In every remaining call site replace `<CardRinkPromo variant="footer" />` with `<CardRinkPromo />`. Find them with:

```bash
grep -rn "<CardRinkPromo" app --include=*.tsx | grep -v __tests__
```

Expected: exactly six lines, one each in `app/page.tsx`, `app/prices/page.tsx`, `app/market/page.tsx`, `app/stats/page.tsx`, `app/product/[id]/page.tsx`, `app/box-calculator/page.tsx`, each the last child of that page's `<main>`. If any other file appears, it was added by a later package: apply the same rule (one per page, last in `<main>`).

4d. Leave `Footer.tsx:91-98` ("Shop at CardRinkTCG.ca →" in the About column) unchanged. It is a plain text link in the site chrome, not a promo block; the plan's "one promo per page" counts `CardRinkPromo` blocks. After this step the store appears as one block plus the footer's text link, instead of banner plus block plus link.

4e. Tests from WP08 and WP13 contain `jest.mock("../../CardRinkPromo", ...)`. Leave those lines: mocking a module that the subject no longer imports is harmless, and the module path still exists.

### Step 5. `ReturnMetrics` and the three spinners (manual, before the codemod)

5a. `app/components/ProductPrices/shared/ReturnMetrics.tsx`, the `colorClass` ternary. WP14 step 12b already replaced it with `text-[var(--pf-gain-text)]` / `text-[var(--pf-loss-text)]`, which fixes F091's "two reds on one card" (the loss text is rose-700 from the same rose family as the rose-600 stripe, not Tailwind 4's `red-600` `#e7000b`, which sits next to the brand red `#dc2626`). Verify only:

```bash
grep -n "pf-gain-text\|pf-loss-text" app/components/ProductPrices/shared/ReturnMetrics.tsx   # expect 2 lines
```

Fallback, only if it still says `"text-green-600"` / `"text-red-600"` (WP14 step 12b did not land): replace the positive branch with `"text-[var(--pf-gain-text)]"` and the negative branch with `"text-[var(--pf-loss-text)]"` if `grep -n "pf-gain-text" app/globals.css` prints a line, otherwise with exactly the classes `ReturnCell` in `app/stats/page.tsx` uses at that point. Keep `"text-slate-500"` for zero. Do not use `--pf-gain`/`--pf-loss` for text once the `-text` tokens exist (emerald-600 text is 3.77:1 and fails WCAG AA; WP14 owns that decision).

5b. Spinners match the portfolio shell (`app/portfolio/page.tsx:44`, `border-[var(--pf-pokeball)]`):

- `app/components/Portfolio/PortfolioDashboard.tsx` (the `if (loading)` block, `:83` at review time): `border-blue-600` becomes `border-[var(--pf-pokeball)]`.
- `app/components/Portfolio/cards/ImportHoldingsModal.tsx` (the `{step === "importing" && (` block, `:444` at review time; find it with `grep -n "border-blue-600" app/components/Portfolio/cards/ImportHoldingsModal.tsx`, expect one line): `border-blue-600` becomes `border-[var(--pf-pokeball)]`. This must happen before step 6, otherwise the codemod turns it into the blue token.
- `app/components/Portfolio/shared/ProductSearchSelect.tsx` (rewritten by WP14 step 4; `:95` at review time): the loading spinner `<div ... className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full mx-auto">`. Find it with `grep -n "border-blue-500" app/components/Portfolio/shared/ProductSearchSelect.tsx` (expect exactly one line); `border-blue-500` becomes `border-[var(--pf-pokeball)]`. Keep `border-t-transparent` and any `aria-hidden` WP14 added.

After 5b, `grep -rn "border-blue-" app/components/Portfolio --include=*.tsx | grep -v __tests__` prints only ImportHoldingsModal lines that the step 6 codemod converts (at review time `hover:border-blue-500` on the upload area and `border-blue-500` on the selected match row). A hit in `PortfolioDashboard.tsx` or `ProductSearchSelect.tsx` means 5b is incomplete.

5c. `app/privacy/page.tsx:13`: delete ` dark:text-gray-100` from the `<main>` class list. The `dark:` variant is inert in this app (`globals.css:8` routes it to a class that is never applied).

### Step 6. Palette codemod on the listed files

Save this script as `/tmp/wp15-palette-codemod.js` (outside the repo) and run it from `frontend/`:

```js
// Usage: node /tmp/wp15-palette-codemod.js <files...>
const fs = require("fs");
const RULES = [
  // Chips first, so the generic blue rule below does not split them.
  [/\bbg-blue-100 text-blue-700\b/g, "bg-blue-50 text-[var(--pf-pokeblue-strong)]"],
  [/\bhover:bg-blue-700\b/g, "hover:bg-[var(--pf-pokeblue-strong)]"],
  [/\bhover:text-red-500\b/g, "hover:text-[var(--pf-loss)]"],
  [/\b((?:[a-z-]+:)*)(text|bg|border|ring|divide|from|to|placeholder)-gray-(\d{2,3})\b/g, "$1$2-slate-$3"],
  [/\b((?:[a-z-]+:)*)(bg|text|border|ring)-blue-(?:400|500|600)\b/g, "$1$2-[var(--pf-pokeblue)]"],
  [/\b((?:[a-z-]+:)*)(text)-blue-700\b/g, "$1$2-[var(--pf-pokeblue-strong)]"],
];
for (const file of process.argv.slice(2)) {
  const before = fs.readFileSync(file, "utf8");
  let after = before;
  for (const [re, rep] of RULES) after = after.replace(re, rep);
  if (after !== before) fs.writeFileSync(file, after);
  const left = after.match(/\b(?:[a-z-]+:)*(?:text|bg|border|ring|divide)-(?:gray|blue|red|green)-\d{2,3}\b/g) || [];
  console.log(file, "remaining raw palette:", JSON.stringify([...new Set(left)]));
}
```

```bash
node /tmp/wp15-palette-codemod.js \
  app/components/BoxCalculator/BoxCalculator.tsx \
  app/privacy/page.tsx \
  app/error.tsx \
  app/components/ProductPrices/shared/ScrollToTop.tsx \
  app/components/Portfolio/cards/HoldingsTable.tsx \
  app/components/Portfolio/cards/ImportHoldingsModal.tsx \
  app/components/MarketView/MarketView.tsx
```

Expected output: `remaining raw palette` lists only `bg-blue-50` and `hover:bg-blue-50` (light tints; there is no soft-blue token and they are intentionally kept). A dry run against the pre-WP06 tree changed 64 lines in BoxCalculator, 4 in privacy, 2 in error.tsx, 1 each in ScrollToTop, HoldingsTable and MarketView, and 3 in ImportHoldingsModal after 5b. Review `git diff --stat` and spot-check BoxCalculator: `bg-blue-600 hover:bg-blue-700` (Save) became `bg-[var(--pf-pokeblue)] hover:bg-[var(--pf-pokeblue-strong)]`, `focus:ring-blue-500 focus:border-blue-500` became `focus:ring-[var(--pf-pokeblue)] focus:border-[var(--pf-pokeblue)]`, the NAV figures `text-blue-600` became `text-[var(--pf-pokeblue)]`, and every `gray-N` became `slate-N`. The emerald/amber/rose signal colours are finance semantics and are not touched.

Do not run the codemod on `app/components/PriceChart.tsx` (tooltip on a slate-900 background uses blue-400/blue-500 for contrast) or `app/components/ProductPrices/shared/ExpansionTypeBadge.tsx` (a categorical palette). Step 16 allowlists both.

### Step 7. `app/lib/userMessages.ts` (new): fixed strings for our own API failures

```ts
/**
 * Fixed, user-facing text for failed calls to Pokéfin's own /api routes
 * (review F103). UI code shows these, never err.message or a server's raw
 * body text; log the original with logCaughtError instead.
 *
 * Pure module: safe to import from client components and jsdom tests.
 */
import { AUTH_MESSAGES } from "./authErrors";

export const NETWORK_ERROR_MESSAGE =
  "We couldn't reach Pokéfin. Check your connection and try again.";

/** Our 403s come from the CSRF / origin gate (app/lib/csrf.ts). */
export const BLOCKED_REQUEST_MESSAGE =
  "This request was blocked. Refresh the page and try again.";

export function apiFailureMessage(status: number, fallback: string): string {
  if (status === 401) return AUTH_MESSAGES.sessionExpired;
  if (status === 403) return BLOCKED_REQUEST_MESSAGE;
  if (status === 429) return AUTH_MESSAGES.rateLimited;
  return fallback;
}
```

If `app/lib/authErrors.ts` does not export `AUTH_MESSAGES` (WP02 missing), drop the import and use the literals `"Your session has expired. Please sign in again."` and `"Too many attempts. Please wait a minute and try again."`.

### Step 8. `app/account/page.tsx`: fixed error text and a typed-confirmation delete dialog

Apply to the file as WP04 left it.

8a. Imports: add

```tsx
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { logCaughtError } from "../lib/logger";
import { apiFailureMessage, NETWORK_ERROR_MESSAGE } from "../lib/userMessages";
```

and, above `export default function AccountPage()`:

```tsx
const EXPORT_FAILED_MESSAGE = "We couldn't prepare your data export. Please try again.";
const DELETE_FAILED_MESSAGE = "We couldn't delete your account. Please try again.";
```

8b. Next to the existing `deleteLoading`/`deleteError` state add:

```tsx
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
```

8c. Replace `handleExportData` (review-time `:115-141`) with:

```tsx
  const handleExportData = async () => {
    setExportError(null);
    setExportLoading(true);
    try {
      const response = await fetch("/api/account/export", {
        method: "POST",
        headers: { "x-pokefin-request": "1" },
      });
      if (!response.ok) {
        // Server bodies are "Forbidden"/"Unauthorized"/...: map by status instead.
        setExportError(apiFailureMessage(response.status, EXPORT_FAILED_MESSAGE));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pokefin-data-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      logCaughtError("account_export_failed", err);
      setExportError(NETWORK_ERROR_MESSAGE);
    } finally {
      setExportLoading(false);
    }
  };
```

Keep the `x-pokefin-request` header and the lowercase `pokefin-data-` file name exactly.

8d. Replace `handleDeleteAccount` (review-time `:143-170`) with:

```tsx
  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    setDeleteError(null);
    let response: Response;
    try {
      response = await fetch("/api/account/delete", {
        method: "DELETE",
        headers: { "x-pokefin-request": "1" },
      });
    } catch (err) {
      logCaughtError("account_delete_failed", err);
      setDeleteError(NETWORK_ERROR_MESSAGE);
      setDeleteLoading(false);
      return;
    }
    if (!response.ok) {
      setDeleteError(apiFailureMessage(response.status, DELETE_FAILED_MESSAGE));
      setDeleteLoading(false);
      return;
    }
    // The account is gone. Only the network call sits inside the try, so a
    // later failure here can never be reported as "couldn't delete".
    await signOut();
    router.push("/");
  };
```

The old `await response.json()` on a failed response is gone (it threw a SyntaxError with parser text on a non-JSON body, which then reached the UI).

8e. The "Your data" card (review-time `:323`) has no bottom margin, so it touches the Danger Zone card. Change its container class `bg-white rounded-xl shadow-sm ring-1 ring-slate-200 p-6` to `bg-white rounded-xl shadow-sm ring-1 ring-slate-200 p-6 mb-6`, and its heading `text-slate-600` to `text-slate-500` to match the other section headings (`:205`, `:258`).

8f. Replace the Danger Zone block (review-time `:343-364`, from `{/* Danger Zone */}` through its closing `</div>`) with:

```tsx
        {/* Danger Zone */}
        <div className="bg-white rounded-xl shadow-sm ring-1 ring-rose-200 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-rose-600 mb-4">
            Danger Zone
          </h2>
          <p className="text-sm text-slate-600 mb-4">
            Permanently delete your account and all associated data. This action
            cannot be undone.
          </p>
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setDeleteDialogOpen(true);
            }}
            className="bg-rose-600 hover:bg-rose-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
          >
            Delete Account
          </button>
        </div>

        {deleteDialogOpen && (
          <ConfirmDialog
            title="Delete your account?"
            confirmLabel="Delete account"
            busyLabel="Deleting…"
            tone="danger"
            confirmText="DELETE"
            busy={deleteLoading}
            error={deleteError}
            onConfirm={handleDeleteAccount}
            onDismiss={() => {
              setDeleteDialogOpen(false);
              setDeleteError(null);
            }}
          >
            <p>
              This permanently deletes your profile, portfolio, holdings and saved
              box recipes. It cannot be undone.
            </p>
            <p>If you want a copy of your data, use &quot;Export my data&quot; first.</p>
          </ConfirmDialog>
        )}
```

Put the dialog inside the page's outer `max-w-2xl` wrapper, after the Danger Zone card. The error now renders inside the dialog, so the old section-level `{deleteError && ...}` block is intentionally gone.

8g. `handlePasswordUpdate` keeps `setPasswordError(error.message)`: after WP02 and WP04 that `error.message` is one of the fixed strings from `AUTH_MESSAGES` or AuthContext's network string, not backend text. Confirm with `grep -n "readErrorMessage\|NETWORK_ERROR" app/context/AuthContext.tsx`; if AuthContext still passes a raw Supabase message through, list it in the PR as a WP02/WP04 regression and do not fix it here.

### Step 9. `app/components/Portfolio/PortfolioDashboard.tsx`: delete dialog, inline failure, one heading

Apply to the file as WP05 step 15 left it.

9a. Imports: add `import ConfirmDialog from "../ui/ConfirmDialog";`. `HoldingWithProduct` is already imported from `./types`.

9b. Above `export default function PortfolioDashboard`, add:

```tsx
/** "Surging Sparks Booster Box (Pokemon Center)", the same parts HoldingCard shows. */
function holdingLabel(holding: HoldingWithProduct): string {
  const product = holding.products;
  const setName = product?.sets?.name || "This product";
  const productType = product?.product_types?.label || product?.product_types?.name || "";
  const variant = product?.variant ? ` (${product.variant})` : "";
  return `${setName}${productType ? ` ${productType}` : ""}${variant}`;
}
```

9c. Next to `const [deleteLoading, setDeleteLoading] = useState<number | null>(null);` add:

```tsx
  const [pendingDelete, setPendingDelete] = useState<HoldingWithProduct | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
```

9d. Replace WP05's `handleDelete` (the function containing `window.confirm(` and `alert("Failed to delete holding. Please try again.")`) with:

```tsx
  // HoldingsTable passes only the id; the dialog needs the name.
  const handleDelete = (holdingId: number) => {
    const holding = holdings.find((h) => h.id === holdingId);
    if (!holding) return;
    setDeleteError(null);
    setPendingDelete(holding);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const holdingId = pendingDelete.id;
    setDeleteLoading(holdingId);
    setDeleteError(null);
    const success = await deleteHolding(holdingId);
    setDeleteLoading(null);
    if (success) {
      applyHoldingDeleted(holdingId);
      setPendingDelete(null);
    } else {
      setDeleteError("We couldn't delete this holding. Please try again.");
    }
  };
```

This also puts `deleteLoading` to use (WP05 noted its unused-variable warning).

9e. Remove the duplicate heading. Replace the header row (review-time `:121-151`: the `<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">` that contains `<h1 ...>{portfolio?.name || "My Portfolio"}</h1>` and the "Track your Pokemon TCG sealed product investments" paragraph) with a row that keeps only the two buttons:

```tsx
      {/* Actions. app/portfolio/page.tsx owns the page's only <h1> and tagline. */}
      <div className="flex items-center justify-end gap-2">
        {/* the existing Import <button> ... </button>, unchanged */}
        {/* the existing Add Holding <button> ... </button>, unchanged */}
      </div>
```

Move the two existing `<button>` elements byte for byte. Every portfolio is named "My Portfolio": after WP05 the only insert is `.insert({ user_id: userId, name: "My Portfolio" })` in `app/lib/server/portfolioRepo.ts` (it was `app/lib/portfolio.ts:197` at review time), and there is no rename UI. So dropping `portfolio.name` from the dashboard loses nothing, and the F103 suggestion to pass `portfolio.name` into the page `<h1>` is not needed. Confirm with `grep -rn 'name: "My Portfolio"' app --include=*.ts | grep -v __tests__` (expect exactly one line, in `portfolioRepo.ts`); if a second insert or a rename route exists, stop and report instead of dropping the name.

9f. At the end of the returned JSX, after the Import modal block and before the final `</div>`, add:

```tsx
      {pendingDelete && (
        <ConfirmDialog
          title="Delete this holding?"
          confirmLabel="Delete holding"
          busyLabel="Deleting…"
          tone="danger"
          busy={deleteLoading === pendingDelete.id}
          error={deleteError}
          onConfirm={confirmDelete}
          onDismiss={() => {
            setPendingDelete(null);
            setDeleteError(null);
          }}
        >
          <p>
            {holdingLabel(pendingDelete)} will be removed from your portfolio. This
            cannot be undone.
          </p>
        </ConfirmDialog>
      )}
```

### Step 10. `HoldingsTable` sort chip: expose state, not colour

`app/components/Portfolio/cards/HoldingsTable.tsx`, inside `SortButton` (`:79-95`): after step 6 the active class is `bg-blue-50 text-[var(--pf-pokeblue-strong)]`. Add `aria-pressed={sortBy === field}` and `type="button"` to the `<button>`:

```tsx
  const SortButton = ({ field, label }: { field: HoldingSortBy; label: string }) => (
    <button
      type="button"
      onClick={() => handleSort(field)}
      aria-pressed={sortBy === field}
      className={`text-xs font-medium px-2 py-1 rounded ${
        sortBy === field
          ? "bg-blue-50 text-[var(--pf-pokeblue-strong)]"
          : "text-slate-500 hover:bg-slate-100"
      }`}
    >
```

Leave the rest of `SortButton` (and its `react-hooks/static-components` lint error, owned by WP17) as is. Update the test in step "Tests" 5.

### Step 11. `BoxCalculator.tsx`: inline validation, "Save failed", and a stop-sharing dialog

Apply to the file as WP06 and WP07 left it (and after step 6's codemod).

11a. Imports: add `import ConfirmDialog from "../ui/ConfirmDialog";` and, if not already imported by WP07, `import { formatInteger } from "../../lib/format";`.

11b. Next to `const [saveStatus, setSaveStatus] = useState<...>("idle");` add:

```tsx
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmStopSharing, setConfirmStopSharing] = useState(false);
```

11c. In `handleSave`, replace the validation block (from `if (!user) return;` through the fourth `alert(...)`/`return;` pair, review-time `:181-203`) with:

```tsx
    if (!user) return;
    setSaveError(null);

    const trimmedName = recipeName.trim();
    if (trimmedName.length < 1 || trimmedName.length > RECIPE_NAME_MAX_LEN) {
      setSaveStatus("idle");
      setSaveError(`Give your recipe a name of 1 to ${RECIPE_NAME_MAX_LEN} characters.`);
      return;
    }
    if (!isFiniteInRange(retailPrice, 0, PRICE_MAX)) {
      setSaveStatus("idle");
      setSaveError(`Enter a retail price between 0 and ${formatInteger(PRICE_MAX)}.`);
      return;
    }
    if (!isFiniteInRange(promoValue, 0, PRICE_MAX)) {
      setSaveStatus("idle");
      setSaveError(`Enter a promo value between 0 and ${formatInteger(PRICE_MAX)}.`);
      return;
    }
    if (packs.length === 0 || packs.length > RECIPE_PACKS_MAX) {
      setSaveStatus("idle");
      setSaveError(`A recipe needs 1 to ${RECIPE_PACKS_MAX} pack types.`);
      return;
    }
```

11d. In the same function's failure branch (`} else { setSaveStatus("error"); }` after `saveRecipe`), add `setSaveError("We couldn't save this recipe. Please try again.");` after `setSaveStatus("error");`.

11e. In `handleNewRecipe`, add `setSaveError(null);` next to the other resets.

11f. Save button label: in the ternary (review-time `:307-315`) replace `? "Error"` with `? "Save failed"`.

11g. Render the message directly above WP06's `{shareStatus === "error" && (` block (which WP06 inserted just above `{/* Saved Recipes Toggle */}`):

```tsx
        {saveError && (
          <p role="alert" className="text-sm text-rose-600 mb-2">
            {saveError}
          </p>
        )}
```

11h. Stop sharing. In `handleSetSharing` (WP06 step 9f) delete the whole confirm guard:

```tsx
    if (
      !makePublic &&
      !window.confirm(
        "Stop sharing? Anyone with the current link will no longer be able to open this recipe."
      )
    ) {
      return;
    }
```

Then change the "Stop sharing" button's `onClick={() => handleSetSharing(false)}` to `onClick={() => setConfirmStopSharing(true)}`, and add before the component's final closing `</div>` of the main return:

```tsx
      {confirmStopSharing && (
        <ConfirmDialog
          title="Stop sharing this recipe?"
          confirmLabel="Stop sharing"
          tone="danger"
          onConfirm={() => {
            setConfirmStopSharing(false);
            void handleSetSharing(false);
          }}
          onDismiss={() => setConfirmStopSharing(false)}
        >
          <p>Anyone with the current link will no longer be able to open this recipe.</p>
        </ConfirmDialog>
      )}
```

The dialog closes immediately and WP06's existing `shareStatus` ("working", then "error" with its inline alert) reports progress, so no `busy` wiring is needed.

11i. Leave the saved-recipe trash button (`handleDeleteRecipe`) as it is: it never had a confirmation, and adding one is new behaviour outside F103. List it in the PR under "Noticed, out of scope".

### Step 12. Public copy: stats, compare, product search

12a. `app/stats/page.tsx` empty state (`:129-132`; find with `grep -n "Supabase analytics" app/stats/page.tsx`). Replace the text inside the amber `<div>` with:

```tsx
          Set analytics are temporarily unavailable. Please check back soon.
```

Keep the amber box classes.

12b. Compare market-data error. File: `app/compare/CompareDashboard.tsx` if it exists (WP11), else `app/compare/page.tsx`. Find the catch with `grep -n "Check your Supabase connection" app/compare/*.tsx`. Add at module level (below the imports):

```tsx
const MARKET_DATA_UNAVAILABLE =
  "We couldn't load current market prices. Refresh the page to try again.";
```

add `import { logCaughtError } from "../lib/logger";` if the file does not import it yet, and replace the catch. WP11 version:

```tsx
      } catch (err: unknown) {
        if (cancelled) return;
        // Never show err.message: it carries PostgREST / fetch wording.
        logCaughtError("compare_market_data_failed", err);
        setErrorMessage(MARKET_DATA_UNAVAILABLE);
      } finally {
```

Pre-WP11 version: the same without the `if (cancelled) return;` line. Do not touch `setErrorMessage(error)` in `handleCsvUpload`: those strings come from `parseShopifyCsv` and are already written for users.

12c. `app/components/Portfolio/hooks/useProductSearch.ts` (WP05 step 13). Nothing renders its `error` today (WP14's `ProductSearchSelect` destructures only `searchQuery, setSearchQuery, results, loading`), but the rejection handler is the last place client code stores a raw `err.message`. Add `import { logCaughtError } from "../../../lib/logger";` below the other imports and replace the rejection handler

```ts
        (err: unknown) => {
          if (!cancelled) {
            setResponse({
              query: searchQuery,
              results: [],
              error: err instanceof Error ? err.message : "Search failed",
            });
          }
        }
```

with

```ts
        (err: unknown) => {
          if (!cancelled) {
            // Never keep err.message: it can carry PostgREST or fetch wording.
            logCaughtError("product_search_failed", err);
            setResponse({
              query: searchQuery,
              results: [],
              error: "Search failed. Please try again.",
            });
          }
        }
```

12d. `app/components/Portfolio/hooks/usePortfolioData.ts`: verify only. `grep -n "err.message\|\.message" app/components/Portfolio/hooks/usePortfolioData.ts` must print nothing (WP05's `loadErrorMessage` returns fixed strings). If it prints a line, WP05 did not land as specified: stop and report.

12e. Modal error announcements (F103 verifier: the AddHoldingModal error `<div className="text-rose-600 text-sm">`, review-time `:219-223`, had no `role="alert"`, so it was not a pattern to copy). WP14 steps 5e (AddHoldingModal), 6 (EditHoldingModal) and 7g (ImportHoldingsModal) added the role. Verify only:

```bash
grep -n 'role="alert"' app/components/Portfolio/cards/AddHoldingModal.tsx app/components/Portfolio/cards/EditHoldingModal.tsx app/components/Portfolio/cards/ImportHoldingsModal.tsx
```

Expect at least one line per file. If a file has none, add `role="alert"` to the `<div>` that renders `{error}` in that file and name the file in the PR. Every inline error this PR writes (steps 2, 8, 9 and 11) already carries `role="alert"`.

### Step 13. Brand spelling: "Pokéfin", "Pokémon"

Only user-visible strings change. Data values, identifiers and comments stay.

13a. `app/privacy/page.tsx`:
- `:6` description becomes `"How Pokéfin collects, uses, and protects your data."`. (`:5` is already `title: "Privacy Policy",` after WP13 step 4f; if it still contains "Pokefin", set it to `"Privacy Policy"` exactly as WP13 specifies.)
- `:18` "This policy describes how Pokefin handles personal data. Pokefin is" becomes "This policy describes how Pokéfin handles personal data. Pokéfin is".
- `:97` and `:108`: after the codemod the two account links read `className="text-[var(--pf-pokeblue)] underline"`; make them `className="text-[var(--pf-pokeblue)] underline hover:text-[var(--pf-pokeblue-strong)]"`.
- Contact. The current text sends readers to "the contact channel listed on the Pokefin GitHub repository", but the repository's README lists no contact channel, so a plain repo link would still leave them nowhere. The repository is public and has issues enabled (checked 2026-09-30 via `https://api.github.com/repos/0xDario/Pokefin`: `"private": false`, `"has_issues": true`), so the default channel is a new issue, with a warning not to post personal data there. Add below `const LAST_UPDATED = ...`:

```tsx
// Where privacy requests go. The owner should replace this with a mailto:
// link (see the WP15 owner actions); a public issue is the fallback channel.
const PRIVACY_CONTACT_URL = "https://github.com/0xDario/Pokefin/issues/new";
```

  Replace the Contact section (the `<h2 ...>Contact</h2>` and the `<p>` after it, `:132-136` at review time) with:

```tsx
      <h2 id="contact" className="mt-8 mb-2 text-xl font-semibold">Contact</h2>
      <p>
        For privacy questions or requests,{" "}
        <a
          href={PRIVACY_CONTACT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--pf-pokeblue)] underline hover:text-[var(--pf-pokeblue-strong)]"
        >
          open an issue on the Pokéfin GitHub repository
        </a>
        . Issues are public, so do not include personal data in it; the
        operator will reply there and arrange a private channel.
      </p>
```

  And in the "Restriction & objection" list item (`:114-115`), link the words "contact the operator" to the section: `<a href="#contact" className="text-[var(--pf-pokeblue)] underline hover:text-[var(--pf-pokeblue-strong)]">contact the operator</a>`.
- Give the `<h1>` (`:14`) `text-slate-900` in addition to its current classes, so headings match the rest of the site.

13b. `app/components/Portfolio/cards/ImportHoldingsModal.tsx`:
- The line `setError("No valid products found in CSV. Make sure it's a Collectr export with Pokemon sealed products.");` (`:97` at review time) becomes `setError("No valid products found in this CSV. Make sure it's a Collectr export that includes Pokémon sealed products.");`
- The paragraph text `Import your sealed Pokemon TCG collection from Collectr. Export your collection as CSV from Collectr, then upload it here.` (`:226` at review time) becomes `Import your sealed Pokémon TCG collection from Collectr. Export your collection as CSV from Collectr, then upload it here.`
- Find both with `grep -n "Pokemon" app/components/Portfolio/cards/ImportHoldingsModal.tsx` (expect exactly these two lines). If a test asserts the old error text (`grep -rn "No valid products" app --include=*.test.*`), update it to the new text.

13c. `PortfolioDashboard.tsx:128` ("Track your Pokemon TCG sealed product investments") was removed in step 9e.

13d. Leave unchanged: `app/lib/import.ts:394` (`csvRow.category !== "Pokemon"` is the literal Collectr CSV value), product variant data such as "Pokemon Center" (from the database, asserted in `HoldingCard.test.tsx:123-130` and `sorting.test.ts:32`), code comments, and every lowercase `pokefin` identifier (`x-pokefin-request` header, `pokefin-data-*.json`, storage keys, the `pokefin.ca` domain).

13e. Track 2 copy: "TCGplayer", and no "live" or "real-time" price claims (prices update once a day). Only `.tsx` user-facing text changes; code identifiers, `.ts` code comments (`lib/marketPulse.ts`, `lib/marketData.ts`, their tests) and data stay as they are (WP24 sweeps the comments).

- Respell the source in these strings (found by "Before you start" check 4b):
  - `app/components/ProductPrices/cards/ProductCard.tsx`, both `View on TCGPlayer →` lines: `View on TCGplayer →`.
  - `app/components/MarketView/MarketView.tsx`, `View on TCGPlayer &gt;`: `View on TCGplayer &gt;`.
  - `app/product/[id]/page.tsx`, `View on TCGPlayer →`: `View on TCGplayer →`.
  - Any other `.tsx` line the check printed, the same way. If the hit is an identifier (a variable, prop, type or import name), leave it: the step 16 rule matches `\bTCGPlayer\b`, which skips identifiers such as `TCGPlayerLink`; if a standalone identifier named exactly `TCGPlayer` exists, stop and report instead of renaming it.
- `app/components/BoxCalculator/BoxCalculator.tsx`, the "How it works" list item: `The calculator uses today&apos;s live booster pack market prices per set,` becomes `The calculator uses the latest daily booster pack market prices per set,`.
- If "Before you start" check 4b printed `Live price` in `app/product/[id]/page.tsx`, WP13 step 7 did not land: replace that description with WP13's wording, `` `Daily TCGplayer Market Price, returns, volatility and price history for ${setName} ${label}.` ``, and list it in the PR as a WP13 gap.
- Tests: `grep -rn "TCGPlayer\|live booster" app --include=*.test.tsx --include=*.test.ts`. Update any assertion on a string changed above to the new text; leave comments and test names that describe the scraper's source (for example `marketPulse.test.ts` "dead TCGPlayer SKUs"), because they are `.ts` and outside the rule.

Afterwards both of these print nothing:

```bash
grep -rn "\bTCGPlayer\b" app --include=*.tsx | grep -v __tests__
grep -rniE "\blive prices?\b|\breal[- ]?time\b" app --include=*.tsx | grep -v __tests__
```

### Step 14. `error.tsx` and `global-error.tsx`

14a. `app/error.tsx`: after the codemod, set the `<h1>` class to `text-2xl font-semibold text-slate-900`, and the button to

```tsx
        <button
          type="button"
          onClick={reset}
          className="px-4 py-2 rounded-lg bg-[var(--pf-pokeblue)] hover:bg-[var(--pf-pokeblue-strong)] text-white text-sm font-semibold transition-colors"
        >
          Try again
        </button>
```

14b. `app/global-error.tsx` replaces the root layout, so `globals.css` (imported by `layout.tsx`) is not guaranteed to load and the Tailwind classes and CSS variables may be missing. Keep inline styles, but use the token hex values. Replace the returned JSX with:

```tsx
  // Replaces the root layout: globals.css may not be loaded, so inline styles
  // use the token values from globals.css (--pf-ink, --pf-ink-soft, --pf-pokeblue).
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#f8fafc",
          color: "#0f172a",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <div style={{ padding: "2rem", textAlign: "center", maxWidth: "28rem", margin: "4rem auto" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: "0 0 1rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#475569", margin: "0 0 1rem" }}>
            An unexpected error occurred. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#2563eb",
              color: "#fff",
              border: 0,
              borderRadius: "0.5rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
```

Keep the `Sentry.captureException` effect unchanged.

### Step 15. One ellipsis style: `…`

Run from `frontend/` after steps 2 to 14 (it also updates test assertions such as WP08's `getByPlaceholderText("Search by name or variant...")` and WP12's `"Loading..."`, so they keep matching):

```bash
node -e '
const fs = require("fs"), path = require("path");
function walk(d, o = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o);
    else if (/\.(tsx|ts)$/.test(p)) o.push(p);
  }
  return o;
}
// A letter, three dots, then a quote, backquote, "<" or end of line: UI text only.
// Spread syntax ({...x}, [...x], (...x)) never has a letter before the dots.
const re = /([A-Za-z])\.\.\.(?=["\x27`<]|[ \t]*$)/gm;
for (const f of walk("app")) {
  const s = fs.readFileSync(f, "utf8");
  const t = s.replace(re, "$1…");
  if (t !== s) { fs.writeFileSync(f, t); console.log(f); }
}'
```

Then:

```bash
grep -rnE '[A-Za-z]\.\.\.["<]' app --include=*.tsx                      # expect no output
grep -rn '\\\.\\\.\\\.' app --include=*.test.* --include=*.test.tsx       # regex literals like /Saving\.\.\./ are not rewritten; fix any hit by hand to …
```

Read the diff of every file the script printed: each changed line must differ only by `...` becoming `…`. At review time the script hit 22 UI strings (for example "Saving...", "Loading products...", "Search by name or variant...", "Recipe name...") plus one harmless comment in `app/lib/__tests__/portfolio.freshness.test.ts:160`. Do not change "Found {n} products" or any other wording here; WP13 recorded that WP08's tests assert "Found 2 products".

### Step 16. `app/__tests__/uiConventions.test.ts` (new): keep it this way

A static guard, in lieu of a lint plugin, that fails CI if the palette, the promo rules (including the label constant and the absent glyph), the dialog rule, the "Pokéfin" spelling or the Track 2 copy rules ("TCGPlayer", "live price", "real-time" in `.tsx` files) regress. Code in "Tests" 1. WP23 and WP24 append to this file and reuse `APP`, `collect`, `SOURCES` and `violations`, so keep those names and `violations`' `(re, allow)` signature. Run it: it must pass on the tree produced by steps 1 to 15. If it lists a file added by another package (for example a WP13 or WP14 component using `gray-*` or `text-blue-600`), convert that file with the step 6 script rather than allowlisting it, and name the file in the PR. If it lists a comment (the alert/confirm check scans comments too), reword the comment so it no longer contains `alert(` or `confirm(`.

## Pitfalls: do not do this

- **Do not claim the `<footer>` to `<aside>` change removes a duplicate landmark** (F097 verifier correction). Inside `<main>` the promo's `<footer>` already maps to `role=generic` (HTML-AAM) in Chromium and Firefox; there was only one `contentinfo`. The change is for honest semantics: sponsored content is an aside. Say that in the PR.
- **Do not add `rel="sponsored"` unless D1 is answered "paid"** (F097 verifier correction on F101; `research/trust-seo-brand.md` section 3 "WP15 pitfall"): Google's rule follows payment, not ownership. Nothing in the repo says the placement is paid, so keep `noopener noreferrer`. Only when step 3a records D1 as "paid" does the promo link become `rel="sponsored noopener noreferrer"`.
- **Do not write the promo label as a literal** in `CardRinkPromo.tsx` or anywhere else. Import `PROMO_RELATIONSHIP_LABEL` from `app/content/disclosures.ts`; WP24 builds the footer and `/about` disclosure on the same file.
- **Do not guess D1.** "Most likely owned" in the research is not an answer. Without the owner's written answer the label stays "Partner store".
- **Do not rename code identifiers or `.ts` comments for the "TCGplayer" spelling**, and do not touch "TCGPlayer" in Python or SQL. The step 16 rule covers `.tsx` text only.
- **Do not keep the banner and move it into `localStorage` with a TTL.** The plan chose one promo per page; the footer-style block already exists on all six routes. If the owner later wants the compact banner back, the verifier's rules apply: render it only below the data, read storage inside `useEffect` (never during render, or hydration mismatches), and wrap storage access in `try/catch` (Safari private mode throws).
- **Do not move the promo inside `MarketView` or `ProductPrices`.** The page file owns it, as the last child of `<main>`, so no data view can ever render an ad above its table.
- **Do not remove the site Footer's CardRinkTCG text link** (`Footer.tsx:91-98`): it is site chrome, not a promo block, and it is the only store link on pages without the block (auth pages hide the Footer entirely).
- **Do not run the palette codemod or a `gray-`/`blue-` sed across the whole `app/` tree.** `PriceChart.tsx` (dark tooltip) and `ExpansionTypeBadge.tsx` (categorical chips) use blue on purpose, and blanket replacement also hits the emerald/amber/rose finance colours' neighbours. Only the files listed in step 6.
- **Do not replace `bg-blue-50` tints.** There is no soft-blue token; the tint is intentional and not flagged by the guard.
- **Do not change `text-slate-400` here.** The contrast sweep is WP14 (F095). Its verifier also warned not to route hint text through `--pf-muted` (#94a3b8 is slate-400 itself).
- **Do not use `autoFocus` inside `ConfirmDialog`** (F030 verifier correction 4): React 19 calls `.focus()` at commit, before the effect that runs `showModal()`, so focus lands on the first button instead. Focus explicitly after `showModal()` as in step 2.
- **Do not call `showModal()` on an already open dialog** (it throws `InvalidStateError`); keep the `if (!dialog.open)` guard. React strict mode mounts, cleans up and remounts effects in development.
- **Do not drop `onClose={handleNativeClose}` or the `closingFromEffectRef` guard from `ConfirmDialog`.** Browsers may close a modal dialog without a cancelable request (Chrome does on a second Escape with no user activation in between). Without the handler the dialog disappears while the parent still thinks it is open, so the trigger button stops working until reload; without the guard, the component's own `close()` on unmount would be reported as a dismissal.
- **Do not rely on the `cancel` event alone for Escape, and do not dismiss on every click on the `<dialog>`.** Handle Escape as a `keydown` (as WP14's `Dialog` does), and dismiss on a backdrop click only when the press also started on the backdrop, so selecting the typed text and releasing outside the panel does not close the account-deletion dialog.
- **Do not write `alert(` or `confirm(` (with the parenthesis) anywhere under `app/` outside `__tests__`, comments included.** The step 16 guard test is a text scan and fails on comments too.
- **Do not rely on the browser's default dialog centring.** Tailwind 4 preflight zeroes margins; `m-auto` is required.
- **Do not keep `ConfirmDialog` always mounted with an `open` prop.** Resetting the typed text would need a state update inside an effect, which is a lint error in this repo; conditional mounting resets it for free.
- **Do not show `err.message`, `error.message` or a server's `data.error` text for our own `/api/account/*` routes.** Their bodies are "Forbidden", "Unauthorized", "Payload too large". Map by status with `apiFailureMessage` and log the original with `logCaughtError`.
- **Do not "fix" `"Pokemon"` in data or logic**: `import.ts:394` compares against the Collectr CSV's literal category, and variant names like "Pokemon Center" come from the database. Changing either breaks imports and tests.
- **Do not rename lowercase `pokefin` identifiers** (the CSRF header `x-pokefin-request`, the export file name, storage keys, the domain).
- **Do not edit `SortButton`'s structure in `HoldingsTable`** beyond `type` and `aria-pressed`: its "component defined during render" lint error is WP17's.
- **Do not add a confirmation to the saved-recipe trash button** in this PR (step 11i): new behaviour, out of F103's scope.
- **Do not write em dashes in new copy**; the site's own copy uses commas and periods (and this plan's rule forbids them).

## Tests

All paths relative to `frontend/`. Default environment is jsdom unless a docblock says otherwise.

### 1. `app/__tests__/uiConventions.test.ts` (new)

```ts
/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";
import { PROMO_RELATIONSHIP_LABEL } from "../content/disclosures";

// Static guard for review findings F091 (tokens), F097 (promo) and F103 (copy),
// plus the Track 2 source-name, cadence and disclosure-label rules.
const APP = path.resolve(__dirname, "..");

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") collect(full, out);
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const SOURCES = collect(APP).map((file) => ({
  file: path.relative(APP, file).split(path.sep).join("/"),
  text: fs.readFileSync(file, "utf8"),
}));

function violations(re: RegExp, allow: string[] = []): string[] {
  return SOURCES.filter((s) => !allow.includes(s.file)).flatMap((s) =>
    [...s.text.matchAll(re)].map((m) => `${s.file}: ${m[0]}`)
  );
}

describe("design tokens (F091)", () => {
  it("uses slate neutrals, never gray", () => {
    expect(
      violations(/\b(?:[a-z-]+:)*(?:text|bg|border|ring|divide|from|to|placeholder)-gray-\d{2,3}\b/g)
    ).toEqual([]);
  });

  it("routes brand blue through --pf-pokeblue", () => {
    expect(
      violations(/\b(?:[a-z-]+:)*(?:text|bg|border|ring)-blue-(?:400|500|600|700)\b/g, [
        "components/PriceChart.tsx", // tooltip on slate-900 needs lighter blue
        "components/ProductPrices/shared/ExpansionTypeBadge.tsx", // categorical palette
      ])
    ).toEqual([]);
  });

  it("colours returns with --pf-gain / --pf-loss, not green-600 / red-600", () => {
    expect(violations(/\btext-(?:green|red)-600\b/g)).toEqual([]);
  });
});

describe("user-facing copy (F103)", () => {
  it("never uses native alert() or confirm()", () => {
    expect(violations(/\b(?:window\.)?(?:alert|confirm)\(/g)).toEqual([]);
  });

  it("spells the brand Pokéfin", () => {
    // Lookbehind skips URLs such as github.com/0xDario/Pokefin (privacy contact link).
    expect(violations(/(?<![/\w])Pokefin\b/g)).toEqual([]);
  });

  it("does not show infrastructure names in error copy", () => {
    expect(violations(/Supabase (?:connection|analytics function migration)/g)).toEqual([]);
  });
});

describe("source name and cadence in .tsx copy (Track 2)", () => {
  // .tsx only: .ts code comments may still name the scraper's source the old
  // way until WP24 sweeps them. \b skips identifiers such as TCGPlayerLink.
  const TSX = SOURCES.filter((s) => s.file.endsWith(".tsx")).map((s) => s.file);
  const NOT_TSX = SOURCES.map((s) => s.file).filter((f) => !TSX.includes(f));

  it('spells the source "TCGplayer"', () => {
    expect(violations(/\bTCGPlayer\b/g, NOT_TSX)).toEqual([]);
  });

  it("never claims live or real-time prices (prices update daily)", () => {
    expect(violations(/\blive prices?\b|\breal[- ]?time\b/gi, NOT_TSX)).toEqual([]);
  });
});

describe("CardRinkTCG promo (F097)", () => {
  const PROMO = "components/CardRinkPromo.tsx";

  it("is rendered only by route files, at most once each", () => {
    const users = SOURCES.filter((s) => s.file !== PROMO && /<CardRinkPromo\b/.test(s.text));
    expect(users.length).toBeGreaterThan(0);
    for (const s of users) {
      expect(s.file).toMatch(/(^|\/)page\.tsx$/);
      expect(s.text.match(/<CardRinkPromo\b/g)).toHaveLength(1);
    }
  });

  it("is an aside with no footer element and no browser storage", () => {
    const promo = SOURCES.find((s) => s.file === PROMO)!.text;
    expect(promo).toMatch(/<aside\b/);
    expect(promo).not.toMatch(/<footer\b/);
    expect(promo).not.toMatch(/sessionStorage|localStorage/);
  });

  it("takes its label from content/disclosures.ts and shows no ball glyph", () => {
    const promo = SOURCES.find((s) => s.file === PROMO)!.text;
    expect(promo).toMatch(/aria-label=\{PROMO_RELATIONSHIP_LABEL\}/);
    expect(promo).not.toMatch(/"Partner store"|>\s*Partner store\s*</);
    expect(promo).not.toMatch(/PokeballGlyph|<svg\b/);
  });

  it("uses one of the research section 7.2 labels", () => {
    expect([
      "Partner store",
      "From the team behind Pokéfin",
      "Sponsored",
      "A shop we like",
    ]).toContain(PROMO_RELATIONSHIP_LABEL);
  });
});
```

### 2. `app/components/ui/__tests__/ConfirmDialog.test.tsx` (new)

jsdom (no docblock). Relies on WP14's `jest.setup.ts` polyfill; if `getByRole("dialog")` cannot find the element, the polyfill is missing (step 1). Write the file exactly as below.

```tsx
import { useState, type ComponentProps } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import ConfirmDialog from "../ConfirmDialog";

type Props = ComponentProps<typeof ConfirmDialog>;

function renderDialog(props: Partial<Props> = {}) {
  const onConfirm = jest.fn();
  const onDismiss = jest.fn();
  render(
    <ConfirmDialog
      title="Delete this holding?"
      confirmLabel="Delete holding"
      onConfirm={onConfirm}
      onDismiss={onDismiss}
      {...props}
    >
      <p>Surging Sparks Booster Box will be removed.</p>
    </ConfirmDialog>
  );
  const dialog = screen.getByRole("dialog", { name: "Delete this holding?" }) as HTMLDialogElement;
  return { onConfirm, onDismiss, dialog };
}

it("opens on mount, is described by its body, and focuses Cancel", () => {
  const { dialog } = renderDialog();
  expect(dialog).toHaveAttribute("open");
  expect(dialog).toHaveAccessibleDescription("Surging Sparks Booster Box will be removed.");
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
});

it("requires the exact confirmation text", () => {
  const { onConfirm, dialog } = renderDialog({ confirmText: "DELETE" });
  const input = within(dialog).getByLabelText(/Type DELETE to confirm/);
  const confirm = within(dialog).getByRole("button", { name: "Delete holding" });
  expect(document.activeElement).toBe(input);
  expect(confirm).toBeDisabled();
  fireEvent.change(input, { target: { value: "delete" } });
  expect(confirm).toBeDisabled();
  fireEvent.change(input, { target: { value: "DELETE" } });
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it("dismisses on Cancel, Escape and a cancel request", () => {
  const { onDismiss, dialog } = renderDialog();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(onDismiss).toHaveBeenCalledTimes(2);
  const cancel = new Event("cancel", { cancelable: true });
  fireEvent(dialog, cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(onDismiss).toHaveBeenCalledTimes(3);
});

it("dismisses on a backdrop click but not on a click inside the panel", () => {
  const { onDismiss, dialog } = renderDialog();
  const body = screen.getByText(/will be removed/);
  fireEvent.pointerDown(body);
  fireEvent.click(body);
  expect(onDismiss).not.toHaveBeenCalled();
  // A press that starts inside and ends on the backdrop does not dismiss.
  fireEvent.pointerDown(body);
  fireEvent.click(dialog);
  expect(onDismiss).not.toHaveBeenCalled();
  fireEvent.pointerDown(dialog);
  fireEvent.click(dialog);
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it("ignores every dismissal path and disables buttons while busy", () => {
  const { onDismiss, dialog } = renderDialog({ busy: true, busyLabel: "Deleting…" });
  fireEvent.keyDown(dialog, { key: "Escape" });
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  fireEvent.pointerDown(dialog);
  fireEvent.click(dialog);
  expect(onDismiss).not.toHaveBeenCalled();
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Deleting…" })).toBeDisabled();
});

it("keeps state in sync when the browser closes the dialog itself", () => {
  const { onDismiss, dialog } = renderDialog();
  act(() => dialog.close());
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it("reopens instead of dismissing when the browser closes it while busy", () => {
  const { onDismiss, dialog } = renderDialog({ busy: true });
  act(() => dialog.close());
  expect(onDismiss).not.toHaveBeenCalled();
  expect(dialog).toHaveAttribute("open");
});

it("shows a fixed error message as an alert inside the dialog", () => {
  const { dialog } = renderDialog({ error: "We couldn't delete this holding. Please try again." });
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "We couldn't delete this holding. Please try again."
  );
});

it("returns focus to the opener and does not call onDismiss again when it unmounts", () => {
  const onDismiss = jest.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Open</button>
        {open && (
          <ConfirmDialog
            title="Sure?"
            confirmLabel="Yes"
            onConfirm={() => {}}
            onDismiss={() => {
              onDismiss();
              setOpen(false);
            }}
          >
            <p>Body</p>
          </ConfirmDialog>
        )}
      </>
    );
  }
  render(<Harness />);
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  // The close() in the unmount cleanup fires "close"; it must not be reported.
  expect(onDismiss).toHaveBeenCalledTimes(1);
});
```

### 3. `app/components/Portfolio/__tests__/PortfolioDashboard.test.tsx` (new)

Cases: clicking a row's delete opens "Delete this holding?" naming the product; Cancel closes it and `deleteHolding` is not called; confirming calls `deleteHolding(1)` then `applyHoldingDeleted(1)` and closes; a `false` result keeps the dialog open with "We couldn't delete this holding. Please try again." and never calls `window.alert`; the dashboard renders no `<h1>` and no "Track your Pokemon" text. Mock factories use `jest.requireActual` + `createElement` instead of JSX, the same convention as WP05's `AddHoldingModal.test.tsx`.

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { HoldingWithProduct } from "../types";

const mockHolding = {
  id: 1,
  products: {
    sets: { name: "Surging Sparks" },
    product_types: { label: "Booster Box", name: "booster_box" },
    variant: null,
  },
} as unknown as HoldingWithProduct;

const mockHookState = {
  portfolio: { id: 7, user_id: "u1", name: "My Portfolio", created_at: "", updated_at: "" },
  holdings: [mockHolding],
  summary: {
    total_cost_basis: 0, priced_cost_basis: 0, total_current_value: 0, total_gain_loss: 0,
    total_gain_loss_percent: 0, holdings_count: 1, unpriced_holdings_count: 0, unique_products_count: 1,
  },
  history: [],
  loading: false,
  historyLoading: false,
  error: null,
  timeframe: "1M",
  setTimeframe: jest.fn(),
  refresh: jest.fn(),
  applyHoldingSaved: jest.fn(),
  applyHoldingDeleted: jest.fn(),
};
jest.mock("../hooks", () => ({ usePortfolioData: () => mockHookState }));
jest.mock("../../../lib/portfolioApi", () => ({ deleteHolding: jest.fn() }));
jest.mock("../shared/PortfolioSummaryCard", () => ({ __esModule: true, default: () => null }));
jest.mock("../shared/PortfolioChart", () => ({ __esModule: true, default: () => null }));
jest.mock("../shared/AllocationChart", () => ({ __esModule: true, default: () => null }));
jest.mock("../cards/AddHoldingModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../cards/EditHoldingModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../cards/ImportHoldingsModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../cards/HoldingsTable", () => ({
  __esModule: true,
  default: ({ onDelete }: { onDelete: (id: number) => void }) => {
    const React = jest.requireActual<typeof import("react")>("react");
    return React.createElement(
      "button",
      { type: "button", onClick: () => onDelete(1) },
      "Delete row 1"
    );
  },
}));

import { deleteHolding } from "../../../lib/portfolioApi";
import PortfolioDashboard from "../PortfolioDashboard";

const deleteHoldingMock = deleteHolding as jest.Mock;

beforeEach(() => jest.clearAllMocks());

it("confirms in a dialog, then deletes and updates local state", async () => {
  deleteHoldingMock.mockResolvedValue(true);
  render(<PortfolioDashboard />);
  fireEvent.click(screen.getByRole("button", { name: "Delete row 1" }));
  const dialog = screen.getByRole("dialog", { name: "Delete this holding?" });
  expect(dialog).toHaveTextContent("Surging Sparks Booster Box will be removed from your portfolio.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete holding" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(deleteHoldingMock).toHaveBeenCalledWith(1);
  expect(mockHookState.applyHoldingDeleted).toHaveBeenCalledWith(1);
});

it("does nothing when the dialog is cancelled", () => {
  render(<PortfolioDashboard />);
  fireEvent.click(screen.getByRole("button", { name: "Delete row 1" }));
  const dialog = screen.getByRole("dialog", { name: "Delete this holding?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(deleteHoldingMock).not.toHaveBeenCalled();
});

it("shows a failure inside the dialog instead of alert()", async () => {
  const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
  deleteHoldingMock.mockResolvedValue(false);
  render(<PortfolioDashboard />);
  fireEvent.click(screen.getByRole("button", { name: "Delete row 1" }));
  const dialog = screen.getByRole("dialog", { name: "Delete this holding?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete holding" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "We couldn't delete this holding. Please try again."
  );
  expect(mockHookState.applyHoldingDeleted).not.toHaveBeenCalled();
  expect(alertSpy).not.toHaveBeenCalled();
  alertSpy.mockRestore();
});

it("renders no second heading or tagline", () => {
  render(<PortfolioDashboard />);
  expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  expect(screen.queryByText(/Track your Pok/)).toBeNull();
  expect(screen.getByRole("button", { name: /Add Holding/ })).toBeInTheDocument();
});
```

If `PortfolioDashboard` imports a module that is not mocked above (run `grep -n "^import" app/components/Portfolio/PortfolioDashboard.tsx`), add a `() => null` mock for it in the same style. If WP05's hook field names differ from `mockHookState`, match the hook.

### 4. `app/account/__tests__/page.test.tsx` (update; created by WP04)

Keep WP04's mocks and cases. Add `jest.mock("../../lib/logger", () => ({ logCaughtError: jest.fn() }));` and a `describe("export and deletion (WP15)")` block with `const fetchMock = jest.fn(); beforeEach(() => { fetchMock.mockReset(); global.fetch = fetchMock as unknown as typeof fetch; });`. Use plain response objects (jsdom has no `Response`): `{ ok: false, status: 500, json: async () => ({ error: "Failed to delete account" }) }`. Open the dialog with `fireEvent.click(screen.getByRole("button", { name: "Delete Account" }))` and query inside it with `within(screen.getByRole("dialog", { name: "Delete your account?" }))` (the page button is "Delete Account", the dialog button is "Delete account"; `getByRole` name matching is case-sensitive). Wrap each confirm click in `await act(async () => { fireEvent.click(...); })`. Cases:
- "Delete Account" opens a dialog named "Delete your account?"; its "Delete account" button is disabled until `DELETE` is typed into the field labelled "Type DELETE to confirm"; confirming calls `fetch("/api/account/delete", { method: "DELETE", headers: { "x-pokefin-request": "1" } })`, then `signOut`, then `mockPush("/")` (response `{ ok: true, status: 200 }`).
- A 500 shows "We couldn't delete your account. Please try again." inside the dialog, the dialog stays open, `mockPush` is not called, and `screen.queryByText(/Failed to delete account/)` is null.
- `fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))` shows "We couldn't reach Pokéfin. Check your connection and try again." and `screen.queryByText(/Failed to fetch/)` is null.
- A 401 on delete shows "Your session has expired. Please sign in again.".
- "Export my data" with a 500 (`json` resolving `{ error: "Failed to export data" }`) shows "We couldn't prepare your data export. Please try again." and not "Failed to export data"; with a 403 shows "This request was blocked. Refresh the page and try again.".
- `const confirmSpy = jest.spyOn(window, "confirm");` at the start of the describe's first case; it is never called.

### 5. `app/components/Portfolio/__tests__/HoldingsTable.test.tsx` (update)

Replace the four class assertions (review-time `:403`, `:431`, `:442`, `:445`; find them with `grep -n "bg-blue-100" app/components/Portfolio/__tests__/HoldingsTable.test.tsx`):
- `:403` and `:431`, both `expect(dateButton).toHaveClass("bg-blue-100")`, become `expect(dateButton).toHaveAttribute("aria-pressed", "true")`.
- `:442` `expect(updatedNameButton).toHaveClass("bg-blue-100")` becomes `expect(updatedNameButton).toHaveAttribute("aria-pressed", "true")`.
- `:445` `expect(dateButton).not.toHaveClass("bg-blue-100")` becomes `expect(dateButton).toHaveAttribute("aria-pressed", "false")`.

Afterwards `grep -n "bg-blue-100" app/components/Portfolio/__tests__/HoldingsTable.test.tsx` prints nothing.

### 6. `app/components/BoxCalculator/__tests__/BoxCalculator.test.tsx` (update; created by WP06)

Reuse WP06's mocks and helpers (`hook`, `SAVED`, `SETS`, `openSavedAndLoad`, its `beforeEach` that runs `jest.clearAllMocks()` and resets `hook.savedRecipes = [SAVED]`, and its `afterEach(() => jest.restoreAllMocks())`). Add `within` to the `@testing-library/react` import if it is missing. Add:

```tsx
it("shows save validation inline instead of alert()", () => {
  const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
  render(<BoxCalculator />);
  openSavedAndLoad();
  fireEvent.change(screen.getByPlaceholderText(/Recipe name/), { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "Update" }));
  expect(screen.getByText(/Give your recipe a name of 1 to/)).toBeInTheDocument();
  expect(hook.saveRecipe).not.toHaveBeenCalled();
  expect(alertSpy).not.toHaveBeenCalled();
});

it("reports a failed save on the button and inline", async () => {
  hook.saveRecipe.mockResolvedValue(null);
  render(<BoxCalculator />);
  openSavedAndLoad();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
  });
  expect(screen.getByRole("button", { name: "Save failed" })).toBeInTheDocument();
  expect(screen.getByText("We couldn't save this recipe. Please try again.")).toBeInTheDocument();
});

it("asks in a dialog before it stops sharing", async () => {
  const confirmSpy = jest.spyOn(window, "confirm").mockImplementation(() => true);
  const shared = { ...SAVED, id: 4, name: "Shared box", shareCode: "d".repeat(32), isPublic: true };
  hook.savedRecipes = [shared];
  hook.setRecipeSharing.mockResolvedValue({ ...shared, shareCode: null, isPublic: false });
  render(<BoxCalculator />);
  fireEvent.click(screen.getByText(/Show saved recipes/));
  fireEvent.click(screen.getByText("Shared box"));
  fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
  const dialog = screen.getByRole("dialog", { name: "Stop sharing this recipe?" });
  expect(hook.setRecipeSharing).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop sharing" }));
  });
  expect(hook.setRecipeSharing).toHaveBeenCalledWith(4, false);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Make shareable" })).toBeInTheDocument();
  expect(confirmSpy).not.toHaveBeenCalled();
});

it("keeps sharing when the stop-sharing dialog is cancelled", () => {
  const shared = { ...SAVED, id: 4, name: "Shared box", shareCode: "d".repeat(32), isPublic: true };
  hook.savedRecipes = [shared];
  render(<BoxCalculator />);
  fireEvent.click(screen.getByText(/Show saved recipes/));
  fireEvent.click(screen.getByText("Shared box"));
  fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
  const dialog = screen.getByRole("dialog", { name: "Stop sharing this recipe?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(hook.setRecipeSharing).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Copy share link" })).toBeInTheDocument();
});
```

The `mockImplementation(() => true)` on the `confirm` spy keeps jsdom's "not implemented" error out of the output if a regression calls it; the assertion still fails in that case.

### 7. `app/lib/__tests__/userMessages.test.ts` (new)

`apiFailureMessage(401, "x")` is the session-expired string, `403` is `BLOCKED_REQUEST_MESSAGE`, `429` is the rate-limit string, `500` and `404` return the fallback `"x"`; `NETWORK_ERROR_MESSAGE` contains "Pokéfin".

### 8. Existing tests to re-run

All of `app/components/ProductPrices/__tests__`, `app/components/MarketView/__tests__`, `app/components/Portfolio/__tests__`, `app/components/BoxCalculator/__tests__`, `app/account/__tests__`, and any `ProductImage` test from WP12 (its "Loading..." strings were rewritten by step 15).

## Verification

From `frontend/`:

```bash
pnpm install --frozen-lockfile

# Types: expect no output, exit 0.
pnpm exec tsc --noEmit

# Lint the touched files: the error count must not exceed the baseline recorded in "Before you start"
# check 6 (same file list plus the new files; pre-existing: HoldingsTable static-components errors,
# owned by WP17). The new files (app/components/ui, app/lib/userMessages.ts, app/__tests__, app/content) must add 0 errors.
# jest.setup.ts is not linted (eslint ignores it) but tsc covers it.
pnpm exec eslint app/components/ui app/components/CardRinkPromo.tsx app/components/MarketView/MarketView.tsx \
  app/components/ProductPrices/index.tsx app/components/ProductPrices/shared \
  app/components/BoxCalculator app/components/Portfolio app/account app/privacy app/error.tsx \
  app/global-error.tsx app/stats app/compare app/lib/userMessages.ts app/__tests__ app/content \
  app/page.tsx app/prices app/market app/product app/box-calculator

# Focused tests: all pass.
pnpm test --ci app/__tests__/uiConventions.test.ts app/components/ui app/lib/__tests__/userMessages.test.ts \
  app/components/Portfolio app/account app/components/BoxCalculator app/components/ProductPrices app/components/MarketView

# Full suite: all pass.
pnpm test --ci

# Production build against the WP00 stub: exit 0.
pnpm build:stub

# Greps (all expect no output unless stated).
grep -rn "window\.confirm(\|alert(" app --include=*.tsx | grep -v __tests__
grep -rn "variant=\"banner\"\|variant=\"footer\"" app --include=*.tsx
grep -rn "<CardRinkPromo" app --include=*.tsx | grep -v __tests__ | wc -l      # expect 6
grep -rn "Pokefin\|Supabase analytics\|Check your Supabase" app --include=*.tsx | grep -v "github.com/0xDario/Pokefin"
grep -rn "Pokemon TCG\|Pokemon sealed" app --include=*.tsx | grep -v __tests__
grep -rnE '[A-Za-z]\.\.\.["<]' app --include=*.tsx
grep -rn "\bTCGPlayer\b" app --include=*.tsx | grep -v __tests__
grep -rniE "\blive prices?\b|\breal[- ]?time\b" app --include=*.tsx | grep -v __tests__
grep -rn "Partner store\|PokeballGlyph" app/components/CardRinkPromo.tsx
grep -rn "PROMO_RELATIONSHIP_LABEL" app --include=*.ts --include=*.tsx | grep -v __tests__   # expect lines only in content/disclosures.ts and CardRinkPromo.tsx
```

Python tests are unaffected (no Python changes); skip them.

Manual checks. Run locally against the stub (catalog is empty, which is fine for layout checks): terminal 1 `node scripts/supabase-stub.mjs`; terminal 2 `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_KEY=stub-anon-key pnpm dev`. Signed-in checks (account, portfolio, sharing) need the PR's Vercel preview with a test account.

1. `/market` at 360x640 (DevTools device toolbar): after the page header and the Filters control comes "Found N products" and the table; no store card appears until below the table. At the bottom there is exactly one store block (labelled "Partner store" while D1 is open), then the site footer.
2. `/prices`: no "Ready to buy Pokémon cards?" card anywhere; one store block below the grid. It shows "CardRinkTCG.ca" as text at the top, no Poké Ball.
3. DevTools Elements on any of the six pages: the promo is `<aside aria-label="Partner store">` (or the step 3a label if D1 was answered) and contains no `<svg>`; no `<footer>` exists inside `<main>`. A product card and the `/market` chart panel say "View on TCGplayer".
4. `/box-calculator`: primary button, focus rings and NAV figures are the same blue as the rest of the site (#2563eb); no gray-tinted neutrals. Signed in, clear the recipe name and press Save/Update: a red inline message appears under the name row and no browser popup opens.
5. A product card with a negative return on `/prices` (preview, real data): the percentage is rose-700 (`--pf-loss-text`, #be123c) next to the rose-600 left stripe (`--pf-loss`, #e11d48), both from the loss palette; neither is the brand red #dc2626 used by the primary buttons nor Tailwind 4's `red-600` (#e7000b) that the card used before WP14. (Text uses the darker `-text` shade for contrast; WP14 set that.)
6. `/privacy`: "Pokéfin" everywhere; the Contact paragraph's link opens `https://github.com/0xDario/Pokefin/issues/new` in a new tab; "contact the operator" jumps to the Contact heading.
7. `/account` (preview, signed in): "Delete Account" opens a centred dialog with focus in the "Type DELETE to confirm" field; the page behind is not clickable and does not scroll; Escape closes it and focus returns to the button; pressing inside the field, dragging and releasing on the dark backdrop does not close it; a plain click on the backdrop does; "Delete account" stays disabled until DELETE is typed. Do not complete the deletion unless it is a throwaway account. In DevTools Network, set "Offline" and press "Export my data": the message reads "We couldn't reach Pokéfin. Check your connection and try again."
8. `/portfolio` (preview, signed in): one "My Portfolio" heading; Import and Add Holding buttons sit right-aligned under it; the trash icon on a holding opens "Delete this holding?" naming the product.
9. Stop sharing a shared recipe on `/box-calculator` (preview): a dialog asks first; no native popup.

## Owner actions

None required before merge or deploy. No migrations, environment variables or data changes.

Optional before merge: answer owner decision D1 (the true CardRinkTCG relationship: owned, paid or unpaid; `01-PRODUCT-DIRECTION.md` section 11) in the PR thread. If you do, step 3a sets the matching label (and `rel="sponsored"` for "paid"). If you do not, the promo keeps "Partner store" and WP24 sets the label when D1 is answered.

Recommended after merge:
1. Privacy contact. The default link opens a new public GitHub issue (`https://github.com/0xDario/Pokefin/issues/new`), which is a working channel but a public one. For GDPR requests a private channel is better: edit `PRIVACY_CONTACT_URL` in `frontend/app/privacy/page.tsx` to `mailto:<your address>`, change the link text to "email the operator" and delete the sentence starting "Issues are public", then bump `LAST_UPDATED` and redeploy. Confirm by opening `/privacy` and clicking the link. If you keep the issue link, keep GitHub issues enabled on the repository.
2. Promo policy. This PR applies the plan's decision (one CardRinkTCG block per page, below the content; the compact banner is removed). If the store relationship needs more placements, reverting step 4 alone restores the banners; follow the pitfalls on storage and placement if you do.
3. "Seller Tools" in the primary nav (F092's IA suggestion) was left unchanged. Decide whether it should move to the footer or be renamed "Shopify Price Compare"; that is a follow-up change to `Header.tsx`.

## Acceptance criteria

- [ ] `grep -rn "<CardRinkPromo" frontend/app --include=*.tsx | grep -v __tests__` lists exactly six `page.tsx` files, one line each; `MarketView.tsx` and `ProductPrices/index.tsx` do not import `CardRinkPromo`.
- [ ] `CardRinkPromo.tsx` renders `<aside aria-label={PROMO_RELATIONSHIP_LABEL}>`, has no `"use client"`, no `sessionStorage`, no `variant` prop, no "Powered by" line and no `PokeballGlyph`/`<svg>`; it shows `STORE_NAME` as text where the glyph was.
- [ ] `app/content/disclosures.ts` exports `STORE_NAME`, `STORE_URL` and `PROMO_RELATIONSHIP_LABEL`; the label is "Partner store" unless the owner answered D1 in this PR, in which case it is the matching `research/trust-seo-brand.md` section 7.2 label (and the promo link has `rel="sponsored noopener noreferrer"` only for "paid").
- [ ] No `.tsx` file under `frontend/app` (outside `__tests__`) contains `\bTCGPlayer\b`, "live price(s)" or "real-time"; the "View on TCGplayer" links and the box-calculator "How it works" text are updated; no code identifier or `.ts` comment was renamed.
- [ ] On `/market` at 360x640 the results count and table header appear before any store content.
- [ ] `ReturnMetrics` uses the same gain/loss classes as `stats/page.tsx` `ReturnCell`.
- [ ] `app/__tests__/uiConventions.test.ts` passes: no `gray-*`, no raw `blue-400..700` outside the two allowlisted files, no `text-green-600`/`text-red-600`, no `alert(`/`confirm(`, no "Pokefin", no "TCGPlayer"/"live price"/"real-time" in `.tsx`, and the promo rules (aside, label constant, no glyph) hold.
- [ ] Account deletion requires typing DELETE in an accessible dialog; failures show fixed text inside the dialog; no raw server or browser error text can appear in the export or delete messages.
- [ ] Holding deletion and "Stop sharing" confirm through `ConfirmDialog`; a failed holding delete shows an inline message, not `alert()`.
- [ ] Box Calculator validation errors render inline with `role="alert"`; the Save button's failure label is "Save failed".
- [ ] `/stats` empty state and the compare market-data error contain no "Supabase" or "migration".
- [ ] `/portfolio` has exactly one `<h1>`.
- [ ] `/privacy` Contact section has `id="contact"` and a working link (`PRIVACY_CONTACT_URL`); "contact the operator" links to `#contact`.
- [ ] `ConfirmDialog` tests cover Escape (keydown and `cancel`), backdrop press-and-release, a browser-forced close (dismiss when idle, reopen when busy), busy blocking, typed confirmation and focus return.
- [ ] "Pokéfin"/"Pokémon" in every changed UI string; `import.ts` and data fixtures still say "Pokemon".
- [ ] No three-dot ellipsis remains in UI strings (`grep -rnE '[A-Za-z]\.\.\.["<]' frontend/app --include=*.tsx` is empty).
- [ ] `tsc`, the full jest suite and `pnpm build:stub` pass; lint errors do not increase.

## Rollback

`git revert <merge commit>` restores everything; there are no migrations, environment variables or data changes. Partial rollbacks are safe per area: reverting the `CardRinkPromo.tsx` and step 4 hunks restores the banners; reverting `ConfirmDialog` requires reverting its three users (account, portfolio, box calculator) in the same commit, and then `uiConventions.test.ts` must be reverted too or it will fail on the returning `confirm(` calls.

## Commit and PR

Commit message:

```
fix(ui): one palette, one promo per page, user-facing copy and dialogs

- ReturnMetrics verified on WP14's --pf-gain-text/--pf-loss-text; BoxCalculator, privacy, error
  pages, ScrollToTop, HoldingsTable, import modal and spinners move from
  gray/blue to slate and the --pf-pokeblue tokens (review F091)
- CardRinkPromo is a single server-rendered <aside>, once per page after
  the content; the /prices and /market banners are gone (F097)
- ConfirmDialog replaces window.confirm/alert for account deletion
  (typed DELETE), holding deletion and stop-sharing; box-calculator
  validation is inline; account/compare/stats/search errors are fixed
  strings; one portfolio heading; Pokéfin/Pokémon spelling; privacy
  contact link; one ellipsis style (F103)
- Promo label comes from app/content/disclosures.ts (PROMO_RELATIONSHIP_LABEL,
  shared with WP24); the store name replaces the Poke Ball glyph; the
  source is spelled TCGplayer and no copy claims live or real-time prices
  (Track 2)
- uiConventions guard test keeps tokens, promo placement and copy rules
```

PR title: `WP15: visual consistency, promo placement and user-facing copy`

PR body summary: link `audits/remediation/WP15-visual-polish-and-copy.md`; list F091 (cluster F091, F099; slate-400 contrast is WP14), F097 (cluster F092, F097, F101), F103. Describe the visible changes per page (market table no longer below an ad, one partner block per page, consistent blue and rose, dialogs instead of popups, typed DELETE for account deletion, single portfolio heading). State that the `<footer>` to `<aside>` change is for honest semantics, not landmark de-duplication (F097 verifier), and that `rel="sponsored"` was deliberately not added (unless D1 was answered "paid"). State the D1 status: "D1 open: promo label stays 'Partner store'" or the answer used in step 3a. Note for WP24: `app/content/disclosures.ts` now exists and must be extended, keeping `PROMO_RELATIONSHIP_LABEL`, `STORE_NAME` and `STORE_URL`; note for WP19: the moved chart-panel link must say "View on TCGplayer". Note the deviation: `ConfirmDialog` is self-contained rather than built on WP14's `Dialog` (it blocks dismissal while busy, has no X button and supports typed confirmation), as WP14's spec anticipates, and a follow-up may consolidate them. Paste the Verification output. Under "Noticed, out of scope": "Seller Tools" in the primary nav (F092 IA suggestion), no confirmation on the saved-recipe trash button, "Found N products" pluralisation.
