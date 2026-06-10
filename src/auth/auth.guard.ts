import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { AdminUsersService } from './admin-users.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AdminRequestUser } from './admin-user.types';

interface JwtPayload {
  userId?: string;
  sub?: string;
  role?: string;
  type?: string;
  sid?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly adminUsersService: AdminUsersService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.split(' ')[1];

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const userId = payload.userId ?? payload.sub;
    if (!userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    if (payload.type === 'admin') {
      return this.validateAdminSession(request, payload, userId);
    }

    try {
      const user = await this.usersService.findOne(userId);
      if (user.status === 'blocked' || user.status === 'suspended') {
        throw new ForbiddenException('Account is not active');
      }
      request.user = user;
      return true;
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      throw new UnauthorizedException('Authenticated user not found');
    }
  }

  private async validateAdminSession(
    request: { user?: AdminRequestUser },
    payload: JwtPayload,
    adminId: string,
  ): Promise<boolean> {
    if (!payload.sid) {
      throw new UnauthorizedException('Admin session invalid');
    }

    const [admin, session] = await Promise.all([
      this.adminUsersService.findById(adminId),
      this.adminUsersService.getSession(payload.sid),
    ]);

    if (!admin || admin.status !== 'active') {
      throw new UnauthorizedException('Admin account inactive or not found');
    }

    if (!session || session.status !== 'active') {
      throw new UnauthorizedException('Session revoked or expired');
    }

    if (new Date(session.expires_at) < new Date()) {
      throw new UnauthorizedException('Session expired');
    }

    if (session.admin_id !== admin.id) {
      throw new UnauthorizedException('Session mismatch');
    }

    if (payload.role && payload.role !== admin.role) {
      throw new UnauthorizedException('Role changed — re-login required');
    }

    const user: AdminRequestUser = {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      status: admin.status,
      sessionId: session.id,
      type: 'admin',
    };
    request.user = user;
    return true;
  }
}

/** @deprecated Use JwtAuthGuard */
export { JwtAuthGuard as AuthGuard };
