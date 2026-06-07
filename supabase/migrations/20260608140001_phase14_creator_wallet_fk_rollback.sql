-- ROLLBACK for phase14 — only use in dev/staging emergencies
BEGIN;

ALTER TABLE public.creator_wallets
  DROP CONSTRAINT IF EXISTS creator_wallets_creator_id_fkey;

ALTER TABLE public.creator_wallets
  ADD CONSTRAINT creator_wallets_creator_id_fkey
  FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

COMMIT;
