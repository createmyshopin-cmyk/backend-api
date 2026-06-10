import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationScheduler } from './reconciliation.scheduler';

@Module({
  imports: [SupabaseModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService, ReconciliationScheduler],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
