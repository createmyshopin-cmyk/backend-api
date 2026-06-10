import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { CreatorAnalyticsModule } from '../creator-analytics/creator-analytics.module';
import { CreatorDashboardController } from './creator-dashboard.controller';
import { CreatorDashboardService } from './creator-dashboard.service';
import { CreatorDashboardRepository } from './creator-dashboard.repository';
import { CreatorScopeGuard } from './creator-scope.guard';

@Module({
  imports: [AuthModule, SupabaseModule, CreatorAnalyticsModule],
  controllers: [CreatorDashboardController],
  providers: [CreatorDashboardService, CreatorDashboardRepository, CreatorScopeGuard],
  exports: [CreatorDashboardService, CreatorDashboardRepository, CreatorScopeGuard],
})
export class CreatorDashboardModule {}
