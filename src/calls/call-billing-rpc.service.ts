import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { assertFinancialPersistence } from '../startup/financial-guard';

export interface EndCallBillingResult {
  callId: string;
  callerId: string;
  creatorId: string;
  status: string;
  durationSeconds: number;
  coinsSpent: number;
  creatorShare: number;
  coinTransactionId?: string;
  creatorEarningId?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  alreadyEnded: boolean;
  idempotentReplay: boolean;
}

export interface MarkCallMissedResult {
  callRequestId: string;
  status: string;
  idempotentReplay: boolean;
}

@Injectable()
export class CallBillingRpcService {
  private readonly logger = new Logger(CallBillingRpcService.name);

  constructor(private readonly supabase: SupabaseService) {}

  private client() {
    if (!this.supabase.isConfigured) {
      assertFinancialPersistence('CallBillingRpcService');
    }
    return this.supabase.getClient();
  }

  private mapRpcError(error: { message?: string; code?: string }, context: string): never {
    const msg = error.message ?? 'call_billing_rpc_failed';
    this.logger.warn(`${context}: ${msg}`);

    if (msg.includes('call_not_found') || msg.includes('call_request_not_found')) {
      throw new NotFoundException(msg.includes('request') ? 'Call request not found' : 'Call session not found');
    }
    if (msg.includes('not_call_participant') || msg.includes('forbidden')) {
      throw new ForbiddenException('You do not have access to this call');
    }
    if (msg.includes('call_already_active')) {
      throw new ForbiddenException({
        code: 'CALL_ALREADY_ACTIVE',
        message: 'Call is already active — use end call instead of marking missed',
      });
    }
    if (msg.includes('invalid_call_state') || msg.includes('invalid_transition')) {
      throw new ConflictException(`Call cannot be processed: ${msg}`);
    }
    if (msg.includes('call_billing_cas_conflict') || msg.includes('miss_cas_conflict')) {
      throw new ConflictException('Call already processed by another request');
    }
    if (msg.includes('insufficient_balance')) {
      throw new HttpException(
        { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient coins to complete call billing' },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    if (msg.includes('idempotency_key_required')) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    throw new InternalServerErrorException(`Call billing failed: ${msg}`);
  }

  async endCallBilling(params: {
    callId: string;
    actorUserId: string;
    durationSeconds: number;
    idempotencyKey: string;
    endedReason?: string;
    endedBy?: string;
  }): Promise<EndCallBillingResult> {
    const { data, error } = await this.client().rpc('end_call_billing', {
      p_call_id: params.callId,
      p_actor_user_id: params.actorUserId,
      p_duration_seconds: params.durationSeconds,
      p_idempotency_key: params.idempotencyKey,
      p_ended_reason: params.endedReason ?? null,
      p_ended_by: params.endedBy ?? 'participant',
    });

    if (error) this.mapRpcError(error, 'end_call_billing');

    const row = data as Record<string, unknown>;
    return {
      callId: String(row.call_id),
      callerId: String(row.caller_id),
      creatorId: String(row.creator_id),
      status: String(row.status),
      durationSeconds: Number(row.duration_seconds ?? 0),
      coinsSpent: Number(row.coins_spent ?? 0),
      creatorShare: Number(row.creator_share ?? 0),
      coinTransactionId: row.coin_transaction_id ? String(row.coin_transaction_id) : undefined,
      creatorEarningId: row.creator_earning_id ? String(row.creator_earning_id) : undefined,
      balanceBefore: row.balance_before != null ? Number(row.balance_before) : undefined,
      balanceAfter: row.balance_after != null ? Number(row.balance_after) : undefined,
      alreadyEnded: Boolean(row.already_ended),
      idempotentReplay: Boolean(row.idempotent_replay),
    };
  }

  async markCallRequestMissed(params: {
    callRequestId: string;
    actorUserId: string;
  }): Promise<MarkCallMissedResult> {
    const { data, error } = await this.client().rpc('mark_call_request_missed', {
      p_call_request_id: params.callRequestId,
      p_actor_user_id: params.actorUserId,
    });

    if (error) this.mapRpcError(error, 'mark_call_request_missed');

    const row = data as Record<string, unknown>;
    return {
      callRequestId: String(row.call_request_id),
      status: String(row.status),
      idempotentReplay: Boolean(row.idempotent_replay),
    };
  }
}
