import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { assertFinancialPersistence } from '../startup/financial-guard';

export type WalletSourceType = 'payment' | 'call' | 'gift' | 'admin_adjust' | 'refund';

export type UserAdjustmentReasonCode = 'reconciliation' | 'goodwill' | 'fraud' | 'correction';

export interface UserWalletResult {
  coinTransactionId: string;
  userId: string;
  balanceBefore: number;
  balanceAfter: number;
  amount: number;
  idempotentReplay: boolean;
}

export interface AdjustUserCoinsV2Params {
  userId: string;
  delta: number;
  sourceType: WalletSourceType;
  sourceId: string;
  idempotencyKey: string;
  allowPartial?: boolean;
  adminId?: string;
}

export interface AdminAdjustUserCoinsParams {
  userId: string;
  amount: number;
  reasonCode: UserAdjustmentReasonCode;
  reasonText: string;
  adminId: string;
  adminEmail: string;
  adminRole: string;
  idempotencyKey: string;
  httpMethod?: string;
  httpPath?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AdminAdjustUserCoinsResult {
  adjustmentId: string;
  coinTransactionId: string;
  auditLogId?: string;
  userId: string;
  balanceBefore: number;
  balanceAfter: number;
  amount: number;
  direction: 'credit' | 'debit';
  idempotentReplay: boolean;
}

@Injectable()
export class UserWalletService {
  private readonly logger = new Logger(UserWalletService.name);

  constructor(private readonly supabase: SupabaseService) {}

  private mapWalletResult(row: Record<string, unknown>): UserWalletResult {
    return {
      coinTransactionId: String(row.coin_transaction_id),
      userId: String(row.user_id),
      balanceBefore: Number(row.balance_before),
      balanceAfter: Number(row.balance_after),
      amount: Number(row.amount),
      idempotentReplay: Boolean(row.idempotent_replay),
    };
  }

  private handleRpcError(error: { message?: string; code?: string; details?: string }, context: string): never {
    const msg = error.message ?? 'wallet_rpc_failed';
    this.logger.warn(`${context}: ${msg} (${error.code ?? 'no-code'})`);

    if (msg.includes('insufficient_balance') || error.code === 'P0001') {
      throw new BadRequestException('Insufficient coins balance');
    }
    if (msg.includes('idempotency_key_required')) {
      throw new BadRequestException('Idempotency key is required');
    }
    if (msg.includes('delta_must_be_non_zero') || msg.includes('amount_must_be_non_zero')) {
      throw new BadRequestException('Adjustment amount must be non-zero');
    }
    if (msg.includes('reason_text_required') || msg.includes('invalid_reason_code')) {
      throw new BadRequestException(msg);
    }

    throw new InternalServerErrorException(`Wallet operation failed: ${msg}`);
  }

  async adjustUserCoinsV2(params: AdjustUserCoinsV2Params): Promise<UserWalletResult> {
    if (!this.supabase.isConfigured) {
      assertFinancialPersistence('UserWalletService.adjustUserCoinsV2');
    }

    const { data, error } = await this.supabase.getClient().rpc('adjust_user_coins_v2', {
      p_user_id: params.userId,
      p_delta: params.delta,
      p_source_type: params.sourceType,
      p_source_id: params.sourceId,
      p_idempotency_key: params.idempotencyKey,
      p_allow_partial: params.allowPartial ?? false,
      p_admin_id: params.adminId ?? null,
    });

    if (error) {
      this.handleRpcError(error, 'adjust_user_coins_v2');
    }

    return this.mapWalletResult(data as Record<string, unknown>);
  }

  async adminAdjustUserCoins(params: AdminAdjustUserCoinsParams): Promise<AdminAdjustUserCoinsResult> {
    if (!this.supabase.isConfigured) {
      assertFinancialPersistence('UserWalletService.adminAdjustUserCoins');
    }

    const { data, error } = await this.supabase.getClient().rpc('admin_adjust_user_coins', {
      p_user_id: params.userId,
      p_amount: params.amount,
      p_reason_code: params.reasonCode,
      p_reason_text: params.reasonText,
      p_admin_id: params.adminId,
      p_admin_email: params.adminEmail,
      p_admin_role: params.adminRole,
      p_idempotency_key: params.idempotencyKey,
      p_http_method: params.httpMethod ?? 'POST',
      p_http_path: params.httpPath ?? '/api/wallets/adjust',
      p_ip_address: params.ipAddress ?? null,
      p_user_agent: params.userAgent ?? null,
    });

    if (error) {
      this.handleRpcError(error, 'admin_adjust_user_coins');
    }

    const row = data as Record<string, unknown>;
    return {
      adjustmentId: String(row.adjustment_id),
      coinTransactionId: String(row.coin_transaction_id),
      auditLogId: row.audit_log_id ? String(row.audit_log_id) : undefined,
      userId: String(row.user_id),
      balanceBefore: Number(row.balance_before),
      balanceAfter: Number(row.balance_after),
      amount: Number(row.amount),
      direction: row.direction as 'credit' | 'debit',
      idempotentReplay: Boolean(row.idempotent_replay),
    };
  }
}
