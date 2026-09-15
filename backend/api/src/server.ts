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

  // 3. Graceful Shutdown Handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Graceful shutdown initiated...');
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
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Fatal error during application bootstrap');
  process.exit(1);
});
