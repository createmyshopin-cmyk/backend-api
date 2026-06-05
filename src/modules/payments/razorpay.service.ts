import {
  Injectable,
  BadRequestException,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { createRazorpayClient, RazorpayInstance } from './razorpay-client';

function sanitizeKeyId(raw: string): string {
  let id = raw.trim().replace(/^["']|["']$/g, '');
  // Common Railway typo: zp_test_... instead of rzp_test_...
  if (id.startsWith('zp_test_')) {
    id = `r${id}`;
  }
  return id;
}

function sanitizeKeySecret(raw: string): string {
  // Strip quotes, spaces, newlines (common copy/paste issues on Railway)
  return raw.trim().replace(/^["']|["']$/g, '').replace(/\s/g, '');
}

function isValidRazorpayKeyId(keyId: string): boolean {
  return /^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId);
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
export class RazorpayService implements OnModuleInit {
  private readonly logger = new Logger(RazorpayService.name);
  private razorpay: RazorpayInstance | null = null;
  private keyId: string;
  private keySecret: string;
  private startupCheckOk = false;

  constructor() {
    this.keyId = sanitizeKeyId(process.env.RAZORPAY_KEY_ID || '');
    this.keySecret = sanitizeKeySecret(process.env.RAZORPAY_KEY_SECRET || '');
    this.initClientIfPossible();
  }

  /** (Re)build Razorpay client when env keys look valid */
  private initClientIfPossible(): void {
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
      return;
    }
    this.razorpay = null;
    if (this.keyId && !isValidRazorpayKeyId(this.keyId)) {
      this.logger.warn(
        'RAZORPAY_KEY_ID invalid — must start with rzp_test_ or rzp_live_ (zp_test_ is auto-corrected if missing the leading r).',
      );
    }
  }

  get isConfigured(): boolean {
    return this.razorpay !== null;
  }

  getKeyId(): string {
    return this.keyId || 'rzp_test_mockKeyId';
  }

  /** For debugging — never exposes secrets */
  getGatewayStatus() {
    return {
      mode: this.isConfigured ? 'razorpay' : 'mock',
      keyIdSet: Boolean(this.keyId),
      keyIdPreview: this.keyId ? `${this.keyId.slice(0, 15)}...` : null,
      secretLength: this.keySecret.length,
      startupCheckOk: this.startupCheckOk,
      allowMock: this.allowMockCheckout(),
      message: this.isConfigured
        ? this.startupCheckOk
          ? 'Razorpay API OK'
          : 'Razorpay client ready — startup health check failed; create-order will still try'
        : 'Razorpay keys missing or invalid — set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET on Railway',
    };
  }

  async onModuleInit(): Promise<void> {
    if (!this.razorpay) {
      if (this.keyId) {
        this.logger.warn('Razorpay: no valid client — check KEY_ID format and matching KEY_SECRET on Railway');
      }
      return;
    }

    try {
      await this.razorpay.orders.create({
        amount: 100,
        currency: 'INR',
        receipt: `health_${Date.now()}`.slice(0, 40),
      });
      this.startupCheckOk = true;
      this.logger.log(`Razorpay API OK — using key ${this.keyId.slice(0, 15)}...`);
    } catch (e: unknown) {
      const msg = extractRazorpayError(e);
      this.startupCheckOk = false;
      this.logger.warn(
        `Razorpay startup check failed: ${msg}. Fix Railway RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET, then redeploy.`,
      );
    }
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

    if (!this.razorpay) {
      this.initClientIfPossible();
    }

    if (this.razorpay) {
      try {
        const order = await this.razorpay.orders.create({
          amount: safeAmount,
          currency: safeCurrency,
          receipt: receiptId.slice(0, 40),
          notes: safeNotes,
        });
        this.logger.log(`Razorpay order created: ${order.id} (${safeAmount} paise)`);
        return {
          gatewayOrderId: order.id,
          gatewayOrderData: order as unknown as Record<string, unknown>,
          usedMock: false,
        };
      } catch (e: unknown) {
        const msg = extractRazorpayError(e);
        this.logger.error(`Razorpay orders.create failed: ${msg}`);
        return this.failOrMock(`Razorpay order failed: ${msg}`, safeAmount, safeCurrency, receiptId);
      }
    }

    if (!this.keyId || !this.keySecret) {
      return this.failOrMock('Razorpay API keys are not configured.', safeAmount, safeCurrency, receiptId);
    }
    return this.failOrMock('Razorpay client is not available.', safeAmount, safeCurrency, receiptId);
  }

  private allowMockCheckout(): boolean {
    return process.env.RAZORPAY_ALLOW_MOCK === 'true';
  }

  private failOrMock(
    reason: string,
    amountInPaise: number,
    currency: string,
    receiptId: string,
  ): { gatewayOrderId: string; gatewayOrderData: Record<string, unknown>; usedMock: boolean } {
    if (!this.allowMockCheckout()) {
      throw new ServiceUnavailableException(
        `${reason} Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on Railway (rzp_test_...) and redeploy.`,
      );
    }
    return this.createMockOrder(amountInPaise, currency, receiptId);
  }

  private createMockOrder(
    amountInPaise: number,
    currency: string,
    receiptId: string,
  ): { gatewayOrderId: string; gatewayOrderData: Record<string, unknown>; usedMock: boolean } {
    const gatewayOrderId = `order_mock_${Date.now().toString().slice(-8)}`;
    this.logger.warn(`Using mock order ${gatewayOrderId} (RAZORPAY_ALLOW_MOCK=true only)`);
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
    if (orderId.startsWith('order_mock_') && this.allowMockCheckout()) {
      return;
    }
    if (!this.keySecret || this.keySecret === 'mockKeySecret') {
      throw new BadRequestException('Razorpay secret not configured — cannot verify payment');
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
