-- ============================================================
-- Phase 1 + 1.1 Final Remediation — wallet perimeter lockdown
-- Verified against live Supabase 2026-06-08
-- ============================================================

BEGIN;

-- ── STEP 2: REVOKE wallet/financial RPC from client roles ───────────────────

REVOKE EXECUTE ON FUNCTION public.adjust_user_coins(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_creator_wallet(UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.verify_razorpay_payment_atomic(VARCHAR, VARCHAR)
  FROM PUBLIC, anon, authenticated;

-- Trigger helpers must not be callable as RPC endpoints
REVOKE EXECUTE ON FUNCTION public.create_wallet_for_new_user()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.sync_wallet_balance_from_user()
  FROM PUBLIC, anon, authenticated;

-- ── STEP 3: Ledger RLS — deny-by-default for client roles ───────────────────

ALTER TABLE public.coin_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coin_transactions_deny_all ON public.coin_transactions;
CREATE POLICY coin_transactions_deny_all ON public.coin_transactions
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- Remove legacy Supabase-Auth policies (app uses Firebase JWT + NestJS, not auth.uid())
DROP POLICY IF EXISTS "Users can view own payments" ON public.payments;
DROP POLICY IF EXISTS "Users can insert own payments" ON public.payments;

-- Belt-and-suspenders explicit deny on financial tables (RLS on, no client access)
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'gift_transactions', 'creator_transactions', 'creator_earnings',
    'creator_wallets', 'wallets', 'withdrawals', 'users', 'payments'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_deny_clients ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_deny_clients ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      t, t
    );
  END LOOP;
END $$;

-- gift_replies: deny direct client access (NestJS service role only)
ALTER TABLE public.gift_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gift_replies_deny_clients ON public.gift_replies;
CREATE POLICY gift_replies_deny_clients ON public.gift_replies
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- Hide analytics MV from client roles
REVOKE ALL ON public.gift_analytics_daily FROM anon, authenticated;

-- ── STEP 4: Wallet safety constraints ───────────────────────────────────────

-- Repair inconsistent rows before adding CHECK constraints
UPDATE public.users SET coins = GREATEST(0, coins) WHERE coins < 0;
UPDATE public.wallets SET coin_balance = GREATEST(0, coin_balance) WHERE coin_balance < 0;
UPDATE public.creator_wallets
   SET available_balance = GREATEST(0, total_earned - withdrawn_amount),
       total_earned = GREATEST(0, total_earned),
       withdrawn_amount = GREATEST(0, withdrawn_amount)
 WHERE available_balance < 0 OR total_earned < 0 OR withdrawn_amount < 0;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_coins_non_negative;
ALTER TABLE public.users
  ADD CONSTRAINT users_coins_non_negative CHECK (coins >= 0);

ALTER TABLE public.wallets
  DROP CONSTRAINT IF EXISTS wallets_coin_balance_non_negative;
ALTER TABLE public.wallets
  ADD CONSTRAINT wallets_coin_balance_non_negative CHECK (coin_balance >= 0);

ALTER TABLE public.creator_wallets
  DROP CONSTRAINT IF EXISTS creator_wallets_total_earned_non_negative;
ALTER TABLE public.creator_wallets
  ADD CONSTRAINT creator_wallets_total_earned_non_negative CHECK (total_earned >= 0);

ALTER TABLE public.creator_wallets
  DROP CONSTRAINT IF EXISTS creator_wallets_available_non_negative;
ALTER TABLE public.creator_wallets
  ADD CONSTRAINT creator_wallets_available_non_negative CHECK (available_balance >= 0);

ALTER TABLE public.creator_wallets
  DROP CONSTRAINT IF EXISTS creator_wallets_withdrawn_non_negative;
ALTER TABLE public.creator_wallets
  ADD CONSTRAINT creator_wallets_withdrawn_non_negative CHECK (withdrawn_amount >= 0);

-- One reply per gift; one creator ledger row per gift earning
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_replies_per_transaction
  ON public.gift_replies (gift_transaction_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_creator_tx_gift_earning_per_gift
  ON public.creator_transactions (reference_id)
  WHERE type = 'gift_earning';

-- Partial unique: one recharge ledger entry per payment
CREATE UNIQUE INDEX IF NOT EXISTS uq_coin_tx_recharge_per_payment
  ON public.coin_transactions (reference_id)
  WHERE type = 'recharge';

-- Pin search_path on financial RPCs
ALTER FUNCTION public.send_gift(UUID, UUID, UUID, UUID, TEXT)
  SET search_path = public;
ALTER FUNCTION public.adjust_user_coins(UUID, INTEGER)
  SET search_path = public;
ALTER FUNCTION public.increment_creator_wallet(UUID, NUMERIC)
  SET search_path = public;
ALTER FUNCTION public.verify_razorpay_payment_atomic(VARCHAR, VARCHAR)
  SET search_path = public;

COMMIT;
