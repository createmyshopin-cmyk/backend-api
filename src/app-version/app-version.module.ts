import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SupabaseModule } from '../supabase/supabase.module';
import { AdminAuditModule } from '../admin/admin-audit.module';
import { AuthModule } from '../auth/auth.module';
import { FcmService } from '../fcm/fcm.service';
import { AppVersionService } from './app-version.service';
import { AppVersionController } from './app-version.controller';
import { AdminAppVersionController } from './admin-app-version.controller';
import { AdminReleasesController } from './admin-releases.controller';
import { AppVersionGuard } from './app-version.guard';

@Module({
  imports: [SupabaseModule, AdminAuditModule, AuthModule],
  controllers: [
    AppVersionController,
    AdminAppVersionController,
    AdminReleasesController,
  ],
  providers: [
    AppVersionService,
    FcmService,
    {
      provide: APP_GUARD,
      useClass: AppVersionGuard,
    },
  ],
  exports: [AppVersionService],
})
export class AppVersionModule {}
