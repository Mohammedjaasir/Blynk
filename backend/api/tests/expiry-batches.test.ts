import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { setPushSenderForTests, type PushSender } from '../src/modules/notifications/index.js';
import { setExpiryReadyForTests } from '../src/modules/expiry/expiry.ready.js';
import { expiryDigest } from '../src/modules/expiry/expiry.service.js';
import { runExpiryPush, expiryPushDue, EXPIRY_PUSH_TYPE } from '../src/modules/expiry/expiry.job.js';
import {
  addDays,
  bucketOf,
  bucketRange,
  colomboToday,
  daysLeft,
  expiryLabel,
  expiryPushText,
  severityOf,
} from '../src/modules/expiry/expiry.rules.js';
import { stockFixtures, tokens, users, auth } from './helpers/stock.js';

/**
 * Expiry dates (owner, 2026-10-25; migration 059): the batch register, the
 * Colombo-date buckets, discarding against stock and the ledger, the 503 guard,
 * the roles, the optional expiry date on a restock and the once-a-day staff push.
 * Everything made here is removed afterwards.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-EXP-');
const DEVICE = `expiry-staff-device-${Date.now()}`;
const fake: PushSender = { send: async (ts) => ts.map((token) => ({ token, ok: true as const })) };
let testStart: Date;
const today = colomboToday();
const inDays = (n: number) => addDays(today, n);

const api = {
  add: (body: object, token = tokens.admin) => request(app).post('/api/v1/admin/stock-batches').set(auth(token)).send(body),
  list: (qs = '', token = tokens.admin) => request(app).get(`/api/v1/admin/stock-batches${qs}`).set(auth(token)),
  summary: (token = tokens.admin) => request(app).get('/api/v1/admin/stock-batches/summary').set(auth(token)),
  patch: (id: string, body: object, token = tokens.admin) => request(app).patch(`/api/v1/admin/stock-batches/${id}`).set(auth(token)).send(body),
  soldOut: (id: string, token = tokens.admin) => request(app).post(`/api/v1/admin/stock-batches/${id}/sold-out`).set(auth(token)).send({}),
  discard: (id: string, body: object = {}, token = tokens.admin) =>
    request(app).post(`/api/v1/admin/stock-batches/${id}/discard`).set(auth(token)).send(body),
  product: (id: string, token = tokens.admin) => request(app).get(`/api/v1/admin/stock-batches/product/${id}`).set(auth(token)),
  tracking: (id: string, enabled: boolean, token = tokens.admin) =>
    request(app).put(`/api/v1/admin/stock-batches/product/${id}/tracking`).set(auth(token)).send({ enabled }),
};

async function addBatch(productId: string, quantity: number, expiresOn: string, extra: object = {}) {
  const res = await api.add({ product_id: productId, quantity, expires_on: expiresOn, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.batch as { id: string; status: string; quantity: number; expires_on: string; days_left: number; severity: string };
}

beforeAll(async () => {
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  await pool.query(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'android') ON CONFLICT (token) DO UPDATE SET user_id = $1`, [
    users.admin.id,
    DEVICE,
  ]);
});

afterEach(() => {
  setExpiryReadyForTests(null);
  setPushSenderForTests(undefined);
});

afterAll(async () => {
  await pool.query(`DELETE FROM notifications WHERE notification_type = $1 AND created_at >= $2`, [EXPIRY_PUSH_TYPE, testStart]);
  await pool.query('DELETE FROM device_tokens WHERE token = $1', [DEVICE]);
  await pool.query(`DELETE FROM audit_logs WHERE (action LIKE 'EXPIRY\_%' OR action = 'PRODUCT_EXPIRY_TRACKING_UPDATED') AND created_at >= $1`, [testStart]);
  await fx.cleanup();
});

// ----------------------------------------------------------------------------
describe('expiry rules (Colombo dates)', () => {
  it('"today" is the Colombo day, not the UTC day', () => {
    // 2026-10-24 19:00 UTC is already 2026-10-25 00:30 in Colombo
    expect(colomboToday(new Date('2026-10-24T19:00:00Z'))).toBe('2026-10-25');
    expect(colomboToday(new Date('2026-10-24T18:29:00Z'))).toBe('2026-10-24');
  });

  it('buckets: expired before today, week through +7, month +8..+30, then later', () => {
    const t = '2026-10-25';
    expect(bucketOf('2026-10-24', t)).toBe('expired');
    expect(bucketOf('2026-10-25', t)).toBe('week'); // expires today: still sellable today
    expect(bucketOf('2026-11-01', t)).toBe('week'); // +7
    expect(bucketOf('2026-11-02', t)).toBe('month'); // +8
    expect(bucketOf('2026-11-24', t)).toBe('month'); // +30
    expect(bucketOf('2026-11-25', t)).toBe('later'); // +31
    expect(daysLeft('2026-10-20', t)).toBe(-5);
    expect(daysLeft('2026-12-31', '2026-12-31')).toBe(0);
  });

  it('severity and labels', () => {
    const t = '2026-10-25';
    expect(severityOf('2026-10-24', t)).toBe('expired');
    expect(severityOf('2026-10-28', t)).toBe('red');
    expect(severityOf('2026-11-10', t)).toBe('amber');
    expect(severityOf('2027-01-10', t)).toBe('ok');
    expect(expiryLabel('2026-10-22', t)).toBe('Expired 3 days ago');
    expect(expiryLabel('2026-10-24', t)).toBe('Expired yesterday');
    expect(expiryLabel('2026-10-25', t)).toBe('Expires today');
    expect(expiryLabel('2026-10-26', t)).toBe('Expires tomorrow');
    expect(expiryLabel('2026-11-04', t)).toBe('Expires in 10 days');
  });

  it('bucket ranges are inclusive, disjoint and month-end safe', () => {
    expect(bucketRange('expired', '2026-10-31')).toEqual({ from: null, to: '2026-10-30' });
    expect(bucketRange('week', '2026-10-31')).toEqual({ from: '2026-10-31', to: '2026-11-07' });
    expect(bucketRange('month', '2026-10-31')).toEqual({ from: '2026-11-08', to: '2026-11-30' });
    expect(bucketRange('all', '2026-10-31')).toEqual({ from: null, to: null });
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // leap year
  });

  it('the staff push text, and the 8 am to 8 pm window', () => {
    expect(expiryPushText({ expired: 0, soon: 0, names: [] })).toBeNull();
    expect(expiryPushText({ expired: 2, soon: 1, names: ['Milk', 'Curd', 'Eggs', 'Bread'] })).toEqual({
      title: 'Stock has expired',
      body: '2 batches expired, 1 expires within 3 days: Milk, Curd, Eggs. Open Expiry to check them.',
    });
    expect(expiryPushText({ expired: 0, soon: 3, names: ['Milk'] })?.title).toBe('Stock expiring soon');
    expect(expiryPushDue(new Date('2026-10-25T01:00:00Z'))).toBe(false); // 06:30 Colombo
    expect(expiryPushDue(new Date('2026-10-25T02:30:00Z'))).toBe(true); // 08:00 Colombo
    expect(expiryPushDue(new Date('2026-10-25T14:30:00Z'))).toBe(false); // 20:00 Colombo
  });
});

// ----------------------------------------------------------------------------
describe('guard: 503 EXPIRY_NOT_READY before migration 059', () => {
  it('every endpoint answers 503, a restock with an expiry date too; a plain restock still works', async () => {
    const t = await fx.product({ onHand: 0 });
    setExpiryReadyForTests(false);
    for (const res of [
      await api.summary(),
      await api.list(),
      await api.add({ product_id: t.productId, quantity: 1, expires_on: inDays(5) }),
      await api.product(t.productId),
      await api.tracking(t.productId, true),
    ]) {
      expect(res.status).toBe(503);
      expect(res.body.error?.code ?? res.body.code).toBe('EXPIRY_NOT_READY');
    }
    const withDate = await fx.adjust(t.productId, 'PURCHASE_RESTOCK', 3).then(() =>
      request(app)
        .post(`/api/v1/admin/inventory/${t.productId}/adjust`)
        .set(auth(tokens.admin))
        .send({ adjustment_type: 'PURCHASE_RESTOCK', quantity_delta: 2, expires_on: inDays(5) })
    );
    expect(withDate.status).toBe(503);
    expect(await fx.onHand(t)).toBe(3); // refused before any stock moved
    const plain = await fx.adjust(t.productId, 'PURCHASE_RESTOCK', 2);
    expect(plain.status).toBe(200);
    expect(await expiryDigest()).toEqual({ expired: 0, within7: 0, within30: 0, names: [] });
    expect((await runExpiryPush({ force: true })).queued).toBe(0);
  });
});

// ----------------------------------------------------------------------------
describe('roles', () => {
  it('Admin, Operations-level and Inventory staff may use it; customers, riders and visitors may not', async () => {
    const t = await fx.product({ onHand: 0 });
    expect((await api.summary(tokens.staff)).status).toBe(200);
    expect((await api.list('', tokens.staff)).status).toBe(200);
    const b = await addBatch(t.productId, 2, inDays(10));
    expect((await api.patch(b.id, { note: 'by inventory' }, tokens.staff)).status).toBe(200);
    for (const token of [tokens.customer, tokens.rider]) {
      expect((await api.summary(token)).status).toBe(403);
      expect((await api.list('', token)).status).toBe(403);
      expect((await api.add({ product_id: t.productId, quantity: 1, expires_on: inDays(3) }, token)).status).toBe(403);
      expect((await api.discard(b.id, {}, token)).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/admin/stock-batches')).status).toBe(401);
    // the product form's switch is a catalog setting: not for Inventory staff
    expect((await api.tracking(t.productId, false, tokens.staff)).status).toBe(403);
    expect((await api.tracking(t.productId, false)).status).toBe(200);
  });
});

// ----------------------------------------------------------------------------
describe('batch rules', () => {
  it('validates the quantity, the date and the product', async () => {
    const t = await fx.product({ onHand: 0 });
    const bad = async (body: object, field: string) => {
      const res = await api.add({ product_id: t.productId, quantity: 1, expires_on: inDays(5), ...body });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(JSON.stringify(res.body)).toContain(field);
    };
    await bad({ quantity: 0 }, 'quantity');
    await bad({ quantity: 1.5 }, 'quantity');
    await bad({ quantity: -3 }, 'quantity');
    await bad({ expires_on: '2026-02-30' }, 'expires_on');
    await bad({ expires_on: '31/12/2026' }, 'expires_on');
    await bad({ expires_on: inDays(-400) }, 'expires_on');
    await bad({ expires_on: inDays(4000) }, 'expires_on');
    await bad({ batch_code: 'x'.repeat(61) }, 'batch_code');
    expect((await api.add({ product_id: '00000000-0000-4000-8000-000000000000', quantity: 1, expires_on: inDays(5) })).status).toBe(404);
    // a variant that belongs to another product
    const other = await fx.product({ onHand: 0 });
    const variant = (
      await pool.query(`INSERT INTO product_variants (product_id, label, purchase_cost) VALUES ($1, 'Other 500g', 10) RETURNING id`, [other.productId])
    ).rows[0].id as string;
    const res = await api.add({ product_id: t.productId, variant_id: variant, quantity: 1, expires_on: inDays(5) });
    expect(res.status).toBe(404);
    expect(res.body.error?.code ?? res.body.code).toBe('VARIANT_NOT_FOUND');
    // ...but is fine for its own product, and an already-expired date is accepted (stock found out of date)
    const ok = await api.add({ product_id: other.productId, variant_id: variant, quantity: 4, expires_on: inDays(-2), batch_code: ' L-77 ' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.batch).toMatchObject({ variant_label: 'Other 500g', batch_code: 'L-77', severity: 'expired', days_left: -2 });
  });

  it('a batch switches the product to "track expiry dates"; the switch can be turned off and back', async () => {
    const t = await fx.product({ onHand: 0 });
    expect((await api.product(t.productId)).body.data).toMatchObject({ expiry_tracking: false, batches: [] });
    await addBatch(t.productId, 5, inDays(20));
    const after = (await api.product(t.productId)).body.data;
    expect(after.expiry_tracking).toBe(true);
    expect(after.batches).toHaveLength(1);
    expect((await api.tracking(t.productId, false)).body.data.expiry_tracking).toBe(false);
    expect((await api.tracking(t.productId, true)).body.data.expiry_tracking).toBe(true);
    expect((await api.tracking('00000000-0000-4000-8000-000000000000', true)).status).toBe(404);
  });

  it('edit changes an ACTIVE batch only; sold-out and discarded batches are closed', async () => {
    const t = await fx.product({ onHand: 10 });
    const b = await addBatch(t.productId, 5, inDays(12), { batch_code: 'A1' });
    const edited = await api.patch(b.id, { quantity: 7, expires_on: inDays(15), batch_code: null, note: 'recounted' });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.data.batch).toMatchObject({ quantity: 7, expires_on: inDays(15), batch_code: null, note: 'recounted', days_left: 15 });
    expect((await api.patch(b.id, {})).status).toBe(400);
    expect((await api.patch(b.id, { quantity: 0 })).status).toBe(400);
    expect((await api.patch('00000000-0000-4000-8000-000000000000', { quantity: 1 })).status).toBe(404);

    const sold = await api.soldOut(b.id);
    expect(sold.status).toBe(200);
    expect(sold.body.data.batch.status).toBe('SOLD_OUT');
    expect(await fx.onHand(t)).toBe(10); // sold out never touches stock
    for (const res of [await api.patch(b.id, { quantity: 2 }), await api.soldOut(b.id), await api.discard(b.id)]) {
      expect(res.status).toBe(409);
      expect(res.body.error?.code ?? res.body.code).toBe('BATCH_NOT_ACTIVE');
    }
    // history
    const hist = await api.list(`?status=SOLD_OUT&product_id=${t.productId}`);
    expect(hist.body.data.batches.map((x: { id: string }) => x.id)).toEqual([b.id]);
    expect((await api.list(`?product_id=${t.productId}`)).body.data.batches).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
describe('buckets and the summary', () => {
  it('lists Expired / This week / This month by Colombo date, soonest first, and counts them', async () => {
    const t = await fx.product({ onHand: 0 });
    const before = (await api.summary()).body.data;
    const exp = await addBatch(t.productId, 3, inDays(-1));
    const todayB = await addBatch(t.productId, 2, inDays(0));
    const wk = await addBatch(t.productId, 4, inDays(7));
    const mo1 = await addBatch(t.productId, 5, inDays(8));
    const mo2 = await addBatch(t.productId, 6, inDays(30));
    const later = await addBatch(t.productId, 7, inDays(31));
    const ids = async (bucket: string) =>
      ((await api.list(`?bucket=${bucket}&product_id=${t.productId}`)).body.data.batches as { id: string }[]).map((x) => x.id);
    expect(await ids('expired')).toEqual([exp.id]);
    expect(await ids('week')).toEqual([todayB.id, wk.id]);
    expect(await ids('month')).toEqual([mo1.id, mo2.id]);
    expect(await ids('all')).toEqual([exp.id, todayB.id, wk.id, mo1.id, mo2.id, later.id]);
    const listed = (await api.list(`?bucket=week&product_id=${t.productId}`)).body.data;
    expect(listed.today).toBe(today);
    expect(listed.batches[0]).toMatchObject({ severity: 'red', label: 'Expires today', days_left: 0 });
    expect(listed.total).toBe(2);

    const after = (await api.summary()).body.data;
    expect(after.expired).toEqual({ batches: before.expired.batches + 1, units: before.expired.units + 3 });
    expect(after.week).toEqual({ batches: before.week.batches + 2, units: before.week.units + 6 });
    expect(after.month).toEqual({ batches: before.month.batches + 2, units: before.month.units + 11 });
    expect(after.within_3_days).toBe(before.within_3_days + 1);
    expect(after.total_active).toBe(before.total_active + 6);

    const digest = await expiryDigest();
    expect(digest.expired).toBeGreaterThanOrEqual(1);
    expect(digest.within7).toBeGreaterThanOrEqual(2);
    expect(digest.within30).toBeGreaterThanOrEqual(digest.within7 + 2);
    expect(digest.names.length).toBeLessThanOrEqual(5);
  });

  it('a product that was deleted drops out of the register', async () => {
    const t = await fx.product({ onHand: 0 });
    const b = await addBatch(t.productId, 1, inDays(2));
    expect((await api.list(`?product_id=${t.productId}`)).body.data.batches.map((x: { id: string }) => x.id)).toEqual([b.id]);
    await pool.query('UPDATE products SET deleted_at = now() WHERE id = $1', [t.productId]);
    expect((await api.list(`?product_id=${t.productId}`)).body.data.batches).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
describe('discard: stock and ledger math', () => {
  it('takes the batch quantity off a tracked product through the ledger, in one go, audited', async () => {
    const t = await fx.product({ onHand: 10 });
    const b = await addBatch(t.productId, 4, inDays(-3), { batch_code: 'M-1' });
    const res = await api.discard(b.id, { note: 'Found at the back' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.stock_removed).toBe(4);
    expect(res.body.data.stock).toMatchObject({ on_hand: 6 });
    expect(res.body.data.batch).toMatchObject({ status: 'DISCARDED', discard_reason: 'EXPIRED', discard_stock_removed: 4 });
    expect(await fx.onHand(t)).toBe(6);
    const ledger = await fx.ledgerFor(t);
    const last = ledger[ledger.length - 1];
    expect(last).toMatchObject({ adjustment_type: 'DAMAGE_WRITE_OFF', quantity_delta: -4, previous_quantity: 10, new_quantity: 6 });
    expect(last.created_by_user_id).toBe(users.admin.id);
    expect(last.notes).toContain('Expired');
    expect(last.notes).toContain('M-1');
    await fx.expectLedgerChain(t);
    const audit = (
      await pool.query(`SELECT new_values FROM audit_logs WHERE action = 'EXPIRY_BATCH_DISCARDED' AND entity_id = $1`, [b.id])
    ).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].new_values).toMatchObject({ reason: 'EXPIRED', stock_removed: 4, batch_quantity: 4 });
    // it cannot be discarded twice (no second ledger row)
    expect((await api.discard(b.id)).status).toBe(409);
    expect(await fx.onHand(t)).toBe(6);
  });

  it('never takes more than is on hand (a count that drifted below the batch)', async () => {
    const t = await fx.product({ onHand: 3 });
    const b = await addBatch(t.productId, 8, inDays(-1));
    const res = await api.discard(b.id, { reason: 'WASTE' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.stock_removed).toBe(3);
    expect(res.body.data.batch).toMatchObject({ discard_reason: 'WASTE', discard_stock_removed: 3 });
    expect(await fx.onHand(t)).toBe(0);
    await fx.expectLedgerChain(t);
    // nothing on hand at all: the batch closes, no ledger row
    const c = await addBatch(t.productId, 2, inDays(-1));
    const before = (await fx.ledgerFor(t)).length;
    expect((await api.discard(c.id)).body.data.stock_removed).toBe(0);
    expect((await fx.ledgerFor(t)).length).toBe(before);
  });

  it('an untracked product has no count to reduce, and reduce_stock:false only closes the batch', async () => {
    const u = await fx.product({ tracked: false });
    const b = await addBatch(u.productId, 5, inDays(-1));
    const res = await api.discard(b.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ stock_removed: 0, stock: null });
    expect(res.body.data.batch.status).toBe('DISCARDED');

    const t = await fx.product({ onHand: 9 });
    const c = await addBatch(t.productId, 5, inDays(-1));
    const closed = await api.discard(c.id, { reduce_stock: false });
    expect(closed.body.data.stock_removed).toBe(0);
    expect(await fx.onHand(t)).toBe(9);
    expect((await fx.ledgerFor(t)).filter((r) => r.adjustment_type === 'DAMAGE_WRITE_OFF')).toHaveLength(0);
  });

  it('a variant batch reduces that variant\'s own stock row, not the product\'s', async () => {
    const t = await fx.product({ onHand: 10 });
    const variant = (await pool.query(`INSERT INTO product_variants (product_id, label, purchase_cost) VALUES ($1, '1 kg', 10) RETURNING id`, [t.productId])).rows[0]
      .id as string;
    const inv = (
      await pool.query(
        `INSERT INTO inventory (dark_store_id, product_id, variant_id, tracking_mode, quantity_on_hand, quantity_reserved, low_stock_threshold)
         VALUES ('018dc3f0-4a82-789a-8b1b-947f61ad8821', $1, $2, 'TRACKED', 5, 0, 0) RETURNING id`,
        [t.productId, variant]
      )
    ).rows[0].id as string;
    const b = await addBatch(t.productId, 2, inDays(-1), { variant_id: variant });
    const res = await api.discard(b.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.stock_removed).toBe(2);
    expect((await pool.query('SELECT quantity_on_hand FROM inventory WHERE id = $1', [inv])).rows[0].quantity_on_hand).toBe(3);
    expect(await fx.onHand(t)).toBe(10);
    await pool.query('DELETE FROM inventory WHERE id = $1', [inv]);
  });

  it('an expired ACTIVE batch never hides the product', async () => {
    const t = await fx.product({ onHand: 5 });
    await addBatch(t.productId, 5, inDays(-10));
    const row = (await pool.query('SELECT is_active, is_available FROM products WHERE id = $1', [t.productId])).rows[0];
    expect(row).toEqual({ is_active: true, is_available: true });
    expect(await fx.onHand(t)).toBe(5);
  });
});

// ----------------------------------------------------------------------------
describe('restock with an expiry date', () => {
  const restock = (productId: string, body: object, token = tokens.staff) =>
    request(app)
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set(auth(token))
      .send({ adjustment_type: 'PURCHASE_RESTOCK', ...body });

  it('Inventory staff add stock and its batch in one call; without a date it works as before', async () => {
    const t = await fx.product({ onHand: 0 });
    const plain = await restock(t.productId, { quantity_delta: 5 });
    expect(plain.status).toBe(200);
    expect((await api.list(`?product_id=${t.productId}`)).body.data.batches).toHaveLength(0);

    const res = await restock(t.productId, { quantity_delta: 6, expires_on: inDays(9), batch_code: 'R-9' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await fx.onHand(t)).toBe(11);
    const batches = (await api.list(`?product_id=${t.productId}`)).body.data.batches;
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ quantity: 6, expires_on: inDays(9), batch_code: 'R-9', status: 'ACTIVE', severity: 'amber' });
    expect((await api.product(t.productId)).body.data.expiry_tracking).toBe(true);
  });

  it('refuses an expiry date on anything but a restock, and a bad date', async () => {
    const t = await fx.product({ onHand: 5 });
    const w = await restock(t.productId, { adjustment_type: 'DAMAGE_WRITE_OFF', quantity_delta: -1, expires_on: inDays(5) });
    expect(w.status).toBe(400);
    expect((await restock(t.productId, { quantity_delta: 1, expires_on: 'soon' })).status).toBe(400);
    expect(await fx.onHand(t)).toBe(5);
  });

  it('a restock that fails leaves no batch (untracked product)', async () => {
    const u = await fx.product({ tracked: false });
    const res = await restock(u.productId, { quantity_delta: 4, expires_on: inDays(5) });
    expect(res.status).toBe(409);
    expect((await api.list(`?product_id=${u.productId}`)).body.data.batches).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
describe('the daily staff push', () => {
  const mine = () =>
    pool.query(`SELECT payload, idempotency_key FROM notifications WHERE notification_type = $1 AND recipient = $2 AND created_at >= $3`, [
      EXPIRY_PUSH_TYPE,
      users.admin.id,
      testStart,
    ]);

  it('is queued once per staff member per Colombo day, however often it runs', async () => {
    setPushSenderForTests(fake);
    const t = await fx.product({ onHand: 0 });
    await addBatch(t.productId, 2, inDays(-1));
    const first = await runExpiryPush({ force: true });
    expect(first.queued).toBeGreaterThanOrEqual(1);
    const rows = (await mine()).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].idempotency_key).toBe(`expiry-push:${today}:${users.admin.id}`);
    expect(rows[0].payload).toMatchObject({ data: { type: 'staff_expiry' } });
    expect(rows[0].payload.title).toBe('Stock has expired');
    expect(rows[0].payload.body).toContain('Open Expiry');
    // again (next tick, a second worker, a restart): nothing more
    expect((await runExpiryPush({ force: true })).queued).toBe(0);
    expect((await mine()).rows).toHaveLength(1);
    // customers and riders never get it
    const others = await pool.query(`SELECT 1 FROM notifications WHERE notification_type = $1 AND recipient = ANY($2) AND created_at >= $3`, [
      EXPIRY_PUSH_TYPE,
      [users.customer.id, users.rider.id],
      testStart,
    ]);
    expect(others.rowCount).toBe(0);
  });

  it('outside 8 am - 8 pm Colombo nothing is queued, and with push not set up nothing is either', async () => {
    setPushSenderForTests(fake);
    await pool.query(`DELETE FROM notifications WHERE notification_type = $1 AND created_at >= $2`, [EXPIRY_PUSH_TYPE, testStart]);
    // 03:00 Colombo
    expect((await runExpiryPush({ now: new Date(`${today}T03:00:00+05:30`) })).queued).toBe(0);
    setPushSenderForTests(null);
    expect((await runExpiryPush({ force: true })).queued).toBe(0);
    expect((await mine()).rows).toHaveLength(0);
  });
});
