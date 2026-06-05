import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { RazorpayService } from './razorpay.service';
import { UsersModule } from '../../users/users.module';
import { CoinTransactionsModule } from '../../coin-transactions/coin-transactions.module';
import { SupabaseModule } from '../../supabase/supabase.module';

@Module({
  imports: [AuthModule, UsersModule, CoinTransactionsModule, SupabaseModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, RazorpayService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
