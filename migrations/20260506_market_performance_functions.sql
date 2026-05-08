-- Performance indexes for free-tier-friendly reads.
CREATE INDEX IF NOT EXISTS product_price_history_product_id_recorded_at_idx
  ON public.product_price_history (product_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS portfolio_holdings_portfolio_id_idx
  ON public.portfolio_holdings (portfolio_id);

CREATE INDEX IF NOT EXISTS exchange_rates_recorded_at_idx
  ON public.exchange_rates (recorded_at DESC);

CREATE INDEX IF NOT EXISTS products_active_last_updated_idx
  ON public.products (active, last_updated DESC);

CREATE OR REPLACE FUNCTION public.get_market_product_metrics()
RETURNS TABLE (
  product_id bigint,
  current_price double precision,
  return_1d double precision,
  return_7d double precision,
  return_30d double precision,
  return_90d double precision,
  return_180d double precision,
  return_365d double precision,
  volatility_90d double precision,
  max_drawdown_365d double precision,
  trend_90d double precision,
  trend_365d double precision
)
LANGUAGE sql
STABLE
AS $$
WITH active_products AS (
  SELECT p.id, p.usd_price
  FROM public.products p
  WHERE p.active = true
    AND p.usd_price IS NOT NULL
),
daily_history AS (
  SELECT DISTINCT ON (h.product_id, (h.recorded_at::date))
    h.product_id,
    h.recorded_at::date AS day,
    h.usd_price
  FROM public.product_price_history h
  JOIN active_products ap ON ap.id = h.product_id
  ORDER BY h.product_id, (h.recorded_at::date), h.recorded_at DESC
),
anchors AS (
  SELECT
    ap.id AS product_id,
    ap.usd_price AS current_price,
    (
      SELECT dh.usd_price
      FROM daily_history dh
      WHERE dh.product_id = ap.id
        AND dh.day <= current_date - 1
      ORDER BY dh.day DESC
      LIMIT 1
    ) AS price_1d,
    (
      SELECT dh.usd_price
      FROM daily_history dh
      WHERE dh.product_id = ap.id
        AND dh.day <= current_date - 7
      ORDER BY dh.day DESC
      LIMIT 1
    ) AS price_7d,
    (
      SELECT dh.usd_price
      FROM daily_history dh
      WHERE dh.product_id = ap.id
        AND dh.day <= current_date - 30
      ORDER BY dh.day DESC
      LIMIT 1
    ) AS price_30d,
    (
      SELECT dh.usd_price
      FROM daily_history dh
      WHERE dh.product_id = ap.id
        AND dh.day <= current_date - 90
      ORDER BY dh.day DESC
      LIMIT 1
    ) AS price_90d,
    (
      SELECT dh.usd_price
      FROM daily_history dh
      WHERE dh.product_id = ap.id
        AND dh.day <= current_date - 180
      ORDER BY dh.day DESC
      LIMIT 1
    ) AS price_180d,
    (
      SELECT dh.usd_price
      FROM daily_history dh
      WHERE dh.product_id = ap.id
        AND dh.day <= current_date - 365
      ORDER BY dh.day DESC
      LIMIT 1
    ) AS price_365d
  FROM active_products ap
),
changes_90 AS (
  SELECT
    dh.product_id,
    CASE
      WHEN lag(dh.usd_price) OVER w > 0 THEN
        ((dh.usd_price - lag(dh.usd_price) OVER w) / lag(dh.usd_price) OVER w) * 100
      ELSE NULL
    END AS pct_change
  FROM daily_history dh
  WHERE dh.day >= current_date - 90
  WINDOW w AS (PARTITION BY dh.product_id ORDER BY dh.day)
),
volatility_90 AS (
  SELECT product_id, stddev_pop(pct_change) AS volatility_90d
  FROM changes_90
  WHERE pct_change IS NOT NULL
  GROUP BY product_id
),
drawdown_365_source AS (
  SELECT
    dh.product_id,
    dh.usd_price,
    max(dh.usd_price) OVER (
      PARTITION BY dh.product_id
      ORDER BY dh.day
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_peak
  FROM daily_history dh
  WHERE dh.day >= current_date - 365
),
drawdown_365 AS (
  SELECT
    product_id,
    abs(min(
      CASE
        WHEN running_peak > 0 THEN ((usd_price - running_peak) / running_peak) * 100
        ELSE NULL
      END
    )) AS max_drawdown_365d
  FROM drawdown_365_source
  GROUP BY product_id
),
trend_90_source AS (
  SELECT
    dh.product_id,
    row_number() OVER (PARTITION BY dh.product_id ORDER BY dh.day) - 1 AS x,
    dh.usd_price AS y
  FROM daily_history dh
  WHERE dh.day >= current_date - 90
),
trend_90 AS (
  SELECT
    product_id,
    CASE
      WHEN avg(y) = 0 THEN NULL
      ELSE (regr_slope(y, x) / avg(y)) * 100
    END AS trend_90d
  FROM trend_90_source
  GROUP BY product_id
),
trend_365_source AS (
  SELECT
    dh.product_id,
    row_number() OVER (PARTITION BY dh.product_id ORDER BY dh.day) - 1 AS x,
    dh.usd_price AS y
  FROM daily_history dh
  WHERE dh.day >= current_date - 365
),
trend_365 AS (
  SELECT
    product_id,
    CASE
      WHEN avg(y) = 0 THEN NULL
      ELSE (regr_slope(y, x) / avg(y)) * 100
    END AS trend_365d
  FROM trend_365_source
  GROUP BY product_id
)
SELECT
  anchors.product_id,
  anchors.current_price,
  CASE WHEN anchors.price_1d > 0 THEN ((anchors.current_price - anchors.price_1d) / anchors.price_1d) * 100 END AS return_1d,
  CASE WHEN anchors.price_7d > 0 THEN ((anchors.current_price - anchors.price_7d) / anchors.price_7d) * 100 END AS return_7d,
  CASE WHEN anchors.price_30d > 0 THEN ((anchors.current_price - anchors.price_30d) / anchors.price_30d) * 100 END AS return_30d,
  CASE WHEN anchors.price_90d > 0 THEN ((anchors.current_price - anchors.price_90d) / anchors.price_90d) * 100 END AS return_90d,
  CASE WHEN anchors.price_180d > 0 THEN ((anchors.current_price - anchors.price_180d) / anchors.price_180d) * 100 END AS return_180d,
  CASE WHEN anchors.price_365d > 0 THEN ((anchors.current_price - anchors.price_365d) / anchors.price_365d) * 100 END AS return_365d,
  volatility_90.volatility_90d,
  drawdown_365.max_drawdown_365d,
  trend_90.trend_90d,
  trend_365.trend_365d
FROM anchors
LEFT JOIN volatility_90 ON volatility_90.product_id = anchors.product_id
LEFT JOIN drawdown_365 ON drawdown_365.product_id = anchors.product_id
LEFT JOIN trend_90 ON trend_90.product_id = anchors.product_id
LEFT JOIN trend_365 ON trend_365.product_id = anchors.product_id;
$$;

CREATE OR REPLACE FUNCTION public.get_market_product_summaries()
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
  return_365d double precision
)
LANGUAGE sql
STABLE
AS $$
SELECT
  p.id,
  p.usd_price,
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
  metrics.return_1d,
  metrics.return_7d,
  metrics.return_30d,
  metrics.return_90d,
  metrics.return_180d,
  metrics.return_365d
FROM public.products p
LEFT JOIN public.sets s ON s.id = p.set_id
LEFT JOIN public.generations g ON g.id = s.generation_id
LEFT JOIN public.product_types pt ON pt.id = p.product_type_id
LEFT JOIN public.get_market_product_metrics() metrics ON metrics.product_id = p.id
WHERE p.active = true
ORDER BY p.last_updated DESC, p.id ASC;
$$;

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
WITH product_stats AS (
  SELECT
    p.id,
    s.name,
    s.code,
    g.name AS generation,
    s.release_date,
    metrics.return_30d,
    metrics.return_90d,
    metrics.return_365d,
    metrics.volatility_90d,
    metrics.max_drawdown_365d,
    metrics.trend_90d,
    metrics.trend_365d,
    CASE
      WHEN s.release_date IS NOT NULL
        AND p.usd_price IS NOT NULL
        AND p.usd_price > 0
        AND current_date > s.release_date
      THEN p.usd_price / GREATEST((current_date - s.release_date), 1)
      ELSE NULL
    END AS price_per_day
  FROM public.products p
  JOIN public.sets s ON s.id = p.set_id
  LEFT JOIN public.generations g ON g.id = s.generation_id
  LEFT JOIN public.get_market_product_metrics() metrics ON metrics.product_id = p.id
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
    (
      COALESCE(CASE WHEN ms.avg30_std IS NULL OR ms.avg30_std = 0 OR ss.avg30 IS NULL THEN 0 ELSE ((ss.avg30 - ms.avg30_mean) / ms.avg30_std) * 0.2 END, 0)
      + COALESCE(CASE WHEN ms.avg90_std IS NULL OR ms.avg90_std = 0 OR ss.avg90 IS NULL THEN 0 ELSE ((ss.avg90 - ms.avg90_mean) / ms.avg90_std) * 0.4 END, 0)
      + COALESCE(CASE WHEN ms.avg365_std IS NULL OR ms.avg365_std = 0 OR ss.avg365 IS NULL THEN 0 ELSE ((ss.avg365 - ms.avg365_mean) / ms.avg365_std) * 0.2 END, 0)
      + COALESCE(CASE WHEN ms.consistency90_std IS NULL OR ms.consistency90_std = 0 OR ss.consistency90 IS NULL THEN 0 ELSE ((ss.consistency90 - ms.consistency90_mean) / ms.consistency90_std) * 0.15 END, 0)
      + COALESCE(CASE WHEN ms.consistency365_std IS NULL OR ms.consistency365_std = 0 OR ss.consistency365 IS NULL THEN 0 ELSE ((ss.consistency365 - ms.consistency365_mean) / ms.consistency365_std) * 0.1 END, 0)
      + COALESCE(CASE WHEN ms.trend90_std IS NULL OR ms.trend90_std = 0 OR ss.trend90 IS NULL THEN 0 ELSE ((ss.trend90 - ms.trend90_mean) / ms.trend90_std) * 0.1 END, 0)
      + COALESCE(CASE WHEN ms.trend365_std IS NULL OR ms.trend365_std = 0 OR ss.trend365 IS NULL THEN 0 ELSE ((ss.trend365 - ms.trend365_mean) / ms.trend365_std) * 0.05 END, 0)
      + COALESCE(CASE WHEN ms.volatility90_std IS NULL OR ms.volatility90_std = 0 OR ss.volatility90 IS NULL THEN 0 ELSE ((ss.volatility90 - ms.volatility90_mean) / ms.volatility90_std) * -0.2 END, 0)
      + COALESCE(CASE WHEN ms.max_drawdown365_std IS NULL OR ms.max_drawdown365_std = 0 OR ss.max_drawdown365 IS NULL THEN 0 ELSE ((ss.max_drawdown365 - ms.max_drawdown365_mean) / ms.max_drawdown365_std) * -0.15 END, 0)
    ) AS invest_score
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
