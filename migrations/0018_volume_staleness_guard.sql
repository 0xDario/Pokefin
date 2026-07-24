-- Migration: Staleness guard for the volume windows, so the RPC and the
-- frontend agree about what "no data" means.
--
-- product_sales_history's 'day' rows are only as fresh as the last scraper
-- run. When collection lags, SUM(...) FILTER over a partially-covered window
-- returns a real-looking number that is really a partial sum — e.g. with a
-- 16-day lag, units_sold_30d silently reported ~14 days of sales as 30, which
-- dragged the derived volume trend to -64% for a product whose sales had not
-- moved at all.
--
-- frontend/app/lib/marketPulse.ts (getUnitsSoldWindow) already refuses to
-- report a window the daily data does not reach. This applies the identical
-- rule in SQL so /market and /prices (RPC-fed) cannot contradict
-- /product/[id] (client-computed) for the same product.
--
-- Rule, mirrored on both sides: a window is reportable only when the newest
-- 'day' bucket for that product is no more than DAILY_DATA_STALENESS_TOLERANCE
-- days older than that window's END. TCGPlayer's current-day bucket is partial
-- and the scraper visits each product about once a day, so up to ~3 days of
-- lag is normal operation, not missing data. An absent day row never means
-- "zero sold" — TCGPlayer writes explicit zero-quantity buckets.
--
-- Same RETURNS TABLE shape as 0017, so plain CREATE OR REPLACE works.
-- Idempotent.
--
-- Verification:
--   -- Products whose daily data is stale must report NULL, not a partial sum:
--   SELECT count(*) FILTER (WHERE units_sold_7d IS NOT NULL) AS fresh_7d,
--          count(*) FILTER (WHERE units_sold_7d IS NULL)     AS guarded_7d
--     FROM public.get_market_product_volume_metrics();
--   -- Cross-check against actual data age:
--   SELECT max(bucket_date) AS newest_day_bucket, current_date
--     FROM public.product_sales_history WHERE granularity = 'day';

CREATE OR REPLACE FUNCTION public.get_market_product_volume_metrics()
RETURNS TABLE (
  product_id bigint,
  units_sold_7d bigint,
  units_sold_30d bigint,
  units_sold_prior_30d bigint,
  transaction_count_30d bigint,
  active_listings integer,
  total_quantity_available integer,
  lowest_listing_price double precision,
  listings_snapshot_date date
)
LANGUAGE sql
STABLE
AS $$
WITH active_products AS (
  SELECT p.id
  FROM public.products p
  WHERE p.active = true
),
-- Newest daily bucket per product, scanned unrestricted so that data older
-- than the 63-day aggregate window still yields a value (and therefore still
-- trips the guard) rather than looking like a product with no history at all.
day_freshness AS (
  SELECT sh.product_id, max(sh.bucket_date) AS newest_day_bucket
  FROM public.product_sales_history sh
  JOIN active_products ap ON ap.id = sh.product_id
  WHERE sh.granularity = 'day'
  GROUP BY sh.product_id
),
sales_agg AS (
  SELECT
    sh.product_id,
    SUM(sh.quantity_sold) FILTER (
      WHERE sh.granularity = 'day' AND sh.bucket_date >= current_date - 6
    ) AS units_sold_7d,
    SUM(sh.quantity_sold) FILTER (
      WHERE sh.granularity = 'day' AND sh.bucket_date >= current_date - 29
    ) AS units_sold_30d,
    SUM(sh.quantity_sold) FILTER (
      WHERE sh.granularity = 'day'
        AND sh.bucket_date BETWEEN current_date - 59 AND current_date - 30
    ) AS prior_30d_day,
    -- How many of the 30 prior-window days have a daily bucket at all. Rows
    -- are unique per (product_id, bucket_date, granularity), so COUNT(*) here
    -- is a distinct-day count. Only non-NULL quantities count, matching
    -- countDayCoverage() in marketPulse.ts.
    COUNT(*) FILTER (
      WHERE sh.granularity = 'day'
        AND sh.quantity_sold IS NOT NULL
        AND sh.bucket_date BETWEEN current_date - 59 AND current_date - 30
    ) AS prior_day_coverage,
    ROUND(SUM(sh.quantity_sold) FILTER (
      WHERE sh.granularity = 'week'
        AND sh.bucket_date BETWEEN current_date - 63 AND current_date - 36
    ) * 30.0 / 28)::bigint AS prior_30d_week,
    SUM(sh.transaction_count) FILTER (
      WHERE sh.granularity = 'day' AND sh.bucket_date >= current_date - 29
    ) AS transaction_count_30d
  FROM public.product_sales_history sh
  JOIN active_products ap ON ap.id = sh.product_id
  WHERE sh.bucket_date >= current_date - 63
  GROUP BY sh.product_id
)
, latest_listings AS (
  SELECT DISTINCT ON (lh.product_id)
    lh.product_id,
    lh.active_listings,
    lh.total_quantity_available,
    lh.lowest_listing_price,
    lh.snapshot_date
  FROM public.product_listings_history lh
  JOIN active_products ap ON ap.id = lh.product_id
  ORDER BY lh.product_id, lh.snapshot_date DESC
)
SELECT
  ap.id AS product_id,
  -- 3 = DAILY_DATA_STALENESS_TOLERANCE_DAYS in frontend/app/lib/marketPulse.ts.
  -- The 7d and 30d windows both end today, so both use the same guard.
  CASE WHEN df.newest_day_bucket >= current_date - 3
       THEN sa.units_sold_7d END AS units_sold_7d,
  CASE WHEN df.newest_day_bucket >= current_date - 3
       THEN sa.units_sold_30d END AS units_sold_30d,
  -- Exact beats larger: only trust the daily sum once it (nearly) covers the
  -- whole prior window, otherwise use the scaled weekly estimate. The daily
  -- branch additionally requires a non-NULL sum so an all-NULL window falls
  -- through to the weekly estimate instead of reporting NULL.
  CASE
    WHEN sa.prior_day_coverage >= 28 AND sa.prior_30d_day IS NOT NULL
      THEN sa.prior_30d_day
    ELSE COALESCE(sa.prior_30d_week, sa.prior_30d_day)
  END AS units_sold_prior_30d,
  -- Transaction count shares the 30d window, so it shares the 30d guard.
  CASE WHEN df.newest_day_bucket >= current_date - 3
       THEN sa.transaction_count_30d END AS transaction_count_30d,
  ll.active_listings,
  ll.total_quantity_available,
  ll.lowest_listing_price,
  ll.snapshot_date AS listings_snapshot_date
FROM active_products ap
LEFT JOIN sales_agg sa ON sa.product_id = ap.id
LEFT JOIN day_freshness df ON df.product_id = ap.id
LEFT JOIN latest_listings ll ON ll.product_id = ap.id;
$$;

ALTER FUNCTION public.get_market_product_volume_metrics()
  SET search_path = public;
