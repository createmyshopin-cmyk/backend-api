/**
 * Phase 4.3 verification — Creator Withdrawals System.
 * Run: node scripts/verify-withdrawals.mjs
 */
import { createRequire } from 'module';
import 'dotenv/config';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.API_BASE || 'http://localhost:5000/api';
const CREATOR_ID = '8df40697-59fd-4b7c-a709-b1389f1a89e3'; // E2E Creator user ID
const ADMIN_ID = 'ADM001';

const results = [];

function signToken(userId, isAdmin = false) {
  const secret = process.env.JWT_SECRET || 'your-long-random-secret-at-least-32-characters';
  const payload = {
    userId,
    sub: userId,
  };
  if (isAdmin) {
    payload.type = 'admin';
    payload.role = 'super_admin';
  }
  return jwt.sign(payload, secret, {
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
  const creatorToken = signToken(CREATOR_ID);
  const adminToken = signToken(ADMIN_ID, true);

  console.log('Initializing Creator Payout Verification...');

  // Setup database connection to prep wallet balance
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase credentials missing from env!');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Get E2E creator profile ID
  let creatorProfileId = CREATOR_ID;
  const { data: profile } = await supabase
    .from('creator_profiles')
    .select('id')
    .eq('user_id', CREATOR_ID)
    .maybeSingle();

  if (profile) {
    creatorProfileId = profile.id;
  }
  console.log(`Creator user ID: ${CREATOR_ID}, profile ID: ${creatorProfileId}`);

  // 1. Reset & Prepare creator wallet balance to ₹1000.00
  console.log('Setting creator available balance to ₹1000.00 for clean testing...');
  const { data: currentWallet } = await supabase
    .from('creator_wallets')
    .select('*')
    .eq('creator_id', creatorProfileId)
    .maybeSingle();

  if (currentWallet) {
    await supabase
      .from('creator_wallets')
      .update({
        available_balance: 1000.00,
        total_earned: 1000.00,
        withdrawn_amount: 0.00,
      })
      .eq('id', currentWallet.id);
  } else {
    await supabase
      .from('creator_wallets')
      .insert({
        creator_id: creatorProfileId,
        available_balance: 1000.00,
        total_earned: 1000.00,
        withdrawn_amount: 0.00,
      });
  }

  // Double check balance endpoint returns correct initial values
  {
    const { ok, status, data } = await api('GET', '/withdrawals/balance', creatorToken);
    record(
      '0. Balance Setup Check',
      ok && data?.availableBalance === 1000,
      `GET /withdrawals/balance -> status=${status}, balance=${data?.availableBalance} (Expected 1000)`
    );
  }

  // PASS 1. Request Withdrawal
  let req1Id;
  {
    const { ok, status, data } = await api('POST', '/withdrawals/request', creatorToken, {
      amount: 150,
      paymentMethod: 'upi',
      upiId: 'testcreator@okicici',
    });
    req1Id = data?.id;
    record(
      'PASS 1. Request Withdrawal',
      ok && req1Id && data?.status === 'pending' && data?.amount === 150,
      `POST /withdrawals/request -> status=${status}, id=${req1Id}, amount=${data?.amount}, reqStatus=${data?.status}`
    );
  }

  // PASS 2. Balance Validation
  {
    // A: Attempt below minimum withdrawal limit of ₹100
    const resA = await api('POST', '/withdrawals/request', creatorToken, {
      amount: 50,
      paymentMethod: 'upi',
      upiId: 'testcreator@okicici',
    });

    // B: Attempt exceeding available balance of ₹1000 (currently ₹1000 on wallet)
    const resB = await api('POST', '/withdrawals/request', creatorToken, {
      amount: 2500,
      paymentMethod: 'upi',
      upiId: 'testcreator@okicici',
    });

    const isAInvalid = !resA.ok && resA.status === 400;
    const isBInvalid = !resB.ok && resB.status === 400;

    record(
      'PASS 2. Balance Validation',
      isAInvalid && isBInvalid,
      `MinLimit Check: status=${resA.status}, msg=${JSON.stringify(resA.data?.message)} | Overdraft Check: status=${resB.status}, msg=${JSON.stringify(resB.data?.message)}`
    );
  }

  // PASS 3. Approve Withdrawal
  {
    const { ok, status, data } = await api('POST', `/admin/withdrawals/${req1Id}/approve`, adminToken);
    record(
      'PASS 3. Approve Withdrawal',
      ok && data?.status === 'approved',
      `POST /admin/withdrawals/${req1Id}/approve -> status=${status}, reqStatus=${data?.status}`
    );
  }

  // PASS 4. Reject Withdrawal
  {
    // Create a new request to reject
    const req = await api('POST', '/withdrawals/request', creatorToken, {
      amount: 200,
      paymentMethod: 'bank',
      bankAccountName: 'Test Creator',
      bankAccountNumber: '918273645',
      bankIfsc: 'HDFC0000240',
    });
    const req2Id = req.data?.id;

    if (req2Id) {
      // Reject request
      const rejectRes = await api('POST', `/admin/withdrawals/${req2Id}/reject`, adminToken, {
        reason: 'Invalid Bank Details Provided',
      });

      // Verify balance is unchanged
      const balRes = await api('GET', '/withdrawals/balance', creatorToken);
      const balanceUnchanged = balRes.data?.availableBalance === 1000.00;

      record(
        'PASS 4. Reject Withdrawal',
        rejectRes.ok && rejectRes.data?.status === 'rejected' && balanceUnchanged,
        `POST /admin/withdrawals/${req2Id}/reject -> status=${rejectRes.status}, reqStatus=${rejectRes.data?.status}, walletBalance=${balRes.data?.availableBalance}`
      );
    } else {
      record('PASS 4. Reject Withdrawal', false, 'Failed to create secondary request for rejection');
    }
  }

  // PASS 5. Mark Paid
  {
    const { ok, status, data } = await api('POST', `/admin/withdrawals/${req1Id}/mark-paid`, adminToken, {
      referenceNumber: 'REF_TEST_998822',
      notes: 'Disbursed via UPI payment node',
    });
    record(
      'PASS 5. Mark Paid',
      ok && data?.status === 'paid' && data?.paymentReference === 'REF_TEST_998822',
      `POST /admin/withdrawals/${req1Id}/mark-paid -> status=${status}, reqStatus=${data?.status}, ref=${data?.paymentReference}`
    );
  }

  // PASS 6. Wallet Deduction
  {
    const { ok, status, data } = await api('GET', '/withdrawals/balance', creatorToken);
    const balanceDeducted = data?.availableBalance === 850.00; // 1000 - 150
    const withdrawnUpdated = data?.totalWithdrawn === 150.00;

    record(
      'PASS 6. Wallet Deduction',
      ok && balanceDeducted && withdrawnUpdated,
      `GET /withdrawals/balance -> status=${status}, balance=${data?.availableBalance} (Expected 850), withdrawn=${data?.totalWithdrawn} (Expected 150)`
    );
  }

  // PASS 7. Ledger Entry
  {
    // Directly query database ledger table
    const { data: ledgerRows, error } = await supabase
      .from('creator_transactions')
      .select('*')
      .eq('creator_id', CREATOR_ID)
      .eq('type', 'withdrawal')
      .order('created_at', { ascending: false });

    const ledger = ledgerRows && ledgerRows[0];
    const ledgerValid = ledger &&
      ledger.type === 'withdrawal' &&
      Number(ledger.amount) === 150.00 &&
      Number(ledger.balance_before) === 1000.00 &&
      Number(ledger.balance_after) === 850.00 &&
      ledger.reference_id === req1Id;

    record(
      'PASS 7. Ledger Entry',
      !error && ledgerValid,
      `Database Check -> foundRows=${ledgerRows?.length}, type=${ledger?.type}, amount=${ledger?.amount}, before=${ledger?.balance_before}, after=${ledger?.balance_after}`
    );
  }

  console.log('\n=== PHASE 4.3 CREATOR WITHDRAWALS VERIFICATION REPORT ===\n');
  for (const r of results) {
    console.log(`${r.pass}  ${r.name}`);
    console.log("  Evidence: " + r.apiEvidence + "\n");
  }

  const passed = results.filter((r) => r.pass === 'PASS').length;
  const pct = Math.round((passed / results.length) * 100);
  console.log(`Phase 4.3 completion: ${passed}/${results.length} (${pct}%)`);

  if (passed === results.length) {
    console.log('\nPHASE 4.3 VERIFIED ✅\n');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Verification crashed:', e.message);
  process.exit(1);
});
