import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const CALL_HISTORY_SORTS = ['started_at_desc', 'started_at_asc'] as const;
export const GIFT_HISTORY_SORTS = ['created_at_desc', 'created_at_asc'] as const;
export const WITHDRAWAL_HISTORY_SORTS = ['requested_at_desc', 'requested_at_asc'] as const;
export const CALL_STATUS_FILTERS = [
  'completed',
  'ended',
  'missed',
  'rejected',
  'cancelled',
  'active',
  'ongoing',
] as const;

export class HistoryPaginationQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsISO8601({ strict: false })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: false })
  to?: string;
}

export class CallHistoryQueryDto extends HistoryPaginationQueryDto {
  @IsOptional()
  @IsIn([...CALL_HISTORY_SORTS])
  sort?: (typeof CALL_HISTORY_SORTS)[number];

  @IsOptional()
  @IsIn([...CALL_STATUS_FILTERS])
  status?: (typeof CALL_STATUS_FILTERS)[number];
}

export class GiftHistoryQueryDto extends HistoryPaginationQueryDto {
  @IsOptional()
  @IsIn([...GIFT_HISTORY_SORTS])
  sort?: (typeof GIFT_HISTORY_SORTS)[number];

  @IsOptional()
  @IsUUID()
  giftId?: string;
}

export class WithdrawalHistoryQueryDto extends HistoryPaginationQueryDto {
  @IsOptional()
  @IsIn([...WITHDRAWAL_HISTORY_SORTS])
  sort?: (typeof WITHDRAWAL_HISTORY_SORTS)[number];

  @IsOptional()
  @IsIn(['pending', 'approved', 'paid', 'rejected', 'cancelled', 'failed'])
  status?: string;
}
