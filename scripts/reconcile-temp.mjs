import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const client = createClient(url, key);

  console.log('Retrieving tables metadata...');

  const { data: wallets } = await client.from('creator_wallets').select('*').limit(3);
  console.log('creator_wallets sample:', wallets);

  const { data: earnings } = await client.from('creator_earnings').select('*').limit(3);
  console.log('creator_earnings sample:', earnings);

  const { data: withdrawals } = await client.from('withdrawals').select('*').limit(3);
  console.log('withdrawals sample:', withdrawals);

  const { data: profiles } = await client.from('creator_profiles').select('*').limit(3);
  console.log('creator_profiles sample:', profiles);
}

main();
