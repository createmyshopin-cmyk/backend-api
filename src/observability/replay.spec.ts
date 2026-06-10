import { TracingService } from './tracing.service';
import { StructuredLoggerService } from './structured-logger.service';
import { runWithTraceContext, createTraceContext, getTraceContext } from './tracing.context';

describe('Trace replay / correlation', () => {
  const tracing = new TracingService(new StructuredLoggerService());

  it('propagates trace context through nested spans', async () => {
    const parent = createTraceContext({ correlationId: 'corr-replay-1' });
    await runWithTraceContext(parent, async () => {
      await tracing.startSpanAsync({ name: 'supabase.rpc.reconciliation_run' }, async () => {
        const ctx = getTraceContext();
        expect(ctx?.correlationId).toBe('corr-replay-1');
        expect(ctx?.traceId).toBe(parent.traceId);
        expect(ctx?.spanId).not.toBe(parent.spanId);
      });
    });
  });

  it('parses W3C traceparent for replay correlation', () => {
    const parent = createTraceContext({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      correlationId: 'replay-job',
    });
    expect(parent.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });
});
