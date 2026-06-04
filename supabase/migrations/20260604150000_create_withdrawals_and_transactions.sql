-- ============================================================
-- Migration: Create withdrawals and creator_transactions tables
-- Implementation for Phase 4.3 (Creator Withdrawals System)
-- ============================================================

BEGIN;

-- ── withdrawals Table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.withdrawals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount               NUMERIC(12, 2) NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'paid')) DEFAULT 'pending',
  bank_account_name    TEXT,
  bank_account_number  TEXT,
  bank_ifsc            TEXT,
  upi_id               TEXT,
  admin_notes          TEXT,
  payment_reference    TEXT,
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at          TIMESTAMPTZ,
  paid_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── creator_transactions Table ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.creator_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('earning', 'withdrawal', 'adjustment')),
  amount          NUMERIC(12, 2) NOT NULL,
  balance_before  NUMERIC(12, 2) NOT NULL,
  balance_after   NUMERIC(12, 2) NOT NULL,
  reference_id    UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes for Performance ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_withdrawals_creator_id ON public.withdrawals(creator_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON public.withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_created_at ON public.withdrawals(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_creator_transactions_creator_id ON public.creator_transactions(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_transactions_type ON public.creator_transactions(type);
CREATE INDEX IF NOT EXISTS idx_creator_transactions_created_at ON public.creator_transactions(created_at DESC);

-- Trigger to update updated_at on withdrawals updates
CREATE OR REPLACE FUNCTION update_withdrawals_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_withdrawals_updated_at ON public.withdrawals;
CREATE TRIGGER trg_withdrawals_updated_at
  BEFORE UPDATE ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION update_withdrawals_updated_at();

COMMIT;
