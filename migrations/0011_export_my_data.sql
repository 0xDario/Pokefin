-- Migration: export_my_data() RPC for GDPR Art. 15 / 20 portability.
-- Returns a JSONB document with the caller's data. SECURITY DEFINER
-- so it can read across all per-user tables in one shot, scoped
-- strictly to auth.uid().
-- Idempotent.

CREATE OR REPLACE FUNCTION public.export_my_data()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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

REVOKE ALL    ON FUNCTION public.export_my_data() FROM public;
GRANT EXECUTE ON FUNCTION public.export_my_data() TO authenticated;
