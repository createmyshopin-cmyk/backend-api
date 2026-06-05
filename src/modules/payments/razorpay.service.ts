import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { createRazorpayClient, RazorpayInstance } from './razorpay-client';

function isValidRazorpayKeyId(keyId: string): boolean {
  return /^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId.trim());
}

function stringifyNotes(notes: Record<string, string | number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(notes)) {
    out[key] = String(value);
  }
  return out;
}

function extractRazorpayError(e: unknown): string {
  if (e && typeof e === 'object') {
    const err = e as { error?: { description?: string; reason?: string }; statusCode?: number };
    if (err.error?.description) return err.error.description;
    if (err.error?.reason) return err.error.reason;
    if (err.statusCode) return `Razorpay HTTP ${err.statusCode}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private razorpay: RazorpayInstance | null = null;
  private keyId: string;
  private keySecret: string;

  constructor() {
    this.keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
    this.keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();

    if (
      this.keyId &&
      this.keySecret &&
      !this.keyId.startsWith('rzp_test_mock') &&
      isValidRazorpayKeyId(this.keyId)
    ) {
      this.razorpay = createRazorpayClient({
        key_id: this.keyId,
        key_secret: this.keySecret,
      });
    } else if (this.keyId && !isValidRazorpayKeyId(this.keyId)) {
      this.logger.warn(
        'RAZORPAY_KEY_ID is set but invalid (expected rzp_test_... or rzp_live_...). Using mock checkout.',
      );
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
  ): Promise<{ gatewayOrderId: string; gatewayOrderData: Record<string, unknown>; usedMock: boolean }> {
    const safeNotes = stringifyNotes(notes);
    const safeCurrency = (currency || 'INR').toUpperCase();
    const safeAmount = Math.max(100, Math.round(amountInPaise));

    if (this.razorpay) {
      try {
        const order = await this.razorpay.orders.create({
          amount: safeAmount,
          currency: safeCurrency,
          receipt: receiptId.slice(0, 40),
          notes: safeNotes,
        });
        return {
          gatewayOrderId: order.id,
          gatewayOrderData: order as unknown as Record<string, unknown>,
          usedMock: false,
        };
      } catch (e: unknown) {
        const msg = extractRazorpayError(e);
        this.logger.error(`Razorpay orders.create failed, falling back to mock checkout: ${msg}`);
        return this.createMockOrder(safeAmount, safeCurrency, receiptId);
      }
    }

    return this.createMockOrder(safeAmount, safeCurrency, receiptId);
  }

  private createMockOrder(
    amountInPaise: number,
    currency: string,
    receiptId: string,
  ): { gatewayOrderId: string; gatewayOrderData: Record<string, unknown>; usedMock: boolean } {
    const gatewayOrderId = `order_mock_${Date.now().toString().slice(-8)}`;
    return {
      gatewayOrderId,
      gatewayOrderData: {
        id: gatewayOrderId,
        amount: amountInPaise,
        currency,
        receipt: receiptId,
        status: 'created',
      },
      usedMock: true,
    };
  }

  verifySignature(orderId: string, paymentId: string, signature: string): void {
    if (!this.keySecret || this.keySecret === 'mockKeySecret' || !this.razorpay) {
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
