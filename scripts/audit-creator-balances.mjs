/**
 * Audit creator wallet balances.
 * Verify: available_balance = earnings - paid withdrawals
 *
 * Run: node scripts/audit-creator-balances.mjs
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const TOLERANCE = 0.01;

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function nearlyEqual(a, b) {
  return Math.abs(round2(a) - round2(b)) <= TOLERANCE;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Supabase credentials missing in env');
    process.exit(1);
  }

  const client = createClient(url, key);

  const [
    { data: wallets, error: walletsErr },
    { data: profiles, error: profilesErr },
    { data: users, error: usersErr },
    { data: earnings, error: earningsErr },
    { data: withdrawals, error: withdrawalsErr },
  ] = await Promise.all([
    client.from('creator_wallets').select('*'),
    client.from('creator_profiles').select('id, user_id, total_earnings'),
    client.from('users').select('id, name, phone, email').eq('is_creator', true),
    client.from('creator_earnings').select('creator_id, creator_share'),
    client.from('withdrawals').select('creator_id, amount, status'),
  ]);

  for (const [label, err] of [
    ['creator_wallets', walletsErr],
    ['creator_profiles', profilesErr],
    ['users', usersErr],
    ['creator_earnings', earningsErr],
    ['withdrawals', withdrawalsErr],
  ]) {
    if (err) {
      console.error(`Failed to load ${label}:`, err.message);
      process.exit(1);
    }
  }

  const profileById = new Map((profiles || []).map((p) => [p.id, p]));
  const profileByUserId = new Map((profiles || []).map((p) => [p.user_id, p]));
  const userById = new Map((users || []).map((u) => [u.id, u]));

  /** Resolve wallet.creator_id -> users.id */
  function resolveUserId(walletCreatorId) {
    if (userById.has(walletCreatorId)) return walletCreatorId;
    const profile = profileById.get(walletCreatorId);
    if (profile?.user_id) return profile.user_id;
    return walletCreatorId;
  }

  const earningsByUser = new Map();
  for (const row of earnings || []) {
    const uid = row.creator_id;
    earningsByUser.set(uid, round2((earningsByUser.get(uid) || 0) + Number(row.creator_share)));
  }

  const paidWithdrawalsByUser = new Map();
  for (const row of withdrawals || []) {
    if (row.status !== 'paid') continue;
    const uid = row.creator_id;
    paidWithdrawalsByUser.set(
      uid,
      round2((paidWithdrawalsByUser.get(uid) || 0) + Number(row.amount)),
    );
  }

  const mismatches = [];
  const walletUserIds = new Set();

  for (const wallet of wallets || []) {
    const userId = resolveUserId(wallet.creator_id);
    walletUserIds.add(userId);

    const ledgerEarnings = earningsByUser.get(userId) ?? 0;
    const ledgerPaidWithdrawals = paidWithdrawalsByUser.get(userId) ?? 0;
    const expectedAvailable = round2(ledgerEarnings - ledgerPaidWithdrawals);

    const available = round2(wallet.available_balance);
    const totalEarned = round2(wallet.total_earned);
    const withdrawnAmount = round2(wallet.withdrawn_amount);

    const user = userById.get(userId);
    const profile = profileByUserId.get(userId);
    const label =
      user?.name || user?.phone || user?.email || profile?.id || wallet.creator_id;

    const issues = [];

    if (!nearlyEqual(available, expectedAvailable)) {
      issues.push({
        check: 'available_balance = earnings - paid_withdrawals (ledger)',
        expected: expectedAvailable,
        actual: available,
        delta: round2(available - expectedAvailable),
        ledgerEarnings,
        ledgerPaidWithdrawals,
      });
    }

    if (!nearlyEqual(available, round2(totalEarned - withdrawnAmount))) {
      issues.push({
        check: 'available_balance = total_earned - withdrawn_amount (wallet)',
        expected: round2(totalEarned - withdrawnAmount),
        actual: available,
        delta: round2(available - (totalEarned - withdrawnAmount)),
        totalEarned,
        withdrawnAmount,
      });
    }

    if (!nearlyEqual(totalEarned, ledgerEarnings)) {
      issues.push({
        check: 'total_earned = sum(creator_earnings.creator_share)',
        expected: ledgerEarnings,
        actual: totalEarned,
        delta: round2(totalEarned - ledgerEarnings),
      });
    }

    if (!nearlyEqual(withdrawnAmount, ledgerPaidWithdrawals)) {
      issues.push({
        check: 'withdrawn_amount = sum(paid withdrawals)',
        expected: ledgerPaidWithdrawals,
        actual: withdrawnAmount,
        delta: round2(withdrawnAmount - ledgerPaidWithdrawals),
      });
    }

    if (issues.length > 0) {
      mismatches.push({
        userId,
        walletCreatorId: wallet.creator_id,
        creatorLabel: label,
        walletId: wallet.id,
        availableBalance: available,
        totalEarned,
        withdrawnAmount,
        ledgerEarnings,
        ledgerPaidWithdrawals,
        expectedAvailableFromLedger: expectedAvailable,
        issues,
      });
    }
  }

  // Creators with earnings or paid withdrawals but no wallet row
  const allCreatorUserIds = new Set([
    ...earningsByUser.keys(),
    ...paidWithdrawalsByUser.keys(),
    ...(users || []).map((u) => u.id),
  ]);

  for (const userId of allCreatorUserIds) {
    if (walletUserIds.has(userId)) continue;
    const ledgerEarnings = earningsByUser.get(userId) ?? 0;
    const ledgerPaidWithdrawals = paidWithdrawalsByUser.get(userId) ?? 0;
    if (ledgerEarnings === 0 && ledgerPaidWithdrawals === 0) continue;

    const user = userById.get(userId);
    mismatches.push({
      userId,
      walletCreatorId: null,
      creatorLabel: user?.name || user?.phone || userId,
      walletId: null,
      availableBalance: null,
      totalEarned: null,
      withdrawnAmount: null,
      ledgerEarnings,
      ledgerPaidWithdrawals,
      expectedAvailableFromLedger: round2(ledgerEarnings - ledgerPaidWithdrawals),
      issues: [{ check: 'missing creator_wallets row', expected: 'wallet exists', actual: null }],
    });
  }

  console.log('Creator balance audit\n');
  console.log(`Wallets checked: ${(wallets || []).length}`);
  console.log(`Creators with earnings rows: ${earningsByUser.size}`);
  console.log(`Creators with paid withdrawals: ${paidWithdrawalsByUser.size}`);
  console.log(`Mismatches: ${mismatches.length}\n`);

  if (mismatches.length === 0) {
    console.log('[PASS] All creator balances reconcile.');
    process.exit(0);
  }

  console.log('[FAIL] Mismatches:\n');
  for (const m of mismatches) {
    console.log('─'.repeat(60));
    console.log(`Creator: ${m.creatorLabel}`);
    console.log(`  user_id:          ${m.userId}`);
    console.log(`  wallet_creator_id: ${m.walletCreatorId ?? '(none)'}`);
    console.log(`  wallet_id:        ${m.walletId ?? '(none)'}`);
    console.log(`  available_balance:     ${m.availableBalance ?? '—'}`);
    console.log(`  total_earned (wallet): ${m.totalEarned ?? '—'}`);
    console.log(`  withdrawn_amount:      ${m.withdrawnAmount ?? '—'}`);
    console.log(`  earnings (ledger):     ${m.ledgerEarnings}`);
    console.log(`  paid withdrawals:      ${m.ledgerPaidWithdrawals}`);
    console.log(
      `  expected available:    ${m.expectedAvailableFromLedger}  (= earnings − paid withdrawals)`,
    );
    for (const issue of m.issues) {
      console.log(`  ✗ ${issue.check}`);
      if (issue.expected !== undefined) {
        console.log(`      expected: ${issue.expected}, actual: ${issue.actual}, delta: ${issue.delta ?? '—'}`);
      }
    }
  }

  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
