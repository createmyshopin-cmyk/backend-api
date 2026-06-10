import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class WithdrawalRequestDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amountInr!: number;

  @IsUUID()
  payoutAccountId!: string;

  @IsOptional()
  @IsUUID()
  retryOfId?: string;
}

export class CancelWithdrawalDto {
  @IsOptional()
  reason?: string;
}
