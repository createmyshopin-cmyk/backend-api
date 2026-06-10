import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { UsersModule } from '../../users/users.module';
import { CoinTransactionsModule } from '../../coin-transactions/coin-transactions.module';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [AuthModule, UsersModule, CoinTransactionsModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
})
export class AdminUsersModule {}
