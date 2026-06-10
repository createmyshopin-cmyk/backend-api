import { MessageRpcService } from './message-rpc.service';

describe('MessageRpcService', () => {
  const rpc = jest.fn();
  const supabase = { getClient: () => ({ rpc }) };
  let service: MessageRpcService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MessageRpcService(supabase as never);
  });

  it('sendMessage maps RPC params', async () => {
    rpc.mockResolvedValue({ data: { messageId: 'm-1' }, error: null });
    const result = await service.sendMessage({
      actorUserId: 'u-1',
      sessionId: 's-1',
      messageType: 'text',
      bodyText: 'hello',
      idempotencyKey: 'idem-1',
    });
    expect(rpc).toHaveBeenCalledWith('send_paid_message', {
      p_actor_user_id: 'u-1',
      p_session_id: 's-1',
      p_message_type: 'text',
      p_body_text: 'hello',
      p_voice_url: null,
      p_voice_duration_ms: null,
      p_idempotency_key: 'idem-1',
    });
    expect(result.messageId).toBe('m-1');
  });

  it('unlockSession maps RPC params', async () => {
    rpc.mockResolvedValue({ data: { status: 'unlocked' }, error: null });
    await service.unlockSession({
      userId: 'u-1',
      sessionId: 's-1',
      unlockType: 'session_24h',
      idempotencyKey: 'idem-2',
    });
    expect(rpc).toHaveBeenCalledWith('unlock_message_session', {
      p_user_id: 'u-1',
      p_session_id: 's-1',
      p_unlock_type: 'session_24h',
      p_idempotency_key: 'idem-2',
    });
  });
});
