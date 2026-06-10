import { ForbiddenException } from '@nestjs/common';

export const INVALID_CALL_ROLE_CODE = 'INVALID_CALL_ROLE';
export const INVALID_CALL_ROLE_MESSAGE = 'Only users can call creators.';

export interface CallRoleUser {
  isCreator?: boolean;
}

export function invalidCallRoleException(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: INVALID_CALL_ROLE_CODE,
    message: INVALID_CALL_ROLE_MESSAGE,
  });
}

/** Caller must be a normal user; receiver must be a creator. */
export function assertValidCallRoles(
  caller: CallRoleUser,
  receiver: CallRoleUser,
): void {
  if (caller.isCreator) {
    throw invalidCallRoleException();
  }
  if (!receiver.isCreator) {
    throw invalidCallRoleException();
  }
}
