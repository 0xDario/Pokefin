-- Migration: Tighten EXECUTE grants on SECURITY DEFINER functions.
--
-- Why:
-- - delete_my_account must be callable by authenticated users only.
-- - trigger helper functions should not be callable over PostgREST RPC.

-- Keep authenticated access only for self-service account deletion.
REVOKE ALL ON FUNCTION public.delete_my_account() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

-- Trigger-only helpers should not be RPC-callable by API roles.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_profile_portfolio() FROM public, anon, authenticated;
