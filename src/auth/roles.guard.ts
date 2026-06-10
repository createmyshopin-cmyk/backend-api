import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import type { AdminRole } from './admin-roles';
import { AdminAuditService } from '../admin/admin-audit.service';
import type { AdminRequestUser } from './admin-user.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AdminAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      await this.deny(context, [], 'MISSING_ROLES_METADATA');
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Insufficient role',
        error: 'INSUFFICIENT_ROLE',
      });
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AdminRequestUser | undefined;
    const actualRole = user?.role;

    if (!actualRole || !requiredRoles.includes(actualRole)) {
      await this.deny(context, requiredRoles, actualRole ?? 'none');
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Insufficient role',
        error: 'INSUFFICIENT_ROLE',
      });
    }

    return true;
  }

  private async deny(
    context: ExecutionContext,
    requiredRoles: AdminRole[],
    actualRole: string,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AdminRequestUser | undefined;

    try {
      await this.audit.record({
        ...this.audit.actorFromRequest(user, request),
        action: 'authz_denied',
        category: 'authz',
        outcome: 'denied',
        resourceType: 'endpoint',
        resourceId: `${request.method}:${request.path ?? request.url}`,
        httpMethod: request.method,
        httpPath: request.path ?? request.url,
        retentionClass: 'security',
        details: {
          required_roles: requiredRoles,
          caller_role: actualRole,
          http_path: request.path ?? request.url,
          http_method: request.method,
        },
      });
    } catch {
      // Non-blocking for authz denial path
    }
  }
}
