-- ============================================================
-- Migration: send_gift() RPC — atomic gift send with idempotency
-- ============================================================

BEGIN;

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

  -- Idempotent replay: return prior successful result
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
  WHERE gt.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  -- Serialize concurrent sends from same sender on same call
  PERFORM pg_advisory_xact_lock(
    hashtext(p_sender_user_id::text || ':' || p_call_id::text)
  );

  -- Sender
  SELECT id, coins, status, name, full_name, profile_image, avatar_url
    INTO v_sender
    FROM public.users
   WHERE id = p_sender_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sender_not_found';
  END IF;

  IF v_sender.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'sender_not_active';
  END IF;

  -- Gift
  SELECT id, name, coin_cost, creator_share_percent, platform_share_percent, is_active
    INTO v_gift
    FROM public.gifts
   WHERE id = p_gift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'gift_not_found';
  END IF;

  IF NOT v_gift.is_active THEN
    RAISE EXCEPTION 'gift_disabled';
  END IF;

  -- Call (must be ongoing / in-progress)
  SELECT id, caller_id, creator_id, status
    INTO v_call
    FROM public.calls
   WHERE id = p_call_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'call_not_found';
  END IF;

  IF v_call.status IS DISTINCT FROM 'ongoing' THEN
    RAISE EXCEPTION 'call_not_active';
  END IF;

  IF v_call.creator_id IS DISTINCT FROM p_creator_user_id THEN
    RAISE EXCEPTION 'call_creator_mismatch';
  END IF;

  IF v_call.caller_id IS DISTINCT FROM p_sender_user_id THEN
    RAISE EXCEPTION 'call_sender_mismatch';
  END IF;

  -- Creator user (approved = is_creator + active status)
  SELECT id, status, is_creator, name, full_name, profile_image, avatar_url
    INTO v_creator_user
    FROM public.users
   WHERE id = p_creator_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'creator_not_found';
  END IF;

  IF COALESCE(v_creator_user.is_creator, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'creator_not_approved';
  END IF;

  IF v_creator_user.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'creator_suspended';
  END IF;

  -- Creator profile + online check
  SELECT cp.id, cp.is_online, cp.online_status, cp.last_seen_at
    INTO v_creator_profile
    FROM public.creator_profiles cp
   WHERE cp.user_id = p_creator_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'creator_profile_not_found';
  END IF;

  IF COALESCE(v_creator_profile.is_online, v_creator_profile.online_status, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'creator_offline';
  END IF;

  IF v_creator_profile.last_seen_at IS NOT NULL
     AND v_creator_profile.last_seen_at < (v_now - v_online_threshold) THEN
    RAISE EXCEPTION 'creator_offline';
  END IF;

  -- Revenue split (integer coins)
  v_creator_coins := FLOOR(
    v_gift.coin_cost::NUMERIC * (v_gift.creator_share_percent / 100.0)
  )::INTEGER;
  v_platform_coins := v_gift.coin_cost - v_creator_coins;

  v_balance_before := COALESCE(v_sender.coins, 0);

  IF v_balance_before < v_gift.coin_cost THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  v_balance_after := v_balance_before - v_gift.coin_cost;

  -- Deduct sender wallet (users.coins is source of truth)
  UPDATE public.users
     SET coins = v_balance_after,
         updated_at = v_now
   WHERE id = p_sender_user_id;

  -- Gift transaction (idempotency enforced by unique key)
  INSERT INTO public.gift_transactions (
    sender_user_id,
    creator_id,
    gift_id,
    call_id,
    coins_spent,
    creator_coins,
    platform_coins,
    idempotency_key
  )
  VALUES (
    p_sender_user_id,
    v_creator_profile.id,
    p_gift_id,
    p_call_id,
    v_gift.coin_cost,
    v_creator_coins,
    v_platform_coins,
    p_idempotency_key
  )
  RETURNING id INTO v_txn_id;

  -- Ledger: sender coin deduction
  INSERT INTO public.coin_transactions (
    user_id, type, amount, balance_before, balance_after, reference_id, description
  )
  VALUES (
    p_sender_user_id,
    'gift_deduction',
    -v_gift.coin_cost,
    v_balance_before,
    v_balance_after,
    v_txn_id,
    'Gift sent: ' || v_gift.name
  );

  -- Credit creator wallet (matches existing app: wallet keyed by creator_profiles.id)
  v_wallet_key := v_creator_profile.id;

  PERFORM public.increment_creator_wallet(v_wallet_key, v_creator_coins::NUMERIC);

  UPDATE public.creator_wallets
     SET gift_earnings_total = gift_earnings_total + v_creator_coins,
         updated_at = v_now
   WHERE creator_id = v_wallet_key;

  IF NOT FOUND THEN
    INSERT INTO public.creator_wallets (
      creator_id, total_earned, available_balance, withdrawn_amount,
      gift_earnings_total, call_earnings_total, created_at, updated_at
    )
    VALUES (
      v_wallet_key, v_creator_coins, v_creator_coins, 0,
      v_creator_coins, 0, v_now, v_now
    );
  END IF;

  -- Creator gift stats (rolling windows reset when period changes)
  SELECT *
    INTO v_stats
    FROM public.creator_gift_stats
   WHERE creator_id = v_creator_profile.id
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.creator_gift_stats (
      creator_id,
      total_gifts,
      total_gift_coins,
      total_gift_earnings,
      today_gifts,
      week_gifts,
      month_gifts,
      last_gift_at,
      updated_at
    )
    VALUES (
      v_creator_profile.id,
      1,
      v_gift.coin_cost,
      v_creator_coins,
      1,
      1,
      1,
      v_now,
      v_now
    );
  ELSE
    UPDATE public.creator_gift_stats
       SET total_gifts = total_gifts + 1,
           total_gift_coins = total_gift_coins + v_gift.coin_cost,
           total_gift_earnings = total_gift_earnings + v_creator_coins,
           today_gifts = CASE
             WHEN last_gift_at IS NULL OR last_gift_at < v_day_start THEN 1
             ELSE today_gifts + 1
           END,
           week_gifts = CASE
             WHEN last_gift_at IS NULL OR last_gift_at < v_week_start THEN 1
             ELSE week_gifts + 1
           END,
           month_gifts = CASE
             WHEN last_gift_at IS NULL OR last_gift_at < v_month_start THEN 1
             ELSE month_gifts + 1
           END,
           last_gift_at = v_now,
           updated_at = v_now
     WHERE creator_id = v_creator_profile.id;
  END IF;

  -- Sync creator_profiles.total_earnings (non-critical aggregate)
  UPDATE public.creator_profiles
     SET total_earnings = total_earnings + v_creator_coins,
         updated_at = v_now
   WHERE id = v_creator_profile.id;

  v_sender_name := COALESCE(v_sender.full_name, v_sender.name, 'User');
  v_sender_avatar := COALESCE(v_sender.avatar_url, v_sender.profile_image);

  -- Realtime outbox: gift_received
  INSERT INTO public.gift_realtime_events (event_type, payload)
  VALUES (
    'gift_received',
    jsonb_build_object(
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
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'remaining_balance', v_balance_after,
    'gift_name', v_gift.name,
    'coins_spent', v_gift.coin_cost,
    'creator_coins', v_creator_coins,
    'platform_coins', v_platform_coins,
    'gift_transaction_id', v_txn_id,
    'duplicate', false
  );

EXCEPTION
  WHEN unique_violation THEN
    -- Concurrent duplicate idempotency / race: return stored result
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
    WHERE gt.idempotency_key = p_idempotency_key;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
    RAISE;
END;
$$;

COMMENT ON FUNCTION public.send_gift(UUID, UUID, UUID, UUID, TEXT) IS
  'Atomically sends a gift during an ongoing call. Idempotent via p_idempotency_key. '
  'Deducts sender coins, credits creator wallet (60/40 split by default), updates stats, '
  'and inserts a gift_realtime_events row.';

COMMIT;
