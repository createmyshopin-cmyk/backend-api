import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { AdminRequestUser } from '../auth/admin-user.types';
import { AdminAuditService } from '../admin/admin-audit.service';
import { AppVersionService } from './app-version.service';
import { UpdateAppVersionSettingsDto } from './dto/app-version.dto';

@ApiTags('Admin App Version')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Controller('admin/app-version')
export class AdminAppVersionController {
  constructor(
    private readonly appVersion: AppVersionService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  @Roles('super_admin')
  @ApiOperation({ summary: 'Get current app version settings' })
  getSettings() {
    return this.appVersion.getSettingsForAdmin();
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @Roles('super_admin')
  @ApiOperation({ summary: 'Update app version settings' })
  async updateSettings(
    @Request() req: { user: AdminRequestUser },
    @Body() dto: UpdateAppVersionSettingsDto,
  ) {
    const result = await this.appVersion.updateSettings(dto, req.user.id);
    await this.audit.record({
      actorType: 'admin',
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: 'app_version_settings_update',
      category: 'settings',
      outcome: 'success',
      resourceType: 'app_version_settings',
      resourceId: result.id,
      details: { latestVersion: dto.latestVersion, releaseType: dto.releaseType },
    });
    return { success: true, settings: result };
  }

  @Get('analytics')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Version adoption analytics' })
  getAnalytics() {
    return this.appVersion.getAnalytics();
  }
}
