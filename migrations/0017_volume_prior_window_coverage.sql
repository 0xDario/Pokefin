-- Migration: Prefer the exact daily prior-30d sum over the weekly estimate.
-- 0016 emitted GREATEST(prior_30d_day, prior_30d_week) whenever both sources
-- existed. That was safe only while daily rows barely reached into the prior
-- window; once daily coverage grows past 60 days the weekly estimate (a 28-day
-- sum scaled by 30/28) still exceeds the exact daily sum for roughly half the
-- catalog, inflating units_sold_prior_30d — the volume-trend denominator — by
-- 2-6% in aggregate and up to 10-14% for individual products, which is enough
-- to push products across the +/-20% threshold getPulseSignal uses and show a
-- wrong Market Pulse badge.
-- Fix: pick the EXACT source rather than the larger one. Count how many of the
-- 30 prior-window days actually have a 'day' bucket (TCGPlayer writes explicit
-- zero buckets, so a present row is real data and an absent row is missing
-- data) and use the daily sum only when that coverage is essentially complete
-- (>= 28 of 30 days, allowing for the occasional missed scraper run).
-- Otherwise fall back to the weekly estimate, then to whatever daily partial
-- exists. Same RETURNS TABLE shape as 0015/0016, so plain CREATE OR REPLACE.
-- Frontend mirror: getPriorUnitsSold30d() in frontend/app/lib/marketPulse.ts
-- applies the identical >= 28 coverage rule; keep the two in sync.
-- Idempotent.
--
-- Verification:
--   -- Function still returns one row per active product:
--   SELECT count(*) FROM public.get_market_product_volume_metrics();
--   -- Prior-window figures are still populated after the change:
--   SELECT count(*) FROM public.get_market_product_volume_metrics()
--    WHERE units_sold_prior_30d IS NOT NULL;
--   -- Products whose prior window is fully covered by daily rows must now
--   -- match the exact daily sum (this should return 0 rows):
--   WITH cov AS (
--     SELECT sh.product_id,
--            COUNT(*) FILTER (
--              WHERE sh.granularity = 'day'
--                AND sh.bucket_date BETWEEN current_date - 59 AND current_date - 30
--            ) AS day_coverage,
--            SUM(sh.quantity_sold) FILTER (
--              WHERE sh.granularity = 'day'
--                AND sh.bucket_date BETWEEN current_date - 59 AND current_date - 30
--            ) AS day_sum
--     FROM public.product_sales_history sh
--     GROUP BY sh.product_id
--   )
--   SELECT m.product_id, m.units_sold_prior_30d, cov.day_sum
--   FROM public.get_market_product_volume_metrics() m
--   JOIN cov ON cov.product_id = m.product_id
--   WHERE cov.day_coverage >= 28
--     AND m.units_sold_prior_30d IS DISTINCT FROM cov.day_sum;
--   SELECT proname, proconfig FROM pg_proc
--    WHERE proname = 'get_market_product_volume_metrics';

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
    -- How many of the 30 prior-window days have a daily bucket at all. Rows
    -- are unique per (product_id, bucket_date, granularity), so COUNT(*) here
    -- is a distinct-day count.
    COUNT(*) FILTER (
      WHERE sh.granularity = 'day'
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
  -- Exact beats larger: only trust the daily sum once it (nearly) covers the
  -- whole prior window, otherwise use the scaled weekly estimate.
  CASE
    WHEN sa.prior_day_coverage >= 28 THEN sa.prior_30d_day
    ELSE COALESCE(sa.prior_30d_week, sa.prior_30d_day)
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
