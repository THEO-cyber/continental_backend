import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/app.config';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap(): Promise<void> {
  // CORS must be set at creation time, not via a later app.enableCors() call
  // — under Nest 11 + Express 5 the latter leaves preflight OPTIONS requests
  // unhandled (404 "Cannot OPTIONS ..."), since the CORS middleware ends up
  // registered after Express's router has already been finalized. Read
  // CORS_ORIGINS directly from process.env here (matching AppConfig's own
  // parsing) since the DI container — and therefore AppConfig — doesn't
  // exist yet at this point.
  const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: { origin: corsOrigins.length ? corsOrigins : false, credentials: true },
  });
  const config = app.get(AppConfig);
  const logger = new Logger('Bootstrap');

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(compression());
  app.use(helmet({
    // The public client site (the only HTML this backend renders — admin
    // and workers are separate static sites now) has no inline scripts or
    // styles left, so this is a real allowlist, not a hole punched in it.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'https://res.cloudinary.com', 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameSrc: ['https://www.openstreetmap.org'], // the contact-page location embed
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    // Both would otherwise require Cloudinary/OpenStreetMap to opt in via
    // headers we don't control, breaking product images and the map embed.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
  app.use((req: any, res: any, next: () => void) => {
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

  app.useStaticAssets(config.uploadsDir, { prefix: '/uploads/', maxAge: 30 * 24 * 3600 * 1000, immutable: true });

  await app.listen(config.port);
  logger.log('Continental Auto Parts system is running (API + realtime only)');
  logger.log(`Public site : ${config.siteUrl}  (rendered separately, Netlify-hosted)`);
  logger.log(`Allowed cross-origin apps: ${config.corsOrigins.join(', ') || '(none configured)'}`);
}

bootstrap();
