-- ============================================================
-- ROLLBACK: Phase 1.1 security hardening
-- WARNING: Re-opens RPC to anon/authenticated — dev only
-- ============================================================

BEGIN;

-- Restore publication (re-opens realtime leak — do not use in production)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'gift_realtime_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.gift_realtime_events;
  END IF;
END $$;

CREATE POLICY gift_realtime_events_read ON public.gift_realtime_events
  FOR SELECT TO anon, authenticated USING (true);

GRANT EXECUTE ON FUNCTION public.send_gift(UUID, UUID, UUID, UUID, TEXT)
  TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_analytics_summary()
  TO PUBLIC, anon, authenticated;

ALTER TABLE public.gift_transactions
  DROP CONSTRAINT IF EXISTS uq_gift_transactions_sender_idempotency;

ALTER TABLE public.gift_transactions
  ADD CONSTRAINT uq_gift_transactions_idempotency_key UNIQUE (idempotency_key);

DROP MATERIALIZED VIEW IF EXISTS public.gift_analytics_daily CASCADE;
DROP FUNCTION IF EXISTS public.refresh_gift_analytics_daily();
DROP FUNCTION IF EXISTS public.cleanup_gift_realtime_events();

COMMIT;
