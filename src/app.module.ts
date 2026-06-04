import { Module } from '@nestjs/common';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { PaymentsModule } from './payments/payments.module';
import { CallsModule } from './calls/calls.module';
import { CreatorsModule } from './creators/creators.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
import { AdminModule } from './admin/admin.module';
import { AgoraModule } from './agora/agora.module';
import { FinanceModule } from './admin/finance/finance.module';

@Module({
  imports: [
    SupabaseModule,
    AuthModule,
    UsersModule,
    WalletsModule,
    PaymentsModule,
    CallsModule,
    AgoraModule,
    CreatorsModule,
    WithdrawalsModule,
    AdminModule,
    FinanceModule,
  ],
})
export class AppModule {}
