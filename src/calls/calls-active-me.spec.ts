import { CallsService } from './calls.service';

describe('CallsService.getActiveCallForUser', () => {
  const service = Object.create(CallsService.prototype) as CallsService;
  Object.assign(service, {
    supabase: { isConfigured: false },
    memCalls: [],
  });

  it('returns null session for non-UUID user ids without querying Supabase', async () => {
    const result = await service.getActiveCallForUser('ADM001');
    expect(result).toEqual({
      success: true,
      callSession: null,
      userId: 'ADM001',
    });
  });
});
