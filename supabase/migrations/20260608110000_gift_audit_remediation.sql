-- ============================================================
-- Red Team Audit Remediation — P0 wallet boundary + ledger RLS
-- Apply before production gift launch.
-- ============================================================

BEGIN;

-- P0: Block direct coin mint / creator wallet inflation via PostgREST
REVOKE EXECUTE ON FUNCTION public.adjust_user_coins(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_creator_wallet(UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;

-- P0: Protect coin ledger from Data API exposure
ALTER TABLE public.coin_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coin_transactions_deny_all ON public.coin_transactions;
CREATE POLICY coin_transactions_deny_all ON public.coin_transactions
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- H1: Hide analytics materialized view from client roles
REVOKE ALL ON public.gift_analytics_daily FROM anon, authenticated;

-- M1: One reply per gift transaction
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_replies_per_transaction
  ON public.gift_replies (gift_transaction_id);

-- M3: DB-level non-negative user balance
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_coins_non_negative;

ALTER TABLE public.users
  ADD CONSTRAINT users_coins_non_negative CHECK (coins >= 0);

-- M5: One creator ledger row per gift earning
CREATE UNIQUE INDEX IF NOT EXISTS uq_creator_tx_gift_earning_per_gift
  ON public.creator_transactions (reference_id)
  WHERE type = 'gift_earning';

-- L1: Pin search_path on send_gift
ALTER FUNCTION public.send_gift(UUID, UUID, UUID, UUID, TEXT)
  SET search_path = public;

COMMIT;
