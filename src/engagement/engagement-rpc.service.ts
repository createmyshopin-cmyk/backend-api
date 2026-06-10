import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { mapEngagementRpcError } from './engagement-error.util';

export interface FollowRpcResult {
  following: boolean;
  followedAt?: string;
  unfollowedAt?: string;
  creatorProfileId: string;
  idempotentReplay?: boolean;
}

export interface FavoriteRpcResult {
  favorited: boolean;
  favoritedAt?: string;
  unfavoritedAt?: string;
  creatorProfileId: string;
  idempotentReplay?: boolean;
}

export interface EngagementLevelsRpcResult {
  user: {
    currentXp: number;
    currentLevel: number;
    levelTitle: string;
    nextLevel: number;
    xpToNextLevel: number;
    nextLevelThreshold: number;
  };
  creator: {
    creatorProfileId: string;
    currentXp: number;
    currentLevel: number;
    levelTitle: string;
    nextLevel: number;
    xpToNextLevel: number;
    nextLevelThreshold: number;
  } | null;
}

@Injectable()
export class EngagementRpcService {
  constructor(private readonly supabase: SupabaseService) {}

  private client() {
    return this.supabase.getClient();
  }

  async followCreator(params: {
    followerUserId: string;
    creatorProfileId: string;
    idempotencyKey?: string;
  }): Promise<FollowRpcResult> {
    const { data, error } = await this.client().rpc('follow_creator', {
      p_follower_user_id: params.followerUserId,
      p_creator_profile_id: params.creatorProfileId,
      p_idempotency_key: params.idempotencyKey ?? null,
    });
    if (error) mapEngagementRpcError(error, 'follow_creator');
    const row = data as Record<string, unknown>;
    return {
      following: Boolean(row.following),
      followedAt: row.followed_at ? String(row.followed_at) : undefined,
      creatorProfileId: String(row.creator_profile_id),
      idempotentReplay: Boolean(row.idempotent_replay),
    };
  }

  async unfollowCreator(params: {
    followerUserId: string;
    creatorProfileId: string;
  }): Promise<FollowRpcResult> {
    const { data, error } = await this.client().rpc('unfollow_creator', {
      p_follower_user_id: params.followerUserId,
      p_creator_profile_id: params.creatorProfileId,
    });
    if (error) mapEngagementRpcError(error, 'unfollow_creator');
    const row = data as Record<string, unknown>;
    return {
      following: Boolean(row.following),
      unfollowedAt: row.unfollowed_at ? String(row.unfollowed_at) : undefined,
      creatorProfileId: String(row.creator_profile_id),
    };
  }

  async favoriteCreator(params: {
    userId: string;
    creatorProfileId: string;
    idempotencyKey?: string;
  }): Promise<FavoriteRpcResult> {
    const { data, error } = await this.client().rpc('favorite_creator', {
      p_user_id: params.userId,
      p_creator_profile_id: params.creatorProfileId,
      p_idempotency_key: params.idempotencyKey ?? null,
    });
    if (error) mapEngagementRpcError(error, 'favorite_creator');
    const row = data as Record<string, unknown>;
    return {
      favorited: Boolean(row.favorited),
      favoritedAt: row.favorited_at ? String(row.favorited_at) : undefined,
      creatorProfileId: String(row.creator_profile_id),
      idempotentReplay: Boolean(row.idempotent_replay),
    };
  }

  async unfavoriteCreator(params: {
    userId: string;
    creatorProfileId: string;
  }): Promise<FavoriteRpcResult> {
    const { data, error } = await this.client().rpc('unfavorite_creator', {
      p_user_id: params.userId,
      p_creator_profile_id: params.creatorProfileId,
    });
    if (error) mapEngagementRpcError(error, 'unfavorite_creator');
    const row = data as Record<string, unknown>;
    return {
      favorited: Boolean(row.favorited),
      unfavoritedAt: row.unfavorited_at ? String(row.unfavorited_at) : undefined,
      creatorProfileId: String(row.creator_profile_id),
    };
  }

  async getEngagementLevels(userId: string): Promise<EngagementLevelsRpcResult> {
    const { data, error } = await this.client().rpc('get_engagement_levels', {
      p_user_id: userId,
    });
    if (error) mapEngagementRpcError(error, 'get_engagement_levels');
    const row = data as Record<string, unknown>;
    const user = row.user as Record<string, unknown>;
    const creator = row.creator as Record<string, unknown> | null;

    return {
      user: {
        currentXp: Number(user.current_xp ?? 0),
        currentLevel: Number(user.current_level ?? 1),
        levelTitle: String(user.level_title ?? 'Newcomer'),
        nextLevel: Number(user.next_level ?? 2),
        xpToNextLevel: Number(user.xp_to_next_level ?? 0),
        nextLevelThreshold: Number(user.next_level_threshold ?? 100),
      },
      creator: creator
        ? {
            creatorProfileId: String(creator.creator_profile_id),
            currentXp: Number(creator.current_xp ?? 0),
            currentLevel: Number(creator.current_level ?? 1),
            levelTitle: String(creator.level_title ?? 'New Creator'),
            nextLevel: Number(creator.next_level ?? 2),
            xpToNextLevel: Number(creator.xp_to_next_level ?? 0),
            nextLevelThreshold: Number(creator.next_level_threshold ?? 100),
          }
        : null,
    };
  }

  async rebuildUserLevel(userId: string) {
    const { data, error } = await this.client().rpc('rebuild_user_level', {
      p_user_id: userId,
    });
    if (error) mapEngagementRpcError(error, 'rebuild_user_level');
    return data;
  }
}
