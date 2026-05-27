-- Migration: box_recipes RLS hardening and value constraints.
-- Closes audit findings DB-2 (ordering hazard), DB-3 (nullable user_id),
-- proj F-6 (missing TO authenticated / WITH CHECK), input F-3 (box_recipes
-- fields unbounded), file F-5 (unbounded text). Idempotent; safe to re-run.
--
-- Verification after apply:
--   SELECT polname, polroles, polcmd, polpermissive,
--          pg_get_expr(polqual, polrelid) AS using_expr,
--          pg_get_expr(polwithcheck, polrelid) AS check_expr
--     FROM pg_policy WHERE polrelid = 'public.box_recipes'::regclass;

-- ============================================================
-- 1. Replace the old per-table policies with scoped, TO-authenticated
--    versions that also enforce WITH CHECK on UPDATE.
-- ============================================================

DROP POLICY IF EXISTS "Users can view their own recipes"   ON public.box_recipes;
DROP POLICY IF EXISTS "Users can create their own recipes" ON public.box_recipes;
DROP POLICY IF EXISTS "Users can update their own recipes" ON public.box_recipes;
DROP POLICY IF EXISTS "Users can delete their own recipes" ON public.box_recipes;

DO $$ BEGIN
  CREATE POLICY box_recipes_select_own ON public.box_recipes
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY box_recipes_insert_own ON public.box_recipes
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY box_recipes_update_own ON public.box_recipes
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY box_recipes_delete_own ON public.box_recipes
    FOR DELETE TO authenticated
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. NOT NULL on user_id. Conditional — refuses to ALTER if any
--    orphaned rows exist, with a clear hint.
-- ============================================================

DO $$
DECLARE
  null_count integer;
BEGIN
  SELECT count(*) INTO null_count FROM public.box_recipes WHERE user_id IS NULL;
  IF null_count > 0 THEN
    RAISE NOTICE 'box_recipes has % rows with NULL user_id; not enforcing NOT NULL. Investigate and either delete or reassign before re-running this migration.', null_count;
  ELSE
    ALTER TABLE public.box_recipes
      ALTER COLUMN user_id SET NOT NULL;
  END IF;
END $$;

-- ============================================================
-- 3. CHECK constraints to match the new client-side validation in
--    frontend/app/lib/validation.ts (PRICE_MAX = 1_000_000,
--    RECIPE_NAME_MAX_LEN = 200, RECIPE_PACKS_MAX = 50).
--    Wrapped in DO so re-runs don't fail with "constraint exists".
-- ============================================================

DO $$ BEGIN
  ALTER TABLE public.box_recipes
    ADD CONSTRAINT box_recipes_name_len
    CHECK (char_length(name) BETWEEN 1 AND 200);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.box_recipes
    ADD CONSTRAINT box_recipes_retail_sane
    CHECK (retail_price BETWEEN 0 AND 1000000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.box_recipes
    ADD CONSTRAINT box_recipes_promo_sane
    CHECK (promo_value BETWEEN 0 AND 1000000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.box_recipes
    ADD CONSTRAINT box_recipes_packs_shape
    CHECK (
      jsonb_typeof(packs) = 'array'
      AND jsonb_array_length(packs) <= 50
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 4. Optional length cap on the free-form notes column on holdings,
--    matching clampNotes() in the frontend (NOTES_MAX_LEN = 1000).
--    Closes file-handling F-5.
-- ============================================================

DO $$ BEGIN
  ALTER TABLE public.portfolio_holdings
    ADD CONSTRAINT portfolio_holdings_notes_len
    CHECK (notes IS NULL OR char_length(notes) <= 1000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
