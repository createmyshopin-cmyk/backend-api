import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateWithdrawalDto {
  @ApiProperty({ example: 150 })
  @IsNumber()
  @Min(100)
  @IsNotEmpty()
  amount: number;

  @ApiProperty({ example: 'upi', description: 'upi or bank' })
  @IsString()
  @IsNotEmpty()
  paymentMethod: string;

  @ApiProperty({ example: 'John Doe', required: false })
  @IsString()
  @IsOptional()
  bankAccountName?: string;

  @ApiProperty({ example: '1234567890', required: false })
  @IsString()
  @IsOptional()
  bankAccountNumber?: string;

  @ApiProperty({ example: 'HDFC0000240', required: false })
  @IsString()
  @IsOptional()
  bankIfsc?: string;

  @ApiProperty({ example: 'john@okaxis', required: false })
  @IsString()
  @IsOptional()
  upiId?: string;
}

export class RejectWithdrawalDto {
  @ApiProperty({ example: 'Invalid bank account number' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class MarkPaidDto {
  @ApiProperty({ example: 'txn_982374823' })
  @IsString()
  @IsNotEmpty()
  referenceNumber: string;

  @ApiProperty({ example: 'Paid via bank transfer', required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}
