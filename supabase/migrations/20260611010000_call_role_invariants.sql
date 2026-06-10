-- Enforce call role invariants at the database layer:
-- caller.is_creator = false, creator_id user.is_creator = true, no self-calls.

CREATE OR REPLACE FUNCTION public.enforce_call_role_invariants()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_caller_is_creator boolean;
  v_receiver_is_creator boolean;
BEGIN
  IF NEW.caller_id = NEW.creator_id THEN
    RAISE EXCEPTION 'invalid_call_role: self calls are not allowed'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT u.is_creator
    INTO v_caller_is_creator
    FROM public.users u
   WHERE u.id = NEW.caller_id;

  IF v_caller_is_creator IS NULL THEN
    RAISE EXCEPTION 'invalid_call_role: caller user not found'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_caller_is_creator IS TRUE THEN
    RAISE EXCEPTION 'invalid_call_role: caller must not be a creator'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT u.is_creator
    INTO v_receiver_is_creator
    FROM public.users u
   WHERE u.id = NEW.creator_id;

  IF v_receiver_is_creator IS NULL THEN
    RAISE EXCEPTION 'invalid_call_role: receiver user not found'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_receiver_is_creator IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid_call_role: receiver must be a creator'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_call_requests_role_invariant ON public.call_requests;
CREATE TRIGGER trg_call_requests_role_invariant
  BEFORE INSERT OR UPDATE OF caller_id, creator_id
  ON public.call_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_call_role_invariants();

DROP TRIGGER IF EXISTS trg_calls_role_invariant ON public.calls;
CREATE TRIGGER trg_calls_role_invariant
  BEFORE INSERT OR UPDATE OF caller_id, creator_id
  ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_call_role_invariants();

COMMENT ON FUNCTION public.enforce_call_role_invariants() IS
  'Ensures only normal users (is_creator=false) may call creators (is_creator=true).';
