import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware.js';
import { checkDatabaseConnection } from './database/connection.js';

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
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
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

  // 5. Health Check Endpoint (GET /health)
  app.get('/health', async (_req, res) => {
    const dbStatus = await checkDatabaseConnection();

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
        },
      },
    });
  });

  // 6. Mount Domain Modules under /api/v1
  const apiRouter = express.Router();
  apiRouter.use('/auth', authRouter);
  apiRouter.use('/me', meRouter);
  apiRouter.use('/users', usersRouter);
  apiRouter.use('/categories', categoriesRouter);
  apiRouter.use('/products', productsRouter);
  apiRouter.use('/catalog', catalogRouter);
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

  app.use(env.API_PREFIX, apiRouter);

  // 7. Error Handling (404 and Global Error Handler)
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
