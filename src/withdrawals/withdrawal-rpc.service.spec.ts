import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { WithdrawalRpcService } from './withdrawal-rpc.service';

describe('WithdrawalRpcService', () => {
  const rpc = jest.fn();
  const supabase = {
    isConfigured: true,
    getClient: () => ({ rpc }),
  };
  const service = new WithdrawalRpcService(supabase as never);

  beforeEach(() => jest.clearAllMocks());

  it('maps request_creator_withdrawal with wallet lock snapshot', async () => {
    rpc.mockResolvedValue({
      data: {
        withdrawal_id: 'w1',
        status: 'pending',
        amount: 500,
        wallet: { available: 500, locked: 500, withdrawn: 0, total_earned: 1000 },
        idempotent_replay: false,
      },
      error: null,
    });

    const result = await service.requestCreatorWithdrawal({
      creatorUserId: 'user-1',
      amount: 500,
      idempotencyKey: 'req-key-1',
    });

    expect(result.status).toBe('pending');
    expect(result.wallet?.locked).toBe(500);
    expect(rpc).toHaveBeenCalledWith(
      'request_creator_withdrawal',
      expect.objectContaining({ p_idempotency_key: 'req-key-1' }),
    );
  });

  it('returns idempotent replay on duplicate request', async () => {
    rpc.mockResolvedValue({
      data: {
        withdrawal_id: 'w1',
        status: 'pending',
        idempotent_replay: true,
      },
      error: null,
    });

    const result = await service.requestCreatorWithdrawal({
      creatorUserId: 'user-1',
      amount: 500,
      idempotencyKey: 'req-dup',
    });

    expect(result.idempotentReplay).toBe(true);
  });

  it('throws ConflictException on inflight withdrawal', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'inflight_withdrawal_exists' },
    });

    await expect(
      service.requestCreatorWithdrawal({
        creatorUserId: 'user-1',
        amount: 200,
        idempotencyKey: 'req-race',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('settle_creator_withdrawal maps paid status', async () => {
    rpc.mockResolvedValue({
      data: {
        withdrawal_id: 'w2',
        status: 'paid',
        payment_reference: 'UTR123',
        wallet: { available: 0, locked: 0, withdrawn: 500, total_earned: 1000 },
        idempotent_replay: false,
      },
      error: null,
    });

    const result = await service.settleCreatorWithdrawal({
      withdrawalId: 'w2',
      adminId: 'admin-1',
      paymentReference: 'UTR123',
      idempotencyKey: 'settle-1',
    });

    expect(result.status).toBe('paid');
    expect(result.paymentReference).toBe('UTR123');
  });

  it('prevents double payout via idempotent settle replay', async () => {
    rpc.mockResolvedValue({
      data: {
        withdrawal_id: 'w2',
        status: 'paid',
        idempotent_replay: true,
      },
      error: null,
    });

    const result = await service.settleCreatorWithdrawal({
      withdrawalId: 'w2',
      adminId: 'admin-1',
      paymentReference: 'UTR123',
      idempotencyKey: 'settle-dup',
    });

    expect(result.idempotentReplay).toBe(true);
  });

  it('fail_creator_withdrawal releases lock', async () => {
    rpc.mockResolvedValue({
      data: {
        withdrawal_id: 'w3',
        status: 'failed',
        wallet: { available: 1000, locked: 0, withdrawn: 0, total_earned: 1000 },
        idempotent_replay: false,
      },
      error: null,
    });

    const result = await service.failCreatorWithdrawal({
      withdrawalId: 'w3',
      actorId: 'admin-1',
      actorType: 'admin',
      reason: 'gateway error',
      idempotencyKey: 'fail-1',
    });

    expect(result.status).toBe('failed');
    expect(result.wallet?.locked).toBe(0);
    expect(result.wallet?.available).toBe(1000);
  });

  it('reject releases funds (lock leakage prevention)', async () => {
    rpc.mockResolvedValue({
      data: {
        withdrawal_id: 'w4',
        status: 'rejected',
        wallet: { available: 800, locked: 0, withdrawn: 200, total_earned: 1000 },
        idempotent_replay: false,
      },
      error: null,
    });

    const result = await service.rejectCreatorWithdrawal({
      withdrawalId: 'w4',
      adminId: 'admin-1',
      reason: 'Invalid account',
      idempotencyKey: 'reject-1',
    });

    expect(result.wallet?.locked).toBe(0);
  });

  it('rebuild_creator_wallet_from_ledger returns projection', async () => {
    rpc.mockResolvedValue({
      data: {
        creator_profile_id: 'profile-1',
        total_earned: 1000,
        available_balance: 500,
        locked_balance: 200,
        withdrawn_amount: 300,
      },
      error: null,
    });

    const result = await service.rebuildCreatorWalletFromLedger('profile-1');
    expect(result.total_earned).toBe(1000);
    expect(result.locked_balance).toBe(200);
  });

  it('throws NotFoundException when withdrawal missing', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'withdrawal_not_found' },
    });

    await expect(
      service.approveCreatorWithdrawal({
        withdrawalId: 'missing',
        adminId: 'admin-1',
        idempotencyKey: 'approve-missing',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException on insufficient balance', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'insufficient_available_balance' },
    });

    await expect(
      service.requestCreatorWithdrawal({
        creatorUserId: 'user-1',
        amount: 99999,
        idempotencyKey: 'phantom',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
