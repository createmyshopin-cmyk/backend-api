import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreatorsService } from '../creators/creators.service';
import { WithdrawalRpcService } from './withdrawal-rpc.service';
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
} from '../creator-dashboard/pagination.util';
import { csvCell } from '../common/csv.util';
import type { AdminWithdrawalListQueryDto } from './dto/admin-withdrawal-query.dto';

const MAX_WITHDRAWAL_EXPORT_ROWS = 10_000;

export type WithdrawalStatus =
  | 'pending'
  | 'approved'
  | 'paid'
  | 'rejected'
  | 'cancelled'
  | 'failed';

export interface Withdrawal {
  id: string;
  creatorId: string;
  amount: number;
  status: WithdrawalStatus;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  upiId?: string;
  adminNotes?: string;
  paymentReference?: string;
  failureReason?: string;
  cancellationReason?: string;
  requestedAt: string;
  approvedAt?: string;
  paidAt?: string;
  rejectedAt?: string;
  failedAt?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
  idempotentReplay?: boolean;
}

@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly creatorsService: CreatorsService,
    private readonly withdrawalRpc: WithdrawalRpcService,
  ) {}

  async getMinWithdrawalLimit(): Promise<number> {
    if (this.supabase.isConfigured) {
      try {
        const { data, error } = await this.supabase
          .getClient()
          .from('app_settings')
          .select('min_withdrawal')
          .limit(1)
          .maybeSingle();
        if (!error && data && data.min_withdrawal !== null) {
          return Number(data.min_withdrawal);
        }
      } catch {
        /* default */
      }
    }
    return 100;
  }

  async getMyWithdrawals(creatorId: string): Promise<Withdrawal[]> {
    if (!this.supabase.isConfigured) {
      throw new BadRequestException('Withdrawals require Supabase');
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('withdrawals')
      .select('*')
      .eq('creator_id', creatorId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new BadRequestException(`Failed to fetch withdrawals: ${error.message}`);
    }
    return (data ?? []).map((row) => this.mapDbRowToWithdrawal(row));
  }

  async getCreatorBalance(creatorId: string) {
    const wallet = await this.creatorsService.getWalletBalance(creatorId);
    return {
      availableBalance: wallet.availableBalance,
      lockedBalance: wallet.lockedBalance ?? 0,
      totalEarned: wallet.totalEarned,
      totalWithdrawn: wallet.withdrawnAmount,
    };
  }

  async createWithdrawalRequest(
    creatorId: string,
    amount: number,
    paymentMethod: string,
    idempotencyKey: string | undefined,
    bankDetails?: {
      accountName?: string;
      accountNumber?: string;
      ifsc?: string;
    },
    upiId?: string,
  ): Promise<Withdrawal> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required for withdrawal requests');
    }

    if (paymentMethod === 'bank') {
      if (!bankDetails?.accountName || !bankDetails?.accountNumber || !bankDetails?.ifsc) {
        throw new BadRequestException('Bank account name, number, and IFSC code are required for bank payout');
      }
    } else if (paymentMethod === 'upi') {
      if (!upiId) {
        throw new BadRequestException('UPI ID is required for UPI payout');
      }
    } else {
      throw new BadRequestException('Invalid payment method. Use "upi" or "bank"');
    }

    const result = await this.withdrawalRpc.requestCreatorWithdrawal({
      creatorUserId: creatorId,
      amount,
      idempotencyKey,
      bankAccountName: bankDetails?.accountName,
      bankAccountNumber: bankDetails?.accountNumber,
      bankIfsc: bankDetails?.ifsc,
      upiId,
    });

    return this.getWithdrawalById(result.withdrawalId).then((w) => ({
      ...w,
      idempotentReplay: result.idempotentReplay,
    }));
  }

  async cancelWithdrawal(
    withdrawalId: string,
    creatorUserId: string,
    idempotencyKey: string | undefined,
    reason?: string,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const existing = await this.getWithdrawalById(withdrawalId);
    if (existing.creatorId !== creatorUserId) {
      throw new BadRequestException('You can only cancel your own withdrawal requests');
    }

    const result = await this.withdrawalRpc.cancelCreatorWithdrawal({
      withdrawalId,
      actorId: creatorUserId,
      actorType: 'creator',
      reason,
      idempotencyKey,
    });

    const withdrawal = await this.getWithdrawalById(withdrawalId);
    return { ...withdrawal, idempotentReplay: result.idempotentReplay, wallet: result.wallet };
  }

  async getAdminWithdrawals(status?: string): Promise<Withdrawal[]> {
    const result = await this.getAdminWithdrawalsPaginated({ status, limit: 50 });
    return result.items;
  }

  async getAdminWithdrawalsPaginated(query: AdminWithdrawalListQueryDto) {
    if (!this.supabase.isConfigured) {
      throw new BadRequestException('Withdrawals require Supabase');
    }

    const limit = clampLimit(query.limit);
    let dbQuery = this.supabase.getClient().from('withdrawals').select('*');

    if (query.status) dbQuery = dbQuery.eq('status', query.status);
    if (query.creatorId) dbQuery = dbQuery.eq('creator_id', query.creatorId);
    if (query.from) dbQuery = dbQuery.gte('created_at', `${query.from}T00:00:00.000Z`);
    if (query.to) dbQuery = dbQuery.lte('created_at', `${query.to}T23:59:59.999Z`);
    if (query.minAmount != null) dbQuery = dbQuery.gte('amount', query.minAmount);
    if (query.maxAmount != null) dbQuery = dbQuery.lte('amount', query.maxAmount);

    if (query.search?.trim()) {
      const term = query.search.trim().replace(/[%_,.()\\]/g, '');
      if (term) {
        dbQuery = dbQuery.or(
          `id.ilike.%${term}%,creator_id.ilike.%${term}%,payment_reference.ilike.%${term}%`,
        );
      }
    }

    if (query.cursor) {
      const { t, id } = decodeCursor(query.cursor);
      dbQuery = dbQuery.or(`created_at.lt.${t},and(created_at.eq.${t},id.lt.${id})`);
    }

    dbQuery = dbQuery.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);

    const { data, error } = await dbQuery;
    if (error) {
      throw new BadRequestException(`Failed to list withdrawals: ${error.message}`);
    }

    const rows = data ?? [];

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const last = slice[slice.length - 1];

    return {
      items: slice.map((row) => this.mapDbRowToWithdrawal(row)),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor(String(last.created_at), String(last.id))
          : null,
    };
  }

  async exportAdminWithdrawalsCsv(query: AdminWithdrawalListQueryDto): Promise<string> {
    const allItems: Withdrawal[] = [];
    let cursor: string | undefined;
    const pageSize = 50;

    while (allItems.length < MAX_WITHDRAWAL_EXPORT_ROWS) {
      const page = await this.getAdminWithdrawalsPaginated({
        ...query,
        limit: pageSize,
        cursor,
      });
      allItems.push(...page.items);
      if (!page.hasMore || !page.nextCursor) break;
      cursor = page.nextCursor;
    }

    const header = 'id,creator_id,amount,status,requested_at,paid_at,payment_reference';
    const rows = allItems.map((w) =>
      [
        csvCell(w.id),
        csvCell(w.creatorId),
        w.amount,
        csvCell(w.status),
        csvCell(w.requestedAt),
        csvCell(w.paidAt ?? ''),
        csvCell(w.paymentReference ?? ''),
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }

  async getWithdrawalById(id: string): Promise<Withdrawal> {
    if (!this.supabase.isConfigured) {
      throw new BadRequestException('Withdrawals require Supabase');
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('withdrawals')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException(`Withdrawal request with ID ${id} not found`);
    }
    return this.mapDbRowToWithdrawal(data);
  }

  async approveWithdrawal(id: string, adminId: string, idempotencyKey?: string) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    const result = await this.withdrawalRpc.approveCreatorWithdrawal({
      withdrawalId: id,
      adminId,
      idempotencyKey,
    });
    const withdrawal = await this.getWithdrawalById(id);
    return { ...withdrawal, idempotentReplay: result.idempotentReplay, wallet: result.wallet };
  }

  async rejectWithdrawal(
    id: string,
    reason: string,
    adminId: string,
    idempotencyKey?: string,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    const result = await this.withdrawalRpc.rejectCreatorWithdrawal({
      withdrawalId: id,
      adminId,
      reason,
      idempotencyKey,
    });
    const withdrawal = await this.getWithdrawalById(id);
    return { ...withdrawal, idempotentReplay: result.idempotentReplay, wallet: result.wallet };
  }

  async markWithdrawalPaid(
    id: string,
    referenceNumber: string,
    adminId: string,
    idempotencyKey?: string,
    notes?: string,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required for settlement');
    }
    const result = await this.withdrawalRpc.settleCreatorWithdrawal({
      withdrawalId: id,
      adminId,
      paymentReference: referenceNumber,
      idempotencyKey,
      adminNotes: notes,
    });
    const withdrawal = await this.getWithdrawalById(id);
    return { ...withdrawal, idempotentReplay: result.idempotentReplay, wallet: result.wallet };
  }

  async failWithdrawal(
    id: string,
    reason: string,
    adminId: string,
    idempotencyKey?: string,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    const result = await this.withdrawalRpc.failCreatorWithdrawal({
      withdrawalId: id,
      actorId: adminId,
      actorType: 'admin',
      reason,
      idempotencyKey,
    });
    const withdrawal = await this.getWithdrawalById(id);
    return { ...withdrawal, idempotentReplay: result.idempotentReplay, wallet: result.wallet };
  }

  async adminCancelWithdrawal(
    id: string,
    adminId: string,
    reason: string,
    idempotencyKey?: string,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    const result = await this.withdrawalRpc.cancelCreatorWithdrawal({
      withdrawalId: id,
      actorId: adminId,
      actorType: 'admin',
      reason,
      idempotencyKey,
    });
    const withdrawal = await this.getWithdrawalById(id);
    return { ...withdrawal, idempotentReplay: result.idempotentReplay, wallet: result.wallet };
  }

  /** @deprecated In-memory fallback removed — finance dashboard uses empty list when Supabase unavailable */
  getMemWithdrawals(): Withdrawal[] {
    return [];
  }

  private mapDbRowToWithdrawal(row: Record<string, unknown>): Withdrawal {
    return {
      id: row.id as string,
      creatorId: row.creator_id as string,
      amount: Number(row.amount),
      status: row.status as WithdrawalStatus,
      bankAccountName: (row.bank_account_name as string) || undefined,
      bankAccountNumber: (row.bank_account_number as string) || undefined,
      bankIfsc: (row.bank_ifsc as string) || undefined,
      upiId: (row.upi_id as string) || undefined,
      adminNotes: (row.admin_notes as string) || undefined,
      paymentReference: (row.payment_reference as string) || undefined,
      failureReason: (row.failure_reason as string) || undefined,
      cancellationReason: (row.cancellation_reason as string) || undefined,
      requestedAt: row.requested_at as string,
      approvedAt: (row.approved_at as string) || undefined,
      paidAt: (row.paid_at as string) || undefined,
      rejectedAt: (row.rejected_at as string) || undefined,
      failedAt: (row.failed_at as string) || undefined,
      cancelledAt: (row.cancelled_at as string) || undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
