-- Migration: Reject window totals that contain a hole.
--
-- 0018 guards freshness only: it checks that the NEWEST 'day' bucket is recent
-- enough. That misses a bucket missing from the MIDDLE of a window — a skipped
-- API bucket or a partially-applied upsert — because a later bucket collected
-- successfully still satisfies the freshness test. The window then publishes as
-- complete while silently understating the total, which feeds volume-trend
-- sorting on /market and the Market Pulse signal on /product/[id].
--
-- The migration's own premise is that an absent day row means "not collected"
-- (TCGPlayer writes explicit zero-quantity buckets), so an interior hole must
-- be treated the same way as a stale tail: unknown, not zero.
--
-- Rule: within each reported window, the distinct collected days must form an
-- unbroken run. Coverage is measured between the window's OWN first and last
-- collected day rather than across the whole window, so a product younger than
-- the window still reports its lifetime total instead of being nulled out —
-- the same choice getUnitsSoldWindow() makes on the frontend.
--
-- Only buckets with a non-NULL quantity_sold count as collected, matching SQL
-- SUM() semantics and countDayCoverage()/getUnitsSoldWindow() in
-- frontend/app/lib/marketPulse.ts. Keep the two sides in sync.
--
-- Same RETURNS TABLE shape as 0018, so plain CREATE OR REPLACE works.
-- Idempotent.
--
-- Verification:
--   -- No product should currently be nulled by the gap rule (prod had 0
--   -- interior gaps and 0 NULL quantities when this was written):
--   SELECT count(*) FILTER (WHERE units_sold_30d IS NOT NULL) AS reporting_30d
--     FROM public.get_market_product_volume_metrics();
--   -- Cross-check the underlying data really is gap-free:
--   SELECT count(*) FROM (
--     SELECT product_id, count(*) AS n,
--            max(bucket_date) - min(bucket_date) + 1 AS span
--       FROM public.product_sales_history
--      WHERE granularity = 'day' AND quantity_sold IS NOT NULL
--      GROUP BY product_id
--   ) s WHERE s.n <> s.span;   -- expect 0

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
    -- Collected-day count and span for the 7d window; equal means unbroken.
    COUNT(*) FILTER (
      WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
        AND sh.bucket_date >= current_date - 6
    ) AS days_7d,
    (MAX(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date >= current_date - 6
     ) - MIN(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date >= current_date - 6
     ) + 1) AS span_7d,

    SUM(sh.quantity_sold) FILTER (
      WHERE sh.granularity = 'day' AND sh.bucket_date >= current_date - 29
    ) AS units_sold_30d,
    COUNT(*) FILTER (
      WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
        AND sh.bucket_date >= current_date - 29
    ) AS days_30d,
    (MAX(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date >= current_date - 29
     ) - MIN(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date >= current_date - 29
     ) + 1) AS span_30d,

    SUM(sh.quantity_sold) FILTER (
      WHERE sh.granularity = 'day'
        AND sh.bucket_date BETWEEN current_date - 59 AND current_date - 30
    ) AS prior_30d_day,
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
  -- A window reports only when it is fresh AND its collected days are unbroken.
  CASE WHEN df.newest_day_bucket >= current_date - 3
        AND sa.days_7d > 0 AND sa.days_7d = sa.span_7d
       THEN sa.units_sold_7d END AS units_sold_7d,
  CASE WHEN df.newest_day_bucket >= current_date - 3
        AND sa.days_30d > 0 AND sa.days_30d = sa.span_30d
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
        AND sa.days_30d > 0 AND sa.days_30d = sa.span_30d
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
