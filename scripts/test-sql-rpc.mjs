import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const client = createClient(url, key);

  const sql = 'SELECT 1 as val;';
  
  const candidates = ['exec_sql', 'run_sql', 'sql', 'query', 'execute', 'exec'];
  
  for (const fn of candidates) {
    try {
      console.log(`Trying RPC: ${fn}...`);
      const { data, error } = await client.rpc(fn, { query: sql, sql_query: sql, sql: sql });
      if (!error) {
        console.log(`Success with RPC ${fn}:`, data);
        return;
      }
      console.log(`RPC ${fn} returned error:`, error.message);
    } catch (e) {
      console.log(`RPC ${fn} threw exception:`, e.message);
    }
  }
  
  console.log('No SQL execution RPC found.');
}

main();
