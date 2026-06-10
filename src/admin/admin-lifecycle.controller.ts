import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';
import { AdminUsersService } from '../auth/admin-users.service';
import { AdminAuditService } from './admin-audit.service';
import { AuthService } from '../auth/auth.service';
import type { AdminRequestUser } from '../auth/admin-user.types';
import {
  AcceptInviteDto,
  AdminActionReasonDto,
  AuditLogQueryDto,
  ChangeRoleDto,
  CreateInviteDto,
} from './dto/admin-lifecycle.dto';

@ApiTags('Admin Lifecycle')
@Controller('admin')
export class AdminLifecycleController {
  constructor(
    private readonly adminUsers: AdminUsersService,
    private readonly audit: AdminAuditService,
    private readonly authService: AuthService,
  ) {}

  @UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
  @Roles('super_admin')
  @Post('invites')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create admin invite (super_admin only)' })
  async createInvite(
    @Request() req: { user: AdminRequestUser },
    @Body() dto: CreateInviteDto,
    @Req() expressReq: ExpressRequest,
  ) {
    const { invite, token } = await this.adminUsers.createInvite({
      email: dto.email,
      name: dto.name,
      role: dto.role,
      invitedBy: req.user.id,
      elevated: dto.elevated,
      reason: dto.reason,
    });

    await this.audit.record({
      ...this.audit.actorFromRequest(req.user, expressReq),
      action: 'admin_invite_created',
      category: 'admin_lifecycle',
      outcome: 'success',
      resourceType: 'admin_invite',
      resourceId: String((invite as { id: string }).id),
      retentionClass: 'security',
      details: {
        email: dto.email,
        role: dto.role,
        elevated: dto.elevated ?? false,
        reason: dto.reason,
      },
    });

    return {
      invite: {
        id: (invite as { id: string }).id,
        email: dto.email,
        role: dto.role,
        expiresAt: (invite as { expires_at: string }).expires_at,
      },
      token,
    };
  }

  @UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
  @Roles('super_admin')
  @Get('invites')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List admin invites' })
  listInvites() {
    return this.adminUsers.listInvites();
  }

  @UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
  @Roles('super_admin')
  @Delete('invites/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke pending invite' })
  async revokeInvite(
    @Request() req: { user: AdminRequestUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Req() expressReq: ExpressRequest,
  ) {
    await this.adminUsers.revokeInvite(id);
    await this.audit.record({
      ...this.audit.actorFromRequest(req.user, expressReq),
      action: 'admin_invite_revoked',
      category: 'admin_lifecycle',
      outcome: 'success',
      resourceType: 'admin_invite',
      resourceId: id,
      retentionClass: 'security',
    });
    return { message: 'Invite revoked' };
  }

  @Public()
  @Post('invites/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept invite and create admin account' })
  acceptInvite(@Body() dto: AcceptInviteDto, @Req() req: ExpressRequest) {
    return this.authService.acceptInvite(dto.token, dto.password, dto.name, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
  @Roles('super_admin')
  @Get('admins')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List admin accounts' })
  listAdmins() {
    return this.adminUsers.listAdmins();
  }

  @UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
  @Roles('super_admin')
  @Patch('admins/:id/role')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change admin role' })
  async changeRole(
    @Request() req: { user: AdminRequestUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeRoleDto,
    @Req() expressReq: ExpressRequest,
  ) {
    const before = await this.adminUsers.findById(id);
    const { admin: updated, sessionsRevoked: sessionCount } = await this.adminUsers.changeRole(
      id,
      dto.role,
      req.user.id,
      dto.reason,
    );

    await this.audit.record({
      ...this.audit.actorFromRequest(req.user, expressReq),
      action: 'admin_role_changed',
      category: 'admin_lifecycle',
      outcome: 'success',
      resourceType: 'admin_user',
      resourceId: id,
      retentionClass: 'security',
      details: {
        target_admin_id: id,
        target_admin_email: updated.email,
        before: { role: before?.role, status: before?.status },
        after: { role: updated.role, status: updated.status },
        change_reason: dto.reason,
        sessions_revoked: sessionCount,
        self_change: false,
      },
    });

    await this.audit.record({
      actorType: 'system',
      action: 'admin_session_revoked',
      category: 'auth',
      outcome: 'success',
      resourceType: 'admin_user',
      resourceId: id,
      retentionClass: 'security',
      details: { reason: 'role_changed', session_count: sessionCount },
    });

    return { id: updated.id, role: updated.role, status: updated.status };
  }

  @UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
  @Roles('super_admin')
  @Post('admins/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  async suspendAdmin(
    @Request() req: { user: AdminRequestUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminActionReasonDto,
    @Req() expressReq: ExpressRequest,
  ) {
    const before = await this.adminUsers.findById(id);
    const updated = await this.adminUsers.suspendAdmin(id, req.user.id, dto.reason);

    await this.audit.record({
      ...this.audit.actorFromRequest(req.user, expressReq),
      action: 'admin_suspended',
      category: 'admin_lifecycle',
      outcome: 'success',
      resourceType: 'admin_user',
      resourceId: id,
      retentionClass: 'security',
      details: {
        before: { status: before?.status },
        after: { status: updated.status },
        reason: dto.reason,
      },
    });

    return { id: updated.id, status: updated.status };
  }

  @UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
  @Roles('super_admin')
  @Post('admins/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  async revokeAdmin(
    @Request() req: { user: AdminRequestUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminActionReasonDto,
    @Req() expressReq: ExpressRequest,
  ) {
    const before = await this.adminUsers.findById(id);
    const updated = await this.adminUsers.revokeAdmin(id, req.user.id, dto.reason);

    await this.audit.record({
      ...this.audit.actorFromRequest(req.user, expressReq),
      action: 'admin_revoked',
      category: 'admin_lifecycle',
      outcome: 'success',
      resourceType: 'admin_user',
      resourceId: id,
      retentionClass: 'security',
      details: {
        before: { status: before?.status },
        after: { status: updated.status },
        reason: dto.reason,
      },
    });

    return { id: updated.id, status: updated.status };
  }

  @UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
  @Roles('super_admin')
  @Get('audit-logs')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Query immutable admin audit logs' })
  queryAuditLogs(@Query() query: AuditLogQueryDto) {
    return this.audit.query({
      from: query.from,
      to: query.to,
      action: query.action,
      category: query.category,
      actorId: query.actorId,
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      outcome: query.outcome,
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
