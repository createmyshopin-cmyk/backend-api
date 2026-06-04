import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CallsModule } from '../calls/calls.module';
import { UsersModule } from '../users/users.module';
import { AgoraController } from './agora.controller';

@Module({
  imports: [AuthModule, UsersModule, CallsModule],
  controllers: [AgoraController],
})
export class AgoraModule {}
