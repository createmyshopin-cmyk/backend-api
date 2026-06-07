import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    const allowedRoles = ['super_admin', 'finance_admin', 'moderator'];
    if (!user?.role || !allowedRoles.includes(user.role)) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
