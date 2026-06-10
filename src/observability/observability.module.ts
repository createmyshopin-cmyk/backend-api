import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { StructuredLoggerService } from './structured-logger.service';
import { TracingService } from './tracing.service';
import { AlarmsService } from './alarms.service';
import { SloService } from './slo.service';
import { HttpObservabilityMiddleware } from './http-observability.middleware';
import { ObservabilityController } from './observability.controller';

@Global()
@Module({
  controllers: [ObservabilityController],
  providers: [
    MetricsService,
    StructuredLoggerService,
    TracingService,
    AlarmsService,
    SloService,
    HttpObservabilityMiddleware,
  ],
  exports: [
    MetricsService,
    StructuredLoggerService,
    TracingService,
    AlarmsService,
    SloService,
  ],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpObservabilityMiddleware).forRoutes('*');
  }
}
