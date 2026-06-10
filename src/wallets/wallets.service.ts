import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { UsersService } from '../users/users.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AdjustCoinsDto } from './dto/wallet.dto';
import { UserWalletService } from './user-wallet.service';
import type { AdminRequestUser } from '../auth/admin-user.types';

export interface WalletTransaction {
  id: string;
  userId: string;
  userName: string;
  type: string;
  amount: number;
  balanceAfter: number;
  date: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class WalletsService {
  constructor(
    private readonly usersService: UsersService,
    private readonly userWallet: UserWalletService,
    private readonly supabase: SupabaseService,
  ) {}

  async getBalance(userId: string) {
    const user = await this.usersService.findOne(userId);
    return {
      userId: user.id,
      name: user.name,
      coins: user.coins,
    };
  }

  async getTransactions(userId?: string) {
    if (this.supabase.isConfigured && (!userId || UUID_RE.test(userId))) {
      try {
        const client = this.supabase.getClient();
        let q = client
          .from('coin_transactions')
          .select('*, users(name, full_name)')
          .order('created_at', { ascending: false });

        if (userId) {
          q = q.eq('user_id', userId);
        }

        const { data, error } = await q.limit(100);
        if (error) throw new Error(error.message);

        return (data ?? []).map((t: Record<string, unknown>) => ({
          id: t.id,
          userId: t.user_id,
          userName:
            (t.users as { full_name?: string; name?: string })?.full_name ||
            (t.users as { name?: string })?.name ||
            'User',
          type: t.type,
          amount: t.amount,
          balanceAfter: t.balance_after,
          date: t.created_at,
        }));
      } catch (e) {
        console.warn('WalletsService.getTransactions Supabase error:', (e as Error).message);
      }
    }

    return [];
  }

  async adjustCoins(dto: AdjustCoinsDto, admin: AdminRequestUser, ctx?: {
    ip?: string;
    userAgent?: string;
    idempotencyKey?: string;
  }) {
    await this.usersService.findOne(dto.userId);

    const idempotencyKey =
      dto.idempotencyKey ??
      ctx?.idempotencyKey ??
      `admin-adjust:${admin.id}:${dto.userId}:${randomUUID()}`;

    const result = await this.userWallet.adminAdjustUserCoins({
      userId: dto.userId,
      amount: dto.amount,
      reasonCode: dto.reasonCode,
      reasonText: dto.reason,
      adminId: admin.id,
      adminEmail: admin.email,
      adminRole: admin.role,
      idempotencyKey,
      httpPath: '/api/wallets/adjust',
      ipAddress: ctx?.ip,
      userAgent: ctx?.userAgent,
    });

    const user = await this.usersService.findOne(dto.userId);

    const txn: WalletTransaction = {
      id: result.coinTransactionId,
      userId: dto.userId,
      userName: user.name,
      type: dto.amount >= 0 ? 'admin_adjustment_add' : 'admin_adjustment_deduct',
      amount: result.amount,
      balanceAfter: result.balanceAfter,
      date: new Date().toISOString(),
    };

    return {
      message: result.idempotentReplay
        ? 'Coins adjustment replayed (idempotent)'
        : 'Coins adjusted successfully',
      idempotentReplay: result.idempotentReplay,
      adjustmentId: result.adjustmentId,
      auditLogId: result.auditLogId,
      balanceBefore: result.balanceBefore,
      balanceAfter: result.balanceAfter,
      transaction: txn,
    };
  }
}
