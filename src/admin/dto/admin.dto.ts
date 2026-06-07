import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class UpdateSettingsDto {
  @ApiProperty({ example: 'CoinCalling' })
  @IsString()
  @IsNotEmpty()
  appName: string;

  @ApiProperty({ example: 'support@coincalling.com' })
  @IsString()
  @IsNotEmpty()
  supportEmail: string;

  @ApiProperty({ example: '+91 99999 88888' })
  @IsString()
  @IsNotEmpty()
  supportWhatsapp: string;

  @ApiProperty({ example: 45 })
  @IsNumber()
  callTimeout: number;

  @ApiProperty({ example: 10 })
  @IsNumber()
  coinRatePerMin: number;

  @ApiProperty({ example: 60 })
  @IsNumber()
  commissionRate: number;

  @ApiProperty({ example: 1000 })
  @IsNumber()
  minWithdrawal: number;
}

export class MaintenanceToggleDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;
}
