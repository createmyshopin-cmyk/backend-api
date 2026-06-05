import { Injectable, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import { createRazorpayClient, RazorpayInstance } from './razorpay-client';

function sanitizeKeyId(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, '');
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
  /** After auth failure, skip Razorpay API until process restart */
  private forceMockCheckout = false;

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
        'RAZORPAY_KEY_ID invalid — must start with rzp_test_ or rzp_live_ (not zp_test_). Using mock checkout.',
      );
    }
  }

  get isConfigured(): boolean {
    return this.razorpay !== null && !this.forceMockCheckout;
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
      authFailed: this.forceMockCheckout,
      message:
        this.isConfigured
          ? 'Razorpay API keys accepted'
          : 'Using mock checkout — regenerate matching Test API keys in Razorpay Dashboard (Key ID + Secret together)',
    };
  }

  async onModuleInit(): Promise<void> {
    if (!this.razorpay) {
      if (this.keyId) {
        this.logger.warn(
          'Razorpay: no valid client — payments use mock checkout until keys are fixed',
        );
      }
      return;
    }

    try {
      await this.razorpay.orders.create({
        amount: 100,
        currency: 'INR',
        receipt: `health_${Date.now()}`.slice(0, 40),
      });
      this.forceMockCheckout = false;
      this.logger.log(`Razorpay API OK — using key ${this.keyId.slice(0, 15)}...`);
    } catch (e: unknown) {
      const msg = extractRazorpayError(e);
      this.forceMockCheckout = true;
      this.razorpay = null;
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

    // Retry real Razorpay after keys were fixed on Railway (clears stale forceMock from old deploy)
    if (this.forceMockCheckout) {
      this.forceMockCheckout = false;
      this.initClientIfPossible();
    }

    if (this.razorpay && !this.forceMockCheckout) {
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
        if (/authentication/i.test(msg)) {
          this.forceMockCheckout = true;
          this.razorpay = null;
          this.logger.warn(
            'Razorpay authentication failed — check KEY_ID and KEY_SECRET are a matching pair from the dashboard. Using mock checkout until restart.',
          );
        } else {
          this.logger.error(`Razorpay orders.create failed, falling back to mock checkout: ${msg}`);
        }
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
    this.logger.warn(`Using mock order ${gatewayOrderId} — no real Razorpay order (check API keys on Railway)`);
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
