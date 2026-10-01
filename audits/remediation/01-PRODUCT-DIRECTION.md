# Pokéfin Product Direction (Track 2: product excellence)

Date: 2026-09-30. Status: proposed. Specs WP22 to WP37 are written on this direction; owner approval is decision ACCEPT-DIRECTION in `00-PLAN.md`.

The remediation plan (`00-PLAN.md`, WP00 to WP21) fixes defects. This document sets where the product goes once those land: what Pokéfin is for, how it looks and behaves, how pages connect, which features make it best in class, the bars for speed and trust, and what it will not do. Every claim is grounded in the five research files in `research/` and the 2026-09-25 review. Citations use the form `file.md §section`.

Research files:
- `research/ui-audit.md` (rendered-site audit, phone and desktop)
- `research/competitive-landscape.md` (competitors and finance-UX patterns)
- `research/data-opportunities.md` (what the collected data supports)
- `research/performance-excellence.md` (budgets, CI enforcement, RUM, PWA)
- `research/trust-seo-brand.md` (credibility, disclosure, SEO, brand)

---

## 1. Vision

Pokéfin is the decision tool for people who buy, hold and sell sealed Pokémon TCG product as an asset: Canadian collector-investors first, and anyone who wants the sealed market read with a finance desk's discipline. It does one job better than anyone: for any sealed product, answer "is this cheap relative to its own history, its MSRP and the market, and can I get out of it?", with every number dated, sourced, in Canadian dollars at the right rate, and withheld rather than guessed when the data cannot support it. No competitor combines price history, supply depth, risk metrics, a benchmark and a portfolio for sealed product, and none of them does CAD properly (competitive-landscape.md §2 "Sealed-specific niche", §3a, §5). Positioning line: "Koyfin for sealed Pokémon, in Canadian dollars, free" (competitive-landscape.md §5).

## 2. Product principles

1. **Every number is dated, sourced and defensible.** A price shows the TCGplayer day it describes. A metric links to its formula. When the input is stale, the output is `--` with the reason, everywhere: page HTML, JSON-LD, share cards, CSV, alert emails, index constituents. Integrity already beats every competitor; the work is making it visible (trust-seo-brand.md §1 items 1 and 3, §5; ui-audit.md "First-time visitor comprehension").
2. **Lead with the decision, not the data dump.** Each page answers one question first (is the market up, what should I look at, is this product cheap, am I beating the market) and puts supporting detail below. The product page is a decision page, not a dead end (ui-audit.md "The 10 highest-leverage" items 4 and 7; competitive-landscape.md §4 item 2).
3. **Honest about cadence.** Prices move once a day. Changes are day over day, alerts are a daily digest, nothing is called live, real-time or all-time. A metric the data cannot support (CAGR on 40 days, an "all-time" high on one year of history) is not printed (competitive-landscape.md §6; data-opportunities.md §3.3; ui-audit.md item 8).
4. **Canadian by default, USD one tap away.** CAD is the default display, historical CAD uses the Bank of Canada rate of that day, and portfolio cost basis is in the currency the buyer paid (data-opportunities.md §1 item 2, §3.14; competitive-landscape.md §5 item 1).
5. **Fast on a phone at a card show.** Server-rendered HTML, no charting library on browse pages, budgets that fail CI, and a one-thumb list layout for every dataset (performance-excellence.md §1, §3; ui-audit.md "Mobile").

---

## 3. Visual language

The foundation exists (tokens in `globals.css`, white cards, Geist) but it is not a system: red does four jobs, three segmented controls are reinvented, badges are everywhere, density is consumer-shop (ui-audit.md "Cross-cutting: Visual language"). WP14 and WP15 fix contrast and drift inside the current look. WP23 sets the look below, and every later package builds from its components.

### 3.1 Type

One family: Geist Sans through `next/font`. Geist Mono is dropped; set codes use `tabular-nums tracking-wide uppercase` (performance-excellence.md §9 item 2). Every number is tabular.

| Role | Size / line height | Weight | Use |
|---|---|---|---|
| Display | 32 / 40 | 600 | Product price, index level on the home header |
| H1 | 24 / 32 | 600 | Page title (full product name on product pages) |
| H2 | 20 / 28 | 600 | Section titles |
| H3 | 16 / 24 | 600 | Card and table-group titles |
| Body | 14 / 20 | 400 | Tables, lists, UI text |
| Prose | 16 / 26 | 400 | Methodology, about, terms |
| Small | 13 / 18 | 400/500 | Secondary lines, table subtitles |
| Caption | 12 / 16 | 400 | "as of" stamps, footnotes. Nothing smaller than 12 px |

Inputs are 16 px on phones to stop iOS focus zoom (performance-excellence.md §13.1).

### 3.2 Colour roles

Values stay in `globals.css`; the change is that each colour has one job (ui-audit.md "Visual language"; trust-seo-brand.md §14.3).

| Role | Token (WP23) | Value | Rule |
|---|---|---|---|
| Brand | `--pf-accent` | `#dc2626` | Logo mark and the accent "é" only. Never a button, never text on data, never the promo |
| Action | `--pf-action` | `#2563eb` (hover `#1d4ed8`) | Primary buttons, links, focus ring, selected segment. One primary action per view |
| Gain | `--pf-gain-text` | `#047857` | Positive change text, always with a ▲ glyph |
| Loss | `--pf-loss-text` | `#be123c` | Negative change text, always with a ▼ glyph |
| Flat | `--pf-ink-soft` | `#475569` | Changes inside the ±0.05% dead band |
| Warning | `--pf-warn-text` / `--pf-warn-fill` | `#b45309` / `#fffbeb` | Stale price, delayed pipeline, provisional index day |
| Ink / soft ink | `--pf-ink` / `--pf-ink-soft` | `#0f172a` / `#475569` | Text. Slate-400 is never used for text (WP14) |
| Surface / page / border | `--pf-surface` / `--pf-bg` / `--pf-border` | `#fff` / `#f8fafc` / `#e2e8f0` | Cards, page, dividers |
| Chart | `--pf-chart-line`, `--pf-chart-bench`, `--pf-chart-grid`, `--pf-chart-volume` | `#1d4ed8`, `#64748b` dashed, `#e2e8f0`, `#cbd5e1` | Price line, benchmark, gridlines, volume bars |

Gain and loss colours appear only on changes and returns. A seller's "priced below market" is neutral text with an action, not red (ui-audit.md `/compare`). Colour is never the only cue: glyph plus text (WP14 rules).

### 3.3 Density and layout

- Desktop tables: 44 px rows, 40 px header, one line per row, visible sort arrow and bold header on the sorted column (ui-audit.md `/market` improvements 1 and 2).
- Phones: every dataset renders as a `DataList` of two-line rows at least 56 px tall (name and set on line one; price and change right-aligned on line two; optional 64x24 sparkline). No desktop table in a scroll box below 768 px (ui-audit.md top-10 item 1).
- Spacing on a 4 px base with an 8 px rhythm. Two radii: 8 px for controls and chips, 12 px for cards and dialogs. Borders first; shadow only on overlays.
- Badge budget: at most one badge per row. Variants are text, not pills. Group-level facts ("Special Expansion") appear once in the group header (ui-audit.md "Visual language").
- Precision: returns 1 decimal, shares and consistency as integers, money through WP07 `formatMoney` with the currency code on headline prices ("$59.99 USD", "C$82.10") (trust-seo-brand.md §14.4).
- Touch targets 44 px on coarse pointers via `pointer-coarse:` (performance-excellence.md §13.1).

### 3.4 Charts

- Browse surfaces (sparklines, index chart, set chart, risk/return scatter, share cards) are server-rendered SVG. Recharts stays lazy and only on the interactive product and portfolio charts (performance-excellence.md §7.1; competitive-landscape.md §6).
- Every chart has a visible legend, round-number ticks, an x-domain clamped to available data, and its last point labelled with its date. Volume gets its own pane and axis. History before live collection is drawn dashed with the footnote "weekly points before {date}" (ui-audit.md `/product` item 5; data-opportunities.md §2; trust-seo-brand.md §5.1).
- The price line does not change colour with direction; the change chip carries gain or loss colour.
- A benchmark (Sealed Index or set index) is one toggle away on product and portfolio charts (ui-audit.md "Charts"; competitive-landscape.md §4 item 4).
- Skeletons are flat neutral bars. A fake chart shape is never shown; absent history says "No history" (ui-audit.md `/` item 4).

### 3.5 Motion

UI transitions last at most 150 ms and animate opacity and transform only. Heavy toggles run in `startTransition` with the list dimmed while pending, so the pressed state paints on the next frame (performance-excellence.md §13.2). `prefers-reduced-motion` disables all non-essential motion. No count-up numbers, shimmer or pulsing data.

### 3.6 Dark mode: not in this track

Decision: Pokéfin stays light-only through WP37. Reasons: every new surface in this track (charts, share cards, emails, the weekly PDF) is designed light; the codebase still carries hundreds of raw palette utilities (ui-audit.md counts 459 `text-slate`); a second theme doubles visual QA across 16 packages; and the daily cadence means short sessions. WP23 makes every token semantic and sets `color-scheme: light` so browser widgets and the 404 stop half-darkening (review F093). Revisit once the conventions test proves no raw palette classes remain, at which point a dark theme is a token file plus a chart palette.

### 3.7 Brand and voice

- Replace the Poké Ball mark, which belongs to the Pokémon rights holders, with an original mark; keep the name, the "Pokéfin" wordmark and the palette (trust-seo-brand.md §14.1, owner decision D6).
- Voice: a knowledgeable collector talking to another, with a finance desk's precision. Numbers before adjectives. Approved terms: Market Price, tracked since, last priced, screens, below pack value. Banned in UI copy: live, real-time, all-time, undervalued, buy now, Invest Score, "TCGPlayer" (the source spells it TCGplayer), em dashes (trust-seo-brand.md §14.4).

---

## 4. Information architecture

### 4.1 Primary navigation

Organised by task, not by tool (ui-audit.md "Navigation and information architecture").

| Nav item | Route | Job |
|---|---|---|
| Market (logo) | `/` | Is the sealed market up, and what moved? |
| Prices | `/prices` | Find a product, browse by set. List by default, cards optional |
| Screener | `/screener` (308 from `/market`) | Rank and filter to find candidates, with presets |
| Sets | `/sets` (308 from `/analytics`, `/stats`) and `/sets/[slug]` | Where each set stands, and its products |
| Portfolio | `/portfolio`, `/portfolio/watchlist` | What I own, what I watch, my alerts. Always visible; logged-out visitors reach sign-in with a reason |
| Tools | menu | Box NAV calculator (`/box-calculator`), Seller margin check (`/compare`) |

Header right side: global search (`/` or Ctrl/Cmd-K), USD/CAD toggle bound to the WP20 `CurrencyProvider`, the data clock chip, account.

Supporting pages: `/product/[id]`, `/indices/sealed`, `/methodology`, `/about`, `/contact`, `/terms`, `/privacy`.

Prices and Screener stay separate but get distinct jobs and names. Today they are "the same data under two names" (ui-audit.md `/market`). Merging them into one three-view screen is the audit's proposal. The cheaper fix is to separate the jobs: Prices is the collector's catalog (browse, find, grouped by set), and Screener is the investor's ranked table (filter, sort, presets). That matches the Finviz and Koyfin split between quote lists and screeners (competitive-landscape.md §2 "Finance UX benchmarks") and avoids re-merging the state models that WP08 and WP19 just stabilised.

### 4.2 From discovery to decision

1. **Arrive** from search (product and set pages, WP13 metadata, WP37 hubs), a shared card (WP37 share images), the alert digest (WP35), or the home page.
2. **Orient** on `/`: index level and change, breadth, screened movers, new releases (WP32).
3. **Find** through global search (WP27), Prices (WP30) or a Screener preset such as "Off highs with thin supply" (WP33).
4. **Decide** on `/product/[id]`: price with as-of date and change chips, 52-week range, tracked high, MSRP multiple, cost per pack, exit liquidity, chart against the index (WP31).
5. **Act**: Watch, Alert me, Add to portfolio, Open in Box NAV (WP31, WP34, WP35, WP28).
6. **Return**: the daily alert digest and the signed-in "Your Pokéfin" strip on the home page bring the user back (WP32, WP34, WP35). The portfolio answers "am I beating the market, and what would I actually net on exit?" (WP36).

---

## 5. Signature features, ranked

Ranked by value to a buy, hold or sell decision, weighted by use of data Pokéfin already has.

1. **The product decision page** (WP31). A quote header with an as-of stamp and 1D/7D/30D/1Y change chips, a 52-week range bar, a tracked high "since {date}", x MSRP, cost per pack, and a liquidity line (units sold, sell-through, days of supply). The chart sits directly under the price, with a benchmark toggle. It answers the decision in one screen (competitive-landscape.md §4 item 2; ui-audit.md top-10 item 4; data-opportunities.md §3.3, §3.4).
2. **Watchlist and daily price alerts** (WP34, WP35). The largest competitive gap: every serious competitor has alerts and Pokéfin has none. It is also the retention loop. Alerts are checked once a day against fresh prices only and sent as one digest (competitive-landscape.md §4 item 1; data-opportunities.md §3.11).
3. **The Pokéfin Sealed Index and market breadth** (WP29, WP32). Equal-weighted, chain-linked daily, published for D-1, with sub-indices by product type, era and set. It becomes the home header, the reason to visit daily, and the benchmark on every product and portfolio chart. It is never called cap-weighted (data-opportunities.md §3.7; competitive-landscape.md §4 item 4; ui-audit.md top-10 item 2).
4. **Supply and liquidity intelligence** (WP25, WP33). Days of supply, sell-through, 30-day supply change and a liquidity percentile, built from listings history that no competitor surfaces, plus screener presets on top. This is the hardest thing for a competitor to copy (competitive-landscape.md §5 item 2; data-opportunities.md §3.4, §3.5).
5. **Canadian-native numbers** (WP25, WP31, WP36). CAD history and returns at the dated Bank of Canada rate, cost basis at the purchase-date rate, and a market-move vs FX-move split. It is a correctness fix as much as a feature (data-opportunities.md §3.14; competitive-landscape.md §5 item 1).
6. **Portfolio against the market, net of exit costs** (WP36). A money-matched Sealed Index benchmark ("the same money on the same days in the index"), exit value after a configurable fee assumption, days to exit per holding, and allocation by set, type and era (competitive-landscape.md §4 item 5; data-opportunities.md §3.18).
7. **Published methodology and a visible data clock** (WP24, WP27). A versioned `/methodology` with the real formulas and thresholds, an as-of stamp on every headline price, and a header chip that turns amber when collection stalls (trust-seo-brand.md §4, §5).
8. **Sealed structure analytics** (WP28). x MSRP, cost per pack and automatic box NAV for every product with known contents, and a Box NAV calculator that starts from a catalog product (competitive-landscape.md §5 item 3; data-opportunities.md §3.10, §4).
9. **Set pages** (WP37). Each set gets a page with its products, set index chart and a data-derived summary, and the set table gets a risk/return scatter. This serves both collectors' mental model and search (ui-audit.md top-10 item 6; trust-seo-brand.md §11.3).

---

## 6. The bars

### 6.1 Performance

Targets, p75, mobile, Canada (performance-excellence.md §3):

| Route | LCP | INP | CLS |
|---|---|---|---|
| `/`, `/prices`, `/product/[id]`, `/sets` | ≤ 1.8 s | ≤ 150 ms (≤ 100 ms on `/prices` filters) | ≤ 0.05 (≤ 0.02 on `/prices`) |
| `/screener` | ≤ 2.0 s | ≤ 150 ms sort | ≤ 0.05 |
| `/portfolio` | ≤ 2.5 s | ≤ 200 ms | ≤ 0.05 |

Budgets (performance-excellence.md §4): shared JS ≤ 125 kB gz, `/prices` ≤ 155 kB gz, `/product/[id]` ≤ 145 kB gz, `/prices` document ≤ 70 kB br, any lazy chunk ≤ 120 kB gz, CSS ≤ 14 kB gz, zero third-party script on public routes.

Rules for every Track 2 package:
- WP22 lands first. From then on, each package adds its new routes to `frontend/perf-budgets.json`, and a budget raise needs a stated reason in the PR.
- No charting library and no client history fetch on `/`, `/prices`, `/screener`, `/sets` or the hubs. They use WP26 baked sparklines and server SVG.
- Personal data (portfolio, watchlist) streams into a client island after the cached public shell. It never makes an ISR route dynamic.
- Every new read is an indexed read of a precomputed table (`product_daily_stats`, `market_index_daily`) cached under WP11's tags (data-opportunities.md §5).

### 6.2 Trust

- Every headline price shows the TCGplayer day it describes. Derived values inherit that stamp (trust-seo-brand.md §5.1).
- The 14-day withheld-price rule (migration 0023) holds in HTML, JSON-LD, share images, CSV exports, alert emails and index constituents. Tests use the WP00 stub's stale fixture.
- Every metric label resolves to an entry in `app/lib/metricDefinitions.ts` and links to a `/methodology` anchor. A formula or threshold change bumps the methodology version.
- The store relationship is disclosed next to the promo, in the footer and on `/about`. The store never affects rankings, screens, scores or movers (trust-seo-brand.md §7).
- Advice-sounding labels are gone: "Composite score (percentile)" replaces "Invest Score", and "Below / Near / Above pack value" replaces the box verdicts. A one-line contextual disclaimer appears where a screen or verdict is shown (trust-seo-brand.md §8).
- The header chip turns amber after 30 hours without new prices, because the collector runs on a laptop and can stop silently (trust-seo-brand.md §10.2).

---

## 7. What Pokéfin will deliberately not do

- **Card scanning, singles, graded cards, population data, a marketplace or vaulting.** All are outside the sealed-only scope (competitive-landscape.md §4, "Considered and deliberately not adopted").
- **Singles-based open-vs-hold EV.** It needs a singles catalog and pull-rate data, which is a separate data project.
- **"Live", "real-time", "intraday" or "instant alerts" framing.** The data is daily.
- **AI price predictions or buy/sell recommendations.** Without a validated model they are a liability, and the site describes past prices (competitive-landscape.md §4; trust-seo-brand.md §8).
- **"Market cap" or a cap-weighted index.** Units outstanding are unknown (data-opportunities.md §3.7).
- **"All-time high" wording.** The site says "tracked high since {date}" (data-opportunities.md §3.3).
- **Seasonality, pairwise set correlation matrices, or CAD vs USD arbitrage.** Seasonality needs two years of data, and correlation with about 52 weekly points is noise. Arbitrage needs Canadian prices, which are not collected (data-opportunities.md §3.15 to §3.17).
- **"Reprint" labels without a curated event.** Supply shocks are labelled as supply shocks (data-opportunities.md §3.9).
- **Redistributing raw TCGplayer prices as a download.** CSV exports cover the view the user sees plus Pokéfin's own derived index series (trust-seo-brand.md §9).
- **A paid tier, ads, pop-ups, interstitials or exit-intent capture.** They cost INP and trust. A future paid tier is kept for power features only (competitive-landscape.md §5).
- **Push notifications, a service worker or offline mode in this track.** These are deferred (section 10). Email is the alert channel.
- **Dark mode in this track** (section 3.6).
- **New paid services.** Brevo (free tier, already used), Vercel Cron, pg_cron and the Bank of Canada Valet API are all free.

---

## 8. Track 2 work packages

Sixteen packages, one PR each, written in the house spec format before execution. The count is above the usual 14 because two packages are pure enablers that several features share: the analytics foundation (WP25) and baked sparklines (WP26). Folding either into a feature package would push that package past 16 hours.

| ID | Package | Migrations | Effort | Runs after |
|---|---|---|---|---|
| WP22 | Performance budget gate, RUM and production smoke | none | L, 12 to 16 h | WP21, WP38 |
| WP23 | Design system foundation | none | L, 12 to 16 h | WP20 |
| WP24 | Trust pages, metric definitions, disclosure | none | M, 10 to 14 h | WP23 |
| WP25 | Market analytics foundation (daily stats, dated FX) | 0038, 0039 | L, 14 to 16 h | WP21, WP24 |
| WP26 | Server-baked sparklines and public read routes | 0040 | L, 12 to 16 h | WP22, WP23 |
| WP27 | Navigation, global search, data clock, new mark | none | L, 12 to 16 h | WP24 |
| WP28 | MSRP, pack contents, box NAV from the catalog | 0041 | M, 10 to 14 h | WP25 |
| WP29 | Pokéfin Sealed Index and breadth | 0042 | L, 14 to 16 h | WP25 |
| WP30 | Prices: dense list, mobile catalog, card anatomy | none | L, 12 to 16 h | WP26 |
| WP31 | Product decision page | none | L, 14 to 16 h | WP28, WP29 |
| WP32 | Market home dashboard | none | M, 10 to 14 h | WP27, WP29 |
| WP33 | Screener with presets (replaces Market View) | 0043 | L, 16 to 18 h | WP30 |
| WP34 | Watchlist | 0044 | M, 10 to 12 h | WP31, WP32 |
| WP35 | Daily price alerts by email | 0045 | L, 14 to 16 h | WP34 |
| WP36 | Portfolio analytics | 0046 | L, 14 to 16 h | WP29 |
| WP37 | Sets section and share cards | 0047 | L, 14 to 16 h | WP31 |

**Lanes that can run in parallel** once WP21 and WP38 (the last Track 1 package, `WP38-residual-data-layer-followups.md`) have merged:
- Shell: WP23 → WP24 → WP27 → WP32.
- Data: WP25 → WP28 and WP29 → WP31 → WP34 → WP35.
- Speed: WP22 → WP26 → WP30 → WP33.
- WP36 and WP37 start once their dependencies land.

**Migration registry.** These numbers are fixed reservations; `00-PLAN.md` (section "Migration registry") holds the full list for both tracks. WP21 owns 0031 and 0032, and its phase B may add `0033_record_production_triggers.sql` and `0034_record_production_drift.sql` (reserved even if unused). WP38 (end of Track 1, before WP22) owns 0035 to 0037. Track 2 owns 0038 to 0047 in plan order: WP25 0038 and 0039, WP26 0040, WP28 0041, WP29 0042, WP33 0043, WP34 0044, WP35 0045, WP36 0046, WP37 0047. A package keeps its number even if it merges out of order, and never takes "the next free number". Each migration grants what WP21's `pokefin_scraper` role needs itself, must pass WP21's `replay_twice` harness, and regenerates `frontend/app/types/database.ts` with WP20's `pnpm types:db`. The research files' provisional numbers (data 0033 to 0039, trust 0040 to 0043) are superseded by this registry.

---

## 9. Changes the existing specs need

These are kept small and placed in the earlier spec only where shipping without them would be wrong or would waste work.

1. **WP11:** ship an intent-only product link (`IntentLink`, which prefetches on hover after an 80 ms dwell, on focus and on pointerdown) for product grids and lists, and `prefetch={false}` on footer and auth links. Once product pages are ISR, viewport prefetch would fetch up to 306 product pages per catalog scroll (performance-excellence.md §8).
2. **WP13:** use `AggregateOffer` from a fresh listings snapshot, or omit offers. Say "Daily TCGplayer Market Price", not "Live price". Set `en_CA`, keep theme colour `#ffffff`, and spell TCGplayer correctly (trust-seo-brand.md §3).
3. **WP15:** the promo label states the real store relationship through one exported constant, and the conventions test bans "TCGPlayer", "live price" and "real-time".
4. **WP16:** correct the weekly PDF's self-description and disclaimer.
5. **WP10:** bound the age of return anchors, with a fallback to WP25 if WP10 must stay behaviour-neutral.
6. **WP18:** export its windows and factors as named constants.
7. **00-PLAN.md:** gains a Track 2 section pointing here.

The exact wording of each change is in the Track 2 plan result that accompanies this document.

---

## 10. Deferred to the next wave (with reasons)

| Item | Why not now | Source |
|---|---|---|
| Overlay compare of up to 5 products, and moving the Shopify tool off `/compare` | Useful, but the benchmark toggle (WP31) covers the most common comparison; reuses WP31's chart | competitive-landscape.md §4 item 6 |
| Scraper image derivatives, same-origin `/img`, custom loader (PX05) | Python, Storage and rewrite-cache verification; WP12 already fixes hero priority | performance-excellence.md §10 |
| Service worker, offline catalog, Web Push (PX09b/c) | Worker risk is hard to revert; needs PX05 and a stable `/api/public/catalog` (WP27) first | performance-excellence.md §12, §16 |
| React Compiler (PX08), Cache Components spike (PX10) | Low risk but independent of product goals; run after WP37 | performance-excellence.md §11, §14 |
| Weekly web edition and CASL newsletter | Needs a generator write path and consent infrastructure; alerts come first | data-opportunities.md §3.12; trust-seo-brand.md §12 |
| Type and era hubs, editorial guides | Set pages first; measure with Search Console before adding more hubs | trust-seo-brand.md §11 |
| `/status`, `scrape_runs`, site notices, a stored feedback form | The WP27 chip (from price timestamps), WP22's smoke test and WP24's prefilled contact links cover the core need | trust-seo-brand.md §10 |
| Listings price ladder (`size: 50`) | One-line scraper change with zero extra requests; first candidate for the next wave | data-opportunities.md §4 item 1 |
| Print-status inference and curated `set_events` | Listings history is about 85 days old; needs curation | competitive-landscape.md §4 item 9; data-opportunities.md §3.9 |
| Traded-value heatmap, landed-cost calculator, realised P/L (needs a sale model), saved screener views table, release-cycle curves, beta to index, dark mode | Valuable but secondary to the ranked features, or blocked on data depth | competitive-landscape.md §4, §5; data-opportunities.md §3.8, §3.17 |

---

## 11. Owner decisions

The specs are written. The authoritative list, with deadlines and defaults, is the "Owner decisions" table in `00-PLAN.md`. The Track 2 subset:

- **D1.** The true CardRinkTCG relationship (owned, paid or unpaid), and whether the operator holds inventory of tracked products. Needed by WP15 and WP24.
- **D2.** Name or named pseudonym for `/about`, plus city and province. Needed by WP24.
- **D4.** The mailing address for email footers (Canada's anti-spam law requires one). Needed by WP35.
- **D5.** Accept the renamed labels ("Composite score", "Below / Near / Above pack value"). Needed by WP24.
- **D6.** Approve replacing the Poké Ball mark and choose a direction. WP27 ships an interim geometric monogram if no mark is ready.
- **D7.** About 3 to 5 hours to curate MSRP and pack contents from the template WP28 generates.
- **D8.** Enable `pg_cron` in Supabase, create a free Brevo HTTP API key, and set up SPF, DKIM and DMARC. Needed by WP25, WP29 and WP35.
- **Accept:** light-only for this track (section 3.6), and Prices and Screener kept as two jobs rather than merged (section 4.1).
