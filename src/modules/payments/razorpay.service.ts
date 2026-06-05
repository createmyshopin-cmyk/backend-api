import { Injectable, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';

@Injectable()
export class RazorpayService {
  private razorpay: Razorpay | null = null;
  private keyId: string;
  private keySecret: string;

  constructor() {
    this.keyId = process.env.RAZORPAY_KEY_ID || '';
    this.keySecret = process.env.RAZORPAY_KEY_SECRET || '';

    if (this.keyId && this.keySecret && !this.keyId.startsWith('rzp_test_mock')) {
      this.razorpay = new Razorpay({ key_id: this.keyId, key_secret: this.keySecret });
    }
  }

  get isConfigured(): boolean {
    return this.razorpay !== null;
  }

  getKeyId(): string {
    return this.keyId || 'rzp_test_mockKeyId';
  }

  async createOrder(
    amountInPaise: number,
    currency: string,
    receiptId: string,
    notes: Record<string, string | number>,
  ): Promise<{ gatewayOrderId: string; gatewayOrderData: Record<string, unknown> }> {
    if (this.razorpay) {
      try {
        const order = await this.razorpay.orders.create({
          amount: amountInPaise,
          currency: currency,
          receipt: receiptId,
          notes: notes,
        });
        return {
          gatewayOrderId: order.id,
          gatewayOrderData: order as unknown as Record<string, unknown>,
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new BadRequestException(`Razorpay order creation failed: ${msg}`);
      }
    } else {
      // Dev / test mode — generate a deterministic mock order ID
      const gatewayOrderId = `order_mock_${Date.now().toString().slice(-8)}`;
      return {
        gatewayOrderId,
        gatewayOrderData: {
          id: gatewayOrderId,
          amount: amountInPaise,
          currency: currency,
          receipt: receiptId,
          status: 'created',
        },
      };
    }
  }

  verifySignature(orderId: string, paymentId: string, signature: string): void {
    if (!this.keySecret || this.keySecret === 'mockKeySecret') {
      // Dev mode: accept any signature
      console.warn('[RazorpayService] RAZORPAY_KEY_SECRET not set — skipping signature check (dev mode)');
      return;
    }

    const expectedSig = crypto
      .createHmac('sha256', this.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(signature))) {
      throw new BadRequestException('Razorpay payment signature is invalid');
    }
  }
}
