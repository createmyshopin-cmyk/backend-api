import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { User } from '../users/users.service';

@Injectable()
export class CreatorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as User | undefined;

    if (!user?.isCreator) {
      throw new ForbiddenException('Creator access required');
    }

    if (user.status !== 'active') {
      throw new ForbiddenException('Creator account is not active');
    }

    return true;
  }
}
