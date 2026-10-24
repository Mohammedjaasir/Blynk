import { describe, it, expect, afterAll } from 'vitest';
import { sql } from 'kysely';
import { db } from '../src/database/connection.js';
import { revenueOf } from '../src/modules/reports/revenue-sql.js';

/** Reports leave a rider's cash tip out of revenue (migration 055), and keep working before 055 has run. */
afterAll(async () => {
  await db.destroy().catch(() => undefined);
});

describe('revenueOf', () => {
  it('is total + wallet minus the tip', async () => {
    const r = await sql<{ v: string }>`SELECT ${revenueOf('o')} AS v FROM (SELECT 1000::numeric AS total_amount, 200::numeric AS wallet_amount_used, 50::numeric AS rider_tip) o`.execute(db);
    expect(Number(r.rows[0]!.v)).toBe(1150);
  });

  it('is total + wallet when the row has no rider_tip column (before migration 055) or a null tip', async () => {
    const before = await sql<{ v: string }>`SELECT ${revenueOf('o')} AS v FROM (SELECT 1000::numeric AS total_amount, 200::numeric AS wallet_amount_used) o`.execute(db);
    expect(Number(before.rows[0]!.v)).toBe(1200);
    const nul = await sql<{ v: string }>`SELECT ${revenueOf('o')} AS v FROM (SELECT 1000::numeric AS total_amount, 200::numeric AS wallet_amount_used, NULL::numeric AS rider_tip) o`.execute(db);
    expect(Number(nul.rows[0]!.v)).toBe(1200);
  });
});
