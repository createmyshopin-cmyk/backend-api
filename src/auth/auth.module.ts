import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './auth.guard';
import { AdminGuard } from './admin.guard';
import { RolesGuard } from './roles.guard';
import { AdminUsersService } from './admin-users.service';
import { UsersModule } from '../users/users.module';
import { AdminAuditModule } from '../admin/admin-audit.module';
import { getPlatformConfig } from '../startup/platform-config';

@Module({
  imports: [
    AdminAuditModule,
    forwardRef(() => UsersModule),
    JwtModule.register({
      global: true,
      secret: getPlatformConfig().jwtSecret,
      signOptions: {
        expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AdminUsersService, JwtAuthGuard, AdminGuard, RolesGuard],
  exports: [
    AuthService,
    AdminUsersService,
    JwtAuthGuard,
    AdminGuard,
    RolesGuard,
    JwtModule,
    UsersModule,
  ],
})
export class AuthModule {}
