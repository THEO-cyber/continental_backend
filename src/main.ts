import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import * as path from 'path';
import { AppModule } from './app.module';
import { AppConfig } from './config/app.config';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(AppConfig);
  const logger = new Logger('Bootstrap');

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(compression());
  app.use((req: any, res: any, next: () => void) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Superadmin and Workers are hosted as separate static sites now, so their
  // API/Socket.IO calls arrive cross-origin — only these explicitly
  // configured origins may make credentialed requests. Empty by default
  // (same-origin only) until CORS_ORIGINS is set.
  app.enableCors({
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    credentials: true,
  });

  // Horizontal scaling: relay Socket.IO through Redis when REDIS_URL is set,
  // so realtime events reach clients on every server replica.
  if (config.redisUrl) {
    const redisAdapter = new RedisIoAdapter(app);
    await redisAdapter.connectToRedis(config.redisUrl);
    app.useWebSocketAdapter(redisAdapter);
    logger.log('Socket.IO Redis adapter enabled (multi-instance mode)');
  }

  // Static client site assets + uploaded images
  const week = 7 * 24 * 3600 * 1000;
  app.useStaticAssets(config.uploadsDir, { prefix: '/uploads/', maxAge: 30 * 24 * 3600 * 1000, immutable: true });
  app.useStaticAssets(path.join(config.clientDir, 'public'), { prefix: '/assets/', maxAge: week });

  await app.listen(config.port);
  logger.log('Continental Auto Parts system is running');
  logger.log(`Public site : ${config.siteUrl}  (/en /fr /zh)`);
  logger.log(`Allowed cross-origin apps: ${config.corsOrigins.join(', ') || '(none configured)'}`);
}

bootstrap();
