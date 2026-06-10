import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { WithdrawalMutationGuard } from './withdrawal-mutation.guard';
import type { CreatorRequestScope } from '../../creator-dashboard/creator-dashboard.types';

describe('WithdrawalMutationGuard', () => {
  const guard = new WithdrawalMutationGuard();

  const scope = (overrides: Partial<CreatorRequestScope>): CreatorRequestScope => ({
    userId: 'u1',
    creatorProfileId: 'p1',
    profileStatus: 'active',
    isSuspended: false,
    isWalletFrozen: false,
    displayName: 'Creator',
    avatarUrl: null,
    rating: 5,
    isOnline: false,
    accountCreatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  const ctx = (creatorScope?: CreatorRequestScope): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ creatorScope }),
      }),
    }) as ExecutionContext;

  it('allows active creators', () => {
    expect(guard.canActivate(ctx(scope({})))).toBe(true);
  });

  it('blocks suspended creators', () => {
    expect(() =>
      guard.canActivate(ctx(scope({ isSuspended: true, profileStatus: 'suspended' }))),
    ).toThrow(ForbiddenException);
  });

  it('blocks frozen wallets', () => {
    expect(() => guard.canActivate(ctx(scope({ isWalletFrozen: true })))).toThrow(
      ForbiddenException,
    );
  });
});
