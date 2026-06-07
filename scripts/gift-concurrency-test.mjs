#!/usr/bin/env node
/**
 * Concurrent gift idempotency test (requires Supabase service role + test data).
 * Usage: node scripts/gift-concurrency-test.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const client = createClient(url, key);
const senderId = process.env.CALLER_ID;
const creatorId = process.env.CREATOR_ID;
const callId = process.env.CALL_ID;

if (!senderId || !creatorId || !callId) {
  console.error('Set CALLER_ID, CREATOR_ID, CALL_ID for live concurrency test');
  process.exit(1);
}

const { data: gift } = await client.from('gifts').select('id').eq('coin_cost', 10).single();
if (!gift) {
  console.error('Rose gift not found');
  process.exit(1);
}

const idem = randomUUID();
const concurrency = Number(process.env.CONCURRENCY || 100);

console.log(`Firing ${concurrency} parallel send_gift with same idempotency key...`);

const calls = Array.from({ length: concurrency }, () =>
  client.rpc('send_gift', {
    p_sender_user_id: senderId,
    p_creator_user_id: creatorId,
    p_gift_id: gift.id,
    p_call_id: callId,
    p_idempotency_key: idem,
  }),
);

const results = await Promise.allSettled(calls);
const ok = results.filter((r) => r.status === 'fulfilled' && !r.value.error);
const txnIds = new Set(
  ok.map((r) => r.value.data?.gift_transaction_id).filter(Boolean),
);

const { data: txns } = await client
  .from('gift_transactions')
  .select('id')
  .eq('sender_user_id', senderId)
  .eq('idempotency_key', idem);

console.log(`Success responses: ${ok.length}/${concurrency}`);
console.log(`Unique transaction IDs in responses: ${txnIds.size}`);
console.log(`DB rows for idempotency key: ${txns?.length ?? 0}`);

if (txnIds.size !== 1 || (txns?.length ?? 0) !== 1) {
  console.error('FAIL: duplicate deduction detected');
  process.exit(1);
}

console.log('PASS: idempotent under concurrent load');
