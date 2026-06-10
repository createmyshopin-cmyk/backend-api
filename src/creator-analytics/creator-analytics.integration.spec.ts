/**
 * Integration tests — run with RUN_INTEGRATION_TESTS=1 and live Supabase credentials.
 */
import { CreatorAnalyticsRpcService } from './creator-analytics-rpc.service';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === '1';

(runIntegration ? describe : describe.skip)('CreatorAnalyticsRpcService integration', () => {
  let service: CreatorAnalyticsRpcService;

  beforeAll(() => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    }

    const { createClient } = require('@supabase/supabase-js');
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    service = new CreatorAnalyticsRpcService({
      isConfigured: true,
      getClient: () => client,
    } as never);
  });

  it('rebuild_creator_analytics_daily is idempotent', async () => {
    const first = await service.rebuildCreatorAnalyticsDaily();
    const second = await service.rebuildCreatorAnalyticsDaily();

    expect(first.rowsUpserted).toBeGreaterThanOrEqual(0);
    expect(second.rowsUpserted).toBe(first.rowsUpserted);
    expect(second.timezone).toBe('Asia/Kolkata');
  }, 120_000);
});
