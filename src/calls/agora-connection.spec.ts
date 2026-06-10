import {
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { CallsService } from './calls.service';

describe('Agora connection flow', () => {
  const service = Object.create(CallsService.prototype) as CallsService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (service as any).supabase = { isConfigured: false };
    (service as any).memCalls = [];
    (service as any).memCallRequests = [];
    (service as any).usersService = {
      findOne: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          name: id,
          isCreator: id.includes('creator'),
        }),
      ),
    };
    process.env = {
      ...originalEnv,
      AGORA_APP_ID: 'test-app-id',
      AGORA_APP_CERTIFICATE: 'test-certificate-32chars-minimum!!',
    };
    delete process.env.AGORA_TOKEN;
    jest
      .spyOn(service as any, '_makeAgoraToken')
      .mockReturnValue('007eJxTYAiw-mock-token-for-tests');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('generates token bound to channel name and uid 0', async () => {
    (service as any).memCallRequests = [
      {
        channelName: 'ch_123',
        status: 'requested',
        callerId: 'caller-1',
        creatorId: 'creator-1',
      },
    ];

    const result = await service.generateAgoraToken('caller-1', {
      channelName: 'ch_123',
      uid: 0,
      role: 'publisher',
    });

    expect(result.appId).toBe('test-app-id');
    expect(result.channelName).toBe('ch_123');
    expect(result.uid).toBe(0);
    expect(result.token.length).toBeGreaterThan(20);
  });

  it('rejects token when callId does not exist', async () => {
    await expect(
      service.assertChannelParticipant('caller-1', 'ch_123', 'missing-session'),
    ).rejects.toThrow(NotFoundException);
  });

  it('allows both participants on accepted call session', async () => {
    (service as any).memCalls = [
      {
        id: 'sess-1',
        channelName: 'ch_active',
        status: 'accepted',
        callerId: 'caller-1',
        creatorId: 'creator-1',
      },
    ];

    await expect(
      service.assertChannelParticipant('caller-1', 'ch_active', 'sess-1'),
    ).resolves.toBeUndefined();
    await expect(
      service.assertChannelParticipant('creator-1', 'ch_active', 'sess-1'),
    ).resolves.toBeUndefined();
  });

  it('rejects join token for ended session', async () => {
    (service as any).memCalls = [
      {
        id: 'sess-ended',
        channelName: 'ch_done',
        status: 'ended',
        callerId: 'caller-1',
        creatorId: 'creator-1',
      },
    ];

    await expect(
      service.assertChannelParticipant('caller-1', 'ch_done', 'sess-ended'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects ended session by channel lookup when callId omitted', async () => {
    (service as any).memCalls = [
      {
        id: 'sess-ended',
        channelName: 'ch_done',
        status: 'ended',
        callerId: 'caller-1',
        creatorId: 'creator-1',
      },
    ];

    await expect(
      service.assertChannelParticipant('caller-1', 'ch_done'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects channel mismatch for bound callId', async () => {
    (service as any).memCalls = [
      {
        id: 'sess-1',
        channelName: 'ch_real',
        status: 'accepted',
        callerId: 'caller-1',
        creatorId: 'creator-1',
      },
    ];

    await expect(
      service.assertChannelParticipant('caller-1', 'ch_wrong', 'sess-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws when Agora credentials are missing', async () => {
    jest.restoreAllMocks();
    delete process.env.AGORA_APP_CERTIFICATE;
    delete process.env.AGORA_TOKEN;

    (service as any).memCallRequests = [
      {
        channelName: 'ch_no_cert',
        status: 'requested',
        callerId: 'caller-1',
        creatorId: 'creator-1',
      },
    ];

    await expect(
      service.generateAgoraToken('caller-1', { channelName: 'ch_no_cert' }),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('rejects third party on active channel', async () => {
    (service as any).memCalls = [
      {
        id: 'sess-1',
        channelName: 'ch_active',
        status: 'ongoing',
        callerId: 'caller-1',
        creatorId: 'creator-1',
      },
    ];

    await expect(
      service.assertChannelParticipant('attacker', 'ch_active'),
    ).rejects.toThrow(ForbiddenException);
  });
});
