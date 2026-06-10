import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MetricsService } from '../observability/metrics.service';
import { StructuredLoggerService } from '../observability/structured-logger.service';
import { TracingService } from '../observability/tracing.service';
import { AlarmsService } from '../observability/alarms.service';
import { clampReconciliationLimit } from './reconciliation-limit.util';

export type ReconciliationTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8';

export interface ReconciliationRunResult {
  runId: string;
  tier: ReconciliationTier;
  status: string;
  checksExecuted?: number;
  findingsOpen?: number;
}

export interface ReconciliationFinding {
  id: string;
  runId: string;
  checkId: string;
  tier: string;
  severity: string;
  status: string;
  fingerprint: string;
  entityType: string | null;
  entityId: string | null;
  deltaAmount: number | null;
  deltaCoins: number | null;
  evidenceJson: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
}

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLoggerService,
    private readonly tracing: TracingService,
    private readonly alarms: AlarmsService,
  ) {
    this.logger.setContext('ReconciliationService');
  }

  async runTier(tier: ReconciliationTier): Promise<ReconciliationRunResult> {
    const started = Date.now();
    return this.tracing.traceJob(`reconciliation.${tier}`, async () => {
      const { data, error } = await this.supabase
        .getClient()
        .rpc('reconciliation_run', { p_tier: tier });

      const durationMs = Date.now() - started;

      if (error) {
        this.metrics.recordReconciliationRun(tier, 'failed', durationMs);
        this.logger.error('reconciliation run failed', error.message, {
          event: 'reconciliation_run_failed',
          tier,
          duration_ms: durationMs,
        });
        throw new InternalServerErrorException(error.message);
      }

      const row = data as Record<string, unknown>;
      const status = String(row.status ?? 'completed');
      this.metrics.recordReconciliationRun(tier, status, durationMs);

      if (row.findings_open != null) {
        await this.refreshFindingGauges();
      }

      this.logger.log('reconciliation run completed', {
        event: 'reconciliation_run_completed',
        reconciliation_run_id: row.run_id,
        tier,
        duration_ms: durationMs,
        checks_executed: row.checks_executed,
        findings_open: row.findings_open,
        status,
      });

      await this.emitAlarmsForNewFindings(String(row.run_id));

      return {
        runId: String(row.run_id),
        tier,
        status,
        checksExecuted: row.checks_executed != null ? Number(row.checks_executed) : undefined,
        findingsOpen: row.findings_open != null ? Number(row.findings_open) : undefined,
      };
    });
  }

  async listRuns(limit = 50): Promise<Record<string, unknown>[]> {
    const clamped = clampReconciliationLimit(limit, 50);
    const { data, error } = await this.supabase
      .getClient()
      .from('reconciliation_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(clamped);

    if (error) throw new InternalServerErrorException(error.message);
    return data ?? [];
  }

  async listFindings(filters?: {
    status?: string;
    severity?: string;
    checkId?: string;
    limit?: number;
  }): Promise<ReconciliationFinding[]> {
    let query = this.supabase
      .getClient()
      .from('reconciliation_findings')
      .select('*')
      .order('last_seen_at', { ascending: false })
      .limit(clampReconciliationLimit(filters?.limit, 100));

    if (filters?.status) query = query.eq('status', filters.status);
    if (filters?.severity) query = query.eq('severity', filters.severity);
    if (filters?.checkId) query = query.eq('check_id', filters.checkId);

    const { data, error } = await query;
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []).map((r) => this.mapFinding(r));
  }

  async acknowledgeFinding(findingId: string, adminId: string): Promise<ReconciliationFinding> {
    const { data, error } = await this.supabase
      .getClient()
      .from('reconciliation_findings')
      .update({ status: 'acknowledged', resolved_by: adminId })
      .eq('id', findingId)
      .eq('status', 'open')
      .select('*')
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Finding not found or not open');
    return this.mapFinding(data);
  }

  async resolveFinding(
    findingId: string,
    adminId: string,
    notes: string,
  ): Promise<ReconciliationFinding> {
    const { data, error } = await this.supabase
      .getClient()
      .from('reconciliation_findings')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_by: adminId,
        resolution_notes: notes,
      })
      .eq('id', findingId)
      .in('status', ['open', 'acknowledged'])
      .select('*')
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Finding not found');
    return this.mapFinding(data);
  }

  async getHealth(): Promise<Record<string, unknown>> {
    const tiers: ReconciliationTier[] = ['T5', 'T6', 'T7', 'T8'];
    const lastSuccess: Record<string, string | null> = {};

    for (const tier of tiers) {
      const { data } = await this.supabase
        .getClient()
        .from('reconciliation_runs')
        .select('finished_at')
        .eq('tier', tier)
        .eq('status', 'completed')
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      lastSuccess[tier] = data?.finished_at ?? null;
    }

    const { count: openP0 } = await this.supabase
      .getClient()
      .from('reconciliation_findings')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open')
      .eq('severity', 'P0');

    const { count: openP1 } = await this.supabase
      .getClient()
      .from('reconciliation_findings')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open')
      .eq('severity', 'P1');

    return {
      last_successful_run: lastSuccess,
      open_findings: { P0: openP0 ?? 0, P1: openP1 ?? 0 },
    };
  }

  private mapFinding(row: Record<string, unknown>): ReconciliationFinding {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      checkId: String(row.check_id),
      tier: String(row.tier),
      severity: String(row.severity),
      status: String(row.status),
      fingerprint: String(row.fingerprint),
      entityType: row.entity_type ? String(row.entity_type) : null,
      entityId: row.entity_id ? String(row.entity_id) : null,
      deltaAmount: row.delta_amount != null ? Number(row.delta_amount) : null,
      deltaCoins: row.delta_coins != null ? Number(row.delta_coins) : null,
      evidenceJson: (row.evidence_json as Record<string, unknown>) ?? {},
      firstSeenAt: String(row.first_seen_at),
      lastSeenAt: String(row.last_seen_at),
    };
  }

  private async refreshFindingGauges(): Promise<void> {
    const { data } = await this.supabase
      .getClient()
      .from('reconciliation_findings')
      .select('severity, check_id')
      .eq('status', 'open');

    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const key = `${row.severity}:${row.check_id}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      const [severity, checkId] = key.split(':');
      this.metrics.setReconciliationFindingsOpen(severity, checkId, count);
    }
  }

  private async emitAlarmsForNewFindings(runId: string): Promise<void> {
    const { data } = await this.supabase
      .getClient()
      .from('reconciliation_findings')
      .select('*')
      .eq('run_id', runId)
      .eq('status', 'open')
      .in('severity', ['P0', 'P1']);

    for (const row of data ?? []) {
      const severity = String(row.severity) as 'P0' | 'P1';
      const checkId = String(row.check_id);

      this.logger.domainEvent(
        'reconciliation_finding_created',
        {
          finding_id: row.id,
          check_id: checkId,
          severity,
          entity_type: row.entity_type,
          entity_id: row.entity_id,
        },
        severity === 'P0' ? 'error' : 'warn',
      );

      if (checkId.startsWith('M-U') || checkId.startsWith('D-P-02')) {
        this.alarms.evaluatePaymentAlarm(checkId, severity);
      } else if (checkId.startsWith('N-W') || checkId.startsWith('D-P-') || checkId.startsWith('M-C-03')) {
        this.alarms.evaluateWithdrawalAlarm({
          withdrawalId: String(row.entity_id ?? 'unknown'),
          checkId,
          severity,
          delta: row.delta_amount != null ? Number(row.delta_amount) : undefined,
        });
      } else {
        this.alarms.evaluateDriftAlarms({
          checkId,
          severity,
          entityType: row.entity_type ? String(row.entity_type) : undefined,
          entityId: row.entity_id ? String(row.entity_id) : undefined,
          delta: row.delta_coins != null ? Number(row.delta_coins) : undefined,
        });
      }

      if (checkId === 'SYS-DRIFT-01' && row.evidence_json) {
        const delta = Number((row.evidence_json as Record<string, unknown>).conservation_delta ?? 0);
        this.metrics.setConservationDelta('global', delta);
      }
    }
  }
}
