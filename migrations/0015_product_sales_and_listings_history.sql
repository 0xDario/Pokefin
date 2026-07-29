-- Migration: Sales-volume + listings-depth history tables and volume RPC.
-- Adds public.product_sales_history (daily/weekly quantity-sold buckets from
-- TCGPlayer's price-history API) and public.product_listings_history (one
-- snapshot per product per day of live listing depth), plus the read RPC
-- public.get_market_product_volume_metrics() consumed by the Market view.
-- Writes come from the Python scraper via service_role (bypasses RLS);
-- anon/authenticated get read-only access, matching product_price_history.
-- The unique keys are named table CONSTRAINTS (not plain indexes) so
-- PostgREST upserts with on_conflict="product_id,bucket_date,granularity"
-- and on_conflict="product_id,snapshot_date" resolve correctly.
-- Idempotent.
--
-- Verification:
--   SELECT tablename FROM pg_tables
--    WHERE schemaname = 'public'
--      AND tablename IN ('product_sales_history','product_listings_history');
--   SELECT tablename, policyname FROM pg_policies
--    WHERE tablename IN ('product_sales_history','product_listings_history');
--   SELECT conname, contype FROM pg_constraint
--    WHERE conname IN ('product_sales_history_product_bucket_uidx',
--                      'product_listings_history_product_snapshot_uidx');
--   SELECT proname, proconfig FROM pg_proc
--    WHERE proname = 'get_market_product_volume_metrics';

-- ============================================================
-- 1. Sales history table: one row per (product, bucket date,
--    granularity). 'day' rows come from range=month (30 daily
--    buckets); 'week' rows come from range=annual (52 weekly
--    buckets, Monday-anchored) via the one-time backfill.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_sales_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL,
  bucket_date date NOT NULL,
  granularity text NOT NULL DEFAULT 'day',
  quantity_sold integer,
  transaction_count integer,
  low_sale_price double precision,
  high_sale_price double precision,
  market_price double precision,
  recorded_at timestamp without time zone DEFAULT now(),
  CONSTRAINT product_sales_history_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id)
);

-- Named CHECK constraints (ADD CONSTRAINT has no IF NOT EXISTS, so
-- wrap in DO blocks and swallow the duplicate errors on re-run).

DO $$ BEGIN
  ALTER TABLE public.product_sales_history
    ADD CONSTRAINT product_sales_history_granularity_sane
      CHECK (granularity IN ('day', 'week'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.product_sales_history
    ADD CONSTRAINT product_sales_history_quantity_sane
      CHECK (quantity_sold IS NULL OR (quantity_sold >= 0 AND quantity_sold <= 1000000));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.product_sales_history
    ADD CONSTRAINT product_sales_history_tx_count_sane
      CHECK (transaction_count IS NULL OR (transaction_count >= 0 AND transaction_count <= 1000000));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.product_sales_history
    ADD CONSTRAINT product_sales_history_low_price_sane
      CHECK (low_sale_price IS NULL OR low_sale_price > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.product_sales_history
    ADD CONSTRAINT product_sales_history_high_price_sane
      CHECK (high_sale_price IS NULL OR high_sale_price > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.product_sales_history
    ADD CONSTRAINT product_sales_history_market_price_sane
      CHECK (market_price IS NULL OR market_price > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- Upsert key. MUST be a table constraint (not just a unique index)
-- so PostgREST on_conflict="product_id,bucket_date,granularity" works.
DO $$ BEGIN
  ALTER TABLE public.product_sales_history
    ADD CONSTRAINT product_sales_history_product_bucket_uidx
      UNIQUE (product_id, bucket_date, granularity);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS product_sales_history_product_id_bucket_date_idx
  ON public.product_sales_history (product_id, bucket_date DESC);

-- ============================================================
-- 2. Listings-depth table: one snapshot per (product, day).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_listings_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  active_listings integer,
  total_quantity_available integer,
  lowest_listing_price double precision,
  recorded_at timestamp without time zone DEFAULT now(),
  CONSTRAINT product_listings_history_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id)
);

DO $$ BEGIN
  ALTER TABLE public.product_listings_history
    ADD CONSTRAINT product_listings_history_active_listings_sane
      CHECK (active_listings IS NULL OR active_listings >= 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.product_listings_history
    ADD CONSTRAINT product_listings_history_total_quantity_sane
      CHECK (total_quantity_available IS NULL OR total_quantity_available >= 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.product_listings_history
    ADD CONSTRAINT product_listings_history_lowest_price_sane
      CHECK (lowest_listing_price IS NULL OR lowest_listing_price > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- Upsert key. MUST be a table constraint so PostgREST
-- on_conflict="product_id,snapshot_date" works.
DO $$ BEGIN
  ALTER TABLE public.product_listings_history
    ADD CONSTRAINT product_listings_history_product_snapshot_uidx
      UNIQUE (product_id, snapshot_date);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS product_listings_history_product_id_snapshot_date_idx
  ON public.product_listings_history (product_id, snapshot_date DESC);

-- ============================================================
-- 3. RLS: anon + authenticated read, no write policies. Only
--    service_role (the scraper) bypasses RLS to write, matching
--    product_price_history from 0001.
-- ============================================================

ALTER TABLE public.product_sales_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_listings_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY product_sales_history_read ON public.product_sales_history
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY product_listings_history_read ON public.product_listings_history
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Supabase's default privileges normally grant table access to anon and
-- authenticated automatically, but only when the migration runs as a role
-- those defaults are configured for. Grant SELECT explicitly so reads never
-- silently fail (RLS above still governs row visibility). Idempotent.
GRANT SELECT ON public.product_sales_history    TO anon, authenticated;
GRANT SELECT ON public.product_listings_history TO anon, authenticated;

-- ============================================================
-- 4. Volume metrics RPC. One row per active product; LEFT JOINs
--    keep products without any sales/listings data (all-NULL
--    metrics). Aggregates run over the indexed
--    (product_id, bucket_date) ranges so the whole call stays
--    well under the 3s anon statement_timeout from 0009.
-- ============================================================

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
    SUM(sh.quantity_sold) FILTER (WHERE sh.bucket_date >= current_date - 6)  AS units_sold_7d,
    SUM(sh.quantity_sold) FILTER (WHERE sh.bucket_date >= current_date - 29) AS units_sold_30d,
    SUM(sh.quantity_sold) FILTER (
      WHERE sh.bucket_date BETWEEN current_date - 59 AND current_date - 30
    ) AS units_sold_prior_30d,
    SUM(sh.transaction_count) FILTER (WHERE sh.bucket_date >= current_date - 29) AS transaction_count_30d
  FROM public.product_sales_history sh
  JOIN active_products ap ON ap.id = sh.product_id
  WHERE sh.granularity = 'day'
    AND sh.bucket_date >= current_date - 59
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
  sa.units_sold_prior_30d,
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
