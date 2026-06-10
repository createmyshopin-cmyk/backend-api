import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { resolveDisplayName } from '../users/users.service';
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
} from '../creator-dashboard/pagination.util';
import { EngagementRpcService } from './engagement-rpc.service';
import { MissionRpcService } from './mission-rpc.service';
import { ComboRpcService } from './combo-rpc.service';
import {
  levelFromTotalXp,
  MAX_USER_LEVEL,
  userLevelTitle,
  xpThresholdForLevel,
} from './xp.util';

export interface CreatorSocialItem {
  id: string;
  creatorProfileId: string;
  creatorUserId: string;
  displayName: string;
  profileImage: string | null;
  rating: number;
  isOnline: boolean;
  followedAt?: string;
  favoritedAt?: string;
}

@Injectable()
export class EngagementService {
  private readonly memFollows = new Map<string, Set<string>>();
  private readonly memFavorites = new Map<string, Set<string>>();
  private readonly memUserXp = new Map<string, number>();

  private readonly memMissions = new Map<string, MissionBoardMem>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly rpc: EngagementRpcService,
    private readonly missionRpc: MissionRpcService,
    private readonly comboRpc: ComboRpcService,
  ) {}

  async follow(userId: string, creatorProfileId: string, idempotencyKey?: string) {
    if (!this.supabase.isConfigured) {
      return this.memFollow(userId, creatorProfileId);
    }
    return this.rpc.followCreator({
      followerUserId: userId,
      creatorProfileId,
      idempotencyKey,
    });
  }

  async unfollow(userId: string, creatorProfileId: string) {
    if (!this.supabase.isConfigured) {
      return this.memUnfollow(userId, creatorProfileId);
    }
    return this.rpc.unfollowCreator({ followerUserId: userId, creatorProfileId });
  }

  async favorite(userId: string, creatorProfileId: string, idempotencyKey?: string) {
    if (!this.supabase.isConfigured) {
      return this.memFavorite(userId, creatorProfileId);
    }
    return this.rpc.favoriteCreator({ userId, creatorProfileId, idempotencyKey });
  }

  async unfavorite(userId: string, creatorProfileId: string) {
    if (!this.supabase.isConfigured) {
      return this.memUnfavorite(userId, creatorProfileId);
    }
    return this.rpc.unfavoriteCreator({ userId, creatorProfileId });
  }

  async getLevels(userId: string) {
    if (!this.supabase.isConfigured) {
      const totalXp = this.memUserXp.get(userId) ?? 0;
      const level = levelFromTotalXp(totalXp, MAX_USER_LEVEL);
      const nextThreshold = xpThresholdForLevel(level + 1, MAX_USER_LEVEL);
      return {
        user: {
          currentXp: totalXp,
          currentLevel: level,
          levelTitle: userLevelTitle(level),
          nextLevel: Math.min(level + 1, MAX_USER_LEVEL),
          xpToNextLevel: Math.max(nextThreshold - totalXp, 0),
          nextLevelThreshold: nextThreshold,
        },
        creator: null,
      };
    }
    return this.rpc.getEngagementLevels(userId);
  }

  async listFollows(userId: string, cursor?: string, limit?: number) {
    const pageLimit = clampLimit(limit);
    if (!this.supabase.isConfigured) {
      const ids = [...(this.memFollows.get(userId) ?? [])];
      return {
        items: ids.map((creatorProfileId) => ({
          id: creatorProfileId,
          creatorProfileId,
          creatorUserId: creatorProfileId,
          displayName: 'Creator',
          profileImage: null,
          rating: 0,
          isOnline: false,
        })),
        pageInfo: { hasMore: false, nextCursor: null, limit: pageLimit },
      };
    }

    let cursorFilter: { t: string; id: string } | undefined;
    if (cursor) {
      cursorFilter = decodeCursor(cursor);
    }

    let query = this.supabase
      .getClient()
      .from('follows')
      .select(
        `id, creator_profile_id, followed_at,
         creator_profiles!inner (
           id, user_id, rating, is_online, last_seen_at,
           users!inner (id, name, full_name, profile_image)
         )`,
      )
      .eq('follower_user_id', userId)
      .is('unfollowed_at', null)
      .order('followed_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(pageLimit + 1);

    if (cursorFilter) {
      query = query.or(
        `followed_at.lt.${cursorFilter.t},and(followed_at.eq.${cursorFilter.t},id.lt.${cursorFilter.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      throw new BadRequestException(error.message);
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    const hasMore = rows.length > pageLimit;
    const page = hasMore ? rows.slice(0, pageLimit) : rows;
    const items = page.map((row) => this.mapSocialRow(row, 'followed_at'));

    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(String(last.followed_at), String(last.id))
        : null;

    return {
      items,
      pageInfo: { hasMore, nextCursor, limit: pageLimit },
    };
  }

  async listFavorites(userId: string, cursor?: string, limit?: number) {
    const pageLimit = clampLimit(limit);
    if (!this.supabase.isConfigured) {
      const ids = [...(this.memFavorites.get(userId) ?? [])];
      return {
        items: ids.map((creatorProfileId) => ({
          id: creatorProfileId,
          creatorProfileId,
          creatorUserId: creatorProfileId,
          displayName: 'Creator',
          profileImage: null,
          rating: 0,
          isOnline: false,
        })),
        pageInfo: { hasMore: false, nextCursor: null, limit: pageLimit },
      };
    }

    let cursorFilter: { t: string; id: string } | undefined;
    if (cursor) {
      cursorFilter = decodeCursor(cursor);
    }

    let query = this.supabase
      .getClient()
      .from('favorites')
      .select(
        `id, creator_profile_id, favorited_at,
         creator_profiles!inner (
           id, user_id, rating, is_online, last_seen_at,
           users!inner (id, name, full_name, profile_image)
         )`,
      )
      .eq('user_id', userId)
      .is('unfavorited_at', null)
      .order('favorited_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(pageLimit + 1);

    if (cursorFilter) {
      query = query.or(
        `favorited_at.lt.${cursorFilter.t},and(favorited_at.eq.${cursorFilter.t},id.lt.${cursorFilter.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      throw new BadRequestException(error.message);
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    const hasMore = rows.length > pageLimit;
    const page = hasMore ? rows.slice(0, pageLimit) : rows;
    const items = page.map((row) => this.mapSocialRow(row, 'favorited_at'));

    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(String(last.favorited_at ?? last.followed_at), String(last.id))
        : null;

    return {
      items,
      pageInfo: { hasMore, nextCursor, limit: pageLimit },
    };
  }

  async getSocialStateForCreators(
    userId: string,
    creatorProfileIds: string[],
  ): Promise<{ following: Set<string>; favorited: Set<string> }> {
    const following = new Set<string>();
    const favorited = new Set<string>();
    if (!creatorProfileIds.length) {
      return { following, favorited };
    }

    if (!this.supabase.isConfigured) {
      for (const id of this.memFollows.get(userId) ?? []) following.add(id);
      for (const id of this.memFavorites.get(userId) ?? []) favorited.add(id);
      return { following, favorited };
    }

    const [followRes, favRes] = await Promise.all([
      this.supabase
        .getClient()
        .from('follows')
        .select('creator_profile_id')
        .eq('follower_user_id', userId)
        .is('unfollowed_at', null)
        .in('creator_profile_id', creatorProfileIds),
      this.supabase
        .getClient()
        .from('favorites')
        .select('creator_profile_id')
        .eq('user_id', userId)
        .is('unfavorited_at', null)
        .in('creator_profile_id', creatorProfileIds),
    ]);

    for (const row of followRes.data ?? []) {
      following.add(String((row as Record<string, unknown>).creator_profile_id));
    }
    for (const row of favRes.data ?? []) {
      favorited.add(String((row as Record<string, unknown>).creator_profile_id));
    }

    return { following, favorited };
  }

  async resolveCreatorProfileId(creatorUserId: string): Promise<string> {
    if (!this.supabase.isConfigured) {
      return `mem-profile-${creatorUserId}`;
    }
    const { data, error } = await this.supabase
      .getClient()
      .from('creator_profiles')
      .select('id')
      .eq('user_id', creatorUserId)
      .maybeSingle();
    if (error || !data?.id) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'creator_not_found',
        message: 'Creator profile not found',
      });
    }
    return String(data.id);
  }

  private mapSocialRow(
    row: Record<string, unknown>,
    timeField: 'followed_at' | 'favorited_at',
  ): CreatorSocialItem {
    const cp = row.creator_profiles as Record<string, unknown> | Record<string, unknown>[];
    const profile = Array.isArray(cp) ? cp[0] : cp;
    const users = profile?.users as Record<string, unknown> | Record<string, unknown>[];
    const userRow = Array.isArray(users) ? users[0] : users;

    return {
      id: String(row.id),
      creatorProfileId: String(row.creator_profile_id),
      creatorUserId: String(profile?.user_id ?? userRow?.id ?? ''),
      displayName: resolveDisplayName(userRow ?? {}, 'Creator'),
      profileImage: (userRow?.profile_image as string) ?? null,
      rating: Number(profile?.rating ?? 0),
      isOnline: Boolean(profile?.is_online ?? false),
      ...(timeField === 'followed_at'
        ? { followedAt: String(row.followed_at) }
        : { favoritedAt: String(row.favorited_at) }),
    };
  }

  private memFollow(userId: string, creatorProfileId: string) {
    const set = this.memFollows.get(userId) ?? new Set<string>();
    set.add(creatorProfileId);
    this.memFollows.set(userId, set);
    const xp = (this.memUserXp.get(userId) ?? 0) + 10;
    this.memUserXp.set(userId, xp);
    return {
      following: true,
      followedAt: new Date().toISOString(),
      creatorProfileId,
      idempotentReplay: false,
    };
  }

  private memUnfollow(userId: string, creatorProfileId: string) {
    this.memFollows.get(userId)?.delete(creatorProfileId);
    return { following: false, creatorProfileId };
  }

  private memFavorite(userId: string, creatorProfileId: string) {
    const favs = this.memFavorites.get(userId) ?? new Set<string>();
    if (favs.size >= 50 && !favs.has(creatorProfileId)) {
      throw new BadRequestException('favorite_limit_reached');
    }
    favs.add(creatorProfileId);
    this.memFavorites.set(userId, favs);
    this.memFollow(userId, creatorProfileId);
    const xp = (this.memUserXp.get(userId) ?? 0) + 5;
    this.memUserXp.set(userId, xp);
    return {
      favorited: true,
      favoritedAt: new Date().toISOString(),
      creatorProfileId,
      idempotentReplay: false,
    };
  }

  private memUnfavorite(userId: string, creatorProfileId: string) {
    this.memFavorites.get(userId)?.delete(creatorProfileId);
    return { favorited: false, creatorProfileId };
  }

  async getMissions(userId: string) {
    if (!this.supabase.isConfigured) {
      return this.memMissions.get(userId) ?? defaultMemMissions();
    }
    return this.missionRpc.getDailyMissionsBoard(userId);
  }

  async claimReward(
    userId: string,
    body: { missionProgressId?: string; milestoneDay?: number },
    idempotencyKey: string,
  ) {
    if (body.milestoneDay != null) {
      if (!this.supabase.isConfigured) {
        return { status: 'claimed', milestoneDay: body.milestoneDay, xpGranted: 5 };
      }
      return this.missionRpc.claimStreakMilestone(
        userId,
        body.milestoneDay,
        idempotencyKey,
      );
    }
    if (!body.missionProgressId) {
      throw new BadRequestException('missionProgressId or milestoneDay required');
    }
    if (!this.supabase.isConfigured) {
      return { status: 'claimed', xpGranted: 10 };
    }
    return this.missionRpc.claimMissionReward(
      userId,
      body.missionProgressId,
      idempotencyKey,
    );
  }

  async getStreak(userId: string) {
    if (!this.supabase.isConfigured) {
      return {
        currentStreak: 1,
        longestStreak: 1,
        graceTokensRemaining: 1,
        milestones: [],
      };
    }
    return this.missionRpc.getStreakSnapshot(userId);
  }

  async getRewards(userId: string, limit?: number) {
    if (!this.supabase.isConfigured) {
      return { items: [] };
    }
    return this.missionRpc.getEngagementRewards(userId, limit ?? 20);
  }

  async getPremiumGifts() {
    if (!this.supabase.isConfigured) {
      return {
        items: [
          {
            premiumGiftId: 'mem-premium-1',
            giftId: 'mem-gift-1',
            name: 'Princess Crown',
            coinCost: 500,
            campaignKey: 'default',
            displayTier: 'premium',
            badgeLabel: 'Premium',
            visualTheme: 'gold',
          },
        ],
      };
    }
    return this.comboRpc.getPremiumGiftsCatalog();
  }

  async getComboStatus(userId: string) {
    if (!this.supabase.isConfigured) {
      return { activeCombos: [], milestones: [] };
    }
    return this.comboRpc.getComboStatus(userId);
  }

  async getComboHistory(userId: string, limit?: number) {
    if (!this.supabase.isConfigured) {
      return { items: [] };
    }
    return this.comboRpc.getComboHistory(userId, limit ?? 20);
  }
}

export interface MissionBoardMem {
  missionDate: string;
  missions: Array<{
    id: string;
    missionKey: string;
    title: string;
    description: string;
    missionType: string;
    progress: number;
    target: number;
    status: string;
    rewardXp: number;
    rewardCoins: number;
  }>;
}

function defaultMemMissions(): MissionBoardMem {
  const today = new Date().toISOString().slice(0, 10);
  return {
    missionDate: today,
    missions: [
      {
        id: 'mem-m1',
        missionKey: 'daily_login',
        title: 'Daily login',
        description: 'Open the app today',
        missionType: 'login',
        progress: 1,
        target: 1,
        status: 'completed',
        rewardXp: 10,
        rewardCoins: 0,
      },
    ],
  };
}
