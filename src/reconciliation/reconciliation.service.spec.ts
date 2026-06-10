import { ReconciliationService } from './reconciliation.service';
import { MetricsService } from '../observability/metrics.service';
import { StructuredLoggerService } from '../observability/structured-logger.service';
import { TracingService } from '../observability/tracing.service';
import { AlarmsService } from '../observability/alarms.service';

function mockSupabase(rpcResult: Record<string, unknown>, tables: Record<string, unknown> = {}) {
  const fromHandlers: Record<string, () => unknown> = {};
  return {
    getClient: () => ({
      rpc: jest.fn().mockResolvedValue({ data: rpcResult, error: null }),
      from: (table: string) => {
        const handler = fromHandlers[table] ?? (() => ({ select: () => ({ data: [], error: null }) }));
        return handler();
      },
    }),
    isConfigured: true,
    _setFrom: (table: string, impl: () => unknown) => {
      fromHandlers[table] = impl;
    },
  };
}

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let metrics: MetricsService;
  let supabase: ReturnType<typeof mockSupabase>;

  beforeEach(() => {
    metrics = new MetricsService();
    supabase = mockSupabase({
      run_id: 'run-1',
      tier: 'T5',
      status: 'completed',
      checks_executed: 12,
      findings_open: 2,
    });
    const chainable = {
      eq: () => chainable,
      in: () => Promise.resolve({ data: [], error: null }),
    };
    supabase._setFrom('reconciliation_findings', () => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
        ...chainable,
      }),
    }));

    service = new ReconciliationService(
      supabase as never,
      metrics,
      new StructuredLoggerService(),
      new TracingService(new StructuredLoggerService()),
      new AlarmsService(metrics, new StructuredLoggerService()),
    );
  });

  it('runs tier via RPC and records metrics', async () => {
    const result = await service.runTier('T5');
    expect(result.runId).toBe('run-1');
    expect(result.status).toBe('completed');
    const snap = metrics.snapshot();
    expect(snap.counters.reconciliation_run_status_total?.[0]?.labels.tier).toBe('T5');
  });

  it('maps findings from list query', async () => {
    const findingRow = {
      id: 'f1',
      run_id: 'run-1',
      check_id: 'U-DRIFT-01',
      tier: 'T2',
      severity: 'P1',
      status: 'open',
      fingerprint: 'fp',
      entity_type: 'user',
      entity_id: 'u1',
      delta_amount: null,
      delta_coins: 5,
      evidence_json: {},
      first_seen_at: '2026-06-10T00:00:00Z',
      last_seen_at: '2026-06-10T00:00:00Z',
    };
    const afterLimit = {
      eq: () => Promise.resolve({ data: [findingRow], error: null }),
    };
    const listChain = {
      order: () => ({
        limit: () => afterLimit,
      }),
    };
    supabase._setFrom('reconciliation_findings', () => ({
      select: () => listChain,
    }));

    const findings = await service.listFindings({ status: 'open' });
    expect(findings).toHaveLength(1);
    expect(findings[0].checkId).toBe('U-DRIFT-01');
  });
});
