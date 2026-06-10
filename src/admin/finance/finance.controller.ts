import { Controller, Get, Query, UseGuards, Res, Request, Req } from '@nestjs/common';
import { Response, Request as ExpressRequest } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/auth.guard';
import { AdminGuard } from '../../auth/admin.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { FinanceService } from './finance.service';
import { ChartQueryDto, DateRangeQueryDto } from './dto/finance.dto';
import { AdminAuditService } from '../admin-audit.service';
import type { AdminRequestUser } from '../../auth/admin-user.types';

@ApiTags('Admin Finance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Controller('admin/finance')
export class FinanceController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('overview')
  @Roles('super_admin', 'finance_admin', 'operations_admin')
  async getOverview() {
    return this.financeService.getOverview();
  }

  @Get('revenue-chart')
  @Roles('super_admin', 'finance_admin', 'operations_admin')
  async getRevenueChart(@Query() query: ChartQueryDto) {
    const days = query.days ? Number(query.days) : 7;
    return this.financeService.getRevenueChart(days);
  }

  @Get('top-creators')
  @Roles('super_admin', 'finance_admin', 'operations_admin')
  async getTopCreators() {
    return this.financeService.getTopCreators();
  }

  @Get('call-analytics')
  @Roles('super_admin', 'finance_admin', 'fraud_admin', 'operations_admin')
  async getCallAnalytics() {
    return this.financeService.getCallAnalytics();
  }

  @Get('withdrawal-analytics')
  @Roles('super_admin', 'finance_admin')
  async getWithdrawalAnalytics() {
    return this.financeService.getWithdrawalAnalytics();
  }

  @Get('export/revenue')
  @Roles('super_admin', 'finance_admin')
  async exportRevenue(
    @Request() req: { user: AdminRequestUser },
    @Req() expressReq: ExpressRequest,
    @Query() query: DateRangeQueryDto,
    @Res() res: Response,
  ) {
    await this.audit.record({
      ...this.audit.actorFromRequest(req.user, expressReq),
      action: 'finance_export_revenue',
      category: 'export',
      outcome: 'success',
      resourceType: 'export',
      resourceId: `revenue-${query.range ?? 'all'}`,
      retentionClass: 'financial',
      httpMethod: 'GET',
      httpPath: '/admin/finance/export/revenue',
    });
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
  @Roles('super_admin', 'finance_admin')
  async exportEarnings(
    @Request() req: { user: AdminRequestUser },
    @Req() expressReq: ExpressRequest,
    @Query() query: DateRangeQueryDto,
    @Res() res: Response,
  ) {
    await this.audit.record({
      ...this.audit.actorFromRequest(req.user, expressReq),
      action: 'finance_export_earnings',
      category: 'export',
      outcome: 'success',
      resourceType: 'export',
      resourceId: `earnings-${query.range ?? 'all'}`,
      retentionClass: 'financial',
      httpMethod: 'GET',
      httpPath: '/admin/finance/export/earnings',
    });
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
  @Roles('super_admin', 'finance_admin')
  async exportWithdrawals(
    @Request() req: { user: AdminRequestUser },
    @Req() expressReq: ExpressRequest,
    @Query() query: DateRangeQueryDto,
    @Res() res: Response,
  ) {
    await this.audit.record({
      ...this.audit.actorFromRequest(req.user, expressReq),
      action: 'finance_export_withdrawals',
      category: 'export',
      outcome: 'success',
      resourceType: 'export',
      resourceId: `withdrawals-${query.range ?? 'all'}`,
      retentionClass: 'financial',
      httpMethod: 'GET',
      httpPath: '/admin/finance/export/withdrawals',
    });
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
