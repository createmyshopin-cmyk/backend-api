import { MetricsService } from './metrics.service';

describe('Rebuild sample metrics (T8)', () => {
  it('records INFO-tier rebuild sample as reconciliation finding counter', () => {
    const metrics = new MetricsService();
    metrics.recordReconciliationFinding('INFO', 'REBUILD-SAMPLE', true);
    const snap = metrics.snapshot();
    expect(snap.counters.reconciliation_findings_new_total?.[0]).toMatchObject({
      value: 1,
      labels: { severity: 'INFO', check_id: 'REBUILD-SAMPLE' },
    });
  });

  it('exports prometheus text for reconciliation gauges', () => {
    const metrics = new MetricsService();
    metrics.setGauge('wallet_reconciliation_delta_coins', 0, { scope: 'creator_sample' });
    const text = metrics.exportPrometheus();
    expect(text).toContain('wallet_reconciliation_delta_coins');
  });
});
