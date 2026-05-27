-- Migration: RLS performance + dedupe.
-- Closes the Supabase Performance Advisor lints:
--   auth_rls_initplan          (~9 policies re-evaluating auth.uid per row)
--   multiple_permissive_policies (overlapping legacy + new policies)
--   duplicate_index            (legacy idx_* and new *_idx co-existing)
--   unindexed_foreign_keys     (products.product_type_id_fkey)
-- Idempotent.

-- ============================================================
-- 1. Drop overlapping legacy policies (kept the new ones from 0001).
-- ============================================================

DROP POLICY IF EXISTS "Users can view own profile"    ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile"  ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"  ON public.profiles;
DROP POLICY IF EXISTS "Users can delete own profile"  ON public.profiles;

DROP POLICY IF EXISTS portfolios_select ON public.portfolios;
DROP POLICY IF EXISTS portfolios_insert ON public.portfolios;
DROP POLICY IF EXISTS portfolios_update ON public.portfolios;
DROP POLICY IF EXISTS portfolios_delete ON public.portfolios;

DROP POLICY IF EXISTS holdings_select ON public.portfolio_holdings;
DROP POLICY IF EXISTS holdings_insert ON public.portfolio_holdings;
DROP POLICY IF EXISTS holdings_update ON public.portfolio_holdings;
DROP POLICY IF EXISTS holdings_delete ON public.portfolio_holdings;

DROP POLICY IF EXISTS lots_select ON public.portfolio_lots;
DROP POLICY IF EXISTS lots_insert ON public.portfolio_lots;
DROP POLICY IF EXISTS lots_update ON public.portfolio_lots;
DROP POLICY IF EXISTS lots_delete ON public.portfolio_lots;

DROP POLICY IF EXISTS "Public can read exchange rates"          ON public.exchange_rates;
DROP POLICY IF EXISTS "Public can read generations"             ON public.generations;
DROP POLICY IF EXISTS "Public can read product price history"   ON public.product_price_history;
DROP POLICY IF EXISTS "Public can read product types"           ON public.product_types;
DROP POLICY IF EXISTS "Public can read products"                ON public.products;
DROP POLICY IF EXISTS "Public can read sets"                    ON public.sets;

-- ============================================================
-- 2. Recreate the user-owned table policies with (SELECT auth.uid())
--    so PostgreSQL hoists the call into an InitPlan and evaluates
--    it once per query instead of once per row.
-- ============================================================

DROP POLICY IF EXISTS profiles_self            ON public.profiles;
DROP POLICY IF EXISTS portfolios_self          ON public.portfolios;
DROP POLICY IF EXISTS holdings_self            ON public.portfolio_holdings;
DROP POLICY IF EXISTS lots_self                ON public.portfolio_lots;
DROP POLICY IF EXISTS box_recipes_select_own   ON public.box_recipes;
DROP POLICY IF EXISTS box_recipes_insert_own   ON public.box_recipes;
DROP POLICY IF EXISTS box_recipes_update_own   ON public.box_recipes;
DROP POLICY IF EXISTS box_recipes_delete_own   ON public.box_recipes;

CREATE POLICY profiles_self ON public.profiles
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

CREATE POLICY portfolios_self ON public.portfolios
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY holdings_self ON public.portfolio_holdings
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.portfolios p
    WHERE p.id = portfolio_id AND p.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.portfolios p
    WHERE p.id = portfolio_id AND p.user_id = (SELECT auth.uid())
  ));

CREATE POLICY lots_self ON public.portfolio_lots
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.portfolio_holdings h
    JOIN public.portfolios p ON p.id = h.portfolio_id
    WHERE h.id = holding_id AND p.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.portfolio_holdings h
    JOIN public.portfolios p ON p.id = h.portfolio_id
    WHERE h.id = holding_id AND p.user_id = (SELECT auth.uid())
  ));

CREATE POLICY box_recipes_select_own ON public.box_recipes
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY box_recipes_insert_own ON public.box_recipes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY box_recipes_update_own ON public.box_recipes
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY box_recipes_delete_own ON public.box_recipes
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================
-- 3. Drop duplicate indexes (keep the older, more descriptively-
--    named ones; the duplicates were created by index advisors).
-- ============================================================

DROP INDEX IF EXISTS public.portfolio_holdings_portfolio_id_idx;
DROP INDEX IF EXISTS public.product_price_history_product_id_recorded_at_idx;

-- ============================================================
-- 4. Add the missing covering index for products.product_type_id_fkey.
-- ============================================================

CREATE INDEX IF NOT EXISTS products_product_type_id_idx
  ON public.products (product_type_id);
