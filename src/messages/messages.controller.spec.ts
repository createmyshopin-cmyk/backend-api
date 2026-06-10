import { BadRequestException } from '@nestjs/common';
import { MessagesController } from './messages.controller';

describe('MessagesController', () => {
  const service = {
    send: jest.fn(),
    unlock: jest.fn(),
    getConversations: jest.fn(),
    getSession: jest.fn(),
    getHistory: jest.fn(),
  };

  let controller: MessagesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new MessagesController(service as never);
  });

  it('GET conversations is self-scoped', async () => {
    service.getConversations.mockResolvedValue({ conversations: [] });
    await controller.getConversations({ user: { id: 'user-1' } }, { limit: 10 });
    expect(service.getConversations).toHaveBeenCalledWith('user-1', 10);
  });

  it('POST send requires idempotency key', async () => {
    await expect(
      controller.send(
        { user: { id: 'user-1' } },
        { messageType: 'text', bodyText: 'hi', sessionId: 's-1' },
        undefined,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('POST send forwards idempotency key', async () => {
    service.send.mockResolvedValue({ messageId: 'm-1' });
    await controller.send(
      { user: { id: 'user-1' } },
      { messageType: 'text', bodyText: 'hi', sessionId: 's-1' },
      'idem-1',
    );
    expect(service.send).toHaveBeenCalledWith(
      'user-1',
      { messageType: 'text', bodyText: 'hi', sessionId: 's-1' },
      'idem-1',
    );
  });

  it('POST unlock forwards idempotency key', async () => {
    service.unlock.mockResolvedValue({ status: 'unlocked' });
    await controller.unlock(
      { user: { id: 'user-1' } },
      { sessionId: 's-1', unlockType: 'session_24h' },
      'idem-2',
    );
    expect(service.unlock).toHaveBeenCalledWith(
      'user-1',
      { sessionId: 's-1', unlockType: 'session_24h' },
      'idem-2',
    );
  });
});
