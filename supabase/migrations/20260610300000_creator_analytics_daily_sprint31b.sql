-- ============================================================
-- Sprint 3.1B-1: Creator Analytics Daily (L4 read model)
-- creator_analytics_daily · transactional upsert · rebuild RPC
-- NOT balance authority — L1 creator_ledger_entries remains sole authority
-- ============================================================

BEGIN;

-- ── L4: creator_analytics_daily ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.creator_analytics_daily (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_profile_id      UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  date                    DATE NOT NULL,
  call_coins              NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  gift_coins              NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  total_coins             NUMERIC(12, 2) GENERATED ALWAYS AS (call_coins + gift_coins) STORED,
  call_count              INTEGER NOT NULL DEFAULT 0,
  call_duration_seconds   INTEGER NOT NULL DEFAULT 0,
  gifts_received_count    INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT creator_analytics_daily_nonneg CHECK (
    call_coins >= 0
    AND gift_coins >= 0
    AND call_count >= 0
    AND call_duration_seconds >= 0
    AND gifts_received_count >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_creator_analytics_daily_profile_date
  ON public.creator_analytics_daily (creator_profile_id, date);

CREATE INDEX IF NOT EXISTS idx_creator_analytics_daily_profile_date_desc
  ON public.creator_analytics_daily (creator_profile_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_creator_analytics_daily_date
  ON public.creator_analytics_daily (date DESC);

ALTER TABLE public.creator_analytics_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS creator_analytics_daily_deny_clients ON public.creator_analytics_daily;
CREATE POLICY creator_analytics_daily_deny_clients ON public.creator_analytics_daily
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ── bucket date (Asia/Kolkata per PHASE31 ADR) ──────────────
CREATE OR REPLACE FUNCTION public.creator_analytics_bucket_date(p_at TIMESTAMPTZ)
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (timezone('Asia/Kolkata', COALESCE(p_at, NOW())))::DATE;
$$;

-- ── internal: incremental L4 upsert (same txn as ledger append) ─
CREATE OR REPLACE FUNCTION public._creator_analytics_daily_apply(
  p_creator_profile_id    UUID,
  p_entry_type            TEXT,
  p_amount                NUMERIC,
  p_source_type           TEXT,
  p_source_id             UUID,
  p_event_at              TIMESTAMPTZ DEFAULT NOW()
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_day       DATE;
  v_duration  INTEGER := 0;
BEGIN
  IF p_entry_type NOT IN ('call_earning', 'gift_earning') THEN
    RETURN;
  END IF;

  v_day := public.creator_analytics_bucket_date(p_event_at);

  IF p_entry_type = 'call_earning' THEN
    IF p_source_type = 'call' AND p_source_id IS NOT NULL THEN
      SELECT COALESCE(c.billable_duration_seconds, c.duration_seconds, 0)
        INTO v_duration
        FROM public.calls c
       WHERE c.id = p_source_id;
    END IF;
    v_duration := COALESCE(v_duration, 0);

    INSERT INTO public.creator_analytics_daily (
      creator_profile_id, date,
      call_coins, gift_coins,
      call_count, call_duration_seconds, gifts_received_count,
      created_at, updated_at
    ) VALUES (
      p_creator_profile_id, v_day,
      p_amount, 0,
      1, v_duration, 0,
      p_event_at, NOW()
    )
    ON CONFLICT (creator_profile_id, date) DO UPDATE SET
      call_coins = public.creator_analytics_daily.call_coins + EXCLUDED.call_coins,
      call_count = public.creator_analytics_daily.call_count + 1,
      call_duration_seconds = public.creator_analytics_daily.call_duration_seconds + EXCLUDED.call_duration_seconds,
      updated_at = NOW();

  ELSIF p_entry_type = 'gift_earning' THEN
    INSERT INTO public.creator_analytics_daily (
      creator_profile_id, date,
      call_coins, gift_coins,
      call_count, call_duration_seconds, gifts_received_count,
      created_at, updated_at
    ) VALUES (
      p_creator_profile_id, v_day,
      0, p_amount,
      0, 0, 1,
      p_event_at, NOW()
    )
    ON CONFLICT (creator_profile_id, date) DO UPDATE SET
      gift_coins = public.creator_analytics_daily.gift_coins + EXCLUDED.gift_coins,
      gifts_received_count = public.creator_analytics_daily.gifts_received_count + 1,
      updated_at = NOW();
  END IF;
END;
$$;

-- ── wallet projection: track call/gift breakdown totals ─────
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
    creator_id, total_earned, available_balance, locked_balance, withdrawn_amount,
    gift_earnings_total, call_earnings_total
  ) VALUES (
    p_creator_profile_id, 0, 0, 0, 0, 0, 0
  ) ON CONFLICT (creator_id) DO NOTHING;

  CASE p_entry_type
    WHEN 'call_earning' THEN
      UPDATE public.creator_wallets
         SET total_earned = total_earned + p_amount,
             available_balance = available_balance + p_amount,
             call_earnings_total = call_earnings_total + FLOOR(p_amount)::BIGINT,
             updated_at = NOW()
       WHERE creator_id = p_creator_profile_id;
    WHEN 'gift_earning' THEN
      UPDATE public.creator_wallets
         SET total_earned = total_earned + p_amount,
             available_balance = available_balance + p_amount,
             gift_earnings_total = gift_earnings_total + FLOOR(p_amount)::BIGINT,
             updated_at = NOW()
       WHERE creator_id = p_creator_profile_id;
    WHEN 'adjustment_credit', 'refund_restore' THEN
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

-- ── ledger append: L1 + L3 + L4 atomic ─────────────────────
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

  IF p_entry_type IN ('call_earning', 'gift_earning') THEN
    PERFORM public._creator_analytics_daily_apply(
      p_profile_id, p_entry_type, p_amount,
      p_source_type, p_source_id, NOW()
    );
  END IF;

  RETURN v_id;
END;
$$;

-- ── rebuild L4 from L2 evidence (idempotent) ────────────────
CREATE OR REPLACE FUNCTION public.rebuild_creator_analytics_daily(
  p_creator_profile_id UUID DEFAULT NULL,
  p_from_date          DATE DEFAULT NULL,
  p_to_date            DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted   BIGINT := 0;
  v_upserted  BIGINT := 0;
BEGIN
  DELETE FROM public.creator_analytics_daily cad
   WHERE (p_creator_profile_id IS NULL OR cad.creator_profile_id = p_creator_profile_id)
     AND (p_from_date IS NULL OR cad.date >= p_from_date)
     AND (p_to_date IS NULL OR cad.date <= p_to_date);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  WITH call_agg AS (
    SELECT
      cp.id AS creator_profile_id,
      public.creator_analytics_bucket_date(ce.created_at) AS bucket_date,
      COALESCE(SUM(ce.creator_share), 0)::NUMERIC(12, 2) AS call_coins,
      COUNT(*)::INTEGER AS call_count,
      COALESCE(SUM(
        COALESCE(c.billable_duration_seconds, c.duration_seconds, 0)
      ), 0)::INTEGER AS call_duration_seconds,
      MAX(ce.created_at) AS last_event_at
    FROM public.creator_earnings ce
    JOIN public.creator_profiles cp ON cp.user_id = ce.creator_id
    JOIN public.calls c ON c.id = ce.call_id
    WHERE (p_creator_profile_id IS NULL OR cp.id = p_creator_profile_id)
      AND (p_from_date IS NULL OR public.creator_analytics_bucket_date(ce.created_at) >= p_from_date)
      AND (p_to_date IS NULL OR public.creator_analytics_bucket_date(ce.created_at) <= p_to_date)
    GROUP BY cp.id, public.creator_analytics_bucket_date(ce.created_at)
  ),
  gift_agg AS (
    SELECT
      gt.creator_id AS creator_profile_id,
      public.creator_analytics_bucket_date(gt.created_at) AS bucket_date,
      COALESCE(SUM(gt.creator_coins), 0)::NUMERIC(12, 2) AS gift_coins,
      COUNT(*)::INTEGER AS gifts_received_count,
      MAX(gt.created_at) AS last_event_at
    FROM public.gift_transactions gt
    WHERE (p_creator_profile_id IS NULL OR gt.creator_id = p_creator_profile_id)
      AND (p_from_date IS NULL OR public.creator_analytics_bucket_date(gt.created_at) >= p_from_date)
      AND (p_to_date IS NULL OR public.creator_analytics_bucket_date(gt.created_at) <= p_to_date)
    GROUP BY gt.creator_id, public.creator_analytics_bucket_date(gt.created_at)
  ),
  combined AS (
    SELECT
      COALESCE(ca.creator_profile_id, ga.creator_profile_id) AS creator_profile_id,
      COALESCE(ca.bucket_date, ga.bucket_date) AS bucket_date,
      COALESCE(ca.call_coins, 0) AS call_coins,
      COALESCE(ga.gift_coins, 0) AS gift_coins,
      COALESCE(ca.call_count, 0) AS call_count,
      COALESCE(ca.call_duration_seconds, 0) AS call_duration_seconds,
      COALESCE(ga.gifts_received_count, 0) AS gifts_received_count,
      GREATEST(COALESCE(ca.last_event_at, '-infinity'::TIMESTAMPTZ),
               COALESCE(ga.last_event_at, '-infinity'::TIMESTAMPTZ)) AS last_event_at
    FROM call_agg ca
    FULL OUTER JOIN gift_agg ga
      ON ca.creator_profile_id = ga.creator_profile_id
     AND ca.bucket_date = ga.bucket_date
  ),
  upserted AS (
    INSERT INTO public.creator_analytics_daily (
      creator_profile_id, date,
      call_coins, gift_coins,
      call_count, call_duration_seconds, gifts_received_count,
      created_at, updated_at
    )
    SELECT
      creator_profile_id,
      bucket_date,
      call_coins,
      gift_coins,
      call_count,
      call_duration_seconds,
      gifts_received_count,
      CASE WHEN last_event_at = '-infinity'::TIMESTAMPTZ THEN NOW() ELSE last_event_at END,
      NOW()
    FROM combined
    RETURNING 1
  )
  SELECT COUNT(*)::BIGINT INTO v_upserted FROM upserted;

  RETURN jsonb_build_object(
    'creator_profile_id', p_creator_profile_id,
    'from_date', p_from_date,
    'to_date', p_to_date,
    'rows_deleted', v_deleted,
    'rows_upserted', v_upserted,
    'timezone', 'Asia/Kolkata'
  );
END;
$$;

-- ── dashboard read helper (performance / future API) ────────
CREATE OR REPLACE FUNCTION public.get_creator_analytics_window(
  p_creator_profile_id UUID,
  p_from_date          DATE,
  p_to_date            DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'creator_profile_id', p_creator_profile_id,
    'from_date', p_from_date,
    'to_date', COALESCE(p_to_date, public.creator_analytics_bucket_date(NOW())),
    'call_coins', COALESCE(SUM(call_coins), 0),
    'gift_coins', COALESCE(SUM(gift_coins), 0),
    'total_coins', COALESCE(SUM(total_coins), 0),
    'call_count', COALESCE(SUM(call_count), 0),
    'call_duration_seconds', COALESCE(SUM(call_duration_seconds), 0),
    'gifts_received_count', COALESCE(SUM(gifts_received_count), 0),
    'daily_series', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'date', date,
          'call_coins', call_coins,
          'gift_coins', gift_coins,
          'total_coins', total_coins,
          'call_count', call_count,
          'gifts_received_count', gifts_received_count
        )
        ORDER BY date ASC
      ),
      '[]'::jsonb
    )
  )
  FROM public.creator_analytics_daily
  WHERE creator_profile_id = p_creator_profile_id
    AND date >= p_from_date
    AND date <= COALESCE(p_to_date, public.creator_analytics_bucket_date(NOW()));
$$;

-- ── end_call_billing: route earnings through L1 ledger ──────
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
  v_ledger_id          UUID;
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
    v_ledger_id := public._creator_ledger_append(
      v_creator_profile_id,
      v_call.creator_id,
      'call_earning',
      v_creator_share,
      'call',
      p_call_id,
      'call_earning:' || p_call_id::TEXT,
      'end_call_billing'
    );
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
    'creator_ledger_entry_id', v_ledger_id,
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

-- ── send_gift: route creator credit through L1 ledger ───────
CREATE OR REPLACE FUNCTION public.send_gift(
  p_sender_user_id   UUID,
  p_creator_user_id  UUID,
  p_gift_id          UUID,
  p_call_id          UUID,
  p_idempotency_key  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing          JSONB;
  v_sender            RECORD;
  v_gift              RECORD;
  v_call              RECORD;
  v_creator_user      RECORD;
  v_creator_profile   RECORD;
  v_balance_before    INTEGER;
  v_balance_after     INTEGER;
  v_creator_coins     INTEGER;
  v_platform_coins    INTEGER;
  v_wallet_key        UUID;
  v_txn_id            UUID;
  v_sender_name       TEXT;
  v_sender_avatar     TEXT;
  v_wallet_before     NUMERIC;
  v_wallet_after      NUMERIC;
  v_ledger_id         UUID;
  v_now               TIMESTAMPTZ := NOW();
  v_day_start         TIMESTAMPTZ := date_trunc('day', v_now);
  v_week_start        TIMESTAMPTZ := date_trunc('week', v_now);
  v_month_start       TIMESTAMPTZ := date_trunc('month', v_now);
  v_stats             RECORD;
  v_online_threshold  INTERVAL := INTERVAL '60 seconds';
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  IF p_sender_user_id = p_creator_user_id THEN
    RAISE EXCEPTION 'self_gift_not_allowed';
  END IF;

  SELECT jsonb_build_object(
    'success', true,
    'remaining_balance', u.coins,
    'gift_name', g.name,
    'coins_spent', gt.coins_spent,
    'creator_coins', gt.creator_coins,
    'platform_coins', gt.platform_coins,
    'gift_transaction_id', gt.id,
    'duplicate', true
  )
  INTO v_existing
  FROM public.gift_transactions gt
  JOIN public.gifts g ON g.id = gt.gift_id
  JOIN public.users u ON u.id = gt.sender_user_id
  WHERE gt.sender_user_id = p_sender_user_id
    AND gt.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_sender_user_id::text || ':' || p_call_id::text)
  );

  SELECT id, coins, status, name, full_name, profile_image, avatar_url
    INTO v_sender
    FROM public.users
   WHERE id = p_sender_user_id
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'sender_not_found'; END IF;
  IF v_sender.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'sender_not_active'; END IF;

  SELECT id, name, coin_cost, creator_share_percent, platform_share_percent, is_active
    INTO v_gift
    FROM public.gifts
   WHERE id = p_gift_id
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'gift_not_found'; END IF;
  IF NOT v_gift.is_active THEN RAISE EXCEPTION 'gift_disabled'; END IF;

  SELECT id, caller_id, creator_id, status
    INTO v_call
    FROM public.calls
   WHERE id = p_call_id
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'call_not_found'; END IF;
  IF v_call.status IS DISTINCT FROM 'ongoing' THEN RAISE EXCEPTION 'call_not_active'; END IF;
  IF v_call.creator_id IS DISTINCT FROM p_creator_user_id THEN RAISE EXCEPTION 'call_creator_mismatch'; END IF;
  IF v_call.caller_id IS DISTINCT FROM p_sender_user_id THEN RAISE EXCEPTION 'call_sender_mismatch'; END IF;

  SELECT id, status, is_creator
    INTO v_creator_user
    FROM public.users
   WHERE id = p_creator_user_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'creator_not_found'; END IF;
  IF COALESCE(v_creator_user.is_creator, false) IS NOT TRUE THEN RAISE EXCEPTION 'creator_not_approved'; END IF;
  IF v_creator_user.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'creator_suspended'; END IF;

  SELECT cp.id, cp.user_id, cp.is_online, cp.online_status, cp.last_seen_at
    INTO v_creator_profile
    FROM public.creator_profiles cp
   WHERE cp.user_id = p_creator_user_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'creator_profile_not_found'; END IF;
  IF COALESCE(v_creator_profile.is_online, v_creator_profile.online_status, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'creator_offline';
  END IF;
  IF v_creator_profile.last_seen_at IS NOT NULL
     AND v_creator_profile.last_seen_at < (v_now - v_online_threshold) THEN
    RAISE EXCEPTION 'creator_offline';
  END IF;

  v_creator_coins := FLOOR(v_gift.coin_cost::NUMERIC * (v_gift.creator_share_percent / 100.0))::INTEGER;
  v_platform_coins := v_gift.coin_cost - v_creator_coins;
  v_balance_before := COALESCE(v_sender.coins, 0);

  IF v_balance_before < v_gift.coin_cost THEN RAISE EXCEPTION 'insufficient_balance'; END IF;

  v_balance_after := v_balance_before - v_gift.coin_cost;

  UPDATE public.users SET coins = v_balance_after, updated_at = v_now WHERE id = p_sender_user_id;

  INSERT INTO public.gift_transactions (
    sender_user_id, creator_id, gift_id, call_id,
    coins_spent, creator_coins, platform_coins, idempotency_key
  ) VALUES (
    p_sender_user_id, v_creator_profile.id, p_gift_id, p_call_id,
    v_gift.coin_cost, v_creator_coins, v_platform_coins, p_idempotency_key
  ) RETURNING id INTO v_txn_id;

  INSERT INTO public.coin_transactions (
    user_id, type, amount, balance_before, balance_after, reference_id, description
  ) VALUES (
    p_sender_user_id, 'gift_deduction', -v_gift.coin_cost,
    v_balance_before, v_balance_after, v_txn_id, 'Gift sent: ' || v_gift.name
  );

  v_wallet_key := v_creator_profile.id;

  SELECT available_balance INTO v_wallet_before
    FROM public.creator_wallets WHERE creator_id = v_wallet_key;

  v_wallet_before := COALESCE(v_wallet_before, 0);

  v_ledger_id := public._creator_ledger_append(
    v_wallet_key,
    v_creator_profile.user_id,
    'gift_earning',
    v_creator_coins::NUMERIC,
    'gift_transaction',
    v_txn_id,
    'gift_earning:' || v_txn_id::TEXT,
    'send_gift'
  );

  SELECT available_balance INTO v_wallet_after
    FROM public.creator_wallets WHERE creator_id = v_wallet_key;

  v_wallet_after := COALESCE(v_wallet_after, v_wallet_before + v_creator_coins);

  INSERT INTO public.creator_transactions (
    creator_id, type, amount, balance_before, balance_after, reference_id
  ) VALUES (
    v_creator_profile.user_id,
    'gift_earning',
    v_creator_coins,
    v_wallet_before,
    v_wallet_after,
    v_txn_id
  );

  SELECT * INTO v_stats FROM public.creator_gift_stats
   WHERE creator_id = v_creator_profile.id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.creator_gift_stats (
      creator_id, total_gifts, total_gift_coins, total_gift_earnings,
      today_gifts, week_gifts, month_gifts, last_gift_at, updated_at
    ) VALUES (
      v_creator_profile.id, 1, v_gift.coin_cost, v_creator_coins, 1, 1, 1, v_now, v_now
    );
  ELSE
    UPDATE public.creator_gift_stats SET
      total_gifts = total_gifts + 1,
      total_gift_coins = total_gift_coins + v_gift.coin_cost,
      total_gift_earnings = total_gift_earnings + v_creator_coins,
      today_gifts = CASE WHEN last_gift_at IS NULL OR last_gift_at < v_day_start THEN 1 ELSE today_gifts + 1 END,
      week_gifts = CASE WHEN last_gift_at IS NULL OR last_gift_at < v_week_start THEN 1 ELSE week_gifts + 1 END,
      month_gifts = CASE WHEN last_gift_at IS NULL OR last_gift_at < v_month_start THEN 1 ELSE month_gifts + 1 END,
      last_gift_at = v_now, updated_at = v_now
    WHERE creator_id = v_creator_profile.id;
  END IF;

  UPDATE public.creator_profiles
     SET total_earnings = total_earnings + v_creator_coins, updated_at = v_now
   WHERE id = v_creator_profile.id;

  v_sender_name := COALESCE(v_sender.full_name, v_sender.name, 'User');
  v_sender_avatar := COALESCE(v_sender.avatar_url, v_sender.profile_image);

  INSERT INTO public.gift_realtime_events (event_type, payload)
  VALUES ('gift_received', jsonb_build_object(
    'giftTransactionId', v_txn_id,
    'senderId', p_sender_user_id,
    'senderName', v_sender_name,
    'senderAvatar', v_sender_avatar,
    'creatorId', v_creator_profile.id,
    'creatorUserId', p_creator_user_id,
    'giftName', v_gift.name,
    'giftCoins', v_gift.coin_cost,
    'creatorCoins', v_creator_coins,
    'createdAt', v_now
  ));

  RETURN jsonb_build_object(
    'success', true,
    'remaining_balance', v_balance_after,
    'gift_name', v_gift.name,
    'coins_spent', v_gift.coin_cost,
    'creator_coins', v_creator_coins,
    'platform_coins', v_platform_coins,
    'gift_transaction_id', v_txn_id,
    'creator_ledger_entry_id', v_ledger_id,
    'duplicate', false
  );
END;
$$;

-- ── permissions ─────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._creator_analytics_daily_apply(UUID, TEXT, NUMERIC, TEXT, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creator_analytics_bucket_date(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rebuild_creator_analytics_daily(UUID, DATE, DATE)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_creator_analytics_window(UUID, DATE, DATE)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rebuild_creator_analytics_daily(UUID, DATE, DATE)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_analytics_window(UUID, DATE, DATE)
  TO service_role;

-- ── initial backfill from L2 evidence ───────────────────────
SELECT public.rebuild_creator_analytics_daily(NULL, NULL, NULL);

COMMIT;
