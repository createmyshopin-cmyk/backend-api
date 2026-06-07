import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { CallsService } from './calls.service';

describe('Agora channel security', () => {
  const service = Object.create(CallsService.prototype) as CallsService;

  beforeEach(() => {
    (service as any).supabase = { isConfigured: false };
    (service as any).memCalls = [];
    (service as any).memCallRequests = [];
  });

  it('rejects unknown channel in memory mode', async () => {
    await expect(
      service.assertChannelParticipant('user-a', 'ch_unknown'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows caller on ringing request', async () => {
    (service as any).memCallRequests = [
      {
        channelName: 'ch_ring',
        status: 'requested',
        callerId: 'user-caller',
        creatorId: 'user-creator',
      },
    ];
    await expect(
      service.assertChannelParticipant('user-caller', 'ch_ring'),
    ).resolves.toBeUndefined();
  });

  it('rejects third party on ringing request', async () => {
    (service as any).memCallRequests = [
      {
        channelName: 'ch_ring',
        status: 'requested',
        callerId: 'user-caller',
        creatorId: 'user-creator',
      },
    ];
    await expect(
      service.assertChannelParticipant('user-attacker', 'ch_ring'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('requires channelName for token generation', async () => {
    await expect(
      service.generateAgoraToken('user-1', { channelName: '' } as any),
    ).rejects.toThrow(BadRequestException);
  });
});
