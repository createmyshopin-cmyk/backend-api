import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const client = createClient(url, key);

  console.log('Querying creator_profiles for user ID 8df40697-59fd-4b7c-a709-b1389f1a89e3...');
  const { data, error } = await client
    .from('creator_profiles')
    .select('id, user_id, bio')
    .eq('user_id', '8df40697-59fd-4b7c-a709-b1389f1a89e3')
    .single();

  if (error) {
    console.error('Error fetching creator profile:', error.message);
  } else {
    console.log('Found profile:', data);
  }
}

main();
