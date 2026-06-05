-- ============================================================
-- Migration: Phase 4 Atomic Credit and Verification Check
--
-- ADDS:
--   1. payments.verified_at         — timestamp of verification
--   2. payments.status              — Check constraint update to allow 'created'
--   3. verify_razorpay_payment_atomic() — RPC function for atomic credit
-- ============================================================

BEGIN;

-- 1. Add verified_at column
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- 2. Update CHECK constraint for status to include 'created'
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check CHECK (status IN ('created', 'pending', 'success', 'failed', 'refunded'));

-- 3. Create the RPC for atomic wallet crediting
-- Input: gateway_order_id, gateway_payment_id
-- Output: json containing success status, payment row, and newBalance
CREATE OR REPLACE FUNCTION public.verify_razorpay_payment_atomic(
  p_order_id VARCHAR,
  p_payment_id VARCHAR
) RETURNS json AS $$
DECLARE
  v_payment RECORD;
  v_user RECORD;
  v_new_balance INTEGER;
BEGIN
  -- Lock the payment row to prevent race conditions
  SELECT * INTO v_payment
  FROM public.payments
  WHERE gateway_order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found';
  END IF;

  -- Idempotency / Duplicate check
  IF v_payment.status = 'success' THEN
    IF v_payment.gateway_payment_id = p_payment_id THEN
      -- Already processed successfully with same payment id, return success idempotently
      SELECT coins INTO v_user FROM public.users WHERE id = v_payment.user_id;
      RETURN json_build_object(
        'status', 'already_verified',
        'payment', row_to_json(v_payment),
        'newBalance', v_user.coins
      );
    ELSE
      -- Different payment ID for already successful order -> duplicate attempt
      RAISE EXCEPTION 'duplicate_verification';
    END IF;
  END IF;

  -- Ensure payment is not failed or refunded
  IF v_payment.status != 'created' AND v_payment.status != 'pending' THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  -- Update Payment row atomically
  UPDATE public.payments
  SET 
    status = 'success',
    gateway_payment_id = p_payment_id,
    verified_at = NOW()
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  -- Increment User Coins
  UPDATE public.users
  SET 
    coins = coins + v_payment.coins_added,
    updated_at = NOW()
  WHERE id = v_payment.user_id
  RETURNING * INTO v_user;

  v_new_balance := v_user.coins;

  -- Insert Coin Transaction ledger entry
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
    v_payment.id::varchar,
    'Razorpay',
    NOW()
  );

  -- Return success object
  RETURN json_build_object(
    'status', 'success',
    'payment', row_to_json(v_payment),
    'newBalance', v_new_balance
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
