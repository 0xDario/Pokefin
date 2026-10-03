# Competitive landscape and best-practice patterns for Pokéfin

Date: 2026-09-30. Scope: sealed Pokémon TCG price trackers, collectibles portfolio apps, and finance-product UX benchmarks, read against what Pokéfin ships today and after the WP00-WP21 remediation plan.

## How this was researched, and how far to trust it

- WebSearch worked. WebFetch was blocked by the egress proxy for every competitor domain tried (pricecharting.com, pokedata.io, cardladder.com, getcollectr.com), so no page was read directly. Every claim tagged **[S]** comes from search-result summaries of the cited URL. Claims tagged **[K]** are from my own prior knowledge of the product and were not re-verified this session; treat them as likely but check before quoting them publicly.
- Prices and tier limits change often. Check any number below before putting it in marketing copy.
- "Pokéfin today" means the repo at HEAD plus the WP00-WP21 plan (URL-state catalog, server-rendered pages, SVG sparklines, formatting module, Dialog, CurrencyProvider, ISR). Anything the plan doesn't deliver is marked absent.

## 1. What Pokéfin is today (baseline for the matrix)

From the repo (`README.md`, `frontend/app/**`, `migrations/`):

- 306 sealed products, TCGPlayer Market Price, each product re-priced about once a day (scraper every 4 h, 23 h re-price gate). USD and CAD display. The Bank of Canada rate is stored in `exchange_rates` on every run, so dated history exists.
- Product page: returns (7D/1M/3M/6M/1Y), CAGR, max drawdown, 30-day volatility, Recharts price chart with range toggles, **Market Pulse** (units sold 7d/30d, volume trend, active listings, units on market, days of supply, divergence signals such as Demand surge, Thin supply, Distribution, Cooling off), sibling products in the set.
- Freshness guards: stale prices withheld (0023). Stale or gappy sales and listings windows show `--`, never 0 (0018-0022).
- `/stats` and `/analytics`: set-level ranking with Price/Day, Momentum and an "Invest Score".
- `/box-calculator`: box NAV (sum of pack values plus promo) against the box price, with a premium or discount and a buy/hold/avoid verdict. Recipes can be saved and shared.
- `/portfolio`: holdings, lots, allocation chart, Collectr CSV import.
- `/compare`: Shopify CSV margin check against market, a seller tool.
- Weekly PDF investment report emailed from Python.
- Absent: watchlists, alerts, product-vs-product overlay, index or benchmark, screener presets, heatmap, methodology page, MSRP or print status, per-pack normalisation outside the box calculator, CSV export of views, push notifications.
- Copy defect to note: `layout.tsx` metadata still says "refreshed hourly". WP03 already fixes this to "updated daily" and it must land, because honest freshness is one of the differentiators below.

## 2. Competitor profiles

### Collectibles and TCG trackers

**TCGPlayer** (the data source)
- Data: Market Price, a proprietary time-weighted average of completed TCGPlayer sales per product and condition. The formula is not published. [S] https://help.tcgplayer.com/hc/en-us/articles/213588017-TCGplayer-Market-Price, https://invelocity.app/blog/tcgplayer-market-price-explained
- Product page: Market Price, Most Recent Sale, Listed Median, current quantity and seller count, a price-history chart (roughly 1M to 1Y) with sold-volume bars, and a latest-sales table. [K]
- App: scan, collection, watchlist price alerts. [S] https://play.google.com/store/apps/details?id=com.tcgplayer.tcgplayer&hl=en_CA
- Monetisation: marketplace fees.
- Weaknesses Pokéfin can beat: USD only. Listing-depth history is not shown (only the current quantity). No portfolio returns or risk metrics. No cross-product analytics. A third-party Chrome extension exists just to add alerts and favourites, which shows the demand. [S] https://chromewebstore.google.com/detail/tcgpricealert-%E2%80%94-tcgplayer/omalfkgheldhjahbnepmknnlcgacapek

**PriceCharting**
- Data: per-item value from eBay sold listings, with TCGPlayer sales added in Dec 2025 and an "all / eBay only / TCGPlayer only" toggle. Completed-sales table with photos (Time Warp). [S] https://blog.pricecharting.com/2025/12/tcgplayer-sales-data-has-been-added.html, https://www.pricecharting.com/game/pokemon-evolutions/booster-box
- Standouts: collection tracker with historic collection value and a **monthly email summary** (value, most valuable items, recent buys). Deal Alerts and an eBay Deal Scanner for listings below market. Lot Value Calculator. Free marketplace with no fees. API and CSV on the top tier. [S] https://www.pricecharting.com/pricecharting-pro, https://www.pricecharting.com/page/collection-tracker
- Monetisation: Collector $6/mo, Retailer tier, Legendary $49/mo (API, CSV, Lot Bot). [S]
- Weaknesses: generic across games. Dated table-heavy UI. No returns, volatility or drawdown. No supply data. USD only.

**Collectr**
- Data: live market value for cards and sealed across 25+ TCGs, 1M+ products, 2M+ users. Portfolio charted "like a stock portfolio", cost basis and gain/loss across currencies and periods, up to 5+ years of history on Pro. [S] https://getcollectr.com/, https://apps.apple.com/us/app/collectr-tcg-collector-app/id1603892248
- Standouts: scanning, cross-device sync, portfolio-performance view. [S] https://app.getcollectr.com/portfolio/performance
- Monetisation: Pro $7.99/mo or $59.99/yr (unlimited scans, filters, full history, export). [S]
- Weaknesses: breadth over depth. No sealed-specific analytics (no NAV, per-pack, supply or print status), no risk metrics, no benchmark. Pokéfin already imports Collectr CSV, so it can position as "bring your Collectr export, get investor analytics".

**PokeData.io**
- Data: English and Japanese cards and sealed. Prices from eBay, TCGPlayer and CardMarket. Raw, PSA and CGC. Population history. [S] https://www.pokedata.io/, https://apps.apple.com/us/app/pokedata-io/id6504906730
- Standouts: price alerts, shareable portfolios and lists, **custom charts comparing cards, products and full sets**, sales-volume history, personal API. [S] https://www.pokedata.io/pro
- Monetisation: GOLD from $8/mo (full history, 4 portfolios, 20 alerts). PLATINUM from $20/mo (unlimited, custom charts, sales volume, API). [S]
- Weaknesses: comparison charts and volume are paywalled at $20/mo. No supply or listings depth, no CAD. Pokéfin can offer overlay comparison and volume free, with supply on top.

**Card Ladder** (sports first, Pokémon covered)
- Data: 100M+ sales across marketplaces back to 2000. CL Value, a modelled current value anchored to player or character indexes. Indexes recomputed nightly. [S] https://www.cardladder.com/pricing, https://cardladder.zendesk.com/hc/en-us/articles/11943684520471--Card-Ladder-Value-The-Intersection-of-Player-Indexes-Price-Modeling
- Standouts: **the Card Ladder Index followed daily**, daily sales recaps, customisable dashboards, alerts, collection tracking. [S]
- Monetisation: Pro $20/mo or $200/yr (raised from $15 in Feb 2025). [S]
- Weaknesses: singles and graded only, no sealed depth. Index weighting and comps are opaque behind the paywall. [S] https://northernbeachespokemon.com.au/card-ladder-vs-ebay-why-trading-card-prices-sometimes-dont-match/

**Alt**
- Data: Alt Value, a Zestimate-style estimate from a year of transactions. Marketplace, auctions, vault, lending against cards. [S] https://gen.xyz/blog/altxyz, https://support.alt.xyz/en/articles/9213547-collection-management
- Monetisation: marketplace and vault fees, lending. [S] https://support.alt.xyz/en/articles/9682168-alt-fees
- Relevance: high-value graded singles only. The pattern worth borrowing is the **single headline estimate plus its recent-sales evidence underneath**. Otherwise not a direct competitor.

**eBay Product Research (ex-Terapeak)**
- Data: up to 3 years of sold history: average sold price, range, shipping, seller count, **sell-through rate**. Free for sellers, on desktop and mobile. [S] https://www.ecommercebytes.com/2024/05/07/ebay-sellers-can-now-check-3-years-of-sold-prices-on-mobile/, https://www.frooition.com/terapeak/
- Weaknesses: query-based, not curated per product, noisy titles, no time-series charting per SKU, seller-only.
- Pattern to borrow: **sell-through rate** as the standard liquidity metric that collectors already understand. Pokéfin can compute it from sales and listings history.

### Sealed-specific niche (the real competitive set)

| Site | What it does | Standout | Weakness vs Pokéfin |
|---|---|---|---|
| PokemonPriceTracker.com | Sealed and cards, daily TCGPlayer, EV calculator and ROI per set, paid API ($9.99-$99/mo) [S] https://www.pokemonpricetracker.com/sets, https://www.pokemonpricetracker.com/pricing | EV and ROI per set, market movers page | Card-first. No supply data, no CAD, API-monetised |
| PricePerPack.net | Price per pack for box, ETB, tin and bundle across modern sets, daily [S] https://www.priceperpack.net/ | One normalised metric that answers "cheapest packs" | Single metric. No history, portfolio or risk |
| OpenOrHold.com | 96 products, 6-hourly, EV vs sealed price. "Worth Opening" above +5%, "Keep Sealed" below -5%, "Coin Flip" between. Notes that a box recovering 100% of cost in raw EV still loses about 15% when sold [S] https://openorhold.com/, https://openorhold.com/guides/how-to-read-ev | Explicit thresholded verdict with a published guide; accounts for exit costs | Narrow scope. Needs singles data |
| PokeViews | Sealed index (base 100, top-N by market price, equal-weighted top 20 per era), era performance, Pokémon vs traditional assets, momentum, hot/cold [S] https://www.pokeviews.com/sealed_index, https://www.pokeviews.com/pokemon_vs_assets | Index family plus a benchmark vs S&P and gold | Index-only site. No per-product depth, no portfolio |
| Pokemetrics.io | Per-set sealed indices for Scarlet & Violet, 6-hourly, TCGPlayer [S] https://pokemetrics.io/ | Set-as-index framing | SV only |
| CCG Index | Sealed benchmarks for MTG and Pokémon, tiered sources, **per-component timestamps so users can audit staleness** [S] https://ccgindex.com/ | Freshness transparency per constituent | Thin UX |
| CardTrack 100 | Value-weighted top-100 cards index, monthly re-rank, chain-linked, compared with BTC, gold and S&P 100 [S] https://cardtrack.com/ct100 | Correct index construction, published | Cards only |
| TCGscreener | Finviz-style screener, 44k cards: modelled market cap, RSI, momentum, % off 52w high, EU/US arbitrage. Free, no signup [S] https://tcgscreener.com/ | Screener columns investors expect | Cards only. Modelled market cap is speculative |
| Moonstone HQ | "Bloomberg Terminal for Pokémon cards": daily tape, PSA comps, gem rates. **Print Clock** model infers out-of-print status from retail-price fingerprints [S] https://www.moonstonehq.com/, https://www.moonstonehq.com/articles/pokemon-print-clock-status-model | Print-status inference, the most valuable sealed signal after price | Card and graded focus |
| TCG Market News | Free winners and losers with noise filtering, watchlists, realised and unrealised P/L [S] https://www.tcgmarketnews.com/ | Movers filtered for bad data | Generic |
| TCGSniper | Product-level price-drop alerts on TCGPlayer and Card Kingdom. Free for 15 alerts, Plus $5/mo [S] https://tcgsniper.com/sealed-product-alerts | Shows alerts alone are a product people pay for | Alerts only |
| TrackaCard (CA) | Compares 35+ Canadian stores in CAD with price history and deal alerts. Search is free, alerts and history are paid [S] https://trackacard.ca/ | Canadian retail prices | Retail comparison, not market analytics |
| Quaza Track (CA) | 400+ sealed products quoted in CAD from TCGPlayer data, daily. Run by a Canadian store [S] https://quazacollect.com/en-us/pages/price-tracker | **Direct Canadian overlap** | Store-owned (conflict of interest), tracker only |

Search engines already list Pokéfin next to TrackaCard and Quaza for "Canadian Pokémon TCG price tracker CAD sealed", and quote its "refreshed hourly" copy. [S] https://www.pokefin.ca/

### Finance UX benchmarks (patterns, not competitors)

- **Yahoo Finance quote page** (2023 redesign): horizontal nav freeing a full-width chart, **compare mode** for side-by-side stats and performance, a right-rail summary visual, and a "View Watchlist" button on every quote page. [S] https://www.yahooinc.com/press/yahoo-finance-debuts-new-design-and-features-to-empower-everyday-investors. Quote header shows last price, absolute and % change, and an "As of <time>. Market closed." stamp. The key-stats grid includes a 52-week range bar and previous close. [K]
- **Koyfin**: many custom watchlists with user-chosen columns, MyDashboards widgets, graph comparison of up to 5 securities or portfolios, model portfolios with custom benchmarks, 500+ screener filters. [S] https://www.koyfin.com/features/watchlists/, https://www.koyfin.com/help/mydashboards-myd/
- **TradingView**: symbol overlay in **percentage scale from the start of the visible range**, watchlist-level alerts. The free tier allows 3 alerts and 1 watchlist of 30 symbols, a useful signal for where a free/paid line sits. [S] https://www.tradingview.com/features/, https://chartwisehub.com/tradingview-free-plan/
- **Robinhood**: gain and loss colour carries the UI, and the chart colour flips with period direction. Long-press **scrubbing** shows price and change at any point. [S] https://oh-my-design.kr/design-systems/robinhood, https://robinhood.com/us/en/support/articles/using-charts/. The headline number updates live while scrubbing, and range chips sit under the chart. [K]
- **Morningstar**: a single rating built from a fair-value estimate, an **uncertainty rating** (Low to Extreme) that sets the required margin of safety, and the current price, all backed by a long public methodology document. [S] https://www.morningstar.com/stocks/an-introduction-morningstar-uncertainty-rating. Lesson for Pokéfin's buy/hold/avoid verdict and "Invest Score": show the inputs, the uncertainty and a methodology link.
- **Finviz**: saved screener presets shareable by URL (50 free, 200 on Elite). The map is a treemap grouped by sector, sized by market cap, coloured by performance, with a switchable timeframe (1 day to 1 year) and a bubble view. [S] https://www.luxalgo.com/blog/finviz-screener-hacks-save-hours-scanning/, https://finviz.com/map?t=cap
- **CoinGecko / CoinMarketCap** (closest analogue: thousands of assets, collector-investors): coin header with 24h/7d/14d/30d/1y change chips and market cap. Categories ranked by change. A public **methodology** page. A Trust Score with published weights. Portfolios as custom lists with P/L. CMC's coin page runs three columns on desktop, two on tablet and one on mobile. [S] https://www.coingecko.com/en/methodology, https://support.coingecko.com/hc/en-us/articles/36442561461657-Trust-Score-Methodology, https://coinmarketcap.com/academy/article/cmcs-new-coin-detail-page-cdp-makes-crypto-tracking-easier-than-ever

### Community norms (r/PokeInvesting and sealed-investing guides)

- Long holds (7-10 years for vintage), no flip expectations. Reprint risk is the dominant threat to modern sealed. Out-of-print status is inferred from distributor stock and prices leaving MSRP, and is never officially announced. ETBs often beat boxes on % appreciation. [S] https://www.ripster.gg/blog/pokemon-booster-boxes-worth-investing, https://thecardshopfinder.com/guides/pokemon-card-investing/sealed-pokemon-investing/, https://tcgcardinvestor.com/articles/out-of-print-explained
- "x MSRP" and "price per pack" are the lingua franca. [S] https://www.priceperpack.net/, https://pokecompare.com/blog/pokemon-reprints-explained
- Canadian buyers: CUSMA courier de minimis is CAD 150 for duty and CAD 40 for tax on US-origin shipments. US-Canada tariff changes have been a live concern on collector forums. [S] https://www.cbsa-asfc.gc.ca/services/cusma-aceum/lvs-efv-eng.html, https://www.elitefourum.com/t/beware-the-us-canada-tariffs/54721

## 3. Feature matrix

Legend: ● full, ◐ partial or paywalled, ○ absent, ? unverified. "Niche" is the best of PokemonPriceTracker, PricePerPack, OpenOrHold, PokeViews, TCGscreener and Quaza; the cell names the one that has it.

### 3a. Collectibles competitors

| Feature | TCGPlayer | PriceCharting | Collectr | PokeData | Card Ladder | Alt | eBay Research | Niche (who) | **Pokéfin today** |
|---|---|---|---|---|---|---|---|---|---|
| Sealed catalogue depth | ● | ● | ● | ● | ○ | ○ | ◐ | ● PPT, PricePerPack | ● 306 products |
| Daily price history chart | ● | ● | ◐ Pro | ◐ Pro | ◐ Pro | ◐ | ● 3y | ● | ● |
| Sales volume history | ◐ | ◐ sales list | ○ | ◐ Platinum | ● | ◐ | ● | ○ | ● free |
| Listing depth / supply history | ◐ current only [K] | ○ | ○ | ○ | ○ | ○ | ◐ seller count | ○ | ● listings, units, days of supply |
| Sell-through / liquidity metric | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ | ◐ (days of supply only) |
| Returns across windows | ○ | ○ | ◐ | ◐ | ● | ○ | ○ | ◐ TCGscreener | ● |
| Risk metrics (vol, drawdown, CAGR) | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| Market index / benchmark | ○ | ○ | ○ | ○ | ● | ○ | ○ | ● PokeViews, CardTrack | ○ |
| Product overlay comparison | ○ | ○ | ○ | ◐ Platinum | ◐ | ○ | ○ | ○ | ○ |
| Screener with filters | ◐ catalogue filters | ◐ | ◐ | ◐ | ● Pro | ○ | ◐ | ● TCGscreener | ◐ /prices filters, /market sort |
| Saved / shareable screens | ○ | ○ | ○ | ◐ lists | ◐ | ○ | ○ | ◐ URL | ◐ URL state after WP08 |
| Movers / heatmap | ◐ articles | ◐ | ○ | ○ | ● daily recap | ○ | ○ | ● TCG Market News, PPT | ◐ dashboard lists |
| Watchlist | ● app | ● wishlist | ● | ● | ● | ● | ○ | ● | ○ |
| Price alerts | ● app | ◐ deal alerts $6 | ? | ◐ 20 on Gold | ◐ Pro | ? | ○ | ● TCGSniper, TrackaCard | ○ |
| Portfolio with cost basis, lots | ◐ | ◐ | ● | ● | ◐ Pro | ● | ○ | ◐ | ● lots |
| Portfolio vs benchmark | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Realised P/L and exit-fee realism | ○ | ○ | ◐ | ○ | ○ | ◐ | ◐ fees | ◐ OpenOrHold 15% | ○ |
| Periodic email summary | ○ | ● monthly | ○ | ○ | ● daily news | ○ | ○ | ○ | ● weekly PDF |
| Per-pack normalisation | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● PricePerPack | ◐ box calculator only |
| Box NAV / premium-discount verdict | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ◐ OpenOrHold (singles EV) | ● |
| MSRP multiple | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ◐ | ○ |
| Print status / reprint risk | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ◐ Moonstone model | ○ |
| CAD-native pricing | ○ | ○ | ◐ currency switch | ○ | ○ | ○ | ◐ ebay.ca | ● Quaza, TrackaCard | ● (spot FX today) |
| Historical FX (CAD history at dated rate) | ○ | ○ | ? | ○ | ○ | ○ | ○ | ? | ◐ rates stored, not applied |
| Landed-cost (ship, duty, tax) | ○ | ○ | ○ | ○ | ○ | ○ | ◐ | ○ | ○ |
| Freshness disclosure per price | ◐ | ◐ sale dates | ○ | ○ | ○ | ○ | ● dates | ● CCG Index timestamps | ◐ gate exists, little surfaced |
| Public methodology page | ● Market Price help | ◐ FAQ | ○ | ○ | ◐ | ○ | ○ | ● PokeViews, CardTrack | ○ (README only) |
| Seller tools (store margin vs market) | ● seller | ◐ Retailer tier | ○ | ○ | ○ | ○ | ● | ○ | ● Shopify CSV compare |
| CSV export / API | ◐ | ◐ Legendary | ◐ Pro | ◐ Platinum | ○ | ○ | ○ | ◐ PPT API | ◐ account export only |
| Mobile app or PWA | ● | ● | ● | ● | ● | ● | ● | ◐ | ◐ responsive web |
| Price | free | $0 / $6 / $49 | $0 / $7.99 | $0 / $8 / $20 | $0 / $20 | fees | free | mostly free | free |

### 3b. Finance-benchmark patterns vs Pokéfin

| Pattern | Yahoo | Koyfin | TradingView | Robinhood | Morningstar | Finviz | CoinGecko / CMC | **Pokéfin today** |
|---|---|---|---|---|---|---|---|---|
| Quote header: price, abs and % change, as-of stamp | ● | ● | ● | ● | ● | ● | ● | ◐ price and returns, no as-of stamp |
| Multi-period change chips | ◐ | ● | ● | ◐ | ● | ● | ● 24h to 1y | ● returns table |
| 52-week range bar, % off high | ● | ● | ● | ○ | ● | ● | ● ATH/ATL | ○ |
| Key-stats grid | ● | ● | ◐ | ◐ | ● | ● | ● | ◐ Market Pulse |
| Range chips plus scrub readout | ● | ● | ● | ● | ● | ◐ | ● | ◐ range chips, tooltip only |
| Overlay compare, % rebased | ● | ● (5) | ● | ○ | ◐ | ○ | ◐ | ○ |
| Watchlists with custom columns | ● | ● | ● | ● | ● | ● | ● | ○ |
| Alerts | ● | ● | ● (3 free) | ● | ◐ | ◐ Elite | ● | ○ |
| Screener plus saved presets | ● | ● | ● | ○ | ● | ● | ◐ | ◐ |
| Heatmap / treemap | ◐ | ◐ | ● | ○ | ○ | ● | ● | ○ |
| Index / benchmark overlay | ● | ● | ● | ◐ | ● | ● | ● global cap | ○ |
| Portfolio P/L, TWR vs benchmark | ● | ● | ◐ | ● | ● | ◐ | ● | ◐ P/L, no TWR or benchmark |
| Rating with uncertainty and methodology | ◐ | ○ | ◐ | ○ | ● | ○ | ◐ Trust Score | ◐ verdict and Invest Score, no uncertainty, no methodology |
| Methodology / data-sources page | ● | ● | ● | ◐ | ● | ◐ | ● | ○ |
| Personal home dashboard | ● | ● | ● | ● | ● | ◐ | ● | ○ |
| Responsive 3/2/1-column layout | ● | ◐ | ● | ● | ● | ○ | ● | ◐ |

## 4. The 15 patterns Pokéfin should adopt, ranked by value to a sealed collector-investor

Ranking criteria: (a) helps a buy, hold or sell decision, (b) uses data Pokéfin already has, (c) fits daily cadence and the freshness gate, (d) no paid services. New DB objects start at migration **0033** (WP21 uses 0031-0032).

1. **Watchlist plus threshold alerts, delivered as a daily digest.** Why: every serious competitor has this (PokeData, TCGSniper, TrackaCard, PriceCharting, TradingView, CoinGecko), and Pokéfin has none. That is the largest single gap. It is also the retention loop: a reason to come back that doesn't depend on the user remembering. Design: `watchlists`, `watchlist_items`, `alert_rules` (price below or above, % move over N days, days of supply below X, listings down Y% over 7d, back within X of MSRP) and `alert_events`, with RLS via cookie-backed `app/api/` routes. Rules are evaluated in Python after each scrape, only against fresh prices (respect 0023: never alert on a withheld price). One digest email per day through the SMTP path the weekly report already uses. Optional Web Push through VAPID later (free). The copy must say "checked daily". Don't imitate "instant alerts".
2. **Quote header plus key-stats panel on `/product/[id]`** (Yahoo, CoinGecko). Show price in the user's currency with the other currency secondary. Show change chips (1D, 7D, 30D, 1Y). Show an **"As of Sep 29, 2026" stamp from the price row date**, not "live". Add a 52-week range bar with % off the 52-week high, all-time high and low with dates, x MSRP, days since release, and a one-line liquidity summary (days of supply, sell-through). One glance should answer "is this cheap relative to its own history, and can I exit?".
3. **Screener with presets and shareable saved views** (Finviz, TCGscreener, Koyfin). Extend `/market` on top of WP08 URL state. Filters: type, era, set, price band, returns, % off 52w high, volatility, x MSRP, days of supply, volume trend, signal. Columns are user-choosable. Ship built-in presets: "Off highs with thin supply", "Near MSRP (possible in-print)", "Supply draining", "Low-vol compounders", "Distribution warning". Saved views: a `saved_views` table for signed-in users. The URL is the share mechanism for everyone.
4. **Pokéfin Sealed Index family plus benchmark overlays** (PokeViews, CardTrack, Card Ladder, CoinGecko). Headline index: equal-weighted, chain-linked daily, base 100, with a monthly rebalance and inclusion rules (fresh price, minimum history, exclude products under N days old to avoid launch-spike bias). Sub-indices by product type (Booster Box, ETB, Bundle, Collection), by era, and one per set (Pokemetrics framing). Compute server-side in a nightly RPC or materialised table (`index_values`) so the pages stay cheap. Use it as the benchmark line on product and portfolio charts, and put "vs index" on every return. Publish the construction rules (item 8). Avoid "market cap" because units outstanding for sealed are unknown. TCGscreener's modelled cap is the cautionary example.
5. **Portfolio as a brokerage-grade P/L view** (Robinhood, Koyfin, Collectr). Total value, day and period change, unrealised and realised P/L per lot, **time-weighted return vs the Sealed Index**, allocation by set, type and era, and a concentration warning. Add an **exit value net of a configurable fee and shipping assumption** (OpenOrHold's "about 15% lost on sale" point) so P/L is not flattering. Track cost basis in CAD at the FX rate on the purchase date (differentiator 1). WP10 already moves portfolio history to an RPC, so build on it.
6. **Overlay comparison, % rebased from range start** (Yahoo compare mode, TradingView % scale, Koyfin up to 5, PokeData Platinum). Up to 5 products plus the index on one chart, with URL state (`/compare?ids=`). Rename the Shopify tool to `/seller` or `/tools/margin` so "compare" means what users expect. WP18 already splits compare. PokeData charges $20/mo for this, so offer it free.
7. **Movers and a heatmap filtered for noise** (Finviz map, CMC categories, TCG Market News). A treemap grouped by era then set, **sized by 30-day traded value (price x units sold)**, coloured by return over a selectable window. Size by traded value because sealed has no market cap, and it rewards liquid moves. Movers lists must require minimum sales volume and a fresh price so one-sale spikes don't top the list. Render as server SVG, not Recharts, to protect the WP09/WP12 bundle budget.
8. **Methodology and data-freshness disclosure** (CoinGecko methodology, CCG Index per-component timestamps, Morningstar). A `/methodology` page covering the source (TCGPlayer Market Price, what it is and isn't), cadence (about daily per product), the freshness gate, `--` semantics, return, CAGR, volatility and drawdown formulas (from WP18 `marketMath.ts`), days of supply, signals, index rules, Invest Score and verdict thresholds, and the FX source. A global "Data as of" chip in the header showing the last completed scrape. Every metric label links to its definition. This is cheap and it builds trust, which is where Pokéfin can win outright.
9. **MSRP multiple plus a print-status signal** (Moonstone Print Clock, community reprint-risk norms). Add `msrp_usd` and `msrp_cad` to products (a one-off data entry for 306 items, most sealed SKUs have fixed MSRPs). Show x MSRP everywhere. Build a **heuristic print-status indicator** from Pokéfin's own data: price pinned near MSRP plus rising listings means "likely in print or restocking". Price leaving MSRP plus falling listings for N weeks means "likely out of print". Label it as inferred and show the evidence. Pokéfin has listings history, which Moonstone's retail-price model lacks, so this can be better than theirs.
10. **Liquidity metrics collectors already know** (eBay sell-through, days of supply). Sell-through (30d units sold / average units listed), a days-of-supply trend, listings change over 7d and 30d, and a liquidity grade (A to D) with thresholds published in the methodology. Show it next to the price, because an illiquid +40% is a different asset from a liquid +40%.
11. **Per-pack normalisation across formats** (PricePerPack). Price per pack for every product with a known pack count, plus a set-level "cheapest route to packs" table (box vs ETB vs bundle vs loose). Box NAV already does this for boxes. Generalise it with a `pack_count` column and link each row to the box calculator. This is a direct buying decision.
12. **Chart interaction to finance standard** (Robinhood, Yahoo). The headline number updates while hovering or scrubbing (price and change since range start). Line colour follows period direction, using an accessible palette from WP14. Volume bars stay beneath. Add event markers (release date, known reprint or restock announcements, Pokémon Center drops) from a small `product_events` table. The range chips already exist, so add "MAX" and "YTD".
13. **A personal home for signed-in users** (Koyfin MyDashboards, Yahoo watchlist rail). `/` becomes "My Pokéfin" once signed in: portfolio value and day change, watchlist movers, alerts fired since the last visit, and index change. Anonymous visitors keep the market dashboard. Render it server-side with personal data fetched through the WP04/WP05 route handlers, so the public ISR shell stays cached.
14. **Mobile patterns** (CMC 3/2/1 columns, Robinhood). On the product page, a sticky compact price header after scroll, range chips reachable by thumb, and a key-stats grid that collapses to 2 columns. Tables become card lists under 640px, with the sort control in a bottom sheet (WP14 Dialog). Make it installable as a PWA (manifest, icons). Web Push for alerts works on installed PWAs, including iOS 16.4+ [K], at zero cost.
15. **Export and the weekly report as a web edition** (PriceCharting monthly email and CSV, Card Ladder daily recap, Collectr export). CSV export of any screener view, watchlist or portfolio (the portfolio export follows the WP01 export pattern). Publish the weekly PDF as an indexable `/weekly/[date]` page with the same numbers: good for SEO, shareable on Reddit, and linked from the email.

**Considered and deliberately not adopted now:** card scanning, graded and population data, a marketplace, vaulting (all outside sealed-only scope). Singles-based open-vs-hold EV: high value, but it needs a singles catalogue and pull-rate data, so it is a separate data project and should reuse box NAV framing if pursued. "Real-time" or intraday views, because the data is daily and implying otherwise breaks trust. AI price predictions (CMC has them). Without a validated model they are a liability.

## 5. Five differentiators Pokéfin can own

1. **Canadian-native investing, not just a CAD toggle.** Quaza and TrackaCard convert or compare retail. No one does CAD returns properly. Plan: CAD history at the **dated Bank of Canada rate** (already stored in `exchange_rates`; backfill from the free BoC Valet API [K] https://www.bankofcanada.ca/valet/docs). Split CAD returns into "market move" and "FX move". Keep portfolio cost basis in CAD at the purchase-date rate. Add a **landed-cost calculator** for buying from US sellers (shipping, CUSMA CAD 150 duty and CAD 40 tax de minimis, GST/HST by province, surtaxes when applicable). [S] https://www.cbsa-asfc.gc.ca/services/cusma-aceum/lvs-efv-eng.html. Owner and audience are Canadian, and the domain is `.ca`.
2. **Supply and liquidity intelligence from listings history.** Pokéfin stores active listings and quantity available over time. None of the trackers surveyed surface that as history: TCGPlayer shows a current snapshot [K], and eBay shows seller counts per query. On that data, build days of supply, sell-through, "supply draining" and "distribution" signals, the liquidity grade and the print-status inference (pattern 9). This is the sealed-market equivalent of order-book depth, and it is the hardest thing for a competitor to copy because it needs history Pokéfin already started collecting.
3. **Sealed structure analytics: box NAV, per-pack and format arbitrage.** Treat a booster box like a closed-end fund whose NAV is its packs. Show the premium or discount, the verdict and shareable recipes (already built), then extend to per-pack across formats and "cheapest route into a set". OpenOrHold and PricePerPack each own one slice. Pokéfin can combine them with history, alerts ("box now trades at a 12% discount to its packs") and the screener.
4. **The tracker you can trust: honest freshness and published methodology.** The freshness gate (0023), `--` instead of fake zeros, and stale supply guards already beat the market on integrity. Competitors advertise "real-time" or "hourly" over daily data. Once WP03 lands, Pokéfin says "updated daily" and proves it with as-of stamps, a data-status chip, a methodology page, and index rules in the style of CCG Index, CardTrack and CoinGecko. Morningstar's lesson: a verdict is credible when its inputs and uncertainty are shown. Apply that to buy/hold/avoid and the Invest Score.
5. **Seller-grade tools for Canadian shops and resellers.** The Shopify CSV margin compare has no equivalent among collector trackers. PriceCharting's Retailer tier is US and game-generic. Extend it into repricing cues (listing above or below market by X%, stale inventory with falling days of supply) and a weekly seller digest. This makes Canadian LGS owners a distribution channel and keeps their customers on Pokéfin data, free and without a paywall.

**Positioning line:** "Koyfin for sealed Pokémon, in Canadian dollars, free." Competitors charge $8-$20/mo for comparison charts, volume, alerts and full history (PokeData, Card Ladder, Collectr). Pokéfin can give these away because its costs are fixed (owner-run scraper, free tiers), and it can keep any future paid tier for power features such as unlimited alerts and API access.

## 6. Guardrails for whoever implements this

- Cadence: every "change" is day-over-day on a daily series. Never label anything live, real-time or intraday. Alerts are evaluated after each scrape and sent as a daily digest.
- Freshness: every new metric (index constituents, movers, alerts, screener values) must read through the 0023 gate and show `--` when stale. Index constituents with stale prices are carried at their last value only for a bounded window (e.g. 3 days), then dropped from that day's return, and the rule is published.
- Performance: heatmap, index sparklines and movers render as server SVG or ISR HTML fed by precomputed tables. Recharts stays lazy and only on detail and compare charts. Personal data (watchlist, portfolio) streams in after the cached public shell. None of this may regress the WP08, WP09 or WP12 budgets.
- Data model: all new tables and RPCs are migrations from 0033 onward, with RLS and access through `app/api/` route handlers per the post-plan architecture. Math goes in `marketMath.ts`, formatting in `format.ts`, currency in CurrencyProvider.
- No new paid services. Email uses the existing SMTP path, push uses VAPID Web Push, FX comes from Bank of Canada Valet, and hosting stays on the existing Vercel and Supabase tiers.
