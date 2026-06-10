import { MissionProgressHook } from './mission-progress.hook';

describe('MissionProgressHook', () => {
  const missionRpc = {
    incrementMissionProgress: jest.fn(),
  };

  let hook: MissionProgressHook;

  beforeEach(() => {
    jest.clearAllMocks();
    hook = new MissionProgressHook(missionRpc as never);
  });

  it('onGiftSent increments send_gift with gift idempotency', async () => {
    missionRpc.incrementMissionProgress.mockResolvedValue(undefined);
    await hook.onGiftSent('user-1', 'gift-tx-1');
    expect(missionRpc.incrementMissionProgress).toHaveBeenCalledWith(
      'user-1',
      'send_gift',
      'gift-tx-1',
      'gift:gift-tx-1',
    );
  });

  it('onCallCompleted swallows RPC errors', async () => {
    missionRpc.incrementMissionProgress.mockRejectedValue(new Error('rpc down'));
    await expect(hook.onCallCompleted('user-1', 'call-1')).resolves.toBeUndefined();
  });

  it('onWalletRecharge uses recharge idempotency key', async () => {
    missionRpc.incrementMissionProgress.mockResolvedValue(undefined);
    await hook.onWalletRecharge('user-1', 'pay-1');
    expect(missionRpc.incrementMissionProgress).toHaveBeenCalledWith(
      'user-1',
      'recharge_wallet',
      'pay-1',
      'recharge:pay-1',
    );
  });
});
