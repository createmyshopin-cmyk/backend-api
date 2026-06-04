import { IsOptional, IsString, IsIn } from 'class-validator';

export class DateRangeQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(['today', '7days', '30days', 'custom'])
  range?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

export class ChartQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(['7', '30'])
  days?: string;
}
