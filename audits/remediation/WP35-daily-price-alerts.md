# WP35: Daily price alerts by email digest

- **Goal**: a signed-in collector sets "tell me when this drops to C$250 or below", "tell me when it moves 10% or more in a week", "tell me when someone lists it 5% under Market Price" or "tell me when units on the market fall 20% in a month", from the product page or from a watchlist row, and gets one email the next morning listing every alert that fired, each with the product, the price, the TCGplayer day it describes and a link. Alerts are checked once a day against fresh prices only, never on a withheld price, and every email has a one-click unsubscribe that works without signing in.
- **Why now / value**: alerts are the largest competitive gap and, with the watchlist, the retention loop of the product: every serious competitor has them and Pokéfin has none (`01-PRODUCT-DIRECTION.md` §5 item 2, §4.2 step 6; `research/competitive-landscape.md` §4 item 1). WP34 shipped the watchlist page that hosts alert management and WP25 the precomputed, freshness-gated `product_daily_stats` and dated `fx_daily` that make a daily check one indexed read.
- **Effort**: L, 15 to 16 hours (migration, Vault stand-in and the two Python test modules 4 h; cron job, Brevo client, email renderer and their tests 4 h; alerts route, repo, browser client and unsubscribe route and page with tests 3 h; dialog, button, panel and watchlist wiring with tests 3.5 h; methodology, privacy, lint lists, budgets, verification and PR 1.5 h).
- **Depends on**: WP34 (`watchlist_items` and migration 0038's `export_my_data`, `app/lib/watchlist.ts` `parseProductIdString`, `parseProductIdValue`, `watchProductLoginPath`, `WATCHLIST_PAGE_PATH`; `app/lib/server/watchlistRepo.ts` `addWatch`; `app/lib/server/watchlistModel.ts` `statsMatchPrice`; `app/lib/watchlistStore.ts` `noteWatched`; `WatchlistView.tsx`, `WatchlistTable.tsx`, `WatchlistPhoneList.tsx`, `RemoveButton.tsx`; `tests/test_wp34_watchlist_db.py` fixture style), WP31 (`ProductActions.tsx` and the product page composition), WP28 soft (`getCachedProductAttributes`, `ProductCatalogAttributes.msrp_usd` and `msrp_cad`: the MSRP suggestion only), WP25 (`product_daily_stats` 0033, `fx_daily` 0034 and the 00:30 UTC D-1 finalisation, `getCachedProductStats`, `getCachedFxDaily`, `usdToCadOn`, `statsFor`), WP24 (`app/content/disclosures.ts` `FOOTER_DISCLAIMER` and `TCGPLAYER_TRADEMARK_NOTICE`, `app/content/contact.ts` `CONTACT_EMAILS`, `app/content/methodology.ts`, `MethodologyArticle.tsx`, the `/privacy` page that already names Brevo), WP21 (`enforce_owner_row_cap()` 0031, `pokefin_scraper` 0032, `scripts/db/ci_bootstrap.sql`, `scripts/db/replay_migrations.sh`, CI job "Database replay and Python tests"), WP13 (`app/lib/site.ts` `absoluteUrl`, `NO_INDEX`; `productMeta.ts` `productPath`, `getProductDisplayName`). Through them: WP04 (`useAuth()` `sessionStatus`), WP05 (`requireRouteUser`, `jsonNoStore`, `NO_STORE`, `rejectIfNotAppRequest`, the user-table ESLint selector, `ANON_CLIENT_FORBIDDEN_FILES`), WP07 and WP23 (`format.ts` `formatMoney`, `formatPercent`, `formatDateOnly`, `formatMonthDay`), WP11 (`getCachedMarketProductSummaries`, `MIN_SECRET_LENGTH` pattern of `/api/revalidate`), WP14 (`Dialog`), WP17 (`logger.ts` reaching Sentry), WP20 (`useCurrency`, `supabaseEnv.ts`, `pnpm types:db`, generated `app/types/database.ts`), WP22 (`perf-budgets.json`, `pnpm perf:budget`), WP23 (`Button`/`buttonClasses`, `SegmentedControl`, `Skeleton`, `EmptyState`, `ProvenanceLine`, `PageHeader`, tokens, `uiConventions.baseline.json`, `test-utils/axe.ts`), WP26 (`PUBLIC_ROUTE_CLIENT_FILES`), WP27 (`navConfig.ts` `productHref`).
- **Unblocks**: nothing in Track 2 depends on it. It completes §4.2 step 6 ("Return") of the product direction. A later weekly web edition or CASL newsletter (deferred, `01-PRODUCT-DIRECTION.md` §10) reuses `app/lib/email/brevo.ts`, `emailTheme.ts`, the Vault token pattern and the unsubscribe page.
- **Placement**: Track 2, data lane, after WP34 (the watchlist page hosts alert management; the alert route reuses WP34's repo). Reserves migration **0039** and keeps it if it merges out of order. WP28 is a soft dependency (MSRP suggestion only). It can run in parallel with WP36 (0040) and WP37 (0041).
- **Suggested branch name**: `remediation/wp35-daily-price-alerts`
- **Risk level**: medium-high. It is the first feature that sends email and the first anon-executable SECURITY DEFINER functions that read auth emails; the risk is contained by a Vault token checked in constant time before any work, claim-then-send idempotency proven by a database test, a CASL-complete footer gated on the owner's mailing address, and a cron route that refuses to run without both secrets.

## Why

A collector who wants to buy a box when it dips under a price, or sell when it runs, has to open Pokéfin every day and look; nothing tells them when a level is crossed, and the site gives a signed-in user no reason to come back (`research/ui-audit.md` `/product/[id]`: "no Add to portfolio, no Watch, no Compare, no Alert"). PokeData, TCGplayer and Card Ladder all offer alerts, and a Chrome extension exists only to add them to TCGplayer, which is why the research ranks watchlists and alerts the top retention feature (`research/data-opportunities.md` §3.11, tier A; `research/competitive-landscape.md` §3a feature matrix "Price alerts", §4 item 1). This package adds alert rules on any product (five kinds, up to 50 per user), a once-a-day evaluation of the previous UTC day's finalised statistics, one digest email per user per morning through Brevo's free tier, and a one-click unsubscribe that meets Canada's anti-spam law and RFC 8058 (`research/trust-seo-brand.md` §12.2). It follows the data's real cadence: the copy says "Checked once a day after prices update", never "instant", a withheld price never fires, and a CAD level is compared at the Bank of Canada rate of the price's own day (`01-PRODUCT-DIRECTION.md` §2 principles 1, 3 and 4, §6.2).

## Design

### Decisions (binding)

1. **Evaluation day.** The cron runs daily at 11:05 UTC (07:05 EDT, 04:05 PDT) and evaluates `p_day` = yesterday in UTC, whose `product_daily_stats` rows WP25's pg_cron job finalised at 00:30 UTC. Digests land in the Canadian morning. On Vercel's Hobby plan a daily cron fires somewhere in the 11:00 to 11:59 UTC hour; that is acceptable.
2. **Fresh prices only.** A rule is evaluated only against a `product_daily_stats` row of `p_day` with `is_price_fresh` true, a non-null `usd_price`, and `price_day >= p_day - 3` (a price "fresh" under migration 0023's 14-day rule but four or more days old never triggers an email). Without such a row the rule is neither fired nor re-armed that day.
3. **Kinds, values and thresholds** (one table, mirrored by `app/lib/alerts.ts` and migration 0039, drift-tested):

| Kind | Dialog label | Value on `p_day` | Fires when (armed) | Re-arms when (disarmed) | Threshold range | Currency |
|---|---|---|---|---|---|---|
| `price_below` | Price falls to or below | `usd_price`, or `usd_price x fx_daily(price_day)` for CAD, rounded to cents | value <= T | value >= round(T x 1.02, 2) | 0.01 to 1,000,000 | USD or CAD |
| `price_above` | Price rises to or above | same | value >= T | value <= round(T x 0.98, 2) | 0.01 to 1,000,000 | USD or CAD |
| `pct_move_7d` | Price moves up or down within 7 days | `ret_7d` (WP25, USD Market Price terms), 1 decimal | abs(value) >= T | abs(value) <= T - 2 | 3 to 100 | USD only |
| `ask_below_market` | A listing is below Market Price (before shipping) | `ask_premium_pct` (WP25), 1 decimal | value <= -T | value >= -T + 2 | 1 to 90 | USD only |
| `supply_drop_30d` | Units on the market drop over 30 days | `qty_change_30d_pct` (WP25), 1 decimal | value <= -T | value >= -T + 2 | 5 to 95 | USD only |

   Hysteresis: 2% of the level for price rules, 2 percentage points for the others. A value exactly on the level fires. A CAD rule on a day without an `fx_daily` row for the price's day is skipped for that day (the 0034 principle: no CAD value rather than a guessed one). The rate is that of the price's day, the same rate the product page uses for that price, which is the evaluation day itself in the normal daily cadence.
4. **New rules start armed.** If the condition is already true at creation, the rule fires in the next digest; the dialog says so before saving.
5. **One digest per user per day**, listing every rule that fired. Users without a confirmed email (`auth.users.email_confirmed_at` null) or with the digest turned off get nothing, but their rules keep being evaluated and re-armed.
6. **Idempotency by claim.** `get_due_alert_digests` claims each firing rule in `alert_deliveries (alert_id, day)` before the email is sent; `record_alert_digest_sent` marks it sent and disarms the rule; `release_alert_digest` drops the claim when Brevo refuses the email. A second run the same day, or a duplicated cron event, sends nothing. A claim left unsent for 30 minutes (crashed run) can be claimed again by a manual re-run. Evaluation never goes backwards: a rule already evaluated for a later day ignores an earlier one.
7. **No service-role key in Vercel.** The cron route and the unsubscribe route use the publishable (anon) key with no session. The four cron functions are SECURITY DEFINER, executable by `anon`, and each one first checks `p_token` against the Vault secret `pokefin_cron_token` with a constant-time comparison of SHA-256 digests; a wrong, short or missing token, or a missing Vault secret, raises 42501 before any read (`research/trust-seo-brand.md` §10.1 pattern). `unsubscribe_alerts(p_token uuid)` is authorised by the unguessable per-user token alone.
8. **Two secrets, two hops.** Vercel calls the route with `Authorization: Bearer $CRON_SECRET` (Vercel's own cron mechanism); the route calls the database with `POKEFIN_CRON_TOKEN`, which equals the Vault secret. They are different values so a leaked request log never unlocks the database functions.
9. **At most 200 digests a run** (`p_max_users`), oldest rule first; Brevo's free tier is 300 emails a day and auth emails may share it. A truncated run is logged and the remaining users' rules stay armed for the next day.
10. **Mailing address gate (CASL).** Every email carries the sender identity and a postal address (owner decision D4, `MAILING_ADDRESS` in `app/content/disclosures.ts`). While it is `null`, `POST /api/alerts` answers 503, the product page renders no "Alert me" button, the watchlist page hides the alert controls, and the cron route answers 503 and sends nothing.
11. **Alerting watches the product.** Saving a rule also adds the product to the watchlist (best effort, through WP34's `addWatch`; a full watchlist does not block the alert). Rules are managed in a "Price alerts" section of `/portfolio/watchlist` (`#alerts`) and from a bell button on each watchlist row. Removing a product from the watchlist does not delete its rules.
12. **Unsubscribe.** The email body links to `/alerts/unsubscribe?t=<token>`, a page whose GET only shows a button; the POST acts, so link scanners that prefetch GETs cannot unsubscribe anyone. The `List-Unsubscribe: <https://…/api/alerts/unsubscribe?t=<token>>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers let mail clients unsubscribe in one click (RFC 8058). Unsubscribing turns the digest off; it never deletes rules. The watchlist page can turn it back on.

### Screens

Product page actions row (WP31 slot, after Watch), 1440 px and 390 px:

```
[ Add to portfolio ] [ ★ Watch ] [ 🔔 Alert me ] [ Open in Box NAV ]  View on TCGplayer
```

"Alert me" is a secondary button with a bell icon (`aria-hidden`), `aria-haspopup="dialog"`. Before the session is known it is `aria-disabled="true"` at the same size. Signed out, a tap goes to `/auth/login?next=<this page>&watch=<id>` (WP34's round trip: the visitor lands back with the product watched, subtitle "Sign in to watch products and get daily alerts."). Signed in, it opens the dialog, whose code is a lazy chunk preloaded on hover or focus.

Alert dialog (WP14 `Dialog`, size `md`), 1440 px:

```
+----------------------------------------------------------------+
| Alert me                                                   [x] |
| Evolving Skies Booster Box                                     |
| Market Price C$612.40 ($446.10 USD), Sep 29                     |
|                                                                |
| Alert me when                                                  |
|  (o) Price falls to or below                                   |
|  ( ) Price rises to or above                                   |
|  ( ) Price moves up or down within 7 days                      |
|  ( ) A listing is below Market Price (before shipping)         |
|  ( ) Units on the market drop over 30 days                     |
|                                                                |
| Price (C$)                                    Currency         |
| [ 551.16                              ]       [ CAD | USD ]    |
| [10% below now: C$551.16] [Back to Canadian MSRP: C$215.99]    |
| Checked once a day after prices update. One email each morning |
| lists every alert that fired, sent to dario@example.com.       |
| How alerts work                                                |
| (status) Alert saved. Checked once a day after prices update.  |
|                                                                |
| Your alerts for this product                                   |
|  Price at or below C$250.00        Waiting. Last checked Sep 29 |
|                                          [Pause] [Delete]      |
|----------------------------------------------------------------|
|                                       [ Close ] [ Save alert ] |
+----------------------------------------------------------------+
```

390 px: the same dialog at full width inside the 16 px gutters, radios as 44 px rows, the threshold input 16 px text and 44 px tall, the currency `SegmentedControl` wrapping under the input, suggestion chips wrapping, footer buttons pinned.

Watchlist page, 1440 px (WP34 table plus one column and one section):

```
| PRODUCT v                PRICE      1D     7D     30D   VS 52W HIGH  x MSRP  DAYS OF  ADDED  ALERTS   |
|                                                                          SUPPLY                         |
| Evolving Skies Booster…  C$612.40  ▲0.4%  ▲3.4%  ▼2.0%  16.6% below  1.4x    12       Sep 29  🔔2   x  |
| Surging Sparks ETB       C$81.30◷  --     ▼1.1%  ▲4.0%  At high      1.2x    31       Sep 12  🔔    x  |
...
| How these are calculated: Change · 52-week high · x MSRP · Days of supply                              |
|                                                                                                        |
| Price alerts                                                                              h2 20/28     |
| 3 of 50 alerts. Checked once a day after prices update, against the previous day's TCGplayer Market   |
| Price. One email each morning lists every alert that fired. How alerts work               small       |
| Daily digest on, sent to dario@example.com.                                 [ Turn off emails ]        |
| +----------------------------------------------------------------------------------------------------+ |
| | Evolving Skies Booster Box   Price at or below C$250.00    Waiting. Last checked Sep 29  [Pause][Delete] |
| | Evolving Skies Booster Box   Moves 10% or more in 7 days   Fired Sep 28: Up 12.4% over 7 days.        | |
| |                                                            Can fire again after the 7-day move is    | |
| |                                                            back within 8%.            [Pause][Delete] | |
| | Lost Origin Booster Bundle   Price at or above $60.00 USD   Paused                   [Resume][Delete] | |
| +----------------------------------------------------------------------------------------------------+ |
```

Watchlist page, 390 px: each watchlist `DataList` row gains a bell button (44 px) beside the remove button, as a sibling of the row link. The "Price alerts" section stacks: heading, provenance, digest line with its button under it, then one card row per rule: product link (line 1), condition (line 2), status (line 3, small ink-soft), and Pause or Resume and Delete as 44 px buttons on line 4.

`/alerts/unsubscribe?t=<token>` (noindex, `referrer: no-referrer`), 390 px and 1440 px (centred `max-w-xl`):

```
+--------------------------------------------+
| Stop price alert emails                    |  h1
| You will no longer get the daily digest.   |
| Your alerts stay saved, and you can turn   |
| emails back on from your watchlist.        |
| [ Stop alert emails ]                      |  primary, a POST form
+--------------------------------------------+
```

After the POST it shows "Alert emails are off" with a link "Go to your watchlist" (or the already-off, invalid-link or error copy below).

Digest email (HTML, 600 px max, light; plain-text part with the same content):

```
Your price alerts for Sep 29, 2026
Checked once a day after prices update, against TCGplayer Market Price for Sep 29, 2026 (UTC).

Evolving Skies Booster Box                                   (link)
Price at or below C$250.00
Market Price C$244.80 ($180.00 USD at the Bank of Canada rate of Sep 29)
TCGplayer Market Price as of Sep 29, 2026

Scarlet & Violet 151 Elite Trainer Box                        (link)
Moves 10% or more in 7 days
▼ Down 11.2% over 7 days (USD Market Price)
TCGplayer Market Price as of Sep 29, 2026

Manage your alerts: https://www.pokefin.ca/portfolio/watchlist#alerts
---
Market data for information only, not financial advice. Past prices do not predict future prices.
You get this email because you set price alerts on Pokéfin. Stop alert emails: https://…/alerts/unsubscribe?t=…
Pokéfin, {mailing address}. Contact: hello@pokefin.ca
TCGplayer is a trademark of TCGplayer, Inc. Pokéfin is not affiliated with TCGplayer.
```

Subject: one alert "Price alert: Evolving Skies Booster Box"; several "3 price alerts for Sep 29". From "Pokéfin alerts <alerts@pokefin.ca>", reply-to `hello@pokefin.ca`.

### States

| Where | State | What shows |
|---|---|---|
| Alert me button | session unknown | "Alert me", `aria-disabled="true"`, clicks ignored |
| Alert me button | signed out | click goes to sign-in with `next` and `watch` |
| Alert me button | mailing address not set | not rendered (server decision) |
| Dialog | loading | `role="status"` sr-only "Loading your alerts" and three flat `Skeleton` bars; Save disabled |
| Dialog | load failed | "Your alerts could not be loaded. Please try again." plus a "Try again" button; Save disabled |
| Dialog | `available` false | "Price alerts are not available yet."; Save disabled |
| Dialog | price withheld or never priced | current line "No current Market Price: the last price is older than 14 days." (or "This product has not been priced yet."); price suggestions hidden; saving allowed, help adds "This alert waits until a current price exists." |
| Dialog | product no longer tracked | "This product is no longer tracked, so its alerts are not checked."; Save disabled |
| Dialog | condition already true | help adds "Already true at the latest price: it will be in your next digest." |
| Dialog | 50 rules | `ALERTS_FULL_MESSAGE`; Save disabled |
| Dialog | digest off | help adds "Alert emails are off. Turn them back on from your watchlist." |
| Dialog | invalid threshold | error under the input (`aria-invalid`, `aria-describedby`), focus returns to the input |
| Dialog | saved | status "Alert saved. Checked once a day after prices update." (plus " The product is now on your watchlist." when it was added); the input resets to the default; the rule appears in the list |
| Dialog | duplicate | status "You already have this alert." |
| Dialog | save failed | the server's message under the input |
| Watchlist, Price alerts | loading | sr-only "Loading your alerts" and three flat bars |
| Watchlist, Price alerts | failed | "Your alerts could not be loaded." plus "Try again" |
| Watchlist, Price alerts | none | `EmptyState` "No price alerts yet" / "Select Alert me on a product page, or the bell on a watched product, to get one email a morning when a price crosses your level." / link "Browse prices" |
| Watchlist, Price alerts | digest off | warn line (`WarnIcon`, `text-warn-text`) "Alert emails are off since Sep 30. Your alerts are still checked, but nothing is sent." plus "Turn on emails" |
| Watchlist, Price alerts | `available` false | the section and the bell column are not rendered |
| Rule row | armed, never checked | "Waiting for the first daily check." |
| Rule row | armed, checked | "Waiting. Last checked Sep 29." |
| Rule row | fired | "Fired Sep 28: {value sentence}. {re-arm sentence}" |
| Rule row | paused | "Paused" |
| Rule row | untracked product | "Not checked: this product is no longer tracked." |
| Unsubscribe page | valid token | the button form |
| Unsubscribe page | missing or malformed token | "This link is not valid. If you still get alert emails, sign in and turn them off on your watchlist." |
| Unsubscribe page | `status=unsubscribed` | "Alert emails are off. You will not get the daily digest any more. Your alerts are still saved." |
| Unsubscribe page | `status=already_unsubscribed` | "Alert emails were already off." |
| Unsubscribe page | `status=unknown` | "This link is no longer valid. If you still get alert emails, sign in and turn them off on your watchlist." |
| Unsubscribe page | `status=error` | "Something went wrong. Please open the link in your email again." |

### Copy (every new user-facing string)

All strings above, plus: "Alert me", "Alerts for {product name}", "{n} alerts set" (sr-only on the bell), "Alert me when", "Price", "Price (C$)", "Price (US$)", "Move of at least (%)", "Below Market Price by at least (%)", "Drop of at least (%)", "Currency", "Suggestions", "10% below now: {money}", "10% above now: {money}", "Back to Canadian MSRP: {money}", "Back to US MSRP: {money}", "{n}%", "Market Price {money} ({usd} USD), {date}", "Now: {sentence}", "Checked once a day after prices update.", "One email each morning lists every alert that fired, sent to {email}.", "How alerts work", "Save alert", "Saving…", "Close", "Your alerts for this product", "Pause", "Resume", "Delete", "Pause alert: {rule}", "Resume alert: {rule}", "Delete alert: {rule}", "Alert paused.", "Alert resumed.", "Alert deleted.", "Price alerts", "{n} of 50 alerts.", "Daily digest on, sent to {email}.", "Turn off emails", "Turn on emails", "Alert emails turned off.", "Alert emails turned on.", "Stop price alert emails", "Stop alert emails", "Go to your watchlist", and the rule and value sentences of `describeRule`, `describeValue` and `rearmText` (step 2). No "live", "real-time", "instant", "undervalued", "buy now", "TCGPlayer" or em dash anywhere (WP15 and WP24 tests).

### Accessibility

- "Alert me" is a plain button that opens a modal dialog (`aria-haspopup="dialog"`); WP14's `Dialog` gives focus containment, Escape, focus restore. Initial focus goes to the threshold input.
- Kinds are a native radio group inside `<fieldset>` with `<legend>Alert me when</legend>`; each radio row is at least 44 px on coarse pointers.
- The threshold input has a visible label, `inputMode="decimal"`, 16 px text on phones, `aria-invalid` and `aria-describedby` pointing at the help and the error.
- Status messages use one polite `role="status"` region per surface. After a delete in the dialog or panel, focus moves to that status line (`tabIndex={-1}`), never to `<body>`.
- Rule action buttons carry the full rule in their names ("Pause alert: Price at or below C$250.00 for Evolving Skies Booster Box"). The watchlist bell is "Alerts for {product name}" with an sr-only count.
- Gain and loss in the email use the glyph plus a word ("▼ Down 11.2%"), never colour alone. Every new component test runs axe.

### Design system use

WP14 `Dialog`; WP23 `Button`/`buttonClasses`, `SegmentedControl`, `Skeleton`, `EmptyState`, `ProvenanceLine`, `PageHeader`, `icons.tsx` `WarnIcon`, tokens `text-ink`, `text-ink-soft`, `text-action`, `text-warn-text`, `bg-warn-fill`, `border-line`, `bg-surface`, `bg-surface-alt`, `ring-action`, `accent-action`, `rounded-control`, `rounded-card`, type `text-h2`, `text-h3`, `text-body`, `text-small`, `text-caption`. No raw palette class and no hex in any `.tsx` file. The email cannot use CSS custom properties, so `app/lib/email/emailTheme.ts` holds the token values as hex, checked against `globals.css` by a test, and is the one new entry in `uiConventions.baseline.json` (reason in the PR).

### Performance

- Product page: `AlertButton` (about 1 kB gz; imports only `useAuth`, `useRouter`, `buttonClasses`, `watchProductLoginPath` from the already-loaded `watchlist.ts`, and `next/dynamic`). The dialog, `alerts.ts`, `alertsApi.ts` and `format.ts` load as one lazy chunk on first open (preloaded on hover or focus), well under the 120 kB lazy-chunk budget. No request for signed-out visitors and no request until the dialog opens. The page stays ISR: no `cookies()`, `headers()` or `searchParams`.
- `/portfolio/watchlist`: one extra `GET /api/alerts` (one primary-key range read of at most 50 rules with an embedded product join, one primary-key read of the prefs row). Same dialog chunk on demand.
- `/alerts/unsubscribe`: dynamic (reads `searchParams`), no client JS beyond the shared bundle; a plain HTML form.
- Cron: one RPC that evaluates every active rule with one join per rule on primary keys (`product_daily_stats (day, product_id)`, `fx_daily (day)`), then at most 200 Brevo calls with 5 in flight, each followed by one small RPC. Well inside `maxDuration = 60` and anon's 3 s statement timeout (migration 0009) at the 50-rule cap.
- No charting library, no `/api/public/*` call, no new third-party script on any page.

## Before you start

Read:
- `audits/remediation/01-PRODUCT-DIRECTION.md` (all; binding), `research/data-opportunities.md` §3.11 and §3.14, `research/trust-seo-brand.md` §10.1, §12.2 and §12.3, `research/competitive-landscape.md` §4 item 1.
- Specs: WP34 (Design, steps 1 to 6, 8, 9, 12, 13, 16, Tests 1 and 2), WP25 (Metric definitions, steps 2, 8 to 10, 13, 14), WP21 (steps 2, 11, 14), WP31 (Actions row, steps 11 and 16), WP28 (step 5 types, step 6, `getCachedProductAttributes`), WP24 (steps 2, 3, the `/privacy` page step, methodology structure), WP14 (`Dialog` props), WP23 (Components table, step 24), WP11 (the `/api/revalidate` route for the secret pattern), WP22 (route budgets).
- Code (paths from `frontend/` unless they start with `migrations/`, `tests/` or `scripts/db/`): `app/lib/watchlist.ts`, `app/lib/watchlistApi.ts`, `app/lib/watchlistStore.ts`, `app/lib/server/watchlistRepo.ts`, `app/lib/server/watchlistModel.ts`, `app/api/watchlist/route.ts`, `app/portfolio/watchlist/WatchlistView.tsx`, `app/components/watchlist/WatchlistTable.tsx`, `app/components/watchlist/WatchlistPhoneList.tsx`, `app/components/watchlist/RemoveButton.tsx`, `app/components/watchlist/WatchButton.tsx`, `app/product/[id]/ProductActions.tsx`, `app/product/[id]/page.tsx`, `app/product/[id]/productMeta.ts`, `app/lib/routeAuth.ts`, `app/lib/csrf.ts`, `app/lib/routeSupabase.ts`, `app/lib/supabaseEnv.ts`, `app/lib/logger.ts`, `app/lib/site.ts`, `app/lib/format.ts`, `app/lib/fx.ts`, `app/lib/marketStats.ts`, `app/lib/serverMarketData.ts`, `app/lib/productAttributes.ts` (WP28), `app/api/revalidate/route.ts`, `app/content/disclosures.ts`, `app/content/contact.ts`, `app/content/methodology.ts`, `app/methodology/MethodologyArticle.tsx`, `app/privacy/page.tsx`, `app/account/page.tsx`, `app/components/ui/Dialog.tsx`, `app/components/ui/SegmentedControl.tsx`, `app/components/ui/Button.tsx`, `app/components/ui/icons.tsx`, `app/context/AuthContext.tsx`, `app/context/CurrencyContext.tsx`, `app/globals.css`, `eslint.config.mjs`, `perf-budgets.json`, `.env.example`, `app/__tests__/uiConventions.test.ts` and `uiConventions.baseline.json`. Repo root: `migrations/0038_watchlist.sql`, `migrations/0033_product_daily_stats.sql`, `migrations/0034_fx_daily.sql`, `migrations/0031_user_table_write_limits.sql`, `migrations/0009_db_resource_guards.sql`, `scripts/db/ci_bootstrap.sql`, `tests/test_wp34_watchlist_db.py`, `tests/test_wp34_watchlist_static.py`, `tests/test_migration_volatility.py`, `README.md` (Database section).
- Every call site you will change: `grep -rn "<ProductActions\|watch={<WatchButton\|<WatchlistTable\|<WatchlistPhoneList\|WatchlistViewProps\|<RemoveButton" frontend/app --include=*.tsx --include=*.ts`.

Confirm the starting state (repo root). Each line must print what its comment says; otherwise stop and report the missing package:

```bash
git checkout master && git pull && git checkout -b remediation/wp35-daily-price-alerts

# Migration registry: 0039 is free, 0038 (WP34) exists, nothing after 0038 replaces export_my_data
ls migrations | grep -E '^0039_'                                              # no output
ls migrations/0038_watchlist.sql migrations/0031_*.sql migrations/0033_*.sql migrations/0034_*.sql
grep -ln "FUNCTION public.export_my_data" migrations/*.sql
# expect exactly 0011_export_my_data.sql, 0024_export_my_data_volatile.sql and 0038_watchlist.sql.
# If a file numbered 0040 or above is listed (WP36 merged first and replaced export_my_data), STOP and
# report it: the replay applies files in number order, so 0039's version would be overwritten in CI
# while production keeps whichever was applied last. The owner decides how to reconcile.
grep -n "is_price_fresh\|qty_change_30d_pct\|ask_premium_pct\|ret_7d " migrations/0033_*.sql | head -4   # 4 lines
grep -n "CREATE TABLE IF NOT EXISTS public.fx_daily" migrations/0034_*.sql                                # 1 line
grep -n "FUNCTION public.enforce_owner_row_cap()" migrations/0031_*.sql                                  # 1 line
ls scripts/db/ci_bootstrap.sql scripts/db/replay_migrations.sh tests/test_wp34_watchlist_db.py tests/test_migration_volatility.py
grep -n "vault" scripts/db/ci_bootstrap.sql                                   # no output (this package adds the stand-in)

cd frontend
# WP34
grep -n "export function parseProductIdString\|export function parseProductIdValue\|export function watchProductLoginPath\|export const WATCHLIST_PAGE_PATH" app/lib/watchlist.ts   # 4 lines
grep -n "export async function addWatch" app/lib/server/watchlistRepo.ts      # 1 line
grep -n "export function statsMatchPrice" app/lib/server/watchlistModel.ts   # 1 line
grep -n "export function noteWatched" app/lib/watchlistStore.ts              # 1 line
grep -n "export interface WatchlistViewProps" app/components/watchlist/WatchlistTable.tsx   # 1 line
grep -n "function WatchlistLoaded" app/portfolio/watchlist/WatchlistView.tsx  # 1 line
grep -n "watch={<WatchButton" "app/product/[id]/page.tsx"                     # 1 line
# WP31
grep -n "watch?: ReactNode" "app/product/[id]/ProductActions.tsx"             # 1 line
# WP25
grep -n "export async function getCachedProductStats\|export async function getCachedFxDaily" app/lib/serverMarketData.ts   # 2 lines
grep -n "export function usdToCadOn" app/lib/fx.ts                            # 1 line
# WP24
grep -n "export const FOOTER_DISCLAIMER\|export const TCGPLAYER_TRADEMARK_NOTICE" app/content/disclosures.ts   # 2 lines
grep -n "hello: \"hello@pokefin.ca\"" app/content/contact.ts                  # 1 line
grep -n "METHODOLOGY_VERSION = " app/content/methodology.ts                   # 1 line; record the version (call it V_OLD)
grep -n "<strong>Brevo</strong>" app/privacy/page.tsx                          # 1 line
# WP13 and WP20
grep -n "export function absoluteUrl\|export const NO_INDEX" app/lib/site.ts  # 2 lines
grep -n "export function productPath" "app/product/[id]/productMeta.ts"       # 1 line
grep -n "export function supabaseUrl\|export function supabaseAnonKey" app/lib/supabaseEnv.ts   # 2 lines
grep -n '"types:db"' package.json                                             # 1 line
# WP14 and WP23
ls app/components/ui/Dialog.tsx app/components/ui/SegmentedControl.tsx app/components/ui/Skeleton.tsx app/components/ui/EmptyState.tsx \
   app/components/ui/ProvenanceLine.tsx app/components/ui/icons.tsx test-utils/axe.ts app/__tests__/uiConventions.baseline.json
grep -n "export function formatPercent\|export function formatMoney\|export function formatMonthDay\|export function formatDateOnly" app/lib/format.ts   # 4 lines
grep -n "\-\-pf-ink:\|\-\-pf-ink-soft:\|\-\-pf-action:\|\-\-pf-border:\|\-\-pf-bg:\|\-\-pf-surface:\|\-\-pf-gain-text:\|\-\-pf-loss-text:" app/globals.css   # 8 lines
# WP22, WP26
grep -n '"/portfolio/watchlist": {' perf-budgets.json                         # 1 or 2 lines
grep -n "const PUBLIC_ROUTE_CLIENT_FILES\|const ANON_CLIENT_FORBIDDEN_FILES" eslint.config.mjs   # 2 lines
# Nothing in the tree creates these yet
ls vercel.json ../vercel.json app/api/cron app/lib/email 2>&1 | grep -c "No such file"           # 4

# Soft: WP28. Record the answer; steps 5 and 15 branch on it.
grep -n "export async function getCachedProductAttributes" app/lib/serverMarketData.ts   # WP28 landed: 1 line
```

Two defaults when a soft check fails:
- WP28 absent: `loadAlertContext` sets `msrpUsd` and `msrpCad` to `null` and does not import `getCachedProductAttributes` (step 5 says where). The MSRP suggestion then never appears.
- `globals.css` defines a token as an alias (`var(...)`) instead of a hex value: in step 9 use the hex the alias resolves to and make the theme test resolve one level of `var()` (step 23, test 5 says how).

Tooling:
- Local Postgres for the database tests and the replay (WP21): Docker `postgres:17`, or the PostgreSQL 16 binaries at `/usr/lib/postgresql/16/bin`. Every statement of step 1 was applied twice in a row to PostgreSQL 16.13 on a Supabase-shaped scaffold (WP21's `ci_bootstrap.sql`, the Vault stand-in of step 3, and the tables 0039 reads), `verify_migration.py`'s generated query returned 135 OK rows, and the 29 cases of Tests 1 passed twice in a row against it.
- A Python venv with `requirements.txt` plus `pytest` (WP21 added `psycopg[binary]`).

Baseline (from `frontend/`): `pnpm exec tsc --noEmit` (exit 0), `pnpm lint` (0 errors), `pnpm test --ci` (all pass), `pnpm run test:scripts` (all pass). From the repo root: `python -m pytest tests/ -q`. Record the counts for the PR.

Two phases, like WP25 and WP34. **Phase A** (steps 1 to 27 except 26): open a draft PR titled `[waiting for DB types] WP35: Daily price alerts` and hand the owner Owner actions 1 to 6. `tsc` reports errors only for the `.from("price_alerts")`, `.from("alert_email_prefs")` and `.rpc(...)` calls of the new tables and functions until phase B; that is the only allowed failure. **Phase B** (step 26): regenerate `app/types/database.ts` once 0039 is in production, then finish the PR. The PR also stays in draft until owner decision D4 (the mailing address) is answered: with `MAILING_ADDRESS` still `null` the feature is invisible and sends nothing, which is safe to merge only if the owner says so in the PR thread.

## Implementation steps

### Step 1. `migrations/0039_price_alerts.sql` (new, repo root)

Create the file with exactly this content. Section 9 is 0038's `export_my_data` body with two keys added after `watchlist`.

```sql
-- Migration 0039: daily price alerts by email digest (WP35).
--
-- A signed-in user sets rules such as "tell me when this drops below
-- C$250" or "moves 10% or more in a week". Once a day, a Vercel Cron route
-- (frontend/app/api/cron/alerts/route.ts) evaluates every active rule
-- against the finalised previous UTC day of product_daily_stats (WP25,
-- 0033) and sends each user one digest email through Brevo.
--
-- 1. public.price_alerts: one rule per row, at most 50 per user (WP21's
--    enforce_owner_row_cap, 0031). armed = false after the rule fired; it is
--    re-armed only after the value moves back past the threshold by the
--    hysteresis band (2% of a price threshold, 2 percentage points for the
--    percent kinds), so a value hovering at the threshold cannot send an
--    email every day.
-- 2. public.alert_email_prefs: one row per user with alerts (created by a
--    trigger on the first alert): digest on or off, and the opaque
--    unsubscribe token used by the email's links and its RFC 8058
--    List-Unsubscribe header.
-- 3. public.alert_deliveries: one row per (alert, evaluated day). The
--    primary key is the idempotency key: a day's alert is claimed before the
--    email is sent and marked sent after Brevo accepts it, so a second run
--    of the cron on the same day sends nothing.
-- 4. Privileges and RLS. Owner-only policies with the (SELECT auth.uid())
--    initplan form (0014). authenticated may insert the five rule columns,
--    update only price_alerts.active and alert_email_prefs.digest_enabled,
--    and read and delete its own rules. alert_deliveries has no API access.
--    anon and PUBLIC get nothing on the tables; pokefin_scraper (0032) gets
--    nothing.
-- 5. Cron functions. The web app holds no service-role key (WP21), so the
--    cron route calls these SECURITY DEFINER functions with the anon key,
--    and each one first checks p_token against the Vault secret
--    pokefin_cron_token in constant time (alert_cron_token_ok). EXECUTE is
--    granted to anon for that reason; without the token every call raises
--    42501.
--      get_due_alert_digests(p_day, p_token, p_max_users)
--      record_alert_digest_sent(p_day, p_alert_ids, p_token)
--      release_alert_digest(p_day, p_alert_ids, p_token)
--    Evaluation reads product_daily_stats rows of p_day with is_price_fresh
--    and a price no older than 3 days before p_day: a withheld price (0023)
--    never fires and never re-arms. CAD rules convert at fx_daily of the
--    price's own day; without that row a CAD rule is skipped for the day.
-- 6. unsubscribe_alerts(p_token uuid): anon-executable and idempotent. The
--    token is the authorisation; it turns the digest off, it does not delete
--    rules.
-- 7. export_my_data(): 0038's body plus "price_alerts" (with sent
--    deliveries) and "alert_email" (without the token).
--
-- Idempotent: safe to run twice (WP21 replay_twice). Needs 0031, 0033,
-- 0034, 0038, and the Supabase Vault (vault.decrypted_secrets) at run time,
-- not at creation time (plpgsql bodies resolve tables when called).
--
-- Verification (after apply):
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname IN ('price_alerts','alert_email_prefs','alert_deliveries');   -- 3 rows, all true
--   SELECT has_table_privilege('anon', 'public.price_alerts', 'SELECT'),            -- false
--          has_column_privilege('authenticated', 'public.price_alerts', 'kind', 'UPDATE'),   -- false
--          has_column_privilege('authenticated', 'public.price_alerts', 'active', 'UPDATE'), -- true
--          has_function_privilege('anon', 'public.unsubscribe_alerts(uuid)', 'EXECUTE'),     -- true
--          has_function_privilege('anon', 'public.alert_evaluations(date)', 'EXECUTE');      -- false
--   SELECT public.get_due_alert_digests(current_date - 1, 'wrong', 1);   -- ERROR 42501 forbidden

-- ============================================================
-- 1. Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.price_alerts (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  product_id         bigint NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  kind               text NOT NULL,
  threshold          numeric(12,2) NOT NULL,
  currency           text NOT NULL DEFAULT 'USD',
  active             boolean NOT NULL DEFAULT true,
  armed              boolean NOT NULL DEFAULT true,
  last_fired_day     date,
  last_fired_value   numeric(14,2),
  last_evaluated_day date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_alerts_kind_valid CHECK
    (kind IN ('price_below', 'price_above', 'pct_move_7d', 'ask_below_market', 'supply_drop_30d')),
  CONSTRAINT price_alerts_currency_valid CHECK
    (currency IN ('USD', 'CAD') AND (kind IN ('price_below', 'price_above') OR currency = 'USD')),
  CONSTRAINT price_alerts_threshold_range CHECK (CASE kind
      WHEN 'price_below'      THEN threshold BETWEEN 0.01 AND 1000000
      WHEN 'price_above'      THEN threshold BETWEEN 0.01 AND 1000000
      WHEN 'pct_move_7d'      THEN threshold BETWEEN 3 AND 100
      WHEN 'ask_below_market' THEN threshold BETWEEN 1 AND 90
      WHEN 'supply_drop_30d'  THEN threshold BETWEEN 5 AND 95
    END),
  CONSTRAINT price_alerts_rule_unique UNIQUE (user_id, product_id, kind, threshold, currency)
);

-- price_alerts_rule_unique (leading user_id) serves the user_id foreign key
-- and "my rules"; this one serves the products foreign key and the join to
-- product_daily_stats.
CREATE INDEX IF NOT EXISTS price_alerts_product_id_idx
  ON public.price_alerts (product_id);

CREATE TABLE IF NOT EXISTS public.alert_email_prefs (
  user_id           uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  digest_enabled    boolean NOT NULL DEFAULT true,
  unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(),
  unsubscribed_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_email_prefs_unsubscribe_token_key UNIQUE (unsubscribe_token)
);

CREATE TABLE IF NOT EXISTS public.alert_deliveries (
  alert_id   bigint NOT NULL REFERENCES public.price_alerts (id) ON DELETE CASCADE,
  day        date NOT NULL,
  value      numeric(14,2) NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz,
  CONSTRAINT alert_deliveries_pkey PRIMARY KEY (alert_id, day)
);

-- ============================================================
-- 2. Privileges
-- ============================================================

REVOKE ALL ON public.price_alerts      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.alert_email_prefs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.alert_deliveries  FROM PUBLIC, anon, authenticated;

GRANT SELECT, DELETE ON public.price_alerts TO authenticated;
GRANT INSERT (user_id, product_id, kind, threshold, currency) ON public.price_alerts TO authenticated;
GRANT UPDATE (active) ON public.price_alerts TO authenticated;

GRANT SELECT (user_id, digest_enabled, unsubscribed_at, created_at, updated_at)
  ON public.alert_email_prefs TO authenticated;
GRANT UPDATE (digest_enabled) ON public.alert_email_prefs TO authenticated;

GRANT ALL ON public.price_alerts      TO service_role;
GRANT ALL ON public.alert_email_prefs TO service_role;
GRANT ALL ON public.alert_deliveries  TO service_role;

-- ============================================================
-- 3. Row level security
-- ============================================================

ALTER TABLE public.price_alerts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_email_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_deliveries  ENABLE ROW LEVEL SECURITY;  -- no policies: definer functions only

DROP POLICY IF EXISTS price_alerts_select_own ON public.price_alerts;
CREATE POLICY price_alerts_select_own ON public.price_alerts
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS price_alerts_insert_own ON public.price_alerts;
CREATE POLICY price_alerts_insert_own ON public.price_alerts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS price_alerts_update_own ON public.price_alerts;
CREATE POLICY price_alerts_update_own ON public.price_alerts
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS price_alerts_delete_own ON public.price_alerts;
CREATE POLICY price_alerts_delete_own ON public.price_alerts
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS alert_email_prefs_select_own ON public.alert_email_prefs;
CREATE POLICY alert_email_prefs_select_own ON public.alert_email_prefs
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS alert_email_prefs_update_own ON public.alert_email_prefs;
CREATE POLICY alert_email_prefs_update_own ON public.alert_email_prefs
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================================
-- 4. Triggers
-- ============================================================

-- At most 50 rules per user. The route answers 409 "alerts_full".
DROP TRIGGER IF EXISTS price_alerts_row_cap_trg ON public.price_alerts;
CREATE TRIGGER price_alerts_row_cap_trg
  BEFORE INSERT ON public.price_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_owner_row_cap('user_id', '50');

-- Resuming a paused rule re-arms it.
CREATE OR REPLACE FUNCTION public.price_alerts_before_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.active AND NOT OLD.active THEN
    NEW.armed := true;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.price_alerts_before_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS price_alerts_before_update_trg ON public.price_alerts;
CREATE TRIGGER price_alerts_before_update_trg
  BEFORE UPDATE ON public.price_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.price_alerts_before_update();

-- The first rule creates the user's email preferences (digest on). SECURITY
-- DEFINER because authenticated has no INSERT on alert_email_prefs.
CREATE OR REPLACE FUNCTION public.ensure_alert_email_prefs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.alert_email_prefs (user_id)
  VALUES (NEW.user_id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.ensure_alert_email_prefs() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS price_alerts_ensure_prefs_trg ON public.price_alerts;
CREATE TRIGGER price_alerts_ensure_prefs_trg
  AFTER INSERT ON public.price_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_alert_email_prefs();

-- digest_enabled drives unsubscribed_at; the token never changes.
CREATE OR REPLACE FUNCTION public.alert_email_prefs_before_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.unsubscribe_token := OLD.unsubscribe_token;
  IF NEW.digest_enabled IS DISTINCT FROM OLD.digest_enabled THEN
    NEW.unsubscribed_at := CASE WHEN NEW.digest_enabled THEN NULL ELSE now() END;
  ELSE
    NEW.unsubscribed_at := OLD.unsubscribed_at;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.alert_email_prefs_before_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS alert_email_prefs_before_update_trg ON public.alert_email_prefs;
CREATE TRIGGER alert_email_prefs_before_update_trg
  BEFORE UPDATE ON public.alert_email_prefs
  FOR EACH ROW
  EXECUTE FUNCTION public.alert_email_prefs_before_update();

-- ============================================================
-- 5. Cron token (Vault secret pokefin_cron_token)
-- ============================================================

-- true when p_token equals the Vault secret. Compares SHA-256 digests byte
-- by byte without an early exit, so the time taken does not depend on how
-- much of the token matched. A missing or short secret fails closed.
CREATE OR REPLACE FUNCTION public.alert_cron_token_ok(p_token text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_secret text;
  v_a bytea;
  v_b bytea;
  v_diff integer := 0;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 256 THEN
    RETURN false;
  END IF;
  SELECT s.decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets s
   WHERE s.name = 'pokefin_cron_token'
   LIMIT 1;
  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RETURN false;
  END IF;
  v_a := sha256(convert_to(p_token, 'UTF8'));
  v_b := sha256(convert_to(v_secret, 'UTF8'));
  FOR i IN 0..31 LOOP
    v_diff := v_diff | (get_byte(v_a, i) # get_byte(v_b, i));
  END LOOP;
  RETURN v_diff = 0;
END
$$;
REVOKE ALL ON FUNCTION public.alert_cron_token_ok(text) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 6. Evaluation (internal)
-- ============================================================

-- Every active rule that has a usable value on p_day, with its value and
-- whether it fires or re-arms. Called only by the definer functions below.
--   value: price_below / price_above: the Market Price in the rule's
--          currency, rounded to cents (CAD at fx_daily of the price's day);
--          pct_move_7d: ret_7d; ask_below_market: ask_premium_pct;
--          supply_drop_30d: qty_change_30d_pct; percents rounded to 0.1.
--   fires: price_below value <= T; price_above value >= T;
--          pct_move_7d |value| >= T; the two drop kinds value <= -T.
--   rearms: price_below value >= T x 1.02; price_above value <= T x 0.98;
--           pct_move_7d |value| <= T - 2; the two drop kinds value >= -T + 2.
-- Mirrored by frontend/app/lib/alerts.ts (ALERT_REARM_PRICE_FACTOR,
-- ALERT_REARM_POINTS, ALERT_MAX_PRICE_AGE_DAYS); drift-tested.
CREATE OR REPLACE FUNCTION public.alert_evaluations(p_day date)
RETURNS TABLE (
  alert_id   bigint,
  user_id    uuid,
  product_id bigint,
  kind       text,
  threshold  numeric,
  currency   text,
  armed      boolean,
  value      numeric,
  usd_price  double precision,
  price_day  date,
  usd_to_cad double precision,
  fires      boolean,
  rearms     boolean
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT a.id, a.user_id, a.product_id, a.kind, a.threshold, a.currency, a.armed,
           s.usd_price, s.price_day, fx.usd_to_cad,
           CASE
             WHEN a.kind IN ('price_below', 'price_above') THEN
               CASE a.currency
                 WHEN 'USD' THEN round(s.usd_price::numeric, 2)
                 WHEN 'CAD' THEN round((s.usd_price * fx.usd_to_cad)::numeric, 2)
               END
             WHEN a.kind = 'pct_move_7d'      THEN round(s.ret_7d::numeric, 1)
             WHEN a.kind = 'ask_below_market' THEN round(s.ask_premium_pct::numeric, 1)
             WHEN a.kind = 'supply_drop_30d'  THEN round(s.qty_change_30d_pct::numeric, 1)
           END AS value
      FROM public.price_alerts a
      JOIN public.product_daily_stats s
        ON s.day = p_day AND s.product_id = a.product_id
      LEFT JOIN public.fx_daily fx
        ON fx.day = s.price_day
     WHERE a.active
       AND s.is_price_fresh
       AND s.usd_price IS NOT NULL
       AND s.price_day >= p_day - 3
       AND (a.last_evaluated_day IS NULL OR a.last_evaluated_day <= p_day)
  )
  SELECT b.id, b.user_id, b.product_id, b.kind, b.threshold, b.currency, b.armed,
         b.value, b.usd_price, b.price_day, b.usd_to_cad,
         CASE b.kind
           WHEN 'price_below' THEN b.value <= b.threshold
           WHEN 'price_above' THEN b.value >= b.threshold
           WHEN 'pct_move_7d' THEN abs(b.value) >= b.threshold
           ELSE b.value <= -b.threshold
         END,
         CASE b.kind
           WHEN 'price_below' THEN b.value >= round(b.threshold * 1.02, 2)
           WHEN 'price_above' THEN b.value <= round(b.threshold * 0.98, 2)
           WHEN 'pct_move_7d' THEN abs(b.value) <= b.threshold - 2
           ELSE b.value >= -b.threshold + 2
         END
    FROM base b
   WHERE b.value IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.alert_evaluations(date) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 7. Cron entry points (anon key + Vault token)
-- ============================================================

-- Evaluates p_day (the cron passes yesterday, UTC), re-arms rules that moved
-- back past their band, claims the rules that fire for at most p_max_users
-- users (oldest rule first) and returns their digests:
--   {"day", "stats_rows", "evaluated", "rearmed", "due_users", "truncated",
--    "digests": [{"user_id", "email", "unsubscribe_token",
--                 "alerts": [{"alert_id", "product_id", "kind", "threshold",
--                   "currency", "value", "usd_price", "price_day",
--                   "usd_to_cad", "set_name", "type_name", "type_label",
--                   "variant"}]}]}
-- jsonb, not a row set, so PostgREST's max-rows limit cannot truncate it.
-- Only users with digest_enabled and a confirmed email are claimed. A claim
-- not marked sent within 30 minutes can be claimed again (a crashed run).
CREATE OR REPLACE FUNCTION public.get_due_alert_digests(
  p_day date,
  p_token text,
  p_max_users integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today     date := (now() AT TIME ZONE 'UTC')::date;
  v_stats     integer;
  v_evaluated integer;
  v_rearmed   integer;
  v_due_users integer;
  v_digests   jsonb;
BEGIN
  IF NOT public.alert_cron_token_ok(p_token) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_day IS NULL OR p_day >= v_today OR p_day < v_today - 7 THEN
    RAISE EXCEPTION 'get_due_alert_digests: p_day must be between % and % (UTC), got %',
      v_today - 7, v_today - 1, p_day USING ERRCODE = '22023';
  END IF;
  IF p_max_users IS NULL OR p_max_users < 1 OR p_max_users > 1000 THEN
    RAISE EXCEPTION 'get_due_alert_digests: p_max_users must be 1 to 1000, got %', p_max_users
      USING ERRCODE = '22023';
  END IF;

  -- One evaluation at a time: Vercel can deliver a cron event twice.
  PERFORM pg_advisory_xact_lock(hashtext('pokefin.alert_digests'));

  SELECT count(*) INTO v_stats FROM public.product_daily_stats WHERE day = p_day;

  -- 1. Record the evaluation and re-arm. Applies to every active rule with
  --    a usable value, whether or not its owner currently gets email.
  SELECT count(*) FILTER (WHERE NOT e.armed AND e.rearms) INTO v_rearmed
    FROM public.alert_evaluations(p_day) e;

  UPDATE public.price_alerts a
     SET last_evaluated_day = p_day,
         armed = a.armed OR e.rearms
    FROM public.alert_evaluations(p_day) e
   WHERE a.id = e.alert_id;
  GET DIAGNOSTICS v_evaluated = ROW_COUNT;

  -- 2. Claim what fires and build the digests in one statement.
  WITH due AS (
    SELECT e.*
      FROM public.alert_evaluations(p_day) e
      JOIN public.alert_email_prefs pr ON pr.user_id = e.user_id AND pr.digest_enabled
      JOIN auth.users u ON u.id = e.user_id
                       AND u.email IS NOT NULL
                       AND u.email_confirmed_at IS NOT NULL
     WHERE e.armed AND e.fires
  ),
  chosen AS (
    SELECT d.user_id
      FROM due d
     GROUP BY d.user_id
     ORDER BY min(d.alert_id)
     LIMIT p_max_users
  ),
  claimed AS (
    INSERT INTO public.alert_deliveries AS ad (alert_id, day, value, claimed_at)
    SELECT d.alert_id, p_day, d.value, now()
      FROM due d
      JOIN chosen c ON c.user_id = d.user_id
    ON CONFLICT (alert_id, day) DO UPDATE
      SET value = EXCLUDED.value, claimed_at = EXCLUDED.claimed_at
      WHERE ad.sent_at IS NULL
        AND ad.claimed_at < now() - interval '30 minutes'
    RETURNING ad.alert_id
  ),
  per_user AS (
    SELECT jsonb_build_object(
             'user_id', d.user_id,
             'email', u.email,
             'unsubscribe_token', pr.unsubscribe_token,
             'alerts', jsonb_agg(jsonb_build_object(
               'alert_id', d.alert_id,
               'product_id', d.product_id,
               'kind', d.kind,
               'threshold', d.threshold,
               'currency', d.currency,
               'value', d.value,
               'usd_price', d.usd_price,
               'price_day', d.price_day,
               'usd_to_cad', d.usd_to_cad,
               'set_name', st.name,
               'type_name', pt.name,
               'type_label', pt.label,
               'variant', p.variant
             ) ORDER BY st.name, coalesce(pt.label, pt.name), p.variant NULLS FIRST, d.alert_id)
           ) AS digest,
           d.user_id
      FROM claimed c
      JOIN due d ON d.alert_id = c.alert_id
      JOIN auth.users u ON u.id = d.user_id
      JOIN public.alert_email_prefs pr ON pr.user_id = d.user_id
      JOIN public.products p ON p.id = d.product_id
      LEFT JOIN public.sets st ON st.id = p.set_id
      LEFT JOIN public.product_types pt ON pt.id = p.product_type_id
     GROUP BY d.user_id, u.email, pr.unsubscribe_token
  )
  SELECT (SELECT count(DISTINCT due.user_id) FROM due),
         coalesce((SELECT jsonb_agg(pu.digest ORDER BY pu.user_id) FROM per_user pu), '[]'::jsonb)
    INTO v_due_users, v_digests;

  RETURN jsonb_build_object(
    'day', p_day,
    'stats_rows', v_stats,
    'evaluated', v_evaluated,
    'rearmed', v_rearmed,
    'due_users', v_due_users,
    'truncated', v_due_users > p_max_users,
    'digests', v_digests
  );
END
$$;

-- Marks a user's claimed rules as sent after Brevo accepted the email:
-- the delivery gets sent_at, the rule is disarmed and remembers the value.
-- Returns the number of rules marked; 0 on a repeat call.
CREATE OR REPLACE FUNCTION public.record_alert_digest_sent(
  p_day date,
  p_alert_ids bigint[],
  p_token text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.alert_cron_token_ok(p_token) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_day IS NULL OR p_alert_ids IS NULL OR cardinality(p_alert_ids) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'record_alert_digest_sent: p_day and 1 to 100 alert ids are required'
      USING ERRCODE = '22023';
  END IF;

  WITH sent AS (
    UPDATE public.alert_deliveries d
       SET sent_at = now()
     WHERE d.day = p_day
       AND d.alert_id = ANY (p_alert_ids)
       AND d.sent_at IS NULL
    RETURNING d.alert_id, d.value
  )
  UPDATE public.price_alerts a
     SET armed = false,
         last_fired_day = p_day,
         last_fired_value = s.value
    FROM sent s
   WHERE a.id = s.alert_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

-- Drops unsent claims after Brevo refused the email, so the next run retries.
CREATE OR REPLACE FUNCTION public.release_alert_digest(
  p_day date,
  p_alert_ids bigint[],
  p_token text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.alert_cron_token_ok(p_token) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_day IS NULL OR p_alert_ids IS NULL OR cardinality(p_alert_ids) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'release_alert_digest: p_day and 1 to 100 alert ids are required'
      USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.alert_deliveries d
   WHERE d.day = p_day
     AND d.alert_id = ANY (p_alert_ids)
     AND d.sent_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.get_due_alert_digests(date, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_alert_digest_sent(date, bigint[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_alert_digest(date, bigint[], text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_due_alert_digests(date, text, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.record_alert_digest_sent(date, bigint[], text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.release_alert_digest(date, bigint[], text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_due_alert_digests(date, text, integer) TO anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_alert_digest_sent(date, bigint[], text) TO anon, service_role;
GRANT EXECUTE ON FUNCTION public.release_alert_digest(date, bigint[], text) TO anon, service_role;

-- ============================================================
-- 8. One-click unsubscribe (anon, token-authorised, idempotent)
-- ============================================================

-- 'unsubscribed' the first time, 'already_unsubscribed' after that,
-- 'unknown' for a token that matches nothing (deleted account, typo).
CREATE OR REPLACE FUNCTION public.unsubscribe_alerts(p_token uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  IF p_token IS NULL THEN
    RETURN 'unknown';
  END IF;
  SELECT digest_enabled INTO v_enabled
    FROM public.alert_email_prefs
   WHERE unsubscribe_token = p_token
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'unknown';
  END IF;
  IF NOT v_enabled THEN
    RETURN 'already_unsubscribed';
  END IF;
  UPDATE public.alert_email_prefs
     SET digest_enabled = false
   WHERE unsubscribe_token = p_token;
  RETURN 'unsubscribed';
END
$$;

REVOKE ALL ON FUNCTION public.unsubscribe_alerts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unsubscribe_alerts(uuid) TO anon, authenticated, service_role;

-- ============================================================
-- 9. export_my_data(): 0038's body plus "price_alerts" and "alert_email"
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
    ), '[]'::jsonb),
    'price_alerts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'product_id', a.product_id,
        'kind', a.kind,
        'threshold', a.threshold,
        'currency', a.currency,
        'active', a.active,
        'armed', a.armed,
        'last_fired_day', a.last_fired_day,
        'last_fired_value', a.last_fired_value,
        'last_evaluated_day', a.last_evaluated_day,
        'created_at', a.created_at,
        'deliveries', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'day', d.day,
            'value', d.value,
            'sent_at', d.sent_at
          ) ORDER BY d.day)
          FROM public.alert_deliveries d
          WHERE d.alert_id = a.id AND d.sent_at IS NOT NULL
        ), '[]'::jsonb)
      ) ORDER BY a.created_at, a.id)
      FROM public.price_alerts a WHERE a.user_id = caller
    ), '[]'::jsonb),
    'alert_email', (
      SELECT jsonb_build_object(
        'digest_enabled', e.digest_enabled,
        'unsubscribed_at', e.unsubscribed_at,
        'created_at', e.created_at,
        'updated_at', e.updated_at
      )
      FROM public.alert_email_prefs e WHERE e.user_id = caller
    )
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

1a. Confirm the export function is 0038's plus the two keys and nothing else:

```bash
diff <(sed -n '/^CREATE OR REPLACE FUNCTION public.export_my_data()/,/^\$\$;/p' migrations/0038_watchlist.sql) \
     <(sed -n '/^CREATE OR REPLACE FUNCTION public.export_my_data()/,/^\$\$;/p' migrations/0039_price_alerts.sql)
# expect exactly one hunk, "81c81,115": the line "    ), '[]'::jsonb)" that closes the watchlist key
# becomes "    ), '[]'::jsonb)," followed by the 'price_alerts' and 'alert_email' keys (35 lines in
# total on the right side, 1 on the left). Any other changed or deleted line means a line was mistyped.
```

1b. Check the file with the verifier (repo root):

```bash
python3 verify_migration.py migrations/0039_price_alerts.sql > /tmp/wp35_0039.sql; echo "exit=$?"
# expect exit=1 and exactly four REFUSED lines, all column-level grants, which verify_migration.py does
# not model (the same situation as WP21's 0031 and 0032):
#   ! REFUSED unsupported privilege 'INSERT (USER_ID' ...
#   ! REFUSED unsupported privilege 'UPDATE (ACTIVE)' ...
#   ! REFUSED unsupported privilege 'SELECT (USER_ID' ...
#   ! REFUSED unsupported privilege 'UPDATE (DIGEST_ENABLED)' ...
# plus 10 "-- function" lines, 1 "-- index", 3 "-- rls ... enabled" and 121 "-- privilege" lines.
grep -c "^-- privilege" <(python3 verify_migration.py migrations/0039_price_alerts.sql 2>&1 >/dev/null)   # 121
```

Any other REFUSED line means a statement was changed: fix it. The generated query (`/tmp/wp35_0039.sql`) returned 135 OK rows on the scratch database; attach it to the PR for Owner action 1. Column privileges are checked by Tests 1 instead (`TestAccess`).

1c. Replay (WP21 harness, after step 3 added the Vault stand-in):

```bash
PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh
# expect the last line: OK: <N> files replayed once (replay_once) and twice (replay_twice)
```

Notes on the SQL, so nobody "fixes" it:
- `alert_cron_token_ok`, `get_due_alert_digests`, `record_alert_digest_sent` and `release_alert_digest` are plpgsql on purpose: plpgsql resolves `vault.decrypted_secrets` when called, not when created, so the migration applies on any database. `alert_evaluations` is SQL (validated at creation), which is fine because it reads only public tables and `fx_daily`.
- `sha256()` is the built-in (PostgreSQL 11+), not pgcrypto; nothing here needs the `extensions` schema.
- `get_due_alert_digests` returns `jsonb`, not a row set, so PostgREST's `max-rows` (1000 on Supabase) can never truncate a run.
- The functions are `SECURITY DEFINER` owned by `postgres`, which can read `vault.decrypted_secrets` and `auth.users` on Supabase. Do not change the owner.
- Supabase's default privileges grant `EXECUTE` on new functions to `anon`, `authenticated` and `service_role`; the `REVOKE` lines remove what must not be there. `service_role` keeps the cron functions (the owner can test from the SQL editor's service context) but not the two internal ones.

### Step 2. `frontend/app/lib/alerts.ts` (new): constants, rules, sentences, payloads

Isomorphic: no React, no Supabase, no `server-only`. The dialog chunk, the routes, the cron job and the methodology page import it. `AlertButton` must not import it (bundle).

```ts
import { formatDateOnly, formatMoney, formatMonthDay, formatPercent } from "./format";
import { parseProductIdValue } from "./watchlist";

/**
 * Daily price alerts (WP35): the contract between migration 0039, the routes
 * app/api/alerts/route.ts and app/api/cron/alerts/route.ts, the email and the
 * UI. Constants that mirror 0039 are drift-tested by
 * tests/test_wp35_price_alerts_static.py: change both together and bump
 * METHODOLOGY_VERSION (they are documented on /methodology#alerts).
 */

export const ALERT_KINDS = [
  "price_below",
  "price_above",
  "pct_move_7d",
  "ask_below_market",
  "supply_drop_30d",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export type AlertCurrency = "USD" | "CAD";

/** Equals the cap in 0039's trigger (enforce_owner_row_cap('user_id', '50')). */
export const ALERTS_MAX_PER_USER = 50;
/** Price rules re-arm 2% past the level (0039: T x 1.02 and T x 0.98). */
export const ALERT_REARM_PRICE_FACTOR = 0.02;
/** Percent rules re-arm 2 percentage points past the level (0039: T - 2, -T + 2). */
export const ALERT_REARM_POINTS = 2;
/** A price more than this many days older than the checked day never fires (0039: p_day - 3). */
export const ALERT_MAX_PRICE_AGE_DAYS = 3;
/** Digests per cron run (Brevo free tier: 300 emails a day, shared with other mail). */
export const ALERT_DIGESTS_PER_RUN = 200;

export const ALERTS_API_PATH = "/api/alerts";
export const ALERTS_SECTION_ID = "alerts";
export const ALERTS_MANAGE_PATH = "/portfolio/watchlist#alerts";
export const ALERTS_METHODOLOGY_HREF = "/methodology#alerts";
export const ALERT_UNSUBSCRIBE_PAGE_PATH = "/alerts/unsubscribe";
export const ALERT_UNSUBSCRIBE_API_PATH = "/api/alerts/unsubscribe";
/** Body limit for POST and PATCH /api/alerts. */
export const ALERT_BODY_MAX_BYTES = 512;

export const ALERTS_FULL_CODE = "alerts_full";
export const ALERTS_FULL_MESSAGE = `You have ${ALERTS_MAX_PER_USER} alerts, the most allowed. Delete one to add another.`;
export const ALERTS_UNAVAILABLE_MESSAGE = "Price alerts are not available yet.";
export const ALERT_CADENCE_SENTENCE = "Checked once a day after prices update.";

export type AlertUnit = "money" | "percent";

export interface AlertKindMeta {
  kind: AlertKind;
  /** Radio label in the dialog. */
  label: string;
  unit: AlertUnit;
  /** Inclusive range; equals price_alerts_threshold_range in 0039. */
  min: number;
  max: number;
  /** Input label; money labels get "(C$)" or "(US$)" appended. */
  inputLabel: string;
  /** Suggestion chips for percent kinds; the first is the default. Empty for money kinds. */
  presets: readonly number[];
}

export const ALERT_KIND_META: Readonly<Record<AlertKind, AlertKindMeta>> = {
  price_below: { kind: "price_below", label: "Price falls to or below", unit: "money", min: 0.01, max: 1_000_000, inputLabel: "Price", presets: [] },
  price_above: { kind: "price_above", label: "Price rises to or above", unit: "money", min: 0.01, max: 1_000_000, inputLabel: "Price", presets: [] },
  pct_move_7d: { kind: "pct_move_7d", label: "Price moves up or down within 7 days", unit: "percent", min: 3, max: 100, inputLabel: "Move of at least (%)", presets: [10, 5, 20] },
  ask_below_market: { kind: "ask_below_market", label: "A listing is below Market Price (before shipping)", unit: "percent", min: 1, max: 90, inputLabel: "Below Market Price by at least (%)", presets: [5, 3, 10] },
  supply_drop_30d: { kind: "supply_drop_30d", label: "Units on the market drop over 30 days", unit: "percent", min: 5, max: 95, inputLabel: "Drop of at least (%)", presets: [20, 10, 30] },
};

export function isAlertKind(value: unknown): value is AlertKind {
  return typeof value === "string" && (ALERT_KINDS as readonly string[]).includes(value);
}

export function isPriceKind(kind: AlertKind): boolean {
  return kind === "price_below" || kind === "price_above";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Money keeps cents, percents one decimal (what the email and the database compare). */
export function roundThreshold(kind: AlertKind, value: number): number {
  return ALERT_KIND_META[kind].unit === "money" ? round2(value) : Math.round(value * 10) / 10;
}

/** "551.16" for money, "10" or "7.5" for percent: the text the input shows. */
export function formatThresholdInput(kind: AlertKind, value: number): string {
  const rounded = roundThreshold(kind, value);
  return ALERT_KIND_META[kind].unit === "money" ? rounded.toFixed(2) : String(rounded);
}

/** "1,234.50", "C$ 250", "250 %" -> number; anything else -> null. */
export function parseThresholdText(text: string): number | null {
  const cleaned = text.replace(/[\s,$%]/g, "").replace(/^C/i, "").replace(/^US/i, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** null when valid, else the sentence shown under the input. */
export function thresholdError(kind: AlertKind, value: number): string | null {
  const meta = ALERT_KIND_META[kind];
  if (!Number.isFinite(value)) return "Enter a number.";
  const rounded = roundThreshold(kind, value);
  if (rounded >= meta.min && rounded <= meta.max) return null;
  return meta.unit === "money"
    ? "Enter a price from 0.01 to 1,000,000."
    : `Enter a percentage from ${meta.min} to ${meta.max}.`;
}

export interface AlertRule {
  kind: AlertKind;
  threshold: number;
  currency: AlertCurrency;
}

export interface AlertInput extends AlertRule {
  productId: number;
}

export type AlertParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Body of POST /api/alerts: {"product_id", "kind", "threshold", "currency"}. Percent kinds are stored as USD. */
export function parseAlertInput(raw: unknown): AlertParseResult<AlertInput> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "Invalid body" };
  const body = raw as Record<string, unknown>;
  const productId = parseProductIdValue(body.product_id);
  if (productId === null) return { ok: false, error: "Invalid product_id" };
  if (!isAlertKind(body.kind)) return { ok: false, error: "Invalid kind" };
  const kind = body.kind;
  if (typeof body.threshold !== "number" || !Number.isFinite(body.threshold)) {
    return { ok: false, error: "Enter a number." };
  }
  const problem = thresholdError(kind, body.threshold);
  if (problem) return { ok: false, error: problem };
  let currency: AlertCurrency = "USD";
  if (isPriceKind(kind)) {
    if (body.currency !== "USD" && body.currency !== "CAD") return { ok: false, error: "Invalid currency" };
    currency = body.currency;
  }
  return { ok: true, value: { productId, kind, threshold: roundThreshold(kind, body.threshold), currency } };
}

// ---- Sentences (dialog, panel, email, methodology) ----

/** Headline money carries its currency: "C$250.00" or "$250.00 USD" (01-PRODUCT-DIRECTION.md §3.3). */
export function formatAlertMoney(value: number, currency: AlertCurrency): string {
  return currency === "CAD" ? formatMoney(value, "CAD") : `${formatMoney(value, "USD")} USD`;
}

/** "10%" for whole numbers, "7.5%" otherwise. */
export function formatAlertPercent(value: number): string {
  return formatPercent(value, { decimals: Number.isInteger(value) ? 0 : 1 });
}

/** "Price at or below C$250.00". */
export function describeRule(rule: AlertRule): string {
  const t = rule.threshold;
  switch (rule.kind) {
    case "price_below":
      return `Price at or below ${formatAlertMoney(t, rule.currency)}`;
    case "price_above":
      return `Price at or above ${formatAlertMoney(t, rule.currency)}`;
    case "pct_move_7d":
      return `Moves ${formatAlertPercent(t)} or more in 7 days`;
    case "ask_below_market":
      return `A listing ${formatAlertPercent(t)} or more below Market Price, before shipping`;
    case "supply_drop_30d":
      return `Units on the market down ${formatAlertPercent(t)} or more over 30 days`;
  }
}

/** The value a rule fired at: "Market Price C$244.80", "Down 11.2% over 7 days". */
export function describeValue(kind: AlertKind, value: number, currency: AlertCurrency): string {
  const abs = formatPercent(Math.abs(value));
  switch (kind) {
    case "price_below":
    case "price_above":
      return `Market Price ${formatAlertMoney(value, currency)}`;
    case "pct_move_7d":
      return `${value < 0 ? "Down" : "Up"} ${abs} over 7 days`;
    case "ask_below_market":
      return value < 0
        ? `Lowest listing ${abs} below Market Price, before shipping`
        : `Lowest listing ${abs} above Market Price, before shipping`;
    case "supply_drop_30d":
      return value < 0 ? `Units on the market down ${abs} over 30 days` : `Units on the market up ${abs} over 30 days`;
  }
}

/** When a fired rule can fire again (0039's hysteresis band). */
export function rearmText(rule: AlertRule): string {
  const t = rule.threshold;
  const band = t - ALERT_REARM_POINTS;
  switch (rule.kind) {
    case "price_below":
      return `Can fire again after the price is back at or above ${formatAlertMoney(round2(t * (1 + ALERT_REARM_PRICE_FACTOR)), rule.currency)}.`;
    case "price_above":
      return `Can fire again after the price is back at or below ${formatAlertMoney(round2(t * (1 - ALERT_REARM_PRICE_FACTOR)), rule.currency)}.`;
    case "pct_move_7d":
      return `Can fire again after the 7-day move is back within ${formatAlertPercent(band)}.`;
    case "ask_below_market":
      if (band > 0) return `Can fire again after the lowest listing is back within ${formatAlertPercent(band)} of Market Price.`;
      if (band === 0) return "Can fire again after the lowest listing is back at or above Market Price.";
      return `Can fire again after the lowest listing is ${formatAlertPercent(-band)} or more above Market Price.`;
    case "supply_drop_30d":
      return `Can fire again after the 30-day drop is back under ${formatAlertPercent(band)}.`;
  }
}

/** Same rule as getProductDisplayName (productMeta.ts): "Evolving Skies Booster Box (Pokemon Center)". */
export interface ProductNameParts {
  setName: string | null;
  typeName: string | null;
  typeLabel: string | null;
  variant: string | null;
}

export function productNameFromParts({ setName, typeName, typeLabel, variant }: ProductNameParts): string {
  const label = typeLabel || typeName || "Unknown Product";
  return `${setName ?? "Unknown Set"} ${label}${variant ? ` (${variant})` : ""}`;
}

// ---- Payloads of GET /api/alerts ----

export interface AlertEntry extends AlertRule {
  id: number;
  productId: number;
  productName: string;
  /** false when the product left the active catalog: the rule is never checked. */
  tracked: boolean;
  active: boolean;
  armed: boolean;
  lastFiredDay: string | null;
  lastFiredValue: number | null;
  lastEvaluatedDay: string | null;
  createdAt: string;
}

export interface AlertPrefs {
  /** false until the first rule creates the row (0039 trigger). */
  exists: boolean;
  digestEnabled: boolean;
  unsubscribedAt: string | null;
}

export type AlertPriceStatus = "priced" | "withheld" | "never";

/** What the dialog needs about one product (GET /api/alerts?product_id=). Percents in points. */
export interface AlertContext {
  productId: number;
  name: string;
  priceStatus: AlertPriceStatus;
  usdPrice: number | null;
  priceDay: string | null;
  /** usdPrice at fx_daily of priceDay; null without that rate. */
  cadPrice: number | null;
  change7d: number | null;
  askPremiumPct: number | null;
  supplyChange30dPct: number | null;
  /** WP28; null when not recorded or WP28 absent. Never converted. */
  msrpUsd: number | null;
  msrpCad: number | null;
}

export interface AlertsPayload {
  /** The caller's rules (only this product's when product_id was given), newest first. */
  alerts: AlertEntry[];
  /** All of the caller's rules, for the cap. */
  count: number;
  max: number;
  prefs: AlertPrefs;
  /** The account email the digest goes to. */
  email: string | null;
  /** false while the mailing address (owner decision D4) is not set. */
  available: boolean;
  /** Present only with product_id. null when the product is not in the active catalog. */
  context?: AlertContext | null;
}

export function alertStatusText(entry: AlertEntry): string {
  if (!entry.tracked) return "Not checked: this product is no longer tracked.";
  if (!entry.active) return "Paused";
  if (!entry.armed && entry.lastFiredDay !== null && entry.lastFiredValue !== null) {
    return `Fired ${formatMonthDay(entry.lastFiredDay)}: ${describeValue(entry.kind, entry.lastFiredValue, entry.currency)}. ${rearmText(entry)}`;
  }
  if (entry.lastEvaluatedDay !== null) return `Waiting. Last checked ${formatMonthDay(entry.lastEvaluatedDay)}.`;
  return "Waiting for the first daily check.";
}

// ---- Dialog helpers ----

export interface AlertSuggestion {
  label: string;
  value: number;
}

function priceIn(currency: AlertCurrency, ctx: AlertContext | null): number | null {
  if (!ctx) return null;
  const value = currency === "CAD" ? ctx.cadPrice : ctx.usdPrice;
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

export function suggestionsFor(kind: AlertKind, currency: AlertCurrency, ctx: AlertContext | null): AlertSuggestion[] {
  if (!isPriceKind(kind)) {
    return ALERT_KIND_META[kind].presets.map((value) => ({ label: formatAlertPercent(value), value }));
  }
  const out: AlertSuggestion[] = [];
  const now = priceIn(currency, ctx);
  if (now !== null) {
    const value = round2(kind === "price_below" ? now * 0.9 : now * 1.1);
    out.push({ label: `10% ${kind === "price_below" ? "below" : "above"} now: ${formatAlertMoney(value, currency)}`, value });
  }
  const msrp = ctx ? (currency === "CAD" ? ctx.msrpCad : ctx.msrpUsd) : null;
  if (kind === "price_below" && msrp !== null && msrp > 0 && (now === null || msrp < now)) {
    out.push({
      label: `Back to ${currency === "CAD" ? "Canadian" : "US"} MSRP: ${formatAlertMoney(msrp, currency)}`,
      value: round2(msrp),
    });
  }
  return out;
}

/** The prefilled threshold: the first suggestion, else nothing. */
export function defaultThreshold(kind: AlertKind, currency: AlertCurrency, ctx: AlertContext | null): number | null {
  return suggestionsFor(kind, currency, ctx)[0]?.value ?? null;
}

/** The line under the product name in the dialog. */
export function contextLine(ctx: AlertContext | null): string {
  if (!ctx) return "This product is no longer tracked, so its alerts are not checked.";
  if (ctx.priceStatus === "never") return "This product has not been priced yet.";
  if (ctx.priceStatus === "withheld" || ctx.usdPrice === null || ctx.priceDay === null) {
    return "No current Market Price: the last price is older than 14 days.";
  }
  const usd = formatAlertMoney(ctx.usdPrice, "USD");
  const day = formatMonthDay(ctx.priceDay);
  return ctx.cadPrice !== null
    ? `Market Price ${formatMoney(ctx.cadPrice, "CAD")} (${usd}), ${day}`
    : `Market Price ${usd}, ${day}`;
}

/** "Now: up 3.4% over 7 days." for the selected kind, or null when the value is unknown. */
export function currentValueText(kind: AlertKind, currency: AlertCurrency, ctx: AlertContext | null): string | null {
  if (!ctx || ctx.priceStatus !== "priced") return null;
  switch (kind) {
    case "price_below":
    case "price_above": {
      const now = priceIn(currency, ctx);
      return now === null ? null : `Now: ${describeValue(kind, now, currency)}.`;
    }
    case "pct_move_7d":
      return ctx.change7d === null ? null : `Now: ${describeValue(kind, ctx.change7d, "USD")}.`;
    case "ask_below_market":
      return ctx.askPremiumPct === null ? null : `Now: ${describeValue(kind, ctx.askPremiumPct, "USD")}.`;
    case "supply_drop_30d":
      return ctx.supplyChange30dPct === null ? null : `Now: ${describeValue(kind, ctx.supplyChange30dPct, "USD")}.`;
  }
}

/** Whether the rule would fire on today's values (same comparisons as 0039). */
export function ruleIsTrueNow(rule: AlertRule, ctx: AlertContext | null): boolean {
  if (!ctx || ctx.priceStatus !== "priced") return false;
  const t = rule.threshold;
  switch (rule.kind) {
    case "price_below": {
      const now = priceIn(rule.currency, ctx);
      return now !== null && round2(now) <= t;
    }
    case "price_above": {
      const now = priceIn(rule.currency, ctx);
      return now !== null && round2(now) >= t;
    }
    case "pct_move_7d":
      return ctx.change7d !== null && Math.abs(Math.round(ctx.change7d * 10) / 10) >= t;
    case "ask_below_market":
      return ctx.askPremiumPct !== null && Math.round(ctx.askPremiumPct * 10) / 10 <= -t;
    case "supply_drop_30d":
      return ctx.supplyChange30dPct !== null && Math.round(ctx.supplyChange30dPct * 10) / 10 <= -t;
  }
}

/** "Sep 30, 2026" for the email's as-of line. */
export function alertDayLabel(day: string): string {
  return formatDateOnly(day);
}

// ---- Shape checks for answers that crossed the network ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEntry(value: unknown): value is AlertEntry {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    typeof value.productId === "number" &&
    typeof value.productName === "string" &&
    isAlertKind(value.kind) &&
    typeof value.threshold === "number" &&
    (value.currency === "USD" || value.currency === "CAD") &&
    typeof value.active === "boolean" &&
    typeof value.armed === "boolean"
  );
}

export function isAlertsPayload(value: unknown): value is AlertsPayload {
  return (
    isRecord(value) &&
    Array.isArray(value.alerts) &&
    value.alerts.every(isEntry) &&
    typeof value.count === "number" &&
    typeof value.max === "number" &&
    isRecord(value.prefs) &&
    typeof value.prefs.digestEnabled === "boolean" &&
    typeof value.available === "boolean"
  );
}

/** Rules per product id (watchlist bell counts). */
export function countAlertsByProduct(alerts: readonly AlertEntry[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const alert of alerts) counts[alert.productId] = (counts[alert.productId] ?? 0) + 1;
  return counts;
}
```

If WP23's `formatPercent` has no `decimals` option (Before you start found the export but `tsc` rejects `{ decimals: 0 }`), write `formatAlertPercent` as `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`.

### Step 3. `scripts/db/ci_bootstrap.sql`: the Vault stand-in

Append this block at the end of WP21's file. It stands in for Supabase's `supabase_vault` extension so the replay and the database tests can create and read `pokefin_cron_token`. Production never runs this file.

```sql
-- Supabase Vault stand-in (WP35). Supabase provisions the vault schema and
-- the supabase_vault extension; a plain Postgres has neither. Secrets are
-- stored in clear here: CI only, never production.
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE,
  description text NOT NULL DEFAULT '',
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret, secret AS decrypted_secret, created_at, updated_at
    FROM vault.secrets;
CREATE OR REPLACE FUNCTION vault.create_secret(
  new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '', new_key_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO vault.secrets (secret, name, description)
  VALUES (new_secret, new_name, coalesce(new_description, '')) RETURNING id
$$;
REVOKE ALL ON SCHEMA vault FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault.create_secret(text, text, text, uuid) FROM PUBLIC;
```

Then check the stand-in applies twice (the replay applies the bootstrap once per database, but keep it idempotent like the rest of the file): `psql "$PGSERVER_URL" -X -q -v ON_ERROR_STOP=1 -c 'CREATE DATABASE wp35_boot' && for i in 1 2; do psql "${PGSERVER_URL%/*}/wp35_boot" -X -q -v ON_ERROR_STOP=1 -f scripts/db/ci_bootstrap.sql; done && psql "$PGSERVER_URL" -c 'DROP DATABASE wp35_boot'` exits 0.

### Step 4. `frontend/app/lib/server/anonRpcSupabase.ts` (new): the session-less anon client

```ts
import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import { supabaseAnonKey, supabaseUrl } from "../supabaseEnv";

/**
 * The publishable (anon) key with no session and no cookies, for the two
 * server routes that call token-authorised SECURITY DEFINER functions
 * (WP35): the alert cron (Vault token) and the email unsubscribe
 * (per-user token). Never use it for user tables: RLS and migration 0013
 * deny anon there. Every fetch is uncached.
 */
export function createAnonRpcClient() {
  return createClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}
```

### Step 5. `frontend/app/lib/server/alertsRepo.ts` (new): every `price_alerts` and `alert_email_prefs` query

The only module besides the routes that queries the alert tables. It receives the cookie-backed route client (RLS applies) and filters `user_id` explicitly on every query, as WP34's repo does.

```ts
import "server-only";

import type { createRouteSupabaseClient } from "../routeSupabase";
import { logCaughtError, logSupabaseError } from "../logger";
import { hasCurrentPrice } from "../priceGuard";
import { recordedAtDateKey } from "../format";
import { statsFor } from "../marketStats";
import { usdToCadOn } from "../fx";
import {
  getCachedFxDaily,
  getCachedMarketProductSummaries,
  getCachedProductAttributes,
  getCachedProductStats,
} from "../serverMarketData";
import { getProductDisplayName } from "../../product/[id]/productMeta";
import { statsMatchPrice } from "./watchlistModel";
import {
  isAlertKind,
  productNameFromParts,
  type AlertContext,
  type AlertEntry,
  type AlertInput,
  type AlertPrefs,
} from "../alerts";

type RouteSupabase = Awaited<ReturnType<typeof createRouteSupabaseClient>>;

const ALERT_SELECT =
  "id, product_id, kind, threshold, currency, active, armed, last_fired_day, last_fired_value, last_evaluated_day, created_at, " +
  "products ( active, variant, sets ( name ), product_types ( name, label ) )";
/** Column list, not "*": authenticated may not read unsubscribe_token (0039 column grant). */
const PREFS_SELECT = "digest_enabled, unsubscribed_at";
/** Above the cap: concurrent inserts can pass it (0031's documented race). */
const ALERTS_LIST_LIMIT = 100;

interface AlertRow {
  id: number;
  product_id: number;
  kind: string;
  threshold: number | string;
  currency: string;
  active: boolean;
  armed: boolean;
  last_fired_day: string | null;
  last_fired_value: number | string | null;
  last_evaluated_day: string | null;
  created_at: string;
  products: {
    active: boolean | null;
    variant: string | null;
    sets: { name: string } | null;
    product_types: { name: string; label: string | null } | null;
  } | null;
}

export const DEFAULT_ALERT_PREFS: AlertPrefs = { exists: false, digestEnabled: true, unsubscribedAt: null };

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** null for a row this code cannot describe (it is skipped, never shown wrong). */
export function toAlertEntry(row: AlertRow): AlertEntry | null {
  const threshold = num(row.threshold);
  if (!isAlertKind(row.kind) || (row.currency !== "USD" && row.currency !== "CAD") || threshold === null) return null;
  const product = row.products;
  return {
    id: row.id,
    productId: row.product_id,
    productName: productNameFromParts({
      setName: product?.sets?.name ?? null,
      typeName: product?.product_types?.name ?? null,
      typeLabel: product?.product_types?.label ?? null,
      variant: product?.variant ?? null,
    }),
    tracked: product?.active === true,
    kind: row.kind,
    threshold,
    currency: row.currency,
    active: row.active,
    armed: row.armed,
    lastFiredDay: row.last_fired_day,
    lastFiredValue: num(row.last_fired_value),
    lastEvaluatedDay: row.last_evaluated_day,
    createdAt: row.created_at,
  };
}

/** The caller's rules, newest first. null on a read error. */
export async function listAlerts(supabase: RouteSupabase, userId: string): Promise<AlertEntry[] | null> {
  const { data, error } = await supabase
    .from("price_alerts")
    .select(ALERT_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(ALERTS_LIST_LIMIT);
  if (error) {
    logSupabaseError("alerts_list_failed", error);
    return null;
  }
  return ((data ?? []) as unknown as AlertRow[])
    .map(toAlertEntry)
    .filter((entry): entry is AlertEntry => entry !== null);
}

/** The caller's email preferences; the defaults when no row exists yet. null on a read error. */
export async function readAlertPrefs(supabase: RouteSupabase, userId: string): Promise<AlertPrefs | null> {
  const { data, error } = await supabase.from("alert_email_prefs").select(PREFS_SELECT).eq("user_id", userId).maybeSingle();
  if (error) {
    logSupabaseError("alerts_prefs_failed", error);
    return null;
  }
  if (!data) return DEFAULT_ALERT_PREFS;
  return { exists: true, digestEnabled: data.digest_enabled === true, unsubscribedAt: data.unsubscribed_at ?? null };
}

export type CreateAlertResult =
  | { status: "created"; id: number }
  | { status: "exists" | "full" | "not_found" | "invalid" | "error" };

async function sameRuleExists(supabase: RouteSupabase, userId: string, input: AlertInput): Promise<boolean> {
  const { data, error } = await supabase
    .from("price_alerts")
    .select("id")
    .eq("user_id", userId)
    .eq("product_id", input.productId)
    .eq("kind", input.kind)
    .eq("threshold", input.threshold)
    .eq("currency", input.currency)
    .limit(1);
  return !error && (data?.length ?? 0) > 0;
}

/**
 * Insert one rule. 23505: the same rule exists (success for the caller).
 * 23503: no such product. 23514 is either the 50-rule cap (message "...row
 * limit reached") or a CHECK; the cap trigger fires before the unique check,
 * so a duplicate at the cap also raises it: re-check before answering "full".
 */
export async function createAlert(supabase: RouteSupabase, userId: string, input: AlertInput): Promise<CreateAlertResult> {
  const { data, error } = await supabase
    .from("price_alerts")
    .insert({
      user_id: userId,
      product_id: input.productId,
      kind: input.kind,
      threshold: input.threshold,
      currency: input.currency,
    })
    .select("id")
    .single();
  if (!error && data) return { status: "created", id: data.id as number };
  if (error?.code === "23505") return { status: "exists" };
  if (error?.code === "23503") return { status: "not_found" };
  if (error?.code === "23514") {
    if (!String(error.message ?? "").includes("row limit")) return { status: "invalid" };
    return (await sameRuleExists(supabase, userId, input)) ? { status: "exists" } : { status: "full" };
  }
  logSupabaseError("alerts_insert_failed", error);
  return { status: "error" };
}

/** Pause or resume (0039's trigger re-arms on resume). */
export async function setAlertActive(
  supabase: RouteSupabase,
  userId: string,
  id: number,
  active: boolean
): Promise<"updated" | "not_found" | "error"> {
  const { data, error } = await supabase
    .from("price_alerts")
    .update({ active })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error) {
    logSupabaseError("alerts_update_failed", error);
    return "error";
  }
  return (data?.length ?? 0) > 0 ? "updated" : "not_found";
}

export async function setDigestEnabled(
  supabase: RouteSupabase,
  userId: string,
  enabled: boolean
): Promise<AlertPrefs | "no_prefs" | "error"> {
  const { data, error } = await supabase
    .from("alert_email_prefs")
    .update({ digest_enabled: enabled })
    .eq("user_id", userId)
    .select(PREFS_SELECT);
  if (error) {
    logSupabaseError("alerts_prefs_update_failed", error);
    return "error";
  }
  const row = data?.[0];
  if (!row) return "no_prefs";
  return { exists: true, digestEnabled: row.digest_enabled === true, unsubscribedAt: row.unsubscribed_at ?? null };
}

export async function deleteAlert(
  supabase: RouteSupabase,
  userId: string,
  id: number
): Promise<"deleted" | "absent" | "error"> {
  const { data, error } = await supabase.from("price_alerts").delete().eq("id", id).eq("user_id", userId).select("id");
  if (error) {
    logSupabaseError("alerts_delete_failed", error);
    return "error";
  }
  return (data?.length ?? 0) > 0 ? "deleted" : "absent";
}

/**
 * What the dialog shows about one product: the guarded price (0023), its CAD
 * value at the rate of the price's day (the rate the evaluation uses), the
 * current values of the percent kinds when the statistics describe the shown
 * price (WP34's statsMatchPrice), and WP28's MSRPs. null when the product is
 * not in the active catalog. Throws when the catalog cannot be read.
 */
export async function loadAlertContext(productId: number): Promise<AlertContext | null> {
  const [products, stats, fx, attributes] = await Promise.all([
    getCachedMarketProductSummaries(),
    getCachedProductStats(),
    getCachedFxDaily(),
    getCachedProductAttributes(),
  ]);
  const product = products.find((p) => p.id === productId);
  if (!product) return null;

  const usd =
    hasCurrentPrice(product) && typeof product.usd_price === "number" && Number.isFinite(product.usd_price)
      ? product.usd_price
      : null;
  const priceDay = recordedAtDateKey(product.price_recorded_at ?? null);
  const s = statsFor(stats, productId);
  const match = usd !== null && priceDay !== null && statsMatchPrice(s, priceDay, usd);
  const attrs = attributes.byProductId[productId] ?? null;

  return {
    productId,
    name: getProductDisplayName(product),
    priceStatus: usd !== null ? "priced" : priceDay !== null ? "withheld" : "never",
    usdPrice: usd,
    priceDay,
    cadPrice: usd !== null && priceDay !== null ? usdToCadOn(fx, priceDay, usd) : null,
    change7d: match && s ? num(s.ret_7d) : null,
    askPremiumPct: match && s ? num(s.ask_premium_pct) : null,
    supplyChange30dPct: usd !== null && s ? num(s.qty_change_30d_pct) : null,
    msrpUsd: num(attrs?.msrp_usd ?? null),
    msrpCad: num(attrs?.msrp_cad ?? null),
  };
}

export function logAlertContextFailure(error: unknown): void {
  logCaughtError("alerts_context_failed", error);
}
```

WP28 absent (Before you start): remove `getCachedProductAttributes` from the import and from `Promise.all` (three entries, `const [products, stats, fx]`), delete the `attrs` line and write `msrpUsd: null, msrpCad: null,`. Note it in the PR.

If `getCachedMarketProductSummaries` returns a value other than an array of `Product` with `price_recorded_at` (WP34 step 3 uses it the same way), follow WP34's usage. If the generated types (phase B) type the embedded `products` as an array, keep the `as unknown as AlertRow[]` cast: the select string guarantees one object per row because `product_id` is a many-to-one foreign key.

### Step 6. `frontend/app/lib/server/alertsConfig.ts` (new) and `frontend/app/api/alerts/route.ts` (new)

6a. `alertsConfig.ts`:

```ts
import "server-only";

import { MAILING_ADDRESS } from "../../content/disclosures";

/** Alerts are offered only once the email footer can carry a postal address (CASL, owner decision D4). */
export function alertsAvailable(): boolean {
  return typeof MAILING_ADDRESS === "string" && MAILING_ADDRESS.trim().length > 0;
}
```

6b. `app/api/alerts/route.ts`. Same shape as WP34's route: gates first, then the cookie client, `requireRouteUser`, then the repo; every response through `jsonNoStore` except the 403 and 413 answers from `csrf.ts`. No `dynamic` or `runtime` export.

```ts
import { NextRequest } from "next/server";
import { createRouteSupabaseClient } from "../../lib/routeSupabase";
import { rejectIfBodyTooLarge, rejectIfCsrfFails, rejectIfNotAppRequest } from "../../lib/csrf";
import { jsonNoStore, requireRouteUser } from "../../lib/routeAuth";
import { logCaughtError } from "../../lib/logger";
import { parseProductIdString, parseProductIdValue } from "../../lib/watchlist";
import {
  ALERTS_FULL_CODE,
  ALERTS_FULL_MESSAGE,
  ALERTS_MAX_PER_USER,
  ALERTS_UNAVAILABLE_MESSAGE,
  ALERT_BODY_MAX_BYTES,
  parseAlertInput,
  type AlertsPayload,
} from "../../lib/alerts";
import { alertsAvailable } from "../../lib/server/alertsConfig";
import {
  createAlert,
  deleteAlert,
  listAlerts,
  loadAlertContext,
  logAlertContextFailure,
  readAlertPrefs,
  setAlertActive,
  setDigestEnabled,
} from "../../lib/server/alertsRepo";
import { addWatch } from "../../lib/server/watchlistRepo";

const LOAD_FAILED = "Your alerts could not be loaded. Please try again.";
const SAVE_FAILED = "Could not save your alert. Please try again.";

/**
 * GET /api/alerts                  the caller's rules, prefs and email
 * GET /api/alerts?product_id=42    the same, rules filtered to the product, plus its context
 */
export async function GET(req: NextRequest) {
  const forbidden = rejectIfNotAppRequest(req);
  if (forbidden) return forbidden;

  const rawProduct = req.nextUrl.searchParams.get("product_id");
  const productId = rawProduct === null ? null : parseProductIdString(rawProduct);
  if (rawProduct !== null && productId === null) return jsonNoStore({ error: "Invalid product_id" }, 400);

  try {
    const supabase = await createRouteSupabaseClient();
    const auth = await requireRouteUser(supabase);
    if (auth.response) return auth.response;

    const [alerts, prefs, context] = await Promise.all([
      listAlerts(supabase, auth.user.id),
      readAlertPrefs(supabase, auth.user.id),
      productId === null
        ? Promise.resolve(undefined)
        : loadAlertContext(productId).catch((error: unknown) => {
            logAlertContextFailure(error);
            return "failed" as const;
          }),
    ]);
    if (alerts === null || prefs === null || context === "failed") return jsonNoStore({ error: LOAD_FAILED }, 500);

    const payload: AlertsPayload = {
      alerts: productId === null ? alerts : alerts.filter((alert) => alert.productId === productId),
      count: alerts.length,
      max: ALERTS_MAX_PER_USER,
      prefs,
      email: auth.user.email ?? null,
      available: alertsAvailable(),
      ...(productId === null ? {} : { context: context ?? null }),
    };
    return jsonNoStore(payload);
  } catch (error) {
    logCaughtError("alerts_get_failed", error);
    return jsonNoStore({ error: LOAD_FAILED }, 500);
  }
}

/**
 * Body {"product_id", "kind", "threshold", "currency"}. 201 created (also
 * watches the product), 200 exists, 400 invalid, 404 unknown product,
 * 409 full, 503 while alerts are unavailable.
 */
export async function POST(req: NextRequest) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, ALERT_BODY_MAX_BYTES);
  if (tooLarge) return tooLarge;
  if (!alertsAvailable()) return jsonNoStore({ error: ALERTS_UNAVAILABLE_MESSAGE }, 503);

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
    const parsed = parseAlertInput(raw);
    if (!parsed.ok) return jsonNoStore({ error: parsed.error }, 400);

    const result = await createAlert(supabase, auth.user.id, parsed.value);
    switch (result.status) {
      case "created": {
        const watch = await addWatch(supabase, auth.user.id, parsed.value.productId);
        const watched = watch === "added" ? "added" : watch === "exists" ? "exists" : "skipped";
        return jsonNoStore({ status: "created", id: result.id, watched }, 201);
      }
      case "exists":
        return jsonNoStore({ status: "exists", watched: "skipped" });
      case "not_found":
        return jsonNoStore({ error: "Product not found" }, 404);
      case "full":
        return jsonNoStore({ error: ALERTS_FULL_MESSAGE, code: ALERTS_FULL_CODE }, 409);
      case "invalid":
        return jsonNoStore({ error: "This alert is not valid." }, 400);
      default:
        return jsonNoStore({ error: SAVE_FAILED }, 500);
    }
  } catch (error) {
    logCaughtError("alerts_post_failed", error);
    return jsonNoStore({ error: SAVE_FAILED }, 500);
  }
}

type PatchBody = { target: "alert"; id: number; active: boolean } | { target: "digest"; enabled: boolean };

function parsePatch(raw: unknown): PatchBody | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const keys = Object.keys(body).sort().join(",");
  if (keys === "active,id") {
    const id = parseProductIdValue(body.id); // a positive safe integer, the same rule as product ids
    return id !== null && typeof body.active === "boolean" ? { target: "alert", id, active: body.active } : null;
  }
  if (keys === "digest_enabled") {
    return typeof body.digest_enabled === "boolean" ? { target: "digest", enabled: body.digest_enabled } : null;
  }
  return null;
}

/** Body {"id": 12, "active": false} (pause or resume) or {"digest_enabled": true}. */
export async function PATCH(req: NextRequest) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, ALERT_BODY_MAX_BYTES);
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
    const patch = parsePatch(raw);
    if (patch === null) return jsonNoStore({ error: "Invalid body" }, 400);

    if (patch.target === "alert") {
      const result = await setAlertActive(supabase, auth.user.id, patch.id, patch.active);
      if (result === "not_found") return jsonNoStore({ error: "Alert not found" }, 404);
      if (result === "error") return jsonNoStore({ error: SAVE_FAILED }, 500);
      return jsonNoStore({ status: "updated" });
    }
    const prefs = await setDigestEnabled(supabase, auth.user.id, patch.enabled);
    if (prefs === "no_prefs") return jsonNoStore({ error: "Set an alert first." }, 404);
    if (prefs === "error") return jsonNoStore({ error: SAVE_FAILED }, 500);
    return jsonNoStore({ status: "updated", prefs });
  } catch (error) {
    logCaughtError("alerts_patch_failed", error);
    return jsonNoStore({ error: SAVE_FAILED }, 500);
  }
}

/** DELETE /api/alerts?id=12. 200 {status: "deleted" | "absent"}. */
export async function DELETE(req: NextRequest) {
  const csrf = rejectIfCsrfFails(req);
  if (csrf) return csrf;
  const tooLarge = rejectIfBodyTooLarge(req, 1024);
  if (tooLarge) return tooLarge;

  const id = parseProductIdString(req.nextUrl.searchParams.get("id"));
  if (id === null) return jsonNoStore({ error: "Invalid id" }, 400);

  try {
    const supabase = await createRouteSupabaseClient();
    const auth = await requireRouteUser(supabase);
    if (auth.response) return auth.response;
    const result = await deleteAlert(supabase, auth.user.id, id);
    if (result === "error") return jsonNoStore({ error: SAVE_FAILED }, 500);
    return jsonNoStore({ status: result });
  } catch (error) {
    logCaughtError("alerts_delete_failed", error);
    return jsonNoStore({ error: SAVE_FAILED }, 500);
  }
}
```

`parseProductIdValue` and `parseProductIdString` are WP34's positive-integer parsers; they are reused for alert ids on purpose (same identity column type). `/api/alerts` falls in the proxy's per-IP "general" bucket (60 a minute); do not change `rateLimit.ts`. `PROTECTED_PATTERNS` in `proxy.ts` does not match `/api/alerts`, so an anonymous call gets this route's JSON 401.

### Step 7. `frontend/app/lib/alertsApi.ts` (new): the browser client

No `"use client"`, no Supabase import.

```ts
import {
  ALERTS_API_PATH,
  isAlertsPayload,
  type AlertInput,
  type AlertPrefs,
  type AlertsPayload,
} from "./alerts";

/**
 * Browser side of app/api/alerts/route.ts (WP35). price_alerts and
 * alert_email_prefs are reachable only through that route; the browser
 * Supabase client is anonymous and must never query them.
 */

const APP_HEADER = { "x-pokefin-request": "1" } as const;
const JSON_HEADERS = { "Content-Type": "application/json", ...APP_HEADER } as const;

export const ALERTS_LOAD_FAILED = "Your alerts could not be loaded. Please try again.";
const SAVE_FAILED = "Could not save your alert. Please try again.";
const NETWORK_ERROR = "Network error. Check your connection and try again.";

export class AlertsApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AlertsApiError";
    this.status = status;
  }
}

export type AlertWriteFailure = { ok: false; message: string; code: string | null; status: number };
export type CreateAlertResult =
  | { ok: true; status: "created" | "exists"; watched: "added" | "exists" | "skipped" }
  | AlertWriteFailure;
export type AlertUpdateResult = { ok: true; prefs: AlertPrefs | null } | AlertWriteFailure;

async function readError(res: Response, fallback: string): Promise<{ message: string; code: string | null }> {
  if (res.status === 401) return { message: "Your session has expired. Please sign in again.", code: null };
  if (res.status === 429) return { message: "Too many requests. Please wait a minute and try again.", code: null };
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      const { error, code } = body as { error?: unknown; code?: unknown };
      return { message: typeof error === "string" ? error : fallback, code: typeof code === "string" ? code : null };
    }
  } catch {
    // Not JSON: fall back.
  }
  return { message: fallback, code: null };
}

/** Throws AlertsApiError on any non-2xx or bad body, and the fetch error on network failure or abort. */
export async function fetchAlerts({
  productId,
  signal,
}: { productId?: number; signal?: AbortSignal } = {}): Promise<AlertsPayload> {
  const url = productId === undefined ? ALERTS_API_PATH : `${ALERTS_API_PATH}?product_id=${productId}`;
  const res = await fetch(url, { method: "GET", headers: APP_HEADER, credentials: "same-origin", cache: "no-store", signal });
  if (!res.ok) throw new AlertsApiError((await readError(res, ALERTS_LOAD_FAILED)).message, res.status);
  const body: unknown = await res.json();
  if (!isAlertsPayload(body)) throw new AlertsApiError(ALERTS_LOAD_FAILED, 500);
  return body;
}

async function send(url: string, init: RequestInit): Promise<{ ok: true; body: Record<string, unknown> } | AlertWriteFailure> {
  try {
    const res = await fetch(url, { ...init, credentials: "same-origin" });
    if (!res.ok) {
      const { message, code } = await readError(res, SAVE_FAILED);
      return { ok: false, message, code, status: res.status };
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: true, body };
  } catch {
    return { ok: false, message: NETWORK_ERROR, code: null, status: 0 };
  }
}

/** Never throws. */
export async function createAlert(input: AlertInput): Promise<CreateAlertResult> {
  const result = await send(ALERTS_API_PATH, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      product_id: input.productId,
      kind: input.kind,
      threshold: input.threshold,
      currency: input.currency,
    }),
  });
  if (!result.ok) return result;
  const watched = result.body.watched;
  return {
    ok: true,
    status: result.body.status === "exists" ? "exists" : "created",
    watched: watched === "added" || watched === "exists" ? watched : "skipped",
  };
}

/** Never throws. */
export async function setAlertActive(id: number, active: boolean): Promise<AlertUpdateResult> {
  const result = await send(ALERTS_API_PATH, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ id, active }) });
  return result.ok ? { ok: true, prefs: null } : result;
}

/** Never throws. */
export async function setAlertDigest(enabled: boolean): Promise<AlertUpdateResult> {
  const result = await send(ALERTS_API_PATH, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ digest_enabled: enabled }),
  });
  return result.ok ? { ok: true, prefs: (result.body.prefs as AlertPrefs | undefined) ?? null } : result;
}

/** Never throws. Deleting a rule that is already gone is success. */
export async function deleteAlert(id: number): Promise<AlertUpdateResult> {
  const result = await send(`${ALERTS_API_PATH}?id=${id}`, { method: "DELETE", headers: APP_HEADER });
  return result.ok ? { ok: true, prefs: null } : result;
}
```

### Step 8. `frontend/app/content/disclosures.ts` (WP24): sender identity and the mailing address

Append below `PROVENANCE_SENTENCE`:

```ts
/**
 * Owner decision D4: the postal address printed in every email Pokéfin sends
 * (Canada's anti-spam law requires the sender's mailing address). A PO box or
 * a virtual mailbox is fine. While null, price alerts are hidden and the
 * alert cron sends nothing (WP35, app/lib/server/alertsConfig.ts).
 * Example: "PO Box 123, Station A, Toronto ON M5W 1A2, Canada".
 */
export const MAILING_ADDRESS: string | null = null;

/** The From line of alert emails. pokefin.ca must be authenticated in Brevo (SPF, DKIM, DMARC). */
export const ALERT_EMAIL_SENDER = { name: "Pokéfin alerts", email: "alerts@pokefin.ca" } as const;

/** Why the recipient gets the email (CASL: identify the reason and the sender). */
export const ALERT_EMAIL_REASON = "You get this email because you set price alerts on Pokéfin.";
```

When the owner answers D4, set `MAILING_ADDRESS` here and nowhere else.

### Step 9. `frontend/app/lib/email/emailTheme.ts` (new)

```ts
/**
 * Colours for HTML email (WP35). Email clients ignore CSS custom properties,
 * so these are the hex values of the globals.css tokens with the same role;
 * app/lib/email/__tests__/emailTheme.test.ts fails when they drift. This file
 * is the one allowed hex entry for email in uiConventions.baseline.json.
 */
export const EMAIL_THEME = {
  ink: "#0f172a", // --pf-ink
  inkSoft: "#475569", // --pf-ink-soft
  action: "#2563eb", // --pf-action
  border: "#e2e8f0", // --pf-border
  page: "#f8fafc", // --pf-bg
  surface: "#ffffff", // --pf-surface
  gainText: "#047857", // --pf-gain-text
  lossText: "#be123c", // --pf-loss-text
} as const;

/** The token each colour mirrors, for the drift test. */
export const EMAIL_THEME_TOKENS: Readonly<Record<keyof typeof EMAIL_THEME, string>> = {
  ink: "--pf-ink",
  inkSoft: "--pf-ink-soft",
  action: "--pf-action",
  border: "--pf-border",
  page: "--pf-bg",
  surface: "--pf-surface",
  gainText: "--pf-gain-text",
  lossText: "--pf-loss-text",
};

/** Geist is not available in mail clients; the system stack is the closest match. */
export const EMAIL_FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
```

If Before you start showed a different value for a token in `globals.css`, use the `globals.css` value here.

### Step 10. `frontend/app/lib/server/dueDigests.ts` (new): the shape of `get_due_alert_digests`

```ts
import "server-only";

import { isAlertKind, type AlertCurrency, type AlertKind } from "../alerts";

/** One fired rule as 0039's get_due_alert_digests returns it. */
export interface DueAlert {
  alert_id: number;
  product_id: number;
  kind: AlertKind;
  threshold: number;
  currency: AlertCurrency;
  /** The compared value: money in the rule's currency, or percent points. */
  value: number;
  usd_price: number;
  /** The TCGplayer day the price describes. */
  price_day: string;
  usd_to_cad: number | null;
  set_name: string | null;
  type_name: string | null;
  type_label: string | null;
  variant: string | null;
}

export interface DueDigest {
  user_id: string;
  email: string;
  unsubscribe_token: string;
  alerts: DueAlert[];
}

export interface DueDigestsResult {
  day: string;
  stats_rows: number;
  evaluated: number;
  rearmed: number;
  due_users: number;
  truncated: boolean;
  digests: DueDigest[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseAlert(value: unknown): DueAlert | null {
  if (!isRecord(value) || !isAlertKind(value.kind)) return null;
  const alertId = num(value.alert_id);
  const productId = num(value.product_id);
  const threshold = num(value.threshold);
  const compared = num(value.value);
  const usd = num(value.usd_price);
  const day = text(value.price_day);
  const currency = value.currency;
  if (alertId === null || productId === null || threshold === null || compared === null || usd === null) return null;
  if (day === null || !DAY_RE.test(day) || (currency !== "USD" && currency !== "CAD")) return null;
  return {
    alert_id: alertId,
    product_id: productId,
    kind: value.kind,
    threshold,
    currency,
    value: compared,
    usd_price: usd,
    price_day: day,
    usd_to_cad: num(value.usd_to_cad),
    set_name: text(value.set_name),
    type_name: text(value.type_name),
    type_label: text(value.type_label),
    variant: text(value.variant),
  };
}

function parseDigest(value: unknown): DueDigest | null {
  if (!isRecord(value) || !Array.isArray(value.alerts)) return null;
  const email = text(value.email);
  const token = text(value.unsubscribe_token);
  const userId = text(value.user_id);
  if (email === null || !email.includes("@") || token === null || !UUID_RE.test(token) || userId === null) return null;
  const alerts = value.alerts.map(parseAlert).filter((a): a is DueAlert => a !== null);
  return alerts.length > 0 ? { user_id: userId, email, unsubscribe_token: token, alerts } : null;
}

/**
 * Validates the jsonb document. A malformed digest is dropped (its claims
 * stay unsent and the rules stay armed, so they fire on a later day); a
 * malformed document returns null and the run fails loudly.
 */
export function parseDueDigests(value: unknown): DueDigestsResult | null {
  if (!isRecord(value) || typeof value.day !== "string" || !DAY_RE.test(value.day) || !Array.isArray(value.digests)) {
    return null;
  }
  return {
    day: value.day,
    stats_rows: num(value.stats_rows) ?? 0,
    evaluated: num(value.evaluated) ?? 0,
    rearmed: num(value.rearmed) ?? 0,
    due_users: num(value.due_users) ?? 0,
    truncated: value.truncated === true,
    digests: value.digests.map(parseDigest).filter((d): d is DueDigest => d !== null),
  };
}

/** Yesterday in UTC, "YYYY-MM-DD": the day the 11:05 UTC run evaluates (WP25 finalises it at 00:30). */
export function alertEvaluationDay(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)).toISOString().slice(0, 10);
}
```

### Step 11. `frontend/app/lib/email/alertDigest.ts` (new): the digest email

```ts
import "server-only";

import { ALERT_EMAIL_REASON, FOOTER_DISCLAIMER, TCGPLAYER_TRADEMARK_NOTICE } from "../../content/disclosures";
import { CONTACT_EMAILS } from "../../content/contact";
import { absoluteUrl } from "../site";
import { formatDateOnly, formatMonthDay } from "../format";
import { productPath } from "../../product/[id]/productMeta";
import {
  ALERTS_MANAGE_PATH,
  ALERT_UNSUBSCRIBE_API_PATH,
  ALERT_UNSUBSCRIBE_PAGE_PATH,
  describeRule,
  describeValue,
  formatAlertMoney,
  isPriceKind,
  productNameFromParts,
} from "../alerts";
import type { DueAlert, DueDigest } from "../server/dueDigests";
import { EMAIL_FONT_STACK, EMAIL_THEME as C } from "./emailTheme";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

export interface RenderDigestInput {
  digest: DueDigest;
  /** The evaluated UTC day, "YYYY-MM-DD". */
  day: string;
  /** Owner decision D4 (disclosures.ts MAILING_ADDRESS), never null here. */
  mailingAddress: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface DigestItem {
  name: string;
  url: string;
  rule: string;
  /** "▼ Down 11.2% over 7 days (USD Market Price)" */
  result: string;
  direction: "up" | "down" | null;
  asOf: string;
}

function itemFor(alert: DueAlert): DigestItem {
  const name = productNameFromParts({
    setName: alert.set_name,
    typeName: alert.type_name,
    typeLabel: alert.type_label,
    variant: alert.variant,
  });
  let detail: string | null = null;
  if (isPriceKind(alert.kind) && alert.currency === "CAD") {
    detail = `${formatAlertMoney(alert.usd_price, "USD")} at the Bank of Canada rate of ${formatMonthDay(alert.price_day)}`;
  } else if (alert.kind === "pct_move_7d") {
    detail = "USD Market Price";
  }
  const direction = alert.kind === "pct_move_7d" ? (alert.value < 0 ? "down" : "up") : null;
  const glyph = direction === "down" ? "▼ " : direction === "up" ? "▲ " : "";
  const value = describeValue(alert.kind, alert.value, alert.currency);
  return {
    name,
    url: absoluteUrl(productPath(alert.product_id)),
    rule: describeRule(alert),
    result: `${glyph}${value}${detail ? ` (${detail})` : ""}`,
    direction,
    asOf: `TCGplayer Market Price as of ${formatDateOnly(alert.price_day)}`,
  };
}

export function digestSubject(items: readonly { name: string }[], day: string): string {
  return items.length === 1 ? `Price alert: ${items[0].name}` : `${items.length} price alerts for ${formatMonthDay(day)}`;
}

const P = `margin:0 0 4px 0;font-family:${EMAIL_FONT_STACK};font-size:14px;line-height:20px;color:${C.ink};`;
const SMALL = `margin:0 0 4px 0;font-family:${EMAIL_FONT_STACK};font-size:12px;line-height:16px;color:${C.inkSoft};`;
const LINK = `color:${C.action};text-decoration:underline;`;

function itemHtml(item: DigestItem): string {
  const resultColour = item.direction === "down" ? C.lossText : item.direction === "up" ? C.gainText : C.ink;
  return [
    `<tr><td style="padding:16px 0;border-top:1px solid ${C.border};">`,
    `<p style="${P}font-weight:600;"><a href="${escapeHtml(item.url)}" style="${LINK}">${escapeHtml(item.name)}</a></p>`,
    `<p style="${P}">${escapeHtml(item.rule)}</p>`,
    `<p style="${P}font-weight:600;color:${resultColour};">${escapeHtml(item.result)}</p>`,
    `<p style="${SMALL}">${escapeHtml(item.asOf)}</p>`,
    `</td></tr>`,
  ].join("");
}

/** One digest: subject, HTML, plain text and the RFC 8058 headers. Pure: no I/O. */
export function renderAlertDigest({ digest, day, mailingAddress }: RenderDigestInput): EmailMessage {
  const items = digest.alerts.map(itemFor);
  const token = encodeURIComponent(digest.unsubscribe_token);
  const unsubscribePage = absoluteUrl(`${ALERT_UNSUBSCRIBE_PAGE_PATH}?t=${token}`);
  const oneClick = absoluteUrl(`${ALERT_UNSUBSCRIBE_API_PATH}?t=${token}`);
  const manage = absoluteUrl(ALERTS_MANAGE_PATH);
  const dayLabel = formatDateOnly(day);
  const heading = `Your price alerts for ${dayLabel}`;
  const intro = `Checked once a day after prices update, against TCGplayer Market Price for ${dayLabel} (UTC).`;
  const sender = `Pokéfin, ${mailingAddress}. Contact: ${CONTACT_EMAILS.hello}`;
  const subject = digestSubject(items, day);

  const text = [
    heading,
    "",
    intro,
    "",
    ...items.flatMap((item) => [item.name, item.rule, item.result, item.asOf, item.url, ""]),
    `Manage your alerts: ${manage}`,
    "",
    "--",
    FOOTER_DISCLAIMER,
    `${ALERT_EMAIL_REASON} Stop alert emails: ${unsubscribePage}`,
    sender,
    TCGPLAYER_TRADEMARK_NOTICE,
    "",
  ].join("\n");

  const html = [
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>`,
    `<body style="margin:0;padding:0;background:${C.page};">`,
    `<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(items[0]?.result ?? "")}</span>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};"><tr><td align="center" style="padding:24px 16px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.surface};border:1px solid ${C.border};border-radius:12px;"><tr><td style="padding:24px;">`,
    `<h1 style="margin:0 0 8px 0;font-family:${EMAIL_FONT_STACK};font-size:20px;line-height:28px;font-weight:600;color:${C.ink};">${escapeHtml(heading)}</h1>`,
    `<p style="${SMALL}margin-bottom:8px;">${escapeHtml(intro)}</p>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items.map(itemHtml).join("")}</table>`,
    `<p style="${P}margin-top:16px;"><a href="${escapeHtml(manage)}" style="${LINK}">Manage your alerts</a></p>`,
    `</td></tr></table>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;"><tr><td style="padding:16px 8px;">`,
    `<p style="${SMALL}">${escapeHtml(FOOTER_DISCLAIMER)}</p>`,
    `<p style="${SMALL}">${escapeHtml(ALERT_EMAIL_REASON)} <a href="${escapeHtml(unsubscribePage)}" style="${LINK}">Stop alert emails</a>.</p>`,
    `<p style="${SMALL}">${escapeHtml(sender)}</p>`,
    `<p style="${SMALL}">${escapeHtml(TCGPLAYER_TRADEMARK_NOTICE)}</p>`,
    `</td></tr></table>`,
    `</td></tr></table></body></html>`,
  ].join("");

  return {
    to: digest.email,
    subject,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${oneClick}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
```

The plain-text separator is `--` (two hyphens), not an em dash. `absoluteUrl` uses `NEXT_PUBLIC_SITE_URL` (WP13); production must set it to the canonical origin, which WP13 already requires.

### Step 12. `frontend/app/lib/email/brevo.ts` (new): the Brevo HTTP API client

```ts
import "server-only";

import type { EmailMessage } from "./alertDigest";

/** Brevo transactional email API (free tier: 300 emails a day). */
export const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";

export interface EmailSender {
  name: string;
  email: string;
}

export type SendResult = { ok: true; messageId: string | null } | { ok: false; status: number; retryable: boolean };

export interface BrevoOptions {
  apiKey: string;
  sender: EmailSender;
  replyTo: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Never throws. 429, 5xx and network errors are retryable; other 4xx are not. */
export async function sendBrevoEmail(message: EmailMessage, options: BrevoOptions): Promise<SendResult> {
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const res = await doFetch(BREVO_SEND_URL, {
      method: "POST",
      headers: { "api-key": options.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: options.sender,
        to: [{ email: message.to }],
        replyTo: { email: options.replyTo },
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
        headers: message.headers,
        tags: ["price-alerts"],
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      cache: "no-store",
    });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { messageId?: unknown } | null;
      return { ok: true, messageId: typeof body?.messageId === "string" ? body.messageId : null };
    }
    return { ok: false, status: res.status, retryable: res.status === 429 || res.status >= 500 };
  } catch {
    return { ok: false, status: 0, retryable: true };
  }
}
```

Never log the request body, the recipient or the API key. Brevo answers 201 with `{"messageId": "<...>"}` on success.

### Step 13. `frontend/app/lib/server/cronAuth.ts` (new) and `frontend/app/lib/server/alertDigestJob.ts` (new)

13a. `cronAuth.ts` (the WP11 `/api/revalidate` comparison, for a Bearer header):

```ts
import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/** Secrets shorter than this are treated as unset (fail closed). openssl rand -hex 32 gives 64. */
export const MIN_CRON_SECRET_LENGTH = 32;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time: both sides are hashed to 32 bytes before comparing. */
export function bearerMatches(header: string | null, expected: string): boolean {
  if (header === null || !header.startsWith("Bearer ")) return false;
  return timingSafeEqual(sha256(header.slice("Bearer ".length)), sha256(expected));
}
```

13b. `alertDigestJob.ts`: the orchestration, pure apart from its injected dependencies so the tests drive it directly.

```ts
import "server-only";

import { MAILING_ADDRESS } from "../../content/disclosures";
import { ALERT_DIGESTS_PER_RUN } from "../alerts";
import type { EmailMessage } from "../email/alertDigest";
import type { SendResult } from "../email/brevo";
import { MIN_CRON_SECRET_LENGTH } from "./cronAuth";
import { parseDueDigests, type DueDigest } from "./dueDigests";

export type AlertSendConfig =
  | { ok: true; cronToken: string; brevoApiKey: string; mailingAddress: string }
  | { ok: false; error: string };

/** Read per request so a rotated secret takes effect without a redeploy of code. */
export function readAlertSendConfig(
  env: Record<string, string | undefined> = process.env,
  mailingAddress: string | null = MAILING_ADDRESS
): AlertSendConfig {
  const cronToken = env.POKEFIN_CRON_TOKEN ?? "";
  if (cronToken.length < MIN_CRON_SECRET_LENGTH) return { ok: false, error: "POKEFIN_CRON_TOKEN is not set" };
  const brevoApiKey = env.BREVO_API_KEY ?? "";
  if (brevoApiKey.length === 0) return { ok: false, error: "BREVO_API_KEY is not set" };
  if (mailingAddress === null || mailingAddress.trim().length === 0) {
    return { ok: false, error: "The mailing address (owner decision D4) is not set" };
  }
  return { ok: true, cronToken, brevoApiKey, mailingAddress: mailingAddress.trim() };
}

export interface AlertDigestRpc {
  getDue(day: string, maxUsers: number): Promise<unknown>;
  recordSent(day: string, alertIds: number[]): Promise<number>;
  release(day: string, alertIds: number[]): Promise<number>;
}

export interface AlertJobDeps {
  day: string;
  rpc: AlertDigestRpc;
  render: (digest: DueDigest) => EmailMessage;
  send: (message: EmailMessage) => Promise<SendResult>;
  /** logCaughtError in production. Never receives an email address. */
  log: (label: string, error: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
  maxUsers?: number;
  concurrency?: number;
}

export type AlertJobStatus = "ok" | "no_stats" | "partial";

export interface AlertJobSummary {
  status: AlertJobStatus;
  day: string;
  statsRows: number;
  evaluated: number;
  rearmed: number;
  dueUsers: number;
  truncated: boolean;
  sent: number;
  failed: number;
  recordFailed: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Evaluate the day, then send one digest per claimed user: 5 in flight, one
 * retry after 1 s on a retryable failure. A sent digest is recorded at once
 * (so a crash later in the run cannot resend it); a refused one is released
 * so the next run retries it. Throws only when the evaluation itself fails.
 */
export async function runAlertDigestJob(deps: AlertJobDeps): Promise<AlertJobSummary> {
  const sleep = deps.sleep ?? defaultSleep;
  const raw = await deps.rpc.getDue(deps.day, deps.maxUsers ?? ALERT_DIGESTS_PER_RUN);
  const due = parseDueDigests(raw);
  if (due === null) throw new Error("get_due_alert_digests returned an unexpected document");

  const summary: AlertJobSummary = {
    status: "ok",
    day: due.day,
    statsRows: due.stats_rows,
    evaluated: due.evaluated,
    rearmed: due.rearmed,
    dueUsers: due.due_users,
    truncated: due.truncated,
    sent: 0,
    failed: 0,
    recordFailed: 0,
  };
  if (due.stats_rows === 0) return { ...summary, status: "no_stats" };

  const queue = [...due.digests];
  const worker = async () => {
    for (let digest = queue.shift(); digest !== undefined; digest = queue.shift()) {
      const ids = digest.alerts.map((alert) => alert.alert_id);
      let result: SendResult;
      try {
        const message = deps.render(digest);
        result = await deps.send(message);
        if (!result.ok && result.retryable) {
          await sleep(1000);
          result = await deps.send(message);
        }
      } catch (error) {
        deps.log("alerts_render_failed", error);
        result = { ok: false, status: 0, retryable: false };
      }
      if (result.ok) {
        summary.sent += 1;
        try {
          await deps.rpc.recordSent(deps.day, ids);
        } catch (error) {
          summary.recordFailed += 1;
          deps.log("alerts_record_failed", error);
        }
      } else {
        summary.failed += 1;
        deps.log("alerts_send_failed", new Error(`Brevo answered ${result.status}`));
        try {
          await deps.rpc.release(deps.day, ids);
        } catch (error) {
          deps.log("alerts_release_failed", error);
        }
      }
    }
  };
  const lanes = Math.max(1, Math.min(deps.concurrency ?? 5, queue.length));
  await Promise.all(Array.from({ length: lanes }, worker));

  summary.status = summary.failed > 0 || summary.recordFailed > 0 ? "partial" : "ok";
  return summary;
}
```

### Step 14. `frontend/app/api/cron/alerts/route.ts` (new)

```ts
import { NextRequest } from "next/server";
import { jsonNoStore } from "../../../lib/routeAuth";
import { logCaughtError, logSupabaseError } from "../../../lib/logger";
import { ALERT_DIGESTS_PER_RUN } from "../../../lib/alerts";
import { ALERT_EMAIL_SENDER } from "../../../content/disclosures";
import { CONTACT_EMAILS } from "../../../content/contact";
import { bearerMatches, MIN_CRON_SECRET_LENGTH } from "../../../lib/server/cronAuth";
import { createAnonRpcClient } from "../../../lib/server/anonRpcSupabase";
import { alertEvaluationDay } from "../../../lib/server/dueDigests";
import { readAlertSendConfig, runAlertDigestJob, type AlertDigestRpc } from "../../../lib/server/alertDigestJob";
import { renderAlertDigest } from "../../../lib/email/alertDigest";
import { sendBrevoEmail } from "../../../lib/email/brevo";

// Vercel Cron calls this daily (frontend/vercel.json) with
// "Authorization: Bearer $CRON_SECRET". Never cached, never prerendered.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Read per request, not at module load (rotation and tests).
  const cronSecret = process.env.CRON_SECRET ?? "";
  if (cronSecret.length < MIN_CRON_SECRET_LENGTH) {
    return jsonNoStore({ error: "Cron is not configured" }, 503);
  }
  if (!bearerMatches(req.headers.get("authorization"), cronSecret)) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }

  const config = readAlertSendConfig();
  if (!config.ok) {
    logCaughtError("alerts_cron_not_configured", new Error(config.error));
    return jsonNoStore({ error: config.error }, 503);
  }

  const supabase = createAnonRpcClient();
  const token = config.cronToken;
  const rpc: AlertDigestRpc = {
    async getDue(day, maxUsers) {
      const { data, error } = await supabase.rpc("get_due_alert_digests", {
        p_day: day,
        p_token: token,
        p_max_users: maxUsers,
      });
      if (error) {
        logSupabaseError("alerts_get_due_failed", error);
        throw new Error("get_due_alert_digests failed");
      }
      return data;
    },
    async recordSent(day, alertIds) {
      const { data, error } = await supabase.rpc("record_alert_digest_sent", {
        p_day: day,
        p_alert_ids: alertIds,
        p_token: token,
      });
      if (error) {
        logSupabaseError("alerts_record_rpc_failed", error);
        throw new Error("record_alert_digest_sent failed");
      }
      return typeof data === "number" ? data : 0;
    },
    async release(day, alertIds) {
      const { data, error } = await supabase.rpc("release_alert_digest", {
        p_day: day,
        p_alert_ids: alertIds,
        p_token: token,
      });
      if (error) {
        logSupabaseError("alerts_release_rpc_failed", error);
        throw new Error("release_alert_digest failed");
      }
      return typeof data === "number" ? data : 0;
    },
  };

  const day = alertEvaluationDay();
  try {
    const summary = await runAlertDigestJob({
      day,
      rpc,
      maxUsers: ALERT_DIGESTS_PER_RUN,
      render: (digest) => renderAlertDigest({ digest, day, mailingAddress: config.mailingAddress }),
      send: (message) =>
        sendBrevoEmail(message, {
          apiKey: config.brevoApiKey,
          sender: ALERT_EMAIL_SENDER,
          replyTo: CONTACT_EMAILS.hello,
        }),
      log: logCaughtError,
    });
    if (summary.status === "no_stats") {
      logCaughtError("alerts_cron_no_stats", new Error(`No product_daily_stats rows for ${day}`));
    }
    if (summary.truncated) {
      logCaughtError("alerts_cron_truncated", new Error(`More than ${ALERT_DIGESTS_PER_RUN} digests were due`));
    }
    return jsonNoStore(summary, summary.status === "partial" ? 500 : 200);
  } catch (error) {
    logCaughtError("alerts_cron_failed", error);
    return jsonNoStore({ error: "Alert run failed" }, 500);
  }
}
```

The response carries counts only, never an email address or a token. Export only `GET`, `dynamic` and `maxDuration`. `maxDuration = 60` fits every Vercel plan with Fluid compute; do not raise it. The proxy rate-limits `/api/cron/alerts` like any `/api/` path (60 a minute per IP), which one daily call never approaches.

### Step 15. `frontend/vercel.json` (new)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/alerts",
      "schedule": "5 11 * * *"
    }
  ]
}
```

Vercel reads `vercel.json` from the project's Root Directory, which is `frontend/` (the Next app and `package.json` live there; Owner action 7 confirms it). Cron schedules are UTC. Crons run only on production deployments.

### Step 16. Unsubscribe: `frontend/app/lib/alertUnsubscribe.ts` (new) and `frontend/app/api/alerts/unsubscribe/route.ts` (new)

16a. `alertUnsubscribe.ts` (isomorphic, used by the route, the page and the tests):

```ts
export const UNSUBSCRIBE_STATUSES = ["unsubscribed", "already_unsubscribed", "unknown", "error"] as const;
export type UnsubscribeStatus = (typeof UNSUBSCRIBE_STATUSES)[number];

export function isUnsubscribeStatus(value: unknown): value is UnsubscribeStatus {
  return typeof value === "string" && (UNSUBSCRIBE_STATUSES as readonly string[]).includes(value);
}

const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The unsubscribe token from a link: a UUID, lower-cased, or null. */
export function parseUnsubscribeToken(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  return TOKEN_RE.test(token) ? token.toLowerCase() : null;
}

export const UNSUBSCRIBE_COPY: Readonly<Record<UnsubscribeStatus | "invalid", { title: string; body: string }>> = {
  unsubscribed: {
    title: "Alert emails are off",
    body: "You will not get the daily digest any more. Your alerts are still saved, and you can turn emails back on from your watchlist.",
  },
  already_unsubscribed: {
    title: "Alert emails were already off",
    body: "Nothing changed. You can turn emails back on from your watchlist.",
  },
  unknown: {
    title: "This link is no longer valid",
    body: "If you still get alert emails, sign in and turn them off on your watchlist.",
  },
  invalid: {
    title: "This link is not valid",
    body: "If you still get alert emails, sign in and turn them off on your watchlist.",
  },
  error: {
    title: "Something went wrong",
    body: "Please open the link in your email again.",
  },
};
```

16b. `app/api/alerts/unsubscribe/route.ts`. It deliberately has no CSRF gate: mail providers POST from their own servers (RFC 8058) without an Origin or the custom header, the unguessable token is the authorisation, and the only effect is turning emails off.

```ts
import { NextRequest, NextResponse } from "next/server";
import { rejectIfBodyTooLarge } from "../../../lib/csrf";
import { NO_STORE } from "../../../lib/routeAuth";
import { logCaughtError, logSupabaseError } from "../../../lib/logger";
import { createAnonRpcClient } from "../../../lib/server/anonRpcSupabase";
import { ALERT_UNSUBSCRIBE_PAGE_PATH } from "../../../lib/alerts";
import { isUnsubscribeStatus, parseUnsubscribeToken, type UnsubscribeStatus } from "../../../lib/alertUnsubscribe";

async function readForm(req: NextRequest): Promise<FormData | null> {
  try {
    return await req.formData();
  } catch {
    return null; // empty or non-form body: the token can still come from the query
  }
}

/**
 * POST /api/alerts/unsubscribe?t=<token>
 *  - RFC 8058 one-click from a mail client: body "List-Unsubscribe=One-Click".
 *    200 for done, already done and unknown (no oracle); 500 on a database
 *    error so the client may retry.
 *  - The page's form (fields t and from=page): 303 to the page with the status.
 * GET is not exported (405): a link scanner's GET must never unsubscribe.
 */
export async function POST(req: NextRequest) {
  const tooLarge = rejectIfBodyTooLarge(req, 1024);
  if (tooLarge) return tooLarge;

  const form = await readForm(req);
  const formToken = form?.get("t");
  const token = parseUnsubscribeToken(
    req.nextUrl.searchParams.get("t") ?? (typeof formToken === "string" ? formToken : null)
  );
  const fromPage = form?.get("from") === "page";

  let status: UnsubscribeStatus = "unknown";
  if (token !== null) {
    try {
      const { data, error } = await createAnonRpcClient().rpc("unsubscribe_alerts", { p_token: token });
      if (error) {
        logSupabaseError("alerts_unsubscribe_failed", error);
        status = "error";
      } else {
        status = isUnsubscribeStatus(data) ? data : "unknown";
      }
    } catch (error) {
      logCaughtError("alerts_unsubscribe_failed", error);
      status = "error";
    }
  }

  if (fromPage) {
    const target = new URL(`${ALERT_UNSUBSCRIBE_PAGE_PATH}?status=${status}`, req.url);
    const res = NextResponse.redirect(target, 303);
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
  return new NextResponse(status === "error" ? "Please try again later." : "You are unsubscribed from Pokéfin alert emails.", {
    status: status === "error" ? 500 : 200,
    headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" },
  });
}
```

`NO_STORE` is WP05's `{ "Cache-Control": "no-store" }` exported from `routeAuth.ts`; if it is not exported there, use the literal. Do not add this path to `PROTECTED_PATTERNS` and do not add a CSRF check.

### Step 17. `frontend/app/alerts/unsubscribe/page.tsx` (new)

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "../../components/ui/PageHeader";
import { buttonClasses } from "../../components/ui/Button";
import { NO_INDEX } from "../../lib/site";
import { ALERT_UNSUBSCRIBE_API_PATH } from "../../lib/alerts";
import { WATCHLIST_PAGE_PATH } from "../../lib/watchlist";
import { UNSUBSCRIBE_COPY, isUnsubscribeStatus, parseUnsubscribeToken } from "../../lib/alertUnsubscribe";

export const metadata: Metadata = {
  title: "Alert emails",
  description: "Stop Pokéfin price alert emails.",
  robots: NO_INDEX,
  referrer: "no-referrer",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

const LINK =
  "font-medium text-action underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action rounded-control";

/**
 * The page the email links to (WP35). GET only shows a button; the form POSTs
 * to /api/alerts/unsubscribe, so a scanner that prefetches the link cannot
 * unsubscribe anyone. After the POST the route redirects here with ?status=.
 */
export default async function AlertUnsubscribePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const status = first(params.status);
  const token = parseUnsubscribeToken(first(params.t));

  if (isUnsubscribeStatus(status)) {
    const copy = UNSUBSCRIBE_COPY[status];
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <PageHeader title={copy.title} />
        <p className="mt-3 text-body text-ink-soft">{copy.body}</p>
        <p className="mt-6">
          <Link href={WATCHLIST_PAGE_PATH} prefetch={false} className={LINK}>
            Go to your watchlist
          </Link>
        </p>
      </main>
    );
  }

  if (token === null) {
    const copy = UNSUBSCRIBE_COPY.invalid;
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <PageHeader title={copy.title} />
        <p className="mt-3 text-body text-ink-soft">{copy.body}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <PageHeader title="Stop price alert emails" />
      <p className="mt-3 text-body text-ink-soft">
        You will no longer get the daily digest. Your alerts stay saved, and you can turn emails back on from your
        watchlist.
      </p>
      <form method="post" action={ALERT_UNSUBSCRIBE_API_PATH} className="mt-6">
        <input type="hidden" name="t" value={token} />
        <input type="hidden" name="from" value="page" />
        <button type="submit" className={buttonClasses({ variant: "primary" })}>
          Stop alert emails
        </button>
      </form>
    </main>
  );
}
```

Reading `searchParams` makes the route dynamic; that is intended (noindex, tiny). The token appears only in this URL and in the owner's own Vercel request logs, and it can do nothing but turn emails off, which the user can undo; no further masking is needed. CSP `form-action 'self'` already allows the same-origin POST.

### Step 18. `frontend/app/components/alerts/BellIcon.tsx` and `AlertRuleList.tsx` (new)

18a. `BellIcon.tsx`:

```tsx
/** 16 px stroke bell, currentColor, decorative (WP35). */
export default function BellIcon({ className = "size-4 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true" focusable="false">
      <path
        d="M10 2.75a4.75 4.75 0 0 0-4.75 4.75v2.4c0 .6-.2 1.2-.57 1.67L3.5 13.1h13l-1.18-1.53a2.75 2.75 0 0 1-.57-1.67V7.5A4.75 4.75 0 0 0 10 2.75zM8 15.25a2 2 0 0 0 4 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
```

18b. `AlertRuleList.tsx` (one list for the dialog and the watchlist section; a `<ul>` of rows, a single line per rule from 768 px, stacked below):

```tsx
"use client";

import Link from "next/link";
import { buttonClasses } from "../ui/Button";
import { productHref } from "../nav/navConfig";
import { alertStatusText, describeRule, type AlertEntry } from "../../lib/alerts";

export interface AlertRuleListProps {
  alerts: readonly AlertEntry[];
  /** Show the product name as a link (watchlist section); the dialog already names the product. */
  showProduct: boolean;
  /** Id of the rule whose action is in flight (its buttons are aria-disabled). */
  busyId: number | null;
  onToggleActive: (entry: AlertEntry) => void;
  onDelete: (entry: AlertEntry) => void;
  label?: string;
}

const PRODUCT_LINK =
  "rounded-control font-medium text-ink hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action";

export default function AlertRuleList({
  alerts,
  showProduct,
  busyId,
  onToggleActive,
  onDelete,
  label = "Your price alerts",
}: AlertRuleListProps) {
  return (
    <ul aria-label={label} className="divide-y divide-line rounded-card border border-line bg-surface">
      {alerts.map((entry) => {
        const rule = describeRule(entry);
        const target = showProduct ? `${rule} for ${entry.productName}` : rule;
        const busy = busyId === entry.id;
        return (
          <li
            key={entry.id}
            data-alert-id={entry.id}
            className="flex min-h-14 flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4"
          >
            <div className="min-w-0 flex-1">
              {showProduct && (
                <p className="truncate text-body">
                  <Link href={productHref(entry.productId)} prefetch={false} className={PRODUCT_LINK}>
                    {entry.productName}
                  </Link>
                </p>
              )}
              <p className="text-body text-ink">{rule}</p>
              <p className="text-small text-ink-soft">{alertStatusText(entry)}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => onToggleActive(entry)}
                aria-disabled={busy ? true : undefined}
                aria-label={`${entry.active ? "Pause" : "Resume"} alert: ${target}`}
                className={buttonClasses({ variant: "secondary", size: "sm", className: "pointer-coarse:min-h-11" })}
              >
                {entry.active ? "Pause" : "Resume"}
              </button>
              <button
                type="button"
                onClick={() => onDelete(entry)}
                aria-disabled={busy ? true : undefined}
                aria-label={`Delete alert: ${target}`}
                className={buttonClasses({ variant: "ghost", size: "sm", className: "pointer-coarse:min-h-11" })}
              >
                Delete
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
```

The visible text is "Pause" or "Delete" and the accessible name starts with it (label-in-name). If `buttonClasses` has no `className` option in the tree, append the class with a template string.

### Step 19. `frontend/app/components/alerts/AlertDialog.tsx` (new)

Loaded lazily (steps 20 and 22). Default export.

```tsx
"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Dialog from "../ui/Dialog";
import SegmentedControl from "../ui/SegmentedControl";
import Skeleton from "../ui/Skeleton";
import { buttonClasses } from "../ui/Button";
import AlertRuleList from "./AlertRuleList";
import { useCurrency } from "../../context/CurrencyContext";
import { noteWatched } from "../../lib/watchlistStore";
import {
  ALERTS_FULL_MESSAGE,
  ALERTS_METHODOLOGY_HREF,
  ALERTS_UNAVAILABLE_MESSAGE,
  ALERT_CADENCE_SENTENCE,
  ALERT_KINDS,
  ALERT_KIND_META,
  contextLine,
  currentValueText,
  defaultThreshold,
  formatThresholdInput,
  isPriceKind,
  parseThresholdText,
  ruleIsTrueNow,
  suggestionsFor,
  thresholdError,
  type AlertCurrency,
  type AlertEntry,
  type AlertKind,
  type AlertsPayload,
} from "../../lib/alerts";
import { ALERTS_LOAD_FAILED, createAlert, deleteAlert, fetchAlerts, setAlertActive } from "../../lib/alertsApi";

export interface AlertDialogProps {
  productId: number;
  productName: string;
  onClose: () => void;
  /** Called after any change, so a parent list can reload. */
  onChanged?: () => void;
}

const CURRENCY_OPTIONS = [
  { value: "CAD", label: "CAD" },
  { value: "USD", label: "USD" },
] as const;

const LINK =
  "font-medium text-action underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action rounded-control";

/**
 * "Alert me" (WP35): create a rule for one product, see and manage its rules.
 * Reads GET /api/alerts?product_id= on open; never touches Supabase.
 */
export default function AlertDialog({ productId, productName, onClose, onChanged }: AlertDialogProps) {
  const { currency: headerCurrency } = useCurrency();
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<AlertsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<AlertKind>("price_below");
  const [currency, setCurrency] = useState<AlertCurrency>(headerCurrency === "USD" ? "USD" : "CAD");
  const [text, setText] = useState<string | null>(null); // null: show the default
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const formId = useId();
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  const descId = useId();

  useEffect(() => {
    const controller = new AbortController();
    fetchAlerts({ productId, signal: controller.signal }).then(
      (payload) => {
        setData(payload);
        setLoadError(null);
      },
      (err: unknown) => {
        if (!controller.signal.aborted) setLoadError(err instanceof Error ? err.message : ALERTS_LOAD_FAILED);
      }
    );
    return () => controller.abort();
  }, [productId, reload]);

  const context = data?.context ?? null;
  const ruleCurrency: AlertCurrency = isPriceKind(kind) ? currency : "USD";
  const suggestions = useMemo(() => suggestionsFor(kind, ruleCurrency, context), [kind, ruleCurrency, context]);
  const fallback = defaultThreshold(kind, ruleCurrency, context);
  const shown = text ?? (fallback === null ? "" : formatThresholdInput(kind, fallback));
  const meta = ALERT_KIND_META[kind];
  const full = data !== null && data.count >= data.max;
  const blocked = data === null || !data.available || context === null || full;
  const parsedNow = parseThresholdText(shown);
  const trueNow =
    parsedNow !== null && ruleIsTrueNow({ kind, threshold: parsedNow, currency: ruleCurrency }, context);
  const now = currentValueText(kind, ruleCurrency, context);
  const inputLabel =
    meta.unit === "money" ? `${meta.inputLabel} (${ruleCurrency === "CAD" ? "C$" : "US$"})` : meta.inputLabel;

  function chooseKind(next: AlertKind) {
    setKind(next);
    setText(null);
    setError(null);
  }

  function chooseCurrency(next: AlertCurrency) {
    setCurrency(next);
    setText(null);
    setError(null);
  }

  function changed(message: string) {
    setStatus(message);
    setReload((n) => n + 1);
    onChanged?.();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || blocked) return;
    const value = parseThresholdText(shown);
    const problem = value === null ? "Enter a number." : thresholdError(kind, value);
    if (value === null || problem !== null) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setStatus(null);
    setSaving(true);
    const result = await createAlert({ productId, kind, threshold: value, currency: ruleCurrency });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      inputRef.current?.focus();
      return;
    }
    if (result.watched === "added") noteWatched(productId, true);
    setText(null);
    changed(
      result.status === "exists"
        ? "You already have this alert."
        : `Alert saved. ${ALERT_CADENCE_SENTENCE}${result.watched === "added" ? " The product is now on your watchlist." : ""}`
    );
  }

  async function toggle(entry: AlertEntry) {
    if (busyId !== null) return;
    setBusyId(entry.id);
    const result = await setAlertActive(entry.id, !entry.active);
    setBusyId(null);
    if (result.ok) changed(entry.active ? "Alert paused." : "Alert resumed.");
    else setStatus(result.message);
  }

  async function remove(entry: AlertEntry) {
    if (busyId !== null) return;
    setBusyId(entry.id);
    const result = await deleteAlert(entry.id);
    setBusyId(null);
    if (result.ok) changed("Alert deleted.");
    else setStatus(result.message);
    statusRef.current?.focus();
  }

  const help: string[] = [ALERT_CADENCE_SENTENCE];
  if (data?.email) help.push(`One email each morning lists every alert that fired, sent to ${data.email}.`);
  if (context !== null && context.priceStatus !== "priced") help.push("This alert waits until a current price exists.");
  if (trueNow) help.push("Already true at the latest price: it will be in your next digest.");
  if (data !== null && data.prefs.exists && !data.prefs.digestEnabled) {
    help.push("Alert emails are off. Turn them back on from your watchlist.");
  }

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} className={buttonClasses({ variant: "secondary" })}>
        Close
      </button>
      <button
        type="submit"
        form={formId}
        disabled={blocked}
        aria-disabled={saving ? true : undefined}
        className={buttonClasses({ variant: "primary" })}
      >
        {saving ? "Saving…" : "Save alert"}
      </button>
    </div>
  );

  let body: ReactNode;
  if (data === null && loadError === null) {
    body = (
      <div role="status" className="mt-4 space-y-2">
        <span className="sr-only">Loading your alerts</span>
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  } else if (data === null) {
    body = (
      <div className="mt-4 space-y-3">
        <p className="text-body text-ink">{loadError}</p>
        <button type="button" onClick={() => setReload((n) => n + 1)} className={buttonClasses({ variant: "secondary" })}>
          Try again
        </button>
      </div>
    );
  } else if (!data.available) {
    body = <p className="mt-4 text-body text-ink">{ALERTS_UNAVAILABLE_MESSAGE}</p>;
  } else {
    body = (
      <>
        <p className="mt-1 text-small text-ink-soft">{contextLine(context)}</p>
        <form id={formId} onSubmit={submit} noValidate className="mt-4 space-y-4">
          <fieldset>
            <legend className="text-small font-semibold text-ink">Alert me when</legend>
            <div className="mt-2 space-y-1">
              {ALERT_KINDS.map((option) => (
                <label
                  key={option}
                  className="flex min-h-9 cursor-pointer items-center gap-3 rounded-control px-2 hover:bg-surface-alt pointer-coarse:min-h-11"
                >
                  <input
                    type="radio"
                    name={`${formId}-kind`}
                    value={option}
                    checked={kind === option}
                    onChange={() => chooseKind(option)}
                    className="size-4 accent-action"
                  />
                  <span className="text-body text-ink">{ALERT_KIND_META[option].label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor={inputId} className="text-small font-semibold text-ink">
                {inputLabel}
              </label>
              <input
                ref={inputRef}
                id={inputId}
                name="threshold"
                inputMode="decimal"
                autoComplete="off"
                value={shown}
                onChange={(event) => {
                  setText(event.target.value);
                  setError(null);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${helpId} ${errorId}` : helpId}
                className="h-11 w-full rounded-control border border-line bg-surface px-3 text-base tabular-nums text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action aria-invalid:border-warn-text md:h-10 md:text-body"
              />
            </div>
            {isPriceKind(kind) && (
              <SegmentedControl
                label="Currency"
                options={CURRENCY_OPTIONS}
                value={currency}
                onChange={chooseCurrency}
                fullWidthOnPhone={false}
              />
            )}
          </div>

          {suggestions.length > 0 && (
            <div role="group" aria-label="Suggestions" className="flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.label}
                  type="button"
                  onClick={() => {
                    setText(formatThresholdInput(kind, suggestion.value));
                    setError(null);
                  }}
                  className={buttonClasses({ variant: "secondary", size: "sm", className: "pointer-coarse:min-h-11" })}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          )}

          {now && <p className="text-small text-ink">{now}</p>}
          <p id={helpId} className="text-small text-ink-soft">
            {help.join(" ")}{" "}
            <Link href={ALERTS_METHODOLOGY_HREF} prefetch={false} className={LINK}>
              How alerts work
            </Link>
          </p>
          {error && (
            <p id={errorId} className="text-small font-medium text-warn-text">
              {error}
            </p>
          )}
          {full && <p className="text-small font-medium text-warn-text">{ALERTS_FULL_MESSAGE}</p>}
        </form>

        <p ref={statusRef} tabIndex={-1} role="status" className="mt-3 text-small text-ink focus-visible:outline-none">
          {status}
        </p>

        {data.alerts.length > 0 && (
          <section className="mt-5" aria-labelledby={`${formId}-existing`}>
            <h3 id={`${formId}-existing`} className="mb-2 text-h3 font-semibold text-ink">
              Your alerts for this product
            </h3>
            <AlertRuleList
              alerts={data.alerts}
              showProduct={false}
              busyId={busyId}
              onToggleActive={toggle}
              onDelete={remove}
              label="Your alerts for this product"
            />
          </section>
        )}
      </>
    );
  }

  return (
    <Dialog open onClose={onClose} title="Alert me" descriptionId={descId} initialFocusRef={inputRef} footer={footer}>
      <p id={descId} className="text-body font-medium text-ink">
        {productName}
      </p>
      {body}
    </Dialog>
  );
}
```

Notes for the executor:
- State is set only in promise callbacks and event handlers (`react-hooks/set-state-in-effect`).
- `aria-invalid:` is a Tailwind 4 built-in variant; `accent-action` comes from WP23's `--color-action` theme token. If `tsc` or the build says `accent-action` is unknown (no such utility), use `accent-[var(--pf-action)]`.
- When the dialog opens before the data arrives, `initialFocusRef` points at an input that is not rendered yet; WP14's `Dialog` then focuses its close button, which is correct.
- `SegmentedControl`'s `onChange` receives the option value type (`"CAD" | "USD"`); if its generic signature differs, wrap: `onChange={(v) => chooseCurrency(v as AlertCurrency)}`.

### Step 20. `frontend/app/components/alerts/AlertButton.tsx` (new) and the product page

20a. `AlertButton.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { buttonClasses } from "../ui/Button";
import { watchProductLoginPath } from "../../lib/watchlist";
import BellIcon from "./BellIcon";

// The dialog and lib/alerts.ts load on first open, never with the product page.
const AlertDialog = dynamic(() => import("./AlertDialog"), { ssr: false });

function preloadDialog(): void {
  void import("./AlertDialog");
}

export interface AlertButtonProps {
  productId: number;
  /** Full display name, shown in the dialog. */
  productName: string;
}

/**
 * "Alert me" on the product page (WP35). A client island: the server HTML is
 * the same button for every visitor, so the page stays ISR. Signed out, a tap
 * goes to sign-in through WP34's watch round trip; signed in, it opens the
 * alert dialog.
 */
export default function AlertButton({ productId, productName }: AlertButtonProps) {
  const router = useRouter();
  const { user, sessionStatus } = useAuth();
  const [open, setOpen] = useState(false);
  const signedIn = sessionStatus === "authenticated" && Boolean(user);
  const anonymous = sessionStatus === "anonymous";

  function handleClick() {
    if (anonymous) {
      router.push(watchProductLoginPath(`${window.location.pathname}${window.location.search}`, productId));
      return;
    }
    if (signedIn) setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onPointerEnter={signedIn ? preloadDialog : undefined}
        onFocus={signedIn ? preloadDialog : undefined}
        aria-haspopup="dialog"
        aria-disabled={!anonymous && !signedIn ? true : undefined}
        className={buttonClasses({ variant: "secondary", className: "aria-disabled:cursor-wait" })}
      >
        <BellIcon />
        <span>Alert me</span>
      </button>
      {open && <AlertDialog productId={productId} productName={productName} onClose={() => setOpen(false)} />}
    </>
  );
}
```

Do not import `lib/alerts.ts`, `lib/alertsApi.ts`, `format.ts` or `redirects.ts` here; Test 14 checks it.

20b. `app/product/[id]/ProductActions.tsx` (WP31): add the prop and render it directly after `{watch}`:

```tsx
  /** WP35 passes its "Alert me" control here. Empty while alerts are unavailable. */
  alert?: ReactNode;
```

```tsx
export default function ProductActions({ productId, boxNavHref, tcgplayerUrl, watch, alert, currencyToggle }: ProductActionsProps) {
```

```tsx
      {watch}
      {alert}
```

Change nothing else in the file.

20c. `app/product/[id]/page.tsx`: add `import AlertButton from "../../components/alerts/AlertButton";` and `import { alertsAvailable } from "../../lib/server/alertsConfig";`, and pass the island next to WP34's `watch` prop (keep every other prop as it is):

```tsx
            watch={<WatchButton productId={productId} productName={getProductDisplayName(product)} />}
            alert={
              alertsAvailable() ? (
                <AlertButton productId={productId} productName={getProductDisplayName(product)} />
              ) : undefined
            }
```

`alertsAvailable()` reads a module constant, so the page stays static and ISR. Add no `cookies()`, `headers()` or `searchParams`. If a WP31 or WP34 page test asserts the exact children of the actions row, add the "Alert me" button (`aria-haspopup="dialog"`, `aria-disabled="true"` in the server render) to its expectation and mock `alertsConfig` to return `true`.

### Step 21. Watchlist section: `useAlertList.ts`, `AlertRowButton.tsx`, `AlertsPanel.tsx` (new, `frontend/app/components/alerts/`)

21a. `useAlertList.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { ALERTS_LOAD_FAILED, fetchAlerts } from "../../lib/alertsApi";
import type { AlertsPayload } from "../../lib/alerts";

export type AlertListState =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; payload: AlertsPayload };

export interface AlertList {
  state: AlertListState;
  reload: () => void;
}

/** GET /api/alerts once, again on reload(); the last good payload stays on screen while reloading. */
export function useAlertList(): AlertList {
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ reload: number; state: AlertListState } | null>(null);
  const [last, setLast] = useState<AlertsPayload | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchAlerts({ signal: controller.signal }).then(
      (payload) => {
        setLast(payload);
        setResult({ reload, state: { kind: "ready", payload } });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          reload,
          state: { kind: "failed", message: error instanceof Error ? error.message : ALERTS_LOAD_FAILED },
        });
      }
    );
    return () => controller.abort();
  }, [reload]);

  const state: AlertListState =
    result !== null && result.reload === reload
      ? result.state
      : last !== null
        ? { kind: "ready", payload: last }
        : { kind: "loading" };
  const doReload = useCallback(() => setReload((n) => n + 1), []);
  return { state, reload: doReload };
}
```

21b. `AlertRowButton.tsx` (the bell on each watchlist row):

```tsx
"use client";

import BellIcon from "./BellIcon";

export default function AlertRowButton({
  productName,
  count,
  onClick,
}: {
  productName: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={`Alerts for ${productName}`}
      className="inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-control px-2 text-ink-soft transition-colors duration-150 motion-reduce:transition-none hover:bg-surface-alt hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action pointer-coarse:size-11"
    >
      <BellIcon />
      {count > 0 && (
        <span className="text-caption font-semibold tabular-nums text-ink" aria-hidden="true">
          {count}
        </span>
      )}
      {count > 0 && <span className="sr-only">{`, ${count} ${count === 1 ? "alert" : "alerts"} set`}</span>}
    </button>
  );
}
```

21c. `AlertsPanel.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import EmptyState from "../ui/EmptyState";
import ProvenanceLine from "../ui/ProvenanceLine";
import Skeleton from "../ui/Skeleton";
import { buttonClasses } from "../ui/Button";
import { WarnIcon } from "../ui/icons";
import AlertRuleList from "./AlertRuleList";
import type { AlertList } from "./useAlertList";
import { formatInteger, formatMonthDay } from "../../lib/format";
import { ALERTS_METHODOLOGY_HREF, ALERTS_SECTION_ID, describeRule, type AlertEntry } from "../../lib/alerts";
import { deleteAlert, setAlertActive, setAlertDigest } from "../../lib/alertsApi";

/**
 * "Price alerts" on /portfolio/watchlist (WP35): every rule, its status, the
 * digest switch. Renders nothing while alerts are unavailable (owner D4).
 */
export default function AlertsPanel({ list }: { list: AlertList }) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [digestBusy, setDigestBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const scrolled = useRef(false);
  const ready = list.state.kind === "ready";

  // The email's "Manage your alerts" link ends in #alerts; this section renders
  // after the client fetch, so the browser cannot scroll to it on its own.
  useEffect(() => {
    if (!ready || scrolled.current) return;
    if (window.location.hash === `#${ALERTS_SECTION_ID}`) sectionRef.current?.scrollIntoView();
    scrolled.current = true;
  }, [ready]);

  if (list.state.kind === "ready" && !list.state.payload.available) return null;

  async function toggle(entry: AlertEntry) {
    if (busyId !== null) return;
    setBusyId(entry.id);
    const result = await setAlertActive(entry.id, !entry.active);
    setBusyId(null);
    setStatus(result.ok ? (entry.active ? "Alert paused." : "Alert resumed.") : result.message);
    if (result.ok) list.reload();
  }

  async function remove(entry: AlertEntry) {
    if (busyId !== null) return;
    setBusyId(entry.id);
    const result = await deleteAlert(entry.id);
    setBusyId(null);
    setStatus(result.ok ? `Deleted alert: ${describeRule(entry)} for ${entry.productName}.` : result.message);
    if (result.ok) list.reload();
    statusRef.current?.focus();
  }

  async function setDigest(enabled: boolean) {
    if (digestBusy) return;
    setDigestBusy(true);
    const result = await setAlertDigest(enabled);
    setDigestBusy(false);
    setStatus(result.ok ? (enabled ? "Alert emails turned on." : "Alert emails turned off.") : result.message);
    if (result.ok) list.reload();
  }

  let content: ReactNode;
  if (list.state.kind === "loading") {
    content = (
      <div role="status" className="space-y-2">
        <span className="sr-only">Loading your alerts</span>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  } else if (list.state.kind === "failed") {
    content = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-body text-ink">Your alerts could not be loaded.</p>
        <button type="button" onClick={list.reload} className={buttonClasses({ variant: "secondary", size: "sm" })}>
          Try again
        </button>
      </div>
    );
  } else {
    const { payload } = list.state;
    content = (
      <>
        <ProvenanceLine methodologyHref={ALERTS_METHODOLOGY_HREF} methodologyLabel="How alerts work">
          {`${formatInteger(payload.count)} of ${formatInteger(payload.max)} alerts. Checked once a day after prices update, against the previous day's TCGplayer Market Price. One email each morning lists every alert that fired.`}
        </ProvenanceLine>
        {payload.prefs.exists &&
          (payload.prefs.digestEnabled ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-small text-ink">
                {payload.email ? `Daily digest on, sent to ${payload.email}.` : "Daily digest on."}
              </p>
              <button
                type="button"
                onClick={() => setDigest(false)}
                aria-disabled={digestBusy ? true : undefined}
                className={buttonClasses({ variant: "secondary", size: "sm", className: "pointer-coarse:min-h-11" })}
              >
                Turn off emails
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-control bg-warn-fill px-3 py-2">
              <p className="flex items-center gap-2 text-small text-warn-text">
                <WarnIcon />
                {`Alert emails are off${payload.prefs.unsubscribedAt ? ` since ${formatMonthDay(payload.prefs.unsubscribedAt)}` : ""}. Your alerts are still checked, but nothing is sent.`}
              </p>
              <button
                type="button"
                onClick={() => setDigest(true)}
                aria-disabled={digestBusy ? true : undefined}
                className={buttonClasses({ variant: "secondary", size: "sm", className: "pointer-coarse:min-h-11" })}
              >
                Turn on emails
              </button>
            </div>
          ))}
        <div className="mt-4">
          {payload.alerts.length === 0 ? (
            <EmptyState
              title="No price alerts yet"
              description="Select Alert me on a product page, or the bell on a watched product, to get one email a morning when a price crosses your level."
              action={
                <Link href="/prices" prefetch={false} className={buttonClasses({ variant: "secondary" })}>
                  Browse prices
                </Link>
              }
            />
          ) : (
            <AlertRuleList alerts={payload.alerts} showProduct busyId={busyId} onToggleActive={toggle} onDelete={remove} />
          )}
        </div>
      </>
    );
  }

  return (
    <section
      ref={sectionRef}
      id={ALERTS_SECTION_ID}
      aria-labelledby={`${ALERTS_SECTION_ID}-title`}
      className="mt-10 scroll-mt-20"
    >
      <h2 id={`${ALERTS_SECTION_ID}-title`} className="mb-2 text-h2 font-semibold text-ink">
        Price alerts
      </h2>
      <p ref={statusRef} tabIndex={-1} role="status" className="mb-2 text-small text-ink focus-visible:outline-none">
        {status}
      </p>
      {content}
    </section>
  );
}
```

`formatMonthDay` accepts an ISO timestamp (it reads the leading `YYYY-MM-DD`, WP07). The effect calls no setter.

### Step 22. Watchlist wiring (WP34 files)

22a. `app/components/watchlist/WatchlistTable.tsx`: extend `WatchlistViewProps` (both views share it) and add the column.

```ts
export interface WatchlistViewProps {
  // ...WP34's fields, unchanged...
  /** WP35: rules per product id. With onAlert, adds the Alerts column (desktop) and the bell (phone). */
  alertCounts?: Readonly<Record<number, number>>;
  onAlert?: (entry: WatchlistEntry) => void;
}
```

Add `import AlertRowButton from "../alerts/AlertRowButton";`, destructure `alertCounts` and `onAlert` in `WatchlistTable`'s parameters, and in the `useMemo` push this column directly before the `remove` column (inside the same `list.push(...)` call, between the `added` and `remove` objects, guarded so the array stays typed):

```tsx
      ...(onAlert
        ? [
            {
              id: "alerts",
              label: "Alerts",
              align: "right",
              widthClassName: "w-20",
              cellClassName: "px-2 text-right",
              cell: (entry: WatchlistEntry) => (
                <AlertRowButton
                  productName={entry.name}
                  count={alertCounts?.[entry.productId] ?? 0}
                  onClick={() => onAlert(entry)}
                />
              ),
            } satisfies Column,
          ]
        : []),
```

Add `alertCounts` and `onAlert` to the `useMemo` dependency list. The column has no `sortKey` (unsortable).

22b. `app/components/watchlist/WatchlistPhoneList.tsx`: destructure the same two props and, inside the trailing `<span className="flex shrink-0 items-center pr-2">`, put the bell before `<RemoveButton ... />`:

```tsx
            <span className="flex shrink-0 items-center pr-2">
              {onAlert && (
                <AlertRowButton
                  productName={entry.name}
                  count={alertCounts?.[entry.productId] ?? 0}
                  onClick={() => onAlert(entry)}
                />
              )}
              <RemoveButton entry={entry} onRemove={onRemove} />
            </span>
```

22c. `app/portfolio/watchlist/WatchlistView.tsx`, inside `WatchlistLoaded`:

- Imports: add `useMemo` to the React import, and
  ```ts
  import dynamic from "next/dynamic";
  import AlertsPanel from "../../components/alerts/AlertsPanel";
  import { useAlertList } from "../../components/alerts/useAlertList";
  import { countAlertsByProduct } from "../../lib/alerts";
  ```
  and, at module level below the imports, `const AlertDialog = dynamic(() => import("../../components/alerts/AlertDialog"), { ssr: false });`.
- Directly after the existing `useRef` lines (before any early `return`), add:
  ```tsx
  const alertList = useAlertList();
  const [alertTarget, setAlertTarget] = useState<{ productId: number; name: string } | null>(null);
  const alertsReady = alertList.state.kind === "ready" && alertList.state.payload.available;
  const alertCounts = useMemo(
    () => (alertList.state.kind === "ready" ? countAlertsByProduct(alertList.state.payload.alerts) : {}),
    [alertList.state]
  );
  const openAlert = useCallback((entry: WatchlistEntry) => setAlertTarget({ productId: entry.productId, name: entry.name }), []);
  ```
- Pass to both views: `alertCounts={alertsReady ? alertCounts : undefined} onAlert={alertsReady ? openAlert : undefined}`.
- At the end of the `<Shell provenance={provenance}>` children (after the `count === 0 ? ... : ...` block, so the section shows even with an empty watchlist), add:
  ```tsx
      <AlertsPanel list={alertList} />
      {alertTarget && (
        <AlertDialog
          productId={alertTarget.productId}
          productName={alertTarget.name}
          onClose={() => setAlertTarget(null)}
          onChanged={alertList.reload}
        />
      )}
  ```

Do not render `AlertsPanel` in the loading, failed or signed-out branches of the watchlist page; they return before it.

### Step 23. Methodology: `#alerts`

23a. `frontend/app/content/methodology.ts`: bump `METHODOLOGY_VERSION` to the next minor version above `V_OLD` (Before you start; for example "1.3" to "1.4"), set `METHODOLOGY_EFFECTIVE_DATE` to the PR date (`date -u +%F`), append `{ anchor: "alerts", title: "Price alerts", parent: "cadence" },` to `METHODOLOGY_SUBSECTIONS`, and add at the top of `METHODOLOGY_CHANGES` (keep every existing row):

```ts
  {
    version: METHODOLOGY_VERSION,
    date: METHODOLOGY_EFFECTIVE_DATE,
    summary:
      "Adds price alerts: checked once a day against the previous day's fresh Market Price, CAD levels at the Bank of Canada rate of the price's day, and a 2% (or 2 point) re-arm band.",
  },
```

If the newest existing row uses `METHODOLOGY_VERSION` and `METHODOLOGY_EFFECTIVE_DATE` instead of literals, turn it into literals first (its own version and date), as WP25 step 14a did.

23b. `frontend/app/methodology/MethodologyArticle.tsx`: add

```ts
import {
  ALERT_KIND_META,
  ALERT_MAX_PRICE_AGE_DAYS,
  ALERT_REARM_POINTS,
  ALERT_REARM_PRICE_FACTOR,
  ALERTS_MAX_PER_USER,
} from "../lib/alerts";
```

(`PRICE_STALENESS_TOLERANCE_DAYS` is already imported by WP24 for `#freshness`; if not, import it from `../lib/marketPulse`) and, as the last child of `<Section id="cadence">`, add:

```tsx
            <Sub id="alerts">
              <p>
                Price alerts are checked once a day, after the previous UTC day&apos;s statistics are final, against
                that day&apos;s TCGplayer Market Price. One email the next morning lists every alert that fired. An
                alert never fires on a withheld price (older than {PRICE_STALENESS_TOLERANCE_DAYS} days) or on a
                price more than {ALERT_MAX_PRICE_AGE_DAYS} days older than the day checked. Each account can keep{" "}
                {ALERTS_MAX_PER_USER} alerts.
              </p>
              <ul className="ml-5 list-disc space-y-1">
                <li>
                  <strong>{ALERT_KIND_META.price_below.label}</strong> or <strong>{ALERT_KIND_META.price_above.label}</strong>:
                  the Market Price, rounded to the cent, against your level. A CAD level is compared with the USD
                  Market Price converted at the Bank of Canada rate of the price&apos;s own day; on a day without that
                  rate the alert is skipped.
                </li>
                <li>
                  <strong>{ALERT_KIND_META.pct_move_7d.label}</strong>: the 7-day change in USD Market Price terms
                  (see Returns), up or down.
                </li>
                <li>
                  <strong>{ALERT_KIND_META.ask_below_market.label}</strong>: the cheapest listing against Market Price.
                  Listings exclude shipping, which is often $5 to $15 on sealed product.
                </li>
                <li>
                  <strong>{ALERT_KIND_META.supply_drop_30d.label}</strong>: the 30-day change in units on the market
                  (see Supply trend).
                </li>
              </ul>
              <p>
                After an alert fires it waits until the value moves back past your level by{" "}
                {Math.round(ALERT_REARM_PRICE_FACTOR * 100)}% of the level (price alerts) or {ALERT_REARM_POINTS}{" "}
                percentage points (the others) before it can fire again, so a price hovering at your level does not
                email you every day. Alerts describe past prices; they are not recommendations.
              </p>
            </Sub>
```

If `Sub` is named differently in the tree (WP25 uses `Sub`), use that component. WP24's methodology test asserts every `METHODOLOGY_SUBSECTIONS` anchor renders; it now covers `alerts`.

### Step 24. Privacy, account, README, environment example

24a. `frontend/app/privacy/page.tsx` (WP24, WP34):
- "What we collect", after WP34's Watchlist item: `<li><strong>Price alerts</strong>: the levels you set, when each alert last fired, and whether you get alert emails.</li>`
- "How we use it": after "answer your messages," insert "send the daily price alert email you asked for, ".
- "Service providers", replace the Brevo item with `<li><strong>Brevo</strong>: email delivery, including the daily price alert digest (your email address and the alerts that fired).</li>`. If WP24 shipped a placeholder in this line, this replaces it; tell the owner in the PR (Owner action 8).
- "How long we keep it": change "box recipes and watchlist" to "box recipes, watchlist and price alerts".
- Add one sentence at the end of "Your rights", as a new `<li>`: `<li><strong>Alert emails</strong>: every alert email has a link that turns them off in one step, without signing in.</li>`
- Set the page's last-updated constant (`grep -n "LAST_UPDATED" app/privacy/page.tsx`) to the merge day.

24b. `frontend/app/account/page.tsx`: in the "Your data" sentence add "price alerts" to the exported records ("profile, portfolios, holdings, lots, box recipes, watchlist and price alerts"). Nothing else.

24c. `README.md` (repo root), Database section, next to WP34's `watchlist_items` line: "`price_alerts`, `alert_email_prefs` and `alert_deliveries` (0039, WP35): alert rules (50 per user, owner-only RLS), email preferences with the unsubscribe token, and one delivery row per alert and day. Written by users through `app/api/alerts/route.ts` and evaluated daily by `app/api/cron/alerts/route.ts` (Vercel Cron, 11:05 UTC) through SECURITY DEFINER functions that check the Vault secret `pokefin_cron_token`."

24d. `frontend/.env.example`, append:

```bash

# Daily price alerts (WP35). Server-only: never prefix with NEXT_PUBLIC_.
# CRON_SECRET: Vercel sends it as "Authorization: Bearer ..." to /api/cron/alerts (openssl rand -hex 32).
CRON_SECRET=
# POKEFIN_CRON_TOKEN: must equal the Supabase Vault secret pokefin_cron_token (openssl rand -hex 32).
POKEFIN_CRON_TOKEN=
# Brevo transactional API key (Brevo, SMTP & API, API keys).
BREVO_API_KEY=
```

### Step 25. Lint lists, budgets, conventions baseline

25a. `frontend/eslint.config.mjs`:
- Append to `ANON_CLIENT_FORBIDDEN_FILES` with the comment `// WP35: alert routes, email and the unsubscribe page`: `"app/api/alerts/**/*.ts"`, `"app/api/cron/**/*.ts"`, `"app/lib/email/**/*.ts"`, `"app/alerts/**/*.{ts,tsx}"`.
- Append to `PUBLIC_ROUTE_CLIENT_FILES` with the comment `// WP35: the Alert me island runs on /product/[id]`: `"app/components/alerts/**/*.{ts,tsx}"`, `"app/lib/alerts.ts"`, `"app/lib/alertsApi.ts"`, `"app/lib/alertUnsubscribe.ts"`.
- In WP05's user-table `no-restricted-syntax` selector, append `|price_alerts|alert_email_prefs|alert_deliveries` to the alternation (keep every name already there).

Then `pnpm lint` must report 0 errors. An error means an alert module reaches Supabase from browser code: fix the import, never the rule.

25b. `frontend/perf-budgets.json` (WP22): next to the `/portfolio/watchlist` entry add

```json
    "/alerts/unsubscribe": {
      "source": "manifest",
      "jsGzKb": { "target": 130, "limit": null, "recorded": null }
    },
```

Run the perf build and `pnpm perf:budget --write-limits` (Verification block 3). Only the new route's `limit` and `recorded` may change; every other limit must stay the same or go down. If `/product/900001` goes above its limit, the island imports too much (Test 14 names the culprit): shrink it, never add a raise line.

25c. `frontend/app/__tests__/uiConventions.baseline.json` (WP23): add one entry under `"hex"`, keeping alphabetical order: `"lib/email/emailTheme.ts": 8`. Do not regenerate the whole file with `UPDATE_UI_BASELINE=1` unless the only diff is this line. The PR body states the reason: "email clients do not support CSS custom properties; the 8 values mirror globals.css tokens and emailTheme.test.ts fails on drift".

### Step 26. Phase B: generated types

After Owner action 1 (0039 applied in production): from `frontend/`, `pnpm types:db`, then `grep -c "price_alerts\|get_due_alert_digests\|unsubscribe_alerts" app/types/database.ts` (expect 3 or more) and `pnpm exec tsc --noEmit` (exit 0). Commit the regenerated file alone. Do not hand-edit `database.ts` in phase A and do not cast a client to `any`.

### Step 27. Tests and end of phase A

Write every file in the Tests section alongside the step it covers. Then run Verification blocks 1 to 4, push, open the draft PR `[waiting for DB types] WP35: Daily price alerts`, and hand the owner Owner actions 1 to 6. After the owner confirms Owner action 1, run step 26 and Verification block 5; after D4 is set (or the owner accepts merging with alerts hidden), mark the PR ready.

## Pitfalls: do not do this

- **Do not put a service-role key in Vercel** or call the cron functions with one. The design is anon key plus Vault token (WP21 removed broad keys from the web app).
- **Do not grant `EXECUTE` on `alert_evaluations` or `alert_cron_token_ok` to any API role**, and do not move the token check below any other statement in the three cron functions: a wrong token must cost nothing and reveal nothing.
- **Do not compare tokens with `=` or `===`.** SQL compares SHA-256 digests byte by byte without an early exit; TypeScript uses `timingSafeEqual` on SHA-256 digests.
- **Do not evaluate today, and do not evaluate on a stale price.** The cron passes yesterday (UTC); `alert_evaluations` requires `is_price_fresh`, a non-null price and `price_day >= p_day - 3`. Never relax these to "make the email fire".
- **Do not convert a CAD level at today's rate or at the header's rate.** The evaluation uses `fx_daily` of the price's day; the dialog's CAD figures use the same rule through `usdToCadOn`.
- **Do not send before claiming, and do not record before Brevo accepts.** The order is claim (`get_due_alert_digests`), send, then `record_alert_digest_sent` for that user at once, or `release_alert_digest` on refusal. Do not batch the records at the end of the run.
- **Do not return the digests as a row set** (`RETURNS TABLE`): PostgREST's `max-rows` would silently cut a large run. Keep `jsonb`.
- **Do not log email addresses, unsubscribe tokens, `CRON_SECRET`, `POKEFIN_CRON_TOKEN` or the Brevo key**, and do not return them from the cron route. Log labels and counts only.
- **Do not unsubscribe on GET.** The page's GET shows a button; only the POST acts. Do not add a CSRF gate to `/api/alerts/unsubscribe` either: RFC 8058 POSTs come from mail servers without an Origin.
- **Do not delete rules on unsubscribe**, and do not treat "unknown token" as an error the mail client sees (200, no oracle).
- **Do not call anything "instant", "live" or "real-time"**, and do not promise a delivery time beyond "each morning". The copy is "Checked once a day after prices update".
- **Do not query the alert tables from browser code or through the anon client.** Only `app/lib/server/alertsRepo.ts` (cookie client) reads and writes them; the cron and unsubscribe routes use only the four token-checked functions. The ESLint selector enforces it.
- **Do not `select("*")` from `alert_email_prefs`.** authenticated cannot read `unsubscribe_token` (column grant); `*` fails with 42501.
- **Do not grant UPDATE on rule columns** (`kind`, `threshold`, `currency`, `armed`, `last_*`). A changed level is a new rule; pausing is the only edit.
- **Do not import `lib/alerts.ts`, `alertsApi.ts`, `format.ts` or `redirects.ts` into `AlertButton.tsx`,** and do not read the session, cookies or `searchParams` on the product page. The dialog is a lazy chunk.
- **Do not choose the phone or desktop layout with `matchMedia` in state** (WP18 F073). The rule list is one DOM that CSS reflows.
- **Do not edit 0038, 0034 or any earlier migration, `verify_migration.py` or `schema.sql`,** and do not apply the migration to production yourself.
- **Do not send email from the laptop scraper** or add a Python sender: it would need the user tables and emails, the opposite of WP21's least-privilege role.
- **Do not write the mailing address anywhere but `app/content/disclosures.ts`,** and do not send an email without it (CASL).

## Tests

Route, repo and job tests start with `/** @jest-environment node */`; mock `server-only` as WP05 does (`next/jest` maps it to an empty module). Component tests use jsdom, `@testing-library/react`, WP14's `<dialog>` polyfill and `axeViolations` from `@/test-utils/axe`. Python database tests are skipped unless `POKEFIN_TEST_DATABASE_URL` is set (CI job "Database replay and Python tests" sets it to `replay_once`).

### 1. `tests/test_wp35_price_alerts_db.py` (new, needs the replayed database)

All 29 cases passed, twice in a row on the same database, against 0039 on PostgreSQL 16.13 with WP21's bootstrap and the Vault stand-in while this spec was written.

```python
"""
Database checks for migration 0039 (price alerts, WP35), run against a
database rebuilt by scripts/db/replay_migrations.sh (with the Vault stand-in
from scripts/db/ci_bootstrap.sql).

Skipped unless POKEFIN_TEST_DATABASE_URL points at that replayed database as
a superuser (CI sets it; job "database"). NEVER point it at production: the
fixtures write rows and replace the Vault secret pokefin_cron_token.

  POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/replay_once \
    python -m pytest tests/test_wp35_price_alerts_db.py -v
"""
import datetime as dt
import os
import uuid
from urllib.parse import urlparse

import pytest

DSN = os.environ.get("POKEFIN_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="POKEFIN_TEST_DATABASE_URL not set")

psycopg = pytest.importorskip("psycopg")
from psycopg import errors  # noqa: E402

TAG = "wp35-" + uuid.uuid4().hex[:8]
TOKEN = "t" * 20 + uuid.uuid4().hex  # 52 characters
CAP = 50


@pytest.fixture(scope="module")
def admin():
    host = (urlparse(DSN).hostname or "").lower()
    assert host in ("localhost", "127.0.0.1", "postgres"), "refusing a non-local database"
    with psycopg.connect(DSN, autocommit=True) as conn:
        yield conn


@pytest.fixture(scope="module")
def today(admin):
    return admin.execute("SELECT (now() AT TIME ZONE 'UTC')::date").fetchone()[0]


@pytest.fixture(scope="module", autouse=True)
def vault_token(admin):
    admin.execute("DELETE FROM vault.secrets WHERE name = 'pokefin_cron_token'")
    admin.execute("SELECT vault.create_secret(%s, 'pokefin_cron_token', 'WP35 tests')", (TOKEN,))
    yield TOKEN
    admin.execute("DELETE FROM vault.secrets WHERE name = 'pokefin_cron_token'")


@pytest.fixture(scope="module")
def catalog(admin):
    set_id = admin.execute(
        "INSERT INTO public.sets (code, name) VALUES (%s, %s) RETURNING id", (TAG, "Evolving Skies " + TAG)
    ).fetchone()[0]
    type_id = admin.execute(
        "INSERT INTO public.product_types (name, label) VALUES (%s, 'Booster Box') RETURNING id", (TAG,)
    ).fetchone()[0]
    yield {"set_id": set_id, "type_id": type_id}
    admin.execute("DELETE FROM public.products WHERE set_id = %s", (set_id,))  # rules, stats cascade
    admin.execute("DELETE FROM public.sets WHERE id = %s", (set_id,))
    admin.execute("DELETE FROM public.product_types WHERE id = %s", (type_id,))


@pytest.fixture(scope="module", autouse=True)
def fx_window(admin, today):
    """Tests write fx_daily for the last 8 days; put the original rows back afterwards."""
    saved = admin.execute(
        "SELECT day, usd_to_cad, source_date, source FROM public.fx_daily WHERE day BETWEEN %s AND %s",
        (today - dt.timedelta(days=12), today),
    ).fetchall()
    yield
    admin.execute(
        "DELETE FROM public.fx_daily WHERE day BETWEEN %s AND %s", (today - dt.timedelta(days=12), today)
    )
    for row in saved:
        admin.execute(
            "INSERT INTO public.fx_daily (day, usd_to_cad, source_date, source) VALUES (%s, %s, %s, %s)", row
        )


def product(admin, catalog):
    return admin.execute(
        "INSERT INTO public.products (set_id, product_type_id, usd_price, url, last_updated) "
        "VALUES (%s, %s, 100, 'https://www.tcgplayer.com/product/1', now()) RETURNING id",
        (catalog["set_id"], catalog["type_id"]),
    ).fetchone()[0]


def new_user(admin, confirmed=True):
    uid = str(uuid.uuid4())
    admin.execute(
        "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (%s, %s, %s)",
        (uid, f"u{uid[:8]}@example.com", dt.datetime.now(dt.timezone.utc) if confirmed else None),
    )
    return uid


@pytest.fixture
def user(admin):
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


def add_alert(admin, uid, product_id, kind, threshold, currency="USD"):
    as_user(admin, uid)
    try:
        alert_id = admin.execute(
            "INSERT INTO public.price_alerts (user_id, product_id, kind, threshold, currency) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (uid, product_id, kind, threshold, currency),
        ).fetchone()[0]
        admin.execute("COMMIT")
        return alert_id
    except Exception:
        rollback(admin)
        raise


def stats(admin, day, product_id, usd, price_day=None, fresh=True, **extra):
    cols = {"usd_price": usd if fresh else None, "price_day": price_day or day, "is_price_fresh": fresh, **extra}
    names = ", ".join(cols)
    marks = ", ".join(["%s"] * len(cols))
    admin.execute(
        f"INSERT INTO public.product_daily_stats (day, product_id, {names}) VALUES (%s, %s, {marks}) "
        "ON CONFLICT (day, product_id) DO NOTHING",
        (day, product_id, *cols.values()),
    )


def fx(admin, day, rate):
    admin.execute(
        "INSERT INTO public.fx_daily (day, usd_to_cad, source_date, source) VALUES (%s, %s, %s, 'boc') "
        "ON CONFLICT (day) DO UPDATE SET usd_to_cad = EXCLUDED.usd_to_cad, "
        "source_date = EXCLUDED.source_date, source = EXCLUDED.source",
        (day, rate, day),
    )


def no_fx(admin, day):
    admin.execute("DELETE FROM public.fx_daily WHERE day = %s", (day,))


def due(admin, day, token=TOKEN, max_users=200):
    """{alert_id: value} for every rule claimed by this run (anon, as the cron route calls it)."""
    as_role(admin, "anon")
    try:
        doc = admin.execute(
            "SELECT public.get_due_alert_digests(%s, %s, %s)", (day, token, max_users)
        ).fetchone()[0]
        admin.execute("COMMIT")
    except Exception:
        rollback(admin)
        raise
    return {a["alert_id"]: a["value"] for d in doc["digests"] for a in d["alerts"]}, doc


def mark_sent(admin, day, alert_ids):
    as_role(admin, "anon")
    try:
        n = admin.execute(
            "SELECT public.record_alert_digest_sent(%s, %s::bigint[], %s)", (day, list(alert_ids), TOKEN)
        ).fetchone()[0]
        admin.execute("COMMIT")
        return n
    except Exception:
        rollback(admin)
        raise


def armed(admin, alert_id):
    return admin.execute("SELECT armed FROM public.price_alerts WHERE id = %s", (alert_id,)).fetchone()[0]


def d(today, n):
    return today - dt.timedelta(days=n)


class TestEvaluation:
    def test_crossing_fires_once_and_rerun_sends_nothing(self, admin, catalog, user, today):
        pid = product(admin, catalog)
        a = add_alert(admin, user, pid, "price_below", 181)
        stats(admin, d(today, 1), pid, 180)
        got, doc = due(admin, d(today, 1))
        assert got == {a: 180}
        digest = next(x for x in doc["digests"] if x["user_id"] == user)
        assert digest["email"].endswith("@example.com")
        assert len(digest["unsubscribe_token"]) == 36
        assert digest["alerts"][0]["set_name"].startswith("Evolving Skies")
        assert digest["alerts"][0]["type_label"] == "Booster Box"
        # Claimed but not yet sent: a concurrent second run gets nothing.
        assert a not in due(admin, d(today, 1))[0]
        assert mark_sent(admin, d(today, 1), [a]) == 1
        assert mark_sent(admin, d(today, 1), [a]) == 0
        assert a not in due(admin, d(today, 1))[0]
        row = admin.execute(
            "SELECT armed, last_fired_day, last_fired_value, last_evaluated_day FROM public.price_alerts WHERE id = %s",
            (a,),
        ).fetchone()
        assert row == (False, d(today, 1), 180, d(today, 1))

    def test_no_crossing_no_email(self, admin, catalog, user, today):
        pid = product(admin, catalog)
        a = add_alert(admin, user, pid, "price_below", 150)
        stats(admin, d(today, 1), pid, 180)
        assert a not in due(admin, d(today, 1))[0]
        assert armed(admin, a) is True

    def test_withheld_price_never_fires(self, admin, catalog, user, today):
        pid = product(admin, catalog)
        a = add_alert(admin, user, pid, "price_below", 500)
        stats(admin, d(today, 1), pid, None, price_day=d(today, 20), fresh=False)
        assert a not in due(admin, d(today, 1))[0]
        assert armed(admin, a) is True
        last = admin.execute("SELECT last_evaluated_day FROM public.price_alerts WHERE id = %s", (a,)).fetchone()[0]
        assert last is None  # not even evaluated

    def test_price_older_than_three_days_never_fires(self, admin, catalog, user, today):
        pid = product(admin, catalog)
        a = add_alert(admin, user, pid, "price_below", 500)
        stats(admin, d(today, 1), pid, 180, price_day=d(today, 5))  # fresh by 0023, but 4 days old
        assert a not in due(admin, d(today, 1))[0]

    def test_cad_threshold_uses_the_rate_of_the_price_day(self, admin, catalog, user, today):
        pid = product(admin, catalog)
        cad = add_alert(admin, user, pid, "price_below", 250, "CAD")
        usd = add_alert(admin, user, pid, "price_below", 181, "USD")
        fx(admin, d(today, 2), 1.36)   # the price's day
        fx(admin, d(today, 1), 1.50)   # the evaluation day: must not be used
        stats(admin, d(today, 1), pid, 180, price_day=d(today, 2))
        got = due(admin, d(today, 1))[0]
        assert got[cad] == pytest.approx(244.80)  # 180 x 1.36, rounded to cents
        assert got[usd] == pytest.approx(180)

    def test_cad_rule_skipped_without_a_rate(self, admin, catalog, user, today):
        pid = product(admin, catalog)
        cad = add_alert(admin, user, pid, "price_below", 250, "CAD")
        usd = add_alert(admin, user, pid, "price_below", 181, "USD")
        no_fx(admin, d(today, 3))
        stats(admin, d(today, 3), pid, 180)
        got = due(admin, d(today, 3))[0]
        assert cad not in got and usd in got

    def test_hysteresis_rearms_only_two_percent_past_the_threshold(self, admin, catalog, user, today):
        pid = product(admin, catalog)
        a = add_alert(admin, user, pid, "price_below", 250)
        stats(admin, d(today, 4), pid, 249)
        assert a in due(admin, d(today, 4))[0]
        mark_sent(admin, d(today, 4), [a])
        stats(admin, d(today, 3), pid, 254.99)       # back above 250, under 255.00
        assert a not in due(admin, d(today, 3))[0]
        assert armed(admin, a) is False
        stats(admin, d(today, 2), pid, 255.00)       # 250 x 1.02: re-armed, does not fire
        assert a not in due(admin, d(today, 2))[0]
        assert armed(admin, a) is True
        stats(admin, d(today, 1), pid, 248)
        assert a in due(admin, d(today, 1))[0]

    def test_percent_kinds(self, admin, catalog, user, today):
        p1, p2, p3 = product(admin, catalog), product(admin, catalog), product(admin, catalog)
        move = add_alert(admin, user, p1, "pct_move_7d", 10)
        ask = add_alert(admin, user, p2, "ask_below_market", 5)
        supply = add_alert(admin, user, p3, "supply_drop_30d", 20)
        stats(admin, d(today, 1), p1, 50, ret_7d=-11.24)
        stats(admin, d(today, 1), p2, 50, ask_premium_pct=-5.04)
        stats(admin, d(today, 1), p3, 50, qty_change_30d_pct=-19.9)
        got = due(admin, d(today, 1))[0]
        assert got[move] == pytest.approx(-11.2)
        assert got[ask] == pytest.approx(-5.0)
        assert supply not in got

    def test_paused_rule_does_not_fire_and_resume_rearms(self, admin, catalog, user, today):
        pid = product(admin, catalog)
        a = add_alert(admin, user, pid, "price_below", 500)
        admin.execute("UPDATE public.price_alerts SET active = false, armed = false WHERE id = %s", (a,))
        stats(admin, d(today, 1), pid, 180)
        assert a not in due(admin, d(today, 1))[0]
        as_user(admin, user)
        try:
            row = admin.execute(
                "UPDATE public.price_alerts SET active = true WHERE id = %s RETURNING armed", (a,)
            ).fetchone()
        finally:
            rollback(admin)
        assert row == (True,)

    def test_unconfirmed_email_and_disabled_digest_get_nothing(self, admin, catalog, today):
        pid = product(admin, catalog)
        pending = new_user(admin, confirmed=False)
        off = new_user(admin)
        try:
            a1 = add_alert(admin, pending, pid, "price_below", 500)
            a2 = add_alert(admin, off, pid, "price_below", 500)
            admin.execute("UPDATE public.alert_email_prefs SET digest_enabled = false WHERE user_id = %s", (off,))
            stats(admin, d(today, 1), pid, 180)
            got = due(admin, d(today, 1))[0]
            assert a1 not in got and a2 not in got
            assert armed(admin, a1) and armed(admin, a2)  # still armed for later
        finally:
            admin.execute("DELETE FROM auth.users WHERE id IN (%s, %s)", (pending, off))

    def test_stale_claim_is_retried_and_release_frees_it(self, admin, catalog, user, today):
        pid = product(admin, catalog)
        a = add_alert(admin, user, pid, "price_below", 500)
        stats(admin, d(today, 1), pid, 180)
        assert a in due(admin, d(today, 1))[0]
        admin.execute(
            "UPDATE public.alert_deliveries SET claimed_at = now() - interval '31 minutes' WHERE alert_id = %s", (a,)
        )
        assert a in due(admin, d(today, 1))[0]  # a crashed run is retried
        as_role(admin, "anon")
        try:
            freed = admin.execute(
                "SELECT public.release_alert_digest(%s, %s::bigint[], %s)", (d(today, 1), [a], TOKEN)
            ).fetchone()[0]
            admin.execute("COMMIT")
        except Exception:
            rollback(admin)
            raise
        assert freed == 1
        assert a in due(admin, d(today, 1))[0]

    def test_an_older_day_is_never_evaluated_after_a_newer_one(self, admin, catalog, user, today):
        pid = product(admin, catalog)
        a = add_alert(admin, user, pid, "price_below", 500)
        stats(admin, d(today, 1), pid, 600)
        stats(admin, d(today, 2), pid, 180)
        assert a not in due(admin, d(today, 1))[0]
        assert a not in due(admin, d(today, 2))[0]

    def test_max_users_truncates(self, admin, catalog, today):
        pid = product(admin, catalog)
        users = [new_user(admin) for _ in range(3)]
        try:
            for uid in users:
                add_alert(admin, uid, pid, "price_below", 500)
            stats(admin, d(today, 1), pid, 180)
            got, doc = due(admin, d(today, 1), max_users=1)
            assert doc["truncated"] is True
            assert len(doc["digests"]) == 1
        finally:
            for uid in users:
                admin.execute("DELETE FROM auth.users WHERE id = %s", (uid,))


class TestCronGate:
    def test_wrong_or_missing_token_is_refused(self, admin, today):
        for bad in ("x" * 52, None, TOKEN[:-1]):
            with pytest.raises(errors.InsufficientPrivilege):
                due(admin, d(today, 1), token=bad)

    def test_day_must_be_in_the_last_week_before_today(self, admin, today):
        for bad in (today, d(today, 8)):
            with pytest.raises(errors.InvalidParameterValue):
                due(admin, bad)

    def test_missing_vault_secret_fails_closed(self, admin, today):
        admin.execute("UPDATE vault.secrets SET name = 'parked' WHERE name = 'pokefin_cron_token'")
        try:
            with pytest.raises(errors.InsufficientPrivilege):
                due(admin, d(today, 1))
        finally:
            admin.execute("UPDATE vault.secrets SET name = 'pokefin_cron_token' WHERE name = 'parked'")

    def test_function_privileges(self, admin):
        def can(role, signature):
            return admin.execute(
                "SELECT has_function_privilege(%s, %s, 'EXECUTE')", (role, signature)
            ).fetchone()[0]

        for fn in (
            "public.get_due_alert_digests(date, text, integer)",
            "public.record_alert_digest_sent(date, bigint[], text)",
            "public.release_alert_digest(date, bigint[], text)",
        ):
            assert can("anon", fn) and not can("authenticated", fn), fn
        assert can("anon", "public.unsubscribe_alerts(uuid)")
        for internal in ("public.alert_evaluations(date)", "public.alert_cron_token_ok(text)"):
            assert not can("anon", internal) and not can("authenticated", internal), internal


class TestUnsubscribe:
    def test_idempotent_and_token_only(self, admin, catalog, user):
        pid = product(admin, catalog)
        add_alert(admin, user, pid, "price_below", 100)
        token = admin.execute(
            "SELECT unsubscribe_token FROM public.alert_email_prefs WHERE user_id = %s", (user,)
        ).fetchone()[0]

        def unsubscribe(tok):
            as_role(admin, "anon")
            try:
                out = admin.execute("SELECT public.unsubscribe_alerts(%s)", (tok,)).fetchone()[0]
                admin.execute("COMMIT")
                return out
            except Exception:
                rollback(admin)
                raise

        assert unsubscribe(token) == "unsubscribed"
        assert unsubscribe(token) == "already_unsubscribed"
        assert unsubscribe(uuid.uuid4()) == "unknown"
        row = admin.execute(
            "SELECT digest_enabled, unsubscribed_at IS NOT NULL, unsubscribe_token FROM public.alert_email_prefs "
            "WHERE user_id = %s",
            (user,),
        ).fetchone()
        assert row == (False, True, token)
        assert admin.execute("SELECT count(*) FROM public.price_alerts WHERE user_id = %s", (user,)).fetchone()[0] == 1


class TestAccess:
    def test_first_rule_creates_prefs_with_digest_on(self, admin, catalog, user):
        add_alert(admin, user, product(admin, catalog), "price_below", 100)
        row = admin.execute(
            "SELECT digest_enabled, unsubscribed_at FROM public.alert_email_prefs WHERE user_id = %s", (user,)
        ).fetchone()
        assert row == (True, None)

    def test_owner_only(self, admin, catalog, user):
        add_alert(admin, user, product(admin, catalog), "price_below", 100)
        other = new_user(admin)
        try:
            as_user(admin, other)
            try:
                assert admin.execute("SELECT count(*) FROM public.price_alerts").fetchone()[0] == 0
                assert admin.execute("SELECT count(*) FROM public.alert_email_prefs").fetchone()[0] == 0
                assert admin.execute("DELETE FROM public.price_alerts RETURNING 1").fetchall() == []
            finally:
                rollback(admin)
        finally:
            admin.execute("DELETE FROM auth.users WHERE id = %s", (other,))

    def test_cannot_insert_for_another_user(self, admin, catalog, user):
        pid = product(admin, catalog)
        other = new_user(admin)
        try:
            as_user(admin, other)
            try:
                with pytest.raises(errors.InsufficientPrivilege):  # 42501, RLS WITH CHECK
                    admin.execute(
                        "INSERT INTO public.price_alerts (user_id, product_id, kind, threshold, currency) "
                        "VALUES (%s, %s, 'price_below', 1, 'USD')",
                        (user, pid),
                    )
            finally:
                rollback(admin)
        finally:
            admin.execute("DELETE FROM auth.users WHERE id = %s", (other,))

    def test_rule_columns_are_read_only(self, admin, catalog, user):
        a = add_alert(admin, user, product(admin, catalog), "price_below", 100)
        for stmt in (
            "UPDATE public.price_alerts SET threshold = 1 WHERE id = %s",
            "UPDATE public.price_alerts SET armed = true WHERE id = %s",
            "UPDATE public.price_alerts SET last_fired_day = NULL WHERE id = %s",
        ):
            as_user(admin, user)
            try:
                with pytest.raises(errors.InsufficientPrivilege):
                    admin.execute(stmt, (a,))
            finally:
                rollback(admin)

    def test_token_column_is_not_readable(self, admin, catalog, user):
        add_alert(admin, user, product(admin, catalog), "price_below", 100)
        as_user(admin, user)
        try:
            with pytest.raises(errors.InsufficientPrivilege):
                admin.execute("SELECT unsubscribe_token FROM public.alert_email_prefs")
        finally:
            rollback(admin)

    def test_anon_and_scraper_have_no_table_access(self, admin):
        roles = ["anon"]
        if admin.execute("SELECT 1 FROM pg_roles WHERE rolname = 'pokefin_scraper'").fetchone():
            roles.append("pokefin_scraper")
        for role in roles:
            for table in ("price_alerts", "alert_email_prefs", "alert_deliveries"):
                as_role(admin, role)
                try:
                    with pytest.raises(errors.InsufficientPrivilege):
                        admin.execute(f"SELECT count(*) FROM public.{table}")
                finally:
                    rollback(admin)

    def test_checks(self, admin, catalog, user):
        pid = product(admin, catalog)
        for kind, threshold, currency in (
            ("pct_move_7d", 10, "CAD"),      # percent kinds are USD only
            ("pct_move_7d", 2, "USD"),       # below 3
            ("ask_below_market", 95, "USD"),  # above 90
            ("supply_drop_30d", 4, "USD"),   # below 5
            ("price_below", 0, "USD"),
            ("sold_out", 1, "USD"),
        ):
            with pytest.raises(errors.CheckViolation):
                add_alert(admin, user, pid, kind, threshold, currency)

    def test_duplicate_rule_is_a_unique_violation(self, admin, catalog, user):
        pid = product(admin, catalog)
        add_alert(admin, user, pid, "price_below", 100, "CAD")
        with pytest.raises(errors.UniqueViolation):
            add_alert(admin, user, pid, "price_below", 100, "CAD")

    def test_cap_of_50(self, admin, catalog, user):
        pid = product(admin, catalog)
        as_user(admin, user)
        try:
            admin.execute(
                "INSERT INTO public.price_alerts (user_id, product_id, kind, threshold, currency) "
                "SELECT %s, %s, 'price_below', g, 'USD' FROM generate_series(1, %s) g",
                (user, pid, CAP),
            )
            with pytest.raises(errors.CheckViolation):
                admin.execute(
                    "INSERT INTO public.price_alerts (user_id, product_id, kind, threshold, currency) "
                    "VALUES (%s, %s, 'price_above', 1, 'USD')",
                    (user, pid),
                )
        finally:
            rollback(admin)


class TestExportAndCascade:
    def test_export_includes_rules_and_prefs_without_token(self, admin, catalog, user, today):
        pid = product(admin, catalog)
        a = add_alert(admin, user, pid, "price_below", 500)
        stats(admin, d(today, 1), pid, 180)
        due(admin, d(today, 1))
        mark_sent(admin, d(today, 1), [a])
        as_user(admin, user)
        try:
            doc = admin.execute("SELECT public.export_my_data()").fetchone()[0]
        finally:
            rollback(admin)
        rules = doc["price_alerts"]
        assert [r["id"] for r in rules] == [a]
        assert rules[0]["deliveries"][0]["day"] == d(today, 1).isoformat()
        assert doc["alert_email"]["digest_enabled"] is True
        assert "unsubscribe_token" not in doc["alert_email"]
        assert "watchlist" in doc  # 0038's key kept

    def test_account_deletion_removes_everything(self, admin, catalog, today):
        uid = new_user(admin)
        pid = product(admin, catalog)
        a = add_alert(admin, uid, pid, "price_below", 500)
        stats(admin, d(today, 1), pid, 180)
        due(admin, d(today, 1))
        admin.execute("DELETE FROM auth.users WHERE id = %s", (uid,))
        for table, col in (("price_alerts", "user_id"), ("alert_email_prefs", "user_id")):
            assert admin.execute(f"SELECT count(*) FROM public.{table} WHERE {col} = %s", (uid,)).fetchone()[0] == 0
        assert admin.execute("SELECT count(*) FROM public.alert_deliveries WHERE alert_id = %s", (a,)).fetchone()[0] == 0
```

If a fixture INSERT fails with `NotNullViolation` or `CheckViolation` because `products`, `sets` or `product_types` carry a required column the fixture omits (for example after WP28), add that column with a valid value, as WP34's note says. Never weaken an assertion. The module replaces the Vault secret `pokefin_cron_token` in the test database and restores the `fx_daily` rows of the last 12 days when it ends.

### 2. `tests/test_wp35_price_alerts_static.py` (new, no database)

```python
"""
Static checks for migration 0039 and its TypeScript mirror (WP35). No database.

  python -m pytest tests/test_wp35_price_alerts_static.py -v
"""
import importlib.util
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
MIGRATION = ROOT / "migrations" / "0039_price_alerts.sql"
ALERTS_TS = ROOT / "frontend" / "app" / "lib" / "alerts.ts"
BOOTSTRAP = ROOT / "scripts" / "db" / "ci_bootstrap.sql"
VERCEL_JSON = ROOT / "frontend" / "vercel.json"


def sql() -> str:
    return re.sub(r"--[^\n]*", "", MIGRATION.read_text())


def ts() -> str:
    return ALERTS_TS.read_text()


def function_body(name: str) -> str:
    match = re.search(
        rf"CREATE OR REPLACE FUNCTION public\.{name}\(.*?AS \$\$(.*?)\$\$;", sql(), re.S
    )
    assert match, name
    return match.group(1)


def test_cap_matches_the_frontend_constant():
    sql_cap = re.search(r"enforce_owner_row_cap\('user_id', '(\d+)'\)", sql()).group(1)
    ts_cap = re.search(r"export const ALERTS_MAX_PER_USER = (\d+);", ts()).group(1)
    assert sql_cap == ts_cap == "50"


def test_kinds_match():
    sql_kinds = re.findall(r"'(\w+)'", re.search(r"kind IN \(([^)]*)\)\),", sql()).group(1))
    ts_kinds = re.findall(r'"(\w+)"', re.search(r"ALERT_KINDS = \[(.*?)\] as const", ts(), re.S).group(1))
    assert sql_kinds == ts_kinds
    assert len(ts_kinds) == 5


def test_threshold_ranges_match():
    sql_ranges = {
        kind: (float(lo), float(hi))
        for kind, lo, hi in re.findall(r"WHEN '(\w+)'\s+THEN threshold BETWEEN ([\d.]+) AND ([\d.]+)", sql())
    }
    ts_ranges = {
        kind: (float(lo.replace("_", "")), float(hi.replace("_", "")))
        for kind, lo, hi in re.findall(r'(\w+): \{ kind: "\w+", label: "[^"]*", unit: "\w+", min: ([\d._]+), max: ([\d._]+)', ts())
    }
    assert sql_ranges == ts_ranges
    assert len(ts_ranges) == 5


def test_hysteresis_and_age_constants_match():
    body = function_body("alert_evaluations")
    for fragment in (
        "b.threshold * 1.02",
        "b.threshold * 0.98",
        "abs(b.value) <= b.threshold - 2",
        "b.value >= -b.threshold + 2",
        "s.price_day >= p_day - 3",
        "s.is_price_fresh",
    ):
        assert fragment in body, fragment
    assert "export const ALERT_REARM_PRICE_FACTOR = 0.02;" in ts()
    assert "export const ALERT_REARM_POINTS = 2;" in ts()
    assert "export const ALERT_MAX_PRICE_AGE_DAYS = 3;" in ts()


@pytest.mark.parametrize("name", ["get_due_alert_digests", "record_alert_digest_sent", "release_alert_digest"])
def test_cron_functions_check_the_token_before_anything_else(name):
    body = function_body(name)
    first_statement = body.split("BEGIN", 1)[1].strip().splitlines()[0]
    assert first_statement == "IF NOT public.alert_cron_token_ok(p_token) THEN"


def test_token_compare_has_no_early_exit():
    body = function_body("alert_cron_token_ok")
    assert "FOR i IN 0..31 LOOP" in body and "v_diff := v_diff |" in body
    assert "vault.decrypted_secrets" in body and "'pokefin_cron_token'" in body


def test_export_keeps_every_key_and_hides_the_token():
    body = function_body("export_my_data")
    for key in ("'watchlist'", "'box_recipes'", "'portfolios'", "'price_alerts'", "'alert_email'"):
        assert key in body, key
    assert "unsubscribe_token" not in body


def _volatility_module():
    path = ROOT / "tests" / "test_migration_volatility.py"
    if not path.exists():
        pytest.skip("tests/test_migration_volatility.py not in this tree")
    spec = importlib.util.spec_from_file_location("wp35_migration_volatility", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_effective_export_includes_alerts():
    name, volatility, body = _volatility_module().effective_functions()["public.export_my_data"]
    assert volatility == "VOLATILE", name
    assert "'price_alerts'" in body and "'alert_email'" in body and "'watchlist'" in body, (
        f"{name} is the effective export_my_data and drops a key; a migration that replaces "
        "export_my_data must keep watchlist (WP34) and price_alerts and alert_email (WP35)"
    )


def test_migration_is_rerunnable():
    text = sql()
    assert text.count("CREATE TABLE IF NOT EXISTS public.") == 3
    for policy in re.findall(r"CREATE POLICY (\w+)", text):
        assert f"DROP POLICY IF EXISTS {policy}" in text
    for trigger in re.findall(r"CREATE TRIGGER (\w+)", text):
        assert f"DROP TRIGGER IF EXISTS {trigger}" in text
    assert "FOR ALL" not in text


def test_vault_stand_in_is_in_the_ci_bootstrap():
    text = BOOTSTRAP.read_text()
    assert "CREATE OR REPLACE VIEW vault.decrypted_secrets" in text
    assert "CREATE OR REPLACE FUNCTION vault.create_secret" in text


def test_cron_schedule():
    crons = json.loads(VERCEL_JSON.read_text())["crons"]
    assert crons == [{"path": "/api/cron/alerts", "schedule": "5 11 * * *"}]
```

### 3. `frontend/app/lib/__tests__/alerts.test.ts` (new, node)

- `parseAlertInput`: `{ product_id: 42, kind: "price_below", threshold: 249.999, currency: "CAD" }` gives `{ productId: 42, kind: "price_below", threshold: 250, currency: "CAD" }`; `pct_move_7d` with `currency: "CAD"` is stored as `"USD"`; rejects `null`, an array, `product_id: "42"`, `kind: "sold_out"`, `threshold: "250"`, `threshold: NaN`, `price_below` with `currency: "EUR"`, `pct_move_7d` 2 and 101, `ask_below_market` 0.5 and 91, `supply_drop_30d` 4 and 96, `price_below` 0 and 1000001.
- `thresholdError`: `null` at each kind's `min` and `max`; the money and percent sentences outside.
- `parseThresholdText`: `"551.16"` 551.16, `"1,234.50"` 1234.5, `"C$ 250"` 250, `"US$250"` 250, `"10 %"` 10; `""`, `"-5"`, `"abc"`, `"1.2.3"` give `null`.
- `formatThresholdInput`: money `551.1` gives `"551.10"`, percent `7.56` gives `"7.6"`, percent `10` gives `"10"`.
- `describeRule`, `describeValue`, `rearmText`: the exact strings of the Design section for each kind, including `price_below` 250 CAD re-arm "C$255.00", `price_above` 250 CAD "C$245.00", `ask_below_market` with threshold 1 "1% or more above Market Price" and threshold 2 "at or above Market Price".
- `productNameFromParts` equals WP13's `getProductDisplayName` for the same product with and without a variant and with a missing type label.
- `suggestionsFor`: the ctx of the Design screen (CAD 612.40, MSRP CAD 215.99) gives `[{ label: "10% below now: C$551.16", value: 551.16 }, { label: "Back to Canadian MSRP: C$215.99", value: 215.99 }]`; USD with `msrpUsd: null` gives only the 10% chip; `price_above` gives "10% above now"; MSRP above the current price gives no MSRP chip; percent kinds give their presets in order; `ctx` null gives `[]` for money kinds.
- `ruleIsTrueNow`: true at exactly the level (rounded to cents), false one cent away; uses `cadPrice` for CAD; false when `priceStatus` is not `priced`.
- `contextLine`: priced with and without `cadPrice`, withheld, never, `null`.
- `alertStatusText`: untracked, paused, fired (with the re-arm sentence), checked, never checked.
- `isAlertsPayload` accepts a valid payload and rejects `null`, an entry with `kind: "x"`, a missing `available`, `prefs: null`.
- `ALERT_KIND_META` has one entry per `ALERT_KINDS` value; every label contains no banned word ("live", "real-time", "instant").

### 4. `frontend/app/lib/server/__tests__/dueDigests.test.ts` (new, node)

- `parseDueDigests` keeps a valid document (the one in Test 7) unchanged, coerces numeric strings (`"244.80"`), drops an alert with an unknown kind or a bad `price_day`, drops a digest without `@` in the email, with a non-UUID token or with no valid alert, and returns `null` for `null`, a missing `day` or a `digests` that is not an array.
- `alertEvaluationDay(new Date("2026-09-30T11:05:00Z"))` is `"2026-09-29"`; `new Date("2026-10-01T00:10:00Z")` gives `"2026-09-30"`; `new Date("2027-01-01T03:00:00Z")` gives `"2026-12-31"`.

### 5. `frontend/app/lib/email/__tests__/emailTheme.test.ts` (new, node)

Read `app/globals.css` with `fs`; for each `[key, token]` of `EMAIL_THEME_TOKENS`, find `token: <value>;` (regex `new RegExp(`${token}:\\s*([^;]+);`)`) and expect `EMAIL_THEME[key]` to equal the value lower-cased. If the value is `var(--other)`, resolve that token once more (Before you start default). Also expect every `EMAIL_THEME` value to match `/^#[0-9a-f]{6}$/`.

### 6. `frontend/app/lib/email/__tests__/alertDigest.test.ts` (new, node)

Set `process.env.NEXT_PUBLIC_SITE_URL = "https://www.pokefin.ca"` before importing. Use the document of Test 7 plus a second alert `{ alert_id: 8, product_id: 43, kind: "pct_move_7d", threshold: 10, currency: "USD", value: -11.2, usd_price: 50, price_day: "2026-09-29", usd_to_cad: 1.36, set_name: "Scarlet & Violet 151", type_name: "etb", type_label: "Elite Trainer Box", variant: "<b>PC</b>" }`.

- Two alerts: subject `"2 price alerts for Sep 29"`; one alert: `"Price alert: Evolving Skies Booster Box"`.
- Text contains, in order: "Your price alerts for Sep 29, 2026", "Checked once a day after prices update, against TCGplayer Market Price for Sep 29, 2026 (UTC).", "Evolving Skies Booster Box", "Price at or below C$250.00", "Market Price C$244.80 ($180.00 USD at the Bank of Canada rate of Sep 29)", "TCGplayer Market Price as of Sep 29, 2026", "https://www.pokefin.ca/product/42", "▼ Down 11.2% over 7 days (USD Market Price)", "Manage your alerts: https://www.pokefin.ca/portfolio/watchlist#alerts", `FOOTER_DISCLAIMER`, "Stop alert emails: https://www.pokefin.ca/alerts/unsubscribe?t=6df8849b-e42c-418f-809e-928afc16e65d", "Pokéfin, PO Box 123, Station A, Toronto ON M5W 1A2, Canada. Contact: hello@pokefin.ca".
- `headers` equal `{ "List-Unsubscribe": "<https://www.pokefin.ca/api/alerts/unsubscribe?t=6df8849b-e42c-418f-809e-928afc16e65d>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }`.
- HTML contains `&lt;b&gt;PC&lt;/b&gt;` and never `<b>PC</b>`; contains every link of the text part as an `href`; contains no `var(--` and no `class=`.
- Neither part contains "live", "real-time", "instant", "TCGPlayer" or an em dash (regex `/\u2014/`).
- Snapshot: `expect(message.html).toMatchSnapshot()` and `expect(message.text).toMatchSnapshot()`. Create the snapshot once locally without `--ci` (`pnpm exec jest app/lib/email/__tests__/alertDigest.test.ts`), read it, and commit `__snapshots__/alertDigest.test.ts.snap`; CI runs with `--ci` and fails on a missing snapshot.

### 7. `frontend/app/api/cron/alerts/__tests__/route.test.ts` (new, node): auth, Brevo mock, idempotent re-run

```ts
/** @jest-environment node */
import { NextRequest } from "next/server";

const rpc = jest.fn();
jest.mock("../../../../lib/server/anonRpcSupabase", () => ({ createAnonRpcClient: () => ({ rpc }) }));
jest.mock("../../../../content/disclosures", () => ({
  ...jest.requireActual("../../../../content/disclosures"),
  MAILING_ADDRESS: "PO Box 123, Station A, Toronto ON M5W 1A2, Canada",
}));

import { GET } from "../route";

const SECRET = "s".repeat(64);
const TOKEN = "6df8849b-e42c-418f-809e-928afc16e65d";
const DOC = {
  day: "2026-09-29",
  stats_rows: 306,
  evaluated: 3,
  rearmed: 0,
  due_users: 1,
  truncated: false,
  digests: [
    {
      user_id: "00000000-0000-0000-0000-00000000000a",
      email: "collector@example.com",
      unsubscribe_token: TOKEN,
      alerts: [
        {
          alert_id: 7,
          product_id: 42,
          kind: "price_below",
          threshold: 250,
          currency: "CAD",
          value: 244.8,
          usd_price: 180,
          price_day: "2026-09-29",
          usd_to_cad: 1.36,
          set_name: "Evolving Skies",
          type_name: "booster_box",
          type_label: "Booster Box",
          variant: null,
        },
      ],
    },
  ],
};
const EMPTY = { ...DOC, due_users: 0, digests: [] };

const fetchMock = jest.fn();
const realFetch = global.fetch;

function call(authorization?: string) {
  return GET(
    new NextRequest("https://www.pokefin.ca/api/cron/alerts", {
      headers: authorization ? { authorization } : {},
    })
  );
}

function getDue(doc: unknown) {
  rpc.mockImplementation(async (name: string) =>
    name === "get_due_alert_digests" ? { data: doc, error: null } : { data: 1, error: null }
  );
}

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = realFetch;
});

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  process.env.POKEFIN_CRON_TOKEN = "k".repeat(64);
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.pokefin.ca";
  jest.useFakeTimers({ now: new Date("2026-09-30T11:05:00Z"), doNotFake: ["setTimeout", "setImmediate", "nextTick", "queueMicrotask"] });
  rpc.mockReset();
  fetchMock.mockReset();
  getDue(DOC);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ messageId: "<m1@brevo>" }), { status: 201 }));
});

afterEach(() => {
  jest.useRealTimers();
});

it("answers 503 and touches nothing when CRON_SECRET is unset or short", async () => {
  delete process.env.CRON_SECRET;
  expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
  process.env.CRON_SECRET = "short";
  expect((await call("Bearer short")).status).toBe(503);
  expect(rpc).not.toHaveBeenCalled();
});

it("answers 401 without the right bearer", async () => {
  expect((await call()).status).toBe(401);
  expect((await call(`Bearer ${SECRET}x`)).status).toBe(401);
  expect((await call(SECRET)).status).toBe(401);
  expect(rpc).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("answers 503 when the Brevo key or the cron token is missing", async () => {
  delete process.env.BREVO_API_KEY;
  expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.POKEFIN_CRON_TOKEN = "short";
  expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
  expect(rpc).not.toHaveBeenCalled();
});

it("a fixture day with one crossing sends exactly one email and records it", async () => {
  const res = await call(`Bearer ${SECRET}`);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = await res.json();
  expect(body).toMatchObject({ status: "ok", day: "2026-09-29", sent: 1, failed: 0 });
  expect(JSON.stringify(body)).not.toContain("@");

  expect(rpc).toHaveBeenCalledWith("get_due_alert_digests", {
    p_day: "2026-09-29",
    p_token: "k".repeat(64),
    p_max_users: 200,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://api.brevo.com/v3/smtp/email");
  expect(init.headers["api-key"]).toBe("xkeysib-test");
  const sent = JSON.parse(init.body);
  expect(sent.to).toEqual([{ email: "collector@example.com" }]);
  expect(sent.sender).toEqual({ name: "Pokéfin alerts", email: "alerts@pokefin.ca" });
  expect(sent.replyTo).toEqual({ email: "hello@pokefin.ca" });
  expect(sent.subject).toBe("Price alert: Evolving Skies Booster Box");
  expect(sent.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  expect(sent.headers["List-Unsubscribe"]).toBe(`<https://www.pokefin.ca/api/alerts/unsubscribe?t=${TOKEN}>`);
  expect(rpc).toHaveBeenCalledWith("record_alert_digest_sent", { p_day: "2026-09-29", p_alert_ids: [7], p_token: "k".repeat(64) });
  expect(rpc).not.toHaveBeenCalledWith("release_alert_digest", expect.anything());
});

it("re-running the cron the same day sends none", async () => {
  await call(`Bearer ${SECRET}`);
  getDue(EMPTY); // the database has claimed and sent the rule: it returns nothing now
  fetchMock.mockClear();
  const res = await call(`Bearer ${SECRET}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok", sent: 0 });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("releases the claim when Brevo refuses, and answers 500", async () => {
  fetchMock.mockResolvedValue(new Response("{}", { status: 400 }));
  const res = await call(`Bearer ${SECRET}`);
  expect(res.status).toBe(500);
  expect(await res.json()).toMatchObject({ status: "partial", sent: 0, failed: 1 });
  expect(fetchMock).toHaveBeenCalledTimes(1); // 400 is not retried
  expect(rpc).toHaveBeenCalledWith("release_alert_digest", { p_day: "2026-09-29", p_alert_ids: [7], p_token: "k".repeat(64) });
});

it("retries once on 429", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response("{}", { status: 429 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ messageId: "<m2@brevo>" }), { status: 201 }));
  const res = await call(`Bearer ${SECRET}`);
  expect(await res.json()).toMatchObject({ status: "ok", sent: 1 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
}, 10_000);

it("reports a day without statistics and sends nothing", async () => {
  getDue({ ...EMPTY, stats_rows: 0 });
  const res = await call(`Bearer ${SECRET}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "no_stats" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("answers 500 when the evaluation fails", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
  expect((await call(`Bearer ${SECRET}`)).status).toBe(500);
  expect(fetchMock).not.toHaveBeenCalled();
});
```

Also add a case to `app/lib/server/__tests__/alertDigestJob.test.ts` (new, node), driving `runAlertDigestJob` directly with fake `rpc`, `send` and `sleep`: 7 digests and `concurrency: 5` send 7 emails with at most 5 in flight (count concurrent `send` calls with a deferred promise); a `recordSent` that throws counts `recordFailed: 1`, status `partial`, and does not release; a `render` that throws counts as failed and releases; `log` never receives a string containing "@"; `readAlertSendConfig` returns each of the three errors and the trimmed address.

### 8. `frontend/app/lib/email/__tests__/brevo.test.ts` (new, node)

With an injected `fetchImpl`: the request is `POST` to `BREVO_SEND_URL` with `api-key`, JSON `sender`, `to`, `replyTo`, `subject`, `htmlContent`, `textContent`, `headers`, `tags: ["price-alerts"]`; 201 with `messageId` gives `{ ok: true, messageId }`; 201 without JSON gives `messageId: null`; 400 gives `retryable: false`; 429 and 503 give `retryable: true`; a rejected fetch gives `{ ok: false, status: 0, retryable: true }`.

### 9. `frontend/app/api/alerts/__tests__/route.test.ts` (new, node)

Mock `routeSupabase` (WP05 pattern, a chainable query builder), `alertsConfig` (`alertsAvailable` returns `true` unless a case sets `false`), `serverMarketData` (one priced product 42, stats matching its price with `ret_7d` 3.4, an fx series with 1.36 on its price day, attributes with `msrp_cad` 215.99) and `watchlistRepo.addWatch`.

- GET without `x-pokefin-request` is 403; signed out is 401; `?product_id=abc` is 400.
- GET lists the caller's rules mapped by `toAlertEntry` (a row with `kind: "x"` is skipped), `count`, `max: 50`, `prefs` (no row gives `{ exists: false, digestEnabled: true, unsubscribedAt: null }`), `email`, `available`; with `?product_id=42` only that product's rules and `context` (`cadPrice` 244.8 for USD 180 at 1.36, `change7d` 3.4, `msrpCad` 215.99); an unknown product gives `context: null`; a summaries failure gives 500. Every query filters `user_id` (assert the `.eq("user_id", ...)` call) and the prefs select is `"digest_enabled, unsubscribed_at"`.
- POST without CSRF headers is 403; a 600-byte body is 413; `alertsAvailable` false is 503 with `ALERTS_UNAVAILABLE_MESSAGE`; invalid bodies are 400 with the parser's message; created is 201 `{ status: "created", id, watched: "added" }` and calls `addWatch` once; `addWatch` returning `"full"` gives `watched: "skipped"` and still 201; 23505 is 200 `{ status: "exists" }`; 23503 is 404; 23514 with "price_alerts row limit reached" and no same rule is 409 with `code: "alerts_full"`; the same with the rule present is 200 exists; 23514 with another message is 400.
- PATCH `{ id: 7, active: false }` updates with `.eq("id", 7).eq("user_id", ...)`, 200; not found 404; `{ digest_enabled: false }` returns `prefs`; no prefs row is 404 "Set an alert first."; `{ id: 7, active: false, extra: 1 }` and `{ digest_enabled: "no" }` are 400.
- DELETE `?id=7` is 200 `{ status: "deleted" }`; a missing row is `{ status: "absent" }`; `?id=0` is 400.

### 10. `frontend/app/api/alerts/unsubscribe/__tests__/route.test.ts` (new, node): unsubscribe idempotency

Mock `anonRpcSupabase` with `rpc` returning, in order, `"unsubscribed"` then `"already_unsubscribed"`.

- One-click: `POST /api/alerts/unsubscribe?t=<TOKEN>` with body `List-Unsubscribe=One-Click` and `content-type: application/x-www-form-urlencoded`, and no `x-pokefin-request` or Origin header: 200, `text/plain`, `cache-control: no-store`; `rpc` called with `("unsubscribe_alerts", { p_token: TOKEN })`. The same request again: 200 (idempotent, `already_unsubscribed`).
- Upper-case token in the query is lower-cased before the call.
- Unknown token (`rpc` returns `"unknown"`): 200 with the same body as success (no oracle).
- No token or a malformed token: 200 and `rpc` not called.
- Page form: body `t=<TOKEN>&from=page`: 303 with `location` ending `/alerts/unsubscribe?status=unsubscribed`; a database error (`{ error: {...} }`) gives 303 to `status=error`, and the one-click variant gives 500.
- The module exports no `GET` (`expect((await import("../route")).GET).toBeUndefined()`).

### 11. `frontend/app/alerts/unsubscribe/__tests__/page.test.tsx` (new, jsdom)

Render the async page with `await AlertUnsubscribePage({ searchParams: Promise.resolve({ t: TOKEN }) })` then `render(...)`:
- valid token: heading "Stop price alert emails", a `form` with `method="post"`, `action="/api/alerts/unsubscribe"`, hidden inputs `t` = TOKEN and `from` = `page`, a button "Stop alert emails"; no link to the API with the token as `href` (no GET path acts).
- `{ t: "nope" }` and `{}`: the invalid copy, no form.
- `{ status: "unsubscribed" }`, `"already_unsubscribed"`, `"unknown"`, `"error"`: the matching `UNSUBSCRIBE_COPY` title and body, a link "Go to your watchlist" to `/portfolio/watchlist`.
- `metadata.robots` is `NO_INDEX` and `metadata.referrer` is `"no-referrer"`. axe: no violations in each state.

### 12. `frontend/app/components/alerts/__tests__/AlertDialog.test.tsx` (new, jsdom)

Mock `fetch` with a payload of 1 existing rule, `count: 1`, `available: true`, `email: "collector@example.com"`, and the ctx of the Design screen; mock `useCurrency` to `{ currency: "CAD" }` and `watchlistStore.noteWatched`.

- While loading: `role="status"` "Loading your alerts"; Save is disabled.
- Loaded: the product name, "Market Price C$612.40 ($446.10 USD), Sep 29", the radio "Price falls to or below" checked, the input labelled "Price (C$)" with value "551.16", the chips "10% below now: C$551.16" and "Back to Canadian MSRP: C$215.99", the help with "Checked once a day after prices update." and the email, the link "How alerts work" to `/methodology#alerts`, and the existing rule under "Your alerts for this product".
- Selecting "Price moves up or down within 7 days" shows the input "Move of at least (%)" with "10", hides the currency control, shows chips "10%", "5%", "20%" and "Now: Up 3.4% over 7 days.".
- Typing "abc" and saving shows "Enter a number." with `aria-invalid="true"`, and focus is on the input; with the 7-day kind selected, "2" shows "Enter a percentage from 3 to 100.".
- Clicking the MSRP chip then Save posts `{ product_id: 42, kind: "price_below", threshold: 215.99, currency: "CAD" }` with `x-pokefin-request: 1`; on `{ status: "created", watched: "added" }` the status reads "Alert saved. Checked once a day after prices update. The product is now on your watchlist.", `noteWatched(42, true)` was called, the list reloads (a second GET).
- A 409 answer shows `ALERTS_FULL_MESSAGE` under the input; `count: 50` in the payload disables Save and shows it upfront.
- A threshold above the current CAD price for `price_below` shows "Already true at the latest price: it will be in your next digest.".
- `available: false` shows "Price alerts are not available yet." and disables Save; `context: null` shows the untracked line and disables Save.
- Pause and Delete on the existing rule send PATCH and DELETE and show "Alert paused." and "Alert deleted."; after Delete focus is on the status line.
- axe: no violations (loading and loaded).

### 13. `frontend/app/components/alerts/__tests__/AlertsPanel.test.tsx` and `AlertButton.test.tsx` (new, jsdom)

AlertsPanel, with a hand-built `AlertList`:
- loading: three bars and "Loading your alerts"; failed: "Your alerts could not be loaded." and "Try again" calls `reload`.
- ready with no rules and `prefs.exists` false: `EmptyState` "No price alerts yet", no digest line.
- ready with three rules: "3 of 50 alerts." and the provenance; "Daily digest on, sent to collector@example.com." with "Turn off emails" (PATCH `{ digest_enabled: false }`, then status "Alert emails turned off." and `reload` called); rows show product links, rule sentences and the status sentences of `alertStatusText`; button names like "Pause alert: Price at or below C$250.00 for Evolving Skies Booster Box".
- digest off with `unsubscribedAt` "2026-09-30T12:00:00Z": the warn line "Alert emails are off since Sep 30. Your alerts are still checked, but nothing is sent." and "Turn on emails".
- `available: false`: renders nothing.
- With `window.location.hash = "#alerts"`, `scrollIntoView` (mocked on `Element.prototype`) is called once after ready.
- axe: no violations.

AlertButton (mock `next/dynamic` to return the mocked `./AlertDialog` component synchronously, mock `useAuth` and `useRouter`):
- session unknown: "Alert me" with `aria-disabled="true"`, a click does nothing.
- anonymous: a click pushes `/auth/login?next=%2Fproduct%2F42&watch=42` (with `window.location` set to `/product/42`).
- authenticated: a click renders the dialog with `productId` 42; its `onClose` removes it.
- `aria-haspopup="dialog"`; the bell svg is `aria-hidden`. axe: no violations.

### 14. `frontend/app/__tests__/alertIsland.source.test.ts` (new, node): ISR and bundle guard

Read the sources with `fs`:
- `app/components/alerts/AlertButton.tsx` contains `dynamic(() => import("./AlertDialog")` and imports none of `lib/alerts`, `lib/alertsApi`, `lib/format`, `lib/redirects`, `lib/loginCopy`, `useSearchParams`.
- `app/product/[id]/page.tsx` contains `alert={` and none of `cookies(`, `headers(`, `searchParams`, `export const dynamic`.
- `app/api/alerts/unsubscribe/route.ts` exports `POST` only and does not import `rejectIfCsrfFails`.
- `app/api/cron/alerts/route.ts` contains `export const dynamic = "force-dynamic"` and `bearerMatches(`.
- No file under `app/` outside `app/lib/server/alertsRepo.ts` and `__tests__` contains `from("price_alerts")` or `from("alert_email_prefs")`; no file contains `from("alert_deliveries")`.
- No file under `app/` except `app/content/disclosures.ts` assigns `MAILING_ADDRESS`.

### 15. WP34 tests to extend

- `app/portfolio/watchlist/__tests__/WatchlistView.test.tsx`: mock the alerts `fetch` (GET `/api/alerts`) with two rules on product 42; the table shows an "Alerts" column whose button "Alerts for Evolving Skies Booster Box" shows "2"; clicking it opens the dialog (mock `next/dynamic` as in Test 13); the "Price alerts" section renders below the watchlist and also when the watchlist is empty; with `available: false` neither the column nor the section renders.
- `app/components/watchlist/__tests__/WatchlistTable.test.tsx` and the phone list test, if WP34 has them: without `onAlert` the markup is unchanged (no "Alerts" header, no bell).

## Verification

From `frontend/` unless noted. Record every output for the PR.

Block 1, static:

```bash
pnpm exec tsc --noEmit            # phase A: errors only for the new tables and RPCs in alertsRepo.ts and the two
                                  # routes (not in database.ts yet); phase B: exit 0
pnpm lint                         # 0 errors
grep -rnP '\x{2014}' app/lib/alerts.ts app/lib/email app/components/alerts app/alerts app/api/alerts app/api/cron ../migrations/0039_price_alerts.sql   # no output
grep -rniE "\binstant\b|real-time|\blive\b|TCGPlayer" app/lib/alerts.ts app/lib/email app/components/alerts app/alerts   # no output
cat vercel.json                   # the cron block of step 15
```

Block 2, tests:

```bash
pnpm exec jest app/lib/email/__tests__/alertDigest.test.ts      # once, without --ci: writes the snapshot; review it
pnpm test --ci                                                  # all pass; the new suites of Tests 3 to 15 included
pnpm exec jest --ci app/api/cron app/api/alerts app/alerts app/components/alerts app/lib/email app/lib/server app/lib/__tests__/alerts.test.ts app/__tests__/alertIsland.source.test.ts
cd .. && python -m pytest tests/test_wp35_price_alerts_static.py -q        # 13 passed
# Database (WP21 harness, local Postgres):
PGSERVER_URL=postgresql://postgres:postgres@localhost:55432/postgres scripts/db/replay_migrations.sh   # OK: ... replayed once and twice
POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once python -m pytest tests/test_wp35_price_alerts_db.py -v   # 29 passed
POKEFIN_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/replay_once python -m pytest tests/ -q   # all pass (WP34's export test still passes)
```

Block 3, performance (WP22):

```bash
SUPABASE_STUB_FIXTURE=perf pnpm build:stub      # exit 0, no endpoint without a fixture route
pnpm perf:budget --write-limits                 # only "/alerts/unsubscribe" gains limit and recorded
git diff perf-budgets.json                      # no other limit went up
pnpm perf:budget                                # exit 0
```

Expected: `/product/900001` JS gz grows by at most about 1.5 kB (the island; report the number), every lazy chunk stays under 120 kB gz (the dialog chunk is about 6 to 9 kB gz), `/portfolio/watchlist` stays within its limit, CSS within 14 kB gz.

Block 4, manual (`pnpm dev` against the stub or a branch database, signed in as a test user, with `MAILING_ADDRESS` set locally to a test string; do not commit it):
- 1440 px, `/product/<id>`: "Alert me" sits after Watch; hover preloads one chunk (Network); click opens the dialog with focus in the input; Escape closes it and focus returns to the button. Save a "Price falls to or below" alert at the 10% chip; the status line and the rule appear; the Watch star is now filled.
- 390 px, same page: the actions wrap without overflow, the dialog fits with 16 px gutters, radio rows and chips are at least 44 px tall (DevTools, touch emulation), the keyboard does not zoom (16 px input).
- 1440 px, `/portfolio/watchlist`: the Alerts column shows the bell with "1"; the "Price alerts" section lists the rule; Pause shows "Paused", Resume shows "Waiting..."; "Turn off emails" shows the warn line; "Turn on emails" restores it; `/portfolio/watchlist#alerts` scrolls to the section after load.
- 390 px, `/portfolio/watchlist`: each row has the bell and the remove button as siblings of the row link; the section stacks with 44 px buttons; no horizontal scroll.
- Signed out, `/product/<id>`: "Alert me" goes to sign-in with the watch subtitle; after sign-in the product is watched.
- `/alerts/unsubscribe?t=<a real token from the branch database>` shows the button; submitting it lands on "Alert emails are off"; submitting the same link again lands on "Alert emails were already off"; `/alerts/unsubscribe` alone shows "This link is not valid".
- `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/cron/alerts` prints 401 (or 503 when `CRON_SECRET` is unset).

Block 5, phase B and production (after Owner actions 1 to 7):

```bash
pnpm types:db && pnpm exec tsc --noEmit      # exit 0
```

Then, on production, with a test account that has a confirmed email: create a "Price falls to or below" alert above the current price of any product (it is already true), and trigger the run by hand: `curl -sS -H "Authorization: Bearer $CRON_SECRET" https://www.pokefin.ca/api/cron/alerts`. Expect JSON with `"sent": 1`; the email arrives with the product, the price, the as-of date, the manage link and the footer. Run the same curl again: `"sent": 0`. In the received message ("Show original" in Gmail), check `List-Unsubscribe: <https://www.pokefin.ca/api/alerts/unsubscribe?t=...>`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and SPF, DKIM and DMARC "PASS". Use the mail client's own unsubscribe button: the watchlist then shows "Alert emails are off". Turn emails back on. The scheduled run the next morning appears in Vercel, Logs, filtered by `/api/cron/alerts`, with status 200.

## Owner actions

1. **Apply migration 0039** after 0038 is in production: Supabase MCP `apply_migration` (preferred) or the SQL editor with `migrations/0039_price_alerts.sql`. Then run the verification query the PR attaches (`/tmp/wp35_0039.sql`): 135 rows, all OK. Record it in `audits/HARDENING_FOLLOWUPS.md` section 7 ("Migration 0039 applied (YYYY-MM-DD)") and commit to master as `docs: record migration 0039 as applied`.
2. **Create the Vault secret and the matching Vercel variable.** Generate a value with `openssl rand -hex 32`. In the SQL editor: `SELECT vault.create_secret('<value>', 'pokefin_cron_token', 'WP35 price alert cron');`. In Vercel, Settings, Environment Variables, Production only, Sensitive: `POKEFIN_CRON_TOKEN=<the same value>`. To rotate later: `SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name = 'pokefin_cron_token'), '<new value>');`, then update the Vercel variable and redeploy.
3. **Create `CRON_SECRET`** in Vercel (Production only, Sensitive) with a different `openssl rand -hex 32` value. Vercel sends it to the cron route automatically.
4. **Brevo** (free plan): create the account; in Senders, Domains and Dedicated IPs, add and authenticate `pokefin.ca` with the DNS records Brevo shows (a `brevo-code` TXT and the DKIM records); add `include:spf.brevo.com` to the existing SPF TXT record (keep a single SPF record); add `_dmarc.pokefin.ca TXT "v=DMARC1; p=none; rua=mailto:privacy@pokefin.ca"` and move it to `p=quarantine` after two clean weeks of reports; add the sender `alerts@pokefin.ca` ("Pokéfin alerts") and make `alerts@` forward to `hello@` like the other addresses (WP24). Create an API key (SMTP and API, API keys) and set `BREVO_API_KEY` in Vercel (Production only, Sensitive). If Supabase Auth also sends through Brevo SMTP, the 300 a day are shared; the alert run caps itself at 200.
5. **Decision D4, the mailing address** for every email (Canada's anti-spam law): a street address, a PO box or a virtual mailbox. Answer in the PR thread; the executor sets `MAILING_ADDRESS` in `app/content/disclosures.ts`. Until then alerts stay hidden and nothing is sent.
6. **Confirm `NEXT_PUBLIC_SITE_URL`** in Vercel Production is the canonical origin (for example `https://www.pokefin.ca`): every email link is built from it.
7. **Confirm the Vercel Root Directory is `frontend`** (Settings, General), where `vercel.json` lives. After the merge deploy, Settings, Cron Jobs lists `/api/cron/alerts` at `5 11 * * *`. On the Hobby plan it runs once a day within the 11:00 UTC hour.
8. **Privacy page sub-processor line**: WP24 already names Brevo; this PR extends that line to the alert digest. If WP24 shipped a placeholder there, confirm the new wording in the PR.
9. After the first scheduled morning, run Verification block 5's checks once and reply in the PR or in an issue.

## Acceptance criteria

- [ ] `migrations/0039_price_alerts.sql` applies twice in a row (`replay_twice`), `verify_migration.py` prints exactly the four column-grant REFUSED lines, and its query returns 135 OK rows after apply.
- [ ] `tests/test_wp35_price_alerts_db.py` passes (29 cases), including: a crossing fires once and a re-run the same day returns nothing; a withheld price (`is_price_fresh` false) never fires and is not even evaluated; a price more than 3 days old never fires; hysteresis re-arms only at 2% past the level; a CAD level uses the rate of the price's day and is skipped without it; a stale claim is retried and a released claim is re-claimed; an older day is never evaluated after a newer one; a wrong, short or missing token and a missing Vault secret raise 42501; `unsubscribe_alerts` is idempotent and token-only; RLS owner-only, column grants, the 50 cap, the CHECKs, the export keys without the token, and account deletion cascade.
- [ ] `tests/test_wp35_price_alerts_static.py` passes: the cap, kinds, ranges, hysteresis and age constants match `alerts.ts`; the cron functions check the token first; the effective `export_my_data` keeps `watchlist`, `price_alerts` and `alert_email`; the Vault stand-in is in `ci_bootstrap.sql`; `vercel.json` schedules `/api/cron/alerts` at `5 11 * * *`.
- [ ] The cron route test proves: 503 without a long `CRON_SECRET`, 401 without the exact bearer, 503 without the Brevo key or the cron token; a fixture day with one crossing sends exactly one Brevo email with the List-Unsubscribe headers and records it; re-running the same day sends none; a refused send releases the claim; a 429 is retried once; no response contains an email address.
- [ ] The email snapshot is committed; the text and HTML contain the product, the rule, the price with its CAD and USD values, the TCGplayer as-of date, the product link, the manage link, the disclaimer, the reason and unsubscribe link, the sender and mailing address, and the trademark notice; HTML is escaped.
- [ ] `/api/alerts/unsubscribe` has no GET, accepts the RFC 8058 one-click POST without CSRF headers, answers 200 for unknown tokens, and redirects the page form with a status; the page's GET only renders a POST form.
- [ ] The product page shows "Alert me" after Watch (when `MAILING_ADDRESS` is set), stays ISR (Test 14), and loads the dialog lazily; the dialog creates rules with the suggestions of the Design section and lists and manages the product's rules.
- [ ] `/portfolio/watchlist` shows the Alerts column (desktop), the bell (phone) and the "Price alerts" section with pause, resume, delete and the digest switch; with `available` false none of them renders.
- [ ] `/methodology#alerts` documents the rules from the `alerts.ts` constants; `METHODOLOGY_VERSION` went up one minor version with a change-log row.
- [ ] `/privacy`, `/account` and `README.md` mention price alerts; `.env.example` lists `CRON_SECRET`, `POKEFIN_CRON_TOKEN` and `BREVO_API_KEY`.
- [ ] `pnpm lint` 0 errors with the new ESLint list entries and table names; `pnpm test --ci` passes; `pnpm exec tsc --noEmit` exits 0 after phase B.
- [ ] `pnpm perf:budget` passes; only `/alerts/unsubscribe` was added; no limit went up; `uiConventions.baseline.json` gained only `"lib/email/emailTheme.ts": 8`.
- [ ] No new file contains an em dash, "live", "real-time", "instant" or "TCGPlayer".

## Rollback

- **Stop sending at once, no deploy:** Vercel, Settings, Cron Jobs, disable `/api/cron/alerts`; or delete `CRON_SECRET` (the route answers 503). Both are reversible.
- **Hide the feature:** set `MAILING_ADDRESS` back to `null` and deploy: the button, the column and the section disappear, `POST /api/alerts` answers 503 and the cron sends nothing. Rules stay stored.
- **Code:** revert the frontend commits (2 to 5 of Commit and PR). Keep commit 1 (the migration, the bootstrap stand-in and the Python tests): production has applied 0039, and removing the file would make the replay and `schema.sql` drift. The tables are inert without the routes.
- **Database, only if the owner wants the data gone** (for example before any real user set an alert): in the SQL editor, in this order, then re-run section 5 of `migrations/0038_watchlist.sql` (its `CREATE OR REPLACE FUNCTION public.export_my_data()` and the three grant lines) to restore the export without the alert keys:

```sql
DROP FUNCTION IF EXISTS public.get_due_alert_digests(date, text, integer);
DROP FUNCTION IF EXISTS public.record_alert_digest_sent(date, bigint[], text);
DROP FUNCTION IF EXISTS public.release_alert_digest(date, bigint[], text);
DROP FUNCTION IF EXISTS public.unsubscribe_alerts(uuid);
DROP FUNCTION IF EXISTS public.alert_evaluations(date);
DROP FUNCTION IF EXISTS public.alert_cron_token_ok(text);
DROP TABLE IF EXISTS public.alert_deliveries;
DROP TABLE IF EXISTS public.alert_email_prefs;
DROP TABLE IF EXISTS public.price_alerts;
DROP FUNCTION IF EXISTS public.price_alerts_before_update();
DROP FUNCTION IF EXISTS public.ensure_alert_email_prefs();
DROP FUNCTION IF EXISTS public.alert_email_prefs_before_update();
DELETE FROM vault.secrets WHERE name = 'pokefin_cron_token';
```

  In that case also delete `migrations/0039_price_alerts.sql` and the two Python test modules in the same revert PR so the replay matches production, and note it in `audits/HARDENING_FOLLOWUPS.md`.
- Remove `POKEFIN_CRON_TOKEN`, `CRON_SECRET` and `BREVO_API_KEY` from Vercel if the feature is abandoned; the Brevo domain records can stay (the weekly report will use them).

## Commit and PR

Branch `remediation/wp35-daily-price-alerts`. Commits, in order:

1. `feat(db): price alerts, email preferences and deliveries with Vault-gated cron functions (WP35)`: `migrations/0039_price_alerts.sql`, `scripts/db/ci_bootstrap.sql`, `tests/test_wp35_price_alerts_db.py`, `tests/test_wp35_price_alerts_static.py`.
2. `feat(alerts): rules model, alerts route, repo and browser client (WP35)`: `app/lib/alerts.ts`, `app/lib/alertsApi.ts`, `app/lib/server/alertsRepo.ts`, `app/lib/server/alertsConfig.ts`, `app/lib/server/anonRpcSupabase.ts`, `app/api/alerts/route.ts`, `app/content/disclosures.ts`, Tests 3 and 9.
3. `feat(alerts): daily digest cron, Brevo client, email and unsubscribe (WP35)`: `app/lib/server/dueDigests.ts`, `app/lib/server/cronAuth.ts`, `app/lib/server/alertDigestJob.ts`, `app/lib/email/emailTheme.ts`, `app/lib/email/alertDigest.ts`, `app/lib/email/brevo.ts`, `app/api/cron/alerts/route.ts`, `vercel.json`, `app/lib/alertUnsubscribe.ts`, `app/api/alerts/unsubscribe/route.ts`, `app/alerts/unsubscribe/page.tsx`, Tests 4 to 8, 10, 11, the snapshot.
4. `feat(alerts): Alert me dialog, product page action and watchlist alerts section (WP35)`: `app/components/alerts/*`, `app/product/[id]/ProductActions.tsx`, `app/product/[id]/page.tsx`, `app/components/watchlist/WatchlistTable.tsx`, `app/components/watchlist/WatchlistPhoneList.tsx`, `app/portfolio/watchlist/WatchlistView.tsx`, Tests 12 to 15.
5. `docs(alerts): methodology, privacy, account, README, env example, lint lists, budgets (WP35)`: `app/content/methodology.ts`, `app/methodology/MethodologyArticle.tsx`, `app/privacy/page.tsx`, `app/account/page.tsx`, `README.md`, `.env.example`, `eslint.config.mjs`, `perf-budgets.json`, `app/__tests__/uiConventions.baseline.json`.
6. Phase B: `chore(types): regenerate database types for migration 0039 (WP35)`: `app/types/database.ts` only.

Every commit message ends with the attribution lines the session's system reminder gives.

PR title: `WP35: Daily price alerts by email digest` (draft and prefixed `[waiting for DB types]` until phase B). PR body:
- Goal in two sentences; link to this spec.
- The kinds table and the evaluation rules (D-1, fresh only, 3-day price age, CAD at the price-day rate, 2% / 2-point re-arm, claim then send).
- Security model: anon key plus Vault token checked in constant time; `CRON_SECRET` on the Vercel hop; unsubscribe token; no CSRF on the RFC 8058 endpoint and why.
- Outputs of Verification blocks 1 to 3 (test counts before and after, perf table with the `/product/900001` delta and the dialog chunk size), the 135-row verification query attached, screenshots of the dialog and the watchlist section at 390 px and 1440 px, the rendered email (HTML screenshot and the text part).
- `uiConventions.baseline.json` raise: "lib/email/emailTheme.ts: 8 hex values; email clients do not support CSS custom properties; emailTheme.test.ts fails on drift."
- Whether WP28 was present (MSRP suggestion on or off) and whether WP33 rows exist (no change either way).
- Owner actions 1 to 9 as a checklist; D4 status.
- "Noticed, out of scope": per-alert email (instead of a digest) and SMS or push are deferred (`01-PRODUCT-DIRECTION.md` §7 and §10); alerts on index levels, set indices and portfolio value are later packages; a `List-Unsubscribe` mailto variant needs an inbound mailbox; CAD changes for `pct_move_7d` use USD Market Price terms like the watchlist; WP22's production smoke could add a `GET /api/alerts` check to its signed-in leg; the weekly newsletter (deferred) can reuse `brevo.ts`, `emailTheme.ts` and the unsubscribe page pattern.
