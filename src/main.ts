import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const isProd = process.env.NODE_ENV === 'production';
  const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors(
    isProd && corsOrigins?.length
      ? { origin: corsOrigins, credentials: true }
      : undefined,
  );

  // Prefix API routes; keep root health probes outside /api for load balancers.
  app.setGlobalPrefix('api', {
    exclude: [
      { path: '', method: RequestMethod.GET },
      { path: 'health', method: RequestMethod.GET },
    ],
  });

  // Configure validation globally
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // Swagger Documentation Setup
  const config = new DocumentBuilder()
    .setTitle('Coin Calling App API')
    .setDescription('The API backend documentation for Coin Calling voice/video platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  
  if (!isProd || process.env.ENABLE_SWAGGER === 'true') {
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const port = Number(process.env.PORT) || 5000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://0.0.0.0:${port}/api`);
  console.log(`Health check available at: http://0.0.0.0:${port}/health`);
  if (!isProd || process.env.ENABLE_SWAGGER === 'true') {
    console.log(`Swagger documentation available at: http://0.0.0.0:${port}/docs`);
  }
}
bootstrap();
