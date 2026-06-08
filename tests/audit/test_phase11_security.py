"""Phase 1.1 security regression tests."""

import uuid

import httpx
import jwt
import pytest

from conftest import API_BASE, JWT_SECRET, assert_rpc_denied_for_client, mint_token

VALID_IDEM = str(uuid.uuid4())


class TestMandatoryIdempotency:
    def test_missing_idempotency_key_rejected(self, api_client: httpx.Client, caller_token: str):
        r = api_client.post(
            "/gifts/send",
            headers={"Authorization": f"Bearer {caller_token}"},
            json={
                "giftId": str(uuid.uuid4()),
                "creatorId": str(uuid.uuid4()),
                "callId": str(uuid.uuid4()),
            },
        )
        assert r.status_code == 400

    def test_invalid_idempotency_format_rejected(self, api_client: httpx.Client, caller_token: str):
        r = api_client.post(
            "/gifts/send",
            headers={"Authorization": f"Bearer {caller_token}"},
            json={
                "giftId": str(uuid.uuid4()),
                "creatorId": str(uuid.uuid4()),
                "callId": str(uuid.uuid4()),
                "idempotencyKey": "not-a-uuid",
            },
        )
        assert r.status_code == 400


class TestSelfGift:
    def test_self_gift_rejected(self, api_client: httpx.Client, caller_token: str):
        import os

        caller_id = os.getenv("CALLER_ID")
        if not caller_id:
            pytest.skip("CALLER_ID not set")

        token = mint_token(caller_id)
        r = api_client.post(
            "/gifts/send",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "giftId": str(uuid.uuid4()),
                "creatorId": caller_id,
                "callId": str(uuid.uuid4()),
                "idempotencyKey": VALID_IDEM,
            },
        )
        assert r.status_code in (400, 403)


class TestCreatorAuthorization:
    def test_listener_stats_requires_creator(self, api_client: httpx.Client, caller_token: str):
        r = api_client.get(
            "/listener/gifts/stats",
            headers={"Authorization": f"Bearer {caller_token}"},
        )
        assert r.status_code == 403

    def test_reply_requires_creator(self, api_client: httpx.Client, caller_token: str):
        r = api_client.post(
            "/gifts/reply",
            headers={"Authorization": f"Bearer {caller_token}"},
            json={
                "giftTransactionId": str(uuid.uuid4()),
                "message": "❤️ Thank You",
            },
        )
        assert r.status_code == 403


class TestRateLimit:
    @pytest.mark.skip(reason="Run manually with burst traffic")
    def test_rate_limit_triggers(self, api_client: httpx.Client, caller_token: str):
        last_status = 200
        for _ in range(15):
            r = api_client.post(
                "/gifts/send",
                headers={"Authorization": f"Bearer {caller_token}"},
                json={
                    "giftId": str(uuid.uuid4()),
                    "creatorId": str(uuid.uuid4()),
                    "callId": str(uuid.uuid4()),
                    "idempotencyKey": str(uuid.uuid4()),
                },
            )
            last_status = r.status_code
        assert last_status == 429


class TestRpcLockdown:
    @pytest.mark.skipif(
        not __import__("os").environ.get("SUPABASE_ANON_KEY"),
        reason="SUPABASE_ANON_KEY not set",
    )
    def test_anon_cannot_execute_send_gift(self):
        import os
        from supabase import create_client

        client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
        assert_rpc_denied_for_client(
            client,
            "send_gift",
            {
                "p_sender_user_id": str(uuid.uuid4()),
                "p_creator_user_id": str(uuid.uuid4()),
                "p_gift_id": str(uuid.uuid4()),
                "p_call_id": str(uuid.uuid4()),
                "p_idempotency_key": str(uuid.uuid4()),
            },
        )
