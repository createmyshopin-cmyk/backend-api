#!/usr/bin/env node
/**
 * Verify creator_wallets.creator_id references creator_profiles.id (not orphan users).
 * Run: node scripts/verify-creator-wallet-fk.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const client = createClient(url, key);

const { data: wallets, error } = await client.from('creator_wallets').select('creator_id');
if (error) {
  console.error('Query failed:', error.message);
  process.exit(1);
}

let orphans = 0;
for (const w of wallets ?? []) {
  const { data: profile } = await client
    .from('creator_profiles')
    .select('id')
    .eq('id', w.creator_id)
    .maybeSingle();
  if (!profile) orphans++;
}

console.log(JSON.stringify({
  walletRows: wallets?.length ?? 0,
  orphanWallets: orphans,
  pass: orphans === 0,
}, null, 2));

process.exit(orphans === 0 ? 0 : 1);
