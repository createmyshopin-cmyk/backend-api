import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

const logger = new Logger('MessageErrors');

export function mapMessageRpcError(
  error: { message?: string; code?: string },
  rpc: string,
): never {
  const msg = error.message ?? 'unknown_error';
  logger.warn(`${rpc}: ${msg}`);

  if (msg.includes('session_not_found')) {
    throw new NotFoundException({
      statusCode: 404,
      error: 'not_found',
      code: 'session_not_found',
      message: 'Conversation session not found',
    });
  }
  if (msg.includes('session_not_participant')) {
    throw new ForbiddenException({
      statusCode: 403,
      error: 'forbidden',
      code: 'session_not_participant',
      message: 'You are not a participant in this conversation',
    });
  }
  if (msg.includes('session_locked')) {
    throw new ForbiddenException({
      statusCode: 403,
      error: 'forbidden',
      code: 'session_locked',
      message: 'Unlock the conversation before sending messages',
    });
  }
  if (msg.includes('paid_messages_disabled')) {
    throw new ForbiddenException({
      statusCode: 403,
      error: 'forbidden',
      code: 'paid_messages_disabled',
      message: 'Paid messages are currently disabled',
    });
  }
  if (msg.includes('insufficient_balance')) {
    throw new ConflictException({
      statusCode: 409,
      error: 'conflict',
      code: 'insufficient_balance',
      message: 'Insufficient coin balance',
    });
  }
  if (msg.includes('idempotency_key_required')) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'bad_request',
      code: 'idempotency_key_required',
      message: 'Idempotency-Key header is required',
    });
  }
  if (msg.includes('invalid_unlock_type')) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'bad_request',
      code: 'invalid_unlock_type',
      message: 'Invalid unlock type',
    });
  }

  throw new ConflictException({
    statusCode: 409,
    error: 'conflict',
    code: 'message_failed',
    message: msg,
  });
}
