-- ============================================================
-- Migration: Create coin_packages and payments tables
-- Aligns with front-end db schema and seeds standard packages.
-- ============================================================

BEGIN;

-- ── coin_packages Table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coin_packages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR NOT NULL,
  coins        INTEGER NOT NULL,
  bonus_coins  INTEGER NOT NULL DEFAULT 0,
  price        NUMERIC(10, 2) NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── payments Table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  package_id        UUID NOT NULL REFERENCES public.coin_packages(id) ON DELETE RESTRICT,
  gateway           VARCHAR NOT NULL,
  gateway_order_id  VARCHAR UNIQUE NOT NULL,
  amount            NUMERIC(10, 2) NOT NULL,
  coins_added       INTEGER NOT NULL,
  status            VARCHAR NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Seed Standard Packages ────────────────────────────────────
INSERT INTO public.coin_packages (id, name, coins, bonus_coins, price, is_active)
VALUES 
  ('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', 'Starter Pack', 100, 0, 99.00, true),
  ('b2c3d4e5-f67a-8b9c-0d1e-2f3a4b5c6d7e', 'Value Pack', 500, 50, 399.00, true),
  ('c3d4e5f6-7a8b-9c0d-1e2f-3a4b5c6d7e8f', 'Popular Pack', 1000, 150, 699.00, true)
ON CONFLICT (id) DO NOTHING;

-- Indexes for payments table
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_gateway_order_id ON public.payments(gateway_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);

COMMIT;
