import 'dotenv/config';
import { runStartupValidation, getPlatformConfig } from './startup';

async function bootstrap() {
  await runStartupValidation({
    service: 'admin-backend',
    skipProbes: process.env.SKIP_STARTUP_PROBES === 'true',
  });

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app.module');
  const { RequestMethod, ValidationPipe } = await import('@nestjs/common');
  const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');

  const platform = getPlatformConfig();
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors(
    platform.tier === 'production' && platform.corsOrigins.length
      ? { origin: platform.corsOrigins, credentials: true }
      : platform.corsOrigins.length
        ? { origin: platform.corsOrigins, credentials: true }
        : undefined,
  );

  app.setGlobalPrefix('api', {
    exclude: [
      { path: '', method: RequestMethod.GET },
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      { path: 'health/startup', method: RequestMethod.GET },
    ],
  });

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const swaggerEnabled =
    platform.tier !== 'production' || platform.enableSwagger;

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Coin Calling App API')
      .setDescription('The API backend documentation for Coin Calling voice/video platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const port = Number(process.env.PORT) || 5000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://0.0.0.0:${port}/api`);
  console.log(`Health check available at: http://0.0.0.0:${port}/health`);
  console.log(`Readiness probe at: http://0.0.0.0:${port}/health/ready`);
  console.log(`Startup probe at: http://0.0.0.0:${port}/health/startup`);
  if (swaggerEnabled) {
    console.log(`Swagger documentation available at: http://0.0.0.0:${port}/docs`);
  }
}

bootstrap().catch((err) => {
  console.error(
    JSON.stringify({
      event: 'bootstrap_failed',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
});
