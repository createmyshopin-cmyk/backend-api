import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { mapEngagementRpcError } from './engagement-error.util';

export interface MissionBoardResult {
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
    completedAt?: string;
    claimedAt?: string;
  }>;
}

@Injectable()
export class MissionRpcService {
  constructor(private readonly supabase: SupabaseService) {}

  private client() {
    return this.supabase.getClient();
  }

  async getDailyMissionsBoard(userId: string): Promise<MissionBoardResult> {
    const { data, error } = await this.client().rpc('get_daily_missions_board', {
      p_user_id: userId,
    });
    if (error) mapEngagementRpcError(error, 'get_daily_missions_board');
    const row = data as Record<string, unknown>;
    const missions = (row.missions as Record<string, unknown>[]) ?? [];
    return {
      missionDate: String(row.missionDate ?? row.mission_date ?? ''),
      missions: missions.map((m) => ({
        id: String(m.id),
        missionKey: String(m.missionKey ?? m.mission_key ?? ''),
        title: String(m.title ?? ''),
        description: String(m.description ?? ''),
        missionType: String(m.missionType ?? m.mission_type ?? ''),
        progress: Number(m.progress ?? 0),
        target: Number(m.target ?? 1),
        status: String(m.status ?? 'in_progress'),
        rewardXp: Number(m.rewardXp ?? m.reward_xp ?? 0),
        rewardCoins: Number(m.rewardCoins ?? m.reward_coins ?? 0),
        completedAt: m.completedAt ? String(m.completedAt) : undefined,
        claimedAt: m.claimedAt ? String(m.claimedAt) : undefined,
      })),
    };
  }

  async claimMissionReward(
    userId: string,
    missionProgressId: string,
    idempotencyKey: string,
  ) {
    const { data, error } = await this.client().rpc('claim_mission_reward', {
      p_user_id: userId,
      p_mission_progress_id: missionProgressId,
      p_idempotency_key: idempotencyKey,
    });
    if (error) mapEngagementRpcError(error, 'claim_mission_reward');
    return data as Record<string, unknown>;
  }

  async claimStreakMilestone(
    userId: string,
    milestoneDay: number,
    idempotencyKey: string,
  ) {
    const { data, error } = await this.client().rpc('claim_streak_milestone', {
      p_user_id: userId,
      p_milestone_day: milestoneDay,
      p_idempotency_key: idempotencyKey,
    });
    if (error) mapEngagementRpcError(error, 'claim_streak_milestone');
    return data as Record<string, unknown>;
  }

  async getStreakSnapshot(userId: string) {
    const { data, error } = await this.client().rpc('get_streak_snapshot', {
      p_user_id: userId,
    });
    if (error) mapEngagementRpcError(error, 'get_streak_snapshot');
    return data as Record<string, unknown>;
  }

  async getEngagementRewards(userId: string, limit = 20) {
    const { data, error } = await this.client().rpc('get_engagement_rewards', {
      p_user_id: userId,
      p_limit: limit,
    });
    if (error) mapEngagementRpcError(error, 'get_engagement_rewards');
    return data as Record<string, unknown>;
  }

  async incrementMissionProgress(
    userId: string,
    missionKey: string,
    sourceId?: string,
    idempotencyKey?: string,
  ): Promise<void> {
    if (!this.supabase.isConfigured) return;
    const { error } = await this.client().rpc('increment_mission_progress', {
      p_user_id: userId,
      p_mission_key: missionKey,
      p_source_id: sourceId ?? null,
      p_idempotency_key: idempotencyKey ?? null,
    });
    if (error) {
      // Non-fatal — mission progress must not block primary flows
      return;
    }
  }
}
