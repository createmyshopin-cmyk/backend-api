import { IsString, IsNumber, IsOptional, IsEnum, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AgoraTokenDto {
  @ApiProperty({
    description: 'Agora channel name bound to an active call or ringing request',
    example: 'ch_1748123456789',
  })
  @IsString()
  channelName: string;

  @ApiPropertyOptional({
    description: 'Optional call session UUID for additional binding verification',
  })
  @IsOptional()
  @IsString()
  callId?: string;

  @ApiPropertyOptional({
    description: 'Agora UID (integer). Use 0 to let Agora assign one.',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  uid?: number;

  @ApiPropertyOptional({
    description: 'Token role: publisher (host/caller) or subscriber (audience).',
    enum: ['publisher', 'subscriber'],
    default: 'publisher',
  })
  @IsOptional()
  @IsEnum(['publisher', 'subscriber'])
  role?: 'publisher' | 'subscriber';
}
