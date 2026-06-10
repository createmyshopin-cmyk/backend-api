import { Injectable } from '@nestjs/common';
import {
  TraceContext,
  createTraceContext,
  formatTraceparent,
  getTraceContext,
  runWithTraceContext,
} from './tracing.context';
import { StructuredLoggerService } from './structured-logger.service';

export interface SpanOptions {
  name: string;
  attributes?: Record<string, string | number | boolean>;
}

@Injectable()
export class TracingService {
  constructor(private readonly logger: StructuredLoggerService) {}

  startSpan<T>(options: SpanOptions, fn: (spanId: string) => T): T {
    const parent = getTraceContext();
    const child: TraceContext = parent
      ? {
          ...parent,
          spanId: createTraceContext().spanId,
          parentSpanId: parent.spanId,
        }
      : createTraceContext({});

    const started = Date.now();
    return runWithTraceContext(child, () => {
      try {
        const result = fn(child.spanId);
        this.logger.debug(`span completed: ${options.name}`, {
          event: 'span_completed',
          span_name: options.name,
          duration_ms: Date.now() - started,
          traceparent: formatTraceparent(child),
          ...options.attributes,
        });
        return result;
      } catch (err) {
        this.logger.error(`span failed: ${options.name}`, err instanceof Error ? err.stack : undefined, {
          event: 'span_failed',
          span_name: options.name,
          duration_ms: Date.now() - started,
          ...options.attributes,
        });
        throw err;
      }
    });
  }

  async startSpanAsync<T>(
    options: SpanOptions,
    fn: (spanId: string) => Promise<T>,
  ): Promise<T> {
    const parent = getTraceContext();
    const child: TraceContext = parent
      ? {
          ...parent,
          spanId: createTraceContext().spanId,
          parentSpanId: parent.spanId,
        }
      : createTraceContext({});

    const started = Date.now();
    return runWithTraceContext(child, async () => {
      try {
        const result = await fn(child.spanId);
        this.logger.debug(`span completed: ${options.name}`, {
          event: 'span_completed',
          span_name: options.name,
          duration_ms: Date.now() - started,
          traceparent: formatTraceparent(child),
          ...options.attributes,
        });
        return result;
      } catch (err) {
        this.logger.error(`span failed: ${options.name}`, err instanceof Error ? err.stack : undefined, {
          event: 'span_failed',
          span_name: options.name,
          duration_ms: Date.now() - started,
          ...options.attributes,
        });
        throw err;
      }
    });
  }

  traceRpc<T>(rpcName: string, fn: () => Promise<T>): Promise<T> {
    return this.startSpanAsync(
      { name: `supabase.rpc.${rpcName}`, attributes: { rpc_name: rpcName } },
      () => fn(),
    );
  }

  traceJob<T>(jobName: string, fn: () => Promise<T>): Promise<T> {
    return this.startSpanAsync(
      { name: `job.${jobName}`, attributes: { job_name: jobName } },
      () => fn(),
    );
  }
}
