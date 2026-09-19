import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { pool } from '../src/database/connection.js';
import { notificationService, NotificationWorker } from '../src/modules/notifications/index.js';
import { OUTBOX_PAUSE_LOCK_KEY } from '../src/modules/notifications/outbox-pause.js';

/**
 * The test suite shares the development database with the development API,
 * whose notification worker polls the outbox every few seconds. While the
 * suite runs it holds the outbox pause lock (tests/setup/db-hygiene.ts), and
 * the worker's polling loop claims nothing while that lock is held - so no
 * test races it. Direct processBatch() calls (what tests use) are unaffected.
 */
describe('Outbox pause while the test suite runs', () => {
  const customerId = 'a0000001-0000-0000-0000-000000000001';
  const KEY = `pause_${Date.now()}_`;

  afterAll(async () => {
    await pool.query('DELETE FROM notifications WHERE idempotency_key LIKE $1', [`${KEY}%`]);
  });

  async function enqueue(suffix: string) {
    await notificationService.enqueue({
      user_id: customerId,
      channel: 'SMS',
      notification_type: 'ORDER_PLACED',
      recipient: '+94771234567',
      payload: { order_number: 'BL-PAUSE-01', total_amount: 100 },
      idempotency_key: `${KEY}${suffix}`,
    });
  }
  const status = async (suffix: string) =>
    (await pool.query('SELECT status FROM notifications WHERE idempotency_key = $1', [`${KEY}${suffix}`])).rows[0].status as string;

  it('the suite holds the pause lock for the whole run', async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query('SELECT pg_try_advisory_lock_shared($1) AS ok', [OUTBOX_PAUSE_LOCK_KEY]);
      expect(rows[0].ok).toBe(false);
    } finally {
      await client.end();
    }
  });

  it('a polling worker claims nothing while the pause is held', async () => {
    await enqueue('daemon');
    const worker = new NotificationWorker({ workerId: 'pause_daemon', intervalMs: 60_000, batchSize: 50 });

    worker.start(); // runs its first polling tick immediately
    await worker.stop(); // waits for that tick to finish

    expect(await status('daemon')).toBe('QUEUED');
  });

  it('a direct processBatch still processes (what tests and manual drains use)', async () => {
    await enqueue('direct');
    const worker = new NotificationWorker({ workerId: 'pause_direct', batchSize: 50 });

    await worker.processBatch();

    expect(await status('direct')).toBe('SENT');
  });
});
