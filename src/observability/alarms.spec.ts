import { AlarmsService } from './alarms.service';
import { MetricsService } from './metrics.service';
import { StructuredLoggerService } from './structured-logger.service';

describe('AlarmsService', () => {
  let alarms: AlarmsService;
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
    alarms = new AlarmsService(metrics, new StructuredLoggerService());
  });

  it('fires drift P0 alarm once per cooldown window', () => {
    const first = alarms.evaluateDriftAlarms({
      checkId: 'U-DRIFT-01',
      severity: 'P0',
      entityType: 'user',
      entityId: 'user-1',
      delta: 10,
    });
    const second = alarms.evaluateDriftAlarms({
      checkId: 'U-DRIFT-01',
      severity: 'P0',
      entityType: 'user',
      entityId: 'user-1',
      delta: 10,
    });
    expect(first?.alarmId).toContain('drift:U-DRIFT-01');
    expect(second).toBeNull();
  });

  it('fires payment alarm and increments metric', () => {
    const alarm = alarms.evaluatePaymentAlarm('M-U-01', 'P0');
    expect(alarm?.domain).toBe('payment');
    const snap = metrics.snapshot();
    expect(snap.counters.payment_success_without_ledger_total?.[0]?.value).toBe(1);
  });

  it('fires withdrawal invariant alarm', () => {
    const alarm = alarms.evaluateWithdrawalAlarm({
      withdrawalId: 'w-1',
      checkId: 'N-W-LOCK',
      severity: 'P1',
      delta: 50,
    });
    expect(alarm?.domain).toBe('withdrawal');
    expect(metrics.snapshot().gauges.withdrawal_invariant_violation?.[0]?.value).toBe(50);
  });
});
