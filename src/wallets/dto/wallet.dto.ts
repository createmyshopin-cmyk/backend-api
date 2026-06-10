import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

const REASON_CODES = ['reconciliation', 'goodwill', 'fraud', 'correction'] as const;

export class AdjustCoinsDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  userId: string;

  @ApiProperty({ example: 100, description: 'Positive to add coins, negative to deduct' })
  @IsNumber()
  amount: number;

  @ApiProperty({ enum: REASON_CODES, example: 'goodwill' })
  @IsIn([...REASON_CODES])
  reasonCode: (typeof REASON_CODES)[number];

  @ApiProperty({ example: 'Support ticket #12345 — goodwill credit' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({
    description: 'Client retry key; server generates one if omitted',
    example: '550e8400-e29b-41d4-a716-446655440099',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
