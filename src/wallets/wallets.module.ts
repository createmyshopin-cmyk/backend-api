import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletsService } from './wallets.service';
import { UserWalletModule } from './user-wallet.module';
import { WalletsController } from './wallets.controller';
import { WalletController } from './wallet.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [AuthModule, UsersModule, UserWalletModule],
  controllers: [WalletsController, WalletController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
