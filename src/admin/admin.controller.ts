import { Controller, Get, Post, Param, Query, Body, HttpCode, HttpStatus, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { UpdateSettingsDto, MaintenanceToggleDto } from './dto/admin.dto';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ALL_ADMIN_ROLES } from '../auth/admin-roles';

@ApiTags('Admin Configurations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(private readonly adminService: AdminService) {}

  @Get('settings')
  @Roles('super_admin', 'operations_admin')
  @ApiOperation({ summary: 'Get system settings' })
  getSettings() {
    return this.adminService.getSettings();
  }

  @Post('settings')
  @HttpCode(HttpStatus.OK)
  @Roles('super_admin', 'operations_admin')
  @ApiOperation({ summary: 'Update system settings' })
  updateSettings(@Body() updateSettingsDto: UpdateSettingsDto) {
    return this.adminService.updateSettings(updateSettingsDto);
  }

  @Post('settings/maintenance')
  @HttpCode(HttpStatus.OK)
  @Roles('super_admin', 'operations_admin')
  @ApiOperation({ summary: 'Toggle system maintenance mode' })
  toggleMaintenance(@Body() dto: MaintenanceToggleDto) {
    return this.adminService.toggleMaintenance(dto);
  }

  @Get('list')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Get administrative accounts list' })
  getAdmins() {
    return this.adminService.getAdmins();
  }

  @Get('dashboard')
  @Roles(...ALL_ADMIN_ROLES)
  @ApiOperation({ summary: 'Get dashboard overview statistics' })
  async getDashboardStats() {
    const start = performance.now();
    try {
      const result = await this.adminService.getDashboardStats();
      const ms = Math.round(performance.now() - start);
      this.logger.log(`GET /admin/dashboard handler completed in ${ms}ms`);
      return result;
    } catch (e) {
      const ms = Math.round(performance.now() - start);
      this.logger.error(
        `GET /admin/dashboard failed after ${ms}ms — ${(e as Error).message}`,
      );
      throw e;
    }
  }

  @Get('listeners')
  @Roles('super_admin', 'moderator', 'support_admin', 'fraud_admin', 'operations_admin')
  @ApiOperation({ summary: 'Get listeners filtered by status' })
  getListeners(@Query('status') status?: string) {
    return this.adminService.getListeners(status);
  }

  @Get('listeners/:id')
  @Roles('super_admin', 'moderator', 'support_admin', 'fraud_admin', 'operations_admin')
  @ApiOperation({ summary: 'Get listener detail' })
  getListenerDetail(@Param('id') id: string) {
    return this.adminService.getListenerDetail(id);
  }

  @Get('transactions')
  @Roles('super_admin', 'finance_admin', 'fraud_admin')
  @ApiOperation({ summary: 'Get coin transactions list' })
  getTransactions(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('type') type?: string,
  ) {
    return this.adminService.getTransactions(
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
      type,
    );
  }

  @Get('earnings')
  @Roles('super_admin', 'finance_admin', 'operations_admin')
  @ApiOperation({ summary: 'Get listener earnings history' })
  getEarnings() {
    return this.adminService.getEarnings();
  }
}
