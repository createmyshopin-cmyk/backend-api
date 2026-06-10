import { WalletsService } from './wallets.service';
import type { AdminRequestUser } from '../auth/admin-user.types';

describe('WalletsService.adjustCoins', () => {
  const admin: AdminRequestUser = {
    id: 'admin-1',
    email: 'fin@test.com',
    name: 'Fin',
    role: 'finance_admin',
    status: 'active',
    sessionId: 'sess-1',
    type: 'admin',
  };

  const usersService = {
    findOne: jest.fn().mockResolvedValue({ id: 'u1', name: 'User', coins: 100 }),
  };

  const userWallet = {
    adminAdjustUserCoins: jest.fn(),
  };

  const supabase = { isConfigured: true, getClient: jest.fn() };
  const service = new WalletsService(
    usersService as never,
    userWallet as never,
    supabase as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('delegates to admin_adjust_user_coins RPC with reason and admin context', async () => {
    userWallet.adminAdjustUserCoins.mockResolvedValue({
      adjustmentId: 'adj-1',
      coinTransactionId: 'tx-1',
      auditLogId: 'audit-1',
      userId: 'u1',
      balanceBefore: 100,
      balanceAfter: 200,
      amount: 100,
      direction: 'credit',
      idempotentReplay: false,
    });

    const result = await service.adjustCoins(
      {
        userId: 'u1',
        amount: 100,
        reasonCode: 'goodwill',
        reason: 'Support credit',
        idempotencyKey: 'idem-1',
      },
      admin,
      { ip: '127.0.0.1' },
    );

    expect(userWallet.adminAdjustUserCoins).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        amount: 100,
        reasonCode: 'goodwill',
        reasonText: 'Support credit',
        adminId: 'admin-1',
        idempotencyKey: 'idem-1',
      }),
    );
    expect(result.auditLogId).toBe('audit-1');
    expect(result.balanceAfter).toBe(200);
  });

  it('surfaces idempotent replay message', async () => {
    userWallet.adminAdjustUserCoins.mockResolvedValue({
      adjustmentId: 'adj-1',
      coinTransactionId: 'tx-1',
      userId: 'u1',
      balanceBefore: 100,
      balanceAfter: 200,
      amount: 100,
      direction: 'credit',
      idempotentReplay: true,
    });

    const result = await service.adjustCoins(
      {
        userId: 'u1',
        amount: 100,
        reasonCode: 'reconciliation',
        reason: 'Replay test',
        idempotencyKey: 'same-key',
      },
      admin,
    );

    expect(result.idempotentReplay).toBe(true);
    expect(result.message).toContain('idempotent');
  });
});
