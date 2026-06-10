import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export type ReleaseType = 'optional' | 'force' | 'maintenance';

export class UpdateAppVersionSettingsDto {
  @IsString()
  @MinLength(1)
  latestVersion!: string;

  @IsString()
  @MinLength(1)
  minimumSupportedVersion!: string;

  @IsBoolean()
  forceUpdate!: boolean;

  @IsEnum(['optional', 'force', 'maintenance'])
  releaseType!: ReleaseType;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  message!: string;

  @IsString()
  @IsUrl({ require_protocol: true })
  playStoreUrl!: string;

  @IsString()
  @IsUrl({ require_protocol: true })
  appStoreUrl!: string;

  @IsOptional()
  @IsBoolean()
  maintenanceMode?: boolean;

  @IsOptional()
  @IsString()
  maintenanceTitle?: string;

  @IsOptional()
  @IsString()
  maintenanceMessage?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  maintenanceDurationMinutes?: number;
}

export class CreateReleaseDto {
  @IsString()
  @MinLength(1)
  version!: string;

  @IsInt()
  @Min(1)
  buildNumber!: number;

  @IsEnum(['optional', 'force', 'maintenance'])
  releaseType!: ReleaseType;

  @IsString()
  title!: string;

  @IsString()
  message!: string;

  @IsString()
  changelog!: string;

  @IsString()
  @IsUrl({ require_protocol: true })
  playStoreUrl!: string;

  @IsString()
  @IsUrl({ require_protocol: true })
  appStoreUrl!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  syncToSettings?: boolean;
}

export type NotificationTarget =
  | 'all'
  | 'users'
  | 'creators'
  | 'new_superhosts'
  | 'pro_superhosts'
  | 'legend_superhosts';

export class SendReleaseNotificationDto {
  @IsEnum([
    'all',
    'users',
    'creators',
    'new_superhosts',
    'pro_superhosts',
    'legend_superhosts',
  ])
  target!: NotificationTarget;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  releaseId?: string;
}

export class ReportAppVersionDto {
  @IsString()
  @IsNotEmpty()
  version!: string;

  @IsInt()
  @Min(1)
  buildNumber!: number;

  @IsEnum(['android', 'ios'])
  platform!: 'android' | 'ios';
}
