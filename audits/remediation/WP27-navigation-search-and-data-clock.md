# WP27: Task-based navigation, global search, data clock and new mark

- **Goal**: from any page, a visitor finds any product in two keystrokes (`/` or Ctrl-K, then type), sees in the header when the newest price was recorded (amber when collection has stalled), moves between Market, Prices, Screener, Sets, Portfolio and Tools, picks CAD or USD once in the header for the whole site, and sees Pokéfin's own mark instead of a Poké Ball in the header, footer, sign-in pages, browser tab and home screen icon.
- **Why now / value**: the nav is organised by tool ("Market View", "Set Analytics", "Seller Tools"), hides Portfolio from logged-out visitors and has no search, which is the most used control on every competitor (research/ui-audit.md "Navigation and information architecture"). The collector runs on the owner's laptop and can stop silently; nothing on the site says so (research/trust-seo-brand.md §10.2). The logo is a mark owned by the Pokémon rights holders on a site that promotes a store (trust-seo-brand.md §14.1). WP32 (home header search trigger), WP33 (Screener rename), WP34 (watch sign-in copy) and WP37 (Sets links) all build on the nav config, search trigger and login copy this package creates.
- **Effort**: L, about 15 hours (nav config, header, menus and sheet 4 h; catalog route, search index, launcher and panel 4.5 h; data clock 1.5 h; mark, icon set and manifest 1.5 h; currency toggle migration 1.5 h; footer, login copy, page titles and smoke check 0.5 h; tests and verification 1.5 h).
- **Depends on**: WP38 (`isExchangeRateStale` in `app/lib/currency.ts`, used by `rateSentence`), WP13 (`app/lib/redirects.ts` with `safeReturnToPath` and `loginPathWithNext`, `app/auth/login/LoginForm.tsx` with its `Suspense` readers, `app/lib/site.ts`, `app/icon.png` and `app/apple-icon.png` copies, `viewport.themeColor`), WP14 (`app/components/ui/Dialog.tsx`, the jsdom `<dialog>` polyfill, `html:has(dialog[open])` scroll lock), WP20 (`CurrencyProvider` and `useCurrency` in `app/context/CurrencyContext.tsx`, `app/lib/currency.ts`, `app/types/market.ts`, async root layout), WP22 (`perf-budgets.json`, `pnpm perf:budget`, `scripts/prod-smoke-lib.mjs`), WP23 (`SegmentedControl`, `Button`/`buttonClasses`, `Delta`, `AsOf`, `icons.tsx`, token utilities, `uiConventions.test.ts` with `BRAND_FILES` and the hex and brand-red ratchets), WP24 (server `Footer.tsx` with `FooterGate`, `app/lib/contactLink.ts`, `app/lib/jsonLd.ts`, `/methodology` with `#cadence`, `TRUST_FILES` rule). Through them: WP03 and WP04 (`Header.test.tsx`, `Header.auth.test.tsx`, `sessionStatus`), WP07 (`format.ts`), WP08 (`urlState.ts`, `locationSearch.ts`), WP11 (`cacheTags.ts`, `getCachedMarketProductSummaries`, React `cache` import in `serverMarketData.ts`), WP15 (`CardRinkPromo` as a server `<aside>`).
- **Unblocks**: WP32 (puts `SearchTrigger` and `openGlobalSearch()` in the home header), WP33 (changes the Screener `href` in `navConfig.ts` only), WP34 (Watchlist entry in the account menu and sheet; signed-out watch links use `watchLoginPath()` so sign-in shows the watch copy), WP35 (same login copy), WP37 (changes the Sets `href`, `setSearchHref()` and adds set links to the footer Browse column), and the deferred offline shell (the catalog payload is versioned for it).
- **Placement**: after WP24 (footer rows and the `/methodology#cadence` anchor). It can run in parallel with WP25 and WP26. It must precede WP32. It resolves the "Seller Tools in primary nav" item WP15 lists under "Noticed, out of scope", so WP15 needs no change. No migrations.
- **Suggested branch name**: `remediation/wp27-navigation-search-and-data-clock`
- **Risk level**: medium. It rewrites the header that renders on every page and moves the currency choice off four pages; a mistake is visible site-wide, but there is no schema, API contract or data change, and every piece has a test.

## Why

Today a visitor who knows exactly which box they want has no search outside the home hero and the `/prices` filter, and the header offers five tool names ("Market View" and "Prices" look like the same data) while Portfolio, the feature that brings people back, is missing for logged-out visitors (research/ui-audit.md "Navigation and information architecture", top-10 item 10). Nothing on the site says when prices were last collected, so when the scraper on the owner's machine stops, visitors see day-old or week-old numbers with no warning until the 14-day gate blanks them (research/trust-seo-brand.md §1 item 3, §5.1, §10.2). The currency is chosen separately on `/prices`, `/market` and `/portfolio`, and the logo, favicon and promo use a Poké Ball (trust-seo-brand.md §14.1). After this PR the header is organised by task (01-PRODUCT-DIRECTION.md §4.1), a global search over a CDN-cached catalog of under 16 kB brotli opens with `/` or Ctrl-K and reaches any product with Enter (competitive-landscape.md §4, ui-audit.md "Also worth doing"), a data clock in the header states the newest price time and turns amber after 30 hours (trust-seo-brand.md §5.1 rules, §5.2 `DataStatusChip`), the header owns the one USD/CAD choice, and an original interim mark replaces the Poké Ball everywhere, with a real multi-size favicon, an apple icon and a web app manifest (performance-excellence.md §12 PX09a, trust-seo-brand.md §14.2). Collectors on phones get a one-thumb menu sheet with a backdrop; the prefetch policy follows performance-excellence.md §8.

## Design

### Decisions (binding, from `01-PRODUCT-DIRECTION.md` §4.1 and §3)

- Primary nav: **Market** is the logo (`/`), then **Prices** (`/prices`), **Screener** (`/market` until WP33), **Sets** (`/analytics` until WP37), **Portfolio** (`/portfolio`, always visible), and a **Tools** menu with **Box NAV calculator** (`/box-calculator`) and **Seller margin check** (`/compare`). Every label, href and active-route rule lives in one module, `app/components/nav/navConfig.ts`, so WP33 and WP37 change one line each.
- The USD/CAD toggle lives in the header (desktop) and the menu sheet (phone), bound to WP20's `useCurrency()`. The page-level toggles on `/prices`, `/market` and `/portfolio` are removed. `/box-calculator` keeps its selector, relabelled "Recipe currency", because a recipe's inputs are typed in its own currency and a shared recipe carries one; it follows the header until the user changes it on that page, and it no longer writes the site preference.
- `/prices` stops owning currency in its URL. A legacy `?currency=USD|CAD` link is honoured once as the site-wide choice, then removed from the address bar.
- Search fetches `/api/public/catalog` on first open only, never on page load or hover. The search panel code is a lazy chunk; only the launcher button and shortcut listener ship in the shared bundle.
- The data clock is derived from the cached summaries (newest `price_recorded_at`, products priced within 48 h of it). No `scrape_runs` table (deferred, 01-PRODUCT-DIRECTION.md §10).
- No service worker. Theme colour stays `#ffffff`. Light only.
- Mark (owner decision D6): until the owner supplies a final mark, ship the interim geometric monogram of trust-seo-brand.md §14.1 direction (a): a rounded red tile with a white stepped "P" whose lower edge is a rising three-step line. Geometry is defined once below and mirrored in three files.
- Brand red (`--pf-accent`) appears only in the mark tile and the wordmark "é". The active nav item, buttons, focus rings and the selected currency segment use the action blue. The store promo gets no mark at all (01-PRODUCT-DIRECTION.md §3.2: brand red is never the promo).
- Prefetch (performance-excellence.md §8): primary nav links keep the default; Portfolio, every auth link, the account links, the data clock link and every footer link use `prefetch={false}`; menu and sheet links keep the default (they are only visible after an intent).

### The mark

32-unit grid, used by `PokefinMark.tsx`, `app/icon.svg` and `scripts/brand/make-icons.py`:

- Tile: `rect` 32 x 32, corner radius 8, fill `--pf-accent` (#dc2626).
- Glyph: a "P" whose bowl's outer edge is a rising three-step line, fill white. Outline polygon `(8,26) (8,6) (24,6) (24,10) (20,10) (20,14) (16,14) (16,18) (12,18) (12,26)` with a square counter `(12,10) (16,10) (16,14) (12,14)` cut out of it (the hole is what makes it read as a P and not a staircase). SVG path `M8 26V6h16v4h-4v4h-4v4h-4v8zM12 10v4h4v-4z` with `fill-rule="evenodd"`. Every vertex is even, so it is pixel-aligned at 16 px (the counter is a 2 x 2 px hole).

```
16 px render (# = white glyph, . = red tile)
................
................
................
....########....
....########....
....##..##......
....##..##......
....####........
....####........
....##..........
....##..........
....##..........
....##..........
................
................
................
```

Lockups: mark only (favicon, app icons), mark plus wordmark "Pok**é**fin" (header, footer, sign-in pages). The wordmark stays Geist bold with the accent "é".

### Header, desktop 1440 px (signed out, prices fresh)

One 64 px row, `max-w-7xl`, white surface, 1 px `border-line` bottom. Left: logo and nav. Right (01-PRODUCT-DIRECTION.md §4.1): data clock, search, USD/CAD, account. The right-hand cluster is anchored to the right edge and the clock is its first item, so when the clock's text changes length after hydration only the flexible gap to its left moves (no layout shift of any control). The clock is the only shrinkable item: on a tight row it truncates (full text in its `title` and accessible name) instead of pushing the row into horizontal scroll.

```
+--------------------------------------------------------------------------------------------------------------------------------+
| [P] Pokéfin   Prices  Screener  Sets  Portfolio  Tools v      (o) Prices as of Sep 30, 6:10 AM EDT [Q Search /] [USD|#CAD#] Sign in [Create account] |
|               ======                                                                                                           |
+--------------------------------------------------------------------------------------------------------------------------------+
  ====== = 2 px action-blue bar under the active item (here /prices), text ink; inactive items ink-soft
  (o) = clock icon; the chip is a link to /methodology#cadence, title "Prices as of Sep 30, 6:10 AM EDT. 301 of 306 products priced within 48 hours of the newest price."
  [#CAD#] = selected segment, action blue; "Create account" is the only primary (blue) button
```

Signed in, the right end is `[A ash v]` (initial plus username, max 7rem, truncated). Its menu: name and email, "Account settings", "Sign out". Tools menu (click "Tools v"):

```
                 Tools v
                 +--------------------------------------------+
                 | Box NAV calculator                         |
                 | A box's price against its packs            |
                 | Seller margin check                        |
                 | Your Shopify prices against the market     |
                 +--------------------------------------------+
```

Breakpoints:

| Width | Left | Right |
|---|---|---|
| < 1024 px | mark + wordmark | clock icon, search icon, menu button |
| 1024 to 1279 px | logo, nav | clock icon, search icon, USD/CAD, "Sign in" and "Create account" (or account menu) |
| >= 1280 px | logo, nav | clock icon + text (truncates if the row is tight), search button with `/` hint, USD/CAD, "Sign in" and "Create account" (or account menu) |

The account slot is a fixed `w-[12.5rem]` at 1024 px and up (the signed-out pair is about 12.2rem, the signed-in button at most about 11.4rem with the name capped at 7rem), so the switch from signed-out to signed-in after hydration moves nothing. Row budget at 1024 px: about 490 px left plus about 410 px right inside 960 px of content width.

### Header and menu sheet, phone 390 px

```
+--------------------------------------+
| [P] Pokéfin            (o) [Q]  [=]  |   64 px; (o), [Q], [=] are 44 px targets on touch
+--------------------------------------+

tap [=]: side sheet on WP14's Dialog, backdrop, focus trapped, Esc / backdrop / X close
+------+-------------------------------+
|      | Menu                      [X] |
| ░░░░ |-------------------------------|
| ░░░░ | Market                        |   44 px rows; current page: surface-alt fill,
| ░░░░ | Prices                        |   aria-current="page"
| ░░░░ |#Screener#####################|
| ░░░░ | Sets                          |
| ░░░░ | Portfolio                     |
| ░░░░ | TOOLS                         |
| ░░░░ | Box NAV calculator            |
| ░░░░ | Seller margin check           |
| ░░░░ |-------------------------------|
| ░░░░ | CURRENCY                      |
| ░░░░ | [ USD |#CAD#]                 |   44 px segments
| ░░░░ | 1 USD = 1.3612 CAD, Bank of   |
| ░░░░ | Canada rate of Sep 29         |
| ░░░░ |-------------------------------|
| ░░░░ | (o) Prices as of Sep 30,      |   the sheet variant of the clock: full text
| ░░░░ |     6:10 AM EDT               |   plus the coverage line, whole row is a link
| ░░░░ |     301 of 306 products priced|
| ░░░░ |     within 48 hours of the    |
| ░░░░ |     newest price.             |
| ░░░░ |-------------------------------|
| ░░░░ | [ Sign in ] [Create account]  |   signed in: name, email, Account settings, Sign out
+------+-------------------------------+
  sheet width min(22rem, 100% - 3rem), full height, overscroll-behavior: contain
```

### Data clock (header chip)

Rules (trust-seo-brand.md §5.1, ages measured from the newest `price_recorded_at` across active products):

| Tier | Age | Text | Tone |
|---|---|---|---|
| `fresh` | 0 to 12 h inclusive (a timestamp in the future counts as 0) | `Prices as of Sep 30, 6:10 AM EDT` | neutral, clock icon |
| `aging` | over 12 h, up to 30 h inclusive | server HTML: `Last update Sep 29, 12:10 PM EDT`; after mount: `Last update 18 h ago` (whole hours, floored) | neutral, clock icon |
| `delayed` | over 30 h | `Updates delayed since Sep 28, 6:10 AM EDT` | amber (`bg-warn-fill text-warn-text`), warning icon |
| `unknown` | no product has a `price_recorded_at` | `Price updates unavailable` | amber, warning icon |

- Times use WP07's `formatTimestamp(value, { withYear: false })` (America/Toronto with EDT/EST).
- The server HTML always carries absolute text. A small client child recomputes the tier from the browser clock after mount and every minute (so an ISR page rendered while fresh still turns amber when the page is opened 31 hours later), and switches the aging text to relative hours. Hydration renders the server props first, so there is no mismatch.
- Coverage line (title attribute and sheet): `{n} of {m} products priced within 48 hours of the newest price.` Anchored on the newest price, not on the render time, so cached HTML never states a stale "last 48 hours".
- The chip is a link to `/methodology#cadence`; that section gains one paragraph explaining the chip and its 30-hour rule.
- The `<a>` carries `data-clock-tier` and `data-newest-priced-at` (ISO, UTC). WP22's daily production smoke test reads the second one and fails when it is more than 30 hours old.
- Width: icon only below 1280 px (full text in `sr-only`, so the accessible name is always complete); text at 1280 px and up, capped at `17rem`, truncated with an ellipsis when the row is tighter (the `title` keeps the full sentence).

### Global search

Opened by `/` (ignored while typing in an input, textarea, select or contenteditable), Ctrl-K or Cmd-K (anywhere, `preventDefault` so Firefox does not focus its own search bar), the header button, or `openGlobalSearch()` from any client component (WP32). Ignored while any other dialog is open.

Desktop 1440 px: dialog at 10vh from the top, `max-w-xl` (576 px), up to `min(36rem, 80dvh)` tall, results scroll inside. Phone: full screen.

```
1440 px, query "prism etb", catalog loaded
               +--------------------------------------------------------------+
               | Search Pokéfin                                           [X] |
               |--------------------------------------------------------------|
               | (Q) prism etb_______________________________________________ |   combobox, 16 px on phones
               |--------------------------------------------------------------|
               | PRODUCTS                                                     |
               |#[img] Prismatic Evolutions Elite Trainer Box      C$129.40 ##|   active option: surface-alt
               |#      SV8.5                                      ▲ 4.2% 30D ##|
               | [img] Prismatic Evolutions Elite Trainer Box      C$310.10   |
               |       (Pokémon Center)  SV8.5                    ▼ 1.1% 30D  |
               |       Show all matches on Prices                             |
               | SETS                                                         |
               |       Prismatic Evolutions                                   |
               |       SV8.5 . 9 products . Jan 17, 2025                      |
               |--------------------------------------------------------------|
               | ↑↓ to move . Enter to open . Esc to close                    |   hidden on phones
               +--------------------------------------------------------------+
```

States:

| State | What shows |
|---|---|
| Opening before the panel chunk arrives | Same dialog with the input (typing is kept) and "Loading search…" |
| Empty query | Group "Go to": Prices, Screener, Sets, Portfolio, Methodology; hint "Type a product, set or set code, for example 151 etb." No option is active |
| Catalog loading | Page matches still show; a caption row "Loading products…" |
| Catalog error | "Products could not be loaded." plus a ghost "Try again" button; page matches still work |
| No matches | "No matches for “xyz”." and the option "Missing a product? Tell us" (`/contact?topic=missing_product&q=xyz`) |
| Stale price (2 to 13 days) | Price and change as usual, plus WP23's `AsOf variant="inline"` on the second line: clock icon and "Last priced Sep 25" in warn text (visible on touch, unlike the table variant's tooltip) |
| Withheld price (14 days or more, or null) | "No current price", no change chip |

Results: up to 8 products, then "Show all matches on Prices" (`/prices?q=<query>`), up to 4 sets (link `/prices?q=<set name>` until WP37), up to 4 pages. With a non-empty query the first option is active, so Enter opens it. Arrow Up/Down move with wrap, Enter opens, Escape clears a non-empty query, Escape on an empty query closes, Tab leaves the input for the close button. Hovering an option makes it active, clicking opens it. The active option is prefetched once after it has been active for 150 ms.

Matching (one matcher for `/prices` and search, `app/lib/productSearch.ts`): case-insensitive and accent-insensitive (NFD, combining marks removed); the query splits on whitespace into at most 6 tokens; every token must be a substring of the set name, set code, type label, type name or variant; aliases `etb` = "elite trainer box", `bb` = "booster box", `upc` = "ultra premium collection". A one-word query matches everything `/prices` matched before, plus accent folding and the three aliases (`etb` now also finds "Elite Trainer Box").

Ranking (products): +100 when a token equals the set code, +50 when the set name starts with the whole query, +20 per token that starts a word of the product name, +10 when the product has a current price; ties by newer set release, then name A to Z. Sets: +100 exact code, +50 name starts with the query; ties by newer release. Pages: label and keyword substring match, config order.

### Catalog payload (`GET /api/public/catalog`)

ISR (`dynamic = "force-static"`, `revalidate = 86400`) reading `getCachedMarketProductSummaries()` (tag `market-products`), so WP11's scrape hook refreshes it; `proxy.ts` does not run for `/api/public/*` (WP26's matcher exclusion, applied here if WP26 has not landed). Build-time rendering is fine: every static page already reads the same summaries at build, and that read never throws.

```json
{
  "v": 1,
  "generated_at": "2026-09-30T10:14:03.120Z",
  "as_of": "2026-09-30",
  "img_base": "https://abc.supabase.co/storage/v1/object/public/",
  "items": [
    {
      "id": 42,
      "name": "Prismatic Evolutions Elite Trainer Box",
      "set": "Prismatic Evolutions",
      "set_code": "SV8.5",
      "released": "2025-01-17",
      "type": "Elite Trainer Box",
      "variant": null,
      "usd_price": 95.12,
      "recorded_on": "2026-09-30",
      "ret_30d": 4.2,
      "img": "product-images/products/42.jpg"
    }
  ]
}
```

- `usd_price` and `ret_30d` are `null` whenever migration 0023's gate withheld the price (`hasCurrentPrice` false). `usd_price` is rounded to cents, `ret_30d` (the summaries' `returns["1M"]`, percent units) to 1 decimal.
- `recorded_on` is the UTC date key of `price_recorded_at` (kept for withheld products, so a future offline view can say when they were last priced). The client re-applies the 14-day rule with `isPriceFresh(recorded_on)` at display time, because a cached catalog can be a day old.
- `img` is the image URL with the common `img_base` prefix removed; a URL outside that prefix is kept whole. The client shows the 32 px `_thumb.webp` derivative (same rule as `ProductImage`).
- `as_of` is the newest `recorded_on` among priced items. Items are sorted by `id`.
- Size budget: at most 96 kB raw and 16 kB brotli for 306 products (a test enforces it on synthetic data; Verification measures the real route). A synthetic 306-item payload measured 80 kB raw and 6.6 kB brotli at quality 11 during review: raw size is dominated by repeated keys and costs only parse time, the transfer is the brotli figure.

### Footer (WP24's server footer, reorganised)

```
1440 px
+------------------------------------------------------------------------------------------------------+
| BROWSE          TOOLS                  ACCOUNT          POKÉFIN        [P] Pokéfin                     |
| Prices          Box NAV calculator     Portfolio        About          Sealed Pokémon TCG market data. |
| Screener        Seller margin check    Sign in          Contact        TCGplayer Market Price, updated |
| Sets                                   Create account   Terms          daily.                          |
| Methodology                                             Privacy        Shop at CardRinkTCG.ca ->       |
|------------------------------------------------------------------------------------------------------|
| (WP24's disclaimer, relationship sentence, trademark notices and copyright rows, unchanged)            |
+------------------------------------------------------------------------------------------------------+

390 px: two columns (Browse | Tools, Account | Pokéfin), brand block full width, then the legal rows.
```

Every footer link keeps `prefetch={false}`. WP37 appends set links to Browse.

### Sign-in copy (WP13's `LoginForm`)

The `h1` stays "Welcome back". The subtitle under it depends on the validated `next` path:

| `next` | Subtitle |
|---|---|
| missing, `/`, or anything else | Sign in to your Pokéfin account. |
| `/portfolio` or below it (except the watchlist) | Sign in to track your collection's value. |
| `/portfolio/watchlist` or below it, or any path with `?intent=watch` | Sign in to watch products and get daily alerts. |

The static HTML carries the default sentence (Suspense fallback); the reader swaps it on the client. The subtitle reserves two lines (`min-h-10`) so the swap cannot shift the form.

### Page titles that follow the nav

`/market` shows "Screener" (H1 and `metadata.title`), `/analytics` (and `/stats`) shows "Sets". Descriptions and everything else on those pages stay; WP33 and WP37 redesign them.

### Accessibility

- Nav: `<nav aria-label="Main">`, `aria-current="page"` on the active link (and on the logo on `/`). The logo link's name is "Pokéfin, market home".
- Tools and account menus follow the disclosure pattern (button with `aria-expanded` and `aria-controls`, a panel of links), not `role="menu"`. Escape closes and returns focus to the button; a click outside closes; choosing a link closes.
- The phone sheet is WP14's modal `Dialog` titled "Menu": focus is trapped, the page behind is inert and does not scroll (`html:has(dialog[open])`), Escape, backdrop click and the X close it, and focus returns to the menu button. The menu button has `aria-haspopup="dialog"` and `aria-expanded`.
- Search: APG combobox with a listbox popup (`role="combobox"`, `aria-autocomplete="list"`, `aria-controls`, `aria-expanded`, `aria-activedescendant`); options grouped with `role="group"` labelled by their heading; a polite `role="status"` line announces "8 products, 1 set, 2 pages", "Loading products" or "No matches". The trigger has `aria-haspopup="dialog"` and `aria-keyshortcuts="/ Control+K Meta+K"`; its accessible name "Search products, sets and pages" contains its visible text.
- Data clock: text plus icon, never colour alone; icon-only variant keeps the full text in `sr-only`.
- Every interactive control is at least 44 px on coarse pointers (`pointer-coarse:min-h-11`). Inputs are 16 px on phones (no iOS focus zoom).
- Motion (01-PRODUCT-DIRECTION.md §3.5): colour changes are instant, so no `transition-colors` anywhere in this package; the only transition is the 150 ms rotation of the Tools and account chevrons (`transition-transform`, off under `motion-reduce`). The sheet and dialog appear without animation. Focus styles use `focus-visible:outline-hidden` plus a ring, never `outline-none` (Tailwind 4's `outline-none` removes the outline in forced-colours mode, where the box-shadow ring is not drawn either).

### Performance

- Shared JS grows by at most 6.0 kB gz (acceptance): header markup, `Dialog` (moves into the shared chunk), `SegmentedControl` (moves from `/prices` into shared), `HeaderMenu`, `SearchLauncher` and `DataClock`. `GlobalSearch`, the search index, `marketPulse.isPriceFresh`, `Delta`, `AsOf` usage and the catalog client are one lazy chunk loaded on first open or on hover and focus of the search button.
- No catalog request before the first open; one request per tab per hour after that (module memory).
- The layout adds one cached read per render (the summaries entry `/` already reads, deduplicated by React `cache()` across the two chips). Every page gains the `market-products` tag; WP20's layout already gave every page the `exchange-rate` tag, and WP11's scraper hook revalidates both tags together, so how often pages regenerate does not change. The cost is one data-cache read of the summaries entry per regeneration, and per request on the few dynamic routes (`/account`); it never reaches Supabase between scrapes.
- The favicon drops from a 31 kB PNG to a 3-frame ICO of about 2 kB.
- `/prices` route JS goes down slightly (its `CurrencySelector` leaves, `SegmentedControl` moves to shared).

## Before you start

All paths are relative to `frontend/` unless they start with `audits/`, `migrations/` or `.github/`.

Read in full:

- `audits/remediation/01-PRODUCT-DIRECTION.md` §3.2, §3.7, §4.1, §6.1, §7 and §10; `audits/remediation/research/trust-seo-brand.md` §5.1, §5.2, §10.2, §14.1, §14.2; `audits/remediation/research/performance-excellence.md` §7.3, §8, §12 (installability only), §13.1; `audits/remediation/research/ui-audit.md` "Navigation and information architecture" and "Mobile".
- `app/components/Header.tsx` (WP03, WP04 versions), `app/components/__tests__/Header.test.tsx` (WP03), `app/components/__tests__/Header.auth.test.tsx` (WP04).
- `app/components/Footer.tsx`, `app/components/FooterGate.tsx`, `app/components/CardRinkPromo.tsx` (WP15, WP24 versions).
- `app/layout.tsx` (WP13 metadata and viewport, WP20 `CurrencyProvider`, WP22 `SpeedInsightsClient`, WP23 single font).
- `app/components/ui/Dialog.tsx` and its test (WP14), `app/components/ui/SegmentedControl.tsx`, `Button.tsx`, `Delta.tsx`, `AsOf.tsx`, `icons.tsx`, `README.md` (WP23).
- `app/context/CurrencyContext.tsx`, `app/lib/currency.ts` (WP20; WP38 step 13 added `isExchangeRateStale`, which step 18 imports: `grep -n "export function isExchangeRateStale" app/lib/currency.ts` prints 1 line), `app/components/ProductPrices/hooks/useCurrencyConversion.ts`.
- `app/components/ProductPrices/index.tsx`, `app/components/ProductPrices/utils/urlState.ts` and its tests, `app/components/ProductPrices/utils/filtering.ts`, `app/components/ProductPrices/controls/ControlBar.tsx`, `CurrencySelector.tsx`, `app/lib/locationSearch.ts` (WP08).
- `app/components/MarketView/MarketView.tsx` (the `ControlBar` call), `app/portfolio/page.tsx`, `app/components/BoxCalculator/BoxCalculator.tsx` (the `CurrencySelector` call), `app/components/dashboard/RecentlyReleased.tsx`.
- `app/lib/serverMarketData.ts` (WP11's cached exports block, and WP25's additions if present), `app/lib/cacheTags.ts`, `app/lib/format.ts`, `app/lib/marketPulse.ts` (`isPriceFresh`), `app/lib/priceGuard.ts` (`hasCurrentPrice`), `app/lib/redirects.ts`, `app/lib/site.ts`, `app/lib/contactLink.ts`, `app/lib/jsonLd.ts`, `app/product/[id]/productMeta.ts` (`getProductDisplayName`), `app/components/ProductPrices/shared/ProductImage.tsx` (`toThumbnailUrl`).
- `app/auth/login/LoginForm.tsx`, `app/auth/signup/page.tsx`, `app/auth/forgot-password/page.tsx`, `app/auth/reset-password/page.tsx` (each defines a `PokeballGlyph`).
- `app/methodology/MethodologyArticle.tsx` (`<Section id="cadence">`) and its test.
- `app/__tests__/uiConventions.test.ts` and `uiConventions.baseline.json`.
- `proxy.ts` (matcher), `scripts/prod-smoke-lib.mjs`, `scripts/prod-smoke.mjs`, `scripts/prod-smoke-lib.test.mjs`, `perf-budgets.json`, `README.md` "Performance budgets (CI)".
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md` and `manifest.md`, and `route.md` ("Revalidating Cached Data").

Confirm the dependencies landed. Run from `frontend/`; each command must print what its comment says, otherwise stop and report the missing package:

```bash
git log --oneline -1

# WP13: redirects, login form, icons copied from the old favicon, theme colour
grep -cE "export function (safeReturnToPath|loginPathWithNext)" app/lib/redirects.ts        # 2
ls app/auth/login/LoginForm.tsx app/lib/site.ts app/opengraph-image.tsx
ls app/icon.png app/apple-icon.png 2>&1                     # both listed (WP13 step 6b); "No such file" for icon.png: skip its deletion in step 22d
grep -n 'themeColor: "#ffffff"' app/layout.tsx              # 1 line

# WP14: Dialog and scroll lock
grep -cE "initialFocusRef|const SIZE_CLASS" app/components/ui/Dialog.tsx                    # 2 or more
grep -c "dialog\[open\]" app/globals.css                                                   # 1
ls app/components/ui/__tests__/Dialog.test.tsx

# WP20: currency context in the layout, domain types
grep -cE "export function (useCurrency|CurrencyProvider)" app/context/CurrencyContext.tsx   # 2
grep -c "<CurrencyProvider" app/layout.tsx                                                 # 1
grep -rln "<CurrencySelector" app --include=*.tsx | grep -v __tests__
# expect exactly: app/components/ProductPrices/controls/ControlBar.tsx,
# app/components/BoxCalculator/BoxCalculator.tsx, app/portfolio/page.tsx
ls app/types/market.ts

# WP22: budgets and smoke
ls perf-budgets.json scripts/perf-budget.mjs scripts/perf-serve.mjs scripts/prod-smoke-lib.mjs scripts/prod-smoke-lib.test.mjs
node -e 'console.log(require("./package.json").scripts["perf:budget"])'                   # a command, not undefined

# WP23: components, tokens, ratchets
ls app/components/ui/SegmentedControl.tsx app/components/ui/Button.tsx app/components/ui/Delta.tsx \
   app/components/ui/AsOf.tsx app/components/ui/icons.tsx app/__tests__/uiConventions.baseline.json
grep -cE "const (BRAND_FILES|HEX_RE|RAW_PALETTE_RE|BRAND_RED_RE)\b" app/__tests__/uiConventions.test.ts   # 4
grep -cE -- "--color-(accent|line|warn-fill|warn-text):" app/globals.css                   # 4

# WP24: server footer, contact links, JSON-LD, methodology anchor, trust test
ls app/components/FooterGate.tsx app/content/disclosures.ts app/lib/contactLink.ts app/lib/jsonLd.ts \
   app/methodology/MethodologyArticle.tsx
grep -c 'Section id="cadence"' app/methodology/MethodologyArticle.tsx                      # 1
grep -c "const TRUST_FILES" app/__tests__/uiConventions.test.ts                             # 1

# WP03 and WP04: header tests and session status
ls app/components/__tests__/Header.test.tsx app/components/__tests__/Header.auth.test.tsx
grep -c "sessionStatus" app/components/Header.tsx                                          # 1 or more

# WP08 and WP11
ls app/components/ProductPrices/utils/urlState.ts app/lib/locationSearch.ts app/lib/cacheTags.ts
grep -cE "export function replaceOwnedSearchParams|export function useLocationSearch" app/lib/locationSearch.ts   # 2
grep -cE '^import \{ cache \} from "react";|export const getCachedMarketProductSummaries' app/lib/serverMarketData.ts   # 2

# Parallel packages (either answer is fine; record it for steps 5 and 14)
ls app/lib/publicRoute.ts 2>&1                     # present only if WP26 landed
grep -c "api/((?!public/)" proxy.ts                # 1 if WP26 landed, 0 otherwise
grep -c "getCachedProductStats" app/lib/serverMarketData.ts   # 1 or more if WP25 landed
```

Record the starting state (paste into the PR):

```bash
grep -rnE "PokeballGlyph|PokeballMark|pf-pokeball-top|A15 15 0 0 1 31 16" app | grep -v __tests__
# expect hits in Header.tsx, Footer.tsx and the four auth files (WP15 already removed
# CardRinkPromo's glyph; that file still has red CTA classes, which step 25a replaces)
sha256sum app/favicon.ico app/icon.png app/apple-icon.png
# the old 512 px Poké Ball PNG hashes to d527e3db4cb3f2aea081a71e2f253384760c1baeb4dc047de54671fbc34a2a89
pnpm exec jest app/components/__tests__/Header.test.tsx app/components/__tests__/Header.auth.test.tsx \
  app/__tests__/uiConventions.test.ts                  # all pass
```

Build the perf baseline once on the unmodified branch (WP22) and keep the output; the shared-JS delta in the acceptance criteria is measured against it:

```bash
SUPABASE_STUB_FIXTURE=perf pnpm build:stub
node scripts/perf-serve.mjs &            # note the PID
pnpm perf:budget | tee /tmp/wp27-budget-before.txt
kill <PID>
```

Tools: `python3 -c "import PIL; print(PIL.__version__)"` must print a version for step 22. If it fails, `python3 -m venv /tmp/wp27-venv && /tmp/wp27-venv/bin/pip install Pillow==12.3.0` (the version in the repo's `requirements.txt`) and use `/tmp/wp27-venv/bin/python`.

## Implementation steps

Order: steps 1 to 4 (shared modules and the dialog), 5 to 12 (catalog route and search), 13 to 15 (data clock), 16 to 21 (mark, header, layout), 22 to 25 (icons, manifest, footer, promo, auth pages, JSON-LD), 26 to 28 (currency migration), 29 to 33 (login copy, titles, methodology, smoke check, docs), 34 (conventions test and baseline), 35 (performance measurement). Run `pnpm exec tsc --noEmit` after each group; it must be clean before the next group.

Conventions for every file this package creates: token utilities only (`text-ink`, `text-ink-soft`, `bg-surface`, `bg-surface-alt`, `border-line`, `bg-action`, `text-action`, `ring-action`, `bg-warn-fill`, `text-warn-text`, `rounded-control`, `rounded-card`, `text-body`, `text-small`, `text-caption`), no raw palette classes (`slate-*`, `blue-*`...), no hex colours in `.ts`/`.tsx` except `app/manifest.ts`, no `--pf-pokeball`, no em dashes, and none of the banned UI words ("live", "real-time", "all-time", "TCGPlayer") in code or comments. Step 34 enforces this for the new files.

### Step 1. `app/lib/productSearch.ts` (new) and `filtering.ts`: one product matcher

1a. New `app/lib/productSearch.ts`:

```ts
/**
 * The one product matcher (WP27). /prices filtering and the global search both
 * call it, so a query finds the same products in both places.
 *
 * Case- and accent-insensitive ("pokemon" finds "Pokémon Center"). The query
 * splits on whitespace into at most MAX_TOKENS tokens; every token must be a
 * substring of at least one field. Common abbreviations expand: a token "etb"
 * also matches "elite trainer box". A one-word query matches everything the
 * /prices filter matched before WP27, plus accent folding and the aliases.
 */
export interface ProductSearchFields {
  setName?: string | null;
  setCode?: string | null;
  typeLabel?: string | null;
  typeName?: string | null;
  variant?: string | null;
}

export const MAX_TOKENS = 6;

export const TOKEN_ALIASES: Readonly<Record<string, readonly string[]>> = {
  etb: ["elite trainer box"],
  bb: ["booster box"],
  upc: ["ultra premium collection"],
};

// Escapes, never the literal combining characters: an editor or a copy step
// can normalise those away and silently disable accent folding.
const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;

/** Lower case, accents removed: "Pokémon" -> "pokemon". */
export function foldForSearch(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS_RE, "").toLowerCase();
}

/**
 * A query as match tokens. Each token is a list of alternatives, any one of
 * which may match: [["151"], ["etb", "elite trainer box"]].
 */
export function searchTokens(query: string): string[][] {
  return foldForSearch(query)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_TOKENS)
    .map((token) => [token, ...(TOKEN_ALIASES[token] ?? [])]);
}

/** The searchable fields, folded, empty ones dropped. */
export function foldFields(fields: ProductSearchFields): string[] {
  return [fields.setName, fields.setCode, fields.typeLabel, fields.typeName, fields.variant]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map(foldForSearch);
}

/** Every token has an alternative that is a substring of some folded field. */
export function matchesTokens(folded: readonly string[], tokens: readonly string[][]): boolean {
  return tokens.every((alternatives) =>
    alternatives.some((alternative) => folded.some((field) => field.includes(alternative)))
  );
}

/** An empty or whitespace-only query matches everything. */
export function matchesProductSearch(fields: ProductSearchFields, query: string): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  return matchesTokens(foldFields(fields), tokens);
}
```

1b. `app/components/ProductPrices/utils/filtering.ts`: add `import { matchesProductSearch } from "../../../lib/productSearch";` and replace the search block inside `filterProducts` (from `// Search filter` through the `product.variant?.toLowerCase().includes(searchLower);` line) with:

```ts
    // Search filter: the shared matcher (app/lib/productSearch.ts, WP27), so
    // the global search and this page agree on what a query finds.
    const matchesSearch = matchesProductSearch(
      {
        setName: product.sets?.name,
        setCode: product.sets?.code,
        typeLabel: productTypeLabel,
        typeName: product.product_types?.name,
        variant: product.variant,
      },
      searchTerm
    );
```

Keep `productTypeLabel` (it is still used by the type filter). If WP20 moved the `Product` import to `../../../types/market`, keep that import as it is.

### Step 2. `app/lib/productImages.ts` (new): the thumbnail rule, shared

Move `toThumbnailUrl` out of `app/components/ProductPrices/shared/ProductImage.tsx` so the search panel can use it without importing a component:

```ts
/**
 * Mirror of thumbnail_object_path() in main.py: products/{id}.{ext} ->
 * products/{id}_thumb.webp. Keep both sides in sync. Null when the URL does
 * not have that shape.
 */
export function toThumbnailUrl(url: string): string | null {
  const match = url.match(/^(.*\/products\/)([^/]+)\.(?:jpg|jpeg|png|webp)$/i);
  if (!match) return null;
  return `${match[1]}${match[2]}_thumb.webp`;
}
```

In `ProductImage.tsx`, delete the local function and its comment and add `import { toThumbnailUrl } from "../../../lib/productImages";`. Nothing else changes. If WP26 or WP12 already moved this function (`grep -rn "export function toThumbnailUrl" app`), import it from where it is and skip this step.

### Step 3. `app/components/ui/Dialog.tsx` (WP14): placements and contained scrolling

Add a `placement` prop. The default (`"center"`) must render exactly the classes it renders today, so every existing modal is unchanged.

3a. Below the `SIZE_CLASS` constant add:

```tsx
type DialogPlacement = "center" | "top" | "side";

// "top": the search palette (WP27). Full screen on phones, 10vh from the top
// and at most 36rem tall from sm up. "side": the phone menu sheet (WP27),
// full height at the right edge. Both ignore `size`.
const PLACEMENT_CLASS: Record<DialogPlacement, { dialog: string; panel: string }> = {
  center: {
    dialog: "m-auto w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] rounded-lg",
    panel: "max-h-[calc(100dvh-2rem)]",
  },
  top: {
    dialog:
      "m-0 h-dvh max-h-dvh w-full max-w-none rounded-none sm:mx-auto sm:mt-[10vh] sm:mb-auto sm:h-auto sm:max-h-[min(36rem,80dvh)] sm:w-[calc(100%-2rem)] sm:max-w-xl sm:rounded-lg",
    panel: "h-full sm:h-auto sm:max-h-[min(36rem,80dvh)]",
  },
  side: {
    dialog: "m-0 ml-auto h-dvh max-h-dvh w-[min(22rem,calc(100%-3rem))] max-w-none rounded-none",
    panel: "h-full",
  },
};
```

3b. In `DialogProps` add, after `size?: DialogSize;`:

```tsx
  /** Where the panel sits. Default "center" (every existing modal). */
  placement?: DialogPlacement;
```

and add `placement = "center",` to the destructured props after `size = "md",`.

3c. In the returned JSX:
- The `<dialog>` `className` becomes
  ``className={`${PLACEMENT_CLASS[placement].dialog} ${placement === "center" ? SIZE_CLASS[size] : ""} overflow-hidden bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/50`}``
  (keep whatever colour classes the file has now if WP23 or a later package changed `bg-white`/`text-slate-900`; only the size, margin, width, height and radius classes move into the map).
- The inner wrapper `className="flex max-h-[calc(100dvh-2rem)] flex-col"` becomes ``className={`flex flex-col ${PLACEMENT_CLASS[placement].panel}`}``.
- The scrolling body `className="min-h-0 flex-1 overflow-y-auto"` becomes `className="min-h-0 flex-1 overflow-y-auto overscroll-contain"` (research/performance-excellence.md §13.1: scrolling a sheet must not scroll the page behind it).

Check the default is unchanged: `grep -n "m-auto w-\[calc(100%-2rem)\]" app/components/ui/Dialog.tsx` prints the `center` entry, and WP14's `Dialog.test.tsx` passes unchanged.

### Step 4. `app/components/nav/navConfig.ts` (new): the navigation in one place

```ts
/**
 * The site's navigation in one module (WP27, 01-PRODUCT-DIRECTION.md §4.1).
 * The header, the phone menu sheet, the footer, the global search and the web
 * app manifest all read it.
 *
 * Later packages change one line each: WP33 sets SCREENER.href to "/screener";
 * WP37 sets SETS.href to "/sets" and makes setSearchHref() return the set page.
 *
 * Plain data and pure functions, no "use client": server components (Footer,
 * app/manifest.ts) import it too.
 */
export interface NavLink {
  key: string;
  label: string;
  href: string;
  /** One line for menus and search results. */
  description: string;
  /** Path prefixes that make the link current: "/prices" matches /prices and /prices/x. */
  match: readonly string[];
  /**
   * false for auth-gated or rarely followed links (research/performance-excellence.md §8).
   * Omitted: Next's default (viewport prefetch of static routes).
   */
  prefetch?: false;
}

export const MARKET_HOME: NavLink = {
  key: "market",
  label: "Market",
  href: "/",
  description: "Is the sealed market up, and what moved?",
  match: [],
};

export const PRICES: NavLink = {
  key: "prices",
  label: "Prices",
  href: "/prices",
  description: "Every tracked sealed product, by set",
  match: ["/prices"],
};

export const SCREENER: NavLink = {
  key: "screener",
  label: "Screener",
  href: "/market",
  description: "Rank and filter by returns, risk and liquidity",
  match: ["/market", "/screener"],
};

export const SETS: NavLink = {
  key: "sets",
  label: "Sets",
  href: "/analytics",
  description: "Returns and risk by set",
  match: ["/analytics", "/stats", "/sets"],
};

export const PORTFOLIO: NavLink = {
  key: "portfolio",
  label: "Portfolio",
  href: "/portfolio",
  description: "What you own and what it is worth",
  match: ["/portfolio"],
  prefetch: false,
};

export const PRIMARY_NAV: readonly NavLink[] = [PRICES, SCREENER, SETS, PORTFOLIO];

export const TOOLS_NAV: readonly NavLink[] = [
  {
    key: "box-nav",
    label: "Box NAV calculator",
    href: "/box-calculator",
    description: "A box's price against its packs",
    match: ["/box-calculator"],
  },
  {
    key: "seller-margin",
    label: "Seller margin check",
    href: "/compare",
    description: "Your Shopify prices against the market",
    match: ["/compare"],
  },
];

export const METHODOLOGY: NavLink = {
  key: "methodology",
  label: "Methodology",
  href: "/methodology",
  description: "How every number is sourced and calculated",
  match: ["/methodology"],
};

export const ABOUT_NAV: readonly NavLink[] = [
  { key: "about", label: "About", href: "/about", description: "Who runs Pokéfin and how it is funded", match: ["/about"] },
  { key: "contact", label: "Contact", href: "/contact", description: "Report a wrong price or ask a question", match: ["/contact"] },
  { key: "terms", label: "Terms", href: "/terms", description: "Terms of use", match: ["/terms"] },
  { key: "privacy", label: "Privacy", href: "/privacy", description: "What Pokéfin collects and why", match: ["/privacy"] },
];

export const ACCOUNT_NAV = {
  signIn: { key: "sign-in", label: "Sign in", href: "/auth/login", description: "Sign in", match: ["/auth/login"], prefetch: false },
  signUp: { key: "sign-up", label: "Create account", href: "/auth/signup", description: "Create an account", match: ["/auth/signup"], prefetch: false },
  settings: { key: "account", label: "Account settings", href: "/account", description: "Username, password, your data", match: ["/account"], prefetch: false },
} as const satisfies Record<string, NavLink>;

export const FOOTER_BROWSE: readonly NavLink[] = [PRICES, SCREENER, SETS, METHODOLOGY];
export const FOOTER_ACCOUNT: readonly NavLink[] = [PORTFOLIO, ACCOUNT_NAV.signIn, ACCOUNT_NAV.signUp];

export function isNavActive(link: NavLink, pathname: string): boolean {
  return link.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function productHref(id: number): string {
  return `/product/${id}`;
}

/** /prices filtered to a query. */
export function pricesSearchHref(query: string): string {
  return `${PRICES.href}?${new URLSearchParams({ q: query }).toString()}`;
}

/** Where a set result goes. WP37 changes this to the set page. */
export function setSearchHref(setName: string): string {
  return pricesSearchHref(setName);
}

export interface SearchPage {
  key: string;
  label: string;
  href: string;
  description: string;
  keywords: readonly string[];
}

const PAGE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  market: ["home", "dashboard", "movers", "market", "index"],
  prices: ["prices", "catalog", "products", "browse"],
  screener: ["screener", "market view", "rank", "filter", "returns", "volatility", "liquidity"],
  sets: ["sets", "set analytics", "expansions", "composite score"],
  portfolio: ["portfolio", "collection", "holdings", "collectr", "import"],
  "box-nav": ["box", "nav", "calculator", "packs", "pack value"],
  "seller-margin": ["seller", "shopify", "margin", "compare", "csv", "seller tools"],
  methodology: ["methodology", "how", "formula", "definitions", "freshness", "cadence", "volatility", "returns"],
  about: ["about", "who", "disclosure", "store"],
  contact: ["contact", "report", "feedback", "wrong price", "missing product", "email"],
  terms: ["terms", "legal"],
  privacy: ["privacy", "data", "cookies"],
};

export const SEARCH_PAGES: readonly SearchPage[] = [
  MARKET_HOME,
  ...PRIMARY_NAV,
  ...TOOLS_NAV,
  METHODOLOGY,
  ...ABOUT_NAV,
].map(({ key, label, href, description }) => ({
  key,
  label,
  href,
  description,
  keywords: PAGE_KEYWORDS[key] ?? [],
}));

/** Shown when the search box is empty, in this order. */
export const SEARCH_SUGGESTION_KEYS: readonly string[] = ["prices", "screener", "sets", "portfolio", "methodology"];
```


### Step 5. `app/lib/publicRoute.ts` and the `proxy.ts` matcher (only if WP26 has not landed)

If `app/lib/publicRoute.ts` exists (WP26), use it as it is and skip 5a. If `proxy.ts` already contains `"/api/((?!public/).*)"`, skip 5b. Otherwise do what WP26 steps 6a and 7 specify, verbatim, so the two packages converge on identical files:

5a. New `app/lib/publicRoute.ts`:

```ts
import "server-only";
import { NextResponse } from "next/server";

/**
 * Helpers for the anonymous read routes under app/api/public/ (WP26). Those
 * routes never read cookies or request headers: they are shared by every
 * visitor, cached by the CDN, and proxy.ts does not run for them.
 */
export const GENERATED_AT_HEADER = "x-pokefin-generated-at";

/**
 * 200 JSON stamped with its render time. Two responses with the same stamp
 * came from one cached render (scripts/check-public-cache.mjs relies on it).
 */
export function publicJson(body: unknown): NextResponse {
  return NextResponse.json(body, {
    headers: { [GENERATED_AT_HEADER]: new Date().toISOString() },
  });
}

export function publicNotFound(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
```

5b. `proxy.ts`, in `export const config`, replace the matcher entry `"/api/:path*",` with:

```ts
    // Every API route except the anonymous, CDN-cached /api/public/* reads
    // (WP26): they need no rate limit (bounded inputs, served from cache) and
    // no session refresh, and running the proxy would add an auth round trip
    // to every cache hit for signed-in visitors.
    "/api/((?!public/).*)",
```

Leave the other matcher entries and the proxy body unchanged. Add the proxy matcher cases from Tests item 10 only if WP26's test for them does not exist yet (`grep -rn "api/public" app/lib/__tests__/proxy*.test.ts`).

### Step 6. `app/lib/catalogPayload.ts` (new): the catalog contract, shared by the route and the browser

```ts
/**
 * The compact catalog served by GET /api/public/catalog (WP27): global search
 * today, the offline shell later (01-PRODUCT-DIRECTION.md §10). Bump
 * CATALOG_PAYLOAD_VERSION on any breaking change; clients reject other
 * versions and fall back to page results.
 *
 * No imports: the browser bundle that validates the payload stays tiny.
 */
export const CATALOG_PAYLOAD_VERSION = 1;

export interface CatalogItem {
  id: number;
  /** getProductDisplayName: "Prismatic Evolutions Elite Trainer Box (Pokémon Center)". */
  name: string;
  set: string | null;
  set_code: string | null;
  /** Set release date, YYYY-MM-DD. */
  released: string | null;
  /** Product type label ("Elite Trainer Box"). */
  type: string | null;
  variant: string | null;
  /** Null when migration 0023's gate withheld the price. Cents. */
  usd_price: number | null;
  /** UTC date key of the newest recorded price, kept for withheld products. */
  recorded_on: string | null;
  /** 30-day change in percent units, 1 decimal. Null with a withheld price. */
  ret_30d: number | null;
  /** Image path relative to img_base, or a full URL outside it. */
  img: string | null;
}

export interface CatalogPayload {
  v: typeof CATALOG_PAYLOAD_VERSION;
  generated_at: string;
  /** Newest recorded_on among priced items. */
  as_of: string | null;
  img_base: string | null;
  items: CatalogItem[];
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

export function isCatalogItem(value: unknown): value is CatalogItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "number" &&
    Number.isSafeInteger(v.id) &&
    typeof v.name === "string" &&
    isNullableString(v.set) &&
    isNullableString(v.set_code) &&
    isNullableString(v.released) &&
    isNullableString(v.type) &&
    isNullableString(v.variant) &&
    isNullableNumber(v.usd_price) &&
    isNullableString(v.recorded_on) &&
    isNullableNumber(v.ret_30d) &&
    isNullableString(v.img)
  );
}

export function isCatalogPayload(value: unknown): value is CatalogPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === CATALOG_PAYLOAD_VERSION &&
    typeof v.generated_at === "string" &&
    isNullableString(v.as_of) &&
    isNullableString(v.img_base) &&
    Array.isArray(v.items) &&
    v.items.every(isCatalogItem)
  );
}

/** The full image URL of an item, or null. */
export function catalogImageUrl(imgBase: string | null, item: Pick<CatalogItem, "img">): string | null {
  if (!item.img) return null;
  if (/^https?:\/\//.test(item.img)) return item.img;
  return imgBase ? `${imgBase}${item.img}` : null;
}
```

### Step 7. `GET /api/public/catalog`: builder and route (new)

7a. New `app/api/public/catalog/buildCatalogPayload.ts` (server side; colocated files next to `route.ts` are not routes):

```ts
import type { Product } from "../../../types/market";
import { recordedAtDateKey } from "../../../lib/format";
import { hasCurrentPrice } from "../../../lib/priceGuard";
import {
  CATALOG_PAYLOAD_VERSION,
  type CatalogItem,
  type CatalogPayload,
} from "../../../lib/catalogPayload";
import { getProductDisplayName } from "../../../product/[id]/productMeta";

// Supabase Storage public URLs look like
// https://<project>.supabase.co/storage/v1/object/public/<bucket>/products/42.jpg.
// Everything up to and including this marker is sent once as img_base.
const STORAGE_MARKER = "/storage/v1/object/public/";
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}/;

function roundTo(value: number | null | undefined, digits: 1 | 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded; // no -0
}

function dateKey(value: string | null | undefined): string | null {
  const match = value ? DATE_KEY_RE.exec(value) : null;
  return match ? match[0] : null;
}

export function imageBase(products: readonly Product[]): string | null {
  for (const product of products) {
    const url = product.image_url;
    if (!url) continue;
    const at = url.indexOf(STORAGE_MARKER);
    if (at > 0) return url.slice(0, at + STORAGE_MARKER.length);
  }
  return null;
}

export function toCatalogItem(product: Product, imgBase: string | null): CatalogItem {
  // The summaries already carry migration 0023's gate: a withheld price is
  // null, and so is every return derived from it. hasCurrentPrice reads that.
  const priced = hasCurrentPrice(product);
  const url = product.image_url ?? null;
  return {
    id: product.id,
    name: getProductDisplayName(product),
    set: product.sets?.name ?? null,
    set_code: product.sets?.code ?? null,
    released: dateKey(product.sets?.release_date),
    type: product.product_types?.label || product.product_types?.name || null,
    variant: product.variant ?? null,
    usd_price: priced ? roundTo(product.usd_price, 2) : null,
    recorded_on: recordedAtDateKey(product.price_recorded_at),
    ret_30d: priced ? roundTo(product.returns?.["1M"], 1) : null,
    img: url && imgBase && url.startsWith(imgBase) ? url.slice(imgBase.length) : url,
  };
}

export function buildCatalogPayload(products: readonly Product[], generatedAt: Date): CatalogPayload {
  const imgBase = imageBase(products);
  const items = products.map((product) => toCatalogItem(product, imgBase)).sort((a, b) => a.id - b.id);
  let asOf: string | null = null;
  for (const item of items) {
    if (item.usd_price !== null && item.recorded_on && (asOf === null || item.recorded_on > asOf)) {
      asOf = item.recorded_on;
    }
  }
  return {
    v: CATALOG_PAYLOAD_VERSION,
    generated_at: generatedAt.toISOString(),
    as_of: asOf,
    img_base: imgBase,
    items,
  };
}
```

If `Product` still lives in `app/components/ProductPrices/types` (WP20 not applied to this import path), import it from wherever `serverMarketData.ts` imports it. If `product.returns` has no `"1M"` key in the current type, use the key that holds the 30-day return (`grep -n '"1M"' app/lib/marketData.ts` shows `"1M": row.return_30d`).

7b. New `app/api/public/catalog/route.ts`:

```ts
/**
 * GET /api/public/catalog: the compact catalog for global search (WP27) and,
 * later, the offline shell. Under 16 kB brotli for 306 products (about 7 kB
 * measured on synthetic data).
 *
 * ISR: rendered at build (the same summaries read every static page makes;
 * it degrades instead of throwing) and again on the first request after the
 * "market-products" tag is revalidated by the scraper hook or the daily
 * backstop; the CDN serves it in between. No cookies, headers or params are
 * read, and proxy.ts does not run for /api/public/*. Segment config must stay
 * literal: Next reads it statically.
 */
import { getCachedMarketProductSummaries } from "../../../lib/serverMarketData";
import { logCaughtError } from "../../../lib/logger";
import { publicJson } from "../../../lib/publicRoute";
import { buildCatalogPayload } from "./buildCatalogPayload";

export const dynamic = "force-static";
export const revalidate = 86400;

export async function GET() {
  try {
    const products = await getCachedMarketProductSummaries();
    return publicJson(buildCatalogPayload(products, new Date()));
  } catch (error) {
    // Rethrown: Next answers 500 and keeps the previous cached response.
    logCaughtError("public_catalog_failed", error);
    throw error;
  }
}
```

No new perf fixture route is needed: the route reads only the summaries RPC, which WP22's fixture already answers.

7c. If WP26 landed (`ls scripts/check-public-cache.mjs`), prove the catalog is served from the ISR cache like the sparkline route: in that script's `main()`, directly after the `problems.push(...isrProblems("/api/public/sparklines/3M", ...))` line, add

```js
  const catalog = await twice(origin, "/api/public/catalog", headers);
  problems.push(...isrProblems("/api/public/catalog", catalog.first, catalog.second, { requireVercelHit }));
```

and add `/api/public/catalog` to any route list in that script's test (`scripts/check-public-cache.test.mjs`) that enumerates the ISR routes. If WP26 has not landed, skip 7c and say in the PR that `/api/public/catalog` must be added to `check-public-cache.mjs` when WP26 lands (the WP26 implementer reads this PR's list of public routes).

### Step 8. `app/lib/publicCatalog.ts` (new): the browser side, fetched on first open only

```ts
import { isCatalogPayload, type CatalogPayload } from "./catalogPayload";

/**
 * The browser's copy of /api/public/catalog (WP27). Loaded the first time the
 * search dialog opens, never on page load or hover, then kept in memory for
 * an hour per tab. A failure is not kept, so "Try again" re-requests.
 */
export const CATALOG_URL = "/api/public/catalog";
export const CATALOG_TTL_MS = 60 * 60 * 1000;

let pending: { promise: Promise<CatalogPayload>; at: number } | null = null;
let ready: { payload: CatalogPayload; at: number } | null = null;

/** The loaded catalog if it is younger than the TTL, else null. No request. */
export function peekPublicCatalog(nowMs: number = Date.now()): CatalogPayload | null {
  return ready && nowMs - ready.at < CATALOG_TTL_MS ? ready.payload : null;
}

export function loadPublicCatalog(): Promise<CatalogPayload> {
  const now = Date.now();
  if (pending && now - pending.at < CATALOG_TTL_MS) return pending.promise;
  const promise = fetch(CATALOG_URL, { headers: { accept: "application/json" } }).then(async (res) => {
    if (!res.ok) throw new Error(`${CATALOG_URL}: HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (!isCatalogPayload(body)) throw new Error(`${CATALOG_URL}: unexpected payload`);
    ready = { payload: body, at: Date.now() };
    return body;
  });
  pending = { promise, at: now };
  promise.catch(() => {
    if (pending?.promise === promise) pending = null;
  });
  return promise;
}

/** Test-only. */
export function _resetPublicCatalogForTests(): void {
  pending = null;
  ready = null;
}
```

### Step 9. `app/components/search/searchIndex.ts` (new): matching and ranking, pure

```ts
import type { CatalogItem, CatalogPayload } from "../../lib/catalogPayload";
import { buildContactHref } from "../../lib/contactLink";
import { foldForSearch, matchesTokens, searchTokens } from "../../lib/productSearch";
import {
  SEARCH_SUGGESTION_KEYS,
  pricesSearchHref,
  productHref,
  setSearchHref,
  type SearchPage,
} from "../nav/navConfig";

export const RESULT_LIMITS = { products: 8, sets: 4, pages: 4 } as const;

const NON_WORD_RE = /[^a-z0-9.]+/g;

interface IndexedProduct {
  item: CatalogItem;
  /** Folded set name, set code, type label, variant. */
  fields: string[];
  /** " prismatic evolutions elite trainer box pokemon center " for word-start tests. */
  words: string;
  setName: string;
  setCode: string;
  releasedMs: number;
}

interface IndexedSet {
  name: string;
  code: string | null;
  released: string | null;
  productCount: number;
  fields: string[];
  foldedName: string;
  foldedCode: string;
  releasedMs: number;
}

export interface SearchIndex {
  products: IndexedProduct[];
  sets: IndexedSet[];
}

export type SearchOption =
  | { kind: "product"; id: string; href: string; item: CatalogItem }
  | { kind: "all"; id: string; href: string; query: string }
  | { kind: "set"; id: string; href: string; name: string; code: string | null; released: string | null; productCount: number }
  | { kind: "page"; id: string; href: string; page: SearchPage }
  | { kind: "report"; id: string; href: string; query: string };

export interface SearchGroup {
  key: "products" | "sets" | "pages" | "report";
  label: string;
  options: SearchOption[];
}

export interface SearchResults {
  groups: SearchGroup[];
  /** Every option in keyboard order. */
  options: SearchOption[];
  counts: { products: number; sets: number; pages: number };
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function releaseMs(released: string | null): number {
  if (!released) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(`${released}T00:00:00Z`);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

function asWords(value: string): string {
  return ` ${foldForSearch(value).replace(NON_WORD_RE, " ").trim()} `;
}

export function buildSearchIndex(payload: CatalogPayload): SearchIndex {
  const products: IndexedProduct[] = payload.items.map((item) => ({
    item,
    fields: [item.set, item.set_code, item.type, item.variant].filter(nonEmpty).map(foldForSearch),
    words: asWords(item.name),
    setName: foldForSearch(item.set ?? ""),
    setCode: foldForSearch(item.set_code ?? ""),
    releasedMs: releaseMs(item.released),
  }));
  const bySet = new Map<string, IndexedSet>();
  for (const product of products) {
    const name = product.item.set;
    if (!name) continue;
    const existing = bySet.get(name);
    if (existing) {
      existing.productCount += 1;
      continue;
    }
    bySet.set(name, {
      name,
      code: product.item.set_code,
      released: product.item.released,
      productCount: 1,
      fields: [name, product.item.set_code].filter(nonEmpty).map(foldForSearch),
      foldedName: product.setName,
      foldedCode: product.setCode,
      releasedMs: product.releasedMs,
    });
  }
  return { products, sets: [...bySet.values()] };
}

function scoreProduct(product: IndexedProduct, tokens: string[][], foldedQuery: string): number {
  let score = 0;
  for (const alternatives of tokens) {
    if (product.setCode && alternatives.includes(product.setCode)) score += 100;
    if (alternatives.some((alternative) => product.words.includes(` ${alternative}`))) score += 20;
  }
  if (product.setName.startsWith(foldedQuery)) score += 50;
  if (product.item.usd_price !== null) score += 10;
  return score;
}

function scoreSet(set: IndexedSet, tokens: string[][], foldedQuery: string): number {
  let score = 0;
  if (set.foldedCode && tokens.some((alternatives) => alternatives.includes(set.foldedCode))) score += 100;
  if (set.foldedName.startsWith(foldedQuery)) score += 50;
  return score;
}

function pageOption(page: SearchPage): SearchOption {
  return { kind: "page", id: `g-${page.key}`, href: page.href, page };
}

function finish(groups: SearchGroup[], counts: SearchResults["counts"]): SearchResults {
  const kept = groups.filter((group) => group.options.length > 0);
  return { groups: kept, options: kept.flatMap((group) => group.options), counts };
}

/**
 * Results for a query. `index` is null while the catalog loads or after it
 * failed: pages still match. An empty query returns the suggested pages.
 */
export function searchAll(
  index: SearchIndex | null,
  query: string,
  pages: readonly SearchPage[]
): SearchResults {
  const trimmed = query.trim();
  const tokens = searchTokens(trimmed);
  if (tokens.length === 0) {
    const suggestions = SEARCH_SUGGESTION_KEYS.map((key) => pages.find((page) => page.key === key))
      .filter((page): page is SearchPage => page !== undefined)
      .map(pageOption);
    return finish([{ key: "pages", label: "Go to", options: suggestions }], {
      products: 0,
      sets: 0,
      pages: suggestions.length,
    });
  }
  const foldedQuery = foldForSearch(trimmed).replace(/\s+/g, " ");

  const productHits = index
    ? index.products
        .filter((product) => matchesTokens(product.fields, tokens))
        .map((product) => ({ product, score: scoreProduct(product, tokens, foldedQuery) }))
        .sort(
          (a, b) =>
            b.score - a.score ||
            b.product.releasedMs - a.product.releasedMs ||
            a.product.item.name.localeCompare(b.product.item.name)
        )
        .slice(0, RESULT_LIMITS.products)
    : [];
  const productOptions: SearchOption[] = productHits.map(({ product }) => ({
    kind: "product",
    id: `p-${product.item.id}`,
    href: productHref(product.item.id),
    item: product.item,
  }));
  if (productOptions.length > 0) {
    productOptions.push({ kind: "all", id: "all", href: pricesSearchHref(trimmed), query: trimmed });
  }

  const setOptions: SearchOption[] = index
    ? index.sets
        .filter((set) => matchesTokens(set.fields, tokens))
        .map((set) => ({ set, score: scoreSet(set, tokens, foldedQuery) }))
        .sort((a, b) => b.score - a.score || b.set.releasedMs - a.set.releasedMs || a.set.name.localeCompare(b.set.name))
        .slice(0, RESULT_LIMITS.sets)
        .map(({ set }, position) => ({
          kind: "set" as const,
          id: `s-${position}`,
          href: setSearchHref(set.name),
          name: set.name,
          code: set.code,
          released: set.released,
          productCount: set.productCount,
        }))
    : [];

  const pageOptions = pages
    .filter((page) =>
      matchesTokens([foldForSearch(page.label), ...page.keywords.map(foldForSearch)], tokens)
    )
    .slice(0, RESULT_LIMITS.pages)
    .map(pageOption);

  const counts = { products: productHits.length, sets: setOptions.length, pages: pageOptions.length };
  const groups: SearchGroup[] = [
    { key: "products", label: "Products", options: productOptions },
    { key: "sets", label: "Sets", options: setOptions },
    { key: "pages", label: "Pages", options: pageOptions },
  ];
  // Only once the catalog answered: "not found" while loading would be false.
  if (index && counts.products + counts.sets + counts.pages === 0) {
    groups.push({
      key: "report",
      label: "Can't find it?",
      options: [
        {
          kind: "report",
          id: "report",
          href: buildContactHref({ topic: "missing_product", query: trimmed }),
          query: trimmed,
        },
      ],
    });
  }
  return finish(groups, counts);
}
```

### Step 10. Search shell modules (new): events, field, trigger

10a. `app/components/search/searchEvents.ts`:

```ts
/**
 * How anything on a page opens the header's global search (WP27), and the
 * one place the lazy panel chunk is imported. Nothing here imports the panel
 * statically, so it stays out of the shared bundle.
 */
export const OPEN_SEARCH_EVENT = "pokefin:open-search";

export interface OpenSearchDetail {
  query?: string;
}

/** Opens the header search dialog, optionally with a query. */
export function openGlobalSearch(query = ""): void {
  window.dispatchEvent(new CustomEvent<OpenSearchDetail>(OPEN_SEARCH_EVENT, { detail: { query } }));
}

/** The lazy panel chunk. Calling it again returns the same module. */
export function loadGlobalSearch() {
  return import("./GlobalSearch");
}

const NON_TEXT_INPUT_TYPES = new Set([
  "button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit",
]);

/** True when a "/" typed here is text, not a shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  if (target.tagName !== "INPUT") return false;
  return !NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
}

/** "/" (outside text fields), Ctrl-K or Cmd-K. */
export function isSearchShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.repeat) return false;
  if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
    return true;
  }
  if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    return !isTypingTarget(event.target);
  }
  return false;
}
```

10b. `app/components/search/SearchField.tsx` (the input, shared by the loading shell and the panel so typing is kept across the swap):

```tsx
"use client";

import type { InputHTMLAttributes, RefObject } from "react";

export function SearchIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" focusable="false" className={className}>
      <circle cx="7" cy="7" r="4.75" />
      <path d="m10.5 10.5 3.25 3.25" />
    </svg>
  );
}

export interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onValueChange: (value: string) => void;
}

/** 16 px text on phones (no iOS focus zoom), sticky above the results. */
export default function SearchField({ inputRef, value, onValueChange, className = "", ...rest }: SearchFieldProps) {
  return (
    <div className="sticky top-0 z-10 border-b border-line bg-surface px-3 py-2">
      <div className="flex items-center gap-2 rounded-control border border-line bg-surface px-3 focus-within:ring-2 focus-within:ring-action">
        <SearchIcon className="size-4 shrink-0 text-ink-soft" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          aria-label="Search products, sets and pages"
          placeholder="Product, set or set code"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          className={`h-11 w-full min-w-0 bg-transparent text-base text-ink placeholder:text-ink-soft focus:outline-hidden sm:h-10 sm:text-sm ${className}`}
          {...rest}
        />
      </div>
    </div>
  );
}
```

10c. `app/components/search/SearchTrigger.tsx` (for WP32's home header and any later page):

```tsx
"use client";

import type { ReactNode } from "react";
import { loadGlobalSearch, openGlobalSearch } from "./searchEvents";

/**
 * A button that opens the header's global search (the SearchLauncher mounted
 * by the root layout). Preloads the panel chunk on hover and focus; never
 * loads the catalog before the dialog opens.
 */
export default function SearchTrigger({
  children,
  className = "",
  query = "",
}: {
  children: ReactNode;
  className?: string;
  query?: string;
}) {
  const preload = () => {
    void loadGlobalSearch();
  };
  return (
    <button
      type="button"
      onClick={() => openGlobalSearch(query)}
      onPointerEnter={preload}
      onFocus={preload}
      aria-haspopup="dialog"
      className={className}
    >
      {children}
    </button>
  );
}
```

### Step 11. `app/components/search/GlobalSearch.tsx` (new, lazy chunk): the combobox panel

Rendered inside the launcher's `Dialog`. The launcher owns `query` so text typed while this chunk loads is kept.

```tsx
"use client";

import { useEffect, useId, useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import { useRouter } from "next/navigation";
import AsOf, { STALE_AFTER_DAYS, daysBetween } from "../ui/AsOf";
import Button from "../ui/Button";
import Delta from "../ui/Delta";
import { useCurrency } from "../../context/CurrencyContext";
import { catalogImageUrl, type CatalogPayload } from "../../lib/catalogPayload";
import { formatDateOnly } from "../../lib/format";
import { isPriceFresh } from "../../lib/marketPulse";
import { toThumbnailUrl } from "../../lib/productImages";
import { loadPublicCatalog, peekPublicCatalog } from "../../lib/publicCatalog";
import { SEARCH_PAGES } from "../nav/navConfig";
import SearchField from "./SearchField";
import { buildSearchIndex, searchAll, type SearchOption, type SearchResults } from "./searchIndex";

export interface GlobalSearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Closes the dialog and navigates. */
  onNavigate: (href: string) => void;
}

type CatalogState =
  | { status: "loading" }
  | { status: "ready"; payload: CatalogPayload }
  | { status: "error" };

const PREFETCH_DWELL_MS = 150;
const prefetched = new Set<string>();

/** Today's UTC date key. A module function keeps render lint-pure (WP23's AsOf does the same). */
function todayUtcKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function initialCatalogState(): CatalogState {
  const cached = peekPublicCatalog();
  return cached ? { status: "ready", payload: cached } : { status: "loading" };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function statusText(results: SearchResults, status: CatalogState["status"], trimmed: string): string {
  if (trimmed === "") return "";
  const { products, sets, pages } = results.counts;
  if (status === "loading" && products + sets + pages === 0) return "Loading products";
  if (products + sets + pages === 0) return status === "error" ? "Products could not be loaded" : "No matches";
  return [plural(products, "product", "products"), plural(sets, "set", "sets"), plural(pages, "page", "pages")].join(", ");
}

export default function GlobalSearch({ query, onQueryChange, inputRef, onNavigate }: GlobalSearchProps) {
  const router = useRouter();
  const { formatPrice } = useCurrency();
  const listboxId = useId();
  const [catalog, setCatalog] = useState<CatalogState>(initialCatalogState);

  // First open: one request, shared per tab for an hour (lib/publicCatalog.ts).
  // State is only set in the promise callbacks.
  useEffect(() => {
    if (catalog.status !== "loading") return;
    let cancelled = false;
    loadPublicCatalog().then(
      (payload) => {
        if (!cancelled) setCatalog({ status: "ready", payload });
      },
      () => {
        if (!cancelled) setCatalog({ status: "error" });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [catalog.status]);

  // The launcher's loading field had focus while this chunk downloaded.
  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  const index = useMemo(
    () => (catalog.status === "ready" ? buildSearchIndex(catalog.payload) : null),
    [catalog]
  );
  // About 300 items: matching is well under a millisecond, so no deferral.
  const results = useMemo(() => searchAll(index, query, SEARCH_PAGES), [index, query]);
  const { options } = results;
  const trimmed = query.trim();

  // The active option is remembered with the result set it was picked in, so
  // a new query or a loaded catalog falls back to the default (first result
  // while typing, none for suggestions) without an effect.
  const resultsKey = `${query}|${catalog.status}`;
  const [picked, setPicked] = useState<{ key: string; index: number } | null>(null);
  const defaultIndex = trimmed !== "" && options.length > 0 ? 0 : -1;
  const activeIndex =
    picked !== null && picked.key === resultsKey && picked.index < options.length ? picked.index : defaultIndex;
  const activeOption: SearchOption | undefined = activeIndex >= 0 ? options[activeIndex] : undefined;
  const domId = (option: SearchOption) => `${listboxId}-${option.id}`;
  const activeDomId = activeOption ? domId(activeOption) : undefined;

  // Prefetch the option the user rests on, once per href per tab.
  const activeHref = activeOption?.href;
  useEffect(() => {
    if (!activeHref || prefetched.has(activeHref)) return;
    const timer = window.setTimeout(() => {
      prefetched.add(activeHref);
      router.prefetch(activeHref);
    }, PREFETCH_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [activeHref, router]);

  // Keep the active option in view while arrowing through the list.
  useEffect(() => {
    if (!activeDomId) return;
    document.getElementById(activeDomId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeDomId]);

  const move = (step: 1 | -1) => {
    if (options.length === 0) return;
    const from = activeIndex === -1 ? (step === 1 ? -1 : 0) : activeIndex;
    setPicked({ key: resultsKey, index: (from + step + options.length) % options.length });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      if (!activeOption) return;
      event.preventDefault();
      onNavigate(activeOption.href);
    } else if (event.key === "Escape" && query !== "") {
      // Claimed, so WP14's Dialog (which skips a prevented Escape) stays open.
      event.preventDefault();
      onQueryChange("");
    }
  };

  const imgBase = catalog.status === "ready" ? catalog.payload.img_base : null;

  return (
    <div className="flex min-h-full flex-col">
      <SearchField
        inputRef={inputRef}
        value={query}
        onValueChange={onQueryChange}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={options.length > 0}
        aria-controls={options.length > 0 ? listboxId : undefined}
        aria-activedescendant={activeDomId}
      />
      <p role="status" className="sr-only">
        {statusText(results, catalog.status, trimmed)}
      </p>
      {trimmed === "" && (
        <p className="px-4 pt-3 text-caption text-ink-soft">
          Type a product, set or set code, for example 151 etb.
        </p>
      )}
      {trimmed !== "" && catalog.status === "loading" && (
        <p className="px-4 pt-3 text-caption text-ink-soft">Loading products…</p>
      )}
      {catalog.status === "error" && (
        <div className="flex items-center justify-between gap-3 px-4 pt-3 text-small text-ink-soft">
          <span>Products could not be loaded.</span>
          <Button variant="ghost" size="sm" onClick={() => setCatalog({ status: "loading" })}>
            Try again
          </Button>
        </div>
      )}
      {results.groups.some((group) => group.key === "report") && (
        <p className="px-4 pt-3 text-small text-ink">No matches for “{trimmed}”.</p>
      )}
      {options.length > 0 && (
        <div id={listboxId} role="listbox" aria-label="Search results" className="flex-1 px-2 pb-2">
          {results.groups.map((group) => (
            <div key={group.key} role="group" aria-labelledby={`${listboxId}-${group.key}`} className="pt-2">
              <div
                id={`${listboxId}-${group.key}`}
                className="px-2 pb-1 text-caption font-semibold uppercase tracking-wide text-ink-soft"
              >
                {group.label}
              </div>
              {group.options.map((option) => {
                const position = options.indexOf(option);
                return (
                  <OptionRow
                    key={option.id}
                    id={domId(option)}
                    option={option}
                    active={position === activeIndex}
                    onPoint={() => setPicked({ key: resultsKey, index: position })}
                    onChoose={() => onNavigate(option.href)}
                    formatPrice={formatPrice}
                    imgBase={imgBase}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
      <p className="mt-auto hidden border-t border-line px-4 py-2 text-caption text-ink-soft sm:block">
        ↑↓ to move · Enter to open · Esc to close
      </p>
    </div>
  );
}

interface OptionRowProps {
  id: string;
  option: SearchOption;
  active: boolean;
  onPoint: () => void;
  onChoose: () => void;
  formatPrice: (usd: number | null | undefined) => string;
  imgBase: string | null;
}

function OptionRow({ id, option, active, onPoint, onChoose, formatPrice, imgBase }: OptionRowProps) {
  return (
    // Keyboard selection runs through the combobox input (aria-activedescendant);
    // mousedown is prevented so a click never takes focus from the input.
    <div
      id={id}
      role="option"
      aria-selected={active}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={active ? undefined : onPoint}
      onClick={onChoose}
      className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-control px-2 py-1.5 pointer-coarse:min-h-14 ${
        active ? "bg-surface-alt" : ""
      }`}
    >
      <OptionContent option={option} formatPrice={formatPrice} imgBase={imgBase} />
    </div>
  );
}

function OptionContent({
  option,
  formatPrice,
  imgBase,
}: Pick<OptionRowProps, "option" | "formatPrice" | "imgBase">) {
  switch (option.kind) {
    case "product": {
      const { item } = option;
      // The catalog can be a day old: re-apply migration 0023's 14-day rule
      // at display time, like the server does.
      const fresh = item.usd_price !== null && isPriceFresh(item.recorded_on);
      // 2 to 13 days old: shown, but flagged in text on the second line. AsOf's
      // inline variant, not "table": a title tooltip never shows on touch (WP23).
      const stale =
        fresh && item.recorded_on !== null && daysBetween(item.recorded_on, todayUtcKey()) >= STALE_AFTER_DAYS;
      const source = catalogImageUrl(imgBase, item);
      const thumb = source ? (toThumbnailUrl(source) ?? source) : null;
      return (
        <>
          <span className="h-8 w-8 shrink-0 overflow-hidden rounded-control bg-surface-alt" aria-hidden="true">
            {thumb && (
              // eslint-disable-next-line @next/next/no-img-element -- 32 px catalog thumbnail; the image optimizer is off (WP02), so next/image adds nothing.
              <img
                src={thumb}
                alt=""
                width={32}
                height={32}
                loading="lazy"
                decoding="async"
                className="h-8 w-8 object-contain"
                onError={(event) => {
                  event.currentTarget.style.visibility = "hidden";
                }}
              />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-medium text-ink">{item.name}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-caption text-ink-soft">
              <span className="truncate">{item.set_code ?? item.type ?? ""}</span>
              {stale && <AsOf date={item.recorded_on} variant="inline" className="shrink-0" />}
            </span>
          </span>
          <span className="shrink-0 text-right tabular-nums">
            {fresh ? (
              <>
                <span className="block text-body font-medium text-ink">{formatPrice(item.usd_price)}</span>
                <Delta value={item.ret_30d} period="30D" missingReason="30-day change not available" className="text-caption" />
              </>
            ) : (
              <span className="text-caption text-ink-soft">No current price</span>
            )}
          </span>
        </>
      );
    }
    case "all":
      return <span className="pl-11 text-body font-medium text-action">Show all matches on Prices</span>;
    case "set":
      return (
        <span className="min-w-0 flex-1 pl-11">
          <span className="block truncate text-body font-medium text-ink">{option.name}</span>
          <span className="block truncate text-caption text-ink-soft">
            {[
              option.code,
              `${option.productCount} ${option.productCount === 1 ? "product" : "products"}`,
              option.released ? formatDateOnly(option.released) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      );
    case "page":
      return (
        <span className="min-w-0 flex-1 pl-11">
          <span className="block truncate text-body font-medium text-ink">{option.page.label}</span>
          <span className="block truncate text-caption text-ink-soft">{option.page.description}</span>
        </span>
      );
    case "report":
      return <span className="pl-11 text-body font-medium text-action">Missing a product? Tell us</span>;
  }
}
```

Notes:
- If lint reports `jsx-a11y/click-events-have-key-events` or `jsx-a11y/no-static-element-interactions` on the option `div` (it depends on the rules WP17 enabled), add one `// eslint-disable-next-line <rule> -- keyboard selection is the combobox input's (aria-activedescendant)` directly above the `<div`. Do not add `tabIndex` to options: focus must stay in the input.
- If `formatDateOnly` does not accept a `YYYY-MM-DD` string in the current `format.ts`, use the function WP07 provides for date keys (`grep -n "export function formatDateOnly" -A3 app/lib/format.ts`).
- `useCurrency().formatPrice` already returns `--` for a missing price (WP20's `formatUsdAs`); the `fresh` check above decides first.

### Step 12. `app/components/search/SearchLauncher.tsx` (new, shared bundle): button, shortcuts, dialog

```tsx
"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import Dialog from "../ui/Dialog";
import SearchField, { SearchIcon } from "./SearchField";
import { OPEN_SEARCH_EVENT, isSearchShortcut, loadGlobalSearch, type OpenSearchDetail } from "./searchEvents";

// The panel, the search index and the catalog client are one lazy chunk:
// only this launcher ships with every page (the WP27 shared-JS budget).
const GlobalSearch = lazy(loadGlobalSearch);

function SearchLoading({
  inputRef,
  query,
  onQueryChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  return (
    <div>
      <SearchField inputRef={inputRef} value={query} onValueChange={onQueryChange} />
      <p role="status" className="px-4 py-3 text-caption text-ink-soft">
        Loading search…
      </p>
    </div>
  );
}

/**
 * The header's search button and the site-wide shortcuts: "/" outside text
 * fields, Ctrl-K and Cmd-K anywhere. Also opens on openGlobalSearch()
 * (searchEvents.ts). Mount exactly once (the root layout's Header does).
 */
export default function SearchLauncher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const openSearch = useCallback((initialQuery: string) => {
    void loadGlobalSearch();
    setQuery(initialQuery);
    setOpen(true);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isSearchShortcut(event)) return;
      // Never on top of another dialog (a portfolio modal, the menu sheet, this one).
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      openSearch("");
    }
    function onOpenRequest(event: Event) {
      const detail = (event as CustomEvent<OpenSearchDetail>).detail;
      openSearch(typeof detail?.query === "string" ? detail.query : "");
    }
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpenRequest);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpenRequest);
    };
  }, [openSearch]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const navigate = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router]
  );

  const preload = () => {
    void loadGlobalSearch();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => openSearch("")}
        onPointerEnter={preload}
        onFocus={preload}
        aria-haspopup="dialog"
        aria-keyshortcuts="/ Control+K Meta+K"
        aria-label="Search products, sets and pages"
        className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-2 rounded-control text-ink-soft hover:bg-surface-alt hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action pointer-coarse:min-h-11 pointer-coarse:min-w-11 xl:w-40 xl:justify-start xl:border xl:border-line xl:px-3"
      >
        <SearchIcon className="size-4 shrink-0" />
        <span className="hidden text-body xl:inline">Search</span>
        <kbd className="ml-auto hidden rounded-control border border-line px-1.5 font-sans text-caption text-ink-soft xl:inline">
          /
        </kbd>
      </button>
      {open && (
        <Dialog
          open
          onClose={close}
          title="Search Pokéfin"
          placement="top"
          initialFocusRef={inputRef}
          closeLabel="Close search"
        >
          <Suspense fallback={<SearchLoading inputRef={inputRef} query={query} onQueryChange={setQuery} />}>
            <GlobalSearch query={query} onQueryChange={setQuery} inputRef={inputRef} onNavigate={navigate} />
          </Suspense>
        </Dialog>
      )}
    </>
  );
}
```

The dialog is mounted only while open, so its content never sits in the page's DOM and WP14's cleanup returns focus to whatever had it before opening.

### Step 13. `app/lib/pipelineStatus.ts` (new): data clock rules, pure

```ts
import { parseRecordedAt } from "./format";

/**
 * The header data clock (WP27, research/trust-seo-brand.md §5.1). Derived from
 * the cached catalog summaries: when the newest price was recorded and how
 * many products were priced near it. There is no scrape_runs table yet
 * (01-PRODUCT-DIRECTION.md §10); the collector prices each product about once
 * a day on a 4-hour schedule, so the newest price is normally under 4 h old.
 *
 * DATA_CLOCK_DELAYED_HOURS is mirrored in scripts/prod-smoke-lib.mjs (a test
 * checks the two agree) and printed on /methodology#cadence.
 */
export const DATA_CLOCK_FRESH_HOURS = 12;
export const DATA_CLOCK_DELAYED_HOURS = 30;
export const PIPELINE_WINDOW_HOURS = 48;

const HOUR_MS = 3_600_000;

export interface PipelineStatus {
  /** ISO 8601 UTC ("...Z") of the newest price_recorded_at, or null. */
  newestPricedAt: string | null;
  productsTracked: number;
  /** Products whose newest price is within PIPELINE_WINDOW_HOURS of newestPricedAt. */
  pricedInWindow: number;
}

export const EMPTY_PIPELINE_STATUS: PipelineStatus = {
  newestPricedAt: null,
  productsTracked: 0,
  pricedInWindow: 0,
};

export function derivePipelineStatus(
  products: ReadonlyArray<{ price_recorded_at?: string | null }>
): PipelineStatus {
  const times: number[] = [];
  for (const product of products) {
    // price_recorded_at is timestamp-without-time-zone holding UTC;
    // parseRecordedAt (WP07) reads it as UTC.
    const ms = parseRecordedAt(product.price_recorded_at).getTime();
    if (!Number.isNaN(ms)) times.push(ms);
  }
  if (times.length === 0) {
    return { newestPricedAt: null, productsTracked: products.length, pricedInWindow: 0 };
  }
  const newestMs = Math.max(...times);
  const floorMs = newestMs - PIPELINE_WINDOW_HOURS * HOUR_MS;
  return {
    newestPricedAt: new Date(newestMs).toISOString(),
    productsTracked: products.length,
    pricedInWindow: times.filter((ms) => ms >= floorMs).length,
  };
}

export type DataClockTier = "fresh" | "aging" | "delayed" | "unknown";

/** Boundaries are inclusive: exactly 12 h is fresh, exactly 30 h is aging. */
export function dataClockTier(newestPricedAt: string | null, nowMs: number): DataClockTier {
  if (!newestPricedAt) return "unknown";
  const newestMs = Date.parse(newestPricedAt);
  if (Number.isNaN(newestMs)) return "unknown";
  const ageMs = Math.max(0, nowMs - newestMs);
  if (ageMs <= DATA_CLOCK_FRESH_HOURS * HOUR_MS) return "fresh";
  if (ageMs <= DATA_CLOCK_DELAYED_HOURS * HOUR_MS) return "aging";
  return "delayed";
}

/** Whole hours since the newest price, floored, never negative. */
export function wholeHoursSince(newestPricedAt: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(newestPricedAt)) / HOUR_MS));
}

export interface DataClockCopy {
  text: string;
  tone: "neutral" | "warn";
}

/**
 * `absolute` is formatTimestamp(newest, { withYear: false }) from the server:
 * "Sep 30, 6:10 AM EDT". `hoursAgo` is null in the server render (absolute
 * text only) and a number after mount.
 */
export function dataClockCopy(
  tier: DataClockTier,
  { absolute, hoursAgo }: { absolute: string; hoursAgo: number | null }
): DataClockCopy {
  switch (tier) {
    case "fresh":
      return { text: `Prices as of ${absolute}`, tone: "neutral" };
    case "aging":
      return {
        text: hoursAgo === null ? `Last update ${absolute}` : `Last update ${hoursAgo} h ago`,
        tone: "neutral",
      };
    case "delayed":
      return { text: `Updates delayed since ${absolute}`, tone: "warn" };
    case "unknown":
      return { text: "Price updates unavailable", tone: "warn" };
  }
}

/** The coverage line. Anchored on the newest price, never on the render time. */
export function pipelineDetail(status: PipelineStatus): string {
  if (status.newestPricedAt === null) return "No product has a recorded price.";
  return `${status.pricedInWindow} of ${status.productsTracked} products priced within ${PIPELINE_WINDOW_HOURS} hours of the newest price.`;
}

/** Render time for server components; a module function keeps components lint-pure. */
export function currentTimeMs(): number {
  return Date.now();
}
```

### Step 14. `app/lib/serverMarketData.ts`: `getCachedPipelineStatus()`

Add `import { derivePipelineStatus, EMPTY_PIPELINE_STATUS, type PipelineStatus } from "./pipelineStatus";` with the other `./` imports. At the very end of the file (after WP11's `getCachedProductDetail`, and after WP25's `getCachedFxDaily` if present; append, do not interleave, to keep merges with WP25 and WP26 trivial) add:

```ts
/**
 * The header data clock's input (WP27): the newest price time and how many
 * products were priced within 48 h of it, derived from the cached summaries.
 * A plain function over a cached read, never inside an unstable_cache
 * callback (see the comment above DAILY_BACKSTOP_SECONDS); React cache()
 * dedupes the header and sheet chips within one render. Never throws: the
 * root layout renders it on every page, and a failure must show "Price
 * updates unavailable" instead of breaking the site.
 */
export const getCachedPipelineStatus = cache(async (): Promise<PipelineStatus> => {
  try {
    return derivePipelineStatus(await getCachedMarketProductSummaries());
  } catch (error) {
    logCaughtError("pipeline_status_failed", error);
    return EMPTY_PIPELINE_STATUS;
  }
});
```

`cache` is already imported from `react` (WP11 step 2a) and `logCaughtError` from `./logger`. If `Product` rows lack `price_recorded_at` in the type, the structural parameter type of `derivePipelineStatus` still accepts them (the field is optional).

### Step 15. The chip: `app/components/trust/DataClock.tsx` (client) and `DataStatusChip.tsx` (server)

15a. New `app/components/trust/DataClock.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ClockIcon, WarnIcon } from "../ui/icons";
import { dataClockCopy, dataClockTier, wholeHoursSince } from "../../lib/pipelineStatus";

export const DATA_CLOCK_HREF = "/methodology#cadence";

// A minute clock shared by every mounted chip. The server snapshot is null, so
// hydration renders exactly the server's props (absolute text, server tier);
// right after hydration React re-renders with the browser's minute, and the
// store ticks every 60 s and whenever the tab becomes visible again.
const MINUTE_MS = 60_000;
let minute: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function tick(): void {
  minute = Math.floor(Date.now() / MINUTE_MS);
  listeners.forEach((listener) => listener());
}

function onVisibility(): void {
  if (document.visibilityState === "visible") tick();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    timer = setInterval(tick, MINUTE_MS);
    document.addEventListener("visibilitychange", onVisibility);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

function readMinute(): number {
  if (minute === null) minute = Math.floor(Date.now() / MINUTE_MS);
  return minute;
}

function readServerMinute(): null {
  return null;
}

/** Test-only. */
export function _resetDataClockForTests(): void {
  minute = null;
}

export interface DataClockProps {
  variant: "header" | "sheet";
  newestPricedAt: string | null;
  /** formatTimestamp(newestPricedAt, { withYear: false }), computed on the server. */
  absolute: string;
  /** pipelineDetail(status). */
  detail: string;
  /** Server render time; used until the browser clock takes over. */
  renderedAtMs: number;
}

export default function DataClock({ variant, newestPricedAt, absolute, detail, renderedAtMs }: DataClockProps) {
  const clientMinute = useSyncExternalStore<number | null>(subscribe, readMinute, readServerMinute);
  const mounted = clientMinute !== null;
  const nowMs = mounted ? clientMinute * MINUTE_MS : renderedAtMs;
  const tier = dataClockTier(newestPricedAt, nowMs);
  const { text, tone } = dataClockCopy(tier, {
    absolute,
    hoursAgo: mounted && newestPricedAt ? wholeHoursSince(newestPricedAt, nowMs) : null,
  });
  const Icon = tone === "warn" ? WarnIcon : ClockIcon;
  const toneClass =
    tone === "warn" ? "bg-warn-fill text-warn-text" : "text-ink-soft hover:bg-surface-alt hover:text-ink";

  if (variant === "sheet") {
    return (
      <Link
        href={DATA_CLOCK_HREF}
        prefetch={false}
        data-clock-tier={tier}
        className={`flex min-h-14 items-start gap-2 rounded-control px-3 py-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action ${toneClass}`}
      >
        <Icon className="mt-0.5 size-4 shrink-0" />
        <span>
          <span className="block text-body font-medium">{text}</span>
          <span className="block text-caption">{detail} How often prices update</span>
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={DATA_CLOCK_HREF}
      prefetch={false}
      data-clock-tier={tier}
      data-newest-priced-at={newestPricedAt ?? ""}
      title={`${text}. ${detail}`}
      className={`inline-flex h-9 min-w-9 max-w-full items-center justify-center gap-1.5 rounded-control px-2 text-caption font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action pointer-coarse:min-h-11 pointer-coarse:min-w-11 xl:justify-start ${toneClass}`}
    >
      <Icon className="size-4 shrink-0" />
      {/* Truncates instead of overflowing when the header is tight (1280 px with
          the long "delayed" text); the title and the accessible name keep the
          full sentence. */}
      <span className="sr-only xl:not-sr-only xl:min-w-0 xl:max-w-[17rem] xl:truncate xl:whitespace-nowrap">{text}</span>
    </Link>
  );
}
```

15b. New `app/components/trust/DataStatusChip.tsx` (server component, rendered by `layout.tsx` and passed to the client `Header` as a slot, so the header never fetches):

```tsx
import DataClock from "./DataClock";
import { formatTimestamp } from "../../lib/format";
import { currentTimeMs, pipelineDetail } from "../../lib/pipelineStatus";
import { getCachedPipelineStatus } from "../../lib/serverMarketData";

/**
 * The data clock (WP27, research/trust-seo-brand.md §5.2). Reads the cached
 * pipeline status (tag "market-products", refreshed by the scraper hook), so
 * it never makes a statically rendered route dynamic: no cookies(), no
 * headers(). The HTML carries the absolute time; DataClock upgrades it after
 * mount.
 */
export default async function DataStatusChip({ variant }: { variant: "header" | "sheet" }) {
  const status = await getCachedPipelineStatus();
  const absolute = status.newestPricedAt
    ? formatTimestamp(status.newestPricedAt, { withYear: false, fallback: "" })
    : "";
  return (
    <DataClock
      variant={variant}
      newestPricedAt={status.newestPricedAt}
      absolute={absolute}
      detail={pipelineDetail(status)}
      renderedAtMs={currentTimeMs()}
    />
  );
}
```

WP24's `/methodology#cadence` gains the matching explanation in step 31.

### Step 16. `app/components/brand/PokefinMark.tsx` (new): mark, wordmark, lockup

```tsx
/**
 * Pokéfin's mark (WP27). Interim geometric monogram (research/trust-seo-brand.md
 * §14.1 direction (a), owner decision D6 pending): a rounded tile in the brand
 * accent with a white stepped "P" whose lower edge is a rising three-step
 * line. The same geometry is in app/icon.svg and scripts/brand/make-icons.py;
 * change all three together when the final mark arrives.
 *
 * Server-compatible. Brand red appears only here (uiConventions BRAND_FILES).
 */
export const MARK_TILE_RADIUS = 8;
// Outline plus the square counter; drawn with fill-rule evenodd so the
// counter is a hole.
export const MARK_GLYPH_PATH = "M8 26V6h16v4h-4v4h-4v4h-4v8zM12 10v4h4v-4z";

export function PokefinMark({ className = "h-7 w-7", title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <rect width="32" height="32" rx={MARK_TILE_RADIUS} className="fill-accent" />
      <path d={MARK_GLYPH_PATH} fillRule="evenodd" className="fill-white" />
    </svg>
  );
}

export function PokefinWordmark({ className = "text-xl" }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight text-ink ${className}`}>
      Pok<span className="text-accent">é</span>fin
    </span>
  );
}

export function PokefinLogo({
  markClassName = "h-7 w-7",
  wordmarkClassName = "text-xl",
}: {
  markClassName?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <PokefinMark className={markClassName} />
      <PokefinWordmark className={wordmarkClassName} />
    </span>
  );
}
```

### Step 17. `app/components/nav/HeaderMenu.tsx` (new): disclosure dropdown for Tools and the account

```tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export interface HeaderMenuProps {
  /** id of the panel, referenced by aria-controls. */
  id: string;
  /** Button content (text, or an avatar plus name). */
  label: ReactNode;
  buttonClassName: string;
  align?: "start" | "end";
  /** Panel content; call `close` from every link or button inside it. */
  children: (close: () => void) => ReactNode;
}

/**
 * Disclosure pattern (a button that shows a panel of links), not role="menu":
 * the items are ordinary links. Escape closes and returns focus to the button,
 * a mousedown outside closes, a navigation closes.
 */
export default function HeaderMenu({ id, label, buttonClassName, align = "start", children }: HeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  // Close after a navigation (adjust state during render, no effect).
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      // The button is inside rootRef, so its own mousedown never closes the
      // panel before its click toggles it (the WP03 bug).
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      // A dialog opened on top (search via "/") claims its own Escape.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        className={buttonClassName}
      >
        {label}
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={`size-3.5 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}>
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div
          id={id}
          className={`absolute top-full z-50 mt-2 min-w-60 rounded-card border border-line bg-surface p-1 shadow-lg ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
```

### Step 18. `app/components/nav/HeaderCurrencyToggle.tsx` (new): the one currency choice

```tsx
"use client";

import SegmentedControl, { type SegmentedOption } from "../ui/SegmentedControl";
import { useCurrency } from "../../context/CurrencyContext";
import { isExchangeRateStale } from "../../lib/currency";
import { formatMonthDay, recordedAtDateKey } from "../../lib/format";
import type { Currency } from "../../types/market";

const OPTIONS: readonly SegmentedOption<Currency>[] = [
  { value: "USD", label: "USD", ariaLabel: "US dollars" },
  { value: "CAD", label: "CAD", ariaLabel: "Canadian dollars" },
];

/**
 * "1 USD = 1.3612 CAD, Bank of Canada rate of Sep 29", plus " (stale)" when
 * the rate is more than 4 business days old (WP38's isExchangeRateStale).
 */
export function rateSentence(rate: number, date: string | null, loading: boolean): string {
  if (loading) return "Loading the exchange rate…";
  const key = recordedAtDateKey(date);
  if (!key) return `1 USD = ${rate.toFixed(4)} CAD (fallback rate)`;
  const stale = isExchangeRateStale(date) ? " (stale)" : "";
  return `1 USD = ${rate.toFixed(4)} CAD, Bank of Canada rate of ${formatMonthDay(key)}${stale}`;
}

/**
 * The site-wide display currency (WP20's CurrencyProvider), chosen once in the
 * header. Prices are stored in USD; CAD converts at the rate shown.
 * `showRate` (menu sheet) prints the visible label and the rate line.
 */
export default function HeaderCurrencyToggle({ showRate = false }: { showRate?: boolean }) {
  const { currency, setCurrency, exchangeRate, exchangeRateDate, exchangeRateLoading } = useCurrency();
  const rate = rateSentence(exchangeRate, exchangeRateDate, exchangeRateLoading);
  return (
    <div title={showRate ? undefined : rate}>
      <SegmentedControl
        label="Currency"
        ariaLabel="Display currency"
        hideLabel={!showRate}
        options={OPTIONS}
        value={currency}
        onChange={setCurrency}
        fullWidthOnPhone={false}
      />
      {showRate && <p className="mt-1 text-caption tabular-nums text-ink-soft">{rate}</p>}
    </div>
  );
}
```

If `formatMonthDay` or `recordedAtDateKey` has a different name in `format.ts`, use WP07's equivalents (`grep -n "^export function" app/lib/format.ts`). `format.ts` is already in the shared bundle through `lib/currency.ts`, so this import costs nothing extra.

### Step 19. `app/components/nav/MobileNavSheet.tsx` (new): the phone menu

```tsx
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import Dialog from "../ui/Dialog";
import { buttonClasses } from "../ui/Button";
import HeaderCurrencyToggle from "./HeaderCurrencyToggle";
import { ACCOUNT_NAV, MARKET_HOME, PRIMARY_NAV, TOOLS_NAV, isNavActive, type NavLink } from "./navConfig";

export interface MobileNavSheetProps {
  open: boolean;
  onClose: () => void;
  pathname: string;
  signedIn: boolean;
  /** WP04 step 6: the first session check is still pending; the signed-out links render invisible. */
  authPending: boolean;
  displayName: string;
  email: string | null;
  signInHref: string;
  onSignOut: () => void;
  /** DataStatusChip variant="sheet", rendered by the root layout. */
  dataStatus?: ReactNode;
}

const ROW =
  "flex min-h-11 items-center rounded-control px-3 text-body font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action";

function SheetLink({ link, current, onClose }: { link: NavLink; current: boolean; onClose: () => void }) {
  return (
    <li>
      <Link
        href={link.href}
        prefetch={link.prefetch}
        aria-current={current ? "page" : undefined}
        onClick={onClose}
        className={`${ROW} ${current ? "bg-surface-alt text-ink" : "text-ink-soft hover:bg-surface-alt hover:text-ink"}`}
      >
        {link.label}
      </Link>
    </li>
  );
}

/** Rendered only while open: WP14's modal Dialog placed as a right-hand sheet. */
export default function MobileNavSheet({
  open,
  onClose,
  pathname,
  signedIn,
  authPending,
  displayName,
  email,
  signInHref,
  onSignOut,
  dataStatus,
}: MobileNavSheetProps) {
  if (!open) return null;
  return (
    <Dialog open onClose={onClose} title="Menu" placement="side" closeLabel="Close menu">
      <nav aria-label="Main" className="px-2 py-2">
        <ul className="space-y-0.5">
          <SheetLink link={MARKET_HOME} current={pathname === "/"} onClose={onClose} />
          {PRIMARY_NAV.map((link) => (
            <SheetLink key={link.key} link={link} current={isNavActive(link, pathname)} onClose={onClose} />
          ))}
        </ul>
        <p className="px-3 pb-1 pt-4 text-caption font-semibold uppercase tracking-wide text-ink-soft">Tools</p>
        <ul className="space-y-0.5">
          {TOOLS_NAV.map((link) => (
            <SheetLink key={link.key} link={link} current={isNavActive(link, pathname)} onClose={onClose} />
          ))}
        </ul>
      </nav>
      <div className="border-t border-line px-4 py-3">
        <HeaderCurrencyToggle showRate />
      </div>
      {dataStatus ? <div className="border-t border-line px-2 py-2">{dataStatus}</div> : null}
      <div className="border-t border-line px-4 py-3">
        {signedIn ? (
          <div className="space-y-1">
            <p className="text-body font-medium text-ink">{displayName}</p>
            {email && <p className="truncate text-caption text-ink-soft">{email}</p>}
            <ul className="pt-2">
              <li>
                <Link href={ACCOUNT_NAV.settings.href} prefetch={false} onClick={onClose} className={`${ROW} text-ink-soft hover:bg-surface-alt hover:text-ink`}>
                  {ACCOUNT_NAV.settings.label}
                </Link>
              </li>
              <li>
                <button type="button" onClick={onSignOut} className={`${ROW} w-full text-left text-ink-soft hover:bg-surface-alt hover:text-ink`}>
                  Sign out
                </button>
              </li>
            </ul>
          </div>
        ) : (
          <div
            className={`grid grid-cols-2 gap-3${authPending ? " invisible" : ""}`}
            aria-hidden={authPending ? true : undefined}
          >
            <Link href={signInHref} prefetch={false} onClick={onClose} className={buttonClasses({ variant: "secondary" })}>
              {ACCOUNT_NAV.signIn.label}
            </Link>
            <Link href={ACCOUNT_NAV.signUp.href} prefetch={false} onClick={onClose} className={buttonClasses()}>
              {ACCOUNT_NAV.signUp.label}
            </Link>
          </div>
        )}
      </div>
    </Dialog>
  );
}
```

Menu links in the sheet keep the default prefetch (they are only visible after the user opened the sheet, research §8), except Portfolio (its `prefetch: false` comes from the config) and the account links.

### Step 20. `app/components/Header.tsx`: rewrite

Replace the whole file. WP03's refs and effects and WP04's auth slot are superseded: the menus move into `HeaderMenu` (same Escape and outside-click behaviour, same fix for the X-button bug) and the sheet into `MobileNavSheet`; WP04's rule (signed-out UI while the session is unknown, no skeleton) is kept.

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { loginPathWithNext } from "../lib/redirects";
import { PokefinLogo } from "./brand/PokefinMark";
import { buttonClasses } from "./ui/Button";
import HeaderCurrencyToggle from "./nav/HeaderCurrencyToggle";
import HeaderMenu from "./nav/HeaderMenu";
import MobileNavSheet from "./nav/MobileNavSheet";
import { ACCOUNT_NAV, MARKET_HOME, PRIMARY_NAV, TOOLS_NAV, isNavActive } from "./nav/navConfig";
import SearchLauncher from "./search/SearchLauncher";

export interface HeaderProps {
  /** DataStatusChip variant="header", rendered by app/layout.tsx (server). */
  dataStatus?: ReactNode;
  /** DataStatusChip variant="sheet", for the phone menu. */
  dataStatusSheet?: ReactNode;
}

// No colour transition: colour changes are instant (01-PRODUCT-DIRECTION.md §3.5).
const NAV_ITEM =
  "relative inline-flex h-9 items-center gap-1 rounded-control px-2.5 text-body font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action";

// Active: ink text and a 2 px action-blue bar resting on the header border.
// Brand red is the logo only (01-PRODUCT-DIRECTION.md §3.2).
function navItemClass(active: boolean): string {
  return `${NAV_ITEM} ${
    active
      ? "text-ink after:absolute after:inset-x-2.5 after:-bottom-[14px] after:h-0.5 after:rounded-full after:bg-action"
      : "text-ink-soft hover:bg-surface-alt hover:text-ink"
  }`;
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false" className="size-6">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export default function Header({ dataStatus, dataStatusSheet }: HeaderProps) {
  const { user, profile, loading, sessionStatus, signOut } = useAuth();
  // WP04 step 6 (review F124): no skeleton. While the first session check is
  // pending the signed-out links render invisible (and aria-hidden), so the
  // slot keeps its width and a signed-in user never sees "Sign in" flash.
  const signedIn = sessionStatus === "authenticated" && user !== null;
  const authPending = loading && !signedIn;
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the sheet after any navigation (back button included).
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    if (menuOpen) setMenuOpen(false);
  }

  const displayName = profile?.username || user?.email?.split("@")[0] || "Account";
  const signInHref = loginPathWithNext(pathname);
  const toolsActive = TOOLS_NAV.some((link) => isNavActive(link, pathname));

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    router.push("/");
  };

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6 lg:px-8">
        <Link
          href={MARKET_HOME.href}
          aria-label="Pokéfin, market home"
          aria-current={pathname === "/" ? "page" : undefined}
          className="flex shrink-0 items-center rounded-control focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
        >
          <PokefinLogo />
        </Link>

        <nav aria-label="Main" className="ml-4 hidden shrink-0 items-center gap-0.5 lg:flex">
          {PRIMARY_NAV.map((link) => {
            const active = isNavActive(link, pathname);
            return (
              <Link
                key={link.key}
                href={link.href}
                prefetch={link.prefetch}
                aria-current={active ? "page" : undefined}
                className={navItemClass(active)}
              >
                {link.label}
              </Link>
            );
          })}
          <HeaderMenu id="tools-menu" label="Tools" buttonClassName={navItemClass(toolsActive)}>
            {(close) => (
              <ul>
                {TOOLS_NAV.map((link) => (
                  <li key={link.key}>
                    <Link
                      href={link.href}
                      onClick={close}
                      aria-current={isNavActive(link, pathname) ? "page" : undefined}
                      className="flex flex-col rounded-control px-3 py-2 hover:bg-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
                    >
                      <span className="text-body font-medium text-ink">{link.label}</span>
                      <span className="text-caption text-ink-soft">{link.description}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </HeaderMenu>
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
          {/* The data clock is the FIRST item of the right-hand cluster
              (01-PRODUCT-DIRECTION.md §4.1 puts it on the right). The cluster
              is anchored to the right edge, so when the chip's text changes
              length after hydration only the flexible gap on its left moves
              (no layout shift of search, currency or account). min-w-0 lets
              it truncate instead of overflowing on a tight 1280 px row. */}
          {dataStatus ? <div className="flex min-w-0 justify-end">{dataStatus}</div> : null}
          <SearchLauncher />
          <div className="hidden shrink-0 lg:block">
            <HeaderCurrencyToggle />
          </div>
          {/* Fixed width at lg and up: the signed-out pair and the signed-in
              account button (name capped at 7rem) both fit in 12.5rem, so the
              switch after hydration moves nothing to its left. */}
          <div className="hidden w-[12.5rem] shrink-0 items-center justify-end gap-2 lg:flex">
            {signedIn && user ? (
              <HeaderMenu
                id="account-menu"
                align="end"
                buttonClassName="inline-flex h-9 items-center gap-2 rounded-control px-1.5 text-body font-medium text-ink hover:bg-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
                label={
                  <>
                    <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-surface-alt text-small font-semibold text-ink">
                      {displayName.charAt(0).toUpperCase()}
                    </span>
                    <span className="max-w-[7rem] truncate">{displayName}</span>
                  </>
                }
              >
                {(close) => (
                  <div>
                    <div className="border-b border-line px-3 py-2">
                      <p className="text-body font-medium text-ink">{displayName}</p>
                      <p className="truncate text-caption text-ink-soft">{user.email}</p>
                    </div>
                    <Link
                      href={ACCOUNT_NAV.settings.href}
                      prefetch={false}
                      onClick={close}
                      className="flex min-h-9 items-center rounded-control px-3 text-body text-ink hover:bg-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
                    >
                      {ACCOUNT_NAV.settings.label}
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        void handleSignOut();
                      }}
                      className="flex min-h-9 w-full items-center rounded-control px-3 text-left text-body text-ink hover:bg-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </HeaderMenu>
            ) : (
              <div
                className={`flex items-center gap-2${authPending ? " invisible" : ""}`}
                aria-hidden={authPending ? true : undefined}
              >
                <Link href={signInHref} prefetch={false} className={buttonClasses({ variant: "ghost", size: "sm" })}>
                  {ACCOUNT_NAV.signIn.label}
                </Link>
                <Link href={ACCOUNT_NAV.signUp.href} prefetch={false} className={buttonClasses({ size: "sm" })}>
                  {ACCOUNT_NAV.signUp.label}
                </Link>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-label="Open menu"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-control text-ink hover:bg-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action pointer-coarse:size-11 lg:hidden"
          >
            <MenuIcon />
          </button>
        </div>
      </div>

      <MobileNavSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        pathname={pathname}
        signedIn={signedIn}
        authPending={authPending}
        displayName={displayName}
        email={user?.email ?? null}
        signInHref={signInHref}
        onSignOut={() => void handleSignOut()}
        dataStatus={dataStatusSheet}
      />
    </header>
  );
}
```

Checks after writing it:
- `grep -n "pokeball\|slate-\|#[0-9a-fA-F]\{3,6\}" app/components/Header.tsx` prints nothing.
- If `useAuth()` in the current `AuthContext` does not expose `sessionStatus` (WP04 missing), stop: this package depends on it.
- The sign-in link carries `next` (for example `/auth/login?next=%2Fprices`), so signing in from any page returns there (WP13's `safeReturnToPath` validates it again).

### Step 21. `app/layout.tsx`: the chip slots

Add `import DataStatusChip from "./components/trust/DataStatusChip";` next to the `Header` import, and change `<Header />` to:

```tsx
            <Header
              dataStatus={<DataStatusChip variant="header" />}
              dataStatusSheet={<DataStatusChip variant="sheet" />}
            />
```

Change nothing else in the layout (WP13 metadata and `viewport`, WP20 `CurrencyProvider`, WP22 `SpeedInsightsClient`, WP23 font, WP24 footer stay as they are). Do not read `cookies()` or `headers()` here. After `pnpm build:stub`, the route table must still show `/`, `/prices`, `/market`, `/analytics`, `/auth/login` as static (○) with Revalidate 1d.

### Step 22. Icon set: `app/icon.svg`, the generator, favicon, apple icon, manifest icons

22a. New `frontend/app/icon.svg` (Next emits `<link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any">`; the internal media rule keeps the tab icon legible on dark tab strips):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <style>
    .tile { fill: #dc2626 }
    .glyph { fill: #ffffff }
    @media (prefers-color-scheme: dark) {
      .tile { fill: #f87171 }
      .glyph { fill: #0f172a }
    }
  </style>
  <rect class="tile" width="32" height="32" rx="8"/>
  <path class="glyph" fill-rule="evenodd" d="M8 26V6h16v4h-4v4h-4v4h-4v8zM12 10v4h4v-4z"/>
</svg>
```

22b. New `frontend/scripts/brand/make-icons.py`:

```python
"""Pokéfin icon set from the interim mark (WP27, owner decision D6).

Run once from frontend/:  python3 scripts/brand/make-icons.py
Geometry mirrors app/icon.svg and app/components/brand/PokefinMark.tsx on a
32-unit grid: a rounded tile (radius 8) and the stepped-P glyph with its
square counter. Change all
three together when the owner supplies the final mark, then rerun.

Writes:
  app/favicon.ico                         16, 32 and 48 px frames
  app/apple-icon.png                      180 px, opaque (iOS ignores alpha and rounds corners itself)
  public/brand/pokefin-icon-192.png       rounded tile on transparent
  public/brand/pokefin-icon-512.png       rounded tile on transparent (also Organization.logo)
  public/brand/pokefin-maskable-512.png   full-bleed tile, glyph inside the 80 % safe zone
"""
from pathlib import Path

from PIL import Image, ImageDraw

FRONTEND = Path(__file__).resolve().parents[2]
ACCENT = (220, 38, 38, 255)  # --pf-accent #dc2626
WHITE = (255, 255, 255, 255)
GLYPH = [(8, 26), (8, 6), (24, 6), (24, 10), (20, 10), (20, 14), (16, 14), (16, 18), (12, 18), (12, 26)]
COUNTER = [(12, 10), (16, 10), (16, 14), (12, 14)]  # the P's hole, painted back in tile colour
TILE_RADIUS = 8
SUPERSAMPLE = 8


def render(size, *, full_bleed=False, glyph_scale=1.0):
    big = size * SUPERSAMPLE
    unit = big / 32
    img = Image.new("RGBA", (big, big), ACCENT if full_bleed else (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if not full_bleed:
        draw.rounded_rectangle([0, 0, big - 1, big - 1], radius=TILE_RADIUS * unit, fill=ACCENT)
    # The glyph's bounding box is centred on (16, 16); scale it about that point.
    def scaled(polygon):
        return [((16 + (x - 16) * glyph_scale) * unit, (16 + (y - 16) * glyph_scale) * unit) for x, y in polygon]

    draw.polygon(scaled(GLYPH), fill=WHITE)
    # The counter always sits inside the tile, so the tile colour restores it.
    draw.polygon(scaled(COUNTER), fill=ACCENT)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def main():
    brand = FRONTEND / "public" / "brand"
    brand.mkdir(parents=True, exist_ok=True)
    outputs = []

    favicon = FRONTEND / "app" / "favicon.ico"
    render(48).save(
        favicon,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=[render(16), render(32)],
    )
    outputs.append(favicon)

    apple = FRONTEND / "app" / "apple-icon.png"
    render(180, full_bleed=True, glyph_scale=0.85).convert("RGB").save(apple, optimize=True)
    outputs.append(apple)

    for size in (192, 512):
        path = brand / f"pokefin-icon-{size}.png"
        render(size).save(path, optimize=True)
        outputs.append(path)

    maskable = brand / "pokefin-maskable-512.png"
    render(512, full_bleed=True, glyph_scale=0.7).convert("RGB").save(maskable, optimize=True)
    outputs.append(maskable)

    for path in outputs:
        print(f"{path.relative_to(FRONTEND)}: {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
```

22c. Run it (or with the venv python from "Before you start"):

```bash
cd /home/user/Pokefin/frontend
python3 scripts/brand/make-icons.py
file app/favicon.ico app/apple-icon.png public/brand/*.png
# expect: favicon.ico "MS Windows icon resource - 3 icons" (16x16, 32x32, 48x48);
# apple-icon.png "PNG image data, 180 x 180, 8-bit/color RGB";
# pokefin-icon-192.png 192 x 192 RGBA; pokefin-icon-512.png 512 x 512 RGBA;
# pokefin-maskable-512.png 512 x 512 RGB
ls -l app/favicon.ico      # under 8,192 bytes (was 31,682)
```

If `append_images` is rejected by the installed Pillow, drop that argument (Pillow then downsamples the 48 px frame) and say so in the PR. Open the five files in an image viewer and confirm the glyph is centred, crisp at 16 px, and shows the square counter (a P, not a staircase).

22d. Delete WP13's copy of the old PNG: `git rm app/icon.png` (skip if "Before you start" showed it missing). `app/icon.svg` replaces it; keeping both would emit two icon links, one of them the Poké Ball. `app/apple-icon.png` and `app/favicon.ico` are overwritten in place by 22c. Commit the script and the five generated images.

### Step 23. `app/manifest.ts` (new): installable, no service worker

```ts
import type { MetadataRoute } from "next";
import { PORTFOLIO, PRICES, SCREENER } from "./components/nav/navConfig";
import { SITE_NAME } from "./lib/site";

/**
 * Web app manifest (WP27, research/performance-excellence.md §12 PX09a with
 * the colours of research/trust-seo-brand.md §14.2). Installability only: no
 * service worker and no offline mode in this track (01-PRODUCT-DIRECTION.md
 * §7). theme_color matches viewport.themeColor in layout.tsx (WP13).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Pokéfin: Pokémon sealed product prices",
    short_name: SITE_NAME,
    description:
      "Daily TCGplayer Market Prices, returns and supply for sealed Pokémon TCG products, in CAD and USD.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    theme_color: "#ffffff",
    background_color: "#f8fafc",
    lang: "en-CA",
    categories: ["finance", "shopping"],
    icons: [
      { src: "/brand/pokefin-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/pokefin-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/pokefin-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: PRICES.label, url: PRICES.href, description: PRICES.description },
      { name: PORTFOLIO.label, url: PORTFOLIO.href, description: PORTFOLIO.description },
      { name: SCREENER.label, url: SCREENER.href, description: SCREENER.description },
    ],
  };
}
```

The two hex values are the only new hex literals in a `.ts` file in this PR; step 34 records `manifest.ts: 2` in the ratchet baseline and the PR says why (the manifest format takes literal colours). Do not change `viewport.themeColor`.

### Step 24. `app/components/Footer.tsx` (WP24): Browse column and the new mark

Keep WP24's structure (server component wrapped in `FooterGate`, `LinkColumn`, `LINK_CLASS`, every link `prefetch={false}`, the legal rows and the store link exactly as they are). Change only:

24a. Imports: add

```tsx
import { PokefinMark, PokefinWordmark } from "./brand/PokefinMark";
import { ABOUT_NAV, FOOTER_ACCOUNT, FOOTER_BROWSE, TOOLS_NAV } from "./nav/navConfig";
```

24b. Delete the `EXPLORE_LINKS`, `ACCOUNT_LINKS` and `TRUST_LINKS` arrays and the `PokeballGlyph` function. Add:

```tsx
// Columns come from the nav config (WP27). WP37 appends set links to Browse.
const COLUMNS = [
  { title: "Browse", links: FOOTER_BROWSE },
  { title: "Tools", links: TOOLS_NAV },
  { title: "Account", links: FOOTER_ACCOUNT },
  { title: "Pokéfin", links: ABOUT_NAV },
] as const;
```

24c. The link grid becomes

```tsx
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4 lg:grid-cols-5">
            {COLUMNS.map((column) => (
              <LinkColumn key={column.title} title={column.title} links={column.links} />
            ))}
            <div className="col-span-2 md:col-span-4 lg:col-span-1">
              <div className="mb-2 flex items-center gap-2">
                <PokefinMark className="h-5 w-5" />
                <PokefinWordmark className="text-sm" />
              </div>
              {/* WP24's description paragraph and store link, unchanged */}
            </div>
          </div>
```

replacing the three `LinkColumn`s and the brand block's `PokeballGlyph` plus wordmark `span`. Keep the description `<p>` and the store `<a>` WP24 wrote, verbatim.

24d. The WP24 conventions rule `TRUST_FILES` (server-only, token-only) still covers `components/Footer.tsx`; `PokefinMark.tsx` is server-compatible, so the footer stays a server component.

### Step 25. No Poké Ball anywhere: promo, sign-in pages, JSON-LD logo

25a. `app/components/CardRinkPromo.tsx` (WP15, WP24 version). WP15 step 3b already replaced the glyph with the store's name as text, so there is nothing to delete: confirm with `grep -c "PokeballGlyph" app/components/CardRinkPromo.tsx` (prints 0; if it prints more, delete the function and its uses, and nothing replaces them). Do not add the Pokéfin mark either: the store's name and WP24's relationship label carry the block, and brand red never goes on the promo (01-PRODUCT-DIRECTION.md §3.2). WP24 left the promo's CTA styling to this package: on the store `<Link>`, replace the class list (`inline-flex items-center bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white px-8 py-3 rounded-lg font-semibold transition-colors shadow-sm`, or whatever red classes WP15 and WP24 left) with `className={buttonClasses({ variant: "secondary" })}` and add `import { buttonClasses } from "./ui/Button";`. A neutral secondary button keeps the promo from competing with the page's one primary action. Keep its `href`, `target`, `rel={DISCLOSURE.storeLinkRel}` and text. Change nothing else.

25b. The four sign-in pages. Find them with `grep -rln "function PokeballGlyph" app/auth` (expect `app/auth/login/LoginForm.tsx`, `app/auth/signup/page.tsx`, `app/auth/forgot-password/page.tsx`, `app/auth/reset-password/page.tsx`; WP13 may have split the signup page into a form file too; use whatever the grep lists). In each: delete the local `PokeballGlyph` function, add `import { PokefinMark } from "<relative path>/components/brand/PokefinMark";`, and replace every `<PokeballGlyph className="..." />` with `<PokefinMark className="h-10 w-10" />`. Do not repaint their red submit buttons (not this package's pages; the brand-red ratchet keeps them from growing).

25c. `app/lib/jsonLd.ts` (WP24): in `organizationNode()`, after `url: absoluteUrl("/"),` add

```ts
    // Pokéfin's own mark (WP27); WP24 held this back while the logo was a Poké Ball.
    logo: absoluteUrl("/brand/pokefin-icon-512.png"),
```

If a WP24 test compares the organization node with `toEqual`, add the `logo` field to its expected object.

25d. Confirm:

```bash
grep -rnE "PokeballGlyph|PokeballMark|pf-pokeball-top|A15 15 0 0 1 31 16" app public | grep -v __tests__
# expect no output
```

### Step 26. Currency: remove the page toggles the header now covers

26a. `app/components/ProductPrices/controls/CurrencySelector.tsx` (WP23 version): add an optional `label?: string;` to `CurrencySelectorProps`, destructure it as `label = "Currency"`, and pass `label={label}` to `SegmentedControl` instead of the literal `"Currency"`. The component stays; only the box calculator uses it after this step.

26b. `app/components/ProductPrices/controls/ControlBar.tsx`: delete `selectedCurrency`, `exchangeRate`, `exchangeRateLoading` and `onCurrencyChange` from `ControlBarProps` and from the destructured props, delete the `import CurrencySelector from "./CurrencySelector";` line, and delete the whole block that renders it (the `<div className="md:ml-auto">` wrapping `<CurrencySelector ... />`). Remove `Currency` from the `../types` (or `../../../types/market`) import if nothing else in the file uses it. `pnpm exec tsc --noEmit` now lists the two callers.

26c. `app/components/MarketView/MarketView.tsx`: in the `<ControlBar ... />` call delete the four props `selectedCurrency=`, `exchangeRate=`, `exchangeRateLoading=` and `onCurrencyChange=`. In WP20's `useCurrency()` destructure, delete the names that are now unused (`setCurrency: setSelectedCurrency` and `exchangeRateLoading` normally; `pnpm exec eslint app/components/MarketView/MarketView.tsx` reports them). Keep `selectedCurrency`, `exchangeRate`, `convertPrice` and `formatPrice`: the rows still use them, and they now follow the header.

26d. `app/portfolio/page.tsx`: delete the `{/* Currency: the site-wide preference ... */}` block that renders `<CurrencySelector ... />` and the `CurrencySelector` import. Delete the page's `useCurrency()` line and import if nothing else in the page reads them (`PortfolioDashboard` reads the context itself since WP20). If the removed block was the only child of a flex row, keep the row and its heading as they are.

### Step 27. `/prices`: currency from the header, legacy `?currency=` honoured once

27a. `app/components/ProductPrices/utils/urlState.ts` (WP08):
- Remove `currency` from `PricesUrlState`, from `PRICES_URL_DEFAULTS`, from `PRICES_URL_KEYS` and from `parsePricesQuery`. Delete the local `CURRENCIES` constant and the `Currency` type import if they become unused.
- Append:

```ts
/**
 * The query key /prices used for the display currency before WP27 moved the
 * choice to the header. Old links and bookmarks still carry it.
 */
export const LEGACY_CURRENCY_KEY = "currency";

/** "USD" or "CAD" from a legacy ?currency= value, else null. */
export function legacyCurrencyParam(search: string): Currency | null {
  const value = new URLSearchParams(search).get(LEGACY_CURRENCY_KEY);
  return value === "USD" || value === "CAD" ? value : null;
}
```

(keep or re-add `import type { Currency } ...` for this function).

27b. New `app/components/ProductPrices/hooks/useLegacyCurrencyParam.ts`:

```ts
"use client";

import { useEffect } from "react";
import { useCurrency } from "../../../context/CurrencyContext";
import { replaceOwnedSearchParams } from "../../../lib/locationSearch";
import { LEGACY_CURRENCY_KEY, legacyCurrencyParam } from "../utils/urlState";

/**
 * A /prices link made before WP27 carries ?currency=USD|CAD. The header now
 * owns the display currency, so the link sets the site-wide choice once and
 * the key leaves the address bar (no navigation, WP08's replace helper).
 * Runs after hydration, when the location store reports the real query, and
 * again on later soft navigations to such a link.
 */
export function useLegacyCurrencyParam(locationSearch: string): void {
  const { setCurrency } = useCurrency();
  useEffect(() => {
    const legacy = legacyCurrencyParam(locationSearch);
    if (legacy === null) return;
    setCurrency(legacy);
    replaceOwnedSearchParams("", [LEGACY_CURRENCY_KEY]);
  }, [locationSearch, setCurrency]);
}
```

If `replaceOwnedSearchParams` in the current `locationSearch.ts` takes its arguments in another order, follow its signature (WP08 defines `(ownedQuery, ownedKeys)`).

27c. `app/components/ProductPrices/index.tsx`:
- Replace the `useCurrencyConversion(initialUrlState.currency)` destructure (and WP20's `const { setCurrency: rememberCurrency } = useCurrency();` line below it) with:

```ts
  // The header owns the display currency (WP27); this page follows it.
  const { currency: selectedCurrency, exchangeRate, formatPrice } = useCurrency();
  useLegacyCurrencyParam(locationSearch);
```

  and import `useLegacyCurrencyParam` from `./hooks/useLegacyCurrencyParam`. Keep the `useCurrency` import; remove the `useCurrencyConversion` import.
- Remove `currency: selectedCurrency,` from the `urlState` object literal, `setSelectedCurrency(fromUrl.currency);` from the URL-to-state block, and `if (patch.currency !== undefined) setSelectedCurrency(patch.currency);` from `updateUrlState`.
- Remove the `selectedCurrency`, `exchangeRate`, `exchangeRateLoading` and `onCurrencyChange` props from the `<ControlBar ... />` call (WP20's `rememberCurrency` handler goes with it).
- Keep passing `selectedCurrency`, `exchangeRate` and `formatPrice` to the cards exactly as before.
- Do not write the word that WP08 bans from this file (its precheck greps `index.tsx` for the search-params hook name), not even in a comment.

### Step 28. Box calculator and the home "Recently Released" strip

28a. `app/components/BoxCalculator/BoxCalculator.tsx`: on the `<CurrencySelector` call add `label="Recipe currency"`, and replace WP20's handler

```tsx
        onChange={(currency) => {
          setSelectedCurrency(currency);
          rememberCurrency(currency);
        }}
```

with `onChange={setSelectedCurrency}`. Delete `const { setCurrency: rememberCurrency } = useCurrency();` and the `useCurrency` import if nothing else uses them. The page keeps `useCurrencyConversion()` with no argument: it follows the header until the user picks a recipe currency or loads a recipe, and a recipe currency no longer changes the site-wide choice.

28b. `app/components/dashboard/RecentlyReleased.tsx`: `useCurrencyConversion("USD")` becomes `useCurrencyConversion()`, so the home page follows the header like every other page. WP32 rebuilds this strip later.

28c. Confirm:

```bash
grep -rln "<CurrencySelector" app --include=*.tsx | grep -v __tests__
# expect exactly: app/components/BoxCalculator/BoxCalculator.tsx
grep -rn "rememberCurrency\|onCurrencyChange" app --include=*.ts --include=*.tsx | grep -v __tests__
# expect no output
```

### Step 29. Sign-in copy: `app/lib/loginCopy.ts` (new) and `LoginForm.tsx`

29a. New `app/lib/loginCopy.ts`:

```ts
import { loginPathWithNext, safeReturnToPath } from "./redirects";

/**
 * The sign-in subtitle, chosen from the validated return path (WP27), so a
 * visitor sent to sign in knows why. WP34 and WP35 build their signed-out
 * watch and alert links with watchLoginPath().
 */
export const DEFAULT_LOGIN_SUBTITLE = "Sign in to your Pokéfin account.";
export const PORTFOLIO_LOGIN_SUBTITLE = "Sign in to track your collection's value.";
export const WATCH_LOGIN_SUBTITLE = "Sign in to watch products and get daily alerts.";

export const WATCH_INTENT_PARAM = "intent";
export const WATCH_INTENT_VALUE = "watch";

function underPath(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function loginSubtitleFor(next: string | null | undefined): string {
  const target = safeReturnToPath(next);
  if (target === "/") return DEFAULT_LOGIN_SUBTITLE;
  let url: URL;
  try {
    url = new URL(target, "https://login-copy.invalid");
  } catch {
    return DEFAULT_LOGIN_SUBTITLE;
  }
  const path = url.pathname.toLowerCase();
  if (
    url.searchParams.get(WATCH_INTENT_PARAM) === WATCH_INTENT_VALUE ||
    underPath(path, "/portfolio/watchlist")
  ) {
    return WATCH_LOGIN_SUBTITLE;
  }
  if (underPath(path, "/portfolio")) return PORTFOLIO_LOGIN_SUBTITLE;
  return DEFAULT_LOGIN_SUBTITLE;
}

/** Sign-in link for a "Watch" action on `returnTo` (for example "/product/42"). */
export function watchLoginPath(returnTo: string): string {
  const separator = returnTo.includes("?") ? "&" : "?";
  return loginPathWithNext(`${returnTo}${separator}${WATCH_INTENT_PARAM}=${WATCH_INTENT_VALUE}`);
}
```

29b. `app/auth/login/LoginForm.tsx` (WP13): add `import { DEFAULT_LOGIN_SUBTITLE, loginSubtitleFor } from "../../lib/loginCopy";` and, next to WP13's `NextPathField` and `AuthLinkNotice`, add a third reader:

```tsx
/** Why the visitor is asked to sign in, from the validated `next` (WP27). */
function LoginSubtitle() {
  const searchParams = useSearchParams();
  return <>{loginSubtitleFor(searchParams.get("next"))}</>;
}
```

Then replace the subtitle's text `Sign in to your Pokéfin account.` inside its `<p>` (under the "Welcome back" `h1`) with

```tsx
              <Suspense fallback={DEFAULT_LOGIN_SUBTITLE}>
                <LoginSubtitle />
              </Suspense>
```

and add `min-h-10` to that `<p>`'s class list (two lines reserved, so the client swap cannot shift the form). Keep every other class the `<p>` has. The static HTML keeps the default sentence and the form, exactly as WP13 requires.

### Step 30. Page titles that match the nav

- `app/market/page.tsx`: `metadata.title` `"Market View"` becomes `"Screener"`, and the `h1` text `Market View` becomes `Screener` (whatever element WP23 or a later package made the title, change only its text).
- `app/stats/page.tsx` (rendered at `/analytics`): `metadata.title` `"Set Analytics"` becomes `"Sets"` and the `h1` text becomes `Sets`. If `app/analytics/page.tsx` exports its own `metadata` (WP13), change its title too.
- `app/components/NotFoundPanel.tsx` (WP13): link labels `Market View` and `Set Analytics`, if present, become `Screener` and `Sets`.
- Then `grep -rn "Market View\|Set Analytics\|Seller Tools\|Box Calculator" app --include=*.tsx | grep -v __tests__` and change any remaining navigation label or page title to the new names (`Screener`, `Sets`, `Seller margin check`, `Box NAV calculator`). Leave prose on `/methodology` that names the old views as it is (WP33 and WP37 revise those sections), and list what you left in the PR.
- Update tests that assert the old titles or labels (`grep -rn "Market View\|Set Analytics" app --include=*.test.*`).

### Step 31. `/methodology#cadence`: explain the clock

`app/methodology/MethodologyArticle.tsx` (WP24): import `DATA_CLOCK_DELAYED_HOURS` from `../lib/pipelineStatus` and add a second paragraph inside `<Section id="cadence">`, after the existing one (and after WP25's appended sentence if present):

```tsx
            <p>
              The clock at the top of every page shows when the newest price was recorded. It turns amber
              when no product has been priced for more than {DATA_CLOCK_DELAYED_HOURS} hours, which usually
              means the collector is offline. Prices stay visible until they are{" "}
              {PRICE_STALENESS_TOLERANCE_DAYS} days old (see <a className={LINK} href="#freshness">When we hide a price</a>).
            </p>
```

`PRICE_STALENESS_TOLERANCE_DAYS` and `LINK` are already in that file (WP24 uses them in `#freshness` and the tables); if `LINK` has another name there, use it. `METHODOLOGY_VERSION` does not change and no change-log row is added: the clock is a status indicator for the collector, it changes how no published number is computed, withheld or flagged, so it is none of the formula, window, threshold, weight or gate changes the versioning rule in `app/content/methodology.ts` covers. (Practical reason too: WP25, which runs in parallel, replaces `METHODOLOGY_CHANGES` wholesale, so a WP27 row would be lost in the merge.)

### Step 32. Production smoke: fail when the clock would be amber

WP22's daily smoke test gets one check, so the owner receives the `prod-smoke` issue within a day of the collector stopping, not after 14 days of blank prices.

32a. `scripts/prod-smoke-lib.mjs`: append

```js
// Mirrors DATA_CLOCK_DELAYED_HOURS in app/lib/pipelineStatus.ts (WP27); a
// jest test keeps the two equal. The header chip turns amber past this age.
export const DATA_CLOCK_DELAYED_HOURS = 30;
const NEWEST_PRICED_AT_RE = /data-newest-priced-at="([^"]*)"/;

/** Judge the header data clock in the / HTML (WP27). */
export function judgeDataClock(html, nowMs) {
  const raw = NEWEST_PRICED_AT_RE.exec(html ?? "")?.[1];
  if (raw === undefined) return { name: "Data clock", ok: false, detail: "no data clock in the / HTML" };
  const newestMs = Date.parse(raw);
  if (raw === "" || Number.isNaN(newestMs)) {
    return { name: "Data clock", ok: false, detail: "no product has a recorded price" };
  }
  const ageMs = nowMs - newestMs;
  const hours = Math.floor(ageMs / 3_600_000);
  return ageMs <= DATA_CLOCK_DELAYED_HOURS * 3_600_000
    ? { name: "Data clock", ok: true, detail: `newest price ${hours} h old (${raw})` }
    : {
        name: "Data clock",
        ok: false,
        detail: `no product priced for ${hours} h (newest ${raw}): the collector is probably offline`,
      };
}
```

32b. `scripts/prod-smoke.mjs`, in `runChecks()`, directly after the `/sitemap.xml` check is pushed:

```js
    result.checks.push(
      await withRetry("Data clock", async () =>
        lib.judgeDataClock(await (await context.request.get(`${ORIGIN}/`)).text(), Date.now())
      )
    );
```

The `/` HTML is ISR: it is regenerated after each scrape (tag revalidation), so a stale `data-newest-priced-at` there means no scrape has written prices since. WP11 revalidates with the `"max"` profile (stale while revalidate), so the first request after a scrape can still receive the previous render; `withRetry` waits 30 s and asks again, which then gets the regenerated page, so a quiet night cannot raise a false alarm unless the previous render itself is over 30 h old. In `renderSummary`'s "Likely causes" sentence, add "the collector stopped (data clock older than 30 h)," before "an RPC failing".

### Step 33. Docs

- `app/components/ui/README.md` (WP23): in the `Dialog` row add "`placement`: `center` (default), `top` (search palette, full screen on phones), `side` (phone menu sheet)". Add a line under Rules: "Navigation labels and links come from `app/components/nav/navConfig.ts`; never hard-code a nav href."
- `.github/copilot-instructions.md` (WP20; skip if absent): in "Shared modules", add "`app/components/nav/navConfig.ts` (every nav label, href and active rule), `app/lib/productSearch.ts` (the one product matcher), `app/components/search/searchEvents.ts` (`openGlobalSearch()`, `SearchTrigger`)".
- `frontend/README.md`: under the WP22 performance section add one sentence: "The global search panel is a lazy chunk; `/api/public/catalog` is fetched only when the dialog first opens. Never import `components/search/GlobalSearch` statically (the conventions test enforces it)."

### Step 34. `app/__tests__/uiConventions.test.ts`: brand files, token-only nav, no Poké Ball

34a. In WP23's block, extend `BRAND_FILES`:

```ts
const BRAND_FILES = ["components/Header.tsx", "components/Footer.tsx", "components/brand/PokefinMark.tsx"];
```

34b. Append after WP24's block:

```ts
// ---------------------------------------------------------------------------
// WP27 navigation, search, data clock and mark.
// ---------------------------------------------------------------------------
const WP27_TOKEN_ONLY = [
  "components/Header.tsx",
  "components/brand/PokefinMark.tsx",
  "components/nav/HeaderMenu.tsx",
  "components/nav/HeaderCurrencyToggle.tsx",
  "components/nav/MobileNavSheet.tsx",
  "components/search/SearchLauncher.tsx",
  "components/search/SearchField.tsx",
  "components/search/SearchTrigger.tsx",
  "components/search/GlobalSearch.tsx",
  "components/trust/DataClock.tsx",
  "components/trust/DataStatusChip.tsx",
];

describe("navigation, search and brand (WP27)", () => {
  it("draws no Poké Ball anywhere", () => {
    expect(violations(/PokeballGlyph|PokeballMark|pf-pokeball-top|A15 15 0 0 1 31 16/g)).toEqual([]);
  });

  it("keeps the header, search and data clock token-only", () => {
    for (const file of WP27_TOKEN_ONLY) {
      const source = SOURCES.find((s) => s.file === file);
      expect(source).toBeDefined();
      const found = [RAW_PALETTE_RE, HEX_RE, BRAND_RED_RE].flatMap((re) =>
        [...source!.text.matchAll(re)].map((m) => `${file}: ${m[0]}`)
      );
      expect(found).toEqual([]);
    }
  });

  it("imports the search panel only lazily", () => {
    const staticImports = SOURCES.filter((s) =>
      /import\s[^;]*from\s+["'][^"']*search\/GlobalSearch["']|import\s[^;]*from\s+["']\.\/GlobalSearch["']/.test(s.text)
    ).map((s) => s.file);
    expect(staticImports).toEqual([]);
  });

  it("keeps colour instant and focus visible in forced colours", () => {
    // 01-PRODUCT-DIRECTION.md §3.5; Tailwind 4's outline-none also hides the
    // outline in forced-colours mode, so focus uses outline-hidden plus a ring.
    for (const file of WP27_TOKEN_ONLY) {
      const source = SOURCES.find((s) => s.file === file);
      const found = [...source!.text.matchAll(/\btransition-(?:colors|all)\b|\boutline-none\b/g)].map(
        (m) => `${file}: ${m[0]}`
      );
      expect(found).toEqual([]);
    }
  });

  it("hard-codes no primary nav href outside the nav config", () => {
    const navFiles = ["components/Header.tsx", "components/nav/MobileNavSheet.tsx", "components/Footer.tsx"];
    const found = SOURCES.filter((s) => navFiles.includes(s.file)).flatMap((s) =>
      [...s.text.matchAll(/href="\/(?:prices|market|analytics|portfolio|box-calculator|compare)"/g)].map(
        (m) => `${s.file}: ${m[0]}`
      )
    );
    expect(found).toEqual([]);
  });
});
```

Do not write any of the matched strings in a comment under `app/` (the scan reads comments): that includes the two class names the fifth rule bans, so a comment says "colour transition", never the utility name. `searchEvents.ts` uses `import("./GlobalSearch")`, a dynamic import, which the third rule does not match.

34c. Refresh the ratchet baseline (the hex and brand-red counts of `Header.tsx`, `Footer.tsx`, `CardRinkPromo.tsx` and the four sign-in files went down):

```bash
cd /home/user/Pokefin/frontend
pnpm exec jest app/__tests__/uiConventions.test.ts          # may fail only with "< baseline; lower the baseline" and "manifest.ts: 2 > baseline 0"
UPDATE_UI_BASELINE=1 pnpm exec jest app/__tests__/uiConventions.test.ts
git diff app/__tests__/uiConventions.baseline.json
# every changed count goes DOWN, and the only new entry is "manifest.ts": 2 under "hex"
pnpm exec jest app/__tests__/uiConventions.test.ts          # passes without the variable
```

If any other count went up, fix the file that raised it; never commit that raise. The PR states the one allowed raise: "hex ratchet: manifest.ts 2, the Web App Manifest needs literal theme and background colours".

### Step 35. Measure against the budgets (WP22)

```bash
cd /home/user/Pokefin/frontend
SUPABASE_STUB_FIXTURE=perf pnpm build:stub
node scripts/perf-serve.mjs &            # note the PID
pnpm perf:budget | tee /tmp/wp27-budget-after.txt
curl -s http://127.0.0.1:3100/api/public/catalog -o /tmp/wp27-catalog.json
node -e 'const fs=require("fs"),z=require("zlib");const b=fs.readFileSync("/tmp/wp27-catalog.json");console.log("raw",b.length,"br",z.brotliCompressSync(b,{params:{[z.constants.BROTLI_PARAM_QUALITY]:11}}).length)'
kill <PID>
```

Compare `Shared JS (gz)` in the two files: the increase must be 6.0 kB or less. If it is more, first make `MobileNavSheet` lazy (`const MobileNavSheet = lazy(() => import("./nav/MobileNavSheet"))` in `Header.tsx`, rendered inside `<Suspense fallback={null}>` only while open, with `void import("./nav/MobileNavSheet")` on the menu button's `onPointerDown`), rebuild and measure again; that moves `Dialog` out of the shared chunk. If shared JS then exceeds its CI `limit` while staying within the 6.0 kB allowance, raise the limit with `pnpm perf:budget --write-limits` and put `Perf budget raise: shared.jsGzKb header nav, search launcher and data clock (WP27), +<n> kB, within the 6 kB allowance of the WP27 spec` in the PR body. Every other route limit must hold without a raise.

## Pitfalls: do not do this

- **Do not fetch the catalog before the dialog opens.** Not on mount, not on hover, not on idle. Hover and focus preload only the panel code (`loadGlobalSearch`). The acceptance criteria and a test check it.
- **Do not import `GlobalSearch` statically anywhere.** One static import puts the panel, the search index, `marketPulse` and `Delta` into the shared bundle on every page and breaks the 6 kB allowance. Only `searchEvents.ts` imports it, with `import()`.
- **Do not render relative time ("18 h ago") in server HTML.** ISR pages can be a day old. The server prints the absolute time; `DataClock` switches to relative hours only after mount, via `useSyncExternalStore` with a `null` server snapshot, so hydration never mismatches.
- **Do not call `Date.now()` or `new Date()` inside a component body.** The React Compiler lint rules (blocking since WP17) flag impure calls during render. Use `currentTimeMs()` in the server chip and the minute store in `DataClock`.
- **Do not read `cookies()` or `headers()` in the layout or the chip.** It would make every page dynamic. The chip reads a tagged cache only.
- **Do not call `getCachedMarketProductSummaries` from inside another `unstable_cache` callback** (WP11: Next skips the inner cache). `getCachedPipelineStatus` is a React `cache()` over a plain async function, which is allowed.
- **Do not let the chip break a page.** `getCachedPipelineStatus` must catch and return `EMPTY_PIPELINE_STATUS`; the root layout renders it on every route, including error pages.
- **Do not put the chip after the search button, the currency toggle or the account slot.** Its text changes length after hydration; anything to its left in the right-anchored cluster would move (layout shift). It is the first item of the right-hand cluster, and the only one allowed to shrink (`min-w-0`).
- **Do not use `role="menu"` for Tools or the account.** They are disclosure panels of links; `role="menu"` promises arrow-key menu behaviour the component does not have.
- **Do not colour anything but the mark tile and the wordmark "é" brand red.** The active nav bar, the selected currency segment, buttons and focus rings are action blue. The promo gets no mark and a neutral secondary button.
- **Do not add a service worker, offline page or push.** Out of scope (01-PRODUCT-DIRECTION.md §7). The manifest is for installability only. Do not change `theme_color` or `viewport.themeColor` from `#ffffff`.
- **Do not make the catalog route read its request** (params, headers, search params). It must stay `force-static` ISR; any request read turns it into a per-request function. Do not set `Cache-Control` by hand on it (research/performance-excellence.md §7.3: it would bypass tag invalidation).
- **Do not publish a withheld price.** The route writes `usd_price` and `ret_30d` only when `hasCurrentPrice` is true, and the panel re-checks `isPriceFresh(recorded_on)` at display time.
- **Do not remove `CurrencySelector.tsx`.** The box calculator keeps it as "Recipe currency".
- **Do not call the currency setter during render.** The legacy `?currency=` adoption runs in an effect (`useLegacyCurrencyParam`), after hydration.
- **Do not write the search-params hook name in `ProductPrices/index.tsx`,** not even in a comment (WP08's precheck greps for it).
- **Do not open search from "/" while the user is typing** in an input, textarea, select or contenteditable, or while another dialog is open. Ctrl-K and Cmd-K may open it from a text field (that is their convention), but never on top of a dialog.
- **Do not animate the sheet or the palette with JavaScript,** and do not add enter animations that delay the first paint of the dialog (INP 100 ms).
- **Do not keep `app/icon.png`.** Next would emit it next to `icon.svg`, and it is the old Poké Ball.
- **Do not raise any count in `uiConventions.baseline.json` except `manifest.ts: 2`,** and do not raise a perf limit without the `Perf budget raise:` line.
- **Do not write "live", "real-time", "all-time", "TCGPlayer" or an em dash** in any file under `app/`, comments included (WP24's conventions test reads comments).
- **Do not rename routes.** `/market` and `/analytics` keep their URLs; WP33 and WP37 own the moves to `/screener` and `/sets` and change `navConfig.ts`.

## Tests

All paths relative to `frontend/`. Component tests use jsdom (the default) and WP23's `test-utils/axe.ts` where noted; `node` tests carry `/** @jest-environment node */`. Where a test needs the router, mock `next/navigation` as WP03's `Header.test.tsx` does (`useRouter` with `push`, `replace`, `prefetch`, `refresh`, `back`, `forward` as `jest.fn()`, `usePathname` returning a variable the test sets). Use WP03's `next/link` mock, changed to expose prefetch: render `data-prefetch={prefetch === undefined ? "default" : String(prefetch)}` on the anchor.

### 1. `app/lib/__tests__/productSearch.test.ts` (new, node)

Fields `{ setName: "Prismatic Evolutions", setCode: "SV8.5", typeLabel: "Elite Trainer Box", typeName: "elite_trainer_box", variant: "Pokémon Center" }`.
- `foldForSearch("Pokémon")` is `"pokemon"`; `searchTokens("  151  ETB ")` is `[["151"], ["etb", "elite trainer box"]]`; seven words give 6 tokens.
- `matchesProductSearch(fields, "")` and `"   "` are true.
- Parity with the pre-WP27 `/prices` predicate for one-word queries: for each of `"prism"`, `"sv8"`, `"elite"`, `"trainer"`, `"elite_trainer"`, `"center"`, `"xyz"`, compare with a local copy of the old predicate (lowercase substring on the five fields) and expect equal results.
- New behaviour: `"pokemon"` is true (accent folding), `"evolutions etb"` is true, `"prismatic bb"` is false, `"151 etb"` is false.

### 2. `app/components/ProductPrices/__tests__/filtering.search.test.ts` (new, node)

`filterProducts` over three products (an ETB, a booster box, a variant "Pokémon Center" ETB): `searchTerm "etb"` returns the two ETBs; `"center"` and `"pokemon"` return the variant; `""` returns all three; the generation and type filters still combine with the search.

### 3. `app/components/search/__tests__/searchIndex.test.ts` (new, node)

A payload of 8 items across 3 sets (one set code `"SV8.5"`, two sets sharing the word "Evolutions", one withheld item with `usd_price: null`).
- Empty query: one group "Go to" with exactly the five suggestion pages in `SEARCH_SUGGESTION_KEYS` order; counts `{ products: 0, sets: 0, pages: 5 }`.
- `"prism"`: products first, ordered by score then newer release; an `all` option with href `/prices?q=prism` ends the products group; a set option for "Prismatic Evolutions" with `productCount` and href `setSearchHref("Prismatic Evolutions")`.
- `"sv8.5"`: every SV8.5 product outranks a product that only matches by name.
- With equal scores, the product from the newer set comes first; a withheld product ranks after a priced one of the same score.
- `"methodology"`: a page option with href `/methodology`.
- 20 matching items give 8 product options plus `all`.
- `"zzzz"` with an index: groups are `[report]` only; the option's href equals `buildContactHref({ topic: "missing_product", query: "zzzz" })`.
- Index `null` (loading) with `"zzzz"`: no report group; with `"prices"`: the Prices page still matches.

### 4. `app/api/public/catalog/__tests__/route.test.ts` (new, node)

Mock `server-only` (`jest.mock("server-only", () => ({}))`), `../../../../lib/serverMarketData` (`getCachedMarketProductSummaries: jest.fn()`) and `../../../../lib/logger`.
- `dynamic === "force-static"` and `revalidate === 86400` (import the route module).
- Three products: a priced one with `image_url` `https://abc.supabase.co/storage/v1/object/public/product-images/products/42.jpg`, `returns["1M"]` 4.237, `usd_price` 95.123; a withheld one (`usd_price: null`, `price_recorded_at` 20 days ago, `returns` with numbers that must not leak); one without an image. Expect: `v` 1, `img_base` `https://abc.supabase.co/storage/v1/object/public/`, item 42 `img` `product-images/products/42.jpg`, `usd_price` 95.12, `ret_30d` 4.2, `recorded_on` the date key; the withheld item `usd_price` null and `ret_30d` null with `recorded_on` kept; items sorted by id; `as_of` the newest priced `recorded_on`; `name` equals `getProductDisplayName` of the product.
- The response has status 200, JSON content type and an `x-pokefin-generated-at` header.
- When `getCachedMarketProductSummaries` rejects, `GET()` rejects and `logCaughtError` was called with `"public_catalog_failed"`.

### 5. `app/api/public/catalog/__tests__/catalogSize.test.ts` (new, node)

Build 306 synthetic products with a seeded generator (set names of 1 to 3 words, 55 sets, codes like `SV08`, labels from 12 production-style types, 15 % variants, 10 % without an image, prices $5 to $2,000), `buildCatalogPayload(products, new Date("2026-09-30T10:00:00Z"))`, `JSON.stringify` it: raw length at most 96 × 1024 bytes, `zlib.brotliCompressSync` (quality 11) at most 16 × 1024 bytes, and `isCatalogPayload` of the parsed JSON is true.

### 6. `app/lib/__tests__/catalogPayload.test.ts` (new, node)

`isCatalogPayload` rejects `v: 2`, a missing `items`, an item with `id: "42"`, an item with `usd_price: NaN`; accepts an empty `items` array. `catalogImageUrl`: relative path joins `img_base`; a full `https://` URL is returned as is; `img: null` and a relative path with `img_base: null` give null.

### 7. `app/lib/__tests__/publicCatalog.test.ts` (new, jsdom)

`global.fetch = jest.fn()` resolving a valid payload; `_resetPublicCatalogForTests()` in `beforeEach`.
- `peekPublicCatalog()` is null before any load.
- Two concurrent `loadPublicCatalog()` calls make one fetch to `/api/public/catalog`; afterwards `peekPublicCatalog()` returns the payload.
- A 500 rejects, and the next call fetches again (failure not kept).
- A malformed body (`{ v: 2 }`) rejects.
- After `jest.spyOn(Date, "now")` moves 61 minutes ahead, `peekPublicCatalog()` is null and `loadPublicCatalog()` fetches again.

### 8. `app/components/search/__tests__/SearchLauncher.keyboard.test.tsx` (new, jsdom): keyboard-only search end to end

Mock `next/navigation` (`mockPush`, `mockPrefetch`), `global.fetch` resolving the payload of test 3 (item 42 is "Prismatic Evolutions Elite Trainer Box"), and render `<CurrencyProvider initialRate={{ rate: 1.36, date: "2026-09-29" }}><SearchLauncher /><input aria-label="Other field" /></CurrencyProvider>`. `_resetPublicCatalogForTests()` in `beforeEach`. Use `fireEvent` (no user-event dependency).
1. No request before open: after render, and after `fireEvent.pointerEnter` and `fireEvent.focus` on the button named "Search products, sets and pages", `fetch` has not been called.
2. `fireEvent.keyDown(document.body, { key: "/" })` opens a dialog named "Search Pokéfin"; `await screen.findByRole("combobox")` has focus (`document.activeElement`); `fetch` was called exactly once with `"/api/public/catalog"`.
3. `fireEvent.change(combobox, { target: { value: "prism etb" } })`; `await screen.findByRole("option", { name: /Prismatic Evolutions Elite Trainer Box/ })`; the first option has `aria-selected="true"` and the combobox's `aria-activedescendant` equals its id.
4. `ArrowDown` makes the second option selected; `ArrowUp` returns to the first; `ArrowUp` again wraps to the last option.
5. Back on the first option, `Enter` calls `mockPush("/product/42")` and the dialog is gone.
6. Reopen with `fireEvent.keyDown(document.body, { key: "k", ctrlKey: true })`, then close with Escape; reopen with `{ key: "k", metaKey: true }`. `fetch` is still called once in total.
7. Focus the "Other field" input and press "/": no dialog opens. Press Ctrl-K there: the dialog opens.
8. Focus the search button (`button.focus()`; jsdom's `fireEvent.click` does not move focus, and WP14's `Dialog` returns focus to whatever had it at open), click it, type "abc", press Escape: the query is cleared and the dialog stays; press Escape again: the dialog closes and the button has focus.
9. `openGlobalSearch("151")` (from `searchEvents`) inside `act`: the dialog opens with the combobox value "151".
10. Error path (fresh module state, `fetch` rejects): "Products could not be loaded." shows; typing "methodology" still lists the Methodology page option; clicking "Try again" calls `fetch` a second time.
11. With the dialog open and results shown, `expect(await axeViolations(dialog)).toEqual([])`.
12. Stale and withheld rows: a payload whose item 43 has `recorded_on` 5 UTC days before today (computed from `new Date()` in the test) and a price, and item 44 has `usd_price: null`. Typing a query that matches both shows "Last priced" plus the month and day in item 43's option (visible text, not only a `title`) and "No current price" in item 44's option, with no `data-direction` element in item 44's option.

### 9. `app/components/search/__tests__/searchEvents.test.ts` (new, jsdom)

`isTypingTarget`: text, search and email inputs, a textarea and a select are true; checkbox, radio and button inputs, a `div` and `null` are false. `isSearchShortcut`: "/" on `body` true; "/" with `ctrlKey` false; "k" with `ctrlKey` true and with `metaKey` true; "k" with `ctrlKey` and `shiftKey` false; a `repeat` or `defaultPrevented` event false; "/" on a text input false.

### 10. `app/__tests__/proxyMatcher.test.ts`

If WP26 created it, add `expect(matches("/api/public/catalog")).toBe(false);` to its "skips the anonymous public read routes" case. If it does not exist (WP26 not landed), create it with WP26's Tests item 10 content verbatim plus that line.

### 11. `app/lib/__tests__/pipelineStatus.test.ts` (new, node)

- `derivePipelineStatus([])` gives `{ newestPricedAt: null, productsTracked: 0, pricedInWindow: 0 }`; rows with null or unparseable timestamps count as tracked but not priced.
- Offset-less `"2026-09-30T06:10:00.123456"` and `"2026-09-30 06:10:00"` both give `newestPricedAt` `"2026-09-30T06:10:00.000Z"` (UTC, WP07's `parseRecordedAt`).
- Four rows at newest, newest minus 47 h, newest minus 48 h and newest minus 49 h: `pricedInWindow` is 3.
- `dataClockTier`: null gives unknown; ages 0, 12 h exactly, 12 h 1 min, 30 h exactly, 30 h 1 min, 31 h give fresh, fresh, aging, aging, delayed, delayed; a newest time 2 h in the future gives fresh.
- `dataClockCopy`: the four texts and tones of the Design table; aging with `hoursAgo: null` prints the absolute time.
- `pipelineDetail`: "301 of 306 products priced within 48 hours of the newest price." and the null case.
- Mirror: read `scripts/prod-smoke-lib.mjs` with `fs`, match `/DATA_CLOCK_DELAYED_HOURS = (\d+)/`, and expect `Number(match[1])` to equal `DATA_CLOCK_DELAYED_HOURS`.

### 12. `app/components/trust/__tests__/DataClock.test.tsx` (new, jsdom)

`jest.useFakeTimers()` and `jest.setSystemTime(NOW)` with `NOW = Date.parse("2026-09-30T14:00:00Z")`; `_resetDataClockForTests()` in `beforeEach`.
- 31 h old (`newestPricedAt` = NOW minus 31 h, `renderedAtMs` = NOW, `absolute` = `formatTimestamp(newest, { withYear: false })`): the link has `data-clock-tier="delayed"`, text "Updates delayed since " plus the absolute time, class contains `bg-warn-fill` and `text-warn-text`, href `/methodology#cadence`, `data-newest-priced-at` equals the ISO string.
- Rendered fresh, opened 31 h later: `renderedAtMs` = newest plus 1 h, system time = newest plus 31 h. `renderToString` output contains "Prices as of" (server tier); after `render` (client, effects flushed) the tier is `delayed`. This proves the client upgrade.
- Aging: newest = NOW minus 18 h 20 min. `renderToString` contains "Last update " plus the absolute time; the mounted component shows "Last update 18 h ago".
- Hydration: put the `renderToString` HTML in a container, `hydrateRoot` it inside `act`, and expect `console.error` (spied) not to have been called.
- Unknown: `newestPricedAt: null` shows "Price updates unavailable" with `data-clock-tier="unknown"`.
- Header variant: the text span has class `sr-only`; sheet variant: text and the detail line are visible and there is no `data-newest-priced-at`.
- `axeViolations` on each tier: `[]`.

### 13. `app/components/trust/__tests__/DataStatusChip.test.tsx` (new, jsdom): amber with a 31 h-old fixture

Mock `../../../lib/serverMarketData` with `getCachedPipelineStatus: jest.fn().mockResolvedValue({ newestPricedAt: new Date(NOW - 31 * 3_600_000).toISOString(), productsTracked: 306, pricedInWindow: 0 })` and fake timers at `NOW`. `render(await DataStatusChip({ variant: "header" }))`: the link has `data-clock-tier="delayed"`, its text starts with "Updates delayed since", and its `title` contains "0 of 306 products priced within 48 hours of the newest price." With a status 2 h old it renders "Prices as of" and no `bg-warn-fill`.

### 14. `app/lib/__tests__/serverMarketData.pipeline.test.ts` (new, node)

Copy the `server-only`, `@supabase/supabase-js`, `next/cache` (`unstable_cache: (fn) => fn`) and logger mocks from WP11's `serverMarketData.fallbackOrder.test.ts`.
- The summaries RPC resolves two rows with `price_recorded_at` `"2026-09-30T06:10:00"` and `"2026-09-29T02:00:00"`: `getCachedPipelineStatus()` resolves `newestPricedAt` `"2026-09-30T06:10:00.000Z"`, `productsTracked` 2, `pricedInWindow` 2.
- The RPC and the fallback query both reject: it resolves `EMPTY_PIPELINE_STATUS` and `logCaughtError` was called with `"pipeline_status_failed"` (or the fallback's own error label, if the fallback degrades to an empty list instead of throwing; then `newestPricedAt` is null either way). It never rejects.

### 15. `app/components/__tests__/Header.test.tsx` (rewrite WP03's file; keep its mocks and its `tap` helper)

`usePathname` returns `mockPathname` (default `"/prices"`); `useAuth` returns `mockAuth` with WP04's `sessionStatus`.
- Nav: links "Prices" `/prices`, "Screener" `/market`, "Sets" `/analytics`, "Portfolio" `/portfolio`, a "Tools" button, and the logo link named "Pokéfin, market home" with href `/`.
- Active state: `/prices` marks Prices `aria-current="page"` only; `/market` marks Screener; `/stats` marks Sets; `/` marks the logo; `/compare` sets no `aria-current` on the primary links.
- Prefetch: Prices `data-prefetch="default"`; Portfolio, "Sign in" and "Create account" `data-prefetch="false"`. With `mockPathname = "/market"` the "Sign in" href is `/auth/login?next=%2Fmarket`.
- Tools (desktop): `tap` the Tools button: `aria-expanded="true"`, `#tools-menu` lists "Box NAV calculator" `/box-calculator` and "Seller margin check" `/compare`; Escape closes it and focuses the button; `tap` outside closes it; `tap` the button twice: open, then closed (the WP03 mousedown-then-click regression).
- Sheet: the button "Open menu" has `aria-haspopup="dialog"` and `aria-expanded="false"`; focusing it (`button.focus()`, because `fireEvent.click` does not move focus in jsdom) and clicking it opens a dialog named "Menu" containing links Market, Prices, Screener, Sets, Portfolio, Box NAV calculator, Seller margin check, a radiogroup named "Display currency", "Sign in" and "Create account", and the `dataStatusSheet` element passed as a prop; Escape closes it and focus returns to "Open menu"; clicking "Prices" in it closes it; changing `mockPathname` and rerendering while it is open closes it.
- Signed in (`sessionStatus: "authenticated"`, `user`, `profile.username "ash"`): a button whose name matches `/ash/`; `tap` opens `#account-menu` with "Account settings" (`data-prefetch="false"`) and "Sign out"; clicking "Sign out" calls `signOut` and then `mockPush("/")`. No "Sign in" link is rendered.
- Currency: render inside `CurrencyProvider` (`initialRate { rate: 1.36, date: "2026-09-29" }`, `_resetCurrencyPreferenceForTests()` and `localStorage.clear()` in `beforeEach`); the desktop radiogroup "Display currency" has CAD checked; clicking the USD radio checks it and `localStorage.getItem(CURRENCY_STORAGE_KEY)` is `"USD"`.
- The search button named "Search products, sets and pages" is present with `aria-keyshortcuts="/ Control+K Meta+K"`.
- `axeViolations(container)` is `[]` for the closed header, and for the open sheet's dialog.

### 16. `app/components/__tests__/Header.auth.test.tsx` (WP04, update)

Change the expected labels "Sign In" to "Sign in" and "Sign Up" to "Create account". Keep all six WP04 cases with their assertions: unknown with `loading: true` renders no `.animate-pulse`, no "Sign in" link by role, and the "Sign in" text inside an `aria-hidden="true"` ancestor with class `invisible` (WP04 step 6's placeholder, kept by step 20); unknown with `loading: false` and anonymous show the links with no `aria-hidden` or `invisible` ancestor; authenticated (with `loading` false or true) shows the `/ash/` button and no "Sign in" link; unknown with a non-null user still shows "Sign in".

### 17. `app/components/__tests__/Footer.test.tsx` (WP24 test 9, update)

WP24 created this file. Keep its mocks and every assertion except the headings, which change from ("Explore", "Account", "Pokéfin") to the four below. Add: `render(<Footer />)` at `/prices`: `h2` headings Browse, Tools, Account and Pokéfin (no "Explore"); Browse links Prices `/prices`, Screener `/market`, Sets `/analytics`, Methodology `/methodology`; Tools links `/box-calculator` and `/compare`; Account links `/portfolio`, `/auth/login`, `/auth/signup`; every internal link `data-prefetch="false"`; an `svg` with `aria-hidden="true"` precedes the wordmark. At `/auth/login` the footer renders nothing.

### 18. `app/components/ui/__tests__/Dialog.test.tsx` (WP14, add 3 cases)

Default placement: the `dialog` class contains `m-auto` and `max-w-lg`. `placement="side"`: contains `ml-auto` and `h-dvh`, not `m-auto` or `max-w-lg`. `placement="top"`: contains `sm:mt-[10vh]` and `sm:max-w-xl`. In every placement the scrolling body contains `overscroll-contain`. All existing cases pass unchanged.

### 19. `app/lib/__tests__/loginCopy.test.ts` (new, node)

`loginSubtitleFor`: `null`, `""`, `"/"`, `"/prices"`, `"/auth/login"` and `"//evil.example/portfolio"` give the default; `"/portfolio"`, `"/portfolio/"` and `"/portfolio/lots"` give the portfolio sentence; `"/portfolio/watchlist"`, `"/portfolio/watchlist/alerts"` and `"/product/42?intent=watch"` give the watch sentence. `watchLoginPath("/product/42")` is `"/auth/login?next=%2Fproduct%2F42%3Fintent%3Dwatch"`; `watchLoginPath("/prices?q=x")` encodes `"/prices?q=x&intent=watch"`.

### 20. `app/auth/login/__tests__/LoginForm.test.tsx` (WP13, add 2 cases)

With the test's `useSearchParams` mock returning `next=/portfolio`: the text "Sign in to track your collection's value." is shown. `renderToString(<LoginForm />)` contains "Sign in to your Pokéfin account." and the email field (the form stays in the static HTML).

### 21. `app/components/ProductPrices/utils/__tests__/urlState.test.ts` (WP08, update) and `ProductPrices.urlSync.test.tsx`

Find the files with `grep -rln "parsePricesQuery\|serializePricesState" app --include=*.test.*`. Remove `currency` from every expected `PricesUrlState` literal and from expected serialized strings (for example `"gen=XY&q=x&currency=USD"` becomes `"gen=XY&q=x"`). Add: `serializePricesState` never contains `currency`; `legacyCurrencyParam("?currency=USD")` is `"USD"`, `("?q=x&currency=CAD")` is `"CAD"`, `("?currency=cad")`, `("?currency=EUR")` and `("")` are null. In the urlSync suite, a case that asserted a `currency` key in the written URL now asserts the key is absent.

### 22. `app/components/ProductPrices/__tests__/useLegacyCurrencyParam.test.tsx` (new, jsdom)

Mock `../../../lib/locationSearch` with `replaceOwnedSearchParams: jest.fn()`. `renderHook(() => useLegacyCurrencyParam(search), { wrapper: CurrencyProvider with a rate })`, preference reset in `beforeEach`:
- `"?currency=USD&q=x"`: `localStorage.getItem(CURRENCY_STORAGE_KEY)` is `"USD"` and `replaceOwnedSearchParams` was called with `("", ["currency"])`.
- `"?q=x"` and `"?currency=EUR"`: neither happens.

### 23. `app/portfolio/__tests__/page.currency.test.tsx` (WP20, rewrite)

Keep WP20's mocks. Render the page and a small probe (`function Probe() { const { setCurrency } = useCurrency(); return <button onClick={() => setCurrency("USD")}>probe</button>; }`) inside one `CurrencyProvider`. The page renders no radiogroup named "Currency"; the mocked dashboard shows CAD; after clicking "probe" it shows USD.

### 24. Controls tests (WP14, WP23, WP09)

- `app/components/ProductPrices/__tests__/controls.a11y.test.tsx`: `ControlBar` renders no radiogroup named "Currency" (delete the currency props from its render); the `CurrencySelector` case stays and gains `label="Recipe currency"` giving a radiogroup named "Recipe currency".
- Every other test that renders `ControlBar` with `selectedCurrency`, `exchangeRate`, `exchangeRateLoading` or `onCurrencyChange` (`grep -rn "onCurrencyChange\|exchangeRateLoading=" app --include=*.test.tsx`): delete those props; assertions on the currency buttons move to the Header test above.

### 25. `app/methodology/__tests__/MethodologyArticle.test.tsx` (WP24, add)

The `#cadence` section's text contains `` `${DATA_CLOCK_DELAYED_HOURS} hours` `` and a link to `#freshness`.

### 26. `app/__tests__/manifest.test.ts` (new, node)

`manifest()`: `theme_color` `"#ffffff"`, `background_color` `"#f8fafc"`, `start_url` `"/?source=pwa"`, `display` `"standalone"`, three icons of which exactly one has `purpose: "maskable"` and all `src` start with `/brand/`, and each file exists under `public/` (`fs.existsSync`); `shortcuts` urls equal `PRICES.href`, `PORTFOLIO.href`, `SCREENER.href`.

### 27. `scripts/prod-smoke-lib.test.mjs` (WP22, add; `node --test`)

`judgeDataClock`: HTML without the attribute fails with "no data clock"; an empty attribute fails; newest 18 h old passes with "18 h old"; exactly 30 h passes; 31 h fails and its detail contains "collector".

### 28. `app/lib/__tests__/productImages.test.ts` (new, node)

`toThumbnailUrl` turns `.../products/42.jpg` (and `.png`, `.webp`, upper-case `.JPG`) into `.../products/42_thumb.webp`, and returns null for a URL without `/products/`.

### 29. JSON-LD (WP24's `jsonLd` tests)

The organization node has `logo` ending in `/brand/pokefin-icon-512.png`. Update any `toEqual` expectation that lists the node's fields.

### 30. `app/__tests__/uiConventions.test.ts` (step 34)

The WP27 block's five rules pass; WP23's and WP24's rules pass with the refreshed baseline.

### Must pass unchanged

`app/context/__tests__/CurrencyContext.test.tsx`, `app/components/ProductPrices/__tests__/useCurrencyConversion.test.tsx`, `app/components/BoxCalculator/__tests__/BoxCalculator.test.tsx` ("loading a recipe switches the display currency"), `app/lib/__tests__/locationSearch.test.tsx`, WP14's existing `Dialog` cases, WP13's `redirects.test.ts`, `sitemap.test.ts` and `robots.test.ts`, WP11's route and cache tests, WP22's `scripts/*.test.mjs`.

## Verification

Run from `frontend/`:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
# expect: exit 0, no output

pnpm run lint
# expect: 0 errors (WP17 made lint blocking); no new warnings in files this PR created

pnpm exec jest app/lib/__tests__/productSearch.test.ts app/components/ProductPrices/__tests__/filtering.search.test.ts \
  app/components/search app/api/public/catalog app/lib/__tests__/catalogPayload.test.ts \
  app/lib/__tests__/publicCatalog.test.ts app/lib/__tests__/pipelineStatus.test.ts app/components/trust \
  app/lib/__tests__/serverMarketData.pipeline.test.ts app/components/__tests__/Header.test.tsx \
  app/components/__tests__/Header.auth.test.tsx app/components/__tests__/Footer.test.tsx \
  app/components/ui/__tests__/Dialog.test.tsx app/lib/__tests__/loginCopy.test.ts app/auth/login \
  app/components/ProductPrices app/portfolio app/methodology app/__tests__
# expect: all suites pass

pnpm test --ci
# expect: whole suite green; suite count = previous count + the new files

pnpm run test:scripts
# expect: all node --test files pass, including judgeDataClock

pnpm build:stub
# expect: exit 0. Route table: /api/public/catalog listed as static (○) with Revalidate 1d, not ƒ;
# /manifest.webmanifest, /icon.svg, /apple-icon.png, /favicon.ico present; /, /prices, /market,
# /analytics, /auth/login still static (○) with Revalidate 1d; no /icon.png.

grep -o '<link rel="manifest"[^>]*>\|<link rel="icon"[^>]*>\|<link rel="apple-touch-icon"[^>]*>' .next/server/app/index.html
# expect: /manifest.webmanifest, /favicon.ico (sizes="48x48" or "any"), /icon.svg (type image/svg+xml), /apple-icon.png
grep -o 'data-clock-tier="' .next/server/app/index.html | wc -l
# expect: 1 (the header chip; the sheet is not in the DOM until opened). grep -c would count
# lines, and the HTML is one line.
grep -c '/api/public/catalog' .next/server/app/index.html .next/server/app/prices.html
# expect: 0 for both (no catalog reference or preload in page HTML)

# No Poké Ball asset remains
grep -rnE "PokeballGlyph|PokeballMark|pf-pokeball-top|A15 15 0 0 1 31 16" app public | grep -v __tests__
# expect: no output
test ! -e app/icon.png && echo "icon.png removed"
# expect: icon.png removed
sha256sum app/favicon.ico app/apple-icon.png public/brand/*.png | grep d527e3db4cb3f2aea081a71e2f253384760c1baeb4dc047de54671fbc34a2a89
# expect: no output (the old 512 px Poké Ball PNG is gone from every icon path)
file app/favicon.ico app/apple-icon.png
# expect: "MS Windows icon resource - 3 icons" and "PNG image data, 180 x 180"

# Currency: one choice
grep -rln "<CurrencySelector" app --include=*.tsx | grep -v __tests__
# expect: app/components/BoxCalculator/BoxCalculator.tsx only
grep -rn "rememberCurrency\|onCurrencyChange" app --include=*.ts --include=*.tsx | grep -v __tests__
# expect: no output

# Nav labels
grep -rn "Seller Tools\|Market View\|Set Analytics" app/components/Header.tsx app/components/Footer.tsx app/components/nav
# expect: no output

# Conventions ratchet: only decreases plus manifest.ts
git diff app/__tests__/uiConventions.baseline.json
# expect: every changed number lower than before, one new line "manifest.ts": 2 under "hex"
```

Performance (step 35), with the perf build served:

```bash
diff <(grep -E "Shared JS|/prices JS|/ JS|/product" /tmp/wp27-budget-before.txt) <(grep -E "Shared JS|/prices JS|/ JS|/product" /tmp/wp27-budget-after.txt)
# expect: Shared JS (gz) up by 6.0 kB or less; no row with status FAIL, unset or missing in /tmp/wp27-budget-after.txt
# expect: /api/public/catalog "raw" at most 98304 and "br" at most 16384 (the fixture's 306 products)
```

CI runs WP22's Lighthouse assertions: CLS and bf-cache must stay green on `/`, `/prices`, `/product/900001` and `/market`.

Manual checks (`pnpm build:stub` with `SUPABASE_STUB_FIXTURE=perf`, `node scripts/perf-serve.mjs`, open `http://127.0.0.1:3100`):

1440 px:
1. Header matches the desktop wireframe: logo, Prices, Screener, Sets, Portfolio, Tools on the left; the clock text "Prices as of ...", search button with `/`, USD/CAD, Sign in, Create account on the right. No red except the mark and the "é". The mark shows a P with a square counter.
1b. Resize to 1024 px and 1280 px, signed out and then signed in (an account with a 20-character username): no horizontal scrollbar at either width; at 1280 px the clock text may end in an ellipsis but its tooltip shows the full sentence; take screenshots before and after signing in and confirm the clock, search button and currency toggle did not move.
2. `/prices`: Prices has the blue bar. `/market`: Screener; the page H1 reads "Screener". `/analytics`: Sets; H1 "Sets". `/compare`: the Tools button reads as current and the menu marks Seller margin check.
3. Tools opens on click, Escape closes and returns focus, clicking outside closes.
4. Click USD in the header on `/prices`: every card price switches to USD without a reload, the pressed segment paints at once. Go to `/market`, `/portfolio` (signed in) and home: all USD, no page-level toggle. Reload: still USD. `/box-calculator`: the "Recipe currency" control shows USD; switch it to CAD, then check the header still says USD.
5. Open `/prices?currency=CAD` with USD chosen: the header switches to CAD and the address bar loses `currency=CAD` (other keys kept).
6. DevTools Network, filter `catalog`: load pages, hover the search button: no request. Press `/`: one `/api/public/catalog` request (under 16 kB transferred). Close, press Ctrl-K: no second request.
7. Type `151 etb`, `prism`, `sv8.5`, `pokemon center`, `zzzz`: sensible first results; Enter opens the first; arrows move with wrap; `zzzz` shows "No matches" and "Missing a product? Tell us". Keyboard only, from page load to a product page: `/`, type, Enter.
8. Performance panel, CPU 4x slowdown, "Disable cache": record pressing `/` on `/prices`, then typing `prism`. The Interactions track shows each interaction at 100 ms or less (the first open included: the dialog paints with the loading field before the chunk arrives).
9. Hover the clock: the title shows the coverage line. Click it: `/methodology#cadence`, heading visible below the sticky header, the new paragraph says 30 hours.
10. `/favicon.ico`, `/icon.svg` (DevTools Rendering, emulate `prefers-color-scheme: dark`: the tile turns light red with a dark glyph), `/apple-icon.png`, `/manifest.webmanifest`. Application panel, Manifest: no errors, three icons, three shortcuts, installable.

390 px (DevTools device toolbar, touch emulation on):
1. One 64 px row: mark and wordmark on the left; clock icon, search icon and menu button on the right; nothing overflows horizontally.
2. Menu: the sheet slides in at the right with a dimmed backdrop; the page behind does not scroll when the sheet is scrolled to its end (overscroll contained); focus is inside; Escape, backdrop tap and X close it; focus returns to the menu button. Rows and segments are 44 px.
3. The sheet's clock row shows the full text and the coverage line; the currency block shows the rate with its Bank of Canada date.
4. Search opens full screen; the input text is 16 px (no zoom on focus in iOS Safari, if a device is available); the keyboard's action key reads "Go"; results scroll under the sticky input.
5. `/auth/login?next=/portfolio`: the subtitle reads "Sign in to track your collection's value." and the form does not move when it appears (reload with throttling to watch).
6. Footer: two columns (Browse | Tools, Account | Pokéfin), the brand block full width, legal rows below.

## Owner actions

1. **D6, the mark.** Look at the interim monogram (header, favicon, `/apple-icon.png`, `/brand/pokefin-icon-512.png`) and either approve it or supply a final mark (an SVG on a square grid, legible at 16 px, one colour on the brand red). Replacing it later is a 30-minute follow-up: update `MARK_GLYPH_PATH` in `app/components/brand/PokefinMark.tsx`, the `<path>` in `app/icon.svg` and `GLYPH` and `COUNTER` in `scripts/brand/make-icons.py`, rerun the script, commit.
2. **After the deploy:** hard-refresh the site in Chrome, Firefox and Safari and confirm the new tab icon (browsers cache favicons for days; an old icon for a while is expected). On a phone, "Add to Home Screen" (iOS) and "Install app" (Android Chrome) show the new icon and open `/?source=pwa` standalone.
3. **Watch the first production smoke run** after merge (Actions, "Production smoke"): the new "Data clock" row should read "newest price N h old". If the collector happens to be offline, the issue it opens is correct; restart the collector.
4. Nothing to configure: no migration, environment variable, secret or third-party service.

## Acceptance criteria

- [ ] The header shows Market (logo), Prices, Screener (`/market`), Sets (`/analytics`), Portfolio (always, signed out too) and a Tools menu with Box NAV calculator and Seller margin check; every label and href comes from `app/components/nav/navConfig.ts`.
- [ ] Below 1024 px the nav lives in a sheet on WP14's `Dialog` (`placement="side"`) with a backdrop, focus trap, Escape and backdrop close, focus return, and `overscroll-behavior: contain`.
- [ ] `/`, Ctrl-K and Cmd-K open the search dialog from any page; "/" typed in a text field does not; nothing opens over another dialog.
- [ ] Search results list products (price in the header currency plus 30D change), sets and pages; Enter opens the active option; keyboard-only search is covered end to end by `SearchLauncher.keyboard.test.tsx`.
- [ ] No request to `/api/public/catalog` before the first open (test 8 case 1 and manual check 6); one per tab per hour after it.
- [ ] Opening search measures 100 ms or less INP (manual check 8), including the first open.
- [ ] `/api/public/catalog` is static ISR (Revalidate 1d, tag `market-products`), excluded from `proxy.ts`, at most 96 kB raw and 16 kB br for 306 products, and never contains a price or 30D change that migration 0023 withheld.
- [ ] The header chip shows "Prices as of …" up to 12 h, "Last update … h ago" (after mount) up to 30 h, and turns amber "Updates delayed since …" beyond 30 h; `DataStatusChip.test.tsx` proves amber with a 31 h-old fixture, and `DataClock.test.tsx` proves the server HTML is absolute and hydration is clean.
- [ ] `/methodology#cadence` explains the clock with the 30-hour constant; WP22's smoke test fails when `data-newest-priced-at` on `/` is older than 30 h.
- [ ] The USD/CAD choice lives in the header (and the sheet); `/prices`, `/market` and `/portfolio` have no currency toggle; `/box-calculator` has "Recipe currency" only; a legacy `?currency=` link sets the choice once and leaves the URL.
- [ ] `/auth/login?next=/portfolio` shows "Sign in to track your collection's value."; a `next` with `intent=watch` or under `/portfolio/watchlist` shows "Sign in to watch products and get daily alerts."; the default stays in the static HTML.
- [ ] No Poké Ball remains: the Verification grep prints nothing, `app/icon.png` is gone, the old PNG hash appears nowhere; `app/icon.svg` has the dark-scheme rule; `favicon.ico` has 16, 32 and 48 px frames; `apple-icon.png` is 180 px.
- [ ] `app/manifest.ts` serves name, short name, `start_url` `/?source=pwa`, `standalone`, theme `#ffffff`, background `#f8fafc`, icons 192, 512 and 512 maskable, and shortcuts Prices, Portfolio and Screener. No service worker.
- [ ] The footer has Browse (Prices, Screener, Sets, Methodology), Tools, Account and Pokéfin columns and the new mark; every footer, auth and account link has `prefetch={false}`; primary nav links keep the default except Portfolio.
- [ ] Shared JS grows by 6.0 kB gz or less; no WP22 limit is raised except, if needed, the shared JS limit within that allowance with the `Perf budget raise:` line in the PR; Lighthouse CLS and bf-cache assertions stay green.
- [ ] `uiConventions.baseline.json` only decreases, except the one documented `manifest.ts: 2` hex entry; the WP27 conventions block passes.
- [ ] `tsc`, lint, the full jest suite, `test:scripts` and `pnpm build:stub` pass.

## Rollback

`git revert <merge commit>` restores the previous header, footer, icons, currency controls and `/prices` URL state. There is no migration, environment variable or stored data to undo; the currency preference key (`pokefin.currency`, WP20) is unchanged, so visitors keep their choice. After a revert, links to `/prices` no longer carry `?currency=` (it was stripped), which only means `/prices` falls back to its default currency. If this PR added the `proxy.ts` matcher exclusion and `app/lib/publicRoute.ts` (WP26 had not landed) and WP26 has since landed on top, revert only this package's other hunks and keep those two files. Browsers keep the new favicon cached for a few days after a revert; that is cosmetic.

Partial rollback by area is safe: the search (steps 5 to 12) can be removed by deleting `<SearchLauncher />` from the header; the chip by removing the two props in `layout.tsx`; the currency move (steps 26 to 28) by reverting those files together with their tests.

## Commit and PR

Branch: `remediation/wp27-navigation-search-and-data-clock`

Commit message:

```
feat(nav): task-based header, global search, data clock and Pokéfin mark (WP27)

- Nav by task from one config: Market (logo), Prices, Screener, Sets,
  Portfolio, Tools (Box NAV calculator, Seller margin check); phone menu
  sheet on the shared Dialog
- Global search (/ or Ctrl/Cmd-K): lazy combobox over a CDN-cached
  /api/public/catalog fetched on first open; one product matcher shared
  with /prices
- Header data clock from the newest price: absolute time in HTML, relative
  after mount, amber after 30 h; smoke test fails on the same rule
- USD/CAD chosen once in the header; page toggles removed, box calculator
  keeps a recipe currency; legacy /prices?currency= honoured once
- Original interim mark replaces the Poké Ball; icon.svg with a dark-tab
  rule, 16/32/48 favicon, 180 px apple icon, web app manifest
- Footer Browse column, contextual sign-in copy, Screener and Sets titles
```

End the message with the attribution lines the session's system reminder specifies.

PR title: `WP27: Task-based navigation, global search, data clock and new mark`

PR body:
- Summary: link `audits/remediation/WP27-navigation-search-and-data-clock.md`; the goal in two sentences; screenshots of the header at 1440 px (signed out, signed in, Tools open), at 390 px (bar and open sheet), the search dialog at both widths (results, no matches), and the chip in each tier (from the tests' rendered markup or a temporary local stub).
- Decisions and why: the chip first in the right-hand cluster, the only shrinkable item, and the fixed-width account slot (no layout shift, no overflow at 1280 px); the mark's square counter; search panel as a lazy chunk; catalog on first open only; box calculator keeps a recipe currency; legacy `?currency=` adoption; interim mark pending D6; promo without a mark and with a neutral button; `manifest.ts: 2` hex ratchet entry; methodology paragraph without a version bump (a display rule, not a formula).
- Measurements: `perf:budget` before and after (shared JS delta), catalog raw and br bytes, the INP recordings (manual check 8), favicon bytes before and after.
- Tests added and edited (list every file from the Tests section).
- Whether WP25 and WP26 were present, and what was done in step 5 as a result.
- Noticed, out of scope: `/methodology` prose that still names "Market View" and "Set Analytics" (WP33, WP37), the sign-in pages' red submit buttons (their own package), the home hero search (WP32), anything else found.
- Owner actions from this spec, as a checklist.
- Verification output pasted.
