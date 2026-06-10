import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { CreatorAnalyticsRpcService } from './creator-analytics-rpc.service';

@Module({
  imports: [SupabaseModule],
  providers: [CreatorAnalyticsRpcService],
  exports: [CreatorAnalyticsRpcService],
})
export class CreatorAnalyticsModule {}
