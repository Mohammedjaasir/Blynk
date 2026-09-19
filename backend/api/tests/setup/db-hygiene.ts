import dotenv from 'dotenv';
import pg from 'pg';
import { OUTBOX_PAUSE_LOCK_KEY } from '../../src/modules/notifications/outbox-pause.js';

/**
 * Global setup for every backend test run.
 *
 * 1. Outbox pause. The suite shares the development database with the
 *    development API, whose notification worker polls the outbox. For the
 *    whole run this holds the outbox pause lock (src/modules/notifications/
 *    outbox-pause.ts), so that worker claims nothing and never races a test.
 *    It first lets the outbox go quiet: nothing queued or being sent. If
 *    messages stay pending it refuses to start rather than let the worker
 *    tests send them or let them change mid-run.
 *
 * 2. Database hygiene (inventory plan I10). With DB_HYGIENE=1
 *    (`npm run test:hygiene`) every row of every table is checksummed before
 *    and after the run, keyed by primary key, and the run fails - naming each
 *    added, removed or changed row - if anything differs. A complete run must
 *    leave the database exactly as it found it.
 */
dotenv.config();

export type Fingerprint = Record<string, { rows: number; rowHashes: Record<string, string> }>;

const QUIET_TIMEOUT_MS = 30_000;

async function fingerprint(client: pg.Client): Promise<Fingerprint> {
  const tables = (
    await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"
    )
  ).rows.map((r) => r.table_name);
  const out: Fingerprint = {};
  for (const table of tables) {
    const pk = (
      await client.query<{ attname: string }>(
        `SELECT a.attname FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY a.attnum`,
        [`public."${table}"`]
      )
    ).rows.map((r) => `t."${r.attname}"::text`);
    // Without a primary key a row is identified by its own content.
    const key = pk.length ? pk.join(` || '|' || `) : 'md5(t::text)';
    const rows = (await client.query<{ k: string; h: string }>(`SELECT ${key} AS k, md5(t::text) AS h FROM "${table}" t`)).rows;
    const rowHashes: Record<string, string> = {};
    for (const r of rows) {
      let k = r.k;
      for (let n = 2; k in rowHashes; n++) k = `${r.k}#${n}`; // identical key-less rows
      rowHashes[k] = r.h;
    }
    out[table] = { rows: rows.length, rowHashes };
  }
  return out;
}

const list = (ids: string[]) => ids.slice(0, 5).join(', ') + (ids.length > 5 ? ` (+${ids.length - 5} more)` : '');

/** Every table whose rows differ, with the ids added, removed and changed. */
export function diffFingerprints(before: Fingerprint, after: Fingerprint): string[] {
  const lines: string[] = [];
  for (const t of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const a = before[t];
    const b = after[t];
    if (!b) {
      lines.push(`${t}: table removed`);
      continue;
    }
    if (!a) {
      lines.push(`${t}: table added`);
      continue;
    }
    const added = Object.keys(b.rowHashes).filter((k) => !(k in a.rowHashes)).sort();
    const removed = Object.keys(a.rowHashes).filter((k) => !(k in b.rowHashes)).sort();
    const changed = Object.keys(a.rowHashes).filter((k) => k in b.rowHashes && a.rowHashes[k] !== b.rowHashes[k]).sort();
    if (!added.length && !removed.length && !changed.length) continue;
    const parts = [`${t}: rows ${a.rows} -> ${b.rows}`];
    if (added.length) parts.push(`added: ${list(added)}`);
    if (removed.length) parts.push(`removed: ${list(removed)}`);
    if (changed.length) parts.push(`changed: ${list(changed)}`);
    lines.push(parts.join('; '));
  }
  return lines;
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export default async function setup() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const count = async (statuses: string[]) =>
    (await client.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE status = ANY($1)', [statuses])).rows[0].n;

  try {
    // Let a running development worker finish what is queued, then pause it,
    // then let any send it had already claimed complete.
    await waitUntil(async () => (await count(['QUEUED', 'PROCESSING'])) === 0, QUIET_TIMEOUT_MS);
    await client.query('SELECT pg_advisory_lock($1)', [OUTBOX_PAUSE_LOCK_KEY]);
    await waitUntil(async () => (await count(['PROCESSING'])) === 0, QUIET_TIMEOUT_MS);
    const pending = (
      await client.query<{ n: number; next: string | null }>(
        "SELECT count(*)::int AS n, min(next_attempt_at)::text AS next FROM notifications WHERE status IN ('QUEUED', 'PROCESSING')"
      )
    ).rows[0];
    if (pending.n > 0) {
      throw new Error(
        `${pending.n} notification(s) are still waiting to be sent (next attempt ${pending.next}). ` +
          'The worker tests would send them and they could change mid-run. Let the development API drain the outbox, then run again.'
      );
    }
  } catch (err) {
    await client.end();
    throw err;
  }

  const hygiene = process.env.DB_HYGIENE === '1';
  const before = hygiene ? await fingerprint(client) : null;

  return async function teardown() {
    try {
      if (!before) return;
      const changed = diffFingerprints(before, await fingerprint(client));
      if (changed.length) {
        // Also printed, in case the runner only summarises teardown errors.
        console.error(`\nDB HYGIENE FAILED - the test run changed the database:\n  ${changed.join('\n  ')}\n`);
        throw new Error(`DB hygiene: ${changed.length} table(s) changed: ${changed.join(' | ')}`);
      }
      console.log('\nDB HYGIENE OK - every row of every table is identical to before the run.\n');
    } finally {
      await client.end(); // releases the outbox pause lock
    }
  };
}
