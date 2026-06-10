import { VipRpcService } from './vip-rpc.service';

describe('VipRpcService', () => {
  const rpc = jest.fn();
  const supabase = { isConfigured: true, getClient: () => ({ rpc }) };
  let service: VipRpcService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VipRpcService(supabase as never);
  });

  it('getVipPlans calls RPC', async () => {
    rpc.mockResolvedValue({ data: { plans: [] }, error: null });
    await service.getVipPlans();
    expect(rpc).toHaveBeenCalledWith('get_vip_plans');
  });

  it('initiateSubscription forwards idempotency', async () => {
    rpc.mockResolvedValue({ data: { membershipId: 'm-1' }, error: null });
    await service.initiateSubscription({
      userId: 'u-1',
      tier: 'gold',
      idempotencyKey: 'idem-1',
      gatewayOrderId: 'order-1',
      amountPaise: 59900,
    });
    expect(rpc).toHaveBeenCalledWith('initiate_vip_subscription', {
      p_user_id: 'u-1',
      p_tier: 'gold',
      p_idempotency_key: 'idem-1',
      p_gateway_order_id: 'order-1',
      p_amount_paise: 59900,
    });
  });

  it('getVipStatus is self-scoped', async () => {
    rpc.mockResolvedValue({ data: { active: true }, error: null });
    await service.getVipStatus('user-1');
    expect(rpc).toHaveBeenCalledWith('get_vip_status', { p_user_id: 'user-1' });
  });
});
