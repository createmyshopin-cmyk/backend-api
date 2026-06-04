import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const client = createClient(url, key);

  try {
    const { data, error } = await client.from('pg_indexes').select('*').limit(5);
    console.log('Direct pg_indexes:', error?.message || data);
  } catch (e) {
    console.log('Direct pg_indexes error:', e.message);
  }

  try {
    const { data, error } = await client.from('_analytics').select('*').limit(5);
    console.log('Direct _analytics:', error?.message || data);
  } catch (e) {
    console.log('Direct _analytics error:', e.message);
  }
}

main();
