-- Migration: Harden box_recipes sharing.
-- Closes audit findings M-8 (anon enumeration via share_code IS NOT
-- NULL) and M-9 (weak share_code generation, auto-applied on save).

-- ============================================================
-- 1. Replace permissive "shared = anyone can list" policy with
--    an opt-in is_public flag. A new public-only RPC is the only
--    anonymous read path; the anon role can no longer enumerate
--    every shared recipe via PostgREST filters.
-- ============================================================

DROP POLICY IF EXISTS "Shared recipes are viewable by everyone"
  ON public.box_recipes;

ALTER TABLE public.box_recipes
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

-- A definer-mode RPC returning at most one row, looked up by the
-- caller-supplied share_code. Even though anon has SELECT via this
-- function, filter listing is impossible (returns SETOF, not table).
CREATE OR REPLACE FUNCTION public.get_shared_recipe(p_share_code text)
RETURNS SETOF public.box_recipes
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
    FROM public.box_recipes
   WHERE share_code = p_share_code
     AND is_public = true
   LIMIT 1;
$$;

REVOKE ALL    ON FUNCTION public.get_shared_recipe(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_shared_recipe(text) TO anon, authenticated;
