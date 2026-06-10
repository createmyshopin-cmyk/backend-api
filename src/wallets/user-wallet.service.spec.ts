import { BadRequestException } from '@nestjs/common';
import { UserWalletService } from './user-wallet.service';

describe('UserWalletService', () => {
  const rpc = jest.fn();
  const supabase = {
    isConfigured: true,
    getClient: () => ({ rpc }),
  };
  const service = new UserWalletService(supabase as never);

  beforeEach(() => jest.clearAllMocks());

  describe('adjustUserCoinsV2', () => {
    it('returns mapped wallet result on success', async () => {
      rpc.mockResolvedValue({
        data: {
          coin_transaction_id: 'tx-1',
          user_id: 'u1',
          balance_before: 100,
          balance_after: 150,
          amount: 50,
          idempotent_replay: false,
        },
        error: null,
      });

      const result = await service.adjustUserCoinsV2({
        userId: 'u1',
        delta: 50,
        sourceType: 'payment',
        sourceId: 'pay-1',
        idempotencyKey: 'key-1',
      });

      expect(result.balanceAfter).toBe(150);
      expect(result.idempotentReplay).toBe(false);
      expect(rpc).toHaveBeenCalledWith(
        'adjust_user_coins_v2',
        expect.objectContaining({ p_delta: 50, p_allow_partial: false }),
      );
    });

    it('throws BadRequestException on insufficient_balance', async () => {
      rpc.mockResolvedValue({
        data: null,
        error: { message: 'insufficient_balance', code: 'P0001' },
      });

      await expect(
        service.adjustUserCoinsV2({
          userId: 'u1',
          delta: -500,
          sourceType: 'call',
          sourceId: 'c1',
          idempotencyKey: 'key-2',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns idempotent replay without error', async () => {
      rpc.mockResolvedValue({
        data: {
          coin_transaction_id: 'tx-existing',
          user_id: 'u1',
          balance_before: 100,
          balance_after: 80,
          amount: -20,
          idempotent_replay: true,
        },
        error: null,
      });

      const result = await service.adjustUserCoinsV2({
        userId: 'u1',
        delta: -20,
        sourceType: 'gift',
        sourceId: 'g1',
        idempotencyKey: 'dup-key',
      });

      expect(result.idempotentReplay).toBe(true);
      expect(result.coinTransactionId).toBe('tx-existing');
    });
  });

  describe('adminAdjustUserCoins', () => {
    it('maps admin RPC JSONB response', async () => {
      rpc.mockResolvedValue({
        data: {
          adjustment_id: 'adj-1',
          coin_transaction_id: 'tx-2',
          audit_log_id: 'audit-1',
          user_id: 'u1',
          balance_before: 200,
          balance_after: 300,
          amount: 100,
          direction: 'credit',
          idempotent_replay: false,
        },
        error: null,
      });

      const result = await service.adminAdjustUserCoins({
        userId: 'u1',
        amount: 100,
        reasonCode: 'goodwill',
        reasonText: 'Ticket #99',
        adminId: 'admin-1',
        adminEmail: 'fin@test.com',
        adminRole: 'finance_admin',
        idempotencyKey: 'admin-key-1',
      });

      expect(result.adjustmentId).toBe('adj-1');
      expect(result.auditLogId).toBe('audit-1');
      expect(result.direction).toBe('credit');
    });

    it('rejects missing reason via RPC error', async () => {
      rpc.mockResolvedValue({
        data: null,
        error: { message: 'reason_text_required' },
      });

      await expect(
        service.adminAdjustUserCoins({
          userId: 'u1',
          amount: 10,
          reasonCode: 'correction',
          reasonText: '',
          adminId: 'admin-1',
          adminEmail: 'fin@test.com',
          adminRole: 'finance_admin',
          idempotencyKey: 'k',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
