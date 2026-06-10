-- Phase 3.3B Sprint 5: Paid Messages

BEGIN;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS engagement_paid_messages_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS message_per_send_coins INT NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS message_session_24h_coins INT NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS message_creator_share_percent INT NOT NULL DEFAULT 60;

-- ── extend creator ledger entry types ──────────────────────────
ALTER TABLE public.creator_ledger_entries DROP CONSTRAINT IF EXISTS creator_ledger_entries_entry_type_check;
ALTER TABLE public.creator_ledger_entries ADD CONSTRAINT creator_ledger_entries_entry_type_check
  CHECK (entry_type IN (
    'call_earning', 'gift_earning', 'adjustment_credit', 'adjustment_debit',
    'withdrawal_reserve', 'withdrawal_release', 'withdrawal_payout',
    'refund_restore', 'message_earning'
  ));

-- ── message_sessions (L2) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  creator_profile_id  UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'locked' CHECK (status IN (
    'locked', 'unlocked', 'archived', 'muted'
  )),
  unlock_type         TEXT NOT NULL DEFAULT 'per_message' CHECK (unlock_type IN (
    'per_message', 'session_24h'
  )),
  unlocked_until      TIMESTAMPTZ,
  last_message_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_sessions_user_creator
  ON public.message_sessions (user_id, creator_profile_id);

CREATE INDEX IF NOT EXISTS idx_message_sessions_user_updated
  ON public.message_sessions (user_id, updated_at DESC);

-- ── paid_messages (L2 evidence) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.paid_messages (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id              UUID NOT NULL REFERENCES public.message_sessions(id) ON DELETE CASCADE,
  sender_user_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  creator_profile_id      UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  direction               TEXT NOT NULL CHECK (direction IN ('user_to_creator', 'creator_to_user')),
  message_type            TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'voice_note')),
  body_text               TEXT,
  body_preview            TEXT NOT NULL DEFAULT '',
  voice_url               TEXT,
  voice_duration_ms       INT CHECK (voice_duration_ms IS NULL OR voice_duration_ms >= 0),
  is_locked_for_recipient BOOLEAN NOT NULL DEFAULT FALSE,
  coins_charged           INT NOT NULL DEFAULT 0 CHECK (coins_charged >= 0),
  coin_transaction_id     UUID,
  creator_ledger_entry_id UUID,
  idempotency_key         TEXT NOT NULL UNIQUE,
  read_at                 TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paid_messages_session_created
  ON public.paid_messages (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_paid_messages_sender_created
  ON public.paid_messages (sender_user_id, created_at DESC);

-- ── message_unlocks (L2 financial evidence) ────────────────────
CREATE TABLE IF NOT EXISTS public.message_unlocks (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id              UUID NOT NULL REFERENCES public.message_sessions(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  creator_profile_id      UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  unlock_type             TEXT NOT NULL CHECK (unlock_type IN ('per_message', 'session_24h')),
  coins_spent             INT NOT NULL CHECK (coins_spent > 0),
  creator_coins           INT NOT NULL CHECK (creator_coins >= 0),
  platform_coins          INT NOT NULL CHECK (platform_coins >= 0),
  coin_transaction_id     UUID,
  creator_ledger_entry_id UUID,
  idempotency_key         TEXT NOT NULL UNIQUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_unlocks_user_created
  ON public.message_unlocks (user_id, created_at DESC);

-- ── message_events (L2 append-only) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES public.message_sessions(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL CHECK (event_type IN (
    'session_created', 'session_unlocked', 'message_sent', 'message_read', 'voice_sent'
  )),
  message_id      UUID REFERENCES public.paid_messages(id) ON DELETE SET NULL,
  unlock_id       UUID REFERENCES public.message_unlocks(id) ON DELETE SET NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
  idempotency_key TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_events_idempotency
  ON public.message_events (user_id, idempotency_key);

-- ── conversation_summaries (L3 projection) ─────────────────────
CREATE TABLE IF NOT EXISTS public.conversation_summaries (
  session_id          UUID PRIMARY KEY REFERENCES public.message_sessions(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  creator_profile_id  UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  creator_user_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'locked',
  unlock_type         TEXT NOT NULL DEFAULT 'per_message',
  unlocked_until      TIMESTAMPTZ,
  last_message_at     TIMESTAMPTZ,
  last_preview        TEXT NOT NULL DEFAULT '',
  last_message_type   TEXT,
  message_count       INT NOT NULL DEFAULT 0,
  unread_user         INT NOT NULL DEFAULT 0,
  unread_creator      INT NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_summaries_user_updated
  ON public.conversation_summaries (user_id, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_conversation_summaries_creator_updated
  ON public.conversation_summaries (creator_user_id, last_message_at DESC NULLS LAST);

-- ── RLS deny clients ───────────────────────────────────────────
ALTER TABLE public.message_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paid_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_sessions_deny_clients ON public.message_sessions;
CREATE POLICY message_sessions_deny_clients ON public.message_sessions
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS paid_messages_deny_clients ON public.paid_messages;
CREATE POLICY paid_messages_deny_clients ON public.paid_messages
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS message_unlocks_deny_clients ON public.message_unlocks;
CREATE POLICY message_unlocks_deny_clients ON public.message_unlocks
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS message_events_deny_clients ON public.message_events;
CREATE POLICY message_events_deny_clients ON public.message_events
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS conversation_summaries_deny_clients ON public.conversation_summaries;
CREATE POLICY conversation_summaries_deny_clients ON public.conversation_summaries
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ── extend adjust_user_coins_v2 ──────────────────────────────────
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
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id_required'; END IF;
  IF v_delta = 0 THEN RAISE EXCEPTION 'delta_must_be_non_zero'; END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  IF p_source_type NOT IN (
    'payment', 'call', 'gift', 'admin_adjust', 'refund',
    'mission_reward', 'streak_reward', 'combo_reward',
    'message_unlock', 'message_send'
  ) THEN
    RAISE EXCEPTION 'invalid_source_type: %', p_source_type;
  END IF;

  SELECT * INTO v_existing FROM public.coin_transactions
   WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    v_result.coin_transaction_id := v_existing.id;
    v_result.user_id := p_user_id;
    v_result.balance_before := v_existing.balance_before;
    v_result.balance_after := v_existing.balance_after;
    v_result.amount := v_existing.amount;
    v_result.idempotent_replay := TRUE;
    RETURN v_result;
  END IF;

  INSERT INTO public.wallets (user_id, coin_balance) VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  v_balance_before := v_wallet.coin_balance;
  v_balance_after := v_balance_before + v_delta;

  IF v_balance_after < 0 THEN
    IF p_allow_partial THEN
      v_balance_after := 0;
      v_delta := -v_balance_before;
    ELSE
      RAISE EXCEPTION 'insufficient_balance' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.users SET coins = v_balance_after, updated_at = NOW() WHERE id = p_user_id;
  UPDATE public.wallets SET coin_balance = v_balance_after, updated_at = NOW() WHERE user_id = p_user_id;

  v_tx_type := CASE
    WHEN p_source_type = 'admin_adjust' AND v_delta >= 0 THEN 'admin_adjustment_add'
    WHEN p_source_type = 'admin_adjust' AND v_delta < 0 THEN 'admin_adjustment_deduct'
    WHEN p_source_type = 'payment' THEN 'recharge'
    WHEN p_source_type = 'call' THEN 'call_deduction'
    WHEN p_source_type = 'gift' THEN 'gift_deduction'
    WHEN p_source_type = 'refund' THEN 'refund'
    WHEN p_source_type = 'mission_reward' THEN 'mission_reward'
    WHEN p_source_type = 'streak_reward' THEN 'streak_reward'
    WHEN p_source_type = 'combo_reward' THEN 'combo_reward'
    WHEN p_source_type = 'message_unlock' THEN 'message_unlock'
    WHEN p_source_type = 'message_send' THEN 'message_unlock'
    ELSE 'admin_adjustment_add'
  END;

  INSERT INTO public.coin_transactions (
    user_id, type, amount, balance_before, balance_after,
    reference_id, reference_type, idempotency_key, admin_id, description
  ) VALUES (
    p_user_id, v_tx_type, v_delta, v_balance_before, v_balance_after,
    p_source_id, p_source_type, p_idempotency_key, p_admin_id,
    p_source_type || ' via adjust_user_coins_v2'
  ) RETURNING id INTO v_tx_id;

  v_result.coin_transaction_id := v_tx_id;
  v_result.user_id := p_user_id;
  v_result.balance_before := v_balance_before;
  v_result.balance_after := v_balance_after;
  v_result.amount := v_delta;
  v_result.idempotent_replay := FALSE;
  RETURN v_result;
END;
$$;

-- ── extend creator wallet for message earnings ─────────────────
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
    WHEN 'gift_earning', 'message_earning' THEN
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

CREATE OR REPLACE FUNCTION public.rebuild_conversation_summaries()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_count INT := 0;
BEGIN
  FOR v_session_id IN SELECT id FROM public.message_sessions LOOP
    PERFORM public.rebuild_conversation_summary(v_session_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ── helpers ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._message_session_is_unlocked(p_session public.message_sessions)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_session.status = 'unlocked'
    AND (p_session.unlocked_until IS NULL OR p_session.unlocked_until > NOW());
$$;

CREATE OR REPLACE FUNCTION public._message_mask_preview(p_body TEXT, p_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_type = 'voice_note' THEN '🎤 Voice note'
    WHEN p_body IS NULL OR length(trim(p_body)) = 0 THEN '💬 Message'
    ELSE left(p_body, 3) || '•••'
  END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_conversation_summary(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s public.message_sessions%ROWTYPE;
  v_creator_user_id UUID;
  v_last public.paid_messages%ROWTYPE;
  v_count INT;
  v_unread_user INT;
  v_unread_creator INT;
BEGIN
  SELECT * INTO v_s FROM public.message_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT user_id INTO v_creator_user_id
    FROM public.creator_profiles WHERE id = v_s.creator_profile_id;

  SELECT * INTO v_last FROM public.paid_messages
   WHERE session_id = p_session_id ORDER BY created_at DESC LIMIT 1;

  SELECT COUNT(*)::INT INTO v_count FROM public.paid_messages WHERE session_id = p_session_id;
  SELECT COUNT(*)::INT INTO v_unread_user FROM public.paid_messages
   WHERE session_id = p_session_id AND direction = 'creator_to_user' AND read_at IS NULL;
  SELECT COUNT(*)::INT INTO v_unread_creator FROM public.paid_messages
   WHERE session_id = p_session_id AND direction = 'user_to_creator' AND read_at IS NULL;

  INSERT INTO public.conversation_summaries (
    session_id, user_id, creator_profile_id, creator_user_id,
    status, unlock_type, unlocked_until, last_message_at,
    last_preview, last_message_type, message_count,
    unread_user, unread_creator, updated_at
  ) VALUES (
    v_s.id, v_s.user_id, v_s.creator_profile_id, v_creator_user_id,
    v_s.status, v_s.unlock_type, v_s.unlocked_until, v_s.last_message_at,
    COALESCE(v_last.body_preview, ''), v_last.message_type, v_count,
    v_unread_user, v_unread_creator, NOW()
  )
  ON CONFLICT (session_id) DO UPDATE SET
    status = EXCLUDED.status,
    unlock_type = EXCLUDED.unlock_type,
    unlocked_until = EXCLUDED.unlocked_until,
    last_message_at = EXCLUDED.last_message_at,
    last_preview = EXCLUDED.last_preview,
    last_message_type = EXCLUDED.last_message_type,
    message_count = EXCLUDED.message_count,
    unread_user = EXCLUDED.unread_user,
    unread_creator = EXCLUDED.unread_creator,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_message_session(
  p_user_id UUID,
  p_creator_profile_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_enabled BOOLEAN;
BEGIN
  SELECT COALESCE(engagement_paid_messages_enabled, TRUE) INTO v_enabled FROM public.app_settings LIMIT 1;
  IF NOT COALESCE(v_enabled, FALSE) THEN RAISE EXCEPTION 'paid_messages_disabled'; END IF;

  SELECT id INTO v_session_id FROM public.message_sessions
   WHERE user_id = p_user_id AND creator_profile_id = p_creator_profile_id;

  IF FOUND THEN RETURN v_session_id; END IF;

  INSERT INTO public.message_sessions (user_id, creator_profile_id)
  VALUES (p_user_id, p_creator_profile_id)
  RETURNING id INTO v_session_id;

  INSERT INTO public.message_events (
    session_id, user_id, event_type, metadata, idempotency_key
  ) VALUES (
    v_session_id, p_user_id, 'session_created',
    jsonb_build_object('creatorProfileId', p_creator_profile_id),
    'session-create:' || v_session_id::TEXT
  );

  PERFORM public.rebuild_conversation_summary(v_session_id);
  RETURN v_session_id;
END;
$$;

-- ── unlock session ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unlock_message_session(
  p_user_id UUID,
  p_session_id UUID,
  p_unlock_type TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.message_sessions%ROWTYPE;
  v_existing public.message_unlocks%ROWTYPE;
  v_coins INT;
  v_share INT;
  v_creator_coins INT;
  v_platform_coins INT;
  v_wallet public.user_wallet_result;
  v_ledger_id UUID;
  v_creator_user_id UUID;
  v_unlock_id UUID;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT * INTO v_existing FROM public.message_unlocks
   WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'idempotentReplay', true,
      'unlockId', v_existing.id,
      'coinsSpent', v_existing.coins_spent
    );
  END IF;

  SELECT * INTO v_session FROM public.message_sessions
   WHERE id = p_session_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;

  IF public._message_session_is_unlocked(v_session) THEN
    RETURN jsonb_build_object('idempotentReplay', true, 'status', 'unlocked');
  END IF;

  IF p_unlock_type = 'session_24h' THEN
    SELECT COALESCE(message_session_24h_coins, 50) INTO v_coins FROM public.app_settings LIMIT 1;
  ELSE
    RAISE EXCEPTION 'invalid_unlock_type';
  END IF;

  SELECT COALESCE(message_creator_share_percent, 60) INTO v_share FROM public.app_settings LIMIT 1;
  v_creator_coins := FLOOR(v_coins::NUMERIC * (v_share / 100.0))::INT;
  v_platform_coins := v_coins - v_creator_coins;

  v_wallet := public.adjust_user_coins_v2(
    p_user_id, -v_coins, 'message_unlock', p_session_id,
    'msg-unlock:' || p_idempotency_key, FALSE, NULL
  );

  SELECT user_id INTO v_creator_user_id FROM public.creator_profiles
   WHERE id = v_session.creator_profile_id;

  v_ledger_id := public._creator_ledger_append(
    v_session.creator_profile_id, v_creator_user_id, 'message_earning',
    v_creator_coins::NUMERIC, 'message_unlock', p_session_id,
    'msg-earn-unlock:' || p_idempotency_key, 'unlock_message_session'
  );

  INSERT INTO public.message_unlocks (
    session_id, user_id, creator_profile_id, unlock_type,
    coins_spent, creator_coins, platform_coins,
    coin_transaction_id, creator_ledger_entry_id, idempotency_key
  ) VALUES (
    p_session_id, p_user_id, v_session.creator_profile_id, p_unlock_type,
    v_coins, v_creator_coins, v_platform_coins,
    v_wallet.coin_transaction_id, v_ledger_id, p_idempotency_key
  ) RETURNING id INTO v_unlock_id;

  UPDATE public.message_sessions SET
    status = 'unlocked',
    unlock_type = p_unlock_type,
    unlocked_until = NOW() + INTERVAL '24 hours',
    updated_at = NOW()
  WHERE id = p_session_id;

  INSERT INTO public.message_events (
    session_id, user_id, event_type, unlock_id, metadata, idempotency_key
  ) VALUES (
    p_session_id, p_user_id, 'session_unlocked', v_unlock_id,
    jsonb_build_object('unlockType', p_unlock_type, 'coinsSpent', v_coins),
    'msg-event-unlock:' || p_idempotency_key
  );

  PERFORM public.rebuild_conversation_summary(p_session_id);

  RETURN jsonb_build_object(
    'idempotentReplay', false,
    'unlockId', v_unlock_id,
    'status', 'unlocked',
    'unlockedUntil', NOW() + INTERVAL '24 hours',
    'coinsSpent', v_coins,
    'balanceAfter', v_wallet.balance_after
  );
END;
$$;

-- ── send paid message ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_paid_message(
  p_actor_user_id UUID,
  p_session_id UUID,
  p_message_type TEXT,
  p_body_text TEXT,
  p_voice_url TEXT,
  p_voice_duration_ms INT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.message_sessions%ROWTYPE;
  v_existing public.paid_messages%ROWTYPE;
  v_creator_user_id UUID;
  v_direction TEXT;
  v_coins INT := 0;
  v_share INT;
  v_creator_coins INT := 0;
  v_platform_coins INT := 0;
  v_wallet public.user_wallet_result;
  v_ledger_id UUID;
  v_msg_id UUID;
  v_preview TEXT;
  v_body_visible TEXT;
  v_locked BOOLEAN := FALSE;
  v_is_user BOOLEAN;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT * INTO v_existing FROM public.paid_messages WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'idempotentReplay', true,
      'messageId', v_existing.id,
      'sessionId', v_existing.session_id
    );
  END IF;

  SELECT * INTO v_session FROM public.message_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;

  SELECT user_id INTO v_creator_user_id FROM public.creator_profiles
   WHERE id = v_session.creator_profile_id;

  v_is_user := p_actor_user_id = v_session.user_id;
  IF NOT v_is_user AND p_actor_user_id IS DISTINCT FROM v_creator_user_id THEN
    RAISE EXCEPTION 'session_not_participant';
  END IF;

  v_direction := CASE WHEN v_is_user THEN 'user_to_creator' ELSE 'creator_to_user' END;

  IF v_is_user AND v_session.unlock_type = 'per_message' AND NOT public._message_session_is_unlocked(v_session) THEN
    SELECT COALESCE(message_per_send_coins, 10) INTO v_coins FROM public.app_settings LIMIT 1;
    SELECT COALESCE(message_creator_share_percent, 60) INTO v_share FROM public.app_settings LIMIT 1;
    v_creator_coins := FLOOR(v_coins::NUMERIC * (v_share / 100.0))::INT;
    v_platform_coins := v_coins - v_creator_coins;

    v_wallet := public.adjust_user_coins_v2(
      v_session.user_id, -v_coins, 'message_send', p_session_id,
      'msg-send:' || p_idempotency_key, FALSE, NULL
    );

    v_ledger_id := public._creator_ledger_append(
      v_session.creator_profile_id, v_creator_user_id, 'message_earning',
      v_creator_coins::NUMERIC, 'paid_message', p_session_id,
      'msg-earn-send:' || p_idempotency_key, 'send_paid_message'
    );
  ELSIF NOT v_is_user AND NOT public._message_session_is_unlocked(v_session) THEN
    RAISE EXCEPTION 'session_locked';
  END IF;

  v_preview := public._message_mask_preview(p_body_text, p_message_type);
  v_body_visible := COALESCE(p_body_text, '');
  v_locked := FALSE;

  INSERT INTO public.paid_messages (
    session_id, sender_user_id, creator_profile_id, direction,
    message_type, body_text, body_preview, voice_url, voice_duration_ms,
    is_locked_for_recipient, coins_charged, coin_transaction_id,
    creator_ledger_entry_id, idempotency_key
  ) VALUES (
    p_session_id, p_actor_user_id, v_session.creator_profile_id, v_direction,
    p_message_type, v_body_visible, v_preview, p_voice_url, p_voice_duration_ms,
    v_locked, v_coins, v_wallet.coin_transaction_id, v_ledger_id, p_idempotency_key
  ) RETURNING id INTO v_msg_id;

  UPDATE public.message_sessions SET
    last_message_at = NOW(), updated_at = NOW()
  WHERE id = p_session_id;

  INSERT INTO public.message_events (
    session_id, user_id, event_type, message_id, metadata, idempotency_key
  ) VALUES (
    p_session_id, p_actor_user_id,
    CASE WHEN p_message_type = 'voice_note' THEN 'voice_sent' ELSE 'message_sent' END,
    v_msg_id,
    jsonb_build_object('direction', v_direction, 'coinsCharged', v_coins),
    'msg-event-send:' || p_idempotency_key
  );

  PERFORM public.rebuild_conversation_summary(p_session_id);

  RETURN jsonb_build_object(
    'idempotentReplay', false,
    'messageId', v_msg_id,
    'sessionId', p_session_id,
    'messageType', p_message_type,
    'body', v_body_visible,
    'voiceUrl', p_voice_url,
    'voiceDurationMs', p_voice_duration_ms,
    'coinsCharged', v_coins,
    'isLocked', v_locked,
    'balanceAfter', CASE WHEN v_coins > 0 THEN v_wallet.balance_after ELSE NULL END
  );
END;
$$;

-- ── read RPCs ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_message_conversations(
  p_user_id UUID,
  p_limit INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB), '[]'::JSONB)
    INTO v_items
    FROM (
      SELECT
        cs.session_id AS "sessionId",
        cs.creator_profile_id AS "creatorProfileId",
        cs.status,
        cs.unlock_type AS "unlockType",
        cs.unlocked_until AS "unlockedUntil",
        cs.last_message_at AS "lastMessageAt",
        cs.last_preview AS "lastPreview",
        cs.last_message_type AS "lastMessageType",
        cs.message_count AS "messageCount",
        cs.unread_user AS "unreadCount",
        u.name AS "creatorName",
        COALESCE(u.avatar_url, u.profile_image) AS "creatorAvatar"
      FROM public.conversation_summaries cs
      JOIN public.creator_profiles cp ON cp.id = cs.creator_profile_id
      JOIN public.users u ON u.id = cp.user_id
     WHERE cs.user_id = p_user_id
     ORDER BY cs.last_message_at DESC NULLS LAST, cs.updated_at DESC
     LIMIT LEAST(GREATEST(p_limit, 1), 50)
    ) t;

  RETURN jsonb_build_object('conversations', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_message_session_detail(
  p_user_id UUID,
  p_session_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.message_sessions%ROWTYPE;
  v_creator_user_id UUID;
  v_messages JSONB;
BEGIN
  SELECT * INTO v_session FROM public.message_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;

  SELECT user_id INTO v_creator_user_id FROM public.creator_profiles
   WHERE id = v_session.creator_profile_id;

  IF p_user_id IS DISTINCT FROM v_session.user_id
     AND p_user_id IS DISTINCT FROM v_creator_user_id THEN
    RAISE EXCEPTION 'session_not_participant';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(m)::JSONB ORDER BY m."createdAt"), '[]'::JSONB)
    INTO v_messages
    FROM (
      SELECT
        pm.id AS "messageId",
        pm.direction,
        pm.message_type AS "messageType",
        CASE WHEN pm.is_locked_for_recipient AND p_user_id <> pm.sender_user_id
          THEN pm.body_preview ELSE pm.body_text END AS "body",
        pm.voice_url AS "voiceUrl",
        pm.voice_duration_ms AS "voiceDurationMs",
        pm.is_locked_for_recipient AS "isLocked",
        pm.coins_charged AS "coinsCharged",
        pm.sender_user_id AS "senderUserId",
        pm.created_at AS "createdAt"
      FROM public.paid_messages pm
     WHERE pm.session_id = p_session_id
     ORDER BY pm.created_at ASC
     LIMIT LEAST(GREATEST(p_limit, 1), 100)
    ) m;

  RETURN jsonb_build_object(
    'session', jsonb_build_object(
      'sessionId', v_session.id,
      'status', v_session.status,
      'unlockType', v_session.unlock_type,
      'unlockedUntil', v_session.unlocked_until,
      'userId', v_session.user_id,
      'creatorProfileId', v_session.creator_profile_id
    ),
    'messages', v_messages
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_message_history(
  p_user_id UUID,
  p_limit INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB), '[]'::JSONB)
    INTO v_items
    FROM (
      SELECT 'message' AS "entryType", pm.id AS "id",
        pm.session_id AS "sessionId", pm.message_type AS "messageType",
        pm.body_preview AS "preview", pm.coins_charged AS "coinsSpent",
        pm.created_at AS "createdAt"
      FROM public.paid_messages pm
     WHERE pm.sender_user_id = p_user_id
     UNION ALL
      SELECT 'unlock' AS "entryType", mu.id AS "id",
        mu.session_id AS "sessionId", mu.unlock_type AS "messageType",
        'Session unlock' AS "preview", mu.coins_spent AS "coinsSpent",
        mu.created_at AS "createdAt"
      FROM public.message_unlocks mu
     WHERE mu.user_id = p_user_id
     ORDER BY "createdAt" DESC
     LIMIT LEAST(GREATEST(p_limit, 1), 50)
    ) t;

  RETURN jsonb_build_object('items', v_items);
END;
$$;

-- ── permissions ──────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.rebuild_conversation_summaries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rebuild_conversation_summary FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_message_session FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unlock_message_session FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_paid_message FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_message_conversations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_message_session_detail FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_message_history FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rebuild_conversation_summaries TO service_role;
GRANT EXECUTE ON FUNCTION public.rebuild_conversation_summary TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_message_session TO service_role;
GRANT EXECUTE ON FUNCTION public.unlock_message_session TO service_role;
GRANT EXECUTE ON FUNCTION public.send_paid_message TO service_role;
GRANT EXECUTE ON FUNCTION public.get_message_conversations TO service_role;
GRANT EXECUTE ON FUNCTION public.get_message_session_detail TO service_role;
GRANT EXECUTE ON FUNCTION public.get_message_history TO service_role;

COMMIT;
