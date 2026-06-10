-- ============================================================
-- Sprint 2: Admin RBAC + Immutable Audit Logs
-- ============================================================

BEGIN;

-- ── admin_users ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN (
                  'super_admin', 'finance_admin', 'moderator',
                  'support_admin', 'fraud_admin', 'operations_admin'
                )),
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended', 'revoked')),
  mfa_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES public.admin_users(id),
  revoked_at    TIMESTAMPTZ,
  revoked_by    UUID REFERENCES public.admin_users(id),
  CONSTRAINT admin_users_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON public.admin_users (lower(email));
CREATE INDEX IF NOT EXISTS idx_admin_users_role_status ON public.admin_users (role, status);

-- ── admin_sessions (revocation + role-change invalidation) ──
CREATE TABLE IF NOT EXISTS public.admin_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'revoked', 'expired')),
  role_at_issue   TEXT NOT NULL,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  revoked_reason  TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id ON public.admin_sessions (admin_id, status);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON public.admin_sessions (expires_at)
  WHERE status = 'active';

-- ── admin_invites (invite-only onboarding) ───────────────────
CREATE TABLE IF NOT EXISTS public.admin_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN (
                'super_admin', 'finance_admin', 'moderator',
                'support_admin', 'fraud_admin', 'operations_admin'
              )),
  token_hash  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at  TIMESTAMPTZ NOT NULL,
  invited_by  UUID NOT NULL REFERENCES public.admin_users(id),
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_invites_pending_email
  ON public.admin_invites (lower(email))
  WHERE status = 'pending';

-- ── admin_audit_logs (append-only) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_type        TEXT NOT NULL CHECK (actor_type IN (
                      'admin', 'system', 'webhook', 'creator'
                    )),
  actor_id          UUID,
  actor_email       TEXT,
  actor_role        TEXT,
  action            TEXT NOT NULL,
  category          TEXT NOT NULL CHECK (category IN (
                      'auth', 'authz', 'admin_lifecycle', 'user',
                      'creator', 'wallet', 'payment', 'withdrawal',
                      'gift', 'settings', 'export', 'system'
                    )),
  outcome           TEXT NOT NULL CHECK (outcome IN (
                      'success', 'denied', 'error', 'partial'
                    )),
  resource_type     TEXT NOT NULL,
  resource_id       TEXT NOT NULL,
  http_method       TEXT,
  http_path         TEXT,
  ip_address        INET,
  user_agent        TEXT,
  request_id        UUID,
  correlation_id    UUID,
  idempotency_key   TEXT,
  details           JSONB NOT NULL DEFAULT '{}',
  prev_checksum     TEXT,
  checksum          TEXT,
  retention_class   TEXT NOT NULL DEFAULT 'standard'
                    CHECK (retention_class IN ('financial', 'standard', 'security'))
);

CREATE INDEX IF NOT EXISTS idx_audit_occurred_at
  ON public.admin_audit_logs (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_actor
  ON public.admin_audit_logs (actor_id, occurred_at DESC)
  WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_resource
  ON public.admin_audit_logs (resource_type, resource_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_action
  ON public.admin_audit_logs (action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_category_financial
  ON public.admin_audit_logs (occurred_at DESC)
  WHERE category IN ('wallet', 'payment', 'withdrawal');

CREATE INDEX IF NOT EXISTS idx_audit_details_gin
  ON public.admin_audit_logs USING GIN (details jsonb_path_ops);

-- Immutability trigger
CREATE OR REPLACE FUNCTION public.deny_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_logs is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_no_update ON public.admin_audit_logs;
CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE OR DELETE ON public.admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.deny_audit_mutation();

-- ── withdrawals actor attribution columns ───────────────────
ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.admin_users(id),
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES public.admin_users(id),
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES public.admin_users(id);

COMMIT;
