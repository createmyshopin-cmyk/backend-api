import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { clampLimit, decodeCursor, encodeCursor } from '../creator-dashboard/pagination.util';

@Injectable()
export class AdminEngagementService {
  constructor(private readonly supabase: SupabaseService) {}

  private client() {
    if (!this.supabase.isConfigured) {
      throw new BadRequestException('Database unavailable');
    }
    return this.supabase.getClient();
  }

  async getMissionsOverview() {
    const db = this.client();
    const today = new Date().toISOString().slice(0, 10);

    const [progressRes, rewardsRes, topRes] = await Promise.all([
      db.from('mission_progress')
        .select('id', { count: 'exact', head: true })
        .eq('mission_date', today)
        .eq('completed', true),
      db.from('engagement_reward_events')
        .select('coins_awarded')
        .eq('source', 'mission'),
      db.from('engagement_reward_events')
        .select('user_id, coins_awarded')
        .eq('source', 'mission')
        .order('coins_awarded', { ascending: false })
        .limit(10),
    ]);

    const totalCoins = (rewardsRes.data ?? []).reduce((s, r) => s + Number(r.coins_awarded ?? 0), 0);
    const topUsers = await this.resolveUserNames(
      (topRes.data ?? []).map((r) => ({ userId: r.user_id, metric: Number(r.coins_awarded ?? 0) })),
    );

    return {
      claimsToday: progressRes.count ?? 0,
      totalRewardCoins: totalCoins,
      topMissionUsers: topUsers,
    };
  }

  async getStreaksOverview() {
    const db = this.client();

    const [activeRes, longestRes, rewardsRes] = await Promise.all([
      db.from('user_streaks').select('id', { count: 'exact', head: true }).gt('current_streak', 0),
      db.from('user_streaks')
        .select('user_id, current_streak, longest_streak')
        .order('longest_streak', { ascending: false })
        .limit(10),
      db.from('engagement_reward_events')
        .select('coins_awarded')
        .eq('source', 'streak'),
    ]);

    const topStreaks = await this.resolveUserNames(
      (longestRes.data ?? []).map((r) => ({
        userId: r.user_id,
        metric: Number(r.longest_streak ?? 0),
        secondaryMetric: Number(r.current_streak ?? 0),
      })),
    );

    const streakCoins = (rewardsRes.data ?? []).reduce((s, r) => s + Number(r.coins_awarded ?? 0), 0);

    return {
      activeStreaks: activeRes.count ?? 0,
      streakRewardCoins: streakCoins,
      longestStreaks: topStreaks,
    };
  }

  async getFollowsLeaderboard(
    type: 'follows' | 'favorites' = 'follows',
    limit = 20,
    cursor?: string,
  ) {
    const clamped = clampLimit(limit);
    const db = this.client();
    const table = type === 'favorites' ? 'favorites' : 'follows';
    const creatorCol = type === 'favorites' ? 'creator_id' : 'creator_profile_id';
    const activeFilter = type === 'favorites' ? 'unfavorited_at' : 'unfollowed_at';

    const { data, error } = await db
      .from(table)
      .select(creatorCol)
      .is(activeFilter, null);

    if (error) throw new BadRequestException(error.message);

    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const id = String(row[creatorCol]);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    let startIdx = 0;
    if (cursor) {
      const { id } = decodeCursor(cursor);
      const idx = sorted.findIndex(([profileId]) => profileId === id);
      startIdx = idx >= 0 ? idx + 1 : 0;
    }

    const page = sorted.slice(startIdx, startIdx + clamped + 1);
    const hasMore = page.length > clamped;
    const slice = hasMore ? page.slice(0, clamped) : page;
    const last = slice[slice.length - 1];

    const names = await this.resolveCreatorNames(slice.map(([id]) => id));

    return {
      type,
      items: slice.map(([creatorProfileId, count]) => ({
        creatorProfileId,
        creatorName: names.get(creatorProfileId) ?? 'Creator',
        count,
      })),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor(String(last[1]), last[0])
          : null,
    };
  }

  async getLevelsDistribution() {
    const db = this.client();

    const [creatorLevels, topXp] = await Promise.all([
      db.from('creator_levels').select('level'),
      db.from('creator_levels')
        .select('creator_profile_id, total_xp, level')
        .order('total_xp', { ascending: false })
        .limit(20),
    ]);

    const distribution: Record<number, number> = {};
    for (const row of creatorLevels.data ?? []) {
      const lvl = Number(row.level ?? 1);
      distribution[lvl] = (distribution[lvl] ?? 0) + 1;
    }

    const names = await this.resolveCreatorNames(
      (topXp.data ?? []).map((r) => r.creator_profile_id),
    );

    return {
      distribution: Object.entries(distribution).map(([level, count]) => ({
        level: Number(level),
        count,
      })),
      topXpCreators: (topXp.data ?? []).map((r) => ({
        creatorProfileId: r.creator_profile_id,
        creatorName: names.get(r.creator_profile_id) ?? 'Creator',
        totalXp: Number(r.total_xp ?? 0),
        level: Number(r.level ?? 1),
      })),
    };
  }

  async getVipOverview() {
    const db = this.client();

    const [plansRes, activeRes, expiringRes, historyRes] = await Promise.all([
      db.from('vip_plans').select('*').eq('is_active', true),
      db.from('user_memberships').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db.from('user_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .lte('expires_at', new Date(Date.now() + 7 * 86400000).toISOString()),
      db.from('membership_events')
        .select('coins_charged, event_type')
        .in('event_type', ['subscribed', 'renewed']),
    ]);

    const revenue = (historyRes.data ?? []).reduce((s, r) => s + Number(r.coins_charged ?? 0), 0);

    return {
      plans: plansRes.data ?? [],
      activeSubscriptions: activeRes.count ?? 0,
      expiringWithin7Days: expiringRes.count ?? 0,
      totalRevenue: revenue,
    };
  }

  async getMessagesOverview() {
    const db = this.client();
    const since30d = new Date();
    since30d.setUTCDate(since30d.getUTCDate() - 30);

    const [messagesRes, sessionsRes, topCreatorsRes, topUsersRes] = await Promise.all([
      db.from('paid_messages')
        .select('coins_charged, message_type, created_at')
        .gte('created_at', since30d.toISOString()),
      db.from('conversation_summaries').select('id', { count: 'exact', head: true }),
      db.from('paid_messages')
        .select('creator_id, coins_charged')
        .gte('created_at', since30d.toISOString()),
      db.from('paid_messages')
        .select('sender_id, coins_charged')
        .gte('created_at', since30d.toISOString()),
    ]);

    const rows = messagesRes.data ?? [];
    const revenue = rows.reduce((s, r) => s + Number(r.coins_charged ?? 0), 0);
    const voiceCount = rows.filter((r) => r.message_type === 'voice').length;
    const textCount = rows.length - voiceCount;

    const creatorAgg = this.aggregateByField(topCreatorsRes.data ?? [], 'creator_id');
    const userAgg = this.aggregateByField(topUsersRes.data ?? [], 'sender_id');

    const creatorNames = await this.resolveCreatorNames(Object.keys(creatorAgg));
    const userNames = await this.resolveUserNames(
      Object.entries(userAgg).map(([userId, metric]) => ({ userId, metric })),
    );

    return {
      revenue30d: revenue,
      totalConversations: sessionsRes.count ?? 0,
      voiceMessages: voiceCount,
      textMessages: textCount,
      topCreators: Object.entries(creatorAgg)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([id, metric]) => ({
          creatorProfileId: id,
          creatorName: creatorNames.get(id) ?? 'Creator',
          revenue: metric,
        })),
      topUsers: userNames.slice(0, 10),
    };
  }

  async getCombosOverview() {
    const db = this.client();

    const [combosRes, claimsRes, premiumRes] = await Promise.all([
      db.from('gift_combos').select('id', { count: 'exact', head: true }),
      db.from('gift_combo_reward_claims').select('id', { count: 'exact', head: true }),
      db.from('premium_gifts').select('id', { count: 'exact', head: true }).eq('is_active', true),
    ]);

    const { data: topSenders } = await db
      .from('gift_transactions')
      .select('sender_id, coins_spent')
      .order('created_at', { ascending: false })
      .limit(1000);

    const senderAgg = this.aggregateByField(topSenders ?? [], 'sender_id', 'coins_spent');
    const topUsers = await this.resolveUserNames(
      Object.entries(senderAgg)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([userId, metric]) => ({ userId, metric })),
    );

    return {
      totalCombos: combosRes.count ?? 0,
      comboClaims: claimsRes.count ?? 0,
      premiumGifts: premiumRes.count ?? 0,
      topGiftSenders: topUsers,
    };
  }

  private aggregateByField(
    rows: Record<string, unknown>[],
    keyField: string,
    valueField = 'coins_charged',
  ): Record<string, number> {
    const agg: Record<string, number> = {};
    for (const row of rows) {
      const key = String(row[keyField]);
      agg[key] = (agg[key] ?? 0) + Number(row[valueField] ?? 0);
    }
    return agg;
  }

  private async resolveCreatorNames(profileIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!profileIds.length) return map;
    const { data } = await this.client()
      .from('creator_profiles')
      .select('id, display_name')
      .in('id', profileIds);
    for (const row of data ?? []) {
      map.set(row.id, row.display_name ?? 'Creator');
    }
    return map;
  }

  private async resolveUserNames(
    items: { userId: string; metric: number; secondaryMetric?: number }[],
  ) {
    if (!items.length) return [];
    const ids = items.map((i) => i.userId);
    const { data } = await this.client()
      .from('users')
      .select('id, full_name')
      .in('id', ids);
    const nameMap = new Map((data ?? []).map((u) => [u.id, u.full_name ?? 'User']));
    return items.map((i) => ({
      userId: i.userId,
      userName: nameMap.get(i.userId) ?? 'User',
      metric: i.metric,
      secondaryMetric: i.secondaryMetric,
    }));
  }
}
