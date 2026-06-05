import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// ─── Environment configuration ──────────────────────────────────────────────

function loadEnv(): { url: string; key: string } {
  // Search paths for .env
  const searchPaths = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '..', '.env'),
    path.join(process.cwd(), 'admin panel/backend/.env'),
    path.join(process.cwd(), '../admin panel/backend/.env'),
    path.join(process.cwd(), 'backend-api/.env'),
    path.join(process.cwd(), '../backend-api/.env'),
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '../admin panel/backend/.env'),
    path.join(__dirname, '../../admin panel/backend/.env'),
  ];

  let envPath = '';
  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      envPath = p;
      break;
    }
  }

  if (envPath) {
    console.log(`Loading environment from: ${envPath}`);
    dotenv.config({ path: envPath });
  } else {
    console.warn('Warning: No .env file found. Falling back to process.env');
  }

  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !key) {
    console.error('CRITICAL: Supabase URL or SERVICE_ROLE_KEY is missing from environment.');
    process.exit(1);
  }

  return { url, key };
}

// ─── Batch fetch helper (supports large datasets) ───────────────────────────

async function fetchAllRows<T = any>(
  client: any,
  table: string,
  columns = '*'
): Promise<T[]> {
  const result: T[] = [];
  const limit = 1000;
  let start = 0;
  let hasMore = true;

  while (hasMore) {
    // Attempt ordering by id (all tables in this app have 'id' or 'user_id')
    const { data, error } = await client
      .from(table)
      .select(columns)
      .order('id', { ascending: true })
      .range(start, start + limit - 1);

    if (error) {
      // Fallback query without sorting in case ordering fails
      const fallbackQuery = await client
        .from(table)
        .select(columns)
        .range(start, start + limit - 1);

      if (fallbackQuery.error) {
        throw new Error(`Failed to fetch from table ${table}: ${fallbackQuery.error.message}`);
      }

      const rows = fallbackQuery.data || [];
      result.push(...rows);
      if (rows.length < limit) {
        hasMore = false;
      }
    } else {
      const rows = data || [];
      result.push(...rows);
      if (rows.length < limit) {
        hasMore = false;
      }
    }

    start += limit;
  }

  return result;
}

// ─── Main Execution ─────────────────────────────────────────────────────────

async function run() {
  const { url, key } = loadEnv();
  const client = createClient(url, key);

  console.log('Fetching database tables for consistency checks...');

  // Load datasets in parallel
  const [
    users,
    creatorProfiles,
    calls,
    coinTransactions,
    creatorEarnings,
    creatorWallets,
    withdrawals,
    creatorTransactions,
  ] = await Promise.all([
    fetchAllRows(client, 'users'),
    fetchAllRows(client, 'creator_profiles'),
    fetchAllRows(client, 'calls'),
    fetchAllRows(client, 'coin_transactions'),
    fetchAllRows(client, 'creator_earnings'),
    fetchAllRows(client, 'creator_wallets'),
    fetchAllRows(client, 'withdrawals'),
    fetchAllRows(client, 'creator_transactions'),
  ]);

  console.log('Data loaded successfully. Running audits...\n');

  // Build lookups for efficient O(1) checks
  const userMap = new Map<string, any>(users.map(u => [u.id, u]));
  const profileMap = new Map<string, any>(creatorProfiles.map(p => [p.id, p]));
  const profileByUserId = new Map<string, any>(creatorProfiles.map(p => [p.user_id, p]));
  const callMap = new Map<string, any>(calls.map(c => [c.id, c]));
  const walletMap = new Map<string, any>(creatorWallets.map(w => [w.creator_id, w]));

  // Helper to resolve user_id from wallet/profile creator_id
  function resolveUserId(creatorId: string): string {
    if (userMap.has(creatorId)) return creatorId;
    const profile = profileMap.get(creatorId);
    if (profile?.user_id) return profile.user_id;
    return creatorId;
  }

  const reports: string[] = [];
  let isProductionReady = true;

  // -------------------------------------------------------------
  // CHECK 1: CALL INTEGRITY
  // -------------------------------------------------------------
  let check1Total = 0;
  let check1Ended = 0;
  let check1Valid = 0;
  let check1Broken = 0;
  const check1Issues: string[] = [];

  for (const c of calls) {
    check1Total++;
    if (c.status === 'ended') {
      check1Ended++;
      const hasCaller = userMap.has(c.caller_id);
      const hasCreator = userMap.has(c.creator_id);
      const durationOk = Number(c.duration_seconds || 0) > 0;
      const coinsOk = Number(c.coins_spent || c.coins_deducted || 0) > 0;

      if (hasCaller && hasCreator && durationOk && coinsOk) {
        check1Valid++;
      } else {
        check1Broken++;
        const errors: string[] = [];
        if (!hasCaller) errors.push(`caller ${c.caller_id} missing`);
        if (!hasCreator) errors.push(`creator ${c.creator_id} missing`);
        if (!durationOk) errors.push(`duration_seconds is ${c.duration_seconds}`);
        if (!coinsOk) errors.push(`coins_spent is ${c.coins_spent || c.coins_deducted}`);
        check1Issues.push(`Call ${c.id}: ${errors.join(', ')}`);
      }
    }
  }

  // -------------------------------------------------------------
  // CHECK 2: COIN DEDUCTION LEDGER
  // -------------------------------------------------------------
  let check2Valid = 0;
  let check2Missing = 0;
  let check2Duplicates = 0;
  const check2Issues: string[] = [];

  // Index transactions by reference_id for ended calls
  const txsByRef = new Map<string, any[]>();
  for (const tx of coinTransactions) {
    if (tx.type === 'call_deduction' && tx.reference_id) {
      const list = txsByRef.get(tx.reference_id) || [];
      list.push(tx);
      txsByRef.set(tx.reference_id, list);
    }
  }

  const endedCalls = calls.filter(c => c.status === 'ended');
  for (const c of endedCalls) {
    const txs = txsByRef.get(c.id) || [];
    if (txs.length === 0) {
      check2Missing++;
      check2Issues.push(`Call ${c.id}: Missing call_deduction ledger entry`);
    } else if (txs.length > 1) {
      check2Duplicates++;
      check2Issues.push(`Call ${c.id}: Duplicate call_deduction ledger entries (${txs.length} found)`);
    } else {
      const tx = txs[0];
      if (tx.user_id !== c.caller_id) {
        check2Issues.push(`Call ${c.id}: Ledger user_id ${tx.user_id} does not match caller_id ${c.caller_id}`);
      } else {
        check2Valid++;
      }
    }
  }

  // Check for broken references (tx points to non-existent or non-ended call)
  for (const tx of coinTransactions) {
    if (tx.type === 'call_deduction' && tx.reference_id) {
      const c = callMap.get(tx.reference_id);
      if (!c) {
        check2Issues.push(`Transaction ${tx.id}: Reference call ${tx.reference_id} does not exist`);
      } else if (c.status !== 'ended') {
        check2Issues.push(`Transaction ${tx.id}: Reference call ${tx.reference_id} is in status ${c.status} (expected ended)`);
      }
    }
  }

  // -------------------------------------------------------------
  // CHECK 3: LISTENER EARNINGS
  // -------------------------------------------------------------
  let check3Valid = 0;
  let check3Missing = 0;
  let check3Duplicates = 0;
  const check3Issues: string[] = [];

  // Index earnings by call_id
  const earningsByCall = new Map<string, any[]>();
  for (const e of creatorEarnings) {
    if (e.call_id) {
      const list = earningsByCall.get(e.call_id) || [];
      list.push(e);
      earningsByCall.set(e.call_id, list);
    }
  }

  for (const c of endedCalls) {
    const earnings = earningsByCall.get(c.id) || [];
    if (earnings.length === 0) {
      check3Missing++;
      check3Issues.push(`Call ${c.id}: Missing creator_earnings record`);
    } else if (earnings.length > 1) {
      check3Duplicates++;
      check3Issues.push(`Call ${c.id}: Duplicate creator_earnings records (${earnings.length} found)`);
    } else {
      const e = earnings[0];
      const coinsCharged = Number(c.coins_spent || c.coins_deducted || 0);
      const grossAmount = Number(e.gross_amount || 0);

      if (e.creator_id !== c.creator_id || grossAmount !== coinsCharged) {
        check3Issues.push(`Call ${c.id}: Earnings mismatch (expected creator ${c.creator_id}, amount ${coinsCharged}; found creator ${e.creator_id}, amount ${grossAmount})`);
      } else {
        check3Valid++;
      }
    }
  }

  // Check for invalid references
  for (const e of creatorEarnings) {
    if (e.call_id) {
      const c = callMap.get(e.call_id);
      if (!c) {
        check3Issues.push(`Earning ${e.id}: Referenced call ${e.call_id} does not exist`);
      }
    }
  }

  // -------------------------------------------------------------
  // CHECK 4: WALLET CONSISTENCY
  // -------------------------------------------------------------
  let check4Valid = 0;
  let check4Mismatches = 0;
  const check4Issues: string[] = [];

  // Reconcile user coin wallets
  const txsByUser = new Map<string, any[]>();
  for (const tx of coinTransactions) {
    const list = txsByUser.get(tx.user_id) || [];
    list.push(tx);
    txsByUser.set(tx.user_id, list);
  }

  for (const u of users) {
    const userTxs = txsByUser.get(u.id) || [];
    const credits = userTxs.filter(tx => tx.amount > 0).reduce((sum, tx) => sum + Number(tx.amount), 0);
    const debits = userTxs.filter(tx => tx.amount < 0).reduce((sum, tx) => sum - Number(tx.amount), 0);
    const expected = credits - debits;

    const actual = Number(u.coins || 0);
    const difference = actual - expected;

    // Normal users start with 100 bonus coins, but there is no transaction log.
    // Allow either exact match or exact 100 coins starting bonus difference.
    if (actual === expected || actual === expected + 100) {
      check4Valid++;
    } else {
      check4Mismatches++;
      check4Issues.push(`User ${u.id} (${u.name}): Balance is ${actual}, expected ${expected} (credits ${credits}, debits ${debits}, diff ${difference})`);
    }
  }

  // Reconcile creator wallets
  const earningsByCreator = new Map<string, number>();
  for (const e of creatorEarnings) {
    earningsByCreator.set(e.creator_id, (earningsByCreator.get(e.creator_id) || 0) + Number(e.creator_share || 0));
  }

  const paidWithdrawalsByCreator = new Map<string, number>();
  for (const w of withdrawals) {
    if (w.status === 'paid') {
      paidWithdrawalsByCreator.set(w.creator_id, (paidWithdrawalsByCreator.get(w.creator_id) || 0) + Number(w.amount || 0));
    }
  }

  for (const cw of creatorWallets) {
    const userId = resolveUserId(cw.creator_id);
    const totalEarned = earningsByCreator.get(userId) || 0;
    const totalWithdrawn = paidWithdrawalsByCreator.get(userId) || 0;
    const expectedAvailable = totalEarned - totalWithdrawn;

    const actualAvailable = Number(cw.available_balance || 0);
    const actualEarned = Number(cw.total_earned || 0);
    const actualWithdrawn = Number(cw.withdrawn_amount || 0);

    const matchAvailable = Math.abs(actualAvailable - expectedAvailable) <= 0.01;
    const matchEarned = Math.abs(actualEarned - totalEarned) <= 0.01;
    const matchWithdrawn = Math.abs(actualWithdrawn - totalWithdrawn) <= 0.01;

    if (matchAvailable && matchEarned && matchWithdrawn) {
      check4Valid++;
    } else {
      check4Mismatches++;
      const errors: string[] = [];
      if (!matchAvailable) errors.push(`available ${actualAvailable} vs expected ${expectedAvailable}`);
      if (!matchEarned) errors.push(`earned ${actualEarned} vs expected ${totalEarned}`);
      if (!matchWithdrawn) errors.push(`withdrawn ${actualWithdrawn} vs expected ${totalWithdrawn}`);
      check4Issues.push(`Creator Wallet ${cw.id} (user ${userId}): ${errors.join(', ')}`);
    }
  }

  // -------------------------------------------------------------
  // CHECK 5: LISTENER PROFILE INTEGRITY
  // -------------------------------------------------------------
  let check5Valid = 0;
  let check5Broken = 0;
  const check5Issues: string[] = [];
  const allowedStatuses = new Set(['pending', 'approved', 'rejected', 'suspended', 'active']);

  for (const p of creatorProfiles) {
    const user = userMap.get(p.user_id);
    const statusValid = allowedStatuses.has(p.status || '');
    
    let isCreatorOk = true;
    if (user) {
      const isApproved = p.status === 'approved' || p.status === 'active';
      const isSuspended = p.status === 'suspended';

      if (isApproved && !user.is_creator) {
        isCreatorOk = false;
      }
      if (isSuspended && user.is_creator) {
        isCreatorOk = false;
      }
    }

    if (user && statusValid && isCreatorOk) {
      check5Valid++;
    } else {
      check5Broken++;
      const errors: string[] = [];
      if (!user) errors.push(`user ${p.user_id} missing`);
      if (!statusValid) errors.push(`invalid status '${p.status}'`);
      if (!isCreatorOk) errors.push(`mismatch with users.is_creator (${user?.is_creator})`);
      check5Issues.push(`Profile ${p.id}: ${errors.join(', ')}`);
    }
  }

  // -------------------------------------------------------------
  // CHECK 6: WITHDRAWAL INTEGRITY
  // -------------------------------------------------------------
  let check6Valid = 0;
  let check6Broken = 0;
  const check6Issues: string[] = [];

  const paidWithdrawalTxs = new Map<string, any[]>();
  for (const tx of creatorTransactions) {
    if (tx.type === 'withdrawal' && tx.reference_id) {
      const list = paidWithdrawalTxs.get(tx.reference_id) || [];
      list.push(tx);
      paidWithdrawalTxs.set(tx.reference_id, list);
    }
  }

  for (const w of withdrawals) {
    const ownerExists = userMap.has(w.creator_id);
    const amountOk = Number(w.amount || 0) > 0;
    
    let ledgerOk = true;
    if (w.status === 'paid') {
      const txs = paidWithdrawalTxs.get(w.id) || [];
      if (txs.length === 0) {
        ledgerOk = false;
      }
    }

    if (ownerExists && amountOk && ledgerOk) {
      check6Valid++;
    } else {
      check6Broken++;
      const errors: string[] = [];
      if (!ownerExists) errors.push(`owner user ${w.creator_id} missing`);
      if (!amountOk) errors.push(`amount is ${w.amount}`);
      if (!ledgerOk) errors.push(`missing paid ledger transaction`);
      check6Issues.push(`Withdrawal ${w.id}: ${errors.join(', ')}`);
    }
  }

  // -------------------------------------------------------------
  // CHECK 7: ORPHAN RECORDS
  // -------------------------------------------------------------
  let check7Count = 0;
  const check7Issues: string[] = [];

  // creator_profiles without users
  for (const p of creatorProfiles) {
    if (!userMap.has(p.user_id)) {
      check7Count++;
      check7Issues.push(`Orphan profile ${p.id}: references non-existent user ${p.user_id}`);
    }
  }

  // calls without users
  for (const c of calls) {
    if (!userMap.has(c.caller_id)) {
      check7Count++;
      check7Issues.push(`Orphan call ${c.id}: references non-existent caller ${c.caller_id}`);
    }
    if (!userMap.has(c.creator_id)) {
      check7Count++;
      check7Issues.push(`Orphan call ${c.id}: references non-existent creator ${c.creator_id}`);
    }
  }

  // transactions without users
  for (const tx of coinTransactions) {
    if (!userMap.has(tx.user_id)) {
      check7Count++;
      check7Issues.push(`Orphan transaction ${tx.id}: references non-existent user ${tx.user_id}`);
    }
  }

  // earnings without creators
  for (const e of creatorEarnings) {
    if (!userMap.has(e.creator_id)) {
      check7Count++;
      check7Issues.push(`Orphan earning ${e.id}: references non-existent creator ${e.creator_id}`);
    }
  }

  // withdrawals without creators
  for (const w of withdrawals) {
    if (!userMap.has(w.creator_id)) {
      check7Count++;
      check7Issues.push(`Orphan withdrawal ${w.id}: references non-existent creator ${w.creator_id}`);
    }
  }

  // -------------------------------------------------------------
  // CHECK 8: DUPLICATES
  // -------------------------------------------------------------
  let check8Count = 0;
  const check8Issues: string[] = [];

  // Duplicate earnings (same call_id)
  const earningsCallsSeen = new Set<string>();
  for (const e of creatorEarnings) {
    if (e.call_id) {
      if (earningsCallsSeen.has(e.call_id)) {
        check8Count++;
        check8Issues.push(`Duplicate earning: call_id ${e.call_id} referenced multiple times`);
      }
      earningsCallsSeen.add(e.call_id);
    }
  }

  // Duplicate coin transactions (same reference_id for call_deductions)
  const txCallRefsSeen = new Set<string>();
  for (const tx of coinTransactions) {
    if (tx.type === 'call_deduction' && tx.reference_id) {
      if (txCallRefsSeen.has(tx.reference_id)) {
        check8Count++;
        check8Issues.push(`Duplicate transaction: reference_id ${tx.reference_id} has multiple call_deductions`);
      }
      txCallRefsSeen.add(tx.reference_id);
    }
  }

  // Duplicate withdrawals (same creator_id, amount, requested_at)
  const withdrawalKeysSeen = new Set<string>();
  for (const w of withdrawals) {
    const key = `${w.creator_id}-${w.amount}-${w.requested_at || w.created_at}`;
    if (withdrawalKeysSeen.has(key)) {
      check8Count++;
      check8Issues.push(`Duplicate withdrawal: owner ${w.creator_id}, amount ${w.amount}, date ${w.requested_at || w.created_at}`);
    }
    withdrawalKeysSeen.add(key);
  }

  // Duplicate creator profiles (same user_id)
  const profileUsersSeen = new Set<string>();
  for (const p of creatorProfiles) {
    if (profileUsersSeen.has(p.user_id)) {
      check8Count++;
      check8Issues.push(`Duplicate creator profile: user_id ${p.user_id} has multiple profiles`);
    }
    profileUsersSeen.add(p.user_id);
  }

  // -------------------------------------------------------------
  // CHECK 9: PERFORMANCE AUDIT (INDEXES)
  // -------------------------------------------------------------
  let check9Count = 0;
  const check9Issues: string[] = [];

  const requiredIndexes = [
    { table: 'users', column: 'id', desc: 'Primary key index on users' },
    { table: 'users', column: 'firebase_uid', desc: 'Unique constraint index on users' },
    { table: 'creator_profiles', column: 'user_id', desc: 'Unique constraint index on profiles' },
    { table: 'calls', column: 'id', desc: 'Primary key index on calls' },
    { table: 'calls', column: 'caller_id', desc: 'Foreign key index on calls(caller_id)' },
    { table: 'calls', column: 'creator_id', desc: 'Foreign key index on calls(creator_id)' },
    { table: 'coin_transactions', column: 'user_id', desc: 'Foreign key index on transactions' },
    { table: 'coin_transactions', column: 'reference_id', desc: 'Foreign key index on transactions' },
    { table: 'creator_earnings', column: 'call_id', desc: 'Foreign key index on earnings' },
    { table: 'withdrawals', column: 'creator_id', desc: 'Foreign key index on withdrawals' },
  ];

  // Load migration files from project
  const migrationsPaths = [
    path.join(process.cwd(), 'supabase/migrations'),
    path.join(process.cwd(), '../supabase/migrations'),
    path.join(process.cwd(), 'admin panel/backend/supabase/migrations'),
    path.join(process.cwd(), '../admin panel/backend/supabase/migrations'),
  ];

  let migrationsDir = '';
  for (const p of migrationsPaths) {
    if (fs.existsSync(p)) {
      migrationsDir = p;
      break;
    }
  }

  let mergedSQL = '';
  if (migrationsDir) {
    const files = fs.readdirSync(migrationsDir);
    for (const f of files) {
      if (f.endsWith('.sql')) {
        mergedSQL += fs.readFileSync(path.join(migrationsDir, f), 'utf8') + '\n';
      }
    }
  }

  // Load baseline sql files
  const baselinePaths = [
    path.join(process.cwd(), 'admin-panel/voice calling app db 2026.sql'),
    path.join(process.cwd(), '../admin-panel/voice calling app db 2026.sql'),
    path.join(process.cwd(), 'admin panel/frontend/voice calling app db 2026.sql'),
    path.join(process.cwd(), '../admin panel/frontend/voice calling app db 2026.sql'),
  ];
  for (const p of baselinePaths) {
    if (fs.existsSync(p)) {
      mergedSQL += fs.readFileSync(p, 'utf8') + '\n';
    }
  }

  for (const ind of requiredIndexes) {
    // PKs and UNIQUE constraints are implicit indexes in postgresql
    const isImplicit =
      ind.column === 'id' ||
      (ind.table === 'users' && ind.column === 'firebase_uid') ||
      (ind.table === 'creator_profiles' && ind.column === 'user_id');

    let isDefined = isImplicit;
    if (!isDefined && mergedSQL) {
      // Regex check for CREATE INDEX ON table(column) - supporting optional IF NOT EXISTS
      const regex = new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?\\w+\\s+ON\\s+(?:public\\.)?${ind.table}\\s*\\(\\s*${ind.column}(?:\\s+DESC|\\s+ASC)?\\s*\\)`, 'i');
      isDefined = regex.test(mergedSQL);
    }

    if (!isDefined) {
      check9Count++;
      check9Issues.push(`Missing index: ${ind.table}(${ind.column}) - ${ind.desc}`);
    }
  }

  // ─── Health Scoring Logic ──────────────────────────────────────────────────

  const totalChecks = 6;
  let passedChecksCount = 0;

  if (check1Broken === 0) passedChecksCount++;
  if (check2Missing === 0 && check2Duplicates === 0) passedChecksCount++;
  if (check3Missing === 0 && check3Duplicates === 0) passedChecksCount++;
  if (check4Mismatches === 0) passedChecksCount++;
  if (check5Broken === 0) passedChecksCount++;
  if (check6Broken === 0) passedChecksCount++;

  const integrityScore = Math.round((passedChecksCount / totalChecks) * 100);

  if (
    check1Broken > 0 ||
    check2Missing > 0 ||
    check3Missing > 0 ||
    check4Mismatches > 0 ||
    check5Broken > 0 ||
    check6Broken > 0 ||
    check7Count > 0 ||
    check8Count > 0
  ) {
    isProductionReady = false;
  }

  // ─── Output Formatting ─────────────────────────────────────────────────────

  console.log('=================================');
  console.log('DATABASE HEALTH REPORT');
  console.log('=================================');
  console.log('Calls\n');
  console.log(`Total Calls: ${check1Total}`);
  console.log(`Ended Calls: ${check1Ended}`);
  console.log(`Valid Calls: ${check1Valid}`);
  console.log(`Broken Calls: ${check1Broken}`);
  console.log('---');
  console.log('Transactions\n');
  console.log(`Valid: ${check2Valid}`);
  console.log(`Missing: ${check2Missing}`);
  console.log(`Duplicates: ${check2Duplicates}`);
  console.log('---');
  console.log('Listener Earnings\n');
  console.log(`Valid: ${check3Valid}`);
  console.log(`Missing: ${check3Missing}`);
  console.log(`Duplicates: ${check3Duplicates}`);
  console.log('---');
  console.log('Wallets\n');
  console.log(`Valid: ${check4Valid}`);
  console.log(`Mismatches: ${check4Mismatches}`);
  console.log('---');
  console.log('Listener Profiles\n');
  console.log(`Valid: ${check5Valid}`);
  console.log(`Broken: ${check5Broken}`);
  console.log('---');
  console.log('Withdrawals\n');
  console.log(`Valid: ${check6Valid}`);
  console.log(`Broken: ${check6Broken}`);
  console.log('---');
  console.log('Orphan Records\n');
  console.log(`Count: ${check7Count}`);
  console.log('---');
  console.log('Missing Indexes\n');
  console.log(`Count: ${check9Count}`);
  console.log('---');
  console.log('FINAL SCORE\n');
  console.log(`Database Integrity: ${integrityScore}%`);
  console.log('Production Ready:\n');
  console.log(isProductionReady ? 'YES' : 'NO');
  console.log('=================================\n');

  // Print issue details if present
  const allIssues = [
    { title: 'Call Integrity Issues', list: check1Issues },
    { title: 'Coin Ledger Issues', list: check2Issues },
    { title: 'Earnings Mismatch Issues', list: check3Issues },
    { title: 'Wallet Balance Mismatches', list: check4Issues },
    { title: 'Profile Integrity Mismatches', list: check5Issues },
    { title: 'Withdrawal Integrity Issues', list: check6Issues },
    { title: 'Orphan Record Locations', list: check7Issues },
    { title: 'Duplicate Records Detected', list: check8Issues },
    { title: 'Performance Index Gaps', list: check9Issues },
  ];

  const hasIssues = allIssues.some(grp => grp.list.length > 0);
  if (hasIssues) {
    console.log('=================================');
    console.log('DETAILED BREAKDOWN');
    console.log('=================================');
    for (const grp of allIssues) {
      if (grp.list.length > 0) {
        console.log(`\n[${grp.title}]`);
        grp.list.slice(0, 20).forEach(msg => console.log(` - ${msg}`));
        if (grp.list.length > 20) {
          console.log(` ... and ${grp.list.length - 20} more issues.`);
        }
      }
    }
    console.log('=================================\n');
  }
}

run().catch((e) => {
  console.error('Audit failed to complete:', e);
  process.exit(1);
});
