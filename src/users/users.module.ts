import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserWalletModule } from '../wallets/user-wallet.module';
import { WelcomeCallsModule } from '../welcome-calls/welcome-calls.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    UserWalletModule,
    forwardRef(() => WelcomeCallsModule),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
