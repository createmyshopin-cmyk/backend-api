/**
 * Financial traceability verification — runs New Recharge, New Call, New Gift
 * and asserts wallet_delta === ledger.amount for each new coin_transaction.
 *
 * Usage: node scripts/verify-traceability.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const API_BASE = (process.env.API_BASE || 'http://127.0.0.1:5000/api').replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CALLER_ID = process.env.TRACE_CALLER_ID || '625474da-e4d1-49c6-837c-624f036ed995';
const CREATOR_ID = process.env.TRACE_CREATOR_ID || '8df40697-59fd-4b7c-a709-b1389f1a89e3';
const PACKAGE_ID = process.env.TRACE_PACKAGE_ID || 'e0d1942a-fe36-4475-a0e4-214a891518c3';
const GIFT_ID = process.env.TRACE_GIFT_ID || '916985c9-fc8e-47f2-9dfd-e4d08c72c6f4';

const RUN_ID = randomUUID();
const results = [];

function mintToken(userId) {
  return jwt.sign({ userId, sub: userId }, JWT_SECRET, { algorithm: 'HS256' });
}

function record(name, pass, detail = '') {
  results.push({ name, pass, detail, runId: RUN_ID });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(method, path, token, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { res, data };
}

function assertLedgerRow(row, label) {
  const walletDelta = row.balance_after - row.balance_before;
  const matches = row.amount === walletDelta;
  record(
    `${label}: amount === wallet_delta`,
    matches,
    `txn=${row.id} amount=${row.amount} wallet_delta=${walletDelta} type=${row.type}`,
  );
  return { row, matches };
}

async function verifyTxnById(supabase, txnId, label) {
  const { data, error } = await supabase
    .from('coin_transactions')
    .select('*')
    .eq('id', txnId)
    .single();
  if (error || !data) {
    record(`${label}: fetch ledger`, false, error?.message || 'not found');
    return { matches: false };
  }
  return assertLedgerRow(data, label);
}

async function verifyLatestByType(supabase, userId, type, label, afterIso) {
  const { data, error } = await supabase
    .from('coin_transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('type', type)
    .gte('created_at', afterIso)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data?.length) {
    record(`${label}: fetch ledger`, false, error?.message || 'no row after test start');
    return { matches: false };
  }
  return assertLedgerRow(data[0], label);
}

async function waitForHealth(maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${API_BASE.replace(/\/api$/, '')}/health`);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function main() {
  console.log('=== Financial Traceability Verification ===\n');
  console.log(`Run ID:    ${RUN_ID}`);
  console.log(`API:       ${API_BASE}`);
  console.log(`Caller:    ${CALLER_ID}`);
  console.log(`Creator:   ${CREATOR_ID}\n`);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const startedAt = new Date().toISOString();
  const callerToken = mintToken(CALLER_ID);
  const creatorToken = mintToken(CREATOR_ID);

  const healthy = await waitForHealth();
  record('API health', healthy, healthy ? 'server up' : 'start backend-api first');
  if (!healthy) {
    printSummary();
    process.exit(1);
  }

  // ── 0. Creator online (required for call request) ───────────────────────
  {
    const { res, data } = await api('POST', '/creators/online', creatorToken, {});
    record('Creator online', res.ok, `status=${res.status} lastSeen=${data?.lastSeenAt ?? 'n/a'}`);
  }

  // ── 1. New Recharge ─────────────────────────────────────────────────────
  let rechargeTxnId = null;
  {
    const { res: orderRes, data: orderData } = await api('POST', '/payments/create-order', callerToken, {
      packageId: PACKAGE_ID,
    });
    const orderDetail = orderRes.ok
      ? `payment=${orderData?.payment?.id}`
      : JSON.stringify(orderData);
    record('New Recharge: create-order', orderRes.ok, `status=${orderRes.status} ${orderDetail}`);
    if (!orderRes.ok) {
      printSummary();
      process.exit(1);
    }

    const gatewayOrderId = orderData?.razorpayOrder?.id || orderData?.payment?.gatewayOrderId;
    const gatewayPaymentId = `pay_trace_${RUN_ID.slice(0, 8)}`;

    // Production atomic RPC path (same ledger writer as live Razorpay verify)
    const { data: rpcData, error: rpcErr } = await supabase.rpc('verify_razorpay_payment_atomic', {
      p_order_id: gatewayOrderId,
      p_payment_id: gatewayPaymentId,
    });
    record(
      'New Recharge: verify (atomic RPC)',
      !rpcErr,
      rpcErr ? rpcErr.message : `coins=${rpcData?.coins_added} balance=${rpcData?.new_balance}`,
    );

    const verifyResult = await verifyLatestByType(supabase, CALLER_ID, 'recharge', 'New Recharge', startedAt);
    if (verifyResult.row) rechargeTxnId = verifyResult.row.id;
  }

  // ── 2. New Call ─────────────────────────────────────────────────────────
  let callId = null;
  let callTxnId = null;
  {
    const { res: reqRes, data: reqData } = await api('POST', '/calls/request', callerToken, {
      listenerId: CREATOR_ID,
      type: 'voice',
    });
    const callRequestId = reqData?.callRequest?.id;
    record(
      'New Call: request',
      reqRes.ok,
      `status=${reqRes.status} callRequestId=${callRequestId ?? 'n/a'} err=${reqRes.ok ? '' : JSON.stringify(reqData)}`,
    );

    const { res: accRes, data: accData } = await api('POST', '/calls/accept', creatorToken, {
      callId: callRequestId,
    });
    record('New Call: accept', accRes.ok, `status=${accRes.status} callId=${callId}`);
    callId = accData?.callSession?.id || accData?.callId || callId;

    const { res: ongoingRes } = await api('PATCH', `/calls/active/${callId}/status`, callerToken, {
      status: 'ongoing',
    });
    record('New Call: set ongoing', ongoingRes.ok, `status=${ongoingRes.status}`);

    // ── 3. New Gift (during active call) ───────────────────────────────────
    {
      const { res: giftRes, data: giftData } = await api('POST', '/gifts/send', callerToken, {
        giftId: GIFT_ID,
        creatorId: CREATOR_ID,
        callId,
        idempotencyKey: randomUUID(),
      });
      record('New Gift: send', giftRes.ok, `status=${giftRes.status} gift=${giftData?.giftName ?? GIFT_ID}`);
      await verifyLatestByType(supabase, CALLER_ID, 'gift_deduction', 'New Gift', startedAt);
    }

    const { res: endRes, data: endData } = await api('POST', `/calls/active/${callId}/end`, callerToken, {
      duration: 45,
      endedReason: 'traceability_audit',
    });
    record('New Call: end', endRes.ok, `status=${endRes.status} coins=${endData?.coinsSpent ?? 'n/a'}`);
    await verifyLatestByType(supabase, CALLER_ID, 'call_deduction', 'New Call', startedAt);

    // Race probe: duplicate end should not create second deduction
    const beforeCount = await supabase
      .from('coin_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'call_deduction')
      .eq('reference_id', callId);
    const { res: dupRes } = await api('POST', `/calls/active/${callId}/end`, callerToken, {
      duration: 45,
      endedReason: 'duplicate_probe',
    });
    const afterCount = await supabase
      .from('coin_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'call_deduction')
      .eq('reference_id', callId);
    const dupOk = (beforeCount.count ?? 0) === (afterCount.count ?? 0);
    record('Duplicate end-call: no extra ledger row', dupOk, `rows=${afterCount.count} dupStatus=${dupRes.status}`);

    const { data: callTxn } = await supabase
      .from('coin_transactions')
      .select('*')
      .eq('type', 'call_deduction')
      .eq('reference_id', callId)
      .maybeSingle();
    if (callTxn) {
      callTxnId = callTxn.id;
      assertLedgerRow(callTxn, 'New Call (by call_id)');
    }
  }

  // ── Global post-check ───────────────────────────────────────────────────
  const { data: newTxns } = await supabase
    .from('coin_transactions')
    .select('*')
    .eq('user_id', CALLER_ID)
    .gte('created_at', startedAt)
    .order('created_at', { ascending: true });

  let allNewMatch = true;
  for (const row of newTxns ?? []) {
    const walletDelta = row.balance_after - row.balance_before;
    if (row.amount !== walletDelta) {
      allNewMatch = false;
      record(`Post-check ${row.type}`, false, `txn=${row.id} amount=${row.amount} delta=${walletDelta}`);
    }
  }
  record(
    'All new transactions: wallet_delta === amount',
    allNewMatch,
    `${newTxns?.length ?? 0} rows since ${startedAt}`,
  );

  // Output JSON for report generator
  const summary = {
    runId: RUN_ID,
    startedAt,
    rechargeTxnId,
    callId,
    callTxnId,
    newTransactionCount: newTxns?.length ?? 0,
    results,
    allPass: results.every((r) => r.pass),
  };
  console.log('\n__TRACE_JSON__' + JSON.stringify(summary));
  printSummary();
  process.exit(summary.allPass ? 0 : 1);
}

function printSummary() {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
