-- ============================================================
-- Wallet auto-create, balance sync, coin_transactions ledger
-- Keeps users.coins as source of truth (no architecture change)
-- Applied to Supabase project via MCP: wallet_sync_and_coin_transactions
-- ============================================================

-- Backfill wallets for existing users (does not modify users.coins)
INSERT INTO public.wallets (user_id, coin_balance)
SELECT u.id, COALESCE(u.coins, 0)
FROM public.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.wallets w WHERE w.user_id = u.id
);

-- One-time alignment: mirror current users.coins into wallets.coin_balance
UPDATE public.wallets w
SET coin_balance = u.coins,
    updated_at = NOW()
FROM public.users u
WHERE u.id = w.user_id
  AND w.coin_balance IS DISTINCT FROM u.coins;

-- Auto-create wallet when a new user is inserted
CREATE OR REPLACE FUNCTION public.create_wallet_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.wallets (user_id, coin_balance)
  VALUES (NEW.id, COALESCE(NEW.coins, 0))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_create_wallet ON public.users;
CREATE TRIGGER trg_users_create_wallet
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.create_wallet_for_new_user();

-- Sync wallets.coin_balance when users.coins changes
CREATE OR REPLACE FUNCTION public.sync_wallet_balance_from_user()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.wallets
     SET coin_balance = NEW.coins,
         updated_at = NOW()
   WHERE user_id = NEW.id;

  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id, coin_balance)
    VALUES (NEW.id, COALESCE(NEW.coins, 0))
    ON CONFLICT (user_id) DO UPDATE
      SET coin_balance = EXCLUDED.coin_balance,
          updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_sync_wallet_balance ON public.users;
CREATE TRIGGER trg_users_sync_wallet_balance
  AFTER UPDATE OF coins ON public.users
  FOR EACH ROW
  WHEN (OLD.coins IS DISTINCT FROM NEW.coins)
  EXECUTE FUNCTION public.sync_wallet_balance_from_user();

-- Ledger table for NestJS coin-transactions.service
CREATE TABLE IF NOT EXISTS public.coin_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL
                    CHECK (type IN (
                      'call_deduction', 'recharge',
                      'admin_adjustment_add', 'admin_adjustment_deduct', 'refund'
                    )),
  amount          INTEGER NOT NULL,
  balance_before  INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL,
  reference_id    UUID,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coin_transactions_user_id
  ON public.coin_transactions(user_id);

CREATE INDEX IF NOT EXISTS idx_coin_transactions_reference_id
  ON public.coin_transactions(reference_id);

CREATE INDEX IF NOT EXISTS idx_coin_transactions_created_at
  ON public.coin_transactions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id
  ON public.wallets(user_id);
