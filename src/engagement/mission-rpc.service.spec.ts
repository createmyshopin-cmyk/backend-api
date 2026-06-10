import { MissionRpcService } from './mission-rpc.service';

describe('MissionRpcService', () => {
  const rpc = jest.fn();
  const supabase = {
    isConfigured: true,
    getClient: () => ({ rpc }),
  };

  let service: MissionRpcService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MissionRpcService(supabase as never);
  });

  it('getDailyMissionsBoard maps missions', async () => {
    rpc.mockResolvedValue({
      data: {
        missionDate: '2026-06-10',
        missions: [
          {
            id: 'mp-1',
            missionKey: 'daily_login',
            title: 'Login',
            description: 'Open app',
            missionType: 'login',
            progress: 1,
            target: 1,
            status: 'completed',
            rewardXp: 10,
            rewardCoins: 0,
          },
        ],
      },
      error: null,
    });

    const board = await service.getDailyMissionsBoard('user-1');
    expect(board.missionDate).toBe('2026-06-10');
    expect(board.missions).toHaveLength(1);
    expect(board.missions[0].missionKey).toBe('daily_login');
    expect(rpc).toHaveBeenCalledWith('get_daily_missions_board', {
      p_user_id: 'user-1',
    });
  });

  it('claimMissionReward forwards idempotency key', async () => {
    rpc.mockResolvedValue({ data: { status: 'claimed' }, error: null });
    await service.claimMissionReward('user-1', 'mp-1', 'idem-1');
    expect(rpc).toHaveBeenCalledWith('claim_mission_reward', {
      p_user_id: 'user-1',
      p_mission_progress_id: 'mp-1',
      p_idempotency_key: 'idem-1',
    });
  });

  it('incrementMissionProgress is no-op when supabase not configured', async () => {
    const offline = new MissionRpcService({ isConfigured: false } as never);
    await offline.incrementMissionProgress('u', 'send_gift', 'g1', 'k1');
    expect(rpc).not.toHaveBeenCalled();
  });
});
