import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SaveFcmTokenDto {
  @ApiProperty({ example: 'dJHK8s...' })
  @IsString()
  @IsNotEmpty()
  fcmToken: string;
}
