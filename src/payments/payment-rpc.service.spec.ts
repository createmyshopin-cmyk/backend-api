import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentRpcService } from './payment-rpc.service';

describe('PaymentRpcService', () => {
  const rpc = jest.fn();
  const from = jest.fn();
  const insert = jest.fn();
  const update = jest.fn();
  const eq = jest.fn();

  const supabase = {
    isConfigured: true,
    getClient: () => ({
      rpc,
      from: (table: string) => {
        from(table);
        return { insert, update: () => ({ eq }) };
      },
    }),
  };

  const service = new PaymentRpcService(supabase as never);

  beforeEach(() => {
    jest.clearAllMocks();
    insert.mockReturnValue({ error: null });
    update.mockReturnValue({ eq });
    eq.mockResolvedValue({ error: null });
  });

  describe('verifyRazorpayPaymentAtomic', () => {
    it('maps successful verify RPC response', async () => {
      rpc.mockResolvedValue({
        data: {
          payment_id: 'pay-1',
          user_id: 'u1',
          coins_added: 100,
          balance_before: 50,
          balance_after: 150,
          coin_transaction_id: 'tx-1',
          gateway_payment_id: 'rzp_pay_1',
          idempotent_replay: false,
        },
        error: null,
      });

      const result = await service.verifyRazorpayPaymentAtomic({
        userId: 'u1',
        gatewayOrderId: 'order_1',
        gatewayPaymentId: 'rzp_pay_1',
        idempotencyKey: 'idem-1',
        amountPaise: 9900,
      });

      expect(result.coinsAdded).toBe(100);
      expect(result.idempotentReplay).toBe(false);
      expect(rpc).toHaveBeenCalledWith(
        'verify_razorpay_payment_atomic',
        expect.objectContaining({
          p_idempotency_key: 'idem-1',
          p_amount_paise: 9900,
        }),
      );
    });

    it('returns idempotent replay from RPC', async () => {
      rpc.mockResolvedValue({
        data: {
          payment_id: 'pay-1',
          user_id: 'u1',
          coins_added: 100,
          gateway_payment_id: 'rzp_pay_1',
          idempotent_replay: true,
        },
        error: null,
      });

      const result = await service.verifyRazorpayPaymentAtomic({
        userId: 'u1',
        gatewayOrderId: 'order_1',
        gatewayPaymentId: 'rzp_pay_1',
        idempotencyKey: 'idem-dup',
        amountPaise: 9900,
      });

      expect(result.idempotentReplay).toBe(true);
    });

    it('throws ConflictException on CAS conflict', async () => {
      rpc.mockResolvedValue({
        data: null,
        error: { message: 'payment_verify_cas_conflict' },
      });

      await expect(
        service.verifyRazorpayPaymentAtomic({
          userId: 'u1',
          gatewayOrderId: 'order_1',
          gatewayPaymentId: 'rzp_pay_1',
          idempotencyKey: 'idem-2',
          amountPaise: 9900,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException when payment missing', async () => {
      rpc.mockResolvedValue({
        data: null,
        error: { message: 'payment_not_found' },
      });

      await expect(
        service.verifyRazorpayPaymentAtomic({
          userId: 'u1',
          gatewayOrderId: 'missing',
          gatewayPaymentId: 'rzp_pay_1',
          idempotencyKey: 'idem-3',
          amountPaise: 9900,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('refundPaymentAtomic', () => {
    it('maps refund RPC response with audit fields', async () => {
      rpc.mockResolvedValue({
        data: {
          refund_event_id: 'ref-1',
          payment_id: 'pay-1',
          coin_transaction_id: 'tx-ref-1',
          audit_log_id: 'audit-1',
          balance_before: 150,
          balance_after: 50,
          coins_clawed_back: 100,
          idempotent_replay: false,
        },
        error: null,
      });

      const result = await service.refundPaymentAtomic({
        paymentId: 'pay-1',
        adminId: 'admin-1',
        adminEmail: 'finance@example.com',
        adminRole: 'finance_admin',
        reason: 'Customer dispute',
        idempotencyKey: 'refund-idem-1',
      });

      expect(result.coinsClawedBack).toBe(100);
      expect(result.auditLogId).toBe('audit-1');
      expect(result.idempotentReplay).toBe(false);
    });

    it('throws BadRequestException on insufficient balance', async () => {
      rpc.mockResolvedValue({
        data: null,
        error: { message: 'insufficient_balance' },
      });

      await expect(
        service.refundPaymentAtomic({
          paymentId: 'pay-1',
          reason: 'Refund',
          idempotencyKey: 'refund-idem-2',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns idempotent replay for duplicate refund key', async () => {
      rpc.mockResolvedValue({
        data: {
          refund_event_id: 'ref-existing',
          payment_id: 'pay-1',
          idempotent_replay: true,
        },
        error: null,
      });

      const result = await service.refundPaymentAtomic({
        paymentId: 'pay-1',
        reason: 'Refund',
        idempotencyKey: 'refund-idem-dup',
      });

      expect(result.idempotentReplay).toBe(true);
    });
  });

  describe('recordWebhookEvent', () => {
    it('returns inserted on first webhook event', async () => {
      insert.mockReturnValue({ error: null });

      const outcome = await service.recordWebhookEvent({
        eventId: 'evt_1',
        eventType: 'payment.captured',
        payloadHash: 'abc',
        outcome: 'ignored',
      });

      expect(outcome).toBe('inserted');
      expect(from).toHaveBeenCalledWith('gateway_webhook_events');
    });

    it('returns duplicate on unique violation (retry dedupe)', async () => {
      insert.mockReturnValue({ error: { code: '23505', message: 'duplicate' } });

      const outcome = await service.recordWebhookEvent({
        eventId: 'evt_1',
        eventType: 'payment.captured',
        payloadHash: 'abc',
        outcome: 'ignored',
      });

      expect(outcome).toBe('duplicate');
    });
  });
});
