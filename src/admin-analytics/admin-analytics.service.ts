import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
} from '../creator-dashboard/pagination.util';
import type { TimeWindow } from './dto/analytics-query.dto';

export interface CreatorRankItem {
  creatorProfileId: string;
  creatorId: string;
  creatorName: string;
  metric: number;
  secondaryMetric?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly supabase: SupabaseService) {}

  private client() {
    if (!this.supabase.isConfigured) {
      throw new BadRequestException('Database unavailable');
    }
    return this.supabase.getClient();
  }

  private windowDates(window: TimeWindow): { from: string | null; to: string } {
    const to = new Date().toISOString().slice(0, 10);
    if (window === 'lifetime') return { from: null, to };
    const days = window === '30d' ? 30 : 7;
    const fromDate = new Date();
    fromDate.setUTCDate(fromDate.getUTCDate() - days);
    return { from: fromDate.toISOString().slice(0, 10), to };
  }

  async getCreatorsOverview(window: TimeWindow = '7d') {
    const { from, to } = this.windowDates(window);
    const db = this.client();

    const [profilesRes, onlineRes, analyticsRes] = await Promise.all([
      db.from('creator_profiles').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
      db.from('creator_profiles').select('id', { count: 'exact', head: true }).eq('online_status', 'online'),
      from
        ? db.from('creator_analytics_daily').select('call_coins, gift_coins, call_count, gifts_received_count')
            .gte('date', from).lte('date', to)
        : db.from('creator_analytics_daily').select('call_coins, gift_coins, call_count, gifts_received_count'),
    ]);

    const rows = analyticsRes.data ?? [];
    const totalEarnings = rows.reduce((s, r) => s + Number(r.call_coins ?? 0) + Number(r.gift_coins ?? 0), 0);
    const totalCalls = rows.reduce((s, r) => s + Number(r.call_count ?? 0), 0);
    const totalGifts = rows.reduce((s, r) => s + Number(r.gifts_received_count ?? 0), 0);

    return {
      window,
      totalCreators: profilesRes.count ?? 0,
      onlineCreators: onlineRes.count ?? 0,
      totalEarnings,
      totalCalls,
      totalGifts,
      from,
      to,
    };
  }

  async getTopEarners(window: TimeWindow = '7d', limit = 20, cursor?: string): Promise<PaginatedResult<CreatorRankItem>> {
    const { from, to } = this.windowDates(window);
    const clamped = clampLimit(limit);
    const db = this.client();

    let query = db.from('creator_analytics_daily')
      .select('creator_profile_id, call_coins, gift_coins, date');

    if (from) query = query.gte('date', from);
    query = query.lte('date', to);

    const { data: dailyRows, error } = await query;
    if (error) throw new BadRequestException(error.message);

    const agg = new Map<string, number>();
    for (const row of dailyRows ?? []) {
      const id = String(row.creator_profile_id);
      const earnings = Number(row.call_coins ?? 0) + Number(row.gift_coins ?? 0);
      agg.set(id, (agg.get(id) ?? 0) + earnings);
    }

    const sorted = [...agg.entries()]
      .map(([creatorProfileId, metric]) => ({ creatorProfileId, metric }))
      .sort((a, b) => b.metric - a.metric);

    return this.paginateRanked(sorted, clamped, cursor, 'metric');
  }

  async getTopGifts(window: TimeWindow = '7d', limit = 20, cursor?: string): Promise<PaginatedResult<CreatorRankItem>> {
    const { from, to } = this.windowDates(window);
    const clamped = clampLimit(limit);
    const db = this.client();

    let query = db.from('creator_analytics_daily')
      .select('creator_profile_id, gifts_received_count, gift_coins, date');
    if (from) query = query.gte('date', from);
    query = query.lte('date', to);

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);

    const countAgg = new Map<string, { count: number; coins: number }>();
    for (const row of data ?? []) {
      const id = String(row.creator_profile_id);
      const prev = countAgg.get(id) ?? { count: 0, coins: 0 };
      countAgg.set(id, {
        count: prev.count + Number(row.gifts_received_count ?? 0),
        coins: prev.coins + Number(row.gift_coins ?? 0),
      });
    }

    const sorted = [...countAgg.entries()]
      .map(([creatorProfileId, v]) => ({ creatorProfileId, metric: v.count, secondaryMetric: v.coins }))
      .sort((a, b) => b.metric - a.metric);

    return this.paginateRanked(sorted, clamped, cursor, 'metric');
  }

  async getTopCalls(window: TimeWindow = '7d', limit = 20, cursor?: string): Promise<PaginatedResult<CreatorRankItem>> {
    const { from, to } = this.windowDates(window);
    const clamped = clampLimit(limit);
    const db = this.client();

    let query = db.from('creator_analytics_daily')
      .select('creator_profile_id, call_count, call_duration_seconds, date');
    if (from) query = query.gte('date', from);
    query = query.lte('date', to);

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);

    const agg = new Map<string, { calls: number; seconds: number }>();
    for (const row of data ?? []) {
      const id = String(row.creator_profile_id);
      const prev = agg.get(id) ?? { calls: 0, seconds: 0 };
      agg.set(id, {
        calls: prev.calls + Number(row.call_count ?? 0),
        seconds: prev.seconds + Number(row.call_duration_seconds ?? 0),
      });
    }

    const sorted = [...agg.entries()]
      .map(([creatorProfileId, v]) => ({
        creatorProfileId,
        metric: v.calls,
        secondaryMetric: Math.round(v.seconds / 60),
      }))
      .sort((a, b) => b.metric - a.metric);

    return this.paginateRanked(sorted, clamped, cursor, 'metric');
  }

  async getTopMessages(window: TimeWindow = '7d', limit = 20, cursor?: string): Promise<PaginatedResult<CreatorRankItem>> {
    const { from } = this.windowDates(window);
    const clamped = clampLimit(limit);
    const db = this.client();

    let query = db.from('paid_messages')
      .select('creator_id, coins_charged, created_at')
      .order('created_at', { ascending: false })
      .limit(5000);

    if (from) {
      query = query.gte('created_at', `${from}T00:00:00.000Z`);
    }

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);

    const agg = new Map<string, { revenue: number; count: number }>();
    for (const row of data ?? []) {
      const id = String(row.creator_id);
      const prev = agg.get(id) ?? { revenue: 0, count: 0 };
      agg.set(id, {
        revenue: prev.revenue + Number(row.coins_charged ?? 0),
        count: prev.count + 1,
      });
    }

    const sorted = [...agg.entries()]
      .map(([creatorProfileId, v]) => ({
        creatorProfileId,
        metric: v.revenue,
        secondaryMetric: v.count,
      }))
      .sort((a, b) => b.metric - a.metric);

    return this.paginateRanked(sorted, clamped, cursor, 'metric');
  }

  async getOnlineCreators(limit = 20, cursor?: string): Promise<PaginatedResult<CreatorRankItem>> {
    const clamped = clampLimit(limit);
    const db = this.client();

    let query = db.from('creator_profiles')
      .select('id, user_id, display_name, last_seen_at, online_status')
      .eq('status', 'approved')
      .eq('online_status', 'online')
      .order('last_seen_at', { ascending: false })
      .limit(clamped + 1);

    if (cursor) {
      const { t, id } = decodeCursor(cursor);
      query = query.or(`last_seen_at.lt.${t},and(last_seen_at.eq.${t},id.lt.${id})`);
    }

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);

    const rows = data ?? [];
    const hasMore = rows.length > clamped;
    const slice = hasMore ? rows.slice(0, clamped) : rows;
    const last = slice[slice.length - 1];

    const items: CreatorRankItem[] = slice.map((r) => ({
      creatorProfileId: r.id,
      creatorId: r.user_id,
      creatorName: r.display_name ?? 'Creator',
      metric: 1,
    }));

    return {
      items,
      hasMore,
      nextCursor: hasMore && last
        ? encodeCursor(String(last.last_seen_at ?? new Date().toISOString()), String(last.id))
        : null,
    };
  }

  async getNewCreators(window: '7d' | '30d' = '7d', limit = 20, cursor?: string): Promise<PaginatedResult<CreatorRankItem>> {
    const days = window === '30d' ? 30 : 7;
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    const clamped = clampLimit(limit);
    const db = this.client();

    let query = db.from('creator_profiles')
      .select('id, user_id, display_name, approved_at, created_at')
      .eq('status', 'approved')
      .gte('approved_at', since.toISOString())
      .order('approved_at', { ascending: false })
      .limit(clamped + 1);

    if (cursor) {
      const { t, id } = decodeCursor(cursor);
      query = query.or(`approved_at.lt.${t},and(approved_at.eq.${t},id.lt.${id})`);
    }

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);

    const rows = data ?? [];
    const hasMore = rows.length > clamped;
    const slice = hasMore ? rows.slice(0, clamped) : rows;
    const last = slice[slice.length - 1];

    return {
      items: slice.map((r) => ({
        creatorProfileId: r.id,
        creatorId: r.user_id,
        creatorName: r.display_name ?? 'Creator',
        metric: 0,
      })),
      hasMore,
      nextCursor: hasMore && last
        ? encodeCursor(String(last.approved_at ?? last.created_at), String(last.id))
        : null,
    };
  }

  async getInactiveCreators(days = 30, limit = 20, cursor?: string): Promise<PaginatedResult<CreatorRankItem>> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    const clamped = clampLimit(limit);
    const db = this.client();

    let query = db.from('creator_profiles')
      .select('id, user_id, display_name, last_seen_at')
      .eq('status', 'approved')
      .or(`last_seen_at.is.null,last_seen_at.lt.${cutoff.toISOString()}`)
      .order('last_seen_at', { ascending: true, nullsFirst: true })
      .limit(clamped + 1);

    if (cursor) {
      const { t, id } = decodeCursor(cursor);
      query = query.or(`last_seen_at.gt.${t},and(last_seen_at.eq.${t},id.gt.${id})`);
    }

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);

    const rows = data ?? [];
    const hasMore = rows.length > clamped;
    const slice = hasMore ? rows.slice(0, clamped) : rows;
    const last = slice[slice.length - 1];

    return {
      items: slice.map((r) => ({
        creatorProfileId: r.id,
        creatorId: r.user_id,
        creatorName: r.display_name ?? 'Creator',
        metric: days,
      })),
      hasMore,
      nextCursor: hasMore && last
        ? encodeCursor(String(last.last_seen_at ?? '1970-01-01'), String(last.id))
        : null,
    };
  }

  private async paginateRanked(
    sorted: { creatorProfileId: string; metric: number; secondaryMetric?: number }[],
    limit: number,
    cursor: string | undefined,
    sortKey: string,
  ): Promise<PaginatedResult<CreatorRankItem>> {
    let startIdx = 0;
    if (cursor) {
      const { id } = decodeCursor(cursor);
      const idx = sorted.findIndex((s) => s.creatorProfileId === id);
      startIdx = idx >= 0 ? idx + 1 : 0;
    }

    const page = sorted.slice(startIdx, startIdx + limit + 1);
    const hasMore = page.length > limit;
    const slice = hasMore ? page.slice(0, limit) : page;

    const profileIds = slice.map((s) => s.creatorProfileId);
    const names = await this.resolveCreatorNames(profileIds);

    const last = slice[slice.length - 1];
    return {
      items: slice.map((s) => ({
        creatorProfileId: s.creatorProfileId,
        creatorId: names.get(s.creatorProfileId)?.userId ?? s.creatorProfileId,
        creatorName: names.get(s.creatorProfileId)?.name ?? 'Creator',
        metric: s.metric,
        secondaryMetric: s.secondaryMetric,
      })),
      hasMore,
      nextCursor: hasMore && last
        ? encodeCursor(String(last[sortKey as keyof typeof last] ?? 0), last.creatorProfileId)
        : null,
    };
  }

  private async resolveCreatorNames(profileIds: string[]): Promise<Map<string, { name: string; userId: string }>> {
    const map = new Map<string, { name: string; userId: string }>();
    if (!profileIds.length) return map;

    const { data } = await this.client()
      .from('creator_profiles')
      .select('id, user_id, display_name')
      .in('id', profileIds);

    for (const row of data ?? []) {
      map.set(row.id, { name: row.display_name ?? 'Creator', userId: row.user_id });
    }
    return map;
  }
}
