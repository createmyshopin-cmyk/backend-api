import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsBoolean,
  IsPositive,
  Min,
  MaxLength,
  IsIn,
  IsUUID,
} from 'class-validator';

// ── Create Order ─────────────────────────────────────────────────────────────

export class CreateOrderDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    description: 'UUID of the coin_packages row the user wants to purchase',
  })
  @IsUUID()
  @IsNotEmpty()
  packageId: string;
}

// ── Verify Payment ────────────────────────────────────────────────────────────

export class VerifyPaymentDto {
  // ── Razorpay checkout flow (all three required together) ──────────────────
  @ApiPropertyOptional({
    example: 'order_Nz82Bcx90Pxxx',
    description: 'Razorpay order ID returned by /payments/create-order',
  })
  @IsString()
  @IsOptional()
  razorpayOrderId?: string;

  @ApiPropertyOptional({
    example: 'pay_Nz82Bcx90Pxxx',
    description: 'Razorpay payment ID from checkout success callback',
  })
  @IsString()
  @IsOptional()
  razorpayPaymentId?: string;

  @ApiPropertyOptional({
    example: 'abc123hexsignature...',
    description: 'HMAC-SHA256 signature from Razorpay checkout callback',
  })
  @IsString()
  @IsOptional()
  razorpaySignature?: string;

  // ── Internal / mock checkout flow ────────────────────────────────────────
  @ApiPropertyOptional({
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    description: 'Internal payments.id — used for dev/mock checkout only',
  })
  @IsString()
  @IsOptional()
  paymentId?: string;

  @ApiPropertyOptional({
    example: 'mock_txn_123456',
    description: 'Internal transaction ID — used for dev/mock checkout only',
  })
  @IsString()
  @IsOptional()
  transactionId?: string;
}

// ── Coin Packages ─────────────────────────────────────────────────────────────

export class CreatePackageDto {
  @ApiProperty({ example: 'Starter Pack', description: 'Display name of the coin package' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Great for new users', description: 'Optional promo description' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @ApiProperty({ example: 100, description: 'Base coins included in the package' })
  @IsNumber()
  @IsPositive()
  coins: number;

  @ApiProperty({ example: 10, description: 'Bonus coins credited on top of base coins' })
  @IsNumber()
  @Min(0)
  bonusCoins: number;

  @ApiProperty({ example: 99.00, description: 'Price in the specified currency' })
  @IsNumber()
  @IsPositive()
  price: number;

  @ApiPropertyOptional({ example: 'INR', description: 'ISO 4217 currency code (default: INR)' })
  @IsString()
  @IsOptional()
  @IsIn(['INR', 'USD', 'EUR', 'GBP'])
  currency?: string;

  @ApiPropertyOptional({ example: 1, description: 'Display order in the app (ascending)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  sortOrder?: number;
}

/** All fields optional for PATCH updates */
export class UpdatePackageDto extends PartialType(CreatePackageDto) {
  @ApiPropertyOptional({ example: true, description: 'Set false to deactivate (soft-delete)' })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}
