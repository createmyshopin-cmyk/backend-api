import os
import uuid

import httpx
import jwt
import pytest
from dotenv import load_dotenv

load_dotenv()

API_BASE = os.getenv("API_BASE", "http://localhost:5000/api")
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
CALLER_ID = os.getenv("CALLER_ID")
CREATOR_ID = os.getenv("CREATOR_ID")
CALL_ID = os.getenv("CALL_ID")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")


def mint_token(user_id: str, role: str | None = None, token_type: str | None = None) -> str:
    payload = {"userId": user_id, "sub": user_id}
    if role:
        payload["role"] = role
    if token_type:
        payload["type"] = token_type
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


@pytest.fixture
def api_client():
    with httpx.Client(base_url=API_BASE, timeout=30.0) as client:
        yield client


@pytest.fixture
def caller_token():
    if not CALLER_ID:
        pytest.skip("CALLER_ID not set")
    return mint_token(CALLER_ID)


@pytest.fixture
def creator_token():
    if not CREATOR_ID:
        pytest.skip("CREATOR_ID not set")
    return mint_token(CREATOR_ID)


@pytest.fixture
def admin_token():
    return mint_token("ADM001", role="super_admin", token_type="admin")


@pytest.fixture
def forged_token():
    return jwt.encode(
        {"userId": str(uuid.uuid4()), "sub": str(uuid.uuid4())},
        "wrong-secret",
        algorithm="HS256",
    )


@pytest.fixture
def idempotency_key():
    return str(uuid.uuid4())


def assert_rpc_denied_for_client(client, rpc_name: str, payload: dict | None = None) -> None:
    """PostgREST must reject anon/authenticated RPC calls (42501 permission denied)."""
    from postgrest.exceptions import APIError

    try:
        client.rpc(rpc_name, payload or {}).execute()
        pytest.fail(f"Expected permission denied for RPC {rpc_name}")
    except APIError as exc:
        assert exc.code == "42501", f"Expected 42501, got {exc.code}: {exc}"


def assert_rpc_callable_by_service_role(client, rpc_name: str, payload: dict) -> None:
    """Service role may invoke RPC; business validation errors prove EXECUTE is granted."""
    from postgrest.exceptions import APIError

    try:
        client.rpc(rpc_name, payload).execute()
    except APIError as exc:
        # Permission denied would be a security failure; validation errors are expected.
        assert exc.code != "42501", f"service_role blocked from {rpc_name}: {exc}"
