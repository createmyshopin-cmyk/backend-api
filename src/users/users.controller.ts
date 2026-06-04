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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { SaveFcmTokenDto } from './dto/save-fcm-token.dto';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@ApiTags('Users Module')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('fcm-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save FCM device token for push notifications' })
  @ApiResponse({ status: 200, description: 'FCM token saved.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  saveFcmToken(@Request() req: { user: { id: string } }, @Body() dto: SaveFcmTokenDto) {
    return this.usersService.saveFcmToken(req.user.id, dto.fcmToken);
  }

  @Post('complete-onboarding')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete caller onboarding (one-time)' })
  @ApiResponse({ status: 200, description: 'Onboarding completed.' })
  @ApiResponse({ status: 400, description: 'Validation or business rule error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  completeOnboarding(
    @Request() req: { user: { id: string } },
    @Body() dto: CompleteOnboardingDto,
  ) {
    return this.usersService.completeOnboarding(req.user.id, dto);
  }

  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update profile (full name and avatar only)' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully.' })
  @ApiResponse({ status: 400, description: 'Immutable field or validation error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.id, dto);
  }

  @Get()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Retrieve all users (admin)' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'blocked'] })
  @ApiResponse({ status: 200, description: 'List of users returned.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  findAll(@Query('status') status?: 'active' | 'blocked') {
    return this.usersService.findAll(status);
  }

  @Get(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get user by ID (admin)' })
  @ApiResponse({ status: 200, description: 'User record found.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post(':id/block')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Block user access (admin)' })
  @ApiResponse({ status: 200, description: 'User has been blocked.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  block(@Param('id') id: string) {
    return this.usersService.updateStatus(id, 'blocked');
  }

  @Post(':id/unblock')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore user access (admin)' })
  @ApiResponse({ status: 200, description: 'User access has been restored.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  unblock(@Param('id') id: string) {
    return this.usersService.updateStatus(id, 'active');
  }
}
