/**
 * E2E call flow: User A → request → User B accept → end 30s → verify
 * Run: node scripts/e2e-call-test.mjs
 */
import { createRequire } from 'module';
import 'dotenv/config';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const BASE = 'http://localhost:5000/api';
const CALLER_ID = '625474da-e4d1-49c6-837c-624f036ed995';
const CREATOR_ID = '8df40697-59fd-4b7c-a709-b1389f1a89e3';
const DURATION_SEC = 30;
const EXPECTED_COINS = 10; // ceil(30/60) * ratePerMinute(10)

function signToken(userId) {
  return jwt.sign({ userId, sub: userId }, process.env.JWT_SECRET, {
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
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  const callerToken = signToken(CALLER_ID);
  const creatorToken = signToken(CREATOR_ID);

  console.log('1. User A requests call to User B (creator)...');
  const requestRes = await api('POST', '/calls/request', callerToken, {
    listenerId: CREATOR_ID,
    type: 'voice',
  });
  const callRequestId = requestRes.callRequest?.id;
  if (!callRequestId) throw new Error('No callRequest.id in response');
  console.log('   callRequestId:', callRequestId);

  console.log('2. User B accepts call...');
  const acceptRes = await api('POST', '/calls/accept', creatorToken, {
    callId: callRequestId,
  });
  const callSessionId = acceptRes.callSession?.id;
  if (!callSessionId) throw new Error('No callSession.id in response');
  console.log('   callSessionId:', callSessionId);

  console.log('3. Simulating 30s talk, then ending call...');
  const endRes = await api('POST', `/calls/active/${callSessionId}/end`, callerToken, {
    duration: DURATION_SEC,
    endedReason: 'user_hangup',
  });
  console.log('   endCall response:', JSON.stringify(endRes, null, 2));

  console.log('4. Fetching call history for User A...');
  const history = await api('GET', '/calls/history', callerToken);
  console.log('   history count:', Array.isArray(history) ? history.length : 'N/A');

  const checks = {
    coinsDeducted: endRes.coinsDeducted === EXPECTED_COINS,
    newBalance: endRes.newBalance === 1000 - EXPECTED_COINS,
    callSessionEnded: endRes.callSession?.status === 'ended',
    durationSaved: endRes.callSession?.durationSeconds === DURATION_SEC,
    historyHasCall: Array.isArray(history) && history.some((c) => c.id === callSessionId),
  };

  console.log('\n=== API CHECKS ===');
  for (const [k, v] of Object.entries(checks)) {
    console.log(`${v ? 'PASS' : 'FAIL'}  ${k}`);
  }

  console.log('\n=== IDS FOR DB VERIFICATION ===');
  console.log('callSessionId:', callSessionId);
  console.log('callRequestId:', callRequestId);
  console.log('expectedCoinsDeducted:', EXPECTED_COINS);

  const allPass = Object.values(checks).every(Boolean);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
