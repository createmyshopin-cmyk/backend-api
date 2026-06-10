import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { EngagementController } from './engagement.controller';
import { EngagementService } from './engagement.service';
import { EngagementRpcService } from './engagement-rpc.service';
import { MissionRpcService } from './mission-rpc.service';
import { MissionProgressHook } from './mission-progress.hook';
import { ComboRpcService } from './combo-rpc.service';
import { VipRpcService } from './vip-rpc.service';
import { VipService } from './vip.service';
import { VipController } from './vip.controller';

@Module({
  imports: [AuthModule, SupabaseModule],
  controllers: [EngagementController, VipController],
  providers: [
    EngagementService,
    EngagementRpcService,
    MissionRpcService,
    MissionProgressHook,
    ComboRpcService,
    VipRpcService,
    VipService,
  ],
  exports: [
    EngagementService,
    MissionProgressHook,
    MissionRpcService,
    ComboRpcService,
    VipRpcService,
    VipService,
  ],
})
export class EngagementModule {}
