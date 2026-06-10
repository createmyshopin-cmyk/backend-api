-- Phase 3.3B Sprint 2: Daily Missions + Streak Rewards

-- ── Extend xp_events source types ──────────────────────────────
ALTER TABLE public.xp_events DROP CONSTRAINT IF EXISTS xp_events_source_type_check;
ALTER TABLE public.xp_events ADD CONSTRAINT xp_events_source_type_check
  CHECK (source_type IN (
    'call_completed', 'gift_sent', 'gift_received', 'creator_followed',
    'favorite_added', 'daily_login', 'follower_gained', 'admin',
    'mission', 'streak'
  ));

-- ── daily_missions catalog (L2) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_missions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_key   TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  mission_type  TEXT NOT NULL CHECK (mission_type IN (
    'login', 'call', 'gift', 'follow', 'favorite', 'recharge'
  )),
  target_count  INT NOT NULL DEFAULT 1 CHECK (target_count > 0),
  reward_xp     INT NOT NULL DEFAULT 0 CHECK (reward_xp >= 0),
  reward_coins  INT NOT NULL DEFAULT 0 CHECK (reward_coins >= 0),
  valid_from    DATE NOT NULL DEFAULT '2020-01-01',
  valid_to      DATE NOT NULL DEFAULT '2099-12-31',
  sort_order    INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_missions_key_active
  ON public.daily_missions (mission_key)
  WHERE is_active = TRUE;

-- ── mission_progress (L2) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mission_progress (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  daily_mission_id    UUID NOT NULL REFERENCES public.daily_missions(id) ON DELETE RESTRICT,
  mission_date        DATE NOT NULL,
  progress_count      INT NOT NULL DEFAULT 0 CHECK (progress_count >= 0),
  target_count        INT NOT NULL CHECK (target_count > 0),
  status              TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN (
    'in_progress', 'completed', 'claimed'
  )),
  completed_at        TIMESTAMPTZ,
  claimed_at          TIMESTAMPTZ,
  reward_xp_event_id  UUID REFERENCES public.xp_events(id) ON DELETE SET NULL,
  reward_coin_txn_id  UUID,
  idempotency_key     TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mission_progress_user_mission_date
  ON public.mission_progress (user_id, daily_mission_id, mission_date);

CREATE INDEX IF NOT EXISTS idx_mission_progress_user_date
  ON public.mission_progress (user_id, mission_date DESC);

-- ── user_streaks (L2 projection) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_streaks (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  current_streak          INT NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  longest_streak          INT NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
  last_qualifying_date    DATE,
  grace_tokens_used       INT NOT NULL DEFAULT 0 CHECK (grace_tokens_used >= 0),
  grace_period_reset_at   DATE NOT NULL DEFAULT CURRENT_DATE,
  streak_cycle_id         UUID NOT NULL DEFAULT gen_random_uuid(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── streak milestones catalog ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.streak_milestones (
  milestone_day INT PRIMARY KEY CHECK (milestone_day > 0),
  reward_xp     INT NOT NULL DEFAULT 0 CHECK (reward_xp >= 0),
  reward_coins  INT NOT NULL DEFAULT 0 CHECK (reward_coins >= 0),
  title         TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

-- ── streak_milestone_claims (L2 append-only evidence) ────────────
CREATE TABLE IF NOT EXISTS public.streak_milestone_claims (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  milestone_day       INT NOT NULL REFERENCES public.streak_milestones(milestone_day),
  streak_cycle_id     UUID NOT NULL,
  current_streak      INT NOT NULL,
  reward_xp_event_id  UUID REFERENCES public.xp_events(id) ON DELETE SET NULL,
  reward_coin_txn_id  UUID,
  idempotency_key     TEXT NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_streak_claim_user_milestone_cycle
  ON public.streak_milestone_claims (user_id, milestone_day, streak_cycle_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_streak_claim_idempotency
  ON public.streak_milestone_claims (user_id, idempotency_key);

-- ── engagement_reward_events (L2 unified reward evidence) ────────
CREATE TABLE IF NOT EXISTS public.engagement_reward_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reward_type         TEXT NOT NULL CHECK (reward_type IN ('mission', 'streak')),
  source_id           UUID NOT NULL,
  xp_amount           INT NOT NULL DEFAULT 0,
  coins_amount        INT NOT NULL DEFAULT 0,
  xp_event_id         UUID REFERENCES public.xp_events(id) ON DELETE SET NULL,
  coin_transaction_id UUID,
  idempotency_key     TEXT NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_engagement_reward_idempotency
  ON public.engagement_reward_events (user_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_engagement_reward_user_created
  ON public.engagement_reward_events (user_id, created_at DESC);

-- ── mission progress idempotency (anti double-count) ─────────────
CREATE TABLE IF NOT EXISTS public.mission_progress_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_progress_id UUID NOT NULL REFERENCES public.mission_progress(id) ON DELETE CASCADE,
  source_id        UUID,
  idempotency_key  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mission_progress_event_idempotency
  ON public.mission_progress_events (mission_progress_id, idempotency_key);

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE public.daily_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streak_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streak_milestone_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_reward_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_progress_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_missions_deny_clients ON public.daily_missions;
CREATE POLICY daily_missions_deny_clients ON public.daily_missions
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS mission_progress_deny_clients ON public.mission_progress;
CREATE POLICY mission_progress_deny_clients ON public.mission_progress
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS user_streaks_deny_clients ON public.user_streaks;
CREATE POLICY user_streaks_deny_clients ON public.user_streaks
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS streak_milestones_deny_clients ON public.streak_milestones;
CREATE POLICY streak_milestones_deny_clients ON public.streak_milestones
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS streak_milestone_claims_deny_clients ON public.streak_milestone_claims;
CREATE POLICY streak_milestone_claims_deny_clients ON public.streak_milestone_claims
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS engagement_reward_events_deny_clients ON public.engagement_reward_events;
CREATE POLICY engagement_reward_events_deny_clients ON public.engagement_reward_events
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS mission_progress_events_deny_clients ON public.mission_progress_events;
CREATE POLICY mission_progress_events_deny_clients ON public.mission_progress_events
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ── Policy settings ────────────────────────────────────────────
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS engagement_daily_reward_budget_coins INT NOT NULL DEFAULT 10000;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS engagement_max_daily_missions INT NOT NULL DEFAULT 3;

-- ── Seed missions ──────────────────────────────────────────────
INSERT INTO public.daily_missions (
  mission_key, title, description, mission_type, target_count, reward_xp, reward_coins, sort_order
)
SELECT v.mission_key, v.title, v.description, v.mission_type, v.target_count, v.reward_xp, v.reward_coins, v.sort_order
FROM (VALUES
  ('daily_login', 'Daily login', 'Open the app today', 'login', 1, 10, 0, 1),
  ('complete_call', 'Complete a call', 'Finish a voice or video call', 'call', 1, 20, 5, 2),
  ('send_gift', 'Send a gift', 'Send a gift to a creator', 'gift', 1, 15, 0, 3),
  ('follow_creator', 'Follow a creator', 'Follow someone new', 'follow', 1, 10, 0, 4),
  ('favorite_creator', 'Favorite a creator', 'Add a creator to favorites', 'favorite', 1, 10, 0, 5),
  ('recharge_wallet', 'Recharge wallet', 'Top up your coin balance', 'recharge', 1, 25, 10, 6)
) AS v(mission_key, title, description, mission_type, target_count, reward_xp, reward_coins, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.daily_missions dm WHERE dm.mission_key = v.mission_key
);

INSERT INTO public.streak_milestones (milestone_day, reward_xp, reward_coins, title) VALUES
  (1, 5, 0, 'Day 1'),
  (3, 20, 0, '3-Day Streak'),
  (7, 50, 10, 'Week Warrior'),
  (30, 100, 25, 'Monthly Master'),
  (90, 200, 50, 'Quarter Champion'),
  (365, 500, 100, 'Year Legend')
ON CONFLICT (milestone_day) DO NOTHING;

-- ── Extend adjust_user_coins_v2 for engagement rewards ─────────
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

  IF p_source_type NOT IN (
    'payment', 'call', 'gift', 'admin_adjust', 'refund',
    'mission_reward', 'streak_reward'
  ) THEN
    RAISE EXCEPTION 'invalid_source_type: %', p_source_type;
  END IF;

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

  INSERT INTO public.wallets (user_id, coin_balance)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet
    FROM public.wallets
   WHERE user_id = p_user_id
     FOR UPDATE;

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
    WHEN p_source_type = 'mission_reward' THEN 'mission_reward'
    WHEN p_source_type = 'streak_reward' THEN 'streak_reward'
    ELSE 'admin_adjustment_add'
  END;

  INSERT INTO public.coin_transactions (
    user_id, type, amount, balance_before, balance_after,
    reference_id, reference_type, idempotency_key, admin_id, description
  ) VALUES (
    p_user_id, v_tx_type, v_delta, v_balance_before, v_balance_after,
    p_source_id, p_source_type, p_idempotency_key, p_admin_id,
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
END;
$$;

-- ── Helpers ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.engagement_mission_date_utc()
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$ SELECT (NOW() AT TIME ZONE 'UTC')::DATE; $$;

CREATE OR REPLACE FUNCTION public.engagement_daily_coin_spent(p_user_id UUID, p_mission_date DATE)
RETURNS INT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(coins_amount), 0)::INT
    FROM public.engagement_reward_events
   WHERE user_id = p_user_id
     AND coins_amount > 0
     AND created_at::DATE = p_mission_date;
$$;

CREATE OR REPLACE FUNCTION public.engagement_coin_budget_remaining(p_user_id UUID, p_mission_date DATE)
RETURNS INT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_budget INT;
  v_spent INT;
BEGIN
  SELECT COALESCE(engagement_daily_reward_budget_coins, 10000)
    INTO v_budget
    FROM public.app_settings
   LIMIT 1;

  v_spent := public.engagement_daily_coin_spent(p_user_id, p_mission_date);
  RETURN GREATEST(v_budget - v_spent, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_engagement_coins(
  p_user_id UUID,
  p_coins INT,
  p_source_type TEXT,
  p_source_id UUID,
  p_idempotency_key TEXT,
  p_mission_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining INT;
  v_grant INT;
  v_result public.user_wallet_result;
BEGIN
  IF p_coins IS NULL OR p_coins <= 0 THEN
    RETURN NULL;
  END IF;

  v_remaining := public.engagement_coin_budget_remaining(p_user_id, p_mission_date);
  IF v_remaining <= 0 THEN
    RAISE EXCEPTION 'reward_budget_exceeded' USING ERRCODE = 'P0001';
  END IF;

  v_grant := LEAST(p_coins, v_remaining);

  v_result := public.adjust_user_coins_v2(
    p_user_id, v_grant, p_source_type, p_source_id, p_idempotency_key, FALSE, NULL
  );

  RETURN v_result.coin_transaction_id;
END;
$$;

-- ── Ensure daily mission assignments ───────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_daily_missions_for_user(
  p_user_id UUID,
  p_mission_date DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := COALESCE(p_mission_date, public.engagement_mission_date_utc());
  v_max INT;
  v_mission public.daily_missions%ROWTYPE;
  v_pool UUID[];
  v_idx INT;
  v_pick UUID;
BEGIN
  SELECT COALESCE(engagement_max_daily_missions, 3) INTO v_max
    FROM public.app_settings LIMIT 1;

  -- Always assign daily_login first
  SELECT * INTO v_mission FROM public.daily_missions
   WHERE mission_key = 'daily_login' AND is_active = TRUE
   LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.mission_progress (
      user_id, daily_mission_id, mission_date, target_count, idempotency_key
    ) VALUES (
      p_user_id, v_mission.id, v_date, v_mission.target_count,
      'assign:' || p_user_id::TEXT || ':' || v_mission.id::TEXT || ':' || v_date::TEXT
    )
    ON CONFLICT (user_id, daily_mission_id, mission_date) DO NOTHING;
  END IF;

  SELECT ARRAY_AGG(id ORDER BY sort_order)
    INTO v_pool
    FROM public.daily_missions
   WHERE is_active = TRUE
     AND mission_key <> 'daily_login'
     AND v_date BETWEEN valid_from AND valid_to;

  IF v_pool IS NULL OR array_length(v_pool, 1) = 0 THEN
    RETURN;
  END IF;

  v_idx := 0;
  WHILE v_idx < LEAST(v_max - 1, array_length(v_pool, 1)) LOOP
    v_pick := v_pool[1 + ((hashtext(v_date::TEXT || ':' || p_user_id::TEXT) + v_idx) % array_length(v_pool, 1))];
    SELECT * INTO v_mission FROM public.daily_missions WHERE id = v_pick;

    INSERT INTO public.mission_progress (
      user_id, daily_mission_id, mission_date, target_count, idempotency_key
    ) VALUES (
      p_user_id, v_mission.id, v_date, v_mission.target_count,
      'assign:' || p_user_id::TEXT || ':' || v_mission.id::TEXT || ':' || v_date::TEXT
    )
    ON CONFLICT (user_id, daily_mission_id, mission_date) DO NOTHING;

    v_idx := v_idx + 1;
  END LOOP;
END;
$$;

-- ── Streak qualifying day ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_streak_qualifying_day(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := public.engagement_mission_date_utc();
  v_row public.user_streaks%ROWTYPE;
  v_yesterday DATE := v_today - 1;
  v_gap INT;
BEGIN
  INSERT INTO public.user_streaks (user_id, current_streak, longest_streak)
  VALUES (p_user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row FROM public.user_streaks WHERE user_id = p_user_id FOR UPDATE;

  IF v_row.last_qualifying_date = v_today THEN
    RETURN jsonb_build_object('current_streak', v_row.current_streak, 'updated', false);
  END IF;

  IF v_row.last_qualifying_date IS NULL THEN
    v_row.current_streak := 1;
  ELSIF v_row.last_qualifying_date = v_yesterday THEN
    v_row.current_streak := v_row.current_streak + 1;
  ELSE
    v_gap := v_today - v_row.last_qualifying_date;
    IF v_today - COALESCE(v_row.grace_period_reset_at, v_today) >= 30 THEN
      v_row.grace_tokens_used := 0;
      v_row.grace_period_reset_at := v_today;
    END IF;
    IF v_gap = 2 AND v_row.grace_tokens_used < 1 THEN
      v_row.grace_tokens_used := v_row.grace_tokens_used + 1;
      v_row.current_streak := v_row.current_streak + 1;
    ELSE
      v_row.current_streak := 1;
      v_row.streak_cycle_id := gen_random_uuid();
    END IF;
  END IF;

  v_row.longest_streak := GREATEST(v_row.longest_streak, v_row.current_streak);
  v_row.last_qualifying_date := v_today;
  v_row.updated_at := NOW();

  UPDATE public.user_streaks SET
    current_streak = v_row.current_streak,
    longest_streak = v_row.longest_streak,
    last_qualifying_date = v_row.last_qualifying_date,
    grace_tokens_used = v_row.grace_tokens_used,
    grace_period_reset_at = v_row.grace_period_reset_at,
    streak_cycle_id = v_row.streak_cycle_id,
    updated_at = v_row.updated_at
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'current_streak', v_row.current_streak,
    'longest_streak', v_row.longest_streak,
    'updated', true
  );
END;
$$;

-- ── Increment mission progress ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_mission_progress(
  p_user_id UUID,
  p_mission_key TEXT,
  p_source_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := public.engagement_mission_date_utc();
  v_mission public.daily_missions%ROWTYPE;
  v_progress public.mission_progress%ROWTYPE;
  v_event_key TEXT;
BEGIN
  PERFORM public.ensure_daily_missions_for_user(p_user_id, v_date);

  SELECT * INTO v_mission FROM public.daily_missions
   WHERE mission_key = p_mission_key AND is_active = TRUE
     AND v_date BETWEEN valid_from AND valid_to
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('incremented', false, 'reason', 'mission_not_active');
  END IF;

  SELECT * INTO v_progress
    FROM public.mission_progress
   WHERE user_id = p_user_id
     AND daily_mission_id = v_mission.id
     AND mission_date = v_date
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('incremented', false, 'reason', 'not_assigned');
  END IF;

  IF v_progress.status = 'claimed' THEN
    RETURN jsonb_build_object('incremented', false, 'reason', 'already_claimed');
  END IF;

  v_event_key := COALESCE(
    p_idempotency_key,
    p_mission_key || ':' || v_date::TEXT || ':' || COALESCE(p_source_id::TEXT, 'none')
  );

  BEGIN
    INSERT INTO public.mission_progress_events (mission_progress_id, source_id, idempotency_key)
    VALUES (v_progress.id, p_source_id, v_event_key);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('incremented', false, 'reason', 'duplicate_event', 'idempotent_replay', true);
  END;

  IF v_progress.status = 'in_progress' THEN
    v_progress.progress_count := v_progress.progress_count + 1;
    IF v_progress.progress_count >= v_progress.target_count THEN
      v_progress.status := 'completed';
      v_progress.completed_at := NOW();
    END IF;
    v_progress.updated_at := NOW();

    UPDATE public.mission_progress SET
      progress_count = v_progress.progress_count,
      status = v_progress.status,
      completed_at = v_progress.completed_at,
      updated_at = v_progress.updated_at
    WHERE id = v_progress.id;
  END IF;

  PERFORM public.record_streak_qualifying_day(p_user_id);

  RETURN jsonb_build_object(
    'incremented', true,
    'mission_progress_id', v_progress.id,
    'progress', v_progress.progress_count,
    'target', v_progress.target_count,
    'status', v_progress.status
  );
END;
$$;

-- ── Mission board + auto login progress ────────────────────────
CREATE OR REPLACE FUNCTION public.get_daily_missions_board(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := public.engagement_mission_date_utc();
  v_items JSONB;
BEGIN
  PERFORM public.ensure_daily_missions_for_user(p_user_id, v_date);
  PERFORM public.increment_mission_progress(p_user_id, 'daily_login', NULL, 'daily_login:' || v_date::TEXT);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', mp.id,
    'missionKey', dm.mission_key,
    'title', dm.title,
    'description', dm.description,
    'missionType', dm.mission_type,
    'progress', mp.progress_count,
    'target', mp.target_count,
    'status', mp.status,
    'rewardXp', dm.reward_xp,
    'rewardCoins', dm.reward_coins,
    'completedAt', mp.completed_at,
    'claimedAt', mp.claimed_at
  ) ORDER BY dm.sort_order), '[]'::JSONB)
  INTO v_items
  FROM public.mission_progress mp
  JOIN public.daily_missions dm ON dm.id = mp.daily_mission_id
  WHERE mp.user_id = p_user_id
    AND mp.mission_date = v_date;

  RETURN jsonb_build_object('missionDate', v_date, 'missions', v_items);
END;
$$;

-- ── Claim mission reward ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_mission_reward(
  p_user_id UUID,
  p_mission_progress_id UUID,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_progress public.mission_progress%ROWTYPE;
  v_mission public.daily_missions%ROWTYPE;
  v_xp JSONB;
  v_coin_txn UUID;
  v_reward_id UUID;
  v_existing UUID;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_existing
    FROM public.engagement_reward_events
   WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'claimed', 'idempotent_replay', true);
  END IF;

  SELECT * INTO v_progress FROM public.mission_progress
   WHERE id = p_mission_progress_id AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mission_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_progress.status = 'claimed' THEN
    RETURN jsonb_build_object('status', 'claimed', 'idempotent_replay', true);
  END IF;

  IF v_progress.status <> 'completed' THEN
    RAISE EXCEPTION 'mission_not_completed' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_mission FROM public.daily_missions WHERE id = v_progress.daily_mission_id;

  IF v_mission.reward_xp > 0 THEN
    v_xp := public.grant_xp(
      'user', p_user_id, v_mission.reward_xp, 'mission', v_progress.id,
      'mission_reward:' || v_progress.id::TEXT,
      jsonb_build_object('mission_key', v_mission.mission_key)
    );
  END IF;

  IF v_mission.reward_coins > 0 THEN
    v_coin_txn := public.grant_engagement_coins(
      p_user_id, v_mission.reward_coins, 'mission_reward', v_progress.id,
      'mission_coins:' || v_progress.id::TEXT, v_progress.mission_date
    );
  END IF;

  INSERT INTO public.engagement_reward_events (
    user_id, reward_type, source_id, xp_amount, coins_amount,
    xp_event_id, coin_transaction_id, idempotency_key, metadata
  ) VALUES (
    p_user_id, 'mission', v_progress.id, v_mission.reward_xp, v_mission.reward_coins,
    (v_xp->>'xp_event_id')::UUID, v_coin_txn, p_idempotency_key,
    jsonb_build_object('mission_key', v_mission.mission_key)
  )
  RETURNING id INTO v_reward_id;

  UPDATE public.mission_progress SET
    status = 'claimed',
    claimed_at = NOW(),
    reward_xp_event_id = (v_xp->>'xp_event_id')::UUID,
    reward_coin_txn_id = v_coin_txn,
    updated_at = NOW()
  WHERE id = v_progress.id;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'rewardId', v_reward_id,
    'xpGranted', v_mission.reward_xp,
    'coinsGranted', COALESCE(v_mission.reward_coins, 0),
    'newLevel', (v_xp->>'level')::INT
  );
END;
$$;

-- ── Streak snapshot ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_streak_snapshot(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.user_streaks%ROWTYPE;
  v_milestones JSONB;
  v_next INT;
BEGIN
  INSERT INTO public.user_streaks (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row FROM public.user_streaks WHERE user_id = p_user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'milestoneDay', sm.milestone_day,
    'title', sm.title,
    'rewardXp', sm.reward_xp,
    'rewardCoins', sm.reward_coins,
    'reached', v_row.current_streak >= sm.milestone_day,
    'claimed', EXISTS (
      SELECT 1 FROM public.streak_milestone_claims c
       WHERE c.user_id = p_user_id
         AND c.milestone_day = sm.milestone_day
         AND c.streak_cycle_id = v_row.streak_cycle_id
    )
  ) ORDER BY sm.milestone_day), '[]'::JSONB)
  INTO v_milestones
  FROM public.streak_milestones sm
  WHERE sm.is_active = TRUE;

  SELECT MIN(sm.milestone_day) INTO v_next
    FROM public.streak_milestones sm
   WHERE sm.is_active = TRUE
     AND sm.milestone_day > v_row.current_streak;

  RETURN jsonb_build_object(
    'currentStreak', COALESCE(v_row.current_streak, 0),
    'longestStreak', COALESCE(v_row.longest_streak, 0),
    'lastQualifyingDate', v_row.last_qualifying_date,
    'graceTokensRemaining', GREATEST(1 - COALESCE(v_row.grace_tokens_used, 0), 0),
    'nextMilestoneDay', v_next,
    'milestones', v_milestones
  );
END;
$$;

-- ── Claim streak milestone ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_streak_milestone(
  p_user_id UUID,
  p_milestone_day INT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.user_streaks%ROWTYPE;
  v_milestone public.streak_milestones%ROWTYPE;
  v_xp JSONB;
  v_coin_txn UUID;
  v_claim_id UUID;
  v_reward_id UUID;
  v_date DATE;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row FROM public.user_streaks WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_row.current_streak < p_milestone_day THEN
    RAISE EXCEPTION 'milestone_not_reached' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_milestone FROM public.streak_milestones
   WHERE milestone_day = p_milestone_day AND is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'milestone_not_found' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.streak_milestone_claims (
      user_id, milestone_day, streak_cycle_id, current_streak,
      idempotency_key, metadata
    ) VALUES (
      p_user_id, p_milestone_day, v_row.streak_cycle_id, v_row.current_streak,
      p_idempotency_key,
      jsonb_build_object('milestone_day', p_milestone_day)
    )
    RETURNING id INTO v_claim_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'claimed', 'idempotent_replay', true);
  END;

  v_date := public.engagement_mission_date_utc();

  IF v_milestone.reward_xp > 0 THEN
    v_xp := public.grant_xp(
      'user', p_user_id, v_milestone.reward_xp, 'streak', v_claim_id,
      'streak_reward:' || v_claim_id::TEXT,
      jsonb_build_object('milestone_day', p_milestone_day)
    );
  END IF;

  IF v_milestone.reward_coins > 0 THEN
    v_coin_txn := public.grant_engagement_coins(
      p_user_id, v_milestone.reward_coins, 'streak_reward', v_claim_id,
      'streak_coins:' || v_claim_id::TEXT, v_date
    );
  END IF;

  UPDATE public.streak_milestone_claims SET
    reward_xp_event_id = (v_xp->>'xp_event_id')::UUID,
    reward_coin_txn_id = v_coin_txn
  WHERE id = v_claim_id;

  INSERT INTO public.engagement_reward_events (
    user_id, reward_type, source_id, xp_amount, coins_amount,
    xp_event_id, coin_transaction_id, idempotency_key, metadata
  ) VALUES (
    p_user_id, 'streak', v_claim_id, v_milestone.reward_xp, v_milestone.reward_coins,
    (v_xp->>'xp_event_id')::UUID, v_coin_txn, p_idempotency_key,
    jsonb_build_object('milestone_day', p_milestone_day)
  )
  RETURNING id INTO v_reward_id;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'milestoneDay', p_milestone_day,
    'rewardId', v_reward_id,
    'xpGranted', v_milestone.reward_xp,
    'coinsGranted', v_milestone.reward_coins
  );
END;
$$;

-- ── Reward history ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_engagement_rewards(
  p_user_id UUID,
  p_limit INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_items JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.created_at DESC), '[]'::JSONB)
    INTO v_items
    FROM (
      SELECT id, reward_type AS "rewardType", source_id AS "sourceId",
             xp_amount AS "xpAmount", coins_amount AS "coinsAmount",
             metadata, created_at AS "createdAt"
        FROM public.engagement_reward_events
       WHERE user_id = p_user_id
       ORDER BY created_at DESC
       LIMIT v_limit
    ) t;

  RETURN jsonb_build_object('items', v_items);
END;
$$;

-- ── Patch follow/favorite RPCs for mission hooks ───────────────
CREATE OR REPLACE FUNCTION public.follow_creator(
  p_follower_user_id UUID,
  p_creator_profile_id UUID,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator_user_id UUID;
  v_creator_status TEXT;
  v_row public.follows%ROWTYPE;
  v_key TEXT;
  v_xp JSONB;
  v_creator_xp JSONB;
  v_reactivated BOOLEAN := false;
  v_replay BOOLEAN := false;
BEGIN
  IF p_follower_user_id IS NULL OR p_creator_profile_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'P0001';
  END IF;

  SELECT cp.user_id, cp.status INTO v_creator_user_id, v_creator_status
    FROM public.creator_profiles cp WHERE cp.id = p_creator_profile_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'creator_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_creator_user_id = p_follower_user_id THEN RAISE EXCEPTION 'cannot_follow_self' USING ERRCODE = 'P0001'; END IF;
  IF v_creator_status IN ('suspended', 'rejected', 'pending') THEN RAISE EXCEPTION 'creator_not_followable' USING ERRCODE = 'P0001'; END IF;

  v_key := COALESCE(p_idempotency_key, 'follow:' || p_follower_user_id::TEXT || ':' || p_creator_profile_id::TEXT);

  SELECT * INTO v_row FROM public.follows
   WHERE follower_user_id = p_follower_user_id AND creator_profile_id = p_creator_profile_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_row.unfollowed_at IS NULL THEN
      v_replay := true;
      RETURN jsonb_build_object('following', true, 'followed_at', v_row.followed_at,
        'creator_profile_id', p_creator_profile_id, 'idempotent_replay', true);
    END IF;
    UPDATE public.follows SET unfollowed_at = NULL, followed_at = NOW()
     WHERE id = v_row.id RETURNING * INTO v_row;
    v_reactivated := true;
  ELSE
    INSERT INTO public.follows (follower_user_id, creator_profile_id)
    VALUES (p_follower_user_id, p_creator_profile_id) RETURNING * INTO v_row;
  END IF;

  v_xp := public.grant_xp('user', p_follower_user_id, 10, 'creator_followed', v_row.id,
    'creator_followed:' || v_row.id::TEXT, jsonb_build_object('creator_profile_id', p_creator_profile_id));
  v_creator_xp := public.grant_xp('creator', p_creator_profile_id, 5, 'follower_gained', v_row.id,
    'follower_gained:' || v_row.id::TEXT, jsonb_build_object('follower_user_id', p_follower_user_id));

  IF NOT v_replay THEN
    PERFORM public.increment_mission_progress(
      p_follower_user_id, 'follow_creator', v_row.id, 'mission_follow:' || v_row.id::TEXT);
  END IF;

  RETURN jsonb_build_object('following', true, 'followed_at', v_row.followed_at,
    'creator_profile_id', p_creator_profile_id, 'idempotent_replay', false,
    'user_xp', v_xp, 'creator_xp', v_creator_xp);
END;
$$;

CREATE OR REPLACE FUNCTION public.favorite_creator(
  p_user_id UUID,
  p_creator_profile_id UUID,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_count INT;
  v_creator_status TEXT;
  v_row public.favorites%ROWTYPE;
  v_exists BOOLEAN := false;
  v_follow JSONB;
  v_xp JSONB;
  v_replay BOOLEAN := false;
BEGIN
  SELECT cp.status INTO v_creator_status FROM public.creator_profiles cp WHERE cp.id = p_creator_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'creator_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_creator_status IN ('suspended', 'rejected', 'pending') THEN RAISE EXCEPTION 'creator_not_followable' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_row FROM public.favorites
   WHERE user_id = p_user_id AND creator_profile_id = p_creator_profile_id FOR UPDATE;
  v_exists := FOUND;

  IF v_exists AND v_row.unfavorited_at IS NULL THEN
    RETURN jsonb_build_object('favorited', true, 'favorited_at', v_row.favorited_at,
      'creator_profile_id', p_creator_profile_id, 'idempotent_replay', true);
  END IF;

  IF NOT v_exists THEN
    SELECT COUNT(*)::INT INTO v_active_count FROM public.favorites
     WHERE user_id = p_user_id AND unfavorited_at IS NULL;
    IF v_active_count >= 50 THEN RAISE EXCEPTION 'favorite_limit_reached' USING ERRCODE = 'P0001'; END IF;
    INSERT INTO public.favorites (user_id, creator_profile_id)
    VALUES (p_user_id, p_creator_profile_id) RETURNING * INTO v_row;
  ELSE
    UPDATE public.favorites SET unfavorited_at = NULL, favorited_at = NOW()
     WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;

  v_follow := public.follow_creator(p_user_id, p_creator_profile_id,
    COALESCE(p_idempotency_key, 'favorite_follow:' || p_user_id::TEXT || ':' || p_creator_profile_id::TEXT));
  v_xp := public.grant_xp('user', p_user_id, 5, 'favorite_added', v_row.id,
    'favorite_added:' || v_row.id::TEXT, jsonb_build_object('creator_profile_id', p_creator_profile_id));

  PERFORM public.increment_mission_progress(
    p_user_id, 'favorite_creator', v_row.id, 'mission_favorite:' || v_row.id::TEXT);

  RETURN jsonb_build_object('favorited', true, 'favorited_at', v_row.favorited_at,
    'creator_profile_id', p_creator_profile_id, 'following', true, 'follow', v_follow,
    'user_xp', v_xp, 'idempotent_replay', false);
END;
$$;

-- ── RPC permissions ────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.increment_mission_progress FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_daily_missions_for_user FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_daily_missions_board FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_mission_reward FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_streak_qualifying_day FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_streak_snapshot FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_streak_milestone FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_engagement_rewards FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_engagement_coins FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.increment_mission_progress TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_daily_missions_for_user TO service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_missions_board TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_mission_reward TO service_role;
GRANT EXECUTE ON FUNCTION public.record_streak_qualifying_day TO service_role;
GRANT EXECUTE ON FUNCTION public.get_streak_snapshot TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_streak_milestone TO service_role;
GRANT EXECUTE ON FUNCTION public.get_engagement_rewards TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_engagement_coins TO service_role;
