import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class VerifyPaymentDto {
  @ApiProperty({ example: 'PAY001', required: false })
  @IsString()
  @IsOptional()
  paymentId?: string;

  @ApiProperty({ example: 'pay_Nz82Bcx90P', required: false })
  @IsString()
  @IsOptional()
  transactionId?: string;

  @ApiProperty({ example: 'order_Nz82Bcx90P', required: false })
  @IsString()
  @IsOptional()
  razorpayOrderId?: string;

  @ApiProperty({ example: 'pay_Nz82Bcx90P', required: false })
  @IsString()
  @IsOptional()
  razorpayPaymentId?: string;

  @ApiProperty({ example: 'abc123signature...', required: false })
  @IsString()
  @IsOptional()
  razorpaySignature?: string;
}

export class CreateOrderDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' })
  @IsString()
  @IsNotEmpty()
  packageId: string;
}

export class CreatePackageDto {
  @ApiProperty({ example: 'Starter Pack' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 100 })
  @IsNumber()
  coins: number;

  @ApiProperty({ example: 10 })
  @IsNumber()
  bonusCoins: number;

  @ApiProperty({ example: 99 })
  @IsNumber()
  price: number;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  enabled?: boolean;
}

