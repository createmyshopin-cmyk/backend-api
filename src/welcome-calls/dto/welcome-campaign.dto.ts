import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { WELCOME_ASSIGNMENT_STRATEGIES } from '../welcome-calls.constants';

export class UpsertWelcomeCampaignDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ minimum: 50, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(100)
  rewardCoins?: number;

  @ApiPropertyOptional({ maximum: 600 })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(600)
  maxDurationSeconds?: number;

  @ApiPropertyOptional({ enum: WELCOME_ASSIGNMENT_STRATEGIES })
  @IsOptional()
  @IsIn([...WELCOME_ASSIGNMENT_STRATEGIES])
  assignmentStrategy?: (typeof WELCOME_ASSIGNMENT_STRATEGIES)[number];
}

export class WelcomeCampaignResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty()
  rewardCoins!: number;

  @ApiProperty()
  maxDurationSeconds!: number;

  @ApiProperty()
  assignmentStrategy!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
