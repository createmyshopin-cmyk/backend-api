import { Controller, Get, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
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
}
