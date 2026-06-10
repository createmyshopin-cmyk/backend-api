import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreatorWithdrawalRpcService } from './creator-withdrawal-rpc.service';
import { CreatorDashboardRepository } from '../creator-dashboard/creator-dashboard.repository';
import {
  clampLimit,
  encodeCursor,
  validateDateRange,
  validateHistoryPage,
} from '../creator-dashboard/pagination.util';
import type { CreatorRequestScope } from '../creator-dashboard/creator-dashboard.types';
import type { WithdrawalHistoryQueryDto } from './dto/withdrawal-history-query.dto';
import type { WithdrawalRequestDto } from './dto/withdrawal-request.dto';
import { assertIdempotencyKey, mapWithdrawalRpcError } from './withdrawal-error.util';

const SCHEMA = '3.2.0';
const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending review',
  approved: 'Processing payout',
  paid: 'Paid',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

@Injectable()
export class CreatorWithdrawalsService {
  private readonly logger = new Logger(CreatorWithdrawalsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly withdrawalRpc: CreatorWithdrawalRpcService,
    private readonly dashboardRepo: CreatorDashboardRepository,
  ) {}

  async requestWithdrawal(
    scope: CreatorRequestScope,
    dto: WithdrawalRequestDto,
    idempotencyKey: string | undefined,
  ) {
    const key = assertIdempotencyKey(idempotencyKey);

    const result = await this.withdrawalRpc.requestCreatorWithdrawal({
      creatorUserId: scope.userId,
      amount: dto.amountInr,
      idempotencyKey: key,
      payoutAccountId: dto.payoutAccountId,
    });

    return {
      schemaVersion: SCHEMA,
      withdrawal: {
        withdrawalId: result.withdrawalId,
        amount: result.amount ?? dto.amountInr,
        currency: 'INR',
        status: result.status,
        statusLabel: STATUS_LABELS[result.status] ?? result.status,
        requestedAt: new Date().toISOString(),
        estimatedProcessingHours: 48,
        payoutAccountId: dto.payoutAccountId,
      },
      wallet: {
        availableBalance: result.wallet?.available ?? 0,
        lockedBalance: result.wallet?.locked ?? 0,
      },
      idempotentReplay: result.idempotentReplay,
    };
  }

  async cancelWithdrawal(
    scope: CreatorRequestScope,
    withdrawalId: string,
    idempotencyKey: string | undefined,
    reason?: string,
  ) {
    const key = assertIdempotencyKey(idempotencyKey);
    await this.assertWithdrawalOwned(scope, withdrawalId);

    const result = await this.withdrawalRpc.cancelCreatorWithdrawal({
      withdrawalId,
      actorId: scope.userId,
      reason,
      idempotencyKey: key,
    });

    return {
      schemaVersion: SCHEMA,
      withdrawalId,
      status: result.status,
      wallet: {
        availableBalance: result.wallet?.available ?? 0,
        lockedBalance: result.wallet?.locked ?? 0,
      },
      idempotentReplay: result.idempotentReplay,
    };
  }

  async getHistory(scope: CreatorRequestScope, query: WithdrawalHistoryQueryDto) {
    validateHistoryPage(query.page, query.cursor);
    const limit = clampLimit(query.limit);
    const { from, to } = validateDateRange(query.from, query.to, scope.accountCreatedAt);

    const { items, hasMore } = await this.dashboardRepo.fetchWithdrawalHistory(scope, {
      cursor: query.cursor,
      limit,
      sort: query.sort ?? 'requested_at_desc',
      from,
      to,
      status: query.status,
    });

    const enriched = items.map((row) => ({
      ...row,
      canCancel: row.status === 'pending',
    }));

    const last = enriched[enriched.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor(last.requestedAt, last.withdrawalId) : null;

    return {
      schemaVersion: SCHEMA,
      items: enriched,
      pageInfo: {
        nextCursor,
        hasMore,
        limit,
      },
    };
  }

  async getStatus(scope: CreatorRequestScope) {
    if (!this.supabase.isConfigured) {
      return this.emptyStatus();
    }

    const { data, error } = await this.supabase.getClient().rpc(
      'get_creator_withdrawal_status_snapshot',
      { p_creator_profile_id: scope.creatorProfileId },
    );

    if (error) {
      const msg = error.message ?? '';
      if (
        msg.includes('schema cache') ||
        msg.includes('get_creator_withdrawal_status_snapshot')
      ) {
        this.logger.warn(
          `get_creator_withdrawal_status_snapshot unavailable for ${scope.creatorProfileId}: ${msg}`,
        );
        return this.emptyStatus();
      }
      mapWithdrawalRpcError(error, 'get_creator_withdrawal_status_snapshot');
    }

    const snap = data as {
      inflight?: Record<string, unknown> | null;
      eligibility?: Record<string, unknown>;
      wallet?: Record<string, unknown>;
    };

    const eligibility = snap.eligibility ?? {};
    const wallet = snap.wallet ?? {};
    const canRequest =
      !scope.isSuspended &&
      !scope.isWalletFrozen &&
      !snap.inflight &&
      Boolean(eligibility.hasPayoutAccount);

    return {
      schemaVersion: SCHEMA,
      inflight: snap.inflight
        ? {
            withdrawalId: String(snap.inflight.withdrawalId),
            amount: Number(snap.inflight.amount ?? 0),
            status: String(snap.inflight.status),
            statusLabel: STATUS_LABELS[String(snap.inflight.status)] ?? String(snap.inflight.status),
            userMessage: null,
            requestedAt: snap.inflight.requestedAt,
            approvedAt: snap.inflight.approvedAt ?? null,
            canCancel: Boolean(snap.inflight.canCancel),
            maskedDestination: snap.inflight.maskedDestination ?? null,
          }
        : null,
      eligibility: {
        canRequestWithdrawal: canRequest,
        minAmountInr: Number(eligibility.minAmountInr ?? 100),
        maxSingleAmountInr: Number(eligibility.maxSingleAmountInr ?? 25000),
        dailyRemainingInr: Number(eligibility.dailyRemainingInr ?? 0),
        monthlyRemainingInr: Number(eligibility.monthlyRemainingInr ?? 0),
        kycStatus: String(eligibility.kycStatus ?? 'not_started'),
        kycRequiredAboveInr: Number(eligibility.kycRequiredAboveInr ?? 10000),
        hasPayoutAccount: Boolean(eligibility.hasPayoutAccount),
      },
      wallet: {
        availableBalance: Number(wallet.available ?? 0),
        lockedBalance: Number(wallet.locked ?? 0),
      },
    };
  }

  private async assertWithdrawalOwned(scope: CreatorRequestScope, withdrawalId: string) {
    if (!this.supabase.isConfigured) return;

    const { data, error } = await this.supabase
      .getClient()
      .from('withdrawals')
      .select('id, creator_profile_id, creator_id')
      .eq('id', withdrawalId)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'withdrawal_not_found',
        message: 'Withdrawal not found',
      });
    }

    const row = data as { creator_profile_id?: string; creator_id?: string };
    const owned =
      row.creator_profile_id === scope.creatorProfileId ||
      row.creator_id === scope.userId;

    if (!owned) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'forbidden',
        message: 'You do not have access to this withdrawal',
      });
    }
  }

  private emptyStatus() {
    return {
      schemaVersion: SCHEMA,
      inflight: null,
      eligibility: {
        canRequestWithdrawal: false,
        minAmountInr: 100,
        maxSingleAmountInr: 25000,
        dailyRemainingInr: 50000,
        monthlyRemainingInr: 200000,
        kycStatus: 'not_started',
        kycRequiredAboveInr: 10000,
        hasPayoutAccount: false,
      },
      wallet: { availableBalance: 0, lockedBalance: 0 },
    };
  }
}
