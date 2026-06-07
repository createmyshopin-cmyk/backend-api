-- ============================================================
-- Migration: Creomine Gift System V1 — tables, earnings columns,
-- ledger types, realtime, seed catalog
-- ============================================================

BEGIN;

-- ── gifts catalog ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gifts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT NOT NULL,
  icon_url                TEXT,
  coin_cost               INTEGER NOT NULL CHECK (coin_cost > 0),
  creator_share_percent   NUMERIC(5, 2) NOT NULL DEFAULT 60.00,
  platform_share_percent  NUMERIC(5, 2) NOT NULL DEFAULT 40.00,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  is_active               BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gifts_share_percent_total CHECK (
    creator_share_percent + platform_share_percent = 100.00
  )
);

CREATE INDEX IF NOT EXISTS idx_gifts_active_sort
  ON public.gifts (is_active, sort_order, coin_cost);

-- ── gift transactions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gift_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  creator_id       UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE RESTRICT,
  gift_id          UUID NOT NULL REFERENCES public.gifts(id) ON DELETE RESTRICT,
  call_id          UUID NOT NULL REFERENCES public.calls(id) ON DELETE RESTRICT,
  coins_spent      INTEGER NOT NULL CHECK (coins_spent > 0),
  creator_coins    INTEGER NOT NULL CHECK (creator_coins >= 0),
  platform_coins   INTEGER NOT NULL CHECK (platform_coins >= 0),
  idempotency_key  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gift_transactions_coins_split CHECK (
    coins_spent = creator_coins + platform_coins
  ),
  CONSTRAINT uq_gift_transactions_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_gift_transactions_sender
  ON public.gift_transactions (sender_user_id);
CREATE INDEX IF NOT EXISTS idx_gift_transactions_creator
  ON public.gift_transactions (creator_id);
CREATE INDEX IF NOT EXISTS idx_gift_transactions_gift
  ON public.gift_transactions (gift_id);
CREATE INDEX IF NOT EXISTS idx_gift_transactions_call
  ON public.gift_transactions (call_id);
CREATE INDEX IF NOT EXISTS idx_gift_transactions_created_at
  ON public.gift_transactions (created_at DESC);

-- ── creator gift stats ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.creator_gift_stats (
  creator_id            UUID PRIMARY KEY REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  total_gifts           INTEGER NOT NULL DEFAULT 0,
  total_gift_coins      INTEGER NOT NULL DEFAULT 0,
  total_gift_earnings   INTEGER NOT NULL DEFAULT 0,
  today_gifts           INTEGER NOT NULL DEFAULT 0,
  week_gifts            INTEGER NOT NULL DEFAULT 0,
  month_gifts           INTEGER NOT NULL DEFAULT 0,
  last_gift_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── gift replies ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gift_replies (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_transaction_id  UUID NOT NULL REFERENCES public.gift_transactions(id) ON DELETE CASCADE,
  creator_id           UUID NOT NULL REFERENCES public.creator_profiles(id) ON DELETE CASCADE,
  sender_user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message              TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gift_replies_transaction
  ON public.gift_replies (gift_transaction_id);

-- ── realtime event outbox ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gift_realtime_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT NOT NULL CHECK (event_type IN ('gift_received', 'gift_reply')),
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gift_realtime_events_created
  ON public.gift_realtime_events (created_at DESC);

-- ── creator wallet earnings breakdown ─────────────────────────────────────────

ALTER TABLE public.creator_wallets
  ADD COLUMN IF NOT EXISTS gift_earnings_total BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS call_earnings_total BIGINT NOT NULL DEFAULT 0;

-- Backfill call_earnings_total from existing total_earned (best-effort)
UPDATE public.creator_wallets
   SET call_earnings_total = FLOOR(total_earned)::BIGINT
 WHERE call_earnings_total = 0
   AND total_earned > 0;

-- ── expand coin_transactions types ────────────────────────────────────────────

ALTER TABLE public.coin_transactions
  DROP CONSTRAINT IF EXISTS coin_transactions_type_check;

ALTER TABLE public.coin_transactions
  ADD CONSTRAINT coin_transactions_type_check
  CHECK (type IN (
    'call_deduction', 'recharge',
    'admin_adjustment_add', 'admin_adjustment_deduct',
    'refund', 'gift_deduction'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS uq_coin_tx_gift_deduction_per_idempotency
  ON public.coin_transactions (reference_id)
  WHERE type = 'gift_deduction';

-- ── expand creator_transactions types ─────────────────────────────────────────

ALTER TABLE public.creator_transactions
  DROP CONSTRAINT IF EXISTS creator_transactions_type_check;

ALTER TABLE public.creator_transactions
  ADD CONSTRAINT creator_transactions_type_check
  CHECK (type IN ('earning', 'withdrawal', 'adjustment', 'gift_earning'));

-- ── triggers ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_gifts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gifts_updated_at ON public.gifts;
CREATE TRIGGER trg_gifts_updated_at
  BEFORE UPDATE ON public.gifts
  FOR EACH ROW EXECUTE FUNCTION public.update_gifts_updated_at();

CREATE OR REPLACE FUNCTION public.update_creator_gift_stats_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_creator_gift_stats_updated_at ON public.creator_gift_stats;
CREATE TRIGGER trg_creator_gift_stats_updated_at
  BEFORE UPDATE ON public.creator_gift_stats
  FOR EACH ROW EXECUTE FUNCTION public.update_creator_gift_stats_updated_at();

-- ── RLS (service role bypasses; deny direct client writes) ────────────────────

ALTER TABLE public.gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_gift_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_realtime_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gifts_read_active ON public.gifts;
CREATE POLICY gifts_read_active ON public.gifts
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS gift_realtime_events_read ON public.gift_realtime_events;
CREATE POLICY gift_realtime_events_read ON public.gift_realtime_events
  FOR SELECT TO anon, authenticated
  USING (true);

-- ── Supabase Realtime ─────────────────────────────────────────────────────────

ALTER TABLE public.gift_realtime_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'gift_realtime_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.gift_realtime_events;
  END IF;
END $$;

-- ── seed default gift catalog ─────────────────────────────────────────────────

INSERT INTO public.gifts (name, coin_cost, sort_order)
SELECT v.name, v.coin_cost, v.sort_order
FROM (VALUES
  ('Rose', 10, 1),
  ('Heart', 25, 2),
  ('Cute Cat', 50, 3),
  ('Puppy', 100, 4),
  ('Gift Box', 250, 5),
  ('Princess Crown', 500, 6),
  ('Diamond', 1000, 7),
  ('Diamond Ring', 2500, 8)
) AS v(name, coin_cost, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.gifts LIMIT 1);

COMMIT;
