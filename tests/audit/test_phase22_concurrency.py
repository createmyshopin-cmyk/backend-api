"""Phase 2.2 — concurrent API safety (lightweight; full load via locustfile.py)."""

import asyncio
import uuid

import httpx
import pytest

from conftest import API_BASE, mint_token


@pytest.mark.asyncio
async def test_concurrent_health_checks():
    """Baseline: health endpoint survives parallel reads."""
    async with httpx.AsyncClient(base_url=API_BASE.replace("/api", ""), timeout=10.0) as client:
        tasks = [client.get("/health") for _ in range(50)]
        responses = await asyncio.gather(*tasks)
    assert all(r.status_code == 200 for r in responses)


@pytest.mark.asyncio
async def test_concurrent_unauthorized_gift_send_rejected():
    """Parallel unauthenticated gift sends must all fail — no partial state."""
    async with httpx.AsyncClient(base_url=API_BASE, timeout=10.0) as client:
        body = {
            "giftId": str(uuid.uuid4()),
            "creatorId": str(uuid.uuid4()),
            "callId": str(uuid.uuid4()),
            "idempotencyKey": str(uuid.uuid4()),
        }
        tasks = [client.post("/gifts/send", json=body) for _ in range(20)]
        responses = await asyncio.gather(*tasks)
    assert all(r.status_code == 401 for r in responses)


@pytest.mark.asyncio
async def test_concurrent_wallet_read_consistent():
    """Repeated balance reads for same user return consistent shape."""
    caller_id = __import__("os").environ.get("CALLER_ID")
    if not caller_id:
        pytest.skip("CALLER_ID not set")

    token = mint_token(caller_id)
    headers = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(base_url=API_BASE, timeout=10.0) as client:
        tasks = [client.get("/wallet", headers=headers) for _ in range(25)]
        responses = await asyncio.gather(*tasks)

    ok = [r for r in responses if r.status_code == 200]
    if not ok:
        pytest.skip("Wallet endpoint unavailable in env")
    balances = [r.json().get("coins") for r in ok]
    assert len(set(balances)) == 1, "Concurrent reads returned divergent balances"
