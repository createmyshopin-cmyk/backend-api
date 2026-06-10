import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { CreatorsModule } from '../creators/creators.module';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalRpcService } from './withdrawal-rpc.service';
import { WithdrawalsController, AdminWithdrawalsController } from './withdrawals.controller';

@Module({
  imports: [AuthModule, UsersModule, SupabaseModule, CreatorsModule],
  controllers: [WithdrawalsController, AdminWithdrawalsController],
  providers: [WithdrawalsService, WithdrawalRpcService],
  exports: [WithdrawalsService, WithdrawalRpcService],
})
export class WithdrawalsModule {}
