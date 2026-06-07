"""
Creomine load test — profiles: 100 / 250 / 500 / 1000 users
Run:
  locust -f tests/audit/locustfile.py --host=https://api.creomine.com --users 100 --spawn-rate 10 --run-time 5m
  locust -f tests/audit/locustfile.py --host=http://localhost:5000 --users 500 --spawn-rate 25 --headless --run-time 10m
"""

import os
import uuid

import jwt
from locust import HttpUser, between, task

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
CALLER_ID = os.getenv("CALLER_ID", "00000000-0000-0000-0000-000000000001")
CREATOR_ID = os.getenv("CREATOR_ID", "00000000-0000-0000-0000-000000000002")
CALL_ID = os.getenv("CALL_ID", "00000000-0000-0000-0000-000000000003")
GIFT_ID = os.getenv("GIFT_ID", "00000000-0000-0000-0000-000000000004")
CHANNEL = os.getenv("CHANNEL_NAME", "ch_load_test")


def mint_token(user_id: str) -> str:
    return jwt.encode({"userId": user_id, "sub": user_id}, JWT_SECRET, algorithm="HS256")


class CreomineUser(HttpUser):
    wait_time = between(0.2, 1.0)

    def on_start(self):
        self.caller_token = mint_token(CALLER_ID)
        self.creator_token = mint_token(CREATOR_ID)
        self.headers = {"Authorization": f"Bearer {self.caller_token}"}

    @task(5)
    def list_gifts(self):
        self.client.get("/api/gifts", headers=self.headers, name="/api/gifts")

    @task(2)
    def wallet_balance(self):
        self.client.get("/api/wallet", headers=self.headers, name="/api/wallet")

    @task(1)
    def send_gift(self):
        self.client.post(
            "/api/gifts/send",
            headers=self.headers,
            json={
                "giftId": GIFT_ID,
                "creatorId": CREATOR_ID,
                "callId": CALL_ID,
                "idempotencyKey": str(uuid.uuid4()),
            },
            name="/api/gifts/send",
        )

    @task(1)
    def gift_history(self):
        self.client.get("/api/gifts/history", headers=self.headers, name="/api/gifts/history")

    @task(1)
    def agora_token_denied_or_ok(self):
        self.client.post(
            "/api/calls/agora-token",
            headers=self.headers,
            json={"channelName": CHANNEL},
            name="/api/calls/agora-token",
        )

    @task(1)
    def creator_stats(self):
        self.client.get(
            "/api/listener/gifts/stats",
            headers={"Authorization": f"Bearer {self.creator_token}"},
            name="/api/listener/gifts/stats",
        )

    @task(1)
    def packages(self):
        self.client.get("/api/payments/packages", headers=self.headers, name="/api/payments/packages")
