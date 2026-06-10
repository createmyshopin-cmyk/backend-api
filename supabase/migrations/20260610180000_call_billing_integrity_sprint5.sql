-- ============================================================
-- Sprint 5: Call Billing Integrity
-- end_call_billing · mark_call_request_missed
-- ============================================================

BEGIN;

-- ── calls billing columns ─────────────────────────────────────
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS billable_duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS end_idempotency_key TEXT;

UPDATE public.calls
   SET billable_duration_seconds = COALESCE(billable_duration_seconds, duration_seconds)
 WHERE billable_duration_seconds IS NULL;

-- ── call end idempotency cache ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.call_end_idempotency_records (
  idempotency_key TEXT PRIMARY KEY,
  call_id         UUID NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  response_json   JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_end_idempotency_call_id
  ON public.call_end_idempotency_records (call_id);

ALTER TABLE public.call_end_idempotency_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_end_idempotency_deny_clients ON public.call_end_idempotency_records;
CREATE POLICY call_end_idempotency_deny_clients ON public.call_end_idempotency_records
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ── compute_call_coins (mirrors NestJS computeCallCoins) ───────
CREATE OR REPLACE FUNCTION public.compute_call_coins(
  p_duration_seconds INTEGER,
  p_rate_per_minute  INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_minutes INTEGER;
BEGIN
  v_minutes := CEIL(GREATEST(0, COALESCE(p_duration_seconds, 0))::NUMERIC / 60.0)::INTEGER;
  RETURN GREATEST(1, v_minutes) * GREATEST(1, COALESCE(p_rate_per_minute, 10));
END;
$$;

-- ── end_call_billing ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.end_call_billing(
  p_call_id            UUID,
  p_actor_user_id      UUID,
  p_duration_seconds   INTEGER,
  p_idempotency_key    TEXT,
  p_ended_reason       TEXT DEFAULT NULL,
  p_ended_by           TEXT DEFAULT 'participant'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_call               public.calls%ROWTYPE;
  v_cached             JSONB;
  v_rate               INTEGER;
  v_coins_spent        INTEGER;
  v_commission_pct     NUMERIC := 30.0;
  v_platform_share     NUMERIC;
  v_creator_share      NUMERIC;
  v_wallet_result      public.user_wallet_result;
  v_creator_profile_id UUID;
  v_earning_id         UUID;
  v_updated            INTEGER;
  v_response           JSONB;
  v_billable_duration  INTEGER;
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

  SELECT * INTO v_call
    FROM public.calls
   WHERE id = p_call_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'call_not_found';
  END IF;

  IF p_ended_by <> 'system' AND p_ended_by <> 'admin' THEN
    IF p_actor_user_id IS DISTINCT FROM v_call.caller_id
       AND p_actor_user_id IS DISTINCT FROM v_call.creator_id THEN
      RAISE EXCEPTION 'not_call_participant';
    END IF;
  END IF;

  -- Idempotent: already settled
  IF v_call.status = 'ended' THEN
    SELECT creator_share INTO v_creator_share
      FROM public.creator_earnings
     WHERE call_id = p_call_id;

    v_response := jsonb_build_object(
      'call_id', v_call.id,
      'caller_id', v_call.caller_id,
      'creator_id', v_call.creator_id,
      'status', 'ended',
      'duration_seconds', COALESCE(v_call.billable_duration_seconds, v_call.duration_seconds),
      'coins_spent', v_call.coins_spent,
      'creator_share', COALESCE(v_creator_share, 0),
      'balance_after', (SELECT coin_balance FROM public.wallets WHERE user_id = v_call.caller_id),
      'already_ended', TRUE,
      'idempotent_replay', TRUE
    );

    INSERT INTO public.call_end_idempotency_records (idempotency_key, call_id, response_json)
    VALUES (p_idempotency_key, p_call_id, v_response)
    ON CONFLICT (idempotency_key) DO NOTHING;

    RETURN v_response;
  END IF;

  IF v_call.status NOT IN ('accepted', 'ringing', 'ongoing') THEN
    RAISE EXCEPTION 'invalid_call_state: %', v_call.status;
  END IF;

  v_billable_duration := GREATEST(0, COALESCE(p_duration_seconds, 0));

  SELECT COALESCE(cp.price_per_minute, 10) INTO v_rate
    FROM public.creator_profiles cp
   WHERE cp.user_id = v_call.creator_id;

  IF NOT FOUND THEN
    v_rate := 10;
  END IF;

  v_coins_spent := public.compute_call_coins(v_billable_duration, v_rate);

  SELECT platform_commission_percent INTO v_commission_pct
    FROM public.app_settings
   LIMIT 1;

  IF NOT FOUND OR v_commission_pct IS NULL THEN
    v_commission_pct := 30.0;
  END IF;

  v_platform_share := round((v_coins_spent * (v_commission_pct / 100.0))::NUMERIC, 2);
  v_creator_share := round((v_coins_spent - v_platform_share)::NUMERIC, 2);

  UPDATE public.calls
     SET status = 'ended',
         ended_at = NOW(),
         duration_seconds = v_billable_duration,
         billable_duration_seconds = v_billable_duration,
         coins_spent = v_coins_spent,
         coins_deducted = v_coins_spent,
         ended_reason = p_ended_reason,
         end_idempotency_key = p_idempotency_key,
         version = version + 1
   WHERE id = p_call_id
     AND status IN ('accepted', 'ringing', 'ongoing');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'call_billing_cas_conflict';
  END IF;

  v_wallet_result := public.adjust_user_coins_v2(
    p_user_id         := v_call.caller_id,
    p_delta           := -v_coins_spent,
    p_source_type     := 'call',
    p_source_id       := p_call_id,
    p_idempotency_key := 'call_debit:' || p_call_id::TEXT,
    p_allow_partial   := FALSE,
    p_admin_id        := NULL
  );

  INSERT INTO public.creator_earnings (
    call_id, creator_id, gross_amount, creator_share, platform_share
  ) VALUES (
    p_call_id,
    v_call.creator_id,
    v_coins_spent::NUMERIC,
    v_creator_share,
    v_platform_share
  )
  ON CONFLICT (call_id) DO NOTHING
  RETURNING id INTO v_earning_id;

  IF v_earning_id IS NULL THEN
    SELECT id, creator_share INTO v_earning_id, v_creator_share
      FROM public.creator_earnings
     WHERE call_id = p_call_id;
  END IF;

  SELECT id INTO v_creator_profile_id
    FROM public.creator_profiles
   WHERE user_id = v_call.creator_id;

  IF v_creator_profile_id IS NOT NULL AND v_creator_share > 0 THEN
    PERFORM public.increment_creator_wallet(v_creator_profile_id, v_creator_share);
  END IF;

  v_response := jsonb_build_object(
    'call_id', p_call_id,
    'caller_id', v_call.caller_id,
    'creator_id', v_call.creator_id,
    'status', 'ended',
    'duration_seconds', v_billable_duration,
    'coins_spent', v_coins_spent,
    'creator_share', v_creator_share,
    'coin_transaction_id', v_wallet_result.coin_transaction_id,
    'creator_earning_id', v_earning_id,
    'balance_before', v_wallet_result.balance_before,
    'balance_after', v_wallet_result.balance_after,
    'already_ended', FALSE,
    'idempotent_replay', COALESCE(v_wallet_result.idempotent_replay, FALSE)
  );

  INSERT INTO public.call_end_idempotency_records (idempotency_key, call_id, response_json)
  VALUES (p_idempotency_key, p_call_id, v_response)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_response;
END;
$$;

-- ── mark_call_request_missed (HIGH-04) ────────────────────────
CREATE OR REPLACE FUNCTION public.mark_call_request_missed(
  p_call_request_id UUID,
  p_actor_user_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req          public.call_requests%ROWTYPE;
  v_call_status  TEXT;
  v_updated      INTEGER;
BEGIN
  SELECT * INTO v_req
    FROM public.call_requests
   WHERE id = p_call_request_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'call_request_not_found';
  END IF;

  IF p_actor_user_id IS DISTINCT FROM v_req.caller_id
     AND p_actor_user_id IS DISTINCT FROM v_req.creator_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_req.status = 'missed' THEN
    RETURN jsonb_build_object(
      'call_request_id', p_call_request_id,
      'status', 'missed',
      'idempotent_replay', TRUE
    );
  END IF;

  IF v_req.status = 'accepted' THEN
    RAISE EXCEPTION 'call_already_active';
  END IF;

  IF v_req.call_id IS NOT NULL THEN
    SELECT status INTO v_call_status
      FROM public.calls
     WHERE id = v_req.call_id;

    IF FOUND AND v_call_status IN ('accepted', 'ringing', 'ongoing') THEN
      RAISE EXCEPTION 'call_already_active';
    END IF;
  END IF;

  IF v_req.status <> 'requested' THEN
    RAISE EXCEPTION 'invalid_transition: %', v_req.status;
  END IF;

  UPDATE public.call_requests
     SET status = 'missed',
         updated_at = NOW()
   WHERE id = p_call_request_id
     AND status = 'requested';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'miss_cas_conflict';
  END IF;

  IF v_req.call_id IS NOT NULL THEN
    UPDATE public.calls
       SET status = 'missed',
           ended_at = NOW(),
           duration_seconds = 0,
           coins_spent = 0,
           coins_deducted = 0
     WHERE id = v_req.call_id
       AND status IN ('requested', 'accepted', 'ringing');
  ELSE
    INSERT INTO public.calls (
      caller_id, creator_id, type, status, channel_name,
      started_at, ended_at, duration_seconds, coins_spent, coins_deducted
    ) VALUES (
      v_req.caller_id,
      v_req.creator_id,
      COALESCE(v_req.type, 'voice'),
      'missed',
      COALESCE(v_req.channel_name, 'ch_missed_' || left(p_call_request_id::TEXT, 8)),
      COALESCE(v_req.created_at, NOW()),
      NOW(),
      0, 0, 0
    );
  END IF;

  RETURN jsonb_build_object(
    'call_request_id', p_call_request_id,
    'status', 'missed',
    'idempotent_replay', FALSE
  );
END;
$$;

-- ── Permissions (service_role only) ───────────────────────────
REVOKE ALL ON FUNCTION public.end_call_billing(UUID, UUID, INTEGER, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.mark_call_request_missed(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.end_call_billing(UUID, UUID, INTEGER, TEXT, TEXT, TEXT)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.mark_call_request_missed(UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION public.end_call_billing IS
  'Atomic call settlement: CAS end + caller debit + creator_earnings + wallet credit in one transaction.';

COMMENT ON FUNCTION public.mark_call_request_missed IS
  'Miss ring-timeout requests only; rejects accepted/active sessions (HIGH-04).';

COMMIT;
