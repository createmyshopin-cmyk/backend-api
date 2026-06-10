import { MetricsService } from './metrics.service';
import { SloService } from './slo.service';
import { AlarmsService } from './alarms.service';
import { StructuredLoggerService } from './structured-logger.service';

describe('Reconciliation drift metrics', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
  });

  it('records reconciliation run duration and status', () => {
    metrics.recordReconciliationRun('T5', 'completed', 4200);
    const snap = metrics.snapshot();
    expect(snap.counters.reconciliation_run_status_total?.[0]?.value).toBe(1);
    expect(snap.gauges.reconciliation_last_success_timestamp?.[0]?.labels.tier).toBe('T5');
  });

  it('tracks open findings by severity and check_id', () => {
    metrics.setReconciliationFindingsOpen('P0', 'SYS-DRIFT-01', 3);
    metrics.setConservationDelta('global', -12);
    const snap = metrics.snapshot();
    expect(snap.gauges.reconciliation_findings_open?.[0]?.value).toBe(3);
    expect(snap.gauges.reconciliation_conservation_delta?.[0]?.value).toBe(-12);
  });

  it('SLO burn rate alerts when availability drops', () => {
    const slo = new SloService(metrics, new StructuredLoggerService(), new AlarmsService(metrics, new StructuredLoggerService()));
    for (let i = 0; i < 100; i++) {
      slo.recordRequestOutcome('/api/calls/request', i < 90);
    }
    const status = slo.evaluate({
      name: 'api_availability',
      target: 0.999,
      windowMinutes: 30,
      burnRateThreshold: 5,
    });
    expect(status.currentAvailability).toBe(0.9);
    expect(status.burnRate).toBeGreaterThan(5);
    expect(status.alertFired).toBe(true);
  });
});
