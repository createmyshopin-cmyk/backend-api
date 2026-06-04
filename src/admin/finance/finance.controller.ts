import { Controller, Get, Query, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/auth.guard';
import { AdminGuard } from '../../auth/admin.guard';
import { FinanceService } from './finance.service';
import { ChartQueryDto, DateRangeQueryDto } from './dto/finance.dto';

@ApiTags('Admin Finance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get finance dashboard overview metrics' })
  @ApiResponse({ status: 200, description: 'Overview statistics returned successfully.' })
  async getOverview() {
    return this.financeService.getOverview();
  }

  @Get('revenue-chart')
  @ApiOperation({ summary: 'Get chart data points for revenue and transactions' })
  @ApiResponse({ status: 200, description: 'Chart points returned successfully.' })
  async getRevenueChart(@Query() query: ChartQueryDto) {
    const days = query.days ? Number(query.days) : 7;
    return this.financeService.getRevenueChart(days);
  }

  @Get('top-creators')
  @ApiOperation({ summary: 'Get list of top 10 creators by revenue' })
  @ApiResponse({ status: 200, description: 'Top creators list returned successfully.' })
  async getTopCreators() {
    return this.financeService.getTopCreators();
  }

  @Get('call-analytics')
  @ApiOperation({ summary: 'Get phone call metrics and call coin analytics' })
  @ApiResponse({ status: 200, description: 'Call analytics returned successfully.' })
  async getCallAnalytics() {
    return this.financeService.getCallAnalytics();
  }

  @Get('withdrawal-analytics')
  @ApiOperation({ summary: 'Get withdrawal request transaction statistics' })
  @ApiResponse({ status: 200, description: 'Withdrawal analytics returned successfully.' })
  async getWithdrawalAnalytics() {
    return this.financeService.getWithdrawalAnalytics();
  }

  @Get('export/revenue')
  @ApiOperation({ summary: 'Export payments revenue report as CSV file' })
  async exportRevenue(
    @Query() query: DateRangeQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.financeService.exportRevenueCsv(
      query.range,
      query.startDate,
      query.endDate,
    );
    res.set('Content-Type', 'text/csv');
    res.attachment(`revenue-report-${query.range || 'all'}-${Date.now()}.csv`);
    return res.status(200).send(csv);
  }

  @Get('export/earnings')
  @ApiOperation({ summary: 'Export creator earnings report as CSV file' })
  async exportEarnings(
    @Query() query: DateRangeQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.financeService.exportEarningsCsv(
      query.range,
      query.startDate,
      query.endDate,
    );
    res.set('Content-Type', 'text/csv');
    res.attachment(`creator-earnings-${query.range || 'all'}-${Date.now()}.csv`);
    return res.status(200).send(csv);
  }

  @Get('export/withdrawals')
  @ApiOperation({ summary: 'Export creator withdrawals report as CSV file' })
  async exportWithdrawals(
    @Query() query: DateRangeQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.financeService.exportWithdrawalsCsv(
      query.range,
      query.startDate,
      query.endDate,
    );
    res.set('Content-Type', 'text/csv');
    res.attachment(`withdrawals-report-${query.range || 'all'}-${Date.now()}.csv`);
    return res.status(200).send(csv);
  }
}
