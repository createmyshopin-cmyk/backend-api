import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ADMIN_ROLES } from './admin-roles';
import type { AdminRequestUser } from './admin-user.types';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as AdminRequestUser | undefined;

    if (!user || user.type !== 'admin') {
      throw new UnauthorizedException('Admin access required');
    }

    if (user.status !== 'active') {
      throw new ForbiddenException('Admin account is not active');
    }

    if (!ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
