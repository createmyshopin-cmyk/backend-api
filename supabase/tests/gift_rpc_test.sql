-- Gift RPC acceptance + rollback checks (run manually against Supabase SQL editor)
-- Prerequisites: migrations 20260608000000–000002 applied, test users/call in ongoing state.

-- 1) Revenue split: Princess Crown 500 → creator 300, platform 200
-- SELECT (send_gift(...))->>'creator_coins';  -- expect 300

-- 2) Idempotency: same key must not double-deduct
-- SELECT (send_gift(..., 'same-key'))->>'duplicate';  -- second call: true

-- 3) Rollback: invalid call must not change balances
BEGIN;
  SELECT coins FROM users WHERE id = :sender_id;
  -- expect exception call_not_active; coins unchanged after ROLLBACK
ROLLBACK;
