-- Restore verify_razorpay_payment_atomic: wallet-based atomic credit (production)
BEGIN;

CREATE OR REPLACE FUNCTION public.verify_razorpay_payment_atomic(
  p_order_id VARCHAR,
  p_payment_id VARCHAR
) RETURNS json AS $$
DECLARE
  v_payment RECORD;
  v_wallet RECORD;
  v_balance_before INTEGER;
  v_new_balance INTEGER;
  v_coins_added INTEGER;
BEGIN
  -- 1. Find payment by gateway_order_id (lock row to prevent concurrent verify)
  SELECT * INTO v_payment
  FROM public.payments
  WHERE gateway_order_id = p_order_id
  FOR UPDATE;

  -- 2. Validate payment exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found';
  END IF;

  v_coins_added := v_payment.coins_added;

  -- Idempotency: already verified with same Razorpay payment id
  IF v_payment.status = 'success' THEN
    IF v_payment.gateway_payment_id = p_payment_id THEN
      SELECT coin_balance INTO v_new_balance
      FROM public.wallets
      WHERE user_id = v_payment.user_id;

      RETURN json_build_object(
        'success', true,
        'coins_added', v_coins_added,
        'new_balance', COALESCE(v_new_balance, 0)
      );
    ELSE
      RAISE EXCEPTION 'duplicate_verification';
    END IF;
  END IF;

  IF v_payment.status NOT IN ('created', 'pending') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  -- 3. Lock wallet row FOR UPDATE
  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE user_id = v_payment.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id, coin_balance)
    VALUES (v_payment.user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT * INTO v_wallet
    FROM public.wallets
    WHERE user_id = v_payment.user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'wallet_not_found';
    END IF;
  END IF;

  -- 4. Read wallets.coin_balance
  v_balance_before := COALESCE(v_wallet.coin_balance, 0);

  -- 5. Calculate new balance
  v_new_balance := v_balance_before + v_coins_added;

  -- 6. Update wallets.coin_balance
  UPDATE public.wallets
  SET
    coin_balance = v_new_balance,
    updated_at = NOW()
  WHERE user_id = v_payment.user_id;

  -- 7. Update payments
  UPDATE public.payments
  SET
    status = 'success',
    gateway_payment_id = p_payment_id,
    verified_at = NOW()
  WHERE id = v_payment.id;

  -- 8. Insert recharge row into coin_transactions (reference_id = payments.id UUID)
  INSERT INTO public.coin_transactions (
    user_id,
    type,
    amount,
    balance_before,
    balance_after,
    reference_id,
    description,
    created_at
  ) VALUES (
    v_payment.user_id,
    'recharge',
    v_coins_added,
    v_balance_before,
    v_new_balance,
    v_payment.id,
    'Razorpay',
    NOW()
  );

  -- 9. Return production success payload
  RETURN json_build_object(
    'success', true,
    'coins_added', v_coins_added,
    'new_balance', v_new_balance
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Remove debug overload that shadowed the production function for text args
DROP FUNCTION IF EXISTS public.verify_razorpay_payment_atomic(text, text);

COMMIT;
