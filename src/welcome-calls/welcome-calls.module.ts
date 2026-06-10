import { Module, forwardRef } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { UsersModule } from '../users/users.module';
import { CallsModule } from '../calls/calls.module';
import { FcmService } from '../fcm/fcm.service';
import { CreatorDashboardModule } from '../creator-dashboard/creator-dashboard.module';
import { WelcomeCallsService } from './welcome-calls.service';
import { WelcomeCallRewardRpcService } from './welcome-call-reward-rpc.service';
import { AdminWelcomeCampaignsController } from './admin-welcome-campaigns.controller';
import { CreatorWelcomeCallsController } from './creator-welcome-calls.controller';
import { UserWelcomeCallsController } from './user-welcome-calls.controller';

@Module({
  imports: [
    SupabaseModule,
    UsersModule,
    CreatorDashboardModule,
    forwardRef(() => CallsModule),
  ],
  controllers: [
    AdminWelcomeCampaignsController,
    CreatorWelcomeCallsController,
    UserWelcomeCallsController,
  ],
  providers: [WelcomeCallsService, WelcomeCallRewardRpcService, FcmService],
  exports: [WelcomeCallsService, WelcomeCallRewardRpcService],
})
export class WelcomeCallsModule {}

// CallsModule imports this module via forwardRef for welcome end-call billing.
