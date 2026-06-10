import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class MessagePaginationDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

export class SendMessageDto {
  @ApiPropertyOptional({ description: 'Existing session; omit when starting via creatorProfileId' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({ description: 'Creator profile when opening a new conversation' })
  @ValidateIf((o: SendMessageDto) => !o.sessionId)
  @IsUUID()
  creatorProfileId?: string;

  @ApiProperty({ enum: ['text', 'voice_note'] })
  @IsIn(['text', 'voice_note'])
  messageType!: 'text' | 'voice_note';

  @ApiPropertyOptional()
  @ValidateIf((o: SendMessageDto) => o.messageType === 'text')
  @IsString()
  @MaxLength(4000)
  bodyText?: string;

  @ApiPropertyOptional()
  @ValidateIf((o: SendMessageDto) => o.messageType === 'voice_note')
  @IsString()
  @MaxLength(2048)
  voiceUrl?: string;

  @ApiPropertyOptional()
  @ValidateIf((o: SendMessageDto) => o.messageType === 'voice_note')
  @IsOptional()
  @IsInt()
  @Min(0)
  voiceDurationMs?: number;
}

export class UnlockMessageDto {
  @ApiProperty()
  @IsUUID()
  sessionId!: string;

  @ApiProperty({ enum: ['session_24h'] })
  @IsIn(['session_24h'])
  unlockType!: 'session_24h';
}
