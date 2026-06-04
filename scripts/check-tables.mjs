import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Supabase credentials missing in env');
    return;
  }
  const client = createClient(url, key);

  console.log('Testing creator_wallets table...');
  const { data: walletsData, error: walletsError } = await client.from('creator_wallets').select('*').limit(1);
  if (walletsError) {
    console.error('creator_wallets error:', walletsError.message, walletsError.code);
  } else {
    console.log('creator_wallets exists! Rows:', walletsData);
  }

  console.log('Testing creator_earnings table...');
  const { data: earningsData, error: earningsError } = await client.from('creator_earnings').select('*').limit(1);
  if (earningsError) {
    console.error('creator_earnings error:', earningsError.message, earningsError.code);
  } else {
    console.log('creator_earnings exists! Rows:', earningsData);
  }

  console.log('Testing withdrawals table...');
  const { data: wData, error: wError } = await client.from('withdrawals').select('*').limit(1);
  if (wError) {
    console.error('withdrawals error:', wError.message, wError.code);
  } else {
    console.log('withdrawals exists! Rows:', wData);
  }

  console.log('Testing creator_transactions table...');
  const { data: tData, error: tError } = await client.from('creator_transactions').select('*').limit(1);
  if (tError) {
    console.error('creator_transactions error:', tError.message, tError.code);
  } else {
    console.log('creator_transactions exists! Rows:', tData);
  }
}

main();
