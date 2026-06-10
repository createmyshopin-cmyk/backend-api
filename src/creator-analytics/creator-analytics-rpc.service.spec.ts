import { CreatorAnalyticsRpcService } from './creator-analytics-rpc.service';

describe('CreatorAnalyticsRpcService', () => {
  const rpc = jest.fn();
  const supabase = {
    isConfigured: true,
    getClient: () => ({ rpc }),
  };

  const service = new CreatorAnalyticsRpcService(supabase as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rebuildCreatorAnalyticsDaily', () => {
    it('maps full rebuild RPC response', async () => {
      rpc.mockResolvedValue({
        data: {
          creator_profile_id: null,
          from_date: null,
          to_date: null,
          rows_deleted: 12,
          rows_upserted: 12,
          timezone: 'Asia/Kolkata',
        },
        error: null,
      });

      const result = await service.rebuildCreatorAnalyticsDaily();

      expect(rpc).toHaveBeenCalledWith('rebuild_creator_analytics_daily', {
        p_creator_profile_id: null,
        p_from_date: null,
        p_to_date: null,
      });
      expect(result).toEqual({
        creatorProfileId: null,
        fromDate: null,
        toDate: null,
        rowsDeleted: 12,
        rowsUpserted: 12,
        timezone: 'Asia/Kolkata',
      });
    });

    it('passes creator-specific and date range params', async () => {
      rpc.mockResolvedValue({
        data: {
          creator_profile_id: 'profile-1',
          from_date: '2026-06-01',
          to_date: '2026-06-10',
          rows_deleted: 3,
          rows_upserted: 3,
          timezone: 'Asia/Kolkata',
        },
        error: null,
      });

      await service.rebuildCreatorAnalyticsDaily({
        creatorProfileId: 'profile-1',
        fromDate: '2026-06-01',
        toDate: '2026-06-10',
      });

      expect(rpc).toHaveBeenCalledWith('rebuild_creator_analytics_daily', {
        p_creator_profile_id: 'profile-1',
        p_from_date: '2026-06-01',
        p_to_date: '2026-06-10',
      });
    });

    it('throws when RPC fails', async () => {
      rpc.mockResolvedValue({ data: null, error: { message: 'rebuild_failed' } });

      await expect(service.rebuildCreatorAnalyticsDaily()).rejects.toThrow('rebuild_failed');
    });

    it('throws when supabase is not configured', async () => {
      const offline = new CreatorAnalyticsRpcService({ isConfigured: false } as never);
      await expect(offline.rebuildCreatorAnalyticsDaily()).rejects.toThrow('supabase_not_configured');
    });
  });

  describe('getCreatorAnalyticsWindow', () => {
    it('maps window summary and daily series', async () => {
      rpc.mockResolvedValue({
        data: {
          creator_profile_id: 'profile-1',
          from_date: '2026-06-04',
          to_date: '2026-06-10',
          call_coins: 620,
          gift_coins: 270,
          total_coins: 890,
          call_count: 18,
          call_duration_seconds: 18720,
          gifts_received_count: 9,
          daily_series: [
            {
              date: '2026-06-04',
              call_coins: 70,
              gift_coins: 25,
              total_coins: 95,
              call_count: 2,
              gifts_received_count: 1,
            },
          ],
        },
        error: null,
      });

      const result = await service.getCreatorAnalyticsWindow('profile-1', '2026-06-04', '2026-06-10');

      expect(result.totalCoins).toBe(890);
      expect(result.dailySeries).toHaveLength(1);
      expect(result.dailySeries[0].totalCoins).toBe(95);
    });

    it('defaults empty daily series', async () => {
      rpc.mockResolvedValue({
        data: {
          creator_profile_id: 'profile-1',
          from_date: '2026-06-10',
          to_date: '2026-06-10',
          call_coins: 0,
          gift_coins: 0,
          total_coins: 0,
          call_count: 0,
          call_duration_seconds: 0,
          gifts_received_count: 0,
        },
        error: null,
      });

      const result = await service.getCreatorAnalyticsWindow('profile-1', '2026-06-10');
      expect(result.dailySeries).toEqual([]);
    });
  });
});
