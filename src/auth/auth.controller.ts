import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  Request,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { AuthService } from './auth.service';
import { User, toPublicProfile } from '../users/users.service';
import { LoginDto } from './dto/auth.dto';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { JwtAuthGuard } from './auth.guard';
import { AdminGuard } from './admin.guard';
import { Public } from './public.decorator';
import type { AdminRequestUser } from './admin-user.types';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin User Login' })
  @ApiResponse({ status: 200, description: 'Login successful. Returns access token.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  login(@Body() loginDto: LoginDto, @Req() req: ExpressRequest) {
    return this.authService.login(loginDto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('register')
  @HttpCode(HttpStatus.GONE)
  @ApiOperation({ summary: 'Removed — invite-only onboarding' })
  register() {
    return this.authService.register();
  }

  @Public()
  @Post('firebase-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange Firebase ID token for app JWT' })
  firebaseLogin(@Body() dto: FirebaseLoginDto) {
    return this.authService.firebaseLogin(dto.firebaseToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke admin session' })
  logout(@Request() req: { user: AdminRequestUser }) {
    return this.authService.logout(req.user);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current logged-in profile (admin or app user)' })
  getProfile(@Request() req: { user: AdminRequestUser | User }) {
    const user = req.user;
    if ('type' in user && user.type === 'admin') {
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      };
    }
    return toPublicProfile(user as User);
  }
}
