# WP03: Visible UI hotfixes

- **Findings covered**
  - F022 (full, cluster members F008, F022): the mobile header menu cannot be closed with its own X button (the document `mousedown` handler closes it, the button's `click` re-opens it); neither header menu closes on Escape; neither toggle exposes `aria-expanded`; the hamburger's focus ring is removed and its screen-reader label always says "Open main menu".
  - F032 (full, cluster members F032, F090 toast part only): a fixed blue "Loading price history..." toast paints over the right side of the sticky header on `/prices` and flickers on and off for the whole scroll.
  - F151 (partial, cluster members F151, F123): only the user-facing copy. Six strings promise "refreshed hourly" while the scraper updates each product about once a day. Revalidation, cache TTLs and the scrape webhook are WP11.
- **Priority rationale**: these are the three most visible defects on the two busiest surfaces (every page's header on phones, and the `/prices` catalog), each is a small contained edit, and they are independent of the auth and data work.
- **Effort**: S, about 2 hours including the new Header test.
- **Depends on**: WP00 (for `pnpm build:stub` in Verification). If WP00 has not merged, skip the `build:stub` checks and say so in the PR body; nothing else in this package needs WP00.
- **Unblocks**: WP08 (which reworks `ProductPrices/index.tsx` and assumes the toast is gone), WP14 (the header items of F030/F094 are done here, so WP14 covers only the Portfolio modals and form labels), WP15.
- **Suggested branch name**: `remediation/wp03-ui-hotfixes`
- **Risk level**: low. Presentational and event-handling changes in three client components plus copy edits; no data, auth, API or schema change.

## Why

On every phone the hamburger turns into an X that does nothing when tapped: the menu flickers and stays open, and the only way out is to tap the page behind it or pick a link. Keyboard users get no visible focus on that button, cannot close either header menu with Escape, and screen readers are never told whether a menu is open. On `/prices`, every card that scrolls into view starts a history fetch, and while any fetch is in flight a bright blue box appears at the top right of the screen, covering the Sign Up button or account menu (desktop) and the hamburger (mobile); it pops in and out for the entire scroll even though each card already shows its own sparkline skeleton. Finally, the site tells users and search engines in six places that prices are "refreshed hourly", but the scraper prices each product at most once per 23 hours, so a user comparing against TCGPlayer at 2 pm is looking at a price from early morning. After this PR the X closes the menu, Escape works and returns focus, the toggles announce their state, the toast is gone, and the copy says "updated daily".

## Before you start

Read these files fully:

- `frontend/app/components/Header.tsx` (310 lines). Key spots: `:53-64` document `mousedown` listener (the mobile check is `:58`); `:120-139` desktop avatar button inside `dropdownRef`; `:141-142` desktop dropdown panel; `:203-219` mobile toggle button (outside any ref); `:224-228` mobile panel carrying `ref={mobileMenuRef}`.
- `frontend/app/components/ProductPrices/index.tsx` (346 lines). Key spots: `:96-103` destructures `historyLoading` from `useProductData`; `:235-244` the toast.
- `frontend/app/components/ProductPrices/hooks/useProductData.ts:3` (imports `useMemo`), `:178` (the only `useMemo` in the file, computing `historyLoading`), `:180-187` (return object).
- `frontend/app/components/ProductPrices/cards/ProductCard.tsx:19,60` (a separate per-card `historyLoading` prop; leave it alone, see Pitfalls).
- `frontend/app/components/MarketView/MiniSparkline.tsx:20-41` (`SparklineSkeleton`, the per-card loading indicator that stays).
- `frontend/app/layout.tsx:26-36`, `frontend/app/page.tsx:205-209`, `frontend/app/prices/page.tsx:26-28`, `frontend/app/components/Footer.tsx:88-90` and `:111`.
- `main.py:1055-1084` (why `price_update_interval_hours = 23`) and `main.py:1528-1538` (4-hourly UTC schedule). Together they mean each product's price changes at most once per day.
- `frontend/jest.config.js` and `frontend/jest.setup.ts` (jsdom default, `@testing-library/jest-dom` loaded).

Confirm the starting state (run from `frontend/`):

```bash
grep -n 'document.addEventListener("mousedown"' app/components/Header.tsx   # expect :62
grep -n 'ref={mobileMenuRef}' app/components/Header.tsx                     # expect :227 (panel only)
grep -c 'aria-expanded' app/components/Header.tsx                           # expect 0
grep -c 'Escape' app/components/Header.tsx                                  # expect 0
grep -n 'focus:outline-none p-2' app/components/Header.tsx                  # expect :206
grep -rn 'Loading price history' app                                        # expect 2: ProductPrices/index.tsx:242 (the toast) and MarketView/MarketView.tsx:569 (an inline expanded-row placeholder on /market; it stays)
grep -rn 'historyLoading' app --include=*.ts --include=*.tsx                # expect 10 hits: useProductData.ts:178,184; index.tsx:100,236,256,288,323; ProductCard.tsx:19,60; RecentlyReleased.tsx:55
grep -rn 'refreshed hourly' app                                             # expect exactly 6: Footer.tsx:89,111; page.tsx:207; prices/page.tsx:27; layout.tsx:29,33
ls app/components/__tests__/Header.test.tsx 2>&1                            # expect "No such file"
pnpm exec eslint app/components/Header.tsx app/components/ProductPrices/index.tsx app/components/ProductPrices/hooks/useProductData.ts app/components/Footer.tsx app/layout.tsx app/page.tsx app/prices/page.tsx   # expect no output (clean baseline)
```

Assumptions to check:

- `useAuth()` still returns `{ user, profile, loading, signOut, ... }` (`app/context/AuthContext.tsx:13-22`). The plan runs WP03 before WP04, so this should hold. If WP04 has already landed and the Header reads a `sessionStatus` field, keep the Header's auth-slot rendering exactly as you find it, and add `sessionStatus` to the test's `MockAuth` type and `mockAuth` objects with WP04's literal values: `"anonymous"` in the top-level `beforeEach` and `"authenticated"` in the "Header user dropdown" `beforeEach` (WP04 step 6d uses exactly these). Keep `loading: false` in the mock either way.
- WP02 may have added `prefetch={false}` to the four `/auth/*` Links in `Header.tsx`. If present, keep it. The test's `next/link` mock below already swallows a `prefetch` prop.
- Only one component consumes the hook-level `historyLoading` (`ProductPrices/index.tsx:100`). `MarketView.tsx:207-212`, `RecentlyReleased.tsx:24-25` and `MarketView/__tests__/useProductData.test.tsx` do not read it. Re-run the `historyLoading` grep above; if any other file destructures `historyLoading` from `useProductData`, do not remove it from the hook (skip step 4) and note that in the PR.

## Implementation steps

Do step 1 before the rest of step 2 so you see the new test fail against the current Header behaviour. Steps 3 to 6 are independent of each other.

### 1. Add the Header test first: `frontend/app/components/__tests__/Header.test.tsx` (new file)

Write the full test file from the Tests section below. The test finds the panels by id, so first apply only steps 2c and 2e (add `id="user-menu"` and `id="mobile-nav"`); those two attributes change no behaviour. Then run it:

```bash
pnpm test --ci app/components/__tests__/Header.test.tsx
```

Expected against the unfixed Header (ids added, nothing else): exactly 4 of the 9 cases fail: "opens from the hamburger and exposes its state" (no `aria-expanded`), "closes when the X is tapped (mousedown then click)", "closes on Escape and returns focus to the toggle", and "toggles with aria-expanded and closes on Escape with focus restored". The other 5 pass already (keyboard click-only close, non-Escape key, outside tap, link choice, dropdown re-tap): they guard existing behaviour. If "closes when the X is tapped" passes against the unfixed code, your `tap` helper is not reproducing the browser's mousedown, flush, click sequence: re-check that each dispatch is in its own `act(async ...)` call. If it still passes, switch the helper to the F008 verifier's exact sequence (native mousedown outside `act`, a macrotask yield, then the click):

```tsx
async function tap(element: Element) {
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}
```

(React may log a "not wrapped in act(...)" warning for the mousedown; that is expected with this variant and does not fail the test.) Do not continue until "closes when the X is tapped" fails because the panel is still rendered after the second tap.

### 2. Fix the header menus: `frontend/app/components/Header.tsx`

All line numbers in 2a to 2e refer to the ORIGINAL file (commit a188fea). Step 1 already applied 2c and 2e (the two ids); do not add them twice. Apply the remaining edits bottom-up in this order, 2d, then 2b, then 2a, so earlier edits do not shift the lines of later ones; or locate each block by its quoted text instead of its number.

2a. Refs, the click-outside guard and the Escape handler. Replace lines 44-64 (from `export default function Header() {` through the end of the existing `useEffect`) with:

```tsx
export default function Header() {
  const { user, profile, loading, signOut } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setDropdownOpen(false);
      }
      // The hamburger lives outside the panel. Without this guard a tap on the
      // X closes the menu on mousedown and the button's click then re-opens it.
      if (mobileMenuButtonRef.current?.contains(target)) return;
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(target)) {
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Escape closes whichever menu is open and hands focus back to its trigger,
  // so keyboard users are not left on <body> after the panel unmounts.
  useEffect(() => {
    if (!mobileMenuOpen && !dropdownOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (mobileMenuOpen) {
        setMobileMenuOpen(false);
        mobileMenuButtonRef.current?.focus();
      }
      if (dropdownOpen) {
        setDropdownOpen(false);
        dropdownButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen, dropdownOpen]);
```

Notes: the `mousedown` effect keeps its empty dependency array (it only calls setters and reads refs). Focusing a trigger that is `display: none` at the current breakpoint (the avatar on mobile, the hamburger on desktop) is a harmless no-op, so the order of the two `if` blocks does not matter. Do not call `preventDefault` or `stopPropagation` on the Escape event.

2b. Desktop avatar trigger. Replace the opening tag at lines 121-124:

```tsx
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2.5 text-sm font-semibold text-slate-700 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeball)] focus:ring-offset-2 rounded-full px-1.5 py-1.5"
                >
```

with:

```tsx
                <button
                  ref={dropdownButtonRef}
                  type="button"
                  onClick={() => setDropdownOpen((open) => !open)}
                  aria-expanded={dropdownOpen}
                  aria-controls={dropdownOpen ? "user-menu" : undefined}
                  className="flex items-center gap-2.5 text-sm font-semibold text-slate-700 hover:text-slate-900 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--pf-pokeball)] focus-visible:ring-offset-2 rounded-full px-1.5 py-1.5"
                >
```

(`focus:ring` becomes `focus-visible:ring` so the ring shows for keyboard focus but not after every mouse click, matching the hamburger below. `focus:outline-none` becomes `focus:outline-hidden`: in Tailwind 4 (4.3.3 here) `outline-none` sets `outline-style: none` everywhere, while `outline-hidden` looks identical normally but keeps a 2px outline in Windows High Contrast / forced-colors mode, where box-shadow rings such as `ring-2` are not painted. Without it, forced-colors users would still see no focus indicator.) On the chevron `<svg>` inside this button (line 129) add `aria-hidden="true"` as its first attribute.

2c. Desktop dropdown panel. On the panel `<div>` at line 142 (`className="absolute right-0 mt-2 w-60 ..."`) add `id="user-menu"` as the first attribute. Change nothing else in the panel.

2d. Mobile toggle. Replace lines 204-218 (the whole `<button>...</button>` inside `<div className="flex md:hidden">`) with:

```tsx
            <button
              ref={mobileMenuButtonRef}
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-expanded={mobileMenuOpen}
              aria-controls={mobileMenuOpen ? "mobile-nav" : undefined}
              className="rounded-md p-2 text-slate-700 hover:text-slate-900 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--pf-pokeball)] focus-visible:ring-offset-2"
            >
              <span className="sr-only">
                {mobileMenuOpen ? "Close main menu" : "Open main menu"}
              </span>
              {mobileMenuOpen ? (
                <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
```

2e. Mobile panel. On the panel `<div>` at lines 225-228 add `id="mobile-nav"` next to the existing `ref={mobileMenuRef}`:

```tsx
        <div
          id="mobile-nav"
          className="md:hidden border-t border-slate-200 bg-white shadow-lg absolute w-full left-0 z-40"
          ref={mobileMenuRef}
        >
```

Do not touch anything else in Header.tsx: not the `loading ? ...` auth-slot branches at `:117-118` and `:250-254` (WP04 owns them, finding F124), not the link lists, not `handleSignOut`.

Re-run `pnpm test --ci app/components/__tests__/Header.test.tsx`: all cases pass.

### 3. Remove the global toast: `frontend/app/components/ProductPrices/index.tsx`

3a. Delete lines 235-245 entirely: the `{/* History Loading Indicator */}` comment, the `{historyLoading && !loading && ( <div className="fixed top-4 right-4 ..."> ... )}` block (through its closing `)}` at :244), and the blank line at :245 after it. The result must be: line 233 `{loading && <div className="text-slate-600">Loading products...</div>}`, line 234 blank, line 235 `{/* Flat View */}`. Exactly one blank line between them, not two.

3b. In the `useProductData` destructure at lines 96-103, delete the `historyLoading,` line. Result:

```tsx
  const {
    products,
    priceHistory,
    loading,
    loadingProductIds,
    ensureHistoryLoaded,
  } = useProductData({ initialProducts });
```

Keep `loadingProductIds` (still passed per card at `:256`, `:288`, `:323`). Do not add any replacement global indicator (no progress bar, no `aria-live` region): per-card `SparklineSkeleton` already shows loading in place.

### 4. Drop the now-unused hook field: `frontend/app/components/ProductPrices/hooks/useProductData.ts`

Only do this if the Before-you-start grep confirmed `index.tsx` was the sole reader.

4a. Delete line 178: `const historyLoading = useMemo(() => loadingProductIds.length > 0, [loadingProductIds]);` and the blank line after it.

4b. Delete `historyLoading,` from the return object (line 184).

4c. `useMemo` is now unused in this file (line 178 was its only call). Change line 3 to:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
```

Run `grep -n useMemo app/components/ProductPrices/hooks/useProductData.ts` first; if it still finds a call, keep the import.

### 5. Correct the refresh-cadence copy (six strings, five files)

The wording is "updated daily" everywhere. Rationale: `main.py:1082` only re-prices a product whose last update is more than 23 hours old, and the scheduler runs every 4 hours (`main.py:1537`), so any given price changes about once a day. "Several times a day" would be wrong for any single product.

5a. `frontend/app/layout.tsx:29` and `:33` (the `description` and `openGraph.description` strings, currently identical). Replace both string literals with:

```ts
      "Get up-to-date Pokémon sealed product prices, updated daily from TCGPlayer. Track the latest market trends and values for Pokémon TCG sealed items.",
```

(Only `refreshed hourly` becomes `updated daily`; keep each line's existing indentation. WP13 owns any wider metadata rewrite.)

5b. `frontend/app/page.tsx:205-209`. Replace the whole `<p className="mt-2 text-slate-600">` element with:

```tsx
          <p className="mt-2 text-slate-600">
            Track market prices, returns, and trends across{" "}
            {products.length} sealed Pokémon TCG products, with prices
            updated daily from TCGPlayer.
          </p>
```

(This also replaces the dash separator with a comma. Keep "updated daily" on one source line: the Verification grep counts it.)

5c. `frontend/app/prices/page.tsx:27`. Replace the line with:

```tsx
          {products.length} products tracked · prices updated daily from TCGPlayer.
```

5d. `frontend/app/components/Footer.tsx:89` (inside the About `<p className="text-sm text-slate-600 leading-relaxed">`). Replace the text line with:

```tsx
              Sealed Pokémon TCG market data, with prices updated daily from TCGPlayer.
```

5e. `frontend/app/components/Footer.tsx:111`. Replace with:

```tsx
            <span>Prices updated daily from TCGPlayer</span>
```

After step 5, `grep -rni 'hourly' app --include=*.ts --include=*.tsx | grep -v __tests__` must show exactly one line: the code comment at `app/components/ProductPrices/hooks/useVolumeMetrics.ts:56` (not user-facing; leave it).

### 6. Run the full verification (next section) and open the PR.

## Pitfalls: do not do this

- Do not "fix" the X by only switching the toggle to a functional updater (`setMobileMenuOpen((open) => !open)`). The `mousedown` handler still closes the menu first, and the click then flips `false` to `true`. The guard on `mobileMenuButtonRef` is the fix; the functional updater is hygiene.
- Do not move `ref={mobileMenuRef}` onto a wrapper around both the button and the panel. The button sits inside the `h-16` flex row and the panel is a sibling rendered after the header row with `absolute w-full left-0`; a shared wrapper would be the whole `<header>`, which would stop taps on the logo or desktop nav from closing the menu, and moving the panel into the button's `<div>` would change its positioning context. The verifier's correction (F008 verdict) specifies the separate toggle ref plus an early return, which is what step 2a does.
- Do not assert only with a single `fireEvent.click(toggle)` for the close case. That skips the `mousedown` and passes against the buggy code. The F008 verifier reproduced the bug only with a mousedown, a flush, then a click; the `tap` helper emulates that. Keep the keyboard case (click only) as a separate test.
- Do not add `aria-haspopup="menu"`, `role="menu"` or `role="menuitem"` to either menu. Those promise the ARIA menu pattern (arrow-key navigation, roving tabindex), which these link lists do not implement; screen readers would then announce behaviour that does not exist. Both menus are disclosure widgets: `aria-expanded` plus `aria-controls` is the correct pattern. (This deliberately narrows the finder's "`aria-haspopup="menu"`" suggestion.)
- Do not point `aria-controls` at an id that is not in the DOM while the panel is closed. Both panels are conditionally rendered, so the attribute is set only while open.
- Do not change the auth-slot skeleton (`loading ?` branches) or the `useAuth` contract. WP04 owns F124 and the session shape.
- Do not remove `loadingProductIds`, the per-card `historyLoading` prop on `ProductCard` (`ProductCard.tsx:19,60`) or the `historyLoading={loadingProductIds.includes(product.id)}` props at `index.tsx:256,288,323` and `RecentlyReleased.tsx:55`. The prop is currently unused inside `ProductCard`, but per-card loading state is WP09's (F070) and WP19's (F125) territory; removing it here causes merge conflicts for no user benefit.
- Do not replace the toast with another global indicator in this PR. The F032 verifier's correction is "remove the global toast; per-card sparkline skeletons already communicate loading". A thin progress bar (below the header, 300 ms show delay) is only acceptable if a later package asks for it.
- Do not write "several times a day", "every 4 hours" or "real-time" in the copy. Each product is re-priced at most once per 23 hours (`main.py:1082`); only "daily" is true for a given price. Do not change any `revalidate` value, add `revalidateTag`, or touch `serverMarketData.ts` / `clientMarketData.ts`: that is WP11 (rest of F151, F123).
- Do not change code comments that mention hours (`useVolumeMetrics.ts:56` "hourly", `PriceChart.tsx:200` "every hour", `clientMarketData.ts:42`); they describe code, not user copy.
- Do not touch the "Loading price history..." text at `MarketView/MarketView.tsx:569`. It is an inline placeholder inside an expanded table row on `/market`, not a fixed toast, and it is outside F032.
- Do not use `focus:outline-none` on the two toggles you edit; use `focus:outline-hidden` (see 2b). Do not sweep `outline-none` elsewhere in the app in this PR.
- Do not use `@testing-library/user-event` in the new test. It is not a dependency (`package.json` has only `@testing-library/dom`, `/jest-dom`, `/react`), and adding a dependency is out of scope.

## Tests

### New: `frontend/app/components/__tests__/Header.test.tsx`

Runs under the default jsdom environment (no docblock needed). It mocks `next/navigation` (no App Router context in jsdom), `next/link` (a plain anchor that prevents jsdom's "navigation not implemented" error) and `AuthContext` (so no fetch to `/api/auth/me`). Variables referenced inside `jest.mock` factories must start with `mock` (Jest hoisting rule).

Cases it must cover (9 `it` blocks; item 8 is two of them):

1. Hamburger opens the panel; before: `aria-expanded="false"`, accessible name "Open main menu", no `#mobile-nav`; after: panel present, `aria-expanded="true"`, `aria-controls="mobile-nav"`, name "Close main menu".
2. Tapping the X (mousedown, flush, click) closes the panel. This is the F022 regression test.
3. Keyboard activation of the X (click only, no mousedown) closes the panel.
4. Escape with focus inside the panel closes it and moves focus to the hamburger.
5. A mousedown outside the header closes the panel (existing behaviour kept).
6. A non-Escape key (`Enter` on a panel link's keydown) does not close the panel.
7. Selecting a panel link closes the panel (existing behaviour kept).
8. Signed-in desktop dropdown: trigger has `aria-expanded="false"`; tap opens `#user-menu` and sets `aria-expanded="true"` with `aria-controls="user-menu"`; Escape from inside closes it and focuses the trigger; tapping the trigger again closes it.

```tsx
/**
 * Header menus (F022): the mobile menu must close from its own X button,
 * Escape must close either menu and return focus to its trigger, and both
 * toggles must expose their state to assistive technology.
 */
import type { AnchorHTMLAttributes, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import Header from "../Header";

jest.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
  }),
}));

// Plain anchor: no router context needed, and preventDefault stops jsdom
// from attempting (and logging) a real navigation when a link is clicked.
jest.mock("next/link", () => {
  const { createElement } = jest.requireActual<typeof import("react")>("react");
  type MockLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    prefetch?: boolean | null;
    children?: ReactNode;
  };
  function MockLink({ href, prefetch, onClick, children, ...rest }: MockLinkProps) {
    void prefetch;
    return createElement(
      "a",
      {
        ...rest,
        href,
        onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => {
          event.preventDefault();
          onClick?.(event);
        },
      },
      children
    );
  }
  return { __esModule: true, default: MockLink };
});

type MockAuth = {
  user: { id: string; email: string } | null;
  profile: { username: string } | null;
  loading: boolean;
  signOut: jest.Mock;
};

let mockAuth: MockAuth;

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

beforeEach(() => {
  mockAuth = { user: null, profile: null, loading: false, signOut: jest.fn() };
});

// A real tap or mouse click dispatches mousedown, then click, and React
// flushes the discrete mousedown update in the microtask checkpoint between
// them. Each dispatch in its own act() reproduces that gap. A single
// fireEvent.click would skip mousedown and hide the bug.
async function tap(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

const mobileToggle = () => screen.getByRole("button", { name: /main menu/i });
const mobilePanel = () => document.getElementById("mobile-nav");

describe("Header mobile menu", () => {
  it("opens from the hamburger and exposes its state", async () => {
    render(<Header />);
    const toggle = mobileToggle();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAccessibleName("Open main menu");
    expect(mobilePanel()).toBeNull();

    await tap(toggle);

    expect(mobilePanel()).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "mobile-nav");
    expect(toggle).toHaveAccessibleName("Close main menu");
  });

  it("closes when the X is tapped (mousedown then click)", async () => {
    render(<Header />);
    const toggle = mobileToggle();
    await tap(toggle);
    expect(mobilePanel()).not.toBeNull();

    await tap(toggle);

    expect(mobilePanel()).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on keyboard activation of the X (click only)", () => {
    render(<Header />);
    const toggle = mobileToggle();
    fireEvent.click(toggle);
    expect(mobilePanel()).not.toBeNull();
    fireEvent.click(toggle);
    expect(mobilePanel()).toBeNull();
  });

  it("closes on Escape and returns focus to the toggle", async () => {
    render(<Header />);
    const toggle = mobileToggle();
    await tap(toggle);
    const link = within(mobilePanel()!).getByRole("link", { name: "Prices" });
    link.focus();
    expect(link).toHaveFocus();

    fireEvent.keyDown(link, { key: "Escape" });

    expect(mobilePanel()).toBeNull();
    expect(toggle).toHaveFocus();
  });

  it("ignores keys other than Escape", async () => {
    render(<Header />);
    await tap(mobileToggle());
    const link = within(mobilePanel()!).getByRole("link", { name: "Prices" });
    fireEvent.keyDown(link, { key: "Enter" });
    expect(mobilePanel()).not.toBeNull();
  });

  it("closes on a tap outside the header", async () => {
    render(<Header />);
    await tap(mobileToggle());
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(mobilePanel()).toBeNull();
  });

  it("closes when a link in the panel is chosen", async () => {
    render(<Header />);
    await tap(mobileToggle());
    fireEvent.click(within(mobilePanel()!).getByRole("link", { name: "Prices" }));
    expect(mobilePanel()).toBeNull();
  });
});

describe("Header user dropdown", () => {
  beforeEach(() => {
    mockAuth = {
      ...mockAuth,
      user: { id: "u1", email: "ash@example.com" },
      profile: { username: "ash" },
    };
  });

  const userMenu = () => document.getElementById("user-menu");

  it("toggles with aria-expanded and closes on Escape with focus restored", async () => {
    render(<Header />);
    const trigger = screen.getByRole("button", { name: /ash/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await tap(trigger);
    expect(userMenu()).not.toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", "user-menu");

    const account = within(userMenu()!).getByRole("link", { name: "Account Settings" });
    account.focus();
    fireEvent.keyDown(account, { key: "Escape" });

    expect(userMenu()).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes when the trigger is tapped again", async () => {
    render(<Header />);
    const trigger = screen.getByRole("button", { name: /ash/i });
    await tap(trigger);
    await tap(trigger);
    expect(userMenu()).toBeNull();
  });
});
```

If `screen.getByRole("button", { name: /ash/i })` matches more than one element (it should not: the mobile panel is closed and no other button contains "ash"), switch to `screen.getByRole("button", { expanded: false, name: /ash/i })`.

Type-only imports used inside the `jest.mock` factories are erased at compile time, so they do not trip Jest's "out-of-scope variable" hoisting check.

### Not added

No test for the toast removal or the copy: both are verified by grep (Verification) and by `build:stub` output. A render test of `ProductPrices` would need to mock `useSearchParams`, three data hooks and IntersectionObserver for a deletion; it is not worth it here. Existing `app/components/MarketView/__tests__/useProductData.test.tsx` must still pass unchanged (it does not read `historyLoading`).

## Verification

Run from `frontend/`:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
# expect: exit 0, no output

pnpm exec eslint app/components/Header.tsx app/components/__tests__/Header.test.tsx app/components/ProductPrices/index.tsx app/components/ProductPrices/hooks/useProductData.ts app/components/Footer.tsx app/layout.tsx app/page.tsx app/prices/page.tsx
# expect: no output (0 errors, 0 warnings; baseline for these files was clean)

pnpm test --ci app/components/__tests__/Header.test.tsx app/components/MarketView/__tests__/useProductData.test.tsx
# expect: 2 suites passed, all Header cases green

pnpm test --ci
# expect: every suite passes (same count as before plus 1 suite)

grep -rn 'refreshed hourly' app                         # expect: no output
grep -rn 'updated daily' app | wc -l                    # expect: 6
grep -rn 'Loading price history' app/components/ProductPrices   # expect: no output
grep -rn 'Loading price history' app                    # expect exactly 1 line: MarketView/MarketView.tsx:569 (stays)
grep -rn 'historyLoading' app --include=*.ts --include=*.tsx
# expect exactly: ProductCard.tsx:19,60; index.tsx (3 per-card props); RecentlyReleased.tsx:55. Nothing in useProductData.ts.
grep -c 'aria-expanded' app/components/Header.tsx       # expect: 2
grep -c 'outline-hidden' app/components/Header.tsx      # expect: 2
grep -c 'focus:outline-none' app/components/Header.tsx  # expect: 0

pnpm build:stub                                         # requires WP00
# expect: exit 0
grep -rl 'refreshed hourly' .next/server/app            # expect: no output
grep -l 'updated daily' .next/server/app/index.html .next/server/app/prices.html
# expect: both files listed (meta description plus hero / subheading copy)
```

`pnpm run lint` over the whole project still reports the pre-existing errors (16 at the time of the review); this PR must not add any. No Python changes, so no pytest run is needed.

Manual checks (use `pnpm dev` with a real `.env.local` if you have one, otherwise the Vercel preview URL posted on the PR; the WP00 stub works for the header checks but shows zero products, so it cannot show the toast):

1. Mobile menu, pointer: Chrome DevTools, device toolbar, iPhone 12 Pro (390 px wide). Tap the hamburger: the panel opens and the icon becomes an X. Tap the X: the panel closes on the first tap and stays closed. Correct means no flicker and no second tap needed.
2. Mobile menu, keyboard: same viewport, reload, press Tab until the hamburger is focused. A red ring is visible around it. Press Enter: the panel opens. Press Tab once or twice to reach a link, then Escape: the panel closes and the red ring is back on the hamburger.
3. Screen reader label: with the panel open, inspect the button in DevTools, Accessibility pane: name "Close main menu", "Expanded: true". Closed: "Open main menu", "Expanded: false".
4. Desktop dropdown (signed in, so this needs a real `.env.local` or the preview URL; window 1280 px wide): click the avatar with the mouse: the menu opens and the avatar shows no ring. Press Escape: the menu closes, focus returns to the avatar, and the red ring appears on it (Escape is a keyboard interaction, so the programmatic focus matches `:focus-visible`; this is correct). Pressing Escape again does nothing.
5. `/prices` with real data: scroll the full catalog at desktop and at 390 px. No blue box ever appears at the top right; the Sign Up button or avatar and the hamburger stay visible and clickable the whole time. Cards still show the grey pulsing sparkline skeleton, then their sparkline.
6. Copy: the footer of any page reads "Sealed Pokémon TCG market data, with prices updated daily from TCGPlayer." and "Prices updated daily from TCGPlayer"; `/` hero and `/prices` subheading say "updated daily"; View Source on `/` shows `updated daily` in both `<meta name="description">` and `<meta property="og:description">`.

## Owner actions

None.

## Acceptance criteria

- [ ] On a 390 px viewport, one tap on the X closes the mobile menu.
- [ ] Escape closes the mobile menu and the desktop user dropdown, and focus lands on the button that opened it.
- [ ] Both toggles carry `aria-expanded` that matches the open state and `aria-controls` pointing at the open panel's id (`mobile-nav`, `user-menu`).
- [ ] The hamburger's accessible name is "Open main menu" when closed and "Close main menu" when open.
- [ ] The hamburger shows a visible focus ring when focused by keyboard, and both toggles use `focus:outline-hidden` instead of `focus:outline-none`.
- [ ] No `aria-haspopup`, `role="menu"` or `role="menuitem"` was added.
- [ ] `grep -rn 'Loading price history' frontend/app/components/ProductPrices` returns nothing (the only remaining hit in `frontend/app` is `MarketView.tsx:569`, which stays), and no fixed-position element appears over the header while scrolling `/prices`.
- [ ] `useProductData` no longer returns `historyLoading`; `useMemo` is no longer imported there; `loadingProductIds` and the per-card `historyLoading` props are unchanged.
- [ ] `grep -rn 'refreshed hourly' frontend/app` returns nothing and `grep -rn 'updated daily' frontend/app` returns exactly 6 lines.
- [ ] `app/components/__tests__/Header.test.tsx` exists, passes, and its "closes when the X is tapped" case fails if the `mobileMenuButtonRef` guard is removed.
- [ ] `tsc --noEmit`, eslint on the changed files, the full Jest suite and `pnpm build:stub` all pass.
- [ ] No changes to AuthContext, the auth-slot skeleton, cache TTLs, `serverMarketData.ts`, `clientMarketData.ts` or `ProductCard.tsx`.

## Rollback

Revert the merge commit (`git revert -m 1 <merge-sha>` on master, or the single squash commit with `git revert <sha>`) and let Vercel redeploy. No migrations, env vars or data are involved, so the revert is complete on its own. Reverting restores the toast, the unclosable X and the "hourly" copy together; if only one part misbehaves, prefer a forward fix to that file.

## Commit and PR

Commit message:

```text
fix(ui): closable mobile menu, drop /prices loading toast, "updated daily" copy

- Header: the hamburger's own mousedown no longer closes the menu before
  its click re-opens it, so the X closes on one tap (F022/F008). Escape
  closes the mobile menu and the user dropdown and returns focus to the
  trigger. Both toggles expose aria-expanded/aria-controls, the
  hamburger's sr-only label follows its state, and it has a
  focus-visible ring again.
- ProductPrices: remove the fixed "Loading price history..." toast that
  covered the header's account controls while scrolling (F032/F090);
  per-card sparkline skeletons remain. Drop the now-unused hook-level
  historyLoading from useProductData.
- Copy: "refreshed hourly" -> "updated daily" in the meta description,
  OpenGraph description, home hero, /prices subheading and footer (x2).
  main.py re-prices each product at most once per 23 h (F151, copy only).
- Add app/components/__tests__/Header.test.tsx.
```

PR title: `fix(ui): closable mobile menu, remove /prices loading toast, accurate refresh copy (WP03)`

PR body summary:

- What: WP03 of the remediation plan (`audits/remediation/WP03-ui-hotfixes.md`). Fixes F022 (with F008), F032 (with the toast part of F090), and the copy part of F151.
- User-visible: the mobile X closes the menu; Escape works on both header menus; no blue toast over the header on `/prices`; copy says prices are updated daily.
- Not in this PR: revalidation and cache TTLs (WP11), auth-slot skeleton (WP04), dialog and label accessibility beyond the header (WP14), per-card loading state (WP09/WP19). F090 also mentions a bare "Found 0 products" empty state and native `alert()`/`confirm()` dialogs; those are outside the F032 cluster's verified scope and are not changed here, so list them under "Noticed, out of scope" in the PR body.
- Verification: paste the output of every command in the spec's Verification section and tick the manual checks.
- Owner actions: none.
