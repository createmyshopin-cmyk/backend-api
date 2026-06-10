import { VipController } from './vip.controller';

describe('VipController', () => {
  const service = {
    getPlans: jest.fn(),
    getStatus: jest.fn(),
    getHistory: jest.fn(),
    subscribe: jest.fn(),
  };

  let controller: VipController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new VipController(service as never);
  });

  it('GET status is self-scoped', async () => {
    service.getStatus.mockResolvedValue({ active: true, tier: 'gold' });
    const result = await controller.getStatus({ user: { id: 'user-1' } });
    expect(service.getStatus).toHaveBeenCalledWith('user-1');
    expect(result.tier).toBe('gold');
  });

  it('POST subscribe forwards idempotency key', async () => {
    service.subscribe.mockResolvedValue({ membership: { status: 'pending' } });
    await controller.subscribe(
      { user: { id: 'user-1' } },
      { tier: 'silver', paymentMethod: 'razorpay' },
      'idem-vip',
    );
    expect(service.subscribe).toHaveBeenCalledWith(
      'user-1',
      { tier: 'silver', paymentMethod: 'razorpay' },
      'idem-vip',
    );
  });
});
