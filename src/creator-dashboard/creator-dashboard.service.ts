import { Injectable, Logger } from '@nestjs/common';
import { timed, logParallelSummary } from '../common/query-timer';
import { CreatorDashboardRepository, HistoryQueryParams } from './creator-dashboard.repository';
import { istDateDaysAgo, istDateString, fillChart7Days } from './creator-dashboard.date.util';
import {
  clampLimit,
  encodeCursor,
  validateDateRange,
  validateHistoryPage,
} from './pagination.util';
import type {
  AnalyticsMetrics,
  ChartDayPoint,
  CreatorRequestScope,
  PageInfo,
  WalletSnapshot,
} from './creator-dashboard.types';

const SCOPE = 'creator-dashboard';

@Injectable()
export class CreatorDashboardService {
  private readonly logger = new Logger(CreatorDashboardService.name);

  constructor(private readonly repository: CreatorDashboardRepository) {}

  async getSummary(scope: CreatorRequestScope) {
    const wallet = await this.repository.getWallet(scope);
    return {
      schemaVersion: '3.1.0',
      generatedAt: new Date().toISOString(),
      availableBalance: wallet.availableBalance,
      lockedBalance: wallet.lockedBalance,
      withdrawnBalance: wallet.withdrawnAmount,
      lifetimeEarned: wallet.totalEarned,
      callEarned: wallet.callEarningsTotal,
      giftEarned: wallet.giftEarningsTotal,
      restrictions: this.buildRestrictions(scope),
    };
  }

  async getDashboard(scope: CreatorRequestScope) {
    const requestStart = performance.now();
    const today = istDateString();
    const from7 = istDateDaysAgo(6);
    const from30 = istDateDaysAgo(29);

    const walletTimed = timed(this.logger, SCOPE, 'wallet', () =>
      this.repository.getWallet(scope),
    );
    const todayTimed = timed(this.logger, SCOPE, 'analytics:today', () =>
      this.repository.getAnalyticsWindow(scope.creatorProfileId, today, today),
    );
    const w7Timed = timed(this.logger, SCOPE, 'analytics:7d', () =>
      this.repository.getAnalyticsWindow(scope.creatorProfileId, from7, today),
    );
    const w30Timed = timed(this.logger, SCOPE, 'analytics:30d', () =>
      this.repository.getAnalyticsWindow(scope.creatorProfileId, from30, today),
    );
    const lifetimeCountsTimed = timed(this.logger, SCOPE, 'analytics:lifetime_counts', () =>
      this.repository.getLifetimeCounts(scope.creatorProfileId),
    );

    const [walletR, todayR, w7R, w30R, lifetimeR] = await Promise.all([
      walletTimed,
      todayTimed,
      w7Timed,
      w30Timed,
      lifetimeCountsTimed,
    ]);

    logParallelSummary(this.logger, SCOPE, Math.round(performance.now() - requestStart), [
      walletR,
      todayR,
      w7R,
      w30R,
      lifetimeR,
    ]);

    const wallet = walletR.result;
    const chart7 = this.normalizeChart7(w7R.result.chart, today);

    const lifetime: AnalyticsMetrics = {
      totalEarnings: wallet.totalEarned,
      callEarnings: wallet.callEarningsTotal,
      giftEarnings: wallet.giftEarningsTotal,
      callCount: lifetimeR.result.callCount,
      giftCount: lifetimeR.result.giftCount,
      talkMinutes: lifetimeR.result.talkMinutes,
    };

    return {
      schemaVersion: '3.1.0',
      generatedAt: new Date().toISOString(),
      profile: {
        creatorProfileId: scope.creatorProfileId,
        displayName: scope.displayName,
        avatarUrl: scope.avatarUrl,
        status: scope.profileStatus,
        rating: scope.rating,
        isOnline: scope.isOnline,
        level: null,
        badges: [],
        performanceScore: null,
      },
      restrictions: this.buildRestrictions(scope),
      wallet: {
        availableBalance: wallet.availableBalance,
        lockedBalance: wallet.lockedBalance,
        withdrawnAmount: wallet.withdrawnAmount,
        lifetimeEarnings: wallet.totalEarned,
        callEarningsLifetime: wallet.callEarningsTotal,
        giftEarningsLifetime: wallet.giftEarningsTotal,
        currency: 'COINS',
        asOf: wallet.asOf,
      },
      analytics: {
        today: todayR.result.metrics,
        last7Days: w7R.result.metrics,
        last30Days: w30R.result.metrics,
        lifetime,
        chart7Day: chart7,
        timezone: 'Asia/Kolkata',
      },
      callStatistics: {
        today: this.callStats(todayR.result.metrics),
        last7Days: this.callStats(w7R.result.metrics),
        last30Days: this.callStats(w30R.result.metrics),
        lifetime: this.callStats(lifetime),
      },
      giftStatistics: {
        today: this.giftStats(todayR.result.metrics),
        last7Days: this.giftStats(w7R.result.metrics),
        last30Days: this.giftStats(w30R.result.metrics),
        lifetime: this.giftStats(lifetime),
      },
      extensions: {},
    };
  }

  async getCallHistory(
    scope: CreatorRequestScope,
    query: {
      cursor?: string;
      limit?: number;
      page?: number;
      sort?: string;
      from?: string;
      to?: string;
      status?: string;
    },
  ) {
    validateHistoryPage(query.page, query.cursor);
    const dates = validateDateRange(query.from, query.to, scope.accountCreatedAt);
    const params: HistoryQueryParams = {
      cursor: query.cursor,
      limit: clampLimit(query.limit),
      sort: query.sort ?? 'started_at_desc',
      from: dates.from,
      to: dates.to,
      status: query.status,
    };

    const { items, hasMore } = await this.repository.fetchCallHistory(scope, params);
    const pageInfo = this.buildPageInfo(
      items.length > 0
        ? { t: items[items.length - 1].startedAt, id: items[items.length - 1].callId }
        : null,
      hasMore,
      params.limit,
    );

    return {
      schemaVersion: '3.1.0',
      items: items.map((row) => ({
        callId: row.callId,
        caller: {
          displayName: row.callerDisplayName,
          avatarUrl: row.callerAvatarUrl,
        },
        status: row.status,
        type: row.type,
        durationSeconds: row.durationSeconds,
        earnings: row.earnings,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
      })),
      pageInfo,
    };
  }

  async getGiftHistory(
    scope: CreatorRequestScope,
    query: {
      cursor?: string;
      limit?: number;
      page?: number;
      sort?: string;
      from?: string;
      to?: string;
      giftId?: string;
    },
  ) {
    validateHistoryPage(query.page, query.cursor);
    const dates = validateDateRange(query.from, query.to, scope.accountCreatedAt);
    const params: HistoryQueryParams = {
      cursor: query.cursor,
      limit: clampLimit(query.limit),
      sort: query.sort ?? 'created_at_desc',
      from: dates.from,
      to: dates.to,
      giftId: query.giftId,
    };

    const { items, hasMore } = await this.repository.fetchGiftHistory(scope, params);
    const pageInfo = this.buildPageInfo(
      items.length > 0
        ? { t: items[items.length - 1].createdAt, id: items[items.length - 1].transactionId }
        : null,
      hasMore,
      params.limit,
    );

    return {
      schemaVersion: '3.1.0',
      items: items.map((row) => ({
        transactionId: row.transactionId,
        gift: {
          id: row.giftId,
          name: row.giftName,
          iconUrl: row.giftIconUrl,
          deleted: row.giftDeleted,
        },
        sender: { displayName: row.senderDisplayName },
        creatorCoins: row.creatorCoins,
        callId: row.callId,
        createdAt: row.createdAt,
      })),
      pageInfo,
    };
  }

  async getWithdrawalHistory(
    scope: CreatorRequestScope,
    query: {
      cursor?: string;
      limit?: number;
      page?: number;
      sort?: string;
      from?: string;
      to?: string;
      status?: string;
    },
  ) {
    validateHistoryPage(query.page, query.cursor);
    const dates = validateDateRange(query.from, query.to, scope.accountCreatedAt);
    const params: HistoryQueryParams = {
      cursor: query.cursor,
      limit: clampLimit(query.limit),
      sort: query.sort ?? 'requested_at_desc',
      from: dates.from,
      to: dates.to,
      status: query.status,
    };

    const { items, hasMore } = await this.repository.fetchWithdrawalHistory(scope, params);
    const pageInfo = this.buildPageInfo(
      items.length > 0
        ? { t: items[items.length - 1].requestedAt, id: items[items.length - 1].withdrawalId }
        : null,
      hasMore,
      params.limit,
    );

    return {
      schemaVersion: '3.1.0',
      items,
      pageInfo,
    };
  }

  private buildRestrictions(scope: CreatorRequestScope) {
    const suspended = scope.isSuspended;
    const frozen = scope.isWalletFrozen;
    return {
      isSuspended: suspended,
      isWalletFrozen: frozen,
      readOnly: suspended || frozen,
      canGoOnline: !suspended,
      canReceiveCalls: !suspended,
      canRequestWithdrawal: !suspended && !frozen,
      banner: suspended
        ? 'Your creator account is suspended. You can view earnings but cannot go online or request withdrawals.'
        : frozen
          ? 'Withdrawals are temporarily frozen. Please contact support.'
          : null,
    };
  }

  private normalizeChart7(series: ChartDayPoint[], endDate: string): ChartDayPoint[] {
    const byDate = new Map(series.map((p) => [p.date, p]));
    const days = fillChart7Days(series, endDate);
    return days.map((date) => {
      const existing = byDate.get(date);
      return (
        existing ?? {
          date,
          totalEarnings: 0,
          callEarnings: 0,
          giftEarnings: 0,
          callCount: 0,
          giftCount: 0,
        }
      );
    });
  }

  private callStats(m: AnalyticsMetrics) {
    return {
      earnings: m.callEarnings,
      count: m.callCount,
      talkMinutes: m.talkMinutes,
      averageDurationMinutes:
        m.callCount > 0 ? Math.round((m.talkMinutes / m.callCount) * 10) / 10 : 0,
    };
  }

  private giftStats(m: AnalyticsMetrics) {
    return {
      earnings: m.giftEarnings,
      count: m.giftCount,
      averageCoinsPerGift:
        m.giftCount > 0 ? Math.round((m.giftEarnings / m.giftCount) * 100) / 100 : 0,
    };
  }

  private buildPageInfo(
    last: { t: string; id: string } | null,
    hasMore: boolean,
    limit: number,
  ): PageInfo {
    const nextCursor = hasMore && last ? encodeCursor(last.t, last.id) : null;
    return { nextCursor, hasMore, limit };
  }
}
