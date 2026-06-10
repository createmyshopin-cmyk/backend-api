import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ReconciliationService, ReconciliationTier } from './reconciliation.service';
import { StructuredLoggerService } from '../observability/structured-logger.service';

interface ScheduleEntry {
  tier: ReconciliationTier;
  intervalMs: number;
  enabled: boolean;
}

@Injectable()
export class ReconciliationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly schedules: ScheduleEntry[] = [
    { tier: 'T5', intervalMs: 5 * 60_000, enabled: true },
    { tier: 'T6', intervalMs: 60 * 60_000, enabled: true },
    { tier: 'T7', intervalMs: 24 * 60 * 60_000, enabled: true },
    { tier: 'T8', intervalMs: 7 * 24 * 60 * 60_000, enabled: true },
  ];

  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly logger: StructuredLoggerService,
  ) {
    this.logger.setContext('ReconciliationScheduler');
  }

  onModuleInit(): void {
    if (process.env.DISABLE_RECONCILIATION_SCHEDULER === 'true') {
      this.logger.warn('reconciliation scheduler disabled by env', {
        event: 'reconciliation_scheduler_disabled',
      });
      return;
    }

    for (const entry of this.schedules) {
      if (!entry.enabled) continue;
      const timer = setInterval(() => {
        void this.runSafe(entry.tier);
      }, entry.intervalMs);
      timer.unref?.();
      this.timers.push(timer);
    }

    void this.runSafe('T0');
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers.length = 0;
  }

  private async runSafe(tier: ReconciliationTier): Promise<void> {
    try {
      await this.reconciliation.runTier(tier);
    } catch (err) {
      this.logger.error(
        `scheduled reconciliation ${tier} failed`,
        err instanceof Error ? err.stack : undefined,
        { event: 'reconciliation_scheduler_error', tier },
      );
    }
  }
}
