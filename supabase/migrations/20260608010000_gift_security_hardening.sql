-- ============================================================
-- AUDIT PATCH: Gift System security hardening
-- Apply BEFORE production. Addresses red-team findings.
-- ============================================================

BEGIN;

-- 1. REVOKE direct RPC execution from client roles (NestJS uses service_role)
REVOKE EXECUTE ON FUNCTION public.send_gift(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gift_analytics_summary() FROM PUBLIC, anon, authenticated;

-- Optional: grant only to service_role (Supabase service role bypasses anyway via postgres)
-- GRANT EXECUTE ON FUNCTION public.send_gift(...) TO service_role;

-- 2. Realtime: DENY client reads entirely (app uses anon key, NOT Supabase Auth)
--    auth.uid() policies do NOT work with Firebase JWT + anon key architecture.
--    Gift events must be delivered via NestJS/FCM or Supabase Broadcast with signed channel.
DROP POLICY IF EXISTS gift_realtime_events_read ON public.gift_realtime_events;
-- No SELECT policy = anon/authenticated cannot read via PostgREST/Realtime table sub.
-- Remove from realtime publication until channel-scoped delivery is implemented:
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'gift_realtime_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.gift_realtime_events;
  END IF;
END $$;

-- 3. Scope idempotency keys per sender (prevents cross-user key replay info leak)
ALTER TABLE public.gift_transactions
  DROP CONSTRAINT IF EXISTS uq_gift_transactions_idempotency_key;

ALTER TABLE public.gift_transactions
  ADD CONSTRAINT uq_gift_transactions_sender_idempotency
  UNIQUE (sender_user_id, idempotency_key);

-- 4. Gift catalog TOCTOU: lock gift row during send (requires send_gift function update)
-- See migration 20260608010001_send_gift_hardening.sql

-- 5. Index for analytics at scale
CREATE INDEX IF NOT EXISTS idx_gift_transactions_created_coins
  ON public.gift_transactions (created_at DESC, coins_spent, platform_coins, creator_coins);

CREATE INDEX IF NOT EXISTS idx_gift_realtime_events_type_created
  ON public.gift_realtime_events (event_type, created_at DESC);

COMMIT;
