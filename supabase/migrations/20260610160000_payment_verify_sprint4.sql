-- ============================================================
-- Sprint 4: Payment Verify & Refund Atomic RPCs
-- verify_razorpay_payment_atomic · refund_payment_atomic
-- ============================================================

BEGIN;

-- ── payments schema extensions ──────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS amount_paise INTEGER,
  ADD COLUMN IF NOT EXISTS coins_to_credit INTEGER,
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS gateway_fetched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gateway_status TEXT,
  ADD COLUMN IF NOT EXISTS verify_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_by UUID REFERENCES public.admin_users(id);

UPDATE public.payments
   SET amount_paise = COALESCE(amount_paise, ROUND(amount * 100)::INTEGER),
       coins_to_credit = COALESCE(coins_to_credit, coins_added),
       currency = COALESCE(currency, 'INR')
 WHERE amount_paise IS NULL OR coins_to_credit IS NULL;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_status_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'success', 'failed', 'refunded', 'refund_pending'));

-- ── gateway_webhook_events (dedupe retries) ─────────────────
CREATE TABLE IF NOT EXISTS public.gateway_webhook_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  gateway       TEXT NOT NULL DEFAULT 'razorpay',
  payload_hash  TEXT NOT NULL,
  outcome       TEXT NOT NULL DEFAULT 'processed'
                CHECK (outcome IN ('processed', 'ignored', 'error', 'duplicate')),
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_gateway_webhook_events_event_id UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_gateway_webhook_events_created
  ON public.gateway_webhook_events (created_at DESC);

ALTER TABLE public.gateway_webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gateway_webhook_events_deny_clients ON public.gateway_webhook_events;
CREATE POLICY gateway_webhook_events_deny_clients ON public.gateway_webhook_events
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ── refund_events evidence ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.refund_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id          UUID NOT NULL UNIQUE REFERENCES public.payments(id) ON DELETE RESTRICT,
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  admin_id            UUID REFERENCES public.admin_users(id),
  reason              TEXT NOT NULL,
  coins_clawed_back   INTEGER NOT NULL CHECK (coins_clawed_back > 0),
  amount_paise        INTEGER,
  coin_transaction_id UUID NOT NULL REFERENCES public.coin_transactions(id) ON DELETE RESTRICT,
  razorpay_refund_id  TEXT,
  idempotency_key     TEXT NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refund_events_user_id
  ON public.refund_events (user_id, created_at DESC);

ALTER TABLE public.refund_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS refund_events_deny_clients ON public.refund_events;
CREATE POLICY refund_events_deny_clients ON public.refund_events
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ── verify idempotency cache (72h useful life — app enforced) ─
CREATE TABLE IF NOT EXISTS public.payment_verify_idempotency_records (
  idempotency_key   TEXT PRIMARY KEY,
  payment_id        UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL,
  response_json     JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_verify_idempotency_created
  ON public.payment_verify_idempotency_records (created_at DESC);

-- Drop legacy 2-arg verify if present
DROP FUNCTION IF EXISTS public.verify_razorpay_payment_atomic(VARCHAR, VARCHAR);

-- ── verify_razorpay_payment_atomic ────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_razorpay_payment_atomic(
  p_user_id             UUID,
  p_gateway_order_id    TEXT,
  p_gateway_payment_id  TEXT,
  p_idempotency_key     TEXT,
  p_amount_paise        INTEGER,
  p_gateway_status      TEXT DEFAULT 'captured'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment           public.payments%ROWTYPE;
  v_conflict          UUID;
  v_wallet_result     public.user_wallet_result;
  v_response          JSONB;
  v_updated           INTEGER;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  -- Idempotency cache hit
  SELECT response_json INTO v_response
    FROM public.payment_verify_idempotency_records
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN v_response || jsonb_build_object('idempotent_replay', TRUE);
  END IF;

  SELECT * INTO v_payment
    FROM public.payments
   WHERE gateway_order_id = p_gateway_order_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found';
  END IF;

  IF v_payment.user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'payment_user_mismatch';
  END IF;

  -- Already verified — same gateway payment id
  IF v_payment.status = 'success'
     AND v_payment.gateway_payment_id = p_gateway_payment_id THEN
    v_response := jsonb_build_object(
      'payment_id', v_payment.id,
      'user_id', v_payment.user_id,
      'coins_added', v_payment.coins_to_credit,
      'gateway_payment_id', p_gateway_payment_id,
      'idempotent_replay', TRUE
    );
    INSERT INTO public.payment_verify_idempotency_records (idempotency_key, payment_id, user_id, response_json)
    VALUES (p_idempotency_key, v_payment.id, v_payment.user_id, v_response)
    ON CONFLICT (idempotency_key) DO NOTHING;
    RETURN v_response;
  END IF;

  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'invalid_payment_state: %', v_payment.status;
  END IF;

  -- Gateway payment id uniqueness across users
  SELECT id INTO v_conflict
    FROM public.payments
   WHERE gateway_payment_id = p_gateway_payment_id
     AND id <> v_payment.id;

  IF FOUND THEN
    RAISE EXCEPTION 'gateway_payment_id_conflict';
  END IF;

  IF COALESCE(v_payment.amount_paise, ROUND(v_payment.amount * 100)::INTEGER) <> p_amount_paise THEN
    RAISE EXCEPTION 'amount_paise_mismatch';
  END IF;

  UPDATE public.payments
     SET status = 'success',
         gateway_payment_id = p_gateway_payment_id,
         gateway_status = p_gateway_status,
         gateway_fetched_at = NOW(),
         verify_idempotency_key = p_idempotency_key,
         version = version + 1
   WHERE id = v_payment.id
     AND status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'payment_verify_cas_conflict';
  END IF;

  v_wallet_result := public.adjust_user_coins_v2(
    p_user_id          := v_payment.user_id,
    p_delta            := v_payment.coins_to_credit,
    p_source_type      := 'payment',
    p_source_id        := v_payment.id,
    p_idempotency_key  := 'payment-verify:' || p_idempotency_key,
    p_allow_partial    := FALSE,
    p_admin_id         := NULL
  );

  v_response := jsonb_build_object(
    'payment_id', v_payment.id,
    'user_id', v_payment.user_id,
    'coins_added', v_payment.coins_to_credit,
    'balance_before', v_wallet_result.balance_before,
    'balance_after', v_wallet_result.balance_after,
    'coin_transaction_id', v_wallet_result.coin_transaction_id,
    'gateway_payment_id', p_gateway_payment_id,
    'idempotent_replay', COALESCE(v_wallet_result.idempotent_replay, FALSE)
  );

  INSERT INTO public.payment_verify_idempotency_records (idempotency_key, payment_id, user_id, response_json)
  VALUES (p_idempotency_key, v_payment.id, v_payment.user_id, v_response)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_response;
END;
$$;

-- ── mark_payment_failed (webhook payment.failed) ──────────────
CREATE OR REPLACE FUNCTION public.mark_payment_failed_atomic(
  p_gateway_order_id TEXT,
  p_gateway_payment_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
BEGIN
  SELECT * INTO v_payment
    FROM public.payments
   WHERE gateway_order_id = p_gateway_order_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'ignored', 'reason', 'payment_not_found');
  END IF;

  IF v_payment.status <> 'pending' THEN
    RETURN jsonb_build_object('outcome', 'ignored', 'status', v_payment.status);
  END IF;

  UPDATE public.payments
     SET status = 'failed',
         gateway_payment_id = COALESCE(p_gateway_payment_id, gateway_payment_id),
         gateway_status = 'failed',
         version = version + 1
   WHERE id = v_payment.id;

  RETURN jsonb_build_object('outcome', 'failed', 'payment_id', v_payment.id);
END;
$$;

-- ── refund_payment_atomic ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refund_payment_atomic(
  p_payment_id          UUID,
  p_admin_id          UUID,
  p_admin_email       TEXT,
  p_admin_role        TEXT,
  p_reason            TEXT,
  p_idempotency_key   TEXT,
  p_razorpay_refund_id TEXT DEFAULT NULL,
  p_http_method       TEXT DEFAULT 'POST',
  p_http_path         TEXT DEFAULT NULL,
  p_ip_address        INET DEFAULT NULL,
  p_user_agent        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment         public.payments%ROWTYPE;
  v_refund_id       UUID := gen_random_uuid();
  v_existing        public.refund_events%ROWTYPE;
  v_wallet_result   public.user_wallet_result;
  v_audit_id        UUID;
  v_updated         INTEGER;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  SELECT * INTO v_existing
    FROM public.refund_events
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'refund_event_id', v_existing.id,
      'payment_id', v_existing.payment_id,
      'coin_transaction_id', v_existing.coin_transaction_id,
      'idempotent_replay', TRUE
    );
  END IF;

  SELECT * INTO v_payment
    FROM public.payments
   WHERE id = p_payment_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found';
  END IF;

  IF v_payment.status = 'refunded' THEN
    SELECT * INTO v_existing FROM public.refund_events WHERE payment_id = p_payment_id;
    RETURN jsonb_build_object(
      'refund_event_id', COALESCE(v_existing.id, v_refund_id),
      'payment_id', p_payment_id,
      'idempotent_replay', TRUE
    );
  END IF;

  IF v_payment.status <> 'success' THEN
    RAISE EXCEPTION 'invalid_payment_state: %', v_payment.status;
  END IF;

  UPDATE public.payments
     SET status = 'refunded',
         refunded_at = NOW(),
         refunded_by = p_admin_id,
         version = version + 1
   WHERE id = p_payment_id
     AND status = 'success';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'refund_cas_conflict';
  END IF;

  v_wallet_result := public.adjust_user_coins_v2(
    p_user_id          := v_payment.user_id,
    p_delta            := -v_payment.coins_to_credit,
    p_source_type      := 'refund',
    p_source_id        := v_refund_id,
    p_idempotency_key  := 'payment-refund:' || p_idempotency_key,
    p_allow_partial    := FALSE,
    p_admin_id         := p_admin_id
  );

  INSERT INTO public.refund_events (
    id, payment_id, user_id, admin_id, reason,
    coins_clawed_back, amount_paise, coin_transaction_id,
    razorpay_refund_id, idempotency_key
  ) VALUES (
    v_refund_id,
    p_payment_id,
    v_payment.user_id,
    p_admin_id,
    p_reason,
    v_payment.coins_to_credit,
    v_payment.amount_paise,
    v_wallet_result.coin_transaction_id,
    p_razorpay_refund_id,
    p_idempotency_key
  );

  INSERT INTO public.admin_audit_logs (
    actor_type, actor_id, actor_email, actor_role,
    action, category, outcome,
    resource_type, resource_id,
    http_method, http_path, ip_address, user_agent,
    idempotency_key, details, retention_class
  ) VALUES (
    CASE WHEN p_admin_id IS NULL THEN 'webhook' ELSE 'admin' END,
    p_admin_id,
    p_admin_email,
    p_admin_role,
    'payment_refund',
    'payment',
    'success',
    'payment',
    p_payment_id::TEXT,
    p_http_method,
    p_http_path,
    p_ip_address,
    left(coalesce(p_user_agent, ''), 512),
    p_idempotency_key,
    jsonb_build_object(
      'payment_id', p_payment_id,
      'user_id', v_payment.user_id,
      'amount_inr', v_payment.amount,
      'coins_clawed_back', v_payment.coins_to_credit,
      'reason', p_reason,
      'before', jsonb_build_object('payment_status', 'success', 'user_coins', v_wallet_result.balance_before),
      'after', jsonb_build_object('payment_status', 'refunded', 'user_coins', v_wallet_result.balance_after),
      'evidence_table', 'coin_transactions',
      'evidence_id', v_wallet_result.coin_transaction_id,
      'refund_event_id', v_refund_id,
      'razorpay_refund_id', p_razorpay_refund_id
    ),
    'financial'
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'refund_event_id', v_refund_id,
    'payment_id', p_payment_id,
    'coin_transaction_id', v_wallet_result.coin_transaction_id,
    'audit_log_id', v_audit_id,
    'balance_before', v_wallet_result.balance_before,
    'balance_after', v_wallet_result.balance_after,
    'coins_clawed_back', v_payment.coins_to_credit,
    'idempotent_replay', COALESCE(v_wallet_result.idempotent_replay, FALSE)
  );
END;
$$;

-- ── Permissions ───────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.verify_razorpay_payment_atomic(
  UUID, TEXT, TEXT, TEXT, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.mark_payment_failed_atomic(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.refund_payment_atomic(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INET, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.verify_razorpay_payment_atomic(
  UUID, TEXT, TEXT, TEXT, INTEGER, TEXT
) TO service_role;

GRANT EXECUTE ON FUNCTION public.mark_payment_failed_atomic(TEXT, TEXT)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.refund_payment_atomic(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INET, TEXT
) TO service_role;

COMMENT ON FUNCTION public.verify_razorpay_payment_atomic IS
  'Atomic payment verify: pending→success + adjust_user_coins_v2 recharge ledger in one transaction.';

COMMENT ON FUNCTION public.refund_payment_atomic IS
  'Atomic refund: success→refunded + coin debit + refund_events + admin_audit_logs.';

COMMIT;
