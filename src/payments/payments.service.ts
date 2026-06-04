import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { CoinTransactionsService } from '../calls/coin-transactions.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CreatePackageDto, VerifyPaymentDto } from './dto/payment.dto';
import * as crypto from 'crypto';

export interface CoinPackage {
  id: string;
  name: string;
  coins: number;
  bonusCoins: number;
  price: number;
  enabled: boolean;
}

export interface PaymentRecord {
  id: string;
  userId: string;
  userName: string;
  amount: number;
  coins: number;
  gateway: string;
  transactionId: string;
  status: 'success' | 'failed' | 'pending' | 'refunded';
  date: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly coinTransactions: CoinTransactionsService,
    private readonly supabase: SupabaseService,
  ) {}

  private packages: CoinPackage[] = [
    { id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', name: 'Starter Pack', coins: 100, bonusCoins: 0, price: 99, enabled: true },
    { id: 'b2c3d4e5-f67a-8b9c-0d1e-2f3a4b5c6d7e', name: 'Value Pack', coins: 500, bonusCoins: 50, price: 399, enabled: true },
    { id: 'c3d4e5f6-7a8b-9c0d-1e2f-3a4b5c6d7e8f', name: 'Popular Pack', coins: 1000, bonusCoins: 150, price: 699, enabled: true }
  ];

  private payments: PaymentRecord[] = [
    { id: 'PAY001', userId: 'USR001', userName: 'Aarav Sharma', amount: 399, coins: 550, gateway: 'Razorpay', transactionId: 'pay_Nz82Bcx90P', status: 'success', date: '2026-06-03T18:00:00Z' },
    { id: 'PAY002', userId: 'USR003', userName: 'Priya Patel', amount: 699, coins: 1150, gateway: 'Razorpay', transactionId: 'pay_Oz93Ccx91Q', status: 'success', date: '2026-06-02T12:00:00Z' },
    { id: 'PAY003', userId: 'USR002', userName: 'Rohan Mehta', amount: 99, coins: 100, gateway: 'UPI', transactionId: 'upi_230918239', status: 'failed', date: '2026-06-03T19:00:00Z' },
    { id: 'PAY004', userId: 'USR001', userName: 'Aarav Sharma', amount: 399, coins: 550, gateway: 'Razorpay', transactionId: 'pay_pending_123', status: 'pending', date: '2026-06-03T21:00:00Z' }
  ];

  async getPackages(): Promise<CoinPackage[]> {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('coin_packages')
          .select('*')
          .eq('is_active', true)
          .order('price', { ascending: true });

        if (!error && data) {
          return data.map(row => ({
            id: row.id,
            name: row.name,
            coins: Number(row.coins),
            bonusCoins: Number(row.bonus_coins ?? 0),
            price: Number(row.price),
            enabled: row.is_active,
          }));
        }
        console.warn('PaymentsService.getPackages Supabase error:', error?.message);
      } catch (e) {
        console.warn('PaymentsService.getPackages exception:', (e as Error).message);
      }
    }
    return this.packages.filter(p => p.enabled);
  }

  async createPackage(dto: CreatePackageDto): Promise<CoinPackage> {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('coin_packages')
          .insert({
            name: dto.name,
            coins: dto.coins,
            bonus_coins: dto.bonusCoins,
            price: dto.price,
            is_active: true,
          })
          .select('*')
          .single();

        if (error) {
          throw new InternalServerErrorException(`Failed to create package: ${error.message}`);
        }
        return {
          id: data.id,
          name: data.name,
          coins: Number(data.coins),
          bonusCoins: Number(data.bonus_coins ?? 0),
          price: Number(data.price),
          enabled: data.is_active,
        };
      } catch (e) {
        if (e instanceof InternalServerErrorException) throw e;
        console.warn('PaymentsService.createPackage exception:', (e as Error).message);
      }
    }

    const pkg: CoinPackage = {
      id: `PKG${Date.now().toString().slice(-4)}`,
      name: dto.name,
      coins: dto.coins,
      bonusCoins: dto.bonusCoins,
      price: dto.price,
      enabled: true
    };
    this.packages.push(pkg);
    return pkg;
  }

  async getPayments(): Promise<any[]> {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('payments')
          .select('*, users(name)')
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map(p => ({
            id: p.id,
            userId: p.user_id,
            userName: p.users ? (p.users as any).name : 'Unknown User',
            amount: Number(p.amount),
            coins: Number(p.coins_added),
            gateway: p.gateway,
            transactionId: p.gateway_order_id,
            status: p.status,
            date: p.created_at,
          }));
        }
        console.warn('PaymentsService.getPayments Supabase error:', error?.message);
      } catch (e) {
        console.warn('PaymentsService.getPayments exception:', (e as Error).message);
      }
    }
    return this.payments;
  }

  async createOrder(userId: string, packageId: string) {
    let pkg: CoinPackage | undefined;

    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('coin_packages')
          .select('*')
          .eq('id', packageId)
          .eq('is_active', true)
          .single();

        if (!error && data) {
          pkg = {
            id: data.id,
            name: data.name,
            coins: Number(data.coins),
            bonusCoins: Number(data.bonus_coins ?? 0),
            price: Number(data.price),
            enabled: data.is_active,
          };
        }
      } catch (e) {
        console.warn('PaymentsService.createOrder find package exception:', (e as Error).message);
      }
    }

    if (!pkg) {
      pkg = this.packages.find(p => p.id === packageId && p.enabled);
    }

    if (!pkg) {
      throw new NotFoundException(`Coin package with ID ${packageId} not found`);
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const amountInPaise = Math.round(pkg.price * 100);
    const receiptId = `rcpt_${Date.now().toString().slice(-6)}_${packageId.slice(-4)}`;

    let gatewayOrderId = `order_mock_${Date.now().toString().slice(-6)}`;

    // Call Razorpay Order API if real keys are configured
    if (keyId && keySecret && !keyId.startsWith('rzp_test_mock')) {
      try {
        const response = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
          },
          body: JSON.stringify({
            amount: amountInPaise,
            currency: 'INR',
            receipt: receiptId,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Razorpay responded with ${response.status}: ${errText}`);
        }

        const orderData = await response.json() as any;
        gatewayOrderId = orderData.id;
      } catch (e) {
        throw new BadRequestException(`Failed to create order on Razorpay gateway: ${(e as Error).message}`);
      }
    }

    const totalCoins = pkg.coins + pkg.bonusCoins;
    let savedPayment: any;

    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('payments')
          .insert({
            user_id: userId,
            package_id: pkg.id,
            gateway: 'Razorpay',
            gateway_order_id: gatewayOrderId,
            amount: pkg.price,
            coins_added: totalCoins,
            status: 'pending',
          })
          .select('*')
          .single();

        if (error) {
          throw new InternalServerErrorException(`Failed to save pending payment record: ${error.message}`);
        }

        savedPayment = {
          id: data.id,
          userId: data.user_id,
          packageId: data.package_id,
          gateway: data.gateway,
          gatewayOrderId: data.gateway_order_id,
          amount: Number(data.amount),
          coinsAdded: Number(data.coins_added),
          status: data.status,
          createdAt: data.created_at,
        };
      } catch (e) {
        if (e instanceof InternalServerErrorException) throw e;
        throw new InternalServerErrorException(`Failed to initialize payment: ${(e as Error).message}`);
      }
    } else {
      const mockRecord: PaymentRecord = {
        id: `PAY${Date.now().toString().slice(-4)}`,
        userId: userId,
        userName: 'Local User',
        amount: pkg.price,
        coins: totalCoins,
        gateway: 'Razorpay',
        transactionId: gatewayOrderId,
        status: 'pending',
        date: new Date().toISOString(),
      };
      this.payments.push(mockRecord);
      savedPayment = {
        id: mockRecord.id,
        userId: mockRecord.userId,
        packageId: pkg.id,
        gateway: mockRecord.gateway,
        gatewayOrderId: mockRecord.transactionId,
        amount: mockRecord.amount,
        coinsAdded: mockRecord.coins,
        status: mockRecord.status,
        createdAt: mockRecord.date,
      };
    }

    return {
      payment: savedPayment,
      razorpayOrder: {
        id: gatewayOrderId,
        amount: amountInPaise,
        currency: 'INR',
        keyId: keyId || 'rzp_test_mockKeyId123',
      },
    };
  }

  async verifyPayment(dto: VerifyPaymentDto) {
    // ── App / mock checkout (paymentId + transactionId, no Razorpay signature) ──
    if (dto.paymentId && dto.transactionId && !dto.razorpaySignature) {
      return this.completePendingPayment(dto.paymentId, dto.transactionId);
    }

    // ── Razorpay Signature Flow ──────────────────────────────────────────────
    if (!dto.razorpayOrderId || !dto.razorpayPaymentId || !dto.razorpaySignature) {
      throw new BadRequestException('Missing Razorpay payment verification parameters');
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET || 'mockKeySecret4567890';
    const text = `${dto.razorpayOrderId}|${dto.razorpayPaymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(text)
      .digest('hex');

    if (expectedSignature !== dto.razorpaySignature) {
      throw new BadRequestException('Invalid Razorpay payment signature');
    }

    let paymentRecord: any;

    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('payments')
          .select('*')
          .eq('gateway_order_id', dto.razorpayOrderId)
          .single();

        if (error || !data) {
          throw new NotFoundException(`Payment record not found for order ID ${dto.razorpayOrderId}`);
        }

        if (data.status !== 'pending') {
          throw new BadRequestException(`Payment has already been processed (status: ${data.status})`);
        }

        paymentRecord = data;
      } catch (e) {
        if (e instanceof NotFoundException || e instanceof BadRequestException) throw e;
        throw new InternalServerErrorException(`Database query failed during verification: ${(e as Error).message}`);
      }
    } else {
      const memPayment = this.payments.find(p => p.transactionId === dto.razorpayOrderId);
      if (!memPayment) {
        throw new NotFoundException(`Payment record not found for order ID ${dto.razorpayOrderId}`);
      }

      if (memPayment.status !== 'pending') {
        throw new BadRequestException(`Payment has already been processed (status: ${memPayment.status})`);
      }

      paymentRecord = memPayment;
    }

    const userId = paymentRecord.user_id || paymentRecord.userId;
    const coinsAdded = Number(paymentRecord.coins_added || paymentRecord.coins);

    const user = await this.usersService.findOne(userId);
    const balanceBefore = user.coins;

    // Credit coins & Sync Wallet (automatic DB trigger)
    const updatedUser = await this.usersService.updateCoins(userId, coinsAdded);

    // Update payment record in database
    if (this.supabase.isConfigured) {
      try {
        const { error } = await this.supabase
          .getClient()
          .from('payments')
          .update({
            status: 'success',
          })
          .eq('id', paymentRecord.id);

        if (error) {
          console.warn('Failed to update payment record status in DB:', error.message);
        }
      } catch (e) {
        console.warn('PaymentsService.verifyPayment update status exception:', (e as Error).message);
      }
      
      paymentRecord.status = 'success';
    } else {
      paymentRecord.status = 'success';
      paymentRecord.transactionId = dto.razorpayPaymentId;
    }

    // Ledger record creation
    await this.coinTransactions.recordRecharge({
      userId,
      coinsAdded,
      balanceBefore,
      balanceAfter: updatedUser.coins,
      paymentId: paymentRecord.id,
      gateway: 'Razorpay',
    });

    return {
      message: 'Payment verified and coins credited successfully',
      payment: {
        id: paymentRecord.id,
        userId,
        amount: Number(paymentRecord.amount),
        coins: coinsAdded,
        gateway: 'Razorpay',
        transactionId: dto.razorpayPaymentId,
        status: 'success',
      },
    };
  }

  /** Credits coins for a pending payment row (mobile mock checkout or admin verify). */
  private async completePendingPayment(paymentId: string, transactionId: string) {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('payments')
          .select('*')
          .eq('id', paymentId)
          .single();

        if (error || !data) {
          throw new NotFoundException(`Payment record ${paymentId} not found`);
        }

        if (data.status !== 'pending') {
          throw new BadRequestException(
            `Payment has already been processed (status: ${data.status})`,
          );
        }

        const userId = data.user_id as string;
        const coinsAdded = Number(data.coins_added);

        const user = await this.usersService.findOne(userId);
        const balanceBefore = user.coins;
        const updatedUser = await this.usersService.updateCoins(userId, coinsAdded);

        const { error: updateErr } = await this.supabase
          .getClient()
          .from('payments')
          .update({ status: 'success' })
          .eq('id', paymentId);

        if (updateErr) {
          console.warn('completePendingPayment update error:', updateErr.message);
        }

        await this.coinTransactions.recordRecharge({
          userId,
          coinsAdded,
          balanceBefore,
          balanceAfter: updatedUser.coins,
          paymentId,
          gateway: (data.gateway as string) || 'Razorpay',
        });

        return {
          message: 'Payment verified and coins credited successfully',
          payment: {
            id: paymentId,
            userId,
            amount: Number(data.amount),
            coins: coinsAdded,
            gateway: data.gateway,
            transactionId,
            status: 'success',
          },
          newBalance: updatedUser.coins,
        };
      } catch (e) {
        if (
          e instanceof NotFoundException ||
          e instanceof BadRequestException
        ) {
          throw e;
        }
        console.warn('completePendingPayment Supabase error:', (e as Error).message);
      }
    }

    const payment = this.payments.find((p) => p.id === paymentId);
    if (!payment) {
      throw new NotFoundException(`Payment record ${paymentId} not found`);
    }

    if (payment.status !== 'pending') {
      throw new BadRequestException('Payment has already been processed');
    }

    payment.transactionId = transactionId;
    payment.status = 'success';

    const user = await this.usersService.findOne(payment.userId);
    const balanceBefore = user.coins;
    const updatedUser = await this.usersService.updateCoins(
      payment.userId,
      payment.coins,
    );

    await this.coinTransactions.recordRecharge({
      userId: payment.userId,
      coinsAdded: payment.coins,
      balanceBefore,
      balanceAfter: updatedUser.coins,
      paymentId: payment.id,
      gateway: payment.gateway,
    });

    return {
      message: 'Payment verified and coins credited successfully',
      payment,
      newBalance: updatedUser.coins,
    };
  }

  async refundPayment(paymentId: string, reason?: string) {
    let paymentRecord: any;

    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('payments')
          .select('*')
          .eq('id', paymentId)
          .single();

        if (error || !data) {
          throw new NotFoundException(`Payment record ${paymentId} not found`);
        }

        if (data.status !== 'success') {
          throw new BadRequestException('Only successful payments can be refunded');
        }

        paymentRecord = {
          id: data.id,
          userId: data.user_id,
          coins: Number(data.coins_added),
          status: data.status,
          gateway: data.gateway,
        };
      } catch (e) {
        if (e instanceof NotFoundException || e instanceof BadRequestException) throw e;
        throw new InternalServerErrorException(`Database query failed: ${(e as Error).message}`);
      }
    } else {
      const memPayment = this.payments.find(p => p.id === paymentId);
      if (!memPayment) {
        throw new NotFoundException(`Payment record ${paymentId} not found`);
      }

      if (memPayment.status !== 'success') {
        throw new BadRequestException('Only successful payments can be refunded');
      }

      paymentRecord = memPayment;
    }

    const userId = paymentRecord.userId || paymentRecord.user_id;
    const coinsToDeduct = Number(paymentRecord.coins);

    const user = await this.usersService.findOne(userId);
    const balanceBefore = user.coins;

    // Deduct coins & Sync Wallet (automatic DB trigger)
    const updatedUser = await this.usersService.updateCoins(userId, -coinsToDeduct);

    // Ledger record creation
    await this.coinTransactions.recordRefund({
      userId,
      coinsRefunded: coinsToDeduct,
      balanceBefore,
      balanceAfter: updatedUser.coins,
      referenceId: paymentRecord.id,
      reason: reason ?? `Refund for payment ${paymentRecord.id}`,
    });

    if (this.supabase.isConfigured) {
      try {
        const { error } = await this.supabase
          .getClient()
          .from('payments')
          .update({ status: 'refunded' })
          .eq('id', paymentId);

        if (error) {
          console.warn('Failed to update status in DB for refund:', error.message);
        }
      } catch (e) {
        console.warn('PaymentsService.refundPayment update status exception:', (e as Error).message);
      }
      
      paymentRecord.status = 'refunded';
    } else {
      paymentRecord.status = 'failed';
    }

    return {
      message: 'Payment refunded and coins deducted',
      payment: paymentRecord,
    };
  }

  async updatePackage(id: string, dto: CreatePackageDto): Promise<CoinPackage> {
    if (this.supabase.isConfigured) {
      try {
        const updateData: any = {
          name: dto.name,
          coins: dto.coins,
          bonus_coins: dto.bonusCoins,
          price: dto.price,
        };
        if (dto.enabled !== undefined) {
          updateData.is_active = dto.enabled;
        }

        const { data, error } = await this.supabase
          .getClient()
          .from('coin_packages')
          .update(updateData)
          .eq('id', id)
          .select('*')
          .single();

        if (error) {
          throw new NotFoundException(`Package ${id} not found or update failed: ${error.message}`);
        }
        return {
          id: data.id,
          name: data.name,
          coins: Number(data.coins),
          bonusCoins: Number(data.bonus_coins ?? 0),
          price: Number(data.price),
          enabled: data.is_active,
        };
      } catch (e) {
        if (e instanceof NotFoundException) throw e;
        console.warn('PaymentsService.updatePackage exception:', (e as Error).message);
      }
    }

    const pkg = this.packages.find(p => p.id === id);
    if (!pkg) {
      throw new NotFoundException(`Coin package with ID ${id} not found`);
    }
    pkg.name = dto.name;
    pkg.coins = dto.coins;
    pkg.bonusCoins = dto.bonusCoins;
    pkg.price = dto.price;
    if (dto.enabled !== undefined) {
      pkg.enabled = dto.enabled;
    }
    return pkg;
  }

  async deletePackage(id: string) {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('coin_packages')
          .update({ is_active: false })
          .eq('id', id)
          .select('*')
          .single();

        if (error) {
          throw new NotFoundException(`Package ${id} not found or delete failed: ${error.message}`);
        }
        return { message: 'Package deactivated successfully', packageId: id };
      } catch (e) {
        if (e instanceof NotFoundException) throw e;
        console.warn('PaymentsService.deletePackage exception:', (e as Error).message);
      }
    }

    const index = this.packages.findIndex(p => p.id === id);
    if (index === -1) {
      throw new NotFoundException(`Coin package with ID ${id} not found`);
    }
    this.packages[index].enabled = false;
    return { message: 'Package deactivated successfully', packageId: id };
  }

  getMemPayments(): PaymentRecord[] {
    return this.payments;
  }
}

