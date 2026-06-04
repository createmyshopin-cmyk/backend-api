-- ============================================================
-- Migration: Call lifecycle statuses, coins_spent, transactions,
--            creator is_online presence
-- ============================================================

-- ── calls: lifecycle statuses (analytics backbone) ──────────────────────────

UPDATE calls SET status = 'ongoing' WHERE status = 'active';
UPDATE calls SET status = 'ended' WHERE status = 'completed';

ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_status_check;

ALTER TABLE calls
  ADD CONSTRAINT calls_status_check
  CHECK (status IN (
    'requested', 'accepted', 'ringing', 'ongoing',
    'ended', 'missed', 'rejected', 'cancelled'
  ));

ALTER TABLE calls ALTER COLUMN status SET DEFAULT 'requested';

-- Spec field name: coins_spent (keep coins_deducted in sync via app layer)
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS coins_spent INTEGER NOT NULL DEFAULT 0;

UPDATE calls SET coins_spent = coins_deducted WHERE coins_spent = 0 AND coins_deducted <> 0;

-- ── call_requests: align handshake statuses ─────────────────────────────────

UPDATE call_requests SET status = 'requested' WHERE status = 'pending';
UPDATE call_requests SET status = 'accepted' WHERE status = 'completed';

ALTER TABLE call_requests DROP CONSTRAINT IF EXISTS call_requests_status_check;

ALTER TABLE call_requests
  ADD CONSTRAINT call_requests_status_check
  CHECK (status IN ('requested', 'accepted', 'rejected', 'missed', 'cancelled'));

ALTER TABLE call_requests ALTER COLUMN status SET DEFAULT 'requested';

-- ── coin_transactions: ledger for call deductions & top-ups ─────────────────

CREATE TABLE IF NOT EXISTS coin_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL
                    CHECK (type IN (
                      'call_deduction', 'recharge',
                      'admin_adjustment_add', 'admin_adjustment_deduct', 'refund'
                    )),
  amount          INTEGER NOT NULL,
  balance_before  INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL,
  reference_id    UUID,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coin_transactions_user_id
  ON coin_transactions(user_id);

CREATE INDEX IF NOT EXISTS idx_coin_transactions_reference_id
  ON coin_transactions(reference_id);

-- ── creator_profiles: is_online + last_seen_at ──────────────────────────────

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

UPDATE creator_profiles
SET is_online = COALESCE(online_status, false)
WHERE is_online IS DISTINCT FROM COALESCE(online_status, false);
