# Data opportunities audit

Date: 2026-09-30. Scope: what the data Pokéfin already collects can support that the website does not show, what each would cost, and what missing data would matter most. Read against HEAD plus the WP00-WP21 plan.

Sources read: `schema.sql`, `migrations/0015` to `0023`, `migrations/20260506_market_performance_functions.sql`, `main.py`, `backfill_historical_prices.py`, `backfill_sales_volume.py` (outline), `generate_weekly_report.py`, `README.md`, `frontend/app/lib/marketPulse.ts`, `frontend/app/lib/serverMarketData.ts`, `frontend/app/page.tsx`, `frontend/app/product/[id]/page.tsx`, `frontend/app/stats/page.tsx`, the box calculator, and the WP10/WP16/WP21 specs.

**Method note.** I did not query production. Row counts and depths below come from the code, the README (about 141k price rows, August 2026) and git history (repo from 2026-02-09, `0015` added 2026-07-07). Section 7 lists read-only SQL the owner should run to replace every estimate with a measured figure before building.

**Migration numbering.** WP21 takes `0031`, `0032` and `0000_baseline.sql`. New work starts at `0033`. Other research tracks may claim numbers too, so the numbers in section 6 are provisional.

---

## 1. Top conclusions

1. **Collected but never shown.** `lowest_listing_price`, `transaction_count`, `low_sale_price`/`high_sale_price`, the listings history beyond the latest row, and the dated `exchange_rates` history are all written but none reaches the UI (checked with grep in `frontend/app`). Surfacing them costs no scraper work and only small SQL changes.
2. **CAD figures are wrong for historical data.** Every CAD value, historical ones included, uses today's rate (`fetchLatestExchangeRate` takes one row). So a Canadian user's CAD return, CAD chart and CAD cost basis leave out the currency move. `exchange_rates` already holds dated Bank of Canada rates. This is the most important item for a Canadian audience, and it is a correctness fix as well as a feature.
3. **Most of the value comes from a single precomputed table.** A `product_daily_stats` table (one row per product per UTC day), filled by one `refresh_market_analytics()` function, gives ATH and drawdown from ATH, 52-week range, moving averages, liquidity score, sell-through, supply trend, days of supply over time, ask-vs-market spread, and top movers with a liquidity screen. That is 112k rows a year, well within the free tier, and page reads become index lookups under the 3 s anon timeout (0009).
4. **The Pokéfin Sealed Index is feasible now, with caveats.** Build it equal-weighted, chain-linked, published for the previous full UTC day, with sub-indices by product type and generation. Do not call it cap-weighted: there is no supply-outstanding data. Use daily points from when live scraping started and label older points weekly, because the backfill is weekly buckets flat-filled into days.
5. **Breadth and top movers are close to free.** `get_market_product_summaries` already returns `return_7d/30d/90d/365d`. What's missing is the weekly report's liquidity screen (at least 3 distinct prices in a year) and its $15 price floor, which the homepage "Top Movers" does not apply (it only excludes booster packs).
6. **Watchlists and price alerts are feasible and fit a daily cadence.** Two user tables, a daily evaluation, and email via the owner's existing Brevo SMTP (free tier, 300 emails a day). The open design question is where sending runs, given WP21's least-privilege scraper. Recommendation: a Vercel Cron route handler (Hobby crons run daily, which matches the data), not the laptop scraper.
7. **The weekly report should live on the web, with an archive.** The generator already computes category medians per window, set averages, screened top products and a derived narrative. Have it write its summary payload to a `weekly_reports` table so the PDF and the web page cannot disagree.
8. **Missing data with the best return on effort:** (a) MSRP per product, (b) pack count and contents per product, (c) a listings price ladder (change `size: 1` to `size: 50` in the listings request the scraper already makes, so no extra requests), (d) a product-level release date, (e) curated print-status and reprint events. The first four are hours of curation or one scraper line. They unlock premium-to-MSRP, automatic box NAV for every box, cost per pack, true market depth, and honest release-cycle curves.
9. **Honest limits.** History reaches back about a year before live scraping began (TCGPlayer's API caps at `annual`), listings history starts 2026-07-07, and TCGPlayer Market Price is a smoothed average. So daily volatility is understated, correlations are inflated, and seasonality cannot be shown yet (one cycle). The site should say so on a methodology page and not dress the numbers up.

---

## 2. What the data really is

| Table | Grain and cadence | Depth (estimate) | Quality notes |
|---|---|---|---|
| `product_price_history` | 1 row per product per UTC day (unique index `(product_id, recorded_at::date)`, 0003). Written about daily at a per-product slot (23 h gate). | About 141k rows, roughly 460 per product: about 1 year of backfill plus live data from early to mid 2026. | Backfill came from `infinite-api` ranges: daily for the newest 30 days, **3-day buckets** to 90 days, **weekly** beyond that, and `expand_buckets_to_daily` **flat-fills** each bucket across its days. So older history has synthetic zero-change days. 3,053 product-days were lost to the scrape-slot drift bug (`main.py` comment), and `--gaps-only` backfill patches holes from coarser buckets. The value is TCGPlayer **Market Price**, a proprietary smoothed average of completed sales, not a last trade. |
| `product_sales_history` | `day` rows: the rolling 30 daily buckets from `range=month`, upserted each visit, so daily history accumulates from 2026-07-07. `week` rows: 52 Monday buckets from the one-time annual backfill. | Day: about 85 days. Week: about 1 year. | TCGPlayer writes explicit zero buckets, so a missing row means unknown, not zero (0018-0021 enforce this). Columns `quantity_sold`, `transaction_count`, `low_sale_price`, `high_sale_price`, `market_price`. TCGPlayer venue only (no eBay). Today's bucket is partial. |
| `product_listings_history` | 1 snapshot per product per day (`snapshot_date`). | From 2026-07-07, about 85 days. **Cannot be backfilled**: TCGPlayer exposes no historical listings. | `total_quantity_available` is summed from the listing-quantity histogram (US shipping context, standard listings, live sellers). For mixed-language products only the count is kept and depth and price are NULL. `lowest_listing_price` is the item price of the cheapest listing sorted by price plus shipping, so shipping is excluded from the stored figure. 3-day staleness gate (0022). |
| `exchange_rates` | One insert **per scraper run** (every 4 h), `recorded_at` = Bank of Canada rate date. | From the first scraper run (early 2026 or before). | About 6 duplicate rows per rate date, and no rows on weekends or holidays. Needs `DISTINCT ON (recorded_at::date)` plus carry-forward to join by day. |
| `sets` | `release_date`, `expansion_type`, `generation_id`. | Static. | Products inherit the set date. Promo products and Pokémon Center variants often release weeks or months later, which distorts "days since release" for those rows. |
| `products` | `usd_price` last-write-wins, `active` (defined only in production, see WP21 F135), `variant`, `sku`. | Static plus current price. | No MSRP, pack count, product release date or print status. |
| `box_recipes` | User-authored pack contents plus retail price. | Sparse. | Useful as crowd hints, not as a source of truth. |
| `portfolio_*` | Lots with USD purchase price and date. | Per user. | Purchase currency is not stored (WP06 adds `currency` to `box_recipes` only). A Canadian buyer's cost in CAD is unknown unless inferred with the historical rate. |

**Gates every new metric must respect.**
- Price-anchored metrics (returns, distance from ATH, premium to MSRP, NAV, alerts): withhold when the newest price row is older than 14 days **or** disagrees with `products.usd_price` (0023). Reuse the `fresh_price` CTE pattern from `get_set_analytics`, or better, compute `is_price_fresh` once in `product_daily_stats` and have everything read it.
- Sales windows: 3-day freshness, no interior holes, NULL-quantity buckets are not coverage (0018-0021).
- Listings: 3-day freshness (0022). Carry the snapshot date through, so the UI can say "last seen".
- Series metrics (volatility, drawdown, trend) remain descriptions of the recorded series, but the flat-fill problem means they must be computed on **live-scraped days only**, or at weekly resolution when the window reaches into backfill.

**Structural caveat on Market Price.** It is a time-weighted average of recent sales. Day-to-day changes are autocorrelated, so daily-return volatility understates true risk, drawdowns are smoothed, and cross-product correlations are inflated. Two things follow: use **weekly** returns for volatility and correlation, and describe the numbers as "Market Price volatility", not "price risk".

---

## 3. Opportunities

Each entry: user value, data, feasibility (SQL sketch), caveats, cost. Tiers: **A** = build now on existing data. **B** = build now, but depth improves with time. **C** = needs new data.

Cost labels:
- **RPC**: live SQL at request time, cached by ISR and `revalidateTag` (WP11).
- **Precomputed**: a row written by `refresh_market_analytics()`, invoked by the scraper at the end of each run and/or pg_cron nightly (see section 5).

### 3.1 Foundation: `product_daily_stats` (tier A, precomputed)

Not user-facing on its own. It is the table 3.2 to 3.10 read from. One row per active product per UTC day:

```
product_id, day, usd_price, price_recorded_at, is_price_fresh,
ret_1d, ret_7d, ret_30d, ret_90d, ret_365d,          -- gated as 0023
ath_usd, ath_day, dd_from_ath_pct,                   -- 3.3
high_52w, low_52w, pos_in_52w_range,                 -- 3.3
ma50, ma200, above_ma50, above_ma200,                -- 3.2 breadth
vol_weekly_26w,                                      -- 3.13
distinct_prices_365d,                                -- weekly-report liquidity screen
units_sold_7d, units_sold_30d, tx_30d,               -- from volume RPC rules
active_listings, qty_available, lowest_ask,          -- gated as 0022
ask_premium_pct, days_of_supply, sell_through_30d,   -- 3.4, 3.5
qty_change_7d_pct, qty_change_30d_pct,               -- 3.5
liquidity_score, liquidity_pct_rank                  -- 3.4
```

- **Why precompute.** `get_market_product_metrics` is already the heaviest function in the database, and WP10 exists only to bound it. ATH, moving averages and weekly volatility over the full history would push per-request RPCs toward the 3 s anon timeout. As a table with a PK on `(day, product_id)` and an index on `(product_id, day DESC)`, every page read is trivial. The same rows also give **history of derived metrics** (days of supply over time, liquidity rank over time) at no extra cost.
- **Size.** 306 × 365 ≈ 112k rows a year at about 250 bytes, so about 30 MB a year. Fine on the free tier (500 MB). Two years of retention later needs a keep-weekly rollup.
- **Refresh.** Idempotent `INSERT ... ON CONFLICT (day, product_id) DO UPDATE` for `current_date`, recomputed after each scraper run (6 runs a day, each product reprices once), plus an `ON CONFLICT` rewrite of D-1 at 00:30 UTC so yesterday's row is final. Backfill once over past days for charts.
- **Replaces.** Once this exists, `get_market_product_summaries`, the volume RPC and `get_set_analytics` can read from it (a later refactor, not needed on day one).

### 3.2 Market breadth (tier A, RPC now, precomputed later)

- **Value.** "Is the whole sealed market rising, or three chase boxes?" This is the first question a serious buyer asks. It separates broad rallies from narrow squeezes and is the context line every finance dashboard leads with.
- **Metrics.** Share of fresh-priced products with positive 7D and 30D returns. Advancers, decliners and unchanged over 7D (not 1D, see caveat). Share above the 50-day moving average. New 52-week highs vs new 52-week lows over the last 7 days. All sliceable by product type and generation.
- **Data.** Available today from `get_market_product_summaries().return_7d/return_30d` (already gated). 52-week highs and MAs come from 3.1.
- **SQL sketch (v1, no new objects, computed in the page from the cached summaries):**
  ```sql
  SELECT product_type_name,
         count(*) FILTER (WHERE return_7d >  0.5) AS adv_7d,
         count(*) FILTER (WHERE return_7d < -0.5) AS dec_7d,
         count(*) FILTER (WHERE return_7d BETWEEN -0.5 AND 0.5) AS flat_7d,
         avg((return_30d > 0)::int) * 100 AS pct_up_30d
  FROM get_market_product_summaries()
  WHERE usd_price IS NOT NULL
  GROUP BY ROLLUP (product_type_name);
  ```
- **Caveats.** 1D breadth is noise: each product reprices at its own slot, and Market Price often does not change day to day, so "unchanged" dominates. Use a ±0.5% dead band. Exclude the products the liquidity screen flags (3.6).
- **Cost.** v1 is zero new SQL (JS over the already-cached summaries payload). v2 stores daily breadth in `market_index_daily` (3.7) so it can be charted as a line over time.

### 3.3 All-time (tracked) high, drawdown from high, 52-week range (tier A, precomputed)

- **Value.** "Down 38% from its high" is the most-used framing for dip buying in sealed. A 52-week range bar reads at a glance on a card.
- **Data.** `product_price_history.usd_price, recorded_at`.
- **SQL sketch:**
  ```sql
  WITH d AS (
    SELECT product_id, recorded_at::date AS day, usd_price
    FROM product_price_history),
  robust AS (          -- 3-day rolling min: a one-day spike cannot set the high
    SELECT product_id, day,
           min(usd_price) OVER (PARTITION BY product_id ORDER BY day
                                ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS p3
    FROM d)
  SELECT DISTINCT ON (product_id) product_id, p3 AS ath_usd, day AS ath_day
  FROM robust ORDER BY product_id, p3 DESC, day DESC;
  ```
  The ATH is the max of the rolling 3-day min, so a single-day spike cannot set it. A 7-day rolling median is stricter, but Postgres has no windowed `percentile_cont`, so it needs a `LATERAL` over the last 7 rows in the refresh function. `dd_from_ath_pct = usd_price / ath_usd - 1`, gated on `is_price_fresh`.
- **Caveats.** Call it the **tracked high since {first date}**, never "all-time": history starts about a year before live scraping, so any set older than about mid-2025 had its real peak before the data begins. Show the first tracked date next to it. A raw max is vulnerable to thin-market steps (the Steam Siege ETB $449.95 to $1,800 case in `generate_weekly_report.py`), hence the robust filter plus the distinct-prices screen.
- **Cost.** Precomputed. As an RPC, one pass over 141k rows (growing about 112k a year) is fast today but grows unbounded, and it would run on every cache miss.
- **Quick win without SQL.** The product page already loads 367 days of history, so the 52-week high/low and position-in-range can render there today in JS.

### 3.4 Liquidity score, ask spread, sell-through (tier A for score and spread, B for trends)

- **Value.** A sealed buyer's real risk is exit liquidity: can I sell 5 of these in a month without cutting price? Nobody in the competitive set shows this for sealed.
- **Data.**
  - `units_sold_30d`, `transaction_count_30d` (volume RPC, rules from 0021).
  - `active_listings`, `total_quantity_available`, `lowest_listing_price` (0022).
  - `usd_price` and `distinct_prices_365d` (from `product_price_history`).
- **Components.**
  - Turnover: `units_sold_30d`.
  - Breadth of buyers: `transaction_count_30d`. `units_sold_30d / transaction_count_30d` is units per transaction; a high ratio means dealers are restocking in bulk.
  - Sell-through: `units_sold_30d / (units_sold_30d + qty_available)`, the standard retail metric, bounded 0 to 1 and easier to read than days of supply.
  - Ask premium: `lowest_ask / usd_price - 1`. Negative means someone is listing below Market Price, which is a dip-buy tell and a deal-alert trigger (3.11). A large positive value means thin supply.
  - Price discovery: `distinct_prices_365d`.
- **Score.** Average of `percent_rank()` over components within the product-type peer group, 0-100. Publish the components alongside, never a black box. Keep the existing "Invest Score" approach in mind: the complaint about it is opacity.
  ```sql
  SELECT product_id,
    100 * (percent_rank() OVER (PARTITION BY product_type_id ORDER BY units_sold_30d)
         + percent_rank() OVER (PARTITION BY product_type_id ORDER BY tx_30d)
         + percent_rank() OVER (PARTITION BY product_type_id ORDER BY sell_through_30d)
         + percent_rank() OVER (PARTITION BY product_type_id ORDER BY -abs(ask_premium_pct))) / 4
      AS liquidity_score
  FROM product_daily_stats WHERE day = current_date AND units_sold_30d IS NOT NULL;
  ```
- **Caveats.** Only TCGPlayer volume; eBay and local sales are invisible, so present it as relative (percentile within type), not absolute. `lowest_listing_price` excludes shipping, and sealed shipping is often $5 to $15, so the ask premium must be labelled "before shipping", or fixed by storing shipping (section 4). NULL depth for mixed-language products means those have no spread; show `--`.
- **Cost.** Precomputed column. The ask premium alone could be added to the volume RPC today, but the RPC already returns `lowest_listing_price`, so the frontend can compute it with no SQL change.

### 3.5 Supply trend and days of supply over time (tier B)

- **Value.** Falling units on the market while the price is flat is the classic leading indicator of a sealed breakout; rising supply with flat demand precedes a dump. Today the site shows only the latest snapshot, so a user cannot see direction.
- **Data.** `product_listings_history.total_quantity_available, active_listings, snapshot_date`, plus `product_sales_history`.
- **SQL sketch:**
  ```sql
  SELECT cur.product_id,
         cur.total_quantity_available AS qty_now,
         past.total_quantity_available AS qty_30d_ago,
         cur.total_quantity_available::numeric / NULLIF(past.total_quantity_available,0) - 1 AS qty_change_30d
  FROM product_listings_history cur
  JOIN LATERAL (
    SELECT total_quantity_available FROM product_listings_history p
    WHERE p.product_id = cur.product_id
      AND p.snapshot_date BETWEEN cur.snapshot_date - 33 AND cur.snapshot_date - 30   -- one-sided tolerance like the returns
    ORDER BY p.snapshot_date DESC LIMIT 1) past ON true
  WHERE cur.snapshot_date >= current_date - 3;                                         -- 0022 gate
  ```
  Product page: a supply line (units available) under the existing volume bars, and a days-of-supply line from `product_daily_stats`.
- **New signals** extending `getPulseSignal`, with the same thresholds approach and documented in README:
  - "Supply drying up": qty −20% over 30 days and price within ±2%.
  - "Supply wave": qty +50% over 7 days and price down. This is the practical reprint or restock tell (see 3.9).
- **Caveats.** Depth starts 2026-07-07, so 30-day change is available now, 90-day from about October 2026, and year-over-year only from July 2027. Quantity is capped by what sellers list: a single seller with 200 units moves the figure. The listings ladder (section 4) makes this robust.
- **Cost.** Precomputed columns plus a per-product listings history query (cheap, indexed on `(product_id, snapshot_date DESC)` from 0015). Product-page detail can query it directly like it does for sales history; just drop `.limit(1)` and bound it to 400 days.

### 3.6 Top gainers and losers by period, with the weekly report's screens (tier A, RPC)

- **Value.** The homepage shows three 7D gainers and three 7D losers with no liquidity screen. A $6 pack is excluded by type, but a one-listing ETB that stepped 4x still wins. The weekly report already solved this.
- **Rule** (port from `generate_weekly_report.py`):
  - price ≥ $15 (`PRICE_FLOOR`);
  - `distinct_prices_365d ≥ 3` (`LIQUIDITY_MIN_DISTINCT_PRICES`);
  - fresh price;
  - optional `units_sold_30d ≥ 3` so "gainer" means traded.
  - Period toggle 7D / 1M / 3M / 1Y. Slice by type.
- **Data.** Summaries RPC returns plus one new column `distinct_prices_365d`:
  ```sql
  SELECT product_id, count(DISTINCT usd_price) AS distinct_prices_365d
  FROM product_price_history WHERE recorded_at >= current_date - 365 GROUP BY product_id;
  ```
- **Caveats.** Returns use a one-sided anchor tolerance (12/18/20/25 days in the report; the RPC differs, see WP18 for consolidation). The web and the PDF must use the same function, which is why 3.12 recommends a single source.
- **Cost.** One extra column (precomputed in 3.1, or a CTE added to the summaries function). Rendering is server-side over the cached summaries.

### 3.7 Pokéfin Sealed Index (tier B, precomputed)

- **Value.** A benchmark. It answers "did my portfolio beat the market?" and "is sealed up this year?", and it is the anchor for a homepage hero, a shareable chart, and the weekly report's front page. Card Ladder's index is its main draw, and no one has one for sealed.
- **Methodology** (publish it on a methodology page):
  - **Constituents:** active products with fresh price, `distinct_prices_365d ≥ 3`, price ≥ $15, excluding booster packs from the headline index (they get their own sub-index).
  - **Weighting:** **equal-weight** for the headline. A market-cap weight needs units outstanding, which nobody has for sealed (print runs are not published). A **traded-value weight** (`units_sold_30d × price`, capped at 5% per constituent) is a defensible secondary index ("Pokéfin Traded-Value Index"). Do not call anything cap-weighted.
  - **Calculation:** chain-linked daily. `L_t = L_{t-1} × (1 + mean_i r_{i,t})` over constituents with a valid return on day t, rebalanced monthly (constituent list frozen on the first of the month). Using a mean of simple returns with monthly rebalance approximates an equal-weight portfolio; clip each `r_{i,t}` at ±50% as an outlier guard.
  - **Gaps:** build a filled grid per constituent (`generate_series` plus carry-forward up to 3 days). A constituent with a longer gap drops out for those days and re-enters without a catch-up jump, by taking its return from the last observed price only when the gap is ≤ 3 days.
  - **Publication:** D-1 only ("as of the close of 2026-09-29 UTC"). Today's partial day mixes repriced and not-yet-repriced products.
  - **Sub-indices:** by product type (Booster Box, ETB, Bundle, Collections, Packs), by generation (Sword & Shield, Scarlet & Violet, Mega), and by age bucket (0-12 months, 1-3 years, 3+ years).
- **SQL sketch (refresh function body, one day):**
  ```sql
  WITH px AS (
    SELECT DISTINCT ON (product_id, recorded_at::date) product_id, recorded_at::date AS day, usd_price
    FROM product_price_history
    WHERE recorded_at >= :d - 4 AND recorded_at < :d + 1
    ORDER BY product_id, recorded_at::date, recorded_at DESC),
  pair AS (
    SELECT t.product_id, t.usd_price / p.usd_price - 1 AS r
    FROM px t
    JOIN LATERAL (SELECT usd_price FROM px p WHERE p.product_id = t.product_id AND p.day < :d
                  ORDER BY p.day DESC LIMIT 1) p ON true
    WHERE t.day = :d)
  INSERT INTO market_index_daily (index_code, day, level, n_constituents, adv, dec, flat)
  SELECT c.index_code, :d,
         prev.level * (1 + avg(greatest(least(pair.r, 0.5), -0.5))),
         count(*), count(*) FILTER (WHERE r > 0.005), count(*) FILTER (WHERE r < -0.005),
         count(*) FILTER (WHERE abs(r) <= 0.005)
  FROM pair JOIN index_constituents c USING (product_id)      -- monthly frozen list
  JOIN market_index_daily prev ON prev.index_code = c.index_code AND prev.day = :d - 1
  GROUP BY c.index_code, prev.level
  ON CONFLICT (index_code, day) DO UPDATE SET level = EXCLUDED.level, ...;
  ```
- **History.** Seed from the start of history, but label points before the live-scrape start as **weekly** (use Monday-to-Monday returns on the flat-filled segment). Daily steps there are artefacts: six zero days and then a jump.
- **Caveats.**
  - Survivorship: `products.active` removes delisted products. The index must keep a product's past contribution, which the chain-linking does naturally, and must never be recomputed with today's list.
  - Smoothed Market Price makes the index smoother than a tradable portfolio.
  - Coverage per day must be stored and shown. Mark a day **provisional** when fewer than 80% of constituents repriced; the drift bug that lost 3,053 product-days shows why.
- **Cost.** Precomputed. Two tables (`index_constituents`, `market_index_daily`), about 10 series × 365 rows a year. Nothing at request time.

### 3.8 Release-cycle curves and cohorts (tier B, partly C)

- **Value.** "Where is this set in its life?" Sealed follows a well-known arc: release spike, post-release trough while print is live, then appreciation after out-of-print. Knowing the typical return at each age, by product type, is the core timing decision for a holder.
- **Data.** `sets.release_date` (or a product release date, section 4), `product_price_history`.
- **Feasible now: age-bucketed cross-section.** For every product-day, compute age = day − release_date, bucket it (0-3m, 3-6m, 6-12m, 1-2y, 2-4y, 4y+), and take the median forward 90-day return by bucket and product type. This pools many products at different ages and does not need any single product's full life.
  ```sql
  SELECT pt.name, width_bucket(d.day - s.release_date, ARRAY[0,90,180,365,730,1460]) AS age_bucket,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY f.usd_price / d.usd_price - 1) AS median_fwd_90d,
         count(*) AS n
  FROM daily_px d
  JOIN LATERAL (SELECT usd_price FROM daily_px f WHERE f.product_id = d.product_id
                AND f.day BETWEEN d.day + 90 AND d.day + 100 ORDER BY f.day LIMIT 1) f ON true
  JOIN products p ON p.id = d.product_id JOIN sets s ON s.id = p.set_id
  JOIN product_types pt ON pt.id = p.product_type_id
  GROUP BY 1, 2;
  ```
- **Per-set curve.** Price indexed to 100 at the first observation after release, x = days since release. Honest for sets released after history starts (about mid-2025 onward: late Scarlet & Violet and Mega Evolution era). Earlier sets show only mid-life.
- **Caveats.**
  - About one year of history means 90-day forward returns come from about 9 months of start dates: cohorts are small, and the lead item in the UI must show `n`.
  - The anchor should be **MSRP**, not the first observed price, for a true "premium over retail" curve (section 4).
  - Products whose real release differs from the set's date (PC ETBs, later collections) are misplaced on the x-axis.
- **Cost.** Precomputed weekly into `release_cycle_stats`. It is an expensive self-join over the full history, which is fine once a week and not at request time.

### 3.9 Reprint and supply-shock signals (tier B heuristic, C for real)

- **Value.** A reprint announcement is the single biggest risk to a sealed hold. Users want an early warning.
- **What the data supports:** a supply-shock detector, not a reprint detector.
  - "Supply wave": `qty_available` up ≥50% over 7 days **and** `lowest_ask` down ≥5% **and** `units_sold_7d` not up proportionally.
  - "Restock": several products of the same set shocked the same week, which signals a set-level event rather than one seller.
- **SQL.** From `product_daily_stats.qty_change_7d_pct`, grouped by `set_id` and week.
- **Caveats.** About 85 days of listings, one venue, and single-seller dumps look identical to restocks without seller counts (section 4). Label it "Supply shock", link to the evidence (supply chart), and never say "reprint" without a curated event.
- **Real signal (C).** A curated `set_events` table (`reprint_announced`, `reprint_shipped`, `out_of_print`, `pc_restock`, with date and source URL), entered by the owner. Cheap to maintain (a few rows a month) and worth a lot: overlay the events on charts and measure average price reaction around them after a few events.

### 3.10 Box NAV vs market for every box, and cost per pack (tier C, cheap)

- **Value.** The box calculator makes users type recipes. Showing, for every booster box, bundle and ETB, "trades at 12% over 36 packs" is the rip-or-hold number. Cost per pack is the universal comparison across sealed products, and collectors ask for it constantly.
- **Data.**
  - Pack prices: booster-pack products (`product_types.name = 'booster_pack'`), with the standard-pack rule from `useBoosterBoxPrices.getPackPrice`.
  - Box prices: `usd_price`.
  - **Missing:** pack count and pack set per product (ETBs held 8, 9 or 10 packs depending on era; collections hold packs from several sets).
- **SQL sketch (after a `product_contents` table):**
  ```sql
  SELECT b.id, b.usd_price,
         sum(c.quantity * pk.usd_price) + coalesce(max(c.promo_value_usd),0) AS nav,
         b.usd_price / NULLIF(sum(c.quantity * pk.usd_price),0) - 1 AS premium_to_packs,
         b.usd_price / NULLIF(sum(c.quantity),0) AS cost_per_pack
  FROM products b
  JOIN product_contents c ON c.product_id = b.id
  JOIN products pk ON pk.set_id = c.pack_set_id AND pk.product_type_id = :booster_pack AND pk.variant IS NULL
  GROUP BY b.id, b.usd_price;
  ```
  Both prices must pass the freshness gate, or NAV is NULL. Same rule as the calculator: never price a pack from a variant silently.
- **Caveats.** Single-pack Market Price is noisy and often inflated by resealed or weighed-pack risk. Show the premium over time, not just the level. Promo card value is unknown unless the promo is tracked as a product.
- **Cost.** Migration for `product_contents` (about 150 rows of owner curation; boxes and bundles are formulaic, collections take the time). NAV itself is a precomputed column.

### 3.11 Watchlists and price alerts (tier A)

- **Value.** Retention. The daily reason to come back or to open an email. PokeData, TCGPlayer and Card Ladder all gate alerts; a Chrome extension exists only to add them to TCGPlayer (see `competitive-landscape.md`).
- **Tables (migration, cookie-backed route handlers per the WP04/WP05 pattern):**
  ```sql
  CREATE TABLE watchlist_items (user_id uuid REFERENCES auth.users ON DELETE CASCADE,
    product_id bigint REFERENCES products, created_at timestamptz DEFAULT now(),
    PRIMARY KEY (user_id, product_id));
  CREATE TABLE price_alerts (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
    product_id bigint NOT NULL REFERENCES products,
    kind text NOT NULL CHECK (kind IN ('price_below','price_above','pct_move_7d','ask_below_market','supply_below')),
    threshold numeric NOT NULL, currency text NOT NULL DEFAULT 'CAD' CHECK (currency IN ('USD','CAD')),
    active boolean NOT NULL DEFAULT true, last_fired_at timestamptz, last_fired_value numeric,
    created_at timestamptz NOT NULL DEFAULT now());
  -- per-user cap (e.g. 50) via trigger, RLS owner-only, as WP21 does for recipes.
  CREATE TABLE alert_deliveries (alert_id bigint REFERENCES price_alerts ON DELETE CASCADE,
    day date, value numeric, sent_at timestamptz, PRIMARY KEY (alert_id, day));  -- idempotency
  ```
- **Evaluation:** `get_due_alerts(p_day date)`, SECURITY DEFINER and executable only by `service_role`. It joins `price_alerts` to `product_daily_stats` for the day and converts CAD thresholds with that day's `exchange_rates` row. It returns alerts that crossed since `last_fired_at`, with hysteresis: re-arm only after the value moves back 2% past the threshold, so flapping on a smoothed series does not spam.
- **Delivery.** Recommended: a **Vercel Cron** route (`/api/cron/alerts`, `CRON_SECRET` header, daily at about 01:00 UTC after D-1 is final) that calls `get_due_alerts`, sends through **Brevo** (SMTP or HTTP API, free 300 a day), and writes `alert_deliveries`. Rejected: sending from the laptop scraper. It would need read access to user tables and emails, which is the opposite of WP21's least-privilege role, and alerts would stop whenever the laptop sleeps.
- **Also needed:** unsubscribe token per user, a digest mode (one email a day listing all triggered alerts), CASL-compliant footer (Canadian owner and audience).
- **Caveats.** Daily data, so promise "daily alerts", never "real-time". The `ask_below_market` alert inherits the shipping caveat. Freshness gate: never fire on a withheld price.
- **Cost.** Two small user tables plus one function plus one cron route. Brevo free tier until more than about 300 triggered users a day.

### 3.12 Weekly report on the web (tier A)

- **What the report computes that the site does not:**
  - Median return per **product category** per window (1M/3M/6M/1Y), each with its own `n` and a minimum sample of 3.
  - Set average returns per window.
  - Top 5 per window, screened (price floor, liquidity screen).
  - Count of screened-out products.
  - Derived narrative lines: leading and trailing category, best one-year category.
  - Earliest observation date and observation count.
- **Two options:**
  1. **Recommended: the generator writes its summary.** `generate_weekly_report.py` already writes `summary.json`. Extend it to upsert `weekly_reports(issue_date date PK, anchor_date, payload jsonb, pdf_path text, created_at)`, and upload the PDF to Storage. The web renders `/weekly/[date]` (ISR, `revalidateTag('weekly')`) plus an archive index. The PDF and the web cannot disagree because they share one payload, and each issue becomes an indexable SEO page.
  2. Port the computations to a SQL RPC. More work, and two implementations to keep in sync (the README already documents how much care went into matching the site's return rules).
- **Caveats.** WP21 makes the report read with the public key. Writing `weekly_reports` needs an INSERT/UPDATE grant for the `pokefin_scraper` role, or the generator runs its write step through that role. Add it to the WP21 grant list rather than widening the report's key.
- **Cost.** One table plus one page. No new computation.

### 3.13 Risk metrics done properly (tier A, fixes current numbers)

- **Value.** Today's "Volatility 30D" and "volatility90" are the standard deviation of day-to-day percent changes between **consecutive observed days**. A 4-day gap counts as one day, flat-filled backfill days contribute zeros, and Market Price smoothing suppresses variance. The numbers are not comparable across products with different gap patterns.
- **Proposal.**
  - Annualised volatility from **weekly** log returns over 26 or 52 weeks (Monday-anchored from the daily grid), labelled "Market Price volatility (weekly, annualised)".
  - Max drawdown over the full tracked history, alongside the existing 1Y.
  - **Downside capture vs the index** (3.7): how a product falls when the market falls, which is the most useful risk number for a collector choosing between two boxes.
- **SQL.** `stddev_samp(ln(p_w / p_{w-1})) * sqrt(52)` over the weekly grid in the refresh function.
- **Cost.** Precomputed columns. Coordinate with WP18 (`marketMath.ts`) so the TS and SQL definitions stay the same.

### 3.14 CAD done properly (tier A, correctness)

- **Value.** The owner and audience are Canadian. A CAD holder's return is `(P1·FX1)/(P0·FX0) − 1`. The site currently shows `(P1·FX_today)/(P0·FX_today) − 1`, which equals the USD return. Over the last year USD/CAD has moved a few percent, which is the same size as many 30D sealed returns.
- **Data.** `exchange_rates(usd_to_cad, recorded_at)`: dated BoC rates, about 6 duplicate rows per day, none on weekends.
- **SQL:**
  ```sql
  CREATE VIEW fx_daily AS
  SELECT g.day, (SELECT usd_to_cad FROM exchange_rates e
                 WHERE e.recorded_at::date <= g.day ORDER BY e.recorded_at DESC LIMIT 1) AS usd_to_cad
  FROM generate_series((SELECT min(recorded_at)::date FROM exchange_rates), current_date, '1 day') g(day);
  ```
  Better, materialise `fx_daily` in the refresh function (a few hundred rows) and have the scraper stop inserting duplicates (WP16 territory: upsert on `recorded_at::date`).
- **Uses.**
  - CAD price history on charts (price × that day's rate).
  - CAD returns next to USD returns.
  - Portfolio cost basis in CAD from the rate on `purchase_date`. Plus a lot-level "currency paid" field, since a Canadian who paid CAD should enter CAD. That is a `portfolio_lots.currency` column, mirroring WP06's recipe `currency`.
  - A "currency effect" line in portfolio attribution: sealed return vs FX return.
- **Caveats.** Rates exist only from the first scraper run. Before that, fall back to BoC's Valet API (`https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json`, free, full history) for a one-off backfill. That is also a more robust source than scraping the HTML table in `fetch_and_store_exchange_rate`.
- **Cost.** Tiny table, one backfill script run, frontend changes through WP20's CurrencyProvider.

### 3.15 CAD vs USD arbitrage (tier C, not feasible on current data)

- **Why not.** Every price in the database is a TCGPlayer US market price. Arbitrage needs a **Canadian** price (Canadian retailers, eBay.ca sold, local marketplaces). None is collected.
- **What is feasible now: landed cost for a Canadian buyer.** `usd_price × fx + shipping estimate + GST/HST on import + broker fee`, parameterised by province. Compare it to a user-entered Canadian price: "worth importing?" as a calculator. No new data needed. Label estimates clearly; duties on trading cards are generally zero, but tax and brokerage are real.
- **Data needed for real arbitrage.** See section 4, item 7. Not cheap; do not start here.

### 3.16 Seasonality (tier C: needs time)

- **Feasible now.** Day-of-week sales volume from `day` buckets (small value). One year of weekly volume buckets from the annual backfill gives **one** holiday cycle, which is an anecdote, not seasonality.
- **Recommendation.** Do not ship a seasonality feature before two full years of data (about July 2027 for volume, mid-2027 for daily price). Keep collecting; nothing extra is required. At most, annotate the volume chart with Q4 shading.

### 3.17 Correlation between sets and diversification (tier B)

- **Value.** For portfolio users: "your holdings are 80% correlated, so you own one bet".
- **Data.** Weekly returns of set sub-indices (3.7 grid, grouped by set), 52 weeks, requiring at least 26 overlapping weeks.
- **SQL.** `corr(a.r, b.r)` over a self-join of weekly set returns, about 60 sets → about 1,800 pairs, run weekly into `set_correlation_weekly`.
- **Caveats.** Smoothed Market Price inflates correlation, and the market-wide factor dominates. Show correlation **to the index** (beta), which is robust and useful, before any pairwise matrix, which is noisy with n ≈ 52 and easy to over-read.
- **Cost.** Precomputed weekly. The portfolio page then computes the holding-weighted beta in JS.

### 3.18 More candidates (my additions)

| Idea | Value | Data | Tier and cost |
|---|---|---|---|
| **Portfolio vs index benchmark** | "You beat sealed by 4% this year." The feature investors expect first. | WP10 `get_portfolio_history` plus `market_index_daily`. | A once 3.7 exists. JS only. |
| **Portfolio liquidity: days to exit** | `holding_qty / (units_sold_30d / 30)` per holding. Flags "you own 12 of something that sells 3 a month". Unique to Pokéfin. | Holdings plus the volume RPC. | A. JS only. |
| **Relative value vs peers** | z-score of a product's price or 90D return within its type and age bucket: "cheapest ETB of its era". | `product_daily_stats`. | A. Precomputed column. |
| **Moving-average regime** | Price vs 50-day and 200-day MA. Feeds breadth and a simple trend badge. | Price history. The 200-day MA crosses flat-filled backfill, so compute on the weekly grid for 200-day. | A. Precomputed. |
| **Daily sale-price band on the chart** | Shade `low_sale_price` to `high_sale_price` behind the Market Price line. Shows dispersion and whether Market Price is lagging real sales. | `product_sales_history` (already fetched by the product page). | A. Frontend only. |
| **Units per transaction** | Bulk buying by dealers ahead of a move. | `quantity_sold / transaction_count`. | A. Frontend only. |
| **Screener presets** | "Near 52w low, liquid", "Supply drying up", "Below pack NAV", "Down >30% from high". Saved as URL state (WP08). | `product_daily_stats`. | A once 3.1 lands. |
| **Data coverage badges and methodology page** | Trust: show per-product first tracked date, days observed in the last 90 days, and whether history is daily or weekly-filled. | Price history. | A. Precomputed columns `first_day`, `obs_90d`. |
| **Set-level "complete the set" cost** | Cost to own one of every tracked product in a set, tracked over time. Collectors ask for it. | Summaries grouped by set. | A. RPC or JS. |

---

## 4. Missing data that would matter most

Ordered by value divided by cost.

| # | Data | Unlocks | How to get it | Cost |
|---|---|---|---|---|
| 1 | **Listings price ladder** (first 50 listings: price, shipping, quantity, seller key) | True depth ("units within 5% of lowest ask", "cost to buy 10"), a robust supply trend, seller count (single-seller dumps vs restocks), shipping-inclusive ask. | The scraper already POSTs to `mp-search-api` with `"size": 1`. Set `"size": 50` and store aggregates (`qty_within_5pct`, `qty_within_10pct`, `seller_count_top50`, `lowest_ask_with_shipping`) as new nullable columns on `product_listings_history`. The response fields for shipping and seller need confirming against a live response first; they are not parsed today. | **Zero extra requests**; a slightly larger response. One migration, about 40 lines of Python. |
| 2 | **MSRP per product** (USD and CAD) | Premium over retail (the headline metric in sealed), release-cycle curves anchored at retail, "at or under MSRP" alerts, better box NAV context. | Owner curation. MSRPs are standard by product type and era (e.g. ETB, booster bundle), so about 20 rules plus exceptions. `products.msrp_usd`, `msrp_cad`, `msrp_source`. | About 2 to 3 hours curation, one migration. |
| 3 | **Pack count and contents** | Automatic NAV for every box (3.10), cost per pack across all products, a pre-filled box calculator. | `product_contents(product_id, pack_set_id, quantity, promo_value_usd NULL)`. Boxes (36) and bundles (6) are formulaic; ETB counts vary by era; collections need a lookup. | About 2 to 4 hours curation, one migration. |
| 4 | **Product release date** | Correct x-axis for release curves and age buckets, "new release" feeds, correct CAGR start for late products. | `products.release_date` nullable, defaulting to the set date in queries. | About 1 hour for the known exceptions (PC products, later collections). |
| 5 | **Print status and events** | Reprint risk, out-of-print tags, event overlays, event studies after a few events. | `set_events` table, curated from official announcements. | Minutes a month. |
| 6 | **FX history backfill and dedupe** | Correct CAD history before the first scraper run. | BoC Valet API (free JSON, full history). Replace the HTML scrape too. | About 1 hour. |
| 7 | **Canadian market prices** | Real CAD vs USD arbitrage and Canadian-market Market Price. | No cheap clean source. eBay's sold-data API (Marketplace Insights) is restricted access. The free Browse API gives **active** eBay.ca listings only. Scraping Canadian retailers means ToS review and per-site parsers. | High. Defer; ship the landed-cost calculator instead (3.15). |
| 8 | **Individual recent sales** | Median of the last N sales, outlier detection, "last sold" on product pages. | TCGPlayer's product page shows latest sales from an internal endpoint. Unverified: confirm the endpoint and its rate tolerance before committing. One more request per product per day. | Medium. Doubles request load on a bot-sensitive host; only if item 1 proves insufficient. |
| 9 | **History older than one year** | True all-time highs, full release curves for older sets. | TCGPlayer's `infinite-api` stops at `annual`. PriceCharting and similar sell longer history (paid). | Paid; not recommended. The fix is time: keep every day (WP16's pending-row durability matters here). |

**Collection hygiene with outsized value** (belongs with WP16 or a follow-up):
- Log the TCGPlayer bucket granularity with every price row (`source_range text`: `month`, `quarter`, `annual`, `live`) so analytics can tell real daily points from flat-filled ones. Today that is inferable only from dates.
- Keep the scraper's per-run coverage (products attempted, priced, listings captured) in a `scrape_runs` table. It feeds the index "provisional" flag and a public status line.

---

## 5. Cost model: RPC vs precomputed

| Pattern | Use for | Why |
|---|---|---|
| **Existing cached RPC plus JS** (no DB change) | Breadth v1 (3.2), ask premium (3.4), units per transaction, sale-price band, portfolio days-to-exit, top movers period toggle once `distinct_prices_365d` exists. | Data is already in the cached `get_market_product_summaries` and volume payloads. |
| **`product_daily_stats` via `refresh_market_analytics()`** | ATH and range, MAs, liquidity score, supply trend, days of supply history, weekly volatility, NAV, relative value, coverage. | Heavy window functions over full history must not run per request under the 3 s anon timeout. Rows double as the history of derived metrics. |
| **Nightly D-1 finalisation** | Index levels and breadth history (3.7), alerts (3.11). | Needs a complete day. |
| **Weekly job** | Release-cycle stats (3.8), correlation and beta (3.17), weekly report payload (3.12). | Expensive self-joins, slow-moving outputs. |

**Who runs the refresh:**
- **Per run:** the scraper calls `select refresh_market_analytics(current_date)` at the end of `update_prices()`, then triggers WP11's revalidation. Needs `GRANT EXECUTE` to WP21's `pokefin_scraper` role. The function is SECURITY DEFINER, owned by a role that can write the analytics tables, with a pinned `search_path` (0007 pattern).
- **Nightly:** **pg_cron** (available on Supabase free tier) at 00:30 UTC for D-1 finalisation and the index, so the benchmark keeps publishing when the laptop is off. The index then reports honestly "provisional: 41% coverage" instead of stopping.
- **Alerts:** Vercel Cron as in 3.11.

**Performance budget.** Every new page read is a single-table indexed read on `product_daily_stats` or `market_index_daily`, cached with `revalidateTag` (WP11). Catalog pages must not fetch history. The index chart is a few hundred points, so render it as a server SVG like WP09's sparklines, not a Recharts client bundle, to protect the WP12 bundle budget.

---

## 6. Suggested sequencing (provisional migration numbers)

1. **Zero-migration quick wins** (one PR). Breadth strip on `/` and `/market`. Liquidity-screened top movers with a period toggle, if the `distinct_prices_365d` column is added via WP10's bounded summaries, otherwise wait for step 2. Ask premium and units per transaction on the product page. Sale-price band on the chart. 52-week range on the product page from the history already loaded.
2. **`0033_product_daily_stats.sql`**: table, indexes, `refresh_market_analytics(date)`, grants; one-off backfill; pg_cron schedule. Then the screener presets and new product-page tiles.
3. **`0034_fx_daily.sql`** plus the Valet backfill: CAD-correct history, returns and cost basis, and `portfolio_lots.currency`.
4. **`0035_market_index.sql`**: `index_constituents`, `market_index_daily`; methodology page; homepage hero; portfolio benchmark.
5. **`0036_watchlists_alerts.sql`** plus the cron route and Brevo.
6. **`0037_weekly_reports.sql`** plus the generator write step and `/weekly` pages.
7. **`0038_product_attributes.sql`** (MSRP, pack contents, product release date, set events) plus curation, then NAV for every box, cost per pack, release-cycle curves.
8. **Scraper:** listings ladder (item 1 in section 4) with `0039_listings_ladder_columns.sql`.

---

## 7. Read-only checks for the owner before building

Run in the Supabase SQL editor. They replace every estimate above with measured figures.

```sql
-- History depth and density per product (expect ~300 rows; watch min(first_day) and obs_90d)
SELECT count(*) AS products,
       min(first_day), percentile_cont(0.5) WITHIN GROUP (ORDER BY first_day) AS median_first_day,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY obs_90d) AS median_obs_last_90d
FROM (SELECT product_id, min(recorded_at::date) AS first_day,
             count(*) FILTER (WHERE recorded_at >= current_date - 90) AS obs_90d
      FROM product_price_history GROUP BY product_id) s;

-- Share of history that is flat-filled backfill (runs of >=6 identical consecutive prices)
WITH d AS (SELECT product_id, recorded_at::date AS day, usd_price,
                  usd_price = lag(usd_price) OVER (PARTITION BY product_id ORDER BY recorded_at) AS same
           FROM product_price_history)
SELECT date_trunc('month', day) AS m, avg(same::int) AS share_unchanged_day_to_day
FROM d GROUP BY 1 ORDER BY 1;

-- Listings history start and coverage
SELECT min(snapshot_date), max(snapshot_date), count(DISTINCT product_id),
       count(*)::numeric / NULLIF(count(DISTINCT snapshot_date),0) AS products_per_day
FROM product_listings_history;

-- Daily sales coverage start
SELECT min(bucket_date) FILTER (WHERE granularity='day'), min(bucket_date) FILTER (WHERE granularity='week')
FROM product_sales_history;

-- FX history range and duplicates
SELECT min(recorded_at), max(recorded_at), count(*), count(DISTINCT recorded_at::date) FROM exchange_rates;

-- How many products the weekly report's liquidity screen would remove from web rankings
SELECT count(*) FROM (SELECT product_id FROM product_price_history
  WHERE recorded_at >= current_date - 365 GROUP BY product_id HAVING count(DISTINCT usd_price) < 3) s;

-- How often the lowest ask sits below Market Price (deal-alert base rate)
SELECT avg((l.lowest_listing_price < p.usd_price * 0.97)::int)
FROM product_listings_history l JOIN products p ON p.id = l.product_id
WHERE l.snapshot_date = current_date - 1 AND l.lowest_listing_price IS NOT NULL;
```
