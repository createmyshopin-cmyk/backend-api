import { BadRequestException } from '@nestjs/common';
import { AdminAnalyticsService } from './admin-analytics.service';

describe('AdminAnalyticsService', () => {
  const mockClient = {
    from: jest.fn(),
  };

  const supabase = {
    isConfigured: true,
    getClient: () => mockClient,
  } as any;

  let service: AdminAnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminAnalyticsService(supabase);
  });

  it('throws when database unavailable', async () => {
    const offline = new AdminAnalyticsService({ isConfigured: false } as any);
    await expect(offline.getCreatorsOverview('7d')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aggregates overview metrics', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
    };
    mockClient.from.mockImplementation((table: string) => {
      if (table === 'creator_profiles') {
        return {
          ...chain,
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ count: table === 'creator_profiles' ? 10 : 3, data: null, error: null }),
            }),
          }),
        };
      }
      if (table === 'creator_analytics_daily') {
        return {
          ...chain,
          gte: jest.fn().mockReturnValue({
            lte: jest.fn().mockResolvedValue({
              data: [
                { call_coins: 100, gift_coins: 50, call_count: 2, gifts_received_count: 1 },
              ],
              error: null,
            }),
          }),
          lte: jest.fn().mockResolvedValue({
            data: [{ call_coins: 100, gift_coins: 50, call_count: 2, gifts_received_count: 1 }],
            error: null,
          }),
        };
      }
      return chain;
    });

    const result = await service.getCreatorsOverview('7d');
    expect(result.totalEarnings).toBe(150);
    expect(result.totalCalls).toBe(2);
    expect(result.totalGifts).toBe(1);
  });
});
