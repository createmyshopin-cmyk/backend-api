import * as crypto from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

const fetchPayment = jest.fn();

jest.mock('./razorpay-client', () => ({
  createRazorpayClient: () => ({
    payments: { fetch: fetchPayment },
  }),
}));

jest.mock('../startup/platform-config', () => ({
  getPlatformConfig: () => ({
    razorpay: { keySecret: 'test_key_secret_16chars', keyId: 'rzp_test' },
  }),
  mockPaymentsAllowed: () => false,
}));

jest.mock('../startup/financial-guard', () => ({
  assertFinancialPersistence: () => {
    throw new Error('financial persistence required');
  },
}));

describe('PaymentsService verify/refund (Sprint 4)', () => {
  const verifyRazorpayPaymentAtomic = jest.fn();
  const refundPaymentAtomic = jest.fn();
  const paymentRpc = { verifyRazorpayPaymentAtomic, refundPaymentAtomic };

  const findOne = jest.fn();
  const usersService = { findOne };

  const from = jest.fn();
  const select = jest.fn();
  const eq = jest.fn();
  const maybeSingle = jest.fn();

  const supabase = {
    isConfigured: true,
    getClient: () => ({ from }),
  };

  const missionHook = {
    onWalletRecharge: jest.fn().mockResolvedValue(undefined),
    onGiftSent: jest.fn(),
    onCallCompleted: jest.fn(),
  };

  let service: PaymentsService;

  const checkoutSignature = () =>
    crypto
      .createHmac('sha256', 'test_key_secret_16chars')
      .update('order_live|rzp_pay_live')
      .digest('hex');

  beforeEach(() => {
    jest.clearAllMocks();
    fetchPayment.mockResolvedValue({
      id: 'rzp_pay_live',
      order_id: 'order_live',
      amount: 9900,
      currency: 'INR',
      status: 'captured',
      captured: true,
    });
    service = new PaymentsService(
      usersService as never,
      supabase as never,
      paymentRpc as never,
      missionHook as never,
    );
    from.mockReturnValue({ select });
    select.mockReturnValue({ eq });
    eq.mockReturnValue({ maybeSingle });
    maybeSingle.mockResolvedValue({
      data: {
        id: 'pay-live',
        user_id: 'user-live',
        gateway_order_id: 'order_live',
        amount: 99,
        amount_paise: 9900,
        status: 'pending',
      },
    });
    verifyRazorpayPaymentAtomic.mockResolvedValue({
      paymentId: 'pay-live',
      userId: 'user-live',
      coinsAdded: 100,
      balanceAfter: 200,
      gatewayPaymentId: 'rzp_pay_live',
      coinTransactionId: 'tx-live',
      idempotentReplay: false,
    });
    findOne.mockResolvedValue({ coins: 200 });
  });

  it('requires Idempotency-Key for client verify', async () => {
    const dto = {
      razorpayOrderId: 'order_live',
      razorpayPaymentId: 'rzp_pay_live',
      razorpaySignature: checkoutSignature(),
    };

    await expect(service.verifyPayment('user-live', dto, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('fetches gateway payment before atomic credit', async () => {
    const dto = {
      razorpayOrderId: 'order_live',
      razorpayPaymentId: 'rzp_pay_live',
      razorpaySignature: checkoutSignature(),
    };

    const result = await service.verifyPayment('user-live', dto, 'verify-idem-1');

    expect(fetchPayment).toHaveBeenCalledWith('rzp_pay_live');
    expect(verifyRazorpayPaymentAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayPaymentId: 'rzp_pay_live',
        idempotencyKey: 'verify-idem-1',
        amountPaise: 9900,
      }),
    );
    expect(result.newBalance).toBe(200);
  });

  it('requires idempotency key for admin refund', async () => {
    await expect(
      service.refundPayment('pay-live', 'Duplicate charge', {
        id: 'admin-1',
        email: 'a@example.com',
        role: 'finance_admin',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('delegates refund to atomic RPC with admin audit context', async () => {
    refundPaymentAtomic.mockResolvedValue({
      refundEventId: 'ref-1',
      paymentId: 'pay-live',
      auditLogId: 'audit-1',
      coinsClawedBack: 100,
      balanceAfter: 100,
      idempotentReplay: false,
    });

    const result = await service.refundPayment(
      'pay-live',
      'Customer dispute',
      { id: 'admin-1', email: 'finance@example.com', role: 'finance_admin' } as never,
      { idempotencyKey: 'refund-key-1' },
    );

    expect(refundPaymentAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay-live',
        adminId: 'admin-1',
        idempotencyKey: 'refund-key-1',
      }),
    );
    expect(result.auditLogId).toBe('audit-1');
    expect(result.coinsDeducted).toBe(100);
  });
});
