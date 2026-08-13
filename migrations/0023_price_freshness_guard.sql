-- Migration: Staleness guard for the product price.
--
-- 0018 stopped the sales windows publishing stale sums and 0022 did the same
-- for listings depth, but the price itself — the single most prominent number
-- on every page — never got the treatment. products.usd_price is
-- last-write-wins and is never cleared, so a product whose TCGPlayer SKU
-- stops returning history keeps the last successfully scraped price, and the
-- catalog presents it as today's market price. Same class of
-- fabricated-confidence bug, larger blast radius.
--
-- Six active products are in exactly that state: TCGPlayer's infinite-api
-- returns {"count":0,"result":null} for all four ranges, so they cannot be
-- priced right now (product ids 42, 415, 442, 475, 476, 482). A later sale can
-- make any of them recover automatically. Four have a NULL
-- usd_price and were already withheld. The other two were not:
--   id 415 (Ancient Origins booster box) showed $1,649.99, last recorded
--     2026-06-17 — 55 days stale as of 2026-08-11
--   id 42  (XY ETB, Xerneas) showed $449.95, last recorded 2026-05-08 —
--     95 days stale
--
-- Freshness is measured from the newest product_price_history row, never from
-- products.last_updated. That product-level field is nullable for products
-- that have never priced and is not itself an auditable price event; the
-- history row is the evidence that this exact value was recorded. Failed
-- upstream lookups write neither field.
--
-- 14 days, against 3 for the daily volume buckets, because a price is a much
-- slower signal. The scraper re-prices a product at most once per 23h, so
-- single missed days are routine and blanking on those would hide data still
-- worth showing — sealed prices move on the order of percent-per-week. Two
-- full weeks with nothing recorded cannot be a blip. 14 also keeps a rendered
-- price inside half of the shortest return window on screen (1M / 30 days).
--
-- Mirrored by isPriceFresh() / getFreshUsdPrice() in
-- frontend/app/lib/marketPulse.ts, which guard the /product/[id] path (that
-- page reads product_price_history directly rather than through this RPC).
-- Keep the tolerance in sync on both sides.
--
-- The returns are gated on the same test as the price, in both functions.
-- get_market_product_metrics anchors every return on products.usd_price, so a
-- product whose SKU has gone dead compares its own frozen price against past
-- history rows — and once the window reaches back past the last real
-- recording, the anchor is that same frozen value and the function reports a
-- flat 0.00%. Left ungated, withholding one stale price would publish six
-- stale numbers derived from it, and those zeros are averaged into the
-- homepage 1M return, set momentum and the investment ranking. Volatility,
-- drawdown and trend stay ungated: they are computed from the recorded daily
-- series and remain true descriptions of it however old its last point is.
--
-- get_market_product_summaries gains a column, so CREATE OR REPLACE cannot be
-- used — the return type changes and Postgres rejects it. Nothing depends on
-- the function (get_set_analytics builds on get_market_product_metrics
-- instead), but the DROP does discard two things that have to be put back by
-- hand. The search_path pin from 0007/0009 is one. The EXECUTE grants are the
-- other: 0006 leaves the market RPCs alone, so what they carry is Supabase's
-- bootstrap ACL — PUBLIC plus explicit anon, authenticated and service_role,
-- read out of pg_proc.proacl before this migration was written. A freshly
-- created function gets PUBLIC EXECUTE only, and because anon would keep
-- working *through* PUBLIC the missing role grants would stay invisible until
-- something later revoked PUBLIC. Both are re-applied below.
-- get_set_analytics keeps its shape, so it takes a plain replace and holds on
-- to its own ACL. Idempotent.
--
-- Verification:
--   -- Products whose newest recorded price is stale must report no price
--   -- while still reporting when it was last seen (expect 0 rows):
--   SELECT id, usd_price, price_recorded_at
--     FROM public.get_market_product_summaries()
--    WHERE price_recorded_at < current_date - 14
--      AND usd_price IS NOT NULL;
--
--   -- The two products above must come back with a NULL price (expect 2 rows,
--   -- both NULL):
--   SELECT id, usd_price, price_recorded_at
--     FROM public.get_market_product_summaries()
--    WHERE id IN (42, 415);
--
--   -- No product may publish a return it has no current price to anchor on
--   -- (expect 0 rows):
--   SELECT id, price_recorded_at, return_30d, return_365d
--     FROM public.get_market_product_summaries()
--    WHERE usd_price IS NULL
--      AND num_nulls(return_1d, return_7d, return_30d,
--                    return_90d, return_180d, return_365d) < 6;
--
--   -- The latest-price scan must be index-ordered, not a sort over the whole
--   -- history table (expect an Index Only Scan using
--   -- idx_price_history_product_recorded, and no Sort node):
--   EXPLAIN ANALYZE SELECT DISTINCT ON (h.product_id) h.product_id, h.recorded_at
--     FROM public.product_price_history h
--     JOIN public.products ap ON ap.id = h.product_id AND ap.active = true
--    ORDER BY h.product_id, h.recorded_at DESC;
--
--   -- A set whose only priced products are stale must report no price/day
--   -- rather than an average of prices nobody can buy at (expect 0 rows):
--   WITH fresh_sets AS (
--     SELECT DISTINCT p.set_id
--       FROM public.products p
--      WHERE p.active = true
--        AND p.usd_price > 0
--        AND EXISTS (SELECT 1 FROM public.product_price_history h
--                     WHERE h.product_id = p.id
--                       AND h.recorded_at >= current_date - 14)
--   )
--   SELECT sa.code, sa.price_per_day
--     FROM public.get_set_analytics() sa
--     JOIN public.sets s ON s.code = sa.code
--    WHERE s.id NOT IN (SELECT set_id FROM fresh_sets)
--      AND sa.price_per_day IS NOT NULL;

-- The latest-price scan below needs (product_id, recorded_at DESC) to be an
-- index-ordered read instead of a scan-and-sort over the whole history table.
-- 20260506_market_performance_functions.sql created exactly that index, and
-- 0014_rls_perf_and_dedupe.sql dropped it again; the unique index that remains
-- is on (product_id, recorded_at::date), whose cast cannot satisfy the sort.
-- Production does still carry a matching index under a different name, created
-- outside these files, so this is stated in the shape that repairs a database
-- rebuilt from the migrations alone without touching the one that is live.
CREATE INDEX IF NOT EXISTS idx_price_history_product_recorded
  ON public.product_price_history (product_id, recorded_at DESC);

DROP FUNCTION IF EXISTS public.get_market_product_summaries();

CREATE FUNCTION public.get_market_product_summaries()
RETURNS TABLE (
  id bigint,
  usd_price double precision,
  url text,
  last_updated timestamp without time zone,
  variant text,
  image_url text,
  sku text,
  set_id bigint,
  set_name text,
  set_code text,
  set_release_date date,
  set_expansion_type character varying,
  generation_id bigint,
  generation_name text,
  product_type_id bigint,
  product_type_name text,
  product_type_label text,
  return_1d double precision,
  return_7d double precision,
  return_30d double precision,
  return_90d double precision,
  return_180d double precision,
  return_365d double precision,
  price_recorded_at timestamp without time zone
)
LANGUAGE sql
STABLE
AS $$
-- Newest recorded price per active product. DISTINCT ON walks the
-- (product_id, recorded_at DESC) index created at the top of this migration,
-- so this is an index-ordered scan rather than an aggregate over the whole
-- table.
WITH latest_price AS (
  SELECT DISTINCT ON (h.product_id)
    h.product_id,
    h.recorded_at
  FROM public.product_price_history h
  JOIN public.products ap ON ap.id = h.product_id AND ap.active = true
  ORDER BY h.product_id, h.recorded_at DESC
)
SELECT
  p.id,
  -- 14 = PRICE_STALENESS_TOLERANCE_DAYS in frontend/app/lib/marketPulse.ts.
  -- products.usd_price is last-write-wins and is never cleared, so a product
  -- whose TCGPlayer SKU stops returning history keeps the last price scraped
  -- successfully and would publish it as the current one. Freshness comes from
  -- the price history, never from products.last_updated: the history row is
  -- the auditable evidence that this exact price was recorded.
  CASE WHEN lp.recorded_at >= current_date - 14
       THEN p.usd_price END AS usd_price,
  p.url,
  p.last_updated,
  p.variant,
  p.image_url,
  p.sku,
  s.id AS set_id,
  s.name AS set_name,
  s.code AS set_code,
  s.release_date AS set_release_date,
  s.expansion_type AS set_expansion_type,
  g.id AS generation_id,
  g.name AS generation_name,
  pt.id AS product_type_id,
  pt.name AS product_type_name,
  pt.label AS product_type_label,
  -- Gated on the same freshness test as the price, because every one of these
  -- is anchored on the current price: get_market_product_metrics measures the
  -- move from a past history row to today's value. Withholding usd_price while
  -- still publishing "+12% 30D" derived from it would replace one stale number
  -- with six, and these feed the homepage average and — through
  -- get_set_analytics — set momentum and the investment ranking.
  CASE WHEN lp.recorded_at >= current_date - 14
       THEN metrics.return_1d END AS return_1d,
  CASE WHEN lp.recorded_at >= current_date - 14
       THEN metrics.return_7d END AS return_7d,
  CASE WHEN lp.recorded_at >= current_date - 14
       THEN metrics.return_30d END AS return_30d,
  CASE WHEN lp.recorded_at >= current_date - 14
       THEN metrics.return_90d END AS return_90d,
  CASE WHEN lp.recorded_at >= current_date - 14
       THEN metrics.return_180d END AS return_180d,
  CASE WHEN lp.recorded_at >= current_date - 14
       THEN metrics.return_365d END AS return_365d,
  -- Deliberately NOT gated: a caller that got no price can still report when
  -- the product was last priced. Mirrors listings_snapshot_date in 0022.
  lp.recorded_at AS price_recorded_at
FROM public.products p
LEFT JOIN public.sets s ON s.id = p.set_id
LEFT JOIN public.generations g ON g.id = s.generation_id
LEFT JOIN public.product_types pt ON pt.id = p.product_type_id
LEFT JOIN public.get_market_product_metrics() metrics ON metrics.product_id = p.id
LEFT JOIN latest_price lp ON lp.product_id = p.id
WHERE p.active = true
ORDER BY p.last_updated DESC, p.id ASC;
$$;

ALTER FUNCTION public.get_market_product_summaries()
  SET search_path = public;

-- Restores the ACL the dropped function carried. GRANT is idempotent, so
-- re-running this migration is harmless.
GRANT EXECUTE ON FUNCTION public.get_market_product_summaries()
  TO PUBLIC, anon, authenticated, service_role;

-- Same RETURNS TABLE shape as 20260506_market_performance_functions.sql, so a
-- plain replace works. The only change is the freshness gate on the
-- price_per_day input: every other line is that file's definition verbatim.

CREATE OR REPLACE FUNCTION public.get_set_analytics()
RETURNS TABLE (
  key text,
  name text,
  code text,
  generation text,
  release_date date,
  days_since_release integer,
  product_count integer,
  avg30 double precision,
  avg90 double precision,
  avg365 double precision,
  median30 double precision,
  median90 double precision,
  median365 double precision,
  consistency90 double precision,
  consistency365 double precision,
  volatility90 double precision,
  max_drawdown365 double precision,
  trend90 double precision,
  trend365 double precision,
  price_per_day double precision,
  momentum_score double precision,
  invest_score double precision,
  rank bigint
)
LANGUAGE sql
STABLE
AS $$
-- 14 = PRICE_STALENESS_TOLERANCE_DAYS in frontend/app/lib/marketPulse.ts.
-- Products with a price row inside the tolerance. One index-ordered pass,
-- reused by both gates below, instead of a correlated EXISTS per column.
WITH fresh_price AS (
  SELECT DISTINCT h.product_id
  FROM public.product_price_history h
  WHERE h.recorded_at >= current_date - 14
),
product_stats AS (
  SELECT
    p.id,
    s.name,
    s.code,
    g.name AS generation,
    s.release_date,
    -- Returns are gated on freshness because get_market_product_metrics
    -- anchors every one of them on products.usd_price, which is
    -- last-write-wins and never cleared. For a product whose SKU has gone
    -- dead, that frozen value also becomes its own 30/90/365-day anchor, so
    -- the function reports a flat 0.00% — and averaging a fabricated zero into
    -- set momentum and the investment ranking is what this migration exists to
    -- stop. Volatility, drawdown and trend are NOT gated: those are computed
    -- from the recorded daily series alone and stay true descriptions of it.
    CASE WHEN fp.product_id IS NOT NULL THEN metrics.return_30d END AS return_30d,
    CASE WHEN fp.product_id IS NOT NULL THEN metrics.return_90d END AS return_90d,
    CASE WHEN fp.product_id IS NOT NULL THEN metrics.return_365d END AS return_365d,
    metrics.volatility_90d,
    metrics.max_drawdown_365d,
    metrics.trend_90d,
    metrics.trend_365d,
    CASE
      WHEN s.release_date IS NOT NULL
        AND p.usd_price IS NOT NULL
        AND p.usd_price > 0
        AND current_date > s.release_date
        -- A product whose SKU stops returning history keeps its last price
        -- forever; averaging that into the set's price/day publishes a
        -- months-old number as today's.
        AND fp.product_id IS NOT NULL
      THEN p.usd_price / GREATEST((current_date - s.release_date), 1)
      ELSE NULL
    END AS price_per_day
  FROM public.products p
  JOIN public.sets s ON s.id = p.set_id
  LEFT JOIN public.generations g ON g.id = s.generation_id
  LEFT JOIN public.get_market_product_metrics() metrics ON metrics.product_id = p.id
  LEFT JOIN fresh_price fp ON fp.product_id = p.id
  WHERE p.active = true
),
set_stats AS (
  SELECT
    concat(coalesce(code, 'unknown'), ':', coalesce(name, 'Unknown Set')) AS key,
    name,
    code,
    coalesce(generation, 'Unknown') AS generation,
    release_date,
    CASE
      WHEN release_date IS NULL THEN NULL
      ELSE GREATEST((current_date - release_date), 0)
    END::integer AS days_since_release,
    count(*)::integer AS product_count,
    avg(return_30d) AS avg30,
    avg(return_90d) AS avg90,
    avg(return_365d) AS avg365,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY return_30d) AS median30,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY return_90d) AS median90,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY return_365d) AS median365,
    avg(CASE WHEN return_90d IS NULL THEN NULL WHEN return_90d > 0 THEN 100.0 ELSE 0.0 END) AS consistency90,
    avg(CASE WHEN return_365d IS NULL THEN NULL WHEN return_365d > 0 THEN 100.0 ELSE 0.0 END) AS consistency365,
    avg(volatility_90d) AS volatility90,
    avg(max_drawdown_365d) AS max_drawdown365,
    avg(trend_90d) AS trend90,
    avg(trend_365d) AS trend365,
    avg(price_per_day) AS price_per_day,
    CASE
      WHEN avg(return_90d) IS NOT NULL OR avg(return_30d) IS NOT NULL OR avg(return_365d) IS NOT NULL
      THEN coalesce(avg(return_90d), 0) * 0.5
         + coalesce(avg(return_30d), 0) * 0.3
         + coalesce(avg(return_365d), 0) * 0.2
      ELSE NULL
    END AS momentum_score
  FROM product_stats
  GROUP BY name, code, generation, release_date
),
metric_stats AS (
  SELECT
    avg(avg30) AS avg30_mean,
    stddev_pop(avg30) AS avg30_std,
    avg(avg90) AS avg90_mean,
    stddev_pop(avg90) AS avg90_std,
    avg(avg365) AS avg365_mean,
    stddev_pop(avg365) AS avg365_std,
    avg(consistency90) AS consistency90_mean,
    stddev_pop(consistency90) AS consistency90_std,
    avg(consistency365) AS consistency365_mean,
    stddev_pop(consistency365) AS consistency365_std,
    avg(trend90) AS trend90_mean,
    stddev_pop(trend90) AS trend90_std,
    avg(trend365) AS trend365_mean,
    stddev_pop(trend365) AS trend365_std,
    avg(volatility90) AS volatility90_mean,
    stddev_pop(volatility90) AS volatility90_std,
    avg(max_drawdown365) AS max_drawdown365_mean,
    stddev_pop(max_drawdown365) AS max_drawdown365_std
  FROM set_stats
),
scored AS (
  SELECT
    ss.*,
    -- A set with no current prices at all has no return, consistency or
    -- momentum data left after the gate above. Every one of those z-score
    -- terms then COALESCEs to 0 — "exactly market average" — and the set is
    -- scored and ranked on the strength of the two ungated series metrics
    -- alone. Score it NULL instead, on the same condition momentum_score
    -- already uses, so it sorts NULLS LAST and reads as unranked rather than
    -- as an average investment.
    CASE WHEN ss.avg30 IS NULL AND ss.avg90 IS NULL AND ss.avg365 IS NULL
         THEN NULL
    ELSE (
      COALESCE(CASE WHEN ms.avg30_std IS NULL OR ms.avg30_std = 0 OR ss.avg30 IS NULL THEN 0 ELSE ((ss.avg30 - ms.avg30_mean) / ms.avg30_std) * 0.2 END, 0)
      + COALESCE(CASE WHEN ms.avg90_std IS NULL OR ms.avg90_std = 0 OR ss.avg90 IS NULL THEN 0 ELSE ((ss.avg90 - ms.avg90_mean) / ms.avg90_std) * 0.4 END, 0)
      + COALESCE(CASE WHEN ms.avg365_std IS NULL OR ms.avg365_std = 0 OR ss.avg365 IS NULL THEN 0 ELSE ((ss.avg365 - ms.avg365_mean) / ms.avg365_std) * 0.2 END, 0)
      + COALESCE(CASE WHEN ms.consistency90_std IS NULL OR ms.consistency90_std = 0 OR ss.consistency90 IS NULL THEN 0 ELSE ((ss.consistency90 - ms.consistency90_mean) / ms.consistency90_std) * 0.15 END, 0)
      + COALESCE(CASE WHEN ms.consistency365_std IS NULL OR ms.consistency365_std = 0 OR ss.consistency365 IS NULL THEN 0 ELSE ((ss.consistency365 - ms.consistency365_mean) / ms.consistency365_std) * 0.1 END, 0)
      + COALESCE(CASE WHEN ms.trend90_std IS NULL OR ms.trend90_std = 0 OR ss.trend90 IS NULL THEN 0 ELSE ((ss.trend90 - ms.trend90_mean) / ms.trend90_std) * 0.1 END, 0)
      + COALESCE(CASE WHEN ms.trend365_std IS NULL OR ms.trend365_std = 0 OR ss.trend365 IS NULL THEN 0 ELSE ((ss.trend365 - ms.trend365_mean) / ms.trend365_std) * 0.05 END, 0)
      + COALESCE(CASE WHEN ms.volatility90_std IS NULL OR ms.volatility90_std = 0 OR ss.volatility90 IS NULL THEN 0 ELSE ((ss.volatility90 - ms.volatility90_mean) / ms.volatility90_std) * -0.2 END, 0)
      + COALESCE(CASE WHEN ms.max_drawdown365_std IS NULL OR ms.max_drawdown365_std = 0 OR ss.max_drawdown365 IS NULL THEN 0 ELSE ((ss.max_drawdown365 - ms.max_drawdown365_mean) / ms.max_drawdown365_std) * -0.15 END, 0)
    ) END AS invest_score
  FROM set_stats ss
  CROSS JOIN metric_stats ms
),
ranked AS (
  SELECT
    scored.*,
    row_number() OVER (ORDER BY scored.invest_score DESC NULLS LAST, scored.name ASC) AS rank
  FROM scored
)
SELECT
  key,
  name,
  code,
  generation,
  release_date,
  days_since_release,
  product_count,
  avg30,
  avg90,
  avg365,
  median30,
  median90,
  median365,
  consistency90,
  consistency365,
  volatility90,
  max_drawdown365,
  trend90,
  trend365,
  price_per_day,
  momentum_score,
  invest_score,
  rank
FROM ranked
ORDER BY rank ASC, name ASC;
$$;

ALTER FUNCTION public.get_set_analytics()
  SET search_path = public;
