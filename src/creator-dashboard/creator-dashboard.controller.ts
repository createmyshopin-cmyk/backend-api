import { Controller, Get, Query, Request, UseGuards, Logger } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CreatorScopeGuard, CreatorAuthenticatedRequest } from './creator-scope.guard';
import { CreatorDashboardService } from './creator-dashboard.service';
import {
  CallHistoryQueryDto,
  GiftHistoryQueryDto,
  WithdrawalHistoryQueryDto,
} from './dto/history-query.dto';

@ApiTags('Creator Economy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CreatorScopeGuard)
@Controller('creator')
export class CreatorDashboardController {
  private readonly logger = new Logger(CreatorDashboardController.name);

  constructor(private readonly dashboardService: CreatorDashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Fast wallet header cards for creator dashboard' })
  @ApiResponse({ status: 200, description: 'Wallet summary returned.' })
  @ApiResponse({ status: 403, description: 'Creator not active or user suspended.' })
  @ApiResponse({ status: 404, description: 'Creator profile not found.' })
  async getSummary(@Request() req: CreatorAuthenticatedRequest) {
    const start = performance.now();
    const result = await this.dashboardService.getSummary(req.creatorScope);
    this.logger.log(`GET /creator/summary completed in ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Full creator dashboard — wallet, analytics, chart' })
  @ApiResponse({ status: 200, description: 'Dashboard payload returned.' })
  @ApiResponse({ status: 503, description: 'Dashboard unavailable.' })
  async getDashboard(@Request() req: CreatorAuthenticatedRequest) {
    const start = performance.now();
    const result = await this.dashboardService.getDashboard(req.creatorScope);
    this.logger.log(`GET /creator/dashboard completed in ${Math.round(performance.now() - start)}ms`);
    return result;
  }

  @Get('history/calls')
  @ApiOperation({ summary: 'Paginated call earnings history' })
  async getCallHistory(
    @Request() req: CreatorAuthenticatedRequest,
    @Query() query: CallHistoryQueryDto,
  ) {
    return this.dashboardService.getCallHistory(req.creatorScope, query);
  }

  @Get('history/gifts')
  @ApiOperation({ summary: 'Paginated gift earnings history' })
  async getGiftHistory(
    @Request() req: CreatorAuthenticatedRequest,
    @Query() query: GiftHistoryQueryDto,
  ) {
    return this.dashboardService.getGiftHistory(req.creatorScope, query);
  }

  @Get('history/withdrawals')
  @ApiOperation({ summary: 'Paginated withdrawal history' })
  async getWithdrawalHistory(
    @Request() req: CreatorAuthenticatedRequest,
    @Query() query: WithdrawalHistoryQueryDto,
  ) {
    return this.dashboardService.getWithdrawalHistory(req.creatorScope, query);
  }
}
