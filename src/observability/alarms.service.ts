import { Injectable } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { StructuredLoggerService } from './structured-logger.service';

export type AlarmSeverity = 'P0' | 'P1' | 'WARN' | 'INFO';

export interface AlarmEvent {
  alarmId: string;
  domain: 'drift' | 'payment' | 'withdrawal' | 'reconciliation' | 'slo';
  severity: AlarmSeverity;
  message: string;
  checkId?: string;
  entityType?: string;
  entityId?: string;
  delta?: number;
}

@Injectable()
export class AlarmsService {
  private readonly fired = new Map<string, number>();

  constructor(
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLoggerService,
  ) {}

  evaluateDriftAlarms(input: {
    checkId: string;
    severity: AlarmSeverity;
    entityType?: string;
    entityId?: string;
    delta?: number;
  }): AlarmEvent | null {
    if (!['P0', 'P1'].includes(input.severity)) return null;

    const alarm: AlarmEvent = {
      alarmId: `drift:${input.checkId}:${input.entityId ?? 'system'}`,
      domain: 'drift',
      severity: input.severity,
      message: `Drift detected: ${input.checkId}`,
      checkId: input.checkId,
      entityType: input.entityType,
      entityId: input.entityId,
      delta: input.delta,
    };
    return this.fire(alarm);
  }

  evaluatePaymentAlarm(reason: string, severity: AlarmSeverity = 'P0'): AlarmEvent | null {
    if (severity === 'INFO') return null;
    const alarm: AlarmEvent = {
      alarmId: `payment:${reason}`,
      domain: 'payment',
      severity,
      message: `Payment alarm: ${reason}`,
      checkId: reason,
    };
    this.metrics.recordPaymentSuccessWithoutLedger();
    return this.fire(alarm);
  }

  evaluateWithdrawalAlarm(input: {
    withdrawalId: string;
    checkId: string;
    severity: AlarmSeverity;
    delta?: number;
  }): AlarmEvent | null {
    if (!['P0', 'P1'].includes(input.severity)) return null;
    const alarm: AlarmEvent = {
      alarmId: `withdrawal:${input.checkId}:${input.withdrawalId}`,
      domain: 'withdrawal',
      severity: input.severity,
      message: `Withdrawal alarm: ${input.checkId}`,
      checkId: input.checkId,
      entityId: input.withdrawalId,
      delta: input.delta,
    };
    if (input.delta != null) {
      this.metrics.recordWithdrawalInvariantViolation(input.delta);
    }
    return this.fire(alarm);
  }

  private fire(alarm: AlarmEvent): AlarmEvent | null {
    const now = Date.now();
    const last = this.fired.get(alarm.alarmId) ?? 0;
    const cooldownMs = alarm.severity === 'P0' ? 60_000 : 300_000;
    if (now - last < cooldownMs) return null;

    this.fired.set(alarm.alarmId, now);
    const level = alarm.severity === 'P0' ? 'error' : 'warn';
    this.logger.domainEvent(
      `${alarm.domain}_alarm_fired`,
      {
        domain: alarm.domain,
        alarm_id: alarm.alarmId,
        severity: alarm.severity,
        check_id: alarm.checkId,
        entity_type: alarm.entityType,
        entity_id: alarm.entityId,
        delta: alarm.delta,
        message: alarm.message,
      },
      level,
    );
    return alarm;
  }

  resetForTests(): void {
    this.fired.clear();
  }
}
