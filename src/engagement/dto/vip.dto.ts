import { IsIn, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class VipSubscribeDto {
  @IsIn(['silver', 'gold', 'platinum'])
  @IsNotEmpty()
  tier!: string;

  @IsIn(['razorpay'])
  @IsNotEmpty()
  paymentMethod!: string;

  @IsOptional()
  @IsUUID()
  membershipId?: string;

  @IsOptional()
  razorpayOrderId?: string;

  @IsOptional()
  razorpayPaymentId?: string;

  @IsOptional()
  razorpaySignature?: string;
}
