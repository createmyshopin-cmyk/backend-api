import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';
import { UsersModule } from '../users/users.module';
import { CreatorsModule } from '../creators/creators.module';
import { FcmService } from '../fcm/fcm.service';
import { CoinTransactionsModule } from '../coin-transactions/coin-transactions.module';

@Module({
  imports: [AuthModule, UsersModule, CreatorsModule, CoinTransactionsModule],
  controllers: [CallsController],
  providers: [CallsService, FcmService],
  exports: [CallsService],
})
export class CallsModule {}
