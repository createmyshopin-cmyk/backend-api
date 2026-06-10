import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CreatorScopeGuard } from '../creator-dashboard/creator-scope.guard';
import type { CreatorRequestScope } from '../creator-dashboard/creator-dashboard.types';
import { CreatorWithdrawalsController } from './creator-withdrawals.controller';
import { CreatorWithdrawalsService } from './creator-withdrawals.service';
import { PayoutAccountService } from './payout-account.service';
import { WithdrawalMutationGuard } from './guards/withdrawal-mutation.guard';

describe('CreatorWithdrawalsController', () => {
  let controller: CreatorWithdrawalsController;

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

  const payoutService = {
    getAccount: jest.fn().mockResolvedValue({ schemaVersion: '3.2.0', hasAccount: false }),
    putAccount: jest.fn().mockResolvedValue({ schemaVersion: '3.2.0', hasAccount: true }),
  };

  const withdrawalsService = {
    requestWithdrawal: jest.fn().mockResolvedValue({ schemaVersion: '3.2.0' }),
    cancelWithdrawal: jest.fn().mockResolvedValue({ status: 'cancelled' }),
    getHistory: jest.fn().mockResolvedValue({ items: [], pageInfo: { hasMore: false } }),
    getStatus: jest.fn().mockResolvedValue({ inflight: null }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CreatorWithdrawalsController],
      providers: [
        { provide: PayoutAccountService, useValue: payoutService },
        { provide: CreatorWithdrawalsService, useValue: withdrawalsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CreatorScopeGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WithdrawalMutationGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CreatorWithdrawalsController);
  });

  const req = { creatorScope: scope };

  it('GET account delegates', async () => {
    await controller.getAccount(req as never);
    expect(payoutService.getAccount).toHaveBeenCalledWith(scope);
  });

  it('PUT account delegates', async () => {
    await controller.putAccount(req as never, {
      type: 'upi',
      accountHolderName: 'Priya',
      upiId: 'priya@okaxis',
    });
    expect(payoutService.putAccount).toHaveBeenCalled();
  });

  it('POST request requires idempotency via service', async () => {
    await controller.requestWithdrawal(
      req as never,
      'key-1',
      { amountInr: 500, payoutAccountId: 'acc-1' },
    );
    expect(withdrawalsService.requestWithdrawal).toHaveBeenCalledWith(
      scope,
      { amountInr: 500, payoutAccountId: 'acc-1' },
      'key-1',
    );
  });

  it('POST cancel delegates', async () => {
    await controller.cancelWithdrawal(req as never, 'w-1', 'key-2', {});
    expect(withdrawalsService.cancelWithdrawal).toHaveBeenCalledWith(
      scope,
      'w-1',
      'key-2',
      undefined,
    );
  });

  it('GET history and status delegate', async () => {
    await controller.getHistory(req as never, { limit: 20 });
    await controller.getStatus(req as never);
    expect(withdrawalsService.getHistory).toHaveBeenCalled();
    expect(withdrawalsService.getStatus).toHaveBeenCalledWith(scope);
  });
});
