import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsBoolean,
  IsPositive,
  Min,
  MaxLength,
  IsIn,
} from 'class-validator';

export class CreatePackageDto {
  @ApiProperty({ example: 'Starter Pack', description: 'Display name of the coin package' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Great for new users', description: 'Optional promo description' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @ApiProperty({ example: 100, description: 'Base coins included in the package' })
  @IsNumber()
  @IsPositive()
  coins: number;

  @ApiProperty({ example: 10, description: 'Bonus coins credited on top of base coins' })
  @IsNumber()
  @Min(0)
  bonusCoins: number;

  @ApiProperty({ example: 99.00, description: 'Price in the specified currency' })
  @IsNumber()
  @IsPositive()
  price: number;

  @ApiPropertyOptional({ example: 'INR', description: 'ISO 4217 currency code (default: INR)' })
  @IsString()
  @IsOptional()
  @IsIn(['INR', 'USD', 'EUR', 'GBP'])
  currency?: string;

  @ApiPropertyOptional({ example: 1, description: 'Display order in the app (ascending)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  sortOrder?: number;
}

/** All fields optional for PATCH updates */
export class UpdatePackageDto extends PartialType(CreatePackageDto) {
  @ApiPropertyOptional({ example: true, description: 'Set false to deactivate (soft-delete)' })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}
