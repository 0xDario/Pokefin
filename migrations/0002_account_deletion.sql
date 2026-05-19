-- Migration: Atomic account deletion via SECURITY DEFINER RPC + ON DELETE CASCADE.
-- Closes audit findings H-4, H-7, A-5. Removes the need for the
-- service-role key in the Next.js function tier.

-- ============================================================
-- 1. Cascade deletes from auth.users -> user data.
-- ============================================================

ALTER TABLE public.portfolios
  DROP CONSTRAINT IF EXISTS portfolios_user_id_fkey,
  ADD  CONSTRAINT portfolios_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.portfolio_holdings
  DROP CONSTRAINT IF EXISTS portfolio_holdings_portfolio_id_fkey,
  ADD  CONSTRAINT portfolio_holdings_portfolio_id_fkey
       FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;

ALTER TABLE public.portfolio_lots
  DROP CONSTRAINT IF EXISTS portfolio_lots_holding_id_fkey,
  ADD  CONSTRAINT portfolio_lots_holding_id_fkey
       FOREIGN KEY (holding_id) REFERENCES public.portfolio_holdings(id) ON DELETE CASCADE;

ALTER TABLE public.box_recipes
  DROP CONSTRAINT IF EXISTS box_recipes_user_id_fkey,
  ADD  CONSTRAINT box_recipes_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_fkey,
  ADD  CONSTRAINT profiles_id_fkey
       FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ============================================================
-- 2. delete_my_account RPC. Runs as definer so it can DELETE
--    from auth.users; the WHERE clauses are bound to auth.uid()
--    so a caller can only ever delete their own data.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  -- ON DELETE CASCADE on auth.users will handle profiles,
  -- portfolios, portfolio_holdings (via portfolios), portfolio_lots
  -- (via portfolio_holdings), and box_recipes.
  DELETE FROM auth.users WHERE id = auth.uid();
END
$$;

REVOKE ALL    ON FUNCTION public.delete_my_account() FROM public;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
