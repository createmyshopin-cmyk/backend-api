import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { CreatorsModule } from '../creators/creators.module';
import { AdminAuditModule } from './admin-audit.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminLifecycleController } from './admin-lifecycle.controller';

@Module({
  imports: [AuthModule, SupabaseModule, CreatorsModule, AdminAuditModule],
  controllers: [AdminController, AdminLifecycleController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
