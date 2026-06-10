import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class WelcomeCallRewardRpcService {
  constructor(private readonly supabase: SupabaseService) {}

  async completeWelcomeCall(params: {
    callId: string;
    actorUserId: string;
    durationSeconds: number;
    idempotencyKey: string;
  }): Promise<Record<string, unknown>> {
    if (!this.supabase.isConfigured) {
      return {
        call_id: params.callId,
        status: 'completed',
        reward_coins: 100,
        dev_fallback: true,
      };
    }

    const { data, error } = await this.supabase
      .getClient()
      .rpc('complete_welcome_call', {
        p_call_id: params.callId,
        p_actor_user_id: params.actorUserId,
        p_duration_seconds: params.durationSeconds,
        p_idempotency_key: params.idempotencyKey,
      });

    if (error) {
      const msg = error.message ?? '';
      if (msg.includes('idempotency_key_required')) {
        throw new BadRequestException('Idempotency-Key header is required');
      }
      if (msg.includes('not_welcome_call')) {
        throw new BadRequestException('Call is not a welcome call session');
      }
      if (msg.includes('not_call_participant')) {
        throw new BadRequestException('Only call participants can complete this session');
      }
      if (msg.includes('welcome_assignment_not_found')) {
        throw new BadRequestException('Welcome assignment not found for call');
      }
      throw new InternalServerErrorException(`Welcome call completion failed: ${msg}`);
    }

    return (data ?? {}) as Record<string, unknown>;
  }
}
