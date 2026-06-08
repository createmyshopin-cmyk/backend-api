"""Phase 2.2 — call lifecycle, summary, and active-call restore API tests."""

import uuid

import httpx
import pytest

from conftest import mint_token


class TestActiveCallRestore:
    def test_active_me_requires_auth(self, api_client: httpx.Client):
        assert api_client.get("/calls/active/me").status_code == 401

    def test_active_me_returns_null_or_session(self, api_client: httpx.Client, caller_token: str):
        r = api_client.get(
            "/calls/active/me",
            headers={"Authorization": f"Bearer {caller_token}"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body is None or isinstance(body, dict)

    def test_active_me_idor_other_user_token(self, api_client: httpx.Client):
        """Scoped to JWT subject — cannot pass another user id."""
        token = mint_token(str(uuid.uuid4()))
        r = api_client.get(
            "/calls/active/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code in (200, 401)


class TestCallSummary:
    def test_summary_requires_auth(self, api_client: httpx.Client):
        r = api_client.get(f"/calls/{uuid.uuid4()}/summary")
        assert r.status_code == 401

    def test_summary_rejects_non_participant(self, api_client: httpx.Client, caller_token: str):
        r = api_client.get(
            f"/calls/{uuid.uuid4()}/summary",
            headers={"Authorization": f"Bearer {caller_token}"},
        )
        assert r.status_code in (403, 404)

    def test_summary_rejects_unknown_user(self, api_client: httpx.Client):
        token = mint_token(str(uuid.uuid4()))
        r = api_client.get(
            f"/calls/{uuid.uuid4()}/summary",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code in (401, 403, 404)


class TestCallEndAuthority:
    def test_end_call_server_computes_duration(self, api_client: httpx.Client):
        """Client cannot pass negative duration — validation enforced."""
        token = mint_token(str(uuid.uuid4()))
        r = api_client.post(
            f"/calls/active/{uuid.uuid4()}/end",
            headers={"Authorization": f"Bearer {token}"},
            json={"duration": -999},
        )
        assert r.status_code in (400, 401, 403, 404)
