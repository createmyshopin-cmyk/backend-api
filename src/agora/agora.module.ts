import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CallsModule } from '../calls/calls.module';
import { UsersModule } from '../users/users.module';
import { AgoraController } from './agora.controller';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => UsersModule),
    forwardRef(() => CallsModule),
  ],
  controllers: [AgoraController],
})
export class AgoraModule {}
