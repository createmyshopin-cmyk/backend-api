import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { SKIP_APP_VERSION_KEY } from './skip-app-version.decorator';
import { AppVersionService } from './app-version.service';

@Injectable()
export class AppVersionGuard implements CanActivate {
  constructor(
    private readonly appVersion: AppVersionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_APP_VERSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || user.type === 'admin') return true;

    const installedVersion = request.headers['x-app-version'] as string | undefined;
    if (!installedVersion?.trim()) {
      return true;
    }
    const platform = request.headers['x-app-platform'] as
      | 'android'
      | 'ios'
      | undefined;

    await this.appVersion.assertVersionSupported(installedVersion, platform);
    return true;
  }
}
