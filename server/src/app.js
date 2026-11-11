import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './lib/errors.js';
import { sessionMiddleware, csrfGuard } from './auth.js';
import { createBus, createMailer, createPush } from './lib/services.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/account.js';
import setupRoutes from './routes/setup.js';
import jobRoutes from './routes/jobs.js';
import miscRoutes from './routes/misc.js';

/**
 * Build the Express app. `ctx` holds shared services so tests can swap the clock, mailer or database.
 */
export function createApp({ db, config, now = () => new Date(), logger = console }) {
  const ctx = { db, config, now, logger };
  ctx.bus = createBus();
  ctx.mailer = createMailer(config.smtp, logger);
  ctx.push = createPush(config.vapid, db, logger);

  const app = express();
  app.set('ctx', ctx);
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
        connectSrc: ["'self'", 'https://nominatim.openstreetmap.org'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        // Behind HTTPS in production; on plain-http local development this would break asset loading.
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use(sessionMiddleware(ctx));

  app.get('/api/health', (req, res) => res.json({ ok: true, time: ctx.now().toISOString() }));
  app.use('/api', csrfGuard);
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/me', accountRoutes(ctx));
  app.use('/api/jobs', jobRoutes(ctx));
  app.use('/api', setupRoutes(ctx));
  app.use('/api', miscRoutes(ctx));
  app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND' } }));

  // Serve the built web app (single-page app) when present.
  if (config.webDist && fs.existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.resolve(config.webDist, 'index.html')) : next()));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON' } });
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { code: 'FILE_TOO_LARGE' } });
    logger.error?.(err);
    res.status(500).json({ error: { code: 'SERVER_ERROR' } });
  });

  return { app, ctx };
}
