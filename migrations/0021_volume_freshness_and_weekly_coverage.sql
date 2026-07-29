-- Migration: Measure freshness from usable buckets, and require a complete
-- weekly set before scaling the fallback.
--
-- Two holes left by 0018-0020, both reachable through
-- parse_daily_sales_buckets writing quantity_sold = NULL for a malformed or
-- negative value from TCGPlayer:
--
--  1. day_freshness took max(bucket_date) over ALL day rows. A run of trailing
--     NULL-quantity buckets therefore advanced newest_day_bucket and made the
--     freshness test pass while the last usable data was far older, letting a
--     stale partial 7d/30d sum publish as complete. Freshness now comes only
--     from rows with a non-null quantity.
--
--  2. The weekly fallback summed whatever weekly buckets existed in the fixed
--     28-day range and scaled by 30/28 regardless. That range spans exactly
--     four Monday buckets; with fewer present (interrupted annual backfill,
--     failed upsert, null quantity) the scaled figure understates the volume
--     trend DENOMINATOR and inflates the trend. The fallback now requires all
--     four, and falls through to whatever daily partial exists otherwise.
--
-- Both rules are mirrored in frontend/app/lib/marketPulse.ts
-- (getUnitsSoldWindow's newestDayKey, and PRIOR_WINDOW_WEEK_BUCKETS in
-- getPriorUnitsSold30d). Keep the two sides in sync.
--
-- Same RETURNS TABLE shape as 0020, so plain CREATE OR REPLACE works.
-- Idempotent.
--
-- Verification:
--   SELECT count(*) FILTER (WHERE units_sold_prior_30d IS NOT NULL)
--     FROM public.get_market_product_volume_metrics();
--   -- Products whose newest usable bucket is stale must report NULL 7d:
--   SELECT count(*) FROM public.get_market_product_volume_metrics()
--    WHERE units_sold_7d IS NOT NULL;

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
-- Freshness must come from buckets that carry a real quantity. A row whose
-- quantity failed to parse means the day was visited but its value is
-- unknown; letting its date advance newest_day_bucket would make a run of
-- unusable trailing buckets look like fresh collection and let a stale
-- partial sum publish as complete.
day_freshness AS (
  SELECT sh.product_id, max(sh.bucket_date) AS newest_day_bucket
  FROM public.product_sales_history sh
  JOIN active_products ap ON ap.id = sh.product_id
  WHERE sh.granularity = 'day'
    AND sh.quantity_sold IS NOT NULL
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
        AND sh.quantity_sold IS NOT NULL
        AND sh.bucket_date BETWEEN current_date - 63 AND current_date - 36
    ) * 30.0 / 28)::bigint AS prior_30d_week,
    -- The 28-day fallback range spans exactly four Monday buckets, and the
    -- sum above is scaled 30/28 on that basis. With one missing -- an
    -- interrupted annual backfill, a failed upsert, a null quantity --
    -- scaling anyway understates the trend denominator and inflates the
    -- trend, so the fallback is only usable when all four are present.
    COUNT(*) FILTER (
      WHERE sh.granularity = 'week'
        AND sh.quantity_sold IS NOT NULL
        AND sh.bucket_date BETWEEN current_date - 63 AND current_date - 36
    ) AS prior_week_buckets,

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
    WHEN sa.prior_week_buckets = 4 THEN sa.prior_30d_week
    ELSE sa.prior_30d_day
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
