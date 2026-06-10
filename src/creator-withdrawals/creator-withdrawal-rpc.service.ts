import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { mapWithdrawalRpcError } from './withdrawal-error.util';

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

function mapRow(row: Record<string, unknown>): WithdrawalRpcResult {
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

@Injectable()
export class CreatorWithdrawalRpcService {
  constructor(private readonly supabase: SupabaseService) {}

  private client() {
    if (!this.supabase.isConfigured) {
      throw new InternalServerErrorException('Supabase is required for creator withdrawals');
    }
    return this.supabase.getClient();
  }

  async requestCreatorWithdrawal(params: {
    creatorUserId: string;
    amount: number;
    idempotencyKey: string;
    payoutAccountId: string;
    correlationId?: string;
  }): Promise<WithdrawalRpcResult> {
    const { data, error } = await this.client().rpc('request_creator_withdrawal', {
      p_creator_user_id: params.creatorUserId,
      p_amount: params.amount,
      p_idempotency_key: params.idempotencyKey,
      p_bank_account_name: null,
      p_bank_account_number: null,
      p_bank_ifsc: null,
      p_upi_id: null,
      p_correlation_id: params.correlationId ?? null,
      p_payout_account_id: params.payoutAccountId,
    });
    if (error) mapWithdrawalRpcError(error, 'request_creator_withdrawal');
    return mapRow(data as Record<string, unknown>);
  }

  async cancelCreatorWithdrawal(params: {
    withdrawalId: string;
    actorId: string;
    reason?: string;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<WithdrawalRpcResult> {
    const { data, error } = await this.client().rpc('cancel_creator_withdrawal', {
      p_withdrawal_id: params.withdrawalId,
      p_actor_id: params.actorId,
      p_actor_type: 'creator',
      p_reason: params.reason ?? 'cancelled',
      p_idempotency_key: params.idempotencyKey,
      p_correlation_id: params.correlationId ?? null,
    });
    if (error) mapWithdrawalRpcError(error, 'cancel_creator_withdrawal');
    return mapRow(data as Record<string, unknown>);
  }
}
