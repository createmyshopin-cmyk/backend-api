import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { assertFinancialPersistence } from '../startup/financial-guard';

export interface VerifyPaymentRpcResult {
  paymentId: string;
  userId: string;
  coinsAdded: number;
  balanceBefore?: number;
  balanceAfter?: number;
  coinTransactionId?: string;
  gatewayPaymentId: string;
  idempotentReplay: boolean;
}

export interface RefundPaymentRpcResult {
  refundEventId: string;
  paymentId: string;
  coinTransactionId?: string;
  auditLogId?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  coinsClawedBack?: number;
  idempotentReplay: boolean;
}

@Injectable()
export class PaymentRpcService {
  private readonly logger = new Logger(PaymentRpcService.name);

  constructor(private readonly supabase: SupabaseService) {}

  private client() {
    if (!this.supabase.isConfigured) {
      assertFinancialPersistence('PaymentRpcService');
    }
    return this.supabase.getClient();
  }

  private mapRpcError(error: { message?: string; code?: string }, context: string): never {
    const msg = error.message ?? 'payment_rpc_failed';
    this.logger.warn(`${context}: ${msg}`);

    if (msg.includes('payment_not_found')) {
      throw new NotFoundException('Payment record not found');
    }
    if (msg.includes('payment_user_mismatch')) {
      throw new ForbiddenException('Payment does not belong to the authenticated user');
    }
    if (msg.includes('gateway_payment_id_conflict')) {
      throw new ConflictException('Gateway payment ID already used by another payment');
    }
    if (msg.includes('amount_paise_mismatch')) {
      throw new BadRequestException('Payment amount does not match gateway capture');
    }
    if (msg.includes('invalid_payment_state')) {
      throw new ConflictException(`Payment cannot be processed: ${msg}`);
    }
    if (msg.includes('payment_verify_cas_conflict') || msg.includes('refund_cas_conflict')) {
      throw new ConflictException('Payment already processed by another request');
    }
    if (msg.includes('insufficient_balance')) {
      throw new BadRequestException('Insufficient coins balance for refund');
    }
    if (msg.includes('idempotency_key_required') || msg.includes('reason_required')) {
      throw new BadRequestException(msg);
    }

    throw new InternalServerErrorException(`Payment operation failed: ${msg}`);
  }

  async verifyRazorpayPaymentAtomic(params: {
    userId: string;
    gatewayOrderId: string;
    gatewayPaymentId: string;
    idempotencyKey: string;
    amountPaise: number;
    gatewayStatus?: string;
  }): Promise<VerifyPaymentRpcResult> {
    const { data, error } = await this.client().rpc('verify_razorpay_payment_atomic', {
      p_user_id: params.userId,
      p_gateway_order_id: params.gatewayOrderId,
      p_gateway_payment_id: params.gatewayPaymentId,
      p_idempotency_key: params.idempotencyKey,
      p_amount_paise: params.amountPaise,
      p_gateway_status: params.gatewayStatus ?? 'captured',
    });

    if (error) this.mapRpcError(error, 'verify_razorpay_payment_atomic');

    const row = data as Record<string, unknown>;
    return {
      paymentId: String(row.payment_id),
      userId: String(row.user_id),
      coinsAdded: Number(row.coins_added),
      balanceBefore: row.balance_before != null ? Number(row.balance_before) : undefined,
      balanceAfter: row.balance_after != null ? Number(row.balance_after) : undefined,
      coinTransactionId: row.coin_transaction_id ? String(row.coin_transaction_id) : undefined,
      gatewayPaymentId: String(row.gateway_payment_id),
      idempotentReplay: Boolean(row.idempotent_replay),
    };
  }

  async markPaymentFailedAtomic(gatewayOrderId: string, gatewayPaymentId?: string) {
    const { data, error } = await this.client().rpc('mark_payment_failed_atomic', {
      p_gateway_order_id: gatewayOrderId,
      p_gateway_payment_id: gatewayPaymentId ?? null,
    });
    if (error) this.mapRpcError(error, 'mark_payment_failed_atomic');
    return data;
  }

  async refundPaymentAtomic(params: {
    paymentId: string;
    adminId?: string;
    adminEmail?: string;
    adminRole?: string;
    reason: string;
    idempotencyKey: string;
    razorpayRefundId?: string;
    httpMethod?: string;
    httpPath?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<RefundPaymentRpcResult> {
    const { data, error } = await this.client().rpc('refund_payment_atomic', {
      p_payment_id: params.paymentId,
      p_admin_id: params.adminId ?? null,
      p_admin_email: params.adminEmail ?? null,
      p_admin_role: params.adminRole ?? null,
      p_reason: params.reason,
      p_idempotency_key: params.idempotencyKey,
      p_razorpay_refund_id: params.razorpayRefundId ?? null,
      p_http_method: params.httpMethod ?? 'POST',
      p_http_path: params.httpPath ?? null,
      p_ip_address: params.ipAddress ?? null,
      p_user_agent: params.userAgent ?? null,
    });

    if (error) this.mapRpcError(error, 'refund_payment_atomic');

    const row = data as Record<string, unknown>;
    return {
      refundEventId: String(row.refund_event_id),
      paymentId: String(row.payment_id),
      coinTransactionId: row.coin_transaction_id ? String(row.coin_transaction_id) : undefined,
      auditLogId: row.audit_log_id ? String(row.audit_log_id) : undefined,
      balanceBefore: row.balance_before != null ? Number(row.balance_before) : undefined,
      balanceAfter: row.balance_after != null ? Number(row.balance_after) : undefined,
      coinsClawedBack: row.coins_clawed_back != null ? Number(row.coins_clawed_back) : undefined,
      idempotentReplay: Boolean(row.idempotent_replay),
    };
  }

  async recordWebhookEvent(params: {
    eventId: string;
    eventType: string;
    payloadHash: string;
    outcome: 'processed' | 'ignored' | 'error' | 'duplicate';
    errorMessage?: string;
  }): Promise<'inserted' | 'duplicate'> {
    const { error } = await this.client()
      .from('gateway_webhook_events')
      .insert({
        event_id: params.eventId,
        event_type: params.eventType,
        payload_hash: params.payloadHash,
        outcome: params.outcome,
        error_message: params.errorMessage ?? null,
      });

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return 'duplicate';
      }
      throw new InternalServerErrorException(`Failed to record webhook event: ${error.message}`);
    }
    return 'inserted';
  }

  async updateWebhookEventOutcome(
    eventId: string,
    outcome: 'processed' | 'ignored' | 'error' | 'duplicate',
    errorMessage?: string,
  ): Promise<void> {
    const { error } = await this.client()
      .from('gateway_webhook_events')
      .update({
        outcome,
        error_message: errorMessage ?? null,
      })
      .eq('event_id', eventId);

    if (error) {
      throw new InternalServerErrorException(`Failed to update webhook event: ${error.message}`);
    }
  }
}
