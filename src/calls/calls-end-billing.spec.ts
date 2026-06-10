import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CallsService } from './calls.service';

describe('CallsService endCall / markCallRequestMissed (Sprint 5)', () => {
  const endCallBilling = jest.fn();
  const markCallRequestMissed = jest.fn();
  const callBillingRpc = { endCallBilling, markCallRequestMissed };

  const from = jest.fn();
  const select = jest.fn();
  const eq = jest.fn();
  const single = jest.fn();

  const supabase = {
    isConfigured: true,
    getClient: () => ({ from }),
  };

  const findOne = jest.fn();
  const usersService = { findOne };

  const creatorsFindOne = jest.fn();
  const creatorsService = { findOne: creatorsFindOne };

  const fcmService = {
    sendCallEnded: jest.fn(),
    sendCallCancelled: jest.fn(),
  };

  const missionHook = {
    onCallCompleted: jest.fn().mockResolvedValue(undefined),
    onGiftSent: jest.fn(),
    onWalletRecharge: jest.fn(),
  };
  const welcomeCallRewardRpc = { completeWelcomeCall: jest.fn() };

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

    from.mockReturnValue({ select });
    select.mockReturnValue({ eq });
    eq.mockReturnValue({ single });
    single.mockResolvedValue({
      data: {
        id: 'call-1',
        caller_id: 'caller-1',
        creator_id: 'creator-1',
        type: 'voice',
        status: 'ongoing',
        started_at: new Date(Date.now() - 120_000).toISOString(),
        channel_name: 'ch_test',
        ended_at: null,
      },
      error: null,
    });

    findOne.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        name: id === 'caller-1' ? 'Caller' : 'Creator',
        coins: 80,
      }),
    );
    creatorsFindOne.mockResolvedValue({ name: 'Creator', ratePerMinute: 10 });

    endCallBilling.mockResolvedValue({
      callId: 'call-1',
      callerId: 'caller-1',
      creatorId: 'creator-1',
      status: 'ended',
      durationSeconds: 120,
      coinsSpent: 20,
      creatorShare: 14,
      balanceAfter: 80,
      alreadyEnded: false,
      idempotentReplay: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(service as any, 'finalizeCallRequestsForEndedSession').mockResolvedValue('req-1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(service as any, 'assembleCallEndSummary').mockResolvedValue({
      callDuration: 120,
      callCoinsSpent: 20,
      giftCoinsSpent: 0,
      totalCoinsSpent: 20,
      creatorCallEarnings: 14,
      creatorGiftEarnings: 0,
      creatorTotalEarnings: 14,
      remainingBalance: 80,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(service as any, 'notifyPeerCallEnded').mockImplementation(() => undefined);
  });

  it('requires Idempotency-Key for end call', async () => {
    await expect(
      service.endCall('caller-1', 'call-1', { duration: 120 }, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(endCallBilling).not.toHaveBeenCalled();
  });

  it('delegates billing to atomic RPC with resolved duration', async () => {
    const result = await service.endCall(
      'caller-1',
      'call-1',
      { duration: 9999 },
      'end-key-1',
    );

    expect(endCallBilling).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'call-1',
        actorUserId: 'caller-1',
        idempotencyKey: 'end-key-1',
      }),
    );
    const billedDuration = endCallBilling.mock.calls[0][0].durationSeconds;
    expect(billedDuration).toBeLessThanOrEqual(150);
    expect(result.coinsSpent).toBe(20);
    expect(result.newBalance).toBe(80);
  });

  it('returns idempotent replay summary on duplicate end-call', async () => {
    endCallBilling.mockResolvedValue({
      callId: 'call-1',
      callerId: 'caller-1',
      creatorId: 'creator-1',
      status: 'ended',
      durationSeconds: 120,
      coinsSpent: 20,
      creatorShare: 14,
      balanceAfter: 80,
      alreadyEnded: true,
      idempotentReplay: true,
    });

    const result = await service.endCall(
      'caller-1',
      'call-1',
      { duration: 120 },
      'end-key-dup',
    );

    expect(result.alreadyEnded).toBe(true);
    expect((result as { idempotentReplay?: boolean }).idempotentReplay).toBe(true);
  });

  it('markCallRequestMissed delegates to RPC', async () => {
    markCallRequestMissed.mockResolvedValue({
      callRequestId: 'req-1',
      status: 'missed',
      idempotentReplay: false,
    });

    const result = await service.markCallRequestMissed('req-1', 'caller-1');

    expect(markCallRequestMissed).toHaveBeenCalledWith({
      callRequestId: 'req-1',
      actorUserId: 'caller-1',
    });
    expect(result.callRequestStatus).toBe('missed');
  });

  it('markCallRequestMissed blocks accepted calls in memory fallback', async () => {
    const memService = new CallsService(
      { isConfigured: false } as never,
      usersService as never,
      creatorsService as never,
      fcmService as never,
      callBillingRpc as never,
      missionHook as never,
      welcomeCallRewardRpc as never,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(memService as any, 'findCallRequest').mockResolvedValue({
      id: 'req-mem',
      callerId: 'caller-1',
      creatorId: 'creator-1',
      type: 'voice',
      status: 'accepted',
      channelName: 'ch',
      createdAt: new Date().toISOString(),
      callId: 'call-mem',
    });

    await expect(
      memService.markCallRequestMissed('req-mem', 'caller-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
