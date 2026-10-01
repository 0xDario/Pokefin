# Pokéfin Remediation and Product Plan

This folder turns `audits/2026-09-25-security-performance-ux-review.md` into 39 pull requests. Each work package (WP) is one PR with its own spec file. A spec is written so that a model with no prior context can execute it alone: exact files, code, tests, verification commands, owner actions and acceptance criteria.

The plan has two tracks.

- **Track 1, fix everything (WP00 to WP21, then WP38).** It fixes every finding in the review: the 89 original root causes and the 9 found in the 2026-10-01 completeness pass. Every Critical, High and Medium finding was re-derived from the code by an independent verifier before its spec was written.
- **Track 2, product excellence (WP22 to WP37).** It turns the fixed site into the best sealed Pokémon TCG price site: performance budgets, a design system, trust pages, a market index, a decision-grade product page, a screener, a watchlist, price alerts, portfolio analytics and set pages. The vision and design rules are in `01-PRODUCT-DIRECTION.md`. The evidence is in `research/`.

Every spec was reviewed adversarially against the current code. A cross-check then fixed conflicts between specs and settled one migration registry.

| | Packages | Executor effort | Owner effort |
|---|---|---|---|
| Track 1 plus WP38 | 23 | about 192 to 229 h | about 10 to 17 h |
| Track 2 | 16 | about 226 to 248 h | about 14 to 21 h |
| Total | 39 | about 420 to 480 h | about 25 to 38 h, plus PR review |

## At a glance

### Track 1: fix everything

| WP | Title | Fixes or delivers | Effort | Risk | Depends on | Migrations |
|---|---|---|---|---|---|---|
| [WP00](WP00-verification-harness-and-ci-build.md) | Local build harness and CI build gate | F127 (full); F076 partial: CI next build against a Supabase stub and the pnpm pin (members F037, F052, F064, F139); also clears the brace-expansion audit advisories so the required audit check goes green | S, 2 to 3 h | low | none | none |
| [WP01](WP01-db-hotfix-export-and-indexes.md) | Database hotfix: data export and missing indexes | F020 (export_my_data fails: STABLE function with an INSERT), F134 (missing portfolio FK indexes) | S, 2 to 3 h; owner about 15 min | low | none (does not need WP00) | 0024, 0025 |
| [WP02](WP02-auth-security-quick-fixes.md) | Auth and security quick fixes | F077 (F017), F019, F079, F024 (F098), F132 (F130), F075, F078 | M, 7 to 9 h; owner about 45 min | medium | WP00 (soft: build:stub only) | none |
| [WP03](WP03-ui-hotfixes.md) | Visible UI hotfixes | F022 (F008), F032 (toast part of F090), F151 partial: refresh-cadence copy (F123) | S, about 2 h | low | WP00 (soft: build:stub only) | none |
| [WP04](WP04-auth-context-profile-account.md) | Restore signed-in features, part 1: session, profile and account | F001 partial (F018), F058 auth part (F062, F106), F063, F124 | M, 6 to 8 h | medium | WP02, WP03, WP00 | none |
| [WP05](WP05-portfolio-api.md) | Restore signed-in features, part 2: portfolio | F001 partial (F018), F144, F053 (F057, F061), F033 (F044), F110 (F113, F119), F060 (F118), F111 | L, 14 to 18 h | medium | WP04, WP02, WP00 (WP01 index optional) | none |
| [WP06](WP06-box-recipes-api.md) | Restore signed-in features, part 3: box recipes and sharing | F001 partial (F018), F055, F059, F149, F116, F117, F131 | L, about 10 h | medium | WP04, WP05 (route helpers, plan order), WP00 | 0026 |
| [WP07](WP07-date-money-formatting.md) | One formatting module: dates, timestamps, money | F007 (F009, F010, F026), F089 (F102), F096 (F112, F115), F072, F122 | M, 6 to 8 h | medium | WP00 (hard); written for the tree after WP01 to WP06 | none |
| [WP08](WP08-prices-url-state-and-ssr.md) | /prices: URL state without navigation, server-rendered catalog | F012 (F025), F016, F054 (F121) | M, 5 to 7 h | medium | WP03, WP07, WP00 | none |
| [WP09](WP09-prices-card-rendering.md) | /prices: lightweight sparklines, batched history, stable layout | F014 (F066), F070 (F067), F015, F071 (button half), F126 (polish only) | M, 8 to 10 h | medium | WP07, WP08 (and through them WP03, WP00) | none |
| [WP10](WP10-db-rpc-performance.md) | Database: bounded market RPCs and portfolio history RPC | F142 (F080), F148, F145; Track 2 rule: return-anchor maximum age in 0028 (owner decision) | M, 6 to 8 h | medium | WP01, WP05; may run alongside WP06 to WP09; must merge before WP11 | 0027, 0028, 0029 |
| [WP11](WP11-next-caching-and-isr.md) | Caching: scrape-triggered revalidation, ISR, server-fed tools | F151 caching half (F123), F147, F143 (/compare, /box-calculator), F146 partial, F150, F068, N04; Track 2: IntentLink intent-only prefetch | M, 12 to 15 h | medium | WP05, WP06, WP10; after WP07, WP08, WP09 (and WP00, WP03) | none |
| [WP12](WP12-bundle-and-images.md) | Bundle size and hero image | F011 (F013), F069 | M, about 4 h | low | WP04, WP05, WP06; after WP07 to WP11 in plan order | none |
| [WP13](WP13-seo-and-navigation.md) | SEO metadata, 404 and loading states, login return-to | F028 (F029, F088), F093 (F087, F100), F002 (F006, F021, F027, F129); Track 2 SEO corrections (AggregateOffer or no offers, en_CA, TCGplayer spelling) | M, 8 to 10 h | medium | WP04, WP02; assumes WP08 and WP11 (fallbacks given), WP00, WP03 | none |
| [WP14](WP14-accessibility.md) | Accessibility: dialogs, labels, contrast | F030 (F023, F094), F031, F095 (F104) | M, about 9 h | medium | WP05 (hard); after WP09, WP11, WP13 in plan order | none |
| [WP15](WP15-visual-polish-and-copy.md) | Visual consistency, promo placement, user-facing copy | F091 (F099), F097 (F092, F101), F103, N07; Track 2: promo relationship label from one constant (D1), conventions test bans TCGPlayer, live price, real-time | M, 7 to 9 h | medium | WP14 (hard); after WP00 to WP13 | none |
| [WP16](WP16-python-pipeline-hardening.md) | Scraper and report pipeline hardening | F083, F084, F086, F082, F136, F137, F138, F141; Track 2: weekly PDF self-description and disclaimer | M, 6.5 to 8.5 h (6 to 8 h plus 0.5 h Track 2 copy); owner about 30 min | medium | WP00; start after WP11 merges; may run alongside WP12 to WP19 | 0030 |
| [WP17](WP17-lint-tests-observability-ci-gate.md) | Zero lint errors, critical-path tests, observability, blocking CI | F056 (F039, F065, F114, F120), F050 (F042), F108 (F049), N03, F128, F076 partial (blocking lint) | L, about 11 h | low | WP05, WP06, WP09, WP14 (and WP11, WP13, WP15 in plan order) | none |
| [WP18](WP18-market-math-and-compare.md) | Consolidate market math; split the compare page | F005 (F036, F040), F073, F043 (F004, F035), F074, F003; Track 2: exported window and factor constants | L, about 12 h | medium | WP17 (hard), WP07, WP11 (and WP14, WP15) | none |
| [WP19](WP19-marketview-refactor.md) | MarketView decomposition and row memoisation | F045 (item 2 and verifier additions, for /market), F125 | M, 5 to 7 h | medium | WP18, WP17 (hard), WP09 | none |
| [WP20](WP20-platform-cleanup.md) | Types, currency context, CSRF dedupe, docs | F034 (F041, F046), F047 (F038), F048, F051 (F105), F107 (F109) | L, about 15 h (includes waiting for owner-generated types) | medium | WP05, WP06, WP11, WP19, WP16; 0026 to 0030 applied in production before step 4 | none |
| [WP21](WP21-db-hardening-least-privilege.md) | Database hardening, least-privilege scraper role, schema baseline | F133, F081 (F085), F135 | L, 16 to 22 h; owner about 2 h over three sittings | medium | WP06, WP10, WP16 (and WP04, WP05, WP11; WP20 in plan order) | 0031, 0032, 0000_baseline (replay only, never applied), 0033 and 0034 reserved (phase B, only if needed, no-ops on production) |
| [WP38](WP38-residual-data-layer-followups.md) | Residual data-layer follow-ups | F146 residual, F143 residual, box_recipes.currency missing from export_my_data (WP06 residual), F064 part 2 residual (empty catalog), N01, N02, N03 residual (error retry), N05, N08 | L, 18 to 20 h | medium | WP21, WP20 and all earlier (WP01, WP05, WP06, WP07, WP10, WP11, WP12, WP14 to WP18) | 0035, 0036, 0037 |

### Track 2: product excellence

| WP | Title | Fixes or delivers | Effort | Risk | Depends on | Migrations |
|---|---|---|---|---|---|---|
| [WP22](WP22-perf-budget-gate-and-rum.md) | Performance budget gate, real-user monitoring and production smoke test | Goal: every PR shows per-route bytes and fails on a budget or layout-stability break; a weekly RUM p75 regression issue; a daily production smoke test (prices present, signed-in flows work) | L, 14 to 16 h; owner about 1 h | medium | WP38, WP00, WP08, WP12, WP17, WP21 | none |
| [WP23](WP23-design-system-foundation.md) | Design system foundation: semantic tokens, finance components, phone list pattern | Goal: one visual language (red only for brand, glyph plus text for gain/loss, dense sortable tables, a phone list pattern) built from shared components | L, about 15 h | medium | WP07, WP14, WP15, WP18, WP19, WP20, WP22 | none |
| [WP24](WP24-trust-pages-and-disclosure.md) | Trust pages, metric definitions and disclosure | Goal: versioned /methodology from code constants, /about with the store relationship, /terms, /contact, rewritten /privacy (closes N06), one-line disclaimers, renamed advice-sounding labels, prefilled report links | M, about 13 h | low to medium | WP10, WP13, WP14, WP15, WP18, WP23 (through WP22) | none |
| [WP25](WP25-market-analytics-foundation.md) | Market analytics foundation: daily product stats and dated FX | Goal: every Track 2 metric and CAD figure comes from indexed, precomputed, freshness-gated tables (product_daily_stats, fx_daily), with historical CAD at the dated Bank of Canada rate | L, 14 to 16 h | medium | WP38, WP10, WP11, WP16, WP20, WP21, WP22, WP24 | 0038, 0039 |
| [WP26](WP26-server-baked-sparklines.md) | Server-baked sparklines and public read routes | Goal: sparklines in the first paint on / and /prices, one CDN-cached request on /market, zero history requests while scrolling, no Supabase client on those routes | L, 14 to 16 h; owner about 1 h | medium | WP09, WP10, WP11, WP12, WP19, WP21, WP22, WP23 | 0040 |
| [WP27](WP27-navigation-search-and-data-clock.md) | Task-based navigation, global search, data clock and new mark | Goal: task-based nav, / or Ctrl-K search, header data clock (amber when stalled), site-wide header currency toggle, original Pokefin mark replacing the Poke Ball | L, about 15 h | medium | WP38, WP13, WP14, WP20, WP22, WP23, WP24 | none |
| [WP28](WP28-msrp-and-pack-contents.md) | MSRP, pack contents, cost per pack and box NAV from the catalog | Goal: x MSRP and cost per pack for curated products, pack NAV and premium in daily stats, Box NAV calculator pre-filled from a catalog product (?product=<id>) | M, 12 to 14 h; owner D7 curation 3 to 5 h | medium | WP06, WP11, WP21, WP23, WP24, WP25 (soft: WP26, WP27, WP30) | 0041 |
| [WP29](WP29-sealed-index-and-breadth.md) | Pokefin Sealed Index family and market breadth | Goal: daily rules-based Sealed Index with sub-indices and breadth on /indices/sealed, and a benchmark for product, set and portfolio charts | L, 14 to 16 h | medium | WP21, WP22, WP23, WP24, WP25 (soft: WP26, WP27) | 0042 |
| [WP30](WP30-prices-dense-list-and-mobile.md) | Prices: dense list view, phone catalog and fixed card anatomy | Goal: dense two-line phone list (8+ products per screen), one-line 44 px desktop list with URL-backed sort, optional card view with a fixed price column | L, 15 to 17 h | medium | WP08, WP09, WP11, WP22, WP23, WP26 (soft: WP24, WP27, WP28) | none |
| [WP31](WP31-product-decision-page.md) | Product decision page: quote header, key stats, honest chart, actions | Goal: one-screen decision page: history (52-week range, tracked high), MSRP (x MSRP, cost per pack, NAV), market (index overlay), liquidity, dated CAD, and actions | L, 15 to 16 h | medium | WP38, WP05, WP12, WP13, WP18, WP20, WP22, WP23, WP24, WP25; WP28 and WP29 soft (placed after both) | none |
| [WP32](WP32-market-home-dashboard.md) | Market home: index header, breadth, screened movers, new releases | Goal: / answers is the market up (index level and changes, breadth, 1Y chart), what moved (screened movers) and what is new; signed-in strip without losing the CDN cache | M, 12 to 14 h | medium | WP05, WP22, WP23, WP24, WP25, WP26, WP27, WP29 | none |
| [WP33](WP33-screener-with-presets.md) | Screener: dense ranked table, filters and presets (replaces Market View) | Goal: /screener ranks and filters all products in a dense table with presets, shareable URLs and CSV export; phone list with filter and sort sheets; /market 308s to /screener | L, 16 to 18 h | medium | WP13, WP19, WP22, WP23, WP24, WP25, WP26, WP30 (soft: WP27, WP28, WP31, WP32) | 0043 |
| [WP34](WP34-watchlist.md) | Watchlist | Goal: one-tap Watch from product page or Screener row, a watchlist page with dated prices and changes, watched movers on the home page, sign-in round trip that keeps the watch | L, 12 to 14 h (product direction table says M, 10 to 12 h) | medium | WP38, WP04, WP05, WP13, WP20, WP21, WP23, WP25, WP31, WP32 (soft: WP28, WP33, WP36) | 0044 |
| [WP35](WP35-daily-price-alerts.md) | Daily price alerts by email digest | Goal: price, move, listing and supply alerts checked once a day on fresh prices only, one morning digest email with dated prices, one-click unsubscribe without sign-in | L, 15 to 16 h | medium-high | WP34, WP31, WP25, WP24, WP21, WP13 (soft: WP28) | 0045 |
| [WP36](WP36-portfolio-analytics.md) | Portfolio analytics: vs the index, net of exit costs, in the currency you paid | Goal: portfolio vs money-matched Sealed Index, net after selling fees, days to exit, allocation and concentration flags, cost basis in the purchase currency with a market-vs-FX split, import-first empty state | L, 14 to 16 h | medium | WP05, WP10, WP14, WP20, WP21, WP23, WP25, WP29 (soft: WP31, WP34, WP35) | 0046 |
| [WP37](WP37-sets-section-and-share-cards.md) | Sets section, set pages and dynamic share cards | Goal: /sets comparison table with presets and risk/return chart, /sets/<slug> pages with index chart and summary, dated share cards (stale shows No current price), /stats and /analytics 308 to /sets | L, about 16 h; owner about 30 min | medium | WP13, WP21, WP22, WP23, WP24, WP26, WP29, WP31 (soft: WP27, WP32, WP33) | 0047 |


## How the order was chosen

1. **Protect every later change first.** WP00 adds a local build harness and a CI build step, so any later PR that breaks `next build` fails in CI instead of on Vercel.
2. **Restore what is broken for users.** The data export (WP01) and every signed-in feature (WP04 to WP06) have been failing in production for months. Nothing else matters as much to an account holder.
3. **Close cheap security gaps next.** WP02 is a batch of small, contained fixes: login lockout, captcha, password reset wiring and error hygiene.
4. **Make the primary page fast.** `/prices` is the catalog most visitors land on. WP07 to WP09 fix its dates, its search, its first paint and its scrolling, in that order, because each builds on the previous one.
5. **Cut database cost and add caching** (WP10 and WP11) once the code that calls those queries has settled.
6. **Then polish and harden.** This covers bundle size, SEO, accessibility, visual consistency, the Python pipeline, lint and tests, and finally the larger refactors and database least-privilege work. These have lower user impact per hour, and several depend on the earlier restructuring.
7. **Track 2 starts only after Track 1 and WP38 merge.** Track 2 builds on the fixed architecture: route handlers for user data, `format.ts`, `marketMath.ts`, the dialog component, the currency context, generated database types and blocking CI. Its first two packages set the guardrails every later feature must pass: WP22 adds performance budgets with real-user monitoring, and WP23 adds the design system.
8. **Data before the pages that show it.** WP25, the market analytics foundation, and WP29, the Sealed Index, come before the product page, home dashboard, screener and portfolio analytics that display them.

## Execution order

Run the steps in order. Packages listed in the same step may run at the same time on separate branches. The lanes below say which ones can safely run in parallel.

1. **WP00, WP01** (Track 1): WP00 first on the main lane. WP01 has no dependency and needs no frontend build (its spec says so), so it runs alongside WP00. Owner applies 0024 then 0025 the day WP01 merges.
2. **WP02, WP03** (Track 1): Both need only WP00 (for pnpm build:stub). They share no file; WP02 states WP03 may land first. Owner sets up Supabase captcha, redirect allowlist, email templates and the apex canonical host before WP02 merges.
3. **WP04** (Track 1): Hard dependency on WP02 (validation names, AuthContext signatures) and WP03 (Header refs and Header.test.tsx).
4. **WP05** (Track 1): After WP04 (sessionStatus, authSession.ts, ESLint guard). WP01's 0025 index helps but is not required.
5. **WP06, WP10** (Track 1): WP06 after WP05 (reuses its csrf/routeAuth helpers); owner applies 0026 before WP06 deploys. WP10 starts as soon as WP05 merges and runs alongside WP06 to WP09 (its spec allows it); the owner must give the anchor-age decision before WP10 starts and apply 0027, 0028, 0029 before WP10 merges.
6. **WP07** (Track 1): Hard dependency on WP00 only, but written against the tree after WP01 to WP06 (fallbacks given). WP10 lane continues.
7. **WP08** (Track 1): After WP03 and WP07 (deterministic dates are a hard prerequisite for server-rendered cards).
8. **WP09** (Track 1): After WP07 and WP08. WP10 must be merged, with 0027 to 0029 applied, by the end of this step.
9. **WP11** (Track 1): After WP05, WP06, WP10 and the in-order WP07 to WP09. Owner sets REVALIDATE_SECRET in Vercel and runs the prefetch check before merge, then configures the scraper host.
10. **WP12, WP16** (Track 1): WP12 after WP11 in plan order. WP16 (Python only) may start once WP11 merges and runs alongside WP12 to WP19; it must be merged, 0030 applied and the scraper redeployed before WP20 and WP21.
11. **WP13** (Track 1): After WP04 and WP02; assumes WP08 and WP11 (fallbacks given).
12. **WP14** (Track 1): Hard dependency on WP05; edits files moved by WP09, WP11, WP13.
13. **WP15** (Track 1): Hard dependency on WP14 (Dialog, tokens, polyfill). D1 may be answered in this PR (optional).
14. **WP17** (Track 1): After WP05, WP06, WP09, WP14 and WP15. Lint becomes blocking from here on.
15. **WP18** (Track 1): Hard dependency on WP17 (buildRows.ts, module-scope PriceTooltip); also WP07, WP11.
16. **WP19** (Track 1): Hard dependency on WP18 and WP17; uses WP09's loading store.
17. **WP20** (Track 1): After WP19, WP05, WP06, WP11, WP16. Owner must have applied 0026 to 0030 and generate app/types/database.ts mid-PR (step 4 stops otherwise).
18. **WP21** (Track 1): After WP06, WP10, WP16 (and WP20 in plan order). Two phases: executor stops after step 16; owner applies 0031 and 0032 and hands over a schema dump (A1 to A5); phase B builds 0000_baseline and, only if needed, 0033/0034 (applied, as no-ops, before the PR is marked ready). Owner cuts the scraper over (B1 to B7) after merge.
19. **WP38** (Track 1, last): After WP21 and WP20. Owner applies 0035, 0036, 0037 in order before merge and pushes regenerated types. Track 2 starts only after WP21 and WP38 have merged.
20. **WP22** (Track 2): First Track 2 package, after WP21 and WP38. Owner option: move it to right after WP17 (see owner_decisions). Most owner actions (region, smoke secrets, RUM) happen after merge.
21. **WP23** (Track 2): After WP20 and WP22 (and WP14, WP15, WP18, WP19). Every Track 2 UI package builds on it.
22. **WP24, WP26** (Track 2): Shell lane: WP24 after WP23; D1, D2, D5 and the three forwarding addresses are needed before it merges. Speed lane: WP26 after WP22 and WP23 (does not need WP24); owner applies 0040 before merge.
23. **WP25, WP27** (Track 2): Both after WP24. Data lane: WP25 (0038, 0039, pg_cron D8, backfills, types mid-PR). Shell lane: WP27 (D6 mark before merge). WP26 may still be running; all three are allowed in parallel.
24. **WP28, WP29, WP30** (Track 2): WP28 and WP29 after WP25, in parallel (0041 and 0042, each after 0038 and 0039; D7 curation follows WP28). Speed lane: WP30 after WP26 and WP23.
25. **WP31, WP32, WP33, WP36** (Track 2): WP31 after WP28 and WP29 (both soft; it may start after WP25 if D7 lags). WP32 after WP27, WP29, WP26, WP25. WP33 after WP30 and WP25 (0043; apply 0041 first if WP28 merged). WP36 after WP29 and WP25 (0046) and may run alongside WP31 to WP35.
26. **WP34, WP37** (Track 2): WP34 after WP31 and WP32 (0044, after 0031 and 0036 in production). WP37 after WP31, WP29, WP26 (0047); it may run alongside WP34 and WP35.
27. **WP35** (Track 2, last): After WP34 (0045 after 0044). D4 mailing address and the Brevo/DNS/Vault setup gate the feature. If 0046 was applied before 0044 or 0045, re-run 0046 after each. Plan done when WP35, WP36 and WP37 have merged.

### Parallel lanes

- Track 1 main lane (one executor, sequential, because each spec is written against the tree its predecessors leave): WP00, WP02/WP03, WP04, WP05, WP06, WP07, WP08, WP09, WP11, WP12, WP13, WP14, WP15, WP17, WP18, WP19, WP20, WP21, WP38.
- Track 1 side lane A, from day one: WP01 alongside WP00. WP01 touches only migrations/0024-0025, a route test, tests/test_migration_volatility.py, README.md and audits/HARDENING_FOLLOWUPS.md; WP00 touches CI, frontend scripts and frontend/README.md. No shared file.
- Track 1 side lane B, after WP00 merges: WP02 and WP03 in parallel. WP02 edits auth routes, auth pages, proxy.ts, next.config.ts and lib modules; WP03 edits Header.tsx, ProductPrices index/useProductData and copy in Footer, layout, page and prices page. WP02 states there is no conflict. WP04 waits for both.
- Track 1 DB lane, after WP05 merges: WP10 alongside WP06 to WP09 (allowed by its spec). Only shared source file: app/lib/portfolioInput.ts with WP07 (different lines), plus README.md and HARDENING_FOLLOWUPS.md. Must merge, with 0027 to 0029 applied, before WP11 starts.
- Track 1 Python lane, after WP11 merges: WP16 alongside WP12 to WP19 (allowed by its spec). It touches no frontend file. Must merge, with 0030 applied and the scraper redeployed, before WP20 starts (types need product_price_pending) and before WP21.
- Optional (owner decision): WP22 may move to right after WP17 and then run alongside WP18 to WP21. If it does, WP38 step 12 must keep WP22's lazy Sentry import in app/error.tsx and app/global-error.tsx; neither spec says so today.
- Track 2 starts once WP21 and WP38 have merged. Shell lane: WP23, WP24, WP27, WP32.
- Speed lane: WP22, WP26, WP30, WP33. WP26 starts after WP22 and WP23 and runs alongside WP24, WP25 and WP27. WP33 also waits for WP25 (stats table).
- Data lane: WP25 (after WP24), then WP28 and WP29 in parallel, then WP31, WP34, WP35.
- Free-standing: WP36 starts after WP29 (and WP25) and runs alongside WP31 to WP35. WP37 starts after WP31 (and WP26, WP29) and runs alongside WP34 and WP35.
- Cross-lane joins: WP32 waits for WP29 (data) and WP26 (speed); WP34 waits for WP32 (shell) and WP31 (data); WP31 can start after WP25 if D7 curation lags (WP28 and WP29 are soft for it).
- Parallel Track 2 work is not file-disjoint: these files are extended by several packages: frontend/perf-budgets.json, lighthouserc.json, scripts/fixtures/perf.mjs, scripts/prod-smoke-lib.mjs, app/lib/serverMarketData.ts, app/lib/metricDefinitions.ts, app/content/methodology.ts (version bumps), app/__tests__/uiConventions.test.ts and its baseline, eslint.config.mjs file lists, globals.css, proxy.ts matcher, app/types/market.ts, audits/HARDENING_FOLLOWUPS.md. Each package adds its own entries. Merge one PR at a time; rebase the next on master, keep both sides' entries, take the next methodology version if another package bumped it first, and re-run that spec's Verification. Migration numbers never change on rebase.
- Database ordering across parallel lanes: 0040 (WP26) may be applied before 0038/0039; 0041 and 0042 each need 0038 and 0039; 0043 needs 0038 and, if WP28 has merged, 0041 applied first; 0044 needs 0031 and 0036; 0045 needs 0044; 0046 needs 0039 and must be re-run after 0044 or 0045 if those are applied later.


## Migration registry

Every migration file the plan adds has a fixed number. A package uses exactly the numbers below, even if an earlier package has not merged yet or a later one merged first, and never takes "the next free number". Numbers ascend in execution order: Track 1 (WP00 to WP21), then WP38 at the end of Track 1, then Track 2 (WP22 to WP37, in plan order). If a file with a reserved number already exists and is not that package's, stop and ask the owner. A rollback or fix-forward migration written outside the plan takes the first free number above 0047.

| Number | File | WP | Apply to production |
|---|---|---|---|
| 0000 | `0000_baseline.sql` | WP21 | Never. Phase B records production's pre-chain state from the owner's dump; replay only. |
| 0024 | `0024_export_my_data_volatile.sql` | WP01 | The day WP01 merges; no deploy depends on it. |
| 0025 | `0025_portfolio_fk_indexes.sql` | WP01 | With 0024, the day WP01 merges. |
| 0026 | `0026_box_recipes_sharing_and_currency.sql` | WP06 | Before WP06's Vercel deployment goes live. |
| 0027 | `0027_bounded_volume_metrics.sql` | WP10 | Before WP10 merges, in number order with 0028 and 0029. |
| 0028 | `0028_bounded_market_metrics.sql` | WP10 | Before WP10 merges, after 0027. |
| 0029 | `0029_portfolio_history_rpc.sql` | WP10 | Before WP10 merges, after 0028. |
| 0030 | `0030_price_plausibility_guard.sql` | WP16 | After WP16 merges (the code fails open without it). |
| 0031 | `0031_user_table_write_limits.sql` | WP21 | During WP21 review, owner action A2, before the schema dump. |
| 0032 | `0032_scraper_least_privilege_role.sql` | WP21 | During WP21 review, owner action A3, after 0031. |
| 0033 | `0033_record_production_triggers.sql` | WP21 | Only if phase B needs it (a production trigger on a migration-created function); a no-op on production, applied before WP21 is marked ready. Reserved even if unused. |
| 0034 | `0034_record_production_drift.sql` | WP21 | Only if phase B needs it (drift hunks and out-of-band drops); a no-op on production, applied before WP21 is marked ready. Reserved even if unused. |
| 0035 | `0035_get_latest_prices.sql` | WP38 | Before WP38 merges, in number order with 0036 and 0037. |
| 0036 | `0036_export_includes_box_recipe_currency.sql` | WP38 | Before WP38 merges, after 0035. |
| 0037 | `0037_volume_windows_complete_days.sql` | WP38 | Before WP38 merges, after 0036. |
| 0038 | `0038_product_daily_stats.sql` | WP25 | WP25 owner action 2, then 0039; before phase B regenerates the types. |
| 0039 | `0039_fx_daily.sql` | WP25 | Right after 0038. |
| 0040 | `0040_catalog_sparklines.sql` | WP26 | Before WP26 merges. |
| 0041 | `0041_product_attributes.sql` | WP28 | After 0038 and 0039, before WP28 phase B. |
| 0042 | `0042_market_index.sql` | WP29 | After 0038 and 0039, before WP29 phase B. |
| 0043 | `0043_product_max_drawdown.sql` | WP33 | Before WP33 merges or deploys; after 0038 and 0041. |
| 0044 | `0044_watchlist.sql` | WP34 | After 0031 and 0036, before WP34 phase B deploys. |
| 0045 | `0045_price_alerts.sql` | WP35 | After 0044, before WP35 phase B. |
| 0046 | `0046_portfolio_lot_currency.sql` | WP36 | After 0039, before WP36 phase B; re-run after 0044 or 0045 if those are applied later. |
| 0047 | `0047_taxonomy_slugs.sql` | WP37 | Before WP37 merges. |

## How to execute a work package

Give the executing model this prompt, with the work package id filled in:

```text
You are implementing one work package of the Pokéfin remediation plan.

Read audits/remediation/00-PLAN.md, then audits/remediation/<WPxx-file>.md in full.
Follow the spec exactly. If the current code differs from what the spec
describes (line numbers moved, a function was renamed), adapt to the current
code but keep the spec's intent. If the code makes a spec step impossible
or wrong, stop and explain why instead of improvising a different design.

Rules:
- Create the branch named in the spec from the latest master.
- Stay inside this work package's scope. Do not fix other findings you notice;
  list them in the PR description instead.
- Never skip, disable or weaken a test to get green.
- Run every command in the spec's Verification section and paste the results
  into the PR description.
- Do not apply database migrations to production. List them under
  "Owner actions" in the PR description.
- Commit with the message suggested in the spec. Open a PR with the suggested
  title and body.
```

After each PR merges, complete that spec's **Owner actions** before starting the next work package that depends on it. Migrations in particular must be applied in Supabase before the code that relies on them is deployed.

## Standard verification commands

Run from `frontend/` unless a spec says otherwise:

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm run lint
pnpm test --ci
pnpm build:stub        # available after WP00; builds against a local Supabase stub
```

For the Python pipeline, run this from the repo root inside a virtualenv with `requirements.txt` installed:

```bash
python -m pytest tests/ -q
```

Lint currently reports 16 pre-existing errors and does not block CI until WP17. Until then, a PR must not add new lint errors in the files it touches.

## Owner decisions

These are the decisions only you can make. Each has a default, which the specs follow if you say nothing.

| Id | Decision | Needed by | Default if unanswered |
|---|---|---|---|
| D1 | What is the true CardRinkTCG.ca relationship (A owned or co-owned, B paid placement or commission, C personal connection, no payment), and do you or the store hold inventory of tracked products? | Optional in the WP15 PR; required before WP24 merges | STORE_RELATIONSHIP stays null: promo keeps WP15's 'Partner store' label, no footer relationship sentence, no 'no ads' claim, '/about' states neutral facts and 'may hold inventory'; D1 stays open |
| D2 | Name or named pseudonym for /about, plus city and province (the province sets governing law in /terms)? | Before WP24 merges | No name ('an independent, personal project run from Canada'), Organization author in JSON-LD, generic governing-law clause; PR says D2 is open |
| D4 | Mailing address printed in every email (CASL): street address, PO box or virtual mailbox? | Before WP35 merges (alerts stay off until set) | MAILING_ADDRESS stays null: POST /api/alerts answers 503, alert UI hidden, no email sent |
| D5 | Accept the renamed labels ('Composite score' as Top or Bottom N% of ranked sets; 'Below / Near / Above pack value')? | Before WP24 merges | Ship the renames; Rollback reverts only the strings if rejected later |
| D6 | Approve replacing the Poke Ball mark: accept WP27's interim geometric monogram or supply a final SVG mark? | Before WP27 merges | Ship the interim monogram; a final mark later is a 30-minute follow-up (PokefinMark.tsx, app/icon.svg, make-icons.py) |
| D7 | Spend about 3 to 5 hours curating MSRP, Canadian MSRP, release dates, pack contents and promo values in the CSV template WP28 generates? | After 0041 is applied (WP28 owner action 3); before x MSRP and NAV figures are expected in WP30, WP31, WP33, WP34, WP35 | Nothing loads (unreviewed rows never load): x MSRP, cost per pack, pack NAV, 'Open in Box NAV', 'Near MSRP' and 'Below pack value' stay hidden everywhere |
| D8 | Enable pg_cron in Supabase, create a free Brevo HTTP API key, and set up SPF, DKIM and DMARC for pokefin.ca? | pg_cron: WP25 owner action 3 (and WP29 owner action 2); Brevo and DNS: before WP35 merges | Without pg_cron the scraper writes stats and publishes the index after each run (no 00:30/00:45 UTC finalisation; WP32 uses the scraper's rows). Without Brevo and the secrets the alert cron route refuses to run and no email is sent |
| ACCEPT-DIRECTION | Approve 01-PRODUCT-DIRECTION.md (status still 'proposed'), including light-only through WP37 and Prices and Screener kept as two jobs rather than merged? | Before WP22 (Track 2) starts; at the latest before WP23 and WP33 | Treated as accepted: every Track 2 spec is written on it (WP23 sets color-scheme light; WP33 replaces /market with /screener) |
| WP10-ANCHOR | Should WP10 add the return-anchor maximum age to 0028 (7 days for 7D and 1M, 14 days for 3M, 6M, 1Y), or stay strictly behaviour-neutral and leave the rule to WP25? | In writing before the WP10 executor starts | WP10 ships the bounded rule in 0028 (returns with an old anchor become NULL) |
| WP22-PLACEMENT | Run WP22 (budget gate, RUM, smoke) right after WP17 so budgets guard WP18 to WP21, instead of first in Track 2? | Before WP18 starts | WP22 stays first in Track 2, after WP21 and WP38. If moved, WP38 step 12 must keep WP22's lazy Sentry import in the error pages |
| WP21-BACKUP | Drop product_price_history_backup_20260128 (after keeping a data-only pg_dump outside the database) or keep it? | WP21 owner action A1, before the A5 schema dump | Keep it (no action); the baseline carries its schema-only definition and the replay still works |
| WP21-STORAGE | If a private Storage bucket holds user files, stay on POKEFIN_STORAGE_BACKEND=supabase instead of a Storage S3 key that can read every bucket? | WP21 owner action A1 (report buckets), before B2 | Switch to s3 as in B2 when no private user-file bucket exists; the database cut-over (B1) proceeds either way |
| WP06-SHARE-CODES | If the pre-check shows public recipes with a bad share code, do their already-shared links matter (they stop working after 0026)? | Before applying 0026 (WP06 owner action 1) | Expected count is 0; if non-zero and you say nothing, 0026 gives them new codes and old links break |
| F045-CARDSETTINGS | Should WP30 pass ProductCard settings as one memoised cardSettings object prop (F045 item 4), or leave F045 partially open? | Before WP30 starts (raised in WP19 and WP38 owner action 6) | WP30 replaces ProductCard's props as written; F045 stays partially open for /prices in the tracker |
| F095-CONTRAST | Add a CI colour-contrast gate (Lighthouse accessibility category with color-contrast as error in lighthouserc.json)? | Before WP22 starts (WP38 owner action 7) | No contrast gate; WP22 runs the performance category only and the item is recorded as open in the tracker |
| WP26-PRICES-BUDGET | If WP26 leaves the /prices document above its 70 kB br target, accept a raised limit until WP30 or hold the PR? | Before WP26 merges | No default in the spec; the standing rule is that an unapproved budget raise does not merge |
| WP30-DEFAULTS | Accept /prices defaults: list view, ungrouped, 'By Type' grouping removed in favour of the type filter? | Before WP30 merges | Ship the defaults as specified |
| WP32-LAYOUT | Approve the home page layout at 390 and 1440 px, signed out and signed in? | Before WP32 merges | Ship as specified |
| WP33-THRESHOLDS | Change any screen preset thresholds (WP33 D4)? | Optional, any time after WP33 | Spec thresholds ship; a later change is a methodology change with a version bump |
| WP15-PRIVACY-CONTACT | Replace the public GitHub-issue privacy contact with a private mailto? | After WP15 merges, until WP24 ships | Keep the GitHub issue link (keep issues enabled) until WP24 rewrites /privacy with privacy@pokefin.ca |
| WP24-MARKET-PRICE | Extend the #market-price paragraph with TCGplayer's exact description after checking its help article? | Optional, after WP24 merges | Keep the verified-safe wording; an extension is a follow-up with a methodology minor version bump |
| WP37-SLUGS | Override any name-derived set, type or era slug (collisions get -code, -name or -id suffixes)? | After applying 0047, before WP37 deploys | Name-derived slugs from 0047 |

## Owner checklist

The executing model cannot do these. Each spec's Owner actions section has the full steps; this list is the consolidated index.

### Standing rules

- **Standing rule, every package (All):** After a PR merges, finish that spec's owner actions before starting any package that depends on it. Vercel deploys on merge, so a frontend action marked 'before deploy' must be done before you merge.
- **Standing rule, every migration (All with migrations):** Apply with Supabase MCP apply_migration or the SQL editor with nothing selected, using exactly the number in 00-PLAN.md 'Migration registry'. Run python3 verify_migration.py migrations/<file> and its printed SQL (every row OK except the MISMATCH rows the spec predicts), run the file's header queries, and update its bullet in audits/HARDENING_FOLLOWUPS.md section 7.
- **Standing rule, from WP20 on (WP20 to WP38):** After applying a migration that changes the schema, run pnpm types:db in frontend/ with SUPABASE_ACCESS_TOKEN and push app/types/database.ts to that package's PR branch (or give the executor a token for one run). Phase B of WP25, WP26, WP28, WP29, WP33 to WP38 waits for this.
- **Standing rule, from WP21 on (WP21 to WP38):** After every migration applied to production, refresh schema.sql from production (README 'Database': pg_dump --schema-only --schema=public ... \| python3 scripts/db/normalize_dump.py -) so CI's drift step reads clean (WP21 owner action C).
- **Standing rule, from WP22 on (WP22 to WP37):** Approve or reject every 'Perf budget raise:' line in a PR body before merge; a raise needs a stated reason.
- **Standing rule, export_my_data (WP34, WP35, WP36, WP38):** 0044 and 0045 redefine export_my_data() in full; 0036 and 0046 patch it. After applying 0044 or 0045, check SELECT position('''currency'', currency' IN pg_get_functiondef('public.export_my_data()'::regprocedure)) > 0; is true (if false, re-run 0036 and fix that migration in a follow-up). If 0046 was applied earlier, re-run 0046 right after 0044 or 0045 and check purchase_currency is present.
- **Ongoing (WP00):** When Dependabot bumps the trufflehog SHA, edit that PR so version: equals the release in the # vX.Y.Z comment without the v.
- **Ongoing (weekly) (WP16):** Run the stuck-holds query on product_price_pending and resolve products held more than 30 hours by hand.

### Per package

| WP | When | Action |
|---|---|---|
| WP00 | Before merge | GitHub, master branch protection: confirm the required checks are exactly the four CI job names, including 'Frontend (lint + typecheck + tests)'. Optional: Settings, Actions, General, Workflow permissions: read-only. |
| WP00 | After merge | Read the latest Vercel production build log for the pnpm version that does the install. If 10.x, add ENABLE_EXPERIMENTAL_COREPACK=1 to Preview, confirm one preview builds with pnpm 11.20.0, then add it to Production. |
| WP00 | After merge (optional, recommended) | Add the Vercel preview deployment status to master's required checks (if skipped now, do it at WP17). |
| WP01 | Right after merge (same day) | Optionally confirm the export bug. Apply 0024; verify (5 rows OK) and re-run the export query (returns your user id). Save the pg_indexes output for portfolio_holdings and portfolio_lots, apply 0025, run its header query (all valid = true; drop and reapply any invalid index), check Advisors, Performance. Record both in HARDENING_FOLLOWUPS section 7 and the legacy index names in README; commit 'docs: record migrations 0024 and 0025 as applied' to master. |
| WP02 | Before merge | Supabase Auth: enable Captcha with Turnstile and its secret; URL Configuration: Site URL https://pokefin.ca, add https://pokefin.ca/auth/callback** and http://localhost:3000/auth/callback**, remove the stale /auth/reset-password entry; Email Templates 'Reset Password' and 'Confirm signup' use {{ .ConfirmationURL }}. |
| WP02 | Before merge | Canonical host (reused by WP13, WP22, WP35): Vercel Production NEXT_PUBLIC_SITE_URL is exactly https://pokefin.ca; Domains: apex primary, www redirects to it with a permanent 308 (WP22 requires 308). Redeploy after changing the variable. |
| WP02 | After deploy | curl /api/auth/sign-in with captchaToken 'invalid' (expect captchaFailed; without a token, captchaRequired). Run the end-to-end password reset in a private window, confirm user_recovery_requested, login, user_updated_password in Supabase auth logs, record in HARDENING_FOLLOWUPS section 2. |
| WP02 | After deploy | Turn on 'require current password' for password changes (fallback: 'Secure password change'); test a wrong and a right current password on /account; repeat the reset once; record the option you enabled. Optional: Vercel Firewall rule, POST to the sign-in, sign-up and forgot-password routes, 10 per 60 s per IP. |
| WP04 | After deploy | Production smoke: sign in, change the username on /account and back (PATCH /api/profile 200, no request to rest/v1/profiles); check Supabase API logs for no new 401s on /rest/v1/profiles and Vercel logs for profile_fetch_failed/auth_me_unavailable; offline 35 s on /portfolio keeps you signed in. Then run the WP01 end-to-end export (data_exported count rises by 1). |
| WP05 | Right after deploy (or locally before) | Signed-in smoke test of /portfolio (one GET /api/portfolio, range clicks, add with offline retry creating one row, edit, delete, small Collectr import, search). 24 h later: Supabase API logs show zero 401s on /rest/v1/portfolio*. |
| WP06 | Before merge | Run the legacy share-data query (public_bad_code expected 0) and the box_recipes column-type query; if a type differs or bad codes matter, stop and tell the author. |
| WP06 | Before deploy (before merging) | Apply 0026; verify (9 rows OK) and the three header queries; run the Security Advisor; record in HARDENING_FOLLOWUPS section 7 plus the 'Open: export_my_data does not export box_recipes.currency' bullet (closed by WP38). |
| WP06 | After deploy | Run manual checks 1 to 9 (save, share, load, delete recipes) on production with a test account. |
| WP09 | Before merge | Confirm Supabase Data API 'Max rows' is 1000 (if lower, tell the executor before merge). Measure production /prices (manual checks 1, 2) and the preview (checks 1 to 8) and add both to the PR. |
| WP10 | Before merge | Check prerequisites (0024/0025 applied, the price-history btree index, the two 0015 indexes, TimeZone UTC); optionally record pg_stat_statements and EXPLAIN baseline; run the equivalence script (both old_vs_new columns 0, else stop); apply 0027 and 0028 with verify and a second equivalence run; apply 0029, verify (5 OK) and run the RLS proof snippet. |
| WP10 | After deploy, then 24 h later | On /portfolio, one GET /api/portfolio/history per range and no product_price_history requests (on 501, NOTIFY pgrst, 'reload schema'). After 24 h re-run pg_stat_statements (means under 300 ms, no statement timeouts) and commit 'docs: record migrations 0027-0029 as applied' with the equivalence row. |
| WP11 | Before merge | Add REVALIDATE_SECRET (openssl rand -hex 32) to Vercel Production only. Run the prefetch check on the preview (0 product requests while scrolling /prices, one per 80 ms hover) and paste counts into the PR. |
| WP11 | After deploy | curl POST /api/revalidate on the canonical host (401 without secret, revalidated list with it). Add REVALIDATE_URL and REVALIDATE_SECRET to ~/.config/pokefin/env on the scraper host and confirm 'Site caches revalidated.' in scraper.log. Confirm x-vercel-cache HIT on a product page and no browser summaries RPC on /compare and /box-calculator. After 48 h confirm server summaries calls fall under 100 a day. |
| WP12 | After deploy (one week) | Run preview checks 1 to 5 if the executor could not. One week after deploy compare Speed Insights LCP p75 for /product/[id] and INP on / and /prices with the week before. |
| WP13 | After deploy | Confirm the canonical tags show https://pokefin.ca; submit /sitemap.xml in Google Search Console (about 307 URLs); Rich Results Test on a fresh product (AggregateOffer detected) and a Discord/Slack preview; a preview deployment's robots.txt says Disallow: /. |
| WP14 | Before merge | On the preview with a real account in Chrome and Safari (desktop and iOS), run manual checks 2, 4, 5, 6 (modals focus, Escape, Add Holding, Import) and reply pass or fail per check. |
| WP16 | Right after merge (scraper idle) | Run the price pre-check queries (null bogus product prices, delete bogus history rows; if max price is above 250000 merge a PRICE_ABSOLUTE_MAX_USD follow-up first). Apply 0030; verify (2 constraints validated, 26 rows OK, anon has no SELECT on product_price_pending). |
| WP16 | After 0030 is applied | On the scraper host: git pull, confirm flock exists and which user cron runs as; run the Chrome sandbox smoke test as that user (fix chrome-sandbox ownership, or POKEFIN_CHROME_NO_SANDBOX=1 temporarily; move cron off root); watch the first run for the 'Prices held for confirmation' line. Record 0030 in HARDENING_FOLLOWUPS. |
| WP16 | After merge | Pass the Shopify token to compare_prices.py through SHOPIFY_ADMIN_API_TOKEN, clear old command history, and rotate the token (read_products scope) if it was ever passed with --shopify-token. |
| WP17 | After merge (optional, recommended) | Create a Sentry Next.js project, set NEXT_PUBLIC_SENTRY_DSN (Production and Preview; optional SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT), redeploy, check the CSP connect-src and report-uri, throw a test error, and add a 'new issue' email alert rule (also covers WP01's export_my_data_failed ops note). Confirm master still requires the 'Frontend (lint + typecheck + tests)' job and add the Vercel preview check if WP00 action 5 was skipped. |
| WP19 | Before merge (if executor is blocked) | Run manual checks 1 to 6 on the preview and reply on the PR. |
| WP20 | Before merge (mid-PR, before step 4) | With 0024 to 0030 applied in production, create a Supabase personal access token and generate app/types/database.ts (supabase@2.118.0 gen types or MCP generate_typescript_types), commit and push to the WP20 branch. Optional: add the repository secret SUPABASE_ACCESS_TOKEN so the 'Database types' workflow runs. |
| WP21 | Before merge (mid-PR, phase A) | A1: run the pre-check queries (server version, 0030 present, legacy objects, size counts 0, row caps, storage buckets, identity columns; report non-identity sequences so the executor adds GRANTs to 0032). Decide on the backup table (see decisions) and report the answers to the executor. |
| WP21 | Before merge (mid-PR, phase A) | A2: apply 0031, run the privilege and constraint checks and verify_migration (10 rows OK), then test username change, recipe save/delete, holding add/delete and export. A3: apply 0032, run the role and grant checks and verify_migration (17 rows OK). |
| WP21 | Before merge (mid-PR, phase A) | A4: set the pokefin_scraper password with psql \password (never in the SQL editor), store it, test the pooler login (products readable, profiles denied). A5: dump the public schema with a pg_dump of production's major version to db-dumps/prod_schema_public.sql in the executor's tree and send the dump date, server version and A1 answers. |
| WP21 | Before the PR is marked ready (phase B) | If phase B created 0033_record_production_triggers.sql or 0034_record_production_drift.sql, apply them to production (they must change nothing there). If the replay shows something production lacks, decide with the executor (no default). |
| WP21 | After merge | B1 to B5 on every scraper and report host: git pull and pip install; switch to POKEFIN_DB_BACKEND=postgres and test a run; create the S3 key and switch POKEFIN_STORAGE_BACKEND=s3 and test a thumbnail upload; move the report to report.env with the publishable key; delete SUPABASE_SERVICE_ROLE_KEY everywhere; create an admin-manual secret key, delete the scraper's old key (curl returns 401), confirm the old HS256 JWT key is revoked. |
| WP21 | After merge | B6: add 'Database replay and Python tests' to master's required checks. B7: update the WP21 bullet in HARDENING_FOLLOWUPS with the B1 to B5 dates and 'Status: done'. |
| WP22 | After merge | Vercel Functions region cle1 (check x-vercel-id on a cold product page); confirm www answers one 308 to the apex and the apex 200 (or set PROD_ORIGIN if www stays primary). |
| WP22 | After merge | Speed Insights metrics: create a Vercel token, run vercel@61.1.0 metrics schema with --scope; fix rum.metricIds in perf-budgets.json if needed (small PR); add secret VERCEL_TOKEN, variables VERCEL_PROJECT and VERCEL_SCOPE, optional KQL filters in rum.filters; set RUM_WEEKLY_ENABLED=true and run 'RUM weekly' once. If the plan does not offer metrics, leave it disabled. |
| WP22 | After merge | Create a smoke account with one holding; add SMOKE_STATE_KEY (openssl rand -base64 48) and SMOKE_SESSION_SEED (the /portfolio cookie header from a private window, not signed out); optional SMOKE_PRODUCT_ID; run 'Production smoke' on master (Signed in row shows 200s). |
| WP22 | After merge | Put the 28-day mobile Canada p75 LCP, INP, CLS, TTFB and sample counts per route into perf-budgets.json baseline in a small PR; if the executor had no network, fill calibration.pricesHtmlBytesProd and measuredOn. |
| WP24 | Before merge (draft until answered) | Answer D1, D2 and D5 in the PR thread. Set up free forwarding for hello@, reports@ and privacy@pokefin.ca and send a test email to each; the PR does not merge until all three deliver. |
| WP24 | After merge | Have /terms and /privacy read once by a Canadian lawyer; check TCGplayer's Market Price help article against the #market-price paragraph; confirm LISTINGS_HISTORY_START with SELECT min(snapshot_date) FROM public.product_listings_history; (report if not 2026-07-07); optionally request indexing of /methodology and /about. |
| WP25 | Before merge (mid-PR, before phase B) | Run the depth queries in research/data-opportunities.md section 7 and paste them into the PR. Apply 0038 then 0039; verify (0038: 39 OK and one expected MISMATCH; 0039: 25 OK); run the refresh, the row-count match and the EXPLAIN; if product_rows is 0, report the role and owner queries and stop. Push regenerated types. |
| WP25 | Before merge | D8: enable pg_cron if 0039 did not schedule the job, then cron.schedule('pokefin-finalise-market-analytics', '30 0 * * *', ...) exactly as the spec gives; check cron.job_run_details the next day. |
| WP25 | Before merge | With the scraper env sourced, run backfill_fx_valet.py --dry-run, then without it (a second run inserts 0), then backfill_daily_stats.py; run the fx_daily span, stats day-count and non-null count checks and paste them into the PR. |
| WP25 | After merge | Watch the next scraper run for 'Market analytics refreshed for <date>' before 'Site caches revalidated.'; update the 0038/0039 bullet with the refresh ms, backfill counts and pg_cron status; refresh schema.sql; commit 'docs: record migrations 0038-0039 as applied'. |
| WP26 | Before merge | Apply 0040 (may precede 0038/0039); run its four header queries and verify_migration (4 OK); record and refresh schema.sql; push regenerated types. With a Vercel Protection Bypass for Automation secret, run scripts/check-public-cache.mjs against the preview with --require-vercel-hit and paste the output. Decide on any /prices document budget raise above 70 kB br. |
| WP26 | After deploy | One phone-profile DevTools trace of a full /prices scroll (0 history requests); pull the new revalidate_hook.py on the scraper machine and check the log for 'Cache warm: 8/8 public URLs answered 200.' |
| WP27 | Before merge | D6: approve the interim monogram (header, favicon, apple icon, 512 icon) or supply a final SVG mark. |
| WP27 | After deploy | Hard-refresh in Chrome, Firefox and Safari for the new tab icon; check Add to Home Screen and Install app open /?source=pwa standalone; watch the next 'Production smoke' run for the Data clock row (restart the collector if it opens a stall issue). |
| WP28 | Before phase B and before deploy | Apply 0041 after 0038 and 0039; verify (all OK; 0038 and 0039 now show the expected refresh_market_analytics MISMATCH); run the refresh (structure_rows about the active count) and the three header queries; push regenerated types. |
| WP28 | After merge | D7 curation (3 to 5 h): make_attribute_template.py then --write; review MSRP, msrp_cad, release dates, contents and promo values row by row, set reviewed=yes; load_product_attributes.py --check until 'Files OK'; merge the CSVs in a PR titled 'data: curate MSRP and pack contents (WP28)'; run the loader dry run (fix UNKNOWN lines), then --apply. |
| WP28 | After load | Optionally re-run backfill_daily_stats.py; check x MSRP on /prices, a pre-filled /box-calculator?product=<box id> and nav_status counts; record 0041 and commit 'docs: record migration 0041 as applied'. For each new product later: template --write, review, commit, load. |
| WP29 | Before phase B | Apply 0042 after 0038 and 0039; run the attached verification (all OK). If pg_cron is on, schedule 'pokefin-publish-market-index' at '45 0 * * *' and confirm both pokefin- jobs. Check market_index_detect_daily_from() (set daily_from by hand if wrong), confirm WP25's stats backfill, run backfill_market_index.py and the coverage queries. Push regenerated types. |
| WP29 | After deploy | Open /indices/sealed at phone and desktop width, download the CSV, check /methodology#index. Later: reset_market_index() plus backfill after a rule change; run backfill_market_index.py when the log says the index is behind. |
| WP30 | Before merge | Review the 390 x 844 and 1440 x 900 screenshots and the defaults (list view, ungrouped, By Type grouping removed); approve or reject any budget raise. Two weeks after deploy, check /prices Speed Insights (INP 100 ms or less, CLS 0.02 or less) and tighten limits. |
| WP31 | After deploy | Open three product pages (long-history box, recent release, withheld price): dashed history ends where daily collection began, CAGR only on the long one, no key stats on the withheld one; report wrong boundaries as data fixes. |
| WP32 | Before merge | Approve the home layout on the preview at 390 and 1440 px, signed out and signed in. Optional: run the signed-in preview cache check with HOME_CACHE_COOKIE and paste the ok line. |
| WP33 | Before merge and deploy | Apply 0043 after 0038 (and after 0041 if WP28 merged); run its three verification queries (0, 0, true false); refresh schema.sql; mark it applied in HARDENING_FOLLOWUPS; push regenerated types. |
| WP33 | After deploy | Open https://pokefin.ca/market?sort=r1y&cols=risk and confirm it lands on /screener with the query string. |
| WP34 | Before phase B deploys | Apply 0044 after 0031 and 0036; verify (35 rows OK; 0024's export body MISMATCH expected) and the header queries; if 0046 was already applied, re-run 0046 and check purchase_currency and watchlist_items are both in the export body; tell the executor; push regenerated types. |
| WP34 | After merge and deploy | Refresh schema.sql. With your own account run Verification block 5 steps 1, 3 and 7. |
| WP35 | Before phase B | Apply 0045 after 0044; run the attached verification (135 rows OK); re-run 0046 if already applied and check purchase_currency and price_alerts are both in the export body; record and refresh schema.sql; commit 'docs: record migration 0045 as applied'. |
| WP35 | Before merge | Create Vault secret pokefin_cron_token and Vercel Production sensitive POKEFIN_CRON_TOKEN with the same value; create CRON_SECRET (different value). Brevo free plan: authenticate pokefin.ca (brevo-code TXT, DKIM), add include:spf.brevo.com to the single SPF record, add _dmarc TXT p=none, add sender alerts@pokefin.ca forwarding to hello@, set BREVO_API_KEY in Vercel Production. |
| WP35 | Before merge | Answer D4 (mailing address) in the PR thread. Confirm NEXT_PUBLIC_SITE_URL is https://pokefin.ca with www redirecting, the Vercel Root Directory is frontend, and the /privacy sub-processor wording for Brevo. |
| WP35 | After deploy | Settings, Cron Jobs lists /api/cron/alerts at 5 11 * * *. After the first scheduled morning run Verification block 5 and report. After two clean weeks of DMARC reports, move DMARC to p=quarantine. |
| WP36 | Before phase B | Apply 0046 after 0039; verify (all OK) and the four header queries; tell the executor; push regenerated types. Run backfill_fx_valet.py --start 2017-01-03, then refresh_market_analytics for today; min(day) of fx_daily is 2017-01-03. |
| WP36 | After merge and deploy | Refresh schema.sql. With your own account run Verification block 5 steps 3, 4 and 9. |
| WP37 | Before applying 0047 | Run the slug-collision query and paste the result into the PR; set preferred slugs by hand after applying 0047 if you want different ones. |
| WP37 | Before merge | Apply 0047; run the attached verification (all OK) and the two spot checks (0 NULL slugs); push regenerated types. |
| WP37 | After deploy | curl /stats and /analytics (one 308 each to /sets); check /sets and two set pages on a phone; paste a product and a set link into Discord or the X validator and check the date line; resubmit sitemap.xml; one week later URL-inspect one /sets/<slug>. A set rename never changes its slug; change slug by hand to move a URL. |
| WP38 | Before merge | Apply 0035, 0036, 0037 in order; run each header check (get_latest_prices queries 1 and 2 return 0 rows, fast nested-loop plan, export check true, no units_sold_7d above units_sold_30d) and verify_migration for 0035 and 0037 (all OK); record dates in HARDENING_FOLLOWUPS; refresh schema.sql; push regenerated types (phase B). |
| WP38 | After deploy | Add-holding search makes one rpc/get_latest_prices and no summaries call; pull main.py and scraper_db.py on the scraper machine and pip install -r requirements.txt; after the next run check the 'Exchange rate stored' line and at most one exchange_rates row per Bank of Canada date; re-import a Collectr file with a variant (variant shown, blank cost says Needs cost, portfolio picker for multi-portfolio files). |
| WP38 | After merge | If update_shopify_skus.py --apply was ever used, give each Shopify variant its own SKU so /compare and compare_prices.py stop warning about duplicate SKUs. |


## Definition of done for the whole plan

**Track 1 and WP38**
- Every finding id in the review, including N01 to N09 in its addendum, maps to a merged PR. The tables above are the index.
- CI blocks on typecheck, lint, tests and build (WP00, WP17), and replays the migration chain (WP21).
- A signed-in user can load and edit a portfolio, save and share a box recipe, change their username and export their data.
- `/prices` HTML contains product cards before JavaScript runs. Typing in search makes no network requests, and scrolling loads no charting library.
- The market metrics RPC stays well under the 3 s anonymous timeout, and server revalidation happens once per scrape instead of hourly.
- The scraper runs as a least-privilege role, and Sentry reports server and browser errors once a DSN is set.

**Track 2**
- Every PR shows its byte cost per route, and fails CI when it breaks a budget. A daily production smoke test opens an issue when a page renders without data (WP22).
- Every page uses the design system's tokens and components. Gains and losses carry glyphs as well as colour (WP23).
- `/methodology`, `/about` and the disclosures explain where every number comes from (WP24).
- The Pokéfin Sealed Index and market breadth are published daily (WP29). The home page, product page, screener and portfolio show them (WP31, WP32, WP33, WP36).
- Signed-in users can keep a watchlist and receive a daily email digest of price alerts (WP34, WP35).
