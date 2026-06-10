import { Injectable } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { StructuredLoggerService } from './structured-logger.service';
import { AlarmsService } from './alarms.service';

export interface SloDefinition {
  name: string;
  target: number;
  windowMinutes: number;
  burnRateThreshold: number;
}

export interface SloStatus {
  name: string;
  target: number;
  currentAvailability: number;
  errorBudgetRemaining: number;
  burnRate: number;
  alertFired: boolean;
}

@Injectable()
export class SloService {
  private readonly requestOutcomes: { ts: number; success: boolean; route: string }[] = [];

  private readonly definitions: SloDefinition[] = [
    { name: 'api_availability', target: 0.999, windowMinutes: 30, burnRateThreshold: 14.4 },
    { name: 'payment_verify_success', target: 0.995, windowMinutes: 60, burnRateThreshold: 6 },
    { name: 'reconciliation_t5_freshness', target: 0.99, windowMinutes: 15, burnRateThreshold: 10 },
  ];

  constructor(
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLoggerService,
    private readonly alarms: AlarmsService,
  ) {}

  recordRequestOutcome(route: string, success: boolean): void {
    this.requestOutcomes.push({ ts: Date.now(), success, route });
    this.prune();
  }

  evaluateAll(): SloStatus[] {
    return this.definitions.map((def) => this.evaluate(def));
  }

  evaluate(def: SloDefinition): SloStatus {
    const windowMs = def.windowMinutes * 60_000;
    const cutoff = Date.now() - windowMs;
    const inWindow = this.requestOutcomes.filter((r) => r.ts >= cutoff);

    let currentAvailability = 1;
    if (inWindow.length > 0) {
      const successes = inWindow.filter((r) => r.success).length;
      currentAvailability = successes / inWindow.length;
    } else {
      const lastT5 = this.metrics.snapshot().gauges.reconciliation_last_success_timestamp;
      const tierGauge = lastT5?.find((g) => g.labels.tier === 'T5');
      if (def.name === 'reconciliation_t5_freshness' && tierGauge) {
        const ageSec = Date.now() / 1000 - tierGauge.value;
        currentAvailability = ageSec < 600 ? 1 : 0;
      }
    }

    const errorBudget = 1 - def.target;
    const actualErrors = 1 - currentAvailability;
    const burnRate = errorBudget > 0 ? actualErrors / errorBudget : 0;
    const errorBudgetRemaining = Math.max(0, def.target - (1 - currentAvailability));
    const alertFired = burnRate >= def.burnRateThreshold;

    if (alertFired) {
      this.logger.warn('SLO burn rate alert', {
        event: 'slo_burn_rate_alert',
        slo_name: def.name,
        burn_rate: burnRate,
        threshold: def.burnRateThreshold,
        current_availability: currentAvailability,
      });
      this.alarms.evaluateDriftAlarms({
        checkId: `SLO-${def.name}`,
        severity: 'P1',
        entityType: 'system',
      });
    }

    return {
      name: def.name,
      target: def.target,
      currentAvailability,
      errorBudgetRemaining,
      burnRate,
      alertFired,
    };
  }

  private prune(): void {
    const maxWindow = Math.max(...this.definitions.map((d) => d.windowMinutes)) * 60_000;
    const cutoff = Date.now() - maxWindow;
    while (this.requestOutcomes.length > 0 && this.requestOutcomes[0].ts < cutoff) {
      this.requestOutcomes.shift();
    }
  }

  resetForTests(): void {
    this.requestOutcomes.length = 0;
  }
}
