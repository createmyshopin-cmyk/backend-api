import { Controller, Get } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { SloService } from './slo.service';

@Controller('api/observability')
export class ObservabilityController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly slo: SloService,
  ) {}

  @Get('metrics')
  metricsEndpoint(): string {
    return this.metrics.exportPrometheus();
  }

  @Get('slos')
  slos() {
    return { slos: this.slo.evaluateAll() };
  }
}
