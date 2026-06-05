-- ============================================================
-- Migration: align calls + call_requests with NestJS backend
-- Safe on empty tables: renames legacy columns, adds missing
-- fields, indexes, FKs, and lifecycle status constraints.
-- ============================================================

BEGIN;

-- ── call_requests: rename legacy columns ────────────────────────────────────

ALTER TABLE call_requests DROP CONSTRAINT IF EXISTS call_requests_receiver_id_fkey;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'call_requests' AND column_name = 'receiver_id'
  ) THEN
    ALTER TABLE call_requests RENAME COLUMN receiver_id TO creator_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'call_requests' AND column_name = 'call_type'
  ) THEN
    ALTER TABLE call_requests RENAME COLUMN call_type TO type;
  END IF;
END $$;

-- ── call_requests: add missing columns ──────────────────────────────────────

ALTER TABLE call_requests ADD COLUMN IF NOT EXISTS call_id UUID;
ALTER TABLE call_requests ADD COLUMN IF NOT EXISTS channel_name TEXT;
ALTER TABLE call_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── call_requests: lifecycle statuses ───────────────────────────────────────

UPDATE call_requests SET status = 'requested' WHERE status = 'pending';
UPDATE call_requests SET status = 'accepted' WHERE status = 'completed';

ALTER TABLE call_requests ALTER COLUMN status SET DEFAULT 'requested';
ALTER TABLE call_requests ALTER COLUMN status SET NOT NULL;

ALTER TABLE call_requests DROP CONSTRAINT IF EXISTS call_requests_status_check;
ALTER TABLE call_requests
  ADD CONSTRAINT call_requests_status_check
  CHECK (status IN ('requested', 'accepted', 'rejected', 'missed', 'cancelled'));

ALTER TABLE call_requests DROP CONSTRAINT IF EXISTS call_requests_type_check;
ALTER TABLE call_requests
  ADD CONSTRAINT call_requests_type_check
  CHECK (type IN ('voice', 'video'));

-- ── calls: drop legacy FKs before column changes ────────────────────────────

ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_receiver_id_fkey;
ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_call_request_id_fkey;

-- ── calls: rename legacy columns ────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calls' AND column_name = 'receiver_id'
  ) THEN
    ALTER TABLE calls RENAME COLUMN receiver_id TO creator_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calls' AND column_name = 'call_type'
  ) THEN
    ALTER TABLE calls RENAME COLUMN call_type TO type;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calls' AND column_name = 'agora_channel'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calls' AND column_name = 'channel_name'
  ) THEN
    ALTER TABLE calls RENAME COLUMN agora_channel TO channel_name;
  END IF;
END $$;

-- ── calls: add missing columns ──────────────────────────────────────────────

ALTER TABLE calls ADD COLUMN IF NOT EXISTS channel_name TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS coins_deducted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS coins_spent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS ended_reason TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS agora_token TEXT;

-- Migrate legacy coin column if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calls' AND column_name = 'coins_charged'
  ) THEN
    UPDATE calls
    SET coins_deducted = coins_charged,
        coins_spent = coins_charged
    WHERE coins_charged <> 0;
  END IF;
END $$;

-- ── calls: drop unused legacy columns (NestJS links via call_requests.call_id) ─

ALTER TABLE calls DROP COLUMN IF EXISTS call_request_id;
ALTER TABLE calls DROP COLUMN IF EXISTS creator_rate;
ALTER TABLE calls DROP COLUMN IF EXISTS coins_charged;
ALTER TABLE calls DROP COLUMN IF EXISTS creator_earning;

-- ── calls: lifecycle statuses ───────────────────────────────────────────────

UPDATE calls SET status = 'ongoing' WHERE status = 'active';
UPDATE calls SET status = 'ended' WHERE status = 'completed';

ALTER TABLE calls ALTER COLUMN status SET DEFAULT 'requested';
ALTER TABLE calls ALTER COLUMN status SET NOT NULL;

ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_status_check;
ALTER TABLE calls
  ADD CONSTRAINT calls_status_check
  CHECK (status IN (
    'requested', 'accepted', 'ringing', 'ongoing',
    'ended', 'missed', 'rejected', 'cancelled'
  ));

ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_type_check;
ALTER TABLE calls
  ADD CONSTRAINT calls_type_check
  CHECK (type IS NULL OR type IN ('voice', 'video'));

-- Ensure type has sensible default for new rows
ALTER TABLE calls ALTER COLUMN type SET DEFAULT 'voice';

-- ── foreign keys ────────────────────────────────────────────────────────────

ALTER TABLE call_requests DROP CONSTRAINT IF EXISTS call_requests_creator_id_fkey;
ALTER TABLE call_requests
  ADD CONSTRAINT call_requests_creator_id_fkey
  FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE call_requests DROP CONSTRAINT IF EXISTS call_requests_call_id_fkey;
ALTER TABLE call_requests
  ADD CONSTRAINT call_requests_call_id_fkey
  FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE SET NULL;

ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_creator_id_fkey;
ALTER TABLE calls
  ADD CONSTRAINT calls_creator_id_fkey
  FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE RESTRICT;

-- caller_id FK already exists; ensure ON DELETE RESTRICT
ALTER TABLE call_requests DROP CONSTRAINT IF EXISTS call_requests_caller_id_fkey;
ALTER TABLE call_requests
  ADD CONSTRAINT call_requests_caller_id_fkey
  FOREIGN KEY (caller_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_caller_id_fkey;
ALTER TABLE calls
  ADD CONSTRAINT calls_caller_id_fkey
  FOREIGN KEY (caller_id) REFERENCES users(id) ON DELETE RESTRICT;

-- ── indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_calls_caller_id ON calls(caller_id);
CREATE INDEX IF NOT EXISTS idx_calls_creator_id ON calls(creator_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_requests_caller_id ON call_requests(caller_id);
CREATE INDEX IF NOT EXISTS idx_call_requests_creator_id ON call_requests(creator_id);
CREATE INDEX IF NOT EXISTS idx_call_requests_status ON call_requests(status);
CREATE INDEX IF NOT EXISTS idx_call_requests_call_id ON call_requests(call_id);

-- ── call_requests updated_at trigger ────────────────────────────────────────

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

COMMIT;
