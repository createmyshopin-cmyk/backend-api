import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export type CallRequestStatus =
  | 'requested'
  | 'accepted'
  | 'rejected'
  | 'missed'
  | 'cancelled';

export class UpdateCallRequestStatusDto {
  @ApiProperty({
    enum: ['accepted', 'rejected', 'missed', 'cancelled'],
    description: 'New status for the call request (requested is set on create only)',
  })
  @IsEnum(['accepted', 'rejected', 'missed', 'cancelled'])
  status: Exclude<CallRequestStatus, 'requested'>;
}
