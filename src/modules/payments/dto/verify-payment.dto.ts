import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

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
