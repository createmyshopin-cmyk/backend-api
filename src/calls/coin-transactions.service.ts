import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export type CoinTransactionType =
  | 'call_deduction'
  | 'recharge'
  | 'admin_adjustment_add'
  | 'admin_adjustment_deduct'
  | 'refund';

export interface CoinTransactionRecord {
  id: string;
  userId: string;
  type: CoinTransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceId?: string;
  description?: string;
  createdAt: string;
}

interface RecordParams {
  userId: string;
  type: CoinTransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceId?: string;
  description?: string;
}

@Injectable()
export class CoinTransactionsService {
  private readonly memTransactions: CoinTransactionRecord[] = [];

  constructor(private readonly supabase: SupabaseService) {}

  async record(params: RecordParams): Promise<CoinTransactionRecord | null> {
    const row = {
      user_id: params.userId,
      type: params.type,
      amount: params.amount,
      balance_before: params.balanceBefore,
      balance_after: params.balanceAfter,
      reference_id: params.referenceId ?? null,
      description: params.description ?? null,
    };

    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('coin_transactions')
          .insert(row)
          .select('*')
          .single();

        if (error) {
          console.warn(`CoinTransactionsService.record(${params.type}):`, error.message);
          return null;
        }

        return this.rowToRecord(data as Record<string, unknown>);
      } catch (e) {
        console.warn(
          `CoinTransactionsService.record(${params.type}) exception:`,
          (e as Error).message,
        );
        return null;
      }
    }

    const txn: CoinTransactionRecord = {
      id: `TXN${Date.now().toString().slice(-6)}`,
      userId: params.userId,
      type: params.type,
      amount: params.amount,
      balanceBefore: params.balanceBefore,
      balanceAfter: params.balanceAfter,
      referenceId: params.referenceId,
      description: params.description,
      createdAt: new Date().toISOString(),
    };
    this.memTransactions.unshift(txn);
    return txn;
  }

  recordCallDeduction(params: {
    userId: string;
    callId: string;
    coinsSpent: number;
    balanceBefore: number;
    balanceAfter: number;
    durationSeconds: number;
  }) {
    return this.record({
      userId: params.userId,
      type: 'call_deduction',
      amount: -params.coinsSpent,
      balanceBefore: params.balanceBefore,
      balanceAfter: params.balanceAfter,
      referenceId: params.callId,
      description: `Call charge (${params.durationSeconds}s)`,
    });
  }

  recordRecharge(params: {
    userId: string;
    coinsAdded: number;
    balanceBefore: number;
    balanceAfter: number;
    paymentId: string;
    gateway?: string;
  }) {
    return this.record({
      userId: params.userId,
      type: 'recharge',
      amount: params.coinsAdded,
      balanceBefore: params.balanceBefore,
      balanceAfter: params.balanceAfter,
      referenceId: params.paymentId,
      description: params.gateway
        ? `Recharge via ${params.gateway}`
        : 'Coin package recharge',
    });
  }

  recordRefund(params: {
    userId: string;
    coinsRefunded: number;
    balanceBefore: number;
    balanceAfter: number;
    referenceId?: string;
    reason?: string;
  }) {
    return this.record({
      userId: params.userId,
      type: 'refund',
      amount: -Math.abs(params.coinsRefunded),
      balanceBefore: params.balanceBefore,
      balanceAfter: params.balanceAfter,
      referenceId: params.referenceId,
      description: params.reason ?? 'Coin refund',
    });
  }

  recordAdminAdjustment(params: {
    userId: string;
    delta: number;
    balanceBefore: number;
    balanceAfter: number;
    reason?: string;
  }) {
    return this.record({
      userId: params.userId,
      type: params.delta >= 0 ? 'admin_adjustment_add' : 'admin_adjustment_deduct',
      amount: params.delta,
      balanceBefore: params.balanceBefore,
      balanceAfter: params.balanceAfter,
      description: params.reason ?? 'Admin coin adjustment',
    });
  }

  private rowToRecord(row: Record<string, unknown>): CoinTransactionRecord {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      type: row.type as CoinTransactionType,
      amount: Number(row.amount),
      balanceBefore: Number(row.balance_before),
      balanceAfter: Number(row.balance_after),
      referenceId: (row.reference_id as string) || undefined,
      description: (row.description as string) || undefined,
      createdAt: (row.created_at as string) || new Date().toISOString(),
    };
  }
}
