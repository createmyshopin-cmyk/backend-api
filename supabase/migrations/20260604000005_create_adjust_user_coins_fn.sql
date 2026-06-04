-- ============================================================
-- Supabase helper function: adjust_user_coins
-- Atomically increments/decrements a user's coin balance.
-- Prevents balance going below 0 via GREATEST guard.
-- Used by UsersService.updateCoins() via supabase.rpc()
-- ============================================================

CREATE OR REPLACE FUNCTION adjust_user_coins(p_user_id UUID, p_delta INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  UPDATE users
     SET coins = GREATEST(0, coins + p_delta),
         updated_at = NOW()
   WHERE id = p_user_id
   RETURNING coins INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User % not found', p_user_id;
  END IF;

  RETURN v_new_balance;
END;
$$;
