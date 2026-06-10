import { AdminAuditService } from './admin-audit.service';

describe('AdminAuditService', () => {
  const supabase = { isConfigured: false, getClient: jest.fn() };
  const service = new AdminAuditService(supabase as any);

  it('records authz_denied events', async () => {
    const id = await service.record({
      actorType: 'admin',
      actorId: 'admin-1',
      actorEmail: 'mod@test.com',
      actorRole: 'moderator',
      action: 'authz_denied',
      category: 'authz',
      outcome: 'denied',
      resourceType: 'endpoint',
      resourceId: 'POST:/wallets/adjust',
      retentionClass: 'security',
      details: { required_roles: ['finance_admin'], caller_role: 'moderator' },
    });
    expect(id).toBeTruthy();
  });

  it('redacts UPI in details', async () => {
    const id = await service.record({
      actorType: 'admin',
      action: 'withdrawal_mark_paid',
      category: 'withdrawal',
      outcome: 'success',
      resourceType: 'withdrawal',
      resourceId: 'w1',
      details: { upi_id: 'user@ybl' },
      retentionClass: 'financial',
    });
    expect(id).toBeTruthy();
  });

  it('maps actor from admin request user', () => {
    const actor = service.actorFromRequest(
      {
        id: 'a1',
        email: 'fin@test.com',
        name: 'Fin',
        role: 'finance_admin',
        status: 'active',
        sessionId: 's1',
        type: 'admin',
      },
      { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } },
    );
    expect(actor.actorId).toBe('a1');
    expect(actor.actorRole).toBe('finance_admin');
  });
});
