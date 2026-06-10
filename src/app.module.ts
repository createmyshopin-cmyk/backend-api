import { Module } from '@nestjs/common';
import { SupabaseModule } from './supabase/supabase.module';
import { AdminAuditModule } from './admin/admin-audit.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { UserWalletModule } from './wallets/user-wallet.module';
import { WalletsModule } from './wallets/wallets.module';
import { PaymentsModule } from './payments/payments.module';
import { CallsModule } from './calls/calls.module';
import { CreatorsModule } from './creators/creators.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
import { AdminModule } from './admin/admin.module';
import { AgoraModule } from './agora/agora.module';
import { FinanceModule } from './admin/finance/finance.module';
import { AdminUsersModule } from './admin/users/admin-users.module';
import { GiftModule } from './gifts/gift.module';
import { HealthController } from './health.controller';
import { ObservabilityModule } from './observability/observability.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { CreatorDashboardModule } from './creator-dashboard/creator-dashboard.module';
import { CreatorWithdrawalsModule } from './creator-withdrawals/creator-withdrawals.module';
import { EngagementModule } from './engagement/engagement.module';
import { MessagesModule } from './messages/messages.module';
import { AdminAnalyticsModule } from './admin-analytics/admin-analytics.module';
import { WelcomeCallsModule } from './welcome-calls/welcome-calls.module';
import { AppVersionModule } from './app-version/app-version.module';

@Module({
  imports: [
    ObservabilityModule,
    SupabaseModule,
    AdminAuditModule,
    AuthModule,
    UsersModule,
    UserWalletModule,
    WalletsModule,
    PaymentsModule,
    CallsModule,
    AgoraModule,
    CreatorsModule,
    WithdrawalsModule,
    AdminModule,
    FinanceModule,
    AdminUsersModule,
    GiftModule,
    ReconciliationModule,
    CreatorDashboardModule,
    CreatorWithdrawalsModule,
    EngagementModule,
    MessagesModule,
    AdminAnalyticsModule,
    WelcomeCallsModule,
    AppVersionModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
