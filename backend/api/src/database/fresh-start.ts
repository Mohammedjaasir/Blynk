/**
 * Fresh start: clears all test data from the database before launch (owner, 2026-10-20:
 * "remove all rider customer inventory everything our app looks fresh"; "remove all the order
 * data, sales data, customers").
 *
 * Removes: every order and everything about it (items, payments, deliveries, status history,
 * coupon and birthday-offer uses), all customer and rider accounts (with their addresses,
 * points, wallet, referrals, feedback, phone tokens and sign-ins), rider documents and pay
 * records, doctor appointments and ratings, notification and SMS history, Inventory purchases
 * and suppliers, stock history and alerts, and the activity log; stock counts go back to
 * "not tracked".
 * Keeps: staff accounts (Admin, Ops, Inventory), products, variants, categories, combos,
 * coupons, banners, clinics and doctors, the store and its delivery area, and every setting.
 *
 * Run in the API container (Coolify > blynk-api > Terminal), after a database backup:
 *   node dist/database/fresh-start.js                         trial: shows what it would remove, changes nothing
 *   node dist/database/fresh-start.js --confirm FRESH-START   removes it (one transaction: all or nothing)
 * Uploaded files (rider documents, images) stay in storage; only the database rows go.
 */
import { pool } from './connection.js';

const CONFIRM = 'FRESH-START';
const STAFF_ROLES = ['ADMIN', 'OPERATIONS', 'PACKING_STAFF'];

/** In order: anything another row still points at is removed after what points at it. */
const STEPS: Array<[label: string, table: string, where?: string]> = [
  ['Rider pay lines', 'rider_earning_lines'],
  ['Rider pay adjustments', 'rider_pay_adjustments'],
  ['Rider cash hand-ins', 'cash_handins'],
  ['Deliveries', 'deliveries'],
  ['Payments', 'payments'],
  ['Payment notices', 'payment_notifications'],
  ['Inventory purchases (sourcing)', 'sourcing_records'],
  ['Orders (with items, status history, delivery codes)', 'orders'],
  ['Coupon uses', 'coupon_redemptions'],
  ['Birthday offer uses', 'birthday_offer_redemptions'],
  ['Suppliers', 'suppliers'],
  ['Stock history', 'inventory_adjustments'],
  ['Stock alerts ("notify me")', 'stock_alerts'],
  ['Doctor appointments (with history)', 'appointments'],
  ['Doctor ratings', 'doctor_ratings'],
  ['Notifications (push / SMS)', 'notifications'],
  ['SMS offers sent', 'sms_offers'],
  ['Blynk Points entries', 'points_ledger'],
  ['Blynk Wallet entries', 'wallet_entries'],
  ['Referral rewards', 'referral_rewards'],
  ['Referrals', 'referrals'],
  ['Referral codes', 'referral_codes'],
  ['Saved addresses', 'customer_addresses'],
  ['Feedback', 'customer_feedback'],
  ['SMS sign-in codes', 'otp_verifications'],
  ['Riders (with documents)', 'riders'],
  ['Customer and rider accounts (with sign-ins and phone tokens)', 'users', `role::text NOT IN (${STAFF_ROLES.map((r) => `'${r}'`).join(', ')})`],
  ['Activity log', 'audit_logs'],
];

/** Shown before and after, so the run proves what is left. */
const CHECK = [
  'orders', 'order_items', 'payments', 'deliveries', 'riders', 'rider_documents', 'customer_addresses',
  'points_ledger', 'wallet_entries', 'referrals', 'appointments', 'notifications', 'sourcing_records',
  'suppliers', 'inventory_adjustments', 'device_tokens', 'refresh_tokens',
];
const KEPT = ['products', 'product_variants', 'categories', 'combos', 'coupons', 'promotions', 'doctors', 'dental_clinics', 'system_configurations'];

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--confirm');
  const confirmed = i >= 0 && args[i + 1] === CONFIRM;
  if (i >= 0 && !confirmed) throw new Error(`To remove the data, run with: --confirm ${CONFIRM}`);

  const client = await pool.connect();
  const count = async (table: string, where?: string) =>
    Number((await client.query(`SELECT count(*)::int AS n FROM ${table}${where ? ` WHERE ${where}` : ''}`)).rows[0].n);
  try {
    const db = await client.query('SELECT current_database() AS db, inet_server_addr()::text AS host');
    console.log(`\nDatabase: ${db.rows[0].db} on ${db.rows[0].host ?? 'local socket'}`);
    console.log(confirmed ? 'MODE: REMOVING THE DATA\n' : 'MODE: trial (nothing is changed)\n');

    const staff = await client.query(
      `SELECT role::text, coalesce(email, phone, full_name) AS who FROM users WHERE role::text = ANY($1) ORDER BY role, who`,
      [STAFF_ROLES]
    );
    if (staff.rows.length === 0) throw new Error('No staff accounts found: stopping, so nobody is locked out of Admin.');
    console.log(`Staff accounts kept (${staff.rows.length}):`);
    for (const s of staff.rows) console.log(`  ${s.role.padEnd(13)} ${s.who}`);

    const before: Record<string, number> = {};
    for (const t of CHECK) before[t] = await count(t);

    await client.query('BEGIN');
    console.log('\nRemoving:');
    const removed: Record<string, number> = {};
    for (const [label, table, where] of STEPS) {
      const r = await client.query(`DELETE FROM ${table}${where ? ` WHERE ${where}` : ''}`);
      removed[table] = r.rowCount ?? 0;
      console.log(`  ${String(r.rowCount ?? 0).padStart(7)}  ${label}`);
    }
    const stock = await client.query(
      `UPDATE inventory SET tracking_mode = 'UNTRACKED', quantity_on_hand = 0, quantity_reserved = 0, updated_at = now()
        WHERE tracking_mode <> 'UNTRACKED' OR quantity_on_hand <> 0 OR quantity_reserved <> 0`
    );
    console.log(`  ${String(stock.rowCount ?? 0).padStart(7)}  Stock counts reset to "not tracked"`);

    console.log('\n                       before   after');
    for (const t of CHECK) console.log(`  ${t.padEnd(22)}${String(before[t]).padStart(7)}${String(await count(t)).padStart(8)}`);
    console.log('\nKept:');
    for (const t of KEPT) console.log(`  ${t.padEnd(22)}${String(await count(t)).padStart(7)}`);
    console.log(`  ${'staff accounts'.padEnd(22)}${String(staff.rows.length).padStart(7)}`);

    if (confirmed) {
      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, new_values) VALUES ('FRESH_START', 'system', gen_random_uuid(), $1::jsonb)`,
        [JSON.stringify({ removed, stock_reset: stock.rowCount ?? 0, at: new Date().toISOString() })]
      );
      await client.query('COMMIT');
      console.log('\nDone. The data above is removed. Staff stay signed in; customers and riders sign up again.\n');
    } else {
      await client.query('ROLLBACK');
      console.log(`\nTrial only: nothing was changed. To remove it, take a database backup, then run:\n  node dist/database/fresh-start.js --confirm ${CONFIRM}\n`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\nStopped, nothing was changed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
