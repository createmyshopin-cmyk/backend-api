import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const client = createClient(url, key);

  console.log('Querying info schema with try-catch...');
  try {
    const { data: cols, error: colsErr } = await client
      .from('information_schema.columns')
      .select('table_name, column_name, data_type')
      .eq('table_name', 'creator_wallets');
      
    if (colsErr) {
      console.log('Columns error returned from Supabase:', colsErr.message);
    } else {
      console.log('Columns data:', cols);
    }
  } catch (e) {
    console.log('Exception occurred:', e.message);
  }
}

main();
