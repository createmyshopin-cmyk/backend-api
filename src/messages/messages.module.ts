import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { UsersModule } from '../users/users.module';
import { MessageRpcService } from './message-rpc.service';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [SupabaseModule, UsersModule],
  controllers: [MessagesController],
  providers: [MessagesService, MessageRpcService],
  exports: [MessagesService],
})
export class MessagesModule {}
