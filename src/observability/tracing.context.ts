import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';

export interface TraceContext {
  traceId: string;
  spanId: string;
  correlationId: string;
  requestId: string;
  parentSpanId?: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function parseTraceparent(header?: string): Partial<TraceContext> | null {
  if (!header) return null;
  const parts = header.split('-');
  if (parts.length < 4 || parts[0] !== '00') return null;
  const traceId = parts[1];
  const spanId = parts[2];
  if (traceId.length !== 32 || spanId.length !== 16) return null;
  return { traceId, spanId, parentSpanId: spanId };
}

export function formatTraceparent(ctx: TraceContext): string {
  return `00-${ctx.traceId}-${ctx.spanId}-01`;
}

export function createTraceContext(
  incoming?: Partial<TraceContext> & { traceparent?: string },
): TraceContext {
  const fromHeader = incoming?.traceparent
    ? parseTraceparent(incoming.traceparent)
    : null;
  return {
    traceId: fromHeader?.traceId ?? incoming?.traceId ?? hex(16),
    spanId: hex(8),
    parentSpanId: fromHeader?.spanId ?? incoming?.parentSpanId,
    correlationId: incoming?.correlationId ?? hex(16),
    requestId: incoming?.requestId ?? hex(16),
  };
}

export function runWithTraceContext<T>(ctx: TraceContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getTraceContext(): TraceContext | undefined {
  return storage.getStore();
}

export function activeSpanAttributes(): Record<string, string> {
  const ctx = getTraceContext();
  if (!ctx) return {};
  return {
    trace_id: ctx.traceId,
    span_id: ctx.spanId,
    correlation_id: ctx.correlationId,
    request_id: ctx.requestId,
  };
}
