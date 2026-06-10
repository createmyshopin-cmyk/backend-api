import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './auth.guard';
import { UsersService } from '../users/users.service';
import { AdminUsersService } from './admin-users.service';

describe('JwtAuthGuard (admin session)', () => {
  const jwt = { verify: jest.fn() } as unknown as JwtService;
  const users = {} as UsersService;
  const adminUsers: Pick<
    AdminUsersService,
    'findById' | 'getSession'
  > = {
    findById: jest.fn(),
    getSession: jest.fn(),
  };
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector;
  const guard = new JwtAuthGuard(jwt, users, adminUsers as AdminUsersService, reflector);

  const req = { headers: { authorization: 'Bearer tok' }, user: undefined };

  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it('rejects revoked admin session', async () => {
    (jwt.verify as jest.Mock).mockReturnValue({
      sub: 'admin-1',
      type: 'admin',
      sid: 'sess-1',
      role: 'finance_admin',
    });
    (adminUsers.findById as jest.Mock).mockResolvedValue({
      id: 'admin-1',
      role: 'finance_admin',
      status: 'active',
      email: 'f@t.com',
      name: 'F',
    });
    (adminUsers.getSession as jest.Mock).mockResolvedValue({
      id: 'sess-1',
      admin_id: 'admin-1',
      status: 'revoked',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      role_at_issue: 'finance_admin',
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when JWT role stale vs DB', async () => {
    (jwt.verify as jest.Mock).mockReturnValue({
      sub: 'admin-1',
      type: 'admin',
      sid: 'sess-1',
      role: 'moderator',
    });
    (adminUsers.findById as jest.Mock).mockResolvedValue({
      id: 'admin-1',
      role: 'finance_admin',
      status: 'active',
      email: 'f@t.com',
      name: 'F',
    });
    (adminUsers.getSession as jest.Mock).mockResolvedValue({
      id: 'sess-1',
      admin_id: 'admin-1',
      status: 'active',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      role_at_issue: 'moderator',
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow('Role changed');
  });
});
