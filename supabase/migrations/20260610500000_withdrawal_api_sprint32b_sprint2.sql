-- ============================================================
-- Phase 3.2B Sprint 2: Creator Withdrawal APIs
-- payout_account_id on withdrawals · limit enforcement · RPC extensions
-- ============================================================

BEGIN;

-- ── withdrawals: link to payout account ─────────────────────
ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS payout_account_id UUID REFERENCES public.payout_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_withdrawals_profile_requested
  ON public.withdrawals (creator_profile_id, requested_at DESC, id DESC)
  WHERE creator_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_withdrawals_payout_account
  ON public.withdrawals (payout_account_id)
  WHERE payout_account_id IS NOT NULL;

-- ── withdrawal policy columns (app_settings) ────────────────
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS max_daily_withdrawal_inr NUMERIC(12, 2) DEFAULT 50000.00,
  ADD COLUMN IF NOT EXISTS max_monthly_withdrawal_inr NUMERIC(12, 2) DEFAULT 200000.00,
  ADD COLUMN IF NOT EXISTS max_single_withdrawal_inr NUMERIC(12, 2) DEFAULT 25000.00,
  ADD COLUMN IF NOT EXISTS pre_kyc_monthly_cap_inr NUMERIC(12, 2) DEFAULT 10000.00,
  ADD COLUMN IF NOT EXISTS kyc_threshold_inr NUMERIC(12, 2) DEFAULT 10000.00;

-- ── Session bootstrap for payout field encryption ─────────────
CREATE OR REPLACE FUNCTION public.bootstrap_payout_encryption_session(p_key TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_key IS NULL OR length(trim(p_key)) < 32 THEN
    RAISE EXCEPTION 'payout_encryption_key_invalid';
  END IF;
  PERFORM set_config('app.payout_field_encryption_key', trim(p_key), true);
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_payout_encryption_session(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_payout_encryption_session(TEXT) TO service_role;

-- ── upsert_creator_payout_account (update path) ─────────────
CREATE OR REPLACE FUNCTION public.upsert_creator_payout_account(
  p_creator_profile_id UUID,
  p_type               TEXT,
  p_account_name       TEXT,
  p_upi_id             TEXT DEFAULT NULL,
  p_bank_name          TEXT DEFAULT NULL,
  p_account_number     TEXT DEFAULT NULL,
  p_ifsc_code          TEXT DEFAULT NULL,
  p_set_default        BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_existing UUID;
  v_row public.payout_accounts%ROWTYPE;
BEGIN
  IF p_creator_profile_id IS NULL THEN
    RAISE EXCEPTION 'creator_profile_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.creator_profiles WHERE id = p_creator_profile_id
  ) THEN
    RAISE EXCEPTION 'creator_profile_not_found';
  END IF;

  IF p_type NOT IN ('upi', 'bank') THEN
    RAISE EXCEPTION 'invalid_payout_account_type';
  END IF;

  IF p_account_name IS NULL OR length(trim(p_account_name)) = 0 THEN
    RAISE EXCEPTION 'account_name_required';
  END IF;

  SELECT id INTO v_existing
    FROM public.payout_accounts
   WHERE creator_profile_id = p_creator_profile_id
     AND is_default = true
     AND disabled_at IS NULL
   LIMIT 1
   FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    SELECT type INTO v_row.type FROM public.payout_accounts WHERE id = v_existing;
    IF v_row.type IS DISTINCT FROM p_type THEN
      UPDATE public.payout_accounts
         SET is_default = false, disabled_at = NOW(), updated_at = NOW()
       WHERE id = v_existing;
      v_existing := NULL;
    END IF;
  END IF;

  IF v_existing IS NOT NULL THEN
    IF p_type = 'upi' THEN
      IF p_upi_id IS NULL OR length(trim(p_upi_id)) = 0 THEN
        RAISE EXCEPTION 'upi_id_required';
      END IF;
      UPDATE public.payout_accounts
         SET account_name = trim(p_account_name),
             upi_id_encrypted = public.payout_encrypt_sensitive(trim(p_upi_id)),
             upi_id_masked = public.payout_mask_upi(trim(p_upi_id)),
             bank_name = NULL,
             account_number_encrypted = NULL,
             account_number_masked = NULL,
             ifsc_code = NULL,
             status = 'pending_verification',
             verified_at = NULL,
             updated_at = NOW()
       WHERE id = v_existing
       RETURNING id INTO v_id;
    ELSE
      IF p_account_number IS NULL OR length(trim(p_account_number)) = 0 THEN
        RAISE EXCEPTION 'account_number_required';
      END IF;
      IF p_ifsc_code IS NULL OR length(trim(p_ifsc_code)) = 0 THEN
        RAISE EXCEPTION 'ifsc_code_required';
      END IF;
      UPDATE public.payout_accounts
         SET account_name = trim(p_account_name),
             bank_name = NULLIF(trim(p_bank_name), ''),
             account_number_encrypted = public.payout_encrypt_sensitive(trim(p_account_number)),
             account_number_masked = public.payout_mask_bank_account(trim(p_account_number)),
             ifsc_code = upper(trim(p_ifsc_code)),
             upi_id_encrypted = NULL,
             upi_id_masked = NULL,
             status = 'pending_verification',
             verified_at = NULL,
             updated_at = NOW()
       WHERE id = v_existing
       RETURNING id INTO v_id;
    END IF;
  ELSE
    IF p_type = 'upi' THEN
      IF p_upi_id IS NULL OR length(trim(p_upi_id)) = 0 THEN
        RAISE EXCEPTION 'upi_id_required';
      END IF;
      INSERT INTO public.payout_accounts (
        creator_profile_id, type, account_name,
        upi_id_encrypted, upi_id_masked,
        is_default, status
      ) VALUES (
        p_creator_profile_id, 'upi', trim(p_account_name),
        public.payout_encrypt_sensitive(trim(p_upi_id)),
        public.payout_mask_upi(trim(p_upi_id)),
        COALESCE(p_set_default, true),
        'pending_verification'
      )
      RETURNING id INTO v_id;
    ELSE
      IF p_account_number IS NULL OR length(trim(p_account_number)) = 0 THEN
        RAISE EXCEPTION 'account_number_required';
      END IF;
      IF p_ifsc_code IS NULL OR length(trim(p_ifsc_code)) = 0 THEN
        RAISE EXCEPTION 'ifsc_code_required';
      END IF;
      INSERT INTO public.payout_accounts (
        creator_profile_id, type, account_name,
        bank_name, account_number_encrypted, account_number_masked, ifsc_code,
        is_default, status
      ) VALUES (
        p_creator_profile_id, 'bank', trim(p_account_name),
        NULLIF(trim(p_bank_name), ''),
        public.payout_encrypt_sensitive(trim(p_account_number)),
        public.payout_mask_bank_account(trim(p_account_number)),
        upper(trim(p_ifsc_code)),
        COALESCE(p_set_default, true),
        'pending_verification'
      )
      RETURNING id INTO v_id;
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.payout_accounts WHERE id = v_id;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'creatorProfileId', v_row.creator_profile_id,
    'type', v_row.type,
    'accountName', v_row.account_name,
    'upiIdMasked', v_row.upi_id_masked,
    'bankName', v_row.bank_name,
    'accountNumberMasked', v_row.account_number_masked,
    'ifscCode', v_row.ifsc_code,
    'isDefault', v_row.is_default,
    'status', v_row.status,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at
  );
END;
$$;

-- ── request_creator_withdrawal (extended — payout_account_id) ─
DROP FUNCTION IF EXISTS public.request_creator_withdrawal(
  UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.request_creator_withdrawal(
  p_creator_user_id     UUID,
  p_amount              NUMERIC,
  p_idempotency_key     TEXT,
  p_bank_account_name   TEXT DEFAULT NULL,
  p_bank_account_number TEXT DEFAULT NULL,
  p_bank_ifsc           TEXT DEFAULT NULL,
  p_upi_id              TEXT DEFAULT NULL,
  p_correlation_id      TEXT DEFAULT NULL,
  p_payout_account_id   UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id       UUID;
  v_wallet           public.creator_wallets%ROWTYPE;
  v_before           JSONB;
  v_withdrawal_id    UUID;
  v_ledger_id        UUID;
  v_response         JSONB;
  v_min              NUMERIC := 100;
  v_max_single       NUMERIC := 25000;
  v_max_daily        NUMERIC := 50000;
  v_max_monthly      NUMERIC := 200000;
  v_pre_kyc_monthly  NUMERIC := 10000;
  v_kyc_threshold    NUMERIC := 10000;
  v_cached           JSONB;
  v_payout           public.payout_accounts%ROWTYPE;
  v_kyc_status       TEXT := 'not_started';
  v_daily_sum        NUMERIC := 0;
  v_monthly_sum      NUMERIC := 0;
  v_ist_day          DATE;
  v_ist_month_start  TIMESTAMPTZ;
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

  SELECT min_withdrawal, max_single_withdrawal_inr, max_daily_withdrawal_inr,
         max_monthly_withdrawal_inr, pre_kyc_monthly_cap_inr, kyc_threshold_inr
    INTO v_min, v_max_single, v_max_daily, v_max_monthly, v_pre_kyc_monthly, v_kyc_threshold
    FROM public.app_settings
   LIMIT 1;

  IF v_min IS NULL THEN v_min := 100; END IF;
  IF v_max_single IS NULL THEN v_max_single := 25000; END IF;
  IF v_max_daily IS NULL THEN v_max_daily := 50000; END IF;
  IF v_max_monthly IS NULL THEN v_max_monthly := 200000; END IF;
  IF v_pre_kyc_monthly IS NULL THEN v_pre_kyc_monthly := 10000; END IF;
  IF v_kyc_threshold IS NULL THEN v_kyc_threshold := 10000; END IF;

  IF p_amount < v_min THEN
    RAISE EXCEPTION 'below_min_withdrawal: %', v_min;
  END IF;

  IF p_amount > v_max_single THEN
    RAISE EXCEPTION 'daily_limit_exceeded';
  END IF;

  v_ist_day := (NOW() AT TIME ZONE 'Asia/Kolkata')::date;
  v_ist_month_start := date_trunc('month', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';

  SELECT COALESCE(SUM(amount), 0) INTO v_daily_sum
    FROM public.withdrawals
   WHERE creator_profile_id = v_profile_id
     AND status IN ('pending', 'approved', 'paid')
     AND (requested_at AT TIME ZONE 'Asia/Kolkata')::date = v_ist_day;

  IF v_daily_sum + p_amount > v_max_daily THEN
    RAISE EXCEPTION 'daily_limit_exceeded';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_monthly_sum
    FROM public.withdrawals
   WHERE creator_profile_id = v_profile_id
     AND status IN ('pending', 'approved', 'paid')
     AND requested_at >= v_ist_month_start;

  IF v_monthly_sum + p_amount > v_max_monthly THEN
    RAISE EXCEPTION 'monthly_limit_exceeded';
  END IF;

  SELECT status INTO v_kyc_status
    FROM public.kyc_profiles
   WHERE creator_profile_id = v_profile_id;
  IF v_kyc_status IS NULL THEN
    v_kyc_status := 'not_started';
  END IF;

  IF p_amount > v_kyc_threshold AND v_kyc_status <> 'verified' THEN
    RAISE EXCEPTION 'kyc_required';
  END IF;

  IF v_kyc_status <> 'verified' AND v_monthly_sum + p_amount > v_pre_kyc_monthly THEN
    RAISE EXCEPTION 'monthly_limit_exceeded';
  END IF;

  IF p_payout_account_id IS NOT NULL THEN
    SELECT * INTO v_payout
      FROM public.payout_accounts
     WHERE id = p_payout_account_id
       AND creator_profile_id = v_profile_id
       AND disabled_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_account';
    END IF;

    IF v_payout.status IN ('rejected', 'disabled') THEN
      RAISE EXCEPTION 'invalid_account';
    END IF;

    p_bank_account_name := v_payout.account_name;
    IF v_payout.type = 'upi' THEN
      p_upi_id := v_payout.upi_id_masked;
      p_bank_account_number := NULL;
      p_bank_ifsc := NULL;
    ELSE
      p_bank_account_number := v_payout.account_number_masked;
      p_bank_ifsc := v_payout.ifsc_code;
      p_upi_id := NULL;
    END IF;
  ELSIF p_payout_account_id IS NULL AND p_bank_account_name IS NULL
        AND p_bank_account_number IS NULL AND p_upi_id IS NULL THEN
    RAISE EXCEPTION 'payout_account_missing';
  END IF;

  INSERT INTO public.creator_wallets (creator_id) VALUES (v_profile_id)
  ON CONFLICT (creator_id) DO NOTHING;

  SELECT * INTO v_wallet
    FROM public.creator_wallets
   WHERE creator_id = v_profile_id
     FOR UPDATE;

  IF v_wallet.available_balance < p_amount THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.withdrawals
     WHERE creator_profile_id = v_profile_id
       AND status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'withdrawal_inflight';
  END IF;

  v_before := public._creator_wallet_snapshot(v_profile_id);

  INSERT INTO public.withdrawals (
    creator_id, creator_profile_id, amount, status,
    bank_account_name, bank_account_number, bank_ifsc, upi_id,
    payout_account_id,
    locked_amount, available_before, idempotency_key, correlation_id
  ) VALUES (
    p_creator_user_id, v_profile_id, p_amount, 'pending',
    p_bank_account_name, p_bank_account_number, p_bank_ifsc, p_upi_id,
    p_payout_account_id,
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
    'payout_account_id', p_payout_account_id,
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

-- ── get_creator_withdrawal_status_snapshot ────────────────────
CREATE OR REPLACE FUNCTION public.get_creator_withdrawal_status_snapshot(
  p_creator_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min              NUMERIC := 100;
  v_max_single       NUMERIC := 25000;
  v_max_daily        NUMERIC := 50000;
  v_max_monthly      NUMERIC := 200000;
  v_pre_kyc_monthly  NUMERIC := 10000;
  v_kyc_threshold    NUMERIC := 10000;
  v_kyc_status       TEXT := 'not_started';
  v_daily_sum        NUMERIC := 0;
  v_monthly_sum      NUMERIC := 0;
  v_wallet           JSONB;
  v_inflight         JSONB;
  v_payout_masked    TEXT;
  v_ist_day          DATE;
  v_ist_month_start  TIMESTAMPTZ;
  v_has_account      BOOLEAN := false;
BEGIN
  IF p_creator_profile_id IS NULL THEN
    RAISE EXCEPTION 'creator_profile_required';
  END IF;

  SELECT min_withdrawal, max_single_withdrawal_inr, max_daily_withdrawal_inr,
         max_monthly_withdrawal_inr, pre_kyc_monthly_cap_inr, kyc_threshold_inr
    INTO v_min, v_max_single, v_max_daily, v_max_monthly, v_pre_kyc_monthly, v_kyc_threshold
    FROM public.app_settings
   LIMIT 1;

  IF v_min IS NULL THEN v_min := 100; END IF;
  IF v_max_single IS NULL THEN v_max_single := 25000; END IF;
  IF v_max_daily IS NULL THEN v_max_daily := 50000; END IF;
  IF v_max_monthly IS NULL THEN v_max_monthly := 200000; END IF;
  IF v_pre_kyc_monthly IS NULL THEN v_pre_kyc_monthly := 10000; END IF;
  IF v_kyc_threshold IS NULL THEN v_kyc_threshold := 10000; END IF;

  v_ist_day := (NOW() AT TIME ZONE 'Asia/Kolkata')::date;
  v_ist_month_start := date_trunc('month', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';

  SELECT COALESCE(SUM(amount), 0) INTO v_daily_sum
    FROM public.withdrawals
   WHERE creator_profile_id = p_creator_profile_id
     AND status IN ('pending', 'approved', 'paid')
     AND (requested_at AT TIME ZONE 'Asia/Kolkata')::date = v_ist_day;

  SELECT COALESCE(SUM(amount), 0) INTO v_monthly_sum
    FROM public.withdrawals
   WHERE creator_profile_id = p_creator_profile_id
     AND status IN ('pending', 'approved', 'paid')
     AND requested_at >= v_ist_month_start;

  SELECT status INTO v_kyc_status
    FROM public.kyc_profiles
   WHERE creator_profile_id = p_creator_profile_id;
  IF v_kyc_status IS NULL THEN
    v_kyc_status := 'not_started';
  END IF;

  v_wallet := public._creator_wallet_snapshot(p_creator_profile_id);

  SELECT EXISTS (
    SELECT 1 FROM public.payout_accounts
     WHERE creator_profile_id = p_creator_profile_id
       AND is_default = true
       AND disabled_at IS NULL
  ) INTO v_has_account;

  SELECT jsonb_build_object(
    'withdrawalId', w.id,
    'amount', w.amount,
    'status', w.status,
    'requestedAt', w.requested_at,
    'approvedAt', w.approved_at,
    'canCancel', w.status = 'pending',
    'maskedDestination', COALESCE(w.upi_id, w.bank_account_number)
  ) INTO v_inflight
    FROM public.withdrawals w
   WHERE w.creator_profile_id = p_creator_profile_id
     AND w.status IN ('pending', 'approved')
   ORDER BY w.requested_at DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'inflight', v_inflight,
    'eligibility', jsonb_build_object(
      'canRequestWithdrawal', true,
      'minAmountInr', v_min,
      'maxSingleAmountInr', v_max_single,
      'dailyRemainingInr', GREATEST(0, v_max_daily - v_daily_sum),
      'monthlyRemainingInr', GREATEST(0, v_max_monthly - v_monthly_sum),
      'kycStatus', v_kyc_status,
      'kycRequiredAboveInr', v_kyc_threshold,
      'hasPayoutAccount', v_has_account,
      'preKycMonthlyCapInr', v_pre_kyc_monthly
    ),
    'wallet', v_wallet
  );
END;
$$;

-- ── Privileges ────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.request_creator_withdrawal(
  UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.request_creator_withdrawal(
  UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_creator_withdrawal_status_snapshot(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.get_creator_withdrawal_status_snapshot(UUID) FROM PUBLIC, anon, authenticated;

COMMIT;
