import { EngagementService } from './engagement.service';

describe('EngagementService', () => {
  const rpc = {
    followCreator: jest.fn(),
    unfollowCreator: jest.fn(),
    favoriteCreator: jest.fn(),
    unfavoriteCreator: jest.fn(),
    getEngagementLevels: jest.fn(),
  };

  const missionRpc = {
    getDailyMissionsBoard: jest.fn(),
    claimMissionReward: jest.fn(),
    claimStreakMilestone: jest.fn(),
    getStreakSnapshot: jest.fn(),
    getEngagementRewards: jest.fn(),
    incrementMissionProgress: jest.fn(),
  };

  const comboRpc = {
    getPremiumGiftsCatalog: jest.fn(),
    getComboStatus: jest.fn(),
    getComboHistory: jest.fn(),
  };

  const supabase = {
    isConfigured: false,
    getClient: jest.fn(),
  };

  let service: EngagementService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EngagementService(
      supabase as never,
      rpc as never,
      missionRpc as never,
      comboRpc as never,
    );
  });

  it('follow in memory mode grants following state', async () => {
    const result = await service.follow('user-1', 'profile-1', 'idem-1');
    expect(result.following).toBe(true);
    expect(result.creatorProfileId).toBe('profile-1');
  });

  it('favorite in memory mode respects 50 cap', async () => {
    for (let i = 0; i < 50; i++) {
      await service.favorite('user-2', `profile-${i}`);
    }
    await expect(service.favorite('user-2', 'profile-51')).rejects.toThrow();
  });

  it('getLevels in memory returns xp projection', async () => {
    await service.follow('user-3', 'profile-9');
    const levels = await service.getLevels('user-3');
    expect(levels.user.currentXp).toBeGreaterThan(0);
    expect(levels.user.currentLevel).toBeGreaterThanOrEqual(1);
  });

  it('delegates follow to RPC when supabase configured', async () => {
    supabase.isConfigured = true;
    rpc.followCreator.mockResolvedValue({
      following: true,
      creatorProfileId: 'profile-1',
    });

    await service.follow('user-1', 'profile-1', 'key-1');

    expect(rpc.followCreator).toHaveBeenCalledWith({
      followerUserId: 'user-1',
      creatorProfileId: 'profile-1',
      idempotencyKey: 'key-1',
    });
    supabase.isConfigured = false;
  });
});
