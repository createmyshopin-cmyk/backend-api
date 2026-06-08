-- ============================================================
-- Migration: Call ledger reconciliation backfill
--
-- PROBLEM:
--   Five historical call_deduction rows recorded ledger.amount at the
--   authoritative calls.coins_spent value, but the wallet was debited twice
--   (balance_after - balance_before = 2× |amount|). This broke the invariant
--   amount = balance_after - balance_before and caused +80 coin conservation drift.
--
-- SOLUTION:
--   1. Create reconciliation_adjustments audit table.
--   2. Snapshot each mismatch before mutation.
--   3. Backfill coin_transactions.amount to match actual wallet delta.
--   4. Add CHECK constraint to prevent future amount/delta drift.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.reconciliation_adjustments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coin_transaction_id UUID NOT NULL REFERENCES public.coin_transactions(id) ON DELETE RESTRICT,
  call_id             UUID REFERENCES public.calls(id) ON DELETE RESTRICT,
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  transaction_type    TEXT NOT NULL,
  ledger_amount       INTEGER NOT NULL,
  wallet_delta        INTEGER NOT NULL,
  calls_coins_spent   INTEGER,
  difference          INTEGER NOT NULL,
  adjustment_action   TEXT NOT NULL DEFAULT 'amount_backfill',
  status              TEXT NOT NULL DEFAULT 'applied'
                        CHECK (status IN ('pending', 'applied', 'reverted')),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_adjustments_coin_tx
  ON public.reconciliation_adjustments (coin_transaction_id);

CREATE INDEX IF NOT EXISTS idx_reconciliation_adjustments_call
  ON public.reconciliation_adjustments (call_id);

CREATE INDEX IF NOT EXISTS idx_reconciliation_adjustments_user
  ON public.reconciliation_adjustments (user_id);

ALTER TABLE public.reconciliation_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reconciliation_adjustments_deny_all ON public.reconciliation_adjustments;
CREATE POLICY reconciliation_adjustments_deny_all ON public.reconciliation_adjustments
  FOR ALL USING (false);

-- Snapshot mismatches before backfill (idempotent: skip already-adjusted rows)
WITH mismatched AS (
  SELECT
    ct.id,
    ct.reference_id AS call_id,
    ct.user_id,
    ct.type,
    ct.amount AS ledger_amount,
    (ct.balance_after - ct.balance_before) AS wallet_delta,
    c.coins_spent,
    ABS(ct.balance_after - ct.balance_before) - ABS(ct.amount) AS difference
  FROM public.coin_transactions ct
  LEFT JOIN public.calls c ON c.id = ct.reference_id
  WHERE ct.type = 'call_deduction'
    AND ct.amount IS DISTINCT FROM (ct.balance_after - ct.balance_before)
    AND NOT EXISTS (
      SELECT 1
      FROM public.reconciliation_adjustments ra
      WHERE ra.coin_transaction_id = ct.id
        AND ra.adjustment_action = 'amount_backfill'
        AND ra.status = 'applied'
    )
)
INSERT INTO public.reconciliation_adjustments (
  coin_transaction_id,
  call_id,
  user_id,
  transaction_type,
  ledger_amount,
  wallet_delta,
  calls_coins_spent,
  difference,
  adjustment_action,
  status,
  notes
)
SELECT
  id,
  call_id,
  user_id,
  type,
  ledger_amount,
  wallet_delta,
  coins_spent,
  difference,
  'amount_backfill',
  'applied',
  'Backfill coin_transactions.amount to match wallet balance delta (historical double-deduction on call end)'
FROM mismatched;

UPDATE public.coin_transactions ct
   SET amount = ct.balance_after - ct.balance_before
 WHERE ct.type = 'call_deduction'
   AND ct.amount IS DISTINCT FROM (ct.balance_after - ct.balance_before);

ALTER TABLE public.coin_transactions
  DROP CONSTRAINT IF EXISTS coin_transactions_amount_matches_balance_delta;

ALTER TABLE public.coin_transactions
  ADD CONSTRAINT coin_transactions_amount_matches_balance_delta
  CHECK (amount = balance_after - balance_before);

COMMIT;
