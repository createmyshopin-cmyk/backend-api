import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { CallBillingRpcService } from './call-billing-rpc.service';

describe('CallBillingRpcService', () => {
  const rpc = jest.fn();
  const supabase = {
    isConfigured: true,
    getClient: () => ({ rpc }),
  };
  const service = new CallBillingRpcService(supabase as never);

  beforeEach(() => jest.clearAllMocks());

  describe('endCallBilling', () => {
    it('maps successful settlement response', async () => {
      rpc.mockResolvedValue({
        data: {
          call_id: 'call-1',
          caller_id: 'caller-1',
          creator_id: 'creator-1',
          status: 'ended',
          duration_seconds: 120,
          coins_spent: 20,
          creator_share: 14,
          coin_transaction_id: 'tx-1',
          balance_before: 100,
          balance_after: 80,
          already_ended: false,
          idempotent_replay: false,
        },
        error: null,
      });

      const result = await service.endCallBilling({
        callId: 'call-1',
        actorUserId: 'caller-1',
        durationSeconds: 120,
        idempotencyKey: 'end-idem-1',
      });

      expect(result.coinsSpent).toBe(20);
      expect(result.balanceAfter).toBe(80);
      expect(rpc).toHaveBeenCalledWith(
        'end_call_billing',
        expect.objectContaining({
          p_idempotency_key: 'end-idem-1',
          p_duration_seconds: 120,
        }),
      );
    });

    it('returns idempotent replay without error', async () => {
      rpc.mockResolvedValue({
        data: {
          call_id: 'call-1',
          caller_id: 'caller-1',
          creator_id: 'creator-1',
          status: 'ended',
          duration_seconds: 120,
          coins_spent: 20,
          creator_share: 14,
          already_ended: true,
          idempotent_replay: true,
        },
        error: null,
      });

      const result = await service.endCallBilling({
        callId: 'call-1',
        actorUserId: 'caller-1',
        durationSeconds: 120,
        idempotencyKey: 'end-idem-dup',
      });

      expect(result.idempotentReplay).toBe(true);
      expect(result.alreadyEnded).toBe(true);
    });

    it('throws 402 on insufficient_balance (fail closed)', async () => {
      rpc.mockResolvedValue({
        data: null,
        error: { message: 'insufficient_balance', code: 'P0001' },
      });

      await expect(
        service.endCallBilling({
          callId: 'call-1',
          actorUserId: 'caller-1',
          durationSeconds: 600,
          idempotencyKey: 'end-insufficient',
        }),
      ).rejects.toBeInstanceOf(HttpException);
    });

    it('throws ConflictException on CAS conflict (race)', async () => {
      rpc.mockResolvedValue({
        data: null,
        error: { message: 'call_billing_cas_conflict' },
      });

      await expect(
        service.endCallBilling({
          callId: 'call-1',
          actorUserId: 'caller-1',
          durationSeconds: 60,
          idempotencyKey: 'end-race',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException when call missing', async () => {
      rpc.mockResolvedValue({
        data: null,
        error: { message: 'call_not_found' },
      });

      await expect(
        service.endCallBilling({
          callId: 'missing',
          actorUserId: 'caller-1',
          durationSeconds: 60,
          idempotencyKey: 'end-missing',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('markCallRequestMissed', () => {
    it('marks requested call as missed', async () => {
      rpc.mockResolvedValue({
        data: {
          call_request_id: 'req-1',
          status: 'missed',
          idempotent_replay: false,
        },
        error: null,
      });

      const result = await service.markCallRequestMissed({
        callRequestId: 'req-1',
        actorUserId: 'caller-1',
      });

      expect(result.status).toBe('missed');
    });

    it('rejects accepted/active with CALL_ALREADY_ACTIVE', async () => {
      rpc.mockResolvedValue({
        data: null,
        error: { message: 'call_already_active' },
      });

      await expect(
        service.markCallRequestMissed({
          callRequestId: 'req-active',
          actorUserId: 'caller-1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns idempotent replay for already missed', async () => {
      rpc.mockResolvedValue({
        data: {
          call_request_id: 'req-2',
          status: 'missed',
          idempotent_replay: true,
        },
        error: null,
      });

      const result = await service.markCallRequestMissed({
        callRequestId: 'req-2',
        actorUserId: 'creator-1',
      });

      expect(result.idempotentReplay).toBe(true);
    });

    it('throws BadRequestException when idempotency missing from end path', async () => {
      rpc.mockResolvedValue({
        data: null,
        error: { message: 'idempotency_key_required' },
      });

      await expect(
        service.endCallBilling({
          callId: 'call-1',
          actorUserId: 'caller-1',
          durationSeconds: 60,
          idempotencyKey: '',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
