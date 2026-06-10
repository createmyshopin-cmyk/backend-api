import {
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
  GoneException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { SaveFcmTokenDto } from './dto/save-fcm-token.dto';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { WelcomeCallsService } from '../welcome-calls/welcome-calls.service';

const LEGACY_USER_READ_ROLES = ['super_admin', 'moderator', 'support_admin', 'fraud_admin'] as const;

@ApiTags('Users Module')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly welcomeCalls: WelcomeCallsService,
  ) {}

  @Post('fcm-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save FCM device token for push notifications' })
  saveFcmToken(@Request() req: { user: { id: string } }, @Body() dto: SaveFcmTokenDto) {
    return this.usersService.saveFcmToken(req.user.id, dto.fcmToken);
  }

  @Post('complete-onboarding')
  @HttpCode(HttpStatus.OK)
  async completeOnboarding(
    @Request() req: { user: { id: string } },
    @Body() dto: CompleteOnboardingDto,
  ) {
    const result = await this.usersService.completeOnboarding(req.user.id, dto);
    this.welcomeCalls
      .tryCreateAssignmentForUser(req.user.id)
      .catch((e) =>
        console.warn('[WelcomeCall] assignment after onboarding:', (e as Error).message),
      );
    return result;
  }

  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.id, dto);
  }

  @Get()
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(...LEGACY_USER_READ_ROLES)
  @ApiOperation({ summary: 'Retrieve all users (admin, deprecated path)' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'blocked'] })
  findAll(@Query('status') status?: 'active' | 'blocked') {
    return this.usersService.findAll(status);
  }

  @Get(':id')
  @UseGuards(AdminGuard, RolesGuard)
  @Roles(...LEGACY_USER_READ_ROLES)
  @ApiOperation({ summary: 'Get user by ID (admin, deprecated path)' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post(':id/block')
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({ summary: 'Deprecated — use POST /admin/users/:id/block' })
  block() {
    throw new GoneException('Use POST /api/admin/users/:id/block');
  }

  @Post(':id/unblock')
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({ summary: 'Deprecated — use POST /admin/users/:id/unblock' })
  unblock() {
    throw new GoneException('Use POST /api/admin/users/:id/unblock');
  }
}
