import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendGiftDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  giftId: string;

  @ApiProperty({ format: 'uuid', description: 'Creator/listener user id' })
  @IsUUID()
  creatorId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  callId: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Client-generated UUID. Generate once per tap; reuse on network retry.',
  })
  @IsUUID()
  idempotencyKey: string;
}

export const GIFT_REPLY_MESSAGES = [
  '❤️ Thank You',
  '🙏 Appreciate It',
  '🔥 You\'re Amazing',
  '✨ Made My Day',
] as const;

export type GiftReplyMessage = (typeof GIFT_REPLY_MESSAGES)[number];

export class GiftReplyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  giftTransactionId: string;

  @ApiProperty({ enum: GIFT_REPLY_MESSAGES })
  @IsString()
  @IsIn([...GIFT_REPLY_MESSAGES])
  message: GiftReplyMessage;
}

export class CreateGiftDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  coinCost: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  iconUrl?: string;

  @ApiPropertyOptional({ default: 60 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  creatorSharePercent?: number;

  @ApiPropertyOptional({ default: 40 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  platformSharePercent?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateGiftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  coinCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  iconUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  creatorSharePercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  platformSharePercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
