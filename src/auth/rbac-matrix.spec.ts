/**
 * RBAC matrix — documents expected allow/deny per role for critical admin endpoints.
 * Each case asserts RolesGuard behavior (identity layer tested separately).
 */
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { AdminAuditService } from '../admin/admin-audit.service';
import type { AdminRole } from './admin-roles';
import { ALL_ADMIN_ROLES } from './admin-roles';

type MatrixCase = {
  route: string;
  allowed: AdminRole[];
};

const MATRIX: MatrixCase[] = [
  { route: 'POST /wallets/adjust', allowed: ['super_admin', 'finance_admin'] },
  { route: 'POST /payments/:id/refund', allowed: ['super_admin', 'finance_admin'] },
  { route: 'POST /admin/withdrawals/:id/approve', allowed: ['super_admin', 'finance_admin'] },
  { route: 'GET /admin/finance/export/revenue', allowed: ['super_admin', 'finance_admin'] },
  { route: 'GET /admin/users', allowed: ['super_admin', 'moderator', 'support_admin', 'fraud_admin'] },
  { route: 'POST /admin/users/:id/block', allowed: ['super_admin', 'moderator', 'fraud_admin'] },
  { route: 'GET /admin/dashboard', allowed: [...ALL_ADMIN_ROLES] },
  { route: 'POST /admin/invites', allowed: ['super_admin'] },
];

describe('RBAC matrix (RolesGuard)', () => {
  const audit: Pick<AdminAuditService, 'record' | 'actorFromRequest'> = {
    record: jest.fn().mockResolvedValue(''),
    actorFromRequest: jest.fn().mockReturnValue({ actorType: 'admin' as const }),
  };
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const guard = new RolesGuard(reflector, audit as AdminAuditService);

  const ctx = (role: AdminRole) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          user: { type: 'admin', role, id: 'x', email: 'x@t.com' },
          method: 'GET',
          path: '/test',
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as any;

  for (const { route, allowed } of MATRIX) {
    describe(route, () => {
      beforeEach(() => {
        (reflector.getAllAndOverride as jest.Mock).mockReturnValue(allowed);
      });

      for (const role of ALL_ADMIN_ROLES) {
        const shouldAllow = allowed.includes(role);
        it(`${role} → ${shouldAllow ? '200' : '403'}`, async () => {
          if (shouldAllow) {
            await expect(guard.canActivate(ctx(role))).resolves.toBe(true);
          } else {
            await expect(guard.canActivate(ctx(role))).rejects.toMatchObject({
              response: { error: 'INSUFFICIENT_ROLE' },
            });
          }
        });
      }
    });
  }
});
