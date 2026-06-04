import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class EndCallDto {
  @ApiProperty({
    example: 420,
    description: 'Final call duration in seconds (backend computes coin deduction)',
  })
  @IsNumber()
  @Min(0)
  duration: number;

  @ApiPropertyOptional({
    example: 'user_hangup',
    description: 'Why the call ended',
    enum: ['user_hangup', 'creator_hangup', 'insufficient_coins', 'network_failure', 'missed_call'],
  })
  @IsOptional()
  @IsString()
  endedReason?: string;
}
