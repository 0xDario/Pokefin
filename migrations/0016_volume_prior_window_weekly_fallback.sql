-- Migration: Weekly-bucket fallback for the prior-30d volume window.
-- At launch, granularity='day' rows only reach ~30 days back (the scraper's
-- range=month buckets), so units_sold_prior_30d in
-- get_market_product_volume_metrics() was NULL for every product and the
-- volume-trend / pulse-signal UI stayed empty for the first month. The
-- backfilled Monday-anchored 'week' rows cover that window: approximate the
-- prior 30 days from the four week buckets spanning roughly days 36-63 back,
-- scaled from 28 to 30 days. When both sources exist, take the larger (each
-- can only undercount: day rows from partial coverage, week rows from
-- boundary clipping). Once daily rows accumulate past 60 days the exact day
-- sum dominates naturally. Same RETURNS TABLE shape as 0015, so plain
-- CREATE OR REPLACE. Frontend mirror: getPriorUnitsSold30d() in
-- frontend/app/lib/marketPulse.ts.
-- Idempotent.
--
-- Verification:
--   SELECT count(*) FROM public.get_market_product_volume_metrics()
--    WHERE units_sold_prior_30d IS NOT NULL;  -- should be > 0 after backfill

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
),
latest_listings AS (
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
  sa.units_sold_7d,
  sa.units_sold_30d,
  CASE
    WHEN sa.prior_30d_day IS NOT NULL AND sa.prior_30d_week IS NOT NULL
      THEN GREATEST(sa.prior_30d_day, sa.prior_30d_week)
    ELSE COALESCE(sa.prior_30d_day, sa.prior_30d_week)
  END AS units_sold_prior_30d,
  sa.transaction_count_30d,
  ll.active_listings,
  ll.total_quantity_available,
  ll.lowest_listing_price,
  ll.snapshot_date AS listings_snapshot_date
FROM active_products ap
LEFT JOIN sales_agg sa ON sa.product_id = ap.id
LEFT JOIN latest_listings ll ON ll.product_id = ap.id;
$$;

ALTER FUNCTION public.get_market_product_volume_metrics()
  SET search_path = public;
