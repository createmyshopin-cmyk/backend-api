import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { assertFinancialPersistence } from '../startup/financial-guard';

export interface WalletSnapshot {
  available: number;
  locked: number;
  withdrawn: number;
  totalEarned: number;
}

export interface WithdrawalRpcResult {
  withdrawalId: string;
  status: string;
  amount?: number;
  creatorProfileId?: string;
  creatorUserId?: string;
  ledgerEntryId?: string;
  paymentReference?: string;
  wallet?: WalletSnapshot;
  idempotentReplay: boolean;
}

function mapWallet(raw?: Record<string, unknown>): WalletSnapshot | undefined {
  if (!raw) return undefined;
  return {
    available: Number(raw.available ?? 0),
    locked: Number(raw.locked ?? 0),
    withdrawn: Number(raw.withdrawn ?? 0),
    totalEarned: Number(raw.total_earned ?? 0),
  };
}

@Injectable()
export class WithdrawalRpcService {
  private readonly logger = new Logger(WithdrawalRpcService.name);

  constructor(private readonly supabase: SupabaseService) {}

  private client() {
    if (!this.supabase.isConfigured) {
      assertFinancialPersistence('WithdrawalRpcService');
    }
    return this.supabase.getClient();
  }

  private mapRow(row: Record<string, unknown>): WithdrawalRpcResult {
    const wallet = row.wallet as Record<string, unknown> | undefined;
    return {
      withdrawalId: String(row.withdrawal_id),
      status: String(row.status),
      amount: row.amount != null ? Number(row.amount) : undefined,
      creatorProfileId: row.creator_profile_id ? String(row.creator_profile_id) : undefined,
      creatorUserId: row.creator_user_id ? String(row.creator_user_id) : undefined,
      ledgerEntryId: row.ledger_entry_id ? String(row.ledger_entry_id) : undefined,
      paymentReference: row.payment_reference ? String(row.payment_reference) : undefined,
      wallet: mapWallet(wallet),
      idempotentReplay: Boolean(row.idempotent_replay),
    };
  }

  private mapRpcError(error: { message?: string }, context: string): never {
    const msg = error.message ?? 'withdrawal_rpc_failed';
    this.logger.warn(`${context}: ${msg}`);

    if (msg.includes('withdrawal_not_found') || msg.includes('creator_profile_not_found')) {
      throw new NotFoundException(msg.includes('profile') ? 'Creator profile not found' : 'Withdrawal not found');
    }
    if (msg.includes('forbidden')) {
      throw new ForbiddenException('You do not have access to this withdrawal');
    }
    if (
      msg.includes('insufficient_available_balance') ||
      msg.includes('insufficient_balance') ||
      msg.includes('below_min_withdrawal')
    ) {
      throw new BadRequestException(msg);
    }
    if (msg.includes('inflight_withdrawal_exists') || msg.includes('withdrawal_inflight')) {
      throw new ConflictException('A withdrawal request is already in progress');
    }
    if (msg.includes('daily_limit_exceeded') || msg.includes('monthly_limit_exceeded')) {
      throw new ForbiddenException(msg);
    }
    if (msg.includes('kyc_required')) {
      throw new ForbiddenException(msg);
    }
    if (msg.includes('payout_account_missing') || msg.includes('invalid_account')) {
      throw new BadRequestException(msg);
    }
    if (msg.includes('invalid_transition') || msg.includes('withdrawal_cas_conflict')) {
      throw new ConflictException(`Withdrawal cannot be processed: ${msg}`);
    }
    if (msg.includes('idempotency_key_required') || msg.includes('reason_required') || msg.includes('payment_reference_required') || msg.includes('invalid_amount')) {
      throw new BadRequestException(msg);
    }

    throw new InternalServerErrorException(`Withdrawal operation failed: ${msg}`);
  }

  async requestCreatorWithdrawal(params: {
    creatorUserId: string;
    amount: number;
    idempotencyKey: string;
    payoutAccountId?: string;
    bankAccountName?: string;
    bankAccountNumber?: string;
    bankIfsc?: string;
    upiId?: string;
    correlationId?: string;
  }): Promise<WithdrawalRpcResult> {
    const { data, error } = await this.client().rpc('request_creator_withdrawal', {
      p_creator_user_id: params.creatorUserId,
      p_amount: params.amount,
      p_idempotency_key: params.idempotencyKey,
      p_bank_account_name: params.bankAccountName ?? null,
      p_bank_account_number: params.bankAccountNumber ?? null,
      p_bank_ifsc: params.bankIfsc ?? null,
      p_upi_id: params.upiId ?? null,
      p_correlation_id: params.correlationId ?? null,
      p_payout_account_id: params.payoutAccountId ?? null,
    });
    if (error) this.mapRpcError(error, 'request_creator_withdrawal');
    return this.mapRow(data as Record<string, unknown>);
  }

  async approveCreatorWithdrawal(params: {
    withdrawalId: string;
    adminId: string;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<WithdrawalRpcResult> {
    const { data, error } = await this.client().rpc('approve_creator_withdrawal', {
      p_withdrawal_id: params.withdrawalId,
      p_admin_id: params.adminId,
      p_idempotency_key: params.idempotencyKey,
      p_correlation_id: params.correlationId ?? null,
    });
    if (error) this.mapRpcError(error, 'approve_creator_withdrawal');
    return this.mapRow(data as Record<string, unknown>);
  }

  async rejectCreatorWithdrawal(params: {
    withdrawalId: string;
    adminId: string;
    reason: string;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<WithdrawalRpcResult> {
    const { data, error } = await this.client().rpc('reject_creator_withdrawal', {
      p_withdrawal_id: params.withdrawalId,
      p_admin_id: params.adminId,
      p_reason: params.reason,
      p_idempotency_key: params.idempotencyKey,
      p_correlation_id: params.correlationId ?? null,
    });
    if (error) this.mapRpcError(error, 'reject_creator_withdrawal');
    return this.mapRow(data as Record<string, unknown>);
  }

  async cancelCreatorWithdrawal(params: {
    withdrawalId: string;
    actorId: string;
    actorType: 'creator' | 'admin';
    reason?: string;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<WithdrawalRpcResult> {
    const { data, error } = await this.client().rpc('cancel_creator_withdrawal', {
      p_withdrawal_id: params.withdrawalId,
      p_actor_id: params.actorId,
      p_actor_type: params.actorType,
      p_reason: params.reason ?? 'cancelled',
      p_idempotency_key: params.idempotencyKey,
      p_correlation_id: params.correlationId ?? null,
    });
    if (error) this.mapRpcError(error, 'cancel_creator_withdrawal');
    return this.mapRow(data as Record<string, unknown>);
  }

  async settleCreatorWithdrawal(params: {
    withdrawalId: string;
    adminId: string;
    paymentReference: string;
    idempotencyKey: string;
    adminNotes?: string;
    correlationId?: string;
  }): Promise<WithdrawalRpcResult> {
    const { data, error } = await this.client().rpc('settle_creator_withdrawal', {
      p_withdrawal_id: params.withdrawalId,
      p_admin_id: params.adminId,
      p_payment_reference: params.paymentReference,
      p_idempotency_key: params.idempotencyKey,
      p_admin_notes: params.adminNotes ?? null,
      p_correlation_id: params.correlationId ?? null,
    });
    if (error) this.mapRpcError(error, 'settle_creator_withdrawal');
    return this.mapRow(data as Record<string, unknown>);
  }

  async failCreatorWithdrawal(params: {
    withdrawalId: string;
    actorId: string;
    actorType: 'admin' | 'webhook' | 'system';
    reason: string;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<WithdrawalRpcResult> {
    const { data, error } = await this.client().rpc('fail_creator_withdrawal', {
      p_withdrawal_id: params.withdrawalId,
      p_actor_id: params.actorId,
      p_actor_type: params.actorType,
      p_reason: params.reason,
      p_idempotency_key: params.idempotencyKey,
      p_correlation_id: params.correlationId ?? null,
    });
    if (error) this.mapRpcError(error, 'fail_creator_withdrawal');
    return this.mapRow(data as Record<string, unknown>);
  }

  async rebuildCreatorWalletFromLedger(creatorProfileId: string) {
    const { data, error } = await this.client().rpc('rebuild_creator_wallet_from_ledger', {
      p_creator_profile_id: creatorProfileId,
    });
    if (error) this.mapRpcError(error, 'rebuild_creator_wallet_from_ledger');
    return data as Record<string, unknown>;
  }
}
