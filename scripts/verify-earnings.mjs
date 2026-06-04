/**
 * Phase 4.2 verification — Creator Earnings System.
 * Run: node scripts/verify-earnings.mjs
 */
import { createRequire } from 'module';
import 'dotenv/config';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const BASE = process.env.API_BASE || 'http://localhost:5000/api';
const CALLER_ID = '625474da-e4d1-49c6-837c-624f036ed995';
const CREATOR_ID = '8df40697-59fd-4b7c-a709-b1389f1a89e3';

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
  const callerToken = signToken(CALLER_ID);
  const creatorToken = signToken(CREATOR_ID);

  console.log('Starting verification of Creator Earnings System...');

  // 1. GET /creators/wallet/balance (Pre-call check)
  let initialBalance = 0;
  {
    const { ok, status, data } = await api('GET', '/creators/wallet/balance', creatorToken);
    initialBalance = data?.availableBalance ?? 0;
    record(
      '1. GET /creators/wallet/balance (Initial)',
      ok,
      `GET /creators/wallet/balance → ${status}, initialBalance=${initialBalance}`
    );
  }

  // 2. Perform a call lifecycle (Request, Accept, and End)
  let callSessionId;
  let coinsDeducted = 0;
  {
    // Request call
    const req = await api('POST', '/calls/request', callerToken, {
      listenerId: CREATOR_ID,
      type: 'voice',
    });
    const callRequestId = req.data?.callRequest?.id;

    if (callRequestId) {
      // Accept call
      const acc = await api('POST', '/calls/accept', creatorToken, {
        callId: callRequestId,
      });
      callSessionId = acc.data?.callSession?.id;

      if (callSessionId) {
        // Transition to ringing & ongoing
        await api('PATCH', `/calls/active/${callSessionId}/status`, callerToken, { status: 'ringing' });
        await api('PATCH', `/calls/active/${callSessionId}/status`, callerToken, { status: 'ongoing' });

        // End call
        const duration = 65; // 65 seconds = 2 minutes. 2 * 10 coins/min = 20 coins
        const end = await api('POST', `/calls/active/${callSessionId}/end`, callerToken, {
          duration,
          endedReason: 'user_hangup',
        });
        coinsDeducted = end.data?.coinsDeducted ?? 0;

        record(
          '2. Call Flow execution',
          end.ok && coinsDeducted > 0,
          `Call cycle completed. session=${callSessionId}, coinsDeducted=${coinsDeducted}`
        );
      } else {
        record('2. Call Flow execution', false, `Accept call failed: ${JSON.stringify(acc.data)}`);
      }
    } else {
      record('2. Call Flow execution', false, `Request call failed: ${JSON.stringify(req.data)}`);
    }
  }

  // 3. GET /creators/wallet/balance (Post-call check)
  let postBalance = 0;
  {
    if (callSessionId && coinsDeducted > 0) {
      const { ok, status, data } = await api('GET', '/creators/wallet/balance', creatorToken);
      postBalance = data?.availableBalance ?? 0;
      const expectedEarned = Number((coinsDeducted * 0.7).toFixed(2));
      const gotBalanceUpdate = Number((postBalance - initialBalance).toFixed(2)) === expectedEarned;

      record(
        '3. GET /creators/wallet/balance (Updated)',
        ok && gotBalanceUpdate,
        `GET /creators/wallet/balance → ${status}, postBalance=${postBalance}, change=${(postBalance - initialBalance).toFixed(2)} (expected +${expectedEarned})`
      );
    } else {
      record('3. GET /creators/wallet/balance (Updated)', false, 'Skipped due to call execution failure');
    }
  }

  // 4. GET /creators/earnings-history
  {
    if (callSessionId && coinsDeducted > 0) {
      const { ok, status, data } = await api('GET', '/creators/earnings-history', creatorToken);
      const list = Array.isArray(data) ? data : [];
      const earning = list.find(e => e.callId === callSessionId);

      const expectedGross = coinsDeducted;
      const expectedCreatorShare = Number((coinsDeducted * 0.7).toFixed(2));
      const expectedPlatformShare = Number((coinsDeducted * 0.3).toFixed(2));

      const logOk = ok && earning &&
        Number(earning.grossAmount) === expectedGross &&
        Number(earning.creatorShare) === expectedCreatorShare &&
        Number(earning.platformShare) === expectedPlatformShare;

      record(
        '4. GET /creators/earnings-history (Ledger Verification)',
        logOk,
        `GET /creators/earnings-history → ${status}, foundRecord=${!!earning}, gross=${earning?.grossAmount}, creatorShare=${earning?.creatorShare}, platformShare=${earning?.platformShare}`
      );
    } else {
      record('4. GET /creators/earnings-history (Ledger Verification)', false, 'Skipped due to call execution failure');
    }
  }

  console.log('\n=== PHASE 4.2 EARNINGS VERIFICATION REPORT ===\n');
  for (const r of results) {
    console.log(`${r.pass}  ${r.name}`);
    console.log("  Evidence: " + r.apiEvidence + "\n");
  }

  const passed = results.filter((r) => r.pass === 'PASS').length;
  const pct = Math.round((passed / results.length) * 100);
  console.log(`Phase 4.2 completion: ${passed}/${results.length} (${pct}%)`);

  if (passed === results.length) {
    console.log('\nPHASE 4.2 VERIFIED ✅\n');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Verification crashed:', e.message);
  process.exit(1);
});
