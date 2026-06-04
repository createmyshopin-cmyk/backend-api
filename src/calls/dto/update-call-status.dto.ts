import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export type CallLifecycleStatus =
  | 'requested'
  | 'accepted'
  | 'ringing'
  | 'ongoing'
  | 'ended'
  | 'missed'
  | 'rejected'
  | 'cancelled';

/** Statuses clients may set after a session row exists. */
export type CallProgressStatus = 'ringing' | 'ongoing';

export class UpdateCallStatusDto {
  @ApiProperty({ enum: ['ringing', 'ongoing'] })
  @IsEnum(['ringing', 'ongoing'])
  status: CallProgressStatus;
}
