import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CreatorWithdrawalsService } from './creator-withdrawals.service';
import type { CreatorRequestScope } from '../creator-dashboard/creator-dashboard.types';

describe('CreatorWithdrawalsService', () => {
  const scope: CreatorRequestScope = {
    userId: 'user-1',
    creatorProfileId: 'profile-1',
    profileStatus: 'active',
    isSuspended: false,
    isWalletFrozen: false,
    displayName: 'Priya',
    avatarUrl: null,
    rating: 5,
    isOnline: false,
    accountCreatedAt: '2026-01-01T00:00:00.000Z',
  };

  const withdrawalRpc = {
    requestCreatorWithdrawal: jest.fn(),
    cancelCreatorWithdrawal: jest.fn(),
  };

  const dashboardRepo = {
    fetchWithdrawalHistory: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
  };

  const supabase = {
    isConfigured: true,
    getClient: jest.fn(),
  };

  let service: CreatorWithdrawalsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CreatorWithdrawalsService(
      supabase as never,
      withdrawalRpc as never,
      dashboardRepo as never,
    );
  });

  it('requestWithdrawal returns schema 3.2.0 envelope', async () => {
    withdrawalRpc.requestCreatorWithdrawal.mockResolvedValue({
      withdrawalId: 'w-1',
      status: 'pending',
      amount: 500,
      wallet: { available: 250, locked: 500 },
      idempotentReplay: false,
    });

    const result = await service.requestWithdrawal(
      scope,
      { amountInr: 500, payoutAccountId: 'acc-1' },
      'idem-1',
    );

    expect(result.schemaVersion).toBe('3.2.0');
    expect(result.withdrawal.withdrawalId).toBe('w-1');
    expect(withdrawalRpc.requestCreatorWithdrawal).toHaveBeenCalledWith({
      creatorUserId: scope.userId,
      amount: 500,
      idempotencyKey: 'idem-1',
      payoutAccountId: 'acc-1',
    });
  });

  it('cancelWithdrawal blocks IDOR', async () => {
    supabase.getClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { creator_profile_id: 'other', creator_id: 'other-user' },
              error: null,
            }),
          }),
        }),
      }),
    });

    await expect(
      service.cancelWithdrawal(scope, 'w-99', 'idem-2'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('cancelWithdrawal allows owned withdrawal', async () => {
    supabase.getClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { creator_profile_id: scope.creatorProfileId },
              error: null,
            }),
          }),
        }),
      }),
    });
    withdrawalRpc.cancelCreatorWithdrawal.mockResolvedValue({
      status: 'cancelled',
      wallet: { available: 1000, locked: 0 },
      idempotentReplay: false,
    });

    const result = await service.cancelWithdrawal(scope, 'w-1', 'idem-2');
    expect(result.status).toBe('cancelled');
  });

  it('getStatus maps RPC snapshot', async () => {
    supabase.getClient.mockReturnValue({
      rpc: async () => ({
        data: {
          inflight: null,
          eligibility: {
            minAmountInr: 100,
            maxSingleAmountInr: 25000,
            dailyRemainingInr: 50000,
            monthlyRemainingInr: 200000,
            kycStatus: 'not_started',
            kycRequiredAboveInr: 10000,
            hasPayoutAccount: true,
          },
          wallet: { available: 1000, locked: 0 },
        },
        error: null,
      }),
    });

    const result = await service.getStatus(scope);
    expect(result.eligibility.hasPayoutAccount).toBe(true);
    expect(result.eligibility.canRequestWithdrawal).toBe(true);
  });

  it('assertWithdrawalOwned throws not found', async () => {
    supabase.getClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: 'x' } }),
          }),
        }),
      }),
    });

    await expect(
      service.cancelWithdrawal(scope, 'missing', 'idem-3'),
    ).rejects.toThrow(NotFoundException);
  });
});
