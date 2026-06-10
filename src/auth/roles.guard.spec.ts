import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { AdminAuditService } from '../admin/admin-audit.service';

describe('RolesGuard', () => {
  const audit: Pick<AdminAuditService, 'record' | 'actorFromRequest'> = {
    record: jest.fn().mockResolvedValue('audit-id'),
    actorFromRequest: jest.fn().mockReturnValue({ actorType: 'admin' as const }),
  };

  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;

  const guard = new RolesGuard(reflector, audit as AdminAuditService);

  const context = (user?: { role?: string; type?: string }) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          user: user ? { ...user, type: 'admin', id: 'a1', email: 'a@test.com' } : undefined,
          method: 'POST',
          path: '/wallets/adjust',
          url: '/wallets/adjust',
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as any;

  beforeEach(() => jest.clearAllMocks());

  it('denies when @Roles metadata is missing', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    await expect(guard.canActivate(context({ role: 'super_admin' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'authz_denied', outcome: 'denied' }),
    );
  });

  it('denies when @Roles is empty', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([]);
    await expect(guard.canActivate(context({ role: 'super_admin' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows when role matches', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['finance_admin', 'super_admin']);
    await expect(
      guard.canActivate(context({ role: 'finance_admin' })),
    ).resolves.toBe(true);
  });

  it('denies support_admin on wallet adjust', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['finance_admin', 'super_admin']);
    await expect(guard.canActivate(context({ role: 'support_admin' }))).rejects.toMatchObject({
      response: { error: 'INSUFFICIENT_ROLE' },
    });
  });
});
