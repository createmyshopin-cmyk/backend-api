import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AgoraTokenRequestDto {
  @ApiPropertyOptional({
    description: 'Agora channel name. If omitted, the server generates one (e.g. call_123).',
    example: 'call_123',
  })
  @IsOptional()
  @IsString()
  channelName?: string;
}
