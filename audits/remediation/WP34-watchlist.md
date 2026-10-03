# WP34: Watchlist

- **Goal**: a signed-in collector watches any product with one tap from its product page (or a Screener row), sees every watched product in one list with price and as-of stamp, 1D, 7D and 30D change, distance from the 52-week high, x MSRP and days of supply, and sees the biggest 7-day movers among their watched products on the home page. A signed-out visitor who taps Watch signs in and finds the product already watched.
- **Why now / value**: a watchlist is the largest competitive gap and the retention loop of the whole product (01-PRODUCT-DIRECTION.md §5 item 2, §4.2 steps 5 and 6). WP31 left a `watch` slot in the product page actions and WP32 left the `children` slot of the "Your Pokéfin" home island; WP35's daily alert digest needs this table and this page to exist.
- **Effort**: L, 12 to 14 hours (migration and its two Python test modules 2.5 h, model, repo, route and browser client with tests 3 h, shared membership store and `WatchButton` with tests 2 h, sign-in round trip 1 h, watchlist page, tabs and home movers with tests 3 h, lint lists, budgets, privacy copy, verification and PR 1.5 h). The plan table says M, 10 to 12 h; the shared store (one request for 300 Screener rows) and the sign-in round trip account for the difference.
- **Depends on**: WP38 (migration 0036 put `box_recipes.currency` into `export_my_data`; step 1 section 5 keeps that key), WP04 (`useAuth()` with `sessionStatus`, `refreshSession`, `SessionUnavailable`), WP05 (`app/lib/routeAuth.ts` `requireRouteUser` and `jsonNoStore`, `rejectIfNotAppRequest` in `app/lib/csrf.ts`, the route and test patterns, `ANON_CLIENT_FORBIDDEN_FILES` and the user-table `no-restricted-syntax` block in `eslint.config.mjs`), WP13 (`app/lib/redirects.ts` `safeReturnToPath` and `loginPathWithNext`, `app/auth/login/LoginForm.tsx` with its Suspense readers and test, `app/portfolio/layout.tsx`, `productMeta.ts` `getProductDisplayName` and `getProductLabel`, `NO_INDEX`), WP20 (`useCurrency`, `app/types/market.ts`, `pnpm types:db`, generated `app/types/database.ts`), WP21 (`enforce_owner_row_cap()` in migration 0031, `pokefin_scraper` in 0032, `scripts/db/replay_migrations.sh`, CI job "Database replay and Python tests", the DB test fixture pattern), WP23 (`Delta`, `DataList`, `AsOf`, `EmptyState`, `Skeleton`, `Button`/`buttonClasses`, `PageHeader`, `ProvenanceLine`, dense `SortableTable`, tokens, `test-utils/axe.ts`, the conventions ratchet), WP25 (`getCachedProductStats`, `statsFor`, `ProductDailyStats`, `ProductStatsSnapshot`), WP31 (`ProductActions` `watch` prop, product page), WP32 (`YourPokefin` `children` slot, `Price`, `homeStyles.ts`, the home shell source test). Through them: WP07 (`format.ts`), WP11 (`getCachedMarketProductSummaries`), WP18 (`lib/sorting.ts`, `SortableTable`), WP22 (`perf-budgets.json`, `pnpm perf:budget`), WP24 (`metricHref`, `PROVENANCE_SENTENCE` in `app/content/disclosures.ts`, `/privacy`), WP26 (`PUBLIC_ROUTE_CLIENT_FILES`, `scripts/check-public-cache.mjs`), WP27 (`navConfig.ts` `ACCOUNT_NAV` and `productHref`, `loginCopy.ts`, `SearchTrigger`, `MobileNavSheet.tsx`, `Header.tsx`), WP31 (`priceChange` metric key), WP25 (`range52w` metric key). Soft, with a default in Before you start: WP28 (`msrp_multiple`, `formatMsrpMultiple`, the `msrpMultiple` metric key), WP33 (Screener table and phone rows) and WP36 (migration 0046 patches `export_my_data()` in place; production apply order matters, Owner action 1).
- **Unblocks**: WP35 (alert rules attach to watched products; `service_role` reads `watchlist_items` through `watchlist_items_product_id_idx`; the alert management UI lives on `/portfolio/watchlist`). WP33, if it merges after this package, adds the row action with `<WatchButton productId={id} productName={name} variant="icon" />` (step 17 says how).
- **Placement**: Track 2, data lane, after WP31 (action slot) and WP32 (home strip slot). Reserves migration **0044** and keeps it if it merges out of order. Must precede WP35. It can run in parallel with WP36 (0046) and WP37 (0047).
- **Suggested branch name**: `remediation/wp34-watchlist`
- **Risk level**: medium. It adds a user table, a cookie-backed route and a client island on the ISR product page, and it replaces `export_my_data()`; the table is additive with owner-only RLS proven by a SQL test, the function keeps 0024's body, volatility and grants plus one key, and the island never touches the server render.

## Why

A collector who wants to follow a product today has to remember it and search for it again: there is no Watch action anywhere, the product page is a dead end apart from the TCGplayer link, and the site gives a signed-in user no reason to come back (`research/ui-audit.md` `/product/[id]`: "no Add to portfolio, no Watch, no Compare, no Alert"; top-10 item 5). Every serious competitor has a watchlist with alerts, and the research ranks it the single largest gap and the retention loop (`research/competitive-landscape.md` §3a feature matrix "Watchlist", §4 item 1; `research/data-opportunities.md` §3.11, tier A). Finance products put the watchlist next to the portfolio and surface its movers on the personal home (`research/competitive-landscape.md` §2 Yahoo and Koyfin, §4 item 13). This package adds one watchlist per user (200 products), a one-tap Watch toggle on product pages and Screener rows that keeps those pages ISR, a `/portfolio/watchlist` tab with the decision columns WP25 and WP28 compute, and the top 5 watched movers over 7 days in the home island. Every number follows the freshness gate: a watched product whose price is withheld shows `--` with the reason.

## Design

### Decisions (binding)

1. One watchlist per user, at most 200 products (trigger, SQLSTATE 23514, route answers 409 `watchlist_full`). Named lists are deferred.
2. `watchlist_items` is reachable only through `app/api/watchlist/route.ts` (cookie client, `requireRouteUser`, CSRF on writes, `jsonNoStore`). No page reads it with `cookies()`.
3. Public pages stay ISR. `WatchButton` is a client island: it renders the same "Watch" button in the server HTML for everyone, and after hydration reads membership through `GET /api/watchlist?ids=`, only when `sessionStatus === "authenticated"`. All buttons on a page share one store, so 300 Screener rows cost at most two requests. A successful toggle changes only the button (filled star, action-blue border) and is announced to screen readers; only a failure prints visible text, on its own line below the actions row. Nothing next to the button moves on success, so "View on TCGplayer" never jumps under the pointer and the chart below never shifts.
4. Signed-out tap: `router.push("/auth/login?next=<current path and query>&watch=<id>")`. `LoginForm` reads `watch`, and after a successful sign-in POSTs the watch (4 s cap) before `router.replace(next)`. The destination's `WatchButton` then reads "watched". The `next` path stays clean (no `intent=watch`); WP27's sign-in subtitle also switches to the watch sentence when `watch` is present.
5. The watchlist page is `/portfolio/watchlist`, a tab next to Holdings (`/portfolio`). `proxy.ts` already protects `/portfolio/:path*`. Its one page action is "Find a product" (WP27 `SearchTrigger`, opens the header search), in the page header and as the empty state's action, so a collector can add to the list without leaving to browse.
6. Home: `WatchlistMovers` renders as `children` of WP32's `YourPokefin`: the 5 watched products with the largest absolute 7D change.
7. Changes are WP25's USD Market Price returns (`ret_1d`, `ret_7d`, `ret_30d`), shown only when the stats row describes the same price the row shows. Prices convert to CAD at the header's current rate, as on every list page. The provenance line is WP24's `PROVENANCE_SENTENCE` (the site's one wording for source, cadence and the 14-day rule) plus "Changes are measured in USD, through {date} (UTC)."
8. A watched product whose price is withheld (migration 0023) or that is no longer tracked shows `--` in every number column, with the reason for screen readers, plus the "Last priced" clock when a last price day is known. The reason is also visible where a sighted user would otherwise see only `--`: "No longer tracked" or "Never priced" under the name (desktop) or in the meta line (phone), and "Last priced {date}" in words on phones (a tooltip clock says nothing on touch, WP23 `AsOf`).

### Metric definitions (computed server-side in `app/lib/server/watchlistModel.ts`)

`P` = the product's guarded summary (`getCachedMarketProductSummaries`, migration 0023 applied). `usd` = `P.usd_price` when `hasCurrentPrice(P)`, else null. `priceDay` = UTC day of `P.price_recorded_at`. `S` = `statsFor(getCachedProductStats(), id)` (WP25 `product_stats_latest`). `match` = `usd` and `priceDay` present, `S.is_price_fresh`, `S.price_day === priceDay`, `S.usd_price` not null and `|S.usd_price - usd| < 0.005`.

| Column | Formula | Shown when | Otherwise |
|---|---|---|---|
| Price | `usd`, converted with `formatPrice` (header currency, current rate), `AsOf variant="table"` from `priceDay` (clock icon at 2 or more days) | `usd` present | `--`, sr-only reason; clock "Last priced {date}" when `priceDay` present |
| 1D, 7D, 30D | `S.ret_1d`, `S.ret_7d`, `S.ret_30d` (WP25 bounded anchors, percent points) | `match` | `--` |
| vs 52W high | `(usd / S.high_52w - 1) x 100`; printed "At high" when `> -0.05`, else "{abs, 1 decimal}% below" (neutral ink, it is not a return) | `match`, `S.high_52w > 0`, and `S.day - S.first_tracked_day >= 364` days | `--` (a high over less than a year is not a 52-week high) |
| x MSRP | `S.msrp_multiple` (WP28), printed with `formatMsrpMultiple` ("1.4x") | `match` and WP28 landed | `--`; the column is hidden when no row has a value |
| Days of supply | `S.days_of_supply` (WP25, listings freshness gated in SQL), whole days, "<1" below 1 | `usd` present and `S` present | `--` |
| Added | UTC day of `created_at`, "Sep 29" (year added when not the current year) | always | |
| Home movers | Rows with non-null 7D change, by `abs(change7d)` descending, ties by product id ascending, first 5 | | fewer than 5: show those |

`priceStatus` per row: `priced` (usd present), `withheld` (usd null, `priceDay` present), `never` (neither), `untracked` (product not in the active catalog summaries; name read from `products`). Screen-reader reasons: "Price withheld", "Never priced", "No longer tracked", else "Not available".

### Screens

`/portfolio/watchlist`, 1440 px (content `max-w-7xl`, WP23 dense `SortableTable`, 40 px header, 44 px rows):

```
+----------------------------------------------------------------------------------------------------------------+
| [mark] Pokéfin   Prices  Screener  Sets  Portfolio  Tools v      (o) Prices as of Sep 30   [Q Search /] USD|CAD |
+----------------------------------------------------------------------------------------------------------------+
| Watchlist                                                                        [ Find a product ]  h1 24/32 |
| 14 of 200 products. TCGplayer Market Price in USD, updated daily. Prices older than 14 days are hidden.        |
| Changes are measured in USD, through Sep 29, 2026 (UTC). How changes are calculated             small, ink-soft |
| Holdings   Watchlist                                                                                            |
| ---------  =========  (tab bar, active tab underlined in action blue, aria-current="page")                     |
| (status line, only after a removal:) Removed Evolving Skies Booster Box. [Undo]                                 |
|                                                                                                                |
| PRODUCT                             PRICE        1D        7D       30D   VS 52W HIGH   x MSRP  DAYS OF  ADDED ▼ |
|                                                                                                  SUPPLY         |
| Evolving Skies Booster Box          C$612.40   ▲ 0.4%   ▲ 3.4%   ▼ 2.0%   16.6% below    1.4x      12   Sep 29 x |
| Surging Sparks Elite Trainer Box    C$81.30◷   --       ▼ 1.1%   ▲ 4.0%   At high         1.2x      31   Sep 12 x |
| Lost Origin Booster Bundle (PC)     --  ◷       --       --       --       --              --        --   Aug 30 x |
| Celebrations Elite Trainer Box      --          --       --       --       --              --        --   Jul 02 x |
|   No longer tracked (caption)                                                                                  |
| ...                                                                                                            |
| How these are calculated: Change · 52-week high · x MSRP · Days of supply                                      |
+----------------------------------------------------------------------------------------------------------------+
```

`◷` is WP23's `AsOf` table variant (clock, `title` and sr-only "Last priced Sep 25"). `x` is the remove button (sr name "Remove {product} from watchlist"). The sorted header is bold with ▲/▼. Default sort: Added, newest first. "Find a product" is a secondary button (WP27 `SearchTrigger`); it opens the header search, and the product page it leads to has the Watch button. An untracked or never-priced row prints its reason as a caption under the name, because its `--` cells would otherwise be unexplained to a sighted user.

`/portfolio/watchlist`, 390 px (16 px gutters, WP23 `DataList` rows at least 56 px, no table):

```
+--------------------------------------+
| Watchlist                            |  h1
| [ Find a product ]                   |  PageHeader actions wrap under the title
| 14 of 200 products. TCGplayer Market |
| Price in USD, updated daily. Prices  |
| older than 14 days are hidden.       |
| Changes are measured in USD, through |
| Sep 29, 2026 (UTC). How changes ...  |
| Holdings   Watchlist                 |  44 px tab targets
|            =========                 |
| SORT BY                              |
| [ Date added            v] [Newest  ]|  44 px select (16 px text) + order button
|                            [first   ]|
| +----------------------------------+ |
| | Booster Box  Evolving Skies    x | |  line 1: type, set; remove 44 px
| | 52W high: 16.6% below · Supply   | |  line 2 left: meta
| | 12 days     C$612.40 ▲ 3.4% 7D   | |  line 2 right: price + change
| +----------------------------------+ |
| | Elite Trainer Box  Surging Sp. x | |
| | ◷ Last priced Sep 25  C$81.30 ▼1.1% |  stale price: the meta slot says so in words
| +----------------------------------+ |
| | Booster Bundle  Lost Origin    x | |
| | No longer tracked          --  -- | |  untracked: the reason in words
+--------------------------------------+
```

The row link covers title and both lines; the remove button is a sibling of the link inside the `<li>` (no nested interactive elements). The change shown on phones is the sort's window when sorting by 1D, 7D or 30D, else 7D. Line 2 left shows, in this order of precedence: "Last priced {date}" with the clock when the price day is 2 or more days old (shown or withheld), the visible reason when there is no price and no date ("No longer tracked", "Never priced"), else the sort-dependent meta.

Product page actions (WP31 slot), 1440 px and 390 px:

```
[ Add to portfolio ] [ ☆ Watch ] [ Open in Box NAV ]  View on TCGplayer          not watched (aria-pressed=false)
[ Add to portfolio ] [ ★ Watch ] [ Open in Box NAV ]  View on TCGplayer          watched: filled star, action-blue text and border;
                                                                                  "Added to your watchlist." is announced (sr-only)
[ Add to portfolio ] [ ☆ Watch ] [ Open in Box NAV ]  View on TCGplayer          a failed toggle rolls back and prints, on its own
Your watchlist is full: 200 products. Remove one to watch another.                line at the end of the actions row (role="status")
```

The label stays "Watch" in every state (the accessible name of a toggle button must not change; `aria-pressed` carries the state and the filled star and blue border show it). Before the session and membership are known the button is `aria-disabled="true"` with the same size, so nothing shifts. Success text is screen-reader only: a visible confirmation beside the button would widen the row after the request returns (often more than 500 ms after the tap, so it counts as layout shift) and push "Open in Box NAV" and "View on TCGplayer" sideways or onto a new line on a 390 px phone. Error text is visible because the rollback alone would look like an ignored tap.

Home, signed in (WP32 island, second column from 768 px, below the fold):

```
+----------------------------------------------------------------------------------------------------------+
| Your Pokéfin                                                                            Open portfolio   |
| Portfolio value                                  | Watchlist movers, 7D                  Open watchlist    |
| C$4,812.30  ▲ 0.6% 1D                            | Booster Box  Evolving Skies                             |
| +C$28.70 over 1 day · 14 holdings, 22 units      |                           C$612.40  ▲ 12.4% 7D          |
| as of Sep 30                                     | Elite Trainer Box  Scarlet & Violet 151                 |
|                                                  |                           C$81.30   ▼ 9.8% 7D           |
|                                                  | ... up to 5 rows (56 px DataListRow, one link each)     |
|                                                  | Largest 7-day moves among your 14 watched products.     |
+----------------------------------------------------------------------------------------------------------+
```

Sign-in page when reached from a Watch tap (`/auth/login?next=%2Fproduct%2F42&watch=42`): WP27's subtitle reads "Sign in to watch products and get daily alerts."; after sign-in the visitor lands on `/product/42` with the button pressed.

### States

| Where | State | What shows |
|---|---|---|
| `WatchButton` | session unknown, or membership loading | "Watch", `aria-disabled="true"`, `aria-pressed="false"`, clicks ignored |
| `WatchButton` | signed out | "Watch", `aria-pressed="false"`, click goes to sign-in with `next` and `watch` |
| `WatchButton` | known | `aria-pressed` = watched; click toggles optimistically; sr-only status "Added to your watchlist." / "Removed from your watchlist." (no visible text, nothing moves) |
| `WatchButton` | write failed | pressed state rolls back; visible status "Could not update your watchlist. Please try again." (or the server's message) on its own line below the actions row (button variant), sr-only for the icon variant |
| `WatchButton` | watchlist full | rolls back; visible status "Your watchlist is full: 200 products. Remove one to watch another." (button variant) |
| `WatchButton` | membership read failed | visible status "Could not check your watchlist. Select Watch to try again." (button variant); the next click retries the read |
| Page | session unknown | flat `Skeleton` bars (auth loading) or WP04's `SessionUnavailable` with retry |
| Page | signed out | "Redirecting to sign in…", client redirect to `/auth/login?next=%2Fportfolio%2Fwatchlist` (proxy.ts normally redirects first) |
| Page | loading | `role="status"` sr-only "Loading your watchlist" and 6 flat bars of row height |
| Page | read failed | `EmptyState` "Your watchlist could not be loaded" / "This is usually temporary." / button "Try again" |
| Page | empty | `EmptyState` "You are not watching any products yet" / "Select Watch on any product page to follow its price, change and supply here. Prices update daily." / button "Find a product" (opens the header search) |
| Page | full (200) | provenance starts "200 of 200 products (full)." |
| Page | removed | status line "Removed {name}." with an Undo button (focus moves to it); Undo re-adds and the line reads "Put back {name}." |
| Page | remove failed | the row comes back; status line shows the error |
| Page | stale or untracked row | `--` cells with sr-only reason; desktop: clock with "Last priced {date}" (title and sr-only) when the day is known, else a visible caption "No longer tracked" or "Never priced" under the name; phone: "Last priced {date}" in words with the clock, or the reason, in the meta line |
| Page | stats unavailable (`statsDay` null) | every change, 52W and supply cell `--`; provenance omits the "through" date |
| Home movers | session not signed in | nothing (the island itself renders nothing) |
| Home movers | loading | `role="status"` sr-only "Loading your watchlist" and 2 flat bars |
| Home movers | read failed | "Your watchlist could not be loaded." |
| Home movers | no watched products | "You are not watching any products yet." plus link "Browse prices" |
| Home movers | watched, none with a 7D change | "None of your watched products has a 7-day change yet." |

### Copy (every new user-facing string)

"Watch", "Watch {product name}" (icon variant name), "In your watchlist" (title when pressed), "Added to your watchlist.", "Removed from your watchlist.", "Could not update your watchlist. Please try again.", "Your watchlist is full: 200 products. Remove one to watch another.", "Could not check your watchlist. Select Watch to try again.", "Watchlist", "Holdings", "Portfolio sections" (nav name), "{n} of 200 products.", "(full)", WP24's `PROVENANCE_SENTENCE` (reused, not new copy), "Changes are measured in USD, through {date} (UTC).", "Changes are measured in USD.", "How changes are calculated", "Find a product", "Last priced {date}" (WP23 `AsOf`), "Your watchlist" (table caption, list name), "Product", "Price", "1D", "7D", "30D", "vs 52W high", "x MSRP", "Days of supply", "Added", "Remove", "Remove {name} from watchlist", "At high", "{x}% below", "Sort by", "Date added", "Name", "Change 1D", "Change 7D", "Change 30D", "Distance from 52-week high", "Newest first", "Oldest first", "A to Z", "Z to A", "High to low", "Low to high", ". Switch to {order}" (sr-only, order button), "52W high: {x}", "Supply: {n} days", "Added {date}", "Removed {name}.", "Undo", "Put back {name}.", "Price withheld", "Never priced", "No longer tracked", "Not available", "Loading your watchlist", "Redirecting to sign in…", "How these are calculated:", "Change", "52-week high", "Watchlist movers, 7D", "Open watchlist", "Largest 7-day moves among your {n} watched products.", every state string above. No "live", "real-time", "all-time", "undervalued", "buy", "TCGPlayer" or em dash.

### Accessibility

- `WatchButton` is a toggle button: constant name ("Watch", or "Watch {product}" for the icon variant), `aria-pressed`, `aria-disabled` while unknown (stays focusable), one polite `role="status"` region per button that is in the DOM from the first render (so its first message is announced). Success messages stay sr-only; error messages become visible for the labelled variant only. Star icon `aria-hidden`. Focus ring `focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action` (WP23 rule: Tailwind 4's `outline-none` hides focus in forced-colours mode). No `transition-colors` anywhere in this package (01-PRODUCT-DIRECTION.md §3.5: colour changes are instant).
- Tabs are navigation links in `<nav aria-label="Portfolio sections">`, current tab `aria-current="page"`; not ARIA tabs, because they are separate routes.
- Table: WP23 `SortableTable` (caption "Your watchlist", `aria-sort` on the sorted header). Product names are links; remove buttons have full names.
- Phone list: `<ul aria-label="Your watchlist">`; each row one link plus one sibling button; sort select has a visible label; the order button's name starts with its visible text and says what a press does ("Newest first. Switch to oldest first", the same pattern as WP33's phone sort), and changes with the order (it is not a toggle, so no `aria-pressed`).
- After a removal focus moves to the Undo button; after Undo it moves to the status line (`tabIndex={-1}`), so focus is never lost to `<body>`. The status line is rendered (empty) from the moment the list loads, so the first "Removed {name}." is announced.
- Every change uses WP23 `Delta` (glyph plus sr-only word). "vs 52W high" is neutral text. Touch targets 44 px on coarse pointers (`pointer-coarse:size-11`, `pointer-coarse:min-h-11`). Every new component test runs axe.

### Design system use

WP23: `Delta`, `DataList`, `AsOf` (table variant on desktop, inline variant on phones, plus its exported `daysBetween` and `STALE_AFTER_DAYS`), `EmptyState`, `Skeleton`, `Button`/`buttonClasses`, `PageHeader` (with `actions`), `ProvenanceLine`, `SortableTable` (dense), tokens `text-ink`, `text-ink-soft`, `text-action`, `text-warn-text`, `border-action`, `border-line`, `bg-surface`, `bg-surface-alt`, `ring-action`, `rounded-control`, type `text-h1`, `text-body`, `text-small`, `text-caption`. WP24: `metricHref`, `PROVENANCE_SENTENCE`. WP27: `SearchTrigger`. WP32: `Price`, `HOME_LINK`. WP28 (soft): `formatMsrpMultiple`. No raw palette class, no hex, no `transition-colors`/`transition-all` and no `outline-none` in any new file (conventions test plus Tests 15).

### Performance

- Product page: the island adds `WatchButton`, `watchlistStore.ts`, `watchlistApi.ts` and `watchlist.ts`, about 2 kB gz, no dependency (it does not import `redirects.ts` or `loginCopy.ts`). No request for signed-out visitors. Budget: `/product/900001` JS within its existing limit; the PR reports the delta.
- Screener rows (step 17, only if WP33 landed): all buttons share one store; ids requested in the same macrotask are batched into `GET /api/watchlist?ids=` chunks of 200. The rows are memoised and the button subscribes to the store itself, so a membership answer re-renders the buttons, not the rows, and a sort still moves rows without re-rendering them. `/screener` JS grows by about the same 2 kB and must stay within its limit.
- `/` : `WatchlistMovers` is about 1 kB gz, mounts only for signed-in users below the fold, one `GET /api/watchlist?view=movers` (5 rows).
- `/portfolio/watchlist`: one GET; the route does one primary-key range read of `watchlist_items` plus two `unstable_cache` reads that are already warm (summaries and stats), plus one `products` read only for untracked rows. Payload at 200 items about 60 kB JSON, about 10 kB gz. New route budget (manifest method): target 180 kB gz like `/portfolio`.
- No charting library and no `/api/public/*` call anywhere in this package.

## Before you start

Read:
- `audits/remediation/01-PRODUCT-DIRECTION.md` (all; binding), `research/competitive-landscape.md` §4 items 1 and 13, `research/data-opportunities.md` §3.11, `research/ui-audit.md` `/product/[id]`.
- Specs: WP05 (steps 6 to 9, 18, Tests 1 and 2), WP21 (step 2, Tests `test_db_roles_integration.py`), WP25 (Metric definitions, steps 8, 9, 11), WP31 (Actions row, step 11, the page JSX around `<ProductActions`), WP32 (step 8j `YourPokefin`, step 9 page, step 11 ESLint, Tests 7), WP27 (steps 4, 19, 20, 29), WP13 (steps 2, 11), WP23 (Components table, steps 8, 13, 14, 16, 17, 22).
- Code (paths from `frontend/` unless they start with `migrations/`, `tests/` or `scripts/db/`): `app/api/portfolio/route.ts`, `app/lib/routeAuth.ts`, `app/lib/csrf.ts`, `app/lib/server/portfolioRepo.ts`, `app/lib/portfolioApi.ts`, `app/lib/serverMarketData.ts` (`getCachedMarketProductSummaries`, `getCachedProductStats`), `app/lib/marketStats.ts`, `app/types/market.ts`, `app/lib/priceGuard.ts`, `app/lib/format.ts`, `app/lib/sorting.ts`, `app/product/[id]/productMeta.ts`, `app/product/[id]/ProductActions.tsx`, `app/product/[id]/page.tsx`, `app/page.tsx`, `app/components/home/YourPokefin.tsx`, `app/components/home/homeStyles.ts`, `app/components/Price.tsx`, `app/portfolio/page.tsx`, `app/portfolio/layout.tsx`, `app/auth/login/LoginForm.tsx` and `__tests__/LoginForm.test.tsx`, `app/lib/loginCopy.ts` and its test, `app/lib/redirects.ts`, `app/components/nav/navConfig.ts`, `app/components/nav/MobileNavSheet.tsx`, `app/components/Header.tsx`, `app/components/ui/*`, `app/components/SortableTable/SortableTable.tsx`, `app/components/SessionUnavailable.tsx`, `app/context/AuthContext.tsx`, `app/context/CurrencyContext.tsx`, `app/privacy/page.tsx`, `app/account/page.tsx`, `eslint.config.mjs`, `perf-budgets.json`, `app/__tests__/uiConventions.test.ts`. Repo root: `migrations/0011_export_my_data.sql`, `migrations/0024_export_my_data_volatile.sql`, `migrations/0031_user_table_write_limits.sql`, `tests/test_db_roles_integration.py`, `tests/test_migration_volatility.py`, `verify_migration.py` (docstring).
- Every call site you will change: `grep -rn "<ProductActions\|<YourPokefin\|<PortfolioDashboard\|ACCOUNT_NAV.settings\|loginSubtitleFor\|NextPathField" frontend/app --include=*.tsx --include=*.ts`.

Confirm the starting state (repo root). Each line must print what its comment says; otherwise stop and report the missing package:

```bash
git checkout master && git pull && git checkout -b remediation/wp34-watchlist

# Migration registry: 0044 is free, WP21's cap function exists, export_my_data is defined only by 0011 and 0024
ls migrations | grep -E '^0044_'                                              # no output
grep -n "FUNCTION public.enforce_owner_row_cap()" migrations/0031_*.sql      # 1 line
ls migrations/0032_*.sql scripts/db/replay_migrations.sh tests/test_db_roles_integration.py tests/test_migration_volatility.py
grep -ln "FUNCTION public.export_my_data" migrations/*.sql
# expect exactly migrations/0011_export_my_data.sql and migrations/0024_export_my_data_volatile.sql.
# WP38's 0036 (export includes box_recipes.currency) patches the function in place and never contains
# that text; check it landed: ls migrations/0036_export_includes_box_recipe_currency.sql (1 file).
# Its key is why step 1 section 5 carries 'currency', currency.
# If a third file numbered below 0044 is listed, copy THAT file's body into step 1 section 5 instead
# of 0024's, keep every key it adds, and say so in the PR. (WP36's 0046 never appears here: it patches
# the function in place through pg_get_functiondef and never contains that text. WP35's 0045 is
# written after this package and copies 0044.)
ls migrations/0046_*.sql 2>/dev/null
# WP36 landed first if this prints a file. Keep 0044 as written (the replay applies 0044 before 0046,
# so the chain stays correct), and copy Owner action 1's "if 0046 is already applied" line into the PR.

cd frontend
# WP04
grep -n 'sessionStatus: "unknown" | "anonymous" | "authenticated"\|export type SessionStatus' app/context/AuthContext.tsx | head -2   # 1 or more lines
ls app/components/SessionUnavailable.tsx
# WP05
grep -n "export function rejectIfNotAppRequest" app/lib/csrf.ts                                  # 1 line
grep -n "export async function requireRouteUser\|export function jsonNoStore" app/lib/routeAuth.ts   # 2 lines
grep -n "ANON_CLIENT_FORBIDDEN_FILES = \[" eslint.config.mjs                                     # 1 line
grep -n "portfolio_holdings|portfolio_lots" eslint.config.mjs                                   # 1 line (the user-table selector)
# WP13
grep -n "export function safeReturnToPath\|export function loginPathWithNext" app/lib/redirects.ts   # 2 lines
grep -n "function NextPathField" app/auth/login/LoginForm.tsx                                    # 1 line
ls app/auth/login/__tests__/LoginForm.test.tsx app/portfolio/layout.tsx
grep -n "export function getProductDisplayName\|export function getProductLabel" "app/product/[id]/productMeta.ts"   # 2 lines
# WP20
grep -n "export function useCurrency" app/context/CurrencyContext.tsx                            # 1 line
grep -n '"types:db"' package.json                                                                # 1 line
# WP23
ls app/components/ui/Delta.tsx app/components/ui/DataList.tsx app/components/ui/AsOf.tsx app/components/ui/EmptyState.tsx \
   app/components/ui/Skeleton.tsx app/components/ui/Button.tsx app/components/ui/PageHeader.tsx app/components/ui/ProvenanceLine.tsx \
   app/components/SortableTable/SortableTable.tsx test-utils/axe.ts
grep -n "export function compareSortValues\|export type SortValue\|export type SortDirection" app/lib/sorting.ts   # 3 lines
# WP24
grep -n "export function metricHref" app/lib/metricDefinitions.ts                                 # 1 line
grep -n "export const PROVENANCE_SENTENCE" app/content/disclosures.ts                            # 1 line
grep -oE 'key: "(priceChange|range52w|daysOfSupply|msrpMultiple)"' app/lib/metricDefinitions.ts   # 3 or 4 keys (msrpMultiple is WP28)
# WP25
grep -n "export async function getCachedProductStats" app/lib/serverMarketData.ts                 # 1 line
grep -n "export function statsFor\|export interface ProductStatsSnapshot" app/lib/marketStats.ts # 2 lines
# WP27
grep -n "export const ACCOUNT_NAV\|export function productHref" app/components/nav/navConfig.ts   # 2 lines
grep -n "export function loginSubtitleFor\|export const WATCH_LOGIN_SUBTITLE" app/lib/loginCopy.ts   # 2 lines
ls app/components/nav/MobileNavSheet.tsx app/lib/__tests__/loginCopy.test.ts app/components/search/SearchTrigger.tsx
grep -n "export function openGlobalSearch" app/components/search/searchEvents.ts                  # 1 line
# WP31
grep -n "watch?: ReactNode" "app/product/[id]/ProductActions.tsx"                                # 1 line
grep -n "<ProductActions" "app/product/[id]/page.tsx"                                            # 1 line
# WP32
grep -n "children?: ReactNode" app/components/home/YourPokefin.tsx                              # 1 line
grep -n "<YourPokefin" app/page.tsx                                                              # 1 line
grep -n "export default function Price" app/components/Price.tsx                                 # 1 line
grep -n "export const HOME_LINK" app/components/home/homeStyles.ts                               # 1 line
grep -n "export function daysBetween\|export const STALE_AFTER_DAYS" app/components/ui/AsOf.tsx   # 2 lines (WP23)
grep -n "const PUBLIC_ROUTE_CLIENT_FILES" eslint.config.mjs                                      # 1 line
# WP22
grep -n '"/portfolio": {' perf-budgets.json                                                      # 1 or 2 lines (route and rum target)

# Soft: WP28. Record both answers; steps 3, 12 and 13 branch on them.
grep -n "msrp_multiple" app/types/market.ts                                  # WP28 landed: 1 line
grep -n "export function formatMsrpMultiple" app/lib/productAttributes.ts    # WP28 landed: 1 line
# Soft: WP33. Record the answer; step 17 branches on it. WP33's table is its own component, not
# SortableTable, and its phone rows are WP23 DataListRow.
ls app/components/Screener/ScreenerTableRow.tsx app/components/Screener/ScreenerTable.tsx \
   app/components/Screener/ScreenerPhoneList.tsx 2>/dev/null                    # WP33 landed: 3 files
```

Tooling:
- Local Postgres for the database tests and the replay (WP21): Docker `postgres:17`, or the PostgreSQL 16 binaries at `/usr/lib/postgresql/16/bin`. Every SQL statement in step 1 was applied twice to PostgreSQL 16.13 while this spec was written, and the RLS, cap, export and cascade behaviour in Tests 1 was observed there.
- A Python venv with `requirements.txt` plus `pytest` (WP21 added `psycopg[binary]`).

Baseline (from `frontend/`): `pnpm exec tsc --noEmit` (exit 0), `pnpm lint` (0 errors), `pnpm test --ci` (all pass), `pnpm run test:scripts` (all pass). From the repo root: `python -m pytest tests/ -q`. Record the counts for the PR.

Two phases, like WP25. **Phase A** (steps 1 to 19 except 16b): open a draft PR titled `[waiting for DB types] WP34: Watchlist` and hand the owner Owner actions 1 and 2. `tsc` reports errors only for the four `.from("watchlist_items")` calls in `app/lib/server/watchlistRepo.ts` until phase B; that is expected and the only allowed failure. **Phase B** (step 16b): regenerate `app/types/database.ts` once 0044 is in production, then finish the PR.

## Implementation steps

### Step 1. `migrations/0044_watchlist.sql` (new, repo root)

Create the file with exactly this content. It is idempotent (`replay_twice`), and section 5 is 0024's function body with one key added.

1a to 1e in one file:

```sql
-- Migration 0044: watchlist (WP34).
--
-- One watchlist per user: a row per (user, product), newest first by
-- created_at. Reads and writes go only through the cookie-backed route
-- handler app/api/watchlist/route.ts (WP05 pattern), which uses the caller's
-- JWT, so the policies below are the real boundary.
--
-- 1. public.watchlist_items, primary key (user_id, product_id). The primary
--    key serves "my rows" (leading user_id); watchlist_items_product_id_idx
--    serves the products foreign key and WP35's per-product alert joins.
--    Both foreign keys cascade: deleting an account (delete_my_account(),
--    0002/0010, through auth.users) or a products row removes the watch rows.
-- 2. Privileges. anon and PUBLIC get nothing (0013's rule for user tables).
--    authenticated gets SELECT, INSERT and DELETE only: a watch row is never
--    updated, so there is no UPDATE grant and no UPDATE policy, and Supabase's
--    default TRUNCATE, REFERENCES and TRIGGER are not granted. service_role
--    keeps full access for WP35's daily alert job. pokefin_scraper (0032) gets
--    nothing.
-- 3. RLS: owner-only policies per command, TO authenticated, with the
--    (SELECT auth.uid()) initplan form from 0014.
-- 4. At most 200 rows per user, through WP21's enforce_owner_row_cap()
--    (0031). It raises check_violation (SQLSTATE 23514); the route answers
--    409 with code "watchlist_full". As 0031 documents, concurrent inserts can
--    pass the cap by the number of concurrent requests; acceptable for an
--    abuse limit. The trigger fires before the primary key check, so at the
--    cap a duplicate insert also raises 23514; the route re-checks existence
--    before answering "full".
-- 5. export_my_data() gains a "watchlist" array. The body is 0024's (the 0011
--    body without STABLE) plus box_recipes 'currency' (WP38's 0036 patched
--    that key into the live function; a full body must keep it) and the
--    watchlist key: still VOLATILE (it inserts the
--    data_exported audit row), SECURITY DEFINER, search_path pinned, EXECUTE
--    for authenticated and service_role only.
--
-- Idempotent: safe to run twice (WP21 replay_twice).
--
-- Verification (after apply):
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.watchlist_items'::regclass;  -- true
--   SELECT has_table_privilege('anon', 'public.watchlist_items', 'SELECT'),             -- false
--          has_table_privilege('authenticated', 'public.watchlist_items', 'UPDATE'),    -- false
--          has_table_privilege('authenticated', 'public.watchlist_items', 'INSERT');    -- true
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.watchlist_items'::regclass
--     AND NOT tgisinternal;                                                            -- watchlist_items_row_cap_trg
--   SELECT public.export_my_data() ? 'watchlist';  -- as a signed-in user only; raises 28000 in the SQL editor

-- ============================================================
-- 1. Table and index
-- ============================================================

CREATE TABLE IF NOT EXISTS public.watchlist_items (
  user_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  product_id bigint      NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT watchlist_items_pkey PRIMARY KEY (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS watchlist_items_product_id_idx
  ON public.watchlist_items (product_id);

-- ============================================================
-- 2. Privileges
-- ============================================================

REVOKE ALL ON public.watchlist_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.watchlist_items TO authenticated;
GRANT ALL ON public.watchlist_items TO service_role;

-- ============================================================
-- 3. Row level security
-- ============================================================

ALTER TABLE public.watchlist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS watchlist_items_select_own ON public.watchlist_items;
CREATE POLICY watchlist_items_select_own ON public.watchlist_items
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS watchlist_items_insert_own ON public.watchlist_items;
CREATE POLICY watchlist_items_insert_own ON public.watchlist_items
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS watchlist_items_delete_own ON public.watchlist_items;
CREATE POLICY watchlist_items_delete_own ON public.watchlist_items
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================
-- 4. Row cap: 200 per user (enforce_owner_row_cap from 0031)
-- ============================================================

DROP TRIGGER IF EXISTS watchlist_items_row_cap_trg ON public.watchlist_items;
CREATE TRIGGER watchlist_items_row_cap_trg
  BEFORE INSERT ON public.watchlist_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_owner_row_cap('user_id', '200');

-- ============================================================
-- 5. export_my_data(): 0024's body plus 'currency' (WP38) and "watchlist"
-- ============================================================

CREATE OR REPLACE FUNCTION public.export_my_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  caller uuid := auth.uid();
  result jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT jsonb_build_object(
    'exported_at', now(),
    'user_id', caller,
    'profile', (
      SELECT jsonb_build_object(
        'id', id,
        'username', username,
        'email', email,
        'created_at', created_at,
        'updated_at', updated_at
      )
      FROM public.profiles WHERE id = caller
    ),
    'portfolios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'holdings', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', h.id,
            'product_id', h.product_id,
            'quantity', h.quantity,
            'purchase_price_usd', h.purchase_price_usd,
            'purchase_date', h.purchase_date,
            'notes', h.notes,
            'created_at', h.created_at,
            'updated_at', h.updated_at,
            'lots', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', l.id,
                'quantity', l.quantity,
                'purchase_price_usd', l.purchase_price_usd,
                'purchase_date', l.purchase_date,
                'notes', l.notes,
                'created_at', l.created_at
              ))
              FROM public.portfolio_lots l WHERE l.holding_id = h.id
            ), '[]'::jsonb)
          ))
          FROM public.portfolio_holdings h WHERE h.portfolio_id = p.id
        ), '[]'::jsonb)
      ))
      FROM public.portfolios p WHERE p.user_id = caller
    ), '[]'::jsonb),
    'box_recipes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'name', name,
        'retail_price', retail_price,
        'promo_value', promo_value,
        'currency', currency,
        'packs', packs,
        'share_code', share_code,
        'is_public', is_public,
        'created_at', created_at,
        'updated_at', updated_at
      ))
      FROM public.box_recipes WHERE user_id = caller
    ), '[]'::jsonb),
    'watchlist', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', w.product_id,
        'created_at', w.created_at
      ) ORDER BY w.created_at, w.product_id)
      FROM public.watchlist_items w WHERE w.user_id = caller
    ), '[]'::jsonb)
  ) INTO result;

  INSERT INTO public.auth_events (user_id, event)
    VALUES (caller, 'data_exported');

  RETURN result;
END
$$;

REVOKE EXECUTE ON FUNCTION public.export_my_data() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.export_my_data() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.export_my_data() TO service_role;
```

1f. Confirm the function body is 0024's plus WP38's `currency` key and the watchlist key, and nothing else:

```bash
diff <(sed -n '/^CREATE OR REPLACE FUNCTION public.export_my_data()/,/^\$\$;/p' migrations/0024_export_my_data_volatile.sql) \
     <(sed -n '/^CREATE OR REPLACE FUNCTION public.export_my_data()/,/^\$\$;/p' migrations/0044_watchlist.sql)
# expect exactly two hunks: "66a67" adding "        'currency', currency," (WP38's key, which its
# migration 0036 patched into the live function and which a full body must keep), and "73a75,81"
# adding 7 lines: "    ), '[]'::jsonb)," and the 6 lines of the 'watchlist' key. Any changed or
# deleted line means a line was mistyped: fix it.
```

If Before you start listed a third file defining `export_my_data`, repeat the diff against that file and keep every key it adds.

1g. Check the file with the verifier (repo root):

```bash
python3 verify_migration.py migrations/0044_watchlist.sql > /tmp/wp34_0044.sql; echo "exit=$?"
# expect exit=3 and on stderr:
#   -- function export_my_data(): body <md5>, non-strict, parallel u, security definer, plpgsql, volatility v, config search_path=public,auth
#   -- index watchlist_items_product_id_idx on watchlist_items: using btree product_id
#   32 "-- privilege" lines (7 revoked each for public and anon, UPDATE/TRUNCATE/REFERENCES/TRIGGER revoked
#     and SELECT/INSERT/DELETE granted for authenticated, 7 granted for service_role; EXECUTE on
#     export_my_data revoked for public and anon, granted to authenticated and service_role)
#   -- rls public.watchlist_items: enabled
#   -- NOT VERIFIED (out of scope, check by hand): 1 x CREATE (table/type/etc), 3 x CREATE POLICY, 1 x CREATE TRIGGER, 1 x DROP object, 3 x DROP/ALTER POLICY
grep -c "^-- privilege" <(python3 verify_migration.py migrations/0044_watchlist.sql 2>&1 >/dev/null)   # 32
```

With the file copied verbatim the body hash is `c0c0f458ee42eb1caf5a9e828677e10b`. The generated query returned 35 OK rows on the scratch database. After 0044 is applied, the 0024 (and 0011) verification queries report a `MISMATCH` for the `export_my_data` body: 0044 superseded it. That is the expected cross-file result.

1h. Replay (WP21 harness):

```bash
PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh
# expect the last line: OK: <N> files replayed once (replay_once) and twice (replay_twice)
```

### Step 2. `frontend/app/lib/watchlist.ts` (new): constants, types, parsers, sorting

Isomorphic and dependency-light: no React, no Supabase, no `server-only`, no `client-only`. The product page imports it through `WatchButton`, so keep it small.

```ts
import { compareSortValues, type SortDirection, type SortValue } from "./sorting";

/**
 * Watchlist (WP34): the contract between migration 0044, the route handler
 * app/api/watchlist/route.ts, the browser client and the UI.
 *
 * WATCHLIST_MAX_ITEMS must equal the cap in 0044's trigger
 * (enforce_owner_row_cap('user_id', '200')); tests/test_wp34_watchlist_static.py
 * checks it.
 */
export const WATCHLIST_MAX_ITEMS = 200;
/**
 * Rows the list read asks for. Above the cap because concurrent inserts can
 * pass it (0031's documented race); a user above the cap still sees every row.
 */
export const WATCHLIST_LIST_LIMIT = 250;
/** Product ids per GET /api/watchlist?ids= request. */
export const WATCHLIST_IDS_MAX = 200;
/** Rows in the home page's "Watchlist movers, 7D". */
export const WATCHLIST_MOVERS_LIMIT = 5;

export const WATCHLIST_API_PATH = "/api/watchlist";
export const WATCHLIST_PAGE_PATH = "/portfolio/watchlist";
/** Body limit for POST /api/watchlist ({"product_id": 123456789012}). */
export const WATCH_BODY_MAX_BYTES = 256;

export const WATCHLIST_FULL_CODE = "watchlist_full";
export const WATCHLIST_FULL_MESSAGE = `Your watchlist is full: ${WATCHLIST_MAX_ITEMS} products. Remove one to watch another.`;

/** Query parameter on /auth/login that carries a signed-out Watch tap. */
export const WATCH_PRODUCT_PARAM = "watch";

export type WatchPriceStatus = "priced" | "withheld" | "never" | "untracked";

/** One watched product as GET /api/watchlist returns it. Percent fields are percent points. */
export interface WatchlistEntry {
  productId: number;
  /** getProductDisplayName: "Evolving Skies Booster Box (Pokemon Center)". */
  name: string;
  /** Product type label plus variant: "Booster Box (Pokemon Center)". */
  typeLabel: string;
  setName: string | null;
  setCode: string | null;
  /** ISO timestamp the watch was added. */
  addedAt: string;
  /** Guarded USD Market Price (migration 0023), null when withheld or untracked. */
  usdPrice: number | null;
  /** UTC day the shown price describes; the last recorded day when withheld. */
  priceDay: string | null;
  priceStatus: WatchPriceStatus;
  change1d: number | null;
  change7d: number | null;
  change30d: number | null;
  /** (price / 52-week high - 1) x 100; null without a year of history. */
  offHigh52wPct: number | null;
  msrpMultiple: number | null;
  daysOfSupply: number | null;
}

export interface WatchlistPayload {
  items: WatchlistEntry[];
  count: number;
  max: number;
  /** product_daily_stats day behind the changes, or null when stats were unavailable. */
  statsDay: string | null;
}

export interface WatchlistMoversPayload {
  movers: WatchlistEntry[];
  count: number;
  statsDay: string | null;
}

export interface WatchedIdsPayload {
  watched: number[];
}

const PRODUCT_ID_RE = /^[1-9]\d{0,15}$/;

/** A product id from a query string: canonical positive integer or null. */
export function parseProductIdString(raw: string | null | undefined): number | null {
  if (typeof raw !== "string" || !PRODUCT_ID_RE.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/** A product id from a JSON body: a positive safe integer number, never a string. */
export function parseProductIdValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * "12,7,12" -> [12, 7]. null for an empty list, any bad token, or more than
 * WATCHLIST_IDS_MAX distinct ids.
 */
export function parseIdsParam(raw: string | null | undefined): number[] | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const seen = new Set<number>();
  for (const token of raw.split(",")) {
    const id = parseProductIdString(token);
    if (id === null) return null;
    seen.add(id);
  }
  if (seen.size === 0 || seen.size > WATCHLIST_IDS_MAX) return null;
  return [...seen];
}

/**
 * Sign-in URL for a signed-out Watch tap: "/auth/login?next=%2Fproduct%2F42&watch=42".
 * `returnTo` is the current same-origin path and query; LoginForm validates it
 * again with safeReturnToPath, so this stays free of redirects.ts (bundle size).
 */
export function watchProductLoginPath(returnTo: string, productId: number): string {
  const params = new URLSearchParams();
  if (returnTo.startsWith("/") && !returnTo.startsWith("//") && returnTo !== "/") {
    params.set("next", returnTo);
  }
  params.set(WATCH_PRODUCT_PARAM, String(productId));
  return `/auth/login?${params.toString()}`;
}

/** The 5 largest absolute 7-day changes; ties by product id. Rows without a change are skipped. */
export function selectMovers(
  items: readonly WatchlistEntry[],
  limit: number = WATCHLIST_MOVERS_LIMIT
): WatchlistEntry[] {
  return items
    .filter((item) => typeof item.change7d === "number" && Number.isFinite(item.change7d))
    .sort(
      (a, b) =>
        Math.abs(b.change7d as number) - Math.abs(a.change7d as number) || a.productId - b.productId
    )
    .slice(0, limit);
}

export function toMoversPayload(payload: WatchlistPayload): WatchlistMoversPayload {
  return { movers: selectMovers(payload.items), count: payload.count, statsDay: payload.statsDay };
}

// ---- Sorting (desktop table and phone list share it) ----

export type WatchSortKey =
  | "added"
  | "name"
  | "price"
  | "change1d"
  | "change7d"
  | "change30d"
  | "offHigh"
  | "msrp"
  | "dos";

export interface WatchSort {
  key: WatchSortKey;
  direction: SortDirection;
}

export const DEFAULT_WATCH_SORT: WatchSort = { key: "added", direction: "desc" };

export interface WatchSortOption {
  key: WatchSortKey;
  label: string;
  /** Direction applied when the phone select picks this key. */
  defaultDirection: SortDirection;
  /** Order button text per direction. */
  directionLabels: Readonly<Record<SortDirection, string>>;
}

const NUMERIC_LABELS = { asc: "Low to high", desc: "High to low" } as const;

export const WATCH_SORT_OPTIONS: readonly WatchSortOption[] = [
  { key: "added", label: "Date added", defaultDirection: "desc", directionLabels: { asc: "Oldest first", desc: "Newest first" } },
  { key: "name", label: "Name", defaultDirection: "asc", directionLabels: { asc: "A to Z", desc: "Z to A" } },
  { key: "price", label: "Price", defaultDirection: "desc", directionLabels: NUMERIC_LABELS },
  { key: "change1d", label: "Change 1D", defaultDirection: "desc", directionLabels: NUMERIC_LABELS },
  { key: "change7d", label: "Change 7D", defaultDirection: "desc", directionLabels: NUMERIC_LABELS },
  { key: "change30d", label: "Change 30D", defaultDirection: "desc", directionLabels: NUMERIC_LABELS },
  { key: "offHigh", label: "Distance from 52-week high", defaultDirection: "asc", directionLabels: NUMERIC_LABELS },
  { key: "msrp", label: "x MSRP", defaultDirection: "asc", directionLabels: NUMERIC_LABELS },
  { key: "dos", label: "Days of supply", defaultDirection: "asc", directionLabels: NUMERIC_LABELS },
];

export function watchSortValue(entry: WatchlistEntry, key: WatchSortKey): SortValue {
  switch (key) {
    case "added": {
      const ms = Date.parse(entry.addedAt);
      return Number.isFinite(ms) ? ms : null;
    }
    case "name":
      return entry.name;
    case "price":
      return entry.usdPrice;
    case "change1d":
      return entry.change1d;
    case "change7d":
      return entry.change7d;
    case "change30d":
      return entry.change30d;
    case "offHigh":
      return entry.offHigh52wPct;
    case "msrp":
      return entry.msrpMultiple;
    case "dos":
      return entry.daysOfSupply;
  }
}

/** Sorted copy; missing values last in both directions (lib/sorting); ties by product id. */
export function sortEntries(items: readonly WatchlistEntry[], sort: WatchSort): WatchlistEntry[] {
  return [...items].sort(
    (a, b) =>
      compareSortValues(watchSortValue(a, sort.key), watchSortValue(b, sort.key), sort.direction) ||
      a.productId - b.productId
  );
}

// ---- Shape checks for answers that crossed the network ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEntry(value: unknown): value is WatchlistEntry {
  return (
    isRecord(value) &&
    typeof value.productId === "number" &&
    typeof value.name === "string" &&
    typeof value.typeLabel === "string" &&
    typeof value.addedAt === "string" &&
    typeof value.priceStatus === "string"
  );
}

function isStatsDay(value: unknown): boolean {
  return value === null || typeof value === "string";
}

export function isWatchlistPayload(value: unknown): value is WatchlistPayload {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isEntry) &&
    typeof value.count === "number" &&
    typeof value.max === "number" &&
    isStatsDay(value.statsDay)
  );
}

export function isWatchlistMoversPayload(value: unknown): value is WatchlistMoversPayload {
  return (
    isRecord(value) &&
    Array.isArray(value.movers) &&
    value.movers.every(isEntry) &&
    typeof value.count === "number" &&
    isStatsDay(value.statsDay)
  );
}

export function isWatchedIdsPayload(value: unknown): value is WatchedIdsPayload {
  return (
    isRecord(value) &&
    Array.isArray(value.watched) &&
    value.watched.every((id) => typeof id === "number" && Number.isSafeInteger(id))
  );
}
```

If `lib/sorting.ts` does not export `SortDirection` (Before you start printed 2 lines), import it from `../components/SortableTable/SortableTable` as a type instead (`import type { SortState }` and use `SortState<WatchSortKey>["direction"]`).

### Step 3. `frontend/app/lib/server/watchlistModel.ts` (new): the pure row builder

Pure (no I/O, no `server-only`), so tests call it directly. It lives under `lib/server/` because only the route uses it.

```ts
import { getProductDisplayName, getProductLabel } from "../../product/[id]/productMeta";
import { recordedAtDateKey } from "../format";
import { hasCurrentPrice } from "../priceGuard";
import { statsFor, type ProductStatsSnapshot } from "../marketStats";
import type { WatchlistEntry, WatchPriceStatus } from "../watchlist";
import type { Product, ProductDailyStats } from "../../types/market";

/** A watchlist_items row as the repo reads it. */
export interface WatchRow {
  product_id: number;
  created_at: string;
}

/** Name fields of a product that is not in the active catalog (deactivated). */
export interface UntrackedProduct {
  id: number;
  variant: string | null;
  sets: { name: string; code: string } | null;
  product_types: { name: string; label?: string | null } | null;
}

export interface WatchlistModelInput {
  rows: readonly WatchRow[];
  /** Active catalog with guarded prices (getCachedMarketProductSummaries). */
  productsById: ReadonlyMap<number, Product>;
  /** Names for rows whose product is not in productsById. */
  untracked: ReadonlyMap<number, UntrackedProduct>;
  stats: ProductStatsSnapshot;
}

const DAY_MS = 86_400_000;
/** Same tolerance WP31 uses to accept a stats row for the shown price. */
export const STATS_PRICE_TOLERANCE_USD = 0.005;
/** "52-week" only when the product has at least this much history behind the stats day. */
export const WATCH_52W_MIN_TRACKED_DAYS = 364;

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function daysBetweenKeys(fromKey: string, toKey: string): number | null {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  return Number.isFinite(from) && Number.isFinite(to) ? Math.round((to - from) / DAY_MS) : null;
}

/** The stats row describes exactly the price this row shows (WP31's rule). */
export function statsMatchPrice(stats: ProductDailyStats | null, priceDay: string, usd: number): boolean {
  return (
    stats !== null &&
    stats.is_price_fresh &&
    stats.price_day === priceDay &&
    stats.usd_price !== null &&
    Math.abs(stats.usd_price - usd) < STATS_PRICE_TOLERANCE_USD
  );
}

function withVariant(label: string, variant: string | null | undefined): string {
  return variant ? `${label} (${variant})` : label;
}

function emptyNumbers() {
  return {
    change1d: null,
    change7d: null,
    change30d: null,
    offHigh52wPct: null,
    msrpMultiple: null,
    daysOfSupply: null,
  } as const;
}

function untrackedEntry(row: WatchRow, product: UntrackedProduct | null): WatchlistEntry {
  const label = product?.product_types?.label || product?.product_types?.name || "Unknown Product";
  const setName = product?.sets?.name ?? null;
  const typeLabel = withVariant(label, product?.variant);
  return {
    productId: row.product_id,
    name: product ? `${setName ?? "Unknown Set"} ${typeLabel}` : `Product ${row.product_id}`,
    typeLabel,
    setName,
    setCode: product?.sets?.code ?? null,
    addedAt: row.created_at,
    usdPrice: null,
    priceDay: null,
    priceStatus: "untracked",
    ...emptyNumbers(),
  };
}

export function buildWatchlistEntries({ rows, productsById, untracked, stats }: WatchlistModelInput): WatchlistEntry[] {
  return rows.map((row) => {
    const product = productsById.get(row.product_id);
    if (!product) return untrackedEntry(row, untracked.get(row.product_id) ?? null);

    const usd = hasCurrentPrice(product) ? finite(product.usd_price) : null;
    const priceDay = recordedAtDateKey(product.price_recorded_at ?? null);
    const priceStatus: WatchPriceStatus = usd !== null ? "priced" : priceDay !== null ? "withheld" : "never";
    const s = statsFor(stats, row.product_id);
    const match = usd !== null && priceDay !== null && statsMatchPrice(s, priceDay, usd);

    let offHigh: number | null = null;
    if (match && s !== null && usd !== null) {
      const high = finite(s.high_52w);
      const tracked = s.first_tracked_day ? daysBetweenKeys(s.first_tracked_day, s.day) : null;
      if (high !== null && high > 0 && tracked !== null && tracked >= WATCH_52W_MIN_TRACKED_DAYS) {
        offHigh = (usd / high - 1) * 100;
      }
    }

    return {
      productId: row.product_id,
      name: getProductDisplayName(product),
      typeLabel: withVariant(getProductLabel(product), product.variant),
      setName: product.sets?.name ?? null,
      setCode: product.sets?.code ?? null,
      addedAt: row.created_at,
      usdPrice: usd,
      priceDay,
      priceStatus,
      change1d: match && s ? finite(s.ret_1d) : null,
      change7d: match && s ? finite(s.ret_7d) : null,
      change30d: match && s ? finite(s.ret_30d) : null,
      offHigh52wPct: offHigh,
      msrpMultiple: match && s ? finite(s.msrp_multiple) : null,
      daysOfSupply: usd !== null && s ? finite(s.days_of_supply) : null,
    };
  });
}
```

If Before you start showed no `msrp_multiple` in `app/types/market.ts` (WP28 not landed), write `msrpMultiple: null,` instead of the `s.msrp_multiple` line and note it in the PR ("x MSRP appears once WP28 lands: replace the null with the stats column").

If `productMeta.ts` exports `getProductDisplayName` with a parameter type other than the `Product` of `app/types/market.ts` (WP20 moved it), `tsc` tells you: import `Product` from wherever `productMeta.ts` imports it.

### Step 4. `frontend/app/lib/server/watchlistRepo.ts` (new): every `watchlist_items` query

The only module besides the route that queries `watchlist_items`. It receives the cookie-backed route client, so RLS applies. Every query also filters `user_id` explicitly: it uses the primary key and keeps a policy mistake from widening a read.

```ts
import "server-only";

import type { createRouteSupabaseClient } from "../routeSupabase";
import { getCachedMarketProductSummaries, getCachedProductStats } from "../serverMarketData";
import { logCaughtError, logSupabaseError } from "../logger";
import { WATCHLIST_LIST_LIMIT, WATCHLIST_MAX_ITEMS, type WatchlistPayload } from "../watchlist";
import {
  buildWatchlistEntries,
  type UntrackedProduct,
  type WatchRow,
} from "./watchlistModel";
import type { Product } from "../../types/market";

type RouteSupabase = Awaited<ReturnType<typeof createRouteSupabaseClient>>;

export type AddWatchResult = "added" | "exists" | "full" | "not_found" | "error";
export type RemoveWatchResult = "removed" | "absent" | "error";

/** The caller's rows, newest first. null on a read error (the route answers 500). */
export async function listWatchRows(supabase: RouteSupabase, userId: string): Promise<WatchRow[] | null> {
  const { data, error } = await supabase
    .from("watchlist_items")
    .select("product_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("product_id", { ascending: true })
    .limit(WATCHLIST_LIST_LIMIT);
  if (error) {
    logSupabaseError("watchlist_list_failed", error);
    return null;
  }
  return (data ?? []) as WatchRow[];
}

/** Which of `ids` the caller watches. null on a read error. */
export async function watchedAmong(
  supabase: RouteSupabase,
  userId: string,
  ids: readonly number[]
): Promise<number[] | null> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("watchlist_items")
    .select("product_id")
    .eq("user_id", userId)
    .in("product_id", [...ids]);
  if (error) {
    logSupabaseError("watchlist_ids_failed", error);
    return null;
  }
  return (data ?? []).map((row) => row.product_id as number);
}

/**
 * Insert one watch. 23505 (already watched) is success. 23503 (no such
 * product) is not_found. 23514 is the 200-row cap, but the cap trigger fires
 * before the primary key check, so a duplicate at the cap also raises 23514:
 * re-check before answering "full".
 */
export async function addWatch(supabase: RouteSupabase, userId: string, productId: number): Promise<AddWatchResult> {
  const { error } = await supabase
    .from("watchlist_items")
    .insert({ user_id: userId, product_id: productId });
  if (!error) return "added";
  if (error.code === "23505") return "exists";
  if (error.code === "23503") return "not_found";
  if (error.code === "23514") {
    const existing = await watchedAmong(supabase, userId, [productId]);
    return existing !== null && existing.includes(productId) ? "exists" : "full";
  }
  logSupabaseError("watchlist_insert_failed", error);
  return "error";
}

/** Delete one watch. Deleting a row that is not there is "absent", a success. */
export async function removeWatch(
  supabase: RouteSupabase,
  userId: string,
  productId: number
): Promise<RemoveWatchResult> {
  const { data, error } = await supabase
    .from("watchlist_items")
    .delete()
    .eq("user_id", userId)
    .eq("product_id", productId)
    .select("product_id");
  if (error) {
    logSupabaseError("watchlist_delete_failed", error);
    return "error";
  }
  return (data?.length ?? 0) > 0 ? "removed" : "absent";
}

const UNTRACKED_SELECT = "id, variant, sets ( name, code ), product_types ( name, label )";

/** Names of watched products that left the active catalog. Never fails: missing names fall back. */
async function loadUntrackedNames(
  supabase: RouteSupabase,
  ids: readonly number[]
): Promise<Map<number, UntrackedProduct>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("products").select(UNTRACKED_SELECT).in("id", [...ids]);
  if (error) {
    logSupabaseError("watchlist_untracked_names_failed", error);
    return new Map();
  }
  const rows = (data ?? []) as unknown as UntrackedProduct[];
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * The caller's watchlist with prices and daily statistics. null when the rows
 * or the catalog cannot be read (the route answers 500, never an empty list).
 * Statistics degrade on their own: getCachedProductStats returns an empty
 * snapshot on failure, and every derived column is then null.
 */
export async function loadWatchlist(supabase: RouteSupabase, userId: string): Promise<WatchlistPayload | null> {
  const [rows, products, stats] = await Promise.all([
    listWatchRows(supabase, userId),
    getCachedMarketProductSummaries().catch((error: unknown) => {
      logCaughtError("watchlist_summaries_failed", error);
      return null;
    }),
    getCachedProductStats(),
  ]);
  if (rows === null || products === null) return null;

  const productsById = new Map<number, Product>(products.map((product) => [product.id, product]));
  const missing = rows.map((row) => row.product_id).filter((id) => !productsById.has(id));
  const untracked = await loadUntrackedNames(supabase, missing);
  const items = buildWatchlistEntries({ rows, productsById, untracked, stats });
  return { items, count: items.length, max: WATCHLIST_MAX_ITEMS, statsDay: stats.day };
}
```

The `as unknown as UntrackedProduct[]` cast is needed because PostgREST types embedded one-to-one relations as arrays in some generator versions; the select string guarantees the fields. If phase B's generated types make the plain `as UntrackedProduct[]` compile, use that.

Do not wrap `getCachedProductStats()` or `getCachedMarketProductSummaries()` in another `unstable_cache` (WP11's nested-cache rule): the route is dynamic and calls them directly.

### Step 5. `frontend/app/api/watchlist/route.ts` (new)

Same shape as WP05's routes: gates first, then the cookie client, `requireRouteUser` (401 versus 503), then the repo. Every response built here goes through `jsonNoStore`; only the 403 and 413 answers from `csrf.ts` do not. No `dynamic` or `runtime` export (cookies already make it dynamic); export only the three handlers.

```ts
import { NextRequest } from "next/server";
import { createRouteSupabaseClient } from "../../lib/routeSupabase";
import { rejectIfBodyTooLarge, rejectIfCsrfFails, rejectIfNotAppRequest } from "../../lib/csrf";
import { jsonNoStore, requireRouteUser } from "../../lib/routeAuth";
import { logCaughtError } from "../../lib/logger";
import {
  WATCHLIST_FULL_CODE,
  WATCHLIST_FULL_MESSAGE,
  WATCH_BODY_MAX_BYTES,
  parseIdsParam,
  parseProductIdString,
  parseProductIdValue,
  toMoversPayload,
} from "../../lib/watchlist";
import { addWatch, loadWatchlist, removeWatch, watchedAmong } from "../../lib/server/watchlistRepo";

const LOAD_FAILED = "Your watchlist could not be loaded. Please try again.";
const SAVE_FAILED = "Could not update your watchlist. Please try again.";

/**
 * GET /api/watchlist                 the caller's list with prices and stats
 * GET /api/watchlist?view=movers     the 5 largest 7-day moves (home page)
 * GET /api/watchlist?ids=1,2,3       which of these ids the caller watches (WatchButton)
 */
export async function GET(req: NextRequest) {
  const forbidden = rejectIfNotAppRequest(req);
  if (forbidden) return forbidden;

  const params = req.nextUrl.searchParams;
  const rawIds = params.get("ids");
  const view = params.get("view");
  if (rawIds !== null && view !== null) return jsonNoStore({ error: "Use either ids or view" }, 400);
  if (view !== null && view !== "movers") return jsonNoStore({ error: "Unknown view" }, 400);
  const ids = rawIds === null ? null : parseIdsParam(rawIds);
  if (rawIds !== null && ids === null) return jsonNoStore({ error: "Invalid ids" }, 400);

  try {
    const supabase = await createRouteSupabaseClient();
    const auth = await requireRouteUser(supabase);
    if (auth.response) return auth.response;

    if (ids !== null) {
      const watched = await watchedAmong(supabase, auth.user.id, ids);
      if (watched === null) return jsonNoStore({ error: LOAD_FAILED }, 500);
      return jsonNoStore({ watched });
    }

    const payload = await loadWatchlist(supabase, auth.user.id);
    if (payload === null) return jsonNoStore({ error: LOAD_FAILED }, 500);
    return jsonNoStore(view === "movers" ? toMoversPayload(payload) : payload);
  } catch (error) {
    logCaughtError("watchlist_get_failed", error);
    return jsonNoStore({ error: LOAD_FAILED }, 500);
  }
}

/** Body {"product_id": 42}. 201 added, 200 exists, 404 unknown product, 409 full. */
export async function POST(req: NextRequest) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, WATCH_BODY_MAX_BYTES);
  if (tooLarge) return tooLarge;

  try {
    const supabase = await createRouteSupabaseClient();
    const auth = await requireRouteUser(supabase);
    if (auth.response) return auth.response;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonNoStore({ error: "Invalid body" }, 400);
    }
    const productId =
      typeof raw === "object" && raw !== null
        ? parseProductIdValue((raw as { product_id?: unknown }).product_id)
        : null;
    if (productId === null) return jsonNoStore({ error: "Invalid product_id" }, 400);

    const result = await addWatch(supabase, auth.user.id, productId);
    switch (result) {
      case "added":
        return jsonNoStore({ status: "added" }, 201);
      case "exists":
        return jsonNoStore({ status: "exists" });
      case "not_found":
        return jsonNoStore({ error: "Product not found" }, 404);
      case "full":
        return jsonNoStore({ error: WATCHLIST_FULL_MESSAGE, code: WATCHLIST_FULL_CODE }, 409);
      default:
        return jsonNoStore({ error: SAVE_FAILED }, 500);
    }
  } catch (error) {
    logCaughtError("watchlist_post_failed", error);
    return jsonNoStore({ error: SAVE_FAILED }, 500);
  }
}

/** DELETE /api/watchlist?product_id=42. 200 {status: "removed" | "absent"}. */
export async function DELETE(req: NextRequest) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, 1024);
  if (tooLarge) return tooLarge;

  const productId = parseProductIdString(req.nextUrl.searchParams.get("product_id"));
  if (productId === null) return jsonNoStore({ error: "Invalid product_id" }, 400);

  try {
    const supabase = await createRouteSupabaseClient();
    const auth = await requireRouteUser(supabase);
    if (auth.response) return auth.response;

    const result = await removeWatch(supabase, auth.user.id, productId);
    if (result === "error") return jsonNoStore({ error: SAVE_FAILED }, 500);
    return jsonNoStore({ status: result });
  } catch (error) {
    logCaughtError("watchlist_delete_failed", error);
    return jsonNoStore({ error: SAVE_FAILED }, 500);
  }
}
```

The proxy classifies `/api/watchlist` as `general` (60/min per IP) through the `/api/` prefix; do not change `rateLimit.ts`. `PROTECTED_PATTERNS` in `proxy.ts` does not match `/api/watchlist`, so an anonymous call gets this route's JSON 401, not a redirect.

### Step 6. `frontend/app/lib/watchlistApi.ts` (new): the browser client

No `"use client"` (no React). No Supabase import.

```ts
import {
  WATCHLIST_API_PATH,
  isWatchedIdsPayload,
  isWatchlistMoversPayload,
  isWatchlistPayload,
  type WatchlistMoversPayload,
  type WatchlistPayload,
} from "./watchlist";

/**
 * Browser side of app/api/watchlist/route.ts (WP34). watchlist_items is
 * readable only by the authenticated role through that route; the browser
 * Supabase client is anonymous and must never query it.
 */

const APP_HEADER = { "x-pokefin-request": "1" } as const;
const JSON_HEADERS = { "Content-Type": "application/json", ...APP_HEADER } as const;

const LOAD_FAILED = "Your watchlist could not be loaded. Please try again.";
const SAVE_FAILED = "Could not update your watchlist. Please try again.";
const NETWORK_ERROR = "Network error. Check your connection and try again.";
/** How long LoginForm waits for the pending watch before navigating anyway. */
export const WATCH_AFTER_SIGN_IN_TIMEOUT_MS = 4000;

export class WatchlistApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "WatchlistApiError";
    this.status = status;
  }
}

export type WatchWriteResult =
  | { ok: true; status: "added" | "exists" | "removed" | "absent" }
  | { ok: false; message: string; code: string | null; status: number };

async function readError(res: Response, fallback: string): Promise<{ message: string; code: string | null }> {
  if (res.status === 401) return { message: "Your session has expired. Please sign in again.", code: null };
  if (res.status === 429) return { message: "Too many requests. Please wait a minute and try again.", code: null };
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      const { error, code } = body as { error?: unknown; code?: unknown };
      return {
        message: typeof error === "string" ? error : fallback,
        code: typeof code === "string" ? code : null,
      };
    }
  } catch {
    // Not JSON: fall back.
  }
  return { message: fallback, code: null };
}

async function getJson<T>(url: string, guard: (value: unknown) => value is T, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    headers: APP_HEADER,
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new WatchlistApiError((await readError(res, LOAD_FAILED)).message, res.status);
  const body: unknown = await res.json();
  if (!guard(body)) throw new WatchlistApiError(LOAD_FAILED, 500);
  return body;
}

/** Throws WatchlistApiError on any non-2xx or bad body, and the fetch error on network failure or abort. */
export function fetchWatchlist(signal?: AbortSignal): Promise<WatchlistPayload> {
  return getJson(WATCHLIST_API_PATH, isWatchlistPayload, signal);
}

export function fetchWatchlistMovers(signal?: AbortSignal): Promise<WatchlistMoversPayload> {
  return getJson(`${WATCHLIST_API_PATH}?view=movers`, isWatchlistMoversPayload, signal);
}

/** Which of `ids` (at most WATCHLIST_IDS_MAX) the caller watches. */
export async function fetchWatchedIds(ids: readonly number[], signal?: AbortSignal): Promise<number[]> {
  const body = await getJson(`${WATCHLIST_API_PATH}?ids=${ids.join(",")}`, isWatchedIdsPayload, signal);
  return body.watched;
}

async function write(url: string, init: RequestInit, fallbackStatus: "added" | "removed"): Promise<WatchWriteResult> {
  try {
    const res = await fetch(url, { ...init, credentials: "same-origin" });
    if (!res.ok) {
      const { message, code } = await readError(res, SAVE_FAILED);
      return { ok: false, message, code, status: res.status };
    }
    const body = (await res.json().catch(() => null)) as { status?: unknown } | null;
    const status = body?.status;
    return {
      ok: true,
      status: status === "exists" || status === "absent" || status === "added" || status === "removed" ? status : fallbackStatus,
    };
  } catch {
    return { ok: false, message: NETWORK_ERROR, code: null, status: 0 };
  }
}

/** Never throws. "exists" is success: the product was already watched. */
export function addToWatchlist(productId: number): Promise<WatchWriteResult> {
  return write(
    WATCHLIST_API_PATH,
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ product_id: productId }) },
    "added"
  );
}

/** Never throws. "absent" is success: it was not watched. */
export function removeFromWatchlist(productId: number): Promise<WatchWriteResult> {
  return write(`${WATCHLIST_API_PATH}?product_id=${productId}`, { method: "DELETE", headers: APP_HEADER }, "removed");
}

/**
 * The pending watch of a signed-out Watch tap (LoginForm, WP34). Waits for
 * the POST at most `timeoutMs`, then returns either way: the destination
 * page reads the real state.
 */
export async function applyWatchAfterSignIn(
  productId: number | null,
  timeoutMs: number = WATCH_AFTER_SIGN_IN_TIMEOUT_MS
): Promise<void> {
  if (productId === null) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    addToWatchlist(productId).then(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
}
```

### Step 7. `frontend/app/lib/watchlistStore.ts` (new): shared membership state

One store per tab so that every `WatchButton` on a page shares one read. `useSyncExternalStore` reads it; each state object is replaced on change, so snapshots are stable.

```ts
import "client-only";

import { WATCHLIST_IDS_MAX } from "./watchlist";
import { addToWatchlist, fetchWatchedIds, removeFromWatchlist, type WatchWriteResult } from "./watchlistApi";

export type WatchState =
  | { kind: "unknown" }
  | { kind: "error" }
  | { kind: "known"; watched: boolean; saving: boolean };

export const UNKNOWN_WATCH_STATE: WatchState = { kind: "unknown" };
const ERROR_STATE: WatchState = { kind: "error" };
const BUSY: WatchWriteResult = { ok: false, message: "Please wait for the previous change.", code: null, status: 0 };

let ownerId: string | null = null;
let states = new Map<number, WatchState>();
let queued = new Set<number>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeWatchlist(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getWatchState(productId: number): WatchState {
  return states.get(productId) ?? UNKNOWN_WATCH_STATE;
}

/** Forget everything when the signed-in user changes (sign-in, sign-out, another account). */
export function bindWatchlistOwner(userId: string | null): void {
  if (userId === ownerId) return;
  ownerId = userId;
  states = new Map();
  queued = new Set();
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  emit();
}

/** Ask for a product's membership. Requests made in the same macrotask share one GET per 200 ids. */
export function requestWatchState(userId: string, productId: number): void {
  bindWatchlistOwner(userId);
  if (states.has(productId) || queued.has(productId)) return;
  queued.add(productId);
  if (flushTimer === null) flushTimer = setTimeout(() => void flush(), 0);
}

/** After a failed read: drop the error and ask again. */
export function retryWatchState(userId: string, productId: number): void {
  if (getWatchState(productId).kind === "error") {
    states.delete(productId);
    emit();
  }
  requestWatchState(userId, productId);
}

async function flush(): Promise<void> {
  flushTimer = null;
  const owner = ownerId;
  const ids = [...queued];
  queued = new Set();
  for (let start = 0; start < ids.length; start += WATCHLIST_IDS_MAX) {
    const chunk = ids.slice(start, start + WATCHLIST_IDS_MAX);
    let watched: Set<number> | null = null;
    try {
      watched = new Set(await fetchWatchedIds(chunk));
    } catch {
      watched = null;
    }
    if (ownerId !== owner) return;
    for (const id of chunk) {
      if (states.has(id)) continue;
      states.set(id, watched === null ? ERROR_STATE : { kind: "known", watched: watched.has(id), saving: false });
    }
    emit();
  }
}

/** Optimistic toggle with rollback. Ignored (BUSY) unless the state is known and idle. */
export async function setWatched(productId: number, next: boolean): Promise<WatchWriteResult> {
  const owner = ownerId;
  const previous = states.get(productId);
  if (owner === null || !previous || previous.kind !== "known" || previous.saving) return BUSY;
  states.set(productId, { kind: "known", watched: next, saving: true });
  emit();
  const result = next ? await addToWatchlist(productId) : await removeFromWatchlist(productId);
  if (ownerId !== owner) return result;
  states.set(productId, { kind: "known", watched: result.ok ? next : previous.watched, saving: false });
  emit();
  return result;
}

/** Record a change made elsewhere (the watchlist page's remove and undo). */
export function noteWatched(productId: number, watched: boolean): void {
  if (ownerId === null) return;
  states.set(productId, { kind: "known", watched, saving: false });
  emit();
}

/** Test-only. */
export function _resetWatchlistStoreForTests(): void {
  ownerId = null;
  states = new Map();
  queued = new Set();
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  listeners.clear();
}
```

If `import "client-only"` fails to resolve (`ls node_modules/client-only` prints nothing), remove that line; WP26 relies on the same package, so it should resolve.

### Step 8. `frontend/app/components/watchlist/WatchButton.tsx` (new)

```tsx
"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { buttonClasses } from "../ui/Button";
import { watchProductLoginPath } from "../../lib/watchlist";
import {
  UNKNOWN_WATCH_STATE,
  bindWatchlistOwner,
  getWatchState,
  requestWatchState,
  retryWatchState,
  setWatched,
  subscribeWatchlist,
} from "../../lib/watchlistStore";

export type WatchButtonVariant = "button" | "icon";

export interface WatchButtonProps {
  productId: number;
  /** Full display name; the icon variant's accessible name is "Watch {productName}". */
  productName: string;
  /** "button": labelled secondary button (product page). "icon": star only (list rows). */
  variant?: WatchButtonVariant;
  /** Extra classes for the <button> itself (both variants). */
  className?: string;
}

const ADDED = "Added to your watchlist.";
const REMOVED = "Removed from your watchlist.";
const READ_FAILED = "Could not check your watchlist. Select Watch to try again.";

const ICON_CLASS =
  "inline-flex size-9 items-center justify-center rounded-control text-ink-soft hover:bg-surface-alt hover:text-ink aria-pressed:text-action focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action aria-disabled:cursor-wait pointer-coarse:size-11";

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="size-4 shrink-0" aria-hidden="true" focusable="false">
      <path
        d="M10 2.5l2.35 4.76 5.25.77-3.8 3.7.9 5.23L10 14.49l-4.7 2.47.9-5.23-3.8-3.7 5.25-.77L10 2.5z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Watch toggle (WP34). A client island: the server HTML is the same
 * unpressed "Watch" for every visitor, so ISR pages stay cached. Membership
 * is read after hydration through GET /api/watchlist?ids= (shared store),
 * only for a signed-in session. Signed-out taps go to sign-in with the watch
 * carried in ?watch=, and LoginForm applies it.
 */
export default function WatchButton({ productId, productName, variant = "button", className = "" }: WatchButtonProps) {
  const router = useRouter();
  const { user, sessionStatus } = useAuth();
  const userId = sessionStatus === "authenticated" && user ? user.id : null;
  const anonymous = sessionStatus === "anonymous";
  const state = useSyncExternalStore(
    subscribeWatchlist,
    () => getWatchState(productId),
    () => UNKNOWN_WATCH_STATE
  );
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (anonymous) {
      bindWatchlistOwner(null);
      return;
    }
    if (userId !== null) requestWatchState(userId, productId);
  }, [anonymous, userId, productId]);

  const signedIn = userId !== null;
  const pressed = signedIn && state.kind === "known" && state.watched;
  const busy = !anonymous && (!signedIn || state.kind === "unknown" || (state.kind === "known" && state.saving));
  const status = signedIn && state.kind === "error" ? READ_FAILED : message;
  // Success is shown by the button itself; only a failure prints visible text.
  const visibleError = variant === "button" && status !== null && status !== ADDED && status !== REMOVED;

  async function handleClick() {
    if (anonymous) {
      router.push(watchProductLoginPath(`${window.location.pathname}${window.location.search}`, productId));
      return;
    }
    if (userId === null) return;
    if (state.kind === "error") {
      setMessage(null);
      retryWatchState(userId, productId);
      return;
    }
    if (state.kind !== "known" || state.saving) return;
    const next = !state.watched;
    setMessage(null);
    const result = await setWatched(productId, next);
    setMessage(result.ok ? (next ? ADDED : REMOVED) : result.message);
  }

  const buttonClass =
    variant === "icon"
      ? `${ICON_CLASS} ${className}`
      : buttonClasses({
          variant: "secondary",
          className: `aria-pressed:border-action aria-pressed:text-action aria-disabled:cursor-wait ${className}`,
        });

  return (
    // "contents" for the labelled variant: the button and the status line become items of
    // WP31's flex-wrap actions row, so a visible error can take a full line of its own at
    // the end of the row (order-last basis-full) instead of widening the row in place.
    <span className={variant === "button" ? "contents" : "inline-flex items-center"}>
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={pressed}
        aria-disabled={busy ? true : undefined}
        aria-label={variant === "icon" ? `Watch ${productName}` : undefined}
        title={pressed ? "In your watchlist" : undefined}
        data-watch-state={anonymous ? "signed-out" : state.kind}
        className={buttonClass}
      >
        <StarIcon filled={pressed} />
        {variant === "button" && <span>Watch</span>}
      </button>
      <span role="status" className={visibleError ? "order-last basis-full text-small text-ink" : "sr-only"}>
        {status}
      </span>
    </span>
  );
}
```

Notes for the executor:
- `aria-pressed:` and `aria-disabled:` are Tailwind 4 built-in variants; they are emitted after the base utilities, so they override `border-line` and `text-ink` from `buttonClasses`. Do not add `!important`.
- The status `<span role="status">` is rendered from the first render, empty, in every state: a live region inserted together with its text is often not announced. `sr-only` is `position: absolute`, so while it is hidden it takes no place in the flex row (no extra gap).
- `order-last basis-full` only has an effect because WP31's actions row is `flex flex-wrap`. Do not add a wrapper element around `{watch}` in `ProductActions`.
- No `transition-colors` (01-PRODUCT-DIRECTION.md §3.5) and no `outline-none` (WP23 focus rule) here or in any other file of this package; Tests 15 enforces both.
- Do not use `useSearchParams` here: on a statically rendered page it forces a Suspense boundary or a client render bailout. `window.location` is read only inside the click handler.
- State changes come from the store (external) and from `setMessage` in an event handler, so `react-hooks/set-state-in-effect` is satisfied. Do not add an effect that calls `setMessage`.

### Step 9. Sign-in round trip: `app/lib/loginCopy.ts` and `app/auth/login/LoginForm.tsx`

9a. `app/lib/loginCopy.ts` (WP27): add `import { parseProductIdString } from "./watchlist";` and change `loginSubtitleFor` to take the `watch` parameter as an optional second argument, checked first:

```ts
export function loginSubtitleFor(next: string | null | undefined, watch?: string | null): string {
  if (parseProductIdString(watch ?? null) !== null) return WATCH_LOGIN_SUBTITLE;
  // ...the existing body, unchanged...
}
```

Keep `watchLoginPath` and every other export (WP35 may use them).

9b. `app/auth/login/LoginForm.tsx` (WP13, WP27):

- Add imports: `import { WATCH_PRODUCT_PARAM, parseProductIdString } from "../../lib/watchlist";` and `import { applyWatchAfterSignIn } from "../../lib/watchlistApi";`.
- Next to `NextPathField`, add a fourth reader:

```tsx
/** The product a signed-out Watch tap asked to watch (WP34), carried in the form. */
function WatchProductField() {
  const searchParams = useSearchParams();
  const productId = parseProductIdString(searchParams.get(WATCH_PRODUCT_PARAM));
  if (productId === null) return null;
  return <input type="hidden" name={WATCH_PRODUCT_PARAM} value={productId} />;
}
```

- In `LoginSubtitle` (WP27), change the call to `loginSubtitleFor(searchParams.get("next"), searchParams.get(WATCH_PRODUCT_PARAM))`.
- Inside the form, directly after WP13's `<Suspense fallback={null}><NextPathField /></Suspense>`, add:

```tsx
            <Suspense fallback={null}>
              <WatchProductField />
            </Suspense>
```

- In `handleSubmit`, read both fields from one `FormData` before the `await`, and apply the watch after a successful sign-in, before navigating. The function becomes (keep WP02's Turnstile reset lines exactly as they are in the error branch):

```tsx
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Read before the await: React clears currentTarget afterwards.
    const form = new FormData(e.currentTarget);
    const rawNext = form.get("next");
    const rawWatch = form.get(WATCH_PRODUCT_PARAM);
    // Validated again here (hidden inputs can be edited in devtools).
    const target = safeReturnToPath(typeof rawNext === "string" ? rawNext : null);
    const watchId = parseProductIdString(typeof rawWatch === "string" ? rawWatch : null);
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
      // WP34: a signed-out Watch tap. The POST runs with the new session cookie;
      // it never blocks navigation for more than 4 s and never shows an error here.
      await applyWatchAfterSignIn(watchId);
      // replace, not push: Back after signing in must not return to the form.
      router.replace(target);
    }
  };
```

The sign-up link on the login page does not carry `watch` (a new account confirms its email first); a new user taps Watch again after confirming. List this in the PR as a known limit.

### Step 10. Product page: fill WP31's slot

10a. `app/product/[id]/page.tsx`: add `import WatchButton from "../../components/watchlist/WatchButton";` and pass the island to `ProductActions` (the page already imports `getProductDisplayName` for its H1):

```tsx
          <ProductActions
            productId={productId}
            boxNavHref={hasContents ? boxCalculatorHref(productId) : null}
            tcgplayerUrl={product.url}
            watch={<WatchButton productId={productId} productName={getProductDisplayName(product)} />}
          />
```

Keep any other props WP31 passes (for example `currencyToggle`). Nothing else on the page changes: no `cookies()`, no `headers()`, no `searchParams`.

10b. If WP31's page or actions test asserts that the watch slot is empty (`grep -rn "watch" "app/product/[id]/__tests__"`), change that assertion to: the actions row contains a button named "Watch" with `aria-pressed="false"` and `aria-disabled="true"` in the server render (`renderToString`), and mock `../../components/watchlist/WatchButton` nowhere.

### Step 11. `frontend/app/components/Portfolio/PortfolioTabs.tsx` (new) and the Holdings page

```tsx
import Link from "next/link";
import { WATCHLIST_PAGE_PATH } from "../../lib/watchlist";

export type PortfolioTab = "holdings" | "watchlist";

const TABS: ReadonlyArray<{ key: PortfolioTab; label: string; href: string }> = [
  { key: "holdings", label: "Holdings", href: "/portfolio" },
  { key: "watchlist", label: "Watchlist", href: WATCHLIST_PAGE_PATH },
];

/**
 * Holdings | Watchlist (WP34). Links between two routes, so a navigation
 * landmark with aria-current, not ARIA tabs. Server-compatible.
 */
export default function PortfolioTabs({ current, className = "" }: { current: PortfolioTab; className?: string }) {
  return (
    <nav aria-label="Portfolio sections" className={`border-b border-line ${className}`}>
      <ul className="flex gap-1">
        {TABS.map((tab) => {
          const active = tab.key === current;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={`-mb-px inline-flex h-10 items-center border-b-2 px-3 text-body font-semibold focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action pointer-coarse:min-h-11 ${
                  active ? "border-action text-ink" : "border-transparent text-ink-soft hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

`app/portfolio/page.tsx`: add `import PortfolioTabs from "../components/Portfolio/PortfolioTabs";` and, directly above the `<PortfolioDashboard` element, insert `<PortfolioTabs current="holdings" className="mb-5 md:mb-6" />`. Change nothing else (WP36 may be editing the same file in parallel; if the merge conflicts, keep both sides and keep the tabs directly above the dashboard).

### Step 12. `frontend/app/components/watchlist/watchlistFormat.ts` (new): cell text

```ts
import { FLAT_BAND_PERCENT, formatDateOnly, formatInteger, formatMonthDay, formatPercent, recordedAtDateKey } from "../../lib/format";
import { STALE_AFTER_DAYS, daysBetween } from "../ui/AsOf";
import type { WatchlistEntry } from "../../lib/watchlist";

/** Today's UTC date key. A module function, so component renders stay lint-pure (WP23 AsOf). */
function todayUtcKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The price day is known and at least STALE_AFTER_DAYS old: the row shows
 * "Last priced {date}" (shown price 2 to 14 days old, or a withheld price).
 * Same rule as WP23's AsOf, so the phone text and the desktop clock agree.
 */
export function isStalePriceDay(priceDay: string | null, today: string = todayUtcKey()): boolean {
  return priceDay !== null && daysBetween(priceDay, today) >= STALE_AFTER_DAYS;
}

/** The visible reason for a row with no price and no last price day, else null. */
export function visibleMissingReason(entry: WatchlistEntry): string | null {
  if (entry.priceStatus === "untracked") return "No longer tracked";
  if (entry.priceStatus === "never") return "Never priced";
  return null;
}

/** "At high" within the flat band, else "16.6% below". Neutral text, not a return. */
export function formatOffHigh(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  if (value > -FLAT_BAND_PERCENT) return "At high";
  return `${formatPercent(Math.abs(value))} below`;
}

/** Whole days, "<1" below one day, "--" when unknown. */
export function formatDaysOfSupply(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  if (value < 1) return "<1";
  return formatInteger(Math.round(value));
}

/** "Sep 29", or "Sep 29, 2025" outside the current UTC year. */
export function formatAddedDate(addedAt: string, now: Date = new Date()): string {
  const key = recordedAtDateKey(addedAt);
  if (key === null) return "--";
  return key.slice(0, 4) === String(now.getUTCFullYear()) ? formatMonthDay(key) : formatDateOnly(key);
}

/** Screen-reader reason for a "--" cell. */
export function missingReasonFor(entry: WatchlistEntry): string {
  switch (entry.priceStatus) {
    case "withheld":
      return "Price withheld";
    case "never":
      return "Never priced";
    case "untracked":
      return "No longer tracked";
    default:
      return "Not available";
  }
}
```

For x MSRP, import WP28's formatter: `import { formatMsrpMultiple } from "../../lib/productAttributes";` in the table and list files (step 13), used as `formatMsrpMultiple(entry.msrpMultiple) ?? "--"`. If WP28 has not landed (Before you start), add this to `watchlistFormat.ts` instead and import it from there:

```ts
/** Stand-in until WP28 lands: 1.378 -> "1.4x". Delete when lib/productAttributes.ts exists. */
export function formatMsrpMultiple(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return null;
  return `${value < 9.95 ? value.toFixed(1) : Math.round(value).toString()}x`;
}
```

### Step 13. The watchlist page

13a. `frontend/app/components/watchlist/RemoveButton.tsx` (new):

```tsx
import type { WatchlistEntry } from "../../lib/watchlist";

export default function RemoveButton({
  entry,
  onRemove,
}: {
  entry: WatchlistEntry;
  onRemove: (entry: WatchlistEntry) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onRemove(entry)}
      aria-label={`Remove ${entry.name} from watchlist`}
      className="inline-flex size-9 items-center justify-center rounded-control text-ink-soft hover:bg-surface-alt hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action pointer-coarse:size-11"
    >
      <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true" focusable="false">
        <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    </button>
  );
}
```

13b. `frontend/app/components/watchlist/WatchlistTable.tsx` (new, desktop from 768 px):

```tsx
"use client";

import Link from "next/link";
import { useMemo } from "react";
import SortableTable, { type SortableColumn } from "../SortableTable/SortableTable";
import AsOf from "../ui/AsOf";
import Delta from "../ui/Delta";
import RemoveButton from "./RemoveButton";
import { useCurrency } from "../../context/CurrencyContext";
import { productHref } from "../nav/navConfig";
import { formatMsrpMultiple } from "../../lib/productAttributes";
import { watchSortValue, type WatchlistEntry, type WatchSort, type WatchSortKey } from "../../lib/watchlist";
import {
  formatAddedDate,
  formatDaysOfSupply,
  formatOffHigh,
  missingReasonFor,
  visibleMissingReason,
} from "./watchlistFormat";

export interface WatchlistViewProps {
  items: readonly WatchlistEntry[];
  sort: WatchSort;
  onSortChange: (next: WatchSort) => void;
  /** Render the x MSRP column (only when some row has a multiple). */
  showMsrp: boolean;
  onRemove: (entry: WatchlistEntry) => void;
}

type Column = SortableColumn<WatchlistEntry, WatchSortKey>;

const NUM = "px-3 text-right tabular-nums whitespace-nowrap";
const rowKey = (entry: WatchlistEntry) => String(entry.productId);

function changeColumn(id: string, label: string, key: "change1d" | "change7d" | "change30d"): Column {
  return {
    id,
    label,
    sortKey: key,
    align: "right",
    widthClassName: "w-20",
    cellClassName: NUM,
    cell: (entry) => <Delta value={entry[key]} missingReason={missingReasonFor(entry)} />,
  };
}

export default function WatchlistTable({ items, sort, onSortChange, showMsrp, onRemove }: WatchlistViewProps) {
  const { formatPrice } = useCurrency();

  const columns = useMemo<Column[]>(() => {
    const list: Column[] = [
      {
        id: "product",
        label: "Product",
        sortKey: "name",
        cellClassName: "px-3 truncate",
        cellTitle: (entry) => entry.name,
        cell: (entry) => {
          const reason = visibleMissingReason(entry);
          return (
            <>
              <Link
                href={productHref(entry.productId)}
                prefetch={false}
                className="rounded-control font-medium text-ink hover:text-action focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
              >
                {entry.name}
              </Link>
              {reason && <span className="ml-2 text-caption text-ink-soft">{reason}</span>}
            </>
          );
        },
      },
      {
        id: "price",
        label: "Price",
        sortKey: "price",
        align: "right",
        widthClassName: "w-32",
        cellClassName: NUM,
        cell: (entry) => (
          <span className="inline-flex items-center justify-end gap-1">
            {entry.usdPrice === null ? (
              <>
                <span aria-hidden="true">--</span>
                <span className="sr-only">{missingReasonFor(entry)}</span>
              </>
            ) : (
              <span className="font-semibold text-ink">{formatPrice(entry.usdPrice)}</span>
            )}
            <AsOf date={entry.priceDay} variant="table" />
          </span>
        ),
      },
      changeColumn("change1d", "1D", "change1d"),
      changeColumn("change7d", "7D", "change7d"),
      changeColumn("change30d", "30D", "change30d"),
      {
        id: "offHigh",
        label: "vs 52W high",
        sortKey: "offHigh",
        align: "right",
        widthClassName: "w-28",
        cellClassName: `${NUM} text-ink-soft`,
        cell: (entry) => formatOffHigh(entry.offHigh52wPct),
      },
    ];
    if (showMsrp) {
      list.push({
        id: "msrp",
        label: "x MSRP",
        sortKey: "msrp",
        align: "right",
        widthClassName: "w-20",
        cellClassName: `${NUM} text-ink-soft`,
        cell: (entry) => formatMsrpMultiple(entry.msrpMultiple) ?? "--",
      });
    }
    list.push(
      {
        id: "dos",
        label: "Days of supply",
        sortKey: "dos",
        align: "right",
        widthClassName: "w-28",
        cellClassName: `${NUM} text-ink-soft`,
        cell: (entry) => formatDaysOfSupply(entry.daysOfSupply),
      },
      {
        id: "added",
        label: "Added",
        sortKey: "added",
        align: "right",
        widthClassName: "w-24",
        cellClassName: `${NUM} text-ink-soft`,
        cell: (entry) => formatAddedDate(entry.addedAt),
      },
      {
        id: "remove",
        label: "Remove",
        align: "right",
        widthClassName: "w-16",
        cellClassName: "px-2 text-right",
        cell: (entry) => <RemoveButton entry={entry} onRemove={onRemove} />,
      }
    );
    return list;
  }, [formatPrice, showMsrp, onRemove]);

  return (
    <SortableTable
      caption="Your watchlist"
      rows={items}
      columns={columns}
      sort={sort}
      onSortChange={onSortChange}
      sortValue={watchSortValue}
      rowKey={rowKey}
      emptyMessage="No products in your watchlist."
      minWidthClassName="min-w-[60rem]"
    />
  );
}
```

`SortableTable`'s `SortState<K>` is structurally `WatchSort`; if `tsc` disagrees, type `sort` and `onSortChange` with `SortState<WatchSortKey>` imported from `SortableTable`.

13c. `frontend/app/components/watchlist/WatchlistPhoneList.tsx` (new, below 768 px):

```tsx
"use client";

import Link from "next/link";
import { useId, useMemo } from "react";
import type { ReactNode } from "react";
import AsOf from "../ui/AsOf";
import { DataList } from "../ui/DataList";
import Delta from "../ui/Delta";
import RemoveButton from "./RemoveButton";
import { useCurrency } from "../../context/CurrencyContext";
import { productHref } from "../nav/navConfig";
import { formatMsrpMultiple } from "../../lib/productAttributes";
import {
  WATCH_SORT_OPTIONS,
  sortEntries,
  type WatchlistEntry,
  type WatchSortKey,
} from "../../lib/watchlist";
import {
  formatAddedDate,
  formatDaysOfSupply,
  formatOffHigh,
  isStalePriceDay,
  missingReasonFor,
  visibleMissingReason,
} from "./watchlistFormat";
import type { WatchlistViewProps } from "./WatchlistTable";

type ChangeKey = "change1d" | "change7d" | "change30d";
const CHANGE_LABEL: Record<ChangeKey, string> = { change1d: "1D", change7d: "7D", change30d: "30D" };

function changeKeyFor(key: WatchSortKey): ChangeKey {
  return key === "change1d" || key === "change30d" ? key : "change7d";
}

/**
 * Line 2, left. A stale or withheld price says so in words ("Last priced
 * Sep 25" with the clock): the desktop table's tooltip clock says nothing on
 * touch. A row with no price and no date says why. Otherwise the sort's meta.
 */
function lineTwoFor(entry: WatchlistEntry, key: WatchSortKey): ReactNode {
  if (isStalePriceDay(entry.priceDay)) return <AsOf date={entry.priceDay} />;
  return visibleMissingReason(entry) ?? metaFor(entry, key);
}

/** The sorted metric when the row has no other place for it. */
function metaFor(entry: WatchlistEntry, key: WatchSortKey): string {
  if (key === "msrp") return `${formatMsrpMultiple(entry.msrpMultiple) ?? "--"} MSRP`;
  if (key === "added") return `Added ${formatAddedDate(entry.addedAt)}`;
  if (key === "dos") return `Supply: ${formatDaysOfSupply(entry.daysOfSupply)} days`;
  const parts: string[] = [];
  if (entry.offHigh52wPct !== null) parts.push(`52W high: ${formatOffHigh(entry.offHigh52wPct)}`);
  if (entry.daysOfSupply !== null) parts.push(`Supply: ${formatDaysOfSupply(entry.daysOfSupply)} days`);
  return parts.length > 0 ? parts.join(" · ") : (entry.setCode ?? "");
}

export default function WatchlistPhoneList({ items, sort, onSortChange, showMsrp, onRemove }: WatchlistViewProps) {
  const { formatPrice } = useCurrency();
  const selectId = useId();
  const sorted = useMemo(() => sortEntries(items, sort), [items, sort]);
  const options = WATCH_SORT_OPTIONS.filter((option) => showMsrp || option.key !== "msrp");
  const current = WATCH_SORT_OPTIONS.find((option) => option.key === sort.key) ?? WATCH_SORT_OPTIONS[0];
  const changeKey = changeKeyFor(sort.key);

  return (
    <div>
      <div className="mb-3 flex items-end gap-2 px-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={selectId} className="text-caption font-semibold uppercase tracking-wide text-ink-soft">
            Sort by
          </label>
          <select
            id={selectId}
            value={sort.key}
            onChange={(event) => {
              const key = event.target.value as WatchSortKey;
              const option = WATCH_SORT_OPTIONS.find((o) => o.key === key) ?? WATCH_SORT_OPTIONS[0];
              onSortChange({ key, direction: option.defaultDirection });
            }}
            className="h-11 w-full rounded-control border border-line bg-surface px-3 text-base text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
          >
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => onSortChange({ key: sort.key, direction: sort.direction === "asc" ? "desc" : "asc" })}
          className="h-11 shrink-0 rounded-control border border-line bg-surface px-3 text-small font-semibold text-ink hover:bg-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
        >
          {current.directionLabels[sort.direction]}
          <span className="sr-only">
            {`. Switch to ${current.directionLabels[sort.direction === "asc" ? "desc" : "asc"].toLowerCase()}`}
          </span>
        </button>
      </div>
      <DataList label="Your watchlist">
        {sorted.map((entry) => (
          <li key={entry.productId} className="flex items-stretch">
            <Link
              href={productHref(entry.productId)}
              prefetch={false}
              className="flex min-h-14 min-w-0 flex-1 flex-col justify-center px-4 py-2 hover:bg-surface-alt active:bg-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-body font-medium text-ink">{entry.typeLabel}</span>
                {entry.setName && <span className="truncate text-small text-ink-soft">{entry.setName}</span>}
              </span>
              <span className="mt-0.5 flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-small text-ink-soft">{lineTwoFor(entry, sort.key)}</span>
                <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                  <span className="text-body font-semibold text-ink">
                    {entry.usdPrice === null ? (
                      <>
                        <span aria-hidden="true">--</span>
                        <span className="sr-only">{missingReasonFor(entry)}</span>
                      </>
                    ) : (
                      formatPrice(entry.usdPrice)
                    )}
                  </span>
                  <Delta value={entry[changeKey]} period={CHANGE_LABEL[changeKey]} missingReason={missingReasonFor(entry)} />
                </span>
              </span>
            </Link>
            <span className="flex shrink-0 items-center pr-2">
              <RemoveButton entry={entry} onRemove={onRemove} />
            </span>
          </li>
        ))}
      </DataList>
    </div>
  );
}
```

13d. `frontend/app/portfolio/watchlist/page.tsx` (new, server; metadata only):

```tsx
import type { Metadata } from "next";
import { NO_INDEX } from "../../lib/site";
import WatchlistView from "./WatchlistView";

export const metadata: Metadata = {
  title: "Watchlist",
  description: "The sealed products you watch: price, daily change, distance from the 52-week high and supply.",
  robots: NO_INDEX,
};

export default function WatchlistPage() {
  return <WatchlistView />;
}
```

13e. `frontend/app/portfolio/watchlist/WatchlistView.tsx` (new):

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../../context/AuthContext";
import SessionUnavailable from "../../components/SessionUnavailable";
import PortfolioTabs from "../../components/Portfolio/PortfolioTabs";
import SearchTrigger from "../../components/search/SearchTrigger";
import PageHeader from "../../components/ui/PageHeader";
import ProvenanceLine from "../../components/ui/ProvenanceLine";
import EmptyState from "../../components/ui/EmptyState";
import Skeleton from "../../components/ui/Skeleton";
import Button, { buttonClasses } from "../../components/ui/Button";
import WatchlistTable from "../../components/watchlist/WatchlistTable";
import WatchlistPhoneList from "../../components/watchlist/WatchlistPhoneList";
import { loginPathWithNext } from "../../lib/redirects";
import { metricHref } from "../../lib/metricDefinitions";
import { PROVENANCE_SENTENCE } from "../../content/disclosures";
import { formatDateOnly, formatInteger } from "../../lib/format";
import { addToWatchlist, fetchWatchlist, removeFromWatchlist } from "../../lib/watchlistApi";
import { noteWatched } from "../../lib/watchlistStore";
import {
  DEFAULT_WATCH_SORT,
  WATCHLIST_PAGE_PATH,
  type WatchlistEntry,
  type WatchlistPayload,
  type WatchSort,
} from "../../lib/watchlist";

type Load = { reload: number; payload: WatchlistPayload } | { reload: number; failed: true };

type Notice =
  | { kind: "removed"; entry: WatchlistEntry; pending: boolean }
  | { kind: "restoring"; entry: WatchlistEntry }
  | { kind: "restored"; entry: WatchlistEntry }
  | { kind: "error"; text: string };

const LINK = "rounded-control font-medium text-action underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action";

/** "Find a product": opens WP27's header search; the product page it leads to has Watch. */
function FindProduct() {
  return <SearchTrigger className={buttonClasses({ variant: "secondary" })}>Find a product</SearchTrigger>;
}

function Shell({ children, provenance, actions }: { children: ReactNode; provenance?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Watchlist" provenance={provenance} actions={actions} />
      <PortfolioTabs current="watchlist" className="mb-5 mt-4 md:mb-6" />
      {children}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div role="status" className="space-y-2">
      <span className="sr-only">Loading your watchlist</span>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

export default function WatchlistView() {
  const { user, sessionStatus, loading: authLoading, refreshSession } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (sessionStatus === "anonymous") router.push(loginPathWithNext(WATCHLIST_PAGE_PATH));
  }, [sessionStatus, router]);

  if (sessionStatus === "unknown") {
    return authLoading ? (
      <Shell>
        <ListSkeleton />
      </Shell>
    ) : (
      <SessionUnavailable onRetry={refreshSession} />
    );
  }
  if (sessionStatus === "anonymous" || !user) {
    return (
      <Shell>
        <p className="text-body text-ink-soft">Redirecting to sign in…</p>
      </Shell>
    );
  }
  return <WatchlistLoaded key={user.id} />;
}

function WatchlistLoaded() {
  const [reload, setReload] = useState(0);
  const [load, setLoad] = useState<Load | null>(null);
  const [items, setItems] = useState<WatchlistEntry[]>([]);
  const [sort, setSort] = useState<WatchSort>(DEFAULT_WATCH_SORT);
  const [notice, setNotice] = useState<Notice | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchWatchlist(controller.signal).then(
      (payload) => {
        setLoad({ reload, payload });
        setItems(payload.items);
      },
      () => {
        if (!controller.signal.aborted) setLoad({ reload, failed: true });
      }
    );
    return () => controller.abort();
  }, [reload]);

  // Keep focus on the status line's controls when a row disappears or comes back.
  useEffect(() => {
    if (notice?.kind === "removed") undoRef.current?.focus();
    else if (notice?.kind === "restored" || notice?.kind === "error") noticeRef.current?.focus();
  }, [notice]);

  const remove = useCallback(async (entry: WatchlistEntry) => {
    setItems((current) => current.filter((item) => item.productId !== entry.productId));
    setNotice({ kind: "removed", entry, pending: true });
    const result = await removeFromWatchlist(entry.productId);
    if (result.ok) {
      noteWatched(entry.productId, false);
      setNotice({ kind: "removed", entry, pending: false });
    } else {
      setItems((current) =>
        current.some((item) => item.productId === entry.productId) ? current : [...current, entry]
      );
      setNotice({ kind: "error", text: result.message });
    }
  }, []);

  const undo = useCallback(async () => {
    if (notice?.kind !== "removed" || notice.pending) return;
    const { entry } = notice;
    setNotice({ kind: "restoring", entry });
    const result = await addToWatchlist(entry.productId);
    if (result.ok) {
      noteWatched(entry.productId, true);
      setItems((current) =>
        current.some((item) => item.productId === entry.productId)
          ? current
          : [...current, { ...entry, addedAt: new Date().toISOString() }]
      );
      setNotice({ kind: "restored", entry });
    } else {
      setNotice({ kind: "error", text: result.message });
    }
  }, [notice]);

  const current = load !== null && load.reload === reload ? load : null;

  if (current === null) {
    return (
      <Shell>
        <ListSkeleton />
      </Shell>
    );
  }
  if ("failed" in current) {
    return (
      <Shell>
        <EmptyState
          title="Your watchlist could not be loaded"
          description="This is usually temporary."
          action={<Button onClick={() => setReload((n) => n + 1)}>Try again</Button>}
        />
      </Shell>
    );
  }

  const { payload } = current;
  const count = items.length;
  const full = count >= payload.max;
  const showMsrp = items.some((item) => item.msrpMultiple !== null);
  const through = payload.statsDay ? `, through ${formatDateOnly(payload.statsDay)} (UTC)` : "";
  const provenance = (
    <ProvenanceLine methodologyHref={metricHref("priceChange")} methodologyLabel="How changes are calculated">
      {`${formatInteger(count)} of ${formatInteger(payload.max)} products${full ? " (full)" : ""}. ${PROVENANCE_SENTENCE} Changes are measured in USD${through}.`}
    </ProvenanceLine>
  );

  return (
    <Shell provenance={provenance} actions={count > 0 ? <FindProduct /> : undefined}>
      {/* The status line exists (empty) from the first loaded render, so its first message is announced. */}
      <div className={notice ? "mb-4 flex flex-wrap items-center gap-3" : ""}>
        <p ref={noticeRef} tabIndex={-1} role="status" className="text-small text-ink focus:outline-hidden">
          {notice?.kind === "removed" && `Removed ${notice.entry.name}.`}
          {notice?.kind === "restoring" && `Putting back ${notice.entry.name}…`}
          {notice?.kind === "restored" && `Put back ${notice.entry.name}.`}
          {notice?.kind === "error" && notice.text}
        </p>
        {notice?.kind === "removed" && (
          <button
            ref={undoRef}
            type="button"
            onClick={undo}
            aria-disabled={notice.pending ? true : undefined}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Undo
          </button>
        )}
      </div>
      {count === 0 ? (
        <EmptyState
          title="You are not watching any products yet"
          description="Select Watch on any product page to follow its price, change and supply here. Prices update daily."
          action={<FindProduct />}
        />
      ) : (
        <>
          <div className="-mx-4 md:hidden">
            <WatchlistPhoneList items={items} sort={sort} onSortChange={setSort} showMsrp={showMsrp} onRemove={remove} />
          </div>
          <div className="hidden md:block">
            <WatchlistTable items={items} sort={sort} onSortChange={setSort} showMsrp={showMsrp} onRemove={remove} />
          </div>
          <p className="mt-4 text-small text-ink-soft">
            How these are calculated:{" "}
            <Link href={metricHref("priceChange")} prefetch={false} className={LINK}>Change</Link>
            {" · "}
            <Link href={metricHref("range52w")} prefetch={false} className={LINK}>52-week high</Link>
            {showMsrp && (
              <>
                {" · "}
                <Link href={metricHref("msrpMultiple")} prefetch={false} className={LINK}>x MSRP</Link>
              </>
            )}
            {" · "}
            <Link href={metricHref("daysOfSupply")} prefetch={false} className={LINK}>Days of supply</Link>
          </p>
        </>
      )}
    </Shell>
  );
}
```

Notes:
- If WP28 has not landed, `"msrpMultiple"` is not a `MetricKey` and `tsc` fails: delete the x MSRP link block (the column is hidden anyway without data).
- If `PageHeader` has no `provenance` prop in the tree (WP23 defines it), render the `ProvenanceLine` directly under the header instead.
- Both the phone list and the table are in the DOM; CSS shows one. Do not choose between them with `matchMedia` in state (WP18's F073 rule: it causes hydration mismatches).
- State is set only in promise callbacks and event handlers; the focus effect calls no setter.
- `PROVENANCE_SENTENCE` (WP24, `app/content/disclosures.ts`, import-free) is the site's one source and cadence sentence; do not retype it. `metricHref("priceChange")` is WP31's key and `metricHref("range52w")` WP25's.
- `FindProduct` uses WP27's `SearchTrigger`, which dispatches the event the header's search launcher listens to and preloads the panel chunk only on hover or focus, so it adds no catalog download to this route. It appears in the header actions when the list has rows and as the empty state's only action; not in the loading or failed states.
- WP35 adds hooks directly after the two `useRef` lines of `WatchlistLoaded` and props to both views: keep the hook order (all hooks before the first early `return`) and the `WatchlistViewProps` name.

### Step 14. Home: `frontend/app/components/home/WatchlistMovers.tsx` (new) and `app/page.tsx`

14a. The component:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import Price from "../Price";
import Delta from "../ui/Delta";
import Skeleton from "../ui/Skeleton";
import { DataList, DataListRow } from "../ui/DataList";
import { HOME_LINK } from "./homeStyles";
import { productHref } from "../nav/navConfig";
import { formatInteger } from "../../lib/format";
import { fetchWatchlistMovers } from "../../lib/watchlistApi";
import { WATCHLIST_PAGE_PATH, type WatchlistMoversPayload } from "../../lib/watchlist";

type Loaded = { userId: string; payload: WatchlistMoversPayload } | { userId: string; failed: true };

function Body({ current }: { current: Loaded | null }) {
  if (current === null) {
    return (
      <div role="status">
        <span className="sr-only">Loading your watchlist</span>
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-2 h-6 w-48" />
      </div>
    );
  }
  if ("failed" in current) return <p className="text-small text-ink-soft">Your watchlist could not be loaded.</p>;
  const { payload } = current;
  if (payload.count === 0) {
    return (
      <p className="text-small text-ink-soft">
        You are not watching any products yet.{" "}
        <Link href="/prices" prefetch={false} className={HOME_LINK}>
          Browse prices
        </Link>
      </p>
    );
  }
  if (payload.movers.length === 0) {
    return <p className="text-small text-ink-soft">None of your watched products has a 7-day change yet.</p>;
  }
  return (
    <>
      <DataList label="Watchlist movers, 7 days" className="-mx-4 md:mx-0">
        {payload.movers.map((entry) => (
          <DataListRow
            key={entry.productId}
            href={productHref(entry.productId)}
            title={entry.typeLabel}
            subtitle={entry.setName ?? undefined}
            value={<Price usd={entry.usdPrice} />}
            delta={<Delta value={entry.change7d} period="7D" />}
          />
        ))}
      </DataList>
      <p className="mt-2 text-caption text-ink-soft">
        Largest 7-day moves among your {formatInteger(payload.count)} watched products.
      </p>
    </>
  );
}

/**
 * "Watchlist movers, 7D" (WP34): the second column of WP32's YourPokefin
 * island. YourPokefin renders its children only for a signed-in session, so
 * this never appears in the server HTML of the ISR home page.
 */
export default function WatchlistMovers() {
  const { user, sessionStatus } = useAuth();
  const userId = sessionStatus === "authenticated" && user ? user.id : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (userId === null) return;
    const controller = new AbortController();
    fetchWatchlistMovers(controller.signal).then(
      (payload) => setLoaded({ userId, payload }),
      () => {
        if (!controller.signal.aborted) setLoaded({ userId, failed: true });
      }
    );
    return () => controller.abort();
  }, [userId]);

  if (userId === null) return null;
  const current = loaded !== null && loaded.userId === userId ? loaded : null;

  return (
    <div data-slot="watchlist" className="min-h-24">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-body font-semibold text-ink">Watchlist movers, 7D</h3>
        <Link href={WATCHLIST_PAGE_PATH} prefetch={false} className={HOME_LINK}>
          Open watchlist
        </Link>
      </div>
      <div className="mt-2">
        <Body current={current} />
      </div>
    </div>
  );
}
```

If `DataList` has no `className` prop, drop it. The `h3` sits under WP32's `h2` "Your Pokéfin".

14b. `app/page.tsx`: add `import WatchlistMovers from "./components/home/WatchlistMovers";` and replace WP32's self-closing `<YourPokefin className={`${AFTER_MOVERS_ON_PHONE} ${WIDE}`} />` with:

```tsx
      <YourPokefin className={`${AFTER_MOVERS_ON_PHONE} ${WIDE}`}>
        <WatchlistMovers />
      </YourPokefin>
```

Nothing else in `app/page.tsx` changes. WP32's home shell test keeps passing: the new file is a client component, uses tokens only, and calls neither `/api/portfolio` nor `/api/public/*`.

### Step 15. Navigation: the Watchlist entry in the account menu and the phone sheet (WP27)

15a. `app/components/nav/navConfig.ts`: add to `ACCOUNT_NAV`, before `settings`:

```ts
  watchlist: { key: "watchlist", label: "Watchlist", href: "/portfolio/watchlist", description: "Products you watch", match: ["/portfolio/watchlist"], prefetch: false },
```

Do not add it to `PRIMARY_NAV` or `FOOTER_ACCOUNT` (Portfolio already covers the section, and its `match` includes `/portfolio/watchlist`).

15b. `app/components/Header.tsx`, signed-in account menu: directly above the `ACCOUNT_NAV.settings` `<Link>`, add the same element for `ACCOUNT_NAV.watchlist` (copy the settings link's JSX and change only the two `ACCOUNT_NAV.settings` references).

15c. `app/components/nav/MobileNavSheet.tsx`, signed-in block: directly above the `<li>` holding the `ACCOUNT_NAV.settings` link, add the same `<li>` for `ACCOUNT_NAV.watchlist`.

### Step 16. Lint lists, budgets, types, copy, docs

16a. `eslint.config.mjs`:
- Append to `ANON_CLIENT_FORBIDDEN_FILES`: `"app/api/watchlist/**/*.ts",` with the comment `// WP34: watchlist route`. (`app/lib/server/**` and `app/portfolio/**` are already listed.)
- Append to `PUBLIC_ROUTE_CLIENT_FILES` (WP26): `"app/components/watchlist/**/*.{ts,tsx}", "app/lib/watchlist.ts", "app/lib/watchlistApi.ts", "app/lib/watchlistStore.ts",` with the comment `// WP34: the Watch island runs on /product/[id] and screener rows`. None of these four may also be in `ANON_CLIENT_FORBIDDEN_FILES` (WP26's rule: for files both lists match, the later `no-restricted-imports` object replaces the earlier one's options); check with `grep -n "watchlist" eslint.config.mjs` after the edit: only the route glob is in the anon list.
- In WP05's user-table `no-restricted-syntax` selector, add `watchlist_items` to the alternation, for example `/^(portfolios|portfolio_holdings|portfolio_lots|profiles|box_recipes|watchlist_items)$/` (keep whatever names are there and append).

Then `pnpm lint` must be 0 errors. An error means a watchlist module reaches Supabase or a browser file queries `watchlist_items`: fix the import, never the rule.

16b. **Phase B only**, after Owner action 1: from `frontend/`, `pnpm types:db`, then `grep -c "watchlist_items" app/types/database.ts` (expect 1 or more) and `pnpm exec tsc --noEmit` (exit 0). Commit the regenerated file alone. Do not hand-edit `database.ts` in phase A and do not cast the client to `any`.

16c. `perf-budgets.json` (WP22): next to the `/portfolio` route entry add

```json
    "/portfolio/watchlist": {
      "source": "manifest",
      "jsGzKb": { "target": 180, "limit": null, "recorded": null }
    },
```

and in `rum.targets` add `"/portfolio/watchlist": { "lcpMs": 2500, "inpMs": 200, "cls": 0.05, "ttfbMs": 900 },`. Then run the perf build and `pnpm perf:budget --write-limits` (Verification block 3). Only the new route's `limit` and `recorded` may change; every other limit must stay the same or go down. If `/product/900001` or `/` goes above its limit, stop and shrink the island (it must not import `redirects.ts`, `loginCopy.ts`, `format.ts` or a component library); never add a raise line for this package.

16d. `app/privacy/page.tsx` (WP24): in "What we collect", after the "Box calculator data" item, add `<li><strong>Watchlist</strong>: the products you watch and when you added them.</li>`; in "How long we keep it", change "portfolios, holdings, lots and box recipes" to "portfolios, holdings, lots, box recipes and watchlist" (in WP24's JSX the phrase wraps after "lots"; `grep -n "holdings, lots" app/privacy/page.tsx` finds it). In "How we use it", change "show your portfolio and saved recipes" to "show your portfolio, saved recipes and watchlist". Set the page's last-updated date constant (`grep -n "LAST_UPDATED" app/privacy/page.tsx`) to the merge day (`date -u +%F`).

16e. `app/account/page.tsx`: in the "Your data" sentence (`grep -n "box recipes" app/account/page.tsx`), add "watchlist" to the list of exported records ("profile, portfolios, holdings, lots, box recipes and watchlist"). Change nothing else on the page.

16f. `README.md` (repo root), Database section: where the per-user tables are listed (`grep -n "box_recipes" README.md`), add `watchlist_items` (owner-only RLS, 200 per user, migration 0044). If the section has no such list, add one sentence: "`watchlist_items` (0044, WP34) holds one row per watched product per user; it is read and written only through `app/api/watchlist/route.ts`."

### Step 17. Screener rows (only if WP33 has landed)

WP33's desktop table is its own component (`ScreenerTable.tsx` and the memoised `ScreenerTableRow.tsx`, sticky rank and product columns, `border-separate`), not `SortableTable`, and its phone rows are WP23 `DataListRow`s. The Watch control is the icon variant in a trailing unsortable column on desktop and a sibling of the row link on phones. Its accessible name carries the product and variant, so 300 "Watch" buttons are distinguishable in a screen reader's controls list.

If Before you start printed no Screener files, skip 17a to 17d and put this paragraph in the PR (and ask the owner to file it as a follow-up on WP33): "When WP33 lands, add the Watch row action: a trailing `<td className="border-b border-line px-2 text-right"><WatchButton productId={row.id} productName={row.variant ? `${name} (${row.variant})` : name} variant="icon" /></td>` in `ScreenerTableRow`, a matching `<col style={{ width: 56 }} />`, an `<th scope="col">` with sr-only "Watch" and `+ 56` in `ScreenerTable`'s `minWidth`, and on phones the `DataListRow` `action` slot exactly as WP34 step 17c writes it."

If it printed the three files:

17a. `app/components/Screener/ScreenerTableRow.tsx`: add `import WatchButton from "../watchlist/WatchButton";` and, after the trend `<td>` (the last cell), add:

```tsx
      <td className="border-b border-line px-2 text-right">
        <WatchButton productId={row.id} productName={row.variant ? `${name} (${row.variant})` : name} variant="icon" />
      </td>
```

The row stays memoised with the same props: the button subscribes to the watchlist store itself.

17b. `app/components/Screener/ScreenerTable.tsx`: add `const WATCH_PX = 56;` next to `TREND_PX`, add `+ WATCH_PX` to `minWidth`, add `<col style={{ width: WATCH_PX }} />` after the trend `<col>`, and after the "Trend 1Y" `<th>` add:

```tsx
            <th scope="col" className={TH}>
              <span className="sr-only">Watch</span>
            </th>
```

17c. Phone rows: WP23's `DataListRow` gets an optional action slot. In `app/components/ui/DataList.tsx` add to `DataListRowProps`:

```ts
  /** A control beside the row link (WP34: the Watch star). Never inside the link. */
  action?: ReactNode;
```

and destructure `action`. Replace the component's `return (...)` with:

```tsx
  const row = href ? (
    <Link
      href={href}
      prefetch={prefetch}
      className={`${ROW} ${action ? "min-w-0 flex-1 " : ""}hover:bg-surface-alt active:bg-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action`}
    >
      {body}
    </Link>
  ) : (
    <div className={action ? `${ROW} min-w-0 flex-1` : ROW}>{body}</div>
  );

  if (!action) return <li>{row}</li>;
  return (
    <li className="flex items-stretch">
      {row}
      <span className="flex shrink-0 items-center pr-2">{action}</span>
    </li>
  );
```

Without `action` the rendered markup is byte-identical to before (WP23's DataList test, WP32's home rows and WP33's rows without the prop do not change; the extra space inside the Link's class template is only added with `action`). Check it: `pnpm exec jest app/components/ui` passes unchanged. In `app/components/Screener/ScreenerPhoneList.tsx`, add `import WatchButton from "../watchlist/WatchButton";` and pass to the `DataListRow` in `ScreenerListItem`:

```tsx
      action={<WatchButton productId={row.id} productName={row.variant ? `${screenerProductName(row)} (${row.variant})` : screenerProductName(row)} variant="icon" />}
```

Add one case to WP23's `app/components/ui/__tests__/DataList.test.tsx`: with `action={<button type="button">Act</button>}` the `<li>` holds the link and the button as siblings (`link.contains(button)` is false) and axe is clean.

17d. If a WP33 test counts table headers, `<col>` elements or cells per row, add one to its expectation; if it snapshots the phone row, update the snapshot and say so in the PR. `app/components/Screener/**` is already in `PUBLIC_ROUTE_CLIENT_FILES` (WP33); `app/components/watchlist/**` is added by step 16a. Report the `/screener` row of `pnpm perf:budget` in the PR.

### Step 18. Tests

Write every file in the Tests section alongside the step it covers.

### Step 19. End of phase A

Run Verification blocks 1 to 4, push, open the draft PR `[waiting for DB types] WP34: Watchlist`, and hand the owner Owner actions 1 and 2. After the owner confirms, run step 16b and Verification block 5, then mark the PR ready.

## Pitfalls: do not do this

- **Do not read the session on a public page.** No `cookies()`, `headers()`, `searchParams`, `connection()` or `export const dynamic` in `app/product/[id]/page.tsx` or `app/page.tsx` for the watch state. Membership is read in the browser, after hydration, through `GET /api/watchlist?ids=`.
- **Do not call the route when signed out.** `WatchButton` and `WatchlistMovers` fetch only when `sessionStatus === "authenticated"`; an anonymous visitor must cause zero `/api/watchlist` requests (the perf build and the CDN depend on it).
- **Do not fetch membership per button.** All buttons go through `watchlistStore.ts`; 300 Screener rows are at most 2 requests. A per-button fetch would hit the proxy's 60/min limit.
- **Do not use `useSearchParams` in `WatchButton`.** It forces a Suspense boundary or a client bailout on ISR pages. Read `window.location` in the click handler.
- **Do not change the Watch button's label with its state.** The name stays "Watch" (or "Watch {product}"); `aria-pressed` carries the state. "Watching" as a label would break the toggle pattern and label-in-name.
- **Do not print "Added to your watchlist." visibly beside the button, and do not wrap `{watch}` in another element in `ProductActions`.** Visible success text widens the actions row after the request returns, which moves "View on TCGplayer" under the pointer and shifts the chart below (layout shift outside the 500 ms input window). Success is the pressed state plus the sr-only announcement; only errors print, on their own line.
- **Do not use `transition-colors`, `transition-all` or `outline-none`** in any new file. Colour changes are instant (01-PRODUCT-DIRECTION.md §3.5) and Tailwind 4's `outline-none` removes the focus cue in forced-colours mode (WP23): use `focus-visible:outline-hidden` with the ring. Tests 15 fails on them.
- **Do not query `watchlist_items` from browser code or through the anonymous client.** Only `app/lib/server/watchlistRepo.ts` (with the cookie client) queries it; the ESLint selector enforces it.
- **Do not grant UPDATE, add a `FOR ALL` policy, or drop the explicit `user_id` filters.** Rows are insert and delete only; the filters keep reads on the primary key.
- **Do not add `ON CONFLICT` / `upsert` to the insert.** The cap trigger fires before the conflict check, so an upsert at the cap raises 23514 anyway; the repo's 23505 and 23514 handling is the design.
- **Do not answer "full" on every 23514.** Re-check existence first (the duplicate-at-cap case), or a user at 200 who re-taps Watch on a watched product sees "full".
- **Do not edit 0024 or 0011, and do not build 0044's function from memory.** Copy 0024's body plus the `'currency', currency,` line (step 1f diff). Do not drop that line: 0044 sorts after WP38's 0036, so without it every replayed database and production lose the key (WP38's `tests/test_wp38_migrations_static.py` fails). A later migration that replaces `export_my_data` must keep the `watchlist` key; the static test fails otherwise. Do not fold WP36's `purchase_currency` keys into 0044 even if 0046 is in the tree: 0046 re-patches the function after 0044 in the replay, and in production the owner re-runs 0046 after 0044 (Owner action 1).
- **Do not compute changes from `get_market_product_summaries` returns.** Those anchors are unbounded (WP25 note); use `product_daily_stats` and only when it matches the shown price.
- **Do not show a stale product's supply, changes or 52-week distance.** A withheld price means `--` in every number column; the name, the clock and the remove button remain.
- **Do not call a high over less than a year "52-week".** `offHigh52wPct` is null below 364 tracked days.
- **Do not convert changes to CAD or call them CAD returns.** They are USD Market Price changes and the page says so. Prices convert at the header's current rate like every other list.
- **Do not render `WatchlistMovers` outside `YourPokefin`,** and do not import `useSparklines`, `publicMarketApi` or a chart in `app/components/home/` (WP32's shell test).
- **Do not pick the phone or desktop layout with `matchMedia` in state.** Render both and let CSS hide one (WP18 F073).
- **Do not remove WP27's `watchLoginPath` or `intent=watch` handling.** This package adds the `watch` parameter beside it.
- **Do not add a "danger" button variant or red** for remove; it is a ghost icon with a full accessible name and an Undo.
- **Do not add `export const dynamic` or `runtime` to the route,** and do not export anything but `GET`, `POST` and `DELETE` from `route.ts`.
- **Do not apply the migration to production yourself** and do not edit `verify_migration.py`, `schema.sql` or any earlier migration.

## Tests

Route and repo tests start with `/** @jest-environment node */`. Mock `routeSupabase` and `server-only` as WP05 does. Component tests use jsdom, `@testing-library/react`, and `axeViolations` from `@/test-utils/axe`. Python database tests are skipped unless `POKEFIN_TEST_DATABASE_URL` is set (CI job "Database replay and Python tests" sets it to `replay_once`).

### 1. `tests/test_wp34_watchlist_db.py` (new, needs the replayed database)

Every case below was run as SQL against 0044 on PostgreSQL 16.13 while this spec was written, with the results asserted here.

```python
"""
Database checks for migration 0044 (watchlist_items, WP34), run against a
database rebuilt by scripts/db/replay_migrations.sh.

Skipped unless POKEFIN_TEST_DATABASE_URL points at that replayed database as a
superuser (CI sets it; job "database"). NEVER point it at production: the
fixtures write rows.

  POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/replay_once \
    python -m pytest tests/test_wp34_watchlist_db.py -v
"""
import os
import uuid
from urllib.parse import urlparse

import pytest

DSN = os.environ.get("POKEFIN_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="POKEFIN_TEST_DATABASE_URL not set")

psycopg = pytest.importorskip("psycopg")
from psycopg import errors  # noqa: E402
from psycopg.types.json import Jsonb  # noqa: E402

TAG = "wp34-" + uuid.uuid4().hex[:8]
CAP = 200


@pytest.fixture(scope="module")
def admin():
    host = (urlparse(DSN).hostname or "").lower()
    assert host in ("localhost", "127.0.0.1", "postgres"), "refusing a non-local database"
    with psycopg.connect(DSN, autocommit=True) as conn:
        yield conn


@pytest.fixture(scope="module")
def products(admin):
    """CAP + 5 products of this run's own set."""
    set_id = admin.execute(
        "INSERT INTO public.sets (code, name) VALUES (%s, %s) RETURNING id", (TAG, TAG + " set")
    ).fetchone()[0]
    ids = [
        row[0]
        for row in admin.execute(
            "INSERT INTO public.products (set_id, usd_price, url, last_updated) "
            "SELECT %s, 10, 'https://www.tcgplayer.com/product/1', now() FROM generate_series(1, %s) "
            "RETURNING id",
            (set_id, CAP + 5),
        ).fetchall()
    ]
    yield sorted(ids)
    admin.execute("DELETE FROM public.products WHERE set_id = %s", (set_id,))  # watch rows cascade
    admin.execute("DELETE FROM public.sets WHERE id = %s", (set_id,))


def new_user(admin):
    uid = str(uuid.uuid4())
    name = "u" + uuid.uuid4().hex[:10]
    admin.execute(
        "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (%s, %s, %s)",
        (uid, f"{name}@example.com", Jsonb({"username": name})),
    )
    return uid


@pytest.fixture
def user_a(admin):
    uid = new_user(admin)
    yield uid
    admin.execute("DELETE FROM auth.users WHERE id = %s", (uid,))


@pytest.fixture
def user_b(admin):
    uid = new_user(admin)
    yield uid
    admin.execute("DELETE FROM auth.users WHERE id = %s", (uid,))


def as_user(admin, uid):
    admin.execute("BEGIN")
    admin.execute("SET LOCAL ROLE authenticated")
    admin.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", (uid,))


def as_role(admin, role):
    admin.execute("BEGIN")
    admin.execute(f"SET LOCAL ROLE {role}")


def rollback(admin):
    admin.execute("ROLLBACK")


def watch(admin, uid, product_ids):
    """Insert as the user and commit."""
    as_user(admin, uid)
    try:
        for pid in product_ids:
            admin.execute(
                "INSERT INTO public.watchlist_items (user_id, product_id) VALUES (%s, %s)", (uid, pid)
            )
        admin.execute("COMMIT")
    except Exception:
        rollback(admin)
        raise


def count_as(admin, uid):
    as_user(admin, uid)
    try:
        return admin.execute("SELECT count(*) FROM public.watchlist_items").fetchone()[0]
    finally:
        rollback(admin)


class TestRls:
    def test_owner_reads_and_deletes_own_rows(self, admin, user_a, products):
        watch(admin, user_a, products[:2])
        assert count_as(admin, user_a) == 2
        as_user(admin, user_a)
        try:
            deleted = admin.execute(
                "DELETE FROM public.watchlist_items WHERE product_id = %s RETURNING product_id", (products[0],)
            ).fetchall()
            assert [r[0] for r in deleted] == [products[0]]
        finally:
            rollback(admin)

    def test_other_user_sees_and_deletes_nothing(self, admin, user_a, user_b, products):
        watch(admin, user_a, products[:2])
        assert count_as(admin, user_b) == 0
        as_user(admin, user_b)
        try:
            gone = admin.execute(
                "DELETE FROM public.watchlist_items WHERE user_id = %s RETURNING 1", (user_a,)
            ).fetchall()
            assert gone == []
        finally:
            rollback(admin)
        assert admin.execute(
            "SELECT count(*) FROM public.watchlist_items WHERE user_id = %s", (user_a,)
        ).fetchone()[0] == 2

    def test_cannot_insert_for_another_user(self, admin, user_a, user_b, products):
        as_user(admin, user_b)
        try:
            with pytest.raises(errors.InsufficientPrivilege):  # 42501, RLS WITH CHECK
                admin.execute(
                    "INSERT INTO public.watchlist_items (user_id, product_id) VALUES (%s, %s)",
                    (user_a, products[0]),
                )
        finally:
            rollback(admin)

    def test_update_is_not_granted(self, admin, user_a, products):
        watch(admin, user_a, products[:1])
        as_user(admin, user_a)
        try:
            with pytest.raises(errors.InsufficientPrivilege):
                admin.execute("UPDATE public.watchlist_items SET created_at = now()")
        finally:
            rollback(admin)

    def test_anon_has_no_access(self, admin):
        as_role(admin, "anon")
        try:
            with pytest.raises(errors.InsufficientPrivilege):
                admin.execute("SELECT count(*) FROM public.watchlist_items")
        finally:
            rollback(admin)

    def test_scraper_role_has_no_access(self, admin):
        exists = admin.execute("SELECT 1 FROM pg_roles WHERE rolname = 'pokefin_scraper'").fetchone()
        if not exists:
            pytest.skip("pokefin_scraper not in this database")
        as_role(admin, "pokefin_scraper")
        try:
            with pytest.raises(errors.InsufficientPrivilege):
                admin.execute("SELECT count(*) FROM public.watchlist_items")
        finally:
            rollback(admin)

    def test_policies_use_the_initplan_form(self, admin):
        rows = admin.execute(
            "SELECT policyname, cmd, coalesce(qual, '') || coalesce(with_check, '') "
            "FROM pg_policies WHERE schemaname = 'public' AND tablename = 'watchlist_items' ORDER BY 1"
        ).fetchall()
        assert {(r[0], r[1]) for r in rows} == {
            ("watchlist_items_delete_own", "DELETE"),
            ("watchlist_items_insert_own", "INSERT"),
            ("watchlist_items_select_own", "SELECT"),
        }
        for _, _, expr in rows:
            assert "SELECT auth.uid()" in expr


class TestCap:
    def test_200_then_refused(self, admin, user_a, products):
        as_user(admin, user_a)
        try:
            admin.execute(
                "INSERT INTO public.watchlist_items (user_id, product_id) SELECT %s, unnest(%s::bigint[])",
                (user_a, products[:CAP]),
            )
            with pytest.raises(errors.CheckViolation):
                admin.execute(
                    "INSERT INTO public.watchlist_items (user_id, product_id) VALUES (%s, %s)",
                    (user_a, products[CAP]),
                )
        finally:
            rollback(admin)

    def test_duplicate_at_the_cap_raises_the_cap_error(self, admin, user_a, products):
        # The route relies on this: 23514 first, then an existence re-check.
        watch(admin, user_a, products[:CAP])
        as_user(admin, user_a)
        try:
            with pytest.raises(errors.CheckViolation):
                admin.execute(
                    "INSERT INTO public.watchlist_items (user_id, product_id) VALUES (%s, %s)",
                    (user_a, products[0]),
                )
        finally:
            rollback(admin)

    def test_one_statement_over_the_cap_is_refused(self, admin, user_a, products):
        as_user(admin, user_a)
        try:
            with pytest.raises(errors.CheckViolation):
                admin.execute(
                    "INSERT INTO public.watchlist_items (user_id, product_id) SELECT %s, unnest(%s::bigint[])",
                    (user_a, products[: CAP + 1]),
                )
        finally:
            rollback(admin)

    def test_duplicate_below_the_cap_is_a_unique_violation(self, admin, user_a, products):
        watch(admin, user_a, products[:1])
        as_user(admin, user_a)
        try:
            with pytest.raises(errors.UniqueViolation):
                admin.execute(
                    "INSERT INTO public.watchlist_items (user_id, product_id) VALUES (%s, %s)",
                    (user_a, products[0]),
                )
        finally:
            rollback(admin)

    def test_unknown_product_is_a_foreign_key_violation(self, admin, user_a):
        as_user(admin, user_a)
        try:
            with pytest.raises(errors.ForeignKeyViolation):
                admin.execute(
                    "INSERT INTO public.watchlist_items (user_id, product_id) VALUES (%s, %s)",
                    (user_a, 9_000_000_000),
                )
        finally:
            rollback(admin)


class TestExportAndCascade:
    def test_export_includes_the_watchlist(self, admin, user_a, products):
        watch(admin, user_a, products[:3])
        as_user(admin, user_a)
        try:
            doc = admin.execute("SELECT public.export_my_data()").fetchone()[0]
        finally:
            rollback(admin)
        assert [row["product_id"] for row in doc["watchlist"]] == products[:3]
        assert all("created_at" in row for row in doc["watchlist"])
        assert {"profile", "portfolios", "box_recipes", "watchlist"} <= set(doc)

    def test_export_is_volatile_definer_and_not_for_anon(self, admin):
        row = admin.execute(
            "SELECT p.provolatile, p.prosecdef, has_function_privilege('anon', p.oid, 'EXECUTE') "
            "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
            "WHERE n.nspname = 'public' AND p.proname = 'export_my_data'"
        ).fetchone()
        assert row == ("v", True, False)

    def test_account_deletion_removes_the_rows(self, admin, products):
        uid = new_user(admin)
        watch(admin, uid, products[:2])
        admin.execute("DELETE FROM auth.users WHERE id = %s", (uid,))
        assert admin.execute(
            "SELECT count(*) FROM public.watchlist_items WHERE user_id = %s", (uid,)
        ).fetchone()[0] == 0
```

If a fixture INSERT fails with `NotNullViolation` or `CheckViolation` because `products` or `sets` carry a required column the fixture omits (for example after WP28), add that column with a valid value, as WP21's note says. Never weaken an assertion. The export test runs as `authenticated` inside a rolled-back transaction, so its audit row disappears with it.

### 2. `tests/test_wp34_watchlist_static.py` (new, no database)

```python
"""
Static checks for migration 0044 (WP34). No database needed.

  python -m pytest tests/test_wp34_watchlist_static.py -v
"""
import importlib.util
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATION = ROOT / "migrations" / "0044_watchlist.sql"
WATCHLIST_TS = ROOT / "frontend" / "app" / "lib" / "watchlist.ts"


def _volatility_module():
    spec = importlib.util.spec_from_file_location(
        "wp34_migration_volatility", ROOT / "tests" / "test_migration_volatility.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_cap_matches_the_frontend_constant():
    sql = MIGRATION.read_text()
    ts = WATCHLIST_TS.read_text()
    sql_cap = re.search(r"enforce_owner_row_cap\('user_id', '(\d+)'\)", sql).group(1)
    ts_cap = re.search(r"export const WATCHLIST_MAX_ITEMS = (\d+);", ts).group(1)
    assert sql_cap == ts_cap == "200"


def test_effective_export_includes_the_watchlist():
    fns = _volatility_module().effective_functions()
    name, volatility, body = fns["public.export_my_data"]
    assert volatility == "VOLATILE", name
    assert "watchlist_items" in body and "'watchlist'" in body, (
        f"{name} is the effective export_my_data and drops the watchlist key; "
        "any migration that replaces export_my_data must keep it (WP34)"
    )


def test_migration_is_rerunnable_and_owner_only():
    sql = re.sub(r"--[^\n]*", "", MIGRATION.read_text())
    assert "CREATE TABLE IF NOT EXISTS public.watchlist_items" in sql
    assert "CREATE INDEX IF NOT EXISTS watchlist_items_product_id_idx" in sql
    for policy in re.findall(r"CREATE POLICY (\w+)", sql):
        assert f"DROP POLICY IF EXISTS {policy}" in sql
    assert "DROP TRIGGER IF EXISTS watchlist_items_row_cap_trg" in sql
    assert sql.count("(SELECT auth.uid())") == 3
    assert "FOR ALL" not in sql and "FOR UPDATE" not in sql
    grants = re.findall(r"GRANT ([A-Z, ]+) ON public\.watchlist_items TO authenticated", sql)
    assert grants == ["SELECT, INSERT, DELETE"]
```

### 3. `frontend/app/lib/__tests__/watchlist.test.ts` (new, node)

- `parseProductIdString`: `"42"` gives 42; `"042"`, `"4.2"`, `"-1"`, `"0"`, `""`, `null`, `"1e3"`, `"9007199254740993"` give null.
- `parseProductIdValue`: `42` gives 42; `"42"`, `0`, `-1`, `1.5`, `NaN`, `null` give null.
- `parseIdsParam`: `"12,7,12"` gives `[12, 7]`; `""`, `"1,,2"`, `"1,a"` give null; 200 distinct ids pass; 201 distinct ids give null.
- `watchProductLoginPath("/product/42", 42)` is `"/auth/login?next=%2Fproduct%2F42&watch=42"`; `("/screener?preset=off-highs", 7)` is `"/auth/login?next=%2Fscreener%3Fpreset%3Doff-highs&watch=7"`; `("/", 7)` and `("//evil.example", 7)` are `"/auth/login?watch=7"`.
- `selectMovers`: from 7 entries with `change7d` `[1, -9, null, 4, -4, 0.02, 12]` (ids 1 to 7) returns ids `[7, 2, 4, 5, 1]` (ties `4` and `-4` by id); `null` and `NaN` are skipped; `limit` 2 returns 2.
- `sortEntries` with `{ key: "change7d", direction: "desc" }`: nulls last; with `asc`: nulls still last; equal values ordered by product id; `"added"` sorts by timestamp.
- `isWatchlistPayload`: accepts a valid payload; rejects `null`, `{ items: "x" }`, an item without `productId`, and `statsDay: 5`. Same style for `isWatchlistMoversPayload` and `isWatchedIdsPayload` (`{ watched: ["1"] }` is rejected).
- `WATCH_SORT_OPTIONS` keys are unique and cover every `WatchSortKey`.

### 4. `frontend/app/lib/server/__tests__/watchlistModel.test.ts` (new, node)

Fixtures: `stats` snapshot for day `"2026-09-29"`; product 1 fresh (`usd_price 100`, `price_recorded_at "2026-09-29T08:00:00Z"`), stats row `is_price_fresh true`, `price_day "2026-09-29"`, `usd_price 100`, `ret_1d 0.4`, `ret_7d 3.4`, `ret_30d -2`, `high_52w 120`, `first_tracked_day "2024-09-01"`, `msrp_multiple 1.4` (omit when WP28 is absent), `days_of_supply 12.4`.

Cases:
- Fresh and matching: changes copied; `offHigh52wPct` is `(100/120 - 1) x 100` within 1e-9; `daysOfSupply` 12.4; `priceStatus "priced"`; `name` equals `getProductDisplayName(product)`; `typeLabel` is "Booster Box (Pokemon Center)" when `variant` is set.
- Stats price differs by 0.01: every change, `offHigh52wPct` and `msrpMultiple` null; `daysOfSupply` still 12.4.
- Stats `price_day` a day earlier than the price: changes null.
- `first_tracked_day` 300 days before the stats day: `offHigh52wPct` null; changes still present.
- Price withheld (`usd_price null`, `price_recorded_at "2026-09-05T08:00:00Z"`): `usdPrice` null, `priceDay "2026-09-05"`, `priceStatus "withheld"`, every number column null.
- Never priced (no `price_recorded_at`): `priceStatus "never"`.
- Not in `productsById`, name in `untracked`: `priceStatus "untracked"`, name "{set} {label}", numbers null. Not in either map: name "Product 77".
- `stats` is `EMPTY_PRODUCT_STATS`: price kept, every derived column null.
- Row order and `addedAt` are preserved.

### 5. `frontend/app/lib/server/__tests__/watchlistRepo.test.ts` (new, node)

Copy WP05's thenable query-builder fake `q()` (WP05 Tests 1). Mock `server-only`, `../../serverMarketData` (`getCachedMarketProductSummaries`, `getCachedProductStats`) and `../../logger`.

- `listWatchRows`: filters `user_id` with the caller id, orders `created_at` descending then `product_id`, limits to `WATCHLIST_LIST_LIMIT` (assert on `.calls`); returns null on an error.
- `watchedAmong`: `[]` makes no query; otherwise filters `user_id` and `in("product_id", ids)` and maps rows to ids; null on an error.
- `addWatch`: no error gives "added" and the insert payload is exactly `{ user_id, product_id }`; 23505 gives "exists"; 23503 gives "not_found"; 23514 followed by a re-read that returns the id gives "exists"; 23514 followed by an empty re-read gives "full"; 23514 followed by a failing re-read gives "full"; `XX000` gives "error" and logs.
- `removeWatch`: `data: [{ product_id: 5 }]` gives "removed"; `data: []` gives "absent"; an error gives "error"; filters on both `user_id` and `product_id`.
- `loadWatchlist`: returns null when the rows read fails; returns null when `getCachedMarketProductSummaries` rejects; with one row whose product is missing from the summaries it issues one `products` read with `in("id", [id])` and the entry is "untracked"; with all rows in the summaries it issues no `products` read; `count` equals `items.length`, `max` 200, `statsDay` from the snapshot.

### 6. `frontend/app/api/watchlist/__tests__/route.test.ts` (new, node)

Same harness as WP05 Tests 2 (`req()` helper with `x-pokefin-request` and `origin` defaults, real `csrf`, `routeAuth` and `authSession`), mocking `../../../lib/routeSupabase` and `../../../lib/server/watchlistRepo` (`loadWatchlist`, `watchedAmong`, `addWatch`, `removeWatch`). Assert status and body, and `Cache-Control: no-store` on every response except 403 and 413.

- GET: 403 without the header; 200 without `origin` (same-origin GET); 401 when `getUser` gives no user and no error (repo not called); 503 on `AuthRetryableFetchError`; 503 when `getUser` rejects; `?view=movers&ids=1` 400; `?view=other` 400; `?ids=a` 400; `?ids=` (empty) 400; 201 ids 400 (repo not called for any 400); `?ids=3,1` calls `watchedAmong` with `[3, 1]` and answers `{ watched: [3] }`; `watchedAmong` null gives 500; plain GET answers the payload; `loadWatchlist` null gives 500; `?view=movers` answers `{ movers, count, statsDay }` with at most 5 movers ordered by absolute 7D change; `loadWatchlist` rejecting gives 500.
- POST: 403 without the header; 403 with `origin: https://evil.example`; 413 with `content-length: 300`; 401 without a user (repo not called); 400 on `body: "{"`; 400 on `{ product_id: "42" }`, `{ product_id: 0 }`, `{}` and `[]`; 201 `{ status: "added" }`; 200 `{ status: "exists" }`; 404 on "not_found"; 409 `{ error: WATCHLIST_FULL_MESSAGE, code: "watchlist_full" }` on "full"; 500 on "error"; `addWatch` receives the session user id, never an id from the body (`{ product_id: 42, user_id: "someone-else" }`).
- DELETE: 403 without the header; 400 for `?product_id=abc`, `?product_id=0` and no parameter; 401 without a user; 200 `{ status: "removed" }` and `{ status: "absent" }`; 500 on "error"; `removeWatch` called as `(expect.anything(), "user-1", 42)`.

### 7. `frontend/app/lib/__tests__/watchlistApi.test.ts` (new, jsdom)

Mock `global.fetch`.
- `fetchWatchlist` sends `GET /api/watchlist` with `x-pokefin-request: 1`, `credentials: "same-origin"`, `cache: "no-store"`; throws `WatchlistApiError` with status 401 and "Your session has expired. Please sign in again."; throws on a body that fails `isWatchlistPayload`.
- `fetchWatchedIds([3, 1])` requests `/api/watchlist?ids=3,1`.
- `addToWatchlist(42)` POSTs `{"product_id":42}` with JSON and app headers; 201 gives `{ ok: true, status: "added" }`; 409 gives `{ ok: false, code: "watchlist_full", message: WATCHLIST_FULL_MESSAGE, status: 409 }`; a rejected fetch gives the network message and status 0; it never throws.
- `removeFromWatchlist(42)` sends `DELETE /api/watchlist?product_id=42`.
- `applyWatchAfterSignIn(null)` makes no request; `applyWatchAfterSignIn(42)` resolves after the POST; with a fetch that never settles and `jest.useFakeTimers()`, it resolves after `advanceTimersByTime(4000)`.

### 8. `frontend/app/lib/__tests__/watchlistStore.test.ts` (new, jsdom)

Mock `../watchlistApi` (`fetchWatchedIds`, `addToWatchlist`, `removeFromWatchlist`) and `client-only` (`jest.mock("client-only", () => ({}))`). Call `_resetWatchlistStoreForTests()` in `beforeEach`. Helper: `const tick = () => new Promise((r) => setTimeout(r, 0));`.

- Two `requestWatchState("u1", …)` calls in one tick make one `fetchWatchedIds` call with both ids; after it resolves `[2]`, `getWatchState(2)` is known and watched, `getWatchState(1)` known and not watched; a listener was called.
- 250 ids requested in one tick make two calls (200 and 50).
- A known id is not requested again.
- A rejected read gives `{ kind: "error" }`; `retryWatchState` requests it again and recovers.
- `bindWatchlistOwner("u2")` clears every state; a response for "u1" that resolves after the switch is ignored.
- `setWatched(1, true)`: the state is `watched: true, saving: true` before the API resolves; `{ ok: true }` keeps it; `{ ok: false }` rolls back to `watched: false`; a second call while saving returns the busy result without an API call; with no owner it returns busy.
- `noteWatched` updates a known state and is ignored with no owner.

### 9. `frontend/app/components/watchlist/__tests__/WatchButton.test.tsx` (new, jsdom)

Mock `../../../context/AuthContext` (`useAuth: () => mockAuth`), `next/navigation` (`useRouter: () => ({ push: mockPush })`) and `../../../lib/watchlistApi`. Reset the store in `beforeEach`; set the URL with `window.history.pushState({}, "", "/product/42")`.

- Session "unknown": button "Watch" has `aria-disabled="true"` and `aria-pressed="false"`; clicking does nothing; no API call.
- `renderToString(<WatchButton productId={42} productName="X" />)` contains `aria-pressed="false"` and `Watch` (the ISR HTML).
- Session "anonymous": `aria-pressed="false"`, no `aria-disabled`; click calls `mockPush("/auth/login?next=%2Fproduct%2F42&watch=42")`; no API call.
- The `role="status"` element exists, empty, in the first render of every state (unknown, anonymous, authenticated).
- Authenticated, `fetchWatchedIds` resolves `[42]`: `aria-pressed="true"` after the read, title "In your watchlist"; click calls `removeFromWatchlist(42)`, `aria-pressed` is "false" before it resolves, then the status reads "Removed from your watchlist." and has the class `sr-only` (success is never visible text).
- Authenticated, not watched; `addToWatchlist` resolves `{ ok: false, message: "Could not update your watchlist. Please try again.", code: null, status: 500 }`: after the click `aria-pressed` goes "true" then back to "false", and the message is shown in the status element, which no longer has `sr-only` and has `order-last` and `basis-full`. With `variant="icon"` the same failure keeps the status `sr-only`.
- Full: `addToWatchlist` resolves the 409 result; the status shows `WATCHLIST_FULL_MESSAGE` (visible).
- Read failure: status shows "Could not check your watchlist. Select Watch to try again." (visible); the next click re-reads.
- Rendered inside `<div className="flex flex-wrap">` with a sibling link, the labelled variant's outer element has the class `contents` (the button and the status are flex items of that row).
- Two buttons for product 42 and one for 7 cause exactly one `fetchWatchedIds` call with `[42, 7]`.
- `variant="icon"`: accessible name "Watch Evolving Skies Booster Box"; no visible "Watch" text.
- axe clean in the unknown, anonymous and pressed states.

### 10. `frontend/app/__tests__/watchRoundTrip.test.tsx` (new, jsdom): the logged-out watch round trip

One test that chains the two halves. Mock `next/navigation` with shared `mockPush`, `mockReplace` and a `useSearchParams` that reads `mockSearch`; mock `../context/AuthContext` with a mutable `mockAuth` (`sessionStatus`, `user`, `signIn: mockSignIn`); mock `@marsidev/react-turnstile` exactly as WP13's `LoginForm.test.tsx` does (the mock calls `onSuccess` so the button enables); mock `global.fetch`.

1. `mockAuth.sessionStatus = "anonymous"`; URL `/product/42`; render `<WatchButton productId={42} productName="Evolving Skies Booster Box" />`; click; capture `const url = mockPush.mock.calls[0][0]`; expect `url` to be `"/auth/login?next=%2Fproduct%2F42&watch=42"`. `fetch` not called.
2. `mockSearch = url.slice(url.indexOf("?"))`; `mockSignIn.mockResolvedValue({ error: null })`; `fetch` resolves `{ ok: true, status: 201, json: async () => ({ status: "added" }) }`; render `<LoginForm />`; the subtitle "Sign in to watch products and get daily alerts." is shown; fill email and password and submit (WP13's `signInWith` helper).
3. Expect `fetch` called once with `"/api/watchlist"`, method POST, body `{"product_id":42}`, header `x-pokefin-request: 1`; expect `mockReplace("/product/42")`, and `fetch`'s `invocationCallOrder[0]` is lower than `mockReplace`'s.
4. Variants: `?next=%2Fproduct%2F42&watch=abc` makes no `fetch` call and replaces to `/product/42`; a sign-in error makes no `fetch` call and no replace; a `fetch` that rejects still replaces to `/product/42`.

### 11. `frontend/app/auth/login/__tests__/LoginForm.test.tsx` (WP13, add 2 cases) and `app/lib/__tests__/loginCopy.test.ts` (WP27, add 3 cases)

- LoginForm: `container.querySelector('input[type="hidden"][name="watch"]')` has value `"42"` for `?watch=42` and does not exist for `?watch=0x2a`.
- LoginForm: every existing case still passes (no `watch` means no `fetch` call; assert `global.fetch` was not called in the existing redirect cases by mocking it in `beforeEach`).
- loginCopy: `loginSubtitleFor("/prices", "42")` and `loginSubtitleFor(null, "42")` give the watch sentence; `loginSubtitleFor("/prices", "abc")` gives the default; every existing case passes unchanged (single argument).

### 12. `frontend/app/portfolio/watchlist/__tests__/WatchlistView.test.tsx` (new, jsdom)

Mock `../../../context/AuthContext`, `next/navigation` (`useRouter: () => ({ push: mockPush })`), `../../../lib/watchlistApi` (`fetchWatchlist`, `addToWatchlist`, `removeFromWatchlist`), `../../../lib/watchlistStore` (`noteWatched: jest.fn()`) and `../../../components/search/searchEvents` (`openGlobalSearch: jest.fn()`, `loadGlobalSearch: jest.fn(() => Promise.resolve({}))`). Pin the clock to `2026-09-30T12:00:00Z` (`jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] }).setSystemTime(...)`) so the stale checks are deterministic. The phone list and the table are both in the jsdom DOM: scope queries with `within(screen.getByRole("table"))` or `within(screen.getByRole("list", { name: "Your watchlist" }))`. Fixture: 3 entries (fresh product 1 with all columns, stale product 2 with `usdPrice null`, `priceStatus "withheld"`, `priceDay "2026-09-05"`, product 3 fresh with `change7d 9`), `statsDay "2026-09-29"`, `msrpMultiple` null on all.

- Session "unknown" with `loading: true`: skeleton status "Loading your watchlist"; with `loading: false`: `SessionUnavailable`'s retry calls `refreshSession`.
- Session "anonymous": `mockPush("/auth/login?next=%2Fportfolio%2Fwatchlist")`.
- Authenticated: loading status first; then the heading "Watchlist", "3 of 200 products.", the text of `PROVENANCE_SENTENCE` (import it from `app/content/disclosures`), "Changes are measured in USD, through Sep 29, 2026 (UTC).", the tabs with "Watchlist" `aria-current="page"` and "Holdings" linking to `/portfolio`, and a "Find a product" button whose click calls `openGlobalSearch`.
- An empty `role="status"` paragraph exists before any removal.
- Table: caption "Your watchlist"; no "x MSRP" column header; product links go to `/product/1`; the stale row's price cell text is "--" with sr-only "Price withheld" and its 7D cell is "--"; the stale row shows the clock with "Last priced Sep 5".
- With a fourth entry `priceStatus "untracked"`, `priceDay null`: the table's product cell shows the caption "No longer tracked" and the phone row's second line reads "No longer tracked".
- Phone list: the stale row's second line reads "Last priced Sep 5" (visible text, not only a title).
- Sorting: click the "7D" header twice (asc then desc); the first body row is product 3.
- Phone list: the select "Sort by" defaults to "Date added" and the order button's name is "Newest first. Switch to oldest first"; choosing "Change 7D" orders product 3 first and the button's visible text reads "High to low".
- Empty payload: "You are not watching any products yet", a "Find a product" button (calls `openGlobalSearch`), and no "Find a product" in the page header (one action per view).
- `fetchWatchlist` rejecting: "Your watchlist could not be loaded"; "Try again" calls `fetchWatchlist` again.
- Remove (table): click "Remove {name 1} from watchlist"; the row disappears at once; `removeFromWatchlist(1)` called; status "Removed {name 1}."; focus is on "Undo"; after `{ ok: true }` `noteWatched(1, false)` was called; clicking Undo calls `addToWatchlist(1)`, the row returns and the status reads "Put back {name 1}.".
- Remove failure: the row comes back and the status shows the error message.
- With `msrpMultiple: 1.4` on one entry: the "x MSRP" header and the "x MSRP" definitions link appear (skip this case if WP28 is absent).
- axe clean in the loaded state.

### 13. `frontend/app/components/home/__tests__/WatchlistMovers.test.tsx` (new, jsdom)

Mock `../../../context/AuthContext` and `../../../lib/watchlistApi` (`fetchWatchlistMovers`).
- "unknown" and "anonymous": renders nothing and does not fetch.
- Authenticated: loading status "Loading your watchlist", then 2 rows linking to `/product/{id}`, each with a price and "7D"; caption "Largest 7-day moves among your 14 watched products."; "Open watchlist" links to `/portfolio/watchlist`.
- `count: 0`: "You are not watching any products yet." with a link to `/prices`.
- `count: 3, movers: []`: "None of your watched products has a 7-day change yet."
- Rejection: "Your watchlist could not be loaded."
- Unmount aborts the request (the signal passed to the API is aborted).
- axe clean.
- WP32's `YourPokefin.test.tsx` and home shell test pass unchanged (`app/components/home/` now has one more client file).

### 14. `frontend/app/components/Portfolio/__tests__/PortfolioTabs.test.tsx` (new, jsdom)

`current="watchlist"`: navigation "Portfolio sections" with links "Holdings" (`/portfolio`) and "Watchlist" (`/portfolio/watchlist`, `aria-current="page"`); `current="holdings"` flips it; axe clean.

### 15. `frontend/app/__tests__/watchIsland.source.test.ts` (new, node): ISR guard

```ts
/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";

const APP = path.resolve(__dirname, "..");
const read = (rel: string) =>
  fs.readFileSync(path.join(APP, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("watch island keeps public pages static (WP34)", () => {
  it("WatchButton and WatchlistMovers are client components without search params", () => {
    for (const file of ["components/watchlist/WatchButton.tsx", "components/home/WatchlistMovers.tsx"]) {
      const text = read(file);
      expect(text).toMatch(/^\s*["']use client["']/);
      expect(text).not.toMatch(/useSearchParams|next\/headers|\bcookies\(/);
    }
  });

  it("the product page and the home page read no request data for the watchlist", () => {
    for (const file of ["product/[id]/page.tsx", "page.tsx"]) {
      const text = read(file);
      expect(text).not.toMatch(/next\/headers|\bcookies\(|\bheaders\(|\/api\/watchlist|export const dynamic/);
    }
  });

  it("the island does not pull redirects.ts or loginCopy.ts into public bundles", () => {
    for (const file of ["components/watchlist/WatchButton.tsx", "lib/watchlist.ts", "lib/watchlistApi.ts", "lib/watchlistStore.ts"]) {
      expect(read(file)).not.toMatch(/redirects|loginCopy|@supabase|lib\/supabase/);
    }
  });

  it("new files keep colour changes instant and the forced-colours focus cue", () => {
    const files = [
      ...fs.readdirSync(path.join(APP, "components/watchlist")).filter((f) => /\.tsx?$/.test(f)).map((f) => `components/watchlist/${f}`),
      "components/Portfolio/PortfolioTabs.tsx",
      "components/home/WatchlistMovers.tsx",
      "portfolio/watchlist/WatchlistView.tsx",
    ];
    for (const file of files) {
      expect(`${file}: ${/\btransition-(?:colors|all)\b|\boutline-none\b/.test(read(file))}`).toBe(`${file}: false`);
    }
  });
});
```

### 16. Navigation tests (WP27, add cases)

- `app/components/__tests__/Header.auth.test.tsx`: signed in, the account menu contains a link "Watchlist" to `/portfolio/watchlist` above "Account settings"; signed out, no "Watchlist" link in the header.
- The `MobileNavSheet` test (find it with `grep -rln "MobileNavSheet" app --include=*.test.tsx`): same two cases for the sheet.

## Verification

Block 1, database (repo root):

```bash
python3 verify_migration.py migrations/0044_watchlist.sql > /tmp/wp34_0044.sql; echo "exit=$?"     # exit=3, stderr as in step 1g
grep -c "^-- privilege" <(python3 verify_migration.py migrations/0044_watchlist.sql 2>&1 >/dev/null)   # 32
PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh   # last line "OK: ... replay_twice"
POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once \
  python -m pytest tests/test_wp34_watchlist_db.py tests/test_wp34_watchlist_static.py \
  tests/test_migration_volatility.py tests/test_db_roles_integration.py -v                         # all passed
python -m pytest tests/ -q                                                                          # all passed; DB modules skipped
```

Block 2, frontend unit (from `frontend/`):

```bash
pnpm exec tsc --noEmit
# phase A: errors only in app/lib/server/watchlistRepo.ts, each about "watchlist_items" not being in Database; phase B: exit 0
pnpm lint                                                                                  # 0 errors
pnpm exec jest app/lib/__tests__/watchlist.test.ts app/lib/__tests__/watchlistApi.test.ts \
  app/lib/__tests__/watchlistStore.test.ts app/lib/server/__tests__/watchlistModel.test.ts \
  app/lib/server/__tests__/watchlistRepo.test.ts app/api/watchlist app/components/watchlist \
  app/__tests__/watchRoundTrip.test.tsx app/__tests__/watchIsland.source.test.ts \
  app/auth/login app/lib/__tests__/loginCopy.test.ts app/portfolio/watchlist \
  app/components/home app/components/Portfolio/__tests__/PortfolioTabs.test.tsx \
  app/components/__tests__/Header.auth.test.tsx                                            # all pass
pnpm exec jest app/components/ui app/components/Screener                                  # only if step 17 ran: all pass
pnpm exec jest app/__tests__/uiConventions.test.ts                                         # pass without UPDATE_UI_BASELINE
pnpm test --ci                                                                              # all pass; count = baseline + new
pnpm run test:scripts                                                                       # all pass
```

Jest treats path arguments as regular expressions; do not pass `app/product/[id]/...` paths, select those tests by file name.

Block 3, build and budgets (from `frontend/`):

```bash
pnpm build:stub > /tmp/wp34-build.log 2>&1; echo "exit=$?"                                  # exit=0
grep -nE " /portfolio/watchlist| /product/\[id\]| /\s*$" /tmp/wp34-build.log               # / marked ○ (static), /product/[id] marked ● (ISR), /portfolio/watchlist listed (ƒ, dynamic)
rm -rf .perf && SUPABASE_STUB_FIXTURE=perf pnpm build:stub > /tmp/wp34-perf.log 2>&1; echo "exit=$?"   # exit=0, no unmatched requests
pnpm perf:budget --write-limits && git diff perf-budgets.json                               # only /portfolio/watchlist limit and recorded added
pnpm perf:budget; echo "exit=$?"                                                            # exit=0
pnpm perf:budget | grep -E "^\| (/|/product/900001|/portfolio|/portfolio/watchlist|/screener) "   # record JS (gz) for the PR
```

Expected: `/product/900001` JS grows by at most 2.5 kB gz against master (the island), `/` by at most 1.5 kB gz, `/screener` (if step 17 ran) by at most 2.5 kB gz, all within their limits; `/portfolio/watchlist` JS at or under 180 kB gz (the global search panel stays a lazy chunk: `SearchTrigger` only preloads it on hover or focus); CSS within its limit; forbidden chunks ok (no supabase-js or recharts on `/`, `/product/900001` or `/screener`).

Block 4, cache and ISR (from `frontend/`, perf server running):

```bash
node scripts/perf-serve.mjs &   # 127.0.0.1:3100
node scripts/check-public-cache.mjs                                  # WP26: no argument = the perf server; last line "[check-public-cache] ok on ..."
curl -s http://127.0.0.1:3100/product/900001 | grep -o 'data-watch-state="unknown"' | wc -l   # 1 (the Watch button in the server HTML, session unknown)
curl -s http://127.0.0.1:3100/product/900001 | grep -o '>Watch</span>' | wc -l                   # 1 (the labelled variant's text)
curl -s http://127.0.0.1:3100/product/900001 | grep -o "watchlist_items\|/api/watchlist" | wc -l   # 0
kill %1
```

Count with `grep -o ... | wc -l`, not `grep -c`: the HTML is a few long lines, and `grep -c` counts lines. Do not count `aria-pressed="false"`: WP31's benchmark toggles are `aria-pressed` buttons too.

Block 5, manual, after phase B, with `pnpm dev` and real credentials (localhost passes `csrf.ts`'s origin check outside production) or on production after the deploy. Not on a Vercel preview URL: `rejectIfCsrfFails` allows only `NEXT_PUBLIC_SITE_URL`, `https://pokefin.ca` and `https://www.pokefin.ca`, so every POST and DELETE from a preview origin answers 403 by design (the same holds for WP05's portfolio writes).

1. 1440 px, signed out: `/product/<id>` shows "Watch"; click; the URL is `/auth/login?next=%2Fproduct%2F<id>&watch=<id>` and the subtitle is "Sign in to watch products and get daily alerts."; sign in; you land on `/product/<id>` with the star filled and `aria-pressed="true"` (DevTools), and Network shows one `POST /api/watchlist` (201) during sign-in and one `GET /api/watchlist?ids=<id>` on the product page.
2. Signed in: click Watch on two more products; open `/portfolio/watchlist`; all three rows show price, as-of clock where aging, 1D/7D/30D, vs 52W high, days of supply; sort by 7D; remove one, press Undo, it returns.
3. Open `/portfolio/watchlist` in a second browser signed in as the same user: the same rows (persists across devices).
4. In the Supabase SQL editor, pick a watched product whose last price is 14 or more days old (or watch the stale product WP31's page shows as withheld): its row shows `--` in every number column with the clock "Last priced {date}".
5. `/` signed in: "Watchlist movers, 7D" in the second column of "Your Pokéfin", at most 5 rows, each linking to its product. Signed out: the island is absent and Network shows no `/api/watchlist` request.
6. 390 x 844 (DevTools device mode, touch): the product page Watch button is 44 px tall and toggling it moves nothing else in the actions row; `/portfolio/watchlist` shows the list (no table, no horizontal scroll), a stale row reads "Last priced {date}" in words, the sort select does not zoom on focus (16 px), the order button flips, each remove button is 44 px and removing moves focus to Undo.
7. Account page: "Export my data" downloads JSON with a `watchlist` array of `{ product_id, created_at }`.
8. Keyboard only: Tab to Watch, Space toggles, "Added to your watchlist." is announced (VoiceOver or NVDA) with no visible text; the table's sort buttons announce `aria-sort`; "Find a product" opens the header search with focus in its input. Windows High Contrast (or Chrome's forced-colours emulation): every focused control shows an outline.
9. Chrome Performance panel on `/portfolio/watchlist` with 4x CPU slowdown: a header sort click completes processing and presentation within 200 ms (INP target for `/portfolio`); attach the screenshot of the Interactions track.

## Owner actions

1. **Apply migration 0044** in production with Supabase MCP `apply_migration` (preferred) or the SQL editor (select nothing before Run): `migrations/0044_watchlist.sql`, after 0031 (WP21) is applied. Then run the query `python3 verify_migration.py migrations/0044_watchlist.sql` prints: every row OK (35 rows). The 0024 query now reports one MISMATCH on the `export_my_data` body; that is expected (0044 superseded it). Run the header's verification queries (expect `true`, `false, false, true`, `watchlist_items_row_cap_trg`). Apply before the phase B code deploys: the route selects the new table by name.
   **If WP36's 0046 is already applied in production** (check: `SELECT position('purchase_currency' IN pg_get_functiondef('public.export_my_data()'::regprocedure)) > 0;` returns true before you apply 0044), 0044's `CREATE OR REPLACE` removes 0046's three export keys. Right after applying 0044, run `migrations/0046_portfolio_lot_currency.sql` again (idempotent; it only re-adds those keys, WP36 Owner action 5), then check that the same query returns true and that `SELECT position('watchlist_items' IN pg_get_functiondef('public.export_my_data()'::regprocedure)) > 0;` also returns true. In that case the `verify_migration.py` row for the `export_my_data` body reports MISMATCH (0046 patched it after 0044); every other row must be OK.
2. **Tell the executor** it is applied, so phase B regenerates `app/types/database.ts` (`pnpm types:db` needs the table in production).
3. After merge, refresh `schema.sql` by WP21's procedure (the drift check reports the new table until then).
4. After deploy, do Verification block 5 steps 1, 3 and 7 with your own account (5 minutes). No new environment variable, secret, paid service or Vercel setting is needed.

## Acceptance criteria

- [ ] `migrations/0044_watchlist.sql` exists with step 1's content; no other migration changed; `verify_migration.py` exits 3 with 32 privilege lines; the replay harness passes once and twice.
- [ ] `tests/test_wp34_watchlist_db.py` passes against `replay_once`: owner reads and deletes own rows, another user sees and deletes nothing and cannot insert for the owner, UPDATE is denied, anon and `pokefin_scraper` are denied, policies use `(SELECT auth.uid())`, the 201st row and a single 201-row insert and a duplicate at the cap raise 23514, export includes `watchlist`, account deletion removes the rows.
- [ ] `tests/test_wp34_watchlist_static.py` passes: the SQL cap equals `WATCHLIST_MAX_ITEMS` (200) and the effective `export_my_data` includes the watchlist and is VOLATILE.
- [ ] `GET /api/watchlist` answers the list, `?view=movers` at most 5 movers, `?ids=` the watched subset; `POST` answers 201/200/404/409/400; `DELETE` answers removed/absent; every route answer is `no-store`; writes need the CSRF header and Origin; anonymous calls get 401, auth outages 503.
- [ ] A watch persists across devices (Verification block 5 step 3).
- [ ] A watched product whose price is withheld shows `--` in every number column, with an sr-only reason and the "Last priced" clock (desktop), and "Last priced {date}" in words on phones; an untracked or never-priced row shows its reason as visible text.
- [ ] Changes appear only when the stats row matches the shown price; "vs 52W high" only with at least 364 tracked days; x MSRP column hidden when no row has a value.
- [ ] `WatchButton` is in WP31's actions row with `aria-pressed`, updates optimistically, rolls back on error, shows the full message at 200, and makes no request for signed-out or unknown sessions; one request serves all buttons on a page; a successful toggle adds no visible text and moves no other element in the row.
- [ ] Public pages stay ISR: `/` static and `/product/[id]` ISR in the build output; the server HTML of a product page contains the Watch button with `data-watch-state="unknown"` and no watchlist data; `watchIsland.source.test.ts` passes; `check-public-cache.mjs` ends with its "ok" line.
- [ ] Logged-out round trip: the Watch tap goes to `/auth/login?next=<path>&watch=<id>`, the subtitle is the watch sentence, and after sign-in the product is watched and the user lands on `<path>` (`watchRoundTrip.test.tsx` passes).
- [ ] `/portfolio/watchlist` has the Holdings | Watchlist tab bar (also on `/portfolio`), WP24's provenance sentence, a "Find a product" action, a dense sortable table from 768 px and a `DataList` with a sort select below 768 px, remove with Undo, and loading, empty, error and full states as specified; it is `noindex`.
- [ ] The home "Your Pokéfin" island shows "Watchlist movers, 7D" (top 5 by absolute 7D change) for signed-in users only.
- [ ] Account menu and phone sheet list "Watchlist" for signed-in users; privacy and account export copy mention the watchlist.
- [ ] `pnpm exec tsc --noEmit` (phase B), `pnpm lint`, `pnpm test --ci`, `pnpm run test:scripts`, `pnpm build:stub`, `pnpm perf:budget` all pass; `perf-budgets.json` has `/portfolio/watchlist` and no raised limit.
- [ ] Screener rows carry the icon Watch button in a trailing column and beside each phone row link (if WP33 has landed; `DataListRow` without `action` renders byte-identical markup), or the PR states the contract for WP33 as a follow-up.
- [ ] No em dash, "live", "real-time", "all-time" or "TCGPlayer" in any new or changed file; no raw palette class, hex, `transition-colors`, `transition-all` or `outline-none` in new files.
- [ ] If WP36's 0046 was applied in production before 0044, the owner re-ran 0046 after 0044 and both export checks in Owner action 1 return true.

## Rollback

Code: revert the frontend commits (2 to 6 of Commit and PR). The Watch buttons, page, tab bar, home column and nav entry disappear; nothing else depends on them until WP35. Keep commit 1 (the migration and its tests): the table is inert without the route, and the migration stays in `migrations/` because production has applied it (removing it would make the replay and `schema.sql` drift).

Database, only if the table itself must go (for example before WP35 merges and the owner wants no dormant user data): run, in this order, in the SQL editor:

```sql
-- 0. If WP35's 0045 is applied, roll WP35 back first (its export_my_data body and
--    alert tables reference watchlist_items); follow WP35's Rollback.
-- 1. Restore 0024's export_my_data (it no longer references watchlist_items).
--    Paste migrations/0024_export_my_data_volatile.sql in full and run it (idempotent),
--    then run migrations/0036_export_includes_box_recipe_currency.sql (WP38; idempotent)
--    so the export keeps box_recipes.currency. If migrations/0046_portfolio_lot_currency.sql
--    exists and is applied, run it again right after, so the export keeps WP36's keys.
-- 2. Drop the table (drops its policies, trigger and index with it).
DROP TABLE IF EXISTS public.watchlist_items;
```

Then add a new migration that does the same things, numbered at the first free number above 0047 (numbers up to 0047 are reserved; see `audits/remediation/00-PLAN.md`, "Migration registry"), so the replay matches production. Never delete `0044_watchlist.sql` after it has been applied.

## Commit and PR

Commits (in this order):

1. `feat(db): watchlist_items with owner-only RLS, 200 cap and export (WP34)`: `migrations/0044_watchlist.sql`, `tests/test_wp34_watchlist_db.py`, `tests/test_wp34_watchlist_static.py`.
2. `feat(watchlist): route handler, model, repo and browser client (WP34)`: `app/lib/watchlist.ts`, `app/lib/server/watchlistModel.ts`, `app/lib/server/watchlistRepo.ts`, `app/api/watchlist/route.ts`, `app/lib/watchlistApi.ts`, their tests.
3. `feat(watchlist): Watch button, shared store and sign-in round trip (WP34)`: `app/lib/watchlistStore.ts`, `app/components/watchlist/WatchButton.tsx`, `app/lib/loginCopy.ts`, `app/auth/login/LoginForm.tsx`, `app/product/[id]/page.tsx`, the Screener files and `app/components/ui/DataList.tsx` with its test (step 17, if WP33 landed), their tests, `watchRoundTrip.test.tsx`, `watchIsland.source.test.ts`.
4. `feat(portfolio): watchlist page, tabs and home movers (WP34)`: `app/portfolio/watchlist/*`, `app/components/watchlist/{WatchlistTable,WatchlistPhoneList,RemoveButton,watchlistFormat}.*`, `app/components/Portfolio/PortfolioTabs.tsx`, `app/portfolio/page.tsx`, `app/components/home/WatchlistMovers.tsx`, `app/page.tsx`, `navConfig.ts`, `Header.tsx`, `MobileNavSheet.tsx`, their tests.
5. `chore(watchlist): lint lists, budgets, privacy and export copy, docs (WP34)`: `eslint.config.mjs`, `perf-budgets.json`, `app/privacy/page.tsx`, `app/account/page.tsx`, `README.md`, `app/__tests__/uiConventions.baseline.json` (only if a count went down).
6. Phase B: `chore(types): regenerate database types for 0044 (WP34)`: `app/types/database.ts`.

End every commit message with the attribution lines the session's system reminder specifies.

PR title: `WP34: Watchlist`

PR body:
- What changed and why (the Why section, two sentences), with screenshots at 390 px and 1440 px: product page Watch (unpressed, pressed, and the error line from a forced failure), `/portfolio/watchlist` (loaded, empty, a stale row), the home island signed in, the sign-in page with the watch subtitle.
- **Migration 0044 must be applied by the owner before the phase B deploy** (Owner action 1), with the `verify_migration.py` result pasted once done.
- Route contract (GET list, `?view=movers`, `?ids=`, POST, DELETE and their status codes).
- Verification outputs: `verify_migration.py` stderr, the replay harness's last line, pytest summaries with and without `POKEFIN_TEST_DATABASE_URL`, `tsc` (phase A errors listed, phase B clean), lint, Jest counts before and after, the `perf:budget` rows for `/`, `/product/900001`, `/portfolio` and `/portfolio/watchlist` on master and on the branch, the cache check output, the INP screenshot.
- Soft dependencies: whether WP28 was present (x MSRP column and link) and whether WP33 was present (step 17 applied, or the one-line contract for WP33).
- Known limits and follow-ups: the watch intent survives password sign-in only, not sign-up with email confirmation; changes are in USD Market Price terms (CAD returns at dated rates would need WP25's `convertDailySeries` per row); named multiple watchlists, a "since added" change (needs the price at the add day stored on the row), CSV export of the watchlist and alert rules are later packages (WP35 for alerts); WP22's production smoke could add `GET /api/watchlist` to its signed-in leg.
- Owner actions 1 to 4 as a checklist.

End the PR description with the attribution lines the session's system reminder specifies.
