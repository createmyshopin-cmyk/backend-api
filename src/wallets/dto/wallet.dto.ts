import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class AdjustCoinsDto {
  @ApiProperty({ example: 'USR001' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ example: 100, description: 'Positive to add coins, negative to deduct' })
  @IsNumber()
  amount: number;

  @ApiProperty({ example: 'Admin adjustment bonus' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
