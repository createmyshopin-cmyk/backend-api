import { aggregateLiveAnalytics, istBucketDate } from './creator-analytics-live.util';

describe('creator-analytics-live.util', () => {
  it('buckets IST dates for gift and call rows', () => {
    const result = aggregateLiveAnalytics(
      [{ creator_coins: 100, created_at: '2026-06-10T10:00:00.000Z' }],
      [
        {
          started_at: '2026-06-10T11:00:00.000Z',
          duration_seconds: 120,
          creator_earnings: { creator_share: 14 },
        },
      ],
      '2026-06-10',
      '2026-06-10',
    );

    expect(result.metrics.giftEarnings).toBe(100);
    expect(result.metrics.callEarnings).toBe(14);
    expect(result.metrics.totalEarnings).toBe(114);
    expect(result.metrics.callCount).toBe(1);
    expect(result.metrics.giftCount).toBe(1);
    expect(result.metrics.talkMinutes).toBe(2);
    expect(result.chart).toHaveLength(1);
  });

  it('excludes rows outside the requested window', () => {
    const result = aggregateLiveAnalytics(
      [{ creator_coins: 50, created_at: '2026-06-01T10:00:00.000Z' }],
      [],
      '2026-06-10',
      '2026-06-10',
    );

    expect(result.metrics.giftCount).toBe(0);
    expect(result.metrics.giftEarnings).toBe(0);
  });

  it('formats bucket dates in Asia/Kolkata', () => {
    expect(istBucketDate('2026-06-10T20:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
