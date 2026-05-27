-- Migration: DB resource guards.
-- Closes audit finding DB-4 (no statement_timeout per role) and the
-- database-low search_path follow-up on the 3 market RPCs.
-- Idempotent.
--
-- Verification:
--   SELECT rolname, rolconfig FROM pg_roles
--    WHERE rolname IN ('anon','authenticated','service_role');
--   SELECT proname, proconfig FROM pg_proc
--    WHERE proname IN ('get_market_product_metrics',
--                      'get_market_product_summaries',
--                      'get_set_analytics');

-- ============================================================
-- 1. Per-role statement timeouts. Runaway query / abusive client
--    is killed by Postgres, freeing the connection slot.
--    Tight for anon (mostly small reference reads), looser for
--    authenticated (portfolio history can hit ~365 days of data),
--    generous for service_role (used by scrapers).
-- ============================================================

ALTER ROLE anon          SET statement_timeout = '3s';
ALTER ROLE authenticated SET statement_timeout = '8s';
ALTER ROLE service_role  SET statement_timeout = '60s';

-- ============================================================
-- 2. Pin search_path on the 3 market RPCs (database-security low
--    finding — they're SECURITY INVOKER so the risk is lower than
--    a definer function, but consistency is cheap).
-- ============================================================

ALTER FUNCTION public.get_market_product_metrics()
  SET search_path = public;

ALTER FUNCTION public.get_market_product_summaries()
  SET search_path = public;

ALTER FUNCTION public.get_set_analytics()
  SET search_path = public;
