"""Database privilege and schema audit tests (requires Supabase service role)."""

import os
import uuid

import pytest

from conftest import assert_rpc_denied_for_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")


@pytest.mark.skipif(not SUPABASE_URL or not SUPABASE_ANON_KEY, reason="Supabase env not set")
class TestRpcPrivileges:
    def test_anon_cannot_execute_send_gift(self):
        from supabase import create_client

        client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
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

    def test_anon_cannot_execute_gift_analytics(self):
        from supabase import create_client

        client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        assert_rpc_denied_for_client(client, "gift_analytics_summary")


@pytest.mark.skipif(not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY, reason="Service role not set")
class TestGiftCatalogIntegrity:
    def test_all_tiers_present_with_60_40_split(self):
        from supabase import create_client

        client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        rows = (
            client.from_("gifts")
            .select("name,coin_cost,creator_share_percent,platform_share_percent")
            .eq("is_active", True)
            .order("sort_order")
            .execute()
            .data
        )
        expected_costs = [10, 25, 50, 100, 250, 500, 1000, 2500]
        costs = [r["coin_cost"] for r in rows]
        assert costs == expected_costs
        for row in rows:
            gross = row["coin_cost"]
            creator = int(gross * float(row["creator_share_percent"]) / 100)
            platform = gross - creator
            assert creator + platform == gross
            assert float(row["creator_share_percent"]) + float(row["platform_share_percent"]) == 100.0
