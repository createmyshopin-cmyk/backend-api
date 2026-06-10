-- ============================================================
-- Sprint 3.2B — Payout Account Foundation
-- payout_accounts · kyc_profiles · payout_provider_events
-- Field encryption (pgcrypto) · masking · RLS deny-default
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Encryption key (set per session: SET app.payout_field_encryption_key = '...') ──
CREATE OR REPLACE FUNCTION public.payout_encryption_key()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
BEGIN
  v_key := current_setting('app.payout_field_encryption_key', true);
  IF v_key IS NULL OR length(trim(v_key)) < 32 THEN
    RAISE EXCEPTION 'payout_encryption_key_not_configured';
  END IF;
  RETURN v_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.payout_encrypt_sensitive(p_plaintext TEXT)
RETURNS BYTEA
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_plaintext IS NULL OR length(trim(p_plaintext)) = 0 THEN
    RETURN NULL;
  END IF;
  RETURN pgp_sym_encrypt(trim(p_plaintext), public.payout_encryption_key());
END;
$$;

CREATE OR REPLACE FUNCTION public.payout_decrypt_sensitive(p_ciphertext BYTEA)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_ciphertext IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN pgp_sym_decrypt(p_ciphertext, public.payout_encryption_key());
END;
$$;

-- ── Masking (display only — matches NestJS pagination.util) ───
CREATE OR REPLACE FUNCTION public.payout_mask_upi(p_upi TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_at INT;
  v_local TEXT;
  v_domain TEXT;
  v_visible TEXT;
BEGIN
  IF p_upi IS NULL OR length(trim(p_upi)) = 0 THEN
    RETURN NULL;
  END IF;
  v_at := position('@' IN trim(p_upi));
  IF v_at <= 1 THEN
    RETURN '***';
  END IF;
  v_local := substring(trim(p_upi) FROM 1 FOR v_at - 1);
  v_domain := substring(trim(p_upi) FROM v_at);
  v_visible := substring(v_local FROM 1 FOR LEAST(3, length(v_local)));
  RETURN v_visible || '***' || v_domain;
END;
$$;

CREATE OR REPLACE FUNCTION public.payout_mask_bank_account(p_account TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_digits TEXT;
BEGIN
  IF p_account IS NULL OR length(trim(p_account)) = 0 THEN
    RETURN NULL;
  END IF;
  v_digits := regexp_replace(trim(p_account), '\D', '', 'g');
  IF length(v_digits) < 4 THEN
    RETURN '****';
  END IF;
  RETURN '****' || right(v_digits, 4);
END;
$$;

CREATE OR REPLACE FUNCTION public.payout_mask_pan(p_pan TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_upper TEXT;
BEGIN
  IF p_pan IS NULL OR length(trim(p_pan)) < 4 THEN
    RETURN NULL;
  END IF;
  v_upper := upper(regexp_replace(trim(p_pan), '\s', '', 'g'));
  RETURN substring(v_upper FROM 1 FOR 2) || '****' || right(v_upper, 4);
END;
$$;

CREATE OR REPLACE FUNCTION public.payout_mask_aadhaar(p_aadhaar TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_digits TEXT;
BEGIN
  IF p_aadhaar IS NULL THEN
    RETURN NULL;
  END IF;
  v_digits := regexp_replace(trim(p_aadhaar), '\D', '', 'g');
  IF length(v_digits) < 4 THEN
    RETURN '****';
  END IF;
  RETURN 'XXXX-XXXX-' || right(v_digits, 4);
END;
$$;

CREATE OR REPLACE FUNCTION public.payout_mask_gstin(p_gstin TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_upper TEXT;
BEGIN
  IF p_gstin IS NULL OR length(trim(p_gstin)) < 6 THEN
    RETURN NULL;
  END IF;
  v_upper := upper(regexp_replace(trim(p_gstin), '\s', '', 'g'));
  RETURN substring(v_upper FROM 1 FOR 4) || '****' || right(v_upper, 4);
END;
$$;

-- ── payout_accounts ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payout_accounts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_profile_id      UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  type                    TEXT NOT NULL CHECK (type IN ('upi', 'bank')),
  account_name            TEXT NOT NULL,
  upi_id_encrypted        BYTEA,
  upi_id_masked           TEXT,
  bank_name               TEXT,
  account_number_encrypted BYTEA,
  account_number_masked   TEXT,
  ifsc_code               TEXT,
  is_default              BOOLEAN NOT NULL DEFAULT false,
  status                  TEXT NOT NULL DEFAULT 'pending_verification'
                          CHECK (status IN (
                            'pending_verification', 'verified', 'rejected', 'disabled'
                          )),
  verified_at             TIMESTAMPTZ,
  disabled_at             TIMESTAMPTZ,
  razorpayx_fund_account_id TEXT,
  cashfree_bene_id        TEXT,
  stripe_external_account_id TEXT,
  wise_recipient_id       TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payout_accounts_upi_shape CHECK (
    type <> 'upi'
    OR (
      upi_id_encrypted IS NOT NULL
      AND upi_id_masked IS NOT NULL
      AND account_number_encrypted IS NULL
      AND account_number_masked IS NULL
      AND ifsc_code IS NULL
    )
  ),
  CONSTRAINT payout_accounts_bank_shape CHECK (
    type <> 'bank'
    OR (
      account_number_encrypted IS NOT NULL
      AND account_number_masked IS NOT NULL
      AND ifsc_code IS NOT NULL
      AND length(trim(ifsc_code)) >= 4
      AND upi_id_encrypted IS NULL
      AND upi_id_masked IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_payout_accounts_creator_profile
  ON public.payout_accounts (creator_profile_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_account_one_default
  ON public.payout_accounts (creator_profile_id)
  WHERE is_default = true AND disabled_at IS NULL;

COMMENT ON TABLE public.payout_accounts IS
  'Creator payout destinations. Sensitive values in *_encrypted BYTEA only; never store plaintext UPI/account.';

COMMENT ON COLUMN public.payout_accounts.upi_id_encrypted IS
  'Logical field upi_id — encrypted via payout_encrypt_sensitive().';

COMMENT ON COLUMN public.payout_accounts.account_number_encrypted IS
  'Logical field account_number — encrypted via payout_encrypt_sensitive().';

-- ── kyc_profiles ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kyc_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_profile_id  UUID NOT NULL UNIQUE REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'not_started'
                      CHECK (status IN (
                        'not_started', 'pending', 'verified', 'rejected', 'expired'
                      )),
  legal_name          TEXT,
  pan_encrypted       BYTEA,
  pan_masked          TEXT,
  aadhaar_encrypted   BYTEA,
  aadhaar_masked      TEXT,
  gstin_encrypted     BYTEA,
  gstin_masked        TEXT,
  document_type       TEXT CHECK (
    document_type IS NULL
    OR document_type IN ('pan', 'aadhaar', 'gst', 'combined')
  ),
  provider            TEXT,
  provider_reference  TEXT,
  verified_at         TIMESTAMPTZ,
  rejected_reason     TEXT,
  user_message        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyc_profiles_status
  ON public.kyc_profiles (status, updated_at DESC);

COMMENT ON TABLE public.kyc_profiles IS
  'KYC readiness per creator. PAN/Aadhaar/GST stored encrypted; masked columns for admin display.';

-- ── payout_provider_events (webhook evidence) ─────────────────
CREATE TABLE IF NOT EXISTS public.payout_provider_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            TEXT NOT NULL CHECK (provider IN (
                        'razorpayx', 'cashfree', 'stripe', 'wise', 'manual'
                      )),
  event_type          TEXT NOT NULL,
  provider_event_id   TEXT NOT NULL,
  withdrawal_id       UUID REFERENCES public.withdrawals(id) ON DELETE SET NULL,
  payout_account_id   UUID REFERENCES public.payout_accounts(id) ON DELETE SET NULL,
  payload_hash        TEXT NOT NULL,
  payload_json        JSONB NOT NULL DEFAULT '{}'::JSONB,
  processing_status   TEXT NOT NULL DEFAULT 'pending'
                      CHECK (processing_status IN (
                        'pending', 'processed', 'ignored', 'failed'
                      )),
  processed_at        TIMESTAMPTZ,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payout_provider_events_provider_event
    UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_payout_provider_events_withdrawal
  ON public.payout_provider_events (withdrawal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payout_provider_events_processing
  ON public.payout_provider_events (processing_status, created_at ASC);

COMMENT ON TABLE public.payout_provider_events IS
  'Immutable webhook ingestion log for RazorpayX, Cashfree, Stripe Connect, Wise.';

-- Append-only guard for provider events (no UPDATE/DELETE by apps)
CREATE OR REPLACE FUNCTION public.deny_payout_provider_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'payout_provider_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_payout_provider_events_no_mutate ON public.payout_provider_events;
CREATE TRIGGER trg_payout_provider_events_no_mutate
  BEFORE UPDATE OR DELETE ON public.payout_provider_events
  FOR EACH ROW EXECUTE FUNCTION public.deny_payout_provider_event_mutation();

-- ── updated_at triggers ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_payout_accounts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payout_accounts_updated_at ON public.payout_accounts;
CREATE TRIGGER trg_payout_accounts_updated_at
  BEFORE UPDATE ON public.payout_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_payout_accounts_updated_at();

CREATE OR REPLACE FUNCTION public.touch_kyc_profiles_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kyc_profiles_updated_at ON public.kyc_profiles;
CREATE TRIGGER trg_kyc_profiles_updated_at
  BEFORE UPDATE ON public.kyc_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_kyc_profiles_updated_at();

-- ── Single default account enforcement ────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_single_default_payout_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_default IS TRUE AND NEW.disabled_at IS NULL THEN
    UPDATE public.payout_accounts
       SET is_default = false,
           updated_at = NOW()
     WHERE creator_profile_id = NEW.creator_profile_id
       AND id <> NEW.id
       AND is_default = true
       AND disabled_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payout_accounts_single_default ON public.payout_accounts;
CREATE TRIGGER trg_payout_accounts_single_default
  AFTER INSERT OR UPDATE OF is_default, disabled_at ON public.payout_accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_default_payout_account();

-- ── RLS: deny direct client access ────────────────────────────
ALTER TABLE public.payout_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payout_accounts_deny_clients ON public.payout_accounts;
CREATE POLICY payout_accounts_deny_clients ON public.payout_accounts
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

ALTER TABLE public.kyc_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kyc_profiles_deny_clients ON public.kyc_profiles;
CREATE POLICY kyc_profiles_deny_clients ON public.kyc_profiles
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

ALTER TABLE public.payout_provider_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payout_provider_events_deny_clients ON public.payout_provider_events;
CREATE POLICY payout_provider_events_deny_clients ON public.payout_provider_events
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ── Service RPC: upsert payout account (infrastructure) ───────
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
    'createdAt', v_row.created_at
  );
END;
$$;

-- ── Service RPC: get default payout account (masked) ──────────
CREATE OR REPLACE FUNCTION public.get_creator_default_payout_account(
  p_creator_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.payout_accounts%ROWTYPE;
BEGIN
  IF p_creator_profile_id IS NULL THEN
    RAISE EXCEPTION 'creator_profile_required';
  END IF;

  SELECT * INTO v_row
    FROM public.payout_accounts
   WHERE creator_profile_id = p_creator_profile_id
     AND is_default = true
     AND disabled_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hasAccount', false, 'account', NULL);
  END IF;

  RETURN jsonb_build_object(
    'hasAccount', true,
    'account', jsonb_build_object(
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
      'verifiedAt', v_row.verified_at,
      'createdAt', v_row.created_at,
      'updatedAt', v_row.updated_at
    )
  );
END;
$$;

-- ── Service RPC: ensure kyc profile row exists ────────────────
CREATE OR REPLACE FUNCTION public.ensure_kyc_profile(
  p_creator_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.kyc_profiles%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.creator_profiles WHERE id = p_creator_profile_id
  ) THEN
    RAISE EXCEPTION 'creator_profile_not_found';
  END IF;

  INSERT INTO public.kyc_profiles (creator_profile_id)
  VALUES (p_creator_profile_id)
  ON CONFLICT (creator_profile_id) DO NOTHING;

  SELECT * INTO v_row
    FROM public.kyc_profiles
   WHERE creator_profile_id = p_creator_profile_id;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'creatorProfileId', v_row.creator_profile_id,
    'status', v_row.status,
    'legalName', v_row.legal_name,
    'panMasked', v_row.pan_masked,
    'aadhaarMasked', v_row.aadhaar_masked,
    'gstinMasked', v_row.gstin_masked,
    'documentType', v_row.document_type,
    'verifiedAt', v_row.verified_at
  );
END;
$$;

-- ── Service RPC: record provider webhook evidence ─────────────
CREATE OR REPLACE FUNCTION public.record_payout_provider_event(
  p_provider          TEXT,
  p_event_type        TEXT,
  p_provider_event_id TEXT,
  p_payload_json      JSONB,
  p_payload_hash      TEXT,
  p_withdrawal_id     UUID DEFAULT NULL,
  p_payout_account_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_existing UUID;
BEGIN
  SELECT id INTO v_existing
    FROM public.payout_provider_events
   WHERE provider = p_provider
     AND provider_event_id = p_provider_event_id;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', v_existing,
      'idempotentReplay', true
    );
  END IF;

  INSERT INTO public.payout_provider_events (
    provider, event_type, provider_event_id,
    withdrawal_id, payout_account_id,
    payload_hash, payload_json
  ) VALUES (
    p_provider, p_event_type, p_provider_event_id,
    p_withdrawal_id, p_payout_account_id,
    p_payload_hash, COALESCE(p_payload_json, '{}'::JSONB)
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'idempotentReplay', false
  );
END;
$$;

-- ── Privileges ────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.payout_decrypt_sensitive(BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payout_encrypt_sensitive(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payout_encryption_key() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.upsert_creator_payout_account(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_creator_default_payout_account(UUID) TO service_role;

GRANT EXECUTE ON FUNCTION public.ensure_kyc_profile(UUID) TO service_role;

GRANT EXECUTE ON FUNCTION public.record_payout_provider_event(
  TEXT, TEXT, TEXT, JSONB, TEXT, UUID, UUID
) TO service_role;

GRANT EXECUTE ON FUNCTION public.payout_mask_upi(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_mask_bank_account(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_mask_pan(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_mask_aadhaar(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_mask_gstin(TEXT) TO service_role;

COMMIT;
