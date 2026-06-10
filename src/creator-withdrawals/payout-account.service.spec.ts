import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PayoutAccountService } from './payout-account.service';
import type { CreatorRequestScope } from '../creator-dashboard/creator-dashboard.types';

describe('PayoutAccountService', () => {
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

  const supabase = { isConfigured: true, getClient: jest.fn() };
  let service: PayoutAccountService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PayoutAccountService(supabase as never);
  });

  it('getAccount returns masked account only', async () => {
    supabase.getClient.mockReturnValue({
      rpc: async () => ({
        data: {
          hasAccount: true,
          account: {
            id: 'acc-1',
            type: 'upi',
            accountName: 'Priya',
            upiIdMasked: 'pri***@okaxis',
            isDefault: true,
            status: 'verified',
            createdAt: '2026-06-01T00:00:00.000Z',
          },
        },
        error: null,
      }),
    });

    const result = await service.getAccount(scope);
    expect(result.hasAccount).toBe(true);
    expect(result.account?.maskedDestination).toBe('pri***@okaxis');
    expect(result.account).not.toHaveProperty('upiId');
  });

  it('putAccount validates UPI fields', async () => {
    await expect(
      service.putAccount(scope, { type: 'upi', accountHolderName: 'Priya' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('putAccount requires encryption key', async () => {
    const prev = process.env.PAYOUT_FIELD_ENCRYPTION_KEY;
    delete process.env.PAYOUT_FIELD_ENCRYPTION_KEY;

    await expect(
      service.putAccount(scope, {
        type: 'upi',
        accountHolderName: 'Priya',
        upiId: 'priya@okaxis',
      }),
    ).rejects.toThrow(InternalServerErrorException);

    process.env.PAYOUT_FIELD_ENCRYPTION_KEY = prev;
  });

  it('putAccount bootstraps session and upserts', async () => {
    process.env.PAYOUT_FIELD_ENCRYPTION_KEY =
      '01234567890123456789012345678901';

    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({
        data: {
          id: 'acc-1',
          type: 'upi',
          accountName: 'Priya',
          upiIdMasked: 'pri***@okaxis',
          isDefault: true,
          status: 'pending_verification',
          createdAt: '2026-06-10T00:00:00.000Z',
        },
        error: null,
      });

    supabase.getClient.mockReturnValue({ rpc });

    const result = await service.putAccount(scope, {
      type: 'upi',
      accountHolderName: 'Priya',
      upiId: 'priya@okaxis',
    });

    expect(rpc).toHaveBeenCalledWith('bootstrap_payout_encryption_session', expect.any(Object));
    expect(rpc).toHaveBeenCalledWith('upsert_creator_payout_account', expect.objectContaining({
      p_creator_profile_id: scope.creatorProfileId,
    }));
    expect(result.account?.maskedDestination).toBe('pri***@okaxis');
  });
});
