import { ForbiddenException } from '@nestjs/common';
import { CallsService } from './calls.service';
import {
  assertValidCallRoles,
  INVALID_CALL_ROLE_CODE,
  INVALID_CALL_ROLE_MESSAGE,
  invalidCallRoleException,
} from './call-role.util';

describe('call-role.util', () => {
  it('allows user → creator', () => {
    expect(() =>
      assertValidCallRoles({ isCreator: false }, { isCreator: true }),
    ).not.toThrow();
  });

  it('rejects creator → creator', () => {
    expect(() =>
      assertValidCallRoles({ isCreator: true }, { isCreator: true }),
    ).toThrow(ForbiddenException);
  });

  it('rejects creator → user', () => {
    expect(() =>
      assertValidCallRoles({ isCreator: true }, { isCreator: false }),
    ).toThrow(ForbiddenException);
  });

  it('rejects user → user', () => {
    expect(() =>
      assertValidCallRoles({ isCreator: false }, { isCreator: false }),
    ).toThrow(ForbiddenException);
  });

  it('returns INVALID_CALL_ROLE payload', () => {
    const err = invalidCallRoleException();
    expect(err.getResponse()).toEqual({
      statusCode: 403,
      code: INVALID_CALL_ROLE_CODE,
      message: INVALID_CALL_ROLE_MESSAGE,
    });
  });
});

describe('CallsService call role enforcement', () => {
  const findOne = jest.fn();
  const usersService = { findOne };
  const creatorsFindOne = jest.fn();
  const creatorsService = { findOne: creatorsFindOne };
  const fcmService = { sendIncomingCall: jest.fn() };
  const callBillingRpc = {
    endCallBilling: jest.fn(),
    markCallRequestMissed: jest.fn(),
  };
  const missionHook = {
    onCallCompleted: jest.fn(),
    onGiftSent: jest.fn(),
    onWalletRecharge: jest.fn(),
  };
  const welcomeCallRewardRpc = { completeWelcomeCall: jest.fn() };

  const supabase = { isConfigured: false, getClient: jest.fn() };

  let service: CallsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CallsService(
      supabase as never,
      usersService as never,
      creatorsService as never,
      fcmService as never,
      callBillingRpc as never,
      missionHook as never,
      welcomeCallRewardRpc as never,
    );
    jest
      .spyOn(service as unknown as { _requireAgoraToken: () => string }, '_requireAgoraToken')
      .mockReturnValue('test-agora-token');
    jest
      .spyOn(service as unknown as { _cachedAgoraToken: () => string }, '_cachedAgoraToken')
      .mockReturnValue('test-agora-token');
  });

  const user = (id: string, isCreator: boolean, coins = 100) => ({
    id,
    name: id,
    coins,
    isCreator,
  });

  it('requestCall PASS: user → creator', async () => {
    findOne.mockImplementation((id: string) => {
      if (id === 'user-1') return Promise.resolve(user('user-1', false));
      if (id === 'creator-1') return Promise.resolve(user('creator-1', true));
      return Promise.reject(new Error('unknown'));
    });
    creatorsFindOne.mockResolvedValue({
      id: 'creator-1',
      name: 'Creator',
      isOnline: true,
    });

    const result = await service.requestCall('user-1', {
      listenerId: 'creator-1',
      type: 'voice',
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('requested');
  });

  it('requestCall FAIL: creator → creator', async () => {
    findOne.mockImplementation((id: string) => {
      if (id === 'creator-a') return Promise.resolve(user('creator-a', true));
      if (id === 'creator-b') return Promise.resolve(user('creator-b', true));
      return Promise.reject(new Error('unknown'));
    });

    await expect(
      service.requestCall('creator-a', {
        listenerId: 'creator-b',
        type: 'voice',
      }),
    ).rejects.toMatchObject({
      response: {
        code: INVALID_CALL_ROLE_CODE,
        message: INVALID_CALL_ROLE_MESSAGE,
      },
    });
    expect(creatorsFindOne).not.toHaveBeenCalled();
  });

  it('requestCall FAIL: creator → user', async () => {
    findOne.mockImplementation((id: string) => {
      if (id === 'creator-1') return Promise.resolve(user('creator-1', true));
      if (id === 'user-2') return Promise.resolve(user('user-2', false));
      return Promise.reject(new Error('unknown'));
    });

    await expect(
      service.requestCall('creator-1', {
        listenerId: 'user-2',
        type: 'voice',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('requestCall FAIL: user → user', async () => {
    findOne.mockImplementation((id: string) => {
      if (id === 'user-1') return Promise.resolve(user('user-1', false));
      if (id === 'user-2') return Promise.resolve(user('user-2', false));
      return Promise.reject(new Error('unknown'));
    });

    await expect(
      service.requestCall('user-1', {
        listenerId: 'user-2',
        type: 'voice',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('getActiveCallForUser FAIL: invalid stored roles', async () => {
    (service as unknown as { memCalls: unknown[] }).memCalls = [
      {
        id: 'call-bad',
        callerId: 'creator-a',
        callerName: 'A',
        creatorId: 'creator-b',
        creatorName: 'B',
        type: 'voice',
        status: 'ongoing',
        durationSeconds: 0,
        coinsDeducted: 0,
        coinsSpent: 0,
        channelName: 'ch_bad',
        startedAt: new Date().toISOString(),
      },
    ];

    findOne.mockImplementation((id: string) =>
      Promise.resolve(user(id, id.startsWith('creator'))),
    );

    await expect(service.getActiveCallForUser('creator-a')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('getActiveCallForUser PASS: valid user → creator restore', async () => {
    (service as unknown as { memCalls: unknown[] }).memCalls = [
      {
        id: 'call-ok',
        callerId: 'user-1',
        callerName: 'User',
        creatorId: 'creator-1',
        creatorName: 'Creator',
        type: 'voice',
        status: 'ongoing',
        durationSeconds: 0,
        coinsDeducted: 0,
        coinsSpent: 0,
        channelName: 'ch_ok',
        startedAt: new Date().toISOString(),
      },
    ];

    findOne.mockImplementation((id: string) => {
      if (id === 'user-1') return Promise.resolve(user('user-1', false));
      if (id === 'creator-1') return Promise.resolve(user('creator-1', true));
      return Promise.reject(new Error('unknown'));
    });
    creatorsFindOne.mockResolvedValue({
      id: 'creator-1',
      name: 'Creator',
      ratePerMinute: 10,
    });

    const result = await service.getActiveCallForUser('user-1');
    expect(result.callSession?.id).toBe('call-ok');
    expect(result.isCreator).toBe(false);
  });
});
