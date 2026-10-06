-- Migration: make export_my_data() VOLATILE and close its anon EXECUTE grant.
--
-- 0011 declared export_my_data() STABLE, but the function ends with
--   INSERT INTO public.auth_events (user_id, event) VALUES (caller, 'data_exported');
-- and Postgres refuses any write inside a non-volatile function:
--   ERROR: INSERT is not allowed in a non-volatile function
-- So every call has failed since 0011 was applied (2026-05-27), and
-- POST /api/account/export has answered 500 "Failed to export data" to every
-- user. Production held zero 'data_exported' audit rows as of 2026-09-25.
--
-- The fix is the 0011 body verbatim with the STABLE line removed (VOLATILE is
-- the default). The audit INSERT stays: the 'data_exported' row is a
-- documented requirement (audits/HARDENING_FOLLOWUPS.md section 5).
-- The return type (jsonb) and the argument list are unchanged, so
-- CREATE OR REPLACE succeeds in place and keeps the owner and the ACL.
--
-- Grants: 0011 revoked EXECUTE from PUBLIC only. Supabase's bootstrap ACL
-- also grants anon explicitly (see the note in 0023), and production's
-- proacl reads {postgres=X,anon=X,authenticated=X,service_role=X}. anon could
-- not read anything (the function raises 28000 when auth.uid() is NULL), but
-- the grant is revoked here to match delete_my_account (0006). authenticated
-- keeps EXECUTE for the route handler; service_role keeps it for support use.
--
-- Supersedes 0011 for this function: after this file is applied,
-- verify_migration.py on 0011 reports a volatility MISMATCH, which is correct.
-- Idempotent.
--
-- Verification:
--   -- Expect provolatile = 'v', prosecdef = true, search_path pinned, and no
--   -- anon or PUBLIC entry in proacl:
--   SELECT p.provolatile, p.prosecdef, p.proconfig, p.proacl
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'export_my_data';
--
--   -- Expect anon = false, authenticated = true, service_role = true:
--   SELECT has_function_privilege('anon',          'public.export_my_data()', 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', 'public.export_my_data()', 'EXECUTE') AS authenticated,
--          has_function_privilege('service_role',  'public.export_my_data()', 'EXECUTE') AS service_role;

CREATE OR REPLACE FUNCTION public.export_my_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  caller uuid := auth.uid();
  result jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT jsonb_build_object(
    'exported_at', now(),
    'user_id', caller,
    'profile', (
      SELECT jsonb_build_object(
        'id', id,
        'username', username,
        'email', email,
        'created_at', created_at,
        'updated_at', updated_at
      )
      FROM public.profiles WHERE id = caller
    ),
    'portfolios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'holdings', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', h.id,
            'product_id', h.product_id,
            'quantity', h.quantity,
            'purchase_price_usd', h.purchase_price_usd,
            'purchase_date', h.purchase_date,
            'notes', h.notes,
            'created_at', h.created_at,
            'updated_at', h.updated_at,
            'lots', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', l.id,
                'quantity', l.quantity,
                'purchase_price_usd', l.purchase_price_usd,
                'purchase_date', l.purchase_date,
                'notes', l.notes,
                'created_at', l.created_at
              ))
              FROM public.portfolio_lots l WHERE l.holding_id = h.id
            ), '[]'::jsonb)
          ))
          FROM public.portfolio_holdings h WHERE h.portfolio_id = p.id
        ), '[]'::jsonb)
      ))
      FROM public.portfolios p WHERE p.user_id = caller
    ), '[]'::jsonb),
    'box_recipes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'name', name,
        'retail_price', retail_price,
        'promo_value', promo_value,
        'packs', packs,
        'share_code', share_code,
        'is_public', is_public,
        'created_at', created_at,
        'updated_at', updated_at
      ))
      FROM public.box_recipes WHERE user_id = caller
    ), '[]'::jsonb)
  ) INTO result;

  INSERT INTO public.auth_events (user_id, event)
    VALUES (caller, 'data_exported');

  RETURN result;
END
$$;

REVOKE EXECUTE ON FUNCTION public.export_my_data() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.export_my_data() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.export_my_data() TO service_role;
