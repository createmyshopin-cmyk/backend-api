import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface RebuildCreatorAnalyticsResult {
  creatorProfileId: string | null;
  fromDate: string | null;
  toDate: string | null;
  rowsDeleted: number;
  rowsUpserted: number;
  timezone: string;
}

export interface CreatorAnalyticsWindow {
  creatorProfileId: string;
  fromDate: string;
  toDate: string;
  callCoins: number;
  giftCoins: number;
  totalCoins: number;
  callCount: number;
  callDurationSeconds: number;
  giftsReceivedCount: number;
  dailySeries: Array<{
    date: string;
    callCoins: number;
    giftCoins: number;
    totalCoins: number;
    callCount: number;
    giftsReceivedCount: number;
  }>;
}

@Injectable()
export class CreatorAnalyticsRpcService {
  private readonly logger = new Logger(CreatorAnalyticsRpcService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async rebuildCreatorAnalyticsDaily(params?: {
    creatorProfileId?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<RebuildCreatorAnalyticsResult> {
    if (!this.supabase.isConfigured) {
      throw new Error('supabase_not_configured');
    }

    const { data, error } = await this.supabase.getClient().rpc(
      'rebuild_creator_analytics_daily',
      {
        p_creator_profile_id: params?.creatorProfileId ?? null,
        p_from_date: params?.fromDate ?? null,
        p_to_date: params?.toDate ?? null,
      },
    );

    if (error) {
      this.logger.error(`rebuild_creator_analytics_daily failed: ${error.message}`);
      throw new Error(error.message);
    }

    const row = data as Record<string, unknown>;
    return {
      creatorProfileId: (row.creator_profile_id as string) ?? null,
      fromDate: (row.from_date as string) ?? null,
      toDate: (row.to_date as string) ?? null,
      rowsDeleted: Number(row.rows_deleted ?? 0),
      rowsUpserted: Number(row.rows_upserted ?? 0),
      timezone: String(row.timezone ?? 'Asia/Kolkata'),
    };
  }

  async getCreatorAnalyticsWindow(
    creatorProfileId: string,
    fromDate: string,
    toDate?: string,
  ): Promise<CreatorAnalyticsWindow> {
    if (!this.supabase.isConfigured) {
      throw new Error('supabase_not_configured');
    }

    const { data, error } = await this.supabase.getClient().rpc(
      'get_creator_analytics_window',
      {
        p_creator_profile_id: creatorProfileId,
        p_from_date: fromDate,
        p_to_date: toDate ?? null,
      },
    );

    if (error) {
      this.logger.error(`get_creator_analytics_window failed: ${error.message}`);
      throw new Error(error.message);
    }

    const row = data as Record<string, unknown>;
    const series = Array.isArray(row.daily_series) ? row.daily_series : [];

    return {
      creatorProfileId: String(row.creator_profile_id),
      fromDate: String(row.from_date),
      toDate: String(row.to_date),
      callCoins: Number(row.call_coins ?? 0),
      giftCoins: Number(row.gift_coins ?? 0),
      totalCoins: Number(row.total_coins ?? 0),
      callCount: Number(row.call_count ?? 0),
      callDurationSeconds: Number(row.call_duration_seconds ?? 0),
      giftsReceivedCount: Number(row.gifts_received_count ?? 0),
      dailySeries: series.map((item: Record<string, unknown>) => ({
        date: String(item.date),
        callCoins: Number(item.call_coins ?? 0),
        giftCoins: Number(item.gift_coins ?? 0),
        totalCoins: Number(item.total_coins ?? 0),
        callCount: Number(item.call_count ?? 0),
        giftsReceivedCount: Number(item.gifts_received_count ?? 0),
      })),
    };
  }
}
