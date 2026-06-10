import type { AnalyticsMetrics, ChartDayPoint } from './creator-dashboard.types';

const TZ = 'Asia/Kolkata';

export function istBucketDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
}

export function istRangeBounds(fromDate: string, toDate: string): { from: string; to: string } {
  return {
    from: `${fromDate}T00:00:00+05:30`,
    to: `${toDate}T23:59:59.999+05:30`,
  };
}

export function isEmptyAnalyticsMetrics(m: AnalyticsMetrics): boolean {
  return (
    m.totalEarnings === 0 &&
    m.callEarnings === 0 &&
    m.giftEarnings === 0 &&
    m.callCount === 0 &&
    m.giftCount === 0 &&
    m.talkMinutes === 0
  );
}

interface GiftRow {
  creator_coins?: number | string | null;
  created_at?: string | null;
}

interface CallRow {
  duration_seconds?: number | string | null;
  billable_duration_seconds?: number | string | null;
  started_at?: string | null;
  creator_earnings?:
    | { creator_share?: number | string | null }
    | Array<{ creator_share?: number | string | null }>
    | null;
}

export function aggregateLiveAnalytics(
  gifts: GiftRow[],
  calls: CallRow[],
  fromDate: string,
  toDate: string,
): { metrics: AnalyticsMetrics; chart: ChartDayPoint[] } {
  const daily = new Map<
    string,
    {
      callCoins: number;
      giftCoins: number;
      callCount: number;
      giftCount: number;
      durationSeconds: number;
    }
  >();

  const ensureDay = (date: string) => {
    if (!daily.has(date)) {
      daily.set(date, {
        callCoins: 0,
        giftCoins: 0,
        callCount: 0,
        giftCount: 0,
        durationSeconds: 0,
      });
    }
    return daily.get(date)!;
  };

  let callCoins = 0;
  let giftCoins = 0;
  let callCount = 0;
  let giftCount = 0;
  let durationSeconds = 0;

  for (const row of gifts) {
    const createdAt = row.created_at;
    if (!createdAt) continue;
    const bucket = istBucketDate(createdAt);
    if (bucket < fromDate || bucket > toDate) continue;

    const coins = Number(row.creator_coins ?? 0);
    giftCoins += coins;
    giftCount += 1;

    const day = ensureDay(bucket);
    day.giftCoins += coins;
    day.giftCount += 1;
  }

  for (const row of calls) {
    const startedAt = row.started_at;
    if (!startedAt) continue;
    const bucket = istBucketDate(startedAt);
    if (bucket < fromDate || bucket > toDate) continue;

    const earningsArr = row.creator_earnings;
    const earning = Array.isArray(earningsArr) ? earningsArr[0] : earningsArr;
    const share = Number(earning?.creator_share ?? 0);
    const duration = Number(row.billable_duration_seconds ?? row.duration_seconds ?? 0);

    callCoins += share;
    callCount += 1;
    durationSeconds += duration;

    const day = ensureDay(bucket);
    day.callCoins += share;
    day.callCount += 1;
    day.durationSeconds += duration;
  }

  const chart: ChartDayPoint[] = [...daily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      totalEarnings: d.callCoins + d.giftCoins,
      callEarnings: d.callCoins,
      giftEarnings: d.giftCoins,
      callCount: d.callCount,
      giftCount: d.giftCount,
    }));

  return {
    metrics: {
      totalEarnings: callCoins + giftCoins,
      callEarnings: callCoins,
      giftEarnings: giftCoins,
      callCount,
      giftCount,
      talkMinutes: Math.floor(durationSeconds / 60),
    },
    chart,
  };
}
