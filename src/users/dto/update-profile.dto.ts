import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Post-onboarding profile edits: name and avatar only. */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  fullName?: string;

  @ApiPropertyOptional({ example: 'assets/avatars/male.png' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  /** Rejected by service if present — kept optional so we can return a clear error. */
  @IsOptional()
  @IsString()
  gender?: string;

  /** Rejected by service if present */
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  onboardingCompleted?: boolean;
}
