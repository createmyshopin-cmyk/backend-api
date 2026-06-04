import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { CoinTransactionsService } from '../calls/coin-transactions.service';

@Module({
  imports: [SupabaseModule],
  providers: [CoinTransactionsService],
  exports: [CoinTransactionsService],
})
export class CoinTransactionsModule {}
