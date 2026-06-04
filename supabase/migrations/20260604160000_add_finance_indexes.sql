-- ============================================================
-- Migration: Add missing performance indexes for finance dashboard
-- Optimizes query performance for transaction logs & calls.
-- ============================================================

BEGIN;

-- Indexes for payments table
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON public.payments(created_at DESC);

-- Indexes for calls table
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON public.calls(created_at DESC);

COMMIT;
