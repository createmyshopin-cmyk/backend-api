import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CallRequestActionDto {
  @ApiProperty({
    description: 'ID of the pending call_requests row',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsString()
  callId: string;
}
