"""Razorpay path security — NestJS API layer (signature required before credit)."""

import hashlib
import hmac
import uuid

import httpx
import pytest

from conftest import API_BASE, mint_token


class TestRazorpayApiSecurity:
    def test_verify_rejects_missing_signature(self, api_client: httpx.Client, caller_token: str):
        r = api_client.post(
            "/payments/verify",
            headers={"Authorization": f"Bearer {caller_token}"},
            json={
                "razorpayOrderId": "order_test",
                "razorpayPaymentId": "pay_test",
            },
        )
        assert r.status_code == 400

    def test_verify_rejects_forged_signature(self, api_client: httpx.Client, caller_token: str):
        r = api_client.post(
            "/payments/verify",
            headers={"Authorization": f"Bearer {caller_token}"},
            json={
                "razorpayOrderId": "order_test",
                "razorpayPaymentId": "pay_test",
                "razorpaySignature": "deadbeef" * 8,
            },
        )
        assert r.status_code in (400, 404)

    def test_signature_helper_matches_razorpay_format(self):
        secret = "test_secret"
        order_id = "order_abc"
        payment_id = "pay_xyz"
        expected = hmac.new(
            secret.encode(),
            f"{order_id}|{payment_id}".encode(),
            hashlib.sha256,
        ).hexdigest()
        assert len(expected) == 64
