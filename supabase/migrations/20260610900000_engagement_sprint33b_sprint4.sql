-- Phase 3.3B Sprint 4: VIP Membership (Silver / Gold / Platinum)

BEGIN;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS engagement_vip_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- ── vip_plans catalog (L2) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vip_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier            TEXT NOT NULL CHECK (tier IN ('silver', 'gold', 'platinum')),
  display_name    TEXT NOT NULL,
  price_inr       NUMERIC(10, 2) NOT NULL CHECK (price_inr > 0),
  price_coins     INT CHECK (price_coins IS NULL OR price_coins > 0),
  duration_days   INT NOT NULL DEFAULT 30 CHECK (duration_days > 0),
  perks_json      JSONB NOT NULL DEFAULT '{}'::JSONB,
  sort_order      INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vip_plans_tier_active
  ON public.vip_plans (tier)
  WHERE is_active = TRUE;

-- ── user_memberships (L2) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_memberships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  vip_plan_id         UUID NOT NULL REFERENCES public.vip_plans(id) ON DELETE RESTRICT,
  tier                TEXT NOT NULL CHECK (tier IN ('silver', 'gold', 'platinum')),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'active', 'expired', 'cancelled', 'failed'
  )),
  starts_at           TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  source_type         TEXT NOT NULL DEFAULT 'razorpay' CHECK (source_type IN (
    'razorpay', 'coin_purchase', 'admin_grant', 'mission_reward'
  )),
  source_id           UUID,
  gateway_order_id    TEXT,
  gateway_payment_id  TEXT,
  amount_inr          NUMERIC(10, 2),
  amount_paise        INT,
  idempotency_key     TEXT NOT NULL,
  perks_snapshot      JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_memberships_idempotency
  ON public.user_memberships (user_id, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_memberships_one_active
  ON public.user_memberships (user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_user_memberships_user_status
  ON public.user_memberships (user_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_memberships_gateway_order
  ON public.user_memberships (gateway_order_id)
  WHERE gateway_order_id IS NOT NULL;

-- ── membership_events (L2 append-only evidence) ────────────────
CREATE TABLE IF NOT EXISTS public.membership_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  membership_id   UUID NOT NULL REFERENCES public.user_memberships(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL CHECK (event_type IN (
    'subscription_initiated', 'subscription_activated', 'subscription_expired',
    'subscription_cancelled', 'reward_granted', 'perk_applied'
  )),
  tier            TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
  idempotency_key TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_events_idempotency
  ON public.membership_events (user_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_membership_events_user_created
  ON public.membership_events (user_id, created_at DESC);

-- ── membership_rewards catalog (L2) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.membership_rewards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier         TEXT NOT NULL CHECK (tier IN ('silver', 'gold', 'platinum')),
  reward_key   TEXT NOT NULL,
  title        TEXT NOT NULL,
  reward_xp    INT NOT NULL DEFAULT 0 CHECK (reward_xp >= 0),
  reward_coins INT NOT NULL DEFAULT 0 CHECK (reward_coins >= 0),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (tier, reward_key)
);

-- ── user_vip_summary (L3 projection — rebuildable) ─────────────
CREATE TABLE IF NOT EXISTS public.user_vip_summary (
  user_id       UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  membership_id UUID REFERENCES public.user_memberships(id) ON DELETE SET NULL,
  tier          TEXT,
  status        TEXT NOT NULL DEFAULT 'none',
  expires_at    TIMESTAMPTZ,
  perks_json    JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── seeds ────────────────────────────────────────────────────────
INSERT INTO public.vip_plans (tier, display_name, price_inr, duration_days, perks_json, sort_order)
SELECT v.tier, v.display_name, v.price_inr, v.duration_days, v.perks_json, v.sort_order
FROM (VALUES
  ('silver', 'Silver VIP', 299.00::NUMERIC, 30, jsonb_build_object(
    'badge', 'silver',
    'rechargeBonusPercent', 5,
    'giftDiscountPercent', 2,
    'priorityCallQueue', false,
    'exclusiveTheme', 'silver_mist',
    'vipIdentity', true,
    'futurePerks', jsonb_build_array('priority_support')
  ), 1),
  ('gold', 'Gold VIP', 599.00, 30, jsonb_build_object(
    'badge', 'gold',
    'rechargeBonusPercent', 10,
    'giftDiscountPercent', 5,
    'priorityCallQueue', true,
    'exclusiveTheme', 'gold_night',
    'vipIdentity', true,
    'futurePerks', jsonb_build_array('priority_support', 'exclusive_gifts')
  ), 2),
  ('platinum', 'Platinum VIP', 1299.00, 30, jsonb_build_object(
    'badge', 'platinum',
    'rechargeBonusPercent', 15,
    'giftDiscountPercent', 10,
    'priorityCallQueue', true,
    'exclusiveTheme', 'platinum_aurora',
    'vipIdentity', true,
    'futurePerks', jsonb_build_array('priority_support', 'exclusive_gifts', 'creator_spotlight')
  ), 3)
) AS v(tier, display_name, price_inr, duration_days, perks_json, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.vip_plans LIMIT 1);

INSERT INTO public.membership_rewards (tier, reward_key, title, reward_xp, reward_coins) VALUES
  ('silver', 'welcome', 'Silver Welcome Bonus', 50, 0),
  ('gold', 'welcome', 'Gold Welcome Bonus', 100, 10),
  ('platinum', 'welcome', 'Platinum Welcome Bonus', 200, 25)
ON CONFLICT (tier, reward_key) DO NOTHING;

-- ── RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.vip_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_vip_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vip_plans_deny_clients ON public.vip_plans;
CREATE POLICY vip_plans_deny_clients ON public.vip_plans
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS user_memberships_deny_clients ON public.user_memberships;
CREATE POLICY user_memberships_deny_clients ON public.user_memberships
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS membership_events_deny_clients ON public.membership_events;
CREATE POLICY membership_events_deny_clients ON public.membership_events
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS membership_rewards_deny_clients ON public.membership_rewards;
CREATE POLICY membership_rewards_deny_clients ON public.membership_rewards
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS user_vip_summary_deny_clients ON public.user_vip_summary;
CREATE POLICY user_vip_summary_deny_clients ON public.user_vip_summary
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ── rebuild L3 projection ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rebuild_user_vip_summary(p_user_id UUID DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_count INT := 0;
BEGIN
  FOR v_row IN
    SELECT DISTINCT ON (um.user_id)
      um.user_id, um.id AS membership_id, um.tier, um.status, um.expires_at, um.perks_snapshot
    FROM public.user_memberships um
    WHERE um.status = 'active'
      AND (um.expires_at IS NULL OR um.expires_at > NOW())
      AND (p_user_id IS NULL OR um.user_id = p_user_id)
    ORDER BY um.user_id, um.expires_at DESC NULLS LAST
  LOOP
    INSERT INTO public.user_vip_summary (
      user_id, membership_id, tier, status, expires_at, perks_json, updated_at
    ) VALUES (
      v_row.user_id, v_row.membership_id, v_row.tier, 'active',
      v_row.expires_at, v_row.perks_snapshot, NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      membership_id = EXCLUDED.membership_id,
      tier = EXCLUDED.tier,
      status = 'active',
      expires_at = EXCLUDED.expires_at,
      perks_json = EXCLUDED.perks_json,
      updated_at = NOW();
    v_count := v_count + 1;
  END LOOP;

  IF p_user_id IS NOT NULL THEN
    IF NOT FOUND THEN
      INSERT INTO public.user_vip_summary (user_id, status, updated_at)
      VALUES (p_user_id, 'none', NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        membership_id = NULL, tier = NULL, status = 'none',
        expires_at = NULL, perks_json = '{}'::JSONB, updated_at = NOW();
    END IF;
  END IF;

  RETURN v_count;
END;
$$;

-- ── grant tier welcome rewards ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_membership_welcome_rewards(
  p_user_id UUID,
  p_membership_id UUID,
  p_tier TEXT
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
  v_grants JSONB := '[]'::JSONB;
BEGIN
  FOR v_reward IN
    SELECT * FROM public.membership_rewards
     WHERE tier = p_tier AND is_active = TRUE
  LOOP
    IF v_reward.reward_xp > 0 THEN
      v_xp := public.grant_xp(
        'user', p_user_id, v_reward.reward_xp, 'admin', p_membership_id,
        'vip-welcome-xp:' || p_membership_id::TEXT || ':' || v_reward.reward_key
      );
    END IF;

    IF v_reward.reward_coins > 0 THEN
      v_coin := public.grant_engagement_coins(
        p_user_id, v_reward.reward_coins, 'mission_reward', p_membership_id,
        'vip-welcome-coin:' || p_membership_id::TEXT || ':' || v_reward.reward_key,
        public.engagement_mission_date_utc()
      );
    END IF;

    INSERT INTO public.membership_events (
      user_id, membership_id, event_type, tier, metadata, idempotency_key
    ) VALUES (
      p_user_id, p_membership_id, 'reward_granted', p_tier,
      jsonb_build_object(
        'rewardKey', v_reward.reward_key,
        'title', v_reward.title,
        'xpGranted', v_reward.reward_xp,
        'coinsGranted', v_reward.reward_coins
      ),
      'vip-reward:' || p_membership_id::TEXT || ':' || v_reward.reward_key
    )
    ON CONFLICT DO NOTHING;

    v_grants := v_grants || jsonb_build_object(
      'rewardKey', v_reward.reward_key,
      'xpGranted', v_reward.reward_xp,
      'coinsGranted', v_reward.reward_coins
    );
  END LOOP;

  RETURN jsonb_build_object('grants', v_grants);
END;
$$;

-- ── initiate subscription ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.initiate_vip_subscription(
  p_user_id UUID,
  p_tier TEXT,
  p_idempotency_key TEXT,
  p_gateway_order_id TEXT,
  p_amount_paise INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.vip_plans%ROWTYPE;
  v_existing public.user_memberships%ROWTYPE;
  v_membership_id UUID;
  v_enabled BOOLEAN;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT COALESCE(engagement_vip_enabled, TRUE) INTO v_enabled FROM public.app_settings LIMIT 1;
  IF NOT COALESCE(v_enabled, FALSE) THEN
    RAISE EXCEPTION 'vip_disabled';
  END IF;

  SELECT * INTO v_existing FROM public.user_memberships
   WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'idempotentReplay', true,
      'membershipId', v_existing.id,
      'status', v_existing.status,
      'tier', v_existing.tier,
      'gatewayOrderId', v_existing.gateway_order_id
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_memberships
     WHERE user_id = p_user_id AND status = 'active'
       AND (expires_at IS NULL OR expires_at > NOW())
  ) THEN
    RAISE EXCEPTION 'vip_already_active';
  END IF;

  SELECT * INTO v_plan FROM public.vip_plans
   WHERE tier = p_tier AND is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_tier';
  END IF;

  INSERT INTO public.user_memberships (
    user_id, vip_plan_id, tier, status, source_type,
    gateway_order_id, amount_inr, amount_paise,
    idempotency_key, perks_snapshot
  ) VALUES (
    p_user_id, v_plan.id, v_plan.tier, 'pending', 'razorpay',
    p_gateway_order_id, v_plan.price_inr, p_amount_paise,
    p_idempotency_key, v_plan.perks_json
  ) RETURNING id INTO v_membership_id;

  INSERT INTO public.membership_events (
    user_id, membership_id, event_type, tier, metadata, idempotency_key
  ) VALUES (
    p_user_id, v_membership_id, 'subscription_initiated', v_plan.tier,
    jsonb_build_object('gatewayOrderId', p_gateway_order_id, 'amountPaise', p_amount_paise),
    'vip-init:' || v_membership_id::TEXT
  );

  RETURN jsonb_build_object(
    'idempotentReplay', false,
    'membershipId', v_membership_id,
    'status', 'pending',
    'tier', v_plan.tier,
    'displayName', v_plan.display_name,
    'amountInr', v_plan.price_inr,
    'amountPaise', p_amount_paise,
    'gatewayOrderId', p_gateway_order_id,
    'durationDays', v_plan.duration_days,
    'perks', v_plan.perks_json
  );
END;
$$;

-- ── activate after payment ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activate_vip_membership(
  p_user_id UUID,
  p_membership_id UUID,
  p_gateway_payment_id TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mem public.user_memberships%ROWTYPE;
  v_plan public.vip_plans%ROWTYPE;
  v_starts TIMESTAMPTZ := NOW();
  v_expires TIMESTAMPTZ;
  v_rewards JSONB;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT * INTO v_mem FROM public.user_memberships
   WHERE id = p_membership_id AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership_not_found';
  END IF;

  IF v_mem.status = 'active' THEN
    RETURN jsonb_build_object(
      'idempotentReplay', true,
      'status', 'active',
      'membershipId', v_mem.id,
      'tier', v_mem.tier,
      'expiresAt', v_mem.expires_at
    );
  END IF;

  IF v_mem.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'membership_not_pending';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_memberships
     WHERE user_id = p_user_id AND status = 'active' AND id <> p_membership_id
       AND (expires_at IS NULL OR expires_at > NOW())
  ) THEN
    RAISE EXCEPTION 'vip_already_active';
  END IF;

  SELECT * INTO v_plan FROM public.vip_plans WHERE id = v_mem.vip_plan_id;
  v_expires := v_starts + (COALESCE(v_plan.duration_days, 30) || ' days')::INTERVAL;

  UPDATE public.user_memberships SET
    status = 'active',
    starts_at = v_starts,
    expires_at = v_expires,
    gateway_payment_id = p_gateway_payment_id,
    source_id = p_membership_id,
    updated_at = v_starts
  WHERE id = p_membership_id;

  INSERT INTO public.membership_events (
    user_id, membership_id, event_type, tier, metadata, idempotency_key
  ) VALUES (
    p_user_id, p_membership_id, 'subscription_activated', v_mem.tier,
    jsonb_build_object('gatewayPaymentId', p_gateway_payment_id, 'expiresAt', v_expires),
    p_idempotency_key
  );

  v_rewards := public.grant_membership_welcome_rewards(p_user_id, p_membership_id, v_mem.tier);
  PERFORM public.rebuild_user_vip_summary(p_user_id);

  RETURN jsonb_build_object(
    'idempotentReplay', false,
    'status', 'active',
    'membershipId', p_membership_id,
    'tier', v_mem.tier,
    'startsAt', v_starts,
    'expiresAt', v_expires,
    'perks', v_mem.perks_snapshot,
    'welcomeRewards', v_rewards
  );
END;
$$;

-- ── read RPCs ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_vip_plans()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plans JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t."sortOrder"), '[]'::JSONB)
    INTO v_plans
    FROM (
      SELECT
        id AS "planId",
        tier,
        display_name AS "displayName",
        price_inr AS "priceInr",
        price_coins AS "priceCoins",
        duration_days AS "durationDays",
        perks_json AS perks,
        sort_order AS "sortOrder"
      FROM public.vip_plans
     WHERE is_active = TRUE
    ) t;

  RETURN jsonb_build_object('plans', v_plans);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_vip_status(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mem public.user_memberships%ROWTYPE;
  v_days INT;
BEGIN
  PERFORM public.expire_vip_memberships(p_user_id);

  SELECT * INTO v_mem FROM public.user_memberships
   WHERE user_id = p_user_id AND status = 'active'
     AND (expires_at IS NULL OR expires_at > NOW())
   ORDER BY expires_at DESC NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('active', false, 'tier', NULL, 'perks', '{}'::JSONB);
  END IF;

  v_days := GREATEST(0, EXTRACT(DAY FROM (v_mem.expires_at - NOW()))::INT);

  RETURN jsonb_build_object(
    'active', true,
    'membershipId', v_mem.id,
    'tier', v_mem.tier,
    'displayName', (SELECT display_name FROM public.vip_plans WHERE id = v_mem.vip_plan_id),
    'startsAt', v_mem.starts_at,
    'expiresAt', v_mem.expires_at,
    'daysRemaining', v_days,
    'perks', v_mem.perks_snapshot
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_vip_membership_history(
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
        um.id AS "membershipId",
        um.tier,
        um.status,
        um.starts_at AS "startsAt",
        um.expires_at AS "expiresAt",
        um.amount_inr AS "amountInr",
        um.created_at AS "createdAt",
        vp.display_name AS "displayName"
      FROM public.user_memberships um
      JOIN public.vip_plans vp ON vp.id = um.vip_plan_id
     WHERE um.user_id = p_user_id
     ORDER BY um.created_at DESC
     LIMIT LEAST(GREATEST(p_limit, 1), 50)
    ) t;

  RETURN jsonb_build_object('items', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_vip_memberships(p_user_id UUID DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_count INT := 0;
BEGIN
  FOR v_row IN
    SELECT id, user_id, tier FROM public.user_memberships
     WHERE status = 'active'
       AND expires_at IS NOT NULL AND expires_at <= NOW()
       AND (p_user_id IS NULL OR user_id = p_user_id)
  LOOP
    UPDATE public.user_memberships SET status = 'expired', updated_at = NOW()
     WHERE id = v_row.id;

    INSERT INTO public.membership_events (
      user_id, membership_id, event_type, tier, metadata, idempotency_key
    ) VALUES (
      v_row.user_id, v_row.id, 'subscription_expired', v_row.tier,
      jsonb_build_object('expiredAt', NOW()),
      'vip-expire:' || v_row.id::TEXT
    )
    ON CONFLICT DO NOTHING;

    PERFORM public.rebuild_user_vip_summary(v_row.user_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── RPC permissions ──────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.rebuild_user_vip_summary FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_membership_welcome_rewards FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.initiate_vip_subscription FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_vip_membership FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_vip_plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_vip_status FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_vip_membership_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_vip_memberships FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rebuild_user_vip_summary TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_membership_welcome_rewards TO service_role;
GRANT EXECUTE ON FUNCTION public.initiate_vip_subscription TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_vip_membership TO service_role;
GRANT EXECUTE ON FUNCTION public.get_vip_plans TO service_role;
GRANT EXECUTE ON FUNCTION public.get_vip_status TO service_role;
GRANT EXECUTE ON FUNCTION public.get_vip_membership_history TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_vip_memberships TO service_role;

COMMIT;
