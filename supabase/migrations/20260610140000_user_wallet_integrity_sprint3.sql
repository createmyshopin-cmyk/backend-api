-- ============================================================
-- Sprint 3: User Wallet Integrity — adjust_user_coins_v2 + admin_adjust_user_coins
-- Closes HIGH-06 (no GREATEST clamp) · HIGH-12 (atomic admin adjust)
-- ============================================================

BEGIN;

-- ── Ensure wallets table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  coin_balance  INTEGER NOT NULL DEFAULT 0 CHECK (coin_balance >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Sync users.coins FROM wallets (authoritative projection) ─
CREATE OR REPLACE FUNCTION public.sync_user_coins_from_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
     SET coins = NEW.coin_balance,
         updated_at = NOW()
   WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallets_sync_user_coins ON public.wallets;
CREATE TRIGGER trg_wallets_sync_user_coins
  AFTER UPDATE OF coin_balance ON public.wallets
  FOR EACH ROW
  WHEN (OLD.coin_balance IS DISTINCT FROM NEW.coin_balance)
  EXECUTE FUNCTION public.sync_user_coins_from_wallet();

-- ── coin_transactions extensions ────────────────────────────
ALTER TABLE public.coin_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS reference_type TEXT,
  ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES public.admin_users(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_coin_tx_user_idempotency
  ON public.coin_transactions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_coin_tx_source_ref_type
  ON public.coin_transactions (reference_type, reference_id, type)
  WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL;

-- ── user_adjustments evidence ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_adjustments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  amount_coins        INTEGER NOT NULL CHECK (amount_coins > 0),
  direction           TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
  reason_code         TEXT NOT NULL CHECK (reason_code IN (
                        'reconciliation', 'goodwill', 'fraud', 'correction'
                      )),
  reason_text         TEXT,
  admin_user_id       UUID NOT NULL REFERENCES public.admin_users(id),
  coin_transaction_id UUID NOT NULL REFERENCES public.coin_transactions(id) ON DELETE RESTRICT,
  idempotency_key     TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_adjustments_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_user_adjustments_user_id
  ON public.user_adjustments (user_id, created_at DESC);

ALTER TABLE public.user_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_adjustments_deny_clients ON public.user_adjustments;
CREATE POLICY user_adjustments_deny_clients ON public.user_adjustments
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ── Result type ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_wallet_result') THEN
    CREATE TYPE public.user_wallet_result AS (
      coin_transaction_id UUID,
      user_id             UUID,
      balance_before      INTEGER,
      balance_after       INTEGER,
      amount              INTEGER,
      idempotent_replay   BOOLEAN
    );
  END IF;
END $$;

-- ── Core RPC: adjust_user_coins_v2 ──────────────────────────
CREATE OR REPLACE FUNCTION public.adjust_user_coins_v2(
  p_user_id          UUID,
  p_delta            INTEGER,
  p_source_type      TEXT,
  p_source_id        UUID,
  p_idempotency_key  TEXT,
  p_allow_partial    BOOLEAN DEFAULT FALSE,
  p_admin_id         UUID DEFAULT NULL
)
RETURNS public.user_wallet_result
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet            public.wallets%ROWTYPE;
  v_balance_before    INTEGER;
  v_balance_after     INTEGER;
  v_delta             INTEGER;
  v_tx_type           TEXT;
  v_tx_id             UUID;
  v_existing          public.coin_transactions%ROWTYPE;
  v_result            public.user_wallet_result;
BEGIN
  v_delta := p_delta;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id_required';
  END IF;

  IF v_delta = 0 THEN
    RAISE EXCEPTION 'delta_must_be_non_zero';
  END IF;

  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  IF p_source_type NOT IN ('payment', 'call', 'gift', 'admin_adjust', 'refund') THEN
    RAISE EXCEPTION 'invalid_source_type: %', p_source_type;
  END IF;

  -- Idempotent replay
  SELECT * INTO v_existing
    FROM public.coin_transactions
   WHERE user_id = p_user_id
     AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    v_result.coin_transaction_id := v_existing.id;
    v_result.user_id := p_user_id;
    v_result.balance_before := v_existing.balance_before;
    v_result.balance_after := v_existing.balance_after;
    v_result.amount := v_existing.amount;
    v_result.idempotent_replay := TRUE;
    RETURN v_result;
  END IF;

  -- Ensure wallet row exists, then lock
  INSERT INTO public.wallets (user_id, coin_balance)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet
    FROM public.wallets
   WHERE user_id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_not_found for user %', p_user_id;
  END IF;

  v_balance_before := v_wallet.coin_balance;
  v_balance_after := v_balance_before + v_delta;

  IF v_balance_after < 0 THEN
    IF p_allow_partial THEN
      v_balance_after := 0;
      v_delta := -v_balance_before;
    ELSE
      RAISE EXCEPTION 'insufficient_balance'
        USING ERRCODE = 'P0001',
              DETAIL = format(
                'user=%s balance=%s delta=%s',
                p_user_id, v_balance_before, v_delta
              );
    END IF;
  END IF;

  -- Invariant: amount must equal balance delta
  IF v_delta <> (v_balance_after - v_balance_before) THEN
    RAISE EXCEPTION 'amount_delta_invariant_violation';
  END IF;

  UPDATE public.wallets
     SET coin_balance = v_balance_after,
         updated_at = NOW()
   WHERE user_id = p_user_id;

  v_tx_type := CASE
    WHEN p_source_type = 'admin_adjust' AND v_delta >= 0 THEN 'admin_adjustment_add'
    WHEN p_source_type = 'admin_adjust' AND v_delta < 0 THEN 'admin_adjustment_deduct'
    WHEN p_source_type = 'payment' THEN 'recharge'
    WHEN p_source_type = 'call' THEN 'call_deduction'
    WHEN p_source_type = 'gift' THEN 'gift_deduction'
    WHEN p_source_type = 'refund' THEN 'refund'
    ELSE 'admin_adjustment_add'
  END;

  INSERT INTO public.coin_transactions (
    user_id, type, amount, balance_before, balance_after,
    reference_id, reference_type, idempotency_key, admin_id, description
  ) VALUES (
    p_user_id,
    v_tx_type,
    v_delta,
    v_balance_before,
    v_balance_after,
    p_source_id,
    p_source_type,
    p_idempotency_key,
    p_admin_id,
    p_source_type || ' via adjust_user_coins_v2'
  )
  RETURNING id INTO v_tx_id;

  v_result.coin_transaction_id := v_tx_id;
  v_result.user_id := p_user_id;
  v_result.balance_before := v_balance_before;
  v_result.balance_after := v_balance_after;
  v_result.amount := v_delta;
  v_result.idempotent_replay := FALSE;
  RETURN v_result;

EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_existing
      FROM public.coin_transactions
     WHERE user_id = p_user_id
       AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      v_result.coin_transaction_id := v_existing.id;
      v_result.user_id := p_user_id;
      v_result.balance_before := v_existing.balance_before;
      v_result.balance_after := v_existing.balance_after;
      v_result.amount := v_existing.amount;
      v_result.idempotent_replay := TRUE;
      RETURN v_result;
    END IF;
    RAISE;
END;
$$;

-- ── Admin adjust RPC (atomic evidence + audit) ──────────────
CREATE OR REPLACE FUNCTION public.admin_adjust_user_coins(
  p_user_id          UUID,
  p_amount           INTEGER,
  p_reason_code      TEXT,
  p_reason_text      TEXT,
  p_admin_id         UUID,
  p_admin_email      TEXT,
  p_admin_role       TEXT,
  p_idempotency_key  TEXT,
  p_http_method      TEXT DEFAULT 'POST',
  p_http_path        TEXT DEFAULT '/api/wallets/adjust',
  p_ip_address       INET DEFAULT NULL,
  p_user_agent       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_adjustment_id     UUID := gen_random_uuid();
  v_direction         TEXT;
  v_magnitude         INTEGER;
  v_wallet_result     public.user_wallet_result;
  v_existing_adj      public.user_adjustments%ROWTYPE;
  v_audit_id          UUID;
BEGIN
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'amount_must_be_non_zero';
  END IF;

  IF p_reason_code NOT IN ('reconciliation', 'goodwill', 'fraud', 'correction') THEN
    RAISE EXCEPTION 'invalid_reason_code: %', p_reason_code;
  END IF;

  IF p_reason_text IS NULL OR length(trim(p_reason_text)) = 0 THEN
    RAISE EXCEPTION 'reason_text_required';
  END IF;

  -- Idempotent replay at adjustment level
  SELECT * INTO v_existing_adj
    FROM public.user_adjustments
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
  RETURN jsonb_build_object(
      'adjustment_id', v_existing_adj.id,
      'coin_transaction_id', v_existing_adj.coin_transaction_id,
      'user_id', v_existing_adj.user_id,
      'amount', CASE WHEN v_existing_adj.direction = 'credit'
                THEN v_existing_adj.amount_coins
                ELSE -v_existing_adj.amount_coins END,
      'direction', v_existing_adj.direction,
      'idempotent_replay', TRUE
    );
  END IF;

  v_magnitude := abs(p_amount);
  v_direction := CASE WHEN p_amount > 0 THEN 'credit' ELSE 'debit' END;

  v_wallet_result := public.adjust_user_coins_v2(
    p_user_id          := p_user_id,
    p_delta            := p_amount,
    p_source_type      := 'admin_adjust',
    p_source_id        := v_adjustment_id,
    p_idempotency_key  := p_idempotency_key,
    p_allow_partial    := FALSE,
    p_admin_id         := p_admin_id
  );

  INSERT INTO public.user_adjustments (
    id, user_id, amount_coins, direction, reason_code, reason_text,
    admin_user_id, coin_transaction_id, idempotency_key
  ) VALUES (
    v_adjustment_id,
    p_user_id,
    v_magnitude,
    v_direction,
    p_reason_code,
    p_reason_text,
    p_admin_id,
    v_wallet_result.coin_transaction_id,
    p_idempotency_key
  );

  INSERT INTO public.admin_audit_logs (
    actor_type, actor_id, actor_email, actor_role,
    action, category, outcome,
    resource_type, resource_id,
    http_method, http_path, ip_address, user_agent,
    idempotency_key, details, retention_class
  ) VALUES (
    'admin',
    p_admin_id,
    p_admin_email,
    p_admin_role,
    'wallet_adjusted',
    'wallet',
    'success',
    'wallet',
    p_user_id::TEXT,
    p_http_method,
    p_http_path,
    p_ip_address,
    left(coalesce(p_user_agent, ''), 512),
    p_idempotency_key,
    jsonb_build_object(
      'target_user_id', p_user_id,
      'wallet_type', 'user',
      'direction', v_direction,
      'amount_coins', v_magnitude,
      'reason_code', p_reason_code,
      'reason_text', p_reason_text,
      'before', jsonb_build_object('coin_balance', v_wallet_result.balance_before),
      'after', jsonb_build_object('coin_balance', v_wallet_result.balance_after),
      'evidence_table', 'coin_transactions',
      'evidence_id', v_wallet_result.coin_transaction_id,
      'adjustment_table', 'user_adjustments',
      'adjustment_id', v_adjustment_id,
      'idempotent_replay', v_wallet_result.idempotent_replay
    ),
    'financial'
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'adjustment_id', v_adjustment_id,
    'coin_transaction_id', v_wallet_result.coin_transaction_id,
    'audit_log_id', v_audit_id,
    'user_id', p_user_id,
    'balance_before', v_wallet_result.balance_before,
    'balance_after', v_wallet_result.balance_after,
    'amount', p_amount,
    'direction', v_direction,
    'idempotent_replay', v_wallet_result.idempotent_replay
  );
END;
$$;

-- ── Permissions: service_role only ──────────────────────────
REVOKE ALL ON FUNCTION public.adjust_user_coins_v2(
  UUID, INTEGER, TEXT, UUID, TEXT, BOOLEAN, UUID
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_adjust_user_coins(
  UUID, INTEGER, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INET, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.adjust_user_coins_v2(
  UUID, INTEGER, TEXT, UUID, TEXT, BOOLEAN, UUID
) TO service_role;

GRANT EXECUTE ON FUNCTION public.admin_adjust_user_coins(
  UUID, INTEGER, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INET, TEXT
) TO service_role;

-- Deprecate v1 clamp RPC
REVOKE EXECUTE ON FUNCTION public.adjust_user_coins(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.adjust_user_coins_v2 IS
  'Authoritative user coin mutation. FOR UPDATE lock on wallets. Raises insufficient_balance (P0001). No GREATEST clamp.';

COMMENT ON FUNCTION public.admin_adjust_user_coins IS
  'Atomic admin wallet adjust: user_adjustments + coin_transactions + admin_audit_logs in one transaction.';

COMMIT;
