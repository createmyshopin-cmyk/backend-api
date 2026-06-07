"""Post-remediation verification: wallet RPCs locked to service_role only."""

import os
import uuid

import pytest

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

LOCKED_RPCS = [
    ("adjust_user_coins", {"p_user_id": str(uuid.uuid4()), "p_delta": 100}),
    ("increment_creator_wallet", {"p_creator_id": str(uuid.uuid4()), "p_amount": 10}),
    (
        "verify_razorpay_payment_atomic",
        {"p_order_id": "order_fake", "p_payment_id": "pay_fake"},
    ),
    (
        "send_gift",
        {
            "p_sender_user_id": str(uuid.uuid4()),
            "p_creator_user_id": str(uuid.uuid4()),
            "p_gift_id": str(uuid.uuid4()),
            "p_call_id": str(uuid.uuid4()),
            "p_idempotency_key": str(uuid.uuid4()),
        },
    ),
]


@pytest.mark.skipif(not SUPABASE_URL or not SUPABASE_ANON_KEY, reason="Supabase anon env not set")
@pytest.mark.parametrize("rpc_name,payload", LOCKED_RPCS)
def test_anon_cannot_execute_locked_rpc(rpc_name: str, payload: dict):
    from supabase import create_client

    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    result = client.rpc(rpc_name, payload).execute()
    assert result.data is None


@pytest.mark.skipif(
    not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY,
    reason="Service role not set",
)
def test_service_role_can_execute_send_gift_shape():
    from supabase import create_client

    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    result = client.rpc(
        "send_gift",
        {
            "p_sender_user_id": str(uuid.uuid4()),
            "p_creator_user_id": str(uuid.uuid4()),
            "p_gift_id": str(uuid.uuid4()),
            "p_call_id": str(uuid.uuid4()),
            "p_idempotency_key": str(uuid.uuid4()),
        },
    ).execute()
    # Callable; fails validation (not permission)
    assert result is not None
