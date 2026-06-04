-- ============================================================
-- Migration: calls table
-- Records every call session (active → completed/missed/etc.)
-- ============================================================

CREATE TABLE IF NOT EXISTS calls (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  creator_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type             TEXT NOT NULL DEFAULT 'voice'
                     CHECK (type IN ('voice', 'video')),
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'completed', 'missed', 'rejected', 'cancelled')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  coins_deducted   INTEGER NOT NULL DEFAULT 0,
  channel_name     TEXT,
  agora_token      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_calls_caller_id   ON calls(caller_id);
CREATE INDEX IF NOT EXISTS idx_calls_creator_id  ON calls(creator_id);
CREATE INDEX IF NOT EXISTS idx_calls_status       ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_started_at  ON calls(started_at DESC);
