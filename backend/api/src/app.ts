import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware.js';
import { httpMetricsMiddleware } from './middleware/http-metrics.middleware.js';
import { checkDatabaseConnection, pool } from './database/connection.js';

// Module routers
import { authRouter } from './modules/auth/index.js';
import { usersRouter, meRouter } from './modules/users/index.js';
import { catalogRouter, categoriesRouter, productsRouter } from './modules/catalog/index.js';
import { pricingRouter } from './modules/pricing/index.js';
import { inventoryRouter } from './modules/inventory/index.js';
import { ordersRouter } from './modules/orders/index.js';
import { paymentsRouter } from './modules/payments/index.js';
import { deliveriesRouter } from './modules/deliveries/index.js';
import { ridersRouter } from './modules/riders/index.js';
import { notificationsRouter } from './modules/notifications/index.js';
import { adminRouter } from './modules/admin/index.js';
import { promotionsRouter } from './modules/promotions/index.js';
import { auditRouter } from './modules/audit/index.js';
import { configurationRouter } from './modules/configuration/index.js';

export function createApp(): Express {
  const app = express();

  // 1. Core Security & Request ID
  app.use(requestIdMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // 2. CORS
  const allowedOrigins = env.CORS_ORIGINS === '*' ? '*' : env.CORS_ORIGINS.split(',');
  app.use(
    cors({
      origin: allowedOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'Idempotency-Key', 'x-idempotency-key'],
      exposedHeaders: ['x-request-id'],
      maxAge: 86400, // 24 hours
    })
  );

  // 3. Body Parsers with limits
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // 4. Structured HTTP Logging (Pino)
  if (env.NODE_ENV !== 'test') {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => req.id,
        customLogLevel: (_req, res, err) => {
          if (res.statusCode >= 500 || err) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
      })
    );
  }

  // 5. In-process HTTP Metrics counters
  app.use(httpMetricsMiddleware);

  // 6. Health Check Endpoint (GET /health) — deep database connectivity probe
  app.get('/health', async (_req, res) => {
    const dbStatus = await checkDatabaseConnection();

    // PostgreSQL connection pool statistics
    const poolStats = {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    };

    res.status(dbStatus.ok ? 200 : 503).json({
      success: dbStatus.ok,
      data: {
        status: dbStatus.ok ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: env.NODE_ENV,
        database: {
          status: dbStatus.ok ? 'connected' : 'disconnected',
          latencyMs: dbStatus.latencyMs,
          pool: poolStats,
        },
      },
    });
  });

  // 7. Readiness Probe (GET /ready) — lightweight liveness check (no DB probe)
  // Returns 200 as long as the process is alive and the Express router is
  // registered.  Used by container orchestrators (K8s readinessProbe, etc.).
  app.get('/ready', (_req, res) => {
    res.status(200).json({
      success: true,
      data: {
        status: 'ready',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      },
    });
  });

  // 9. Mount Domain Modules under /api/v1
  const apiRouter = express.Router();
  apiRouter.use('/auth', authRouter);
  apiRouter.use('/me', meRouter);
  apiRouter.use('/users', usersRouter);
  apiRouter.use('/categories', categoriesRouter);
  apiRouter.use('/products', productsRouter);
  apiRouter.use('/catalog', catalogRouter);
  apiRouter.use('/promotions', promotionsRouter);
  apiRouter.use('/pricing', pricingRouter);
  apiRouter.use('/inventory', inventoryRouter);
  apiRouter.use('/orders', ordersRouter);
  apiRouter.use('/payments', paymentsRouter);
  apiRouter.use('/deliveries', deliveriesRouter);
  apiRouter.use('/rider', ridersRouter);
  apiRouter.use('/riders', ridersRouter);
  apiRouter.use('/notifications', notificationsRouter);
  apiRouter.use('/admin', adminRouter);
  apiRouter.use('/audit', auditRouter);
  apiRouter.use('/configuration', configurationRouter);

  // Admin-uploaded media (product photos, promotion visuals). Served from
  // the same origin as the API so the customer app and admin UI need no
  // extra host configuration. See utils/storage.ts for the storage choice.
  app.use(
    '/uploads',
    express.static(env.MEDIA_ROOT, {
      maxAge: '7d',
      index: false,
      dotfiles: 'ignore',
      setHeaders: (res) => {
        // Helmet defaults every response to same-origin CORP, which stops
        // the admin web app (a different origin) from displaying these
        // images. Media is public, non-credentialed content, so it is
        // marked cross-origin here - and only here.
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    })
  );

  app.use(env.API_PREFIX, apiRouter);

  // 10. Error Handling (404 and Global Error Handler)
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}

