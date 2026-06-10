-- ============================================================
-- Sprint 6: Creator Ledger + Withdrawal State Machine
-- creator_ledger_entries · locked_balance · withdrawal RPCs
-- ============================================================

BEGIN;

-- ── creator_wallets: locked_balance ───────────────────────────
ALTER TABLE public.creator_wallets
  ADD COLUMN IF NOT EXISTS locked_balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00;

UPDATE public.creator_wallets SET locked_balance = 0.00 WHERE locked_balance IS NULL;

ALTER TABLE public.creator_wallets
  DROP CONSTRAINT IF EXISTS creator_wallets_locked_non_negative;
ALTER TABLE public.creator_wallets
  ADD CONSTRAINT creator_wallets_locked_non_negative CHECK (locked_balance >= 0);

ALTER TABLE public.creator_wallets
  DROP CONSTRAINT IF EXISTS creator_wallets_balance_invariant;
ALTER TABLE public.creator_wallets
  ADD CONSTRAINT creator_wallets_balance_invariant CHECK (
    total_earned = available_balance + locked_balance + withdrawn_amount
  ) NOT VALID;

-- ── creator_ledger_entries (L1 journal) ───────────────────────
CREATE TABLE IF NOT EXISTS public.creator_ledger_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_profile_id  UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE RESTRICT,
  creator_user_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  entry_type          TEXT NOT NULL CHECK (entry_type IN (
    'call_earning', 'gift_earning', 'adjustment_credit', 'adjustment_debit',
    'withdrawal_reserve', 'withdrawal_release', 'withdrawal_payout',
    'refund_clawback', 'refund_restore'
  )),
  amount_coins        NUMERIC(12, 2) NOT NULL CHECK (amount_coins > 0),
  source_type         TEXT NOT NULL,
  source_id           UUID,
  idempotency_key     TEXT NOT NULL,
  created_by          TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_creator_ledger_source_entry
  ON public.creator_ledger_entries (source_type, source_id, entry_type)
  WHERE source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_creator_ledger_profile_idempotency
  ON public.creator_ledger_entries (creator_profile_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_creator_ledger_profile_created
  ON public.creator_ledger_entries (creator_profile_id, created_at ASC);

ALTER TABLE public.creator_ledger_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS creator_ledger_entries_deny_clients ON public.creator_ledger_entries;
CREATE POLICY creator_ledger_entries_deny_clients ON public.creator_ledger_entries
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ── withdrawals schema extensions ─────────────────────────────
ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS creator_profile_id UUID REFERENCES public.creator_profiles(id),
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS locked_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS available_before NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES public.admin_users(id),
  ADD COLUMN IF NOT EXISTS correlation_id TEXT;

ALTER TABLE public.withdrawals DROP CONSTRAINT IF EXISTS withdrawals_status_check;
ALTER TABLE public.withdrawals
  ADD CONSTRAINT withdrawals_status_check
  CHECK (status IN ('pending', 'approved', 'paid', 'rejected', 'cancelled', 'failed'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_withdrawals_creator_idempotency
  ON public.withdrawals (creator_profile_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_withdrawal_one_inflight
  ON public.withdrawals (creator_profile_id)
  WHERE status IN ('pending', 'approved') AND creator_profile_id IS NOT NULL;

-- ── payout_audit_logs (immutable) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.payout_audit_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type      TEXT NOT NULL DEFAULT 'withdrawal',
  entity_id        UUID NOT NULL,
  action           TEXT NOT NULL,
  actor_type       TEXT NOT NULL CHECK (actor_type IN ('creator', 'admin', 'system', 'webhook')),
  actor_id         UUID,
  before_state     JSONB NOT NULL DEFAULT '{}'::JSONB,
  after_state      JSONB NOT NULL DEFAULT '{}'::JSONB,
  correlation_id   TEXT,
  idempotency_key  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payout_audit_entity
  ON public.payout_audit_logs (entity_id, created_at DESC);

ALTER TABLE public.payout_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payout_audit_logs_deny_mutation ON public.payout_audit_logs;
CREATE POLICY payout_audit_logs_deny_clients ON public.payout_audit_logs
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.deny_payout_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payout_audit_logs is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_payout_audit_no_mutate ON public.payout_audit_logs;
CREATE TRIGGER trg_payout_audit_no_mutate
  BEFORE UPDATE OR DELETE ON public.payout_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.deny_payout_audit_mutation();

-- ── withdrawal idempotency cache ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.withdrawal_idempotency_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope            TEXT NOT NULL,
  withdrawal_id    UUID,
  idempotency_key  TEXT NOT NULL,
  response_json    JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_withdrawal_idempotency_scope_key
  ON public.withdrawal_idempotency_records (
    scope, idempotency_key, COALESCE(withdrawal_id::TEXT, '')
  );

-- ── apply ledger entry to wallet projection ───────────────────
CREATE OR REPLACE FUNCTION public.apply_creator_ledger_to_wallet(
  p_creator_profile_id UUID,
  p_entry_type         TEXT,
  p_amount             NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.creator_wallets (
    creator_id, total_earned, available_balance, locked_balance, withdrawn_amount
  ) VALUES (
    p_creator_profile_id, 0, 0, 0, 0
  ) ON CONFLICT (creator_id) DO NOTHING;

  CASE p_entry_type
    WHEN 'call_earning', 'gift_earning', 'adjustment_credit', 'refund_restore' THEN
      UPDATE public.creator_wallets
         SET total_earned = total_earned + p_amount,
             available_balance = available_balance + p_amount,
             updated_at = NOW()
       WHERE creator_id = p_creator_profile_id;
    WHEN 'adjustment_debit', 'refund_clawback' THEN
      UPDATE public.creator_wallets
         SET available_balance = available_balance - p_amount,
             updated_at = NOW()
       WHERE creator_id = p_creator_profile_id;
    WHEN 'withdrawal_reserve' THEN
      UPDATE public.creator_wallets
         SET available_balance = available_balance - p_amount,
             locked_balance = locked_balance + p_amount,
             updated_at = NOW()
       WHERE creator_id = p_creator_profile_id;
    WHEN 'withdrawal_release' THEN
      UPDATE public.creator_wallets
         SET available_balance = available_balance + p_amount,
             locked_balance = locked_balance - p_amount,
             updated_at = NOW()
       WHERE creator_id = p_creator_profile_id;
    WHEN 'withdrawal_payout' THEN
      UPDATE public.creator_wallets
         SET locked_balance = locked_balance - p_amount,
             withdrawn_amount = withdrawn_amount + p_amount,
             updated_at = NOW()
       WHERE creator_id = p_creator_profile_id;
    ELSE
      RAISE EXCEPTION 'unknown_ledger_entry_type: %', p_entry_type;
  END CASE;
END;
$$;

-- ── rebuild wallet projection from ledger (verification) ──────
CREATE OR REPLACE FUNCTION public.rebuild_creator_wallet_from_ledger(
  p_creator_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_earned      NUMERIC(12, 2) := 0;
  v_available         NUMERIC(12, 2) := 0;
  v_locked            NUMERIC(12, 2) := 0;
  v_withdrawn         NUMERIC(12, 2) := 0;
  v_row               RECORD;
BEGIN
  FOR v_row IN
    SELECT entry_type, amount_coins
      FROM public.creator_ledger_entries
     WHERE creator_profile_id = p_creator_profile_id
     ORDER BY created_at ASC, id ASC
  LOOP
    CASE v_row.entry_type
      WHEN 'call_earning', 'gift_earning', 'adjustment_credit', 'refund_restore' THEN
        v_total_earned := v_total_earned + v_row.amount_coins;
        v_available := v_available + v_row.amount_coins;
      WHEN 'adjustment_debit', 'refund_clawback' THEN
        v_available := v_available - v_row.amount_coins;
      WHEN 'withdrawal_reserve' THEN
        v_available := v_available - v_row.amount_coins;
        v_locked := v_locked + v_row.amount_coins;
      WHEN 'withdrawal_release' THEN
        v_available := v_available + v_row.amount_coins;
        v_locked := v_locked - v_row.amount_coins;
      WHEN 'withdrawal_payout' THEN
        v_locked := v_locked - v_row.amount_coins;
        v_withdrawn := v_withdrawn + v_row.amount_coins;
      ELSE NULL;
    END CASE;
  END LOOP;

  INSERT INTO public.creator_wallets (
    creator_id, total_earned, available_balance, locked_balance, withdrawn_amount
  ) VALUES (
    p_creator_profile_id, v_total_earned, v_available, v_locked, v_withdrawn
  )
  ON CONFLICT (creator_id) DO UPDATE
    SET total_earned = EXCLUDED.total_earned,
        available_balance = EXCLUDED.available_balance,
        locked_balance = EXCLUDED.locked_balance,
        withdrawn_amount = EXCLUDED.withdrawn_amount,
        updated_at = NOW();

  RETURN jsonb_build_object(
    'creator_profile_id', p_creator_profile_id,
    'total_earned', v_total_earned,
    'available_balance', v_available,
    'locked_balance', v_locked,
    'withdrawn_amount', v_withdrawn
  );
END;
$$;

-- ── internal: wallet snapshot JSON ────────────────────────────
CREATE OR REPLACE FUNCTION public._creator_wallet_snapshot(p_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_wallet public.creator_wallets%ROWTYPE;
BEGIN
  SELECT * INTO v_wallet
    FROM public.creator_wallets
   WHERE creator_id = p_profile_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('available', 0, 'locked', 0, 'withdrawn', 0, 'total_earned', 0);
  END IF;
  RETURN jsonb_build_object(
    'available', v_wallet.available_balance,
    'locked', v_wallet.locked_balance,
    'withdrawn', v_wallet.withdrawn_amount,
    'total_earned', v_wallet.total_earned
  );
END;
$$;

-- ── internal: insert ledger + apply ───────────────────────────
CREATE OR REPLACE FUNCTION public._creator_ledger_append(
  p_profile_id       UUID,
  p_user_id          UUID,
  p_entry_type       TEXT,
  p_amount           NUMERIC,
  p_source_type      TEXT,
  p_source_id        UUID,
  p_idempotency_key  TEXT,
  p_created_by       TEXT DEFAULT 'rpc'
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.creator_ledger_entries (
    creator_profile_id, creator_user_id, entry_type, amount_coins,
    source_type, source_id, idempotency_key, created_by
  ) VALUES (
    p_profile_id, p_user_id, p_entry_type, p_amount,
    p_source_type, p_source_id, p_idempotency_key, p_created_by
  )
  ON CONFLICT (source_type, source_id, entry_type)
    WHERE source_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
      FROM public.creator_ledger_entries
     WHERE source_type = p_source_type
       AND source_id = p_source_id
       AND entry_type = p_entry_type;
    RETURN v_id;
  END IF;

  PERFORM public.apply_creator_ledger_to_wallet(p_profile_id, p_entry_type, p_amount);
  RETURN v_id;
END;
$$;

-- ── request_creator_withdrawal (T0) ───────────────────────────
CREATE OR REPLACE FUNCTION public.request_creator_withdrawal(
  p_creator_user_id    UUID,
  p_amount             NUMERIC,
  p_idempotency_key    TEXT,
  p_bank_account_name  TEXT DEFAULT NULL,
  p_bank_account_number TEXT DEFAULT NULL,
  p_bank_ifsc          TEXT DEFAULT NULL,
  p_upi_id             TEXT DEFAULT NULL,
  p_correlation_id     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id    UUID;
  v_wallet        public.creator_wallets%ROWTYPE;
  v_before        JSONB;
  v_withdrawal_id UUID;
  v_ledger_id     UUID;
  v_response      JSONB;
  v_min           NUMERIC := 100;
  v_cached        JSONB;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT response_json INTO v_cached
    FROM public.withdrawal_idempotency_records
   WHERE scope = 'request' AND idempotency_key = p_idempotency_key AND withdrawal_id IS NULL;
  IF FOUND THEN
    RETURN v_cached || jsonb_build_object('idempotent_replay', TRUE);
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  SELECT id INTO v_profile_id FROM public.creator_profiles WHERE user_id = p_creator_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'creator_profile_not_found';
  END IF;

  SELECT min_withdrawal INTO v_min FROM public.app_settings LIMIT 1;
  IF v_min IS NULL THEN v_min := 100; END IF;
  IF p_amount < v_min THEN
    RAISE EXCEPTION 'below_min_withdrawal: %', v_min;
  END IF;

  INSERT INTO public.creator_wallets (creator_id) VALUES (v_profile_id)
  ON CONFLICT (creator_id) DO NOTHING;

  SELECT * INTO v_wallet
    FROM public.creator_wallets
   WHERE creator_id = v_profile_id
     FOR UPDATE;

  IF v_wallet.available_balance < p_amount THEN
    RAISE EXCEPTION 'insufficient_available_balance';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.withdrawals
     WHERE creator_profile_id = v_profile_id
       AND status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'inflight_withdrawal_exists';
  END IF;

  v_before := public._creator_wallet_snapshot(v_profile_id);

  INSERT INTO public.withdrawals (
    creator_id, creator_profile_id, amount, status,
    bank_account_name, bank_account_number, bank_ifsc, upi_id,
    locked_amount, available_before, idempotency_key, correlation_id
  ) VALUES (
    p_creator_user_id, v_profile_id, p_amount, 'pending',
    p_bank_account_name, p_bank_account_number, p_bank_ifsc, p_upi_id,
    p_amount, v_wallet.available_balance, p_idempotency_key, p_correlation_id
  )
  RETURNING id INTO v_withdrawal_id;

  v_ledger_id := public._creator_ledger_append(
    v_profile_id, p_creator_user_id, 'withdrawal_reserve', p_amount,
    'withdrawal', v_withdrawal_id, 'withdrawal-reserve:' || v_withdrawal_id::TEXT
  );

  INSERT INTO public.payout_audit_logs (
    entity_id, action, actor_type, actor_id,
    before_state, after_state, correlation_id, idempotency_key
  ) VALUES (
    v_withdrawal_id, 'withdrawal_requested', 'creator', p_creator_user_id,
    jsonb_build_object('status', NULL, 'wallet', v_before),
    jsonb_build_object('status', 'pending', 'wallet', public._creator_wallet_snapshot(v_profile_id)),
    p_correlation_id, p_idempotency_key
  );

  v_response := jsonb_build_object(
    'withdrawal_id', v_withdrawal_id,
    'creator_profile_id', v_profile_id,
    'creator_user_id', p_creator_user_id,
    'amount', p_amount,
    'status', 'pending',
    'ledger_entry_id', v_ledger_id,
    'wallet', public._creator_wallet_snapshot(v_profile_id),
    'idempotent_replay', FALSE
  );

  INSERT INTO public.withdrawal_idempotency_records (scope, withdrawal_id, idempotency_key, response_json)
  VALUES ('request', NULL, p_idempotency_key, v_response)
  ON CONFLICT DO NOTHING;

  RETURN v_response;
END;
$$;

-- ── approve_creator_withdrawal (T1) ───────────────────────────
CREATE OR REPLACE FUNCTION public.approve_creator_withdrawal(
  p_withdrawal_id   UUID,
  p_admin_id        UUID,
  p_idempotency_key TEXT,
  p_correlation_id  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_w             public.withdrawals%ROWTYPE;
  v_before        JSONB;
  v_updated       INTEGER;
  v_response      JSONB;
  v_cached        JSONB;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT response_json INTO v_cached
    FROM public.withdrawal_idempotency_records
   WHERE scope = 'approve' AND withdrawal_id = p_withdrawal_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN v_cached || jsonb_build_object('idempotent_replay', TRUE); END IF;

  SELECT * INTO v_w FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'withdrawal_not_found'; END IF;

  IF v_w.status = 'approved' THEN
    RETURN jsonb_build_object('withdrawal_id', p_withdrawal_id, 'status', 'approved', 'idempotent_replay', TRUE);
  END IF;
  IF v_w.status <> 'pending' THEN
    RAISE EXCEPTION 'invalid_transition: %', v_w.status;
  END IF;

  PERFORM 1 FROM public.creator_wallets WHERE creator_id = v_w.creator_profile_id FOR UPDATE;

  v_before := jsonb_build_object('status', v_w.status, 'wallet', public._creator_wallet_snapshot(v_w.creator_profile_id));

  UPDATE public.withdrawals
     SET status = 'approved',
         approved_at = NOW(),
         approved_by = p_admin_id,
         version = version + 1
   WHERE id = p_withdrawal_id AND status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'withdrawal_cas_conflict'; END IF;

  INSERT INTO public.payout_audit_logs (
    entity_id, action, actor_type, actor_id, before_state, after_state, correlation_id, idempotency_key
  ) VALUES (
    p_withdrawal_id, 'withdrawal_approved', 'admin', p_admin_id,
    v_before,
    jsonb_build_object('status', 'approved', 'wallet', public._creator_wallet_snapshot(v_w.creator_profile_id)),
    p_correlation_id, p_idempotency_key
  );

  v_response := jsonb_build_object(
    'withdrawal_id', p_withdrawal_id,
    'status', 'approved',
    'wallet', public._creator_wallet_snapshot(v_w.creator_profile_id),
    'idempotent_replay', FALSE
  );

  INSERT INTO public.withdrawal_idempotency_records (scope, withdrawal_id, idempotency_key, response_json)
  VALUES ('approve', p_withdrawal_id, p_idempotency_key, v_response)
  ON CONFLICT DO NOTHING;

  RETURN v_response;
END;
$$;

-- ── reject_creator_withdrawal (T2) ────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_creator_withdrawal(
  p_withdrawal_id   UUID,
  p_admin_id        UUID,
  p_reason          TEXT,
  p_idempotency_key TEXT,
  p_correlation_id  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_w       public.withdrawals%ROWTYPE;
  v_before  JSONB;
  v_updated INTEGER;
  v_response JSONB;
  v_cached  JSONB;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT response_json INTO v_cached
    FROM public.withdrawal_idempotency_records
   WHERE scope = 'reject' AND withdrawal_id = p_withdrawal_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN v_cached || jsonb_build_object('idempotent_replay', TRUE); END IF;

  SELECT * INTO v_w FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'withdrawal_not_found'; END IF;

  IF v_w.status = 'rejected' THEN
    RETURN jsonb_build_object('withdrawal_id', p_withdrawal_id, 'status', 'rejected', 'idempotent_replay', TRUE);
  END IF;
  IF v_w.status <> 'pending' THEN RAISE EXCEPTION 'invalid_transition: %', v_w.status; END IF;

  PERFORM 1 FROM public.creator_wallets WHERE creator_id = v_w.creator_profile_id FOR UPDATE;
  v_before := jsonb_build_object('status', v_w.status, 'wallet', public._creator_wallet_snapshot(v_w.creator_profile_id));

  PERFORM public._creator_ledger_append(
    v_w.creator_profile_id, v_w.creator_id, 'withdrawal_release', v_w.amount,
    'withdrawal', p_withdrawal_id, 'withdrawal-release:' || p_withdrawal_id::TEXT || ':reject'
  );

  UPDATE public.withdrawals
     SET status = 'rejected',
         admin_notes = p_reason,
         rejected_at = NOW(),
         rejected_by = p_admin_id,
         version = version + 1
   WHERE id = p_withdrawal_id AND status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'withdrawal_cas_conflict'; END IF;

  INSERT INTO public.payout_audit_logs (
    entity_id, action, actor_type, actor_id, before_state, after_state, correlation_id, idempotency_key
  ) VALUES (
    p_withdrawal_id, 'withdrawal_rejected', 'admin', p_admin_id,
    v_before,
    jsonb_build_object('status', 'rejected', 'wallet', public._creator_wallet_snapshot(v_w.creator_profile_id)),
    p_correlation_id, p_idempotency_key
  );

  v_response := jsonb_build_object(
    'withdrawal_id', p_withdrawal_id, 'status', 'rejected',
    'wallet', public._creator_wallet_snapshot(v_w.creator_profile_id),
    'idempotent_replay', FALSE
  );

  INSERT INTO public.withdrawal_idempotency_records (scope, withdrawal_id, idempotency_key, response_json)
  VALUES ('reject', p_withdrawal_id, p_idempotency_key, v_response) ON CONFLICT DO NOTHING;

  RETURN v_response;
END;
$$;

-- ── cancel_creator_withdrawal (T3/T6) ────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_creator_withdrawal(
  p_withdrawal_id   UUID,
  p_actor_id        UUID,
  p_actor_type      TEXT,
  p_reason          TEXT,
  p_idempotency_key TEXT,
  p_correlation_id  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_w       public.withdrawals%ROWTYPE;
  v_before  JSONB;
  v_updated INTEGER;
  v_response JSONB;
  v_cached  JSONB;
BEGIN
  SELECT response_json INTO v_cached
    FROM public.withdrawal_idempotency_records
   WHERE scope = 'cancel' AND withdrawal_id = p_withdrawal_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN v_cached || jsonb_build_object('idempotent_replay', TRUE); END IF;

  SELECT * INTO v_w FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'withdrawal_not_found'; END IF;

  IF v_w.status = 'cancelled' THEN
    RETURN jsonb_build_object('withdrawal_id', p_withdrawal_id, 'status', 'cancelled', 'idempotent_replay', TRUE);
  END IF;

  IF v_w.status = 'pending' THEN
    IF p_actor_type = 'creator' AND p_actor_id IS DISTINCT FROM v_w.creator_id THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  ELSIF v_w.status = 'approved' THEN
    IF p_actor_type <> 'admin' THEN
      RAISE EXCEPTION 'invalid_transition: approved_cancel_requires_admin';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_transition: %', v_w.status;
  END IF;

  PERFORM 1 FROM public.creator_wallets WHERE creator_id = v_w.creator_profile_id FOR UPDATE;
  v_before := jsonb_build_object('status', v_w.status, 'wallet', public._creator_wallet_snapshot(v_w.creator_profile_id));

  PERFORM public._creator_ledger_append(
    v_w.creator_profile_id, v_w.creator_id, 'withdrawal_release', v_w.amount,
    'withdrawal', p_withdrawal_id, 'withdrawal-release:' || p_withdrawal_id::TEXT || ':cancel'
  );

  UPDATE public.withdrawals
     SET status = 'cancelled',
         cancellation_reason = COALESCE(p_reason, 'cancelled'),
         cancelled_at = NOW(),
         cancelled_by = CASE WHEN p_actor_type = 'admin' THEN p_actor_id ELSE NULL END,
         version = version + 1
   WHERE id = p_withdrawal_id AND status IN ('pending', 'approved');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'withdrawal_cas_conflict'; END IF;

  INSERT INTO public.payout_audit_logs (
    entity_id, action, actor_type, actor_id, before_state, after_state, correlation_id, idempotency_key
  ) VALUES (
    p_withdrawal_id, 'withdrawal_cancelled', p_actor_type, p_actor_id,
    v_before,
    jsonb_build_object('status', 'cancelled', 'wallet', public._creator_wallet_snapshot(v_w.creator_profile_id)),
    p_correlation_id, p_idempotency_key
  );

  v_response := jsonb_build_object(
    'withdrawal_id', p_withdrawal_id, 'status', 'cancelled',
    'wallet', public._creator_wallet_snapshot(v_w.creator_profile_id),
    'idempotent_replay', FALSE
  );

  INSERT INTO public.withdrawal_idempotency_records (scope, withdrawal_id, idempotency_key, response_json)
  VALUES ('cancel', p_withdrawal_id, p_idempotency_key, v_response) ON CONFLICT DO NOTHING;

  RETURN v_response;
END;
$$;

-- ── settle_creator_withdrawal (T4) ────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_creator_withdrawal(
  p_withdrawal_id      UUID,
  p_admin_id           UUID,
  p_payment_reference  TEXT,
  p_idempotency_key    TEXT,
  p_admin_notes        TEXT DEFAULT NULL,
  p_correlation_id     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_w       public.withdrawals%ROWTYPE;
  v_before  JSONB;
  v_updated INTEGER;
  v_response JSONB;
  v_cached  JSONB;
  v_ledger  UUID;
BEGIN
  IF p_payment_reference IS NULL OR length(trim(p_payment_reference)) = 0 THEN
    RAISE EXCEPTION 'payment_reference_required';
  END IF;

  SELECT response_json INTO v_cached
    FROM public.withdrawal_idempotency_records
   WHERE scope = 'settle' AND withdrawal_id = p_withdrawal_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN v_cached || jsonb_build_object('idempotent_replay', TRUE); END IF;

  SELECT * INTO v_w FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'withdrawal_not_found'; END IF;

  IF v_w.status = 'paid' THEN
    RETURN jsonb_build_object('withdrawal_id', p_withdrawal_id, 'status', 'paid', 'idempotent_replay', TRUE);
  END IF;
  IF v_w.status <> 'approved' THEN RAISE EXCEPTION 'invalid_transition: %', v_w.status; END IF;

  PERFORM 1 FROM public.creator_wallets WHERE creator_id = v_w.creator_profile_id FOR UPDATE;
  v_before := jsonb_build_object('status', v_w.status, 'wallet', public._creator_wallet_snapshot(v_w.creator_profile_id));

  v_ledger := public._creator_ledger_append(
    v_w.creator_profile_id, v_w.creator_id, 'withdrawal_payout', v_w.amount,
    'withdrawal', p_withdrawal_id, 'withdrawal-payout:' || p_withdrawal_id::TEXT
  );

  UPDATE public.withdrawals
     SET status = 'paid',
         payment_reference = p_payment_reference,
         admin_notes = COALESCE(p_admin_notes, admin_notes),
         paid_at = NOW(),
         paid_by = p_admin_id,
         version = version + 1
   WHERE id = p_withdrawal_id AND status = 'approved';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'withdrawal_cas_conflict'; END IF;

  INSERT INTO public.payout_audit_logs (
    entity_id, action, actor_type, actor_id, before_state, after_state, correlation_id, idempotency_key
  ) VALUES (
    p_withdrawal_id, 'withdrawal_paid', 'admin', p_admin_id,
    v_before,
    jsonb_build_object('status', 'paid', 'wallet', public._creator_wallet_snapshot(v_w.creator_profile_id)),
    p_correlation_id, p_idempotency_key
  );

  v_response := jsonb_build_object(
    'withdrawal_id', p_withdrawal_id,
    'status', 'paid',
    'ledger_entry_id', v_ledger,
    'payment_reference', p_payment_reference,
    'wallet', public._creator_wallet_snapshot(v_w.creator_profile_id),
    'idempotent_replay', FALSE
  );

  INSERT INTO public.withdrawal_idempotency_records (scope, withdrawal_id, idempotency_key, response_json)
  VALUES ('settle', p_withdrawal_id, p_idempotency_key, v_response) ON CONFLICT DO NOTHING;

  RETURN v_response;
END;
$$;

-- ── fail_creator_withdrawal (T5) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fail_creator_withdrawal(
  p_withdrawal_id   UUID,
  p_actor_id        UUID,
  p_actor_type      TEXT,
  p_reason          TEXT,
  p_idempotency_key TEXT,
  p_correlation_id  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_w       public.withdrawals%ROWTYPE;
  v_before  JSONB;
  v_updated INTEGER;
  v_response JSONB;
  v_cached  JSONB;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT response_json INTO v_cached
    FROM public.withdrawal_idempotency_records
   WHERE scope = 'fail' AND withdrawal_id = p_withdrawal_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN v_cached || jsonb_build_object('idempotent_replay', TRUE); END IF;

  SELECT * INTO v_w FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'withdrawal_not_found'; END IF;

  IF v_w.status = 'failed' THEN
    RETURN jsonb_build_object('withdrawal_id', p_withdrawal_id, 'status', 'failed', 'idempotent_replay', TRUE);
  END IF;
  IF v_w.status <> 'approved' THEN RAISE EXCEPTION 'invalid_transition: %', v_w.status; END IF;

  PERFORM 1 FROM public.creator_wallets WHERE creator_id = v_w.creator_profile_id FOR UPDATE;
  v_before := jsonb_build_object('status', v_w.status, 'wallet', public._creator_wallet_snapshot(v_w.creator_profile_id));

  PERFORM public._creator_ledger_append(
    v_w.creator_profile_id, v_w.creator_id, 'withdrawal_release', v_w.amount,
    'withdrawal', p_withdrawal_id, 'withdrawal-release:' || p_withdrawal_id::TEXT || ':fail'
  );

  UPDATE public.withdrawals
     SET status = 'failed',
         failure_reason = p_reason,
         failed_at = NOW(),
         version = version + 1
   WHERE id = p_withdrawal_id AND status = 'approved';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'withdrawal_cas_conflict'; END IF;

  INSERT INTO public.payout_audit_logs (
    entity_id, action, actor_type, actor_id, before_state, after_state, correlation_id, idempotency_key
  ) VALUES (
    p_withdrawal_id, 'withdrawal_failed', p_actor_type, p_actor_id,
    v_before,
    jsonb_build_object('status', 'failed', 'wallet', public._creator_wallet_snapshot(v_w.creator_profile_id)),
    p_correlation_id, p_idempotency_key
  );

  v_response := jsonb_build_object(
    'withdrawal_id', p_withdrawal_id, 'status', 'failed',
    'wallet', public._creator_wallet_snapshot(v_w.creator_profile_id),
    'idempotent_replay', FALSE
  );

  INSERT INTO public.withdrawal_idempotency_records (scope, withdrawal_id, idempotency_key, response_json)
  VALUES ('fail', p_withdrawal_id, p_idempotency_key, v_response) ON CONFLICT DO NOTHING;

  RETURN v_response;
END;
$$;

-- ── backfill creator_profile_id on legacy withdrawals ─────────
UPDATE public.withdrawals w
   SET creator_profile_id = cp.id
  FROM public.creator_profiles cp
 WHERE w.creator_profile_id IS NULL
   AND cp.user_id = w.creator_id;

-- ── Permissions (service_role only) ─────────────────────────
REVOKE ALL ON FUNCTION public.request_creator_withdrawal(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_creator_withdrawal(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_creator_withdrawal(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_creator_withdrawal(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_creator_withdrawal(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_creator_withdrawal(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rebuild_creator_wallet_from_ledger(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.request_creator_withdrawal(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_creator_withdrawal(UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_creator_withdrawal(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_creator_withdrawal(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_creator_withdrawal(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_creator_withdrawal(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.rebuild_creator_wallet_from_ledger(UUID) TO service_role;

COMMIT;
