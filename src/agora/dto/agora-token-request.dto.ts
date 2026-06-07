import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AgoraTokenRequestDto {
  @ApiPropertyOptional({
    description: 'Agora channel name from an active call or ringing request (required).',
    example: 'ch_1748123456789',
  })
  @IsString()
  channelName: string;

  @ApiPropertyOptional({ description: 'Optional call session UUID' })
  @IsOptional()
  @IsString()
  callId?: string;

  @ApiPropertyOptional({ description: 'Agora UID (0 = auto-assign)' })
  @IsOptional()
  uid?: number;
}
