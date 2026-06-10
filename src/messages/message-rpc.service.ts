import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { mapMessageRpcError } from './message-error.util';

@Injectable()
export class MessageRpcService {
  constructor(private readonly supabase: SupabaseService) {}

  private client() {
    return this.supabase.getClient();
  }

  async ensureSession(userId: string, creatorProfileId: string) {
    const { data, error } = await this.client().rpc('ensure_message_session', {
      p_user_id: userId,
      p_creator_profile_id: creatorProfileId,
    });
    if (error) mapMessageRpcError(error, 'ensure_message_session');
    return data as string;
  }

  async sendMessage(params: {
    actorUserId: string;
    sessionId: string;
    messageType: string;
    bodyText?: string;
    voiceUrl?: string;
    voiceDurationMs?: number;
    idempotencyKey: string;
  }) {
    const { data, error } = await this.client().rpc('send_paid_message', {
      p_actor_user_id: params.actorUserId,
      p_session_id: params.sessionId,
      p_message_type: params.messageType,
      p_body_text: params.bodyText ?? null,
      p_voice_url: params.voiceUrl ?? null,
      p_voice_duration_ms: params.voiceDurationMs ?? null,
      p_idempotency_key: params.idempotencyKey,
    });
    if (error) mapMessageRpcError(error, 'send_paid_message');
    return data as Record<string, unknown>;
  }

  async unlockSession(params: {
    userId: string;
    sessionId: string;
    unlockType: string;
    idempotencyKey: string;
  }) {
    const { data, error } = await this.client().rpc('unlock_message_session', {
      p_user_id: params.userId,
      p_session_id: params.sessionId,
      p_unlock_type: params.unlockType,
      p_idempotency_key: params.idempotencyKey,
    });
    if (error) mapMessageRpcError(error, 'unlock_message_session');
    return data as Record<string, unknown>;
  }

  async getConversations(userId: string, limit = 20) {
    const { data, error } = await this.client().rpc('get_message_conversations', {
      p_user_id: userId,
      p_limit: limit,
    });
    if (error) mapMessageRpcError(error, 'get_message_conversations');
    return data as Record<string, unknown>;
  }

  async getSessionDetail(userId: string, sessionId: string, limit = 50) {
    const { data, error } = await this.client().rpc('get_message_session_detail', {
      p_user_id: userId,
      p_session_id: sessionId,
      p_limit: limit,
    });
    if (error) mapMessageRpcError(error, 'get_message_session_detail');
    return data as Record<string, unknown>;
  }

  async getHistory(userId: string, limit = 20) {
    const { data, error } = await this.client().rpc('get_message_history', {
      p_user_id: userId,
      p_limit: limit,
    });
    if (error) mapMessageRpcError(error, 'get_message_history');
    return data as Record<string, unknown>;
  }
}
