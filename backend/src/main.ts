import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  const corsOrigin = process.env.NEXTAUTH_URL;
  if (!corsOrigin) throw new Error('NEXTAUTH_URL env var is required');
  app.enableCors({ origin: corsOrigin, credentials: true });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
