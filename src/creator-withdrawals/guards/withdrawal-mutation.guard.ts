import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { CreatorAuthenticatedRequest } from '../../creator-dashboard/creator-scope.guard';
import { readOnlyViolation } from '../withdrawal-error.util';

@Injectable()
export class WithdrawalMutationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CreatorAuthenticatedRequest>();
    const scope = request.creatorScope;
    if (!scope) return true;

    if (scope.isSuspended || scope.isWalletFrozen) {
      readOnlyViolation();
    }

    return true;
  }
}
