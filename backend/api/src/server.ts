import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { pool, checkDatabaseConnection } from './database/connection.js';

async function bootstrap() {
  logger.info({ environment: env.NODE_ENV, port: env.PORT }, 'Initializing Blynk backend application...');

  // 1. Verify PostgreSQL Database connectivity
  const dbHealth = await checkDatabaseConnection();
  if (!dbHealth.ok) {
    logger.warn('Initial PostgreSQL connection check failed. Ensure PostgreSQL is running on the configured DATABASE_URL.');
  } else {
    logger.info({ latencyMs: dbHealth.latencyMs }, 'PostgreSQL database connected successfully');
  }

  // 2. Start HTTP listener
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`🚀 Blynk Quick-Commerce API running on port ${env.PORT} [${env.NODE_ENV}]`);
    logger.info(`📡 API root: http://localhost:${env.PORT}${env.API_PREFIX}`);
    logger.info(`🩺 Health check: http://localhost:${env.PORT}/health`);
  });

  // 3. Start Notification Outbox Worker daemon (if enabled)
  const { notificationWorker } = await import('./modules/notifications/index.js');
  if (env.NOTIFICATION_WORKER_ENABLED) {
    notificationWorker.start();
  } else {
    logger.info('Notification Outbox Worker is disabled by configuration (NOTIFICATION_WORKER_ENABLED=false)');
  }

  // 4. Graceful Shutdown Handlers
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown initiated...');

    // Stop worker loop first to prevent claiming new jobs
    if (env.NOTIFICATION_WORKER_ENABLED) {
      try {
        await notificationWorker.stop();
      } catch (workerErr) {
        logger.error({ err: workerErr }, 'Error stopping notification worker');
      }
    }

    server.close(async () => {
      logger.info('HTTP server closed.');
      try {
        await pool.end();
        logger.info('PostgreSQL pool drained.');
      } catch (err) {
        logger.error({ err }, 'Error draining PostgreSQL pool');
      }
      process.exit(0);
    });

    // Force close after 10s timeout
    setTimeout(() => {
      logger.error('Graceful shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Fatal error during application bootstrap');
  process.exit(1);
});
