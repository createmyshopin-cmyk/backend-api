import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Supabase credentials missing in env');
    process.exit(1);
  }

  const client = createClient(url, key);
  console.log('Applying database consistency repairs...');

  // 1. Missing payment coin transactions (recharge)
  const paymentsToInsert = [
    {
      user_id: '4f002dca-2813-4c26-8ed2-e02669d55e42',
      type: 'recharge',
      amount: 110,
      balance_before: 1000,
      balance_after: 1110,
      reference_id: 'e1eff294-c9dd-4ef5-9527-63246ade65a5',
      description: 'Recovery recharge from audit',
    },
    {
      user_id: '8df40697-59fd-4b7c-a709-b1389f1a89e3',
      type: 'recharge',
      amount: 550,
      balance_before: 500,
      balance_after: 1050,
      reference_id: '9bbc9dae-b748-4639-bc3a-efd4c9997cf1',
      description: 'Recovery recharge from audit',
    },
    {
      user_id: '8df40697-59fd-4b7c-a709-b1389f1a89e3',
      type: 'recharge',
      amount: 100,
      balance_before: 500,
      balance_after: 600,
      reference_id: 'd0f82f55-cf03-4c10-a844-7e4f096a9253',
      description: 'Recovery recharge from audit',
    },
    {
      user_id: '8df40697-59fd-4b7c-a709-b1389f1a89e3',
      type: 'recharge',
      amount: 550,
      balance_before: 500,
      balance_after: 1050,
      reference_id: '689314da-c2a5-4c12-a595-800462b1fbc9',
      description: 'Recovery recharge from audit',
    },
    {
      user_id: '8df40697-59fd-4b7c-a709-b1389f1a89e3',
      type: 'recharge',
      amount: 100,
      balance_before: 500,
      balance_after: 600,
      reference_id: '3e460631-e562-4bd6-9e9d-024c970bea1d',
      description: 'Recovery recharge from audit',
    },
  ];

  for (const item of paymentsToInsert) {
    console.log(`Inserting payment coin transaction for user ${item.user_id}, reference ${item.reference_id}...`);
    const { error } = await client.from('coin_transactions').insert(item);
    if (error) {
      console.error('Error inserting coin transaction:', error.message);
    }
  }

  // 2. Missing call deduction coin transactions
  const callsToInsert = [
    {
      user_id: '8df40697-59fd-4b7c-a709-b1389f1a89e3',
      type: 'call_deduction',
      amount: -30,
      balance_before: 500,
      balance_after: 470,
      reference_id: '67d7721b-56cf-4688-91db-b53c4466886f',
      description: 'Recovery call charge from audit',
    },
    {
      user_id: '8df40697-59fd-4b7c-a709-b1389f1a89e3',
      type: 'call_deduction',
      amount: -30,
      balance_before: 500,
      balance_after: 470,
      reference_id: '10601096-890d-42dc-88cc-1f4b2792e480',
      description: 'Recovery call charge from audit',
    },
  ];

  for (const item of callsToInsert) {
    console.log(`Inserting call deduction transaction for user ${item.user_id}, reference ${item.reference_id}...`);
    const { error } = await client.from('coin_transactions').insert(item);
    if (error) {
      console.error('Error inserting call deduction:', error.message);
    }
  }

  // 3. Missing withdrawal creator transactions
  const withdrawalsToInsert = [
    {
      creator_id: '8df40697-59fd-4b7c-a709-b1389f1a89e3',
      type: 'withdrawal',
      amount: 150,
      balance_before: -230,
      balance_after: -380,
      reference_id: 'db494c21-c19f-4cde-9fc7-663ee524ebe2',
    },
    {
      creator_id: '8df40697-59fd-4b7c-a709-b1389f1a89e3',
      type: 'withdrawal',
      amount: 150,
      balance_before: -230,
      balance_after: -380,
      reference_id: '968ddc25-9370-4070-8677-0666ca82453f',
    },
  ];

  for (const item of withdrawalsToInsert) {
    console.log(`Inserting withdrawal transaction for creator ${item.creator_id}, reference ${item.reference_id}...`);
    const { error } = await client.from('creator_transactions').insert(item);
    if (error) {
      console.error('Error inserting creator transaction:', error.message);
    }
  }

  console.log('Repairs applied successfully!');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
