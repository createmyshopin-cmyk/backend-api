import { EngagementController } from './engagement.controller';

describe('EngagementController', () => {
  const service = {
    follow: jest.fn(),
    unfollow: jest.fn(),
    favorite: jest.fn(),
    unfavorite: jest.fn(),
    listFollows: jest.fn(),
    listFavorites: jest.fn(),
    getLevels: jest.fn(),
    getMissions: jest.fn(),
    claimReward: jest.fn(),
    getStreak: jest.fn(),
    getRewards: jest.fn(),
    getPremiumGifts: jest.fn(),
    getComboStatus: jest.fn(),
    getComboHistory: jest.fn(),
  };

  let controller: EngagementController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new EngagementController(service as never);
  });

  it('POST follow uses authenticated user id', async () => {
    service.follow.mockResolvedValue({ following: true });
    await controller.follow(
      { user: { id: 'user-1' } },
      { creatorProfileId: 'profile-1' },
      'idem',
    );
    expect(service.follow).toHaveBeenCalledWith('user-1', 'profile-1', 'idem');
  });

  it('GET levels is self-scoped', async () => {
    service.getLevels.mockResolvedValue({ user: { currentLevel: 2 } });
    const result = await controller.getLevels({ user: { id: 'user-1' } });
    expect(service.getLevels).toHaveBeenCalledWith('user-1');
    expect(result.user.currentLevel).toBe(2);
  });

  it('POST missions/claim forwards idempotency key', async () => {
    service.claimReward.mockResolvedValue({ status: 'claimed' });
    await controller.claimMission(
      { user: { id: 'user-1' } },
      { missionProgressId: 'mp-1' },
      'idem-abc',
    );
    expect(service.claimReward).toHaveBeenCalledWith(
      'user-1',
      { missionProgressId: 'mp-1' },
      'idem-abc',
    );
  });

  it('GET streak is self-scoped', async () => {
    service.getStreak.mockResolvedValue({ currentStreak: 3 });
    const result = await controller.getStreak({ user: { id: 'user-1' } });
    expect(service.getStreak).toHaveBeenCalledWith('user-1');
    expect(result.currentStreak).toBe(3);
  });

  it('GET combo-status is self-scoped', async () => {
    service.getComboStatus.mockResolvedValue({ activeCombos: [] });
    await controller.getComboStatus({ user: { id: 'user-1' } });
    expect(service.getComboStatus).toHaveBeenCalledWith('user-1');
  });

  it('GET premium-gifts returns catalog', async () => {
    service.getPremiumGifts.mockResolvedValue({ items: [{ name: 'Diamond' }] });
    const result = await controller.getPremiumGifts();
    expect(result.items).toHaveLength(1);
  });
});
