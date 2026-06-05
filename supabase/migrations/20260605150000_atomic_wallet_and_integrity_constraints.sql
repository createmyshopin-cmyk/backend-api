-- ============================================================
-- Migration: Atomic wallet increment + financial integrity constraints
--
-- PROBLEM:
--   The NestJS application was using a read-modify-write pattern to update
--   creator_wallets (SELECT then UPDATE), which is NOT concurrency-safe.
--   Concurrent end-call requests could race, causing lost wallet credits.
--
--   Additionally, no UNIQUE constraints existed on creator_earnings(call_id)
--   or coin_transactions(reference_id, type=call_deduction), allowing
--   double-charged callers and double-paid creators under concurrent requests.
--
-- SOLUTION:
--   1. Atomic Postgres function `increment_creator_wallet` that uses a single
--      SQL statement for the update (atomically adds to existing columns).
--      Uses INSERT ON CONFLICT DO UPDATE (UPSERT) to also handle the case
--      where no wallet row exists yet.
--   2. UNIQUE constraint on creator_earnings(call_id) — one earning per call.
--   3. Partial UNIQUE index on coin_transactions(reference_id) WHERE
--      type = 'call_deduction' — one deduction ledger entry per call.
-- ============================================================

BEGIN;

-- ── 1. Atomic creator wallet upsert function ──────────────────────────────────

CREATE OR REPLACE FUNCTION increment_creator_wallet(
  p_creator_id UUID,
  p_amount     NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.creator_wallets (
    creator_id,
    total_earned,
    available_balance,
    withdrawn_amount,
    created_at,
    updated_at
  )
  VALUES (
    p_creator_id,
    p_amount,
    p_amount,
    0.00,
    NOW(),
    NOW()
  )
  ON CONFLICT (creator_id) DO UPDATE
    SET total_earned      = public.creator_wallets.total_earned      + EXCLUDED.total_earned,
        available_balance = public.creator_wallets.available_balance + EXCLUDED.available_balance,
        updated_at        = NOW();
END;
$$;

COMMENT ON FUNCTION increment_creator_wallet(UUID, NUMERIC) IS
  'Atomically credits a creator wallet. Uses INSERT … ON CONFLICT DO UPDATE '
  'so the balance is incremented in a single statement, safe under concurrent calls.';

-- ── 2. Unique earning per call ────────────────────────────────────────────────
-- Ensures only one creator_earnings row can exist for a given call_id.
-- Concurrent duplicate end-call requests will hit a conflict and fail on the
-- second insert, preventing double payment.

ALTER TABLE public.creator_earnings
  ADD CONSTRAINT uq_creator_earnings_call_id UNIQUE (call_id);

-- ── 3. Unique call_deduction ledger entry per call ────────────────────────────
-- A partial unique index on coin_transactions ensures a single call_deduction
-- entry per reference_id (call). The NULLS NOT DISTINCT clause (PG 15+) is not
-- needed here since reference_id is required for call_deduction rows.

CREATE UNIQUE INDEX IF NOT EXISTS uq_coin_tx_call_deduction_per_call
  ON public.coin_transactions (reference_id)
  WHERE type = 'call_deduction';

COMMIT;
