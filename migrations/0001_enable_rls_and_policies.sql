-- Migration: Enable Row Level Security + per-table policies.
-- Closes audit finding C-1 (RLS DDL not in repo) and reinforces M-1.
-- Safe to re-run: every CREATE POLICY is wrapped in a DO block.

-- ============================================================
-- User-owned tables: owner-scoped read/write.
-- ============================================================

ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_holdings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_lots      ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY profiles_self ON public.profiles
    FOR ALL TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY portfolios_self ON public.portfolios
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY holdings_self ON public.portfolio_holdings
    FOR ALL TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.portfolios p
      WHERE p.id = portfolio_id AND p.user_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.portfolios p
      WHERE p.id = portfolio_id AND p.user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY lots_self ON public.portfolio_lots
    FOR ALL TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.portfolio_holdings h
      JOIN public.portfolios p ON p.id = h.portfolio_id
      WHERE h.id = holding_id AND p.user_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.portfolio_holdings h
      JOIN public.portfolios p ON p.id = h.portfolio_id
      WHERE h.id = holding_id AND p.user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Public reference data: anon + authenticated read, no writes.
-- (Only service_role bypasses RLS by default, which is what
--  the Python scrapers must use to populate prices.)
-- ============================================================

ALTER TABLE public.products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sets                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_types         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates        ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY products_read ON public.products
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY product_price_history_read ON public.product_price_history
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY sets_read ON public.sets
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY generations_read ON public.generations
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY product_types_read ON public.product_types
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY exchange_rates_read ON public.exchange_rates
    FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
