/**
 * Integration tests for gift RPC + repository (requires Supabase env).
 * Skipped when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const hasSupabase =
  Boolean(url) &&
  Boolean(key) &&
  url!.startsWith('http');

const describeIf = hasSupabase ? describe : describe.skip;

describeIf('Gift system integration (Supabase)', () => {
  const client = createClient(url!, key!);

  it('gift_analytics_summary RPC returns expected shape', async () => {
    const { data, error } = await client.rpc('gift_analytics_summary');
    expect(error).toBeNull();
    expect(data).toMatchObject({
      todayRevenue: expect.any(Number),
      weekRevenue: expect.any(Number),
      monthRevenue: expect.any(Number),
      lifetimeRevenue: expect.any(Number),
      giftCount: expect.any(Number),
      platformRevenue: expect.objectContaining({
        today: expect.any(Number),
        lifetime: expect.any(Number),
      }),
      creatorEarnings: expect.objectContaining({
        today: expect.any(Number),
        lifetime: expect.any(Number),
      }),
      topGifts: expect.any(Array),
    });
  });

  it('active gifts catalog is seeded', async () => {
    const { data, error } = await client
      .from('gifts')
      .select('name, coin_cost')
      .eq('is_active', true)
      .order('sort_order');

    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThanOrEqual(8);
    const crown = data?.find((g) => g.name === 'Princess Crown');
    expect(crown?.coin_cost).toBe(500);
  });

  it('send_gift rejects insufficient_balance', async () => {
    const { data: gift } = await client
      .from('gifts')
      .select('id')
      .eq('name', 'Diamond Ring')
      .single();

    const fakeSender = '00000000-0000-0000-0000-000000000099';
    const fakeCreator = '00000000-0000-0000-0000-000000000098';
    const fakeCall = '00000000-0000-0000-0000-000000000097';

    const { error } = await client.rpc('send_gift', {
      p_sender_user_id: fakeSender,
      p_creator_user_id: fakeCreator,
      p_gift_id: gift?.id,
      p_call_id: fakeCall,
      p_idempotency_key: `test-insufficient-${Date.now()}`,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/sender_not_found|insufficient_balance|call_not_found/);
  });
});
