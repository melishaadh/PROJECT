// Must stay the first import: it installs the runtime resolution for the `@/*`
// and `@db/*` aliases that every import below (transitively) depends on.
import './register-aliases';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
import * as cookieParser from 'cookie-parser';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { UPLOAD_DIR, UPLOAD_ROUTE } from './common/storage.service';

/**
 * Origins allowed to call the API with credentials.
 *
 * `origin: true` (reflect whatever asked) combined with `credentials: true` is
 * the pairing that would make the refresh cookie readable by any site the user
 * happens to visit, so it is no longer safe now that a cookie is in play. In
 * development the caller is Expo on the LAN over plain http — where the cookie
 * is not even set as `secure` — so the permissive reflection stays; in
 * production the allow-list is explicit or nothing is allowed.
 */
function corsOrigin(configService: ConfigService) {
  const configured = (configService.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  if (configured.length > 0) return configured;
  if (configService.get<string>('NODE_ENV') === 'production') {
    Logger.warn(
      'CORS_ORIGINS is not set; refusing all cross-origin browser requests.',
      'Bootstrap'
    );
    return false;
  }
  return true;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  // Mount socket.io onto the same HTTP server (no port) so the real-time chat
  // gateway shares the API origin and CORS posture instead of opening its own.
  app.useWebSocketAdapter(new IoAdapter(app));

  app.enableCors({
    origin: corsOrigin(configService),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Client-Info', 'Apikey'],
  });

  // Required to read the http-only refresh cookie on /auth/refresh.
  app.use(cookieParser());

  /**
   * Body limit.
   *
   * Profile pictures no longer travel as inline base64 — they go to object
   * storage through a multipart endpoint with its own 5MB cap — so the JSON
   * limit is back to something appropriate for JSON. The previous 8MB ceiling
   * existed purely to accommodate base64 DPs, and left *every* route on the
   * API accepting multi-megabyte payloads as a side effect.
   */
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ limit: '256kb', extended: true }));

  /**
   * Locally-stored uploads. In production Cloudinary serves these instead and
   * this route is never hit — see `StorageService`.
   *
   * The response headers are defensive: `Content-Disposition: attachment` plus
   * `nosniff` and a null CSP mean that even if a file somehow got past the
   * magic-byte check, a browser would download it rather than execute it
   * against our own origin.
   */
  app.useStaticAssets(join(process.cwd(), UPLOAD_DIR), {
    prefix: UPLOAD_ROUTE,
    index: false,
    dotfiles: 'deny',
    maxAge: '7d',
    setHeaders: res => {
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    },
  });

  /**
   * Global validation.
   *
   * `whitelist` strips any property a DTO does not declare, and
   * `forbidNonWhitelisted` rejects such a request outright instead of silently
   * dropping the extra key — which is what stops an unexpected property (a
   * Mongo operator object, an `isAdmin: true`) from reaching a service that
   * might spread it into an update. `transform` runs the `@Type`/`@Transform`
   * coercions the query DTOs depend on.
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      // Don't echo the rejected value back to the caller in the error body.
      validationError: { target: false, value: false },
    }),
  );

  // Catch-all error translation. Registered globally so no route can return a
  // bare 500 carrying Mongo driver internals — every failure becomes a
  // well-formed JSON body the client can render.
  app.useGlobalFilters(new AllExceptionsFilter());

  // API prefix
  app.setGlobalPrefix('api');

  // Behind a proxy the throttler has to key on the forwarded client IP rather
  // than the load balancer's, or every user shares a single rate-limit bucket.
  if (configService.get<string>('TRUST_PROXY') === 'true') {
    app.set('trust proxy', 1);
  }

  const port = configService.get<number>('PORT') || 3001;

  await app.listen(port);
  Logger.log(`TrekEasy Backend running on: http://0.0.0.0:${port}/api`, 'Bootstrap');
}

/**
 * A rejected promise or uncaught throw during startup used to exit silently with
 * a blank console, which looked exactly like "the server started but nothing
 * works". Fail loudly instead.
 */
bootstrap().catch(error => {
  Logger.error(`Failed to start TrekEasy Backend: ${error?.message ?? error}`, error?.stack, 'Bootstrap');
  process.exit(1);
});

// A dropped Mongo connection surfacing as an unhandled rejection would otherwise
// take the whole process down without explanation.
process.on('unhandledRejection', (reason: any) => {
  Logger.error(`Unhandled promise rejection: ${reason?.message ?? reason}`, reason?.stack, 'Process');
});
