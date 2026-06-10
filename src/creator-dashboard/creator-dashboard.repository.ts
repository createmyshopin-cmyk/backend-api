import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { timed } from '../common/query-timer';
import { SupabaseService } from '../supabase/supabase.service';
import { CreatorAnalyticsRpcService } from '../creator-analytics/creator-analytics-rpc.service';
import { resolveDisplayName } from '../users/users.service';
import {
  decodeCursor,
  encodeCursor,
  maskBankAccount,
  maskUpi,
} from './pagination.util';
import {
  aggregateLiveAnalytics,
  istRangeBounds,
  isEmptyAnalyticsMetrics,
} from './creator-analytics-live.util';
import type {
  AnalyticsMetrics,
  CallHistoryRow,
  ChartDayPoint,
  CreatorRequestScope,
  GiftHistoryRow,
  WalletSnapshot,
  WithdrawalHistoryRow,
} from './creator-dashboard.types';

const SCOPE = 'creator-dashboard';

export interface HistoryQueryParams {
  cursor?: string;
  limit: number;
  sort: string;
  from?: string;
  to?: string;
  status?: string;
  giftId?: string;
}

@Injectable()
export class CreatorDashboardRepository {
  private readonly logger = new Logger(CreatorDashboardRepository.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly analyticsRpc: CreatorAnalyticsRpcService,
  ) {}

  async getWallet(scope: CreatorRequestScope): Promise<WalletSnapshot> {
    if (!this.supabase.isConfigured) {
      return this.zeroWallet();
    }

    const { result: walletResult } = await timed(this.logger, SCOPE, 'db:creator_wallets', async () =>
      this.supabase
        .getClient()
        .from('creator_wallets')
        .select(
          'total_earned, available_balance, locked_balance, withdrawn_amount, gift_earnings_total, call_earnings_total, updated_at',
        )
        .eq('creator_id', scope.creatorProfileId)
        .maybeSingle(),
    );

    const { data, error: walletError } = walletResult;

    if (walletError) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'dashboard_unavailable',
        message: 'Unable to load wallet data',
      });
    }

    if (!data) {
      return this.zeroWallet();
    }

    const row = data as Record<string, unknown>;
    return {
      availableBalance: Number(row.available_balance ?? 0),
      lockedBalance: Number(row.locked_balance ?? 0),
      withdrawnAmount: Number(row.withdrawn_amount ?? 0),
      totalEarned: Number(row.total_earned ?? 0),
      callEarningsTotal: Number(row.call_earnings_total ?? 0),
      giftEarningsTotal: Number(row.gift_earnings_total ?? 0),
      asOf: String(row.updated_at ?? new Date().toISOString()),
    };
  }

  async getAnalyticsWindow(
    scope: CreatorRequestScope,
    fromDate: string,
    toDate: string,
  ): Promise<{ metrics: AnalyticsMetrics; chart: ChartDayPoint[] }> {
    if (!this.supabase.isConfigured) {
      return { metrics: this.zeroMetrics(), chart: [] };
    }

    let metrics = this.zeroMetrics();
    let chart: ChartDayPoint[] = [];

    try {
      const window = await this.analyticsRpc.getCreatorAnalyticsWindow(
        scope.creatorProfileId,
        fromDate,
        toDate,
      );
      metrics = {
        totalEarnings: window.totalCoins,
        callEarnings: window.callCoins,
        giftEarnings: window.giftCoins,
        callCount: window.callCount,
        giftCount: window.giftsReceivedCount,
        talkMinutes: this.secondsToTalkMinutes(window.callDurationSeconds),
      };
      chart = window.dailySeries.map((d) => ({
        date: d.date,
        totalEarnings: d.totalCoins,
        callEarnings: d.callCoins,
        giftEarnings: d.giftCoins,
        callCount: d.callCount,
        giftCount: d.giftsReceivedCount,
      }));
    } catch (e) {
      this.logger.warn(
        `analytics window failed for ${scope.creatorProfileId} (${fromDate}..${toDate}): ${(e as Error).message}`,
      );
    }

    if (isEmptyAnalyticsMetrics(metrics)) {
      const live = await this.fetchLiveAnalyticsWindow(scope, fromDate, toDate);
      if (!isEmptyAnalyticsMetrics(live.metrics)) {
        this.logger.log(
          `analytics live fallback for ${scope.creatorProfileId} (${fromDate}..${toDate})`,
        );
        return live;
      }
    }

    return { metrics, chart };
  }

  async getLifetimeCounts(scope: CreatorRequestScope): Promise<{
    callCount: number;
    giftCount: number;
    talkMinutes: number;
  }> {
    if (!this.supabase.isConfigured) {
      return { callCount: 0, giftCount: 0, talkMinutes: 0 };
    }

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const window = await this.getAnalyticsWindow(scope, '1970-01-01', today);
    return {
      callCount: window.metrics.callCount,
      giftCount: window.metrics.giftCount,
      talkMinutes: window.metrics.talkMinutes,
    };
  }

  private async fetchLiveAnalyticsWindow(
    scope: CreatorRequestScope,
    fromDate: string,
    toDate: string,
  ): Promise<{ metrics: AnalyticsMetrics; chart: ChartDayPoint[] }> {
    const client = this.supabase.getClient();
    const { from, to } = istRangeBounds(fromDate, toDate);

    const [giftsResult, callsResult] = await Promise.all([
      client
        .from('gift_transactions')
        .select('creator_coins, created_at')
        .eq('creator_id', scope.creatorProfileId)
        .gte('created_at', from)
        .lte('created_at', to),
      client
        .from('calls')
        .select(
          'duration_seconds, billable_duration_seconds, started_at, creator_earnings(creator_share)',
        )
        .eq('creator_id', scope.userId)
        .in('status', ['ended', 'completed'])
        .gte('started_at', from)
        .lte('started_at', to),
    ]);

    if (giftsResult.error) {
      this.logger.warn(`live gift analytics failed: ${giftsResult.error.message}`);
    }
    if (callsResult.error) {
      this.logger.warn(`live call analytics failed: ${callsResult.error.message}`);
    }

    return aggregateLiveAnalytics(
      (giftsResult.data ?? []) as Parameters<typeof aggregateLiveAnalytics>[0],
      (callsResult.data ?? []) as Parameters<typeof aggregateLiveAnalytics>[1],
      fromDate,
      toDate,
    );
  }

  async fetchCallHistory(
    scope: CreatorRequestScope,
    params: HistoryQueryParams,
  ): Promise<{ items: CallHistoryRow[]; hasMore: boolean }> {
    if (!this.supabase.isConfigured) {
      return { items: [], hasMore: false };
    }

    const ascending = params.sort === 'started_at_asc';
    let query = this.supabase
      .getClient()
      .from('calls')
      .select(
        'id, caller_id, status, type, duration_seconds, billable_duration_seconds, started_at, ended_at, creator_earnings(creator_share), users!calls_caller_id_fkey(name, full_name, avatar_url, profile_image)',
      )
      .eq('creator_id', scope.userId);

    if (params.status) {
      query = query.eq('status', params.status);
    }
    if (params.from) {
      query = query.gte('started_at', params.from);
    }
    if (params.to) {
      query = query.lte('started_at', `${params.to}T23:59:59.999Z`);
    }
    if (params.cursor) {
      const c = decodeCursor(params.cursor);
      if (ascending) {
        query = query.or(
          `started_at.gt.${c.t},and(started_at.eq.${c.t},id.gt.${c.id})`,
        );
      } else {
        query = query.or(
          `started_at.lt.${c.t},and(started_at.eq.${c.t},id.lt.${c.id})`,
        );
      }
    }

    query = query
      .order('started_at', { ascending })
      .order('id', { ascending })
      .limit(params.limit + 1);

    const { data, error } = await query;

    if (error) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'history_unavailable',
        message: 'Unable to load call history',
      });
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    const hasMore = rows.length > params.limit;
    const slice = hasMore ? rows.slice(0, params.limit) : rows;

    const items: CallHistoryRow[] = slice.map((row) => {
      const earningsArr = row.creator_earnings as Record<string, unknown> | Record<string, unknown>[] | null;
      const earning = Array.isArray(earningsArr) ? earningsArr[0] : earningsArr;
      const caller = row.users as Record<string, unknown> | Record<string, unknown>[] | null;
      const callerRow = Array.isArray(caller) ? caller[0] : caller;
      const duration = Number(
        row.billable_duration_seconds ?? row.duration_seconds ?? 0,
      );

      return {
        callId: String(row.id),
        callerDisplayName: callerRow ? resolveDisplayName(callerRow) : 'User',
        callerAvatarUrl:
          (callerRow?.avatar_url as string) ??
          (callerRow?.profile_image as string) ??
          null,
        status: String(row.status),
        type: String(row.type ?? 'voice'),
        durationSeconds: duration,
        earnings: Number(earning?.creator_share ?? 0),
        startedAt: String(row.started_at),
        endedAt: row.ended_at ? String(row.ended_at) : null,
      };
    });

    return { items, hasMore };
  }

  async fetchGiftHistory(
    scope: CreatorRequestScope,
    params: HistoryQueryParams,
  ): Promise<{ items: GiftHistoryRow[]; hasMore: boolean }> {
    if (!this.supabase.isConfigured) {
      return { items: [], hasMore: false };
    }

    const ascending = params.sort === 'created_at_asc';
    let query = this.supabase
      .getClient()
      .from('gift_transactions')
      .select(
        'id, creator_coins, call_id, created_at, gift_id, gifts(name, icon_url, is_active), users!gift_transactions_sender_user_id_fkey(name, full_name)',
      )
      .eq('creator_id', scope.creatorProfileId);

    if (params.giftId) {
      query = query.eq('gift_id', params.giftId);
    }
    if (params.from) {
      query = query.gte('created_at', params.from);
    }
    if (params.to) {
      query = query.lte('created_at', `${params.to}T23:59:59.999Z`);
    }
    if (params.cursor) {
      const c = decodeCursor(params.cursor);
      if (ascending) {
        query = query.or(
          `created_at.gt.${c.t},and(created_at.eq.${c.t},id.gt.${c.id})`,
        );
      } else {
        query = query.or(
          `created_at.lt.${c.t},and(created_at.eq.${c.t},id.lt.${c.id})`,
        );
      }
    }

    query = query
      .order('created_at', { ascending })
      .order('id', { ascending })
      .limit(params.limit + 1);

    const { data, error } = await query;

    if (error) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'history_unavailable',
        message: 'Unable to load gift history',
      });
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    const hasMore = rows.length > params.limit;
    const slice = hasMore ? rows.slice(0, params.limit) : rows;

    const items: GiftHistoryRow[] = slice.map((row) => {
      const gift = row.gifts as Record<string, unknown> | Record<string, unknown>[] | null;
      const giftRow = Array.isArray(gift) ? gift[0] : gift;
      const sender = row.users as Record<string, unknown> | Record<string, unknown>[] | null;
      const senderRow = Array.isArray(sender) ? sender[0] : sender;
      const deleted = giftRow && giftRow.is_active === false;

      return {
        transactionId: String(row.id),
        giftId: row.gift_id ? String(row.gift_id) : null,
        giftName: deleted ? 'Unavailable gift' : String(giftRow?.name ?? 'Gift'),
        giftIconUrl: deleted ? null : ((giftRow?.icon_url as string) ?? null),
        giftDeleted: Boolean(deleted),
        senderDisplayName: senderRow ? resolveDisplayName(senderRow) : 'User',
        creatorCoins: Number(row.creator_coins ?? 0),
        callId: row.call_id ? String(row.call_id) : null,
        createdAt: String(row.created_at),
      };
    });

    return { items, hasMore };
  }

  async fetchWithdrawalHistory(
    scope: CreatorRequestScope,
    params: HistoryQueryParams,
  ): Promise<{ items: WithdrawalHistoryRow[]; hasMore: boolean }> {
    if (!this.supabase.isConfigured) {
      return { items: [], hasMore: false };
    }

    const ascending = params.sort === 'requested_at_asc';
    let query = this.supabase
      .getClient()
      .from('withdrawals')
      .select(
        'id, amount, status, requested_at, paid_at, payment_reference, failure_reason, cancellation_reason, upi_id, bank_account_number',
      )
      .or(
        `creator_profile_id.eq.${scope.creatorProfileId},creator_id.eq.${scope.userId}`,
      );

    if (params.status) {
      query = query.eq('status', params.status);
    }
    if (params.from) {
      query = query.gte('requested_at', params.from);
    }
    if (params.to) {
      query = query.lte('requested_at', `${params.to}T23:59:59.999Z`);
    }
    if (params.cursor) {
      const c = decodeCursor(params.cursor);
      if (ascending) {
        query = query.or(
          `requested_at.gt.${c.t},and(requested_at.eq.${c.t},id.gt.${c.id})`,
        );
      } else {
        query = query.or(
          `requested_at.lt.${c.t},and(requested_at.eq.${c.t},id.lt.${c.id})`,
        );
      }
    }

    query = query
      .order('requested_at', { ascending })
      .order('id', { ascending })
      .limit(params.limit + 1);

    const { data, error } = await query;

    if (error) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'history_unavailable',
        message: 'Unable to load withdrawal history',
      });
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    const hasMore = rows.length > params.limit;
    const slice = hasMore ? rows.slice(0, params.limit) : rows;

    const items: WithdrawalHistoryRow[] = slice.map((row) => {
      const status = String(row.status);
      return {
        withdrawalId: String(row.id),
        amount: Number(row.amount ?? 0),
        status,
        statusLabel: this.withdrawalStatusLabel(status),
        userMessage: this.withdrawalUserMessage(status, row),
        requestedAt: String(row.requested_at),
        paidAt: row.paid_at ? String(row.paid_at) : null,
        paymentReference: row.payment_reference ? String(row.payment_reference) : null,
        payoutMethodMasked:
          maskUpi(row.upi_id as string) ?? maskBankAccount(row.bank_account_number as string),
      };
    });

    return { items, hasMore };
  }

  buildNextCursor(
    items: Array<{ startedAt?: string; createdAt?: string; requestedAt?: string; callId?: string; transactionId?: string; withdrawalId?: string }>,
    sortAsc: boolean,
    timeField: 'startedAt' | 'createdAt' | 'requestedAt',
    idField: 'callId' | 'transactionId' | 'withdrawalId',
  ): string | null {
    if (items.length === 0) return null;
    const last = items[items.length - 1];
    const t = last[timeField];
    const id = last[idField];
    if (!t || !id) return null;
    return encodeCursor(t, id);
  }

  private zeroWallet(): WalletSnapshot {
    const now = new Date().toISOString();
    return {
      availableBalance: 0,
      lockedBalance: 0,
      withdrawnAmount: 0,
      totalEarned: 0,
      callEarningsTotal: 0,
      giftEarningsTotal: 0,
      asOf: now,
    };
  }

  private secondsToTalkMinutes(seconds: number): number {
    return seconds > 0 ? Math.ceil(seconds / 60) : 0;
  }

  private zeroMetrics(): AnalyticsMetrics {
    return {
      totalEarnings: 0,
      callEarnings: 0,
      giftEarnings: 0,
      callCount: 0,
      giftCount: 0,
      talkMinutes: 0,
    };
  }

  private withdrawalStatusLabel(status: string): string {
    const map: Record<string, string> = {
      pending: 'Pending',
      approved: 'Approved',
      paid: 'Paid',
      rejected: 'Rejected',
      cancelled: 'Cancelled',
      failed: 'Failed',
    };
    return map[status] ?? status;
  }

  private withdrawalUserMessage(status: string, row: Record<string, unknown>): string | null {
    if (status === 'failed' && row.failure_reason) {
      return 'Withdrawal could not be completed. Please contact support.';
    }
    if (status === 'rejected') {
      return 'Withdrawal request was not approved.';
    }
    if (status === 'cancelled') {
      return 'Withdrawal was cancelled.';
    }
    return null;
  }
}
