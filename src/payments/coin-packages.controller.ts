import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@ApiTags('Recharges & Coin Packages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('coin-packages')
export class CoinPackagesController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: 'Get available coin packages' })
  @ApiResponse({ status: 200, description: 'List of coin packages retrieved successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getPackages() {
    return this.paymentsService.getPackages();
  }
}
