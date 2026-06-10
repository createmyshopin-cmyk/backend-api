import { Injectable } from '@nestjs/common';

type Labels = Record<string, string>;

interface CounterEntry {
  value: number;
  labels: Labels;
}

interface HistogramEntry {
  count: number;
  sum: number;
  buckets: Map<number, number>;
  labels: Labels;
}

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, CounterEntry[]>();
  private readonly histograms = new Map<string, HistogramEntry[]>();
  private readonly gauges = new Map<string, { value: number; labels: Labels }[]>();

  private static readonly httpBuckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

  private labelKey(labels: Labels): string {
    return Object.keys(labels)
      .sort()
      .map((k) => `${k}=${labels[k]}`)
      .join(',');
  }

  incrementCounter(name: string, labels: Labels = {}, delta = 1): void {
    const key = this.labelKey(labels);
    const entries = this.counters.get(name) ?? [];
    const existing = entries.find((e) => this.labelKey(e.labels) === key);
    if (existing) {
      existing.value += delta;
    } else {
      entries.push({ value: delta, labels: { ...labels } });
    }
    this.counters.set(name, entries);
  }

  observeHistogram(name: string, valueSeconds: number, labels: Labels = {}): void {
    const key = this.labelKey(labels);
    const entries = this.histograms.get(name) ?? [];
    let entry = entries.find((e) => this.labelKey(e.labels) === key);
    if (!entry) {
      entry = {
        count: 0,
        sum: 0,
        buckets: new Map(MetricsService.httpBuckets.map((b) => [b, 0])),
        labels: { ...labels },
      };
      entries.push(entry);
    }
    entry.count += 1;
    entry.sum += valueSeconds;
    for (const bound of MetricsService.httpBuckets) {
      if (valueSeconds <= bound) {
        entry.buckets.set(bound, (entry.buckets.get(bound) ?? 0) + 1);
      }
    }
    this.histograms.set(name, entries);
  }

  setGauge(name: string, value: number, labels: Labels = {}): void {
    const key = this.labelKey(labels);
    const entries = this.gauges.get(name) ?? [];
    const existing = entries.find((e) => this.labelKey(e.labels) === key);
    if (existing) {
      existing.value = value;
    } else {
      entries.push({ value, labels: { ...labels } });
    }
    this.gauges.set(name, entries);
  }

  // RED metrics
  recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    const statusClass = `${Math.floor(statusCode / 100)}xx`;
    this.incrementCounter('http_requests_total', { method, route, status_class: statusClass });
    this.observeHistogram('http_request_duration_seconds', durationMs / 1000, { method, route });
  }

  // Payment metrics
  recordPaymentVerify(status: 'success' | 'failure' | 'replay'): void {
    this.incrementCounter('payment_verify_total', { status });
  }

  recordPaymentWebhookSignatureFailure(): void {
    this.incrementCounter('payment_webhook_signature_failure_total');
  }

  recordPaymentSuccessWithoutLedger(): void {
    this.incrementCounter('payment_success_without_ledger_total');
  }

  // Withdrawal metrics
  recordWithdrawalTransition(from: string, to: string): void {
    this.incrementCounter('withdrawal_transition_total', { from, to });
  }

  recordWithdrawalInvariantViolation(delta: number): void {
    this.setGauge('withdrawal_invariant_violation', delta);
    this.incrementCounter('withdrawal_over_commit_detected_total');
  }

  recordWithdrawalIdempotentReplay(): void {
    this.incrementCounter('withdrawal_idempotent_replay_total');
  }

  // Reconciliation metrics
  recordReconciliationRun(tier: string, status: string, durationMs: number): void {
    this.incrementCounter('reconciliation_run_status_total', { tier, status });
    this.observeHistogram('reconciliation_run_duration_seconds', durationMs / 1000, { tier });
    if (status === 'completed') {
      this.setGauge('reconciliation_last_success_timestamp', Date.now() / 1000, { tier });
    }
  }

  recordReconciliationFinding(severity: string, checkId: string, isNew: boolean): void {
    if (isNew) {
      this.incrementCounter('reconciliation_findings_new_total', { severity, check_id: checkId });
    }
  }

  setReconciliationFindingsOpen(severity: string, checkId: string, count: number): void {
    this.setGauge('reconciliation_findings_open', count, { severity, check_id: checkId });
  }

  setConservationDelta(scope: string, delta: number): void {
    this.setGauge('reconciliation_conservation_delta', delta, { scope });
  }

  exportPrometheus(): string {
    const lines: string[] = [];
    for (const [name, entries] of this.counters) {
      for (const e of entries) {
        const labelStr = Object.entries(e.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',');
        lines.push(`${name}{${labelStr}} ${e.value}`);
      }
    }
    for (const [name, entries] of this.gauges) {
      for (const e of entries) {
        const labelStr = Object.entries(e.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',');
        lines.push(`${name}{${labelStr}} ${e.value}`);
      }
    }
    return lines.join('\n');
  }

  snapshot(): {
    counters: Record<string, CounterEntry[]>;
    gauges: Record<string, { value: number; labels: Labels }[]>;
  } {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
    };
  }

  resetForTests(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }
}
