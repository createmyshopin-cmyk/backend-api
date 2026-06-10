import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { ADMIN_ROLES } from '../../auth/admin-roles';

export class CreateInviteDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: ADMIN_ROLES })
  @IsIn([...ADMIN_ROLES])
  role: (typeof ADMIN_ROLES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  elevated?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class AcceptInviteDto {
  @ApiProperty()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ minLength: 12 })
  @MinLength(12)
  password: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;
}

export class ChangeRoleDto {
  @ApiProperty({ enum: ADMIN_ROLES })
  @IsIn([...ADMIN_ROLES])
  role: (typeof ADMIN_ROLES)[number];

  @ApiProperty()
  @IsNotEmpty()
  reason: string;
}

export class AdminActionReasonDto {
  @ApiProperty()
  @IsNotEmpty()
  reason: string;
}

export class AuditLogQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resourceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resourceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  outcome?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  limit?: number;
}
