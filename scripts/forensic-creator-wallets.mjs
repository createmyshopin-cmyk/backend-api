/**
 * Forensic audit of creator_wallets.
 * Run: node scripts/forensic-creator-wallets.mjs
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOLERANCE = 0.01;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function nearlyEqual(a, b) {
  return Math.abs(round2(a) - round2(b)) <= TOLERANCE;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Supabase credentials missing');
    process.exit(1);
  }

  const client = createClient(url, key);
  const report = {
    auditDate: new Date().toISOString(),
    environment: url,
    summary: {},
    balanceReconciliation: [],
    negativeBalances: [],
    orphanTransactions: {
      earningsWithoutWallet: [],
      walletWithoutProfile: [],
      creatorEarningsWithoutCall: [],
      creatorEarningsOrphanCall: [],
      giftTxWithoutCreatorTx: [],
      creatorTxWithoutGiftTx: [],
      giftTxWithoutWalletCredit: [],
      withdrawalsWithoutCreatorTx: [],
      creatorTxWithoutWithdrawal: [],
    },
    duplicateEarnings: {
      duplicateCallEarnings: [],
      duplicateGiftEarnings: [],
    },
    raceConditions: {
      withdrawalReadModifyWrite: true,
      callEarningsAtomic: true,
      giftEarningsAtomic: true,
      pendingWithdrawalDoubleSpendRisk: [],
      walletFkIdMismatch: [],
    },
    systemTotals: {},
  };

  const [
    { data: wallets },
    { data: profiles },
    { data: users },
    { data: callEarnings },
    { data: giftTx },
    { data: creatorTx },
    { data: withdrawals },
    { data: calls },
  ] = await Promise.all([
    client.from('creator_wallets').select('*'),
    client.from('creator_profiles').select('id, user_id, total_earnings'),
    client.from('users').select('id, name, phone, email, is_creator'),
    client.from('creator_earnings').select('id, call_id, creator_id, creator_share, gross_amount, created_at'),
    client.from('gift_transactions').select('id, creator_id, creator_coins, call_id, created_at'),
    client.from('creator_transactions').select('id, creator_id, type, amount, reference_id, balance_before, balance_after, created_at'),
    client.from('withdrawals').select('id, creator_id, amount, status, created_at, paid_at'),
    client.from('calls').select('id, creator_id, status, coins_spent'),
  ]);

  const profileById = new Map((profiles || []).map((p) => [p.id, p]));
  const profileByUserId = new Map((profiles || []).map((p) => [p.user_id, p]));
  const userById = new Map((users || []).map((u) => [u.id, u]));
  const callById = new Map((calls || []).map((c) => [c.id, c]));
  const walletByProfileId = new Map();

  for (const w of wallets || []) {
    walletByProfileId.set(w.creator_id, w);
  }

  function resolveUserId(id) {
    if (userById.has(id)) return id;
    const p = profileById.get(id);
    return p?.user_id ?? id;
  }

  function resolveProfileId(userId) {
    return profileByUserId.get(userId)?.id ?? userId;
  }

  function labelFor(userId) {
    const u = userById.get(userId);
    return u?.name || u?.phone || u?.email || userId.slice(0, 8);
  }

  // ── Aggregate earnings per user_id ─────────────────────────────────────────
  const callEarningsByUser = new Map();
  for (const row of callEarnings || []) {
    const uid = row.creator_id;
    callEarningsByUser.set(uid, round2((callEarningsByUser.get(uid) || 0) + Number(row.creator_share)));
  }

  const giftEarningsByProfile = new Map();
  const giftEarningsByUser = new Map();
  for (const row of giftTx || []) {
    const profileId = row.creator_id;
    const uid = resolveUserId(profileId);
    giftEarningsByProfile.set(profileId, round2((giftEarningsByProfile.get(profileId) || 0) + Number(row.creator_coins)));
    giftEarningsByUser.set(uid, round2((giftEarningsByUser.get(uid) || 0) + Number(row.creator_coins)));
  }

  const creatorTxEarningsByUser = new Map();
  const creatorTxGiftByUser = new Map();
  const creatorTxWithdrawalsByUser = new Map();
  for (const row of creatorTx || []) {
    const uid = row.creator_id;
    const amt = Number(row.amount);
    if (row.type === 'earning' || row.type === 'gift_earning') {
      creatorTxEarningsByUser.set(uid, round2((creatorTxEarningsByUser.get(uid) || 0) + amt));
      if (row.type === 'gift_earning') {
        creatorTxGiftByUser.set(uid, round2((creatorTxGiftByUser.get(uid) || 0) + amt));
      }
    } else if (row.type === 'withdrawal') {
      creatorTxWithdrawalsByUser.set(uid, round2((creatorTxWithdrawalsByUser.get(uid) || 0) + amt));
    }
  }

  const paidWithdrawalsByUser = new Map();
  const pendingWithdrawalsByUser = new Map();
  for (const row of withdrawals || []) {
    const uid = row.creator_id;
    if (row.status === 'paid') {
      paidWithdrawalsByUser.set(uid, round2((paidWithdrawalsByUser.get(uid) || 0) + Number(row.amount)));
    } else if (row.status === 'pending' || row.status === 'approved') {
      pendingWithdrawalsByUser.set(uid, round2((pendingWithdrawalsByUser.get(uid) || 0) + Number(row.amount)));
    }
  }

  // ── System totals ──────────────────────────────────────────────────────────
  const sumCallEarnings = round2([...callEarningsByUser.values()].reduce((a, b) => a + b, 0));
  const sumGiftEarnings = round2([...giftEarningsByUser.values()].reduce((a, b) => a + b, 0));
  const sumTotalEarnings = round2(sumCallEarnings + sumGiftEarnings);
  const sumWalletTotalEarned = round2((wallets || []).reduce((a, w) => a + Number(w.total_earned), 0));
  const sumWalletAvailable = round2((wallets || []).reduce((a, w) => a + Number(w.available_balance), 0));
  const sumWalletWithdrawn = round2((wallets || []).reduce((a, w) => a + Number(w.withdrawn_amount), 0));
  const sumPaidWithdrawals = round2([...paidWithdrawalsByUser.values()].reduce((a, b) => a + b, 0));

  report.systemTotals = {
    walletCount: (wallets || []).length,
    callEarningsRows: (callEarnings || []).length,
    giftTransactionRows: (giftTx || []).length,
    creatorTransactionRows: (creatorTx || []).length,
    withdrawalRows: (withdrawals || []).length,
    sumCallEarnings,
    sumGiftEarnings,
    sumTotalEarningsLedger: sumTotalEarnings,
    sumWalletTotalEarned,
    sumWalletAvailable,
    sumWalletWithdrawn,
    sumPaidWithdrawals,
    sumCreatorTxGiftEarnings: round2([...creatorTxGiftByUser.values()].reduce((a, b) => a + b, 0)),
    sumCreatorTxWithdrawals: round2([...creatorTxWithdrawalsByUser.values()].reduce((a, b) => a + b, 0)),
    sumGiftEarningsTotalColumn: round2((wallets || []).reduce((a, w) => a + Number(w.gift_earnings_total || 0), 0)),
    sumCallEarningsTotalColumn: round2((wallets || []).reduce((a, w) => a + Number(w.call_earnings_total || 0), 0)),
  };

  // ── 1. Balance reconciliation per wallet ───────────────────────────────────
  for (const wallet of wallets || []) {
    const profileId = wallet.creator_id;
    const userId = resolveUserId(profileId);
    const callEarn = callEarningsByUser.get(userId) ?? 0;
    const giftEarn = giftEarningsByUser.get(userId) ?? 0;
    const ledgerTotalEarned = round2(callEarn + giftEarn);
    const ledgerPaidWithdrawals = paidWithdrawalsByUser.get(userId) ?? 0;
    const expectedAvailable = round2(ledgerTotalEarned - ledgerPaidWithdrawals);

    const available = round2(wallet.available_balance);
    const totalEarned = round2(wallet.total_earned);
    const withdrawnAmount = round2(wallet.withdrawn_amount);
    const giftCol = round2(Number(wallet.gift_earnings_total || 0));
    const callCol = round2(Number(wallet.call_earnings_total || 0));

    const issues = [];

    if (!nearlyEqual(available, expectedAvailable)) {
      issues.push({
        check: 'available_balance = sum(earnings) - sum(paid withdrawals)',
        expected: expectedAvailable,
        actual: available,
        delta: round2(available - expectedAvailable),
      });
    }
    if (!nearlyEqual(totalEarned, ledgerTotalEarned)) {
      issues.push({
        check: 'total_earned = sum(call earnings) + sum(gift earnings)',
        expected: ledgerTotalEarned,
        actual: totalEarned,
        delta: round2(totalEarned - ledgerTotalEarned),
        callEarn,
        giftEarn,
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
    if (!nearlyEqual(available, round2(totalEarned - withdrawnAmount))) {
      issues.push({
        check: 'available_balance = total_earned - withdrawn_amount (internal wallet identity)',
        expected: round2(totalEarned - withdrawnAmount),
        actual: available,
        delta: round2(available - (totalEarned - withdrawnAmount)),
      });
    }
    if (wallet.gift_earnings_total != null && !nearlyEqual(giftCol, giftEarn)) {
      issues.push({
        check: 'gift_earnings_total = sum(gift_transactions.creator_coins)',
        expected: giftEarn,
        actual: giftCol,
        delta: round2(giftCol - giftEarn),
      });
    }

    if (issues.length > 0) {
      report.balanceReconciliation.push({
        userId,
        profileId,
        creatorLabel: labelFor(userId),
        walletId: wallet.id,
        wallet: { available, totalEarned, withdrawnAmount, giftCol, callCol },
        ledger: { callEarn, giftEarn, ledgerTotalEarned, ledgerPaidWithdrawals, expectedAvailable },
        issues,
      });
    }

    // Wallet FK / ID mismatch check
    if (!profileById.has(profileId) && userById.has(profileId)) {
      report.raceConditions.walletFkIdMismatch.push({
        walletId: wallet.id,
        creator_id: profileId,
        issue: 'creator_wallets.creator_id references users.id instead of creator_profiles.id (pre-Phase14)',
      });
    }
  }

  // Creators with ledger activity but no wallet
  const allUserIds = new Set([
    ...callEarningsByUser.keys(),
    ...giftEarningsByUser.keys(),
    ...paidWithdrawalsByUser.keys(),
    ...(users || []).filter((u) => u.is_creator).map((u) => u.id),
  ]);

  for (const userId of allUserIds) {
    const profileId = resolveProfileId(userId);
    if (!walletByProfileId.has(profileId) && !walletByProfileId.has(userId)) {
      const callEarn = callEarningsByUser.get(userId) ?? 0;
      const giftEarn = giftEarningsByUser.get(userId) ?? 0;
      const paid = paidWithdrawalsByUser.get(userId) ?? 0;
      if (callEarn > 0 || giftEarn > 0 || paid > 0) {
        report.orphanTransactions.earningsWithoutWallet.push({
          userId,
          profileId,
          creatorLabel: labelFor(userId),
          callEarn,
          giftEarn,
          paidWithdrawals: paid,
          expectedAvailable: round2(callEarn + giftEarn - paid),
        });
      }
    }
  }

  // ── 2. Negative balances ───────────────────────────────────────────────────
  for (const wallet of wallets || []) {
    const negatives = [];
    if (Number(wallet.available_balance) < 0) negatives.push('available_balance');
    if (Number(wallet.total_earned) < 0) negatives.push('total_earned');
    if (Number(wallet.withdrawn_amount) < 0) negatives.push('withdrawn_amount');
    if (negatives.length > 0) {
      report.negativeBalances.push({
        walletId: wallet.id,
        creator_id: wallet.creator_id,
        userId: resolveUserId(wallet.creator_id),
        fields: negatives,
        values: {
          available_balance: wallet.available_balance,
          total_earned: wallet.total_earned,
          withdrawn_amount: wallet.withdrawn_amount,
        },
      });
    }
  }

  // ── 3. Orphan transactions ─────────────────────────────────────────────────
  for (const ce of callEarnings || []) {
    if (!ce.call_id) {
      report.orphanTransactions.creatorEarningsWithoutCall.push(ce);
    } else if (!callById.has(ce.call_id)) {
      report.orphanTransactions.creatorEarningsOrphanCall.push(ce);
    }
  }

  const giftTxById = new Map((giftTx || []).map((g) => [g.id, g]));
  const creatorTxGiftByRef = new Map();
  for (const tx of creatorTx || []) {
    if (tx.type === 'gift_earning' && tx.reference_id) {
      creatorTxGiftByRef.set(tx.reference_id, tx);
    }
  }

  for (const gt of giftTx || []) {
    if (!creatorTxGiftByRef.has(gt.id)) {
      report.orphanTransactions.giftTxWithoutCreatorTx.push({
        giftTxId: gt.id,
        creator_id: gt.creator_id,
        creator_coins: gt.creator_coins,
      });
    }
    const profileId = gt.creator_id;
    const wallet = walletByProfileId.get(profileId);
    if (!wallet) {
      report.orphanTransactions.giftTxWithoutWalletCredit.push({
        giftTxId: gt.id,
        profileId,
        creator_coins: gt.creator_coins,
      });
    }
  }

  for (const [refId, tx] of creatorTxGiftByRef) {
    if (!giftTxById.has(refId)) {
      report.orphanTransactions.creatorTxWithoutGiftTx.push(tx);
    }
  }

  const withdrawalById = new Map((withdrawals || []).map((w) => [w.id, w]));
  for (const tx of creatorTx || []) {
    if (tx.type === 'withdrawal' && tx.reference_id && !withdrawalById.has(tx.reference_id)) {
      report.orphanTransactions.creatorTxWithoutWithdrawal.push(tx);
    }
  }
  for (const w of withdrawals || []) {
    if (w.status === 'paid') {
      const hasTx = (creatorTx || []).some(
        (tx) => tx.type === 'withdrawal' && tx.reference_id === w.id,
      );
      if (!hasTx) {
        report.orphanTransactions.withdrawalsWithoutCreatorTx.push({
          withdrawalId: w.id,
          creator_id: w.creator_id,
          amount: w.amount,
        });
      }
    }
  }

  for (const w of wallets || []) {
    if (!profileById.has(w.creator_id)) {
      report.orphanTransactions.walletWithoutProfile.push({
        walletId: w.id,
        creator_id: w.creator_id,
      });
    }
  }

  // ── 4. Duplicate earnings ────────────────────────────────────────────────────
  const earningsByCall = new Map();
  for (const ce of callEarnings || []) {
    if (!ce.call_id) continue;
    if (!earningsByCall.has(ce.call_id)) earningsByCall.set(ce.call_id, []);
    earningsByCall.get(ce.call_id).push(ce);
  }
  for (const [callId, rows] of earningsByCall) {
    if (rows.length > 1) {
      report.duplicateEarnings.duplicateCallEarnings.push({ callId, count: rows.length, rows });
    }
  }

  const giftEarningsByRef = new Map();
  for (const tx of creatorTx || []) {
    if (tx.type === 'gift_earning' && tx.reference_id) {
      if (!giftEarningsByRef.has(tx.reference_id)) giftEarningsByRef.set(tx.reference_id, []);
      giftEarningsByRef.get(tx.reference_id).push(tx);
    }
  }
  for (const [refId, rows] of giftEarningsByRef) {
    if (rows.length > 1) {
      report.duplicateEarnings.duplicateGiftEarnings.push({ referenceId: refId, count: rows.length, rows });
    }
  }

  // ── 5. Race condition analysis ─────────────────────────────────────────────
  for (const userId of allUserIds) {
    const profileId = resolveProfileId(userId);
    const wallet = walletByProfileId.get(profileId) || walletByProfileId.get(userId);
    const pending = pendingWithdrawalsByUser.get(userId) ?? 0;
    if (wallet && pending > 0) {
      const available = round2(wallet.available_balance);
      if (pending > available) {
        report.raceConditions.pendingWithdrawalDoubleSpendRisk.push({
          userId,
          creatorLabel: labelFor(userId),
          availableBalance: available,
          pendingApprovedTotal: pending,
          overcommit: round2(pending - available),
        });
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const balancePass = report.balanceReconciliation.length === 0 &&
    report.orphanTransactions.earningsWithoutWallet.length === 0;
  const negativePass = report.negativeBalances.length === 0;
  const orphanPass = Object.values(report.orphanTransactions).every((arr) => arr.length === 0);
  const duplicatePass =
    report.duplicateEarnings.duplicateCallEarnings.length === 0 &&
    report.duplicateEarnings.duplicateGiftEarnings.length === 0;
  const racePass =
    report.raceConditions.pendingWithdrawalDoubleSpendRisk.length === 0 &&
    report.raceConditions.walletFkIdMismatch.length === 0;

  report.summary = {
    balanceReconciliation: balancePass ? 'PASS' : 'FAIL',
    negativeBalances: negativePass ? 'PASS' : 'FAIL',
    orphanTransactions: orphanPass ? 'PASS' : 'FAIL',
    duplicateEarnings: duplicatePass ? 'PASS' : 'FAIL',
    raceConditions: racePass ? 'PASS' : 'WARN',
    overall: balancePass && negativePass && orphanPass && duplicatePass ? 'PASS' : 'FAIL',
    mismatchCount: report.balanceReconciliation.length,
    negativeCount: report.negativeBalances.length,
    orphanCount: Object.values(report.orphanTransactions).reduce((a, arr) => a + arr.length, 0),
    duplicateCount:
      report.duplicateEarnings.duplicateCallEarnings.length +
      report.duplicateEarnings.duplicateGiftEarnings.length,
    pendingOvercommitCount: report.raceConditions.pendingWithdrawalDoubleSpendRisk.length,
  };

  const outPath = path.join(__dirname, '..', '..', 'forensic-creator-wallets-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Full report: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
