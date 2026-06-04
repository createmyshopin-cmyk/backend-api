/**
 * Phase 4.1 verification — Razorpay Payment System.
 * Run: node scripts/verify-razorpay.mjs
 */
import { createRequire } from 'module';
import 'dotenv/config';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:5000/api';
const CALLER_ID = '625474da-e4d1-49c6-837c-624f036ed995';

const results = [];

function signToken(userId) {
  return jwt.sign({ userId, sub: userId }, process.env.JWT_SECRET || 'your-long-random-secret-at-least-32-characters', {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

function record(name, pass, apiEvidence) {
  results.push({ name, pass: pass ? 'PASS' : 'FAIL', apiEvidence });
}

async function main() {
  const token = signToken(CALLER_ID);

  console.log('Starting verification of Razorpay Coin Purchase System...');

  // 1. GET /coin-packages
  let pkgId;
  {
    const { ok, status, data } = await api('GET', '/coin-packages', token);
    const packages = Array.isArray(data) ? data : [];
    const hasPackages = packages.length > 0;
    if (hasPackages) {
      pkgId = packages[0].id;
    }
    record(
      '1. GET /coin-packages',
      ok && hasPackages,
      `GET /coin-packages → ${status}, count=${packages.length}, firstPkgId=${pkgId}`
    );
  }

  // 2. POST /payments/create-order
  let gatewayOrderId;
  let paymentId;
  {
    // Use first package ID if retrieved, or the seeded Starter Pack ID
    const targetPkgId = pkgId || 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
    const { ok, status, data } = await api('POST', '/payments/create-order', token, {
      packageId: targetPkgId,
    });

    gatewayOrderId = data?.razorpayOrder?.id;
    paymentId = data?.payment?.id;

    const orderOk = ok && gatewayOrderId && paymentId && data?.payment?.status === 'pending';
    record(
      '2. POST /payments/create-order',
      orderOk,
      `POST /payments/create-order → ${status}, paymentId=${paymentId}, razorpayOrderId=${gatewayOrderId}`
    );
  }

  // 3. POST /payments/verify (Razorpay Signature Flow)
  {
    if (gatewayOrderId) {
      const razorpayPaymentId = `pay_${Math.random().toString(36).substring(2, 10)}`;
      const keySecret = process.env.RAZORPAY_KEY_SECRET || 'mockKeySecret4567890';
      const text = `${gatewayOrderId}|${razorpayPaymentId}`;
      const razorpaySignature = crypto
        .createHmac('sha256', keySecret)
        .update(text)
        .digest('hex');

      const { ok, status, data } = await api('POST', '/payments/verify', token, {
        razorpayOrderId: gatewayOrderId,
        razorpayPaymentId,
        razorpaySignature,
      });

      const verifyOk = ok && data?.payment?.status === 'success';
      record(
        '3. POST /payments/verify (Signature Verification)',
        verifyOk,
        `POST /payments/verify → ${status}, message=${data?.message}, status=${data?.payment?.status}`
      );
    } else {
      record(
        '3. POST /payments/verify (Signature Verification)',
        false,
        'Skipped due to order creation failure'
      );
    }
  }

  // 4. POST /payments/verify (Negative test - Invalid Signature)
  {
    if (gatewayOrderId) {
      const { ok, status, data } = await api('POST', '/payments/verify', token, {
        razorpayOrderId: gatewayOrderId,
        razorpayPaymentId: 'pay_invalid123',
        razorpaySignature: 'invalid_signature_hex',
      });

      const invalidSigOk = !ok && status === 400;
      record(
        '4. POST /payments/verify (Invalid Signature Reject)',
        invalidSigOk,
        `POST /payments/verify (bad signature) → ${status}, message=${data?.message}`
      );
    } else {
      record(
        '4. POST /payments/verify (Invalid Signature Reject)',
        false,
        'Skipped due to order creation failure'
      );
    }
  }

  console.log('\n=== PHASE 4.1 RAZORPAY VERIFICATION REPORT ===\n');
  for (const r of results) {
    console.log(`${r.pass}  ${r.name}`);
    console.log(`  Evidence: ${r.apiEvidence}\n`);
  }

  const passed = results.filter((r) => r.pass === 'PASS').length;
  const pct = Math.round((passed / results.length) * 100);
  console.log(`Phase 4.1 completion: ${passed}/${results.length} (${pct}%)`);

  if (passed === results.length) {
    console.log('\nPHASE 4.1 VERIFIED ✅\n');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Verification crashed:', e.message);
  process.exit(1);
});
