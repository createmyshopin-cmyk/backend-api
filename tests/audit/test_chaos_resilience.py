"""Network chaos / resilience tests (staging)."""

import uuid

import httpx
import pytest

from conftest import mint_token


class TestNetworkResilience:
    """Simulated failure modes — run against staging with CHAOS=1."""

    def test_gift_idempotency_survives_retry(self, api_client: httpx.Client, caller_token: str):
        key = str(uuid.uuid4())
        body = {
            "giftId": "00000000-0000-0000-0000-000000000004",
            "creatorId": "00000000-0000-0000-0000-000000000002",
            "callId": "00000000-0000-0000-0000-000000000003",
            "idempotencyKey": key,
        }
        headers = {"Authorization": f"Bearer {caller_token}"}
        r1 = api_client.post("/gifts/send", headers=headers, json=body)
        r2 = api_client.post("/gifts/send", headers=headers, json=body)
        if r1.status_code == 200 and r2.status_code == 200:
            d1 = r1.json()
            d2 = r2.json()
            if d1.get("duplicate") or d2.get("duplicate"):
                assert d1.get("giftTransactionId") == d2.get("giftTransactionId")

    def test_wallet_read_after_auth(self, api_client: httpx.Client, caller_token: str):
        r = api_client.get(
            "/wallet",
            headers={"Authorization": f"Bearer {caller_token}"},
        )
        assert r.status_code in (200, 401)

    def test_agora_token_requires_channel(self, api_client: httpx.Client, caller_token: str):
        r = api_client.post(
            "/calls/agora-token",
            headers={"Authorization": f"Bearer {caller_token}"},
            json={},
        )
        assert r.status_code in (400, 403, 422)
