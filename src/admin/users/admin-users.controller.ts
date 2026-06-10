import { Controller, Get, Post, Param, Query, UseGuards, Request, HttpCode, HttpStatus, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../../auth/auth.guard';
import { AdminGuard } from '../../auth/admin.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { AdminUsersService } from './admin-users.service';
import { ListAdminUsersDto } from './dto/list-admin-users.dto';
import { AdminAuditService } from '../admin-audit.service';
import type { AdminRequestUser } from '../../auth/admin-user.types';

const READ_ROLES = ['super_admin', 'moderator', 'support_admin', 'fraud_admin'] as const;
const MUTATE_ROLES = ['super_admin', 'moderator', 'fraud_admin'] as const;

@ApiTags('Admin Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'List users with pagination, search, and filters' })
  listUsers(@Query() query: ListAdminUsersDto) {
    return this.adminUsersService.listUsers(query);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Get full user profile and statistics' })
  getUser(@Param('id') id: string) {
    return this.adminUsersService.getUserDetail(id);
  }

  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  @Roles(...MUTATE_ROLES)
  @ApiOperation({ summary: 'Block user (admin)' })
  async blockUser(
    @Request() req: { user: AdminRequestUser },
    @Param('id') id: string,
    @Req() expressReq: ExpressRequest,
  ) {
    const res = await this.adminUsersService.updateUserStatus(id, 'blocked');
    await this.audit.record({
      ...this.audit.actorFromRequest(req.user, expressReq),
      action: 'user_blocked',
      category: 'user',
      outcome: 'success',
      resourceType: 'user',
      resourceId: id,
      httpMethod: 'POST',
      httpPath: `/admin/users/${id}/block`,
    });
    return res;
  }

  @Post(':id/unblock')
  @HttpCode(HttpStatus.OK)
  @Roles(...MUTATE_ROLES)
  async unblockUser(
    @Request() req: { user: AdminRequestUser },
    @Param('id') id: string,
    @Req() expressReq: ExpressRequest,
  ) {
    const res = await this.adminUsersService.updateUserStatus(id, 'active');
    await this.audit.record({
      ...this.audit.actorFromRequest(req.user, expressReq),
      action: 'user_unblocked',
      category: 'user',
      outcome: 'success',
      resourceType: 'user',
      resourceId: id,
      httpMethod: 'POST',
      httpPath: `/admin/users/${id}/unblock`,
    });
    return res;
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @Roles(...MUTATE_ROLES)
  async suspendUser(
    @Request() req: { user: AdminRequestUser },
    @Param('id') id: string,
    @Req() expressReq: ExpressRequest,
  ) {
    const res = await this.adminUsersService.updateUserStatus(id, 'suspended');
    await this.audit.record({
      ...this.audit.actorFromRequest(req.user, expressReq),
      action: 'user_suspended',
      category: 'user',
      outcome: 'success',
      resourceType: 'user',
      resourceId: id,
      httpMethod: 'POST',
      httpPath: `/admin/users/${id}/suspend`,
    });
    return res;
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(...MUTATE_ROLES)
  async reactivateUser(
    @Request() req: { user: AdminRequestUser },
    @Param('id') id: string,
    @Req() expressReq: ExpressRequest,
  ) {
    const res = await this.adminUsersService.updateUserStatus(id, 'active');
    await this.audit.record({
      ...this.audit.actorFromRequest(req.user, expressReq),
      action: 'user_reactivated',
      category: 'user',
      outcome: 'success',
      resourceType: 'user',
      resourceId: id,
      httpMethod: 'POST',
      httpPath: `/admin/users/${id}/reactivate`,
    });
    return res;
  }
}
