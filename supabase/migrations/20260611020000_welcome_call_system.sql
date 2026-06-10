-- Welcome Call System — privileged customer-success flow (User ← Creator via system assignment)
-- Marketplace invariant preserved: caller_id = normal user, creator_id = creator, call_source = welcome

BEGIN;

-- ── users flag ────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS welcome_call_completed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_welcome_call_completed
  ON public.users (welcome_call_completed)
  WHERE welcome_call_completed = FALSE;

-- ── call_source on calls + call_requests ─────────────────────
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS call_source TEXT NOT NULL DEFAULT 'normal';

ALTER TABLE public.calls
  DROP CONSTRAINT IF EXISTS calls_call_source_check;

ALTER TABLE public.calls
  ADD CONSTRAINT calls_call_source_check
  CHECK (call_source IN ('normal', 'welcome', 'support', 'campaign'));

ALTER TABLE public.call_requests
  ADD COLUMN IF NOT EXISTS call_source TEXT NOT NULL DEFAULT 'normal';

ALTER TABLE public.call_requests
  DROP CONSTRAINT IF EXISTS call_requests_call_source_check;

ALTER TABLE public.call_requests
  ADD CONSTRAINT call_requests_call_source_check
  CHECK (call_source IN ('normal', 'welcome', 'support', 'campaign'));

CREATE INDEX IF NOT EXISTS idx_calls_call_source ON public.calls (call_source);
CREATE INDEX IF NOT EXISTS idx_call_requests_call_source ON public.call_requests (call_source);

-- ── campaigns ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.welcome_call_campaigns (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled               BOOLEAN NOT NULL DEFAULT FALSE,
  reward_coins          INTEGER NOT NULL DEFAULT 100
    CHECK (reward_coins >= 50 AND reward_coins <= 100),
  max_duration_seconds  INTEGER NOT NULL DEFAULT 300
    CHECK (max_duration_seconds > 0 AND max_duration_seconds <= 600),
  assignment_strategy   TEXT NOT NULL DEFAULT 'online'
    CHECK (assignment_strategy IN ('random', 'online', 'top_rated', 'legend')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_welcome_call_campaigns_enabled
  ON public.welcome_call_campaigns (enabled)
  WHERE enabled = TRUE;

-- ── assignments (one per user lifetime) ───────────────────────
CREATE TABLE IF NOT EXISTS public.welcome_call_assignments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  campaign_id         UUID NOT NULL REFERENCES public.welcome_call_campaigns(id) ON DELETE RESTRICT,
  creator_profile_id  UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE RESTRICT,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'completed', 'expired', 'cancelled')),
  reward_coins        INTEGER NOT NULL CHECK (reward_coins >= 50 AND reward_coins <= 100),
  call_id             UUID REFERENCES public.calls(id) ON DELETE SET NULL,
  call_request_id     UUID,
  expires_at          TIMESTAMPTZ NOT NULL,
  accepted_at         TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  reward_granted_at   TIMESTAMPTZ,
  reward_idempotency_key TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_welcome_call_assignments_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_welcome_assignments_creator_status
  ON public.welcome_call_assignments (creator_profile_id, status);

CREATE INDEX IF NOT EXISTS idx_welcome_assignments_pending_expiry
  ON public.welcome_call_assignments (status, expires_at)
  WHERE status = 'pending';

-- ── RLS deny clients ──────────────────────────────────────────
ALTER TABLE public.welcome_call_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.welcome_call_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS welcome_call_campaigns_deny_clients ON public.welcome_call_campaigns;
CREATE POLICY welcome_call_campaigns_deny_clients ON public.welcome_call_campaigns
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS welcome_call_assignments_deny_clients ON public.welcome_call_assignments;
CREATE POLICY welcome_call_assignments_deny_clients ON public.welcome_call_assignments
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ── seed default campaign (disabled) ──────────────────────────
INSERT INTO public.welcome_call_campaigns (enabled, reward_coins, max_duration_seconds, assignment_strategy)
SELECT FALSE, 100, 300, 'online'
WHERE NOT EXISTS (SELECT 1 FROM public.welcome_call_campaigns LIMIT 1);

-- ── complete welcome call (idempotent reward, no user debit) ──
CREATE OR REPLACE FUNCTION public.complete_welcome_call(
  p_call_id            UUID,
  p_actor_user_id      UUID,
  p_duration_seconds   INTEGER,
  p_idempotency_key    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_call               public.calls%ROWTYPE;
  v_assignment         public.welcome_call_assignments%ROWTYPE;
  v_cached             JSONB;
  v_billable           INTEGER;
  v_creator_user_id    UUID;
  v_earning_id         UUID;
  v_wallet_credit      NUMERIC;
  v_response           JSONB;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT response_json INTO v_cached
    FROM public.call_end_idempotency_records
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN v_cached || jsonb_build_object('idempotent_replay', TRUE);
  END IF;

  SELECT * INTO v_call FROM public.calls WHERE id = p_call_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'call_not_found';
  END IF;

  IF v_call.call_source IS DISTINCT FROM 'welcome' THEN
    RAISE EXCEPTION 'not_welcome_call';
  END IF;

  IF p_actor_user_id IS DISTINCT FROM v_call.caller_id
     AND p_actor_user_id IS DISTINCT FROM v_call.creator_id THEN
    RAISE EXCEPTION 'not_call_participant';
  END IF;

  SELECT * INTO v_assignment
    FROM public.welcome_call_assignments
   WHERE call_id = p_call_id
      OR (call_request_id IS NOT NULL AND call_request_id IN (
            SELECT id FROM public.call_requests WHERE call_id = p_call_id
          ))
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'welcome_assignment_not_found';
  END IF;

  IF v_assignment.status = 'completed' THEN
    v_response := jsonb_build_object(
      'call_id', p_call_id,
      'assignment_id', v_assignment.id,
      'status', 'completed',
      'reward_coins', v_assignment.reward_coins,
      'already_completed', TRUE
    );
    INSERT INTO public.call_end_idempotency_records (idempotency_key, call_id, response_json)
    VALUES (p_idempotency_key, p_call_id, v_response)
    ON CONFLICT (idempotency_key) DO NOTHING;
    RETURN v_response;
  END IF;

  v_billable := LEAST(
    GREATEST(0, COALESCE(p_duration_seconds, 0)),
    (SELECT max_duration_seconds FROM public.welcome_call_campaigns WHERE id = v_assignment.campaign_id)
  );

  IF v_call.status <> 'ended' THEN
    UPDATE public.calls
       SET status = 'ended',
           ended_at = COALESCE(ended_at, NOW()),
           duration_seconds = v_billable,
           billable_duration_seconds = v_billable,
           coins_spent = 0,
           coins_deducted = 0,
           ended_reason = 'welcome_completed',
           version = version + 1
     WHERE id = p_call_id;
  END IF;

  SELECT user_id INTO v_creator_user_id
    FROM public.creator_profiles
   WHERE id = v_assignment.creator_profile_id;

  -- Platform-funded fixed reward (idempotent per call via uq_creator_earnings_call_id)
  INSERT INTO public.creator_earnings (
    call_id, creator_id, gross_amount, creator_share, platform_share
  )
  SELECT
    p_call_id,
    v_creator_user_id,
    v_assignment.reward_coins::NUMERIC,
    v_assignment.reward_coins::NUMERIC,
    0::NUMERIC
  WHERE NOT EXISTS (
    SELECT 1 FROM public.creator_earnings WHERE call_id = p_call_id
  )
  RETURNING id INTO v_earning_id;

  IF v_earning_id IS NOT NULL THEN
    PERFORM public.increment_creator_wallet(
      v_assignment.creator_profile_id,
      v_assignment.reward_coins::NUMERIC
    );
  END IF;

  UPDATE public.welcome_call_assignments
     SET status = 'completed',
         completed_at = NOW(),
         reward_granted_at = COALESCE(reward_granted_at, NOW()),
         reward_idempotency_key = p_idempotency_key,
         call_id = p_call_id,
         updated_at = NOW()
   WHERE id = v_assignment.id;

  UPDATE public.users
     SET welcome_call_completed = TRUE,
         updated_at = NOW()
   WHERE id = v_assignment.user_id
     AND welcome_call_completed = FALSE;

  v_response := jsonb_build_object(
    'call_id', p_call_id,
    'assignment_id', v_assignment.id,
    'status', 'completed',
    'reward_coins', v_assignment.reward_coins,
    'duration_seconds', v_billable,
    'welcome_call_completed', TRUE
  );

  INSERT INTO public.call_end_idempotency_records (idempotency_key, call_id, response_json)
  VALUES (p_idempotency_key, p_call_id, v_response);

  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_welcome_call(UUID, UUID, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_welcome_call(UUID, UUID, INTEGER, TEXT) TO service_role;

COMMIT;
