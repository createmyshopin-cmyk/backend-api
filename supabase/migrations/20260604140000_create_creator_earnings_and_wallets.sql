-- ============================================================
-- Migration: Create creator_wallets and creator_earnings tables
-- Tracks financial balances and logs revenue share transactions.
-- ============================================================

BEGIN;

-- ── creator_wallets Table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.creator_wallets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id         UUID UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  total_earned       NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  available_balance  NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  withdrawn_amount   NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── creator_earnings Table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.creator_earnings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id         UUID REFERENCES public.calls(id) ON DELETE SET NULL,
  creator_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  gross_amount    NUMERIC(10, 2) NOT NULL,
  creator_share   NUMERIC(10, 2) NOT NULL,
  platform_share  NUMERIC(10, 2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes for Performance ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_creator_wallets_creator_id ON public.creator_wallets(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_earnings_creator_id ON public.creator_earnings(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_earnings_call_id ON public.creator_earnings(call_id);
CREATE INDEX IF NOT EXISTS idx_creator_earnings_created_at ON public.creator_earnings(created_at DESC);

-- Trigger to update updated_at on creator_wallets updates
CREATE OR REPLACE FUNCTION update_creator_wallets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_creator_wallets_updated_at ON public.creator_wallets;
CREATE TRIGGER trg_creator_wallets_updated_at
  BEFORE UPDATE ON public.creator_wallets
  FOR EACH ROW EXECUTE FUNCTION update_creator_wallets_updated_at();

COMMIT;
