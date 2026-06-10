import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const RECON_TIERS = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'] as const;

export class ReconciliationLimitQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

export class ReconciliationFindingsQueryDto extends ReconciliationLimitQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsString()
  check_id?: string;
}

export class ReconciliationRunNowDto {
  @IsIn([...RECON_TIERS])
  tier!: (typeof RECON_TIERS)[number];
}
