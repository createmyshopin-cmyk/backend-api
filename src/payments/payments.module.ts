import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { CoinPackagesController } from './coin-packages.controller';
import { PaymentRpcService } from './payment-rpc.service';
import { RazorpayWebhookService } from './razorpay-webhook.service';
import { RazorpayWebhookController } from './razorpay-webhook.controller';
import { UsersModule } from '../users/users.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { EngagementModule } from '../engagement/engagement.module';

@Module({
  imports: [AuthModule, UsersModule, SupabaseModule, EngagementModule],
  controllers: [PaymentsController, CoinPackagesController, RazorpayWebhookController],
  providers: [PaymentsService, PaymentRpcService, RazorpayWebhookService],
  exports: [PaymentsService, PaymentRpcService],
})
export class PaymentsModule {}

