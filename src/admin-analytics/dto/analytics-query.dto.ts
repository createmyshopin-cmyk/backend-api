import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export type TimeWindow = '7d' | '30d' | 'lifetime';

export class TimeWindowQueryDto {
  @IsOptional()
  @IsIn(['7d', '30d', 'lifetime'])
  window?: TimeWindow = '7d';
}

export class PaginatedAnalyticsQueryDto extends TimeWindowQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  cursor?: string;
}

export class InactiveCreatorsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  days?: number = 30;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  cursor?: string;
}

export class NewCreatorsQueryDto {
  @IsOptional()
  @IsIn(['7d', '30d'])
  window?: '7d' | '30d' = '7d';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  cursor?: string;
}

export class LeaderboardQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsIn(['follows', 'favorites'])
  type?: 'follows' | 'favorites' = 'follows';
}
