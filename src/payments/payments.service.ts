import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CreatePackageDto, UpdatePackageDto, VerifyPaymentDto } from './dto/payment.dto';
import * as crypto from 'crypto';
import { createRazorpayClient, RazorpayInstance } from './razorpay-client';
import { getPlatformConfig, mockPaymentsAllowed } from '../startup/platform-config';
import { assertFinancialPersistence } from '../startup/financial-guard';
import { PaymentRpcService } from './payment-rpc.service';
import { MissionProgressHook } from '../engagement/mission-progress.hook';
import type { AdminRequestUser } from '../auth/admin-user.types';

interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  captured?: boolean;
}

// ── Domain types ──────────────────────────────────────────────────────────────

export interface CoinPackage {
  id: string;
  name: string;
  description: string | null;
  coins: number;
  bonusCoins: number;
  totalCoins: number;
  price: number;
  currency: string;
  sortOrder: number;
  enabled: boolean;
}

export interface PaymentRecord {
  id: string;
  userId: string;
  userName: string;
  packageId: string;
  amount: number;
  coins: number;
  currency: string;
  gateway: string;
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  status: 'pending' | 'success' | 'failed' | 'refunded';
  createdAt: string;
}

// ── In-memory fallback data (no-Supabase dev mode) ───────────────────────────

const SEED_PACKAGES: CoinPackage[] = [
  { id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', name: 'Starter Pack',  description: null, coins: 100,  bonusCoins: 0,    totalCoins: 100,  price: 99,   currency: 'INR', sortOrder: 1, enabled: true },
  { id: 'b2c3d4e5-f67a-8b9c-0d1e-2f3a4b5c6d7e', name: 'Value Pack',   description: null, coins: 500,  bonusCoins: 50,   totalCoins: 550,  price: 399,  currency: 'INR', sortOrder: 2, enabled: true },
  { id: 'c3d4e5f6-7a8b-9c0d-1e2f-3a4b5c6d7e8f', name: 'Popular Pack', description: null, coins: 1000, bonusCoins: 150,  totalCoins: 1150, price: 699,  currency: 'INR', sortOrder: 3, enabled: true },
  { id: 'd4e5f6a7-b8c9-0d1e-2f3a-4b5c6d7e8f9a', name: 'Pro Pack',     description: 'Best value for regular users', coins: 2500, bonusCoins: 500,  totalCoins: 3000, price: 1499, currency: 'INR', sortOrder: 4, enabled: true },
  { id: 'e5f6a7b8-c90d-1e2f-3a4b-5c6d7e8f9a0b', name: 'Mega Pack',    description: 'Maximum value — power users',  coins: 5000, bonusCoins: 1500, totalCoins: 6500, price: 2799, currency: 'INR', sortOrder: 5, enabled: true },
];

// ── Mapper helpers ────────────────────────────────────────────────────────────

function rowToPackage(row: Record<string, unknown>): CoinPackage {
  const coins      = Number(row.coins ?? 0);
  const bonusCoins = Number(row.bonus_coins ?? 0);
  return {
    id:          row.id as string,
    name:        row.name as string,
    description: (row.description as string) || null,
    coins,
    bonusCoins,
    totalCoins:  coins + bonusCoins,
    price:       Number(row.price),
    currency:    (row.currency as string) || 'INR',
    sortOrder:   Number(row.sort_order ?? 0),
    enabled:     Boolean(row.is_active),
  };
}

function rowToPayment(row: Record<string, unknown>, userName = 'Unknown'): PaymentRecord {
  return {
    id:               row.id as string,
    userId:           row.user_id as string,
    userName,
    packageId:        row.package_id as string,
    amount:           Number(row.amount),
    coins:            Number(row.coins_added),
    currency:         (row.currency as string) || 'INR',
    gateway:          row.gateway as string,
    gatewayOrderId:   row.gateway_order_id as string,
    gatewayPaymentId: (row.gateway_payment_id as string) || null,
    status:           row.status as PaymentRecord['status'],
    createdAt:        row.created_at as string,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class PaymentsService {
  /** Lazy-initialised Razorpay client — created only when real keys are present */
  private razorpay: RazorpayInstance | null = null;

  /** In-memory fallback collections (used when Supabase is not configured) */
  private memPackages: CoinPackage[]    = [...SEED_PACKAGES];
  private memPayments: PaymentRecord[]  = [];

  constructor(
    private readonly usersService: UsersService,
    private readonly supabase: SupabaseService,
    private readonly paymentRpc: PaymentRpcService,
    private readonly missionHook: MissionProgressHook,
  ) {
    this.initRazorpay();
  }

  private initRazorpay(): void {
    const { razorpay } = getPlatformConfig();
    const keyId = razorpay.keyId ?? '';
    const keySecret = razorpay.keySecret ?? '';

    if (keyId && keySecret) {
      this.razorpay = createRazorpayClient({ key_id: keyId, key_secret: keySecret });
    }
  }

  // ── Coin packages ───────────────────────────────────────────────────────────

  async getPackages(): Promise<CoinPackage[]> {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('coin_packages')
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true });

        if (!error && data) return data.map(rowToPackage);
        console.warn('[PaymentsService] getPackages DB error:', error?.message);
      } catch (e) {
        console.warn('[PaymentsService] getPackages exception:', (e as Error).message);
      }
    }
    return this.memPackages.filter(p => p.enabled);
  }

  async getPackageById(id: string): Promise<CoinPackage> {
    if (this.supabase.isConfigured) {
      const { data, error } = await this.supabase
        .getClient()
        .from('coin_packages')
        .select('*')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (error || !data) {
        throw new NotFoundException(`Coin package ${id} not found`);
      }
      return rowToPackage(data);
    }

    const pkg = this.memPackages.find(p => p.id === id && p.enabled);
    if (!pkg) throw new NotFoundException(`Coin package ${id} not found`);
    return pkg;
  }

  async createPackage(dto: CreatePackageDto): Promise<CoinPackage> {
    if (this.supabase.isConfigured) {
      const { data, error } = await this.supabase
        .getClient()
        .from('coin_packages')
        .insert({
          name:        dto.name,
          description: dto.description ?? null,
          coins:       dto.coins,
          bonus_coins: dto.bonusCoins,
          price:       dto.price,
          currency:    dto.currency ?? 'INR',
          sort_order:  dto.sortOrder ?? 0,
          is_active:   true,
        })
        .select('*')
        .single();

      if (error) throw new InternalServerErrorException(`Failed to create package: ${error.message}`);
      return rowToPackage(data);
    }

    const pkg: CoinPackage = {
      id:          `pkg_${Date.now()}`,
      name:        dto.name,
      description: dto.description ?? null,
      coins:       dto.coins,
      bonusCoins:  dto.bonusCoins,
      totalCoins:  dto.coins + dto.bonusCoins,
      price:       dto.price,
      currency:    dto.currency ?? 'INR',
      sortOrder:   dto.sortOrder ?? 0,
      enabled:     true,
    };
    this.memPackages.push(pkg);
    return pkg;
  }

  async updatePackage(id: string, dto: UpdatePackageDto): Promise<CoinPackage> {
    if (this.supabase.isConfigured) {
      const updateData: Record<string, unknown> = {};
      if (dto.name        !== undefined) updateData.name        = dto.name;
      if (dto.description !== undefined) updateData.description = dto.description;
      if (dto.coins       !== undefined) updateData.coins       = dto.coins;
      if (dto.bonusCoins  !== undefined) updateData.bonus_coins = dto.bonusCoins;
      if (dto.price       !== undefined) updateData.price       = dto.price;
      if (dto.currency    !== undefined) updateData.currency    = dto.currency;
      if (dto.sortOrder   !== undefined) updateData.sort_order  = dto.sortOrder;
      if (dto.enabled     !== undefined) updateData.is_active   = dto.enabled;
      updateData.updated_at = new Date().toISOString();

      const { data, error } = await this.supabase
        .getClient()
        .from('coin_packages')
        .update(updateData)
        .eq('id', id)
        .select('*')
        .single();

      if (error) throw new NotFoundException(`Package ${id} not found: ${error.message}`);
      return rowToPackage(data);
    }

    const pkg = this.memPackages.find(p => p.id === id);
    if (!pkg) throw new NotFoundException(`Coin package ${id} not found`);
    if (dto.name        !== undefined) pkg.name        = dto.name;
    if (dto.description !== undefined) pkg.description = dto.description;
    if (dto.coins       !== undefined) pkg.coins       = dto.coins;
    if (dto.bonusCoins  !== undefined) pkg.bonusCoins  = dto.bonusCoins;
    if (dto.price       !== undefined) pkg.price       = dto.price;
    if (dto.enabled     !== undefined) pkg.enabled     = dto.enabled;
    pkg.totalCoins = pkg.coins + pkg.bonusCoins;
    return pkg;
  }

  async deletePackage(id: string): Promise<{ message: string; packageId: string }> {
    if (this.supabase.isConfigured) {
      const { error } = await this.supabase
        .getClient()
        .from('coin_packages')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw new NotFoundException(`Package ${id} not found: ${error.message}`);
      return { message: 'Package deactivated successfully', packageId: id };
    }

    const pkg = this.memPackages.find(p => p.id === id);
    if (!pkg) throw new NotFoundException(`Coin package ${id} not found`);
    pkg.enabled = false;
    return { message: 'Package deactivated successfully', packageId: id };
  }

  // ── Payment history (admin) ─────────────────────────────────────────────────

  async getPayments(limit = 100): Promise<PaymentRecord[]> {
    if (this.supabase.isConfigured) {
      const { data, error } = await this.supabase
        .getClient()
        .from('payments')
        .select('*, users(name)')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!error && data) {
        return data.map(p => rowToPayment(p, (p.users as any)?.name ?? 'Unknown'));
      }
      console.warn('[PaymentsService] getPayments DB error:', error?.message);
    }
    return this.memPayments;
  }

  // ── Create Razorpay order ───────────────────────────────────────────────────

  async createOrder(userId: string, packageId: string) {
    // 1. Fetch and validate the package
    const pkg = await this.getPackageById(packageId);

    const amountInPaise = Math.round(pkg.price * 100); // Razorpay needs paise
    const receiptId     = `rcpt_${Date.now().toString().slice(-8)}_${packageId.slice(-4)}`;

    // 2. Create order on Razorpay gateway
    let gatewayOrderId: string;
    let gatewayOrderData: Record<string, unknown> = {};

    if (this.razorpay) {
      try {
        const order = await this.razorpay.orders.create({
          amount:   amountInPaise,
          currency: pkg.currency,
          receipt:  receiptId,
          notes:    { userId, packageId },
        });
        gatewayOrderId   = order.id;
        gatewayOrderData = order as unknown as Record<string, unknown>;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new BadRequestException(`Razorpay order creation failed: ${msg}`);
      }
    } else {
      // Dev / test mode — generate a deterministic mock order ID
      gatewayOrderId = `order_mock_${Date.now().toString().slice(-8)}`;
      gatewayOrderData = {
        id:       gatewayOrderId,
        amount:   amountInPaise,
        currency: pkg.currency,
        receipt:  receiptId,
        status:   'created',
      };
    }

    // 3. Persist a 'pending' payment record before returning to client
    const totalCoins = pkg.coins + pkg.bonusCoins;
    let savedPayment: PaymentRecord;

    if (this.supabase.isConfigured) {
      const { data, error } = await this.supabase
        .getClient()
        .from('payments')
        .insert({
          user_id:          userId,
          package_id:       pkg.id,
          gateway:          'Razorpay',
          gateway_order_id: gatewayOrderId,
          amount:           pkg.price,
          amount_paise:     amountInPaise,
          coins_added:      totalCoins,
          coins_to_credit:  totalCoins,
          currency:         pkg.currency,
          status:           'pending',
        })
        .select('*')
        .single();

      if (error) {
        throw new InternalServerErrorException(`Failed to persist payment record: ${error.message}`);
      }
      savedPayment = rowToPayment(data);
    } else {
      savedPayment = {
        id:               `pay_mem_${Date.now()}`,
        userId,
        userName:         '',
        packageId:        pkg.id,
        amount:           pkg.price,
        coins:            totalCoins,
        currency:         pkg.currency,
        gateway:          'Razorpay',
        gatewayOrderId,
        gatewayPaymentId: null,
        status:           'pending',
        createdAt:        new Date().toISOString(),
      };
      this.memPayments.unshift(savedPayment);
    }

    return {
      payment: savedPayment,
      // Return everything Flutter's Razorpay SDK needs for checkout
      razorpayOrder: {
        id:       gatewayOrderId,
        amount:   amountInPaise,
        currency: pkg.currency,
        keyId:    getPlatformConfig().razorpay.keyId ?? '',
        ...gatewayOrderData,
      },
    };
  }

  // ── Verify payment & credit coins ──────────────────────────────────────────

  async verifyPayment(
    userId: string,
    dto: VerifyPaymentDto,
    idempotencyKey?: string,
  ) {
    const allowMock = mockPaymentsAllowed();
    if (dto.paymentId && dto.transactionId && !dto.razorpaySignature) {
      if (!allowMock) {
        throw new BadRequestException(
          'Mock payment verification is disabled. Provide Razorpay signature parameters.',
        );
      }
      const pending = await this.findPaymentById(dto.paymentId);
      if (!pending || pending.userId !== userId) {
        throw new NotFoundException(`Payment record ${dto.paymentId} not found`);
      }
      return this.verifyPaymentFromGateway({
        userId,
        gatewayOrderId: pending.gatewayOrderId,
        gatewayPaymentId: dto.transactionId,
        amountPaise: Math.round(pending.amount * 100),
        idempotencyKey: idempotencyKey ?? `mock:${dto.paymentId}`,
        skipGatewayFetch: true,
      });
    }

    if (!dto.razorpayOrderId || !dto.razorpayPaymentId || !dto.razorpaySignature) {
      throw new BadRequestException(
        'Missing Razorpay verification parameters: razorpayOrderId, razorpayPaymentId, razorpaySignature are required',
      );
    }

    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required for payment verify');
    }

    this.assertValidCheckoutSignature(dto.razorpayOrderId, dto.razorpayPaymentId, dto.razorpaySignature);

    const pending = await this.findPendingPaymentByOrderId(dto.razorpayOrderId);
    if (!pending || pending.userId !== userId) {
      throw new NotFoundException(`No payment record found for order ${dto.razorpayOrderId}`);
    }

    const amountPaise =
      pending.amountPaise ?? Math.round(pending.amount * 100);

    const gatewayEntity = await this.fetchGatewayPayment(dto.razorpayPaymentId);
    this.validateGatewayEntity(gatewayEntity, dto.razorpayOrderId, amountPaise);

    return this.verifyPaymentFromGateway({
      userId,
      gatewayOrderId: dto.razorpayOrderId,
      gatewayPaymentId: dto.razorpayPaymentId,
      amountPaise,
      idempotencyKey,
      gatewayEntity,
    });
  }

  async verifyPaymentFromGateway(params: {
    userId: string;
    gatewayOrderId: string;
    gatewayPaymentId: string;
    amountPaise: number;
    idempotencyKey: string;
    gatewayEntity?: RazorpayPaymentEntity;
    skipGatewayFetch?: boolean;
  }) {
    if (!params.skipGatewayFetch && this.razorpay && params.gatewayEntity) {
      this.validateGatewayEntity(
        params.gatewayEntity,
        params.gatewayOrderId,
        params.amountPaise,
      );
    } else if (!params.skipGatewayFetch && this.razorpay) {
      const entity = await this.fetchGatewayPayment(params.gatewayPaymentId);
      this.validateGatewayEntity(entity, params.gatewayOrderId, params.amountPaise);
    }

    const result = await this.paymentRpc.verifyRazorpayPaymentAtomic({
      userId: params.userId,
      gatewayOrderId: params.gatewayOrderId,
      gatewayPaymentId: params.gatewayPaymentId,
      idempotencyKey: params.idempotencyKey,
      amountPaise: params.amountPaise,
      gatewayStatus: 'captured',
    });

    if (!result.idempotentReplay) {
      await this.missionHook.onWalletRecharge(
        params.userId,
        String(result.paymentId),
      );
    }

    const newBalance =
      result.balanceAfter ??
      (await this.usersService.findOne(params.userId)).coins;

    return {
      message: result.idempotentReplay
        ? 'Payment verify replayed (idempotent)'
        : 'Payment verified and coins credited successfully',
      idempotentReplay: result.idempotentReplay,
      payment: {
        id: result.paymentId,
        userId: result.userId,
        coinsAdded: result.coinsAdded,
        gateway: 'Razorpay',
        gatewayPaymentId: result.gatewayPaymentId,
        status: 'success',
        coinTransactionId: result.coinTransactionId,
      },
      newBalance,
    };
  }

  async refundPayment(
    paymentId: string,
    reason: string | undefined,
    admin: AdminRequestUser,
    ctx?: { idempotencyKey?: string; ip?: string; userAgent?: string },
  ) {
    if (!reason?.trim()) {
      throw new BadRequestException('Refund reason is required');
    }
    if (!ctx?.idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required for refunds');
    }

    const result = await this.paymentRpc.refundPaymentAtomic({
      paymentId,
      adminId: admin.id,
      adminEmail: admin.email,
      adminRole: admin.role,
      reason,
      idempotencyKey: ctx.idempotencyKey,
      httpPath: `/api/payments/${paymentId}/refund`,
      ipAddress: ctx?.ip,
      userAgent: ctx?.userAgent,
    });

    return {
      message: result.idempotentReplay
        ? 'Refund replayed (idempotent)'
        : 'Payment refunded and coins deducted',
      idempotentReplay: result.idempotentReplay,
      paymentId,
      refundEventId: result.refundEventId,
      auditLogId: result.auditLogId,
      coinsDeducted: result.coinsClawedBack,
      newBalance: result.balanceAfter,
    };
  }

  async findPendingPaymentByOrderId(orderId: string): Promise<{
    id: string;
    userId: string;
    gatewayOrderId: string;
    amount: number;
    amountPaise?: number;
    status: string;
  } | null> {
    if (!this.supabase.isConfigured) {
      const p = this.memPayments.find((m) => m.gatewayOrderId === orderId);
      return p
        ? {
            id: p.id,
            userId: p.userId,
            gatewayOrderId: p.gatewayOrderId,
            amount: p.amount,
            status: p.status,
          }
        : null;
    }

    const { data } = await this.supabase
      .getClient()
      .from('payments')
      .select('id, user_id, gateway_order_id, amount, amount_paise, status')
      .eq('gateway_order_id', orderId)
      .maybeSingle();

    if (!data) return null;
    return {
      id: data.id as string,
      userId: data.user_id as string,
      gatewayOrderId: data.gateway_order_id as string,
      amount: Number(data.amount),
      amountPaise: data.amount_paise != null ? Number(data.amount_paise) : undefined,
      status: data.status as string,
    };
  }

  async findPaymentByGatewayPaymentId(gatewayPaymentId: string) {
    if (!this.supabase.isConfigured) {
      const p = this.memPayments.find((m) => m.gatewayPaymentId === gatewayPaymentId);
      return p ? { id: p.id, status: p.status, userId: p.userId } : null;
    }
    const { data } = await this.supabase
      .getClient()
      .from('payments')
      .select('id, status, user_id')
      .eq('gateway_payment_id', gatewayPaymentId)
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id as string,
      status: data.status as string,
      userId: data.user_id as string,
    };
  }

  private async findPaymentById(paymentId: string) {
    if (!this.supabase.isConfigured) {
      const p = this.memPayments.find((m) => m.id === paymentId);
      return p
        ? {
            id: p.id,
            userId: p.userId,
            gatewayOrderId: p.gatewayOrderId,
            amount: p.amount,
            status: p.status,
          }
        : null;
    }
    const { data } = await this.supabase
      .getClient()
      .from('payments')
      .select('id, user_id, gateway_order_id, amount, amount_paise, status')
      .eq('id', paymentId)
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id as string,
      userId: data.user_id as string,
      gatewayOrderId: data.gateway_order_id as string,
      amount: Number(data.amount),
      amountPaise: data.amount_paise != null ? Number(data.amount_paise) : undefined,
      status: data.status as string,
    };
  }

  private assertValidCheckoutSignature(
    orderId: string,
    paymentId: string,
    signature: string,
  ): void {
    const keySecret = getPlatformConfig().razorpay.keySecret;
    if (!keySecret) {
      throw new InternalServerErrorException('Razorpay key secret not configured');
    }
    const expectedSig = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    if (signature.length !== expectedSig.length) {
      throw new BadRequestException('Razorpay payment signature is invalid');
    }
    if (!crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(signature))) {
      throw new BadRequestException('Razorpay payment signature is invalid');
    }
  }

  private async fetchGatewayPayment(paymentId: string): Promise<RazorpayPaymentEntity> {
    if (!this.razorpay) {
      if (mockPaymentsAllowed()) {
        throw new BadRequestException('Gateway fetch required — configure Razorpay keys');
      }
      throw new InternalServerErrorException('Razorpay client not configured');
    }
    const entity = (await this.razorpay.payments.fetch(paymentId)) as RazorpayPaymentEntity;
    return entity;
  }

  private validateGatewayEntity(
    entity: RazorpayPaymentEntity,
    expectedOrderId: string,
    expectedAmountPaise: number,
  ): void {
    if (entity.status !== 'captured') {
      throw new HttpException('Payment not captured at gateway', HttpStatus.PAYMENT_REQUIRED);
    }
    if (entity.order_id !== expectedOrderId) {
      throw new BadRequestException('Gateway order ID does not match payment record');
    }
    if (entity.amount !== expectedAmountPaise) {
      throw new BadRequestException('Gateway amount does not match expected payment amount');
    }
    if (entity.currency !== 'INR') {
      throw new BadRequestException('Unsupported payment currency');
    }
    if (entity.captured === false) {
      throw new HttpException('Payment not captured at gateway', HttpStatus.PAYMENT_REQUIRED);
    }
  }

  // ── Accessors (used by admin module) ───────────────────────────────────────

  getMemPayments(): PaymentRecord[] { return this.memPayments; }
}
