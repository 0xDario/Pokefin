-- Migration: auth_events audit table + triggers.
-- Closes audit finding log F-1 (no audit trail of sensitive operations)
-- and partially addresses GDPR Art. 33 (breach detection prerequisites).
-- Idempotent.
--
-- Verification:
--   SELECT * FROM public.auth_events ORDER BY created_at DESC LIMIT 10;
--   -- After signing up a user, expect an 'account_created' row.
--   -- After calling delete_my_account(), expect 'account_deleted'.

-- ============================================================
-- 1. Table. Append-only by policy; only service_role can read.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.auth_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid,
  event       text NOT NULL CHECK (char_length(event) BETWEEN 1 AND 64),
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_events_user_id_idx
  ON public.auth_events (user_id);
CREATE INDEX IF NOT EXISTS auth_events_created_at_idx
  ON public.auth_events (created_at DESC);

ALTER TABLE public.auth_events ENABLE ROW LEVEL SECURITY;

-- Lock the table down: with RLS enabled and no policies, only the
-- service_role bypass applies. anon and authenticated cannot read,
-- insert, update, or delete via PostgREST.
-- (Intentional: we don't create any policy here.)

-- ============================================================
-- 2. Trigger on auth.users to capture lifecycle events.
-- ============================================================

CREATE OR REPLACE FUNCTION public.log_auth_event_users()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.auth_events (user_id, event)
      VALUES (NEW.id, 'account_created');
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.auth_events (user_id, event)
      VALUES (OLD.id, 'account_deleted');
  ELSIF TG_OP = 'UPDATE' THEN
    -- encrypted_password changing is the cleanest signal for a
    -- successful password update from the user's side.
    IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
      INSERT INTO public.auth_events (user_id, event)
        VALUES (NEW.id, 'password_changed');
    END IF;
    IF NEW.email_confirmed_at IS DISTINCT FROM OLD.email_confirmed_at
       AND NEW.email_confirmed_at IS NOT NULL THEN
      INSERT INTO public.auth_events (user_id, event)
        VALUES (NEW.id, 'email_confirmed');
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS auth_events_users_trg ON auth.users;
CREATE TRIGGER auth_events_users_trg
AFTER INSERT OR UPDATE OR DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.log_auth_event_users();

-- ============================================================
-- 3. Update delete_my_account() to record the event BEFORE the cascade.
--    The trigger above will also fire on the auth.users DELETE, so we
--    end up with one explicit 'account_deletion_requested' row plus
--    the trigger-generated 'account_deleted' row.
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

  INSERT INTO public.auth_events (user_id, event)
    VALUES (auth.uid(), 'account_deletion_requested');

  DELETE FROM auth.users WHERE id = auth.uid();
END
$$;

REVOKE ALL    ON FUNCTION public.delete_my_account() FROM public;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
