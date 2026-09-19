import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { pool, checkDatabaseConnection } from './database/connection.js';
import { notificationWorker } from './modules/notifications/index.js';

async function bootstrapWorker() {
  logger.info(
    {
      environment: env.NODE_ENV,
      workerEnabled: env.NOTIFICATION_WORKER_ENABLED,
      intervalMs: env.NOTIFICATION_WORKER_INTERVAL_MS,
      batchSize: env.NOTIFICATION_WORKER_BATCH_SIZE,
      leaseTimeoutMs: env.NOTIFICATION_PROCESSING_TIMEOUT_MS,
    },
    'Initializing standalone Blynk Notification Outbox Worker daemon...'
  );

  // 1. Verify PostgreSQL Database connectivity
  const dbHealth = await checkDatabaseConnection();
  if (!dbHealth.ok) {
    logger.warn('Initial PostgreSQL connection check failed for worker. Ensure PostgreSQL is reachable.');
  } else {
    logger.info({ latencyMs: dbHealth.latencyMs }, 'PostgreSQL database connected for worker');
  }

  // 2. Start Worker Daemon if enabled
  if (env.NOTIFICATION_WORKER_ENABLED) {
    notificationWorker.start();
    logger.info('Notification Outbox Worker daemon started successfully');
  } else {
    logger.warn('NOTIFICATION_WORKER_ENABLED is set to false. Worker process will remain idle.');
  }

  // 3. Graceful Shutdown Handlers
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Graceful worker shutdown initiated...');

    try {
      await notificationWorker.stop();
      logger.info('Notification worker stopped cleanly.');
    } catch (workerErr) {
      logger.error({ err: workerErr }, 'Error stopping notification worker');
    }

    try {
      await pool.end();
      logger.info('Worker PostgreSQL pool drained.');
    } catch (poolErr) {
      logger.error({ err: poolErr }, 'Error draining worker PostgreSQL pool');
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrapWorker().catch((err) => {
  logger.fatal({ err }, 'Fatal error during worker bootstrap');
  process.exit(1);
});
