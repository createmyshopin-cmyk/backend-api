import { Controller, Get, Post, Param, Query, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { UpdateSettingsDto, MaintenanceToggleDto } from './dto/admin.dto';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@ApiTags('Admin Configurations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Get system settings' })
  @ApiResponse({ status: 200, description: 'Settings details returned.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  getSettings() {
    return this.adminService.getSettings();
  }

  @Post('settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update system settings' })
  updateSettings(@Body() updateSettingsDto: UpdateSettingsDto) {
    return this.adminService.updateSettings(updateSettingsDto);
  }

  @Post('settings/maintenance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle system maintenance mode' })
  toggleMaintenance(@Body() dto: MaintenanceToggleDto) {
    return this.adminService.toggleMaintenance(dto);
  }

  @Get('list')
  @ApiOperation({ summary: 'Get administrative accounts list' })
  getAdmins() {
    return this.adminService.getAdmins();
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard overview statistics' })
  @ApiResponse({ status: 200, description: 'Dashboard stats returned.' })
  getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  @Get('listeners')
  @ApiOperation({ summary: 'Get listeners filtered by status' })
  @ApiResponse({ status: 200, description: 'Listeners list returned.' })
  getListeners(@Query('status') status?: string) {
    return this.adminService.getListeners(status);
  }

  @Get('listeners/:id')
  @ApiOperation({ summary: 'Get listener detail' })
  @ApiResponse({ status: 200, description: 'Listener details returned.' })
  getListenerDetail(@Param('id') id: string) {
    return this.adminService.getListenerDetail(id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get coin transactions list' })
  @ApiResponse({ status: 200, description: 'Transactions list returned.' })
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
  @ApiOperation({ summary: 'Get listener earnings history' })
  @ApiResponse({ status: 200, description: 'Earnings list returned.' })
  getEarnings() {
    return this.adminService.getEarnings();
  }
}
