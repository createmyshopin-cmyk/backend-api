#!/usr/bin/env node
/**
 * Verify Phase 12 remediation on live Supabase.
 * Usage: node scripts/verify-remediation.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const anon = createClient(url, anonKey);
const service = createClient(url, serviceKey);

const lockedRpcs = [
  ['adjust_user_coins', { p_user_id: crypto.randomUUID(), p_delta: 1 }],
  ['increment_creator_wallet', { p_creator_id: crypto.randomUUID(), p_amount: 1 }],
  ['verify_razorpay_payment_atomic', { p_order_id: 'x', p_payment_id: 'y' }],
  ['send_gift', {
    p_sender_user_id: crypto.randomUUID(),
    p_creator_user_id: crypto.randomUUID(),
    p_gift_id: crypto.randomUUID(),
    p_call_id: crypto.randomUUID(),
    p_idempotency_key: crypto.randomUUID(),
  }],
];

let failed = 0;

for (const [name, args] of lockedRpcs) {
  const { error } = await anon.rpc(name, args);
  const blocked = Boolean(error);
  console.log(`${blocked ? '✓' : '✗'} anon blocked ${name}: ${blocked ? 'yes' : error?.message ?? 'UNEXPECTED SUCCESS'}`);
  if (!blocked) failed++;
}

// RLS: anon cannot read coin_transactions
const { data: ledger, error: ledgerErr } = await anon.from('coin_transactions').select('id').limit(1);
const ledgerBlocked = ledgerErr != null || (ledger?.length ?? 0) === 0;
console.log(`${ledgerBlocked ? '✓' : '✗'} anon coin_transactions read blocked`);
if (!ledgerBlocked) failed++;

// Service role still works
const { error: svcErr } = await service.from('gifts').select('id').limit(1);
console.log(`${!svcErr ? '✓' : '✗'} service_role gifts read: ${svcErr?.message ?? 'ok'}`);
if (svcErr) failed++;

console.log(failed ? `\nFAIL (${failed} checks)` : '\nPASS — remediation verified');
process.exit(failed ? 1 : 0);
