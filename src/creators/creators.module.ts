import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CreatorsService } from './creators.service';
import { CreatorsController } from './creators.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [forwardRef(() => AuthModule), forwardRef(() => UsersModule)],
  controllers: [CreatorsController],
  providers: [CreatorsService],
  exports: [CreatorsService],
})
export class CreatorsModule {}
