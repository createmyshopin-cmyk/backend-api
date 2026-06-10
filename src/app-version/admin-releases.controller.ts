import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import {
  CreateReleaseDto,
  SendReleaseNotificationDto,
} from './dto/app-version.dto';

@ApiTags('Admin Releases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Controller('admin/releases')
export class AdminReleasesController {
  constructor(
    private readonly appVersion: AppVersionService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  @Roles('super_admin')
  @ApiOperation({ summary: 'List release history' })
  list() {
    return this.appVersion.listReleases();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('super_admin')
  @ApiOperation({ summary: 'Create release history entry (append-only)' })
  async create(
    @Request() req: { user: AdminRequestUser },
    @Body() dto: CreateReleaseDto,
  ) {
    const release = await this.appVersion.createRelease(dto, req.user.id);
    await this.audit.record({
      actorType: 'admin',
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: 'app_release_create',
      category: 'settings',
      outcome: 'success',
      resourceType: 'app_release_history',
      resourceId: release.id,
      details: { version: dto.version, buildNumber: dto.buildNumber },
    });
    return { success: true, release };
  }

  @Post('send-notification')
  @HttpCode(HttpStatus.OK)
  @Roles('super_admin')
  @ApiOperation({ summary: 'Send FCM update notification to targeted users' })
  async sendNotification(
    @Request() req: { user: AdminRequestUser },
    @Body() dto: SendReleaseNotificationDto,
  ) {
    const result = await this.appVersion.sendNotification(dto.target, {
      title: dto.title,
      body: dto.body,
      releaseId: dto.releaseId,
    });
    await this.audit.record({
      actorType: 'admin',
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: 'app_release_notification',
      category: 'settings',
      outcome: 'success',
      resourceType: 'app_release_history',
      resourceId: dto.releaseId ?? 'broadcast',
      details: {
        target: dto.target,
        tokensTargeted: result.tokensTargeted,
        tokensSent: result.tokensSent,
      },
    });
    return result;
  }

  @Get(':id')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Get release by ID' })
  getOne(@Param('id') id: string) {
    return this.appVersion.getRelease(id);
  }
}
