import { BadRequestException } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';

describe('WithdrawalsService ledger orchestration (Sprint 6)', () => {
  const requestCreatorWithdrawal = jest.fn();
  const settleCreatorWithdrawal = jest.fn();
  const cancelCreatorWithdrawal = jest.fn();
  const withdrawalRpc = {
    requestCreatorWithdrawal,
    settleCreatorWithdrawal,
    cancelCreatorWithdrawal,
    approveCreatorWithdrawal: jest.fn(),
    rejectCreatorWithdrawal: jest.fn(),
    failCreatorWithdrawal: jest.fn(),
    rebuildCreatorWalletFromLedger: jest.fn(),
  };

  const getWalletBalance = jest.fn();
  const creatorsService = { getWalletBalance };

  const from = jest.fn();
  const select = jest.fn();
  const eq = jest.fn();
  const maybeSingle = jest.fn();
  const order = jest.fn();

  const supabase = {
    isConfigured: true,
    getClient: () => ({ from }),
  };

  const service = new WithdrawalsService(
    supabase as never,
    creatorsService as never,
    withdrawalRpc as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    from.mockReturnValue({ select });
    select.mockReturnValue({ eq, order });
    eq.mockReturnValue({ maybeSingle, order });
    maybeSingle.mockResolvedValue({
      data: {
        id: 'w1',
        creator_id: 'creator-user',
        amount: 500,
        status: 'pending',
        requested_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    order.mockResolvedValue({ data: [], error: null });
    requestCreatorWithdrawal.mockResolvedValue({
      withdrawalId: 'w1',
      status: 'pending',
      idempotentReplay: false,
    });
    getWalletBalance.mockResolvedValue({
      availableBalance: 500,
      lockedBalance: 500,
      totalEarned: 1000,
      withdrawnAmount: 0,
    });
  });

  it('requires Idempotency-Key for withdrawal request', async () => {
    await expect(
      service.createWithdrawalRequest('creator-user', 500, 'upi', undefined, undefined, 'a@upi'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(requestCreatorWithdrawal).not.toHaveBeenCalled();
  });

  it('delegates request to atomic RPC (funds locked in DB)', async () => {
    await service.createWithdrawalRequest(
      'creator-user',
      500,
      'upi',
      'withdraw-req-1',
      undefined,
      'a@upi',
    );

    expect(requestCreatorWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({
        creatorUserId: 'creator-user',
        amount: 500,
        idempotencyKey: 'withdraw-req-1',
      }),
    );
  });

  it('exposes locked balance in getCreatorBalance', async () => {
    const balance = await service.getCreatorBalance('creator-user');
    expect(balance.lockedBalance).toBe(500);
    expect(balance.availableBalance).toBe(500);
  });

  it('creator cancel delegates to cancel RPC', async () => {
    cancelCreatorWithdrawal.mockResolvedValue({
      withdrawalId: 'w1',
      status: 'cancelled',
      idempotentReplay: false,
      wallet: { available: 1000, locked: 0, withdrawn: 0, total_earned: 1000 },
    });

    const result = await service.cancelWithdrawal('w1', 'creator-user', 'cancel-key-1');
    expect(cancelCreatorWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({ withdrawalId: 'w1', actorType: 'creator' }),
    );
    expect((result as { wallet?: { locked: number } }).wallet?.locked).toBe(0);
  });
});
