import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';
import { UsersModule } from '../users/users.module';
import { CreatorsModule } from '../creators/creators.module';
import { FcmService } from '../fcm/fcm.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { CallBillingRpcService } from './call-billing-rpc.service';
import { EngagementModule } from '../engagement/engagement.module';
import { WelcomeCallsModule } from '../welcome-calls/welcome-calls.module';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    CreatorsModule,
    SupabaseModule,
    EngagementModule,
    forwardRef(() => WelcomeCallsModule),
  ],
  controllers: [CallsController],
  providers: [CallsService, FcmService, CallBillingRpcService],
  exports: [CallsService, CallBillingRpcService],
})
export class CallsModule {}
