import { ComboRpcService } from './combo-rpc.service';

describe('ComboRpcService', () => {
  const rpc = jest.fn();
  const supabase = { isConfigured: true, getClient: () => ({ rpc }) };
  let service: ComboRpcService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ComboRpcService(supabase as never);
  });

  it('getPremiumGiftsCatalog maps items', async () => {
    rpc.mockResolvedValue({
      data: {
        items: [
          {
            premiumGiftId: 'pg-1',
            giftId: 'g-1',
            name: 'Diamond',
            coinCost: 1000,
            badgeLabel: 'Premium',
          },
        ],
      },
      error: null,
    });
    const result = await service.getPremiumGiftsCatalog();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Diamond');
  });

  it('getComboStatus is self-scoped via user id param', async () => {
    rpc.mockResolvedValue({ data: { activeCombos: [] }, error: null });
    await service.getComboStatus('user-1');
    expect(rpc).toHaveBeenCalledWith('get_combo_status', { p_user_id: 'user-1' });
  });
});
