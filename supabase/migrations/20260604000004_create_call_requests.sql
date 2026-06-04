-- ============================================================
-- Migration: call_requests table
-- Tracks the signalling handshake before a call is accepted.
-- A new row is inserted by POST /api/calls/request.
-- The creator app accepts/rejects; status is updated accordingly.
-- ============================================================

CREATE TABLE IF NOT EXISTS call_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_id     UUID REFERENCES calls(id) ON DELETE SET NULL,
  type        TEXT NOT NULL DEFAULT 'voice'
                CHECK (type IN ('voice', 'video')),
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'rejected', 'missed', 'completed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_requests_caller_id  ON call_requests(caller_id);
CREATE INDEX IF NOT EXISTS idx_call_requests_creator_id ON call_requests(creator_id);
CREATE INDEX IF NOT EXISTS idx_call_requests_status     ON call_requests(status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_call_requests_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_call_requests_updated_at ON call_requests;
CREATE TRIGGER trg_call_requests_updated_at
  BEFORE UPDATE ON call_requests
  FOR EACH ROW EXECUTE FUNCTION update_call_requests_updated_at();
