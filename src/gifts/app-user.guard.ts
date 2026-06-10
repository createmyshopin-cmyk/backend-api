import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AdminRequestUser } from '../auth/admin-user.types';

/** Restricts route to mobile/app users — rejects admin panel JWTs. */
@Injectable()
export class AppUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as
      | AdminRequestUser
      | { type?: string }
      | undefined;

    if (user && 'type' in user && user.type === 'admin') {
      throw new ForbiddenException('This endpoint requires an app user account');
    }
    return true;
  }
}
