-- Phase 13 — calls/call_requests RLS + withdrawal amount guard + creator_wallets FK note
-- Apply after phase12_final_remediation.sql

BEGIN;

-- Deny direct client access to call tables (NestJS service_role only)
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calls_deny_clients ON public.calls;
CREATE POLICY calls_deny_clients ON public.calls
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public.call_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_requests_deny_clients ON public.call_requests;
CREATE POLICY call_requests_deny_clients ON public.call_requests
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- Withdrawal amount must be positive
ALTER TABLE public.withdrawals
  DROP CONSTRAINT IF EXISTS withdrawals_amount_positive;
ALTER TABLE public.withdrawals
  ADD CONSTRAINT withdrawals_amount_positive CHECK (amount > 0);

-- Call billing fields non-negative
ALTER TABLE public.calls
  DROP CONSTRAINT IF EXISTS calls_coins_spent_non_negative;
ALTER TABLE public.calls
  ADD CONSTRAINT calls_coins_spent_non_negative CHECK (coins_spent IS NULL OR coins_spent >= 0);

ALTER TABLE public.calls
  DROP CONSTRAINT IF EXISTS calls_coins_deducted_non_negative;
ALTER TABLE public.calls
  ADD CONSTRAINT calls_coins_deducted_non_negative CHECK (coins_deducted IS NULL OR coins_deducted >= 0);

COMMIT;
