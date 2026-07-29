-- Migration: Apply the gap guard to the prior-30d window too.
--
-- 0019 added a count-versus-span check to the 7d and 30d windows but left the
-- prior-30d branch on the older `prior_day_coverage >= 28` test alone. Those
-- are not the same thing: 28 non-null buckets can be spread across all 30 days
-- with one or two holes in the middle and still pass, publishing an incomplete
-- prior_30d_day instead of falling back to the weekly estimate. Since that
-- value is the DENOMINATOR of the volume trend, understating it inflates the
-- trend and can flip the Market Pulse signal across getPulseSignal's +/-20%
-- threshold.
--
-- The frontend mirror already behaves correctly by construction:
-- getPriorUnitsSold30d() takes its daily figure from getUnitsSoldWindow(),
-- which returns null on an interior hole, so it already falls through to the
-- weekly estimate. This migration brings the RPC back in line with it.
--
-- Rule for the prior window, now identical in spirit to the other two: trust
-- the exact daily sum only when the collected days are both numerous enough
-- (>= 28 of 30, tolerating a couple of missed runs at the window edges) AND
-- unbroken (count = span). Otherwise use the scaled weekly estimate.
--
-- Same RETURNS TABLE shape as 0019, so plain CREATE OR REPLACE works.
-- Idempotent.
--
-- Verification:
--   -- Prior-30d should still be reported for the backfilled catalogue
--   -- (weekly-backed, so unaffected by daily holes):
--   SELECT count(*) FILTER (WHERE units_sold_prior_30d IS NOT NULL)
--     FROM public.get_market_product_volume_metrics();
--   -- Any product whose prior window has a hole must NOT report the raw
--   -- daily sum (expect 0 rows):
--   WITH p AS (
--     SELECT product_id,
--            count(*) FILTER (WHERE quantity_sold IS NOT NULL) AS n,
--            max(bucket_date) - min(bucket_date) + 1 AS span,
--            sum(quantity_sold) AS day_sum
--       FROM public.product_sales_history
--      WHERE granularity = 'day'
--        AND bucket_date BETWEEN current_date - 59 AND current_date - 30
--      GROUP BY product_id
--   )
--   SELECT m.product_id FROM public.get_market_product_volume_metrics() m
--     JOIN p ON p.product_id = m.product_id
--    WHERE p.n <> p.span AND m.units_sold_prior_30d = p.day_sum;

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
    -- Span of the prior window's collected days, so a hole in the middle is
    -- caught the same way it is for the 7d/30d windows.
    (MAX(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date BETWEEN current_date - 59 AND current_date - 30
     ) - MIN(sh.bucket_date) FILTER (
       WHERE sh.granularity = 'day' AND sh.quantity_sold IS NOT NULL
         AND sh.bucket_date BETWEEN current_date - 59 AND current_date - 30
     ) + 1) AS prior_span,
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
  -- Exact beats larger, but only when the daily record is both complete
  -- enough and unbroken; otherwise the scaled weekly estimate is the better
  -- denominator. Mirrors getPriorUnitsSold30d() in marketPulse.ts, which gets
  -- its daily figure from getUnitsSoldWindow() and so already returns null on
  -- an interior hole.
  CASE
    WHEN sa.prior_day_coverage >= 28
     AND sa.prior_day_coverage = sa.prior_span
     AND sa.prior_30d_day IS NOT NULL
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
