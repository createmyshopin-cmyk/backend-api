-- ============================================================
-- Migration: Phase 4 Razorpay Monetization — schema hardening
--
-- ADDS:
--   1. payments.gateway_payment_id  — stores Razorpay pay_xxx ID after verify
--   2. payments.gateway_payment_id UNIQUE — prevents double-credit on retry
--   3. coin_packages.sort_order     — controls display order in app
--   4. coin_packages.description    — optional promo text per package
--   5. coin_packages.updated_at     — for admin panel "last modified" display
--   6. Additional seed packages     — Pro Pack, Mega Pack
--   7. Index on payments.status + created_at for admin dashboard queries
-- ============================================================

BEGIN;

-- ── 1. Add gateway_payment_id to payments ────────────────────────────────────
-- This is the Razorpay pay_xxx ID returned after successful checkout.
-- UNIQUE prevents two verify calls from double-crediting coins.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS gateway_payment_id VARCHAR;

-- Create unique index only on non-null values (NULL allowed for pending payments)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_gateway_payment_id
  ON public.payments (gateway_payment_id)
  WHERE gateway_payment_id IS NOT NULL;

-- ── 2. Add metadata columns to coin_packages ─────────────────────────────────

ALTER TABLE public.coin_packages
  ADD COLUMN IF NOT EXISTS description  TEXT,
  ADD COLUMN IF NOT EXISTS sort_order   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency     VARCHAR(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── 3. Seed additional packages ──────────────────────────────────────────────
INSERT INTO public.coin_packages (id, name, coins, bonus_coins, price, sort_order, description, is_active)
VALUES
  ('d4e5f6a7-b8c9-0d1e-2f3a-4b5c6d7e8f9a', 'Pro Pack',  2500,  500,  1499.00, 4, 'Best value for regular users', true),
  ('e5f6a7b8-c90d-1e2f-3a4b-5c6d7e8f9a0b', 'Mega Pack', 5000, 1500,  2799.00, 5, 'Maximum value — power users', true)
ON CONFLICT (id) DO NOTHING;

-- Update sort_order for existing seed packages
UPDATE public.coin_packages SET sort_order = 1 WHERE id = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
UPDATE public.coin_packages SET sort_order = 2 WHERE id = 'b2c3d4e5-f67a-8b9c-0d1e-2f3a4b5c6d7e';
UPDATE public.coin_packages SET sort_order = 3 WHERE id = 'c3d4e5f6-7a8b-9c0d-1e2f-3a4b5c6d7e8f';

-- ── 4. Admin dashboard query index ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payments_status_created
  ON public.payments (status, created_at DESC);

-- ── 5. RLS: ensure service-role can access coin_packages and payments ─────────
-- (Supabase default: RLS enabled, anon blocked. Service role bypasses RLS.)
-- These policies allow the Flutter app (with JWT) to read packages and
-- create/read their own payments only.

ALTER TABLE public.coin_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments      ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read active packages
CREATE POLICY IF NOT EXISTS "Authenticated users can view active packages"
  ON public.coin_packages
  FOR SELECT
  USING (is_active = true);

-- Users can only see and create their own payments
CREATE POLICY IF NOT EXISTS "Users can view own payments"
  ON public.payments
  FOR SELECT
  USING (auth.uid()::text = user_id::text);

CREATE POLICY IF NOT EXISTS "Users can insert own payments"
  ON public.payments
  FOR INSERT
  WITH CHECK (auth.uid()::text = user_id::text);

COMMIT;
