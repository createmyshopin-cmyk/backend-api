-- Phase 3.3G — Release Management System
-- app_version_settings (single active row) + app_release_history (append-only)

BEGIN;

-- ── version tracking on users (analytics) ─────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS app_version TEXT,
  ADD COLUMN IF NOT EXISTS app_build_number INTEGER,
  ADD COLUMN IF NOT EXISTS app_platform TEXT
    CHECK (app_platform IS NULL OR app_platform IN ('android', 'ios')),
  ADD COLUMN IF NOT EXISTS app_version_reported_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_app_version
  ON public.users (app_version, app_build_number)
  WHERE app_version IS NOT NULL;

-- ── active release settings (single row) ──────────────────────
CREATE TABLE IF NOT EXISTS public.app_version_settings (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  latest_version              TEXT NOT NULL DEFAULT '1.0.0',
  minimum_supported_version   TEXT NOT NULL DEFAULT '1.0.0',
  force_update                BOOLEAN NOT NULL DEFAULT FALSE,
  release_type                TEXT NOT NULL DEFAULT 'optional'
    CHECK (release_type IN ('optional', 'force', 'maintenance')),
  title                       TEXT NOT NULL DEFAULT '🚀 New Version Available',
  message                     TEXT NOT NULL DEFAULT 'We''ve improved call quality and fixed bugs.',
  play_store_url              TEXT NOT NULL DEFAULT 'https://play.google.com/store/apps/details?id=com.example.flutter_voice_calling_app_2026',
  app_store_url               TEXT NOT NULL DEFAULT 'https://apps.apple.com/app/creomine',
  maintenance_mode            BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_title           TEXT NOT NULL DEFAULT '🔧 Maintenance',
  maintenance_message         TEXT NOT NULL DEFAULT 'We''re improving Creomine. Please come back soon.',
  maintenance_duration_minutes  INTEGER NOT NULL DEFAULT 30
    CHECK (maintenance_duration_minutes >= 0 AND maintenance_duration_minutes <= 10080),
  updated_by                  UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce single settings row
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_version_settings_singleton
  ON public.app_version_settings ((TRUE));

ALTER TABLE public.app_version_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_version_settings_deny_clients ON public.app_version_settings;
CREATE POLICY app_version_settings_deny_clients ON public.app_version_settings
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ── append-only release history ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_release_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version         TEXT NOT NULL,
  build_number    INTEGER NOT NULL CHECK (build_number > 0),
  release_type    TEXT NOT NULL DEFAULT 'optional'
    CHECK (release_type IN ('optional', 'force', 'maintenance')),
  title           TEXT NOT NULL DEFAULT '',
  message         TEXT NOT NULL DEFAULT '',
  changelog       TEXT NOT NULL DEFAULT '',
  play_store_url  TEXT NOT NULL DEFAULT '',
  app_store_url   TEXT NOT NULL DEFAULT '',
  is_active       BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_release_history_version
  ON public.app_release_history (version DESC, build_number DESC);

CREATE INDEX IF NOT EXISTS idx_app_release_history_active
  ON public.app_release_history (is_active)
  WHERE is_active = TRUE;

ALTER TABLE public.app_release_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_release_history_deny_clients ON public.app_release_history;
CREATE POLICY app_release_history_deny_clients ON public.app_release_history
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ── seed default settings row ─────────────────────────────────
INSERT INTO public.app_version_settings (
  latest_version,
  minimum_supported_version,
  force_update,
  release_type,
  title,
  message,
  play_store_url,
  app_store_url,
  maintenance_mode,
  maintenance_title,
  maintenance_message,
  maintenance_duration_minutes
)
SELECT
  '1.0.0',
  '1.0.0',
  FALSE,
  'optional',
  '🚀 New Version Available',
  'We''ve improved call quality and fixed bugs.',
  'https://play.google.com/store/apps/details?id=com.example.flutter_voice_calling_app_2026',
  'https://apps.apple.com/app/creomine',
  FALSE,
  '🔧 Maintenance',
  'We''re improving Creomine. Please come back soon.',
  30
WHERE NOT EXISTS (SELECT 1 FROM public.app_version_settings);

-- ── analytics helper RPC ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_app_version_analytics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.app_version_settings%ROWTYPE;
  v_total BIGINT;
  v_on_latest BIGINT;
  v_outdated BIGINT;
  v_blocked BIGINT;
  v_by_version JSONB;
BEGIN
  SELECT * INTO v_settings FROM public.app_version_settings LIMIT 1;

  SELECT COUNT(*) INTO v_total FROM public.users WHERE app_version IS NOT NULL;

  SELECT COUNT(*) INTO v_on_latest
  FROM public.users
  WHERE app_version = v_settings.latest_version;

  SELECT COUNT(*) INTO v_outdated
  FROM public.users
  WHERE app_version IS NOT NULL
    AND app_version <> v_settings.latest_version;

  SELECT COUNT(*) INTO v_blocked
  FROM public.users
  WHERE app_version IS NOT NULL
    AND (
      app_version < v_settings.minimum_supported_version
      OR (v_settings.force_update AND app_version <> v_settings.latest_version)
    );

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'version', version,
        'count', cnt,
        'platform', platform
      ) ORDER BY cnt DESC
    ),
    '[]'::jsonb
  ) INTO v_by_version
  FROM (
    SELECT app_version AS version, app_platform AS platform, COUNT(*) AS cnt
    FROM public.users
    WHERE app_version IS NOT NULL
    GROUP BY app_version, app_platform
  ) sub;

  RETURN jsonb_build_object(
    'totalReported', v_total,
    'onLatest', v_on_latest,
    'outdated', v_outdated,
    'blocked', v_blocked,
    'adoptionPercent', CASE WHEN v_total > 0
      THEN ROUND((v_on_latest::NUMERIC / v_total::NUMERIC) * 100, 2)
      ELSE 0 END,
    'usersByVersion', v_by_version,
    'latestVersion', v_settings.latest_version,
    'minimumSupportedVersion', v_settings.minimum_supported_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_app_version_analytics FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_version_analytics TO service_role;

COMMIT;
