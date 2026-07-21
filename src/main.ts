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

  // Horizontal scaling: relay Socket.IO through Redis when REDIS_URL is set,
  // so realtime events reach clients on every server replica.
  if (config.redisUrl) {
    const redisAdapter = new RedisIoAdapter(app);
    await redisAdapter.connectToRedis(config.redisUrl);
    app.useWebSocketAdapter(redisAdapter);
    logger.log('Socket.IO Redis adapter enabled (multi-instance mode)');
  }

  // Static frontends + uploaded images
  const week = 7 * 24 * 3600 * 1000;
  app.useStaticAssets(config.uploadsDir, { prefix: '/uploads/', maxAge: 30 * 24 * 3600 * 1000, immutable: true });
  app.useStaticAssets(path.join(config.clientDir, 'public'), { prefix: '/assets/', maxAge: week });
  // no-cache (not just max-age=0): admin/workers are long-lived open tabs that
  // poll and refresh live — every load must revalidate with the server so a
  // deployed JS/CSS change is never masked by a stale disk-cache hit.
  const revalidateAlways = (res: any) => res.set('Cache-Control', 'no-cache, must-revalidate');
  app.useStaticAssets(config.superadminDir, { prefix: '/admin/', maxAge: 0, setHeaders: revalidateAlways });
  app.useStaticAssets(config.workersDir, { prefix: '/workers/', maxAge: 0, setHeaders: revalidateAlways });

  await app.listen(config.port);
  logger.log('Continental Auto Parts system is running');
  logger.log(`Public site : ${config.siteUrl}  (/en /fr /zh)`);
  logger.log(`Superadmin  : ${config.siteUrl}/admin`);
  logger.log(`Workers     : ${config.siteUrl}/workers`);
}

bootstrap();
