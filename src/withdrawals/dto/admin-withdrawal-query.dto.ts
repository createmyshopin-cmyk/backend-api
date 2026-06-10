import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class AdminWithdrawalListQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'paid', 'rejected', 'cancelled', 'failed'])
  status?: string;

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
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsUUID()
  creatorId?: string;

  @IsOptional()
  @Type(() => Number)
  minAmount?: number;

  @IsOptional()
  @Type(() => Number)
  maxAmount?: number;

  @IsOptional()
  @IsString()
  search?: string;
}
