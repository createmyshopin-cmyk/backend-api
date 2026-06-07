-- ============================================================
-- Phase 1.1: Gift System Security Hardening (production-ready)
-- ============================================================

BEGIN;

-- ── P0 #1: RPC execution lockdown ────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.send_gift(UUID, UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gift_analytics_summary()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_gift_analytics_daily()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_gift_realtime_events()
  FROM PUBLIC, anon, authenticated;

-- ── P0 #2: Realtime data leak — remove publication + public read ───────────
DROP POLICY IF EXISTS gift_realtime_events_read ON public.gift_realtime_events;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'gift_realtime_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.gift_realtime_events;
  END IF;
END $$;

-- ── P0 #3: Scoped idempotency per sender ───────────────────────────────────
ALTER TABLE public.gift_transactions
  DROP CONSTRAINT IF EXISTS uq_gift_transactions_idempotency_key;

ALTER TABLE public.gift_transactions
  DROP CONSTRAINT IF EXISTS uq_gift_transactions_sender_idempotency;

ALTER TABLE public.gift_transactions
  ADD CONSTRAINT uq_gift_transactions_sender_idempotency
  UNIQUE (sender_user_id, idempotency_key);

-- ── P2: Analytics materialized view ────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS public.gift_analytics_daily;

CREATE MATERIALIZED VIEW public.gift_analytics_daily AS
SELECT
  date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day,
  COUNT(*)::bigint AS gift_count,
  COALESCE(SUM(coins_spent), 0)::bigint AS revenue,
  COALESCE(SUM(platform_coins), 0)::bigint AS platform_revenue,
  COALESCE(SUM(creator_coins), 0)::bigint AS creator_revenue
FROM public.gift_transactions
GROUP BY 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_analytics_daily_day
  ON public.gift_analytics_daily (day);

CREATE OR REPLACE FUNCTION public.refresh_gift_analytics_daily()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.gift_analytics_daily;
EXCEPTION
  WHEN OTHERS THEN
    REFRESH MATERIALIZED VIEW public.gift_analytics_daily;
END;
$$;

-- ── P2: Realtime retention (7 days) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_gift_realtime_events()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.gift_realtime_events
   WHERE created_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ── Optimized analytics RPC (uses MV + bounded scans) ────────────────────────
CREATE OR REPLACE FUNCTION public.gift_analytics_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (NOW() AT TIME ZONE 'UTC')::date;
  v_week_start date := v_today - 6;
  v_month_start date := date_trunc('month', v_today::timestamp)::date;
BEGIN
  PERFORM public.refresh_gift_analytics_daily();

  RETURN (
    WITH bounds AS (
      SELECT v_today AS today, v_week_start AS week_start, v_month_start AS month_start
    ),
    daily AS (
      SELECT * FROM public.gift_analytics_daily
    ),
    today AS (
      SELECT COALESCE(revenue, 0) AS revenue,
             COALESCE(platform_revenue, 0) AS platform,
             COALESCE(creator_revenue, 0) AS creator
      FROM daily, bounds b WHERE day = b.today
    ),
    week AS (
      SELECT COALESCE(SUM(revenue), 0) AS revenue,
             COALESCE(SUM(platform_revenue), 0) AS platform,
             COALESCE(SUM(creator_revenue), 0) AS creator
      FROM daily, bounds b WHERE day >= b.week_start
    ),
    month AS (
      SELECT COALESCE(SUM(revenue), 0) AS revenue,
             COALESCE(SUM(platform_revenue), 0) AS platform,
             COALESCE(SUM(creator_revenue), 0) AS creator
      FROM daily, bounds b WHERE day >= b.month_start
    ),
    lifetime AS (
      SELECT COALESCE(SUM(revenue), 0) AS revenue,
             COALESCE(SUM(platform_revenue), 0) AS platform,
             COALESCE(SUM(creator_revenue), 0) AS creator,
             COALESCE(SUM(gift_count), 0) AS gift_count
      FROM daily
    ),
    top_gifts AS (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object('giftId', g.id, 'name', g.name, 'count', t.cnt, 'revenue', t.revenue)
        ORDER BY t.cnt DESC
      ), '[]'::jsonb) AS items
      FROM (
        SELECT gift_id, COUNT(*) AS cnt, SUM(coins_spent) AS revenue
        FROM public.gift_transactions
        WHERE created_at >= NOW() - INTERVAL '90 days'
        GROUP BY gift_id ORDER BY cnt DESC LIMIT 10
      ) t
      JOIN public.gifts g ON g.id = t.gift_id
    ),
    top_senders AS (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object('userId', u.id, 'name', COALESCE(u.full_name, u.name, 'User'),
          'count', s.cnt, 'coinsSpent', s.spent)
        ORDER BY s.spent DESC
      ), '[]'::jsonb) AS items
      FROM (
        SELECT sender_user_id, COUNT(*) AS cnt, SUM(coins_spent) AS spent
        FROM public.gift_transactions
        WHERE created_at >= NOW() - INTERVAL '90 days'
        GROUP BY sender_user_id ORDER BY spent DESC LIMIT 10
      ) s
      JOIN public.users u ON u.id = s.sender_user_id
    ),
    top_creators AS (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object('creatorProfileId', cp.id, 'creatorUserId', cp.user_id,
          'count', c.cnt, 'earnings', c.earned)
        ORDER BY c.earned DESC
      ), '[]'::jsonb) AS items
      FROM (
        SELECT creator_id, COUNT(*) AS cnt, SUM(creator_coins) AS earned
        FROM public.gift_transactions
        WHERE created_at >= NOW() - INTERVAL '90 days'
        GROUP BY creator_id ORDER BY earned DESC LIMIT 10
      ) c
      JOIN public.creator_profiles cp ON cp.id = c.creator_id
    )
    SELECT jsonb_build_object(
      'todayRevenue', COALESCE((SELECT revenue FROM today), 0),
      'weekRevenue', COALESCE((SELECT revenue FROM week), 0),
      'monthRevenue', COALESCE((SELECT revenue FROM month), 0),
      'lifetimeRevenue', COALESCE((SELECT revenue FROM lifetime), 0),
      'giftCount', COALESCE((SELECT gift_count FROM lifetime), 0),
      'platformRevenue', jsonb_build_object(
        'today', COALESCE((SELECT platform FROM today), 0),
        'week', COALESCE((SELECT platform FROM week), 0),
        'month', COALESCE((SELECT platform FROM month), 0),
        'lifetime', COALESCE((SELECT platform FROM lifetime), 0)
      ),
      'creatorEarnings', jsonb_build_object(
        'today', COALESCE((SELECT creator FROM today), 0),
        'week', COALESCE((SELECT creator FROM week), 0),
        'month', COALESCE((SELECT creator FROM month), 0),
        'lifetime', COALESCE((SELECT creator FROM lifetime), 0)
      ),
      'topGifts', COALESCE((SELECT items FROM top_gifts), '[]'::jsonb),
      'topSenders', COALESCE((SELECT items FROM top_senders), '[]'::jsonb),
      'topReceivingCreators', COALESCE((SELECT items FROM top_creators), '[]'::jsonb)
    )
  );
END;
$$;

-- ── P1/P2: Hardened send_gift RPC ───────────────────────────────────────────
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

  IF p_idempotency_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'idempotency_key_invalid';
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
    'sender_name', COALESCE(u.full_name, u.name, 'User'),
    'sender_avatar', COALESCE(u.avatar_url, u.profile_image),
    'creator_user_id', p_creator_user_id,
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

  PERFORM pg_advisory_xact_lock(hashtext(p_sender_user_id::text || ':' || p_call_id::text));

  SELECT id, coins, status, name, full_name, profile_image, avatar_url
    INTO v_sender FROM public.users
   WHERE id = p_sender_user_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'sender_not_found'; END IF;
  IF v_sender.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'sender_not_active'; END IF;

  SELECT id, name, coin_cost, creator_share_percent, platform_share_percent, is_active
    INTO v_gift FROM public.gifts
   WHERE id = p_gift_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'gift_not_found'; END IF;
  IF NOT v_gift.is_active THEN RAISE EXCEPTION 'gift_disabled'; END IF;

  SELECT id, caller_id, creator_id, status
    INTO v_call FROM public.calls
   WHERE id = p_call_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'call_not_found'; END IF;
  IF v_call.status IS DISTINCT FROM 'ongoing' THEN RAISE EXCEPTION 'call_not_active'; END IF;
  IF v_call.creator_id IS DISTINCT FROM p_creator_user_id THEN RAISE EXCEPTION 'call_creator_mismatch'; END IF;
  IF v_call.caller_id IS DISTINCT FROM p_sender_user_id THEN RAISE EXCEPTION 'call_sender_mismatch'; END IF;

  SELECT id, status, is_creator
    INTO v_creator_user FROM public.users WHERE id = p_creator_user_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'creator_not_found'; END IF;
  IF COALESCE(v_creator_user.is_creator, false) IS NOT TRUE THEN RAISE EXCEPTION 'creator_not_approved'; END IF;
  IF v_creator_user.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'creator_suspended'; END IF;

  SELECT cp.id, cp.user_id, cp.is_online, cp.online_status, cp.last_seen_at
    INTO v_creator_profile FROM public.creator_profiles cp
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

  PERFORM public.increment_creator_wallet(v_wallet_key, v_creator_coins::NUMERIC);
  v_wallet_after := v_wallet_before + v_creator_coins;

  INSERT INTO public.creator_transactions (
    creator_id, type, amount, balance_before, balance_after, reference_id
  ) VALUES (
    v_creator_profile.user_id, 'gift_earning', v_creator_coins,
    v_wallet_before, v_wallet_after, v_txn_id
  );

  UPDATE public.creator_wallets
     SET gift_earnings_total = gift_earnings_total + v_creator_coins, updated_at = v_now
   WHERE creator_id = v_wallet_key;

  IF NOT FOUND THEN
    INSERT INTO public.creator_wallets (
      creator_id, total_earned, available_balance, withdrawn_amount,
      gift_earnings_total, call_earnings_total, created_at, updated_at
    ) VALUES (
      v_wallet_key, v_creator_coins, v_creator_coins, 0, v_creator_coins, 0, v_now, v_now
    );
  END IF;

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

  -- Audit-only row (not published to realtime; delivery via FCM from NestJS)
  INSERT INTO public.gift_realtime_events (event_type, payload)
  VALUES ('gift_received', jsonb_build_object(
    'giftTransactionId', v_txn_id, 'senderId', p_sender_user_id,
    'senderName', v_sender_name, 'senderAvatar', v_sender_avatar,
    'creatorId', v_creator_profile.id, 'creatorUserId', p_creator_user_id,
    'giftName', v_gift.name, 'giftCoins', v_gift.coin_cost,
    'creatorCoins', v_creator_coins, 'createdAt', v_now
  ));

  RETURN jsonb_build_object(
    'success', true,
    'remaining_balance', v_balance_after,
    'gift_name', v_gift.name,
    'coins_spent', v_gift.coin_cost,
    'creator_coins', v_creator_coins,
    'platform_coins', v_platform_coins,
    'gift_transaction_id', v_txn_id,
    'sender_name', v_sender_name,
    'sender_avatar', v_sender_avatar,
    'creator_user_id', p_creator_user_id,
    'duplicate', false
  );

EXCEPTION
  WHEN unique_violation THEN
    SELECT jsonb_build_object(
      'success', true, 'remaining_balance', u.coins, 'gift_name', g.name,
      'coins_spent', gt.coins_spent, 'creator_coins', gt.creator_coins,
      'platform_coins', gt.platform_coins, 'gift_transaction_id', gt.id,
      'sender_name', COALESCE(u.full_name, u.name, 'User'),
      'sender_avatar', COALESCE(u.avatar_url, u.profile_image),
      'creator_user_id', p_creator_user_id, 'duplicate', true
    )
    INTO v_existing
    FROM public.gift_transactions gt
    JOIN public.gifts g ON g.id = gt.gift_id
    JOIN public.users u ON u.id = gt.sender_user_id
    WHERE gt.sender_user_id = p_sender_user_id
      AND gt.idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
    RAISE;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_gift_transactions_created_coins
  ON public.gift_transactions (created_at DESC, coins_spent, platform_coins, creator_coins);

COMMIT;
