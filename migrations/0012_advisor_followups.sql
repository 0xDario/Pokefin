-- Migration: address Supabase Advisor warnings raised after 0008-0011.
-- Idempotent.
--
-- Issues fixed:
--   1. log_auth_event_users() is a TRIGGER function but is exposed
--      via /rest/v1/rpc to anon + authenticated. Revoke execute.
--   2. get_price_history_deduplicated (pre-existing) is exposed via
--      /rest/v1/rpc to anon + authenticated as SECURITY DEFINER.
--      Revoke from anon (keep authenticated EXECUTE).
--   3. auth_events is RLS-locked with no policies, but anon and
--      authenticated still have table-level SELECT, so it appears in
--      the GraphQL schema. Revoke SELECT entirely.
--   4. product_price_history_backup_20260128 is a stale backup with
--      no RLS policies. Revoke anon/auth SELECT and lock it down to
--      service_role only.

-- 1. Trigger function should never be RPC-callable
REVOKE EXECUTE ON FUNCTION public.log_auth_event_users() FROM PUBLIC, anon, authenticated;

-- 2. Reference RPC: keep authenticated, drop anon
REVOKE EXECUTE ON FUNCTION public.get_price_history_deduplicated(bigint[], text) FROM anon;

-- 3. auth_events: locked-down via no policies; also drop table-level
--    grants so it stops appearing in the GraphQL schema.
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.auth_events FROM anon, authenticated;

-- 4. Stale backup table — keep the data for the operator but make it
--    invisible to anon/auth.
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.product_price_history_backup_20260128 FROM anon, authenticated;
