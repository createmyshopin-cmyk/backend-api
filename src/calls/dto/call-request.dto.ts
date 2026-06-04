import { IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestCallDto {
  @ApiProperty({ description: 'The Host Creator ID to call', example: 'LIS001' })
  @IsString()
  listenerId: string;

  @ApiProperty({ description: 'The Call Type (voice or video)', enum: ['voice', 'video'], example: 'voice' })
  @IsEnum(['voice', 'video'])
  type: 'voice' | 'video';
}
