/**
 * Phase 4.4 verification — Revenue & Finance Dashboard.
 * Run: node scripts/verify-finance-dashboard.mjs
 */
import { createRequire } from 'module';
import 'dotenv/config';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.API_BASE || 'http://127.0.0.1:5000/api';
const ADMIN_ID = 'ADM001';
const TEST_USER_ID = '8df40697-59fd-4b7c-a709-b1389f1a89e3'; // Seeding user id
const TEST_CREATOR_ID = '8df40697-59fd-4b7c-a709-b1389f1a89e3'; // Seeding creator user id

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
  const adminToken = signToken(ADMIN_ID, true);

  console.log('Initializing Finance Dashboard Verification (Phase 4.4)...');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseKey) {
    console.log('Supabase configured. Seeding database with dummy transaction logs to guarantee analytics metrics...');
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
      // 1. Ensure a packages row exists to reference
      const { data: pkg } = await supabase
        .from('coin_packages')
        .select('id')
        .limit(1)
        .maybeSingle();

      const packageId = pkg?.id || 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

      // 2. Insert dummy payments
      await supabase.from('payments').insert([
        {
          user_id: TEST_USER_ID,
          package_id: packageId,
          gateway: 'Razorpay',
          gateway_order_id: `verify_order_${Date.now()}_1`,
          amount: 399.00,
          coins_added: 550,
          status: 'success',
          created_at: new Date().toISOString()
        },
        {
          user_id: TEST_USER_ID,
          package_id: packageId,
          gateway: 'Razorpay',
          gateway_order_id: `verify_order_${Date.now()}_2`,
          amount: 99.00,
          coins_added: 100,
          status: 'success',
          created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
        }
      ]);

      // 3. Insert dummy call log
      const { data: call } = await supabase.from('calls').insert({
        caller_id: TEST_USER_ID,
        creator_id: TEST_CREATOR_ID,
        type: 'voice',
        status: 'ended',
        duration_seconds: 180,
        coins_deducted: 30,
        coins_spent: 30,
        created_at: new Date().toISOString()
      }).select().single();

      if (call) {
        // 4. Insert dummy creator earning
        await supabase.from('creator_earnings').insert({
          call_id: call.id,
          creator_id: TEST_CREATOR_ID,
          gross_amount: 30.00,
          creator_share: 21.00,
          platform_share: 9.00,
          created_at: new Date().toISOString()
        });
      }

      // 5. Insert dummy withdrawals
      await supabase.from('withdrawals').insert([
        {
          creator_id: TEST_CREATOR_ID,
          amount: 150.00,
          status: 'paid',
          upi_id: 'testcreator@okaxis',
          payment_reference: 'REF_VERIFY_1122',
          requested_at: new Date().toISOString(),
          paid_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        },
        {
          creator_id: TEST_CREATOR_ID,
          amount: 250.00,
          status: 'pending',
          upi_id: 'testcreator@okaxis',
          requested_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        }
      ]);

      console.log('Database seeded successfully.');
    } catch (e) {
      console.warn('Database seeding failed (continuing with existing rows):', e.message);
    }
  } else {
    console.log('Supabase credentials missing, running verification in in-memory sandbox mode.');
  }

  // PASS 1. Overview API
  {
    const { ok, status, data } = await api('GET', '/admin/finance/overview', adminToken);
    const hasKeys = data &&
      typeof data.todayRevenue === 'number' &&
      typeof data.monthlyRevenue === 'number' &&
      typeof data.totalRevenue === 'number' &&
      typeof data.coinsSold === 'number' &&
      typeof data.activeUsers === 'number' &&
      typeof data.activeCreators === 'number' &&
      typeof data.pendingWithdrawals === 'number' &&
      typeof data.paidWithdrawals === 'number' &&
      typeof data.creatorPayouts === 'number' &&
      typeof data.platformProfit === 'number';

    record(
      'PASS 1. Overview API',
      ok && hasKeys,
      `GET /admin/finance/overview -> status=${status}, dataKeys=${Object.keys(data || {}).join(',')}`
    );
  }

  // PASS 2. Revenue Analytics
  {
    const { ok, status, data } = await api('GET', '/admin/finance/overview', adminToken);
    const revenueValid = ok && data && data.totalRevenue >= data.todayRevenue && data.totalRevenue >= 0;

    record(
      'PASS 2. Revenue Analytics',
      revenueValid,
      `Overview Revenue -> total=${data?.totalRevenue}, monthly=${data?.monthlyRevenue}, today=${data?.todayRevenue}`
    );
  }

  // PASS 3. Coin Analytics
  {
    const { ok, status, data } = await api('GET', '/admin/finance/call-analytics', adminToken);
    const coinValid = ok && data && 
      typeof data.coinsUsed === 'number' &&
      typeof data.outstandingCoins === 'number';

    record(
      'PASS 3. Coin Analytics',
      coinValid,
      `Call Coins -> coinsUsed=${data?.coinsUsed}, outstandingCoins=${data?.outstandingCoins}`
    );
  }

  // PASS 4. Creator Analytics
  {
    const { ok, status, data } = await api('GET', '/admin/finance/top-creators', adminToken);
    const topCreatorsValid = ok && Array.isArray(data) && (data.length === 0 || (
      data[0] &&
      typeof data[0].creatorName === 'string' &&
      typeof data[0].creatorId === 'string' &&
      typeof data[0].totalEarnings === 'number' &&
      typeof data[0].totalCalls === 'number' &&
      typeof data[0].totalMinutes === 'number'
    ));

    record(
      'PASS 4. Creator Analytics',
      topCreatorsValid,
      `GET /admin/finance/top-creators -> status=${status}, topCount=${data?.length || 0}`
    );
  }

  // PASS 5. Withdrawal Analytics
  {
    const { ok, status, data } = await api('GET', '/admin/finance/withdrawal-analytics', adminToken);
    const withdrawValid = ok && data &&
      typeof data.pendingWithdrawals === 'number' &&
      typeof data.pendingAmount === 'number' &&
      typeof data.paidWithdrawals === 'number' &&
      typeof data.totalPayouts === 'number';

    record(
      'PASS 5. Withdrawal Analytics',
      withdrawValid,
      `Withdraw Analytics -> pendingCount=${data?.pendingWithdrawals}, pendingAmount=${data?.pendingAmount}, paidCount=${data?.paidWithdrawals}, payoutsSum=${data?.totalPayouts}`
    );
  }

  // PASS 6. Call Analytics
  {
    const { ok, status, data } = await api('GET', '/admin/finance/call-analytics', adminToken);
    const callValid = ok && data &&
      typeof data.totalCalls === 'number' &&
      typeof data.completedCalls === 'number' &&
      typeof data.totalCallMinutes === 'number' &&
      typeof data.averageCallDuration === 'number';

    record(
      'PASS 6. Call Analytics',
      callValid,
      `Call Analytics -> totalCalls=${data?.totalCalls}, completed=${data?.completedCalls}, minutes=${data?.totalCallMinutes}, avgDuration=${data?.averageCallDuration}`
    );
  }

  // PASS 7. Chart Data APIs
  {
    const { ok, status, data } = await api('GET', '/admin/finance/revenue-chart?days=7', adminToken);
    const chartValid = ok && Array.isArray(data) && data.length === 7 && (
      data[0] &&
      typeof data[0].date === 'string' &&
      typeof data[0].revenue === 'number' &&
      typeof data[0].coinsSold === 'number' &&
      typeof data[0].creatorEarnings === 'number' &&
      typeof data[0].callVolume === 'number' &&
      typeof data[0].withdrawals === 'number'
    );

    record(
      'PASS 7. Chart Data APIs',
      chartValid,
      `GET /admin/finance/revenue-chart?days=7 -> status=${status}, chartLength=${data?.length || 0}, sampleDate=${data?.[0]?.date}`
    );
  }

  // PASS 8. CSV Export
  {
    const resRev = await api('GET', '/admin/finance/export/revenue?range=7days', adminToken);
    const resEarn = await api('GET', '/admin/finance/export/earnings?range=7days', adminToken);
    const resWithdraw = await api('GET', '/admin/finance/export/withdrawals?range=7days', adminToken);

    const isRevCsv = resRev.ok && typeof resRev.data === 'string' && resRev.data.includes('ID,User ID,Amount');
    const isEarnCsv = resEarn.ok && typeof resEarn.data === 'string' && resEarn.data.includes('ID,Call ID,Creator ID');
    const isWithdrawCsv = resWithdraw.ok && typeof resWithdraw.data === 'string' && resWithdraw.data.includes('ID,Creator ID,Amount');

    record(
      'PASS 8. CSV Export',
      isRevCsv && isEarnCsv && isWithdrawCsv,
      `CSV Exports -> revenueOk=${resRev.ok}, earningsOk=${resEarn.ok}, withdrawalsOk=${resWithdraw.ok}`
    );
  }

  console.log('\n=== PHASE 4.4 FINANCE DASHBOARD VERIFICATION REPORT ===\n');
  for (const r of results) {
    console.log(`${r.pass}  ${r.name}`);
    console.log("  Evidence: " + r.apiEvidence + "\n");
  }

  const passed = results.filter((r) => r.pass === 'PASS').length;
  const pct = Math.round((passed / results.length) * 100);
  console.log(`Phase 4.4 completion: ${passed}/${results.length} (${pct}%)`);

  if (passed === results.length) {
    console.log('\nPHASE 4.4 VERIFIED ✅\n');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Verification crashed:', e.message);
  process.exit(1);
});
