# Trust, credibility, SEO and brand

Date: 2026-09-30. Scope: what Pokéfin must say, show and publish so a serious sealed-product collector-investor believes its numbers, can find it from search, and recognises it as one product. Read against HEAD (`06fc756`) plus the WP00 to WP21 plan and the four sibling research files in this folder.

**Sources read.** `frontend/app/layout.tsx`, `page.tsx`, `components/Footer.tsx`, `components/Header.tsx`, `components/CardRinkPromo.tsx`, `privacy/page.tsx`, `stats/page.tsx`, `product/[id]/page.tsx`, `lib/priceGuard.ts`, `lib/marketPulse.ts`, `lib/csrf.ts`, `components/MarketView/returns.ts`, `components/BoxCalculator/BoxCalculator.tsx`, `README.md`, `main.py` (price and listings fetch, image upload), `generate_weekly_report.py` (masthead, caveats, footer), `send_weekly_email.py`, `schema.sql`, migrations `0023` and `20260506`, specs WP03, WP07, WP11, WP13, WP14, WP15, WP16, WP18, WP21, and `research/competitive-landscape.md`, `data-opportunities.md`, `performance-excellence.md`, `ui-audit.md`. Next 16 docs shipped in `frontend/node_modules/next/dist/docs/` (metadata files, `ImageResponse`).

**Method and limits.** No production queries and no build. Web research was limited: the egress proxy blocks `developers.google.com` and `help.tcgplayer.com`, so Google and TCGplayer rules below come from search-result summaries and are marked **[verify]** where a spec must re-check the primary source before shipping. Nothing here is legal advice; the disclosure and CASL items name the rule and the conservative choice, and the owner should have the Terms and the newsletter consent text read by a Canadian lawyer once.

**Relationship to the sibling tracks.** `competitive-landscape.md` pattern 8 and `ui-audit.md` item 7 already call for a methodology page and a trust strip; this file specifies them (copy, components, states, data). `performance-excellence.md` PX09a owns `app/manifest.ts` and icon sizes; this file owns the artwork, colours and voice that go into them. `data-opportunities.md` 3.7 (index) and 3.12 (`/weekly/[date]`) are prerequisites for two SEO surfaces here and are referenced, not re-specified.

---

## 1. Top conclusions

1. **The site's integrity is better than its credibility.** The freshness gate (0023), `--` instead of fake zeros, the stale supply guard and WP16's two-run confirmation of large moves beat every competitor surveyed, and none of it is visible. No page says where prices come from beyond "TCGPlayer", what Market Price is, when a number was recorded, who runs the site, or how to report a problem. Trust work here is mostly publishing what already exists.
2. **The CardRinkTCG relationship is the largest trust and compliance risk.** The repo is built around a Shopify store (`compare_prices.py`, `update_shopify_skus.py`, `/compare` Shopify CSV margin tool) and promotes CardRinkTCG.ca on every page with no stated relationship. If the operator owns or is paid by the store, the Competition Act (material connection) and the FTC Endorsement Guides expect a clear, proximate disclosure. WP15's "Partner store" label is too vague to satisfy either. Fix: one sentence of plain disclosure on the promo, in the footer and on `/about`, plus a conflicts policy (the store never influences rankings, verdicts or data).
3. **Every number needs an "as of", and the site needs one global data clock.** Three layers: a header chip driven by the last completed scrape (amber after 30 h, because the scraper runs on the owner's machine and can stop silently), an "as of" date on every headline price, and a clock marker on table rows priced 2 or more days ago. Dates come from `price_recorded_at`, which the RPCs already return.
4. **Publish `/methodology` as a versioned document with the real formulas and thresholds.** It must document things the code does today and the site never says: returns anchor on the latest daily price on or before the lookback date, product volatility is annualised 30D while set volatility is raw daily 90D (about 19x apart under one word, WP18 labels them), the composite "Invest Score" weights, the Market Pulse thresholds (price ±2%, volume ±20%), the box verdict thresholds (≤ -10% "buy", ≤ +5% "hold"), and the known limits (smoothed Market Price, US marketplace, before fees, weekly-bucket backfill).
5. **Rename the advice-sounding labels.** "Invest Score", "Good Deal", "Overpriced" and "buy/hold/avoid" read as recommendations. Use "Composite score (percentile)" and "Below / Near / Above pack value", keep the thresholds visible, and add one contextual line: "Screens describe past prices. They are not recommendations." A tasteful disclaimer is short, placed where a decision is being made, and never a modal.
6. **Build an in-app feedback path and a public status page, both free.** A "Report a problem" link beside every price and in every error state, prefilled with page, product and build, to `/contact`; submissions go to a `feedback` table through a signed RPC, and the owner gets an email. `/status` reads a new `scrape_runs` table plus owner-written `site_notices`. A scheduled GitHub Actions smoke test catches the "broken for months, zero reports" class the review found.
7. **Correct three details in WP13 before it ships.** Product JSON-LD publishes an `Offer` with Pokéfin's URL, which claims Pokéfin sells the item at Market Price: use `AggregateOffer` from the fresh listings snapshot (lowest ask, offer count) or omit offers. The product description says "Live price": use "Daily TCGplayer Market Price". Once per-product OG images exist, drop `openGraph.images` from `buildProductMetadata` (file-based metadata overrides it anyway) and switch the card to `summary_large_image`.
8. **SEO architecture: taxonomy hubs, not combinatorial pages.** Add `/sets/[slug]`, `/sealed/[type-slug]` and `/eras/[slug]`, each with a data-derived summary, a table, a chart and breadcrumbs, built from the already-cached summaries RPC (no new query per page). Do not generate set-by-type pages: with about 306 products they would be thin duplicates of product pages. Hubs with fewer than 3 priced products are `noindex`. Product URLs stay `/product/[id]`; changing canonicals right after WP13 would churn the index for little gain.
9. **Structured data per page type, honestly scoped.** `Organization` and `WebSite` (with `alternateName: "Pokefin"`) on the home page, `BreadcrumbList` everywhere below it, `Product` plus `AggregateOffer` on product pages, `CollectionPage` plus `ItemList` on hubs, `Article` on guides and weekly issues, and `Dataset` only for Pokéfin's own derived series (the index), never raw TCGplayer prices. Skip `FAQPage` (Google limits FAQ rich results to authoritative government and health sites) and the sitelinks `SearchAction` (retired by Google in 2024).
10. **Dynamic OG images are the cheapest growth lever.** `next/og` cards for products (photo, price in USD and C$, 30D change, 90D sparkline, "as of" date), sets and weekly issues. A shared card is cached by the platform for days, so the date on the image is mandatory, and a withheld price renders as "No current price". Zero effect on page budgets: the images are only fetched by crawlers.
11. **Email capture must be CASL-compliant from day one.** Standalone form, unchecked opt-in on signup, double opt-in, sender identification with a mailing address, one-click unsubscribe (`List-Unsubscribe-Post`), and a stored consent record. Send an HTML summary linking the web edition instead of a PDF attachment. Brevo's free tier (300 a day [verify]) caps the list at 300 before batching or moving to SES.
12. **Brand: replace the Poké Ball mark and add a trademark notice.** The logo, favicon and promo all use a Poké Ball, a mark owned by the Pokémon rights holders, on a site that promotes a store. Keep the name and palette, draw an original mark, and add the standard non-affiliation line to the footer. "Pokéfin" itself carries some risk; do not rebrand now, but do not build the mark on theirs.
13. **Fix the source's name and the weekly report's self-description.** The company styles itself "TCGplayer"; the site writes "TCGPlayer" everywhere. The weekly PDF says prices are "likely TCGPlayer market/listing values", calls itself "an internal analytical report", and ends "invest accordingly". It is emailed to readers and reads TCGplayer Market Price, so it should say so and carry the same disclaimer as the site.
14. **Privacy and legal pages need a Canadian frame and a real contact.** The privacy page cites GDPR only, names no email address ("the contact channel listed on the GitHub repository"), omits Vercel Web Analytics and Speed Insights, and there is no Terms page. Add PIPEDA framing, a forwarding address (`privacy@` and `hello@`, free forwarding), Terms of Use, and the newsletter and feedback processing.
15. **Nine work packages, TS01 to TS09, four migrations (provisionally 0040 to 0043).** TS01 (methodology, about, disclosures, terms, metric definitions) and TS02 (freshness system) need no migration and should ship first; they make every later feature more credible. `data-opportunities.md` has provisionally claimed 0033 to 0039, so this track numbers from 0040; renumber at merge time to the next free numbers after WP21's 0031 and 0032.

---

## 2. Trust today: evidence

| Signal a finance reader looks for | What the site shows today | Where |
|---|---|---|
| Source of prices | "refreshed hourly from TCGPlayer" (wrong cadence, WP03 fixes the word only) | `layout.tsx:29`, `Footer.tsx:89,111`, `page.tsx:207`, `prices/page.tsx:27` |
| What the price means | Nothing. Scraper reads `marketPrice` from TCGplayer's daily price-history buckets (`main.py:309`); the weekly PDF itself guesses "likely market/listing values" | `generate_weekly_report.py:848` |
| When a price was recorded | Only when withheld ("No current price, last recorded ..."); a fresh price has no date | `product/[id]/page.tsx` hero |
| Global freshness | "Last Refreshed" stat on `/` as a UTC clock time with no zone (WP07 fixes format) | `page.tsx` Quick Stats |
| Metric definitions | Tooltips on `/stats` only; product tiles "CAGR", "Volatility 30D", "Days of supply" undefined | `stats/page.tsx:4-25`, product page |
| Volatility unit | Product and Market: annualised (`returns.ts:139`); Stats: raw daily `stddev_pop` (`20260506:114`) | WP18 adds labels |
| Who runs it | "operated as a personal project" (privacy page only) | `privacy/page.tsx` |
| Commercial relationship | Store promo on 6 pages plus footer link, no relationship stated | `CardRinkPromo.tsx`, `Footer.tsx:91-98` |
| Advice framing | "Invest Score", "Good Deal / Fair Price / Overpriced", `signal: "buy" | "hold" | "avoid"` | `stats/page.tsx:23`, `BoxCalculator.tsx:55-58,580-584` |
| Disclaimer | README only; weekly PDF footer says "does not constitute financial advice ... invest accordingly" | `README.md:473`, `generate_weekly_report.py:909` |
| Contact | None on the site; privacy page points to GitHub | `privacy/page.tsx` |
| Status or incidents | None; the review found features broken for months with no reports | review F-series |
| Terms of use | None | |
| Trademark notice | None; Poké Ball glyph used as logo and in the promo | `Footer.tsx`, `CardRinkPromo.tsx`, `Header.tsx` |

---

## 3. Corrections to the existing plan

These are small edits to specs that have not shipped yet. Each should be applied in the named WP rather than in a later track, so nothing ships wrong and is then patched.

| WP | Current spec | Change | Why |
|---|---|---|---|
| WP13 step 7a | `buildProductJsonLd` emits `offers: { "@type": "Offer", price: usd_price, url: <pokefin product url> }` | Emit `offers: { "@type": "AggregateOffer", lowPrice, priceCurrency: "USD", offerCount, url: product.url }` only when the listings snapshot is fresh (`isListingsSnapshotFresh`, 3 days) **and** `hasCurrentPrice`. `lowPrice` = `lowest_listing_price`, `offerCount` = `active_listings`. Otherwise omit `offers`. | An `Offer` whose URL is Pokéfin states Pokéfin sells the box at that price. `AggregateOffer` is the type for multi-seller aggregator pages and is eligible for product snippets [verify]; the lowest ask is also the number a searcher wants. Market Price stays in the visible page. |
| WP13 step 7a | `description: "Live price, return metrics, and one-year price history for ..."` | `"Daily TCGplayer Market Price, returns, volatility and price history for {set} {label}. Prices in USD and CAD."` | "Live" contradicts the daily cadence WP03 just corrected. |
| WP13 step 7a | Product `twitter: { card: "summary" }`, `openGraph.images: [image_url]` | Keep until TS06 lands. TS06 removes `images` (the file-based `opengraph-image.tsx` overrides config metadata anyway) and sets `summary_large_image`. | Avoid two competing images. |
| WP13 step 3 | `viewport.themeColor: "#ffffff"`; PX09a proposes `#dc2626` | Keep `#ffffff` (and manifest `theme_color: "#ffffff"`). | The header is white; a red browser bar makes every page look like an error state and competes with the loss colour. Section 14. |
| WP13 step 3 | `openGraph.locale: "en_US"` | `"en_CA"` | Canadian site, CAD figures, `.ca` domain. Low impact; change while the line is being written. |
| WP15 step 3 | Promo label "Partner store"; `PokeballGlyph` in the promo | Label text states the relationship (section 7), and the glyph becomes the store's own name text or the new Pokéfin mark (section 14). | "Partner" does not tell a reader whether the site is owned by, paid by, or independent of the store. |
| WP15 pitfall | "Do not add `rel="sponsored"`" | Correct for an owned or unpaid store link. If any link becomes paid or affiliate (TCGplayer affiliate, section 7), those links get `rel="sponsored noopener"`. | Google's link attribute rule follows payment, not ownership. |
| WP03 / WP15 copy | "TCGPlayer" | "TCGplayer" in all user-facing copy and metadata (not in code identifiers). Add to WP15's `uiConventions.test.ts` as a spelling rule, like "Pokefin". | Getting the source's name right is a credibility signal. |
| WP16 (Python) | Weekly report copy untouched | `generate_weekly_report.py`: caveat says "Figures are TCGplayer Market Price in USD"; footer drops "internal analytical report" and "invest accordingly", uses the site's disclaimer line (section 8) and the non-affiliation line (section 9). Masthead slogan "All the Sealed Product That's Fit to Hold" can stay if the owner likes it; it is a parody of a newspaper slogan, low risk. | The PDF is the most shareable artefact Pokéfin makes. |

---

## 4. `/methodology`

### 4.1 Form

- One server-rendered page, static except for a small "current values" box (products tracked, last completed run, FX rate and date) read from cached data. No client JS.
- Versioned: `Methodology v1.0, effective 2026-10-xx`, with a change log at the bottom. Any change to a formula, threshold or gate bumps the version and is announced on `/changelog`. This is what index providers do and it is what makes a published number defensible later.
- Every metric on the site links to its anchor here (`/methodology#volatility`). The anchors and short definitions come from one module (section 4.4), so the tooltip and the page cannot disagree.
- `Article` JSON-LD with `dateModified` = version date; `BreadcrumbList`.

### 4.2 Outline and draft copy

Headings are the anchors. Draft text is intentionally short and literal; the formulas are the ones in the code at HEAD (and WP18's `marketMath.ts` after it lands; the page must be regenerated from that module's constants where possible).

1. **`#source` Where prices come from.** "Prices are TCGplayer Market Price for the English-language sealed product, in US dollars, collected once a day per product from TCGplayer's public product pages. Pokéfin is not affiliated with TCGplayer." Do not document endpoints or request details: the collection is unofficial (section 9).
2. **`#market-price` What Market Price is.** "TCGplayer calculates Market Price from recent completed sales on its marketplace, weighting recent sales more and excluding outliers [verify wording against TCGplayer's help article]. It is a smoothed average of what buyers paid, not the lowest price you can buy at today and not what you would receive when selling. Sellers pay TCGplayer fees and shipping, and a buyer in Canada also pays shipping, duties and taxes." Then a small table: Market Price vs Lowest ask (shown as "Lowest listing" on product pages when fresh) vs Pokéfin value in CAD.
3. **`#cadence` How often prices update.** "The collector runs every 4 hours and re-prices each product once a day, so a price is usually less than 30 hours old. Each price is dated with the TCGplayer day it describes." Link `/status`.
4. **`#freshness` When we hide a price.** "If a product has not been priced for 14 days, Pokéfin shows `--` instead of the last price, and hides every return and value derived from it (including portfolio values and the box calculator). Volatility, drawdown and trend describe the recorded history and stay visible. Sales figures are hidden after 3 days without data, and supply figures after a 3-day-old listings snapshot. `--` never means zero." Source: `0023`, `0018` to `0022`, `priceGuard.ts`.
5. **`#plausibility` Checks on new prices.** "A new price that is 3 times or more above or below the previous one is held and published only if the next run confirms it within 10%. Impossible values are rejected." Source: WP16 constants; publish them once WP16 merges.
6. **`#currency` Canadian dollars.** Today: "CAD figures convert the USD price at the latest Bank of Canada daily rate." After the data track's FX fix (`data-opportunities.md` 3.14): "Historical CAD figures use the Bank of Canada rate of that day." Always: "A CAD figure is a converted US marketplace price, not a Canadian market price."
7. **`#returns` Returns (7D, 1M, 3M, 6M, 1Y).** "Percent change from the latest daily price on or before the lookback date to today's price." Note for WP10/WP18 owners: today's SQL (`20260506_market_performance_functions.sql`, `anchors`) has no lower bound on how old that anchor may be, so a product with a 3-month hole can report a "30D" return measured over 120 days. The methodology should state a tolerance (proposal: anchor must be within 7 days of the target date for 7D and 1M, 14 days for longer windows, else `--`), and the bounded RPCs in WP10 are the place to add it.
8. **`#cagr` CAGR.** Formula, first-to-latest recorded price, plus the rule `ui-audit.md` item 8 asks for: not shown under 365 days of history.
9. **`#volatility` Volatility.** "Product pages and Market View: standard deviation of day-to-day percent changes over the last 30 recorded days, annualised by √365. Set Analytics: the same over 90 days, not annualised (daily)." Plus the honest caveat from `data-opportunities.md` 3.13: gaps and Market Price smoothing understate it. If the data track's weekly-log-return definition ships, bump the version.
10. **`#drawdown` Max drawdown.** Worst peak-to-trough fall in the window, with the window stated.
11. **`#trend` Trend.** Normalised linear-regression slope over 90D and 1Y.
12. **`#volume` Units sold, volume trend.** From TCGplayer's daily sales buckets; trend = last 30 days vs the 30 before; partial windows rule.
13. **`#supply` Active listings, units on market, days of supply.** Days of supply = units on market ÷ (units sold in 30 days ÷ 30); hidden when sales are zero or data is stale.
14. **`#market-pulse` Market Pulse signals.** Table of the four signals with thresholds: 30D price change ≥ +2% or ≤ -2%, volume trend ≥ +20% or ≤ -20%. "Stable" means both inputs exist and neither threshold is crossed; "No signal" means an input is missing.
15. **`#composite-score` Composite score (today "Invest Score").** "Each set gets a z-score on each metric across all ranked sets, then a weighted sum: 90D average return 0.40, 30D 0.20, 1Y 0.20, 90D consistency 0.15, 1Y consistency 0.10, 90D trend 0.10, 1Y trend 0.05, 90D volatility -0.20, 1Y max drawdown -0.15. A set with no current prices is unranked." (Weights from `0023_price_freshness_guard.sql:429-438`.) Present as a percentile on the page (section 8).
16. **`#box-nav` Box NAV and the pack-value comparison.** NAV = sum of pack Market Prices plus promo value; premium = (box price − NAV) ÷ NAV. Bands: at or below −10% "Below pack value", −10% to +5% "Near pack value", above +5% "Above pack value" (`BoxCalculator.tsx:56-58`).
17. **`#index` Pokéfin Sealed Index.** Placeholder until `data-opportunities.md` 3.7 ships; then its constituent, weighting, gap and provisional-day rules verbatim.
18. **`#coverage` What is tracked.** Counts by product type and era (live numbers), English only [owner to confirm], active products only, no singles or graded, and how to request a product (link to `/contact?topic=missing_product`).
19. **`#limits` Known limits.** Smoothed Market Price; US marketplace; before fees and shipping; history before live collection began is TCGplayer's weekly buckets, so early daily steps are artefacts; listings history starts 2026-07-07; thin products can move on one sale; data can stop when the collector is offline (see `/status`).
20. **`#corrections` Corrections.** "We do not edit prices by hand. When a price is wrong at the source, we can exclude a product until it is corrected, and we log every exclusion on /status." Report link.
21. **`#changes` Methodology changes.** Version table.

### 4.3 Where it is linked

Footer (every page), the header data chip, each "as of" stamp, every metric label's `?`, the promo-free trust line under page titles on `/prices`, `/market`, `/analytics`, the weekly email and PDF footer, `/about`.

### 4.4 One definitions module

New `frontend/app/lib/metricDefinitions.ts`: `{ key, label, unitLabel, window, short, anchor }` for every metric shown anywhere. `short` is the ≤ 120-character tooltip; `anchor` is the `/methodology#...` link. WP14 adds `METRIC_DEFINITIONS` inside `stats/page.tsx` and WP18 adds volatility unit labels: TS01 moves both into this module and makes `/stats`, `/market` headers, product tiles and `/methodology` read from it. A unit test asserts every `MetricTile` label and `StatHeader` label resolves to a definition, in the style of WP15's `uiConventions.test.ts`.

---

## 5. Freshness disclosure on every number

### 5.1 Rules

| Scope | Evidence | Display |
|---|---|---|
| Site pipeline | Last `scrape_runs` row with `status in ('ok','partial')` (TS03). Until TS03: `max(price_recorded_at)` over the summaries already cached. | Header chip. ≤ 12 h: neutral "Prices as of Sep 30, 6:10 AM EDT". 12 to 30 h: neutral "Last update 18 h ago". > 30 h: amber "Updates delayed since Sep 28, 6:10 AM EDT", links `/status`. |
| One product's price | `price_recorded_at` (date-only key, formatted by WP07 `format.ts`) | Recorded today or yesterday (UTC): "as of Sep 29" on heroes and cards, nothing extra in dense tables. 2 to 13 days: clock glyph plus "Last priced Sep 25" (tooltip in tables, visible text on the product hero). ≥ 14 days: withheld, `--` with the reason, as today. |
| Derived values (returns, CAGR, NAV, portfolio value) | `derivedFromPrice` | Inherit the price's stamp; never show their own date. Withheld with the price. |
| Series metrics (volatility, drawdown, trend) | History | Label window and unit ("Volatility, 30D, annualised"); ungated, per 0023. |
| Sales and supply | Sales bucket date, `snapshot_date` | "Listings as of Sep 29" under Market Pulse. |
| CAD | Exchange rate row date | "C$ at Bank of Canada rate of Sep 29 (1.3612)" as a footnote wherever CAD is shown. |
| Charts | Last point date | Final point labelled with its date; footnote "Daily Market Price. Before {live start}, weekly points." |
| Screens, movers, index | Anchor day | "Through Sep 29" on the section header. Movers never include a product whose price is not current. |

Principles: the stamp says what the number describes (a TCGplayer day), not when a page was rendered; ISR pages can be hours old, so "Updated 5 minutes ago" would be false. Use `<time dateTime="2026-09-29">`. Colour is never the only cue (glyph plus text, WP14 rules). No relative "x hours ago" in HTML that is cached for a day, except the header chip, which computes relative text from a timestamp on the client after mount, with the absolute time in the server HTML (no hydration mismatch because the server text is the absolute one and the relative one is an enhancement).

### 5.2 Components

All in `frontend/app/components/trust/`, server components unless stated:

- `AsOf.tsx`: `<AsOf date="2026-09-29" source="market-price" />` renders "as of Sep 29" with a `<time>`; variants `inline`, `hero`, `table` (glyph only when ≥ 2 days).
- `DataStatusChip.tsx`: rendered by `layout.tsx` and passed into `Header` as a slot, so `Header` (a client component) does not fetch. Reads `getCachedPipelineStatus()` (tag `market`, revalidated by WP11's scrape hook). A tiny client child upgrades the text to relative time after mount.
- `ProvenanceLine.tsx`: the single line under page titles on data pages: "TCGplayer Market Price in USD, updated daily. Prices older than 14 days are hidden. Methodology". Replaces the ad hoc "N products tracked · updated daily" strings WP03 writes.
- `MetricLabel.tsx`: label plus a `?` link to the anchor, text from `metricDefinitions.ts`. No tooltip JS; the `title` attribute plus the link is enough, and WP14's accessible tooltip can wrap it later.
- `ReportLink.tsx`: "Price look wrong? Report it" → `/contact?topic=wrong_price&product=42&from=/product/42`. A plain link: zero JS.

### 5.3 Product hero, target copy

```
$59.99 USD                         ↑ 4.2% 30D
TCGplayer Market Price for Sep 29, 2026
≈ C$82.10 at the Bank of Canada rate of Sep 29
Lowest listing $57.45 · 38 listings (as of Sep 29)
Price look wrong? Report it
```

Withheld variant keeps today's sentence ("No current price. Last recorded Sep 12, 2026") and adds the methodology link.

---

## 6. About and ownership

`/about`, server-rendered, `AboutPage` + `Organization` JSON-LD. Sections and draft copy (owner fills the brackets):

- **What Pokéfin is.** "Pokéfin tracks daily market prices, returns and supply for {N} English-language sealed Pokémon TCG products, in US and Canadian dollars. It is free and has no paid tier."
- **Who runs it.** "{Name or named pseudonym}, {city}, {province}. {One line on background: collector since, runs CardRinkTCG.ca if true}." A real named person is the strongest E-E-A-T and trust signal available to a one-person site; a consistent pseudonym with a photo or avatar is the fallback. Link to one social profile if one exists.
- **How Pokéfin makes money** (anchor `#disclosures`): the relationship statement from section 7, word for word.
- **Independence policy.** Four sentences: store relationship never affects rankings, scores, verdicts, movers or which products are tracked; no paid placements; prices are never edited by hand; the operator {and the store} may hold inventory of products shown on the site.
- **Data and methodology.** Two lines and a link.
- **Contact.** `hello@pokefin.ca`, `/contact`, response expectation ("usually within 3 days").
- **Changelog and status.** Links.

The inventory line matters: a site that publishes buy/avoid-style screens and is run by a seller of the same products has a conflict that finance readers expect to see stated. Stating it costs nothing and removes the "why is this site telling me to buy" suspicion.

---

## 7. Affiliate and sponsorship disclosure

### 7.1 What the rules expect (summary, not legal advice)

- **Canada, Competition Act** (false or misleading representations, s. 52 and s. 74.01). The Competition Bureau treats any undisclosed "material connection" that could affect how consumers weigh a recommendation as potentially misleading, and lists ownership, payment, commissions, free product and family relationships as material. Disclosures must be clear, prominent, visible without clicking, and close to the representation (Bureau influencer guidance; Deceptive Marketing Practices Digest vol. 4; Ad Standards disclosure guidelines).
- **US, FTC Endorsement Guides (16 CFR Part 255, revised 2023).** Material connections must be disclosed clearly and conspicuously, near the endorsement; a footer-only or "partner" label does not suffice. Applies to US visitors.
- **Google.** Paid and affiliate links carry `rel="sponsored"`; unpaid links do not need it.

### 7.2 Scenarios and copy

The owner must pick the true scenario (Owner decision D1). The promo label, the footer sentence and `/about#disclosures` use the same words.

| Scenario | Promo label (replaces "Partner store") | Footer sentence | `rel` |
|---|---|---|---|
| A. Operator owns or co-owns CardRinkTCG (most likely from the repo) | "From the team behind Pokéfin" | "Pokéfin is run by the team behind CardRinkTCG.ca, a Canadian card shop. The shop never affects prices, rankings or scores shown here." | `noopener` (owned, not paid) |
| B. Store pays for placement or commission | "Sponsored" | "CardRinkTCG.ca pays Pokéfin for this placement." | `sponsored noopener` |
| C. Friend's store, unpaid | "A shop we like" | "Pokéfin has a personal connection to CardRinkTCG.ca and is not paid for this link." | `noopener` |

Placement rules on top of WP15's one-promo-per-page:

1. Never adjacent to a verdict, score, mover list or screen result. The store block stays last in `<main>`, which WP15 already enforces.
2. Never deep-link a specific product from a "Below pack value" or top-mover context to the store. A store link next to a buy-style signal is the exact pattern the conflict rules target.
3. The weekly email carries the same label if it includes the store.

### 7.3 TCGplayer affiliate (optional revenue)

TCGplayer runs an affiliate program through Impact (reported 3.5% of referred sales [verify]). Every product already has a "View on TCGplayer" button, so this is the one monetisation that fits the product without adding ads. If adopted: tracked links get `rel="sponsored noopener"`, the button label gains a small "affiliate link" note or the provenance line says "Links to TCGplayer may earn Pokéfin a commission", and `/about#disclosures` states it. It creates no incentive problem for rankings (every product links equally). Check that the Impact program terms permit a site whose data is collected from TCGplayer (section 9).

---

## 8. Not-investment-advice, done tastefully

Layers, from least to most visible:

1. **Footer, every page:** "Market data for information only, not financial advice. Past prices do not predict future prices." One line, same size as the copyright.
2. **Contextual, where a decision is framed:** under the composite score table, box calculator result, top movers, screens and any editorial "best" page: "Screens describe past prices. They are not recommendations. How we calculate this." Grey, one line, never a banner or modal.
3. **`/terms`:** information only, no warranty of accuracy or availability, TCGplayer-derived data may be wrong or late, no liability for decisions, acceptable use (no bulk scraping of Pokéfin), governing law {province}, contact. Owner action: have it reviewed once.

Rename advice-sounding labels (TS01, copy only):

| Today | New | Where |
|---|---|---|
| Invest Score | Composite score, shown as percentile ("Top 12%") with the raw value in the tooltip | `/stats` |
| Good Deal / Fair Price / Overpriced | Below pack value / Near pack value / Above pack value | Box calculator |
| `signal: "buy" | "hold" | "avoid"` | Internal names may stay; user-facing strings change | `BoxCalculator.tsx`, `types.ts` |
| "Ready to start collecting?" | Keep; it is the store's pitch, labelled per section 7 | Promo |
| Editorial "best to invest" | "What the data says" framing, section 11.6 | Guides |

A note on securities rules: sealed product is a collectible, not a security, and commentary on collectibles does not normally engage provincial adviser registration. The disclaimer is about honesty and consumer-protection exposure, not registration. Do not claim otherwise on the site.

---

## 9. Legal and IP notices

- **Pokémon marks.** Footer line: "Pokémon and Pokémon character names are trademarks of Nintendo, Creatures Inc. and GAME FREAK inc. Pokéfin is not affiliated with, endorsed or sponsored by Nintendo, The Pokémon Company, Creatures or GAME FREAK." Replace the Poké Ball glyph (section 14). Use product photos for identification only, never in the logo or brand art.
- **TCGplayer.** "TCGplayer is a trademark of TCGplayer, Inc. Pokéfin is not affiliated with TCGplayer." Text mention only, no TCGplayer logo. The collection uses TCGplayer's public web endpoints without an agreement; the owner should know TCGplayer can block or object at any time. Two consequences for this track: do not publish endpoint details on `/methodology`, and do not redistribute raw TCGplayer prices as a downloadable dataset (derived series such as the Pokéfin index are fine).
- **Privacy page update** (TS01): PIPEDA framing for a Canadian operator (keep the GDPR rights text for EU visitors); name Vercel Web Analytics and Speed Insights (cookieless, aggregated) and Brevo (email) as sub-processors; add sections for feedback submissions and newsletter data (consent records kept for 3 years after the last send, see 13.3); replace the GitHub contact with `privacy@pokefin.ca`; brand spelling per WP15.
- **Email forwarding** for `hello@`, `privacy@`, `reports@`: registrar forwarding, ImprovMX's free tier, or Cloudflare Email Routing if DNS moves to Cloudflare. Free.

---

## 10. Feedback, status and incident communication

### 10.1 In-app feedback

**Entry points** (all plain links, zero JS on the page that shows them):
- Product hero and Market Pulse: "Price look wrong? Report it" (`topic=wrong_price&product=<id>`).
- Every empty state (WP13 `NoResults`): "Missing a product? Tell us" (`topic=missing_product&q=<query>`).
- `error.tsx` and `global-error.tsx` (WP15 rewrote them): "Tell us what happened" with `digest=<error.digest>`.
- Portfolio, account and box calculator failure messages (WP15 `userMessages.ts`): "Report this problem" (`topic=broken_feature&from=<path>`).
- Footer: "Feedback".

**`/contact` page:** topic radio (wrong price, wrong product info, missing product, broken feature, idea, other), message, optional email ("only to reply to you"), prefilled hidden context, Turnstile (already in the CSP for auth). One client island, loaded only on this route. Success state says what happens next ("We read every report. Price reports are checked against TCGplayer within a few days.").

**Route:** `app/api/feedback/route.ts`, POST, `rejectIfCsrfFails` + `rejectIfBodyTooLarge(req, 8_192)` + WP02 rate limit + Turnstile verification. Captures server-side: `page_path` (validated same-origin path), `product_id` (validated integer), `VERCEL_GIT_COMMIT_SHA`, a coarse client hint (viewport bucket and browser family, not the full UA), and the user id when a session cookie exists. Calls `submit_feedback` (migration 0042) and then emails the owner through Brevo's HTTP API (`BREVO_API_KEY` in Vercel, free tier), one email per report, subject `[Pokéfin] wrong_price · Prismatic Evolutions ETB`.

**Why a signed RPC.** The web app only holds the publishable key (no service key in Vercel, and WP21 is removing broad keys). An anon-executable insert function would let anyone skip Turnstile by calling PostgREST directly. Pattern: the route signs `(topic, message hash, product_id, issued_at)` with an HMAC secret held in Vercel and in Supabase Vault; `submit_feedback` recomputes it with `extensions.hmac` against `vault.decrypted_secrets` and rejects unsigned or older-than-5-minute calls. Plus a global cap in the function (200 rows an hour) as a backstop. Same pattern for the newsletter RPCs. Free and uses only built-in Supabase features.

**Triage:** the owner works the `feedback` table in the Supabase dashboard (`status` column). No admin UI in v1. Price reports that lead to an exclusion or a fix become a `site_notices` row of kind `data_correction`, which closes the loop publicly.

**Account data:** `export_my_data` (0011, WP01) must include the user's feedback rows; account deletion sets `feedback.user_id` to null (FK `ON DELETE SET NULL`).

### 10.2 Status page and incidents

**`scrape_runs`** (0040), written by `main.py`: one row at start (`running`), updated at the end with counts and `ok`, `partial` (some products failed) or `failed`. Written through WP21's `pokefin_scraper` role (add to its grant list). This also feeds the index "provisional" flag proposed in `data-opportunities.md`.

**`get_pipeline_status()`** (0040), anon-executable, `STABLE`, `SECURITY DEFINER`, pinned `search_path`: last run, last successful run, products active, products priced in the last 48 h, products withheld (≥ 14 days), latest FX rate date. Bounded work (about 306 index lookups).

**`site_notices`** (0040): owner-written rows (dashboard) with `kind` (`incident`, `maintenance`, `data_correction`, `info`), `severity`, `title`, `body`, `affected` areas, `starts_at`, `resolved_at`, `show_banner`. Public read limited to the last 180 days by RLS.

**`/status`:** ISR (tag `market` plus a 5-minute revalidate for notices, since the owner edits them in the dashboard). Shows: pipeline state in words ("Collecting normally. Last run finished Sep 30, 6:12 AM EDT; 301 of 306 products priced in the last 48 hours; 2 hidden as stale"), open notices, the last 90 days of notices and corrections, links to `/contact` and `/changelog`. `noindex` (useful to users, not to search).

**Banner:** `layout.tsx` renders one `SiteNotice` above the header only for an unresolved notice with `show_banner`. Server-rendered, no layout shift (it is in the initial HTML), dismissible per session through a tiny island, capped at one line.

**Automatic degradation, no human needed:** the header chip turns amber after 30 h without a successful run. This is the case that matters most: the collector runs on the owner's machine, and a sleeping laptop is otherwise invisible.

### 10.3 Catching silent breakage

Feedback does not fix "broken for months, zero reports"; most visitors leave rather than write. Add a scheduled smoke test:

- GitHub Actions workflow `prod-smoke.yml`, daily at 11:07 UTC, Playwright against production: `/`, `/prices`, `/market`, `/analytics`, `/product/<known id>`, `/box-calculator`, `/sitemap.xml` return 200 and contain a price; the header chip is not amber; a dedicated test account can sign in, load `/portfolio`, and receive a 200 from `/api/account/export` (WP01's route).
- On failure: the workflow opens or updates one GitHub issue (default notification emails the owner). Free for public repos, and within the 2,000 free minutes a month for private ones (about 60 minutes a month at 2 minutes a run).
- WP17 turns on Sentry; route handler errors reach it. This test covers what Sentry cannot see: a page that renders fine but shows no data.

### 10.4 Changelog

`/changelog`: a list of dated entries from a typed array in `app/content/changelog.ts` (no CMS). The remediation wave is the first content: "Portfolio saves again", "Account export works", "Prices now show the date they describe". Publishing fixes is itself a trust signal, and it gives returning users a reason to re-try features that failed before. Link from footer and `/status`.

---

## 11. SEO content architecture

### 11.1 URL map

| URL | Type | Indexed | Source data |
|---|---|---|---|
| `/` | Market home | yes | existing |
| `/prices`, `/market`, `/analytics` | Tools | yes (WP13) | existing |
| `/product/[id]` | Product | yes | existing; URL unchanged |
| `/sets` | Hub index | yes | sets + summaries |
| `/sets/[slug]` | Set hub | yes if ≥ 3 priced products | summaries filtered by set |
| `/sealed` and `/sealed/[slug]` | Product-type hubs (booster-box, elite-trainer-box, booster-bundle, ...) | yes if ≥ 3 priced | summaries filtered by type |
| `/eras/[slug]` | Generation hubs (scarlet-and-violet, sword-and-shield, ...) | yes | summaries filtered by generation |
| `/guides/[slug]` | Editorial | yes | section 11.6 |
| `/weekly`, `/weekly/[date]` | Weekly web edition | yes | `data-opportunities.md` 3.12 |
| `/methodology`, `/about` | Trust | yes | TS01 |
| `/contact`, `/status`, `/changelog`, `/terms` | Utility | `noindex` for status and contact; changelog and terms indexed | TS01, TS03, TS04 |

Why `/eras` and `/sealed` rather than `/generations` and `/types`: they are the words collectors search and say ("Scarlet & Violet era", "sealed booster boxes"). Set URLs use name slugs (`/sets/prismatic-evolutions`), not set codes: people search names, and `sets.code` is not unique in the schema.

**Product URLs stay `/product/[id]`.** A slug suffix (`/product/42/prismatic-evolutions-elite-trainer-box`) would help click-through slightly, but WP13 just established canonicals and a strict id parser; changing them means 308 redirects for every URL and a re-crawl. Revisit after a year of Search Console data. The product page gets the name into the title, H1, breadcrumbs and anchor text instead, which is where the ranking signal is.

### 11.2 Slugs (migration 0041)

`slug` columns on `sets`, `product_types` and `generations`, filled once by an immutable `pokefin_slugify(text)` function, unique, and set on insert by a trigger when null. Renaming a set does not change its slug (URL stability). Hubs read slug maps from these three small tables (cached, tag `market`) and join in TypeScript against the already-cached `get_market_product_summaries` result, so no RPC signature changes (0023 notes that widening that RPC's return type needs a drop and create).

### 11.3 Hub page spec (all three kinds)

Server component, ISR with WP11's empty `generateStaticParams` pattern and the `market` tag; no Recharts.

1. H1 "{Set name} sealed product prices" (set), "{Type label} prices" (type), "{Era} sealed product prices" (era).
2. `ProvenanceLine` and an "as of" date.
3. **Data-derived summary**, generated deterministically from the numbers, not by an LLM: "Prismatic Evolutions has 9 tracked sealed products, released Jan 17, 2025. The median 1-year change is +38%; the Booster Bundle moved most (+61%) and the Elite Trainer Box sold the most units in the last 30 days (412). 2 products have no current price." Each sentence is a template with a condition; sentences whose inputs are null are dropped. This is what separates a useful programmatic page from a thin one.
4. Table (the WP19 table component or the ui-audit `DataList` on phones): product, price, 30D, 1Y, units sold 30D, days of supply, sparkline (PX04 server SVG).
5. Set hubs: a set-level line chart as server SVG (median of constituents, or the data track's set index when it exists); release date; neighbouring sets (previous and next by release date).
6. Type and era hubs: a ranking by 1Y change with the liquidity screen from the weekly report (≥ 3 distinct prices in a year, price ≥ $15), and links to every set in the era.
7. Contextual disclaimer line (section 8) and one store promo at most (WP15 rule).

**Thin-content rules.** A hub with fewer than 3 priced products renders but is `noindex` and left out of the sitemap. No set-by-type or type-by-era combination pages. No per-product "vs" pages.

### 11.4 Internal linking

- Product breadcrumb (today "Market View / {set}" with the set as plain text) becomes Home › Sets › {Set} › {Type label}, each linked. `BreadcrumbList` JSON-LD with the same items.
- Product page: set name links to `/sets/[slug]`, type badge to `/sealed/[slug]`, era label to `/eras/[slug]`; the existing siblings grid stays; add "Other {type} prices" (same type, nearest release dates, 5 items).
- `/stats` rows link to set hubs (ui-audit item 6 asked for clickable rows).
- Footer gets a "Browse" column: All sets, Booster boxes, Elite Trainer Boxes, Booster bundles, Scarlet & Violet, Mega Evolution (or current era), Sword & Shield. Server-rendered links, crawlable on every page.
- Guides link to the hubs and products they discuss with descriptive anchor text, and hubs link back to the one guide that explains their metric (for example type hubs → "Booster box vs ETB").
- Movers on `/` link to products; each weekly issue links to every product it names.

### 11.5 Structured data

| Page | JSON-LD | Notes |
|---|---|---|
| `/` | `WebSite` (`name: "Pokéfin"`, `alternateName: ["Pokefin"]`, `url`), `Organization` (`name`, `url`, `logo` ≥ 112 px square PNG, `sameAs` for real profiles only) | `WebSite` drives Google's site-name display; the unaccented alternate matches how people type it. No `SearchAction`. |
| `/product/[id]` | `Product` (`name`, `image`, `sku`, `brand: Pokémon`, `category`), `offers: AggregateOffer` per section 3, `BreadcrumbList` | Never publish a price when `hasCurrentPrice` is false (WP13 pitfall stands). |
| Hubs | `CollectionPage` with `mainEntity: ItemList` of `ListItem` (`url`, `position`, `name`), `BreadcrumbList` | ItemList is for understanding; do not expect a carousel. |
| `/guides/*`, `/weekly/*`, `/methodology` | `Article` (`headline`, `datePublished`, `dateModified`, `author` Person with `url` to `/about`, `publisher` Organization) | Real author and dates are the E-E-A-T signal for money-adjacent topics. |
| `/indices/sealed` (when the index ships) | `Dataset` (`name`, `description`, `creator`, `license` CC BY 4.0, `temporalCoverage`, `distribution: DataDownload` CSV of index levels) | Only Pokéfin's derived series. Eligible for Google Dataset Search [verify]. |

Every block goes through WP13's `serializeJsonLd`. A unit test per builder, like WP13's `productMeta.test.ts`.

### 11.6 Editorial hubs (`/guides/[slug]`)

Content lives in the repo as typed TSX modules (`app/guides/<slug>/page.tsx` with shared layout), reviewed like code. No CMS, no new dependency. Each guide mixes evergreen prose with live data blocks rendered from cached data, so it stays current without rewriting.

Launch set, chosen for search intent a collector-investor actually has:

1. **"Best Pokémon sealed products to invest in? What the price data says"** (`best-pokemon-sealed-products`). Title matches the query; the H1 and body do not recommend. Blocks: 1Y leaders by type with the liquidity screen, "steady compounders" (low volatility, positive 1Y), "below pack value" boxes, each with "How we picked" and the contextual disclaimer. Updated automatically daily; prose reviewed quarterly; `dateModified` tracks the data date.
2. **"Booster box vs Elite Trainer Box: which held value better"**, from type-hub medians per era.
3. **"TCGplayer Market Price explained"**, the long form of `/methodology#market-price`, with Market Price vs lowest listing charts. Captures a high-intent informational query and links into the methodology.
4. **"Buying sealed Pokémon in Canada: prices, shipping, duties and CAD"**. Pairs with the landed-cost calculator from `competitive-landscape.md` differentiator 1; nobody else writes this for Canadians.
5. **"What is box NAV (and why booster boxes trade above their packs)"**, feeds `/box-calculator`.
6. **"Out-of-print Pokémon sets: what happened to prices"**, once the data track's print-status events exist.

Rules: named author, published and modified dates, a methodology box, the disclaimer line, the relationship disclosure if the store appears, and no AI-written filler. Measure with Search Console before writing guide 7.

### 11.7 Sitemap, crawl and tools

- Extend WP13's `sitemap.ts`: hubs (with `lastModified` = latest `price_recorded_at` among their products), guides, `/methodology`, `/about`, `/changelog`, `/terms`, weekly issues. Exclude `noindex` hubs, `/status`, `/contact`.
- Google Search Console (WP13 owner action) plus Bing Webmaster Tools (free; Bing also feeds DuckDuckGo and some AI search products). Optional IndexNow ping from the WP11 revalidate route for new products and sets only, not for daily price changes.
- Titles: product "{Set} {Type} ({variant}) Price and History" (WP13 template appends "· Pokéfin"); hubs "{Set} Sealed Prices: Booster Box, ETB and More". Keep prices out of `<title>`: they go stale in results and Google rewrites them; the meta description carries "Market Price $59.99 as of Sep 29" and updates on recrawl.

### 11.8 Dynamic OG images

| File | Content | Data |
|---|---|---|
| `app/opengraph-image.tsx` (WP13, static) | Brand card | none |
| `app/product/[id]/opengraph-image.tsx` | Product photo left; right: name, set and era, "$59.99 USD · C$82.10", 30D change with arrow glyph and gain/loss colour, 90-day sparkline as inline SVG path, footer "TCGplayer Market Price for Sep 29, 2026 · pokefin.ca" and the new mark | `getCachedProductDetail` (tagged), `getCachedExchangeRate` |
| `app/sets/[slug]/opengraph-image.tsx` | Set name, era, release date, product count, median 1Y change, up to 3 product photos | cached summaries |
| `app/weekly/[date]/opengraph-image.tsx` | Masthead, issue date, derived headline | `weekly_reports` payload (data track) |

Rules:
- `export const revalidate = 86400` and the same tagged cached fetchers, so WP11's scrape hook refreshes the data; `size = { width: 1200, height: 630 }`; `contentType = "image/png"`.
- A withheld price renders "No current price" and "Last priced Sep 12". Never the stale number.
- The date on the card is mandatory: X, Discord, iMessage and Reddit cache a card per URL for days, so the image must say which day it describes.
- Photos: Satori decodes PNG and JPEG; WebP support should not be assumed [verify in a spike]. Originals can be WebP (`main.py` keeps the detected format) and thumbnails always are. Use the original when PNG or JPEG; otherwise ask PX05's derivative step to also write a 600 px JPEG, or fall back to a layout without the photo.
- Fonts: commit Geist Regular and Bold `.ttf` (OFL) under `frontend/assets/og/`, read once at module scope; stay under the 500 KB `ImageResponse` bundle limit. Every multi-child `div` keeps `display: "flex"`.
- File-based OG metadata overrides config metadata, so TS06 removes `openGraph.images` from WP13's `buildProductMetadata` and sets `twitter.card = "summary_large_image"`.
- Cost: rendered on the first crawler fetch per product per day at most; no effect on visitor page weight or LCP.

---

## 12. Weekly report: email capture and delivery

### 12.1 Placement

- `/weekly` and every `/weekly/[date]` (primary: the reader already wants it).
- Home, one compact block below Top Movers ("The Pokéfin Weekly: the sealed market in 5 minutes, every Friday").
- End of `/methodology` and each guide.
- Signup form: a separate unchecked checkbox. Account page: a toggle.
- No pop-ups, no exit intent, no interstitials: they cost INP and trust.

### 12.2 CASL requirements and how the design meets them

| Requirement (CASL and the CRTC's consent guidance) | Implementation |
|---|---|
| Express consent, requested separately from other terms, not pre-checked | Standalone form's submit is the consent act; on signup a separate unchecked box. |
| Consent request states purpose, who is asking, contact details, and that consent can be withdrawn | Form copy: "Get The Pokéfin Weekly by email every Friday. Sent by Pokéfin, {mailing address}, hello@pokefin.ca. Unsubscribe any time." |
| Every message identifies the sender with a mailing address and a working contact | Email footer template. A PO box or virtual mailbox is acceptable if the owner does not want a home address public (Owner decision D4). |
| Unsubscribe that works without login, honoured within 10 business days, valid for at least 60 days after sending | One-click link and `List-Unsubscribe` plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058); applied instantly. |
| Proof of consent is on the sender | `newsletter_subscribers` stores consent text version, source page, timestamp, IP, confirmation timestamp. Retain for 3 years after the last message sent. |

Double opt-in is not strictly required by CASL; use it anyway (proves consent, blocks typo and abuse signups, protects sender reputation). Signed-in users whose email Supabase already verified are confirmed directly.

### 12.3 Flow and data

1. `POST /api/newsletter/subscribe` (CSRF, rate limit, Turnstile, signed RPC `newsletter_subscribe`). The response is the same whether the address is new, pending or already confirmed (no enumeration).
2. The route sends a confirmation email through Brevo's HTTP API with a link to `/newsletter/confirm?t=<uuid>` (expires in 7 days).
3. `GET /newsletter/confirm` shows a button; the POST confirms (link scanners that prefetch GETs cannot confirm on the user's behalf). The same GET-shows, POST-acts rule applies to unsubscribe, except the RFC 8058 one-click POST from mail clients.
4. `send_weekly_email.py` (WP16 area) reads recipients through `get_weekly_recipients()` (0043), granted only to the role WP21 assigns the weekly job, and sends one message per recipient with personalised unsubscribe headers.

Content change: send an HTML email (headline, category table, top 5 movers, CTA "Read the full edition" → `/weekly/[date]`, PDF download link to Storage) instead of attaching the PDF. Attachments hurt deliverability and are unreadable on phones. Keep the PDF as a download.

Deliverability, Owner actions: SPF include for Brevo, DKIM, DMARC starting at `p=none` with reports, moving to `quarantine` after two clean weeks; send from `weekly@pokefin.ca`.

Limits: Brevo free tier is 300 emails a day [verify current limit]. Above that, split the send across two days or move to Amazon SES (paid, about US$0.10 per 1,000); both speak SMTP, which `send_weekly_email.py` already abstracts.

Account deletion removes the subscriber row; keep a hashed-email suppression row only if the user had unsubscribed, so a later re-import cannot re-add them. `export_my_data` includes the subscription record.

---

## 13. Data model (migrations, provisional numbers)

New objects only; RLS on every table; `search_path` pinned on every function (0007 convention); FK columns indexed (WP01 rule); grants listed explicitly (0006, 0013 conventions); `verify_migration.py` expectations added per migration.

**`0040_pipeline_status.sql`**

```sql
CREATE TABLE public.scrape_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','ok','partial','failed','skipped')),
  products_due integer CHECK (products_due >= 0),
  prices_written integer CHECK (prices_written >= 0),
  prices_held integer CHECK (prices_held >= 0),       -- WP16 pending confirmations
  price_failures integer CHECK (price_failures >= 0),
  listings_written integer CHECK (listings_written >= 0),
  scraper_version text CHECK (char_length(scraper_version) <= 64),
  note text CHECK (char_length(note) <= 500)
);
CREATE INDEX scrape_runs_finished_at_idx ON public.scrape_runs (finished_at DESC);
ALTER TABLE public.scrape_runs ENABLE ROW LEVEL SECURITY;   -- no policies: read via get_pipeline_status()
REVOKE ALL ON public.scrape_runs FROM anon, authenticated;
-- WP21 grant list: INSERT, UPDATE on scrape_runs and USAGE on its sequence to pokefin_scraper.

CREATE TABLE public.site_notices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('incident','maintenance','data_correction','info')),
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 5 AND 120),
  body text NOT NULL CHECK (char_length(body) <= 2000),
  affected text[] NOT NULL DEFAULT '{}',
  starts_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz CHECK (resolved_at IS NULL OR resolved_at >= starts_at),
  show_banner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_notices_starts_at_idx ON public.site_notices (starts_at DESC);
ALTER TABLE public.site_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY site_notices_public_read ON public.site_notices FOR SELECT TO anon, authenticated
  USING (starts_at <= now() AND starts_at >= now() - interval '180 days');
GRANT SELECT ON public.site_notices TO anon, authenticated;

CREATE FUNCTION public.get_pipeline_status()
RETURNS TABLE (last_run_at timestamptz, last_run_status text, last_success_at timestamptz,
               products_active integer, priced_48h integer, withheld integer, fx_rate_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH latest AS (
    SELECT p.id, (SELECT max(h.recorded_at) FROM public.product_price_history h
                  WHERE h.product_id = p.id) AS recorded_at   -- uses (product_id, recorded_at DESC)
    FROM public.products p WHERE p.active)
  SELECT
    (SELECT max(started_at) FROM public.scrape_runs),
    (SELECT status FROM public.scrape_runs ORDER BY started_at DESC LIMIT 1),
    (SELECT max(finished_at) FROM public.scrape_runs WHERE status IN ('ok','partial')),
    (SELECT count(*)::int FROM latest),
    (SELECT count(*)::int FROM latest WHERE recorded_at >= now() - interval '48 hours'),
    (SELECT count(*)::int FROM latest WHERE recorded_at IS NULL OR recorded_at < current_date - 14),
    (SELECT max(recorded_at)::date FROM public.exchange_rates);
$$;
REVOKE ALL ON FUNCTION public.get_pipeline_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pipeline_status() TO anon, authenticated;
```

The `withheld` expression must mirror 0023's rule exactly (history timestamp against `current_date - 14`); if WP10 or WP18 centralise that rule in a SQL helper, call it instead.

**`0041_taxonomy_slugs.sql`**

```sql
CREATE FUNCTION public.pokefin_slugify(input text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT btrim(regexp_replace(
           translate(lower(replace(input, '&', ' and ')),
                     'àáâäãåèéêëìíîïòóôöõùúûüçñ',
                     'aaaaaaeeeeiiiiooooouuuucn'),
           '[^a-z0-9]+', '-', 'g'), '-');
$$;

ALTER TABLE public.sets ADD COLUMN slug text;
UPDATE public.sets SET slug = public.pokefin_slugify(name);
-- Disambiguate duplicates deterministically before the constraint.
UPDATE public.sets s SET slug = s.slug || '-' || public.pokefin_slugify(s.code)
WHERE EXISTS (SELECT 1 FROM public.sets o WHERE o.slug = s.slug AND o.id <> s.id);
ALTER TABLE public.sets ALTER COLUMN slug SET NOT NULL,
  ADD CONSTRAINT sets_slug_key UNIQUE (slug),
  ADD CONSTRAINT sets_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
-- Same three steps for product_types (from coalesce(label, name)) and generations (from name).

CREATE FUNCTION public.set_default_slug() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.slug IS NULL THEN NEW.slug := public.pokefin_slugify(NEW.name); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sets_default_slug BEFORE INSERT ON public.sets
  FOR EACH ROW EXECUTE FUNCTION public.set_default_slug();
-- (product_types uses coalesce(NEW.label, NEW.name) in its own trigger function.)
```

Owner check before applying: `SELECT pokefin_slugify(name), count(*) FROM sets GROUP BY 1 HAVING count(*) > 1;` (expect no rows after the disambiguation step).

**`0042_feedback.sql`**: `feedback` table (topic enum by CHECK, message 5 to 4,000 chars, `page_path` ≤ 300, `product_id` FK `ON DELETE SET NULL` with index, `contact_email` ≤ 254, `user_id` FK to `auth.users` `ON DELETE SET NULL` with index, `build_sha`, `error_digest`, `client_hint`, `status` default `new`), RLS on with no policies, revoked from `anon` and `authenticated`. `submit_feedback(p_topic, p_message, p_page_path, p_product_id, p_contact_email, p_build_sha, p_error_digest, p_client_hint, p_issued_at, p_signature) RETURNS bigint`, `SECURITY DEFINER`, `search_path = public, extensions, pg_temp`: verifies the HMAC against `vault.decrypted_secrets WHERE name = 'pokefin_form_hmac'`, rejects `p_issued_at` older than 5 minutes, enforces the 200-per-hour global cap, sets `user_id := auth.uid()`. Execute granted to `anon, authenticated`. Update `export_my_data` (0011) to include the caller's rows.

**`0043_newsletter.sql`**: `newsletter_subscribers` (`email` ≤ 254, `email_normalized` generated `lower(btrim(email))` and unique, `status` in `pending, confirmed, unsubscribed, bounced, complained`, `user_id` FK `ON DELETE CASCADE` with index, `consent_text_version`, `consent_source`, `consent_ip inet`, `consent_at`, `confirmed_at`, `unsubscribed_at`, `confirm_token uuid` plus `confirm_expires_at`, `unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE`, timestamps), `newsletter_suppressions (email_hash bytea PRIMARY KEY, created_at)`. RLS on, no policies. Functions: `newsletter_subscribe` (signed, as 0042), `newsletter_confirm(uuid)`, `newsletter_unsubscribe(uuid)` (idempotent, writes suppression), `newsletter_set_for_me(boolean)` (authenticated, uses `auth.uid()` and the verified email), `get_weekly_recipients()` (execute only for the weekly job's WP21 role). `export_my_data` includes the row.

---

## 14. Brand

### 14.1 Mark and logo

- **Replace the Poké Ball glyph** everywhere (`Header.tsx`, `Footer.tsx`, `CardRinkPromo.tsx`, favicon). Brief for the new mark: original geometry, legible at 16 px, reads as "market" and "sealed", works in one colour. Two directions worth sketching: (a) a rounded square with a rising three-step line that forms a "P"; (b) an isometric sealed box whose top edge is a chart line. Red `#dc2626` fill, white glyph; one-colour ink version for the PDF.
- **Wordmark:** keep today's "Pok**é**fin" treatment (Geist Bold, accent "é" in brand red); it is already distinctive and costs no asset.
- **Lockups:** mark only (favicon, app icon), mark plus wordmark horizontal (header, OG, email), wordmark only (PDF masthead subtitle).
- Deliverables as SVG in `frontend/app/` (`icon.svg`) and `frontend/public/brand/` (logo SVGs, 512 px PNG for `Organization.logo`).

### 14.2 Icon set (coordinate with PX09a)

PX09a owns `app/manifest.ts` and the file list. This track supplies artwork:

| File | Size | Notes |
|---|---|---|
| `app/icon.svg` | vector | Includes a `@media (prefers-color-scheme: dark)` rule inside the SVG so the tab icon survives dark tab strips |
| `app/favicon.ico` | 16, 32, 48 multi-size | Replaces the 31 kB 512 px PNG disguised as ICO |
| `app/apple-icon.png` | 180 × 180 | Opaque background (iOS ignores transparency) |
| Manifest icons | 192, 512, 512 maskable | Maskable keeps the glyph inside the central 80% safe zone |

`theme_color` `#ffffff`, `background_color` `#f8fafc` (`--pf-bg`). WP13's copy-the-PNG step is superseded, as PX09a already notes.

### 14.3 Colour roles

Tokens stay in `globals.css`. The issue is roles, not values: brand red `#dc2626` and loss rose `#e11d48` are close, and the brand red is used for CTAs. Adopt `ui-audit.md` item 9's rule: red is brand (logo, one primary CTA per view), rose plus a down glyph is loss, and no red text on data. WP14 and WP15 fix drift; this sets the rule for new surfaces (hubs, OG cards, status, emails).

### 14.4 Voice

- **Register:** a knowledgeable collector talking to another, with a finance desk's precision. Short sentences. Numbers before adjectives.
- **Names:** Pokéfin, Pokémon, TCGplayer, Elite Trainer Box (ETB after first use), Market Price (capitalised when it means TCGplayer's metric), Bank of Canada.
- **Currency:** WP07's `$` for USD and `C$` for CAD, and the currency code on every headline price ("$59.99 USD") because a Canadian reader's default "$" is CAD.
- **Time:** dates as WP07 formats them; instants in ET with the zone abbreviation.
- **Certainty words:** "Market Price", "tracked since", "last priced", "screens", "below pack value". Avoid "value" when meaning price, "all-time" (history is about a year), "live", "real-time", "undervalued", "buy now", "guaranteed", "moon".
- **Missing data:** say why and when ("No current price. Last priced Sep 12."), never "Error" or a bare dash on a headline.
- **Punctuation:** no em dashes (WP15 already forbids them in UI copy); one ellipsis style (`…`, WP15). Applies to emails and the PDF too; the weekly generator currently uses `&mdash;` in several strings.
- **Enforcement:** extend WP15's `uiConventions.test.ts` with "TCGPlayer" (wrong casing), "live price", "real-time" and "Invest Score" as banned strings in `app/**/*.tsx`.

---

## 15. Performance guardrails

- Everything in this track is server-rendered HTML. The only new client code: the `DataStatusChip` relative-time child (≤ 1 kB), the notice dismiss button (≤ 1 kB), and the `/contact` and newsletter forms (≤ 4 kB each, own route or lazily hydrated; Turnstile's script loads on first focus of the form, never on page load).
- No new data on the product page's critical path beyond `listings.lowest_listing_price` and `active_listings`, which `getCachedProductDetail` already loads (`listings` object).
- `get_pipeline_status()` is cached under the `market` tag in the root layout; it must not make statically rendered routes dynamic (use the WP11 cached-fetcher pattern, not `cookies()` or `headers()`).
- JSON-LD adds 1 to 3 kB of HTML per page. Hubs reuse the summaries cache: no extra RPC call per hub render.
- OG images are off the visitor path.
- Budgets from `performance-excellence.md` section 4 apply unchanged; each TS package runs WP00's stub build and PX's size check.

---

## 16. Work packages

Each is one PR, specced in the house format before execution. Effort in hours includes tests.

| ID | Title | Depends on | Migration | Effort |
|---|---|---|---|---|
| TS01 | Trust pages and copy: `/methodology`, `/about`, `/terms`, privacy update, footer rows (disclaimer, trademark, disclosures), relationship disclosure on the promo, renamed labels, `metricDefinitions.ts`, "TCGplayer" spelling, weekly PDF copy | WP13, WP14, WP15, WP18 (units) | none | M, 10 to 14 |
| TS02 | Freshness system: `AsOf`, `DataStatusChip` (fallback to `max(price_recorded_at)`), `ProvenanceLine`, `MetricLabel`, `ReportLink`, product hero rewrite with lowest listing and CAD rate date, stale-row markers in tables | WP07, WP11, WP19 (table), TS01 | none | M, 8 to 12 |
| TS03 | Pipeline status: `scrape_runs`, `site_notices`, `get_pipeline_status`, `main.py` run logging, `/status`, notice banner, chip switches to `scrape_runs` | TS02, WP16, WP21 (grants) | 0040 | M, 8 to 10 |
| TS04 | Feedback: `/contact`, `/api/feedback`, signed `submit_feedback`, Brevo owner email, entry links in error and empty states, export update; `prod-smoke.yml` | WP02 (rate limit, Turnstile), WP13 (`NoResults`), WP15 (`userMessages`), WP17 (Sentry) | 0042 | M, 8 to 10 |
| TS05 | Taxonomy hubs: slugs, `/sets`, `/sets/[slug]`, `/sealed/[slug]`, `/eras/[slug]`, breadcrumbs, JSON-LD builders (WP13 corrections included), sitemap extension, footer Browse column, `/stats` row links | WP13, WP11, WP19, PX04 (server sparklines) | 0041 | L, 14 to 18 |
| TS06 | Dynamic OG images for products and sets, font assets, WebP spike, WP13 metadata adjustments | TS05 (set slugs), WP12 | none | S to M, 5 to 7 |
| TS07 | Newsletter: forms, confirm and unsubscribe routes, signed RPCs, `send_weekly_email.py` per-recipient HTML send with RFC 8058 headers, DNS owner actions | TS04 (HMAC helper), data-track `/weekly` (for the CTA link; can ship first with the PDF link) | 0043 | M, 10 to 12 |
| TS08 | Guides: shared guide layout with `Article` JSON-LD and author box, guides 1 to 5 with live data blocks | TS01, TS05 | none | M per 2 guides, content time is the owner's |
| TS09 | Brand kit: new mark and lockups, icon set to PX09a, OG template alignment, promo glyph swap, voice rules in `uiConventions.test.ts`, `/changelog` | TS01, PX09a | none | S to M, 4 to 6 plus design time |

Order: TS01 → TS02 → TS05 → TS06 → TS03 → TS04 → TS07 → TS09 → TS08. TS01 and TS02 are the highest trust gain per hour and have no migration. TS09 can run in parallel with anything once the mark is drawn.

Acceptance criteria common to all: zero em dashes in new copy; every new metric label resolves in `metricDefinitions.ts`; no withheld price appears in HTML, JSON-LD or an OG image (test with a stale fixture from WP00's stub); budgets hold; `noindex` pages absent from the sitemap.

---

## 17. Owner decisions and actions

**Decisions (needed before TS01):**
- **D1.** The true CardRinkTCG relationship (section 7.2 scenario A, B or C), and whether the operator or store holds inventory of tracked products.
- **D2.** Name or named pseudonym on `/about`, city and province.
- **D3.** Adopt the TCGplayer affiliate program or not (section 7.3).
- **D4.** Mailing address for CASL: home, PO box or virtual mailbox.
- **D5.** Accept renaming "Invest Score" and the box verdict labels.
- **D6.** Approve replacing the Poké Ball mark; choose a direction.

**Actions:**
- Set up forwarding for `hello@`, `privacy@`, `reports@`, `weekly@` (free).
- Create a Brevo HTTP API key for Vercel (`BREVO_API_KEY`) and the SPF, DKIM and DMARC records.
- Create the Vault secret `pokefin_form_hmac` and the matching Vercel variable (TS04, TS07).
- Verify Search Console and Bing Webmaster Tools; submit the sitemap after TS05.
- Have `/terms` and the newsletter consent copy reviewed once by a Canadian lawyer.
- Run the slug-collision query before applying 0041.
- Confirm the language coverage statement for `/methodology#coverage`.
- Re-check the **[verify]** items against primary sources: Google product snippet and `AggregateOffer` eligibility, Dataset Search requirements, TCGplayer's Market Price help article wording, Brevo free-tier limits, TCGplayer affiliate terms, Satori WebP support.

---

## 18. Sources

- TCGplayer, "TCGplayer Market Price" help article: https://help.tcgplayer.com/hc/en-us/articles/213588017-TCGplayer-Market-Price (blocked by the proxy; summarised from search results) and "What do the different price points on TCGplayer.com mean?": https://help.tcgplayer.com/hc/en-us/articles/222376867
- Competition Bureau Canada, Deceptive Marketing Practices Digest, vol. 4: https://competition-bureau.canada.ca/en/deceptive-marketing-practices-digest-volume-4 ; commentary: https://www.blg.com/en/insights/2025/07/trust-me-im-an-influencer-an-overview-of-influencer-marketing-in-canada , https://mcmillan.ca/insights/under-the-influence-the-canadian-competition-bureaus-stand-on-misleading-product-endorsements/
- FTC, Guides Concerning the Use of Endorsements and Testimonials in Advertising, 16 CFR Part 255 (2023 revision).
- Google Search Central, Product snippet structured data: https://developers.google.com/search/docs/appearance/structured-data/product-snippet (blocked; summarised from search results)
- CASL overview and CRTC consent requirements: https://gowlingwlg.com/en/insights-resources/guides/2023/doing-business-in-canada-casl , https://mailchimp.com/help/about-the-canada-anti-spam-law-casl/
- RFC 8058, Signaling One-Click Functionality for List Email Headers.
- TCGplayer affiliate program summaries: https://getlasso.co/affiliate/tcgplayer/ , https://aetherhub.com/Article/Updates-to-the-TCGPlayer-Affiliate-program
- Pokémon legal information and common fan-site notices: https://www.pokemon.com/us/legal/information , https://www.pokemon-zone.com/legal-notice/
- Next.js 16 docs shipped in the repo: `01-app/03-api-reference/03-file-conventions/01-metadata/opengraph-image.md`, `04-functions/image-response.md` (500 KB bundle limit, flexbox-only layout, ttf/otf/woff fonts, file-based metadata precedence).
