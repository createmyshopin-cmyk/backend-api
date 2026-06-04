import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    console.error('Supabase credentials missing in env');
    process.exit(1);
  }

  const client = createClient(url, key);

  console.log('--- DB RECONCILIATION AUDIT START ---');

  // 1. Fetch all data
  const [
    { data: wallets, error: walletsErr },
    { data: profiles, error: profilesErr },
    { data: users, error: usersErr },
    { data: earnings, error: earningsErr },
    { data: withdrawals, error: withdrawalsErr },
  ] = await Promise.all([
    client.from('creator_wallets').select('*'),
    client.from('creator_profiles').select('id, user_id'),
    client.from('users').select('id, name, phone, email'),
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
  const userById = new Map((users || []).map((u) => [u.id, u]));

  // Helper to map wallet.creator_id to users.id
  function resolveUserId(walletCreatorId) {
    if (userById.has(walletCreatorId)) return walletCreatorId;
    const profile = profileById.get(walletCreatorId);
    if (profile?.user_id) return profile.user_id;
    return walletCreatorId;
  }

  // Aggregate earnings
  const earningsByUser = new Map();
  for (const row of earnings || []) {
    const uid = row.creator_id;
    earningsByUser.set(uid, round2((earningsByUser.get(uid) || 0) + Number(row.creator_share)));
  }

  // Aggregate paid withdrawals
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
  const repairSQLStatements = [];
  const affectedCreatorIds = [];

  console.log(`Auditing ${wallets?.length || 0} wallets...`);

  // Track user IDs that already have wallets
  const walletUserIds = new Set();

  for (const wallet of wallets || []) {
    const userId = resolveUserId(wallet.creator_id);
    walletUserIds.add(userId);

    const ledgerEarnings = earningsByUser.get(userId) ?? 0;
    const ledgerPaidWithdrawals = paidWithdrawalsByUser.get(userId) ?? 0;
    const expectedAvailable = round2(ledgerEarnings - ledgerPaidWithdrawals);

    const actualAvailable = round2(wallet.available_balance);
    const actualTotalEarned = round2(wallet.total_earned);
    const actualWithdrawn = round2(wallet.withdrawn_amount);

    const availableMatches = nearlyEqual(actualAvailable, expectedAvailable);
    const totalEarnedMatches = nearlyEqual(actualTotalEarned, ledgerEarnings);
    const withdrawnMatches = nearlyEqual(actualWithdrawn, ledgerPaidWithdrawals);

    if (!availableMatches || !totalEarnedMatches || !withdrawnMatches) {
      mismatches.push({
        walletId: wallet.id,
        creatorIdInWallet: wallet.creator_id,
        userId,
        actual: {
          available_balance: actualAvailable,
          total_earned: actualTotalEarned,
          withdrawn_amount: actualWithdrawn,
        },
        expected: {
          available_balance: expectedAvailable,
          total_earned: ledgerEarnings,
          withdrawn_amount: ledgerPaidWithdrawals,
        },
      });

      affectedCreatorIds.push(wallet.creator_id);

      // Generate SQL Update statement
      const sql = `UPDATE public.creator_wallets SET total_earned = ${ledgerEarnings}, withdrawn_amount = ${ledgerPaidWithdrawals}, available_balance = ${expectedAvailable}, updated_at = NOW() WHERE creator_id = '${wallet.creator_id}';`;
      repairSQLStatements.push(sql);
    }
  }

  // Handle cases where a creator has transactions but NO wallet record
  const allCreatorUserIds = new Set([
    ...earningsByUser.keys(),
    ...paidWithdrawalsByUser.keys(),
  ]);

  for (const userId of allCreatorUserIds) {
    if (!walletUserIds.has(userId)) {
      const ledgerEarnings = earningsByUser.get(userId) ?? 0;
      const ledgerPaidWithdrawals = paidWithdrawalsByUser.get(userId) ?? 0;
      const expectedAvailable = round2(ledgerEarnings - ledgerPaidWithdrawals);

      if (ledgerEarnings > 0 || ledgerPaidWithdrawals > 0) {
        console.log(`Creator ${userId} has transactions but no wallet record.`);
        // We will insert a wallet record for them.
        mismatches.push({
          walletId: null,
          creatorIdInWallet: userId,
          userId,
          actual: null,
          expected: {
            available_balance: expectedAvailable,
            total_earned: ledgerEarnings,
            withdrawn_amount: ledgerPaidWithdrawals,
          },
        });

        affectedCreatorIds.push(userId);

        const sql = `INSERT INTO public.creator_wallets (creator_id, total_earned, withdrawn_amount, available_balance, created_at, updated_at) VALUES ('${userId}', ${ledgerEarnings}, ${ledgerPaidWithdrawals}, ${expectedAvailable}, NOW(), NOW());`;
        repairSQLStatements.push(sql);
      }
    }
  }

  console.log(`Found ${mismatches.length} mismatches.`);

  // Write repair SQL file
  const sqlFilePath = path.join(__dirname, 'repair-creator-wallets.sql');
  if (repairSQLStatements.length > 0) {
    fs.writeFileSync(sqlFilePath, repairSQLStatements.join('\n') + '\n');
    console.log(`Repair SQL written to: scripts/repair-creator-wallets.sql`);
  } else {
    fs.writeFileSync(sqlFilePath, '-- No repairs needed. Everything is reconciled.\n');
  }

  // Update Database if there are mismatches
  if (mismatches.length > 0) {
    console.log('Repairing creator wallets in DB...');
    for (const mismatch of mismatches) {
      if (mismatch.walletId) {
        console.log(`Updating wallet ${mismatch.walletId} (creator_id: ${mismatch.creatorIdInWallet})...`);
        const { error: updateErr } = await client
          .from('creator_wallets')
          .update({
            total_earned: mismatch.expected.total_earned,
            withdrawn_amount: mismatch.expected.withdrawn_amount,
            available_balance: mismatch.expected.available_balance,
          })
          .eq('creator_id', mismatch.creatorIdInWallet);

        if (updateErr) {
          console.error(`Error updating wallet ${mismatch.walletId}:`, updateErr.message);
        }
      } else {
        console.log(`Inserting wallet for user ${mismatch.userId}...`);
        const { error: insertErr } = await client
          .from('creator_wallets')
          .insert({
            creator_id: mismatch.userId,
            total_earned: mismatch.expected.total_earned,
            withdrawn_amount: mismatch.expected.withdrawn_amount,
            available_balance: mismatch.expected.available_balance,
          });

        if (insertErr) {
          console.error(`Error inserting wallet for user ${mismatch.userId}:`, insertErr.message);
        }
      }
    }
  }

  // 2. Verification check after repairs
  console.log('Verifying repairs...');
  const { data: updatedWallets, error: updatedWalletsErr } = await client.from('creator_wallets').select('*');
  if (updatedWalletsErr) {
    console.error('Error fetching updated wallets:', updatedWalletsErr.message);
    process.exit(1);
  }

  let finalFailures = 0;
  const updatedWalletUserIds = new Set();

  for (const wallet of updatedWallets || []) {
    const userId = resolveUserId(wallet.creator_id);
    updatedWalletUserIds.add(userId);

    const ledgerEarnings = earningsByUser.get(userId) ?? 0;
    const ledgerPaidWithdrawals = paidWithdrawalsByUser.get(userId) ?? 0;
    const expectedAvailable = round2(ledgerEarnings - ledgerPaidWithdrawals);

    const actualAvailable = round2(wallet.available_balance);
    const actualTotalEarned = round2(wallet.total_earned);
    const actualWithdrawn = round2(wallet.withdrawn_amount);

    if (
      !nearlyEqual(actualAvailable, expectedAvailable) ||
      !nearlyEqual(actualTotalEarned, ledgerEarnings) ||
      !nearlyEqual(actualWithdrawn, ledgerPaidWithdrawals)
    ) {
      console.error(`Verification failure on wallet ${wallet.id}:`, {
        actual: { available: actualAvailable, earned: actualTotalEarned, withdrawn: actualWithdrawn },
        expected: { available: expectedAvailable, earned: ledgerEarnings, withdrawn: ledgerPaidWithdrawals },
      });
      finalFailures++;
    }
  }

  for (const userId of allCreatorUserIds) {
    if (!updatedWalletUserIds.has(userId)) {
      const ledgerEarnings = earningsByUser.get(userId) ?? 0;
      const ledgerPaidWithdrawals = paidWithdrawalsByUser.get(userId) ?? 0;
      if (ledgerEarnings > 0 || ledgerPaidWithdrawals > 0) {
        console.error(`Verification failure: User ${userId} has transactions but no wallet in DB.`);
        finalFailures++;
      }
    }
  }

  console.log('--- RECONCILIATION SUMMARY ---');
  if (finalFailures === 0) {
    console.log('PASS');
  } else {
    console.log('FAIL');
  }

  if (affectedCreatorIds.length > 0) {
    console.log('Affected creator IDs:', affectedCreatorIds.join(', '));
  } else {
    console.log('Affected creator IDs: None');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
