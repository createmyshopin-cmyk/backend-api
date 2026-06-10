import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

const logger = new Logger('EngagementErrors');

export function mapEngagementRpcError(error: { message?: string; code?: string }, rpc: string): never {
  const msg = error.message ?? 'unknown_error';
  logger.warn(`${rpc}: ${msg}`);

  if (msg.includes('creator_not_found')) {
    throw new NotFoundException({
      statusCode: 404,
      error: 'not_found',
      code: 'creator_not_found',
      message: 'Creator not found',
    });
  }
  if (msg.includes('cannot_follow_self')) {
    throw new ForbiddenException({
      statusCode: 403,
      error: 'forbidden',
      code: 'cannot_follow_self',
      message: 'You cannot follow yourself',
    });
  }
  if (msg.includes('creator_not_followable')) {
    throw new ForbiddenException({
      statusCode: 403,
      error: 'forbidden',
      code: 'creator_not_followable',
      message: 'Creator cannot be followed',
    });
  }
  if (msg.includes('favorite_limit_reached')) {
    throw new ConflictException({
      statusCode: 409,
      error: 'conflict',
      code: 'favorite_limit_reached',
      message: 'Favorite limit reached (max 50)',
    });
  }
  if (msg.includes('mission_not_completed')) {
    throw new ConflictException({
      statusCode: 409,
      error: 'conflict',
      code: 'mission_not_completed',
      message: 'Mission is not completed yet',
    });
  }
  if (msg.includes('mission_not_found')) {
    throw new NotFoundException({
      statusCode: 404,
      error: 'not_found',
      code: 'mission_not_found',
      message: 'Mission progress not found',
    });
  }
  if (msg.includes('reward_budget_exceeded')) {
    throw new ConflictException({
      statusCode: 429,
      error: 'too_many_requests',
      code: 'reward_budget_exceeded',
      message: 'Daily reward budget exceeded',
    });
  }
  if (msg.includes('milestone_not_reached')) {
    throw new ConflictException({
      statusCode: 409,
      error: 'conflict',
      code: 'milestone_not_reached',
      message: 'Streak milestone not reached',
    });
  }
  if (msg.includes('idempotency_key_required')) {
    throw new ConflictException({
      statusCode: 400,
      error: 'bad_request',
      code: 'idempotency_key_required',
      message: 'Idempotency-Key header is required',
    });
  }
  if (msg.includes('vip_already_active')) {
    throw new ConflictException({
      statusCode: 409,
      error: 'conflict',
      code: 'vip_already_active',
      message: 'You already have an active VIP membership',
    });
  }
  if (msg.includes('invalid_tier')) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'bad_request',
      code: 'invalid_tier',
      message: 'Invalid VIP tier',
    });
  }
  if (msg.includes('membership_not_found')) {
    throw new NotFoundException({
      statusCode: 404,
      error: 'not_found',
      code: 'membership_not_found',
      message: 'Membership not found',
    });
  }
  if (msg.includes('vip_disabled')) {
    throw new ForbiddenException({
      statusCode: 403,
      error: 'forbidden',
      code: 'vip_disabled',
      message: 'VIP memberships are currently disabled',
    });
  }

  throw new ConflictException({
    statusCode: 409,
    error: 'conflict',
    code: 'engagement_failed',
    message: msg,
  });
}
