import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { RazorpayWebhookService } from './razorpay-webhook.service';

jest.mock('../startup/platform-config', () => ({
  getPlatformConfig: () => ({
    razorpay: { webhookSecret: 'test_webhook_secret_16ch' },
  }),
}));

describe('RazorpayWebhookService', () => {
  const recordWebhookEvent = jest.fn();
  const updateWebhookEventOutcome = jest.fn();
  const verifyRazorpayPaymentAtomic = jest.fn();
  const markPaymentFailedAtomic = jest.fn();
  const refundPaymentAtomic = jest.fn();

  const paymentRpc = {
    recordWebhookEvent,
    updateWebhookEventOutcome,
    verifyRazorpayPaymentAtomic,
    markPaymentFailedAtomic,
    refundPaymentAtomic,
  };

  const findPendingPaymentByOrderId = jest.fn();
  const findPaymentByGatewayPaymentId = jest.fn();
  const verifyPaymentFromGateway = jest.fn();

  const paymentsService = {
    findPendingPaymentByOrderId,
    findPaymentByGatewayPaymentId,
    verifyPaymentFromGateway,
  };

  const service = new RazorpayWebhookService(
    paymentRpc as never,
    paymentsService as never,
  );

  const sign = (body: string) =>
    crypto.createHmac('sha256', 'test_webhook_secret_16ch').update(body).digest('hex');

  beforeEach(() => {
    jest.clearAllMocks();
    recordWebhookEvent.mockResolvedValue('inserted');
    updateWebhookEventOutcome.mockResolvedValue(undefined);
  });

  it('rejects missing webhook signature', () => {
    expect(() => service.verifySignature('{}', undefined)).toThrow(UnauthorizedException);
  });

  it('rejects invalid webhook signature', () => {
    expect(() => service.verifySignature('{"event":"payment.captured"}', 'bad-sig')).toThrow(
      UnauthorizedException,
    );
  });

  it('deduplicates duplicate webhook retries', async () => {
    const body = JSON.stringify({
      id: 'evt_dup_1',
      event: 'payment.captured',
      created_at: Math.floor(Date.now() / 1000),
      payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x', amount: 100 } } },
    });

    recordWebhookEvent.mockResolvedValue('duplicate');

    const result = await service.handle(Buffer.from(body), sign(body));

    expect(result).toEqual({ status: 'duplicate_ignored' });
    expect(verifyPaymentFromGateway).not.toHaveBeenCalled();
  });

  it('processes payment.captured and credits via gateway verify path', async () => {
    const body = JSON.stringify({
      id: 'evt_cap_1',
      event: 'payment.captured',
      created_at: Math.floor(Date.now() / 1000),
      payload: {
        payment: { entity: { id: 'rzp_pay_99', order_id: 'order_99', amount: 9900 } },
      },
    });

    findPendingPaymentByOrderId.mockResolvedValue({
      id: 'internal-pay-1',
      userId: 'user-1',
      gatewayOrderId: 'order_99',
      amount: 99,
      amountPaise: 9900,
      status: 'pending',
    });
    verifyPaymentFromGateway.mockResolvedValue({ newBalance: 199 });

    const result = await service.handle(Buffer.from(body), sign(body));

    expect(result).toEqual({ status: 'processed' });
    expect(verifyPaymentFromGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        gatewayOrderId: 'order_99',
        gatewayPaymentId: 'rzp_pay_99',
        idempotencyKey: 'webhook:evt_cap_1',
      }),
    );
    expect(updateWebhookEventOutcome).toHaveBeenCalledWith('evt_cap_1', 'processed');
  });

  it('marks payment.failed via atomic RPC', async () => {
    const body = JSON.stringify({
      id: 'evt_fail_1',
      event: 'payment.failed',
      created_at: Math.floor(Date.now() / 1000),
      payload: {
        payment: { entity: { id: 'rzp_pay_fail', order_id: 'order_fail' } },
      },
    });

    const result = await service.handle(Buffer.from(body), sign(body));

    expect(result).toEqual({ status: 'processed' });
    expect(markPaymentFailedAtomic).toHaveBeenCalledWith('order_fail', 'rzp_pay_fail');
  });

  it('processes refund.processed with idempotent refund key', async () => {
    const body = JSON.stringify({
      id: 'evt_refund_1',
      event: 'refund.processed',
      created_at: Math.floor(Date.now() / 1000),
      payload: {
        refund: { entity: { id: 'rfnd_1', payment_id: 'rzp_pay_refunded' } },
      },
    });

    findPaymentByGatewayPaymentId.mockResolvedValue({
      id: 'internal-pay-refund',
      status: 'success',
      userId: 'user-2',
    });

    const result = await service.handle(Buffer.from(body), sign(body));

    expect(result).toEqual({ status: 'processed' });
    expect(refundPaymentAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'internal-pay-refund',
        idempotencyKey: 'webhook-refund:evt_refund_1',
        razorpayRefundId: 'rfnd_1',
      }),
    );
  });

  it('skips refund.processed when payment already refunded', async () => {
    const body = JSON.stringify({
      id: 'evt_refund_2',
      event: 'refund.processed',
      created_at: Math.floor(Date.now() / 1000),
      payload: {
        refund: { entity: { id: 'rfnd_2', payment_id: 'rzp_already' } },
      },
    });

    findPaymentByGatewayPaymentId.mockResolvedValue({
      id: 'internal-pay-done',
      status: 'refunded',
      userId: 'user-3',
    });

    await service.handle(Buffer.from(body), sign(body));

    expect(refundPaymentAtomic).not.toHaveBeenCalled();
  });

  it('records error outcome when handler throws (replay safety)', async () => {
    const body = JSON.stringify({
      id: 'evt_timeout_1',
      event: 'payment.captured',
      created_at: Math.floor(Date.now() / 1000),
      payload: {
        payment: { entity: { id: 'rzp_timeout', order_id: 'order_timeout', amount: 500 } },
      },
    });

    findPendingPaymentByOrderId.mockResolvedValue({
      id: 'pay-timeout',
      userId: 'user-timeout',
      gatewayOrderId: 'order_timeout',
      amount: 5,
      amountPaise: 500,
      status: 'pending',
    });
    verifyPaymentFromGateway.mockRejectedValue(new Error('gateway fetch timeout'));

    await expect(service.handle(Buffer.from(body), sign(body))).rejects.toThrow(
      'gateway fetch timeout',
    );

    expect(updateWebhookEventOutcome).toHaveBeenCalledWith(
      'evt_timeout_1',
      'error',
      'gateway fetch timeout',
    );
  });
});
