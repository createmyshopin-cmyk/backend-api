import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

const logger = new Logger('WithdrawalErrors');

export type WithdrawalErrorCode =
  | 'creator_not_active'
  | 'insufficient_balance'
  | 'withdrawal_inflight'
  | 'daily_limit_exceeded'
  | 'monthly_limit_exceeded'
  | 'payout_account_missing'
  | 'kyc_required'
  | 'invalid_account'
  | 'below_min_withdrawal'
  | 'idempotency_key_required'
  | 'invalid_amount'
  | 'forbidden'
  | 'withdrawal_not_found'
  | 'invalid_transition'
  | 'withdrawal_frozen'
  | 'read_only';

export function mapWithdrawalRpcError(error: { message?: string }, context: string): never {
  const msg = error.message ?? 'withdrawal_rpc_failed';
  logger.warn(`${context}: ${msg}`);

  if (msg.includes('creator_profile_not_found')) {
    throw new BadRequestException({
      statusCode: 404,
      code: 'creator_profile_not_found',
      message: 'Creator profile not found',
    });
  }
  if (msg.includes('withdrawal_not_found')) {
    throw new BadRequestException({
      statusCode: 404,
      code: 'withdrawal_not_found',
      message: 'Withdrawal not found',
    });
  }
  if (msg.includes('forbidden')) {
    throw new ForbiddenException({
      statusCode: 403,
      code: 'forbidden',
      message: 'You do not have access to this withdrawal',
    });
  }
  if (msg.includes('insufficient_balance') || msg.includes('insufficient_available_balance')) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'insufficient_balance',
      message: 'Not enough available balance for this withdrawal',
    });
  }
  if (msg.includes('withdrawal_inflight') || msg.includes('inflight_withdrawal_exists')) {
    throw new ConflictException({
      statusCode: 409,
      code: 'withdrawal_inflight',
      message: 'You already have a withdrawal in progress',
      retryable: false,
    });
  }
  if (msg.includes('daily_limit_exceeded')) {
    throw new ForbiddenException({
      statusCode: 403,
      code: 'daily_limit_exceeded',
      message: 'Daily withdrawal limit reached',
      retryable: false,
    });
  }
  if (msg.includes('monthly_limit_exceeded')) {
    throw new ForbiddenException({
      statusCode: 403,
      code: 'monthly_limit_exceeded',
      message: 'Monthly withdrawal limit reached',
      retryable: false,
    });
  }
  if (msg.includes('payout_account_missing')) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'payout_account_missing',
      message: 'Add a payout account before requesting a withdrawal',
    });
  }
  if (msg.includes('kyc_required')) {
    throw new ForbiddenException({
      statusCode: 403,
      code: 'kyc_required',
      message: 'Verify your identity to withdraw this amount',
    });
  }
  if (msg.includes('invalid_account') || msg.includes('invalid_payout_account')) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'invalid_account',
      message: 'Payout account is invalid or unavailable',
    });
  }
  if (msg.includes('below_min_withdrawal')) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'below_min_withdrawal',
      message: msg,
    });
  }
  if (
    msg.includes('idempotency_key_required') ||
    msg.includes('invalid_amount') ||
    msg.includes('upi_id_required') ||
    msg.includes('account_number_required')
  ) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'validation_error',
      message: msg,
    });
  }
  if (msg.includes('invalid_transition') || msg.includes('withdrawal_cas_conflict')) {
    throw new ConflictException({
      statusCode: 409,
      code: 'invalid_transition',
      message: 'This withdrawal cannot be updated',
      retryable: false,
    });
  }

  throw new InternalServerErrorException({
    statusCode: 500,
    code: 'withdrawal_rpc_failed',
    message: `Withdrawal operation failed: ${msg}`,
  });
}

export function assertIdempotencyKey(key: string | undefined): string {
  if (!key?.trim()) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'idempotency_key_required',
      message: 'Idempotency-Key header is required',
    });
  }
  return key.trim();
}

export function readOnlyViolation(): never {
  throw new ForbiddenException({
    statusCode: 403,
    code: 'read_only',
    message: 'Account is read-only while suspended or wallet is frozen',
  });
}

export function isHttpExceptionWithCode(
  err: unknown,
  code: WithdrawalErrorCode,
): err is HttpException {
  if (!(err instanceof HttpException)) return false;
  const body = err.getResponse();
  return typeof body === 'object' && body !== null && (body as { code?: string }).code === code;
}
