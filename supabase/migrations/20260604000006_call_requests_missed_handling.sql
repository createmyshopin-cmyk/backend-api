-- ============================================================
-- Migration: Missed call handling statuses on call_requests
-- Statuses: pending, accepted, rejected, missed, completed
-- ============================================================

-- Ensure status column exists (no-op if already present)
ALTER TABLE call_requests
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

-- Migrate legacy "expired" rows to "missed"
UPDATE call_requests SET status = 'missed' WHERE status = 'expired';

-- Replace status check constraint
ALTER TABLE call_requests DROP CONSTRAINT IF EXISTS call_requests_status_check;

ALTER TABLE call_requests
  ADD CONSTRAINT call_requests_status_check
  CHECK (status IN ('pending', 'accepted', 'rejected', 'missed', 'completed'));

ALTER TABLE call_requests ALTER COLUMN status SET DEFAULT 'pending';
