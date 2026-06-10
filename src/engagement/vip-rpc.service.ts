import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { mapEngagementRpcError } from './engagement-error.util';

@Injectable()
export class VipRpcService {
  constructor(private readonly supabase: SupabaseService) {}

  private client() {
    return this.supabase.getClient();
  }

  async getVipPlans() {
    const { data, error } = await this.client().rpc('get_vip_plans');
    if (error) mapEngagementRpcError(error, 'get_vip_plans');
    return data as Record<string, unknown>;
  }

  async initiateSubscription(params: {
    userId: string;
    tier: string;
    idempotencyKey: string;
    gatewayOrderId: string;
    amountPaise: number;
  }) {
    const { data, error } = await this.client().rpc('initiate_vip_subscription', {
      p_user_id: params.userId,
      p_tier: params.tier,
      p_idempotency_key: params.idempotencyKey,
      p_gateway_order_id: params.gatewayOrderId,
      p_amount_paise: params.amountPaise,
    });
    if (error) mapEngagementRpcError(error, 'initiate_vip_subscription');
    return data as Record<string, unknown>;
  }

  async activateMembership(params: {
    userId: string;
    membershipId: string;
    gatewayPaymentId: string;
    idempotencyKey: string;
  }) {
    const { data, error } = await this.client().rpc('activate_vip_membership', {
      p_user_id: params.userId,
      p_membership_id: params.membershipId,
      p_gateway_payment_id: params.gatewayPaymentId,
      p_idempotency_key: params.idempotencyKey,
    });
    if (error) mapEngagementRpcError(error, 'activate_vip_membership');
    return data as Record<string, unknown>;
  }

  async getVipStatus(userId: string) {
    const { data, error } = await this.client().rpc('get_vip_status', {
      p_user_id: userId,
    });
    if (error) mapEngagementRpcError(error, 'get_vip_status');
    return data as Record<string, unknown>;
  }

  async getVipHistory(userId: string, limit = 20) {
    const { data, error } = await this.client().rpc('get_vip_membership_history', {
      p_user_id: userId,
      p_limit: limit,
    });
    if (error) mapEngagementRpcError(error, 'get_vip_membership_history');
    return data as Record<string, unknown>;
  }
}
