import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const UPI_PATTERN = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9]{2,64}$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export class PutPayoutAccountDto {
  @IsIn(['upi', 'bank'])
  type!: 'upi' | 'bank';

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  accountHolderName!: string;

  @IsOptional()
  @IsString()
  @Matches(UPI_PATTERN, { message: 'Invalid UPI ID format' })
  upiId?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(18)
  bankAccountNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(IFSC_PATTERN, { message: 'Invalid IFSC code format' })
  bankIfsc?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;
}
