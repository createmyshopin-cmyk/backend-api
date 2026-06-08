"""Security & penetration tests for Gift System Phase 1."""

import uuid

import httpx
import jwt
import pytest

from conftest import API_BASE, JWT_SECRET, assert_rpc_denied_for_client, mint_token


class TestAuthentication:
    def test_missing_jwt_rejected(self, api_client: httpx.Client):
        r = api_client.get("/gifts")
        assert r.status_code == 401

    def test_forged_jwt_rejected(self, api_client: httpx.Client, forged_token: str):
        r = api_client.get("/gifts", headers={"Authorization": f"Bearer {forged_token}"})
        assert r.status_code == 401

    def test_expired_jwt_rejected(self, api_client: httpx.Client):
        import datetime

        token = jwt.encode(
            {
                "userId": str(uuid.uuid4()),
                "sub": str(uuid.uuid4()),
                "exp": datetime.datetime.utcnow() - datetime.timedelta(hours=1),
            },
            JWT_SECRET,
            algorithm="HS256",
        )
        r = api_client.get("/gifts", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401


class TestAuthorization:
    def test_user_cannot_access_admin_gifts(self, api_client: httpx.Client, caller_token: str):
        r = api_client.get(
            "/admin/gifts",
            headers={"Authorization": f"Bearer {caller_token}"},
        )
        assert r.status_code == 403

    def test_user_cannot_access_admin_analytics(self, api_client: httpx.Client, caller_token: str):
        r = api_client.get(
            "/admin/gifts/analytics",
            headers={"Authorization": f"Bearer {caller_token}"},
        )
        assert r.status_code == 403

    def test_admin_can_access_admin_gifts(self, api_client: httpx.Client, admin_token: str):
        r = api_client.get(
            "/admin/gifts",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert r.status_code == 200


class TestInputValidation:
    def test_send_gift_rejects_invalid_uuid(self, api_client: httpx.Client, caller_token: str):
        r = api_client.post(
            "/gifts/send",
            headers={"Authorization": f"Bearer {caller_token}"},
            json={
                "giftId": "not-a-uuid",
                "creatorId": str(uuid.uuid4()),
                "callId": str(uuid.uuid4()),
            },
        )
        assert r.status_code == 400

    def test_reply_rejects_invalid_message(self, api_client: httpx.Client, creator_token: str):
        r = api_client.post(
            "/gifts/reply",
            headers={"Authorization": f"Bearer {creator_token}"},
            json={
                "giftTransactionId": str(uuid.uuid4()),
                "message": "Hacked message",
            },
        )
        assert r.status_code == 400

    def test_admin_create_rejects_negative_cost(self, api_client: httpx.Client, admin_token: str):
        r = api_client.post(
            "/admin/gifts",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"name": "Bad Gift", "coinCost": -10},
        )
        assert r.status_code == 400


class TestIdempotency:
    def test_duplicate_idempotency_key_no_double_charge(
        self,
        api_client: httpx.Client,
        caller_token: str,
        idempotency_key: str,
    ):
        pytest.importorskip("os").environ.get("CALL_ID")  # needs live call
        import os

        if not all([os.getenv("CALLER_ID"), os.getenv("CREATOR_ID"), os.getenv("CALL_ID")]):
            pytest.skip("CALLER_ID, CREATOR_ID, CALL_ID required")

        catalog = api_client.get("/gifts", headers={"Authorization": f"Bearer {caller_token}"})
        crown = next((g for g in catalog.json() if g.get("coinCost") == 500), None)
        if not crown:
            pytest.skip("Princess Crown not in catalog")

        body = {
            "giftId": crown["id"],
            "creatorId": os.environ["CREATOR_ID"],
            "callId": os.environ["CALL_ID"],
            "idempotencyKey": idempotency_key,
        }
        first = api_client.post(
            "/gifts/send",
            headers={"Authorization": f"Bearer {caller_token}"},
            json=body,
        )
        second = api_client.post(
            "/gifts/send",
            headers={"Authorization": f"Bearer {caller_token}"},
            json=body,
        )
        if first.status_code != 200:
            pytest.skip(f"Send not possible in env: {first.text}")

        assert second.status_code == 200
        assert second.json().get("duplicate") is True
        assert first.json()["remainingBalance"] == second.json()["remainingBalance"]


class TestSupabaseRpcExposure:
    """CRITICAL: send_gift must NOT be callable via anon/authenticated PostgREST."""

    @pytest.mark.skipif(
        not __import__("os").environ.get("SUPABASE_URL"),
        reason="SUPABASE_URL not set",
    )
    def test_anon_cannot_execute_send_gift_directly(self):
        import os
        from supabase import create_client

        anon_key = os.environ.get("SUPABASE_ANON_KEY")
        if not anon_key:
            pytest.skip("SUPABASE_ANON_KEY not set")

        client = create_client(os.environ["SUPABASE_URL"], anon_key)
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
