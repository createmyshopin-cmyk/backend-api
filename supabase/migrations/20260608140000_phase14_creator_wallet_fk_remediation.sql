-- Phase 14 — Align creator_wallets.creator_id with creator_profiles.id
-- Runtime (send_gift RPC, increment_creator_wallet) keys wallets by profile id.

BEGIN;

-- Remap rows keyed by users.id → creator_profiles.id
UPDATE public.creator_wallets cw
   SET creator_id = cp.id
  FROM public.creator_profiles cp
 WHERE cw.creator_id = cp.user_id
   AND cw.creator_id IS DISTINCT FROM cp.id
   AND NOT EXISTS (
     SELECT 1 FROM public.creator_wallets existing
      WHERE existing.creator_id = cp.id
   );

-- Merge duplicate wallets after remap (keep higher balance row)
WITH ranked AS (
  SELECT id, creator_id,
         ROW_NUMBER() OVER (
           PARTITION BY creator_id
           ORDER BY available_balance DESC, total_earned DESC, updated_at DESC
         ) AS rn
    FROM public.creator_wallets
)
DELETE FROM public.creator_wallets cw
 USING ranked r
 WHERE cw.id = r.id AND r.rn > 1;

ALTER TABLE public.creator_wallets
  DROP CONSTRAINT IF EXISTS creator_wallets_creator_id_fkey;

ALTER TABLE public.creator_wallets
  ADD CONSTRAINT creator_wallets_creator_id_fkey
  FOREIGN KEY (creator_id) REFERENCES public.creator_profiles(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.creator_wallets.creator_id IS
  'References creator_profiles.id — NOT users.id';

COMMIT;
