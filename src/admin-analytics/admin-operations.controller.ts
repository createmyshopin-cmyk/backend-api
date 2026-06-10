import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminOperationsService } from './admin-operations.service';

@ApiTags('Admin Operations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Controller('admin/operations')
export class AdminOperationsController {
  constructor(private readonly operations: AdminOperationsService) {}

  @Get('snapshot')
  @Roles('super_admin', 'finance_admin', 'operations_admin', 'fraud_admin')
  snapshot() {
    return this.operations.getSnapshot();
  }
}
