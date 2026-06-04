import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompleteOnboardingDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(30)
  fullName: string;

  @ApiProperty({ example: '1998-05-12' })
  @IsISO8601({ strict: true })
  dateOfBirth: string;

  @ApiProperty({ example: 'male', enum: ['male', 'female'] })
  @IsString()
  @IsNotEmpty()
  @IsIn(['male', 'female'])
  gender: string;

  @ApiProperty({ example: 'assets/avatars/male.png' })
  @IsString()
  @IsNotEmpty()
  avatarUrl: string;
}
