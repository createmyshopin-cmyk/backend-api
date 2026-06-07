"""Final production audit — security regression suite."""

import uuid

import jwt
import pytest

from conftest import JWT_SECRET, mint_token


class TestJwtSecurity:
    def test_missing_token_rejected(self, api_client):
        assert api_client.get("/gifts").status_code == 401

    def test_forged_token_rejected(self, api_client, forged_token):
        r = api_client.get("/gifts", headers={"Authorization": f"Bearer {forged_token}"})
        assert r.status_code == 401


class TestFinancialEndpoints:
    def test_admin_gifts_forbidden_for_user(self, api_client, caller_token):
        r = api_client.get("/admin/gifts", headers={"Authorization": f"Bearer {caller_token}"})
        assert r.status_code == 403

    def test_wallet_adjust_forbidden_for_user(self, api_client, caller_token):
        r = api_client.post(
            "/wallets/adjust",
            headers={"Authorization": f"Bearer {caller_token}"},
            json={"userId": str(uuid.uuid4()), "amount": 9999, "reason": "attack"},
        )
        assert r.status_code == 403

    def test_mock_payment_blocked(self, api_client, caller_token):
        r = api_client.post(
            "/payments/verify",
            headers={"Authorization": f"Bearer {caller_token}"},
            json={"paymentId": str(uuid.uuid4()), "transactionId": "fake"},
        )
        assert r.status_code in (400, 403, 404)


class TestAgoraSecurity:
    def test_agora_token_requires_channel(self, api_client, caller_token):
        r = api_client.post(
            "/calls/agora-token",
            headers={"Authorization": f"Bearer {caller_token}"},
            json={},
        )
        assert r.status_code in (400, 403, 422)

    def test_agora_token_rejects_unknown_channel(self, api_client, caller_token):
        r = api_client.post(
            "/calls/agora-token",
            headers={"Authorization": f"Bearer {caller_token}"},
            json={"channelName": f"ch_attack_{uuid.uuid4().hex}"},
        )
        assert r.status_code in (403, 404)
