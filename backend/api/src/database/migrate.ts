import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './connection.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function ensureMigrationTable(client: import('pg').PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _blynk_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function runMigrations(direction: 'up' | 'down' = 'up'): Promise<void> {
  const client = await pool.connect();
  try {
    await ensureMigrationTable(client);

    const defaultDir = path.join(__dirname, 'migrations');
    const fallbackDir = path.join(__dirname, '../../src/database/migrations');
    const migrationsDir = fs.existsSync(defaultDir) ? defaultDir : fallbackDir;
    const files = fs.readdirSync(migrationsDir).sort();

    if (direction === 'up') {
      const upFiles = files.filter((f) => f.endsWith('.sql') && !f.endsWith('_down.sql'));

      for (const file of upFiles) {
        const { rows } = await client.query('SELECT name FROM _blynk_migrations WHERE name = $1', [file]);
        if (rows.length > 0) {
          logger.info({ migration: file }, 'Migration already applied, skipping');
          continue;
        }

        logger.info({ migration: file }, 'Applying migration (up)...');
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

        // PostgreSQL invariant: New enum values added via ALTER TYPE ... ADD VALUE cannot be used
        // in index/table expressions within the same transaction block (error 55P04: check_safe_enum_use).
        // Pre-commit any enum values in autocommit mode prior to the transactional DDL execution.
        if (sql.includes("notification_status_enum ADD VALUE")) {
          try {
            await client.query("ALTER TYPE notification_status_enum ADD VALUE IF NOT EXISTS 'PROCESSING'");
          } catch {
            // Ignore if already present
          }
        }

        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO _blynk_migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
          logger.info({ migration: file }, 'Migration successfully applied');
        } catch (err) {
          await client.query('ROLLBACK');
          logger.error({ migration: file, err }, 'Migration failed, transaction rolled back');
          throw err;
        }
      }
    } else {
      // Rollback: reverse order
      const { rows } = await client.query('SELECT name FROM _blynk_migrations ORDER BY id DESC LIMIT 1');
      if (rows.length === 0) {
        logger.info('No migrations to rollback');
        return;
      }

      const lastMigration = rows[0].name;
      const downFile = lastMigration.replace('.sql', '_down.sql');
      const downFilePath = path.join(migrationsDir, downFile);

      if (!fs.existsSync(downFilePath)) {
        throw new Error(`Rollback file not found: ${downFile}`);
      }

      logger.info({ migration: lastMigration }, 'Rolling back migration (down)...');
      const sql = fs.readFileSync(downFilePath, 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('DELETE FROM _blynk_migrations WHERE name = $1', [lastMigration]);
        await client.query('COMMIT');
        logger.info({ migration: lastMigration }, 'Migration successfully rolled back');
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ migration: lastMigration, err }, 'Rollback failed, transaction rolled back');
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

// Allow direct CLI execution: tsx src/database/migrate.ts up|down or node dist/database/migrate.js up|down
const isMainScript =
  process.argv[1] &&
  (process.argv[1].endsWith('migrate.ts') ||
    process.argv[1].endsWith('migrate.js') ||
    process.argv[1].includes('migrate'));

if (isMainScript) {
  const direction = process.argv[2] === 'down' ? 'down' : 'up';
  runMigrations(direction)
    .then(() => {
      logger.info('Migration process finished successfully');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'Migration process failed');
      process.exit(1);
    });
}
