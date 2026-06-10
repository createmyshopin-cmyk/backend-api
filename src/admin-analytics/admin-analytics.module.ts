import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { AuthModule } from '../auth/auth.module';
import { AdminAuditModule } from '../admin/admin-audit.module';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminEngagementController } from './admin-engagement.controller';
import { AdminEngagementService } from './admin-engagement.service';
import { AdminOperationsController } from './admin-operations.controller';
import { AdminOperationsService } from './admin-operations.service';

@Module({
  imports: [SupabaseModule, AuthModule, AdminAuditModule],
  controllers: [
    AdminAnalyticsController,
    AdminEngagementController,
    AdminOperationsController,
  ],
  providers: [AdminAnalyticsService, AdminEngagementService, AdminOperationsService],
  exports: [AdminAnalyticsService, AdminEngagementService, AdminOperationsService],
})
export class AdminAnalyticsModule {}
