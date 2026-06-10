import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/** Restricts route to mobile/app users — rejects admin panel JWTs (e.g. ADM001). */
@Injectable()
export class AppUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as
      | { type?: string; id?: string; role?: string }
      | undefined;

    if (!user?.id) {
      return true;
    }

    if (user.type === 'admin' || user.id.startsWith('ADM')) {
      throw new ForbiddenException('This endpoint requires an app user account');
    }

    return true;
  }
}
