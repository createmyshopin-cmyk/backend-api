-- Fix coin_transactions.reference_id: must be payments.id (UUID), not varchar cast / Razorpay pay_xxx
BEGIN;

CREATE OR REPLACE FUNCTION public.verify_razorpay_payment_atomic(
  p_order_id VARCHAR,
  p_payment_id VARCHAR
) RETURNS json AS $$
DECLARE
  v_payment RECORD;
  v_user RECORD;
  v_new_balance INTEGER;
BEGIN
  SELECT * INTO v_payment
  FROM public.payments
  WHERE gateway_order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found';
  END IF;

  IF v_payment.status = 'success' THEN
    IF v_payment.gateway_payment_id = p_payment_id THEN
      SELECT coins INTO v_user FROM public.users WHERE id = v_payment.user_id;
      RETURN json_build_object(
        'status', 'already_verified',
        'payment', row_to_json(v_payment),
        'newBalance', v_user.coins
      );
    ELSE
      RAISE EXCEPTION 'duplicate_verification';
    END IF;
  END IF;

  IF v_payment.status != 'created' AND v_payment.status != 'pending' THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  UPDATE public.payments
  SET
    status = 'success',
    gateway_payment_id = p_payment_id,
    verified_at = NOW()
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  UPDATE public.users
  SET
    coins = coins + v_payment.coins_added,
    updated_at = NOW()
  WHERE id = v_payment.user_id
  RETURNING * INTO v_user;

  v_new_balance := v_user.coins;

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
    v_payment.coins_added,
    v_new_balance - v_payment.coins_added,
    v_new_balance,
    v_payment.id,
    'Razorpay',
    NOW()
  );

  RETURN json_build_object(
    'status', 'success',
    'payment', row_to_json(v_payment),
    'newBalance', v_new_balance
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
