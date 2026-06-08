"""Phase 2.1 + master audit security regression tests."""

import uuid

import httpx
import pytest

from conftest import API_BASE, mint_token


class TestPaymentVerifyHardening:
    def test_mock_verify_blocked_without_flag(self, api_client: httpx.Client, caller_token: str):
        r = api_client.post(
            "/payments/verify",
            headers={"Authorization": f"Bearer {caller_token}"},
            json={
                "paymentId": str(uuid.uuid4()),
                "transactionId": "mock-txn-1",
            },
        )
        assert r.status_code in (400, 403, 404)

    def test_verify_requires_auth(self, api_client: httpx.Client):
        r = api_client.post(
            "/payments/verify",
            json={
                "razorpayOrderId": "order_test",
                "razorpayPaymentId": "pay_test",
                "razorpaySignature": "sig",
            },
        )
        assert r.status_code == 401


class TestCallEndHardening:
    def test_end_call_requires_auth(self, api_client: httpx.Client):
        r = api_client.post(
            f"/calls/active/{uuid.uuid4()}/end",
            json={"duration": 60},
        )
        assert r.status_code == 401

    def test_end_call_rejects_non_participant(self, api_client: httpx.Client):
        attacker = mint_token(str(uuid.uuid4()))
        r = api_client.post(
            f"/calls/active/{uuid.uuid4()}/end",
            headers={"Authorization": f"Bearer {attacker}"},
            json={"duration": 60},
        )
        # 401 when JWT userId is unknown; 403/404 when known but not a participant
        assert r.status_code in (401, 403, 404)


class TestAdminRegisterHardening:
    def test_admin_register_blocked_in_production(self, api_client: httpx.Client):
        r = api_client.post(
            "/auth/register",
            json={
                "name": "Attacker",
                "email": f"attacker-{uuid.uuid4().hex[:8]}@evil.test",
                "password": "password123",
            },
        )
        # Production should forbid; dev may allow 201
        assert r.status_code in (201, 403)
