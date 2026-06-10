import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { CreatorDashboardModule } from '../creator-dashboard/creator-dashboard.module';
import { CreatorWithdrawalsController } from './creator-withdrawals.controller';
import { CreatorWithdrawalsService } from './creator-withdrawals.service';
import { PayoutAccountService } from './payout-account.service';
import { CreatorScopeGuard } from '../creator-dashboard/creator-scope.guard';
import { WithdrawalMutationGuard } from './guards/withdrawal-mutation.guard';
import { CreatorWithdrawalRpcService } from './creator-withdrawal-rpc.service';

@Module({
  imports: [AuthModule, SupabaseModule, CreatorDashboardModule],
  controllers: [CreatorWithdrawalsController],
  providers: [
    CreatorWithdrawalsService,
    PayoutAccountService,
    CreatorWithdrawalRpcService,
    CreatorScopeGuard,
    WithdrawalMutationGuard,
  ],
  exports: [CreatorWithdrawalsService, PayoutAccountService],
})
export class CreatorWithdrawalsModule {}
