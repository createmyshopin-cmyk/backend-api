import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { WalletController } from './wallet.controller';
import { UsersModule } from '../users/users.module';
import { CoinTransactionsModule } from '../coin-transactions/coin-transactions.module';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [AuthModule, UsersModule, CoinTransactionsModule, SupabaseModule],
  controllers: [WalletsController, WalletController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
