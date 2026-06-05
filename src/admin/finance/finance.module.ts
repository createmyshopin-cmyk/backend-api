import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { SupabaseModule } from '../../supabase/supabase.module';
import { UsersModule } from '../../users/users.module';
import { CreatorsModule } from '../../creators/creators.module';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { CallsModule } from '../../calls/calls.module';
import { WithdrawalsModule } from '../../withdrawals/withdrawals.module';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';

@Module({
  imports: [
    AuthModule,
    SupabaseModule,
    UsersModule,
    CreatorsModule,
    PaymentsModule,
    CallsModule,
    WithdrawalsModule,
  ],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
