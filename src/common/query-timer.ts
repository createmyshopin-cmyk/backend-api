import { Logger } from '@nestjs/common';

export interface TimedResult<T> {
  label: string;
  ms: number;
  result: T;
  error?: string;
}

/**
 * Times an async operation and emits a structured log line.
 * Used for per-query dashboard diagnostics in production logs.
 */
export async function timed<T>(
  logger: Logger,
  scope: string,
  label: string,
  fn: () => Promise<T>,
): Promise<TimedResult<T>> {
  const start = performance.now();
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - start);
    logger.log(`[${scope}] ${label} completed in ${ms}ms`);
    return { label, ms, result };
  } catch (e) {
    const ms = Math.round(performance.now() - start);
    const message = e instanceof Error ? e.message : String(e);
    logger.warn(`[${scope}] ${label} failed after ${ms}ms — ${message}`);
    throw e;
  }
}

/** Log Promise.all wall-clock vs slowest child query (bottleneck indicator). */
export function logParallelSummary(
  logger: Logger,
  scope: string,
  wallMs: number,
  children: TimedResult<unknown>[],
): void {
  const sorted = [...children].sort((a, b) => b.ms - a.ms);
  const slowest = sorted[0];
  const totalChildMs = children.reduce((s, c) => s + c.ms, 0);
  logger.log(
    `[${scope}] Promise.all wall=${wallMs}ms slowest="${slowest?.label}"=${slowest?.ms ?? 0}ms ` +
      `sum_children=${totalChildMs}ms queries=${children.length}`,
  );
  if (wallMs > 5000) {
    logger.warn(
      `[${scope}] SLOW_REQUEST wall=${wallMs}ms — check Railway cold start or full-table scans`,
    );
  }
}
