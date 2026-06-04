-- ============================================================
-- Migration: Optimize Database Indexes (Production readiness)
-- Drops redundant duplicate indexes and adds missing foreign key and filter indexes.
-- ============================================================

BEGIN;

-- 1. Drop duplicate indexes (already indexed implicitly via UNIQUE constraints)
DROP INDEX IF EXISTS public.idx_creator_profiles_user_id;
DROP INDEX IF EXISTS public.idx_creator_wallets_creator_id;

-- 2. Add missing foreign key index on payments
CREATE INDEX IF NOT EXISTS idx_payments_package_id ON public.payments(package_id);

-- 3. Add missing filter index on coin_transactions type
CREATE INDEX IF NOT EXISTS idx_coin_transactions_type ON public.coin_transactions(type);

-- 4. Add missing index on calls ended_reason
CREATE INDEX IF NOT EXISTS idx_calls_ended_reason ON public.calls(ended_reason);

COMMIT;
