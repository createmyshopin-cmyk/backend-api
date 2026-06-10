import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { UsersModule } from '../users/users.module';
import { MessageRpcService } from './message-rpc.service';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [SupabaseModule, forwardRef(() => AuthModule), forwardRef(() => UsersModule)],
  controllers: [MessagesController],
  providers: [MessagesService, MessageRpcService],
  exports: [MessagesService],
})
export class MessagesModule {}
