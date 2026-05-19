-- Migration: DB-level integrity constraints to back up client validation.
-- Closes audit findings M-6 (idempotency), M-7 (numeric bounds), L-7
-- (exchange rate sanity), L-8 (price history day uniqueness), L-9
-- (portfolios uniqueness), L-10 (no future purchase date).

-- ============================================================
-- 1. Numeric / date bounds on portfolio_holdings + lots.
-- ============================================================

ALTER TABLE public.portfolio_holdings
  ADD CONSTRAINT portfolio_holdings_quantity_sane
    CHECK (quantity BETWEEN 1 AND 100000),
  ADD CONSTRAINT portfolio_holdings_price_sane
    CHECK (purchase_price_usd BETWEEN 0 AND 1000000),
  ADD CONSTRAINT portfolio_holdings_date_not_future
    CHECK (purchase_date <= current_date);

ALTER TABLE public.portfolio_lots
  ADD CONSTRAINT portfolio_lots_quantity_sane
    CHECK (quantity BETWEEN 1 AND 100000),
  ADD CONSTRAINT portfolio_lots_price_sane
    CHECK (purchase_price_usd BETWEEN 0 AND 1000000),
  ADD CONSTRAINT portfolio_lots_date_not_future
    CHECK (purchase_date <= current_date);

-- ============================================================
-- 2. Exchange-rate sanity range. USD/CAD has historically lived
--    in [1.0, 1.7]; clamp generously.
-- ============================================================

ALTER TABLE public.exchange_rates
  ADD CONSTRAINT exchange_rates_usd_to_cad_sane
    CHECK (usd_to_cad > 0.5 AND usd_to_cad < 5.0);

-- ============================================================
-- 3. One portfolio per user (matches getOrCreatePortfolio
--    expectations; prevents TOCTOU duplicates).
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS portfolios_user_id_uidx
  ON public.portfolios (user_id);

-- ============================================================
-- 4. One price-history row per (product, calendar day).
--    Stops scraper double-writes.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS product_price_history_product_day_uidx
  ON public.product_price_history (product_id, (recorded_at::date));

-- ============================================================
-- 5. Idempotency key for holding inserts/imports.
-- ============================================================

ALTER TABLE public.portfolio_holdings
  ADD COLUMN IF NOT EXISTS client_idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS portfolio_holdings_idem_uidx
  ON public.portfolio_holdings (portfolio_id, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;

-- ============================================================
-- 6. Username format constraint on profiles.
-- ============================================================

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format
    CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_]{3,32}$');
