import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for frontend connection
  app.enableCors();

  // Prefix all routes with /api
  app.setGlobalPrefix('api');

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

  await app.listen(5000);
  console.log(`Application is running on: http://localhost:5000/api`);
  console.log(`Swagger documentation available at: http://localhost:5000/docs`);
}
bootstrap();
