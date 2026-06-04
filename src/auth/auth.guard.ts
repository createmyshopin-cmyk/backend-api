import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';

interface JwtPayload {
  userId?: string;
  sub?: string;
  role?: string;
  type?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    if (payload.type === 'admin' || userId.startsWith('ADM')) {
      request.user = {
        id: userId,
        name: 'Admin User',
        role: payload.role ?? 'admin',
      };
      return true;
    }

    try {
      const user = await this.usersService.findOne(userId);
      request.user = user;
      return true;
    } catch {
      throw new UnauthorizedException('Authenticated user not found');
    }
  }
}

/** @deprecated Use JwtAuthGuard */
export { JwtAuthGuard as AuthGuard };
