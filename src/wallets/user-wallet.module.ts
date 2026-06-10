import { Global, Module } from '@nestjs/common';
import { UserWalletService } from './user-wallet.service';

@Global()
@Module({
  providers: [UserWalletService],
  exports: [UserWalletService],
})
export class UserWalletModule {}
