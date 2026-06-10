import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { getPlatformConfig } from '../startup/platform-config';
import { PaymentRpcService } from './payment-rpc.service';
import { PaymentsService } from './payments.service';

const STALE_WINDOW_MS = 15 * 60 * 1000;

export interface RazorpayWebhookPayload {
  event?: string;
  created_at?: number;
  payload?: Record<string, { entity?: Record<string, unknown> }>;
}

@Injectable()
export class RazorpayWebhookService {
  private readonly logger = new Logger(RazorpayWebhookService.name);

  constructor(
    private readonly paymentRpc: PaymentRpcService,
    private readonly paymentsService: PaymentsService,
  ) {}

  verifySignature(rawBody: Buffer | string, signature: string | undefined): void {
    const secret = getPlatformConfig().razorpay.webhookSecret;
    if (!secret) {
      throw new BadRequestException('Webhook secret not configured');
    }
    if (!signature) {
      throw new UnauthorizedException('Missing X-Razorpay-Signature');
    }

    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');

    if (signature.length !== expected.length) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    if (!crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'))) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  private assertNotStale(createdAt?: number): void {
    if (!createdAt) return;
    const eventMs = createdAt * 1000;
    if (Date.now() - eventMs > STALE_WINDOW_MS) {
      throw new BadRequestException('Webhook event too stale');
    }
  }

  async handle(rawBody: Buffer | string, signature: string | undefined): Promise<{ status: string }> {
    this.verifySignature(rawBody, signature);

    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const payload = JSON.parse(bodyStr) as RazorpayWebhookPayload;
    const eventType = payload.event ?? 'unknown';
    const eventId =
      (payload as { id?: string }).id ??
      crypto.createHash('sha256').update(bodyStr).digest('hex');

    this.assertNotStale(payload.created_at);

    const payloadHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
    const dedupe = await this.paymentRpc.recordWebhookEvent({
      eventId,
      eventType,
      payloadHash,
      outcome: 'ignored',
    });

    if (dedupe === 'duplicate') {
      this.logger.log(`Duplicate webhook ignored: ${eventId}`);
      return { status: 'duplicate_ignored' };
    }

    try {
      switch (eventType) {
        case 'payment.captured':
          await this.handlePaymentCaptured(payload, eventId);
          break;
        case 'payment.failed':
          await this.handlePaymentFailed(payload);
          break;
        case 'refund.processed':
          await this.handleRefundProcessed(payload, eventId);
          break;
        default:
          this.logger.log(`Unhandled webhook event: ${eventType}`);
      }
      await this.paymentRpc.updateWebhookEventOutcome(eventId, 'processed');
      return { status: 'processed' };
    } catch (e) {
      await this.paymentRpc
        .updateWebhookEventOutcome(eventId, 'error', (e as Error).message)
        .catch(() => undefined);
      throw e;
    }
  }

  private async handlePaymentCaptured(payload: RazorpayWebhookPayload, eventId: string) {
    const entity = payload.payload?.payment?.entity;
    if (!entity) return;

    const orderId = String(entity.order_id ?? '');
    const paymentId = String(entity.id ?? '');
    const amountPaise = Number(entity.amount ?? 0);

    if (!orderId || !paymentId) return;

    const pending = await this.paymentsService.findPendingPaymentByOrderId(orderId);
    if (!pending) {
      this.logger.warn(`payment.captured: no pending payment for order ${orderId}`);
      return;
    }

    await this.paymentsService.verifyPaymentFromGateway({
      userId: pending.userId,
      gatewayOrderId: orderId,
      gatewayPaymentId: paymentId,
      amountPaise,
      idempotencyKey: `webhook:${eventId}`,
    });
  }

  private async handlePaymentFailed(payload: RazorpayWebhookPayload) {
    const entity = payload.payload?.payment?.entity;
    if (!entity) return;
    const orderId = String(entity.order_id ?? '');
    const paymentId = entity.id ? String(entity.id) : undefined;
    if (!orderId) return;
    await this.paymentRpc.markPaymentFailedAtomic(orderId, paymentId);
  }

  private async handleRefundProcessed(payload: RazorpayWebhookPayload, eventId: string) {
    const entity = payload.payload?.refund?.entity;
    if (!entity) return;

    const gatewayPaymentId = String(entity.payment_id ?? '');
    const razorpayRefundId = String(entity.id ?? '');
    if (!gatewayPaymentId) return;

    const payment = await this.paymentsService.findPaymentByGatewayPaymentId(gatewayPaymentId);
    if (!payment) {
      this.logger.warn(`refund.processed: payment not found for ${gatewayPaymentId}`);
      return;
    }

    if (payment.status === 'refunded') return;

    await this.paymentRpc.refundPaymentAtomic({
      paymentId: payment.id,
      reason: 'Razorpay refund.processed webhook confirmation',
      idempotencyKey: `webhook-refund:${eventId}`,
      razorpayRefundId,
    });
  }
}
