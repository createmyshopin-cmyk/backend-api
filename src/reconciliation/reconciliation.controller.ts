import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ReconciliationFindingsQueryDto,
  ReconciliationLimitQueryDto,
  ReconciliationRunNowDto,
} from './dto/reconciliation-query.dto';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AdminRequestUser } from '../auth/admin-user.types';
import { Req } from '@nestjs/common';
import {
  ReconciliationService,
  ReconciliationTier,
} from './reconciliation.service';

@Controller('admin/reconciliation')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get('runs')
  @Roles('super_admin', 'finance_admin')
  listRuns(@Query() query: ReconciliationLimitQueryDto) {
    return this.reconciliation.listRuns(query.limit);
  }

  @Get('findings')
  @Roles('super_admin', 'finance_admin')
  listFindings(@Query() query: ReconciliationFindingsQueryDto) {
    return this.reconciliation.listFindings({
      status: query.status,
      severity: query.severity,
      checkId: query.check_id,
      limit: query.limit,
    });
  }

  @Get('health')
  @Roles('super_admin', 'finance_admin')
  health() {
    return this.reconciliation.getHealth();
  }

  @Post('findings/:id/acknowledge')
  @Roles('super_admin', 'finance_admin')
  acknowledge(@Param('id') id: string, @Req() req: { user: AdminRequestUser }) {
    return this.reconciliation.acknowledgeFinding(id, req.user.id);
  }

  @Post('findings/:id/resolve')
  @Roles('super_admin', 'finance_admin')
  resolve(
    @Param('id') id: string,
    @Body('notes') notes: string,
    @Req() req: { user: AdminRequestUser },
  ) {
    return this.reconciliation.resolveFinding(id, req.user.id, notes ?? '');
  }

  @Post('run-now')
  @Roles('super_admin')
  runNow(@Body() body: ReconciliationRunNowDto) {
    return this.reconciliation.runTier(body.tier as ReconciliationTier);
  }
}
