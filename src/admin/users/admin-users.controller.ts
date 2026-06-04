import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
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

@ApiTags('Admin Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

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
}
