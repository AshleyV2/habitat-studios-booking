import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { authenticate } from './middleware/auth';
import { issueCsrfCookie, verifyCsrf } from './middleware/csrf';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { apiLimiter, assetLimiter } from './middleware/rate-limit';
import { siteController } from './controllers/site.controller';
import { apiRouter } from './routes';
import { databaseCheck } from './services/health.service';
import { processEvent, verifyEvent } from './stripe/webhook.service';
import { logger } from './utils/logger';

export function redactTokens(url: string | undefined) {
  return url?.replace(/([?&](?:token|session_id|code)=)[^&#]*/gi, '$1[redacted]');
}

function loadIndexHtml(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = [path.resolve(here, '../../client/dist/index.html'), path.resolve(process.cwd(), 'client/dist/index.html')].find((p) => fs.existsSync(p));
  if (!file) return null;
  // The client is built with relative asset URLs; <base> makes them (and the SPA
  // router) work under any BASE_PATH without rebuilding.
  const base = `${env.basePath}/`;
  return fs
    .readFileSync(file, 'utf8')
    .replace('<head>', `<head>\n    <base href="${base}" />\n    <meta name="habitat-base-path" content="${env.basePath}" />`);
}

const smallJson = express.json({ limit: '100kb' });
const siteJson = express.json({ limit: '1mb' });
// A setup file (Admin › Settings › Server › import) carries up to two website documents; its photos are sent separately.
const setupJson = express.json({ limit: '4mb' });

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          // Website builder embeds: YouTube/Vimeo videos and Google Maps.
          frameSrc: ['https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.google.com', 'https://maps.google.com'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          // Checkout is a full-page redirect to Stripe.
          formAction: ["'self'", 'https://checkout.stripe.com'],
          frameAncestors: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  if (!env.isTest) {
    app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => (req.url ?? '').endsWith('/health') },
        customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
        serializers: { req: (req) => ({ method: req.method, url: redactTokens(req.url) }), res: (res) => ({ statusCode: res.statusCode }) },
      }),
    );
  }

  const root = Router();

  // Health: no auth, no infrastructure details. /health/ready checks the local database.
  root.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  root.get('/health/ready', async (_req, res) => {
    const db = await databaseCheck();
    res.status(db.status === 'ok' ? 200 : 503).json({ status: db.status === 'ok' ? 'ok' : 'unavailable' });
  });

  // Stripe webhook: raw body for signature verification; no cookies, no CSRF.
  // Website images: outside the API rate limit (a page can show many), with their own.
  root.get('/api/public/site/assets/:id', assetLimiter, siteController.asset);

  root.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: { code: 'bad_request', message: 'Expected raw body' } });
    const event = verifyEvent(req.body, req.get('stripe-signature'));
    const result = await processEvent(event);
    logger.info({ eventId: event.id, type: event.type, result }, 'Stripe webhook');
    res.json({ received: true, result });
  });

  root.use(
    '/api',
    cors({ origin: [...env.allowedOrigins], credentials: true }),
    (_req, res, next) => {
      res.set('Cache-Control', 'no-store');
      next();
    },
    apiLimiter,
    // The website builder saves the whole site in one request; everything else stays small.
    (req, res, next) =>
      (req.method === 'PUT' && req.path === '/admin/site/draft' ? siteJson : req.method === 'POST' && req.path === '/admin/settings/transfer/import' ? setupJson : smallJson)(req, res, next),
    cookieParser(),
    issueCsrfCookie,
    verifyCsrf,
    authenticate,
    apiRouter,
  );
  root.use('/api', notFoundHandler);

  if (env.SERVE_CLIENT) {
    const indexHtml = loadIndexHtml();
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dist = [path.resolve(here, '../../client/dist'), path.resolve(process.cwd(), 'client/dist')].find((p) => fs.existsSync(p));
    if (!indexHtml || !dist) {
      logger.warn('SERVE_CLIENT=true but client/dist is missing — run `npm run build`');
    } else {
      root.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
      root.use(express.static(dist, { index: false, maxAge: '1h' }));
      root.get(/.*/, (_req, res) => {
        res.set('Cache-Control', 'no-cache').type('html').send(indexHtml);
      });
    }
  }

  app.use(env.basePath || '/', root);
  // Liveness at the root too, for container health checks regardless of BASE_PATH.
  if (env.basePath) app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
