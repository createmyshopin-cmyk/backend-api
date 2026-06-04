import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ListAdminUsersDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Search by name, phone, or user ID' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['all', 'male', 'female'] })
  @IsOptional()
  @IsIn(['all', 'male', 'female'])
  gender?: 'all' | 'male' | 'female';

  @ApiPropertyOptional({ enum: ['all', 'online', 'offline'] })
  @IsOptional()
  @IsIn(['all', 'online', 'offline'])
  status?: 'all' | 'online' | 'offline';

  @ApiPropertyOptional({ enum: ['all', 'completed', 'not_completed'] })
  @IsOptional()
  @IsIn(['all', 'completed', 'not_completed'])
  onboarding?: 'all' | 'completed' | 'not_completed';

  @ApiPropertyOptional({
    enum: ['createdAt', 'fullName', 'coins', 'totalCalls'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['createdAt', 'fullName', 'coins', 'totalCalls'])
  sortBy?: 'createdAt' | 'fullName' | 'coins' | 'totalCalls' = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
