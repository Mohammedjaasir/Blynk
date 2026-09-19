/*
 * One-time repair of dev-database pollution left by backend tests before the
 * 2026-09-19 test-hygiene fixes (inventory stock-integrity plan, decision I8
 * as approved: restore only what can be proven; never guess).
 *
 * Proven and repaired:
 *   - 50 PURCHASE_RESTOCK rows on the seeded Munchee crackers inventory row whose
 *     note is 'Received distributor carton' - a literal that exists only in
 *     tests/inventory.test.ts in this repository and every script;
 *   - 48 ORDER_FULFILLMENT rows, each the immediately next movement after one of
 *     those rows (previous_quantity = its new_quantity, < 5 s later), by the
 *     seeded packing staff the test signs in as, delta -3 as in the test, whose
 *     referenced order no longer exists;
 *   - the Munchee inventory row returned to its seed state (UNTRACKED, 0 on hand,
 *     0 reserved), as defined by src/database/seeds/dev_seed.ts §6 (commit f20daf5).
 *     This removes test output; it is not a stock movement, so no ledger row is
 *     written for it.
 *
 * Not provable, therefore NOT modified (listed only):
 *   - one DAMAGE_WRITE_OFF -100 row (2026-09-16, no note) that matches no code;
 *   - 15 customer accounts renamed to 'Ahmed Rizvi' by an old security test,
 *     whose previous names are recorded nowhere.
 *
 * Usage:  node scripts/repair-test-pollution-2026-09-19.cjs          (dry run)
 *         node scripts/repair-test-pollution-2026-09-19.cjs --apply  (one transaction, exact-count guards)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const MUNCHEE = 'b0000001-0000-0000-0000-000000000004';
const TEST_STAFF = 'a0000001-0000-0000-0000-000000000004';
const TEST_NOTE = 'Received distributor carton';
const EXPECT = { restocks: 50, fulfilments: 48, kept: 1, contaminatedNames: 15 };

async function main() {
  const apply = process.argv.includes('--apply');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    const inv = (await c.query('SELECT * FROM inventory WHERE product_id = $1 FOR UPDATE', [MUNCHEE])).rows[0];
    if (!inv) throw new Error('Munchee inventory row not found');

    const ledger = (
      await c.query(
        `SELECT a.*, (o.id IS NOT NULL) AS order_exists,
                lag(a.adjustment_type) OVER w AS prev_type, lag(a.notes) OVER w AS prev_notes,
                lag(a.new_quantity) OVER w AS prev_new, lag(a.created_at) OVER w AS prev_at
           FROM inventory_adjustments a LEFT JOIN orders o ON o.id = a.reference_order_id
          WHERE a.inventory_id = $1
         WINDOW w AS (ORDER BY a.created_at, a.id)
          ORDER BY a.created_at, a.id`,
        [inv.id]
      )
    ).rows;

    const restocks = ledger.filter((r) => r.adjustment_type === 'PURCHASE_RESTOCK' && r.notes === TEST_NOTE);
    const fulfilments = ledger.filter(
      (r) =>
        r.adjustment_type === 'ORDER_FULFILLMENT' &&
        r.quantity_delta === -3 &&
        r.created_by_user_id === TEST_STAFF &&
        r.reference_order_id !== null &&
        !r.order_exists &&
        r.prev_type === 'PURCHASE_RESTOCK' &&
        r.prev_notes === TEST_NOTE &&
        r.prev_new === r.previous_quantity &&
        new Date(r.created_at) - new Date(r.prev_at) < 5000
    );
    const proven = new Set([...restocks, ...fulfilments].map((r) => r.id));
    const kept = ledger.filter((r) => !proven.has(r.id));
    const contaminated = (
      await c.query(
        `SELECT id, phone FROM users
          WHERE role = 'CUSTOMER' AND full_name = 'Ahmed Rizvi' AND id <> 'a0000001-0000-0000-0000-000000000001'
          ORDER BY phone`
      )
    ).rows;

    console.log(`Munchee inventory now: ${inv.tracking_mode}, on hand ${inv.quantity_on_hand}, reserved ${inv.quantity_reserved}`);
    console.log(`Proven test rows: ${restocks.length} restocks + ${fulfilments.length} fulfilments`);
    console.log(`Kept (not provable): ${kept.map((r) => `${r.adjustment_type} ${r.quantity_delta} ${r.created_at.toISOString()} note=${JSON.stringify(r.notes)}`).join('; ') || 'none'}`);
    console.log(`Contaminated names (not modified): ${contaminated.length}: ${contaminated.map((u) => u.phone).join(', ')}`);

    const counts = { restocks: restocks.length, fulfilments: fulfilments.length, kept: kept.length, contaminatedNames: contaminated.length };
    for (const [k, want] of Object.entries(EXPECT)) {
      if (counts[k] !== want) throw new Error(`${k}: expected ${want}, found ${counts[k]} - nothing changed`);
    }

    if (!apply) {
      await c.query('ROLLBACK');
      console.log('DRY RUN - nothing changed. Re-run with --apply.');
      return;
    }

    const del = await c.query('DELETE FROM inventory_adjustments WHERE id = ANY($1)', [[...proven]]);
    if (del.rowCount !== EXPECT.restocks + EXPECT.fulfilments) throw new Error(`deleted ${del.rowCount}`);
    const upd = await c.query(
      `UPDATE inventory SET tracking_mode = 'UNTRACKED', quantity_on_hand = 0, quantity_reserved = 0 WHERE id = $1`,
      [inv.id]
    );
    if (upd.rowCount !== 1) throw new Error('inventory reset did not match one row');
    await c.query('COMMIT');
    console.log(`APPLIED: deleted ${del.rowCount} proven test ledger rows; Munchee reset to its seed state.`);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
