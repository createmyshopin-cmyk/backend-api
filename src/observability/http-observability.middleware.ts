import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { MetricsService } from './metrics.service';
import { SloService } from './slo.service';
import {
  createTraceContext,
  formatTraceparent,
  runWithTraceContext,
} from './tracing.context';

@Injectable()
export class HttpObservabilityMiddleware implements NestMiddleware {
  constructor(
    private readonly metrics: MetricsService,
    private readonly slo: SloService,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId =
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    const correlationId =
      (req.headers['x-correlation-id'] as string | undefined) ?? requestId;
    const traceparent = req.headers['traceparent'] as string | undefined;

    const ctx = createTraceContext({
      traceparent,
      correlationId,
      requestId,
    });

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Correlation-Id', correlationId);
    res.setHeader('traceparent', formatTraceparent(ctx));

    const route = req.route?.path ?? req.path;
    const method = req.method;
    const started = Date.now();

    this.metrics.incrementCounter('http_requests_in_flight', { route }, 1);

    res.on('finish', () => {
      const durationMs = Date.now() - started;
      this.metrics.recordHttpRequest(method, route, res.statusCode, durationMs);
      this.metrics.incrementCounter('http_requests_in_flight', { route }, -1);
      this.slo.recordRequestOutcome(route, res.statusCode < 500);
    });

    runWithTraceContext(ctx, () => next());
  }
}
