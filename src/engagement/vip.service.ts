import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { createRazorpayClient, RazorpayInstance } from '../payments/razorpay-client';
import { VipRpcService } from './vip-rpc.service';
import { VipSubscribeDto } from './dto/vip.dto';
import { isMissingEngagementSchema, logEngagementFallback } from './engagement-fallbacks';

const VALID_TIERS = new Set(['silver', 'gold', 'platinum']);

@Injectable()
export class VipService {
  private razorpay: RazorpayInstance | null = null;
  private readonly razorpayKeyId = process.env.RAZORPAY_KEY_ID?.trim() ?? '';
  private readonly razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET?.trim() ?? '';

  constructor(
    private readonly supabase: SupabaseService,
    private readonly vipRpc: VipRpcService,
  ) {
    if (this.razorpayKeyId && this.razorpayKeySecret) {
      this.razorpay = createRazorpayClient({
        key_id: this.razorpayKeyId,
        key_secret: this.razorpayKeySecret,
      });
    }
  }

  async getPlans() {
    if (!this.supabase.isConfigured) {
      return {
        plans: [
          {
            planId: 'mem-silver',
            tier: 'silver',
            displayName: 'Silver VIP',
            priceInr: 299,
            durationDays: 30,
            perks: { badge: 'silver', rechargeBonusPercent: 5 },
          },
        ],
      };
    }
    try {
      return await this.vipRpc.getVipPlans();
    } catch (e) {
      if (!isMissingEngagementSchema(e)) throw e;
      logEngagementFallback('getVipPlans', e);
      return { plans: [] };
    }
  }

  async getStatus(userId: string) {
    if (!this.supabase.isConfigured) {
      return { active: false, tier: null, perks: {} };
    }
    try {
      return await this.vipRpc.getVipStatus(userId);
    } catch (e) {
      if (!isMissingEngagementSchema(e)) throw e;
      logEngagementFallback('getVipStatus', e);
      return { active: false, tier: null, perks: {} };
    }
  }

  async getHistory(userId: string, limit?: number) {
    if (!this.supabase.isConfigured) {
      return { items: [] };
    }
    try {
      return await this.vipRpc.getVipHistory(userId, limit ?? 20);
    } catch (e) {
      if (!isMissingEngagementSchema(e)) throw e;
      logEngagementFallback('getVipHistory', e);
      return { items: [] };
    }
  }

  async subscribe(userId: string, dto: VipSubscribeDto, idempotencyKey: string) {
    if (!VALID_TIERS.has(dto.tier)) {
      throw new BadRequestException('Invalid VIP tier');
    }

    if (dto.razorpayPaymentId && dto.membershipId && dto.razorpayOrderId) {
      return this.verifyAndActivate(userId, dto, idempotencyKey);
    }

    return this.initiateSubscription(userId, dto, idempotencyKey);
  }

  private async initiateSubscription(
    userId: string,
    dto: VipSubscribeDto,
    idempotencyKey: string,
  ) {
    const plans = await this.getPlans();
    const planList = (plans.plans as Record<string, unknown>[]) ?? [];
    const plan = planList.find(
      (p) => String(p.tier) === dto.tier,
    );
    if (!plan) {
      throw new NotFoundException('VIP plan not found');
    }

    const priceInr = Number(plan.priceInr ?? plan.price_inr ?? 0);
    const amountPaise = Math.round(priceInr * 100);
    const receiptId = `vip_${Date.now().toString().slice(-8)}_${dto.tier}`;

    let gatewayOrderId: string;
    let razorpayOrder: Record<string, unknown>;

    if (this.razorpay) {
      const order = await this.razorpay.orders.create({
        amount: amountPaise,
        currency: 'INR',
        receipt: receiptId,
        notes: { userId, tier: dto.tier, type: 'vip_subscription' },
      });
      gatewayOrderId = order.id;
      razorpayOrder = order as unknown as Record<string, unknown>;
    } else {
      gatewayOrderId = `order_vip_mock_${Date.now().toString().slice(-8)}`;
      razorpayOrder = {
        id: gatewayOrderId,
        amount: amountPaise,
        currency: 'INR',
        receipt: receiptId,
        status: 'created',
      };
    }

    if (!this.supabase.isConfigured) {
      return {
        membership: {
          membershipId: `mem-${dto.tier}`,
          status: 'pending',
          tier: dto.tier,
          gatewayOrderId,
        },
        razorpayOrder: {
          ...razorpayOrder,
          keyId: this.razorpayKeyId,
        },
      };
    }

    const initiated = await this.vipRpc.initiateSubscription({
      userId,
      tier: dto.tier,
      idempotencyKey,
      gatewayOrderId,
      amountPaise,
    });

    return {
      membership: initiated,
      razorpayOrder: {
        ...razorpayOrder,
        keyId: this.razorpayKeyId,
      },
    };
  }

  private async verifyAndActivate(
    userId: string,
    dto: VipSubscribeDto,
    idempotencyKey: string,
  ) {
    const orderId = dto.razorpayOrderId!;
    const paymentId = dto.razorpayPaymentId!;
    const membershipId = dto.membershipId!;

    if (dto.razorpaySignature) {
      this.assertCheckoutSignature(orderId, paymentId, dto.razorpaySignature);
    }

    if (!this.supabase.isConfigured) {
      return {
        status: 'active',
        membershipId,
        tier: dto.tier,
        idempotentReplay: false,
      };
    }

    return this.vipRpc.activateMembership({
      userId,
      membershipId,
      gatewayPaymentId: paymentId,
      idempotencyKey: `vip-activate:${idempotencyKey}`,
    });
  }

  private assertCheckoutSignature(
    orderId: string,
    paymentId: string,
    signature: string,
  ): void {
    const keySecret = this.razorpayKeySecret;
    if (!keySecret) return;
    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    if (expected !== signature) {
      throw new BadRequestException('Invalid Razorpay signature');
    }
  }
}
