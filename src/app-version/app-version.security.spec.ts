import { ExecutionContext, BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppVersionGuard } from './app-version.guard';
import { AppVersionService } from './app-version.service';

describe('AppVersionGuard security', () => {
  const reflector = new Reflector();
  let service: jest.Mocked<Pick<AppVersionService, 'assertVersionSupported'>>;
  let guard: AppVersionGuard;

  beforeEach(() => {
    service = { assertVersionSupported: jest.fn() };
    guard = new AppVersionGuard(service as never, reflector);
  });

  function ctx(headers: Record<string, string>, user?: object): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ headers, user }),
      }),
    } as ExecutionContext;
  }

  it('skips when no version header (legacy APK grace)', async () => {
    await expect(
      guard.canActivate(ctx({}, { id: 'u1' })),
    ).resolves.toBe(true);
    expect(service.assertVersionSupported).not.toHaveBeenCalled();
  });

  it('enforces when version header present', async () => {
    service.assertVersionSupported.mockRejectedValue(
      new BadRequestException({ code: 'APP_UPDATE_REQUIRED' }),
    );
    await expect(
      guard.canActivate(
        ctx({ 'x-app-version': '2.0.0', 'x-app-platform': 'android' }, { id: 'u1' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('skips admin users', async () => {
    await expect(
      guard.canActivate(
        ctx({ 'x-app-version': '1.0.0' }, { type: 'admin', id: 'a1' }),
      ),
    ).resolves.toBe(true);
    expect(service.assertVersionSupported).not.toHaveBeenCalled();
  });
});
