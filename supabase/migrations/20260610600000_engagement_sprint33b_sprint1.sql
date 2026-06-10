-- Phase 3.3B Sprint 1: Follow / Favorites + XP + Levels
-- L2 evidence: follows, favorites, xp_events
-- L3 projections: user_levels, creator_levels

-- ── follows (L2) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.follows (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  creator_profile_id  UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  followed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unfollowed_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_follows_active_pair
  ON public.follows (follower_user_id, creator_profile_id)
  WHERE unfollowed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_follows_follower_active
  ON public.follows (follower_user_id, followed_at DESC)
  WHERE unfollowed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_follows_creator_active
  ON public.follows (creator_profile_id)
  WHERE unfollowed_at IS NULL;

-- ── favorites (L2) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.favorites (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  creator_profile_id  UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  favorited_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unfavorited_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_favorites_active_pair
  ON public.favorites (user_id, creator_profile_id)
  WHERE unfavorited_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_favorites_user_active
  ON public.favorites (user_id, favorited_at DESC)
  WHERE unfavorited_at IS NULL;

-- ── xp_events (L2 append-only) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xp_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type     TEXT NOT NULL CHECK (subject_type IN ('user', 'creator')),
  subject_id       UUID NOT NULL,
  xp_amount        INT NOT NULL CHECK (xp_amount > 0),
  source_type      TEXT NOT NULL CHECK (source_type IN (
    'call_completed', 'gift_sent', 'gift_received', 'creator_followed',
    'favorite_added', 'daily_login', 'follower_gained', 'admin'
  )),
  source_id        UUID,
  idempotency_key  TEXT NOT NULL,
  metadata         JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_xp_events_subject_idempotency
  ON public.xp_events (subject_type, subject_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_xp_events_subject_created
  ON public.xp_events (subject_type, subject_id, created_at ASC);

-- ── user_levels (L3 projection) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_levels (
  user_id      UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  total_xp     BIGINT NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  level        INT NOT NULL DEFAULT 1 CHECK (level >= 1),
  level_title  TEXT NOT NULL DEFAULT 'Newcomer',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── creator_levels (L3 projection) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.creator_levels (
  creator_profile_id UUID PRIMARY KEY REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  total_xp           BIGINT NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  level              INT NOT NULL DEFAULT 1 CHECK (level >= 1),
  level_title        TEXT NOT NULL DEFAULT 'Rising Star',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RLS: deny direct client access ─────────────────────────────
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_levels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS follows_deny_clients ON public.follows;
CREATE POLICY follows_deny_clients ON public.follows
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS favorites_deny_clients ON public.favorites;
CREATE POLICY favorites_deny_clients ON public.favorites
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS xp_events_deny_clients ON public.xp_events;
CREATE POLICY xp_events_deny_clients ON public.xp_events
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS user_levels_deny_clients ON public.user_levels;
CREATE POLICY user_levels_deny_clients ON public.user_levels
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS creator_levels_deny_clients ON public.creator_levels;
CREATE POLICY creator_levels_deny_clients ON public.creator_levels
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ── Level curve helpers ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.xp_threshold_for_level(p_level INT, p_max_level INT DEFAULT 50)
RETURNS BIGINT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_level IS NULL OR p_level <= 1 THEN
    RETURN 0;
  END IF;
  IF p_level > p_max_level THEN
    RETURN public.xp_threshold_for_level(p_max_level, p_max_level);
  END IF;
  RETURN FLOOR(100::NUMERIC * POWER((p_level - 1)::NUMERIC, 1.35))::BIGINT;
END;
$$;

CREATE OR REPLACE FUNCTION public.level_from_total_xp(p_total_xp BIGINT, p_max_level INT DEFAULT 50)
RETURNS INT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_level INT := 1;
BEGIN
  IF p_total_xp IS NULL OR p_total_xp < 0 THEN
    RETURN 1;
  END IF;
  WHILE v_level < p_max_level
    AND public.xp_threshold_for_level(v_level + 1, p_max_level) <= p_total_xp
  LOOP
    v_level := v_level + 1;
  END LOOP;
  RETURN v_level;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_level_title(p_level INT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE
    WHEN p_level >= 40 THEN 'Legend'
    WHEN p_level >= 25 THEN 'Veteran'
    WHEN p_level >= 15 THEN 'Regular'
    WHEN p_level >= 8 THEN 'Explorer'
    WHEN p_level >= 4 THEN 'Active'
    ELSE 'Newcomer'
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.creator_level_title(p_level INT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE
    WHEN p_level >= 25 THEN 'Top Creator'
    WHEN p_level >= 15 THEN 'Established'
    WHEN p_level >= 8 THEN 'Rising Star'
    WHEN p_level >= 4 THEN 'Growing'
    ELSE 'New Creator'
  END;
END;
$$;

-- ── Grant XP (internal) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_xp(
  p_subject_type TEXT,
  p_subject_id UUID,
  p_xp_amount INT,
  p_source_type TEXT,
  p_source_id UUID,
  p_idempotency_key TEXT,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing UUID;
  v_event_id UUID;
  v_total BIGINT;
  v_level INT;
  v_title TEXT;
  v_max_level INT;
BEGIN
  IF p_xp_amount IS NULL OR p_xp_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_xp_amount' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_existing
    FROM public.xp_events
   WHERE subject_type = p_subject_type
     AND subject_id = p_subject_id
     AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF p_subject_type = 'user' THEN
      SELECT total_xp, level, level_title
        INTO v_total, v_level, v_title
        FROM public.user_levels
       WHERE user_id = p_subject_id;
    ELSE
      SELECT total_xp, level, level_title
        INTO v_total, v_level, v_title
        FROM public.creator_levels
       WHERE creator_profile_id = p_subject_id;
    END IF;

    RETURN jsonb_build_object(
      'xp_event_id', v_existing,
      'idempotent_replay', true,
      'total_xp', COALESCE(v_total, 0),
      'level', COALESCE(v_level, 1),
      'level_title', COALESCE(v_title, 'Newcomer')
    );
  END IF;

  INSERT INTO public.xp_events (
    subject_type, subject_id, xp_amount, source_type, source_id,
    idempotency_key, metadata
  ) VALUES (
    p_subject_type, p_subject_id, p_xp_amount, p_source_type, p_source_id,
    p_idempotency_key, COALESCE(p_metadata, '{}'::JSONB)
  )
  RETURNING id INTO v_event_id;

  IF p_subject_type = 'user' THEN
    v_max_level := 50;
    INSERT INTO public.user_levels (user_id, total_xp, level, level_title, updated_at)
    VALUES (p_subject_id, p_xp_amount, 1, public.user_level_title(1), NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET total_xp = public.user_levels.total_xp + EXCLUDED.total_xp,
          updated_at = NOW();

    SELECT total_xp INTO v_total FROM public.user_levels WHERE user_id = p_subject_id;
    v_level := public.level_from_total_xp(v_total, v_max_level);
    v_title := public.user_level_title(v_level);

    UPDATE public.user_levels
       SET level = v_level,
           level_title = v_title,
           updated_at = NOW()
     WHERE user_id = p_subject_id;
  ELSE
    v_max_level := 30;
    INSERT INTO public.creator_levels (creator_profile_id, total_xp, level, level_title, updated_at)
    VALUES (p_subject_id, p_xp_amount, 1, public.creator_level_title(1), NOW())
    ON CONFLICT (creator_profile_id) DO UPDATE
      SET total_xp = public.creator_levels.total_xp + EXCLUDED.total_xp,
          updated_at = NOW();

    SELECT total_xp INTO v_total FROM public.creator_levels WHERE creator_profile_id = p_subject_id;
    v_level := public.level_from_total_xp(v_total, v_max_level);
    v_title := public.creator_level_title(v_level);

    UPDATE public.creator_levels
       SET level = v_level,
           level_title = v_title,
           updated_at = NOW()
     WHERE creator_profile_id = p_subject_id;
  END IF;

  RETURN jsonb_build_object(
    'xp_event_id', v_event_id,
    'idempotent_replay', false,
    'total_xp', v_total,
    'level', v_level,
    'level_title', v_title,
    'xp_granted', p_xp_amount
  );
END;
$$;

-- ── Rebuild projections ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rebuild_user_level(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
  v_level INT;
  v_title TEXT;
BEGIN
  SELECT COALESCE(SUM(xp_amount), 0)::BIGINT
    INTO v_total
    FROM public.xp_events
   WHERE subject_type = 'user'
     AND subject_id = p_user_id;

  v_level := public.level_from_total_xp(v_total, 50);
  v_title := public.user_level_title(v_level);

  INSERT INTO public.user_levels (user_id, total_xp, level, level_title, updated_at)
  VALUES (p_user_id, v_total, v_level, v_title, NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET total_xp = EXCLUDED.total_xp,
        level = EXCLUDED.level,
        level_title = EXCLUDED.level_title,
        updated_at = NOW();

  RETURN jsonb_build_object('user_id', p_user_id, 'total_xp', v_total, 'level', v_level);
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_creator_level(p_creator_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
  v_level INT;
  v_title TEXT;
BEGIN
  SELECT COALESCE(SUM(xp_amount), 0)::BIGINT
    INTO v_total
    FROM public.xp_events
   WHERE subject_type = 'creator'
     AND subject_id = p_creator_profile_id;

  v_level := public.level_from_total_xp(v_total, 30);
  v_title := public.creator_level_title(v_level);

  INSERT INTO public.creator_levels (creator_profile_id, total_xp, level, level_title, updated_at)
  VALUES (p_creator_profile_id, v_total, v_level, v_title, NOW())
  ON CONFLICT (creator_profile_id) DO UPDATE
    SET total_xp = EXCLUDED.total_xp,
        level = EXCLUDED.level,
        level_title = EXCLUDED.level_title,
        updated_at = NOW();

  RETURN jsonb_build_object(
    'creator_profile_id', p_creator_profile_id,
    'total_xp', v_total,
    'level', v_level
  );
END;
$$;

-- ── Daily login XP ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_daily_login_xp(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day TEXT;
  v_key TEXT;
BEGIN
  v_day := to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  v_key := 'daily_login:' || v_day;

  RETURN public.grant_xp(
    'user',
    p_user_id,
    5,
    'daily_login',
    NULL,
    v_key,
    jsonb_build_object('login_date', v_day)
  );
END;
$$;

-- ── Follow / unfollow ──────────────────────────────────────────
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
BEGIN
  IF p_follower_user_id IS NULL OR p_creator_profile_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'P0001';
  END IF;

  SELECT cp.user_id, cp.status
    INTO v_creator_user_id, v_creator_status
    FROM public.creator_profiles cp
   WHERE cp.id = p_creator_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'creator_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_creator_user_id = p_follower_user_id THEN
    RAISE EXCEPTION 'cannot_follow_self' USING ERRCODE = 'P0001';
  END IF;

  IF v_creator_status IN ('suspended', 'rejected', 'pending') THEN
    RAISE EXCEPTION 'creator_not_followable' USING ERRCODE = 'P0001';
  END IF;

  v_key := COALESCE(p_idempotency_key, 'follow:' || p_follower_user_id::TEXT || ':' || p_creator_profile_id::TEXT);

  SELECT * INTO v_row
    FROM public.follows
   WHERE follower_user_id = p_follower_user_id
     AND creator_profile_id = p_creator_profile_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_row.unfollowed_at IS NULL THEN
      RETURN jsonb_build_object(
        'following', true,
        'followed_at', v_row.followed_at,
        'creator_profile_id', p_creator_profile_id,
        'idempotent_replay', true
      );
    END IF;

    UPDATE public.follows
       SET unfollowed_at = NULL,
           followed_at = NOW()
     WHERE id = v_row.id
     RETURNING * INTO v_row;

    v_reactivated := true;
  ELSE
    INSERT INTO public.follows (follower_user_id, creator_profile_id)
    VALUES (p_follower_user_id, p_creator_profile_id)
    RETURNING * INTO v_row;
  END IF;

  v_xp := public.grant_xp(
    'user', p_follower_user_id, 10, 'creator_followed', v_row.id,
    'creator_followed:' || v_row.id::TEXT,
    jsonb_build_object('creator_profile_id', p_creator_profile_id)
  );

  IF v_reactivated THEN
    v_creator_xp := public.grant_xp(
      'creator', p_creator_profile_id, 5, 'follower_gained', v_row.id,
      'follower_gained:' || v_row.id::TEXT,
      jsonb_build_object('follower_user_id', p_follower_user_id)
    );
  ELSE
    v_creator_xp := public.grant_xp(
      'creator', p_creator_profile_id, 5, 'follower_gained', v_row.id,
      'follower_gained:' || v_row.id::TEXT,
      jsonb_build_object('follower_user_id', p_follower_user_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'following', true,
    'followed_at', v_row.followed_at,
    'creator_profile_id', p_creator_profile_id,
    'idempotent_replay', false,
    'user_xp', v_xp,
    'creator_xp', v_creator_xp
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.unfollow_creator(
  p_follower_user_id UUID,
  p_creator_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.follows%ROWTYPE;
BEGIN
  UPDATE public.follows
     SET unfollowed_at = NOW()
   WHERE follower_user_id = p_follower_user_id
     AND creator_profile_id = p_creator_profile_id
     AND unfollowed_at IS NULL
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('following', false, 'creator_profile_id', p_creator_profile_id);
  END IF;

  RETURN jsonb_build_object(
    'following', false,
    'unfollowed_at', v_row.unfollowed_at,
    'creator_profile_id', p_creator_profile_id
  );
END;
$$;

-- ── Favorite / unfavorite ──────────────────────────────────────
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
BEGIN
  SELECT cp.status INTO v_creator_status
    FROM public.creator_profiles cp
   WHERE cp.id = p_creator_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'creator_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_creator_status IN ('suspended', 'rejected', 'pending') THEN
    RAISE EXCEPTION 'creator_not_followable' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row
    FROM public.favorites
   WHERE user_id = p_user_id
     AND creator_profile_id = p_creator_profile_id
   FOR UPDATE;

  v_exists := FOUND;

  IF v_exists AND v_row.unfavorited_at IS NULL THEN
    RETURN jsonb_build_object(
      'favorited', true,
      'favorited_at', v_row.favorited_at,
      'creator_profile_id', p_creator_profile_id,
      'idempotent_replay', true
    );
  END IF;

  IF NOT v_exists THEN
    SELECT COUNT(*)::INT INTO v_active_count
      FROM public.favorites
     WHERE user_id = p_user_id
       AND unfavorited_at IS NULL;

    IF v_active_count >= 50 THEN
      RAISE EXCEPTION 'favorite_limit_reached' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.favorites (user_id, creator_profile_id)
    VALUES (p_user_id, p_creator_profile_id)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.favorites
       SET unfavorited_at = NULL,
           favorited_at = NOW()
     WHERE id = v_row.id
     RETURNING * INTO v_row;
  END IF;

  v_follow := public.follow_creator(
    p_user_id,
    p_creator_profile_id,
    COALESCE(p_idempotency_key, 'favorite_follow:' || p_user_id::TEXT || ':' || p_creator_profile_id::TEXT)
  );

  v_xp := public.grant_xp(
    'user', p_user_id, 5, 'favorite_added', v_row.id,
    'favorite_added:' || v_row.id::TEXT,
    jsonb_build_object('creator_profile_id', p_creator_profile_id)
  );

  RETURN jsonb_build_object(
    'favorited', true,
    'favorited_at', v_row.favorited_at,
    'creator_profile_id', p_creator_profile_id,
    'following', true,
    'follow', v_follow,
    'user_xp', v_xp,
    'idempotent_replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.unfavorite_creator(
  p_user_id UUID,
  p_creator_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.favorites%ROWTYPE;
BEGIN
  UPDATE public.favorites
     SET unfavorited_at = NOW()
   WHERE user_id = p_user_id
     AND creator_profile_id = p_creator_profile_id
     AND unfavorited_at IS NULL
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('favorited', false, 'creator_profile_id', p_creator_profile_id);
  END IF;

  RETURN jsonb_build_object(
    'favorited', false,
    'unfavorited_at', v_row.unfavorited_at,
    'creator_profile_id', p_creator_profile_id
  );
END;
$$;

-- ── Levels snapshot ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_engagement_levels(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.user_levels%ROWTYPE;
  v_creator_profile_id UUID;
  v_creator public.creator_levels%ROWTYPE;
  v_login JSONB;
  v_current_level INT;
  v_next_threshold BIGINT;
BEGIN
  v_login := public.record_daily_login_xp(p_user_id);

  SELECT * INTO v_user FROM public.user_levels WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    v_user.user_id := p_user_id;
    v_user.total_xp := 0;
    v_user.level := 1;
    v_user.level_title := public.user_level_title(1);
  END IF;

  v_current_level := v_user.level;
  v_next_threshold := public.xp_threshold_for_level(v_current_level + 1, 50);

  SELECT cp.id INTO v_creator_profile_id
    FROM public.creator_profiles cp
   WHERE cp.user_id = p_user_id
   LIMIT 1;

  IF v_creator_profile_id IS NOT NULL THEN
    SELECT * INTO v_creator FROM public.creator_levels WHERE creator_profile_id = v_creator_profile_id;
    IF NOT FOUND THEN
      v_creator.creator_profile_id := v_creator_profile_id;
      v_creator.total_xp := 0;
      v_creator.level := 1;
      v_creator.level_title := public.creator_level_title(1);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'user', jsonb_build_object(
      'current_xp', v_user.total_xp,
      'current_level', v_user.level,
      'level_title', v_user.level_title,
      'next_level', LEAST(v_user.level + 1, 50),
      'xp_to_next_level', GREATEST(v_next_threshold - v_user.total_xp, 0),
      'next_level_threshold', v_next_threshold,
      'daily_login', v_login
    ),
    'creator', CASE WHEN v_creator_profile_id IS NULL THEN NULL ELSE jsonb_build_object(
      'creator_profile_id', v_creator_profile_id,
      'current_xp', v_creator.total_xp,
      'current_level', v_creator.level,
      'level_title', v_creator.level_title,
      'next_level', LEAST(v_creator.level + 1, 30),
      'xp_to_next_level', GREATEST(
        public.xp_threshold_for_level(v_creator.level + 1, 30) - v_creator.total_xp,
        0
      ),
      'next_level_threshold', public.xp_threshold_for_level(v_creator.level + 1, 30)
    ) END
  );
END;
$$;

-- ── RPC permissions ────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.grant_xp FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.follow_creator FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unfollow_creator FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.favorite_creator FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unfavorite_creator FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_daily_login_xp FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_engagement_levels FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rebuild_user_level FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rebuild_creator_level FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_xp TO service_role;
GRANT EXECUTE ON FUNCTION public.follow_creator TO service_role;
GRANT EXECUTE ON FUNCTION public.unfollow_creator TO service_role;
GRANT EXECUTE ON FUNCTION public.favorite_creator TO service_role;
GRANT EXECUTE ON FUNCTION public.unfavorite_creator TO service_role;
GRANT EXECUTE ON FUNCTION public.record_daily_login_xp TO service_role;
GRANT EXECUTE ON FUNCTION public.get_engagement_levels TO service_role;
GRANT EXECUTE ON FUNCTION public.rebuild_user_level TO service_role;
GRANT EXECUTE ON FUNCTION public.rebuild_creator_level TO service_role;
