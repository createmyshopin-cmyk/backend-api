import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { FcmService } from '../fcm/fcm.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { UsersModule } from '../users/users.module';
import { EngagementModule } from '../engagement/engagement.module';
import { AdminGiftsController } from './admin-gifts.controller';
import { CreatorGuard } from './creator.guard';
import { GiftController } from './gift.controller';
import { GiftRepository } from './gift.repository';
import { GiftService } from './gift.service';
import { ListenerGiftsController } from './listener-gifts.controller';
import { AppUserGuard } from './app-user.guard';
import { UserThrottlerGuard } from './user-throttler.guard';

@Module({
  imports: [
    AuthModule,
    SupabaseModule,
    UsersModule,
    EngagementModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
  ],
  controllers: [GiftController, ListenerGiftsController, AdminGiftsController],
  providers: [
    GiftService,
    GiftRepository,
    FcmService,
    CreatorGuard,
    UserThrottlerGuard,
    AppUserGuard,
  ],
  exports: [GiftService, GiftRepository],
})
export class GiftModule {}
