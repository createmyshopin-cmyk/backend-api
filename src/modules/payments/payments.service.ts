import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  ConflictException,
} from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { CoinTransactionsService } from '../../calls/coin-transactions.service';
import { SupabaseService } from '../../supabase/supabase.service';
import { CreatePackageDto, UpdatePackageDto } from './dto/coin-package.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { RazorpayService } from './razorpay.service';

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
  status: 'created' | 'pending' | 'success' | 'failed' | 'refunded';
  createdAt: string;
  verifiedAt?: string;
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
    verifiedAt:       (row.verified_at as string) || undefined,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class PaymentsService {
  /** In-memory fallback collections (used when Supabase is not configured) */
  private memPackages: CoinPackage[]    = [...SEED_PACKAGES];
  private memPayments: PaymentRecord[]  = [];

  constructor(
    private readonly usersService:      UsersService,
    private readonly coinTransactions:  CoinTransactionsService,
    private readonly supabase:          SupabaseService,
    private readonly razorpayService:   RazorpayService,
  ) {}

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

    // 2. Create order on Razorpay gateway using RazorpayService
    const { gatewayOrderId, gatewayOrderData, usedMock } = await this.razorpayService.createOrder(
      amountInPaise,
      pkg.currency,
      receiptId,
      { userId, packageId },
    );

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
          coins_added:      totalCoins,
          status:           'created',
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
        status:           'created',
        createdAt:        new Date().toISOString(),
      };
      this.memPayments.unshift(savedPayment);
    }

    const mockCheckout = usedMock || !this.razorpayService.isConfigured;

    return {
      payment: savedPayment,
      /** True when Razorpay keys are missing/invalid or gateway order uses mock — app skips Razorpay SDK */
      mockCheckout,
      // Return everything Flutter's Razorpay SDK needs for checkout
      razorpayOrder: {
        id:       gatewayOrderId,
        amount:   amountInPaise,
        currency: pkg.currency,
        keyId:    mockCheckout ? 'rzp_test_mockKeyId' : this.razorpayService.getKeyId(),
        ...gatewayOrderData,
      },
    };
  }

  // ── Verify payment & credit coins ──────────────────────────────────────────

  async verifyPayment(dto: VerifyPaymentDto) {
    // ── Branch A: App-internal / mock checkout (no Razorpay signature) ────────
    // Used by dev mode or admin "manually complete" flows.
    if (dto.paymentId && dto.transactionId && !dto.razorpaySignature) {
      return this.completePendingPayment(dto.paymentId, dto.transactionId);
    }

    // ── Branch B: Full Razorpay signature verification ────────────────────────
    if (!dto.razorpayOrderId || !dto.razorpayPaymentId || !dto.razorpaySignature) {
      throw new BadRequestException(
        'Missing Razorpay verification parameters: razorpayOrderId, razorpayPaymentId, razorpaySignature are required',
      );
    }

    // 1. Cryptographic signature check — MUST happen before any DB write
    this.razorpayService.verifySignature(dto.razorpayOrderId, dto.razorpayPaymentId, dto.razorpaySignature);

    // 2. Look up the pending payment by gateway_order_id
    if (this.supabase.isConfigured) {
      return this.verifyPaymentInDb(dto.razorpayOrderId, dto.razorpayPaymentId);
    }

    // 2b. In-memory fallback
    return this.verifyPaymentInMemory(dto.razorpayOrderId, dto.razorpayPaymentId);
  }

  /**
   * Database-backed verification — atomic status transition.
   * Uses gateway_payment_id UNIQUE constraint as the final guard against
   * double-credits: if two concurrent verify calls race, only one INSERT wins.
   */
  private async verifyPaymentInDb(
    razorpayOrderId:   string,
    razorpayPaymentId: string,
  ) {
    const client = this.supabase.getClient();

    const { data, error } = await client.rpc('verify_razorpay_payment_atomic', {
      p_order_id: razorpayOrderId,
      p_payment_id: razorpayPaymentId,
    });

    if (error) {
      if (error.message.includes('payment_not_found')) {
        throw new NotFoundException(`No payment record found for order ${razorpayOrderId}`);
      }
      if (error.message.includes('duplicate_verification')) {
        throw new ConflictException('Duplicate payment verification detected — coins already credited');
      }
      if (error.message.includes('invalid_status')) {
        throw new ConflictException('Payment already processed');
      }
      throw new InternalServerErrorException(`Failed to verify payment: ${error.message}`);
    }

    if (!data) {
      throw new InternalServerErrorException('No data returned from atomic verification');
    }

    // data contains { status, payment, newBalance }
    if (data.status === 'already_verified' || data.status === 'success') {
      return this.buildSuccessResponse(data.payment, razorpayPaymentId, data.newBalance);
    }

    throw new InternalServerErrorException('Unexpected response from atomic verification');
  }

  private async verifyPaymentInMemory(gatewayOrderId: string, gatewayPaymentId: string) {
    const payment = this.memPayments.find(p => p.gatewayOrderId === gatewayOrderId);
    if (!payment) throw new NotFoundException(`No payment record for order ${gatewayOrderId}`);

    if (payment.status === 'success' && payment.gatewayPaymentId === gatewayPaymentId) {
      const user = await this.usersService.findOne(payment.userId);
      return this.buildSuccessResponse(payment, gatewayPaymentId, user.coins);
    }
    if (payment.status !== 'pending' && payment.status !== 'created') {
      throw new ConflictException(`Payment already processed (status: ${payment.status})`);
    }

    payment.status           = 'success';
    payment.gatewayPaymentId = gatewayPaymentId;

    const user        = await this.usersService.findOne(payment.userId);
    const balanceBefore = user.coins;
    const updatedUser = await this.usersService.updateCoins(payment.userId, payment.coins);

    await this.coinTransactions.recordRecharge({
      userId:       payment.userId,
      coinsAdded:   payment.coins,
      balanceBefore,
      balanceAfter: updatedUser.coins,
      paymentId:    payment.id,
      gateway:      'Razorpay',
    });

    return this.buildSuccessResponse(payment, gatewayPaymentId, updatedUser.coins);
  }

  // ── Complete pending payment (mobile mock / admin) ──────────────────────────

  private async completePendingPayment(paymentId: string, transactionId: string) {
    if (this.supabase.isConfigured) {
      const client = this.supabase.getClient();

      const { data, error } = await client
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();

      if (error || !data) throw new NotFoundException(`Payment record ${paymentId} not found`);

      const userId     = data.user_id as string;
      const coinsAdded = Number(data.coins_added);

      if (data.status === 'success') {
        const user = await this.usersService.findOne(userId);
        return this.buildSuccessResponse(data, (data.gateway_payment_id as string) || transactionId, user.coins);
      }
      if (data.status !== 'pending' && data.status !== 'created') {
        throw new BadRequestException(`Payment already processed (status: ${data.status as string})`);
      }

      const user        = await this.usersService.findOne(userId);
      const balanceBefore = user.coins;
      const updatedUser = await this.usersService.updateCoins(userId, coinsAdded);

      await client
        .from('payments')
        .update({ status: 'success', gateway_payment_id: transactionId })
        .eq('id', paymentId);

      await this.coinTransactions.recordRecharge({
        userId,
        coinsAdded,
        balanceBefore,
        balanceAfter: updatedUser.coins,
        paymentId,
        gateway: (data.gateway as string) ?? 'Razorpay',
      });

      return this.buildSuccessResponse(data, transactionId, updatedUser.coins);
    }

    // In-memory path
    const payment = this.memPayments.find(p => p.id === paymentId);
    if (!payment) throw new NotFoundException(`Payment record ${paymentId} not found`);
    if (payment.status === 'success') {
      const user = await this.usersService.findOne(payment.userId);
      return this.buildSuccessResponse(payment, payment.gatewayPaymentId || transactionId, user.coins);
    }
    if (payment.status !== 'pending' && payment.status !== 'created') {
      throw new BadRequestException(`Payment already processed (status: ${payment.status})`);
    }

    payment.status           = 'success';
    payment.gatewayPaymentId = transactionId;

    const user        = await this.usersService.findOne(payment.userId);
    const balanceBefore = user.coins;
    const updatedUser = await this.usersService.updateCoins(payment.userId, payment.coins);

    await this.coinTransactions.recordRecharge({
      userId:       payment.userId,
      coinsAdded:   payment.coins,
      balanceBefore,
      balanceAfter: updatedUser.coins,
      paymentId:    payment.id,
      gateway:      payment.gateway,
    });

    return this.buildSuccessResponse(payment, transactionId, updatedUser.coins);
  }

  // ── Refund ──────────────────────────────────────────────────────────────────

  async refundPayment(paymentId: string, reason?: string) {
    let paymentRow: Record<string, unknown>;

    if (this.supabase.isConfigured) {
      const { data, error } = await this.supabase
        .getClient()
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();

      if (error || !data) throw new NotFoundException(`Payment ${paymentId} not found`);
      if (data.status !== 'success') {
        throw new BadRequestException('Only successful payments can be refunded');
      }
      paymentRow = data;
    } else {
      const p = this.memPayments.find(m => m.id === paymentId);
      if (!p) throw new NotFoundException(`Payment ${paymentId} not found`);
      if (p.status !== 'success') throw new BadRequestException('Only successful payments can be refunded');
      paymentRow = {
        id: p.id, user_id: p.userId, coins_added: p.coins,
        amount: p.amount, gateway: p.gateway,
      };
    }

    const userId        = paymentRow.user_id as string;
    const coinsToDeduct = Number(paymentRow.coins_added);

    const user        = await this.usersService.findOne(userId);
    const balanceBefore = user.coins;
    const updatedUser = await this.usersService.updateCoins(userId, -coinsToDeduct);

    await this.coinTransactions.recordRefund({
      userId,
      coinsRefunded: coinsToDeduct,
      balanceBefore,
      balanceAfter:  updatedUser.coins,
      referenceId:   paymentId,
      reason:        reason ?? `Refund for payment ${paymentId}`,
    });

    if (this.supabase.isConfigured) {
      await this.supabase
        .getClient()
        .from('payments')
        .update({ status: 'refunded' })
        .eq('id', paymentId);
    } else {
      const p = this.memPayments.find(m => m.id === paymentId);
      if (p) p.status = 'refunded';
    }

    return {
      message:   'Payment refunded and coins deducted',
      paymentId,
      coinsDeducted: coinsToDeduct,
      newBalance: updatedUser.coins,
    };
  }

  // ── Shared response builder ─────────────────────────────────────────────────

  private buildSuccessResponse(
    payment:           Record<string, unknown> | PaymentRecord,
    gatewayPaymentId:  string,
    newBalance:        number,
  ) {
    const isRecord = (p: unknown): p is PaymentRecord =>
      typeof (p as PaymentRecord).userId === 'string';

    const id         = isRecord(payment) ? payment.id               : payment.id as string;
    const userId     = isRecord(payment) ? payment.userId           : payment.user_id as string;
    const amount     = isRecord(payment) ? payment.amount           : Number(payment.amount);
    const coinsAdded = isRecord(payment) ? payment.coins            : Number(payment.coins_added);
    const gateway    = isRecord(payment) ? payment.gateway          : payment.gateway as string;

    return {
      message: 'Payment verified and coins credited successfully',
      payment: {
        id,
        userId,
        amount,
        coinsAdded,
        gateway,
        gatewayPaymentId,
        status: 'success',
      },
      newBalance,
    };
  }

  // ── Accessors (used by admin module) ───────────────────────────────────────

  getMemPayments(): PaymentRecord[] { return this.memPayments; }
}
