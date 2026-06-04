/**
 * E2E database foreign key audit.
 * Run: node scripts/audit-fkeys.mjs
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Supabase credentials missing in env');
    process.exit(1);
  }
  const client = createClient(url, key);

  console.log('Running Foreign Key and Orphan Records Audit...\n');

  let overallPass = true;

  // Helper to print results
  function reportResult(testName, passes, details) {
    if (passes) {
      console.log(`[PASS] ${testName}`);
    } else {
      console.log(`[FAIL] ${testName}`);
      console.log(`       Details: ${details}`);
      overallPass = false;
    }
  }

  try {
    // 1. Fetch parent table keys
    const { data: dbUsers } = await client.from('users').select('id');
    const { data: dbPackages } = await client.from('coin_packages').select('id');
    const { data: dbCalls } = await client.from('calls').select('id, caller_id, creator_id');
    const { data: dbProfiles } = await client.from('creator_profiles').select('id, user_id');

    const userIds = new Set(dbUsers?.map(u => u.id) || []);
    const packageIds = new Set(dbPackages?.map(p => p.id) || []);
    const callIds = new Set(dbCalls?.map(c => c.id) || []);
    const profileIds = new Set(dbProfiles?.map(p => p.id) || []);
    const profileUserIds = new Set(dbProfiles?.map(p => p.user_id) || []);

    // ── Check 1: No orphan wallets (users -> wallets/creator_wallets) ─────────────────
    {
      const { data: wallets } = await client.from('wallets').select('user_id');
      const { data: creatorWallets } = await client.from('creator_wallets').select('creator_id');

      let orphansCount = 0;
      let reasons = [];

      if (wallets) {
        for (const w of wallets) {
          if (!userIds.has(w.user_id)) {
            orphansCount++;
            reasons.push(`wallet has user_id ${w.user_id} which does not exist in users`);
          }
        }
      }

      if (creatorWallets) {
        for (const cw of creatorWallets) {
          // creator_wallets.creator_id references either public.users(id) or creator_profiles(id)
          const isValid = userIds.has(cw.creator_id) || profileIds.has(cw.creator_id);
          if (!isValid) {
            orphansCount++;
            reasons.push(`creator_wallet has creator_id ${cw.creator_id} which does not exist in users or creator_profiles`);
          }
        }
      }

      reportResult('1. No orphan wallets', orphansCount === 0, reasons.join('; '));
    }

    // ── Check 2: No orphan creator_profiles (users -> creator_profiles) ───────────
    {
      let orphansCount = 0;
      let reasons = [];

      if (dbProfiles) {
        for (const p of dbProfiles) {
          if (p.user_id && !userIds.has(p.user_id)) {
            orphansCount++;
            reasons.push(`creator_profile ${p.id} has user_id ${p.user_id} which does not exist in users`);
          }
        }
      }

      reportResult('2. No orphan creator_profiles', orphansCount === 0, reasons.join('; '));
    }

    // ── Check 3: No orphan calls (users -> calls) ───────────────────────────────────
    {
      let orphansCount = 0;
      let reasons = [];

      if (dbCalls) {
        for (const c of dbCalls) {
          if (!userIds.has(c.caller_id)) {
            orphansCount++;
            reasons.push(`call ${c.id} has caller_id ${c.caller_id} which does not exist in users`);
          }
          if (!userIds.has(c.creator_id)) {
            orphansCount++;
            reasons.push(`call ${c.id} has creator_id ${c.creator_id} which does not exist in users`);
          }
        }
      }

      reportResult('3. No orphan calls', orphansCount === 0, reasons.join('; '));
    }

    // ── Check 4: No orphan call_requests (users -> call_requests, calls -> call_requests) ──
    {
      const { data: requests } = await client.from('call_requests').select('id, caller_id, creator_id, call_id');
      let orphansCount = 0;
      let reasons = [];

      if (requests) {
        for (const r of requests) {
          if (!userIds.has(r.caller_id)) {
            orphansCount++;
            reasons.push(`call_request ${r.id} has caller_id ${r.caller_id} which does not exist in users`);
          }
          if (!userIds.has(r.creator_id)) {
            orphansCount++;
            reasons.push(`call_request ${r.id} has creator_id ${r.creator_id} which does not exist in users`);
          }
          if (r.call_id && !callIds.has(r.call_id)) {
            orphansCount++;
            reasons.push(`call_request ${r.id} has call_id ${r.call_id} which does not exist in calls`);
          }
        }
      }

      reportResult('4. No orphan call_requests', orphansCount === 0, reasons.join('; '));
    }

    // ── Check 5: No orphan payments (users -> payments, coin_packages -> payments) ───
    {
      const { data: payments } = await client.from('payments').select('id, user_id, package_id');
      let orphansCount = 0;
      let reasons = [];

      if (payments) {
        for (const p of payments) {
          if (!userIds.has(p.user_id)) {
            orphansCount++;
            reasons.push(`payment ${p.id} has user_id ${p.user_id} which does not exist in users`);
          }
          if (p.package_id && !packageIds.has(p.package_id)) {
            orphansCount++;
            reasons.push(`payment ${p.id} has package_id ${p.package_id} which does not exist in coin_packages`);
          }
        }
      }

      reportResult('5. No orphan payments', orphansCount === 0, reasons.join('; '));
    }

    // ── Check 6: No orphan creator_earnings (calls -> creator_earnings, users -> creator_earnings) ──
    {
      const { data: earnings } = await client.from('creator_earnings').select('id, call_id, creator_id');
      let orphansCount = 0;
      let reasons = [];

      if (earnings) {
        for (const e of earnings) {
          if (e.call_id && !callIds.has(e.call_id)) {
            orphansCount++;
            reasons.push(`creator_earning ${e.id} has call_id ${e.call_id} which does not exist in calls`);
          }
          if (!userIds.has(e.creator_id)) {
            orphansCount++;
            reasons.push(`creator_earning ${e.id} has creator_id ${e.creator_id} which does not exist in users`);
          }
        }
      }

      reportResult('6. No orphan creator_earnings', orphansCount === 0, reasons.join('; '));
    }

    // ── Check 7: No orphan withdrawals (users -> withdrawals) ──────────────────────
    {
      const { data: withdrawals } = await client.from('withdrawals').select('id, creator_id');
      let orphansCount = 0;
      let reasons = [];

      if (withdrawals) {
        for (const w of withdrawals) {
          if (!userIds.has(w.creator_id)) {
            orphansCount++;
            reasons.push(`withdrawal ${w.id} has creator_id ${w.creator_id} which does not exist in users`);
          }
        }
      }

      reportResult('7. No orphan withdrawals', orphansCount === 0, reasons.join('; '));
    }

    // ── Check 8: No orphan coin_transactions (users -> coin_transactions) ───────────
    {
      const { data: txns } = await client.from('coin_transactions').select('id, user_id');
      let orphansCount = 0;
      let reasons = [];

      if (txns) {
        for (const t of txns) {
          if (!userIds.has(t.user_id)) {
            orphansCount++;
            reasons.push(`coin_transaction ${t.id} has user_id ${t.user_id} which does not exist in users`);
          }
        }
      }

      reportResult('8. No orphan coin_transactions', orphansCount === 0, reasons.join('; '));
    }

    // ── Check 9: No orphan creator_transactions (users -> creator_transactions) ─────
    {
      const { data: ctxns } = await client.from('creator_transactions').select('id, creator_id');
      let orphansCount = 0;
      let reasons = [];

      if (ctxns) {
        for (const t of ctxns) {
          if (!userIds.has(t.creator_id)) {
            orphansCount++;
            reasons.push(`creator_transaction ${t.id} has creator_id ${t.creator_id} which does not exist in users`);
          }
        }
      }

      reportResult('9. No orphan creator_transactions', orphansCount === 0, reasons.join('; '));
    }

    console.log('\n=== AUDIT COMPLETE ===');
    if (overallPass) {
      console.log('AUDIT RESULT: PASS ✅\n');
      process.exit(0);
    } else {
      console.log('AUDIT RESULT: FAIL ❌\n');
      process.exit(1);
    }

  } catch (e) {
    console.error('Audit failed to execute queries:', e.message);
    process.exit(1);
  }
}

main();
