import { Controller, Post, Body, HttpCode, HttpStatus, Get, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { User, UsersService, toPublicProfile } from '../users/users.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { JwtAuthGuard } from './auth.guard';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin User Login' })
  @ApiResponse({ status: 200, description: 'Login successful. Returns access token.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials.' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register New Administrator' })
  @ApiResponse({ status: 201, description: 'Registration successful.' })
  register(@Body() registerDto: RegisterDto) {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_ADMIN_REGISTER !== 'true') {
      throw new ForbiddenException('Admin self-registration is disabled in production');
    }
    return this.authService.register(registerDto);
  }

  @Post('firebase-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange Firebase ID token for app JWT' })
  @ApiResponse({ status: 200, description: 'Login successful. Returns access token.' })
  @ApiResponse({ status: 401, description: 'Invalid Firebase token.' })
  firebaseLogin(
    @Body() dto: FirebaseLoginDto,
  ) {
    return this.authService.firebaseLogin(
      dto.firebaseToken,
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Current Logged-in User Profile' })
  @ApiResponse({ status: 200, description: 'User profile retrieved successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getProfile(@Request() req: { user: User & { role?: string } }) {
    if (req.user.role) {
      return req.user;
    }
    return toPublicProfile(req.user);
  }
}
