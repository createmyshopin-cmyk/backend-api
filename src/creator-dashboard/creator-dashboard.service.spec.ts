import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { CreatorDashboardService } from './creator-dashboard.service';
import type { CreatorRequestScope } from './creator-dashboard.types';

describe('CreatorDashboardService', () => {
  const scope: CreatorRequestScope = {
    userId: 'user-1',
    creatorProfileId: 'profile-1',
    profileStatus: 'active',
    isSuspended: false,
    isWalletFrozen: false,
    displayName: 'Priya',
    avatarUrl: null,
    rating: 4.8,
    isOnline: true,
    accountCreatedAt: '2026-01-01T00:00:00.000Z',
  };

  const wallet = {
    availableBalance: 1000,
    lockedBalance: 200,
    withdrawnAmount: 500,
    totalEarned: 1700,
    callEarningsTotal: 1200,
    giftEarningsTotal: 500,
    asOf: '2026-06-10T12:00:00.000Z',
  };

  const metrics = {
    totalEarnings: 100,
    callEarnings: 70,
    giftEarnings: 30,
    callCount: 3,
    giftCount: 2,
    talkMinutes: 45,
  };

  const repository = {
    getWallet: jest.fn().mockResolvedValue(wallet),
    getAnalyticsWindow: jest.fn().mockResolvedValue({
      metrics,
      chart: [{ date: '2026-06-10', ...metrics, giftCount: 2 }],
    }),
    getLifetimeCounts: jest.fn().mockResolvedValue({
      callCount: 50,
      giftCount: 20,
      talkMinutes: 600,
    }),
    fetchCallHistory: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    fetchGiftHistory: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    fetchWithdrawalHistory: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
  };

  const service = new CreatorDashboardService(repository as never);

  beforeEach(() => jest.clearAllMocks());

  describe('getSummary', () => {
    it('returns wallet header fields', async () => {
      const result = await service.getSummary(scope);
      expect(result).toMatchObject({
        availableBalance: 1000,
        lockedBalance: 200,
        withdrawnBalance: 500,
        lifetimeEarned: 1700,
        callEarned: 1200,
        giftEarned: 500,
      });
      expect(repository.getWallet).toHaveBeenCalledWith(scope);
    });
  });

  describe('getDashboard', () => {
    it('returns analytics windows and chart', async () => {
      const result = await service.getDashboard(scope);
      expect(result.wallet.lifetimeEarnings).toBe(1700);
      expect(result.analytics.today.callCount).toBe(3);
      expect(result.analytics.chart7Day).toHaveLength(7);
      expect(result.callStatistics.last7Days.count).toBe(3);
      expect(repository.getAnalyticsWindow).toHaveBeenCalled();
    });

    it('degrades to zero analytics when window fetch fails', async () => {
      repository.getAnalyticsWindow.mockRejectedValueOnce(
        new ServiceUnavailableException({ code: 'dashboard_unavailable' }),
      );
      const result = await service.getDashboard(scope);
      expect(result.wallet.lifetimeEarnings).toBe(1700);
      expect(result.analytics.today.totalEarnings).toBe(0);
      expect(result.analytics.chart7Day).toHaveLength(7);
    });
  });

  describe('suspended creator', () => {
    it('marks read-only restrictions', async () => {
      const suspended = { ...scope, isSuspended: true, profileStatus: 'suspended' as const };
      const result = await service.getSummary(suspended);
      expect(result.restrictions.readOnly).toBe(true);
      expect(result.restrictions.canGoOnline).toBe(false);
    });
  });

  describe('zero-state histories', () => {
    it('returns empty call history', async () => {
      const result = await service.getCallHistory(scope, {});
      expect(result.items).toEqual([]);
      expect(result.pageInfo.hasMore).toBe(false);
    });
  });

  describe('pagination', () => {
    it('rejects page 2 without cursor', async () => {
      await expect(service.getCallHistory(scope, { page: 2 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('passes cursor to repository', async () => {
      repository.fetchGiftHistory.mockResolvedValueOnce({
        items: [
          {
            transactionId: 'g1',
            giftId: 'gift-1',
            giftName: 'Rose',
            giftIconUrl: null,
            giftDeleted: false,
            senderDisplayName: 'Amit',
            creatorCoins: 10,
            callId: 'c1',
            createdAt: '2026-06-10T11:00:00.000Z',
          },
        ],
        hasMore: true,
      });

      const result = await service.getGiftHistory(scope, {
        cursor: Buffer.from(JSON.stringify({ t: '2026-06-10T10:00:00.000Z', id: 'x' })).toString(
          'base64url',
        ),
        limit: 10,
      });

      expect(result.pageInfo.hasMore).toBe(true);
      expect(result.pageInfo.nextCursor).toBeTruthy();
    });
  });

  describe('IDOR protection (design)', () => {
    it('never accepts creator id in service layer — uses scope only', async () => {
      await service.getSummary(scope);
      expect(repository.getWallet).toHaveBeenCalledWith(
        expect.objectContaining({ creatorProfileId: 'profile-1' }),
      );
    });
  });
});
