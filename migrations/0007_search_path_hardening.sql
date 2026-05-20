-- Migration: Harden function search_path for Supabase advisor lint 0011.
--
-- Why:
-- - Avoid role/session-dependent search_path resolution.
-- - Keep function behavior deterministic and reduce injection surface.

ALTER FUNCTION public.get_market_product_metrics()
  SET search_path = public;

ALTER FUNCTION public.get_market_product_summaries()
  SET search_path = public;

ALTER FUNCTION public.get_set_analytics()
  SET search_path = public;

ALTER FUNCTION public.get_price_history_deduplicated(bigint[], text)
  SET search_path = public;
