import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { CreatorsModule } from '../creators/creators.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AuditLoggerService } from './audit-logger.service';

@Module({
  imports: [AuthModule, SupabaseModule, CreatorsModule],
  controllers: [AdminController],
  providers: [AdminService, AuditLoggerService],
  exports: [AdminService, AuditLoggerService],
})
export class AdminModule {}
