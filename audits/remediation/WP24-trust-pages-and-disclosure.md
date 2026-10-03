# WP24: Trust pages, metric definitions and disclosure

- **Goal**: a first-time visitor can see where every number comes from and how it is computed (a versioned `/methodology` whose figures come from the code's own constants), who runs Pokéfin and how CardRinkTCG.ca relates to it (`/about`, the footer and the promo say the same sentence), what the site does not promise (`/terms`, a one-line disclaimer), and can report a wrong price from the page it appears on (prefilled email links, no backend).
- **Why now / value**: the data integrity work (freshness gate 0023, withheld prices, WP16 plausibility checks, WP18 volatility units) is invisible today. Every Track 2 feature (index, screener presets, alerts, portfolio benchmark) adds numbers that need a published definition, and every one of them will import `metricDefinitions.ts`, `MetricLabel`, `ReportLink` and `app/content/disclosures.ts` from this package instead of inventing copy. The advice-sounding labels ("Invest Score", "Good Deal", "Overpriced") and the undisclosed store relationship are the two largest trust and compliance risks the research found.
- **Effort**: M, about 13 hours (constants and definitions modules 2.5 h, components and footer 2 h, methodology page 3 h, about, terms, contact and privacy 2.5 h, label renames and copy sweeps 1.5 h, tests and verification 1.5 h).
- **Depends on**: WP13 (`app/lib/site.ts`, `app/lib/redirects.ts`, `app/sitemap.ts`, `app/components/NoResults.tsx`, `app/product/[id]/productMeta.ts` with `serializeJsonLd`, `parseProductId`, `productPath`, `getProductDisplayName`), WP14 (`METRIC_DEFINITIONS` and the "What do these columns mean?" `<details>` in `app/stats/page.tsx`, the non-focusable `InfoIcon`), WP15 (`app/content/disclosures.ts` with `STORE_NAME`, `STORE_URL` and `PROMO_RELATIONSHIP_LABEL`, which this package extends; `CardRinkPromo` as an `<aside>` whose `aria-label={PROMO_RELATIONSHIP_LABEL}` WP15's conventions test pins; `app/__tests__/uiConventions.test.ts` with `SOURCES` and `violations`; restyled `error.tsx` and `global-error.tsx`), WP18 (`app/lib/marketMath.ts`, which already exports `DAYS_PER_YEAR`, `ANNUALISATION_FACTOR`, `PRODUCT_VOLATILITY_LOOKBACK_POINTS` and `RETURN_WINDOW_DAYS`; the "(daily)" and "(annualised)" volatility labels), WP10 (migration 0028: `get_market_product_metrics` with the return anchor-age tolerance this package documents), WP23 (`Stat`, `AsOf`, `PageHeader`, `ProvenanceLine`, `Button`/`buttonClasses`, token utilities, `test-utils/axe.ts`, the ratcheted conventions test). Through them: WP07 (`app/lib/format.ts`), WP11 (`getCachedMarketProductSummaries`, `getCachedExchangeRate`, cache tags), WP16 (price plausibility constants in `main.py`), WP17 (`app/components/BoxCalculator/nav.ts`, blocking lint), WP20 (async root layout), WP22 (`frontend/perf-budgets.json`, `pnpm perf:budget`, lazy Sentry in the error files).
- **Unblocks**: WP25 (extends `#currency` and `#returns`, bumps the methodology version), WP27 (footer rows, `/methodology#cadence` for the data clock chip), WP28 (`#box-nav`), WP29 (fills `#index`), WP31 (`MetricLabel` in `Stat` labels, `ReportLink` in the product hero), WP32 and WP33 (`MetricLabel`, `DecisionNote`), WP35 (alert email disclaimer and sender lines from `disclosures.ts`), WP36, WP37.
- **Placement**: after WP23, before WP25 and WP27. Owner decisions D1, D2 and D5 are needed before merge (see Owner actions). If D1 is still open at merge time, `STORE_RELATIONSHIP` stays `null`: the promo keeps WP15's "Partner store" label, the footer relationship sentence is omitted, `/about#disclosures` states only neutral facts, and the PR says so.
- **Suggested branch name**: `remediation/wp24-trust-pages-and-disclosure`
- **Risk level**: low to medium. No migration, API or data change; the risk is copy that a regulator or a reader could hold the site to (disclosure, terms, privacy), a footer that renders on every page, and label changes on `/stats`, the product page and the box calculator.

## Why

A collector-investor deciding whether to trust a number cannot learn today what TCGplayer Market Price is, which day a price describes, why a value shows `--`, how "Invest Score" is weighted, why product volatility is about 19 times set volatility, who runs the site, or whether the shop promoted on every page pays for it (`research/trust-seo-brand.md` §1 items 1 to 6, §2 evidence table). The research ranks this as the highest trust gain per hour because the site already does the hard part (freshness gate, plausibility holds, withheld prices) and only needs to publish it (`research/trust-seo-brand.md` §1 item 1, §16 TS01; `research/competitive-landscape.md` §4 pattern 8; `research/ui-audit.md` "First-time visitor comprehension" and top-10 item 7). The Competition Act and the FTC Endorsement Guides both expect a material connection to a promoted shop to be disclosed clearly and next to the promotion, which WP15's "Partner store" label does not do (`research/trust-seo-brand.md` §7). After this PR, every metric label on `/stats` and the product page links to a versioned methodology anchor whose numbers are imported from the code that computes them, advice-sounding labels are gone, the footer carries the disclaimer, trademark notices and the relationship sentence, and every error or empty state offers a prefilled report link.

## Design

### Decisions (binding)

- **Feedback is zero-backend.** `/contact` renders prefilled `mailto:` links per topic. No form, table, route handler or Turnstile. A stored feedback form is deferred (`01-PRODUCT-DIRECTION.md` §10).
- **Renames (owner decision D5).** "Invest Score" becomes "Composite score", displayed as a percentile of ranked sets ("Top 12%") with the raw z-blend in the `title` attribute. The box verdicts become "Below pack value", "Near pack value", "Above pack value", with the band thresholds printed next to the verdict. Internal names (`investScore`, `invest_score`, `signal: "buy" | "hold" | "avoid"`) do not change.
- **Disclosure copy follows owner decision D1** (`research/trust-seo-brand.md` §7.2 scenarios A, B, C), through one exported function so the promo, the footer and `/about` cannot disagree.
- **No new client JavaScript on the trust pages.** `/methodology`, `/about`, `/terms`, `/contact` and `/privacy` are server components. The footer becomes a server component wrapped in a 10-line client gate.
- **Numbers are never retyped.** Every window, threshold and weight on `/methodology` is interpolated from an exported constant: WP18's `marketMath.ts`, `marketPulse.ts`, the box calculator's `nav.ts`, one TypeScript mirror of the SQL (`app/lib/setAnalytics.ts`: the 0023 composite and momentum weights, the series windows and WP10's 0028 return anchor tolerances) and one mirror of WP16's Python plausibility constants (`app/lib/pipelineConstants.ts`). Tests parse the SQL and the Python to prove the mirrors match.
- **`app/content/disclosures.ts` stays import-free.** WP15 created it as a plain module with no imports so that client components can import it cheaply (the box calculator does, through `DecisionNote`). The one number it prints (14 days) is a local constant tied to `PRICE_STALENESS_TOLERANCE_DAYS` by a test, not an import of `marketPulse.ts`.
- **Methodology is versioned.** v1.0 with a change log. Any change to a formula, window, threshold or gate bumps `METHODOLOGY_VERSION` and adds a row.
- Light-only, WP23 tokens only (`text-ink`, `text-ink-soft`, `text-action`, `border-line`, `bg-surface`, `bg-surface-alt`, `rounded-card`, `rounded-control`, `text-h1` to `text-caption`, `text-prose`). No raw palette classes in any file this package creates.

### New modules

| File | Role |
|---|---|
| `app/content/disclosures.ts` (WP15's file, extended) | D1 and D2 values, `disclosureCopy()`, `PROMO_RELATIONSHIP_LABEL` (kept, now derived), revenue sentence, footer disclaimer, trademark notices, independence policy, decision note, provenance sentence, store name and URL. No imports |
| `app/content/contact.ts` | `CONTACT_EMAILS` (`hello@`, `reports@`, `privacy@pokefin.ca`), reply expectation |
| `app/content/methodology.ts` | `METHODOLOGY_VERSION`, effective date, sections and sub-sections (the anchors), change log, `LISTINGS_HISTORY_START` |
| `app/lib/metricDefinitions.ts` | `{ key, label, unitLabel, window, short, anchor }` for every metric label shown on `/stats` and the product page; `MetricKey`, `isMetricKey`, `metricHref` |
| `app/lib/setAnalytics.ts` | `COMPOSITE_SCORE_WEIGHTS`, `COMPOSITE_WEIGHT_LABELS`, `MOMENTUM_WEIGHTS`, `SET_METRIC_WINDOWS`, `SQL_RETURN_ANCHOR_TOLERANCE_DAYS` (SQL mirrors), `compositeTopPercent`, `formatCompositePercentile` |
| `app/lib/pipelineConstants.ts` | Mirrors of `main.py`: `PRICE_LARGE_DELTA_RATIO`, `PRICE_CONFIRM_TOLERANCE`, `PRICE_PENDING_MAX_AGE_HOURS`, `PRICE_ABSOLUTE_MAX_USD`, `PRICE_REPRICE_INTERVAL_HOURS`, `SCRAPE_RUN_INTERVAL_HOURS` |
| `app/lib/contactLink.ts` | Client-safe and tiny: topic ids, `buildContactHref()`. Loaded by error boundaries on every route, so nothing else goes in it |
| `app/lib/jsonLd.ts` | `serializeJsonLd` (moved from WP13's `productMeta.ts`, re-exported there), breadcrumb, organization, about-page and article builders |
| `app/contact/mail.ts` | Server only: topic copy, `parseContactParams()`, `buildMailto()` |
| `app/components/ui/MetricLabel.tsx` | Label plus a `?` link to `/methodology#anchor`, `title` = short definition |
| `app/components/ui/ReportLink.tsx` | Plain link to `/contact?topic=...&product=...&from=...` |
| `app/components/ui/DecisionNote.tsx` | "Screens describe past prices. They are not recommendations. How we calculate this" |
| `app/components/trust/DocPage.tsx` | Prose page shell and section for `/about`, `/terms`, `/privacy` |
| `app/components/FooterGate.tsx` | Client: hides the footer on `/auth/*` |
| `app/methodology/page.tsx`, `app/methodology/MethodologyArticle.tsx` | The page (data) and its pure body (tested) |
| `app/about/page.tsx`, `app/terms/page.tsx`, `app/contact/page.tsx` | New pages |

### `/methodology`

Server page, ISR (`revalidate = 86400`, plus WP11's scrape-triggered tags through the two cached reads). Static except the "Current values" box: products tracked, products priced in the last 14 days, newest price date, USD to CAD rate and its Bank of Canada date, and a count of products by type. `Article` and `BreadcrumbList` JSON-LD.

Anchors (h2, `research/trust-seo-brand.md` §4.2 items 1 to 16 and 18 to 21, plus the #index placeholder for WP29): `source`, `market-price`, `cadence`, `freshness`, `plausibility`, `currency`, `returns`, `cagr`, `volatility`, `drawdown`, `trend`, `volume`, `supply`, `market-pulse`, `composite-score`, `box-nav`, `index`, `coverage`, `limits`, `corrections`, `changes`. Sub-anchors (h3) so every `/stats` column has a target: `set-averages`, `consistency`, `momentum`, `price-per-day` (under `returns`) and `release-date` (under `coverage`).

Desktop, 1440 px:

```
+--------------------------------------------------------------------------------------------+
| Header (sticky, 64 px)                                                                     |
+--------------------------------------------------------------------------------------------+
|  Methodology                                                                     (h1 24px) |
|  Version 1.0, effective Oct 14, 2026. How every number on Pokéfin is sourced and calculated.|
|                                                                                            |
|  ON THIS PAGE (sticky)   | +-------------------------------------------------------------+ |
|  Where prices come from  | | Current values                                              | |
|  What Market Price is    | | Products tracked  Priced in last 14 days  Newest price  USD to CAD |
|  How often prices update | | 306               301                     Sep 29, 2026  1.3612     | |
|  When we hide a price    | |                                                  Bank of Canada, Sep 29 |
|  Checks on new prices    | | Booster Box 61 . Elite Trainer Box 58 . Booster Bundle 40 ...     | |
|  Canadian dollars        | +-------------------------------------------------------------+ |
|  Returns                 |                                                                 |
|  CAGR                    |  Where prices come from                              (h2 20px) |
|  Volatility              |  Prices are TCGplayer Market Price ... (prose 16/26, max 720)  |
|  ...                     |                                                                 |
|  Methodology changes     |  Composite score                                               |
|  (224 px column)         |  +-------------------------------+--------+                     |
|                          |  | 90D average return            |  0.40  |                     |
|                          |  | 30D average return            |  0.20  |  ... table          |
|                          |  +-------------------------------+--------+                     |
+--------------------------------------------------------------------------------------------+
| Footer                                                                                     |
+--------------------------------------------------------------------------------------------+
```

Phone, 390 px (16 px gutters, no horizontal scroll; tables are two or three short columns and fit):

```
+------------------------------------+
| Methodology                        |
| Version 1.0, effective Oct 14,     |
| 2026. How every number ...         |
| +--------------------------------+ |
| | Current values                 | |
| | Products tracked  Priced (14d) | |
| | 306               301          | |
| | Newest price      USD to CAD   | |
| | Sep 29, 2026      1.3612       | |
| |                   Bank of Can..| |
| +--------------------------------+ |
| +--------------------------------+ |
| | On this page                 v | |  <details>, closed by default, 44 px summary
| +--------------------------------+ |
| Where prices come from             |
| Prices are TCGplayer Market ...    |
| ...                                |
+------------------------------------+
```

States:
- Current values, newest price 2 or more days old (WP23 `STALE_AFTER_DAYS`): a visible WP23 `AsOf variant="inline"` line under the date, clock icon plus "Last priced Sep 25" in warn text, on both breakpoints. The `table` variant is not used here: its text is a tooltip, which never shows on touch. Fresh: no extra line (the value already is the date).
- FX read failed (`getCachedExchangeRate()` returned `date: null`): value `--`, sub-line "Rate unavailable".
- Summaries read failed: not caught, same as WP13's sitemap. The render fails, Next keeps serving the previous ISR version, and the next scrape revalidation retries.
- `#index`: placeholder text until WP29 ships the index.

### `/about`

Server page, ISR, `AboutPage` + `Organization` + `BreadcrumbList` JSON-LD. Sections (h2 with anchors): What Pokéfin is (`#what`), Who runs it (`#who`), How Pokéfin makes money (`#disclosures`), Independence policy (`#independence`), Data and methodology (`#data`), Contact (`#contact`). Single 720 px prose column on both breakpoints.

```
390 px                                   1440 px: same column, centred, max-w-3xl
+------------------------------------+
| About Pokéfin                      |
| What Pokéfin is                    |
| Pokéfin tracks daily TCGplayer     |
| Market Prices, returns and supply  |
| for 306 sealed Pokémon TCG ...     |
| Who runs it                        |
| Pokéfin is built and run by ...    |
| How Pokéfin makes money            |
| <revenue sentence, D1>             |
| <relationship sentence, D1>        |
| Independence policy                |
| . CardRinkTCG.ca never affects ... |
| . No product, set or shop can pay..|
| . Prices are never edited by hand..|
| . The operator may hold inventory..|
| Data and methodology               |
| Contact                            |
+------------------------------------+
```

### `/contact` (noindex)

Server page that reads `topic`, `product`, `from`, `q` and `digest` from the query string, validates each, and renders `mailto:` links with a prefilled subject and body. Topics: `wrong_price`, `wrong_info`, `missing_product`, `broken_feature` (to `reports@pokefin.ca`), `idea`, `other` (to `hello@pokefin.ca`). Privacy requests are pointed at `privacy@pokefin.ca`.

```
390 px, /contact?topic=wrong_price&product=42&from=/product/42
+------------------------------------+
| Contact                            |
| We read every message and usually  |
| reply within 3 days. Each option   |
| opens your email app with the      |
| details filled in.                 |
| +--------------------------------+ |
| | A price looks wrong            | |  rounded-card, border-action
| | Prismatic Evolutions Elite     | |
| | Trainer Box (id 42)            | |
| | [ Email reports@pokefin.ca  ]  | |  primary button, 44 px on touch
| | No email app? Write to         | |
| | reports@pokefin.ca with:       | |
| | Subject: [Pokéfin] Wrong price:| |
| |  Prismatic Evolutions Elite... | |
| | +----------------------------+ | |
| | | What looks wrong, and what | | |  <pre>-style block, wraps
| | | price did you expect?      | | |
| | | ---                        | | |
| | | Page: https://pokefin.ca/..| | |
| | +----------------------------+ | |
| +--------------------------------+ |
| Other topics                       |
| Wrong product details       >      |  each row a mailto link, 56 px
| A product is missing        >      |
| Something is broken         >      |
| An idea or request          >      |
| Something else              >      |
| Privacy requests:                  |
| privacy@pokefin.ca                 |
+------------------------------------+
```

With no valid `topic`, the card is omitted and the list heading reads "What is it about?". An unknown `product` id still prints "product 42"; an invalid id, an unsafe `from` or a malformed `digest` is dropped silently. Desktop is the same column at `max-w-2xl`.

### `/terms` and `/privacy`

Prose pages on `DocPage`. Terms: information only, no warranty, data may be wrong or late, not affiliated, acceptable use (no bulk scraping), accounts, your data, the store relationship (link to `/about#disclosures`), limitation of liability, changes, governing law (province from D2), contact. Privacy: rewritten with PIPEDA framing (GDPR rights kept for EU and UK visitors), Vercel Web Analytics and Speed Insights named, Brevo named for email, emails sent through `/contact`, `privacy@pokefin.ca` as the contact, the Office of the Privacy Commissioner of Canada as the complaint route.

### Footer (every page except `/auth/*`)

```
1440 px
+---------------------------------------------------------------------------------------------+
| EXPLORE          ACCOUNT        POKÉFIN          [glyph] Pokéfin                              |
| Dashboard        Sign In        Methodology      Sealed Pokémon TCG market data. TCGplayer    |
| Market View      Sign Up        About            Market Price, updated daily.                 |
| Set Analytics    Portfolio      Contact          Shop at CardRinkTCG.ca ->                    |
| Seller Tools                    Terms                                                         |
| Box Calculator                  Privacy                                                       |
|---------------------------------------------------------------------------------------------|
| Market data for information only, not financial advice. Past prices do not predict future   |
| prices. How we calculate prices                                                             |
| <D1 relationship sentence> Disclosures                     (omitted while D1 is open)       |
| Pokémon and Pokémon character names are trademarks of Nintendo, Creatures Inc. and GAME ... |
| TCGplayer is a trademark of TCGplayer, Inc. Pokéfin is not affiliated with TCGplayer.       |
| © 2026 Pokéfin                                                                              |
+---------------------------------------------------------------------------------------------+

390 px: two columns (Explore | Account, then Pokéfin | empty), the brand block full width,
then the legal lines stacked, 12 px caption text, 16 px gutters.
```

Every footer link has `prefetch={false}` (`01-PRODUCT-DIRECTION.md` §9 item 1).

### Label changes

`/stats` headers (both tables), 1440 px:

```
RANK (?)  SET              RELEASE (?)  PRODUCTS (?)  AVG 90D (?)  ...  COMPOSITE SCORE (?)
1         Prismatic Evol.  Jan 17, 2025  9            +38.21%            Top 2%      <- title="Composite z-score 1.87, rank 1 of 58"
...
58        Some Old Set     Mar 3, 2017   4            -12.40%            Bottom 2%
Screens describe past prices. They are not recommendations. How we calculate this
```

The `(?)` is a 24 px link box around a 16 px circled "?" (`MetricLabel`); its `title` is the short definition and its accessible name is "How {label} is calculated". The composite cell is neutral ink: it is a rank, not a gain or loss. The better half of ranked sets reads "Top N%", the rest "Bottom N%" (the last of 58 is "Bottom 2%", never "Top 100%").

Box calculator result, 390 px:

```
+------------------------------------+
| Near pack value      3.2% above NAV|  text-h2 ink, neutral surface (no green, amber, rose)
| Below: 10% or more under NAV. Near:|  caption, ink-soft
| less than 10% under, up to 5% over.|
| Above: more than 5% over.          |
| Screens describe past prices. They |
| are not recommendations. How we    |
| calculate this                     |
+------------------------------------+
```

Product page: every `MetricTile` label becomes a `MetricLabel`; the "Market Pulse" heading too. Under the hero price: "Price look wrong? Report it" (`ReportLink`). The withheld line reads "No current price. Last recorded Sep 12, 2026." (no em dash).

### Report links

| Where | Topic | Params |
|---|---|---|
| Product hero (current page, and exported for WP31) | `wrong_price` | `product`, `from` |
| WP13 `NoResults` | `missing_product` | `q` |
| `error.tsx` | `broken_feature` | `from` (pathname), `digest` |
| `global-error.tsx` | `broken_feature` | `digest` (plain `<a>`, inline styles) |
| `/methodology#coverage`, `#corrections` | `missing_product`, `wrong_price` | none |

`ReportLink` carries `rel="nofollow"` and `prefetch={false}`: `/contact` is `noindex`, so crawlers should not spend requests on it.

### Copy (all new user-facing strings)

- Disclaimer (footer): "Market data for information only, not financial advice. Past prices do not predict future prices."
- Decision note: "Screens describe past prices. They are not recommendations." plus link "How we calculate this".
- Provenance (under the `/stats` title, and exported for WP30 and WP32): "TCGplayer Market Price in USD, updated daily. Prices older than 14 days are hidden." plus link "Methodology".
- Trademarks: "Pokémon and Pokémon character names are trademarks of Nintendo, Creatures Inc. and GAME FREAK inc. Pokéfin is not affiliated with, endorsed or sponsored by Nintendo, The Pokémon Company, Creatures or GAME FREAK." and "TCGplayer is a trademark of TCGplayer, Inc. Pokéfin is not affiliated with TCGplayer."
- Relationship (D1): scenario A "owned": label "From the team behind Pokéfin", sentence "Pokéfin is run by the team behind CardRinkTCG.ca, a Canadian card shop. The shop never affects the prices, rankings, scores or screens shown here."; B "paid": label "Sponsored", sentence "CardRinkTCG.ca pays Pokéfin for this placement. The shop never affects ..."; C "unpaid": label "A shop we like", sentence "Pokéfin has a personal connection to CardRinkTCG.ca and is not paid for this link. The shop never affects ..."; open: label "Partner store", no sentence.
- Revenue (D1, `/about#disclosures`): A and C "Pokéfin is free. It runs no third-party ads, has no paid tier and sells no data."; B "Pokéfin is free. Its only income is the CardRinkTCG.ca placement described below: no other ads, no paid tier, no data sales."; open "Pokéfin is free. It has no paid tier and sells no data." (no "no ads" claim while the store relationship is undecided).
- Spelling: "TCGplayer" everywhere a user can read it. Banned in `app/**`: "TCGPlayer", "Invest Score", "live price", "real-time", "all-time high"; em dashes banned in `app/**/*.tsx`, whether written as the character, as `&mdash;`/`&#8212;`, or as the escape `\u2014` in a string (WP18's `compareColumns.tsx` uses the escape for its missing-value placeholder).

### Accessibility

- Focus styles everywhere in this package are `focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action` (WP23 rule): Tailwind 4's `outline-none` sets `outline-style: none`, which removes the only focus cue in Windows forced-colours mode. No `transition-colors` (colour changes are instant, `01-PRODUCT-DIRECTION.md` §3.5).
- `MetricLabel`: the link is a 24 px target (WCAG 2.5.8), has a visible focus ring, and an accessible name that says where it goes. WP14's `<details>` list on `/stats` stays as the touch and screen-reader source of the definitions.
- Every new page has one `h1`, sequential `h2`/`h3`, and `section` elements labelled by their headings. In-page anchors get `scroll-mt-20` so the sticky 64 px header does not cover the heading.
- The two "On this page" navs are never visible at the same time (one `lg:hidden`, one `hidden lg:block`), so assistive technology sees one.
- The box verdict no longer relies on colour; the label and the premium text carry it.
- `/contact` works with no JavaScript and no email client (the address and the prefilled text are printed).

### Performance

- The four new pages add zero route-specific client JavaScript: their `jsGzKb` in `pnpm perf:budget` equals `/privacy`'s within 0.3 kB.
- The footer moves from a client component to a server component: its code and copy leave the shared client bundle (shared JS goes down by roughly 1 kB gz). `FooterGate` is about 0.2 kB. The trade-off: the footer's rendered tree now travels in every page's inline RSC payload instead of a client reference, so every route's document grows by about 0.5 to 1 kB br (the HTML itself was already server-rendered before). That is less parse and execute work on every route for a small byte cost; Verification step 6 bounds it at 1.5 kB br per route.
- `lib/contactLink.ts` plus `ReportLink` add under 0.5 kB gz to the error-boundary chunk that ships on every route.
- `DecisionNote` in the box calculator (a client component) brings `content/disclosures.ts` into that route's bundle: under 1 kB gz, inside the `/box-calculator` limit. It stays that small only because `disclosures.ts` imports nothing (an import of `marketPulse.ts` would pull its whole module into the box calculator chunk).
- `/methodology` makes two cached reads that `/` already makes (summaries and FX) and `/about` one (summaries); `/contact` reads the cached summaries only when a `product` parameter is present. No new query.
- JSON-LD adds 1 to 2 kB of HTML on `/methodology` and `/about`.

## Before you start

All paths are relative to `frontend/` unless they start with `migrations/`, `audits/`, `main.py` or `README.md` (repo root).

Read in full:

- `audits/remediation/01-PRODUCT-DIRECTION.md` (§2, §3.7, §6.2, §9, §10) and `audits/remediation/research/trust-seo-brand.md` §4 to §9 and §14.4.
- `app/stats/page.tsx`, `app/product/[id]/page.tsx`, `app/components/BoxCalculator/BoxCalculator.tsx` (the verdict block, found by `navResult.signal`), `app/components/BoxCalculator/nav.ts`, `app/box-calculator/page.tsx`, `app/analytics/page.tsx`.
- `app/components/Footer.tsx`, `app/components/CardRinkPromo.tsx`, `app/layout.tsx`, `app/error.tsx`, `app/global-error.tsx`, `app/components/NoResults.tsx`, `app/privacy/page.tsx`, `app/sitemap.ts`, `app/__tests__/sitemap.test.ts`.
- `app/lib/marketMath.ts`, `app/lib/marketPulse.ts` (constants at the top and around `PRICE_STALENESS_TOLERANCE_DAYS`), `app/lib/serverMarketData.ts` (`fetchSetAnalyticsFallback`: the `momentumScore` and `investScore` expressions), `app/lib/site.ts`, `app/lib/redirects.ts`, `app/lib/validation.ts` (`stripControlChars`), `app/lib/format.ts`, `app/product/[id]/productMeta.ts`.
- `app/components/ui/Stat.tsx`, `AsOf.tsx`, `PageHeader.tsx`, `ProvenanceLine.tsx`, `Button.tsx`, `README.md`; `test-utils/axe.ts`; `app/__tests__/uiConventions.test.ts` and `app/__tests__/uiConventions.baseline.json`.
- `migrations/0023_price_freshness_guard.sql` (the `scored` CTE with the composite weights, `momentum_score`, the `current_date - 14` gates), `migrations/0028_bounded_market_metrics.sql` (WP10: the newest `CREATE OR REPLACE FUNCTION public.get_market_product_metrics`, its `anchors` CTE with the anchor-age lower bounds, and the window CTEs), `main.py` (WP16's price constants and `evaluate_scraped_price`, `price_update_interval_hours`, `seconds_until_next_utc_interval`).
- `app/content/disclosures.ts` (WP15: note the current value of `PROMO_RELATIONSHIP_LABEL` and whether `CardRinkPromo.tsx`'s store link `rel` contains `sponsored`; both carry an owner D1 answer if WP15 had one).
- `perf-budgets.json` and `scripts/perf-budget.mjs` (WP22).

Confirm that the dependencies landed. Run from `frontend/`; every command must print what its comment says, otherwise stop and report which package is missing:

```bash
# WP07 and WP11
grep -n "export function formatDateOnly\|export function recordedAtDateKey\|export function formatInteger" app/lib/format.ts   # 3 lines
grep -n "export async function getCachedExchangeRate\|export const getCachedMarketProductSummaries" app/lib/serverMarketData.ts   # 2 lines
# WP13
ls app/sitemap.ts app/robots.ts app/lib/site.ts app/lib/redirects.ts app/components/NoResults.tsx "app/product/[id]/productMeta.ts"
grep -n "export function serializeJsonLd\|export function parseProductId\|export function productPath\|export function getProductDisplayName" "app/product/[id]/productMeta.ts"   # 4 lines
grep -n "export function safeNextPath\|export const NO_INDEX\|export function absoluteUrl\|export function getSiteOrigin" app/lib/redirects.ts app/lib/site.ts   # 4 lines
# WP14
grep -n "METRIC_DEFINITIONS\|What do these columns mean" app/stats/page.tsx   # at least 2 lines
# WP15
grep -n '<aside' app/components/CardRinkPromo.tsx                              # 1 line
grep -n 'aria-label={PROMO_RELATIONSHIP_LABEL}' app/components/CardRinkPromo.tsx   # 1 line
grep -n "export const STORE_NAME\|export const STORE_URL\|export const PROMO_RELATIONSHIP_LABEL" app/content/disclosures.ts   # 3 lines
grep -n "const SOURCES\|function violations" app/__tests__/uiConventions.test.ts   # 2 lines
# WP17
grep -n "export function calculateNav" app/components/BoxCalculator/nav.ts     # 1 line
# WP18 (it already exports the constants this package prints; do not declare them again)
grep -n "export const RETURN_WINDOW_DAYS\|export const DAYS_PER_YEAR\|export const PRODUCT_VOLATILITY_LOOKBACK_POINTS\|export type VolatilityUnit" app/lib/marketMath.ts   # 4 lines
# WP10 (0028 bounds the return anchors; step 1d mirrors the tolerances)
grep -cE "recorded_at >= current_date - (14|37|104|194|379)$" ../migrations/0028_*.sql   # 5
grep -rn "Volatility 90D (daily)" app/stats/page.tsx | head -1                 # 1 line
grep -n "Volatility 30D (annualised)" "app/product/[id]/page.tsx"              # 1 line
# WP22
ls perf-budgets.json scripts/perf-budget.mjs
grep -n 'import("@sentry/nextjs")' app/error.tsx app/global-error.tsx          # 2 lines
# WP23
ls app/components/ui/Stat.tsx app/components/ui/AsOf.tsx app/components/ui/PageHeader.tsx app/components/ui/ProvenanceLine.tsx app/components/ui/Button.tsx test-utils/axe.ts app/__tests__/uiConventions.baseline.json
grep -n "RAW_PALETTE_RE\|BRAND_FILES" app/__tests__/uiConventions.test.ts | head -2   # 2 lines
# WP16 (through the plan order): the Python constants the methodology mirrors
grep -n "^PRICE_LARGE_DELTA_RATIO\|^PRICE_CONFIRM_TOLERANCE\|^PRICE_PENDING_MAX_AGE\|^PRICE_ABSOLUTE_MAX_USD" ../main.py   # 4 lines
```

If a WP16 constant is not in `main.py`, find it with `grep -rn "PRICE_LARGE_DELTA_RATIO" --include=*.py ..` (WP21 may have moved scraper code into `scraper_*.py`) and use that file in step 1e's test instead of `main.py`.

If the WP10 check prints 0 (the owner rolled back WP10's anchor-age rule, WP10 Rollback), the database returns have no maximum lookback age: in step 1d set `SQL_RETURN_ANCHOR_TOLERANCE_DAYS` to `null` (type `... | null`), in step 10a use the fallback returns paragraph given there (no third column, no `oldestLookback`), and drop the tolerance cases of tests 2, 3 and 4. Any other count: stop and report.

Record the starting state (paste into the PR):

```bash
grep -rn "TCGPlayer" app --include=*.ts --include=*.tsx | wc -l
grep -rln -e $'\xe2\x80\x94' -e '&mdash;' -e '&#8212;' -e '\\u2014' app --include=*.tsx | grep -v __tests__ | wc -l
grep -rniE "invest score|live price|real-time|all-time high" app --include=*.ts --include=*.tsx | grep -v __tests__
grep -rn "Good Deal\|Fair Price\|Overpriced" app --include=*.tsx
pnpm exec jest app/__tests__/uiConventions.test.ts   # passes
```

Build the perf baseline once (WP22) and keep the output:

```bash
SUPABASE_STUB_FIXTURE=perf pnpm build:stub
node scripts/perf-serve.mjs &            # note the PID
pnpm perf:budget | tee /tmp/wp24-budget-before.txt
kill <PID>
```

## Implementation steps

### Step 1. Export the constants the methodology prints

1a. `app/lib/marketMath.ts` (WP18) needs no edit: WP18 already exports `DAYS_PER_YEAR`, `ANNUALISATION_FACTOR`, `PRODUCT_VOLATILITY_LOOKBACK_POINTS` and `RETURN_WINDOW_DAYS` (Before you start checks it). Do not declare any of them again: a second `export const` is a TypeScript redeclaration error. WP18 deliberately left the two call-site literals for this step (WP19's preflight greps match them). Replace every literal 30 that feeds product volatility with the constant:

```bash
grep -rn "lookbackPoints: 30\|slice(-30)\|Math.max(30, 3)" app --include=*.ts --include=*.tsx | grep -v __tests__
```

Expected hits: `app/components/MarketView/buildRows.ts` and `app/product/[id]/page.tsx` (WP18 step 4c and 5b; WP19 may have rewritten the first as `volatilityPercent(prices.slice(-Math.max(30, 3)), ...)`). In each, write `PRODUCT_VOLATILITY_LOOKBACK_POINTS` in place of `30` and add it to the file's `marketMath` import. Tests keep their literals.

1b. `app/lib/marketPulse.ts`. Add `export` to these five declarations, changing nothing else on the lines: `PRICE_THRESHOLD_PCT`, `VOLUME_THRESHOLD_PCT`, `DAILY_DATA_STALENESS_TOLERANCE_DAYS`, `PRIOR_WINDOW_MIN_DAY_COVERAGE`, `LISTINGS_STALENESS_TOLERANCE_DAYS` (`PRICE_STALENESS_TOLERANCE_DAYS` is already exported). Then rewrite the four `PULSE_SIGNAL_META` descriptions, which are shown on the product page and contain em dashes:

```ts
  demand_surge: {
    label: "Demand surge",
    description: "Price and volume rising together: buyers are absorbing supply",
    tone: "gain",
  },
  thin_supply: {
    label: "Thin supply",
    description: "Price rising on falling volume: few boxes changing hands",
    tone: "warn",
  },
  distribution: {
    label: "Distribution",
    description: "Heavy selling into a falling price: supply hitting the market",
    tone: "loss",
  },
  cooling: {
    label: "Cooling off",
    description: "Price and volume both declining: interest fading",
    tone: "neutral",
  },
```

If a test asserts an old description (`grep -rn "buyout pressure\|few boxes changing hands" app --include=*.test.*`), update it to the new text.

1c. `app/components/BoxCalculator/nav.ts` (WP17). Add above `calculateNav`:

```ts
/**
 * Premium bands for the pack-value comparison, in percent of NAV.
 * premium <= belowMaxPercent: "Below pack value"; <= nearMaxPercent: "Near";
 * above: "Above". Printed on /methodology#box-nav and next to the verdict;
 * change only with a methodology version bump.
 */
export const PACK_VALUE_BANDS = { belowMaxPercent: -10, nearMaxPercent: 5 } as const;

/**
 * User-facing verdicts. The internal signal names stay "buy" | "hold" |
 * "avoid" (types.ts, saved state, tests); only these strings are shown.
 */
export const PACK_VALUE_LABELS: Readonly<Record<NavResult["signal"], string>> = {
  buy: "Below pack value",
  hold: "Near pack value",
  avoid: "Above pack value",
};

/** One line printed under the verdict. */
export function packValueBandsText(): string {
  const below = Math.abs(PACK_VALUE_BANDS.belowMaxPercent);
  const near = PACK_VALUE_BANDS.nearMaxPercent;
  return `Below: ${below}% or more under NAV. Near: less than ${below}% under, up to ${near}% over. Above: more than ${near}% over.`;
}
```

In `calculateNav`, replace the two literal comparisons:

```ts
  let signal: NavResult["signal"];
  if (premiumDiscountPercent <= PACK_VALUE_BANDS.belowMaxPercent) signal = "buy";
  else if (premiumDiscountPercent <= PACK_VALUE_BANDS.nearMaxPercent) signal = "hold";
  else signal = "avoid";
```

If `nav.ts` imports `NavResult` as a type only, keep it that way (`import type { NavResult, PackEntry } from "./types";`). WP17's `nav.test.ts` must pass unchanged.

1d. New `app/lib/setAnalytics.ts`:

```ts
/**
 * Set Analytics constants mirrored from SQL. The SQL is the source of truth:
 * get_set_analytics (migrations/0023_price_freshness_guard.sql, `scored` and
 * `set_stats`) and get_market_product_metrics (WP10's migration).
 * app/lib/__tests__/methodologyConstants.test.ts parses the newest migration
 * that defines each function and fails when a value here drifts.
 * /methodology and the serverMarketData fallback read these, never literals.
 */

/** Weight of each metric's z-score in the composite score (0023 `scored`). */
export const COMPOSITE_SCORE_WEIGHTS = {
  avg30: 0.2,
  avg90: 0.4,
  avg365: 0.2,
  consistency90: 0.15,
  consistency365: 0.1,
  trend90: 0.1,
  trend365: 0.05,
  volatility90: -0.2,
  max_drawdown365: -0.15,
} as const;

export type CompositeWeightKey = keyof typeof COMPOSITE_SCORE_WEIGHTS;

export const COMPOSITE_WEIGHT_LABELS: Readonly<Record<CompositeWeightKey, string>> = {
  avg30: "30D average return",
  avg90: "90D average return",
  avg365: "1Y average return",
  consistency90: "90D consistency",
  consistency365: "1Y consistency",
  trend90: "90D trend",
  trend365: "1Y trend",
  volatility90: "90D volatility (daily)",
  max_drawdown365: "1Y max drawdown",
};

/** Momentum: weighted mean of a set's average returns (0023 `set_stats`). */
export const MOMENTUM_WEIGHTS = { avg90: 0.5, avg30: 0.3, avg365: 0.2 } as const;

/** Calendar-day windows of the SQL series metrics behind Set Analytics. */
export const SET_METRIC_WINDOWS = {
  volatilityDays: 90,
  drawdownDays: 365,
  trendShortDays: 90,
  trendLongDays: 365,
} as const;

/**
 * How much older than its target date (today minus the window) a return's
 * lookback price may be in get_market_product_metrics (WP10's 0028 `anchors`
 * CTE: e.g. 7D accepts a price recorded on or after current_date - 14). An
 * older lookback price gives a NULL return, shown as "--". 1D has no bound.
 * The returns on the catalog, the Market table, the product page and Set
 * Analytics come from this function (only the serverMarketData fallback,
 * used while get_set_analytics fails, has no bound). Keys are
 * RETURN_WINDOW_DAYS labels.
 */
export const SQL_RETURN_ANCHOR_TOLERANCE_DAYS = {
  "7D": 7,
  "1M": 7,
  "3M": 14,
  "6M": 14,
  "1Y": 14,
} as const;

/**
 * Position of a composite rank as a percent of ranked sets, from the top:
 * ceil(rank / rankedCount x 100), at least 1. Null for an unranked set or
 * impossible input.
 */
export function compositeTopPercent(
  rank: number | null | undefined,
  rankedCount: number
): number | null {
  if (rank === null || rank === undefined) return null;
  if (!Number.isInteger(rank) || !Number.isInteger(rankedCount)) return null;
  if (rank < 1 || rankedCount < 1 || rank > rankedCount) return null;
  return Math.max(1, Math.ceil((rank / rankedCount) * 100));
}

/**
 * The composite cell text. The better half reads "Top N%"; the rest reads
 * "Bottom N%" with N = ceil((rankedCount - rank + 1) / rankedCount x 100),
 * so the last of 58 sets is "Bottom 2%", never "Top 100%". "--" when unranked.
 */
export function formatCompositePercentile(
  rank: number | null | undefined,
  rankedCount: number
): string {
  const top = compositeTopPercent(rank, rankedCount);
  if (top === null || rank === null || rank === undefined) return "--";
  // A lone ranked set has no "bottom": it stays "Top 100%".
  if (top <= 50 || rankedCount === 1) return `Top ${top}%`;
  const bottom = Math.max(1, Math.ceil(((rankedCount - rank + 1) / rankedCount) * 100));
  return `Bottom ${bottom}%`;
}
```

The tolerance values above are the ones 0028 ships; Before you start confirmed them (5 lines). Test 2 ties each one to the SQL text.

1e. New `app/lib/pipelineConstants.ts`:

```ts
/**
 * Mirrors of the Python collector's constants (main.py, WP16), so
 * /methodology can print them. The Python is the source of truth;
 * app/lib/__tests__/methodologyConstants.test.ts reads main.py and fails
 * when a value here drifts.
 */

/** A price that moved by this factor or more is held until the next run confirms it. */
export const PRICE_LARGE_DELTA_RATIO = 3;
/** The confirming observation must be within this fraction of the held one. */
export const PRICE_CONFIRM_TOLERANCE = 0.1;
/** A held observation older than this starts a new hold. */
export const PRICE_PENDING_MAX_AGE_HOURS = 48;
/** Prices at or above this (USD) are never written. */
export const PRICE_ABSOLUTE_MAX_USD = 500_000;
/** A product is re-priced once its last price is this many hours old. */
export const PRICE_REPRICE_INTERVAL_HOURS = 23;
/** The collector runs on this interval (UTC boundaries). */
export const SCRAPE_RUN_INTERVAL_HOURS = 4;
```

1f. `app/lib/serverMarketData.ts`, `fetchSetAnalyticsFallback`. Add `import { COMPOSITE_SCORE_WEIGHTS, MOMENTUM_WEIGHTS } from "./setAnalytics";` below the other `./` imports (keep `import "server-only";` first). Replace the numeric weights with the constants, keeping the operand order:

```ts
        momentumScore:
          avg90 !== null || avg30 !== null || avg365 !== null
            ? (avg90 ?? 0) * MOMENTUM_WEIGHTS.avg90 +
              (avg30 ?? 0) * MOMENTUM_WEIGHTS.avg30 +
              (avg365 ?? 0) * MOMENTUM_WEIGHTS.avg365
            : null,
```

and in the composite expression write every term as `+ computeZScore(...) * COMPOSITE_SCORE_WEIGHTS.<key>`; the volatility and drawdown terms change from `- ... * 0.2` and `- ... * 0.15` to `+ ... * COMPOSITE_SCORE_WEIGHTS.volatility90` and `+ ... * COMPOSITE_SCORE_WEIGHTS.max_drawdown365` (the constants are negative, so the value is identical). Keep the `momentumScore` condition exactly as the current code writes it (the snippet above shows the review-time shape; if the condition differs, keep yours and change only the three weights). Run `grep -n "\* 0\.[0-9]" app/lib/serverMarketData.ts`: expect no output (a hit that is not a composite or momentum weight stays; name it in the PR).

### Step 2. `app/content/disclosures.ts` (WP15's file, rewritten and extended)

WP15 created this file with `STORE_NAME`, `STORE_URL` and `PROMO_RELATIONSHIP_LABEL`, and its conventions test imports `PROMO_RELATIONSHIP_LABEL` and requires `CardRinkPromo.tsx` to contain `aria-label={PROMO_RELATIONSHIP_LABEL}`. Keep all three names exported. Before replacing the file, carry WP15's D1 answer over: map the current `PROMO_RELATIONSHIP_LABEL` value to `STORE_RELATIONSHIP` ("From the team behind Pokéfin" is `"owned"`, "Sponsored" is `"paid"`, "A shop we like" is `"unpaid"`, "Partner store" is `null`). If the label is "Sponsored" but `CardRinkPromo.tsx`'s `rel` lacks `sponsored`, or the reverse, stop and report the mismatch instead of guessing.

The file stays import-free (WP15's contract: client components import it, and an import here would pull that module into their bundles). Replace it with:

```ts
/**
 * Every sentence that says who runs Pokéfin, how it relates to
 * CardRinkTCG.ca, and what its numbers are not. The promo, the footer,
 * /about, /terms and later packages (emails, share cards) read these, so
 * the wording cannot drift (research/trust-seo-brand.md sections 6 to 9).
 *
 * Owner decisions: D1 sets STORE_RELATIONSHIP and OPERATOR_HOLDS_INVENTORY,
 * D2 sets OPERATOR. null means "not decided"; the copy then claims nothing.
 *
 * Plain module with no imports: client components (the box calculator,
 * through DecisionNote) import it, so it must stay tiny.
 */

/**
 * "owned": the operator owns or co-owns the store (scenario A).
 * "paid": the store pays for the placement or a commission (scenario B).
 * "unpaid": a personal connection, no payment (scenario C).
 */
export type StoreRelationship = "owned" | "paid" | "unpaid";

/** Owner decision D1, first half. Leave null until the owner answers. */
export const STORE_RELATIONSHIP: StoreRelationship | null = null;

/** Owner decision D1, second half. null prints "may hold inventory". */
export const OPERATOR_HOLDS_INVENTORY: boolean | null = null;

/** Owner decision D2: a name or named pseudonym, city and province. */
export const OPERATOR: Readonly<{
  name: string | null;
  city: string | null;
  province: string | null;
}> = { name: null, city: null, province: null };

export const STORE_NAME = "CardRinkTCG.ca";
export const STORE_URL = "https://cardrinktcg.ca";

export interface DisclosureCopy {
  /** Visible label and aria-label of the promo aside. */
  promoLabel: string;
  /** Footer, promo and /about#disclosures sentence. null while D1 is open. */
  relationshipSentence: string | null;
  /** First sentence of /about#disclosures: how Pokéfin is funded. */
  revenueSentence: string;
  /** rel for every link to the store. "sponsored" only when it is paid. */
  storeLinkRel: string;
  /** Appended to the footer store link text. */
  storeLinkSuffix: string;
}

const NEVER_AFFECTS =
  "The shop never affects the prices, rankings, scores or screens shown here.";

const FREE_NO_ADS = "Pokéfin is free. It runs no third-party ads, has no paid tier and sells no data.";

export function disclosureCopy(relationship: StoreRelationship | null): DisclosureCopy {
  switch (relationship) {
    case "owned":
      return {
        promoLabel: "From the team behind Pokéfin",
        relationshipSentence: `Pokéfin is run by the team behind ${STORE_NAME}, a Canadian card shop. ${NEVER_AFFECTS}`,
        revenueSentence: FREE_NO_ADS,
        storeLinkRel: "noopener noreferrer",
        storeLinkSuffix: "",
      };
    case "paid":
      return {
        promoLabel: "Sponsored",
        relationshipSentence: `${STORE_NAME} pays Pokéfin for this placement. ${NEVER_AFFECTS}`,
        revenueSentence: `Pokéfin is free. Its only income is the ${STORE_NAME} placement described below: no other ads, no paid tier, no data sales.`,
        storeLinkRel: "sponsored noopener noreferrer",
        storeLinkSuffix: " (sponsored)",
      };
    case "unpaid":
      return {
        promoLabel: "A shop we like",
        relationshipSentence: `Pokéfin has a personal connection to ${STORE_NAME} and is not paid for this link. ${NEVER_AFFECTS}`,
        revenueSentence: FREE_NO_ADS,
        storeLinkRel: "noopener noreferrer",
        storeLinkSuffix: "",
      };
    default:
      return {
        promoLabel: "Partner store",
        relationshipSentence: null,
        // No "no ads" claim while the store relationship is undecided.
        revenueSentence: "Pokéfin is free. It has no paid tier and sells no data.",
        storeLinkRel: "noopener noreferrer",
        storeLinkSuffix: "",
      };
  }
}

export const DISCLOSURE: DisclosureCopy = disclosureCopy(STORE_RELATIONSHIP);

/**
 * WP15's name for the promo label, kept: CardRinkPromo.tsx and WP15's
 * conventions test read it. Now derived from D1, never written by hand.
 */
export const PROMO_RELATIONSHIP_LABEL = DISCLOSURE.promoLabel;

export function inventorySentence(
  holds: boolean | null,
  relationship: StoreRelationship | null
): string {
  const store =
    relationship === "owned" ? ` ${STORE_NAME} sells many of the products tracked here.` : "";
  if (holds === true) return `The operator holds inventory of some products shown on this site.${store}`;
  if (holds === false) return `The operator does not hold inventory of the products tracked here.${store}`;
  return `The operator may hold inventory of products shown on this site.${store}`;
}

export const INDEPENDENCE_POLICY: readonly string[] = [
  `${STORE_NAME} never affects which products are tracked, or the rankings, scores, screens or movers shown here.`,
  "No product, set or shop can pay to be tracked, to rank higher, or to appear in a screen, a ranking or the movers.",
  "Prices are never edited by hand. A wrong price is fixed at the source, or the product is excluded until it is.",
  inventorySentence(OPERATOR_HOLDS_INVENTORY, STORE_RELATIONSHIP),
];

export const FOOTER_DISCLAIMER =
  "Market data for information only, not financial advice. Past prices do not predict future prices.";

export const DECISION_NOTE = "Screens describe past prices. They are not recommendations.";

export const POKEMON_TRADEMARK_NOTICE =
  "Pokémon and Pokémon character names are trademarks of Nintendo, Creatures Inc. and GAME FREAK inc. Pokéfin is not affiliated with, endorsed or sponsored by Nintendo, The Pokémon Company, Creatures or GAME FREAK.";

export const TCGPLAYER_TRADEMARK_NOTICE =
  "TCGplayer is a trademark of TCGplayer, Inc. Pokéfin is not affiliated with TCGplayer.";

/**
 * Days after which a price is withheld. Equals PRICE_STALENESS_TOLERANCE_DAYS
 * in lib/marketPulse.ts (migration 0023); a literal so this file stays
 * import-free. content/__tests__/disclosures.test.ts fails if they differ.
 */
export const PRICE_HIDDEN_AFTER_DAYS = 14;

/** The one line under a data page's title (WP23 ProvenanceLine children). */
export const PROVENANCE_SENTENCE = `TCGplayer Market Price in USD, updated daily. Prices older than ${PRICE_HIDDEN_AFTER_DAYS} days are hidden.`;
```

Keep `PROVENANCE_SENTENCE` as the last statement: WP35 appends its email constants below it.

When the owner answers D1 and D2 (Owner actions), set the three constants in this file and nowhere else.

### Step 3. Contact addresses and the client-safe link builder

3a. New `app/content/contact.ts`:

```ts
/** Forwarding addresses (owner action: set up free forwarding before merge). */
export const CONTACT_EMAILS = {
  hello: "hello@pokefin.ca",
  reports: "reports@pokefin.ca",
  privacy: "privacy@pokefin.ca",
} as const;

export type Mailbox = keyof typeof CONTACT_EMAILS;

export const REPLY_EXPECTATION = "We read every message and usually reply within 3 days.";
```

3b. New `app/lib/contactLink.ts`. It is imported by `error.tsx`, which ships on every route: keep it to this content.

```ts
/**
 * Links to /contact with the context prefilled. Client-safe and tiny on
 * purpose: error.tsx imports it on every route. The copy and the mailto
 * builder live server-side in app/contact/mail.ts.
 */
export const CONTACT_TOPICS = [
  "wrong_price",
  "wrong_info",
  "missing_product",
  "broken_feature",
  "idea",
  "other",
] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export function isContactTopic(value: unknown): value is ContactTopic {
  return typeof value === "string" && (CONTACT_TOPICS as readonly string[]).includes(value);
}

export interface ContactLinkParams {
  topic: ContactTopic;
  productId?: number | null;
  /** A same-origin path, e.g. "/product/42". Anything else is dropped. */
  from?: string | null;
  /** The search text of an empty result. */
  query?: string | null;
  /** error.digest from an error boundary. */
  digest?: string | null;
}

export const MAX_FROM_LENGTH = 200;
export const MAX_QUERY_LENGTH = 100;
export const DIGEST_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function buildContactHref({ topic, productId, from, query, digest }: ContactLinkParams): string {
  const params = new URLSearchParams({ topic });
  if (typeof productId === "number" && Number.isSafeInteger(productId) && productId > 0) {
    params.set("product", String(productId));
  }
  if (from && from.startsWith("/") && !from.startsWith("//") && from.length <= MAX_FROM_LENGTH) {
    params.set("from", from);
  }
  const q = query?.trim();
  if (q) params.set("q", q.slice(0, MAX_QUERY_LENGTH));
  if (digest && DIGEST_RE.test(digest)) params.set("digest", digest);
  return `/contact?${params.toString()}`;
}
```

### Step 4. `app/content/methodology.ts` (new)

Set `METHODOLOGY_EFFECTIVE_DATE` to the UTC date on which you open the PR (`date -u +%F`).

```ts
/**
 * Versioning rule: any change to a formula, window, threshold, weight or
 * gate documented on /methodology bumps METHODOLOGY_VERSION (1.0 -> 1.1 for
 * a clarification or a new metric, 2.0 for a changed formula), sets
 * METHODOLOGY_EFFECTIVE_DATE, and adds a row at the top of
 * METHODOLOGY_CHANGES. Typo fixes do not bump the version.
 */
export const METHODOLOGY_VERSION = "1.0";
export const METHODOLOGY_EFFECTIVE_DATE = "2026-10-14"; // replace with the PR date, YYYY-MM-DD
export const METHODOLOGY_FIRST_PUBLISHED = METHODOLOGY_EFFECTIVE_DATE;

/** First day of the daily listings snapshots (research/trust-seo-brand.md section 4.2 item 19). */
export const LISTINGS_HISTORY_START = "2026-07-07";

/** The h2 anchors, in page order. Titles are the headings. */
export const METHODOLOGY_SECTIONS = [
  { anchor: "source", title: "Where prices come from" },
  { anchor: "market-price", title: "What Market Price is" },
  { anchor: "cadence", title: "How often prices update" },
  { anchor: "freshness", title: "When we hide a price" },
  { anchor: "plausibility", title: "Checks on new prices" },
  { anchor: "currency", title: "Canadian dollars" },
  { anchor: "returns", title: "Returns" },
  { anchor: "cagr", title: "CAGR" },
  { anchor: "volatility", title: "Volatility" },
  { anchor: "drawdown", title: "Max drawdown" },
  { anchor: "trend", title: "Trend" },
  { anchor: "volume", title: "Units sold and volume trend" },
  { anchor: "supply", title: "Listings, units on market and days of supply" },
  { anchor: "market-pulse", title: "Market Pulse signals" },
  { anchor: "composite-score", title: "Composite score" },
  { anchor: "box-nav", title: "Box NAV and pack value" },
  { anchor: "index", title: "Pokéfin Sealed Index" },
  { anchor: "coverage", title: "What is tracked" },
  { anchor: "limits", title: "Known limits" },
  { anchor: "corrections", title: "Corrections" },
  { anchor: "changes", title: "Methodology changes" },
] as const;

/** h3 anchors inside a section, so every metric label has a precise target. */
export const METHODOLOGY_SUBSECTIONS = [
  { anchor: "set-averages", title: "Set averages and medians", parent: "returns" },
  { anchor: "consistency", title: "Consistency", parent: "returns" },
  { anchor: "momentum", title: "Momentum", parent: "returns" },
  { anchor: "price-per-day", title: "Price per day", parent: "returns" },
  { anchor: "release-date", title: "Release dates", parent: "coverage" },
] as const;

export type MethodologyAnchor = (typeof METHODOLOGY_SECTIONS)[number]["anchor"];
export type MethodologySubAnchor = (typeof METHODOLOGY_SUBSECTIONS)[number]["anchor"];
export type MethodologyTarget = MethodologyAnchor | MethodologySubAnchor;

export function methodologyTitle(anchor: MethodologyTarget): string {
  const found =
    METHODOLOGY_SECTIONS.find((s) => s.anchor === anchor) ??
    METHODOLOGY_SUBSECTIONS.find((s) => s.anchor === anchor);
  return found ? found.title : anchor;
}

export interface MethodologyChange {
  version: string;
  date: string;
  summary: string;
}

/** Newest first. */
export const METHODOLOGY_CHANGES: readonly MethodologyChange[] = [
  {
    version: METHODOLOGY_VERSION,
    date: METHODOLOGY_EFFECTIVE_DATE,
    summary: "First published version.",
  },
];
```

### Step 5. `app/lib/metricDefinitions.ts` (new)

It replaces `STAT_TOOLTIPS` and WP14's local `METRIC_DEFINITIONS` in `app/stats/page.tsx`, and carries WP18's unit labels. Every `short` is at most 120 characters (a test enforces it).

```ts
/**
 * One definition per metric label shown on the site: the label, its unit,
 * its window, a one-line definition (tooltip and /stats definition list) and
 * its /methodology anchor. MetricLabel renders from here, so a tooltip and
 * the methodology page cannot disagree. Add a metric here before showing it.
 */
import type { MethodologyTarget } from "../content/methodology";
import { DAYS_PER_YEAR, PRODUCT_VOLATILITY_LOOKBACK_POINTS, RETURN_WINDOW_DAYS } from "./marketMath";
import { MOMENTUM_WEIGHTS, SET_METRIC_WINDOWS } from "./setAnalytics";

export interface MetricDefinition {
  key: string;
  label: string;
  unitLabel: string;
  window: string | null;
  short: string;
  anchor: MethodologyTarget;
}

function def<K extends string>(d: MetricDefinition & { key: K }): MetricDefinition & { key: K } {
  return d;
}

function returnMetric<K extends string>(key: K, label: string, windowLabel: keyof typeof RETURN_WINDOW_DAYS) {
  const days = RETURN_WINDOW_DAYS[windowLabel];
  return def({
    key,
    label,
    unitLabel: "%",
    window: `${days} days`,
    short: `Percent change from the latest price on or before ${days} days ago to the latest price.`,
    anchor: "returns",
  });
}

function setAverage<K extends string>(key: K, label: string, days: number, kind: "Mean" | "Median") {
  return def({
    key,
    label,
    unitLabel: "%",
    window: `${days} days`,
    short: `${kind} ${days}-day return across the set's products that have a current price.`,
    anchor: "set-averages",
  });
}

const V = SET_METRIC_WINDOWS;

const DEFINITIONS = [
  // Product level (product page, and later WP31, WP33)
  def({ key: "marketPrice", label: "Market Price", unitLabel: "USD", window: "latest TCGplayer day", short: "TCGplayer's smoothed price from recent completed sales, in US dollars, for the day shown.", anchor: "market-price" }),
  def({ key: "releaseDate", label: "Release Date", unitLabel: "date", window: null, short: "The set's release date in the Pokéfin catalog.", anchor: "release-date" }),
  def({ key: "daysSinceRelease", label: "Days Since Release", unitLabel: "days", window: null, short: "Whole UTC days from the set's release date to today.", anchor: "release-date" }),
  def({ key: "pricePerDay", label: "Price / Day", unitLabel: "USD per day", window: null, short: "Current Market Price divided by days since release. Hidden when the price is withheld.", anchor: "price-per-day" }),
  returnMetric("return7d", "7D", "7D"),
  returnMetric("return1m", "1M", "1M"),
  returnMetric("return3m", "3M", "3M"),
  returnMetric("return6m", "6M", "6M"),
  returnMetric("return1y", "1Y", "1Y"),
  def({ key: "cagr", label: "CAGR", unitLabel: "% per year", window: "loaded history, up to 1 year", short: "Compound annual growth from the oldest to the newest price shown. Short spans are extrapolated to a year.", anchor: "cagr" }),
  def({ key: "maxDrawdown", label: "Max Drawdown", unitLabel: "%", window: "loaded history, up to 1 year", short: "Largest fall from a prior peak to a later low in the daily prices.", anchor: "drawdown" }),
  def({ key: "volatility30dAnnualised", label: "Volatility 30D (annualised)", unitLabel: "% annualised", window: `last ${PRODUCT_VOLATILITY_LOOKBACK_POINTS} recorded days`, short: `Std dev of daily % changes over the last ${PRODUCT_VOLATILITY_LOOKBACK_POINTS} recorded prices, times the square root of ${DAYS_PER_YEAR}.`, anchor: "volatility" }),
  def({ key: "unitsSold7d", label: "Units sold (7d)", unitLabel: "units", window: "7 days", short: "Units sold on TCGplayer in the last 7 days, from daily sales buckets.", anchor: "volume" }),
  def({ key: "unitsSold30d", label: "Units sold (30d)", unitLabel: "units", window: "30 days", short: "Units sold on TCGplayer in the last 30 days, from daily sales buckets.", anchor: "volume" }),
  def({ key: "volumeTrend", label: "Volume trend", unitLabel: "%", window: "30 days vs the 30 before", short: "Units sold in the last 30 days against the 30 days before, as a percent change.", anchor: "volume" }),
  def({ key: "activeListings", label: "Active listings", unitLabel: "listings", window: "latest snapshot", short: "Seller listings on TCGplayer in the latest daily listings snapshot.", anchor: "supply" }),
  def({ key: "unitsOnMarket", label: "Units on market", unitLabel: "units", window: "latest snapshot", short: "Total quantity offered across all listings in the latest snapshot.", anchor: "supply" }),
  def({ key: "daysOfSupply", label: "Days of supply", unitLabel: "days", window: "30-day sales rate", short: "Units on market divided by average daily units sold over the last 30 days.", anchor: "supply" }),
  def({ key: "marketPulse", label: "Market Pulse", unitLabel: "signal", window: "30 days", short: "A label for the 30-day price change and volume trend when both cross fixed thresholds.", anchor: "market-pulse" }),

  // Set level (/stats, served at /analytics)
  def({ key: "setRank", label: "Rank", unitLabel: "position", window: null, short: "Position by composite score among ranked sets. Sets with no current prices are unranked.", anchor: "composite-score" }),
  def({ key: "setRelease", label: "Release", unitLabel: "date", window: null, short: "The set's release date.", anchor: "release-date" }),
  def({ key: "setDaysSince", label: "Days Since", unitLabel: "days", window: null, short: "Whole UTC days since the set's release date.", anchor: "release-date" }),
  def({ key: "setProducts", label: "Products", unitLabel: "count", window: null, short: "Active tracked products in the set.", anchor: "coverage" }),
  setAverage("setAvg30", "Avg 30D", 30, "Mean"),
  setAverage("setAvg90", "Avg 90D", 90, "Mean"),
  setAverage("setAvg365", "Avg 1Y", 365, "Mean"),
  setAverage("setMedian30", "Med 30D", 30, "Median"),
  setAverage("setMedian90", "Med 90D", 90, "Median"),
  setAverage("setMedian365", "Med 1Y", 365, "Median"),
  def({ key: "setConsistency90", label: "Consistency 90D", unitLabel: "% of products", window: "90 days", short: "Share of the set's products with a positive 90-day return.", anchor: "consistency" }),
  def({ key: "setConsistency365", label: "Consistency 1Y", unitLabel: "% of products", window: "365 days", short: "Share of the set's products with a positive 1-year return.", anchor: "consistency" }),
  def({ key: "setVolatility90Daily", label: "Volatility 90D (daily)", unitLabel: "% daily", window: `last ${V.volatilityDays} days`, short: `Mean of each product's std dev of daily % changes over ${V.volatilityDays} days. Daily, not annualised.`, anchor: "volatility" }),
  def({ key: "setMaxDrawdown365", label: "Max Drawdown 1Y", unitLabel: "%", window: `${V.drawdownDays} days`, short: `Mean of each product's largest peak-to-low fall over the last ${V.drawdownDays} days.`, anchor: "drawdown" }),
  def({ key: "setTrend90", label: "Trend 90D", unitLabel: "% per day", window: `${V.trendShortDays} days`, short: `Least-squares slope of daily prices over ${V.trendShortDays} days, as a percent of the mean price, averaged.`, anchor: "trend" }),
  def({ key: "setTrend365", label: "Trend 1Y", unitLabel: "% per day", window: `${V.trendLongDays} days`, short: `Least-squares slope of daily prices over ${V.trendLongDays} days, as a percent of the mean price, averaged.`, anchor: "trend" }),
  def({ key: "setPricePerDay", label: "Price/Day", unitLabel: "USD per day", window: null, short: "Mean across the set's products of Market Price divided by days since release.", anchor: "price-per-day" }),
  def({ key: "setMomentum", label: "Momentum", unitLabel: "%", window: "30D, 90D, 1Y", short: `Weighted mean return: 90D x ${MOMENTUM_WEIGHTS.avg90}, 30D x ${MOMENTUM_WEIGHTS.avg30}, 1Y x ${MOMENTUM_WEIGHTS.avg365}.`, anchor: "momentum" }),
  def({ key: "compositeScore", label: "Composite score", unitLabel: "percentile of ranked sets", window: "30D to 1Y", short: "Top or Bottom N% of ranked sets on a weighted z-score blend of returns, consistency, trend and risk.", anchor: "composite-score" }),
] as const;

export type MetricKey = (typeof DEFINITIONS)[number]["key"];

export const ALL_METRIC_DEFINITIONS: readonly MetricDefinition[] = DEFINITIONS;

export const METRIC_DEFINITIONS = Object.fromEntries(
  DEFINITIONS.map((d) => [d.key, d])
) as unknown as Readonly<Record<MetricKey, MetricDefinition>>;

export function isMetricKey(value: string): value is MetricKey {
  return Object.prototype.hasOwnProperty.call(METRIC_DEFINITIONS, value);
}

export function metricHref(key: MetricKey): string {
  return `/methodology#${METRIC_DEFINITIONS[key].anchor}`;
}
```

If `tsc` rejects `as const` on an array of function-call results (it should not: `as const` is only needed for the tuple type), drop `as const` and keep `const DEFINITIONS = [...]`; `MetricKey` still resolves to the literal union because `def` is generic.

### Step 6. UI components (`app/components/ui/`, token-only, no `"use client"`)

6a. `MetricLabel.tsx`:

```tsx
import Link from "next/link";
import { METRIC_DEFINITIONS, metricHref, type MetricKey } from "../../lib/metricDefinitions";

export interface MetricLabelProps {
  metric: MetricKey;
  /**
   * true inside another link (a DataListRow is one link per row): renders
   * the label with the definition as a title and no nested link.
   */
  hideLink?: boolean;
  className?: string;
}

/** A metric label plus a "?" link to its /methodology definition (WP24). */
export default function MetricLabel({ metric, hideLink = false, className = "" }: MetricLabelProps) {
  const definition = METRIC_DEFINITIONS[metric];
  if (hideLink) {
    return (
      <span className={className} title={definition.short}>
        {definition.label}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      <span>{definition.label}</span>
      <Link
        href={metricHref(metric)}
        prefetch={false}
        title={definition.short}
        aria-label={`How ${definition.label} is calculated`}
        className="group inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line text-caption font-semibold normal-case leading-none text-ink-soft group-hover:border-action group-hover:text-action"
        >
          ?
        </span>
      </Link>
    </span>
  );
}
```

6b. `ReportLink.tsx`:

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { buildContactHref, type ContactLinkParams, type ContactTopic } from "../../lib/contactLink";

const DEFAULT_TEXT: Readonly<Record<ContactTopic, string>> = {
  wrong_price: "Price look wrong? Report it",
  wrong_info: "Report wrong details",
  missing_product: "Missing a product? Tell us",
  broken_feature: "Report this problem",
  idea: "Suggest an idea",
  other: "Contact us",
};

export interface ReportLinkProps extends ContactLinkParams {
  children?: ReactNode;
  className?: string;
}

/** A plain link to /contact with the context prefilled. Zero JS of its own. */
export default function ReportLink({ children, className = "", ...params }: ReportLinkProps) {
  return (
    <Link
      href={buildContactHref(params)}
      prefetch={false}
      rel="nofollow"
      className={`rounded-control text-small font-medium text-action underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center ${className}`}
    >
      {children ?? DEFAULT_TEXT[params.topic]}
    </Link>
  );
}
```

6c. `DecisionNote.tsx`:

```tsx
import Link from "next/link";
import type { MethodologyTarget } from "../../content/methodology";
import { DECISION_NOTE } from "../../content/disclosures";

export interface DecisionNoteProps {
  /** The methodology section that explains this screen or verdict. */
  anchor: MethodologyTarget;
  className?: string;
}

/**
 * The contextual disclaimer under a screen, a ranking or a verdict
 * (research/trust-seo-brand.md section 8, layer 2). One grey line, never a
 * banner or a modal.
 */
export default function DecisionNote({ anchor, className = "" }: DecisionNoteProps) {
  return (
    <p className={`text-caption text-ink-soft ${className}`}>
      {DECISION_NOTE}{" "}
      <Link
        href={`/methodology#${anchor}`}
        prefetch={false}
        className="font-medium text-action underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action"
      >
        How we calculate this
      </Link>
    </p>
  );
}
```

6d. `app/components/ui/README.md`: under "Components", add one line each:

```markdown
- `MetricLabel`: a metric label from `lib/metricDefinitions.ts` plus a "?" link to its `/methodology` anchor. Use it for every metric label (table headers, `Stat` labels, tiles). `hideLink` inside another link.
- `ReportLink`: link to `/contact` with topic, product, page and error digest prefilled (`lib/contactLink.ts`). Put one beside every headline price and in every error or empty state.
- `DecisionNote`: the one-line "Screens describe past prices" note under a ranking, screen or verdict, linked to its methodology section.
```

### Step 7. `app/lib/jsonLd.ts` (new) and WP13's `productMeta.ts`

7a. New `app/lib/jsonLd.ts`:

```ts
import { CONTACT_EMAILS } from "../content/contact";
import { OPERATOR } from "../content/disclosures";
import { absoluteUrl, SITE_NAME } from "./site";

export type JsonLd = Record<string, unknown>;

/**
 * JSON for a <script type="application/ld+json"> body. Escaping "<" stops a
 * value containing "</script>" from closing the tag. Moved from WP13's
 * productMeta.ts, which re-exports it.
 */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function buildBreadcrumbJsonLd(items: ReadonlyArray<{ name: string; path: string }>): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

function organizationNode(): JsonLd {
  const org: JsonLd = {
    "@type": "Organization",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    email: CONTACT_EMAILS.hello,
  };
  if (OPERATOR.city || OPERATOR.province) {
    org.address = {
      "@type": "PostalAddress",
      ...(OPERATOR.city ? { addressLocality: OPERATOR.city } : {}),
      ...(OPERATOR.province ? { addressRegion: OPERATOR.province } : {}),
      addressCountry: "CA",
    };
  }
  if (OPERATOR.name) org.founder = { "@type": "Person", name: OPERATOR.name };
  return org;
}

export function buildOrganizationJsonLd(): JsonLd {
  return { "@context": "https://schema.org", ...organizationNode() };
}

export function buildAboutPageJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: `About ${SITE_NAME}`,
    url: absoluteUrl("/about"),
    mainEntity: organizationNode(),
  };
}

export function buildArticleJsonLd({
  headline,
  description,
  path,
  datePublished,
  dateModified,
}: {
  headline: string;
  description: string;
  path: string;
  datePublished: string;
  dateModified: string;
}): JsonLd {
  const author: JsonLd = OPERATOR.name
    ? { "@type": "Person", name: OPERATOR.name, url: absoluteUrl("/about") }
    : { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/about") };
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    description,
    url: absoluteUrl(path),
    mainEntityOfPage: absoluteUrl(path),
    datePublished,
    dateModified,
    author,
    publisher: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
  };
}
```

Do not add a `logo` (the current mark is the Poké Ball WP27 replaces) and do not add an `alternateName` spelled without the accent (WP15's conventions test bans that spelling in source).

7b. `app/product/[id]/productMeta.ts`: delete the local `type JsonLd = Record<string, unknown>;` and the whole `serializeJsonLd` function. Add at the top:

```ts
import type { JsonLd } from "../../lib/jsonLd";
export { serializeJsonLd } from "../../lib/jsonLd";
```

WP13's `productMeta.test.ts` imports `serializeJsonLd` from `../productMeta` and must pass unchanged.

7c. Same file, `buildProductMetadata`: WP13 already writes "Daily TCGplayer Market Price, returns, volatility and price history for ..." and deliberately omits "Prices in USD and CAD." (the product page shows USD only until WP31). Change nothing. Check: `grep -rn "Live price\|live price" app --include=*.ts --include=*.tsx` prints nothing; if it prints the old product description (WP13 deviated), replace that string with WP13's wording above, not with a CAD claim.

### Step 8. Footer: server component with a client gate

8a. New `app/components/FooterGate.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * The only client part of the footer: the auth pages hide it. The footer's
 * content is server-rendered and passed in, so its copy never ships as JS.
 */
export default function FooterGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/auth/")) return null;
  return <>{children}</>;
}
```

8b. Replace `app/components/Footer.tsx`. Keep the `PokeballGlyph` function exactly as it is in the current file (WP27 replaces the mark; its hex count stays in the WP23 baseline). Keep the `EXPLORE_LINKS` and `ACCOUNT_LINKS` arrays as they are in the current file (WP13, WP20 or WP23 may have changed them).

```tsx
import Link from "next/link";
import FooterGate from "./FooterGate";
import {
  DISCLOSURE,
  FOOTER_DISCLAIMER,
  POKEMON_TRADEMARK_NOTICE,
  STORE_NAME,
  STORE_URL,
  TCGPLAYER_TRADEMARK_NOTICE,
} from "../content/disclosures";

// EXPLORE_LINKS and ACCOUNT_LINKS: keep the current arrays unchanged.

const TRUST_LINKS = [
  { href: "/methodology", label: "Methodology" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
];

// function PokeballGlyph(...) { ... }  keep verbatim

const LINK_CLASS =
  "text-sm text-ink-soft hover:text-action focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action rounded-control";

function LinkColumn({ title, links }: { title: string; links: ReadonlyArray<{ href: string; label: string }> }) {
  return (
    <div>
      <h2 className="mb-3 text-caption font-semibold uppercase tracking-[0.18em] text-ink-soft">{title}</h2>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} prefetch={false} className={LINK_CLASS}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The copyright year. A module function, so the component body makes no
 * clock call (react-hooks/purity, WP23 rule). Static and ISR pages bake it
 * at render; the daily backstop moves it on New Year's Day.
 */
function copyrightYear(): number {
  return new Date().getUTCFullYear();
}

export default function Footer() {
  const year = copyrightYear();
  return (
    <FooterGate>
      <footer className="mt-8 border-t border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            <LinkColumn title="Explore" links={EXPLORE_LINKS} />
            <LinkColumn title="Account" links={ACCOUNT_LINKS} />
            <LinkColumn title="Pokéfin" links={TRUST_LINKS} />
            <div className="col-span-2 md:col-span-1">
              <div className="mb-2 flex items-center gap-2">
                <PokeballGlyph className="h-5 w-5" />
                <span className="text-sm font-bold text-ink">
                  Pok<span className="text-accent">é</span>fin
                </span>
              </div>
              <p className="text-sm leading-relaxed text-ink-soft">
                Sealed Pokémon TCG market data. TCGplayer Market Price, updated daily.
              </p>
              <a
                href={STORE_URL}
                target="_blank"
                rel={DISCLOSURE.storeLinkRel}
                className="mt-2 inline-block text-sm font-semibold text-action hover:text-action-strong focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action rounded-control"
              >
                Shop at {STORE_NAME}
                {DISCLOSURE.storeLinkSuffix} →
              </a>
            </div>
          </div>

          <div className="mt-8 space-y-2 border-t border-line pt-5 text-caption text-ink-soft">
            <p>
              {FOOTER_DISCLAIMER}{" "}
              <Link href="/methodology" prefetch={false} className="font-medium text-action hover:underline">
                How we calculate prices
              </Link>
            </p>
            {DISCLOSURE.relationshipSentence && (
              <p>
                {DISCLOSURE.relationshipSentence}{" "}
                <Link href="/about#disclosures" prefetch={false} className="font-medium text-action hover:underline">
                  Disclosures
                </Link>
              </p>
            )}
            <p>{POKEMON_TRADEMARK_NOTICE}</p>
            <p>{TCGPLAYER_TRADEMARK_NOTICE}</p>
            <p>© {year} Pokéfin</p>
          </div>
        </div>
      </footer>
    </FooterGate>
  );
}
```

The store link is a plain `<a>` (external). `app/layout.tsx` keeps `<Footer />` where it is; nothing changes there (a server component rendered as a child of WP04's client `AuthProvider` is allowed: the layout, a server component, creates it). Column headings are `h2`, not `h3`: the page's `h1` is followed by `h2` sections, so the footer headings do not skip a level. WP11's check still holds: `grep -c "prefetch={false}" app/components/Footer.tsx` equals `grep -c "<Link" app/components/Footer.tsx` (3 each).

### Step 9. `app/components/CardRinkPromo.tsx`: the disclosure next to the promotion

WP15's version already imports `PROMO_RELATIONSHIP_LABEL`, `STORE_NAME` and `STORE_URL` from `../content/disclosures` and uses `aria-label={PROMO_RELATIONSHIP_LABEL}` plus `{PROMO_RELATIONSHIP_LABEL}` as the visible label. Keep both exactly (WP15's conventions test matches `aria-label=\{PROMO_RELATIONSHIP_LABEL\}`); the label now follows D1 because step 2 derives the constant from `DISCLOSURE`.

- Add `DISCLOSURE` to the existing `../content/disclosures` import.
- Directly after the `<p>` that says "Visit CardRinkTCG.ca for Pokémon sealed products, singles, and graded slabs.", add:

```tsx
            {DISCLOSURE.relationshipSentence && (
              <p className="max-w-xl text-small text-ink-soft">{DISCLOSURE.relationshipSentence}</p>
            )}
```

- The store `<Link>`: its `rel` (`"noopener noreferrer"`, or `"sponsored noopener noreferrer"` if WP15 had a "paid" answer) becomes `rel={DISCLOSURE.storeLinkRel}`.

Change nothing else (placement rules, categories, CTA styling are WP15's and WP27's). Check: `grep -c "PROMO_RELATIONSHIP_LABEL" app/components/CardRinkPromo.tsx` prints 3 (import, `aria-label`, visible label).

### Step 10. `/methodology`

10a. New `app/methodology/MethodologyArticle.tsx` (server-compatible, no data fetching, tested directly):

```tsx
import type { ReactNode } from "react";
import AsOf from "../components/ui/AsOf";
import PageHeader from "../components/ui/PageHeader";
import ProvenanceLine from "../components/ui/ProvenanceLine";
import ReportLink from "../components/ui/ReportLink";
import Stat from "../components/ui/Stat";
import { PACK_VALUE_BANDS, PACK_VALUE_LABELS } from "../components/BoxCalculator/nav";
import { TCGPLAYER_TRADEMARK_NOTICE } from "../content/disclosures";
import {
  LISTINGS_HISTORY_START,
  METHODOLOGY_CHANGES,
  METHODOLOGY_EFFECTIVE_DATE,
  METHODOLOGY_SECTIONS,
  METHODOLOGY_VERSION,
  methodologyTitle,
  type MethodologyAnchor,
  type MethodologySubAnchor,
} from "../content/methodology";
import { formatDateOnly, formatInteger } from "../lib/format";
import { DAYS_PER_YEAR, PRODUCT_VOLATILITY_LOOKBACK_POINTS, RETURN_WINDOW_DAYS } from "../lib/marketMath";
import {
  DAILY_DATA_STALENESS_TOLERANCE_DAYS,
  LISTINGS_STALENESS_TOLERANCE_DAYS,
  PRICE_STALENESS_TOLERANCE_DAYS,
  PRICE_THRESHOLD_PCT,
  PRIOR_WINDOW_MIN_DAY_COVERAGE,
  PULSE_SIGNAL_META,
  VOLUME_THRESHOLD_PCT,
  type PulseSignal,
} from "../lib/marketPulse";
import {
  PRICE_ABSOLUTE_MAX_USD,
  PRICE_CONFIRM_TOLERANCE,
  PRICE_LARGE_DELTA_RATIO,
  PRICE_PENDING_MAX_AGE_HOURS,
  PRICE_REPRICE_INTERVAL_HOURS,
  SCRAPE_RUN_INTERVAL_HOURS,
} from "../lib/pipelineConstants";
import {
  COMPOSITE_SCORE_WEIGHTS,
  COMPOSITE_WEIGHT_LABELS,
  MOMENTUM_WEIGHTS,
  SET_METRIC_WINDOWS,
  SQL_RETURN_ANCHOR_TOLERANCE_DAYS,
  type CompositeWeightKey,
} from "../lib/setAnalytics";

export interface MethodologyCurrentValues {
  productsTracked: number;
  pricedRecently: number;
  /** YYYY-MM-DD of the newest price_recorded_at, or null. */
  latestPriceDate: string | null;
  /** True when latestPriceDate is at least WP23's STALE_AFTER_DAYS old (computed by the page). */
  latestPriceStale: boolean;
  fxRate: number | null;
  /** YYYY-MM-DD of the Bank of Canada rate, or null when the read failed. */
  fxDate: string | null;
  byType: ReadonlyArray<{ label: string; count: number }>;
}

const LINK =
  "font-medium text-action underline underline-offset-2 hover:text-action-strong focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action";
const TH = "border-b border-line py-2 pr-4 text-left text-small font-semibold text-ink-soft";
const TD = "border-b border-line py-2 pr-4 align-top text-body tabular-nums";

const weight = (w: number) => w.toFixed(2);
const pct = (n: number) => `${n}%`;

function Section({ id, children }: { id: MethodologyAnchor; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20">
      <h2 id={`${id}-h`} className="text-h2 font-semibold text-ink">
        {methodologyTitle(id)}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Sub({ id, children }: { id: MethodologySubAnchor; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-20">
      <h3 className="text-h3 font-semibold text-ink">{methodologyTitle(id)}</h3>
      <div className="mt-1 space-y-2">{children}</div>
    </div>
  );
}

function Toc() {
  return (
    <ol className="space-y-1 text-small">
      {METHODOLOGY_SECTIONS.map((s) => (
        <li key={s.anchor}>
          <a
            href={`#${s.anchor}`}
            className="block rounded-control py-1 text-ink-soft hover:text-action focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action pointer-coarse:min-h-11"
          >
            {s.title}
          </a>
        </li>
      ))}
    </ol>
  );
}

const PULSE_RULES: ReadonlyArray<{ signal: PulseSignal; price: "up" | "down"; volume: "up" | "down" }> = [
  { signal: "demand_surge", price: "up", volume: "up" },
  { signal: "thin_supply", price: "up", volume: "down" },
  { signal: "distribution", price: "down", volume: "up" },
  { signal: "cooling", price: "down", volume: "down" },
];

const rule = (direction: "up" | "down", threshold: number) =>
  direction === "up" ? `+${threshold}% or more` : `-${threshold}% or less`;

/** Third column of the returns table (WP10's 0028 anchor bounds). */
function oldestLookback(label: string, days: number): string {
  const tolerance = (SQL_RETURN_ANCHOR_TOLERANCE_DAYS as Readonly<Record<string, number | undefined>>)[label];
  return tolerance === undefined ? "Newest price before today, any age" : `${days + tolerance} days ago`;
}

export default function MethodologyArticle({ current }: { current: MethodologyCurrentValues }) {
  const below = Math.abs(PACK_VALUE_BANDS.belowMaxPercent);
  const near = PACK_VALUE_BANDS.nearMaxPercent;
  const annualisation = Math.sqrt(DAYS_PER_YEAR).toFixed(1);
  const weightKeys = Object.keys(COMPOSITE_SCORE_WEIGHTS) as CompositeWeightKey[];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:py-12">
      <PageHeader
        title="Methodology"
        provenance={
          <ProvenanceLine>
            Version {METHODOLOGY_VERSION}, effective {formatDateOnly(METHODOLOGY_EFFECTIVE_DATE)}. How every
            number on Pokéfin is sourced and calculated.
          </ProvenanceLine>
        }
      />

      <div className="mt-6 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12">
        <nav aria-label="On this page" className="hidden lg:block">
          <div className="sticky top-20">
            <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-ink-soft">On this page</p>
            <Toc />
          </div>
        </nav>

        <article className="min-w-0 max-w-3xl space-y-10 text-prose text-ink">
          <section aria-labelledby="current-values-h" className="rounded-card border border-line bg-surface p-4">
            <h2 id="current-values-h" className="text-h3 font-semibold text-ink">
              Current values
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Products tracked" value={formatInteger(current.productsTracked)} />
              <Stat
                label={`Priced in the last ${PRICE_STALENESS_TOLERANCE_DAYS} days`}
                value={formatInteger(current.pricedRecently)}
              />
              <Stat
                label="Newest price"
                value={formatDateOnly(current.latestPriceDate, "--")}
                asOf={
                  current.latestPriceStale && current.latestPriceDate ? (
                    <AsOf date={current.latestPriceDate} variant="inline" />
                  ) : undefined
                }
              />
              <Stat
                label="USD to CAD"
                value={current.fxRate === null || current.fxDate === null ? "--" : current.fxRate.toFixed(4)}
                sub={current.fxDate ? `Bank of Canada, ${formatDateOnly(current.fxDate)}` : "Rate unavailable"}
              />
            </div>
            {current.byType.length > 0 && (
              <p className="mt-3 text-small text-ink-soft">
                {current.byType.map((t) => `${t.label} ${formatInteger(t.count)}`).join(" · ")}
              </p>
            )}
            <p className="mt-2 text-caption text-ink-soft">Refreshed after each collection run.</p>
          </section>

          <details className="rounded-card border border-line bg-surface p-4 lg:hidden">
            <summary className="cursor-pointer text-small font-semibold text-ink pointer-coarse:min-h-11">
              On this page
            </summary>
            <nav aria-label="On this page" className="mt-3">
              <Toc />
            </nav>
          </details>

          <Section id="source">
            <p>
              Prices are TCGplayer Market Price for sealed Pokémon TCG products, in US dollars, collected from
              TCGplayer&apos;s public product data. {TCGPLAYER_TRADEMARK_NOTICE}
            </p>
          </Section>

          <Section id="market-price">
            <p>
              TCGplayer calculates Market Price from recent completed sales on its US marketplace. It is a smoothed
              figure of what buyers recently paid. It is not the lowest price you can buy at today, and it is not
              what a seller receives: sellers pay TCGplayer fees and shipping, and a buyer in Canada also pays
              shipping, duties and taxes.
            </p>
            <table className="w-full border-collapse">
              <thead>
                <tr><th className={TH}>Figure</th><th className={TH}>Meaning</th></tr>
              </thead>
              <tbody>
                <tr><td className={TD}>Market Price</td><td className={TD}>Smoothed recent sale price on TCGplayer, in USD.</td></tr>
                <tr><td className={TD}>Lowest listing</td><td className={TD}>The cheapest active listing in the latest daily snapshot.</td></tr>
                <tr><td className={TD}>CAD figure</td><td className={TD}>Market Price converted to Canadian dollars (see <a className={LINK} href="#currency">Canadian dollars</a>).</td></tr>
              </tbody>
            </table>
          </Section>

          <Section id="cadence">
            <p>
              The collector runs every {SCRAPE_RUN_INTERVAL_HOURS} hours and re-prices a product once its last
              price is {PRICE_REPRICE_INTERVAL_HOURS} hours old, so each product gets about one new price a day.
              Each price is stored with the TCGplayer day it describes. Changes on Pokéfin are day over day.
            </p>
          </Section>

          <Section id="freshness">
            <p>
              If a product has no price recorded in the last {PRICE_STALENESS_TOLERANCE_DAYS} days, Pokéfin shows{" "}
              <code>--</code> instead of the last price and hides every value derived from it: returns, CAGR,
              price per day, portfolio values and box NAV. Volatility, drawdown and trend describe the recorded
              history and stay visible.
            </p>
            <p>
              Sales figures are hidden when the newest daily sales bucket is more than{" "}
              {DAILY_DATA_STALENESS_TOLERANCE_DAYS} days old, and supply figures when the newest listings snapshot
              is more than {LISTINGS_STALENESS_TOLERANCE_DAYS} days old. <code>--</code> never means zero.
            </p>
          </Section>

          <Section id="plausibility">
            <p>
              Every new price is checked before it is stored. A value that is not a positive number, or that is $
              {formatInteger(PRICE_ABSOLUTE_MAX_USD)} USD or more, is rejected. A price at least{" "}
              {PRICE_LARGE_DELTA_RATIO} times the stored price, or at most 1/{PRICE_LARGE_DELTA_RATIO} of it, is
              held, and published only if a later run within {PRICE_PENDING_MAX_AGE_HOURS} hours sees it again
              within {pct(Math.round(PRICE_CONFIRM_TOLERANCE * 100))}. A held price is never shown, and a real jump
              is published one run later, so a wrong stored price can always be corrected this way.
            </p>
          </Section>

          <Section id="currency">
            <p>
              CAD figures are the USD Market Price converted at the latest Bank of Canada daily USD to CAD rate
              Pokéfin has stored
              {current.fxRate !== null && current.fxDate !== null
                ? ` (${current.fxRate.toFixed(4)} on ${formatDateOnly(current.fxDate)})`
                : ""}
              . The same rate is applied to history and portfolio figures, so a CAD chart shows USD price moves,
              not currency moves. A CAD figure is a converted US marketplace price, not a Canadian market price.
            </p>
          </Section>

          <Section id="returns">
            <p>
              A return is the percent change from the latest daily price on or before the lookback date to the
              latest price.
            </p>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH}>Label</th>
                  <th className={TH}>Lookback</th>
                  <th className={TH}>Oldest lookback price used</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(RETURN_WINDOW_DAYS).map(([label, days]) => (
                  <tr key={label} data-window={label}>
                    <td className={TD}>{label}</td>
                    <td className={TD}>{days} {days === 1 ? "day" : "days"}</td>
                    <td className={TD}>{oldestLookback(label, days)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Returns are computed in the database, which uses the lookback price only if it is no older than the
              last column; otherwise the return shows <code>--</code> rather than a return measured over a longer
              span than its label. The catalog cards and the Market table fill a missing return from the price
              history they have already loaded, and that fallback has no age limit, so there a product with a gap
              in its history can still show one. Returns are withheld with the price.
            </p>
            <Sub id="set-averages">
              <p>
                Set Analytics takes the mean and the median of each return across a set&apos;s active products
                that have a current price.
              </p>
            </Sub>
            <Sub id="consistency">
              <p>The share of a set&apos;s products with a positive return over the window, from 0% to 100%.</p>
            </Sub>
            <Sub id="momentum">
              <p>
                A weighted mean of a set&apos;s average returns: 90D × {MOMENTUM_WEIGHTS.avg90}, 30D ×{" "}
                {MOMENTUM_WEIGHTS.avg30}, 1Y × {MOMENTUM_WEIGHTS.avg365}. A missing return counts as 0; a set with
                none of the three has no momentum.
              </p>
            </Sub>
            <Sub id="price-per-day">
              <p>
                The current Market Price divided by the whole days since the set&apos;s release (at least 1). A
                set&apos;s figure is the mean across its products. It is withheld with the price.
              </p>
            </Sub>
          </Section>

          <Section id="cagr">
            <p>
              CAGR = (latest price ÷ oldest price) ^ (1 ÷ years) - 1, where years is the time between the two
              prices divided by {DAYS_PER_YEAR} days. Product pages use the oldest price in the last year of
              recorded history. Over a short span CAGR stretches a few weeks of movement to a full year, so read
              it with the length of the chart. It is withheld with the price.
            </p>
          </Section>

          <Section id="volatility">
            <p>
              Volatility is the population standard deviation of day-over-day percent changes in the daily Market
              Price.
            </p>
            <table className="w-full border-collapse">
              <thead>
                <tr><th className={TH}>Where</th><th className={TH}>Window</th><th className={TH}>Unit</th></tr>
              </thead>
              <tbody>
                <tr data-vol="product">
                  <td className={TD}>Product pages and the Market table</td>
                  <td className={TD}>Newest {PRODUCT_VOLATILITY_LOOKBACK_POINTS} recorded daily prices</td>
                  <td className={TD}>Annualised: daily × √{DAYS_PER_YEAR}</td>
                </tr>
                <tr data-vol="set">
                  <td className={TD}>Set Analytics</td>
                  <td className={TD}>Last {SET_METRIC_WINDOWS.volatilityDays} calendar days, mean across the set</td>
                  <td className={TD}>Daily, not annualised</td>
                </tr>
              </tbody>
            </table>
            <p>
              Annualised volatility is about {annualisation} times the daily figure, so the two are not comparable.
              Gaps in the history and the smoothing inside Market Price both make measured volatility lower than
              the true day-to-day variation.
            </p>
          </Section>

          <Section id="drawdown">
            <p>
              Max drawdown is the largest fall from a prior peak to a later low in the daily prices, as a percent
              of that peak. Product pages measure it over the last year of recorded history; Set Analytics
              averages each product&apos;s drawdown over the last {SET_METRIC_WINDOWS.drawdownDays} days. It stays
              visible when a price is withheld because it describes recorded history.
            </p>
          </Section>

          <Section id="trend">
            <p>
              Trend is the slope of a least-squares line through the daily prices, divided by the mean price and
              expressed in percent per recorded day (a day with no price is skipped, not counted). Set Analytics
              reports it over {SET_METRIC_WINDOWS.trendShortDays} and{" "}
              {SET_METRIC_WINDOWS.trendLongDays} days, averaged across a set&apos;s products.
            </p>
          </Section>

          <Section id="volume">
            <p>
              Units sold come from TCGplayer&apos;s daily sales buckets. Units sold (7d) and (30d) sum the daily
              buckets in the window. Each window ends on the last complete day: the day before the newest daily
              bucket, which is still filling, and never later than yesterday. Volume trend compares the last 30 days with the 30 days before, as a percent
              change; the earlier window uses weekly buckets when fewer than {PRIOR_WINDOW_MIN_DAY_COVERAGE} of its
              days have daily data. Sales figures are hidden when daily data stopped more than{" "}
              {DAILY_DATA_STALENESS_TOLERANCE_DAYS} days ago.
            </p>
          </Section>

          <Section id="supply">
            <p>
              Active listings and units on market come from a daily snapshot of TCGplayer listings, collected
              since {formatDateOnly(LISTINGS_HISTORY_START)}. Days of supply = units on market ÷ (units sold in 30
              days ÷ 30). It is hidden when nothing sold in 30 days or the snapshot is more than{" "}
              {LISTINGS_STALENESS_TOLERANCE_DAYS} days old.
            </p>
          </Section>

          <Section id="market-pulse">
            <table className="w-full border-collapse">
              <thead>
                <tr><th className={TH}>Signal</th><th className={TH}>Price change, 30D</th><th className={TH}>Volume trend</th></tr>
              </thead>
              <tbody>
                {PULSE_RULES.map((r) => (
                  <tr key={r.signal} data-signal={r.signal}>
                    <td className={TD}>{PULSE_SIGNAL_META[r.signal].label}</td>
                    <td className={TD}>{rule(r.price, PRICE_THRESHOLD_PCT)}</td>
                    <td className={TD}>{rule(r.volume, VOLUME_THRESHOLD_PCT)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              &quot;Stable&quot; means both inputs exist and no row matches. &quot;No signal&quot; means an input
              is missing. Signals describe the last 30 days; they are not forecasts.
            </p>
          </Section>

          <Section id="composite-score">
            <p>
              Each set gets a z-score on each metric below, against all tracked sets: (set value - mean) ÷
              standard deviation. The composite is the weighted sum. A metric with no spread, or missing for a
              set, adds 0. A set with no current price behind any of its returns is unranked. Rank orders the
              ranked sets by composite, ties broken by set name.
            </p>
            <table className="w-full border-collapse">
              <thead>
                <tr><th className={TH}>Metric</th><th className={TH}>Weight</th></tr>
              </thead>
              <tbody>
                {weightKeys.map((key) => (
                  <tr key={key} data-weight-key={key}>
                    <td className={TD}>{COMPOSITE_WEIGHT_LABELS[key]}</td>
                    <td className={TD}>{weight(COMPOSITE_SCORE_WEIGHTS[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Pokéfin shows the composite as the set&apos;s position among ranked sets. In the better half it reads
              Top N%, with N = rank ÷ ranked sets × 100, rounded up, at least 1: &quot;Top 12%&quot; means the set
              ranks in the best 12%. In the rest it reads Bottom N%, with N = (ranked sets - rank + 1) ÷ ranked
              sets × 100, rounded up: the last set is in the bottom few percent, never &quot;Top 100%&quot;. The raw
              weighted sum is in the cell&apos;s tooltip. The score describes past prices; it is not a
              recommendation.
            </p>
          </Section>

          <Section id="box-nav">
            <p>
              Box NAV (net asset value) is the sum of the Market Prices of the packs in a box, plus the value you
              give any promo cards. Each pack is priced at its set&apos;s standard booster pack (the cheapest
              variant only when the set has no standard pack). Premium = (box price - NAV) ÷ NAV. The calculator
              says where a box price sits:
            </p>
            <table className="w-full border-collapse">
              <thead>
                <tr><th className={TH}>Label</th><th className={TH}>Premium to NAV</th></tr>
              </thead>
              <tbody>
                <tr data-band="buy"><td className={TD}>{PACK_VALUE_LABELS.buy}</td><td className={TD}>-{below}% or lower</td></tr>
                <tr data-band="hold"><td className={TD}>{PACK_VALUE_LABELS.hold}</td><td className={TD}>above -{below}%, up to +{near}%</td></tr>
                <tr data-band="avoid"><td className={TD}>{PACK_VALUE_LABELS.avoid}</td><td className={TD}>above +{near}%</td></tr>
              </tbody>
            </table>
            <p>
              A pack with no current price makes NAV unavailable rather than counting as $0. NAV ignores singles,
              pull rates and the value of opening.
            </p>
          </Section>

          <Section id="index">
            <p>
              The Pokéfin Sealed Index is not published yet. When it is, its constituents, weighting and rules will
              be documented here and this page&apos;s version will change.
            </p>
          </Section>

          <Section id="coverage">
            <p>
              Pokéfin tracks {formatInteger(current.productsTracked)} active sealed products listed on
              TCGplayer&apos;s US marketplace: booster boxes, Elite Trainer Boxes, bundles, collections and other
              sealed product. Singles, graded cards and accessories are not tracked.
            </p>
            <p>
              <ReportLink topic="missing_product" />
            </p>
            <Sub id="release-date">
              <p>
                Release dates come from the Pokéfin catalog. Days since release counts whole UTC days from the
                release date to today.
              </p>
            </Sub>
          </Section>

          <Section id="limits">
            <ul className="ml-5 list-disc space-y-1">
              <li>Market Price is smoothed and lags sharp moves.</li>
              <li>US marketplace only; prices are before fees, shipping, duties and taxes.</li>
              <li>
                History from before daily collection began was backfilled from TCGplayer&apos;s weekly price
                buckets, so early steps in a chart can be a week apart.
              </li>
              <li>Thinly traded products can move on a single sale.</li>
              <li>
                Collection stops when the collector is offline; prices then age until the{" "}
                {PRICE_STALENESS_TOLERANCE_DAYS}-day rule hides them.
              </li>
              <li>CAD history uses the latest rate (see Canadian dollars).</li>
            </ul>
          </Section>

          <Section id="corrections">
            <p>
              Pokéfin does not edit prices by hand. When a price is wrong at the source, the product can be
              excluded until it is corrected. <ReportLink topic="wrong_price" />
            </p>
          </Section>

          <Section id="changes">
            <table className="w-full border-collapse">
              <thead>
                <tr><th className={TH}>Version</th><th className={TH}>Effective</th><th className={TH}>Change</th></tr>
              </thead>
              <tbody>
                {METHODOLOGY_CHANGES.map((c) => (
                  <tr key={c.version}>
                    <td className={TD}>{c.version}</td>
                    <td className={TD}><time dateTime={c.date}>{formatDateOnly(c.date)}</time></td>
                    <td className={TD}>{c.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </article>
      </div>
    </main>
  );
}
```

Notes: `PulseSignal` is already exported by `marketPulse.ts`. If `formatDateOnly`'s second parameter is not a fallback string in your `format.ts`, pass `"--"` the way the file's signature allows (WP07 defines `formatDateOnly(value, fallback = "Unknown")`). The `$` before `{formatInteger(PRICE_ABSOLUTE_MAX_USD)}` is literal text; JSX drops whitespace that contains a line break, so it renders "$500,000 USD" without a space whether or not Prettier puts the expression on the next line. Never insert `{" "}` between them.

`#returns`: if Before you start's WP10 check printed 0 (anchor bounds rolled back), drop the third table column and `oldestLookback`, and use this paragraph instead: "The lookback price has no maximum age: a product with a gap in its history can report a return measured over a longer span than its label. Returns are withheld with the price." WP25 step 14c replaces this table and the paragraph under it (it calls that paragraph "the paragraph that begins 'The lookback price has no maximum age'"; with the bounds in place it is the paragraph beginning "Returns are computed in the database"), and its test then asserts its own third column.

`AsOf variant="inline"` is rendered only when the page says the newest price is stale, so a fresh date is not printed twice; `AsOf` repeats the age check itself and prints "Last priced Sep 25" with the clock icon.

10b. New `app/methodology/page.tsx`:

```tsx
import type { Metadata } from "next";
import MethodologyArticle, { type MethodologyCurrentValues } from "./MethodologyArticle";
import {
  METHODOLOGY_EFFECTIVE_DATE,
  METHODOLOGY_FIRST_PUBLISHED,
  METHODOLOGY_VERSION,
} from "../content/methodology";
import { daysBetween, STALE_AFTER_DAYS } from "../components/ui/AsOf";
import { recordedAtDateKey } from "../lib/format";
import { buildArticleJsonLd, buildBreadcrumbJsonLd, serializeJsonLd } from "../lib/jsonLd";
import { hasCurrentPrice } from "../lib/priceGuard";
import { getCachedExchangeRate, getCachedMarketProductSummaries } from "../lib/serverMarketData";

// ISR: static HTML, refreshed by WP11's scrape hook through the two cached
// reads' tags, with a daily backstop. Must stay a number literal.
export const revalidate = 86400;

const DESCRIPTION = `Where Pokéfin's prices come from and how every return, volatility, supply and score figure is calculated. Version ${METHODOLOGY_VERSION}.`;

export const metadata: Metadata = {
  title: "Methodology",
  description: DESCRIPTION,
  alternates: { canonical: "/methodology" },
};

async function loadCurrentValues(): Promise<MethodologyCurrentValues> {
  // Not caught: a failed summaries read fails this render and Next keeps the
  // previous page (same contract as WP13's sitemap). The FX read never throws.
  const [products, fx] = await Promise.all([getCachedMarketProductSummaries(), getCachedExchangeRate()]);

  let latest: string | null = null;
  const byType = new Map<string, number>();
  for (const product of products) {
    const key = recordedAtDateKey(product.price_recorded_at ?? null);
    if (key !== null && (latest === null || key > latest)) latest = key;
    const label = product.product_types?.label || product.product_types?.name || "Other";
    byType.set(label, (byType.get(label) ?? 0) + 1);
  }

  // A plain async function, not a component, so reading the clock here keeps
  // render pure (react-hooks/purity). ISR: the flag can lag by up to a day,
  // the printed date never does.
  const todayKey = new Date().toISOString().slice(0, 10);

  return {
    productsTracked: products.length,
    pricedRecently: products.filter((product) => hasCurrentPrice(product)).length,
    latestPriceDate: latest,
    latestPriceStale: latest !== null && daysBetween(latest, todayKey) >= STALE_AFTER_DAYS,
    fxRate: fx.date === null ? null : fx.rate,
    fxDate: fx.date === null ? null : recordedAtDateKey(fx.date),
    byType: [...byType.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}

export default async function MethodologyPage() {
  const current = await loadCurrentValues();
  const article = buildArticleJsonLd({
    headline: "Pokéfin methodology",
    description: DESCRIPTION,
    path: "/methodology",
    datePublished: METHODOLOGY_FIRST_PUBLISHED,
    dateModified: METHODOLOGY_EFFECTIVE_DATE,
  });
  const breadcrumb = buildBreadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Methodology", path: "/methodology" },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(article) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />
      <MethodologyArticle current={current} />
    </>
  );
}
```

If `hasCurrentPrice` or `recordedAtDateKey` has a different signature in the current tree (`grep -n "export function hasCurrentPrice\|export function recordedAtDateKey" app/lib/priceGuard.ts app/lib/format.ts`), adapt the call, not the logic. `fx.date` is whatever WP11's `ExchangeRateSnapshot.date` holds (a `recorded_at` string); `recordedAtDateKey` reduces it to `YYYY-MM-DD`.

### Step 11. Shared prose shell: `app/components/trust/DocPage.tsx` (new)

```tsx
import type { ReactNode } from "react";

export const DOC_LINK =
  "font-medium text-action underline underline-offset-2 hover:text-action-strong focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action";

/** Prose page for /about, /terms and /privacy: one 720 px column, WP23 type scale. */
export default function DocPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  /** e.g. "Last updated Oct 14, 2026". */
  updated?: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:py-12">
      <h1 className="text-h1 font-semibold tracking-tight text-ink">{title}</h1>
      {updated && <p className="mt-1 text-caption text-ink-soft">{updated}</p>}
      {intro && <div className="mt-4 text-prose text-ink">{intro}</div>}
      <div className="mt-8 space-y-8 text-prose text-ink">{children}</div>
    </main>
  );
}

export function DocSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20">
      <h2 id={`${id}-h`} className="text-h2 font-semibold text-ink">
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
```

### Step 12. `/about` (new `app/about/page.tsx`)

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import DocPage, { DOC_LINK, DocSection } from "../components/trust/DocPage";
import { CONTACT_EMAILS, REPLY_EXPECTATION } from "../content/contact";
import { DISCLOSURE, INDEPENDENCE_POLICY, OPERATOR, STORE_NAME, STORE_URL } from "../content/disclosures";
import { formatInteger } from "../lib/format";
import { buildAboutPageJsonLd, buildBreadcrumbJsonLd, serializeJsonLd } from "../lib/jsonLd";
import { getCachedMarketProductSummaries } from "../lib/serverMarketData";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "About",
  description: "Who runs Pokéfin, how it makes money, and how its numbers stay independent of any shop.",
  alternates: { canonical: "/about" },
};

function operatorSentence(): string {
  const place = [OPERATOR.city, OPERATOR.province].filter(Boolean).join(", ");
  if (OPERATOR.name) return `Pokéfin is built and run by ${OPERATOR.name}${place ? `, ${place}` : ""}.`;
  // D2 open: claim only what the current privacy page already states.
  return `Pokéfin is an independent, personal project run from ${place || "Canada"}.`;
}

export default async function AboutPage() {
  const products = await getCachedMarketProductSummaries();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildAboutPageJsonLd()) }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(buildBreadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "About", path: "/about" }])),
        }}
      />
      <DocPage title="About Pokéfin">
        <DocSection id="what" title="What Pokéfin is">
          <p>
            Pokéfin tracks daily TCGplayer Market Prices, returns and supply for {formatInteger(products.length)}{" "}
            sealed Pokémon TCG products, in US and Canadian dollars, for collectors who buy, hold and sell
            sealed product.
          </p>
        </DocSection>
        <DocSection id="who" title="Who runs it">
          <p>{operatorSentence()}</p>
        </DocSection>
        <DocSection id="disclosures" title="How Pokéfin makes money">
          <p>{DISCLOSURE.revenueSentence}</p>
          <p>
            {DISCLOSURE.relationshipSentence ??
              `Pokéfin shows one link per page to ${STORE_NAME}, a Canadian card shop.`}{" "}
            <a href={STORE_URL} target="_blank" rel={DISCLOSURE.storeLinkRel} className={DOC_LINK}>
              {STORE_NAME}
            </a>
          </p>
        </DocSection>
        <DocSection id="independence" title="Independence policy">
          <ul className="ml-5 list-disc space-y-1">
            {INDEPENDENCE_POLICY.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </DocSection>
        <DocSection id="data" title="Data and methodology">
          <p>
            Prices are TCGplayer Market Price, collected daily. Every formula, window and threshold is published
            in the{" "}
            <Link href="/methodology" prefetch={false} className={DOC_LINK}>
              methodology
            </Link>
            , and every metric label on the site links to its definition.
          </p>
        </DocSection>
        <DocSection id="contact" title="Contact">
          <p>
            Email{" "}
            <a href={`mailto:${CONTACT_EMAILS.hello}`} className={DOC_LINK}>
              {CONTACT_EMAILS.hello}
            </a>{" "}
            or use the{" "}
            <Link href="/contact" prefetch={false} className={DOC_LINK}>
              contact page
            </Link>{" "}
            to report a wrong price. {REPLY_EXPECTATION} Privacy requests:{" "}
            <a href={`mailto:${CONTACT_EMAILS.privacy}`} className={DOC_LINK}>
              {CONTACT_EMAILS.privacy}
            </a>
            .
          </p>
        </DocSection>
      </DocPage>
    </>
  );
}
```

### Step 13. `/terms` (new `app/terms/page.tsx`)

Static page (no data read). `TERMS_EFFECTIVE_DATE` is the PR date.

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import DocPage, { DOC_LINK, DocSection } from "../components/trust/DocPage";
import { CONTACT_EMAILS } from "../content/contact";
import { OPERATOR, POKEMON_TRADEMARK_NOTICE, TCGPLAYER_TRADEMARK_NOTICE } from "../content/disclosures";
import { formatDateOnly } from "../lib/format";

const TERMS_EFFECTIVE_DATE = "2026-10-14"; // the PR date, YYYY-MM-DD

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The terms for using Pokéfin: information only, no warranty, acceptable use and your data.",
  alternates: { canonical: "/terms" },
};

function governingLaw(): string {
  return OPERATOR.province
    ? `the laws of the province of ${OPERATOR.province} and the federal laws of Canada that apply there`
    : "the laws of the Canadian province where the operator lives and the federal laws of Canada that apply there";
}

export default function TermsPage() {
  return (
    <DocPage title="Terms of use" updated={`Effective ${formatDateOnly(TERMS_EFFECTIVE_DATE)}`}>
      <DocSection id="information-only" title="Information only">
        <p>
          Pokéfin publishes market data and calculations about sealed Pokémon TCG products for information. Nothing
          on the site is financial, investment or purchasing advice, and past prices do not predict future prices.
          You are responsible for your own buying, holding and selling decisions.
        </p>
      </DocSection>
      <DocSection id="accuracy" title="Accuracy and availability">
        <p>
          Prices are derived from TCGplayer data that Pokéfin does not control. They can be wrong, incomplete or
          late, and the site can be unavailable. Pokéfin provides the site as is, without any warranty of
          accuracy, completeness or availability. How each figure is calculated is published in the{" "}
          <Link href="/methodology" prefetch={false} className={DOC_LINK}>methodology</Link>.
        </p>
      </DocSection>
      <DocSection id="affiliation" title="No affiliation">
        <p>{POKEMON_TRADEMARK_NOTICE}</p>
        <p>{TCGPLAYER_TRADEMARK_NOTICE}</p>
        <p>
          Pokéfin&apos;s relationship with the shop it links to is stated on{" "}
          <Link href="/about#disclosures" prefetch={false} className={DOC_LINK}>the About page</Link>.
        </p>
      </DocSection>
      <DocSection id="acceptable-use" title="Acceptable use">
        <ul className="ml-5 list-disc space-y-1">
          <li>
            Do not scrape or download the site or its data in bulk, or resell it. Search engines indexing public
            pages under <code>robots.txt</code> are welcome.
          </li>
          <li>Do not try to break, overload or get around the site&apos;s security or rate limits.</li>
          <li>Do not use another person&apos;s account.</li>
        </ul>
        <p>Pokéfin can block access that breaks these rules.</p>
      </DocSection>
      <DocSection id="accounts" title="Accounts and your data">
        <p>
          You are responsible for keeping your password safe. The portfolios, holdings and recipes you enter are
          yours; Pokéfin stores and processes them only to provide the service, as described in the{" "}
          <Link href="/privacy" prefetch={false} className={DOC_LINK}>privacy policy</Link>. You can export or
          delete your data from your account page at any time.
        </p>
      </DocSection>
      <DocSection id="liability" title="Limitation of liability">
        <p>
          To the extent the law allows, Pokéfin and its operator are not liable for any loss or damage arising
          from your use of the site or reliance on its data, including trading losses.
        </p>
      </DocSection>
      <DocSection id="changes" title="Changes to these terms">
        <p>
          These terms can change. The effective date above changes when they do, and continued use of the site
          means you accept the new terms.
        </p>
      </DocSection>
      <DocSection id="law" title="Governing law">
        <p>These terms are governed by {governingLaw()}.</p>
      </DocSection>
      <DocSection id="contact" title="Contact">
        <p>
          Questions about these terms:{" "}
          <a href={`mailto:${CONTACT_EMAILS.hello}`} className={DOC_LINK}>{CONTACT_EMAILS.hello}</a>.
        </p>
      </DocSection>
    </DocPage>
  );
}
```

### Step 14. `/contact`

14a. New `app/contact/mail.ts` (server only; the page is its only importer):

```ts
import { CONTACT_EMAILS, type Mailbox } from "../content/contact";
import {
  CONTACT_TOPICS,
  DIGEST_RE,
  isContactTopic,
  MAX_FROM_LENGTH,
  MAX_QUERY_LENGTH,
  type ContactTopic,
} from "../lib/contactLink";
import { safeNextPath } from "../lib/redirects";
import { stripControlChars } from "../lib/validation";
import { parseProductId } from "../product/[id]/productMeta";

export interface TopicCopy {
  label: string;
  mailbox: Mailbox;
  subject: string;
  prompt: string;
}

export const TOPIC_COPY: Readonly<Record<ContactTopic, TopicCopy>> = {
  wrong_price: { label: "A price looks wrong", mailbox: "reports", subject: "Wrong price", prompt: "What looks wrong, and what price did you expect?" },
  wrong_info: { label: "Wrong product details", mailbox: "reports", subject: "Wrong product details", prompt: "Which detail is wrong (name, set, image, release date)?" },
  missing_product: { label: "A product is missing", mailbox: "reports", subject: "Missing product", prompt: "Which product should Pokéfin track? A TCGplayer link helps." },
  broken_feature: { label: "Something is broken", mailbox: "reports", subject: "Something is broken", prompt: "What did you do, and what happened instead?" },
  idea: { label: "An idea or request", mailbox: "hello", subject: "Idea", prompt: "What would make Pokéfin more useful to you?" },
  other: { label: "Something else", mailbox: "hello", subject: "Hello", prompt: "Your message:" },
};

export const TOPIC_ORDER: readonly ContactTopic[] = CONTACT_TOPICS;

export interface ContactContext {
  topic: ContactTopic | null;
  productId: number | null;
  from: string | null;
  query: string | null;
  digest: string | null;
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(params: SearchParams, key: string): string | null {
  const value = params[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

/** Every value is validated; anything unexpected is dropped, never echoed. */
export function parseContactParams(params: SearchParams): ContactContext {
  const topicRaw = first(params, "topic");
  const productRaw = first(params, "product");
  const fromRaw = first(params, "from");
  const queryRaw = first(params, "q");
  const digestRaw = first(params, "digest");

  let from: string | null = null;
  if (fromRaw && fromRaw.length <= MAX_FROM_LENGTH) {
    const safe = safeNextPath(fromRaw);
    const isHome = fromRaw === "/";
    if ((safe !== "/" || isHome) && !safe.startsWith("/contact")) from = safe;
  }

  const query = queryRaw ? stripControlChars(queryRaw).trim().slice(0, MAX_QUERY_LENGTH) || null : null;

  return {
    topic: isContactTopic(topicRaw) ? topicRaw : null,
    productId: productRaw ? parseProductId(productRaw) : null,
    from,
    query,
    digest: digestRaw && DIGEST_RE.test(digestRaw) ? digestRaw : null,
  };
}

export interface Mailto {
  href: string;
  address: string;
  subject: string;
  body: string;
}

/** RFC 6068 mailto with CRLF line breaks, every component percent-encoded. */
export function buildMailto(
  topic: ContactTopic,
  context: ContactContext,
  productName: string | null,
  origin: string
): Mailto {
  const copy = TOPIC_COPY[topic];
  const address = CONTACT_EMAILS[copy.mailbox];
  const about = productName ?? (context.productId !== null ? `product ${context.productId}` : null);
  const subject = `[Pokéfin] ${copy.subject}${about ? `: ${about}` : ""}`;

  const lines = [copy.prompt, "", "", "---"];
  if (context.from) lines.push(`Page: ${origin}${context.from}`);
  if (context.productId !== null) lines.push(`Product: ${productName ?? "unknown"} (id ${context.productId})`);
  if (context.query) lines.push(`Search: ${context.query}`);
  if (context.digest) lines.push(`Error reference: ${context.digest}`);
  lines.push("Sent from the Pokéfin contact page");
  const body = lines.join("\r\n");

  return {
    href: `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    address,
    subject,
    body,
  };
}
```

`stripControlChars` is WP02's helper in `app/lib/validation.ts` (WP13's `redirects.ts` imports it). If its name differs, use the name `redirects.ts` imports.

14b. New `app/contact/page.tsx`:

```tsx
import type { Metadata } from "next";
import { buttonClasses } from "../components/ui/Button";
import { CONTACT_EMAILS, REPLY_EXPECTATION } from "../content/contact";
import { getCachedMarketProductSummaries } from "../lib/serverMarketData";
import { getSiteOrigin, NO_INDEX } from "../lib/site";
import { getProductDisplayName } from "../product/[id]/productMeta";
import { buildMailto, parseContactParams, TOPIC_COPY, TOPIC_ORDER } from "./mail";

export const metadata: Metadata = {
  title: "Contact",
  description: "Report a wrong price, a missing product or a problem, or say hello.",
  robots: NO_INDEX,
  alternates: { canonical: "/contact" },
};

async function findProductName(id: number): Promise<string | null> {
  try {
    const products = await getCachedMarketProductSummaries();
    const product = products.find((p) => p.id === id);
    return product ? getProductDisplayName(product) : null;
  } catch {
    // The name is a convenience; the id alone identifies the product.
    return null;
  }
}

const ROW =
  "flex min-h-14 items-center justify-between gap-3 border-b border-line py-3 text-body text-ink hover:text-action focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action";

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = parseContactParams(await searchParams);
  const productName = context.productId === null ? null : await findProductName(context.productId);
  const origin = getSiteOrigin().origin;
  const selected = context.topic ? buildMailto(context.topic, context, productName, origin) : null;
  const others = TOPIC_ORDER.filter((topic) => topic !== context.topic);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 md:py-12">
      <h1 className="text-h1 font-semibold tracking-tight text-ink">Contact</h1>
      <p className="mt-2 text-prose text-ink">
        {REPLY_EXPECTATION} Each option opens your email app with the details filled in.
      </p>

      {context.topic && selected && (
        <section aria-labelledby="selected-topic" className="mt-6 rounded-card border border-action bg-surface p-4">
          <h2 id="selected-topic" className="text-h3 font-semibold text-ink">
            {TOPIC_COPY[context.topic].label}
          </h2>
          {context.productId !== null && (
            <p className="mt-1 text-small text-ink-soft">
              {productName ?? "Product"} (id {context.productId})
            </p>
          )}
          <a href={selected.href} className={buttonClasses({ className: "mt-4 w-full sm:w-auto" })}>
            Email {selected.address}
          </a>
          <p className="mt-4 text-small text-ink-soft">
            No email app? Write to <span className="font-medium text-ink">{selected.address}</span> with the subject
            &quot;{selected.subject}&quot; and this text:
          </p>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-control bg-surface-alt p-3 text-small text-ink">
            {selected.body}
          </pre>
        </section>
      )}

      <section aria-labelledby="topics" className="mt-8">
        <h2 id="topics" className="text-h2 font-semibold text-ink">
          {context.topic ? "Other topics" : "What is it about?"}
        </h2>
        <ul className="mt-2">
          {others.map((topic) => {
            const mail = buildMailto(topic, context, productName, origin);
            return (
              <li key={topic}>
                <a href={mail.href} className={ROW}>
                  <span>{TOPIC_COPY[topic].label}</span>
                  <span className="text-small text-ink-soft">{mail.address}</span>
                </a>
              </li>
            );
          })}
        </ul>
        <p className="mt-6 text-small text-ink-soft">
          Privacy requests:{" "}
          <a href={`mailto:${CONTACT_EMAILS.privacy}`} className="font-medium text-action underline underline-offset-2">
            {CONTACT_EMAILS.privacy}
          </a>
        </p>
      </section>
    </main>
  );
}
```

Reading `searchParams` makes the route dynamic; that is intended (it is noindex and cheap). Do not add `export const dynamic`.

### Step 15. `app/privacy/page.tsx`: rewrite

Replace the file. `LAST_UPDATED` is the PR date. Keep every factual statement the current page makes about deletion, export, RLS and cookies (they describe WP01 to WP05 behaviour); the new text below already contains them.

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import DocPage, { DOC_LINK, DocSection } from "../components/trust/DocPage";
import { CONTACT_EMAILS } from "../content/contact";
import { OPERATOR } from "../content/disclosures";
import { formatDateOnly } from "../lib/format";

const LAST_UPDATED = "2026-10-14"; // the PR date, YYYY-MM-DD

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What personal data Pokéfin collects, why, who processes it, and your rights under Canadian law.",
  alternates: { canonical: "/privacy" },
};

const privacyMail = (
  <a href={`mailto:${CONTACT_EMAILS.privacy}`} className={DOC_LINK}>
    {CONTACT_EMAILS.privacy}
  </a>
);

export default function PrivacyPage() {
  const controller = OPERATOR.name ? `${OPERATOR.name}, who operates Pokéfin` : "the operator of Pokéfin";
  return (
    <DocPage title="Privacy policy" updated={`Last updated ${formatDateOnly(LAST_UPDATED)}`}>
      <DocSection id="who" title="Who is responsible">
        <p>
          Pokéfin is an independent, personal project run from Canada. The person responsible for your personal information
          is {controller}. Pokéfin handles personal information under Canada&apos;s Personal Information Protection
          and Electronic Documents Act (PIPEDA). Visitors in the EU and UK also have the rights listed below under
          the GDPR and UK GDPR. Contact: {privacyMail}.
        </p>
      </DocSection>
      <DocSection id="collect" title="What we collect">
        <ul className="ml-5 list-disc space-y-1">
          <li><strong>Account data</strong>: your email address, an optional username and a password, which Supabase Auth stores hashed.</li>
          <li><strong>Portfolio data</strong>: the products you add, quantities, purchase prices, dates and any notes you write.</li>
          <li><strong>Box calculator data</strong>: the recipes you save, with their names and pack contents.</li>
          <li><strong>Security records</strong>: timestamps of sign-up, password change and account deletion, in an audit log only the operator can read.</li>
          <li><strong>Messages you send us</strong>: the contact page opens your own email app; we keep the emails you send in our mailbox to answer and fix what you report, and delete them on request.</li>
          <li><strong>Usage and performance measurements</strong>: see Analytics below.</li>
        </ul>
      </DocSection>
      <DocSection id="analytics" title="Analytics">
        <p>
          Pokéfin uses Vercel Web Analytics to count page views and Vercel Speed Insights to measure page speed
          (loading, responsiveness and layout stability) on every page. They record the page address, the referring
          page, the browser and device type, and the country. Neither sets cookies, and neither tracks you across
          other websites. The data is aggregated.
        </p>
      </DocSection>
      <DocSection id="not-collected" title="What we do not collect">
        <ul className="ml-5 list-disc space-y-1">
          <li>No advertising or third-party tracking cookies.</li>
          <li>No payment information: the service is free.</li>
          <li>No selling or renting of personal information.</li>
        </ul>
      </DocSection>
      <DocSection id="use" title="How we use it">
        <p>
          Only to run the service: to sign you in, show your portfolio and saved recipes, calculate values, answer
          your messages, keep the site secure and understand, in aggregate, which pages are used and how fast they
          load. By creating an account you consent to this use; you can withdraw consent by deleting your account.
        </p>
      </DocSection>
      <DocSection id="processors" title="Service providers">
        <ul className="ml-5 list-disc space-y-1">
          <li><strong>Supabase</strong>: database, sign-in and file storage.</li>
          <li><strong>Vercel</strong>: hosting, application logs, Web Analytics and Speed Insights.</li>
          <li><strong>Cloudflare Turnstile</strong>: bot protection on sign-up and sign-in.</li>
          <li><strong>Brevo</strong>: email delivery, when Pokéfin sends you an email.</li>
          <li><strong>Sentry</strong>: error reports, when enabled; email addresses, IP addresses and cookies are removed from each report before it is sent.</li>
        </ul>
        <p>These providers can store and process data outside Canada, including in the United States, where it is subject to local law.</p>
      </DocSection>
      <DocSection id="retention" title="How long we keep it">
        <p>
          As long as your account exists. Deleting your account removes your profile, portfolios, holdings, lots
          and box recipes in one step. The audit log keeps a record of the deletion (your user id and the event,
          not your email or content) for security. Emails you send us are deleted within 12 months of the last
          reply, or earlier on request.
        </p>
      </DocSection>
      <DocSection id="rights" title="Your rights">
        <ul className="ml-5 list-disc space-y-1">
          <li><strong>Access and a copy</strong>: download every record we hold about you as one JSON file from your <Link href="/account" prefetch={false} className={DOC_LINK}>account page</Link>.</li>
          <li><strong>Correction</strong>: edit your username and portfolio data in the app, or ask us.</li>
          <li><strong>Deletion and withdrawing consent</strong>: delete your account from your <Link href="/account" prefetch={false} className={DOC_LINK}>account page</Link>.</li>
          <li><strong>Questions or objections</strong>: write to {privacyMail}. We answer within 30 days.</li>
          <li><strong>Complaints</strong>: you can complain to the Office of the Privacy Commissioner of Canada, or, in the EU or UK, to your local data protection authority.</li>
        </ul>
      </DocSection>
      <DocSection id="security" title="Security">
        <p>
          Data travels over TLS, is encrypted at rest by Supabase, and is separated per user by database row-level
          security. Sessions live in HttpOnly, SameSite=Lax cookies. Requests that change or delete data must come
          from the site itself.
        </p>
      </DocSection>
      <DocSection id="contact" title="Contact">
        <p>Privacy questions and requests: {privacyMail}.</p>
      </DocSection>
    </DocPage>
  );
}
```

If the current privacy page mentions a sub-processor or data category not listed above (another package may have added one, for example a newsletter), keep it: add its bullet to the matching list.

Completeness finding N06 (low; the verifiers' wording is binding): the old page names Vercel only for hosting and logs, says Sentry removes personal data "before events leave the server" (the browser config runs in the browser, and the edge config had no `beforeSend` until WP17), and says sessions are "rotated on every request" (`proxy.ts` runs only on `/account`, `/portfolio`, `/api` and `/auth`, and Supabase refreshes a session only when its access token expires). The text above fixes all three: the Analytics section names what Web Analytics and Speed Insights collect, the Sentry bullet says what is stripped and does not say where, and the Security section makes no rotation claim. Do not reintroduce "rotated on every request" or "leave the server". If session behaviour has to be described, write "refreshed automatically when they expire".

### Step 16. `/stats`: metric labels, composite percentile, decision note

In `app/stats/page.tsx`:

16a. Delete `STAT_TOOLTIPS`, `InfoIcon`, `StatHeader`, WP14's local `METRIC_DEFINITIONS` array, and the `formatScore` helper if it still exists. Add imports:

```tsx
import Link from "next/link";
import DecisionNote from "../components/ui/DecisionNote";
import MetricLabel from "../components/ui/MetricLabel";
import ProvenanceLine from "../components/ui/ProvenanceLine";
import { PROVENANCE_SENTENCE } from "../content/disclosures";
import { METRIC_DEFINITIONS, type MetricKey } from "../lib/metricDefinitions";
import { compositeTopPercent, formatCompositePercentile } from "../lib/setAnalytics";
```

Skip any of these lines the file already has (an earlier package may have imported `Link` or `ProvenanceLine`); a duplicate import fails `tsc`.

16b. The column list of the "All Set Metrics" table, in table order (the definitions list reads it):

```tsx
const ALL_COLUMNS: readonly MetricKey[] = [
  "setRank", "setRelease", "setDaysSince", "setProducts",
  "setAvg30", "setAvg90", "setAvg365", "setMedian30", "setMedian90", "setMedian365",
  "setConsistency90", "setConsistency365", "setVolatility90Daily", "setMaxDrawdown365",
  "setTrend90", "setTrend365", "setPricePerDay", "setMomentum", "compositeScore",
];
```

16c. Every header cell: `<StatHeader label="X" tooltip={STAT_TOOLTIPS.y} />` becomes `<MetricLabel metric="<key>" />` with the key from this table; the "Set" header stays plain text:

| Old label | Key |
|---|---|
| Rank | `setRank` |
| Release | `setRelease` |
| Days Since | `setDaysSince` |
| Products | `setProducts` |
| Avg 30D / Avg 90D / Avg 1Y | `setAvg30` / `setAvg90` / `setAvg365` |
| Med 30D / Med 90D / Med 1Y | `setMedian30` / `setMedian90` / `setMedian365` |
| Consistency 90D / 1Y | `setConsistency90` / `setConsistency365` |
| Volatility 90D (daily) | `setVolatility90Daily` |
| Max Drawdown 1Y | `setMaxDrawdown365` |
| Trend 90D / 1Y | `setTrend90` / `setTrend365` |
| Price/Day | `setPricePerDay` |
| Momentum | `setMomentum` |
| Invest Score | `compositeScore` |

16d. Replace WP14's `MetricDefinitions` component with one that reads the module (it stays a `<details>`, so no JS):

```tsx
function MetricDefinitions() {
  return (
    <details className="border-t border-line px-4 py-3 text-sm">
      <summary className="cursor-pointer py-1 font-semibold text-ink-soft hover:text-ink">
        What do these columns mean?
      </summary>
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {ALL_COLUMNS.map((key) => (
          <div key={key}>
            <dt className="font-semibold text-ink">{METRIC_DEFINITIONS[key].label}</dt>
            <dd className="text-ink-soft">{METRIC_DEFINITIONS[key].short}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3">
        <Link href="/methodology#set-averages" prefetch={false} className="font-medium text-action hover:underline">
          Full definitions in the methodology
        </Link>
      </p>
    </details>
  );
}
```

16e. Replace `ScoreCell` with a percentile cell. Compute the ranked count once in `StatsPage`: `const rankedCount = stats.filter((set) => set.rank !== null).length;` and pass it:

```tsx
function CompositeCell({
  rank,
  score,
  rankedCount,
}: {
  rank: number | null;
  score: number | null;
  rankedCount: number;
}) {
  const top = compositeTopPercent(rank, rankedCount);
  if (top === null || score === null || Number.isNaN(score)) {
    return <span className="text-ink-soft">--</span>;
  }
  return (
    <span
      className="font-semibold tabular-nums text-ink"
      title={`Composite z-score ${score.toFixed(2)}, rank ${rank} of ${rankedCount}`}
    >
      {formatCompositePercentile(rank, rankedCount)}
    </span>
  );
}
```

Both `<ScoreCell value={set.investScore} />` become `<CompositeCell rank={set.rank} score={set.investScore} rankedCount={rankedCount} />`. The cell is neutral ink (a rank is not a gain or a loss).

16f. Directly after the `<div className="overflow-x-auto">...</div>` of the "Top Sets by Composite Score" section (before `</section>`), add `<DecisionNote anchor="composite-score" className="border-t border-line px-4 py-3" />`. In the "All Set Metrics" section, change the subtitle "Composite score is z-score weighted with drawdown and volatility penalties." to "Composite score is a set's position (Top or Bottom N%) on a weighted z-score blend; see the methodology." (keep the first sentence as it is).

16g. Under the page's `<h1>` block (after the "Deep set analytics..." paragraph), add:

```tsx
        <ProvenanceLine methodologyHref="/methodology#source" className="mt-1">
          {PROVENANCE_SENTENCE}
        </ProvenanceLine>
```

16h. `app/analytics/page.tsx` metadata description (WP13): replace "invest score" with "composite score".

### Step 17. Product page: metric labels, report link, withheld copy

In `app/product/[id]/page.tsx`:

17a. `MetricTile` takes a metric key instead of a string:

```tsx
function MetricTile({ metric, children }: { metric: MetricKey; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <MetricLabel metric={metric} />
      </div>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}
```

Keep the wrapper classes the file has now (earlier packages may have changed them); only the prop and the label line change. Imports: `import MetricLabel from "../../components/ui/MetricLabel";`, `import ReportLink from "../../components/ui/ReportLink";`, `import type { MetricKey } from "../../lib/metricDefinitions";`, and `productPath` from `./productMeta` if not yet imported.

17b. Map every tile: "Release Date" `releaseDate`, "Days Since Release" `daysSinceRelease`, "Price / Day" `pricePerDay`, "7D" `return7d`, "1M" `return1m`, "3M" `return3m`, "6M" `return6m`, "1Y" `return1y`, "CAGR" `cagr`, "Max Drawdown" `maxDrawdown`, "Volatility 30D (annualised)" `volatility30dAnnualised`, "Units sold (7d)" `unitsSold7d`, "Units sold (30d)" `unitsSold30d`, "Volume trend" `volumeTrend`, "Active listings" `activeListings`, "Units on market" `unitsOnMarket`, "Days of supply" `daysOfSupply`. `grep -n '<MetricTile label=' "app/product/[id]/page.tsx"` must print nothing afterwards.

17c. The Market Pulse `<h2>`: its text "Market Pulse" becomes `<MetricLabel metric="marketPulse" />`.

17d. The withheld-price sentence (the `{!hasCurrentPrice(product) && (...)}` block under the hero price):

```tsx
              {product.price_recorded_at
                ? `No current price. Last recorded ${formatDate(product.price_recorded_at)}.`
                : "No current price. This product has never been priced."}
```

Use whatever date formatter the block calls now (WP07 renamed or replaced `formatDate`); change only the punctuation and wording.

17e. Directly after the withheld block (still inside the hero column, before the `MetricTile` grid), add:

```tsx
          <p className="mt-1">
            <ReportLink topic="wrong_price" productId={product.id} from={productPath(product.id)} />
          </p>
```

WP31 moves it into its new quote header.

### Step 18. Box calculator: renamed verdicts, visible bands, decision note

18a. `app/components/BoxCalculator/BoxCalculator.tsx`: add `import DecisionNote from "../ui/DecisionNote";` and extend the `./nav` import with `PACK_VALUE_LABELS, packValueBandsText`. Replace the whole "Signal Banner" block (the `<div className={\`px-5 py-4 ${ navResult.signal === "buy" ? ...` element and its children, through the badge span) with:

```tsx
          {/* Pack-value comparison. Neutral on purpose: it says where the price
              sits against the packs, it is not a buy or sell call. */}
          <div className="border-b border-line bg-surface-alt px-5 py-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-h2 font-semibold text-ink">{PACK_VALUE_LABELS[navResult.signal]}</span>
              <span className="text-small font-medium tabular-nums text-ink-soft">
                {navResult.premiumDiscount < 0
                  ? `${Math.abs(navResult.premiumDiscountPercent).toFixed(1)}% below NAV`
                  : navResult.premiumDiscount > 0
                  ? `${navResult.premiumDiscountPercent.toFixed(1)}% above NAV`
                  : "At NAV"}
              </span>
            </div>
            <p className="mt-1 text-caption text-ink-soft">{packValueBandsText()}</p>
            <DecisionNote anchor="box-nav" className="mt-1" />
          </div>
```

If the current premium expression uses a WP07 or WP23 formatter instead of `toFixed(1)`, keep the formatter. After the edit: `grep -n "Good Deal\|Fair Price\|Overpriced\|emerald-\|amber-\|rose-" app/components/BoxCalculator/BoxCalculator.tsx` prints no verdict-related line (other emerald/rose uses in the breakdown table, such as the premium/discount row, stay).

18b. `app/box-calculator/page.tsx`: the intro sentence "Build a recipe for any collection box and see if it's a good deal based on today's market prices." becomes "Build a recipe for any collection box and see whether its price is below, near or above the value of its packs." WP13's metadata description ("...to see whether it is a good deal.") becomes "Price any Pokémon TCG collection box against today's booster pack prices to see whether it trades below, near or above its pack value."

### Step 19. Report links in empty and error states

19a. `app/components/NoResults.tsx` (WP13; imported by client components): add `import ReportLink from "./ui/ReportLink";` and, after the "Clear filters" button:

```tsx
      <p className="mt-3">
        <ReportLink topic="missing_product" query={query} />
      </p>
```

19b. `app/error.tsx` (WP15 styling, WP22 lazy Sentry; keep both): add `import { usePathname } from "next/navigation";` and `import ReportLink from "./components/ui/ReportLink";`; inside the component `const pathname = usePathname();`; after the "Try again" button:

```tsx
        <p>
          <ReportLink topic="broken_feature" from={pathname} digest={error.digest}>
            Tell us what happened
          </ReportLink>
        </p>
```

19c. `app/global-error.tsx` (inline styles only; `globals.css` may not be loaded). Hoist the hex values WP15 inlined into one object so the file's hex count stays exactly at its WP23 baseline, and add a plain link:

```tsx
import { buildContactHref } from "./lib/contactLink";

// Token values from globals.css; this boundary replaces the root layout.
const COLORS = {
  page: "#f8fafc",
  ink: "#0f172a",
  inkSoft: "#475569",
  action: "#2563eb",
  onAction: "#fff",
} as const;
```

Replace each inline hex in the JSX with the matching `COLORS.*` entry, then add after the button:

```tsx
          <p style={{ fontSize: "0.875rem", margin: "1rem 0 0" }}>
            <a
              href={buildContactHref({ topic: "broken_feature", digest: error.digest })}
              rel="nofollow"
              style={{ color: COLORS.action }}
            >
              Tell us what happened
            </a>
          </p>
```

If WP15's file used a different set of hex values, hoist exactly those (one object entry per distinct value, used everywhere) so the count in `uiConventions.baseline.json` for `global-error.tsx` is not exceeded.

### Step 20. "TCGplayer" spelling sweep

```bash
cd /home/user/Pokefin/frontend
grep -rn "TCGPlayer" app --include=*.ts --include=*.tsx
```

Read every hit. Each must be copy, metadata or a comment. If a hit is a code identifier or a value compared against external input (a CSV header, a database value), leave that line and name it in the PR. Then:

```bash
grep -rl "TCGPlayer" app --include=*.ts --include=*.tsx | xargs -r sed -i 's/TCGPlayer/TCGplayer/g'
grep -rn "TCGPlayer" app --include=*.ts --include=*.tsx     # expect only the lines you deliberately kept, normally none
```

This includes tests (for example assertions on "View on TCGPlayer"), so they keep matching. Known copy hits at review time: `Footer.tsx` (rewritten in step 8), `ProductCard.tsx` (twice), `MarketView.tsx`, `page.tsx`, `prices/page.tsx`, `product/[id]/page.tsx`, `layout.tsx` (twice), WP13's `opengraph-image.tsx`, and comments in `lib/marketPulse.ts` and `lib/marketData.ts`.

### Step 21. Em dash sweep in `app/**/*.tsx`

List them:

```bash
cd /home/user/Pokefin/frontend
grep -rn -e $'\xe2\x80\x94' -e '&mdash;' -e '&#8212;' -e '\\u2014' app --include=*.tsx
```

The last pattern finds the escape written as text (`const MISSING = "\u2014";` in WP18's `app/compare/compareColumns.tsx`), which renders an em dash but contains no em dash byte. Fix every hit by these rules, then re-run the command (expect no output):

1. Comments (`//`, `/* */`, `{/* */}`, JSDoc): replace a spaced em dash with ", " (or ": " where it introduces an explanation). Wording otherwise unchanged.
2. An em dash on its own used as a missing-value placeholder (for example WP18's `MISSING` constant in `compare/compareColumns.tsx`, which becomes `const MISSING = "--";` with its comment changed to "missing values render as --", and the two `<td>` cells in the box calculator breakdown that contain only an em dash): replace it with `"--"`, the site's missing-value convention.
3. UI copy: rewrite with a colon, comma or period. Known strings at review time: the box calculator pack option label, which joins the set name and "{price}/pack" (or "No price") with a spaced em dash, uses " · " instead; "NAV unavailable" followed by a spaced em dash and "no current price for X" becomes "NAV unavailable: no current price for X"; in `AllocationChartImpl` "excluded", em dash, "no ..." becomes "excluded: no ..."; in `PortfolioChartImpl` "priced", em dash becomes "priced:" and "portfolio", em dash, "hover" becomes "portfolio. Hover"; in `app/page.tsx` "products", em dash, "updated daily" becomes "products, updated daily".

Then update tests that assert a rewritten string or the em dash placeholder:

```bash
grep -rn -e $'\xe2\x80\x94' -e '\\u2014' app --include=*.test.ts --include=*.test.tsx
```

Change each asserted string to the new text. Do not change assertions for strings you did not rewrite.

### Step 22. Conventions test: trust copy rules

Append to `app/__tests__/uiConventions.test.ts`, after WP23's block (it reuses `SOURCES`, `violations` and `RAW_PALETTE_RE`):

```ts
// ---------------------------------------------------------------------------
// WP24 trust copy: the source's name, no advice or intraday framing, no em
// dashes in TSX, and the trust pages stay server-only and token-only.
// (01-PRODUCT-DIRECTION.md §3.7, research/trust-seo-brand.md §14.4)
// ---------------------------------------------------------------------------
const TSX_SOURCES = SOURCES.filter((s) => s.file.endsWith(".tsx"));

const TRUST_FILES = [
  "methodology/page.tsx",
  "methodology/MethodologyArticle.tsx",
  "about/page.tsx",
  "terms/page.tsx",
  "contact/page.tsx",
  "privacy/page.tsx",
  "components/Footer.tsx",
  "components/trust/DocPage.tsx",
  "components/ui/MetricLabel.tsx",
  "components/ui/ReportLink.tsx",
  "components/ui/DecisionNote.tsx",
];

describe("trust copy (WP24)", () => {
  it("spells the source TCGplayer", () => {
    expect(violations(/TCGPlayer/g)).toEqual([]);
  });

  it("never says Invest Score", () => {
    expect(violations(/invest score/gi)).toEqual([]);
  });

  it("never claims live or real-time prices", () => {
    expect(violations(/\blive prices?\b|\breal[- ]?time\b/gi)).toEqual([]);
  });

  it("never says all-time high", () => {
    expect(violations(/\ball[- ]time highs?\b/gi)).toEqual([]);
  });

  it("uses no em dashes in TSX", () => {
    const found = TSX_SOURCES.flatMap((s) =>
      [...s.text.matchAll(/\u2014|&mdash;|&#8212;|\\u2014/g)].map((m) => `${s.file}: ${m[0]}`)
    );
    expect(found).toEqual([]);
  });

  it("keeps the trust pages server-only and token-only, with forced-colours focus and instant colour", () => {
    for (const file of TRUST_FILES) {
      const source = SOURCES.find((s) => s.file === file);
      expect(source).toBeDefined();
      expect(source!.text).not.toMatch(/^\s*["']use client["']/m);
      expect([...source!.text.matchAll(RAW_PALETTE_RE)].map((m) => `${file}: ${m[0]}`)).toEqual([]);
      expect(source!.text).not.toMatch(/\boutline-none\b|\btransition-(?:colors|all)\b/);
    }
  });

  it("privacy policy names Web Analytics and Speed Insights and makes no unbacked Sentry or session claim (N06)", () => {
    const privacy = SOURCES.find((s) => s.file === "privacy/page.tsx")!.text;
    expect(privacy).toMatch(/Vercel Web Analytics/);
    expect(privacy).toMatch(/Speed Insights/);
    expect(privacy).not.toMatch(/rotated on every request|leave the server/);
  });

  it("keeps content/disclosures.ts import-free (client components import it)", () => {
    const disclosures = SOURCES.find((s) => s.file === "content/disclosures.ts")!.text;
    expect(disclosures).not.toMatch(/^\s*import\b/m);
  });
});
```

Do not write any banned phrase in a comment anywhere under `app/` (the scan reads comments). Then refresh the WP23 ratchet, which will now report lower counts (the footer lost its `--pf-pokeball` hovers):

```bash
cd /home/user/Pokefin/frontend
pnpm exec jest app/__tests__/uiConventions.test.ts          # may fail only with "< baseline; lower the baseline"
UPDATE_UI_BASELINE=1 pnpm exec jest app/__tests__/uiConventions.test.ts
git diff app/__tests__/uiConventions.baseline.json          # every changed count must go DOWN, none up
pnpm exec jest app/__tests__/uiConventions.test.ts          # passes without the variable
```

If any count went up, fix the file that raised it (normally a hex literal added by mistake); never commit a raised baseline.

### Step 23. Sitemap

`app/sitemap.ts` (WP13): add to `STATIC_ROUTES`, after `/compare`:

```ts
  { path: "/methodology", changeFrequency: "monthly", priority: 0.5 },
  { path: "/about", changeFrequency: "yearly", priority: 0.4 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.1 },
```

`/contact` stays out (noindex).

### Step 24. Performance budgets

In `perf-budgets.json` (WP22), add under `routes` (a new route is not a raise):

```json
    "/methodology": {
      "source": "html",
      "jsGzKb": { "target": 130, "limit": null, "recorded": null },
      "documentBrKb": { "target": 30, "limit": null, "recorded": null }
    },
    "/about": { "source": "html", "jsGzKb": { "target": 130, "limit": null, "recorded": null } },
    "/terms": { "source": "html", "jsGzKb": { "target": 130, "limit": null, "recorded": null } },
    "/contact": { "source": "html", "jsGzKb": { "target": 130, "limit": null, "recorded": null } }
```

and under `rum.targets`, next to `/privacy`:

```json
      "/methodology": { "lcpMs": 1500, "inpMs": 100, "cls": 0.02, "ttfbMs": 400 },
      "/about": { "lcpMs": 1500, "inpMs": 100, "cls": 0.02, "ttfbMs": 400 },
      "/terms": { "lcpMs": 1500, "inpMs": 100, "cls": 0.02, "ttfbMs": 400 },
      "/contact": { "lcpMs": 1500, "inpMs": 100, "cls": 0.02, "ttfbMs": 600 }
```

Fill the limits with the perf build (Verification step 6 runs `pnpm perf:budget --write-limits`). If WP22's fixture does not answer a route with 200, add it to `scripts/fixtures/perf.mjs` the way WP22 documents; the four pages read only the summaries and the exchange rate, which the fixture already serves for `/`.

### Step 25. Docs

- `README.md` (repo root), in the Market Pulse metrics section: add one paragraph: "User-facing definitions of every metric live in `frontend/app/lib/metricDefinitions.ts` and on `/methodology` (`frontend/app/methodology/MethodologyArticle.tsx`). The page reads its numbers from code constants; a change to a formula, window, threshold or weight must bump `METHODOLOGY_VERSION` in `frontend/app/content/methodology.ts`. Composite weights and set windows are mirrored in `frontend/app/lib/setAnalytics.ts` and the collector's constants in `frontend/app/lib/pipelineConstants.ts`; tests fail when a mirror drifts from the SQL or `main.py`."
- `frontend/app/components/ui/README.md`: step 6d.

## Pitfalls: do not do this

- **Do not retype a number on `/methodology`.** Every window, threshold and weight is an interpolated constant. If the page needs a number that has no constant, export one from the module that uses it (and mirror SQL or Python values with a drift test), then interpolate it.
- **Do not change behaviour while exporting constants.** Steps 1a to 1f only add `export`, name literals and substitute them; `buildRows.test.ts`, `nav.test.ts` and the set-analytics fallback tests must pass unchanged.
- **Do not rename internal fields** (`investScore`, `invest_score`, `signal: "buy" | "hold" | "avoid"`). Only user-facing strings change. The SQL function and its return type are untouched: no migration in this package.
- **Do not colour the composite percentile or the box verdict green or red.** They describe position, not gain or loss (`01-PRODUCT-DIRECTION.md` §3.2).
- **Do not write disclosure copy anywhere except `app/content/disclosures.ts`.** The promo, footer, `/about` and later emails must read the same constant.
- **Do not guess D1 or D2.** Leave `STORE_RELATIONSHIP`, `OPERATOR_HOLDS_INVENTORY` and `OPERATOR` at `null` until the owner answers in the PR, and say so in the PR body.
- **Do not add a form, a route handler, a table or Turnstile for feedback.** Zero-backend by decision.
- **Do not put anything but the topic list and `buildContactHref` in `lib/contactLink.ts`.** `error.tsx` loads it on every route.
- **Do not add `"use client"` to any trust page, `MetricLabel`, `ReportLink`, `DecisionNote`, `DocPage` or `Footer`.** Only `FooterGate` is a client component.
- **Do not use `next/link` for the external store link or for `mailto:` links.** Plain `<a>`.
- **Do not publish TCGplayer endpoint or request details on `/methodology`** (`research/trust-seo-brand.md` §9). "Public product data" is the level of detail.
- **Do not state unverified TCGplayer internals** (for example "weights recent sales" or "excludes outliers"). The Market Price paragraph in step 10a is the verified-safe wording; the owner may extend it after checking TCGplayer's help article (Owner actions).
- **Do not add `logo` or an unaccented `alternateName` to the Organization JSON-LD** (the logo is the Poké Ball WP27 replaces; the unaccented spelling is banned by WP15's test).
- **Do not catch the summaries failure on `/methodology` or `/about`.** A failed render keeps the previous ISR page; a caught one would cache "0 products tracked" for up to a day.
- **Do not add `/contact` to the sitemap** and do not disallow it in `robots.txt` (a blocked page's `noindex` is never seen).
- **Do not write banned phrases in comments** ("live price", "real-time", "all-time high", "Invest Score", "TCGPlayer"): the conventions scan reads comments too. Likewise `alert(` and `confirm(` (WP15).
- **Do not raise `uiConventions.baseline.json`.** Counts may only go down.
- **Do not edit the Python pipeline, the weekly PDF or any migration** in this package. The weekly report's disclaimer and self-description are a separate follow-up (`01-PRODUCT-DIRECTION.md` §9 item 4); list it in the PR.
- **Do not redeclare `DAYS_PER_YEAR`, `PRODUCT_VOLATILITY_LOOKBACK_POINTS` or any other WP18 constant** in `marketMath.ts`; WP18 exports them. Step 1a only swaps two call-site literals.
- **Do not rename or stop exporting `PROMO_RELATIONSHIP_LABEL`, `STORE_NAME` or `STORE_URL`**, and keep `aria-label={PROMO_RELATIONSHIP_LABEL}` in `CardRinkPromo.tsx`: WP15's conventions test imports the first and matches the attribute text.
- **Do not add an import to `app/content/disclosures.ts`.** Client components import it; tie numbers to their source with a test instead (`PRICE_HIDDEN_AFTER_DAYS`).
- **Do not claim "no ads" or "sells no placements" in disclosure copy.** With D1 open the promo may be paid, and with D1 = paid it is a paid placement; `revenueSentence` and `INDEPENDENCE_POLICY` are worded to stay true in every scenario.
- **Do not describe returns as unbounded.** WP10's 0028 bounds the lookback price; only the catalog cards' and Market table's client fallback is unbounded, and `/methodology#returns` says exactly that.
- **Do not change the product page's structured data or meta description here.** WP13 already ships `AggregateOffer` from a fresh listings snapshot and "Daily TCGplayer Market Price"; WP31 owns the product page.

## Tests

All paths relative to `frontend/`. jsdom unless a docblock says otherwise. Tests that render `next/link` mock it:

```tsx
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
```

### 1. `app/lib/__tests__/metricDefinitions.test.ts` (new, `@jest-environment node`)

```ts
/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";
import { METHODOLOGY_SECTIONS, METHODOLOGY_SUBSECTIONS } from "../../content/methodology";
import { ALL_METRIC_DEFINITIONS, isMetricKey, METRIC_DEFINITIONS, metricHref } from "../metricDefinitions";

const APP = path.resolve(__dirname, "../..");
const ANCHORS = new Set<string>([
  ...METHODOLOGY_SECTIONS.map((s) => s.anchor),
  ...METHODOLOGY_SUBSECTIONS.map((s) => s.anchor),
]);
const BANNED = /TCGPlayer|invest score|\blive prices?\b|\breal[- ]?time\b|all[- ]time high|\u2014|\bbuy\b|\bundervalued\b/i;

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") tsxFiles(full, out);
    } else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("metric definitions", () => {
  it("has unique keys, a label, a unit, a short definition of at most 120 characters and a real anchor", () => {
    const keys = ALL_METRIC_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of ALL_METRIC_DEFINITIONS) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.unitLabel.length).toBeGreaterThan(0);
      expect(d.short.length).toBeGreaterThan(10);
      expect(d.short.length).toBeLessThanOrEqual(120);
      expect(ANCHORS.has(d.anchor)).toBe(true);
      expect(`${d.label} ${d.short}`).not.toMatch(BANNED);
    }
  });

  it("links each key to its methodology anchor", () => {
    expect(metricHref("compositeScore")).toBe("/methodology#composite-score");
    expect(metricHref("volatility30dAnnualised")).toBe("/methodology#volatility");
    expect(isMetricKey("return1m")).toBe(true);
    expect(isMetricKey("investScore")).toBe(false);
  });

  it("carries WP18's unit labels", () => {
    expect(METRIC_DEFINITIONS.volatility30dAnnualised.label).toBe("Volatility 30D (annualised)");
    expect(METRIC_DEFINITIONS.setVolatility90Daily.label).toBe("Volatility 90D (daily)");
  });

  it("every MetricTile and MetricLabel uses a defined key, and no legacy tooltip remains", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(APP)) {
      const rel = path.relative(APP, file);
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/<MetricTile\b[^>]*>/g)) {
        if (!/\bmetric=/.test(m[0])) offenders.push(`${rel}: ${m[0]}`);
      }
      for (const m of text.matchAll(/<(?:MetricTile|MetricLabel)\b[^>]*\bmetric="([^"]+)"/g)) {
        if (!isMetricKey(m[1])) offenders.push(`${rel}: unknown metric "${m[1]}"`);
      }
      if (/\bSTAT_TOOLTIPS\b|\bStatHeader\b|\bInfoIcon\b/.test(text)) offenders.push(`${rel}: legacy tooltip`);
    }
    expect(offenders).toEqual([]);
  });

  it("every /stats header except Set is a MetricLabel", () => {
    const text = fs.readFileSync(path.join(APP, "stats/page.tsx"), "utf8");
    const headers = [...text.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].trim());
    expect(headers.length).toBeGreaterThanOrEqual(28);
    for (const inner of headers) {
      if (inner === "Set") continue;
      expect(inner).toMatch(/^<MetricLabel metric="[A-Za-z0-9]+" \/>$/);
    }
  });
});
```

Step 16c keeps literal `<th>` cells. If you render a table's headers with `.map` over a key array instead, replace the last case with: every entry of that array passes `isMetricKey`, and `stats/page.tsx` contains `<MetricLabel metric={` inside a `<th`.

### 2. `app/lib/__tests__/methodologyConstants.test.ts` (new, `@jest-environment node`)

Proves the TypeScript mirrors equal the SQL and Python sources.

```ts
/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";
import { PRICE_STALENESS_TOLERANCE_DAYS } from "../marketPulse";
import * as pipeline from "../pipelineConstants";
import { RETURN_WINDOW_DAYS } from "../marketMath";
import {
  COMPOSITE_SCORE_WEIGHTS,
  MOMENTUM_WEIGHTS,
  SET_METRIC_WINDOWS,
  SQL_RETURN_ANCHOR_TOLERANCE_DAYS,
} from "../setAnalytics";

const ROOT = path.resolve(__dirname, "../../../..");
const MIGRATIONS = path.join(ROOT, "migrations");
const MAIN_PY = fs.readFileSync(path.join(ROOT, "main.py"), "utf8");

/**
 * Text of the highest-numbered NNNN_*.sql file that CREATEs `fn`. Only a
 * CREATE counts: later files that merely ALTER, GRANT or REVOKE the function
 * (0007, 0009, WP21's 0031/0032) contain no body and must not be picked.
 * 0000_baseline.sql (WP21) sorts last, so it is only a fallback.
 */
function newestDefinition(fn: string): { file: string; sql: string } {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .reverse();
  const createRe = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`, "i");
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    if (createRe.test(sql)) return { file, sql };
  }
  throw new Error(`no numbered migration creates ${fn}`);
}

function pyNumber(re: RegExp): number {
  const m = MAIN_PY.match(re);
  if (!m) throw new Error(`main.py: ${re} not found`);
  return Number(m[1].replace(/_/g, ""));
}

describe("set analytics mirrors the SQL", () => {
  const { file, sql } = newestDefinition("get_set_analytics");

  it(`composite weights equal ${file}`, () => {
    const weights: Record<string, number> = {};
    for (const m of sql.matchAll(/\(\(ss\.(\w+) - ms\.\1_mean\) \/ ms\.\1_std\) \* (-?\d+(?:\.\d+)?)/g)) {
      weights[m[1]] = Number(m[2]);
    }
    expect(weights).toEqual({ ...COMPOSITE_SCORE_WEIGHTS });
  });

  it(`momentum weights equal ${file}`, () => {
    const weights: Record<string, number> = {};
    for (const m of sql.matchAll(/coalesce\(avg\(return_(\d+)d\), 0\) \* (\d+(?:\.\d+)?)/gi)) {
      weights[`avg${m[1]}`] = Number(m[2]);
    }
    expect(weights).toEqual({ ...MOMENTUM_WEIGHTS });
  });

  it("the 14-day price gate equals PRICE_STALENESS_TOLERANCE_DAYS", () => {
    expect(sql).toContain(`current_date - ${PRICE_STALENESS_TOLERANCE_DAYS}`);
  });

  it("series windows equal get_market_product_metrics", () => {
    const metrics = newestDefinition("get_market_product_metrics").sql;
    expect(metrics).toMatch(/stddev_pop\(\s*pct_change\s*\)\s+AS\s+volatility_90d/i);
    expect(metrics).toContain(`current_date - ${SET_METRIC_WINDOWS.volatilityDays}`);
    expect(metrics).toContain(`current_date - ${SET_METRIC_WINDOWS.drawdownDays}`);
  });

  it("return anchor tolerances equal get_market_product_metrics (WP10 0028)", () => {
    const { file: metricsFile, sql: metrics } = newestDefinition("get_market_product_metrics");
    expect(metricsFile).not.toMatch(/^000[0-9]_/); // a real numbered definition, not the baseline
    for (const [label, tolerance] of Object.entries(SQL_RETURN_ANCHOR_TOLERANCE_DAYS)) {
      const days = RETURN_WINDOW_DAYS[label as keyof typeof RETURN_WINDOW_DAYS];
      // e.g. 7D: "recorded_at < current_date - 6" and "recorded_at >= current_date - 14"
      expect(metrics).toMatch(new RegExp(`recorded_at < current_date - ${days - 1}\\s+AND h\\.recorded_at >= current_date - ${days + tolerance}\\b`));
    }
  });
});

describe("pipeline constants mirror main.py", () => {
  it("equal the collector's values", () => {
    expect(pyNumber(/^PRICE_LARGE_DELTA_RATIO\s*=\s*([\d._]+)/m)).toBe(pipeline.PRICE_LARGE_DELTA_RATIO);
    expect(pyNumber(/^PRICE_CONFIRM_TOLERANCE\s*=\s*([\d._]+)/m)).toBe(pipeline.PRICE_CONFIRM_TOLERANCE);
    expect(pyNumber(/^PRICE_PENDING_MAX_AGE\s*=\s*timedelta\(hours=(\d+)\)/m)).toBe(pipeline.PRICE_PENDING_MAX_AGE_HOURS);
    expect(pyNumber(/^PRICE_ABSOLUTE_MAX_USD\s*=\s*([\d._]+)/m)).toBe(pipeline.PRICE_ABSOLUTE_MAX_USD);
    expect(pyNumber(/price_update_interval_hours\s*=\s*(\d+)/)).toBe(pipeline.PRICE_REPRICE_INTERVAL_HOURS);
    expect(pyNumber(/interval_hours=(\d+)/)).toBe(pipeline.SCRAPE_RUN_INTERVAL_HOURS);
  });
});
```

Before writing expectations, run each regex by hand against the current files (`grep -n "ss.avg30 - ms.avg30_mean" migrations/0023_price_freshness_guard.sql`, `grep -n "PRICE_LARGE_DELTA_RATIO\|price_update_interval_hours\|interval_hours=" ../main.py`). If WP11, WP16 or WP21 renamed a Python variable or moved it to another file, point the regex or the file at the new location. Never delete an assertion to get green.

### 3. `app/methodology/__tests__/MethodologyArticle.test.tsx` (new)

Renders `MethodologyArticle` with fixed values and proves the printed numbers are the code constants (the "methodology equals code" acceptance test).

```tsx
import { render, within } from "@testing-library/react";
import MethodologyArticle from "../MethodologyArticle";
import { METHODOLOGY_SECTIONS, METHODOLOGY_SUBSECTIONS, METHODOLOGY_VERSION } from "../../content/methodology";
import { ALL_METRIC_DEFINITIONS } from "../../lib/metricDefinitions";
import { DAYS_PER_YEAR, PRODUCT_VOLATILITY_LOOKBACK_POINTS, RETURN_WINDOW_DAYS } from "../../lib/marketMath";
import { PRICE_STALENESS_TOLERANCE_DAYS, PRICE_THRESHOLD_PCT, VOLUME_THRESHOLD_PCT } from "../../lib/marketPulse";
import { PRICE_LARGE_DELTA_RATIO, PRICE_PENDING_MAX_AGE_HOURS } from "../../lib/pipelineConstants";
import {
  COMPOSITE_SCORE_WEIGHTS,
  MOMENTUM_WEIGHTS,
  SET_METRIC_WINDOWS,
  SQL_RETURN_ANCHOR_TOLERANCE_DAYS,
} from "../../lib/setAnalytics";
import { PACK_VALUE_BANDS, PACK_VALUE_LABELS } from "../../components/BoxCalculator/nav";
import { axeViolations } from "@/test-utils/axe";

// next/link mock as in the Tests preamble.

const CURRENT = {
  productsTracked: 306,
  pricedRecently: 301,
  latestPriceDate: "2026-09-29",
  latestPriceStale: false,
  fxRate: 1.3612,
  fxDate: "2026-09-29",
  byType: [{ label: "Booster Box", count: 61 }],
};

function section(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`#${id}`);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

beforeEach(() => jest.useFakeTimers({ now: new Date("2026-09-30T12:00:00Z") }));
afterEach(() => jest.useRealTimers());
```

Cases:
- Every anchor in `METHODOLOGY_SECTIONS` and `METHODOLOGY_SUBSECTIONS`, and every `anchor` in `ALL_METRIC_DEFINITIONS`, exists as an element id; ids are unique.
- The provenance line contains `Version ${METHODOLOGY_VERSION}`.
- `#composite-score`: for each key of `COMPOSITE_SCORE_WEIGHTS`, the row `tr[data-weight-key="<key>"]` contains `weight.toFixed(2)`.
- `#momentum` text contains `90D × ${MOMENTUM_WEIGHTS.avg90}`, `30D × ${MOMENTUM_WEIGHTS.avg30}` and `1Y × ${MOMENTUM_WEIGHTS.avg365}`.
- `#returns`: for each `[label, days]` of `RETURN_WINDOW_DAYS`, `tr[data-window="<label>"]` contains `String(days)`; for each `[label, tolerance]` of `SQL_RETURN_ANCHOR_TOLERANCE_DAYS` the same row contains `${RETURN_WINDOW_DAYS[label] + tolerance} days ago` (7D: "14 days ago", 1Y: "379 days ago"); `tr[data-window="1D"]` contains "any age".
- `#volatility`: `tr[data-vol="product"]` contains `String(PRODUCT_VOLATILITY_LOOKBACK_POINTS)` and `√${DAYS_PER_YEAR}`; `tr[data-vol="set"]` contains `String(SET_METRIC_WINDOWS.volatilityDays)`; the section contains `Math.sqrt(DAYS_PER_YEAR).toFixed(1)`.
- `#freshness` contains `${PRICE_STALENESS_TOLERANCE_DAYS} days`.
- `#market-pulse`: `tr[data-signal="demand_surge"]` contains `+${PRICE_THRESHOLD_PCT}%` and `+${VOLUME_THRESHOLD_PCT}%`; `tr[data-signal="cooling"]` contains `-${PRICE_THRESHOLD_PCT}%` and `-${VOLUME_THRESHOLD_PCT}%`.
- `#box-nav`: `tr[data-band="buy"]` contains `PACK_VALUE_LABELS.buy` and `-${Math.abs(PACK_VALUE_BANDS.belowMaxPercent)}%`; `tr[data-band="avoid"]` contains `+${PACK_VALUE_BANDS.nearMaxPercent}%`.
- `#plausibility` contains `${PRICE_LARGE_DELTA_RATIO} times` and `${PRICE_PENDING_MAX_AGE_HOURS} hours`.
- Current values: "306", "301", "Sep 29, 2026" and "1.3612" appear, and no "Last priced" text; with `fxRate: null, fxDate: null` the USD to CAD value is `--` and "Rate unavailable" is shown; with `latestPriceDate: "2026-09-25", latestPriceStale: true` a `time[datetime="2026-09-25"]` with visible text "Last priced Sep 25" is shown.
- `#composite-score` text contains "Top" and "Bottom" and "never"; `#plausibility` contains `1/${PRICE_LARGE_DELTA_RATIO}`.
- `#coverage` has a link whose `href` starts with `/contact?topic=missing_product`.
- No text node contains an em dash (U+2014), "Invest Score" or "TCGPlayer".
- `expect(await axeViolations(container)).toEqual([])` (run it with real timers: call `jest.useRealTimers()` first in that case).

### 4. `app/lib/__tests__/setAnalytics.test.ts` (new)

- `compositeTopPercent(1, 58)` is 2; `(6, 50)` is 12; `(50, 50)` is 100; `(1, 1000)` is 1 (floor of 1%); `(null, 10)`, `(0, 10)`, `(11, 10)`, `(1.5, 10)`, `(1, 0)` are null.
- `formatCompositePercentile(6, 50)` is `"Top 12%"`; `(25, 50)` is `"Top 50%"`; `(26, 50)` is `"Bottom 50%"`; `(50, 50)` is `"Bottom 2%"`; `(58, 58)` is `"Bottom 2%"`; `(1, 2)` is `"Top 50%"`; `(2, 2)` is `"Bottom 50%"`; `(1, 1)` is `"Top 100%"`; `(null, 50)` and `(0, 50)` are `"--"`. No output ever reads `"Top 100%"` when `rankedCount > 1` (loop rank 1 to 60 over `rankedCount` 60).
- `SQL_RETURN_ANCHOR_TOLERANCE_DAYS` keys are a subset of `Object.keys(RETURN_WINDOW_DAYS)` and exclude `"1D"`.
- Weights sum check (documents the design, not a rule): the positive weights sum to 1.2 and the negative to -0.35 (`toBeCloseTo`).

### 5. `app/content/__tests__/disclosures.test.ts` (new, node)

- `disclosureCopy(null)`: label "Partner store", `relationshipSentence` null, rel without "sponsored".
- `"owned"`, `"paid"`, `"unpaid"`: labels "From the team behind Pokéfin", "Sponsored", "A shop we like"; each sentence contains "CardRinkTCG.ca" and "never affects"; only `"paid"` has `rel` containing `sponsored` and suffix " (sponsored)".
- `inventorySentence(null, null)` contains "may hold"; `(true, "owned")` contains "holds inventory" and "sells many"; `(false, null)` contains "does not hold".
- Every exported string (`FOOTER_DISCLAIMER`, `DECISION_NOTE`, both trademark notices, `PROVENANCE_SENTENCE`, `INDEPENDENCE_POLICY` lines, all three scenarios' copy) matches none of `/\u2014|TCGPlayer|\blive\b|real[- ]?time/i`, and none contains "recommend" except `DECISION_NOTE`'s "not recommendations".
- `PRICE_HIDDEN_AFTER_DAYS` equals `PRICE_STALENESS_TOLERANCE_DAYS` (import it from `../../lib/marketPulse` in the test only), and `PROVENANCE_SENTENCE` contains `${PRICE_STALENESS_TOLERANCE_DAYS} days`.
- `PROMO_RELATIONSHIP_LABEL` equals `DISCLOSURE.promoLabel`, and `DISCLOSURE` equals `disclosureCopy(STORE_RELATIONSHIP)`.
- `revenueSentence`: `null` and every scenario start with "Pokéfin is free."; `null` does not contain "ads"; `"paid"` contains "CardRinkTCG.ca"; `"owned"` and `"unpaid"` contain "no third-party ads".
- No `INDEPENDENCE_POLICY` line contains "sells no placements" (it would contradict a paid placement).

### 6. `app/lib/__tests__/contactLink.test.ts` and `app/contact/__tests__/mail.test.ts` (new, node)

`buildContactHref`:
- `{ topic: "wrong_price", productId: 42, from: "/product/42" }` gives `/contact?topic=wrong_price&product=42&from=%2Fproduct%2F42`.
- `productId` 0, -1, 1.5 and `NaN` are dropped; `from` `"//evil.com"`, `"https://evil.com"` and a 201-character path are dropped; `digest` `"abc<script>"` is dropped, `"a1b2_c3-d4"` kept; `query` is trimmed and cut to 100 characters.
- `isContactTopic("wrong_price")` true, `"refund"` false.

`parseContactParams`:
- Round trip: `parseContactParams(Object.fromEntries(new URLSearchParams(buildContactHref(x).split("?")[1])))` gives the same topic, id, from, query and digest for a valid `x`.
- `{ topic: "bogus" }` gives `topic: null`; `{ product: "042" }` gives `productId: null`; `{ from: "/%2F%2Fevil.com" }` and `{ from: "/contact?topic=x" }` give `from: null`; `{ from: "/" }` gives `"/"`; `{ q: "abc\u0000def" }` has no control character; arrays take the first value.

`buildMailto`:
- `("wrong_price", ctx(productId 42, from "/product/42"), "Prismatic Evolutions Elite Trainer Box", "https://pokefin.ca")`: `address` is `reports@pokefin.ca`; `subject` is `[Pokéfin] Wrong price: Prismatic Evolutions Elite Trainer Box`; `body` contains `Page: https://pokefin.ca/product/42` and `Product: Prismatic Evolutions Elite Trainer Box (id 42)` joined by `\r\n`; `href` starts with `mailto:reports@pokefin.ca?subject=` and `decodeURIComponent` of its `body=` part equals `body`; `href` contains `%0D%0A` and no raw space or newline.
- `"idea"` goes to `hello@pokefin.ca`; unknown product name prints `product 42` in the subject.

### 7. `app/contact/__tests__/page.test.tsx` (new)

Mock `../../lib/serverMarketData` (`getCachedMarketProductSummaries` resolving to one product id 42 with set "Prismatic Evolutions" and type label "Elite Trainer Box") and `next/link`. Set `NEXT_PUBLIC_SITE_URL=https://pokefin.ca` (save and restore). Cases:
- `render(await ContactPage({ searchParams: Promise.resolve({ topic: "wrong_price", product: "42", from: "/product/42" }) }))`: heading "A price looks wrong"; a link named "Email reports@pokefin.ca" with a `mailto:` href; the text "Prismatic Evolutions Elite Trainer Box (id 42)"; five other topic links; no `<form>` and no `<input>` in the document.
- `searchParams: {}`: heading "What is it about?" and six topic links.
- The summaries mock rejecting: the page still renders with "Product (id 42)".
- `metadata.robots` equals `NO_INDEX`.

### 8. `app/components/ui/__tests__/MetricLabel.test.tsx`, `ReportLink.test.tsx`, `DecisionNote.test.tsx` (new)

- `MetricLabel metric="compositeScore"`: text "Composite score"; one link with `href="/methodology#composite-score"`, `title` equal to the definition's `short`, accessible name "How Composite score is calculated"; axe clean. `hideLink`: no link, `title` on the span.
- `ReportLink topic="wrong_price" productId={42} from="/product/42"`: text "Price look wrong? Report it", `href` as in test 6, `rel="nofollow"`; custom children replace the text; axe clean.
- `DecisionNote anchor="box-nav"`: text starts with "Screens describe past prices. They are not recommendations."; link "How we calculate this" to `/methodology#box-nav`.

### 9. `app/components/__tests__/Footer.test.tsx` (new)

Mock `next/navigation` (`usePathname`) and `next/link`.
- Pathname `/prices`: renders a `contentinfo` landmark containing `FOOTER_DISCLAIMER`, `POKEMON_TRADEMARK_NOTICE`, `TCGPLAYER_TRADEMARK_NOTICE`; links to `/methodology`, `/about`, `/contact`, `/terms`, `/privacy`; the store link has `rel` equal to `DISCLOSURE.storeLinkRel`; the relationship sentence is present exactly when `DISCLOSURE.relationshipSentence` is not null; no text "TCGPlayer" or "hourly"; the column headings are `h2` ("Explore", "Account", "Pokéfin"); every `next/link` link carries `data-prefetch="false"` (extend the preamble mock to render `data-prefetch={String(prefetch)}`; WP27 asserts the same attribute); the copyright line contains the current UTC year; `expect(await axeViolations(container)).toEqual([])`.
- Pathname `/auth/login`: the container is empty.

### 10. `app/stats/__tests__/page.test.tsx` (new)

Mock `../../lib/serverMarketData` (`getCachedSetAnalytics` resolving to three rows: ranks 1 and 2 with `investScore` 1.87 and -0.4, one with `rank: null, investScore: null`; fill the other numeric fields with small numbers or null) and `next/link`. `render(await StatsPage())`:
- No text "Invest Score"; at least one header link to `/methodology#composite-score`.
- The rank-1 row shows "Top 50%" with `title` containing "Composite z-score 1.87" and "rank 1 of 2"; the rank-2 row "Bottom 50%"; the unranked row "--"; no cell reads "Top 100%".
- The decision note text and its link to `/methodology#composite-score` are present.
- The provenance line contains "TCGplayer Market Price in USD".

If `StatsPage` renders `CardRinkPromo` and that import fails in jsdom, mock `../../components/CardRinkPromo` to return null.

### 11. `app/lib/__tests__/jsonLd.test.ts` (new, node)

Set `NEXT_PUBLIC_SITE_URL=https://pokefin.ca` (save and restore).
- `serializeJsonLd({ name: "</script><script>x</script>" })` contains no `<` and parses back to the same object.
- `buildBreadcrumbJsonLd([{name:"Home",path:"/"},{name:"Methodology",path:"/methodology"}])`: positions 1 and 2, items `https://pokefin.ca` and `https://pokefin.ca/methodology`.
- `buildArticleJsonLd(...)`: `@type` "Article", `dateModified` as passed, `publisher.name` "Pokéfin"; `author["@type"]` is "Organization" while `OPERATOR.name` is null.
- `buildAboutPageJsonLd()`: `mainEntity["@type"]` "Organization", `email` "hello@pokefin.ca", no `logo` key.
- WP13's `productMeta.test.ts` still passes (it imports `serializeJsonLd` through the re-export).

### 12. Updates to existing tests

- `app/components/BoxCalculator/__tests__/nav.test.ts` (WP17): add `PACK_VALUE_LABELS` equals `{ buy: "Below pack value", hold: "Near pack value", avoid: "Above pack value" }`; at retail exactly `100 * (1 + PACK_VALUE_BANDS.belowMaxPercent / 100)` with one pack at 100 the signal is "buy", and at `100 * (1 + PACK_VALUE_BANDS.nearMaxPercent / 100)` it is "hold"; `packValueBandsText()` contains "10% or more under NAV" and "more than 5% over". Existing cases unchanged.
- `app/__tests__/sitemap.test.ts` (WP13): the URL list also contains `https://pokefin.ca/methodology`, `/about` and `/terms`; the hidden list gains `/contact`.
- `app/components/__tests__/NoResults.test.tsx` (WP13): add: a link "Missing a product? Tell us" whose `href` starts with `/contact?topic=missing_product` and, with `query="zzz"`, contains `q=zzz`.
- Tests touched by the sweeps in steps 20 and 21 (text assertions only).
- `app/__tests__/uiConventions.test.ts`: extended in step 22.

## Verification

Run from `frontend/`.

```bash
# 1. Types, lint, tests
pnpm exec tsc --noEmit                               # exit 0
pnpm run lint                                        # 0 errors, 0 new warnings (blocking since WP17)
pnpm exec jest app/lib/__tests__/metricDefinitions.test.ts app/lib/__tests__/methodologyConstants.test.ts \
  app/lib/__tests__/setAnalytics.test.ts app/lib/__tests__/contactLink.test.ts app/lib/__tests__/jsonLd.test.ts \
  app/content app/contact app/methodology app/stats app/components/ui app/components/__tests__/Footer.test.tsx \
  app/components/__tests__/NoResults.test.tsx app/components/BoxCalculator app/__tests__
                                                     # all pass
pnpm test --ci                                       # full suite passes; suite count = base + 14 new files

# 2. Static checks, each expected to print nothing
grep -rn "TCGPlayer" app --include=*.ts --include=*.tsx
grep -rn -e $'\xe2\x80\x94' -e '&mdash;' -e '&#8212;' -e '\\u2014' app --include=*.tsx | grep -v __tests__
grep -rniE "invest score|live price|real-time|all-time high" app --include=*.ts --include=*.tsx | grep -v __tests__
grep -rn "Good Deal\|Fair Price\|Overpriced" app --include=*.ts --include=*.tsx
grep -rn "STAT_TOOLTIPS\|StatHeader\|<MetricTile label=" app --include=*.tsx
grep -n "\* 0\.[0-9]" app/lib/serverMarketData.ts
grep -rn "outline-none" app/methodology app/about app/terms app/contact app/privacy app/components/Footer.tsx \
  app/components/trust app/components/ui/MetricLabel.tsx app/components/ui/ReportLink.tsx app/components/ui/DecisionNote.tsx
grep -rln '"use client"' app/methodology app/about app/terms app/contact app/privacy app/components/Footer.tsx \
  app/components/trust app/components/ui/MetricLabel.tsx app/components/ui/ReportLink.tsx app/components/ui/DecisionNote.tsx
grep -n "^import" app/content/disclosures.ts

# 3. Stub build (empty catalog): proves the pages build without data
pnpm build:stub                                      # "[build:stub] next build exited with 0"
# Route table: /methodology, /about, /terms, /privacy show as static or ISR (○, revalidate 1d where it
# applies); /contact is dynamic (ƒ).

# 4. Perf build (WP22's realistic fixture: 306 products, 55 sets, FX row). Every check below runs on it,
#    because the plain stub has no set analytics (/analytics shows its "unavailable" notice) and no FX row.
SUPABASE_STUB_FIXTURE=perf pnpm build:stub
# Prerendered HTML is often one long line, so count matches with grep -o, not lines with grep -c.
grep -o 'id="composite-score"' .next/server/app/methodology.html | wc -l               # 1
grep -o 'data-window="1Y"' .next/server/app/methodology.html | wc -l                   # 1
grep -o 'type="application/ld+json"' .next/server/app/methodology.html | wc -l         # 2
grep -o '"@type":"Article"' .next/server/app/methodology.html | wc -l                  # 1
grep -o 'type="application/ld+json"' .next/server/app/about.html | wc -l               # 2
grep -o 'Market data for information only' .next/server/app/privacy.html | wc -l       # >= 1 (footer is server HTML)
grep -o 'Speed Insights' .next/server/app/privacy.html | wc -l                         # >= 2 (Analytics section and Vercel bullet; N06)
grep -oE 'rotated on every request|leave the server' .next/server/app/privacy.html | wc -l   # 0 (N06)
grep -o 'href="/methodology#[a-z-]*"' .next/server/app/analytics.html | sort -u | wc -l   # >= 10
grep -oE '(Top|Bottom) [0-9]+%' .next/server/app/analytics.html | wc -l                # >= 1
# If a path differs, list .next/server/app/*.html and use the route's file.

# 5. Sitemap, robots and /contact, through WP22's front door (port 3100 proxies to next start)
node scripts/perf-serve.mjs &                         # note the PID; wait for "ready"
curl -s http://127.0.0.1:3100/sitemap.xml | grep -oE "/(methodology|about|terms)</loc>" | wc -l   # 3
curl -s http://127.0.0.1:3100/sitemap.xml | grep -o "/contact" | wc -l                               # 0
curl -s "http://127.0.0.1:3100/contact?topic=wrong_price&product=900001&from=/product/900001" | grep -c 'name="robots" content="noindex'   # 1
curl -s "http://127.0.0.1:3100/contact?topic=wrong_price&product=900001&from=/product/900001" | grep -c 'mailto:reports@pokefin.ca'      # >= 1
curl -s "http://127.0.0.1:3100/contact?topic=wrong_price&from=//evil.com" | grep -c "evil.com"                                          # 0

# 6. Performance budgets (WP22), same server
pnpm perf:budget --write-limits                       # fills the four new routes' limits only
pnpm perf:budget | tee /tmp/wp24-budget-after.txt     # exit 0
kill <PID>
diff /tmp/wp24-budget-before.txt /tmp/wp24-budget-after.txt
```

Expected in the budget comparison: shared JS lower (the footer's code and copy left the client bundle); `/methodology`, `/about`, `/terms` and `/contact` `jsGzKb` within 0.3 kB of `/privacy` (no route-specific client JS); `/methodology` document under 30 kB br; CSS within 1 kB of before; every existing route's `documentBrKb` up by at most 1.5 kB br (the footer tree now in the inline RSC payload) and `jsGzKb` equal or lower. If an existing route's `documentBrKb` fails only by that footer growth, raise that one limit by the measured delta and add `Perf budget raise: routes.<route>.documentBrKb footer server-rendered (WP24), shared JS down <n> kB` to the PR body (WP22's raise rule). Any other breach, or a growth above 1.5 kB br, is a bug in this PR: find the cause, do not raise. Commit the updated `perf-budgets.json`.

Manual checks (`pnpm dev` against the stub, or the Vercel preview), at 390x844 and 1440x900:

1. `/methodology`: current values box shows four figures; the "On this page" `<details>` is closed on the phone and the sticky list shows on desktop; clicking "Composite score" lands with the heading below the sticky header; tables fit at 390 px without horizontal page scroll; no em dash on the page.
2. `/stats` (served at `/analytics`): every header has a "?" that opens `/methodology#<anchor>`; hovering shows the short definition; the composite column shows "Top N%" in the upper half and "Bottom N%" below, with the z-score in the tooltip; the decision note sits under the top table.
3. A product page: every tile label has a "?"; "Price look wrong? Report it" under the price opens `/contact` with the product named and the mailto button working (it opens the mail app with subject and body filled).
4. `/box-calculator`: build a recipe; the result reads "Below pack value", "Near pack value" or "Above pack value" with the bands line and the decision note, on a neutral background.
5. `/prices` with a search that matches nothing: "Missing a product? Tell us" appears under "Clear filters".
6. Footer on any page: disclaimer, trademark lines, Methodology, About, Contact, Terms, Privacy links; no footer on `/auth/login`.
7. `/about`, `/terms`, `/privacy`: headings and anchors, all links work, 16 px prose, no horizontal scroll at 390 px.
8. Keyboard only on `/stats`: Tab reaches each "?" with a visible focus ring; VoiceOver or NVDA reads "How Avg 90D is calculated, link".

## Owner actions

Before merge (the PR stays in draft until these are answered in the PR thread; the executor then sets the constants in `app/content/disclosures.ts` and pushes):

1. **D1**: which is true: A (you own or co-own CardRinkTCG.ca), B (it pays Pokéfin for the placement or a commission) or C (a personal connection, no payment)? And do you, or the store, hold inventory of products Pokéfin tracks (yes, no)? If WP15 already recorded your answer, step 2 carries it over and you only confirm it. If you do not answer, the PR merges with the neutral fallback ("Partner store", no relationship sentence, no "no ads" claim, "may hold inventory") and this stays open.
2. **D2**: the name or named pseudonym to show on `/about`, plus city and province. The province also sets the governing law in `/terms`. Default if unanswered: no name ("an independent, personal project run from Canada"), an `Organization` author in the JSON-LD, and the generic governing-law clause; the PR says D2 is open.
3. **D5**: confirm the renamed labels ("Composite score" shown as Top or Bottom N% of ranked sets; "Below / Near / Above pack value"). Default if unanswered: ship the renames (they remove advice-sounding labels, `01-PRODUCT-DIRECTION.md` §6.2); the Rollback section reverts only the strings if you later reject them.
4. **Email forwarding** (free): make `hello@pokefin.ca`, `reports@pokefin.ca` and `privacy@pokefin.ca` deliver to your inbox (registrar forwarding, ImprovMX free tier, or Cloudflare Email Routing). Send one test email to each before merge; the contact page and the privacy policy point at them. No default: the PR does not merge until all three deliver, because unanswered reports and privacy requests would bounce.

After merge:

5. Have `/terms` and `/privacy` read once by a Canadian lawyer (`research/trust-seo-brand.md` §8, §9).
6. Check TCGplayer's "TCGplayer Market Price" help article and confirm the `#market-price` paragraph; if you want the article's exact description (recency weighting, outlier handling), ask for a follow-up that bumps the methodology's minor version.
7. Confirm `LISTINGS_HISTORY_START` with `SELECT min(snapshot_date) FROM public.product_listings_history;` in the Supabase SQL editor; if it differs from 2026-07-07, report the date for a one-line fix.
8. Optional: in Google Search Console, request indexing for `/methodology` and `/about`.

## Acceptance criteria

- [ ] `/methodology` exists, is server-rendered with no route-specific client JS, shows "Version 1.0" with an effective date and a change log, has every anchor listed in Design (21 sections and 5 sub-sections), a current values box, and `Article` plus `BreadcrumbList` JSON-LD through `serializeJsonLd`.
- [ ] Every window, threshold and weight on `/methodology` is interpolated from an exported constant; `MethodologyArticle.test.tsx` and `methodologyConstants.test.ts` pass (composite and momentum weights equal the newest SQL `CREATE` of `get_set_analytics`, the 14-day gate, series windows and the five return anchor tolerances match the newest `CREATE` of `get_market_product_metrics` (0028), the collector constants match `main.py`). `#returns` states the bound and the catalog and Market table fallback that lacks it.
- [ ] `/about` (with `AboutPage` and `Organization` JSON-LD), `/terms` and a rewritten `/privacy` (PIPEDA, Vercel Web Analytics and Speed Insights with what they record, Brevo, `privacy@pokefin.ca`, no "rotated on every request" or "leave the server" claim, N06) exist; `/contact` is `noindex`, validates `topic`, `product`, `from`, `q`, `digest`, and renders `mailto:` links to `reports@` and `hello@` with prefilled subject and body; there is no form.
- [ ] `app/lib/metricDefinitions.ts` holds `{ key, label, unitLabel, window, short, anchor }` for every `/stats` column and product tile; `STAT_TOOLTIPS`, `StatHeader` and WP14's local array are gone; the test proves every `MetricTile`, `MetricLabel` and `/stats` header resolves to a defined key and anchor.
- [ ] `MetricLabel`, `ReportLink` and `DecisionNote` exist in `components/ui/`, token-only, no `"use client"`, with axe-clean tests.
- [ ] `/stats` shows "Composite score" as "Top N%" for the better half and "Bottom N%" for the rest (never "Top 100%" with more than one ranked set) with the z-score in `title`, and the decision note under the composite table; the box calculator shows "Below / Near / Above pack value" with the band text and the decision note on a neutral surface; internal names unchanged.
- [ ] `ReportLink` appears in the product hero, `NoResults`, `error.tsx` (with pathname and digest) and `global-error.tsx` (with digest).
- [ ] The footer is a server component (only `FooterGate` is client), shows the disclaimer, both trademark notices, the D1 sentence when set, and links to Methodology, About, Contact, Terms, Privacy with `prefetch={false}`.
- [ ] The promo label (through WP15's `PROMO_RELATIONSHIP_LABEL`, still exported and still the promo's `aria-label`), footer sentence, `/about#disclosures` revenue and relationship sentences and store link `rel` all come from `disclosureCopy(STORE_RELATIONSHIP)`; with D1 open the promo says "Partner store", no relationship sentence renders and no copy claims "no ads". `app/content/disclosures.ts` has no imports; WP15's conventions tests pass unchanged.
- [ ] No "TCGPlayer", "Invest Score", "live price", "real-time" or "all-time high" under `app/`, no em dash in `app/**/*.tsx` (character, entity or `\u2014` escape), no `outline-none` or `transition-colors` in the trust files, enforced by `uiConventions.test.ts`; the WP23 baseline only went down.
- [ ] `sitemap.xml` lists `/methodology`, `/about`, `/terms` and not `/contact`.
- [ ] `tsc`, lint, the full Jest suite and `pnpm build:stub` pass; `pnpm perf:budget` exits 0 with the four new routes budgeted and within 0.3 kB of `/privacy` JS, shared JS lower than before, and no existing route's document up by more than 1.5 kB br.

## Rollback

`git revert <merge commit>` and redeploy. No migration, environment variable or data change. Partial rollbacks, each in a new commit:

- Label renames only (the owner rejects D5 after merge): restore the old strings in `PACK_VALUE_LABELS` and the `compositeScore` definition's label, and remove "invest score" from the conventions ban; the percentile display can stay or revert with `CompositeCell`.
- Footer only: `git checkout <merge>~1 -- app/components/Footer.tsx`, delete `FooterGate.tsx`, and remove `components/Footer.tsx` from `TRUST_FILES` in the conventions test; regenerate the WP23 baseline: the old footer's `--pf-pokeball` hovers raise `Footer.tsx`'s `brandRed` count back to its pre-WP24 value, which is a raise, so state it in the PR body. Delete `app/components/__tests__/Footer.test.tsx` in the same commit (it asserts the WP24 footer).
- A trust page with a legal problem: delete that page directory and its sitemap entry; the footer link then 404s until removed from `TRUST_LINKS` in the same commit.

## Commit and PR

Branch: `remediation/wp24-trust-pages-and-disclosure`.

Commit message:

```text
feat(trust): methodology, about, terms, contact, metric definitions, disclosure

Nothing on the site said where prices come from, how metrics are computed,
who runs it or how the promoted shop relates to it, and "Invest Score" and
"Good Deal" read as advice.

- /methodology v1.0: every window, threshold and weight interpolated from
  code constants (marketMath, marketPulse, box nav, SQL and main.py
  mirrors with drift tests), current values box, change log, JSON-LD.
- /about, /terms, /contact (noindex, prefilled mailto, no backend), and a
  PIPEDA privacy policy naming Vercel Analytics, Speed Insights and Brevo.
- lib/metricDefinitions.ts replaces the /stats tooltips; MetricLabel links
  every /stats header and product tile to its methodology anchor.
- Composite score shown as a percentile; box verdicts are Below, Near or
  Above pack value with their bands; one-line decision note.
- ReportLink in the product hero, empty results and error boundaries.
- Server-rendered footer with disclaimer, trademark notices and the store
  relationship from content/disclosures.ts; promo label from the same source.
- TCGplayer spelling, no em dashes in TSX, banned advice and intraday words
  enforced by uiConventions; sitemap and perf budgets for the new routes.
```

PR title: `feat(trust): methodology, trust pages, metric definitions and disclosure (WP24)`

PR body:
- Goal in two sentences and a link to this spec.
- Owner decisions: the D1, D2 and D5 answers as set in `disclosures.ts`, or "D1 open: promo keeps 'Partner store', footer sentence omitted" (and the same for D2).
- Screenshots at 390 and 1440 px: `/methodology` (top and the composite section), `/about`, `/contact?topic=wrong_price&product=<id>&from=/product/<id>`, the footer, `/analytics` headers with the "?" links, the box calculator result.
- Verification output: tsc, lint, Jest summary, the static greps, `build:stub` route table, the built-HTML greps, `perf:budget` before and after with the four new routes.
- The `uiConventions.baseline.json` diff (counts down only).
- Lists: every file changed by the TCGplayer sweep and the em dash sweep; any `TCGPlayer` line deliberately kept and why; any test assertion changed and why; any dependency artifact that was missing and what was done.
- Owner actions 1 to 8 copied from the spec.
- "Noticed, out of scope": the weekly PDF's self-description and disclaimer (`generate_weekly_report.py`, `01-PRODUCT-DIRECTION.md` §9 item 4); the catalog cards (`ReturnMetrics`) and the Market table (`buildRows`) fill a NULL database return from loaded history with no anchor-age bound, so they can show a return the product page and Set Analytics withhold (documented on `/methodology#returns`; WP30 and WP33 move those views to WP25's bounded `product_daily_stats`); the Market table's "Vol 30D (ann.)" header is not yet a `MetricLabel` (WP33 replaces the table).
