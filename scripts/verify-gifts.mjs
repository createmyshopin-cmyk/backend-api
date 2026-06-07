#!/usr/bin/env node
/**
 * E2E gift system verification (requires running API + Supabase migrations applied).
 *
 * Usage:
 *   node scripts/verify-gifts.mjs
 *
 * Env:
 *   API_BASE=http://localhost:5000/api
 *   JWT_SECRET=...
 *   CALLER_ID, CREATOR_ID, CALL_ID (UUIDs for an ongoing call)
 */
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';

const API_BASE = process.env.API_BASE || 'http://localhost:5000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const CALLER_ID = process.env.CALLER_ID;
const CREATOR_ID = process.env.CREATOR_ID;
const CALL_ID = process.env.CALL_ID;

function token(userId) {
  return jwt.sign({ userId, sub: userId }, JWT_SECRET, { expiresIn: '1h' });
}

async function api(method, path, authToken, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function log(step, ok, detail) {
  console.log(`${ok ? '✓' : '✗'} ${step}: ${detail}`);
}

async function main() {
  console.log('=== Gift System E2E Verification ===\n');

  const callerToken = token(CALLER_ID || '00000000-0000-0000-0000-000000000001');

  const catalog = await api('GET', '/gifts', callerToken);
  log('GET /gifts', catalog.ok, `status=${catalog.status}, count=${catalog.data?.length ?? 0}`);

  const crown = Array.isArray(catalog.data)
    ? catalog.data.find((g) => g.name === 'Princess Crown' || g.coinCost === 500)
    : null;

  if (CALLER_ID && CREATOR_ID && CALL_ID && crown) {
    const idem = randomUUID();

    const send = await api('POST', '/gifts/send', callerToken, {
      giftId: crown.id,
      creatorId: CREATOR_ID,
      callId: CALL_ID,
      idempotencyKey: idem,
    });
    log(
      'POST /gifts/send',
      send.ok,
      `status=${send.status}, spent=${send.data?.coinsSpent}, creator=${send.data?.creatorCoins}, platform=${send.data?.platformCoins}`,
    );

    const dup = await api('POST', '/gifts/send', callerToken, {
      giftId: crown.id,
      creatorId: CREATOR_ID,
      callId: CALL_ID,
      idempotencyKey: idem,
    });
    log(
      'POST /gifts/send (duplicate idempotency)',
      dup.ok && dup.data?.duplicate === true,
      `duplicate=${dup.data?.duplicate}, balance=${dup.data?.remainingBalance}`,
    );
  } else {
    console.log('(skip send test — set CALLER_ID, CREATOR_ID, CALL_ID env vars)');
  }

  const history = await api('GET', '/gifts/history', callerToken);
  log('GET /gifts/history', history.ok, `status=${history.status}`);

  const adminLogin = await api('POST', '/auth/login', null, {
    email: 'admin@coincalling.com',
    password: 'admin123',
  });
  const adminToken = adminLogin.data?.accessToken;

  if (adminToken) {
    const analytics = await api('GET', '/admin/gifts/analytics', adminToken);
    log(
      'GET /admin/gifts/analytics',
      analytics.ok,
      `lifetimeRevenue=${analytics.data?.lifetimeRevenue}, giftCount=${analytics.data?.giftCount}`,
    );

    const adminGifts = await api('GET', '/admin/gifts', adminToken);
    log('GET /admin/gifts', adminGifts.ok, `count=${adminGifts.data?.length ?? 0}`);
  } else {
    console.log('(skip admin tests — admin login failed)');
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
