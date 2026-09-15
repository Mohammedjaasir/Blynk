import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { Database } from './types.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Standard Node-Postgres connection pool
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20, // 20 concurrent connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error on idle client');
});

// Kysely query builder instance
export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool,
  }),
});

/**
 * Checks connectivity to the PostgreSQL database.
 * Returns true if successful, false otherwise.
 */
export async function checkDatabaseConnection(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1 AS ping');
      const latencyMs = Date.now() - start;
      return { ok: true, latencyMs };
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error({ error }, 'Database health check failed');
    return { ok: false, latencyMs: Date.now() - start };
  }
}
