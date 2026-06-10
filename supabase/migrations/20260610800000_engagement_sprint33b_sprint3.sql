-- Phase 3.3B Sprint 3: Premium Gifts + Server Combos

BEGIN;

-- ── app_settings extensions ────────────────────────────────────
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS engagement_premium_gifts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS engagement_combo_window_ms INT NOT NULL DEFAULT 10000;

-- ── premium_gifts catalog (L2) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.premium_gifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_id         UUID NOT NULL REFERENCES public.gifts(id) ON DELETE RESTRICT,
  campaign_key    TEXT NOT NULL DEFAULT 'default',
  display_tier    TEXT NOT NULL DEFAULT 'premium' CHECK (display_tier IN ('premium', 'legendary')),
  badge_label     TEXT NOT NULL DEFAULT 'Premium',
  visual_theme    TEXT NOT NULL DEFAULT 'gold',
  starts_at       TIMESTAMPTZ NOT NULL DEFAULT '2020-01-01'::TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ NOT NULL DEFAULT '2099-12-31'::TIMESTAMPTZ,
  sort_order      INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_premium_gifts_gift_active
  ON public.premium_gifts (gift_id)
  WHERE is_active = TRUE;

-- ── gift_combos (L2 evidence) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gift_combos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_group_id      UUID NOT NULL,
  gift_transaction_id UUID NOT NULL UNIQUE REFERENCES public.gift_transactions(id) ON DELETE RESTRICT,
  sender_user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  creator_profile_id  UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  gift_id             UUID NOT NULL REFERENCES public.gifts(id) ON DELETE RESTRICT,
  premium_gift_id     UUID REFERENCES public.premium_gifts(id) ON DELETE SET NULL,
  combo_index         INT NOT NULL CHECK (combo_index > 0),
  combo_window_ms     INT NOT NULL CHECK (combo_window_ms > 0),
  call_id             UUID NOT NULL REFERENCES public.calls(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gift_combos_group
  ON public.gift_combos (combo_group_id, combo_index);
CREATE INDEX IF NOT EXISTS idx_gift_combos_sender_created
  ON public.gift_combos (sender_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_combos_call_sender
  ON public.gift_combos (call_id, sender_user_id, gift_id, created_at DESC);

-- ── gift_combo_rewards catalog (L2) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.gift_combo_rewards (
  combo_multiplier INT PRIMARY KEY CHECK (combo_multiplier > 1),
  reward_xp        INT NOT NULL DEFAULT 0 CHECK (reward_xp >= 0),
  reward_coins     INT NOT NULL DEFAULT 0 CHECK (reward_coins >= 0),
  title            TEXT NOT NULL,
  badge_label      TEXT NOT NULL DEFAULT '',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE
);

-- ── combo_progress (L3 projection — rebuildable) ───────────────
CREATE TABLE IF NOT EXISTS public.combo_progress (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_group_id        UUID NOT NULL UNIQUE,
  user_id               UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  gift_id               UUID NOT NULL REFERENCES public.gifts(id) ON DELETE RESTRICT,
  creator_profile_id    UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  call_id               UUID NOT NULL REFERENCES public.calls(id) ON DELETE RESTRICT,
  current_combo_index   INT NOT NULL DEFAULT 0 CHECK (current_combo_index >= 0),
  highest_multiplier    INT NOT NULL DEFAULT 0,
  combo_window_ms       INT NOT NULL,
  window_expires_at     TIMESTAMPTZ NOT NULL,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_combo_progress_user_active
  ON public.combo_progress (user_id, is_active, updated_at DESC);

-- ── combo reward claims (L2 append-only evidence) ──────────────
CREATE TABLE IF NOT EXISTS public.gift_combo_reward_claims (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_group_id      UUID NOT NULL,
  combo_multiplier    INT NOT NULL REFERENCES public.gift_combo_rewards(combo_multiplier),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  gift_transaction_id UUID NOT NULL REFERENCES public.gift_transactions(id) ON DELETE RESTRICT,
  reward_xp_event_id  UUID REFERENCES public.xp_events(id) ON DELETE SET NULL,
  reward_coin_txn_id  UUID,
  idempotency_key     TEXT NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_combo_reward_claim_group_multiplier
  ON public.gift_combo_reward_claims (combo_group_id, combo_multiplier);
CREATE UNIQUE INDEX IF NOT EXISTS uq_combo_reward_claim_idempotency
  ON public.gift_combo_reward_claims (user_id, idempotency_key);

-- ── extend engagement_reward_events for combo ──────────────────
ALTER TABLE public.engagement_reward_events DROP CONSTRAINT IF EXISTS engagement_reward_events_reward_type_check;
ALTER TABLE public.engagement_reward_events ADD CONSTRAINT engagement_reward_events_reward_type_check
  CHECK (reward_type IN ('mission', 'streak', 'combo'));

ALTER TABLE public.xp_events DROP CONSTRAINT IF EXISTS xp_events_source_type_check;
ALTER TABLE public.xp_events ADD CONSTRAINT xp_events_source_type_check
  CHECK (source_type IN (
    'call_completed', 'gift_sent', 'gift_received', 'creator_followed',
    'favorite_added', 'daily_login', 'follower_gained', 'admin',
    'mission', 'streak', 'combo'
  ));

-- ── seeds ──────────────────────────────────────────────────────
INSERT INTO public.gift_combo_rewards (combo_multiplier, reward_xp, reward_coins, title, badge_label) VALUES
  (2, 5, 0, '2x Combo', '2x'),
  (5, 15, 5, '5x Combo', '5x'),
  (10, 30, 10, '10x Combo', '10x'),
  (20, 60, 20, '20x Combo', '20x'),
  (50, 150, 50, '50x Combo', '50x'),
  (100, 300, 100, '100x Combo', '100x')
ON CONFLICT (combo_multiplier) DO NOTHING;

INSERT INTO public.premium_gifts (gift_id, campaign_key, display_tier, badge_label, visual_theme, sort_order)
SELECT g.id, 'sprint3-default', 'premium', 'Premium', 'gold', g.sort_order
  FROM public.gifts g
 WHERE g.name IN ('Princess Crown', 'Diamond', 'Diamond Ring')
   AND g.is_active = TRUE
   AND NOT EXISTS (
     SELECT 1 FROM public.premium_gifts pg WHERE pg.gift_id = g.id AND pg.is_active = TRUE
   );

-- ── RLS deny clients ───────────────────────────────────────────
ALTER TABLE public.premium_gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_combo_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combo_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_combo_reward_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS premium_gifts_deny_clients ON public.premium_gifts;
CREATE POLICY premium_gifts_deny_clients ON public.premium_gifts
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS gift_combos_deny_clients ON public.gift_combos;
CREATE POLICY gift_combos_deny_clients ON public.gift_combos
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS gift_combo_rewards_deny_clients ON public.gift_combo_rewards;
CREATE POLICY gift_combo_rewards_deny_clients ON public.gift_combo_rewards
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS combo_progress_deny_clients ON public.combo_progress;
CREATE POLICY combo_progress_deny_clients ON public.combo_progress
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS gift_combo_reward_claims_deny_clients ON public.gift_combo_reward_claims;
CREATE POLICY gift_combo_reward_claims_deny_clients ON public.gift_combo_reward_claims
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ── rebuild combo_progress from gift_combos ────────────────────
CREATE OR REPLACE FUNCTION public.rebuild_combo_progress(p_combo_group_id UUID DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_grp RECORD;
  v_last RECORD;
  v_max_mult INT;
BEGIN
  FOR v_grp IN
    SELECT gc.combo_group_id
      FROM public.gift_combos gc
     WHERE p_combo_group_id IS NULL OR gc.combo_group_id = p_combo_group_id
     GROUP BY gc.combo_group_id
  LOOP
    SELECT gc.* INTO v_last
      FROM public.gift_combos gc
     WHERE gc.combo_group_id = v_grp.combo_group_id
     ORDER BY gc.combo_index DESC, gc.created_at DESC
     LIMIT 1;

    SELECT COALESCE(MAX(gcr.combo_multiplier), 0) INTO v_max_mult
      FROM public.gift_combo_reward_claims gcr
     WHERE gcr.combo_group_id = v_grp.combo_group_id;

    INSERT INTO public.combo_progress (
      combo_group_id, user_id, gift_id, creator_profile_id, call_id,
      current_combo_index, highest_multiplier, combo_window_ms,
      window_expires_at, is_active, updated_at
    ) VALUES (
      v_last.combo_group_id,
      v_last.sender_user_id,
      v_last.gift_id,
      v_last.creator_profile_id,
      v_last.call_id,
      v_last.combo_index,
      v_max_mult,
      v_last.combo_window_ms,
      v_last.created_at + (v_last.combo_window_ms || ' milliseconds')::INTERVAL,
      v_last.created_at + (v_last.combo_window_ms || ' milliseconds')::INTERVAL > NOW(),
      NOW()
    )
    ON CONFLICT (combo_group_id) DO UPDATE SET
      current_combo_index = EXCLUDED.current_combo_index,
      highest_multiplier = GREATEST(combo_progress.highest_multiplier, EXCLUDED.highest_multiplier),
      window_expires_at = EXCLUDED.window_expires_at,
      is_active = EXCLUDED.is_active,
      updated_at = NOW();

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── grant combo milestone rewards (idempotent) ───────────────────
CREATE OR REPLACE FUNCTION public.grant_combo_milestone_reward(
  p_user_id UUID,
  p_combo_group_id UUID,
  p_combo_multiplier INT,
  p_gift_transaction_id UUID,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reward RECORD;
  v_xp JSONB;
  v_coin UUID;
  v_claim_id UUID;
  v_existing RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.gift_combo_reward_claims
     WHERE combo_group_id = p_combo_group_id AND combo_multiplier = p_combo_multiplier
  ) THEN
    SELECT * INTO v_existing FROM public.gift_combo_reward_claims
     WHERE combo_group_id = p_combo_group_id AND combo_multiplier = p_combo_multiplier;
    RETURN jsonb_build_object(
      'granted', false, 'idempotent_replay', true,
      'comboMultiplier', p_combo_multiplier,
      'claimId', v_existing.id
    );
  END IF;

  SELECT * INTO v_reward FROM public.gift_combo_rewards
   WHERE combo_multiplier = p_combo_multiplier AND is_active = TRUE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('granted', false);
  END IF;

  IF v_reward.reward_xp > 0 THEN
    v_xp := public.grant_xp(
      'user', p_user_id, v_reward.reward_xp, 'combo', p_gift_transaction_id,
      'combo:' || p_combo_group_id::TEXT || ':' || p_combo_multiplier::TEXT
    );
  END IF;

  IF v_reward.reward_coins > 0 THEN
    v_coin := public.grant_engagement_coins(
      p_user_id, v_reward.reward_coins, 'combo_reward', p_gift_transaction_id,
      'combo-coin:' || p_combo_group_id::TEXT || ':' || p_combo_multiplier::TEXT,
      public.engagement_mission_date_utc()
    );
  END IF;

  INSERT INTO public.gift_combo_reward_claims (
    combo_group_id, combo_multiplier, user_id, gift_transaction_id,
    reward_xp_event_id, reward_coin_txn_id, idempotency_key,
    metadata
  ) VALUES (
    p_combo_group_id, p_combo_multiplier, p_user_id, p_gift_transaction_id,
    (v_xp->>'xp_event_id')::UUID, v_coin, p_idempotency_key,
    jsonb_build_object('title', v_reward.title, 'badgeLabel', v_reward.badge_label)
  ) RETURNING id INTO v_claim_id;

  INSERT INTO public.engagement_reward_events (
    user_id, reward_type, source_id, xp_amount, coins_amount,
    xp_event_id, coin_transaction_id, idempotency_key, metadata
  ) VALUES (
    p_user_id, 'combo', p_gift_transaction_id,
    v_reward.reward_xp, v_reward.reward_coins,
    (v_xp->>'xp_event_id')::UUID, v_coin,
    'combo-reward:' || p_combo_group_id::TEXT || ':' || p_combo_multiplier::TEXT,
    jsonb_build_object(
      'comboGroupId', p_combo_group_id,
      'comboMultiplier', p_combo_multiplier,
      'claimId', v_claim_id
    )
  )
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'granted', true,
    'comboMultiplier', p_combo_multiplier,
    'xpGranted', v_reward.reward_xp,
    'coinsGranted', v_reward.reward_coins,
    'claimId', v_claim_id
  );
END;
$$;

-- ── process combo after gift send (atomic with send_gift) ───────
CREATE OR REPLACE FUNCTION public.process_gift_combo_after_send(
  p_sender_user_id UUID,
  p_gift_transaction_id UUID,
  p_gift_id UUID,
  p_creator_profile_id UUID,
  p_call_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled BOOLEAN;
  v_window_ms INT;
  v_premium RECORD;
  v_prev RECORD;
  v_group_id UUID;
  v_index INT;
  v_now TIMESTAMPTZ := NOW();
  v_is_continuation BOOLEAN := FALSE;
  v_reward JSONB;
  v_premium_gift JSONB;
BEGIN
  SELECT COALESCE(engagement_premium_gifts_enabled, TRUE),
         COALESCE(engagement_combo_window_ms, 10000)
    INTO v_enabled, v_window_ms
    FROM public.app_settings
   LIMIT 1;

  IF NOT COALESCE(v_enabled, FALSE) THEN
    RETURN NULL;
  END IF;

  SELECT pg.*, g.name AS gift_name, g.coin_cost
    INTO v_premium
    FROM public.premium_gifts pg
    JOIN public.gifts g ON g.id = pg.gift_id
   WHERE pg.gift_id = p_gift_id
     AND pg.is_active = TRUE
     AND v_now BETWEEN pg.starts_at AND pg.ends_at
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_premium_gift := jsonb_build_object(
    'isPremium', true,
    'campaignKey', v_premium.campaign_key,
    'premiumGiftId', v_premium.id,
    'displayTier', v_premium.display_tier,
    'badgeLabel', v_premium.badge_label
  );

  SELECT gc.*
    INTO v_prev
    FROM public.gift_combos gc
   WHERE gc.sender_user_id = p_sender_user_id
     AND gc.gift_id = p_gift_id
     AND gc.creator_profile_id = p_creator_profile_id
     AND gc.call_id = p_call_id
     AND gc.created_at >= v_now - (v_window_ms || ' milliseconds')::INTERVAL
   ORDER BY gc.combo_index DESC, gc.created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    v_group_id := v_prev.combo_group_id;
    v_index := v_prev.combo_index + 1;
    v_is_continuation := TRUE;
  ELSE
    v_group_id := gen_random_uuid();
    v_index := 1;
  END IF;

  INSERT INTO public.gift_combos (
    combo_group_id, gift_transaction_id, sender_user_id, creator_profile_id,
    gift_id, premium_gift_id, combo_index, combo_window_ms, call_id
  ) VALUES (
    v_group_id, p_gift_transaction_id, p_sender_user_id, p_creator_profile_id,
    p_gift_id, v_premium.id, v_index, v_window_ms, p_call_id
  );

  INSERT INTO public.combo_progress (
    combo_group_id, user_id, gift_id, creator_profile_id, call_id,
    current_combo_index, highest_multiplier, combo_window_ms,
    window_expires_at, is_active, updated_at
  ) VALUES (
    v_group_id, p_sender_user_id, p_gift_id, p_creator_profile_id, p_call_id,
    v_index, 0, v_window_ms,
    v_now + (v_window_ms || ' milliseconds')::INTERVAL,
    TRUE, v_now
  )
  ON CONFLICT (combo_group_id) DO UPDATE SET
    current_combo_index = v_index,
    window_expires_at = v_now + (v_window_ms || ' milliseconds')::INTERVAL,
    is_active = TRUE,
    updated_at = v_now;

  IF EXISTS (
    SELECT 1 FROM public.gift_combo_rewards
     WHERE combo_multiplier = v_index AND is_active = TRUE
  ) THEN
    v_reward := public.grant_combo_milestone_reward(
      p_sender_user_id,
      v_group_id,
      v_index,
      p_gift_transaction_id,
      'combo-milestone:' || v_group_id::TEXT || ':' || v_index::TEXT
    );

    IF COALESCE((v_reward->>'granted')::BOOLEAN, FALSE) THEN
      UPDATE public.combo_progress
         SET highest_multiplier = GREATEST(highest_multiplier, v_index),
             updated_at = v_now
       WHERE combo_group_id = v_group_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'combo', jsonb_build_object(
      'comboGroupId', v_group_id,
      'comboIndex', v_index,
      'isContinuation', v_is_continuation,
      'comboWindowMs', v_window_ms,
      'milestoneReward', v_reward
    ),
    'gift', v_premium_gift
  );
END;
$$;

-- ── read RPCs ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_premium_gifts_catalog()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSONB;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.sort_order), '[]'::JSONB)
    INTO v_items
    FROM (
      SELECT
        pg.id AS "premiumGiftId",
        g.id AS "giftId",
        g.name,
        g.coin_cost AS "coinCost",
        g.icon_url AS "iconUrl",
        pg.campaign_key AS "campaignKey",
        pg.display_tier AS "displayTier",
        pg.badge_label AS "badgeLabel",
        pg.visual_theme AS "visualTheme",
        pg.starts_at AS "startsAt",
        pg.ends_at AS "endsAt"
      FROM public.premium_gifts pg
      JOIN public.gifts g ON g.id = pg.gift_id
     WHERE pg.is_active = TRUE
       AND g.is_active = TRUE
       AND v_now BETWEEN pg.starts_at AND pg.ends_at
    ) t;

  RETURN jsonb_build_object('items', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_combo_status(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active JSONB;
  v_milestones JSONB;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB), '[]'::JSONB)
    INTO v_active
    FROM (
      SELECT
        cp.combo_group_id AS "comboGroupId",
        cp.gift_id AS "giftId",
        g.name AS "giftName",
        cp.creator_profile_id AS "creatorProfileId",
        cp.call_id AS "callId",
        cp.current_combo_index AS "currentComboIndex",
        cp.highest_multiplier AS "highestMultiplier",
        cp.combo_window_ms AS "comboWindowMs",
        cp.window_expires_at AS "windowExpiresAt",
        cp.is_active AS "isActive"
      FROM public.combo_progress cp
      JOIN public.gifts g ON g.id = cp.gift_id
     WHERE cp.user_id = p_user_id
       AND cp.is_active = TRUE
       AND cp.window_expires_at > v_now
     ORDER BY cp.updated_at DESC
     LIMIT 5
    ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(m)::JSONB ORDER BY m."comboMultiplier"), '[]'::JSONB)
    INTO v_milestones
    FROM (
      SELECT
        combo_multiplier AS "comboMultiplier",
        reward_xp AS "rewardXp",
        reward_coins AS "rewardCoins",
        title,
        badge_label AS "badgeLabel"
      FROM public.gift_combo_rewards
     WHERE is_active = TRUE
    ) m;

  RETURN jsonb_build_object(
    'activeCombos', v_active,
    'milestones', v_milestones
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_combo_history(
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
        gc.id,
        gc.combo_group_id AS "comboGroupId",
        gc.combo_index AS "comboIndex",
        gc.gift_transaction_id AS "giftTransactionId",
        g.name AS "giftName",
        gc.call_id AS "callId",
        gc.created_at AS "createdAt",
        EXISTS (
          SELECT 1 FROM public.gift_combo_reward_claims gcr
           WHERE gcr.combo_group_id = gc.combo_group_id
             AND gcr.combo_multiplier = gc.combo_index
        ) AS "milestoneGranted"
      FROM public.gift_combos gc
      JOIN public.gifts g ON g.id = gc.gift_id
     WHERE gc.sender_user_id = p_user_id
     ORDER BY gc.created_at DESC
     LIMIT LEAST(GREATEST(p_limit, 1), 50)
    ) t;

  RETURN jsonb_build_object('items', v_items);
END;
$$;

-- ── patch send_gift: combo on send + idempotent replay ─────────
CREATE OR REPLACE FUNCTION public.send_gift(
  p_sender_user_id   UUID,
  p_creator_user_id  UUID,
  p_gift_id          UUID,
  p_call_id          UUID,
  p_idempotency_key  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_combo_meta        JSONB;
  v_combo_row         RECORD;
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
    SELECT gc.combo_group_id, gc.combo_index, gc.combo_window_ms
      INTO v_combo_row
      FROM public.gift_combos gc
     WHERE gc.gift_transaction_id = (
       SELECT gt.id FROM public.gift_transactions gt
        WHERE gt.sender_user_id = p_sender_user_id
          AND gt.idempotency_key = p_idempotency_key
       LIMIT 1
     );

    IF FOUND THEN
      v_existing := v_existing || jsonb_build_object(
        'combo', jsonb_build_object(
          'combo_group_id', v_combo_row.combo_group_id,
          'combo_index', v_combo_row.combo_index,
          'is_continuation', v_combo_row.combo_index > 1,
          'combo_window_ms', v_combo_row.combo_window_ms
        )
      );
    END IF;

    RETURN v_existing;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_sender_user_id::text || ':' || p_call_id::text)
  );

  SELECT id, coins, status, name, full_name, profile_image, avatar_url
    INTO v_sender FROM public.users WHERE id = p_sender_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sender_not_found'; END IF;
  IF v_sender.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'sender_not_active'; END IF;

  SELECT id, name, coin_cost, creator_share_percent, platform_share_percent, is_active
    INTO v_gift FROM public.gifts WHERE id = p_gift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'gift_not_found'; END IF;
  IF NOT v_gift.is_active THEN RAISE EXCEPTION 'gift_disabled'; END IF;

  SELECT id, caller_id, creator_id, status INTO v_call
    FROM public.calls WHERE id = p_call_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'call_not_found'; END IF;
  IF v_call.status IS DISTINCT FROM 'ongoing' THEN RAISE EXCEPTION 'call_not_active'; END IF;
  IF v_call.creator_id IS DISTINCT FROM p_creator_user_id THEN RAISE EXCEPTION 'call_creator_mismatch'; END IF;
  IF v_call.caller_id IS DISTINCT FROM p_sender_user_id THEN RAISE EXCEPTION 'call_sender_mismatch'; END IF;

  SELECT id, status, is_creator INTO v_creator_user FROM public.users WHERE id = p_creator_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'creator_not_found'; END IF;
  IF COALESCE(v_creator_user.is_creator, false) IS NOT TRUE THEN RAISE EXCEPTION 'creator_not_approved'; END IF;
  IF v_creator_user.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'creator_suspended'; END IF;

  SELECT cp.id, cp.user_id, cp.is_online, cp.online_status, cp.last_seen_at
    INTO v_creator_profile FROM public.creator_profiles cp WHERE cp.user_id = p_creator_user_id;
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
  SELECT available_balance INTO v_wallet_before FROM public.creator_wallets WHERE creator_id = v_wallet_key;
  v_wallet_before := COALESCE(v_wallet_before, 0);

  v_ledger_id := public._creator_ledger_append(
    v_wallet_key, v_creator_profile.user_id, 'gift_earning', v_creator_coins::NUMERIC,
    'gift_transaction', v_txn_id, 'gift_earning:' || v_txn_id::TEXT, 'send_gift'
  );

  SELECT available_balance INTO v_wallet_after FROM public.creator_wallets WHERE creator_id = v_wallet_key;
  v_wallet_after := COALESCE(v_wallet_after, v_wallet_before + v_creator_coins);

  INSERT INTO public.creator_transactions (
    creator_id, type, amount, balance_before, balance_after, reference_id
  ) VALUES (
    v_creator_profile.user_id, 'gift_earning', v_creator_coins,
    v_wallet_before, v_wallet_after, v_txn_id
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

  v_combo_meta := public.process_gift_combo_after_send(
    p_sender_user_id, v_txn_id, p_gift_id, v_creator_profile.id, p_call_id
  );

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
    'comboCount', COALESCE((v_combo_meta->'combo'->>'comboIndex')::INT, 1),
    'isPremium', COALESCE((v_combo_meta->'gift'->>'isPremium')::BOOLEAN, FALSE),
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
  ) || COALESCE(v_combo_meta, '{}'::JSONB);
END;
$$;

-- extend adjust_user_coins_v2 for combo_reward (Sprint 3)
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
    'mission_reward', 'streak_reward', 'combo_reward'
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

  UPDATE public.wallets SET coin_balance = v_balance_after, updated_at = NOW()
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
    WHEN p_source_type = 'combo_reward' THEN 'combo_reward'
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

-- ── RPC permissions ────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.rebuild_combo_progress FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_combo_milestone_reward FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_gift_combo_after_send FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_premium_gifts_catalog FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_combo_status FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_combo_history FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rebuild_combo_progress TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_combo_milestone_reward TO service_role;
GRANT EXECUTE ON FUNCTION public.process_gift_combo_after_send TO service_role;
GRANT EXECUTE ON FUNCTION public.get_premium_gifts_catalog TO service_role;
GRANT EXECUTE ON FUNCTION public.get_combo_status TO service_role;
GRANT EXECUTE ON FUNCTION public.get_combo_history TO service_role;

COMMIT;
