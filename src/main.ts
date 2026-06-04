import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for frontend connection
  app.enableCors();

  // Prefix all routes with /api, excluding root and health check endpoint
  app.setGlobalPrefix('api', { exclude: ['/', 'health'] });

  // Configure validation globally
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // Swagger Documentation Setup
  const config = new DocumentBuilder()
    .setTitle('Coin Calling App API')
    .setDescription('The API backend documentation for Coin Calling voice/video platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT || 5000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://localhost:${port}/api`);
  console.log(`Swagger documentation available at: http://localhost:${port}/docs`);
}
bootstrap();
