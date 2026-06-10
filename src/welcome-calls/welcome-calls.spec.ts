import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WelcomeCallsService } from './welcome-calls.service';
import { invalidCallRoleException } from '../calls/call-role.util';

describe('WelcomeCallsService', () => {
  const findOne = jest.fn();
  const usersService = { findOne };
  const fcmService = {
    sendWelcomeIncomingCall: jest.fn(),
  };
  const callsService = {
    generateAgoraToken: jest.fn().mockResolvedValue({
      token: 'tok',
      appId: 'app',
    }),
  };
  const supabase = { isConfigured: false, getClient: jest.fn() };

  let service: WelcomeCallsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WelcomeCallsService(
      supabase as never,
      usersService as never,
      fcmService as never,
      callsService as never,
    );
    (service as unknown as { memCampaigns: unknown[] }).memCampaigns = [
      {
        id: 'camp-1',
        enabled: true,
        rewardCoins: 100,
        maxDurationSeconds: 300,
        assignmentStrategy: 'online',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    (service as unknown as { memAssignments: unknown[] }).memAssignments = [];
  });

  it('creates assignment for new user when campaign enabled', async () => {
    findOne.mockResolvedValue({ id: 'user-1', isCreator: false, fcm_token: null });
    const assignment = await service.tryCreateAssignmentForUser('user-1');
    expect(assignment).not.toBeNull();
    expect(assignment?.userId).toBe('user-1');
    expect(assignment?.rewardCoins).toBe(100);
  });

  it('skips assignment for creators', async () => {
    findOne.mockResolvedValue({ id: 'c-1', isCreator: true });
    const assignment = await service.tryCreateAssignmentForUser('c-1');
    expect(assignment).toBeNull();
  });

  it('rejects accept from wrong creator', async () => {
    (service as unknown as { memAssignments: unknown[] }).memAssignments = [
      {
        id: 'a1',
        userId: 'user-1',
        campaignId: 'camp-1',
        creatorProfileId: 'profile-a',
        status: 'pending',
        rewardCoins: 100,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        createdAt: new Date().toISOString(),
      },
    ];
    await expect(
      service.acceptAssignment('a1', 'profile-b', 'creator-b'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects user join when not welcome source', async () => {
    supabase.isConfigured = true;
    const maybeSingle = jest.fn().mockResolvedValue({
      data: {
        caller_id: 'user-1',
        creator_id: 'creator-1',
        call_source: 'normal',
        status: 'requested',
        channel_name: 'ch',
        type: 'voice',
      },
    });
    supabase.getClient = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ maybeSingle }),
        }),
      }),
    });
    findOne.mockResolvedValue({ id: 'user-1', isCreator: false });
    await expect(
      service.userJoinWelcomeCall('user-1', 'req-1'),
    ).rejects.toThrow('Not a welcome call request');
  });

  it('documents INVALID_CALL_ROLE for creator user join', () => {
    expect(invalidCallRoleException).toBeDefined();
  });
});
