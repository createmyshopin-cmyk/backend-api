import { ForbiddenException } from '@nestjs/common';
import { AppUserGuard } from './app-user.guard';

describe('AppUserGuard', () => {
  const guard = new AppUserGuard();

  it('rejects legacy admin tokens (ADM001)', () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'ADM001', role: 'super_admin', type: 'admin' },
        }),
      }),
    } as never;

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows app users with UUID ids', () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: '4f002dca-2813-4c26-8ed2-e02669d55e42' },
        }),
      }),
    } as never;

    expect(guard.canActivate(ctx)).toBe(true);
  });
});
