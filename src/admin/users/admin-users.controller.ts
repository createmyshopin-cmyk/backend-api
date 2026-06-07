import { Controller, Get, Post, Param, Query, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/auth.guard';
import { AdminGuard } from '../../auth/admin.guard';
import { AdminUsersService } from './admin-users.service';
import { ListAdminUsersDto } from './dto/list-admin-users.dto';
import { AuditLoggerService } from '../audit-logger.service';

@ApiTags('Admin Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly auditLogger: AuditLoggerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List users with pagination, search, and filters' })
  @ApiResponse({ status: 200, description: 'Paginated user list.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  listUsers(@Query() query: ListAdminUsersDto) {
    return this.adminUsersService.listUsers(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full user profile and statistics' })
  @ApiResponse({ status: 200, description: 'User detail returned.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  getUser(@Param('id') id: string) {
    return this.adminUsersService.getUserDetail(id);
  }

  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Block user (admin)' })
  async blockUser(@Request() req: any, @Param('id') id: string) {
    const res = await this.adminUsersService.updateUserStatus(id, 'blocked');
    this.auditLogger.logAction(req.user.id, req.user.email || 'admin@coincalling.com', 'BLOCK_USER', id);
    return res;
  }

  @Post(':id/unblock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unblock/Reactivate user (admin)' })
  async unblockUser(@Request() req: any, @Param('id') id: string) {
    const res = await this.adminUsersService.updateUserStatus(id, 'active');
    this.auditLogger.logAction(req.user.id, req.user.email || 'admin@coincalling.com', 'UNBLOCK_USER', id);
    return res;
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend user (admin)' })
  async suspendUser(@Request() req: any, @Param('id') id: string) {
    const res = await this.adminUsersService.updateUserStatus(id, 'suspended');
    this.auditLogger.logAction(req.user.id, req.user.email || 'admin@coincalling.com', 'SUSPEND_USER', id);
    return res;
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate user (admin)' })
  async reactivateUser(@Request() req: any, @Param('id') id: string) {
    const res = await this.adminUsersService.updateUserStatus(id, 'active');
    this.auditLogger.logAction(req.user.id, req.user.email || 'admin@coincalling.com', 'REACTIVATE_USER', id);
    return res;
  }
}
